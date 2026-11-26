// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';
// MODO AUTOMÁTICO (/auto on | off) — pedido de 26/11/2026.
//
// Com o modo ligado, toda convocação de sessão deliberativa que sai COM pauta dispara, sem ninguém pedir, o que
// a equipe fazia à mão com /importar, /analisar e /exportar:
//   1. a pauta oficial da sessão entra no SisPode (se a equipe já a importou, fica a da equipe — nada é
//      sobrescrito), com o responsável mantido para a matéria que volta à pauta e sorteio para as demais;
//   2. as matérias sem nota são analisadas, na chave do ADMINISTRADOR (as que já têm nota não são refeitas);
//   3. o grupo recebe o PDF institucional da pauta, a mensagem dos apelidos e os itens do Podemos na pauta.
// O PDF sai no padrão de sempre e é material de urgência: as notas geradas agora ainda não foram revisadas, e os
// analistas revisam e alteram conforme a demanda.
// Com o modo desligado (o padrão), o bot fica como sempre foi: só a mensagem de convocação.
//
// O estado fica no Firebase (/bot/auto), para sobreviver às reinicializações do bot (atualização automática).
// Cada sessão roda uma vez só: /bot/auto_rotinas/{id da sessão}. Sem conseguir ler esses registros, a rotina não
// roda (melhor não fazer que gastar a chave em dobro).

const { fbGet, fbPatch } = require('./firebase');

const CAMINHO = '/bot/auto', ROTINAS = '/bot/auto_rotinas';
const TENTATIVAS_PDF = 6, INTERVALO_PDF_MS = 5 * 60e3;        // a página da sessão às vezes ganha o PDF minutos depois dos itens
const ESPERA_WORKER_MS = 30e3, ESPERA_WORKER_MAX = 80;         // o painel faz um trabalho por vez: espera até 40 min pela vez

/** O modo automático está ligado? Na dúvida (Firebase fora do ar), não. */
async function autoLigado(ler = fbGet) {
  try { const v = await ler(CAMINHO); return !!(v && v.ligado); } catch (_) { return false; }
}
async function setAutoLigado(v, por = '', gravar = fbPatch) {
  await gravar(CAMINHO, { ligado: !!v, por: String(por || ''), em: new Date().toISOString() });
  return !!v;
}
async function statusAuto(ler = fbGet) {
  try { const v = (await ler(CAMINHO)) || {}; return { ligado: !!v.ligado, por: v.por || '', em: v.em || '' }; } catch (e) { return { ligado: false, erro: e.message }; }
}

// ---------- Texto (puro) ----------
const diaBR = iso => { const [, m, d] = String(iso || '').split('-'); return d && m ? `${d}/${m}` : String(iso || ''); };
const sessaoBR = ev => `sessão de ${diaBR(ev.data)}${ev.hora ? `, ${String(ev.hora).replace(':', 'h').replace(/h00$/, 'h')}` : ''}`;

function textoInicio(ev, temChave) {
  return `⚙️ Modo automático: preparando a pauta da ${sessaoBR(ev)} — importação${temChave ? ', notas das matérias pendentes' : ''}, PDF, apelidos e itens do Podemos. Aviso aqui quando terminar.`;
}
function textoProgresso(ev, p) {
  const titulo = p.titulo ? ` — ${p.titulo}` : '';
  if (p.fase === 'notas') return `⚙️ Modo automático${titulo}: gerando as notas… ${p.ok ?? 0}/${p.total ?? p.numItens ?? '?'}${p.erro ? ` · ${p.erro} falha(s)` : ''}`;
  if (p.fase === 'material') return `⚙️ Modo automático${titulo}: montando o PDF, os apelidos e os itens do Podemos…`;
  return `⚙️ Modo automático: importando a pauta da ${sessaoBR(ev)}…`;
}
/** Quantas matérias ficaram com cada servidor: "Pedro Ribeiro 2 · Suellen Ali 2 · sem responsável 1". */
function cargaResponsaveis(responsaveis) {
  const m = new Map();
  for (const r of responsaveis || []) { const n = String(r.analista || '').trim() || 'sem responsável'; m.set(n, (m.get(n) || 0) + 1); }
  return [...m].sort((a, b) => (a[0] === 'sem responsável') - (b[0] === 'sem responsável') || a[0].localeCompare(b[0], 'pt-BR')).map(([n, q]) => `${n} ${q}`).join(' · ');
}
function textoResumo(ev, r) {
  const semNota = r.numItens - (r.comNota || 0), falhas = (r.notas && r.notas.erro) || 0;
  const L = [`✅ Modo automático — ${r.titulo} (${r.numItens} ${r.numItens === 1 ? 'item' : 'itens'}), ${sessaoBR(ev)}.`,
    r.existente ? '• Pauta: já estava no SisPode — mantida como a equipe deixou.' : '• Pauta: importada do site da Câmara.',
    r.semChave ? `• Notas: não gerei (o administrador está sem chave de IA no /config) — ${r.comNota || 0} de ${r.numItens} já tinham nota.`
      : `• Notas: ${r.comNota || 0} de ${r.numItens} com nota${semNota > 0 ? ` — ${semNota} sem nota${falhas ? ` (${falhas} falha(s) na geração)` : ''}: gere no painel ou com /analisar` : ''}.`,
    `• Responsáveis: ${cargaResponsaveis(r.responsaveis) || '—'}.`,
    `• Itens do Podemos: ${r.podemos && r.podemos.total ? `${r.podemos.total} (mensagem abaixo)` : 'nenhum de autoria, apensado ou relatoria'}.`];
  if ((r.enviosFalhos || []).length) L.push(`⚠ Não consegui mandar ao grupo: ${r.enviosFalhos.join('; ')}.`);
  if ((r.incertos || []).length) L.push(`⚠ Autoria ou apensados NÃO verificados (podem faltar entre os itens do Podemos): ${r.incertos.join(', ')}.`);
  L.push('O PDF é material de urgência: as notas geradas agora ainda não foram revisadas.');
  return L.join('\n');
}
const nomePdf = titulo => `${String(titulo || '').replace(/[^\w\- ]+/g, '').trim() || 'pauta'}.pdf`;

