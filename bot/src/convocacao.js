'use strict';
// Convocação de SESSÃO DELIBERATIVA do Plenário → mensagem no grupo.
//
// Pedido de 10/11/2026: toda vez que o site da Câmara publicar uma sessão
// deliberativa convocada, o bot avisa o grupo no formato que a equipe cola no
// WhatsApp:
//
//   ❗ *CONVOCAÇÃO DE SESSÃO EXTRAORDINÁRIA – TERÇA-FEIRA (10/11) – 13h55*
//
//   🗒️  *Pauta*
//   1. PL 3220/2019 (apelido)
//   2. Urgência ao PL 2167/2026 (apelido)
//
// e, sem a pauta publicada, "🗒️  *Pauta a ser divulgada oportunamente.*".
// Sessão semipresencial ganha, em seguida, o aviso do registro pelo app Infoleg.
// Quando a pauta sai DEPOIS de um aviso sem pauta, a convocação é reenviada
// uma vez, já com a pauta.
//
// Fontes: a agenda do portal (camara.leg.br/agenda, categoria Plenário, de hoje
// a +7 dias) e, se ela falhar, a API de Dados Abertos; a pauta pela página da
// sessão (camara.leg.br/evento-legislativo/{id}) e, sem itens lá, pela API.
// Apelido de cada item, na ordem: o salvo no SisPode (nota técnica ou pauta
// importada); o gerado por IA na chave do admin, com o MESMO prompt da extensão;
// o de reserva, tirado da ementa (o mesmo da extensão sem chave).
// Idempotência entre reinícios: /bot/convocacoes/{id} no Firebase. Sem
// conseguir ler esse registro, o tick não envia nada (melhor atrasar que
// mandar em dobro).

const PORTAL = require('./comissoes-portal');
const { fbGet, fbPatch } = require('./firebase');
const { carregarAnaliseMaisRecente } = require('./perguntar');
const { pautaAtualImportada } = require('./pauta');
const { chamarIAtexto } = require('./ia');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const POLL_MS = 5 * 60e3;
const DIAS_A_FRENTE = 7;
const DIAS = ['DOMINGO', 'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA', 'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO'];

