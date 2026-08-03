'use strict';
// Busca de QUESTÕES DE ORDEM por conteúdo (palavra-chave).
//
// A API oficial de Dados Abertos NÃO tem questões de ordem (o tipo QO existe na
// tabela de referência, mas com zero registros). Há um sistema DEDICADO e
// público: camara.leg.br/busca-qordem-api/qordem (POST /search). Ele filtra por
// FACETAS (ano, autor, presidente, partido, uf) — não por texto nem por tema.
//
// Portanto a busca por conteúdo é feita AQUI: baixamos o acervo inteiro (é
// pequeno — ~4 mil QOs, 3 páginas de 2000, ~1 MB/página, poucos segundos) e
// ranqueamos em memória com o BM25 de ./busca. O acervo é quase estático
// (~150 QOs/ano) — cache de 1h + aquecimento no arranque deixam a consulta do
// usuário instantânea (varrer os 4 mil registros leva ~200 ms).
//
// Mandar o acervo para a IA escolher (como o /regimento faz com o RICD) NÃO
// serve aqui: o RICD são 316 artigos (~15 mil tokens), o acervo de QO tem
// 1,2 milhão de caracteres (~380 mil tokens) — custaria ~254 mil tokens por
// consulta.
//
// LIMITAÇÃO: a listagem traz só o TEXTO REDUZIDO (txtQOrdemReduzido), não o
// inteiro teor nem a indexação/tesauro (que só vêm no detalhe por id). A busca
// cobre o resumo — que costuma conter o assunto —, mas um termo que só apareça
// no corpo completo pode escapar.

const { normalizar, termosDe, construirIndice, ranquear } = require('./busca');

const BUSCA = 'https://www.camara.leg.br/busca-qordem-api/qordem/search';
const DETALHE = id => `https://www.camara.leg.br/v-busca-qordem/${id}`;
const TAM_PAGINA = 2000;
const TTL_MS = 60 * 60e3;   // 1h

let _corpus = [];
let _corpusTs = 0;
let _carregando = null;     // trava: chamadas concorrentes esperam o mesmo load

async function fetchPagina(numPagina) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(BUSCA, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
        Referer: 'https://www.camara.leg.br/v-busca-qordem' },
      body: JSON.stringify({ filtro: {}, numPagina, ordem: '', qtdPorPagina: TAM_PAGINA }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function carregarCorpus() {
  const pg0 = await fetchPagina(0);
  const total = pg0.resultadosCount || (pg0.resultadosList || []).length;
  const nPags = Math.min(10, Math.ceil(total / TAM_PAGINA));   // teto de segurança
  const resto = await Promise.all(
    Array.from({ length: Math.max(0, nPags - 1) }, (_, i) => fetchPagina(i + 1).catch(() => ({})))
  );
  const itens = [pg0, ...resto].flatMap(p => p.resultadosList || []);
  if (itens.length) { _corpus = itens; _corpusTs = Date.now(); }
  return _corpus;
}

/** Garante o acervo fresco (cache de 1h); loads concorrentes compartilham a trava. */
async function garantirCorpus() {
  if (_corpus.length && Date.now() - _corpusTs < TTL_MS) return _corpus;
  if (!_carregando) {
    _carregando = carregarCorpus().finally(() => { _carregando = null; });
  }
  try { return await _carregando; }
  catch (_) { return _corpus; }   // falhou o refetch: usa o que tiver em cache
}

// Índice BM25 do acervo — construído uma vez por carga (não por consulta) e
// refeito quando o cache do acervo vira.
let _idx = null, _idxTs = 0;
function indice(corpus) {
  if (_idx && _idxTs === _corpusTs) return _idx;
  _idx = construirIndice(corpus, textoDe);
  _idxTs = _corpusTs;
  return _idx;
}

/** Aquece o acervo e o índice no arranque (background) — não bloqueia o boot. */
function aquecerCorpus() {
  garantirCorpus()
    .then(c => {
      if (c.length) indice(c);
      console.log(`[qordem] acervo aquecido (${c.length} questões de ordem).`);
    })
    .catch(e => console.warn('[qordem] aquecimento falhou:', e.message));
}

// A EMENTA (resumo) só vem no detalhe por id, não na listagem. Buscamos só a
// das QOs que vão APARECER (as ~12 mostradas), em paralelo, e cacheamos por id.
const _ementa = new Map();
async function carregarEmenta(id) {
  if (id == null) return '';
  if (_ementa.has(id)) return _ementa.get(id);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`https://www.camara.leg.br/busca-qordem-api/qordem/${id}`, {
      signal: ctrl.signal, headers: { Accept: 'application/json', Referer: 'https://www.camara.leg.br/v-busca-qordem' },
    });
    if (!r.ok) return '';
    const d = await r.json();
    const e = String(d.txtEmentaQOrdem || '').replace(/\s+/g, ' ').trim();
    _ementa.set(id, e);
    return e;
  } catch (_) { return ''; }
  finally { clearTimeout(timer); }
}

const textoDe = o =>
  `${o.txtQOrdemReduzido || ''} ${o.txtNomeAutorQOrdem || ''} ${o.numQOrdemComAno || ''}`;

