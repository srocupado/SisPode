'use strict';
// Bancada do partido: a sigla (uma só, para a extensão inteira), quem está
// nela hoje, quem estava numa data, e o cadastro de deputados reconciliado
// com a Câmara.
//
// BANCADA_SIGLA é a ÚNICA definição da sigla na extensão — os módulos que
// tinham a sua ('PODE' solto em analise, ccjc, emendas, lideres, radar,
// pautas de comissões) agora apontam para cá. O bot tem a dele em
// bot/src/bancada.js (variável de ambiente BANCADA_SIGLA).
//
// ── Cadastro ──
//
// Dois módulos mantêm cadastro próprio de deputados no banco:
//   /comissoes-podemos/deputados   (Comissões · Gestão — tem também inclusões manuais)
//   /deputados                     (Congresso · deputados interessados nos vetos/PLNs)
// Os dois eram só "upsert" da lista em exercício da API: quem saía do partido
// ou terminava o mandato ficava no cadastro para sempre, com o partido antigo,
// e continuava aparecendo nos seletores. Na virada de legislatura isso vira
// metade da lista.
//
// Aqui cada entrada ganha `situacao`:
//   'exercicio'  — está na lista /deputados?siglaPartido=X da Câmara (hoje);
//   'licenciado' — sumiu da lista, mas a Câmara diz: mesmo partido, de licença,
//                  na legislatura corrente (ex.: Renata Abreu, que antes era
//                  uma lista fixa no congresso.js);
//   'ex-membro'  — sumiu e não é licença (trocou de partido, fim de mandato,
//                  voltou à suplência). Ganha `ate`; NUNCA é apagada, porque
//                  comissões, pedidos e interessados antigos apontam para ela.
// Os seletores mostram só 'exercicio' e 'licenciado'. Entrada manual (sem
// idCamara) nunca é tocada.
//
// A reconciliação roda sozinha quando a última tem mais de 24h (marca em
// `<cadastro>_sync`) e no botão "↻ Atualizar" de cada módulo. Só manda PATCH
// dos campos que mudaram — nunca PUT da entrada inteira, que apagaria campos
// que a reconciliação não conhece.
//
// sincronizarCadastroDeputados usa legislatura.js (legislaturaEm) se estiver
// carregado; sem ele, não filtra a licença por legislatura.

const BANCADA_SIGLA = 'PODE';
const BANCADA_API = 'https://dadosabertos.camara.leg.br/api/v2';
const BANCADA_FB = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const BANCADA_SYNC_TTL_MS = 24 * 60 * 60 * 1000;
const SITUACAO_EXERCICIO = 'exercicio';
const SITUACAO_LICENCIADO = 'licenciado';
const SITUACAO_EX_MEMBRO = 'ex-membro';

/** A sigla é a da bancada? (aceita minúsculas e espaços) */
function ehDaBancada(sigla) {
  return String(sigla || '').trim().toUpperCase() === BANCADA_SIGLA;
}

/** Deve aparecer nos seletores? (entrada antiga, sem situacao, conta como ativa) */
function depAtivoNaBancada(d) {
  return !!d && d.situacao !== SITUACAO_EX_MEMBRO;
}

