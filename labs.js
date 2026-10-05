'use strict';
// Labs — área de desenvolvimento de novas soluções.
//
// Dentro dela se desenvolvem e testam funcionalidades; quando homologadas, elas
// saem para integrar novos módulos ou módulos já existentes. Por isso o código
// daqui é deliberadamente AUTOCONTIDO: cada protótipo (labs-simulador.js,
// labs-mapa.js) depende só deste arquivo e de ia-comum.js,
// e pode ser levado para outro módulo sem arrastar o resto do Labs.
//
// Este arquivo tem o que os protótipos compartilham: acesso à API da Câmara,
// a coleta das votações do Plenário num período (em janelas — a API recusa
// mais de 3 meses e perde o último dia de cada intervalo), a leitura da
// orientação de um partido que esteja dentro de bloco, a configuração de IA e
// as abas.

const LABS_API = 'https://dadosabertos.camara.leg.br/api/v2';
const LABS_FIREBASE = 'https://plenario-podemos-default-rtdb.firebaseio.com';
// Mesmo cache de votações da aba Aderência (aderencia.js): votos e orientações
// de uma votação encerrada não mudam, e quem já consultou poupa a API para os
// outros. Mesmo formato compacto, para os dois módulos se servirem dele.
const LABS_CACHE_VOT = '/aderencia-cache';

// ---------- utilitários ----------
function labsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// modelo-ia.js (o ⚙ de IA, compartilhado com Relatórios) usa o cvEsc de
// aderencia.js, que esta página não carrega.
if (typeof cvEsc === 'undefined') var cvEsc = labsEsc;   // eslint-disable-line no-var

function labsNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function labsIsoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const labsDormir = ms => new Promise(r => setTimeout(r, ms));

/** GET JSON com até 3 tentativas em 429/5xx/rede. Erro sobe: falha não é vazio. */
async function labsJson(url, opcoes) {
  let ultimo = null;
  for (let t = 0; t < 3; t++) {
    if (t) await labsDormir(600 * t);
    try {
      const r = await fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, opcoes || {}));
      if (r.ok) return await r.json();
      ultimo = new Error('HTTP ' + r.status);
      ultimo.status = r.status;
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) { ultimo = e; }
  }
  throw ultimo;
}

async function labsMapLimit(itens, limite, fn, aoAndar) {
  const out = new Array(itens.length);
  let i = 0, feitos = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const k = i++;
      try { out[k] = await fn(itens[k], k); } catch (e) { out[k] = null; }
      feitos++;
      if (aoAndar) aoAndar(feitos, itens.length);
    }
  }));
  return out;
}

function labsStatus(id, msg, tipo) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) { el.innerHTML = ''; el.className = 'status'; return; }
  if (tipo === 'loading') {
    el.className = 'status';
    el.innerHTML = '<div class="spinner"></div><div>' + msg + '</div>';
  } else {
    el.className = 'status' + (tipo === 'error' ? ' error' : '');
    el.textContent = msg;
  }
}

/** A configuração de IA do aplicativo (a mesma das outras telas). */
function labsConfigIA() {
  return new Promise(r => {
    try { chrome.storage.local.get('config', d => r((d && d.config) || {})); }
    catch (e) { r({}); }
  });
}

// ---------- votações do Plenário num período ----------
/**
 * Janelas de consulta de até 80 dias, cada uma pedida com um dia A MAIS: a API
 * de votações recusa intervalo maior que 3 meses e perde quase todo o último
 * dia do intervalo. Mesma regra de aderencia.js (janelasDeVotacao).
 */
function labsJanelas(dataIni, dataFim, dias = 80) {
  const out = [];
  const d = s => new Date(s + 'T12:00:00');
  let ini = d(dataIni);
  const fim = d(dataFim);
  while (ini <= fim) {
    const f = new Date(ini); f.setDate(f.getDate() + dias - 1);
    const fimJanela = f < fim ? f : fim;
    const pedido = new Date(fimJanela); pedido.setDate(pedido.getDate() + 1);
    out.push([labsIsoLocal(ini), labsIsoLocal(pedido)]);
    ini = new Date(fimJanela); ini.setDate(ini.getDate() + 1);
  }
  return out;
}

/** Período "últimos N meses" até hoje, em AAAA-MM-DD. */
function labsPeriodoMeses(meses, hoje = new Date()) {
  const ini = new Date(hoje); ini.setMonth(ini.getMonth() - meses);
  return [labsIsoLocal(ini), labsIsoLocal(hoje)];
}

