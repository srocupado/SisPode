'use strict';
// Sistemas eleitorais · PERFIL DOS DISTRITOS (distrital misto) — núcleo PURO
// (sem DOM, sem rede). Exportado para os testes (Node); na extensão, global.
//
// Dados: sistemas/perfil/perfil-<ano>-<UF>.json (gerar-perfil.js), um vetor por
// local de votação ('município TSE|zona|local'):
//  · TSE — perfil do eleitorado por seção, somado por local (escolaridade e idade
//    declaradas no cadastro eleitoral; deficiência);
//  · IBGE — Censo 2022 por setor censitário, cada setor no local de votação mais
//    próximo do mesmo município (total do município exato; dentro dele, aproximação).
// E sistemas/perfil/candidatos-<ano>.json (gerar-candidatos.js): gênero, cor/raça,
// idade e escolaridade de cada candidato a deputado.
//
// As unidades do desenho dos distritos (sistemas-distrital.js) são municípios
// ('m:'), zonas ('z:') e locais de votação ('l:'); o perfil de cada uma é a soma
// dos seus locais, e o do distrito, a soma das suas unidades.

/** Índice do arquivo de perfil: vetores por local, por zona e por município. */
function spIndice(doc) {
  const campos = [...doc.campos.tse, ...doc.campos.censo];
  const i = Object.fromEntries(campos.map((c, k) => [c, k]));
  const n = campos.length, loc = new Map(), zona = new Map(), mun = new Map();
  const soma = (m, k, v) => { const a = m.get(k); if (!a) m.set(k, v.slice()); else for (let j = 0; j < n; j++) a[j] += v[j]; };
  for (const [k, v] of Object.entries(doc.loc || {})) {
    loc.set(k, v);
    const [m, z] = k.split('|');
    soma(zona, m + '|' + z, v);
    soma(mun, m, v);
  }
  return { ano: doc.ano, uf: doc.uf, campos, i, n, loc, zona, mun, validacao: doc.validacao || null };
}

/** Vetor de perfil de UMA unidade do desenho (null se o arquivo não a cobre). */
function spUnidade(P, u) {
  if (!P || !u) return null;
  if (u.id.startsWith('l:')) return P.loc.get(`${u.mun}|${u.zonas[0]}|${u.loc}`) || null;
  if (u.id.startsWith('z:')) return P.zona.get(`${u.mun}|${u.zonas[0]}`) || null;
  return P.mun.get(String(u.mun)) || null;
}

/** Perfil de cada distrito: { id: vetor } (soma das unidades). */
function spDistritos(P, base, desenho) {
  const U = new Map(base.unidades.map(u => [u.id, u])), out = {};
  for (const d of desenho.distritos) {
    const v = new Array(P.n).fill(0);
    let cobertos = 0;
    for (const id of d.unidades) {
      const p = spUnidade(P, U.get(id));
      if (!p) continue;
      cobertos++;
      for (let j = 0; j < P.n; j++) v[j] += p[j];
    }
    out[d.id] = cobertos ? v : null;
  }
  return out;
}

// Indicadores mostrados. fonte: 'tse' (cadastro eleitoral) ou 'censo' (IBGE).
// valor(v, i) → fração (0–1) ou número; null quando a base é zero.
const SP_IND = [
  { id: 'superior', nome: 'Superior completo', curto: '% superior', fonte: 'tse', tipo: 'pct',
    nota: 'eleitores com superior completo, entre os de escolaridade informada',
    valor: (v, i) => r(v[i.escSupComp], v[i.eleitores] - v[i.escNaoInf]) },
  { id: 'ateFund', nome: 'Até fundamental incompleto', curto: '% até fund.', fonte: 'tse', tipo: 'pct',
    nota: 'eleitores analfabetos, que só leem e escrevem ou com fundamental incompleto',
    valor: (v, i) => r(v[i.escAnalfabeto] + v[i.escLeEscreve] + v[i.escFundInc], v[i.eleitores] - v[i.escNaoInf]) },
  { id: 'jovens', nome: 'Eleitores de 16 a 24 anos', curto: '% 16–24', fonte: 'tse', tipo: 'pct',
    valor: (v, i) => r(v[i.id16a24], v[i.eleitores] - v[i.idNaoInf]) },
  { id: 'idosos', nome: 'Eleitores de 60 anos ou mais', curto: '% 60+', fonte: 'tse', tipo: 'pct',
    valor: (v, i) => r(v[i.id60a69] + v[i.id70mais], v[i.eleitores] - v[i.idNaoInf]) },
  { id: 'deficiencia', nome: 'Eleitores com deficiência', curto: '% c/ defic.', fonte: 'tse', tipo: 'pct',
    nota: 'declarada no cadastro eleitoral', valor: (v, i) => r(v[i.deficiencia], v[i.eleitores]) },
  { id: 'negros', nome: 'Pretos e pardos', curto: '% pretos e pardos', fonte: 'censo', tipo: 'pct',
    nota: 'população residente, Censo 2022', valor: (v, i) => r(v[i.preta] + v[i.parda], v[i.branca] + v[i.preta] + v[i.amarela] + v[i.parda] + v[i.indigena]) },
  { id: 'indigenas', nome: 'Indígenas', curto: '% indígenas', fonte: 'censo', tipo: 'pct',
    valor: (v, i) => r(v[i.indigena], v[i.branca] + v[i.preta] + v[i.amarela] + v[i.parda] + v[i.indigena]) },
  { id: 'naoAlfab', nome: 'Não alfabetizados (15 anos ou mais)', curto: '% não alfab.', fonte: 'censo', tipo: 'pct',
    valor: (v, i) => r(v[i.naoAlfab15], v[i.alfab15] + v[i.naoAlfab15]) },
  { id: 'esgoto', nome: 'Domicílios com esgoto na rede', curto: '% esgoto', fonte: 'censo', tipo: 'pct',
    nota: 'rede geral, pluvial ou fossa séptica ligada à rede', valor: (v, i) => r(v[i.esgotoRede], v[i.dom]) },
  { id: 'agua', nome: 'Domicílios com água da rede geral', curto: '% água', fonte: 'censo', tipo: 'pct',
    valor: (v, i) => r(v[i.aguaRede], v[i.dom]) },
  { id: 'lixo', nome: 'Domicílios com lixo coletado', curto: '% lixo', fonte: 'censo', tipo: 'pct',
    valor: (v, i) => r(v[i.lixoColetado], v[i.dom]) },
  { id: 'semBanheiro', nome: 'Domicílios sem banheiro de uso exclusivo', curto: '% s/ banheiro', fonte: 'censo', tipo: 'pct',
    valor: (v, i) => r(v[i.semBanheiro], v[i.dom]) },
  { id: 'rural', nome: 'População rural', curto: '% rural', fonte: 'censo', tipo: 'pct',
    nota: 'situação do setor censitário', valor: (v, i) => r(v[i.popRural], v[i.pop]) },
  { id: 'densidade', nome: 'Densidade (hab./km²)', curto: 'hab./km²', fonte: 'censo', tipo: 'num',
    valor: (v, i) => (v[i.areaKm2x1000] > 0 ? v[i.pop] / (v[i.areaKm2x1000] / 1000) : null) },
];
function r(a, b) { return b > 0 ? a / b : null; }

