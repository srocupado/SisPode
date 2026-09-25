'use strict';
// Composição da Câmara por legislatura — fonte ÚNICA do número de cadeiras e
// dos quóruns derivados dele. Nada de "257" ou "513" soltos pelo código: na
// virada da 57ª para a 58ª (01/02/2027) a Casa passa de 513 para 531
// deputados (PLP 177/2023), e a maioria absoluta de 257 para 266.
//
// A troca é por DATA (dia em Brasília), não por constante editada à mão: o bot
// fica no ar na virada e passa a usar o número novo sozinho.

// Da mais recente para a mais antiga. `desde` = posse da legislatura.
const COMPOSICAO = [
  { legislatura: 58, desde: '2027-02-01', deputados: 531 },
  { legislatura: 57, desde: '2023-02-01', deputados: 513 },
];

/** "AAAA-MM-DD" do dia em Brasília (o bot pode rodar em servidor UTC). */
function hojeBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

function composicaoEm(dataISO = hojeBrasilia()) {
  const dia = String(dataISO).slice(0, 10);
  return COMPOSICAO.find(c => dia >= c.desde) || COMPOSICAO[COMPOSICAO.length - 1];
}

/** Número de cadeiras da Câmara na data. */
function totalDeputados(dataISO) { return composicaoEm(dataISO).deputados; }

/** Maioria absoluta — quórum de deliberação do Plenário (RICD, art. 183). */
function maioriaAbsoluta(dataISO) { return Math.floor(totalDeputados(dataISO) / 2) + 1; }

module.exports = { COMPOSICAO, hojeBrasilia, composicaoEm, totalDeputados, maioriaAbsoluta };
