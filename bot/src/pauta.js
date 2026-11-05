'use strict';
const crypto = require('crypto');
const { PAUTA_URL } = require('./config');
const { fbGet, fbQuery, fbPut } = require('./firebase');
const { parsearPauta, extrairTextoPdf } = require('./parser');
const { detectarLacunasPauta, recuperarLacunasPauta } = require('../../pauta-parser.js');
const { chamarIAtexto } = require('./ia');

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
  return { ...parsed, hash, texto };
}

// ---------- Lacunas da pauta (mesmo detector e recuperação da extensão) ----------
const API_CAMARA = 'https://dadosabertos.camara.leg.br/api/v2';
const SIGLAS_EQUIV = { PDL: ['PDL', 'PDC'], PDC: ['PDC', 'PDL'] };
async function getTimeout(url, ms = 20000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal }); } finally { clearTimeout(t); }
}
/** A proposição existe na Câmara? API de Dados Abertos; fora do ar, o webservice do portal. */
async function confirmarProposicaoCamara(ref) {
  for (const s of SIGLAS_EQUIV[ref.sigla] || [ref.sigla]) {
    try {
      const r = await getTimeout(`${API_CAMARA}/proposicoes?siglaTipo=${encodeURIComponent(s)}&numero=${ref.numero}&ano=${ref.ano}&itens=1`);
      if (r.ok && ((await r.json()).dados || []).length) return true;
    } catch (_) { /* tenta o portal */ }
    try {   // busca do portal (busca-api): no ar quando API e SitCamaraWS caem
      const r = await fetch('https://www.camara.leg.br/busca-api/api/v1/busca/proposicoes/_search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ order: 'relevancia', pagina: 1, q: `siglaProposicao:${s} AND numero:${parseInt(ref.numero, 10)} AND ano:${ref.ano}` }) });
      if (r.ok && (((await r.json()).hits || {}).hits || []).some(h => Number(h._source?.numero) === Number(ref.numero) && Number(h._source?.ano) === Number(ref.ano))) return true;
    } catch (_) { /* tenta o webservice */ }
    try {
      const r = await getTimeout(`https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterProposicao?tipo=${encodeURIComponent(s)}&numero=${ref.numero}&ano=${ref.ano}`);
      if (r.ok && /<idProposicao>\d+/.test(await r.text())) return true;
    } catch (_) { /* próxima sigla */ }
  }
  return false;
}

/**
 * Detecta itens que o parser não reconheceu e tenta recuperá-los pela IA do
 * perfil (o de quem importa). Acrescenta os recuperados em parsed.itens e
 * grava o registro em parsed.lacunas — a extensão mostra o aviso a partir dele.
 */
async function recuperarLacunasBot(texto, parsed, perfil) {
  const lac = detectarLacunasPauta(texto, parsed.itens);
  if (!lac.faltando.length) return null;
  const r = perfil?.apiKey
    ? await recuperarLacunasPauta(lac, {
        chamarIA: prompt => chamarIAtexto({ provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo, prompt, maxTokens: 6000 }),
        confirmar: confirmarProposicaoCamara,
      })
    : { recuperados: [], pendentes: lac.faltando.map(n => ({ ordem: n, motivo: 'sem chave de IA configurada para recuperar', lido: null })) };
  const chaves = new Set(parsed.itens.map(i => i.chave || `${i.sigla}-${i.numero}-${i.ano}`));
  const novos = r.recuperados.filter(i => !chaves.has(i.chave || `${i.sigla}-${i.numero}-${i.ano}`));
  for (const i of r.recuperados) if (!novos.includes(i)) r.pendentes.push({ ordem: i.ordem, motivo: 'a IA leu uma proposição que já está em outro item', lido: `${i.sigla} ${i.numero}/${i.ano}` });
  parsed.itens.push(...novos);
  parsed.itens.sort((a, b) => (a.ordem ?? Infinity) - (b.ordem ?? Infinity));
  parsed.lacunas = {
    faltando: lac.faltando,
    recuperados: novos.map(i => i.ordem),
    pendentes: r.pendentes.sort((a, b) => a.ordem - b.ordem),
    diagnosticos: lac.diagnosticos,
    em: new Date().toISOString(),
  };
  return parsed.lacunas;
}

/** Linha para a mensagem do bot sobre as lacunas ('' se não houve). */
function textoLacunas(L) {
  if (!L) return '';
  const out = [];
  if (L.recuperados.length) out.push(`🤖 Item(ns) ${L.recuperados.join(', ')} não reconhecido(s) pelo leitor — lido(s) pela IA e confirmado(s) na Câmara. Confira no painel.`);
  for (const p of L.pendentes) out.push(`⚠️ Item ${p.ordem} NÃO entrou: ${p.motivo}${p.lido ? ` (a IA leu ${p.lido})` : ''}. Adicione pelo painel.`);
  // Por que o leitor não leu — título publicado e desvio do padrão.
  for (const n of L.faltando) {
    const d = L.diagnosticos && L.diagnosticos[n];
    if (d) out.push(`   • Item ${n} publicado como "${d.titulo.slice(0, 120)}" — ${d.motivo}.`);
  }
  return out.length ? '\n' + out.join('\n') : '';
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
 *  - "29 DE JUNHO A 3 DE JULHO DE 2026" (pauta extensa oficial, meses distintos)
 *  - "13 A 17 DE JULHO DE 2026" (mesmo mês, citado uma vez)
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
  // "13 a 17 de julho de 2026" — os dois dias no MESMO mês, citado uma vez.
  m = norm.match(/(\d{1,2})\s+a\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if (m) {
    const mes = MESES_EXT[m[3]];
    if (mes) return { inicio: iso(+m[4], mes, +m[1]), fim: iso(+m[4], mes, +m[2]) };
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
 * Identidade da pauta para o MONITOR — o que responde "é a mesma de antes?".
 *
 * Era só o período, e isso escondia a 2ª sessão do dia: em 02/09/2026 houve
 * duas sessões deliberativas, ambas com período "02/09/2026", e a segunda
 * (7 itens) seria classificada como "sem_mudanca" contra a primeira (1 item) —
 * o bot ficaria calado sobre uma pauta inteira.
 *
 * O ordinal e a hora do cabeçalho entram na chave. NÃO se usa o hash do texto:
 * ele muda a cada republicação do mesmo PDF, e a decisão de projeto é que
 * atualização intra-semana da MESMA pauta não vira anúncio. O hash segue como
 * identidade de reserva quando o parser não acha o período.
 */
function chaveMonitor(p) {
  if (!p) return null;
  if (!p.periodo) return p.hash || null;
  const s = p.sessao || {};
  const marca = [s.ordinal ? `${s.ordinal}a` : '', s.hora || ''].filter(Boolean).join('-');
  return marca ? `${p.periodo}|${marca}` : p.periodo;
}

/**
 * Verifica a pauta publicada no site e devolve o quadro completo:
 * { status: 'nova' | 'sem_mudanca' | 'sem_pauta', pauta?, anterior?,
 *   primeiraChecagem, situacao, jaImportada }.
 * "nova" = período/sessão diferente do último visto (atualizações intra-semana
 * da mesma pauta não contam — decisão de projeto).
 */
async function verificarPautaNova() {
  const pauta = await baixarPautaAtual();
  if (!pauta) return { status: 'sem_pauta' };

  let anterior = null;
  try { anterior = await fbGet(MONITOR_PATH); } catch (_) { /* primeiro uso/offline */ }

  const idAtual    = chaveMonitor(pauta);
  const idAnterior = chaveMonitor(anterior);

  const situacao    = situacaoPeriodo(pauta.periodo);
  const jaImportada = await verificarJaImportada(pauta);
  const base = { pauta, anterior, primeiraChecagem: !anterior, situacao, jaImportada };

  if (idAtual === idAnterior) return { status: 'sem_mudanca', ...base };

  await fbPut(MONITOR_PATH, {
    periodo:  pauta.periodo || '',
    sessao:   pauta.sessao || null,   // sem isto a chave anterior não se remonta
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
 *
 * A sessão entra no rótulo: com duas pautas no mesmo dia, "Pauta da Semana —
 * 02/09/2026" nas duas deixaria o analista sem saber de qual o bot fala.
 */
function rotuloPauta(pauta) {
  if (!pauta) return '';
  const base = pauta.tipoPauta === 'odd' ? 'Ordem do Dia' : 'Pauta da Semana';
  const per = pauta.periodo || pauta.titulo || pauta.nome || 'período não identificado';
  const ses = pauta.sessao?.rotulo ? ` · ${pauta.sessao.rotulo}` : '';
  const imp = String(pauta.uploadedAt || '').slice(0, 10).split('-').reverse().join('/');
  return `${base} — ${per}${ses}${imp ? ` · importada em ${imp}` : ''}`;
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
// que bot e painel apontem para o MESMO documento no Firebase. O sufixo da
// sessão precisa existir aqui também — sem ele o bot importaria a 2ª sessão do
// dia POR CIMA da primeira, que é o defeito que o painel deixou de ter.
function gerarIdPauta(periodo, fileName, sessao) {
  const semId = (periodo || fileName || 'pauta').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const ord = Number(sessao && sessao.ordinal);
  const sufixo = Number.isFinite(ord) && ord > 1 ? `-${ord}a-sessao` : '';
  return (semId || 'pauta-' + Date.now()) + sufixo;
}

/**
 * Monta o documento no schema exato de fbSalvarPauta (analise.js): itens
 * enxutos, sem campos transientes (enriquecimento/analise) — a extensão os
 * repõe ao carregar.
 */
function montarPautaFirebase(parsed, uploadedBy, pdfNome = 'pauta_s.pdf') {
  return {
    id:         gerarIdPauta(parsed.periodo, pdfNome, parsed.sessao),
    titulo:     parsed.titulo || 'Pauta da Semana',
    periodo:    parsed.periodo || '',
    sessao:     parsed.sessao || null,
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
      origemIA:          it.origemIA || null,
      chave:             it.chave || `${it.sigla}-${it.numero}-${it.ano}`,
    })),
    ...(parsed.lacunas ? { lacunas: parsed.lacunas } : {}),
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

// ---------- Trabalho da equipe: análises já geradas para os itens ----------
// /analises_pauta/{chave} é onde o painel grava as notas — a presença da chave
// é o sinal objetivo de que a equipe JÁ COMEÇOU a trabalhar naquele item.
async function chavesComAnalise() {
  try {
    const r = await fbQuery('/analises_pauta', '?shallow=true');
    return new Set(Object.keys(r || {}));
  } catch (_) { return new Set(); }
}

/** Quantos itens da pauta já têm análise pronta no painel. */
function contarAnalisesDaPauta(pauta, chaves) {
  return (pauta.itens || []).filter(it => {
    const ch = it.chave || `${it.sigla}-${it.numero}-${it.ano}`;
    return chaves.has(ch) || chaves.has(encodeURIComponent(ch));
  }).length;
}

/** As N pautas mais recentes já importadas no SisPode (ordenadas por uploadedAt desc). */
async function ultimasPautas(n = 3) {
  let data;
  try {
    data = await fbQuery('/pautas', `?orderBy="uploadedAt"&limitToLast=${n}`);
  } catch (_) {
    data = await fbGet('/pautas');   // sem índice: baixa tudo e ordena aqui
  }
  if (!data) return [];
  const pautas = Object.values(data).filter(p => p && Array.isArray(p.itens) && p.itens.length);
  pautas.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  return pautas.slice(0, n);
}

/** Uma pauta específica pelo id (nó /pautas/{id}). */
async function pautaPorId(id) {
  try { return await fbGet(`/pautas/${encodeURIComponent(id)}`); }
  catch (_) { return null; }
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
  recuperarLacunasBot, textoLacunas, confirmarProposicaoCamara,
  pautaAtualImportada, ultimasPautas, pautaPorId,
  chavesComAnalise, contarAnalisesDaPauta,
  parsePeriodo, situacaoPeriodo, rotuloSituacao, verificarJaImportada,
  chaveMonitor,
};
