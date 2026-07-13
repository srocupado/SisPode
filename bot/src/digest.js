'use strict';
// /digest — radar legislativo de imprensa.
//
// Coleta as matérias publicadas pelo programa (Fantástico/g1, fonte TEXTUAL —
// sem vídeo/transcrição), resume os temas com IA e avalia a RELEVÂNCIA
// LEGISLATIVA de cada um (PL, requerimento de informação, CPI, audiência
// pública, indicação…), sugerindo ações para os parlamentares do partido.
// Sob demanda, elabora a MINUTA da proposição em PDF — sempre marcada como
// rascunho de IA para revisão da Consultoria Legislativa.
//
// Entrega: /digest sob demanda (qualquer autorizado pelo admin na lista de
// assinantes) + envio automático toda SEGUNDA 7h (Brasília) aos assinantes.
// A análise roda na chave de IA do solicitante (cron: chave do admin).

const fs = require('fs');
const path = require('path');
const { DADOS_DIR } = require('./config');
const { chamarIAtexto, extrairJson } = require('./ia');

// ---------- fontes ----------
// Multi-fonte por desenho. Dois tipos:
//   'g1'  — páginas do g1; matérias têm a data no caminho /noticia/AAAA/MM/DD/
//   'rss' — feed RSS com <pubDate> por item (corpo: página do item, com
//           fallback para a <description> do feed)
// `max` limita quantas matérias cada fonte contribui (orçamento do prompt).
const regexG1 = slug => new RegExp(
  `href="(https://g1\\.globo\\.com/${slug.replace(/\//g, '\\/')}/noticia/(\\d{4})/(\\d{2})/(\\d{2})/[^"]+)"`, 'g');

const FONTES = [
  {
    id: 'fantastico', nome: 'Fantástico', tipo: 'g1', max: 8,
    paginas: [
      'https://g1.globo.com/fantastico/',
      'https://g1.globo.com/fantastico/index/feed/pagina-2.ghtml',
      'https://g1.globo.com/fantastico/index/feed/pagina-3.ghtml',
    ],
    regexMateria: regexG1('fantastico'),
  },
  {
    id: 'jn', nome: 'Jornal Nacional', tipo: 'g1', max: 8,
    paginas: [
      'https://g1.globo.com/jornal-nacional/',
      'https://g1.globo.com/jornal-nacional/index/feed/pagina-2.ghtml',
    ],
    regexMateria: regexG1('jornal-nacional'),
  },
  {
    id: 'pr', nome: 'Profissão Repórter', tipo: 'g1', max: 4,
    paginas: ['https://g1.globo.com/profissao-reporter/'],
    regexMateria: regexG1('profissao-reporter'),
  },
  {
    id: 'gr', nome: 'Globo Rural', tipo: 'g1', max: 4,
    paginas: ['https://g1.globo.com/economia/agronegocios/globo-rural/'],
    regexMateria: regexG1('economia/agronegocios/globo-rural'),
  },
  {
    id: 'ab', nome: 'Agência Brasil', tipo: 'rss', max: 10,
    rss: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
  },
];

const MAX_MATERIAS   = 30;      // teto global de matérias por digest
const MAX_CHARS_MAT  = 3000;    // corpo de cada matéria enviado à IA
const CACHE_TTL_MS   = 6 * 60 * 60 * 1000;   // reuso do digest por 6h

// ---------- persistência local (bot/dados/, fora do git) ----------
function carregarJson(nome, padrao) {
  try { return JSON.parse(fs.readFileSync(path.join(DADOS_DIR, nome), 'utf8')); }
  catch (_) { return padrao; }
}
function gravarJson(nome, obj) {
  fs.mkdirSync(DADOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DADOS_DIR, nome), JSON.stringify(obj, null, 2));
}

