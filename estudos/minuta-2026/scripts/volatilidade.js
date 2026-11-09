'use strict';
// Volatilidade histórica: variação da fatia de cada partido (deputado federal) em cada UF
// de uma eleição para a seguinte (2018→2022 e 2022→2026), com as siglas levadas às sucessoras.
// Devolve as razões log(fatia_t / fatia_t-1) dos partidos com fatia anterior ≥ 1%.
const fs = require('fs'), path = require('path');
const { harmonizar } = require('./partidos.js');
const T = path.join(__dirname, '..', 'tse');
function fatias(ano, ate) {
  const x = JSON.parse(fs.readFileSync(path.join(T, `partidos-${ano}.json`), 'utf8'));
  const porUf = {};
  for (const m of Object.values(x)) {
    const u = porUf[m.uf] || (porUf[m.uf] = {});
    for (const [sg, v] of Object.entries(m.f)) { const h = harmonizar(sg, ano, ate); u[h] = (u[h] || 0) + v; }
  }
  for (const u of Object.values(porUf)) { const t = Object.values(u).reduce((a, b) => a + b, 0); for (const k in u) u[k] /= t; }
  return porUf;
}
function razoes({ minimo = 0.01, faixa = null } = {}) {
  const out = [];
  for (const [a, b] of [[2018, 2022], [2022, 2026]]) {
    const A = fatias(a, b), B = fatias(b, b);
    for (const uf of Object.keys(A)) for (const [sg, s0] of Object.entries(A[uf])) {
      if (s0 < minimo || (faixa && (s0 < faixa[0] || s0 > faixa[1]))) continue;
      const s1 = (B[uf] || {})[sg] || 0;
      out.push({ ciclo: `${a}→${b}`, uf, sg, s0, s1, r: Math.log(Math.max(s1, 1e-4) / s0) });
    }
  }
  return out;
}
module.exports = { fatias, razoes };
if (require.main === module) {
  const r = razoes();
  const q = (v, p) => { const s = v.slice().sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  const rs = r.map(x => x.r);
  console.log('n', rs.length, 'mediana', q(rs, .5).toFixed(3), 'p10', q(rs, .1).toFixed(3), 'p90', q(rs, .9).toFixed(3));
  const pode = r.filter(x => x.sg === 'PODE'); console.log('PODE', pode.map(x => x.ciclo + ' ' + x.uf + ' ' + (100 * x.s0).toFixed(1) + '→' + (100 * x.s1).toFixed(1)).join('; '));
}
