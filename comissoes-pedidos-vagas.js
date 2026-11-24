// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';

// ── COMISSÕES · PEDIDOS DE VAGAS ─────────────────────────────────────────────
// Registro de quais deputados pediram vaga em quais Comissões Permanentes (pedido de 24/11/2026): tipo de vaga
// (titular ou suplente), ordem de preferência do deputado e situação (pendente, atendido, negado), com histórico.
// Lista própria no Firebase (/comissoes-podemos/pedidos-vagas), separada dos "Pedidos" do painel de cada comissão.
//
// INACUMULABILIDADE NO REGISTRO (RICD, art. 26, § 2º): "Nenhum Deputado poderá fazer parte, como membro titular,
// de mais de uma Comissão Permanente, ressalvadas" as quinze que o parágrafo enumera. As que NÃO estão ressalvadas
// são as de GRUPOS_INCOMPATIVEIS (comissoes.js) — a mesma regra que já barra a nomeação de titular. O pedido de
// titular numa delas é BLOQUEADO quando o deputado já é titular em outra (pela composição registrada no módulo ou
// por pedido de titular já atendido). Vários pedidos pendentes de titular em inacumuláveis são permitidos: são
// opções do deputado, em ordem de preferência, e só uma pode ser atendida.
//
// Usa de comissoes.js (na página): state, COMISSOES_PERMANENTES, GRUPOS_INCOMPATIVEIS, comissoesDeDeputado,
// fbPut, fbDelete, mostrarToast. As regras (pvValidar…) são puras e exportadas para os testes (Node).

const PV_SITUACOES = { pendente: 'Pendente', atendido: 'Atendido', negado: 'Negado' };
const PV_TIPOS = { titular: 'Titular', suplente: 'Suplente' };
const PV_MAX_PREFERENCIA = 10;

/** Comissão Permanente sujeita à inacumulabilidade do art. 26, § 2º (não ressalvada). */
function pvInacumulavel(sigla, grupos) {
  return grupos.some(g => g.includes(sigla));
}

/**
 * Valida um pedido novo. `ctx`: { permanentes: [{sigla, nome}], grupos, membrosDe(depId) → {titulares, suplentes},
 * pedidos: [{depId, sigla, tipo, situacao}] }. Devolve { ok: true } ou { ok: false, erro }.
 */
function pvValidarPedido(p, ctx) {
  const com = ctx.permanentes.find(c => c.sigla === p.sigla);
  if (!p.depId) return { ok: false, erro: 'Escolha o deputado.' };
  if (!com) return { ok: false, erro: 'Escolha uma Comissão Permanente.' };
  if (!PV_TIPOS[p.tipo]) return { ok: false, erro: 'Escolha o tipo de vaga (titular ou suplente).' };
  const ordem = Number(p.ordem);
  if (!Number.isInteger(ordem) || ordem < 1 || ordem > PV_MAX_PREFERENCIA) return { ok: false, erro: `A preferência vai de 1 a ${PV_MAX_PREFERENCIA}.` };

  const dup = ctx.pedidos.find(x => x.depId === p.depId && x.sigla === p.sigla && x.tipo === p.tipo && x.situacao === 'pendente');
  if (dup) return { ok: false, erro: `Já há um pedido pendente de ${p.tipo} em ${p.sigla} para este deputado.` };

  const { titulares, suplentes } = ctx.membrosDe(p.depId);
  if (titulares.includes(p.sigla)) return { ok: false, erro: `O deputado já é titular em ${p.sigla}.` };
  if (p.tipo === 'suplente' && suplentes.includes(p.sigla)) return { ok: false, erro: `O deputado já é suplente em ${p.sigla}.` };

  if (p.tipo === 'titular' && pvInacumulavel(p.sigla, ctx.grupos)) {
    // titularidade já registrada no módulo, ou pedido de titular já atendido (a composição pode ainda não ter sido lançada)
    const atendidos = ctx.pedidos.filter(x => x.depId === p.depId && x.tipo === 'titular' && x.situacao === 'atendido').map(x => x.sigla);
    const ja = [...new Set([...titulares, ...atendidos])].find(s => s !== p.sigla && pvInacumulavel(s, ctx.grupos));
    if (ja) {
      return { ok: false, inacumulavel: ja, erro: `Inacumulável: o deputado já é titular em ${ja}${titulares.includes(ja) ? '' : ' (pedido atendido)'}, ` +
        `e ${p.sigla} também é comissão em que só se pode ser titular de uma (RICD, art. 26, § 2º). Para pedir ${p.sigla} como titular, ` +
        `é preciso deixar a titularidade em ${ja}; como suplente, o pedido é aceito.` };
    }
  }
  return { ok: true };
}

