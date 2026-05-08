/* ============================================================
   CONTROLE DE COMISSÕES – PODEMOS
   Liderança do Podemos – Câmara dos Deputados
   ============================================================ */

'use strict';

// ---------- DADOS FIXOS ----------

const COMISSOES_PERMANENTES = [
  { sigla: 'CASP',    nome: 'Administração e Serviço Público' },
  { sigla: 'CAPADR',  nome: 'Agricultura, Pecuária, Abastecimento e Desenvolvimento Rural' },
  { sigla: 'CPOVOS',  nome: 'Amazônia e dos Povos Originários e Tradicionais' },
  { sigla: 'CCTI',    nome: 'Ciência, Tecnologia e Inovação' },
  { sigla: 'CCOM',    nome: 'Comunicação' },
  { sigla: 'CCJC',    nome: 'Constituição e Justiça e de Cidadania' },
  { sigla: 'CCULT',   nome: 'Cultura' },
  { sigla: 'CDC',     nome: 'Defesa do Consumidor' },
  { sigla: 'CMULHER', nome: 'Defesa dos Direitos da Mulher' },
  { sigla: 'CIDOSO',  nome: 'Defesa dos Direitos da Pessoa Idosa' },
  { sigla: 'CPD',     nome: 'Defesa dos Direitos das Pessoas com Deficiência' },
  { sigla: 'CDE',     nome: 'Desenvolvimento Econômico' },
  { sigla: 'CDU',     nome: 'Desenvolvimento Urbano' },
  { sigla: 'CDHMIR',  nome: 'Direitos Humanos, Minorias e Igualdade Racial' },
  { sigla: 'CE',      nome: 'Educação' },
  { sigla: 'CESPO',   nome: 'Esporte' },
  { sigla: 'CFT',     nome: 'Finanças e Tributação' },
  { sigla: 'CFFC',    nome: 'Fiscalização Financeira e Controle' },
  { sigla: 'CICS',    nome: 'Indústria, Comércio e Serviços' },
  { sigla: 'CINDRE',  nome: 'Integração Nacional e Desenvolvimento Regional' },
  { sigla: 'CLP',     nome: 'Legislação Participativa' },
  { sigla: 'CMADS',   nome: 'Meio Ambiente e Desenvolvimento Sustentável' },
  { sigla: 'CME',     nome: 'Minas e Energia' },
  { sigla: 'CPASF',   nome: 'Previdência, Assistência Social, Infância, Adolescência e Família' },
  { sigla: 'CREDN',   nome: 'Relações Exteriores e de Defesa Nacional' },
  { sigla: 'CSAUDE',  nome: 'Saúde' },
  { sigla: 'CSPCCO',  nome: 'Segurança Pública e Combate ao Crime Organizado' },
  { sigla: 'CTRAB',   nome: 'Trabalho' },
  { sigla: 'CTUR',    nome: 'Turismo' },
  { sigla: 'CVT',     nome: 'Viação e Transportes' },
];

// Comissões mutuamente exclusivas como titular.
// Se um deputado for titular em qualquer uma, não pode ser titular nas demais deste grupo.
const GRUPOS_INCOMPATIVEIS = [
  [
    'CCJC',   // Constituição e Justiça e de Cidadania
    'CFT',    // Finanças e Tributação
    'CFFC',   // Fiscalização Financeira e Controle
    'CE',     // Educação
    'CSAUDE', // Saúde
    'CTRAB',  // Trabalho
    'CPASF',  // Previdência, Assistência Social, Infância, Adolescência e Família
    'CAPADR', // Agricultura, Pecuária, Abastecimento e Desenvolvimento Rural
    'CME',    // Minas e Energia
    'CVT',    // Viação e Transportes
    'CDU',    // Desenvolvimento Urbano
    'CCTI',   // Ciência, Tecnologia e Inovação
    'CICS',   // Indústria, Comércio e Serviços
    'CDC',    // Defesa do Consumidor
  ],
];

// ---------- FIREBASE ----------

const FB_BASE = 'https://plenario-podemos-default-rtdb.firebaseio.com/comissoes-podemos';

