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
const { normalizar, termosDe, construirIndice, ranquear,
        expandirArtigos, bigramasDe, adjacencia } = require('./busca');

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

// ---------- Busca por FASE ----------
// "tem algum RECURSO que fale de prejudicialidade?" não é a mesma pergunta que
// "tem alguma QO que fale de prejudicialidade?". No índice geral as fases viram
// um texto só, e "recurso" passa a ser mais uma palavra: a busca devolvia QOs
// cuja DECISÃO casava com o tema, sem recurso nenhum, e a resposta saía como se
// fossem recursos. Aqui a fase VIRA FILTRO — só entram as QOs que têm aquela
// peça, e o casamento é no texto dela.
const FASES = { recurso: 'rec', decisao: 'dec', contradita: 'cd' };
const _idxFase = new Map();     // campo → { chave, itens, idx }

function indiceFase(corpus, campo) {
  const chave = `${_corpusTs}:${_detTs}`;
  const cache = _idxFase.get(campo);
  if (cache && cache.chave === chave) return cache;
  const itens = corpus.filter(o => (_det.get(o.numInternoQOrdem) || {})[campo]);
  const novo = { chave, itens, idx: construirIndice(itens, o => _det.get(o.numInternoQOrdem)[campo]) };
  _idxFase.set(campo, novo);
  return novo;
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

// ---------- DETALHE por id: o registro CURADO da questão de ordem ----------
// A listagem devolve só o `txtQOrdemReduzido` — o trecho taquigráfico, que
// começa com o cabeçalho da sessão. MEDIDO: esse trecho é 6% do inteiro teor, e
// tudo que a Câmara CATALOGA sobre a QO só vem no detalhe por id. Medido numa
// amostra de 204 QOs de todo o acervo (1953–2026):
//
//   ementa da QO ......... 98%   346 ch    ← o que se pergunta
//   ementa da DECISÃO .... 86%   460 ch    ← como a Presidência resolveu
//   indexação (tesauro) .. 63%   136 ch
//   ementa do RECURSO .... 19%   193 ch
//   ementa da CONTRADITA . 16%   331 ch
//   inteiro teor ......... 98% 8.361 ch
//
// O INTEIRO TEOR ficou de fora — por ora, e com medição, não por suposição.
// Numa amostra de 508 QOs o recall melhora de verdade:
//
//   "retirada de pauta" ......... 26 → 61   novos PERTINENTES
//   "adiamento de discussão" .... 15 → 42   novos PERTINENTES
//   "prejudicialidade de emenda"  18 → 58   novos PERTINENTES
//   "destaque p/ votação sep." .. 19 → 35   novos PERTINENTES
//   "apreciação conclusiva" ...... 4 → 83   novos RUIDOSOS
//
// Mas ao ligar no acervo inteiro os totais estouram — "apreciação conclusiva"
// 21 → 623, "ata de comissão" 3 → 131 —, o cache vai de 4,3 MB para 29,5 MB, o
// índice de 1,3 s para 7,2 s e o heap para 121 MB. A adjacência ordena bem o
// topo, mas o número que o usuário lê deixa de significar algo. Falta avaliar a
// relevância do que entrou antes de ligar; nos RECURSOS (./recursos) o inteiro
// teor JÁ está ligado, porque lá é a petição — texto só do caso — e não a
// taquigrafia da sessão em volta.
//
// Baixar os 4.062 detalhes leva ~3 min com concorrência 5. Faz-se UMA vez, em
// segundo plano, e grava em dados/ — depois só os ids novos (~150 QOs/ano).
const VERSAO_CACHE = 2;
const _det = new Map();     // id → { e, i, dec, pres, rec, cd, obs, d }
let _detTs = 0;             // muda quando o cache cresce → o índice se refaz
let _enriquecendo = null;

function carregarCacheDetalhes() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_DET, 'utf8'));
    if (j.versao !== VERSAO_CACHE) {
      console.log(`[qordem] cache de detalhes é da versão ${j.versao || 1} — será recolhido.`);
      return;
    }
    for (const [id, v] of Object.entries(j.itens || {})) _det.set(Number(id), v);
    _detTs = _det.size;
    console.log(`[qordem] cache de detalhes: ${_det.size} QOs (${j.gerado || '?'}).`);
  } catch (_) { /* primeira execução: nasce vazio */ }
}

