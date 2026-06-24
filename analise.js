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
  document.getElementById('btn-salvar-firebase').addEventListener('click', salvarPautaManual);
  document.getElementById('btn-configuracoes').addEventListener('click', abrirConfig);
  document.getElementById('btn-adicionar-item').addEventListener('click', abrirModalAdicionar);
  document.getElementById('btn-gerar-todas').addEventListener('click', toggleGerarTodas);
  document.getElementById('btn-parar-todas').addEventListener('click', pararTodasAnalises);
  document.getElementById('btn-confirmar-adicionar').addEventListener('click', confirmarAdicionar);
  document.getElementById('btn-confirmar-remover').addEventListener('click', confirmarRemover);
  document.getElementById('btn-confirmar-apagar-pauta').addEventListener('click', confirmarApagarPauta);
  document.getElementById('busca-itens').addEventListener('input', aplicarBuscaItens);

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
    document.getElementById('btn-salvar-firebase').disabled = false;
    document.getElementById('btn-adicionar-item').disabled = false;
    document.getElementById('btn-gerar-todas').disabled = false;
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
  document.getElementById('pauta-titulo').textContent = state.pauta.titulo;
  document.getElementById('pauta-meta').textContent =
    `${state.pauta.itens.length} itens · carregada em ${formatDataHora(state.pauta.uploadedAt)}`;

  const cont = document.getElementById('lista-itens');
  cont.innerHTML = '';

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
}

