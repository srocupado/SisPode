'use strict';
// Porte do mecanismo "TEMAS DE INTERESSE DOS PARLAMENTARES" (badge laranja do
// módulo Análise de Pauta da extensão) para o bot.
//
// USA OS MESMOS DADOS que a equipe já configura no painel (Análise de Pauta →
// Configurações → aba "Temas de interesse"): /deputados_interesse no Firebase,
// { idCamara: { temas: 'tema1 OR tema2', perfil: 'texto livre' } }.
//
// E O MESMO MATCHING do painel:
//   1) EMBEDDINGS (Gemini/OpenAI, na chave do usuário): similaridade semântica
//      perfil×texto, exigindo destaque sobre o conjunto (z-score >= 1.0), top 2.
//   2) FALLBACK POR PALAVRAS (ex.: chave Anthropic): termos separados por OR,
//      casados como palavra inteira, ponderados por IDF (termo genérico vale
//      pouco; distintivo vale muito).
//
// A lista da bancada vem da API da Câmara (em exercício) + extras fixos
// (licenciados acompanhados — Renata Abreu), como no painel.

const { fetchIA } = require('./ia');

const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const API = 'https://dadosabertos.camara.leg.br/api/v2';
const SIGLA_PODEMOS = 'PODE';
const DEPUTADOS_EXTRA = [{ id: '178989', nome: 'Renata Abreu' }];
const ZMIN = 1.0;                 // mesmo limiar do painel
const EMB_MODELO = { gemini: 'gemini-embedding-001', openai: 'text-embedding-3-small' };
const CFG_TTL_MS = 30 * 60 * 1000;   // recarrega config/bancada a cada 30 min

// ---------- config compartilhada (bancada + temas/perfis) ----------
let _cfg = null, _cfgEm = 0;

async function carregarBancada() {
  const out = [];
  let url = `${API}/deputados?siglaPartido=${SIGLA_PODEMOS}&ordem=ASC&ordenarPor=nome&itens=100`;
  for (let pag = 0; pag < 5 && url; pag++) {
    const r = await fetch(url);
    if (!r.ok) break;
    const json = await r.json();
    for (const d of (json.dados || [])) out.push({ id: String(d.id), nome: d.nome });
    url = (json.links || []).find(l => l.rel === 'next')?.href || null;
  }
  for (const ex of DEPUTADOS_EXTRA) if (!out.some(d => d.id === ex.id)) out.push({ ...ex });
  return out;
}

