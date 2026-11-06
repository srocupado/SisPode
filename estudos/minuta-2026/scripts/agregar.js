'use strict';
// Agrega os resultados dos mapas (resultados/ens/UF.json) nos estudos 1 (robustez da bancada ao mapa),
// 2 (candidatos de distrito), 3 (Assembleias) e 5 (federação). Limiares declarados antes de olhar os dados:
//  · distrito "vence": o melhor nome do PODEMOS é o 1º; "ao alcance": 2º a até 5 p.p. do 1º;
//  · "votos em risco": o PODEMOS tem ≥ 5% dos votos do distrito e o seu melhor nome reúne menos da metade
//    dos votos nominais do partido ali (os demais votos dependem de migrar para o candidato do distrito);
//  · "vazio": o PODEMOS tem < 2% dos votos do distrito.
const fs = require('fs'), path = require('path');
const L = require('./lib.js');
const E = path.join(__dirname, '..', 'resultados', 'ens');
const q = (v, p) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };
const media = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
const est1 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resultados', 'estudo1.json'), 'utf8'));
const out = { ufs: [], federacao: {}, nacional: {} };
const nacMapas = [];   // por índice de mapa: soma nacional (mapa i de cada UF) — os mapas de UFs diferentes são independentes
for (const uf of L.UFS) {
  const f = path.join(E, uf + '.json'); if (!fs.existsSync(f)) continue;
  const o = JSON.parse(fs.readFileSync(f, 'utf8'));
  const e1 = est1.ufs.find(z => z.uf === uf) || {};
  const R = { uf, k: o.k, mapas: o.M, cota: e1.cota || 0, real: e1.real || 0, fatia: e1.fatia || 0 };
  const cad = [], vence = [], alcance = [], risco = [], vazio = [], votosRisco = [], podeNom = [], est = [], estDist = [], estAlc = [];
  const melhores = {};   // nome → nº de mapas em que é o candidato do PODEMOS mais bem colocado em algum distrito (1º ou ao alcance)
  o.mapas.forEach((m, i) => {
    const F = m.federal;
    cad.push(F.porPartido.PODE || 0);
    let v = 0, a = 0, r = 0, z = 0, vr = 0, pn = 0;
    F.rank.forEach(d => {
      const p = d.pode; if (!p) { z++; return; }
      const sh = p.total / (d.validos || 1);
      if (sh < 0.02) z++;
      pn += p.nominal;
      if (p.best) {
        vr += p.nominal - p.best[1];
        const gap = (d.top[0][2] - p.best[1]) / (d.validos || 1);
        if (p.best[2] === 1) { v++; melhores[p.best[3]] = (melhores[p.best[3]] || 0) + 1; }
        else if (p.best[2] === 2 && gap <= 0.05) { a++; melhores[p.best[3]] = (melhores[p.best[3]] || 0) + 1; }
        if (sh >= 0.05 && p.best[1] < 0.5 * p.nominal) r++;
      }
    });
    vence.push(v); alcance.push(a); risco.push(r); vazio.push(z); votosRisco.push(vr); podeNom.push(pn);
    if (m.estadual) {
      est.push(m.estadual.porPartido.PODE || 0);
      let ed = 0, ea = 0;
      m.estadual.rank.forEach((d, j) => {
        const c = (m.estadual.distritos[j] || {}).cadeiras || 1, p = d.pode;
        if (!p || !p.best) return;
        if (p.best[2] <= c) ed++;
        else { const corte = (d.top[c - 1] || [0, 0, 0])[2]; if ((corte - p.best[1]) / (d.validos || 1) <= 0.02) ea++; }
      });
      estDist.push(ed); estAlc.push(ea);
    }
    nacMapas[i] = nacMapas[i] || { cad: 0, est: 0, vence: 0, alcance: 0 };
    nacMapas[i].cad += cad[i]; nacMapas[i].est += est[i] || 0; nacMapas[i].vence += v; nacMapas[i].alcance += a;
    if (m.federacao) for (const [p, pp] of Object.entries(m.federacao)) {
      const g = out.federacao[p] = out.federacao[p] || { porUf: {} };
      const u = g.porUf[uf] = g.porUf[uf] || { pode: [], soma: [], base: [], baseSoma: [] };
      u.pode.push(pp.PODE || 0); u.soma.push((pp.PODE || 0) + (pp[p] || 0)); u.base.push(F.porPartido.PODE || 0); u.baseSoma.push((F.porPartido.PODE || 0) + (F.porPartido[p] || 0));
    }
  });
  const res = v => ({ simulador: v[0], media: media(v), min: Math.min(...v), max: Math.max(...v), p05: q(v, .05), p95: q(v, .95) });
  Object.assign(R, { cadeiras: res(cad), vence: res(vence), alcance: res(alcance), risco: res(risco), vazio: res(vazio),
    votosRisco: res(votosRisco), podeNominal: res(podeNom), fracRisco: media(votosRisco.map((x, i) => podeNom[i] ? x / podeNom[i] : 0)),
    perdeExcedente: cad.filter(c => c < R.cota).length / cad.length,
    estadual: est.length ? { cadeiras: res(est), distritoElege: res(estDist), alcance: res(estAlc) } : null,
    nomes: Object.entries(melhores).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => ({ nome: n, freq: k / o.M })) });
  out.ufs.push(R);
}
for (const [p, g] of Object.entries(out.federacao)) {
  let dPode = 0, dSoma = 0; const porUf = [];
  for (const [uf, u] of Object.entries(g.porUf)) { const a = media(u.pode) - media(u.base), b = media(u.soma) - media(u.baseSoma); dPode += a; dSoma += b; if (a || b) porUf.push({ uf, dPode: a, dSoma: b }); }
  g.dPode = dPode; g.dSoma = dSoma; g.ufs = porUf.sort((x, y) => y.dPode - x.dPode); delete g.porUf;
}
const nm = nacMapas.filter(Boolean);
out.nacional = { cadeiras: { simulador: nm[0] && nm[0].cad, media: media(nm.map(x => x.cad)), min: Math.min(...nm.map(x => x.cad)), max: Math.max(...nm.map(x => x.cad)) },
  estaduais: { media: media(nm.map(x => x.est)), min: Math.min(...nm.map(x => x.est)), max: Math.max(...nm.map(x => x.est)) },
  vence: { media: media(nm.map(x => x.vence)), min: Math.min(...nm.map(x => x.vence)), max: Math.max(...nm.map(x => x.vence)) },
  alcance: { media: media(nm.map(x => x.alcance)), min: Math.min(...nm.map(x => x.alcance)), max: Math.max(...nm.map(x => x.alcance)) },
  ufs: out.ufs.length };
fs.writeFileSync(path.join(__dirname, '..', 'resultados', 'agregado.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.nacional));
for (const R of out.ufs) console.log(R.uf, 'k', R.k, 'mapas', R.mapas, 'cad', R.cadeiras.simulador, `[${R.cadeiras.min}-${R.cadeiras.max}]`, 'cota', R.cota, 'vence', R.vence.media.toFixed(1), 'alcance', R.alcance.media.toFixed(1), 'risco', R.risco.media.toFixed(1), 'vazio', R.vazio.media.toFixed(1), 'votos em risco', (100 * R.fracRisco).toFixed(0) + '%', R.estadual ? 'est ' + R.estadual.cadeiras.media.toFixed(1) + ' elege-dist ' + R.estadual.distritoElege.media.toFixed(1) : '', R.nomes.slice(0, 3).map(n => n.nome + ' ' + n.freq.toFixed(2)).join('; '));
for (const [p, g] of Object.entries(out.federacao).sort((a, b) => b[1].dPode - a[1].dPode)) console.log('fed', p, 'ΔPODE', g.dPode.toFixed(1), 'Δsoma', g.dSoma.toFixed(1));