async function bancadaFetchJson(url, opcoes) {
  const r = await fetch(url, opcoes || { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** Deputados em exercício no partido HOJE — a API só lista quem está em exercício. */
async function bancadaEmExercicioNaCamara(sigla) {
  let url = `${BANCADA_API}/deputados?siglaPartido=${encodeURIComponent(sigla || BANCADA_SIGLA)}&itens=100&ordem=ASC&ordenarPor=nome`;
  const out = [];
  for (let pagina = 0; url && pagina < 10; pagina++) {
    const data = await bancadaFetchJson(url);
    (data.dados || []).forEach(d => out.push({ idCamara: d.id, nome: d.nome, nomeEleitoral: d.nomeEleitoral || '',
      uf: d.siglaUf, partido: d.siglaPartido }));
    url = ((data.links || []).find(l => l.rel === 'next') || {}).href || '';
  }
  return out;
}

/** Último status de um deputado na Câmara: { situacao, partido, idLegislatura }, ou null. */
async function bancadaStatusNaCamara(idCamara) {
  try {
    const j = await bancadaFetchJson(`${BANCADA_API}/deputados/${idCamara}`);
    const st = (j.dados && j.dados.ultimoStatus) || {};
    return { situacao: st.situacao || '', partido: st.siglaPartido || '', idLegislatura: st.idLegislatura || null };
  } catch (e) { return null; }
}

/**
 * Pura. Compara o cadastro com a Câmara e devolve só o que mudar.
 *   cadastro     { id: { nome, uf, partido, idCamara, situacao?, desde?, ate? } }
 *   emExercicio  [{ idCamara, nome, uf, partido }]  — a lista da API hoje
 *   statusFora   { idCamara: { situacao, partido, idLegislatura } | null } — de quem sumiu
 *   hoje         'AAAA-MM-DD'
 * → { patches: { id: { campo: valor|null } }, novos, atualizados, inalterados, licenciados, saidas }
 * (valor null = apagar o campo, que é o que o PATCH do Firebase faz com null)
 */
function reconciliarCadastro(cadastro, emExercicio, statusFora, hoje, { sigla = BANCADA_SIGLA, legislatura } = {}) {
  const patches = {};
  let novos = 0, atualizados = 0, inalterados = 0, licenciados = 0, saidas = 0;
  const porIdCamara = new Map();
  Object.entries(cadastro || {}).forEach(([id, d]) => { if (d && d.idCamara != null) porIdCamara.set(Number(d.idCamara), id); });

  const idsNaApi = new Set();
  for (const a of emExercicio) {
    idsNaApi.add(Number(a.idCamara));
    const id = porIdCamara.get(Number(a.idCamara)) || `cam_${a.idCamara}`;
    const exist = (cadastro || {})[id];
    const desejado = { nome: a.nome, uf: a.uf, partido: a.partido, idCamara: a.idCamara, situacao: SITUACAO_EXERCICIO };
    if (!exist) {
      patches[id] = { ...desejado, desde: hoje };
      novos++;
      continue;
    }
    const p = {};
    for (const k of Object.keys(desejado)) if (exist[k] !== desejado[k]) p[k] = desejado[k];
    if (exist.situacao === SITUACAO_EX_MEMBRO) { p.desde = hoje; p.ate = null; } // voltou ao partido
    if (Object.keys(p).length) { patches[id] = p; atualizados++; } else inalterados++;
  }

  for (const [id, d] of Object.entries(cadastro || {})) {
    if (!d || d.idCamara == null || idsNaApi.has(Number(d.idCamara))) continue;
    if (d.situacao === SITUACAO_EX_MEMBRO) continue;
    const st = statusFora ? statusFora[d.idCamara] : null;
    if (!st) continue; // sem resposta da Câmara: não muda nada no escuro
    const licenca = st.partido === sigla && /licen/i.test(st.situacao) &&
      (legislatura == null || st.idLegislatura == null || Number(st.idLegislatura) === Number(legislatura));
    if (licenca) {
      if (d.situacao !== SITUACAO_LICENCIADO) { patches[id] = { situacao: SITUACAO_LICENCIADO }; licenciados++; }
      else inalterados++;
    } else {
      patches[id] = { situacao: SITUACAO_EX_MEMBRO, ate: hoje };
      if (st.partido && st.partido !== d.partido) patches[id].partido = st.partido;
      saidas++;
    }
  }
  return { patches, novos, atualizados, inalterados, licenciados, saidas };
}

/** Aplica os patches num objeto de cadastro em memória (null apaga o campo). */
function aplicarPatchesCadastro(cadastro, patches) {
  const out = { ...(cadastro || {}) };
  for (const [id, p] of Object.entries(patches)) {
    const d = { ...(out[id] || {}) };
    for (const [k, v] of Object.entries(p)) { if (v === null) delete d[k]; else d[k] = v; }
    out[id] = d;
  }
  return out;
}

/**
 * Reconcilia o cadastro em `base` (ex.: '/deputados') com a Câmara.
 * Sem `forcar`, só roda se a última reconciliação tiver mais de 24h.
 * Devolve null quando não rodou; senão { cadastro (já atualizado), ...contagens }.
 */
async function sincronizarCadastroDeputados(base, cadastro, { forcar = false, sigla = BANCADA_SIGLA, agora, emExercicio: listaPronta } = {}) {
  const quando = agora instanceof Date ? agora : new Date();
  const metaUrl = `${BANCADA_FB}${base}_sync.json`;
  if (!forcar) {
    try {
      const meta = await bancadaFetchJson(metaUrl);
      const em = meta && Date.parse(meta.em);
      if (em && quando.getTime() - em < BANCADA_SYNC_TTL_MS) return null;
    } catch (e) { /* sem marca legível: reconcilia */ }
  }

  const emExercicio = listaPronta || await bancadaEmExercicioNaCamara(sigla);
  // Lista vazia é falha da API, não "todo mundo saiu do partido".
  if (!emExercicio.length) throw new Error('a Câmara devolveu a bancada vazia');

  const idsNaApi = new Set(emExercicio.map(a => Number(a.idCamara)));
  const faltantes = Object.values(cadastro || {})
    .filter(d => d && d.idCamara != null && !idsNaApi.has(Number(d.idCamara)) && d.situacao !== SITUACAO_EX_MEMBRO)
    .map(d => d.idCamara);
  const statusFora = {};
  await Promise.all(faltantes.map(async id => { statusFora[id] = await bancadaStatusNaCamara(id); }));

  const hoje = quando.toISOString().slice(0, 10);
  const legislatura = typeof legislaturaEm === 'function' ? legislaturaEm(quando) : null;
  const r = reconciliarCadastro(cadastro, emExercicio, statusFora, hoje, { sigla, legislatura });

  // Um PATCH multi-caminho só com os campos que mudaram.
  const corpo = {};
  for (const [id, p] of Object.entries(r.patches)) for (const [k, v] of Object.entries(p)) corpo[`${id}/${k}`] = v;
  if (Object.keys(corpo).length) {
    await bancadaFetchJson(`${BANCADA_FB}${base}.json`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
  }
  try {
    await fetch(metaUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ em: quando.toISOString() }) });
  } catch (e) { /* a marca é só otimização */ }

  return { ...r, cadastro: aplicarPatchesCadastro(cadastro, r.patches) };
}

// ── Quem está na bancada ─────────────────────────────────────────────────────

const BANCADA_MEMO_MS = 10 * 60 * 1000;
let _bancadaMemo = null; // { em, lista }

/**
 * Deputados da bancada HOJE: [{ idCamara, nome, nomeEleitoral, uf, partido }].
 * Uma consulta à Câmara a cada 10 min por aba. Com `comLicenciados`, soma os
 * que o cadastro /deputados marca como 'licenciado' (quem a API não lista por
 * não estar em exercício — era a lista fixa DEPUTADOS_EXTRA da Análise),
 * reconciliando o cadastro antes se a última reconciliação tiver mais de 24h.
 * Falha da API vira exceção — nunca lista vazia.
 */
async function membrosAtuais({ forcar = false, comLicenciados = false } = {}) {
  let lista;
  if (!forcar && _bancadaMemo && Date.now() - _bancadaMemo.em < BANCADA_MEMO_MS) lista = _bancadaMemo.lista;
  else {
    lista = await bancadaEmExercicioNaCamara(BANCADA_SIGLA);
    if (!lista.length) throw new Error('a Câmara devolveu a bancada vazia');
    _bancadaMemo = { em: Date.now(), lista };
  }
  if (!comLicenciados) return lista.slice();

  let cadastro = {};
  try { cadastro = (await bancadaFetchJson(`${BANCADA_FB}/deputados.json`)) || {}; } catch (e) { /* sem cadastro: só a API */ }
  try {
    const r = await sincronizarCadastroDeputados('/deputados', cadastro, { emExercicio: lista });
    if (r) cadastro = r.cadastro;
  } catch (e) { console.warn('[bancada] reconciliação do cadastro falhou:', e.message); }
  const ids = new Set(lista.map(d => Number(d.idCamara)));
  const licenciados = Object.values(cadastro)
    .filter(d => d && d.situacao === SITUACAO_LICENCIADO && d.idCamara != null && !ids.has(Number(d.idCamara)))
    .map(d => ({ idCamara: d.idCamara, nome: d.nome, nomeEleitoral: '', uf: d.uf, partido: d.partido, licenciado: true }));
  return lista.concat(licenciados);
}

// ── Quem estava na bancada numa data ─────────────────────────────────────────
// O /deputados/{id}/historico da Câmara é uma sequência de eventos (dataHora,
// siglaPartido, situacao): o estado num instante é o do último evento até ele.
// Eventos com situacao nula (o marco "Nome/Partido no início da legislatura")
// só atualizam o partido.

const bancadaHistoricoCache = new Map();

/** Histórico de um deputado, em ordem cronológica (cache da aba); null se a API falhar. */
async function historicoDeputado(id) {
  if (bancadaHistoricoCache.has(id)) return bancadaHistoricoCache.get(id);
  try {
    const j = await bancadaFetchJson(`${BANCADA_API}/deputados/${id}/historico`);
    const h = (j.dados || []).filter(x => x.dataHora)
      .sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)));
    bancadaHistoricoCache.set(id, h);
    return h;
  } catch (e) { return null; }
}

