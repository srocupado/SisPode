'use strict';
// CONSULTA REGIMENTAL — Regimento Interno da Câmara dos Deputados (RICD).
//
// Fonte: texto CONSOLIDADO do LEGIN (Resolução 17/1989 com todas as alterações),
// já parseado e EMBUTIDO em src/ricd.js. A consulta NÃO depende da rede: o
// Regimento é estático e, quando o download falhava (429 do LEGIN), a consulta
// voltava vazia e o agente respondia de memória — inventando. Atualização é ato
// deliberado: node scripts/atualizar-ricd.js (após nova Resolução).
//
// A consulta NÃO responde sozinha: devolve os ARTIGOS PERTINENTES em texto
// literal para quem perguntou (comando) ou para o agente compor a resposta
// citando-os. Regimento é matéria de precisão — o bot mostra a fonte, não
// parafraseia sem lastro. Para o PRECEDENTE de como a Presidência já decidiu,
// a busca de questões de ordem (questaoordem.js) é o complemento natural.

const URL_RICD = 'https://www2.camara.leg.br/legin/fed/rescad/1989/resolucaodacamaradosdeputados-17-21-setembro-1989-320110-normaatualizada-pl.html';
const MAX_ART = 2200;            // teto por artigo (a resposta soma norma + precedente)
let _artigos = [];               // [{ num, ordem, texto }]
let _ts = 0;

