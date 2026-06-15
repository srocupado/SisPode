/* ============================================================
 *  MÓDULO: VETOS DO CONGRESSO NACIONAL
 *  - Lista os vetos em tramitação a partir do "Relatório Resumo de
 *    Vetos" oficial (PDF), reproduzindo as colunas e as cores
 *    (verde/azul) das linhas.
 *  - Ao abrir um veto, busca a página de detalhe, extrai os
 *    dispositivos vetados e gera, com IA, um resumo de cada um.
 *  - Busca geral em todo o conteúdo (metadados + textos + resumos).
 *  - Resumos compartilhados com a equipe via Firebase.
 * ============================================================ */

// ---------- Endpoints e constantes ----------
const FIREBASE_URL   = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const PDF_VETOS_URL  = 'https://legis.senado.leg.br/siscon/api/portalcn/pdfVetosEmTramitacao';
const CODETABS       = 'https://api.codetabs.com/v1/proxy?quest=';
const ANTHROPIC_VER  = '2023-06-01';
const CACHE_TTL_MS   = 6 * 60 * 60 * 1000;   // re-baixa o PDF se o cache tiver +6h
const THROTTLE_MS    = 350;                  // intervalo entre downloads de detalhe
const CHUNK_DISP     = 15;                   // dispositivos por chamada de IA (parcela vetos grandes)
const PAUTAS_PATH    = 'congresso_pautas';       // pautas de Sessão Conjunta importadas (vetos + PLNs)
const PAUTAS_META    = 'congresso_pautas_meta';  // índice leve p/ a sidebar (sem baixar as pautas inteiras)
const PAUTA_BASE_URL = 'https://www.congressonacional.leg.br/sessoes/agenda-do-congresso-nacional/-/pauta/';
const AGENDA_URL     = 'https://www.congressonacional.leg.br/sessoes/agenda-do-congresso-nacional';
// Endpoint AJAX (Liferay) que devolve as sessões do mês; recebe ...&<NS>d=YYYY-MM-DD
const AGENDA_RESOURCE = AGENDA_URL + '?p_p_id=pautasessao_WAR_atividadeportlet&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=agendaCongresso&p_p_cacheability=cacheLevelPage&p_p_col_id=column-1&p_p_col_count=1';
const AGENDA_NS      = '_pautasessao_WAR_atividadeportlet_';

// Faixas de x (em coordenadas do PDF, página com 595pt de largura) que
// delimitam cada coluna da tabela do relatório.
const COL = { materia: 84, assunto: 162, sobresta: 396, data: 452, qtd: 512 };

// Cores-alvo das linhas no PDF (RGB 0-255).
const COR_VERDE = [188, 255, 155];
const COR_AZUL  = [153, 204, 255];

// ---------- Metadados dos provedores de IA (compartilhado com os demais painéis) ----------
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
        headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VER, 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      const lista = (j.data || []).map(m => ({ id: m.id, displayName: m.display_name || m.id }));
      return lista.length ? lista : this.modelosFallback;
    },
  },
};

// ---------- Estado ----------
const app = {
  config: null,        // { provedor, apiKey, modelo }
  vetos: [],           // ver shape em construirVeto()
  busca: '',
  baixandoTodos: false,
  editando: null,      // { key, codigo, salvando, dirty, debounce, snapshot }
  ultimoSync: null,    // ISO da última gravação no Firebase
  perfis: [],          // [{ id, nome, texto, criadoPor, criadoEm, atualizadoEm }] — Firebase compartilhado
  perfilPadraoId: null,// id do perfil de prompt aplicado por padrão (compartilhado pela equipe)
  sessoes: [],         // [{ id, nome, criadoEm, criadoPor, atualizadoEm, total, comResumo }] (metadados)
  sessaoAtiva: null,   // { id, nome } quando uma sessão salva está carregada (null = lista ao vivo)
  toastTimer: null,
  buscaTimer: null,
  saveTimer: null,
  sessaoSaveTimer: null,
  selecionados: new Set(),   // chaves de vetos marcados para exportar (vazio = exporta os visíveis)
};

let _abort = new AbortController();
let _iaInFlight = 0;                              // chamadas de IA em voo
let _gerarTodos = { rodando: false, cancelar: false };
function isAbort(e) { return e?.name === 'AbortError' || /aborted/i.test(e?.message || ''); }

// ============================================================
//  BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');

  await carregarConfig();
  wireEventos();
  carregarBibliotecaPerfis().catch(e => console.warn('Perfis indisponíveis:', e.message));
  carregarSessoes().then(renderSidebar).catch(e => console.warn('Sessões indisponíveis:', e.message));

  // Render imediato a partir do cache local (se houver) e refresh em segundo plano.
  const cache = await carregarCacheLocal();
  if (cache?.vetos?.length) {
    app.vetos = cache.vetos;
    await mesclarResumosFirebase();
    renderLista();
    marcarSyncInicial();
    const velho = !cache.atualizadoEm || (Date.now() - new Date(cache.atualizadoEm).getTime() > CACHE_TTL_MS);
    if (velho) carregarListaVetos(false);
  } else {
    carregarListaVetos(false);
  }
});

function wireEventos() {
  document.getElementById('btn-voltar-home').addEventListener('click', () => {
    chrome.tabs.update({ url: chrome.runtime.getURL('panel.html') });
  });
  document.getElementById('btn-atualizar').addEventListener('click', () => carregarListaVetos(true));
  document.getElementById('btn-baixar-todos').addEventListener('click', toggleBaixarTodos);
  document.getElementById('btn-gerar-todos').addEventListener('click', toggleGerarTodos);
  document.getElementById('btn-parar').addEventListener('click', pararTudo);
  document.getElementById('btn-configuracoes').addEventListener('click', abrirConfig);

  document.querySelectorAll('[data-fecha]').forEach(b =>
    b.addEventListener('click', () => { document.getElementById(b.dataset.fecha).style.display = 'none'; }));

  // Config
  document.getElementById('config-provedor').addEventListener('change', onProvedorChange);
  document.getElementById('btn-carregar-modelos').addEventListener('click', carregarModelos);
  document.getElementById('btn-testar-conexao').addEventListener('click', testarConexao);
  document.getElementById('btn-salvar-config').addEventListener('click', salvarConfig);
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const i = document.getElementById('config-api-key');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  // Perfis de prompt
  document.getElementById('perfil-select').addEventListener('change', refletirSelecaoPerfil);
  document.getElementById('btn-perfil-salvar').addEventListener('click', salvarPerfilNovo);
  document.getElementById('btn-perfil-atualizar').addEventListener('click', atualizarPerfil);
  document.getElementById('btn-perfil-excluir').addEventListener('click', excluirPerfil);
  document.getElementById('perfil-padrao').addEventListener('change', onPerfilPadraoToggle);

  // Sessões + exportação
  document.getElementById('btn-sessao-vivo').addEventListener('click', voltarAoVivo);
  document.getElementById('btn-importar-pauta').addEventListener('click', abrirModalImportar);
  document.getElementById('btn-importar-url').addEventListener('click', () => importarPauta(document.getElementById('import-url').value.trim()));
  document.getElementById('import-data').addEventListener('change', e => listarSessoesPorData(e.target.value));
  document.getElementById('btn-exportar-docx').addEventListener('click', exportarDocx);
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPdf);

  // Busca
  const busca = document.getElementById('cn-busca');
  busca.addEventListener('input', () => {
    clearTimeout(app.buscaTimer);
    app.buscaTimer = setTimeout(() => onBusca(busca.value), 180);
  });
  document.getElementById('cn-busca-clear').addEventListener('click', () => {
    busca.value = ''; onBusca('');
  });
}

// ============================================================
//  LISTA — download e parse do PDF oficial
// ============================================================
async function carregarListaVetos(forcar) {
  const empty = document.getElementById('cn-empty');
  if (empty) empty.innerHTML = '<span class="cn-spinner"></span> Baixando o relatório de vetos do Congresso Nacional…';
  try {
    const buf = await baixarArrayBuffer(PDF_VETOS_URL);
    const novos = await parsePdfVetos(buf);
    if (!novos.length) throw new Error('Nenhum veto reconhecido no relatório.');

    // Preserva o que já tínhamos (detalhes/resumos) ao reprocessar o PDF.
    const antigos = new Map(app.vetos.map(v => [v.key, v]));
    app.vetos = novos.map(n => {
      const prev = antigos.get(n.key);
      return prev ? { ...n, ementa: prev.ementa, dispositivos: prev.dispositivos,
                      detalheCarregado: prev.detalheCarregado, aberto: prev.aberto } : n;
    });

    await mesclarResumosFirebase();
    renderLista();
    marcarSyncInicial();
    salvarCacheLocal();
  } catch (e) {
    console.error('[congresso] carregarListaVetos', e);
    if (!app.vetos.length) {
      const lista = document.getElementById('cn-lista');
      lista.innerHTML = `<div class="cn-empty">Não foi possível carregar os vetos.<br><small>${escapeHtml(e.message)}</small><br><br>
        <button id="cn-retry" class="btn btn-outline btn-sm">Tentar de novo</button></div>`;
      document.getElementById('cn-retry')?.addEventListener('click', () => carregarListaVetos(true));
    } else {
      mostrarToast('Falha ao atualizar a lista: ' + e.message, 'erro');
    }
  }
}

/**
 * Lê o PDF do relatório e devolve a lista de vetos com colunas + cor + link.
 * - colunas via posição x do texto; cor via amostragem do canvas renderizado;
 * - link de detalhe via anotações de hyperlink do próprio PDF.
 */
async function parsePdfVetos(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const registros = [];

  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const W = Math.ceil(viewport.width), H = Math.ceil(viewport.height);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport }).promise;
    const pixels = ctx.getImageData(0, 0, W, H).data;

    const tc = await page.getTextContent();
    const annots = (await page.getAnnotations()).filter(a =>
      /\/veto\/detalhe\/\d+/.test(a.url || a.unsafeUrl || ''));

    const itens = tc.items
      .filter(it => it.str && it.str.trim())
      .map(it => {
        const m = pdfjsLib.Util.transform(viewport.transform, it.transform);
        return { str: it.str.trim(), pdfx: it.transform[4], pdfy: it.transform[5], cy: m[5] };
      });

    // Âncoras: o pdf.js agrupa cada célula em um item, então a primeira
    // célula da linha vem como "VET 28/2026". Detecta esse padrão na coluna
    // do veto, de cima para baixo.
    const ancoras = itens
      .filter(it => /^VET\s+\d+\s*\/\s*\d{4}/.test(it.str) && it.pdfx < COL.materia)
      .sort((a, b) => b.pdfy - a.pdfy);

    for (let i = 0; i < ancoras.length; i++) {
      const yTopo = ancoras[i].pdfy;
      const yBase = i + 1 < ancoras.length ? ancoras[i + 1].pdfy : -Infinity;
      // Itens pertencentes a este registro (inclui linhas de "assunto" que quebram).
      const linha = itens.filter(it => it.pdfy <= yTopo + 4 && it.pdfy > yBase + 4);

      const cols = { veto: [], materia: [], assunto: [], sobresta: [], data: [], qtd: [] };
      for (const it of linha) cols[colDe(it.pdfx)].push(it);
      const txt = c => cols[c]
        .sort((a, b) => (b.pdfy - a.pdfy) || (a.pdfx - b.pdfx))
        .map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();

      const vetoTxt = txt('veto');
      const m = vetoTxt.match(/(\d+)\s*\/\s*(\d{4})/);
      if (!m) continue;

      const sobrestaTxt = txt('sobresta');
      const dataTxt = (txt('data').match(/\d{2}\/\d{2}\/\d{4}/) || [''])[0];
      // Ignora as notas de rodapé do relatório ("* VET X/AAAA - N dispositivos já
      // apreciados."), que também começam com "VET" mas não têm coluna de sobrestamento/data.
      if (!/sim|n[ãa]o/i.test(sobrestaTxt) && !dataTxt) continue;

      const cor = corDaLinha(pixels, W, H, ancoras[i].cy);
      const link = acharLink(annots, yTopo);
      registros.push(construirVeto({
        numero: `${m[1]}/${m[2]}`, num: +m[1], ano: +m[2],
        materia: txt('materia'), assunto: txt('assunto'),
        sobresta: sobrestaTxt, data: dataTxt,
        qtdRaw: txt('qtd'), cor, detalheUrl: link,
      }));
    }
  }
  return registros;
}

function colDe(x) {
  if (x < COL.materia)  return 'veto';
  if (x < COL.assunto)  return 'materia';
  if (x < COL.sobresta) return 'assunto';
  if (x < COL.data)     return 'sobresta';
  if (x < COL.qtd)      return 'data';
  return 'qtd';
}

function corDaLinha(px, W, H, cy) {
  let verde = 0, azul = 0;
  const ys = [cy - 6, cy - 3, cy, cy + 3].map(y => Math.max(0, Math.min(H - 1, Math.round(y))));
  for (const y of ys) {
    for (let k = 0; k < 40; k++) {
      const x = Math.round(W * (0.05 + 0.9 * k / 39));
      const o = (y * W + x) * 4;
      const dg = (px[o] - COR_VERDE[0]) ** 2 + (px[o + 1] - COR_VERDE[1]) ** 2 + (px[o + 2] - COR_VERDE[2]) ** 2;
      const da = (px[o] - COR_AZUL[0])  ** 2 + (px[o + 1] - COR_AZUL[1])  ** 2 + (px[o + 2] - COR_AZUL[2])  ** 2;
      if (Math.min(dg, da) < 4900) { dg < da ? verde++ : azul++; }
    }
  }
  if (!verde && !azul) return '';
  return verde >= azul ? 'verde' : 'azul';
}

function acharLink(annots, y) {
  const a = annots.find(an => an.rect && an.rect[1] - 4 <= y && y <= an.rect[3] + 4);
  return a ? (a.url || a.unsafeUrl) : '';
}

function construirVeto(d) {
  const total = /total/i.test(d.qtdRaw);
  const qtdNum = total ? null : parseInt((d.qtdRaw.match(/\d+/) || [])[0], 10);
  return {
    key: `${d.num}-${d.ano}`,
    numero: d.numero, num: d.num, ano: d.ano,
    tipo: total ? 'Total' : 'Parcial',
    materia: d.materia,
    assunto: d.assunto || '(sem assunto)',
    sobresta: /sim/i.test(d.sobresta) ? 'Sim' : (/n[ãa]o/i.test(d.sobresta) ? 'Não' : ''),
    dataSobresta: d.data,
    qtdRaw: d.qtdRaw, qtdNum: Number.isFinite(qtdNum) ? qtdNum : null,
    cor: d.cor,
    detalheUrl: d.detalheUrl,
    ementa: '',
    dispositivos: [],          // [{ codigo, descricao, texto, situacao, resumo }]
    detalheCarregado: false,
    resumoMeta: null,          // { provedor, modelo, atualizadoEm, atualizadoPor }
    razoesPdfUrl: '',          // PDF "Razões do Veto" (Mensagem, autor Presidência da República)
    razoesTexto: '',           // texto extraído do PDF (transitório — não persistido)
    razoesGrupos: [],          // [{ codigos:[...], resumo }] — razões por grupo de dispositivos
    razoesProjeto: '',         // resumo único das razões (Veto Total)
    aberto: false,
    resumindo: false,
    carregandoDetalhe: false,
  };
}

