/* ============================================================
   PAUTAS CCJC – PODEMOS
   Módulo de análise de projetos da CCJC com suporte a múltiplos
   provedores de IA: Google Gemini e Groq (ambos gratuitos).
   ============================================================ */

'use strict';

// ---------- CONSTANTES ----------
const API_BASE     = 'https://dadosabertos.camara.leg.br/api/v2';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta/models';
const ANTHROPIC_BASE  = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VER   = '2023-06-01';
const FIREBASE_URL   = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const CCJC_ORGAO_ID  = 2003;
const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Órgãos administrativos que não devem ser listados como comissões de mérito
const ORGAOS_ADMIN = new Set([
  'PLEN','SGM','MESA','PR','SGL','DETAQ','SPL','CORD',
  'GSIST','CLP','CMO','CVT','SECGER','SECLEG','DRH',
]);

// ---------- ESTADO ----------
let app = {
  pautaAtual:   null,
  projetoAtivo: null,
  processando:  false,
  toastTimer:   null,
  cal: {
    ano:              new Date().getFullYear(),
    mes:              new Date().getMonth(),
    eventos:          {},   // { 'YYYY-MM-DD': [ { id, dataHoraInicio, ... }, ... ] }
    carregando:       false,
    diaSelecionado:   null,
    reuniaoSelecionada: null,
  },
  config: {
    geminiKey:      '',
    modelo:         'gemini-2.5-flash-preview-04-17',
    anthropicKey:   '',
    anthropicModelo:'claude-opus-4-7',
  },
};

// ============================================================
//  INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  }
  registrarEventos();
  carregarConfiguracao();
  carregarHistorico();
});

function registrarEventos() {
  document.getElementById('btn-voltar-home').addEventListener('click', () => {
    chrome.tabs.update({ url: chrome.runtime.getURL('panel.html') });
  });

  document.getElementById('btn-nova-pauta').addEventListener('click', abrirModalNovaPauta);
  document.getElementById('btn-nova-pauta-upload').addEventListener('click', abrirModalNovaPauta);
  document.getElementById('btn-criar-pauta').addEventListener('click', criarPauta);
  document.getElementById('btn-configuracoes').addEventListener('click', abrirConfiguracoes);
  document.getElementById('btn-salvar-config').addEventListener('click', salvarConfiguracao);
  document.getElementById('btn-testar-ia').addEventListener('click', testarConexaoIA);
  document.getElementById('btn-carregar-modelos').addEventListener('click', carregarModelosDisponiveis);
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('config-gemini-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-analisar-todos').addEventListener('click', analisarTodos);
  document.getElementById('btn-salvar-pauta').addEventListener('click', salvarPauta);
  document.getElementById('btn-gerar-pdf').addEventListener('click', gerarPDF);
  document.getElementById('config-gemini-key')
    ?.addEventListener('input', atualizarBadgeGemini);
  document.getElementById('config-anthropic-key')
    ?.addEventListener('input', atualizarBadgeClaude);
  document.getElementById('btn-toggle-anthropic-key')
    ?.addEventListener('click', () => {
      const input = document.getElementById('config-anthropic-key');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  document.getElementById('btn-testar-anthropic')
    ?.addEventListener('click', testarConexaoAnthropic);

  // Abas PDF / Calendário
  document.querySelectorAll('.ccjc-upload-tab').forEach(btn => {
    btn.addEventListener('click', () => alternarPainelUpload(btn.dataset.painel));
  });
  document.getElementById('cal-prev').addEventListener('click', () => navCalendario(-1));
  document.getElementById('cal-next').addEventListener('click', () => navCalendario(1));
  document.getElementById('btn-carregar-pauta-cal').addEventListener('click', carregarPautaDoCalendario);

  // PDF no modal
  document.getElementById('input-pdf-modal-ccjc').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) await processarPDFModal(file);
  });

  // Fechar modais
  document.querySelectorAll('[data-fecha]').forEach(btn => {
    btn.addEventListener('click', () => fecharModal(btn.dataset.fecha));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) fecharModal(overlay.id);
    });
  });
}

// ============================================================
//  NAVEGAÇÃO
// ============================================================
function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ============================================================
//  MODAL NOVA PAUTA
// ============================================================
let _bufferPDF = null;

function abrirModalNovaPauta() {
  _bufferPDF = null;
  document.getElementById('pauta-titulo').value = '';
  document.getElementById('input-pdf-modal-ccjc').value = '';
  document.getElementById('upload-inline-ccjc-text').textContent = 'Clique para selecionar o PDF';
  document.getElementById('projetos-encontrados').style.display = 'none';
  document.getElementById('lista-projetos-modal').innerHTML = '';
  document.getElementById('btn-criar-pauta').disabled = true;
  document.getElementById('modal-nova-pauta').style.display = 'flex';
}

async function processarPDFModal(file) {
  const labelText   = document.getElementById('upload-inline-ccjc-text');
  const encontrados = document.getElementById('projetos-encontrados');
  const listaMod    = document.getElementById('lista-projetos-modal');

  labelText.textContent = '⏳ Lendo PDF...';
  try {
    const texto = await extrairTextoPDF(file);
    const refs  = extrairReferencias(texto);
    _bufferPDF  = { nome: file.name, refs };

    if (!refs.length) {
      labelText.textContent = '⚠ Nenhum projeto encontrado no PDF';
      encontrados.style.display = 'none';
      document.getElementById('btn-criar-pauta').disabled = true;
      return;
    }

    labelText.textContent = `✓ ${file.name} (${refs.length} projeto${refs.length !== 1 ? 's' : ''} encontrado${refs.length !== 1 ? 's' : ''})`;
    listaMod.innerHTML = refs.map(r => `<div class="prop-tag">${esc(r.chave)}</div>`).join('');
    encontrados.style.display = 'block';
    document.getElementById('btn-criar-pauta').disabled = false;

  } catch (err) {
    labelText.textContent = `✗ Erro ao ler PDF: ${err.message}`;
    document.getElementById('btn-criar-pauta').disabled = true;
  }
}

async function criarPauta() {
  if (!_bufferPDF?.refs?.length) return;

  const titulo = document.getElementById('pauta-titulo').value.trim()
    || `Pauta CCJC – ${new Date().toLocaleDateString('pt-BR')}`;

  const pauta = {
    id:      `ccjc-${Date.now()}`,
    titulo,
    criada:  new Date().toISOString(),
    projetos: _bufferPDF.refs.map(r => ({
      ...r,
      idCamara:             null,
      ementa:               '',
      autores:              [],
      statusApi:            '',
      resumoOriginal:       '',
      comissoes:            [],
      argumentosFavoraveis: '',
      argumentosContrarios: '',
      statusAnalise:        'pendente',
      erroAnalise:          '',
    })),
  };

  fecharModal('modal-nova-pauta');
  app.pautaAtual   = pauta;
  app.projetoAtivo = null;

  atualizarSidebar();
  renderizarListaProjetos();
  mostrarTela('tela-revisao');
  document.getElementById('ccjc-action-bar').style.display = 'flex';

  const cont = document.getElementById('revisao-conteudo');
  cont.innerHTML = '<div class="empty-state" style="margin-top:80px"><p>Selecione um projeto na lista ao lado</p></div>';

  mostrarToast(`${pauta.projetos.length} projetos encontrados. Buscando dados na API da Câmara...`, '');
  await buscarMetadadosTodos(pauta.projetos);
  renderizarListaProjetos();
  mostrarToast('Dados carregados. Clique em "Analisar Todos" para gerar as análises via IA.', 'sucesso');
}

// ============================================================
//  EXTRAÇÃO DE PDF
// ============================================================
async function extrairTextoPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
  let texto    = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map(it => it.str).join(' ') + '\n';
  }
  return texto;
}

function extrairReferencias(texto) {
  const regex = /\b(PL|PEC|PLN|PLP|PLV|PDC|PRC|MPV|REQ|INC)\s*[nº°.]*\s*(\d{1,5})[,.\/\s]*(?:de\s+)?(\d{4})\b/gi;
  const vistas = new Set();
  const refs   = [];
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const sigla  = m[1].toUpperCase();
    const numero = parseInt(m[2], 10);
    const ano    = parseInt(m[3], 10);
    const chave  = `${sigla} ${numero}/${ano}`;
    if (!vistas.has(chave) && ano >= 1990 && ano <= new Date().getFullYear() + 1) {
      vistas.add(chave);
      refs.push({ sigla, numero, ano, chave });
    }
  }
  return refs;
}

// ============================================================
//  API CÂMARA
// ============================================================
async function buscarMetadadosTodos(projetos) {
  await mapLimit(projetos, 8, async proj => {
    try {
      const dados = await buscarProposicaoAPI(proj.sigla, proj.numero, proj.ano);
      if (dados) {
        proj.idCamara  = dados.id;
        proj.ementa    = dados.ementa;
        proj.autores   = dados.autores;
        proj.statusApi = dados.statusDesc;
      }
    } catch (e) {
      console.warn(`Erro ao buscar ${proj.chave}:`, e.message);
    }
  });
}

