'use strict';
// Relatório "Deputados com projetos convertidos em lei" — coleta server-side.
//
// Porte do app standalone (repo Relatorio, branch deputies-legislation-tracker):
// lá o usuário baixava manualmente os arquivos em massa `proposicoes-{ano}.json`
// (90–165 MB cada) porque um NAVEGADOR não consegue buscá-los — a Câmara não
// manda cabeçalho CORS nesses arquivos, e a API paginada `/proposicoes` não
// filtra por situação de tramitação (o parâmetro `codSituacao` é aceito e
// silenciosamente ignorado; só o `ultimoStatus` dos arquivos em massa é
// confiável). Um processo Node não tem essa barreira: baixa direto.
//
// O que fica no Firebase é só o AGREGADO (ranking + lista de projetos-lei),
// nunca o arquivo bruto. Medido em produção (2007: 48 MB brutos → 187 leis →
// 51 KB de JSON filtrado — compressão de ~1000×): o histórico inteiro (53ª a
// 57ª legislatura) cabe em poucos MB, folgado no RTDB.
//
// A legislatura CORRENTE é calculada pela data (./legislatura.js) — não há
// número fixo para trocar na virada (fev/2027 → 58ª). Ela é atualizada todo
// dia. As ENCERRADAS também mudam: projeto apresentado numa legislatura pode
// virar lei na seguinte. Por isso o cron diário também reprocessa UMA
// encerrada por vez, a mais desatualizada, quando o dado dela tem mais de
// IDADE_MAX_ENCERRADA_DIAS — só as que já têm dado (a carga inicial de uma
// encerrada é manual: /leisaprovadas <leg> ou bot/scripts/atualizar-leis-aprovadas.js).

const { fbGet, fbPut } = require('./firebase');
const {
  LEG_PRIMEIRA_COM_ARQUIVOS, legislaturaEm, legislaturaInfo, legislaturasDesde, legislaturaDaData,
} = require('./legislatura');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const ARQUIVOS_URL = 'https://dadosabertos.camara.leg.br/arquivos/proposicoes/json';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'SisPode-Bot/1.0' };
const ID_SITUACAO_LEI = '1140'; // "Transformado em Norma Jurídica", no ultimoStatus do arquivo em massa
const TIPOS_PADRAO = ['PL', 'PLP'];
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRIES = 4;
const TIMEOUT_MS = 45000; // arquivos em massa são grandes; a API paginada é rápida, mas o teto é o mesmo
const FIREBASE_ROOT = '/leis_aprovadas';

const IDADE_MAX_ENCERRADA_DIAS = 30;

/** Chave ('57', '58', …) da legislatura em mandato na data (default: agora). */
function legislaturaAtual(agora) { return String(legislaturaEm(agora)); }

/** Legislaturas que o relatório cobre: da 53ª até a corrente, da mais recente para a mais antiga. */
function legislaturasValidas(agora) { return legislaturasDesde(LEG_PRIMEIRA_COM_ARQUIVOS, agora); }

function ehLegislaturaValida(leg, agora) { return legislaturasValidas(agora).includes(String(leg)); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function mapLimit(itens, limite, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length || 1) }, async () => {
    while (i < itens.length) { const idx = i++; out[idx] = await fn(itens[idx], idx); }
  }));
  return out;
}

/** GET com retry/backoff em 429/5xx/timeout — mesmo padrão dos outros módulos do bot. */
async function getComRetry(url) {
  let last = null;
  for (let tentativa = 1; tentativa <= RETRIES; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let repetir = true;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (res.ok) return res;
      if (!RETRY_STATUS.has(res.status)) { repetir = false; throw new Error(`HTTP ${res.status}`); }
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (!repetir) throw e;
      last = e.name === 'AbortError' ? new Error(`tempo esgotado (${TIMEOUT_MS / 1000}s)`) : e;
    } finally { clearTimeout(timer); }
    if (tentativa < RETRIES) await sleep(tentativa * 1500);
  }
  throw new Error(`falhou após ${RETRIES} tentativas: ${last ? last.message : url}`);
}

/** Todos os deputados de uma legislatura — roster inteiro numa chamada (itens=1000). */
async function fetchDeputados(idLegislatura) {
  const url = `${API}/deputados?idLegislatura=${idLegislatura}&ordem=ASC&ordenarPor=nome&itens=1000`;
  const res = await getComRetry(url);
  const json = await res.json();
  return (json.dados || []).map(d => ({ id: d.id, nome: d.nome, partido: d.siglaPartido || '', uf: d.siglaUf || '' }));
}

/** Data de apresentação → chave de legislatura ('53', '57', …), ou null se não houver data. */
function classificarPorLegislatura(dataApresentacao) {
  return legislaturaDaData(dataApresentacao);
}

/**
 * Baixa o arquivo em massa de um ano e devolve só os PL/PLP (tipos) transformados
 * em norma jurídica — nunca guarda o arquivo bruto, só o filtrado.
 */
