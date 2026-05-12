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

// ---------- PROVEDORES DE IA ----------
// Cada provedor encapsula suas particularidades (auth, formato de body,
// PDF inline, listagem de modelos, extração de texto da resposta).
// `montarRequest({prompt, pdfs, modelo, apiKey})` retorna {url, headers, body}.
// `extrairTexto(json)` retorna a string bruta que será passada a JSON.parse
// (com fallback tolerante na função `gerarAnalise`).
const PROVEDORES = {
  gemini: {
    id:    'gemini',
    label: 'Google Gemini',
    regexChave:  /^AIza[\w-]{20,}$/,
    placeholderChave: 'AIzaSy...',
    hintChave:   'Obtenha em aistudio.google.com → Get API key',
    modelosFallback: [
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro',   displayName: 'Gemini 2.5 Pro'   },
    ],
    async listarModelos(apiKey) {
      const res = await fetch(`${GEMINI_BASE}?key=${apiKey}&pageSize=50`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `Erro HTTP ${res.status}`);
      return (json.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent')
                  && (m.name || '').includes('gemini'))
        .map(m => ({
          id:          (m.name || '').replace(/^models\//, ''),
          displayName: m.displayName || m.name,
        }));
    },
    montarRequest({ prompt, pdfs, modelo, apiKey }) {
      const parts = [];
      for (const p of pdfs) {
        parts.push({ inline_data: {
          mime_type: p.mimeType || 'application/pdf',
          data:      arrayBufferToBase64(p.buffer),
        }});
      }
      parts.push({ text: prompt });
      return {
        url: `${GEMINI_BASE}/${modelo}:generateContent?key=${apiKey}`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          contents: [{ parts }],
          generationConfig: {
            temperature:      0,
            maxOutputTokens:  1500,
            responseMimeType: 'application/json',
          },
        },
      };
    },
    extrairTexto(json) {
      return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    },
    extrairErro(json, status) {
      return json.error?.message || `Erro HTTP ${status}`;
    },
  },

  openai: {
    id:    'openai',
    label: 'OpenAI (ChatGPT)',
    regexChave:  /^sk-[\w-]{20,}$/,
    placeholderChave: 'sk-...',
    hintChave:   'Obtenha em platform.openai.com/api-keys',
    // Prefixos de modelos relevantes para análise multimodal
    prefixosModelos: ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4'],
    modelosFallback: [
      { id: 'gpt-5',     displayName: 'GPT-5' },
      { id: 'gpt-4.1',   displayName: 'GPT-4.1' },
      { id: 'gpt-4o',    displayName: 'GPT-4o' },
    ],
    async listarModelos(apiKey) {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `Erro HTTP ${res.status}`);

      const lista = (json.data || [])
        .map(m => m.id)
        .filter(id => this.prefixosModelos.some(p => id.startsWith(p)));

      if (!lista.length) return this.modelosFallback;
      return lista.map(id => ({ id, displayName: id }));
    },
    montarRequest({ prompt, pdfs, modelo, apiKey }) {
      const content = [];
      for (const p of pdfs) {
        const base64 = arrayBufferToBase64(p.buffer);
        content.push({
          type:      'input_file',
          filename:  'documento.pdf',
          file_data: `data:${p.mimeType || 'application/pdf'};base64,${base64}`,
        });
      }
      content.push({ type: 'input_text', text: prompt });

      return {
        url: 'https://api.openai.com/v1/responses',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
        },
        body: {
          model: modelo,
          input: [{ role: 'user', content }],
          text:  { format: { type: 'json_object' } },
          temperature:       0,
          max_output_tokens: 1500,
        },
      };
    },
    extrairTexto(json) {
      // Responses API: output[].content[] com itens type:'output_text'
      const output = json.output || [];
      for (const item of output) {
        for (const c of (item.content || [])) {
          if (c.type === 'output_text' && c.text) return c.text.trim();
        }
      }
      // Fallback: campo direto "output_text" agregado pela SDK
      return (json.output_text || '').trim();
    },
    extrairErro(json, status) {
      return json.error?.message || `Erro HTTP ${status}`;
    },
  },

  anthropic: {
    id:    'anthropic',
    label: 'Anthropic (Claude)',
    regexChave:  /^sk-ant-[\w-]{20,}$/,
    placeholderChave: 'sk-ant-...',
    hintChave:   'Obtenha em console.anthropic.com → Settings → API Keys',
    // Anthropic não tem endpoint público de listagem de modelos —
    // mantemos lista estática curada (atualizar manualmente quando sair novo).
    modelosFallback: [
      { id: 'claude-opus-4-7',           displayName: 'Claude Opus 4.7'   },
      { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5'  },
    ],
    async listarModelos(_apiKey) {
      return this.modelosFallback;
    },
    montarRequest({ prompt, pdfs, modelo, apiKey }) {
      const content = [];
      for (const p of pdfs) {
        content.push({
          type:   'document',
          source: {
            type:       'base64',
            media_type: p.mimeType || 'application/pdf',
            data:       arrayBufferToBase64(p.buffer),
          },
        });
      }
      // Reforça instrução de JSON puro no prompt (Anthropic não tem flag
      // nativa equivalente a responseMimeType; parsing tolerante cuida do resto)
      const promptComJSON = prompt
        + '\n\nIMPORTANTE: responda APENAS com JSON válido no formato'
        + ' {"votoSim":"","votoNao":"","explicacao":""} — sem markdown,'
        + ' sem fences ```, sem texto antes ou depois do JSON.';
      content.push({ type: 'text', text: promptComJSON });

      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'Content-Type':      'application/json',
        },
        body: {
          model:       modelo,
          max_tokens:  1500,
          messages: [{ role: 'user', content }],
        },
      };
    },
    extrairTexto(json) {
      // Messages API: content[] com itens type:'text'
      for (const item of (json.content || [])) {
        if (item.type === 'text' && item.text) return item.text.trim();
      }
      return '';
    },
    extrairErro(json, status) {
      return json.error?.message || json.error?.type || `Erro HTTP ${status}`;
    },
  },
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
    provedor:    'gemini',
    apiKey:      '',
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
      const input = document.getElementById('config-api-key');
      input.type  = input.type === 'password' ? 'text' : 'password';
    });

  // Troca de provedor: limpa chave/modelo, atualiza hint e placeholder
  document.getElementById('config-provedor')
    .addEventListener('change', () => aoTrocarProvedor({ limparChave: true }));

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
      ${app.config.apiKey
        ? `<button id="btn-gerar-ia" class="btn btn-ia btn-sm">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18a1 1 0 0 0-2 0v1.93A8 8 0 0 1 4.07 13H6a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V6a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H18a1 1 0 0 0 0 2h1.93A8 8 0 0 1 13 19.93z"/></svg>
             Gerar Análise
           </button>`
        : `<span class="ia-sem-chave">Configure a chave de API em ⚙ Configurações</span>`
      }
    </div>

    ${app.config.apiKey ? (
      ehDestaquePreferencia(d) ? `
    <div id="ia-manual-area" class="ia-manual-area ia-manual-preferencia">
      <p class="ia-manual-hint">
        <strong>Destaque de Preferência detectado.</strong> Anexe os 2 PDFs abaixo para comparação:
      </p>
      <div class="ia-manual-inputs">
        <label class="ia-manual-label">
          <span>📄 PDF que recebe preferência no destaque:</span>
          <input type="file" id="ia-manual-pdf-pref" accept=".pdf" class="ia-manual-file">
        </label>
        <label class="ia-manual-label" style="margin-top:8px">
          <span>📄 PDF a ser comparado com o do destaque:</span>
          <input type="file" id="ia-manual-pdf-comp" accept=".pdf" class="ia-manual-file">
        </label>
        <button id="btn-limpar-manual" class="btn-link-discreto" style="margin-top:4px;font-size:11px">
          🗑 Limpar entrada manual
        </button>
      </div>
    </div>
    ` : `
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
    `) : ''}


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
//  CONFIGURAÇÕES E INTEGRAÇÃO COM PROVEDORES DE IA
// ============================================================

