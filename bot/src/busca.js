'use strict';
// RANQUEAMENTO DE TEXTO — usado pela consulta ao Regimento e pela busca de
// questões de ordem. Ficava duplicado e divergente nos dois: o Regimento
// contava palavras (e perdia o artigo certo para quem repetisse termo comum) e
// a busca de QO exigia todos os termos (e, ao relaxar, devolvia qualquer coisa
// que tivesse "votação"). Sintoma medido: "adiamento de votação" trazia 12
// resultados e "adiar a votação" trazia 406 — a mesma pergunta.
//
// Duas peças resolvem: RADICALIZAÇÃO (para "adiar" casar com "adiamento") e
// BM25 (para o termo raro pesar mais que o comum, com o tamanho do texto
// normalizado).

const normalizar = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Nominalizações em "-são": o verbo troca a consoante (inver*s*ão ↔ inver*t*er,
// deci*s*ão ↔ deci*d*ir) e a troca não é previsível — "discussão" vira "t",
// "admissão" vira "t", "suspensão" vira "d". Regra genérica erra; a lista das
// que aparecem no vocabulário de plenário é curta e conferível. O valor é o
// radical que o verbo já produz pelas regras abaixo.
const SAO = {
  inversao: 'invert', discussao: 'discut', decisao: 'decid', suspensao: 'suspend',
  admissao: 'admit', apreensao: 'apreend', omissao: 'omit', remissao: 'remet',
  transmissao: 'transmit', extensao: 'estend', pretensao: 'pretend', revisao: 'revis',
  conclusao: 'conclu', exclusao: 'exclu', inclusao: 'inclu', prisao: 'prend',
};

/** Radicalização leve pt-BR: plural, -ção, -são, particípios, gerúndio. */
function radical(t) {
  let s = String(t)
    .replace(/(oes|aes|aos)$/, 'ao')                              // comissões → comissao
    .replace(/(mente)$/, '')                                      // regimentalmente → regimental
    .replace(/(amentos?)$/, '')                                   // adiamento → adi (casa com 'adiar')
    .replace(/(ndo|ada|ado|adas|ados|ida|ido|idas|idos)$/, '')    // apresentada → apresent
    .replace(/(ns)$/, 'm')
    .replace(/([rz])es$/, '$1')                                   // poderes → poder
    .replace(/s$/, '')
    .replace(/encia$/, 'ent')                                     // urgência → urgent (= urgente)
    .replace(/que$/, 'c');                                        // destaque → destac (= destacar)
  // "-ção" e infinitivo convergem para o mesmo radical: votação→vota→vot e
  // votar→vot; apresentação→apresenta→apresent e apresentar→apresent.
  if (SAO[s]) s = SAO[s];
  else if (/cao$/.test(s)) s = s.replace(/cao$/, '').replace(/[aeiou]$/, '');
  else s = s.replace(/(ar|er|ir)$/, '');
  // Truncagem em 6: é ela que fecha as famílias que as regras não fecham
  // sozinhas. O preço é juntar palavras sem parentesco que compartilham as 6
  // primeiras letras — "quântico" e "quantitativo" viram ambos "quanti".
  // MEDIDO: em 7 letras esse tipo de colisão diminui, mas quebram
  // requerer/requerimento, presidir/presidência e urgência/urgente — três das
  // famílias mais frequentes no vocabulário de plenário. 6 é o melhor ponto.
  return s.length >= 6 ? s.slice(0, 6) : s;
}

const VAZIAS = new Set(['a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas',
  'para','por','com','que','qual','quais','quantos','quantas','ser','pode','posso','como','quando',
  'um','uma','se','ao','aos','sobre','houve','tem','existe','alguma','algum','sao','foi','pelo','pela',
  'seu','sua','este','esta','esse','essa','isso','the','of','porque','porquê']);

/**
 * "art. 164", "artigo 164", "arts. 95" → "art164". Precisa valer para o TEXTO
 * INDEXADO e para a consulta: indexado como "art" + "164" solto, o número
 * casaria com qualquer ano ou quórum, e "art" com qualquer menção a artigo.
 */
const expandirArtigos = t => normalizar(t).replace(/\bart(?:igo)?s?\.?\s*(\d{1,3})/g, 'art$1');

/** Termos úteis de uma consulta, já radicalizados. */
function termosDe(consulta) {
  return [...new Set(normalizar(consulta)
    .split(/[^\wçà-ú-]+/i)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !VAZIAS.has(t))
    .map(radical))];
}