/** Próxima preferência livre do deputado (entre os pedidos pendentes). */
function pvProximaOrdem(depId, pedidos) {
  const usadas = new Set(pedidos.filter(x => x.depId === depId && x.situacao === 'pendente').map(x => Number(x.ordem)));
  for (let i = 1; i <= PV_MAX_PREFERENCIA; i++) if (!usadas.has(i)) return i;
  return PV_MAX_PREFERENCIA;
}

/** Registro novo, como vai para o Firebase. */
function pvNovoRegistro(p, agoraIso) {
  return { depId: p.depId, sigla: p.sigla, tipo: p.tipo, ordem: Number(p.ordem), situacao: 'pendente', data: agoraIso,
    historico: [{ situacao: 'pendente', em: agoraIso }] };
}

/** Muda a situação, acrescentando ao histórico. */
function pvComSituacao(reg, situacao, agoraIso) {
  return Object.assign({}, reg, { situacao, historico: [...(reg.historico || []), { situacao, em: agoraIso }] });
}

// ── TELA ─────────────────────────────────────────────────────────────────────
const _pvEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _pvData = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
let pvFiltro = 'pendente';

function pvLista() {
  return Object.entries(state.pedidosVagas || {}).map(([id, r]) => Object.assign({ id }, r));
}

function pvCtx() {
  return { permanentes: COMISSOES_PERMANENTES, grupos: GRUPOS_INCOMPATIVEIS, membrosDe: comissoesDeDeputado, pedidos: pvLista() };
}

function renderSidebarPedidosVagas() {
  const lista = pvLista();
  const n = s => (s ? lista.filter(x => x.situacao === s).length : lista.length);
  const itens = [['pendente', 'Pendentes'], ['atendido', 'Atendidos'], ['negado', 'Negados'], ['', 'Todos']];
  const el = document.getElementById('com-lista');
  el.innerHTML = itens.map(([s, rot]) => `<div class="com-item${pvFiltro === s ? ' ativo' : ''}" data-pv-filtro="${s}">
      <span class="com-item-nome">${rot}</span><span class="com-item-badge">${n(s)}</span></div>`).join('');
  el.querySelectorAll('[data-pv-filtro]').forEach(it => it.addEventListener('click', () => {
    pvFiltro = it.dataset.pvFiltro;
    renderSidebarPedidosVagas();
    renderPainelPedidosVagas();
  }));
}

function _pvSituacaoDeputado(depId) {
  if (!depId) return '';
  const { titulares, suplentes } = comissoesDeDeputado(depId);
  const marca = s => `${_pvEsc(s)}${pvInacumulavel(s, GRUPOS_INCOMPATIVEIS) ? ' <span class="pv-inac" title="Inacumulável (RICD, art. 26, § 2º)">inacumulável</span>' : ''}`;
  return `Hoje: titular em ${titulares.length ? titulares.map(marca).join(', ') : 'nenhuma'} · suplente em ${suplentes.length ? suplentes.map(_pvEsc).join(', ') : 'nenhuma'}`;
}

