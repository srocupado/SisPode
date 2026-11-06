'use strict';
// Números de apoio ao texto do artigo: qualidade dos mapas, volatilidade histórica, posições do PODEMOS.
const fs = require('fs'), path = require('path');
const L = require('./lib.js'), V = require('./volatilidade.js');
const E = path.join(__dirname, '..', 'resultados', 'ens');
const q = (v, p) => { const s = v.slice().sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const out = { mapas: { porUf: {} }, vol: {}, pos: {} };
let dev = [], comp = [], compSim = [], div = [], nMapas = 0, unidades = 0, distritos = 0;
const rankBest = [];
for (const uf of L.UFS) {
  const o = JSON.parse(fs.readFileSync(path.join(E, uf + '.json'), 'utf8'));
  nMapas += o.mapas.length; unidades += o.unidades; distritos += o.k;
  const d = o.mapas.map(m => m.metricas.desvioMax), c = o.mapas.map(m => m.metricas.compacidadeMedia);
  dev.push(...d); comp.push(...c.slice(1)); compSim.push(c[0]); div.push(...o.mapas.map(m => m.metricas.municipiosDivididos));
  out.mapas.porUf[uf] = { k: o.k, unidades: o.unidades, devMax: Math.max(...d), compSim: c[0], compAlt: c.slice(1).reduce((a, b) => a + b, 0) / (c.length - 1) };
  for (const m of o.mapas) for (const r of m.federal.rank) if (r.pode && r.pode.best) rankBest.push(r.pode.best[2]);
}
out.mapas.total = nMapas; out.mapas.unidades = unidades; out.mapas.distritos = distritos;
out.mapas.desvioMax = { mediana: q(dev, .5), p95: q(dev, .95), max: Math.max(...dev) };
out.mapas.compacidade = { simulador: compSim.reduce((a, b) => a + b, 0) / compSim.length, alternativos: comp.reduce((a, b) => a + b, 0) / comp.length, p05: q(comp, .05), p95: q(comp, .95) };
out.mapas.municipiosDivididos = { mediana: q(div, .5) };
const h = V.razoes({ minimo: 0.005 }), rs = h.map(x => x.r);
out.vol = { pares: h.length, mediana: q(rs, .5), p10: q(rs, .1), p90: q(rs, .9), caiMetade: rs.filter(r => r <= Math.log(0.5)).length / rs.length, dobra: rs.filter(r => r >= Math.log(2)).length / rs.length,
  pode: h.filter(x => x.sg === 'PODE').map(x => ({ ciclo: x.ciclo, uf: x.uf, s0: x.s0, s1: x.s1 })) };
out.pos = { distritosComNome: rankBest.length, primeiro: rankBest.filter(r => r === 1).length / rankBest.length, ate3: rankBest.filter(r => r <= 3).length / rankBest.length, mediana: q(rankBest, .5) };
fs.writeFileSync(path.join(__dirname, '..', 'resultados', 'extra.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ mapas: { total: out.mapas.total, unidades: out.mapas.unidades, distritos: out.mapas.distritos, desvioMax: out.mapas.desvioMax, compacidade: out.mapas.compacidade, div: out.mapas.municipiosDivididos }, vol: Object.assign({}, out.vol, { pode: out.vol.pode.length }), pos: out.pos }, null, 1));