async function fbGet(path) {
  const r = await fetch(`${FB_BASE}${path}.json`);
  if (!r.ok) throw new Error('Firebase GET ' + r.status);
  return r.json();
}

async function fbPut(path, data) {
  const r = await fetch(`${FB_BASE}${path}.json`, {
    method: 'PUT',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error('Firebase PUT ' + r.status);
  return r.json();
}

async function fbDelete(path) {
  const r = await fetch(`${FB_BASE}${path}.json`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Firebase DELETE ' + r.status);
}

// ---------- ESTADO ----------

const state = {
  view:        'comissao',  // 'comissao' | 'deputado' | 'alertas'
  comissaoSel: null,        // sigla da comissão selecionada
  deputados:   {},          // { id: { nome, uf } }
  membros:     {},          // { sigla: { titulares: [id,...], suplentes: [id,...] } }
  busca:       '',
};

// ---------- INICIALIZAÇÃO ----------

document.addEventListener('DOMContentLoaded', async () => {
  registrarEventos();
  await carregarDados();
  renderSidebar();
  renderPainel();
});

function registrarEventos() {
  // Tabs de view
  document.querySelectorAll('.com-tab').forEach(tab => {
    tab.addEventListener('click', () => mudarView(tab.dataset.view));
  });

  // Busca
  document.getElementById('com-busca').addEventListener('input', e => {
    state.busca = e.target.value.trim().toLowerCase();
    renderSidebar();
  });

  // Gerir deputados
  document.getElementById('btn-gerir-deputados')
    .addEventListener('click', () => abrirModalDeputados());

  // Exportar Excel
  document.getElementById('btn-exportar-excel')
    .addEventListener('click', exportarExcel);

  // Fechar modais
  document.querySelectorAll('[data-fecha]').forEach(btn => {
    btn.addEventListener('click', () => fecharModal(btn.dataset.fecha));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) fecharModal(overlay.id);
    });
  });

  // Adicionar deputado
  document.getElementById('btn-add-deputado')
    .addEventListener('click', adicionarDeputado);
  document.getElementById('dep-nome-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter') adicionarDeputado(); });
}

// ---------- FIREBASE: CRUD ----------

async function carregarDados() {
  try {
    const [deps, membros] = await Promise.all([
      fbGet('/deputados'),
      fbGet('/membros'),
    ]);
    state.deputados = deps   || {};
    state.membros   = membros || {};
  } catch (e) {
    mostrarToast('Erro ao carregar dados do Firebase.', 'erro');
  }
}

async function salvarDeputado(id, dep) {
  await fbPut(`/deputados/${id}`, dep);
  state.deputados[id] = dep;
}

async function removerDeputadoDB(id) {
  // Remove da lista de deputados
  await fbDelete(`/deputados/${id}`);
  delete state.deputados[id];

  // Remove de todas as comissões
  const siglas = Object.keys(state.membros);
  for (const sigla of siglas) {
    const c = state.membros[sigla];
    const tIdx = (c.titulares || []).indexOf(id);
    const sIdx = (c.suplentes || []).indexOf(id);
    if (tIdx >= 0) c.titulares.splice(tIdx, 1);
    if (sIdx >= 0) c.suplentes.splice(sIdx, 1);
    if (tIdx >= 0 || sIdx >= 0) await fbPut(`/membros/${sigla}`, c);
  }
}

async function adicionarMembro(sigla, depId, tipo) {
  if (!state.membros[sigla]) state.membros[sigla] = { titulares: [], suplentes: [] };
  const c = state.membros[sigla];
  if (!c.titulares) c.titulares = [];
  if (!c.suplentes) c.suplentes = [];

  const lista = tipo === 'titular' ? c.titulares : c.suplentes;
  if (lista.includes(depId)) return;
  lista.push(depId);
  await fbPut(`/membros/${sigla}`, c);
}

async function removerMembro(sigla, depId) {
  const c = state.membros[sigla];
  if (!c) return;
  c.titulares = (c.titulares || []).filter(id => id !== depId);
  c.suplentes = (c.suplentes || []).filter(id => id !== depId);
  await fbPut(`/membros/${sigla}`, c);
}

// ---------- LÓGICA DE CONFLITO ----------

