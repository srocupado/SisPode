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
const OPENAI_BASE     = 'https://api.openai.com/v1/responses';
const ANTHROPIC_VER   = '2023-06-01';
const FIREBASE_URL   = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const CCJC_ORGAO_ID  = 2003;
const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Órgãos administrativos que não devem ser listados como comissões de mérito
const ORGAOS_ADMIN = new Set([
  'PLEN','SGM','MESA','PR','SGL','DETAQ','SPL','CORD','CCP',
  'GSIST','CLP','CMO','CVT','SECGER','SECLEG','DRH',
]);

// ---------- ESTADO ----------
let app = {
  pautaAtual:   null,
  projetoAtivo: null,
  processando:  false,
  toastTimer:   null,
  selecionados: new Set(),   // chaves de projetos marcados para "Analisar selecionados"
  cal: {
    ano:              new Date().getFullYear(),
    mes:              new Date().getMonth(),
    eventos:          {},   // { 'YYYY-MM-DD': [ { id, dataHoraInicio, ... }, ... ] }
    carregando:       false,
    diaSelecionado:   null,
    reuniaoSelecionada: null,
  },
  config: {
    provedorAtivo:  '',   // 'gemini' | 'anthropic' | 'openai' (vazio = automático, 1º configurado)
    geminiKey:      '',
    modelo:         'gemini-2.5-flash-preview-04-17',
    anthropicKey:   '',
    anthropicModelo:'claude-opus-4-8',
    openaiKey:      '',
    openaiModelo:   'gpt-4o',
  },
  perfis:         [],   // [{ id, nome, texto, criadoPor, criadoEm, atualizadoEm }] — Firebase compartilhado
  perfilPadraoId: null, // id do perfil de prompt aplicado por padrão nas análises (compartilhado pela equipe)
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
  // Carrega a biblioteca de perfis de prompt compartilhada (não bloqueia a UI)
  carregarBibliotecaPerfis().catch(e => console.warn('Falha ao carregar perfis:', e.message));
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
  document.getElementById('btn-carregar-anthropic-modelos').addEventListener('click', carregarModelosAnthropic);
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('config-gemini-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-analisar-todos').addEventListener('click', analisarTodos);
  document.getElementById('btn-analisar-selecionados')?.addEventListener('click', analisarSelecionados);
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
  document.getElementById('btn-carregar-openai-modelos')
    ?.addEventListener('click', carregarModelosOpenAI);
  document.getElementById('config-openai-key')
    ?.addEventListener('input', atualizarBadgeOpenai);
  document.getElementById('btn-toggle-openai-key')
    ?.addEventListener('click', () => {
      const input = document.getElementById('config-openai-key');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  document.getElementById('btn-testar-openai')
    ?.addEventListener('click', testarConexaoOpenAI);

  // Perfis de prompt
  document.getElementById('perfil-select')?.addEventListener('change', refletirSelecaoPerfil);
  document.getElementById('btn-perfil-salvar')?.addEventListener('click', salvarPerfilNovo);
  document.getElementById('btn-perfil-atualizar')?.addEventListener('click', atualizarPerfil);
  document.getElementById('btn-perfil-excluir')?.addEventListener('click', excluirPerfil);
  document.getElementById('perfil-padrao')?.addEventListener('change', onPerfilPadraoToggle);

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
      urlInteiroTeor:       null,
      resumoOriginal:       '',
      comissoes:            [],
      argumentosFavoraveis: '',
      argumentosContrarios: '',
      refsSuspeitas:        [],
      statusAnalise:        'pendente',
      erroAnalise:          '',
    })),
  };

  fecharModal('modal-nova-pauta');
  app.pautaAtual   = pauta;
  app.projetoAtivo = null;
  app.selecionados.clear();

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

// Cabeçalhos de seção típicos das pautas da CCJC. Usados para descobrir sob
// qual bloco cada proposição aparece no PDF — em especial o bloco de
// "Redação Final" (apreciação de texto final, não de mérito).
const _SECOES_PAUTA = [
  { re: /reda[çc][ãa]o\s+final(?:\s+do\s+vencido)?/gi, rf: true },
  { re: /requerimentos?/gi, rf: false },
  { re: /propos[ií][çc][õo]es\s+sujeitas?\s+[àa]\s+aprecia[çc][ãa]o/gi, rf: false },
  { re: /aprecia[çc][ãa]o\s+(?:conclusiva|do\s+plen[áa]rio)/gi, rf: false },
  { re: /\bavisos?\b/gi, rf: false },
  { re: /audi[êe]ncias?\s+p[úu]blicas?/gi, rf: false },
];

