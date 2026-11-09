'use strict';
// Bases dos estudos 4 (prefeituras 2024 × votação para deputado federal) e 6 (perfil × votação do PODEMOS).
const fs = require('fs'), path = require('path');
const { harmonizar } = require('./partidos.js');
const SP = require('/home/user/SisPode/sistemas-perfil.js');
const T = path.join(__dirname, '..', 'tse'), R = path.join(__dirname, '..', 'resultados');
const ler = n => JSON.parse(fs.readFileSync(path.join(T, n), 'utf8'));
const p18 = ler('partidos-2018.json'), p22 = ler('partidos-2022.json'), p26 = ler('partidos-2026.json'), m24 = ler('municipais-2024.json'), m20 = ler('municipais-2020.json');
// fatias por município, siglas levadas a 2026
const fatias = (x, ano) => { const o = {}; for (const [m, v] of Object.entries(x)) { const t = Object.values(v.f).reduce((a, b) => a + b, 0); const s = {}; for (const [sg, n] of Object.entries(v.f)) { const h = harmonizar(sg, ano, 2026); s[h] = (s[h] || 0) + n; } o[m] = { t, s, uf: v.uf, nome: v.nome }; } return o; };
const F18 = fatias(p18, 2018), F22 = fatias(p22, 2022), F26 = fatias(p26, 2026);
const sh = (F, m, sg) => F[m] && F[m].t ? (F[m].s[sg] || 0) / F[m].t : null;
// ---- estudo 4: a disputa decisiva de 2024 (2º turno se houve)
const linhas = ['mun,uf,lado,partido,margem,y,yPlacebo,votos26,votos22,eleitorado,turno,podeMun'];
let n = 0;
for (const [m, o] of Object.entries(m24)) {
  if (!o.pref.length || !F26[m] || !F22[m]) continue;
  const t2 = o.pref.filter(c => c.turno === 2), dec = (t2.length ? t2 : o.pref.filter(c => c.turno === 1)).slice().sort((a, b) => b.votos - a.votos);
  if (dec.length < 2) continue;
  const [w, r] = dec, pw = harmonizar(w.sg, 2024, 2026), pr = harmonizar(r.sg, 2024, 2026);
  if (pw === pr || !(w.votos + r.votos)) continue;
  const mg = (w.votos - r.votos) / (w.votos + r.votos);
  const tot1 = o.pref.filter(c => c.turno === 1).reduce((a, c) => a + c.votos, 0);
  for (const [lado, sg, s] of [[1, pw, mg], [0, pr, -mg]]) {
    const y = sh(F26, m, sg) - sh(F22, m, sg), yp = F18[m] ? sh(F22, m, sg) - sh(F18, m, sg) : '';
    linhas.push([m, o.uf, lado, sg, s.toFixed(6), y.toFixed(6), yp === '' ? '' : yp.toFixed(6), F26[m].t, F22[m].t, tot1, t2.length ? 2 : 1, (pw === 'PODE' || pr === 'PODE') ? 1 : 0].join(','));
    n++;
  }
}
fs.writeFileSync(path.join(R, 'rd-prefeitos.csv'), linhas.join('\n'));
console.log('estudo 4:', n, 'observações');
// ---- estudo 6: perfil por município × fatia do PODEMOS em 2026 (e em 2022, para controle)
const IND = SP.SP_IND.map(i => i.id);
const out = ['mun,uf,validos26,pode26,pode22,' + IND.join(',') + ',pop,eleitores'];
for (const uf of require('./lib.js').UFS) {
  const doc = JSON.parse(fs.readFileSync(`/home/user/SisPode/sistemas/perfil/perfil-2026-${uf}.json`, 'utf8'));
  const P = SP.spIndice(doc);
  for (const [m, v] of P.mun) {
    if (!F26[m]) continue;
    const vals = IND.map(id => { const x = SP.spValor(P, v, id); return x == null ? '' : x.toFixed(6); });
    out.push([m, uf, F26[m].t, (sh(F26, m, 'PODE') || 0).toFixed(6), F22[m] ? (sh(F22, m, 'PODE') || 0).toFixed(6) : '', ...vals, v[P.i.pop], v[P.i.eleitores]].join(','));
  }
}
fs.writeFileSync(path.join(R, 'perfil-municipios.csv'), out.join('\n'));
console.log('estudo 6:', out.length - 1, 'municípios');
// ---- PODEMOS nas prefeituras de 2024: as disputas (para a lista de oportunidades)
const pode = [];
for (const [m, o] of Object.entries(m24)) {
  const t2 = o.pref.filter(c => c.turno === 2), dec = (t2.length ? t2 : o.pref.filter(c => c.turno === 1)).slice().sort((a, b) => b.votos - a.votos);
  const i = dec.findIndex(c => harmonizar(c.sg, 2024, 2026) === 'PODE');
  if (i < 0 || dec.length < 2) continue;
  const tot = dec.reduce((a, c) => a + c.votos, 0), a = dec[i], b = i === 0 ? dec[1] : dec[0];
  pode.push({ mun: m, uf: o.uf, nome: o.nome, posicao: i + 1, margem: (a.votos - b.votos) / (a.votos + b.votos), pct: a.votos / tot, adversario: harmonizar(b.sg, 2024, 2026), votos26: F26[m] ? F26[m].t : 0,
    vereadores: (o.ver.PODE || {}).eleitos || 0, top3: (o.ver.PODE || {}).top3 || 0, prefeito2020: (() => { const z = m20[m]; if (!z) return null; const e = z.pref.find(c => c.eleito); return e ? harmonizar(e.sg, 2020, 2026) : null; })() });
}
fs.writeFileSync(path.join(R, 'pode-prefeituras-2024.json'), JSON.stringify(pode));
console.log('PODEMOS disputou', pode.length, 'prefeituras; venceu', pode.filter(p => p.posicao === 1).length, '; 2º lugar', pode.filter(p => p.posicao === 2).length);
