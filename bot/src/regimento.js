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

const { chamarIAtexto, extrairJson } = require('./ia');

const URL_RICD = 'https://www2.camara.leg.br/legin/fed/rescad/1989/resolucaodacamaradosdeputados-17-21-setembro-1989-320110-normaatualizada-pl.html';
const MAX_ART = 2200;            // teto por artigo (a resposta soma norma + precedente)
let _artigos = [];               // [{ num, ordem, texto }]
let _ts = 0;

const { normalizar, termosDe, construirIndice, ranquear } = require('./busca');

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
// "APRESENTAÇÃO ... COMISSÕES" — tokens diferentes, zero match. O radicalizador
// e o BM25 vivem em ./busca, compartilhados com a busca de questões de ordem:
// eram duas implementações divergentes e a mesma pergunta rendia resultados
// diferentes em cada comando.
let _idx = null;

async function garantirRegimento() {
  if (_artigos.length) return _artigos;
  const a = lerEmbutido();
  if (!a) throw new Error('arquivo do Regimento ausente no bot (src/ricd.js)');
  _artigos = a; _ts = Date.now();
  _idx = construirIndice(_artigos, a => a.texto);
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
  const termos = termosDe(q);
  if (!termos.length) return { consulta, artigos: [] };

  // BM25: cada termo pesa pela raridade (IDF) e o tamanho do artigo é
  // normalizado, para o artigo-catálogo não vencer o artigo-específico.
  const pontuados = ranquear(arts, _idx, termos)
    .map(r => ({ ...r.item, _p: normalizar(r.item.texto).includes(q) ? r.score * 1.8 : r.score }));

  pontuados.sort((a, b) => b._p - a._p || a.num - b.num);   // frase exata pesa mais
  return { consulta, artigos: pontuados.slice(0, limite) };
}

// ---------- Seleção SEMÂNTICA (índice → artigos) ----------
// A busca lexical conta palavras; não entende que "apreciação conclusiva" é o
// contexto de "prazo de emendas em comissão" — por isso errava o Art. 119. Aqui
// mandamos à IA o ÍNDICE do Regimento (nº + abertura de cada artigo, ~15 mil
// tokens) e ela escolhe os artigos; só então lemos o TEXTO INTEGRAL deles. Sai
// ~8x mais barato que mandar o Regimento inteiro (~115 mil tokens) e a resposta
// final continua sendo composta sobre o texto literal, nunca sobre memória.
const ABERTURA = 150;
let _indice = null;
function indiceArtigos(arts) {
  if (_indice) return _indice;
  _indice = arts.map(a => {
    const t = a.texto.replace(/\s+/g, ' ').replace(/\(“?[Cc]aput[^)]*\)/g, '')
      .replace(/\((?:Artigo|Parágrafo|Inciso|Alínea)[^)]*\)/g, '').trim();
    return t.slice(0, a.rotulo.length + ABERTURA);
  }).join('\n');
  return _indice;
}

/** Artigos escolhidos pela IA, na ordem em que ela indicou. */
function artigosPorNumeros(arts, nums) {
  const out = [];
  for (const n of nums) {
    for (const a of arts.filter(x => x.num === Number(n))) {
      if (!out.includes(a)) out.push(a);
    }
  }
  return out;
}

/**
 * Consulta regimental com seleção semântica, na chave do usuário.
 * Falha da IA (sem chave, erro, resposta inválida) → cai na busca lexical.
 * @returns {Promise<{consulta, artigos, via:'ia'|'lexical', erro?}>}
 */
async function consultarRegimentoIA({ consulta, perfil, limite = 4 }) {
  const numero = numeroPedido(consulta);
  if (numero || !perfil?.apiKey) return { ...(await consultarRegimento(consulta, { limite })), via: 'lexical' };

  let arts;
  try { arts = await garantirRegimento(); }
  catch (e) { return { consulta, artigos: [], erro: `fonte indisponível (${e.message})`, via: 'lexical' }; }

  const prompt = `Você recebe o ÍNDICE do Regimento Interno da Câmara dos Deputados: uma linha por artigo, com o número e o início do texto.

PERGUNTA: ${consulta}

Escolha de 1 a ${limite} artigos que respondem a essa pergunta. Prefira o artigo ESPECÍFICO ao genérico. Se nenhum servir, devolva lista vazia.
Responda APENAS com JSON, sem cercas: {"artigos": [119, 120]}

ÍNDICE:
${indiceArtigos(arts)}`;

  try {
    const bruto = await chamarIAtexto({
      provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
      prompt, maxTokens: 200,
    });
    const j = extrairJson(bruto);
    const nums = (Array.isArray(j.artigos) ? j.artigos : []).map(Number).filter(Number.isFinite);
    const escolhidos = artigosPorNumeros(arts, nums).slice(0, limite);
    if (escolhidos.length) return { consulta, artigos: escolhidos, via: 'ia' };
    // IA não achou: a lexical ainda pode ter algo
    return { ...(await consultarRegimento(consulta, { limite })), via: 'lexical' };
  } catch (e) {
    console.warn('[regimento] seleção por IA falhou, usando busca lexical:', e.message);
    return { ...(await consultarRegimento(consulta, { limite })), via: 'lexical' };
  }
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

module.exports = { consultarRegimento, consultarRegimentoIA, formatarRegimento, aquecerRegimento, garantirRegimento,
  // usados pelo scripts/atualizar-ricd.js
  htmlParaTexto, partirEmArtigos, URL_RICD };
