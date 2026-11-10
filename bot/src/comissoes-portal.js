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
 * Agenda do dia → eventos: [{ id, orgao, tema, tipo, hora ('14:30'), situacao }].
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
    out.push({ id: Number(id[1]), orgao: pega('g-agenda__categoria'), tema: pega('g-agenda__nome'), tipo: pega('g-agenda__tipo'),
      hora: h ? `${h[1].padStart(2, '0')}:${h[2]}` : '', situacao: pega('g-agenda__situacao') });
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

async function baixar(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!r.ok) throw new Error(`portal da Câmara: HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    throw (e.name === 'AbortError' ? new Error(`portal da Câmara: tempo esgotado (${TIMEOUT_MS / 1000}s)`) : e);
  } finally { clearTimeout(timer); }
}

/** Todos os eventos do dia na agenda do portal (segue a paginação, até 8 páginas). */
async function eventosDoDiaPortal(dataIso) {
  const q = encodeURIComponent(dataIso.split('-').reverse().join('/'));
  let url = `${PORTAL}/agenda?dataInicial__proxy=${q}&dataInicial=${q}&dataFinal__proxy=${q}&dataFinal=${q}`;
  const out = [], vistos = new Set();
  for (let p = 0; p < 8 && url; p++) {
    const html = await baixar(url);
    for (const e of parseAgendaPortal(html)) if (!vistos.has(e.id)) { vistos.add(e.id); out.push(e); }
    const prox = proximaPaginaAgenda(html);
    url = prox && prox !== url ? prox : null;
  }
  return out;
}
/** A pauta de uma reunião pela página dela. */
async function pautaEventoPortal(id) {
  return parseEventoPortal(await baixar(`${PORTAL}/evento-legislativo/${id}`));
}

module.exports = { parseAgendaPortal, proximaPaginaAgenda, parseEventoPortal, parsePessoas, votoNaComissao, siglaNaPagina,
  ehPermanente, ehDeliberativa, eventosDoDiaPortal, pautaEventoPortal, decod };
