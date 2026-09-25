'use strict';
// Bancada do partido no bot: a sigla (uma só) e quem está nela.
//
// SIGLA é a ÚNICA definição da sigla no bot — os módulos que tinham 'PODE'
// solto (interesse, materia, perguntar, faltamvotar, portal, votacao, o
// monitor e os comandos do index.js) agora apontam para cá. Vem da variável
// BANCADA_SIGLA do bot/.env (padrão: PODE). A extensão tem a dela em
// bancada.js, na raiz.
//
// Este módulo não passa por ./config de propósito: config encerra o processo
// sem BOT_TOKEN, e módulos puros (portal, votacao…) que agora dependem daqui
// são carregados por testes sem .env.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SIGLA = (process.env.BANCADA_SIGLA || 'PODE').trim().toUpperCase();
const API = 'https://dadosabertos.camara.leg.br/api/v2';
const FIREBASE_URL = () => (process.env.FIREBASE_URL ||
  'https://plenario-podemos-default-rtdb.firebaseio.com').replace(/\/+$/, '');
const MEMO_MS = 10 * 60 * 1000;
const HEADERS = { Accept: 'application/json', 'User-Agent': 'SisPode-Bot/1.0' };

/** A sigla é a da bancada? (aceita minúsculas e espaços) */
function ehDaBancada(sigla) {
  return String(sigla || '').trim().toUpperCase() === SIGLA;
}

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let _memo = null; // { em, lista }

/**
 * Deputados da bancada HOJE: [{ idCamara, nome, nomeEleitoral, uf, partido }].
 * Uma consulta à Câmara a cada 10 min. Com `comLicenciados`, soma os que o
 * cadastro /deputados (reconciliado pela extensão) marca como 'licenciado' —
 * era a lista fixa DEPUTADOS_EXTRA do interesse.js. Falha da API vira
 * exceção — nunca lista vazia.
 */
async function membrosAtuais({ forcar = false, comLicenciados = false } = {}) {
  let lista;
  if (!forcar && _memo && Date.now() - _memo.em < MEMO_MS) lista = _memo.lista;
  else {
    lista = [];
    let url = `${API}/deputados?siglaPartido=${encodeURIComponent(SIGLA)}&itens=100&ordem=ASC&ordenarPor=nome`;
    for (let pag = 0; url && pag < 10; pag++) {
      const j = await getJson(url);
      for (const d of j.dados || []) {
        lista.push({ idCamara: d.id, nome: d.nome, nomeEleitoral: d.nomeEleitoral || '', uf: d.siglaUf, partido: d.siglaPartido });
      }
      url = ((j.links || []).find(l => l.rel === 'next') || {}).href || '';
    }
    if (!lista.length) throw new Error('a Câmara devolveu a bancada vazia');
    _memo = { em: Date.now(), lista };
  }
  if (!comLicenciados) return lista.slice();

  let cadastro = {};
  try { cadastro = (await getJson(`${FIREBASE_URL()}/deputados.json`)) || {}; } catch (e) { /* só a API */ }
  const ids = new Set(lista.map(d => Number(d.idCamara)));
  const licenciados = Object.values(cadastro)
    .filter(d => d && d.situacao === 'licenciado' && d.idCamara != null && !ids.has(Number(d.idCamara)))
    .map(d => ({ idCamara: d.idCamara, nome: d.nome, nomeEleitoral: '', uf: d.uf, partido: d.partido, licenciado: true }));
  return lista.concat(licenciados);
}

// ── Quem estava na bancada numa data ── (mesma regra de bancada.js da extensão)
// O /deputados/{id}/historico é uma sequência de eventos (dataHora,
// siglaPartido, situacao): o estado num instante é o do último evento até ele.
// Eventos com situacao nula (marco "início da legislatura") só mudam o partido.

const _historicos = new Map();

async function historicoDeputado(id) {
  if (_historicos.has(id)) return _historicos.get(id);
  try {
    const j = await getJson(`${API}/deputados/${id}/historico`);
    const h = (j.dados || []).filter(x => x.dataHora)
      .sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)));
    _historicos.set(id, h);
    return h;
  } catch (e) { return null; }
}

function estadoNoInstante(historico, instante) {
  let partido = null, situacao = null;
  for (const h of historico) {
    if (String(h.dataHora).slice(0, 16) > instante) break;
    if (h.siglaPartido) partido = h.siglaPartido;
    if (h.situacao) situacao = h.situacao;
  }
  return { partido, situacao };
}

/** Ids dos deputados em exercício na bancada num instante ('AAAA-MM-DD' ou 'AAAA-MM-DDTHH:MM'). */
async function membrosEm(instante, { sigla = SIGLA } = {}) {
  const dia = String(instante).slice(0, 10);
  const alvo = String(instante).length > 10 ? String(instante).slice(0, 16) : dia + 'T23:59';
  const j = await getJson(`${API}/deputados?siglaPartido=${encodeURIComponent(sigla)}` +
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

module.exports = { SIGLA, ehDaBancada, membrosAtuais, historicoDeputado, estadoNoInstante, membrosEm };