function comissoesDeDeputado(depId) {
  const titulares = [];
  const suplentes = [];
  for (const sigla of Object.keys(state.membros)) {
    const c = state.membros[sigla];
    if ((c.titulares || []).includes(depId)) titulares.push(sigla);
    if ((c.suplentes || []).includes(depId)) suplentes.push(sigla);
  }
  return { titulares, suplentes };
}

function verificarConflitosDeputado(depId) {
  const { titulares } = comissoesDeDeputado(depId);
  const conflitos = [];
  for (const grupo of GRUPOS_INCOMPATIVEIS) {
    const emGrupo = titulares.filter(s => grupo.includes(s));
    if (emGrupo.length > 1) conflitos.push(...emGrupo);
  }
  return [...new Set(conflitos)];
}

function deputadosComConflito() {
  return Object.keys(state.deputados)
    .map(id => ({ id, dep: state.deputados[id], conflitos: verificarConflitosDeputado(id) }))
    .filter(x => x.conflitos.length > 0);
}

function temConflitoPotencial(depId, siglaAlvo) {
  const { titulares } = comissoesDeDeputado(depId);
  for (const grupo of GRUPOS_INCOMPATIVEIS) {
    if (!grupo.includes(siglaAlvo)) continue;
    if (titulares.some(s => s !== siglaAlvo && grupo.includes(s))) return true;
  }
  return false;
}

// ---------- RENDER: SIDEBAR ----------

function mudarView(view) {
  state.view = view;
  state.comissaoSel = null;
  state.busca = '';
  document.getElementById('com-busca').value = '';
  document.querySelectorAll('.com-tab').forEach(t => {
    t.classList.toggle('ativo', t.dataset.view === view);
  });
  document.getElementById('busca-wrap').style.display =
    view === 'alertas' ? 'none' : '';
  renderSidebar();
  renderPainel();
}

function renderSidebar() {
  if (state.view === 'alertas') { renderSidebarAlertas(); return; }
  if (state.view === 'deputado') { renderSidebarDeputados(); return; }
  renderSidebarComissoes();
}

function renderSidebarComissoes() {
  const lista = document.getElementById('com-lista');
  const filtradas = COMISSOES_PERMANENTES.filter(c =>
    c.sigla.toLowerCase().includes(state.busca) ||
    c.nome.toLowerCase().includes(state.busca)
  );

  lista.innerHTML = filtradas.map(c => {
    const m = state.membros[c.sigla] || {};
    const total = (m.titulares || []).length + (m.suplentes || []).length;
    return `
      <div class="com-item${state.comissaoSel === c.sigla ? ' ativo' : ''}" data-sigla="${c.sigla}">
        <span class="com-item-sigla">${c.sigla}</span>
        <span class="com-item-nome">${c.nome}</span>
        <span class="com-item-badge${total > 0 ? ' tem-membro' : ''}">${total > 0 ? total : ''}</span>
      </div>`;
  }).join('');

  lista.querySelectorAll('.com-item').forEach(el => {
    el.addEventListener('click', () => selecionarComissao(el.dataset.sigla));
  });
}

function renderSidebarDeputados() {
  const lista = document.getElementById('com-lista');
  const deps = Object.entries(state.deputados)
    .filter(([, d]) =>
      !state.busca ||
      d.nome.toLowerCase().includes(state.busca) ||
      d.uf.toLowerCase().includes(state.busca)
    )
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  if (!deps.length) {
    lista.innerHTML = `<div class="com-empty" style="padding:24px">Nenhum deputado cadastrado.</div>`;
    return;
  }

  lista.innerHTML = deps.map(([id, d]) => {
    const conflitos = verificarConflitosDeputado(id);
    return `
      <div class="com-item${state.comissaoSel === id ? ' ativo' : ''}" data-sigla="${id}">
        <span class="com-item-nome">${d.nome}<br><small style="color:var(--text-dim)">${d.uf}</small></span>
        ${conflitos.length ? '<span class="com-item-badge" style="color:#f0c040">⚠</span>' : ''}
      </div>`;
  }).join('');

  lista.querySelectorAll('.com-item').forEach(el => {
    el.addEventListener('click', () => selecionarDeputado(el.dataset.sigla));
  });
}

