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
// procuramos o termo no texto reduzido de cada QO, em memória. O acervo é quase
// estático (~150 QOs/ano) — cache de 1h + aquecimento no arranque deixam a
// consulta do usuário instantânea (o grep de 4 mil registros leva ~10 ms).
//
// LIMITAÇÃO: a listagem traz só o TEXTO REDUZIDO (txtQOrdemReduzido), não o
// inteiro teor nem a indexação/tesauro (que só vêm no detalhe por id). A busca
// cobre o resumo — que costuma conter o assunto —, mas um termo que só apareça
// no corpo completo pode escapar.

const BUSCA = 'https://www.camara.leg.br/busca-qordem-api/qordem/search';
const DETALHE = id => `https://www.camara.leg.br/v-busca-qordem/${id}`;
const TAM_PAGINA = 2000;
const TTL_MS = 60 * 60e3;   // 1h

let _corpus = [];
let _corpusTs = 0;
let _carregando = null;     // trava: chamadas concorrentes esperam o mesmo load

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

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

/** Aquece o acervo no arranque (background) — não bloqueia o boot. */
function aquecerCorpus() {
  garantirCorpus()
    .then(c => console.log(`[qordem] acervo aquecido (${c.length} questões de ordem).`))
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

const dataOrd = o => {
  const m = String(o.datSessaoQOrdem || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0;
};

function trechoAoRedor(texto, termos) {
  const norm = normalizar(texto);
  let i = -1;
  for (const t of termos) { const p = norm.indexOf(t); if (p >= 0 && (i < 0 || p < i)) i = p; }
  if (i < 0) i = 0;
  const ini = Math.max(0, i - 60);
  return (ini > 0 ? '…' : '') + texto.slice(ini, i + 90).replace(/\s+/g, ' ').trim() + '…';
}

/**
 * Busca questões de ordem cujo texto reduzido contém TODOS os termos.
 * @returns {Promise<{termo, total, itens:[{id,num,data,autor,trecho}]}>}
 */
async function buscarQO(termo, { limite = 8 } = {}) {
  const q = normalizar(termo);
  if (!q) return { termo, total: 0, itens: [] };
  const termos = q.split(/\s+/).filter(Boolean);
  const corpus = await garantirCorpus();
  const alvoDe = o => normalizar(`${o.txtQOrdemReduzido || ''} ${o.txtNomeAutorQOrdem || ''} ${o.numQOrdemComAno || ''}`);
  const achados = corpus.filter(o => { const a = alvoDe(o); return termos.every(t => a.includes(t)); });
  achados.sort((a, b) => dataOrd(b) - dataOrd(a));
  // Enriquece só as mostradas com a EMENTA (detalhe por id, em paralelo).
  const itens = await Promise.all(achados.slice(0, limite).map(async o => {
    const ementa = await carregarEmenta(o.numInternoQOrdem);
    return {
      id: o.numInternoQOrdem,
      num: o.numQOrdemComAno || o.numQOrdem,
      data: o.datSessaoQOrdem,
      autor: String(o.txtNomeAutorQOrdem || '').trim(),
      ementa,
      trecho: trechoAoRedor(o.txtQOrdemReduzido || '', termos),
    };
  }));
  return { termo: String(termo).trim(), total: achados.length, itens };
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
    (res.total > res.itens.length ? ` (mostrando as ${res.itens.length} mais recentes)` : '');
  return `${cab}\n\n${linhas.join('\n\n')}`;
}

module.exports = { buscarQO, formatarQO, aquecerCorpus, garantirCorpus };