async function buscarProposicaoAPI(sigla, numero, ano) {
  const res  = await fetch(`${API_BASE}/proposicoes?siglaTipo=${sigla}&numero=${numero}&ano=${ano}&itens=1`);
  if (!res.ok) return null;
  const json = await res.json();
  const item = json.dados?.[0];
  if (!item) return null;

  let autores = [];
  try {
    const resA = await fetch(`${API_BASE}/proposicoes/${item.id}/autores`);
    if (resA.ok) {
      const jA = await resA.json();
      autores  = (jA.dados || []).slice(0, 3).map(a => a.nome).filter(Boolean);
    }
  } catch (_) {}

  return {
    id:         item.id,
    ementa:     item.ementa,
    autores,
    statusDesc: item.statusProposicao?.descricaoSituacao || '',
  };
}

async function buscarTextos(idCamara) {
  try {
    const res = await fetch(`${API_BASE}/proposicoes/${idCamara}/textos`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.dados || [];
  } catch (_) { return []; }
}

async function buscarTramitacoes(idCamara) {
  try {
    const res = await fetch(`${API_BASE}/proposicoes/${idCamara}/tramitacoes?ordem=ASC&itens=100`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.dados || [];
  } catch (_) { return []; }
}

/**
 * Busca os documentos (pareceres, substitutivos) de cada comissão
 * na página específica da Câmara, que é a única fonte confiável.
 * Retorna mapa: siglaComissao → { nome, url }
 */
async function buscarPareceresComissoes(idCamara) {
  const url = `https://www.camara.leg.br/proposicoesWeb/prop_pareceres_substitutivos_votos?idProposicao=${idCamara}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    return _parsearPaginaPareceres(await res.text());
  } catch (e) {
    console.warn('Erro ao buscar pareceres das comissões:', e.message);
    return {};
  }
}

function _parsearPaginaPareceres(html) {
  const doc  = new DOMParser().parseFromString(html, 'text/html');

  // ---------- Passo 1: mapa sigla → nome completo ----------
  const nomeCompleto = {};
  const textoTotal = doc.body?.textContent || '';
  const rNome = /([A-ZÀÁÂÃÉÊÍÓÔÕÚ][A-ZÀÁÂÃÉÊÍÓÔÕÚ,\s]+?)\s*[\(—–-]\s*([A-Z]{3,8})\s*\)?/g;
  let mm;
  while ((mm = rNome.exec(textoTotal)) !== null) {
    const sigla = mm[2].trim();
    if (!_siglaIgnorada(sigla)) nomeCompleto[sigla] = mm[1].trim();
  }

  // ---------- Passo 2: detecta a seção de cada parecer ----------
  // A página da Câmara separa pareceres em seções como:
  //   "Pareceres Aprovados ou Pendentes de Aprovação"  → vigentes (preferidos)
  //   "Pareceres Substituídos / Não Aprovados / Anteriores" → obsoletos
  // Usamos a posição de cada link no documento (compareDocumentPosition)
  // para descobrir sob qual cabeçalho ele se encontra.
  const todosNos = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, caption, strong, b'));
  const secoes = todosNos
    .map(el => ({ el, texto: (el.textContent || '').trim() }))
    .filter(s => s.texto.length > 4 && /parecer/i.test(s.texto))
    .map(s => ({
      el:     s.el,
      texto:  s.texto,
      ativa:  /aprovad|pendente/i.test(s.texto) && !/substitu|não aprovad|nao aprovad|rejeitad|anterior/i.test(s.texto),
      obsoleta: /substitu|não aprovad|nao aprovad|rejeitad|anterior/i.test(s.texto),
    }));

  function classificarSecao(link) {
    // Encontra a última seção que precede o link no DOM
    let ultima = null;
    for (const s of secoes) {
      const pos = s.el.compareDocumentPosition(link);
      // Node.DOCUMENT_POSITION_FOLLOWING = 4 → s.el vem antes de link
      if (pos & 4) ultima = s;
      else break; // secoes está em ordem de documento
    }
    if (!ultima)            return { score: 50, secao: '(sem cabeçalho)' };
    if (ultima.ativa)       return { score: 100, secao: ultima.texto };
    if (ultima.obsoleta)    return { score: 0,   secao: ultima.texto };
    return                         { score: 50,  secao: ultima.texto };
  }

  // ---------- Passo 3: coleta todos os links candidatos ----------
  const links = Array.from(doc.querySelectorAll(
    'a[href*="prop_mostrarintegra"], a[href*="prop_GetPublicacoes"], ' +
    'a[href*="codteor"], a[href*="fileserv"], a[href*=".pdf"], a[href*=".doc"]'
  )).filter(a => {
    const h = a.getAttribute('href') || '';
    return h && !h.startsWith('#') && !h.includes('javascript:');
  });

  // candidatos[sigla] = [ { score, ordem, url, nome, secao, fonte }, ... ]
  const candidatos = {};
  function registrar(sigla, dadosBase, link, ordem) {
    if (!sigla || _siglaIgnorada(sigla)) return;
    const cls = classificarSecao(link);
    if (!candidatos[sigla]) candidatos[sigla] = [];
    candidatos[sigla].push({ ...dadosBase, score: cls.score, secao: cls.secao, ordem });
  }

  links.forEach((link, ordem) => {
    const rawHref = link.getAttribute('href') || '';
    const docUrl = rawHref.startsWith('http')
      ? rawHref
      : `https://www.camara.leg.br${rawHref.startsWith('/') ? rawHref : '/proposicoesWeb/' + rawHref}`;

    // Estratégia 1: sigla no parâmetro filename da URL
    const filenameMatch = rawHref.match(/[?&]filename=([^&]+)/i);
    if (filenameMatch) {
      const filename = decodeURIComponent(filenameMatch[1].replace(/\+/g, ' '));
      const sigla = _extrairSiglaDeTexto(filename);
      if (sigla) {
        registrar(sigla, { url: docUrl, nome: nomeCompleto[sigla] || sigla, fonte: 'filename' }, link, ordem);
        return;
      }
    }

    // Estratégia 2: texto do próprio link
    const textoLink = (link.textContent || '').trim();
    if (textoLink.length > 2) {
      const sigla = _extrairSiglaDeTexto(textoLink);
      if (sigla) {
        registrar(sigla, { url: docUrl, nome: nomeCompleto[sigla] || textoLink.slice(0, 100), fonte: 'textoLink' }, link, ordem);
        return;
      }
    }

    // Estratégia 3: contexto DOM próximo
    let ancestor = link.parentElement;
    for (let d = 0; d < 8 && ancestor; d++) {
      const textoLocal = Array.from(ancestor.childNodes)
        .filter(n => n.nodeType === 3 || /^(TD|TH|H[1-6]|STRONG|B|SPAN|CAPTION|LABEL)$/i.test(n.nodeName))
        .map(n => n.textContent || '')
        .join(' ');
      const sigla = _extrairSiglaDeTexto(textoLocal);
      if (sigla) {
        registrar(sigla, { url: docUrl, nome: nomeCompleto[sigla] || textoLocal.trim().slice(0, 100), fonte: 'contextoDOM' }, link, ordem);
        return;
      }
      ancestor = ancestor.parentElement;
    }
  });

  // ---------- Passo 4: escolhe o melhor candidato por sigla ----------
  // Prioridade: maior score (Aprovado/Pendente > sem seção > Obsoleto).
  // Empate: maior ordem (último no DOM → mais recente).
  const mapa = {};
  for (const [sigla, cands] of Object.entries(candidatos)) {
    cands.sort((a, b) => (b.score - a.score) || (b.ordem - a.ordem));
    const escolhido = cands[0];
    mapa[sigla] = { nome: escolhido.nome, url: escolhido.url };
  }

  // ---------- Passo 5: fallback se nenhum candidato foi achado ----------
  if (Object.keys(mapa).length === 0 && Object.keys(nomeCompleto).length > 0) {
    for (const [sigla, nome] of Object.entries(nomeCompleto)) {
      const els = Array.from(doc.querySelectorAll('*')).filter(el =>
        el.children.length === 0 && (el.textContent || '').includes(sigla)
      );
      for (const el of els) {
        let parent = el.parentElement;
        for (let d = 0; d < 6 && parent; d++) {
          const linkProximo = parent.querySelector('a[href]');
          if (linkProximo) {
            const h = linkProximo.getAttribute('href');
            if (h && !h.startsWith('#')) {
              const url = h.startsWith('http') ? h : `https://www.camara.leg.br${h.startsWith('/') ? h : '/proposicoesWeb/' + h}`;
              if (!mapa[sigla]) mapa[sigla] = { nome, url };
            }
            break;
          }
          parent = parent.parentElement;
        }
        if (mapa[sigla]) break;
      }
    }
  }

  console.debug('[CCJC] pareceresMap (com seleção por seção):', mapa);
  console.debug('[CCJC] candidatos detalhados:', candidatos);
  return mapa;
}

