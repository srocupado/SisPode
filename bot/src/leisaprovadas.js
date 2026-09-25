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
// Legislaturas já ENCERRADAS são processadas uma vez só — o conteúdo delas
// quase não muda mais. A CORRENTE precisa de refresh diário, porque projetos
// apresentados nela continuam podendo virar lei; e a ANTERIOR, por uma CARÊNCIA
// de 12 meses depois do fim, recebe refresh semanal — projeto da legislatura
// passada que ainda estava no Senado ou aguardando sanção vira lei depois da
// virada, e sem isso ficaria de fora para sempre.
//
// A legislatura corrente é CALCULADA pela data (mandato de 4 anos, posse em
// 1º/fev — 57ª em 2023, 58ª em 2027, 59ª em 2031…), sem constante para
// trocar à mão. A API /legislaturas da Câmara é só conferência: se ela
// divergir da conta (ex.: uma PEC mudar a duração do mandato), vale a API e o
// admin é avisado. A API não serve de fonte primária porque a Câmara só
// cadastra a legislatura nova depois da posse.

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

// Primeira legislatura coberta pelo relatório (2007) — a lista vai daqui até a corrente.
const LEGISLATURA_PRIMEIRA = 53;
const CARENCIA_MESES = 12;       // quanto tempo a legislatura anterior ainda recebe refresh
const CARENCIA_INTERVALO_DIAS = 7; // e de quanto em quanto tempo, nesse período
const DIA_MS = 24 * 60 * 60 * 1000;

// Datas devolvidas pela API /legislaturas quando divergem da conta — só em
// memória, reconferidas a cada tick diário (conferirLegislaturaComApi).
const AJUSTES_API = {};
let atualPelaApi = null;

function hojeISO(hoje) { return (hoje || new Date()).toISOString().slice(0, 10); }

/** Legislatura pela conta: posse em 1º/fev de 2023, 2027, 2031… (57ª, 58ª, 59ª…). */
function legislaturaPelaConta(dataISO) {
  const [ano, mes] = dataISO.slice(0, 10).split('-').map(Number);
  const anoEfetivo = mes >= 2 ? ano : ano - 1; // janeiro ainda é da legislatura que começou no ano anterior
  return String(Math.floor((anoEfetivo - 1795) / 4));
}

/** Config (rótulo, faixa de apresentação, anos de arquivo) de uma legislatura — conta + ajuste da API. */
function configLegislatura(leg) {
  const n = Number(leg);
  if (!Number.isInteger(n) || n < LEGISLATURA_PRIMEIRA) return null;
  const ajuste = AJUSTES_API[String(n)];
  const inicio = ajuste ? ajuste.inicio : `${1795 + 4 * n}-02-01`;
  const fim = ajuste ? ajuste.fim : `${1799 + 4 * n}-01-31`;
  const a0 = Number(inicio.slice(0, 4)), a1 = Number(fim.slice(0, 4));
  const anos = [];
  for (let a = a0; a <= a1; a++) anos.push(a); // inclui o ano final: janeiro ainda é desta legislatura
  return { rotulo: `${n}ª (${a0}–${a1})`, inicio, fim, anos };
}

/** Legislatura em mandato na data (padrão: hoje), como string ("57", "58"…). */
function legislaturaAtual(hoje) {
  const data = hojeISO(hoje);
  if (atualPelaApi) {
    const cfg = configLegislatura(atualPelaApi);
    if (cfg && data >= cfg.inicio && data <= cfg.fim) return atualPelaApi;
  }
  return legislaturaPelaConta(data);
}

/** Todas as legislaturas cobertas, da mais recente para a mais antiga. */
function listarLegislaturas(hoje) {
  const atual = Number(legislaturaAtual(hoje));
  const out = [];
  for (let n = atual; n >= LEGISLATURA_PRIMEIRA; n--) out.push(String(n));
  return out;
}

/** Legislatura válida para coleta: da 53ª até a corrente. */
function legislaturaValida(leg, hoje) { return listarLegislaturas(hoje).includes(String(leg)); }

/** Anos de arquivo a baixar — só até o ano corrente (o arquivo de um ano futuro ainda não existe). */
function anosParaColetar(leg, hoje) {
  const cfg = configLegislatura(leg);
  const anoHoje = Number(hojeISO(hoje).slice(0, 4));
  return cfg ? cfg.anos.filter(a => a <= anoHoje) : [];
}

/** A legislatura ANTERIOR ainda está na carência (até 12 meses depois do fim)? */
function emCarencia(leg, hoje) {
  const cfg = configLegislatura(leg);
  if (!cfg || String(leg) === legislaturaAtual(hoje)) return false;
  const limite = new Date(cfg.fim + 'T23:59:59Z');
  limite.setUTCMonth(limite.getUTCMonth() + CARENCIA_MESES);
  return (hoje || new Date()) <= limite;
}