/** Partido e situação ('Exercício', 'Licença', …) de um deputado num instante 'AAAA-MM-DDTHH:MM'. */
function estadoNoInstante(historico, instante) {
  let partido = null, situacao = null;
  for (const h of historico) {
    if (String(h.dataHora).slice(0, 16) > instante) break;
    if (h.siglaPartido) partido = h.siglaPartido;
    if (h.situacao) situacao = h.situacao;
  }
  return { partido, situacao };
}

/**
 * Ids dos deputados em exercício na bancada num instante ('AAAA-MM-DD' ou
 * 'AAAA-MM-DDTHH:MM'). Candidatos: quem a Câmara diz ter passado pelo partido
 * naquele dia; o histórico de cada um decide. Histórico indisponível → o
 * deputado conta (a Câmara o listou no partido naquele dia).
 */
async function membrosEm(instante, { sigla = BANCADA_SIGLA } = {}) {
  const dia = String(instante).slice(0, 10);
  const alvo = String(instante).length > 10 ? String(instante).slice(0, 16) : dia + 'T23:59';
  const j = await bancadaFetchJson(`${BANCADA_API}/deputados?siglaPartido=${encodeURIComponent(sigla)}` +
    `&dataInicio=${dia}&dataFim=${dia}&itens=100&ordem=ASC&ordenarPor=nome`);
  const ids = new Set();
  for (const d of j.dados || []) {
    const h = await historicoDeputado(d.id);
    if (!h) { ids.add(d.id); continue; }
    const st = estadoNoInstante(h, alvo);
    if (st.situacao === 'Exercício' && st.partido === sigla) ids.add(d.id);
  }
  return ids;
}
