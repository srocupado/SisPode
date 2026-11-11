'use strict';
// Pauta de COMISSÕES pelo PORTAL da Câmara — o caminho de reserva de comissoes.js
// quando a API de Dados Abertos está fora do ar.
//
// 10/11/2026: a API inteira em HTTP 503 (deputados, eventos, órgãos, pauta,
// autores) e o /varrercomissoes respondia só "Erro na varredura". O portal
// seguia no ar e traz o mesmo dado oficial:
//   · a AGENDA do dia (camara.leg.br/agenda) — cada evento com o órgão, o tipo
//     ("Reunião Deliberativa"), a hora e a situação; o id é o dos Dados Abertos;
//   · a PÁGINA DA REUNIÃO (camara.leg.br/evento-legislativo/{id}) — os itens da
//     pauta com a ementa, o autor e o relator JÁ COM O PARTIDO ("Silvia Waiãpi
//     (PL-AP)") e os pareceres das comissões ("Parecer do Relator, Dep. …, pela
//     aprovação, com substitutivo.").
// Por isso o caminho pelo portal não precisa nem da lista de deputados nem da
// de autores de cada proposição. Sem LLM: é leitura de HTML, e o que a página
// não traz fica de fora (nunca inventa).

const PORTAL = 'https://www.camara.leg.br';
const TIMEOUT_MS = 20000;
const UA = { 'User-Agent': 'SisPode-Bot/1.0', Accept: 'text/html' };

function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ', ccedil: 'ç', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Agrave: 'À', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç' };
/** Entidades HTML → texto (as nomeadas do português e as numéricas). */
function decod(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (ENT[n] != null ? ENT[n] : m));
}
/** Trecho de HTML → texto corrido. */
const texto = h => decod(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Agenda (um dia ou um intervalo) → eventos: [{ id, orgao, tema, tipo, hora ('14:30'), situacao, data ('2026-11-10') }].
 * Um <li class="g-agenda__evento"> por evento; o órgão vem em g-agenda__categoria.
 */
function parseAgendaPortal(html) {
  const out = [];
  for (const li of String(html || '').split('<li class="g-agenda__evento"').slice(1)) {
    const bloco = li.split('</li>')[0];
    const pega = cls => { const m = new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</(?:span|a)>`).exec(bloco); return m ? texto(m[1]) : ''; };
    const id = /evento-legislativo\/(\d+)/.exec(bloco);
    if (!id) continue;
    const h = /(\d{1,2})h(\d{2})/.exec(pega('g-agenda__hora'));
    const d = /(\d{2})\/(\d{2})\/(\d{4})/.exec(pega('g-agenda__data'));
    out.push({ id: Number(id[1]), orgao: pega('g-agenda__categoria'), tema: pega('g-agenda__nome'), tipo: pega('g-agenda__tipo'),
      hora: h ? `${h[1].padStart(2, '0')}:${h[2]}` : '', situacao: pega('g-agenda__situacao'), data: d ? `${d[3]}-${d[2]}-${d[1]}` : '' });
  }
  return out;
}
/** O endereço da próxima página da agenda (null na última: o botão vem com "disabled"). */
function proximaPaginaAgenda(html) {
  const m = /<li class="pagination-list__nav pagination-list__nav--next(?![^"]*disabled)[^"]*">\s*<a href="([^"]+)"/.exec(String(html || ''));
  return m ? decod(m[1]) : null;
}

/** "Fulano (PT-SP), Beltrana (PL-RJ)" → [['Fulano', 'PT'], ['Beltrana', 'PL']]; sem partido (Senado, Executivo) → [[texto, '']]. */
function parsePessoas(s) {
  const out = [];
  const re = /([^,;()]+?)\s*\(([^()]*?)-([A-Z]{2})\)/g;
  let m;
  while ((m = re.exec(s))) out.push([m[1].replace(/^\s*(?:e|,)\s+/i, '').trim(), m[2].trim()]);
  return out.length ? out : (s.trim() ? [[s.trim(), '']] : []);
}

/**
 * Página da reunião → { orgao, itens }. Cada item (<li class="l-pauta__item">):
 *   { id, titulo ('PL 4212/2024', 'REQ 100/2026 CPOVOS'), sigla, numero, ano, ementa, resultado,
 *     autores: [[nome, partido]], relator, relPartido, pareceres: [{ comissao, sigla, data, texto }] }.
 * Vale para "Propostas previstas" (antes), "analisadas" e "não analisadas" (depois da reunião).
 */
function parseEventoPortal(html) {
  const h = String(html || '');
  const itens = [];
  for (const li of h.split('<li class="l-pauta__item">').slice(1)) {
    const a = /class="item-pauta__proposicao"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/p>/.exec(li);
    if (!a) continue;
    const titulo = texto(a[1]);
    const t = /^([A-Za-zÀ-ú]+)\s+([\d.]+)\/(\d{4})/.exec(titulo);
    const id = /idProposicao(?:=|&#x3D;)(\d+)/.exec(li);
    const campo = rot => { const m = new RegExp(`<strong>\\s*${rot}:?\\s*</strong>([\\s\\S]*?)</li>`, 'i').exec(li); return m ? texto(m[1]) : ''; };
    const rel = parsePessoas(campo('Relator(?:a|es|as)?'))[0] || null;
    const pareceres = li.split('class="item-parecer"').slice(1).map(p => {
      const pg = cls => { const m = new RegExp(`class="${cls}[^"]*"[^>]*>([\\s\\S]*?)</div>`).exec(p); return m ? texto(m[1]) : ''; };
      const tit = pg('item-parecer__titulo'), sg = /\(([A-Z0-9]+)\)\s*$/.exec(tit);
      return { comissao: tit.replace(/\s*\([A-Z0-9]+\)\s*$/, ''), sigla: sg ? sg[1] : '', data: pg('item-parecer__data'), texto: pg('item-parecer__descricao') };
    });
    const res = /class="texto-link"[^>]*>([\s\S]*?)<\/span>/.exec(li);
    itens.push({ id: id ? Number(id[1]) : null, titulo, sigla: t ? t[1].toUpperCase() : '', numero: t ? t[2].replace(/\./g, '') : '', ano: t ? t[3] : '',
      ementa: texto(a[2]).replace(/^-\s*/, ''), resultado: res ? texto(res[1]) : '',
      autores: parsePessoas(campo('Autor(?:a|es|as)?')), relator: rel ? rel[0] : null, relPartido: rel ? rel[1] : '', pareceres });
  }
  return { itens };
}