// ============================================================
//  DETALHE — página oficial de cada veto
// ============================================================
async function carregarDetalhe(veto) {
  if (veto.detalheCarregado || veto.carregandoDetalhe) return;
  if (!veto.detalheUrl) throw new Error('Veto sem link de detalhe no relatório.');
  veto.carregandoDetalhe = true;
  try {
    const html = await fetchHtml(veto.detalheUrl);
    const { ementa, dispositivos, razoesPdfUrl } = parseDetalheHtml(html);
    // Preserva resumos já existentes ao recarregar os textos.
    const resumosPrev = new Map(veto.dispositivos.map(d => [d.codigo, d.resumo]));
    veto.dispositivos = dispositivos.map(d => ({ ...d, resumo: resumosPrev.get(d.codigo) || '' }));
    veto.ementa = ementa || veto.ementa;
    if (razoesPdfUrl) veto.razoesPdfUrl = razoesPdfUrl;
    veto.detalheCarregado = true;
    // Aplica resumos do Firebase que aguardavam o carregamento dos dispositivos.
    if (veto._resumosPendentes) {
      veto.dispositivos.forEach(d => {
        const r = veto._resumosPendentes[d.codigo.replace(/\./g, '_')];
        if (r && !d.resumo) d.resumo = r;
      });
      delete veto._resumosPendentes;
    }
  } finally {
    veto.carregandoDetalhe = false;
  }
}

function parseDetalheHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const dispositivos = [];

  const linhas = doc.querySelectorAll('table.cn-detalhe-veto--partes-vetadas tbody tr');
  linhas.forEach(tr => {
    const tds = tr.querySelectorAll('td');
    if (!tds.length) return;
    const td0 = tds[0];
    const texto = (td0.querySelector('p')?.textContent || '').replace(/\s+/g, ' ').trim();
    // "code - descrição" = texto direto da célula, sem os <a> e o <p>.
    const clone = td0.cloneNode(true);
    clone.querySelectorAll('a, p').forEach(n => n.remove());
    const cab = clone.textContent.replace(/\s+/g, ' ').trim();
    const mCod = cab.match(/(\d{1,3}\.\d{2}\.\d{3})/);
    if (!mCod) return;
    const codigo = mCod[1];
    const descricao = cab.replace(codigo, '').replace(/^\s*[-–]\s*/, '').trim();
    const situacao = (tds[1]?.textContent || '').replace(/\s+/g, ' ').trim();
    dispositivos.push({ codigo, descricao, texto, situacao, resumo: '' });
  });

  // Ementa: o portal expõe a ementa completa do projeto na meta sf_ementa.
  let ementa = (doc.querySelector('meta[name="sf_ementa"]')?.getAttribute('content') || '').replace(/\s+/g, ' ').trim();
  if (!ementa) {
    doc.querySelectorAll('dt').forEach(dt => {
      if (!ementa && /ementa/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd) ementa = dd.textContent.replace(/\s+/g, ' ').trim();
      }
    });
  }

  // PDF "Razões do Veto": é o documento sdleg-getter da aba Documentos cujo
  // autor é a Presidência da República (o próprio veto/Mensagem). O outro
  // documento costuma ser o "Calendário de tramitação" (autor Congresso).
  let razoesPdfUrl = '';
  const links = [...doc.querySelectorAll('a[href*="sdleg-getter/documento"]')];
  for (const a of links) {
    // Sobe até o "card" do documento (o ancestral que contém o campo "Autor").
    let ctx = '', el = a.parentElement;
    for (let k = 0; k < 6 && el; k++, el = el.parentElement) {
      ctx = el.textContent || '';
      if (/Autor/i.test(ctx)) break;
    }
    if (/Presid[êe]ncia da Rep[úu]blica/i.test(ctx)) { razoesPdfUrl = a.href; break; }
  }
  if (!razoesPdfUrl && links.length) razoesPdfUrl = links[0].href;  // fallback: 1º documento

  return { ementa, dispositivos, razoesPdfUrl };
}

async function fetchHtml(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: _abort.signal });
    if (r.ok) return await r.text();
  } catch (e) { if (isAbort(e)) throw e; }
  // Fallback via proxy CORS (apenas HTML).
  const r = await fetch(CODETABS + encodeURIComponent(url), { signal: _abort.signal });
  if (!r.ok) throw new Error(`Não foi possível acessar a página de detalhe (HTTP ${r.status}).`);
  return await r.text();
}

async function baixarArrayBuffer(url) {
  const r = await fetch(url, { redirect: 'follow', signal: _abort.signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o relatório.`);
  return await r.arrayBuffer();
}

// ============================================================
//  IA — resumo de cada dispositivo
// ============================================================
/**
 * Resume os dispositivos de um veto em LOTES (CHUNK_DISP por chamada), para
 * não estourar o LLM em vetos grandes (ex.: 340 dispositivos). Persiste a cada
 * lote, então uma interrupção/recarga não perde o progresso.
 * @param {object} opts.apenasFaltantes  só resume dispositivos ainda sem resumo
 *   (retomada de onde parou). false = regera todos.
 * @returns {boolean} true se, ao final, todos os dispositivos têm resumo.
 */
async function resumirVeto(veto, { silencioso = false, render = true, apenasFaltantes = true } = {}) {
  if (!app.config?.apiKey) {
    if (!silencioso) mostrarToast('Configure a chave de API em ⚙ Configurações.', 'aviso');
    return false;
  }
  if (!veto.detalheCarregado) await carregarDetalhe(veto);

  // Junto com os resumos: resumo do projeto (sintético) + razões do veto.
  await resumirProjeto(veto, { silencioso: true, render, force: !apenasFaltantes });
  await resumirRazoes(veto, { silencioso: true, render, force: !apenasFaltantes });

  if (!veto.dispositivos.length) {
    if (!silencioso) mostrarToast('Este veto não tem dispositivos para resumir.', 'aviso');
    return (veto.resumoProjeto || veto.razoesProjeto) ? true : false;
  }

  const alvo = apenasFaltantes ? veto.dispositivos.filter(d => !d.resumo) : veto.dispositivos.slice();
  if (!alvo.length) { if (!silencioso) mostrarToast('Este veto já está resumido.', 'sucesso'); return true; }
  const lotes = chunk(alvo, CHUNK_DISP);

  veto.resumindo = true;
  veto._progresso = { feito: 0, total: alvo.length };
  iaInc();
  if (render && !app.editando) renderLista();

  let feitos = 0, interrompido = false, erroMsg = '';
  try {
    for (let li = 0; li < lotes.length; li++) {
      if (_abort.signal.aborted) { interrompido = true; break; }
      const lote = lotes[li];
      let mapa;
      try {
        const texto = await chamarIAtexto({ ...app.config, prompt: promptResumo(veto, lote) });
        mapa = extrairJson(texto);
      } catch (e) {
        if (isAbort(e)) { interrompido = true; break; }
        erroMsg = e.message; break;  // falha de rede/API: para e deixa o restante para retomada
      }
      let aplicadosLote = 0;
      lote.forEach(d => {
        const r = mapa[d.codigo] || mapa[d.codigo.replace(/^0+/, '')];
        if (r) { d.resumo = String(r).trim(); aplicadosLote++; feitos++; }
      });
      veto.resumoMeta = { provedor: app.config.provedor, modelo: app.config.modelo, atualizadoEm: new Date().toISOString() };
      veto._progresso = { feito: feitos, total: alvo.length };
      await persistirResumo(veto);              // persistência incremental (resiste a interrupção)
      if (render && !app.editando) renderLista();
      if (aplicadosLote === 0) { erroMsg = 'a IA não retornou resumos reconhecíveis neste lote'; break; }
    }
  } finally {
    veto.resumindo = false;
    veto._progresso = null;
    iaDec();
    if (render && !app.editando) renderLista();
  }

  const faltam = veto.dispositivos.filter(d => !d.resumo).length;
  if (!silencioso) {
    if (faltam === 0) mostrarToast(`✓ VET ${veto.numero}: ${feitos} dispositivo(s) resumido(s)`, 'sucesso');
    else if (interrompido) mostrarToast(`Interrompido em VET ${veto.numero}: ${feitos} feito(s), ${faltam} restante(s). Use "Continuar" para retomar.`, 'aviso');
    else mostrarToast(`⚠ VET ${veto.numero}: ${feitos} feito(s), ${faltam} restante(s)${erroMsg ? ' — ' + erroMsg : ''}. Use "Continuar" para retomar.`, 'aviso');
  }
  return faltam === 0;
}

/** Salva o resumo no Firebase (com marcador de sync) e no cache local.
 *  Retorna true se a gravação no Firebase foi bem-sucedida. */
async function persistirResumo(veto) {
  atualizarStatusSync('sincronizando');
  let ok = false;
  try {
    if (app.sessaoAtiva) await fbSalvarVetoSessao(app.sessaoAtiva.id, veto);
    else await fbSalvarResumo(veto);
    atualizarStatusSync('ok');
    ok = true;
  } catch (e) {
    console.warn('Firebase resumo falhou:', e.message);
    atualizarStatusSync('offline');
  }
  salvarCacheLocal();
  return ok;
}

// ---------- Controle de IA em voo / botão Parar ----------
function iaInc() { _iaInFlight++; atualizarBotaoParar(); }
function iaDec() { _iaInFlight = Math.max(0, _iaInFlight - 1); atualizarBotaoParar(); }

function atualizarBotaoParar() {
  const b = document.getElementById('btn-parar');
  if (!b) return;
  const ativo = _iaInFlight > 0 || app.baixandoTodos || _gerarTodos.rodando;
  b.style.display = ativo ? 'inline-flex' : 'none';
}

// ---------- Marcador de sincronização com o Firebase ----------
function atualizarStatusSync(estado) {
  const el = document.getElementById('cn-sync');
  if (!el) return;
  el.style.display = 'inline-flex';
  el.className = 'cn-sync';
  if (estado === 'sincronizando') {
    el.classList.add('sincronizando');
    el.textContent = '⟳ Salvando no Firebase…';
  } else if (estado === 'offline') {
    el.classList.add('offline');
    el.textContent = '○ Offline — salvo localmente';
  } else { // ok
    app.ultimoSync = new Date().toISOString();
    el.classList.add('ok');
    const hora = new Date(app.ultimoSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `● Firebase · salvo às ${hora}`;
  }
}

/** Mostra, no boot, o horário do último resumo salvo pela equipe (se houver). */
function marcarSyncInicial() {
  const datas = app.vetos.map(v => v.resumoMeta?.atualizadoEm).filter(Boolean).sort();
  if (!datas.length) return;
  const el = document.getElementById('cn-sync');
  if (!el) return;
  app.ultimoSync = datas[datas.length - 1];
  el.style.display = 'inline-flex';
  el.className = 'cn-sync ok';
  const d = new Date(app.ultimoSync);
  el.textContent = `● Firebase · equipe · ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

// ---------- Gerar resumos de TODOS os vetos ----------
function toggleGerarTodos() {
  if (_gerarTodos.rodando) { pararTudo(); return; }
  gerarTodosResumos();
}

async function gerarTodosResumos() {
  if (!app.config?.apiKey) { mostrarToast('Configure a chave de API em ⚙ Configurações.', 'aviso'); return; }
  const pendentes = app.vetos.filter(v =>
    v.detalheUrl && !(v.detalheCarregado && v.dispositivos.length && v.dispositivos.every(d => d.resumo)));
  if (!pendentes.length) { mostrarToast('Todos os vetos já estão resumidos.', 'sucesso'); return; }

  _gerarTodos = { rodando: true, cancelar: false };
  setBtnGerar(true); atualizarBotaoParar();
  const wrap = document.getElementById('cn-progress-wrap');
  const bar = document.getElementById('cn-progress-bar');
  const label = document.getElementById('cn-progress-label');
  wrap.style.display = 'block';

  let ok = 0, falhas = 0;
  for (let i = 0; i < pendentes.length; i++) {
    if (_gerarTodos.cancelar) break;
    const v = pendentes[i];
    label.textContent = `Resumindo com IA… ${i + 1}/${pendentes.length} (VET ${v.numero})` + (falhas ? ` · ${falhas} falha(s)` : '');
    try {
      const r = await resumirVeto(v, { silencioso: true, render: false });
      r ? ok++ : falhas++;
    } catch (e) { if (isAbort(e)) break; falhas++; }
    bar.style.width = `${Math.round(((i + 1) / pendentes.length) * 100)}%`;
    if (!app.editando) renderLista();
    if (i < pendentes.length - 1 && !_gerarTodos.cancelar) await sleep(THROTTLE_MS);
  }

  _gerarTodos = { rodando: false, cancelar: false };
  setBtnGerar(false); atualizarBotaoParar();
  wrap.style.display = 'none';
  if (!app.editando) renderLista();
  mostrarToast(`✓ Resumos gerados (${ok})${falhas ? ` · ${falhas} falha(s)` : ''}`, falhas ? 'aviso' : 'sucesso');
}

function setBtnGerar(rodando) {
  const b = document.getElementById('btn-gerar-todos');
  if (!b) return;
  b.innerHTML = rodando
    ? '<span class="cn-spinner"></span> Resumindo…'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.9 5.8L20 9l-4.9 3.6L17 18l-5-3.5L7 18l1.9-5.4L4 9l6.1-.2z"/></svg> Resumir todos';
}

function promptResumo(veto, dispositivos = veto.dispositivos) {
  const lista = dispositivos.map(d =>
    `• Código ${d.codigo} — Dispositivo: ${d.descricao}\n  Texto vetado: "${(d.texto || d.descricao).slice(0, 1200)}"`
  ).join('\n\n');

  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos no Congresso Nacional.

Abaixo estão dispositivos vetados do ${veto.tipo === 'Total' ? 'Veto Total' : 'Veto Parcial'} nº ${veto.numero}, referente à matéria ${veto.materia} (${veto.assunto}).

Para CADA dispositivo listado, escreva um resumo curto (1 a 2 frases), em português claro e objetivo, explicando o que o dispositivo vetado estabelecia — ou seja, o que deixa de valer com o veto. Use verbos normativos (estabelece, veda, autoriza, isenta, cria, altera...). Não recomende voto, não opine e não invente nada além do texto fornecido.

Responda EXCLUSIVAMENTE com um objeto JSON válido, sem cercas de código, no formato:
{"${dispositivos[0]?.codigo || '00.00.000'}": "resumo do dispositivo", ...}
Use exatamente os códigos abaixo como chaves e inclua TODOS eles.
${blocoPerfilPadrao()}
Dispositivos:
${lista}`;
}

/** Divide um array em lotes de tamanho n. */
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Gera o "Resumo do Projeto" (sintético) a partir da ementa/assunto.
 * Veto Total → resumo um pouco mais detalhado (3-4 linhas); demais → 1-2 linhas.
 */
async function resumirProjeto(veto, { silencioso = false, force = false, render = true } = {}) {
  if (!app.config?.apiKey) return false;
  if (veto.resumoProjeto && !force) return true;
  if (!veto.detalheCarregado) { try { await carregarDetalhe(veto); } catch (_) {} }

  veto.resumindoProjeto = true;
  iaInc();
  if (render && !app.editando) renderLista();
  try {
    const texto = await chamarIAtexto({ ...app.config, prompt: promptProjeto(veto) });
    const limpo = (texto || '').replace(/^["“]|["”]$/g, '').trim();
    if (!limpo) throw new Error('a IA não retornou o resumo do projeto');
    veto.resumoProjeto = limpo;
    veto.resumoMeta = { provedor: app.config.provedor, modelo: app.config.modelo, atualizadoEm: new Date().toISOString() };
    await persistirResumo(veto);
    return true;
  } catch (e) {
    if (isAbort(e)) return false;
    if (!silencioso) mostrarToast('Erro ao resumir o projeto: ' + e.message, 'erro');
    return false;
  } finally {
    veto.resumindoProjeto = false;
    iaDec();
    if (render && !app.editando) renderLista();
  }
}

function promptProjeto(veto) {
  const total = veto.tipo === 'Total';
  const tam = total ? '3 a 4 linhas' : '1 a 2 linhas';
  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos no Congresso Nacional.

Escreva um "Resumo do Projeto" MUITO sintético (${tam}), em português claro e direto, explicando o objetivo geral do projeto ${veto.materia} — o que ele cria/altera e a quem se destina. Foque no PROJETO como um todo (não nos dispositivos vetados). Não recomende voto, não opine e não invente nada além das informações abaixo.
Responda apenas com o texto do resumo, sem rótulos, sem aspas e sem listas.
${blocoPerfilPadrao()}
Assunto: ${veto.assunto || '(não informado)'}
Ementa: ${veto.ementa || '(ementa não disponível)'}`;
}

/** Instruções adicionais do perfil de prompt padrão da equipe (se houver). */
function instrucoesPerfilPadrao() {
  const p = (app.perfis || []).find(x => x.id === app.perfilPadraoId);
  return p?.texto || '';
}
function blocoPerfilPadrao() {
  const t = instrucoesPerfilPadrao();
  return t
    ? `\nINSTRUÇÕES ADICIONAIS DA EQUIPE (orientam a ênfase e o recorte, mas NÃO alteram o formato JSON nem as regras acima):\n${t}\n`
    : '';
}

// ---------- RAZÕES DO VETO (PDF da Mensagem) ----------
async function extrairTextoPdf(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let txt = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    txt += tc.items.map(it => it.str).join(' ') + '\n';
  }
  return txt.replace(/[ \t]{2,}/g, ' ').trim();
}

async function garantirRazoesTexto(veto) {
  if (veto.razoesTexto) return true;
  if (!veto.razoesPdfUrl) return false;
  const buf = await baixarArrayBuffer(veto.razoesPdfUrl);
  veto.razoesTexto = await extrairTextoPdf(buf);
  return !!veto.razoesTexto;
}

/**
 * Resume as "Razões do Veto" (do PDF da Mensagem). Para Veto Total, um único
 * resumo (3-4 linhas). Para parcial, agrupa os dispositivos que compartilham a
 * mesma justificativa e resume cada grupo (1-2 linhas).
 */
async function resumirRazoes(veto, { silencioso = false, render = true, force = false } = {}) {
  if (!app.config?.apiKey) return false;
  const jaTem = veto.tipo === 'Total' ? !!veto.razoesProjeto : !!(veto.razoesGrupos && veto.razoesGrupos.length);
  if (jaTem && !force) return true;
  if (!veto.detalheCarregado) { try { await carregarDetalhe(veto); } catch (_) {} }
  if (!veto.razoesPdfUrl) { if (!silencioso) mostrarToast('Razões do veto não localizadas para este veto.', 'aviso'); return false; }

  veto.resumindoRazoes = true;
  iaInc();
  if (render && !app.editando) renderLista();
  try {
    if (!(await garantirRazoesTexto(veto))) throw new Error('não foi possível ler o PDF de razões');
    if (veto.tipo === 'Total') {
      const texto = await chamarIAtexto({ ...app.config, prompt: promptRazoesTotal(veto) });
      const limpo = (texto || '').replace(/^["“]|["”]$/g, '').trim();
      if (!limpo) throw new Error('a IA não retornou o resumo das razões');
      veto.razoesProjeto = limpo;
    } else {
      const grupos = [];
      for (const lote of chunk(veto.dispositivos, CHUNK_DISP)) {
        if (_abort.signal.aborted) break;
        const arr = extrairJsonArray(await chamarIAtexto({ ...app.config, prompt: promptRazoesGrupos(veto, lote) }));
        for (const g of arr) {
          const codigos = (g.codigos || g.dispositivos || []).map(String);
          const resumo = String(g.resumo || g.razoes || '').trim();
          if (codigos.length && resumo) grupos.push({ codigos, resumo });
        }
      }
      if (!grupos.length) throw new Error('a IA não retornou razões reconhecíveis');
      veto.razoesGrupos = grupos;
    }
    veto.resumoMeta = { provedor: app.config.provedor, modelo: app.config.modelo, atualizadoEm: new Date().toISOString() };
    await persistirResumo(veto);
    return true;
  } catch (e) {
    if (isAbort(e)) return false;
    if (!silencioso) mostrarToast('Erro ao resumir as razões: ' + e.message, 'erro');
    return false;
  } finally {
    veto.resumindoRazoes = false;
    iaDec();
    if (render && !app.editando) renderLista();
  }
}

function promptRazoesGrupos(veto, dispositivos) {
  const lista = dispositivos.map(d => `• ${d.codigo} — ${d.descricao}`).join('\n');
  const razoes = (veto.razoesTexto || '').slice(0, 60000);
  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos no Congresso Nacional.

O documento abaixo (Mensagem de veto) contém as "Razões do veto" do ${veto.numero}. Cada parágrafo "Razões do veto" justifica o veto a UM ou MAIS dispositivos. Associe cada dispositivo da lista (pela descrição legal) ao trecho correspondente do documento.

Tarefa: agrupe os dispositivos que compartilham a MESMA justificativa e, para cada grupo, escreva um resumo de 1 a 2 linhas das razões do veto, em português claro. Mencione "veto por arrastamento" quando o documento assim indicar. Não opine, não recomende voto e não invente nada além do documento.

Responda EXCLUSIVAMENTE com um array JSON válido, sem cercas de código, no formato:
[{"codigos":["<código>","<código>"],"resumo":"<1 a 2 linhas>"}]
Use exatamente os códigos da lista abaixo como chaves; inclua todos que tiverem razões no documento.
${blocoPerfilPadrao()}
Dispositivos vetados:
${lista}

Documento (Razões do veto):
"""${razoes}"""`;
}

function promptRazoesTotal(veto) {
  const razoes = (veto.razoesTexto || '').slice(0, 60000);
  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos no Congresso Nacional.

O documento abaixo (Mensagem de veto) apresenta as razões do VETO TOTAL ao projeto ${veto.materia} (${veto.assunto}). Escreva um resumo de 3 a 4 linhas explicando, em português claro, os principais motivos do veto. Não opine, não recomende voto e não invente nada além do documento.
Responda apenas com o texto do resumo, sem rótulos nem aspas.
${blocoPerfilPadrao()}
Documento (Razões do veto):
"""${razoes}"""`;
}

function extrairJsonArray(texto) {
  if (!texto) return [];
  let t = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = t.indexOf('['), j = t.lastIndexOf(']');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { const a = JSON.parse(t); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

/** Chamada de IA somente-texto (sem PDF), com a mesma matriz de 3 provedores. */
async function chamarIAtexto({ provedor, apiKey, modelo, prompt }) {
  if (provedor === 'gemini') {
    const m = modelo || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8000 } };
    const j = await fetchIA(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }
  if (provedor === 'openai') {
    const m = modelo || 'gpt-4o';
    const body = { model: m, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], temperature: 0.2, max_output_tokens: 8000 };
    const j = await fetchIA('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (j.output_text) return j.output_text.trim();
    for (const item of (j.output || [])) for (const c of (item.content || [])) if (c.type === 'output_text' && c.text) return c.text.trim();
    return '';
  }
  if (provedor === 'anthropic') {
    const m = modelo || 'claude-sonnet-4-6';
    const body = { model: m, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] };
    const j = await fetchIA('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VER,
        'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    for (const item of (j.content || [])) if (item.type === 'text' && item.text) return item.text.trim();
    return '';
  }
  throw new Error(`Provedor desconhecido: ${provedor}`);
}

/** fetch para IA com retry/backoff em 429 e 5xx (5s/15s/30s). */
async function fetchIA(url, init) {
  const delays = [0, 5000, 15000, 30000];
  let ultima = null;
  for (let i = 0; i < delays.length; i++) {
    if (_abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (delays[i]) await sleep(delays[i]);
    let res;
    try { res = await fetch(url, { ...init, signal: _abort.signal }); }
    catch (e) { if (isAbort(e)) throw e; ultima = e; continue; }
    if (res.ok) return await res.json();
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      ultima = new Error(`HTTP ${res.status}`); continue;
    }
    let det; try { det = await res.json(); } catch (_) { det = null; }
    throw new Error(det?.error?.message || det?.error?.type || `HTTP ${res.status}`);
  }
  throw ultima || new Error('Falha após várias tentativas.');
}

/** Extrai o objeto JSON da resposta da IA, tolerando texto/cercas ao redor. */
function extrairJson(texto) {
  if (!texto) return {};
  let t = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini >= 0 && fim > ini) t = t.slice(ini, fim + 1);
  try { return JSON.parse(t); } catch (_) {}
  // Fallback: pares "codigo": "resumo" linha a linha.
  const mapa = {};
  const re = /"?(\d{1,3}\.\d{2}\.\d{3})"?\s*[:\-–]\s*"?([^"\n]+?)"?\s*(?:,|\n|$)/g;
  let m; while ((m = re.exec(t))) mapa[m[1]] = m[2].trim();
  return mapa;
}

