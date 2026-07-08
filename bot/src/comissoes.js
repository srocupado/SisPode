'use strict';
// Pauta de COMISSÕES da Câmara dos Deputados via API de Dados Abertos (pública,
// sem chave). Porte do handoff camara.py — dado OFICIAL, texto pronto pro chat,
// NUNCA inventa: sem reunião/pauta, diz isso; comissão ambígua, pergunta qual.
//
// Três capacidades:
//   consultarPauta(comissoes, data, {partido,deputado}) — pauta de comissão(ões) nomeada(s)
//   listarReunioesDeliberativas(data)                    — quais comissões têm reunião deliberativa
//   varrerComissoesPartido(data, {partido,deputado})     — varre por autoria/relatoria de um partido/dep
//
// Sem LLM na coleta: a saída é enviada VERBATIM (não parafrasear dado oficial).

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'SisPode-Bot/1.0' };
const RETRY_STATUS = new Set([500, 502, 503, 504]);
const RETRIES = 3;
const TTL = 12 * 60 * 60 * 1000;   // 12h de cache
const CONCURRENCY = 8;             // autores por reunião, em paralelo
const VARREDURA_CONCURRENCY = 5;   // comissões varridas em paralelo (não martelar a API)

function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// A API da Câmara é instável (502/503/504/timeouts transitórios). Retry com
// backoff (1s, 2s) em 5xx/rede; 4xx NÃO repete (erro do pedido).
async function apiGet(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  let last = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    let res;
    try { res = await fetch(url, { headers: HEADERS }); }
    catch (e) { last = e; if (attempt < RETRIES) { await sleep(attempt * 1000); continue; } break; }
    if (res.ok) { const j = await res.json().catch(() => ({})); return (j && j.dados) || []; }
    if (!RETRY_STATUS.has(res.status)) throw new Error(`API da Câmara falhou: HTTP ${res.status}`);
    last = new Error(`HTTP ${res.status}`);
    if (attempt < RETRIES) await sleep(attempt * 1000);
  }
  throw new Error(`API da Câmara instável (5xx/timeout) após ${RETRIES} tentativas${last ? ` (${last.message})` : ''}`);
}

async function mapLimit(itens, limite, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length || 1) }, async () => {
    while (i < itens.length) { const idx = i++; out[idx] = await fn(itens[idx], idx); }
  }));
  return out;
}

// ---------- Cache: comissões permanentes + mapa deputado→partido ----------
let _comissoes = null, _comissoesAt = 0, _comissoesInflight = null;
let _deputados = null, _deputadosAt = 0, _deputadosInflight = null;

const STOP = new Set(['comissao', 'de', 'do', 'da', 'dos', 'das', 'e', 'a', 'o', 'as', 'os',
  'camara', 'deputados', 'na', 'no', 'em', 'pauta', 'reuniao', 'reunioes']);

async function ensureComissoes() {
  if (_comissoes && Date.now() - _comissoesAt < TTL) return _comissoes;
  if (_comissoesInflight) return _comissoesInflight;
  _comissoesInflight = (async () => {
    // codTipoOrgao=2 = Comissão Permanente (as ~30 comissões temáticas).
    const dados = await apiGet('/orgaos', { codTipoOrgao: 2, itens: 100 });
    const out = dados.map(o => {
      const nome = o.nome || '', sigla = o.sigla || '';
      const tokens = new Set(norm(`${sigla} ${nome}`).split(/\s+/).filter(t => t && !STOP.has(t)));
      return { id: o.id, sigla, nome, tokens };
    });
    if (out.length) { _comissoes = out; _comissoesAt = Date.now(); }
    _comissoesInflight = null;
    return _comissoes || [];
  })();
  return _comissoesInflight;
}