const isoSP = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const somaDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** Agora em São Paulo como 'AAAA-MM-DDTHH:MM' (comparável com o início da sessão). */
function agoraSP(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

// ---------- Texto (puro) ----------

/** Sessão DELIBERATIVA do Plenário (fora as não deliberativas: solenes, de debates…). */
function ehSessaoDeliberativa(ev) {
  const t = `${ev.nome || ''} ${ev.tipo || ''}`;
  return /deliberativa/i.test(t) && !/n[ãa]o\s+deliberativa/i.test(t);
}
/** Convocada e ainda por começar (nunca anuncia sessão em andamento, encerrada ou cancelada). */
function ehConvocada(ev, agora) {
  if (!/^(convocad|agendad|prevista)/i.test(String(ev.situacao || '').trim())) return false;
  return !!ev.data && `${ev.data}T${ev.hora || '23:59'}` > agora;
}
function tipoSessao(nome) {
  if (/extraordin/i.test(nome || '')) return 'SESSÃO EXTRAORDINÁRIA';
  if (/ordin[áa]ria/i.test(nome || '')) return 'SESSÃO ORDINÁRIA';
  return 'SESSÃO DELIBERATIVA';
}
function horaBR(hora) {
  const m = /^(\d{2}):(\d{2})/.exec(hora || '');
  return m ? `${m[1]}h${m[2] === '00' ? '' : m[2]}` : '';
}
function cabecalho(ev) {
  const [a, m, d] = ev.data.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  const h = horaBR(ev.hora);
  return `❗ *CONVOCAÇÃO DE ${tipoSessao(ev.nome)} – ${dia} (${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')})${h ? ` – ${h}` : ''}*`;
}
// Sessão SEMIPRESENCIAL (pedido de 10/11/2026): logo depois da convocação, um
// segundo aviso — presença e voto pelo app Infoleg. Vai só no 1º anúncio da
// sessão (o reenvio com a pauta não repete).
const AVISO_SEMIPRESENCIAL = '*ATENÇÃO*❗️\n\n*Registro de presença e participação pelo app Infoleg*';
const ehSemipresencial = ev => /semipresencial/i.test(`${ev.nome || ''} ${ev.tipo || ''}`);

/** A mensagem inteira. `linhas` vazio = pauta ainda não publicada. */
function montarMensagem(ev, linhas) {
  return cabecalho(ev) + '\n\n' + (linhas && linhas.length
    ? '🗒️  *Pauta*\n' + linhas.join('\n')
    : '🗒️  *Pauta a ser divulgada oportunamente.*');
}

// "Projeto de Lei nº 2.167, de 2026" → "PL 2167/2026" (a mesma normalização da extensão).
function normalizarReferencias(t) {
  return String(t || '')
    .replace(/Projeto de Lei\s+Complementar\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(\d{4})/gi, (_, n, a) => `PLP ${n.replace(/\./g, '')}/${a}`)
    .replace(/Projeto de Lei\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(\d{4})/gi, (_, n, a) => `PL ${n.replace(/\./g, '')}/${a}`)
    .replace(/\bLei\s+Complementar\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(?:\d{1,2}[ºo]?\s+de\s+\w+\s+de\s+)?(\d{4})/gi, (_, n, a) => `Lei Complementar ${n.replace(/\./g, '')}/${a}`)
    .replace(/\bLei\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(?:\d{1,2}[ºo]?\s+de\s+\w+\s+de\s+)?(\d{4})/gi, (_, n, a) => `Lei ${n.replace(/\./g, '')}/${a}`);
}
/** Requerimento de URGÊNCIA → a proposição urgenciada, lida da ementa (leitor único: comissoes-portal). */
function alvoDaUrgencia(sigla, ementa) {
  if (sigla !== 'REQ' || !/urg[êe]ncia/i.test(ementa || '')) return null;
  return PORTAL.proposicaoCitada(ementa);
}
const ref = (sigla, numero, ano) => `${sigla} ${numero}/${ano}`;
const chaveDe = r => `${r.sigla}-${r.numero}-${r.ano}`;

/** Itens da página da sessão (parseEventoPortal) → [{ sigla, numero, ano, ementa, alvo }]. */
function itensDoPortal(ev) {
  return (ev.itens || []).filter(i => i.sigla && i.numero && i.ano).map(i => ({
    sigla: i.sigla, numero: i.numero, ano: i.ano, ementa: i.ementa || '', alvo: alvoDaUrgencia(i.sigla, i.ementa),
  }));
}
/** Itens de /eventos/{id}/pauta → mesmo formato. O título traz a matéria; a ementa vem da proposição que bate com ele. */
function itensDaApi(dados) {
  const out = [], vistos = new Set();
  for (const d of (dados || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0))) {
    const t = /^([A-Z]+)\s+([\d.]+)\/(\d{4})/.exec(String(d.titulo || '').trim());
    const p0 = d.proposicao_ || {};
    const it = t ? { sigla: t[1], numero: t[2].replace(/\./g, ''), ano: t[3] }
      : { sigla: String(p0.siglaTipo || '').toUpperCase(), numero: String(p0.numero || ''), ano: String(p0.ano || '') };
    if (!it.sigla || !it.numero || !it.ano || it.ano === '0') continue;
    const k = chaveDe(it);
    if (vistos.has(k)) continue;
    vistos.add(k);
    const bate = p => p && p.siglaTipo === it.sigla && String(p.numero) === it.numero && String(p.ano) === it.ano;
    const p = [d.proposicao_, d.proposicaoRelacionada_].find(bate);
    it.ementa = p?.ementa || '';
    it.alvo = alvoDaUrgencia(it.sigla, it.ementa);
    const rel = d.proposicaoRelacionada_;
    // Requerimento sem a proposição na ementa: a urgenciada é a relacionada (como em odd.js).
    if (!it.alvo && it.sigla === 'REQ' && rel && rel.siglaTipo && /urg[êe]ncia|^$/i.test(it.ementa))
      it.alvo = { sigla: String(rel.siglaTipo).toUpperCase(), numero: String(rel.numero), ano: String(rel.ano), ementa: '' };
    if (it.alvo && rel && rel.siglaTipo === it.alvo.sigla && String(rel.numero) === it.alvo.numero && String(rel.ano) === it.alvo.ano) it.alvo.ementa = rel.ementa || '';
    out.push(it);
  }
  return out;
}

/** "O que será votado (apelido)" — o mesmo título do índice da extensão. */
function linhaItem(it, apelido, n) {
  const oQue = it.alvo ? `Urgência ao ${ref(it.alvo.sigla, it.alvo.numero, it.alvo.ano)}` : ref(it.sigla, it.numero, it.ano);
  return `${n}. ${oQue}${apelido ? ` (${apelido})` : ''}`;
}