function extrairReferencias(texto) {
  // Mapeia a posição de cada cabeçalho de seção encontrado no texto.
  const marcos = [];
  for (const sec of _SECOES_PAUTA) {
    const r = new RegExp(sec.re.source, 'gi');
    let mm;
    while ((mm = r.exec(texto)) !== null) marcos.push({ idx: mm.index, rf: sec.rf });
  }
  marcos.sort((a, b) => a.idx - b.idx);

  // Uma proposição é "Redação Final" quando o cabeçalho de seção mais próximo
  // ANTES dela é um cabeçalho de Redação Final.
  const ehRfNaPosicao = pos => {
    let rf = false;
    for (const mk of marcos) {
      if (mk.idx <= pos) rf = mk.rf; else break;
    }
    return rf;
  };

  const regex = /\b(PL|PEC|PLN|PLP|PLV|PDC|PRC|MPV|REQ|INC)\s*[nº°.]*\s*(\d{1,5})[,.\/\s]*(?:de\s+)?(\d{4})\b/gi;
  const porChave = new Map();
  const refs     = [];
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const sigla  = m[1].toUpperCase();
    const numero = parseInt(m[2], 10);
    const ano    = parseInt(m[3], 10);
    if (ano < 1990 || ano > new Date().getFullYear() + 1) continue;
    const chave = `${sigla} ${numero}/${ano}`;
    const rf    = ehRfNaPosicao(m.index);

    const existente = porChave.get(chave);
    if (existente) {
      // Uma proposição é Redação Final se QUALQUER ocorrência dela cair no
      // bloco de Redação Final — não apenas a primeira menção, que pode estar
      // num sumário/índice no topo do PDF, fora do bloco.
      if (rf) existente.redacaoFinal = true;
    } else {
      const ref = { sigla, numero, ano, chave, redacaoFinal: rf };
      porChave.set(chave, ref);
      refs.push(ref);
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
        proj.idCamara       = dados.id;
        proj.ementa         = dados.ementa;
        proj.autores        = dados.autores;
        proj.statusApi      = dados.statusDesc;
        proj.urlInteiroTeor = dados.urlInteiroTeor || null;
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

  // O endpoint de LISTA não traz urlInteiroTeor nem statusProposicao; o DETALHE
  // (/proposicoes/{id}) traz. É de lá que sai o link do inteiro teor.
  let detalhe = item;
  try {
    const resD = await fetch(`${API_BASE}/proposicoes/${item.id}`);
    if (resD.ok) detalhe = (await resD.json()).dados || item;
  } catch (_) {}

  let autores = [];
  try {
    const resA = await fetch(`${API_BASE}/proposicoes/${item.id}/autores`);
    if (resA.ok) {
      const jA = await resA.json();
      autores  = (jA.dados || []).slice(0, 3).map(a => a.nome).filter(Boolean);
    }
  } catch (_) {}

  return {
    id:             item.id,
    ementa:         detalhe.ementa || item.ementa,
    autores,
    statusDesc:     detalhe.statusProposicao?.descricaoSituacao || '',
    urlInteiroTeor: detalhe.urlInteiroTeor || null,
  };
}

async function buscarTramitacoes(idCamara) {
  try {
    // Atenção: este endpoint NÃO aceita os parâmetros ?ordem/?itens (retorna 400).
    // Vem ordenado por sequência ascendente por padrão.
    const res = await fetch(`${API_BASE}/proposicoes/${idCamara}/tramitacoes`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.dados || [];
  } catch (_) { return []; }
}

// ---------- Documentos de parecer (substitutivo, complementação de voto…) ----------
// Espécies documentais que NÃO são comissões. Usadas para (a) não confundir o
// tipo do documento com a sigla do órgão e (b) rotular cada documento.
const _TIPOS_DOCUMENTO = {
  'PRL':  'Parecer do Relator',
  'PRLP': 'Parecer do Relator',
  'PRLE': 'Parecer do Relator às Emendas',
  'PAR':  'Parecer',
  'SBT':  'Substitutivo',
  'CVO':  'Complementação de Voto',
  'VTS':  'Voto em Separado',
  'VOTO': 'Voto em Separado',
  'DCR':  'Declaração de Voto',
  'REL':  'Relatório',
  'CPR':  'Complementação de Parecer',
};
// Inclui as variantes com sufixo (ex.: "SBT-A").
const _SIGLAS_DOC = new Set(Object.keys(_TIPOS_DOCUMENTO).flatMap(k => [k, k.split('-')[0]]));

function _rotuloTipoDoc(tipo, numero) {
  const base = _TIPOS_DOCUMENTO[tipo] || _TIPOS_DOCUMENTO[tipo.split('-')[0]] || tipo;
  const suf  = tipo.includes('-') ? ' (adendo)' : '';
  return (numero && Number(numero) > 1) ? `${base}${suf} ${numero}` : `${base}${suf}`;
}

// Extrai a lista de documentos de parecer da página da Câmara. O nome de cada
// arquivo segue o padrão "TIPO N ORGAO => PL X/AAAA" (ex.: "SBT-A 1 CICS => PL
// 4507/2024"), de onde derivamos a espécie do documento E a comissão de origem.
// Retorna [{ tipo, numero, orgao, url, codteor, rotulo }].
function _extrairDocumentosPareceres(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = Array.from(doc.querySelectorAll('a[href*="filename="], a[href*="prop_mostrarintegra"], a[href*="prop_GetPublicacoes"], a[href*="codteor"]'));
  const docs   = [];
  const vistos = new Set();
  for (const a of links) {
    const rawHref = a.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#') || rawHref.includes('javascript:')) continue;

    // Nome do documento: parâmetro filename da URL (preferido) ou texto do link.
    let nomeDoc = '';
    const mF = rawHref.match(/[?&]filename=([^&]+)/i);
    if (mF) nomeDoc = decodeURIComponent(mF[1].replace(/\+/g, ' '));
    if (!nomeDoc) nomeDoc = (a.textContent || '').trim();

    const m = nomeDoc.match(/^\s*([A-Z]{2,5}(?:-[A-Z])?)\s+(\d+)\s+([A-Z]{2,8})\b/);
    if (!m) continue;
    const tipo  = m[1].toUpperCase();
    const orgao = m[3].toUpperCase();
    // O "órgão" não pode ser, ele mesmo, uma espécie documental nem um órgão administrativo.
    if (_SIGLAS_DOC.has(orgao) || ORGAOS_ADMIN.has(orgao)) continue;

    const url = rawHref.startsWith('http')
      ? rawHref
      : `https://www.camara.leg.br${rawHref.startsWith('/') ? rawHref : '/proposicoesWeb/' + rawHref}`;
    const codteor = Number((rawHref.match(/codteor=(\d+)/) || [])[1]) || 0;

    const chave = `${tipo}|${m[2]}|${orgao}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    docs.push({ tipo, numero: m[2], orgao, url, codteor, rotulo: _rotuloTipoDoc(tipo, m[2]) });
  }
  return docs;
}

// Resolve nome completo e tipo do órgão via API (com cache). Permite exibir o
// nome correto da comissão e descartar não-comissões.
const _orgaoCache = {};
async function _resolverOrgao(sigla) {
  if (_orgaoCache[sigla]) return _orgaoCache[sigla];
  let info = { sigla, nome: sigla, ehComissao: !ORGAOS_ADMIN.has(sigla) };
  try {
    const res = await fetch(`${API_BASE}/orgaos?sigla=${encodeURIComponent(sigla)}&itens=1`);
    if (res.ok) {
      const o = (await res.json()).dados?.[0];
      if (o) {
        // Só comissões de mérito (Permanente/Especial/Mista…). Exclui "Comissão
        // Diretora" (Mesa) e órgãos como "Coordenação de Comissões Permanentes".
        const tipo = o.tipoOrgao || '';
        info = { sigla, nome: o.nome || sigla, ehComissao: /^comiss[ãa]o/i.test(tipo) && !/diretora/i.test(tipo) };
      }
    }
  } catch (_) {}
  _orgaoCache[sigla] = info;
  return info;
}

// Retorna todos os documentos de parecer da página, cada um com sua espécie e
// órgão. Permite agrupar por comissão e enviar à IA o conjunto completo
// (parecer + substitutivo + complementação de voto). A página da Câmara é a
// única fonte confiável desses documentos.
async function buscarDocumentosComissoes(idCamara) {
  const url = `https://www.camara.leg.br/proposicoesWeb/prop_pareceres_substitutivos_votos?idProposicao=${idCamara}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const html = await res.text();
    const docs = _extrairDocumentosPareceres(html);
    if (docs.length) return docs;
    // Fallback (estrutura de página antiga): mapa sigla→url, sem espécie documental.
    const mapa = _parsearPaginaPareceres(html);
    return Object.entries(mapa)
      .filter(([sigla]) => !_SIGLAS_DOC.has(sigla) && !ORGAOS_ADMIN.has(sigla))
      .map(([sigla, info]) => ({ tipo: 'PAR', numero: '1', orgao: sigla, url: info.url, codteor: 0, rotulo: 'Parecer' }));
  } catch (e) {
    console.warn('Erro ao buscar documentos das comissões:', e.message);
    return [];
  }
}

/**
 * Estratégia principal: localiza o cabeçalho "Pareceres Aprovados ou Pendentes
 * de Aprovação" e extrai cada linha da tabela que vem em seguida.
 * Estrutura típica:
 *   <h2/h3>Pareceres Aprovados ou Pendentes de Aprovação</h2>
 *   <table>
 *     <tr><th>Comissão</th><th>Parecer</th></tr>
 *     <tr>
 *       <td>Comissão de Constituição e Justiça e de Cidadania (CCJC)</td>
 *       <td>10/03/2026 - Parecer da Relatora ... <a href="...">Inteiro teor</a></td>
 *     </tr>
 *   </table>
 */
function _extrairDaTabelaPareceres(doc) {
  const mapa = {};

  // Localiza qualquer elemento de texto que seja o cabeçalho da seção
  const cabecalhos = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, caption, strong, b, div, span'))
    .filter(el => {
      const t = (el.textContent || '').trim();
      return /pareceres\s+aprovad/i.test(t) &&
             /pendentes?\s+de\s+aprova/i.test(t) &&
             t.length < 120;
    });

  for (const cab of cabecalhos) {
    // Procura a próxima <table> que apareça depois do cabeçalho
    let tabela = null;
    let cursor = cab;
    for (let i = 0; i < 20 && cursor; i++) {
      // tenta irmãos seguintes
      let sib = cursor.nextElementSibling;
      while (sib) {
        if (sib.tagName === 'TABLE') { tabela = sib; break; }
        const innerTbl = sib.querySelector?.('table');
        if (innerTbl) { tabela = innerTbl; break; }
        sib = sib.nextElementSibling;
      }
      if (tabela) break;
      cursor = cursor.parentElement;
    }
    if (!tabela) continue;

    // Itera linhas (ignora <tr> de cabeçalho que só tem <th>)
    for (const tr of tabela.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) continue;

      const textoComissao = (tds[0].textContent || '').trim();
      const celulaParecer = tds[1];

      // Sigla entre parênteses: "(CCJC)", "(CDHM)", etc.
      const mSigla = textoComissao.match(/\(([A-Z]{3,8})\)/);
      if (!mSigla) continue;
      const sigla = mSigla[1];
      if (_siglaIgnorada(sigla)) continue;

      // Nome completo: tudo antes do "(SIGLA)"
      const nome = textoComissao.slice(0, mSigla.index).trim().replace(/\s+/g, ' ');

      // Link "Inteiro teor" — busca por texto, mas também aceita qualquer link
      // dentro da célula como fallback
      const links = Array.from(celulaParecer.querySelectorAll('a[href]'));
      const linkTeor =
        links.find(a => /inteiro\s+teor/i.test(a.textContent || '')) ||
        links.find(a => {
          const h = a.getAttribute('href') || '';
          return /codteor|mostrarintegra|fileserv|\.pdf|\.doc/i.test(h);
        }) ||
        links[0];

      if (!linkTeor) continue;
      const href = linkTeor.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.includes('javascript:')) continue;

      const url = href.startsWith('http')
        ? href
        : `https://www.camara.leg.br${href.startsWith('/') ? href : '/proposicoesWeb/' + href}`;

      if (!mapa[sigla]) mapa[sigla] = { nome: nome || sigla, url };
    }
  }

  return mapa;
}

