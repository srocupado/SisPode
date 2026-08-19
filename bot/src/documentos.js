'use strict';
// Seletor de documentos da tramitação — porte de analise.js
// (listarDocumentosDisponiveis / listarDocsPareceres / listarEmendas /
// buscarRedacaoFinal). No servidor não há CORS: o fetch às páginas da
// Câmara é direto, sem os proxies que a extensão precisa usar.
const { DOMParser } = require('linkedom');

const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';
const BASE_PROP = 'https://www.camara.leg.br/proposicoesWeb/';

// Decretos legislativos aparecem na API sob a sigla antiga PDC ou a atual PDL.
const SIGLAS_EQUIVALENTES = { PDL: ['PDL', 'PDC'], PDC: ['PDC', 'PDL'] };

// A resposta parece a página real da Câmara (e não uma página de erro)?
function _htmlCamaraValido(html) {
  if (!html || html.length < 500) return false;
  return html.includes('proposicoesWeb')
      || html.includes('prop_mostrarintegra')
      || html.includes('filename=')
      || /<!doctype html|<html[\s>]/i.test(html.slice(0, 600));
}

async function fetchHtmlCamara(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const html = r.ok ? await r.text() : '';
    if (r.ok && _htmlCamaraValido(html)) return html;
  } catch (_) { /* cai para o null abaixo */ }
  console.warn('[documentos] não foi possível obter a página da Câmara:', url);
  return null;
}

/** Resolve a proposição na API: { id, urlInteiroTeor } ou null. */
async function resolveProposicao(sigla, numero, ano) {
  const tentativas = SIGLAS_EQUIVALENTES[sigla] || [sigla];
  let hit = null;
  for (const s of tentativas) {
    const r = await fetch(`${API_BASE}/proposicoes?siglaTipo=${encodeURIComponent(s)}&numero=${numero}&ano=${ano}`);
    if (!r.ok) continue;
    hit = ((await r.json()).dados || [])[0];
    if (hit) break;
  }
  if (!hit) return null;
  let urlInteiroTeor = null;
  try {
    const det = await fetch(`${API_BASE}/proposicoes/${hit.id}`);
    if (det.ok) urlInteiroTeor = (await det.json()).dados?.urlInteiroTeor || null;
  } catch (_) {}
  return { id: hit.id, urlInteiroTeor };
}

// Lista todas as linhas do Histórico de Pareceres (não só as operativas).
async function listarDocsPareceres(idProp) {
  const html = await fetchHtmlCamara(`${BASE_PROP}prop_pareceres_substitutivos_votos?idProposicao=${idProp}`);
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 3) continue;
    const m = (tds[0].textContent || '').trim().replace(/\s+/g, ' ')
      .match(/^(SBT-A|PRLP|PRLE|AA|PAR|PRL)\s+(\d+)(?:\s+([A-Za-zÀ-Ú0-9]+))?/i);
    if (!m) continue;
    const a = tr.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
    let href = a ? a.getAttribute('href') : null;
    if (!href || href.startsWith('javascript:')) continue;
    try { href = new URL(href, BASE_PROP).toString(); } catch (_) { continue; }
    let dataBR = null;
    for (const td of tds) { const dm = (td.textContent || '').match(/\b(\d{2}\/\d{2}\/\d{4})\b/); if (dm) { dataBR = dm[1]; break; } }
    const dono = (m[3] || '').toUpperCase();
    const comissao = /^[A-ZÀ-Ú]{2,12}$/.test(dono) && !/^(PL|PLP|PEC|PDL|PDC|MPV|PRC|REQ|MESA)$/.test(dono) ? dono : null;
    const especial = /^(PEC|PLP|PL)\d{3,}$/.test(dono);
    const sigla = m[1].toUpperCase();
    const nome  = sigla === 'AA' ? 'Autógrafo' : sigla;
    const orgao = comissao || (especial ? 'Comissão Especial' : (sigla === 'AA' ? 'Mesa' : 'Plenário'));
    out.push({ rotulo: `${nome} ${m[2]} — ${orgao}${dataBR ? ' · ' + dataBR : ''}`, url: href });
  }
  return out;
}