function renderSidebarAlertas() {
  const lista = document.getElementById('com-lista');
  const conflitantes = deputadosComConflito();
  lista.innerHTML = conflitantes.length
    ? `<div class="com-item" style="cursor:default"><span class="com-item-nome" style="color:#f0c040">⚠ ${conflitantes.length} conflito(s) detectado(s)</span></div>`
    : `<div class="com-item" style="cursor:default"><span class="com-item-nome" style="color:var(--accent-light)">✓ Nenhum conflito</span></div>`;
}

// ---------- RENDER: PAINEL ----------

function renderPainel() {
  if (state.view === 'comissao' && state.comissaoSel) {
    renderPainelComissao(state.comissaoSel);
  } else if (state.view === 'deputado' && state.comissaoSel) {
    renderPainelDeputado(state.comissaoSel);
  } else if (state.view === 'alertas') {
    renderPainelAlertas();
  } else {
    const dica = state.view === 'deputado'
      ? 'Selecione um deputado para ver suas comissões'
      : 'Selecione uma comissão para ver os membros';
    document.getElementById('com-painel-conteudo').innerHTML = `
      <div class="com-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <span>${dica}</span>
      </div>`;
  }
}

function renderPainelComissao(sigla) {
  const com = COMISSOES_PERMANENTES.find(c => c.sigla === sigla);
  const m   = state.membros[sigla] || { titulares: [], suplentes: [] };
  const titulares = m.titulares || [];
  const suplentes = m.suplentes || [];

  const renderLinha = (depId, tipo) => {
    const dep = state.deputados[depId];
    if (!dep) return '';
    const conflito = tipo === 'titular' && verificarConflitosDeputado(depId).includes(sigla);
    return `
      <div class="com-membro-row" data-dep="${depId}" data-tipo="${tipo}">
        <span class="com-membro-nome">${dep.nome}</span>
        <span class="com-membro-uf">${dep.uf}</span>
        ${conflito ? '<span class="com-membro-alerta">⚠ Acúmulo</span>' : ''}
        <button class="btn-remover-membro" data-dep="${depId}" data-tipo="${tipo}" data-sigla="${sigla}">Remover</button>
      </div>`;
  };

  document.getElementById('com-painel-conteudo').innerHTML = `
    <div style="margin-bottom:18px">
      <div class="com-painel-titulo">${com.nome}</div>
      <div class="com-painel-sigla">${com.sigla}</div>
    </div>

    <div class="com-grupo">
      <div class="com-grupo-titulo">
        Titulares
        <span class="badge-count">${titulares.length}</span>
      </div>
      ${titulares.map(id => renderLinha(id, 'titular')).join('') || '<p style="font-size:12px;color:var(--text-dim)">Nenhum titular.</p>'}
      <button class="btn-adicionar-membro" data-tipo="titular" data-sigla="${sigla}" style="margin-top:8px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar titular
      </button>
    </div>

    <div class="com-grupo">
      <div class="com-grupo-titulo">
        Suplentes
        <span class="badge-count">${suplentes.length}</span>
      </div>
      ${suplentes.map(id => renderLinha(id, 'suplente')).join('') || '<p style="font-size:12px;color:var(--text-dim)">Nenhum suplente.</p>'}
      <button class="btn-adicionar-membro" data-tipo="suplente" data-sigla="${sigla}" style="margin-top:8px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar suplente
      </button>
    </div>`;

  // Delegação de eventos do painel
  const painel = document.getElementById('com-painel-conteudo');
  painel.querySelectorAll('.btn-remover-membro').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerMembro(btn.dataset.sigla, btn.dataset.dep);
      renderPainelComissao(sigla);
      renderSidebar();
      mostrarToast('Membro removido.');
    });
  });
  painel.querySelectorAll('.btn-adicionar-membro').forEach(btn => {
    btn.addEventListener('click', () =>
      abrirModalAddMembro(btn.dataset.sigla, btn.dataset.tipo));
  });
}