function _parsearPaginaPareceres(html) {
  const doc  = new DOMParser().parseFromString(html, 'text/html');

  // ---------- Passo 0 (preferido): tabela "Pareceres Aprovados ou Pendentes" ----------
  // A página tem uma tabela com colunas [Comissão | Parecer], onde a primeira
  // célula traz o nome completo + (SIGLA) e a segunda traz o link "Inteiro teor".
  // Essa é a fonte autoritativa — usamos antes de qualquer heurística.
  const mapaTabela = _extrairDaTabelaPareceres(doc);
  if (Object.keys(mapaTabela).length > 0) {
    console.debug('[CCJC] pareceresMap (tabela vigente):', mapaTabela);
    return mapaTabela;
  }

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

// ============================================================
//  CAMADA DE IA – GEMINI
// ============================================================

// Resolve o provedor que será usado: respeita a escolha do usuário
// (config.provedorAtivo); se o escolhido não tiver chave, cai no primeiro
// configurado (gemini → anthropic → openai). Retorna '' se nenhum tem chave.
function _provedorEfetivo() {
  const tem = {
    gemini:    !!app.config.geminiKey,
    anthropic: !!app.config.anthropicKey,
    openai:    !!app.config.openaiKey,
  };
  const escolhido = app.config.provedorAtivo;
  if (escolhido && tem[escolhido]) return escolhido;
  if (tem.gemini)    return 'gemini';
  if (tem.anthropic) return 'anthropic';
  if (tem.openai)    return 'openai';
  return '';
}

const NOME_PROVEDOR = { gemini: 'Gemini', anthropic: 'Claude', openai: 'ChatGPT' };

// Identificador do modelo do provedor ativo (para registrar na análise).
function _modeloAtualLabel() {
  const p = _provedorEfetivo();
  if (p === 'gemini')    return app.config.modelo || '';
  if (p === 'anthropic') return app.config.anthropicModelo || '';
  if (p === 'openai')    return app.config.openaiModelo || '';
  return '';
}

// Formata um ISO timestamp como "DD/MM/AAAA HH:MM" (pt-BR). Vazio se inválido.
function _formatDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Limite de tokens de saída. Maior que antes para acomodar a análise detalhada
// de comissão (cotejo do substitutivo dispositivo a dispositivo).
const _MAX_OUT_TOKENS = 4096;

// docs aceita uma URL (string) ou uma lista de URLs. Permite enviar o conjunto
// completo de documentos de uma comissão (parecer + substitutivo + CVO).
async function aiCall(prompt, docs = null) {
  const p = _provedorEfetivo();
  const baixados = await _baixarDocs(docs);
  if (p === 'gemini')    return _callGemini(prompt, baixados);
  if (p === 'anthropic') return _callAnthropic(prompt, baixados);
  if (p === 'openai')    return _callOpenAI(prompt, baixados);
  throw new Error('Nenhuma chave de IA configurada. Configure em ⚙ Configurações.');
}

function _bufParaBase64(buf) {
  const u8 = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return btoa(bin);
}

// Baixa cada documento e o normaliza em { kind:'pdf', b64 } ou { kind:'text', texto }.
async function _baixarDocs(docs) {
  const urls = Array.isArray(docs) ? docs.filter(Boolean) : (docs ? [docs] : []);
  const out = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('pdf')) {
        out.push({ kind: 'pdf', b64: _bufParaBase64(await res.arrayBuffer()) });
      } else {
        const clean = _extrairTextoHTML(await res.text());
        if (clean.length > 200) out.push({ kind: 'text', texto: clean });
      }
    } catch (e) { console.warn('Erro ao baixar doc:', e.message); }
  }
  return out;
}

// ---------- GEMINI ----------
async function _callGemini(prompt, baixados = []) {
  const { geminiKey, modelo } = app.config;
  if (!geminiKey) throw new Error('Chave Gemini não configurada.');

  const parts = [];
  baixados.forEach((d, i) => {
    if (d.kind === 'pdf') parts.push({ inline_data: { mime_type: 'application/pdf', data: d.b64 } });
    else parts.push({ text: `\n\n--- Documento ${i + 1} ---\n${d.texto}` });
  });
  parts.push({ text: prompt });

  const url = `${GEMINI_BASE}/${modelo}:generateContent?key=${geminiKey}`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, maxOutputTokens: _MAX_OUT_TOKENS } }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Gemini HTTP ${res.status}`);
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// ---------- ANTHROPIC ----------
async function _callAnthropic(prompt, baixados = []) {
  const { anthropicKey, anthropicModelo } = app.config;
  if (!anthropicKey) throw new Error('Chave Anthropic não configurada.');

  const content = [];
  baixados.forEach((d, i) => {
    if (d.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.b64 } });
    else content.push({ type: 'text', text: `Documento ${i + 1}:\n${d.texto}` });
  });
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
      model:       anthropicModelo,
      max_tokens:  _MAX_OUT_TOKENS,
      temperature: 0.2,
      messages:    [{ role: 'user', content }],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);
  return json.content?.[0]?.text?.trim() || '';
}

// ---------- OPENAI ----------
async function _callOpenAI(prompt, baixados = []) {
  const { openaiKey, openaiModelo } = app.config;
  if (!openaiKey) throw new Error('Chave OpenAI não configurada.');

  const content = [];
  baixados.forEach((d, i) => {
    if (d.kind === 'pdf') content.push({ type: 'input_file', filename: `documento_${i + 1}.pdf`, file_data: `data:application/pdf;base64,${d.b64}` });
    else content.push({ type: 'input_text', text: `Documento ${i + 1}:\n${d.texto}` });
  });
  content.push({ type: 'input_text', text: prompt });

  const res = await fetch(OPENAI_BASE, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: openaiModelo, input: [{ role: 'user', content }], temperature: 0.2, max_output_tokens: _MAX_OUT_TOKENS }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `OpenAI HTTP ${res.status}`);
  if (json.output_text) return json.output_text.trim();
  for (const it of (json.output || [])) for (const c of (it.content || [])) if (c.type === 'output_text' && c.text) return c.text.trim();
  return '';
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

// Regras anti-alucinação compartilhadas pelos prompts (grounding + abstenção).
const _REGRAS_RIGIDAS = `