/** Extrai a sigla de uma comissão de um trecho de texto (ex: "CAPADR", "CCJC"). */
function _extrairSiglaDeTexto(texto) {
  // Padrão "SIGLA - " ou "SIGLA:" é o mais confiável; fallback para sigla isolada
  const comTraco = texto.match(/\b([A-Z]{3,8})\s*[-–—:]/);
  if (comTraco && !_siglaIgnorada(comTraco[1])) return comTraco[1];

  const isolada = texto.match(/\b(C[A-Z]{2,7})\b/);
  if (isolada && !_siglaIgnorada(isolada[1])) return isolada[1];

  return null;
}

function _siglaIgnorada(s) {
  return ['PDF','DOC','XLS','COM','HTTP','HTML','URL','LINK','CPF','CEP','CNPJ'].includes(s);
}

function extrairComissoesDaTramitacao(tramitacoes) {
  const vistas   = new Set();
  const comissoes = [];
  for (const t of tramitacoes) {
    const sigla = (t.siglaOrgao || '').trim().toUpperCase();
    const nome  = (t.nomeOrgao  || '').trim();
    if (!sigla || ORGAOS_ADMIN.has(sigla) || vistas.has(sigla)) continue;
    vistas.add(sigla);
    comissoes.push({ sigla, nome: nome || sigla });
  }
  return comissoes;
}

// ============================================================
//  CAMADA DE IA – GEMINI
// ============================================================

async function aiCall(prompt, docUrl = null) {
  if (app.config.geminiKey) return _callGemini(prompt, docUrl);
  if (app.config.anthropicKey) return _callAnthropic(prompt, docUrl);
  throw new Error('Nenhuma chave de IA configurada. Configure em ⚙ Configurações.');
}

// ---------- GEMINI ----------
async function _callGemini(prompt, docUrl = null) {
  const { geminiKey, modelo } = app.config;
  if (!geminiKey) throw new Error('Chave Gemini não configurada.');

  const parts = [{ text: prompt }];

  if (docUrl) {
    try {
      const res = await fetch(docUrl);
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('pdf')) {
          // Gemini suporta PDF como inline_data (base64)
          const buf   = await res.arrayBuffer();
          const u8    = new Uint8Array(buf);
          let bin = '';
          const CHUNK = 8192;
          for (let i = 0; i < u8.length; i += CHUNK) {
            bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
          }
          parts.push({ inline_data: { mime_type: 'application/pdf', data: btoa(bin) } });
        } else {
          const clean = _extrairTextoHTML(await res.text());
          if (clean.length > 200) parts.push({ text: `\n\n---\nTexto do documento:\n${clean}` });
        }
      }
    } catch (e) { console.warn('Gemini: erro ao buscar doc:', e.message); }
  }

  const url = `${GEMINI_BASE}/${modelo}:generateContent?key=${geminiKey}`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 1024 } }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Gemini HTTP ${res.status}`);
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// ---------- ANTHROPIC ----------
async function _callAnthropic(prompt, docUrl = null) {
  const { anthropicKey, anthropicModelo } = app.config;
  if (!anthropicKey) throw new Error('Chave Anthropic não configurada.');

  const content = [];

  if (docUrl) {
    try {
      const res = await fetch(docUrl);
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('pdf')) {
          const buf  = await res.arrayBuffer();
          const u8   = new Uint8Array(buf);
          let bin = '';
          const CHUNK = 8192;
          for (let i = 0; i < u8.length; i += CHUNK) {
            bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
          }
          content.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) },
          });
        } else {
          const clean = _extrairTextoHTML(await res.text());
          if (clean.length > 200) content.push({ type: 'text', text: `Texto do documento:\n${clean}` });
        }
      }
    } catch (e) { console.warn('Anthropic: erro ao buscar doc:', e.message); }
  }

  content.push({ type: 'text', text: prompt });

  const res = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: {
      'Content-Type':                          'application/json',
      'x-api-key':                             anthropicKey,
      'anthropic-version':                     ANTHROPIC_VER,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      anthropicModelo,
      max_tokens: 1024,
      messages:   [{ role: 'user', content }],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);
  return json.content?.[0]?.text?.trim() || '';
}

// ---------- Utilidade compartilhada ----------
function _extrairTextoHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40000);
}

async function gerarResumoOriginal(proj, textoUrl) {
  const prompt = `Você é um assessor parlamentar especializado em análise legislativa brasileira.

Analise o ${proj.chave}: "${proj.ementa || ''}"${proj.autores?.length ? `\nAutoria: ${proj.autores.join(', ')}.` : ''}

Com base no texto integral do projeto${textoUrl ? ' (documento anexado)' : ''}, elabore um resumo executivo em 3 parágrafos cobrindo:
1. Objetivo principal e contexto da proposta.
2. Principais disposições e mudanças propostas.
3. Impacto esperado e público afetado.

Escreva em linguagem técnica e objetiva, em prosa contínua, sem títulos ou marcadores.`;

  return aiCall(prompt, textoUrl);
}

async function gerarAnaliseComissao(proj, comissao, tramitacoesCom, docUrl) {
  const historico = tramitacoesCom
    .map(t => {
      const data    = (t.dataHora || '').split('T')[0];
      const tipo    = t.descricaoTramitacao || '';
      const situac  = t.descricaoSituacao  || '';
      const despacho = t.despacho ? ` — Despacho: ${t.despacho}` : '';
      return `[${data}] ${tipo}: ${situac}${despacho}`;
    })
    .filter(s => s.trim().length > 5)
    .join('\n');

  const prompt = `Você é um assessor parlamentar especializado em análise legislativa brasileira.

Analise a tramitação do ${proj.chave} na ${comissao.nome} (${comissao.sigla}).
Ementa: "${proj.ementa || ''}"

Histórico de eventos nesta comissão:
${historico || '(sem registro detalhado disponível)'}

${docUrl ? 'O documento da comissão (parecer/substitutivo) está anexado.' : ''}

Descreva em 2 parágrafos:
1. A decisão da comissão (aprovação, rejeição, aprovação com substitutivo/emendas).
2. As principais alterações realizadas ou os argumentos centrais do relator.

Escreva em prosa objetiva e técnica, sem marcadores. Se a comissão aprovou sem alterações substanciais, informe isso claramente.`;

  return aiCall(prompt, docUrl);
}

async function gerarArgumentos(proj) {
  const historicoCom = (proj.comissoes || [])
    .filter(c => c.resumo)
    .map(c => `${c.nome}: ${c.resumo.slice(0, 300)}`)
    .join('\n');

  const prompt = `Você é um assessor parlamentar especializado em análise legislativa brasileira.

Com base no ${proj.chave}: "${proj.ementa || ''}"${historicoCom ? `\n\nDecisões das comissões:\n${historicoCom}` : ''}

Elabore, de forma equilibrada e técnica:

ARGUMENTOS FAVORÁVEIS À APROVAÇÃO:
Liste de 3 a 4 argumentos principais em favor do projeto, um por linha, iniciando com "-".

ARGUMENTOS CONTRÁRIOS À APROVAÇÃO:
Liste de 3 a 4 argumentos principais contra o projeto, um por linha, iniciando com "-".