function labsSanitizar(id) { return String(id).replace(/[.#$\[\]/]/g, '_'); }

async function labsCacheLer(id) {
  try {
    const r = await fetch(LABS_FIREBASE + LABS_CACHE_VOT + '/' + labsSanitizar(id) + '.json');
    if (!r.ok) return null;
    const e = await r.json();
    if (!e) return null;
    return {
      votos: (e.v || []).map(x => ({ deputado_: { id: x[0], nome: x[1], siglaPartido: x[2], siglaUf: x[3] }, tipoVoto: x[4] })),
      orientacoes: (e.o || []).map(x => ({ siglaPartidoBloco: x[0], orientacaoVoto: x[1] })),
    };
  } catch (e) { return null; }
}

function labsCacheGravar(id, votos, orientacoes) {
  const entry = {
    v: (votos || []).map(v => { const d = v.deputado_ || {}; return [d.id, d.nome || '', d.siglaPartido || '', d.siglaUf || '', v.tipoVoto || '']; }),
    o: (orientacoes || []).map(o => [o.siglaPartidoBloco || '', o.orientacaoVoto || '']),
    t: Date.now(),
  };
  fetch(LABS_FIREBASE + LABS_CACHE_VOT + '/' + labsSanitizar(id) + '.json', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  }).catch(() => {});
}

/**
 * Votações NOMINAIS do Plenário nos últimos `meses`, com votos e orientações.
 * Devolve { itens: [{ votacao, votos, orientacoes }], falhas }. `falhas` conta as
 * votações cuja leitura não voltou — ditas na tela, nunca tratadas como vazias.
 */
async function labsVotacoesPlenario(meses, aoAndar) {
  const [ini, fim] = labsPeriodoMeses(meses);
  const vistos = new Set();
  const todas = [];
  for (const [a, b] of labsJanelas(ini, fim)) {
    let url = `${LABS_API}/votacoes?dataInicio=${a}&dataFim=${b}&itens=200&ordem=ASC&ordenarPor=dataHoraRegistro`;
    let pag = 0;
    while (url && pag < 40) {
      const j = await labsJson(url);
      for (const v of (j.dados || [])) if (!vistos.has(v.id)) { vistos.add(v.id); todas.push(v); }
      const next = (j.links || []).find(l => l.rel === 'next');
      url = next ? next.href : null;
      pag++;
    }
    if (aoAndar) aoAndar(`Buscando as votações do período… ${todas.length}`);
  }
  const plen = todas.filter(v => v.siglaOrgao === 'PLEN' && String(v.data) >= ini && String(v.data) <= fim);
  let falhas = 0;
  const lidos = await labsMapLimit(plen, 6, async v => {
    const c = await labsCacheLer(v.id);
    if (c) return { votacao: v, votos: c.votos, orientacoes: c.orientacoes };
    // 404 = votação SEM lista de votos (simbólica/procedimental: urgência,
    // regime de tramitação…). Não é falha de leitura: entra vazia (e vai para
    // o cache, como faz aderencia.js) e sai do cálculo por não ter votos.
    const ou404 = u => labsJson(u).catch(e => { if (e && e.status === 404) return { dados: [] }; throw e; });
    try {
      const [vt, or] = await Promise.all([
        ou404(`${LABS_API}/votacoes/${v.id}/votos`),
        ou404(`${LABS_API}/votacoes/${v.id}/orientacoes`),
      ]);
      labsCacheGravar(v.id, vt.dados || [], or.dados || []);
      return { votacao: v, votos: vt.dados || [], orientacoes: or.dados || [] };
    } catch (e) { falhas++; return null; }
  }, (f, t) => aoAndar && aoAndar(`Lendo votos e orientações… ${f}/${t}`));
  // Só votação com voto ABERTO: no voto secreto (ex.: indicação de autoridade)
  // a Câmara lista os presentes com tipoVoto vazio — não há o que medir.
  const itens = lidos.filter(x => x && x.votos.some(v => v && v.tipoVoto));
  for (const it of itens) for (const vo of it.votos) {
    const p = labsSigla(vo.deputado_ && vo.deputado_.siglaPartido);
    if (p) LABS_SIGLAS.add(p);
  }
  if (aoAndar) aoAndar('Lendo a composição dos blocos…');
  await labsCarregarBlocos();
  return { itens, falhas, periodo: [ini, fim], blocosFalhou: LABS_BLOCOS_FALHOU };
}

// ---------- orientação ----------
// A API escreve a orientação de bloco com o nome ABREVIADO e, muitas vezes,
// CORTADO: "Bl MdbPsdRepPode", "Bl UniPpPsd...", "Bl AvanSolidPrd...". Pelas
// letras nem sempre dá para achar o partido. Por isso:
//  1. a composição vem da própria API — TODOS os blocos da legislatura
//     (/blocos?idLegislatura=…), não só os em vigor: bloco que acabou (ex.:
//     AVANTE-SOLIDARIEDADE-PRD, até 05/2026) continua explicando as votações
//     antigas. As abreviações do rótulo são casadas, NA ORDEM, com os partidos
//     do nome do bloco ("uni" → UNIÃO, "avan" → AVANTE), e só um bloco pode casar;
//  2. sem bloco que case, vale o rótulo: abreviação igual à sigla ou PREFIXO
//     dela ("rep" → REPUBLICANOS, "solid" → SOLIDARIEDADE) — mas prefixo só
//     quando a abreviação não é, ela mesma, sigla de outro partido ("psd" não
//     vira PSDB) e aponta para um único partido conhecido.
// Rótulo cortado que nenhum bloco explica (ex.: "Bl PlUniPpPsd...", 10/2025)
// fica só com os partidos visíveis — o resto sai "sem orientação", nunca com
// a orientação chutada.

/** Normaliza sigla/abreviação: minúsculas, sem acento. */
function labsSigla(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

/** Abreviações do rótulo de bloco/federação: "Bl MdbPsdRepPode" → ['mdb','psd','rep','pode']. */
function labsSiglasDoBloco(nome) {
  const s = String(nome || '').replace(/\.\.\.$/, '');
  if (/^fdr\b/i.test(s)) return s.replace(/^fdr\s*/i, '').split(/[-\s]+/).map(labsSigla).filter(Boolean);
  if (/^bl\b/i.test(s)) return (s.replace(/^bl\s*/i, '').match(/[A-Z][a-z0-9]*/g) || []).map(labsSigla);
  return [];
}

// Composição dos blocos da legislatura: [{ ordem: ['uniao','pp',…] (como no nome), membros: Set }].
let LABS_BLOCOS = null;
// Se a última leitura dos blocos falhou (a tela avisa; a próxima tenta de novo).
let LABS_BLOCOS_FALHOU = false;
// Siglas de partido conhecidas (normalizadas), das votações lidas — base do casamento por prefixo.
let LABS_SIGLAS = new Set();

/** A ordem dos partidos no nome do bloco: "UNIÃO, PP, Federação PSDB CIDADANIA" → ['uniao','pp','psdb','cidadania']. */
function labsOrdemDoBloco(nome) {
  return String(nome || '').split(/\s*,\s*/)
    .flatMap(p => /^federa/i.test(p) ? p.replace(/^federa\S*\s*/i, '').split(/\s+/) : [p])
    .map(labsSigla).filter(Boolean);
}

/**
 * Lê os blocos da legislatura corrente (os em vigor e os que já acabaram).
 * Falha NÃO fica guardada: devolve [] desta vez, marca LABS_BLOCOS_FALHOU e a
 * próxima chamada tenta de novo.
 */
async function labsCarregarBlocos() {
  if (LABS_BLOCOS) return LABS_BLOCOS;
  try {
    const leg = (((await labsJson(`${LABS_API}/legislaturas?ordem=DESC&ordenarPor=id&itens=1`)).dados || [])[0] || {}).id;
    const listas = await Promise.all([
      labsJson(`${LABS_API}/blocos?itens=100`),
      leg ? labsJson(`${LABS_API}/blocos?idLegislatura=${leg}&itens=100`) : Promise.resolve({ dados: [] }),
    ]);
    const porId = new Map();
    for (const l of listas) for (const b of (l.dados || [])) porId.set(String(b.id), b);
    const out = [];
    for (const b of porId.values()) {
      if (b.federacao === true) continue;
      const ordem = labsOrdemDoBloco(b.nome);
      if (ordem.length < 2) continue;
      let membros = ordem;
      try {
        const ps = ((await labsJson(`${LABS_API}/blocos/${b.id}/partidos`)).dados || []).map(p => labsSigla(p.sigla));
        if (ps.length) membros = ps;
      } catch (_) {}   // sem a lista de partidos, vale a ordem do nome (ex.: bloco 590 vem vazio)
      out.push({ ordem, membros: new Set(membros) });
    }
    LABS_BLOCOS = out;
    LABS_BLOCOS_FALHOU = false;
    return out;
  } catch (e) {
    LABS_BLOCOS_FALHOU = true;
    return [];
  }
}

/**
 * A abreviação `t` corresponde à sigla `s`? Igual, ou prefixo — desde que `t`
 * não seja sigla de outro partido e, entre os conhecidos, só `s` comece com `t`.
 */
function labsAbrevCasa(t, s, conhecidas = LABS_SIGLAS) {
  if (!t || !s) return false;
  if (t === s) return true;
  if (!s.startsWith(t) || t.length < 2) return false;
  if (conhecidas.has(t)) return false;
  const comeca = [...conhecidas].filter(k => k.startsWith(t));
  return comeca.length ? (comeca.length === 1 && comeca[0] === s) : t.length >= 3;
}

/** O bloco da legislatura que corresponde ao rótulo (abreviações casadas na ordem), ou null. */
function labsBlocoDoRotulo(rotulo, blocos, conhecidas = LABS_SIGLAS) {
  const abrev = labsSiglasDoBloco(rotulo).filter(t => t !== 'fdr');
  if (!/^bl\b/i.test(String(rotulo || '')) || !abrev.length) return null;
  const cortado = /\.\.\.$/.test(String(rotulo));
  const casam = (blocos || []).filter(b =>
    (cortado ? b.ordem.length >= abrev.length : b.ordem.length === abrev.length) &&
    abrev.every((t, i) => labsAbrevCasa(t, b.ordem[i], new Set([...conhecidas].filter(k => k !== b.ordem[i])))));
  return casam.length === 1 ? casam[0] : null;
}

const LABS_REF_LIDERANCAS = ['governo', 'oposicao', 'maioria', 'minoria'];

/** "Sim" | "Não" | "Obstrução" | null (liberado, abstenção, vazio…). */
function labsTipoOrientacao(txt) {
  const t = labsSigla(txt);
  return t === 'sim' ? 'Sim' : t === 'nao' ? 'Não' : t.startsWith('obstru') ? 'Obstrução' : null;
}

/**
 * A orientação da referência numa votação: liderança (Governo, Oposição,
 * Maioria, Minoria) pelo nome; partido pela sigla — e, se está em bloco ou
 * federação, pela composição do bloco ou pela abreviação (ver acima).
 * Devolve 'Sim' | 'Não' | 'Obstrução' | null.
 */
function labsOrientacao(orientacoes, ref, blocos = LABS_BLOCOS, conhecidas = LABS_SIGLAS) {
  const alvo = labsSigla(ref);
  const exata = (orientacoes || []).find(o => labsSigla(o.siglaPartidoBloco) === alvo);
  if (exata) return labsTipoOrientacao(exata.orientacaoVoto);
  if (LABS_REF_LIDERANCAS.includes(alvo)) return null;
  const bloco = (orientacoes || []).find(o => {
    const b = labsBlocoDoRotulo(o.siglaPartidoBloco, blocos, conhecidas);
    if (b) return b.membros.has(alvo);
    return labsSiglasDoBloco(o.siglaPartidoBloco).some(t => labsAbrevCasa(t, alvo, conhecidas));
  });
  return bloco ? labsTipoOrientacao(bloco.orientacaoVoto) : null;
}

/** "Sim"/"Não" do voto; null para abstenção, obstrução, art. 17 ou ausência. */
function labsSimNao(tipo) {
  const t = String(tipo || '').trim().toLowerCase();
  return t === 'sim' ? 'Sim' : (t === 'não' || t === 'nao') ? 'Não' : null;
}

/** Deputados em exercício hoje (id, nome, partido, UF). */
async function labsDeputadosAtuais() {
  const j = await labsJson(`${LABS_API}/deputados?ordem=ASC&ordenarPor=nome&itens=1000`);
  return (j.dados || []).map(d => ({ id: d.id, nome: d.nome, partido: d.siglaPartido || '', uf: d.siglaUf || '' }));
}

// ---------- abas ----------
const LABS_ABAS = [['aba-simulador', 'painel-simulador'], ['aba-mapa', 'painel-mapa'], ['aba-apuracao', 'painel-apuracao']];

function labsTrocarAba(bt) {
  for (const [b, p] of LABS_ABAS) {
    const eb = document.getElementById(b), ep = document.getElementById(p);
    if (!eb || !ep) continue;
    eb.classList.toggle('ativa', b === bt);
    ep.hidden = b !== bt;
  }
  document.dispatchEvent(new CustomEvent('labs:aba', { detail: bt }));
  // Apuração: a página do painel só carrega (e começa a ler o TSE) na 1ª abertura.
  const fr = bt === 'aba-apuracao' && document.getElementById('apFrame');
  if (fr && !fr.getAttribute('src')) fr.setAttribute('src', 'apuracao/extensao.html');
}

if (document.getElementById('aba-simulador')) {
  for (const [b] of LABS_ABAS) {
    const el = document.getElementById(b);
    if (el) el.addEventListener('click', () => labsTrocarAba(b));
  }
  const voltar = document.getElementById('btn-voltar-home');
  if (voltar) voltar.addEventListener('click', () => window.close());
  // A aba que abre de saída também carrega seus dados. No `load`, e não já
  // aqui: os scripts dos protótipos vêm depois deste e ainda não escutam.
  window.addEventListener('load', () => labsTrocarAba(LABS_ABAS[0][0]));
}