async function ensureDeputados() {
  if (_deputados && Date.now() - _deputadosAt < TTL) return _deputados;
  if (_deputadosInflight) return _deputadosInflight;
  _deputadosInflight = (async () => {
    const mapa = new Map();   // id → { nome, partido, uf }
    for (let pagina = 1; pagina <= 5; pagina++) {   // ~513 deputados / 200 = 3 págs
      const dados = await apiGet('/deputados', { itens: 200, pagina });
      if (!dados.length) break;
      for (const d of dados) mapa.set(d.id, { nome: d.nome || '', partido: d.siglaPartido || '', uf: d.siglaUf || '' });
      if (dados.length < 200) break;
    }
    if (mapa.size) { _deputados = mapa; _deputadosAt = Date.now(); }
    _deputadosInflight = null;
    return _deputados || new Map();
  })();
  return _deputadosInflight;
}

// ---------- Resolução de comissão pelo texto ----------
function resolverComissao(texto, comissoes) {
  const n = norm(texto);
  const toksTexto = new Set(n.split(/\s+/).filter(Boolean));
  // 1) sigla exata (ex.: 'CSAUDE')
  const exatas = comissoes.filter(c => toksTexto.has(norm(c.sigla)));
  if (exatas.length === 1) return exatas;
  // 2) sigla por prefixo p/ abreviações ('CCJ' → 'CCJC'); token ≥ 3
  const pref = comissoes.filter(c => [...toksTexto].some(t => t.length >= 3 && norm(c.sigla).startsWith(t)));
  if (pref.length === 1) return pref;
  // 3) tokens do nome
  const q = new Set(n.split(/\s+/).filter(t => t && !STOP.has(t)));
  if (!q.size) return exatas.length ? exatas : pref;
  const scored = [];
  for (const c of comissoes) {
    let score = 0;
    for (const t of q) if (c.tokens.has(t)) score++;
    if (score) scored.push([score, c]);
  }
  scored.sort((x, y) => y[0] - x[0] || x[1].nome.localeCompare(y[1].nome));
  const best = scored.length ? scored[0][0] : 0;
  return scored.filter(([s]) => s === best).map(([, c]) => c);
}

// ---------- Partido: aliases comuns → como vem em siglaPartido ----------
const PARTIDO_ALIAS = {
  podemos: 'PODE', pode: 'PODE',
  republicanos: 'REPUBLICANOS', republic: 'REPUBLICANOS',
  uniao: 'UNIÃO', uniaobrasil: 'UNIÃO', 'uniao brasil': 'UNIÃO',
  solidariedade: 'SOLIDARIEDADE', solid: 'SOLIDARIEDADE',
  cidadania: 'CIDADANIA', patriota: 'PATRIOTA', avante: 'AVANTE',
  novo: 'NOVO', rede: 'REDE', pcdob: 'PCdoB', 'pc do b': 'PCdoB',
};
function partidoCasa(query, siglaDep) {
  if (!query || !siglaDep) return false;
  const q = norm(query);
  const alvo = PARTIDO_ALIAS[q] || query;
  const a = norm(alvo), s = norm(siglaDep);
  return a === s || a.includes(s) || s.includes(a);
}

// ---------- Datas ----------
const MESES = { janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

function isoOk(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d)
    ? dt.toISOString().slice(0, 10) : null;
}
function addDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function brData(iso) { return iso.split('-').reverse().join('/'); }

/** Extrai data do texto → 'YYYY-MM-DD', ou null. `hojeIso` = hoje local (BR). */
function parseData(texto, hojeIso) {
  const n = norm(texto || '').trim();
  let m = n.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);                 // ISO
  if (m) { const r = isoOk(+m[1], +m[2], +m[3]); if (r) return r; }
  m = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);        // DD/MM[/AAAA]
  if (m) {
    const d = +m[1], mo = +m[2];
    let yr = m[3] ? +m[3] : +hojeIso.slice(0, 4);
    if (yr < 100) yr += 2000;
    let cand = isoOk(yr, mo, d);
    if (cand && !m[3] && cand < hojeIso) cand = isoOk(yr + 1, mo, d);
    if (cand) return cand;
  }
  if (n.includes('depois de amanha')) return addDias(hojeIso, 2);
  if (n.includes('amanha')) return addDias(hojeIso, 1);
  if (n.includes('hoje')) return hojeIso;
  m = n.match(/\b(\d{1,2})\s*o?\s+de\s+([a-z]+)\b/);              // 1º/1 de julho
  if (m && MESES[m[2]]) {
    const d = +m[1], mo = MESES[m[2]], yr = +hojeIso.slice(0, 4);
    let cand = isoOk(yr, mo, d);
    if (cand && cand < hojeIso) cand = isoOk(yr + 1, mo, d);
    if (cand) return cand;
  }
  return null;
}