// ============================================================
//  BAIXAR TODOS (busca full-text)
// ============================================================
function toggleBaixarTodos() {
  if (app.baixandoTodos) { pararTudo(); return; }
  baixarTodosDetalhes();
}

function pararTudo() {
  _gerarTodos.cancelar = true;
  app.baixandoTodos = false;
  try { _abort.abort(); } catch (_) {}
  _abort = new AbortController();
  setBtnBaixar(false);
  setBtnGerar(false);
  document.getElementById('cn-progress-wrap').style.display = 'none';
  atualizarBotaoParar();
  mostrarToast('Operação interrompida.', 'aviso');
}

async function baixarTodosDetalhes() {
  const pendentes = app.vetos.filter(v => !v.detalheCarregado && v.detalheUrl);
  if (!pendentes.length) { mostrarToast('Todos os detalhes já foram baixados.', 'sucesso'); return; }

  app.baixandoTodos = true;
  setBtnBaixar(true);
  atualizarBotaoParar();
  const wrap = document.getElementById('cn-progress-wrap');
  const bar = document.getElementById('cn-progress-bar');
  const label = document.getElementById('cn-progress-label');
  wrap.style.display = 'block';

  let ok = 0, falhas = 0;
  for (let i = 0; i < pendentes.length; i++) {
    if (!app.baixandoTodos) break;
    const v = pendentes[i];
    try { await carregarDetalhe(v); ok++; }
    catch (e) { if (isAbort(e)) break; falhas++; console.warn('detalhe falhou', v.numero, e.message); }
    bar.style.width = `${Math.round(((i + 1) / pendentes.length) * 100)}%`;
    label.textContent = `Baixando detalhes… ${i + 1}/${pendentes.length}` + (falhas ? ` · ${falhas} falha(s)` : '');
    if (app.busca && !app.editando) renderLista();
    if (i < pendentes.length - 1) await sleep(THROTTLE_MS);
  }

  app.baixandoTodos = false;
  setBtnBaixar(false);
  atualizarBotaoParar();
  wrap.style.display = 'none';
  salvarCacheLocal();
  if (!app.editando) renderLista();
  if (ok) mostrarToast(`✓ Detalhes baixados (${ok})${falhas ? ` · ${falhas} falha(s)` : ''}. Busca completa habilitada.`, falhas ? 'aviso' : 'sucesso');
}

function setBtnBaixar(rodando) {
  const b = document.getElementById('btn-baixar-todos');
  if (!b) return;
  b.innerHTML = rodando
    ? '<span class="cn-spinner"></span> Baixando…'
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Baixar detalhes`;
}

// ============================================================
//  BUSCA
// ============================================================
function onBusca(valor) {
  if (app.editando) fecharEdicao(true);  // descarrega a edição em curso
  app.busca = valor.trim();
  document.getElementById('cn-busca-clear').style.display = app.busca ? 'block' : 'none';

  // "Busca em tudo": na primeira busca textual, garante o download de todos os
  // detalhes. Busca por número do veto não precisa (casa direto pelo nº).
  const ehBuscaNumero = /^(?:vet(?:o)?\s*)?\d{1,3}$/i.test(app.busca) || /^(?:vet(?:o)?\s*)?\d+\s*\/\s*\d{4}$/i.test(app.busca);
  if (app.busca && !ehBuscaNumero && !app.baixandoTodos && app.vetos.some(v => !v.detalheCarregado && v.detalheUrl)) {
    mostrarToast('Baixando os detalhes para a busca completa…', '');
    baixarTodosDetalhes();
  }
  renderLista();
}

function vetoCasaBusca(v, termo) {
  if (!termo) return true;
  const t = termo.trim();
  // Busca pelo número do veto, aceitando o prefixo "VET"/"VETO":
  // "VET 5/2025"/"5/2025" (exato) ou "VET 5"/"5"/"31" (nº do veto, 1–3 dígitos).
  const tn = t.replace(/^vet(?:o)?\s*/i, '');
  const mFull = tn.match(/^(\d+)\s*\/\s*(\d{4})$/);
  if (mFull) return v.num === +mFull[1] && v.ano === +mFull[2];
  const mNum = tn.match(/^(\d{1,3})$/);
  if (mNum) return v.num === +mNum[1];
  const campos = [`VET ${v.numero}`, v.numero, v.tipo, v.materia, v.assunto, v.ementa, v.sobresta,
    v.resumoProjeto, v.razoesProjeto,
    ...(v.razoesGrupos || []).map(g => g.resumo),
    ...(v.dispositivos || []).flatMap(d => [d.codigo, d.descricao, d.texto, d.resumo])];
  return normalizar(campos.join(' ')).includes(normalizar(t));
}

// ============================================================
//  RENDER
// ============================================================
function renderLista() {
  const lista = document.getElementById('cn-lista');
  const termo = app.busca;
  const filtrados = app.vetos.filter(v => vetoCasaBusca(v, termo));

  // Stats
  const stats = document.getElementById('cn-stats');
  const plnsVisiveis = app.sessaoAtiva ? (app.sessaoAtiva.plns || []).filter(p => plnCasaBusca(p, termo)) : [];
  if (app.sessaoAtiva) {
    const nPln = (app.sessaoAtiva.plns || []).length;
    stats.innerHTML = termo
      ? `<strong>${filtrados.length + plnsVisiveis.length}</strong> item(ns) para “${escapeHtml(termo)}” · pauta com ${app.vetos.length} veto(s) + ${nPln} PLN/MPV`
      : `Pauta: <strong>${app.vetos.length}</strong> veto(s) + <strong>${nPln}</strong> PLN/MPV`;
  } else {
    const totDisp = app.vetos.reduce((s, v) => s + (v.qtdNum || 0), 0);
    const comResumo = app.vetos.filter(v => v.dispositivos.some(d => d.resumo)).length;
    stats.innerHTML = termo
      ? `<strong>${filtrados.length}</strong> veto(s) encontrados para “${escapeHtml(termo)}” · de ${app.vetos.length} no total`
      : `<strong>${app.vetos.length}</strong> vetos em tramitação · ${totDisp} dispositivos · ${comResumo} com resumo de IA`;
  }
  atualizarBotaoWord();

  if (!app.vetos.length && !app.sessaoAtiva) {
    lista.innerHTML = '<div class="cn-empty" id="cn-empty"><span class="cn-spinner"></span> Carregando vetos…</div>';
    return;
  }

  // Auto-expande, durante a busca, os vetos cujo texto interno casou.
  if (termo) filtrados.forEach(v => {
    if (v.detalheCarregado && v.dispositivos.some(d =>
      normalizar([d.codigo, d.descricao, d.texto, d.resumo].join(' ')).includes(normalizar(termo)))) v.aberto = true;
  });

  let html = filtrados.map(v => renderVeto(v, termo)).join('');
  if (app.sessaoAtiva) html += renderPlnsSecao(termo);
  lista.innerHTML = html || '<div class="cn-empty">Nenhum item corresponde à busca.</div>';
  wireCards();
  if (app.sessaoAtiva) wirePlnCards();

  // Controles de seleção (só quando há vetos visíveis para exportar)
  if (filtrados.length) {
    stats.innerHTML += ` · <a href="#" id="cn-sel-todos">Selecionar todos${termo ? ' (visíveis)' : ''}</a>`
      + ` · <a href="#" id="cn-sel-limpar">Desmarcar todos</a><span id="cn-selnum"></span>`;
    document.getElementById('cn-sel-todos').addEventListener('click', e => {
      e.preventDefault(); filtrados.forEach(v => app.selecionados.add(v.key)); renderLista();
    });
    document.getElementById('cn-sel-limpar').addEventListener('click', e => {
      e.preventDefault(); app.selecionados.clear(); renderLista();
    });
  }
  atualizarSelecaoUI();
}

function atualizarBotaoWord() {
  const btn = document.getElementById('btn-exportar-docx');
  if (!btn) return;
  const n = app.selecionados.size;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Word${n ? ` (${n})` : ''}`;
  btn.title = n ? `Exportar ${n} veto(s) selecionado(s) para Word` : 'Exportar os vetos visíveis para Word (.docx)';
}

