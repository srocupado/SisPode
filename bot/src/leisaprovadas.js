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
// Legislaturas antigas são processadas uma vez só — o conteúdo delas não muda
// mais na prática. A CORRENTE recebe refresh periódico, e a IMEDIATAMENTE
// ANTERIOR também, nos primeiros anos da nova: projetos apresentados nela
// continuam virando lei (na virada de fev/2027, boa parte do que a 57ª aprovou
// ainda está no Senado ou na sanção) e, sem isso, a 57ª congelaria no retrato
// de janeiro/2027. A corrente é decidida pela DATA (legislaturaAtual), não por
// constante editada à mão — o bot atravessa a virada sem intervenção.

const { fbGet, fbPut } = require('./firebase');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const ARQUIVOS_URL = 'https://dadosabertos.camara.leg.br/arquivos/proposicoes/json';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'SisPode-Bot/1.0' };
const ID_SITUACAO_LEI = '1140'; // "Transformado em Norma Jurídica", no ultimoStatus do arquivo em massa
const TIPOS_PADRAO = ['PL', 'PLP'];
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRIES = 4;
const TIMEOUT_MS = 45000; // arquivos em massa são grandes; a API paginada é rápida, mas o teto é o mesmo
const FIREBASE_ROOT = '/leis_aprovadas';

// Mesma tabela do app standalone: faixa de apresentação + anos de arquivo por
// legislatura. O arquivo do ano da posse entra nas DUAS (janeiro é da que sai,
// o resto da que entra); anos que ainda não chegaram são pulados na coleta.
const LEGISLATURAS = {
  '58': { rotulo: '58ª (2027–2031)', inicio: '2027-02-01', fim: '2031-01-31', anos: [2027, 2028, 2029, 2030, 2031] },
  '57': { rotulo: '57ª (2023–2027)', inicio: '2023-02-01', fim: '2027-01-31', anos: [2023, 2024, 2025, 2026, 2027] },
  '56': { rotulo: '56ª (2019–2023)', inicio: '2019-02-01', fim: '2023-01-31', anos: [2019, 2020, 2021, 2022, 2023] },
  '55': { rotulo: '55ª (2015–2019)', inicio: '2015-02-01', fim: '2019-01-31', anos: [2015, 2016, 2017, 2018, 2019] },
  '54': { rotulo: '54ª (2011–2015)', inicio: '2011-02-01', fim: '2015-01-31', anos: [2011, 2012, 2013, 2014, 2015] },
  '53': { rotulo: '53ª (2007–2011)', inicio: '2007-02-01', fim: '2011-01-31', anos: [2007, 2008, 2009, 2010, 2011] },
};

/** "AAAA-MM-DD" do dia em Brasília. */
function hojeISO(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

/** A legislatura em mandato na data (a mais recente da tabela, se a data passar do fim dela). */
function legislaturaAtual(dataISO = hojeISO()) {
  return classificarPorLegislatura(dataISO) || Object.keys(LEGISLATURAS).sort((a, b) => b - a)[0];
}

// Por quanto tempo, depois da posse da nova, a anterior continua no refresh.
const ANOS_REFRESH_ANTERIOR = 2;

/**
 * Legislaturas que o refresh periódico cobre: a corrente e, nos primeiros
 * ANOS_REFRESH_ANTERIOR anos dela, também a imediatamente anterior.
 */
function legislaturasEmRefresh(dataISO = hojeISO()) {
  const atual = legislaturaAtual(dataISO);
  const anterior = String(Number(atual) - 1);
  const inicio = LEGISLATURAS[atual].inicio;
  const limite = `${Number(inicio.slice(0, 4)) + ANOS_REFRESH_ANTERIOR}${inicio.slice(4)}`;
  return LEGISLATURAS[anterior] && String(dataISO).slice(0, 10) < limite ? [atual, anterior] : [atual];
}

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

/** Data de apresentação → chave de legislatura ("53".."58"), ou null se fora das faixas conhecidas. */
function classificarPorLegislatura(dataApresentacao) {
  if (!dataApresentacao) return null;
  const data = dataApresentacao.slice(0, 10);
  for (const chave of Object.keys(LEGISLATURAS)) {
    const { inicio, fim } = LEGISLATURAS[chave];
    if (data >= inicio && data <= fim) return chave;
  }
  return null;
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
async function coletarLegislatura(leg, { tipos = TIPOS_PADRAO, comCondicao = true, onProgresso } = {}) {
  const cfg = LEGISLATURAS[leg];
  if (!cfg) throw new Error(`legislatura desconhecida: ${leg}`);
  const progresso = (fase) => { if (onProgresso) onProgresso(leg, fase); };

  progresso(`buscando o roster de deputados`);
  const roster = await fetchDeputados(leg);
  const infoDep = new Map(roster.map(d => [d.id, d]));

  const leisPorId = new Map();
  // O arquivo de um ano futuro não existe (404) — nem tenta.
  const anoCorrente = Number(hojeISO().slice(0, 4));
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
 * Uma legislatura antiga só precisa ser coletada uma vez — sem `forcar`, pula
 * se já tiver dado salvo. A CORRENTE e a ANTERIOR sempre são candidatas a
 * refresh (quem decide a cadência é quem chama: cron diário, comando manual).
 */
async function legislaturaPrecisaAtualizar(leg, forcar) {
  if (forcar) return true;
  if (legislaturasEmRefresh().includes(leg)) return true;
  try {
    const atual = await fbGet(`${FIREBASE_ROOT}/${leg}/atualizadoEm`);
    return !atual;
  } catch (e) { return true; } // Firebase inacessível: tenta coletar mesmo assim
}

/**
 * Orquestra a atualização de um conjunto de legislaturas. Uma legislatura que
 * falha não derruba as outras — cada uma é reportada em `erros` ou `processadas`.
 */
async function atualizarLeisAprovadas({
  legislaturas = Object.keys(LEGISLATURAS), tipos = TIPOS_PADRAO, comCondicao = true,
  forcar = false, onProgresso,
} = {}) {
  const processadas = [], puladas = [], erros = [];
  for (const leg of legislaturas) {
    if (!LEGISLATURAS[leg]) { erros.push({ leg, erro: 'legislatura desconhecida' }); continue; }
    // Antes da posse não há o que coletar — e gravar um agregado vazio faria a
    // tela mostrar a legislatura como "sem nenhuma lei" em vez de "sem dado".
    if (LEGISLATURAS[leg].inicio > hojeISO()) {
      erros.push({ leg, erro: `ainda não começou (posse em ${LEGISLATURAS[leg].inicio.split('-').reverse().join('/')})` });
      continue;
    }
    try {
      if (!(await legislaturaPrecisaAtualizar(leg, forcar))) { puladas.push(leg); continue; }
      const dados = await coletarLegislatura(leg, { tipos, comCondicao, onProgresso });
      await salvarLegislatura(leg, dados);
      processadas.push({ leg, rotulo: dados.rotulo, leis: dados.projetos.length, deputados: dados.ranking.length });
    } catch (e) {
      erros.push({ leg, erro: e.message });
    }
  }
  return { processadas, puladas, erros };
}

module.exports = {
  LEGISLATURAS, legislaturaAtual, legislaturasEmRefresh, TIPOS_PADRAO, ID_SITUACAO_LEI, FIREBASE_ROOT,
  classificarPorLegislatura, baixarEFiltrarAno, fetchDeputados, fetchAutoresDeputados,
  fetchHistorico, condicaoDaLegislatura, coletarLegislatura, salvarLegislatura,
  legislaturaPrecisaAtualizar, atualizarLeisAprovadas,
};