function fmtHora(h) { const [hh, mm] = h.split(':'); return (mm && mm !== '00') ? `${hh}h${mm}` : `${hh}h`; }

// ---------- Autoria / relatoria ----------
async function autoresPartidos(propId, deps) {
  let autores;
  try { autores = await apiGet(`/proposicoes/${propId}/autores`); }
  catch (_) { return []; }
  return autores.map(a => {
    const nome = a.nome || '?';
    let partido = '';
    const mm = (a.uri || '').match(/\/deputados\/(\d+)/);
    if (mm) partido = (deps.get(+mm[1]) || {}).partido || '';
    return [nome, partido];
  });
}
function partidoDeNome(nome, deps) {
  if (!nome) return '';
  const nn = norm(nome);
  for (const d of deps.values()) if (norm(d.nome) === nn) return d.partido;
  for (const d of deps.values()) { const dn = norm(d.nome); if (nn.includes(dn) || dn.includes(nn)) return d.partido; }
  return '';
}
function matchPessoa(partido, deputado, nome, part) {
  if (partido && partidoCasa(partido, part)) return true;
  if (deputado && norm(nome).includes(norm(deputado))) return true;
  return false;
}
function extrairVoto(parecer) {
  if ((parecer.siglaTipo || '').toUpperCase() !== 'PRL') return '';
  const e = (parecer.ementa || '').replace(/\s+/g, ' ').trim();
  const m = e.match(/\bpel[ao]\s+.+/i);
  return m ? m[0].replace(/[.\s]+$/, '').slice(0, 170) : '';
}

// ---------- Seção de UMA comissão ----------
async function secaoComissao(org, dataIso, partido, deputado, deps) {
  const eventos = await apiGet(`/orgaos/${org.id}/eventos`,
    { dataInicio: dataIso, dataFim: dataIso, itens: 50 });
  if (!eventos.length) return { tem: false, texto: `🏛️ ${org.nome} (${org.sigla}) — sem reunião agendada em ${brData(dataIso)}.` };

  const alvo = partido || deputado;
  const partes = [`🏛️ ${org.nome} (${org.sigla}) — ${brData(dataIso)}`];
  let totalMatch = 0;

  for (const ev of eventos) {
    const hora = (ev.dataHoraInicio || '').slice(11, 16);
    const tipo = ev.descricaoTipo || 'Reunião';
    const pauta = await apiGet(`/eventos/${ev.id}/pauta`);

    // Cada item → o PROJETO (o PL de fundo relatado, ou a própria proposição)
    // + o nome do relator. Cobre AUTORIA (autor do projeto) e RELATORIA (relator).
    const itens = [];
    for (const item of pauta) {
      const prop = item.proposicao_ || {};
      const relProp = item.proposicaoRelacionada_ || {};
      const projeto = relProp.id ? relProp : prop;
      let relator = item.relator;
      if (relator && typeof relator === 'object') relator = relator.nome;
      if (projeto.id) itens.push({ projeto, relator: (typeof relator === 'string' ? relator : null), parecer: prop });
    }
    const ids = [...new Set(itens.map(t => t.projeto.id))];
    const amap = new Map(await mapLimit(ids, CONCURRENCY, async pid => [pid, await autoresPartidos(pid, deps)]));

    itens.sort((a, b) => {
      const sa = String(a.projeto.siglaTipo || ''), sb = String(b.projeto.siglaTipo || '');
      if (sa !== sb) return sa.localeCompare(sb);
      return (parseInt(a.projeto.numero, 10) || 0) - (parseInt(b.projeto.numero, 10) || 0);
    });

    const linhas = [];
    for (const { projeto, relator, parecer } of itens) {
      const autores = amap.get(projeto.id) || [];
      const relPartido = relator ? partidoDeNome(relator, deps) : '';
      const autorHit = autores.some(([nm, pt]) => matchPessoa(partido, deputado, nm, pt));
      const relatorHit = !!relator && matchPessoa(partido, deputado, relator, relPartido);
      if (alvo && !(autorHit || relatorHit)) continue;
      const papeis = [];
      if (autorHit) papeis.push('autoria');
      if (relatorHit) papeis.push('relatoria');
      const tag = `${projeto.siglaTipo} ${projeto.numero}/${projeto.ano}`;
      const papelTxt = papeis.length ? ` → ${papeis.join(' + ')}` : '';
      // Com filtro, mostra o(s) autor(es) que CASARAM primeiro (senão o autor do
      // partido some entre os 2 primeiros signatários exibidos).
      let ordenados = autores;
      if (alvo) {
        const casa = ([nm, pt]) => matchPessoa(partido, deputado, nm, pt);
        ordenados = [...autores.filter(casa), ...autores.filter(a => !casa(a))];
      }
      const aut = ordenados.slice(0, 2).map(([nm, pt]) => pt ? `${nm} (${pt})` : nm).join(', ') || '—';
      const relTxt = relator ? `${relator} (${relPartido || '?'})` : '—';
      const voto = extrairVoto(parecer);
      const ementa = (projeto.ementa || '').trim().replace(/\s+/g, ' ');
      let linha = `   • ${tag}${papelTxt}\n     autor: ${aut} · relator: ${relTxt}`;
      linha += voto ? `\n     🗳️ voto do relator: ${voto}` : `\n     🗳️ voto do relator: (ainda sem parecer na pauta)`;
      linha += `\n     ${ementa.slice(0, 140)}`;
      linhas.push(linha);
    }

    totalMatch += linhas.length;
    const cab = `\n📋 ${tipo} ${hora} — ${itens.length} projeto(s)`;
    if (alvo && !linhas.length) partes.push(cab + `\n   • Nada de ${alvo} — nem autoria nem relatoria.`);
    else { partes.push(cab + (alvo ? ` · ${linhas.length} de ${alvo}:` : ':')); partes.push(...linhas); }
  }
  return { tem: totalMatch > 0, texto: partes.join('\n') };
}

