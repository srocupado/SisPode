// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
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
    // Todos os que ainda não votaram, numa lista só — é ela que o /faltamvotar mostra. O painel só marca
    // o deputado como presente (indPresente) depois que ele vota (medido em 23/11/2026, votação 14017), então
    // a divisão presentes × fora da Casa punha todo mundo que faltava em "Fora da Casa".
    naoVotaram: bancada.filter(x => !x.dataRegistroVoto).map(nomeDe).sort(),
    casaRegistrou: pv.filter(x => x.dataRegistroVoto).length,
    casaTotal: pv.length,
    idVotacao: v.id,
  };
}

/** Texto pronto (comando e agente). */
function formatarFaltantes(r, { sigla = 'PODE' } = {}) {
  if (!r.aberta) return `Sem lista de faltantes agora — ${r.motivo}.`;
  const linhas = [`🗳 *${r.prop}* — bancada ${sigla} (${r.votaram}/${r.total} já votaram)`];
  linhas.push(r.naoVotaram.length
    ? `🔴 Não votaram (${r.naoVotaram.length}):\n${r.naoVotaram.map(n => `• ${n}`).join('\n')}`
    : '✅ Toda a bancada já votou.');
  return linhas.join('\n\n');
}

/** Resposta à pergunta em texto livre ("quem falta votar?"), no texto pedido em 24/11/2026:
 *  "Até o momento, 19 de 27 deputados do Podemos votaram no PL nº 1969/2022. Segue a relação…".
 *  Montada pelo programa, sem passar pelo modelo: reescrita por ele, a contagem chegou a sumir. */
function formatarFaltantesTexto(r) {
  if (!r.aberta) return `Sem lista de faltantes agora — ${r.motivo}.`;
  const prop = String(r.prop || '').replace(/\bN[ºo°]\s*/i, 'nº ').replace(/\s+/g, ' ').trim();
  const art = /^(PEC|MPV?|MSC|INC|RCP)\b/i.test(prop) ? 'na' : 'no';
  const onde = prop ? ` ${art} ${prop}` : ' na votação em curso';
  const cab = `Até o momento, ${r.votaram} de ${r.total} deputados do Podemos votaram${onde}.`;
  if (!r.naoVotaram.length) return `${cab} Toda a bancada já votou.`;
  return `${cab} Segue a relação dos parlamentares da bancada que ainda não registraram voto:\n\n${r.naoVotaram.map(n => `• ${n}`).join('\n')}`;
}

module.exports = { faltamVotar, formatarFaltantes, formatarFaltantesTexto };
