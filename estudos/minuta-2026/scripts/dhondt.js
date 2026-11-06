'use strict';
/** Maiores médias (D'Hondt): votos [n] → cadeiras [n]. */
function dhondt(votos, vagas) {
  const s = votos.map(() => 0);
  for (let k = 0; k < vagas; k++) {
    let m = -1, mv = -1;
    for (let i = 0; i < votos.length; i++) { const q = votos[i] / (s[i] + 1); if (q > mv) { mv = q; m = i; } }
    s[m]++;
  }
  return s;
}
/** Menor acréscimo de votos que dá +1 cadeira ao partido i (os outros fixos); e a maior perda que ainda mantém as cadeiras. */
function margens(votos, vagas, i) {
  const s0 = dhondt(votos, vagas)[i];
  const com = dv => { const v = votos.slice(); v[i] = Math.max(0, v[i] + dv); return dhondt(v, vagas)[i]; };
  let lo = 0, hi = Math.max(1, votos.reduce((a, b) => a + b, 0));
  while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (com(m) > s0) hi = m; else lo = m; }
  const ganhar = hi;
  let perder = null;
  if (s0 > 0) { lo = 0; hi = votos[i]; while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (com(-m) < s0) hi = m; else lo = m; } perder = hi; }
  return { cadeiras: s0, paraGanhar: ganhar, paraPerder: perder };
}
module.exports = { dhondt, margens };
