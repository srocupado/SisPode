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

  const r = await retratoDaVotacao(v.id, sigla, v.titulo);
  // `idVotacao` vai mesmo sem os votos: quem acompanha a votação precisa saber que ela CONTINUA aberta
  return r ? { aberta: true, ...r } : { aberta: false, motivo: 'o painel ainda não trouxe os votos individuais', idVotacao: v.id };
}

/**
 * O retrato de UMA votação nominal, pelo id — serve à votação em curso e à que acabou de encerrar (o endereço
 * é o da votação, não o da sessão). Devolve null se o painel não trouxe os votos individuais.
 */
async function retratoDaVotacao(id, sigla = 'PODE', tituloReserva = '') {
  const d = await getJson(VOT_URL(id));
  const pv = d && Array.isArray(d.parlamentaresVotos) ? d.parlamentaresVotos : null;
  if (!pv || !pv.length) return null;
  const v = { id, titulo: tituloReserva };

  const re = reDoPartido(sigla);
  const bancada = pv.filter(x => re.test(String(x.siglaPartido || '').trim()));
  const nomeDe = x => `${String(x.nomeParlamentar || '').trim()} (${String(x.uf || '').trim()})`;

  return {
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

// ============================================================
//  ACOMPANHAMENTO AUTOMÁTICO (26/11/2026) — /faltamvotar auto on|off
// ============================================================
// Pedido da Liderança: numa votação nominal, depois que 257 deputados já votaram (o quórum de deliberação), o
// grupo recebe UMA mensagem com quem do Podemos ainda não votou, e ela se atualiza a cada 15 segundos. Para
// quando toda a bancada votou ou a votação encerra. Antes dos 257, a lista continua saindo só para quem pedir
// (/faltamvotar ou a pergunta ao bot).
// Substitui a "rede de segurança" (um aviso quando 80% da Casa tinha votado e havia deputado PRESENTE sem voto):
// como o painel só marca o deputado como presente depois que ele vota, aquela lista saía sempre vazia.
const ACOMP_INTERVALO_MS = 15e3, ACOMP_MINIMO_CASA = 257;

const horaBrasilia = d => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);

/**
 * O texto da mensagem acompanhada. `estado`: 'aberta' (em curso) | 'encerrada'. `titulo` é o da votação no painel
 * (traz o destaque, quando é um: "PLP Nº 299/2026 - DTQ 1 - FDR PSOL-REDE"); sem ele, vale a proposição.
 * Texto puro, sem marcação: a mensagem é editada a cada 15 segundos e não pode falhar por causa de um asterisco.
 */
function formatarAcompanhamento(r, { estado = 'aberta', titulo = '', hora = '', leituraDe = '' } = {}) {
  const nome = String(titulo || r.prop || 'votação em curso').replace(/\s+/g, ' ').trim();
  const casa = r.casaTotal ? `Na Casa, ${r.casaRegistrou} de ${r.casaTotal} deputados ${estado === 'aberta' ? 'já votaram' : 'votaram'}.` : '';
  const faltam = r.naoVotaram || [], lista = faltam.map(n => `• ${n}`).join('\n');
  const L = [];
  if (!faltam.length) {
    L.push(`✅ Votação nominal${estado === 'encerrada' ? ' encerrada' : ''} — ${nome}`, `Toda a bancada do Podemos votou (${r.votaram} de ${r.total}).`);
    if (casa) L.push(casa);
    return L.join('\n');
  }
  L.push(`🗳 Votação nominal${estado === 'encerrada' ? ' encerrada' : ''} — ${nome}`);
  if (casa) L.push(casa);
  if (estado === 'encerrada') {
    L.push(`${r.votaram} de ${r.total} deputados do Podemos votaram. Não registraram voto${leituraDe ? ` (última leitura, às ${leituraDe})` : ''}:`, '', lista);
    return L.join('\n');
  }
  L.push(`Até o momento, ${r.votaram} de ${r.total} deputados do Podemos votaram. Ainda não registraram voto:`, '', lista, '', `Atualizado às ${hora} — esta mensagem se atualiza a cada 15 segundos.`);
  return L.join('\n');
}

/**
 * O acompanhamento de uma votação por vez. cfg:
 *   consultarAtual() → retrato de faltamVotar (com `aberta` e `idVotacao`); consultarPorId(id) → retrato ou null;
 *   enviar(texto) → { chat, mid }; editar({ chat, mid }, texto); ligado() → o modo está ligado?;
 *   aoEnviar(id, { chat, mid }) e aoConcluir(id) → para o monitor gravar (o bot reinicia no meio de uma votação);
 *   agora() → Date; timers → { setInterval, clearInterval } (os dois últimos são trocados nos testes).
 * Uso: `acompanhar(id, titulo, salvo)` a cada vez que o monitor vê uma nominal aberta — só a primeira chamada de
 * cada votação começa o acompanhamento; `salvo` é o que ficou gravado dela ({ chat, mid } ou { fim: true }).
 */
function criarAcompanhamentoFaltantes(cfg) {
  const consultarAtual = cfg.consultarAtual || (() => faltamVotar('PODE'));
  const consultarPorId = cfg.consultarPorId || (id => retratoDaVotacao(id, 'PODE'));
  const ligado = cfg.ligado || (() => true), agora = cfg.agora || (() => new Date());
  const timers = cfg.timers || { setInterval, clearInterval };
  const intervaloMs = cfg.intervaloMs || ACOMP_INTERVALO_MS, minimo = cfg.minimoCasa || ACOMP_MINIMO_CASA;
  const concluidas = new Set();
  let atual = null;   // { id, titulo, msg, ultimo, lidoEm, fechadas, ocupado, timer }

  function parar() { if (atual) { timers.clearInterval(atual.timer); atual = null; } }
  function concluir(a) {
    concluidas.add(String(a.id));
    if (atual === a) parar();
    try { cfg.aoConcluir && cfg.aoConcluir(a.id); } catch (_) {}
  }
  async function publicar(a, texto) {
    if (a.msg) { if (texto !== a.texto) await cfg.editar(a.msg, texto); }
    else { a.msg = await cfg.enviar(texto); try { cfg.aoEnviar && a.msg && cfg.aoEnviar(a.id, a.msg); } catch (_) {} }
    a.texto = texto;
  }

  async function passo() {
    const a = atual;
    if (!a || a.ocupado) return;
    a.ocupado = true;
    try {
      if (!ligado()) { parar(); return; }   // desligado no meio: para de atualizar; a mensagem fica como está
      const r = await consultarAtual();
      const outra = r && r.idVotacao != null && String(r.idVotacao) !== String(a.id);
      if (!(r && r.aberta) || outra) {
        // Encerrou — ou a leitura falhou. Falha de rede e votação encerrada chegam iguais ("não há votação"):
        // só vale como encerramento na 2ª leitura seguida, ou quando o painel já mostra OUTRA votação.
        // (Painel aberto ainda sem os votos individuais vem com o mesmo id: não é encerramento.)
        if (r && !r.aberta && r.idVotacao != null && !outra) { a.fechadas = 0; return; }
        if (!outra && ++a.fechadas < 2) return;
        if (a.msg) {
          let fim = null;
          try { fim = await consultarPorId(a.id); } catch (_) { /* fica a última leitura */ }
          const base = fim || a.ultimo;
          if (base) await publicar(a, formatarAcompanhamento(base, { estado: 'encerrada', titulo: a.titulo, leituraDe: fim ? '' : a.lidoEm }));
        }
        concluir(a);
        return;
      }
      a.fechadas = 0; a.ultimo = r; a.lidoEm = horaBrasilia(agora());
      if (!a.msg && (r.casaRegistrou || 0) < minimo) return;   // ainda não há 257 votos: quem quiser a lista, pede
      if (!r.naoVotaram.length) { await publicar(a, formatarAcompanhamento(r, { titulo: a.titulo })); concluir(a); return; }
      await publicar(a, formatarAcompanhamento(r, { titulo: a.titulo, hora: a.lidoEm }));
    } catch (e) {
      console.warn(`[faltantes] acompanhamento da votação ${a.id} falhou neste passo: ${e.message}`);
    } finally { a.ocupado = false; }
  }

  function acompanhar(id, titulo = '', salvo = null) {
    if (id == null || !ligado()) return false;
    if (concluidas.has(String(id)) || (atual && String(atual.id) === String(id))) return false;
    if (salvo === true || (salvo && salvo.fim)) { concluidas.add(String(id)); return false; }   // já encerrada (ou aviso do formato antigo)
    parar();   // uma votação por vez: a anterior, se ficou aberta aqui, é abandonada
    const a = { id, titulo: String(titulo || '').replace(/\s+/g, ' ').trim(), msg: salvo && salvo.mid ? { chat: salvo.chat, mid: salvo.mid } : null, ultimo: null, lidoEm: '', fechadas: 0, ocupado: false, texto: '' };
    a.timer = timers.setInterval(() => { passo().catch(() => {}); }, intervaloMs);
    atual = a;
    passo().catch(() => {});
    return true;
  }

  return { acompanhar, parar, passo, emCurso: () => (atual ? { id: atual.id, titulo: atual.titulo, comMensagem: !!atual.msg } : null) };
}

module.exports = { faltamVotar, retratoDaVotacao, formatarFaltantes, formatarFaltantesTexto, formatarAcompanhamento, criarAcompanhamentoFaltantes, horaBrasilia, ACOMP_INTERVALO_MS, ACOMP_MINIMO_CASA };
