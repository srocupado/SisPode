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

const fs = require('fs');
const path = require('path');
const { normalizar, termosDe, construirIndice, ranquear } = require('./busca');

const BUSCA = 'https://www.camara.leg.br/busca-qordem-api/qordem/search';
const API = id => `https://www.camara.leg.br/busca-qordem-api/qordem/${id}`;
const DETALHE = id => `https://www.camara.leg.br/v-busca-qordem/${id}`;
const TAM_PAGINA = 2000;
const TTL_MS = 60 * 60e3;   // 1h
// (não uso ./config aqui: ele faz process.exit sem BOT_TOKEN e este módulo
// precisa rodar solto nos scripts de medição)
const CACHE_DET = path.join(__dirname, '..', 'dados', 'qordem-detalhes.json');
const HDR = { Accept: 'application/json', Referer: 'https://www.camara.leg.br/v-busca-qordem' };

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
let _idx = null, _idxTs = '';
function indice(corpus) {
  const chave = `${_corpusTs}:${_detTs}`;      // refaz quando o acervo OU o cache de detalhes muda
  if (_idx && _idxTs === chave) return _idx;
  _idx = construirIndice(corpus, textoDe);
  _idxTs = chave;
  return _idx;
}

/**
 * Aquece no arranque (background) — não bloqueia o boot. Indexa já com o que
 * houver em cache e, em paralelo, completa os detalhes que faltarem; ao
 * terminar, o índice se refaz sozinho na consulta seguinte.
 */
function aquecerCorpus() {
  carregarCacheDetalhes();
  garantirCorpus()
    .then(c => {
      if (!c.length) return;
      indice(c);
      console.log(`[qordem] acervo aquecido (${c.length} questões de ordem).`);
      enriquecerCorpus(c).catch(e => console.warn('[qordem] enriquecimento falhou:', e.message));
    })
    .catch(e => console.warn('[qordem] aquecimento falhou:', e.message));
}

// ---------- DETALHE por id: a EMENTA e os DISPOSITIVOS ----------
// A listagem devolve só o `txtQOrdemReduzido` — o trecho taquigráfico, que
// começa com o cabeçalho da sessão. MEDIDO numa amostra de 25 QOs: esse trecho
// é 6% do inteiro teor, e a EMENTA (o resumo que diz do que a QO trata, escrito
// por quem cataloga) NÃO vem na listagem — está em 98 de 100 QOs, só no detalhe.
//
// Por isso a busca perdia a QO 8/2023 (Kim Kataguiri, avocação): "avocação" só
// existe na ementa, e a ementa não estava no índice — era buscada DEPOIS, só
// para as 8 QOs já escolhidas.
//
// Buscar os 4.062 detalhes leva ~1min45s com concorrência 10 (26 ms/registro
// medidos). Faz-se UMA vez, em segundo plano, e grava em dados/ — nas próximas
// vezes só os ids novos (o acervo cresce ~150 QOs/ano).
const _det = new Map();     // id → { e: ementa, d: 'art52,art95' }
let _detTs = 0;             // muda quando o cache cresce → o índice se refaz
let _enriquecendo = null;

function carregarCacheDetalhes() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_DET, 'utf8'));
    for (const [id, v] of Object.entries(j.itens || {})) _det.set(Number(id), v);
    _detTs = _det.size;
    console.log(`[qordem] cache de detalhes: ${_det.size} QOs (${j.gerado || '?'}).`);
  } catch (_) { /* primeira execução: nasce vazio */ }
}

function gravarCacheDetalhes() {
  try {
    fs.mkdirSync(path.dirname(CACHE_DET), { recursive: true });
    fs.writeFileSync(CACHE_DET, JSON.stringify({
      gerado: new Date().toISOString().slice(0, 10),
      itens: Object.fromEntries(_det),
    }));
  } catch (e) { console.warn('[qordem] não gravou o cache de detalhes:', e.message); }
}

async function buscarDetalhe(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(API(id), { signal: ctrl.signal, headers: HDR });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      e: String(d.txtEmentaQOrdem || '').replace(/\s+/g, ' ').trim(),
      // "art52" e não "52": token de 2 letras seria descartado pela busca, e o
      // número solto casaria com qualquer ano/quórum do texto.
      d: (d.dispositivosRegimentaisQO || [])
        .map(x => `art${String(x.txtNumeroArtigo || '').trim()}`).filter(x => x !== 'art').join(' '),
    };
  } catch (_) { return null; }
  finally { clearTimeout(timer); }
}

// Concorrência 5: a carga inicial são 4 mil chamadas e acontece UMA vez. Com
// 10 o acervo saía em 80s (~50 req/s) — rápido demais para uma API pública que
// o bot também usa para o resto. Com 5 leva ~3 min, em segundo plano.
const CONCORRENCIA = 5;

