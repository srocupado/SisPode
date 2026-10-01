'use strict';
// Orçamento · Comparador de Portarias — LEITURA dos atos.
//
// Três entradas, um só formato de saída ({ texto, origem }):
//   - PDF com texto (DOU, site do órgão): pdf.js, página a página, com as
//     linhas recompostas pela posição vertical (o pdf.js entrega pedaços);
//   - Word (.docx): o .docx é um ZIP; lemos word/document.xml com um leitor
//     mínimo de ZIP + DecompressionStream('deflate-raw') do navegador, sem
//     biblioteca nova (a docx.iife.js do projeto ESCREVE Word, não lê);
//   - texto colado ou link do DOU (in.gov.br): o texto do ato fica no bloco
//     .texto-dou da página.
// E o CABEÇALHO de cada ato (tipo, órgão, número, data) é reconhecido por
// regra, sem IA — "PORTARIA INTERMINISTERIAL MPO/MF Nº 1, DE 2 DE JANEIRO DE
// 2025" —, para ordenar a sequência cronológica; o analista corrige o que vier
// errado. Funções puras exportadas para teste em Node no fim do arquivo.

const PT_MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

function ptNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** "10 de março de 2025", "1º de janeiro de 2024" → "2025-03-10". null se não reconhecer. */
function ptData(dia, mes, ano) {
  const m = PT_MESES[ptNorm(mes).trim()];
  const d = parseInt(dia, 10), a = parseInt(ano, 10);
  if (!m || !d || d > 31 || !a) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Tipos de ato reconhecidos no cabeçalho (do mais específico ao mais genérico).
const PT_TIPOS = 'PORTARIA\\s+INTERMINISTERIAL|PORTARIA\\s+CONJUNTA|PORTARIA\\s+NORMATIVA|PORTARIA|INSTRU[ÇC][ÃA]O\\s+NORMATIVA(?:\\s+CONJUNTA)?|RESOLU[ÇC][ÃA]O|DECRETO|NOTA\\s+T[ÉE]CNICA';
const PT_RE_CAB = new RegExp(
  `(${PT_TIPOS})\\s*(?:([A-Z][A-Za-z0-9/.-]*(?:\\s*/\\s*[A-Z][A-Za-z0-9.-]*)*)\\s+)?N(?:[º°ºo]|\\.|\\s*o)?\\.?\\s*([\\d.]+)(?:\\s*/\\s*(\\d{4}))?\\s*,?\\s*DE\\s+(\\d{1,2})\\s*[º°o]?\\s+DE\\s+([A-Za-zÇçÃã]+)\\s+DE\\s+(\\d{4})`,
  'i');

/** Linhas que nomeiam o órgão no alto do ato (ex.: "MINISTÉRIO DA SAÚDE", "GABINETE DO MINISTRO"). */
const PT_RE_ORGAO = /\b(MINIST[ÉE]RIO|SECRETARIA|GABINETE|CASA CIVIL|CONTROLADORIA|ADVOCACIA|AG[ÊE]NCIA|INSTITUTO|FUNDO NACIONAL|PRESID[ÊE]NCIA|TRIBUNAL|CONSELHO|SUPERINTEND[ÊE]NCIA|DEPARTAMENTO|COMISS[ÃA]O)\b/;

/**
 * O cabeçalho de um ato. Pura. Devolve { tipo, sigla, numero, data, orgao,
 * identificacao } — campos ausentes ficam '' (data null). `identificacao` é a
 * linha inteira reconhecida ("PORTARIA SPA/MF Nº 615, DE 11 DE ABRIL DE 2024").
 */
function ptCabecalho(texto) {
  const t = String(texto || '').replace(/ /g, ' ');
  const inicio = t.slice(0, 4000);
  const m = inicio.match(PT_RE_CAB);
  const out = { tipo: '', sigla: '', numero: '', data: null, orgao: '', identificacao: '' };
  if (m) {
    out.tipo = m[1].replace(/\s+/g, ' ').toUpperCase();
    out.sigla = (m[2] || '').replace(/\s+/g, '').toUpperCase();
    out.numero = m[3].replace(/\.$/, '');
    out.data = ptData(m[5], m[6], m[7]);
    out.identificacao = m[0].replace(/\s+/g, ' ').trim();
  }
  // Órgão: linhas em caixa alta, antes do cabeçalho, que nomeiam um órgão.
  const antes = m ? inicio.slice(0, m.index) : inicio.slice(0, 600);
  const linhas = antes.split(/\n/).map(l => l.trim()).filter(Boolean);
  const orgaos = linhas.filter(l => PT_RE_ORGAO.test(l.toUpperCase()) && l === l.toUpperCase() && l.length < 140);
  if (orgaos.length) out.orgao = orgaos.slice(0, 2).join(' / ');
  else if (out.sigla) out.orgao = out.sigla;
  return out;
}

/** Ordem cronológica: data; empate pelo número; sem data vai para o fim. Pura (não muda a lista). */
function ptOrdenar(docs) {
  const num = d => parseFloat(String(d.numero || '').replace(/\./g, '')) || 0;
  return [...(docs || [])].sort((a, b) => {
    if (!a.data && !b.data) return 0;
    if (!a.data) return 1;
    if (!b.data) return -1;
    return a.data.localeCompare(b.data) || num(a) - num(b);
  });
}

// ---------- PDF ----------
/**
 * Texto de um PDF com texto (ArrayBuffer). Recompõe as linhas pela posição
 * vertical de cada pedaço e separa as páginas com "\n\n". PDF só de imagem
 * (escaneado) volta com texto quase vazio — quem chama avisa.
 */
async function ptLerPdf(buffer) {
  if (typeof pdfjsLib === 'undefined') throw new Error('leitor de PDF não carregado');
  try { pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js'); } catch (_) {}
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    paginas.push(ptLinhasDoPdf(tc.items));
  }
  return paginas.join('\n\n');
}

/** Junta os pedaços de texto do pdf.js em linhas (mesmo y ≈ mesma linha). Pura. */
function ptLinhasDoPdf(itens) {
  const linhas = [];
  for (const it of itens || []) {
    if (!it || typeof it.str !== 'string') continue;
    const y = it.transform ? Math.round(it.transform[5]) : 0;
    const x = it.transform ? it.transform[4] : 0;
    let l = linhas.find(q => Math.abs(q.y - y) <= 2);
    if (!l) { l = { y, partes: [] }; linhas.push(l); }
    l.partes.push({ x, s: it.str });
  }
  linhas.sort((a, b) => b.y - a.y);
  return linhas.map(l => l.partes.sort((a, b) => a.x - b.x).map(p => p.s).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean).join('\n');
}

// ---------- Word (.docx) ----------
/** Entradas do ZIP (diretório central): { nome, metodo, comprimido, offsetLocal }. Pura sobre o ArrayBuffer. */
function ptZipEntradas(buffer) {
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('arquivo não é um .docx válido');
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out = [];
  for (let k = 0; k < total; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const comprimido = dv.getUint32(p + 20, true);
    const nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true);
    const offsetLocal = dv.getUint32(p + 42, true);
    const nome = dec.decode(new Uint8Array(buffer, p + 46, nLen));
    out.push({ nome, metodo, comprimido, offsetLocal });
    p += 46 + nLen + xLen + cLen;
  }
  return out;
}