/** O voto do relator NESTA comissão: o parecer mais recente dela, do "pela…/pelo…" em diante. */
function votoNaComissao(item, orgaoNome) {
  const alvo = norm(orgaoNome);
  const p = (item.pareceres || []).find(x => norm(x.comissao) === alvo && /^parecer\b/i.test(x.texto));
  const m = p && /\bpel[ao]\s+.+/i.exec(p.texto);
  return m ? m[0].replace(/[.\s]+$/, '') : '';
}
/** A sigla da comissão, lida da própria página (título dos pareceres dela ou dos requerimentos: "REQ 100/2026 CPOVOS"). */
function siglaNaPagina(ev, orgaoNome) {
  const alvo = norm(orgaoNome);
  for (const it of ev.itens) for (const p of it.pareceres || []) if (p.sigla && norm(p.comissao) === alvo) return p.sigla;
  for (const it of ev.itens) { const m = /^REQ\s+[\d.]+\/\d{4}\s+([A-Z0-9]{2,})$/.exec(it.titulo); if (m) return m[1]; }
  return '';
}

// Comissão PERMANENTE pelo nome (a agenda não traz o tipo do órgão): "Comissão de/da/do…",
// fora as especiais, externas, mistas e de inquérito.
const ehPermanente = nome => /^comiss[ãa]o\s+d[aeo]s?\s/i.test(nome || '') && !/\b(especial|externa|mista|inqu[ée]rito|representativa)\b/i.test(nome);
const ehDeliberativa = tipo => norm(tipo).includes('deliberativ');