function toggleSelecao(key, checked) {
  if (checked) app.selecionados.add(key); else app.selecionados.delete(key);
  atualizarSelecaoUI();   // atualiza contador/botão sem re-renderizar toda a lista
}

function atualizarSelecaoUI() {
  atualizarBotaoWord();
  const n = app.selecionados.size;
  const num = document.getElementById('cn-selnum');
  if (num) num.innerHTML = n ? ` · <strong>${n}</strong> selecionado(s) p/ Word` : '';
}

function renderVeto(v, termo) {
  const badgeSobresta = v.sobresta === 'Sim'
    ? `<span class="cn-badge cn-badge--sobresta">Sobrestando a pauta${v.dataSobresta ? ' desde ' + v.dataSobresta : ''}</span>`
    : (v.sobresta === 'Não'
        ? `<span class="cn-badge cn-badge--prazo">Sobresta ${v.dataSobresta ? 'a partir de ' + v.dataSobresta : 'futuramente'}</span>`
        : '');
  const badgeQtd = v.tipo === 'Total'
    ? '<span class="cn-badge cn-badge--total">Veto Total</span>'
    : `<span class="cn-badge cn-badge--qtd">${v.qtdNum != null ? v.qtdNum : (v.qtdRaw || '?')} dispositivo${(v.qtdNum === 1) ? '' : 's'}</span>`;

  return `
    <div class="cn-veto cn-veto--${v.cor || ''} ${v.aberto ? 'aberto' : ''}" data-key="${v.key}">
      <div class="cn-veto-head" data-toggle="${v.key}">
        <label class="cn-veto-check" title="Selecionar para exportar"><input type="checkbox" data-sel="${v.key}" ${app.selecionados.has(v.key) ? 'checked' : ''}></label>
        <div class="cn-veto-num">VET ${marca(v.numero, termo)}<small>${v.tipo}</small></div>
        <div class="cn-veto-meta">
          <div class="cn-veto-assunto">${marca(v.assunto, termo)}</div>
          <div class="cn-veto-materia">${marca(v.materia, termo)}</div>
        </div>
        <div class="cn-veto-badges">${badgeSobresta}${badgeQtd}</div>
        <svg class="cn-veto-caret" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      ${v.aberto ? renderCorpo(v, termo) : ''}
    </div>`;
}

function renderResumoProjeto(v, termo) {
  if (v.resumindoProjeto) {
    return `<div class="cn-projeto-resumo"><strong>Resumo do Projeto:</strong> <span class="cn-spinner"></span> gerando…</div>`;
  }
  if (!v.detalheCarregado && !v.resumoProjeto) return '';   // ainda sem ementa carregada
  const val = `${v.key}|__projeto__`;
  const btnEditar = `<button class="cn-disp-edit-btn" data-editar="${val}" title="Editar o resumo do projeto">✎</button>`;
  const conteudo = v.resumoProjeto
    ? `<span class="cn-disp-resumo-txt">${marca(v.resumoProjeto, termo)}</span>`
    : `<span class="cn-disp-resumo-txt cn-projeto-vazio">${app.config?.apiKey ? '— (abra para gerar ou clique em ✎ para escrever)' : 'configure a IA para gerar, ou clique em ✎ para escrever'}</span>`;
  return `<div class="cn-projeto-resumo${v.resumoProjeto ? '' : ' vazio'}" data-resumo="${val}"><strong>Resumo do Projeto:</strong> ${conteudo}${btnEditar}</div>`;
}

// Indexa as razões por código: code -> { anchor, resumo, codigos }.
// O "anchor" é o primeiro dispositivo (na ordem da lista) de cada grupo —
// é nele que a razão (compartilhada) é exibida uma única vez.
function razoesIndex(veto) {
  const map = new Map();
  const ordem = (veto.dispositivos || []).map(d => d.codigo);
  (veto.razoesGrupos || []).forEach(g => {
    const cods = (g.codigos || []).filter(Boolean);
    if (!cods.length || !g.resumo) return;
    const ord = cods.slice().sort((a, b) => {
      const ia = ordem.indexOf(a), ib = ordem.indexOf(b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });
    const anchor = ord[0], tail = ord[ord.length - 1];
    cods.forEach(c => map.set(c, { anchor: c === anchor, tail: c === tail, resumo: g.resumo, codigos: cods }));
  });
  return map;
}

function renderRazoesDisp(v, d, i, razIdx, termo) {
  const rz = razIdx.get(d.codigo);
  if (rz && rz.anchor) {
    const val = `${v.key}|__razoesg__${d.codigo}`;
    const btnEditar = `<button class="cn-disp-edit-btn" data-editar="${val}" title="Editar as razões">✎</button>`;
    const cobre = rz.codigos.length > 1 ? ` (aplica-se a ${rz.codigos.join(', ')})` : '';
    return `<div class="cn-razoes" data-resumo="${val}"><strong>Razões do veto${cobre}:</strong> <span class="cn-disp-resumo-txt">${marca(rz.resumo, termo)}</span>${btnEditar}</div>`;
  }
  // Indicador único de "gerando" (apenas no 1º dispositivo) enquanto não há grupos.
  if (!razIdx.size && v.resumindoRazoes && i === 0) {
    return `<div class="cn-razoes vazio"><span class="cn-spinner"></span> Resumindo as razões do veto…</div>`;
  }
  return '';
}

function renderRazoesTotal(v, termo) {
  if (v.tipo !== 'Total') return '';
  if (v.resumindoRazoes && !v.razoesProjeto)
    return `<div class="cn-razoes"><strong>Razões do Veto:</strong> <span class="cn-spinner"></span> gerando…</div>`;
  if (!v.detalheCarregado && !v.razoesProjeto) return '';
  const val = `${v.key}|__razoes__`;
  const btnEditar = `<button class="cn-disp-edit-btn" data-editar="${val}" title="Editar as razões do veto">✎</button>`;
  const conteudo = v.razoesProjeto
    ? `<span class="cn-disp-resumo-txt">${marca(v.razoesProjeto, termo)}</span>`
    : `<span class="cn-disp-resumo-txt cn-projeto-vazio">${app.config?.apiKey ? '— (abra para gerar ou clique em ✎)' : 'configure a IA para gerar, ou clique em ✎'}</span>`;
  return `<div class="cn-razoes${v.razoesProjeto ? '' : ' vazio'}" data-resumo="${val}"><strong>Razões do Veto:</strong> ${conteudo}${btnEditar}</div>`;
}

function renderCorpo(v, termo) {
  let inner;
  if (v.carregandoDetalhe || (!v.detalheCarregado && !v.dispositivos.length)) {
    inner = '<div class="cn-disp-resumo vazio"><span class="cn-spinner"></span> Carregando dispositivos vetados…</div>';
  } else if (!v.dispositivos.length) {
    inner = '<div class="cn-disp-resumo vazio">Nenhum dispositivo vetado encontrado na página oficial.</div>';
  } else {
    const razIdx = razoesIndex(v);
    inner = v.dispositivos.map((d, i) => {
      const val = `${v.key}|${d.codigo}`;
      const btnEditar = `<button class="cn-disp-edit-btn" data-editar="${val}" title="Editar resumo">✎</button>`;
      const resumo = d.resumo
        ? `<div class="cn-disp-resumo" data-resumo="${val}"><span class="cn-disp-resumo-txt">${marca(d.resumo, termo)}</span>${btnEditar}</div>`
        : (v.resumindo
            ? '<div class="cn-disp-resumo vazio"><span class="cn-spinner"></span> Resumindo…</div>'
            : `<div class="cn-disp-resumo vazio" data-resumo="${val}"><span class="cn-disp-resumo-txt">Sem resumo de IA ainda.</span>${btnEditar}</div>`);
      const textoBloco = d.texto
        ? `<button class="cn-disp-toggle" data-texto="${v.key}|${d.codigo}">Ver texto do dispositivo vetado</button>
           <div class="cn-disp-texto" data-texto-box="${v.key}|${d.codigo}" style="display:none">${marca(d.texto, termo)}</div>`
        : '';
      return `<div class="cn-disp">
        <div class="cn-disp-top">
          <span class="cn-disp-cod">${marca(d.codigo, termo)}</span>
          <span class="cn-disp-desc">${marca(d.descricao, termo)}${d.situacao ? `<span class="cn-disp-situacao">${escapeHtml(d.situacao)}</span>` : ''}</span>
        </div>
        ${resumo}
        ${renderRazoesDisp(v, d, i, razIdx, termo)}
        ${textoBloco}
      </div>`;
    }).join('');
  }

  const metaIA = v.resumoMeta
    ? `<span style="font-size:11px;color:var(--text-dim)">Resumo: ${v.resumoMeta.provedor}${v.resumoMeta.modelo ? ' / ' + v.resumoMeta.modelo : ''}</span>` : '';
  const feitos = v.dispositivos.filter(d => d.resumo).length;
  const faltam = v.dispositivos.length - feitos;

  let botaoResumir;
  if (v.resumindo) {
    const p = v._progresso;
    botaoResumir = `<button class="btn btn-outline btn-sm" disabled><span class="cn-spinner"></span> Resumindo…${p ? ` ${p.feito}/${p.total}` : ''}</button>`;
  } else if (faltam > 0 && feitos > 0) {
    botaoResumir = `<button class="btn btn-primary btn-sm" data-resumir="${v.key}">↻ Continuar (${faltam} restante${faltam === 1 ? '' : 's'})</button>`;
  } else if (faltam > 0) {
    botaoResumir = `<button class="btn btn-outline btn-sm" data-resumir="${v.key}">✨ Resumir com IA</button>`;
  } else {
    botaoResumir = `<button class="btn btn-outline btn-sm" data-regerar="${v.key}">↻ Regerar resumos</button>`;
  }

  return `<div class="cn-veto-body">
    ${v.ementa ? `<div class="cn-veto-ementa"><strong>Ementa:</strong> ${marca(v.ementa, termo)}</div>` : ''}
    ${renderResumoProjeto(v, termo)}
    ${renderRazoesTotal(v, termo)}
    <div class="cn-veto-acoes">
      ${botaoResumir}
      ${v.detalheUrl ? `<a class="btn btn-ghost btn-sm" href="${v.detalheUrl}" target="_blank" rel="noopener">Abrir página oficial ↗</a>` : ''}
      ${metaIA}
    </div>
    ${inner}
  </div>`;
}

function wireCards() {
  document.querySelectorAll('.cn-veto-head[data-toggle]').forEach(h =>
    h.addEventListener('click', () => toggleVeto(h.dataset.toggle)));
  document.querySelectorAll('input[data-sel]').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());          // não abrir/fechar o card
    cb.addEventListener('change', e => { e.stopPropagation(); toggleSelecao(cb.dataset.sel, cb.checked); });
  });
  document.querySelectorAll('[data-resumir]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const v = app.vetos.find(x => x.key === b.dataset.resumir);
      if (v) resumirVeto(v, { apenasFaltantes: true });   // gera/retoma os faltantes
    }));
  document.querySelectorAll('[data-regerar]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const v = app.vetos.find(x => x.key === b.dataset.regerar);
      if (v) resumirVeto(v, { apenasFaltantes: false });  // regera todos
    }));
  document.querySelectorAll('[data-texto]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const box = b.nextElementSibling; // a div .cn-disp-texto vem logo após o botão
      if (box && box.classList.contains('cn-disp-texto')) {
        const vis = box.style.display !== 'none';
        box.style.display = vis ? 'none' : 'block';
        b.textContent = vis ? 'Ver texto do dispositivo vetado' : 'Ocultar texto do dispositivo vetado';
      }
    }));
  document.querySelectorAll('[data-editar]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const [key, codigo] = b.dataset.editar.split('|');
      entrarEdicao(key, codigo);
    }));
}

async function toggleVeto(key) {
  if (app.editando) fecharEdicao(true);
  const v = app.vetos.find(x => x.key === key);
  if (!v) return;
  v.aberto = !v.aberto;
  renderLista();
  if (v.aberto && !v.detalheCarregado) {
    try {
      await carregarDetalhe(v);
      renderLista();
      salvarCacheLocal();
      // Ao abrir: gera o "Resumo do Projeto" (1 chamada barata, qualquer tamanho).
      // Os resumos dos dispositivos só são automáticos para vetos pequenos (≤25);
      // os grandes exigem clique explícito para evitar dezenas de chamadas.
      if (app.config?.apiKey) {
        const pequeno = v.dispositivos.length && v.dispositivos.length <= 25;
        if (pequeno && !v.dispositivos.some(d => d.resumo)) {
          resumirVeto(v, { silencioso: true });        // inclui o resumo do projeto
        } else if (!v.resumoProjeto) {
          resumirProjeto(v, { silencioso: true });     // ao menos o resumo do projeto
        }
      }
    } catch (e) {
      if (!isAbort(e)) { mostrarToast('Erro ao abrir o veto: ' + e.message, 'erro'); renderLista(); }
    }
  }
}