const hojeBRIso = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

// ---------- Capacidade 1: pauta de comissão(ões) nomeada(s) ----------
async function consultarPauta(comissoes, dataTexto, { partido = null, deputado = null, tz = 'America/Sao_Paulo' } = {}) {
  if (typeof comissoes === 'string') comissoes = [comissoes];
  comissoes = (comissoes || []).map(c => String(c).trim()).filter(Boolean);
  if (!comissoes.length) return "erro: informe a comissão (ex.: 'Comissão de Saúde', 'CCJ').";
  const hoje = hojeBRIso(tz);
  const d = parseData(dataTexto, hoje);
  if (!d) return "erro: não entendi a data (use DD/MM, AAAA-MM-DD, 'hoje', 'amanhã' ou '1º de julho').";

  const catalogo = await ensureComissoes();
  const deps = await ensureDeputados();
  const secoes = [];
  for (const texto of comissoes) {
    const cands = resolverComissao(texto, catalogo);
    if (!cands.length) { secoes.push(`🏛️ “${texto}” — não achei essa comissão permanente da Câmara.`); continue; }
    if (cands.length > 1) {
      const nomes = cands.slice(0, 6).map(c => `${c.sigla} (${c.nome})`).join('; ');
      secoes.push(`🏛️ “${texto}” — qual delas? ${nomes}`); continue;
    }
    const { texto: t } = await secaoComissao(cands[0], d, partido, deputado, deps);
    secoes.push(t);
  }
  return secoes.join('\n\n');
}

async function eventosDoDia(dataIso) {
  const out = [];
  for (let pagina = 1; pagina <= 6; pagina++) {   // até ~600 eventos/dia, folgado
    const dados = await apiGet('/eventos', { dataInicio: dataIso, dataFim: dataIso, itens: 100, pagina });
    if (!dados.length) break;
    out.push(...dados);
    if (dados.length < 100) break;
  }
  return out;
}

