'use strict';
// Biblioteca do estudo: carrega as exportações do simulador, reroda a Minuta com o
// motor do próprio simulador (sistemas-distrital.js) e gera mapas alternativos
// (cadeia de Markov de trocas na fronteira, com as mesmas regras de tamanho e contiguidade).
const fs = require('fs'), path = require('path');
const RAIZ = '/home/user/SisPode';
const D = require(RAIZ + '/sistemas-distrital.js');
const DADOS = path.join(__dirname, '..', 'dados');
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function carregar(uf, cargo = 'federal') {
  const f = path.join(DADOS, `${cargo}-${uf}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/** Roda a Minuta (motor do simulador) num desenho; cadeiras por distrito no modo dos estaduais. */
function rodar(x, desenho, base, votos) {
  const p = x.porUf;
  let des = desenho || p.desenho;
  if (p.modoEstadual === 'fed') {
    const kE = D.sdNumeroDistritos(x.d.vagas, x.op.pctDistrital, x.op.arred);
    const n = D.sdCadeirasPorDistrito(des.distritos, kE);
    des = Object.assign({}, des, { distritos: des.distritos.map((dt, j) => Object.assign({}, dt, { cadeiras: n[j] })) });
  }
  const op = Object.assign({}, x.op, p, { desenho: des, base: base || p.base, listaPre: null }, votos ? { votos } : {});
  const r = D.sdDistritalMisto(x.d, op);
  r.desenhoUsado = des;
  return r;
}

/** Gerador pseudoaleatório com semente (mulberry32): o estudo se reproduz. */
function rng(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Mapas alternativos: cadeia de trocas na fronteira (flip) a partir do desenho do simulador.
 * Cada passo propõe passar uma unidade da fronteira ao distrito vizinho; aceita se
 * (1) todos os distritos seguem na tolerância da Minuta (±5%; ±10% em 1 distrito ou 10% deles),
 * (2) o distrito que cede segue contíguo e não fica vazio, e (3) pelo critério de Metropolis
 * sobre o número de arestas cortadas (penaliza fronteiras recortadas: mantém a compacidade).
 * Devolve { mapas: [desenho], aceitacao }.
 */
function ensemble(base, desenho, tol, { amostras = 20, espacamento = 4, aquecimento = 10, beta = 1, semente = 1 } = {}) {
  const U = new Map(base.unidades.map(u => [u.id, u]));
  const viz = {}; for (const [k, v] of Object.entries(base.viz)) viz[k] = [...v].filter(w => U.has(w));
  const k = desenho.distritos.length, alvo = desenho.alvo || base.unidades.reduce((s, u) => s + u.aptos, 0) / k;
  const dist = new Map(), pop = new Array(k).fill(0), tam = new Array(k).fill(0);
  desenho.distritos.forEach((d, j) => { for (const id of d.unidades) { dist.set(id, j); pop[j] += U.get(id).aptos; tam[j]++; } });
  const arestas = [];
  for (const [a, vs] of Object.entries(viz)) for (const b of vs) if (a < b && dist.has(a) && dist.has(b)) arestas.push([a, b]);
  if (!arestas.length || k < 2) return { mapas: [], aceitacao: 0 };
  const eps = 1e-9, temExc = tol.exc > tol.pct, permit = temExc ? Math.max(tol.excN || 0, Math.floor(k * (tol.excFrac || 0) + eps)) : 0;
  const classe = p => { const a = Math.abs(p / alvo - 1); return a <= tol.pct + eps ? 0 : temExc && a <= tol.exc + eps ? 1 : 2; };
  let nExc = pop.filter(p => classe(p) === 1).length, nFora = pop.filter(p => classe(p) === 2).length;
  const r = rng(semente);
  const contiguoSem = (u, j) => {
    const resto = tam[j] - 1; if (resto < 1) return false;
    const ini = viz[u].find(w => dist.get(w) === j); if (!ini) return false;
    const visto = new Set([u, ini]), fila = [ini]; let n = 1;
    while (fila.length) { const a = fila.pop(); for (const b of viz[a]) if (!visto.has(b) && dist.get(b) === j) { visto.add(b); fila.push(b); n++; } }
    return n === resto;
  };
  const n = U.size, mapas = [];
  let tent = 0, aceitos = 0;
  const passosAte = c => c * n;
  const total = passosAte(aquecimento) + passosAte(espacamento) * amostras;
  let proxima = passosAte(aquecimento);
  for (let passo = 1; passo <= total; passo++) {
    const [a0, b0] = arestas[Math.floor(r() * arestas.length)];
    const [u, v] = r() < 0.5 ? [a0, b0] : [b0, a0];
    const de = dist.get(u), para = dist.get(v);
    if (de !== para) {
      tent++;
      const au = U.get(u).aptos;
      const cDe0 = classe(pop[de]), cPa0 = classe(pop[para]), cDe1 = classe(pop[de] - au), cPa1 = classe(pop[para] + au);
      const exc1 = nExc - (cDe0 === 1) - (cPa0 === 1) + (cDe1 === 1) + (cPa1 === 1);
      const fora1 = nFora - (cDe0 === 2) - (cPa0 === 2) + (cDe1 === 2) + (cPa1 === 2);
      // não piora o que já estava fora; e a tolerância vale ao fim de cada passo
      const okTam = (fora1 === 0 && exc1 <= permit) || (fora1 < nFora) || (fora1 === nFora && Math.abs((pop[de] - au) / alvo - 1) < Math.abs(pop[de] / alvo - 1) && Math.abs((pop[para] + au) / alvo - 1) <= Math.max(tol.pct, Math.abs(pop[para] / alvo - 1)));
      if (okTam) {
        let dCorte = 0;
        for (const w of viz[u]) { const dw = dist.get(w); if (dw === undefined) continue; dCorte += (dw !== para) - (dw !== de); }
        if ((dCorte <= 0 || r() < Math.exp(-beta * dCorte)) && contiguoSem(u, de)) {
          dist.set(u, para); pop[de] -= au; pop[para] += au; tam[de]--; tam[para]++; nExc = exc1; nFora = fora1; aceitos++;
        }
      }
    }
    if (passo === proxima) {
      const partes = Array.from({ length: k }, () => []);
      for (const [id, j] of dist) partes[j].push(id);
      const m = D.sdMedir(partes, U, viz, alvo, k);
      m.alvo = alvo; m.tolerancia = D.sdTolerancia(m.distritos, tol);
      mapas.push(m);
      proxima += passosAte(espacamento);
    }
  }
  return { mapas, aceitacao: aceitos / (tent || 1) };
}

/** A base fina (todas as unidades divididas nos locais de votação) e o desenho inicial nela. */
function fino(uf, cargo = 'federal') {
  const f = path.join(DADOS, `fino-${cargo}-${uf}.json`);
  if (!fs.existsSync(f)) return null;
  const y = JSON.parse(fs.readFileSync(f, 'utf8'));
  const base = { unidades: y.fino.unidades, viz: y.fino.viz };
  const U = new Map(base.unidades.map(u => [u.id, u]));
  const viz = {}; for (const [k, v] of Object.entries(base.viz)) viz[k] = [...v];
  base.viz = viz;
  const partes = y.fino.inicial.map(d => d.unidades);
  const desenho = D.sdMedir(partes, U, viz, y.fino.alvo, partes.length);
  desenho.alvo = y.fino.alvo;
  return { base, desenho, votos: y.fino.votos, tol: y.op.tol };
}

/** A agremiação de uma sigla (PODE) num estado. */
const agrDe = (d, sigla) => d.agrs.find(a => (a.siglas || []).includes(sigla));

module.exports = { D, UFS, carregar, fino, rodar, rng, ensemble, agrDe, DADOS };