// RITMO das chamadas ao portal. 10/11/2026: com a API fora, a varredura abriu
// as páginas de ~20 reuniões em paralelo (5 de cada vez) e o portal respondeu
// HTTP 429 (pedidos demais) a 15 delas. Agora:
//   · os pedidos ao portal vão UM DE CADA VEZ (um só em voo), com um intervalo
//     entre o fim de um e o início do seguinte — vale para todo o bot que passa
//     por aqui: varredura, pauta de comissão, convocação do Plenário;
//   · 429 (e 503) espera e tenta de novo — o tempo do Retry-After, se o portal
//     mandar (até um teto), senão 3 s, 8 s, 15 s — e a espera vale para a FILA
//     inteira, não só para quem levou o 429;
//   · depois de um 429 o intervalo entre pedidos DOBRA (de 1,5 s até 4 s) e volta
//     aos poucos a cada resposta boa: um pedido por vez ainda levou 13 respostas
//     429 numa varredura de 20 comissões (medido em 10/11/2026: o portal aguenta
//     umas 15 páginas por minuto);
//   · página baixada fica guardada por 10 min: repetir a varredura, ou pedir a
//     pauta de uma comissão logo depois, só baixa o que faltou;
//   · `ate` (prazo, em ms desde a época): pedido que só sairia depois dele, ou
//     espera de 429 que passaria dele, desiste na hora — quem chama (a
//     varredura) tem um teto de tempo total e lista o que ficou de fora.
//     10/11/2026: sem teto, a varredura levou 5 min numa rede com mais 429.
const RITMO = { intervaloMs: 300, intervaloPos429Ms: 1500, intervaloMaxMs: 4000, esperasMs: [3000, 8000, 15000], tetoRetryAfterMs: 20000, cacheMs: 10 * 60e3 };
let _fila = Promise.resolve(), _livreEm = 0, _vez = 0, _intervalo = RITMO.intervaloMs;
const _cache = new Map();   // url → { texto, em }
const dormir = ms => new Promise(r => setTimeout(r, ms));
/** Roda `fn` na fila do portal: um pedido em voo por vez, com o intervalo e a espera pós-429 antes dele. */
function naFila(fn) {
  const minha = _fila.then(async () => {
    const espera = _livreEm - Date.now();
    if (espera > 0) await dormir(espera);
    _vez++;
    try { return await fn(); }
    finally { _livreEm = Math.max(_livreEm, Date.now() + _intervalo); }
  });
  _fila = minha.then(() => {}, () => {});
  return minha;
}
function retryAfterMs(r) {
  const v = r.headers && typeof r.headers.get === 'function' ? r.headers.get('retry-after') : null;
  if (!v) return null;
  const s = Number(v);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(v) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, RITMO.tetoRetryAfterMs) : null;
}

/** Um GET ao portal → { status, texto, retryAfter }. */
async function umPedido(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    return { status: r.status, ok: r.ok, retryAfter: retryAfterMs(r), texto: r.ok ? await r.text() : '' };
  } catch (e) {
    throw (e.name === 'AbortError' ? new Error(`portal da Câmara: tempo esgotado (${TIMEOUT_MS / 1000}s)`) : e);
  } finally { clearTimeout(timer); }
}

/** GET de uma página do portal, na fila. `fresco`: ignora a página guardada (quem precisa ver a mudança na hora). */
const SEM_TEMPO = 'portal da Câmara lento (limite de pedidos): passou do tempo da consulta';
async function baixar(url, { fresco = false, ate = null } = {}) {
  const c = _cache.get(url);
  if (!fresco && c && Date.now() - c.em < RITMO.cacheMs) return c.texto;
  for (let t = 0; ; t++) {
    if (ate && Math.max(Date.now(), _livreEm) > ate) throw new Error(SEM_TEMPO);
    const r = await naFila(() => {
      if (ate && Date.now() > ate) throw new Error(SEM_TEMPO);   // a vez chegou tarde demais
      return umPedido(url);
    });
    if (r.ok) {
      _intervalo = Math.max(RITMO.intervaloMs, Math.round(_intervalo * 0.85));
      _cache.set(url, { texto: r.texto, em: Date.now() });
      if (_cache.size > 200) _cache.delete(_cache.keys().next().value);
      return r.texto;
    }
    if (r.status === 429) _intervalo = Math.min(RITMO.intervaloMaxMs, Math.max(_intervalo * 2, RITMO.intervaloPos429Ms));
    if ((r.status === 429 || r.status === 503) && t < RITMO.esperasMs.length) {
      // a FILA inteira espera (o próximo pedido, de quem for, só sai depois)
      _livreEm = Math.max(_livreEm, Date.now() + (r.retryAfter ?? RITMO.esperasMs[t]));
      if (ate && _livreEm > ate) throw new Error(SEM_TEMPO);
      continue;
    }
    throw new Error(`portal da Câmara: HTTP ${r.status}${r.status === 429 ? ' (pedidos demais, mesmo depois de esperar)' : ''}`);
  }
}

