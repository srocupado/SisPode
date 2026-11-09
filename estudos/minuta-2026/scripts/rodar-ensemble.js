'use strict';
// Para cada UF: o desenho do simulador + M desenhos alternativos (multi-início aleatório: o mesmo
// algoritmo do simulador sobre coordenadas perturbadas por município, depois as mesmas regras de
// tamanho e contiguidade da Minuta). Em cada desenho: a Minuta para deputado federal, para estadual
// (nos distritos federais, com várias cadeiras) e, nos 5 primeiros, a federação do PODEMOS com cada parceiro.
// Uso: node rodar-ensemble.js UF[,UF...] [M]
const fs = require('fs'), path = require('path');
const L = require('./lib.js'), D = L.D;
const N = require('/home/user/SisPode/sistemas-nucleo.js');
const SAIDA = path.join(__dirname, '..', 'resultados', 'ens');
fs.mkdirSync(SAIDA, { recursive: true });
const [lista, Marg] = process.argv.slice(2), M = +(Marg || 24);
const PARCEIROS = ['PL', 'PT', 'PSD', 'REPUBLICANOS', 'MDB', 'UNIÃO', 'PSOL', 'PSB', 'NOVO', 'PSDB', 'PDT', 'AVANTE', 'MISSÃO', 'PRD', 'SOLIDARIEDADE', 'DC', 'MOBILIZA', 'DEMOCRATA', 'AGIR'];
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function resumo(x, r, vagasPode = 'PODE') {
  const porPartido = {};
  for (const e of r.eleitos) { const p = e.cand ? e.cand.partido : '?'; porPartido[p] = (porPartido[p] || 0) + 1; }
  const pode = L.agrDe(x.d, 'PODE');
  const candDe = new Map(); for (const a of x.d.agrs) for (const c of a.cands) candDe.set(String(c.sq), { a, c });
  const distritos = r.distritos.map(dt => {
    // ranking dos candidatos no distrito (votos nominais), recalculado da contagem do motor
    return { id: dt.id, aptos: Math.round(dt.aptos), validos: dt.validos, cadeiras: dt.cadeiras,
      venc: (dt.vencedores || []).map(w => [w.sq, w.partido, w.votos]), seg: dt.segundo ? [dt.segundo.nome, dt.segundo.votos] : null };
  });
  return { porPartido, distritos, extra: r.extra || 0, excedentes: r.excedentes || null, descobertos: r.descobertos || null, podeAgr: pode ? pode.id : null };
}

/** Votos por candidato e por agremiação em cada distrito (para o ranking do PODEMOS). */
function rankings(x, desenho, base, votos) {
  const vd = D.sdVotosDistritos(x.d, desenho, base, votos);
  const candDe = new Map(); for (const a of x.d.agrs) for (const c of a.cands) candDe.set(String(c.sq), { a, c });
  const pode = L.agrDe(x.d, 'PODE');
  return vd.map(v => {
    const lista = Object.entries(v.porCand).sort((p, q) => q[1] - p[1]);
    const top = lista.slice(0, 12).map(([sq, n]) => [sq, candDe.get(sq).c.partido, n]);
    let pb = null, podeNom = 0;
    if (pode) lista.forEach(([sq, n], i) => { if (candDe.get(sq).a.id === pode.id) { podeNom += n; if (!pb) pb = [sq, n, i + 1, candDe.get(sq).c.nome]; } });
    return { validos: v.validos, top, pode: pode ? { best: pb, nominal: podeNom, total: v.porAgr[pode.id] || 0 } : null };
  });
}

function mapaEstadual(fedMapa, fBaseFed, fe) {
  // leva o desenho federal à base fina dos estaduais (mesmos locais; o que faltar, pela zona ou município)
  const de = new Map(); fedMapa.distritos.forEach((d, j) => { for (const id of d.unidades) de.set(id, j); });
  const zona = new Map(); for (const [id, j] of de) { const p = id.split(':'); if (p[0] === 'l') { const kz = 'z:' + p[1] + ':' + p[2]; if (!zona.has(kz)) zona.set(kz, j); const km = 'm:' + p[1]; if (!zona.has(km)) zona.set(km, j); } else zona.set(id, j); }
  const partes = fedMapa.distritos.map(() => []);
  for (const u of fe.base.unidades) {
    let j = de.get(u.id);
    if (j === undefined) { const p = u.id.split(':'); j = p[0] === 'l' ? (zona.get('z:' + p[1] + ':' + p[2]) ?? zona.get('m:' + p[1])) : (zona.get(u.id) ?? zona.get('m:' + u.mun)); }
    if (j === undefined) j = 0;
    partes[j].push(u.id);
  }
  const U = new Map(fe.base.unidades.map(u => [u.id, u]));
  const m = D.sdMedir(partes, U, fe.base.viz, fe.desenho.alvo, partes.length);
  // mantém a numeração do federal
  m.distritos.forEach((d, i) => { d.id = fedMapa.distritos[partes.indexOf(d.unidades.length ? partes.find(p => p[0] === d.unidades[0]) : [])]?.id || d.id; });
  return m;
}

