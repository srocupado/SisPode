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
  if ((r.incertos || []).length) L.push(`⚠ Autoria ou apensados NÃO verificados (podem faltar entre os itens do Podemos): ${r.incertos.join(', ')}.`);
  L.push('O PDF é material de urgência: as notas geradas agora ainda não foram revisadas.');
  return L.join('\n');
}
const nomePdf = titulo => `${String(titulo || '').replace(/[^\w\- ]+/g, '').trim() || 'pauta'}.pdf`;

/**
 * A rotina de UMA sessão convocada com pauta. `ev`: { id, data, hora, nome }.
 * cfg: { api, destino(), perfil(), executar (worker.rotinaPautaDaSessao), arquivo(buffer, nome) → documento do
 *        Telegram, travar() → true se pegou a vez no painel, destravar(), fbGet, fbPatch, esperar(ms) }.
 * Devolve { pulou: motivo } | { ok: true, pautaId } | { erro }. Nunca lança.
 */
async function rotinaAuto(ev, cfg) {
  const ler = cfg.fbGet || fbGet, gravar = cfg.fbPatch || fbPatch;
  const esperar = cfg.esperar || (ms => new Promise(r => setTimeout(r, ms)));
  if (!(await autoLigado(ler))) return { pulou: 'desligado' };
  const destino = cfg.destino();
  if (!destino) return { pulou: 'sem destino' };
  const chave = `${ROTINAS}/${ev.id}`;
  let reg;
  try { reg = await ler(chave); } catch (_) { return { pulou: 'registro ilegível' }; }
  if (reg) return { pulou: 'já feita' };
  await gravar(chave, { data: ev.data, hora: ev.hora || '', iniciadaEm: new Date().toISOString() }).catch(() => {});

  const perfil = cfg.perfil ? cfg.perfil() : null;
  let status = null;
  const editar = async t => { if (status) await cfg.api.editMessageText(destino, status.message_id, t).catch(() => {}); };
  const fim = async (patch) => { await gravar(chave, { ...patch, terminadaEm: new Date().toISOString() }).catch(() => {}); };
  try {
    status = await cfg.api.sendMessage(destino, textoInicio(ev, !!(perfil && perfil.apiKey)));
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
    await cfg.api.sendDocument(destino, cfg.arquivo(r.pdf, nomePdf(r.titulo)), { caption: `${r.titulo} — ${r.numItens} ${r.numItens === 1 ? 'item' : 'itens'} · PDF institucional gerado pelo SisPode Bot` });
    if (r.apelidos) await cfg.api.sendMessage(destino, r.apelidos);
    if (r.podemos && r.podemos.total && r.podemos.texto) await cfg.api.sendMessage(destino, r.podemos.texto);
    await editar(textoResumo(ev, r));
    await fim({ pautaId: r.pautaId, itens: r.numItens, comNota: r.comNota || 0, existente: !!r.existente });
    return { ok: true, pautaId: r.pautaId };
  } catch (e) {
    console.error(`[auto] rotina da sessão ${ev.id} falhou:`, e);
    const msg = `⚠️ Modo automático: não consegui preparar a pauta da ${sessaoBR(ev)} (${e.message}). O que já foi feito está salvo; termine com /importar, /analisar e /exportar.`;
    if (status) await editar(msg); else await cfg.api.sendMessage(destino, msg).catch(() => {});
    await fim({ erro: String(e.message || e).slice(0, 300) });
    return { erro: e.message };
  }
}

module.exports = { autoLigado, setAutoLigado, statusAuto, rotinaAuto, textoInicio, textoProgresso, textoResumo, cargaResponsaveis, nomePdf };
