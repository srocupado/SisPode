'use strict';
// RECURSOS (proposições do tipo REC) — base DIFERENTE da de questões de ordem.
//
// "Recurso" tem dois sentidos na Casa e eu tinha só um deles:
//
//   1. o recurso REGISTRADO DENTRO de uma questão de ordem (campo
//      txtEmentaRecurso do acervo de QO) — é o que ./questaoordem busca com
//      {fase:'recurso'};
//   2. o RECURSO como PROPOSIÇÃO — "REC 260/2013" —, protocolado contra uma
//      decisão. Este vive nos Dados Abertos e NÃO estava em lugar nenhum.
//
// O segundo é bem maior e cobre situações que nunca aparecem no acervo de QO:
// recurso contra apreciação conclusiva de comissão, contra apensação, contra
// declaração de prejudicialidade, contra indeferimento de RIC. São 27 subtipos,
// cada um amarrado a um artigo do Regimento — e o SUBTIPO já é o assunto
// ("Recurso contra declaração de prejudicialidade, Art. 164, § 2º").
//
// O tema costuma NÃO estar na ementa: a do REC 260/2013 diz apenas "Recorre ao
// Presidente da Câmara contra decisão do Presidente da Comissão de Finanças e
// Tributação". Está no DESPACHO da tramitação — "deferindo o Recurso n.
// 260/2013 ... anulação dos atos que se seguiram à declaração de
// prejudicialidade" — e, sobretudo, no INTEIRO TEOR: é a petição do recorrente
// que diz "prejudicando o requerimento de adiamento de discussão ... em virtude
// da rejeição de requerimento de retirada de pauta". Nem ementa nem despacho
// têm "retirada de pauta"; o PDF tem.
//
// Por isso baixamos o PDF e indexamos o texto dele. MEDIDO na coleta real dos
// 2.493: 5,5 min, cache de 9,5 MB, 42 MB de heap. Cerca de 1 em 3 PDFs é
// digitalizado, sem camada de texto — todos antigos; é limitação da fonte, não
// do bot.
//
// Dados Abertos aqui é fonte legítima: é acervo histórico, não tempo real. A
// restrição de nunca depender dele para TIMING de sessão continua valendo.

const fs = require('fs');
const path = require('path');
const { normalizar, termosDe, construirIndice, ranquear,
        expandirArtigos, bigramasDe, adjacencia } = require('./busca');

const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const FICHA = id => `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${id}`;
const CACHE = path.join(__dirname, '..', 'dados', 'recursos.json');
const HDR = { Accept: 'application/json' };
const ANO_INICIAL = 1988;
const CONCORRENCIA = 5;
const MAX_PAGINAS = 15;          // petição de recurso raramente passa disso
const MAX_TEXTO = 20000;         // mediana medida: 5.4 mil caracteres
const VERSAO_CACHE = 2;   // v2 acrescentou o inteiro teor do PDF
// Recursos deste período ainda podem tramitar — o despacho que decide costuma
// vir semanas depois. Os antigos estão fechados e não se recoletam.
const DIAS_QUENTES = 400;

let _itens = [];            // [{ id, n, a, em, dt, ct, aut, desp }]
let _tipos = {};            // codTipo → "Recurso contra ..."
let _idx = null, _idxTs = 0;
let _carregando = null;

const g = async (url, ms = 20000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: HDR });
    return r.ok ? await r.json() : null;
  } catch (_) { return null; }
  finally { clearTimeout(timer); }
};

const limpo = v => String(v || '').replace(/\s+/g, ' ').trim();

// ---------- cache em disco ----------
function carregarCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (j.versao !== VERSAO_CACHE) {
      console.log(`[recursos] cache é da versão ${j.versao || 0} — será recolhido.`);
      return;
    }
    _itens = j.itens || [];
    _tipos = j.tipos || {};
    _idxTs = 0;
    console.log(`[recursos] cache: ${_itens.length} recursos (${j.gerado || '?'}).`);
  } catch (_) { /* primeira execução */ }
}

function gravarCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify({
      versao: VERSAO_CACHE, gerado: new Date().toISOString().slice(0, 10),
      tipos: _tipos, itens: _itens,
    }));
  } catch (e) { console.warn('[recursos] não gravou o cache:', e.message); }
}

// ---------- coleta ----------
async function listarAno(ano) {
  const out = [];
  for (let pagina = 1; pagina <= 30; pagina++) {
    const j = await g(`${API}/proposicoes?siglaTipo=REC&ano=${ano}&itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=id`);
    const d = (j && j.dados) || [];
    out.push(...d);
    if (d.length < 100) break;
  }
  return out;
}

/**
 * Texto do PDF da petição. Devolve '' quando o PDF é digitalizado (sem camada
 * de texto) — cerca de 1 em 3, todos antigos; não há o que extrair.
 */
async function inteiroTeor(url) {
  if (!url) return '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let buf;
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) return '';
      buf = new Uint8Array(await r.arrayBuffer());
    } finally { clearTimeout(timer); }
    const doc = await pdfjs.getDocument({ data: buf, verbosity: 0 }).promise;
    let t = '';
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGINAS); i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      t += c.items.map(x => x.str).join(' ') + ' ';
      if (t.length > MAX_TEXTO) break;
    }
    await doc.destroy().catch(() => {});
    t = limpo(t).slice(0, MAX_TEXTO);
    return t.length < 120 ? '' : t;     // digitalizado
  } catch (_) { return ''; }
}

/** Autor, despachos e inteiro teor — é fora da ementa que mora o assunto. */
async function detalharUm(p) {
  const [det, tr, au] = await Promise.all([
    g(`${API}/proposicoes/${p.id}`),
    g(`${API}/proposicoes/${p.id}/tramitacoes`),
    g(`${API}/proposicoes/${p.id}/autores`),
  ]);
  const desp = ((tr && tr.dados) || [])
    .map(t => limpo(t.despacho || t.descricaoTramitacao)).filter(Boolean);
  const url = (det && det.dados && det.dados.urlInteiroTeor) || '';
  return {
    id: p.id, n: p.numero, a: p.ano, ct: p.codTipo,
    em: limpo(p.ementa),
    dt: String(p.dataApresentacao || '').slice(0, 10),
    aut: ((au && au.dados) || []).map(x => limpo(x.nome)).filter(Boolean).join(', '),
    desp: [...new Set(desp)].join(' · '),
    url,
    it: await inteiroTeor(url),
  };
}

/**
 * Baixa o que falta. Recursos antigos são imutáveis e não se recoletam; os dos
 * últimos ~13 meses são atualizados, porque o despacho que decide o recurso
 * costuma entrar semanas depois da apresentação.
 */
async function coletar() {
  if (!Object.keys(_tipos).length) {
    const t = await g(`${API}/referencias/tiposProposicao`);
    for (const x of (t && t.dados) || []) if (x.sigla === 'REC') _tipos[x.cod] = limpo(x.nome);
  }
  const anoAtual = new Date().getFullYear();
  const anos = [];
  for (let a = ANO_INICIAL; a <= anoAtual; a++) anos.push(a);

  // Só relista os anos que ainda podem crescer, se já houver acervo em cache.
  const jaTem = new Set(_itens.map(x => x.id));
  const relistar = _itens.length ? anos.filter(a => a >= anoAtual - 1) : anos;
  const listados = [];
  {
    const fila = [...relistar];
    await Promise.all(Array.from({ length: CONCORRENCIA }, async () => {
      let a;
      while ((a = fila.pop()) != null) listados.push(...await listarAno(a));
    }));
  }

  const limite = Date.now() - DIAS_QUENTES * 864e5;
  const quente = x => new Date(x.dt || x.dataApresentacao || 0).getTime() > limite;
  const pendentes = listados.filter(p => !jaTem.has(p.id) || quente(p));
  if (!pendentes.length) return 0;

  console.log(`[recursos] baixando ${pendentes.length} recursos (autor + despachos)…`);
  const porId = new Map(_itens.map(x => [x.id, x]));
  const fila = [...pendentes];
  let feitos = 0;
  await Promise.all(Array.from({ length: CONCORRENCIA }, async () => {
    let p;
    while ((p = fila.pop())) {
      const r = await detalharUm(p).catch(() => null);
      if (r) { porId.set(r.id, r); feitos++; }
    }
  }));
  _itens = [...porId.values()].sort((x, y) => y.a - x.a || y.n - x.n);
  _idxTs = 0;
  gravarCache();
  console.log(`[recursos] acervo: ${_itens.length} recursos (+${feitos}).`);
  return feitos;
}

