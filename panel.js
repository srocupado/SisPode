/* ============================================================
   DESTAQUES LEGISLATIVOS – PODEMOS
   Lógica Principal (sem inline handlers — compatível com CSP MV3)
   ============================================================ */

'use strict';

// ---------- CONFIGURAÇÕES ----------
const API_BASE      = 'https://dadosabertos.camara.leg.br/api/v2';
const PPLEN_BASE    = 'https://www.camara.leg.br/pplen/destaques.html';
const GEMINI_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';
const FIREBASE_URL  = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const COD_ORGAO     = 180;

const SITUACOES_INATIVAS = ['retirado', 'prejudicado', 'rejeitado', 'não admitido', 'nao admitido', 'inadmitido', 'não admitida', 'nao admitida'];

const SITUACAO_CLASSES = {
  'retirado':        'status-retirado',
  'prejudicado':     'status-prejudicado',
  'rejeitado':       'status-rejeitado',
  'aprovado':        'status-aprovado',
  'mantido o texto': 'status-mantido',
  'não admitido':    'status-rejeitado',
  'nao admitido':    'status-rejeitado',
};

// ---------- ESTADO ----------
let app = {
  sessaoAtual:     null,
  proposicaoAtiva: null,
  destinqueAtivo:  null,
  filtroAtual:     'ativos',
  buscaProposicoes:'',
  toastTimer:      null,
  syncTimer:       null,
  sessaoParaApagar: null,   // ID da sessão aguardando confirmação de exclusão
  config: {
    geminiKey:   '',
    modelo:      'gemini-2.5-flash-preview-04-17',
    profundidade:'resumo',
  },
};

// ---------- INICIALIZAÇÃO ----------
document.addEventListener('DOMContentLoaded', () => {
  configurarPDF();
  registrarEventos();
  carregarConfiguracao();
  carregarHistorico();
  // Pré-carrega o histórico na sidebar sem sair da home
});

function configurarPDF() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  }
}

// ============================================================
//  REGISTRO CENTRALIZADO DE EVENTOS (sem onclick no HTML)
// ============================================================
function registrarEventos() {

  // Botão Voltar ao Início
  document.getElementById('btn-voltar-home')
    .addEventListener('click', voltarHome);

  // Botão Nova Sessão
  document.getElementById('btn-nova-sessao')
    .addEventListener('click', abrirModalNovaSessao);

  // Botão Atualizar Destaques
  document.getElementById('btn-atualizar')
    .addEventListener('click', atualizarDestaques);

  // Botão Criar Sessão
  document.getElementById('btn-criar-sessao')
    .addEventListener('click', criarSessao);

  // Botão Exportar Word
  document.getElementById('btn-exportar-docx')
    .addEventListener('click', exportarDocx);

  // Botão Exportar WhatsApp
  document.getElementById('btn-exportar-whatsapp')
    .addEventListener('click', exportarWhatsapp);

  // Configurações
  document.getElementById('btn-configuracoes')
    .addEventListener('click', abrirConfiguracoes);

  document.getElementById('btn-salvar-config')
    .addEventListener('click', salvarConfiguracao);

  document.getElementById('btn-testar-ia')
    .addEventListener('click', testarConexaoIA);

  document.getElementById('btn-carregar-modelos')
    .addEventListener('click', carregarModelosDisponiveis);

  document.getElementById('btn-toggle-key')
    .addEventListener('click', () => {
      const input = document.getElementById('config-gemini-key');
      input.type  = input.type === 'password' ? 'text' : 'password';
    });

  // Fechar modais via data-fecha
  document.querySelectorAll('[data-fecha]').forEach(btn => {
    btn.addEventListener('click', () => fecharModal(btn.dataset.fecha));
  });

  // Fechar modal clicando no overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) fecharModal(overlay.id);
    });
  });

  // Filtros de destaques
  document.querySelectorAll('.filtro-tab').forEach(tab => {
    tab.addEventListener('click', () => filtrarDestaques(tab.dataset.filtro, tab));
  });

  // Upload na tela inicial
  const inputPdf  = document.getElementById('input-pdf');
  const uploadArea = document.getElementById('upload-area');

  inputPdf.addEventListener('change', e => {
    if (e.target.files[0]) processarPdfInicial(e.target.files[0]);
  });

  uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') processarPdfInicial(file);
    else mostrarToast('Selecione um arquivo PDF válido.', 'erro');
  });

  // Upload no modal
  document.getElementById('input-pdf-modal')
    .addEventListener('change', e => {
      if (e.target.files[0]) processarPdfModal(e.target.files[0]);
    });

  // Busca de proposições
  const inputBusca  = document.getElementById('busca-proposicoes');
  const btnLimpar   = document.getElementById('btn-limpar-busca');

  inputBusca.addEventListener('input', () => {
    app.buscaProposicoes = inputBusca.value.trim().toLowerCase();
    btnLimpar.style.display = app.buscaProposicoes ? 'block' : 'none';
    renderizarProposicoesSidebar();
  });

  btnLimpar.addEventListener('click', () => {
    inputBusca.value       = '';
    app.buscaProposicoes   = '';
    btnLimpar.style.display = 'none';
    inputBusca.focus();
    renderizarProposicoesSidebar();
  });

  // Delegação de eventos: lista de proposições na sidebar
  document.getElementById('lista-proposicoes')
    .addEventListener('click', e => {
      const item = e.target.closest('.prop-item');
      if (item) selecionarProposicao(item.dataset.chave);
    });

  // Delegação de eventos: histórico (carregar ou apagar)
  document.getElementById('lista-historico')
    .addEventListener('click', e => {
      // Verifica se clicou no botão de apagar — tem prioridade
      const deleteBtn = e.target.closest('.hist-item-delete');
      if (deleteBtn) {
        e.stopPropagation();
        abrirModalApagarSessao(deleteBtn.dataset.id, deleteBtn.dataset.titulo);
        return;
      }
      const item = e.target.closest('.hist-item');
      if (item) restaurarSessao(item.dataset.id);
    });

  // Confirmação de exclusão
  document.getElementById('btn-confirmar-apagar')
    .addEventListener('click', async () => {
      if (app.sessaoParaApagar) {
        await apagarSessao(app.sessaoParaApagar);
        fecharModal('modal-apagar-sessao');
        app.sessaoParaApagar = null;
      }
    });

  // Delegação de eventos: chips de proposição no modal (remover)
  document.getElementById('lista-proposicoes-modal')
    .addEventListener('click', e => {
      const btn = e.target.closest('.prop-chip-remove');
      if (btn) removerProposicaoPDF(btn.dataset.chave);
    });

  // Delegação de eventos: cards de destaque
  document.getElementById('lista-destaques')
    .addEventListener('click', e => {
      const card = e.target.closest('.destaque-card');
      if (card && !card.classList.contains('inativo')) {
        abrirDestaque(parseInt(card.dataset.index));
      }
    });

  // Delegação: botões dentro do modal de destaque (dinâmico)
  document.getElementById('modal-destaque-body')
    .addEventListener('click', e => {
      if (e.target.closest('#btn-gerar-ia'))        gerarExplicacaoIA();
      if (e.target.closest('#btn-salvar-destaque')) salvarDestaqueManual();
      if (e.target.closest('#btn-toggle-manual'))   toggleManualIA();
      if (e.target.closest('#btn-limpar-manual'))   limparManualIA();
    });

  // Botão sincronização manual Firebase
  document.getElementById('btn-sync-manual')
    .addEventListener('click', sincronizarAgora);

  // ── HOME: navegação entre sistemas ──
  renderHomeGrid();
}

// ---------- UPLOAD E PARSING DO PDF ----------

// Tela inicial: abre modal e pre-carrega o arquivo
function processarPdfInicial(file) {
  abrirModalNovaSessao();
  // Pequeno delay para o modal terminar de renderizar
  setTimeout(() => processarPdfModal(file), 100);
}

async function processarPdfModal(file) {
  const uploadInline = document.getElementById('upload-inline');
  const uploadText   = document.getElementById('upload-inline-text');

  uploadText.textContent = 'Lendo PDF...';
  uploadInline.classList.add('tem-arquivo');

  try {
    const texto = await extrairTextoPDF(file);
    const props  = extrairProposicoes(texto);

    if (props.length === 0) {
      mostrarToast('Nenhuma proposição encontrada no PDF.', 'aviso');
      uploadText.textContent = 'Clique para selecionar o PDF';
      uploadInline.classList.remove('tem-arquivo');
      return;
    }

    // Sugerir título da sessão
    const dataMatch = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
    const tituloInput = document.getElementById('sessao-titulo');
    if (dataMatch && !tituloInput.value) {
      tituloInput.value = `Sessão de ${dataMatch[1]}`;
    }

    uploadText.textContent = `${file.name} — ${props.length} proposição(ões) encontrada(s)`;
    window._proposicoesPDF = props;
    renderizarProposicoesPDF(props);
    document.getElementById('btn-criar-sessao').disabled = false;

  } catch (err) {
    console.error('Erro ao ler PDF:', err);
    mostrarToast('Erro ao ler o PDF. Tente novamente.', 'erro');
    uploadText.textContent = 'Clique para selecionar o PDF';
    uploadInline.classList.remove('tem-arquivo');
  }
}

async function extrairTextoPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let texto         = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map(it => it.str).join(' ') + '\n';
  }
  return texto;
}

function extrairProposicoes(texto) {
  // Aceita: "PL 1234/2024", "PL nº 1234/2024", "PL n.º 1.234/2024", etc.
  const regex = /\b(PL|PLP|PEC|PRC|PDL|REQ|MPV|PLV|PDC|PDS|PFC|EMC|SBT|EMR|INC|RCP)\s*(?:n[º°o]?\.?\s*)?(\d{1,2}\.\d{3}|\d{1,5})\/(\d{4})\b/gi;
  const encontrados = new Map();
  let match;
  while ((match = regex.exec(texto)) !== null) {
    const numero = parseInt(match[2].replace(/\./g, ''));
    const chave = `${match[1].toUpperCase()} ${numero}/${match[3]}`;
    if (!encontrados.has(chave)) {
      encontrados.set(chave, {
        sigla:  match[1].toUpperCase(),
        numero,
        ano:    parseInt(match[3]),
        chave,
      });
    }
  }
  return Array.from(encontrados.values());
}

function renderizarProposicoesPDF(props) {
  const lista = document.getElementById('lista-proposicoes-modal');
  const sec   = document.getElementById('proposicoes-encontradas');

  lista.innerHTML = props.map(p => `
    <div class="prop-chip">
      ${p.chave}
      <span class="prop-chip-remove" data-chave="${p.chave}" title="Remover">×</span>
    </div>
  `).join('');

  sec.style.display = 'block';
}

function removerProposicaoPDF(chave) {
  window._proposicoesPDF = (window._proposicoesPDF || []).filter(p => p.chave !== chave);
  const chip = document.querySelector(`.prop-chip-remove[data-chave="${chave}"]`);
  if (chip) chip.closest('.prop-chip').remove();
  if (!window._proposicoesPDF.length) {
    document.getElementById('btn-criar-sessao').disabled = true;
  }
}

// ---------- SESSÃO ----------
async function criarSessao() {
  const titulo = document.getElementById('sessao-titulo').value.trim()
    || `Sessão de ${new Date().toLocaleDateString('pt-BR')}`;

  const props  = window._proposicoesPDF || [];
  if (!props.length) { mostrarToast('Nenhuma proposição para criar a sessão.', 'aviso'); return; }

  const sessao = {
    id:          Date.now().toString(),
    titulo,
    data:        new Date().toISOString(),
    proposicoes: props.map(p => ({
      ...p,
      idCamara:   null,
      ementa:     null,
      autor:      null,
      statusDesc: null,
      destaques:  [],
      ultimaSync: null,
    })),
  };

  fecharModal('modal-nova-sessao');
  window._proposicoesPDF = [];

  await salvarSessao(sessao);
  await carregarSessao(normalizarSessao(sessao));
}

async function carregarSessao(sessao) {
  app.sessaoAtual      = sessao;
  app.proposicaoAtiva  = null;
  app.buscaProposicoes = '';
  const inputBusca = document.getElementById('busca-proposicoes');
  if (inputBusca) inputBusca.value = '';
  const btnLimpar = document.getElementById('btn-limpar-busca');
  if (btnLimpar) btnLimpar.style.display = 'none';

  const info = document.getElementById('sessao-info');
  info.textContent = sessao.titulo;
  info.classList.remove('empty');

  // Exibir barra de sync
  const syncBar = document.getElementById('sync-bar');
  if (syncBar) syncBar.style.display = 'flex';

  mostrarTela('tela-destaques');
  renderizarProposicoesSidebar();
  mostrarToast('Sessão carregada. Buscando dados das proposições...', 'sucesso');

  await carregarMetadadosProposicoes();
  await carregarHistorico();

  // Iniciar sincronização automática com Firebase (a cada 20s)
  iniciarSyncAutomatico();
}