// ============================================================
//  EDIÇÃO INLINE DO RESUMO (com autosave no Firebase + cache)
// ============================================================
// Alvo da edição: dispositivo (por código), resumo do projeto ("__projeto__"),
// razões do veto total ("__razoes__") ou razões de um grupo ("__razoesg__<âncora>").
function grupoRazoesPorAnchor(veto, anchorCode) {
  const ordem = (veto.dispositivos || []).map(d => d.codigo);
  return (veto.razoesGrupos || []).find(g => {
    const cods = (g.codigos || []).filter(Boolean);
    const anchor = cods.slice().sort((a, b) => {
      const ia = ordem.indexOf(a), ib = ordem.indexOf(b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    })[0];
    return anchor === anchorCode;
  });
}
function alvoExiste(veto, codigo) {
  if (codigo === '__plnanalise__') return !!veto;
  if (codigo === '__projeto__' || codigo === '__razoes__') return true;
  if (codigo.startsWith('__razoesg__')) return !!grupoRazoesPorAnchor(veto, codigo.slice(11));
  return !!veto?.dispositivos.find(x => x.codigo === codigo);
}
function getResumoAlvo(veto, codigo) {
  if (codigo === '__plnanalise__') return veto.analise || '';
  if (codigo === '__projeto__') return veto.resumoProjeto || '';
  if (codigo === '__razoes__') return veto.razoesProjeto || '';
  if (codigo.startsWith('__razoesg__')) return grupoRazoesPorAnchor(veto, codigo.slice(11))?.resumo || '';
  return veto.dispositivos.find(x => x.codigo === codigo)?.resumo || '';
}
function setResumoAlvo(veto, codigo, valor) {
  if (codigo === '__plnanalise__') { veto.analise = valor; return; }
  if (codigo === '__projeto__') { veto.resumoProjeto = valor; return; }
  if (codigo === '__razoes__') { veto.razoesProjeto = valor; return; }
  if (codigo.startsWith('__razoesg__')) { const g = grupoRazoesPorAnchor(veto, codigo.slice(11)); if (g) g.resumo = valor; return; }
  const d = veto.dispositivos.find(x => x.codigo === codigo);
  if (d) d.resumo = valor;
}

// Resolve o alvo da edição: veto (lista/pauta) ou a análise de um PLN/MPV ("__plnanalise__").
function acharAlvo(key, codigo) {
  if (codigo === '__plnanalise__') return (app.sessaoAtiva?.plns || []).find(p => p.key === key);
  return app.vetos.find(v => v.key === key);
}
function marcarMetaAlvo(alvo, codigo) {
  const base = { provedor: (codigo === '__plnanalise__' ? alvo.analiseMeta : alvo.resumoMeta)?.provedor || app.config?.provedor || 'manual',
                 modelo: (codigo === '__plnanalise__' ? alvo.analiseMeta : alvo.resumoMeta)?.modelo,
                 atualizadoEm: new Date().toISOString(), editadoPor: 'equipe' };
  if (codigo === '__plnanalise__') alvo.analiseMeta = base; else alvo.resumoMeta = base;
}
async function persistirAlvo(alvo, codigo) {
  return codigo === '__plnanalise__' ? persistirPln(alvo) : persistirResumo(alvo);
}
async function persistirPln(pln) {
  if (!app.sessaoAtiva) return false;
  atualizarStatusSync('sincronizando');
  try { await fbSalvarPlnPauta(app.sessaoAtiva.id, pln); atualizarStatusSync('ok'); return true; }
  catch (e) { console.warn('Firebase PLN falhou:', e.message); atualizarStatusSync('offline'); return false; }
}

function entrarEdicao(key, codigo) {
  if (app.editando) fecharEdicao(true);
  const alvo = acharAlvo(key, codigo);
  if (!alvo || !alvoExiste(alvo, codigo)) return;
  const val = `${key}|${codigo}`;
  const div = document.querySelector(`[data-resumo="${val}"]`);
  if (!div) return;
  const atual = getResumoAlvo(alvo, codigo);

  app.editando = { key, codigo, salvando: false, dirty: false, debounce: null, snapshot: atual };
  atualizarBotaoParar();
  div.classList.remove('vazio');
  div.classList.add('editando');
  div.innerHTML = `
    <textarea class="cn-disp-edit" data-edit="${val}">${escapeHtml(atual)}</textarea>
    <div class="cn-disp-edit-bar">
      <span class="cn-disp-edit-status" data-edit-status></span>
      <button class="btn btn-ghost btn-sm" data-edit-cancel>Cancelar</button>
      <button class="btn btn-primary btn-sm" data-edit-save>Salvar</button>
    </div>`;
  const ta = div.querySelector('textarea');
  ta.addEventListener('input', agendarAutosaveEdit);
  ta.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); fecharEdicao(false); } });
  div.querySelector('[data-edit-cancel]').addEventListener('click', e => { e.stopPropagation(); fecharEdicao(false); });
  div.querySelector('[data-edit-save]').addEventListener('click', e => { e.stopPropagation(); fecharEdicao(true); });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function agendarAutosaveEdit() {
  const e = app.editando;
  if (!e) return;
  e.dirty = true;
  if (e.debounce) clearTimeout(e.debounce);
  setEditStatus('editando…', 'var(--text-dim)');
  e.debounce = setTimeout(executarAutosaveEdit, 1500);
}

async function executarAutosaveEdit() {
  const e = app.editando;
  if (!e) return;
  const ta = document.querySelector(`[data-edit="${e.key}|${e.codigo}"]`);
  if (!ta) return;
  if (e.salvando) { e.debounce = setTimeout(executarAutosaveEdit, 400); return; }
  const alvo = acharAlvo(e.key, e.codigo);
  if (!alvo || !alvoExiste(alvo, e.codigo)) return;

  e.salvando = true; e.dirty = false;
  setEditStatus('salvando…', 'var(--text-dim)');
  setResumoAlvo(alvo, e.codigo, ta.value.trim());
  marcarMetaAlvo(alvo, e.codigo);
  const ok = await persistirAlvo(alvo, e.codigo);
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  setEditStatus(ok ? `✓ salvo às ${hora}` : '⚠ salvo localmente (Firebase offline)', ok ? '#3ad97d' : '#f0c040');
  e.salvando = false;
  if (e.dirty && !e.debounce) e.debounce = setTimeout(executarAutosaveEdit, 1500);
}

function setEditStatus(texto, cor) {
  const el = document.querySelector('[data-edit-status]');
  if (!el) return;
  el.textContent = texto;
  el.style.color = cor || 'var(--text-dim)';
}

function fecharEdicao(salvar) {
  const e = app.editando;
  if (!e) return;
  if (e.debounce) { clearTimeout(e.debounce); e.debounce = null; }
  const ta = document.querySelector(`[data-edit="${e.key}|${e.codigo}"]`);
  const alvo = acharAlvo(e.key, e.codigo);
  app.editando = null;            // libera antes de re-renderizar
  if (alvo && alvoExiste(alvo, e.codigo)) {
    if (salvar && ta) {
      const valor = ta.value.trim();
      if (valor !== e.snapshot) {
        setResumoAlvo(alvo, e.codigo, valor);
        marcarMetaAlvo(alvo, e.codigo);
        persistirAlvo(alvo, e.codigo);
      }
    } else if (!salvar && getResumoAlvo(alvo, e.codigo) !== e.snapshot) {
      setResumoAlvo(alvo, e.codigo, e.snapshot);  // reverte (re-grava caso o autosave já tenha persistido)
      persistirAlvo(alvo, e.codigo);
    }
  }
  atualizarBotaoParar();
  renderLista();
}

// ============================================================
//  PERSISTÊNCIA — cache local + Firebase (resumos compartilhados)
// ============================================================
function salvarCacheLocal() {
  if (app.sessaoAtiva) return;   // em sessão salva, o estado vive no Firebase, não no cache da lista viva
  clearTimeout(app.saveTimer);
  app.saveTimer = setTimeout(() => {
    const lean = app.vetos.map(v => ({ ...v, aberto: false, resumindo: false, carregandoDetalhe: false }));
    chrome.storage.local.set({ cnVetosCache: { atualizadoEm: new Date().toISOString(), vetos: lean } });
  }, 400);
}

function carregarCacheLocal() {
  return new Promise(r => chrome.storage.local.get('cnVetosCache', d => r(d.cnVetosCache || null)));
}

async function fbSalvarResumo(veto) {
  const resumos = {};
  veto.dispositivos.forEach(d => { if (d.resumo) resumos[d.codigo.replace(/\./g, '_')] = d.resumo; });
  const temRazoes = (veto.razoesGrupos && veto.razoesGrupos.length) || veto.razoesProjeto;
  if (!Object.keys(resumos).length && !veto.resumoProjeto && !temRazoes) return;
  const body = {
    numero: veto.numero, ano: veto.ano, materia: veto.materia, assunto: veto.assunto,
    resumos, resumoProjeto: veto.resumoProjeto || null,
    razoesGrupos: (veto.razoesGrupos && veto.razoesGrupos.length) ? veto.razoesGrupos : null,
    razoesProjeto: veto.razoesProjeto || null,
    razoesPdfUrl: veto.razoesPdfUrl || null,
    ...veto.resumoMeta,
  };
  const res = await fetch(`${FIREBASE_URL}/vetos_resumos/${veto.key}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firebase PUT HTTP ${res.status}`);
}

async function mesclarResumosFirebase() {
  let dados = null;
  try {
    const res = await fetch(`${FIREBASE_URL}/vetos_resumos.json`);
    if (res.ok) dados = await res.json();
  } catch (e) { console.warn('Firebase indisponível:', e.message); }
  if (!dados) return;

  for (const v of app.vetos) {
    const reg = dados[v.key];
    if (!reg) continue;
    v.resumoMeta = { provedor: reg.provedor, modelo: reg.modelo, atualizadoEm: reg.atualizadoEm };
    if (reg.resumoProjeto && !v.resumoProjeto) v.resumoProjeto = reg.resumoProjeto;
    if (reg.razoesProjeto && !v.razoesProjeto) v.razoesProjeto = reg.razoesProjeto;
    if (Array.isArray(reg.razoesGrupos) && !(v.razoesGrupos && v.razoesGrupos.length)) v.razoesGrupos = reg.razoesGrupos.filter(Boolean);
    if (reg.razoesPdfUrl && !v.razoesPdfUrl) v.razoesPdfUrl = reg.razoesPdfUrl;
    if (!reg.resumos) continue;
    // Se ainda não temos os dispositivos (sem detalhe), guarda os resumos para aplicar depois.
    if (v.dispositivos.length) {
      v.dispositivos.forEach(d => {
        const r = reg.resumos[d.codigo.replace(/\./g, '_')];
        if (r && !d.resumo) d.resumo = r;
      });
    } else {
      v._resumosPendentes = reg.resumos;
    }
  }
}

// ============================================================
//  CONFIGURAÇÕES (provedor de IA — compartilhado com os demais painéis)
// ============================================================
function carregarConfig() {
  return new Promise(r => chrome.storage.local.get('config', d => { app.config = d.config || {}; r(); }));
}

function abrirConfig() {
  const c = app.config || {};
  document.getElementById('config-provedor').value = c.provedor || 'gemini';
  document.getElementById('config-api-key').value = c.apiKey || '';
  onProvedorChange();
  popularModelos(c.modelo);
  document.getElementById('config-status-ia').style.display = 'none';
  popularSelectPerfis(app.perfilPadraoId || '');
  refletirSelecaoPerfil();
  document.getElementById('perfil-status').textContent = '';
  document.getElementById('modal-configuracoes').style.display = 'flex';
}

function onProvedorChange() {
  const pid = document.getElementById('config-provedor').value;
  const p = PROVEDORES_META[pid];
  document.getElementById('config-api-key').placeholder = p.placeholderChave;
  document.getElementById('config-hint-chave').textContent = p.hintChave;
  popularModelos();
}

function popularModelos(selecionado) {
  const pid = document.getElementById('config-provedor').value;
  const sel = document.getElementById('config-modelo');
  const modelos = PROVEDORES_META[pid].modelosFallback;
  sel.innerHTML = modelos.map(m => `<option value="${m.id}">${m.displayName}</option>`).join('');
  const alvo = selecionado || (app.config?.provedor === pid ? app.config?.modelo : '');
  if (alvo && modelos.some(m => m.id === alvo)) sel.value = alvo;
}

async function carregarModelos() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim();
  const st = document.getElementById('modelos-status');
  if (!key) { st.textContent = 'Informe a chave primeiro.'; st.style.display = 'block'; return; }
  st.textContent = 'Carregando modelos…'; st.style.display = 'block';
  try {
    const lista = await PROVEDORES_META[pid].listar(key);
    const sel = document.getElementById('config-modelo');
    sel.innerHTML = lista.map(m => `<option value="${m.id}">${m.displayName}</option>`).join('');
    if (app.config?.modelo && lista.some(m => m.id === app.config.modelo)) sel.value = app.config.modelo;
    st.textContent = `✓ ${lista.length} modelo(s) disponível(is).`;
  } catch (e) { st.textContent = 'Erro: ' + e.message; }
}

async function testarConexao() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim();
  const modelo = document.getElementById('config-modelo').value;
  const st = document.getElementById('config-status-ia');
  const p = PROVEDORES_META[pid];
  st.style.display = 'block'; st.className = 'config-status teste'; st.textContent = 'Testando…';
  if (!p.regexChave.test(key)) { st.className = 'config-status erro'; st.textContent = `Chave inválida para ${p.label}.`; return; }
  try {
    const r = await chamarIAtexto({ provedor: pid, apiKey: key, modelo, prompt: 'Responda apenas com a palavra OK.' });
    st.className = 'config-status ok';
    st.textContent = r ? `✓ Conexão OK com ${p.label}.` : '✓ Conectado, mas a resposta veio vazia.';
  } catch (e) { st.className = 'config-status erro'; st.textContent = 'Falha: ' + e.message; }
}

async function salvarConfig() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim();
  const modelo = document.getElementById('config-modelo').value;
  const p = PROVEDORES_META[pid];
  if (!key) { mostrarToast('Informe a chave de API.', 'aviso'); return; }
  if (!p.regexChave.test(key)) { mostrarToast(`Chave inválida para ${p.label}.`, 'aviso'); return; }
  app.config = { ...(app.config || {}), provedor: pid, apiKey: key, modelo };
  delete app.config.geminiKey;
  await new Promise(r => chrome.storage.local.set({ config: app.config }, r));
  document.getElementById('modal-configuracoes').style.display = 'none';
  mostrarToast('✓ Configurações salvas', 'sucesso');
}

// ============================================================
//  PERFIS DE PROMPT (biblioteca compartilhada via Firebase)
// ============================================================
async function fbCarregarPerfis() {
  const res = await fetch(`${FIREBASE_URL}/vetos_prompts.json`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data) return [];
  return Object.entries(data).map(([id, p]) => ({ ...p, id }))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}
async function fbSalvarPerfil(p) {
  const id = p.id || ('vp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const corpo = {
    nome: p.nome, texto: p.texto,
    criadoPor: p.criadoPor || 'equipe',
    criadoEm: p.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  const res = await fetch(`${FIREBASE_URL}/vetos_prompts/${id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  return { ...corpo, id };
}
async function fbApagarPerfil(id) {
  const res = await fetch(`${FIREBASE_URL}/vetos_prompts/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}
async function fbCarregarPerfilPadrao() {
  const res = await fetch(`${FIREBASE_URL}/vetos_prompt_padrao.json`);
  if (!res.ok) return null;
  return await res.json();
}
async function fbSalvarPerfilPadrao(id) {
  const res = await fetch(`${FIREBASE_URL}/vetos_prompt_padrao.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id || null),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}
async function carregarBibliotecaPerfis() {
  const [lista, padraoId] = await Promise.all([fbCarregarPerfis(), fbCarregarPerfilPadrao()]);
  app.perfis = lista;
  app.perfilPadraoId = padraoId || null;
}

function popularSelectPerfis(selecionadoId = '') {
  const sel = document.getElementById('perfil-select');
  const opts = ['<option value="">— Novo perfil —</option>'].concat(
    (app.perfis || []).map(p => {
      const m = p.id === app.perfilPadraoId ? ' ★ (padrão)' : '';
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nome || '(sem nome)')}${m}</option>`;
    }));
  sel.innerHTML = opts.join('');
  sel.value = selecionadoId || '';
}
function refletirSelecaoPerfil() {
  const id = document.getElementById('perfil-select').value;
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
//  PAUTAS DE SESSÃO (agendas do CN: vetos + PLNs + MPVs) — Firebase
// ============================================================
function leanVeto(v) {
  const { aberto, resumindo, resumindoProjeto, resumindoRazoes, carregandoDetalhe,
          razoesTexto, _progresso, _resumosPendentes, ...rest } = v;
  return rest;   // razoesTexto (PDF) é transitório — não vai pro Firebase/cache
}
function leanPln(p) {
  const { resumindoAnalise, aberto, ...rest } = p;
  return rest;
}

// Lê SÓ o índice leve de metadados das pautas (não baixa as pautas inteiras).
async function fbCarregarSessoes() {
  const res = await fetch(`${FIREBASE_URL}/${PAUTAS_META}.json`);
  const data = res.ok ? await res.json() : null;
  if (!data) return [];
  return Object.entries(data).map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (b.data || b.criadoEm || '').localeCompare(a.data || a.criadoEm || ''));
}

