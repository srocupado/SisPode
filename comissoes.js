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
  view:          'comissao',  // 'comissao' | 'deputado' | 'alertas'
  comissaoSel:   null,        // sigla da comissão selecionada
  deputados:     {},          // { id: { nome, uf } }
  membros:       {},          // { sigla: { titulares: [id,...], suplentes: [id,...] } }
  config:        {},          // { sigla: { titular: n, suplente: n } }
  transferencias:{},          // { sigla: { cedidas: {id: entry}, recebidas: {id: entry} } }
  pedidos:       {},          // { sigla: { id: { depId, obs, data } } }
  busca:         '',
};

// Contexto do modal de transferência em andamento
let _transfCtx = null; // { sigla, tipo, direcao }
// Contexto do modal de deputado de acordo
let _depAcordoCtx = null; // { sigla, transfId }

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

  // Voltar à tela inicial
  document.getElementById('btn-voltar-home')
    .addEventListener('click', () => window.close());

  // Gerir deputados
  document.getElementById('btn-gerir-deputados')
    .addEventListener('click', () => abrirModalDeputados());

  // Configurar vagas
  document.getElementById('btn-config-vagas')
    .addEventListener('click', abrirModalConfigVagas);

  // Salvar config de vagas
  document.getElementById('btn-salvar-vagas')
    .addEventListener('click', salvarConfigVagas);

  // Confirmar transferência
  document.getElementById('btn-confirmar-transf')
    .addEventListener('click', confirmarTransferencia);

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

  // Importar bancada da API da Câmara
  document.getElementById('btn-importar-camara')
    .addEventListener('click', importarDeputadosDaCamara);

  // Salvar deputado de acordo em vaga cedida
  document.getElementById('btn-salvar-dep-acordo')
    .addEventListener('click', salvarDepAcordo);
}

// ---------- FIREBASE: CRUD ----------

async function carregarDados() {
  try {
    const [deps, membros, config, transf, pedidos] = await Promise.all([
      fbGet('/deputados'),
      fbGet('/membros'),
      fbGet('/config'),
      fbGet('/transferencias'),
      fbGet('/pedidos'),
    ]);
    state.deputados      = deps    || {};
    state.membros        = membros || {};
    state.config         = config  || {};
    state.transferencias = transf  || {};
    state.pedidos        = pedidos || {};
  } catch (e) {
    mostrarToast('Erro ao carregar dados do Firebase.', 'erro');
  }
}

async function salvarDeputado(id, dep) {
  await fbPut(`/deputados/${id}`, dep);
  state.deputados[id] = dep;
}

async function removerDeputadoDB(id) {
  await fbDelete(`/deputados/${id}`);
  delete state.deputados[id];

  const siglas = Object.keys(state.membros);
  for (const sigla of siglas) {
    const c = state.membros[sigla];
    const tIdx = (c.titulares || []).indexOf(id);
    const sIdx = (c.suplentes || []).indexOf(id);
    if (tIdx >= 0) c.titulares.splice(tIdx, 1);
    if (sIdx >= 0) c.suplentes.splice(sIdx, 1);
    if (tIdx >= 0 || sIdx >= 0) await fbPut(`/membros/${sigla}`, c);
  }

  // Remove pedidos deste deputado em todas as comissões
  for (const sigla of Object.keys(state.pedidos)) {
    const p = state.pedidos[sigla] || {};
    for (const [pid, entry] of Object.entries(p)) {
      if (entry.depId === id) {
        delete state.pedidos[sigla][pid];
        await fbDelete(`/pedidos/${sigla}/${pid}`);
      }
    }
  }
}

// Retorna true se o membro foi adicionado, false se bloqueado.
async function adicionarMembro(sigla, depId, tipo) {
  if (!state.membros[sigla]) state.membros[sigla] = { titulares: [], suplentes: [] };
  const c = state.membros[sigla];
  if (!c.titulares) c.titulares = [];
  if (!c.suplentes) c.suplentes = [];

  // Validação de vagas
  const disponiveis = vagasDisponiveis(sigla, tipo);
  if (disponiveis <= 0) {
    const ef  = vagasEfetivas(sigla, tipo);
    mostrarToast(ef <= 0
      ? `Sem vagas de ${tipo} configuradas para ${sigla}.`
      : `Vagas de ${tipo} esgotadas em ${sigla}.`,
      'erro');
    return false;
  }

  if (tipo === 'titular') {
    const bloqueio = comissaoConflitante(depId, sigla);
    if (bloqueio) {
      const dep = state.deputados[depId];
      mostrarToast(
        `${dep ? dep.nome : 'Deputado'} já é titular em ${bloqueio}, comissão inacumulável com ${sigla}.`,
        'erro'
      );
      return false;
    }
  }

  const lista = tipo === 'titular' ? c.titulares : c.suplentes;
  if (lista.includes(depId)) return false;
  lista.push(depId);
  await fbPut(`/membros/${sigla}`, c);
  return true;
}