/** Completa o cache com os ids ainda não baixados. */
async function enriquecerCorpus(corpus, { aoTerminar } = {}) {
  const faltam = corpus.map(o => o.numInternoQOrdem).filter(id => id != null && !_det.has(id));
  if (!faltam.length) return 0;
  console.log(`[qordem] baixando o detalhe de ${faltam.length} QOs (ementa + dispositivos)…`);
  const fila = [...faltam];
  let feitos = 0;
  await Promise.all(Array.from({ length: CONCORRENCIA }, async () => {
    let id;
    while ((id = fila.pop()) != null) {
      const d = await buscarDetalhe(id);
      if (d) { _det.set(id, d); feitos++; }
    }
  }));
  if (feitos) { _detTs = _det.size; gravarCacheDetalhes(); }
  console.log(`[qordem] detalhes completos: ${_det.size} QOs (+${feitos}).`);
  if (aoTerminar) aoTerminar();
  return feitos;
}

/** Ementa de uma QO (do cache; busca sob demanda se ainda não veio). */
async function carregarEmenta(id) {
  if (id == null) return '';
  if (_det.has(id)) return _det.get(id).e;
  const d = await buscarDetalhe(id);
  if (d) { _det.set(id, d); return d.e; }
  return '';
}

const textoDe = o => {
  const d = _det.get(o.numInternoQOrdem);
  return `${o.txtQOrdemReduzido || ''} ${o.txtNomeAutorQOrdem || ''} ${o.numQOrdemComAno || ''}` +
         (d ? ` ${d.e} ${d.e} ${d.d}` : '');   // ementa DUAS vezes: é o resumo curado do tema
};

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

// "QO 8/2023", "questão de ordem nº 8 de 2023", "8/2023" → "8/2023".
// Deliberadamente EXIGENTE (a consulta tem de ser só o número): "questão de
// ordem sobre a MPV 1346/2026" não pode virar pedido da QO 1346/2026.
const RX_NUM = /^(?:qo|questao de ordem|questoes de ordem)?\s*(?:n[º°o]?\.?\s*)?(\d{1,6})\s*(?:\/|\s+de\s+)\s*(\d{4})$/;
function numeroPedido(termo) {
  const m = normalizar(termo).trim().replace(/[?.!]+$/, '').match(RX_NUM);
  return m ? `${Number(m[1])}/${m[2]}` : null;
}

/** Monta os itens de saída, buscando a ementa de quem ainda não a tiver. */
function detalhar(achados, brutos) {
  return Promise.all(achados.map(async o => ({
    id: o.numInternoQOrdem,
    num: o.numQOrdemComAno || o.numQOrdem,
    data: o.datSessaoQOrdem,
    autor: String(o.txtNomeAutorQOrdem || '').trim(),
    ementa: await carregarEmenta(o.numInternoQOrdem),
    trecho: trechoAoRedor(o.txtQOrdemReduzido || '', brutos),
  })));
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
  const corpus = await garantirCorpus();
  if (!corpus.length) return { termo, total: 0, itens: [] };

  // Pedido por NÚMERO ("QO 8/2023") não é busca por tema: sem este atalho,
  // "8" era descartado por ser curto e sobrava "2023" — devolvia as 164 QOs
  // do ano, sem a pedida entre elas.
  const num = numeroPedido(termo);
  if (num) {
    const achados = corpus.filter(o => String(o.numQOrdemComAno) === num);
    return { termo: String(termo).trim(), porNumero: num, total: achados.length,
             itens: await detalhar(achados.slice(0, limite), []) };
  }

  // "art. 52" / "artigo 52" → token único, para casar com o dispositivo
  // regimental que a QO invoca (o número solto casaria com qualquer ano).
  const termos = termosDe(normalizar(termo).replace(/\bart(?:igo)?s?\.?\s*(\d{1,3})/g, 'art$1'));
  if (!termos.length) return { termo, total: 0, itens: [] };
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
  const itens = await detalhar(achados.slice(0, limite), brutos);
  return { termo: String(termo).trim(), total: achados.length, itens,
           termosBuscados: termos.length, termosCasados: maxCob };
}

/** Texto pronto para o comando e o agente. */
function formatarQO(res) {
  if (!res.total) {
    return res.porNumero
      ? `Não existe questão de ordem ${res.porNumero} no acervo da Câmara.`
      : `Não encontrei questão de ordem mencionando "${res.termo}".`;
  }
  const resumo = x => {
    const e = (x.ementa || '').trim();
    const texto = e ? (e.length > 240 ? e.slice(0, 240).replace(/\s+\S*$/, '') + '…' : e) : x.trecho;
    return texto;
  };
  const linhas = res.itens.map(x =>
    `• *QO ${x.num}* — ${x.data}${x.autor ? ` · ${x.autor}` : ''}\n  ${resumo(x)}\n  🔗 Íntegra: ${DETALHE(x.id)}`);
  if (res.porNumero) {
    return `🔎 *QO ${res.porNumero}*\n\n${res.itens.map(x =>
      `${x.data}${x.autor ? ` · ${x.autor}` : ''}\n${(x.ementa || x.trecho)}\n\n🔗 Íntegra: ${DETALHE(x.id)}`).join('\n\n')}`;
  }
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

module.exports = { buscarQO, formatarQO, formatarQOCompacto, aquecerCorpus, garantirCorpus,
                   carregarCacheDetalhes, enriquecerCorpus };
