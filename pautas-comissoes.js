// Pautas de Comissões — a TELA. Uma aba por comissão permanente e a aba
// "Semana" com todas as reuniões deliberativas. A pauta de cada reunião vem
// da API da Câmara; cada item é analisado nos moldes do Plenário (nota única
// em Markdown, editável), sem cenários: o que se analisa é o parecer do
// relator daquela comissão. A lógica sem tela está em pautas-comissoes-core.js;
// o cliente de IA e os utilitários, em ia-comum.js (carregados antes).

const FIREBASE_PC = 'https://plenario-podemos-default-rtdb.firebaseio.com/pautas-comissoes';
const CACHE_ORGAOS_MS = 24 * 3600 * 1000, CACHE_EVENTOS_MS = 3600 * 1000, CACHE_DEPS_MS = 24 * 3600 * 1000;
const SIGLA_PODEMOS_PC = 'PODE';

const pc = {
  config: null,
  comissoes: COMISSOES_PERMANENTES.slice(),
  aba: 'semana',                       // 'semana' | sigla
  semana: { inicio: null, eventos: [], carregando: false },
  indice: {},                          // { orgaoId: { eventoId: {data, hora, tipo, nItens, nAnalisados, ...} } }
  configComissoes: {},                 // { sigla: { provedor, modelo, promptExtra, por, atualizadoEm } } — Firebase, da equipe
  cal: { orgaoId: null, ano: null, mes: null, eventos: {}, dia: null, reuniao: null, pauta: null },
  reuniao: null,                       // reunião aberta: { chave, orgaoId, sigla, eventoId, data, hora, ..., itens: [] }
  detalhes: new Map(),                 // idProposicao → /proposicoes/{id}
  podemosIds: null,                    // Set de ids de deputados do Podemos
  fila: null,
  lote: null,                          // { total, feitas, falhas, rotulo } enquanto "gerar todas" roda
  busca: '',
};

// ============================================================
//  BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  pc.config = await new Promise(r => chrome.storage.local.get('config', d => r(d.config || {})));
  pc.fila = criarFila({ paralelas: pc.config.comissoes?.paralelas || 2, intervaloMs: (pc.config.comissoes?.intervaloS ?? 3) * 1000 });
  pc.fila.aoMudar(atualizarBarraLote);

  document.getElementById('btn-voltar').addEventListener('click', () => { history.length > 1 ? history.back() : window.close(); });
  document.getElementById('btn-gestao').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('comissoes.html') }));
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPdfReuniao);
  document.getElementById('btn-parar').addEventListener('click', pararTudo);
  document.getElementById('btn-configuracoes').addEventListener('click', abrirConfigPC);
  document.getElementById('btn-config-salvar').addEventListener('click', salvarConfigPC);
  document.getElementById('config-provedor').addEventListener('change', () => { preencherChaveEModelos(); });
  document.getElementById('btn-config-modelos').addEventListener('click', () => preencherChaveEModelos({ listar: true, manterChave: true }));
  document.getElementById('btn-cc-modelos').addEventListener('click', () => preencherModelosCC(undefined, { listar: true }));
  document.getElementById('btn-reanalise-executar').addEventListener('click', executarReanalise);
  document.getElementById('btn-semana-executar').addEventListener('click', executarGerarSemana);
  document.getElementById('btn-cc-salvar').addEventListener('click', salvarConfigComissao);
  document.getElementById('btn-cc-limpar').addEventListener('click', limparConfigComissao);
  document.getElementById('cc-provedor').addEventListener('change', () => preencherModelosCC());
  document.querySelectorAll('[data-fecha]').forEach(b => b.addEventListener('click', () => { document.getElementById(b.dataset.fecha).style.display = 'none'; }));
  document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; }));

  const hoje = new Date().toISOString().slice(0, 10);
  pc.semana.inicio = semanaDe(hoje).inicio;
  renderAbas();
  renderTela();
  await Promise.all([carregarComissoes(), carregarIndice(), carregarPodemos(), carregarConfigComissoes()]);
  renderAbas();
  await carregarSemana();
});

// ============================================================
//  DADOS DA CÂMARA (com cache em chrome.storage)
// ============================================================
function cacheGet(chave, ttl) {
  return new Promise(r => chrome.storage.local.get(chave, d => { const c = d[chave]; r(c && Date.now() - c.ts < ttl ? c.dados : null); }));
}
function cacheSet(chave, dados) { return new Promise(r => chrome.storage.local.set({ [chave]: { ts: Date.now(), dados } }, r)); }

async function apiCamara(caminho) {
  const res = await fetch(`${API_CAMARA_PC}${caminho}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${caminho}`);
  return await res.json();
}

async function carregarComissoes() {
  const emCache = await cacheGet('pc_orgaos', CACHE_ORGAOS_MS);
  if (emCache?.length) { pc.comissoes = emCache; return; }
  try {
    const j = await apiCamara('/orgaos?codTipoOrgao=2&itens=100&ordem=ASC&ordenarPor=sigla');
    const lista = normalizarOrgaos(j.dados);
    if (lista.length >= 20) { pc.comissoes = lista; await cacheSet('pc_orgaos', lista); }
  } catch (e) { console.warn('[comissões] lista da API indisponível; usando a fixa:', e.message); }
}

/** Ids dos deputados do Podemos, para marcar autoria (a API de autores só dá o id). */
async function carregarPodemos() {
  let ids = await cacheGet('pc_podemos', CACHE_DEPS_MS);
  if (!ids) {
    try { const j = await apiCamara(`/deputados?siglaPartido=${SIGLA_PODEMOS_PC}&itens=100&ordem=ASC&ordenarPor=nome`); ids = (j.dados || []).map(d => Number(d.id)); await cacheSet('pc_podemos', ids); }
    catch (_) { ids = []; }
  }
  pc.podemosIds = new Set(ids);
}

/** Reuniões deliberativas de TODAS as permanentes num intervalo (paginado). */
async function eventosNoIntervalo(inicio, fim) {
  const chave = `pc_ev_${inicio}_${fim}`;
  const emCache = await cacheGet(chave, CACHE_EVENTOS_MS);
  if (emCache) return emCache;
  let todos = [];
  for (let pagina = 1; pagina <= 8; pagina++) {
    const j = await apiCamara(`/eventos?dataInicio=${inicio}&dataFim=${fim}&itens=100&pagina=${pagina}`);
    const d = j.dados || []; todos = todos.concat(d);
    if (d.length < 100 || !(j.links || []).some(l => l.rel === 'next')) break;
  }
  const evs = eventosDeliberativos(todos);
  await cacheSet(chave, evs);
  return evs;
}

/** Reuniões deliberativas de UMA comissão no mês. */
async function eventosDoMes(orgaoId, ano, mes) {
  const mm = String(mes + 1).padStart(2, '0');
  const inicio = `${ano}-${mm}-01`, fim = `${ano}-${mm}-${new Date(ano, mes + 1, 0).getDate()}`;
  const chave = `pc_cal_${orgaoId}_${ano}_${mm}`;
  const emCache = await cacheGet(chave, CACHE_EVENTOS_MS);
  if (emCache) return emCache;
  const j = await apiCamara(`/orgaos/${orgaoId}/eventos?dataInicio=${inicio}&dataFim=${fim}&itens=100`);
  const evs = eventosDeliberativos(j.dados, { orgaoId });
  await cacheSet(chave, evs);
  return evs;
}

async function pautaDoEvento(eventoId) {
  const j = await apiCamara(`/eventos/${eventoId}/pauta`);
  return itensDaPauta(j.dados || []);
}

async function detalheProposicao(id) {
  if (!id) return null;
  if (pc.detalhes.has(id)) return pc.detalhes.get(id);
  try { const j = await apiCamara(`/proposicoes/${id}`); pc.detalhes.set(id, j.dados || null); return j.dados || null; }
  catch (e) { console.warn('[proposição]', id, e.message); return null; }
}

/** Autores de cada item, com a marca do Podemos; roda em segundo plano depois da importação. */
async function enriquecerAutores(reuniao) {
  const fila = reuniao.itens.filter(it => !it.autores);
  let i = 0;
  const trab = async () => {
    while (i < fila.length) {
      const it = fila[i++];
      try {
        const j = await apiCamara(`/proposicoes/${it.idMateria}/autores`);
        it.autores = (j.dados || []).map(a => { const m = String(a.uri || '').match(/\/deputados\/(\d+)/); const id = m ? Number(m[1]) : null; return { nome: a.nome || '?', id, partido: id && pc.podemosIds?.has(id) ? SIGLA_PODEMOS_PC : '' }; });
      } catch (_) { it.autores = []; }
      if (pc.reuniao === reuniao) atualizarBadgesItem(it);
    }
  };
  await Promise.all([trab(), trab(), trab()]);
  if (pc.reuniao === reuniao) fbSalvarReuniao(reuniao).catch(() => {});
}

