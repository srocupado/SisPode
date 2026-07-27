'use strict';
// CONSULTA REGIMENTAL — Regimento Interno da Câmara dos Deputados (RICD).
//
// Fonte: texto CONSOLIDADO e vigente publicado no LEGIN (Resolução 17/1989 com
// todas as alterações). É HTML público, ~1 MB, 282 artigos — baixamos uma vez,
// partimos em artigos e guardamos em memória (o Regimento muda raramente).
//
// A consulta NÃO responde sozinha: devolve os ARTIGOS PERTINENTES em texto
// literal para quem perguntou (comando) ou para o agente compor a resposta
// citando-os. Regimento é matéria de precisão — o bot mostra a fonte, não
// parafraseia sem lastro. Para o PRECEDENTE de como a Presidência já decidiu,
// a busca de questões de ordem (questaoordem.js) é o complemento natural.

const URL_RICD = 'https://www2.camara.leg.br/legin/fed/rescad/1989/resolucaodacamaradosdeputados-17-21-setembro-1989-320110-normaatualizada-pl.html';
const TTL_MS = 24 * 60 * 60e3;   // 24h (o RICD muda por resolução, raramente)
const MAX_ART = 4000;            // teto de caracteres por artigo exibido

let _artigos = [];               // [{ num, ordem, texto }]
let _ts = 0;
let _carregando = null;

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

async function baixar() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(URL_RICD, { signal: ctrl.signal, headers: { 'User-Agent': 'SisPodeBot/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o Regimento`);
    const arts = partirEmArtigos(htmlParaTexto(await r.text()));
    if (arts.length) { _artigos = arts; _ts = Date.now(); }
    return _artigos;
  } finally { clearTimeout(timer); }
}

async function garantirRegimento() {
  if (_artigos.length && Date.now() - _ts < TTL_MS) return _artigos;
  if (!_carregando) _carregando = baixar().finally(() => { _carregando = null; });
  try { return await _carregando; }
  catch (_) { return _artigos; }   // falhou o refetch: usa o que tiver
}

/** Aquece no arranque (background) — a 1ª consulta já sai instantânea. */
function aquecerRegimento() {
  garantirRegimento()
    .then(a => console.log(`[regimento] RICD carregado (${a.length} artigos).`))
    .catch(e => console.warn('[regimento] carga falhou:', e.message));
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
async function consultarRegimento(consulta, { limite = 5 } = {}) {
  const arts = await garantirRegimento();
  if (!arts.length) return { consulta, artigos: [], erro: 'não consegui carregar o Regimento agora' };

  const n = numeroPedido(consulta);
  if (n) {
    const achados = arts.filter(a => a.num === n);
    return { consulta, porNumero: true, artigos: achados };
  }

  const q = expandirSiglas(normalizar(consulta));
  const termos = [...new Set(q.split(/[^\wçãáéíóúâêôõà-]+/i).map(t => t.trim())
    .filter(t => t.length > 2 && !VAZIAS.has(t)))];
  if (!termos.length) return { consulta, artigos: [] };

  const pontuados = arts.map(a => {
    const t = normalizar(a.texto);
    let p = 0, presentes = 0;
    for (const termo of termos) {
      const oc = t.split(termo).length - 1;
      if (oc) { presentes++; p += Math.min(oc, 4); }
    }
    if (t.includes(q)) p += 12;                    // frase exata: forte indício
    if (presentes === termos.length) p += 6;       // cobre todos os termos
    return { ...a, _p: p, _presentes: presentes };
  }).filter(a => a._p > 0);

  pontuados.sort((a, b) => b._presentes - a._presentes || b._p - a._p || a.num - b.num);
  return { consulta, artigos: pontuados.slice(0, limite) };
}

function corta(s, n = MAX_ART) {
  s = String(s || '').trim();
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

/** Texto pronto (comando e observação do agente). */
function formatarRegimento(res) {
  if (res.erro) return `Consulta ao Regimento indisponível — ${res.erro}.`;
  if (!res.artigos.length) {
    return `Não localizei artigo do Regimento Interno para "${res.consulta}". Tente outros termos (ex.: "verificação de votação", "questão de ordem", "urgência") ou o número do artigo (ex.: /regimento 95).`;
  }
  const cab = res.porNumero
    ? '📕 *Regimento Interno da Câmara* (texto vigente)'
    : `📕 *Regimento Interno* — artigos pertinentes a "${res.consulta}"`;
  const corpo = res.artigos.map(a => corta(a.texto)).join('\n\n─────\n\n');
  return `${cab}\n\n${corpo}`;
}

module.exports = { consultarRegimento, formatarRegimento, aquecerRegimento, garantirRegimento };