/** Garante o acervo; chamadas concorrentes compartilham a mesma coleta. */
async function garantirRecursos() {
  if (_itens.length) return _itens;
  if (!_carregando) _carregando = coletar().finally(() => { _carregando = null; });
  try { await _carregando; } catch (_) { /* fica com o que houver */ }
  return _itens;
}

/** Aquece no arranque (background) — não bloqueia o boot. */
function aquecerRecursos() {
  carregarCache();
  if (_itens.length) indice();
  coletar()
    .then(() => { if (_itens.length) indice(); })
    .catch(e => console.warn('[recursos] coleta falhou:', e.message));
}

// ---------- busca ----------
// Dos 16.943 despachos do acervo, a maioria esmagadora é ROTEIRO — "Encaminhada
// à publicação" (1.640), "Arquivado nos termos" (1.062), "Recebimento pela
// CCJC" (596), "Submeta-se ao Plenário" (582). Indexar tudo fazia um recurso
// com 35 tramitações juntar termos de linhas sem relação nenhuma entre si e
// vencer o recurso certo: na busca por "prejudicialidade, adiamento de
// discussão e retirada de pauta", o REC 2/2024 (5.200 caracteres de trâmite)
// casava os 6 termos e o REC 260/2013 ficava de fora.
//
// Ficam só as duas linhas que dizem algo: a APRESENTAÇÃO (que transcreve o
// pedido do recorrente) e as DECISÓRIAS.
const RX_UTIL = /defer|provimento|decis[ãa]o da presid|anula|prejudic|parecer|conhec|aprovad|rejeitad/i;
const RX_PEDIDO = /^apresenta[çc][ãa]o d[oe] (recurso|rec\b)/i;
const despachosUteis = desp => String(desp || '').split(' · ')
  .filter(d => RX_PEDIDO.test(d) || RX_UTIL.test(d));

// O SUBTIPO entra duas vezes: "Recurso contra declaração de prejudicialidade"
// é a descrição jurídica do que o recurso é, e nem sempre a ementa repete isso.
const textoDe = x => expandirArtigos(
  `REC ${x.n}/${x.a} ${_tipos[x.ct] || ''} ${_tipos[x.ct] || ''} ${x.em} ${x.em} ` +
  `${x.aut} ${despachosUteis(x.desp).join(' ')} ${x.it || ''}`);

function indice() {
  if (_idx && _idxTs === _itens.length) return _idx;
  _idx = construirIndice(_itens, textoDe);
  _idxTs = _itens.length;
  return _idx;
}

const RX_NUM = /^(?:rec|recurso)?\s*(?:n[º°o]?\.?\s*)?(\d{1,6})\s*(?:\/|\s+de\s+)\s*(\d{4})$/;
function numeroPedido(termo) {
  const m = normalizar(termo).trim().replace(/[?.!]+$/, '').match(RX_NUM);
  return m ? { n: Number(m[1]), a: Number(m[2]) } : null;
}

const saida = x => ({
  id: x.id, num: `${x.n}/${x.a}`, data: x.dt, autor: x.aut,
  tipo: _tipos[x.ct] || 'Recurso', ementa: x.em, despachos: x.desp,
});

/**
 * Busca recursos (proposições REC) por tema, número ou artigo.
 * Mesmo critério da busca de QO: BM25 sobre termos radicalizados, e só entram
 * os recursos com a MAIOR COBERTURA de termos alcançável.
 */
