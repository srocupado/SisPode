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
    placeholderChave: 'AIzaSy...',
    hintChave: 'Obtenha em aistudio.google.com → Get API key',
    regexChave: /^AIza[\w-]{20,}$/,
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
      { id: 'claude-opus-4-7',           displayName: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    ],
    async listar(_key) { return this.modelosFallback; },
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
  document.getElementById('btn-salvar-sessao').addEventListener('click', salvarSessaoAtual);
  document.getElementById('btn-sessao-vivo').addEventListener('click', voltarAoVivo);
  document.getElementById('btn-exportar-docx').addEventListener('click', exportarDocx);

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
    const { ementa, dispositivos } = parseDetalheHtml(html);
    // Preserva resumos já existentes ao recarregar os textos.
    const resumosPrev = new Map(veto.dispositivos.map(d => [d.codigo, d.resumo]));
    veto.dispositivos = dispositivos.map(d => ({ ...d, resumo: resumosPrev.get(d.codigo) || '' }));
    veto.ementa = ementa || veto.ementa;
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

  // Ementa (melhor esforço): item de definição "Ementa" na ficha.
  let ementa = '';
  doc.querySelectorAll('dt').forEach(dt => {
    if (!ementa && /ementa/i.test(dt.textContent)) {
      const dd = dt.nextElementSibling;
      if (dd) ementa = dd.textContent.replace(/\s+/g, ' ').trim();
    }
  });

  return { ementa, dispositivos };
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
  if (!veto.dispositivos.length) {
    if (!silencioso) mostrarToast('Este veto não tem dispositivos para resumir.', 'aviso');
    return false;
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

  // "Busca em tudo": na primeira busca, garante o download de todos os detalhes.
  if (app.busca && !app.baixandoTodos && app.vetos.some(v => !v.detalheCarregado && v.detalheUrl)) {
    mostrarToast('Baixando os detalhes para a busca completa…', '');
    baixarTodosDetalhes();
  }
  renderLista();
}