REGRAS RÍGIDAS (cumprimento obrigatório):
- Baseie-se EXCLUSIVAMENTE no(s) documento(s) anexado(s) e nos dados factuais fornecidos neste prompt. Não recorra a conhecimento prévio nem pressuponha conteúdo que não esteja no material.
- Se uma informação solicitada não constar no material disponível, escreva explicitamente "não consta no documento" — NUNCA preencha a lacuna com suposições.
- Não invente números de lei, artigos, decretos, datas, valores, nomes de relatores ou citações. Só mencione um dispositivo (lei, decreto, emenda, artigo) se ele aparecer literalmente no documento.
- Não inclua recomendação de voto (favorável, contrário ou abstenção).`;

// ---------- Conferência automática de referências (anti-alucinação) ----------
// Espelha a heurística do módulo de Plenário: confere se citações de alta
// confiança (Lei, Decreto, Emenda Constitucional, Medida Provisória) presentes
// no texto gerado aparecem no texto-fonte. Retorna a lista das não localizadas.
function _validarReferencias(textoGerado, textoFonte) {
  if (!textoFonte || textoFonte.length < 100) return []; // fonte indisponivel -> nao sinaliza
  // Conjunto de numeros presentes na fonte, sem separador de milhar ("9.999" -> "9999").
  const numerosFonte = new Set((textoFonte.match(/\d[\d.]*\d|\d/g) || []).map(s => s.replace(/\./g, '')));
  const re = /\b(Lei(?:\s+Complementar|\s+Delegada)?|Decreto(?:-Lei)?|Emenda\s+Constitucional|Medida\s+Provis[óo]ria)\s*(?:n?[º°o]?\.?\s*)?(\d[\d.]+\d|\d{3,})/gi;
  const suspeitas = [];
  const vistos = new Set();
  let m;
  while ((m = re.exec(textoGerado)) !== null) {
    const numNorm = m[2].replace(/\./g, '');
    if (numNorm.length < 4) continue; // ignora numeros curtos (alto risco de falso positivo)
    if (vistos.has(numNorm)) continue;
    vistos.add(numNorm);
    const tipo = m[1].replace(/\s+/g, ' ');
    if (!numerosFonte.has(numNorm)) suspeitas.push(`${tipo} nº ${m[2].trim()}`);
  }
  return suspeitas;
}

// Baixa uma URL e devolve seu texto puro (PDF via pdf.js, HTML via strip de tags).
async function _textoFonteDeURL(url) {
  if (!url) return '';
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('pdf') && typeof pdfjsLib !== 'undefined') {
      const pdf = await pdfjsLib.getDocument({ data: await res.arrayBuffer() }).promise;
      let t = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const c = await (await pdf.getPage(i)).getTextContent();
        t += c.items.map(it => it.str).join(' ') + '\n';
      }
      return t;
    }
    return _extrairTextoHTML(await res.text());
  } catch (_) { return ''; }
}

async function gerarResumoOriginal(proj, textoUrl) {
  const prompt = `Você é um assessor parlamentar especializado em análise legislativa brasileira.

Analise o ${proj.chave}: "${proj.ementa || ''}"${proj.autores?.length ? `\nAutoria: ${proj.autores.join(', ')}.` : ''}

Com base no texto integral do projeto${textoUrl ? ' (documento anexado)' : ''}, elabore um resumo executivo em 3 parágrafos cobrindo:
1. Objetivo principal e contexto da proposta.
2. Principais disposições e mudanças propostas.
3. Impacto esperado e público afetado.

Escreva em linguagem técnica e objetiva, em prosa contínua, sem títulos ou marcadores.${_REGRAS_RIGIDAS}${blocoPerfilPadrao()}`;

  return aiCall(prompt, textoUrl);
}

async function gerarAnaliseComissao(proj, comissao, tramitacoesCom, docsComissao = []) {
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

  const urls = docsComissao.map(d => d.url);
  // Inventário dos documentos anexados, para a IA saber o que está lendo e
  // procurar o conteúdo do substitutivo/complementação de voto no documento certo.
  const inventario = docsComissao.length
    ? docsComissao.map((d, i) => `Documento ${i + 1}: ${d.rotulo}${d.numero ? ` (nº ${d.numero})` : ''}`).join('\n')
    : '(nenhum documento de parecer localizado para esta comissão)';

  const prompt = `Você é um assessor parlamentar especializado em análise legislativa brasileira.

Analise a tramitação do ${proj.chave} na ${comissao.nome} (${comissao.sigla}).
Ementa: "${proj.ementa || ''}"

Histórico de eventos nesta comissão:
${historico || '(sem registro detalhado disponível)'}

Documentos desta comissão anexados a esta análise (parecer do relator, substitutivo, complementação de voto etc.):
${inventario}

Produza uma análise técnica e detalhada, em prosa corrida (sem marcadores), cobrindo obrigatoriamente:
1. A decisão da comissão (aprovação, rejeição, aprovação com substitutivo/emendas, constitucionalidade etc.) e o(a) relator(a).
2. **O conteúdo concreto do substitutivo/parecer**: percorra os documentos anexados — inclusive a complementação de voto, quando houver — e descreva, dispositivo a dispositivo (artigos, parágrafos, incisos), o que foi INCLUÍDO, ALTERADO ou SUPRIMIDO em relação ao texto original, registrando o teor relevante. Não se limite a um resumo genérico: garanta que TODO o teor dos documentos seja abordado.
3. Os argumentos centrais desenvolvidos pelo(a) relator(a) na fundamentação.

Atenção: as mudanças concretas e a fundamentação podem estar distribuídas entre os documentos (ex.: o substitutivo traz o texto e a complementação de voto traz os ajustes e a justificativa). Consulte todos antes de concluir que algo "não consta". Use o espaço necessário para esgotar o conteúdo, sem se limitar a um número fixo de parágrafos. Se a comissão aprovou sem alterações substanciais, informe isso claramente.${_REGRAS_RIGIDAS}${blocoPerfilPadrao()}`;

  return aiCall(prompt, urls);
}

async function gerarArgumentos(proj, textoUrl) {
  const historicoCom = (proj.comissoes || [])
    .filter(c => c.resumo)
    .map(c => `${c.nome}: ${c.resumo.slice(0, 300)}`)
    .join('\n');

  const prompt = `Você é um assessor parlamentar especializado em análise legislativa brasileira.

Com base no ${proj.chave}: "${proj.ementa || ''}"${textoUrl ? ' (texto integral do projeto anexado)' : ''}${historicoCom ? `\n\nDecisões das comissões:\n${historicoCom}` : ''}

Elabore, de forma equilibrada e técnica, argumentos fundamentados no teor do projeto e nas decisões das comissões acima:

ARGUMENTOS FAVORÁVEIS À APROVAÇÃO:
Liste de 3 a 4 argumentos principais em favor do projeto, um por linha, iniciando com "-".

ARGUMENTOS CONTRÁRIOS À APROVAÇÃO:
Liste de 3 a 4 argumentos principais contra o projeto, um por linha, iniciando com "-".

