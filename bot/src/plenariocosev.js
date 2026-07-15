'use strict';
// Fonte AO VIVO do Plenário pelas APIs PÚBLICAS que o próprio app Infoleg usa
// (sistema cosev / ws-plenario). Descoberto na engenharia reversa do APK do app.
// Sem autenticação, sem navegador, sem push: é o mesmo backend que alimenta a
// tela ao vivo do app. Aqui usamos SÓ os endpoints de LEITURA públicos — os
// autenticados do app (registrar voto/presença) NÃO são tocados (é o ato
// pessoal do parlamentar).
//
// Endpoints (GET, JSON, público — validados 12/07):
//   PRESENCA → { numPresentesSessao, indOrdemDoDiaIniciada, indOrdemDoDiaEncerrada, ... }
//              → é a fonte confiável das FASES da ODD (início e ENCERRAMENTO).
//   SESSAO   → status da sessão ("Não há sessão aberta no momento" quando fechada;
//              objeto com número/tipo quando aberta).
//   ITENS    → itens em votação agora (tipoVotacao NOMINAL/"S"=simbólica;
//              dataInicioVotacao/dataFimVotacao → aberta = tem início e não tem fim).

const PRESENCA = 'https://infoleg.camara.leg.br/ws-plenario/presenca';
const SESSAO   = 'https://cosev-api-prod.camara.leg.br/parlamentar/sessao-atual';
const ITENS    = 'https://cosev-api-prod.camara.leg.br/parlamentar/votacao/itens-em-votacao-na-sessao';

async function getJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const txt = await r.text();
    if (!txt) return null;                       // corpo vazio (ex.: sem sessão)
    try { return JSON.parse(txt); } catch { return null; }
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/**
 * Fases do Plenário pelo painel de presença ao vivo.
 * @returns {Promise<{presentes:number, oddIniciada:boolean, oddEncerrada:boolean}|null>}
 */
async function statusPlenario() {
  const p = await getJson(PRESENCA);
  if (!p || typeof p !== 'object') return null;
  return {
    presentes: Number(p.numPresentesSessao) || 0,
    oddIniciada: p.indOrdemDoDiaIniciada === true,
    oddEncerrada: p.indOrdemDoDiaEncerrada === true,
  };
}

/**
 * Sessão atual. Forma REAL confirmada ao vivo (sessão extraordinária 143,
 * 14/07/2026): a resposta vem num ENVELOPE —
 *   { servico:"sessao-atual", resultado:0, mensagem:"Solicitação processada…",
 *     sessaoAtual:{ numSessao:143, nomSessao:"EXTRAORDINÁRIA Nº 143 - 14/07/2026",
 *                   coCasa:1, sqSessao:33166, datInicio:"2026-07-14 11:55:00",
 *                   mensagemPainel:"" } }
 * Sem sessão: corpo vazio (ou envelope sem sessaoAtual).
 * @returns {Promise<{aberta:boolean, numSessao?, nome?, tipo?, inicio?, casa?, deliberativa?, raw?}|null>}
 */
async function sessaoAtual() {
  const s = await getJson(SESSAO);
  if (!s || typeof s !== 'object') return null;
  const n = s.sessaoAtual || null;
  if (!n) return { aberta: false };
  const nome = n.nomSessao || '';
  // VOTAÇÃO EM CURSO: quando o painel abre uma votação, a resposta ganha um
  // irmão "votacaoAtual" (descoberto ao vivo em 15/07):
  //   { tipo:"Votacao", idVotacao:13846, tituloVotacao:"REQ Nº 3803/2026 -
  //     URGÊNCIA PARA APRECIAÇÃO DO PL Nº 3.381/2015", tipoVotacao:"S" }
  // tipoVotacao "S" = simbólica (o valor da nominal será calibrado ao vivo).
  // O campo SOME quando a votação encerra. idVotacao = mesmo id do portal.
  const v = s.votacaoAtual || null;
  return {
    aberta: true,
    numSessao: n.numSessao ?? null,
    nome,
    tipo: nome,
    inicio: n.datInicio || null,
    casa: n.coCasa ?? null,          // 1 = Câmara
    // Sessões do painel são deliberativas por natureza; a exceção são as
    // solenes/homenagens — o nome as denuncia. ("EXTRAORDINÁRIA" É deliberativa;
    // o regex antigo por "deliberativ" dava falso negativo.)
    deliberativa: !/solene|homenagem|comemorativ/i.test(nome),
    votacao: v ? {
      id: v.idVotacao ?? null,
      titulo: String(v.tituloVotacao || '').replace(/\s+/g, ' ').trim(),
      tipoVotacao: v.tipoVotacao || '',
      simbolica: String(v.tipoVotacao || '').toUpperCase() === 'S',
    } : null,
    raw: n,
  };
}

/**
 * Itens em votação AGORA.
 * @returns {Promise<Array<{descricao,tipoVotacao,nominal,inicio,fim,aberta,raw}>>}
 */
async function itensEmVotacao() {
  const d = await getJson(ITENS);
  const arr = Array.isArray(d) ? d : (d?.itens || d?.dados || []);
  return (arr || []).map(it => ({
    descricao: it.descricaoProposicao || it.descricao || '',
    tipoVotacao: it.tipoVotacao || '',
    nominal: /nominal/i.test(String(it.tipoVotacao || '')),
    inicio: it.dataInicioVotacao || null,
    fim: it.dataFimVotacao || null,
    aberta: !!it.dataInicioVotacao && !it.dataFimVotacao,
    raw: it,
  }));
}

module.exports = { statusPlenario, sessaoAtual, itensEmVotacao, PRESENCA, SESSAO, ITENS };