// Apelido de reserva (sem IA): primeira oração da ementa, encurtada — o da extensão.
function apelidoFallback(ementa) {
  const e = normalizarReferencias(String(ementa || '').replace(/\s+/g, ' ').trim());
  if (!e) return '';
  const corte = (e.split(/[.;]/)[0] || e).trim();
  const max = 60;
  if (corte.length <= max) return corte.replace(/[\s,;.:-]+$/, '');
  const c = corte.slice(0, max), sp = c.lastIndexOf(' ');
  return (sp > max * 0.6 ? c.slice(0, sp) : c).replace(/[\s,;.:-]+$/, '') + '…';
}
// O prompt da extensão (analise.js, promptApelido), sem tirar nem pôr.
function promptApelido(r) {
  const ementa = String(r.ementa || '').replace(/\s+/g, ' ').slice(0, 500);
  return `Escreva um "apelido" curto (no máximo 8 palavras), em Português do Brasil, que capture o OBJETO/efeito principal da proposição ${r.sigla} ${r.numero}/${r.ano}, para uso entre parênteses num índice de pauta. Descreva em linguagem direta o que a matéria faz ou cria (ex.: "Institui a política Mulheres em Movimento", "Cota de aprendizes para pessoas com deficiência", "Regime disciplinar para presos de alta periculosidade"). NÃO cite números de lei nem de proposição (não escreva "Lei 7405/1985" nem "PL 3801/2024") — foque no conteúdo, não na norma alterada. Não use aspas nem ponto final. Responda APENAS com o apelido.\n\nEmenta: "${ementa}"`;
}

// ---------- Rede ----------

async function getJson(url, ms = 15000) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Sessões do Plenário de hoje a +DIAS_A_FRENTE: [{ id, data, hora, nome, tipo, situacao }]. Portal primeiro; API se ele falhar. */
async function sessoesProximas(hoje) {
  const fim = somaDias(hoje, DIAS_A_FRENTE);
  try {
    // agenda paginada, pela fila do portal (ritmo e nova tentativa em 429)
    return (await PORTAL.agendaPortal({ de: hoje, ate: fim, categoria: 'Plenário' }, { fresco: true })).filter(e => /plen[áa]rio/i.test(e.orgao))
      .map(e => ({ id: e.id, data: e.data, hora: e.hora, nome: e.tema, tipo: e.tipo, situacao: e.situacao }));
  } catch (ePortal) {
    const j = await getJson(`${API}/eventos?idOrgao=180&dataInicio=${hoje}&dataFim=${fim}&itens=100`)
      .catch(eApi => { throw new Error(`agenda do portal (${ePortal.message}) e API (${eApi.message}) indisponíveis`); });
    return (j.dados || []).map(e => ({ id: e.id, data: String(e.dataHoraInicio || '').slice(0, 10), hora: String(e.dataHoraInicio || '').slice(11, 16),
      nome: String(e.descricao || e.descricaoTipo || '').split(/\r?\n/)[0], tipo: e.descricaoTipo || '', situacao: e.situacao || '' }));
  }
}

/** Itens da pauta da sessão (vazio = não publicada). Página da sessão; sem itens nela, a API. */
async function pautaDaSessao(id) {
  let itens = [];
  try { itens = itensDoPortal(await PORTAL.pautaEventoPortal(id, { fresco: true })); } catch (_) {}
  if (!itens.length) {
    try { itens = itensDaApi((await getJson(`${API}/eventos/${id}/pauta`)).dados); } catch (_) {}
  }
  return itens;
}