/** Valor de um indicador para um vetor de perfil. */
function spValor(P, v, indId) {
  const ind = SP_IND.find(x => x.id === indId);
  return ind && v ? ind.valor(v, P.i) : null;
}

/**
 * Terços dos distritos por um indicador e as vitórias de cada partido em cada terço.
 * distritos: [{ id, partido }] (o partido do eleito); perfis: { id: vetor }.
 * Devolve { cortes: [c1, c2], tercos: [{ nome, n, porPartido: { sigla: n } }] } (null se faltar dado).
 */
function spTercos(P, distritos, perfis, indId) {
  const vals = distritos.map(d => ({ d, x: spValor(P, perfis[d.id], indId) })).filter(o => o.x != null);
  if (vals.length < 3) return null;
  vals.sort((a, b) => a.x - b.x);
  const n = vals.length, l1 = Math.round(n / 3), l2 = Math.round((2 * n) / 3);
  const grupos = [vals.slice(0, l1), vals.slice(l1, l2), vals.slice(l2)];
  return {
    cortes: [vals[l1 - 1].x, vals[l2 - 1].x],
    tercos: grupos.map((g, k) => {
      const porPartido = {};
      for (const o of g) if (o.d.partido) porPartido[o.d.partido] = (porPartido[o.d.partido] || 0) + 1;
      return { nome: ['Terço mais baixo', 'Terço do meio', 'Terço mais alto'][k], n: g.length, min: g[0].x, max: g[g.length - 1].x, porPartido };
    }),
  };
}

/** Faixas (quantis) para pintar o mapa: devolve os cortes entre `k` classes. */
function spQuantis(valores, k = 5) {
  const v = valores.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return [];
  const out = [];
  // corte j = o maior valor da faixa j (com n ≤ k valores, cada um na sua faixa)
  for (let j = 1; j < k; j++) out.push(v[Math.max(0, Math.ceil((j * v.length) / k) - 1)]);
  return out;
}
const spClasse = (x, cortes) => { if (x == null) return -1; let c = 0; while (c < cortes.length && x > cortes[c]) c++; return c; };

/**
 * Representação: perfil dos eleitos de um conjunto (sq dos candidatos) pelo
 * cadastro (candidatos-<ano>.json). Devolve { n, mulheres, negros, idadeMedia, superior, semCadastro }.
 */
function spPerfilEleitos(cad, sqs) {
  const o = { n: 0, mulheres: 0, negros: 0, indigenas: 0, superior: 0, somaIdade: 0, nIdade: 0, semCadastro: 0 };
  for (const sq of sqs) {
    const c = cad && cad.cand && cad.cand[String(sq)];
    if (!c) { o.semCadastro++; continue; }
    o.n++;
    if (c[0] === 'F') o.mulheres++;
    if (c[1] === 'preta' || c[1] === 'parda') o.negros++;
    if (c[1] === 'indigena') o.indigenas++;
    if (c[3] === 7) o.superior++;
    if (c[2] != null) { o.somaIdade += c[2]; o.nIdade++; }
  }
  o.idadeMedia = o.nIdade ? o.somaIdade / o.nIdade : null;
  return o;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spIndice, spUnidade, spDistritos, SP_IND, spValor, spTercos, spQuantis, spClasse, spPerfilEleitos };
}