async function carregarMetadadosProposicoes() {
  const sess = app.sessaoAtual;
  await Promise.all(sess.proposicoes.map(async prop => {
    try {
      const data = await buscarProposicaoAPI(prop.sigla, prop.numero, prop.ano);
      if (data) {
        prop.idCamara   = data.id;
        prop.ementa     = data.ementa;
        prop.autor      = data.autor;
        prop.statusDesc = data.statusDesc;
      }
    } catch (e) {
      console.warn(`Erro ao buscar ${prop.chave}:`, e.message);
    }
  }));
  await salvarSessao(sess);
  renderizarProposicoesSidebar();
}

// ---------- API CÂMARA ----------
async function buscarProposicaoAPI(sigla, numero, ano) {
  const url = `${API_BASE}/proposicoes?siglaTipo=${sigla}&numero=${numero}&ano=${ano}&itens=1`;
  const res  = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const item = json.dados?.[0];
  if (!item) return null;

  let autor = null;
  try {
    const resA = await fetch(`${API_BASE}/proposicoes/${item.id}/autores`);
    if (resA.ok) {
      const jA = await resA.json();
      if (jA.dados?.[0]) autor = jA.dados[0].nome;
    }
  } catch (_) {}

  return {
    id:         item.id,
    ementa:     item.ementa,
    autor,
    statusDesc: item.statusProposicao?.descricaoSituacao || null,
  };
}

// ---------- DESTAQUES ----------
async function buscarDestaques(idCamara) {
  const url = `${PPLEN_BASE}?codOrgao=${COD_ORGAO}&codProposicao=${idCamara}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseDestaques(await res.text());
}

function parseDestaques(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const destaques = [];

  doc.querySelectorAll('table').forEach(tabela => {
    tabela.querySelectorAll('tr').forEach(row => {
      const cells  = Array.from(row.querySelectorAll('td'));
      if (cells.length < 3) return;

      const textos = cells.map(c => c.textContent.trim());
      if (!/^(DTQ|EMC|DVT)\s*\d+/i.test(textos[0])) return;

      const situacaoRaw  = textos[textos.length - 1] || '';
      const situacaoNorm = situacaoRaw.toLowerCase();
      const ativo = !SITUACOES_INATIVAS.some(s => situacaoNorm.includes(s));

      // Captura título completo + URL do destaque: o link na linha contém o nome inteiro
      // (ex: "Destaque para Votação em Separado do inciso II do art. 19 do PL 3278/2021,
      // com fins de supressão") tanto no texto da âncora quanto no parâmetro filename= da URL.
      const linkEl = row.querySelector('a[href]');
      let tituloLink = '';
      let urlLink = '';
      if (linkEl) {
        urlLink = resolverUrlCamara(linkEl.getAttribute('href'));
        tituloLink = linkEl.textContent.trim();
        if (!tituloLink || tituloLink.length < 20) {
          try {
            const u = new URL(linkEl.getAttribute('href'), 'https://www.camara.leg.br');
            const fn = u.searchParams.get('filename');
            if (fn) tituloLink = decodeURIComponent(fn).replace(/\+/g, ' ');
          } catch (_) { /* href malformado: ignora */ }
        }
      }

      destaques.push({
        numero:    textos[0],
        autoria:   textos[1] || '',
        descricao: textos[2] || '',
        tipo:      textos[3] || '',
        tituloLink,
        urlLink,
        situacao:  situacaoRaw || 'Pendente',
        ativo,
      });
    });
  });

  return destaques;
}

// ---------- SELEÇÃO DE PROPOSIÇÃO ----------
function selecionarProposicao(chave) {
  const prop = app.sessaoAtual?.proposicoes.find(p => p.chave === chave);
  if (!prop) return;

  app.proposicaoAtiva = prop;
  mostrarTela('tela-destaques');

  document.querySelectorAll('.prop-item').forEach(el =>
    el.classList.toggle('active', el.dataset.chave === chave)
  );

  document.getElementById('prop-badge').textContent  = prop.chave;
  document.getElementById('prop-ementa').textContent = prop.ementa || 'Buscando informações...';
  document.getElementById('prop-meta').textContent   =
    [prop.autor, prop.statusDesc].filter(Boolean).join(' · ');

  document.getElementById('btn-atualizar').disabled = !prop.idCamara;

  renderizarDestaques();
  if (prop.idCamara && !prop.ultimaSync) atualizarDestaques();
}

async function atualizarDestaques() {
  const prop = app.proposicaoAtiva;
  if (!prop?.idCamara) {
    mostrarToast('Proposição sem ID na API. Dados indisponíveis.', 'aviso');
    return;
  }

  const btn = document.getElementById('btn-atualizar');
  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner"></span> Atualizando...`;

  try {
    const novos = await buscarDestaques(prop.idCamara);
    const existentes = new Map((prop.destaques || []).map(d => [d.numero, d]));
    prop.destaques = novos.map(d => {
      const ant = existentes.get(d.numero);
      if (!ant) return d;
      return { ...d, votoSim: ant.votoSim, votoNao: ant.votoNao, explicacao: ant.explicacao, orientacao: ant.orientacao };
    });
    prop.ultimaSync = new Date().toISOString();
    await salvarSessao(app.sessaoAtual);
    renderizarDestaques();
    renderizarProposicoesSidebar();
    const ativos = prop.destaques.filter(d => d.ativo).length;
    mostrarToast(`${prop.destaques.length} destaques carregados (${ativos} ativos).`, 'sucesso');
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao buscar destaques. Verifique a conexão.', 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg> Atualizar Destaques`;
  }
}

// ---------- RENDERIZAÇÃO ----------
function renderizarProposicoesSidebar() {
  const lista  = document.getElementById('lista-proposicoes');
  const busca  = document.getElementById('busca-wrapper');
  const sess   = app.sessaoAtual;

  if (!sess?.proposicoes.length) {
    lista.innerHTML = `<div class="empty-state"><p>Nenhuma proposição carregada</p></div>`;
    busca.style.display = 'none';
    return;
  }

  // Mostrar campo de busca quando há sessão
  busca.style.display = 'block';

  // Filtrar pelo termo de busca
  const termo = app.buscaProposicoes;
  const filtradas = termo
    ? sess.proposicoes.filter(p =>
        p.chave.toLowerCase().includes(termo) ||
        (p.ementa || '').toLowerCase().includes(termo) ||
        (p.autor  || '').toLowerCase().includes(termo)
      )
    : sess.proposicoes;

  if (!filtradas.length) {
    lista.innerHTML = `<div class="busca-nenhum">Nenhuma proposição encontrada para "<strong>${termo}</strong>"</div>`;
    return;
  }

  lista.innerHTML = filtradas.map(p => {
    const dests    = Array.isArray(p.destaques) ? p.destaques : [];
    const nAtivos  = dests.filter(d => d.ativo).length;
    const nTotal   = dests.length;
    const contagem = nTotal > 0 ? `${nAtivos}/${nTotal}` : (p.idCamara ? '–' : '?');

    // Destacar o termo na ementa se houver busca
    const ementa = termo
      ? destacarTermo(p.ementa || 'Carregando...', termo)
      : (p.ementa || 'Carregando...');

    return `
    <div class="prop-item ${app.proposicaoAtiva?.chave === p.chave ? 'active' : ''}" data-chave="${p.chave}">
      <span class="prop-item-badge">${p.chave}</span>
      <span class="prop-item-nome">${ementa}</span>
      <span class="prop-item-count">${contagem}</span>
    </div>`;
  }).join('');
}

