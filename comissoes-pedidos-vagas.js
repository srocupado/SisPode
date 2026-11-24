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
// LEGISLATURA E DEPUTADO DIGITADO (24/11/2026): chegam pedidos para a PRÓXIMA legislatura, de deputados que ainda não
// estão no cadastro do módulo. O pedido guarda a legislatura; o deputado pode ser digitado (nome e UF) — vira um id
// "m_<nome>", e o mesmo nome digitado de novo é o mesmo deputado (o nome de um deputado cadastrado aponta para ele).
// Na legislatura ATUAL, a titularidade vem da composição registrada no módulo e dos pedidos atendidos; na PRÓXIMA,
// só dos pedidos de titular atendidos para ela — a composição de hoje não vale para a legislatura que vem (o reeleito
// titular na CCJC agora pode pedir a CFT para a próxima). Pedido sem legislatura (gravado antes) é da atual.
//
// Usa de comissoes.js (na página): state, COMISSOES_PERMANENTES, GRUPOS_INCOMPATIVEIS, comissoesDeDeputado,
// fbPut, fbDelete, mostrarToast. As regras (pvValidar…) são puras e exportadas para os testes (Node).

const PV_SITUACOES = { pendente: 'Pendente', atendido: 'Atendido', negado: 'Negado' };
const PV_TIPOS = { titular: 'Titular', suplente: 'Suplente' };
const PV_MAX_PREFERENCIA = 10;

