/* ============================================================
   PAUTAS CCJC – PODEMOS
   Módulo de análise de projetos da CCJC com suporte a múltiplos
   provedores de IA: Google Gemini e Groq (ambos gratuitos).
   ============================================================ */

'use strict';

// ---------- CONSTANTES ----------
const API_BASE     = 'https://dadosabertos.camara.leg.br/api/v2';
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_BASE    = 'https://api.groq.com/openai/v1/chat/completions';
const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';

const GROQ_MODELOS = [
  { id: 'llama-3.3-70b-versatile',       label: 'Llama 3.3 70B Versatile (recomendado)' },
  { id: 'llama-3.1-8b-instant',          label: 'Llama 3.1 8B Instant (mais rápido, +RPD)' },
  { id: 'llama-4-scout-17b-16e-instruct',label: 'Llama 4 Scout 17B'                      },
  { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B'                },
  { id: 'qwen/qwen3-32b',                label: 'Qwen3 32B'                               },
];

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
  providerRR:   0,   // índice para round-robin entre provedores
  config: {
    geminiKey:    '',
    modelo:       'gemini-2.5-flash-preview-04-17',
    groqKey:      '',
    groqModelo:   'llama-3.3-70b-versatile',
    iaEstrategia: 'auto', // 'auto' | 'gemini' | 'groq'
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
  document.getElementById('btn-testar-groq').addEventListener('click', testarGroq);
  document.getElementById('btn-toggle-groq-key').addEventListener('click', () => {
    const input = document.getElementById('config-groq-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Atualiza badges em tempo real ao digitar as chaves
  ['config-gemini-key','config-groq-key'].forEach(id => {
    document.getElementById(id)
      ?.addEventListener('input', atualizarBadgesProvedores);
  });

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
  const mapa = {};

  // Passo 1: constrói mapa sigla→nome completo a partir de cabeçalhos e células
  // A página da Câmara usa padrões como "COMISSÃO DE AGRICULTURA... (CAPADR)" ou
  // "CAPADR - Comissão de Agricultura..."
  const nomeCompleto = {};
  const textoTotal = doc.body?.textContent || '';
  // Padrão: texto maiúsculo seguido de (SIGLA) — ex: "... RURAL (CAPADR)"
  const rNome = /([A-ZÀÁÂÃÉÊÍÓÔÕÚ][A-ZÀÁÂÃÉÊÍÓÔÕÚ,\s]+?)\s*[\(—–-]\s*([A-Z]{3,8})\s*\)?/g;
  let mm;
  while ((mm = rNome.exec(textoTotal)) !== null) {
    const sigla = mm[2].trim();
    if (!_siglaIgnorada(sigla)) nomeCompleto[sigla] = mm[1].trim();
  }

  // Passo 2: coleta todos os links de documentos (amplo para cobrir variações)
  const links = Array.from(doc.querySelectorAll(
    'a[href*="prop_mostrarintegra"], a[href*="prop_GetPublicacoes"], ' +
    'a[href*="codteor"], a[href*="fileserv"], a[href*=".pdf"], a[href*=".doc"]'
  )).filter(a => {
    const h = a.getAttribute('href') || '';
    // Exclui links de navegação / externos sem relação com documentos
    return h && !h.startsWith('#') && !h.includes('javascript:');
  });

  for (const link of links) {
    const rawHref = link.getAttribute('href') || '';

    const docUrl = rawHref.startsWith('http')
      ? rawHref
      : `https://www.camara.leg.br${rawHref.startsWith('/') ? rawHref : '/proposicoesWeb/' + rawHref}`;

    // Estratégia 1: sigla no parâmetro filename da URL (mais confiável)
    //   ex: ?codteor=XXXXX&filename=Parecer-CAPADR-PL+1737%2F2023.docx
    const filenameMatch = rawHref.match(/[?&]filename=([^&]+)/i);
    if (filenameMatch) {
      const filename = decodeURIComponent(filenameMatch[1].replace(/\+/g, ' '));
      const sigla = _extrairSiglaDeTexto(filename);
      if (sigla && !mapa[sigla]) {
        mapa[sigla] = { nome: nomeCompleto[sigla] || sigla, url: docUrl };
        continue;
      }
    }

    // Estratégia 2: texto do próprio link
    const textoLink = (link.textContent || '').trim();
    if (textoLink.length > 2) {
      const sigla = _extrairSiglaDeTexto(textoLink);
      if (sigla && !mapa[sigla]) {
        mapa[sigla] = { nome: nomeCompleto[sigla] || textoLink.slice(0, 100), url: docUrl };
        continue;
      }
    }

    // Estratégia 3: sigla no contexto DOM próximo ao link (até 8 níveis)
    let ancestor = link.parentElement;
    for (let d = 0; d < 8 && ancestor; d++) {
      const textoLocal = Array.from(ancestor.childNodes)
        .filter(n => n.nodeType === 3 || /^(TD|TH|H[1-6]|STRONG|B|SPAN|CAPTION|LABEL)$/i.test(n.nodeName))
        .map(n => n.textContent || '')
        .join(' ');

      const sigla = _extrairSiglaDeTexto(textoLocal);
      if (sigla && !mapa[sigla]) {
        mapa[sigla] = { nome: nomeCompleto[sigla] || textoLocal.trim().slice(0, 100), url: docUrl };
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  // Passo 3: se ainda não encontramos comissões mas temos nomes, tenta associar
  // qualquer link de documento ao nome de comissão mais próximo na página
  if (Object.keys(mapa).length === 0 && Object.keys(nomeCompleto).length > 0) {
    const todoLinks = Array.from(doc.querySelectorAll('a[href]'))
      .filter(a => {
        const h = a.getAttribute('href') || '';
        return h && !h.startsWith('#') && !h.includes('javascript:');
      });
    for (const [sigla, nome] of Object.entries(nomeCompleto)) {
      // Busca link próximo a qualquer menção da sigla
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

  console.debug('[CCJC] pareceresMap:', mapa);
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
//  CAMADA DE IA – MULTI-PROVEDOR (Gemini + Groq)
// ============================================================

/** Retorna provedores disponíveis conforme chaves configuradas e estratégia. */
function provedoresDisponiveis() {
  const { geminiKey, groqKey, iaEstrategia } = app.config;
  if (iaEstrategia === 'gemini') return geminiKey ? ['gemini'] : [];
  if (iaEstrategia === 'groq')   return groqKey   ? ['groq']   : [];
  // auto: todos os que têm chave
  const p = [];
  if (geminiKey) p.push('gemini');
  if (groqKey)   p.push('groq');
  return p;
}

/**
 * Ponto de entrada principal para chamadas de IA.
 * Faz round-robin entre provedores disponíveis e aplica fallback automático.
 * @param {string}      prompt  - Prompt de texto
 * @param {string|null} docUrl  - URL opcional de documento para contexto
 * @returns {Promise<string>}
 */
async function aiCall(prompt, docUrl = null) {
  const provedores = provedoresDisponiveis();
  if (!provedores.length) {
    throw new Error('Nenhum provedor de IA configurado. Configure Gemini ou Groq em ⚙ Configurações.');
  }

  // Round-robin: escolhe o próximo provedor
  const idx      = app.providerRR % provedores.length;
  app.providerRR = (app.providerRR + 1) % provedores.length;
  const primario = provedores[idx];
  const reserva  = provedores.find(p => p !== primario) || null;

  try {
    return await _despacharIA(primario, prompt, docUrl);
  } catch (err) {
    if (reserva) {
      const motivo = err.message?.slice(0, 80);
      console.warn(`[IA] ${primario} falhou (${motivo}). Tentando ${reserva}…`);
      mostrarToast(`${primario} indisponível, usando ${reserva} como fallback.`, 'aviso');
      return await _despacharIA(reserva, prompt, docUrl);
    }
    throw err;
  }
}

async function _despacharIA(provedor, prompt, docUrl) {
  if (provedor === 'gemini') return _callGemini(prompt, docUrl);
  if (provedor === 'groq')   return _callGroq(prompt, docUrl);
  throw new Error(`Provedor desconhecido: ${provedor}`);
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

// ---------- GROQ ----------
async function _callGroq(prompt, docUrl = null) {
  const { groqKey, groqModelo } = app.config;
  if (!groqKey) throw new Error('Chave Groq não configurada.');

  let fullPrompt = prompt;

  if (docUrl) {
    try {
      const res = await fetch(docUrl);
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('pdf')) {
          // Groq aceita apenas texto — extrai HTML e anexa ao prompt
          const clean = _extrairTextoHTML(await res.text());
          if (clean.length > 200) fullPrompt += `\n\n---\nTexto do documento:\n${clean}`;
        }
        // PDFs são ignorados no Groq (sem inline_data); o contexto textual da tramitação é suficiente
      }
    } catch (e) { console.warn('Groq: erro ao buscar doc:', e.message); }
  }

  const res = await fetch(GROQ_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model:      groqModelo || 'llama-3.3-70b-versatile',
      messages:   [{ role: 'user', content: fullPrompt }],
      max_tokens: 1024,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Groq HTTP ${res.status}`);
  return json.choices?.[0]?.message?.content?.trim() || '';
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

  if (!app.config.geminiKey) {
    mostrarToast('Configure a chave Gemini em ⚙ Configurações antes de analisar.', 'aviso');
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
  app.providerRR  = 0; // reinicia round-robin para distribuição uniforme
  const btn = document.getElementById('btn-analisar-todos');
  btn.disabled  = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Analisando...';

  const nomes = provedoresDisponiveis().join(' + ') || 'nenhum';
  mostrarToast(`Iniciando análise de ${pendentes.length} projetos · 5 simultâneos · provedores: ${nomes}`, '');

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
  if (!app.config.geminiKey) {
    mostrarToast('Configure a chave Gemini em ⚙ Configurações.', 'aviso');
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
  const temGemini   = !!app.config.geminiKey;
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
  const groqKey      = document.getElementById('config-groq-key').value.trim();
  const groqModelo   = document.getElementById('config-groq-modelo').value;
  const iaEstrategia = document.getElementById('config-estrategia').value;
  const status       = document.getElementById('config-status-ia');

  if (geminiKey && !geminiKey.startsWith('AIza')) {
    status.textContent   = '⚠ Chave Gemini deve começar com "AIza".';
    status.className     = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  app.config.geminiKey    = geminiKey;
  if (modelo)     app.config.modelo       = modelo;
  app.config.groqKey      = groqKey;
  app.config.groqModelo   = groqModelo   || 'llama-3.3-70b-versatile';
  app.config.iaEstrategia = iaEstrategia || 'auto';

  await new Promise(r => chrome.storage.local.set({ config: app.config }, r));
  fecharModal('modal-configuracoes');

  const provedores = provedoresDisponiveis();
  mostrarToast(
    provedores.length
      ? `Configurações salvas! Provedores ativos: ${provedores.join(' + ')}`
      : 'Configurações salvas. Configure ao menos uma chave de IA para analisar.',
    provedores.length ? 'sucesso' : 'aviso'
  );
}

async function abrirConfiguracoes() {
  document.getElementById('config-gemini-key').value        = app.config.geminiKey    || '';
  document.getElementById('config-groq-key').value          = app.config.groqKey      || '';
  document.getElementById('config-groq-modelo').value       = app.config.groqModelo   || 'llama-3.3-70b-versatile';
  document.getElementById('config-estrategia').value        = app.config.iaEstrategia || 'auto';
  document.getElementById('config-status-ia').style.display    = 'none';
  document.getElementById('config-status-groq').style.display  = 'none';
  document.getElementById('modelos-status').style.display       = 'none';
  document.getElementById('modal-configuracoes').style.display  = 'flex';
  if (app.config.geminiKey) await carregarModelosDisponiveis();
  atualizarBadgesProvedores();
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

async function testarGroq() {
  const key    = document.getElementById('config-groq-key').value.trim();
  const modelo = document.getElementById('config-groq-modelo').value || 'llama-3.3-70b-versatile';
  const status = document.getElementById('config-status-groq');

  if (!key) {
    status.textContent   = 'Cole a chave do Groq antes de testar.';
    status.className     = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  status.textContent   = '⏳ Testando Groq...';
  status.className     = 'config-status teste';
  status.style.display = 'block';

  try {
    const res = await fetch(GROQ_BASE, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model:    modelo,
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        max_tokens: 5,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    status.textContent = '✓ Groq conectado e pronto.';
    status.className   = 'config-status ok';
  } catch (err) {
    status.textContent = `✗ Erro: ${err.message}`;
    status.className   = 'config-status erro';
  }
}

function atualizarBadgesProvedores() {
  const gemini = document.getElementById('badge-gemini');
  const groq   = document.getElementById('badge-groq');
  const geminiKey = document.getElementById('config-gemini-key').value.trim();
  const groqKey   = document.getElementById('config-groq-key').value.trim();

  if (gemini) {
    gemini.textContent = geminiKey ? '● Configurado' : '○ Não configurado';
    gemini.className   = `ccjc-provider-badge ${geminiKey ? 'ativo' : 'inativo'}`;
  }
  if (groq) {
    groq.textContent = groqKey ? '● Configurado' : '○ Não configurado';
    groq.className   = `ccjc-provider-badge ${groqKey ? 'ativo' : 'inativo'}`;
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

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escHtml(str) {
  return esc(str).replace(/\n/g, '<br>');
}