async function baixarEFiltrarAno(ano, tipos) {
  const res = await getComRetry(`${ARQUIVOS_URL}/proposicoes-${ano}.json`);
  const arquivo = await res.json();
  const arr = Array.isArray(arquivo) ? arquivo : arquivo.dados || [];
  const leis = [];
  for (const p of arr) {
    if (!tipos.includes(p.siglaTipo)) continue;
    const st = p.ultimoStatus || {};
    if (String(st.idSituacao) !== ID_SITUACAO_LEI) continue;
    leis.push({
      id: p.id, tipo: p.siglaTipo, numero: p.numero, ano: p.ano,
      ementa: p.ementa || '', dataApresentacao: p.dataApresentacao || '',
    });
  }
  return leis;
}

/** Deputados autores (só código 10000 = Deputado) de uma proposição. */
async function fetchAutoresDeputados(idProposicao) {
  const res = await getComRetry(`${API}/proposicoes/${idProposicao}/autores`);
  const json = await res.json();
  const autores = [];
  for (const a of json.dados || []) {
    if (a.codTipo !== 10000) continue;
    const m = (a.uri || '').match(/\/deputados\/(\d+)/);
    if (!m) continue;
    autores.push(parseInt(m[1], 10));
  }
  return autores;
}

/** Histórico do deputado — usado só para achar a condição eleitoral por legislatura. */
async function fetchHistorico(idDeputado) {
  const res = await getComRetry(`${API}/deputados/${idDeputado}/historico`);
  const json = await res.json();
  return json.dados || [];
}

function condicaoDaLegislatura(historico, leg) {
  const conds = new Set();
  for (const h of historico) {
    if (String(h.idLegislatura) === String(leg) && h.condicaoEleitoral) conds.add(h.condicaoEleitoral);
  }
  if (conds.has('Titular')) return 'Titular';
  if (conds.has('Efetivado')) return 'Efetivado';
  if (conds.has('Suplente')) return 'Suplente';
  return '—';
}

/**
 * Coleta uma legislatura inteira: roster + leis (via arquivos em massa dos anos
 * da legislatura) + autores de cada lei + (opcional) condição titular/suplente.
 * Falha parcial (um ano, um autor, uma condição) não derruba a coleta inteira —
 * mesma postura do app original: o que faltou fica de fora, não vira zero.
 */
async function coletarLegislatura(leg, { tipos = TIPOS_PADRAO, comCondicao = true, onProgresso, agora } = {}) {
  if (!ehLegislaturaValida(leg, agora)) throw new Error(`legislatura desconhecida: ${leg}`);
  const cfg = legislaturaInfo(leg);
  // Ano que ainda não chegou não tem arquivo (a 57ª cobre até jan/2027, mas em
  // 2026 o proposicoes-2027.json não existe) — pular em vez de contar como falha.
  const anoCorrente = (agora instanceof Date ? agora : new Date()).getFullYear();
  const progresso = (fase) => { if (onProgresso) onProgresso(leg, fase); };

  progresso(`buscando o roster de deputados`);
  const roster = await fetchDeputados(leg);
  const infoDep = new Map(roster.map(d => [d.id, d]));

  const leisPorId = new Map();
  for (const ano of cfg.anos.filter(a => a <= anoCorrente)) {
    progresso(`baixando e filtrando proposicoes-${ano}.json`);
    let leis;
    try { leis = await baixarEFiltrarAno(ano, tipos); }
    catch (e) { progresso(`⚠️ falha ao baixar ${ano}: ${e.message} — ano pulado`); continue; }
    for (const lei of leis) {
      if (classificarPorLegislatura(lei.dataApresentacao) === leg && !leisPorId.has(lei.id)) {
        leisPorId.set(lei.id, lei);
      }
    }
  }
  const leis = [...leisPorId.values()];

  progresso(`buscando autores de ${leis.length} projeto(s) convertido(s) em lei`);
  let falhasAutores = 0;
  const autoresPorLei = await mapLimit(leis, 4, async (lei) => {
    try { return await fetchAutoresDeputados(lei.id); }
    catch (e) { falhasAutores++; return []; }
  });
  const projetos = leis.map((lei, i) => ({ ...lei, autores: autoresPorLei[i] }));

  // Totais por deputado (todos os autores — inclusive coautores — recebem crédito).
  const totalPorDep = new Map();
  for (const p of projetos) for (const depId of p.autores) {
    totalPorDep.set(depId, (totalPorDep.get(depId) || 0) + 1);
    if (!infoDep.has(depId)) infoDep.set(depId, { id: depId, nome: `Deputado ${depId}`, partido: '', uf: '' });
  }

  let condicaoPorDep = new Map();
  if (comCondicao) {
    progresso(`buscando condição (titular/suplente) de ${infoDep.size} deputado(s)`);
    const ids = [...infoDep.keys()];
    let falhasCondicao = 0;
    const condicoes = await mapLimit(ids, 10, async (id) => {
      try { return condicaoDaLegislatura(await fetchHistorico(id), leg); }
      catch (e) { falhasCondicao++; return '—'; }
    });
    ids.forEach((id, i) => condicaoPorDep.set(id, condicoes[i]));
    if (falhasCondicao) progresso(`⚠️ condição não apurada para ${falhasCondicao} deputado(s)`);
  }

  const ranking = [...infoDep.values()].map(d => ({
    depId: d.id, nome: d.nome, partido: d.partido, uf: d.uf,
    condicao: comCondicao ? (condicaoPorDep.get(d.id) || '—') : '—',
    total: totalPorDep.get(d.id) || 0,
  }));

  if (falhasAutores) progresso(`⚠️ autores não apurados para ${falhasAutores} projeto(s)`);

  return { rotulo: cfg.rotulo, ranking, projetos, falhasAutores };
}

