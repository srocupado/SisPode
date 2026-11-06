'use strict';
// Estudo 4 (aplicação): as prefeituras de 2028 que mais valem para o candidato de distrito do PODEMOS.
// Valor esperado de uma prefeitura = efeito estimado (RD, por porte; zero acima de 50 mil votos, onde o
// efeito não se distingue de zero) × votos válidos para deputado federal no município (2026).
// Disputas de 2024 com margem de até 10 p.p.: "conquistar" (2º lugar) e "defender" (vitória apertada).
// Cada município vai ao distrito (desenho do simulador) que tem a maior parte dos seus eleitores.
const fs = require('fs'), path = require('path');
const L = require('./lib.js');
const R = path.join(__dirname, '..', 'resultados');
const rd = JSON.parse(fs.readFileSync(path.join(R, 'estudo4.json'), 'utf8'));
const tau = Object.fromEntries(rd.porte.map(p => [p.grupo, p.p < 0.05 ? p.tau : 0]));
const porte = n => n <= 10000 ? 'até 10 mil' : n <= 50000 ? '10 a 50 mil' : 'acima de 50 mil';
const m24 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tse', 'municipais-2024.json'), 'utf8'));
const pref = JSON.parse(fs.readFileSync(path.join(R, 'pode-prefeituras-2024.json'), 'utf8'));
const agg = JSON.parse(fs.readFileSync(path.join(R, 'agregado.json'), 'utf8'));
const lista = [];
for (const p of pref) {
  const e1 = m24[p.mun], eleit = e1 ? e1.pref.filter(c => c.turno === 1).reduce((a, c) => a + c.votos, 0) : 0;
  const t = tau[porte(eleit)] || 0;
  const tipo = p.posicao === 1 ? (p.margem <= 0.10 ? 'defender' : 'manter') : p.posicao === 2 && p.margem >= -0.10 ? 'conquistar' : null;
  if (!tipo) continue;
  lista.push(Object.assign({}, p, { porte: porte(eleit), tau: t, valor: t * p.votos26, tipo }));
}
// distrito de cada município (desenho do simulador) e a situação do PODEMOS nele
for (const uf of L.UFS) {
  const fa = path.join(R, 'ens', uf + '-atrib.json'), fe = path.join(R, 'ens', uf + '.json');
  if (!fs.existsSync(fa)) continue;
  const A = JSON.parse(fs.readFileSync(fa, 'utf8')), E = JSON.parse(fs.readFileSync(fe, 'utf8'));
  const porMun = {};
  A.mun.forEach((m, i) => { const d = A.atrib[0][i]; const o = porMun[m] = porMun[m] || {}; o[d] = (o[d] || 0) + A.aptos[i]; });
  const rank = E.mapas[0].federal.rank, dist = E.mapas[0].federal.distritos;
  for (const it of lista.filter(z => z.uf === uf)) {
    const o = porMun[it.mun]; if (!o) continue;
    const d = +Object.entries(o).sort((a, b) => b[1] - a[1])[0][0], j = dist.findIndex(x => x.id === d), rk = rank[j];
    it.distrito = d;
    if (rk && rk.pode && rk.pode.best) { it.distRank = rk.pode.best[2]; it.distGap = (rk.top[0][2] - rk.pode.best[1]) / rk.validos; it.distNome = rk.pode.best[3]; it.distValidos = rk.validos; }
  }
}
lista.sort((a, b) => b.valor - a.valor);
// por distrito: soma do valor das prefeituras em jogo, contra a distância do PODEMOS ao 1º lugar
const porDist = {};
for (const it of lista.filter(z => z.distrito != null && z.tipo !== 'manter')) {
  const k = it.uf + '-' + it.distrito, o = porDist[k] = porDist[k] || { uf: it.uf, distrito: it.distrito, valor: 0, n: 0, municipios: [], rank: it.distRank, gap: it.distGap, nome: it.distNome, validos: it.distValidos };
  o.valor += it.valor; o.n++; o.municipios.push(it.nome);
}
const dists = Object.values(porDist).map(o => Object.assign(o, { cobreGap: o.validos ? o.valor / (o.gap * o.validos || 1) : null })).sort((a, b) => b.valor - a.valor);
fs.writeFileSync(path.join(R, 'estudo4-oportunidades.json'), JSON.stringify({ tau, municipios: lista, distritos: dists }, null, 1));
console.log('tau por porte', tau, '| disputas:', lista.length, '| conquistar', lista.filter(z => z.tipo === 'conquistar').length, '| defender', lista.filter(z => z.tipo === 'defender').length);
for (const o of dists.slice(0, 15)) console.log(o.uf, 'distrito', o.distrito, 'valor', Math.round(o.valor), 'n', o.n, 'PODE', o.rank + 'º', o.gap != null ? 'a ' + (100 * o.gap).toFixed(1) + ' p.p.' : '', o.nome || '', o.municipios.slice(0, 4).join(', '));
