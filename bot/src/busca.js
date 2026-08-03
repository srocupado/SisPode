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

module.exports = { normalizar, radical, termosDe, construirIndice, ranquear, idf };