function renderPainelPedidosVagas() {
  const deps = Object.entries(state.deputados || {}).sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const lista = pvLista().filter(x => !pvFiltro || x.situacao === pvFiltro);
  // por deputado (nome), depois pela preferência
  const nome = id => state.deputados[id]?.nome || 'Deputado removido';
  lista.sort((a, b) => nome(a.depId).localeCompare(nome(b.depId), 'pt-BR') || a.ordem - b.ordem || String(a.data).localeCompare(String(b.data)));
  const comNome = s => (COMISSOES_PERMANENTES.find(c => c.sigla === s) || {}).nome || s;
  const rotFiltro = pvFiltro ? PV_SITUACOES[pvFiltro].toLowerCase() + 's' : 'todos';

  const linhas = lista.map(x => {
    const dep = state.deputados[x.depId];
    const acoes = x.situacao === 'pendente'
      ? `<button class="pv-btn pv-ok" data-pv-sit="atendido" data-pv-id="${x.id}">Atendido</button>
         <button class="pv-btn pv-nao" data-pv-sit="negado" data-pv-id="${x.id}">Negado</button>`
      : `<button class="pv-btn" data-pv-sit="pendente" data-pv-id="${x.id}">Reabrir</button>`;
    const hist = (x.historico || []).map(h => `${PV_SITUACOES[h.situacao] || h.situacao} em ${_pvData(h.em)}`).join(' → ');
    return `<tr>
      <td><b>${_pvEsc(dep ? dep.nome : 'Deputado removido')}</b>${dep?.uf ? ` <span class="pv-dim">(${_pvEsc(dep.uf)})</span>` : ''}</td>
      <td class="pv-c">${x.ordem}ª</td>
      <td><b>${_pvEsc(x.sigla)}</b> <span class="pv-dim">${_pvEsc(comNome(x.sigla))}</span>${pvInacumulavel(x.sigla, GRUPOS_INCOMPATIVEIS) ? ' <span class="pv-inac">inacumulável</span>' : ''}</td>
      <td>${PV_TIPOS[x.tipo] || x.tipo}</td>
      <td><span class="pv-sit pv-sit-${x.situacao}" title="${_pvEsc(hist)}">${PV_SITUACOES[x.situacao] || x.situacao}</span></td>
      <td class="pv-dim">${_pvData(x.data)}</td>
      <td class="pv-acoes">${acoes}<button class="pv-btn pv-del" data-pv-del="${x.id}" title="Excluir o pedido">✕</button></td>
    </tr>`;
  }).join('');

  document.getElementById('com-painel-conteudo').innerHTML = `
    <div class="pv-wrap">
      <h2 class="pv-titulo">Pedidos de vagas <span class="pv-dim">· Comissões Permanentes</span></h2>
      <div class="pv-form">
        <label>Deputado<select id="pv-dep" class="form-input"><option value="">Escolha…</option>
          ${deps.map(([id, d]) => `<option value="${_pvEsc(id)}">${_pvEsc(d.nome)}${d.uf ? ` (${_pvEsc(d.uf)})` : ''}</option>`).join('')}</select></label>
        <label>Comissão<select id="pv-com" class="form-input"><option value="">Escolha…</option>
          ${COMISSOES_PERMANENTES.map(c => `<option value="${c.sigla}">${c.sigla} — ${_pvEsc(c.nome)}${pvInacumulavel(c.sigla, GRUPOS_INCOMPATIVEIS) ? ' (inacumulável)' : ''}</option>`).join('')}</select></label>
        <label>Vaga<select id="pv-tipo" class="form-input"><option value="titular">Titular</option><option value="suplente">Suplente</option></select></label>
        <label>Preferência<select id="pv-ordem" class="form-input">${Array.from({ length: PV_MAX_PREFERENCIA }, (_, i) => `<option value="${i + 1}">${i + 1}ª</option>`).join('')}</select></label>
        <button id="pv-registrar" class="btn btn-primary btn-sm">Registrar pedido</button>
      </div>
      <div id="pv-dep-situacao" class="pv-dim pv-situacao"></div>
      <div id="pv-erro" class="pv-erro" style="display:none"></div>
      <div class="pv-nota">Inacumulabilidade (RICD, art. 26, § 2º): o deputado só pode ser <b>titular</b> de uma das comissões marcadas como inacumuláveis.
        O pedido de titular numa delas é recusado no registro quando ele já é titular em outra. Suplência e as comissões ressalvadas não têm esse limite.</div>
      <h3 class="pv-sub">Pedidos ${rotFiltro} <span class="pv-dim">(${lista.length})</span></h3>
      ${lista.length ? `<table class="pv-tabela"><thead><tr><th>Deputado</th><th class="pv-c">Pref.</th><th>Comissão</th><th>Vaga</th><th>Situação</th><th>Registrado</th><th></th></tr></thead>
        <tbody>${linhas}</tbody></table>` : '<p class="pv-dim">Nenhum pedido aqui.</p>'}
    </div>`;

  const depSel = document.getElementById('pv-dep');
  depSel.addEventListener('change', () => {
    document.getElementById('pv-dep-situacao').innerHTML = _pvSituacaoDeputado(depSel.value);
    document.getElementById('pv-ordem').value = String(pvProximaOrdem(depSel.value, pvLista()));
    document.getElementById('pv-erro').style.display = 'none';
  });
  document.getElementById('pv-registrar').addEventListener('click', pvRegistrar);
  document.querySelectorAll('[data-pv-sit]').forEach(b => b.addEventListener('click', () => pvMudarSituacao(b.dataset.pvId, b.dataset.pvSit)));
  document.querySelectorAll('[data-pv-del]').forEach(b => b.addEventListener('click', () => pvExcluir(b.dataset.pvDel)));
}