// Destaca visualmente o termo buscado no texto
function destacarTermo(texto, termo) {
  if (!termo) return texto;
  const re = new RegExp(`(${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return texto.replace(re, '<mark style="background:#fef08a;border-radius:2px;padding:0 1px">$1</mark>');
}

function renderizarDestaques() {
  const prop  = app.proposicaoAtiva;
  const lista = document.getElementById('lista-destaques');

  if (!prop) {
    lista.innerHTML = `<div class="empty-state"><p>Selecione uma proposição</p></div>`;
    return;
  }

  const todos  = Array.isArray(prop.destaques) ? prop.destaques : [];
  const ativos = todos.filter(d => d.ativo);
  const exibir = app.filtroAtual === 'ativos' ? ativos : todos;

  document.getElementById('badge-ativos').textContent = ativos.length;
  document.getElementById('badge-todos').textContent  = todos.length;

  const ua = document.getElementById('ultima-atualizacao');
  ua.textContent = prop.ultimaSync
    ? `Atualizado: ${new Date(prop.ultimaSync).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}`
    : '';

  if (!exibir.length) {
    lista.innerHTML = prop.ultimaSync
      ? `<div class="empty-state"><p>Nenhum destaque ${app.filtroAtual === 'ativos' ? 'ativo' : ''} para esta proposição.</p></div>`
      : `<div class="empty-state"><p>Clique em "Atualizar Destaques" para buscar os dados.</p></div>`;
    return;
  }

  lista.innerHTML = exibir.map((d, i) => {
    const statusClass = SITUACAO_CLASSES[d.situacao.toLowerCase()] || 'status-outro';
    const ativoClass  = d.ativo ? '' : 'inativo';
    const statusLabel = d.ativo ? 'Ativo' : d.situacao;

    return `
    <div class="destaque-card ${ativoClass}" data-index="${i}">
      <div class="destaque-card-header">
        <span class="destaque-numero">${d.numero}</span>
        <span class="destaque-partido">${d.autoria}</span>
        <span class="destaque-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="destaque-card-body">
        <div class="destaque-descricao">${d.descricao || '–'}</div>
        ${d.tipo ? `<div class="destaque-tipo">Tipo: ${d.tipo}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function abrirDestaque(index) {
  const todosRaw = Array.isArray(app.proposicaoAtiva.destaques) ? app.proposicaoAtiva.destaques : [];
  const todos = app.filtroAtual === 'ativos'
    ? todosRaw.filter(d => d.ativo)
    : todosRaw;

  const d = todos[index];
  if (!d) return;

  app.destinqueAtivo = d;
  const body = document.getElementById('modal-destaque-body');
  body.innerHTML = renderizarCardCompleto(d, app.proposicaoAtiva);
  document.getElementById('modal-destaque').style.display = 'flex';

  // Adiciona listeners de auto-save nos campos editáveis
  let saveTimer = null;
  const badge = document.getElementById('badge-salvo');

  function agendarSalvamento() {
    clearTimeout(saveTimer);
    badge.classList.remove('visivel');
    saveTimer = setTimeout(async () => {
      d.votoSim    = document.getElementById('campo-voto-sim').value;
      d.votoNao    = document.getElementById('campo-voto-nao').value;
      d.explicacao = document.getElementById('campo-explicacao').value;
      d.orientacao = document.getElementById('campo-orientacao').value;
      await salvarSessao(app.sessaoAtual);
      badge.classList.add('visivel');
      setTimeout(() => badge.classList.remove('visivel'), 2000);
    }, 800);
  }

  ['campo-voto-sim', 'campo-voto-nao', 'campo-explicacao', 'campo-orientacao']
    .forEach(id => document.getElementById(id)?.addEventListener('input', agendarSalvamento));
}

function renderizarCardCompleto(d, prop) {
  const votoSim    = esc(d.votoSim    || '');
  const votoNao    = esc(d.votoNao    || '');
  const explicacao = esc(d.explicacao || '');
  const orientacao = esc(d.orientacao || '');

  return `
  <div class="card-completo">
    <div class="card-completo-header">
      <div class="prop-titulo">${prop.chave} – ${prop.ementa || ''}</div>
      <div class="dest-subtitulo">${d.numero} – ${d.autoria}</div>
    </div>

    <div class="card-completo-descricao">
      ${d.descricao || '–'}
      ${d.tipo ? `<br><small style="color:var(--cinza-texto)">Tipo regimental: ${d.tipo}</small>` : ''}
    </div>

    ${prop.idCamara
      ? `<div class="destaque-camara-link">
           <a href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${prop.idCamara}"
              target="_blank" rel="noopener">Ver proposição na Câmara ↗</a>
         </div>`
      : ''}

    <div class="ia-toolbar">
      <button id="btn-salvar-destaque" class="btn btn-outline btn-sm">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Salvar
      </button>
      ${app.config.geminiKey
        ? `<button id="btn-gerar-ia" class="btn btn-ia btn-sm">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18a1 1 0 0 0-2 0v1.93A8 8 0 0 1 4.07 13H6a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V6a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H18a1 1 0 0 0 0 2h1.93A8 8 0 0 1 13 19.93z"/></svg>
             Gerar Análise
           </button>`
        : `<span class="ia-sem-chave">Configure a chave Gemini em ⚙ Configurações</span>`
      }
    </div>

    ${app.config.geminiKey ? `
    <div class="ia-manual-toggle">
      <button id="btn-toggle-manual" class="btn-link-discreto">
        ✏️ Inserir texto ou PDF manualmente
      </button>
    </div>
    <div id="ia-manual-area" style="display:none" class="ia-manual-area">
      <p class="ia-manual-hint">
        O conteúdo fornecido aqui tem <strong>prioridade</strong> sobre a busca automática.
        Cole o texto do dispositivo ou anexe o PDF do substitutivo.
      </p>
      <div class="ia-manual-inputs">
        <label class="ia-manual-label">
          <span>📄 Anexar PDF</span>
          <input type="file" id="ia-manual-pdf" accept=".pdf" class="ia-manual-file">
        </label>
        <label class="ia-manual-label" style="margin-top:8px">
          <span>📝 Ou colar texto</span>
          <textarea id="ia-manual-texto"
            class="campo-editavel ia-manual-textarea"
            placeholder="Cole aqui o texto do artigo, capítulo ou dispositivo a ser analisado..."></textarea>
        </label>
        <button id="btn-limpar-manual" class="btn-link-discreto" style="margin-top:4px;font-size:11px">
          🗑 Limpar entrada manual
        </button>
      </div>
    </div>
    ` : ''}


    <div class="votos-grid">
      <div class="voto-sim">
        <div class="voto-label">Voto SIM</div>
        <textarea id="campo-voto-sim" class="campo-editavel"
          placeholder="Descreva o efeito do voto SIM...">${votoSim}</textarea>
      </div>
      <div class="voto-nao">
        <div class="voto-label">Voto NÃO</div>
        <textarea id="campo-voto-nao" class="campo-editavel"
          placeholder="Descreva o efeito do voto NÃO...">${votoNao}</textarea>
      </div>
    </div>

    <div class="explicacao-section">
      <div class="explicacao-label">Explicação</div>
      <textarea id="campo-explicacao" class="campo-editavel"
        style="min-height:90px; background:var(--cinza-bg);"
        placeholder="Clique em 'Gerar Análise' ou escreva manualmente...">${explicacao}</textarea>
    </div>

    <div class="orientacao-section">
      <span class="orientacao-label">Orientação:</span>
      <input id="campo-orientacao" class="orientacao-input" type="text"
        placeholder="Ex: FAVORÁVEL, CONTRÁRIO, LIBERADO..."
        value="${orientacao}">
      <span class="salvo-badge" id="badge-salvo">✓ Salvo</span>
    </div>
  </div>`;
}

// Escapa HTML para usar em templates
function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
//  CONFIGURAÇÕES E INTEGRAÇÃO GEMINI AI
// ============================================================

async function carregarConfiguracao() {
  return new Promise(resolve => {
    chrome.storage.local.get('config', data => {
      if (data.config) Object.assign(app.config, data.config);
      resolve();
    });
  });
}

async function salvarConfiguracao() {
  const key        = document.getElementById('config-gemini-key').value.trim();
  const modelo     = document.getElementById('config-modelo').value;
  const profund    = document.getElementById('config-profundidade').value;
  const status     = document.getElementById('config-status-ia');

  if (key && !key.startsWith('AIza')) {
    status.textContent  = '⚠ A chave deve começar com "AIza". Verifique se copiou corretamente.';
    status.className    = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  app.config.geminiKey    = key;
  app.config.modelo       = modelo;
  app.config.profundidade = profund;

  await new Promise(r => chrome.storage.local.set({ config: app.config }, r));

  fecharModal('modal-configuracoes');
  mostrarToast('Configurações salvas com sucesso!', 'sucesso');
}

async function abrirConfiguracoes() {
  document.getElementById('config-gemini-key').value   = app.config.geminiKey   || '';
  document.getElementById('config-profundidade').value = app.config.profundidade || 'resumo';
  document.getElementById('config-status-ia').style.display   = 'none';
  document.getElementById('modelos-status').style.display      = 'none';
  document.getElementById('modal-configuracoes').style.display = 'flex';

  // Se já tem chave salva, carrega a lista de modelos automaticamente
  if (app.config.geminiKey) {
    await carregarModelosDisponiveis();
  }
}

async function carregarModelosDisponiveis() {
  const key    = document.getElementById('config-gemini-key').value.trim() || app.config.geminiKey;
  const select = document.getElementById('config-modelo');
  const status = document.getElementById('modelos-status');
  const btn    = document.getElementById('btn-carregar-modelos');

  if (!key) {
    status.textContent   = 'Cole sua chave de API primeiro.';
    status.style.display = 'block';
    return;
  }

  btn.textContent      = '⏳ Carregando...';
  btn.disabled         = true;
  status.style.display = 'none';

  try {
    const res  = await fetch(`${GEMINI_BASE}?key=${key}&pageSize=50`);
    const json = await res.json();

    if (!res.ok) throw new Error(json.error?.message || `Erro ${res.status}`);

    // Filtra apenas modelos que suportam generateContent e são da família Gemini
    const modelos = (json.models || [])
      .filter(m =>
        (m.supportedGenerationMethods || []).includes('generateContent') &&
        m.name.includes('gemini')
      )
      .sort((a, b) => b.name.localeCompare(a.name)); // mais recentes primeiro

    if (!modelos.length) throw new Error('Nenhum modelo compatível encontrado.');

    // Popular o select com os modelos reais
    const modeloSalvo = app.config.modelo;
    select.innerHTML = modelos.map(m => {
      const id       = m.name.replace('models/', '');
      const display  = m.displayName || id;
      const selected = id === modeloSalvo ? 'selected' : '';
      return `<option value="${id}" ${selected}>${display}</option>`;
    }).join('');

    // Se o modelo salvo não está mais disponível, seleciona o primeiro
    if (!select.value) select.selectedIndex = 0;

    status.textContent   = `✓ ${modelos.length} modelos carregados. Selecione o desejado.`;
    status.style.color   = 'var(--verde-dark)';
    status.style.display = 'block';

  } catch (err) {
    status.textContent   = `✗ ${err.message}`;
    status.style.color   = 'var(--vermelho)';
    status.style.display = 'block';
  } finally {
    btn.textContent  = '↻ Carregar disponíveis';
    btn.disabled     = false;
  }
}

async function testarConexaoIA() {
  const key    = document.getElementById('config-gemini-key').value.trim();
  const modelo = document.getElementById('config-modelo').value;
  const status = document.getElementById('config-status-ia');

  if (!key) {
    status.textContent   = 'Cole sua chave de API antes de testar.';
    status.className     = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  status.textContent   = '⏳ Testando conexão com o Gemini...';
  status.className     = 'config-status teste';
  status.style.display = 'block';

  try {
    const url  = `${GEMINI_BASE}/${modelo}:generateContent?key=${key}`;
    const body = {
      contents: [{
        parts: [{ text: 'Responda apenas: OK' }]
      }]
    };
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json();

    if (!res.ok) {
      const msg = json.error?.message || `Erro HTTP ${res.status}`;
      throw new Error(msg);
    }

    status.textContent  = '✓ Conexão bem-sucedida! A IA está pronta para uso.';
    status.className    = 'config-status ok';
  } catch (err) {
    status.textContent  = `✗ Erro: ${err.message}`;
    status.className    = 'config-status erro';
  }
}

// ---------- BUSCA TEXTO DA EMENDA ----------
const CODETABS_PANEL = 'https://api.codetabs.com/v1/proxy?quest=';

/** Faz fetch e retorna o objeto Response (tenta direto, depois codetabs apenas para HTML) */
async function fetchCamaraResponse(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (r.ok) return r;
  } catch (_) {}
  // codetabs só funciona bem para HTML; não usar para PDF
  const ct = url.toLowerCase();
  if (!ct.includes('.pdf') && !ct.includes('pdf')) {
    try {
      const r = await fetch(CODETABS_PANEL + encodeURIComponent(url));
      if (r.ok) return r;
    } catch (_) {}
  }
  return null;
}

/** Faz fetch e retorna texto (HTML) com fallback codetabs */
async function fetchCamara(url) {
  const r = await fetchCamaraResponse(url);
  if (!r) return null;
  try { return await r.text(); } catch (_) { return null; }
}

/** Remove lixo de PDFs: watermarks impressas lateralmente, caracteres isolados, etc. */
function limparTextoPDF(texto) {
  return texto
    // Remove linhas com apenas 1-2 chars (watermarks giradas viram letras soltas)
    .split('\n')
    .filter(linha => {
      const l = linha.trim();
      // Mantém linhas com 3+ chars OU linhas vazias que separam parágrafos
      return l.length === 0 || l.length >= 3;
    })
    // Remove blocos de letras/números separados por espaço (ex: "N E L P - 0 1 4 8 0")
    .join('\n')
    .replace(/\b([A-Z0-9] ){4,}/g, '')
    // Remove URLs de autenticação
    .replace(/https?:\/\/infoleg-autenticidade[^\s]*/g, '')
    .replace(/Assinado eletronicamente[^\n]*/g, '')
    .replace(/Para verificar as assinaturas[^\n]*/g, '')
    // Comprime espaços múltiplos
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extrai texto limpo de uma URL — suporta HTML e PDF (via pdfjsLib).
 *  @param {string} url
 *  @param {Response|null} preResponse  Response já obtida (evita segundo fetch) */
async function fetchTextoIntegra(url, preResponse = null) {
  const r = preResponse !== null ? preResponse : await fetchCamaraResponse(url);
  if (!r) return null;

  const ct = r.headers.get('content-type') || '';
  const isPDF = ct.includes('pdf') || /\.pdf(\?|$)/i.test(url);
  console.log('[IA] fetchTextoIntegra url:', url, '| content-type:', ct, '| isPDF:', isPDF);

  // ── PDF: usa pdfjsLib (já carregado pela extensão) ──────────────────
  if (isPDF) {
    if (typeof pdfjsLib === 'undefined') {
      console.warn('[IA] pdfjsLib não disponível');
      return null;
    }
    try {
      const buffer = await r.arrayBuffer();
      console.log('[IA] PDF buffer size:', buffer.byteLength, 'bytes');
      const pdf    = await pdfjsLib.getDocument({
        data: buffer,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/',
      }).promise;
      console.log('[IA] PDF páginas:', pdf.numPages);
      let linhas   = [];
      let totalItens = 0;
      const paginas = Math.min(pdf.numPages, 30);
      for (let i = 1; i <= paginas; i++) {
        try {
          const page    = await pdf.getPage(i);
          const content = await page.getTextContent();
          totalItens += content.items.length;
          // Log diagnóstico da pág 1: distingue CMap (itens com str vazio) vs imagem (0 itens)
          if (i === 1) {
            console.log('[IA] pág 1 — itens:', content.items.length,
              '| amostra:', JSON.stringify(content.items.slice(0, 3).map(it => ({ str: it.str, w: it.width }))));
          }
          // Agrupa itens por linha usando a coordenada Y
          let ultimoY = null;
          let linhaAtual = [];
          for (const item of content.items) {
            const y = Math.round(item.transform?.[5] || 0);
            if (ultimoY !== null && Math.abs(y - ultimoY) > 3) {
              linhas.push(linhaAtual.join(''));
              linhaAtual = [];
            }
            linhaAtual.push(item.str);
            ultimoY = y;
          }
          if (linhaAtual.length) linhas.push(linhaAtual.join(''));
        } catch (pageErr) {
          console.warn('[IA] erro na página', i, ':', pageErr.message);
        }
      }
      console.log('[IA] total itens em', paginas, 'páginas:', totalItens);
      const bruto = linhas.join('\n');
      console.log('[IA] PDF bruto length:', bruto.length);
      const limpo = limparTextoPDF(bruto);
      console.log('[IA] PDF limpo length:', limpo.length);
      return limpo.length > 50 ? limpo.slice(0, 8000) : null;
    } catch (e) {
      console.error('[IA] pdfjsLib ERRO:', e.message, e);
      return null;
    }
  }

  // ── HTML / texto ─────────────────────────────────────────────────────
  try {
    const html = await r.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,header,footer,nav,aside,form,.header,.footer').forEach(el => el.remove());
    const texto = (doc.body?.textContent || '').replace(/\s{2,}/g, ' ').trim();
    return texto.length > 100 ? texto.slice(0, 7000) : null;
  } catch (_) { return null; }
}

/** Resolve href relativo para URL absoluta da Câmara */
function resolverUrlCamara(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return 'https://www.camara.leg.br' + href;
  return 'https://www.camara.leg.br/proposicoesWeb/' + href;
}

async function buscarTextoEmenda(d, prop) {
  if (!prop.idCamara) return null;
  try {
    // Concatena descricao + tipo + tituloLink: o detalhamento do destaque
    // (ex: "do inciso II do art. 19 do PL...") pode estar em qualquer um deles.
    // O título do link (texto da âncora ou filename= da URL) costuma ter o nome
    // completo, inclusive quando descricao/tipo são curtos.
    const descricao = `${d.descricao || ''} ${d.tipo || ''} ${d.tituloLink || ''}`.trim();
    console.log('[IA] texto combinado p/ classificação:', descricao);

    // ── Classificação do tipo de destaque ────────────────────────────
    // Extrai número de emenda (máx 3 dígitos para evitar anos/números de PL)
    const numEmendaMatch =
      descricao.match(/(?:emenda)\s*[nº°\.]?\s*(\d{1,3})\b(?!\s*\/\s*\d{4})/i) ||
      descricao.match(/\bemp\s*[nº°\.]?\s*(\d{1,3})\b/i) ||
      descricao.match(/\bn[º°\.\s]+(\d{1,3})\b/i);
    const numEmenda = numEmendaMatch ? parseInt(numEmendaMatch[1]) : null;

    // ── Extração de referências legislativas ─────────────────────────

    // Padrão "constante no Art. X do substitutivo/emenda" → artigo DENTRO do documento
    // Ex: "artigo 92, constante no artigo 2° do substitutivo adotado pela CCJC"
    const constanteMatch = descricao.match(
      /constante\s+(?:n[ao]\s+)?art(?:igo)?\s*(\d+\s*[°º]?)/i
    );
    const artNoDoc = constanteMatch ? constanteMatch[1].trim().replace(/[°º]/, '°') : null;

    // Artigo da lei original sendo alterada (primeiro mencionado na descrição)
    const artMatch  = descricao.match(/art(?:igo)?\.?\s*(\d+\s*[°º]?)/i);
    const numArtigo = artMatch ? parseInt(artMatch[1]) : null;

    // Inciso referenciado (romano)
    const incisoMatch = descricao.match(/inciso\s+([IVXLCDM]+)/i);
    const numInciso   = incisoMatch ? incisoMatch[1].toUpperCase() : null;

    // Parágrafo referenciado
    const parMatch = descricao.match(/[§]\s*(\d+)[°º]?|par[áa]grafo\s+(\d+)/i);
    const numPar   = parMatch ? (parMatch[1] || parMatch[2]) : null;

    // Capítulo referenciado (romano ou árabe)
    const capMatch    = descricao.match(/cap[íi]tulo\s+([IVXLCDM]+|\d+)/i);
    const numCapitulo = capMatch ? capMatch[1].toUpperCase() : null;

    // Título/seção referenciado
    const tituloMatch = descricao.match(/t[íi]tulo\s+([IVXLCDM]+|\d+)/i);
    const numTitulo   = tituloMatch ? tituloMatch[1].toUpperCase() : null;

    // ── Monta referenciaLeg ───────────────────────────────────────────
    // Quando há "constante no Art. X": Art. X é onde buscar no documento;
    // numArtigo + inciso descrevem o que está sendo votado (para contexto da IA).
    let referenciaLeg;
    if (artNoDoc) {
      // Ex: "Artigo 2° do substitutivo (trata do Artigo 92, Inciso IV)"
      const alvo    = numArtigo  ? `Artigo ${numArtigo}${numInciso ? `, Inciso ${numInciso}` : ''}` : null;
      const sufPar  = numPar ? ` e § ${numPar}°` : '';
      referenciaLeg = `Artigo ${artNoDoc} do substitutivo`
                    + (alvo ? ` — que altera o ${alvo}${sufPar} da lei original` : '');
    } else {
      const sufixoArt = numInciso ? `, Inciso ${numInciso}`
                      : numPar    ? `, § ${numPar}°`
                      : '';
      referenciaLeg = numArtigo  ? `Artigo ${numArtigo}${sufixoArt}`
                    : numCapitulo ? `Capítulo ${numCapitulo}`
                    : numTitulo   ? `Título ${numTitulo}`
                    : null;
    }

    // ── Classificação do tipo de DVS ──────────────────────────────────
    // Substitutivo adotado por comissão: "substitutivo adotado pela CCJC/CFT/..."
    const isSubstColegiado = /substitutivo\s+adotado|emenda\s+adotada/i.test(descricao);

    // SSP de plenário: subemenda substitutiva (não é de comissão)
    const isDVSSubstitutivo = /subst|submenda|subemenda/i.test(descricao) && !isSubstColegiado;

    // Emenda específica numerada
    const isEmendaEspecifica = /\bemenda\b/i.test(descricao) && !isDVSSubstitutivo && !isSubstColegiado;

    // DVS/DTQ de dispositivo do PL original (não classificado nos casos acima)
    // Ex: "Destaque para Votação em Separado do inciso II do art. 19 do PL 3278/2021, com fins de supressão"
    const isDVSPLOriginal = !!referenciaLeg
      && !isSubstColegiado
      && !isDVSSubstitutivo
      && !isEmendaEspecifica
      && /destaque|dvs|dtq|separado|supress|suprim/i.test(descricao);

    console.log('[IA] tipo: colegiado=', isSubstColegiado, '| SSP=', isDVSSubstitutivo,
                '| emenda=', isEmendaEspecifica, '| pl_orig=', isDVSPLOriginal, '| ref=', referenciaLeg);

    // ── CASO 0: Substitutivo/Emenda adotado por comissão ─────────────
    // Fluxo: prop_pareceres_substitutivos_votos → fichadetramitacao (adotado) → prop_mostrarintegra
    if (isSubstColegiado) {
      // Extrai o nome/sigla do colegiado da descrição — ex: "adotado pela CCJC" → "CCJC"
      const colegiaoMatch = descricao.match(
        /(?:adotado|adotada)\s+pela?\s+([A-ZÁÉÍÓÚÀÃÕ]{2,10}(?:\s+[A-ZÁÉÍÓÚÀÃÕ]{2,})*)/i
      );
      const nomeColegiado = colegiaoMatch
        ? colegiaoMatch[1].trim().toUpperCase().split(/\s+/)[0] // pega só a sigla (1ª palavra)
        : null;

      console.log('[IA] Caso 0: colegiado detectado =', nomeColegiado || '(não identificado)');

      const urlPar  = `https://www.camara.leg.br/proposicoesWeb/prop_pareceres_substitutivos_votos?idProposicao=${prop.idCamara}`;
      const htmlPar = await fetchCamara(urlPar);
      console.log('[IA] prop_pareceres fetch:', htmlPar ? htmlPar.length + ' chars' : 'falhou');

      /** Dado um doc HTML, devolve o primeiro link prop_mostrarintegra/codteor encontrado */
      function extrairLinkInteiro(docHtml) {
        const a = docHtml.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
        return a ? resolverUrlCamara(a.getAttribute('href')) : null;
      }

      /**
       * Percorre o doc buscando o elemento "adotado".
       * Se nomeColegiado informado: tenta primeiro filtrar pela sigla; se não achar, cai no geral.
       * Retorna { direto, fichaUrl } ou null.
       */
      function encontrarAdotado(docHtml, sigla) {
        const seletores = ['tr', 'li', 'div', 'p'];
        const padrao    = /adotado\s+pelo\s+colegiado|adotada\s+pelo\s+colegiado|adotado|adotada/i;

        function extrairDeEl(el) {
          const direto = el.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
          if (direto) return { direto: resolverUrlCamara(direto.getAttribute('href')), fichaUrl: null };
          const ficha = el.querySelector('a[href*="fichadetramitacao"]');
          if (ficha) return { fichaUrl: resolverUrlCamara(ficha.getAttribute('href')), direto: null };
          return null;
        }

        // Passagem 1: com filtro de sigla do colegiado (se disponível)
        if (sigla) {
          for (const sel of seletores) {
            for (const el of docHtml.querySelectorAll(sel)) {
              const txt = el.textContent;
              if (!padrao.test(txt)) continue;
              if (!txt.toUpperCase().includes(sigla)) continue;
              const r = extrairDeEl(el);
              if (r) {
                console.log('[IA] adotado filtrado por colegiado', sigla, ':', r);
                return r;
              }
            }
          }
          console.log('[IA] colegiado', sigla, 'não encontrado — ampliando busca');
        }

        // Passagem 2: qualquer elemento marcado como "adotado" (sem filtro de sigla)
        for (const sel of seletores) {
          for (const el of docHtml.querySelectorAll(sel)) {
            if (!padrao.test(el.textContent)) continue;
            const r = extrairDeEl(el);
            if (r) {
              console.log('[IA] adotado sem filtro de colegiado:', r);
              return r;
            }
          }
        }
        return null;
      }

      let linkAdotado = null;

      if (htmlPar) {
        const docPar = new DOMParser().parseFromString(htmlPar, 'text/html');
        const achado = encontrarAdotado(docPar, nomeColegiado);

        console.log('[IA] resultado encontrarAdotado:', achado);

        if (achado?.direto) {
          linkAdotado = achado.direto;

        } else if (achado?.fichaUrl) {
          // Passo 2: segue fichadetramitacao para achar o inteiro teor
          console.log('[IA] seguindo fichadetramitacao:', achado.fichaUrl);
          const htmlFicha = await fetchCamara(achado.fichaUrl);
          console.log('[IA] ficha fetch:', htmlFicha ? htmlFicha.length + ' chars' : 'falhou');
          if (htmlFicha) {
            const docFicha = new DOMParser().parseFromString(htmlFicha, 'text/html');
            linkAdotado = extrairLinkInteiro(docFicha);
            console.log('[IA] inteiro teor na ficha:', linkAdotado);
          }
        }
      }

      if (linkAdotado) {
        console.log('[IA] buscando documento adotado:', linkAdotado);
        const rAdot = await fetchCamaraResponse(linkAdotado);
        if (rAdot) {
          const textoAdot = await fetchTextoIntegra(linkAdotado, rAdot.clone());
          if (textoAdot) {
            console.log('[IA] substitutivo adotado: texto extraído,', textoAdot.length, 'chars');
            return { textoCompleto: textoAdot, tipo: 'substitutivo', numArtigo, referenciaLeg };
          }
          // PDF sem texto → envia buffer ao Gemini
          try {
            const pdfBuffer = await rAdot.arrayBuffer();
            if (pdfBuffer.byteLength > 0) {
              console.log('[IA] buffer adotado:', (pdfBuffer.byteLength / 1024).toFixed(0), 'KB');
              return { pdfBuffer, tipo: 'substitutivo_pdf', numArtigo, referenciaLeg };
            }
          } catch (e) { console.warn('[IA] erro buffer adotado:', e); }
        }
      }

      console.warn('[IA] Caso 0 falhou — documento adotado não encontrado.');
      return null; // não cai em casos de emenda: seria documento errado
    }

    // ── CASO 1: DVS no substitutivo ──────────────────────────────────────
    if (isDVSSubstitutivo) {
      const isRelator = /relator/i.test(descricao);

      // ── CASO 1a: substitutivo do relator → pareceres page diretamente ──
      if (isRelator) {
        console.log('[IA] Caso 1a: substitutivo do relator — buscando em pareceres');
        const urlPar1a = `https://www.camara.leg.br/proposicoesWeb/prop_pareceres_substitutivos_votos?idProposicao=${prop.idCamara}`;
        const htmlPar1a = await fetchCamara(urlPar1a);
        if (htmlPar1a) {
          const docPar1a = new DOMParser().parseFromString(htmlPar1a, 'text/html');
          let link1a = null;

          // 1ª tentativa: link cujo filename começa com "SBT" (padrão Câmara para substitutivos)
          for (const a of docPar1a.querySelectorAll('a[href*="prop_mostrarintegra"], a[href*="codteor"]')) {
            const href = a.getAttribute('href') || '';
            if (/filename[=+%]*SBT/i.test(href)) {
              link1a = resolverUrlCamara(href);
              break;
            }
          }

          // 2ª tentativa: linha que contém "substitut" mas NÃO só "parecer" — evita Parecer do Relator
          if (!link1a) {
            for (const row of docPar1a.querySelectorAll('tr, li, p')) {
              const txt = row.textContent;
              if (/substitut/i.test(txt) && !/^\s*parecer\s*$/i.test(txt)) {
                const a = row.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
                if (a) { link1a = resolverUrlCamara(a.getAttribute('href')); break; }
              }
            }
          }

          // 3ª tentativa: qualquer linha com "relator" + link (última opção)
          if (!link1a) {
            for (const row of docPar1a.querySelectorAll('tr, li, p')) {
              if (/relator/i.test(row.textContent)) {
                const a = row.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
                if (a) { link1a = resolverUrlCamara(a.getAttribute('href')); break; }
              }
            }
          }

          console.log('[IA] Caso 1a link:', link1a);
          if (link1a) {
            const r1a = await fetchCamaraResponse(link1a);
            if (r1a) {
              const texto1a = await fetchTextoIntegra(link1a, r1a.clone());
              if (texto1a) {
                console.log('[IA] Caso 1a: texto extraído,', texto1a.length, 'chars');
                return { textoCompleto: texto1a, tipo: 'substitutivo', numArtigo, referenciaLeg };
              }
              try {
                const pdfBuffer = await r1a.arrayBuffer();
                if (pdfBuffer.byteLength > 0) {
                  console.log('[IA] Caso 1a: buffer', (pdfBuffer.byteLength / 1024).toFixed(0), 'KB');
                  return { pdfBuffer, tipo: 'substitutivo_pdf', numArtigo, referenciaLeg };
                }
              } catch (e) { console.warn('[IA] erro buffer Caso 1a:', e); }
            }
          }
        }
        console.warn('[IA] Caso 1a falhou — substitutivo do relator não encontrado.');
        return null;
      }

      // ── CASO 1b: SSP → busca na página de emendas ────────────────────
      console.log('[IA] Caso 1b: DVS SSP — buscando SSP na página de emendas');

      const urlPag = `https://www.camara.leg.br/proposicoesWeb/prop_emendas?idProposicao=${prop.idCamara}&subst=0`;
      const htmlPag = await fetchCamara(urlPag);
      console.log('[IA] prop_emendas fetch:', htmlPag ? htmlPag.length + ' chars' : 'falhou');

      if (htmlPag) {
        const docPag  = new DOMParser().parseFromString(htmlPag, 'text/html');
        const linkEls = Array.from(
          docPag.querySelectorAll('a[href*="prop_mostrarintegra"], a[href*="codteor"]')
        );
        const todosLinks = linkEls.map(a => ({
          href: resolverUrlCamara(a.getAttribute('href')),
          text: a.textContent.trim(),
        })).filter(l => l.href);

        console.log('[IA] todos os links:', todosLinks);

        // 1ª tentativa: link cujo href contém "SSP" no filename
        let linkSSP = todosLinks.find(l => /[=+]SSP[+%]/i.test(l.href))?.href;

        // 2ª tentativa: procurar "substitut" no texto de cada linha da tabela
        if (!linkSSP) {
          for (const row of docPag.querySelectorAll('tr')) {
            const rt = row.textContent;
            console.log('[IA] row texto (100):', rt.slice(0, 100).replace(/\s+/g,' '));
            if (/substitut/i.test(rt)) {
              const el = row.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
              if (el) { linkSSP = resolverUrlCamara(el.getAttribute('href')); break; }
            }
          }
        }

        // 3ª tentativa: último link da página (SSP costuma ser o último)
        if (!linkSSP && todosLinks.length > 0) {
          linkSSP = todosLinks[todosLinks.length - 1].href;
          console.log('[IA] usando último link como SSP:', linkSSP);
        }

        if (linkSSP) {
          console.log('[IA] buscando SSP:', linkSSP);
          const rSSP = await fetchCamaraResponse(linkSSP);

          if (rSSP) {
            const textoPDF = await fetchTextoIntegra(linkSSP, rSSP.clone());

            if (textoPDF) {
              console.log('[IA] SSP texto extraído:', textoPDF.length, 'chars. Primeiros 400:', textoPDF.slice(0, 400));
              return { textoCompleto: textoPDF, tipo: 'substitutivo', numArtigo, referenciaLeg };
            }

            console.log('[IA] PDF sem texto → preparando buffer para Gemini inline_data');
            try {
              const pdfBuffer = await rSSP.arrayBuffer();
              if (pdfBuffer.byteLength > 0) {
                console.log('[IA] buffer pronto:', (pdfBuffer.byteLength / 1024).toFixed(0), 'KB');
                return { pdfBuffer, tipo: 'substitutivo_pdf', numArtigo, referenciaLeg };
              }
            } catch (e) {
              console.warn('[IA] erro ao ler buffer SSP:', e);
            }
          }

          console.warn('[IA] SSP: fetch falhou completamente.');
        }
      }
    }

    // ── CASO 3: DVS/DTQ de dispositivo do PL original ────────────────
    // Ex: "Destaque para Votação em Separado do inciso II do art. 19 do PL 3278/2021"
    // Estratégia: 1º tenta o PDF do próprio destaque (d.urlLink), que contém a
    // transcrição literal do dispositivo + justificativa. Se falhar, fallback
    // para o inteiro teor da proposição (urlInteiroTeor).
    if (isDVSPLOriginal) {
      console.log('[IA] Caso 3: DVS de dispositivo do PL original');

      // Tentativa 1: PDF do próprio destaque (mais preciso)
      if (d.urlLink) {
        console.log('[IA] Caso 3 tent. 1 — PDF do destaque:', d.urlLink);
        try {
          const textoCompleto = await fetchTextoIntegra(d.urlLink);
          console.log('[IA] PDF destaque extraído:',
            textoCompleto ? `${textoCompleto.length} chars` : 'falhou');
          if (textoCompleto && textoCompleto.length > 100) {
            return {
              textoCompleto,
              tipo: 'pl_original',
              numArtigo, numInciso, numPar, referenciaLeg,
            };
          }
        } catch (e) {
          console.warn('[IA] Caso 3 tent. 1 (PDF destaque) falhou:', e);
        }
      }

      // Tentativa 2: inteiro teor da proposição via API
      console.log('[IA] Caso 3 tent. 2 — urlInteiroTeor via API');
      try {
        const respApi = await fetch(`${API_BASE}/proposicoes/${prop.idCamara}`);
        if (respApi.ok) {
          const json = await respApi.json();
          const urlInteiroTeor = json?.dados?.urlInteiroTeor;
          console.log('[IA] urlInteiroTeor:', urlInteiroTeor);
          if (urlInteiroTeor) {
            const textoCompleto = await fetchTextoIntegra(urlInteiroTeor);
            console.log('[IA] inteiro teor extraído:',
              textoCompleto ? `${textoCompleto.length} chars` : 'falhou');
            if (textoCompleto) {
              return {
                textoCompleto,
                tipo: 'pl_original',
                numArtigo, numInciso, numPar, referenciaLeg,
              };
            }
          }
        }
      } catch (e) {
        console.warn('[IA] Caso 3 tent. 2 falhou:', e);
      }

      console.warn('[IA] Caso 3 falhou — texto não encontrado.');
      return null;
    }

    // ── CASO 2: Destaque de emenda específica → busca na página de emendas ──
    async function buscarNaPaginaEmendas(subst) {
      const url = `https://www.camara.leg.br/proposicoesWeb/prop_emendas?idProposicao=${prop.idCamara}&subst=${subst}`;
      const html = await fetchCamara(url);
      console.log('[IA] prop_emendas subst=' + subst + ':', html ? `${html.length} chars` : 'falhou');
      if (!html) return null;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const linkEls = Array.from(doc.querySelectorAll('a[href*="prop_mostrarintegra"], a[href*="codteor"]'));
      const links = linkEls.map(a => resolverUrlCamara(a.getAttribute('href'))).filter(Boolean);
      console.log('[IA] links subst=' + subst + ':', links.length, links);
      if (!links.length) return null;

      let alvo = null;
      if (numEmenda) {
        for (const row of doc.querySelectorAll('tr')) {
          if (new RegExp(`\\b0*${numEmenda}\\b(?![\\d/])`).test(row.textContent)) {
            const el = row.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
            if (el) { alvo = resolverUrlCamara(el.getAttribute('href')); break; }
          }
        }
        if (!alvo && links[numEmenda - 1]) alvo = links[numEmenda - 1];
      }
      if (!alvo && links.length === 1) alvo = links[0];
      if (!alvo) alvo = links[0];
      return alvo;
    }

    if (isEmendaEspecifica || !isDVSSubstitutivo) {
      const isSubemenda = /sub\s*emenda|subemenda/i.test(descricao);
      const ordemSubst  = isSubemenda ? [1, 0] : [0, 1];
      let linkAlvo = null;
      for (const subst of ordemSubst) {
        linkAlvo = await buscarNaPaginaEmendas(subst);
        if (linkAlvo) break;
      }

      if (linkAlvo) {
        console.log('[IA] buscando texto da emenda em:', linkAlvo);
        const textoCompleto = await fetchTextoIntegra(linkAlvo);
        console.log('[IA] texto extraído:', textoCompleto ? `${textoCompleto.length} chars` : 'falhou');
        if (textoCompleto) {
          console.log('[IA] primeiros 500 chars:', textoCompleto.slice(0, 500));
          return { textoCompleto, tipo: 'emenda' };
        }
      }
    }

    console.warn('[IA] nenhum texto encontrado para a emenda.');
    return null;
  } catch (e) {
    console.warn('Erro ao buscar texto da emenda:', e);
    return null;
  }
}

