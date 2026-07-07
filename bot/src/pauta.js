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

// ---------- Período: a pauta cobre a semana em que estamos? ----------

const MESES_EXT = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const iso = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Hoje em Brasília, como 'YYYY-MM-DD' (comparável por string). */
function hojeBrasilia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/**
 * Interpreta o período da pauta nos formatos conhecidos e devolve
 * { inicio, fim } em 'YYYY-MM-DD', ou null se não reconhecer:
 *  - "29 DE JUNHO A 3 DE JULHO DE 2026" (pauta extensa oficial)
 *  - "02/07/2026" (dashboard compacto — um dia)
 *  - "07 a 11/07/2026" | "29/06 a 03/07/2026"
 */
function parsePeriodo(periodo) {
  const norm = String(periodo || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!norm) return null;

  let m = norm.match(/(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\s+a\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if (m) {
    const mesIni = MESES_EXT[m[2]], mesFim = MESES_EXT[m[5]];
    if (mesIni && mesFim) {
      const anoFim = +m[6], anoIni = m[3] ? +m[3] : anoFim;
      return { inicio: iso(anoIni, mesIni, +m[1]), fim: iso(anoFim, mesFim, +m[4]) };
    }
  }
  m = norm.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) { const d = iso(+m[3], +m[2], +m[1]); return { inicio: d, fim: d }; }

  m = norm.match(/(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{4}))?\s*a\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const anoFim = +m[6], mesFim = +m[5];
    return {
      inicio: iso(m[3] ? +m[3] : anoFim, m[2] ? +m[2] : mesFim, +m[1]),
      fim:    iso(anoFim, mesFim, +m[4]),
    };
  }
  return null;
}

/**
 * Situação do período em relação a hoje (Brasília):
 * 'atual' | 'futura' | 'encerrada' | 'indefinida' (período não interpretado).
 */
function situacaoPeriodo(periodo) {
  const p = parsePeriodo(periodo);
  if (!p) return 'indefinida';
  const hoje = hojeBrasilia();
  if (p.fim < hoje)    return 'encerrada';
  if (p.inicio > hoje) return 'futura';
  return 'atual';
}

function rotuloSituacao(sit, periodo) {
  const p = parsePeriodo(periodo);
  const fimBr = p ? p.fim.split('-').reverse().join('/') : '';
  if (sit === 'atual')     return `🗓 Semana atual${p && p.fim === hojeBrasilia() ? ' (termina hoje)' : ''}`;
  if (sit === 'futura')    return '📅 Próxima semana';
  if (sit === 'encerrada') return `⚠️ Semana JÁ ENCERRADA (terminou em ${fimBr}) — a Câmara ainda não publicou a próxima`;
  return '🗓 Período não identificado no PDF';
}

// ---------- Já foi importada? (compara os ITENS, não o nome) ----------

/**
 * Procura em /pautas uma pauta já importada com (quase) os mesmos itens.
 * A comparação é pelo conjunto de chaves (PL-1234-2026…), porque a mesma
 * semana pode ter sido importada pelo dashboard compacto com outro
 * título/período. >= 70% dos itens em comum = considerada já importada.
 * Retorna { importada, titulo?, id?, iguais?, total? }.
 */
async function verificarJaImportada(parsed) {
  const chavesNovas = new Set(
    (parsed.itens || []).map(it => it.chave || `${it.sigla}-${it.numero}-${it.ano}`));
  if (!chavesNovas.size) return { importada: false };

  let data = null;
  try { data = await fbGet('/pautas'); } catch (_) { return { importada: false }; }
  if (!data) return { importada: false };

  let melhor = null;
  for (const p of Object.values(data)) {
    if (!p || !Array.isArray(p.itens)) continue;
    const chavesDela = new Set(p.itens.map(it => it?.chave).filter(Boolean));
    let iguais = 0;
    for (const c of chavesNovas) if (chavesDela.has(c)) iguais++;
    if (!melhor || iguais > melhor.iguais) {
      melhor = { iguais, titulo: p.nome || p.titulo || p.id, id: p.id };
    }
  }
  if (melhor && melhor.iguais / chavesNovas.size >= 0.7) {
    return { importada: true, ...melhor, total: chavesNovas.size };
  }
  return { importada: false };
}

/**
 * Verifica a pauta publicada no site e devolve o quadro completo:
 * { status: 'nova' | 'sem_mudanca' | 'sem_pauta', pauta?, anterior?,
 *   primeiraChecagem, situacao, jaImportada }.
 * "nova" = período diferente do último visto (atualizações intra-semana
 * não contam — decisão de projeto).
 */
async function verificarPautaNova() {
  const pauta = await baixarPautaAtual();
  if (!pauta) return { status: 'sem_pauta' };

  let anterior = null;
  try { anterior = await fbGet(MONITOR_PATH); } catch (_) { /* primeiro uso/offline */ }

  const idAtual    = pauta.periodo || pauta.hash;
  const idAnterior = anterior ? (anterior.periodo || anterior.hash) : null;

  const situacao    = situacaoPeriodo(pauta.periodo);
  const jaImportada = await verificarJaImportada(pauta);
  const base = { pauta, anterior, primeiraChecagem: !anterior, situacao, jaImportada };

  if (idAtual === idAnterior) return { status: 'sem_mudanca', ...base };

  await fbPut(MONITOR_PATH, {
    periodo:  pauta.periodo || '',
    hash:     pauta.hash,
    titulo:   pauta.titulo || '',
    numItens: pauta.itens.length,
    vistoEm:  new Date().toISOString(),
  });
  return { status: 'nova', ...base };
}

/**
 * Rótulo curto identificando a pauta de referência — para o bot deixar SEMPRE
 * claro sobre qual pauta está falando (o analista pode estar vendo outra pauta
 * aberta no painel; o bot usa sempre a mais recente importada).
 */
function rotuloPauta(pauta) {
  if (!pauta) return '';
  const base = pauta.tipoPauta === 'odd' ? 'Ordem do Dia' : 'Pauta da Semana';
  const per = pauta.periodo || pauta.titulo || pauta.nome || 'período não identificado';
  const imp = String(pauta.uploadedAt || '').slice(0, 10).split('-').reverse().join('/');
  return `${base} — ${per}${imp ? ` · importada em ${imp}` : ''}`;
}

/** Lista TODOS os itens para a mensagem do Telegram (quem envia fatia em blocos de 4096). */
function resumoPauta(pauta) {
  return pauta.itens.map(it => {
    const em = String(it.ementa || '').replace(/\s+/g, ' ').trim();
    const emCurta = em.length > 90 ? em.slice(0, 90) + '…' : em;
    return `• ${it.sigla} ${it.numero}/${it.ano}${it.temUrgencia ? ' ⚡' : ''}${emCurta ? ` — ${emCurta}` : ''}`;
  }).join('\n');
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
function montarPautaFirebase(parsed, uploadedBy, pdfNome = 'pauta_s.pdf') {
  return {
    id:         gerarIdPauta(parsed.periodo, pdfNome),
    titulo:     parsed.titulo || 'Pauta da Semana',
    periodo:    parsed.periodo || '',
    tipoPauta:  parsed.tipoPauta || 'semanal',
    uploadedAt: new Date().toISOString(),
    uploadedBy: uploadedBy || 'bot-telegram',
    pdfNome,
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
  baixarPautaAtual, verificarPautaNova, resumoPauta, rotuloPauta,
  gerarIdPauta, montarPautaFirebase, pautaJaExiste, gravarPauta,
  pautaAtualImportada,
  parsePeriodo, situacaoPeriodo, rotuloSituacao, verificarJaImportada,
};