async function removerMembro(sigla, depId) {
  const c = state.membros[sigla];
  if (!c) return;
  c.titulares = (c.titulares || []).filter(id => id !== depId);
  c.suplentes = (c.suplentes || []).filter(id => id !== depId);
  await fbPut(`/membros/${sigla}`, c);
}

// ---------- PEDIDOS ----------

async function adicionarPedido(sigla, depId, obs) {
  const id    = `p_${Date.now()}`;
  const entry = { depId, obs, data: new Date().toISOString() };

  if (!state.pedidos[sigla]) state.pedidos[sigla] = {};
  state.pedidos[sigla][id] = entry;
  await fbPut(`/pedidos/${sigla}/${id}`, entry);
  return id;
}

async function removerPedido(sigla, id) {
  if (state.pedidos[sigla]) delete state.pedidos[sigla][id];
  await fbDelete(`/pedidos/${sigla}/${id}`);
}

async function nomearDePedido(sigla, pedidoId, depId, tipo) {
  const ok = await adicionarMembro(sigla, depId, tipo);
  if (ok) {
    await removerPedido(sigla, pedidoId);
    renderPainelComissao(sigla);
    renderSidebarComissoes();
    mostrarToast(`Deputado nomeado ${tipo} e pedido removido.`);
  }
}

// ---------- LÓGICA DE VAGAS ----------

function vagasEfetivas(sigla, tipo) {
  const cfg  = state.config[sigla] || { titular: 0, suplente: 0 };
  const base = tipo === 'titular' ? (cfg.titular || 0) : (cfg.suplente || 0);
  const t    = state.transferencias[sigla] || {};
  const cedidas   = Object.values(t.cedidas   || {}).filter(x => x.tipo === tipo).length;
  const recebidas = Object.values(t.recebidas || {}).filter(x => x.tipo === tipo).length;
  return base - cedidas + recebidas;
}