async function buscarRecurso(termo, { limite = 6 } = {}) {
  const itens = await garantirRecursos();
  if (!itens.length) return { termo, total: 0, itens: [] };

  const num = numeroPedido(termo);
  if (num) {
    const achados = itens.filter(x => x.n === num.n && x.a === num.a);
    return { termo: String(termo).trim(), porNumero: `${num.n}/${num.a}`,
             total: achados.length, itens: achados.slice(0, limite).map(saida) };
  }

  const termos = termosDe(expandirArtigos(termo));
  if (!termos.length) return { termo, total: 0, itens: [] };
  const idx = indice();

  const rank = ranquear(itens, idx, termos);
  const base = { termo: String(termo).trim(), universo: itens.length };
  if (!rank.length) return { ...base, total: 0, itens: [] };
  let maxCob = 0;
  for (const r of rank) {
    r._cob = termos.reduce((s, t) => s + (idx.docs[r.indice].tf.has(t) ? 1 : 0), 0);
    if (r._cob > maxCob) maxCob = r._cob;
  }
  // Se o nível mais estrito não enche nem a página, já estamos em melhor-
  // esforço: descer um nível mostra candidatos que o corte escondia.
  let piso = maxCob;
  const noNivel = p => rank.filter(r => r._cob >= p);
  if (noNivel(piso).length < limite && piso > 1) piso--;
  const sel = noNivel(piso);

  // Expressão grudada ("retirada de pauta") vale mais que as mesmas palavras
  // espalhadas pelo documento. Ordena, não filtra.
  const pares = bigramasDe(termo);
  if (pares.length) for (const r of sel.slice(0, 400)) r._adj = adjacencia(textoDe(r.item), pares);
  const achados = sel
    .sort((a, b) => (b._adj || 0) - (a._adj || 0) || b.score - a.score)
    .map(r => r.item);
  return { ...base, total: achados.length, itens: achados.slice(0, limite).map(saida),
           termosBuscados: termos.length, termosCasados: piso };
}

const cortar = (t, n) => {
  const s = String(t || '').trim();
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
};

// Na resposta mostramos o desfecho: o último despacho que DECIDE. A linha de
// apresentação fica de fora — ela transcreve o pedido (que a ementa já diz) e,
// citando o tema, passava por decisão em recurso ainda não julgado.
const decisorio = d => (String(d || '').split(' · ')
  .filter(p => !RX_PEDIDO.test(p) && /defer|provimento|decis[ãa]o da presid|anula|conhec/i.test(p))
  .pop()) || '';

function formatarRecurso(res) {
  if (!res.total) {
    return res.porNumero
      ? `Não existe recurso ${res.porNumero} no acervo da Câmara.`
      : `Nenhum recurso menciona "${res.termo}".\n_Busquei nos ${res.universo || 0} recursos (proposições REC) apresentados desde 1990 — ementa, subtipo regimental, autor e despachos._`;
  }
  const linhas = res.itens.map(x => {
    const dec = decisorio(x.despachos);
    return `• *REC ${x.num}* — ${x.data}${x.autor ? ` · ${x.autor}` : ''}\n` +
      `  _${x.tipo}_\n  ${cortar(x.ementa, 220)}` +
      (dec ? `\n  ⚖️ ${cortar(dec, 260)}` : '') +
      `\n  🔗 Tramitação: ${FICHA(x.id)}`;
  });
  if (res.porNumero) return `🔎 *REC ${res.porNumero}*\n\n${linhas.join('\n\n')}`;
  const cab = `🔎 Recursos com "${res.termo}": *${res.total}*` +
    (res.total > res.itens.length ? ` — mostrando ${res.itens.length}` : '');
  const parcial = res.termosCasados < res.termosBuscados
    ? `\n_Nenhum recurso reúne todos os termos; estes reúnem ${res.termosCasados} de ${res.termosBuscados}._`
    : '';
  return `${cab}${parcial}\n\n${linhas.join('\n\n')}`;
}

module.exports = { buscarRecurso, formatarRecurso, aquecerRecursos, garantirRecursos, carregarCache };