// ── Entrada manual de texto/PDF para análise IA ──────────────────────

function toggleManualIA() {
  const area = document.getElementById('ia-manual-area');
  const btn  = document.getElementById('btn-toggle-manual');
  if (!area) return;
  const visivel = area.style.display !== 'none';
  area.style.display = visivel ? 'none' : 'block';
  if (btn) btn.textContent = visivel
    ? '✏️ Inserir texto ou PDF manualmente'
    : '✏️ Ocultar entrada manual';
}

function limparManualIA() {
  const txt = document.getElementById('ia-manual-texto');
  const pdf = document.getElementById('ia-manual-pdf');
  if (txt) txt.value = '';
  if (pdf) pdf.value = '';
  mostrarToast('Entrada manual limpa.', 'info');
}

/** Retorna a entrada manual do usuário como infoEmenda, ou null se vazia.
 *  Prioridade: PDF > texto colado */
async function lerEntradaManual() {
  const pdfInput  = document.getElementById('ia-manual-pdf');
  const textoInput = document.getElementById('ia-manual-texto');

  // PDF anexado tem prioridade máxima
  if (pdfInput?.files?.length > 0) {
    const file = pdfInput.files[0];
    console.log('[IA][manual] PDF selecionado:', file.name, file.size, 'bytes');
    try {
      const pdfBuffer = await file.arrayBuffer();
      return { pdfBuffer, tipo: 'substitutivo_pdf', numArtigo: null, referenciaLeg: null };
    } catch (e) {
      console.warn('[IA][manual] erro ao ler PDF:', e);
    }
  }

  // Texto colado
  const texto = textoInput?.value?.trim();
  if (texto) {
    console.log('[IA][manual] texto colado:', texto.length, 'chars');
    return { textoCompleto: texto, tipo: 'emenda', numArtigo: null, referenciaLeg: null };
  }

  return null; // nenhuma entrada manual
}