async function fbSalvarPauta(pauta) {
  const vetosMap = {}; (pauta.vetos || []).forEach(v => { vetosMap[v.key] = leanVeto(v); });
  const plnsMap = {};  (pauta.plns  || []).forEach(p => { plnsMap[p.key]  = leanPln(p);  });
  const corpo = {
    nome: pauta.nome, data: pauta.data || '', pautaId: pauta.pautaId || '',
    criadoPor: 'equipe', criadoEm: pauta.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(), vetos: vetosMap, plns: plnsMap,
  };
  const res = await fetch(`${FIREBASE_URL}/${PAUTAS_PATH}/${pauta.id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  fetch(`${FIREBASE_URL}/${PAUTAS_META}/${pauta.id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: corpo.nome, data: corpo.data, criadoEm: corpo.criadoEm, atualizadoEm: corpo.atualizadoEm,
      totalVetos: Object.keys(vetosMap).length, totalPlns: Object.keys(plnsMap).length }),
  }).catch(() => {});
}

// Mantém o nome (usado por persistirResumo) — agora grava o veto na pauta ativa.
async function fbSalvarVetoSessao(id, veto) {
  const r = await fetch(`${FIREBASE_URL}/${PAUTAS_PATH}/${id}/vetos/${veto.key}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leanVeto(veto)),
  });
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
  const agora = JSON.stringify(new Date().toISOString());
  fetch(`${FIREBASE_URL}/${PAUTAS_PATH}/${id}/atualizadoEm.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: agora }).catch(() => {});
  fetch(`${FIREBASE_URL}/${PAUTAS_META}/${id}/atualizadoEm.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: agora }).catch(() => {});
}

async function fbSalvarPlnPauta(id, pln) {
  const r = await fetch(`${FIREBASE_URL}/${PAUTAS_PATH}/${id}/plns/${pln.key}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leanPln(pln)),
  });
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
}

async function fbApagarPauta(id) {
  const res = await fetch(`${FIREBASE_URL}/${PAUTAS_PATH}/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  fetch(`${FIREBASE_URL}/${PAUTAS_META}/${id}.json`, { method: 'DELETE' }).catch(() => {});
}

async function carregarSessoes() {
  app.sessoes = await fbCarregarSessoes();
}

function renderSidebar() {
  const atual = document.getElementById('cn-sessao-atual');
  const btnVivo = document.getElementById('btn-sessao-vivo');
  if (app.sessaoAtiva) {
    atual.textContent = `📁 ${app.sessaoAtiva.nome}`;
    atual.classList.remove('empty');
    btnVivo.style.display = 'block';
  } else {
    atual.textContent = 'Vetos em tramitação (ao vivo)';
    btnVivo.style.display = 'none';
  }
  const lista = document.getElementById('cn-pautas-lista');
  if (!lista) return;
  if (!app.sessoes.length) {
    lista.innerHTML = '<div class="empty-state"><p>Nenhuma pauta importada</p></div>';
    return;
  }
  lista.innerHTML = app.sessoes.map(s => {
    const tot = `${s.totalVetos || 0} veto(s) · ${s.totalPlns || 0} PLN/MPV`;
    const ativa = app.sessaoAtiva?.id === s.id ? ' ativa' : '';
    return `<div class="cn-sessao-item${ativa}" data-pauta="${s.id}">
      <div class="cn-sessao-item-info">
        <div class="cn-sessao-item-nome">${escapeHtml(s.nome || '(sem nome)')}</div>
        <div class="cn-sessao-item-data">${escapeHtml(s.data || '')}${s.data ? ' · ' : ''}${tot}</div>
      </div>
      <button class="cn-sessao-item-del" data-pauta-del="${s.id}" title="Excluir pauta">✕</button>
    </div>`;
  }).join('');
  lista.querySelectorAll('[data-pauta]').forEach(el =>
    el.addEventListener('click', () => abrirPauta(el.dataset.pauta)));
  lista.querySelectorAll('[data-pauta-del]').forEach(b =>
    b.addEventListener('click', e => excluirPauta(b.dataset.pautaDel, e)));
}

async function abrirPauta(id) {
  if (app.editando) fecharEdicao(true);
  mostrarToast('Carregando pauta…', '');
  try {
    const res = await fetch(`${FIREBASE_URL}/${PAUTAS_PATH}/${id}.json`);
    const s = res.ok ? await res.json() : null;
    if (!s) throw new Error('Pauta não encontrada.');
    // RTDB não guarda arrays vazios (voltam como undefined) e pode devolver
    // arrays como objeto — normaliza para evitar quebra no render/impressão.
    const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : []);
    const vetos = (s.vetos ? Object.values(s.vetos) : []).map(v => ({
      ...v,
      dispositivos: arr(v.dispositivos),
      razoesGrupos: arr(v.razoesGrupos),
      aberto: false, resumindo: false, carregandoDetalhe: false,
    }));
    vetos.sort((a, b) => (b.ano - a.ano) || (b.num - a.num));
    app.vetos = vetos;
    const plns = s.plns ? Object.values(s.plns) : [];
    plns.sort((a, b) => (a.sigla || '').localeCompare(b.sigla || '') || (a.num - b.num));
    app.sessaoAtiva = { id, nome: s.nome, data: s.data, plns: plns.map(p => ({ ...p, aberto: false, resumindoAnalise: false })) };
    app.selecionados.clear();
    renderSidebar();
    renderLista();
    mostrarToast(`Pauta "${s.nome}" carregada.`, 'sucesso');
  } catch (e) { mostrarToast('Erro ao carregar pauta: ' + e.message, 'erro'); }
}

async function voltarAoVivo() {
  if (app.editando) fecharEdicao(true);
  app.sessaoAtiva = null;
  renderSidebar();
  const cache = await carregarCacheLocal();
  if (cache?.vetos?.length) {
    app.vetos = cache.vetos.map(v => ({ ...v, aberto: false }));
    await mesclarResumosFirebase();
    renderLista();
    marcarSyncInicial();
  } else {
    carregarListaVetos(false);
  }
  mostrarToast('Voltou aos vetos em tramitação (ao vivo).', '');
}

async function excluirPauta(id, ev) {
  ev?.stopPropagation();
  const s = app.sessoes.find(x => x.id === id);
  if (!confirm(`Excluir a pauta "${s?.nome || id}"? Isso afeta toda a equipe.`)) return;
  try {
    await fbApagarPauta(id);
    if (app.sessaoAtiva?.id === id) await voltarAoVivo();
    await carregarSessoes();
    renderSidebar();
    mostrarToast('Pauta excluída.', '');
  } catch (e) { mostrarToast('Erro ao excluir: ' + e.message, 'erro'); }
}

// ---------- Importação da pauta (agenda do CN) ----------
function abrirModalImportar() {
  document.getElementById('import-url').value = '';
  setImportStatus('');
  document.getElementById('modal-importar').style.display = 'flex';
  const di = document.getElementById('import-data');
  di.value = new Date().toISOString().slice(0, 10);   // hoje
  listarSessoesPorData(di.value);
}
function setImportStatus(t, c) {
  const el = document.getElementById('import-status');
  if (el) { el.textContent = t || ''; el.style.color = c || 'var(--text-dim)'; }
}

function mesAnoLabel(iso) {
  const [a, m] = (iso || '').split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[(+m) - 1] || m}/${a}`;
}

// Lê as sessões do mês da data escolhida (endpoint da agenda) e lista as
// deliberativas (Conjuntas), destacando a do dia selecionado.
async function listarSessoesPorData(iso) {
  const box = document.getElementById('cn-sessoes-recentes');
  if (!iso) { box.innerHTML = '<div class="empty-state"><p>Escolha uma data.</p></div>'; return; }
  box.innerHTML = `<div class="empty-state"><p><span class="cn-spinner"></span> Buscando sessões de ${mesAnoLabel(iso)}…</p></div>`;
  try {
    const doc = new DOMParser().parseFromString(await fetchHtml(`${AGENDA_RESOURCE}&${AGENDA_NS}d=${iso}`), 'text/html');
    const ano = (iso.match(/^(\d{4})/) || [])[1] || '';
    const diaSel = iso.slice(5);   // "MM-DD"
    const itens = []; const vistos = new Set();
    doc.querySelectorAll('a[href*="/-/pauta/"]').forEach(a => {
      const m = (a.getAttribute('href') || '').match(/\/pauta\/(\d+)/); if (!m) return;
      const id = m[1]; if (vistos.has(id)) return;
      const linktxt = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/conjunta|deliberativa/i.test(linktxt)) return;   // só deliberativas (têm vetos/PLNs)
      const btxt = (a.closest('div')?.textContent || linktxt).replace(/\s+/g, ' ').trim();
      const dm = btxt.match(/\b(\d{2})\/(\d{2})\b/) || [];
      vistos.add(id);
      itens.push({
        id, ddmm: dm[0] || '',
        tipo: /conjunta/i.test(linktxt) ? 'Sessão Conjunta' : 'Sessão Deliberativa',
        ordinal: (btxt.match(/(\d+)[^\s\d/]{0,2}\s*Sess/i) || [])[1] || '',
        status: (linktxt.match(/\b(Encerrada|Em andamento|Convocada|Aberta|Cancelada|Suspensa|Adiada)\b/i) || [])[1] || '',
        noDia: !!(dm[1] && dm[2] && `${dm[2]}-${dm[1]}` === diaSel),
      });
    });
    if (!itens.length) {
      box.innerHTML = `<div class="empty-state"><p>Nenhuma Sessão Conjunta em ${mesAnoLabel(iso)}. Tente outro mês ou cole a URL abaixo.</p></div>`;
      return;
    }
    itens.sort((a, b) => (a.ddmm || '').localeCompare(b.ddmm || ''));
    box.innerHTML = itens.map(s => `<div class="cn-sessao-item${s.noDia ? ' ativa' : ''}" data-rec="${s.id}">
      <div class="cn-sessao-item-info">
        <div class="cn-sessao-item-nome">${s.ordinal ? s.ordinal + 'ª ' : ''}${s.tipo}${s.status ? ' · ' + s.status : ''}</div>
        <div class="cn-sessao-item-data">${s.ddmm}${ano ? '/' + ano : ''} · pauta ${s.id}</div>
      </div>
    </div>`).join('');
    box.querySelectorAll('[data-rec]').forEach(el => el.addEventListener('click', () => importarPauta(el.dataset.rec)));
  } catch (e) {
    box.innerHTML = `<div class="empty-state"><p>Não foi possível listar (${escapeHtml(e.message)}). Cole a URL abaixo.</p></div>`;
  }
}

function labelAgenda(corpo) {
  const m = corpo.match(/^(?:\(MSG[^)]*\)\s*)?(.*?)\s*(?:Vota[çc][aã]o|Discuss[aã]o),\s*em turno/i);
  return (m ? m[1] : corpo).replace(/\s+/g, ' ').trim().slice(0, 160);
}

// Extrai os itens deliberativos (vetos + PLNs + MPVs) da página da pauta.
function parsePautaHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const titulo = (doc.querySelector('h1')?.textContent || doc.title || 'Sessão Conjunta').replace(/\s+/g, ' ').trim();
  const data = (doc.body.textContent.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) || [])[1] || '';
  const vetos = [], plns = []; const vistos = new Set();
  doc.querySelectorAll('.accordion-group').forEach(g => {
    const tit = g.querySelector('.titulo-materia'); if (!tit) return;
    const t = tit.textContent.replace(/\s+/g, ' ').trim();
    const corpo = (g.querySelector('.accordion-conteudo, .accordion-inner')?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/em turno [úu]nico/i.test(corpo)) return;     // ignora sub-acordeões (votação por dispositivo etc.)
    const mnum = t.match(/N[ºo°]\s*(\d+)[,\s]+DE\s+(\d{4})/i); if (!mnum) return;
    const num = +mnum[1], ano = +mnum[2];
    if (/VETO/i.test(t)) {
      const key = `v${num}-${ano}`; if (vistos.has(key)) return; vistos.add(key);
      vetos.push({ numero: `${num}/${ano}`, num, ano, tipo: /TOTAL/i.test(t) ? 'Total' : 'Parcial',
        detalheUrl: g.querySelector('a[href*="veto/detalhe"]')?.href || '', assunto: '' });
    } else if (/PROJETO DE LEI DO CONGRESSO NACIONAL/i.test(t) || /MEDIDA PROVIS/i.test(t)) {
      const sigla = /MEDIDA PROVIS/i.test(t) ? 'MPV' : 'PLN';
      const key = `${sigla.toLowerCase()}-${num}-${ano}`; if (vistos.has(key)) return; vistos.add(key);
      plns.push({ tipo: sigla.toLowerCase(), sigla, numero: `${num}/${ano}`, num, ano, key,
        titulo: labelAgenda(corpo), materiaUrl: g.querySelector('a[href*="/materia/"]')?.href || '' });
    }
  });
  return { titulo, data, vetos, plns };
}

async function parseMateria(url) {
  const doc = new DOMParser().parseFromString(await fetchHtml(url), 'text/html');
  const meta = n => (doc.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || '').replace(/\s+/g, ' ').trim();
  return { ementa: meta('sf_ementa'), autor: meta('sf_autor') || meta('sf_autor_resumido'), parecerUrl: acharParecerUrl(doc) };
}
function acharParecerUrl(doc) {
  const links = [...doc.querySelectorAll('a[href*="sdleg-getter/documento"]')];
  const ctx = a => ((a.textContent || '') + ' ' + (a.closest('tr,li,div')?.textContent || '')).toLowerCase();
  let alvo = links.find(a => /parecer de plen[áa]rio/.test(ctx(a)));
  if (!alvo) alvo = links.find(a => /\bparecer\b/.test(ctx(a)) && !/reda[çc]/.test(ctx(a)));
  return alvo ? alvo.href : '';
}

async function importarPauta(url) {
  const id = (String(url).match(/\/pauta\/(\d+)/) || String(url).match(/(\d{4,})/) || [])[1];
  if (!id) { setImportStatus('URL ou ID inválido.', '#f0c040'); return; }
  setImportStatus('Baixando a pauta…');
  try {
    const p = parsePautaHtml(await fetchHtml(PAUTA_BASE_URL + id));
    if (!p.vetos.length && !p.plns.length) throw new Error('Nenhum veto/PLN encontrado nessa pauta (verifique se é uma Sessão Conjunta).');
    const total = p.vetos.length + p.plns.length; let feito = 0;
    const vetos = [];
    for (const it of p.vetos) {
      setImportStatus(`Carregando itens… ${++feito}/${total}`);
      const v = construirVeto({ numero: it.numero, num: it.num, ano: it.ano, materia: '', assunto: it.assunto || '', sobresta: '', data: '', qtdRaw: '', cor: '', detalheUrl: it.detalheUrl });
      v.tipo = it.tipo;
      try { await carregarDetalhe(v); } catch (_) {}
      // Assunto do card derivado da ementa (a agenda não traz um rótulo curto p/ vetos).
      if (!v.assunto && v.ementa) v.assunto = v.ementa.replace(/^Veto\s+(parcial|total|integral)\s+aposto\s+ao\s+/i, '').slice(0, 140);
      vetos.push(v);
    }
    const plns = [];
    for (const it of p.plns) {
      setImportStatus(`Carregando itens… ${++feito}/${total}`);
      const pln = { ...it, ementa: '', autor: '', parecerUrl: '', analise: '', analiseMeta: null, resumindoAnalise: false, aberto: false };
      try { Object.assign(pln, await parseMateria(it.materiaUrl)); } catch (_) {}
      plns.push(pln);
    }
    setImportStatus('Salvando…');
    const pauta = { id: 'p_' + id, pautaId: id, nome: p.titulo + (p.data ? ` — ${p.data}` : ''), data: p.data, vetos, plns, criadoEm: new Date().toISOString() };
    await fbSalvarPauta(pauta);
    await carregarSessoes();
    document.getElementById('modal-importar').style.display = 'none';
    await abrirPauta(pauta.id);
    mostrarToast(`✓ Pauta importada: ${p.vetos.length} veto(s) + ${p.plns.length} PLN/MPV.`, 'sucesso');
  } catch (e) { setImportStatus('Erro: ' + e.message, '#f05454'); }
}