async function pvRegistrar() {
  const p = { depId: document.getElementById('pv-dep').value, sigla: document.getElementById('pv-com').value,
    tipo: document.getElementById('pv-tipo').value, ordem: Number(document.getElementById('pv-ordem').value) };
  const v = pvValidarPedido(p, pvCtx());
  const erroEl = document.getElementById('pv-erro');
  if (!v.ok) { erroEl.textContent = v.erro; erroEl.style.display = ''; return; }
  const id = `pv_${Date.now()}`;
  const reg = pvNovoRegistro(p, new Date().toISOString());
  try {
    await fbPut(`/pedidos-vagas/${id}`, reg);
  } catch (e) { mostrarToast('Não foi possível gravar o pedido: ' + e.message, 'erro'); return; }
  state.pedidosVagas[id] = reg;
  mostrarToast(`Pedido registrado: ${state.deputados[p.depId]?.nome || ''} — ${p.tipo} em ${p.sigla} (${p.ordem}ª preferência).`);
  renderSidebarPedidosVagas();
  renderPainelPedidosVagas();
}

async function pvMudarSituacao(id, situacao) {
  const reg = state.pedidosVagas[id];
  if (!reg) return;
  // Reabrir não pode criar dois pedidos pendentes iguais, nem furar a inacumulabilidade
  if (situacao === 'pendente') {
    const outros = pvLista().filter(x => x.id !== id);
    const v = pvValidarPedido(reg, Object.assign(pvCtx(), { pedidos: outros }));
    if (!v.ok) { mostrarToast(v.erro, 'erro', 6000); return; }
  }
  const novo = pvComSituacao(reg, situacao, new Date().toISOString());
  try { await fbPut(`/pedidos-vagas/${id}`, novo); }
  catch (e) { mostrarToast('Não foi possível gravar: ' + e.message, 'erro'); return; }
  state.pedidosVagas[id] = novo;
  renderSidebarPedidosVagas();
  renderPainelPedidosVagas();
}

async function pvExcluir(id) {
  const reg = state.pedidosVagas[id];
  if (!reg || !confirm(`Excluir o pedido de ${state.deputados[reg.depId]?.nome || 'deputado'} (${reg.tipo} em ${reg.sigla})?`)) return;
  try { await fbDelete(`/pedidos-vagas/${id}`); }
  catch (e) { mostrarToast('Não foi possível excluir: ' + e.message, 'erro'); return; }
  delete state.pedidosVagas[id];
  renderSidebarPedidosVagas();
  renderPainelPedidosVagas();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pvInacumulavel, pvValidarPedido, pvProximaOrdem, pvNovoRegistro, pvComSituacao, PV_MAX_PREFERENCIA };
}