/** Converte ArrayBuffer em string Base64 (em chunks para evitar stack overflow em PDFs grandes) */
function arrayBufferToBase64(buffer) {
  const bytes     = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32 KB
  const parts     = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

async function gerarExplicacaoIA() {
  const d    = app.destinqueAtivo;
  const prop = app.proposicaoAtiva;
  if (!d || !prop) return;

  const key = app.config.geminiKey;
  if (!key) {
    mostrarToast('Configure a chave Gemini em ⚙ Configurações.', 'aviso');
    return;
  }

  const btn      = document.getElementById('btn-gerar-ia');
  const iconeIA  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18a1 1 0 0 0-2 0v1.93A8 8 0 0 1 4.07 13H6a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V6a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H18a1 1 0 0 0 0 2h1.93A8 8 0 0 1 13 19.93z"/></svg>`;

  if (btn) {
    btn.disabled  = true;
    btn.innerHTML = `<span class="loading-spinner"></span> Buscando texto da emenda...`;
  }

  try {
    // 1. Entrada manual tem prioridade absoluta
    const entradaManual = await lerEntradaManual();
    let infoEmenda;

    if (entradaManual) {
      infoEmenda = entradaManual;
      if (infoEmenda.pdfBuffer) {
        mostrarToast(`✓ PDF manual (${(infoEmenda.pdfBuffer.byteLength / 1024).toFixed(0)} KB) — enviando ao Gemini`, 'sucesso');
      } else {
        mostrarToast(`✓ Texto manual (${infoEmenda.textoCompleto.length} chars)`, 'sucesso');
      }
      console.log('[IA] usando entrada manual, tipo:', infoEmenda.pdfBuffer ? 'PDF' : 'texto');
    } else {
      // 2. Busca automática
      infoEmenda = await buscarTextoEmenda(d, prop);
      if (infoEmenda?.textoCompleto) {
        mostrarToast(`✓ Texto extraído (${infoEmenda.textoCompleto.length} chars, tipo: ${infoEmenda.tipo})`, 'sucesso');
        console.log('[IA] TEXTO ENVIADO À IA (primeiros 600):\n', infoEmenda.textoCompleto.slice(0, 600));
      } else if (infoEmenda?.pdfBuffer) {
        mostrarToast(`✓ PDF capturado (${(infoEmenda.pdfBuffer.byteLength / 1024).toFixed(0)} KB) — enviando ao Gemini`, 'sucesso');
        console.log('[IA] PDF inline_data pronto:', infoEmenda.pdfBuffer.byteLength, 'bytes | referência:', infoEmenda.referenciaLeg);
      } else {
        mostrarToast('⚠ Sem texto da emenda — IA usará conhecimento geral', 'aviso');
      }
    }

    if (btn) btn.innerHTML = `<span class="loading-spinner"></span> Gerando análise...`;

    const prompt = montarPrompt(d, prop, infoEmenda);
    const url    = `${GEMINI_BASE}/${app.config.modelo}:generateContent?key=${key}`;

    // Monta parts: PDF inline (substitutivo imagem) ou texto extraído/prompt puro
    let parts;
    if (infoEmenda?.pdfBuffer) {
      const base64PDF = arrayBufferToBase64(infoEmenda.pdfBuffer);
      parts = [
        { inline_data: { mime_type: 'application/pdf', data: base64PDF } },
        { text: prompt },
      ];
      console.log('[IA] request Gemini: inline_data PDF +', prompt.length, 'chars de prompt');
    } else {
      parts = [{ text: prompt }];
    }

    const body   = {
      contents: [{ parts }],
      generationConfig: {
        temperature:      0,
        maxOutputTokens:  1500,
        responseMimeType: 'application/json',
      },
    };

    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json();

    if (!res.ok) throw new Error(json.error?.message || `Erro HTTP ${res.status}`);

    const textoRaw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!textoRaw) throw new Error('Resposta vazia da IA.');

    // Parseia o JSON retornado pela IA
    let resultado;
    try {
      resultado = JSON.parse(textoRaw);
    } catch (_) {
      // fallback: trata como texto puro na explicação
      resultado = { votoSim: '', votoNao: '', explicacao: textoRaw };
    }

    // Converte bullets em lista formatada com "• "
    function formatarExplicacao(texto) {
      if (!texto) return '';

      // Caso 1: separador explícito por pipe "|" → une em parágrafo
      if (texto.includes('|')) {
        const frases = texto.split('|')
          .map(s => s.trim().replace(/^[•\-\*]\s*/, '').replace(/\.\s*$/, ''))
          .filter(Boolean);
        return frases.join('. ') + '.';
      }

      // Caso 2: bullets implícitos separados por ".,Verbo"
      if (/\.,\s*[A-Z]/.test(texto)) {
        const frases = texto.split(/\.,\s*(?=[A-Z])/)
          .map(s => s.trim())
          .filter(Boolean);
        return frases.join('. ') + '.';
      }

      // Caso 3: múltiplas linhas → une em parágrafo
      const linhas = texto.split(/\n+/).map(s => s.trim().replace(/^[•\-\*]\s*/, '')).filter(Boolean);
      if (linhas.length > 1) {
        return linhas.join(' ');
      }

      return texto;
    }

    // Preenche os três campos visuais e salva no objeto
    if (resultado.votoSim) {
      const campo = document.getElementById('campo-voto-sim');
      if (campo) campo.value = resultado.votoSim;
      d.votoSim = resultado.votoSim;
    }
    if (resultado.votoNao) {
      const campo = document.getElementById('campo-voto-nao');
      if (campo) campo.value = resultado.votoNao;
      d.votoNao = resultado.votoNao;
    }
    if (resultado.explicacao) {
      const explicacaoFormatada = formatarExplicacao(resultado.explicacao);
      const campo = document.getElementById('campo-explicacao');
      if (campo) campo.value = explicacaoFormatada;
      d.explicacao = explicacaoFormatada;
    }

    await salvarSessao(app.sessaoAtual);
    mostrarToast('Análise gerada com sucesso!', 'sucesso');

  } catch (err) {
    console.error('Erro Gemini:', err);
    mostrarToast(`Erro ao gerar: ${err.message}`, 'erro');
  } finally {
    if (btn) {
      btn.disabled  = false;
      btn.innerHTML = `${iconeIA} Gerar Análise`;
    }
  }
}