const dataOrd = o => {
  const m = String(o.datSessaoQOrdem || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0;
};

function trechoAoRedor(texto, termos) {
  const norm = normalizar(texto);
  let i = -1;
  // Tenta a palavra inteira; se não achar, o começo dela (a pergunta diz
  // "adiar", o texto diz "adiamento" — o prefixo ainda aponta o lugar certo).
  for (const bruto of termos) {
    for (const t of [bruto, bruto.slice(0, 5)]) {
      if (t.length < 4) continue;
      const p = norm.indexOf(t);
      if (p >= 0) { if (i < 0 || p < i) i = p; break; }
    }
  }
  if (i < 0) i = 0;
  const ini = Math.max(0, i - 60);
  return (ini > 0 ? '…' : '') + texto.slice(ini, i + 90).replace(/\s+/g, ' ').trim() + '…';
}

/**
 * Busca questões de ordem por relevância (BM25 sobre o texto reduzido).
 *
 * Os termos são RADICALIZADOS antes de casar, para a mesma pergunta escrita de
 * dois jeitos dar o mesmo resultado — antes, "adiamento de votação" achava 12 e
 * "adiar a votação" achava 406, porque a comparação era literal.
 *
 * Só entram as QOs com a MAIOR COBERTURA de termos alcançável no acervo: se
 * existir QO com todos os termos, o resultado é só desse grupo; se não existir,
 * o corte desce um nível sozinho, em vez de devolver tudo que tenha "votação".
 * @returns {Promise<{termo, total, itens:[{id,num,data,autor,ementa,trecho}]}>}
 */
async function buscarQO(termo, { limite = 8 } = {}) {
  const termos = termosDe(termo);
  if (!termos.length) return { termo, total: 0, itens: [] };
  const corpus = await garantirCorpus();
  if (!corpus.length) return { termo, total: 0, itens: [] };
  const idx = indice(corpus);

  const rank = ranquear(corpus, idx, termos);
  if (!rank.length) return { termo: String(termo).trim(), total: 0, itens: [] };
  const cobertura = r => termos.reduce((s, t) => s + (idx.docs[r.indice].tf.has(t) ? 1 : 0), 0);
  let maxCob = 0;
  for (const r of rank) { const c = cobertura(r); r._cob = c; if (c > maxCob) maxCob = c; }
  const achados = rank.filter(r => r._cob === maxCob)
    .sort((a, b) => b.score - a.score || dataOrd(b.item) - dataOrd(a.item))
    .map(r => r.item);

  // Para destacar o trecho usamos as palavras COMO FORAM ESCRITAS (o radical
  // "comis" não aparece no texto; "comissão" aparece).
  const brutos = normalizar(termo).split(/[^\wà-ú]+/i).filter(t => t.length > 2);
  // Enriquece só as mostradas com a EMENTA (detalhe por id, em paralelo).
  const itens = await Promise.all(achados.slice(0, limite).map(async o => {
    const ementa = await carregarEmenta(o.numInternoQOrdem);
    return {
      id: o.numInternoQOrdem,
      num: o.numQOrdemComAno || o.numQOrdem,
      data: o.datSessaoQOrdem,
      autor: String(o.txtNomeAutorQOrdem || '').trim(),
      ementa,
      trecho: trechoAoRedor(o.txtQOrdemReduzido || '', brutos),
    };
  }));
  return { termo: String(termo).trim(), total: achados.length, itens,
           termosBuscados: termos.length, termosCasados: maxCob };
}

/** Texto pronto para o comando e o agente. */
function formatarQO(res) {
  if (!res.total) {
    return `Não encontrei questão de ordem mencionando "${res.termo}" (busca no resumo de cada QO).`;
  }
  const resumo = x => {
    const e = (x.ementa || '').trim();
    const texto = e ? (e.length > 240 ? e.slice(0, 240).replace(/\s+\S*$/, '') + '…' : e) : x.trecho;
    return texto;
  };
  const linhas = res.itens.map(x =>
    `• *QO ${x.num}* — ${x.data}${x.autor ? ` · ${x.autor}` : ''}\n  ${resumo(x)}\n  🔗 Íntegra: ${DETALHE(x.id)}`);
  const cab = `🔎 Questões de ordem com "${res.termo}": *${res.total}*` +
    (res.total > res.itens.length ? ` (mostrando as ${res.itens.length} mais relevantes)` : '');
  // Sem isto o usuário não sabe se o resultado é exaustivo ou já é o "melhor
  // possível" — e ele decide se vale reformular com menos palavras.
  const parcial = res.termosCasados < res.termosBuscados
    ? `\n_Nenhuma QO reúne todos os termos; estas reúnem ${res.termosCasados} de ${res.termosBuscados}._`
    : '';
  return `${cab}${parcial}\n\n${linhas.join('\n\n')}`;
}

/** Versão COMPACTA — para anexar como precedente a outra resposta (ex.: /regimento). */
function formatarQOCompacto(res, { titulo = '⚖️ *Precedente — questões de ordem sobre o tema*' } = {}) {
  if (!res.total) return '';
  const linhas = res.itens.map(x => {
    const e = (x.ementa || x.trecho || '').replace(/\s+/g, ' ').trim();
    const resumo = e.length > 150 ? e.slice(0, 150).replace(/\s+\S*$/, '') + '…' : e;
    return `• *QO ${x.num}* — ${x.data}${x.autor ? ` · ${x.autor}` : ''}\n  ${resumo}\n  🔗 ${DETALHE(x.id)}`;
  });
  const mais = res.total > res.itens.length
    ? `\n\n(${res.total} no total — veja as demais com /qo ${res.termo})` : '';
  return `${titulo} (${res.total})\n\n${linhas.join('\n\n')}${mais}`;
}

module.exports = { buscarQO, formatarQO, formatarQOCompacto, aquecerCorpus, garantirCorpus };
