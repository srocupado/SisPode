'use strict';
const crypto = require('crypto');
const { PAUTA_URL } = require('./config');
const { fbGet, fbQuery, fbPut } = require('./firebase');
const { parsearPauta, extrairTextoPdf } = require('./parser');

const MONITOR_PATH = '/bot/pauta_monitor';

/**
 * Baixa e parseia a Pauta da Semana oficial.
 * Retorna null se não houver pauta publicada (404) — comum fora das
 * semanas de sessão.
 */
async function baixarPautaAtual() {
  const res = await fetch(PAUTA_URL, { redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar o PDF da pauta`);

  const buf    = new Uint8Array(await res.arrayBuffer());
  const texto  = await extrairTextoPdf(buf);
  const parsed = parsearPauta(texto);

  // Identidade de reserva: quando o parser não acha o período (formato novo
  // do PDF), o hash do texto evita re-anunciar a mesma pauta a cada tick.
  const hash = crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);
  return { ...parsed, hash };
}

/**
 * Verifica se há pauta de semana NOVA (período diferente do último visto).
 * Atualizações dentro da MESMA semana não contam — decisão de projeto.
 * Retorna { status: 'nova' | 'sem_mudanca' | 'sem_pauta', pauta?, anterior? }.
 */
async function verificarPautaNova() {
  const pauta = await baixarPautaAtual();
  if (!pauta) return { status: 'sem_pauta' };

  let anterior = null;
  try { anterior = await fbGet(MONITOR_PATH); } catch (_) { /* primeiro uso/offline */ }

  const idAtual    = pauta.periodo || pauta.hash;
  const idAnterior = anterior ? (anterior.periodo || anterior.hash) : null;

  if (idAtual === idAnterior) return { status: 'sem_mudanca', pauta, anterior };

  await fbPut(MONITOR_PATH, {
    periodo:  pauta.periodo || '',
    hash:     pauta.hash,
    titulo:   pauta.titulo || '',
    numItens: pauta.itens.length,
    vistoEm:  new Date().toISOString(),
  });
  return { status: 'nova', pauta, anterior };
}

/** Resumo dos primeiros itens para a mensagem do Telegram. */
function resumoPauta(pauta, max = 8) {
  const linhas = pauta.itens.slice(0, max).map(it => {
    const em = String(it.ementa || '').replace(/\s+/g, ' ').trim();
    const emCurta = em.length > 80 ? em.slice(0, 80) + '…' : em;
    return `• ${it.sigla} ${it.numero}/${it.ano}${emCurta ? ` — ${emCurta}` : ''}`;
  });
  const resto = pauta.itens.length > max
    ? `\n… e mais ${pauta.itens.length - max} itens.` : '';
  return linhas.join('\n') + resto;
}

// ============================================================
//  FASE 2 — importação para o SisPode (/pautas/{id})
// ============================================================

// Portado de analise.js (gerarIdPauta): mesma regra de id da extensão, para
// que bot e painel apontem para o MESMO documento no Firebase.
function gerarIdPauta(periodo, fileName) {
  const semId = (periodo || fileName || 'pauta').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return semId || 'pauta-' + Date.now();
}

/**
 * Monta o documento no schema exato de fbSalvarPauta (analise.js): itens
 * enxutos, sem campos transientes (enriquecimento/analise) — a extensão os
 * repõe ao carregar.
 */
function montarPautaFirebase(parsed, uploadedBy) {
  return {
    id:         gerarIdPauta(parsed.periodo, 'pauta_s.pdf'),
    titulo:     parsed.titulo || 'Pauta da Semana',
    periodo:    parsed.periodo || '',
    uploadedAt: new Date().toISOString(),
    uploadedBy: uploadedBy || 'bot-telegram',
    pdfNome:    'pauta_s.pdf',
    itens: parsed.itens.map((it, i) => ({
      ordem:             it.ordem ?? (i + 1),
      tipoCategoria:     it.tipoCategoria || 'projeto',
      sigla:             it.sigla,
      numero:            it.numero,
      ano:               it.ano,
      ementa:            it.ementa || '',
      autorTexto:        it.autorTexto || '',
      apensadosTexto:    it.apensadosTexto || null,
      relator:           it.relator || null,
      temUrgencia:       !!it.temUrgencia,
      projetoUrgenciado: it.projetoUrgenciado || null,
      chave:             it.chave || `${it.sigla}-${it.numero}-${it.ano}`,
    })),
  };
}

/** A pauta já existe no Firebase? (pode ter edições da equipe) */
async function pautaJaExiste(id) {
  try {
    const r = await fbQuery(`/pautas/${encodeURIComponent(id)}`, '?shallow=true');
    return r !== null;
  } catch (_) {
    return false; // na dúvida, não bloqueia — o PUT falharia à parte
  }
}

/** Grava a pauta (sobrescrevendo se existir — chamar após a confirmação). */
async function gravarPauta(pautaDoc) {
  await fbPut(`/pautas/${encodeURIComponent(pautaDoc.id)}`, pautaDoc);
  return pautaDoc.id;
}

/** Pauta mais recente já importada no SisPode. */
async function pautaAtualImportada() {
  let data;
  try {
    // Query indexada (rápida) — exige ".indexOn": "uploadedAt" nas regras do RTDB
    data = await fbQuery('/pautas', '?orderBy="uploadedAt"&limitToLast=1');
  } catch (_) {
    // Sem índice o RTDB devolve 400 — cai para o GET completo e escolhe a
    // mais recente aqui (mesma situação da extensão, que baixa tudo na sidebar)
    data = await fbGet('/pautas');
  }
  if (!data) return null;
  const pautas = Object.values(data).filter(p => p && Array.isArray(p.itens) && p.itens.length);
  if (!pautas.length) return null;
  pautas.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  return pautas[0];
}

module.exports = {
  baixarPautaAtual, verificarPautaNova, resumoPauta,
  gerarIdPauta, montarPautaFirebase, pautaJaExiste, gravarPauta,
  pautaAtualImportada,
};