function montarPrompt(d, prop, infoEmenda) {
  const instrucaoExplicacao = {
    resumo: `parágrafo único de 3 a 5 frases descrevendo as alterações materiais concretas da emenda. Cada frase deve dizer exatamente o que o texto da lei PASSA A DIZER ou DEIXA DE DIZER — novas proibições, novos direitos, novas obrigações, supressões, ajustes com impacto prático real. Mencione grupos afetados, condutas reguladas, verbos normativos ("proíbe", "determina", "veda", "amplia", "restringe", "exige"). Escreva de forma corrida, sem marcadores, sem listas, sem bullets.`,

    completo: `parágrafo único cobrindo TODAS as alterações materiais da emenda. Para cada alteração: descreva o que o texto da lei passará a dizer, o que deixará de existir, e quem/o quê é afetado. Use verbos normativos e seja específico. Escreva de forma corrida, sem marcadores, sem listas, sem bullets.`,

    argumentos: `parágrafo único com as principais alterações materiais, seguido de "Favorável: [argumento]" e "Contrário: [argumento]" ao final do parágrafo. Escreva de forma corrida, sem marcadores, sem listas, sem bullets.`,
  }[app.config.profundidade] || `parágrafo único com as alterações materiais concretas da emenda, escrito de forma corrida sem marcadores ou listas.`;

  // ── Determina o modo de operação ─────────────────────────────────────
  const temTexto      = !!(infoEmenda?.textoCompleto);
  const temPDFInline  = infoEmenda?.tipo === 'substitutivo_pdf';   // PDF enviado via inline_data
  // Referência legislativa: "Artigo 20", "Capítulo VIII", "Título III", etc.
  const referenciaLeg = infoEmenda?.referenciaLeg || (infoEmenda?.numArtigo ? `Artigo ${infoEmenda.numArtigo}` : null);

  // ── Bloco fonte: incluído apenas quando o texto foi extraído localmente ──
  const tipoDoc = infoEmenda?.tipo === 'emenda'      ? 'TEXTO INTEGRAL DA EMENDA'
               : infoEmenda?.tipo === 'substitutivo' ? 'TEXTO DO SUBSTITUTIVO'
               : infoEmenda?.tipo === 'pl_original'  ? 'TEXTO INTEGRAL DO PROJETO ORIGINAL'
               : 'TEXTO DO PROJETO';

  const blocoFonte = temTexto ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOCUMENTO FONTE — ${tipoDoc}
Leia atentamente antes de responder. Sua análise deve ser baseada EXCLUSIVAMENTE neste texto.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${infoEmenda.textoCompleto}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIM DO DOCUMENTO FONTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : '';

  // ── Instrução de base para a tarefa ──────────────────────────────────
  const instrucaoBase = temPDFInline
    ? 'com base EXCLUSIVAMENTE no PDF da Subemenda Substitutiva de Plenário (SSP) fornecido nesta mensagem — NÃO use conhecimento prévio, treinamento ou informações externas ao PDF'
    : temTexto
      ? 'EXCLUSIVAMENTE no documento fonte acima — NÃO use conhecimento prévio, treinamento ou informações externas ao texto fornecido'
      : 'no seu conhecimento sobre este projeto';

  // ── Aviso de PDF inline (aparece antes da tarefa) ────────────────────
  const avisPDF = temPDFInline ? `
O arquivo PDF anexado a esta mensagem é o texto integral da Subemenda Substitutiva de Plenário (SSP) referenciada no destaque. Leia o PDF integralmente antes de responder.
` : '';

  // ── Regra crítica da explicação ──────────────────────────────────────
  const fonteRef  = temPDFInline ? 'PDF' : 'documento fonte acima';
  const isPLOriginal = infoEmenda?.tipo === 'pl_original';
  const eSupressivo  = isPLOriginal && /supress|suprim/i.test(d.descricao || '');
  const regraExplicacao = isPLOriginal && referenciaLeg
    ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO (DVS de dispositivo do PL original):
→ Este destaque trata especificamente do ${referenciaLeg.toUpperCase()} do projeto original.
→ Localize EXATAMENTE o ${referenciaLeg.toUpperCase()} no documento fonte acima.
→ Descreva o conteúdo normativo concreto desse dispositivo: o que determina/autoriza/proíbe/regula, quem é afetado, quais condições e exceções existem.
→ Use verbos normativos: "estabelece", "determina", "autoriza", "proíbe", "veda", "exige".
${eSupressivo ? '→ O destaque é SUPRESSIVO: descreva o conteúdo atual do dispositivo, deixando claro que o destaque propõe REMOVÊ-LO do projeto.\n' : ''}→ Se NÃO conseguir localizar o ${referenciaLeg.toUpperCase()} no documento fonte, retorne em "explicacao": "⚠ Dispositivo ${referenciaLeg} não localizado no texto do PL. Cole o texto manualmente para análise precisa."
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao documento fonte acima.`
    : (temTexto || temPDFInline) && (infoEmenda?.tipo === 'substitutivo' || temPDFInline) && referenciaLeg
    ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO:
→ Localize o ${referenciaLeg.toUpperCase()} no ${fonteRef}
→ Descreva EXATAMENTE o que esse trecho diz: quem é afetado, o que é autorizado/proibido/determinado, quais condições e exceções existem
→ Cada frase deve descrever um aspecto concreto do conteúdo normativo desse trecho
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao ${fonteRef}`
    : temTexto && infoEmenda?.tipo === 'emenda'
      ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO:
→ PRIORIDADE 1 — Se o documento contiver uma seção "JUSTIFICATIVA" (ou "Justificação"): baseie a explicação PRINCIPALMENTE nessa seção, pois ela articula diretamente os objetivos e efeitos práticos da emenda
→ PRIORIDADE 2 — Se não houver seção de justificativa: analise o DISPOSITIVO (corpo normativo) e descreva o que o texto da lei PASSA A DIZER ou DEIXA DE DIZER — novas proibições, direitos, obrigações, supressões
→ Mencione artigos/incisos afetados quando relevante e use verbos normativos: "proíbe", "determina", "veda", "amplia", "suprime", "restringe"
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao documento fonte acima`
      : (temTexto || temPDFInline)
        ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO:
→ Cite APENAS o que está ESCRITO no ${temPDFInline ? 'PDF' : 'documento fonte acima'}
→ Para cada alteração, identifique o artigo/inciso e descreva o que o texto PASSOU A DIZER
→ Use verbos concretos: "passa a proibir", "determina que", "veda", "amplia", "suprime", "restringe"
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao ${temPDFInline ? 'PDF' : 'texto fornecido'}`
        : `
REGRA CRÍTICA — SEM DOCUMENTO FONTE:
→ Nenhum documento foi anexado/extraído para este destaque.
→ Se a descrição menciona um dispositivo específico (artigo/inciso/§/capítulo) e você NÃO tem certeza absoluta do conteúdo desse dispositivo no projeto original, retorne em "explicacao": "⚠ Texto do dispositivo não disponível. Cole o texto manualmente para análise precisa."
→ É preferível admitir falta de informação a alucinar dispositivos inexistentes.
→ NÃO invente conteúdo normativo, números de artigos, incisos ou parágrafos.`;

  return `Você é um assessor legislativo da Câmara dos Deputados do Brasil.
${blocoFonte}${avisPDF}
TAREFA: Analise o destaque abaixo ${instrucaoBase}.

DESTAQUE A ANALISAR:
- Proposição: ${prop.chave} — ${prop.ementa || ''}
- Destaque: ${d.numero} | Autoria: ${d.autoria}
- Descrição: ${d.descricao || ''}
- Tipo regimental: ${d.tipo || 'não informado'}

INSTRUÇÕES PARA CADA CAMPO DO JSON:

"votoSim": [máx. 15 palavras] Efeito prático de votar SIM. Em DVS: SIM = rejeita o destaque, mantém texto do relator.

"votoNao": [máx. 15 palavras] Efeito prático de votar NÃO. Em DVS: NÃO = aprova o destaque, incorpora a emenda.

"explicacao": ${instrucaoExplicacao}
${regraExplicacao}

PROIBIDO em qualquer campo:
- "a aprovação do destaque implica...", "o destaque visa...", "caso aprovado..."
- Qualquer linguagem sobre processo legislativo
- Afirmações que não têm base no documento fonte

Responda APENAS com JSON válido, sem markdown:
{"votoSim": "...", "votoNao": "...", "explicacao": "..."}`;
}