/** Corta o texto em pedaços que cabem numa mensagem do Telegram (4096 caracteres), sempre em quebra de linha. */
function fatiar(texto, tam = 3900) {
  const partes = [];
  let resto = String(texto || '');
  while (resto.length > tam) {
    let corte = resto.lastIndexOf('\n', tam);
    if (corte < tam * 0.5) corte = tam;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\n+/, '');
  }
  if (resto) partes.push(resto);
  return partes;
}

/** Agora em São Paulo como 'AAAA-MM-DDTHH:MM' (comparável com a data e a hora da sessão). */
function agoraSP(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
const MAX_TENTATIVAS = 2;   // a rotina de uma sessão roda uma vez; se o bot reiniciar no meio, mais uma

/**
 * A rotina de UMA sessão convocada com pauta. `ev`: { id, data, hora, nome }.
 * cfg: { api, destino(), perfil(), executar (worker.rotinaPautaDaSessao), arquivo(buffer, nome) → documento do
 *        Telegram, travar() → true se pegou a vez no painel, destravar(), fbGet, fbPatch, esperar(ms) }.
 * `retomar`: a rotina desta sessão começou e não terminou (o bot reiniciou no meio) — ver retomarRotinasInterrompidas.
 * Devolve { pulou: motivo } | { ok: true, pautaId } | { erro }. Nunca lança.
 */
async function rotinaAuto(ev, cfg, { retomar = false } = {}) {
  const ler = cfg.fbGet || fbGet, gravar = cfg.fbPatch || fbPatch;
  const esperar = cfg.esperar || (ms => new Promise(r => setTimeout(r, ms)));
  if (!(await autoLigado(ler))) return { pulou: 'desligado' };
  const destino = cfg.destino();
  if (!destino) return { pulou: 'sem destino' };
  const chave = `${ROTINAS}/${ev.id}`;
  let reg;
  try { reg = await ler(chave); } catch (_) { return { pulou: 'registro ilegível' }; }
  if (reg && !(retomar && reg.iniciadaEm && !reg.terminadaEm && (reg.tentativas || 1) < MAX_TENTATIVAS)) return { pulou: 'já feita' };
  await gravar(chave, { data: ev.data, hora: ev.hora || '', iniciadaEm: new Date().toISOString(), tentativas: ((reg && reg.tentativas) || (reg ? 1 : 0)) + 1 }).catch(() => {});

  const perfil = cfg.perfil ? cfg.perfil() : null;
  // Na retomada, o aviso "preparando…" que ficou no grupo é o mesmo que passa a ser atualizado.
  let status = reg && reg.statusMid && String(reg.statusChat) === String(destino) ? { message_id: reg.statusMid } : null;
  const editar = async t => { if (status) await cfg.api.editMessageText(destino, status.message_id, t).catch(() => {}); };
  const fim = async (patch) => { await gravar(chave, { ...patch, terminadaEm: new Date().toISOString() }).catch(() => {}); };
  try {
    if (status) await editar(`${textoInicio(ev, !!(perfil && perfil.apiKey))} (Retomando: o bot reiniciou no meio.)`);
    else {
      status = await cfg.api.sendMessage(destino, textoInicio(ev, !!(perfil && perfil.apiKey)));
      await gravar(chave, { statusChat: destino, statusMid: status.message_id }).catch(() => {});
    }
    let r = null;
    for (let i = 1; i <= TENTATIVAS_PDF; i++) {
      // a vez no painel (um trabalho por vez: /analisar, /exportar e /avulsa usam o mesmo navegador)
      let vez = false;
      for (let k = 0; k < ESPERA_WORKER_MAX && !(vez = cfg.travar()); k++) await esperar(ESPERA_WORKER_MS);
      if (!vez) throw new Error('o painel ficou ocupado por mais de 40 minutos');
      try {
        r = await cfg.executar({ perfil, sessao: { id: ev.id, data: ev.data, hora: ev.hora || '' }, onProgress: p => editar(textoProgresso(ev, p)) });
      } finally { cfg.destravar(); }
      if (!r.semPdf) break;
      if (i < TENTATIVAS_PDF) await esperar(INTERVALO_PDF_MS);
    }
    if (r.semPdf) {
      await editar(`⚠️ Modo automático: a Câmara ainda não pôs o PDF da pauta na página da ${sessaoBR(ev)}. Quando sair, importe pelo calendário do Plenário (na extensão) ou com /importar; depois, /analisar e /exportar.`);
      await fim({ erro: 'PDF da pauta não publicado' });
      return { erro: 'PDF da pauta não publicado' };
    }
    // Daqui em diante a pauta está importada e as notas, geradas: uma mensagem que não sai não desfaz isso nem
    // impede as outras. Texto longo (pauta grande) vai em mais de uma mensagem: o Telegram recusa acima de 4096 caracteres.
    const enviosFalhos = [];
    const tentar = async (oQue, fn) => { try { await fn(); } catch (e) { enviosFalhos.push(`${oQue} (${String(e.message || e).slice(0, 80)})`); console.warn(`[auto] sessão ${ev.id}: ${oQue} não foi enviado: ${e.message}`); } };
    await tentar('o PDF da pauta', () => cfg.api.sendDocument(destino, cfg.arquivo(r.pdf, nomePdf(r.titulo)), { caption: `${r.titulo} — ${r.numItens} ${r.numItens === 1 ? 'item' : 'itens'} · PDF institucional gerado pelo SisPode Bot`.slice(0, 1000) }));
    if (r.apelidos) await tentar('a mensagem dos apelidos', async () => { for (const p of fatiar(r.apelidos)) await cfg.api.sendMessage(destino, p); });
    if (r.podemos && r.podemos.total && r.podemos.texto) await tentar('os itens do Podemos', async () => { for (const p of fatiar(r.podemos.texto)) await cfg.api.sendMessage(destino, p); });
    await editar(textoResumo(ev, { ...r, enviosFalhos }));
    await fim({ pautaId: r.pautaId, itens: r.numItens, comNota: r.comNota || 0, existente: !!r.existente, ...(enviosFalhos.length ? { enviosFalhos } : {}) });
    return { ok: true, pautaId: r.pautaId, ...(enviosFalhos.length ? { enviosFalhos } : {}) };
  } catch (e) {
    console.error(`[auto] rotina da sessão ${ev.id} falhou:`, e);
    // Não se sabe em que ponto parou: a pauta pode já estar importada (e /importar de novo pediria para sobrescrever).
    const msg = `⚠️ Modo automático: não consegui preparar a pauta da ${sessaoBR(ev)} (${e.message}). O que já foi feito está salvo. Se a pauta já aparece no /pauta, termine com /analisar e /exportar; se não, comece por /importar.`;
    if (status) await editar(msg); else await cfg.api.sendMessage(destino, msg).catch(() => {});
    await fim({ erro: String(e.message || e).slice(0, 300) });
    return { erro: e.message };
  }
}

/**
 * Na subida do bot: rotina que começou e não terminou (o bot reiniciou no meio — uma atualização, por exemplo) é
 * retomada, uma vez, se a sessão ainda não começou. Sem isto a sessão ficava marcada como feita e o "preparando…"
 * ficava no grupo para sempre (varredura de 26/11/2026). Sessão que já começou só tem o aviso corrigido.
 */
async function retomarRotinasInterrompidas(cfg) {
  const ler = cfg.fbGet || fbGet, gravar = cfg.fbPatch || fbPatch;
  if (!(await autoLigado(ler))) return [];
  let todas;
  try { todas = (await ler(ROTINAS)) || {}; } catch (_) { return []; }
  const agora = (cfg.agora || agoraSP)(), feitas = [];
  for (const [id, reg] of Object.entries(todas)) {
    if (!reg || !reg.iniciadaEm || reg.terminadaEm) continue;
    const ev = { id, data: reg.data, hora: reg.hora || '' };
    const aindaVem = !!reg.data && `${reg.data}T${reg.hora || '23:59'}` > agora;
    if (aindaVem && (reg.tentativas || 1) < MAX_TENTATIVAS) { feitas.push({ id, ...(await rotinaAuto(ev, cfg, { retomar: true })) }); continue; }
    // não dá mais para retomar: fecha o registro e tira o "preparando…" do grupo
    const motivo = aindaVem ? 'foi interrompida duas vezes' : 'foi interrompida e a sessão já começou';
    if (reg.statusMid && reg.statusChat) await cfg.api.editMessageText(reg.statusChat, reg.statusMid, `⚠️ Modo automático: a preparação da pauta da ${sessaoBR(ev)} ${motivo}. Se ainda for preciso, use /importar, /analisar e /exportar.`).catch(() => {});
    await gravar(`${ROTINAS}/${id}`, { erro: motivo, terminadaEm: new Date().toISOString() }).catch(() => {});
    feitas.push({ id, erro: motivo });
  }
  return feitas;
}

module.exports = { autoLigado, setAutoLigado, statusAuto, rotinaAuto, retomarRotinasInterrompidas, fatiar, textoInicio, textoProgresso, textoResumo, cargaResponsaveis, nomePdf };