// ============================================================
//  FIREBASE
// ============================================================
async function fbGetPC(caminho) { const r = await fetch(`${FIREBASE_PC}/${caminho}.json`); if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`); return await r.json(); }
async function fbPutPC(caminho, dados) { const r = await fetch(`${FIREBASE_PC}/${caminho}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) }); if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`); }
async function fbDeletePC(caminho) { const r = await fetch(`${FIREBASE_PC}/${caminho}.json`, { method: 'DELETE' }); if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`); }
async function fbPatchPC(caminho, dados) { const r = await fetch(`${FIREBASE_PC}/${caminho}.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) }); if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`); }

async function carregarIndice() {
  try { pc.indice = (await fbGetPC('indice')) || {}; } catch (e) { console.warn('[índice]', e.message); pc.indice = {}; }
}
function metaIndice(orgaoId, eventoId) { return pc.indice?.[orgaoId]?.[eventoId] || null; }

/** A reunião sem as análises (elas ficam em /analises, uma por item). */
async function fbSalvarReuniao(reuniao) {
  const itens = reuniao.itens.map(({ analise, ...resto }) => resto);
  const nAnalisados = reuniao.itens.filter(it => temNotaPC(it)).length;
  await fbPutPC(`reunioes/${reuniao.chave}`, { ...reuniao, itens, atualizadoEm: new Date().toISOString() });
  const meta = { data: reuniao.data, hora: reuniao.hora, tipo: reuniao.tipo, descricao: reuniao.descricao || '', local: reuniao.local || '', sigla: reuniao.sigla, nItens: reuniao.itens.length, nAnalisados, importadaEm: reuniao.importadaEm, por: reuniao.por, atualizadoEm: new Date().toISOString() };
  await fbPatchPC(`indice/${reuniao.orgaoId}/${reuniao.eventoId}`, meta);
  (pc.indice[reuniao.orgaoId] = pc.indice[reuniao.orgaoId] || {})[reuniao.eventoId] = { ...(metaIndice(reuniao.orgaoId, reuniao.eventoId) || {}), ...meta };
}
async function fbSalvarAnalise(reuniao, it) {
  await fbPutPC(`analises/${reuniao.chave}/${it.chave}`, it.analise);
  const nAnalisados = reuniao.itens.filter(x => temNotaPC(x)).length;
  await fbPatchPC(`indice/${reuniao.orgaoId}/${reuniao.eventoId}`, { nAnalisados, atualizadoEm: new Date().toISOString() });
  const m = metaIndice(reuniao.orgaoId, reuniao.eventoId); if (m) m.nAnalisados = nAnalisados;
}
/** Apaga a reunião importada: a pauta, as notas de cada item e a entrada no índice. */
async function apagarReuniao({ chave, orgaoId, eventoId }) {
  await Promise.all([fbDeletePC(`reunioes/${chave}`), fbDeletePC(`analises/${chave}`), fbDeletePC(`indice/${orgaoId}/${eventoId}`)]);
  if (pc.indice[orgaoId]) delete pc.indice[orgaoId][eventoId];
  if (pc.reuniao && pc.reuniao.chave === chave) pc.reuniao = null;
}
async function confirmarApagarReuniao(meta) {
  const m = metaIndice(meta.orgaoId, meta.eventoId) || {};
  if (!confirm(`Apagar a pauta da ${meta.sigla || ''} de ${dataBR(meta.data || m.data)}${m.nAnalisados ? `, com ${m.nAnalisados} nota(s) gerada(s)` : ''}? Isso vale para toda a equipe e não tem volta.`)) return;
  try { await apagarReuniao(meta); mostrarToast('Pauta apagada.', 'info'); renderAbas(); renderTela(); }
  catch (e) { mostrarToast('Não apaguei: ' + e.message, 'erro'); }
}
async function fbCarregarReuniao(chave) {
  const [r, analises] = await Promise.all([fbGetPC(`reunioes/${chave}`), fbGetPC(`analises/${chave}`).catch(() => null)]);
  if (!r) return null;
  r.itens = Array.isArray(r.itens) ? r.itens : Object.values(r.itens || {});
  for (const it of r.itens) { it.autores = Array.isArray(it.autores) ? it.autores : (it.autores ? Object.values(it.autores) : it.autores); if (analises && analises[it.chave]) it.analise = analises[it.chave]; }
  return r;
}

// ============================================================
//  ABAS E TELAS
// ============================================================
function comissaoDe(sigla) { return pc.comissoes.find(c => c.sigla === sigla) || null; }
function reunioesDaSemanaDe(orgaoId) { return pc.semana.eventos.filter(e => e.orgaoId === orgaoId && !/cancelad/i.test(e.situacao)); }