function vagasDisponiveis(sigla, tipo) {
  const m      = state.membros[sigla] || {};
  const lista  = tipo === 'titular' ? (m.titulares || []) : (m.suplentes || []);
  return vagasEfetivas(sigla, tipo) - lista.length;
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

// Retorna a sigla da comissão já ocupada que torna siglaAlvo inacumulável, ou null.
function comissaoConflitante(depId, siglaAlvo) {
  const { titulares } = comissoesDeDeputado(depId);
  for (const grupo of GRUPOS_INCOMPATIVEIS) {
    if (!grupo.includes(siglaAlvo)) continue;
    const bloqueio = titulares.find(s => s !== siglaAlvo && grupo.includes(s));
    if (bloqueio) return bloqueio;
  }
  return null;
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
    const m          = state.membros[c.sigla] || {};
    const total      = (m.titulares || []).length + (m.suplentes || []).length;
    const nPedidos   = Object.keys(state.pedidos[c.sigla] || {}).length;

    const efT = vagasEfetivas(c.sigla, 'titular');
    const efS = vagasEfetivas(c.sigla, 'suplente');
    const semVagas = efT <= 0 && efS <= 0;
    const dT = vagasDisponiveis(c.sigla, 'titular');
    const dS = vagasDisponiveis(c.sigla, 'suplente');
    const cheias = !semVagas && dT <= 0 && dS <= 0;

    const extras = [];
    if (semVagas) extras.push('<span class="badge-sem-vagas">sem vagas</span>');
    else if (cheias) extras.push('<span class="badge-sem-vagas" style="background:rgba(240,84,84,.15);color:var(--vermelho)">cheias</span>');
    if (nPedidos > 0) extras.push(`<span class="badge-pedidos">${nPedidos} pedido${nPedidos > 1 ? 's' : ''}</span>`);

    return `
      <div class="com-item${state.comissaoSel === c.sigla ? ' ativo' : ''}" data-sigla="${c.sigla}">
        <span class="com-item-sigla">${c.sigla}</span>
        <span class="com-item-nome">${c.nome}${extras.length ? '<br>' + extras.join(' ') : ''}</span>
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
    const sub = [d.partido, d.uf].filter(Boolean).join(' · ');
    return `
      <div class="com-item${state.comissaoSel === id ? ' ativo' : ''}" data-sigla="${id}">
        <span class="com-item-nome">${d.nome}<br><small style="color:var(--text-dim)">${sub}</small></span>
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

  const efT   = vagasEfetivas(sigla, 'titular');
  const efS   = vagasEfetivas(sigla, 'suplente');
  const dispT = vagasDisponiveis(sigla, 'titular');
  const dispS = vagasDisponiveis(sigla, 'suplente');

  const vagasBadge = (siglaC, tipoC, ef, disp) => {
    if (ef <= 0) return `<span class="vagas-counter vagas-zero">sem vagas</span>`;
    const t2 = state.transferencias[siglaC] || {};
    const nAcordo = Object.values(t2.recebidas || {}).filter(x => x.tipo === tipoC).length;
    const cls = disp <= 0 ? 'vagas-cheias' : 'vagas-ok';
    const ocupadas = ef - disp;
    return `<span class="vagas-counter ${cls}">${ocupadas}/${ef} vagas${nAcordo > 0 ? ` <span class="badge-acordo-mini">${nAcordo} acordo</span>` : ''}</span>`;
  };

  const renderLinha = (depId, tipo) => {
    const dep = state.deputados[depId];
    if (!dep) return '';
    const conflito = tipo === 'titular' && verificarConflitosDeputado(depId).includes(sigla);
    const sub = [dep.partido, dep.uf].filter(Boolean).join(' · ');
    return `
      <div class="com-membro-row">
        <span class="com-membro-nome">${dep.nome}</span>
        <span class="com-membro-uf">${sub}</span>
        ${conflito ? '<span class="com-membro-alerta">⚠ Acúmulo</span>' : ''}
        <button class="btn-remover-membro" data-dep="${depId}" data-tipo="${tipo}" data-sigla="${sigla}">Remover</button>
      </div>`;
  };

  const renderLinhaAcordo = (transfId, e) => `
    <div class="com-membro-row com-membro-acordo">
      <span class="com-membro-nome">${e.depNome}</span>
      <span class="com-membro-uf">${[e.depPartido || e.partido, e.depUf].filter(Boolean).join(' · ')}</span>
      <span class="badge-acordo">Vaga de Acordo</span>
      <button class="btn-dep-acordo" data-sigla="${sigla}" data-id="${transfId}" title="Editar deputado">✎</button>
    </div>`;

  const renderSecaoPedidos = () => {
    const p        = state.pedidos[sigla] || {};
    const entries  = Object.entries(p);

    const fmt = iso => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    };

    const rows = entries.map(([pid, e]) => {
      const dep = state.deputados[e.depId];
      if (!dep) return '';
      const conflT = comissaoConflitante(e.depId, sigla);
      const jaT    = (titulares).includes(e.depId);
      const jaS    = (suplentes).includes(e.depId);
      const podeT  = !jaT && !conflT && dispT > 0;
      const podeS  = !jaS && dispS > 0;
      return `
        <div class="pedido-row">
          <div class="pedido-info">
            <span class="pedido-nome">${dep.nome}</span>
            <span class="com-membro-uf">${dep.uf}</span>
            ${e.obs ? `<span class="pedido-obs">${e.obs}</span>` : ''}
            <span class="pedido-data">${fmt(e.data)}</span>
          </div>
          <div class="pedido-acoes">
            <button class="btn-nomear${podeT ? '' : ' btn-nomear-bloq'}"
                    data-sigla="${sigla}" data-pid="${pid}" data-dep="${e.depId}" data-tipo="titular"
                    ${podeT ? '' : 'disabled'}
                    title="${jaT ? 'Já é titular' : conflT ? 'Inacumulável' : !podeT && efT > 0 ? 'Vagas de titular esgotadas' : 'Sem vagas de titular'}">
              Nomear Titular
            </button>
            <button class="btn-nomear${podeS ? '' : ' btn-nomear-bloq'}"
                    data-sigla="${sigla}" data-pid="${pid}" data-dep="${e.depId}" data-tipo="suplente"
                    ${podeS ? '' : 'disabled'}
                    title="${jaS ? 'Já é suplente' : !podeS && efS > 0 ? 'Vagas de suplente esgotadas' : 'Sem vagas de suplente'}">
              Nomear Suplente
            </button>
            <button class="btn-rejeitar-pedido" data-sigla="${sigla}" data-pid="${pid}">Rejeitar</button>
          </div>
        </div>`;
    }).filter(Boolean);

    return `
      <div class="com-grupo pedidos-secao">
        <div class="com-grupo-titulo">
          Pedidos
          <span class="badge-count" style="${entries.length > 0 ? 'background:rgba(245,158,11,.2);color:#f5a623' : ''}">${entries.length}</span>
        </div>
        ${rows.length ? rows.join('') : '<p style="font-size:12px;color:var(--text-dim)">Nenhum pedido registrado.</p>'}
        <button class="btn-adicionar-membro" data-sigla="${sigla}" id="btn-add-pedido-painel" style="margin-top:8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Registrar pedido
        </button>
      </div>`;
  };

  const renderTransferencias = () => {
    const t       = state.transferencias[sigla] || {};
    const cedidas   = Object.entries(t.cedidas   || {});
    const recebidas = Object.entries(t.recebidas || {});
    if (!cedidas.length && !recebidas.length) return '';

    const fmt = iso => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    };

    const rows = [
      ...cedidas.map(([id, e]) => `
        <div class="transf-item">
          <span class="transf-icone">↗</span>
          <div class="transf-texto">
            <div>Cedida <strong>${e.tipo}</strong> → ${e.partido}${e.obs ? ` · <em>${e.obs}</em>` : ''}
              <span class="badge-acordo" style="margin-left:6px">Vaga de Acordo</span>
            </div>
            ${e.depNome ? `<div style="margin-top:4px;font-size:11px;color:var(--text-dim)">
              Ocupante: <strong style="color:var(--text)">${e.depNome}</strong>${e.depPartido ? ` · ${e.depPartido}` : ''}${e.depUf ? ` · ${e.depUf}` : ''}
            </div>` : ''}
          </div>
          <span class="transf-data">${fmt(e.data)}</span>
          <div class="transf-acoes">
            <button class="btn-dep-acordo" data-sigla="${sigla}" data-id="${id}">${e.depNome ? '✎ Dep.' : '+ Dep.'}</button>
            <button class="btn-desfazer" data-sigla="${sigla}" data-direcao="cedidas" data-id="${id}">✕</button>
          </div>
        </div>`),
      ...recebidas.map(([id, e]) => `
        <div class="transf-item">
          <span class="transf-icone">↙</span>
          <span class="transf-texto">
            Recebida <strong>${e.tipo}</strong> ← ${e.partido}
            ${e.obs ? `· <em>${e.obs}</em>` : ''}
            <span class="badge-acordo" style="margin-left:6px">Vaga de Acordo</span>
          </span>
          <span class="transf-data">${fmt(e.data)}</span>
          <div class="transf-acoes">
            <button class="btn-desfazer" data-sigla="${sigla}" data-direcao="recebidas" data-id="${id}">✕ Desfazer</button>
          </div>
        </div>`),
    ];

    return `
      <div class="transf-secao">
        <div class="com-grupo-titulo" style="margin-bottom:10px">Transferências</div>
        ${rows.join('')}
      </div>`;
  };

  document.getElementById('com-painel-conteudo').innerHTML = `
    <div style="margin-bottom:18px">
      <div class="com-painel-titulo">${com.nome}</div>
      <div class="com-painel-sigla">${com.sigla}</div>
    </div>

    <div class="com-grupo">
      <div class="com-grupo-acoes">
        <div class="com-grupo-titulo" style="margin-bottom:0">
          Titulares
          <span class="badge-count">${titulares.length}</span>
          ${vagasBadge(sigla, 'titular', efT, dispT)}
        </div>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="titular" data-direcao="ceder">↗ Ceder vaga</button>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="titular" data-direcao="receber">↙ Receber vaga</button>
      </div>
      ${titulares.map(id => renderLinha(id, 'titular')).join('') || '<p style="font-size:12px;color:var(--text-dim)">Nenhum titular.</p>'}
      ${Object.entries((state.transferencias[sigla] || {}).cedidas || {})
          .filter(([, e]) => e.tipo === 'titular' && e.depNome)
          .map(([tid, e]) => renderLinhaAcordo(tid, e)).join('')}
      <button class="btn-adicionar-membro${efT <= 0 ? ' btn-add-bloqueado' : ''}"
              data-tipo="titular" data-sigla="${sigla}" style="margin-top:8px"
              ${efT <= 0 ? 'disabled title="Configure as vagas de titular para esta comissão"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar titular
      </button>
    </div>

    <div class="com-grupo">
      <div class="com-grupo-acoes">
        <div class="com-grupo-titulo" style="margin-bottom:0">
          Suplentes
          <span class="badge-count">${suplentes.length}</span>
          ${vagasBadge(sigla, 'suplente', efS, dispS)}
        </div>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="suplente" data-direcao="ceder">↗ Ceder vaga</button>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="suplente" data-direcao="receber">↙ Receber vaga</button>
      </div>
      ${suplentes.map(id => renderLinha(id, 'suplente')).join('') || '<p style="font-size:12px;color:var(--text-dim)">Nenhum suplente.</p>'}
      ${Object.entries((state.transferencias[sigla] || {}).cedidas || {})
          .filter(([, e]) => e.tipo === 'suplente' && e.depNome)
          .map(([tid, e]) => renderLinhaAcordo(tid, e)).join('')}
      <button class="btn-adicionar-membro${efS <= 0 ? ' btn-add-bloqueado' : ''}"
              data-tipo="suplente" data-sigla="${sigla}" style="margin-top:8px"
              ${efS <= 0 ? 'disabled title="Configure as vagas de suplente para esta comissão"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar suplente
      </button>
    </div>

    ${renderSecaoPedidos()}
    ${renderTransferencias()}`;

  // Delegação de eventos
  const painel = document.getElementById('com-painel-conteudo');

  painel.querySelectorAll('.btn-remover-membro').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerMembro(btn.dataset.sigla, btn.dataset.dep);
      renderPainelComissao(sigla);
      renderSidebar();
      mostrarToast('Membro removido.');
    });
  });
  painel.querySelectorAll('.btn-adicionar-membro:not([disabled])').forEach(btn => {
    if (btn.id === 'btn-add-pedido-painel') return; // tratado abaixo
    btn.addEventListener('click', () =>
      abrirModalAddMembro(btn.dataset.sigla, btn.dataset.tipo));
  });
  painel.querySelectorAll('.btn-transferencia').forEach(btn => {
    btn.addEventListener('click', () =>
      abrirModalTransferencia(btn.dataset.sigla, btn.dataset.tipo, btn.dataset.direcao));
  });
  painel.querySelectorAll('.btn-desfazer').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerTransferencia(btn.dataset.sigla, btn.dataset.direcao, btn.dataset.id);
      renderPainelComissao(sigla);
      renderSidebarComissoes();
      mostrarToast('Transferência desfeita.');
    });
  });
  painel.querySelectorAll('.btn-dep-acordo').forEach(btn => {
    btn.addEventListener('click', () =>
      abrirModalDepAcordo(btn.dataset.sigla, btn.dataset.id));
  });
  painel.querySelectorAll('.btn-nomear:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () =>
      nomearDePedido(btn.dataset.sigla, btn.dataset.pid, btn.dataset.dep, btn.dataset.tipo));
  });
  painel.querySelectorAll('.btn-rejeitar-pedido').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerPedido(btn.dataset.sigla, btn.dataset.pid);
      renderPainelComissao(sigla);
      renderSidebarComissoes();
      mostrarToast('Pedido removido.');
    });
  });
  const btnAddPedido = painel.querySelector('#btn-add-pedido-painel');
  if (btnAddPedido) {
    btnAddPedido.addEventListener('click', () =>
      abrirModalAddPedido(btnAddPedido.dataset.sigla));
  }
}