for (const UF of lista.split(',')) {
  const arq = path.join(SAIDA, UF + '.json');
  if (fs.existsSync(arq)) { console.log(UF, 'já existe'); continue; }
  const t0 = Date.now();
  const x = L.carregar(UF), f = L.fino(UF), xe = L.carregar(UF, 'estadual'), fe = L.fino(UF, 'estadual');
  if (!x || !f) { console.log(UF, 'sem dados'); continue; }
  const k = f.desenho.distritos.length;
  const U = new Map(f.base.unidades.map(u => [u.id, u]));
  const A = f.base.unidades.reduce((s, u) => s + u.area, 0), sig = 0.3 * Math.sqrt(A / Math.max(1, k));
  const mapas = [Object.assign(f.desenho, { origem: 'simulador' })];
  const r = L.rng(hash(UF));
  const g = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  let tentativas = 0;
  while (mapas.length < M + 1 && tentativas < 2 * M && k > 1) {
    tentativas++;
    const off = {};
    const b = { unidades: f.base.unidades.map(u => { if (!off[u.mun]) off[u.mun] = [g() * sig, g() * sig]; return Object.assign({}, u, { x: u.x + off[u.mun][0], y: u.y + off[u.mun][1] }); }), viz: f.base.viz };
    const des = D.sdDistritar(b, k, { tol: f.tol, ateTol: true });
    if (des.erro) continue;
    const m = D.sdMedir(des.distritos.map(d => d.unidades), U, f.base.viz, f.desenho.alvo, k);
    m.alvo = f.desenho.alvo;
    if (!m.metricas.contiguos || !D.sdTolerancia(m.distritos, f.tol).ok) continue;
    m.origem = 'aleatorio';
    mapas.push(m);
  }
  const ordemU = f.base.unidades.map(u => u.id), idx = new Map(ordemU.map((id, i) => [id, i]));
  const out = { uf: UF, k, unidades: ordemU.length, M: mapas.length, tentativas, mapas: [] };
  const atrib = [];
  mapas.forEach((m, i) => {
    const a = new Array(ordemU.length).fill(-1); m.distritos.forEach(d => { for (const id of d.unidades) a[idx.get(id)] = d.id; }); atrib.push(a);
    const rf = L.rodar(x, m, f.base, f.votos);
    const o = { origem: m.origem, metricas: { desvioMax: m.metricas.desvioMax, compacidadeMedia: m.metricas.compacidadeMedia, municipiosDivididos: m.metricas.municipiosDivididos },
      federal: Object.assign(resumo(x, rf), { rank: rankings(x, m, f.base, f.votos) }) };
    if (xe && fe) {
      const me = mapaEstadual(m, f.base, fe);
      const re = L.rodar(xe, me, fe.base, fe.votos);
      o.estadual = Object.assign(resumo(xe, re), { rank: rankings(xe, re.desenhoUsado, fe.base, fe.votos) });
    }
    if (i < 5) {
      o.federacao = {};
      for (const p of PARCEIROS) {
        if (!x.d.agrs.some(a => a.siglas.includes(p)) || !L.agrDe(x.d, 'PODE')) continue;
        const d2 = N.snFederar({ [UF]: x.d }, 'PODE', p)[UF];
        const r2 = L.rodar(Object.assign({}, x, { d: d2 }), m, f.base, f.votos);
        const pp = {}; for (const e of r2.eleitos) pp[e.cand.partido] = (pp[e.cand.partido] || 0) + 1;
        o.federacao[p] = pp;
      }
    }
    out.mapas.push(o);
  });
  fs.writeFileSync(arq, JSON.stringify(out));
  fs.writeFileSync(path.join(SAIDA, UF + '-atrib.json'), JSON.stringify({ unidades: ordemU, mun: f.base.unidades.map(u => u.mun), aptos: f.base.unidades.map(u => Math.round(u.aptos)), atrib }));
  console.log(UF, 'mapas', mapas.length, 'de', tentativas + 1, Math.round((Date.now() - t0) / 1000) + ' s');
}