/** Conteúdo (Uint8Array) de uma entrada do ZIP. Deflate pelo DecompressionStream do navegador (ou zlib no Node). */
async function ptZipConteudo(buffer, e) {
  const dv = new DataView(buffer);
  const ini = e.offsetLocal + 30 + dv.getUint16(e.offsetLocal + 26, true) + dv.getUint16(e.offsetLocal + 28, true);
  const bruto = new Uint8Array(buffer, ini, e.comprimido);
  if (e.metodo === 0) return bruto;
  if (e.metodo !== 8) throw new Error('compressão não suportada no .docx');
  if (typeof DecompressionStream !== 'undefined') {
    const fluxo = new Blob([bruto]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }
  return new Uint8Array(require('zlib').inflateRawSync(Buffer.from(bruto)));   // Node (testes)
}

/** Texto do word/document.xml: um parágrafo por linha; tabulação e quebra preservadas. Pura. */
function ptTextoDocxXml(xml) {
  const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const paras = String(xml || '').split(/<\/w:p>/);
  const linhas = [];
  for (const p of paras) {
    let t = '';
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    let m;
    while ((m = re.exec(p))) {
      if (m[1] !== undefined) t += ent(m[1]);
      else if (m[0] === '<w:tab/>') t += '\t';
      else t += '\n';
    }
    linhas.push(t);
  }
  return linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function ptLerDocx(buffer) {
  const e = ptZipEntradas(buffer).find(x => x.nome === 'word/document.xml');
  if (!e) throw new Error('o arquivo não tem o corpo de um documento Word (.docx)');
  const xml = new TextDecoder('utf-8').decode(await ptZipConteudo(buffer, e));
  return ptTextoDocxXml(xml);
}

// ---------- DOU ----------
/** É um endereço de ato do DOU (in.gov.br)? */
function ptEhLinkDou(url) {
  return /^https:\/\/(www\.)?in\.gov\.br\//i.test(String(url || '').trim());
}

/**
 * Texto do ato numa página do DOU (HTML). Pura sobre o HTML + um DOMParser.
 * O ato fica em .texto-dou; o órgão, em .orgao-dou-data (quando há).
 */
function ptTextoDouHtml(html, Parser) {
  const P = Parser || (typeof DOMParser !== 'undefined' ? DOMParser : null);
  if (!P) throw new Error('sem DOMParser');
  const doc = new P().parseFromString(String(html || ''), 'text/html');
  const bloco = doc.querySelector('.texto-dou');
  if (!bloco) return { texto: '', orgao: '' };
  const linhas = [...bloco.querySelectorAll('p')].map(p => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const orgaoEl = doc.querySelector('.orgao-dou-data');
  return { texto: (linhas.length ? linhas.join('\n') : bloco.textContent).trim(), orgao: orgaoEl ? orgaoEl.textContent.replace(/\s+/g, ' ').trim() : '' };
}

async function ptLerDou(url) {
  if (!ptEhLinkDou(url)) throw new Error('o endereço não é do Diário Oficial da União (in.gov.br)');
  const r = await fetch(url.trim());
  if (!r.ok) throw new Error('o DOU respondeu HTTP ' + r.status);
  const { texto, orgao } = ptTextoDouHtml(await r.text());
  if (!texto) throw new Error('não achei o texto do ato nessa página do DOU — copie e cole o texto');
  return { texto, orgao };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ptNorm, ptData, ptCabecalho, ptOrdenar, ptLinhasDoPdf, ptZipEntradas, ptZipConteudo, ptTextoDocxXml, ptLerDocx, ptEhLinkDou, ptTextoDouHtml };
}