async function carregarConfiguracao() {
  return new Promise(resolve => {
    chrome.storage.local.get('config', data => {
      if (data.config) Object.assign(app.config, data.config);

      // Migração silenciosa: config legada (geminiKey) → schema atual (apiKey + provedor)
      // Não removemos `geminiKey` da config nesta etapa para permitir downgrade indolor.
      if (app.config.geminiKey && !app.config.apiKey) {
        app.config.apiKey   = app.config.geminiKey;
        app.config.provedor = app.config.provedor || 'gemini';
        chrome.storage.local.set({ config: app.config });
        console.log('[config] migração silenciosa: geminiKey → apiKey (provedor=gemini)');
      }
      if (!app.config.provedor) app.config.provedor = 'gemini';

      resolve();
    });
  });
}

async function salvarConfiguracao() {
  const provedorId = document.getElementById('config-provedor').value;
  const key        = document.getElementById('config-api-key').value.trim();
  const modelo     = document.getElementById('config-modelo').value;
  const profund    = document.getElementById('config-profundidade').value;
  const status     = document.getElementById('config-status-ia');

  const provedor = PROVEDORES[provedorId] || PROVEDORES.gemini;
  if (key && !provedor.regexChave.test(key)) {
    status.textContent  = `⚠ Formato de chave inválido para ${provedor.label}.`;
    status.className    = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  app.config.provedor     = provedorId;
  app.config.apiKey       = key;
  app.config.modelo       = modelo;
  app.config.profundidade = profund;
  // Limpa campo legado após salvar pelo novo schema
  delete app.config.geminiKey;

  await new Promise(r => chrome.storage.local.set({ config: app.config }, r));

  fecharModal('modal-configuracoes');
  mostrarToast('Configurações salvas com sucesso!', 'sucesso');
}

async function abrirConfiguracoes() {
  document.getElementById('config-provedor').value     = app.config.provedor    || 'gemini';
  document.getElementById('config-api-key').value   = app.config.apiKey      || '';
  document.getElementById('config-profundidade').value = app.config.profundidade || 'resumo';
  document.getElementById('config-status-ia').style.display   = 'none';
  document.getElementById('modelos-status').style.display      = 'none';
  document.getElementById('modal-configuracoes').style.display = 'flex';

  // Atualiza placeholder e hint conforme o provedor atual (sem limpar a chave salva)
  aoTrocarProvedor({ limparChave: false });

  // Se já tem chave salva, carrega a lista de modelos automaticamente
  if (app.config.apiKey) {
    await carregarModelosDisponiveis();
  }
}

/** Atualiza UI do modal quando o usuário troca o provedor.
 *  - Atualiza placeholder do input e hint abaixo.
 *  - Limpa o select de modelos (precisa carregar de novo).
 *  - Se `limparChave` (mudança manual), também esvazia o input. */
function aoTrocarProvedor({ limparChave }) {
  const id       = document.getElementById('config-provedor').value;
  const provedor = PROVEDORES[id];
  if (!provedor) return;

  const input = document.getElementById('config-api-key');
  input.placeholder = provedor.placeholderChave || 'Cole aqui sua chave';
  if (limparChave) input.value = '';

  const hint = document.getElementById('config-hint-chave');
  if (hint) hint.textContent = provedor.hintChave || '';

  const select = document.getElementById('config-modelo');
  select.innerHTML = '<option value="">— clique em "Carregar disponíveis" —</option>';

  const status = document.getElementById('modelos-status');
  if (status) status.style.display = 'none';
  const statusIA = document.getElementById('config-status-ia');
  if (statusIA) statusIA.style.display = 'none';
}

async function carregarModelosDisponiveis() {
  const key    = document.getElementById('config-api-key').value.trim() || app.config.apiKey;
  const select = document.getElementById('config-modelo');
  const status = document.getElementById('modelos-status');
  const btn    = document.getElementById('btn-carregar-modelos');

  const provedorId = document.getElementById('config-provedor').value || app.config.provedor;
  const provedor   = PROVEDORES[provedorId] || PROVEDORES.gemini;

  if (!key) {
    status.textContent   = 'Cole sua chave de API primeiro.';
    status.style.display = 'block';
    return;
  }

  btn.textContent      = '⏳ Carregando...';
  btn.disabled         = true;
  status.style.display = 'none';

  try {
    const modelos = (await provedor.listarModelos(key))
      .sort((a, b) => (b.id || '').localeCompare(a.id || '')); // mais recentes primeiro

    if (!modelos.length) throw new Error('Nenhum modelo compatível encontrado.');

    const modeloSalvo = app.config.modelo;
    select.innerHTML = modelos.map(m => {
      const selected = m.id === modeloSalvo ? 'selected' : '';
      return `<option value="${m.id}" ${selected}>${m.displayName || m.id}</option>`;
    }).join('');
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
  const key    = document.getElementById('config-api-key').value.trim();
  const modelo = document.getElementById('config-modelo').value;
  const status = document.getElementById('config-status-ia');

  const provedorId = document.getElementById('config-provedor').value || app.config.provedor;
  const provedor   = PROVEDORES[provedorId] || PROVEDORES.gemini;

  if (!key) {
    status.textContent   = 'Cole sua chave de API antes de testar.';
    status.className     = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  status.textContent   = `⏳ Testando conexão com ${provedor.label}...`;
  status.className     = 'config-status teste';
  status.style.display = 'block';

  const modeloEfetivo = (modelo && modelo.trim()) || provedor.modelosFallback?.[0]?.id;
  if (!modeloEfetivo) {
    status.textContent   = `Nenhum modelo disponível para ${provedor.label}.`;
    status.className     = 'config-status erro';
    return;
  }

  try {
    const { url, headers, body } = provedor.montarRequest({
      prompt: 'Responda apenas: OK',
      pdfs:   [],
      modelo: modeloEfetivo,
      apiKey: key,
    });
    const res  = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(provedor.extrairErro(json, res.status));

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
// Busca documento da Câmara. Default: retorna pdfBuffer (envio inline ao Gemini).
// Fallback: se for HTML, extrai texto via fetchTextoIntegra.
// `infoExtra` é mesclado no retorno (tipo, referenciaLeg, etc).
async function buscarDocumento(url, infoExtra = {}) {
  if (!url) return null;
  try {
    const r = await fetchCamaraResponse(url);
    if (!r) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (/pdf/.test(ct)) {
      const pdfBuffer = await r.arrayBuffer();
      if (pdfBuffer.byteLength > 0) {
        console.log('[IA] PDF inline pronto:',
          (pdfBuffer.byteLength / 1024).toFixed(0), 'KB | url:', url);
        return { pdfBuffer, ...infoExtra };
      }
      return null;
    }
    // HTML: fallback para extração de texto
    const textoCompleto = await fetchTextoIntegra(url, r.clone());
    if (textoCompleto && textoCompleto.length > 100) {
      console.log('[IA] HTML extraído:', textoCompleto.length, 'chars | url:', url);
      return { textoCompleto, ...infoExtra };
    }
    return null;
  } catch (e) {
    console.warn('[IA] buscarDocumento falhou:', e);
    return null;
  }
}

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
      // Limite alto: PLs longos têm ~75k chars e dispositivos podem estar bem
      // no meio do texto. Gemini 2.5 Flash suporta ~1M tokens — 120k chars
      // (~30k tokens) é seguro e cobre praticamente todos os PLs.
      return limpo.length > 50 ? limpo.slice(0, 120000) : null;
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
    return texto.length > 100 ? texto.slice(0, 120000) : null;
  } catch (_) { return null; }
}

/** Resolve href relativo para URL absoluta da Câmara */
function resolverUrlCamara(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return 'https://www.camara.leg.br' + href;
  return 'https://www.camara.leg.br/proposicoesWeb/' + href;
}

// Identifica Destaque de Preferência (comparação entre 2 textos do mesmo art.).
// Esse caso depende de upload manual de 2 PDFs (não há busca automática confiável).
function ehDestaquePreferencia(d) {
  if (!d) return false;
  const txt = `${d.descricao || ''} ${d.tipo || ''} ${d.tituloLink || ''}`;
  return /destaque\s+de\s+prefer[êe]ncia/i.test(txt);
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
    // Destaque de Preferência (Senado): prefere art. da redação final aprovada pelo Senado
    // sobre o art. correspondente no substitutivo da Câmara.
    // Ex: "Destaque de Preferência para o art. 30, constante na redação final aprovada
    // pelo Senado Federal, com vistas a sua aprovação e inclusão no substitutivo apresentado
    // pelo Relator ao PL 3278/2021"
    const isDestaquePreferencia = /destaque\s+de\s+prefer[êe]ncia/i.test(descricao)
      && /(reda[çc][ãa]o\s+final|senado)/i.test(descricao);

    // Substitutivo adotado por comissão: "substitutivo adotado pela CCJC/CFT/..."
    const isSubstColegiado = !isDestaquePreferencia
      && /substitutivo\s+adotado|emenda\s+adotada/i.test(descricao);

    // SSP de plenário: subemenda substitutiva (não é de comissão)
    const isDVSSubstitutivo = !isDestaquePreferencia
      && /subst|submenda|subemenda/i.test(descricao) && !isSubstColegiado;

    // Emenda específica numerada
    const isEmendaEspecifica = !isDestaquePreferencia
      && /\bemenda\b/i.test(descricao) && !isDVSSubstitutivo && !isSubstColegiado;

    // DVS/DTQ de dispositivo do PL original (não classificado nos casos acima)
    // Ex: "Destaque para Votação em Separado do inciso II do art. 19 do PL 3278/2021, com fins de supressão"
    const isDVSPLOriginal = !!referenciaLeg
      && !isDestaquePreferencia
      && !isSubstColegiado
      && !isDVSSubstitutivo
      && !isEmendaEspecifica
      && /destaque|dvs|dtq|separado|supress|suprim/i.test(descricao);

    console.log('[IA] tipo: colegiado=', isSubstColegiado, '| SSP=', isDVSSubstitutivo,
                '| emenda=', isEmendaEspecifica, '| pl_orig=', isDVSPLOriginal,
                '| pref_senado=', isDestaquePreferencia, '| ref=', referenciaLeg);

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
        console.log('[IA] Caso 0: buscando documento adotado:', linkAdotado);
        const info = await buscarDocumento(linkAdotado, { tipo: 'substitutivo', numArtigo, referenciaLeg });
        if (info) return info;
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

          // Helper: extrai codteor da URL (IDs são sequenciais → maior = mais recente)
          const extraiCodteor = href => {
            const m = (href || '').match(/codteor=(\d+)/i);
            return m ? parseInt(m[1], 10) : 0;
          };
          const escolheMaisRecente = candidatos => {
            if (!candidatos.length) return null;
            candidatos.sort((a, b) => b.codteor - a.codteor);
            if (candidatos.length > 1) {
              console.log(`[IA] Caso 1a: ${candidatos.length} candidatos — usando codteor=${candidatos[0].codteor} (mais recente)`);
            }
            return resolverUrlCamara(candidatos[0].href);
          };

          // 1ª tentativa: links cujo filename casa com SBT ou PRLP (padrão Câmara)
          const cand1 = [];
          for (const a of docPar1a.querySelectorAll('a[href*="prop_mostrarintegra"], a[href*="codteor"]')) {
            const href = a.getAttribute('href') || '';
            if (/filename[=+%]*(SBT|PRLP)/i.test(href)) {
              cand1.push({ href, codteor: extraiCodteor(href) });
            }
          }
          link1a = escolheMaisRecente(cand1);

          // 2ª tentativa: linha que contém "substitut" mas NÃO só "parecer" — evita Parecer do Relator
          if (!link1a) {
            const cand2 = [];
            for (const row of docPar1a.querySelectorAll('tr, li, p')) {
              const txt = row.textContent;
              if (/substitut/i.test(txt) && !/^\s*parecer\s*$/i.test(txt)) {
                const a = row.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
                if (a) {
                  const href = a.getAttribute('href') || '';
                  cand2.push({ href, codteor: extraiCodteor(href) });
                }
              }
            }
            link1a = escolheMaisRecente(cand2);
          }

          // 3ª tentativa: qualquer linha com "relator" + link (última opção)
          if (!link1a) {
            const cand3 = [];
            for (const row of docPar1a.querySelectorAll('tr, li, p')) {
              if (/relator/i.test(row.textContent)) {
                const a = row.querySelector('a[href*="prop_mostrarintegra"], a[href*="codteor"]');
                if (a) {
                  const href = a.getAttribute('href') || '';
                  cand3.push({ href, codteor: extraiCodteor(href) });
                }
              }
            }
            link1a = escolheMaisRecente(cand3);
          }

          console.log('[IA] Caso 1a link:', link1a);
          if (link1a) {
            const info = await buscarDocumento(link1a, { tipo: 'substitutivo', numArtigo, referenciaLeg });
            if (info) return info;
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
          console.log('[IA] Caso 1b: buscando SSP:', linkSSP);
          const info = await buscarDocumento(linkSSP, { tipo: 'substitutivo', numArtigo, referenciaLeg });
          if (info) return info;
          console.warn('[IA] Caso 1b: SSP fetch falhou.');
        }
      }
    }

    // ── CASO 4: Destaque de Preferência ─────────────────────────────
    // Exige upload manual de 2 PDFs (o texto que recebe preferência + o texto
    // a ser comparado). A busca automática é frágil pois os documentos podem
    // estar em locais variados (tramitações, pareceres com nomes diferentes).
    // Retorna sinal específico para que gerarExplicacaoIA mostre toast claro.
    if (isDestaquePreferencia) {
      console.log('[IA] Caso 4: Destaque de Preferência — aguardando upload manual de 2 PDFs');
      return { tipo: 'destaque_preferencia_manual', referenciaLeg };
    }

    // ── CASO 3: DVS/DTQ de dispositivo do PL original ────────────────
    // 1º tenta PDF do próprio destaque (d.urlLink): contém transcrição literal
    // do dispositivo + justificativa do partido. Fallback: urlInteiroTeor.
    if (isDVSPLOriginal) {
      console.log('[IA] Caso 3: DVS de dispositivo do PL original');
      const infoBase = { tipo: 'pl_original', numArtigo, numInciso, numPar, referenciaLeg };

      if (d.urlLink) {
        const info = await buscarDocumento(d.urlLink, infoBase);
        if (info) return info;
      }

      try {
        const respApi = await fetch(`${API_BASE}/proposicoes/${prop.idCamara}`);
        if (respApi.ok) {
          const json = await respApi.json();
          const urlInteiroTeor = json?.dados?.urlInteiroTeor;
          if (urlInteiroTeor) {
            const info = await buscarDocumento(urlInteiroTeor, infoBase);
            if (info) return info;
          }
        }
      } catch (e) {
        console.warn('[IA] Caso 3 — fetch da API falhou:', e);
      }

      console.warn('[IA] Caso 3 falhou — documento não encontrado.');
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
        console.log('[IA] Caso 2: buscando emenda em:', linkAlvo);
        const info = await buscarDocumento(linkAlvo, { tipo: 'emenda' });
        if (info) return info;
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
  ['ia-manual-texto', 'ia-manual-pdf', 'ia-manual-pdf-pref', 'ia-manual-pdf-comp']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  mostrarToast('Entrada manual limpa.', 'info');
}

/** Retorna a entrada manual do usuário como infoEmenda, ou null se vazia.
 *  - Destaque de Preferência: 2 PDFs (preferência + comparado)
 *  - Demais casos: PDF único OU texto colado (PDF tem prioridade) */
async function lerEntradaManual() {
  // Modo Destaque de Preferência: lê os 2 inputs específicos
  const pdfPref = document.getElementById('ia-manual-pdf-pref');
  const pdfComp = document.getElementById('ia-manual-pdf-comp');
  if (pdfPref || pdfComp) {
    let pdfPreferencia = null, pdfComparado = null;
    try {
      if (pdfPref?.files?.length > 0) {
        pdfPreferencia = await pdfPref.files[0].arrayBuffer();
        console.log('[IA][manual] PDF preferência:', pdfPref.files[0].name, pdfPreferencia.byteLength, 'bytes');
      }
      if (pdfComp?.files?.length > 0) {
        pdfComparado = await pdfComp.files[0].arrayBuffer();
        console.log('[IA][manual] PDF comparado:', pdfComp.files[0].name, pdfComparado.byteLength, 'bytes');
      }
    } catch (e) {
      console.warn('[IA][manual] erro ao ler PDFs de preferência:', e);
    }
    if (pdfPreferencia || pdfComparado) {
      return {
        tipo: 'destaque_preferencia',
        pdfPreferencia,
        pdfComparado,
        referenciaLeg: null,
      };
    }
    // Inputs existiam mas estavam vazios → cai pelo fluxo abaixo (que provavelmente
    // também retornará null porque os inputs antigos nem estão no DOM)
  }

  const pdfInput   = document.getElementById('ia-manual-pdf');
  const textoInput = document.getElementById('ia-manual-texto');

  // PDF anexado tem prioridade máxima
  if (pdfInput?.files?.length > 0) {
    const file = pdfInput.files[0];
    console.log('[IA][manual] PDF selecionado:', file.name, file.size, 'bytes');
    try {
      const pdfBuffer = await file.arrayBuffer();
      return { pdfBuffer, tipo: 'substitutivo', numArtigo: null, referenciaLeg: null };
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

/** Chama o provedor de IA ativo e retorna {votoSim, votoNao, explicacao}.
 *  Normaliza infoEmenda em array de PDFs (0, 1 ou 2) e delega construção
 *  da request ao provedor. JSON.parse tolerante com fallback para texto puro. */
async function gerarAnalise({ prompt, infoEmenda, modelo, apiKey, provedorId = 'gemini' }) {
  const provedor = PROVEDORES[provedorId];
  if (!provedor) throw new Error(`Provedor desconhecido: ${provedorId}`);

  // Fallback: usuário trocou de provedor sem escolher modelo no select
  const modeloEfetivo = (modelo && modelo.trim()) || provedor.modelosFallback?.[0]?.id;
  if (!modeloEfetivo) throw new Error(`Nenhum modelo disponível para ${provedor.label}.`);

  const pdfs = [];
  if (infoEmenda?.tipo === 'destaque_preferencia') {
    if (infoEmenda.pdfPreferencia) pdfs.push({ buffer: infoEmenda.pdfPreferencia, mimeType: 'application/pdf' });
    if (infoEmenda.pdfComparado)   pdfs.push({ buffer: infoEmenda.pdfComparado,   mimeType: 'application/pdf' });
  } else if (infoEmenda?.pdfBuffer) {
    pdfs.push({ buffer: infoEmenda.pdfBuffer, mimeType: 'application/pdf' });
  }

  const { url, headers, body } = provedor.montarRequest({ prompt, pdfs, modelo: modeloEfetivo, apiKey });
  console.log(`[IA] request ${provedor.label}: ${pdfs.length} PDF(s) + ${prompt.length} chars de prompt`);

  const res  = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(provedor.extrairErro(json, res.status));

  const textoRaw = provedor.extrairTexto(json);
  if (!textoRaw) throw new Error('Resposta vazia da IA.');

  try {
    return JSON.parse(textoRaw);
  } catch (_) {
    // Fallback tolerante: extrai primeiro objeto JSON (útil para fences ```json)
    const match = textoRaw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_) {}
    }
    return { votoSim: '', votoNao: '', explicacao: textoRaw };
  }
}

async function gerarExplicacaoIA() {
  const d    = app.destinqueAtivo;
  const prop = app.proposicaoAtiva;
  if (!d || !prop) return;

  const key = app.config.apiKey;
  if (!key) {
    mostrarToast('Configure a chave de API em ⚙ Configurações.', 'aviso');
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
      if (infoEmenda.tipo === 'destaque_preferencia') {
        const partes = [];
        if (infoEmenda.pdfPreferencia) partes.push(`preferência ${(infoEmenda.pdfPreferencia.byteLength / 1024).toFixed(0)} KB`);
        if (infoEmenda.pdfComparado)   partes.push(`comparado ${(infoEmenda.pdfComparado.byteLength / 1024).toFixed(0)} KB`);
        mostrarToast(`✓ PDFs de preferência (${partes.join(' + ')}) — enviando ao ${PROVEDORES[app.config.provedor]?.label || 'IA'}`, 'sucesso');
      } else if (infoEmenda.pdfBuffer) {
        mostrarToast(`✓ PDF manual (${(infoEmenda.pdfBuffer.byteLength / 1024).toFixed(0)} KB) — enviando ao ${PROVEDORES[app.config.provedor]?.label || 'IA'}`, 'sucesso');
      } else {
        mostrarToast(`✓ Texto manual (${(infoEmenda.textoCompleto || '').length} chars)`, 'sucesso');
      }
      console.log('[IA] usando entrada manual, tipo:', infoEmenda.tipo);
    } else {
      // 2. Busca automática
      infoEmenda = await buscarTextoEmenda(d, prop);
      if (infoEmenda?.textoCompleto) {
        mostrarToast(`✓ Texto extraído (${infoEmenda.textoCompleto.length} chars, tipo: ${infoEmenda.tipo})`, 'sucesso');
        console.log('[IA] TEXTO ENVIADO À IA (primeiros 600):\n', infoEmenda.textoCompleto.slice(0, 600));
      } else if (infoEmenda?.pdfBuffer) {
        mostrarToast(`✓ PDF capturado (${(infoEmenda.pdfBuffer.byteLength / 1024).toFixed(0)} KB) — enviando ao ${PROVEDORES[app.config.provedor]?.label || 'IA'}`, 'sucesso');
        console.log('[IA] PDF inline_data pronto:', infoEmenda.pdfBuffer.byteLength, 'bytes | referência:', infoEmenda.referenciaLeg);
      } else if (infoEmenda?.tipo === 'destaque_preferencia_manual') {
        mostrarToast('⚠ Destaque de Preferência: anexe os 2 PDFs (preferência + comparado) na entrada manual.', 'aviso');
        if (btn) {
          btn.disabled  = false;
          btn.innerHTML = `${iconeIA} Gerar Análise`;
        }
        return;
      } else {
        mostrarToast('⚠ Sem texto da emenda — IA usará conhecimento geral', 'aviso');
      }
    }

    if (btn) btn.innerHTML = `<span class="loading-spinner"></span> Gerando análise...`;

    const prompt    = montarPrompt(d, prop, infoEmenda);
    const resultado = await gerarAnalise({
      prompt,
      infoEmenda,
      modelo:     app.config.modelo,
      apiKey:     key,
      provedorId: app.config.provedor || 'gemini',
    });

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
    console.error('Erro IA:', err);
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
  const temTexto         = !!(infoEmenda?.textoCompleto);
  const temPDFInline     = !!(infoEmenda?.pdfBuffer);          // PDF único inline
  const isPreferencia    = infoEmenda?.tipo === 'destaque_preferencia';
  const temPDFPreferencia = !!(infoEmenda?.pdfPreferencia);
  const temPDFComparado   = !!(infoEmenda?.pdfComparado);
  const tem2PDFs         = isPreferencia && (temPDFPreferencia || temPDFComparado);
  // Referência legislativa: "Artigo 20", "Capítulo VIII", "Título III", etc.
  const referenciaLeg = infoEmenda?.referenciaLeg || (infoEmenda?.numArtigo ? `Artigo ${infoEmenda.numArtigo}` : null);

  // Nome amigável do tipo de documento (independente de ser PDF ou texto)
  const tipoDoc = infoEmenda?.tipo === 'emenda'      ? 'EMENDA'
               : infoEmenda?.tipo === 'substitutivo' ? 'SUBSTITUTIVO'
               : infoEmenda?.tipo === 'pl_original'  ? 'PROJETO DE LEI ORIGINAL'
               : isPreferencia                       ? 'DESTAQUE DE PREFERÊNCIA'
               : 'DOCUMENTO';

  const blocoFonte = temTexto ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOCUMENTO FONTE — TEXTO DO ${tipoDoc}
Leia atentamente antes de responder. Sua análise deve ser baseada EXCLUSIVAMENTE neste texto.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${infoEmenda.textoCompleto}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIM DO DOCUMENTO FONTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : '';

  // ── Instrução de base para a tarefa ──────────────────────────────────
  const instrucaoBase = tem2PDFs
    ? `com base EXCLUSIVAMENTE nos PDFs anexados — NÃO use conhecimento prévio, treinamento ou informações externas`
    : temPDFInline
      ? `com base EXCLUSIVAMENTE no PDF do ${tipoDoc} fornecido nesta mensagem — NÃO use conhecimento prévio, treinamento ou informações externas ao PDF`
      : temTexto
        ? 'EXCLUSIVAMENTE no documento fonte acima — NÃO use conhecimento prévio, treinamento ou informações externas ao texto fornecido'
        : 'no seu conhecimento sobre este projeto';

  // ── Aviso de PDF inline (aparece antes da tarefa) ────────────────────
  const avisPDF = tem2PDFs ? `
DESTAQUE DE PREFERÊNCIA — comparação entre dois textos.
${temPDFPreferencia ? '1) PDF nº 1 (anexado primeiro) — TEXTO QUE RECEBE A PREFERÊNCIA no destaque. É o texto cuja redação se quer prevalecer.\n' : ''}${temPDFComparado ? '2) PDF nº 2 (anexado em seguida) — TEXTO A SER COMPARADO com o do destaque. É a redação que seria substituída/preterida caso a preferência seja aprovada.\n' : ''}Leia integralmente os PDFs antes de responder e identifique as diferenças entre as duas redações${referenciaLeg ? ` do ${referenciaLeg.toUpperCase()}` : ''}.
` : temPDFInline ? `
O arquivo PDF anexado a esta mensagem é o texto integral do ${tipoDoc} referenciado no destaque. Leia o PDF integralmente antes de responder.
` : '';

  // ── Regra crítica da explicação ──────────────────────────────────────
  const fonteRef     = tem2PDFs ? 'PDFs anexados' : temPDFInline ? 'PDF anexado' : 'documento fonte acima';
  const temFonte     = temTexto || temPDFInline || tem2PDFs;
  const isPLOriginal = infoEmenda?.tipo === 'pl_original';
  const isSubstitutivo = infoEmenda?.tipo === 'substitutivo';
  const isEmenda     = infoEmenda?.tipo === 'emenda';
  const eSupressivo  = isPLOriginal && /supress|suprim/i.test(d.descricao || '');
  const regraExplicacao = !temFonte
    ? `
REGRA CRÍTICA — SEM DOCUMENTO FONTE:
→ Nenhum documento foi anexado/extraído para este destaque.
→ Se a descrição menciona um dispositivo específico (artigo/inciso/§/capítulo) e você NÃO tem certeza absoluta do conteúdo desse dispositivo no projeto original, retorne em "explicacao": "⚠ Texto do dispositivo não disponível. Cole o texto manualmente para análise precisa."
→ É preferível admitir falta de informação a alucinar dispositivos inexistentes.
→ NÃO invente conteúdo normativo, números de artigos, incisos ou parágrafos.`
    : tem2PDFs
    ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO (Destaque de Preferência — comparação entre dois textos):
→ Você recebeu DOIS PDFs. O PDF nº 1 é o TEXTO QUE RECEBE A PREFERÊNCIA (redação que se quer prevalecer). O PDF nº 2 é o TEXTO A SER COMPARADO (redação que seria substituída/preterida).
${referenciaLeg ? `→ Localize EXATAMENTE o ${referenciaLeg.toUpperCase()} em AMBOS os PDFs.\n` : '→ Localize o(s) dispositivo(s) destacado(s) em AMBOS os PDFs.\n'}→ Sua "explicacao" deve: (a) descrever o conteúdo normativo concreto do texto que recebe a preferência (PDF nº 1) — o que determina/autoriza/proíbe, quem é afetado, condições e exceções; (b) apontar as DIFERENÇAS em relação ao texto comparado (PDF nº 2) — o que muda, o que se acrescenta, o que se suprime; (c) usar verbos normativos como "estabelece", "determina", "autoriza", "proíbe", "veda", "exige".
${temPDFPreferencia && temPDFComparado ? '' : temPDFPreferencia
  ? '→ Apenas o PDF nº 1 (que recebe preferência) foi anexado. Descreva apenas o conteúdo desse texto; informe na própria explicação que o PDF comparativo não foi anexado.\n'
  : '→ Apenas o PDF nº 2 (a comparar) foi anexado. Descreva apenas o conteúdo desse texto; informe na própria explicação que o PDF da preferência não foi anexado.\n'}→ Se NÃO conseguir localizar o dispositivo nos PDFs anexados, retorne em "explicacao": "⚠ Dispositivo não localizado nos PDFs anexados. Verifique se os arquivos corretos foram enviados."
→ NÃO invente, NÃO infira, NÃO use conhecimento externo aos PDFs anexados.`
    : isPLOriginal && referenciaLeg
    ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO (DVS de dispositivo do PL original):
→ Este destaque trata especificamente do ${referenciaLeg.toUpperCase()} do projeto original.
→ Localize EXATAMENTE o ${referenciaLeg.toUpperCase()} no ${fonteRef}.
→ Descreva o conteúdo normativo concreto desse dispositivo: o que determina/autoriza/proíbe/regula, quem é afetado, quais condições e exceções existem.
→ Use verbos normativos: "estabelece", "determina", "autoriza", "proíbe", "veda", "exige".
${eSupressivo ? '→ O destaque é SUPRESSIVO: descreva o conteúdo atual do dispositivo, deixando claro que o destaque propõe REMOVÊ-LO do projeto.\n' : ''}→ Se NÃO conseguir localizar o ${referenciaLeg.toUpperCase()} no ${fonteRef}, retorne em "explicacao": "⚠ Dispositivo ${referenciaLeg} não localizado no texto do PL. Cole o texto manualmente para análise precisa."
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao ${fonteRef}.`
    : isSubstitutivo && referenciaLeg
    ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO:
→ ATENÇÃO: o ${fonteRef} pode conter o PARECER DO RELATOR (texto narrativo, análise, justificativa) seguido do SUBSTITUTIVO (texto normativo do projeto). Ignore integralmente a parte narrativa do parecer e analise APENAS o texto do substitutivo. O substitutivo geralmente começa após um cabeçalho como "SUBSTITUTIVO", "SUBSTITUTIVO AO PROJETO DE LEI" ou "PROJETO DE LEI Nº .../...".
→ Localize o ${referenciaLeg.toUpperCase()} dentro do texto do substitutivo (não nas considerações do relator).
→ Descreva EXATAMENTE o que esse trecho diz: quem é afetado, o que é autorizado/proibido/determinado, quais condições e exceções existem.
→ Cada frase deve descrever um aspecto concreto do conteúdo normativo desse trecho.
→ Se o ${referenciaLeg.toUpperCase()} aparecer apenas no parecer (citado pelo relator) mas NÃO existir no texto do substitutivo, retorne em "explicacao": "⚠ ${referenciaLeg.toUpperCase()} não encontrado no texto do substitutivo. Cole o texto manualmente para análise precisa."
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao ${fonteRef}.`
    : isEmenda
    ? `
REGRA CRÍTICA PARA A EXPLICAÇÃO:
→ PRIORIDADE 1 — Se o documento contiver uma seção "JUSTIFICATIVA" (ou "Justificação"): baseie a explicação PRINCIPALMENTE nessa seção, pois ela articula diretamente os objetivos e efeitos práticos da emenda
→ PRIORIDADE 2 — Se não houver seção de justificativa: analise o DISPOSITIVO (corpo normativo) e descreva o que o texto da lei PASSA A DIZER ou DEIXA DE DIZER — novas proibições, direitos, obrigações, supressões
→ Mencione artigos/incisos afetados quando relevante e use verbos normativos: "proíbe", "determina", "veda", "amplia", "suprime", "restringe"
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao ${fonteRef}`
    : `
REGRA CRÍTICA PARA A EXPLICAÇÃO:
→ Cite APENAS o que está ESCRITO no ${fonteRef}
→ Para cada alteração, identifique o artigo/inciso e descreva o que o texto PASSOU A DIZER
→ Use verbos concretos: "passa a proibir", "determina que", "veda", "amplia", "suprime", "restringe"
→ NÃO invente, NÃO infira, NÃO use conhecimento externo ao ${fonteRef}`;

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