Não tome posição. Seja factual, objetivo e equilibrado.`;

  return aiCall(prompt);
}

function splitArgumentos(texto) {
  const favorIdx = texto.search(/ARGUMENTOS FAVORÁVEIS|FAVORÁVEIS À APROVAÇÃO/i);
  const contrIdx = texto.search(/ARGUMENTOS CONTRÁRIOS|CONTRÁRIOS À APROVAÇÃO/i);

  if (favorIdx === -1 && contrIdx === -1) return [texto, ''];

  let fav = '';
  let con = '';

  if (favorIdx !== -1 && contrIdx !== -1) {
    if (favorIdx < contrIdx) {
      fav = texto.slice(favorIdx, contrIdx);
      con = texto.slice(contrIdx);
    } else {
      con = texto.slice(contrIdx, favorIdx);
      fav = texto.slice(favorIdx);
    }
  } else if (favorIdx !== -1) {
    fav = texto.slice(favorIdx);
  } else {
    con = texto.slice(contrIdx);
  }

  fav = fav.replace(/^.*FAVORÁVEIS.*?\n/i, '').trim();
  con = con.replace(/^.*CONTRÁRIOS.*?\n/i, '').trim();

  return [fav, con];
}

// ============================================================
//  PIPELINE DE ANÁLISE
// ============================================================
async function analisarProjeto(proj) {
  proj.statusAnalise = 'analisando';
  proj.erroAnalise   = '';
  renderizarItemSidebar(proj);
  if (app.projetoAtivo?.chave === proj.chave) renderizarRevisao();

  try {
    if (!proj.idCamara) {
      throw new Error('Projeto não encontrado na API da Câmara. Verifique a referência no PDF.');
    }

    // Busca textos, tramitações e pareceres de comissões simultaneamente
    const [textos, tramitacoes, pareceresMap] = await Promise.all([
      buscarTextos(proj.idCamara),
      buscarTramitacoes(proj.idCamara),
      buscarPareceresComissoes(proj.idCamara),
    ]);

    // URL do inteiro teor
    const teorEntry = textos.find(t =>
      (t.tipo  || '').toLowerCase().includes('inteiro') ||
      (t.descricao || '').toLowerCase().includes('inteiro teor') ||
      (t.descricao || '').toLowerCase().includes('original')
    );
    const teorUrl = teorEntry?.url || null;

    // Comissões: une tramitação + página de pareceres (fonte mais confiável)
    const comissoes = extrairComissoesDaTramitacao(tramitacoes);
    for (const [sigla, info] of Object.entries(pareceresMap)) {
      if (!comissoes.find(c => c.sigla === sigla) && !ORGAOS_ADMIN.has(sigla)) {
        comissoes.push({ sigla, nome: info.nome || sigla });
      }
    }

    // 1. Resumo do projeto original
    proj.resumoOriginal = await gerarResumoOriginal(proj, teorUrl);

    // 2. Análise por comissão (sequencial para não saturar a API)
    proj.comissoes = [];
    for (const com of comissoes) {
      const tramCom = tramitacoes.filter(t =>
        (t.siglaOrgao || '').toUpperCase() === com.sigla
      );

      // Usa página de pareceres como fonte primária (mais confiável que /textos)
      // Fallback: busca em /textos pela sigla da comissão na descrição
      const docUrl = pareceresMap[com.sigla]?.url || (() => {
        const entry = textos.find(t => {
          const desc = (t.descricao || '').toLowerCase();
          return desc.includes(com.sigla.toLowerCase()) ||
                 desc.includes(com.nome.toLowerCase().slice(0, 15));
        });
        return entry?.url || null;
      })();

      const resumoCom = await gerarAnaliseComissao(proj, com, tramCom, docUrl);
      proj.comissoes.push({ sigla: com.sigla, nome: com.nome, resumo: resumoCom });
    }

    // 3. Argumentos favoráveis e contrários
    const textoArgs = await gerarArgumentos(proj);
    const [fav, con] = splitArgumentos(textoArgs);
    proj.argumentosFavoraveis  = fav;
    proj.argumentosContrarios  = con;

    proj.statusAnalise = 'concluido';
    mostrarToast(`${proj.chave} analisado com sucesso.`, 'sucesso');

  } catch (err) {
    proj.statusAnalise = 'erro';
    proj.erroAnalise   = err.message;
    console.error(`Erro ao analisar ${proj.chave}:`, err);
    mostrarToast(`Erro em ${proj.chave}: ${err.message}`, 'erro');
  }

  renderizarItemSidebar(proj);
  if (app.projetoAtivo?.chave === proj.chave) renderizarRevisao();
  atualizarProgresso();
}

async function analisarTodos() {
  if (!app.pautaAtual || app.processando) return;

  const provedor = app.config.geminiKey ? 'Gemini' : (app.config.anthropicKey ? 'Claude' : '');
  if (!provedor) {
    mostrarToast('Configure uma chave de IA em ⚙ Configurações antes de analisar.', 'aviso');
    abrirConfiguracoes();
    return;
  }

  const pendentes = app.pautaAtual.projetos.filter(p =>
    p.statusAnalise === 'pendente' || p.statusAnalise === 'erro'
  );

  if (!pendentes.length) {
    mostrarToast('Todos os projetos já foram analisados.', '');
    return;
  }

  app.processando = true;
  const btn = document.getElementById('btn-analisar-todos');
  btn.disabled  = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Analisando...';

  mostrarToast(`Iniciando análise de ${pendentes.length} projetos · 5 simultâneos · ${provedor}`, '');

  // Usa concorrência limitada: 5 projetos simultâneos, mas cada projeto faz
  // suas chamadas Gemini sequencialmente para não sobrecarregar a API.
  await mapLimit(pendentes, 5, proj => analisarProjeto(proj));

  app.processando = false;
  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> Analisar Todos`;

  const concluidos = app.pautaAtual.projetos.filter(p => p.statusAnalise === 'concluido').length;
  mostrarToast(`Análise concluída: ${concluidos}/${app.pautaAtual.projetos.length} projetos.`, 'sucesso');
}

async function analisarEsteProjetoHandler() {
  const proj = app.projetoAtivo;
  if (!proj || app.processando) return;
  if (!app.config.geminiKey && !app.config.anthropicKey) {
    mostrarToast('Configure uma chave de IA em ⚙ Configurações.', 'aviso');
    abrirConfiguracoes();
    return;
  }
  coletarEdicoesAtivas();
  await analisarProjeto(proj);
}

// ============================================================
//  FIREBASE
// ============================================================
async function fbSalvarPauta(pauta) {
  const res = await fetch(`${FIREBASE_URL}/ccjc-pautas/${pauta.id}.json`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(pauta),
  });
  if (!res.ok) throw new Error(`Firebase PUT HTTP ${res.status}`);
}

async function fbCarregarPautas() {
  const res = await fetch(`${FIREBASE_URL}/ccjc-pautas.json`);
  if (!res.ok) throw new Error(`Firebase GET HTTP ${res.status}`);
  const data = await res.json();
  return data ? Object.values(data).filter(Boolean) : [];
}

async function fbApagarPauta(id) {
  const res = await fetch(`${FIREBASE_URL}/ccjc-pautas/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase DELETE HTTP ${res.status}`);
}

// ============================================================
//  CHROME STORAGE (cache local)
// ============================================================
function localSalvar(pauta) {
  return new Promise(resolve => {
    chrome.storage.local.get('ccjcPautas', data => {
      const pautas = data.ccjcPautas || {};
      pautas[pauta.id] = pauta;
      chrome.storage.local.set({ ccjcPautas: pautas }, resolve);
    });
  });
}

function localCarregar() {
  return new Promise(resolve => {
    chrome.storage.local.get('ccjcPautas', data => {
      resolve(Object.values(data.ccjcPautas || {}));
    });
  });
}

function localApagar(id) {
  return new Promise(resolve => {
    chrome.storage.local.get('ccjcPautas', data => {
      const pautas = data.ccjcPautas || {};
      delete pautas[id];
      chrome.storage.local.set({ ccjcPautas: pautas }, resolve);
    });
  });
}