// ---------- Análise de PLN/MPV por IA (lê o Parecer de Plenário) ----------
async function resumirPLN(pln, { silencioso = false } = {}) {
  if (!app.config?.apiKey) { if (!silencioso) mostrarToast('Configure a chave de API em ⚙ Configurações.', 'aviso'); return false; }
  if (!pln.parecerUrl) { if (!silencioso) mostrarToast('Parecer de Plenário não localizado para este item.', 'aviso'); return false; }
  pln.resumindoAnalise = true; iaInc(); if (!app.editando) renderLista();
  try {
    const buf = await baixarArrayBuffer(pln.parecerUrl);
    const texto = await chamarIApdf({ ...app.config, prompt: promptPLN(pln), pdfBuffers: [buf] });
    const limpo = (texto || '').trim(); if (!limpo) throw new Error('a IA não retornou a análise');
    pln.analise = limpo;
    pln.analiseMeta = { provedor: app.config.provedor, modelo: app.config.modelo, atualizadoEm: new Date().toISOString() };
    if (app.sessaoAtiva) {
      atualizarStatusSync('sincronizando');
      try { await fbSalvarPlnPauta(app.sessaoAtiva.id, pln); atualizarStatusSync('ok'); }
      catch (_) { atualizarStatusSync('offline'); }
    }
    if (!silencioso) mostrarToast(`✓ ${pln.sigla} ${pln.numero} analisado`, 'sucesso');
    return true;
  } catch (e) {
    if (isAbort(e)) return false;
    if (!silencioso) mostrarToast('Erro ao analisar: ' + e.message, 'erro');
    return false;
  } finally { pln.resumindoAnalise = false; iaDec(); if (!app.editando) renderLista(); }
}

function promptPLN(pln) {
  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos no Congresso Nacional.

Analise o documento anexo (Parecer de Plenário) referente ao ${pln.sigla} nº ${pln.numero}${pln.titulo ? ' (' + pln.titulo + ')' : ''}.
Ementa: ${pln.ementa || '(não disponível)'}
${blocoPerfilPadrao()}
Escreva um RESUMO TÉCNICO CURTO (1 a 2 parágrafos corridos, sem listas) explicando, com base no parecer: o que o crédito/alteração faz, os órgãos/programas e valores envolvidos, a fonte de recursos, e o principal ponto de atenção. Não recomende voto, não opine e não invente nada além do documento.
Responda apenas com o texto do resumo, sem rótulos.`;
}

async function chamarIApdf({ provedor, apiKey, modelo, prompt, pdfBuffers }) {
  const b64 = (pdfBuffers || []).map(arrayBufferToBase64);
  if (provedor === 'gemini') {
    const m = modelo || 'gemini-2.5-flash';
    const parts = b64.map(d => ({ inline_data: { mime_type: 'application/pdf', data: d } })); parts.push({ text: prompt });
    const j = await fetchIA(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 4000 } }) });
    return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }
  if (provedor === 'openai') {
    const m = modelo || 'gpt-4o';
    const content = b64.map((d, i) => ({ type: 'input_file', filename: `doc_${i + 1}.pdf`, file_data: `data:application/pdf;base64,${d}` })); content.push({ type: 'input_text', text: prompt });
    const j = await fetchIA('https://api.openai.com/v1/responses',
      { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, input: [{ role: 'user', content }], temperature: 0.2, max_output_tokens: 4000 }) });
    if (j.output_text) return j.output_text.trim();
    for (const it of (j.output || [])) for (const c of (it.content || [])) if (c.type === 'output_text' && c.text) return c.text.trim();
    return '';
  }
  if (provedor === 'anthropic') {
    const m = modelo || 'claude-sonnet-4-6';
    const content = b64.map(d => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d } })); content.push({ type: 'text', text: prompt });
    const j = await fetchIA('https://api.anthropic.com/v1/messages',
      { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VER, 'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, max_tokens: 4000, messages: [{ role: 'user', content }] }) });
    for (const it of (j.content || [])) if (it.type === 'text' && it.text) return it.text.trim();
    return '';
  }
  throw new Error('Provedor desconhecido: ' + provedor);
}

function arrayBufferToBase64(buf) {
  let bin = ''; const bytes = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ---------- Render dos cards de PLN/MPV ----------
function plnCasaBusca(p, termo) {
  if (!termo) return true;
  const t = termo.trim();
  const mFull = t.match(/^(\d+)\s*\/\s*(\d{4})$/);
  if (mFull) return p.num === +mFull[1] && p.ano === +mFull[2];
  const mNum = t.match(/^(\d{1,3})$/);
  if (mNum) return p.num === +mNum[1];
  return normalizar([p.sigla, p.numero, p.titulo, p.ementa, p.autor, p.analise].join(' ')).includes(normalizar(t));
}
function renderPlnsSecao(termo) {
  const plns = (app.sessaoAtiva?.plns || []).filter(p => plnCasaBusca(p, termo));
  if (!plns.length) return '';
  return `<div class="cn-pln-secao"><div class="cn-pln-secao-tit">Projetos de Lei (PLNs) e MPVs de crédito</div>${plns.map(p => renderPlnCard(p, termo)).join('')}</div>`;
}
function renderPlnCard(p, termo) {
  const temAnalise = !!p.analise;
  const botao = p.resumindoAnalise
    ? `<button class="btn btn-outline btn-sm" disabled><span class="cn-spinner"></span> Analisando…</button>`
    : `<button class="btn btn-outline btn-sm" data-pln-analisar="${p.key}">${temAnalise ? '↻ Regerar análise' : '✨ Analisar com IA'}</button>`;
  const placeholder = p.parecerUrl ? 'Sem análise ainda — gere com IA ou escreva aqui.' : 'Parecer de Plenário não localizado — escreva a análise manualmente.';
  const analiseBloco = p.resumindoAnalise
    ? `<div class="cn-disp-resumo vazio"><span class="cn-spinner"></span> Lendo o Parecer de Plenário…</div>`
    : `<div class="cn-disp-resumo${temAnalise ? '' : ' vazio'}" data-resumo="${p.key}|__plnanalise__"><span class="cn-disp-resumo-txt">${temAnalise ? marca(p.analise, termo) : placeholder}</span><button class="cn-disp-edit-btn" data-editar="${p.key}|__plnanalise__" title="Editar análise">✎</button></div>`;
  const meta = p.analiseMeta ? `<span style="font-size:11px;color:var(--text-dim)">Análise: ${p.analiseMeta.provedor}${p.analiseMeta.modelo ? ' / ' + p.analiseMeta.modelo : ''}</span>` : '';
  return `<div class="cn-veto cn-veto--ambar" data-key="${p.key}">
    <div class="cn-veto-head" style="cursor:default">
      <div class="cn-veto-num">${p.sigla} ${marca(p.numero, termo)}<small>${p.tipo === 'mpv' ? 'MPV de crédito' : 'PLN'}</small></div>
      <div class="cn-veto-meta">
        <div class="cn-veto-assunto">${marca(p.titulo || '', termo)}</div>
        <div class="cn-veto-materia">${marca(p.autor || '', termo)}</div>
      </div>
    </div>
    <div class="cn-veto-body">
      ${p.ementa ? `<div class="cn-veto-ementa"><strong>Ementa:</strong> ${marca(p.ementa, termo)}</div>` : ''}
      <div class="cn-veto-acoes">
        ${botao}
        ${p.materiaUrl ? `<a class="btn btn-ghost btn-sm" href="${p.materiaUrl}" target="_blank" rel="noopener">Abrir matéria ↗</a>` : ''}
        ${p.parecerUrl ? `<a class="btn btn-ghost btn-sm" href="${p.parecerUrl}" target="_blank" rel="noopener">Parecer (PDF) ↗</a>` : ''}
        ${meta}
      </div>
      ${analiseBloco}
    </div>
  </div>`;
}
function wirePlnCards() {
  document.querySelectorAll('[data-pln-analisar]').forEach(b =>
    b.addEventListener('click', () => {
      const p = (app.sessaoAtiva?.plns || []).find(x => x.key === b.dataset.plnAnalisar);
      if (p) resumirPLN(p);
    }));
}

// ============================================================
//  EXPORTAÇÃO PARA WORD (.docx)
// ============================================================
async function carregarLogoBytes() {
  try {
    const r = await fetch(chrome.runtime.getURL('icons/podemos-logo.png'));
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch (_) { return null; }
}

// Conjunto de itens a exportar (compartilhado por Word e PDF, garantindo
// paridade): vetos marcados (ou os visíveis pelo filtro) + PLNs/MPVs da pauta.
function _selecaoExport() {
  const termo = app.busca;
  const temSelecao = app.selecionados.size > 0;
  const vetos = temSelecao
    ? app.vetos.filter(v => app.selecionados.has(v.key))
    : app.vetos.filter(v => vetoCasaBusca(v, termo));
  const plns = (!temSelecao && app.sessaoAtiva) ? (app.sessaoAtiva.plns || []).filter(p => plnCasaBusca(p, termo)) : [];
  return { vetos, plns };
}

// Garante que os vetos a exportar tenham os detalhes carregados (dispositivos +
// resumos/razões compartilhados do Firebase) — o mesmo que abrir cada veto faz.
async function _garantirDetalhes(vetos) {
  const pend = (vetos || []).filter(v => v.detalheUrl && !v.detalheCarregado);
  if (!pend.length) return;
  mostrarToast(`Carregando detalhes de ${pend.length} veto(s)…`, '');
  let i = 0;
  const worker = async () => {
    while (i < pend.length) {
      const v = pend[i++];
      try { await carregarDetalhe(v); }
      catch (e) { if (isAbort(e)) return; console.warn('detalhe falhou', v.numero, e.message); }
    }
  };
  // Concorrência limitada (mais rápido que sequencial; sem martelar o servidor).
  await Promise.all(Array.from({ length: Math.min(5, pend.length) }, worker));
  if (!app.editando) renderLista();
  salvarCacheLocal();
}

// PDF via impressão da própria janela, com o mesmo conteúdo/formato do Word.
// Usa Paged.js para paginar e calcular os números de página do índice
// (target-counter). Se a lib falhar, imprime mesmo assim (índice sem nº).
async function exportarPdf() {
  const { vetos, plns } = _selecaoExport();
  if (!vetos.length && !plns.length) { mostrarToast('Nenhum item para exportar.', 'aviso'); return; }
  // Abre a janela já no gesto do clique (evita bloqueio de pop-up); carrega os
  // detalhes em seguida e só então escreve o conteúdo definitivo.
  const win = window.open('', '_blank', 'width=900,height=720');
  if (!win) { mostrarToast('Permita pop-ups para gerar o PDF.', 'aviso'); return; }
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando PDF…</title></head><body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Carregando os dados dos vetos e gerando o PDF…</body></html>');
  win.document.close();
  try { await _garantirDetalhes(vetos); } catch (_) {}
  if (win.closed) return;

  win.document.open();
  win.document.write(_htmlImpressaoPauta(vetos, plns));
  win.document.close();

  let impresso = false;
  const imprimir = () => { if (impresso || win.closed) return; impresso = true; try { win.focus(); win.print(); } catch (_) {} };
  win.PagedConfig = { auto: true, after: imprimir };   // Paged.js chama 'after' ao terminar de paginar
  const s = win.document.createElement('script');
  s.src = chrome.runtime.getURL('libs/paged.polyfill.js');
  s.onerror = imprimir;                 // fallback: imprime sem numeração se a lib não carregar
  win.document.head.appendChild(s);
  setTimeout(imprimir, 30000);          // rede de segurança (não corta a paginação de docs grandes)
  mostrarToast('Gerando PDF… escolha “Salvar como PDF” na janela.', '');
}

function _htmlImpressaoPauta(vetos, plns) {
  const esc = escapeHtml;
  const bm = chave => 'i_' + String(chave).replace(/[^\w]/g, '_');
  const logo = chrome.runtime.getURL('icons/podemos-logo.png');
  const meta = `${app.sessaoAtiva ? 'Sessão: ' + esc(app.sessaoAtiva.nome) + ' · ' : ''}${new Date().toLocaleDateString('pt-BR')} · ${vetos.length} veto(s)${plns.length ? ' · ' + plns.length + ' PLN/MPV' : ''}`;

  const ixItem = (anchor, rotulo, cls) => `<li><a class="${cls}" href="#${anchor}"><span class="t">${rotulo}</span><span class="ld"></span></a></li>`;
  const clsVeto = v => v.cor === 'verde' ? 'ix-verde' : (v.cor === 'azul' ? 'ix-azul' : 'ix-veto');
  const temCor = vetos.some(v => v.cor === 'verde' || v.cor === 'azul');
  const indice = (vetos.length || plns.length) ? `
    <section class="indice">
      <h2>Índice</h2>
      ${temCor ? '<p class="ix-leg"><span class="dot az">●</span> Iniciado no Senado &nbsp;&nbsp; <span class="dot vd">●</span> Iniciado na Câmara</p>' : ''}
      <ul>
        ${vetos.map(v => ixItem(bm(v.key), `VET ${esc(v.numero)} — ${esc(v.tipo)}${v.assunto ? '  ·  ' + esc(v.assunto) : ''}`, clsVeto(v))).join('')}
        ${plns.map(p => ixItem(bm(p.key), `${esc(p.sigla)} ${esc(p.numero)}${p.titulo ? '  ·  ' + esc(p.titulo) : ''}`, 'ix-pln')).join('')}
      </ul>
    </section>` : '';

  const vetosHtml = vetos.map(v => {
    const razIdx = razoesIndex(v);
    const corpo = (v.dispositivos || []).map(d => {
      let h = `<p class="disp"><span class="cod">${esc(d.codigo)} — </span><strong>Resumo:</strong> ${esc(d.resumo || '—')}</p>`;
      const rz = razIdx.get(d.codigo);
      if (rz) {   // razões do veto logo abaixo de cada dispositivo
        h += `<p class="raz raz-ind"><strong>Razões do veto:</strong> ${esc(rz.resumo)}</p>`;
      }
      return h;
    }).join('');
    const resumoProj = v.resumoProjeto ? `<p><strong>Resumo do Projeto:</strong> ${esc(v.resumoProjeto)}</p>` : '';
    const razTotal = (v.tipo === 'Total' && v.razoesProjeto) ? `<p class="raz"><strong>Razões do veto:</strong> ${esc(v.razoesProjeto)}</p>` : '';
    const vazio = (!(v.dispositivos || []).length && !(v.tipo === 'Total' && v.razoesProjeto))
      ? `<p class="vazio">(sem resumos — gere a análise antes de exportar)</p>` : '';
    return `<div class="bloco" id="${bm(v.key)}">
      <h3 class="item-h">VET ${esc(v.numero)} — ${esc(v.tipo)}${v.assunto ? '<span class="ass">  ·  ' + esc(v.assunto) + '</span>' : ''}</h3>
      ${resumoProj}${razTotal}${corpo}${vazio}
    </div>`;
  }).join('');

  const plnsHtml = plns.length ? `
    <h2 class="sec">Projetos de Lei (PLNs) e MPVs de crédito</h2>
    ${plns.map(p => `
      <div class="bloco" id="${bm(p.key)}">
        <h3 class="item-h">${esc(p.sigla)} ${esc(p.numero)}${p.titulo ? '<span class="ass">  ·  ' + esc(p.titulo) + '</span>' : ''}</h3>
        ${p.autor ? `<p><strong>Autor:</strong> ${esc(p.autor)}</p>` : ''}
        ${p.ementa ? `<p><strong>Ementa:</strong> ${esc(p.ementa)}</p>` : ''}
        <p class="raz"><strong>Análise:</strong> ${p.analise ? esc(p.analise) : '<span class="vazio">(sem análise — gere ou escreva antes de exportar)</span>'}</p>
      </div>`).join('')}` : '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Pauta do Congresso Nacional</title>
  <style>
    @page { size:A4; margin:16mm; }
    * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { font-family:'Segoe UI',Arial,sans-serif; color:#1a1a1a; }
    .cab { display:flex; align-items:center; gap:16px; }
    .cab .tit { flex:1; text-align:center; }
    .cab .tit h1 { font-size:16pt; font-weight:700; color:#003c1f; }
    .cab .tit p  { font-size:10pt; color:#003c1f; }
    .cab img { height:42px; }
    .cab .sp { width:42px; }
    .rule { border-bottom:2px solid #00A859; margin:6px 0 8px; }
    .meta { text-align:center; font-style:italic; font-size:9pt; color:#6b7280; margin-bottom:14px; }
    .indice { break-after:page; page-break-after:always; }
    .indice h2 { font-size:13pt; color:#003c1f; margin-bottom:8px; }
    .indice ul { list-style:none; }
    .indice li { font-size:10.5pt; margin-bottom:3px; }
    .indice a { display:flex; align-items:baseline; text-decoration:none; color:#178080; }
    .indice a.ix-pln { color:#b45309; }
    .indice a.ix-verde { color:#108a3c; }
    .indice a.ix-azul  { color:#155fbf; }
    .ix-leg { font-size:9pt; color:#6b7280; font-style:italic; margin-bottom:8px; }
    .ix-leg .dot { font-style:normal; }
    .ix-leg .dot.az { color:#155fbf; }
    .ix-leg .dot.vd { color:#108a3c; }
    .indice a .ld { flex:1 1 auto; border-bottom:1px dotted #b9c2cc; margin:0 5px; position:relative; top:-3px; }
    .indice a::after { content: target-counter(attr(href url), page); color:#444; white-space:nowrap; }
    .item-h { font-size:13pt; font-weight:700; border-bottom:1px solid #ccc; padding-bottom:3px; margin-top:18px; page-break-after:avoid; break-after:avoid; }
    .item-h .ass { font-weight:400; font-size:11pt; }
    .sec { font-size:13pt; color:#003c1f; border-bottom:2px solid #00A859; padding-bottom:3px; margin:26px 0 6px; page-break-after:avoid; break-after:avoid; }
    p { font-size:10.5pt; line-height:1.6; margin:8px 0; page-break-inside:avoid; break-inside:avoid; }
    .disp .cod { font-weight:700; color:#178080; }
    .raz strong { color:#b45309; }
    .raz-ind { padding-left:16px; }
    .vazio { color:#999; font-style:italic; }
    .ft { margin-top:24px; padding-top:8px; border-top:1px solid #e5e7eb; font-size:8.5pt; color:#9ca3af; text-align:center; }
  </style></head><body>
    <div class="cab">
      <div class="sp"></div>
      <div class="tit"><h1>Pauta do Congresso Nacional</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>
      <img src="${logo}" alt="">
    </div>
    <div class="rule"></div>
    <div class="meta">${meta}</div>
    ${indice}
    ${vetosHtml}
    ${plnsHtml}
    <div class="ft">Documento gerado pelo SisPode · Liderança do Podemos · Câmara dos Deputados</div>
  </body></html>`;
}