// Lista todas as emendas (página de emendas, subst=0 e 1).
async function listarEmendas(idProp) {
  const out = [], vistos = new Set();
  for (const subst of [0, 1]) {
    const html = await fetchHtmlCamara(`${BASE_PROP}prop_emendas?idProposicao=${idProp}&subst=${subst}`);
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const tr of doc.querySelectorAll('tr')) {
      const a = tr.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
      if (!a) continue;
      let href = a.getAttribute('href');
      if (!href || href.startsWith('javascript:')) continue;
      try { href = new URL(href, BASE_PROP).toString(); } catch (_) { continue; }
      if (vistos.has(href)) continue; vistos.add(href);
      const fn = (() => { try { return decodeURIComponent(href).replace(/\+/g, ' '); } catch (_) { return href; } })();
      const fnm = (fn.match(/filename=([^&;]+)/i) || [])[1] || '';
      const rowTxt = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      const dataBR = (rowTxt.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) || [])[1] || '';
      let rotulo = (fnm.trim() || rowTxt.slice(0, 50))
        .replace(/\.(pdf|docx?|html?)$/i, '')
        .replace(/\s*=>.*$/, '')
        .trim().slice(0, 70) || 'Emenda';
      out.push({ rotulo: `${rotulo}${dataBR ? ' · ' + dataBR : ''}`, url: href });
    }
  }
  return out;
}

// Documento da Redação Final na ficha de tramitação (caixa "Documentos Anexos").
async function buscarRedacaoFinal(idProp) {
  const html = await fetchHtmlCamara(`https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${idProp}`);
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const a of doc.querySelectorAll('a[href*="prop_mostrarintegra"]')) {
    const href = a.getAttribute('href') || '';
    const decoded = (() => { try { return decodeURIComponent(href); } catch (_) { return href; } })();
    if (!/filename=\s*REDA[ÇC][ÃA]?O\s+FINAL\b/i.test(decoded)) continue;
    if (href.startsWith('javascript:')) continue;
    try { return new URL(href, BASE_PROP).toString(); } catch (_) { continue; }
  }
  return null;
}

/**
 * Agrega os documentos da proposição que NÃO entraram na nota, por fonte —
 * mesma lógica do painel: remove os já usados (set de URLs) e duplicatas.
 * Retorna { Pareceres: [], Emendas: [], Textos: [] }.
 */
async function listarDocumentosDisponiveis({ idProp, urlInteiroTeor, usados = new Set(), incluirRedacaoFinal = false }) {
  const grupos = { Pareceres: [], Emendas: [], Textos: [] };
  if (urlInteiroTeor) grupos.Textos.push({ rotulo: 'Inteiro teor da proposição', url: urlInteiroTeor });
  if (idProp) {
    if (incluirRedacaoFinal) {
      try {
        const rf = await buscarRedacaoFinal(idProp);
        if (rf) grupos.Textos.push({ rotulo: 'Redação Final', url: rf });
      } catch (e) { console.warn('buscarRedacaoFinal:', e.message); }
    }
    try { grupos.Pareceres = await listarDocsPareceres(idProp); } catch (e) { console.warn('listarDocsPareceres:', e.message); }
    try { grupos.Emendas   = await listarEmendas(idProp);       } catch (e) { console.warn('listarEmendas:', e.message); }
  }
  const vistos = new Set();
  for (const k of Object.keys(grupos)) {
    grupos[k] = grupos[k].filter(d => d.url && !usados.has(d.url) && !vistos.has(d.url) && vistos.add(d.url));
  }
  return grupos;
}

module.exports = { resolveProposicao, listarDocumentosDisponiveis, fetchHtmlCamara };