/** Legislaturas que o tick diário deve considerar: a corrente + a anterior, se em carência. */
function legislaturasEmRefresh(hoje) {
  const atual = legislaturaAtual(hoje);
  const anterior = String(Number(atual) - 1);
  return emCarencia(anterior, hoje) ? [atual, anterior] : [atual];
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

/**
 * Confere a legislatura corrente com a API /legislaturas da Câmara. A conta
 * continua valendo quando a API não tem dado para hoje (a Câmara só cadastra a
 * legislatura nova depois da posse); quando a API tem e DIVERGE (número ou
 * datas), passa a valer a API e o resultado diz o que divergiu — quem chama
 * (o tick diário) avisa o admin.
 */
async function conferirLegislaturaComApi(hoje) {
  const data = hojeISO(hoje);
  const calculada = legislaturaPelaConta(data);
  const res = await getComRetry(`${API}/legislaturas?data=${data}`);
  const json = await res.json();
  const api = (json.dados || [])[0];
  if (!api) return { calculada, api: null, divergente: false };
  const id = String(api.id);
  const inicio = String(api.dataInicio || '').slice(0, 10);
  const fim = String(api.dataFim || '').slice(0, 10);
  const contaInicio = `${1795 + 4 * Number(id)}-02-01`, contaFim = `${1799 + 4 * Number(id)}-01-31`;
  const divergente = id !== calculada || inicio !== contaInicio || fim !== contaFim;
  if (divergente && inicio && fim) { AJUSTES_API[id] = { inicio, fim }; atualPelaApi = id; }
  return { calculada, api: { id, inicio, fim }, divergente };
}

/** Data de apresentação → chave de legislatura ("53" até a corrente), ou null se fora das faixas conhecidas. */
function classificarPorLegislatura(dataApresentacao) {
  if (!dataApresentacao) return null;
  const data = dataApresentacao.slice(0, 10);
  for (const chave of listarLegislaturas()) {
    const { inicio, fim } = configLegislatura(chave);
    if (data >= inicio && data <= fim) return chave;
  }
  return null;
}

/**
 * Baixa o arquivo em massa de um ano e devolve só os PL/PLP (tipos) transformados
 * em norma jurídica — nunca guarda o arquivo bruto, só o filtrado. Devolve
 * também o Last-Modified do arquivo: é a data do DADO da Câmara (ela regenera
 * os arquivos uma vez por dia, de madrugada), não a data da coleta.
 */
async function baixarEFiltrarAno(ano, tipos) {
  const res = await getComRetry(`${ARQUIVOS_URL}/proposicoes-${ano}.json`);
  const lastModified = res.headers && res.headers.get ? res.headers.get('last-modified') : null;
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
  leis.dataArquivo = lastModified ? new Date(lastModified).toISOString() : null;
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
async function coletarLegislatura(leg, { tipos = TIPOS_PADRAO, comCondicao = true, onProgresso, hoje } = {}) {
  const cfg = configLegislatura(leg);
  if (!cfg || !legislaturaValida(leg, hoje)) throw new Error(`legislatura desconhecida: ${leg}`);
  const progresso = (fase) => { if (onProgresso) onProgresso(leg, fase); };

  progresso(`buscando o roster de deputados`);
  const roster = await fetchDeputados(leg);
  // Roster vazio = a Câmara ainda não cadastrou os deputados (primeiros dias
  // depois da posse). Não é "ninguém fez lei": aborta sem gravar nada.
  if (!roster.length) {
    const e = new Error(`a Câmara ainda não publicou os deputados da ${leg}ª — coleta adiada`);
    e.code = 'ROSTER_VAZIO';
    throw e;
  }
  const infoDep = new Map(roster.map(d => [d.id, d]));

  const leisPorId = new Map();
  const falhasAnos = [];
  const dataArquivos = {};
  for (const ano of anosParaColetar(leg, hoje)) {
    progresso(`baixando e filtrando proposicoes-${ano}.json`);
    let leis;
    try { leis = await baixarEFiltrarAno(ano, tipos); }
    catch (e) { falhasAnos.push(ano); progresso(`⚠️ falha ao baixar ${ano}: ${e.message} — ano pulado`); continue; }
    if (leis.dataArquivo) dataArquivos[ano] = leis.dataArquivo;
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

  return { rotulo: cfg.rotulo, ranking, projetos, falhasAutores, falhasAnos, dataArquivos };
}

async function salvarLegislatura(leg, dados, origem = 'bot') {
  await fbPut(`${FIREBASE_ROOT}/${leg}`, {
    rotulo: dados.rotulo,
    ranking: dados.ranking,
    projetos: dados.projetos,
    atualizadoEm: new Date().toISOString(),
    origem,
    dataArquivos: dados.dataArquivos || {},
  });
}

/**
 * Precisa coletar? A CORRENTE sempre (quem decide a cadência é quem chama:
 * cron diário, comando manual). A ANTERIOR, durante a carência, se o dado
 * salvo tiver mais de 7 dias. Uma ENCERRADA fora da carência só uma vez —
 * sem `forcar`, pula se já tiver dado salvo.
 */
async function legislaturaPrecisaAtualizar(leg, forcar, hoje) {
  if (forcar) return true;
  if (String(leg) === legislaturaAtual(hoje)) return true;
  let atual;
  try { atual = await fbGet(`${FIREBASE_ROOT}/${leg}/atualizadoEm`); }
  catch (e) { return true; } // Firebase inacessível: tenta coletar mesmo assim
  if (!atual) return true;
  if (emCarencia(leg, hoje)) return ((hoje || new Date()) - new Date(atual)) >= CARENCIA_INTERVALO_DIAS * DIA_MS;
  return false;
}

/**
 * Travas antes de gravar — o que está no Firebase é compartilhado pela equipe
 * toda, então uma coleta INCOMPLETA não pode substituir uma completa:
 *  - ano de arquivo que não baixou (faltaria um ano inteiro de leis);
 *  - projeto sem autores apurados (o crédito dos deputados sairia menor);
 *  - MENOS projetos que o dado salvo (lei não "deixa de ser lei" — é sinal de
 *    coleta ruim). Só `forcar` passa por cima desta última.
 * Devolve a lista de motivos para NÃO gravar (vazia = pode gravar).
 */
async function motivosParaNaoGravar(leg, dados, forcar) {
  const motivos = [];
  if (dados.falhasAnos && dados.falhasAnos.length) motivos.push(`arquivo(s) de ${dados.falhasAnos.join(', ')} não baixaram`);
  if (dados.falhasAutores) motivos.push(`autores não apurados para ${dados.falhasAutores} projeto(s)`);
  if (!forcar) {
    let salvos = null;
    try { salvos = await fbGet(`${FIREBASE_ROOT}/${leg}/projetos`); } catch (e) { /* sem comparação possível */ }
    const antes = Array.isArray(salvos) ? salvos.length : (salvos ? Object.keys(salvos).length : 0);
    if (antes > dados.projetos.length) {
      motivos.push(`a coleta trouxe ${dados.projetos.length} projeto(s), menos que os ${antes} já salvos (use --forcar se for correção deliberada)`);
    }
  }
  return motivos;
}

/**
 * Orquestra a atualização de um conjunto de legislaturas. Uma legislatura que
 * falha não derruba as outras — cada uma é reportada em `processadas`,
 * `puladas`, `aguardando` (Câmara ainda sem roster) ou `erros`.
 */
async function atualizarLeisAprovadas({
  legislaturas, tipos = TIPOS_PADRAO, comCondicao = true,
  forcar = false, onProgresso, hoje, origem = 'bot',
} = {}) {
  const alvo = legislaturas || listarLegislaturas(hoje);
  const processadas = [], puladas = [], aguardando = [], erros = [];
  for (const leg of alvo) {
    if (!legislaturaValida(leg, hoje)) { erros.push({ leg, erro: 'legislatura desconhecida' }); continue; }
    try {
      if (!(await legislaturaPrecisaAtualizar(leg, forcar, hoje))) { puladas.push(leg); continue; }
      const dados = await coletarLegislatura(leg, { tipos, comCondicao, onProgresso, hoje });
      const motivos = await motivosParaNaoGravar(leg, dados, forcar);
      if (motivos.length) { erros.push({ leg, erro: `não gravado — ${motivos.join('; ')}` }); continue; }
      await salvarLegislatura(leg, dados, origem);
      processadas.push({ leg, rotulo: dados.rotulo, leis: dados.projetos.length, deputados: dados.ranking.length });
    } catch (e) {
      if (e.code === 'ROSTER_VAZIO') aguardando.push({ leg, motivo: e.message });
      else erros.push({ leg, erro: e.message });
    }
  }
  return { processadas, puladas, aguardando, erros };
}

/** Situação salva de cada legislatura (para /leisaprovadas status): data da coleta, origem, data dos arquivos. */
async function situacaoLeisAprovadas(hoje) {
  const out = [];
  for (const leg of listarLegislaturas(hoje)) {
    let meta = null;
    try {
      const [atualizadoEm, origem, dataArquivos] = await Promise.all([
        fbGet(`${FIREBASE_ROOT}/${leg}/atualizadoEm`),
        fbGet(`${FIREBASE_ROOT}/${leg}/origem`),
        fbGet(`${FIREBASE_ROOT}/${leg}/dataArquivos`),
      ]);
      meta = { atualizadoEm, origem, dataArquivos };
    } catch (e) { meta = { erro: e.message }; }
    out.push({ leg, rotulo: configLegislatura(leg).rotulo, ...meta });
  }
  return out;
}

module.exports = {
  LEGISLATURA_PRIMEIRA, TIPOS_PADRAO, ID_SITUACAO_LEI, FIREBASE_ROOT,
  legislaturaPelaConta, configLegislatura, legislaturaAtual, listarLegislaturas,
  legislaturaValida, anosParaColetar, emCarencia, legislaturasEmRefresh,
  conferirLegislaturaComApi, classificarPorLegislatura, baixarEFiltrarAno,
  fetchDeputados, fetchAutoresDeputados, fetchHistorico, condicaoDaLegislatura,
  coletarLegislatura, salvarLegislatura, legislaturaPrecisaAtualizar,
  motivosParaNaoGravar, atualizarLeisAprovadas, situacaoLeisAprovadas,
};