/** Índice BM25 de uma coleção. `texto(item)` extrai o conteúdo indexável. */
function construirIndice(itens, texto) {
  const docs = itens.map(it => {
    const toks = normalizar(texto(it)).split(/[^\wçà-ú-]+/i).filter(t => t.length > 2).map(radical);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { tf, len: toks.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  return { docs, df, N: itens.length, avg: docs.reduce((s, d) => s + d.len, 0) / (itens.length || 1) };
}

const idf = (idx, t) => {
  const d = idx.df.get(t) || 0;
  return Math.log(1 + (idx.N - d + 0.5) / (d + 0.5));
};

/**
 * Ordena os itens por relevância BM25. Devolve [{item, indice, score}] com
 * score > 0, do mais relevante ao menos.
 */
function ranquear(itens, idx, termos, { k1 = 1.2, b = 0.6 } = {}) {
  if (!termos.length) return [];
  const out = [];
  for (let i = 0; i < itens.length; i++) {
    const d = idx.docs[i];
    let p = 0;
    for (const t of termos) {
      const tf = d.tf.get(t) || 0;
      if (!tf) continue;
      p += idf(idx, t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d.len / idx.avg));
    }
    if (p > 0) out.push({ item: itens[i], indice: i, score: p });
  }
  out.sort((a, c) => c.score - a.score);
  return out;
}

// ---------- ADJACÊNCIA (expressões) ----------
// O BM25 é saco de palavras: não sabe que "apreciação conclusiva" é uma
// expressão. MEDIDO no acervo de questões de ordem, ao indexar o inteiro teor:
// "apreciação conclusiva" saltou de 4 para 83 resultados, e os 79 novos casavam
// coisas como "a apreciação pelas Comissões Técnicas, que concluem" — palavras
// certas, sentido nenhum. Já "retirada de pauta" foi de 26 para 61 com os novos
// todos pertinentes, porque a expressão aparece literalmente.
//
// A diferença é ADJACÊNCIA. Aqui ela é verificada só nos candidatos que o BM25
// já selecionou (algumas centenas), relendo o texto — precomputar bigramas de
// todo o acervo custaria milhões de entradas para ganhar milissegundos.

/**
 * Pares de termos VIZINHOS na consulta, já radicalizados. Vírgula, ponto e
 * "e"/"ou" quebram o par: em "prejudicialidade, adiamento de discussão", só
 * "adiamento discussão" é expressão — "prejudicialidade adiamento" não é.
 */
function bigramasDe(consulta) {
  const pares = [];
  for (const trecho of normalizar(consulta).split(/[,;:.!?]|\s+(?:e|ou|com|sem)\s+/)) {
    const ts = trecho.split(/[^\wçà-ú-]+/i)
      .filter(t => t.length > 2 && !VAZIAS.has(t)).map(radical);
    for (let i = 0; i + 1 < ts.length; i++) if (ts[i] !== ts[i + 1]) pares.push([ts[i], ts[i + 1]]);
  }
  return pares;
}

/**
 * Quantos dos pares aparecem grudados no texto. `folga` permite uma palavra no
 * meio ("retirada DA pauta" já perde o "da" na tokenização, mas
 * "adiamento da referida discussão" não).
 */
function adjacencia(texto, pares, { folga = 1 } = {}) {
  if (!pares.length) return 0;
  const toks = normalizar(texto).split(/[^\wçà-ú-]+/i).filter(t => t.length > 2).map(radical);
  const pos = new Map();
  toks.forEach((t, i) => { const l = pos.get(t); if (l) l.push(i); else pos.set(t, [i]); });
  let n = 0;
  for (const [a, b] of pares) {
    const pa = pos.get(a), pb = pos.get(b);
    if (!pa || !pb) continue;
    if (pa.some(i => pb.some(k => k > i && k - i <= 1 + folga))) n++;
  }
  return n;
}

module.exports = { normalizar, radical, termosDe, construirIndice, ranquear, idf,
                   expandirArtigos, bigramasDe, adjacencia };
