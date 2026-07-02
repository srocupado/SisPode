/* ============================================================
   ANÁLISE DA PAUTA – PODEMOS
   Painel que importa a Pauta da Semana (PDF), identifica projetos
   e requerimentos, marca autoria do Podemos (principal e apensados),
   e gera análise técnica via IA sobre o parecer mais recente do
   relator (projetos) ou o inteiro teor (requerimentos).
   ============================================================ */

'use strict';

// ---------- CONFIGURAÇÕES ----------
const API_BASE     = 'https://dadosabertos.camara.leg.br/api/v2';
const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const SIGLA_PODEMOS = 'PODE';


// ---------- PROVEDORES DE IA (listagem de modelos) ----------
const PROVEDORES_META = {
  gemini: {
    label: 'Google Gemini',
    placeholderChave: 'AIzaSy... ou AQ....',
    hintChave: 'Obtenha em aistudio.google.com → Get API key',
    regexChave: /^[\w.-]{20,}$/,
    modelosFallback: [
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro',   displayName: 'Gemini 2.5 Pro' },
    ],
    async listar(key) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=50`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      return (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && (m.name || '').includes('gemini'))
        .map(m => ({ id: (m.name || '').replace(/^models\//, ''), displayName: m.displayName || m.name }));
    },
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    placeholderChave: 'sk-...',
    hintChave: 'Obtenha em platform.openai.com/api-keys',
    regexChave: /^sk-[\w-]{20,}$/,
    modelosFallback: [
      { id: 'gpt-5',   displayName: 'GPT-5' },
      { id: 'gpt-4.1', displayName: 'GPT-4.1' },
      { id: 'gpt-4o',  displayName: 'GPT-4o' },
    ],
    async listar(key) {
      const res = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      const prefs = ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4'];
      const ids = (j.data || []).map(m => m.id).filter(id => prefs.some(p => id.startsWith(p)));
      return ids.length ? ids.map(id => ({ id, displayName: id })) : this.modelosFallback;
    },
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    placeholderChave: 'sk-ant-...',
    hintChave: 'Obtenha em console.anthropic.com → Settings → API Keys',
    regexChave: /^sk-ant-[\w-]{20,}$/,
    modelosFallback: [
      { id: 'claude-opus-4-8',           displayName: 'Claude Opus 4.8' },
      { id: 'claude-opus-4-7',           displayName: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    ],
    async listar(key) {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      const lista = (j.data || []).map(m => ({ id: m.id, displayName: m.display_name || m.id }));
      return lista.length ? lista : this.modelosFallback;
    },
  },
};

// ---------- ESTADO ----------
const state = {
  config:    null,             // chrome.storage.local 'config'
  pauta:     null,             // { id, titulo, periodo, uploadedAt, uploadedBy, itens[], pdfBase64 }
  cacheAutoria: new Map(),     // idDeputado → { nome, siglaPartido, isPodemos }
  cacheProposicao: new Map(),  // "PL-488-2019" → { id, urlInteiroTeor, autores, apensados, relator }
  dirty:     false,            // há mudanças locais não persistidas no Firebase?
  ultimoSave: null,            // ISO da última gravação bem-sucedida
  syncTimer: null,             // setInterval do auto-save
  salvando:  false,            // evita gravações concorrentes
  promptsBiblioteca: [],       // [{ id, nome, texto, criadoPor, criadoEm, atualizadoEm }] — Firebase compartilhado
  promptPadraoId: null,        // id do prompt aplicado por padrão nas gerações (compartilhado pela equipe)
  interesse: null,             // { lista:[{id,nome}], dados:{idDep:{temas,perfil}}, carregado } — Firebase compartilhado
  selecionados: new Set(),     // chaves marcadas para o PDF (vazio = exporta todos)
  historico: { indice: null, notasShallow: null, notasFull: null },  // busca em pautas anteriores
};

const AUTO_SAVE_INTERVAL_MS = 10000;

// ============================================================
//  BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await carregarConfig();

  // Aviso se o usuário tentar sair com autosave pendente ou em voo.
  window.addEventListener('beforeunload', (e) => {
    for (const st of _autosaveState.values()) {
      if (st.debounceId || st.salvando || st.dirty) {
        e.preventDefault();
        e.returnValue = '';
        return;
      }
    }
  });

  document.getElementById('btn-voltar').addEventListener('click', () => {
    history.length > 1 ? history.back() : window.close();
  });

  document.getElementById('input-pauta-pdf').addEventListener('change', onPdfSelecionado);
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPdf);
  document.getElementById('btn-exportar-docx').addEventListener('click', exportarDocx);
  document.getElementById('btn-salvar-firebase').addEventListener('click', salvarPautaManual);
  document.getElementById('btn-configuracoes').addEventListener('click', abrirConfig);
  document.getElementById('btn-adicionar-item').addEventListener('click', abrirModalAdicionar);
  document.getElementById('btn-gerar-todas').addEventListener('click', toggleGerarTodas);
  document.getElementById('btn-verificar-atualizacoes').addEventListener('click', verificarAtualizacoesPauta);
  document.getElementById('btn-prop-partido').addEventListener('click', copiarPropPartido);
  document.getElementById('btn-resumo-sessao').addEventListener('click', copiarResumoSessao);
  document.getElementById('btn-apelidos').addEventListener('click', copiarApelidos);
  document.getElementById('btn-parar-todas').addEventListener('click', pararTodasAnalises);
  document.getElementById('btn-confirmar-adicionar').addEventListener('click', confirmarAdicionar);
  document.getElementById('btn-confirmar-vincular').addEventListener('click', confirmarVincular);
  document.getElementById('btn-recategorizar').addEventListener('click', abrirRecategorizar);
  document.getElementById('btn-recat-auto').addEventListener('click', recatCorrigirAuto);
  document.getElementById('btn-recat-aplicar').addEventListener('click', aplicarRecategorizar);
  document.getElementById('btn-confirmar-remover').addEventListener('click', confirmarRemover);
  document.getElementById('btn-confirmar-apagar-pauta').addEventListener('click', confirmarApagarPauta);
  document.getElementById('busca-itens').addEventListener('input', () => {
    aplicarBuscaItens();          // filtra a pauta atual (instantâneo)
    agendarBuscaHistorico();      // busca nas pautas anteriores (debounce)
  });
  document.getElementById('btn-hist-abrir-pauta').addEventListener('click', abrirPautaDeOrigem);
  document.getElementById('btn-hist-trazer').addEventListener('click', trazerParaPautaAtual);

  // Renomear pauta (inline na barra superior)
  document.getElementById('btn-renomear-pauta').addEventListener('click', abrirRenomearPauta);
  const renInput = document.getElementById('pauta-rename-input');
  renInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _renameCancel = false; renInput.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); _renameCancel = true; renInput.blur(); }
  });
  renInput.addEventListener('blur', () => {
    if (_renameCancel) { _renameCancel = false; fecharRenomearPauta(); }
    else salvarRenomearPauta();
  });

  // Modal de configurações: fechamento e ações
  document.querySelectorAll('[data-fecha]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-fecha');
      document.getElementById(id).style.display = 'none';
    });
  });
  document.getElementById('config-provedor').addEventListener('change', onProvedorChange);
  document.getElementById('btn-carregar-modelos').addEventListener('click', carregarModelos);
  document.getElementById('btn-salvar-config').addEventListener('click', salvarConfig);
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const inp = document.getElementById('config-api-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('btn-varrer-orfaos').addEventListener('click', () => varrerAnalisesOrfas(true));
  document.getElementById('btn-salvar-interesse').addEventListener('click', salvarInteresse);
  document.getElementById('config-interesse-ativo').addEventListener('change', onToggleInteresseAtivo);
  document.getElementById('interesse-busca').addEventListener('input', filtrarInteresseBusca);
  document.querySelectorAll('.config-tab-btn').forEach(b => {
    b.addEventListener('click', () => selecionarAbaConfig(b.getAttribute('data-config-tab')));
  });

  // Modal "Reanalisar com IA" (prompt personalizado + biblioteca compartilhada)
  document.getElementById('reanalise-select').addEventListener('change', refletirSelecaoPrompt);
  document.getElementById('reanalise-padrao').addEventListener('change', onReanalisePadraoToggle);
  document.getElementById('btn-reanalise-salvar').addEventListener('click', salvarPromptNovo);
  document.getElementById('btn-reanalise-atualizar').addEventListener('click', atualizarPromptSelecionado);
  document.getElementById('btn-reanalise-excluir').addEventListener('click', excluirPromptSelecionado);
  document.getElementById('btn-reanalise-executar').addEventListener('click', executarReanalise);

  iniciarAutoSave();

  // Carrega a biblioteca de prompts compartilhada (não bloqueia a UI)
  carregarBibliotecaPrompts().catch(e => console.warn('Falha ao carregar prompts:', e.message));

  // Carrega os temas de interesse dos parlamentares (badge laranja) — não bloqueia
  carregarInteresse().catch(e => console.warn('Falha ao carregar interesses:', e.message));

  // Lista pautas no sidebar e carrega a mais recente
  await atualizarSidebarPautas();
  await carregarUltimaPauta();

  // Varredura silenciosa de análises órfãs (sem bloquear UI)
  varrerAnalisesOrfas(false).catch(() => {});
});

async function carregarConfig() {
  state.config = await new Promise(r => {
    chrome.storage.local.get('config', d => r(d.config || {}));
  });
}

// ============================================================
//  UPLOAD E PARSING DO PDF
// ============================================================
async function onPdfSelecionado(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  ev.target.value = '';

  mostrarToast('Lendo PDF...', 'info');
  try {
    const arrayBuffer = await file.arrayBuffer();
    const texto       = await extrairTextoPdf(arrayBuffer);
    const parsed      = parsearPauta(texto);

    if (!parsed.itens.length) {
      mostrarToast('Não foi possível identificar itens na pauta.', 'aviso');
      return;
    }

    state.pauta = {
      id:         gerarIdPauta(parsed.periodo, file.name),
      titulo:     parsed.titulo || 'Pauta da Semana',
      periodo:    parsed.periodo || '',
      uploadedAt: new Date().toISOString(),
      uploadedBy: state.config?.nomeUsuario || 'equipe',
      pdfNome:    file.name,
      itens:      parsed.itens.map(normalizarItem),
    };

    renderizarPauta();
    document.getElementById('btn-exportar-pdf').disabled = false;
    document.getElementById('btn-exportar-docx').disabled = false;
    document.getElementById('btn-salvar-firebase').disabled = false;
    document.getElementById('btn-adicionar-item').disabled = false;
    document.getElementById('btn-gerar-todas').disabled = false;
    document.getElementById('btn-verificar-atualizacoes').disabled = false;
    document.getElementById('btn-prop-partido').disabled = false;
    document.getElementById('btn-resumo-sessao').disabled = false;
    document.getElementById('btn-apelidos').disabled = false;
    document.getElementById('btn-recategorizar').disabled = false;
    state.ultimoSave = state.pauta.uploadedAt || new Date().toISOString();
    state.dirty = false;
    atualizarStatusSync('ok');

    mostrarToast(`✓ ${parsed.itens.length} itens identificados`, 'sucesso');

    // Enriquecimento assíncrono (autoria + apensados + parecer) para cada item
    enriquecerItens();

    // Marca como dirty e persiste imediatamente (auto-save tenta de novo se falhar)
    marcarSujo();
    fbSalvarPauta(state.pauta).catch(e => {
      console.warn('Firebase indisponível:', e.message);
      mostrarToast('⚠ Não foi possível salvar a pauta no Firebase', 'aviso');
    });
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao processar o PDF: ' + e.message, 'erro');
  }
}



function normalizarItem(it) {
  return {
    ...it,
    // Respeita uma chave já definida pelo parser (ex.: requerimento s/nº, cuja
    // identidade deriva do projeto urgenciado); senão usa a chave padrão.
    chave: it.chave || `${it.sigla}-${it.numero}-${it.ano}`,
    enriquecimento: { status: 'pendente' }, // pendente | carregando | ok | erro
    analise:        null,
    analiseStatus:  'sem_analise',           // sem_analise | gerando | ok | erro
  };
}

function gerarIdPauta(periodo, fileName) {
  const semId = (periodo || fileName || 'pauta').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return semId || 'pauta-' + Date.now();
}

// ============================================================
//  RENDER
// ============================================================
function renderizarPauta() {
  // Descarta seleções de chaves que não existem mais (troca de pauta, remoção).
  const chavesAtuais = new Set(state.pauta.itens.map(it => it.chave));
  for (const k of state.selecionados) if (!chavesAtuais.has(k)) state.selecionados.delete(k);

  document.getElementById('pauta-titulo').textContent = state.pauta.nome || state.pauta.titulo;
  document.getElementById('btn-renomear-pauta').style.display = '';   // pauta carregada → permite renomear
  document.getElementById('pauta-meta').textContent =
    `${state.pauta.itens.length} itens · carregada em ${formatDataHora(state.pauta.uploadedAt)}`;

  const cont = document.getElementById('lista-itens');
  cont.innerHTML = '';

  // Barra de seleção para o PDF (vazio = exporta todos).
  cont.insertAdjacentHTML('beforeend', `
    <div class="an-selbar">
      <span class="an-selbar-info" id="an-selbar-info"></span>
      <button class="btn btn-ghost btn-sm" id="an-sel-todos">Selecionar todos</button>
      <button class="btn btn-ghost btn-sm" id="an-sel-limpar">Limpar seleção</button>
    </div>`);
  cont.querySelector('#an-sel-todos').addEventListener('click', () => {
    state.pauta.itens.forEach(it => state.selecionados.add(it.chave));
    document.querySelectorAll('.an-card').forEach(c => { const cb = c.querySelector('[data-role=sel-pdf]'); if (cb) { cb.checked = true; c.classList.add('sel-on'); } });
    atualizarSelecaoPdf();
  });
  cont.querySelector('#an-sel-limpar').addEventListener('click', () => {
    state.selecionados.clear();
    document.querySelectorAll('.an-card').forEach(c => { const cb = c.querySelector('[data-role=sel-pdf]'); if (cb) { cb.checked = false; c.classList.remove('sel-on'); } });
    atualizarSelecaoPdf();
  });

  // Seções, na ordem em que constam na pauta
  const rfs  = state.pauta.itens.filter(i => i.tipoCategoria === 'redacao_final');
  const reqs = state.pauta.itens.filter(i => i.tipoCategoria === 'requerimento');
  const projs = state.pauta.itens.filter(i => i.tipoCategoria === 'projeto');

  if (rfs.length) {
    cont.insertAdjacentHTML('beforeend', `<h2 class="an-secao-titulo">Redações Finais (${rfs.length})</h2>`);
    rfs.forEach(it => cont.appendChild(renderCard(it)));
  }
  if (reqs.length) {
    cont.insertAdjacentHTML('beforeend', `<h2 class="an-secao-titulo">Requerimentos de Urgência (${reqs.length})</h2>`);
    reqs.forEach(it => cont.appendChild(renderCard(it)));
  }
  if (projs.length) {
    cont.insertAdjacentHTML('beforeend', `<h2 class="an-secao-titulo">Projetos em Discussão (${projs.length})</h2>`);
    projs.forEach(it => cont.appendChild(renderCard(it)));
  }
  atualizarSelecaoPdf();
}

// ---------- Renomear a pauta (nome editável, não-destrutivo) ----------
let _renameCancel = false;

function abrirRenomearPauta() {
  if (!state.pauta) return;
  const input = document.getElementById('pauta-rename-input');
  input.value = state.pauta.nome || state.pauta.titulo || '';
  document.getElementById('pauta-titulo').style.display = 'none';
  document.getElementById('btn-renomear-pauta').style.display = 'none';
  input.style.display = '';
  input.focus();
  input.select();
}

function fecharRenomearPauta() {
  document.getElementById('pauta-rename-input').style.display = 'none';
  document.getElementById('pauta-titulo').style.display = '';
  document.getElementById('btn-renomear-pauta').style.display = '';
}

async function salvarRenomearPauta() {
  if (!state.pauta) { fecharRenomearPauta(); return; }
  const novo = (document.getElementById('pauta-rename-input').value || '').trim();
  const atual = state.pauta.nome || state.pauta.titulo || '';
  if (novo && novo !== atual) {
    state.pauta.nome = novo;
    document.getElementById('pauta-titulo').textContent = novo;
    marcarSujo();
    try { await fbSalvarPauta(state.pauta); mostrarToast('Pauta renomeada.', 'sucesso'); }
    catch (e) { mostrarToast('Erro ao salvar o nome: ' + e.message, 'erro'); }
    atualizarSidebarPautas();
    state.historico.indice = null;   // invalida o cache da busca no histórico
  }
  fecharRenomearPauta();
}

// Atualiza o contador da barra de seleção e o rótulo do botão Exportar PDF.
// Seleção vazia = todos os itens entram no PDF (comportamento padrão).
function atualizarSelecaoPdf() {
  const n = state.selecionados.size;
  const total = state.pauta?.itens?.length || 0;
  const info = document.getElementById('an-selbar-info');
  if (info) {
    info.innerHTML = n
      ? `<b>${n}</b> de ${total} item(ns) selecionado(s) para o PDF`
      : `Nenhum item marcado — o PDF inclui <b>todos</b> os ${total}. Marque itens para exportar só eles.`;
  }
  const btn = document.getElementById('btn-exportar-pdf');
  if (btn) btn.lastChild.textContent = n ? ` Exportar PDF (${n})` : ' Exportar PDF';
}

function renderCard(it) {
  const isRF = it.tipoCategoria === 'redacao_final';
  const card = document.createElement('div');
  card.className = 'an-card';
  card.dataset.chave = it.chave;
  card.innerHTML = `
    <div class="an-card-head">
      <label class="an-card-sel" title="Incluir este item no PDF"><input type="checkbox" data-role="sel-pdf"></label>
      <div class="an-card-num">${it.ordem ?? '–'}</div>
      <div class="an-card-info">
        <div class="an-card-tipo">${tipoLabel(it.sigla)} ${it.numero}/${it.ano}${isRF ? ' · Redação Final' : ''}</div>
        <div class="an-card-ementa">${escapeHtml(it.ementa)}</div>
        <div class="an-card-meta">
          <span data-role="autor-linha">${(it.autorTexto || (it.enriquecimento?.autores || []).length) ? `<b>Autor:</b> ${htmlAutorRealcado(it)}` : ''}</span>
          ${it.relator ? `<span><b>Relator:</b> Dep. ${escapeHtml(it.relator.nome)} (${it.relator.partido}-${it.relator.uf}) — ${it.relator.data}</span>` : ''}
          ${it.projetoUrgenciado ? `<span><b>Urgência p/ </b> ${it.projetoUrgenciado.sigla} ${it.projetoUrgenciado.numero}/${it.projetoUrgenciado.ano}</span>` : ''}
        </div>
        <div class="an-badges" data-rolebadges>
          ${it.temUrgencia ? `<span class="an-badge an-badge--urg">Urgência aprovada</span>` : ''}
          <span class="an-badge an-badge--neutro" data-role="autoria-flag">Verificando autoria...</span>
        </div>
      </div>
    </div>
    <div class="an-card-actions">
      <button class="btn btn-primary btn-sm" data-role="btn-gerar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18a1 1 0 0 0-2 0v1.93A8 8 0 0 1 4.07 13H6a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V6a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H18a1 1 0 0 0 0 2h1.93A8 8 0 0 1 13 19.93z"/></svg>
        Gerar Análise
      </button>
      <button class="btn btn-outline btn-sm" data-role="btn-toggle" style="display:none">Ver análise</button>
      <button class="btn btn-outline btn-sm" data-role="btn-vincular" style="display:none" title="Vincular manualmente o projeto cuja urgência é pedida (útil quando a API da Câmara não resolveu)">🔗 Vincular projeto</button>
      <a class="btn btn-outline btn-sm" data-role="link-portal" target="_blank" rel="noopener" style="display:none" title="Abrir página da proposição na Câmara dos Deputados">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Ver no portal
      </a>
      <label class="an-analista-label" title="Nome do(a) analista responsável pela nota — salvo com a análise e exibido no PDF">Responsável:
        <input type="text" class="an-analista-input" data-role="inp-analista" placeholder="nome do servidor">
      </label>
      <span class="an-analista-ok" data-role="analista-ok" title="Analista salvo">✓</span>
      <button class="btn btn-ghost btn-sm" data-role="btn-remover" style="margin-left:auto;color:#ff8e8e" title="Remover item da pauta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        Remover
      </button>
    </div>
    <div class="an-analise" data-role="painel-analise">
      <div class="an-analise-head">
        <span class="an-analise-meta" data-role="analise-meta"></span>
        <button class="btn btn-outline btn-sm" data-role="btn-completar" style="display:none;color:#ffcc66" title="A análise foi truncada por limite de tokens — clique para continuar">Completar</button>
        <button class="btn btn-outline btn-sm" data-role="btn-editar">Editar</button>
        <button class="btn btn-primary btn-sm" data-role="btn-salvar-edicao" style="display:none">Salvar</button>
        <button class="btn btn-ghost btn-sm"   data-role="btn-cancelar-edicao" style="display:none">Cancelar</button>
        <span class="an-autosave-status" data-role="autosave-status" style="display:none;font-size:11px;color:#888;margin-left:6px"></span>
        <button class="btn btn-outline btn-sm" data-role="btn-reanalisar" title="Reanalisar aplicando um prompt personalizado da biblioteca">Reanalisar com IA</button>
        <button class="btn btn-outline btn-sm" data-role="btn-verificar-item" style="display:none" title="Reconsulta a tramitação e indica se o texto operativo (parecer/substitutivo/subemenda/emenda do Senado) foi superado por um documento mais recente">Verificar atualização</button>
        <button class="btn btn-outline btn-sm" data-role="btn-perguntar" title="Tirar dúvidas sobre a matéria com o Revisor (IA), com base na nota e nos documentos">💬 Pergunte ao Revisor</button>
        <button class="btn btn-outline btn-sm" data-role="btn-regerar">Regerar</button>
      </div>
      <div class="an-apelido-row" data-role="apelido-row" style="display:none">
        <label title="Descrição curta da matéria usada no índice, no PDF e nos botões de WhatsApp. Gerado por IA — edite se estiver impreciso.">Apelido</label>
        <input type="text" class="an-apelido-input" data-role="inp-apelido" placeholder="apelido curto da matéria (índice, PDF e WhatsApp)" maxlength="140">
        <span class="an-analista-ok" data-role="apelido-ok" title="Apelido salvo">✓</span>
      </div>
      <div class="an-analise-conteudo" data-role="analise-conteudo"></div>
      <div class="an-quill-wrap" data-role="quill-wrap" style="display:none">
        <div data-role="quill-editor"></div>
      </div>
      <div class="an-chat" data-role="chat-panel" style="display:none">
        <div class="an-chat-info">
          <span>Respostas com base na <b>nota</b> e nos <b>documentos da matéria</b> — confira sempre nos textos oficiais.</span>
          <span class="an-chat-acoes">
            <label class="an-chat-web" title="Permite ao Revisor consultar a internet (depende do modelo configurado; custo extra por busca)"><input type="checkbox" data-role="chat-web"> 🌐 acesso à internet</label>
            <button type="button" class="an-chat-limpar" data-role="chat-docs" title="Incluir no Revisor documentos da proposição que não entraram na nota">📎 Incluir mais documentos</button>
            <button type="button" class="an-chat-limpar" data-role="chat-limpar">Limpar</button>
          </span>
        </div>
        <div class="an-chat-extras" data-role="chat-extras" style="display:none"></div>
        <div class="an-chat-docs" data-role="chat-docs-panel" style="display:none"></div>
        <div class="an-chat-msgs" data-role="chat-msgs"></div>
        <div class="an-chat-input">
          <textarea class="an-chat-q" data-role="chat-q" rows="2" placeholder="Pergunte algo sobre a matéria… (Enter envia, Shift+Enter quebra linha)"></textarea>
          <button class="btn btn-primary btn-sm" data-role="chat-enviar">Enviar</button>
        </div>
      </div>
    </div>
  `;

  // MPV (Cenário 8): a análise é de texto livre — o botão abre o editor em
  // branco em vez de acionar a IA.
  const btnGerar = card.querySelector('[data-role=btn-gerar]');
  if (ehMPV(it)) {
    btnGerar.innerHTML = `${iconeEditar()} Escrever análise`;
    btnGerar.title = 'Medida Provisória — escreva a nota livremente (sem IA)';
    btnGerar.addEventListener('click', () => iniciarAnaliseLivreMPV(it));
  } else {
    btnGerar.addEventListener('click', () => gerarAnaliseItem(it));
  }
  card.querySelector('[data-role=btn-regerar]').addEventListener('click', () => gerarAnaliseItem(it, true));
  card.querySelector('[data-role=btn-reanalisar]').addEventListener('click', () => abrirModalReanalise(it));
  card.querySelector('[data-role=btn-verificar-item]').addEventListener('click', () => verificarAtualizacaoItemUI(it));
  card.querySelector('[data-role=btn-toggle]').addEventListener('click', () => {
    const painel = card.querySelector('[data-role=painel-analise]');
    painel.classList.toggle('aberto');
  });
  card.querySelector('[data-role=btn-remover]').addEventListener('click', () => abrirModalRemover(it));
  // Vínculo manual do projeto da urgência — só faz sentido para requerimentos.
  const btnVinc = card.querySelector('[data-role=btn-vincular]');
  if (it.tipoCategoria === 'requerimento') btnVinc.style.display = 'inline-flex';
  btnVinc.addEventListener('click', () => abrirVincularProjeto(it));
  card.querySelector('[data-role=btn-editar]').addEventListener('click', () => entrarEdicaoAnalise(it));
  card.querySelector('[data-role=btn-salvar-edicao]').addEventListener('click', () => salvarEdicaoAnalise(it));
  card.querySelector('[data-role=btn-cancelar-edicao]').addEventListener('click', () => sairEdicaoAnalise(it));
  card.querySelector('[data-role=btn-completar]').addEventListener('click', () => completarAnalise(it));

  // Analista responsável (campo livre ao lado de "Ver no portal"). Persiste no
  // documento da análise (quando existe) e no item da pauta. O "✓" pisca ao salvar.
  const inpAnalista = card.querySelector('[data-role=inp-analista]');
  const okAnalista  = card.querySelector('[data-role=analista-ok]');
  inpAnalista.value = it.analista || it.analise?.analista || '';
  inpAnalista.addEventListener('change', () => {
    const v = inpAnalista.value.trim();
    it.analista = v;
    if (it.analise) {
      it.analise.analista = v;
      fbSalvarAnalise(it)
        .then(() => { okAnalista.classList.add('show'); setTimeout(() => okAnalista.classList.remove('show'), 1500); })
        .catch(e => console.warn('Falha ao salvar analista:', e.message));
    }
    marcarSujo();
  });

  // Apelido da matéria (gerado por IA, editável). É a descrição curta usada no
  // índice, no PDF e nos botões de WhatsApp. Persiste na nota (it.analise.apelido)
  // e no item da sessão (it.apelido). O "✓" pisca ao salvar.
  const inpApelido = card.querySelector('[data-role=inp-apelido]');
  const okApelido  = card.querySelector('[data-role=apelido-ok]');
  inpApelido.addEventListener('change', () => {
    const v = inpApelido.value.trim();
    it.apelido = v;
    if (it.analise) {
      it.analise.apelido = v;
      fbSalvarAnalise(it)
        .then(() => { okApelido.classList.add('show'); setTimeout(() => okApelido.classList.remove('show'), 1500); })
        .catch(e => console.warn('Falha ao salvar apelido:', e.message));
    }
    marcarSujo();
  });

  // O editor visual (Quill) é criado sob demanda em entrarEdicaoAnalise().

  // Chat "Perguntar à IA"
  card.querySelector('[data-role=btn-perguntar]').addEventListener('click', () => togglePerguntarIA(it));
  card.querySelector('[data-role=chat-enviar]').addEventListener('click', () => enviarPerguntaIA(it));
  card.querySelector('[data-role=chat-limpar]').addEventListener('click', () => limparChat(it));
  card.querySelector('[data-role=chat-docs]').addEventListener('click', () => toggleSeletorDocs(it));
  card.querySelector('[data-role=chat-web]').addEventListener('change', e => { (it._chat = it._chat || { mensagens: [], contexto: null }).web = e.target.checked; });
  card.querySelector('[data-role=chat-q]').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarPerguntaIA(it); }
  });

  // Seleção para o PDF (vazio = todos). Reflete o estado e atualiza o contador.
  const selPdf = card.querySelector('[data-role=sel-pdf]');
  selPdf.checked = state.selecionados.has(it.chave);
  card.classList.toggle('sel-on', selPdf.checked);
  selPdf.addEventListener('change', () => {
    if (selPdf.checked) state.selecionados.add(it.chave);
    else state.selecionados.delete(it.chave);
    card.classList.toggle('sel-on', selPdf.checked);
    atualizarSelecaoPdf();
  });
  return card;
}

function atualizarLinkPortal(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const link = card.querySelector('[data-role=link-portal]');
  const id = it.enriquecimento?.idProposicao;
  if (!link || !id) return;
  link.href = `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${id}`;
  link.style.display = 'inline-flex';
}

function tipoLabel(sigla) {
  return ({ PL: 'PL', PLP: 'PLP', PEC: 'PEC', PDL: 'PDL', MPV: 'MPV', PRC: 'PRC', REQ: 'REQ' })[sigla] || sigla;
}

// Medida Provisória: Cenário 8 — análise de texto livre (escrita manual pelo
// analista, sem IA e sem estrutura de seções imposta).
const CENARIO_MPV = 'Cenário 8 — Medida Provisória (edição livre)';
function ehMPV(it) {
  return it.tipoCategoria === 'projeto' && it.sigla === 'MPV';
}

// Projeto de Decreto Legislativo — Cenário 10. O texto votado é o próprio
// decreto (inteiro teor + justificação); a comissão dá a recomendação. (PDC é
// a nomenclatura antiga do PDL e aparece no dashboard compacto.)
function ehPDL(it) {
  return it.tipoCategoria === 'projeto' && (it.sigla === 'PDL' || it.sigla === 'PDC');
}
// Subtipo do PDL, derivado da ementa, para ajustar a ênfase da nota técnica.
function subtipoPDL(it) {
  const e = (it.ementa || '').toLowerCase();
  if (/\bsust[ae]|sustaç|susta\s+os\s+efeitos/.test(e)) return 'sustacao';
  if (/acordo|tratado|conven[çc][ãa]o|protocolo|ato\s+internacional/.test(e)) return 'tratado';
  if (/outorg|concess|permiss|radiodifus|retransmiss|r[áa]dio|televis/.test(e)) return 'outorga';
  return 'generico';
}

// ============================================================
//  ENRIQUECIMENTO VIA API CÂMARA
//  Para cada item: resolve idProposicao → autores (autoria Podemos?)
//  → relacionadas (apensados, marcar quais são do Podemos)
//  → tramitações (URL do último parecer do relator).
// ============================================================
async function enriquecerItens() {
  for (const it of state.pauta.itens) {
    enriquecerItem(it).catch(e => {
      const msg = e?.message || String(e);
      console.warn(
        `Enriquecimento falhou para ${it.chave} (${it.sigla} ${it.numero}/${it.ano}): ${msg}`,
        '\n', e?.stack || ''
      );
      it.enriquecimento = { status: 'erro', erro: msg };
      atualizarBadgesCard(it);
    });
  }
}

async function enriquecerItem(it) {
  it.enriquecimento = { status: 'carregando' };
  atualizarBadgesCard(it);

  // Para requerimentos, o "projeto alvo" é o projeto cuja urgência é pedida.
  // Usamos esse projeto como base para autoria e apensados.
  const alvo = it.tipoCategoria === 'requerimento' && it.projetoUrgenciado
    ? it.projetoUrgenciado
    : { sigla: it.sigla, numero: it.numero, ano: it.ano };

  if (alvo.sigla === 'REQ') {
    // Requerimento sem projeto identificado — pula
    it.enriquecimento = { status: 'ok', semProjeto: true };
    atualizarBadgesCard(it);
    return;
  }

  // Rastreia a etapa atual para que uma falha aponte exatamente onde ocorreu.
  // prop é declarado FORA do try para continuar acessível nas buscas de parecer
  // de plenário / redação final mais abaixo.
  let etapa = 'resolveProposicao';
  let prop;
  try {
    prop = await resolveProposicao(alvo.sigla, alvo.numero, alvo.ano);
    it.enriquecimento.idProposicao = prop.id;
    it.enriquecimento.urlInteiroTeor = prop.urlInteiroTeor;
    // Para requerimento de urgência, guarda a ementa do PROJETO-ALVO no
    // projetoUrgenciado. Sem isso, o apelido era gerado a partir do texto do
    // próprio requerimento ("Requeiro urgência…") — daí o apelido errado.
    if (it.tipoCategoria === 'requerimento' && it.projetoUrgenciado && prop.ementa) {
      it.projetoUrgenciado.ementa = prop.ementa;
    }
    atualizarLinkPortal(it);

    // Autoria principal
    etapa = 'autores';
    const autores = await fetchAutoresProposicao(prop.id);
    it.enriquecimento.autores = autores;
    const podeAut = autores.filter(a => a.isPodemos);
    it.enriquecimento.autoriaPodemos = podeAut.length > 0;
    // Distingue autor principal (1º signatário, ordemAssinatura = 1) de coautor
    // (assina depois). Sem info de ordem (dados antigos), mantém o comportamento
    // antigo (autor).
    const temOrdem = autores.some(a => Number.isFinite(Number(a.ordem)));
    it.enriquecimento.autoriaPrincipalPodemos = temOrdem
      ? podeAut.some(a => Number(a.ordem) === 1)
      : podeAut.length > 0;

    // Apensados via API
    etapa = 'apensados';
    const apensados = await resolverApensados(prop.id);
    it.enriquecimento.apensados = apensados;
    it.enriquecimento.apensadosPodemos = apensados.filter(ap => ap.autoriaPodemos);
  } catch (e) {
    // Anexa a etapa e a proposição-alvo à mensagem, sem perder o stack original.
    e.message = `[${etapa}] ${alvo.sigla} ${alvo.numero}/${alvo.ano}: ${e.message}`;
    throw e;
  }

  // URLs do(s) parecer(es) do relator de Plenário (para projetos)
  if (it.tipoCategoria === 'projeto') {
    try {
      it.enriquecimento.pareceresPlenario = await buscarPareceresPlenario(prop.id);
    } catch (e) {
      console.warn('Não encontrou pareceres de plenário:', e.message);
      it.enriquecimento.pareceresPlenario = { comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null, prlEspecial: null, sbtAEspecial: null };
    }
  }

  // Documento da Redação Final (para itens dessa categoria)
  if (it.tipoCategoria === 'redacao_final') {
    try {
      it.enriquecimento.urlRedacaoFinal = await buscarRedacaoFinal(prop.id);
    } catch (e) {
      console.warn('Não encontrou Redação Final:', e.message);
      it.enriquecimento.urlRedacaoFinal = null;
    }
  }

  it.enriquecimento.status = 'ok';
  atualizarBadgesCard(it);
}

const cacheProp = state.cacheProposicao;
// Cache de detalhes de proposição (GET /proposicoes/{id}) reusado na detecção de
// apensados (cadeia de uriPropPrincipal) e no inteiro teor dos apensados.
const cacheDetalheProp = new Map();

// Siglas equivalentes na API da Câmara (nomenclatura antiga × atual): os
// decretos legislativos aparecem como PDC (antiga) ou PDL (atual) conforme a
// época, então tentamos ambas antes de desistir.
const SIGLAS_EQUIVALENTES = { PDL: ['PDL', 'PDC'], PDC: ['PDC', 'PDL'] };

async function resolveProposicao(sigla, numero, ano) {
  const ck = `${sigla}-${numero}-${ano}`;
  if (cacheProp.has(ck)) return cacheProp.get(ck);

  const tentativas = SIGLAS_EQUIVALENTES[sigla] || [sigla];
  let hit = null;
  for (const s of tentativas) {
    const url = `${API_BASE}/proposicoes?siglaTipo=${encodeURIComponent(s)}&numero=${numero}&ano=${ano}`;
    const json = await fetchJson(url);
    hit = (json.dados || [])[0];
    if (hit) break;
  }
  if (!hit) throw new Error(`Proposição ${sigla} ${numero}/${ano} não encontrada na API.`);

  // Busca detalhe para pegar urlInteiroTeor e a ementa (usada no apelido do alvo)
  const det = await fetchJson(`${API_BASE}/proposicoes/${hit.id}`);
  const obj = {
    id:             hit.id,
    ementa:         det.dados?.ementa || hit.ementa || '',
    urlInteiroTeor: det.dados?.urlInteiroTeor || null,
  };
  cacheProp.set(ck, obj);
  return obj;
}

async function fetchAutoresProposicao(idProp) {
  const json = await fetchJson(`${API_BASE}/proposicoes/${idProp}/autores`);
  const autores = json.dados || [];

  // Para autores que são deputados, busca partido atual
  const out = [];
  for (const a of autores) {
    const m = (a.uri || '').match(/\/deputados\/(\d+)/);
    if (m) {
      const idDep = m[1];
      const info  = await fetchInfoDeputado(idDep);
      out.push({
        idDeputado: idDep,
        nome:       a.nome || info?.nome,
        siglaPartido: info?.siglaPartido,
        siglaUf:    info?.siglaUf,
        tipo:       a.tipo,
        ordem:      a.ordemAssinatura,   // 1 = 1º signatário (autor principal); >1 = coautor
        proponente: a.proponente,
        isPodemos:  (info?.siglaPartido === SIGLA_PODEMOS),
      });
    } else {
      out.push({ nome: a.nome, tipo: a.tipo, ordem: a.ordemAssinatura, proponente: a.proponente, isPodemos: false });
    }
  }
  return out;
}

async function fetchInfoDeputado(idDep) {
  if (state.cacheAutoria.has(idDep)) return state.cacheAutoria.get(idDep);
  try {
    const json = await fetchJson(`${API_BASE}/deputados/${idDep}`);
    const us   = json.dados?.ultimoStatus || {};
    const info = {
      nome:        us.nome || json.dados?.nomeCivil,
      siglaPartido: us.siglaPartido,
      siglaUf:     us.siglaUf,
    };
    state.cacheAutoria.set(idDep, info);
    return info;
  } catch (e) {
    state.cacheAutoria.set(idDep, null);
    return null;
  }
}

async function fetchApensados(idProp) {
  const json = await fetchJson(`${API_BASE}/proposicoes/${idProp}/relacionadas`);
  const relacionadas = json.dados || [];
  if (!relacionadas.length) return [];

  // O endpoint /relacionadas nem sempre traz o tipo de relação (descricaoRelacao
  // costuma vir vazia), então não dá para filtrar apensamento por texto. A marca
  // confiável está no DETALHE de cada proposição: situação "Tramitando em
  // Conjunto" + uriPropPrincipal apontando para a cadeia de apensamento. Como o
  // apensamento pode ser em cadeia (A apensada a B, B apensada à principal),
  // resolvemos a RAIZ de cada candidata seguindo uriPropPrincipal até o topo e
  // só consideramos apensadas as que compartilham a mesma raiz da nossa matéria.
  const idDaUri = uri => uri ? Number(String(uri).split('/').pop()) : null;
  const detalhe = async (id) => {
    if (cacheDetalheProp.has(id)) return cacheDetalheProp.get(id);
    let d = null;
    try { d = (await fetchJson(`${API_BASE}/proposicoes/${id}`)).dados || null; }
    catch (e) { d = null; }
    cacheDetalheProp.set(id, d);
    return d;
  };
  const raiz = async (id, depth = 0) => {
    if (depth > 6) return id;
    const pai = idDaUri((await detalhe(id))?.uriPropPrincipal);
    return pai ? raiz(pai, depth + 1) : id;
  };

  const raizAlvo = await raiz(Number(idProp));
  const apensados = [];
  for (const r of relacionadas) {
    const d = await detalhe(r.id);
    if (!d) continue;
    const sit = ((d.statusProposicao || {}).descricaoSituacao || '').toLowerCase();
    const temPrincipal = !!d.uriPropPrincipal;
    if (!temPrincipal && !sit.includes('conjunto') && !sit.includes('apens')) continue;
    if (await raiz(r.id) !== raizAlvo) continue;   // pertence a outra cadeia
    apensados.push({
      id:             r.id,
      siglaTipo:      r.siglaTipo,
      numero:         r.numero,
      ano:            r.ano,
      ementa:         r.ementa || d.ementa,
      urlInteiroTeor: d.urlInteiroTeor || null,
    });
  }
  return apensados;
}

// Resolve os apensados de uma proposição já com a autoria de cada um (para
// marcar quais são do Podemos). Usado pelo enriquecimento e, sob demanda, por
// escolherDocumentos — assim o resumo do apensado sai mesmo que a nota seja
// gerada antes de o enriquecimento assíncrono terminar.
async function resolverApensados(idProp) {
  const apensados = await fetchApensados(idProp);
  for (const ap of apensados) {
    try {
      const aps = await fetchAutoresProposicao(ap.id);
      ap.autores = aps;
      ap.autoriaPodemos = aps.some(a => a.isPodemos);
    } catch (e) {
      ap.autoriaPodemos = false;
    }
  }
  return apensados;
}

/**
 * Busca os pareceres do Relator de Plenário (PRLP e PRLE) da proposição.
 * Faz scraping da página "Histórico de Pareceres, Substitutivos e Votos"
 * (prop_pareceres_substitutivos_votos) — fonte canônica que lista PRLP /
 * PRLE explicitamente, ao contrário do endpoint /tramitacoes da API REST.
 */
// Considera válida a resposta se parece a página real da Câmara (e não uma
// página de erro/JSON que um proxy possa devolver com HTTP 200).
function _htmlCamaraValido(html) {
  if (!html || html.length < 500) return false;
  return html.includes('proposicoesWeb')
      || html.includes('prop_mostrarintegra')
      || html.includes('filename=')
      || /<!doctype html|<html[\s>]/i.test(html.slice(0, 600));
}

// Baixa o HTML de uma página do portal da Câmara. As páginas proposicoesWeb
// nem sempre enviam cabeçalhos CORS, então o fetch direto pode falhar — nesse
// caso tentamos o codetabs e, por fim, o worker próprio (como os demais
// módulos do app). Retorna o HTML válido ou null se todas as vias falharem.
async function fetchHtmlCamara(url) {
  const vias = [
    ['direto',   () => fetch(url, { redirect: 'follow' })],
    ['codetabs', () => fetch('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url))],
    ['worker',   () => fetch('https://shrill-resonance-4d17.vinicius-const.workers.dev/?url=' + encodeURIComponent(url))],
  ];
  for (const [nome, tentar] of vias) {
    try {
      const r = await tentar();
      const html = r.ok ? await r.text() : '';
      if (r.ok && _htmlCamaraValido(html)) return html;
      console.debug(`[análise] página Câmara via ${nome}: status=${r.status} len=${html.length} (inválido)`);
    } catch (e) {
      console.debug(`[análise] página Câmara via ${nome}: erro ${e.message}`);
    }
  }
  console.warn('[análise] não foi possível obter a página da Câmara (direto, codetabs e worker):', url);
  return null;
}

async function buscarPareceresPlenario(idProp) {
  const base = 'https://www.camara.leg.br/proposicoesWeb/';
  const html = await fetchHtmlCamara(`${base}prop_pareceres_substitutivos_votos?idProposicao=${idProp}`);
  if (!html) return { comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null, prlEspecial: null, sbtAEspecial: null };

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidatos = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 3) continue;

    // 1ª coluna: sigla — ex.: "PRLP 3 => PL 699/2023", "SBT-A 1 CCJC => PL .../...",
    // "AA 1 MESA => PL .../..." (AA = Autógrafo, texto aprovado pela Câmara),
    // "PAR 1 CCJC" (parecer da comissão), "PRL 6 CCJC" (parecer do relator de
    // comissão). SBT-A = substitutivo adotado por comissão (cenários 2 e 4).
    const siglaCellTxt = (tds[0].textContent || '').trim().replace(/\s+/g, ' ');
    const siglaMatch = siglaCellTxt.match(/^(SBT-A|PRLP|PRLE|AA|PAR|PRL)\s+(\d+)(?:\s+([A-Za-zÀ-Ú0-9]+))?/i);
    if (!siglaMatch) continue;

    // Procura coluna com data dd/mm/yyyy em qualquer célula (geralmente a 3ª)
    let dataBR = null;
    for (const td of tds) {
      const m = (td.textContent || '').match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
      if (m) { dataBR = m[1]; break; }
    }

    // Link para inteiro teor — em qualquer célula
    const a = tr.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
    let linkUrl = a ? a.getAttribute('href') : null;
    if (!linkUrl || linkUrl.startsWith('javascript:')) continue;
    // Resolve URLs relativas (href pode vir como "prop_mostrarintegra?..." ou
    // "../proposicoesWeb/...") usando a URL da página como base.
    try { linkUrl = new URL(linkUrl, base).toString(); } catch (_) { continue; }

    // Sigla do colegiado/comissão (ex.: CCJC, CSPCCO) quando for uma sigla de
    // letras (não o próprio tipo da proposição, ex.: "PEC00619", nem "MESA").
    const dono = (siglaMatch[3] || '').toUpperCase();
    const comissao = /^[A-ZÀ-Ú]{2,12}$/.test(dono) && !/^(PL|PLP|PEC|PDL|PDC|MPV|PRC|REQ|MESA)$/.test(dono) ? dono : null;
    // Comissão Especial: a sigla-dona é o código compacto da própria proposição
    // (ex.: "PEC00619" = PEC 6/2019; "PL629902" = PL 6299/2002; "PL233823" =
    // PL 2338/2023). Ocorre em PECs (onde é o parecer de mérito operativo) e em
    // certos PLs/PLPs (onde é mais uma etapa, ao lado do parecer de plenário).
    const especial = /^(PEC|PLP|PL)\d{3,}$/.test(dono);

    candidatos.push({
      sigla:      siglaMatch[1].toUpperCase(),
      sequencial: parseInt(siglaMatch[2], 10),
      comissao,
      especial,
      dataBR,
      data:       dataBR ? dataBR.split('/').reverse().join('-') : null,
      url:        linkUrl,
    });
  }

  // Mais recente primeiro (por data, depois por sequencial como desempate)
  candidatos.sort((a, b) =>
    (b.data || '').localeCompare(a.data || '') ||
    ((b.sequencial || 0) - (a.sequencial || 0))
  );

  // Um parecer por comissão por onde a proposição tramitou: usa o PRL (parecer
  // do relator) mais recente; só recorre ao PAR quando a comissão não tiver
  // nenhum PRL. candidatos já está em ordem decrescente de data.
  const porComissao = new Map();
  for (const c of candidatos) {
    if (c.sigla !== 'PAR' && c.sigla !== 'PRL') continue;
    // Comissões permanentes (sigla de letras) e a Comissão Especial (sigla =
    // código compacto da proposição). A Especial entra sob uma chave própria.
    const chave = c.comissao || (c.especial ? '__especial__' : null);
    if (!chave) continue;
    const prev = porComissao.get(chave);
    if (!prev || (c.sigla === 'PRL' && prev.sigla !== 'PRL')) {
      porComissao.set(chave, { ...c, comissao: c.comissao || 'Comissão Especial', especial: !!c.especial });
    }
  }
  const comissoes = Array.from(porComissao.values())
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  return {
    comissoes,
    prlp:        candidatos.find(c => c.sigla === 'PRLP')  || null,
    prle:        candidatos.find(c => c.sigla === 'PRLE')  || null,
    sbtA:        candidatos.find(c => c.sigla === 'SBT-A') || null,
    autografo:   candidatos.find(c => c.sigla === 'AA')    || null,
    // Último PRL (parecer do relator) da Comissão Especial — operativo p/ PECs.
    prlEspecial:  candidatos.find(c => c.sigla === 'PRL'   && c.especial) || null,
    // Substitutivo adotado pela Comissão Especial (texto consolidado da PEC).
    sbtAEspecial: candidatos.find(c => c.sigla === 'SBT-A' && c.especial) || null,
  };
}

/**
 * Localiza, na página de emendas da proposição, a Emenda/Substitutivo do
 * Senado (EMS — cenários 6/7) e a Subemenda Substitutiva de Plenário (SSP —
 * cenário 5) mais recentes. Retorna { ems, ssp } com a URL do inteiro teor de
 * cada uma (ou null). Varre subst=0 e subst=1 (as emendas podem estar em
 * qualquer das duas listas).
 */
async function buscarEmendasSenadoESSP(idProp) {
  const out = { ems: null, ssp: null };
  if (!idProp) return out;
  const base = 'https://www.camara.leg.br/proposicoesWeb/';
  for (const subst of [0, 1]) {
    const html = await fetchHtmlCamara(`${base}prop_emendas?idProposicao=${idProp}&subst=${subst}`);
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const tr of doc.querySelectorAll('tr')) {
      const a = tr.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
      if (!a) continue;
      let href = a.getAttribute('href');
      if (!href || href.startsWith('javascript:')) continue;
      try { href = new URL(href, base).toString(); } catch (_) { continue; }

      const fn      = decodeURIComponent(href).replace(/\+/g, ' ');
      const rowTxt  = (tr.textContent || '').replace(/\s+/g, ' ');
      const codteor = (href.match(/codteor=(\d+)/i) || [])[1];
      const seq     = codteor ? parseInt(codteor, 10) : 0;
      const dataBR  = (rowTxt.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) || [])[1] || null;

      // EMS: filename "EMS ..." ou linha com "Senado Federal"/"Emenda/Substitutivo do Senado".
      const isEMS = /filename=\s*EMS\b/i.test(fn) || /senado\s+federal/i.test(rowTxt)
                 || /emenda.{0,3}substitutivo\s+do\s+senado/i.test(rowTxt);
      // SSP: filename "SSP ..." ou linha com "Subemenda Substitutiva".
      const isSSP = /filename=\s*SSP\b/i.test(fn) || /subemenda\s+substitutiva/i.test(rowTxt);

      if (isEMS && (!out.ems || seq > out.ems.seq)) out.ems = { url: href, seq, dataBR, data: parseDataBR(dataBR) };
      if (isSSP && (!out.ssp || seq > out.ssp.seq)) out.ssp = { url: href, seq, dataBR, data: parseDataBR(dataBR) };
    }
    if (out.ems && out.ssp) break; // ambos achados — não precisa varrer subst=1
  }
  return out;
}

// ---------- Listagem de TODOS os documentos (para o seletor do Revisor) ----------
// Lista todas as linhas do Histórico de Pareceres (não só as operativas).
async function listarDocsPareceres(idProp) {
  const base = 'https://www.camara.leg.br/proposicoesWeb/';
  const html = await fetchHtmlCamara(`${base}prop_pareceres_substitutivos_votos?idProposicao=${idProp}`);
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 3) continue;
    const m = (tds[0].textContent || '').trim().replace(/\s+/g, ' ')
      .match(/^(SBT-A|PRLP|PRLE|AA|PAR|PRL)\s+(\d+)(?:\s+([A-Za-zÀ-Ú0-9]+))?/i);
    if (!m) continue;
    const a = tr.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
    let href = a ? a.getAttribute('href') : null;
    if (!href || href.startsWith('javascript:')) continue;
    try { href = new URL(href, base).toString(); } catch (_) { continue; }
    let dataBR = null;
    for (const td of tds) { const dm = (td.textContent || '').match(/\b(\d{2}\/\d{2}\/\d{4})\b/); if (dm) { dataBR = dm[1]; break; } }
    const dono = (m[3] || '').toUpperCase();
    const comissao = /^[A-ZÀ-Ú]{2,12}$/.test(dono) && !/^(PL|PLP|PEC|PDL|PDC|MPV|PRC|REQ|MESA)$/.test(dono) ? dono : null;
    const especial = /^(PEC|PLP|PL)\d{3,}$/.test(dono);
    const sigla = m[1].toUpperCase();
    const nome  = sigla === 'AA' ? 'Autógrafo' : sigla;
    const orgao = comissao || (especial ? 'Comissão Especial' : (sigla === 'AA' ? 'Mesa' : 'Plenário'));
    out.push({ rotulo: `${nome} ${m[2]} — ${orgao}${dataBR ? ' · ' + dataBR : ''}`, url: href });
  }
  return out;
}

// Lista todas as emendas (página de emendas, subst=0 e 1).
async function listarEmendas(idProp) {
  const base = 'https://www.camara.leg.br/proposicoesWeb/';
  const out = [], vistos = new Set();
  for (const subst of [0, 1]) {
    const html = await fetchHtmlCamara(`${base}prop_emendas?idProposicao=${idProp}&subst=${subst}`);
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const tr of doc.querySelectorAll('tr')) {
      const a = tr.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
      if (!a) continue;
      let href = a.getAttribute('href');
      if (!href || href.startsWith('javascript:')) continue;
      try { href = new URL(href, base).toString(); } catch (_) { continue; }
      if (vistos.has(href)) continue; vistos.add(href);
      const fn = (() => { try { return decodeURIComponent(href).replace(/\+/g, ' '); } catch (_) { return href; } })();
      const fnm = (fn.match(/filename=([^&;]+)/i) || [])[1] || '';
      const rowTxt = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      const dataBR = (rowTxt.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) || [])[1] || '';
      let rotulo = (fnm.trim() || rowTxt.slice(0, 50))
        .replace(/\.(pdf|docx?|html?)$/i, '')
        .replace(/\s*=>.*$/, '')          // remove "=> PL .../..." do filename
        .trim().slice(0, 70) || 'Emenda';
      out.push({ rotulo: `${rotulo}${dataBR ? ' · ' + dataBR : ''}`, url: href });
    }
  }
  return out;
}

// Agrega os documentos da proposição que NÃO entraram na nota, por fonte.
async function listarDocumentosDisponiveis(it) {
  const enr = it.enriquecimento || {};
  const usados = new Set((it.analise?.documentos || []).map(d => d.url));
  const grupos = { Pareceres: [], Emendas: [], Textos: [] };
  if (enr.urlInteiroTeor)  grupos.Textos.push({ rotulo: 'Inteiro teor da proposição', url: enr.urlInteiroTeor });
  if (enr.urlRedacaoFinal) grupos.Textos.push({ rotulo: 'Redação Final', url: enr.urlRedacaoFinal });
  if (enr.idProposicao) {
    try { grupos.Pareceres = await listarDocsPareceres(enr.idProposicao); } catch (e) { console.warn('listarDocsPareceres:', e.message); }
    try { grupos.Emendas   = await listarEmendas(enr.idProposicao);     } catch (e) { console.warn('listarEmendas:', e.message); }
  }
  // Remove os já usados na nota e duplicatas por URL.
  const vistos = new Set();
  for (const k of Object.keys(grupos)) {
    grupos[k] = grupos[k].filter(d => d.url && !usados.has(d.url) && !vistos.has(d.url) && vistos.add(d.url));
  }
  return grupos;
}

/**
 * Localiza o documento da Redação Final na ficha de tramitação da proposição.
 * Procura na caixa "Documentos Anexos e Referenciados" o link cujo filename
 * começa com "REDACAO FINAL" (ou variação com Ç/cedilha). Retorna a URL
 * absoluta ou null se não encontrar.
 */
async function buscarRedacaoFinal(idProp) {
  const url = `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${idProp}`;
  const html = await fetchHtmlCamara(url);
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidatos = doc.querySelectorAll('a[href*="prop_mostrarintegra"]');
  for (const a of candidatos) {
    const href = a.getAttribute('href') || '';
    // O filename do link costuma vir como "REDACAO FINAL <SIGLA> <NUM>/<ANO>".
    // Casa também variações com Ç/Ã/cedilha e %20 já decodificados.
    const decoded = (() => { try { return decodeURIComponent(href); } catch (_) { return href; } })();
    if (!/filename=\s*REDA[ÇC][ÃA]?O\s+FINAL\b/i.test(decoded)) continue;
    let linkUrl = href;
    if (linkUrl.startsWith('javascript:')) continue;
    try {
      linkUrl = new URL(linkUrl, 'https://www.camara.leg.br/proposicoesWeb/').toString();
    } catch (_) { continue; }
    return linkUrl;
  }
  return null;
}

function parseDataBR(s) {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function atualizarBadgesCard(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const cont = card.querySelector('[data-rolebadges]');
  if (!cont) return;

  const flag = cont.querySelector('[data-role=autoria-flag]');
  // Remove badges de apensados/podemos prévios para recompor
  cont.querySelectorAll('[data-role=badge-extra]').forEach(b => b.remove());

  const enr = it.enriquecimento;
  if (!enr || enr.status === 'pendente' || enr.status === 'carregando') {
    flag.className = 'an-badge an-badge--neutro';
    flag.textContent = enr?.status === 'carregando' ? 'Verificando autoria...' : 'Aguardando verificação';
    return;
  }
  if (enr.status === 'erro') {
    flag.className = 'an-badge an-badge--neutro';
    flag.textContent = 'Autoria: não verificada';
    return;
  }
  if (enr.semProjeto) {
    flag.className = 'an-badge an-badge--neutro';
    flag.textContent = 'Sem projeto associado';
    return;
  }

  if (enr.autoriaPodemos) {
    flag.className = 'an-badge an-badge--pode';
    flag.textContent = `★ ${rotuloAutoriaPodemos(it)} Podemos`;
  } else {
    flag.className = 'an-badge an-badge--neutro';
    flag.textContent = 'Autoria: não-Podemos';
  }

  // Relatoria do Podemos em Plenário (badge azul claro)
  if (relatoriaPodemos(it)) {
    const badge = document.createElement('span');
    badge.className = 'an-badge an-badge--rel';
    badge.dataset.role = 'badge-extra';
    badge.textContent = 'R · Relatoria Podemos em Plenário';
    cont.appendChild(badge);
  }

  // Atualiza a linha "Autor:" com o nome do(s) deputado(s) do Podemos em
  // negrito + sublinhado (o card inicial é renderizado antes do enriquecimento).
  const autorLinha = card.querySelector('[data-role=autor-linha]');
  if (autorLinha && (it.autorTexto || (enr.autores || []).length)) {
    autorLinha.innerHTML = `<b>Autor:</b> ${htmlAutorRealcado(it)}`;
  }

  // Apensados Podemos — com sufixo de acolhimento (status sensível, só na tela)
  const statusAcolh = it.analise?.apensadosStatus || {};
  for (const ap of (enr.apensadosPodemos || [])) {
    const auts = (ap.autores || []).filter(a => a.isPodemos).map(a => a.nome).join(', ');
    const nivel = statusAcolh[`${ap.numero}-${ap.ano}`];
    const badge = document.createElement('span');
    badge.className = 'an-badge an-badge--apens' + (nivel ? ' an-badge--apens-' + nivel.toLowerCase() : '');
    badge.dataset.role = 'badge-extra';
    badge.textContent = `Apensado Podemos: ${ap.siglaTipo} ${ap.numero}/${ap.ano}${auts ? ' — ' + auts : ''}${nivel ? ` (${ACOLHIMENTO_ROTULO[nivel]})` : ''}`;
    cont.appendChild(badge);
  }

  // Badge único de interesse de parlamentares (tema conexo à matéria — laranja)
  const interessados = deputadosComInteresse(it);
  if (interessados.length) {
    const badge = document.createElement('span');
    badge.className = 'an-badge an-badge--interesse';
    badge.dataset.role = 'badge-extra';
    badge.textContent = interessados.length === 1
      ? `Matéria com campo de interesse do parlamentar ${interessados[0]}`
      : `Matéria com campo de interesse dos seguintes parlamentares: ${interessados.join(', ')}`;
    cont.appendChild(badge);
  }

  // Badge de nota possivelmente desatualizada: só aparece após o analista rodar
  // "Verificar atualizações" (sob demanda) — o resultado fica em it.desatualizacao.
  const desat = it.desatualizacao;
  if (desat?.novos?.length) {
    const badge = document.createElement('span');
    badge.className = 'an-badge an-badge--desatual';
    badge.dataset.role = 'badge-extra';
    badge.title = 'Documento(s) mais recente(s) na tramitação: ' +
      desat.novos.map(n => `${n.rotulo}${n.data ? ' de ' + n.data.split('-').reverse().join('/') : ''}`).join('; ') +
      '. Considere regerar a análise.';
    badge.textContent = '⚠ Pode estar desatualizada';
    cont.appendChild(badge);
  }
}

// ============================================================
//  TEMAS DE INTERESSE DOS PARLAMENTARES (badge laranja)
//  Lista de deputados do Podemos vem da API; os temas (por deputado,
//  separados por OR) ficam no Firebase, compartilhados com a equipe.
// ============================================================
async function fbCarregarTemasInteresse() {
  const res = await fetch(`${FIREBASE_URL}/deputados_interesse.json`);
  if (!res.ok) return {};
  const raw = (await res.json()) || {};
  // Normaliza: aceita o formato antigo (string = só temas) e o novo {temas, perfil}.
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    out[id] = (typeof v === 'string') ? { temas: v, perfil: '' } : { temas: v?.temas || '', perfil: v?.perfil || '' };
  }
  return out;
}

async function fbSalvarTemasInteresse(map) {
  const res = await fetch(`${FIREBASE_URL}/deputados_interesse.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(map),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}

// Liga/desliga o marcador de interesse para toda a equipe. Desligado por padrão.
async function fbCarregarInteresseAtivo() {
  try {
    const res = await fetch(`${FIREBASE_URL}/deputados_interesse_ativo.json`);
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch { return false; }
}

async function fbSalvarInteresseAtivo(v) {
  const res = await fetch(`${FIREBASE_URL}/deputados_interesse_ativo.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(!!v),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}

// Deputados a incluir manualmente além da lista ativa da API (ex.: afastados
// do mandato que ainda compõem a bancada e devem retomar).
const DEPUTADOS_EXTRA = [
  { id: '178989', nome: 'Renata Abreu' },   // SP — afastada, retorna em breve
];

async function carregarDeputadosPodemos() {
  const out = [];
  let url = `${API_BASE}/deputados?siglaPartido=${SIGLA_PODEMOS}&ordem=ASC&ordenarPor=nome&itens=100`;
  for (let pag = 0; pag < 5 && url; pag++) {   // segue a paginação (links rel=next)
    const json = await fetchJson(url);
    for (const d of (json.dados || [])) out.push({ id: String(d.id), nome: d.nome });
    url = (json.links || []).find(l => l.rel === 'next')?.href || null;
  }
  // Acrescenta os extras (sem duplicar) e ordena por nome.
  for (const ex of DEPUTADOS_EXTRA) if (!out.some(d => d.id === ex.id)) out.push({ ...ex });
  out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  return out;
}

async function carregarInteresse() {
  const [lista, dados, ativo] = await Promise.all([
    carregarDeputadosPodemos(), fbCarregarTemasInteresse(), fbCarregarInteresseAtivo(),
  ]);
  state.interesse = { lista, dados: dados || {}, ativo: !!ativo, carregado: true };
  atualizarTodosBadgesInteresse();
}

function _normTxt(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Termos de um campo "tema1 OR tema2 OR ..." (também aceita um por linha).
function _termosInteresse(temas) {
  return (temas || '')
    .split(/\s+OR\s+|\r?\n+/i)
    .map(t => _normTxt(t).trim())
    .filter(t => t.length >= 3);
}

// Texto da matéria onde os temas são procurados: ementa + título + nota gerada.
function _textoCasavel(it) {
  const alvo = _alvoItem(it);
  return _normTxt([alvo.ementa, it.ementa, tituloVotacao(it), it.analise?.markdown].filter(Boolean).join('  \n  '));
}

// Casa o termo como "palavra" (com fronteiras), evitando casar dentro de palavras.
function _casaTermo(texto, termo) {
  const esc = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(texto); }
  catch { return texto.includes(termo); }
}

// Peso IDF de cada termo: termo que muitos deputados têm vale pouco (genérico);
// termo distintivo vale muito. Cacheado no objeto de config.
function _pesosIdf(cfg) {
  if (cfg._idf) return cfg._idf;
  const df = new Map();
  let n = 0;
  for (const dep of cfg.lista) {
    const termos = new Set(_termosInteresse(cfg.dados?.[dep.id]?.temas));
    if (!termos.size) continue;
    n++;
    for (const t of termos) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.max(0, Math.log((n || 1) / c)));   // termo presente em todos → peso 0
  cfg._idf = idf;
  return idf;
}

// Fallback por palavras (usado quando não há embeddings — ex.: Anthropic):
// soma dos pesos IDF dos temas que casam no texto (ementa + título + nota).
function deputadosComInteresseKeyword(it) {
  const cfg = state.interesse;
  if (!cfg || !cfg.lista?.length) return [];
  const texto = _textoCasavel(it);
  if (!texto) return [];
  const idf = _pesosIdf(cfg);
  const scored = [];
  for (const dep of cfg.lista) {
    const termos = _termosInteresse(cfg.dados?.[dep.id]?.temas);
    if (!termos.length) continue;
    let score = 0, hits = 0;
    for (const t of termos) if (_casaTermo(texto, t)) { score += (idf.get(t) ?? 0); hits++; }
    if (hits > 0 && score > 0) scored.push({ nome: dep.nome, score });
  }
  scored.sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome, 'pt'));
  return scored.slice(0, 2).map(d => d.nome);
}

// ---------- Similaridade semântica por EMBEDDINGS ----------
const EMB_MODELO = { gemini: 'gemini-embedding-001', openai: 'text-embedding-3-small' };
const INTERESSE_ZMIN = 1.0;   // z-score mínimo (destaque sobre o conjunto) p/ entrar no badge

function embeddingsDisponivel(prov) { return prov === 'gemini' || prov === 'openai'; }
function embModeloTag(prov) { return `${prov}:${EMB_MODELO[prov] || ''}`; }

// Embeda uma lista de textos e devolve os vetores na mesma ordem. taskType:
// 'RETRIEVAL_DOCUMENT' para os perfis, 'RETRIEVAL_QUERY' para a matéria (a
// assimetria melhora bastante a discriminação no Gemini). OpenAI ignora.
async function embTextos(textos, cfg, taskType) {
  const prov = cfg.provedorId;
  if (prov === 'gemini') {
    const m = EMB_MODELO.gemini;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:embedContent?key=${cfg.apiKey}`;
    // O Gemini só expõe embedContent (1 texto por chamada) de forma síncrona.
    return Promise.all(textos.map(async t => {
      const body = { content: { parts: [{ text: t }] }, taskType };
      const j = await fetchIA(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return j?.embedding?.values || null;
    }));
  }
  if (prov === 'openai') {
    const j = await fetchIA('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMB_MODELO.openai, input: textos }),
    });
    return (j.data || []).map(d => d.embedding);
  }
  throw new Error('Embeddings indisponíveis para o provedor ' + prov);
}

function cosseno(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Vetores dos perfis dos deputados (perfil + temas), cacheados em memória por
// modelo+conteúdo. Recalcula ao trocar de provedor ou editar perfis.
async function garantirVetoresDeputados(cfg) {
  const cfgI = state.interesse;
  if (!cfgI?.lista?.length) return null;
  const deps = cfgI.lista.filter(d => { const x = cfgI.dados?.[d.id]; return x && ((x.perfil || '').trim() || (x.temas || '').trim()); });
  if (!deps.length) return null;
  const textoDe = d => { const x = cfgI.dados[d.id]; return `${(x.perfil || '').trim()} ${(x.temas || '').trim()}`.trim(); };
  const tag = embModeloTag(cfg.provedorId);
  const hash = deps.map(d => d.id + ':' + textoDe(d).length).join('|');
  if (cfgI._vetores && cfgI._vetTag === tag && cfgI._vetHash === hash) return cfgI._vetores;
  const vets = await embTextos(deps.map(textoDe), cfg, 'RETRIEVAL_DOCUMENT');
  const map = new Map();
  deps.forEach((d, i) => { if (vets[i]) map.set(d.id, { nome: d.nome, vetor: vets[i] }); });
  cfgI._vetores = map; cfgI._vetTag = tag; cfgI._vetHash = hash;
  return map;
}

// Top 2 deputados por similaridade semântica perfil×matéria, exigindo destaque
// sobre o conjunto (z-score >= INTERESSE_ZMIN) — evita forçar badge quando
// ninguém é claramente aderente.
async function determinarInteressados(it, cfg) {
  if (!state.interesse?.carregado) { try { await carregarInteresse(); } catch (_) {} }
  if (!embeddingsDisponivel(cfg.provedorId)) return deputadosComInteresseKeyword(it);
  let mapaVet;
  try { mapaVet = await garantirVetoresDeputados(cfg); }
  catch (e) { console.warn('[interesse] vetores falharam, fallback p/ palavras:', e.message); return deputadosComInteresseKeyword(it); }
  if (!mapaVet || !mapaVet.size) return [];
  const alvo = _alvoItem(it);
  const matTexto = [tituloVotacao(it), alvo.ementa || it.ementa || '', it.apelido || ''].filter(Boolean).join('. ').slice(0, 2000);
  let matVet;
  try { matVet = (await embTextos([matTexto], cfg, 'RETRIEVAL_QUERY'))[0]; }
  catch (e) { console.warn('[interesse] embedding da matéria falhou:', e.message); return deputadosComInteresseKeyword(it); }
  if (!matVet) return [];
  const sims = [];
  for (const [, o] of mapaVet) sims.push({ nome: o.nome, sim: cosseno(matVet, o.vetor) });
  const media = sims.reduce((a, s) => a + s.sim, 0) / sims.length;
  const dp = Math.sqrt(sims.reduce((a, s) => a + (s.sim - media) ** 2, 0) / sims.length) || 1e-9;
  sims.sort((a, b) => b.sim - a.sim);
  console.debug('[interesse] sims:', sims.slice(0, 6).map(s => `${s.nome}: ${s.sim.toFixed(3)} (z=${((s.sim - media) / dp).toFixed(2)})`).join(' | '));
  return sims.filter(s => (s.sim - media) / dp >= INTERESSE_ZMIN).slice(0, 2).map(s => s.nome);
}

// Exibido no badge — calculado na geração e salvo em it.analise.interessados.
// Só aparece quando o marcador está ligado nas configurações (desligado por padrão).
function deputadosComInteresse(it) {
  if (!state.interesse?.ativo) return [];
  return it.analise?.interessados || [];
}

function atualizarTodosBadgesInteresse() {
  for (const it of (state.pauta?.itens || [])) atualizarBadgesCard(it);
}

// Liga/desliga o marcador (compartilhado com a equipe) e atualiza os badges.
async function onToggleInteresseAtivo(e) {
  const ativo = !!e.target.checked;
  const stEl = document.getElementById('interesse-status');
  if (stEl) stEl.textContent = 'Salvando…';
  try {
    await fbSalvarInteresseAtivo(ativo);
    state.interesse = { ...(state.interesse || { lista: [], dados: {}, carregado: true }), ativo };
    atualizarTodosBadgesInteresse();
    if (stEl) stEl.textContent = ativo
      ? '✓ Marcador de interesse ligado para toda a equipe.'
      : '✓ Marcador de interesse desligado para toda a equipe.';
  } catch (err) {
    e.target.checked = !ativo;   // reverte o visual em caso de falha
    if (stEl) stEl.textContent = 'Erro ao salvar: ' + err.message;
  }
}

function renderInteresseConfig() {
  const chk = document.getElementById('config-interesse-ativo');
  if (chk) chk.checked = !!state.interesse?.ativo;
  const cont = document.getElementById('config-interesse-lista');
  if (!cont) return;
  const cfg = state.interesse;
  if (!cfg || !cfg.carregado) {
    cont.innerHTML = '<div class="config-desc">Carregando deputados…</div>';
    carregarInteresse().then(renderInteresseConfig).catch(() => {
      cont.innerHTML = '<div class="config-desc">Falha ao carregar a lista de deputados.</div>';
    });
    return;
  }
  if (!cfg.lista.length) { cont.innerHTML = '<div class="config-desc">Nenhum deputado do Podemos encontrado na API.</div>'; return; }
  cont.innerHTML = cfg.lista.map(dep => {
    const d = cfg.dados?.[dep.id] || {};
    return `
    <div class="form-group" data-dep-bloco="${escapeHtml(dep.id)}" data-dep-nome="${escapeHtml(dep.nome)}" style="margin-bottom:14px;border-bottom:1px solid var(--border-soft);padding-bottom:12px">
      <label style="font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(dep.nome)}</label>
      <label style="font-size:11px;color:var(--text-dim);margin-top:6px;display:block">Perfil</label>
      <textarea class="form-input" data-dep-perfil="${escapeHtml(dep.id)}" rows="3"
        placeholder="perfil de interesse do parlamentar"
        style="resize:vertical">${escapeHtml(d.perfil || '')}</textarea>
      <label style="font-size:11px;color:var(--text-dim);margin-top:6px;display:block">Temas de interesse (separados por OR)</label>
      <textarea class="form-input" data-dep-temas="${escapeHtml(dep.id)}" rows="2"
        placeholder="temas separados por OR (ex.: saúde OR primeira infância)"
        style="resize:vertical">${escapeHtml(d.temas || '')}</textarea>
    </div>`;
  }).join('');
  filtrarInteresseBusca();   // reaplica a busca atual (se houver) à lista recém-montada
}

// Busca na aba de temas de interesse: filtra a lista de deputados pelos que têm
// o termo nos temas ou no perfil. Ex.: "saúde" → mostra só quem tem esse tema.
function filtrarInteresseBusca() {
  const inp  = document.getElementById('interesse-busca');
  const cont = document.getElementById('config-interesse-lista');
  const stEl = document.getElementById('interesse-busca-status');
  if (!cont) return;
  const termo = (inp?.value || '').trim();
  const q = _normTxt(termo);
  let visiveis = 0;
  const blocos = cont.querySelectorAll('[data-dep-bloco]');
  blocos.forEach(bloco => {
    if (!q) { bloco.style.display = ''; return; }
    const temas  = bloco.querySelector('[data-dep-temas]')?.value || '';
    const perfil = bloco.querySelector('[data-dep-perfil]')?.value || '';
    const nome   = bloco.getAttribute('data-dep-nome') || '';
    const casa = _normTxt(`${temas} ${perfil} ${nome}`).includes(q);
    bloco.style.display = casa ? '' : 'none';
    if (casa) visiveis++;
  });
  if (stEl) {
    stEl.textContent = !q ? ''
      : visiveis ? `${visiveis} deputado(s) com “${termo}”.`
      : `Nenhum deputado com “${termo}”.`;
  }
}

async function salvarInteresse() {
  const cont = document.getElementById('config-interesse-lista');
  const stEl = document.getElementById('interesse-status');
  if (!cont) return;
  const map = {};
  const garante = id => (map[id] || (map[id] = { temas: '', perfil: '' }));
  cont.querySelectorAll('textarea[data-dep-temas]').forEach(t => { garante(t.getAttribute('data-dep-temas')).temas = t.value.trim(); });
  cont.querySelectorAll('textarea[data-dep-perfil]').forEach(t => { garante(t.getAttribute('data-dep-perfil')).perfil = t.value.trim(); });
  for (const [id, v] of Object.entries(map)) if (!v.temas && !v.perfil) delete map[id];   // descarta vazios
  if (stEl) stEl.textContent = 'Salvando…';
  try {
    await fbSalvarTemasInteresse(map);
    state.interesse = { ...(state.interesse || { lista: [] }), dados: map, carregado: true };
    atualizarTodosBadgesInteresse();
    if (stEl) stEl.textContent = '✓ Perfis e temas salvos e compartilhados com a equipe.';
  } catch (e) {
    if (stEl) stEl.textContent = 'Erro ao salvar: ' + e.message;
  }
}

// Cenário 8 (MPV): cria uma análise de texto livre (manual, sem IA) e abre o
// editor em branco para o analista escrever. Se já houver análise, apenas
// reabre o editor. O autosave persiste no Firebase como qualquer outra nota.
async function iniciarAnaliseLivreMPV(it) {
  const card     = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const painel   = card?.querySelector('[data-role=painel-analise]');
  if (painel) { painel.classList.add('aberto'); card.querySelector('[data-role=btn-toggle]').style.display = 'inline-flex'; }

  if (!it.analise) {
    it.analise = {
      markdown:    '',
      manual:      true,
      cenario:     CENARIO_MPV,
      apelido:     it.apelido || '',
      analista:    it.analista || '',
      geradoEm:    new Date().toISOString(),
      geradoPor:   state.config?.nomeUsuario || 'equipe',
      parecerKey:  parecerKey(it),
    };
    it.analiseStatus = 'ok';
    // Grava o esqueleto já, para o autosave da edição ter base no Firebase.
    fbSalvarAnalise(it).catch(e => console.warn('Firebase save falhou:', e.message));
  }
  renderAnaliseCard(it);
  entrarEdicaoAnalise(it);
}

// ============================================================
//  GERAÇÃO DE ANÁLISE VIA IA
// ============================================================
async function gerarAnaliseItem(it, forcar = false, opts = {}) {
  // MPV (Cenário 8) é edição livre — nunca aciona a IA.
  if (ehMPV(it)) return iniciarAnaliseLivreMPV(it);
  await carregarConfig();
  if (!state.config?.apiKey) {
    mostrarToast('Configure a chave de API no painel principal (Configurações).', 'aviso');
    return;
  }

  // Instruções extras para a IA: vêm do diálogo "Reanalisar com IA" (opts)
  // ou, na ausência, do prompt-padrão compartilhado da equipe.
  let instrucoesExtra = opts.instrucoesExtra;
  let promptNome      = opts.promptNome || '';
  if (instrucoesExtra == null) {
    const pad = instrucoesPromptPadrao();
    instrucoesExtra = pad.texto;
    promptNome      = pad.nome;
  }

  const card    = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const btnGer  = card.querySelector('[data-role=btn-gerar]');
  const btnTog  = card.querySelector('[data-role=btn-toggle]');
  const painel  = card.querySelector('[data-role=painel-analise]');
  const conteudo = card.querySelector('[data-role=analise-conteudo]');
  const metaEl  = card.querySelector('[data-role=analise-meta]');

  // Aguarda enriquecimento concluir (para sabermos parecer/autoria)
  if (it.enriquecimento?.status === 'carregando' || it.enriquecimento?.status === 'pendente') {
    mostrarToast('Aguardando verificação de autoria/parecer...', 'info');
    let tries = 0;
    while ((it.enriquecimento?.status === 'carregando' || it.enriquecimento?.status === 'pendente') && tries++ < 60) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Verifica cache no Firebase
  if (!forcar) {
    try {
      const cached = await fbCarregarAnalise(it);
      if (cached) {
        it.analise = cached;
        if (!it.apelido && cached.apelido) it.apelido = cached.apelido;
        if (!it.analista && cached.analista) it.analista = cached.analista;
        it.analiseStatus = 'ok';
        renderAnaliseCard(it);
        return;
      }
    } catch (e) { /* ignora */ }
  }

  // Baixa o documento (parecer ou inteiro teor)
  painel.classList.add('aberto');
  btnTog.style.display = 'inline-flex';
  btnGer.disabled = true;
  btnGer.innerHTML = `<span class="an-spinner"></span> Buscando documento...`;
  conteudo.innerHTML = '<div class="an-progress"><span class="an-spinner"></span> Carregando documento...</div>';
  iaInFlightInc();
  it.analiseStatus = 'gerando';

  try {
    const docs = await escolherDocumentos(it);
    if (!docs.length) throw new Error('Documento (PRLP/PRLE ou inteiro teor) não disponível na API.');

    // Baixa todos os PDFs em paralelo
    btnGer.innerHTML = `<span class="an-spinner"></span> Buscando ${docs.length} documento(s)...`;
    const pdfBuffers = await Promise.all(docs.map(d => baixarPdf(d.url)));

    btnGer.innerHTML = `<span class="an-spinner"></span> Gerando análise...`;
    conteudo.innerHTML = '<div class="an-progress"><span class="an-spinner"></span> Enviando ao provedor de IA...</div>';

    const prompt   = montarPrompt(it, docs, instrucoesExtra);
    let { text: markdown, truncated } = await chamarIA({
      provedorId: state.config.provedor || 'gemini',
      apiKey:     state.config.apiKey,
      modelo:     state.config.modelo,
      prompt,
      pdfBuffers,
    });

    // Auto-continuação: se truncou, faz UMA segunda chamada pedindo
    // para continuar exatamente de onde parou. Se ainda truncar, marca
    // truncada=true para o usuário usar "Completar" depois.
    if (truncated) {
      btnGer.innerHTML = `<span class="an-spinner"></span> Continuando análise truncada...`;
      try {
        const cont = await chamarIA({
          provedorId: state.config.provedor || 'gemini',
          apiKey:     state.config.apiKey,
          modelo:     state.config.modelo,
          prompt:     promptContinuar(markdown),
          pdfBuffers,
        });
        markdown = costurarContinuacao(markdown, cont.text);
        truncated = cont.truncated;
      } catch (e) {
        console.warn('Auto-continuação falhou:', e.message);
      }
    }

    const refsSuspeitas = await calcularRefsSuspeitas(markdown, pdfBuffers);

    // Apelido curto para o índice/títulos do PDF — gerado aqui, junto da nota
    // (1 chamada leve), e salvo no Firebase com a análise. Assim é computado
    // uma única vez e compartilhado com a equipe; o export não refaz chamadas.
    let apelido = '';
    try {
      apelido = await gerarApelidoIA(it, {
        provedorId: state.config.provedor || 'gemini',
        apiKey:     state.config.apiKey,
        modelo:     state.config.modelo,
      });
    } catch (e) { if (isAbortError(e)) throw e; }
    if (apelido) it.apelido = apelido;

    // Parlamentares com interesse na matéria — similaridade semântica (embeddings)
    // entre o perfil e a matéria; fallback por palavras quando não há embeddings.
    // Só calcula quando o marcador está ligado nas configurações (desligado por padrão).
    let interessados = [];
    if (!state.interesse?.carregado) { try { await carregarInteresse(); } catch (_) {} }
    if (state.interesse?.ativo) {
      try {
        interessados = await determinarInteressados(it, {
          provedorId: state.config.provedor || 'gemini',
          apiKey:     state.config.apiKey,
          modelo:     state.config.modelo,
        });
      } catch (e) { if (isAbortError(e)) throw e; console.warn('Interesse falhou:', e.message); }
    }

    it.analise = {
      markdown,
      truncada:    truncated,
      provedor:    state.config.provedor || 'gemini',
      modelo:      state.config.modelo,
      documentos:  docs.map(d => ({ tipo: d.tipo, rotulo: d.rotulo, url: d.url })),
      cenario:     it.tipoCategoria === 'projeto' ? classificarCenario(docs) : '',
      apelido:     apelido || it.apelido || '',
      apensadosStatus: extrairStatusAcolhimento(markdown),
      interessados,
      geradoEm:    new Date().toISOString(),
      geradoPor:   state.config?.nomeUsuario || 'equipe',
      analista:    it.analista || '',   // preenchido manualmente no card
      parecerKey:  parecerKey(it),
      promptCustom: promptNome || null,
      refsSuspeitas,
    };
    it.analiseStatus = 'ok';
    it.desatualizacao = null;   // recém-gerada com os docs atuais — sem alerta

    renderAnaliseCard(it);
    fbSalvarAnalise(it).catch(e => console.warn('Firebase save falhou:', e.message));
    mostrarToast('✓ Análise gerada', 'sucesso');
  } catch (e) {
    if (isAbortError(e)) {
      it.analiseStatus = 'sem_analise';
      conteudo.innerHTML = '<div class="an-analise-erro" style="color:#888;font-style:italic">Geração cancelada pelo usuário.</div>';
    } else {
      console.error(e);
      it.analiseStatus = 'erro';
      conteudo.innerHTML = `<div class="an-analise-erro">Erro: ${escapeHtml(e.message)}</div>`;
    }
    btnGer.disabled = false;
    btnGer.innerHTML = iconeGerar() + ' Gerar Análise';
  } finally {
    iaInFlightDec();
  }
}

/**
 * Lista de documentos a enviar à IA, com rótulo descritivo.
 * Para projetos: PRLP mais recente + PRLE mais recente (quando existir).
 * Para requerimentos: inteiro teor da proposição alvo.
 * Fallback: inteiro teor do projeto se nenhum parecer for encontrado.
 */
function promptContinuar(parcial) {
  // Pega só o final do texto já gerado para dar contexto sem estourar
  // o input. Caracteres suficientes para o modelo reconhecer o "onde parou".
  const trecho = parcial.slice(-3000);
  return `A análise abaixo foi gerada mas foi truncada por limite de tokens. Continue EXATAMENTE de onde parou, **sem repetir** o que já está escrito. Não reescreva nenhum parágrafo anterior. Comece a continuação na próxima palavra/frase que faltou. Mantenha o mesmo estilo e formato do texto original (Markdown, parágrafos corridos, usando tópicos apenas onde já havia enumeração de emendas/dispositivos) e siga o roteiro de seções original. Não inclua frases de transição como "continuando" ou "como mencionado antes". Responda APENAS com a continuação.

--- TRECHO FINAL DO QUE JÁ FOI GERADO ---
${trecho}
--- FIM DO TRECHO ---`;
}

function costurarContinuacao(parcial, continuacao) {
  if (!continuacao) return parcial;
  const c = continuacao.trim();
  // Une com um espaço/quebra dependendo do contexto. Evita duplicar se
  // o modelo começou repetindo as últimas palavras.
  const fimParcial = parcial.slice(-200).toLowerCase();
  const inicioCont = c.slice(0, 200).toLowerCase();
  // Se houver overlap longo, recorta o início da continuação
  for (let n = 200; n >= 30; n -= 10) {
    if (fimParcial.endsWith(inicioCont.slice(0, n))) {
      return parcial + c.slice(n);
    }
  }
  return parcial.replace(/\s+$/, '') + (c.startsWith('#') || c.startsWith('-') ? '\n\n' : ' ') + c;
}

async function completarAnalise(it) {
  if (!it.analise || !it.analise.truncada) return;
  await carregarConfig();
  if (!state.config?.apiKey) {
    mostrarToast('Configure a chave de API antes (⚙ Configurações).', 'aviso');
    return;
  }

  const card    = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const btn     = card.querySelector('[data-role=btn-completar]');
  btn.disabled = true;
  btn.innerHTML = '<span class="an-spinner"></span> Continuando...';
  iaInFlightInc();

  try {
    // Re-baixar os mesmos documentos (mantém o contexto consistente)
    const docs = await escolherDocumentos(it);
    const pdfBuffers = await Promise.all(docs.map(d => baixarPdf(d.url)));

    const cont = await chamarIA({
      provedorId: state.config.provedor || 'gemini',
      apiKey:     state.config.apiKey,
      modelo:     state.config.modelo,
      prompt:     promptContinuar(it.analise.markdown),
      pdfBuffers,
    });

    const markdownCompleto = costurarContinuacao(it.analise.markdown, cont.text);
    const refsSuspeitas = await calcularRefsSuspeitas(markdownCompleto, pdfBuffers);
    it.analise = {
      ...it.analise,
      markdown:   markdownCompleto,
      truncada:   cont.truncated,
      refsSuspeitas,
      apensadosStatus: extrairStatusAcolhimento(markdownCompleto),
      editadoEm:  new Date().toISOString(),
      editadoPor: state.config?.nomeUsuario || 'equipe',
    };
    renderAnaliseCard(it);
    await fbSalvarAnalise(it);
    mostrarToast(cont.truncated ? 'Continuação ainda truncada — clique de novo se quiser.' : '✓ Análise completada', cont.truncated ? 'aviso' : 'sucesso');
  } catch (e) {
    if (isAbortError(e)) {
      mostrarToast('Continuação cancelada.', 'aviso');
    } else {
      mostrarToast('Erro ao completar: ' + e.message, 'erro');
    }
  } finally {
    iaInFlightDec();
    btn.disabled = false;
    btn.innerHTML = 'Completar';
  }
}

// Rótulo do cenário de tramitação, derivado dos documentos anexados — espelha
// a prioridade de escolherDocumentos/cenarioHint. Usado na meta do card (fase
// de homologação).
function classificarCenario(docs = []) {
  const has = t => docs.some(d => d.tipo === t);
  if (has('PRL_ESPECIAL') || has('SBT_A_ESPECIAL')) return 'Cenário 9 — PEC (parecer da Comissão Especial)';
  if (has('PDL_TEOR'))                 return 'Cenário 10 — PDL (decreto legislativo)';
  if (has('EMS'))                      return has('PRLP') ? 'Cenário 7 — EMS + parecer do relator' : 'Cenário 6 — retorno do Senado (EMS)';
  if (has('SSP'))                      return 'Cenário 5 — subemenda substitutiva (SSP)';
  if (has('PRLP') && has('SBT_A'))     return 'Cenário 4 — PRLP na forma do SBT-A';
  if (has('SBT_A'))                    return 'Cenário 2 — substitutivo de comissão (SBT-A)';
  if (has('PRLP') || has('PRLE'))      return 'Cenário 3 — parecer de plenário (PRLP)';
  if (has('INTEIRO_TEOR') || has('REDACAO_ORIGINAL')) return 'Cenário 1 — inteiro teor (sem parecer)';
  return '';
}

// ---------- Detecção de nota desatualizada (texto operativo) ----------
// Considera "operativo" o que está em votação: parecer de plenário (PRLP/PRLE),
// substitutivo adotado por comissão (SBT-A), subemenda (SSP) e emendas do
// Senado (EMS). Pareceres de comissão e apensados NÃO marcam desatualização.
const TIPOS_OPERATIVOS = ['EMS', 'SSP', 'PRLP', 'PRLE', 'SBT_A', 'PRL_ESPECIAL', 'SBT_A_ESPECIAL'];

// Documentos operativos ATUAIS, lidos do enriquecimento (sem rede no nível
// automático; o nível "botão" garante que enr.emendasSenado foi buscado antes).
function operativosAtuais(it) {
  const enr = it.enriquecimento || {};
  const par = enr.pareceresPlenario || {};
  const es  = enr.emendasSenado || {};
  const out = [];
  const add = (tipo, o, rotulo) => { if (o && o.url) out.push({ tipo, url: o.url, data: o.data || null, rotulo }); };
  add('PRLP', par.prlp, 'parecer do relator (PRLP)');
  add('PRLE', par.prle, 'parecer às emendas (PRLE)');
  add('SBT_A', par.sbtA, 'substitutivo de comissão (SBT-A)');
  // Em PEC a Comissão Especial é o texto operativo; em PL/PLP ela é apenas mais
  // um parecer (PARECER_COMISSAO) e não dispara desatualização.
  add('PRL_ESPECIAL', it.sigla === 'PEC' ? par.prlEspecial : null, 'parecer do relator da Comissão Especial (PEC)');
  add('SBT_A_ESPECIAL', it.sigla === 'PEC' ? par.sbtAEspecial : null, 'substitutivo adotado pela Comissão Especial (PEC)');
  add('EMS', es.ems, 'emendas do Senado (EMS)');
  add('SSP', es.ssp, 'subemenda substitutiva (SSP)');
  return out;
}

// Compara o texto operativo da análise salva com o atual. Retorna { novos: [...] }
// quando surgiu um documento operativo com URL nova E data posterior à do
// documento operativo mais recente que embasou a análise (a checagem de data
// evita falso positivo com documentos antigos não-operativos naquele cenário,
// ex.: PRLP anterior ao retorno do Senado). novos=[] → em dia. null → N/A.
function desatualizacaoOperativa(it) {
  if (it.tipoCategoria !== 'projeto' || !it.analise?.documentos) return null;
  const salvos = it.analise.documentos.filter(d => TIPOS_OPERATIVOS.includes(d.tipo));
  const urlsSalvas = new Set(salvos.map(d => d.url));
  const datasSalvas = salvos
    .map(d => { const m = (d.rotulo || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; })
    .filter(Boolean)
    .sort();
  const dataMaxSalva = datasSalvas.length ? datasSalvas[datasSalvas.length - 1] : null;
  const novos = operativosAtuais(it).filter(d =>
    d.url && !urlsSalvas.has(d.url) && (!dataMaxSalva || (d.data && d.data > dataMaxSalva))
  );
  return { novos };
}

async function escolherDocumentos(it) {
  const enr  = it.enriquecimento || {};
  const docs = [];

  if (it.tipoCategoria === 'projeto') {
    const par = enr.pareceresPlenario || {};

    // Emendas do Senado (EMS) e Subemenda Substitutiva (SSP) vivem na página de
    // emendas — busca sob demanda (só ao gerar), com cache no próprio item.
    // PECs e PDLs seguem rito próprio (sem retorno do Senado).
    if (it.sigla !== 'PEC' && !ehPDL(it) && enr.emendasSenado === undefined && enr.idProposicao) {
      try { enr.emendasSenado = await buscarEmendasSenadoESSP(enr.idProposicao); }
      catch (e) { console.warn('Falha ao buscar EMS/SSP:', e.message); enr.emendasSenado = { ems: null, ssp: null }; }
    }
    const { ems = null, ssp = null } = enr.emendasSenado || {};

    const pe = par.prlEspecial;
    const se = par.sbtAEspecial;
    const rotuloPRLESP  = pe && `Parecer do Relator da Comissão Especial (PRL${pe.sequencial ? ' nº ' + pe.sequencial : ''}${pe.dataBR ? ' de ' + pe.dataBR : ''})`;
    const rotuloSBTAESP = se && `Substitutivo adotado pela Comissão Especial (SBT-A${se.sequencial ? ' nº ' + se.sequencial : ''}${se.dataBR ? ' de ' + se.dataBR : ''})`;
    const rotuloPRLP = par.prlp && `PRLP${par.prlp.sequencial ? ' nº ' + par.prlp.sequencial : ''}${par.prlp.dataBR ? ' de ' + par.prlp.dataBR : ''}`;
    const rotuloPRLE = par.prle && `PRLE${par.prle.sequencial ? ' nº ' + par.prle.sequencial : ''}${par.prle.dataBR ? ' de ' + par.prle.dataBR : ''}`;
    const rotuloSBTA = par.sbtA && `Substitutivo adotado por comissão (SBT-A${par.sbtA.sequencial ? ' nº ' + par.sbtA.sequencial : ''}${par.sbtA.comissao ? ' — ' + par.sbtA.comissao : ''}${par.sbtA.dataBR ? ' de ' + par.sbtA.dataBR : ''})`;
    const rotuloEMS  = ems && `Emendas do Senado (EMS)${ems.dataBR ? ' de ' + ems.dataBR : ''}`;
    const rotuloSSP  = ssp && `Subemenda Substitutiva de Plenário (SSP)${ssp.dataBR ? ' de ' + ssp.dataBR : ''}`;

    if (it.sigla === 'PEC') {
      // ── Cenário 9 (PEC) ───────────────────────────────────────────────
      // Proposta de Emenda à Constituição: o texto que vai a Plenário é o do
      // parecer de mérito da Comissão Especial. Anexa o ÚLTIMO PRL (parecer do
      // relator) dessa comissão como documento operativo e a redação original
      // para o cotejo. O parecer de admissibilidade da CCJC entra adiante (no
      // laço de pareceres das comissões). Sem PRL da Especial ainda (PEC em
      // fase de admissibilidade), restam a CCJC e o inteiro teor.
      if (pe) docs.push({ tipo: 'PRL_ESPECIAL', rotulo: rotuloPRLESP, url: pe.url });
      if (se) docs.push({ tipo: 'SBT_A_ESPECIAL', rotulo: rotuloSBTAESP, url: se.url });
      if (enr.urlInteiroTeor) docs.push({ tipo: 'REDACAO_ORIGINAL', rotulo: 'Redação original (inteiro teor)', url: enr.urlInteiroTeor });
    } else if (ehPDL(it)) {
      // ── Cenário 10 (PDL) ──────────────────────────────────────────────
      // Decreto Legislativo: o texto votado é o próprio decreto (inteiro teor,
      // que inclui a justificação — descreve o ato aprovado/sustado). Os
      // pareceres das comissões entram adiante (laço de pareceres).
      if (enr.urlInteiroTeor) docs.push({ tipo: 'PDL_TEOR', rotulo: 'Inteiro teor do Decreto Legislativo (texto e justificação)', url: enr.urlInteiroTeor });
    } else if (ems) {
      // ── Cenários 6/7 (retorno do Senado) ──────────────────────────────
      // Fluxo: o projeto foi aprovado pela Câmara (casa iniciadora), seguiu ao
      // Senado (casa revisora) e retorna agora com emendas ou substitutivo do
      // Senado. O que a Câmara vota é a aceitação/rejeição dessas alterações.
      // Documentos relevantes:
      //  - EMS  : as emendas/substitutivo do Senado (texto operativo da votação);
      //  - PRLP : parecer do relator sobre as emendas do Senado (acatadas ×
      //    rejeitadas). SÓ é o parecer dessas emendas se for POSTERIOR ao EMS —
      //    um PRLP da 1ª passagem (anterior ao Senado) nada tem a ver com elas.
      //    Com PRLP pós-EMS → Cenário 7; sem ele → Cenário 6.
      //  - "texto aprovado pela Câmara" = o AUTÓGRAFO (sigla "AA ... MESA",
      //    descrição "Autógrafo", na página de Histórico de Pareceres) — é a
      //    redação que efetivamente saiu da Câmara rumo ao Senado, e cujo
      //    resumo dá ao analista a percepção do que foi enviado. Quando não
      //    houver Autógrafo, cai no inteiro teor (texto original) como aproximação.
      // O PRLE NÃO é anexado neste caso (não é o documento operativo).
      const prlpPosEMS = !!(par.prlp && par.prlp.data && ems.data && par.prlp.data > ems.data);
      docs.push({ tipo: 'EMS', rotulo: rotuloEMS, url: ems.url });
      if (prlpPosEMS) docs.push({ tipo: 'PRLP', rotulo: rotuloPRLP, url: par.prlp.url });
      if (par.autografo) {
        docs.push({ tipo: 'AUTOGRAFO', rotulo: `Autógrafo — texto aprovado pela Câmara${par.autografo.dataBR ? ' de ' + par.autografo.dataBR : ''}`, url: par.autografo.url });
      } else if (enr.urlInteiroTeor) {
        docs.push({ tipo: 'TEXTO_CAMARA', rotulo: 'Texto aprovado pela Câmara (inteiro teor)', url: enr.urlInteiroTeor });
      }
    } else if (par.prlp || par.prle) {
      // Cenários 3/4/5: há parecer preliminar de plenário. Anexa PRLP/PRLE e,
      // quando existirem, o SBT-A adotado (cenário 4) e a SSP (cenário 5). A
      // redação original entra para o cotejo dispositivo a dispositivo.
      if (par.prlp) docs.push({ tipo: 'PRLP', rotulo: rotuloPRLP, url: par.prlp.url });
      if (par.prle) docs.push({ tipo: 'PRLE', rotulo: rotuloPRLE, url: par.prle.url });
      if (par.sbtA && !ssp) docs.push({ tipo: 'SBT_A', rotulo: rotuloSBTA, url: par.sbtA.url });
      if (ssp)      docs.push({ tipo: 'SSP',   rotulo: rotuloSSP,  url: ssp.url });
      if (enr.urlInteiroTeor) docs.push({ tipo: 'REDACAO_ORIGINAL', rotulo: 'Redação original (inteiro teor)', url: enr.urlInteiroTeor });
    } else if (par.sbtA) {
      // Cenário 2: substitutivo adotado por comissão, sem parecer de plenário.
      docs.push({ tipo: 'SBT_A', rotulo: rotuloSBTA, url: par.sbtA.url });
      if (enr.urlInteiroTeor) docs.push({ tipo: 'REDACAO_ORIGINAL', rotulo: 'Redação original (inteiro teor)', url: enr.urlInteiroTeor });
    } else if (ssp) {
      // Subemenda substitutiva sem PRLP/PRLE detectados.
      docs.push({ tipo: 'SSP', rotulo: rotuloSSP, url: ssp.url });
      if (enr.urlInteiroTeor) docs.push({ tipo: 'REDACAO_ORIGINAL', rotulo: 'Redação original (inteiro teor)', url: enr.urlInteiroTeor });
    } else if (enr.urlInteiroTeor) {
      // Cenário 1: sem parecer de comissão/plenário e sem substitutivo adotado.
      docs.push({ tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor da proposição', url: enr.urlInteiroTeor });
    }

    // Pareceres das comissões por onde a proposição já tramitou (todos), em
    // ordem cronológica, anexados à chamada principal para que a IA compare os
    // substitutivos entre si e isole a contribuição de cada comissão. Inclui o
    // parecer da Comissão Especial (em PLs/PLPs) — na PEC, porém, a Especial é o
    // documento operativo (PRL_ESPECIAL) e não se repete aqui.
    const comissoesCron = [...(par.comissoes || [])]
      .filter(pc => !(it.sigla === 'PEC' && pc.especial))
      .sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    for (const pc of comissoesCron) {
      docs.push({
        tipo: 'PARECER_COMISSAO',
        rotulo: pc.especial
          ? `Parecer da Comissão Especial${pc.dataBR ? ' de ' + pc.dataBR : ''}`
          : `Parecer da Comissão ${pc.comissao}${pc.dataBR ? ' de ' + pc.dataBR : ''}`,
        url: pc.url,
      });
    }
  } else if (it.tipoCategoria === 'redacao_final') {
    // Redação Final: analisa o documento próprio (raspado da ficha de
    // tramitação na caixa "Documentos Anexos e Referenciados"). Cai no
    // inteiro teor se a Redação Final ainda não estiver publicada.
    if (enr.urlRedacaoFinal) {
      docs.push({ tipo: 'REDACAO_FINAL', rotulo: 'Redação Final', url: enr.urlRedacaoFinal });
    } else if (enr.urlInteiroTeor) {
      docs.push({ tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor da proposição', url: enr.urlInteiroTeor });
    }
  } else {
    if (enr.urlInteiroTeor) docs.push({ tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor da proposição', url: enr.urlInteiroTeor });
  }

  // Apensados podem ainda não ter sido resolvidos pelo enriquecimento assíncrono
  // (corrida quando a nota é gerada logo após carregar a pauta). Garante a
  // resolução sob demanda — mesmo padrão de EMS/SSP acima — para que o resumo
  // do apensado Podemos não fique faltando.
  if (enr.apensadosPodemos === undefined && enr.idProposicao) {
    try {
      const apensados = await resolverApensados(enr.idProposicao);
      enr.apensados = apensados;
      enr.apensadosPodemos = apensados.filter(ap => ap.autoriaPodemos);
    } catch (e) { console.warn('Falha ao resolver apensados sob demanda:', e.message); }
  }

  // Apensado(s) de autoria do Podemos (qualquer cenário): anexa o inteiro teor
  // de cada um para que a nota traga um resumo próprio (tópico antes de
  // "Argumentos favoráveis e contrários"). A URL é buscada sob demanda e
  // cacheada no objeto do apensado, evitando refazer a chamada.
  for (const ap of (enr.apensadosPodemos || [])) {
    if (ap.urlInteiroTeor === undefined) {
      try {
        const det = await fetchJson(`${API_BASE}/proposicoes/${ap.id}`);
        ap.urlInteiroTeor = det.dados?.urlInteiroTeor || null;
      } catch (e) { ap.urlInteiroTeor = null; }
    }
    if (ap.urlInteiroTeor) {
      const auts = (ap.autores || []).filter(a => a.isPodemos).map(a => a.nome).join(', ');
      docs.push({
        tipo: 'APENSADO_PODEMOS',
        rotulo: `Apensado do Podemos — ${ap.siglaTipo} ${ap.numero}/${ap.ano}${auts ? ' (autoria: ' + auts + ')' : ''} — inteiro teor`,
        url: ap.urlInteiroTeor,
      });
    }
  }

  return docs;
}

function parecerKey(it) {
  if (it.tipoCategoria === 'redacao_final') return 'redacao-final';
  if (it.tipoCategoria === 'requerimento') return 'inteiro-teor';
  if (it.relator?.data) return 'parecer-' + (parseDataBR(it.relator.data) || it.relator.data);
  return 'inteiro-teor';
}

function montarPrompt(it, docs = [], instrucoesExtra = '') {
  const enr = it.enriquecimento || {};
  const apensadosPodemos = (enr.apensadosPodemos || []).map(ap => {
    const auts = (ap.autores || []).filter(a => a.isPodemos).map(a => a.nome).join(', ');
    return `- ${ap.siglaTipo} ${ap.numero}/${ap.ano}${auts ? ' (autor(es) Podemos: ' + auts + ')' : ''}`;
  }).join('\n');

  const contextoPodemos = [
    enr.autoriaPodemos ? '⚠ ATENÇÃO: O projeto principal é de autoria de deputado(a) do Podemos.' : null,
    enr.apensadosPodemos?.length ? `⚠ ATENÇÃO: Há apensado(s) de autoria Podemos:\n${apensadosPodemos}` : null,
  ].filter(Boolean).join('\n');

  // Seção própria para o(s) projeto(s) apensado(s) de autoria do Podemos, cujo
  // inteiro teor foi anexado (tipo APENSADO_PODEMOS). Entra ANTES de "Argumentos
  // favoráveis e contrários". Resume cada apensado para dar visibilidade ao que
  // a bancada propôs sobre o mesmo tema.
  // Apensados Podemos sem inteiro teor disponível: o resumo é feito pela ementa
  // (anexada inline no prompt), para nunca ficar "identificado mas sem resumo".
  const apensadosSemTeor = (enr.apensadosPodemos || []).filter(ap => !ap.urlInteiroTeor);
  const totalApens = (enr.apensadosPodemos || []).length;
  const plApens = totalApens > 1;
  // Quando há texto consolidado em votação (substitutivo de comissão/plenário,
  // subemenda ou redação final), pede-se à IA que avalie se a ideia do apensado
  // foi incorporada — os dois textos já estão na mesma chamada.
  const apensadoVsTexto = totalApens &&
    docs.some(d => ['SBT_A', 'PRLP', 'PRLE', 'SSP', 'REDACAO_FINAL', 'PRL_ESPECIAL', 'SBT_A_ESPECIAL'].includes(d.tipo));
  const instrIncorporacao = apensadoVsTexto
    ? ' Em seguida, como há texto consolidado em votação (substitutivo, subemenda ou redação final), acrescente para cada apensado **uma NOVA linha (um item de lista próprio, logo abaixo do resumo daquele apensado)** dedicada à avaliação de incorporação. Essa linha deve **começar EXATAMENTE** com o marcador `[[ACOLHIMENTO:NIVEL NUMERO/ANO]]`, em que NIVEL é uma destas três palavras — `ACOLHIDO` (ideia incorporada integralmente), `PARCIAL` (incorporada em parte) ou `NAO` (não incorporada) — e NUMERO/ANO é o número do próprio apensado (ex.: `[[ACOLHIMENTO:PARCIAL 1405/2026]]`). Logo após o marcador, escreva 1 a 2 frases justificando, apontando os dispositivos e, se o parecer/relatório mencionar o apensado, o que o(a) relator(a) decidiu; caso contrário, faça o cotejo entre o apensado e o texto em votação. Reproduza o marcador literalmente, sem alterar o formato, e **não** repita a conclusão de acolhimento na linha de resumo — ela vai apenas nesta linha do marcador.'
    : '';
  // Ementas dos apensados sem inteiro teor, fornecidas como base de resumo.
  const blocoEmentasApensados = apensadosSemTeor.length
    ? '\nApensado(s) Podemos SEM inteiro teor disponível — baseie o resumo na ementa abaixo:\n' +
      apensadosSemTeor.map(ap => {
        const auts = (ap.autores || []).filter(a => a.isPodemos).map(a => a.nome).join(', ');
        return `- ${ap.siglaTipo} ${ap.numero}/${ap.ano}${auts ? ' (' + auts + ')' : ''}: "${(ap.ementa || 'sem ementa disponível').slice(0, 500)}"`;
      }).join('\n') + '\n'
    : '';
  const secaoApensados = totalApens
    ? `\n## Projeto${plApens ? 's' : ''} apensado${plApens ? 's' : ''} de autoria do Podemos\nApresente **um tópico (item de lista com "-") para cada** projeto apensado de autoria do Podemos. Em cada tópico: comece identificando a proposição (sigla, número/ano) e o(s) deputado(s) do Podemos que a assina(m); em seguida, faça um **breve resumo** do objeto do projeto, do que ele propõe criar/alterar e de como se relaciona com a matéria principal em votação.${instrIncorporacao} Para os apensados cujo inteiro teor foi anexado (documentos "Apensado do Podemos ..."), baseie-se nesse inteiro teor; para os demais, baseie-se na ementa indicada abaixo.${blocoEmentasApensados} Não confunda o texto do apensado com o texto operativo principal.\n`
    : '';

  // Redação Final tem prompt próprio, mais enxuto: o documento já é o texto
  // final consolidado, não há parecer a resumir. O foco é o que se está
  // efetivamente votando e os pontos de atenção para a bancada.
  // PDL (Decreto Legislativo) — prompt próprio, com ênfase por subtipo
  // (sustação × outorga × ato internacional). Cenário 10.
  if (ehPDL(it)) return promptPDL(it, docs, instrucoesExtra);

  if (it.tipoCategoria === 'redacao_final') {
    return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos na Câmara dos Deputados.

Analise o documento anexo (Redação Final) referente à proposição **${tipoLabel(it.sigla)} ${it.numero}/${it.ano}**.

Ementa/descrição extraída da Pauta:
"${(it.ementa || '').slice(0, 800)}"

${contextoPodemos ? 'Contexto político:\n' + contextoPodemos + '\n' : ''}
Produza uma **breve análise** em **Português do Brasil**, formato **Markdown**, em **parágrafos corridos** (sem listas com bullets, sem itens marcados com "-" ou "*"), com as seguintes seções (use exatamente esses títulos com "##"):

## Resumo da Redação Final
Dois a três parágrafos descrevendo objetivamente o que o texto final consolida: o objetivo central da proposição, as principais regras/obrigações que ela cria, altera ou revoga (cite artigos, leis e decretos referenciados), quem é afetado e como, e prazos/regras de vigência se previstos. Atente para o fato de que esta é a redação final aprovada — destaque eventuais ajustes redacionais notáveis em relação ao que se esperava (substitutivos adotados, emendas incorporadas), se o documento permitir identificá-los.
${secaoApensados}
${instrucoesExtra && instrucoesExtra.trim()
  ? `\nINSTRUÇÕES ADICIONAIS DO(A) ASSESSOR(A) (têm prioridade quanto à ênfase, à profundidade e aos recortes temáticos da análise, mas NÃO substituem a estrutura de seções acima nem as REGRAS RÍGIDAS abaixo):\n${instrucoesExtra.trim()}\n`
  : ''}
REGRAS RÍGIDAS:
- Use apenas informação contida no documento anexo. Não invente fatos.
- Se uma informação solicitada não constar no documento, escreva explicitamente "não consta no documento" em vez de supor ou recorrer a conhecimento externo.
- Não invente números de lei, artigos, decretos, datas, valores ou nomes. Só cite um dispositivo (lei, decreto, emenda, artigo) se ele aparecer literalmente no documento anexo.
- NÃO inclua recomendação de voto (favorável/contrário/abstenção).
- **NÃO use bullets, listas, "-", "*" ou numeração.** Toda a análise deve ser escrita em parágrafos corridos.
- Ao se referir à proposição, use SEMPRE a forma curta da sigla (ex.: **PL 1234/2010**, **PLP 41/2026**), nunca "Projeto de Lei nº 1234-G, de 12 de novembro de 2010".
- Mantenha o texto enxuto — é uma breve análise da redação final, não um parecer extenso.
- Responda em texto Markdown puro, sem cercas de código \`\`\`.`;
  }

  const pareceresLista = (it.pareceresComissao || []).map((p, i) =>
    `${i + 1}. **Comissão de ${p.comissao}** — ${p.posicao}${p.relator ? ` (${p.relator})` : ''}`
  ).join('\n');
  const blocoPareceres = pareceresLista
    ? `\nPareceres de comissão constantes na pauta (em ordem de tramitação):\n${pareceresLista}\n`
    : '';

  // Lista os documentos efetivamente anexados (PRLP, PRLE, SBT-A, SSP, EMS, inteiro teor)
  const docsLista = docs.map((d, i) => `Documento ${i + 1} — ${d.rotulo}`).join('\n');
  const blocoDocs = docsLista ? `\nDocumentos anexados a esta análise:\n${docsLista}\n` : '';

  // Flags dos tipos de documento anexados — orientam o cenário e o cotejo.
  const has        = t => docs.some(d => d.tipo === t);
  const hasEMS     = has('EMS');
  const hasSBTA    = has('SBT_A');
  const hasPRLP    = has('PRLP');
  const hasPRLE    = has('PRLE');
  const hasPRLESP  = has('PRL_ESPECIAL');
  const hasSBTAESP = has('SBT_A_ESPECIAL');
  const ehPEC      = hasPRLESP || hasSBTAESP;
  const hasSSP     = has('SSP');
  const hasRedacaoCamara = has('AUTOGRAFO') || has('TEXTO_CAMARA');
  const temOriginal = has('REDACAO_ORIGINAL') || hasRedacaoCamara;

  // Documento(s) operativo(s) da seção "Pareceres e substitutivos" — entra(m)
  // no título da seção para facilitar identificar versão/atualização do doc.
  // Prioridade: EMS → SSP → SBT-A → PRLP/PRLE → inteiro teor.
  const rotuloDe = tipo => docs.find(d => d.tipo === tipo)?.rotulo;
  let rotulosOperativos = [];
  if (hasEMS) {
    rotulosOperativos.push(rotuloDe('EMS'));
    if (hasPRLP) rotulosOperativos.push(rotuloDe('PRLP'));
  } else if (hasSSP) {
    rotulosOperativos.push(rotuloDe('SSP'));
    if (hasPRLE) rotulosOperativos.push(rotuloDe('PRLE'));
  } else if (hasSBTA) {
    rotulosOperativos.push(rotuloDe('SBT_A'));
    if (hasPRLP) rotulosOperativos.unshift(rotuloDe('PRLP'));
  } else if (hasPRLP || hasPRLE) {
    if (hasPRLP) rotulosOperativos.push(rotuloDe('PRLP'));
    if (hasPRLE) rotulosOperativos.push(rotuloDe('PRLE'));
  } else if (ehPEC) {
    if (hasPRLESP)  rotulosOperativos.push(rotuloDe('PRL_ESPECIAL'));
    if (hasSBTAESP) rotulosOperativos.push(rotuloDe('SBT_A_ESPECIAL'));
  } else if (has('INTEIRO_TEOR')) {
    rotulosOperativos.push(rotuloDe('INTEIRO_TEOR'));
  }
  rotulosOperativos = rotulosOperativos.filter(Boolean);
  const anotacaoPareceres = rotulosOperativos.length ? ` (${rotulosOperativos.join('; ')})` : '';

  // Seção própria só nos cenários 6/7 (retorno do Senado): resume a redação que
  // a Câmara aprovou e enviou ao Senado (Autógrafo), dando ao analista a
  // percepção do que saiu da Câmara antes de descrever o que o Senado alterou.
  const secaoRedacaoCamara = (hasEMS && hasRedacaoCamara)
    ? `\n## Redação aprovada pela Câmara\nResuma, em parágrafos corridos, a redação que a Câmara aprovou e enviou ao Senado (documento "${has('AUTOGRAFO') ? 'Autógrafo' : 'Texto aprovado pela Câmara'}" anexado), para que o(a) analista tenha a percepção do que saiu da Câmara. Descreva o objeto e os pontos centrais desse texto-base, sobre o qual incidem as emendas do Senado.\n`
    : '';

  // Seção própria com o resumo dos pareceres das comissões por onde a
  // proposição já tramitou (documentos "Parecer da Comissão ..." anexados, em
  // ordem cronológica). A IA tem todos os pareceres na mesma chamada e deve
  // compará-los entre si para isolar a contribuição de cada comissão.
  const docsComissao = docs.filter(d => d.tipo === 'PARECER_COMISSAO');
  const secaoPareceresComissoes = docsComissao.length
    ? `\n## Pareceres das comissões\nApresente **um tópico (item de lista com "-") para cada comissão** por onde a proposição tramitou (documentos "Parecer da Comissão ..." anexados), em **ordem cronológica de tramitação**. Cada tópico deve começar nomeando a comissão e o(a) relator(a) e trazer a conclusão com a data, no formato: "A Comissão de <nome>, sob relatoria do(a) Deputado(a) <nome>, <aprovou a matéria | aprovou um substitutivo que…> em <data por extenso>, <descrição do que aquela comissão alterou em relação ao texto que recebeu>". Foque na **contribuição específica de cada comissão** (dispositivos que acrescentou, alterou ou suprimiu), comparando os pareceres/substitutivos entre si e SEM repetir o que já foi descrito para as comissões anteriores. Se uma comissão apenas aprovou sem mudanças de mérito, registre que aprovou na forma do texto recebido. Baseie-se exclusivamente nos documentos anexados.\n`
    : '';

  // Diretiva interna (NÃO deve ser reproduzida no texto): a partir dos
  // documentos anexados, diz à IA qual é o texto "operativo" a descrever.
  let cenarioHint;
  if (hasEMS) {
    cenarioHint = `A proposição retornou do Senado Federal com emendas (documento "Emendas do Senado (EMS)" anexado). Se a emenda do Senado for um substitutivo integral, traga o conteúdo desse substitutivo do Senado em parágrafos corridos. Se houver emendas enumeradas, apresente-as em **tópicos** (lista com "-"), um tópico por emenda, no formato "EMS N – <resumo do que a emenda altera>".${hasPRLP ? ' Como há também o parecer do relator anexado, indique quais emendas/dispositivos foram ACATADOS e quais foram REJEITADOS pelo relator (igualmente em tópicos), pois a votação será feita em globo, por grupos (aprovadas × rejeitadas).' : ''}`;
  } else if (hasSSP) {
    cenarioHint = `Há subemenda substitutiva de plenário (SSP anexada) — é o texto mais recente e operativo (o que está sendo votado). Traga o conteúdo da subemenda substitutiva.${hasPRLE ? ' Use o parecer às emendas de plenário (PRLE) anexado para explicar o que a subemenda consolidou.' : ''}`;
  } else if (hasPRLP && hasSBTA) {
    cenarioHint = `O parecer preliminar de plenário (PRLP) aprova na forma do substitutivo adotado por comissão (documento "Substitutivo adotado por comissão (SBT-A)" anexado). Conforme o que o próprio PRLP declara, identifique qual comissão teve o substitutivo adotado e traga o conteúdo do texto desse SBT-A (e não de um substitutivo de plenário, que neste caso não existe).`;
  } else if (hasSBTA) {
    cenarioHint = `Há substitutivo adotado por comissão (SBT-A anexado), sem parecer preliminar de plenário. Traga o conteúdo do SBT-A da última comissão e cite, se for o caso, as comissões ainda pendentes de parecer.`;
  } else if (hasPRLP || hasPRLE) {
    cenarioHint = `Há parecer preliminar de plenário (PRLP) com substitutivo de plenário. Traga o conteúdo do substitutivo apresentado no último PRLP.${hasPRLP && hasPRLE ? ' Como há PRLP e PRLE anexados, descreva o conteúdo do PRLP (parecer original do relator) e, em seguida, o do PRLE (parecer reformulado às emendas), apontando o que mudou entre um e outro.' : ''}`;
  } else if (ehPEC) {
    cenarioHint = `Trata-se de Proposta de Emenda à Constituição (PEC). A PEC recebe parecer apenas da CCJC (admissibilidade) e da Comissão Especial (mérito); o texto que vai a Plenário é o do parecer da Comissão Especial.${hasPRLESP ? ' O parecer do relator da Comissão Especial (PRL) está anexado — traga o conteúdo do voto e do substitutivo por ele aprovado.' : ''}${hasSBTAESP ? ' O substitutivo adotado pela Comissão Especial (SBT-A) está anexado — é o texto consolidado da PEC; baseie nele a descrição das disposições.' : ''} Descreva as alterações ao texto constitucional. Quando o parecer da CCJC estiver anexado, trate-o como juízo de admissibilidade, não de mérito.`;
  } else {
    cenarioHint = `A proposição não tem parecer preliminar de plenário nem substitutivo de comissão adotado. Traga o conteúdo do projeto original.`;
  }

  // Título da seção de disposições — adaptado ao que está efetivamente em
  // votação (evita afirmar "substitutivo" quando não há nenhum anexado).
  let tituloDisposicoes;
  if (hasEMS) {
    tituloDisposicoes = 'Principais Disposições do texto em votação (emendas do Senado)';
  } else if (ehPEC) {
    tituloDisposicoes = 'Principais Disposições do texto aprovado pela Comissão Especial';
  } else if (hasSBTA || hasSSP || hasPRLP || hasPRLE) {
    tituloDisposicoes = 'Principais Disposições do último substitutivo apresentado';
  } else {
    tituloDisposicoes = 'Principais Disposições da proposição';
  }

  const tipoDoc = it.tipoCategoria === 'requerimento'
    ? 'inteiro teor da proposição cuja urgência é solicitada'
    : 'documento(s) relevante(s) da proposição (parecer, substitutivo, emendas e/ou inteiro teor, conforme anexados)';

  return `Você é um analista legislativo da Câmara dos Deputados especializado em análise de proposições legislativas. Sua tarefa é elaborar uma nota técnica sucinta, clara e objetiva, destinada a informar Deputados Federais sobre uma proposição legislativa.

Analise o(s) documento(s) anexo(s) (${tipoDoc}) referente(s) à proposição **${tipoLabel(it.sigla)} ${it.numero}/${it.ano}**.
${blocoDocs}

Ementa/descrição extraída da Pauta:
"${(it.ementa || '').slice(0, 800)}"
${blocoPareceres}
Produza a nota técnica em **Português do Brasil**, formato **Markdown**, em **parágrafos corridos** (sem listas com bullets, sem itens marcados com "-" ou "*"), com as seguintes seções (use exatamente esses títulos com "##"):

## Objetivo
Parágrafo único, direto e em linguagem acessível, explicando o que a proposição faz. Deve responder à pergunta: "Do que trata este projeto?".

## Justificativa
Por que o tema é relevante? Qual problema a proposição pretende resolver? Fundamente na justificação do autor ou nos elementos do documento, sem recorrer a conhecimento externo.
${secaoRedacaoCamara}${secaoPareceresComissoes}
## Pareceres e substitutivos${anotacaoPareceres}
[INSTRUÇÃO INTERNA — não reproduza este texto, não mencione "cenário" e não classifique a proposição na resposta: ${cenarioHint}]

Nesta seção, descreva diretamente o conteúdo do parecer/substitutivo/emendas que está sendo votado, citando o(a) relator(a) e as comissões quando constarem nos documentos. Escreva a análise normalmente, sem fazer referência a estas instruções nem a números de cenário.${anotacaoPareceres ? ` Mantenha exatamente a anotação entre parênteses no título desta seção (${rotulosOperativos.join('; ')}), indicando qual(is) documento(s) embasou(aram) a análise.` : ''}

## ${tituloDisposicoes}
O que a proposição efetivamente muda ou cria? Quais são os pontos centrais do texto que está sendo votado (o substitutivo, a subemenda, o conjunto de emendas ou o próprio projeto, conforme o que foi anexado)? ${temOriginal
  ? 'A redação original da proposição (ou o texto aprovado pela Câmara) está anexada. **Faça o cotejo com o texto operativo percorrendo dispositivo a dispositivo (artigos, parágrafos, incisos e alíneas), apontando o que foi INCLUÍDO, o que foi ALTERADO (com o teor antes e depois) e o que foi SUPRIMIDO.** '
  : ''}Descreva concretamente o que muda na prática, evitando frases genéricas.
${secaoApensados}
## Argumentos favoráveis e contrários
Dois parágrafos corridos. O primeiro **começa exatamente com **Argumentos favoráveis:**** e reúne os argumentos que sustentam a aprovação; o segundo **começa exatamente com **Argumentos contrários:**** e reúne os que sustentam a rejeição. **Apresente SEMPRE os dois lados**, ainda que os documentos tragam apenas um. **Nesta seção (e apenas nela) você pode recorrer a conhecimento geral e ao contexto do tema** para construir argumentos plausíveis — inclusive contra-argumentos que não constem nos documentos. Não escreva "não constam argumentos contrários": elabore os contrapontos prováveis a partir do mérito, dos impactos e dos interesses afetados. Ainda assim, não invente fatos sobre o conteúdo do documento (números de lei, dispositivos ou dados) e apresente cada argumento como opinião/ponderação, não como fato.
${instrucoesExtra && instrucoesExtra.trim()
  ? `\nINSTRUÇÕES ADICIONAIS DO(A) ASSESSOR(A) (têm prioridade quanto à ênfase, à profundidade e aos recortes temáticos da análise, mas NÃO substituem a estrutura de seções acima nem as REGRAS RÍGIDAS abaixo):\n${instrucoesExtra.trim()}\n`
  : ''}
PRINCÍPIOS A SEREM OBSERVADOS:
- Clareza: evitar termos técnicos sem explicação.
- Objetividade: focar no essencial para a tomada de decisão.
- Imparcialidade: apresentar fatos e impactos, sem posicionamento político.
- Fundamentação: embasar afirmações em normas, dados ou no próprio documento.

REGRAS RÍGIDAS:
- Use apenas informação contida nos documentos anexos. Não invente fatos. (Exceção: a seção "Argumentos favoráveis e contrários", em que você pode usar conhecimento geral para construir a argumentação.)
- Se uma informação solicitada não constar nos documentos, escreva explicitamente "não consta no documento" em vez de supor ou recorrer a conhecimento externo. (Isso NÃO se aplica à seção "Argumentos favoráveis e contrários", que deve sempre trazer os dois lados.)
- Não invente números de lei, artigos, decretos, datas, valores ou nomes. Só cite um dispositivo (lei, decreto, emenda, artigo) se ele aparecer literalmente nos documentos anexos.
- NÃO inclua recomendação de voto (favorável/contrário/abstenção).
- NÃO mencione no texto qual "cenário" foi identificado, não classifique a proposição por número de cenário e não reproduza as instruções deste enunciado — escreva apenas a nota técnica.
- Escreva em **parágrafos corridos**, SEM bullets ou listas, EXCETO (a) quando estiver enumerando dispositivos ou emendas (ex.: emendas do Senado, ou dispositivos acatados/rejeitados pelo relator), (b) na seção de projetos apensados de autoria do Podemos e (c) na seção "Pareceres das comissões": nesses casos, apresente-os em **tópicos** (lista com "-"), um item por dispositivo/emenda/apensado/comissão.
- Se identificar substitutivo, descreva detalhadamente as mudanças promovidas em relação ao texto original.
- Se identificar emendas, descreva o que cada emenda altera.
- Responda em texto Markdown puro, sem cercas de código \`\`\`.`;
}

// ---------- Prompt do PDL (Cenário 10), com ênfase por subtipo ----------
function promptPDL(it, docs = [], instrucoesExtra = '') {
  const enr = it.enriquecimento || {};
  const sub = subtipoPDL(it);
  const docsLista = docs.map((d, i) => `Documento ${i + 1} — ${d.rotulo}`).join('\n');
  const blocoDocs = docsLista ? `\nDocumentos anexados a esta análise:\n${docsLista}\n` : '';
  const temParecer = docs.some(d => d.tipo === 'PARECER_COMISSAO');
  const contextoPodemos = enr.autoriaPodemos
    ? '⚠ ATENÇÃO: O Projeto de Decreto Legislativo é de autoria de deputado(a) do Podemos.\n' : '';
  const secaoParecer = temParecer
    ? '\n## Parecer da(s) comissão(ões)\nEm um parágrafo por comissão (documentos "Parecer da Comissão ..." anexados), resuma a conclusão do(a) relator(a) e os fundamentos — em especial se recomenda a aprovação ou a rejeição do decreto legislativo, e eventuais ressalvas.\n'
    : '';
  const instr = instrucoesExtra && instrucoesExtra.trim()
    ? `\nINSTRUÇÕES ADICIONAIS DO(A) ASSESSOR(A) (têm prioridade quanto à ênfase, mas NÃO substituem a estrutura nem as regras abaixo):\n${instrucoesExtra.trim()}\n`
    : '';

  const cabecalho = `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos na Câmara dos Deputados. Elabore uma nota técnica para informar Deputados Federais sobre o **Projeto de Decreto Legislativo (PDL) ${it.numero}/${it.ano}**.
${contextoPodemos}Analise o(s) documento(s) anexo(s) (inteiro teor do decreto, incluindo a justificação${temParecer ? ', e o(s) parecer(es) de comissão' : ''}).
${blocoDocs}
Ementa/descrição extraída da Pauta:
"${(it.ementa || '').slice(0, 800)}"
`;

  let corpo;
  if (sub === 'outorga') {
    corpo = `Trata-se de PDL de OUTORGA de radiodifusão (concessão, permissão, autorização — ou sua renovação), matéria rotineira normalmente votada em bloco. Produza uma nota **CURTA e objetiva**, em **Português do Brasil**, **Markdown**, **parágrafos corridos** (sem bullets), com as seções (títulos com "##"):

## Objetivo
Em 1 ou 2 frases: a entidade outorgada (nome), o objeto (concessão/permissão/autorização ou renovação; rádio ou TV; tipo de serviço), o município/UF e o prazo, conforme constem do documento.
${secaoParecer}## Pontos de atenção
Apenas se houver algo fora do padrão (pendência, controvérsia, prazo já expirado). Sendo outorga de rotina sem ressalvas, registre que é matéria de outorga sem pontos controversos.`;
  } else if (sub === 'sustacao') {
    corpo = `Trata-se de PDL de SUSTAÇÃO de ato do Poder Executivo (art. 49, V, da Constituição: compete ao Congresso sustar atos normativos do Executivo que exorbitem do poder regulamentar ou dos limites de delegação legislativa). Produza a nota em **Português do Brasil**, **Markdown**, **parágrafos corridos** (sem bullets), com as seções (títulos "##"):

## Objetivo
O que o PDL pretende sustar (qual decreto/portaria/resolução e de qual órgão) e qual o efeito prático de sustá-lo.

## O ato que se pretende sustar
Com base na justificação do PDL (no inteiro teor anexado), descreva o que o ato do Executivo determina e por que o autor entende que ele exorbita o poder regulamentar ou os limites legais.
${secaoParecer}## Argumentos favoráveis e contrários
Dois parágrafos. O primeiro **começa exatamente com **Argumentos favoráveis:**** (a favor da sustação); o segundo **começa exatamente com **Argumentos contrários:**** (contra). Apresente SEMPRE os dois lados. Nesta seção (e apenas nela) você pode recorrer a conhecimento geral para construir a argumentação, sem inventar fatos sobre o conteúdo do documento.

## Pontos de atenção para o Podemos
Um parágrafo sobre as implicações para a bancada.`;
  } else if (sub === 'tratado') {
    corpo = `Trata-se de PDL que aprova ato internacional (acordo, tratado, convenção ou protocolo). Produza a nota em **Português do Brasil**, **Markdown**, **parágrafos corridos** (sem bullets), com as seções (títulos "##"):

## Objetivo
O instrumento internacional aprovado (partes e objeto) e o que sua aprovação implica para o Brasil.

## Principais pontos do acordo
Os compromissos centrais assumidos, conforme o texto/justificação anexados.
${secaoParecer}## Argumentos favoráveis e contrários
Dois parágrafos. O primeiro **começa exatamente com **Argumentos favoráveis:**** (a favor da aprovação); o segundo **começa exatamente com **Argumentos contrários:**** (contra). Apresente sempre os dois lados.

## Pontos de atenção para o Podemos
Um parágrafo sobre as implicações para a bancada.`;
  } else {
    corpo = `Trata-se de Projeto de Decreto Legislativo. Produza a nota em **Português do Brasil**, **Markdown**, **parágrafos corridos** (sem bullets), com as seções (títulos "##"):

## Objetivo
O que o decreto legislativo dispõe e qual o seu efeito prático.

## Justificativa
Por que a matéria é relevante, com base na justificação anexada.
${secaoParecer}## Argumentos favoráveis e contrários
Dois parágrafos. O primeiro **começa exatamente com **Argumentos favoráveis:****; o segundo **começa exatamente com **Argumentos contrários:****. Apresente sempre os dois lados.

## Pontos de atenção para o Podemos
Um parágrafo sobre as implicações para a bancada.`;
  }

  const regras = `
PRINCÍPIOS: clareza, objetividade, imparcialidade e fundamentação no próprio documento.
REGRAS RÍGIDAS:
- Use apenas informação contida nos documentos anexos. Não invente fatos. (Exceção: a seção "Argumentos favoráveis e contrários", em que pode usar conhecimento geral.)
- Se uma informação não constar, escreva "não consta no documento" em vez de supor.
- Não invente números de lei, decreto, portaria, datas, valores ou nomes que não estejam nos documentos.
- NÃO inclua recomendação de voto (favorável/contrário/abstenção).
- NÃO mencione "cenário" nem reproduza estas instruções — escreva apenas a nota técnica.
- Escreva em parágrafos corridos, sem bullets ou listas.
- Responda em Markdown puro, sem cercas de código \`\`\`.`;

  return `${cabecalho}
${corpo}
${instr}${regras}`;
}

// ---------- IA: chamada adaptada para resposta em Markdown ----------
// Retorna { text, truncated } onde truncated=true sinaliza que o modelo
// atingiu o limite de tokens de saída (não terminou a resposta).
async function chamarIA({ provedorId, apiKey, modelo, prompt, pdfBuffers, web }) {
  const pdfsBase64 = (pdfBuffers || []).map(b => arrayBufferToBase64(b));

  if (provedorId === 'gemini') {
    const m = modelo || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const parts = pdfsBase64.map(d => ({ inline_data: { mime_type: 'application/pdf', data: d } }));
    parts.push({ text: prompt });
    const body = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 12000 },
    };
    if (web) body.tools = [{ google_search: {} }];   // grounding com Google Search
    const json = await fetchIA(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const cand = json.candidates?.[0];
    return {
      // Com grounding o texto pode vir em vários parts — concatena todos.
      text: (cand?.content?.parts || []).map(p => p.text || '').join('').trim(),
      truncated: (cand?.finishReason || '').toUpperCase() === 'MAX_TOKENS',
    };
  }

  if (provedorId === 'openai') {
    const m = modelo || 'gpt-4o';
    const content = pdfsBase64.map((d, i) => ({
      type: 'input_file',
      filename: `documento_${i + 1}.pdf`,
      file_data: `data:application/pdf;base64,${d}`,
    }));
    content.push({ type: 'input_text', text: prompt });
    const body = {
      model: m,
      input: [{ role: 'user', content }],
      temperature: 0.2,
      max_output_tokens: 12000,
    };
    if (web) body.tools = [{ type: 'web_search' }];   // busca web na Responses API
    const json = await fetchIA('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Concatena todo output_text (com web search há itens extras antes da mensagem final).
    let texto = '';
    for (const item of (json.output || [])) {
      for (const c of (item.content || [])) {
        if (c.type === 'output_text' && c.text) texto += (texto ? '\n' : '') + c.text;
      }
    }
    texto = texto.trim();
    if (!texto) texto = (json.output_text || '').trim();
    const trunc = (json.status === 'incomplete')
      || (json.incomplete_details?.reason === 'max_output_tokens');
    return { text: texto, truncated: trunc };
  }

  if (provedorId === 'anthropic') {
    const m = modelo || 'claude-sonnet-4-6';
    const content = pdfsBase64.map(d => ({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: d },
    }));
    content.push({ type: 'text', text: prompt });
    const body = {
      model: m,
      max_tokens: 12000,
      messages: [{ role: 'user', content }],
    };
    if (web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    const json = await fetchIA('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    // Concatena todos os blocos de texto (com web search há blocos de busca no meio).
    let texto = '';
    for (const item of (json.content || [])) {
      if (item.type === 'text' && item.text) texto += (texto ? '\n' : '') + item.text;
    }
    return { text: texto.trim(), truncated: json.stop_reason === 'max_tokens' };
  }

  throw new Error(`Provedor desconhecido: ${provedorId}`);
}

/**
 * Wrapper de fetch para chamadas de IA, com retry/backoff em erros 429
 * (rate limit) e 5xx transitórios. Tentativas: 1 inicial + 3 retries em
 * intervalos de 5s, 15s e 30s.
 */
async function fetchIA(url, init) {
  const delays = [0, 5000, 15000, 30000];
  let ultimaErro = null;
  const signal = _abortAll.signal;
  for (let i = 0; i < delays.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (delays[i] > 0) await sleep(delays[i], signal);
    let res;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      if (isAbortError(e)) throw e;
      ultimaErro = e;
      continue; // erro de rede → retry
    }
    if (res.ok) return await res.json();
    // 429 ou 5xx: vale tentar de novo
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      try {
        const txt = await res.text();
        ultimaErro = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      } catch (_) { ultimaErro = new Error(`HTTP ${res.status}`); }
      continue;
    }
    // 4xx (exceto 429): erro permanente
    let detalhe;
    try { detalhe = await res.json(); } catch (_) { detalhe = null; }
    const msg = detalhe?.error?.message || detalhe?.error?.type || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  throw ultimaErro || new Error('Falha após retries');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

// ---- Cancelamento global de IA ("Parar tudo") ----
let _abortAll = new AbortController();
let _iaInFlight = 0;

function iaInFlightInc() { _iaInFlight++; atualizarBotaoParar(); }
function iaInFlightDec() { _iaInFlight = Math.max(0, _iaInFlight - 1); atualizarBotaoParar(); }

function atualizarBotaoParar() {
  const btn = document.getElementById('btn-parar-todas');
  if (!btn) return;
  btn.style.display = _iaInFlight > 0 ? 'inline-flex' : 'none';
}

function isAbortError(e) {
  return e?.name === 'AbortError' || /aborted/i.test(e?.message || '');
}

function pararTodasAnalises() {
  if (_iaInFlight === 0 && !_gerarTodasState.rodando) return;
  _gerarTodasState.cancelar = true;
  try { _abortAll.abort(); } catch (_) {}
  _abortAll = new AbortController();
  mostrarToast('Cancelando análises em andamento...', 'aviso');
}

async function baixarPdf(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: _abortAll.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (e) {
    if (isAbortError(e)) throw e;
    console.error('[baixarPdf] falhou', url, e);
    throw new Error(`Falha ao baixar documento (${e.message}). URL: ${url.slice(0, 90)}…`);
  }
}

// ---------- Conferência automática de referências (anti-alucinação) ----------
// Heurística leve: extrai do texto gerado as citações de alta confiança
// (Lei, Lei Complementar, Decreto, Decreto-Lei, Emenda Constitucional, Medida
// Provisória) e verifica se o número citado aparece no texto-fonte. Citações
// não localizadas são sinalizadas para conferência manual. Não valida "art. X"
// (ruído alto) nem afirmações de mérito — é um filtro de números inventados.
function validarReferencias(markdown, textoFonte) {
  if (!textoFonte || textoFonte.length < 100) return []; // fonte indisponivel -> nao sinaliza
  // Conjunto de numeros presentes na fonte, sem separador de milhar ("9.999" -> "9999").
  const numerosFonte = new Set((textoFonte.match(/\d[\d.]*\d|\d/g) || []).map(s => s.replace(/\./g, '')));
  const re = /\b(Lei(?:\s+Complementar|\s+Delegada)?|Decreto(?:-Lei)?|Emenda\s+Constitucional|Medida\s+Provis[óo]ria)\s*(?:n?[º°o]?\.?\s*)?(\d[\d.]+\d|\d{3,})/gi;
  const suspeitas = [];
  const vistos = new Set();
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const numNorm = m[2].replace(/\./g, '');
    if (numNorm.length < 4) continue; // ignora numeros curtos (alto risco de falso positivo)
    if (vistos.has(numNorm)) continue;
    vistos.add(numNorm);
    const tipo = m[1].replace(/\s+/g, ' ');
    if (!numerosFonte.has(numNorm)) suspeitas.push(`${tipo} nº ${m[2].trim()}`);
  }
  return suspeitas;
}

// Extrai o texto dos PDFs já baixados (cópia do buffer para não interferir
// com o pdf.js, que pode neutralizar o ArrayBuffer original).
async function calcularRefsSuspeitas(markdown, pdfBuffers) {
  try {
    let fonte = '';
    for (const buf of (pdfBuffers || [])) {
      try { fonte += '\n' + await extrairTextoPdf(buf.slice(0)); } catch (_) {}
    }
    return validarReferencias(markdown, fonte);
  } catch (_) { return []; }
}

function renderAnaliseCard(it) {
  const card     = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const btnGer   = card.querySelector('[data-role=btn-gerar]');
  const btnTog   = card.querySelector('[data-role=btn-toggle]');
  const painel   = card.querySelector('[data-role=painel-analise]');
  const conteudo = card.querySelector('[data-role=analise-conteudo]');
  const metaEl   = card.querySelector('[data-role=analise-meta]');

  painel.classList.add('aberto');
  btnTog.style.display = 'inline-flex';
  btnGer.style.display = 'none';
  card.querySelector('[data-role=btn-editar]').style.display = 'inline-flex';
  card.querySelector('[data-role=btn-completar]').style.display = it.analise.truncada ? 'inline-flex' : 'none';
  // Verificação de desatualização só faz sentido para projeto com texto operativo
  // (não se aplica à MPV de edição livre, que não tem documento rastreado).
  card.querySelector('[data-role=btn-verificar-item]').style.display =
    (it.tipoCategoria === 'projeto' && !ehMPV(it)) ? 'inline-flex' : 'none';
  // MPV (Cenário 8) é texto livre: os botões de IA (Reanalisar / Regerar) não
  // se aplicam.
  card.querySelector('[data-role=btn-reanalisar]').style.display = ehMPV(it) ? 'none' : 'inline-flex';
  card.querySelector('[data-role=btn-regerar]').style.display    = ehMPV(it) ? 'none' : 'inline-flex';

  // Análises manuais (Redação Final antiga ou MPV de edição livre) — sem
  // provedor/modelo/documentos. Para MPV mostra o rótulo do Cenário 8.
  if (it.analise.manual) {
    const baseManual = it.analise.cenario || 'Análise manual';
    metaEl.innerHTML = it.analise.editadoEm
      ? `${escapeHtml(baseManual)} · editada em ${formatDataHora(it.analise.editadoEm)}`
      : escapeHtml(baseManual);
  } else {
    const fonte = it.analise.editadoEm
      ? `Editada em ${formatDataHora(it.analise.editadoEm)} (gerada em ${formatDataHora(it.analise.geradoEm)})`
      : `Gerada em ${formatDataHora(it.analise.geradoEm)}`;
    // Lista de documentos analisados (PRLP / PRLE / inteiro teor / Redação Final)
    const docs = it.analise.documentos
      || (it.analise.urlDocumento ? [{ rotulo: 'documento analisado', url: it.analise.urlDocumento }] : []);
    const docsHtml = docs.length
      ? ' · ' + docs.map(d => `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" style="color:#0a6cf0;font-weight:600;text-decoration:underline">${escapeHtml(d.rotulo)}</a>`).join(' · ')
      : '';
    const promptHtml = it.analise.promptCustom
      ? ` · <span title="Prompt personalizado aplicado">prompt: ${escapeHtml(it.analise.promptCustom)}</span>`
      : '';
    // Cenário de tramitação detectado (fase de homologação): entre parênteses,
    // logo após o provedor/modelo e o horário de geração.
    const cenarioHtml = it.analise.cenario
      ? ` <span title="Cenário de tramitação em que a análise foi enquadrada">(${escapeHtml(it.analise.cenario)})</span>`
      : '';
    metaEl.innerHTML = `${fonte} · ${it.analise.provedor}${it.analise.modelo ? ' / ' + it.analise.modelo : ''}${cenarioHtml}${docsHtml}${promptHtml}`;
  }
  // Analista responsável na meta + sincroniza o campo do card (cache/regeração).
  const analista = it.analista || it.analise.analista || '';
  if (analista) metaEl.innerHTML += ` · <span title="Servidor responsável pela nota">Servidor responsável: <b>${escapeHtml(analista)}</b></span>`;
  const inpAnalista = card.querySelector('[data-role=inp-analista]');
  if (inpAnalista && inpAnalista.value !== analista) inpAnalista.value = analista;
  // Campo do apelido (gerado por IA, editável) — mostra e sincroniza sem
  // atropelar o que o usuário estiver digitando.
  const inpApelido = card.querySelector('[data-role=inp-apelido]');
  const apRow = card.querySelector('[data-role=apelido-row]');
  if (inpApelido) {
    const apVal = it.apelido || it.analise?.apelido || '';
    if (document.activeElement !== inpApelido) inpApelido.value = apVal;
    if (apRow) apRow.style.display = 'flex';
  }

  const refs = it.analise.refsSuspeitas || [];
  const avisoRefs = refs.length
    ? `<div class="an-aviso-refs" style="margin:0 0 12px;padding:10px 12px;border-left:3px solid #d68a00;background:#fff8e6;border-radius:4px;font-size:13px;color:#5a4500">⚠ <strong>Conferência automática de referências:</strong> a IA citou ${refs.length === 1 ? 'a referência' : 'as referências'} a seguir, mas ${refs.length === 1 ? 'ela não foi localizada' : 'elas não foram localizadas'} no texto do documento analisado. Confirme na fonte antes de usar — esta é uma heurística e pode haver falso positivo: ${refs.map(escapeHtml).join('; ')}.</div>`
    : '';
  conteudo.innerHTML = avisoRefs + notaDisplayHtml(it);
  conteudo.style.display = '';
  card.querySelector('[data-role=quill-wrap]').style.display = 'none';
  // Recalcula os badges (inclui o de interesse de parlamentar, que considera o
  // texto da nota recém-gerada/editada).
  atualizarBadgesCard(it);
}

// Estado por-item para o autosave durante a edição.
// Chave: it.chave → { snapshot, debounceId, salvando, dirty, listener }
const _autosaveState = new Map();
const AUTOSAVE_DEBOUNCE_MS = 1500;

// Envolve a seleção do textarea com marcadores (negrito `**…**` ou tamanho
// `[[N]]…[[/]]`), reposiciona a seleção e dispara o autosave.
function envolverSelecao(editor, antes, depois) {
  const s = editor.selectionStart ?? editor.value.length;
  const e = editor.selectionEnd ?? s;
  const v = editor.value;
  editor.value = v.slice(0, s) + antes + v.slice(s, e) + depois + v.slice(e);
  editor.selectionStart = s + antes.length;
  editor.selectionEnd   = e + antes.length;
  editor.focus();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// Remove marcadores de tamanho da seleção (botão "normal"): tira o par que
// envolve a seleção e quaisquer marcadores soltos dentro dela.
function removerTamanhoSelecao(editor) {
  let s = editor.selectionStart ?? 0, e = editor.selectionEnd ?? 0;
  const v = editor.value;
  const abre = v.slice(0, s).match(/\[\[(?:10\.5|12|14|16)\]\]$/);
  const fecha = v.slice(e).match(/^\[\[\/\]\]/);
  let novo;
  if (abre && fecha) {
    novo = v.slice(0, s - abre[0].length) + v.slice(s, e) + v.slice(e + fecha[0].length);
  } else {
    const sel = v.slice(s, e).replace(/\[\[(?:10\.5|12|14|16)\]\]|\[\[\/\]\]/g, '');
    novo = v.slice(0, s) + sel + v.slice(e);
  }
  editor.value = novo;
  editor.focus();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// ============================================================
//  "PERGUNTAR À IA" — chat por nota (efêmero), ancorado na nota + documentos
// ============================================================
const CHAT_CTX_MAX = 60000;   // teto de caracteres do contexto (limita tokens)

function togglePerguntarIA(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const panel = card.querySelector('[data-role=chat-panel]');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  if (!it.analise) { mostrarToast('Gere a nota primeiro para poder perguntar.', 'aviso'); return; }
  it._chat = it._chat || { mensagens: [], contexto: null };
  panel.style.display = 'block';
  card.querySelector('[data-role=chat-web]').checked = !!it._chat.web;
  renderChat(it);
  renderExtras(it);
  card.querySelector('[data-role=chat-q]').focus();
}

function limparChat(it) {
  if (it._chat) it._chat.mensagens = [];
  renderChat(it);
}

function renderChat(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const box = card.querySelector('[data-role=chat-msgs]');
  const msgs = it._chat?.mensagens || [];
  let html = msgs.map(m => m.role === 'user'
    ? `<div class="an-chat-msg an-chat-msg--u">${escapeHtml(m.content)}</div>`
    : `<div class="an-chat-msg an-chat-msg--a">${renderMarkdown(m.content)}</div>`).join('');
  if (it._chat?.carregando) {
    html += `<div class="an-chat-msg an-chat-msg--a"><span class="an-spinner"></span> ${escapeHtml(it._chat._status || 'Consultando a IA…')}</div>`;
  }
  box.innerHTML = html || '<div class="an-chat-vazio">Faça uma pergunta sobre a matéria.</div>';
  box.scrollTop = box.scrollHeight;
}

function setChatStatus(it, s) { if (it._chat) { it._chat._status = s; renderChat(it); } }

// Monta (uma vez) o contexto: nota + texto dos documentos da matéria, truncado.
async function montarContextoChat(it) {
  if (it._chat.contexto) return it._chat.contexto;
  let ctx = `NOTA TÉCNICA JÁ PRODUZIDA:\n${notaTextoPlano(it) || '(sem nota)'}\n`;
  const docs = (it.analise?.documentos || []).filter(d => d && d.url);
  if (docs.length) {
    ctx += `\n=== DOCUMENTOS DA MATÉRIA ===\n`;
    for (const d of docs) {
      if (ctx.length > CHAT_CTX_MAX) break;
      try {
        const buf = await baixarPdf(d.url);
        const txt = await extrairTextoPdf(buf.slice(0));
        ctx += `\n## ${d.rotulo}\n${txt}\n`;
      } catch (_) {
        ctx += `\n## ${d.rotulo}\n(não foi possível ler este documento)\n`;
      }
    }
  }
  it._chat.truncado = ctx.length > CHAT_CTX_MAX;
  it._chat.contexto = it._chat.truncado ? ctx.slice(0, CHAT_CTX_MAX) : ctx;
  return it._chat.contexto;
}

function montarPromptChat(it, novaPergunta) {
  const hist = (it._chat.mensagens || []).slice(0, -1)
    .map(m => `${m.role === 'user' ? 'PERGUNTA' : 'RESPOSTA'}: ${m.content}`).join('\n\n');
  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos na Câmara dos Deputados. Responda à NOVA PERGUNTA do(a) assessor(a) sobre a proposição **${tipoLabel(it.sigla)} ${it.numero}/${it.ano}**, baseando-se PRIORITARIAMENTE na nota técnica e nos documentos da matéria fornecidos abaixo.

REGRAS:
- Cite o dispositivo, artigo ou trecho do documento quando possível.
- Se a resposta NÃO constar nos documentos/nota, diga "não consta nos documentos" e, se útil, ofereça uma ponderação deixando claro que é inferência, não fato do documento.
- Não invente números de lei, dispositivos, datas, valores ou nomes.
- Responda em Português do Brasil, de forma direta e objetiva, em Markdown.${it._chat.web ? '\n- Você PODE consultar a internet para complementar a resposta. Ao usar informação da web, CITE a fonte (URL) e deixe explícito que veio da internet, separando-a do que consta nos documentos da matéria.' : ''}${it._chat.truncado ? '\n- Observação: os documentos foram truncados por tamanho; se algo não aparecer, registre que pode estar fora do trecho disponível.' : ''}

=== MATERIAL DA MATÉRIA ===
${it._chat.contexto}
${(it._chat.extras || []).length ? `\n=== DOCUMENTOS ADICIONAIS (incluídos a pedido — também são da matéria) ===\n${it._chat.extras.map(e => `\n## ${e.rotulo}${e.trunc ? ' (truncado)' : ''}\n${e.texto}`).join('\n')}\n` : ''}
${hist ? `\n=== CONVERSA ATÉ AQUI ===\n${hist}\n` : ''}
=== NOVA PERGUNTA ===
${novaPergunta}`;
}

async function enviarPerguntaIA(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const qEl = card.querySelector('[data-role=chat-q]');
  const q = (qEl.value || '').trim();
  if (!q) return;
  if (!state.config?.apiKey) { mostrarToast('Configure a chave de IA em ⚙ Configurações.', 'aviso'); return; }
  it._chat = it._chat || { mensagens: [], contexto: null };
  if (it._chat.carregando) return;
  it._chat.mensagens.push({ role: 'user', content: q });
  qEl.value = '';
  it._chat.carregando = true;
  it._chat._status = it._chat.contexto ? 'Consultando a IA…' : 'Preparando os documentos da matéria…';
  renderChat(it);
  iaInFlightInc();
  try {
    await montarContextoChat(it);
    setChatStatus(it, 'Consultando a IA…');
    const { text } = await chamarIA({
      provedorId: state.config.provedor || 'gemini',
      apiKey: state.config.apiKey,
      modelo: state.config.modelo,
      prompt: montarPromptChat(it, q),
      pdfBuffers: [],
      web: !!it._chat.web,
    });
    it._chat.mensagens.push({ role: 'assistant', content: (text || '').trim() || '(a IA não retornou resposta)' });
  } catch (e) {
    if (isAbortError(e)) it._chat.mensagens.push({ role: 'assistant', content: '(consulta cancelada)' });
    else {
      const dica = it._chat.web ? ' (com acesso à internet ligado — o modelo configurado pode não suportar busca web; tente desligar ou trocar de modelo)' : '';
      it._chat.mensagens.push({ role: 'assistant', content: 'Erro ao consultar a IA: ' + e.message + dica });
    }
  } finally {
    it._chat.carregando = false;
    it._chat._status = '';
    iaInFlightDec();
    renderChat(it);
  }
}

// ---------- Seletor de documentos extras para o Revisor ----------
const EXTRA_DOC_MAX = 50000;   // teto de caracteres por documento extra incluído

async function toggleSeletorDocs(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const panel = card.querySelector('[data-role=chat-docs-panel]');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML = '<div class="an-chat-vazio"><span class="an-spinner"></span> Buscando documentos da proposição…</div>';
  let grupos;
  try { grupos = await listarDocumentosDisponiveis(it); }
  catch (e) { panel.innerHTML = `<div class="an-chat-vazio">Erro ao listar documentos: ${escapeHtml(e.message)}</div>`; return; }
  renderSeletorDocs(it, grupos);
}

function renderSeletorDocs(it, grupos) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const panel = card.querySelector('[data-role=chat-docs-panel]');
  const total = Object.values(grupos).reduce((n, a) => n + a.length, 0);
  if (!total) { panel.innerHTML = '<div class="an-chat-vazio">Não há outros documentos além dos já usados na nota.</div>'; return; }
  const jaAdd = new Set((it._chat?.extras || []).map(e => e.url));
  let html = '<div class="an-docs-titulo">Documentos da proposição que <b>não</b> entraram na nota — marque para incluir no Revisor:</div>';
  for (const [grupo, lista] of Object.entries(grupos)) {
    if (!lista.length) continue;
    html += `<div class="an-docs-grupo">${grupo}</div>`;
    html += lista.map(d => {
      const incl = jaAdd.has(d.url);
      return `<label class="an-docs-opt"><input type="checkbox" data-doc-url="${escapeHtml(d.url)}" data-doc-rotulo="${escapeHtml(d.rotulo)}" ${incl ? 'checked disabled' : ''}> <span>${escapeHtml(d.rotulo)}${incl ? ' <small>(já incluído)</small>' : ''}</span></label>`;
    }).join('');
  }
  html += `<div class="an-docs-acoes"><button class="btn btn-primary btn-sm" data-role="docs-add">Adicionar selecionados</button><button class="btn btn-ghost btn-sm" data-role="docs-fechar">Fechar</button></div>`;
  panel.innerHTML = html;
  panel.querySelector('[data-role=docs-add]').addEventListener('click', () => adicionarDocsExtras(it));
  panel.querySelector('[data-role=docs-fechar]').addEventListener('click', () => { panel.style.display = 'none'; });
}

async function adicionarDocsExtras(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const panel = card.querySelector('[data-role=chat-docs-panel]');
  const checks = [...panel.querySelectorAll('input[data-doc-url]:checked:not(:disabled)')];
  if (!checks.length) { panel.style.display = 'none'; return; }
  it._chat = it._chat || { mensagens: [], contexto: null };
  it._chat.extras = it._chat.extras || [];
  const btn = panel.querySelector('[data-role=docs-add]');
  btn.disabled = true; btn.textContent = 'Baixando…';
  let falhas = 0;
  for (const cb of checks) {
    const url = cb.dataset.docUrl, rotulo = cb.dataset.docRotulo;
    if (it._chat.extras.some(e => e.url === url)) continue;
    try {
      const buf = await baixarPdf(url);
      let texto = await extrairTextoPdf(buf.slice(0));
      const trunc = texto.length > EXTRA_DOC_MAX;
      if (trunc) texto = texto.slice(0, EXTRA_DOC_MAX);
      it._chat.extras.push({ rotulo, url, texto, trunc });
    } catch (e) { falhas++; console.warn('Falha ao incluir doc extra:', rotulo, e.message); }
  }
  panel.style.display = 'none';
  renderExtras(it);
  const n = it._chat.extras.length;
  mostrarToast(`📎 ${n} documento(s) no Revisor${falhas ? ` · ${falhas} falharam` : ''}.`, falhas ? 'aviso' : 'sucesso');
}

function renderExtras(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const box = card.querySelector('[data-role=chat-extras]');
  const extras = it._chat?.extras || [];
  if (!extras.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const chars = extras.reduce((n, e) => n + (e.texto || '').length, 0);
  box.style.display = '';
  box.innerHTML = `<span class="an-extras-lbl">📎 Incluídos (${extras.length} · ~${Math.round(chars / 1000)}k car.):</span> `
    + extras.map(e => `<span class="an-extra-chip" title="${escapeHtml(e.url)}">${escapeHtml(e.rotulo)}${e.trunc ? ' ✂' : ''}<button data-rem-extra="${escapeHtml(e.url)}" title="Remover">✕</button></span>`).join('');
  box.querySelectorAll('[data-rem-extra]').forEach(b => b.addEventListener('click', () => {
    it._chat.extras = (it._chat.extras || []).filter(e => e.url !== b.dataset.remExtra);
    renderExtras(it);
  }));
  if (chars > 150000) mostrarToast('Muitos documentos incluídos — as perguntas podem ficar caras/lentas. Remova o que não precisar.', 'aviso');
}

// Aplica alinhamento (bloco) aos parágrafos tocados pela seleção, via marcador
// [[left|center|right|justify]] no início de cada parágrafo (substitui o anterior).
function aplicarAlinhamento(editor, al) {
  const v = editor.value;
  const s = editor.selectionStart ?? 0, e = editor.selectionEnd ?? s;
  let ini = v.lastIndexOf('\n\n', Math.max(0, s - 1)); ini = ini < 0 ? 0 : ini + 2;
  let fim = v.indexOf('\n\n', e); fim = fim < 0 ? v.length : fim;
  const novo = v.slice(ini, fim).split(/\n\n/).map(p => {
    const semMarca = p.replace(/^\s*\[\[(?:left|center|right|justify)\]\]\s*/i, '');
    if (/^\s*#{1,3}\s/.test(semMarca)) return semMarca;   // títulos não recebem alinhamento
    return `[[${al}]]${semMarca}`;
  }).join('\n\n');
  editor.value = v.slice(0, ini) + novo + v.slice(fim);
  editor.selectionStart = ini; editor.selectionEnd = ini + novo.length;
  editor.focus();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function entrarEdicaoAnalise(it) {
  if (!it.analise) return;
  if (typeof Quill === 'undefined') { mostrarToast('Editor não carregou — recarregue a extensão.', 'erro'); return; }
  const card     = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const conteudo = card.querySelector('[data-role=analise-conteudo]');
  const wrap     = card.querySelector('[data-role=quill-wrap]');
  const statusEl = card.querySelector('[data-role=autosave-status]');

  // Snapshot ANTES de mexer no estado (Cancelar reverte mesmo após autosaves).
  const snapshot = { ...it.analise };
  _autosaveState.set(it.chave, { snapshot, debounceId: null, salvando: false, dirty: false });

  const q = getQuill(card, it);
  // Conteúdo inicial em HTML: notas novas já são HTML; as antigas (markdown) são
  // convertidas (sem os marcadores sensíveis de acolhimento).
  const htmlInicial = notaEhHtml(it)
    ? sanitizarNotaHtml(it.analise.html || '')
    : renderMarkdown(mdSemAcolhimento(notaMd(it)));
  carregarHtmlNoQuill(card, q, htmlInicial);

  conteudo.style.display = 'none';
  wrap.style.display     = 'block';
  card.querySelector('[data-role=btn-editar]').style.display = 'none';
  card.querySelector('[data-role=btn-salvar-edicao]').style.display = 'inline-flex';
  card.querySelector('[data-role=btn-cancelar-edicao]').style.display = 'inline-flex';
  statusEl.style.display = 'inline';
  statusEl.textContent = '';
  statusEl.style.color = '#888';

  q.focus();
  sincronizarSeletorTamanho(card, q);
}

function agendarAutosave(it) {
  const st = _autosaveState.get(it.chave);
  if (!st) return;
  st.dirty = true;
  if (st.debounceId) clearTimeout(st.debounceId);
  setStatusAutosave(it, 'editando…', '#888');
  st.debounceId = setTimeout(() => executarAutosave(it), AUTOSAVE_DEBOUNCE_MS);
}

async function executarAutosave(it) {
  const st = _autosaveState.get(it.chave);
  if (!st) return;
  const card   = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card || !card._quill) return;
  const html = sanitizarNotaHtml(card._quill.root.innerHTML);
  if (!card._quill.getText().trim()) {
    setStatusAutosave(it, '⚠ vazio — não salvo', '#c08400');
    return;
  }
  if (st.salvando) {
    // Já tem um save em voo — reagenda para depois
    st.debounceId = setTimeout(() => executarAutosave(it), 400);
    return;
  }
  st.salvando = true;
  st.dirty = false;
  setStatusAutosave(it, 'salvando…', '#888');

  it.analise = {
    ...it.analise,
    formato:     'html',
    html,
    markdown:    htmlParaTexto(html),   // espelho em texto puro (busca/Revisor)
    editadoEm:   new Date().toISOString(),
    editadoPor:  state.config?.nomeUsuario || 'equipe',
  };

  try {
    await fbSalvarAnalise(it);
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setStatusAutosave(it, `✓ salvo às ${hora}`, '#0a8a3a');
  } catch (e) {
    console.warn('Autosave falhou:', e.message);
    setStatusAutosave(it, '⚠ erro — tentando de novo', '#c0392b');
    // Reagenda nova tentativa
    st.debounceId = setTimeout(() => executarAutosave(it), 5000);
  } finally {
    st.salvando = false;
    // Se mudou enquanto estávamos salvando, reagenda flush
    if (st.dirty && !st.debounceId) {
      st.debounceId = setTimeout(() => executarAutosave(it), AUTOSAVE_DEBOUNCE_MS);
    }
  }
}

function setStatusAutosave(it, texto, cor) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (!card) return;
  const el = card.querySelector('[data-role=autosave-status]');
  if (!el) return;
  el.textContent = texto;
  el.style.color = cor || '#888';
}

function limparEdicao(it) {
  const st = _autosaveState.get(it.chave);
  if (!st) return;
  if (st.debounceId) clearTimeout(st.debounceId);
  _autosaveState.delete(it.chave);   // o handler text-change do Quill só agenda se houver estado
}

function fecharEditorUI(card) {
  card.querySelector('[data-role=quill-wrap]').style.display = 'none';
  card.querySelector('[data-role=analise-conteudo]').style.display = '';
  card.querySelector('[data-role=btn-salvar-edicao]').style.display = 'none';
  card.querySelector('[data-role=btn-cancelar-edicao]').style.display = 'none';
  card.querySelector('[data-role=autosave-status]').style.display = 'none';
  card.querySelector('[data-role=btn-editar]').style.display = 'inline-flex';
}

function sairEdicaoAnalise(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  // Cancelar: reverte para o snapshot e re-grava no Firebase (para não
  // ficar persistido o estado intermediário que o autosave já enviou).
  const st = _autosaveState.get(it.chave);
  if (st && st.snapshot && it.analise && (it.analise.html !== st.snapshot.html || it.analise.markdown !== st.snapshot.markdown)) {
    it.analise = { ...st.snapshot };
    renderAnaliseCard(it);
    fbSalvarAnalise(it).catch(e => console.warn('Reverter no Firebase falhou:', e.message));
  }
  limparEdicao(it);
  fecharEditorUI(card);
}

async function salvarEdicaoAnalise(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const q    = card._quill;
  if (!q || !q.getText().trim()) { mostrarToast('Análise não pode ficar vazia.', 'aviso'); return; }
  const html = sanitizarNotaHtml(q.root.innerHTML);

  // Flush: cancela qualquer autosave pendente e grava agora.
  const st = _autosaveState.get(it.chave);
  if (st?.debounceId) { clearTimeout(st.debounceId); st.debounceId = null; }

  it.analise = {
    ...it.analise,
    formato:     'html',
    html,
    markdown:    htmlParaTexto(html),
    editadoEm:   new Date().toISOString(),
    editadoPor:  state.config?.nomeUsuario || 'equipe',
  };

  limparEdicao(it);
  fecharEditorUI(card);
  renderAnaliseCard(it);
  try {
    await fbSalvarAnalise(it);
    mostrarToast('✓ Análise atualizada', 'sucesso');
  } catch (e) {
    mostrarToast('Erro ao salvar no Firebase: ' + e.message, 'erro');
  }
}

// ============================================================
//  RENDER MARKDOWN MÍNIMO
// ============================================================
// Reescopa os marcadores de tamanho [[N]]…[[/]] para que sobrevivam às
// fronteiras de bloco. O marcador é inline (vira <span>/run de Word); quando a
// seleção abrange vários parágrafos, listas ou um título "##", o tamanho se
// perdia a partir do bloco seguinte. Aqui reaplicamos o tamanho linha a linha —
// mantendo os títulos sem tamanho (preservam a hierarquia) e deixando prefixos
// estruturais (marca de alinhamento e marcador de lista "- ") fora do tamanho,
// para não quebrar a detecção de lista/alinhamento adiante.
function reescoparTamanho(md) {
  if (!md || !/\[\[(?:10\.5|12|14|16)\]\]/.test(md)) return md || '';
  const tokenRe = /\[\[(10\.5|12|14|16)\]\]|\[\[\/\]\]/g;
  let limpo = '';
  const sizes = [];
  let cur = null, last = 0, m;
  const push = (txt) => { for (let k = 0; k < txt.length; k++) { limpo += txt[k]; sizes.push(cur); } };
  while ((m = tokenRe.exec(md)) !== null) {
    if (m.index > last) push(md.slice(last, m.index));
    cur = (m[0] === '[[/]]') ? null : m[1];
    last = m.index + m[0].length;
  }
  if (last < md.length) push(md.slice(last));

  const reHeading = /^\s*#{1,3}\s+/;
  const rePrefixo = /^(\s*(?:\[\[(?:left|center|right|justify)\]\]\s*)?(?:[-*]\s+)?)/i;
  const linhas = limpo.split('\n');
  let pos = 0;
  const out = linhas.map((linha) => {
    const inicio = pos;
    pos += linha.length + 1;                 // +1 do "\n" consumido pelo split
    if (reHeading.test(linha)) return linha;  // título: sem tamanho (opção b)
    const pre = (linha.match(rePrefixo) || [''])[0];
    let res = pre, i = pre.length;
    while (i < linha.length) {
      const sz = sizes[inicio + i];
      let j = i;
      while (j < linha.length && sizes[inicio + j] === sz) j++;
      const trecho = linha.slice(i, j);
      res += sz ? `[[${sz}]]${trecho}[[/]]` : trecho;
      i = j;
    }
    return res;
  });
  return out.join('\n');
}

// ============================================================
//  EDITOR VISUAL (Quill) + NOTAS EM HTML
//  Notas novas são editadas/salvas em HTML (WYSIWYG). As antigas, em markdown,
//  continuam sendo exibidas/exportadas via renderMarkdown.
// ============================================================
let _quillPronto = false;
function prepararQuill() {
  if (_quillPronto || typeof Quill === 'undefined') return;
  // Tamanho e alinhamento como ESTILO INLINE (não classe) — assim o HTML salvo
  // já carrega font-size/text-align e renderiza igual na tela, no PDF e no Word.
  const Size = Quill.import('attributors/style/size');
  Size.whitelist = ['10.5pt', '12pt', '14pt', '16pt'];
  Quill.register(Size, true);
  const Align = Quill.import('attributors/style/align');
  Quill.register(Align, true);
  _quillPronto = true;
}

const QUILL_TOOLBAR = [
  [{ header: [2, 3, false] }],
  ['bold', 'italic'],
  [{ size: ['10.5pt', '12pt', '14pt', '16pt'] }],
  [{ align: [] }],                                  // esquerda (padrão) / centro / direita / justificado
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['clean'],
];

// Cria (ou reaproveita) a instância do Quill do card.
function getQuill(card, it) {
  if (card._quill) return card._quill;
  prepararQuill();
  const el = card.querySelector('[data-role=quill-editor]');
  const q = new Quill(el, { theme: 'snow', placeholder: 'Edite a nota…', modules: { toolbar: QUILL_TOOLBAR } });
  // Garante a reimportação do tamanho (font-size inline) ao recarregar a nota —
  // mapeia o estilo de volta para o formato "size" do Quill.
  const SizeAttr = Quill.import('attributors/style/size');
  q.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
    const fs = node.style && node.style.fontSize;
    if (fs && SizeAttr.whitelist.includes(fs)) {
      delta.ops = delta.ops.map(op => (typeof op.insert === 'string'
        ? { ...op, attributes: { size: fs, ...(op.attributes || {}) } }
        : op));
    }
    return delta;
  });
  q.on('text-change', () => { if (!card._carregandoQuill && _autosaveState.has(it.chave)) agendarAutosave(it); });
  // Mantém o rótulo do seletor de tamanho refletindo o tamanho real onde está o
  // cursor (o <select> interno do Quill cairia na 1ª opção quando o texto está
  // no tamanho padrão). editor-change cobre digitação E movimentação do cursor.
  q.on('editor-change', () => sincronizarSeletorTamanho(card, q));
  card._quill = q;
  return q;
}

// Ajusta o data-value do rótulo do seletor de tamanho ao tamanho da seleção
// atual; sem tamanho explícito, remove o atributo (a CSS mostra "12pt (padrão)").
function sincronizarSeletorTamanho(card, q) {
  const lab = card.querySelector('.ql-picker.ql-size .ql-picker-label');
  if (!lab) return;
  const sel = q.getSelection();
  const size = (sel ? q.getFormat(sel.index, sel.length) : q.getFormat()).size;
  if (size) lab.setAttribute('data-value', size);
  else lab.removeAttribute('data-value');
}

// Carrega HTML no editor sem disparar autosave (durante a carga).
function carregarHtmlNoQuill(card, q, html) {
  card._carregandoQuill = true;
  try { q.setContents(q.clipboard.convert({ html: html || '<p></p>' })); }
  catch (_) { q.root.innerHTML = html || '<p></p>'; }
  card._carregandoQuill = false;
}

// Saneamento leve do HTML de uma nota (origem própria, mas a base é compartilhada):
// remove scripts/handlers e atributos perigosos.
function sanitizarNotaHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
  doc.querySelectorAll('.ql-ui').forEach(n => n.remove());   // elementos auxiliares do Quill
  // Quill 2.0 usa <ol><li data-list="bullet"> para marcadores. Converte para
  // <ul>/<ol> padrão, que renderizam na tela, no PDF e no Word sem o CSS do Quill.
  doc.querySelectorAll('ol').forEach(ol => {
    const lis = [...ol.querySelectorAll(':scope > li')];
    const ehBullet = lis.length > 0 && lis.every(li => li.getAttribute('data-list') === 'bullet');
    if (ehBullet) {
      const ul = doc.createElement('ul');
      while (ol.firstChild) ul.appendChild(ol.firstChild);
      ol.replaceWith(ul);
    }
  });
  doc.querySelectorAll('li[data-list]').forEach(li => li.removeAttribute('data-list'));
  // Remove parágrafos vazios no fim (o Quill deixa um <p><br></p> de sobra).
  let ultimo;
  while ((ultimo = doc.body.lastElementChild) && ultimo.tagName === 'P'
         && !ultimo.textContent.trim() && !ultimo.querySelector('img')) ultimo.remove();
  // Remove handlers/atributos perigosos e classes do Quill.
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'src' || n === 'contenteditable'
          || (n === 'class' && /\bql-/.test(a.value))
          || (n === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}

function htmlParaTexto(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('p,div,h1,h2,h3,li,br').forEach(el => el.append('\n'));
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// Remove de um HTML a seção cujo título casa o regex (até o próximo título).
function removerSecaoHtml(html, tituloRe) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  for (const h of [...doc.body.querySelectorAll('h1,h2,h3')]) {
    if (!tituloRe.test(h.textContent || '')) continue;
    let n = h.nextElementSibling; h.remove();
    while (n && !/^H[1-3]$/.test(n.tagName)) { const x = n.nextElementSibling; n.remove(); n = x; }
    break;
  }
  return doc.body.innerHTML;
}

function notaEhHtml(it) { return it.analise?.formato === 'html'; }

// HTML para EXIBIR a nota na tela (com selo de acolhimento quando markdown).
function notaDisplayHtml(it) {
  if (notaEhHtml(it)) return sanitizarNotaHtml(it.analise.html || '');
  return renderNotaTela(notaMd(it));
}

// HTML para IMPRESSÃO (PDF/Word): sem marcadores sensíveis; RF sem "Pontos de atenção".
function notaHtmlImpressao(it) {
  if (notaEhHtml(it)) {
    let h = sanitizarNotaHtml(it.analise.html || '');
    if (it.tipoCategoria === 'redacao_final') h = removerSecaoHtml(h, /Pontos\s+de\s+aten[çc]/i);
    return h;
  }
  return renderMarkdown(mdSemAcolhimento(notaMd(it)));
}

// Texto puro da nota (Revisor/chat, busca no histórico).
function notaTextoPlano(it) {
  if (notaEhHtml(it)) return htmlParaTexto(it.analise.html || '');
  return mdSemAcolhimento(it.analise?.markdown || '');
}

// Há conteúdo de nota? (markdown legado ou HTML novo)
function temNota(it) { return !!(it.analise && (it.analise.html || it.analise.markdown)); }

function renderMarkdown(md) {
  if (!md) return '';
  // Encurta referências longas a proposições ("Projeto de Lei nº 1234-G, de 12
  // de novembro de 2010" → "PL 1234/2010") antes de renderizar.
  md = encurtarProposicoes(md);
  md = reescoparTamanho(md);   // tamanho [[N]] sobrevive a títulos/parágrafos/listas
  // Escape básico
  let html = escapeHtml(md);
  // Um marcador de alinhamento colado antes de um título (ex.: ao justificar a
  // nota inteira) quebraria a detecção do heading e faria o "##" vazar. Títulos
  // não recebem alinhamento — removemos o marcador nesses casos.
  html = html.replace(/^[ \t]*\[\[(?:left|center|right|justify)\]\][ \t]*(?=#{1,3}\s)/gim, '');
  // Garante linha em branco após um título: sem ela, o corpo na linha seguinte
  // fica colado ao heading no mesmo bloco e não vira <p> (logo, não é alinhado).
  html = html.replace(/^(#{1,3}[ \t].+)\n(?!\n)/gm, '$1\n\n');
  // Headings
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // Bold/italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Tamanho de fonte — marcador [[N]]…[[/]] da barra de formatação do editor
  html = html.replace(/\[\[(10\.5|12|14|16)\]\]([\s\S]*?)\[\[\/\]\]/g, '<span style="font-size:$1pt">$2</span>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Listas
  html = html.replace(/(^|\n)(\s*[-*]\s+.+(?:\n\s*[-*]\s+.+)*)/g, (m, pre, bloco) => {
    const itens = bloco.split(/\n/).map(l => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
    return `${pre}<ul>${itens.map(i => `<li>${i}</li>`).join('')}</ul>`;
  });
  // Quebras de parágrafo (com alinhamento por marcador [[left|center|right|justify]]
  // no início do bloco, inserido pela barra de formatação do editor).
  html = html.split(/\n{2,}/).map(b => {
    let t = b.trim();
    if (/^<(h\d|ul|ol|pre|blockquote)/.test(t)) return b;
    let style = '';
    const am = t.match(/^\[\[(left|center|right|justify)\]\]\s*/i);
    if (am) { style = ` style="text-align:${am[1].toLowerCase()}"`; t = t.slice(am[0].length); }
    return `<p${style}>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

// ---------- Status de acolhimento dos apensados (marcador da IA) ----------
// A IA marca, na linha de avaliação de incorporação de cada apensado, um token
// [[ACOLHIMENTO:NIVEL NUMERO/ANO]] (NIVEL ∈ ACOLHIDO/PARCIAL/NAO). É informação
// SENSÍVEL: aparece só na tela (selo + chip), nunca no PDF distribuível.
const ACOLHIMENTO_ROTULO = { ACOLHIDO: 'Acolhido', PARCIAL: 'Acolhido parcialmente', NAO: 'Não acolhido' };

// Regexes tolerantes a espaços/caixa para o marcador não vazar no PDF caso a IA
// varie levemente o formato.
const RE_ACOLH = /\[\[\s*ACOLHIMENTO\s*:\s*(ACOLHIDO|PARCIAL|NAO)\s+(\d+)\s*\/\s*(\d{4})\s*\]\]/gi;
const RE_ACOLH_LINHA = /\[\[\s*ACOLHIMENTO\s*:/i;

function extrairStatusAcolhimento(md) {
  const out = {};
  if (!md) return out;
  const re = new RegExp(RE_ACOLH.source, 'gi');
  let m;
  // Chave numero-ano (NÃO usar "/", proibido em chaves do Firebase RTDB → HTTP 400).
  while ((m = re.exec(md))) out[`${m[2]}-${m[3]}`] = m[1].toUpperCase();
  return out;
}

// Render para a TELA: o marcador vira um selo colorido "(status)".
function renderNotaTela(md) {
  return renderMarkdown(md).replace(new RegExp(RE_ACOLH.source, 'gi'), (m, nivel) => {
    const n = nivel.toUpperCase();
    return `<span class="an-acolh an-acolh--${n.toLowerCase()}">(${ACOLHIMENTO_ROTULO[n]})</span> `;
  });
}

// Para o PDF: remove integralmente as linhas que contêm o marcador (o status de
// acolhimento é sensível e não deve constar no documento distribuível).
function mdSemAcolhimento(md) {
  if (!md) return md || '';
  return md.split('\n').filter(l => !RE_ACOLH_LINHA.test(l)).join('\n');
}

// ============================================================
//  GERAR ANÁLISE DE TODOS OS ITENS
// ============================================================
let _gerarTodasState = { rodando: false, cancelar: false };

function toggleGerarTodas() {
  if (_gerarTodasState.rodando) {
    _gerarTodasState.cancelar = true;
    return;
  }
  gerarTodasAsAnalises().catch(e => {
    console.error(e);
    mostrarToast('Erro: ' + e.message, 'erro');
  });
}

// Verifica UM item: garante EMS/SSP (cenários 5/6/7, que o enriquecimento padrão
// não busca), compara o texto operativo salvo com o atual e atualiza o badge.
// Guarda o resultado em it.desatualizacao. Retorna o resultado (ou null se N/A).
async function verificarAtualizacaoItem(it) {
  if (it.tipoCategoria !== 'projeto' || !it.analise?.documentos) return null;
  const enr = it.enriquecimento || (it.enriquecimento = {});
  if (enr.emendasSenado === undefined && enr.idProposicao) {
    try { enr.emendasSenado = await buscarEmendasSenadoESSP(enr.idProposicao); }
    catch (e) { enr.emendasSenado = { ems: null, ssp: null }; }
  }
  const desat = desatualizacaoOperativa(it) || { novos: [] };
  it.desatualizacao = desat;
  atualizarBadgesCard(it);
  return desat;
}

// Resumo legível dos documentos novos detectados.
function _resumoNovos(novos) {
  return novos.map(n => `${n.rotulo}${n.data ? ' de ' + n.data.split('-').reverse().join('/') : ''}`).join('; ');
}

// Botão individual do card.
async function verificarAtualizacaoItemUI(it) {
  const card = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const btn  = card?.querySelector('[data-role=btn-verificar-item]');
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="an-spinner"></span> Verificando...';
  try {
    const desat = await verificarAtualizacaoItem(it);
    mostrarToast(
      desat?.novos?.length
        ? `⚠ Pode estar desatualizada — documento mais recente: ${_resumoNovos(desat.novos)}`
        : '✓ Nota em dia com o texto operativo.',
      desat?.novos?.length ? 'aviso' : 'sucesso'
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// Botão global: verifica todos os projetos analisados e mostra um resumo.
async function verificarAtualizacoesPauta() {
  if (!state.pauta) return;
  const itens = (state.pauta.itens || []).filter(it => it.tipoCategoria === 'projeto' && it.analise?.documentos);
  if (!itens.length) { mostrarToast('Nenhuma análise de projeto para verificar.', 'info'); return; }

  const btn = document.getElementById('btn-verificar-atualizacoes');
  const orig = btn.innerHTML;
  btn.disabled = true;
  let feitos = 0, desatualizadas = 0;
  try {
    for (const it of itens) {
      btn.innerHTML = `<span class="an-spinner"></span> Verificando ${++feitos}/${itens.length}...`;
      const desat = await verificarAtualizacaoItem(it);
      if (desat?.novos?.length) desatualizadas++;
    }
    mostrarToast(
      desatualizadas
        ? `⚠ ${desatualizadas} de ${itens.length} nota(s) podem estar desatualizadas.`
        : `✓ Todas as ${itens.length} notas estão em dia com o texto operativo.`,
      desatualizadas ? 'aviso' : 'sucesso'
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function gerarTodasAsAnalises() {
  if (!state.pauta) return;
  await carregarConfig();
  if (!state.config?.apiKey) {
    mostrarToast('Configure a chave de API antes (⚙ Configurações).', 'aviso');
    return;
  }

  // Apenas itens ainda sem análise. MPVs (Cenário 8) ficam de fora: são de
  // edição livre, escritas manualmente pelo analista.
  const pendentes = state.pauta.itens.filter(it => it.analiseStatus !== 'ok' && !ehMPV(it));
  if (!pendentes.length) {
    const temMPVPendente = state.pauta.itens.some(it => ehMPV(it) && it.analiseStatus !== 'ok');
    mostrarToast(temMPVPendente
      ? 'Itens com IA já analisados. MPVs são de edição livre — use "Escrever análise" em cada uma.'
      : 'Todos os itens já têm análise.', 'info');
    return;
  }

  _gerarTodasState = { rodando: true, cancelar: false };
  const btn = document.getElementById('btn-gerar-todas');
  const labelOriginal = btn.innerHTML;
  let ok = 0, truncadas = 0, falhas = 0, canceladas = 0;

  for (let i = 0; i < pendentes.length; i++) {
    if (_gerarTodasState.cancelar) { canceladas = pendentes.length - i; break; }
    const it = pendentes[i];
    btn.innerHTML = `<span class="an-spinner"></span> ${i + 1}/${pendentes.length} — Cancelar`;
    try {
      await gerarAnaliseItem(it);
      if (it.analiseStatus === 'ok') {
        ok++;
        if (it.analise?.truncada) truncadas++;
      } else if (_gerarTodasState.cancelar) {
        canceladas = pendentes.length - i; break;
      } else {
        falhas++;
      }
    } catch (e) {
      if (isAbortError(e) || _gerarTodasState.cancelar) {
        canceladas = pendentes.length - i; break;
      }
      console.warn(`Falha em ${it.chave}:`, e);
      falhas++;
    }
    if (i < pendentes.length - 1 && !_gerarTodasState.cancelar) {
      try { await sleep(1500, _abortAll.signal); }
      catch (e) { if (isAbortError(e)) { canceladas = pendentes.length - i - 1; break; } }
    }
  }

  _gerarTodasState = { rodando: false, cancelar: false };
  btn.innerHTML = labelOriginal;
  const partes = [`${ok} gerada(s)`];
  if (truncadas)  partes.push(`${truncadas} truncada(s) — use "Completar"`);
  if (falhas)     partes.push(`${falhas} falha(s)`);
  if (canceladas) partes.push(`${canceladas} cancelada(s)`);
  const tom = canceladas ? 'aviso' : (falhas || truncadas ? 'aviso' : 'sucesso');
  mostrarToast((canceladas ? 'Lote interrompido: ' : 'Lote concluído: ') + partes.join(' · '), tom);
}

// ============================================================
//  VARREDURA DE ANÁLISES ÓRFÃS
// ============================================================
/**
 * Lê todas as pautas e todas as análises do Firebase. Para cada análise
 * em /analises_pauta/{chave}/{parecerKey}, verifica se há ao menos uma
 * pauta que contenha um item com aquela chave E parecerKey computada.
 * Se não houver, DELETE.
 *
 * @param {boolean} verbose - se true mostra status no modal de Configurações.
 */
async function varrerAnalisesOrfas(verbose) {
  const stEl = document.getElementById('varrer-status');
  if (verbose && stEl) stEl.textContent = 'Coletando dados...';

  try {
    const [pautasRes, analisesRes] = await Promise.all([
      fetch(`${FIREBASE_URL}/pautas.json`),
      fetch(`${FIREBASE_URL}/analises_pauta.json?shallow=false`),
    ]);
    const pautas   = pautasRes.ok   ? (await pautasRes.json())   : {};
    const analises = analisesRes.ok ? (await analisesRes.json()) : {};
    if (!analises) {
      if (verbose && stEl) stEl.textContent = '✓ Nada para limpar.';
      return { removidas: 0 };
    }

    // Conjunto de pares "chave|parecerKey" referenciados por alguma pauta
    const refs = new Set();
    for (const p of Object.values(pautas || {})) {
      for (const it of (p?.itens || [])) {
        if (!it?.chave) continue;
        refs.add(`${it.chave}|${parecerKey(it)}`);
      }
    }

    // Identifica órfãos
    const deletes = [];
    for (const [chave, porParecer] of Object.entries(analises)) {
      if (!porParecer || typeof porParecer !== 'object') continue;
      for (const pk of Object.keys(porParecer)) {
        if (!refs.has(`${chave}|${pk}`)) {
          const url = `${FIREBASE_URL}/analises_pauta/${encodeURIComponent(chave)}/${encodeURIComponent(pk)}.json`;
          deletes.push(fetch(url, { method: 'DELETE' }).catch(() => {}));
        }
      }
    }

    await Promise.all(deletes);

    if (verbose && stEl) {
      stEl.textContent = deletes.length
        ? `✓ ${deletes.length} análise(s) órfã(s) removida(s).`
        : '✓ Nenhuma análise órfã encontrada.';
    } else if (deletes.length) {
      console.log(`[varredura] removidas ${deletes.length} análise(s) órfã(s)`);
    }
    return { removidas: deletes.length };
  } catch (e) {
    if (verbose && stEl) stEl.textContent = `Erro: ${e.message}`;
    throw e;
  }
}

// ============================================================
//  SIDEBAR DE PAUTAS
// ============================================================
let _pautaParaApagar = null;

async function atualizarSidebarPautas() {
  const cont = document.getElementById('sidebar-pautas');
  try {
    const res = await fetch(`${FIREBASE_URL}/pautas.json?shallow=false`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const lista = data ? Object.entries(data).map(([id, p]) => ({ id, ...p })) : [];
    lista.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

    if (!lista.length) {
      cont.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:12px">Nenhuma pauta salva. Carregue um PDF para começar.</div>';
      return;
    }

    const ativaId = state.pauta?.id;
    cont.innerHTML = lista.map(p => `
      <div class="an-pauta-item ${p.id === ativaId ? 'ativo' : ''}" data-pid="${escapeHtml(p.id)}">
        <div class="an-pauta-item-info">
          <div class="an-pauta-item-titulo">${escapeHtml(p.nome || p.periodo || p.titulo || p.id)}</div>
          <div class="an-pauta-item-meta">${(p.itens || []).length} itens · ${formatDataHora(p.uploadedAt)}</div>
        </div>
        <button class="an-pauta-item-apagar" data-pid="${escapeHtml(p.id)}" title="Apagar pauta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    `).join('');

    cont.querySelectorAll('.an-pauta-item').forEach(el => {
      el.addEventListener('click', ev => {
        if (ev.target.closest('.an-pauta-item-apagar')) return;
        carregarPautaPorId(el.dataset.pid);
      });
    });
    cont.querySelectorAll('.an-pauta-item-apagar').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const p = lista.find(x => x.id === btn.dataset.pid);
        abrirModalApagarPauta(p);
      });
    });
  } catch (e) {
    cont.innerHTML = `<div style="padding:16px;color:#ff8e8e;font-size:12px">Erro ao listar: ${escapeHtml(e.message)}</div>`;
  }
}

async function carregarPautaPorId(id) {
  try {
    const res = await fetch(`${FIREBASE_URL}/pautas/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const pauta = await res.json();
    if (!pauta) throw new Error('Pauta não encontrada');
    state.pauta = {
      ...pauta,
      itens: (pauta.itens || []).map(it => ({
        ...it,
        enriquecimento: { status: 'pendente' },
        analise: null,
        analiseStatus: 'sem_analise',
      })),
    };
    renderizarPauta();
    document.getElementById('btn-exportar-pdf').disabled = false;
    document.getElementById('btn-exportar-docx').disabled = false;
    document.getElementById('btn-salvar-firebase').disabled = false;
    document.getElementById('btn-adicionar-item').disabled = false;
    document.getElementById('btn-gerar-todas').disabled = false;
    document.getElementById('btn-verificar-atualizacoes').disabled = false;
    document.getElementById('btn-prop-partido').disabled = false;
    document.getElementById('btn-resumo-sessao').disabled = false;
    document.getElementById('btn-apelidos').disabled = false;
    document.getElementById('btn-recategorizar').disabled = false;
    state.ultimoSave = state.pauta.uploadedAt || new Date().toISOString();
    state.dirty = false;
    atualizarStatusSync('ok');
    atualizarSidebarPautas();
    for (const it of state.pauta.itens) {
      fbCarregarAnalise(it).then(a => {
        if (a) { it.analise = a; it.analiseStatus = 'ok'; renderAnaliseCard(it); }
      }).catch(() => {});
    }
    enriquecerItens();
  } catch (e) {
    mostrarToast('Erro ao carregar pauta: ' + e.message, 'erro');
  }
}

function abrirModalApagarPauta(p) {
  _pautaParaApagar = p;
  document.getElementById('apagar-pauta-nome').textContent =
    `"${p.nome || p.periodo || p.titulo || p.id}" (${(p.itens || []).length} itens)`;
  document.getElementById('modal-apagar-pauta').style.display = 'flex';
}

async function confirmarApagarPauta() {
  if (!_pautaParaApagar) return;
  const id = _pautaParaApagar.id;
  const itens = _pautaParaApagar.itens || [];
  document.getElementById('modal-apagar-pauta').style.display = 'none';
  try {
    // 1. Apaga as análises de cada item desta pauta no caminho
    //    /analises_pauta/{chave}/{parecerKey}. Outras versões (outros pareceres
    //    da mesma proposição vinculadas a outras pautas) são preservadas.
    const deletes = itens
      .filter(it => it.chave)
      .map(it => {
        const pk = parecerKey(it);
        const url = `${FIREBASE_URL}/analises_pauta/${encodeURIComponent(it.chave)}/${encodeURIComponent(pk)}.json`;
        return fetch(url, { method: 'DELETE' }).catch(() => {});
      });
    await Promise.all(deletes);

    // 2. Apaga a pauta em si
    const res = await fetch(`${FIREBASE_URL}/pautas/${encodeURIComponent(id)}.json`, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (state.pauta?.id === id) {
      state.pauta = null;
      document.getElementById('lista-itens').innerHTML = '<div class="an-empty"><p>Pauta removida. Selecione outra ou carregue um novo PDF.</p></div>';
      document.getElementById('pauta-titulo').textContent = 'Nenhuma pauta carregada';
      document.getElementById('btn-renomear-pauta').style.display = 'none';
      document.getElementById('pauta-meta').textContent   = 'Selecione uma pauta no menu ou carregue um novo PDF';
      document.getElementById('btn-exportar-pdf').disabled    = true;
      document.getElementById('btn-exportar-docx').disabled   = true;
      document.getElementById('btn-salvar-firebase').disabled = true;
      document.getElementById('btn-adicionar-item').disabled  = true;
    }
    _pautaParaApagar = null;
    await atualizarSidebarPautas();
    mostrarToast('✓ Pauta apagada do Firebase', 'sucesso');
  } catch (e) {
    mostrarToast('Erro ao apagar: ' + e.message, 'erro');
  }
}

// ============================================================
//  FIREBASE — PAUTA + ANÁLISES
// ============================================================
async function fbSalvarPauta(pauta) {
  state.salvando = true;
  atualizarStatusSync('salvando');
  // Atualiza sidebar após salvamento (concorrente, não bloqueia)
  setTimeout(atualizarSidebarPautas, 300);
  // Salva sem o PDF binário inflando demais — guarda em campo separado.
  const res = await fetch(`${FIREBASE_URL}/pautas/${pauta.id}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...pauta,
      // Itens enxutos para Firebase (sem campos transientes)
      itens: pauta.itens.map(it => ({
        ordem: it.ordem, tipoCategoria: it.tipoCategoria,
        sigla: it.sigla, numero: it.numero, ano: it.ano,
        ementa: it.ementa, autorTexto: it.autorTexto,
        apensadosTexto: it.apensadosTexto, relator: it.relator,
        temUrgencia: it.temUrgencia, projetoUrgenciado: it.projetoUrgenciado || null,
        chave: it.chave,
      })),
    }),
  });
  state.salvando = false;
  if (!res.ok) {
    atualizarStatusSync('offline');
    throw new Error(`Firebase HTTP ${res.status}`);
  }
  state.dirty = false;
  state.ultimoSave = new Date().toISOString();
  state.historico.indice = null;   // invalida o cache da busca no histórico
  atualizarStatusSync('ok');
}

function marcarSujo() {
  state.dirty = true;
  atualizarStatusSync('pendente');
}

function atualizarStatusSync(estado) {
  const bar = document.getElementById('an-sync');
  const txt = bar?.querySelector('.an-sync-texto');
  if (!bar || !txt) return;
  if (!state.pauta) { bar.style.display = 'none'; return; }
  bar.style.display = 'inline-flex';
  bar.className = 'an-sync ' + estado;
  if (estado === 'ok') {
    const hh = new Date(state.ultimoSave || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    txt.textContent = `Sincronizado às ${hh}`;
  } else if (estado === 'salvando') {
    txt.textContent = 'Sincronizando…';
  } else if (estado === 'offline') {
    txt.textContent = 'Offline — alterações em memória';
  } else if (estado === 'pendente') {
    txt.textContent = 'Alterações pendentes…';
  } else {
    txt.textContent = '';
  }
}

function iniciarAutoSave() {
  pararAutoSave();
  state.syncTimer = setInterval(autoSaveTick, AUTO_SAVE_INTERVAL_MS);
}
function pararAutoSave() {
  if (state.syncTimer) { clearInterval(state.syncTimer); state.syncTimer = null; }
}
async function autoSaveTick() {
  if (!state.pauta || !state.dirty || state.salvando) return;
  try {
    await fbSalvarPauta(state.pauta);
  } catch (e) {
    console.warn('Auto-save falhou:', e.message);
  }
}

async function carregarUltimaPauta() {
  try {
    const res = await fetch(`${FIREBASE_URL}/pautas.json?orderBy="uploadedAt"&limitToLast=1`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data) return;
    const pauta = Object.values(data)[0];
    if (!pauta?.itens?.length) return;

    state.pauta = {
      ...pauta,
      itens: pauta.itens.map(it => ({
        ...it,
        enriquecimento: { status: 'pendente' },
        analise: null,
        analiseStatus: 'sem_analise',
      })),
    };
    renderizarPauta();
    document.getElementById('btn-exportar-pdf').disabled = false;
    document.getElementById('btn-exportar-docx').disabled = false;
    document.getElementById('btn-salvar-firebase').disabled = false;
    document.getElementById('btn-adicionar-item').disabled = false;
    document.getElementById('btn-gerar-todas').disabled = false;
    document.getElementById('btn-verificar-atualizacoes').disabled = false;
    document.getElementById('btn-prop-partido').disabled = false;
    document.getElementById('btn-resumo-sessao').disabled = false;
    document.getElementById('btn-apelidos').disabled = false;
    document.getElementById('btn-recategorizar').disabled = false;
    state.ultimoSave = state.pauta.uploadedAt || new Date().toISOString();
    state.dirty = false;
    atualizarStatusSync('ok');

    // Carrega análises existentes em paralelo
    for (const it of state.pauta.itens) {
      fbCarregarAnalise(it).then(a => {
        if (a) {
          it.analise = a;
          it.analiseStatus = 'ok';
          renderAnaliseCard(it);
        }
      }).catch(() => {});
    }

    enriquecerItens();
  } catch (e) {
    console.warn('Falha ao carregar última pauta:', e.message);
  }
}

function caminhoAnalise(it) {
  // Não usa idProposicao (pode ainda não ter sido resolvido); usa chave estável.
  return `${FIREBASE_URL}/analises_pauta/${encodeURIComponent(it.chave)}/${encodeURIComponent(parecerKey(it))}.json`;
}

async function fbCarregarAnalise(it) {
  const res = await fetch(caminhoAnalise(it));
  if (!res.ok) return null;
  return await res.json();
}

async function fbSalvarAnalise(it) {
  const res = await fetch(caminhoAnalise(it), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(it.analise),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  // Atualiza o indicador também para salvamentos de análise individual,
  // já que o usuário enxerga isso como um "save" do painel.
  state.ultimoSave = new Date().toISOString();
  atualizarStatusSync('ok');
}

// ============================================================
//  FIREBASE — BIBLIOTECA DE PROMPTS (compartilhada pela equipe)
// ============================================================
async function fbCarregarPrompts() {
  const res = await fetch(`${FIREBASE_URL}/prompts_analise.json`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data) return [];
  return Object.entries(data)
    .map(([id, p]) => ({ ...p, id }))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}

async function fbSalvarPrompt(p) {
  const id = p.id || ('p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const corpo = {
    nome:         p.nome,
    texto:        p.texto,
    criadoPor:    p.criadoPor || state.config?.nomeUsuario || 'equipe',
    criadoEm:     p.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  const res = await fetch(`${FIREBASE_URL}/prompts_analise/${encodeURIComponent(id)}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  return { ...corpo, id };
}

async function fbApagarPrompt(id) {
  const res = await fetch(`${FIREBASE_URL}/prompts_analise/${encodeURIComponent(id)}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}

async function fbCarregarPromptPadrao() {
  const res = await fetch(`${FIREBASE_URL}/prompts_analise_padrao.json`);
  if (!res.ok) return null;
  return await res.json(); // string com o id, ou null
}

async function fbSalvarPromptPadrao(id) {
  const res = await fetch(`${FIREBASE_URL}/prompts_analise_padrao.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id || null),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}

// Carrega a biblioteca + o prompt-padrão (ambos compartilhados) para o estado.
async function carregarBibliotecaPrompts() {
  const [lista, padraoId] = await Promise.all([fbCarregarPrompts(), fbCarregarPromptPadrao()]);
  state.promptsBiblioteca = lista;
  state.promptPadraoId    = padraoId || null;
}

// Texto/nome do prompt-padrão atual (ou vazio se não houver).
function instrucoesPromptPadrao() {
  const id = state.promptPadraoId;
  if (!id) return { texto: '', nome: '' };
  const p = (state.promptsBiblioteca || []).find(x => x.id === id);
  return p ? { texto: p.texto || '', nome: p.nome || '' } : { texto: '', nome: '' };
}

// ============================================================
//  EXPORTAR PDF (via window.print da própria página)
// ============================================================
async function carregarLogoDataUrl() {
  try {
    const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL('icons/podemos-logo.png')
      : 'icons/podemos-logo.png';
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.onerror   = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Logo não carregada:', e.message);
    return null;
  }
}

// ---------- Título "o que será votado" + apelido (para índice e cabeçalhos) ----------

// Normaliza referências legislativas para a forma curta usada no índice/títulos
// do PDF (NÃO altera o corpo das análises). Ex.:
//  "Projeto de Lei nº 3.801 de 2024" → "PL 3801/2024"
//  "Lei nº 7.405, de 12 de novembro de 1985" → "Lei 7405/1985"
function normalizarReferencias(texto) {
  if (!texto) return texto || '';
  let t = texto;
  t = t.replace(/Projeto de Lei\s+Complementar\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(\d{4})/gi, (m, n, a) => `PLP ${n.replace(/\./g, '')}/${a}`);
  t = t.replace(/Projeto de Lei\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(\d{4})/gi, (m, n, a) => `PL ${n.replace(/\./g, '')}/${a}`);
  t = t.replace(/\bLei\s+Complementar\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(?:\d{1,2}[ºo]?\s+de\s+\w+\s+de\s+)?(\d{4})/gi, (m, n, a) => `Lei Complementar ${n.replace(/\./g, '')}/${a}`);
  t = t.replace(/\bLei\s+n?[º°o.\s]*([\d.]+)[,\s]+de\s+(?:\d{1,2}[ºo]?\s+de\s+\w+\s+de\s+)?(\d{4})/gi, (m, n, a) => `Lei ${n.replace(/\./g, '')}/${a}`);
  return t;
}

// Encurta referências longas a proposições no corpo da nota — "Projeto de Lei
// nº 1234-G, de 12 de novembro de 2010" → "PL 1234/2010" — cobrindo sufixo de
// letra (-A/-G), data por extenso e a forma "nº X/AAAA". NÃO toca em "Lei nº…"
// (citações de normas vigentes ficam intactas).
function encurtarProposicoes(t) {
  if (!t) return t || '';
  const ano = '(?:\\s*[-–][A-Z]+)?\\s*(?:,?\\s*de\\s+(?:\\d{1,2}[ºo]?\\s+de\\s+[a-zà-ú]+\\s+de\\s+)?|\\/)\\s*(\\d{4})';
  const sub = (frase, sigla) => { t = t.replace(new RegExp(frase + '\\s+n?[º°o.\\s]*([\\d.]+)' + ano, 'gi'), (m, n, a) => `${sigla} ${n.replace(/\./g, '')}/${a}`); };
  sub('Projeto\\s+de\\s+Lei\\s+Complementar', 'PLP');
  sub('Projeto\\s+de\\s+Lei', 'PL');
  sub('Proposta\\s+de\\s+Emenda\\s+[àaÀA]\\s+Constitui[çc][ãa]o', 'PEC');
  sub('Projeto\\s+de\\s+Decreto\\s+Legislativo', 'PDL');
  sub('Medida\\s+Provis[óo]ria', 'MPV');
  sub('Projeto\\s+de\\s+Resolu[çc][ãa]o', 'PRC');
  return t;
}

// Remove uma seção "## <título>" inteira (até o próximo "## " ou o fim).
function removerSecao(md, tituloRegex) {
  if (!md) return md || '';
  return md.replace(new RegExp('(?:^|\\n)\\s*##\\s*' + tituloRegex + '[^\\n]*\\n[\\s\\S]*?(?=\\n##\\s|$)', 'i'), '').trim();
}

// Markdown da nota pronto para exibição: na Redação Final, retira a seção
// "Pontos de atenção para o Podemos" (descontinuada nesse tipo).
function notaMd(it) {
  let md = it.analise?.markdown || '';
  if (it.tipoCategoria === 'redacao_final') md = removerSecao(md, 'Pontos\\s+de\\s+aten[çc][ãa]o');
  return md;
}

// Relatoria do Podemos em Plenário (o relator do item é deputado(a) do partido).
function relatoriaPodemos(it) {
  return /\bPODE\b/i.test(it.relator?.partido || '');
}

// Proposição "alvo" do item (para requerimento, é o projeto cuja urgência se pede).
function _alvoItem(it) {
  return (it.tipoCategoria === 'requerimento' && it.projetoUrgenciado) ? it.projetoUrgenciado : it;
}

// "O que será votado" — sem apelido.
function tituloVotacao(it) {
  if (it.tipoCategoria === 'requerimento') {
    const a = it.projetoUrgenciado;
    return a ? `Urgência ao ${tipoLabel(a.sigla)} ${a.numero}/${a.ano}` : 'Requerimento de urgência';
  }
  if (it.tipoCategoria === 'redacao_final') return `Redação Final do ${tipoLabel(it.sigla)} ${it.numero}/${it.ano}`;
  return `${tipoLabel(it.sigla)} ${it.numero}/${it.ano}`;
}

// Título completo: "o que será votado (apelido)". O apelido vem da geração da
// nota (salvo em it.analise.apelido) ou do cache de sessão (it.apelido).
function tituloComApelido(it) {
  const ap = (it.apelido || it.analise?.apelido || '').trim();
  return tituloVotacao(it) + (ap ? ` (${ap})` : '');
}

// Sufixo de autoria para o índice do PDF — "A" quando a matéria é de autoria de
// deputado(a) do Podemos e "AP" quando há apensado de autoria Podemos. Ambos
// podem aparecer: "PL 1234/2056 (apelido) — A, AP".
function sufixoAutoriaIndice(it) {
  const enr = it.enriquecimento || {};
  const tags = [];
  if (enr.autoriaPodemos) tags.push(enr.autoriaPrincipalPodemos === false ? 'CA' : 'A');
  if ((enr.apensadosPodemos || []).length) tags.push('AP');
  if (relatoriaPodemos(it)) tags.push('R');
  return tags.length ? ' — ' + tags.join(', ') : '';
}

// Rótulo do vínculo de autoria do Podemos com o projeto: distingue autor
// principal (1º signatário/proponente) de coautor. Retorna null se não houver.
// Dados antigos sem 'autoriaPrincipalPodemos' contam como autor (compat.).
function rotuloAutoriaPodemos(it) {
  const enr = it.enriquecimento || {};
  if (!enr.autoriaPodemos) return null;
  return enr.autoriaPrincipalPodemos === false ? 'Coautoria' : 'Autoria';
}

// Realça (negrito + sublinhado) o nome do(s) deputado(s) do Podemos na linha de
// autoria da nota. Retorna HTML já escapado. Quando não há texto de autoria da
// pauta, monta a linha a partir dos autores trazidos pela API.
function htmlAutorRealcado(it) {
  const enr = it.enriquecimento || {};
  let base = (it.autorTexto || '').trim();
  if (!base && (enr.autores || []).length) {
    base = enr.autores.map(a => a.nome).filter(Boolean).join(', ');
  }
  let html = escapeHtml(base);
  const podeNomes = (enr.autores || []).filter(a => a.isPodemos && a.nome).map(a => a.nome);
  for (const nome of podeNomes) {
    const nEsc = escapeHtml(nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('(' + nEsc + ')', 'i'), '<u><strong>$1</strong></u>');
  }
  return html;
}

// Apelido de reserva (sem IA): primeira oração da ementa, encurtada e normalizada.
function apelidoFallback(it) {
  const alvo = _alvoItem(it);
  let e = normalizarReferencias((alvo.ementa || it.ementa || '').replace(/\s+/g, ' ').trim());
  if (!e) return '';
  const corte = (e.split(/[.;]/)[0] || e).trim();
  const max = 60;
  if (corte.length <= max) return corte.replace(/[\s,;.:-]+$/, '');
  const c = corte.slice(0, max), sp = c.lastIndexOf(' ');
  return (sp > max * 0.6 ? c.slice(0, sp) : c).replace(/[\s,;.:-]+$/, '') + '…';
}

function promptApelido(it) {
  const alvo = _alvoItem(it);
  const ementa = (alvo.ementa || it.ementa || '').replace(/\s+/g, ' ').slice(0, 500);
  return `Escreva um "apelido" curto (no máximo 8 palavras), em Português do Brasil, que capture o OBJETO/efeito principal da proposição ${tipoLabel(alvo.sigla)} ${alvo.numero}/${alvo.ano}, para uso entre parênteses num índice de pauta. Descreva em linguagem direta o que a matéria faz ou cria (ex.: "Institui a política Mulheres em Movimento", "Cota de aprendizes para pessoas com deficiência", "Regime disciplinar para presos de alta periculosidade"). NÃO cite números de lei nem de proposição (não escreva "Lei 7405/1985" nem "PL 3801/2024") — foque no conteúdo, não na norma alterada. Não use aspas nem ponto final. Responda APENAS com o apelido.\n\nEmenta: "${ementa}"`;
}

async function gerarApelidoIA(it, cfg) {
  const r = await chamarIA({ ...cfg, prompt: promptApelido(it), pdfBuffers: [] });
  const ap = (r.text || '').replace(/^["'\s]+|["'\s.]+$/g, '').trim();
  return normalizarReferencias(ap);
}

// Garante it.apelido para todos os itens: gera por IA quando há chave; senão usa
// o apelido de reserva da ementa. Cacheia em it.apelido para a sessão.
async function prepararApelidos(itens) {
  // Reaproveita o apelido já gerado com a nota (salvo em it.analise.apelido) —
  // não refaz chamada para esses itens.
  for (const it of itens) if (!it.apelido && it.analise?.apelido) it.apelido = it.analise.apelido;
  const cfg = { provedorId: state.config?.provedor || 'gemini', apiKey: state.config?.apiKey, modelo: state.config?.modelo };
  if (!cfg.apiKey) {
    for (const it of itens) if (!it.apelido) it.apelido = apelidoFallback(it);
    return;
  }
  const pend = itens.filter(it => !it.apelido);
  if (!pend.length) return;
  iaInFlightInc();
  try {
    let feitos = 0;
    await Promise.all(pend.map(async it => {
      try {
        it.apelido = (await gerarApelidoIA(it, cfg)) || apelidoFallback(it);
      } catch (e) {
        if (isAbortError(e)) throw e;
        it.apelido = apelidoFallback(it);
      }
      mostrarToast(`Gerando apelidos… ${++feitos}/${pend.length}`, 'info');
    }));
  } finally {
    iaInFlightDec();
  }
}

// HTML de impressão da pauta — cabeçalho institucional (padrão do módulo do
// Congresso), índice clicável com nº de página (Paged.js / target-counter) e os
// itens com título "o que será votado (apelido)".
function _htmlImpressaoPautaPlenario(pauta, logoDataUrl, renumerar) {
  const esc = escapeHtml;
  const bm  = chave => 'i_' + String(chave).replace(/[^\w]/g, '_');
  // Numeração: ao exportar um subconjunto selecionado, renumera de 1; do
  // contrário usa o nº da tela (it.ordem).
  const num = (it, i) => ((renumerar ? i + 1 : (it.ordem ?? i + 1)) + '. ');
  const itens = pauta.itens || [];
  const placeholder = st => st === 'erro' ? 'Falha ao gerar análise.' : st === 'gerando' ? 'Análise em processamento.' : 'Análise não gerada.';
  // O título já inclui o período ("Pauta — <período>"); não repetir o período
  // nem o horário de geração.
  const meta = `${esc(pauta.nome || pauta.titulo || '')} · ${itens.length} item(ns)`;

  // Legenda das marcas — só lista as que de fato aparecem em algum item.
  const legItens = [];
  if (itens.some(it => it.enriquecimento?.autoriaPodemos && it.enriquecimento?.autoriaPrincipalPodemos !== false)) legItens.push('<b>A</b> = Autoria do Podemos');
  if (itens.some(it => it.enriquecimento?.autoriaPodemos && it.enriquecimento?.autoriaPrincipalPodemos === false)) legItens.push('<b>CA</b> = Coautoria do Podemos');
  if (itens.some(it => (it.enriquecimento?.apensadosPodemos || []).length)) legItens.push('<b>AP</b> = Autoria do Podemos em apensado');
  if (itens.some(it => relatoriaPodemos(it))) legItens.push('<b>R</b> = Relatoria do Podemos em Plenário');
  const legenda = legItens.length ? `<p class="indice-legenda">${legItens.join(' · ')}</p>` : '';

  const indice = itens.length ? `
    <section class="indice">
      <h2>Índice</h2>
      ${legenda}
      <ul>
        ${itens.map((it, i) => `<li><a href="#${bm(it.chave)}"><span class="t">${esc(num(it, i) + tituloComApelido(it))}${esc(sufixoAutoriaIndice(it))}</span><span class="ld"></span></a></li>`).join('')}
      </ul>
    </section>` : '';

  const itensHtml = itens.map((it, i) => {
    const autor   = it.autorTexto || (it.enriquecimento?.autores || []).length;
    const autorHtml = htmlAutorRealcado(it);
    const relator = it.relator ? ` · Relator: Dep. ${esc(it.relator.nome)} (${esc(it.relator.partido)}-${esc(it.relator.uf)})` : '';
    const analista = it.analista || it.analise?.analista || '';
    const analistaHtml = analista ? `<div class="responsavel">Responsável: <b>${esc(analista)}</b></div>` : '';
    // Link para a ficha da proposição no portal da Câmara (logo abaixo do
    // Responsável). Usa o id resolvido no enriquecimento (para requerimento, é o
    // projeto cuja urgência se pede). Só aparece quando o id está disponível.
    const idProp = it.enriquecimento?.idProposicao;
    const portalHtml = idProp ? `<div class="portal"><a href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${idProp}">Ver no portal ↗</a></div>` : '';
    const badges  = `${it.enriquecimento?.autoriaPodemos ? `<span class="badge badge-pode">★ ${esc(rotuloAutoriaPodemos(it))} Podemos</span>` : ''}${(it.enriquecimento?.apensadosPodemos || []).map(ap => `<span class="badge badge-apens">Apensado Podemos: ${esc(ap.siglaTipo)} ${esc(ap.numero)}/${esc(ap.ano)}</span>`).join('')}${relatoriaPodemos(it) ? '<span class="badge badge-rel">Relatoria Podemos em Plenário</span>' : ''}`;
    const corpo   = temNota(it) ? notaHtmlImpressao(it) : `<div class="pendente">${placeholder(it.analiseStatus)}</div>`;
    return `<div class="bloco" id="${bm(it.chave)}">
      <h3 class="item-h">${esc(num(it, i) + tituloComApelido(it))}</h3>
      ${(autor || relator) ? `<div class="item-meta">${autorHtml}${relator}</div>` : ''}
      ${badges ? `<div class="badges">${badges}</div>` : ''}
      ${analistaHtml}
      ${portalHtml}
      ${corpo}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(pauta.nome || pauta.titulo || 'Pauta de Plenário')}</title>
  <style>
    @page { size:A4; margin:16mm; @bottom-center { content: counter(page); font-size:9pt; color:#888; } }
    * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { font-family:'Segoe UI',Arial,sans-serif; color:#1a1a1a; margin:0; }
    .cab { display:flex; align-items:center; gap:16px; }
    .cab .tit { flex:1; text-align:center; }
    .cab .tit h1 { font-size:16pt; font-weight:700; color:#003c1f; margin:0; text-align:center; }
    .cab .tit p  { font-size:10pt; color:#003c1f; margin:2px 0 0; text-align:center; }
    .cab img { height:42px; }
    .cab .sp { width:42px; }
    .rule { border-bottom:2px solid #00A859; margin:6px 0 8px; }
    .meta { text-align:center; font-style:italic; font-size:9pt; color:#6b7280; margin-bottom:14px; }
    .indice { break-after:page; page-break-after:always; }
    .indice h2 { font-size:13pt; color:#003c1f; margin-bottom:4px; }
    .indice-legenda { font-size:9pt; font-style:italic; color:#555; margin:0 0 10px; }
    .indice-legenda b { font-style:normal; color:#006633; }
    .indice ul { list-style:none; margin:0; padding:0; }
    .indice li { font-size:12pt; margin-bottom:4px; }
    .indice a { display:flex; align-items:baseline; text-decoration:none; color:#003c1f; }
    .indice a .ld { flex:1 1 auto; border-bottom:1px dotted #b9c2cc; margin:0 5px; position:relative; top:-3px; }
    .indice a::after { content: target-counter(attr(href url), page); color:#444; white-space:nowrap; }
    .bloco { margin-bottom:8px; }
    .item-h { font-size:13pt; font-weight:700; color:#003c1f; border-bottom:1px solid #ccc; padding-bottom:3px; margin:18px 0 4px; page-break-after:avoid; break-after:avoid; }
    .item-meta { font-size:9pt; color:#555; margin-bottom:4px; }
    .badges { margin:2px 0 6px; font-size:9pt; }
    .responsavel { font-size:9pt; color:#444; margin:2px 0 2px; }
    .portal { font-size:9pt; margin:0 0 6px; }
    .portal a { color:#0a4a7a; text-decoration:none; font-weight:600; }
    .badge { display:inline-block; padding:2px 8px; border-radius:999px; margin-right:4px; font-weight:600; }
    .badge-pode { background:#d3f5e2; color:#006633; }
    .badge-apens { background:#d8eef0; color:#02484d; }
    .badge-rel { background:#cfe8ff; color:#0a4a7a; }
    h2 { font-size:13pt; color:#003c1f; margin:14px 0 4px; page-break-after:avoid; break-after:avoid; }
    h3 { font-size:12pt; color:#155724; margin:10px 0 3px; }
    p { font-size:12pt; line-height:1.6; margin:6px 0; text-align:justify; hyphens:auto; orphans:2; widows:2; }
    ul { margin:4px 0 6px 18px; padding:0; }
    li { font-size:12pt; line-height:1.6; text-align:justify; margin:3px 0; }
    .pendente { color:#888; font-style:italic; background:#fafafa; border:1px dashed #ddd; padding:8px 10px; border-radius:4px; margin:6px 0; }
    .ft { margin-top:24px; padding-top:8px; border-top:1px solid #e5e7eb; font-size:8.5pt; color:#9ca3af; text-align:center; }
  </style></head><body>
    <div class="cab">
      <div class="sp"></div>
      <div class="tit"><h1>Pauta de Plenário</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
    </div>
    <div class="rule"></div>
    <div class="meta">${meta}</div>
    ${indice}
    ${itensHtml || '<p>Pauta vazia.</p>'}
    <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
  </body></html>`;
}

// ============================================================
//  "PROPOSIÇÕES DO PARTIDO" — mensagem p/ WhatsApp com os itens da pauta de
//  autoria do Podemos, com apensado(s) do Podemos ou de relatoria do Podemos.
// ============================================================

// Item entra na lista quando: é de autoria do Podemos, OU tem apensado(s) do
// Podemos, OU é de relatoria de deputado(a) do Podemos em Plenário.
function itemDoPodemos(it) {
  const enr = it.enriquecimento || {};
  return !!enr.autoriaPodemos || (enr.apensadosPodemos || []).length > 0 || relatoriaPodemos(it);
}

// Data curta da pauta p/ o cabeçalho ("30/6/2026"): extrai dd/mm/aaaa do
// período/nome e remove os zeros à esquerda.
function dataPautaCurta() {
  const p = state.pauta || {};
  const fonte = String(p.periodo || p.nome || p.titulo || '');
  const m = fonte.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${+m[1]}/${+m[2]}/${m[3]}` : (fonte.trim() || '—');
}

// Autoria para a mensagem: se é autoria do Podemos, lista os nomes dos autores
// do Podemos; senão (ex.: item incluído por relatoria), usa o texto de autoria
// da pauta — que traz o partido/UF do autor de outra legenda.
function autoriaMsg(it) {
  const enr = it.enriquecimento || {};
  const nomesPode = (enr.autores || []).filter(a => a.isPodemos && a.nome).map(a => a.nome);
  if (enr.autoriaPodemos && nomesPode.length) return nomesPode.join(', ');
  if ((it.autorTexto || '').trim()) return it.autorTexto.replace(/\s+/g, ' ').trim();
  const todos = (enr.autores || []).map(a => a.siglaPartido ? `${a.nome} - ${a.siglaPartido}` : a.nome).filter(Boolean);
  return todos.join(', ') || '—';
}

// Autoria de um apensado: nomes do Podemos quando houver, senão todos.
function autoriaApensadoMsg(ap) {
  const pode = (ap.autores || []).filter(a => a.isPodemos && a.nome).map(a => a.nome);
  if (pode.length) return pode.join(', ');
  return (ap.autores || []).map(a => a.nome).filter(Boolean).join(', ');
}

// Limpa a ementa para a mensagem: normaliza espaços e remove um parêntese
// aberto sem fechamento (e o que vier depois), artefato do recorte da ementa na
// pauta — ex.: "…pela aprovação, com Substitutivo (".
function ementaLimpa(t) {
  let e = (t || '').replace(/\s+/g, ' ').trim();
  const ab = e.lastIndexOf('(');
  if (ab !== -1 && e.indexOf(')', ab) === -1) e = e.slice(0, ab);
  return e.replace(/[\s;,.(]+$/, '').trim();   // tira pontuação solta no fim (inclui ponto final)
}

function montarMensagemPropPartido() {
  const itens = (state.pauta?.itens || []).filter(itemDoPodemos);
  if (!itens.length) return { texto: '', total: 0 };
  const b = s => `*${s}*`;   // negrito do WhatsApp
  const linhas = [b(`Itens do Podemos na Pauta de ${dataPautaCurta()}`)];
  for (const it of itens) {
    const apelido = (it.apelido || it.analise?.apelido || apelidoFallback(it) || '').trim();
    const apSuf = apelido ? ` (${apelido})` : '';
    linhas.push('');
    linhas.push(`${b(`▪️ Item ${it.ordem ?? '–'}. ${tipoLabel(it.sigla)} ${it.numero}/${it.ano}`)}${apSuf}`);
    linhas.push(b(`Autoria: ${autoriaMsg(it)}`));
    if (relatoriaPodemos(it) && it.relator?.nome) linhas.push(b(`Relatoria: ${it.relator.nome.replace(/\s+/g, ' ').trim()}`));
    const aps = it.enriquecimento?.apensadosPodemos || [];
    if (aps.length) {
      linhas.push(aps.length > 1 ? 'Apensados:' : 'Apensado:');
      for (const ap of aps) {
        const emAp = ementaLimpa(ap.ementa);   // apensados não têm apelido — usa a ementa
        linhas.push(`* ${b(`${ap.siglaTipo} ${ap.numero}/${ap.ano}`)}${emAp ? ` (${emAp})` : ''}`);
        const autAp = autoriaApensadoMsg(ap);
        if (autAp) linhas.push(`    ${b(`Autoria: ${autAp}`)}`);
      }
    }
  }
  return { texto: linhas.join('\n'), total: itens.length };
}

async function copiarPropPartido() {
  if (!state.pauta) return;
  // Garante que autoria/apensados de todos os itens estejam resolvidos antes de
  // montar a lista (o enriquecimento é assíncrono; chamadas são cacheadas).
  const pendentes = (state.pauta.itens || []).filter(it => {
    const st = it.enriquecimento?.status;
    return st !== 'ok' && st !== 'erro';
  });
  if (pendentes.length) {
    mostrarToast('Verificando autoria dos itens…', 'info');
    await Promise.all(pendentes.map(it => enriquecerItem(it).catch(() => {})));
  }
  // Garante o apelido dos itens que entrarão na lista (reaproveita o da nota,
  // gera por IA se configurado, ou usa o fallback a partir da ementa).
  try { await prepararApelidos((state.pauta.itens || []).filter(itemDoPodemos)); } catch (_) {}
  const { texto, total } = montarMensagemPropPartido();
  if (!total) { mostrarToast('Nenhuma proposição do Podemos (autoria, apensado ou relatoria) nesta pauta.', 'aviso'); return; }
  const ok = await copiarParaAreaTransferencia(texto);
  mostrarToast(
    ok ? `✓ ${total} item(ns) do Podemos copiados — cole no WhatsApp.`
       : 'Não foi possível copiar automaticamente. Verifique se a aba está ativa e tente de novo.',
    ok ? 'sucesso' : 'erro');
}

// ============================================================
//  "APELIDOS" — lista todos os itens da pauta com seus apelidos, no formato
//  "▪️ <o que será votado> (apelido)". Reaproveita o apelido da nota; se faltar,
//  gera por IA/fallback via prepararApelidos.
// ============================================================
function montarMensagemApelidos() {
  const itens = state.pauta?.itens || [];
  // Negrito (WhatsApp) em todo o título — "Urgência ao PL …", "Redação Final do
  // PL …", "PL …" — deixando só o apelido (entre parênteses) sem negrito.
  const linhas = itens.map(it => {
    const ap = (it.apelido || it.analise?.apelido || '').trim();
    return `▪️ *${tituloVotacao(it)}*${ap ? ` (${ap})` : ''}`;
  });
  return { texto: linhas.join('\n'), total: itens.length };
}

async function copiarApelidos() {
  if (!state.pauta) return;
  const itens = state.pauta.itens || [];
  if (!itens.length) { mostrarToast('Pauta vazia.', 'aviso'); return; }
  // Resolve enriquecimento pendente (dá a ementa do projeto alvo às urgências,
  // o que melhora o apelido) e garante o apelido de cada item.
  const pend = itens.filter(it => { const st = it.enriquecimento?.status; return st !== 'ok' && st !== 'erro'; });
  if (pend.length) {
    mostrarToast('Preparando apelidos…', 'info');
    await Promise.all(pend.map(it => enriquecerItem(it).catch(() => {})));
  }
  try { await prepararApelidos(itens); } catch (_) {}
  const { texto, total } = montarMensagemApelidos();
  const ok = await copiarParaAreaTransferencia(texto);
  mostrarToast(
    ok ? `✓ ${total} apelido(s) copiados — cole no WhatsApp.`
       : 'Não foi possível copiar automaticamente. Verifique se a aba está ativa e tente de novo.',
    ok ? 'sucesso' : 'erro');
}

// Copia texto para a área de transferência sem diálogos: tenta a Clipboard API
// e, se ela falhar (ex.: ativação por gesto expirou após o await), recorre ao
// textarea oculto + execCommand. Não usa window.prompt (suprimido fora da aba
// ativa).
async function copiarParaAreaTransferencia(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

// ============================================================
//  "RESUMO DA SESSÃO" — mensagem p/ WhatsApp com as matérias apreciadas no
//  Plenário (urgências aprovadas + projetos concluídos, com o destino). Os
//  resultados vêm da API de dados abertos: evento → votações → tramitação.
// ============================================================

// Data da pauta em ISO (AAAA-MM-DD), p/ consultar o evento da sessão.
function dataPautaISO() {
  const fonte = String(state.pauta?.periodo || state.pauta?.nome || state.pauta?.titulo || '');
  const m = fonte.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function _idDeUri(uri) { const m = String(uri || '').match(/(\d+)\s*$/); return m ? m[1] : null; }

// Sessões deliberativas do Plenário na data (pode haver mais de uma no dia).
async function acharSessoesDeliberativas(dataISO) {
  const json = await fetchJson(`${API_BASE}/eventos?dataInicio=${dataISO}&dataFim=${dataISO}&itens=100`);
  return (json.dados || []).filter(e =>
    /Sess[ãa]o\s+Deliberativa/i.test(e.descricaoTipo || '') &&
    (e.orgaos || []).some(o => o.sigla === 'PLEN'));
}

// Abrevia o nome de uma comissão (para o destino "Redação Final na …").
function siglaComissao(nome) {
  const n = (nome || '').replace(/\s+/g, ' ').trim();
  if (/Constitui[çc][ãa]o\s+e\s+Justi[çc]a/i.test(n)) return 'CCJC';
  return n.replace(/^Comiss[ãa]o\s+d[eo]\s+/i, '').trim() || 'comissão';
}

// Destino da matéria a partir dos despachos de tramitação DO DIA. É o sinal
// oficial de que a apreciação no Plenário concluiu — vale para qualquer rito
// (PL, PLP, PEC, PDL, PRC, MPV) e para RF votada no Plenário ou remetida a
// comissão. Retorna null quando não há despacho de conclusão (voto intermediário
// ou matéria que não concluiu no dia). MPV concluída sempre segue ao Senado.
// Classifica o destino da matéria a partir dos despachos do dia. É rito-agnóstico
// e guiado pelo TEMPLATE OFICIAL de roteamento do Plenário — o despacho
// "A matéria <verbo> <destino>." —, que marca a conclusão da apreciação.
// Robustez (validada em 30 sessões):
//  • pega o ÚLTIMO despacho de roteamento (uma PEC de 2 turnos tem, na ordem,
//    "A matéria vai ao segundo turno" e depois "A matéria vai ao Senado Federal");
//  • degradação graciosa: destino não mapeado vira "Encaminhada (…)" legível —
//    nunca descarta uma matéria aprovada e concluída;
//  • sinais fortes (Transformado em Lei/Decreto/Resolução, Promulgada) só como
//    reserva, quando não há o template.
function destinoDeConclusao(sigla, despachos) {
  const lista = (despachos || []).map(d => (d || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const txt = lista.join(' \n ');

  // Classifica UM despacho de roteamento "A matéria <verbo> <destino>".
  const classificarRoteamento = (frase) => {
    if (/san[çc][ãa]o/i.test(frase)) return 'Vai à sanção';
    if (/promulga/i.test(frase)) return 'Promulgada';
    if (/Senado/i.test(frase)) return /(?:retorna|volta)/i.test(frase) ? 'Retorna ao Senado' : 'Vai ao Senado';
    if (/C[âa]mara\s+dos\s+Deputados/i.test(frase)) return /(?:retorna|volta)/i.test(frase) ? 'Retorna à Câmara' : 'Vai à Câmara';
    if (/segundo\s+turno/i.test(frase)) return 'Aprovada em 1º turno';   // 2º turno ainda por vir
    const mRF = frase.match(/(?:à|a|ao)\s+(.+?),?\s+para\s+(?:elabora[çc][ãa]o\s+d[ae]\s+)?Reda[çc][ãa]o\s+Final/i);
    if (mRF) return 'Redação Final na ' + siglaComissao(mRF[1]);
    if (/Reda[çc][ãa]o\s+Final/i.test(frase)) return 'Redação Final na CCJC';
    const cauda = frase.replace(/^A\s+mat[ée]ria\s+/i, '').replace(/\s*\.\s*$/, '').trim();
    return 'Encaminhada (' + cauda + ')';   // legível — nunca descarta
  };

  // 1) Template oficial: usa o ÚLTIMO "A matéria <verbo> …" (roteamento final).
  const reRoteamento = /^A\s+mat[ée]ria\s+(?:vai|retorna|volta|segue|ser[áa]\s+\w+|é\s+\w+|foi\s+\w+)\b/i;
  let destino = null;
  for (const d of lista) if (reRoteamento.test(d)) destino = classificarRoteamento(d);

  // 2) Sem template: sinais fortes de conclusão (promulgação/sanção/lei/decreto).
  if (!destino) {
    if (/(?:^|\s)Promulgad[oa]\b|Transformad[oa]\s+em\s+Decreto\s+Legislativo|Transformad[oa]\s+n[ao]\s+Resolu[çc][ãa]o/i.test(txt)) destino = 'Promulgada';
    else if (/Transformad[oa]\s+n[ao]\s+Lei/i.test(txt)) destino = 'Vai à sanção';
    else {
      const mRF = txt.match(/(?:vai|encaminhad[oa]|remetid[oa])\s+(?:à|a|ao)\s+(.+?),?\s+para\s+(?:elabora[çc][ãa]o\s+d[ae]\s+)?Reda[çc][ãa]o\s+Final/i);
      if (mRF) destino = 'Redação Final na ' + siglaComissao(mRF[1]);
      else if (/para\s+(?:elabora[çc][ãa]o\s+d[ae]\s+)?Reda[çc][ãa]o\s+Final/i.test(txt)) destino = 'Redação Final na CCJC';
    }
  }

  if (destino && /^MPV$/i.test(sigla)) destino = 'Vai ao Senado';   // MPV aprovada na Câmara sempre vai ao Senado
  return destino;
}

// Proposições afetadas por uma votação: usa proposicaoObjeto quando presente
// (sem custo) e, quando nulo, o proposicoesAfetadas do detalhe da votação.
async function propsDaVotacao(v) {
  const mObj = String(v.proposicaoObjeto || '').match(/\b(PL|PLP|PEC|PDL|PDC|MPV|PRC|REQ|REC)\s+([\d.]+)\/(\d{4})\b/i);
  if (mObj) return [{ sigla: mObj[1].toUpperCase(), numero: mObj[2].replace(/\./g, ''), ano: mObj[3], id: _idDeUri(v.uriProposicaoObjeto) }];
  try {
    const af = (await fetchJsonCamara(`${API_BASE}/votacoes/${v.id}`)).dados?.proposicoesAfetadas || [];
    return af.map(p => ({ sigla: p.siglaTipo, numero: String(p.numero), ano: String(p.ano), id: _idDeUri(p.uri) }));
  } catch (_) { return []; }
}

// Ementa para a mensagem: normaliza espaços e remove um parêntese aberto sem
// fechamento (mantém o ponto final, como no padrão deste resumo).
function ementaTextoResumo(t) {
  let e = (t || '').replace(/\s+/g, ' ').trim();
  const ab = e.lastIndexOf('(');
  if (ab !== -1 && e.indexOf(')', ab) === -1) e = e.slice(0, ab).trim();
  return e;
}

const _ascVot = (a, b) => String(a.dataHoraRegistro || '').localeCompare(String(b.dataHoraRegistro || ''));

// fetch da API da Câmara com retry em 429/5xx e erros de rede (a API limita taxa).
async function fetchJsonCamara(url, tentativas = 4) {
  let erro = null;
  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 400 * i));
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) { erro = new Error(`HTTP ${res.status}`); continue; }
      throw new Error(`HTTP ${res.status} em ${url}`);
    } catch (e) { erro = e; }
  }
  throw erro || new Error('Falha ao consultar ' + url);
}

// Executa fn sobre items com no máximo `limite` chamadas simultâneas (evita o
// rate-limit da API). Preserva a ordem dos resultados.
async function _mapLimit(items, limite, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limite, items.length || 1) }, worker));
  return out;
}

// Extrai a 1ª referência de proposição de um texto (ementa do REQ de urgência).
// Robusto às formas reais da Câmara, com o ano ligado por "/", ", de" ou " de":
//   "Projeto de Lei nº X, de AAAA"  ·  "PL nº 2.465/2026"  ·  "PL 2465/2026"
//   "PL nº 5.196 de 2025"  ·  "PL nº 4674, de 2024"  ·  "PL nº 957, de 2024"
//   "Mensagem nº 85/2023" (→ MSC)  ·  siglas PL/PLP/PEC/PDL/PDC/PRC/MPV/MSC/PLV/PLN.
// A âncora na sigla evita confundir com "Lei nº ..." (norma citada, não proposição).
function extrairRefProposicao(texto) {
  const t = encurtarProposicoes(texto || '');
  // separador do ano: "/", ", de", " de " (ou variações de espaço)
  const sep = '(?:\\s*\\/\\s*|\\s*,?\\s*de\\s+)';
  const re = new RegExp(
    '\\b(PLP|PLV|PLN|PDL|PDC|PRC|PEC|MPV|MSC|PL|Mensagem)\\s+n?[º°o.]*\\s*([\\d.]+)(?:-[A-Z]+)?' + sep + '(\\d{4})\\b',
    'i');
  const m = t.match(re);
  if (!m) return null;
  let sigla = m[1].toUpperCase();
  if (sigla === 'MENSAGEM') sigla = 'MSC';   // "Mensagem nº 85/2023" → MSC 85/2023
  if (sigla === 'PDC') sigla = 'PDL';        // PDC é a nomenclatura antiga do PDL
  return { sigla, numero: m[2].replace(/\./g, ''), ano: m[3] };
}

async function coletarResumoSessao(dataISO) {
  const sessoes = await acharSessoesDeliberativas(dataISO);
  if (!sessoes.length) return { encontrouSessao: false };

  // Junta as votações de todas as sessões deliberativas do dia.
  const votacoes = [];
  for (const ev of sessoes) {
    try {
      const j = await fetchJsonCamara(`${API_BASE}/eventos/${ev.id}/votacoes`);
      votacoes.push(...(j.dados || []));
    } catch (_) {}
  }

  // --- Urgências aprovadas (REQ) → PL correspondente (via ementa do REQ) ---
  const urgVot = votacoes
    .filter(v => v.aprovacao === 1 && /Requerimento\s+de\s+Urg[êe]ncia/i.test(v.descricao || '') && /^REQ\b/.test(v.proposicaoObjeto || ''))
    .sort(_ascVot);
  const urgRaw = await _mapLimit(urgVot, 4, async v => {
    // Referência do próprio REQ, para degradação graciosa (nunca perder a urgência).
    const reqRef = extrairRefProposicao(v.proposicaoObjeto || '') ||
      (m => m ? { sigla: m[1].toUpperCase(), numero: m[2].replace(/\./g, ''), ano: m[3] } : null)
        (String(v.proposicaoObjeto || '').match(/\b(REQ|REC)\s+([\d.]+)\/(\d{4})\b/i));
    let reqEmenta = '';
    try {
      const det = await fetchJsonCamara(`${API_BASE}/proposicoes/${_idDeUri(v.uriProposicaoObjeto)}`);
      reqEmenta = det.dados?.ementa || '';
      const ref = extrairRefProposicao(reqEmenta);
      if (ref) {
        let ementa = '';
        try {
          const pl = await fetchJsonCamara(`${API_BASE}/proposicoes?siglaTipo=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}`);
          ementa = pl.dados?.[0]?.ementa || '';
        } catch (_) {}
        return { ...ref, ementa, resolvido: true };
      }
    } catch (_) {}
    // Não localizamos o projeto alvo: mantemos a urgência na lista, identificada
    // pelo próprio requerimento e sua ementa (que descreve a matéria).
    return {
      sigla: reqRef?.sigla || 'REQ', numero: reqRef?.numero || '', ano: reqRef?.ano || '',
      ementa: reqEmenta, resolvido: false,
    };
  });
  const urgencias = [];
  const vistos = new Set();
  for (const u of urgRaw.filter(Boolean)) {
    const k = `${u.sigla}-${u.numero}-${u.ano}`;
    if (!vistos.has(k)) { vistos.add(k); urgencias.push(u); }
  }

  // --- Matérias concluídas + destino (DETECÇÃO GUIADA PELO DESPACHO OFICIAL) ---
  // Candidatas: toda proposição (não-REQ) votada e aprovada no evento. Uma
  // matéria só entra se sua tramitação registra, no dia, um despacho de
  // conclusão ("A matéria vai à/ao …", promulgação, sanção, Senado ou à comissão
  // para Redação Final). Isso é rito-agnóstico: PL, PLP, PEC, PDL, PRC, MPV, com
  // RF votada no Plenário ou remetida a comissão — sem depender do texto da
  // votação (que varia por rito).
  const votadasAsc = votacoes.filter(v => v.aprovacao === 1).sort(_ascVot);
  const propsPorVot = await _mapLimit(votadasAsc, 4, v => propsDaVotacao(v));
  const candidatas = [];
  const vistosC = new Set();
  for (const p of propsPorVot.flat()) {
    if (!p || /^(REQ|REC)$/i.test(p.sigla)) continue;   // urgências são o bloco de cima
    const k = `${p.sigla}-${p.numero}-${p.ano}`;
    if (vistosC.has(k)) continue;
    vistosC.add(k);
    candidatas.push(p);
  }
  // Janela do dia da sessão (+1 dia para sessões que viram a madrugada). NÃO usa
  // ">= dataISO": isso puxava despachos de dias MUITO posteriores (ex.: PDL
  // "Transformado no Decreto Legislativo" 15 dias depois) e trocava o destino da
  // sessão ("Vai ao Senado") pelo desfecho futuro ("Promulgada").
  const proxDia = (() => { const d = new Date(dataISO + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const noDia = t => { const dia = String(t.dataHora || '').slice(0, 10); return dia === dataISO || dia === proxDia; };
  const concluidos = (await _mapLimit(candidatas, 4, async c => {
    let trs = [];
    try { trs = (await fetchJsonCamara(`${API_BASE}/proposicoes/${c.id}/tramitacoes`)).dados || []; } catch (_) {}
    const despachos = trs.filter(noDia).map(t => t.despacho || '');
    const destino = destinoDeConclusao(c.sigla, despachos);
    if (!destino) return null;   // não concluiu a apreciação no dia (voto intermediário)
    let ementa = '';
    try { ementa = (await fetchJsonCamara(`${API_BASE}/proposicoes/${c.id}`)).dados?.ementa || ''; } catch (_) {}
    return { ...c, ementa, destino };
  })).filter(Boolean);

  return { encontrouSessao: true, urgencias, concluidos };
}

// Apelido da matéria a partir do item da pauta correspondente (casado por
// sigla/número/ano do projeto — para requerimento, o projeto urgenciado). Vazio
// se a matéria não estiver na pauta ou o item ainda não tiver apelido.
function apelidoDaPautaPorRef(sigla, numero, ano) {
  const alvo = `${String(sigla || '').toUpperCase()}-${String(numero || '').replace(/\./g, '')}-${ano}`;
  for (const it of (state.pauta?.itens || [])) {
    const a = _alvoItem(it);
    const k = `${String(a.sigla || '').toUpperCase()}-${String(a.numero || '').replace(/\./g, '')}-${a.ano}`;
    if (k === alvo) {
      const ap = (it.apelido || it.analise?.apelido || '').trim();
      if (ap) return ap;
    }
  }
  return '';
}

function montarMensagemResumo(urgencias, concluidos) {
  const b = s => `*${s}*`;   // negrito do WhatsApp (o "*" final não pode vir após espaço)
  const linhas = [`${b(`📌 Matérias apreciadas no Plenário da Câmara dos Deputados – ${dataPautaCurta()}`)} `, ''];
  // Prefere o APELIDO do item da pauta; só usa a ementa da API como reserva
  // (matéria fora da pauta ou sem apelido gerado).
  const descr = (sigla, numero, ano, ementa) => {
    const t = apelidoDaPautaPorRef(sigla, numero, ano) || ementaTextoResumo(ementa);
    return t ? ` (${t})` : '';
  };
  for (const u of urgencias) {
    const rotulo = (u.resolvido === false)
      ? 'Urgência aprovada'                                     // alvo não localizado: não perdemos o item
      : `Urgência ao ${tipoLabel(u.sigla)} ${u.numero}/${u.ano}`;
    linhas.push(`▪️ ${b(rotulo)}${descr(u.sigla, u.numero, u.ano, u.ementa)}`);
  }
  for (const c of concluidos) {
    const seta = c.destino ? `➡️ ${c.destino}` : '';
    linhas.push(`▪️ ${b(`${tipoLabel(c.sigla)} ${c.numero}/${c.ano}`)}${descr(c.sigla, c.numero, c.ano, c.ementa)}${seta}`);
  }
  return linhas.join('\n');
}

async function copiarResumoSessao() {
  if (!state.pauta) return;
  const dataISO = dataPautaISO();
  if (!dataISO) { mostrarToast('Não consegui identificar a data da pauta para buscar a sessão.', 'aviso'); return; }
  mostrarToast('Buscando resultados da sessão na Câmara…', 'info');
  let res;
  try { res = await coletarResumoSessao(dataISO); }
  catch (e) { mostrarToast('Erro ao buscar os resultados: ' + e.message, 'erro'); return; }
  if (!res.encontrouSessao) { mostrarToast(`Nenhuma sessão deliberativa do Plenário encontrada em ${dataPautaCurta()}.`, 'aviso'); return; }
  if (!res.urgencias.length && !res.concluidos.length) { mostrarToast('A sessão não tem matérias apreciadas registradas (ainda).', 'aviso'); return; }
  // Garante o apelido dos itens da pauta — o resumo usa o apelido (não a ementa)
  // quando a matéria está na pauta.
  try { await prepararApelidos(state.pauta.itens || []); } catch (_) {}
  const texto = montarMensagemResumo(res.urgencias, res.concluidos);
  const ok = await copiarParaAreaTransferencia(texto);
  const tot = res.urgencias.length + res.concluidos.length;
  mostrarToast(
    ok ? `✓ Resumo da sessão (${tot} matéria(s)) copiado — cole no WhatsApp.`
       : 'Não foi possível copiar automaticamente. Verifique se a aba está ativa e tente de novo.',
    ok ? 'sucesso' : 'erro');
}

// ============================================================
//  EXPORTAÇÃO PARA WORD (.docx) — mesmo conteúdo do PDF
// ============================================================
async function carregarLogoBytes() {
  try {
    const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL('icons/podemos-logo.png') : 'icons/podemos-logo.png';
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch (_) { return null; }
}

// Converte um trecho (com **negrito** e [[N]]tamanho[[/]]) em TextRuns do Word.
function runsInlineDocx(texto, baseHalfPt) {
  const { TextRun } = docx;
  const runs = [];
  const pushBold = (txt, sizeHp) => {
    const re = /\*\*([^*]+)\*\*/g; let l = 0, m;
    while ((m = re.exec(txt)) !== null) {
      if (m.index > l) runs.push(new TextRun({ text: txt.slice(l, m.index), size: sizeHp }));
      runs.push(new TextRun({ text: m[1], bold: true, size: sizeHp }));
      l = m.index + m[0].length;
    }
    if (l < txt.length) runs.push(new TextRun({ text: txt.slice(l), size: sizeHp }));
  };
  const sizeRe = /\[\[(10\.5|12|14|16)\]\]([\s\S]*?)\[\[\/\]\]/g;
  let last = 0, m;
  while ((m = sizeRe.exec(texto)) !== null) {
    if (m.index > last) pushBold(texto.slice(last, m.index), baseHalfPt);
    pushBold(m[2], Math.round(parseFloat(m[1]) * 2));   // pt → meios-pontos (10,5 → 21)
    last = m.index + m[0].length;
  }
  if (last < texto.length) pushBold(texto.slice(last), baseHalfPt);
  if (!runs.length) runs.push(new TextRun({ text: '', size: baseHalfPt }));
  return runs;
}

// Converte a nota em HTML (editor Quill) em parágrafos do Word. Anda pelos
// blocos (p, h2/h3, li) e pelos inline (strong/em/span[font-size]).
function htmlParaDocx(html) {
  const { Paragraph, TextRun, AlignmentType } = docx;
  const L15 = { line: 360, lineRule: 'auto' };
  const BASE = 24;   // 12pt em meios-pontos
  const alinhar = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');

  // pt (ex.: "14pt") → meios-pontos; px como reserva (1pt ≈ 1.333px).
  const tamHalfPt = (styleFontSize) => {
    if (!styleFontSize) return null;
    const mpt = styleFontSize.match(/([\d.]+)\s*pt/i);
    if (mpt) return Math.round(parseFloat(mpt[1]) * 2);
    const mpx = styleFontSize.match(/([\d.]+)\s*px/i);
    if (mpx) return Math.round((parseFloat(mpx[1]) / 1.3333) * 2);
    return null;
  };

  // Gera TextRuns andando recursivamente nos nós inline, herdando negrito/itálico/tamanho.
  const runsDe = (node, herda) => {
    const runs = [];
    node.childNodes.forEach(ch => {
      if (ch.nodeType === 3) {   // texto
        const txt = ch.textContent;
        if (txt) runs.push(new TextRun({ text: txt, bold: herda.bold, italics: herda.italic, size: herda.size }));
        return;
      }
      if (ch.nodeType !== 1) return;
      const tag = ch.tagName.toLowerCase();
      if (tag === 'br') { runs.push(new TextRun({ break: 1 })); return; }
      const novo = { ...herda };
      if (tag === 'strong' || tag === 'b') novo.bold = true;
      if (tag === 'em' || tag === 'i') novo.italic = true;
      const fs = tamHalfPt(ch.style?.fontSize);
      if (fs) novo.size = fs;
      runs.push(...runsDe(ch, novo));
    });
    return runs;
  };

  const alignDe = el => alinhar[(el.style?.textAlign || '').toLowerCase()] || AlignmentType.JUSTIFIED;
  const out = [];
  const blocos = doc.body.querySelectorAll(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > ul, :scope > ol, :scope > blockquote');
  blocos.forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      el.querySelectorAll(':scope > li').forEach(li => {
        const runs = runsDe(li, { bold: false, italic: false, size: BASE });
        out.push(new Paragraph({ bullet: { level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 40, ...L15 }, children: runs.length ? runs : [new TextRun({ text: '', size: BASE })] }));
      });
      return;
    }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      out.push(new Paragraph({ spacing: { before: 220, after: 60, ...L15 }, children: [new TextRun({ text: (el.textContent || '').trim(), bold: true, size: 26, color: '155724' })] }));
      return;
    }
    const runs = runsDe(el, { bold: false, italic: false, size: BASE });
    out.push(new Paragraph({ alignment: alignDe(el), spacing: { after: 140, ...L15 }, children: runs.length ? runs : [new TextRun({ text: '', size: BASE })] }));
  });
  if (!out.length) out.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  return out;
}

// Converte a nota (Markdown com nossos marcadores) em parágrafos do Word.
function mdParaDocx(md) {
  const { Paragraph, TextRun, AlignmentType } = docx;
  const L15 = { line: 360, lineRule: 'auto' };
  const BASE = 24;   // 12pt (meios-pontos) — fonte padrão da nota
  const alinhar = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
  const texto = reescoparTamanho(encurtarProposicoes(mdSemAcolhimento(md || '')))
    .replace(/^(#{1,3}[ \t].+)\n(?!\n)/gm, '$1\n\n');   // título sempre em bloco próprio
  const out = [];
  for (const bloco of texto.split(/\n{2,}/)) {
    let b = bloco.trim();
    if (!b) continue;
    // Tira o marcador de alinhamento ANTES de detectar o título — senão um
    // título justificado (ex.: nota toda justificada) viraria parágrafo com "##".
    let alignment = AlignmentType.JUSTIFIED;
    const am = b.match(/^\[\[(left|center|right|justify)\]\]\s*/i);
    if (am) { alignment = alinhar[am[1].toLowerCase()]; b = b.slice(am[0].length); }
    const h = b.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      out.push(new Paragraph({ spacing: { before: 220, after: 60, ...L15 }, children: [new TextRun({ text: h[2].replace(/\*\*/g, '').trim(), bold: true, size: 26, color: '155724' })] }));
      continue;
    }
    const linhas = b.split(/\n/);
    if (linhas.length && linhas.every(l => /^\s*[-*]\s+/.test(l))) {
      for (const l of linhas) out.push(new Paragraph({ bullet: { level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 40, ...L15 }, children: runsInlineDocx(l.replace(/^\s*[-*]\s+/, ''), BASE) }));
      continue;
    }
    out.push(new Paragraph({ alignment, spacing: { after: 140, ...L15 }, children: runsInlineDocx(b.replace(/\n/g, ' '), BASE) }));
  }
  if (!out.length) out.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  return out;
}

async function exportarDocx() {
  if (!state.pauta) return;
  if (typeof docx === 'undefined') { mostrarToast('Biblioteca de exportação Word não carregada.', 'erro'); return; }
  const itens = state.selecionados.size
    ? state.pauta.itens.filter(it => state.selecionados.has(it.chave))
    : state.pauta.itens;
  if (!itens.length) { mostrarToast('Nenhum item selecionado para o Word.', 'aviso'); return; }

  mostrarToast('Gerando documento Word…', 'info');
  try { await carregarConfig(); } catch (_) {}
  try { await prepararApelidos(itens); } catch (_) {}

  const {
    Document, Paragraph, TextRun, Packer, BorderStyle,
    Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, VerticalAlign,
    TableOfContents, HeadingLevel, PageBreak, Footer, PageNumber,
  } = docx;

  // Rodapé com o número da página (campo PAGE, centralizado — igual ao PDF). O
  // campo PAGE é recalculado pelo Word a cada renderização, sozinho, sem F9 nem
  // prompt (diferente dos campos de índice); funciona em qualquer visualizador.
  const rodapePagina = new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' })],
  })] });
  const L15 = { line: 360, lineRule: 'auto' };
  const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const SEM_BORDA = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };
  const renumerar = itens.length < (state.pauta.itens?.length || 0);   // subconjunto → índice começa em 1
  const num = (it, i) => ((renumerar ? i + 1 : (it.ordem ?? i + 1)) + '. ');
  const placeholder = st => st === 'erro' ? 'Falha ao gerar análise.' : st === 'gerando' ? 'Análise em processamento.' : 'Análise não gerada.';
  const logoBytes = await carregarLogoBytes();
  const nomePauta = state.pauta.nome || state.pauta.titulo || 'Pauta de Plenário';
  const filhos = [];

  // Cabeçalho institucional: [vazio | título centralizado | logo]
  filhos.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: SEM_BORDA,
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, borders: SEM_BORDA, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({})] }),
      new TableCell({ width: { size: 64, type: WidthType.PERCENTAGE }, borders: SEM_BORDA, verticalAlign: VerticalAlign.CENTER, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...L15 }, children: [new TextRun({ text: 'Pauta de Plenário', bold: true, size: 28, color: '003c1f' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...L15 }, children: [new TextRun({ text: 'Liderança do Podemos na Câmara dos Deputados', size: 20, color: '003c1f' })] }),
      ] }),
      new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, borders: SEM_BORDA, verticalAlign: VerticalAlign.CENTER, children: [
        logoBytes ? new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ data: logoBytes, type: 'png', transformation: { width: 104, height: 47 } })] }) : new Paragraph({}),
      ] }),
    ] })],
  }));
  filhos.push(new Paragraph({ spacing: { before: 40, after: 120 }, border: { bottom: { color: '00A859', space: 1, style: BorderStyle.SINGLE, size: 12 } }, children: [] }));
  filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 220, ...L15 }, children: [new TextRun({ text: `${nomePauta} · ${itens.length} item(ns)`, italics: true, size: 16, color: '6b7280' })] }));

  // Índice: SUMÁRIO NATIVO DO WORD (campo TOC), não mais um índice "manual".
  // Por que mudou: o índice manual usava um campo PAGEREF por linha; a Microsoft
  // documenta que campos PAGEREF avulsos NÃO são recalculados de forma confiável
  // ao abrir (mostram "1" até um F9) — era a causa do "tudo página 1". Já o campo
  // TOC é o mecanismo nativo de sumário: o Word o repagina como um bloco só ao
  // abrir/atualizar e exibe o botão "Atualizar Sumário". Os itens são cabeçalhos
  // Heading 1; "TOC \o 1-1 \h" monta cada linha (título clicável + nº de página).
  // Obs.: nº de página no Word depende do motor de layout do Word — nenhum
  // gerador de .docx (navegador) tem como pré-calcular a paginação do Word; por
  // isso o índice paginado 100% garantido continua sendo o do PDF.
  const legParts = [];
  if (itens.some(it => it.enriquecimento?.autoriaPodemos && it.enriquecimento?.autoriaPrincipalPodemos !== false)) legParts.push('A = Autoria do Podemos');
  if (itens.some(it => it.enriquecimento?.autoriaPodemos && it.enriquecimento?.autoriaPrincipalPodemos === false)) legParts.push('CA = Coautoria do Podemos');
  if (itens.some(it => (it.enriquecimento?.apensadosPodemos || []).length)) legParts.push('AP = Autoria do Podemos em apensado');
  if (itens.some(it => relatoriaPodemos(it))) legParts.push('R = Relatoria do Podemos em Plenário');
  filhos.push(new Paragraph({ spacing: { before: 60, after: 40, ...L15 }, children: [new TextRun({ text: 'Índice', bold: true, size: 22, color: '003c1f' })] }));
  if (legParts.length) filhos.push(new Paragraph({ spacing: { after: 40, ...L15 }, children: [new TextRun({ text: legParts.join(' · '), italics: true, size: 14, color: '6b7280' })] }));
  filhos.push(new Paragraph({ spacing: { after: 120, ...L15 }, children: [new TextRun({ text: 'Para carregar os números de página: clique com o botão direito no índice → "Atualizar campo" (ou selecione tudo e tecle F9). No PDF o índice já sai paginado.', italics: true, size: 14, color: '6b7280' })] }));
  filhos.push(new TableOfContents('Índice', { hyperlink: true, headingStyleRange: '1-1' }));
  filhos.push(new Paragraph({ children: [new PageBreak()] }));

  // Itens — o título é um cabeçalho Heading 1 (é o que o campo TOC coleta).
  itens.forEach((it, i) => {
    filhos.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 360, after: 40, ...L15 },
      border: { bottom: { color: 'cccccc', space: 1, style: BorderStyle.SINGLE, size: 6 } },
      children: [
        new TextRun({ text: num(it, i) + tituloComApelido(it), bold: true, size: 26, color: '003c1f' }),
      ],
    }));
    const metaParts = [];
    const autor = it.autorTexto || (it.enriquecimento?.autores || []).map(a => a.nome).filter(Boolean).join(', ') || '';
    if (autor) metaParts.push('Autor: ' + autor);
    if (it.relator) metaParts.push(`Relator: Dep. ${it.relator.nome} (${it.relator.partido}-${it.relator.uf})`);
    if (metaParts.length) filhos.push(new Paragraph({ spacing: { after: 20, ...L15 }, children: [new TextRun({ text: metaParts.join(' · '), size: 16, color: '555555' })] }));
    const badges = [];
    if (it.enriquecimento?.autoriaPodemos) badges.push(`★ ${rotuloAutoriaPodemos(it)} Podemos`);
    (it.enriquecimento?.apensadosPodemos || []).forEach(ap => badges.push(`Apensado Podemos: ${ap.siglaTipo} ${ap.numero}/${ap.ano}`));
    if (relatoriaPodemos(it)) badges.push('Relatoria Podemos em Plenário');
    if (badges.length) filhos.push(new Paragraph({ spacing: { after: 20, ...L15 }, children: [new TextRun({ text: badges.join('   |   '), bold: true, size: 16, color: '02484d' })] }));
    const resp = it.analista || it.analise?.analista || '';
    if (resp) filhos.push(new Paragraph({ spacing: { after: 40, ...L15 }, children: [new TextRun({ text: 'Responsável: ', bold: true, size: 16 }), new TextRun({ text: resp, size: 16 })] }));
    if (temNota(it)) {
      const paras = notaEhHtml(it) ? htmlParaDocx(notaHtmlImpressao(it)) : mdParaDocx(notaMd(it));
      paras.forEach(p => filhos.push(p));
    } else {
      filhos.push(new Paragraph({ spacing: { ...L15 }, children: [new TextRun({ text: placeholder(it.analiseStatus), italics: true, size: 18, color: '999999' })] }));
    }
  });

  filhos.push(new Paragraph({ spacing: { before: 360 }, alignment: AlignmentType.CENTER, border: { top: { color: 'e5e7eb', space: 1, style: BorderStyle.SINGLE, size: 6 } }, children: [new TextRun({ text: 'Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados', size: 14, color: '9ca3af' })] }));

  try {
    const blob = await Packer.toBlob(new Document({ features: { updateFields: true }, sections: [{ properties: {}, footers: { default: rodapePagina }, children: filhos }] }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Pauta_Plenario_${nomePauta.replace(/[^\w]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.docx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    mostrarToast('✓ Word gerado. O índice é um Sumário do Word: clique nele com o botão direito → "Atualizar campo" (ou Ctrl+A e F9) para carregar as páginas. Índice já paginado: use o PDF.', 'sucesso');
  } catch (e) {
    mostrarToast('Erro ao gerar Word: ' + e.message, 'erro');
  }
}

async function exportarPdf() {
  if (!state.pauta) return;
  // Seleção (vazio = todos). Mantém a ordem original da pauta.
  const itensExport = state.selecionados.size
    ? state.pauta.itens.filter(it => state.selecionados.has(it.chave))
    : state.pauta.itens;
  if (!itensExport.length) {
    mostrarToast('Nenhum item selecionado para o PDF.', 'aviso');
    return;
  }
  const pautaExport = { ...state.pauta, itens: itensExport };
  const renumerar = itensExport.length < (state.pauta.itens?.length || 0);   // subconjunto → índice começa em 1
  // Abre a janela já no gesto do clique (evita bloqueio de pop-up).
  const win = window.open('', '_blank', 'width=900,height=720');
  if (!win) {
    mostrarToast('Permita pop-ups para exportar o PDF.', 'aviso');
    return;
  }
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando PDF…</title></head><body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Preparando os apelidos e gerando o PDF…</body></html>');
  win.document.close();

  // Gera/cacheia os apelidos (por IA, se houver chave) e carrega a logo.
  try { await carregarConfig(); } catch (_) {}
  try { await prepararApelidos(itensExport); } catch (_) {}
  if (win.closed) return;
  const logoDataUrl = await carregarLogoDataUrl();

  win.document.open();
  win.document.write(_htmlImpressaoPautaPlenario(pautaExport, logoDataUrl, renumerar));
  win.document.close();

  // Paged.js pagina e calcula os nº de página do índice (target-counter).
  let impresso = false;
  const imprimir = () => { if (impresso || win.closed) return; impresso = true; try { win.focus(); win.print(); } catch (_) {} };
  win.PagedConfig = { auto: true, after: imprimir };
  const s = win.document.createElement('script');
  s.src = chrome.runtime.getURL('libs/paged.polyfill.js');
  s.onerror = imprimir;                 // imprime sem numeração se a lib falhar
  win.document.head.appendChild(s);
  setTimeout(imprimir, 30000);          // rede de segurança para pautas grandes
  mostrarToast('Gerando PDF… escolha “Salvar como PDF” na janela.', 'info');
}

// ============================================================
//  UTIL
// ============================================================
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(''));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return await res.json();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function iconeGerar() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18a1 1 0 0 0-2 0v1.93A8 8 0 0 1 4.07 13H6a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V6a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H18a1 1 0 0 0 0 2h1.93A8 8 0 0 1 13 19.93z"/></svg>';
}

function iconeEditar() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
}

// ============================================================
//  CONFIGURAÇÕES (provedor IA)
// ============================================================
function abrirConfig() {
  const c = state.config || {};
  document.getElementById('config-provedor').value = c.provedor || 'gemini';
  document.getElementById('config-api-key').value  = c.apiKey   || '';
  onProvedorChange();
  popularSelectModelos(c.modelo);
  renderInteresseConfig();
  selecionarAbaConfig('ia');
  document.getElementById('modal-configuracoes').style.display = 'flex';
}

// Alterna entre as abas do modal de Configurações (Provedor de IA / Temas).
function selecionarAbaConfig(aba) {
  document.querySelectorAll('.config-tab-btn').forEach(b => {
    b.classList.toggle('is-active', b.getAttribute('data-config-tab') === aba);
  });
  document.querySelectorAll('[data-config-panel]').forEach(p => {
    p.style.display = p.getAttribute('data-config-panel') === aba ? '' : 'none';
  });
}

function onProvedorChange() {
  const pid = document.getElementById('config-provedor').value;
  const p   = PROVEDORES_META[pid];
  const inp = document.getElementById('config-api-key');
  inp.placeholder = p.placeholderChave;
  document.getElementById('config-hint-chave').textContent = p.hintChave;
  popularSelectModelos();
}

function popularSelectModelos(selecionado) {
  const pid = document.getElementById('config-provedor').value;
  const p   = PROVEDORES_META[pid];
  const sel = document.getElementById('config-modelo');
  const modelos = p.modelosFallback;
  sel.innerHTML = modelos.map(m => `<option value="${m.id}">${m.displayName}</option>`).join('');
  if (selecionado && modelos.some(m => m.id === selecionado)) {
    sel.value = selecionado;
  } else if (state.config?.modelo && modelos.some(m => m.id === state.config.modelo)) {
    sel.value = state.config.modelo;
  }
}

async function carregarModelos() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim();
  const p   = PROVEDORES_META[pid];
  const stEl = document.getElementById('modelos-status');
  if (!key) {
    stEl.textContent = 'Informe a chave primeiro.';
    stEl.style.display = 'block';
    return;
  }
  stEl.textContent = 'Carregando modelos...';
  stEl.style.display = 'block';
  try {
    const lista = await p.listar(key);
    const sel = document.getElementById('config-modelo');
    sel.innerHTML = lista.map(m => `<option value="${m.id}">${m.displayName}</option>`).join('');
    if (state.config?.modelo && lista.some(m => m.id === state.config.modelo)) sel.value = state.config.modelo;
    stEl.textContent = `✓ ${lista.length} modelo(s) disponível(is).`;
  } catch (e) {
    stEl.textContent = `Erro: ${e.message}`;
  }
}

async function salvarConfig() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim();
  const modelo = document.getElementById('config-modelo').value;
  const p = PROVEDORES_META[pid];
  if (!key) { mostrarToast('Informe a chave de API.', 'aviso'); return; }
  if (!p.regexChave.test(key)) {
    mostrarToast(`Chave inválida para ${p.label}.`, 'aviso');
    return;
  }
  state.config = { ...(state.config || {}), provedor: pid, apiKey: key, modelo };
  delete state.config.geminiKey;
  await new Promise(r => chrome.storage.local.set({ config: state.config }, r));
  document.getElementById('modal-configuracoes').style.display = 'none';
  mostrarToast('✓ Configurações salvas', 'sucesso');
}

// ============================================================
//  REANALISAR COM IA (prompt personalizado + biblioteca)
// ============================================================
let _reanaliseItem = null;

function setReanaliseStatus(texto, cor) {
  const el = document.getElementById('reanalise-status');
  if (!el) return;
  el.textContent = texto || '';
  el.style.color = cor || 'var(--text-dim)';
}

function popularSelectPrompts(selecionadoId = '') {
  const sel = document.getElementById('reanalise-select');
  if (!sel) return;
  const opcoes = ['<option value="">— Novo / instruções avulsas —</option>'].concat(
    (state.promptsBiblioteca || []).map(p => {
      const marca = p.id === state.promptPadraoId ? ' ★ (padrão)' : '';
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nome || '(sem nome)')}${marca}</option>`;
    })
  );
  sel.innerHTML = opcoes.join('');
  sel.value = selecionadoId || '';
}

// Reflete na UI o prompt selecionado no dropdown (texto, nome, botões, padrão).
function refletirSelecaoPrompt() {
  const id     = document.getElementById('reanalise-select').value;
  const chk    = document.getElementById('reanalise-padrao');
  const btnAtu = document.getElementById('btn-reanalise-atualizar');
  const btnExc = document.getElementById('btn-reanalise-excluir');
  const p = (state.promptsBiblioteca || []).find(x => x.id === id);
  if (p) {
    document.getElementById('reanalise-texto').value = p.texto || '';
    document.getElementById('reanalise-nome').value  = p.nome || '';
    btnAtu.style.display = 'inline-flex';
    btnExc.style.display = 'inline-flex';
    chk.checked = (state.promptPadraoId === p.id);
  } else {
    btnAtu.style.display = 'none';
    btnExc.style.display = 'none';
    chk.checked = false;
  }
}

async function abrirModalReanalise(it) {
  _reanaliseItem = it;
  document.getElementById('reanalise-alvo').textContent = `${tipoLabel(it.sigla)} ${it.numero}/${it.ano}`;
  setReanaliseStatus('');
  document.getElementById('reanalise-texto').value = '';
  document.getElementById('reanalise-nome').value  = '';
  document.getElementById('reanalise-padrao').checked = false;
  document.getElementById('btn-reanalise-atualizar').style.display = 'none';
  document.getElementById('btn-reanalise-excluir').style.display = 'none';
  document.getElementById('modal-reanalise').style.display = 'flex';

  // Recarrega a biblioteca para refletir o que a equipe salvou.
  try { await carregarBibliotecaPrompts(); } catch (e) { /* usa o que houver em memória */ }
  // Pré-seleciona o prompt-padrão da equipe, se houver.
  popularSelectPrompts(state.promptPadraoId || '');
  refletirSelecaoPrompt();
}

async function salvarPromptNovo() {
  const nome  = document.getElementById('reanalise-nome').value.trim();
  const texto = document.getElementById('reanalise-texto').value.trim();
  if (!nome)  { setReanaliseStatus('Dê um nome ao prompt para salvá-lo.', '#c08400'); return; }
  if (!texto) { setReanaliseStatus('Escreva as instruções antes de salvar.', '#c08400'); return; }
  setReanaliseStatus('Salvando…');
  try {
    const salvo = await fbSalvarPrompt({ nome, texto });
    await carregarBibliotecaPrompts();
    popularSelectPrompts(salvo.id);
    refletirSelecaoPrompt();
    setReanaliseStatus('✓ Prompt salvo na biblioteca.', '#0a8a3a');
  } catch (e) {
    setReanaliseStatus('Erro ao salvar: ' + e.message, '#c0392b');
  }
}

async function atualizarPromptSelecionado() {
  const id = document.getElementById('reanalise-select').value;
  if (!id) return;
  const nome  = document.getElementById('reanalise-nome').value.trim();
  const texto = document.getElementById('reanalise-texto').value.trim();
  if (!nome || !texto) { setReanaliseStatus('Nome e instruções são obrigatórios.', '#c08400'); return; }
  const atual = (state.promptsBiblioteca || []).find(x => x.id === id);
  setReanaliseStatus('Atualizando…');
  try {
    await fbSalvarPrompt({ id, nome, texto, criadoPor: atual?.criadoPor, criadoEm: atual?.criadoEm });
    await carregarBibliotecaPrompts();
    popularSelectPrompts(id);
    refletirSelecaoPrompt();
    setReanaliseStatus('✓ Prompt atualizado.', '#0a8a3a');
  } catch (e) {
    setReanaliseStatus('Erro ao atualizar: ' + e.message, '#c0392b');
  }
}

async function excluirPromptSelecionado() {
  const id = document.getElementById('reanalise-select').value;
  if (!id) return;
  if (!confirm('Excluir este prompt da biblioteca compartilhada? Isso afeta toda a equipe.')) return;
  setReanaliseStatus('Excluindo…');
  try {
    await fbApagarPrompt(id);
    if (state.promptPadraoId === id) {
      await fbSalvarPromptPadrao(null);
      state.promptPadraoId = null;
    }
    await carregarBibliotecaPrompts();
    popularSelectPrompts('');
    document.getElementById('reanalise-texto').value = '';
    document.getElementById('reanalise-nome').value  = '';
    refletirSelecaoPrompt();
    setReanaliseStatus('Prompt excluído.', '#888');
  } catch (e) {
    setReanaliseStatus('Erro ao excluir: ' + e.message, '#c0392b');
  }
}

// Define/remove o prompt-padrão compartilhado quando a caixa é marcada.
async function onReanalisePadraoToggle() {
  const chk = document.getElementById('reanalise-padrao');
  const id  = document.getElementById('reanalise-select').value;
  if (chk.checked) {
    if (!id) {
      chk.checked = false;
      setReanaliseStatus('Salve o prompt na biblioteca antes de defini-lo como padrão.', '#c08400');
      return;
    }
    try {
      await fbSalvarPromptPadrao(id);
      state.promptPadraoId = id;
      popularSelectPrompts(id);
      setReanaliseStatus('✓ Definido como padrão da equipe.', '#0a8a3a');
    } catch (e) {
      chk.checked = false;
      setReanaliseStatus('Erro ao definir padrão: ' + e.message, '#c0392b');
    }
  } else if (state.promptPadraoId && state.promptPadraoId === id) {
    try {
      await fbSalvarPromptPadrao(null);
      state.promptPadraoId = null;
      popularSelectPrompts(id);
      setReanaliseStatus('Padrão da equipe removido.', '#888');
    } catch (e) {
      chk.checked = true;
      setReanaliseStatus('Erro ao remover padrão: ' + e.message, '#c0392b');
    }
  }
}

function executarReanalise() {
  const it = _reanaliseItem;
  if (!it) return;
  const texto = document.getElementById('reanalise-texto').value.trim();
  if (!texto) { setReanaliseStatus('Escreva instruções ou selecione um prompt salvo.', '#c08400'); return; }
  const id = document.getElementById('reanalise-select').value;
  const p  = (state.promptsBiblioteca || []).find(x => x.id === id);
  // Nome registrado na análise: o do prompt salvo (se não foi editado) ou "personalizado".
  const promptNome = (p && (p.texto || '') === texto) ? p.nome : 'personalizado';
  document.getElementById('modal-reanalise').style.display = 'none';
  gerarAnaliseItem(it, true, { instrucoesExtra: texto, promptNome });
}

// ============================================================
//  BUSCA NA PAUTA
// ============================================================
function aplicarBuscaItens() {
  const q = (document.getElementById('busca-itens').value || '').toLowerCase().trim();
  const cards = document.querySelectorAll('.an-card');
  let visiveis = 0;
  cards.forEach(card => {
    if (!q) { card.style.display = ''; visiveis++; return; }
    const it = (state.pauta?.itens || []).find(x => x.chave === card.dataset.chave);
    if (!it) { card.style.display = 'none'; return; }
    const hay = [
      it.sigla, `${it.sigla} ${it.numero}/${it.ano}`, it.chave,
      it.numero, it.ano, it.ementa, it.autorTexto,
      it.relator ? `${it.relator.nome} ${it.relator.partido} ${it.relator.uf}` : '',
      ...(it.apensadosTexto || []).map(a => `${a.sigla} ${a.numero}/${a.ano}`),
    ].join(' ').toLowerCase();
    const match = hay.includes(q);
    card.style.display = match ? '' : 'none';
    if (match) visiveis++;
  });
  // Esconde também os títulos de seção que ficaram sem itens visíveis
  document.querySelectorAll('.an-secao-titulo').forEach(h => {
    let temVisivel = false;
    let n = h.nextElementSibling;
    while (n && !n.classList.contains('an-secao-titulo')) {
      if (n.classList.contains('an-card') && n.style.display !== 'none') { temVisivel = true; break; }
      n = n.nextElementSibling;
    }
    h.style.display = temVisivel || !q ? '' : 'none';
  });
}

// ============================================================
//  BUSCA NO HISTÓRICO (pautas anteriores)
// ============================================================
let _histTimer = null;
let _histNoTexto = false;   // toggle "buscar no texto das notas"

function agendarBuscaHistorico() {
  clearTimeout(_histTimer);
  _histTimer = setTimeout(executarBuscaHistorico, 300);
}

// Carrega (uma vez) o índice do histórico: itens de todas as pautas salvas
// + a lista de chaves que têm nota. As notas completas só são puxadas quando
// a busca no texto é ativada (carregarNotasCompletas).
async function carregarHistoricoBase() {
  if (state.historico.indice) return state.historico.indice;
  const [rp, rn] = await Promise.all([
    fetch(`${FIREBASE_URL}/pautas.json?shallow=false`),
    fetch(`${FIREBASE_URL}/analises_pauta.json?shallow=true`),
  ]);
  const pautas = rp.ok ? await rp.json() : null;
  const notas  = rn.ok ? await rn.json() : null;
  state.historico.notasShallow = notas || {};
  state.historico.indice = construirIndiceHistorico(pautas, notas);
  return state.historico.indice;
}

function construirIndiceHistorico(pautasMap, notasShallow) {
  const idx = new Map();   // chave -> { chave, sigla, numero, ano, ementa, autorTexto, tipoCategoria, pautas:[], temNota }
  for (const [pid, p] of Object.entries(pautasMap || {})) {
    for (const it of (p.itens || [])) {
      if (!it.chave) continue;
      let e = idx.get(it.chave);
      if (!e) {
        e = { chave: it.chave, sigla: it.sigla, numero: it.numero, ano: it.ano,
              ementa: it.ementa || '', autorTexto: it.autorTexto || '', tipoCategoria: it.tipoCategoria || 'projeto', pautas: [] };
        idx.set(it.chave, e);
      }
      if (it.ementa && !e.ementa) e.ementa = it.ementa;
      e.pautas.push({ id: pid, periodo: p.nome || p.periodo || p.titulo || pid, uploadedAt: p.uploadedAt });
    }
  }
  for (const e of idx.values()) e.temNota = !!(notasShallow && notasShallow[e.chave]);
  return idx;
}

async function carregarNotasCompletas() {
  if (state.historico.notasFull) return state.historico.notasFull;
  const r = await fetch(`${FIREBASE_URL}/analises_pauta.json`);
  state.historico.notasFull = r.ok ? (await r.json()) || {} : {};
  return state.historico.notasFull;
}

async function executarBuscaHistorico() {
  const cont = document.getElementById('an-historico');
  if (!cont) return;
  const q = (document.getElementById('busca-itens').value || '').toLowerCase().trim();
  if (q.length < 2) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
  cont.style.display = '';
  cont.innerHTML = '<div class="an-hist-loading">Buscando no histórico…</div>';
  let indice;
  try {
    indice = await carregarHistoricoBase();
    if (_histNoTexto) await carregarNotasCompletas();
  } catch (e) {
    cont.innerHTML = `<div class="an-hist-loading">Erro ao carregar o histórico: ${escapeHtml(e.message)}</div>`;
    return;
  }
  // Se a busca mudou enquanto carregava, descarta este resultado.
  if ((document.getElementById('busca-itens').value || '').toLowerCase().trim() !== q) return;

  const naAtual = new Set((state.pauta?.itens || []).map(i => i.chave));
  const matches = [];
  for (const e of indice.values()) {
    if (naAtual.has(e.chave)) continue;   // já está na pauta aberta (listada acima)
    const metaHay = `${e.sigla} ${e.numero}/${e.ano} ${e.sigla}${e.numero} ${e.ementa} ${e.autorTexto}`.toLowerCase();
    let hit = metaHay.includes(q);
    if (!hit && _histNoTexto) {
      const versoes = state.historico.notasFull?.[e.chave];
      if (versoes) hit = Object.values(versoes).some(n =>
        (n?.markdown || '').toLowerCase().includes(q) || (n?.apelido || '').toLowerCase().includes(q));
    }
    if (hit) {
      e._ultima = e.pautas.reduce((m, p) => Math.max(m, new Date(p.uploadedAt || 0).getTime()), 0);
      matches.push(e);
    }
  }
  matches.sort((a, b) => b._ultima - a._ultima);
  renderHistorico(matches, q);
}

function renderHistorico(matches, q) {
  const cont = document.getElementById('an-historico');
  const header = `<div class="an-hist-head">
      <span class="an-hist-titulo">No histórico${matches.length ? ` (${matches.length})` : ''}</span>
      <label class="an-hist-toggle"><input type="checkbox" id="hist-no-texto" ${_histNoTexto ? 'checked' : ''}> buscar no texto das notas</label>
    </div>`;
  let body;
  if (!matches.length) {
    body = `<div class="an-hist-vazio">Nenhuma proposição de pautas anteriores corresponde a “${escapeHtml(q)}”.</div>`;
  } else {
    body = `<div class="an-hist-lista">${matches.slice(0, 60).map(e => {
      const quando = [...new Set(e.pautas
        .slice().sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))
        .map(p => p.periodo))].slice(0, 3).map(escapeHtml).join(' · ');
      return `<div class="an-hist-item" data-chave="${escapeHtml(e.chave)}">
        <div class="an-hist-item-tit">${escapeHtml(tipoLabel(e.sigla) + ' ' + e.numero + '/' + e.ano)}${e.temNota ? '<span class="an-hist-nota">nota</span>' : ''}</div>
        ${e.ementa ? `<div class="an-hist-item-em">${escapeHtml(e.ementa.slice(0, 150))}</div>` : ''}
        <div class="an-hist-item-meta">apareceu em: ${quando || '—'}</div>
      </div>`;
    }).join('')}${matches.length > 60 ? `<div class="an-hist-vazio">…e mais ${matches.length - 60}. Refine a busca.</div>` : ''}</div>`;
  }
  cont.innerHTML = header + body;
  cont.querySelector('#hist-no-texto').addEventListener('change', ev => { _histNoTexto = ev.target.checked; executarBuscaHistorico(); });
  cont.querySelectorAll('.an-hist-item').forEach(el => el.addEventListener('click', () => abrirPreviewHistorico(el.dataset.chave)));
}

// Carrega a nota mais recente (qualquer versão de parecer) de uma proposição.
async function fbCarregarNotaPorChave(chave) {
  const r = await fetch(`${FIREBASE_URL}/analises_pauta/${encodeURIComponent(chave)}.json`);
  if (!r.ok) return null;
  const versoes = await r.json();
  if (!versoes) return null;
  const arr = Object.values(versoes).filter(Boolean);
  arr.sort((a, b) => new Date(b.geradoEm || 0) - new Date(a.geradoEm || 0));
  return arr[0] || null;
}

let _histPreviewCtx = null;   // { entry, nota }

async function abrirPreviewHistorico(chave) {
  const entry = state.historico.indice?.get(chave);
  if (!entry) return;
  const corpo = document.getElementById('hist-preview-corpo');
  const titulo = document.getElementById('hist-preview-titulo');
  titulo.textContent = `${tipoLabel(entry.sigla)} ${entry.numero}/${entry.ano}`;
  corpo.innerHTML = '<div class="an-hist-loading">Carregando a nota…</div>';
  document.getElementById('modal-hist-preview').style.display = 'flex';
  let nota = null;
  try { nota = await fbCarregarNotaPorChave(chave); } catch (_) {}
  _histPreviewCtx = { entry, nota };
  const meta = nota ? `<div class="hist-preview-meta">${escapeHtml(entry.ementa || '')}</div>` : '';
  const notaCorpo = nota?.formato === 'html'
    ? sanitizarNotaHtml(nota.html || '')
    : (nota?.markdown ? renderMarkdown(mdSemAcolhimento(nota.markdown)) : '');
  corpo.innerHTML = meta + (notaCorpo
    || `<div class="an-hist-vazio">Esta proposição apareceu em pauta(s) anterior(es), mas não tem nota técnica salva.</div>`);
  // Habilita "trazer" só se houver pauta aberta e o item ainda não estiver nela
  const btnTrazer = document.getElementById('btn-hist-trazer');
  const podeTrazer = !!state.pauta && !(state.pauta.itens || []).some(it => it.chave === chave);
  btnTrazer.style.display = podeTrazer ? 'inline-flex' : 'none';
}

function abrirPautaDeOrigem() {
  const ctx = _histPreviewCtx;
  if (!ctx) return;
  const ult = ctx.entry.pautas.slice().sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))[0];
  if (!ult) return;
  document.getElementById('modal-hist-preview').style.display = 'none';
  carregarPautaPorId(ult.id);
}

async function trazerParaPautaAtual() {
  const ctx = _histPreviewCtx;
  if (!ctx || !state.pauta) return;
  const e = ctx.entry;
  if ((state.pauta.itens || []).some(it => it.chave === e.chave)) {
    mostrarToast('Esta proposição já está na pauta atual.', 'aviso');
    return;
  }
  const novo = normalizarItem({
    ordem: null, tipoCategoria: e.tipoCategoria || 'projeto',
    sigla: e.sigla, numero: e.numero, ano: e.ano,
    ementa: e.ementa || '', autorTexto: e.autorTexto || '',
    apensadosTexto: [], relator: null, temUrgencia: false, adicionadoManualmente: true,
  });
  if (ctx.nota) { novo.analise = ctx.nota; novo.analiseStatus = 'ok'; novo.apelido = ctx.nota.apelido || ''; }
  state.pauta.itens.push(novo);
  renderizarPauta();
  enriquecerItem(novo).catch(() => {});
  marcarSujo();
  fbSalvarPauta(state.pauta).catch(err => console.warn('Firebase save falhou:', err.message));
  document.getElementById('modal-hist-preview').style.display = 'none';
  mostrarToast(`✓ ${tipoLabel(e.sigla)} ${e.numero}/${e.ano} trazido para a pauta atual`, 'sucesso');
}

// ============================================================
//  ADICIONAR / REMOVER ITENS DA PAUTA
// ============================================================
let _itemParaRemover = null;

function abrirModalAdicionar() {
  if (!state.pauta) { mostrarToast('Carregue uma pauta primeiro.', 'aviso'); return; }
  document.getElementById('add-tipo').value = 'PL';
  document.getElementById('add-numero').value = '';
  document.getElementById('add-ano').value = '';
  document.getElementById('add-ordem').value = '';
  document.getElementById('add-status').textContent = '';
  document.getElementById('modal-adicionar').style.display = 'flex';
}

async function confirmarAdicionar() {
  const sigla  = document.getElementById('add-tipo').value;
  const numero = limpaNumero(document.getElementById('add-numero').value);
  const ano    = (document.getElementById('add-ano').value || '').trim();
  const ordem  = parseInt(document.getElementById('add-ordem').value, 10);
  const stEl   = document.getElementById('add-status');

  if (!numero || !/^\d{4}$/.test(ano)) {
    stEl.textContent = 'Informe número e ano (4 dígitos).';
    return;
  }

  const chave = `${sigla}-${numero}-${ano}`;
  if (state.pauta.itens.some(it => it.chave === chave)) {
    stEl.textContent = 'Este item já está na pauta.';
    return;
  }

  const btn = document.getElementById('btn-confirmar-adicionar');
  btn.disabled = true;
  stEl.textContent = 'Buscando proposição na API da Câmara...';

  try {
    const prop = await resolveProposicao(sigla, numero, ano);
    // Detalhe para ementa e autor
    const det  = await fetchJson(`${API_BASE}/proposicoes/${prop.id}`);
    const dados = det.dados || {};

    const novo = normalizarItem({
      ordem:         isNaN(ordem) ? null : ordem,
      tipoCategoria: 'projeto',
      sigla,
      numero,
      ano,
      ementa:        (dados.ementa || '').trim(),
      autorTexto:    '',
      apensadosTexto: [],
      relator:       null,
      temUrgencia:   false,
      adicionadoManualmente: true,
    });

    state.pauta.itens.push(novo);
    renderizarPauta();
    enriquecerItem(novo).catch(e => console.warn('Enriquecimento manual falhou:', e));
    marcarSujo();
    fbSalvarPauta(state.pauta).catch(e => console.warn('Firebase save falhou:', e.message));

    document.getElementById('modal-adicionar').style.display = 'none';
    mostrarToast(`✓ ${tipoLabel(sigla)} ${numero}/${ano} adicionado à pauta`, 'sucesso');
  } catch (e) {
    stEl.textContent = `Erro: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- Vínculo manual do projeto da urgência (requerimentos) ----------
let _itemParaVincular = null;

function abrirVincularProjeto(it) {
  _itemParaVincular = it;
  const alvo = it.projetoUrgenciado || {};
  document.getElementById('vinc-tipo').value   = alvo.sigla || 'PL';
  document.getElementById('vinc-numero').value = alvo.numero || '';
  document.getElementById('vinc-ano').value    = alvo.ano || '';
  document.getElementById('vinc-status').textContent = '';
  document.getElementById('modal-vincular').style.display = 'flex';
}

async function confirmarVincular() {
  const it = _itemParaVincular;
  if (!it) return;
  const sigla  = document.getElementById('vinc-tipo').value;
  const numero = limpaNumero(document.getElementById('vinc-numero').value);
  const ano    = (document.getElementById('vinc-ano').value || '').trim();
  const stEl   = document.getElementById('vinc-status');
  if (!numero || !/^\d{4}$/.test(ano)) { stEl.textContent = 'Informe número e ano (4 dígitos).'; return; }

  const btn = document.getElementById('btn-confirmar-vincular');
  btn.disabled = true;
  stEl.textContent = 'Vinculando e rebuscando na API da Câmara…';

  it.projetoUrgenciado = { sigla, numero, ano };
  it.enriquecimento = { status: 'pendente' };
  marcarSujo();
  fbSalvarPauta(state.pauta).catch(e => console.warn('Firebase save falhou:', e.message));

  // Recria só este card para refletir o vínculo na linha "Urgência p/".
  const oldCard = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (oldCard) { const novo = renderCard(it); oldCard.replaceWith(novo); if (it.analise) renderAnaliseCard(it); }

  document.getElementById('modal-vincular').style.display = 'none';
  try {
    await enriquecerItem(it);
    mostrarToast(`✓ Vinculado a ${tipoLabel(sigla)} ${numero}/${ano}`, 'sucesso');
  } catch (e) {
    // O vínculo já foi salvo; só o rebusca falhou (ex.: API ainda fora do ar).
    mostrarToast(`Vínculo salvo, mas a busca na API falhou. Use "Verificar atualizações" quando a API voltar.`, 'aviso');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Recategorizar itens da pauta carregada ----------
const RECAT_CATS = [['projeto', 'Projeto / Matéria'], ['requerimento', 'Requerimento de Urgência'], ['redacao_final', 'Redação Final']];

function abrirRecategorizar() {
  if (!state.pauta) { mostrarToast('Carregue uma pauta primeiro.', 'aviso'); return; }
  const cont = document.getElementById('recat-lista');
  cont.innerHTML = state.pauta.itens.map(it => {
    const opts = RECAT_CATS.map(([v, l]) => `<option value="${v}" ${it.tipoCategoria === v ? 'selected' : ''}>${l}</option>`).join('');
    const urg = it.projetoUrgenciado
      ? ` <span style="color:var(--text-dim)">(urg. p/ ${escapeHtml(tipoLabel(it.projetoUrgenciado.sigla))} ${escapeHtml(String(it.projetoUrgenciado.numero))}/${escapeHtml(String(it.projetoUrgenciado.ano))})</span>` : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-soft)">
      <span style="flex:1;font-size:13px">${escapeHtml(tipoLabel(it.sigla))} ${escapeHtml(String(it.numero))}/${escapeHtml(String(it.ano))}${urg}</span>
      <select class="form-input" data-recat="${escapeHtml(it.chave)}" style="width:240px;height:32px">${opts}</select>
    </div>`;
  }).join('');
  document.getElementById('recat-status').textContent = '';
  document.getElementById('modal-recategorizar').style.display = 'flex';
}

function recatCorrigirAuto() {
  let n = 0;
  document.querySelectorAll('#recat-lista select[data-recat]').forEach(sel => {
    const it = state.pauta.itens.find(x => x.chave === sel.getAttribute('data-recat'));
    if (it && (it.sigla === 'REQ' || it.sigla === 'REC') && sel.value !== 'requerimento') { sel.value = 'requerimento'; n++; }
  });
  document.getElementById('recat-status').textContent = n ? `${n} requerimento(s) ajustado(s) — revise e clique em Aplicar.` : 'Nenhum requerimento para corrigir.';
}

async function aplicarRecategorizar() {
  const mudados = [];
  document.querySelectorAll('#recat-lista select[data-recat]').forEach(sel => {
    const it = state.pauta.itens.find(x => x.chave === sel.getAttribute('data-recat'));
    if (it && it.tipoCategoria !== sel.value) {
      it.tipoCategoria = sel.value;
      it.enriquecimento = { status: 'pendente' };   // a categoria muda o "alvo" do enriquecimento
      mudados.push(it);
    }
  });
  document.getElementById('modal-recategorizar').style.display = 'none';
  if (!mudados.length) return;
  // Re-renderiza (reagrupa nas seções) preservando as notas já carregadas.
  renderizarPauta();
  for (const it of state.pauta.itens) if (it.analise) renderAnaliseCard(it);
  marcarSujo();
  fbSalvarPauta(state.pauta).catch(e => console.warn('Firebase save falhou:', e.message));
  mostrarToast(`✓ ${mudados.length} item(ns) recategorizado(s).`, 'sucesso');
  for (const it of mudados) enriquecerItem(it).catch(() => {});
}

function abrirModalRemover(it) {
  _itemParaRemover = it;
  document.getElementById('remover-nome').textContent =
    `${tipoLabel(it.sigla)} ${it.numero}/${it.ano}${it.ordem ? ' (item ' + it.ordem + ')' : ''}`;
  document.getElementById('modal-remover').style.display = 'flex';
}

async function confirmarRemover() {
  if (!_itemParaRemover) return;
  const it = _itemParaRemover;
  const idx = state.pauta.itens.findIndex(x => x.chave === it.chave);
  if (idx >= 0) state.pauta.itens.splice(idx, 1);
  state.selecionados.delete(it.chave);
  _itemParaRemover = null;
  document.getElementById('modal-remover').style.display = 'none';
  renderizarPauta();

  // Apaga a análise correspondente ao parecer registrado para este item,
  // evitando deixar entrada órfã em /analises_pauta.
  const pk = parecerKey(it);
  fetch(`${FIREBASE_URL}/analises_pauta/${encodeURIComponent(it.chave)}/${encodeURIComponent(pk)}.json`, { method: 'DELETE' })
    .catch(() => {});

  marcarSujo();
  fbSalvarPauta(state.pauta).catch(e => console.warn('Firebase save falhou:', e.message));
  mostrarToast('Item removido da pauta', 'sucesso');
}

// ============================================================
//  SALVAR PAUTA MANUALMENTE NO FIREBASE
// ============================================================
async function salvarPautaManual() {
  if (!state.pauta) { mostrarToast('Carregue uma pauta primeiro.', 'aviso'); return; }
  const btn = document.getElementById('btn-salvar-firebase');
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="an-spinner"></span> Salvando...';
  try {
    await fbSalvarPauta(state.pauta);
    mostrarToast('✓ Pauta salva no Firebase', 'sucesso');
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao salvar: ' + e.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function mostrarToast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${tipo}`;
  el.style.display = 'block';
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}
