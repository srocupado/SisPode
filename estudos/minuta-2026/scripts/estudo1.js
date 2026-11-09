'use strict';
// Estudo 1 — A cota do PODEMOS na Minuta e a próxima cadeira, estado a estado (deputado federal).
//  · cota: maiores médias (D'Hondt) sobre nominais + legenda de cada agremiação, sem cláusula (a Minuta simulada);
//  · margens: votos a mais para a próxima cadeira e votos que se podem perder sem cair (os outros fixos);
//  · frequência histórica: entre os pares partido–UF de 2018→2022 e 2022→2026 (siglas harmonizadas)
//    de tamanho parecido, em quantos a votação cresceu (ou caiu) ao menos o necessário — com intervalo de Wilson.
const fs = require('fs'), path = require('path');
const L = require('./lib.js'), H = require('./dhondt.js'), V = require('./volatilidade.js');
const hist = V.razoes({ minimo: 0.005 });
const faixas = [[0, 0.03], [0.03, 0.08], [0.08, 0.15], [0.15, 1]];
const wilson = (k, n, z = 1.96) => { if (!n) return [0, 1]; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - m), Math.min(1, c + m)]; };
const out = { ufs: [], historico: { pares: hist.length } };
for (const uf of L.UFS) {
  const x = L.carregar(uf); if (!x) continue;
  const agrs = x.d.agrs.filter(a => a.votos > 0), votos = agrs.map(a => a.votos), tot = votos.reduce((s, v) => s + v, 0);
  const i = agrs.findIndex(a => a.siglas.includes('PODE')), pode = i >= 0 ? agrs[i] : null;
  const real = x.d.agrs.filter(a => a.siglas.includes('PODE')).reduce((s, a) => s + (a.vagasReal || 0), 0);
  const o = { uf, vagas: x.d.vagas, votos: pode ? pode.votos : 0, fatia: pode ? pode.votos / tot : 0, real, temLista: !!pode && pode.votos > 0 };
  if (pode) {
    const m = H.margens(votos, x.d.vagas, i);
    const s = pode.votos / tot, fx = faixas.find(([a, b]) => s >= a && s < b) || faixas[0];
    const par = hist.filter(h => h.s0 >= fx[0] && h.s0 < fx[1]);
    const subir = Math.log(1 + m.paraGanhar / pode.votos), cair = m.paraPerder != null ? Math.log(Math.max(1e-6, 1 - m.paraPerder / pode.votos)) : null;
    const kS = par.filter(h => h.r >= subir).length, kC = cair != null ? par.filter(h => h.r <= cair).length : 0;
    Object.assign(o, { cota: m.cadeiras, paraGanhar: m.paraGanhar, paraPerder: m.paraPerder, paraGanharPct: m.paraGanhar / pode.votos, paraPerderPct: m.paraPerder != null ? m.paraPerder / pode.votos : null,
      hist: { n: par.length, faixa: fx, fGanha: kS / (par.length || 1), icGanha: wilson(kS, par.length), fPerde: cair != null ? kC / par.length : 0, icPerde: cair != null ? wilson(kC, par.length) : [0, 0] } });
  } else o.cota = 0;
  out.ufs.push(o);
}
out.nacional = { real: out.ufs.reduce((s, o) => s + o.real, 0), cota: out.ufs.reduce((s, o) => s + o.cota, 0), votos: out.ufs.reduce((s, o) => s + o.votos, 0) };
fs.writeFileSync(path.join(__dirname, '..', 'resultados', 'estudo1.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.nacional));
for (const o of out.ufs.filter(o => o.temLista).sort((a, b) => a.paraGanharPct - b.paraGanharPct)) console.log(o.uf, o.vagas, (100 * o.fatia).toFixed(1) + '%', 'real', o.real, 'cota', o.cota, '+1 com', o.paraGanhar, '(' + (100 * o.paraGanharPct).toFixed(0) + '%)', 'folga', o.paraPerder, o.paraPerderPct != null ? '(' + (100 * o.paraPerderPct).toFixed(0) + '%)' : '', 'hist ganha', (100 * o.hist.fGanha).toFixed(0) + '%', 'perde', (100 * o.hist.fPerde).toFixed(0) + '%', 'n', o.hist.n);