/**
 * Eventos da agenda do portal num intervalo (datas ISO; `categoria` opcional, ex.: 'Plenário').
 * Segue a PAGINAÇÃO (até 8 páginas): a leitura só da 1ª página perdia a sessão que
 * caísse na 2ª numa semana cheia (revisão de 11/11/2026) — é o caminho único da
 * agenda para a varredura, a convocação e a Ordem do Dia.
 */
async function agendaPortal({ de, ate = de, categoria = '' }, opts) {
  const br = iso => encodeURIComponent(iso.split('-').reverse().join('/'));
  let url = `${PORTAL}/agenda?dataInicial__proxy=${br(de)}&dataInicial=${br(de)}&dataFinal__proxy=${br(ate)}&dataFinal=${br(ate)}`
    + (categoria ? `&categorias=${encodeURIComponent(categoria)}` : '');
  const out = [], vistos = new Set(), urls = new Set();
  for (let p = 0; p < 8 && url && !urls.has(url); p++) {
    urls.add(url);
    const html = await baixar(url, opts);
    for (const e of parseAgendaPortal(html)) if (!vistos.has(e.id)) { vistos.add(e.id); out.push(e); }
    const prox = proximaPaginaAgenda(html);
    url = prox ? new URL(prox, url).toString() : null;   // o link da próxima página pode vir relativo
  }
  return out;
}
/** Todos os eventos do dia na agenda do portal. */
const eventosDoDiaPortal = (dataIso, opts) => agendaPortal({ de: dataIso }, opts);

// A proposição CITADA numa ementa — o projeto alvo de um requerimento de urgência ou de
// um recurso. Um leitor só, para a convocação e a Ordem do Dia (antes eram dois, e o da
// convocação não lia "PL nº 5072 de 2026" nem PDL/PEC por extenso). Formas reais:
//   "Projeto de Lei nº 2.167, de 2026" · "PL nº 5072 de 2026" · "PLP nº 226/2025"
//   "Projeto de Decreto Legislativo nº 123, de 2026" · "Proposta de Emenda à Constituição nº 3/2024"
const POR_EXTENSO = [
  [/Projeto\s+de\s+Lei\s+Complementar/gi, 'PLP'], [/Projeto\s+de\s+Lei\s+de\s+Convers[ãa]o/gi, 'PLV'], [/Projeto\s+de\s+Lei/gi, 'PL'],
  [/Proposta\s+de\s+Emenda\s+[àa]\s+Constitui[çc][ãa]o/gi, 'PEC'], [/Projeto\s+de\s+Decreto\s+Legislativo/gi, 'PDL'],
  [/Medida\s+Provis[óo]ria/gi, 'MPV'], [/Projeto\s+de\s+Resolu[çc][ãa]o/gi, 'PRC'],
];
function proposicaoCitada(texto) {
  let t = String(texto || '');
  for (const [re, sigla] of POR_EXTENSO) t = t.replace(re, sigla);
  const m = /\b(PLP|PLV|PLN|PEC|PDL|PDC|MPV|PRC|PL)\s*n?[º°o.]*\s*([\d.]+)\s*(?:\/|,?\s*de\s+)\s*(\d{4})\b/i.exec(t);
  return m ? { sigla: m[1].toUpperCase() === 'PDC' ? 'PDL' : m[1].toUpperCase(), numero: m[2].replace(/\./g, ''), ano: m[3], ementa: '' } : null;
}
/** A pauta de uma reunião pela página dela. */
async function pautaEventoPortal(id, opts) {
  return parseEventoPortal(await baixar(`${PORTAL}/evento-legislativo/${id}`, opts));
}

module.exports = { parseAgendaPortal, proximaPaginaAgenda, parseEventoPortal, parsePessoas, votoNaComissao, siglaNaPagina,
  ehPermanente, ehDeliberativa, eventosDoDiaPortal, agendaPortal, proposicaoCitada, pautaEventoPortal, decod, baixar,
  RITMO, SEM_TEMPO, pedidosFeitos: () => _vez, limparCache: () => { _cache.clear(); _intervalo = RITMO.intervaloMs; } };   // RITMO e o contador: para o teste encurtar os tempos e contar