function renderPainelDeputado(depId) {
  const dep = state.deputados[depId];
  if (!dep) return;
  const { titulares, suplentes } = comissoesDeDeputado(depId);
  const conflitos = verificarConflitosDeputado(depId);

  // Comissões com pedido pendente deste deputado
  const pedidosEm = Object.entries(state.pedidos)
    .filter(([, p]) => Object.values(p).some(e => e.depId === depId))
    .map(([sigla]) => sigla);

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

    ${pedidosEm.length ? `
    <div class="com-grupo">
      <div class="com-grupo-titulo" style="color:#f5a623">Pedidos pendentes <span class="badge-count" style="background:rgba(245,158,11,.2);color:#f5a623">${pedidosEm.length}</span></div>
      <div class="dep-row-tags">${pedidosEm.map(s => {
        const com = COMISSOES_PERMANENTES.find(c => c.sigla === s);
        return `<span class="dep-tag" style="background:rgba(245,158,11,.15);color:#f5a623" title="${com ? com.nome : s}">${s}</span>`;
      }).join('')}</div>
    </div>` : ''}

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
          <span class="dep-modal-nome">${d.nome}${d.idCamara ? '<span class="badge-api" title="Importado da API da Câmara">API</span>' : ''}</span>
          ${d.partido ? `<span class="dep-modal-uf">${d.partido}</span>` : ''}
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
  const nome    = document.getElementById('dep-nome-input').value.trim();
  const partido = document.getElementById('dep-partido-input').value.trim().toUpperCase();
  const uf      = document.getElementById('dep-uf-input').value;
  if (!nome) { mostrarToast('Informe o nome do deputado.', 'erro'); return; }
  if (!uf)   { mostrarToast('Selecione a UF.', 'erro'); return; }

  const id  = `dep_${Date.now()}`;
  const dep = { nome, uf, ...(partido && { partido }) };
  await salvarDeputado(id, dep);

  document.getElementById('dep-nome-input').value    = '';
  document.getElementById('dep-partido-input').value = '';
  document.getElementById('dep-uf-input').value      = '';
  document.getElementById('dep-nome-input').focus();
  renderModalDeputadoLista();
  renderSidebar();
  mostrarToast(`${nome} adicionado.`);
}