// ---------- Capacidade 2: quais comissões têm reunião deliberativa ----------
async function listarReunioesDeliberativas(dataTexto, { tz = 'America/Sao_Paulo' } = {}) {
  const hoje = hojeBRIso(tz);
  const d = parseData(dataTexto, hoje);
  if (!d) return "erro: não entendi a data (use DD/MM, AAAA-MM-DD, 'hoje', 'amanhã' ou '1º de julho').";

  const eventos = await eventosDoDia(d);
  const achados = new Map();   // id → { sigla, nome, horas[] }
  for (const ev of eventos) {
    if (!norm(ev.descricaoTipo || '').includes('deliberativ')) continue;
    const hora = (ev.dataHoraInicio || '').slice(11, 16);
    for (const org of (ev.orgaos || [])) {
      if (org.codTipoOrgao !== 2) continue;   // só comissão PERMANENTE
      const e = achados.get(org.id) || { sigla: org.sigla || '', nome: org.nome || '', horas: [] };
      if (hora && !e.horas.includes(hora)) e.horas.push(hora);
      achados.set(org.id, e);
    }
  }
  if (!achados.size) return `🏛️ Nenhuma comissão permanente com reunião deliberativa em ${brData(d)}.`;
  const linhas = [`🏛️ Comissões com reunião deliberativa — ${brData(d)}`];
  for (const e of [...achados.values()].sort((a, b) => a.sigla.localeCompare(b.sigla))) {
    const horas = e.horas.sort().map(fmtHora).join(', ') || 'horário a confirmar';
    linhas.push(`• ${e.sigla} (${e.nome}) — ${horas}`);
  }
  return linhas.join('\n');
}

// ---------- Capacidade 3: varredura por partido/deputado ----------
async function varrerComissoesPartido(dataTexto, { partido = null, deputado = null, tz = 'America/Sao_Paulo' } = {}) {
  const alvo = (partido || deputado || '').trim();
  if (!alvo) return 'erro: informe o partido ou o deputado pra varrer.';
  const hoje = hojeBRIso(tz);
  const d = parseData(dataTexto, hoje);
  if (!d) return "erro: não entendi a data (use DD/MM, AAAA-MM-DD, 'hoje', 'amanhã' ou '1º de julho').";

  const deps = await ensureDeputados();
  const eventos = await eventosDoDia(d);
  const orgs = new Map();
  for (const ev of eventos) {
    if (!norm(ev.descricaoTipo || '').includes('deliberativ')) continue;
    for (const o of (ev.orgaos || [])) {
      if (o.codTipoOrgao !== 2) continue;
      if (o.id && !orgs.has(o.id)) orgs.set(o.id, { id: o.id, sigla: o.sigla || '', nome: o.nome || '' });
    }
  }
  if (!orgs.size) return `🏛️ Nenhuma comissão permanente com reunião deliberativa em ${brData(d)}.`;

  const resultados = await mapLimit([...orgs.values()], VARREDURA_CONCURRENCY,
    async org => { const { tem, texto } = await secaoComissao(org, d, partido, deputado, deps); return { org, tem, texto }; });

  const com = resultados.filter(r => r.tem).sort((a, b) => a.org.sigla.localeCompare(b.org.sigla));
  const semNada = resultados.filter(r => !r.tem).map(r => r.org).sort((a, b) => a.sigla.localeCompare(b.sigla));

  const partes = [`🏛️ Reuniões deliberativas de ${brData(d)} — projetos (autoria/relatoria) de ${alvo}`];
  if (com.length) for (const r of com) partes.push('\n' + r.texto);
  else partes.push(`\nNenhuma das comissões com reunião deliberativa hoje tem projeto (autoria/relatoria) de ${alvo}.`);
  if (semNada.length) partes.push(`\nSem nada de ${alvo} (${semNada.length}): ${semNada.map(o => o.sigla).join(', ')}`);
  return partes.join('\n');
}

module.exports = {
  consultarPauta, listarReunioesDeliberativas, varrerComissoesPartido,
  parseData, resolverComissao, ensureComissoes,   // exportados p/ teste
};
