'use strict';
// "Quem da bancada ainda NÃO votou" numa votação NOMINAL aberta.
//
// Fonte: infoleg.camara.leg.br/ws-plenario/votacao/{idVotacao} — o MESMO
// endpoint que alimenta o painel de votação do app Infoleg. Ao contrário do
// host cosev-api-prod (que anonimiza: ideParlamentar=0), o host infoleg traz
// nomeParlamentar + siglaPartido + uf + dataRegistroVoto (NULO = não votou) +
// indPresente. Público, sem auth. Descoberto na varredura do APK 5.4.5.
//
// GATE OBRIGATÓRIO: só NOMINAL (tipoVotacao "E"). Em votação SIMBÓLICA o
// endpoint devolve HTTP 500 (não há voto individual) — nunca reportar faltantes
// numa simbólica (daria "todos faltaram", falso). O idVotacao vem ao vivo do
// votacaoAtual do cosev.

const { sessaoAtual } = require('./plenariocosev');

const VOT_URL = id => `https://infoleg.camara.leg.br/ws-plenario/votacao/${id}`;
const REGEX_PODE = /^PODE(MOS)?$/i;

async function getJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;                 // 500 em simbólica / erro
    const txt = await r.text();
    if (!txt) return null;
    try { return JSON.parse(txt); } catch { return null; }
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function reDoPartido(sigla) {
  return /^PODE(MOS)?$/i.test(sigla) ? REGEX_PODE : new RegExp(`^${String(sigla).trim()}$`, 'i');
}

/**
 * Retrato dos faltantes da bancada na votação nominal em curso.
 * @param {string} sigla partido (default PODE)
 * @returns {Promise<{aberta:boolean, motivo?, prop?, total?, votaram?,
 *   presentesNaoVotaram?, foraDaCasa?, casaRegistrou?, casaTotal?, idVotacao?}>}
 */
async function faltamVotar(sigla = 'PODE') {
  const sess = await sessaoAtual().catch(() => null);
  if (!sess || !sess.aberta) return { aberta: false, motivo: 'não há sessão aberta no momento' };
  const v = sess.votacao;
  if (!v || v.id == null) return { aberta: false, motivo: 'não há votação em curso' };
  if (String(v.tipoVotacao || '').toUpperCase() !== 'E') {
    return { aberta: false, motivo: 'a votação atual é simbólica — não há registro de voto individual' };
  }

  const d = await getJson(VOT_URL(v.id));
  const pv = d && Array.isArray(d.parlamentaresVotos) ? d.parlamentaresVotos : null;
  if (!pv || !pv.length) return { aberta: false, motivo: 'o painel ainda não trouxe os votos individuais' };

  const re = reDoPartido(sigla);
  const bancada = pv.filter(x => re.test(String(x.siglaPartido || '').trim()));
  const nomeDe = x => `${String(x.nomeParlamentar || '').trim()} (${String(x.uf || '').trim()})`;

  return {
    aberta: true,
    prop: String(d.nomeProposicao || v.titulo || '').replace(/\s+/g, ' ').trim(),
    total: bancada.length,
    votaram: bancada.filter(x => x.dataRegistroVoto).length,
    presentesNaoVotaram: bancada.filter(x => x.indPresente && !x.dataRegistroVoto).map(nomeDe).sort(),
    foraDaCasa: bancada.filter(x => !x.indPresente && !x.dataRegistroVoto).map(nomeDe).sort(),
    casaRegistrou: pv.filter(x => x.dataRegistroVoto).length,
    casaTotal: pv.length,
    idVotacao: v.id,
  };
}

/** Texto pronto (comando e agente). */
function formatarFaltantes(r, { sigla = 'PODE' } = {}) {
  if (!r.aberta) return `Sem lista de faltantes agora — ${r.motivo}.`;
  const linhas = [`🗳 *${r.prop}* — bancada ${sigla} (${r.votaram}/${r.total} já votaram)`];
  if (r.presentesNaoVotaram.length) {
    linhas.push(`🔴 *Presentes e ainda NÃO votaram (${r.presentesNaoVotaram.length}):*\n${r.presentesNaoVotaram.map(n => `• ${n}`).join('\n')}`);
  } else {
    linhas.push('✅ Todos os presentes da bancada já votaram.');
  }
  if (r.foraDaCasa.length) {
    linhas.push(`⚫ Fora da Casa (${r.foraDaCasa.length}):\n${r.foraDaCasa.map(n => `• ${n}`).join('\n')}`);
  }
  return linhas.join('\n\n');
}

module.exports = { faltamVotar, formatarFaltantes };