const normalizar = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&ordf;/g, 'ª').replace(/&ordm;/g, 'º').replace(/&sect;/g, '§')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // O LEGIN quebra linha entre "Art." e o número (e entre § e o número);
    // reunir evita rótulos partidos no meio da frase.
    .replace(/\bArt\.\s*\n\s*(\d)/g, 'Art. $1')
    .replace(/\n?§\s*\n\s*(\d)/g, '\n§ $1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

/** Parte o texto do RICD em artigos: de "Art. N" até o próximo "Art. M". */
function partirEmArtigos(texto) {
  const rx = /(?:^|\n)\s*(Art\.\s*(\d+)(?:-[A-Z])?)\s*[.º°]?/g;
  const marcas = [];
  let m;
  while ((m = rx.exec(texto)) !== null) {
    marcas.push({ ini: m.index, rotulo: m[1].replace(/\s+/g, ' ').trim(), num: Number(m[2]) });
  }
  const arts = [];
  for (let i = 0; i < marcas.length; i++) {
    const fim = i + 1 < marcas.length ? marcas[i + 1].ini : texto.length;
    const corpo = texto.slice(marcas[i].ini, fim).trim();
    // O texto do LEGIN repete o número em notas de alteração; fica só o maior bloco
    // por rótulo (o artigo de fato, não a citação).
    const ja = arts.find(a => a.rotulo === marcas[i].rotulo);
    if (ja) { if (corpo.length > ja.texto.length) ja.texto = corpo; continue; }
    arts.push({ rotulo: marcas[i].rotulo, num: marcas[i].num, texto: corpo });
  }
  return arts.filter(a => a.texto.length > 40);
}

function lerEmbutido() {
  try {
    const m = require('./ricd');
    if (Array.isArray(m.artigos) && m.artigos.length > 200) return m.artigos;
  } catch (e) { console.warn('[regimento] módulo embutido indisponível:', e.message); }
  return null;
}

/**
 * Artigos do RICD. Lê do módulo embutido (síncrono, sem rede, sempre disponível).
 * Só levanta erro se o próprio arquivo do bot estiver corrompido/ausente — caso
 * em que o chamador precisa dizer "indisponível" em vez de responder sem lastro.
 */
// Índice BM25. Sem pesar os termos por raridade, uma pergunta longa era vencida
// pelo artigo que contivesse mais palavras COMUNS: "prazo" está em 91 artigos e
// "comissões" em 85 — não discriminam nada, e o Art. 32 (que lista todas as
// comissões) ganhava de qualquer artigo específico. Com IDF + normalização de
// tamanho, o termo raro ("emendas", "interstício") manda no resultado.
// RADICALIZAÇÃO leve (pt-BR). Sem isto, a pergunta não casa com a norma: o
// artigo escreve "emendas APRESENTADAS em COMISSÃO", a pergunta diz
// "APRESENTAÇÃO ... COMISSÕES" — tokens diferentes, zero match. Regras mínimas
// de plural/derivação + truncagem resolvem sem precisar de stemmer completo.
function radical(t) {
  let s = t;
  s = s.replace(/(coes|çoes|cao|ção)$/,'')        // apresentação/apresentações → apresentac
       .replace(/(mente)$/,'')                      // regimentalmente → regimental
       .replace(/(ndo|ada|ado|adas|ados|ida|ido|idas|idos)$/,'')  // apresentada → apresent
       .replace(/(oes|aes|aos)$/,'ao')              // comissões → comissao
       .replace(/(ns)$/,'m')                        // bens → bem
       .replace(/s$/,'');                           // plural simples
  return s.length >= 6 ? s.slice(0, 6) : s;         // truncagem: mesma família, mesmo radical
}
let _idx = null;
function construirIndice(arts) {
  const N = arts.length;
  const docs = arts.map(a => {
    const toks = normalizar(a.texto).split(/[^\wçà-ú-]+/i).filter(t => t.length > 2).map(radical);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { tf, len: toks.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / (N || 1);
  return { docs, df, N, avg };
}
const idf = (idx, t) => {
  const d = idx.df.get(t) || 0;
  return Math.log(1 + (idx.N - d + 0.5) / (d + 0.5));
};

async function garantirRegimento() {
  if (_artigos.length) return _artigos;
  const a = lerEmbutido();
  if (!a) throw new Error('arquivo do Regimento ausente no bot (src/ricd.js)');
  _artigos = a; _ts = Date.now();
  _idx = construirIndice(_artigos);
  return _artigos;
}

/** Aquece no arranque (background) — a 1ª consulta já sai instantânea. */
function aquecerRegimento() {
  garantirRegimento()
    .then(a => console.log(`[regimento] RICD embutido OK (${a.length} artigos).`))
    .catch(e => console.error('[regimento] FALHA GRAVE — sem Regimento:', e.message));
}

// "art 95", "artigo 95", "95" → 95
function numeroPedido(consulta) {
  const m = String(consulta || '').trim().match(/^(?:art(?:igo)?\.?\s*)?(\d{1,3})(?:\s*[-–]\s*[A-Za-z])?$/i);
  return m ? Number(m[1]) : null;
}

// O Regimento escreve por extenso o que a rotina abrevia ("CPI", "DVS").
// Sem esta expansão, a busca por sigla não acha o artigo certo.
const SIGLAS = [
  [/\bcpi\b/g, 'comissao parlamentar de inquerito'],
  [/\bdvs\b/g, 'destaque para votacao em separado'],
  [/\bdtq\b/g, 'destaque'],
  [/\bodd\b/g, 'ordem do dia'],
  [/\bqo\b/g, 'questao de ordem'],
  [/\bmpv?\b/g, 'medida provisoria'],
  [/\bpec\b/g, 'proposta de emenda a constituicao'],
  [/\bplp\b/g, 'projeto de lei complementar'],
  [/\bpdl\b/g, 'projeto de decreto legislativo'],
  [/\breq\b/g, 'requerimento'],
  [/\bric\b/g, 'requerimento de informacao'],
  [/\bccjc?\b/g, 'comissao de constituicao e justica'],
  [/\brf\b/g, 'redacao final'],
];
const expandirSiglas = q => SIGLAS.reduce((s, [rx, exp]) => s.replace(rx, exp), q);

// Palavras sem valor de busca (não ajudam a achar o artigo).
const VAZIAS = new Set(['a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas',
  'para','por','com','que','qual','quais','quantos','quantas','é','ser','pode','posso','como','quando',
  'um','uma','se','ao','à','às','aos','sobre','the','of']);

/**
 * Artigos pertinentes a uma consulta. Se a consulta for um número, devolve
 * aquele artigo. Senão, pontua por ocorrência dos termos (frase exata pesa mais).
 */
async function consultarRegimento(consulta, { limite = 3 } = {}) {
  let arts;
  try { arts = await garantirRegimento(); }
  catch (e) { return { consulta, artigos: [], erro: `fonte indisponível (${e.message})` }; }
  if (!arts.length) return { consulta, artigos: [], erro: 'o Regimento não pôde ser carregado' };

  const n = numeroPedido(consulta);
  if (n) {
    const achados = arts.filter(a => a.num === n);
    return { consulta, porNumero: true, artigos: achados };
  }

  const q = expandirSiglas(normalizar(consulta));
  const termos = [...new Set(q.split(/[^\wçãáéíóúâêôõà-]+/i).map(t => t.trim())
    .filter(t => t.length > 2 && !VAZIAS.has(t)).map(radical))];
  if (!termos.length) return { consulta, artigos: [] };

  // BM25: cada termo pesa pela raridade (IDF) e o tamanho do artigo é
  // normalizado, para o artigo-catálogo não vencer o artigo-específico.
  const K1 = 1.2, B = 0.6;
  const pontuados = arts.map((a, i) => {
    const d = _idx.docs[i];
    let p = 0;
    for (const termo of termos) {
      const tf = d.tf.get(termo) || 0;
      if (!tf) continue;
      p += idf(_idx, termo) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * d.len / _idx.avg));
    }
    if (p && normalizar(a.texto).includes(q)) p *= 1.8;   // frase exata: forte indício
    return { ...a, _p: p };
  }).filter(a => a._p > 0);

  pontuados.sort((a, b) => b._p - a._p || a.num - b.num);
  return { consulta, artigos: pontuados.slice(0, limite) };
}

function corta(s, n = MAX_ART) {
  s = String(s || '').trim();
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

/** Texto pronto (comando e observação do agente). */
function formatarRegimento(res) {
  // Marcador explícito para o AGENTE: sem norma em mãos, ele não pode responder
  // de memória — tem que dizer que não conseguiu consultar.
  if (res.erro) {
    return `ERRO_REGIMENTO: não consegui consultar o Regimento Interno agora — ${res.erro}. ` +
      'NÃO responda a dúvida regimental sem o texto do artigo: informe que a consulta falhou e sugira tentar de novo.';
  }
  if (!res.artigos.length) {
    return `Não localizei artigo do Regimento Interno para "${res.consulta}". Tente outros termos (ex.: "verificação de votação", "questão de ordem", "urgência") ou o número do artigo (ex.: /regimento 95).`;
  }
  const cab = res.porNumero
    ? '📕 *Regimento Interno da Câmara* (texto vigente)'
    : `📕 *Regimento Interno* — artigos pertinentes a "${res.consulta}"`;
  const corpo = res.artigos.map(a => corta(a.texto)).join('\n\n─────\n\n');
  return `${cab}\n\n${corpo}`;
}

module.exports = { consultarRegimento, formatarRegimento, aquecerRegimento, garantirRegimento,
  // usados pelo scripts/atualizar-ricd.js
  htmlParaTexto, partirEmArtigos, URL_RICD };