function gravarCacheDetalhes() {
  try {
    fs.mkdirSync(path.dirname(CACHE_DET), { recursive: true });
    fs.writeFileSync(CACHE_DET, JSON.stringify({
      versao: VERSAO_CACHE,
      gerado: new Date().toISOString().slice(0, 10),
      itens: Object.fromEntries(_det),
    }));
  } catch (e) { console.warn('[qordem] não gravou o cache de detalhes:', e.message); }
}

const limpo = v => String(v || '').replace(/\s+/g, ' ').trim();

async function buscarDetalhe(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(API(id), { signal: ctrl.signal, headers: HDR });
    if (!r.ok) return null;
    const d = await r.json();
    // Dispositivos invocados em QUALQUER fase (a QO, a contradita, a decisão e
    // o recurso), como "art52": token de 2 letras seria descartado pela busca, e
    // o número solto casaria com qualquer ano ou quórum do texto.
    const disp = [...new Set(
      [...(d.dispositivosRegimentaisQO || []), ...(d.dispositivosRegimentaisCD || []),
       ...(d.dispositivosRegimentaisDE || []), ...(d.dispositivosRegimentaisRE || [])]
        .map(x => `art${String(x.txtNumeroArtigo || '').trim()}`).filter(x => x !== 'art'))];
    return {
      e:    limpo(d.txtEmentaQOrdem),                          // do que trata a QO
      i:    [d.txtIndexacaoQOrdem, d.txtIndexacaoCDita, d.txtIndexacaoDecisao,
             d.txtIndexacaoRecurso].map(limpo).filter(Boolean).join(' '),   // tesauro
      dec:  limpo(d.txtEmentaDecisao),                         // como a Presidência resolveu
      pres: limpo(d.txtNomePresidenteDecisao),
      rec:  limpo(d.txtEmentaRecurso),                         // o recurso contra a decisão
      cd:   limpo(d.txtEmentaCDita),                           // a contradita
      obs:  limpo(d.txtObservacaoQOrdem),
      d:    disp.join(' '),
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

const VAZIO = { e: '', i: '', dec: '', pres: '', rec: '', cd: '', obs: '', d: '' };

/** Registro curado de uma QO (do cache; busca sob demanda se ainda não veio). */
async function carregarDet(id) {
  if (id == null) return VAZIO;
  if (_det.has(id)) return _det.get(id);
  const d = await buscarDetalhe(id);
  if (d) { _det.set(id, d); return d; }
  return VAZIO;
}

const textoDe = o => {
  const d = _det.get(o.numInternoQOrdem);
  const base = `${o.txtQOrdemReduzido || ''} ${o.txtNomeAutorQOrdem || ''} ${o.numQOrdemComAno || ''}`;
  if (!d) return base;
  // A ementa e o tesauro entram DUAS vezes: são texto curado, escrito para
  // dizer do que a QO trata, enquanto o trecho taquigráfico traz junto tudo o
  // que se falou em volta. Decisão, recurso e contradita entram uma vez —
  // pertencem à QO, mas descrevem outra fase dela.
  return expandirArtigos(
    `${base} ${d.e} ${d.e} ${d.i} ${d.i} ${d.dec} ${d.rec} ${d.cd} ${d.obs} ${d.d}`);
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

/** Monta os itens de saída, buscando o detalhe de quem ainda não o tiver. */
function detalhar(achados, brutos) {
  return Promise.all(achados.map(async o => {
    const d = await carregarDet(o.numInternoQOrdem);
    return {
      id: o.numInternoQOrdem,
      num: o.numQOrdemComAno || o.numQOrdem,
      data: o.datSessaoQOrdem,
      autor: String(o.txtNomeAutorQOrdem || '').trim(),
      ementa: d.e,
      decisao: d.dec,
      // A API devolve "ULYSSES GUIMARÃES (null-null)" quando não tem o
      // partido/UF da época.
      presidente: d.pres.replace(/\s*\([^)]*null[^)]*\)\s*$/i, '').trim(),
      recurso: d.rec,
      contradita: d.cd,
      trecho: trechoAoRedor(o.txtQOrdemReduzido || '', brutos),
    };
  }));
}

const cortar = (t, n) => {
  const s = String(t || '').trim();
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
};

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
async function buscarQO(termo, { limite = 8, fase } = {}) {
  const corpus = await garantirCorpus();
  if (!corpus.length) return { termo, total: 0, itens: [] };

  // Aceita a fase colada no termo ("recurso: prejudicialidade"), para o
  // comando /qo ter o mesmo alcance que o agente.
  let consulta = String(termo || '');
  const pref = normalizar(consulta).match(/^(recurso|decisao|contradita)s?\s*:\s*(.+)$/);
  if (pref) { fase = pref[1]; consulta = consulta.slice(consulta.indexOf(':') + 1).trim(); }
  const campo = FASES[normalizar(fase || '')] || null;

  // Pedido por NÚMERO ("QO 8/2023") não é busca por tema: sem este atalho,
  // "8" era descartado por ser curto e sobrava "2023" — devolvia as 164 QOs
  // do ano, sem a pedida entre elas.
  const num = numeroPedido(consulta);
  if (num) {
    const achados = corpus.filter(o => String(o.numQOrdemComAno) === num);
    return { termo: String(termo).trim(), porNumero: num, total: achados.length,
             itens: await detalhar(achados.slice(0, limite), []) };
  }

  // "art. 52" / "artigo 52" → token único, para casar com o dispositivo
  // regimental que a QO invoca (o número solto casaria com qualquer ano).
  const termos = termosDe(expandirArtigos(consulta));
  if (!termos.length) return { termo, total: 0, itens: [] };

  // Com fase, o universo é só quem tem aquela peça e o casamento é no texto
  // dela; sem fase, é o acervo inteiro no índice geral.
  const alvo = campo ? indiceFase(corpus, campo) : { itens: corpus, idx: indice(corpus) };
  const base = { termo: String(termo).trim(), consulta: consulta.trim(),
                 fase: campo ? normalizar(fase) : null, universo: alvo.itens.length };

  const rank = ranquear(alvo.itens, alvo.idx, termos);
  if (!rank.length) return { ...base, total: 0, itens: [] };
  const cobertura = r => termos.reduce((s, t) => s + (alvo.idx.docs[r.indice].tf.has(t) ? 1 : 0), 0);
  let maxCob = 0;
  for (const r of rank) { const c = cobertura(r); r._cob = c; if (c > maxCob) maxCob = c; }
  // O corte é o nível mais estrito alcançável. Mas se ele não enche nem uma
  // página, já estamos em melhor-esforço: descer um nível mostra candidatos
  // que o corte escondia, em vez de fingir que a resposta é só aquela.
  let piso = maxCob;
  const noNivel = p => rank.filter(r => r._cob >= p);
  if (noNivel(piso).length < limite && piso > 1) piso--;
  let sel = noNivel(piso);

  // EXPRESSÃO grudada vale mais: quem tem "apreciação conclusiva" literal vem
  // antes de quem tem "a apreciação ... que concluem". Isto ORDENA, não filtra —
  // como filtro derrubava "ata de comissão" de 24 para 3 e perdia resultados
  // bons ("o Presidente da CCJC não observou a ata"), porque nem toda dupla de
  // palavras é expressão consagrada.
  // Só os melhores por BM25 são conferidos; abaixo disso a releitura do texto
  // não pagaria o custo.
  const pares = bigramasDe(consulta);
  if (pares.length) {
    for (const r of sel.slice(0, 400)) {
      r._adj = adjacencia(campo ? _det.get(r.item.numInternoQOrdem)[campo] : textoDe(r.item), pares);
    }
  }
  const achados = sel
    .sort((a, b) => (b._adj || 0) - (a._adj || 0) || b.score - a.score || dataOrd(b.item) - dataOrd(a.item))
    .map(r => r.item);

  // Para destacar o trecho usamos as palavras COMO FORAM ESCRITAS (o radical
  // "comis" não aparece no texto; "comissão" aparece).
  const brutos = normalizar(consulta).split(/[^\wà-ú]+/i).filter(t => t.length > 2);
  const itens = await detalhar(achados.slice(0, limite), brutos);
  return { ...base, total: achados.length, itens,
           termosBuscados: termos.length, termosCasados: maxCob };
}

const ROTULO = { recurso: ['recurso', 'recursos'], decisao: ['decisão', 'decisões'],
                 contradita: ['contradita', 'contraditas'] };

/** Texto pronto para o comando e o agente. */
function formatarQO(res) {
  const rot = ROTULO[res.fase];
  if (!res.total) {
    if (res.porNumero) return `Não existe questão de ordem ${res.porNumero} no acervo da Câmara.`;
    // Com fase, a ausência é RESPOSTA — e precisa ser dita como tal, senão a
    // pergunta "tem algum recurso sobre X?" volta respondida com outra coisa.
    if (rot) {
      return `Nenhum ${rot[0]} no acervo menciona "${res.consulta}".\n` +
        `_Busquei no texto ${res.fase === 'contradita' ? 'das' : 'dos'} ${res.universo} ${rot[1]} registrad${res.fase === 'contradita' ? 'a' : 'o'}s — não no restante das questões de ordem._`;
    }
    return `Não encontrei questão de ordem mencionando "${res.termo}".`;
  }
  // Pedido por número: a QO inteira, com as fases que existirem.
  if (res.porNumero) {
    return `🔎 *QO ${res.porNumero}*\n\n${res.itens.map(x => [
      `${x.data}${x.autor ? ` · ${x.autor}` : ''}`,
      x.ementa || x.trecho,
      x.contradita ? `\n✋ *Contradita:* ${x.contradita}` : '',
      x.decisao ? `\n⚖️ *Decisão*${x.presidente ? ` (${x.presidente})` : ''}: ${x.decisao}` : '',
      x.recurso ? `\n📄 *Recurso:* ${x.recurso}` : '',
      `\n🔗 Íntegra: ${DETALHE(x.id)}`,
    ].filter(Boolean).join('\n')).join('\n\n')}`;
  }
  // Buscando por fase, o que casou é o texto DAQUELA peça — ela vem primeiro,
  // com a ementa só situando o caso.
  const linhas = res.fase
    ? res.itens.map(x => {
        const peca = { recurso: x.recurso, decisao: x.decisao, contradita: x.contradita }[res.fase];
        const icone = { recurso: '📄', decisao: '⚖️', contradita: '✋' }[res.fase];
        return `• *QO ${x.num}* — ${x.data}${x.autor ? ` · ${x.autor}` : ''}\n  ${icone} ${cortar(peca, 300)}` +
               (x.ementa ? `\n  _Caso:_ ${cortar(x.ementa, 140)}` : '') +
               `\n  🔗 Íntegra: ${DETALHE(x.id)}`;
      })
    // Na lista comum, a decisão vai resumida: é ela que responde "e no que deu?".
    : res.itens.map(x =>
        `• *QO ${x.num}* — ${x.data}${x.autor ? ` · ${x.autor}` : ''}\n  ${cortar(x.ementa, 240) || x.trecho}` +
        (x.decisao ? `\n  ⚖️ ${cortar(x.decisao, 180)}` : '') +
        `\n  🔗 Íntegra: ${DETALHE(x.id)}`);
  const cab = (rot
      ? `🔎 ${rot[1][0].toUpperCase()}${rot[1].slice(1)} mencionando "${res.consulta}": *${res.total}*` +
        ` (de ${res.universo} no acervo)`
      : `🔎 Questões de ordem com "${res.termo}": *${res.total}*`) +
    (res.total > res.itens.length ? ` — mostrando ${res.itens.length}` : '');
  // Sem isto o usuário não sabe se o resultado é exaustivo ou já é o "melhor
  // possível" — e ele decide se vale reformular com menos palavras.
  const parcial = res.termosCasados < res.termosBuscados
    ? `\n_Nenhum${rot ? '' : 'a'} ${rot ? rot[0] : 'QO'} reúne todos os termos; ` +
      `${rot ? 'estes' : 'estas'} reúnem ${res.termosCasados} de ${res.termosBuscados}._`
    : '';
  return `${cab}${parcial}\n\n${linhas.join('\n\n')}`;
}

/** Versão COMPACTA — para anexar como precedente a outra resposta (ex.: /regimento). */
function formatarQOCompacto(res, { titulo = '⚖️ *Precedente — questões de ordem sobre o tema*' } = {}) {
  if (!res.total) return '';
  // Como precedente, o que vale é a DECISÃO — a ementa só situa o caso.
  const linhas = res.itens.map(x =>
    `• *QO ${x.num}* — ${x.data}${x.autor ? ` · ${x.autor}` : ''}\n  ${cortar(x.ementa || x.trecho, 150)}` +
    (x.decisao ? `\n  ⚖️ ${cortar(x.decisao, 200)}` : '') +
    `\n  🔗 ${DETALHE(x.id)}`);
  const mais = res.total > res.itens.length
    ? `\n\n(${res.total} no total — veja as demais com /qo ${res.termo})` : '';
  return `${titulo} (${res.total})\n\n${linhas.join('\n\n')}${mais}`;
}

module.exports = { buscarQO, formatarQO, formatarQOCompacto, aquecerCorpus, garantirCorpus,
                   carregarCacheDetalhes, enriquecerCorpus };