Não tome posição. Seja factual, objetivo e equilibrado.${_REGRAS_RIGIDAS}${blocoPerfilPadrao()}`;

  return aiCall(prompt, textoUrl);
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

    // Tramitações e documentos de parecer (por comissão), em paralelo.
    const [tramitacoes, documentos] = await Promise.all([
      buscarTramitacoes(proj.idCamara),
      buscarDocumentosComissoes(proj.idCamara),
    ]);

    // Inteiro teor vem do detalhe da proposição (urlInteiroTeor). Se o projeto
    // foi carregado do histórico sem esse campo, busca o detalhe agora.
    let teorUrl = proj.urlInteiroTeor || null;
    if (!teorUrl) {
      try {
        const resD = await fetch(`${API_BASE}/proposicoes/${proj.idCamara}`);
        if (resD.ok) teorUrl = (await resD.json()).dados?.urlInteiroTeor || null;
      } catch (_) {}
    }

    // Agrupa os documentos por comissão de origem (CCJC, CICS, …).
    const docsPorOrgao = {};
    for (const d of documentos) {
      (docsPorOrgao[d.orgao] = docsPorOrgao[d.orgao] || []).push(d);
    }

    // Siglas candidatas a comissão: órgãos que emitiram documento + órgãos da
    // tramitação (exceto administrativos e espécies documentais).
    const siglasCandidatas = new Set([
      ...Object.keys(docsPorOrgao),
      ...tramitacoes.map(t => (t.siglaOrgao || '').trim().toUpperCase()),
    ].filter(s => s && !ORGAOS_ADMIN.has(s) && !_SIGLAS_DOC.has(s)));

    // Resolve nome/tipo de cada órgão e mantém apenas comissões de mérito.
    const comissoes = [];
    for (const sigla of siglasCandidatas) {
      const info = await _resolverOrgao(sigla);
      // Sem documento E não confirmada como comissão → ignora (evita ruído).
      if (!info.ehComissao && !docsPorOrgao[sigla]) continue;
      comissoes.push({ sigla, nome: info.nome || sigla });
    }

    // 1. Resumo do projeto original
    proj.resumoOriginal = await gerarResumoOriginal(proj, teorUrl);

    // 2. Análise por comissão (sequencial para não saturar a API). Envia TODOS
    // os documentos da comissão (parecer + substitutivo + complementação de voto),
    // ordenados do mais recente para o mais antigo (codteor decrescente), até 6.
    proj.comissoes = [];
    for (const com of comissoes) {
      const tramCom = tramitacoes.filter(t =>
        (t.siglaOrgao || '').toUpperCase() === com.sigla
      );
      const docsCom = (docsPorOrgao[com.sigla] || [])
        .slice()
        .sort((a, b) => b.codteor - a.codteor)
        .slice(0, 6);

      const resumoCom = await gerarAnaliseComissao(proj, com, tramCom, docsCom);
      proj.comissoes.push({
        sigla: com.sigla,
        nome:  com.nome,
        resumo: resumoCom,
        docs: docsCom.map(d => ({ rotulo: d.rotulo, url: d.url })),
      });
    }

    // 3. Argumentos favoráveis e contrários (ancorados no texto integral)
    const textoArgs = await gerarArgumentos(proj, teorUrl);
    const [fav, con] = splitArgumentos(textoArgs);
    proj.argumentosFavoraveis  = fav;
    proj.argumentosContrarios  = con;

    // 4. Conferência automática de referências citadas vs. texto-fonte (anti-alucinação).
    // Confere o conteúdo descritivo do projeto (resumo + argumentos) contra o
    // inteiro teor. Não bloqueia a análise — apenas sinaliza para revisão manual.
    try {
      const fonteTeor = await _textoFonteDeURL(teorUrl);
      proj.refsSuspeitas = _validarReferencias(
        `${proj.resumoOriginal || ''}\n${fav || ''}\n${con || ''}`,
        fonteTeor,
      );
    } catch (_) { proj.refsSuspeitas = []; }

    // Metadados de geração: data e modelo usados (exibidos no cabeçalho).
    proj.analiseEm       = new Date().toISOString();
    proj.analiseProvedor = NOME_PROVEDOR[_provedorEfetivo()] || '';
    proj.analiseModelo   = _modeloAtualLabel();

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

  const pendentes = app.pautaAtual.projetos.filter(p =>
    p.statusAnalise === 'pendente' || p.statusAnalise === 'erro'
  );

  if (!pendentes.length) {
    mostrarToast('Todos os projetos já foram analisados.', '');
    return;
  }

  await _executarLoteAnalise(pendentes, document.getElementById('btn-analisar-todos'),
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> Analisar Todos`);
}

