'use strict';
// Labs — área de desenvolvimento de novas soluções.
//
// Dentro dela se desenvolvem e testam funcionalidades; quando homologadas, elas
// saem para integrar novos módulos ou módulos já existentes. Por isso o código
// daqui é deliberadamente AUTOCONTIDO: cada protótipo (labs-placar.js,
// labs-simulador.js, labs-mapa.js) depende só deste arquivo e de ia-comum.js,
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
    try {
      const [vt, or] = await Promise.all([
        labsJson(`${LABS_API}/votacoes/${v.id}/votos`),
        labsJson(`${LABS_API}/votacoes/${v.id}/orientacoes`),
      ]);
      labsCacheGravar(v.id, vt.dados || [], or.dados || []);
      return { votacao: v, votos: vt.dados || [], orientacoes: or.dados || [] };
    } catch (e) { falhas++; return null; }
  }, (f, t) => aoAndar && aoAndar(`Lendo votos e orientações… ${f}/${t}`));
  const itens = lidos.filter(x => x && x.votos.length);
  if (aoAndar) aoAndar('Lendo a composição dos blocos…');
  await labsCarregarBlocos();
  return { itens, falhas, periodo: [ini, fim] };
}

// ---------- orientação ----------
// A API escreve a orientação de bloco com o nome ABREVIADO e, muitas vezes,
// CORTADO: "Bl MdbPsdRepPode", "Bl UniPpPsd..." (medido em 09/2026: o bloco
// do PODE — UNIÃO, PP, PSD, REPUBLICANOS, MDB, PSDB-CIDADANIA, PODE — aparece
// só como "Bl UniPpPsd..."). Pelas letras não dá para achar o PODE ali. Por
// isso a composição vem da própria API (/blocos e /blocos/{id}/partidos): as
// abreviações do rótulo são casadas, NA ORDEM, com os partidos do nome do
// bloco ("uni" → UNIÃO, "pp" → PP, "psd" → PSD…), e só um bloco pode casar.
// Sem a composição (ou bloco antigo que não existe mais), vale o rótulo:
// sigla inteira igual à abreviação — conservador, prefere "sem orientação"
// a atribuir o voto do bloco errado.

/** Normaliza sigla/abreviação: minúsculas, sem acento. */
function labsSigla(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

/** Abreviações do rótulo de bloco/federação: "Bl MdbPsdRepPode" → ['mdb','psd','rep','pode']. */
function labsSiglasDoBloco(nome) {
  const s = String(nome || '').replace(/\.\.\.$/, '');
  if (/^fdr\b/i.test(s)) return s.replace(/^fdr\s*/i, '').split(/[-\s]+/).map(labsSigla).filter(Boolean);
  if (/^bl\b/i.test(s)) return (s.replace(/^bl\s*/i, '').match(/[A-Z][a-z0-9]*/g) || []).map(labsSigla);
  return [];
}

// Composição dos blocos em vigor: [{ ordem: ['uniao','pp',…] (como no nome), membros: Set }].
let LABS_BLOCOS = null;

/** Lê os blocos em vigor na Câmara (uma vez por página). Falha → fica sem (vale o rótulo). */
async function labsCarregarBlocos() {
  if (LABS_BLOCOS) return LABS_BLOCOS;
  try {
    const j = await labsJson(`${LABS_API}/blocos?itens=100`);
    const out = [];
    for (const b of (j.dados || [])) {
      if (b.federacao === true) continue;
      const ordem = String(b.nome || '').split(/\s*,\s*/)
        .flatMap(p => /^federa/i.test(p) ? p.replace(/^federa\S*\s*/i, '').split(/\s+/) : [p])
        .map(labsSigla).filter(Boolean);
      let membros = ordem;
      try {
        const ps = ((await labsJson(`${LABS_API}/blocos/${b.id}/partidos`)).dados || []).map(p => labsSigla(p.sigla));
        if (ps.length) membros = ps;
      } catch (_) {}
      if (ordem.length > 1) out.push({ ordem, membros: new Set(membros) });
    }
    LABS_BLOCOS = out;
  } catch (e) { LABS_BLOCOS = []; }
  return LABS_BLOCOS;
}

/** O bloco em vigor que corresponde ao rótulo (abreviações casadas na ordem), ou null. */
function labsBlocoDoRotulo(rotulo, blocos) {
  const abrev = labsSiglasDoBloco(rotulo).filter(t => t !== 'fdr');
  if (!/^bl\b/i.test(String(rotulo || '')) || !abrev.length) return null;
  const cortado = /\.\.\.$/.test(String(rotulo));
  const casam = (blocos || []).filter(b =>
    (cortado ? b.ordem.length >= abrev.length : b.ordem.length === abrev.length) &&
    abrev.every((t, i) => b.ordem[i].startsWith(t)));
  return casam.length === 1 ? casam[0] : null;
}

const LABS_REF_LIDERANCAS = ['governo', 'oposicao', 'maioria', 'minoria'];

/**
 * A orientação ("Sim"/"Não"/outra) da referência numa votação: liderança
 * (Governo, Oposição, Maioria, Minoria) pelo nome; partido pela sigla — e, se o
 * partido está em bloco ou federação, pela composição do bloco (ver acima).
 * Devolve 'Sim' | 'Não' | null (sem orientação Sim/Não para a referência).
 */
function labsOrientacao(orientacoes, ref, blocos = LABS_BLOCOS) {
  const alvo = labsSigla(ref);
  const sn = o => {
    const t = String(o && o.orientacaoVoto || '').trim().toLowerCase();
    return t === 'sim' ? 'Sim' : (t === 'não' || t === 'nao') ? 'Não' : null;
  };
  const exata = (orientacoes || []).find(o => labsSigla(o.siglaPartidoBloco) === alvo);
  if (exata) return sn(exata);
  if (LABS_REF_LIDERANCAS.includes(alvo)) return null;
  const bloco = (orientacoes || []).find(o => {
    const b = labsBlocoDoRotulo(o.siglaPartidoBloco, blocos);
    if (b) return b.membros.has(alvo);
    return labsSiglasDoBloco(o.siglaPartidoBloco).includes(alvo);
  });
  return bloco ? sn(bloco) : null;
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
const LABS_ABAS = [['aba-placar', 'painel-placar'], ['aba-simulador', 'painel-simulador'], ['aba-mapa', 'painel-mapa']];

function labsTrocarAba(bt) {
  for (const [b, p] of LABS_ABAS) {
    const eb = document.getElementById(b), ep = document.getElementById(p);
    if (!eb || !ep) continue;
    eb.classList.toggle('ativa', b === bt);
    ep.hidden = b !== bt;
  }
  document.dispatchEvent(new CustomEvent('labs:aba', { detail: bt }));
}

if (document.getElementById('aba-placar')) {
  for (const [b] of LABS_ABAS) {
    const el = document.getElementById(b);
    if (el) el.addEventListener('click', () => labsTrocarAba(b));
  }
  const voltar = document.getElementById('btn-voltar-home');
  if (voltar) voltar.addEventListener('click', () => window.close());
}