function renderPainelDeputado(depId) {
  const dep = state.deputados[depId];
  if (!dep) return;
  const { titulares, suplentes } = comissoesDeDeputado(depId);
  const conflitos = verificarConflitosDeputado(depId);

  const tagsCom = (siglas, tipo) => siglas.map(s => {
    const com = COMISSOES_PERMANENTES.find(c => c.sigla === s);
    const isConflito = tipo === 'titular' && conflitos.includes(s);
    return `<span class="dep-tag ${isConflito ? 'conflito' : tipo}" title="${com ? com.nome : s}">${s}${isConflito ? ' ⚠' : ''}</span>`;
  }).join('');

  document.getElementById('com-painel-conteudo').innerHTML = `
    <div style="margin-bottom:20px">
      <div class="com-painel-titulo">${dep.nome}</div>
      <div class="com-painel-sigla">${dep.uf}</div>
    </div>

    <div class="com-grupo">
      <div class="com-grupo-titulo">Titular em <span class="badge-count">${titulares.length}</span></div>
      ${titulares.length
        ? `<div class="dep-row-tags" style="margin-bottom:12px">${tagsCom(titulares, 'titular')}</div>`
        : '<p style="font-size:12px;color:var(--text-dim)">Nenhuma titularidade.</p>'}
    </div>

    <div class="com-grupo">
      <div class="com-grupo-titulo">Suplente em <span class="badge-count">${suplentes.length}</span></div>
      ${suplentes.length
        ? `<div class="dep-row-tags">${tagsCom(suplentes, 'suplente')}</div>`
        : '<p style="font-size:12px;color:var(--text-dim)">Nenhuma suplência.</p>'}
    </div>

    ${conflitos.length ? `
    <div class="com-grupo">
      <div class="com-grupo-titulo" style="color:#f0c040">⚠ Conflito de Acúmulo</div>
      <p style="font-size:12px;color:#f0c040;line-height:1.6">
        Titular em <strong>${conflitos.join(', ')}</strong> — comissões mutuamente exclusivas.
        Remova a titularidade em pelo menos uma delas.
      </p>
    </div>` : ''}`;
}

function renderPainelAlertas() {
  const conflitantes = deputadosComConflito();

  document.getElementById('com-painel-conteudo').innerHTML = conflitantes.length
    ? conflitantes.map(({ dep, conflitos }) => `
        <div class="alerta-card">
          <div class="alerta-nome">${dep.nome} — ${dep.uf}</div>
          <div class="alerta-desc">
            Titular em <strong>${conflitos.join(', ')}</strong> — comissões mutuamente exclusivas.<br>
            Remova a titularidade em pelo menos uma delas.
          </div>
        </div>`).join('')
    : `<div class="com-empty" style="padding-top:60px">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>Nenhum conflito de acúmulo detectado.</span>
      </div>`;
}

// ---------- SELEÇÃO ----------

function selecionarComissao(sigla) {
  state.comissaoSel = sigla;
  renderSidebarComissoes();
  renderPainelComissao(sigla);
}

function selecionarDeputado(depId) {
  state.comissaoSel = depId;
  renderSidebarDeputados();
  renderPainelDeputado(depId);
}

// ---------- MODAL: GESTÃO DE DEPUTADOS ----------

function abrirModalDeputados() {
  renderModalDeputadoLista();
  document.getElementById('dep-nome-input').value = '';
  document.getElementById('dep-uf-input').value   = '';
  document.getElementById('modal-deputados').style.display = 'flex';
  document.getElementById('dep-nome-input').focus();
}

function renderModalDeputadoLista() {
  const lista = document.getElementById('dep-modal-lista');
  const deps  = Object.entries(state.deputados)
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  lista.innerHTML = deps.length
    ? deps.map(([id, d]) => `
        <div class="dep-modal-item">
          <span class="dep-modal-nome">${d.nome}</span>
          <span class="dep-modal-uf">${d.uf}</span>
          <button class="btn-remover-membro btn-rem-dep" data-id="${id}">Remover</button>
        </div>`).join('')
    : `<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px">Nenhum deputado cadastrado.</p>`;

  lista.querySelectorAll('.btn-rem-dep').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerDeputadoDB(btn.dataset.id);
      renderModalDeputadoLista();
      renderSidebar();
      renderPainel();
      mostrarToast('Deputado removido.');
    });
  });
}