// ---------- EXPORTAÇÃO WHATSAPP ----------
async function exportarWhatsapp() {
  const d    = app.destinqueAtivo;
  const prop = app.proposicaoAtiva;
  if (!d || !prop) return;

  // Monta o texto no formato solicitado
  const linhas = [
    `*VOTAÇÃO NOMINAL:*`,
    `${d.numero} - ${d.autoria} - ${d.descricao || ''}`,
    ``,
    d.explicacao ? d.explicacao : `_(explicação não preenchida)_`,
    ``,
    `*Orientação:* ${d.orientacao || ''}`,
  ];

  const texto = linhas.join('\n');

  try {
    await navigator.clipboard.writeText(texto);
    mostrarToast('Texto copiado! Cole direto no WhatsApp.', 'sucesso');
  } catch (err) {
    // Fallback: exibe em alert para copiar manualmente
    prompt('Copie o texto abaixo e cole no WhatsApp:', texto);
  }
}

// ---------- EXPORTAÇÃO DOCX ----------
async function exportarDocx() {
  const d    = app.destinqueAtivo;
  const prop = app.proposicaoAtiva;
  if (!d || !prop) return;

  const btn = document.getElementById('btn-exportar-docx');
  btn.disabled  = true;
  btn.innerHTML = `<span class="loading-spinner"></span> Gerando...`;

  try {
    const {
      Document, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, WidthType, BorderStyle, ShadingType, Packer
    } = docx;

    const corAzul          = '1a3f6f';
    const corVerde         = '00A859';
    const corVerdeClaro    = 'd1fae5';
    const corVermelhoClaro = 'fee2e2';
    const corCinza         = 'f5f6fa';

    const semBorda = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const bordas   = { top: semBorda, bottom: semBorda, left: semBorda, right: semBorda };
    const margem   = { top: 120, bottom: 120, left: 140, right: 140 };

    const documento = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'Em apreciação no momento:', bold: true, size: 28 })],
            spacing: { after: 200 },
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              // Cabeçalho azul
              new TableRow({ children: [
                new TableCell({
                  columnSpan: 2,
                  borders: bordas,
                  shading: { type: ShadingType.CLEAR, fill: corAzul },
                  margins: margem,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: `${prop.chave} – ${prop.ementa || ''}`, bold: true, color: 'FFFFFF', size: 22 })],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { before: 60 },
                      children: [new TextRun({ text: `${d.numero} – ${d.autoria}`, bold: true, color: 'FFFFFF', size: 20 })],
                    }),
                  ],
                }),
              ]}),

              // Descrição
              new TableRow({ children: [
                new TableCell({
                  columnSpan: 2,
                  borders: bordas,
                  shading: { type: ShadingType.CLEAR, fill: 'FFFFFF' },
                  margins: margem,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: d.descricao || '', size: 20, italics: true })],
                    }),
                    d.tipo ? new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: `Tipo regimental: ${d.tipo}`, size: 18, color: '6b7280' })],
                    }) : new Paragraph({ children: [] }),
                  ],
                }),
              ]}),

              // Voto SIM | Voto NÃO
              new TableRow({ children: [
                new TableCell({
                  borders: { ...bordas, right: { style: BorderStyle.SINGLE, size: 4, color: corVerde } },
                  shading: { type: ShadingType.CLEAR, fill: corVerdeClaro },
                  margins: margem,
                  children: [
                    new Paragraph({ children: [new TextRun({ text: 'Voto SIM:', bold: true, size: 20, color: '065f46' })] }),
                    new Paragraph({ spacing: { before: 60 }, children: [new TextRun({
                      text: d.votoSim || '(a ser preenchido)',
                      size: 18,
                      italics: !d.votoSim,
                      color: d.votoSim ? '065f46' : '6b7280',
                    })] }),
                    new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 120 } }),
                  ],
                }),
                new TableCell({
                  borders: bordas,
                  shading: { type: ShadingType.CLEAR, fill: corVermelhoClaro },
                  margins: margem,
                  children: [
                    new Paragraph({ children: [new TextRun({ text: 'Voto NÃO:', bold: true, size: 20, color: '991b1b' })] }),
                    new Paragraph({ spacing: { before: 60 }, children: [new TextRun({
                      text: d.votoNao || '(a ser preenchido)',
                      size: 18,
                      italics: !d.votoNao,
                      color: d.votoNao ? '991b1b' : '6b7280',
                    })] }),
                    new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 120 } }),
                  ],
                }),
              ]}),

              // Explicação
              new TableRow({ children: [
                new TableCell({
                  columnSpan: 2,
                  borders: bordas,
                  shading: { type: ShadingType.CLEAR, fill: corCinza },
                  margins: margem,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: 'EXPLICAÇÃO', bold: true, size: 20, color: '6b7280' })],
                      spacing: { after: 80 },
                    }),
                    new Paragraph({
                      children: [new TextRun({
                        text: d.explicacao || '[Campo reservado para integração com IA]',
                        size: 18,
                        italics: !d.explicacao,
                        color: d.explicacao ? '1f2937' : 'aaaaaa',
                      })],
                    }),
                    new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),
                  ],
                }),
              ]}),

              // Orientação
              new TableRow({ children: [
                new TableCell({
                  columnSpan: 2,
                  borders: bordas,
                  shading: { type: ShadingType.CLEAR, fill: 'fffbeb' },
                  margins: margem,
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: 'Orientação: ', bold: true, size: 22, color: '92400e' }),
                        new TextRun({ text: d.orientacao || '', bold: true, size: 22, color: '1f2937' }),
                      ],
                    }),
                  ],
                }),
              ]}),
            ],
          }),

          new Paragraph({
            spacing: { before: 200 },
            children: [new TextRun({
              text: `Gerado em: ${new Date().toLocaleString('pt-BR')} | Liderança do Podemos – Câmara dos Deputados`,
              size: 16, color: 'aaaaaa', italics: true,
            })],
          }),
        ],
      }],
    });

    const blob     = await Packer.toBlob(documento);
    const url      = URL.createObjectURL(blob);
    const link     = document.createElement('a');
    link.href      = url;
    link.download  = `Destaque_${d.numero.replace(/\s/g,'_')}_${prop.chave.replace(/[\s/]/g,'_')}.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    mostrarToast('Word exportado com sucesso!', 'sucesso');

  } catch (err) {
    console.error('Erro ao exportar DOCX:', err);
    mostrarToast('Erro ao gerar o Word. Veja o console (F12).', 'erro');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg> Exportar Word`;
  }
}