function vetoCasaBusca(v, termo) {
  if (!termo) return true;
  const campos = [v.numero, v.tipo, v.materia, v.assunto, v.ementa, v.sobresta,
    ...v.dispositivos.flatMap(d => [d.codigo, d.descricao, d.texto, d.resumo])];
  return normalizar(campos.join(' ')).includes(normalizar(termo));
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
  const totDisp = app.vetos.reduce((s, v) => s + (v.qtdNum || 0), 0);
  const comResumo = app.vetos.filter(v => v.dispositivos.some(d => d.resumo)).length;
  stats.innerHTML = termo
    ? `<strong>${filtrados.length}</strong> veto(s) encontrados para “${escapeHtml(termo)}” · de ${app.vetos.length} no total`
    : `<strong>${app.vetos.length}</strong> vetos em tramitação · ${totDisp} dispositivos · ${comResumo} com resumo de IA`;

  if (!app.vetos.length) {
    lista.innerHTML = '<div class="cn-empty" id="cn-empty"><span class="cn-spinner"></span> Carregando vetos…</div>';
    return;
  }
  if (!filtrados.length) {
    lista.innerHTML = '<div class="cn-empty">Nenhum veto corresponde à busca.</div>';
    return;
  }

  // Auto-expande, durante a busca, os vetos cujo texto interno casou.
  if (termo) filtrados.forEach(v => {
    if (v.detalheCarregado && v.dispositivos.some(d =>
      normalizar([d.codigo, d.descricao, d.texto, d.resumo].join(' ')).includes(normalizar(termo)))) v.aberto = true;
  });

  lista.innerHTML = filtrados.map(v => renderVeto(v, termo)).join('');
  wireCards();
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

function renderCorpo(v, termo) {
  let inner;
  if (v.carregandoDetalhe || (!v.detalheCarregado && !v.dispositivos.length)) {
    inner = '<div class="cn-disp-resumo vazio"><span class="cn-spinner"></span> Carregando dispositivos vetados…</div>';
  } else if (!v.dispositivos.length) {
    inner = '<div class="cn-disp-resumo vazio">Nenhum dispositivo vetado encontrado na página oficial.</div>';
  } else {
    inner = v.dispositivos.map(d => {
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
      // Resumo automático ao abrir, se a IA estiver configurada e ainda não houver
      // resumo. Vetos grandes (>25 dispositivos) exigem clique explícito em
      // "Resumir com IA" para evitar dezenas de chamadas silenciosas.
      if (app.config?.apiKey && v.dispositivos.length && v.dispositivos.length <= 25
          && !v.dispositivos.some(d => d.resumo)) {
        resumirVeto(v, { silencioso: true });
      }
    } catch (e) {
      if (!isAbort(e)) { mostrarToast('Erro ao abrir o veto: ' + e.message, 'erro'); renderLista(); }
    }
  }
}

// ============================================================
//  EDIÇÃO INLINE DO RESUMO (com autosave no Firebase + cache)
// ============================================================
function entrarEdicao(key, codigo) {
  if (app.editando) fecharEdicao(true);
  const veto = app.vetos.find(v => v.key === key);
  const d = veto?.dispositivos.find(x => x.codigo === codigo);
  if (!d) return;
  const val = `${key}|${codigo}`;
  const div = document.querySelector(`[data-resumo="${val}"]`);
  if (!div) return;

  app.editando = { key, codigo, salvando: false, dirty: false, debounce: null, snapshot: d.resumo || '' };
  atualizarBotaoParar();
  div.classList.remove('vazio');
  div.classList.add('editando');
  div.innerHTML = `
    <textarea class="cn-disp-edit" data-edit="${val}">${escapeHtml(d.resumo || '')}</textarea>
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
  const veto = app.vetos.find(v => v.key === e.key);
  const d = veto?.dispositivos.find(x => x.codigo === e.codigo);
  if (!d || !veto) return;

  e.salvando = true; e.dirty = false;
  setEditStatus('salvando…', 'var(--text-dim)');
  d.resumo = ta.value.trim();
  veto.resumoMeta = {
    provedor: veto.resumoMeta?.provedor || app.config?.provedor || 'manual',
    modelo: veto.resumoMeta?.modelo,
    atualizadoEm: new Date().toISOString(), editadoPor: 'equipe',
  };
  const ok = await persistirResumo(veto);
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
  const veto = app.vetos.find(v => v.key === e.key);
  const d = veto?.dispositivos.find(x => x.codigo === e.codigo);
  app.editando = null;            // libera antes de re-renderizar
  if (veto && d) {
    if (salvar && ta) {
      const valor = ta.value.trim();
      if (valor !== e.snapshot) {
        d.resumo = valor;
        veto.resumoMeta = {
          provedor: veto.resumoMeta?.provedor || app.config?.provedor || 'manual',
          modelo: veto.resumoMeta?.modelo,
          atualizadoEm: new Date().toISOString(), editadoPor: 'equipe',
        };
        persistirResumo(veto);
      }
    } else if (!salvar && d.resumo !== e.snapshot) {
      d.resumo = e.snapshot;       // reverte (e re-grava caso o autosave já tenha persistido)
      persistirResumo(veto);
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
  if (!Object.keys(resumos).length) return;
  const body = {
    numero: veto.numero, ano: veto.ano, materia: veto.materia, assunto: veto.assunto,
    resumos, ...veto.resumoMeta,
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
    if (!reg?.resumos) continue;
    v.resumoMeta = { provedor: reg.provedor, modelo: reg.modelo, atualizadoEm: reg.atualizadoEm };
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
//  SESSÕES SALVAS (snapshots da lista — compartilhados via Firebase)
// ============================================================
function leanVeto(v) {
  const { aberto, resumindo, carregandoDetalhe, _resumosPendentes, ...rest } = v;
  return rest;
}
async function fbCarregarSessoes() {
  const res = await fetch(`${FIREBASE_URL}/vetos_sessoes.json`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data) return [];
  return Object.entries(data).map(([id, s]) => ({
    id, nome: s.nome, criadoEm: s.criadoEm, criadoPor: s.criadoPor, atualizadoEm: s.atualizadoEm,
    total: s.vetos ? Object.keys(s.vetos).length : 0,
  })).sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}
async function fbCriarSessao(nome) {
  const id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const vetosMap = {};
  app.vetos.forEach(v => { vetosMap[v.key] = leanVeto(v); });
  const corpo = { nome, criadoPor: 'equipe', criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(), vetos: vetosMap };
  const res = await fetch(`${FIREBASE_URL}/vetos_sessoes/${id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  return { id, nome };
}
async function fbSalvarVetoSessao(id, veto) {
  const r1 = await fetch(`${FIREBASE_URL}/vetos_sessoes/${id}/vetos/${veto.key}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leanVeto(veto)),
  });
  if (!r1.ok) throw new Error(`Firebase HTTP ${r1.status}`);
  fetch(`${FIREBASE_URL}/vetos_sessoes/${id}/atualizadoEm.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(new Date().toISOString()),
  }).catch(() => {});
}
async function fbApagarSessao(id) {
  const res = await fetch(`${FIREBASE_URL}/vetos_sessoes/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
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
  const lista = document.getElementById('cn-sessoes-lista');
  if (!app.sessoes.length) {
    lista.innerHTML = '<div class="empty-state"><p>Nenhuma sessão salva</p></div>';
    return;
  }
  lista.innerHTML = app.sessoes.map(s => {
    const d = s.criadoEm ? new Date(s.criadoEm) : null;
    const data = (d ? `${d.toLocaleDateString('pt-BR')} · ` : '') + `${s.total} veto(s)`;
    const ativa = app.sessaoAtiva?.id === s.id ? ' ativa' : '';
    return `<div class="cn-sessao-item${ativa}" data-sessao="${s.id}">
      <div class="cn-sessao-item-info">
        <div class="cn-sessao-item-nome">${escapeHtml(s.nome || '(sem nome)')}</div>
        <div class="cn-sessao-item-data">${data}</div>
      </div>
      <button class="cn-sessao-item-del" data-sessao-del="${s.id}" title="Excluir sessão">✕</button>
    </div>`;
  }).join('');
  lista.querySelectorAll('[data-sessao]').forEach(el =>
    el.addEventListener('click', () => carregarSessao(el.dataset.sessao)));
  lista.querySelectorAll('[data-sessao-del]').forEach(b =>
    b.addEventListener('click', e => excluirSessao(b.dataset.sessaoDel, e)));
}

async function salvarSessaoAtual() {
  if (!app.vetos.length) { mostrarToast('Nada para salvar ainda.', 'aviso'); return; }
  const nome = prompt('Nome da sessão:', app.sessaoAtiva ? app.sessaoAtiva.nome : `Vetos em ${new Date().toLocaleDateString('pt-BR')}`);
  if (!nome || !nome.trim()) return;
  mostrarToast('Salvando sessão…', '');
  try {
    const s = await fbCriarSessao(nome.trim());
    await carregarSessoes();
    app.sessaoAtiva = s;
    renderSidebar();
    atualizarStatusSync('ok');
    mostrarToast('✓ Sessão salva e ativada.', 'sucesso');
  } catch (e) { mostrarToast('Erro ao salvar sessão: ' + e.message, 'erro'); }
}

async function carregarSessao(id) {
  if (app.editando) fecharEdicao(true);
  mostrarToast('Carregando sessão…', '');
  try {
    const res = await fetch(`${FIREBASE_URL}/vetos_sessoes/${id}.json`);
    const s = res.ok ? await res.json() : null;
    if (!s) throw new Error('Sessão não encontrada.');
    const arr = s.vetos ? Object.values(s.vetos) : [];
    arr.sort((a, b) => (b.ano - a.ano) || (b.num - a.num));
    app.vetos = arr.map(v => ({ ...v, aberto: false, resumindo: false, carregandoDetalhe: false }));
    app.sessaoAtiva = { id, nome: s.nome };
    renderSidebar();
    renderLista();
    mostrarToast(`Sessão "${s.nome}" carregada.`, 'sucesso');
  } catch (e) { mostrarToast('Erro ao carregar sessão: ' + e.message, 'erro'); }
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

async function excluirSessao(id, ev) {
  ev?.stopPropagation();
  const s = app.sessoes.find(x => x.id === id);
  if (!confirm(`Excluir a sessão "${s?.nome || id}"? Isso afeta toda a equipe.`)) return;
  try {
    await fbApagarSessao(id);
    if (app.sessaoAtiva?.id === id) await voltarAoVivo();
    await carregarSessoes();
    renderSidebar();
    mostrarToast('Sessão excluída.', '');
  } catch (e) { mostrarToast('Erro ao excluir: ' + e.message, 'erro'); }
}

// ============================================================
//  EXPORTAÇÃO PARA WORD (.docx)
// ============================================================
async function exportarDocx() {
  const termo = app.busca;
  const vetos = app.vetos.filter(v => vetoCasaBusca(v, termo));
  if (!vetos.length) { mostrarToast('Nenhum veto para exportar.', 'aviso'); return; }
  if (typeof docx === 'undefined') { mostrarToast('Biblioteca de exportação não carregada.', 'erro'); return; }
  const semDetalhe = vetos.filter(v => v.detalheUrl && !v.detalheCarregado).length;
  if (semDetalhe && !confirm(`${semDetalhe} veto(s) ainda não tiveram os detalhes baixados (sairão sem dispositivos). Exportar mesmo assim?\n\nDica: use "Baixar detalhes" antes para um documento completo.`)) return;

  mostrarToast('Gerando documento Word…', '');
  const { Document, Paragraph, TextRun, Packer, BorderStyle } = docx;
  const filhos = [];
  filhos.push(new Paragraph({ children: [new TextRun({ text: 'Vetos do Congresso Nacional', bold: true, size: 32 })], spacing: { after: 60 } }));
  filhos.push(new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: `Liderança do Podemos · ${app.sessaoAtiva ? 'Sessão: ' + app.sessaoAtiva.nome : 'Vetos em tramitação'} · ${new Date().toLocaleDateString('pt-BR')} · ${vetos.length} veto(s)`, italics: true, size: 18, color: '6b7280' })],
  }));

  vetos.forEach(v => {
    filhos.push(new Paragraph({
      spacing: { before: 220, after: 30 },
      border: { bottom: { color: 'cccccc', space: 1, style: BorderStyle.SINGLE, size: 6 } },
      children: [new TextRun({ text: `VET ${v.numero} — ${v.tipo}`, bold: true, size: 26 })],
    }));
    filhos.push(new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: v.assunto || '', bold: true, size: 22 })] }));
    const meta = `${v.materia || ''}${v.sobresta ? ' · Sobrestando a pauta: ' + v.sobresta : ''}${v.dataSobresta ? ' (' + v.dataSobresta + ')' : ''}${v.qtdNum != null ? ' · ' + v.qtdNum + ' dispositivo(s)' : (v.tipo === 'Total' ? ' · Veto Total' : '')}`;
    filhos.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: meta, size: 18, color: '6b7280' })] }));
    if (v.ementa) filhos.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Ementa: ', bold: true, size: 18 }), new TextRun({ text: v.ementa, size: 18, italics: true })] }));
    (v.dispositivos || []).forEach(d => {
      filhos.push(new Paragraph({ spacing: { before: 90 }, children: [new TextRun({ text: `${d.codigo} — `, bold: true, size: 20, color: '178080' }), new TextRun({ text: d.descricao || '', size: 18 })] }));
      if (d.resumo) filhos.push(new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: 'Resumo: ', bold: true, size: 18 }), new TextRun({ text: d.resumo, size: 18 })] }));
      if (d.texto) filhos.push(new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: 'Texto vetado: ', bold: true, size: 16, color: '6b7280' }), new TextRun({ text: d.texto, size: 16, italics: true, color: '6b7280' })] }));
    });
    if (!(v.dispositivos || []).length) filhos.push(new Paragraph({ children: [new TextRun({ text: '(dispositivos não baixados — use "Baixar detalhes")', size: 16, italics: true, color: '999999' })] }));
  });

  try {
    const blob = await Packer.toBlob(new Document({ sections: [{ properties: {}, children: filhos }] }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sufixo = app.sessaoAtiva ? '_' + app.sessaoAtiva.nome.replace(/[^\w]+/g, '_') : '';
    a.download = `Vetos_Congresso${sufixo}_${new Date().toISOString().slice(0, 10)}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToast(`✓ Word gerado (${vetos.length} veto(s)).`, 'sucesso');
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
