'use strict';
// Dados de votações nominais do Plenário — porte de votacao.js da extensão
// (loadEvent + loadVotes + a preparação de dados do buildVotingHTML).

const API = 'https://dadosabertos.camara.leg.br/api/v2';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// fetch com retry em 5xx/rede (mesma política da extensão: 2s/4s)
async function fetchRetry(url, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) {
      lastErr = e;
      const is5xx = /HTTP 5\d\d/.test(e.message || '');
      const isNet = !(e.message || '').startsWith('HTTP');
      if (attempt < maxAttempts && (is5xx || isNet)) await sleep(attempt * 2000);
      else break;
    }
  }
  throw lastErr;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function votoClass(tipo) {
  if (!tipo) return 'ausente';
  const t = tipo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === 'sim') return 'sim';
  if (t === 'nao') return 'nao';
  if (t.indexOf('abst')  !== -1) return 'abstencao';
  if (t.indexOf('art')   !== -1) return 'art17';
  if (t.indexOf('obstr') !== -1) return 'obstrucao';
  return 'ausente';
}

/** Votações NOMINAIS do Plenário na data (ISO yyyy-mm-dd). */
async function listarVotacoesDia(dataISO) {
  const dataFim = addDays(dataISO, 1);
  const todas = [];
  let pagina = 1;
  while (pagina <= 10) {
    const r = await fetchRetry(
      `${API}/votacoes?dataInicio=${dataISO}&dataFim=${dataFim}` +
      `&idOrgao=180&itens=100&pagina=${pagina}&ordem=DESC&ordenarPor=dataHoraRegistro`);
    const lote = (await r.json()).dados || [];
    if (!lote.length) break;
    todas.push(...lote);
    if (lote.length < 100) break;
    pagina++;
  }
  const nominalRegex = /Sim:\s*\d+.*N[ãa]o:\s*\d+/i;
  return todas
    .filter(v => v.data === dataISO && v.descricao && nominalRegex.test(v.descricao))
    .map(v => ({
      id: v.id,
      hora: v.dataHoraRegistro ? v.dataHoraRegistro.split('T')[1].slice(0, 5) : '',
      descricao: v.descricao || 'Votação',
      proposicao: v.proposicaoObjeto || '',
    }));
}

/**
 * Placar completo de uma votação para a bancada do partido:
 * contagens globais + da bancada (com ausentes via roster) + orientações.
 */
async function placarVotacao(idVotacao, sigla = 'PODE') {
  const [rVot, rVotos, rOrient] = await Promise.all([
    fetchRetry(`${API}/votacoes/${idVotacao}`),
    fetchRetry(`${API}/votacoes/${idVotacao}/votos`),
    fetchRetry(`${API}/votacoes/${idVotacao}/orientacoes`).catch(() => null),
  ]);
  const votacao  = (await rVot.json()).dados || {};
  const allVotos = (await rVotos.json()).dados || [];
  const orients  = rOrient ? ((await rOrient.json()).dados || []) : [];

  // Contagens globais
  const g = { sim: 0, nao: 0, abstencao: 0, art17: 0, obstrucao: 0 };
  for (const v of allVotos) { const c = votoClass(v.tipoVoto); if (g[c] !== undefined) g[c]++; }

  // Bancada: roster atual + votos do partido (ausente = no roster sem voto)
  const S = sigla.toUpperCase();
  let roster = [];
  try {
    const rDep = await fetchRetry(`${API}/deputados?siglaPartido=${S}&itens=100&ordem=ASC&ordenarPor=nome`);
    roster = (await rDep.json()).dados || [];
  } catch (_) { /* usa só os votos */ }

  const mergedMap = {};
  for (const dep of roster) {
    mergedMap[dep.id] = { nome: dep.nome, siglaPartido: dep.siglaPartido, siglaUf: dep.siglaUf, tipoVoto: null };
  }
  for (const v of allVotos) {
    const d = v.deputado_;
    if (!d?.siglaPartido || d.siglaPartido.toUpperCase() !== S) continue;
    if (mergedMap[d.id]) mergedMap[d.id].tipoVoto = v.tipoVoto;
    else mergedMap[d.id] = { nome: d.nome, siglaPartido: d.siglaPartido, siglaUf: d.siglaUf, tipoVoto: v.tipoVoto };
  }
  const bancada = Object.values(mergedMap)
    .map(d => ({ ...d, classe: votoClass(d.tipoVoto) }))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  const p = { sim: 0, nao: 0, abstencao: 0, art17: 0, obstrucao: 0, ausente: 0 };
  for (const d of bancada) p[d.classe]++;

  // Orientações (partido e Governo)
  let orientPartido = '', orientGoverno = '';
  for (const o of orients) {
    const oSig = (o.siglaPartidoBloco || '').toUpperCase();
    if (!orientPartido && (oSig === S || oSig.includes(S))) orientPartido = o.orientacaoVoto || '';
    if (!orientGoverno && oSig === 'GOVERNO') orientGoverno = o.orientacaoVoto || '';
  }

  return {
    sigla: S,
    descricao: votacao.descricao || '',
    data: votacao.data || '',
    hora: votacao.dataHoraRegistro ? votacao.dataHoraRegistro.split('T')[1].slice(0, 5) : '',
    orgao: votacao.siglaOrgao || 'PLEN',
    quorum: allVotos.length,
    global: g,
    bancada,
    parcial: p,
    orientPartido, orientGoverno,
  };
}

module.exports = { listarVotacoesDia, placarVotacao, votoClass };