async function analisarSelecionados() {
  if (!app.pautaAtual || app.processando) return;

  const selecionados = app.pautaAtual.projetos.filter(p => app.selecionados.has(p.chave));
  if (!selecionados.length) {
    mostrarToast('Marque ao menos uma proposição na lista para analisar.', 'aviso');
    return;
  }

  // Reanalisa também os selecionados já concluídos (escolha explícita do usuário).
  await _executarLoteAnalise(selecionados, document.getElementById('btn-analisar-selecionados'),
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> <span data-role="sel-label">Analisar selecionados</span>`);
}

// Runner comum: valida provedor, processa o lote com concorrência limitada
// e restaura o botão acionado ao final.
async function _executarLoteAnalise(projetos, btn, htmlOriginal) {
  const provedor = NOME_PROVEDOR[_provedorEfetivo()] || '';
  if (!provedor) {
    mostrarToast('Configure uma chave de IA em ⚙ Configurações antes de analisar.', 'aviso');
    abrirConfiguracoes();
    return;
  }

  app.processando = true;
  const btnTodos = document.getElementById('btn-analisar-todos');
  const btnSel   = document.getElementById('btn-analisar-selecionados');
  if (btnTodos) btnTodos.disabled = true;
  if (btnSel)   btnSel.disabled   = true;
  if (btn) btn.innerHTML = '<span class="loading-spinner"></span> Analisando...';

  mostrarToast(`Iniciando análise de ${projetos.length} projeto(s) · 5 simultâneos · ${provedor}`, '');

  // Concorrência limitada: 5 projetos simultâneos, mas cada projeto faz suas
  // chamadas ao provedor sequencialmente para não sobrecarregar a API.
  await mapLimit(projetos, 5, proj => analisarProjeto(proj));

  app.processando = false;
  if (btnTodos) btnTodos.disabled = false;
  if (btn) btn.innerHTML = htmlOriginal;
  atualizarBotaoSelecionados();

  // Conta sobre o LOTE efetivamente processado (não sobre a pauta inteira),
  // para o "Analisar selecionados" não reportar um total enganoso.
  const concluidos = projetos.filter(p => p.statusAnalise === 'concluido').length;
  mostrarToast(`Análise concluída: ${concluidos}/${projetos.length} projeto(s).`, 'sucesso');
}

async function analisarEsteProjetoHandler() {
  const proj = app.projetoAtivo;
  if (!proj || app.processando) return;
  if (!app.config.geminiKey && !app.config.anthropicKey && !app.config.openaiKey) {
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
//  PERFIS DE PROMPT (biblioteca compartilhada via Firebase)
// ============================================================
async function fbCarregarPerfis() {
  const res = await fetch(`${FIREBASE_URL}/ccjc_prompts.json`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data) return [];
  return Object.entries(data).map(([id, p]) => ({ ...p, id }))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}
async function fbSalvarPerfil(p) {
  const id = p.id || ('cp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const corpo = {
    nome: p.nome, texto: p.texto,
    criadoPor: p.criadoPor || 'equipe',
    criadoEm: p.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  const res = await fetch(`${FIREBASE_URL}/ccjc_prompts/${id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  return { ...corpo, id };
}
async function fbApagarPerfil(id) {
  const res = await fetch(`${FIREBASE_URL}/ccjc_prompts/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}
async function fbCarregarPerfilPadrao() {
  const res = await fetch(`${FIREBASE_URL}/ccjc_prompt_padrao.json`);
  if (!res.ok) return null;
  return await res.json();
}
async function fbSalvarPerfilPadrao(id) {
  const res = await fetch(`${FIREBASE_URL}/ccjc_prompt_padrao.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id || null),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}
async function carregarBibliotecaPerfis() {
  const [lista, padraoId] = await Promise.all([fbCarregarPerfis(), fbCarregarPerfilPadrao()]);
  app.perfis = lista;
  app.perfilPadraoId = padraoId || null;
}

/** Instruções adicionais do perfil de prompt padrão da equipe (se houver). */
function instrucoesPerfilPadrao() {
  const p = (app.perfis || []).find(x => x.id === app.perfilPadraoId);
  return p?.texto || '';
}
/** Bloco anexado aos prompts base — orienta ênfase sem alterar o formato pedido. */
function blocoPerfilPadrao() {
  const t = instrucoesPerfilPadrao();
  return t
    ? `\n\nINSTRUÇÕES ADICIONAIS DA EQUIPE (apenas orientam a ênfase, o recorte temático e o tom). ` +
      `Estas instruções NÃO substituem nem modificam o prompt acima: mantenha exatamente o mesmo ` +
      `formato de saída, os mesmos rótulos/títulos, a mesma estrutura e o mesmo número de parágrafos ou itens já pedidos. ` +
      `Em caso de conflito, as regras de formato acima sempre prevalecem.\n${t}`
    : '';
}

function popularSelectPerfis(selecionadoId = '') {
  const sel = document.getElementById('perfil-select');
  if (!sel) return;
  const opts = ['<option value="">— Novo perfil —</option>'].concat(
    (app.perfis || []).map(p => {
      const m = p.id === app.perfilPadraoId ? ' ★ (padrão)' : '';
      return `<option value="${esc(p.id)}">${esc(p.nome || '(sem nome)')}${m}</option>`;
    }));
  sel.innerHTML = opts.join('');
  sel.value = selecionadoId || '';
}
function refletirSelecaoPerfil() {
  const sel = document.getElementById('perfil-select');
  if (!sel) return;
  const id = sel.value;
  const p = (app.perfis || []).find(x => x.id === id);
  const btnAtu = document.getElementById('btn-perfil-atualizar');
  const btnExc = document.getElementById('btn-perfil-excluir');
  const chk = document.getElementById('perfil-padrao');
  document.getElementById('perfil-nome').value = p?.nome || '';
  document.getElementById('perfil-texto').value = p?.texto || '';
  btnAtu.style.display = p ? 'inline-flex' : 'none';
  btnExc.style.display = p ? 'inline-flex' : 'none';
  chk.checked = !!p && app.perfilPadraoId === p.id;
}
function setPerfilStatus(texto, cor) {
  const el = document.getElementById('perfil-status');
  if (el) { el.textContent = texto || ''; el.style.color = cor || 'var(--text-dim)'; }
}
async function salvarPerfilNovo() {
  const nome = document.getElementById('perfil-nome').value.trim();
  const texto = document.getElementById('perfil-texto').value.trim();
  if (!nome) { setPerfilStatus('Dê um nome ao perfil.', '#f0c040'); return; }
  if (!texto) { setPerfilStatus('Escreva as instruções.', '#f0c040'); return; }
  setPerfilStatus('Salvando…');
  try {
    const salvo = await fbSalvarPerfil({ nome, texto });
    await carregarBibliotecaPerfis();
    popularSelectPerfis(salvo.id); refletirSelecaoPerfil();
    setPerfilStatus('✓ Perfil salvo.', '#3ad97d');
  } catch (e) { setPerfilStatus('Erro: ' + e.message, '#f05454'); }
}
async function atualizarPerfil() {
  const id = document.getElementById('perfil-select').value;
  if (!id) return;
  const nome = document.getElementById('perfil-nome').value.trim();
  const texto = document.getElementById('perfil-texto').value.trim();
  if (!nome || !texto) { setPerfilStatus('Nome e instruções são obrigatórios.', '#f0c040'); return; }
  const atual = (app.perfis || []).find(x => x.id === id);
  setPerfilStatus('Atualizando…');
  try {
    await fbSalvarPerfil({ id, nome, texto, criadoPor: atual?.criadoPor, criadoEm: atual?.criadoEm });
    await carregarBibliotecaPerfis();
    popularSelectPerfis(id); refletirSelecaoPerfil();
    setPerfilStatus('✓ Perfil atualizado.', '#3ad97d');
  } catch (e) { setPerfilStatus('Erro: ' + e.message, '#f05454'); }
}
async function excluirPerfil() {
  const id = document.getElementById('perfil-select').value;
  if (!id) return;
  if (!confirm('Excluir este perfil da biblioteca compartilhada? Isso afeta toda a equipe.')) return;
  setPerfilStatus('Excluindo…');
  try {
    await fbApagarPerfil(id);
    if (app.perfilPadraoId === id) { await fbSalvarPerfilPadrao(null); app.perfilPadraoId = null; }
    await carregarBibliotecaPerfis();
    popularSelectPerfis(''); refletirSelecaoPerfil();
    setPerfilStatus('Perfil excluído.', 'var(--text-dim)');
  } catch (e) { setPerfilStatus('Erro: ' + e.message, '#f05454'); }
}
async function onPerfilPadraoToggle() {
  const chk = document.getElementById('perfil-padrao');
  const id = document.getElementById('perfil-select').value;
  if (chk.checked) {
    if (!id) { chk.checked = false; setPerfilStatus('Salve o perfil antes de defini-lo como padrão.', '#f0c040'); return; }
    try { await fbSalvarPerfilPadrao(id); app.perfilPadraoId = id; popularSelectPerfis(id); setPerfilStatus('✓ Definido como padrão da equipe.', '#3ad97d'); }
    catch (e) { chk.checked = false; setPerfilStatus('Erro: ' + e.message, '#f05454'); }
  } else if (app.perfilPadraoId === id) {
    try { await fbSalvarPerfilPadrao(null); app.perfilPadraoId = null; popularSelectPerfis(id); setPerfilStatus('Padrão da equipe removido.', 'var(--text-dim)'); }
    catch (e) { chk.checked = true; setPerfilStatus('Erro: ' + e.message, '#f05454'); }
  }
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
  app.selecionados.clear();

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

    const comissoesHtml = (proj.comissoes || []).map(com => {
      const titulo = com.nome && com.nome !== com.sigla ? `${com.nome} (${com.sigla})` : com.sigla;
      const docsLinks = (com.docs && com.docs.length)
        ? com.docs.map(d => `<a href="${escHtml(d.url)}" target="_blank" rel="noopener">${escHtml(d.rotulo)}</a>`).join(', ')
        : (com.docsRotulos || []).map(r => escHtml(r)).join(', '); // compat análises antigas
      const docs = docsLinks ? `<p class="pi-comissao-docs"><em>Documentos analisados: ${docsLinks}.</em></p>` : '';
      return `
      <div class="pi-comissao">
        <h4>${escHtml(titulo)}</h4>
        ${docs}
        <p>${escHtml(com.resumo || 'Análise não disponível.')}</p>
      </div>`;
    }).join('');

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
        ${proj.analiseEm ? `<p class="pi-meta">Análise gerada em ${escHtml(_formatDataHora(proj.analiseEm))}${proj.analiseProvedor ? ` · ${escHtml(proj.analiseProvedor)}` : ''}${proj.analiseModelo ? ` / ${escHtml(proj.analiseModelo)}` : ''}</p>` : ''}
        <p class="pi-ementa">${escHtml(proj.ementa || '')}</p>

        <h3>1. Resumo do Projeto Original</h3>
        ${proj.urlInteiroTeor ? `<p class="pi-comissao-docs"><em>Documento analisado: <a href="${escHtml(proj.urlInteiroTeor)}" target="_blank" rel="noopener">Inteiro teor da proposição</a></em></p>` : ''}
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
    .pi-projeto { margin-bottom:18px; border-bottom:2px solid #e5e7eb; padding-bottom:18px; }
    .pi-projeto:last-child { border-bottom:none; }
    .pi-header { display:flex; align-items:baseline; gap:16px; margin-bottom:6px; }
    .pi-chave  { font-size:15pt; font-weight:800; color:#065f46; }
    .pi-autores{ font-size:9pt; color:#6b7280; }
    .pi-meta   { font-size:8.5pt; color:#6b7280; margin-bottom:4px; }
    .pi-comissao-docs { font-size:8.5pt; color:#6b7280; margin:2px 0 6px; }
    .pi-comissao-docs a { color:#065f46; }
    .pi-ementa { font-size:10pt; color:#374151; font-style:italic; line-height:1.5; margin-bottom:16px; }
    h3 { font-size:10.5pt; font-weight:700; color:#1f2937; margin:16px 0 8px; border-left:3px solid #00A859; padding-left:10px; page-break-after:avoid; page-break-inside:avoid; }
    h4 { font-size:10pt; font-weight:600; color:#374151; margin:8px 0 5px; page-break-after:avoid; page-break-inside:avoid; }
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

/**
 * Detecta se a proposição está no bloco de "Redação Final" da pauta
 * (apreciação do texto final, não de mérito). Cobre as três origens:
 * PDF (flag calculada no parse), calendário/API (campo `topico`) e, como
 * reforço, o status retornado pela API da Câmara (`statusApi`).
 */
function ehRedacaoFinal(proj) {
  if (proj.redacaoFinal) return true;
  const re = /reda[çc][ãa]o\s+final/i;
  return re.test(proj.topico || '') || re.test(proj.statusApi || '');
}

function renderizarListaProjetos() {
  const lista = document.getElementById('lista-projetos');
  const pauta = app.pautaAtual;

  if (!pauta?.projetos.length) {
    lista.innerHTML = '<div class="empty-state"><p>Nenhum projeto</p></div>';
    atualizarBotaoSelecionados();
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

    const ativo  = app.projetoAtivo?.chave === proj.chave ? 'active' : '';
    const ementa = (proj.ementa || 'Aguardando dados...').slice(0, 65);
    const rf     = ehRedacaoFinal(proj);
    const sel    = app.selecionados.has(proj.chave) ? 'checked' : '';

    return `<div class="prop-item ${ativo}" data-chave="${esc(proj.chave)}">
      <label class="ccjc-sel-check" title="Selecionar para análise por IA">
        <input type="checkbox" data-sel="${esc(proj.chave)}" ${sel}>
      </label>
      <div class="prop-item-content">
        <span class="prop-item-badge">${esc(proj.chave)}</span>
        ${rf ? '<span class="prop-item-rf" title="Bloco de Redação Final">Red. Final</span>' : ''}
        <span class="prop-item-ementa">${esc(ementa)}${(proj.ementa || '').length > 65 ? '…' : ''}</span>
      </div>
      <span class="ccjc-status-dot ${statusCls}" title="${proj.statusAnalise}">${statusIcon}</span>
    </div>`;
  }).join('');

  lista.querySelectorAll('.prop-item').forEach(el => {
    el.addEventListener('click', () => selecionarProjeto(el.dataset.chave));
  });
  // Checkbox de seleção não deve abrir o projeto — só marca/desmarca.
  lista.querySelectorAll('.ccjc-sel-check').forEach(lbl => {
    lbl.addEventListener('click', e => e.stopPropagation());
  });
  lista.querySelectorAll('input[data-sel]').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      toggleSelecao(cb.dataset.sel, cb.checked);
    });
  });

  atualizarBotaoSelecionados();
}

function toggleSelecao(chave, marcado) {
  if (marcado) app.selecionados.add(chave); else app.selecionados.delete(chave);
  atualizarBotaoSelecionados();
}

function atualizarBotaoSelecionados() {
  const btn = document.getElementById('btn-analisar-selecionados');
  if (!btn) return;
  const n = app.selecionados.size;
  btn.disabled = n === 0 || app.processando;
  btn.title = n
    ? `Analisar ${n} proposição(ões) selecionada(s) por IA`
    : 'Marque proposições na lista para analisar apenas elas';
  const lbl = btn.querySelector('[data-role=sel-label]');
  if (lbl) lbl.textContent = n ? `Analisar selecionados (${n})` : 'Analisar selecionados';
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
  const temGemini   = !!(app.config.geminiKey || app.config.anthropicKey || app.config.openaiKey);
  const roDisabled  = analisando ? 'readonly' : '';

  const comissoesHtml = (proj.comissoes || []).map((com, i) => {
    const titulo = com.nome && com.nome !== com.sigla
      ? `${esc(com.nome)} <span style="opacity:.55">(${esc(com.sigla)})</span>`
      : esc(com.sigla);
    const docsLinks = (com.docs && com.docs.length)
      ? com.docs.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.rotulo)}</a>`).join(', ')
      : (com.docsRotulos || []).map(r => esc(r)).join(', '); // compat análises antigas
    const docs = docsLinks
      ? `<div class="ccjc-secao-docs" style="font-size:12px;opacity:.7;margin:2px 0 6px">Documentos analisados: ${docsLinks}</div>`
      : '';
    return `
    <div class="ccjc-secao">
      <div class="ccjc-secao-header">
        <span class="ccjc-secao-titulo">${titulo}</span>
      </div>
      ${docs}
      <textarea id="campo-comissao-${i}" class="ccjc-textarea" placeholder="Análise da ${esc(com.sigla)}..." ${roDisabled}>${esc(com.resumo || '')}</textarea>
    </div>`;
  }).join('');

  const secComissoes = proj.comissoes?.length
    ? `<div class="ccjc-secao-grupo-label">2. Tramitação nas Comissões</div>${comissoesHtml}`
    : (proj.statusAnalise === 'concluido'
        ? `<div class="ccjc-secao"><div class="ccjc-secao-header"><span class="ccjc-secao-titulo">2. Tramitação nas Comissões</span></div><p class="ccjc-empty-secao">Nenhuma comissão identificada na tramitação deste projeto.</p></div>`
        : '');

  const nSecArgs = proj.comissoes?.length ? 3 : 2;
  const nSecArgsCon = nSecArgs + 1;

  cont.innerHTML = `
    <div class="ccjc-revisao-header">
      <div class="ccjc-revisao-badge-wrap">
        <div class="ccjc-revisao-badge">${esc(proj.chave)}</div>
        ${ehRedacaoFinal(proj) ? '<span class="prop-item-rf" title="Bloco de Redação Final — apreciação do texto final">Redação Final</span>' : ''}
        ${proj.idCamara ? `<a href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${proj.idCamara}" target="_blank" class="ccjc-link-camara" title="Ver ficha na Câmara">↗ Ficha da proposição</a>` : ''}
      </div>
      <div class="ccjc-revisao-info">
        <div class="ccjc-revisao-ementa">${esc(proj.ementa || 'Buscando dados na API...')}</div>
        ${proj.autores?.length ? `<div class="ccjc-revisao-meta">Autoria: ${esc(proj.autores.join(', '))}</div>` : ''}
        ${proj.statusApi ? `<div class="ccjc-revisao-meta">Situação: ${esc(proj.statusApi)}</div>` : ''}
        ${proj.analiseEm ? `<div class="ccjc-revisao-meta" style="opacity:.75">Análise gerada em ${esc(_formatDataHora(proj.analiseEm))}${proj.analiseProvedor ? ` · ${esc(proj.analiseProvedor)}` : ''}${proj.analiseModelo ? ` / ${esc(proj.analiseModelo)}` : ''}</div>` : ''}
      </div>
      <button id="btn-analisar-este" class="btn btn-outline btn-sm" ${analisando || !temGemini ? 'disabled' : ''}>
        ${analisando ? '<span class="loading-spinner"></span> Analisando...' : '✦ Analisar'}
      </button>
    </div>

    ${proj.statusAnalise === 'erro' ? `
      <div class="ccjc-erro-banner">
        <strong>Erro na análise:</strong> ${esc(proj.erroAnalise || 'Erro desconhecido.')}
      </div>` : ''}

    ${proj.refsSuspeitas?.length ? `
      <div class="ccjc-aviso-refs" style="margin:8px 0 14px;padding:10px 12px;border-left:3px solid #d68a00;background:#fff8e6;border-radius:4px;font-size:13px;color:#5a4500">
        ⚠ <strong>Conferência automática de referências:</strong> a IA citou ${proj.refsSuspeitas.length === 1 ? 'a referência' : 'as referências'} a seguir, mas ${proj.refsSuspeitas.length === 1 ? 'ela não foi localizada' : 'elas não foram localizadas'} no texto-fonte do projeto. Confirme na fonte antes de usar — heurística sujeita a falso positivo: ${proj.refsSuspeitas.map(esc).join('; ')}.
      </div>` : ''}

    ${analisando ? `<div class="ccjc-loading-overlay"><span class="loading-spinner"></span> Gerando análise com IA…</div>` : ''}

    <div class="ccjc-secao">
      <div class="ccjc-secao-header">
        <span class="ccjc-secao-titulo">1. Resumo do Projeto Original</span>
      </div>
      ${proj.urlInteiroTeor ? `<div class="ccjc-secao-docs" style="font-size:12px;opacity:.7;margin:2px 0 6px">Documento analisado: <a href="${esc(proj.urlInteiroTeor)}" target="_blank" rel="noopener">Inteiro teor da proposição</a></div>` : ''}
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
        app.selecionados.clear();
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
  const openaiKey    = document.getElementById('config-openai-key').value.trim();
  const openaiModelo = document.getElementById('config-openai-modelo').value;
  const provedorAtivo = document.getElementById('config-provedor-ativo').value;
  const status       = document.getElementById('config-status-ia');

  // Não validamos o formato/prefixo da chave Gemini: o Google mudou o padrão
  // (ex.: chaves no formato "AQ.xxx" além do antigo "AIza..."). Deixamos a
  // própria API validar a chave ao carregar os modelos / gerar conteúdo.

  if (anthropicKey && !anthropicKey.startsWith('sk-ant-')) {
    document.getElementById('config-status-anthropic').textContent   = '⚠ Chave Anthropic deve começar com "sk-ant-".';
    document.getElementById('config-status-anthropic').className     = 'config-status erro';
    document.getElementById('config-status-anthropic').style.display = 'block';
    return;
  }

  if (openaiKey && !openaiKey.startsWith('sk-')) {
    document.getElementById('config-status-openai').textContent   = '⚠ Chave OpenAI deve começar com "sk-".';
    document.getElementById('config-status-openai').className     = 'config-status erro';
    document.getElementById('config-status-openai').style.display = 'block';
    return;
  }

  app.config.geminiKey    = geminiKey;
  if (modelo)    app.config.modelo          = modelo;
  app.config.anthropicKey   = anthropicKey;
  if (antModelo) app.config.anthropicModelo = antModelo;
  app.config.openaiKey      = openaiKey;
  if (openaiModelo) app.config.openaiModelo = openaiModelo;
  app.config.provedorAtivo  = provedorAtivo;

  await new Promise(r => chrome.storage.local.set({ config: app.config }, r));
  fecharModal('modal-configuracoes');
  const temIa = geminiKey || anthropicKey || openaiKey;
  mostrarToast(
    temIa ? 'Configurações salvas!' : 'Configurações salvas. Configure uma chave de IA para analisar.',
    temIa ? 'sucesso' : 'aviso'
  );
}

async function abrirConfiguracoes() {
  document.getElementById('config-gemini-key').value           = app.config.geminiKey    || '';
  document.getElementById('config-anthropic-key').value        = app.config.anthropicKey || '';
  document.getElementById('config-anthropic-modelo').value     = app.config.anthropicModelo || 'claude-opus-4-8';
  document.getElementById('config-openai-key').value           = app.config.openaiKey || '';
  document.getElementById('config-openai-modelo').value        = app.config.openaiModelo || 'gpt-4o';
  document.getElementById('config-provedor-ativo').value       = app.config.provedorAtivo || _provedorEfetivo() || 'gemini';
  document.getElementById('config-status-ia').style.display        = 'none';
  document.getElementById('config-status-anthropic').style.display = 'none';
  document.getElementById('config-status-openai').style.display    = 'none';
  document.getElementById('modelos-status').style.display           = 'none';
  document.getElementById('modal-configuracoes').style.display      = 'flex';
  if (app.config.geminiKey) await carregarModelosDisponiveis();
  atualizarBadgeGemini();
  atualizarBadgeClaude();
  atualizarBadgeOpenai();

  // Perfis de prompt (compartilhados pela equipe via Firebase)
  setPerfilStatus('');
  try { await carregarBibliotecaPerfis(); } catch (e) { /* usa o que houver em memória */ }
  popularSelectPerfis(app.perfilPadraoId || '');
  refletirSelecaoPerfil();
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

// Lista os modelos da Anthropic ao vivo (GET /v1/models); mantém a lista
// fixa do <select> como fallback se a API falhar ou a chave estiver vazia.
async function carregarModelosAnthropic() {
  const key    = document.getElementById('config-anthropic-key').value.trim() || app.config.anthropicKey;
  const select = document.getElementById('config-anthropic-modelo');
  const status = document.getElementById('modelos-status-anthropic');
  const btn    = document.getElementById('btn-carregar-anthropic-modelos');

  if (!key) {
    status.textContent   = 'Cole a chave de API primeiro.';
    status.style.color   = 'var(--text-dim)';
    status.style.display = 'block';
    return;
  }

  btn.textContent      = '↻ Carregando...';
  btn.disabled         = true;
  status.style.display = 'none';

  try {
    const res  = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VER, 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);

    const modelos = json.data || [];
    if (!modelos.length) throw new Error('Nenhum modelo encontrado.');

    const modeloSalvo = app.config.anthropicModelo;
    select.innerHTML = modelos.map(m =>
      `<option value="${m.id}" ${m.id === modeloSalvo ? 'selected' : ''}>${m.display_name || m.id}</option>`
    ).join('');

    if (!select.value) select.selectedIndex = 0;
    status.textContent   = `✓ ${modelos.length} modelos carregados.`;
    status.style.color   = '#3ad97d';
    status.style.display = 'block';

  } catch (err) {
    status.textContent   = `✗ ${err.message}`;
    status.style.color   = 'var(--vermelho)';
    status.style.display = 'block';
  } finally {
    btn.textContent = '↻ Carregar';
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

function atualizarBadgeOpenai() {
  const badge = document.getElementById('badge-openai');
  if (!badge) return;
  const key = document.getElementById('config-openai-key').value.trim();
  badge.textContent = key ? '● Configurado' : '○ Não configurado';
  badge.className   = `ccjc-provider-badge ${key ? 'ativo' : 'inativo'}`;
}

// Lista os modelos da OpenAI ao vivo (GET /v1/models), filtrando para as
// famílias de chat/multimodais; mantém a lista fixa do <select> como fallback.
async function carregarModelosOpenAI() {
  const key    = document.getElementById('config-openai-key').value.trim() || app.config.openaiKey;
  const select = document.getElementById('config-openai-modelo');
  const status = document.getElementById('modelos-status-openai');
  const btn    = document.getElementById('btn-carregar-openai-modelos');

  if (!key) {
    status.textContent   = 'Cole a chave de API primeiro.';
    status.style.color   = 'var(--text-dim)';
    status.style.display = 'block';
    return;
  }

  btn.textContent      = '↻ Carregando...';
  btn.disabled         = true;
  status.style.display = 'none';

  try {
    const res  = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);

    const prefs = ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4', 'o3'];
    const ids = (json.data || []).map(m => m.id)
      .filter(id => prefs.some(p => id.startsWith(p)))
      .sort();
    if (!ids.length) throw new Error('Nenhum modelo compatível encontrado.');

    const modeloSalvo = app.config.openaiModelo;
    select.innerHTML = ids.map(id =>
      `<option value="${id}" ${id === modeloSalvo ? 'selected' : ''}>${id}</option>`
    ).join('');

    if (!select.value) select.selectedIndex = 0;
    status.textContent   = `✓ ${ids.length} modelos carregados.`;
    status.style.color   = '#3ad97d';
    status.style.display = 'block';

  } catch (err) {
    status.textContent   = `✗ ${err.message}`;
    status.style.color   = 'var(--vermelho)';
    status.style.display = 'block';
  } finally {
    btn.textContent = '↻ Carregar';
    btn.disabled    = false;
  }
}

async function testarConexaoOpenAI() {
  const key    = document.getElementById('config-openai-key').value.trim();
  const modelo = document.getElementById('config-openai-modelo').value || app.config.openaiModelo;
  const status = document.getElementById('config-status-openai');

  if (!key) {
    status.textContent   = 'Cole a chave OpenAI antes de testar.';
    status.className     = 'config-status erro';
    status.style.display = 'block';
    return;
  }

  status.textContent   = '⏳ Testando ChatGPT...';
  status.className     = 'config-status teste';
  status.style.display = 'block';

  try {
    const res = await fetch(OPENAI_BASE, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, input: 'Responda apenas: OK', max_output_tokens: 64 }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    status.textContent = '✓ ChatGPT conectado e pronto.';
    status.className   = 'config-status ok';
  } catch (err) {
    status.textContent = `✗ Erro: ${err.message}`;
    status.className   = 'config-status erro';
  }
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
      urlInteiroTeor:       null,
      resumoOriginal:       '',
      comissoes:            [],
      argumentosFavoraveis: '',
      argumentosContrarios: '',
      refsSuspeitas:        [],
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
      urlInteiroTeor:       null,
      resumoOriginal:       '',
      comissoes:            [],
      argumentosFavoraveis: '',
      argumentosContrarios: '',
      refsSuspeitas:        [],
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
    app.selecionados.clear();

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