// ---------- IMPORTAR DA API DA CÂMARA ----------

async function importarDeputadosDaCamara() {
  const btn = document.getElementById('btn-importar-camara');
  const textoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Importando...';

  try {
    let url = 'https://dadosabertos.camara.leg.br/api/v2/deputados?siglaPartido=PODE&itens=100&ordem=ASC&ordenarPor=nome';
    let importados = 0, atualizados = 0, inalterados = 0;

    while (url) {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();

      for (const d of data.dados || []) {
        const id  = `cam_${d.id}`;
        const dep = { nome: d.nome, uf: d.siglaUf, partido: d.siglaPartido, idCamara: d.id };
        const exist = state.deputados[id];

        if (!exist) {
          await salvarDeputado(id, dep);
          importados++;
        } else if (exist.nome !== dep.nome || exist.uf !== dep.uf || exist.idCamara !== dep.idCamara) {
          await salvarDeputado(id, dep);
          atualizados++;
        } else {
          inalterados++;
        }
      }

      const next = (data.links || []).find(l => l.rel === 'next');
      url = next ? next.href : null;
    }

    const partes = [];
    if (importados)  partes.push(`${importados} novo${importados > 1 ? 's' : ''}`);
    if (atualizados) partes.push(`${atualizados} atualizado${atualizados > 1 ? 's' : ''}`);
    if (inalterados) partes.push(`${inalterados} sem mudança`);
    mostrarToast(`Importação concluída: ${partes.join(', ') || 'nada a fazer'}.`);

    renderModalDeputadoLista();
    renderSidebar();
  } catch (e) {
    mostrarToast('Falha ao importar da Câmara: ' + e.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

// ---------- MODAL: ADICIONAR MEMBRO ----------

function abrirModalAddMembro(sigla, tipo) {
  const disp = vagasDisponiveis(sigla, tipo);
  if (disp <= 0) {
    const ef = vagasEfetivas(sigla, tipo);
    mostrarToast(ef <= 0
      ? `Sem vagas de ${tipo} configuradas para ${sigla}.`
      : `Vagas de ${tipo} esgotadas em ${sigla}.`,
      'erro');
    return;
  }

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
        const jaMembro   = jaMembroIds.includes(id);
        const conflito   = tipo === 'titular' && !jaMembro ? comissaoConflitante(id, sigla) : null;
        const bloqueado  = jaMembro || !!conflito;
        let aviso = '';
        if (jaMembro)  aviso = '<span class="membro-select-conflito">já membro</span>';
        if (conflito)  aviso = `<span class="membro-select-conflito">⚠ já é titular em ${conflito} (inacumulável)</span>`;
        return `
          <div class="membro-select-item${bloqueado ? ' ja-membro' : ''}"
               data-dep="${id}" data-sigla="${sigla}" data-tipo="${tipo}">
            <span class="membro-select-nome">${d.nome}</span>
            <span class="membro-select-uf">${d.uf}</span>
            ${aviso}
          </div>`;
      }).join('')
    : `<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px">Nenhum deputado cadastrado.</p>`;

  lista.querySelectorAll('.membro-select-item:not(.ja-membro)').forEach(el => {
    el.addEventListener('click', async () => {
      const ok = await adicionarMembro(el.dataset.sigla, el.dataset.dep, el.dataset.tipo);
      if (ok) {
        fecharModal('modal-add-membro');
        renderPainelComissao(el.dataset.sigla);
        renderSidebarComissoes();
        mostrarToast('Membro adicionado.');
      }
    });
  });

  document.getElementById('modal-add-membro').style.display = 'flex';
}

// ---------- MODAL: REGISTRAR PEDIDO ----------

function abrirModalAddPedido(sigla) {
  const com = COMISSOES_PERMANENTES.find(c => c.sigla === sigla);
  const p   = state.pedidos[sigla] || {};
  const m   = state.membros[sigla] || {};
  // Deputados que já têm pedido OU já são membros ficam bloqueados
  const jaMembroIds = [...(m.titulares || []), ...(m.suplentes || [])];
  const jaPedidoIds = Object.values(p).map(e => e.depId);
  const bloqueadoIds = new Set([...jaMembroIds, ...jaPedidoIds]);

  document.getElementById('add-pedido-titulo').textContent = `Registrar Pedido — ${sigla}`;
  document.getElementById('add-pedido-desc').textContent   = `${com.nome}`;
  document.getElementById('pedido-obs-input').value = '';

  const deps = Object.entries(state.deputados)
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  const lista = document.getElementById('pedido-select-lista');
  lista.innerHTML = deps.length
    ? deps.map(([id, d]) => {
        const bloqueado = bloqueadoIds.has(id);
        const motivo = jaMembroIds.includes(id)
          ? '<span class="membro-select-conflito">já membro</span>'
          : jaPedidoIds.includes(id)
            ? '<span class="membro-select-conflito">pedido já registrado</span>'
            : '';
        return `
          <div class="membro-select-item${bloqueado ? ' ja-membro' : ''}"
               data-dep="${id}" data-sigla="${sigla}">
            <span class="membro-select-nome">${d.nome}</span>
            <span class="membro-select-uf">${d.uf}</span>
            ${motivo}
          </div>`;
      }).join('')
    : `<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px">Nenhum deputado cadastrado.</p>`;

  lista.querySelectorAll('.membro-select-item:not(.ja-membro)').forEach(el => {
    el.addEventListener('click', async () => {
      const obs = document.getElementById('pedido-obs-input').value.trim();
      await adicionarPedido(el.dataset.sigla, el.dataset.dep, obs);
      fecharModal('modal-add-pedido');
      renderPainelComissao(el.dataset.sigla);
      renderSidebarComissoes();
      const dep = state.deputados[el.dataset.dep];
      mostrarToast(`Pedido de ${dep ? dep.nome : 'deputado'} registrado.`);
    });
  });

  document.getElementById('modal-add-pedido').style.display = 'flex';
}

// ---------- MODAL: CONFIGURAR VAGAS ----------

function abrirModalConfigVagas() {
  const lista = document.getElementById('config-vagas-lista');
  lista.innerHTML = COMISSOES_PERMANENTES.map(c => {
    const cfg = state.config[c.sigla] || { titular: 0, suplente: 0 };
    return `
      <div class="config-vaga-row">
        <div class="config-vaga-nome">
          <span class="config-vaga-sigla">${c.sigla}</span>
          ${c.nome}
        </div>
        <input type="number" class="config-vaga-input" min="0" max="99"
               data-sigla="${c.sigla}" data-tipo="titular"
               value="${cfg.titular || 0}">
        <input type="number" class="config-vaga-input" min="0" max="99"
               data-sigla="${c.sigla}" data-tipo="suplente"
               value="${cfg.suplente || 0}">
      </div>`;
  }).join('');

  document.getElementById('modal-config-vagas').style.display = 'flex';
}

async function salvarConfigVagas() {
  const inputs    = document.querySelectorAll('#config-vagas-lista .config-vaga-input');
  const novoConfig = {};

  inputs.forEach(inp => {
    const { sigla, tipo } = inp.dataset;
    if (!novoConfig[sigla]) novoConfig[sigla] = { titular: 0, suplente: 0 };
    novoConfig[sigla][tipo] = Math.max(0, parseInt(inp.value, 10) || 0);
  });

  try {
    await fbPut('/config', novoConfig);
    state.config = novoConfig;
    fecharModal('modal-config-vagas');
    renderSidebarComissoes();
    if (state.comissaoSel && state.view === 'comissao') {
      renderPainelComissao(state.comissaoSel);
    }
    mostrarToast('Vagas salvas com sucesso.');
  } catch (e) {
    mostrarToast('Erro ao salvar vagas.', 'erro');
  }
}

// ---------- MODAL: TRANSFERÊNCIA DE VAGA ----------

function abrirModalTransferencia(sigla, tipo, direcao) {
  _transfCtx = { sigla, tipo, direcao };

  const acao = direcao === 'ceder' ? 'Ceder' : 'Receber';
  const prep = direcao === 'ceder' ? 'para' : 'de';
  document.getElementById('transf-titulo').textContent =
    `${acao} Vaga de ${tipo === 'titular' ? 'Titular' : 'Suplente'} — ${sigla}`;
  document.getElementById('transf-desc').textContent =
    `${acao} 1 vaga de ${tipo} ${prep} outro partido. Isso ajustará as vagas disponíveis.`;
  document.getElementById('transf-partido-label').textContent =
    direcao === 'ceder' ? 'Partido destinatário' : 'Partido de origem';
  document.getElementById('transf-partido').value = '';
  document.getElementById('transf-obs').value     = '';
  document.getElementById('modal-transferencia').style.display = 'flex';
  document.getElementById('transf-partido').focus();
}

async function confirmarTransferencia() {
  if (!_transfCtx) return;
  const { sigla, tipo, direcao } = _transfCtx;
  const partido = document.getElementById('transf-partido').value.trim().toUpperCase();
  const obs     = document.getElementById('transf-obs').value.trim();
  if (!partido) { mostrarToast('Informe o partido.', 'erro'); return; }

  await salvarTransferencia(sigla, tipo, direcao, partido, obs);
  _transfCtx = null;
  fecharModal('modal-transferencia');
  renderPainelComissao(sigla);
  renderSidebarComissoes();
  mostrarToast(direcao === 'ceder' ? 'Vaga cedida.' : 'Vaga recebida.');
}

async function salvarTransferencia(sigla, tipo, direcao, partido, obs) {
  const id      = `t_${Date.now()}`;
  const subPath = direcao === 'ceder' ? 'cedidas' : 'recebidas';
  const entry   = { tipo, partido, obs, data: new Date().toISOString() };

  if (!state.transferencias[sigla]) state.transferencias[sigla] = {};
  if (!state.transferencias[sigla][subPath]) state.transferencias[sigla][subPath] = {};
  state.transferencias[sigla][subPath][id] = entry;

  await fbPut(`/transferencias/${sigla}/${subPath}/${id}`, entry);
}

async function removerTransferencia(sigla, direcao, id) {
  if (state.transferencias[sigla]?.[direcao]) {
    delete state.transferencias[sigla][direcao][id];
  }
  await fbDelete(`/transferencias/${sigla}/${direcao}/${id}`);
}

// ---------- MODAL: DEPUTADO DE ACORDO ----------

function abrirModalDepAcordo(sigla, transfId) {
  const e = state.transferencias[sigla]?.cedidas?.[transfId];
  _depAcordoCtx = { sigla, transfId };

  const com = COMISSOES_PERMANENTES.find(c => c.sigla === sigla);
  document.getElementById('dep-acordo-titulo').textContent =
    `Deputado na Vaga Cedida — ${sigla}`;
  document.getElementById('dep-acordo-desc').textContent =
    `Vaga de ${e?.tipo || ''} cedida ao ${e?.partido || ''}${com ? ` · ${com.nome}` : ''}`;
  document.getElementById('dep-acordo-nome').value    = e?.depNome    || '';
  document.getElementById('dep-acordo-partido').value = e?.depPartido || '';
  document.getElementById('dep-acordo-uf').value      = e?.depUf      || '';
  document.getElementById('modal-dep-acordo').style.display = 'flex';
  document.getElementById('dep-acordo-nome').focus();
}

async function salvarDepAcordo() {
  if (!_depAcordoCtx) return;
  const { sigla, transfId } = _depAcordoCtx;
  const nome    = document.getElementById('dep-acordo-nome').value.trim();
  const partido = document.getElementById('dep-acordo-partido').value.trim().toUpperCase();
  const uf      = document.getElementById('dep-acordo-uf').value;

  if (!nome) { mostrarToast('Informe o nome do deputado.', 'erro'); return; }

  const entry   = state.transferencias[sigla]?.cedidas?.[transfId];
  if (!entry) return;

  const updated = { ...entry, depNome: nome, depPartido: partido, depUf: uf };
  state.transferencias[sigla].cedidas[transfId] = updated;
  await fbPut(`/transferencias/${sigla}/cedidas/${transfId}`, updated);

  _depAcordoCtx = null;
  fecharModal('modal-dep-acordo');
  renderPainelComissao(sigla);
  mostrarToast('Deputado de acordo registrado.');
}

// ---------- EXPORTAR EXCEL ----------

function exportarExcel() {
  if (typeof XLSX === 'undefined') {
    mostrarToast('Biblioteca Excel não carregada.', 'erro');
    return;
  }

  // Aba 1: membros
  const rowsMembros = [['Comissão', 'Sigla', 'Tipo', 'Deputado', 'UF']];
  for (const com of COMISSOES_PERMANENTES) {
    const m         = state.membros[com.sigla] || {};
    const titulares = m.titulares || [];
    const suplentes = m.suplentes || [];
    for (const depId of titulares) {
      const dep = state.deputados[depId];
      if (dep) rowsMembros.push([com.nome, com.sigla, 'Titular', dep.nome, dep.uf]);
    }
    for (const depId of suplentes) {
      const dep = state.deputados[depId];
      if (dep) rowsMembros.push([com.nome, com.sigla, 'Suplente', dep.nome, dep.uf]);
    }
  }

  // Aba 2: pedidos
  const rowsPedidos = [['Comissão', 'Sigla', 'Deputado', 'UF', 'Observação', 'Data']];
  const fmt = iso => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };
  for (const com of COMISSOES_PERMANENTES) {
    const p = state.pedidos[com.sigla] || {};
    for (const e of Object.values(p)) {
      const dep = state.deputados[e.depId];
      if (dep) rowsPedidos.push([com.nome, com.sigla, dep.nome, dep.uf, e.obs || '', fmt(e.data)]);
    }
  }

  const wb = XLSX.utils.book_new();

  if (rowsMembros.length > 1) {
    const ws1 = XLSX.utils.aoa_to_sheet(rowsMembros);
    ws1['!cols'] = [{ wch: 58 }, { wch: 10 }, { wch: 10 }, { wch: 34 }, { wch: 5 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Membros');
  }

  if (rowsPedidos.length > 1) {
    const ws2 = XLSX.utils.aoa_to_sheet(rowsPedidos);
    ws2['!cols'] = [{ wch: 58 }, { wch: 10 }, { wch: 34 }, { wch: 5 }, { wch: 30 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Pedidos');
  }

  if (wb.SheetNames.length === 0) {
    mostrarToast('Nenhum dado para exportar.', 'erro');
    return;
  }

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