/** Ementa de uma proposição (para o apelido do projeto urgenciado): API; se fora, a busca do portal. */
async function ementaDe(r) {
  try {
    const j = await getJson(`${API}/proposicoes?siglaTipo=${r.sigla}&numero=${r.numero}&ano=${r.ano}`, 10000);
    if (j.dados?.[0]?.ementa) return j.dados[0].ementa;
  } catch (_) {}
  try {
    const resp = await fetch('https://www.camara.leg.br/busca-api/api/v1/busca/proposicoes/_search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ order: 'relevancia', pagina: 1, q: `siglaProposicao:${r.sigla} AND numero:${parseInt(r.numero, 10)} AND ano:${r.ano}` }) });
    const h = (((await resp.json()).hits || {}).hits || []).map(x => x._source || {}).find(x => Number(x.numero) === Number(r.numero) && Number(x.ano) === Number(r.ano));
    return h?.ementa || '';
  } catch (_) { return ''; }
}

/** Apelido salvo no SisPode (nota técnica mais recente ou item da pauta importada). */
async function apelidoSalvo(chave, pautaImportada) {
  try { const a = await carregarAnaliseMaisRecente(chave); if (a?.apelido) return String(a.apelido).trim(); } catch (_) {}
  const it = (pautaImportada?.itens || []).find(x => (x.chave || `${x.sigla}-${x.numero}-${x.ano}`) === chave);
  return String(it?.apelido || it?.analise?.apelido || '').trim();
}

async function apelidoDoItem(it, { perfil, pautaImportada }) {
  const sujeito = it.alvo || it;
  let ap = await apelidoSalvo(chaveDe(it), pautaImportada);
  if (!ap && it.alvo) ap = await apelidoSalvo(chaveDe(it.alvo), pautaImportada);
  if (ap) return ap.replace(/^urg[êe]ncia:\s*/i, '');
  if (it.alvo && !it.alvo.ementa) it.alvo.ementa = await ementaDe(it.alvo);
  if (perfil?.apiKey && sujeito.ementa) {
    try {
      const t = await chamarIAtexto({ provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo, prompt: promptApelido(sujeito), maxTokens: 200 });
      const limpo = normalizarReferencias(String(t || '').split('\n')[0].replace(/^["'\s*]+|["'\s.*]+$/g, '').trim());
      if (limpo) return limpo;
    } catch (e) { console.warn(`[convocacao] apelido por IA de ${chaveDe(sujeito)} falhou: ${e.message}`); }
  }
  return apelidoFallback(sujeito.ementa || it.ementa);
}

async function linhasDaPauta(itens, opts) {
  const aps = await Promise.all(itens.map(it => apelidoDoItem(it, opts)));
  return itens.map((it, i) => linhaItem(it, aps[i], i + 1));
}

// ---------- Vigia ----------

let _cfg = null, _timer = null, _rodando = false;
// O que ESTE processo já anunciou: id → { comPauta }. O registro no Firebase cobre os
// reinícios; este cobre a gravação que falha — sem ele, mensagem enviada + gravação
// recusada = a mesma convocação de novo a cada 5 min (revisão de 11/11/2026).
const _anunciadas = new Map();

/**
 * Um ciclo: lê as sessões convocadas, envia o que falta. Devolve as mensagens
 * enviadas (para o teste e o log). cfg: { api, destino(), perfilIA(), agora?, fbGet?, fbPatch? }.
 */
async function tickConvocacoes(cfg = _cfg) {
  const destino = cfg.destino();
  if (!destino) return [];
  const agora = (cfg.agora || agoraSP)();
  const ler = cfg.fbGet || fbGet, gravar = cfg.fbPatch || fbPatch;
  const sessoes = (await sessoesProximas(agora.slice(0, 10))).filter(e => ehSessaoDeliberativa(e) && ehConvocada(e, agora));
  if (!sessoes.length) return [];
  const reg = (await ler('/bot/convocacoes')) || {};   // falha aqui = nada enviado neste tick
  const enviadas = [];
  for (const ev of sessoes) {
    const ja = reg[ev.id] || _anunciadas.get(String(ev.id));
    if (ja && ja.comPauta) continue;
    const itens = await pautaDaSessao(ev.id);
    if (ja && !itens.length) continue;   // já avisada sem pauta; a pauta ainda não saiu
    let pautaImportada = null;
    if (itens.length) { try { pautaImportada = await pautaAtualImportada(); } catch (_) {} }
    const linhas = itens.length ? await linhasDaPauta(itens, { perfil: cfg.perfilIA ? cfg.perfilIA() : null, pautaImportada }) : [];
    const texto = montarMensagem(ev, linhas);
    await cfg.api.sendMessage(destino, texto);
    _anunciadas.set(String(ev.id), { comPauta: linhas.length > 0 });
    if (!ja && ehSemipresencial(ev)) {
      await cfg.api.sendMessage(destino, AVISO_SEMIPRESENCIAL)
        .catch(e => console.warn(`[convocacao] aviso de semipresencial da sessão ${ev.id} falhou: ${e.message}`));
    }
    await gravar(`/bot/convocacoes/${ev.id}`, { data: ev.data, hora: ev.hora, comPauta: linhas.length > 0, enviadaEm: new Date().toISOString() })
      .catch(e => console.warn(`[convocacao] registro da sessão ${ev.id} não foi salvo: ${e.message}`));
    enviadas.push(texto);
    console.log(`[convocacao] sessão ${ev.id} (${ev.data} ${ev.hora}) anunciada ${linhas.length ? `com a pauta (${linhas.length} itens)` : 'sem pauta'}.`);
  }
  return enviadas;
}

function iniciarConvocacoes(cfg) {
  _cfg = cfg;
  clearInterval(_timer);
  const tick = async () => {
    if (_rodando) return;
    _rodando = true;
    try { await tickConvocacoes(); }
    catch (e) { console.warn('[convocacao] tick falhou:', e.message); }
    finally { _rodando = false; }
  };
  _timer = setInterval(tick, POLL_MS);
  tick();
}

module.exports = {
  iniciarConvocacoes, tickConvocacoes, AVISO_SEMIPRESENCIAL, ehSemipresencial,
  ehSessaoDeliberativa, ehConvocada, tipoSessao, cabecalho, montarMensagem, itensDoPortal, itensDaApi, alvoDaUrgencia,
  linhaItem, apelidoFallback, promptApelido, normalizarReferencias, agoraSP,
};