async function exportarDocx() {
  const { vetos, plns } = _selecaoExport();
  if (!vetos.length && !plns.length) { mostrarToast('Nenhum item para exportar.', 'aviso'); return; }
  if (typeof docx === 'undefined') { mostrarToast('Biblioteca de exportação não carregada.', 'erro'); return; }
  await _garantirDetalhes(vetos);

  mostrarToast('Gerando documento Word…', '');
  const {
    Document, Paragraph, TextRun, Packer, BorderStyle,
    Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, VerticalAlign,
    Bookmark, PageReference, InternalHyperlink, TabStopType, TabStopPosition, LeaderType, PageBreak,
  } = docx;
  const L15 = { line: 360, lineRule: 'auto' };  // entrelinhas 1,5 (240 = simples)
  const GAP_DISP = 480;                          // espaçamento 2,0 (duplo) entre dispositivos
  const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const SEM_BORDA = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };
  const bmId = chave => 'i_' + String(chave).replace(/[^\w]/g, '_');   // id de bookmark p/ o índice
  const logoBytes = await carregarLogoBytes();

  const filhos = [];

  // Cabeçalho institucional: [vazio | título centralizado | logo à direita]
  filhos.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SEM_BORDA,
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, borders: SEM_BORDA, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({})] }),
      new TableCell({ width: { size: 64, type: WidthType.PERCENTAGE }, borders: SEM_BORDA, verticalAlign: VerticalAlign.CENTER, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...L15 }, children: [new TextRun({ text: 'Pauta do Congresso Nacional', bold: true, size: 28, color: '003c1f' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...L15 }, children: [new TextRun({ text: 'Liderança do Podemos na Câmara dos Deputados', size: 20, color: '003c1f' })] }),
      ] }),
      new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, borders: SEM_BORDA, verticalAlign: VerticalAlign.CENTER, children: [
        logoBytes
          ? new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ data: logoBytes, type: 'png', transformation: { width: 104, height: 47 } })] })
          : new Paragraph({}),
      ] }),
    ] })],
  }));
  // Régua verde institucional + linha de metadados.
  filhos.push(new Paragraph({ spacing: { before: 40, after: 120 }, border: { bottom: { color: '00A859', space: 1, style: BorderStyle.SINGLE, size: 12 } }, children: [] }));
  filhos.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 220, ...L15 },
    children: [new TextRun({ text: `${app.sessaoAtiva ? 'Sessão: ' + app.sessaoAtiva.nome + ' · ' : ''}${new Date().toLocaleDateString('pt-BR')} · ${vetos.length} veto(s)${plns.length ? ' · ' + plns.length + ' PLN/MPV' : ''}`, italics: true, size: 16, color: '6b7280' })],
  }));

  // Índice (sumário) com a página de cada item — os números são preenchidos
  // pelo Word ao abrir (features.updateFields). Cada entrada é um link interno
  // que salta para o bookmark correspondente.
  if (vetos.length || plns.length) {
    filhos.push(new Paragraph({ spacing: { before: 60, after: 40, ...L15 }, children: [new TextRun({ text: 'Índice', bold: true, size: 22, color: '003c1f' })] }));
    // Legenda das cores (casa iniciadora), quando há vetos classificados.
    if (vetos.some(v => v.cor === 'verde' || v.cor === 'azul')) {
      filhos.push(new Paragraph({ spacing: { after: 80, ...L15 }, children: [
        new TextRun({ text: '● ', bold: true, size: 16, color: '155fbf' }), new TextRun({ text: 'Iniciado no Senado     ', italics: true, size: 14, color: '6b7280' }),
        new TextRun({ text: '● ', bold: true, size: 16, color: '108a3c' }), new TextRun({ text: 'Iniciado na Câmara', italics: true, size: 14, color: '6b7280' }),
      ] }));
    }
    const corVeto = v => v.cor === 'verde' ? '108a3c' : (v.cor === 'azul' ? '155fbf' : '178080');
    const tabIndice = [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: LeaderType.DOT }];
    const entradaIndice = (anchor, rotulo, cor) => new Paragraph({
      tabStops: tabIndice, spacing: { after: 40, ...L15 },
      children: [
        new InternalHyperlink({ anchor, children: [new TextRun({ text: rotulo, size: 18, color: cor })] }),
        new TextRun({ text: '\t', size: 18 }),
        new PageReference(anchor),
      ],
    });
    vetos.forEach(v => filhos.push(entradaIndice(bmId(v.key), `VET ${v.numero} — ${v.tipo}${v.assunto ? '  ·  ' + v.assunto : ''}`, corVeto(v))));
    plns.forEach(p => filhos.push(entradaIndice(bmId(p.key), `${p.sigla} ${p.numero}${p.titulo ? '  ·  ' + p.titulo : ''}`, 'b45309')));
    filhos.push(new Paragraph({ children: [new PageBreak()] }));
  }

  vetos.forEach(v => {
    // Cabeçalho mínimo para identificar o veto.
    filhos.push(new Paragraph({
      spacing: { before: 360, after: 30, ...L15 },
      border: { bottom: { color: 'cccccc', space: 1, style: BorderStyle.SINGLE, size: 6 } },
      children: [
        new Bookmark({ id: bmId(v.key), children: [
          new TextRun({ text: `VET ${v.numero} — ${v.tipo}`, bold: true, size: 24 }),
          new TextRun({ text: v.assunto ? `  ·  ${v.assunto}` : '', size: 20 }),
        ] }),
      ],
    }));

    // Resumo do projeto (logo abaixo do cabeçalho do veto).
    if (v.resumoProjeto) {
      filhos.push(new Paragraph({ spacing: { before: 40, after: 40, ...L15 }, children: [new TextRun({ text: 'Resumo do Projeto: ', bold: true, size: 18 }), new TextRun({ text: v.resumoProjeto, size: 18 })] }));
    }

    // Veto total: as razões valem para o projeto inteiro.
    if (v.tipo === 'Total' && v.razoesProjeto) {
      filhos.push(new Paragraph({ spacing: { before: 60, ...L15 }, indent: { left: 567 }, children: [new TextRun({ text: 'Razões do veto: ', bold: true, size: 18, color: 'b45309' }), new TextRun({ text: v.razoesProjeto, size: 18 })] }));
    }

    const razIdx = razoesIndex(v);
    (v.dispositivos || []).forEach(d => {
      filhos.push(new Paragraph({
        spacing: { before: GAP_DISP, ...L15 },
        children: [
          new TextRun({ text: `${d.codigo} — `, bold: true, size: 20, color: '178080' }),
          new TextRun({ text: 'Resumo: ', bold: true, size: 18 }),
          new TextRun({ text: d.resumo || '—', size: 18 }),
        ],
      }));
      // Razões do veto logo abaixo de cada dispositivo (indentada).
      const rz = razIdx.get(d.codigo);
      if (rz) {
        filhos.push(new Paragraph({ spacing: { before: 60, ...L15 }, indent: { left: 567 }, children: [
          new TextRun({ text: 'Razões do veto: ', bold: true, size: 18, color: 'b45309' }),
          new TextRun({ text: rz.resumo, size: 18 }),
        ] }));
      }
    });
    if (!(v.dispositivos || []).length && !(v.tipo === 'Total' && v.razoesProjeto)) {
      filhos.push(new Paragraph({ spacing: { ...L15 }, children: [new TextRun({ text: '(sem resumos — gere a análise antes de exportar)', size: 16, italics: true, color: '999999' })] }));
    }
  });

  // Seção de PLNs / MPVs de crédito (quando uma pauta está ativa).
  if (plns.length) {
    filhos.push(new Paragraph({
      spacing: { before: 480, after: 80, ...L15 },
      border: { bottom: { color: '00A859', space: 1, style: BorderStyle.SINGLE, size: 8 } },
      children: [new TextRun({ text: 'Projetos de Lei (PLNs) e MPVs de crédito', bold: true, size: 22, color: '003c1f' })],
    }));
    plns.forEach(p => {
      filhos.push(new Paragraph({
        spacing: { before: 300, after: 30, ...L15 },
        border: { bottom: { color: 'cccccc', space: 1, style: BorderStyle.SINGLE, size: 6 } },
        children: [
          new Bookmark({ id: bmId(p.key), children: [
            new TextRun({ text: `${p.sigla} ${p.numero}`, bold: true, size: 24 }),
            new TextRun({ text: p.titulo ? `  ·  ${p.titulo}` : '', size: 20 }),
          ] }),
        ],
      }));
      if (p.autor)  filhos.push(new Paragraph({ spacing: { ...L15 }, children: [new TextRun({ text: 'Autor: ', bold: true, size: 18 }), new TextRun({ text: p.autor, size: 18 })] }));
      if (p.ementa) filhos.push(new Paragraph({ spacing: { before: 20, ...L15 }, children: [new TextRun({ text: 'Ementa: ', bold: true, size: 18 }), new TextRun({ text: p.ementa, size: 18 })] }));
      filhos.push(new Paragraph({
        spacing: { before: 60, ...L15 },
        children: [
          new TextRun({ text: 'Análise: ', bold: true, size: 18, color: 'b45309' }),
          new TextRun({ text: p.analise || '(sem análise — gere ou escreva antes de exportar)', size: 18, italics: !p.analise, color: p.analise ? undefined : '999999' }),
        ],
      }));
    });
  }

  try {
    const blob = await Packer.toBlob(new Document({ features: { updateFields: true }, sections: [{ properties: {}, children: filhos }] }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const prefixo = app.sessaoAtiva ? 'Pauta_Congresso' : 'Vetos_Congresso';
    const sufixo = app.sessaoAtiva ? '_' + app.sessaoAtiva.nome.replace(/[^\w]+/g, '_').slice(0, 40) : '';
    a.download = `${prefixo}${sufixo}_${new Date().toISOString().slice(0, 10)}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToast(`✓ Word gerado (${vetos.length} veto(s)${plns.length ? ' + ' + plns.length + ' PLN/MPV' : ''}).`, 'sucesso');
  } catch (e) { console.error('[congresso] exportarDocx', e); mostrarToast('Erro ao gerar Word: ' + e.message, 'erro'); }
}

// ============================================================
//  UTILITÁRIOS
// ============================================================
function sleep(ms) {
  return new Promise((resolve, reject) => {
    if (_abort.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    _abort.signal.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escapa o texto e destaca (<mark>) as ocorrências do termo de busca,
 *  de forma insensível a acentos/caixa. Mapeia os índices da versão
 *  normalizada de volta para o texto escapado original. */
function marca(texto, termo) {
  const esc = escapeHtml(texto);
  const tN = normalizar(termo);
  if (!tN) return esc;
  // String normalizada + mapa normIdx → idx no texto escapado.
  let norm = ''; const map = [];
  for (let i = 0; i < esc.length; i++) {
    const n = normalizar(esc[i]);
    for (let k = 0; k < n.length; k++) { norm += n[k]; map.push(i); }
  }
  map.push(esc.length);
  let out = '', last = 0, from = 0, pos;
  while ((pos = norm.indexOf(tN, from)) >= 0) {
    const ini = map[pos];
    const fim = map[Math.min(pos + tN.length, map.length - 1)];
    out += esc.slice(last, ini) + '<mark>' + esc.slice(ini, fim) + '</mark>';
    last = fim; from = pos + tN.length;
  }
  return out + esc.slice(last);
}

function mostrarToast(msg, tipo = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${tipo}`;
  toast.style.display = 'block';
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 4500);
}