// ============================================================
//  SALVAR / RESTAURAR PAUTA
// ============================================================
async function salvarPauta() {
  if (!app.pautaAtual) return;
  coletarEdicoesAtivas();

  const btn = document.getElementById('btn-salvar-pauta');
  btn.disabled  = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Salvando...';

  try {
    await localSalvar(app.pautaAtual);
    await fbSalvarPauta(app.pautaAtual);
    mostrarToast('Pauta salva com sucesso!', 'sucesso');
    carregarHistorico();
  } catch (_) {
    await localSalvar(app.pautaAtual);
    mostrarToast('Firebase indisponível. Pauta salva localmente.', 'aviso');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar`;
  }
}

function coletarEdicoesAtivas() {
  const proj = app.projetoAtivo;
  if (!proj) return;

  const resumo = document.getElementById('campo-resumo-original');
  if (resumo) proj.resumoOriginal = resumo.value;

  const fav = document.getElementById('campo-argumentos-fav');
  if (fav) proj.argumentosFavoraveis = fav.value;

  const con = document.getElementById('campo-argumentos-con');
  if (con) proj.argumentosContrarios = con.value;

  (proj.comissoes || []).forEach((com, i) => {
    const el = document.getElementById(`campo-comissao-${i}`);
    if (el) com.resumo = el.value;
  });
}

async function restaurarPauta(id) {
  let pauta = null;
  try {
    const res = await fetch(`${FIREBASE_URL}/ccjc-pautas/${id}.json`);
    if (res.ok) pauta = await res.json();
  } catch (_) {}

  if (!pauta) {
    const local = await localCarregar();
    pauta = local.find(p => p.id === id) || null;
  }

  if (!pauta) { mostrarToast('Pauta não encontrada.', 'erro'); return; }

  coletarEdicoesAtivas();
  app.pautaAtual   = pauta;
  app.projetoAtivo = null;

  atualizarSidebar();
  renderizarListaProjetos();
  mostrarTela('tela-revisao');
  document.getElementById('ccjc-action-bar').style.display = 'flex';

  document.getElementById('revisao-conteudo').innerHTML =
    '<div class="empty-state" style="margin-top:80px"><p>Selecione um projeto na lista ao lado</p></div>';

  mostrarToast(`Pauta "${pauta.titulo}" carregada.`, 'sucesso');
}

// ============================================================
//  GERAÇÃO DE PDF (impressão via nova janela)
// ============================================================
function gerarPDF() {
  if (!app.pautaAtual) { mostrarToast('Nenhuma pauta carregada.', 'aviso'); return; }
  coletarEdicoesAtivas();

  const html = gerarHTMLImpressao(app.pautaAtual);
  const win  = window.open('', '_blank', 'width=960,height=720');
  if (!win) { mostrarToast('Permita pop-ups para gerar o PDF.', 'aviso'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 800);
}

function gerarHTMLImpressao(pauta) {
  const projetos = pauta.projetos.filter(p => p.resumoOriginal || p.statusAnalise === 'concluido');

  const html = projetos.map((proj, idx) => {
    const numBase = idx + 1;

    const comissoesHtml = (proj.comissoes || []).map(com => `
      <div class="pi-comissao">
        <h4>${escHtml(com.nome)} (${escHtml(com.sigla)})</h4>
        <p>${escHtml(com.resumo || 'Análise não disponível.')}</p>
      </div>`).join('');

    const toItems = txt => (txt || '')
      .split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => `<li>${escHtml(l.replace(/^-\s*/, '').trim())}</li>`)
      .join('');

    const favItems = toItems(proj.argumentosFavoraveis);
    const conItems = toItems(proj.argumentosContrarios);
    const favFallback = escHtml(proj.argumentosFavoraveis || 'Não disponível.');
    const conFallback = escHtml(proj.argumentosContrarios || 'Não disponível.');

    const secNum = (n) => comissoesHtml ? n : n - 1;

    return `
      <div class="pi-projeto">
        <div class="pi-header">
          <span class="pi-chave">${escHtml(proj.chave)}</span>
          ${proj.autores?.length ? `<span class="pi-autores">Autoria: ${escHtml(proj.autores.join(', '))}</span>` : ''}
        </div>
        <p class="pi-ementa">${escHtml(proj.ementa || '')}</p>

        <h3>1. Resumo do Projeto Original</h3>
        <p>${escHtml(proj.resumoOriginal || 'Análise não disponível.')}</p>

        ${comissoesHtml ? `<h3>2. Tramitação nas Comissões</h3>${comissoesHtml}` : ''}

        <h3>${comissoesHtml ? '3' : '2'}. Argumentos</h3>
        <div class="pi-argumentos">
          <div class="pi-fav">
            <h4>Favoráveis à Aprovação</h4>
            ${favItems ? `<ul>${favItems}</ul>` : `<p>${favFallback}</p>`}
          </div>
          <div class="pi-con">
            <h4>Contrários à Aprovação</h4>
            ${conItems ? `<ul>${conItems}</ul>` : `<p>${conFallback}</p>`}
          </div>
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(pauta.titulo)}</title>
  <style>
    *  { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Segoe UI',Arial,sans-serif; font-size:11pt; color:#1a1a1a; background:#fff; }
    .pi-capa { background:#00A859; color:#fff; padding:22px 30px; }
    .pi-capa h1 { font-size:17pt; font-weight:700; }
    .pi-capa p  { font-size:9.5pt; opacity:.85; margin-top:4px; }
    .pi-body { padding:20px 30px 30px; }
    .pi-projeto { page-break-inside:avoid; margin-bottom:36px; border-bottom:2px solid #e5e7eb; padding-bottom:30px; }
    .pi-projeto:last-child { border-bottom:none; }
    .pi-header { display:flex; align-items:baseline; gap:16px; margin-bottom:6px; }
    .pi-chave  { font-size:15pt; font-weight:800; color:#065f46; }
    .pi-autores{ font-size:9pt; color:#6b7280; }
    .pi-ementa { font-size:10pt; color:#374151; font-style:italic; line-height:1.5; margin-bottom:16px; }
    h3 { font-size:10.5pt; font-weight:700; color:#1f2937; margin:16px 0 8px; border-left:3px solid #00A859; padding-left:10px; }
    h4 { font-size:10pt; font-weight:600; color:#374151; margin:8px 0 5px; }
    p  { font-size:10pt; line-height:1.7; color:#1f2937; margin-bottom:7px; }
    .pi-comissao { background:#f9fafb; padding:10px 14px; border-radius:6px; margin-bottom:10px; }
    .pi-argumentos { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:8px; }
    .pi-fav { background:#f0fdf4; padding:12px; border-radius:6px; border-left:3px solid #22c55e; }
    .pi-con { background:#fef2f2; padding:12px; border-radius:6px; border-left:3px solid #ef4444; }
    ul { padding-left:16px; }
    li { font-size:10pt; line-height:1.6; margin-bottom:3px; }
    .pi-footer { margin-top:28px; padding-top:10px; border-top:1px solid #e5e7eb; font-size:9pt; color:#9ca3af; text-align:center; }
    @media print {
      @page { margin:14mm; size:A4; }
      .pi-projeto   { page-break-inside:avoid; }
      .pi-capa, .pi-fav, .pi-con, .pi-comissao { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>
  <div class="pi-capa">
    <h1>${escHtml(pauta.titulo)}</h1>
    <p>Liderança do Podemos – Câmara dos Deputados &nbsp;·&nbsp; Gerado em ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
  </div>
  <div class="pi-body">
    ${html || '<p>Nenhum projeto com análise disponível.</p>'}
    <div class="pi-footer">Documento gerado pelo SisPode · Liderança do Podemos · Câmara dos Deputados</div>
  </div>
</body>
</html>`;
}

// ============================================================
//  RENDERIZAÇÃO
// ============================================================
function atualizarSidebar() {
  const pauta   = app.pautaAtual;
  const info    = document.getElementById('pauta-info');
  const secProj = document.getElementById('sidebar-projetos-section');

  if (!pauta) {
    info.textContent = 'Nenhuma pauta carregada';
    info.classList.add('empty');
    secProj.style.display = 'none';
    document.getElementById('ccjc-progresso-wrap').style.display = 'none';
    return;
  }

  info.classList.remove('empty');
  info.innerHTML = `<strong>${esc(pauta.titulo)}</strong><br>
    <span style="font-size:11px;color:var(--text-dim)">${pauta.projetos.length} projetos · ${new Date(pauta.criada).toLocaleDateString('pt-BR')}</span>`;
  secProj.style.display = 'block';
  atualizarProgresso();
}

function atualizarProgresso() {
  const pauta = app.pautaAtual;
  if (!pauta) return;

  const total      = pauta.projetos.length;
  const concluidos = pauta.projetos.filter(p => p.statusAnalise === 'concluido').length;
  const pct        = total ? Math.round((concluidos / total) * 100) : 0;

  document.getElementById('ccjc-progresso-wrap').style.display = 'block';
  document.getElementById('ccjc-progresso-bar').style.width    = `${pct}%`;
  document.getElementById('ccjc-progresso-label').textContent  = `${concluidos}/${total} analisados`;
}

function renderizarListaProjetos() {
  const lista = document.getElementById('lista-projetos');
  const pauta = app.pautaAtual;

  if (!pauta?.projetos.length) {
    lista.innerHTML = '<div class="empty-state"><p>Nenhum projeto</p></div>';
    return;
  }

  lista.innerHTML = pauta.projetos.map(proj => {
    const statusCls = {
      pendente:   'ccjc-st-pendente',
      analisando: 'ccjc-st-analisando',
      concluido:  'ccjc-st-concluido',
      erro:       'ccjc-st-erro',
    }[proj.statusAnalise] || 'ccjc-st-pendente';

    const statusIcon = {
      pendente:   '○',
      analisando: '◌',
      concluido:  '●',
      erro:       '✗',
    }[proj.statusAnalise] || '○';

    const ativo = app.projetoAtivo?.chave === proj.chave ? 'active' : '';
    const ementa = (proj.ementa || 'Aguardando dados...').slice(0, 65);

    return `<div class="prop-item ${ativo}" data-chave="${esc(proj.chave)}">
      <div class="prop-item-content">
        <span class="prop-item-badge">${esc(proj.chave)}</span>
        <span class="prop-item-ementa">${esc(ementa)}${(proj.ementa || '').length > 65 ? '…' : ''}</span>
      </div>
      <span class="ccjc-status-dot ${statusCls}" title="${proj.statusAnalise}">${statusIcon}</span>
    </div>`;
  }).join('');

  lista.querySelectorAll('.prop-item').forEach(el => {
    el.addEventListener('click', () => selecionarProjeto(el.dataset.chave));
  });
}

function renderizarItemSidebar(proj) {
  const el = document.querySelector(`.prop-item[data-chave="${CSS.escape(proj.chave)}"]`);
  if (!el) return;

  const cls = {
    pendente:   'ccjc-st-pendente',
    analisando: 'ccjc-st-analisando',
    concluido:  'ccjc-st-concluido',
    erro:       'ccjc-st-erro',
  }[proj.statusAnalise] || 'ccjc-st-pendente';

  const icon = { pendente:'○', analisando:'◌', concluido:'●', erro:'✗' }[proj.statusAnalise] || '○';

  const dot = el.querySelector('.ccjc-status-dot');
  if (dot) { dot.className = `ccjc-status-dot ${cls}`; dot.textContent = icon; dot.title = proj.statusAnalise; }
}

function selecionarProjeto(chave) {
  coletarEdicoesAtivas();
  const proj = app.pautaAtual?.projetos.find(p => p.chave === chave);
  if (!proj) return;

  app.projetoAtivo = proj;
  mostrarTela('tela-revisao');

  document.querySelectorAll('.prop-item').forEach(el => {
    el.classList.toggle('active', el.dataset.chave === chave);
  });

  renderizarRevisao();
}

function renderizarRevisao() {
  const proj = app.projetoAtivo;
  const cont = document.getElementById('revisao-conteudo');

  if (!proj) {
    cont.innerHTML = '<div class="empty-state" style="margin-top:80px"><p>Selecione um projeto na lista ao lado</p></div>';
    return;
  }

  const analisando  = proj.statusAnalise === 'analisando';
  const temGemini   = !!(app.config.geminiKey || app.config.anthropicKey);
  const roDisabled  = analisando ? 'readonly' : '';

  const comissoesHtml = (proj.comissoes || []).map((com, i) => `
    <div class="ccjc-secao">
      <div class="ccjc-secao-header">
        <span class="ccjc-secao-titulo">${esc(com.nome)} <span style="opacity:.55">(${esc(com.sigla)})</span></span>
      </div>
      <textarea id="campo-comissao-${i}" class="ccjc-textarea" placeholder="Análise da ${esc(com.sigla)}..." ${roDisabled}>${esc(com.resumo || '')}</textarea>
    </div>`).join('');

  const secComissoes = proj.comissoes?.length
    ? `<div class="ccjc-secao-grupo-label">2. Tramitação nas Comissões</div>${comissoesHtml}`
    : (proj.statusAnalise === 'concluido'
        ? `<div class="ccjc-secao"><div class="ccjc-secao-header"><span class="ccjc-secao-titulo">2. Tramitação nas Comissões</span></div><p class="ccjc-empty-secao">Nenhuma comissão identificada na tramitação deste projeto.</p></div>`
        : '');

  const nSecArgs = proj.comissoes?.length ? 3 : 2;
  const nSecArgsCon = nSecArgs + 1;

  cont.innerHTML = `
    <div class="ccjc-revisao-header">
      <div class="ccjc-revisao-badge">${esc(proj.chave)}</div>
      <div class="ccjc-revisao-info">
        <div class="ccjc-revisao-ementa">${esc(proj.ementa || 'Buscando dados na API...')}</div>
        ${proj.autores?.length ? `<div class="ccjc-revisao-meta">Autoria: ${esc(proj.autores.join(', '))}</div>` : ''}
        ${proj.statusApi ? `<div class="ccjc-revisao-meta">Situação: ${esc(proj.statusApi)}</div>` : ''}
      </div>
      <button id="btn-analisar-este" class="btn btn-outline btn-sm" ${analisando || !temGemini ? 'disabled' : ''}>
        ${analisando ? '<span class="loading-spinner"></span> Analisando...' : '✦ Analisar'}
      </button>
    </div>

    ${proj.statusAnalise === 'erro' ? `
      <div class="ccjc-erro-banner">
        <strong>Erro na análise:</strong> ${esc(proj.erroAnalise || 'Erro desconhecido.')}
      </div>` : ''}

    ${analisando ? `<div class="ccjc-loading-overlay"><span class="loading-spinner"></span> Gerando análise com IA…</div>` : ''}

    <div class="ccjc-secao">
      <div class="ccjc-secao-header">
        <span class="ccjc-secao-titulo">1. Resumo do Projeto Original</span>
      </div>
      <textarea id="campo-resumo-original" class="ccjc-textarea" style="min-height:130px"
        placeholder="Resumo gerado pela IA aparecerá aqui. Você pode editar livremente." ${roDisabled}>${esc(proj.resumoOriginal || '')}</textarea>
    </div>

    ${secComissoes}

    <div class="ccjc-secao">
      <div class="ccjc-secao-header">
        <span class="ccjc-secao-titulo">${nSecArgs}. Argumentos Favoráveis à Aprovação</span>
      </div>
      <textarea id="campo-argumentos-fav" class="ccjc-textarea"
        placeholder="Argumentos favoráveis gerados pela IA…" ${roDisabled}>${esc(proj.argumentosFavoraveis || '')}</textarea>
    </div>

    <div class="ccjc-secao" style="margin-bottom:32px">
      <div class="ccjc-secao-header">
        <span class="ccjc-secao-titulo">${nSecArgsCon}. Argumentos Contrários à Aprovação</span>
      </div>
      <textarea id="campo-argumentos-con" class="ccjc-textarea"
        placeholder="Argumentos contrários gerados pela IA…" ${roDisabled}>${esc(proj.argumentosContrarios || '')}</textarea>
    </div>`;

  document.getElementById('btn-analisar-este')
    ?.addEventListener('click', analisarEsteProjetoHandler);
}

async function carregarHistorico() {
  let pautas = [];
  try {
    pautas = await fbCarregarPautas();
    const mapa = {};
    pautas.forEach(p => { if (p) mapa[p.id] = p; });
    await new Promise(r => chrome.storage.local.set({ ccjcPautas: mapa }, r));
  } catch (_) {
    pautas = await localCarregar();
  }

  pautas.sort((a, b) => new Date(b.criada) - new Date(a.criada));

  const lista = document.getElementById('lista-historico-ccjc');
  if (!pautas.length) {
    lista.innerHTML = '<div class="empty-state"><p>Nenhuma pauta anterior</p></div>';
    return;
  }

  lista.innerHTML = pautas.slice(0, 15).map(p => {
    const concluidos = (p.projetos || []).filter(pr => pr.statusAnalise === 'concluido').length;
    const total      = (p.projetos || []).length;
    return `
      <div class="hist-item" data-id="${esc(p.id)}">
        <div class="hist-item-main">
          <div class="hist-item-titulo">${esc(p.titulo)}</div>
          <div class="hist-item-data">${total} projetos · ${concluidos} analisados</div>
        </div>
        <button class="hist-item-delete" data-id="${esc(p.id)}" title="Apagar pauta">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>`;
  }).join('');

  lista.querySelectorAll('.hist-item').forEach(el => {
    el.addEventListener('click', e => {
      if (!e.target.closest('.hist-item-delete')) restaurarPauta(el.dataset.id);
    });
  });

  lista.querySelectorAll('.hist-item-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Apagar esta pauta permanentemente?')) return;
      const id = btn.dataset.id;
      try { await fbApagarPauta(id); } catch (_) {}
      await localApagar(id);

      if (app.pautaAtual?.id === id) {
        app.pautaAtual   = null;
        app.projetoAtivo = null;
        atualizarSidebar();
        mostrarTela('tela-upload');
        document.getElementById('ccjc-action-bar').style.display = 'none';
        document.getElementById('sidebar-projetos-section').style.display = 'none';
      }
      carregarHistorico();
      mostrarToast('Pauta apagada.', '');
    });
  });
}

// ============================================================
//  CONFIGURAÇÕES GEMINI
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
  const geminiKey    = document.getElementById('config-gemini-key').value.trim();
  const modelo       = document.getElementById('config-modelo').value;
  const anthropicKey = document.getElementById('config-anthropic-key').value.trim();
  const antModelo    = document.getElementById('config-anthropic-modelo').value;
  const status       = document.getElementById('config-status-ia');

  if (geminiKey && !geminiKey.startsWith('AIza')) {
    status.textContent   = '⚠ Chave Gemini deve começar com "AIza".';
    status.className     = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  if (anthropicKey && !anthropicKey.startsWith('sk-ant-')) {
    document.getElementById('config-status-anthropic').textContent   = '⚠ Chave Anthropic deve começar com "sk-ant-".';
    document.getElementById('config-status-anthropic').className     = 'config-status erro';
    document.getElementById('config-status-anthropic').style.display = 'block';
    return;
  }

  app.config.geminiKey    = geminiKey;
  if (modelo)    app.config.modelo          = modelo;
  app.config.anthropicKey   = anthropicKey;
  if (antModelo) app.config.anthropicModelo = antModelo;

  await new Promise(r => chrome.storage.local.set({ config: app.config }, r));
  fecharModal('modal-configuracoes');
  const temIa = geminiKey || anthropicKey;
  mostrarToast(
    temIa ? 'Configurações salvas!' : 'Configurações salvas. Configure uma chave de IA para analisar.',
    temIa ? 'sucesso' : 'aviso'
  );
}

async function abrirConfiguracoes() {
  document.getElementById('config-gemini-key').value           = app.config.geminiKey    || '';
  document.getElementById('config-anthropic-key').value        = app.config.anthropicKey || '';
  document.getElementById('config-anthropic-modelo').value     = app.config.anthropicModelo || 'claude-opus-4-7';
  document.getElementById('config-status-ia').style.display        = 'none';
  document.getElementById('config-status-anthropic').style.display = 'none';
  document.getElementById('modelos-status').style.display           = 'none';
  document.getElementById('modal-configuracoes').style.display      = 'flex';
  if (app.config.geminiKey) await carregarModelosDisponiveis();
  atualizarBadgeGemini();
  atualizarBadgeClaude();
}

async function carregarModelosDisponiveis() {
  const key    = document.getElementById('config-gemini-key').value.trim() || app.config.geminiKey;
  const select = document.getElementById('config-modelo');
  const status = document.getElementById('modelos-status');
  const btn    = document.getElementById('btn-carregar-modelos');

  if (!key) {
    status.textContent   = 'Cole a chave de API primeiro.';
    status.style.display = 'block';
    return;
  }

  btn.textContent      = '↻ Carregando...';
  btn.disabled         = true;
  status.style.display = 'none';

  try {
    const res  = await fetch(`${GEMINI_BASE}?key=${key}&pageSize=50`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);

    const modelos = (json.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent') &&
                   !m.name.includes('embedding') && !m.name.includes('aqa'))
      .sort((a, b) => b.name.localeCompare(a.name));

    if (!modelos.length) throw new Error('Nenhum modelo compatível encontrado.');

    const modeloSalvo = app.config.modelo;
    select.innerHTML = modelos.map(m => {
      const id = m.name.replace('models/', '');
      return `<option value="${id}" ${id === modeloSalvo ? 'selected' : ''}>${m.displayName || id}</option>`;
    }).join('');

    if (!select.value) select.selectedIndex = 0;
    status.textContent   = `✓ ${modelos.length} modelos carregados.`;
    status.style.color   = '#3ad97d';
    status.style.display = 'block';

  } catch (err) {
    status.textContent   = `✗ ${err.message}`;
    status.style.color   = 'var(--vermelho)';
    status.style.display = 'block';
  } finally {
    btn.textContent = '↻ Carregar disponíveis';
    btn.disabled    = false;
  }
}

async function testarConexaoIA() {
  const key    = document.getElementById('config-gemini-key').value.trim();
  const modelo = document.getElementById('config-modelo').value || app.config.modelo;
  const status = document.getElementById('config-status-ia');

  if (!key) {
    status.textContent = 'Cole a chave do Gemini antes de testar.';
    status.className   = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  status.textContent   = '⏳ Testando Gemini...';
  status.className     = 'config-status teste';
  status.style.display = 'block';

  try {
    const res  = await fetch(`${GEMINI_BASE}/${modelo}:generateContent?key=${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: 'Responda apenas: OK' }] }] }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    status.textContent = '✓ Gemini conectado e pronto.';
    status.className   = 'config-status ok';
  } catch (err) {
    status.textContent = `✗ Erro: ${err.message}`;
    status.className   = 'config-status erro';
  }
}

function atualizarBadgeGemini() {
  const badge = document.getElementById('badge-gemini');
  if (!badge) return;
  const key = document.getElementById('config-gemini-key').value.trim();
  badge.textContent = key ? '● Configurado' : '○ Não configurado';
  badge.className   = `ccjc-provider-badge ${key ? 'ativo' : 'inativo'}`;
}

function atualizarBadgeClaude() {
  const badge = document.getElementById('badge-anthropic');
  if (!badge) return;
  const key = document.getElementById('config-anthropic-key').value.trim();
  badge.textContent = key ? '● Configurado' : '○ Não configurado';
  badge.className   = `ccjc-provider-badge ${key ? 'ativo' : 'inativo'}`;
}

async function testarConexaoAnthropic() {
  const key    = document.getElementById('config-anthropic-key').value.trim();
  const modelo = document.getElementById('config-anthropic-modelo').value || app.config.anthropicModelo;
  const status = document.getElementById('config-status-anthropic');

  if (!key) {
    status.textContent   = 'Cole a chave Anthropic antes de testar.';
    status.className     = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  status.textContent   = '⏳ Testando Claude...';
  status.className     = 'config-status teste';
  status.style.display = 'block';

  try {
    const res = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'Content-Type':                          'application/json',
        'x-api-key':                             key,
        'anthropic-version':                     ANTHROPIC_VER,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      modelo,
        max_tokens: 16,
        messages:   [{ role: 'user', content: 'Responda apenas: OK' }],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    status.textContent = '✓ Claude conectado e pronto.';
    status.className   = 'config-status ok';
  } catch (err) {
    status.textContent = `✗ Erro: ${err.message}`;
    status.className   = 'config-status erro';
  }
}

// ============================================================
//  UTILITÁRIOS
// ============================================================
async function mapLimit(items, limit, fn) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function mostrarToast(msg, tipo = '') {
  const toast = document.getElementById('toast');
  toast.textContent   = msg;
  toast.className     = `toast ${tipo}`;
  toast.style.display = 'block';
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 4500);
}

// ============================================================
//  CALENDÁRIO – Via Calendário CCJC
// ============================================================

function alternarPainelUpload(painelId) {
  document.querySelectorAll('.ccjc-upload-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.painel === painelId)
  );
  document.getElementById('painel-pdf').style.display       = painelId === 'painel-pdf'        ? '' : 'none';
  document.getElementById('painel-calendario').style.display = painelId === 'painel-calendario' ? '' : 'none';
  if (painelId === 'painel-calendario') inicializarCalendario();
}

async function inicializarCalendario() {
  if (Object.keys(app.cal.eventos).length > 0) { renderizarCalendario(); return; }
  await atualizarCalendario();
}

async function navCalendario(delta) {
  app.cal.mes += delta;
  if (app.cal.mes < 0)  { app.cal.mes = 11; app.cal.ano--; }
  if (app.cal.mes > 11) { app.cal.mes = 0;  app.cal.ano++; }
  app.cal.eventos            = {};
  app.cal.diaSelecionado     = null;
  app.cal.reuniaoSelecionada = null;
  document.getElementById('cal-card-reuniao').style.display = 'none';
  await atualizarCalendario();
}

async function atualizarCalendario() {
  if (app.cal.carregando) return;
  app.cal.carregando = true;
  const status = document.getElementById('cal-status');
  status.textContent = 'Buscando reuniões deliberativas...';
  renderizarCalendario();
  try {
    app.cal.eventos = await buscarEventosMes(app.cal.ano, app.cal.mes);
    renderizarCalendario();
    const n = Object.values(app.cal.eventos).reduce((s, arr) => s + arr.length, 0);
    status.textContent = n > 0
      ? `${n} reunião${n !== 1 ? 'ões' : ''} deliberativa${n !== 1 ? 's' : ''} neste mês`
      : 'Nenhuma reunião deliberativa neste mês';
  } catch (e) {
    status.textContent = `Erro ao buscar reuniões: ${e.message}`;
  } finally {
    app.cal.carregando = false;
  }
}

async function buscarEventosMes(ano, mes) {
  const mm         = String(mes + 1).padStart(2, '0');
  const dataInicio = `${ano}-${mm}-01`;
  const dataFim    = `${ano}-${mm}-${new Date(ano, mes + 1, 0).getDate()}`;
  const cacheKey   = `cal_${ano}_${mes}`;

  const cached = await new Promise(r => chrome.storage.local.get(cacheKey, r));
  if (cached[cacheKey] && Date.now() - cached[cacheKey].ts < 3_600_000) {
    return cached[cacheKey].data;
  }

  const url = `${API_BASE}/orgaos/${CCJC_ORGAO_ID}/eventos?dataInicio=${dataInicio}&dataFim=${dataFim}&itens=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const mapa = {};
  for (const ev of (json.dados || [])) {
    if (ev.descricaoTipo !== 'Reunião Deliberativa') continue;
    const data = (ev.dataHoraInicio || '').split('T')[0];
    if (!data) continue;
    if (!mapa[data]) mapa[data] = [];
    mapa[data].push({
      id:             ev.id,
      dataHoraInicio: ev.dataHoraInicio  || '',
      dataHoraFim:    ev.dataHoraFim     || '',
      descricao:      ev.descricao       || '',
      situacao:       ev.situacao        || '',
      local:          ev.localCamara?.nome || ev.localExterno || '',
    });
  }

  await new Promise(r => chrome.storage.local.set({ [cacheKey]: { data: mapa, ts: Date.now() } }, r));
  return mapa;
}

function renderizarCalendario() {
  const { ano, mes, eventos, diaSelecionado } = app.cal;
  document.getElementById('cal-titulo').textContent = `${MESES_PT[mes]} ${ano}`;

  const grade      = document.getElementById('cal-grade');
  const hoje       = new Date().toISOString().split('T')[0];
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const totalDias   = new Date(ano, mes + 1, 0).getDate();

  let html = '';
  for (let i = 0; i < primeiroDia; i++) html += '<div class="cal-dia vazio"></div>';

  for (let d = 1; d <= totalDias; d++) {
    const mm      = String(mes + 1).padStart(2, '0');
    const dd      = String(d).padStart(2, '0');
    const dataStr = `${ano}-${mm}-${dd}`;
    const classes = [
      'cal-dia',
      eventos[dataStr]  ? 'tem-reuniao' : '',
      dataStr === hoje  ? 'hoje'        : '',
      dataStr === diaSelecionado ? 'selecionado' : '',
    ].filter(Boolean).join(' ');
    html += `<div class="${classes}" data-data="${dataStr}">${d}${eventos[dataStr] ? '<span class="cal-dot"></span>' : ''}</div>`;
  }

  grade.innerHTML = html;
  grade.querySelectorAll('.cal-dia.tem-reuniao').forEach(el => {
    el.addEventListener('click', () => selecionarDiaCalendario(el.dataset.data));
  });
}

function selecionarDiaCalendario(dataStr) {
  app.cal.diaSelecionado     = dataStr;
  app.cal.reuniaoSelecionada = null;
  renderizarCalendario();

  const evs  = app.cal.eventos[dataStr];
  const card = document.getElementById('cal-card-reuniao');
  if (!evs?.length) { card.style.display = 'none'; return; }

  if (evs.length === 1) {
    _exibirCardReuniao(dataStr, evs[0]);
  } else {
    _exibirSeletorReunioes(dataStr, evs);
  }
}

function _exibirCardReuniao(dataStr, ev) {
  app.cal.reuniaoSelecionada = ev;
  const [aStr, mStr, dStr] = dataStr.split('-');
  const horaI = (ev.dataHoraInicio || '').split('T')[1]?.slice(0, 5) || '';
  const horaF = (ev.dataHoraFim   || '').split('T')[1]?.slice(0, 5) || '';

  document.getElementById('cal-card-tipo').textContent     = 'Reunião Deliberativa';
  document.getElementById('cal-card-data').textContent     = `${dStr}/${mStr}/${aStr}${horaI ? ` · ${horaI}${horaF ? '–' + horaF : ''}` : ''}`;
  document.getElementById('cal-card-info').textContent     = ev.local    || '';
  document.getElementById('cal-card-situacao').textContent = ev.situacao || 'Agendada';
  document.getElementById('btn-carregar-pauta-cal').style.display = '';
  document.getElementById('cal-card-reuniao').style.display = '';
}

function _exibirSeletorReunioes(dataStr, evs) {
  const [aStr, mStr, dStr] = dataStr.split('-');

  document.getElementById('cal-card-tipo').textContent     = `${evs.length} reuniões neste dia`;
  document.getElementById('cal-card-data').textContent     = `${dStr}/${mStr}/${aStr} — selecione uma:`;
  document.getElementById('cal-card-info').textContent     = '';
  document.getElementById('cal-card-situacao').innerHTML   = evs.map((ev, i) => {
    const horaI = (ev.dataHoraInicio || '').split('T')[1]?.slice(0, 5) || '??:??';
    const horaF = (ev.dataHoraFim   || '').split('T')[1]?.slice(0, 5) || '';
    const local = ev.local ? ` · ${ev.local}` : '';
    return `<button class="cal-reuniao-opcao btn btn-outline btn-sm" data-idx="${i}" style="display:block;width:100%;margin-bottom:6px;text-align:left">
      <strong>${horaI}${horaF ? '–' + horaF : ''}</strong>${local}<br>
      <span style="font-size:11px;opacity:.7">${esc(ev.situacao || 'Agendada')}</span>
    </button>`;
  }).join('');
  document.getElementById('btn-carregar-pauta-cal').style.display = 'none';
  document.getElementById('cal-card-reuniao').style.display = '';

  document.querySelectorAll('.cal-reuniao-opcao').forEach(btn => {
    btn.addEventListener('click', () => {
      _exibirCardReuniao(dataStr, evs[+btn.dataset.idx]);
    });
  });
}

async function buscarPautaEvento(eventoId) {
  const res = await fetch(`${API_BASE}/eventos/${eventoId}/pauta`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    // API retorna JSON quando chamada pela extensão (sem Accept: text/html)
    const json = JSON.parse(text);
    return _parsearPautaJSON(json.dados || []);
  } catch {
    // Fallback: XML (comportamento do browser)
    return _parsearPautaXML(text);
  }
}

const _SIGLAS_PARECER = new Set(['PAR', 'PRL', 'VTS', 'VEN', 'VCM']);

function _parsearPautaJSON(itens) {
  const vistos = new Set();
  return itens.reduce((acc, item) => {
    const rel  = item.proposicaoRelacionada_;
    const prop = item.proposicao_;

    // Prefer the related proposition; fall back to the item itself if it's not a parecer
    const src = (rel?.id)
      ? rel
      : (!_SIGLAS_PARECER.has(prop?.siglaTipo) && prop?.id ? prop : null);

    if (!src?.id || vistos.has(src.id)) return acc;
    vistos.add(src.id);
    acc.push({
      chave:                item.titulo || `${src.siglaTipo} ${src.numero}/${src.ano}`,
      sigla:                src.siglaTipo || '',
      numero:               parseInt(src.numero, 10) || 0,
      ano:                  parseInt(src.ano,    10) || 0,
      idCamara:             parseInt(src.id,     10),
      ementa:               src.ementa || '',
      autores:              [],
      relator:              item.relator?.nome || '',
      topico:               item.topico  || '',
      statusApi:            '',
      resumoOriginal:       '',
      comissoes:            [],
      argumentosFavoraveis: '',
      argumentosContrarios: '',
      statusAnalise:        'pendente',
      erroAnalise:          '',
    });
    return acc;
  }, []);
}

function _parsearPautaXML(xmlText) {
  const doc    = new DOMParser().parseFromString(xmlText, 'text/xml');
  const itens  = Array.from(doc.querySelectorAll('itemPauta'));
  const vistos = new Set();
  const result = [];

  for (const item of itens) {
    const propRel  = item.querySelector('proposicaoRelacionada_');
    const relId    = propRel?.querySelector('id')?.textContent?.trim();

    // When proposicaoRelacionada_ has no id, fall back to proposicao_ itself
    // but skip if it's a parecer/voto (PAR, PRL, VTS, VEN, VCM)
    let srcEl = propRel;
    let id    = relId;
    if (!id) {
      const propEl    = item.querySelector('proposicao_');
      const propSigla = propEl?.querySelector('siglaTipo')?.textContent?.trim() || '';
      if (!_SIGLAS_PARECER.has(propSigla)) {
        srcEl = propEl;
        id    = propEl?.querySelector('id')?.textContent?.trim();
      }
    }

    if (!id || vistos.has(id)) continue;
    vistos.add(id);

    const siglaTipo = srcEl?.querySelector('siglaTipo')?.textContent || '';
    const numero    = srcEl?.querySelector('numero')?.textContent    || '0';
    const ano       = srcEl?.querySelector('ano')?.textContent       || '0';
    const ementa    = srcEl?.querySelector('ementa')?.textContent    || '';
    const titulo    = item.querySelector('titulo')?.textContent      || `${siglaTipo} ${numero}/${ano}`;
    const relNome   = item.querySelector('relator nome')?.textContent || '';
    const topico    = item.querySelector('topico')?.textContent       || '';

    result.push({
      chave:                titulo,
      sigla:                siglaTipo,
      numero:               parseInt(numero, 10) || 0,
      ano:                  parseInt(ano,    10) || 0,
      idCamara:             parseInt(id,     10),
      ementa,
      autores:              [],
      relator:              relNome,
      topico,
      statusApi:            '',
      resumoOriginal:       '',
      comissoes:            [],
      argumentosFavoraveis: '',
      argumentosContrarios: '',
      statusAnalise:        'pendente',
      erroAnalise:          '',
    });
  }
  return result;
}

async function carregarPautaDoCalendario() {
  const dia = app.cal.diaSelecionado;
  const ev  = app.cal.reuniaoSelecionada;
  if (!ev) return;

  const btn = document.getElementById('btn-carregar-pauta-cal');
  btn.disabled    = true;
  btn.textContent = '⏳ Carregando...';

  try {
    mostrarToast('Buscando pauta da reunião na API da Câmara...', '');
    const projetos = await buscarPautaEvento(ev.id);

    if (!projetos.length) {
      mostrarToast('Nenhuma proposição encontrada na pauta desta reunião.', 'aviso');
      return;
    }

    const [aStr, mStr, dStr] = dia.split('-');
    const titulo = `CCJC – ${dStr}/${mStr}/${aStr}`;

    const pauta = {
      id:      `ccjc-${Date.now()}`,
      titulo,
      criada:  new Date().toISOString(),
      origem:  { tipo: 'calendario', eventoId: ev.id, data: dia },
      projetos,
    };

    app.pautaAtual   = pauta;
    app.projetoAtivo = null;

    atualizarSidebar();
    renderizarListaProjetos();
    mostrarTela('tela-revisao');
    document.getElementById('ccjc-action-bar').style.display = 'flex';
    document.getElementById('revisao-conteudo').innerHTML =
      '<div class="empty-state" style="margin-top:80px"><p>Selecione um projeto na lista ao lado</p></div>';

    mostrarToast(`${projetos.length} projetos carregados. Buscando dados adicionais na API...`, '');
    await buscarMetadadosTodos(projetos);
    renderizarListaProjetos();
    mostrarToast('Pauta carregada. Clique em "Analisar Todos" para gerar as análises via IA.', 'sucesso');

  } catch (e) {
    mostrarToast(`Erro ao carregar pauta: ${e.message}`, 'erro');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Carregar Proposições desta Reunião';
  }
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escHtml(str) {
  return esc(str).replace(/\n/g, '<br>');
}