function renderAbas() {
  const nav = document.getElementById('pc-abas');
  const n = pc.semana.eventos.filter(e => !/cancelad/i.test(e.situacao)).length;
  const abas = [`<button class="pc-aba${pc.aba === 'semana' ? ' ativa' : ''}" data-aba="semana">📆 Semana <span class="n${n ? '' : ' zero'}">${n}</span></button>`]
    .concat(pc.comissoes.map(c => { const k = reunioesDaSemanaDe(c.id).length; return `<button class="pc-aba${pc.aba === c.sigla ? ' ativa' : ''}" data-aba="${escapeHtml(c.sigla)}" title="${escapeHtml(c.nome)}">${escapeHtml(c.sigla)} <span class="n${k ? '' : ' zero'}">${k}</span></button>`; }));
  nav.innerHTML = abas.join('');
  nav.querySelectorAll('.pc-aba').forEach(b => b.addEventListener('click', () => irParaAba(b.dataset.aba)));
  const ativa = nav.querySelector('.pc-aba.ativa'); if (ativa && typeof ativa.scrollIntoView === 'function') ativa.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

async function irParaAba(aba) {
  pc.aba = aba;
  if (aba !== 'semana') { const c = comissaoDe(aba); if (c && pc.cal.orgaoId !== c.id) { const hoje = new Date(); Object.assign(pc.cal, { orgaoId: c.id, ano: hoje.getFullYear(), mes: hoje.getMonth(), eventos: {}, dia: null, reuniao: null, pauta: null }); } }
  if (aba === 'semana' || !pc.reuniao || pc.reuniao.sigla !== aba) pc.reuniao = null;
  renderAbas(); renderTela();
  if (aba !== 'semana') await carregarCalendario();
}

function renderTela() {
  document.getElementById('btn-exportar-pdf').disabled = !pc.reuniao;
  if (pc.aba === 'semana') { renderLateralSemana(); renderSemana(); return; }
  renderLateralComissao();
  if (pc.reuniao) renderReuniao(); else renderCalendario();
}

// ---------- SEMANA ----------
async function carregarSemana() {
  const sem = semanaDe(pc.semana.inicio);
  pc.semana.carregando = true; renderTela();
  try { pc.semana.eventos = await eventosNoIntervalo(sem.inicio, sem.fim); }
  catch (e) { mostrarToast('Não consegui ler a agenda da Câmara: ' + e.message, 'erro'); pc.semana.eventos = []; }
  pc.semana.carregando = false;
  renderAbas(); renderTela();
}
function mudarSemana(delta) {
  const d = new Date(`${pc.semana.inicio}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * delta);
  pc.semana.inicio = semanaDe(d.toISOString().slice(0, 10)).inicio;
  carregarSemana();
}

function renderLateralSemana() {
  const total = pc.semana.eventos.length, comPauta = pc.semana.eventos.filter(e => metaIndice(e.orgaoId, e.id)).length;
  const nAnal = pc.semana.eventos.reduce((s, e) => s + (metaIndice(e.orgaoId, e.id)?.nAnalisados || 0), 0);
  document.getElementById('pc-lat').innerHTML = `
    <h4>Esta semana</h4>
    <div class="item"><small>reuniões deliberativas</small>${total} em ${new Set(pc.semana.eventos.map(e => e.sigla)).size} comissões</div>
    <div class="item"><small>pautas importadas</small>${comPauta} de ${total}</div>
    <div class="item"><small>notas geradas</small>${nAnal}</div>
    <h4>Ações</h4>
    <div class="item" id="lat-gerar-semana">⚡ Gerar todas as pautas da semana<small>importa o que falta e analisa cada item, na fila</small></div>
    <div class="item" id="lat-atualizar-semana">↻ Reler a agenda da Câmara<small>ignora o cache de 1 hora</small></div>`;
  document.getElementById('lat-gerar-semana').addEventListener('click', abrirModalSemana);
  document.getElementById('lat-atualizar-semana').addEventListener('click', async () => { await new Promise(r => chrome.storage.local.remove(`pc_ev_${semanaDe(pc.semana.inicio).inicio}_${semanaDe(pc.semana.inicio).fim}`, r)); carregarSemana(); });
}

function renderSemana() {
  const sem = semanaDe(pc.semana.inicio);
  const porDia = agruparPorData(pc.semana.eventos);
  const main = document.getElementById('pc-main');
  const dias = sem.dias.filter(d => porDia[d]).map(d => {
    const linhas = porDia[d].map(ev => {
      const m = metaIndice(ev.orgaoId, ev.id);
      const cancelada = /cancelad/i.test(ev.situacao);
      const status = cancelada ? '<span class="pill vermelho">cancelada</span>'
        : m ? (m.nAnalisados >= m.nItens && m.nItens > 0 ? `<span class="pill verde">pauta salva · ${m.nItens} analisados</span>` : `<span class="pill ambar">pauta salva · ${m.nAnalisados || 0} de ${m.nItens} analisados</span>`)
        : `<span class="pill">${/encerrad/i.test(ev.situacao) ? 'encerrada · não importada' : 'não importada'}</span>`;
      const acao = cancelada ? '' : m ? `<button class="btn btn-primary btn-sm" data-abrir="${ev.orgaoId}_${ev.id}">Abrir pauta</button>` : `<button class="btn btn-outline btn-sm" data-importar="${ev.orgaoId}_${ev.id}">Importar pauta</button>`;
      return `<div class="pc-reu${cancelada ? ' cancelada' : ''}"><span class="sig" data-aba="${escapeHtml(ev.sigla)}">${escapeHtml(ev.sigla)}</span><span class="h">${escapeHtml(ev.hora)}</span><span class="nm">${escapeHtml(ev.tipo)}${ev.descricao && !/discussão e votação de propostas legislativas/i.test(ev.descricao) ? ` · <small>${escapeHtml(ev.descricao.slice(0, 90))}</small>` : ''}${ev.local ? ` · <small>${escapeHtml(ev.local)}</small>` : ''}${ev.conjunta ? ` · <small>conjunta: ${escapeHtml(ev.conjunta.join(' + '))}</small>` : ''}</span><span>${status}</span><span>${acao}</span></div>`;
    }).join('');
    return `<div class="pc-dia"><h3>${diaSemana(d)[0].toUpperCase() + diaSemana(d).slice(1)}, ${dataBR(d).slice(0, 5)} <small>${porDia[d].length} reunião(ões)</small></h3>${linhas}</div>`;
  }).join('');
  main.innerHTML = `
    <div class="pc-top"><div><h2>${escapeHtml(rotuloSemana(sem))}</h2><p>Reuniões deliberativas das comissões permanentes, lidas da API da Câmara. Cada aba acima é um colegiado; o número é quantas reuniões ele tem nesta semana.</p></div>
      <div style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-outline btn-sm" id="sem-ant">‹ semana anterior</button><button class="btn btn-outline btn-sm" id="sem-hoje">hoje</button><button class="btn btn-outline btn-sm" id="sem-prox">próxima ›</button></div></div>
    <div class="pc-progresso" id="pc-progresso"><span id="pc-progresso-txt"></span><div class="bar"><i id="pc-progresso-bar"></i></div></div>
    ${pc.semana.carregando ? '<div class="pc-status">Lendo a agenda da Câmara…</div>' : dias || '<div class="pc-vazio">Nenhuma reunião deliberativa de comissão permanente nesta semana.</div>'}`;
  document.getElementById('sem-ant').addEventListener('click', () => mudarSemana(-1));
  document.getElementById('sem-prox').addEventListener('click', () => mudarSemana(1));
  document.getElementById('sem-hoje').addEventListener('click', () => { pc.semana.inicio = semanaDe(new Date().toISOString().slice(0, 10)).inicio; carregarSemana(); });
  main.querySelectorAll('[data-importar]').forEach(b => b.addEventListener('click', () => { const ev = pc.semana.eventos.find(e => `${e.orgaoId}_${e.id}` === b.dataset.importar); if (ev) importarEAbrir(ev); }));
  main.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => { const ev = pc.semana.eventos.find(e => `${e.orgaoId}_${e.id}` === b.dataset.abrir); if (ev) abrirSalva(ev); }));
  main.querySelectorAll('.sig[data-aba]').forEach(s => s.addEventListener('click', () => irParaAba(s.dataset.aba)));
  atualizarBarraLote();
}

// ---------- COMISSÃO: lateral + calendário ----------
function renderLateralComissao() {
  const c = comissaoDe(pc.aba); if (!c) return;
  const salvas = Object.entries(pc.indice[c.id] || {}).map(([eventoId, m]) => ({ eventoId: Number(eventoId), ...m })).sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora)).slice(0, 25);
  document.getElementById('pc-lat').innerHTML = `
    <h4>${escapeHtml(c.sigla)} — ${escapeHtml(c.nome.replace(/^Comissão (de |da |do )?/i, ''))}</h4>
    <div class="item" id="lat-cal"${!pc.reuniao ? ' style="color:var(--text)"' : ''}>📅 Calendário da comissão<small>reuniões por mês, importar pauta</small></div>
    <div class="item" id="lat-cfg">⚙ Provedor e prompt da ${escapeHtml(c.sigla)}<small>${escapeHtml(resumoConfigComissao(c.sigla))}</small></div>
    <h4>Pautas salvas</h4>
    ${salvas.length ? salvas.map(m => `<div class="item${pc.reuniao && pc.reuniao.eventoId === m.eventoId ? ' ativo' : ''}" data-salva="${m.eventoId}" style="position:relative;padding-right:30px">Reunião de ${escapeHtml(dataBR(m.data))}${m.hora ? ` · ${escapeHtml(m.hora)}` : ''}<small>${m.nItens} itens · ${m.nAnalisados || 0} analisados${m.por ? ` · ${escapeHtml(m.por)}` : ''}</small><button class="pc-apagar" data-apagar="${m.eventoId}" title="Apagar esta pauta e suas notas (para toda a equipe)">✕</button></div>`).join('') : '<div class="vazio">Nenhuma pauta salva desta comissão.</div>'}`;
  document.getElementById('lat-cal').addEventListener('click', () => { pc.reuniao = null; renderTela(); });
  document.getElementById('lat-cfg').addEventListener('click', () => abrirConfigComissao(c.sigla));
  document.querySelectorAll('[data-salva]').forEach(el => el.addEventListener('click', e => { if (e.target.closest('[data-apagar]')) return; abrirSalva({ orgaoId: c.id, id: Number(el.dataset.salva) }); }));
  document.querySelectorAll('[data-apagar]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const m = metaIndice(c.id, Number(b.dataset.apagar)) || {}; confirmarApagarReuniao({ chave: `${c.id}_${b.dataset.apagar}`, orgaoId: c.id, eventoId: Number(b.dataset.apagar), sigla: c.sigla, data: m.data }); }));
}

async function carregarCalendario() {
  const { orgaoId, ano, mes } = pc.cal;
  if (!orgaoId) return;
  try { const evs = await eventosDoMes(orgaoId, ano, mes); if (pc.cal.orgaoId === orgaoId && pc.cal.ano === ano && pc.cal.mes === mes) { pc.cal.eventos = agruparPorData(evs); if (!pc.reuniao) renderCalendario(); } }
  catch (e) { mostrarToast('Não consegui ler o calendário: ' + e.message, 'erro'); }
}
function navCalendario(delta) {
  let m = pc.cal.mes + delta, a = pc.cal.ano;
  if (m < 0) { m = 11; a--; } if (m > 11) { m = 0; a++; }
  Object.assign(pc.cal, { ano: a, mes: m, eventos: {}, dia: null, reuniao: null, pauta: null });
  renderCalendario(); carregarCalendario();
}

function renderCalendario() {
  const c = comissaoDe(pc.aba); if (!c) return;
  const { ano, mes, eventos, dia } = pc.cal;
  const hoje = new Date().toISOString().slice(0, 10);
  const primeiro = new Date(ano, mes, 1).getDay(), total = new Date(ano, mes + 1, 0).getDate();
  let grade = ''; for (let i = 0; i < primeiro; i++) grade += '<div class="cal-dia vazio"></div>';
  for (let d = 1; d <= total; d++) {
    const ds = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const tem = !!eventos[ds];
    grade += `<div class="cal-dia${tem ? ' tem-reuniao' : ''}${ds === hoje ? ' hoje' : ''}${ds === dia ? ' selecionado' : ''}" data-dia="${ds}">${d}${tem ? '<span class="cal-dot"></span>' : ''}</div>`;
  }
  const lista = Object.values(eventos).flat().sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  document.getElementById('pc-main').innerHTML = `
    <div class="pc-top"><div><h2>Calendário — ${escapeHtml(c.nome)}</h2><p>Reuniões deliberativas lidas da API da Câmara (órgão ${c.id}). Clique no dia para ver a reunião e importar a pauta.</p></div></div>
    <div class="pc-cal">
      <div class="cal-wrap">
        <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="cal-prev">‹</button><span class="cal-titulo">${meses[mes]} ${ano}</span><button class="btn btn-ghost btn-sm" id="cal-next">›</button></div>
        <div class="cal-dow-grid"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div>
        <div class="cal-grade" id="cal-grade">${grade}</div>
        <div class="pc-status">${lista.length} reunião(ões) deliberativa(s) neste mês</div>
      </div>
      <div id="cal-card"></div>
    </div>
    <div class="pc-mes"><h3>Reuniões do mês</h3>${lista.map(ev => linhaReuniaoMes(ev)).join('') || '<div class="pc-status">Nenhuma.</div>'}</div>`;
  document.getElementById('cal-prev').addEventListener('click', () => navCalendario(-1));
  document.getElementById('cal-next').addEventListener('click', () => navCalendario(1));
  document.querySelectorAll('.cal-dia.tem-reuniao').forEach(el => el.addEventListener('click', () => selecionarDia(el.dataset.dia)));
  document.querySelectorAll('[data-sel-ev]').forEach(el => el.addEventListener('click', () => { const ev = lista.find(e => String(e.id) === el.dataset.selEv); if (ev) { pc.cal.dia = ev.data; mostrarCardReuniao(ev); } }));
  if (dia && eventos[dia]) { if (pc.cal.reuniao) mostrarCardReuniao(pc.cal.reuniao); else selecionarDia(dia); }
}
function linhaReuniaoMes(ev) {
  const m = metaIndice(ev.orgaoId, ev.id);
  const st = /cancelad/i.test(ev.situacao) ? '<span class="pill vermelho">cancelada</span>' : m ? `<span class="pill ${m.nAnalisados >= m.nItens && m.nItens ? 'verde' : 'ambar'}">salva · ${m.nAnalisados || 0} de ${m.nItens} analisados</span>` : `<span class="pill">${escapeHtml(ev.situacao || 'agendada')}</span>`;
  return `<div class="pc-reu" style="cursor:pointer" data-sel-ev="${ev.id}"><span class="sig">${diaSemana(ev.data).slice(0, 3)} ${escapeHtml(dataBR(ev.data).slice(0, 5))}</span><span class="nm">${escapeHtml(ev.tipo)} · ${escapeHtml(ev.hora)}${ev.local ? ` · ${escapeHtml(ev.local)}` : ''}</span><span>${st}</span></div>`;
}
function selecionarDia(ds) {
  pc.cal.dia = ds; pc.cal.reuniao = null; pc.cal.pauta = null;
  document.querySelectorAll('.cal-dia').forEach(el => el.classList.toggle('selecionado', el.dataset.dia === ds));
  const evs = pc.cal.eventos[ds] || [];
  if (evs.length === 1) mostrarCardReuniao(evs[0]);
  else document.getElementById('cal-card').innerHTML = `<div class="pc-card-reuniao"><span class="badge">${evs.length} reuniões neste dia</span><div class="data">${escapeHtml(dataBR(ds))}</div>${evs.map(ev => `<button class="btn btn-outline btn-sm" style="display:block;width:100%;text-align:left;margin-top:6px" data-ev="${ev.id}"><b>${escapeHtml(ev.hora)}</b> · ${escapeHtml(ev.tipo)}${ev.local ? ` · ${escapeHtml(ev.local)}` : ''}</button>`).join('')}</div>`;
  document.querySelectorAll('#cal-card [data-ev]').forEach(b => b.addEventListener('click', () => mostrarCardReuniao(evs.find(e => String(e.id) === b.dataset.ev))));
}
async function mostrarCardReuniao(ev) {
  pc.cal.reuniao = ev;
  const m = metaIndice(ev.orgaoId, ev.id);
  const card = document.getElementById('cal-card');
  card.innerHTML = `<div class="pc-card-reuniao"><span class="badge">${escapeHtml(ev.tipo)}</span>
    <div class="data">${escapeHtml(dataBR(ev.data))} · ${escapeHtml(ev.hora)}${ev.horaFim ? '–' + escapeHtml(ev.horaFim) : ''}</div>
    <div class="info">${ev.local ? escapeHtml(ev.local) + ' · ' : ''}Situação: ${escapeHtml(ev.situacao || 'agendada')}${ev.descricao ? `<br>${escapeHtml(ev.descricao)}` : ''}${m ? `<br>Pauta salva em ${escapeHtml(formatDataHora(m.importadaEm))}${m.por ? ` por ${escapeHtml(m.por)}` : ''} · ${m.nItens} itens · ${m.nAnalisados || 0} analisados` : ''}</div>
    <div class="pc-previa" id="cal-previa"><div>Lendo a pauta…</div></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="cal-importar">${m ? 'Reimportar da Câmara' : 'Importar pauta desta reunião'}</button>${m ? '<button class="btn btn-outline btn-sm" id="cal-abrir">Abrir pauta salva</button>' : ''}</div></div>`;
  document.getElementById('cal-importar').addEventListener('click', () => importarEAbrir(ev));
  const ab = document.getElementById('cal-abrir'); if (ab) ab.addEventListener('click', () => abrirSalva(ev));
  try {
    const itens = await pautaDoEvento(ev.id);
    if (pc.cal.reuniao !== ev) return;
    pc.cal.pauta = itens;
    const prev = document.getElementById('cal-previa');
    if (!itens.length) { prev.innerHTML = '<div>Pauta ainda não publicada na API.</div>'; document.getElementById('cal-importar').disabled = true; return; }
    prev.innerHTML = itens.slice(0, 5).map(it => `<div><b>Item ${it.ordem}</b> · ${escapeHtml(it.sigla)} ${it.numero}/${it.ano} — ${escapeHtml((it.ementa || '').slice(0, 70))}${it.ementa.length > 70 ? '…' : ''}${it.relator?.nome ? ` · rel. ${escapeHtml(it.relator.nome)}${it.relator.partido === SIGLA_PODEMOS_PC ? ' <span class="pill azul">Podemos</span>' : ''}` : ''}</div>`).join('') + (itens.length > 5 ? `<div>… e mais ${itens.length - 5} itens (${itens.length} no total)</div>` : '');
  } catch (e) { const prev = document.getElementById('cal-previa'); if (prev) prev.innerHTML = `<div>Não consegui ler a pauta: ${escapeHtml(e.message)}</div>`; }
}

// ---------- importar / abrir ----------
async function importarReuniao(ev, { silencioso = false } = {}) {
  const c = pc.comissoes.find(x => x.id === ev.orgaoId) || { id: ev.orgaoId, sigla: ev.sigla, nome: ev.nomeOrgao || ev.sigla };
  const itens = await pautaDoEvento(ev.id);
  if (!itens.length) throw new Error('a pauta desta reunião ainda não foi publicada na API');
  const chave = chaveReuniao(ev);
  // Reimportação: preserva as análises e o responsável dos itens que continuam na pauta.
  let anterior = null; try { anterior = await fbCarregarReuniao(chave); } catch (_) {}
  const mapaAnt = new Map((anterior?.itens || []).map(it => [it.chave, it]));
  for (const it of itens) { const a = mapaAnt.get(it.chave); if (a) { if (a.analise) it.analise = a.analise; if (a.analista) it.analista = a.analista; if (a.autores) it.autores = a.autores; } }
  const reuniao = { chave, orgaoId: c.id, sigla: c.sigla, nomeOrgao: c.nome, eventoId: ev.id, data: ev.data, hora: ev.hora, horaFim: ev.horaFim || '', tipo: ev.tipo, descricao: ev.descricao || '', local: ev.local || '', situacao: ev.situacao || '', importadaEm: new Date().toISOString(), por: pc.config?.nomeUsuario || 'equipe', itens };
  await fbSalvarReuniao(reuniao);
  if (!silencioso) mostrarToast(`✓ ${itens.length} itens importados da ${c.sigla}`, 'sucesso');
  enriquecerAutores(reuniao).catch(() => {});
  return reuniao;
}
async function importarEAbrir(ev) {
  try {
    mostrarToast('Importando a pauta…', 'info');
    const r = await importarReuniao(ev);
    pc.reuniao = r; pc.aba = r.sigla; if (pc.cal.orgaoId !== r.orgaoId) Object.assign(pc.cal, { orgaoId: r.orgaoId, ano: +r.data.slice(0, 4), mes: +r.data.slice(5, 7) - 1, eventos: {}, dia: null, reuniao: null, pauta: null });
    renderAbas(); renderTela();
  } catch (e) { mostrarToast('Não importei: ' + e.message, 'erro'); }
}
async function abrirSalva(ev) {
  try {
    const r = await fbCarregarReuniao(`${ev.orgaoId}_${ev.id}`);
    if (!r) { mostrarToast('Não há pauta salva para esta reunião.', 'aviso'); return; }
    pc.reuniao = r; pc.aba = r.sigla; if (pc.cal.orgaoId !== r.orgaoId) Object.assign(pc.cal, { orgaoId: r.orgaoId, ano: +r.data.slice(0, 4), mes: +r.data.slice(5, 7) - 1, eventos: {}, dia: null, reuniao: null, pauta: null });
    renderAbas(); renderTela();
    if (r.itens.some(it => !it.autores)) enriquecerAutores(r).catch(() => {});
  } catch (e) { mostrarToast('Não consegui abrir: ' + e.message, 'erro'); }
}

// ============================================================
//  REUNIÃO ABERTA: cards
// ============================================================
function temNotaPC(it) { return !!(it.analise && (it.analise.html || it.analise.markdown)); }
function ehDoPodemos(it) { return it.relator?.partido === SIGLA_PODEMOS_PC || (it.autores || []).some(a => a.partido === SIGLA_PODEMOS_PC); }
function notaHtmlPC(it) { const a = it.analise || {}; return a.formato === 'html' && a.html ? sanitizarNotaHtml(a.html) : renderMarkdown(a.markdown || ''); }

function renderReuniao() {
  const r = pc.reuniao, c = comissaoDe(r.sigla) || { sigla: r.sigla, nome: r.nomeOrgao };
  const main = document.getElementById('pc-main');
  const nA = r.itens.filter(temNotaPC).length, nP = r.itens.filter(ehDoPodemos).length;
  main.innerHTML = `
    <div class="pc-top"><div><h2>${escapeHtml(c.sigla)} · ${escapeHtml(tituloReuniao(r))} <span class="pill verde" id="pc-sync">salvo</span>${configDaComissao(r.sigla).promptExtra ? '<span class="pill azul" title="Esta comissão tem prompt customizado; ele entra em toda análise">prompt próprio</span>' : ''}${configDaComissao(r.sigla).provedor ? `<span class="pill azul">${escapeHtml(PROVEDORES_META[configDaComissao(r.sigla).provedor]?.label || configDaComissao(r.sigla).provedor)}</span>` : ''}</h2>
      <p>${escapeHtml(c.nome)}${r.local ? ` · ${escapeHtml(r.local)}` : ''} · pauta importada da API da Câmara em ${escapeHtml(formatDataHora(r.importadaEm))}${r.por ? ` por ${escapeHtml(r.por)}` : ''} · ${r.itens.length} itens · ${nA} com nota${nP ? ` · ${nP} do Podemos` : ''}</p></div></div>
    <div class="pc-acoes">
      <input class="form-input" id="pc-busca" placeholder="Buscar PL/PLP/PEC… ou ementa" value="${escapeHtml(pc.busca)}">
      <button class="btn btn-outline btn-sm" id="pc-reimportar" title="Relê a pauta na API; mantém as notas dos itens que continuam">↻ Atualizar da Câmara</button>
      <button class="btn btn-outline btn-sm" id="pc-gerar-todas">○ Gerar todas</button>
      <button class="btn btn-whatsapp btn-sm" id="pc-wa-partido">Proposições do Partido</button>
      <button class="btn btn-whatsapp btn-sm" id="pc-wa-resumo">Resumo da reunião</button>
      <button class="btn btn-ghost btn-sm" id="pc-apagar" style="margin-left:auto;color:#ff8e8e" title="Apaga a pauta importada e todas as notas dela, para toda a equipe">🗑 Apagar pauta</button>
    </div>
    <div class="pc-progresso" id="pc-progresso"><span id="pc-progresso-txt"></span><div class="bar"><i id="pc-progresso-bar"></i></div></div>
    <div id="pc-lista"></div>`;
  document.getElementById('pc-busca').addEventListener('input', e => { pc.busca = e.target.value; filtrarCards(); });
  document.getElementById('pc-reimportar').addEventListener('click', () => importarEAbrir({ orgaoId: r.orgaoId, id: r.eventoId, sigla: r.sigla, nomeOrgao: r.nomeOrgao, data: r.data, hora: r.hora, horaFim: r.horaFim, tipo: r.tipo, descricao: r.descricao, local: r.local, situacao: r.situacao }));
  document.getElementById('pc-gerar-todas').addEventListener('click', () => gerarTodasDaReuniao(r));
  document.getElementById('pc-wa-partido').addEventListener('click', () => copiar(textoPropPartido(c, r, r.itens), 'Proposições do Partido copiadas'));
  document.getElementById('pc-wa-resumo').addEventListener('click', () => copiar(textoResumoReuniao(c, r, r.itens), 'Resumo da reunião copiado'));
  document.getElementById('pc-apagar').addEventListener('click', () => confirmarApagarReuniao({ chave: r.chave, orgaoId: r.orgaoId, eventoId: r.eventoId, sigla: r.sigla, data: r.data }));
  const lista = document.getElementById('pc-lista');
  for (const it of r.itens) lista.appendChild(renderCardItem(it));
  filtrarCards(); atualizarBarraLote();
}
function filtrarCards() {
  const q = (pc.busca || '').trim().toLowerCase();
  document.querySelectorAll('#pc-lista .an-card').forEach(card => { const t = card.dataset.busca || ''; card.style.display = !q || t.includes(q) ? '' : 'none'; });
}

function renderCardItem(it) {
  const card = document.createElement('div');
  card.className = 'an-card'; card.dataset.chave = it.chave;
  card.dataset.busca = `${it.sigla} ${it.numero}/${it.ano} ${it.titulo} ${it.ementa} ${it.relator?.nome || ''}`.toLowerCase();
  const rel = it.relator?.nome ? `<span><b>Relator(a):</b> Dep. ${escapeHtml(it.relator.nome)}${it.relator.partido ? ` (${escapeHtml(it.relator.partido)}${it.relator.uf ? '-' + escapeHtml(it.relator.uf) : ''})` : ''}</span>` : '';
  card.innerHTML = `
    <div class="an-card-head">
      <div class="an-card-num">${it.ordem}</div>
      <div class="an-card-info">
        <div class="an-card-tipo">${escapeHtml(it.sigla)} ${it.numero}/${it.ano}${it.topico ? ` · ${escapeHtml(it.topico)}` : ''}${it.requerimento ? ' · requerimento' : ''}</div>
        <div class="an-card-ementa">${escapeHtml(it.ementa || '(sem ementa na pauta)')}</div>
        <div class="an-card-meta">
          <span data-role="autor-linha"></span>
          ${rel}
          ${it.textoParecer ? `<span><b>Parecer:</b> ${escapeHtml(it.textoParecer)}</span>` : '<span><b>Parecer:</b> ainda sem parecer na pauta</span>'}
          ${it.regime ? `<span><b>Regime:</b> ${escapeHtml(it.regime)}</span>` : ''}
          ${it.situacaoItem ? `<span><b>Resultado:</b> ${escapeHtml(it.situacaoItem)}</span>` : ''}
        </div>
        <div class="an-badges" data-role="badges"></div>
      </div>
    </div>
    <div class="an-card-actions">
      <button class="btn btn-primary btn-sm" data-role="btn-gerar">Gerar Análise</button>
      <button class="btn btn-outline btn-sm" data-role="btn-toggle" style="display:none">Ver análise</button>
      <a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://www.camara.leg.br/propostas-legislativas/${it.idMateria}" title="Ficha de tramitação na Câmara">🔗 Ficha</a>
      ${it.parecer?.id ? `<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://www.camara.leg.br/propostas-legislativas/${it.parecer.id}" title="Página do parecer na Câmara">📄 Parecer</a>` : ''}
      <label class="an-analista-label" title="Nome do(a) analista responsável pela nota">Responsável: <input type="text" class="an-analista-input pc-analista" data-role="inp-analista" placeholder="nome" value="${escapeHtml(it.analista || '')}"></label>
      <span class="an-analista-ok" data-role="analista-ok" title="Salvo">✓</span>
      <button class="btn btn-ghost btn-sm" data-role="btn-remover" style="margin-left:auto;color:#ff8e8e" title="Remover item desta pauta">Remover</button>
    </div>
    <div class="an-analise" data-role="painel-analise">
      <div class="an-analise-head">
        <span class="an-analise-meta" data-role="analise-meta"></span>
        <button class="btn btn-outline btn-sm" data-role="btn-editar">Editar</button>
        <button class="btn btn-primary btn-sm" data-role="btn-salvar-edicao" style="display:none">Salvar</button>
        <button class="btn btn-ghost btn-sm" data-role="btn-cancelar-edicao" style="display:none">Cancelar</button>
        <button class="btn btn-outline btn-sm" data-role="btn-reanalisar" title="Reanalisar com instruções adicionais">Reanalisar com IA</button>
        <button class="btn btn-outline btn-sm" data-role="btn-regerar">Regerar</button>
      </div>
      <div class="an-analise-erro" data-role="erro" style="display:none"></div>
      <div class="an-analise-conteudo pc-nota" data-role="analise-conteudo"></div>
      <div class="pc-quill" data-role="quill-wrap"><div data-role="quill-editor"></div></div>
    </div>`;
  const q = s => card.querySelector(`[data-role=${s}]`);
  q('btn-gerar').addEventListener('click', () => gerarAnaliseItem(pc.reuniao, it, { forcar: temNotaPC(it) }));
  q('btn-toggle').addEventListener('click', () => { const p = q('painel-analise'); const aberto = p.classList.toggle('aberto'); q('btn-toggle').textContent = aberto ? 'Ocultar análise' : 'Ver análise'; });
  q('btn-regerar').addEventListener('click', () => gerarAnaliseItem(pc.reuniao, it, { forcar: true }));
  q('btn-reanalisar').addEventListener('click', () => abrirReanalise(it));
  q('btn-editar').addEventListener('click', () => entrarEdicao(card, it));
  q('btn-salvar-edicao').addEventListener('click', () => salvarEdicao(card, it));
  q('btn-cancelar-edicao').addEventListener('click', () => sairEdicao(card, it));
  q('btn-remover').addEventListener('click', async () => { if (!confirm(`Remover ${it.sigla} ${it.numero}/${it.ano} desta pauta?`)) return; pc.reuniao.itens = pc.reuniao.itens.filter(x => x !== it); card.remove(); await fbSalvarReuniao(pc.reuniao).catch(e => mostrarToast('Firebase: ' + e.message, 'erro')); });
  let tAn = null;
  q('inp-analista').addEventListener('input', e => { it.analista = e.target.value.trim(); clearTimeout(tAn); tAn = setTimeout(async () => { if (it.analise) { it.analise.analista = it.analista; await fbSalvarAnalise(pc.reuniao, it).catch(() => {}); } await fbSalvarReuniao(pc.reuniao).catch(() => {}); const ok = q('analista-ok'); ok.classList.add('show'); setTimeout(() => ok.classList.remove('show'), 1500); }, 800); });
  atualizarBadgesItem(it, card);
  atualizarPainelItem(it, card);
  return card;
}
function cardDe(it) { return document.querySelector(`#pc-lista .an-card[data-chave="${it.chave}"]`); }
function atualizarBadgesItem(it, card = cardDe(it)) {
  if (!card) return;
  const b = [];
  if (it.relator?.partido === SIGLA_PODEMOS_PC) b.push('<span class="an-badge an-badge--rel">Relatoria Podemos</span>');
  const aut = (it.autores || []).filter(a => a.partido === SIGLA_PODEMOS_PC);
  if (aut.length) b.push(`<span class="an-badge an-badge--pode">Autoria Podemos: ${escapeHtml(aut.map(a => a.nome).join(', '))}</span>`);
  if (!it.autores) b.push('<span class="an-badge an-badge--neutro">Verificando autoria…</span>');
  if (it.analise?.truncada) b.push('<span class="an-badge an-badge--desatual" title="A resposta do modelo parou no limite de tokens">nota truncada</span>');
  card.querySelector('[data-role=badges]').innerHTML = b.join('');
  const al = card.querySelector('[data-role=autor-linha]');
  if (it.autores?.length) al.innerHTML = `<b>Autor:</b> ${escapeHtml(it.autores.slice(0, 3).map(a => a.nome + (a.partido ? ` (${a.partido})` : '')).join(', '))}${it.autores.length > 3 ? ` e mais ${it.autores.length - 3}` : ''}`;
}
function atualizarPainelItem(it, card = cardDe(it)) {
  if (!card) return;
  const q = s => card.querySelector(`[data-role=${s}]`);
  const tem = temNotaPC(it);
  q('btn-toggle').style.display = tem ? '' : 'none';
  q('btn-gerar').textContent = tem ? 'Gerar de novo' : 'Gerar Análise';
  q('btn-gerar').className = tem ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
  if (!tem) { q('painel-analise').classList.remove('aberto'); return; }
  const a = it.analise;
  q('analise-meta').innerHTML = `Documento${(a.documentos || []).length > 1 ? 's' : ''}: <b>${escapeHtml((a.documentos || []).map(d => d.rotulo).join('; ') || 'só a ementa e a conclusão da pauta')}</b> · ${escapeHtml(a.provedor || '')} ${escapeHtml(a.modelo || '')} · ${escapeHtml(formatDataHora(a.geradoEm))}${a.geradoPor ? ` por ${escapeHtml(a.geradoPor)}` : ''}${a.promptComissao ? ' · prompt da comissão' : ''}${a.instrucoes ? ' · com instruções' : ''}${a.editadoEm ? ` · editada ${escapeHtml(formatDataHora(a.editadoEm))}` : ''}`;
  q('analise-conteudo').innerHTML = notaHtmlPC(it);
  q('painel-analise').classList.add('aberto');
  q('btn-toggle').textContent = 'Ocultar análise';
}

// ---------- geração ----------
function chaveDe(pid, cfg = pc.config || {}) { return (cfg.chaves && cfg.chaves[pid]) || (cfg.provedor === pid ? cfg.apiKey : '') || ''; }

async function gerarAnaliseItem(reuniao, it, { forcar = false, instrucoes = '' } = {}) {
  const cfg = pc.config || {};
  const cc = configDaComissao(reuniao.sigla);
  const prov = provedorParaComissao(cc, cfg, p => chaveDe(p, cfg));
  const pid = prov.pid, apiKey = prov.apiKey;
  if (prov.aviso && !pc._avisouProvedor) { pc._avisouProvedor = true; mostrarToast(prov.aviso, 'aviso'); }
  const instrucoesTodas = juntarInstrucoes(cc.promptExtra, instrucoes);
  if (!apiKey) { mostrarToast('Configure a chave de API em ⚙ antes de gerar.', 'aviso'); return; }
  if (temNotaPC(it) && !forcar) return;
  resetAbortAll();
  const card = cardDe(it), btn = card?.querySelector('[data-role=btn-gerar]'), erroEl = card?.querySelector('[data-role=erro]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="an-spinner"></span> na fila…'; }
  if (erroEl) erroEl.style.display = 'none';
  iaInFlightInc(); atualizarBotaoPararPC();
  try {
    await pc.fila.executar(async () => {
      if (btn) btn.innerHTML = '<span class="an-spinner"></span> baixando documentos…';
      const [detP, detM] = await Promise.all([detalheProposicao(it.parecer?.id), detalheProposicao(it.idMateria)]);
      const docs = documentosDoItem(it, { parecer: detP, materia: detM });
      const buffers = [];
      for (const d of docs) { try { buffers.push(await baixarPdf(d.url)); } catch (e) { if (isAbortError(e)) throw e; console.warn('[pdf]', d.rotulo, e.message); d.falhou = true; } }
      const docsOk = docs.filter(d => !d.falhou);
      const comissao = comissaoDe(reuniao.sigla) || { sigla: reuniao.sigla, nome: reuniao.nomeOrgao || reuniao.sigla };
      const prompt = promptComissao({ comissao, reuniao, item: it, docs: docsOk, instrucoesExtra: instrucoesTodas });
      if (btn) btn.innerHTML = '<span class="an-spinner"></span> analisando…';
      const r = await chamarIA({ provedorId: pid, apiKey, modelo: prov.modelo, prompt, pdfBuffers: buffers });
      it.analise = { markdown: r.text, formato: 'markdown', truncada: !!r.truncated, provedor: PROVEDORES_META[pid]?.label || pid, modelo: prov.modelo || '', promptComissao: !!(cc.promptExtra && cc.promptExtra.trim()), documentos: docsOk.map(d => ({ tipo: d.tipo, rotulo: d.rotulo, url: d.url })), geradoEm: new Date().toISOString(), geradoPor: cfg.nomeUsuario || 'equipe', analista: it.analista || '', instrucoes: instrucoes || '' };
    });
    await fbSalvarAnalise(reuniao, it).catch(e => mostrarToast('Nota gerada, mas não salva no Firebase: ' + e.message, 'aviso'));
    atualizarBadgesItem(it); atualizarPainelItem(it);
    if (pc.reuniao === reuniao) renderLateralComissao();
  } catch (e) {
    if (!isAbortError(e) && !/fila cancelada/.test(e.message)) { console.error(e); if (erroEl) { erroEl.textContent = 'Falha: ' + e.message; erroEl.style.display = ''; card.querySelector('[data-role=painel-analise]').classList.add('aberto'); } else mostrarToast('Falha ao gerar: ' + e.message, 'erro'); }
  } finally {
    iaInFlightDec(); atualizarBotaoPararPC();
    if (btn) { btn.disabled = false; btn.innerHTML = temNotaPC(it) ? 'Gerar de novo' : 'Gerar Análise'; }
  }
}

async function gerarTodasDaReuniao(reuniao) {
  const pendentes = reuniao.itens.filter(it => !temNotaPC(it));
  if (!pendentes.length) { mostrarToast('Todos os itens já têm nota.', 'info'); return; }
  if (!chaveDe(pc.config?.provedor || 'gemini')) { mostrarToast('Configure a chave de API em ⚙ antes de gerar.', 'aviso'); return; }
  pc.fila.reiniciar(); pc.lote = { total: pendentes.length, rotulo: `${reuniao.sigla} ${dataBR(reuniao.data)}` };
  atualizarBarraLote();
  await Promise.allSettled(pendentes.map(it => gerarAnaliseItem(reuniao, it)));
  pc.lote = null; atualizarBarraLote();
  mostrarToast('Geração da reunião concluída.', 'sucesso');
}

// "gerar todas as pautas da semana": importa o que falta e enfileira cada item.
function abrirModalSemana() {
  const evs = pc.semana.eventos.filter(e => !/cancelad/i.test(e.situacao));
  if (!evs.length) { mostrarToast('Não há reuniões nesta semana.', 'info'); return; }
  const nItens = evs.reduce((s, e) => s + (metaIndice(e.orgaoId, e.id)?.nItens || 0), 0);
  document.getElementById('semana-resumo').textContent = `${evs.length} reuniões em ${new Set(evs.map(e => e.sigla)).size} comissões; ${nItens ? `ao menos ${nItens} itens já contados nas pautas importadas` : 'as pautas ainda não foram importadas, então o total de itens só se conhece ao importar'}. Com ${pc.fila.paralelas} em paralelo e ${Math.round(pc.fila.intervaloMs / 1000)} s entre chamadas, cada 20 itens levam uns 10 minutos.`;
  document.getElementById('modal-semana').style.display = 'flex';
}
async function executarGerarSemana() {
  document.getElementById('modal-semana').style.display = 'none';
  if (!chaveDe(pc.config?.provedor || 'gemini')) { mostrarToast('Configure a chave de API em ⚙ antes de gerar.', 'aviso'); return; }
  const soPodemos = document.getElementById('semana-so-podemos').checked, pularProntos = document.getElementById('semana-pular-prontos').checked;
  const evs = pc.semana.eventos.filter(e => !/cancelad/i.test(e.situacao));
  resetAbortAll(); pc.fila.reiniciar();
  pc.lote = { total: 0, rotulo: 'semana' }; atualizarBarraLote();
  const reunioes = [];
  for (const ev of evs) {
    try {
      const chave = `${ev.orgaoId}_${ev.id}`;
      let r = metaIndice(ev.orgaoId, ev.id) ? await fbCarregarReuniao(chave) : null;
      if (!r) r = await importarReuniao(ev, { silencioso: true });
      if (soPodemos) { await enriquecerAutores(r); }
      reunioes.push(r);
    } catch (e) { console.warn('[semana]', ev.sigla, e.message); }
    if (pc.fila.estado().cancelada) break;
  }
  const trabalhos = [];
  for (const r of reunioes) for (const it of r.itens) {
    if (pularProntos && temNotaPC(it)) continue;
    if (soPodemos && !ehDoPodemos(it)) continue;
    trabalhos.push([r, it]);
  }
  pc.lote = { total: trabalhos.length, rotulo: 'semana' }; atualizarBarraLote();
  if (!trabalhos.length) { pc.lote = null; atualizarBarraLote(); mostrarToast('Nada a gerar com esses filtros.', 'info'); renderTela(); return; }
  mostrarToast(`${trabalhos.length} análises na fila.`, 'info');
  await Promise.allSettled(trabalhos.map(([r, it]) => gerarAnaliseItem(r, it, { forcar: !pularProntos })));
  pc.lote = null; atualizarBarraLote();
  await carregarIndice(); renderAbas(); renderTela();
  mostrarToast('Semana concluída.', 'sucesso');
}

function atualizarBarraLote() {
  const el = document.getElementById('pc-progresso'); if (!el) return;
  const st = pc.fila ? pc.fila.estado() : { pendentes: 0, emVoo: 0, feitas: 0, falhas: 0 };
  const ativo = pc.lote || st.pendentes || st.emVoo;
  el.style.display = ativo ? 'flex' : 'none';
  if (!ativo) return;
  const total = pc.lote?.total || (st.feitas + st.falhas + st.pendentes + st.emVoo);
  const feitas = st.feitas + st.falhas;
  document.getElementById('pc-progresso-txt').textContent = `${pc.lote?.rotulo ? pc.lote.rotulo + ': ' : ''}${feitas} de ${total} · ${st.emVoo} em andamento · ${st.pendentes} na fila${st.falhas ? ` · ${st.falhas} falha(s)` : ''}`;
  document.getElementById('pc-progresso-bar').style.width = `${total ? Math.round(100 * feitas / total) : 0}%`;
  atualizarBotaoPararPC();
}
function atualizarBotaoPararPC() { const st = pc.fila?.estado() || {}; document.getElementById('btn-parar').style.display = (st.emVoo || st.pendentes) ? 'inline-flex' : 'none'; }
function pararTudo() { pc.fila.cancelar(); try { _abortAll.abort(); } catch (_) {} pc.lote = null; mostrarToast('Cancelando: o que está em voo termina; a fila foi esvaziada.', 'aviso'); atualizarBarraLote(); }

// ---------- reanalisar ----------
let _itemReanalise = null;
function abrirReanalise(it) {
  _itemReanalise = it;
  document.getElementById('reanalise-item').textContent = `${it.sigla} ${it.numero}/${it.ano} — ${(it.ementa || '').slice(0, 140)}`;
  document.getElementById('reanalise-texto').value = it.analise?.instrucoes || '';
  document.getElementById('modal-reanalise').style.display = 'flex';
}
function executarReanalise() {
  const txt = document.getElementById('reanalise-texto').value.trim();
  document.getElementById('modal-reanalise').style.display = 'none';
  if (_itemReanalise) gerarAnaliseItem(pc.reuniao, _itemReanalise, { forcar: true, instrucoes: txt });
}

// ---------- edição (Quill) ----------
const QUILL_TOOLBAR_PC = [[{ header: [2, 3, false] }], ['bold', 'italic'], [{ list: 'ordered' }, { list: 'bullet' }], ['clean']];
function quillDe(card) {
  if (card._quill) return card._quill;
  if (typeof Quill === 'undefined') throw new Error('editor indisponível');
  card._quill = new Quill(card.querySelector('[data-role=quill-editor]'), { theme: 'snow', modules: { toolbar: QUILL_TOOLBAR_PC } });
  return card._quill;
}
function entrarEdicao(card, it) {
  let q; try { q = quillDe(card); } catch (e) { mostrarToast(e.message, 'erro'); return; }
  const html = notaHtmlPC(it);
  try { q.setContents(q.clipboard.convert({ html: html || '<p></p>' })); } catch (_) { q.root.innerHTML = html || '<p></p>'; }
  card.querySelector('[data-role=analise-conteudo]').style.display = 'none';
  card.querySelector('[data-role=quill-wrap]').style.display = 'block';
  for (const r of ['btn-editar', 'btn-reanalisar', 'btn-regerar']) card.querySelector(`[data-role=${r}]`).style.display = 'none';
  for (const r of ['btn-salvar-edicao', 'btn-cancelar-edicao']) card.querySelector(`[data-role=${r}]`).style.display = '';
}
function sairEdicao(card, it) {
  card.querySelector('[data-role=quill-wrap]').style.display = 'none';
  card.querySelector('[data-role=analise-conteudo]').style.display = '';
  for (const r of ['btn-editar', 'btn-reanalisar', 'btn-regerar']) card.querySelector(`[data-role=${r}]`).style.display = '';
  for (const r of ['btn-salvar-edicao', 'btn-cancelar-edicao']) card.querySelector(`[data-role=${r}]`).style.display = 'none';
  atualizarPainelItem(it, card);
}
async function salvarEdicao(card, it) {
  const html = sanitizarNotaHtml(card._quill.root.innerHTML);
  it.analise = { ...(it.analise || {}), html, formato: 'html', editadoEm: new Date().toISOString(), editadoPor: pc.config?.nomeUsuario || 'equipe' };
  sairEdicao(card, it);
  await fbSalvarAnalise(pc.reuniao, it).catch(e => mostrarToast('Não salvei no Firebase: ' + e.message, 'erro'));
  mostrarToast('✓ Nota salva', 'sucesso');
}

// ---------- exportar / copiar ----------
async function exportarPdfReuniao() {
  const r = pc.reuniao; if (!r) return;
  const w = window.open('', '_blank', 'width=900,height=760');
  if (!w) { mostrarToast('Permita pop-ups para exportar.', 'aviso'); return; }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando PDF…</title></head><body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Preparando o PDF…</body></html>'); w.document.close();
  const logo = await carregarLogoDataUrl();
  const c = comissaoDe(r.sigla) || { sigla: r.sigla, nome: r.nomeOrgao || r.sigla };
  const html = htmlImpressaoReuniao({ comissao: c, reuniao: r, itens: r.itens, notaHtml: it => `<div class="nota">${notaHtmlPC(it)}</div>`, logoDataUrl: logo, css: CSS_IMPRESSAO_PLENARIO });
  w.document.open(); w.document.write(html); w.document.close();
  let impresso = false; const imprimir = () => { if (impresso || w.closed) return; impresso = true; try { w.focus(); w.print(); } catch (_) {} };
  w.PagedConfig = { auto: true, after: imprimir };
  const sc = w.document.createElement('script'); sc.src = chrome.runtime.getURL('libs/paged.polyfill.js'); sc.onerror = imprimir; w.document.head.appendChild(sc);
  setTimeout(imprimir, 20000);
}
async function copiar(texto, msg) {
  try { await navigator.clipboard.writeText(texto); mostrarToast('✓ ' + msg, 'sucesso'); }
  catch (_) { const ta = document.createElement('textarea'); ta.value = texto; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); mostrarToast('✓ ' + msg, 'sucesso'); }
}

// ============================================================
//  PROVEDOR E PROMPT POR COMISSÃO (Firebase: pautas-comissoes/config/{sigla})
// ============================================================
// O analista pode dar a cada comissão um provedor/modelo próprio e um prompt
// customizado — orientações permanentes que entram em toda análise daquela
// comissão. Fica no Firebase, para a equipe; a chave de API é a local.
function configDaComissao(sigla) { return pc.configComissoes?.[sigla] || {}; }
async function carregarConfigComissoes() {
  try { pc.configComissoes = (await fbGetPC('config')) || {}; } catch (e) { console.warn('[config das comissões]', e.message); pc.configComissoes = {}; }
}
function resumoConfigComissao(sigla) {
  const c = configDaComissao(sigla);
  const partes = [];
  partes.push(c.provedor ? `${PROVEDORES_META[c.provedor]?.label || c.provedor}${c.modelo ? ' ' + c.modelo : ''}` : 'provedor padrão');
  partes.push(c.promptExtra && c.promptExtra.trim() ? 'prompt próprio' : 'sem prompt próprio');
  return partes.join(' · ');
}
let _siglaConfig = null;
function abrirConfigComissao(sigla) {
  _siglaConfig = sigla;
  const com = comissaoDe(sigla) || { sigla, nome: sigla }, c = configDaComissao(sigla);
  document.getElementById('cc-titulo').textContent = `${com.sigla} — provedor e prompt`;
  const sel = document.getElementById('cc-provedor');
  sel.innerHTML = `<option value="">Padrão (${escapeHtml(PROVEDORES_META[pc.config?.provedor || 'gemini']?.label || 'Configurações')})</option>` + Object.entries(PROVEDORES_META).map(([id, p]) => `<option value="${id}">${escapeHtml(p.label)}${chaveDe(id) ? '' : ' — sem chave nas Configurações'}</option>`).join('');
  sel.value = c.provedor || '';
  document.getElementById('cc-prompt').value = c.promptExtra || '';
  document.getElementById('cc-info').textContent = c.atualizadoEm ? `Salvo em ${formatDataHora(c.atualizadoEm)}${c.por ? ` por ${c.por}` : ''}.` : 'Ainda sem configuração própria: vale o padrão das Configurações.';
  preencherModelosCC(c.modelo || '');
  document.getElementById('modal-comissao').style.display = 'flex';
}
async function preencherModelosCC(selecionado, { listar = true } = {}) {
  const pid = document.getElementById('cc-provedor').value;
  const selM = document.getElementById('cc-modelo'), st = document.getElementById('cc-modelo-status'), hint = document.getElementById('cc-provedor-hint');
  const salvo = selecionado ?? (configDaComissao(_siglaConfig).modelo || '');
  if (!pid) { selM.innerHTML = `<option value="">Padrão (${escapeHtml(pc.config?.modelo || 'o das Configurações')})</option>`; selM.value = ''; st.textContent = ''; hint.textContent = 'Usa o provedor, a chave e o modelo das Configurações.'; return; }
  const p = PROVEDORES_META[pid], chave = chaveDe(pid);
  hint.textContent = chave ? `Chave de ${p.label} encontrada nas Configurações.` : `Sem chave de ${p.label} nas Configurações: quem não a tiver cai no padrão.`;
  const montar = lista => { const atual = selM.value; const ids = new Set(lista.map(m => m.id)); if (salvo && !ids.has(salvo)) lista = [{ id: salvo, displayName: salvo + ' (salvo)' }].concat(lista); selM.innerHTML = '<option value="">Padrão do provedor</option>' + lista.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.displayName || m.id)}</option>`).join(''); selM.value = (atual && ids.has(atual)) ? atual : (salvo || ''); };
  montar(p.modelosFallback);
  if (!chave) { st.textContent = 'Sem chave: a lista é a de reserva do programa.'; return; }
  if (!listar) return;
  st.textContent = 'Listando modelos…';
  try { const lista = await p.listar(chave); if (document.getElementById('cc-provedor').value === pid) { montar(lista); st.textContent = `✓ ${lista.length} modelo(s) disponíveis na chave.`; } }
  catch (e) { st.textContent = `Não listei os modelos (${e.message}). A lista abaixo é a de reserva do programa.`; }
}
async function salvarConfigComissao() {
  const sigla = _siglaConfig; if (!sigla) return;
  const provedor = document.getElementById('cc-provedor').value || null, modelo = document.getElementById('cc-modelo').value || null, promptExtra = document.getElementById('cc-prompt').value.trim();
  const c = { provedor, modelo: provedor ? modelo : null, promptExtra, por: pc.config?.nomeUsuario || 'equipe', atualizadoEm: new Date().toISOString() };
  try { await fbPutPC(`config/${sigla}`, c); } catch (e) { mostrarToast('Não salvei no Firebase: ' + e.message, 'erro'); return; }
  pc.configComissoes[sigla] = c;
  document.getElementById('modal-comissao').style.display = 'none';
  mostrarToast(`✓ Configuração da ${sigla} salva para a equipe`, 'sucesso');
  renderTela();
}
async function limparConfigComissao() {
  const sigla = _siglaConfig; if (!sigla) return;
  try { await fbPutPC(`config/${sigla}`, null); } catch (e) { mostrarToast('Não apaguei no Firebase: ' + e.message, 'erro'); return; }
  delete pc.configComissoes[sigla];
  document.getElementById('modal-comissao').style.display = 'none';
  mostrarToast(`${sigla} voltou ao provedor e ao prompt padrão`, 'info');
  renderTela();
}

// ============================================================
//  CONFIGURAÇÕES (mesma chave "config" do Plenário)
// ============================================================
function abrirConfigPC() {
  const c = pc.config || {};
  const sel = document.getElementById('config-provedor');
  sel.innerHTML = Object.entries(PROVEDORES_META).map(([id, p]) => `<option value="${id}">${escapeHtml(p.label)}</option>`).join('');
  sel.value = c.provedor || 'gemini';
  document.getElementById('config-nome').value = c.nomeUsuario || '';
  document.getElementById('config-paralelas').value = c.comissoes?.paralelas || 2;
  document.getElementById('config-intervalo').value = c.comissoes?.intervaloS ?? 3;
  preencherChaveEModelos();
  document.getElementById('modal-configuracoes').style.display = 'flex';
}
async function preencherChaveEModelos({ listar = true, manterChave = false } = {}) {
  const pid = document.getElementById('config-provedor').value, p = PROVEDORES_META[pid];
  const inp = document.getElementById('config-api-key'); inp.placeholder = p.placeholderChave; if (!manterChave) inp.value = chaveDe(pid);
  document.getElementById('config-api-hint').textContent = p.hintChave;
  const selM = document.getElementById('config-modelo'), st = document.getElementById('config-modelo-status');
  const salvo = pc.config?.provedor === pid ? (pc.config?.modelo || '') : '';
  const montar = lista => { const atual = selM.value; const ids = new Set(lista.map(m => m.id)); if (salvo && !ids.has(salvo)) lista = [{ id: salvo, displayName: salvo + ' (salvo)' }].concat(lista); selM.innerHTML = lista.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.displayName || m.id)}</option>`).join(''); const alvo = atual && ids.has(atual) ? atual : salvo; if (alvo) selM.value = alvo; };
  montar(p.modelosFallback);
  const chave = inp.value.trim();
  if (!chave) { st.textContent = 'Nenhuma chave deste provedor: cole a chave acima e clique em "Carregar disponíveis". A lista abaixo é a de reserva do programa.'; return; }
  if (!listar) return;
  st.textContent = 'Listando modelos…';
  try { const lista = await p.listar(chave); if (document.getElementById('config-provedor').value === pid) { montar(lista); st.textContent = `✓ ${lista.length} modelo(s) disponíveis na chave.`; } }
  catch (e) { st.textContent = `Não listei os modelos (${e.message}). A lista abaixo é a de reserva do programa e pode estar desatualizada.`; }
}
async function salvarConfigPC() {
  const pid = document.getElementById('config-provedor').value, key = document.getElementById('config-api-key').value.trim(), p = PROVEDORES_META[pid];
  if (!key) { mostrarToast('Informe a chave de API.', 'aviso'); return; }
  if (!p.regexChave.test(key)) { mostrarToast(`Chave inválida para ${p.label}.`, 'aviso'); return; }
  const c = pc.config || {};
  const chaves = { ...(c.chaves || {}) }; if (c.apiKey && c.provedor && !chaves[c.provedor]) chaves[c.provedor] = c.apiKey; chaves[pid] = key;
  const paralelas = Math.min(6, Math.max(1, parseInt(document.getElementById('config-paralelas').value, 10) || 2));
  const intervaloS = Math.min(120, Math.max(0, parseInt(document.getElementById('config-intervalo').value, 10) || 0));
  pc.config = { ...c, provedor: pid, apiKey: key, modelo: document.getElementById('config-modelo').value, chaves, nomeUsuario: document.getElementById('config-nome').value.trim(), comissoes: { ...(c.comissoes || {}), paralelas, intervaloS } };
  await new Promise(r => chrome.storage.local.set({ config: pc.config }, r));
  pc.fila.paralelas = paralelas; pc.fila.intervaloMs = intervaloS * 1000;
  document.getElementById('modal-configuracoes').style.display = 'none';
  mostrarToast('✓ Configurações salvas', 'sucesso');
}