async function carregarConfig() {
  if (_cfg && Date.now() - _cfgEm < CFG_TTL_MS) return _cfg;
  const [lista, raw] = await Promise.all([
    carregarBancada(),
    fetch(`${FIREBASE_URL}/deputados_interesse.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  // Normaliza: aceita o formato antigo (string = só temas) e o novo {temas, perfil}.
  const dados = {};
  for (const [id, v] of Object.entries(raw || {})) {
    dados[id] = (typeof v === 'string') ? { temas: v, perfil: '' } : { temas: v?.temas || '', perfil: v?.perfil || '' };
  }
  _cfg = { lista, dados };
  _cfgEm = Date.now();
  return _cfg;
}

// ---------- fallback por palavras (idêntico ao painel) ----------
const normTxt = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function termosInteresse(temas) {
  return (temas || '')
    .split(/\s+OR\s+|\r?\n+/i)
    .map(t => normTxt(t).trim())
    .filter(t => t.length >= 3);
}

function casaTermo(texto, termo) {
  const esc = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(texto); }
  catch { return texto.includes(termo); }
}

function pesosIdf(cfg) {
  if (cfg._idf) return cfg._idf;
  const df = new Map();
  let n = 0;
  for (const dep of cfg.lista) {
    const termos = new Set(termosInteresse(cfg.dados?.[dep.id]?.temas));
    if (!termos.size) continue;
    n++;
    for (const t of termos) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.max(0, Math.log((n || 1) / c)));
  cfg._idf = idf;
  return idf;
}

function interessadosPorPalavras(cfg, texto) {
  const alvo = normTxt(texto);
  if (!alvo) return [];
  const idf = pesosIdf(cfg);
  const scored = [];
  for (const dep of cfg.lista) {
    const termos = termosInteresse(cfg.dados?.[dep.id]?.temas);
    if (!termos.length) continue;
    let score = 0, hits = 0;
    for (const t of termos) if (casaTermo(alvo, t)) { score += (idf.get(t) ?? 0); hits++; }
    if (hits > 0 && score > 0) scored.push({ nome: dep.nome, score });
  }
  scored.sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome, 'pt'));
  return scored.slice(0, 2).map(d => d.nome);
}

// ---------- embeddings (idêntico ao painel: z-score, top 2) ----------
function embeddingsDisponivel(prov) { return prov === 'gemini' || prov === 'openai'; }

async function embTextos(textos, perfil, taskType) {
  const prov = perfil.provedor;
  if (prov === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMB_MODELO.gemini}:embedContent?key=${perfil.apiKey}`;
    return Promise.all(textos.map(async t => {
      const body = { content: { parts: [{ text: t }] }, taskType };
      const j = await fetchIA(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return j?.embedding?.values || null;
    }));
  }
  if (prov === 'openai') {
    const j = await fetchIA('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${perfil.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMB_MODELO.openai, input: textos }),
    });
    return (j.data || []).map(d => d.embedding);
  }
  throw new Error('Embeddings indisponíveis para o provedor ' + prov);
}

function cosseno(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Vetores dos perfis (perfil + temas), cacheados por provedor+conteúdo.
async function garantirVetores(cfg, perfil) {
  const deps = cfg.lista.filter(d => {
    const x = cfg.dados?.[d.id];
    return x && ((x.perfil || '').trim() || (x.temas || '').trim());
  });
  if (!deps.length) return null;
  const textoDe = d => { const x = cfg.dados[d.id]; return `${(x.perfil || '').trim()} ${(x.temas || '').trim()}`.trim(); };
  const tag = `${perfil.provedor}:${EMB_MODELO[perfil.provedor] || ''}`;
  const hash = deps.map(d => d.id + ':' + textoDe(d).length).join('|');
  if (cfg._vetores && cfg._vetTag === tag && cfg._vetHash === hash) return cfg._vetores;
  const vets = await embTextos(deps.map(textoDe), perfil, 'RETRIEVAL_DOCUMENT');
  const map = new Map();
  deps.forEach((d, i) => { if (vets[i]) map.set(d.id, { nome: d.nome, vetor: vets[i] }); });
  cfg._vetores = map; cfg._vetTag = tag; cfg._vetHash = hash;
  return map;
}

/**
 * Deputados do Podemos com interesse aderente ao TEXTO (até 2 nomes), pela
 * mesma régua do painel. Nunca lança: sem config/chave/embeddings, devolve
 * o fallback por palavras ou [].
 */
async function determinarInteressados(texto, perfil) {
  let cfg;
  try { cfg = await carregarConfig(); } catch (_) { return []; }
  if (!cfg.lista.length || !Object.keys(cfg.dados).length) return [];
  if (!perfil?.apiKey || !embeddingsDisponivel(perfil.provedor)) {
    return interessadosPorPalavras(cfg, texto);
  }
  try {
    const mapaVet = await garantirVetores(cfg, perfil);
    if (!mapaVet || !mapaVet.size) return [];
    const matVet = (await embTextos([String(texto).slice(0, 2000)], perfil, 'RETRIEVAL_QUERY'))[0];
    if (!matVet) return [];
    const sims = [];
    for (const [, o] of mapaVet) sims.push({ nome: o.nome, sim: cosseno(matVet, o.vetor) });
    const media = sims.reduce((a, s) => a + s.sim, 0) / sims.length;
    const dp = Math.sqrt(sims.reduce((a, s) => a + (s.sim - media) ** 2, 0) / sims.length) || 1e-9;
    sims.sort((a, b) => b.sim - a.sim);
    return sims.filter(s => (s.sim - media) / dp >= ZMIN).slice(0, 2).map(s => s.nome);
  } catch (e) {
    console.warn('[interesse] embeddings falharam, fallback p/ palavras:', e.message);
    return interessadosPorPalavras(cfg, texto);
  }
}

module.exports = { determinarInteressados };
