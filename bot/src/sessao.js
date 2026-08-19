'use strict';
// Pauta ATIVA por usuário — a escolhida no /sispode. Enquanto vigorar, todos os
// comandos que dependem de "a pauta" (/perguntar, /listar, /analisar, /exportar)
// usam ELA em vez da mais recente por uploadedAt. Sem escolha (ou expirada),
// cai no padrão: a última importada. Estado em memória (reinício volta ao padrão).
const { pautaPorId, pautaAtualImportada } = require('./pauta');

const PAUTA_ATIVA_TTL = 12 * 60 * 60e3;   // 12 h — cobre um dia de trabalho
const _ativa = new Map();                 // userId → { id, ts }

function definirPautaAtiva(userId, id) { _ativa.set(String(userId), { id, ts: Date.now() }); }
function limparPautaAtiva(userId)       { _ativa.delete(String(userId)); }

function pautaAtivaId(userId) {
  const s = _ativa.get(String(userId));
  if (s && Date.now() - s.ts < PAUTA_ATIVA_TTL) return s.id;
  _ativa.delete(String(userId));
  return null;
}

/** A pauta que o usuário está usando: a fixada no /sispode, ou a mais recente. */
async function pautaDoUsuario(userId) {
  const id = pautaAtivaId(userId);
  if (id) {
    const p = await pautaPorId(id);
    if (p) return p;
    limparPautaAtiva(userId);   // foi removida do Firebase — volta ao padrão
  }
  return pautaAtualImportada();
}

module.exports = { definirPautaAtiva, limparPautaAtiva, pautaAtivaId, pautaDoUsuario };
