'use strict';
// Linhagem dos partidos (fusões e incorporações registradas no TSE), para comparar eleições:
// a sigla de um ano → a sigla sucessora no ano seguinte.
const SUCESSOR = {
  2018: { PSL: 'UNIÃO', DEM: 'UNIÃO', PR: 'PL', PRB: 'REPUBLICANOS', PPS: 'CIDADANIA', PHS: 'PODE', PRP: 'PATRIOTA', PATRI: 'PATRIOTA', PPL: 'PC do B', PTC: 'AGIR' },
  2022: { PSC: 'PODE', PTB: 'PRD', PATRIOTA: 'PRD', PROS: 'SOLIDARIEDADE', 'PC do B': 'PCDOB', PMN: 'MOBILIZA' },
  // municipais: 2020 → 2024 (mesmas fusões de 2022–2024)
  2020: { PSL: 'UNIÃO', DEM: 'UNIÃO', PSC: 'PODE', PTB: 'PRD', PATRIOTA: 'PRD', PROS: 'SOLIDARIEDADE', 'PC do B': 'PCDOB', PMN: 'MOBILIZA', PTC: 'AGIR' },
  2024: {},
};
/** Leva uma sigla do ano `de` até o ano `ate` (2018→2022→2026; 2020→2024→2026). */
function harmonizar(sg, de, ate) {
  const passos = de === 2018 ? [2018, 2022] : de === 2022 ? [2022] : de === 2020 ? [2020, 2024] : de === 2024 ? [2024] : [];
  for (const a of passos) { if (a >= ate) break; sg = (SUCESSOR[a] || {})[sg] || sg; }
  // grafias que mudaram sem fusão
  if (ate >= 2026 && sg === 'PC do B') sg = 'PCDOB';
  return sg;
}
module.exports = { SUCESSOR, harmonizar };