// ---------- assinantes (lista gerida pelo admin) ----------
const ARQ_ASSINANTES = 'digest-assinantes.json';
function listarAssinantes() {
  return carregarJson(ARQ_ASSINANTES, {});   // { userId: { nome, desde } }
}
function assinar(userId, nome) {
  const a = listarAssinantes();
  a[String(userId)] = { nome: nome || '', desde: new Date().toISOString() };
  gravarJson(ARQ_ASSINANTES, a);
}
function desassinar(userId) {
  const a = listarAssinantes();
  delete a[String(userId)];
  gravarJson(ARQ_ASSINANTES, a);
}
function ehAssinante(userId) {
  return !!listarAssinantes()[String(userId)];
}

// ---------- coleta ----------
async function fetchTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    });
  } finally { clearTimeout(timer); }
}

// O WAF da Globo (Akamai) às vezes barra o fetch do Node (403 por fingerprint
// TLS) mesmo com headers de navegador. Fallback: buscar a página num Chromium
// real (puppeteer, já dependência do bot). A sessão é criada sob demanda na
// coleta e fechada ao final.
function novaSessaoChromium() {
  let browser = null, page = null;
  return {
    async html(url) {
      if (!browser) {
        const puppeteer = require('puppeteer');
        const args = [];
        if (process.platform === 'linux') args.push('--no-sandbox', '--disable-setuid-sandbox');
        browser = await puppeteer.launch({
          headless: true, args,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });
        page = await browser.newPage();
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return await page.content();
    },
    async fechar() { if (browser) await browser.close().catch(() => {}); browser = page = null; },
  };
}

/** Baixa o HTML de uma URL: fetch primeiro; Chromium se o WAF barrar. */
async function htmlDe(url, sessao) {
  try {
    const r = await fetchTimeout(url);
    if (r.ok) {
      const html = await r.text();
      if (html.length > 5000) return html;      // resposta real (403/WAF vem curtinho)
    }
  } catch (_) { /* cai para o Chromium */ }
  return await sessao.html(url);
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
}

/** Lista as matérias de uma fonte g1 publicadas nos últimos `dias`. */
async function listarMaterias(fonte, dias, sessao) {
  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const urls = new Map();   // url → dataISO
  for (const pagina of fonte.paginas) {
    try {
      const html = await htmlDe(pagina, sessao);
      for (const m of html.matchAll(fonte.regexMateria)) {
        const [, url, ano, mes, dia] = m;
        const data = new Date(`${ano}-${mes}-${dia}T12:00:00-03:00`);
        if (data >= corte && !urls.has(url)) urls.set(url, `${ano}-${mes}-${dia}`);
      }
    } catch (e) { console.warn(`[digest] página falhou (${pagina}):`, e.message); }
  }
  return [...urls.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, fonte.max || MAX_MATERIAS)
    .map(([url, data]) => ({ url, data }));
}

/** Lista itens de um feed RSS dos últimos `dias`: [{url, data, titulo, descricao}]. */
async function listarRss(fonte, dias, sessao) {
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const xml = await htmlDe(fonte.rss, sessao);
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const bloco = m[1];
    const pega = tag => {
      const x = bloco.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return x ? decodeEntities(x[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).trim() : '';
    };
    const url = pega('link'), titulo = pega('title'), descricao = pega('description');
    const quando = Date.parse(pega('pubDate'));
    if (!url || !Number.isFinite(quando) || quando < corte) continue;
    out.push({ url, titulo, descricao, data: new Date(quando).toISOString().slice(0, 10), quando });
  }
  return out.sort((a, b) => b.quando - a.quando).slice(0, fonte.max || MAX_MATERIAS);
}

/** Extrai o corpo de uma matéria da Agência Brasil: parágrafos "reais" da página. */
function extrairMateriaAB(html) {
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(p => decodeEntities(p[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 100 && !t.includes('-->') && !/^A\+\s/.test(t));
  return ps.join('\n').slice(0, MAX_CHARS_MAT);
}

/** Extrai título + corpo (texto puro) do HTML de uma matéria do g1. */
function extrairMateria(html) {
  const tit = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const titulo = decodeEntities((tit ? tit[1] : '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const paras = [...html.matchAll(/<p[^>]*class="content-text__container"[^>]*>([\s\S]*?)<\/p>/g)]
    .map(p => decodeEntities(p[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const corpo = paras.join('\n').slice(0, MAX_CHARS_MAT);
  if (!titulo && !corpo) throw new Error('matéria sem texto reconhecível');
  return { titulo, corpo };
}

/** Coleta completa: lista + baixa as matérias de todas as fontes. */
async function coletarMaterias({ dias = 7 } = {}) {
  const out = [];
  const sessao = novaSessaoChromium();
  try {
    for (const fonte of FONTES) {
      try {
        if (fonte.tipo === 'rss') {
          for (const item of await listarRss(fonte, dias, sessao)) {
            let corpo = '';
            try { corpo = extrairMateriaAB(await htmlDe(item.url, sessao)); } catch (_) { /* usa a descrição */ }
            if (!corpo) corpo = item.descricao || '';
            if (!corpo) continue;
            out.push({ fonte: fonte.nome, url: item.url, data: item.data, titulo: item.titulo, corpo });
          }
        } else {
          for (const item of await listarMaterias(fonte, dias, sessao)) {
            try {
              const { titulo, corpo } = extrairMateria(await htmlDe(item.url, sessao));
              out.push({ fonte: fonte.nome, url: item.url, data: item.data, titulo, corpo });
            } catch (e) { console.warn(`[digest] matéria falhou (${item.url}):`, e.message); }
          }
        }
      } catch (e) { console.warn(`[digest] fonte ${fonte.nome} falhou:`, e.message); }
      if (out.length >= MAX_MATERIAS) break;
    }
  } finally { await sessao.fechar(); }
  return out.slice(0, MAX_MATERIAS);
}

// ---------- análise (IA) ----------
function promptDigest(materias) {
  const blocos = materias.map((m, i) =>
    `[${i + 1}] (${m.fonte}, ${m.data}) ${m.titulo}\n${m.corpo}`).join('\n\n---\n\n');
  return `Você assessora a Liderança do Podemos na Câmara dos Deputados. Abaixo estão as matérias publicadas pelo(s) programa(s) jornalístico(s) no período. Sua tarefa:

1. Agrupe as matérias em TEMAS (uma matéria pode sustentar um tema sozinha; matérias correlatas formam um tema só).
2. Para cada tema: um resumo fiel de 2 a 3 frases (SOMENTE com o que está nas matérias — não acrescente fatos), a RELEVÂNCIA para atuação legislativa federal (alta, média ou baixa, com justificativa curta) e as AÇÕES LEGISLATIVAS cabíveis (Projeto de Lei, Requerimento de Informação, Requerimento de CPI, Audiência Pública, Indicação, Voto de Louvor/Pesar, ou "nenhuma"). As ações são SUGESTÕES suas — seja criativo, mas realista quanto à competência da União.
3. Ignore temas sem qualquer potencial legislativo (esporte/entretenimento puro), listando-os apenas em "descartados".

MATÉRIAS:
${blocos}

Responda APENAS com JSON, sem cercas de código:
{"temas":[{"titulo":"<curto>","resumo":"<2-3 frases fiéis>","relevancia":"alta|média|baixa","porque":"<justificativa curta>","acoes":[{"tipo":"<instrumento>","sugestao":"<1 frase do que proporia>"}],"fontes":[<índices das matérias>]}],"descartados":["<título curto>"]}`;
}

/**
 * Gera o digest (coleta + IA). Cache de 6h em disco para não repagar IA
 * quando vários assinantes pedem no mesmo período.
 */
async function gerarDigest({ perfil, dias = 7, forcar = false } = {}) {
  if (!perfil?.apiKey) throw new Error('sem chave de IA configurada (use /config no privado).');

  const cache = carregarJson('digest-cache.json', null);
  if (!forcar && cache && Date.now() - (cache.geradoEmMs || 0) < CACHE_TTL_MS && cache.temas?.length) {
    return { ...cache, deCache: true };
  }

  const materias = await coletarMaterias({ dias });
  if (!materias.length) throw new Error('não encontrei matérias do período na fonte (g1/Fantástico).');

  const bruto = await chamarIAtexto({
    provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
    prompt: promptDigest(materias), maxTokens: 3500,
  });
  const j = extrairJson(bruto);
  if (!Array.isArray(j.temas)) throw new Error('a IA não devolveu os temas no formato esperado.');

  // TEMAS DE INTERESSE dos parlamentares (mesmo mecanismo/config do painel):
  // marca em cada tema até 2 deputados do Podemos com interesse aderente.
  // Falha aqui não derruba o digest (fica sem a marcação).
  try {
    const { determinarInteressados } = require('./interesse');
    for (const t of j.temas) {
      t.interessados = await determinarInteressados(`${t.titulo}. ${t.resumo}`, perfil);
    }
  } catch (e) { console.warn('[digest] temas de interesse indisponíveis:', e.message); }

  const digest = {
    temas: j.temas,
    descartados: Array.isArray(j.descartados) ? j.descartados : [],
    materias: materias.map(m => ({ fonte: m.fonte, url: m.url, data: m.data, titulo: m.titulo, corpo: m.corpo })),
    geradoEm: new Date().toISOString(),
    geradoEmMs: Date.now(),
  };
  gravarJson('digest-cache.json', digest);
  return digest;
}

// ---------- minuta ----------
function promptMinuta(tema, materias) {
  const blocos = materias.map((m, i) => `[${i + 1}] ${m.titulo}\n${m.corpo}`).join('\n\n---\n\n');
  const acoes = (tema.acoes || []).map(a => `${a.tipo}: ${a.sugestao}`).join(' | ') || '(a seu critério)';
  return `Você é consultor legislativo da Liderança do Podemos na Câmara dos Deputados. Com base no TEMA e nas MATÉRIAS abaixo, elabore a MINUTA de UMA proposição legislativa federal.

TEMA: ${tema.titulo}
RESUMO: ${tema.resumo}
AÇÕES SUGERIDAS: ${acoes}

MATÉRIAS DE REFERÊNCIA:
${blocos}

Regras:
- Escolha o instrumento mais adequado (Projeto de Lei, Requerimento de Informação, Requerimento de Instauração de CPI, Requerimento de Audiência Pública, Indicação). Justifique a escolha em 1 frase no campo "porqueInstrumento".
- Estruture como manda a praxe da Câmara: EMENTA; texto articulado (Art. 1º, Art. 2º…) no caso de PL, ou o texto do requerimento/indicação nos demais; e JUSTIFICAÇÃO (3 a 6 parágrafos, citando o fato noticiado como motivação).
- NÃO invente números de lei, dados estatísticos ou fatos que não estejam nas matérias. Se precisar referir legislação vigente sem certeza, use marcador entre colchetes: [VERIFICAR: lei aplicável].
- Autoria: deixe "Deputado(a) [NOME], Podemos/[UF]".

Responda APENAS com JSON, sem cercas de código:
{"instrumento":"<tipo>","porqueInstrumento":"<1 frase>","titulo":"<ex.: PROJETO DE LEI Nº , DE 2026>","ementa":"<ementa>","texto":"<articulado ou texto do requerimento, com quebras de linha \\n>","justificacao":"<parágrafos separados por \\n\\n>"}`;
}

async function elaborarMinuta({ perfil, tema, materias }) {
  if (!perfil?.apiKey) throw new Error('sem chave de IA configurada (use /config no privado).');
  const usadas = (tema.fontes || []).map(i => materias[i - 1]).filter(Boolean);
  const base = usadas.length ? usadas : materias.slice(0, 3);
  const prompt = promptMinuta(tema, base);
  // maxTokens folgado: nos modelos "thinking" (Gemini 3.x) o teto inclui os
  // tokens de raciocínio — 4500 cortava minutas longas no meio do JSON.
  const pedir = p => chamarIAtexto({
    provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
    prompt: p, maxTokens: 16000,
  });
  let bruto = await pedir(prompt);
  let j = extrairJson(bruto);
  if (!j.texto || !j.ementa) {
    // Diagnóstico no log + 2ª tentativa com a exigência de JSON reforçada.
    console.warn('[digest] minuta fora do formato (1ª tentativa). Início da resposta: ' +
      JSON.stringify(String(bruto || '(vazia)').slice(0, 400)));
    bruto = await pedir(prompt +
      '\n\nATENÇÃO: a resposta deve ser um ÚNICO objeto JSON válido. Quebras de linha dentro dos campos devem vir escapadas como \\n. Sem cercas de código, sem texto antes ou depois.');
    j = extrairJson(bruto);
  }
  if (!j.texto || !j.ementa) throw new Error('a IA não devolveu a minuta no formato esperado.');
  return { ...j, fontes: base.map(m => ({ titulo: m.titulo, url: m.url, data: m.data })) };
}

// ---------- PDF da minuta ----------
const escHtml = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paragrafos = s => String(s || '').split(/\n{2,}/)
  .map(p => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

function htmlMinuta(minuta, tema) {
  const dataBR = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long' }).format(new Date());
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 28mm 24mm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12.5pt; color: #111; line-height: 1.55; }
  h1 { font-size: 13.5pt; text-align: center; margin: 0 0 18pt; }
  .ementa { margin: 0 0 18pt 40%; text-align: justify; font-style: italic; }
  .texto p, .just p { text-align: justify; text-indent: 24pt; margin: 0 0 8pt; }
  h2 { font-size: 12.5pt; text-align: center; margin: 20pt 0 10pt; }
  .assin { margin-top: 28pt; text-align: center; }
  </style></head><body>
  <h1>${escHtml(minuta.titulo || minuta.instrumento || 'MINUTA')}</h1>
  <div class="ementa">${escHtml(minuta.ementa)}</div>
  <div class="texto">${paragrafos(minuta.texto)}</div>
  <h2>JUSTIFICAÇÃO</h2>
  <div class="just">${paragrafos(minuta.justificacao)}</div>
  <div class="assin">Sala das Sessões, em ${dataBR}.<br><br><b>Deputado(a) [NOME]</b><br>Podemos/[UF]</div>
  </body></html>`;
}

/** Gera o PDF da minuta num Chromium descartável (não disputa o worker/push). */
async function pdfMinuta(minuta, tema) {
  const puppeteer = require('puppeteer');
  const args = [];
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-setuid-sandbox');
  const browser = await puppeteer.launch({
    headless: true, args,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlMinuta(minuta, tema), { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally { await browser.close().catch(() => {}); }
}

// ---------- controle do envio semanal ----------
// Chave da semana = data (SP) da segunda-feira corrente.
function chaveSemanaSP(agora = new Date()) {
  const sp = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dow = (sp.getDay() + 6) % 7;             // 0 = segunda
  sp.setDate(sp.getDate() - dow);
  return sp.toISOString().slice(0, 10);
}
function jaEnviadoNaSemana() {
  return carregarJson('digest-envio.json', {}).semana === chaveSemanaSP();
}
function marcarEnvioDaSemana() {
  gravarJson('digest-envio.json', { semana: chaveSemanaSP(), em: new Date().toISOString() });
}
/** true se agora (SP) é segunda-feira, 7h ou mais. */
function ehHoraDoEnvio() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const dia = p.find(x => x.type === 'weekday').value;
  const hora = parseInt(p.find(x => x.type === 'hour').value, 10) % 24;
  return dia === 'Mon' && hora >= 7;
}

module.exports = {
  gerarDigest, elaborarMinuta, pdfMinuta, coletarMaterias, extrairMateria, extrairMateriaAB,
  listarAssinantes, assinar, desassinar, ehAssinante,
  jaEnviadoNaSemana, marcarEnvioDaSemana, ehHoraDoEnvio,
};