// ---------- FILTROS ----------
function filtrarDestaques(filtro, el) {
  app.filtroAtual = filtro;
  document.querySelectorAll('.filtro-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderizarDestaques();
}

// ============================================================
//  FIREBASE REALTIME DATABASE — REST API
// ============================================================

/** Salva uma sessão no Firebase */
async function fbSalvar(sessao) {
  const res = await fetch(`${FIREBASE_URL}/sessoes/${sessao.id}.json`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(sessao),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}

/** Carrega todas as sessões do Firebase */
async function fbCarregarTodas() {
  const res = await fetch(`${FIREBASE_URL}/sessoes.json`);
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  const data = await res.json();
  return data ? Object.values(data).map(normalizarSessao) : [];
}

/** Carrega uma sessão específica do Firebase */
async function fbCarregarUma(id) {
  const res = await fetch(`${FIREBASE_URL}/sessoes/${id}.json`);
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  const data = await res.json();
  return data ? normalizarSessao(data) : null;
}

/**
 * Firebase apaga arrays vazios ao salvar (converte [] para null).
 * Esta função garante que todos os campos críticos sejam arrays válidos
 * independentemente do que vier do Firebase.
 */
function normalizarSessao(sessao) {
  if (!sessao) return sessao;
  if (!Array.isArray(sessao.proposicoes)) sessao.proposicoes = [];
  sessao.proposicoes = sessao.proposicoes.map(prop => {
    if (!prop) return prop;
    if (!Array.isArray(prop.destaques)) prop.destaques = [];
    // Re-avalia 'ativo' com base na situação para corrigir dados em cache
    prop.destaques = prop.destaques.map(d => {
      if (!d) return d;
      const sNorm = (d.situacao || '').toLowerCase();
      d.ativo = !SITUACOES_INATIVAS.some(s => sNorm.includes(s));
      return d;
    });
    return prop;
  });
  return sessao;
}

// ============================================================
//  EXCLUSÃO DE SESSÃO
// ============================================================

/** Abre o modal de confirmação de exclusão */
function abrirModalApagarSessao(id, titulo) {
  app.sessaoParaApagar = id;
  const nomeEl = document.getElementById('apagar-sessao-nome');
  if (nomeEl) nomeEl.textContent = `"${titulo || 'Sessão sem título'}"`;
  document.getElementById('modal-apagar-sessao').style.display = 'flex';
}

/** Apaga uma sessão do Firebase via HTTP DELETE */
async function fbApagar(id) {
  const res = await fetch(`${FIREBASE_URL}/sessoes/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase DELETE HTTP ${res.status}`);
}

/** Remove uma sessão do cache local (chrome.storage.local) */
async function apagarSessaoLocal(id) {
  return new Promise(resolve => {
    chrome.storage.local.get('sessoes', data => {
      const sessoes = data.sessoes || {};
      delete sessoes[id];
      chrome.storage.local.set({ sessoes }, resolve);
    });
  });
}

/**
 * Apaga sessão do Firebase + cache local, reseta a UI se for a sessão ativa,
 * e atualiza o histórico.
 */
async function apagarSessao(id) {
  const btn = document.getElementById('btn-confirmar-apagar');
  if (btn) { btn.disabled = true; btn.textContent = 'Apagando...'; }

  try {
    // Tenta remover do Firebase (pode falhar offline)
    try {
      await fbApagar(id);
    } catch (e) {
      console.warn('Firebase indisponível ao apagar; removendo apenas localmente:', e.message);
    }

    // Remove sempre do cache local
    await apagarSessaoLocal(id);

    // Se a sessão apagada era a ativa, volta para o estado vazio
    if (app.sessaoAtual?.id === id) {
      app.sessaoAtual     = null;
      app.proposicaoAtiva = null;
      pararSyncAutomatico();

      const syncBar = document.getElementById('sync-bar');
      if (syncBar) syncBar.style.display = 'none';

      const sessaoInfo = document.getElementById('sessao-info');
      if (sessaoInfo) {
        sessaoInfo.textContent = 'Nenhuma sessão carregada';
        sessaoInfo.classList.add('empty');
      }

      renderizarProposicoesSidebar();
      mostrarTela('tela-upload');
    }

    // Atualiza o histórico
    await carregarHistorico();
    mostrarToast('Sessão apagada com sucesso.', 'sucesso');

  } catch (err) {
    console.error('Erro ao apagar sessão:', err);
    mostrarToast('Erro ao apagar. Tente novamente.', 'erro');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Apagar definitivamente`;
    }
  }
}

// ---------- HISTÓRICO ----------

/** Salva sessão: primeiro local (rápido), depois Firebase (compartilhado) */
async function salvarSessao(sessao) {
  // 1. Salva localmente (instantâneo, para não travar a UI)
  await salvarSessaoLocal(sessao);
  // 2. Salva no Firebase em background
  fbSalvar(sessao)
    .then(() => atualizarStatusSync('ok'))
    .catch(e => {
      console.warn('Firebase indisponível:', e.message);
      atualizarStatusSync('offline');
    });
}

/** Salva explicitamente o destaque ativo (campos do modal → Firebase) */
async function salvarDestaqueManual() {
  const d = app.destinqueAtivo;
  if (!d || !app.sessaoAtual) return;

  const iconeSalvar = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  const btn = document.getElementById('btn-salvar-destaque');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="loading-spinner"></span> Salvando...`; }

  d.votoSim    = document.getElementById('campo-voto-sim')?.value   ?? d.votoSim;
  d.votoNao    = document.getElementById('campo-voto-nao')?.value   ?? d.votoNao;
  d.explicacao = document.getElementById('campo-explicacao')?.value ?? d.explicacao;
  d.orientacao = document.getElementById('campo-orientacao')?.value ?? d.orientacao;

  try {
    await salvarSessaoLocal(app.sessaoAtual);
    await fbSalvar(app.sessaoAtual);
    atualizarStatusSync('ok');
    mostrarToast('Destaque salvo com sucesso!', 'sucesso');
    const badge = document.getElementById('badge-salvo');
    if (badge) {
      badge.classList.add('visivel');
      setTimeout(() => badge.classList.remove('visivel'), 2000);
    }
  } catch (err) {
    console.error('Erro ao salvar destaque:', err);
    atualizarStatusSync('offline');
    mostrarToast('Salvo localmente. Firebase indisponível.', 'aviso');
  } finally {
    if (btn) {
      btn.disabled  = false;
      btn.innerHTML = `${iconeSalvar} Salvar`;
    }
  }
}

/** Persiste sessão no chrome.storage.local (cache offline) */
async function salvarSessaoLocal(sessao) {
  return new Promise(resolve => {
    chrome.storage.local.get('sessoes', data => {
      const sessoes = data.sessoes || {};
      sessoes[sessao.id] = sessao;
      chrome.storage.local.set({ sessoes }, resolve);
    });
  });
}

/** Carrega histórico: tenta Firebase, cai para local se offline */
async function carregarHistorico() {
  let sessoes = [];
  let online  = true;

  try {
    sessoes = await fbCarregarTodas();
    // Atualiza cache local com dados do Firebase
    const mapa = {};
    sessoes.forEach(s => { mapa[s.id] = s; });
    await new Promise(r => chrome.storage.local.set({ sessoes: mapa }, r));
  } catch (e) {
    console.warn('Firebase offline, usando cache local:', e.message);
    online = false;
    sessoes = await new Promise(resolve => {
      chrome.storage.local.get('sessoes', data => {
        resolve(Object.values(data.sessoes || {}));
      });
    });
  }

  atualizarStatusSync(online ? 'ok' : 'offline');
  sessoes.sort((a, b) => new Date(b.data) - new Date(a.data));

  const lista = document.getElementById('lista-historico');
  if (!sessoes.length) {
    lista.innerHTML = `<div class="empty-state"><p>Nenhuma sessão anterior</p></div>`;
    return;
  }

  lista.innerHTML = sessoes.slice(0, 10).map(s => `
    <div class="hist-item" data-id="${s.id}">
      <div class="hist-item-main">
        <div class="hist-item-titulo">${s.titulo}</div>
        <div class="hist-item-data">
          ${new Date(s.data).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric'})}
        </div>
      </div>
      <button class="hist-item-delete"
              data-id="${s.id}"
              data-titulo="${s.titulo.replace(/"/g, '&quot;')}"
              title="Apagar sessão">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
  `).join('');
}

/** Restaura sessão: carrega do Firebase para obter dados mais recentes */
async function restaurarSessao(id) {
  let sessao = null;
  try {
    sessao = await fbCarregarUma(id);
  } catch (e) {
    console.warn('Firebase offline, restaurando do cache:', e.message);
  }

  // Fallback: cache local
  if (!sessao) {
    sessao = await new Promise(resolve => {
      chrome.storage.local.get('sessoes', data => resolve(data.sessoes?.[id] || null));
    });
  }

  if (sessao) await carregarSessao(sessao);
}

// ============================================================
//  SINCRONIZAÇÃO AUTOMÁTICA (Firebase polling)
// ============================================================

function iniciarSyncAutomatico() {
  pararSyncAutomatico();
  app.syncTimer = setInterval(async () => {
    if (!app.sessaoAtual) return;
    // Se o modal de destaque está aberto o usuário pode estar editando — adia o sync
    // para evitar substituir app.sessaoAtual/proposicaoAtiva e tornar destinqueAtivo órfão
    if (document.getElementById('modal-destaque').style.display !== 'none') return;
    try {
      const nova = await fbCarregarUma(app.sessaoAtual.id);
      if (!nova) return;

      // Confirma que o modal continua fechado após o await (pode ter aberto durante o fetch)
      if (document.getElementById('modal-destaque').style.display !== 'none') return;

      app.sessaoAtual = nova;
      await salvarSessaoLocal(nova);

      if (app.proposicaoAtiva) {
        const atualizada = nova.proposicoes.find(p => p.chave === app.proposicaoAtiva.chave);
        if (atualizada) app.proposicaoAtiva = atualizada;
      }

      renderizarProposicoesSidebar();
      renderizarDestaques();
      atualizarStatusSync('ok');
    } catch (e) {
      atualizarStatusSync('offline');
    }
  }, 20000); // a cada 20 segundos
}

function pararSyncAutomatico() {
  if (app.syncTimer) {
    clearInterval(app.syncTimer);
    app.syncTimer = null;
  }
}

async function sincronizarAgora() {
  if (!app.sessaoAtual) return;
  const btn = document.getElementById('btn-sync-manual');
  if (btn) btn.classList.add('girando');
  atualizarStatusSync('sincronizando');

  // Salva o destaque ativo antes de sincronizar para não perder dados em edição
  const modalAberto = document.getElementById('modal-destaque').style.display !== 'none';
  if (modalAberto && app.destinqueAtivo) {
    await salvarDestaqueManual();
  }

  try {
    const nova = await fbCarregarUma(app.sessaoAtual.id);
    if (nova) {
      app.sessaoAtual = nova;
      await salvarSessaoLocal(nova);
      if (app.proposicaoAtiva) {
        const atualizada = nova.proposicoes.find(p => p.chave === app.proposicaoAtiva.chave);
        if (atualizada) {
          app.proposicaoAtiva = atualizada;
          if (!modalAberto) renderizarDestaques();
        }
      }
      renderizarProposicoesSidebar();
      atualizarStatusSync('ok');
      mostrarToast('Dados sincronizados com sucesso!', 'sucesso');
    }
  } catch (e) {
    atualizarStatusSync('offline');
    mostrarToast('Firebase indisponível. Usando dados locais.', 'aviso');
  } finally {
    if (btn) btn.classList.remove('girando');
  }
}

/** Atualiza a barra de status de sincronização */
function atualizarStatusSync(estado) {
  const bar   = document.getElementById('sync-bar');
  const texto = document.getElementById('sync-texto');
  if (!bar || !texto) return;

  // Só exibe a barra quando há uma sessão ativa
  if (!app.sessaoAtual) return;

  const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  bar.className = 'sync-bar';
  bar.style.display = 'flex';

  if (estado === 'ok') {
    bar.classList.add('ok');
    texto.textContent = `● Firebase · ${agora}`;
  } else if (estado === 'offline') {
    bar.classList.add('offline');
    texto.textContent = `○ Offline – dados locais`;
  } else if (estado === 'sincronizando') {
    bar.classList.add('sincronizando');
    texto.textContent = `⟳ Sincronizando...`;
  }
}

// ============================================================
//  NAVEGAÇÃO HOME
// ============================================================

const MODULES = [
  {
    id:     'destaques',
    titulo: 'Destaques Legislativos',
    desc:   'Analise e oriente a votação de destaques de projetos de lei nas sessões do Plenário.',
    cor:    'verde',
    icone:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    acao:   entrarDestaques,
  },
  {
    id:     'votacao',
    titulo: 'Painel de Votação',
    desc:   'Acompanhe os votos da bancada por votação nominal, gere imagens e analise o placar.',
    cor:    'teal',
    icone:  '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="7 11 10 8 13 10 17 6"/>',
    acao:   abrirVotacao,
  },
  {
    id:     'aderencia',
    titulo: 'Aderência ao Governo',
    desc:   'Calcule o índice de aderência do partido às orientações do governo por período, com análise individual por deputado.',
    cor:    'teal',
    icone:  '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    acao:   abrirAderencia,
  },
  {
    id:     'comissoes',
    titulo: 'Controle de Comissões',
    desc:   'Gerencie a participação de deputados do partido em comissões permanentes.',
    cor:    'teal',
    icone:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    acao:   abrirComissoes,
  },
];

function renderHomeGrid() {
  const grid = document.getElementById('home-grid');
  grid.innerHTML = MODULES.map(m => `
    <button class="home-card" data-modulo="${m.id}">
      <div class="home-card-icon home-card-icon--${m.cor}">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          ${m.icone}
        </svg>
      </div>
      <div class="home-card-content">
        <span class="home-card-title">${m.titulo}</span>
        <span class="home-card-desc">${m.desc}</span>
      </div>
      <span class="home-card-arrow">→</span>
    </button>`).join('');

  grid.querySelectorAll('.home-card').forEach(btn => {
    const mod = MODULES.find(m => m.id === btn.dataset.modulo);
    btn.addEventListener('click', mod.acao);
  });
}

function voltarHome() {
  document.getElementById('tela-home').classList.remove('oculta');
}

async function entrarDestaques() {
  document.getElementById('tela-home').classList.add('oculta');

  // Se já há sessão carregada, não faz nada (usuário voltou da votação etc.)
  if (app.sessaoAtual) return;

  // Tenta carregar a sessão mais recente automaticamente
  await carregarUltimaSessaoDisponivel();
}

/**
 * Carrega a sessão mais recente disponível (Firebase > cache local).
 * Se não encontrar nada, mantém a tela de upload para novos usuários.
 */
async function carregarUltimaSessaoDisponivel() {
  let sessoes = [];

  // 1ª tentativa: Firebase
  try {
    sessoes = await fbCarregarTodas();
  } catch (e) {
    console.warn('Firebase indisponível, tentando cache local:', e.message);
  }

  // 2ª tentativa: cache local
  if (!sessoes.length) {
    sessoes = await new Promise(resolve => {
      chrome.storage.local.get('sessoes', data => {
        resolve(Object.values(data.sessoes || {}));
      });
    });
  }

  if (!sessoes.length) return; // Primeira vez — mostra tela de upload normalmente

  // Ordena pela data mais recente e carrega
  sessoes.sort((a, b) => new Date(b.data) - new Date(a.data));
  await carregarSessao(normalizarSessao(sessoes[0]));
}

function abrirVotacao() {
  const url = chrome.runtime.getURL('votacao.html');
  chrome.tabs.create({ url });
}

function abrirAderencia() {
  const url = chrome.runtime.getURL('aderencia.html');
  chrome.tabs.create({ url });
}

function abrirComissoes() {
  const url = chrome.runtime.getURL('comissoes.html');
  chrome.tabs.create({ url });
}

// ---------- UTILITÁRIOS ----------
function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function abrirModalNovaSessao() {
  document.getElementById('sessao-titulo').value = '';
  document.getElementById('upload-inline-text').textContent = 'Clique para selecionar o PDF';
  document.getElementById('upload-inline').classList.remove('tem-arquivo');
  document.getElementById('proposicoes-encontradas').style.display = 'none';
  document.getElementById('lista-proposicoes-modal').innerHTML = '';
  document.getElementById('btn-criar-sessao').disabled = true;
  // Limpar input de arquivo para permitir re-selecionar o mesmo arquivo
  document.getElementById('input-pdf-modal').value = '';
  document.getElementById('input-pdf').value = '';
  window._proposicoesPDF = [];
  document.getElementById('modal-nova-sessao').style.display = 'flex';
}

function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function mostrarToast(msg, tipo = '') {
  const toast = document.getElementById('toast');
  toast.textContent   = msg;
  toast.className     = `toast ${tipo}`;
  toast.style.display = 'block';
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}