async function adicionarDeputado() {
  const nome = document.getElementById('dep-nome-input').value.trim();
  const uf   = document.getElementById('dep-uf-input').value;
  if (!nome) { mostrarToast('Informe o nome do deputado.', 'erro'); return; }
  if (!uf)   { mostrarToast('Selecione a UF.', 'erro'); return; }

  const id  = `dep_${Date.now()}`;
  const dep = { nome, uf };
  await salvarDeputado(id, dep);

  document.getElementById('dep-nome-input').value = '';
  document.getElementById('dep-uf-input').value   = '';
  document.getElementById('dep-nome-input').focus();
  renderModalDeputadoLista();
  renderSidebar();
  mostrarToast(`${nome} adicionado.`);
}

// ---------- MODAL: ADICIONAR MEMBRO ----------

function abrirModalAddMembro(sigla, tipo) {
  const com  = COMISSOES_PERMANENTES.find(c => c.sigla === sigla);
  const m    = state.membros[sigla] || { titulares: [], suplentes: [] };
  const jaMembroIds = [...(m.titulares || []), ...(m.suplentes || [])];

  document.getElementById('add-membro-titulo').textContent =
    `Adicionar ${tipo === 'titular' ? 'Titular' : 'Suplente'}`;
  document.getElementById('add-membro-desc').textContent =
    `${com.nome} (${sigla})`;

  const deps = Object.entries(state.deputados)
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  const lista = document.getElementById('membro-select-lista');
  lista.innerHTML = deps.length
    ? deps.map(([id, d]) => {
        const jaMembro  = jaMembroIds.includes(id);
        const conflito  = tipo === 'titular' && !jaMembro && temConflitoPotencial(id, sigla);
        return `
          <div class="membro-select-item${jaMembro ? ' ja-membro' : ''}"
               data-dep="${id}" data-sigla="${sigla}" data-tipo="${tipo}">
            <span class="membro-select-nome">${d.nome}</span>
            <span class="membro-select-uf">${d.uf}</span>
            ${jaMembro ? '<span class="membro-select-conflito">já membro</span>' : ''}
            ${conflito ? '<span class="membro-select-conflito">⚠ acúmulo</span>' : ''}
          </div>`;
      }).join('')
    : `<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px">Nenhum deputado cadastrado.</p>`;

  lista.querySelectorAll('.membro-select-item:not(.ja-membro)').forEach(el => {
    el.addEventListener('click', async () => {
      await adicionarMembro(el.dataset.sigla, el.dataset.dep, el.dataset.tipo);
      fecharModal('modal-add-membro');
      renderPainelComissao(el.dataset.sigla);
      renderSidebarComissoes();
      mostrarToast('Membro adicionado.');
    });
  });

  document.getElementById('modal-add-membro').style.display = 'flex';
}

// ---------- EXPORTAR EXCEL ----------

function exportarExcel() {
  if (typeof XLSX === 'undefined') {
    mostrarToast('Biblioteca Excel não carregada.', 'erro');
    return;
  }

  const rows = [['Comissão', 'Sigla', 'Tipo', 'Deputado', 'UF']];

  for (const com of COMISSOES_PERMANENTES) {
    const m        = state.membros[com.sigla] || {};
    const titulares = m.titulares || [];
    const suplentes = m.suplentes || [];

    for (const depId of titulares) {
      const dep = state.deputados[depId];
      if (dep) rows.push([com.nome, com.sigla, 'Titular', dep.nome, dep.uf]);
    }
    for (const depId of suplentes) {
      const dep = state.deputados[depId];
      if (dep) rows.push([com.nome, com.sigla, 'Suplente', dep.nome, dep.uf]);
    }
  }

  if (rows.length === 1) {
    mostrarToast('Nenhum membro cadastrado para exportar.', 'erro');
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 58 }, { wch: 10 }, { wch: 10 }, { wch: 34 }, { wch: 5 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comissões Podemos');

  const hoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `comissoes-podemos-${hoje}.xlsx`);
  mostrarToast('Excel exportado com sucesso.');
}

// ---------- UTILITÁRIOS ----------

function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

let _toastTimer = null;
function mostrarToast(msg, tipo = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast toast-${tipo}`;
  t.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}