/** Legislatura de uma data (a legislatura começa em 1º de fevereiro do ano seguinte à eleição: 57ª = 2023–2027). */
function pvLegislaturaDe(data = new Date()) {
  const ano = data.getMonth() >= 1 ? data.getFullYear() : data.getFullYear() - 1;
  return Math.floor((ano - 1795) / 4);
}
/** Legislatura que o formulário oferece primeiro: a próxima, de outubro do ano da eleição em diante; senão, a atual. */
function pvLegislaturaPadrao(data = new Date()) {
  const leg = pvLegislaturaDe(data);
  const anoEleicao = 1795 + 4 * leg + 3;   // 57ª → 2026
  return data.getFullYear() === anoEleicao && data.getMonth() >= 9 ? leg + 1 : leg;
}
const pvLegDe = (p, legAtual) => Number(p.legislatura) || legAtual;
/** Id do deputado digitado: o mesmo nome (sem acento e caixa) dá o mesmo id. */
function pvIdManual(nome) {
  return 'm_' + String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/** Deputado do pedido digitado: se o nome é o de um deputado cadastrado, é ele; senão, o id do nome. */
function pvResolverManual(nome, deputados) {
  const chave = pvIdManual(nome);
  const cad = Object.entries(deputados || {}).find(([, d]) => pvIdManual(d.nome) === chave);
  return cad ? { depId: cad[0], cadastrado: true } : { depId: chave, cadastrado: false };
}

/** Comissão Permanente sujeita à inacumulabilidade do art. 26, § 2º (não ressalvada). */
function pvInacumulavel(sigla, grupos) {
  return grupos.some(g => g.includes(sigla));
}

/**
 * Valida um pedido novo. `ctx`: { permanentes: [{sigla, nome}], grupos, membrosDe(depId) → {titulares, suplentes},
 * pedidos: [{depId, sigla, tipo, situacao, legislatura}], legAtual }. Devolve { ok: true } ou { ok: false, erro }.
 */
function pvValidarPedido(p, ctx) {
  const com = ctx.permanentes.find(c => c.sigla === p.sigla);
  if (!p.depId) return { ok: false, erro: 'Escolha o deputado.' };
  if (!com) return { ok: false, erro: 'Escolha uma Comissão Permanente.' };
  if (!PV_TIPOS[p.tipo]) return { ok: false, erro: 'Escolha o tipo de vaga (titular ou suplente).' };
  const ordem = Number(p.ordem);
  if (!Number.isInteger(ordem) || ordem < 1 || ordem > PV_MAX_PREFERENCIA) return { ok: false, erro: `A preferência vai de 1 a ${PV_MAX_PREFERENCIA}.` };

  const leg = pvLegDe(p, ctx.legAtual);
  if (leg < ctx.legAtual || leg > ctx.legAtual + 1) return { ok: false, erro: `Legislatura inválida: os pedidos são para a ${ctx.legAtual}ª (atual) ou a ${ctx.legAtual + 1}ª (próxima).` };
  if (p.depManual && String(p.depNome || '').trim().length < 3) return { ok: false, erro: 'Digite o nome do deputado.' };
  // só os pedidos da MESMA legislatura contam
  const mesmos = ctx.pedidos.filter(x => pvLegDe(x, ctx.legAtual) === leg);
  const dup = mesmos.find(x => x.depId === p.depId && x.sigla === p.sigla && x.tipo === p.tipo && x.situacao === 'pendente');
  if (dup) return { ok: false, erro: `Já há um pedido pendente de ${p.tipo} em ${p.sigla} para este deputado na ${leg}ª legislatura.` };

  // composição registrada no módulo: só na legislatura atual
  const { titulares, suplentes } = leg === ctx.legAtual ? ctx.membrosDe(p.depId) : { titulares: [], suplentes: [] };
  if (titulares.includes(p.sigla)) return { ok: false, erro: `O deputado já é titular em ${p.sigla}.` };
  if (p.tipo === 'suplente' && suplentes.includes(p.sigla)) return { ok: false, erro: `O deputado já é suplente em ${p.sigla}.` };

  if (p.tipo === 'titular' && pvInacumulavel(p.sigla, ctx.grupos)) {
    // titularidade já registrada no módulo, ou pedido de titular já atendido (a composição pode ainda não ter sido lançada)
    const atendidos = mesmos.filter(x => x.depId === p.depId && x.tipo === 'titular' && x.situacao === 'atendido').map(x => x.sigla);
    const ja = [...new Set([...titulares, ...atendidos])].find(s => s !== p.sigla && pvInacumulavel(s, ctx.grupos));
    if (ja) {
      return { ok: false, inacumulavel: ja, erro: `Inacumulável: o deputado já é titular em ${ja}${titulares.includes(ja) ? '' : ` (pedido atendido, ${leg}ª legislatura)`}, ` +
        `e ${p.sigla} também é comissão em que só se pode ser titular de uma (RICD, art. 26, § 2º). Para pedir ${p.sigla} como titular, ` +
        `é preciso deixar a titularidade em ${ja}; como suplente, o pedido é aceito.` };
    }
  }
  return { ok: true };
}

/** Próxima preferência livre do deputado (entre os pedidos pendentes). */
function pvProximaOrdem(depId, pedidos, leg = null, legAtual = null) {
  const usadas = new Set(pedidos.filter(x => x.depId === depId && x.situacao === 'pendente' && (leg == null || pvLegDe(x, legAtual) === leg)).map(x => Number(x.ordem)));
  for (let i = 1; i <= PV_MAX_PREFERENCIA; i++) if (!usadas.has(i)) return i;
  return PV_MAX_PREFERENCIA;
}

/** Registro novo, como vai para o Firebase. */
function pvNovoRegistro(p, agoraIso) {
  return { depId: p.depId, sigla: p.sigla, tipo: p.tipo, ordem: Number(p.ordem), legislatura: Number(p.legislatura), situacao: 'pendente', data: agoraIso,
    historico: [{ situacao: 'pendente', em: agoraIso }],
    ...(p.depManual ? { depNome: String(p.depNome).trim(), depUf: String(p.depUf || '').trim().toUpperCase() } : {}) };
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

/** Nome e UF do deputado do pedido: o cadastro do módulo; para o digitado, o que foi gravado no pedido. */
function pvDeputado(x) {
  const d = state.deputados[x.depId];
  if (d) return { nome: d.nome, uf: d.uf || '', manual: false };
  if (x.depNome) return { nome: x.depNome, uf: x.depUf || '', manual: true };
  return { nome: 'Deputado removido', uf: '', manual: false };
}
/** Deputados digitados em pedidos anteriores (para escolher de novo sem redigitar). */
function pvDigitados() {
  const m = new Map();
  for (const x of pvLista()) if (!state.deputados[x.depId] && x.depNome && !m.has(x.depId)) m.set(x.depId, { nome: x.depNome, uf: x.depUf || '' });
  return [...m.entries()].sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function pvCtx() {
  return { permanentes: COMISSOES_PERMANENTES, grupos: GRUPOS_INCOMPATIVEIS, membrosDe: comissoesDeDeputado, pedidos: pvLista(), legAtual: pvLegislaturaDe() };
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

function _pvSituacaoDeputado(depId, leg) {
  if (!depId) return '';
  const atual = pvLegislaturaDe();
  if (depId === '__manual' || !state.deputados[depId]) {
    return leg > atual ? `Pedido para a ${leg}ª legislatura: vale o que já tiver sido atendido para ela.` : 'Deputado fora do cadastro do módulo: sem composição registrada.';
  }
  if (leg > atual) return `Pedido para a ${leg}ª legislatura: a composição de hoje (${atual}ª) não conta; vale o que já tiver sido atendido para a ${leg}ª.`;
  const { titulares, suplentes } = comissoesDeDeputado(depId);
  const marca = s => `${_pvEsc(s)}${pvInacumulavel(s, GRUPOS_INCOMPATIVEIS) ? ' <span class="pv-inac" title="Inacumulável (RICD, art. 26, § 2º)">inacumulável</span>' : ''}`;
  return `Hoje: titular em ${titulares.length ? titulares.map(marca).join(', ') : 'nenhuma'} · suplente em ${suplentes.length ? suplentes.map(_pvEsc).join(', ') : 'nenhuma'}`;
}

function renderPainelPedidosVagas() {
  const deps = Object.entries(state.deputados || {}).sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const dig = pvDigitados();
  const legAtual = pvLegislaturaDe(), legPadrao = pvLegislaturaPadrao();
  const lista = pvLista().filter(x => !pvFiltro || x.situacao === pvFiltro);
  // por legislatura, deputado (nome), preferência
  lista.sort((a, b) => pvLegDe(b, legAtual) - pvLegDe(a, legAtual) || pvDeputado(a).nome.localeCompare(pvDeputado(b).nome, 'pt-BR') || a.ordem - b.ordem || String(a.data).localeCompare(String(b.data)));
  const comNome = s => (COMISSOES_PERMANENTES.find(c => c.sigla === s) || {}).nome || s;
  const rotFiltro = pvFiltro ? PV_SITUACOES[pvFiltro].toLowerCase() + 's' : 'todos';

  const linhas = lista.map(x => {
    const dep = pvDeputado(x);
    const acoes = x.situacao === 'pendente'
      ? `<button class="pv-btn pv-ok" data-pv-sit="atendido" data-pv-id="${x.id}">Atendido</button>
         <button class="pv-btn pv-nao" data-pv-sit="negado" data-pv-id="${x.id}">Negado</button>`
      : `<button class="pv-btn" data-pv-sit="pendente" data-pv-id="${x.id}">Reabrir</button>`;
    const hist = (x.historico || []).map(h => `${PV_SITUACOES[h.situacao] || h.situacao} em ${_pvData(h.em)}`).join(' → ');
    return `<tr>
      <td><b>${_pvEsc(dep.nome)}</b>${dep.uf ? ` <span class="pv-dim">(${_pvEsc(dep.uf)})</span>` : ''}${dep.manual ? ' <span class="pv-dim" title="Nome digitado: o deputado não está no cadastro do módulo">· digitado</span>' : ''}</td>
      <td class="pv-c">${pvLegDe(x, legAtual)}ª</td>
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
        <label>Legislatura<select id="pv-leg" class="form-input">
          <option value="${legAtual}"${legPadrao === legAtual ? ' selected' : ''}>${legAtual}ª (atual)</option>
          <option value="${legAtual + 1}"${legPadrao === legAtual + 1 ? ' selected' : ''}>${legAtual + 1}ª (próxima, a partir de 1º/2/${1795 + 4 * (legAtual + 1)})</option></select></label>
        <label>Deputado<select id="pv-dep" class="form-input"><option value="">Escolha…</option>
          <option value="__manual">✎ Digitar nome (não cadastrado)</option>
          <optgroup label="Cadastrados no módulo">${deps.map(([id, d]) => `<option value="${_pvEsc(id)}">${_pvEsc(d.nome)}${d.uf ? ` (${_pvEsc(d.uf)})` : ''}</option>`).join('')}</optgroup>
          ${dig.length ? `<optgroup label="Digitados em pedidos anteriores">${dig.map(([id, d]) => `<option value="${_pvEsc(id)}">${_pvEsc(d.nome)}${d.uf ? ` (${_pvEsc(d.uf)})` : ''}</option>`).join('')}</optgroup>` : ''}</select></label>
        <label id="pv-manual-nome" style="display:none">Nome do deputado<input id="pv-dep-nome" class="form-input" maxlength="80" placeholder="Nome parlamentar"></label>
        <label id="pv-manual-uf" style="display:none">UF<input id="pv-dep-uf" class="form-input" maxlength="2" placeholder="UF" style="width:64px;text-transform:uppercase"></label>
        <label>Comissão<select id="pv-com" class="form-input"><option value="">Escolha…</option>
          ${COMISSOES_PERMANENTES.map(c => `<option value="${c.sigla}">${c.sigla} — ${_pvEsc(c.nome)}${pvInacumulavel(c.sigla, GRUPOS_INCOMPATIVEIS) ? ' (inacumulável)' : ''}</option>`).join('')}</select></label>
        <label>Vaga<select id="pv-tipo" class="form-input"><option value="titular">Titular</option><option value="suplente">Suplente</option></select></label>
        <label>Preferência<select id="pv-ordem" class="form-input">${Array.from({ length: PV_MAX_PREFERENCIA }, (_, i) => `<option value="${i + 1}">${i + 1}ª</option>`).join('')}</select></label>
        <button id="pv-registrar" class="btn btn-primary btn-sm">Registrar pedido</button>
      </div>
      <div id="pv-dep-situacao" class="pv-dim pv-situacao"></div>
      <div id="pv-erro" class="pv-erro" style="display:none"></div>
      <div class="pv-nota">Inacumulabilidade (RICD, art. 26, § 2º): o deputado só pode ser <b>titular</b> de uma das comissões marcadas como inacumuláveis.
        O pedido de titular numa delas é recusado no registro quando ele já é titular em outra. Suplência e as comissões ressalvadas não têm esse limite.
        Na <b>legislatura atual</b>, conta a composição registrada no módulo e o que foi atendido; na <b>próxima</b>, só o que já foi atendido para ela.</div>
      <h3 class="pv-sub">Pedidos ${rotFiltro} <span class="pv-dim">(${lista.length})</span></h3>
      ${lista.length ? `<table class="pv-tabela"><thead><tr><th>Deputado</th><th class="pv-c">Leg.</th><th class="pv-c">Pref.</th><th>Comissão</th><th>Vaga</th><th>Situação</th><th>Registrado</th><th></th></tr></thead>
        <tbody>${linhas}</tbody></table>` : '<p class="pv-dim">Nenhum pedido aqui.</p>'}
    </div>`;

  const depSel = document.getElementById('pv-dep'), legSel = document.getElementById('pv-leg');
  const atualizar = () => {
    const manual = depSel.value === '__manual', leg = Number(legSel.value);
    document.getElementById('pv-manual-nome').style.display = manual ? '' : 'none';
    document.getElementById('pv-manual-uf').style.display = manual ? '' : 'none';
    document.getElementById('pv-dep-situacao').innerHTML = _pvSituacaoDeputado(depSel.value, leg);
    const id = manual ? pvResolverManual(document.getElementById('pv-dep-nome').value, state.deputados).depId : depSel.value;
    document.getElementById('pv-ordem').value = String(pvProximaOrdem(id, pvLista(), leg, legAtual));
    document.getElementById('pv-erro').style.display = 'none';
  };
  depSel.addEventListener('change', atualizar);
  legSel.addEventListener('change', atualizar);
  document.getElementById('pv-dep-nome').addEventListener('change', atualizar);
  document.getElementById('pv-registrar').addEventListener('click', pvRegistrar);
  document.querySelectorAll('[data-pv-sit]').forEach(b => b.addEventListener('click', () => pvMudarSituacao(b.dataset.pvId, b.dataset.pvSit)));
  document.querySelectorAll('[data-pv-del]').forEach(b => b.addEventListener('click', () => pvExcluir(b.dataset.pvDel)));
}

async function pvRegistrar() {
  const sel = document.getElementById('pv-dep').value;
  const p = { depId: sel, sigla: document.getElementById('pv-com').value, tipo: document.getElementById('pv-tipo').value,
    ordem: Number(document.getElementById('pv-ordem').value), legislatura: Number(document.getElementById('pv-leg').value) };
  if (sel === '__manual') {
    const nomeDig = document.getElementById('pv-dep-nome').value.trim();
    const r = pvResolverManual(nomeDig, state.deputados);
    // o nome de um deputado cadastrado aponta para ele; o de um já digitado, para o mesmo id
    Object.assign(p, r.cadastrado ? { depId: r.depId } : { depId: r.depId, depManual: true, depNome: nomeDig, depUf: document.getElementById('pv-dep-uf').value });
    if (!nomeDig) Object.assign(p, { depId: '__manual', depManual: true, depNome: '' });
  } else if (sel && !state.deputados[sel]) {
    const d = pvDigitados().find(([id]) => id === sel);
    if (d) Object.assign(p, { depManual: true, depNome: d[1].nome, depUf: d[1].uf });
  }
  const v = pvValidarPedido(p, pvCtx());
  const erroEl = document.getElementById('pv-erro');
  if (!v.ok) { erroEl.textContent = v.erro; erroEl.style.display = ''; return; }
  const id = `pv_${Date.now()}`;
  const reg = pvNovoRegistro(p, new Date().toISOString());
  try {
    await fbPut(`/pedidos-vagas/${id}`, reg);
  } catch (e) { mostrarToast('Não foi possível gravar o pedido: ' + e.message, 'erro'); return; }
  state.pedidosVagas[id] = reg;
  mostrarToast(`Pedido registrado: ${pvDeputado(reg).nome} — ${p.tipo} em ${p.sigla} (${p.ordem}ª preferência, ${p.legislatura}ª legislatura).`);
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
  if (!reg || !confirm(`Excluir o pedido de ${pvDeputado(reg).nome} (${reg.tipo} em ${reg.sigla})?`)) return;
  try { await fbDelete(`/pedidos-vagas/${id}`); }
  catch (e) { mostrarToast('Não foi possível excluir: ' + e.message, 'erro'); return; }
  delete state.pedidosVagas[id];
  renderSidebarPedidosVagas();
  renderPainelPedidosVagas();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pvInacumulavel, pvValidarPedido, pvProximaOrdem, pvNovoRegistro, pvComSituacao, pvLegislaturaDe, pvLegislaturaPadrao,
    pvIdManual, pvResolverManual, PV_MAX_PREFERENCIA };
}