async function salvarLegislatura(leg, dados) {
  await fbPut(`${FIREBASE_ROOT}/${leg}`, {
    rotulo: dados.rotulo,
    ranking: dados.ranking,
    projetos: dados.projetos,
    atualizadoEm: new Date().toISOString(),
  });
}

/**
 * Pedido avulso (comando/script): uma legislatura ENCERRADA sem `forcar` pula
 * se já tiver dado salvo. A CORRENTE sempre é candidata a refresh. O
 * reprocessamento periódico das encerradas é decidido por
 * legislaturasDoRefreshDiario, não aqui.
 */
async function legislaturaPrecisaAtualizar(leg, forcar, agora) {
  if (forcar) return true;
  if (String(leg) === legislaturaAtual(agora)) return true;
  try {
    const atual = await fbGet(`${FIREBASE_ROOT}/${leg}/atualizadoEm`);
    return !atual;
  } catch (e) { return true; } // Firebase inacessível: tenta coletar mesmo assim
}

/**
 * O que o cron diário atualiza: a corrente, sempre, e no máximo UMA encerrada
 * — a de dado mais antigo, se esse dado tiver mais de `idadeMaxDias`. Encerrada
 * sem dado nenhum não entra (carga inicial é manual e pesada). Uma por dia
 * para não empilhar vários downloads de ~100 MB no mesmo tick.
 */
async function legislaturasDoRefreshDiario({ agora, idadeMaxDias = IDADE_MAX_ENCERRADA_DIAS } = {}) {
  const atual = legislaturaAtual(agora);
  const agoraMs = (agora instanceof Date ? agora : new Date()).getTime();
  const limiteMs = idadeMaxDias * 24 * 60 * 60 * 1000;
  let maisVelha = null;
  for (const leg of legislaturasValidas(agora)) {
    if (leg === atual) continue;
    let em;
    try { em = await fbGet(`${FIREBASE_ROOT}/${leg}/atualizadoEm`); } catch (e) { continue; }
    const ms = em ? Date.parse(em) : NaN;
    if (isNaN(ms) || agoraMs - ms <= limiteMs) continue;
    if (!maisVelha || ms < maisVelha.ms) maisVelha = { leg, ms };
  }
  return maisVelha ? [atual, maisVelha.leg] : [atual];
}

/**
 * Orquestra a atualização de um conjunto de legislaturas. Uma legislatura que
 * falha não derruba as outras — cada uma é reportada em `erros` ou `processadas`.
 */
async function atualizarLeisAprovadas({
  legislaturas, tipos = TIPOS_PADRAO, comCondicao = true,
  forcar = false, onProgresso, agora,
} = {}) {
  const processadas = [], puladas = [], erros = [];
  for (const leg of legislaturas || legislaturasValidas(agora)) {
    if (!ehLegislaturaValida(leg, agora)) { erros.push({ leg, erro: 'legislatura desconhecida' }); continue; }
    try {
      if (!(await legislaturaPrecisaAtualizar(leg, forcar, agora))) { puladas.push(leg); continue; }
      const dados = await coletarLegislatura(leg, { tipos, comCondicao, onProgresso, agora });
      await salvarLegislatura(leg, dados);
      processadas.push({ leg, rotulo: dados.rotulo, leis: dados.projetos.length, deputados: dados.ranking.length });
    } catch (e) {
      erros.push({ leg, erro: e.message });
    }
  }
  return { processadas, puladas, erros };
}

module.exports = {
  TIPOS_PADRAO, ID_SITUACAO_LEI, FIREBASE_ROOT, IDADE_MAX_ENCERRADA_DIAS,
  legislaturaAtual, legislaturasValidas, ehLegislaturaValida, legislaturasDoRefreshDiario,
  classificarPorLegislatura, baixarEFiltrarAno, fetchDeputados, fetchAutoresDeputados,
  fetchHistorico, condicaoDaLegislatura, coletarLegislatura, salvarLegislatura,
  legislaturaPrecisaAtualizar, atualizarLeisAprovadas,
};