function renderCard(it) {
  const isRF = it.tipoCategoria === 'redacao_final';
  const card = document.createElement('div');
  card.className = 'an-card';
  card.dataset.chave = it.chave;
  card.innerHTML = `
    <div class="an-card-head">
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
      <a class="btn btn-outline btn-sm" data-role="link-portal" target="_blank" rel="noopener" style="display:none" title="Abrir página da proposição na Câmara dos Deputados">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Ver no portal
      </a>
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
        <button class="btn btn-outline btn-sm" data-role="btn-regerar">Regerar</button>
      </div>
      <div class="an-analise-conteudo" data-role="analise-conteudo"></div>
      <textarea class="an-analise-textarea" data-role="analise-editor" style="display:none"></textarea>
    </div>
  `;

  card.querySelector('[data-role=btn-gerar]').addEventListener('click', () => gerarAnaliseItem(it));
  card.querySelector('[data-role=btn-regerar]').addEventListener('click', () => gerarAnaliseItem(it, true));
  card.querySelector('[data-role=btn-reanalisar]').addEventListener('click', () => abrirModalReanalise(it));
  card.querySelector('[data-role=btn-toggle]').addEventListener('click', () => {
    const painel = card.querySelector('[data-role=painel-analise]');
    painel.classList.toggle('aberto');
  });
  card.querySelector('[data-role=btn-remover]').addEventListener('click', () => abrirModalRemover(it));
  card.querySelector('[data-role=btn-editar]').addEventListener('click', () => entrarEdicaoAnalise(it));
  card.querySelector('[data-role=btn-salvar-edicao]').addEventListener('click', () => salvarEdicaoAnalise(it));
  card.querySelector('[data-role=btn-cancelar-edicao]').addEventListener('click', () => sairEdicaoAnalise(it));
  card.querySelector('[data-role=btn-completar]').addEventListener('click', () => completarAnalise(it));
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
    atualizarLinkPortal(it);

    // Autoria principal
    etapa = 'autores';
    const autores = await fetchAutoresProposicao(prop.id);
    it.enriquecimento.autores = autores;
    it.enriquecimento.autoriaPodemos = autores.some(a => a.isPodemos);

    // Apensados via API
    etapa = 'apensados';
    const apensados = await fetchApensados(prop.id);
    // Para cada apensado, verificar autoria
    for (const ap of apensados) {
      try {
        const aps = await fetchAutoresProposicao(ap.id);
        ap.autores = aps;
        ap.autoriaPodemos = aps.some(a => a.isPodemos);
      } catch (e) {
        ap.autoriaPodemos = false;
      }
    }
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
      it.enriquecimento.pareceresPlenario = { comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null };
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

  // Busca detalhe para pegar urlInteiroTeor
  const det = await fetchJson(`${API_BASE}/proposicoes/${hit.id}`);
  const obj = {
    id:             hit.id,
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
        isPodemos:  (info?.siglaPartido === SIGLA_PODEMOS),
      });
    } else {
      out.push({ nome: a.nome, tipo: a.tipo, isPodemos: false });
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
  // Filtra apenas relações de apensamento
  const rel = (json.dados || []).filter(r => {
    const txt = `${r.codTipoRelacionado || ''} ${r.descricaoRelacao || ''} ${r.descricao || ''}`.toLowerCase();
    return txt.includes('apens');
  });
  return rel.map(r => ({
    id:          r.id,
    siglaTipo:   r.siglaTipo,
    numero:      r.numero,
    ano:         r.ano,
    ementa:      r.ementa,
  }));
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
  if (!html) return { comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null };

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

    candidatos.push({
      sigla:      siglaMatch[1].toUpperCase(),
      sequencial: parseInt(siglaMatch[2], 10),
      comissao,
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
    if ((c.sigla !== 'PAR' && c.sigla !== 'PRL') || !c.comissao) continue;
    const prev = porComissao.get(c.comissao);
    if (!prev || (c.sigla === 'PRL' && prev.sigla !== 'PRL')) porComissao.set(c.comissao, c);
  }
  const comissoes = Array.from(porComissao.values())
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  return {
    comissoes,
    prlp:      candidatos.find(c => c.sigla === 'PRLP')  || null,
    prle:      candidatos.find(c => c.sigla === 'PRLE')  || null,
    sbtA:      candidatos.find(c => c.sigla === 'SBT-A') || null,
    autografo: candidatos.find(c => c.sigla === 'AA')    || null,
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
    flag.textContent = '★ Autoria Podemos';
  } else {
    flag.className = 'an-badge an-badge--neutro';
    flag.textContent = 'Autoria: não-Podemos';
  }

  // Atualiza a linha "Autor:" com o nome do(s) deputado(s) do Podemos em
  // negrito + sublinhado (o card inicial é renderizado antes do enriquecimento).
  const autorLinha = card.querySelector('[data-role=autor-linha]');
  if (autorLinha && (it.autorTexto || (enr.autores || []).length)) {
    autorLinha.innerHTML = `<b>Autor:</b> ${htmlAutorRealcado(it)}`;
  }

  // Apensados Podemos
  for (const ap of (enr.apensadosPodemos || [])) {
    const auts = (ap.autores || []).filter(a => a.isPodemos).map(a => a.nome).join(', ');
    const badge = document.createElement('span');
    badge.className = 'an-badge an-badge--apens';
    badge.dataset.role = 'badge-extra';
    badge.textContent = `Apensado Podemos: ${ap.siglaTipo} ${ap.numero}/${ap.ano}${auts ? ' — ' + auts : ''}`;
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
  const [lista, dados] = await Promise.all([carregarDeputadosPodemos(), fbCarregarTemasInteresse()]);
  state.interesse = { lista, dados: dados || {}, carregado: true };
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
function deputadosComInteresse(it) {
  return it.analise?.interessados || [];
}

function atualizarTodosBadgesInteresse() {
  for (const it of (state.pauta?.itens || [])) atualizarBadgesCard(it);
}

function renderInteresseConfig() {
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
    <div class="form-group" style="margin-bottom:14px;border-bottom:1px solid var(--border-soft);padding-bottom:12px">
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

// ============================================================
//  GERAÇÃO DE ANÁLISE VIA IA
// ============================================================
async function gerarAnaliseItem(it, forcar = false, opts = {}) {
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
    let interessados = [];
    try {
      interessados = await determinarInteressados(it, {
        provedorId: state.config.provedor || 'gemini',
        apiKey:     state.config.apiKey,
        modelo:     state.config.modelo,
      });
    } catch (e) { if (isAbortError(e)) throw e; console.warn('Interesse falhou:', e.message); }

    it.analise = {
      markdown,
      truncada:    truncated,
      provedor:    state.config.provedor || 'gemini',
      modelo:      state.config.modelo,
      documentos:  docs.map(d => ({ tipo: d.tipo, rotulo: d.rotulo, url: d.url })),
      cenario:     it.tipoCategoria === 'projeto' ? classificarCenario(docs) : '',
      apelido:     apelido || it.apelido || '',
      interessados,
      geradoEm:    new Date().toISOString(),
      geradoPor:   state.config?.nomeUsuario || 'equipe',
      parecerKey:  parecerKey(it),
      promptCustom: promptNome || null,
      refsSuspeitas,
    };
    it.analiseStatus = 'ok';

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
  if (has('EMS'))                      return has('PRLP') ? 'Cenário 7 — EMS + parecer do relator' : 'Cenário 6 — retorno do Senado (EMS)';
  if (has('SSP'))                      return 'Cenário 5 — subemenda substitutiva (SSP)';
  if (has('PRLP') && has('SBT_A'))     return 'Cenário 4 — PRLP na forma do SBT-A';
  if (has('SBT_A'))                    return 'Cenário 2 — substitutivo de comissão (SBT-A)';
  if (has('PRLP') || has('PRLE'))      return 'Cenário 3 — parecer de plenário (PRLP)';
  if (has('INTEIRO_TEOR') || has('REDACAO_ORIGINAL')) return 'Cenário 1 — inteiro teor (sem parecer)';
  return '';
}

async function escolherDocumentos(it) {
  const enr  = it.enriquecimento || {};
  const docs = [];

  if (it.tipoCategoria === 'projeto') {
    const par = enr.pareceresPlenario || {};

    // Emendas do Senado (EMS) e Subemenda Substitutiva (SSP) vivem na página de
    // emendas — busca sob demanda (só ao gerar), com cache no próprio item.
    if (enr.emendasSenado === undefined && enr.idProposicao) {
      try { enr.emendasSenado = await buscarEmendasSenadoESSP(enr.idProposicao); }
      catch (e) { console.warn('Falha ao buscar EMS/SSP:', e.message); enr.emendasSenado = { ems: null, ssp: null }; }
    }
    const { ems = null, ssp = null } = enr.emendasSenado || {};

    const rotuloPRLP = par.prlp && `PRLP${par.prlp.sequencial ? ' nº ' + par.prlp.sequencial : ''}${par.prlp.dataBR ? ' de ' + par.prlp.dataBR : ''}`;
    const rotuloPRLE = par.prle && `PRLE${par.prle.sequencial ? ' nº ' + par.prle.sequencial : ''}${par.prle.dataBR ? ' de ' + par.prle.dataBR : ''}`;
    const rotuloSBTA = par.sbtA && `Substitutivo adotado por comissão (SBT-A${par.sbtA.sequencial ? ' nº ' + par.sbtA.sequencial : ''}${par.sbtA.comissao ? ' — ' + par.sbtA.comissao : ''}${par.sbtA.dataBR ? ' de ' + par.sbtA.dataBR : ''})`;
    const rotuloEMS  = ems && `Emendas do Senado (EMS)${ems.dataBR ? ' de ' + ems.dataBR : ''}`;
    const rotuloSSP  = ssp && `Subemenda Substitutiva de Plenário (SSP)${ssp.dataBR ? ' de ' + ssp.dataBR : ''}`;

    if (ems) {
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
    // substitutivos entre si e isole a contribuição de cada comissão.
    const comissoesCron = [...(par.comissoes || [])].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    for (const pc of comissoesCron) {
      docs.push({
        tipo: 'PARECER_COMISSAO',
        rotulo: `Parecer da Comissão ${pc.comissao}${pc.dataBR ? ' de ' + pc.dataBR : ''}`,
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
  const docsApensado = docs.filter(d => d.tipo === 'APENSADO_PODEMOS');
  const plApens = docsApensado.length > 1;
  const secaoApensados = docsApensado.length
    ? `\n## Projeto${plApens ? 's' : ''} apensado${plApens ? 's' : ''} de autoria do Podemos\n${plApens ? 'Para cada' : 'Para o'} documento "Apensado do Podemos ..." anexado, dedique **um parágrafo** com um **breve resumo** do projeto apensado: identifique a proposição (sigla, número/ano) e o(s) deputado(s) do Podemos que a assina(m), descreva seu objeto e o que propõe criar/alterar, e indique como ela se relaciona com a matéria principal em votação. Baseie-se exclusivamente no inteiro teor anexado do apensado, sem confundi-lo com o texto operativo principal.\n`
    : '';

  // Redação Final tem prompt próprio, mais enxuto: o documento já é o texto
  // final consolidado, não há parecer a resumir. O foco é o que se está
  // efetivamente votando e os pontos de atenção para a bancada.
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
## Pontos de atenção para o Podemos
Um parágrafo sobre as implicações específicas para a bancada, considerando o contexto político informado. Se não houver autoria Podemos nem apensado Podemos, mencione brevemente posicionamentos prováveis.
${instrucoesExtra && instrucoesExtra.trim()
  ? `\nINSTRUÇÕES ADICIONAIS DO(A) ASSESSOR(A) (têm prioridade quanto à ênfase, à profundidade e aos recortes temáticos da análise, mas NÃO substituem a estrutura de seções acima nem as REGRAS RÍGIDAS abaixo):\n${instrucoesExtra.trim()}\n`
  : ''}
REGRAS RÍGIDAS:
- Use apenas informação contida no documento anexo. Não invente fatos.
- Se uma informação solicitada não constar no documento, escreva explicitamente "não consta no documento" em vez de supor ou recorrer a conhecimento externo.
- Não invente números de lei, artigos, decretos, datas, valores ou nomes. Só cite um dispositivo (lei, decreto, emenda, artigo) se ele aparecer literalmente no documento anexo.
- NÃO inclua recomendação de voto (favorável/contrário/abstenção).
- **NÃO use bullets, listas, "-", "*" ou numeração.** Toda a análise deve ser escrita em parágrafos corridos.
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
    ? `\n## Pareceres das comissões\nPara cada comissão por onde a proposição tramitou (documentos "Parecer da Comissão ..." anexados), em **ordem cronológica de tramitação**, dedique **um parágrafo**. Indique a comissão, o(a) relator(a), a conclusão e — foco principal — **o que aquela comissão alterou em relação ao texto que recebeu** (a redação original, na primeira comissão, ou o substitutivo da comissão anterior): aponte os dispositivos que ela acrescentou, alterou ou suprimiu. Compare os pareceres/substitutivos entre si para isolar a contribuição específica de cada comissão e NÃO repita o conteúdo já descrito para as comissões anteriores. Se uma comissão apenas aprovou sem mudanças de mérito, registre que aprovou na forma do texto recebido. Baseie-se exclusivamente nos documentos anexados.\n`
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
  } else {
    cenarioHint = `A proposição não tem parecer preliminar de plenário nem substitutivo de comissão adotado. Traga o conteúdo do projeto original.`;
  }

  // Título da seção de disposições — adaptado ao que está efetivamente em
  // votação (evita afirmar "substitutivo" quando não há nenhum anexado).
  let tituloDisposicoes;
  if (hasEMS) {
    tituloDisposicoes = 'Principais Disposições do texto em votação (emendas do Senado)';
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
Dois parágrafos corridos: o primeiro reúne os argumentos que sustentam a aprovação; o segundo, os que sustentam a rejeição. **Apresente SEMPRE os dois lados**, ainda que os documentos tragam apenas um. **Nesta seção (e apenas nela) você pode recorrer a conhecimento geral e ao contexto do tema** para construir argumentos plausíveis — inclusive contra-argumentos que não constem nos documentos. Não escreva "não constam argumentos contrários": elabore os contrapontos prováveis a partir do mérito, dos impactos e dos interesses afetados. Ainda assim, não invente fatos sobre o conteúdo do documento (números de lei, dispositivos ou dados) e apresente cada argumento como opinião/ponderação, não como fato.
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
- Escreva em **parágrafos corridos**, SEM bullets ou listas, EXCETO quando estiver enumerando dispositivos ou emendas (ex.: emendas do Senado, ou dispositivos acatados/rejeitados pelo relator): nesse caso, apresente-os em **tópicos** (lista com "-"), um item por dispositivo/emenda.
- Se identificar substitutivo, descreva detalhadamente as mudanças promovidas em relação ao texto original.
- Se identificar emendas, descreva o que cada emenda altera.
- Responda em texto Markdown puro, sem cercas de código \`\`\`.`;
}

// ---------- IA: chamada adaptada para resposta em Markdown ----------
// Retorna { text, truncated } onde truncated=true sinaliza que o modelo
// atingiu o limite de tokens de saída (não terminou a resposta).
async function chamarIA({ provedorId, apiKey, modelo, prompt, pdfBuffers }) {
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
    const json = await fetchIA(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const cand = json.candidates?.[0];
    return {
      text: cand?.content?.parts?.[0]?.text?.trim() || '',
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
    const json = await fetchIA('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let texto = '';
    for (const item of (json.output || [])) {
      for (const c of (item.content || [])) {
        if (c.type === 'output_text' && c.text) { texto = c.text.trim(); break; }
      }
      if (texto) break;
    }
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
    let texto = '';
    for (const item of (json.content || [])) {
      if (item.type === 'text' && item.text) { texto = item.text.trim(); break; }
    }
    return { text: texto, truncated: json.stop_reason === 'max_tokens' };
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

  // Análises antigas marcadas como manuais (anterior à integração da IA para
  // Redação Final) — sem provedor/modelo/documentos. Mantido por compat.
  if (it.analise.manual) {
    metaEl.innerHTML = it.analise.editadoEm
      ? `Análise manual · editada em ${formatDataHora(it.analise.editadoEm)}`
      : `Análise manual`;
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
  const refs = it.analise.refsSuspeitas || [];
  const avisoRefs = refs.length
    ? `<div class="an-aviso-refs" style="margin:0 0 12px;padding:10px 12px;border-left:3px solid #d68a00;background:#fff8e6;border-radius:4px;font-size:13px;color:#5a4500">⚠ <strong>Conferência automática de referências:</strong> a IA citou ${refs.length === 1 ? 'a referência' : 'as referências'} a seguir, mas ${refs.length === 1 ? 'ela não foi localizada' : 'elas não foram localizadas'} no texto do documento analisado. Confirme na fonte antes de usar — esta é uma heurística e pode haver falso positivo: ${refs.map(escapeHtml).join('; ')}.</div>`
    : '';
  conteudo.innerHTML = avisoRefs + renderMarkdown(it.analise.markdown);
  conteudo.style.display = '';
  card.querySelector('[data-role=analise-editor]').style.display = 'none';
  // Recalcula os badges (inclui o de interesse de parlamentar, que considera o
  // texto da nota recém-gerada/editada).
  atualizarBadgesCard(it);
}

// Estado por-item para o autosave durante a edição.
// Chave: it.chave → { snapshot, debounceId, salvando, dirty, listener }
const _autosaveState = new Map();
const AUTOSAVE_DEBOUNCE_MS = 1500;

function entrarEdicaoAnalise(it) {
  if (!it.analise) return;
  const card     = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const conteudo = card.querySelector('[data-role=analise-conteudo]');
  const editor   = card.querySelector('[data-role=analise-editor]');
  const statusEl = card.querySelector('[data-role=autosave-status]');
  editor.value = it.analise.markdown || '';
  conteudo.style.display = 'none';
  editor.style.display   = 'block';
  card.querySelector('[data-role=btn-editar]').style.display = 'none';
  card.querySelector('[data-role=btn-salvar-edicao]').style.display = 'inline-flex';
  card.querySelector('[data-role=btn-cancelar-edicao]').style.display = 'inline-flex';
  statusEl.style.display = 'inline';
  statusEl.textContent = '';
  statusEl.style.color = '#888';

  // Snapshot para o "Cancelar" reverter, mesmo após autosaves intermediários.
  const snapshot = { ...it.analise };
  const listener = () => agendarAutosave(it);
  editor.addEventListener('input', listener);
  _autosaveState.set(it.chave, { snapshot, debounceId: null, salvando: false, dirty: false, listener });

  editor.focus();
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
  if (!card) return;
  const editor = card.querySelector('[data-role=analise-editor]');
  const novo   = (editor.value || '').trim();
  if (!novo) {
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
    markdown:    novo,
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
  const card   = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  if (card) {
    const editor = card.querySelector('[data-role=analise-editor]');
    if (editor && st.listener) editor.removeEventListener('input', st.listener);
  }
  _autosaveState.delete(it.chave);
}

function sairEdicaoAnalise(it) {
  const card   = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  // Cancelar: reverte para o snapshot e re-grava no Firebase (para não
  // ficar persistido o estado intermediário que o autosave já enviou).
  const st = _autosaveState.get(it.chave);
  if (st && st.snapshot && it.analise && it.analise.markdown !== st.snapshot.markdown) {
    it.analise = { ...st.snapshot };
    renderAnaliseCard(it);
    fbSalvarAnalise(it).catch(e => console.warn('Reverter no Firebase falhou:', e.message));
  }
  limparEdicao(it);
  card.querySelector('[data-role=analise-editor]').style.display = 'none';
  card.querySelector('[data-role=analise-conteudo]').style.display = '';
  card.querySelector('[data-role=btn-salvar-edicao]').style.display = 'none';
  card.querySelector('[data-role=btn-cancelar-edicao]').style.display = 'none';
  card.querySelector('[data-role=autosave-status]').style.display = 'none';
  card.querySelector('[data-role=btn-editar]').style.display = 'inline-flex';
}

async function salvarEdicaoAnalise(it) {
  const card   = document.querySelector(`.an-card[data-chave="${it.chave}"]`);
  const editor = card.querySelector('[data-role=analise-editor]');
  const novo   = editor.value.trim();
  if (!novo) { mostrarToast('Análise não pode ficar vazia.', 'aviso'); return; }

  // Flush: cancela qualquer autosave pendente e grava agora.
  const st = _autosaveState.get(it.chave);
  if (st?.debounceId) { clearTimeout(st.debounceId); st.debounceId = null; }

  it.analise = {
    ...it.analise,
    markdown:    novo,
    editadoEm:   new Date().toISOString(),
    editadoPor:  state.config?.nomeUsuario || 'equipe',
  };

  limparEdicao(it);
  card.querySelector('[data-role=analise-editor]').style.display = 'none';
  card.querySelector('[data-role=analise-conteudo]').style.display = '';
  card.querySelector('[data-role=btn-salvar-edicao]').style.display = 'none';
  card.querySelector('[data-role=btn-cancelar-edicao]').style.display = 'none';
  card.querySelector('[data-role=autosave-status]').style.display = 'none';
  card.querySelector('[data-role=btn-editar]').style.display = 'inline-flex';
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
function renderMarkdown(md) {
  if (!md) return '';
  // Escape básico
  let html = escapeHtml(md);
  // Headings
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // Bold/italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Listas
  html = html.replace(/(^|\n)(\s*[-*]\s+.+(?:\n\s*[-*]\s+.+)*)/g, (m, pre, bloco) => {
    const itens = bloco.split(/\n/).map(l => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
    return `${pre}<ul>${itens.map(i => `<li>${i}</li>`).join('')}</ul>`;
  });
  // Quebras de parágrafo
  html = html.split(/\n{2,}/).map(b => {
    if (/^<(h\d|ul|ol|pre|blockquote)/.test(b.trim())) return b;
    return `<p>${b.trim().replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
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

async function gerarTodasAsAnalises() {
  if (!state.pauta) return;
  await carregarConfig();
  if (!state.config?.apiKey) {
    mostrarToast('Configure a chave de API antes (⚙ Configurações).', 'aviso');
    return;
  }

  // Apenas itens ainda sem análise
  const pendentes = state.pauta.itens.filter(it => it.analiseStatus !== 'ok');
  if (!pendentes.length) {
    mostrarToast('Todos os itens já têm análise.', 'info');
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
          <div class="an-pauta-item-titulo">${escapeHtml(p.periodo || p.titulo || p.id)}</div>
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
    document.getElementById('btn-salvar-firebase').disabled = false;
    document.getElementById('btn-adicionar-item').disabled = false;
    document.getElementById('btn-gerar-todas').disabled = false;
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
    `"${p.periodo || p.titulo || p.id}" (${(p.itens || []).length} itens)`;
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
      document.getElementById('pauta-meta').textContent   = 'Selecione uma pauta no menu ou carregue um novo PDF';
      document.getElementById('btn-exportar-pdf').disabled    = true;
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
    document.getElementById('btn-salvar-firebase').disabled = false;
    document.getElementById('btn-adicionar-item').disabled = false;
    document.getElementById('btn-gerar-todas').disabled = false;
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
  if (enr.autoriaPodemos) tags.push('A');
  if ((enr.apensadosPodemos || []).length) tags.push('AP');
  return tags.length ? ' — ' + tags.join(', ') : '';
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
function _htmlImpressaoPautaPlenario(pauta, logoDataUrl) {
  const esc = escapeHtml;
  const bm  = chave => 'i_' + String(chave).replace(/[^\w]/g, '_');
  const itens = pauta.itens || [];
  const placeholder = st => st === 'erro' ? 'Falha ao gerar análise.' : st === 'gerando' ? 'Análise em processamento.' : 'Análise não gerada.';
  const meta = `${esc(pauta.titulo || '')}${pauta.periodo ? ' · ' + esc(pauta.periodo) : ''} · Gerado em ${formatDataHora(new Date().toISOString())} · ${itens.length} item(ns)`;

  const indice = itens.length ? `
    <section class="indice">
      <h2>Índice</h2>
      <ul>
        ${itens.map(it => `<li><a href="#${bm(it.chave)}"><span class="t">${esc(tituloComApelido(it))}${esc(sufixoAutoriaIndice(it))}</span><span class="ld"></span></a></li>`).join('')}
      </ul>
    </section>` : '';

  const itensHtml = itens.map(it => {
    const autor   = it.autorTexto || (it.enriquecimento?.autores || []).length;
    const autorHtml = htmlAutorRealcado(it);
    const relator = it.relator ? ` · Relator: Dep. ${esc(it.relator.nome)} (${esc(it.relator.partido)}-${esc(it.relator.uf)})` : '';
    const badges  = `${it.enriquecimento?.autoriaPodemos ? '<span class="badge badge-pode">★ Autoria Podemos</span>' : ''}${(it.enriquecimento?.apensadosPodemos || []).map(ap => `<span class="badge badge-apens">Apensado Podemos: ${esc(ap.siglaTipo)} ${esc(ap.numero)}/${esc(ap.ano)}</span>`).join('')}`;
    const corpo   = it.analise?.markdown ? renderMarkdown(it.analise.markdown) : `<div class="pendente">${placeholder(it.analiseStatus)}</div>`;
    return `<div class="bloco" id="${bm(it.chave)}">
      <h3 class="item-h">${esc(tituloComApelido(it))}</h3>
      ${(autor || relator) ? `<div class="item-meta">${autorHtml}${relator}</div>` : ''}
      ${badges ? `<div class="badges">${badges}</div>` : ''}
      ${corpo}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(pauta.titulo || 'Pauta de Plenário')}</title>
  <style>
    @page { size:A4; margin:16mm; }
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
    .indice h2 { font-size:13pt; color:#003c1f; margin-bottom:8px; }
    .indice ul { list-style:none; margin:0; padding:0; }
    .indice li { font-size:10.5pt; margin-bottom:4px; }
    .indice a { display:flex; align-items:baseline; text-decoration:none; color:#003c1f; }
    .indice a .ld { flex:1 1 auto; border-bottom:1px dotted #b9c2cc; margin:0 5px; position:relative; top:-3px; }
    .indice a::after { content: target-counter(attr(href url), page); color:#444; white-space:nowrap; }
    .bloco { margin-bottom:8px; }
    .item-h { font-size:13pt; font-weight:700; color:#003c1f; border-bottom:1px solid #ccc; padding-bottom:3px; margin:18px 0 4px; page-break-after:avoid; break-after:avoid; }
    .item-meta { font-size:9pt; color:#555; margin-bottom:4px; }
    .badges { margin:2px 0 6px; font-size:9pt; }
    .badge { display:inline-block; padding:2px 8px; border-radius:999px; margin-right:4px; font-weight:600; }
    .badge-pode { background:#d3f5e2; color:#006633; }
    .badge-apens { background:#d8eef0; color:#02484d; }
    h2 { font-size:12pt; color:#003c1f; margin:14px 0 4px; page-break-after:avoid; break-after:avoid; }
    h3 { font-size:11pt; color:#155724; margin:10px 0 3px; }
    p { font-size:10.5pt; line-height:1.6; margin:6px 0; text-align:justify; hyphens:auto; page-break-inside:avoid; break-inside:avoid; }
    ul { margin:4px 0 6px 18px; padding:0; }
    li { font-size:10.5pt; line-height:1.5; }
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
    <div class="ft">Documento gerado pelo SisPode · Liderança do Podemos · Câmara dos Deputados</div>
  </body></html>`;
}

async function exportarPdf() {
  if (!state.pauta) return;
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
  try { await prepararApelidos(state.pauta.itens); } catch (_) {}
  if (win.closed) return;
  const logoDataUrl = await carregarLogoDataUrl();

  win.document.open();
  win.document.write(_htmlImpressaoPautaPlenario(state.pauta, logoDataUrl));
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
