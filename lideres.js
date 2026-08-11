/* ============================================================
   REUNIÃO DE LÍDERES – PODEMOS

   Recebe o PDF com a lista de proposições que o Colégio de Líderes vai
   avaliar para eventual inclusão na pauta do Plenário e devolve a planilha
   de resumo: uma linha por proposição, com objetivo, justificativa,
   situação, comissões e relatoria de Plenário.

   Divisão de trabalho deliberada — o que é FATO vem da fonte, o que é
   REDAÇÃO vem da IA:
     · o PDF da reunião manda no que entra na lista (número, proposição,
       autoria, regime);
     · a situação e a relatoria de Plenário são DERIVADAS das tramitações
       dos Dados Abertos por regra fixa, não pela IA — são campos em que
       um erro de leitura vira informação errada na mão do líder;
     · só o objetivo, a justificativa e a redação das comissões passam
       pela IA, sempre com o inteiro teor da proposição anexado.
   ============================================================ */

'use strict';

// ---------- CONSTANTES ----------
const API_BASE       = 'https://dadosabertos.camara.leg.br/api/v2';
const CODETABS       = 'https://api.codetabs.com/v1/proxy?quest=';
const WORKER         = 'https://shrill-resonance-4d17.vinicius-const.workers.dev/?url=';
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
const OPENAI_BASE    = 'https://api.openai.com/v1/responses';
const ANTHROPIC_VER  = '2023-06-01';
const FIREBASE_URL   = 'https://plenario-podemos-default-rtdb.firebaseio.com';

// Folgado de propósito: nos modelos com raciocínio, os tokens de pensamento
// saem deste mesmo orçamento — MEDIDO, 665 só de pensamento num resumo curto.
// Com 2048 a resposta vinha cortada no meio do JSON.
const MAX_OUT_TOKENS = 4096;
// Acima disto o inteiro teor vai como texto extraído, não como PDF: o corpo da
// requisição em base64 cresce ~33% e estoura o limite dos provedores.
const MAX_PDF_BYTES  = 8 * 1024 * 1024;
const MAX_TEXTO_TEOR = 120000;

// ---------- ESTADO ----------
let app = {
  reuniao:      null,   // { id, titulo, criada, itens: [...] }
  processando:  false,
  toastTimer:   null,
  selecionados: new Set(),
  instrucoes:   '',     // instruções adicionais compartilhadas (Firebase)
  abortar:      null,   // AbortController do lote em andamento
  config: { provedor: 'gemini', apiKey: '', modelo: 'gemini-2.5-flash' },
  sistema:  'analise',  // aba ativa: analise | demandas | email
  demandas: [],         // sistema 2 — registro de demandas (Firebase)
  selEmail: new Set(),  // sistema 3 — ids das demandas marcadas p/ e-mail
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
  carregarInstrucoes().catch(e => console.warn('Instruções:', e.message));
  carregarDemandas();
});

function registrarEventos() {
  document.getElementById('btn-voltar-home').addEventListener('click', () => {
    chrome.tabs.update({ url: chrome.runtime.getURL('panel.html') });
  });

  document.getElementById('btn-nova-reuniao').addEventListener('click', abrirModalNovaReuniao);
  document.getElementById('btn-nova-reuniao-upload').addEventListener('click', abrirModalNovaReuniao);
  document.getElementById('btn-criar-reuniao').addEventListener('click', criarReuniao);

  document.getElementById('btn-configuracoes').addEventListener('click', abrirConfiguracoes);
  document.getElementById('btn-salvar-config').addEventListener('click', salvarConfiguracao);
  document.getElementById('btn-testar-ia').addEventListener('click', testarConexao);
  document.getElementById('btn-carregar-modelos').addEventListener('click', carregarModelosDisponiveis);
  document.getElementById('config-provedor').addEventListener('change', onProvedorChange);
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const i = document.getElementById('config-api-key');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-resumir-todos').addEventListener('click', () => resumirLote(null));
  document.getElementById('btn-resumir-selecionados').addEventListener('click', () => resumirLote([...app.selecionados]));
  document.getElementById('btn-parar').addEventListener('click', () => app.abortar?.abort());
  document.getElementById('btn-salvar').addEventListener('click', salvarReuniao);
  document.getElementById('btn-exportar').addEventListener('click', exportarPlanilha);
  document.getElementById('btn-gerar-pdf').addEventListener('click', gerarPDF);
  document.getElementById('btn-whatsapp').addEventListener('click', copiarMensagemPodemos);
  document.getElementById('check-todos').addEventListener('change', e => marcarTodas(e.target.checked));

  // Rolagem horizontal por botão: com barras em modo overlay, a tabela larga
  // fica sem saída visível. Rola 70% da largura visível, deixando uma faixa de
  // sobreposição para não perder a referência.
  const rolar = dir => {
    const w = document.querySelector('.lid-tabela-wrap');
    if (w) w.scrollBy({ left: dir * w.clientWidth * 0.7, behavior: 'smooth' });
  };
  document.getElementById('btn-rolar-esq').addEventListener('click', () => rolar(-1));
  document.getElementById('btn-rolar-dir').addEventListener('click', () => rolar(1));

  // Busca na lista (sistema 1): filtra a cada tecla; Enter rola ao primeiro
  // resultado; Esc limpa (o type=search também tem o ✕ nativo).
  const busca = document.getElementById('lid-busca');
  busca.addEventListener('input', aplicarBuscaLista);
  busca.addEventListener('keydown', e => {
    if (e.key === 'Enter') irAoPrimeiroResultado();
    if (e.key === 'Escape') { busca.value = ''; aplicarBuscaLista(); }
  });

  document.getElementById('input-pdf-lideres').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (f) await processarPDFModal(f);
  });

  // Arrastar o PDF direto sobre a tela de upload
  const area = document.getElementById('upload-area');
  ['dragenter', 'dragover'].forEach(ev => area.addEventListener(ev, e => {
    e.preventDefault(); area.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(ev => area.addEventListener(ev, e => {
    e.preventDefault(); area.classList.remove('drag-over');
  }));
  area.addEventListener('drop', async e => {
    const f = [...(e.dataTransfer?.files || [])].find(x => /\.pdf$/i.test(x.name));
    if (!f) return;
    abrirModalNovaReuniao();
    await processarPDFModal(f);
  });

  document.querySelectorAll('[data-fecha]').forEach(b =>
    b.addEventListener('click', () => fecharModal(b.dataset.fecha)));
  document.querySelectorAll('.modal-overlay').forEach(o =>
    o.addEventListener('click', e => { if (e.target === o) fecharModal(o.id); }));

  // Abas dos três sistemas
  document.querySelectorAll('.lid-aba').forEach(b =>
    b.addEventListener('click', () => mostrarSistema(b.dataset.sistema)));

  // Sistema 2 — demandas de deputados
  document.getElementById('btn-nova-demanda').addEventListener('click', abrirModalNovaDemanda);
  document.getElementById('btn-dem-buscar').addEventListener('click', buscarDadosDemanda);
  document.getElementById('btn-dem-registrar').addEventListener('click', registrarDemanda);

  // Sistema 3 — e-mail de demandas
  document.getElementById('btn-email-copiar').addEventListener('click', copiarEmailDemandas);
  document.getElementById('btn-email-outlook').addEventListener('click', abrirEmailNoOutlook);
  document.getElementById('btn-email-atualizar').addEventListener('click', atualizarSituacoesEmail);
}

function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
function fecharModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

// ============================================================
//  LEITURA DO PDF DA REUNIÃO
//
//  O PDF é uma tabela de largura fixa (A4 paisagem, 841,92 pt) cujas colunas
//  se separam por posição horizontal — MEDIDO no documento de referência:
//    x=38 Num. · x=66 Proposição · x=129 Autoria · x=256 Regime · x=333 Descrição
//  A descrição quebra em várias linhas e o número do item aparece no MEIO do
//  bloco, não na primeira linha dele. Por isso não dá para ler "linha a linha":
//  recortamos por coluna e agrupamos os blocos entre os números.
// ============================================================
const CHAVES_COLUNA = ['num', 'prop', 'aut', 'reg', 'desc'];
// Grade medida na lista de 07/07/2026. Serve só de rede de segurança: a grade
// real é DETECTADA no documento, porque ela muda de uma reunião para outra —
// MEDIDO, a lista de 11/08/2026 usa 38 · 108 · 236 · 358 · 493 no lugar de
// 38 · 66 · 129 · 256 · 333, e com a grade fixa o regime do item 66 vazava
// inteiro para dentro da descrição, sem erro nenhum aparecer.
const COLUNAS_PADRAO = [38, 66, 129, 256, 333];

/** Descobre onde começam as cinco colunas contando em que x o texto começa.
 *  As colunas são de longe os x mais repetidos do documento — as quebras de
 *  linha da descrição ficam bem abaixo delas. Exige separação mínima para não
 *  eleger dois picos vizinhos da mesma coluna. */
function detectarColunas(paginas) {
  const hist = new Map();
  for (const items of paginas) {
    for (const it of items) {
      if (!it.str.trim()) continue;
      const x = Math.round(it.transform[4]);
      hist.set(x, (hist.get(x) || 0) + 1);
    }
  }
  const picos = [];
  for (const [x, n] of [...hist].sort((a, b) => b[1] - a[1])) {
    if (picos.length === CHAVES_COLUNA.length) break;
    if (picos.every(p => Math.abs(p - x) >= 20)) picos.push(x);
  }
  picos.sort((a, b) => a - b);
  // Sem cinco colunas plausíveis o documento não é a tabela esperada; a grade
  // medida é melhor que uma detecção pela metade.
  const plausivel = picos.length === CHAVES_COLUNA.length && picos[0] < 80
    && picos[CHAVES_COLUNA.length - 1] > 200;
  return plausivel ? picos : COLUNAS_PADRAO.slice();
}

/** Agrupa os fragmentos de uma página em linhas e recorta cada linha nas cinco
 *  colunas da tabela. Cada fragmento cai na última coluna que começa à sua
 *  esquerda — é o que faz a continuação da descrição (bem à direita) voltar
 *  para a coluna de descrição. */
function linhasDaPagina(items, colunas) {
  const colunaDe = x => {
    let k = 0;
    for (let i = 0; i < colunas.length; i++) if (x >= colunas[i] - 2) k = i;
    return CHAVES_COLUNA[k];
  };
  const porY = new Map();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]);
    // Tolerância de 2 pt: fragmentos da mesma linha às vezes diferem no baseline.
    let chave = y;
    for (const k of porY.keys()) if (Math.abs(k - y) <= 2) { chave = k; break; }
    if (!porY.has(chave)) porY.set(chave, []);
    porY.get(chave).push({ x: it.transform[4], s: it.str });
  }
  return [...porY.entries()].sort((a, b) => b[0] - a[0]).map(([y, frags]) => {
    frags.sort((a, b) => a.x - b.x);
    const cols = {};
    for (const k of CHAVES_COLUNA) cols[k] = '';
    // Junta sem separador: o PDF já emite os espaços como fragmentos próprios,
    // e é assim que "Paulo Abi" + "-" + "Ackel" volta a ser "Paulo Abi-Ackel".
    for (const f of frags) cols[colunaDe(f.x)] += f.s;
    // Título e cabeçalho de tabela vivem na coluna do número, que fora deles só
    // tem dígitos. MEDIDO: o cabeçalho "Num. | Proposição | ..." se repete no
    // MEIO das páginas (p. ex. y=429 da pág. 2), não apenas no topo — por isso
    // ele entra como separador de linha, e não como "tudo acima é lixo".
    const separador = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cols.num);
    return { y, cols, separador };
  });
}

/** Recorta a lista de linhas em itens da tabela. */
function partirEmItens(linhas) {
  // Âncora = a linha que traz o número do item. Exige conteúdo em outra coluna
  // para que um número de página solto não vire item.
  const ehAncora = l => !l.separador && /^\s*\d{1,3}\s*$/.test(l.cols.num) &&
    (l.cols.prop.trim() || l.cols.aut.trim());
  const ancoras = [];
  linhas.forEach((l, i) => { if (ehAncora(l)) ancoras.push(i); });
  if (!ancoras.length) return [];

  // Distância até a linha seguinte. Quebra de página e cabeçalho repetido são
  // fronteiras absolutas; dentro da página, a maior distância entre duas linhas
  // é o filete que separa as linhas da tabela.
  const dist = i => (linhas[i].pagina !== linhas[i + 1].pagina ||
                     linhas[i].separador || linhas[i + 1].separador)
    ? Infinity : linhas[i].y - linhas[i + 1].y;

  const cortes = [];
  for (let a = 0; a < ancoras.length - 1; a++) {
    let melhor = ancoras[a], melhorD = -1;
    for (let i = ancoras[a]; i < ancoras[a + 1]; i++) {
      const d = dist(i);
      if (d > melhorD) { melhorD = d; melhor = i; }
    }
    cortes.push(melhor + 1);
  }
  const ini = [0, ...cortes], fim = [...cortes, linhas.length];

  return ancoras.map((iAncora, k) => {
    const bloco = linhas.slice(ini[k], fim[k]).filter(l => !l.separador);
    const junta = key => bloco.map(l => l.cols[key]).filter(s => s.trim()).join(' ').replace(/\s+/g, ' ').trim();
    return {
      num:       linhas[iAncora].cols.num.trim(),
      prop:      junta('prop'),
      autoria:   junta('aut'),
      regime:    junta('reg'),
      descricao: junta('desc'),
    };
  });
}

async function lerListaDoPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;

  // Duas passagens: a primeira só para descobrir onde ficam as colunas NESTE
  // documento, já que a grade muda de uma reunião para outra.
  const paginas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    paginas.push((await (await pdf.getPage(p)).getTextContent()).items);
  }
  const colunas = detectarColunas(paginas);

  const linhas = [];
  paginas.forEach((items, i) => {
    for (const l of linhasDaPagina(items, colunas)) linhas.push({ ...l, pagina: i + 1 });
  });
  return partirEmItens(linhas);
}

// Espécies que podem aparecer na coluna "Proposição".
const RE_PROP = /\b(PL|PLP|PEC|PDL|PDC|PDS|PRC|PLV|PLN|MPV|MSC|PDN|INC|SUG)\s*n?[º°.]*\s*(\d{1,5})\s*\/\s*(\d{4})\b/gi;

/** O que a célula da lista traz ALÉM do número da proposição — na prática o
 *  "- EMS" que marca a matéria que voltou do Senado. É informação que a própria
 *  Liderança escreveu sobre o que está em jogo, e some se a interface mostrar
 *  só "PL 1242/2026". Genérico de propósito: marcador novo aparece sozinho. */
function marcadorDoItem(celula) {
  const resto = String(celula || '')
    .replace(/\((?:\s*principal[^)]*)\)/gi, '')   // "(Principal: PL 23/2026)" já vira campo próprio
    .replace(new RegExp(RE_PROP.source, 'gi'), '')
    .replace(/[\s\-–—:;,.()]+/g, ' ')
    .trim();
  return resto ? resto.toUpperCase() : '';
}

/** Uma linha da tabela pode carregar mais de uma proposição — o item traz a
 *  apensada e, entre parênteses, a principal. Cada uma vira uma linha da
 *  planilha, porque cada uma tem inteiro teor e tramitação próprios. */
function proposicoesDoItem(item) {
  const achados = [];
  const vistos  = new Set();
  let m;
  RE_PROP.lastIndex = 0;
  while ((m = RE_PROP.exec(item.prop)) !== null) {
    const chave = `${m[1].toUpperCase()} ${parseInt(m[2], 10)}/${m[3]}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    achados.push({
      chave,
      sigla:  m[1].toUpperCase(),
      numero: parseInt(m[2], 10),
      ano:    parseInt(m[3], 10),
      // "(Principal: PL 23/2026)" — a proposição citada dentro dos parênteses
      // é a principal; a que abre a célula é a que foi listada.
      ehPrincipal: /\(\s*principal/i.test(item.prop.slice(0, m.index)),
    });
  }
  return achados;
}

// ============================================================
//  MODAL NOVA REUNIÃO
// ============================================================
let _bufferPDF = null;

function abrirModalNovaReuniao() {
  _bufferPDF = null;
  document.getElementById('reuniao-titulo').value = '';
  document.getElementById('input-pdf-lideres').value = '';
  document.getElementById('upload-inline-lideres-text').textContent = 'Clique para selecionar o PDF';
  document.getElementById('itens-encontrados').style.display = 'none';
  document.getElementById('lista-itens-modal').innerHTML = '';
  document.getElementById('btn-criar-reuniao').disabled = true;
  document.getElementById('modal-nova-reuniao').style.display = 'flex';
}

async function processarPDFModal(file) {
  const label = document.getElementById('upload-inline-lideres-text');
  const cx    = document.getElementById('itens-encontrados');
  const lista = document.getElementById('lista-itens-modal');

  label.textContent = '⏳ Lendo PDF...';
  try {
    const itens = await lerListaDoPDF(file);
    const props = itens.flatMap(it => proposicoesDoItem(it).map(p => ({ ...p, item: it })));
    _bufferPDF = { nome: file.name, itens, props };

    if (!props.length) {
      label.textContent = '⚠ Nenhuma proposição encontrada no PDF';
      cx.style.display = 'none';
      document.getElementById('btn-criar-reuniao').disabled = true;
      return;
    }

    label.textContent = `✓ ${file.name} — ${itens.length} itens, ${props.length} proposições`;
    lista.innerHTML = props.map(p => `<span class="lid-tag">${esc(p.chave)}</span>`).join('');
    cx.style.display = 'block';
    document.getElementById('btn-criar-reuniao').disabled = false;

    // Sugere o título a partir do nome do arquivo ("2026.7.7 – Reunião de Líderes")
    const campo = document.getElementById('reuniao-titulo');
    if (!campo.value.trim()) {
      const m = file.name.match(/(\d{4})[.\-_](\d{1,2})[.\-_](\d{1,2})/);
      campo.value = m
        ? `Reunião de Líderes – ${String(m[3]).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}/${m[1]}`
        : `Reunião de Líderes – ${new Date().toLocaleDateString('pt-BR')}`;
    }
  } catch (err) {
    label.textContent = `✗ Erro ao ler PDF: ${err.message}`;
    document.getElementById('btn-criar-reuniao').disabled = true;
  }
}

async function criarReuniao() {
  if (!_bufferPDF?.props?.length) return;

  const titulo = document.getElementById('reuniao-titulo').value.trim()
    || `Reunião de Líderes – ${new Date().toLocaleDateString('pt-BR')}`;

  app.reuniao = {
    id:     `lid-${Date.now()}`,
    titulo,
    arquivo: _bufferPDF.nome,
    criada: new Date().toISOString(),
    itens: _bufferPDF.props.map((p, i) => ({
      ordem:         i + 1,
      numItem:       p.item.num,
      chave:         p.chave,
      sigla:         p.sigla,
      numero:        p.numero,
      ano:           p.ano,
      ehPrincipal:   p.ehPrincipal,
      celulaProp:    p.item.prop,
      marcador:      marcadorDoItem(p.item.prop),
      autoriaPdf:    p.item.autoria,
      regimePdf:     p.item.regime,
      descricaoPdf:  p.item.descricao,
      idCamara:      null,
      ementa:        '',
      autoresApi:    [],
      urlInteiroTeor: null,
      objetivo:      '',
      justificativa: '',
      situacao:      '',
      comissoes:     '',
      relatoria:     '',
      comparativo:   '',
      apensacao:     '',
      papel:         null,
      autoriaPodemos: false,
      autoriaPrincipalPodemos: false,
      relatorPodemos: false,
      parecer:       '',
      senado:        '',
      parecerPlen:   null,
      emendaSenado:  null,
      cenario:       0,
      cenarioNome:   '',
      status:        'pendente',
      erro:          '',
    })),
  };

  fecharModal('modal-nova-reuniao');
  app.selecionados.clear();
  atualizarSidebar();
  renderizarTabela();
  mostrarTela('tela-lista');
  document.getElementById('lid-action-bar').style.display = 'flex';

  mostrarToast(`${app.reuniao.itens.length} proposições. Buscando dados na Câmara...`, '');
  await carregarDadosCamara(app.reuniao.itens);
  renderizarTabela();
  atualizarSidebar();
  mostrarToast('Dados carregados. Clique em "Resumir Todas" para gerar os resumos por IA.', 'sucesso');
}

// ============================================================
//  DADOS ABERTOS DA CÂMARA
// ============================================================
async function carregarDadosCamara(itens) {
  let feitos = 0;
  await mapLimit(itens, 6, async it => {
    try {
      await carregarDadosDaProposicao(it);
      it.status = it.status === 'ok' ? 'ok' : 'dados';
    } catch (e) {
      it.erro = `Dados da Câmara: ${e.message}`;
      it.status = 'erro';
    }
    atualizarProgresso(++feitos, itens.length, 'Consultando a Câmara');
  });
  atualizarProgresso(0, 0);
}

async function carregarDadosDaProposicao(it) {
  const res = await fetch(`${API_BASE}/proposicoes?siglaTipo=${it.sigla}&numero=${it.numero}&ano=${it.ano}&itens=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const item = (await res.json()).dados?.[0];
  if (!item) throw new Error('proposição não localizada');
  it.idCamara = item.id;

  // O endpoint de LISTA não traz urlInteiroTeor nem statusProposicao; o DETALHE traz.
  let detalhe = item;
  try {
    const rd = await fetch(`${API_BASE}/proposicoes/${item.id}`);
    if (rd.ok) detalhe = (await rd.json()).dados || item;
  } catch (_) {}
  it.ementa         = detalhe.ementa || item.ementa || '';
  it.urlInteiroTeor = detalhe.urlInteiroTeor || null;
  it.situacaoApi    = detalhe.statusProposicao?.descricaoSituacao || '';

  const autores = await autoresDetalhados(item.id);
  it.autoresApi = autores.map(a => a.nome).filter(Boolean).slice(0, 5);
  const podeAut = autores.filter(a => a.isPodemos);
  it.autoriaPodemos = podeAut.length > 0;
  it.autoresPodemos = podeAut.map(a => a.nome).filter(Boolean);
  // 1º signatário (ordemAssinatura = 1) = autoria; assinou depois = coautoria.
  const temOrdem = autores.some(a => Number.isFinite(Number(a.ordem)));
  it.autoriaPrincipalPodemos = temOrdem ? podeAut.some(a => Number(a.ordem) === 1) : podeAut.length > 0;

  const trams = await buscarTramitacoes(item.id);
  it.situacao  = situacaoDe(trams, it.regimePdf);
  it.relatoria = await relatoriaDe(trams, detalhe.statusProposicao);
  it.despachos = despachosDeComissao(trams, detalhe.statusProposicao);

  it.papel = await papelDe(detalhe, trams);
  it.apensadosPodemos = [];
  if (!it.papel.apensada && it.papel.temApensados) {
    const ap = await apensadosDoPodemos(item.id);
    it.apensadosPodemos = ap.achados;
    it.apensadosVarreduraLimitada = ap.truncado;
  }
  const req = await alvoDoREQ(it);
  it.apensacao = [frasePapel(it), fraseUrgenciaREQ(it, req),
    it.apensadosPodemos.length
      ? `Apensado do Podemos: ${it.apensadosPodemos.map(a => `${a.chave} (${a.autores.join(', ')})`).join('; ')}.` : '',
    it.apensadosVarreduraLimitada
      ? `Varredura de apensados limitada aos ${MAX_APENSADOS_VARRIDOS} mais recentes.` : '',
  ].filter(Boolean).join('\n');

  const relacionados = await buscarDocumentosRelacionados(item.id, it.sigla);
  it.parecerPlen  = parecerPlenarioDe(relacionados);
  it.emendaSenado = emendaSenadoDe(relacionados);
  it.sbtComissao  = substitutivoComissaoDe(relacionados);
  it.subemenda    = subemendaDe(relacionados);
  it.especial     = it.sigla === 'PEC'
    ? comUrl(relacionados.filter(d => ehComissaoEspecial(d) && ['PRL', 'SBT-A', 'SBT'].includes(d.tipo))) : [];
  it.cenario      = cenarioDe(it, relacionados);
  it.cenarioNome  = NOME_CENARIO[it.cenario] || '';
  it.parecerFato  = fraseDoParecer(it.parecerPlen);
  it.senadoFato   = fraseDaEmendaSenado(it.emendaSenado);
  if (!it.parecer) it.parecer = it.parecerFato;
  if (!it.senado)  it.senado  = it.senadoFato;
  // Designação antiga pode não ter ficado registrada como tramitação de PLEN;
  // o parecer nomeia o relator e serve de segunda via.
  if (it.relatoria === 'Sem indicação' && it.parecerPlen?.relator) {
    it.relatoria = `${it.parecerPlen.relator} (parecer de ${dataBR(it.parecerPlen.data)})`;
  }
  it.relatorPodemos = ehRelatorPodemos(it.relatoria);
}

// ---------- AUTORIA E RELATORIA DO PODEMOS ----------
// Mesmo critério do módulo de Plenário (analise.js): partido do deputado na
// ficha dos Dados Abertos, sigla PODE.
const SIGLA_PODEMOS = 'PODE';
const _cacheDeputado = new Map();   // idDep → { nome, siglaPartido } — o mesmo autor assina várias

async function infoDeputado(idDep) {
  if (_cacheDeputado.has(idDep)) return _cacheDeputado.get(idDep);
  let info = null;
  try {
    const r = await fetch(`${API_BASE}/deputados/${idDep}`);
    if (r.ok) {
      const us = (await r.json()).dados?.ultimoStatus || {};
      info = { nome: us.nome, siglaPartido: us.siglaPartido, siglaUf: us.siglaUf };
    }
  } catch (_) { /* fica sem partido */ }
  _cacheDeputado.set(idDep, info);
  return info;
}

async function autoresDetalhados(idProp) {
  let dados = [];
  try {
    const r = await fetch(`${API_BASE}/proposicoes/${idProp}/autores`);
    if (r.ok) dados = (await r.json()).dados || [];
  } catch (_) { return []; }
  const out = [];
  for (const a of dados) {
    const m = (a.uri || '').match(/\/deputados\/(\d+)/);
    if (!m) { out.push({ nome: a.nome, ordem: a.ordemAssinatura, isPodemos: false }); continue; }
    const info = await infoDeputado(m[1]);
    out.push({
      nome: a.nome || info?.nome,
      ordem: a.ordemAssinatura,
      isPodemos: info?.siglaPartido === SIGLA_PODEMOS,
    });
  }
  return out;
}

// ---------- Apensados do Podemos ----------
// A lista da reunião nomeia o principal, mas um apensado do Podemos que ela
// NÃO nomeia é exatamente o que a Liderança precisa saber. O Plenário resolve
// a cadeia de apensamento inteira (raiz por raiz); aqui, com até 73 matérias e
// relacionadas na casa das centenas, a varredura é DELIBERADAMENTE menor:
//   · só roda quando as tramitações registram apensados (papelDe já detecta);
//   · só apensado DIRETO (uriPropPrincipal apontando para a matéria da lista —
//     cadeia A→B→principal fica de fora);
//   · teto de candidatos, DECLARADO na célula quando estourar.
const TIPOS_PROPOSICAO = new Set(['PL', 'PLP', 'PEC', 'PDL', 'PDC', 'PDS', 'PRC', 'MPV']);
const MAX_APENSADOS_VARRIDOS = 15;
const _cacheDetalheProp = new Map();

async function detalheProp(id) {
  if (_cacheDetalheProp.has(id)) return _cacheDetalheProp.get(id);
  let d = null;
  try {
    const r = await fetch(`${API_BASE}/proposicoes/${id}`);
    if (r.ok) d = (await r.json()).dados || null;
  } catch (_) { /* fica sem */ }
  _cacheDetalheProp.set(id, d);
  return d;
}

async function apensadosDoPodemos(idCamara) {
  let rel = [];
  try {
    const r = await fetch(`${API_BASE}/proposicoes/${idCamara}/relacionadas`);
    if (r.ok) rel = (await r.json()).dados || [];
  } catch (_) { return { achados: [], truncado: false }; }

  const candidatos = rel.filter(x => TIPOS_PROPOSICAO.has(x.siglaTipo));
  // Os últimos são as apensações mais recentes — as mais prováveis de importar.
  const varridos = candidatos.slice(-MAX_APENSADOS_VARRIDOS);
  const achados = [];
  for (const r of varridos) {
    const d = await detalheProp(r.id);
    if (!d?.uriPropPrincipal) continue;
    if (Number(String(d.uriPropPrincipal).split('/').pop()) !== Number(idCamara)) continue;
    const autores = await autoresDetalhados(r.id);
    const pode = autores.filter(a => a.isPodemos);
    if (pode.length) {
      achados.push({ chave: `${r.siglaTipo} ${r.numero}/${r.ano}`, autores: pode.map(a => a.nome) });
    }
  }
  return { achados, truncado: candidatos.length > varridos.length };
}

/** A relatoria já sai formatada com o partido entre parênteses — "(PODE-MG)"
 *  vindo da ficha, do despacho ou da ementa do parecer. */
const ehRelatorPodemos = rel => /\(PODE(?:MOS)?\b/i.test(String(rel || ''));

// ---------- DOCUMENTOS RELACIONADOS ----------
// O texto que está em jogo raramente é o que foi apresentado. A proposição
// caminha e cada etapa produz um documento próprio:
//   PRLP parecer do relator de Plenário    PPP  parecer proferido em Plenário
//   PRLE parecer às emendas                SBT  substitutivo de Plenário
//   SBT-A substitutivo adotado por comissão SSP subemenda substitutiva
//   RDF  redação final da Câmara           AA   autógrafo enviado ao Senado
//   EMS  emenda/substitutivo do Senado     PSS  parecer da Câmara à emenda
//   PRL  parecer do relator (comissão, inclusive Comissão Especial de PEC)
//
// OS CENÁRIOS SÃO OS MESMOS DO MÓDULO DE PLENÁRIO (analise.js,
// escolherDocumentos/classificarCenario) — mesma numeração e mesma ordem de
// prioridade, para que os dois painéis falem a mesma língua. A diferença é a
// FONTE: lá os documentos saem da raspagem das páginas de pareceres e emendas;
// aqui saem de /proposicoes/{id}/relacionadas, que MEDIDO expõe todos esses
// tipos (nas 68 da lista de 07/07/2026: PRLP 36, SBT-A 13, PPP 10, PRLE 4,
// RDF 4, EMS 3, SSP 1, AA 1, PSS 1).
const TIPOS_RELACIONADOS = new Set(['PPP', 'PRLP', 'PRLE', 'PRL', 'SBT', 'SBT-A',
                                    'SSP', 'RDF', 'AA', 'EMS', 'PSS']);
// Teto por proposição: o PL 462/2011 tem 11 documentos e cada um custa uma
// consulta de detalhe só para saber o órgão e a data.
const MAX_RELACIONADOS = 30;

async function buscarDocumentosRelacionados(idCamara, sigla, signal) {
  let rel;
  try {
    const r = await fetch(`${API_BASE}/proposicoes/${idCamara}/relacionadas`, { signal });
    if (!r.ok) return [];
    rel = (await r.json()).dados || [];
  } catch (_) { return []; }

  // Cada documento custa uma consulta de detalhe só para saber órgão e data.
  // PRL é de longe o tipo mais numeroso (64 nas 68 da lista) e só interessa em
  // PEC, onde a Comissão Especial é quem produz o texto operativo — fora daí
  // seriam ~60 consultas por nada.
  const interessa = x => TIPOS_RELACIONADOS.has(x.siglaTipo) && (x.siglaTipo !== 'PRL' || sigla === 'PEC');
  const docs = [];
  for (const d of rel.filter(interessa).slice(0, MAX_RELACIONADOS)) {
    try {
      const r = await fetch(`${API_BASE}/proposicoes/${d.id}`, { signal });
      if (!r.ok) continue;
      const det = (await r.json()).dados;
      docs.push({
        tipo:   d.siglaTipo,
        data:   (det.dataApresentacao || det.statusProposicao?.dataHora || '').slice(0, 10),
        orgao:  det.statusProposicao?.siglaOrgao || '',
        ementa: det.ementa || '',
        url:    det.urlInteiroTeor || null,
      });
    } catch (_) { /* um documento a menos */ }
  }
  return docs;
}

const maisNovo = lista => lista.slice().sort((a, b) => (a.data || '').localeCompare(b.data || '')).pop() || null;
const comUrl = lista => lista.filter(d => d.url);
// Comissão Especial: o órgão dela é codificado com o número da própria
// proposição (a da PEC 231/2019 é "PEC23119"), e não com sigla de comissão
// permanente.
const ehComissaoEspecial = d => /^[A-Z]{2,4}\d{3,}$/.test(d.orgao || '');

/** Cenário de tramitação — mesma numeração e mesma ordem de prioridade do
 *  módulo de Plenário (analise.js: classificarCenario). */
function cenarioDe(it, docs) {
  const tem = t => docs.some(d => d.tipo === t && d.url);
  const especial = comUrl(docs.filter(d => ehComissaoEspecial(d) && (d.tipo === 'PRL' || d.tipo === 'SBT-A' || d.tipo === 'SBT')));
  if (it.sigla === 'PEC' && especial.length) return 9;
  if (it.sigla === 'PDL' || it.sigla === 'PDC') return 10;
  if (tem('EMS')) return emendaSenadoDe(docs)?.parecerPos ? 7 : 6;
  if (tem('SSP')) return 5;
  // Exige o documento COM inteiro teor: um SBT registrado sem peça anexa não
  // sustenta o cenário 4, e declará-lo assim mesmo deixava textoEmVotacao sem
  // nada para devolver.
  const sbtUtil = docs.some(d => (d.tipo === 'SBT-A' || (d.tipo === 'SBT' && d.orgao === 'PLEN')) && d.url);
  if ((tem('PRLP') || tem('PPP')) && sbtUtil) return 4;
  if (tem('SBT-A')) return 2;
  if (tem('PRLP') || tem('PRLE') || tem('PPP')) return 3;
  return 1;
}

const NOME_CENARIO = {
  1:  'Cenário 1 — inteiro teor (sem parecer)',
  2:  'Cenário 2 — substitutivo de comissão (SBT-A)',
  3:  'Cenário 3 — parecer de plenário',
  4:  'Cenário 4 — parecer de plenário na forma do substitutivo',
  5:  'Cenário 5 — subemenda substitutiva (SSP)',
  6:  'Cenário 6 — retorno do Senado (EMS)',
  7:  'Cenário 7 — retorno do Senado com parecer da Câmara',
  9:  'Cenário 9 — PEC (parecer da Comissão Especial)',
  10: 'Cenário 10 — PDL (decreto legislativo)',
};

/** Parecer de Plenário: o que o separa do de comissão é o siglaOrgao, não o
 *  tipo. O PPP é o parecer efetivamente proferido; o PRLP é o do relator. */
function parecerPlenarioDe(docs) {
  const doPlenario = docs.filter(d => ['PPP', 'PRLP', 'PRLE', 'SBT'].includes(d.tipo) && d.orgao === 'PLEN');
  const pareceres0 = doPlenario.filter(d => d.tipo === 'PPP' || d.tipo === 'PRLP');
  if (!pareceres0.length) return null;

  // Só a leva mais recente: o parecer de Plenário costuma vir repartido em um
  // documento por comissão, todos do mesmo dia (o PL 4558/2019 tem três), e
  // parecer de uma rodada anterior de apreciação não descreve o texto de agora.
  const data = maisNovo(pareceres0).data;
  const leva = doPlenario.filter(d => d.data === data);
  const pareceres = leva.filter(d => d.tipo === 'PPP' || d.tipo === 'PRLP');
  return {
    data,
    pareceres,
    proferido: pareceres.some(p => p.tipo === 'PPP'),
    substitutivo: leva.find(d => d.tipo === 'SBT' && d.url) || null,
    relator: relatorDaEmenta(pareceres),
    relatorRotulo: pareceres.some(p => /\bRelatora\b/i.test(p.ementa || '')) ? 'relatora' : 'relator',
    // O de mérito é o que conclui pela aprovação — os demais tratam de
    // constitucionalidade e de adequação orçamentária.
    merito: pareceres.find(p => /na forma do substitutivo|pela aprova/i.test(p.ementa) && p.url)
            || comUrl(pareceres).pop() || null,
  };
}

/** Substitutivo adotado por comissão, e a subemenda de Plenário. */
const substitutivoComissaoDe = docs => maisNovo(comUrl(docs.filter(d => d.tipo === 'SBT-A')));
const subemendaDe            = docs => maisNovo(comUrl(docs.filter(d => d.tipo === 'SSP')));

/** Proposição que voltou do Senado (a lista marca esses itens com "- EMS").
 *  Interessa o PAR: o texto que SAIU da Câmara e o que VOLTOU do Senado — é a
 *  diferença entre os dois que o Plenário vai deliberar.
 *
 *  O texto que saiu é o AUTÓGRAFO (AA), como no módulo de Plenário; sem ele,
 *  a redação final (RDF); sem as duas, o inteiro teor serve de aproximação. */
function emendaSenadoDe(docs) {
  const ems = maisNovo(comUrl(docs.filter(d => d.tipo === 'EMS')));
  if (!ems) return null;
  const antes = t => maisNovo(comUrl(docs.filter(d => d.tipo === t && (d.data || '') <= (ems.data || ''))));
  // O parecer sobre as emendas do Senado tem de ser POSTERIOR a elas: um
  // parecer da primeira passagem nada tem a ver com o que o Senado mudou.
  const parecerPos = maisNovo(comUrl(docs.filter(d =>
    (d.tipo === 'PSS' || d.tipo === 'PRLP') && (d.data || '') > (ems.data || ''))));
  return {
    ems,
    autografo: antes('AA'),
    rdf: antes('RDF'),
    parecerPos,
    jaDeliberada: docs.some(d => d.tipo === 'RDF' && (d.data || '') > (ems.data || '')),
  };
}

/** A peça que representa o texto aprovado pela Câmara antes de ir ao Senado. */
function textoQueSaiuDaCamara(es) {
  if (es.autografo) return { doc: es.autografo, rotulo: `AUTÓGRAFO — texto aprovado pela Câmara em ${dataBR(es.autografo.data)} e enviado ao Senado` };
  if (es.rdf)       return { doc: es.rdf,       rotulo: `REDAÇÃO FINAL aprovada pela Câmara em ${dataBR(es.rdf.data)} — foi este o texto enviado ao Senado` };
  return null;
}

/** A parte factual da coluna "Emendas do Senado". O confronto entre as duas
 *  peças é redigido pela IA. */
function fraseDaEmendaSenado(es) {
  if (!es) return 'Não há emenda do Senado.';
  const saiu = textoQueSaiuDaCamara(es);
  const partes = [`Emenda/Substitutivo do Senado recebido em ${dataBR(es.ems.data)}`];
  partes.push(saiu
    ? `texto que saiu da Câmara: ${es.autografo ? 'autógrafo' : 'redação final'} de ${dataBR(saiu.doc.data)}`
    : 'texto aprovado pela Câmara não localizado — o confronto usa o inteiro teor original');
  if (es.parecerPos) partes.push(`parecer da Câmara à emenda em ${dataBR(es.parecerPos.data)}`);
  if (es.jaDeliberada) partes.push('há redação final POSTERIOR à emenda — conferir se a matéria já foi deliberada');
  return partes.join('; ') + '.';
}

function relatorDaEmenta(pareceres) {
  for (const p of pareceres) {
    const m = (p.ementa || '').match(/Relator(?:a)?,?\s*Dep\.?\s*([^(,;]+?)\s*\(([^)]+)\)/i);
    if (m) return `Dep. ${m[1].trim()} (${m[2].trim()})`;
  }
  return '';
}

const dataBR = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '')
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '');

/** A parte factual da coluna "Parecer de Plenário" — data, relator e se há
 *  substitutivo. A conclusão em si é redigida pela IA a partir dos pareceres. */
function fraseDoParecer(pp) {
  if (!pp) return 'Sem parecer proferido em Plenário.';
  const partes = [`Parecer proferido em Plenário em ${dataBR(pp.data)}`];
  if (pp.relator) partes.push(`${pp.relatorRotulo === 'relatora' ? 'pela relatora' : 'pelo relator'} ${pp.relator}`);
  partes.push(pp.substitutivo ? 'com substitutivo adotado' : 'sem substitutivo');
  return partes.join(', ') + '.';
}

async function buscarTramitacoes(idCamara) {
  try {
    // Este endpoint NÃO aceita ?ordem/?itens (devolve 400). Vem em ordem
    // ascendente de sequência.
    const res = await fetch(`${API_BASE}/proposicoes/${idCamara}/tramitacoes`);
    if (!res.ok) return [];
    return (await res.json()).dados || [];
  } catch (_) { return []; }
}

// ---------- SITUAÇÃO (regra fixa, não IA) ----------
// As três formas de preenchimento vêm do modelo de resumo usado pela equipe:
//   urgência aprovada          → "Urgência aprovada (REQ. n/aaaa)"
//   requerimento sem aprovação → "Requerimento de urgência apresentado (REQ n. n/aaaa)"
//   nada                       → "Não há requerimento de urgência apresentado."
function situacaoDe(trams, regimePdf) {
  const rev = [...trams].reverse();
  const numReq = t => {
    const m = `${t.despacho || ''}`.match(/(?:requerimento|REQ)\.?\s*n?[º°.]*\s*(\d{1,5})\s*\/\s*(\d{4})/i);
    return m ? `${m[1]}/${m[2]}` : null;
  };

  for (const t of rev) {
    const desc = t.descricaoTramitacao || '';
    const desp = t.despacho || '';
    if (/aprova[çc][ãa]o de urg[êe]ncia/i.test(desc) ||
        /aprovad[oa]\s+o\s+requerimento[^.]{0,120}urg[êe]ncia/i.test(desp)) {
      const n = numReq(t);
      return n ? `Urgência aprovada (REQ. ${n})` : 'Urgência aprovada';
    }
  }
  for (const t of rev) {
    const desp = t.despacho || '';
    const m = desp.match(/Apresenta[çc][ãa]o do REQ n\.?\s*(\d{1,5})\s*\/\s*(\d{4})\s*\(Requerimento de Urg[êe]ncia/i);
    if (m) return `Requerimento de urgência apresentado (REQ n. ${m[1]}/${m[2]})`;
  }

  // Sem registro na API, vale o que está no PDF da reunião — mas só o trecho
  // que fala de urgência: a célula de regime às vezes traz o regime ordinário
  // e a urgência juntos ("Ordinário (Art. 151, III, RICD) (Urgência aprovada
  // em 26/05/2026)"), e copiar a célula inteira produziria uma situação sem pé
  // nem cabeça.
  const reg = regimePdf || '';
  const mAprov = reg.match(/urg[êe]ncia\s+aprovada(?:\s+em\s+\d{2}\/\d{2}\/\d{4})?/i);
  if (mAprov) return mAprov[0].charAt(0).toUpperCase() + mAprov[0].slice(1);
  const mReq = reg.match(/REQ\s*n?[º°.]*\s*(\d{1,5})\s*\/\s*(\d{4})/i);
  if (mReq) return `Requerimento de urgência apresentado (REQ n. ${mReq[1]}/${mReq[2]})`;
  // A lista diz "Urgência" e a API não tem requerimento nenhum: os dois se
  // contradizem, e afirmar "não há requerimento" seria escolher um lado.
  if (/urg[êe]ncia/i.test(reg)) {
    return 'Urgência indicada na lista da reunião; sem requerimento de urgência localizado nos Dados Abertos.';
  }
  return 'Não há requerimento de urgência apresentado.';
}

// ---------- RELATORIA DE PLENÁRIO (regra fixa, não IA) ----------
// Só conta designação feita NO PLENÁRIO: relator de comissão não é relator de
// Plenário, e o statusProposicao guarda o último relator seja de onde for.
async function relatoriaDe(trams, statusProp) {
  let designacao = null;
  for (const t of trams) {
    if (t.siglaOrgao !== 'PLEN') continue;
    if (!/designa[çc][ãa]o de relator/i.test(t.descricaoTramitacao || '')) continue;
    designacao = t;   // fica com a mais recente
  }
  if (!designacao) return 'Sem indicação';

  const desp = designacao.despacho || '';
  const m = desp.match(/Dep(?:utad[oa])?\.?\s*([^(,;]+?)\s*\(([^)]+)\)/i);
  const nomeDespacho = m ? m[1].trim() : '';
  const siglaDespacho = m ? m[2].trim().replace(/\s*\/\s*/, '-') : '';

  // O despacho abrevia o partido ("REPUBLIC-SP"); a ficha do deputado traz o
  // nome inteiro. Só usamos a ficha quando ela é do mesmo relator do despacho.
  const uri = statusProp?.uriUltimoRelator;
  if (uri) {
    try {
      const r = await fetch(uri);
      if (r.ok) {
        const d = (await r.json()).dados;
        const nome = d?.ultimoStatus?.nome || d?.nomeCivil || '';
        if (nome && (!nomeDespacho || mesmaPessoa(nome, nomeDespacho))) {
          const partido = formatarPartido(d.ultimoStatus?.siglaPartido || '');
          const uf = d.ultimoStatus?.siglaUf || '';
          return `Dep. ${nome}${partido ? ` (${partido}${uf ? '-' + uf : ''})` : ''}`;
        }
      }
    } catch (_) { /* fica com o despacho */ }
  }
  if (nomeDespacho) return `Dep. ${nomeDespacho}${siglaDespacho ? ` (${siglaDespacho})` : ''}`;
  return desp.trim() || 'Sem indicação';
}

const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
function mesmaPessoa(a, b) {
  const na = semAcento(a), nb = semAcento(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}
/** "REPUBLICANOS" → "Republicanos"; siglas curtas (PT, PSD, NOVO) ficam como estão. */
function formatarPartido(sigla) {
  const s = String(sigla || '').trim();
  if (s.length <= 5) return s;
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// ---------- PRINCIPAL × APENSADO, E DE QUEM É A URGÊNCIA ----------
// Duas perguntas que decidem a conversa na reunião e que o número sozinho não
// responde: o projeto listado é o principal ou um apensado? E o requerimento
// de urgência foi apresentado para qual deles? MEDIDO no caso real: o REQ
// 1258/2026 pede urgência para o PL 101/2026 — o APENSADO —, não para o
// principal PL 23/2026. Tudo por regra fixa, sem IA.

/** Papel da proposição na árvore de apensação. uriPropPrincipal preenchido =
 *  ela é apensada; a existência de apensados dela sai das tramitações. */
async function papelDe(detalhe, trams, signal) {
  if (detalhe.uriPropPrincipal) {
    let principal = null;
    try {
      const r = await fetch(detalhe.uriPropPrincipal, { signal });
      if (r.ok) {
        const d = (await r.json()).dados;
        principal = `${d.siglaTipo} ${d.numero}/${d.ano}`;
      }
    } catch (_) { /* fica sem o nome */ }
    return { apensada: true, principal };
  }
  const temApensados = trams.some(t =>
    /apensa[çc][ãa]o d/i.test(t.despacho || '') && /a esta proposi/i.test(t.despacho || ''));
  return { apensada: false, temApensados };
}

/** Proposições citadas num texto, nas duas grafias correntes:
 *  "PL 641/2020" e "Projeto de Lei nº 2.338, de 2023". */
const NOMES_LONGOS = {
  'projeto de lei complementar': 'PLP', 'projeto de lei': 'PL',
  'proposta de emenda à constituição': 'PEC', 'projeto de decreto legislativo': 'PDL',
};
function propsCitadas(txt) {
  const out = [];
  let m;
  const re1 = /\b(PLP|PL|PEC|PDL|PDC|MPV|PDS|PRC)\s*n?[º°.]*\s*([\d.]{1,7})\s*(?:\/\s*|,?\s*de\s*)(\d{4})\b/gi;
  while ((m = re1.exec(txt))) out.push(`${m[1].toUpperCase()} ${parseInt(m[2].replace(/\./g, ''), 10)}/${m[3]}`);
  const re2 = /\b(Projeto de Lei Complementar|Projeto de Lei|Proposta de Emenda à Constituição|Projeto de Decreto Legislativo)\s*(?:n[º°.]*\s*)?([\d.]{1,7})\s*(?:\/\s*|,?\s*de\s*)(\d{4})\b/gi;
  while ((m = re2.exec(txt))) out.push(`${NOMES_LONGOS[m[1].toLowerCase()]} ${parseInt(m[2].replace(/\./g, ''), 10)}/${m[3]}`);
  return [...new Set(out)];
}

const reqDe = txt => {
  const m = String(txt || '').match(/REQ\.?\s*n?\.?\s*[º°]?\s*(\d{1,5})\s*\/\s*(\d{4})/i);
  return m ? { numero: +m[1], ano: +m[2], rotulo: `REQ ${+m[1]}/${m[2]}` } : null;
};

/** De quem é o requerimento de urgência da situação. Primeiro pela anotação da
 *  própria lista ("REQ 3787/2025 (PL 3967/2025)"); sem ela, pela ementa do REQ
 *  nos Dados Abertos, que nomeia a proposição pedida. */
async function alvoDoREQ(it, signal) {
  const req = reqDe(it.situacao) || reqDe(it.regimePdf);
  if (!req) return null;
  const anotacao = (it.regimePdf || '').match(new RegExp(
    `REQ\\s*n?[º°.]*\\s*${req.numero}\\s*\\/\\s*${req.ano}\\s*\\(([^)]+)\\)`, 'i'));
  let alvos = anotacao ? propsCitadas(anotacao[1]) : [];
  if (!alvos.length) {
    try {
      const r = await fetch(`${API_BASE}/proposicoes?siglaTipo=REQ&numero=${req.numero}&ano=${req.ano}&itens=1`, { signal });
      if (r.ok) alvos = propsCitadas(((await r.json()).dados?.[0]?.ementa) || '');
    } catch (_) { /* fica sem alvo */ }
  }
  return { ...req, alvos };
}

function frasePapel(it) {
  const p = it.papel;
  if (!p) return '';
  if (p.apensada) {
    // A lista às vezes declara outro principal — divergência aparece, não some.
    const decl = (it.celulaProp || '').match(/\(\s*principal:?\s*([^)]+)\)/i);
    const declarados = decl ? propsCitadas(decl[1]) : [];
    const div = p.principal && declarados.length && !declarados.includes(p.principal)
      ? ` — a lista indica ${declarados[0]} como principal` : '';
    return `Apensado ao ${p.principal || 'principal não identificado'}${div}.`;
  }
  return p.temApensados ? 'Principal (com apensados).' : 'Sem apensação.';
}

function fraseUrgenciaREQ(it, req) {
  if (!req) return '';
  if (!req.alvos.length) return `${req.rotulo}: proposição a que se refere não identificada — conferir.`;
  const alvo = req.alvos[0];
  if (alvo === it.chave) return `${req.rotulo} refere-se a este projeto${it.papel?.apensada ? ' (o apensado)' : ''}.`;
  if (it.papel?.principal && alvo === it.papel.principal) return `${req.rotulo} refere-se ao principal (${alvo}).`;
  return `${req.rotulo} refere-se ao ${alvo}.`;
}

// ---------- MATÉRIA-PRIMA DO CAMPO "COMISSÕES" ----------
// Não decide nada: recolhe os despachos de distribuição e o andamento por
// comissão para a IA redigir a frase com base em texto real.
const ORGAOS_NAO_COMISSAO = new Set(['PLEN', 'MESA', 'SGM', 'PR', 'SPL', 'CCP', 'CORD', 'SECGER', 'SECLEG', 'DETAQ']);

function despachosDeComissao(trams, statusProp) {
  const distribuicao = [];
  for (const t of trams) {
    const d = (t.despacho || '').trim();
    if (!d) continue;
    if (/^\s*(À|As|Às)\s+Comiss|^\s*Apense-se|distribu[ií](?:ção|do|da)\s+.{0,40}Comiss/i.test(d)) {
      distribuicao.push(`${(t.dataHora || '').slice(0, 10)} — ${d}`);
    }
  }
  // Andamento por comissão: última tramitação registrada em cada órgão colegiado.
  const porOrgao = new Map();
  for (const t of trams) {
    const sig = t.siglaOrgao;
    if (!sig || ORGAOS_NAO_COMISSAO.has(sig)) continue;
    porOrgao.set(sig, `${sig}: ${(t.dataHora || '').slice(0, 10)} — ${t.descricaoTramitacao || ''}${t.despacho ? ' · ' + t.despacho : ''}`);
  }
  return {
    distribuicao: distribuicao.slice(-6),
    comissoes:    [...porOrgao.values()],
    situacaoAtual: [statusProp?.siglaOrgao, statusProp?.descricaoSituacao, statusProp?.despacho]
      .filter(Boolean).join(' · '),
  };
}

// ============================================================
//  PROVEDORES DE IA (mesma configuração dos demais painéis)
// ============================================================
const PROVEDORES_META = {
  gemini: {
    label: 'Google Gemini',
    placeholderChave: 'AIzaSy... ou AQ....',
    hintChave: 'Obtenha em aistudio.google.com → Get API key',
    regexChave: /^[\w.-]{20,}$/,
    // gemini-2.5-flash não é mais liberado para chaves novas ("no longer
    // available to new users"), então o primeiro da lista é o apelido móvel,
    // que nunca fica para trás. Os fixos continuam disponíveis para quem já usa.
    modelosFallback: [
      { id: 'gemini-flash-latest', displayName: 'Gemini Flash (mais recente)' },
      { id: 'gemini-pro-latest',   displayName: 'Gemini Pro (mais recente)' },
      { id: 'gemini-2.5-flash',    displayName: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro',      displayName: 'Gemini 2.5 Pro' },
    ],
    async listar(key) {
      const res = await fetch(`${GEMINI_BASE}?key=${key}&pageSize=50`);
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
      const prefs = ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4', 'o3'];
      const ids = (j.data || []).map(m => m.id).filter(id => prefs.some(p => id.startsWith(p))).sort();
      return ids.length ? ids.map(id => ({ id, displayName: id })) : this.modelosFallback;
    },
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    placeholderChave: 'sk-ant-...',
    hintChave: 'Obtenha em console.anthropic.com → Settings → API Keys',
    regexChave: /^sk-ant-[\w-]{20,}$/,
    modelosFallback: [
      { id: 'claude-opus-4-8',   displayName: 'Claude Opus 4.8' },
      { id: 'claude-opus-4-7',   displayName: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5',  displayName: 'Claude Haiku 4.5' },
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

function bufParaBase64(buf) {
  const u8 = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Repete em 429/5xx; erro permanente (4xx) sobe na hora. */
async function fetchIA(url, init, signal) {
  const esperas = [0, 5000, 15000, 30000];
  let ultimo = null;
  for (let i = 0; i < esperas.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (esperas[i]) await sleep(esperas[i], signal);
    let res;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      ultimo = e; continue;
    }
    if (res.ok) return await res.json();
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      ultimo = new Error(`HTTP ${res.status}`);
      continue;
    }
    let det = null;
    try { det = await res.json(); } catch (_) {}
    throw new Error(det?.error?.message || `HTTP ${res.status}`);
  }
  throw ultimo || new Error('falhou após as tentativas');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/** docs: [{ kind:'pdf', b64 } | { kind:'text', texto }] */
async function chamarIA(prompt, docs = [], signal) {
  const pid = app.config.apiKey ? (app.config.provedor || 'gemini') : '';
  if (!pid) throw new Error('Nenhuma chave de IA configurada. Configure em ⚙ Configurações.');
  if (pid === 'gemini')    return callGemini(prompt, docs, signal);
  if (pid === 'anthropic') return callAnthropic(prompt, docs, signal);
  return callOpenAI(prompt, docs, signal);
}

async function callGemini(prompt, docs, signal) {
  const modelo = app.config.modelo || 'gemini-flash-latest';
  const parts = [];
  // Cada peça vai precedida do rótulo: sem isso o modelo não distingue o texto
  // apresentado do substitutivo que o revogou.
  docs.forEach((d, i) => {
    parts.push({ text: `\n\n--- ${d.rotulo || `Documento ${i + 1}`} ---` });
    if (d.kind === 'pdf') parts.push({ inline_data: { mime_type: 'application/pdf', data: d.b64 } });
    else parts.push({ text: d.texto });
  });
  parts.push({ text: prompt });
  const j = await fetchIA(`${GEMINI_BASE}/${modelo}:generateContent?key=${app.config.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      // responseMimeType tira as cercas de código e o texto de acompanhamento.
      generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUT_TOKENS, responseMimeType: 'application/json' },
    }),
  }, signal);
  const cand = j.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('resposta cortada pelo limite de tokens do modelo');
  if (cand?.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) {
    throw new Error(`resposta interrompida pelo provedor (${cand.finishReason})`);
  }
  return (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
}

async function callAnthropic(prompt, docs, signal) {
  const modelo = app.config.modelo || 'claude-opus-4-8';
  const content = [];
  docs.forEach((d, i) => {
    content.push({ type: 'text', text: `--- ${d.rotulo || `Documento ${i + 1}`} ---` });
    if (d.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.b64 } });
    else content.push({ type: 'text', text: d.texto });
  });
  content.push({ type: 'text', text: prompt });
  const j = await fetchIA(ANTHROPIC_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'x-api-key': app.config.apiKey,
      'anthropic-version': ANTHROPIC_VER, 'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: modelo, max_tokens: MAX_OUT_TOKENS, temperature: 0.2, messages: [{ role: 'user', content }] }),
  }, signal);
  return (j.content || []).map(c => c.text || '').join('').trim();
}

async function callOpenAI(prompt, docs, signal) {
  const modelo = app.config.modelo || 'gpt-4o';
  const content = [];
  docs.forEach((d, i) => {
    content.push({ type: 'input_text', text: `--- ${d.rotulo || `Documento ${i + 1}`} ---` });
    if (d.kind === 'pdf') content.push({ type: 'input_file', filename: `documento_${i + 1}.pdf`, file_data: `data:application/pdf;base64,${d.b64}` });
    else content.push({ type: 'input_text', text: d.texto });
  });
  content.push({ type: 'input_text', text: prompt });
  const j = await fetchIA(OPENAI_BASE, {
    method: 'POST', headers: { 'Authorization': `Bearer ${app.config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo, input: [{ role: 'user', content }], temperature: 0.2,
      max_output_tokens: MAX_OUT_TOKENS, text: { format: { type: 'json_object' } },
    }),
  }, signal);
  if (j.output_text) return j.output_text.trim();
  for (const it of (j.output || [])) for (const c of (it.content || [])) if (c.type === 'output_text' && c.text) return c.text.trim();
  return '';
}

// ---------- INTEIRO TEOR ----------
// As páginas da Câmara nem sempre mandam cabeçalho CORS; por isso o download
// tenta direto, depois pelos dois proxies já usados nos outros painéis, e só
// aceita a resposta se os primeiros bytes forem "%PDF".
async function baixarPdfCamara(url, signal) {
  const vias = [
    () => fetch(url, { redirect: 'follow', signal }),
    () => fetch(WORKER + encodeURIComponent(url), { signal }),
    () => fetch(CODETABS + encodeURIComponent(url), { signal }),
  ];
  for (const tentar of vias) {
    try {
      const r = await tentar();
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      const h = new Uint8Array(buf.slice(0, 5));
      if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return buf;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }
  return null;
}

async function textoDoPdf(buf) {
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  let t = '';
  for (let i = 1; i <= pdf.numPages && t.length < MAX_TEXTO_TEOR; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    t += c.items.map(x => x.str).join(' ') + '\n';
  }
  return t.slice(0, MAX_TEXTO_TEOR);
}

/** Devolve { doc, texto }: `doc` é o que vai para a IA, `texto` é a mesma peça
 *  em texto puro, usada depois para conferir as citações do que ela escreveu. */
async function documentoDeUrl(url, rotulo, signal) {
  if (!url) return { doc: null, texto: '' };
  const buf = await baixarPdfCamara(url, signal);
  if (!buf) return { doc: null, texto: '' };

  let texto = '';
  try { texto = await textoDoPdf(buf); } catch (_) { /* PDF só de imagem */ }

  // Peça gigante (anexos, autógrafos): manda o texto, que cabe.
  if (buf.byteLength > MAX_PDF_BYTES) {
    return texto ? { doc: { kind: 'text', texto, rotulo }, texto } : { doc: null, texto: '' };
  }
  return { doc: { kind: 'pdf', b64: bufParaBase64(buf), rotulo }, texto };
}

/** O texto que o Plenário vai efetivamente deliberar, por cenário. É ele que o
 *  segundo lado do comparativo confronta com o inteiro teor.
 *
 *  Devolve null sempre que o documento do cenário não estiver ali. Isso não é
 *  zelo teórico: o cenário vem de uma leitura e o documento de outra, e uma
 *  reunião salva antes destes campos existirem chega aqui sem nenhum deles —
 *  era o que quebrava a exportação da planilha com "Cannot read properties of
 *  null (reading 'data')". */
function textoEmVotacao(it) {
  if (!it) return null;
  const pp = it.parecerPlen, es = it.emendaSenado;
  const peca = (doc, rotulo, nome) => doc && doc.url
    ? { doc, rotulo: rotulo(dataBR(doc.data)), nome } : null;

  switch (it.cenario) {
    case 6: case 7:
      return peca(es?.ems, d => `EMENDA/SUBSTITUTIVO DO SENADO recebido em ${d} — é o que voltou e será deliberado`,
                  'Substitutivo do Senado');
    case 5:
      return peca(it.subemenda, d => `SUBEMENDA SUBSTITUTIVA DE PLENÁRIO de ${d} — é ESTE o texto que vai a voto`,
                  'Subemenda substitutiva de Plenário');
    case 4:
      return peca(pp?.substitutivo, () => `SUBSTITUTIVO adotado em Plenário em ${dataBR(pp?.data)} — é ESTE o texto que vai a voto`,
                  'Substitutivo de Plenário')
          || peca(it.sbtComissao, d => `SUBSTITUTIVO adotado por comissão em ${d} — é ESTE o texto que vai a voto`,
                  'Substitutivo de comissão');
    case 2:
      return peca(it.sbtComissao, d => `SUBSTITUTIVO adotado por comissão em ${d} — é ESTE o texto que vai a voto`,
                  'Substitutivo de comissão');
    case 9:
      return peca((it.especial || []).find(d => d.tipo !== 'PRL'),
                  d => `SUBSTITUTIVO adotado pela Comissão Especial em ${d} — é ESTE o texto que vai a voto`,
                  'Substitutivo da Comissão Especial');
    default: return null;
  }
}

/** Monta o conjunto de peças que a IA vai ler e o texto-fonte contra o qual as
 *  citações serão conferidas.
 *
 *  Segue a prioridade de escolherDocumentos() do módulo de Plenário. O texto de
 *  partida vai SEMPRE: é dele que sai a justificativa do autor e é contra ele
 *  que o texto em votação é confrontado — sem os dois lados o analista não tem
 *  como orientar o líder ponto a ponto. */
async function reunirDocumentos(it, signal) {
  const docs = [];
  let fonte = '';
  const juntar = ({ doc, texto }) => { if (doc) docs.push(doc); fonte += '\n' + texto; };
  const pp = it.parecerPlen, es = it.emendaSenado;

  // Lado A — o texto de partida do confronto.
  const saiu = es && textoQueSaiuDaCamara(es);
  if (saiu) {
    juntar(await documentoDeUrl(saiu.doc.url, `Peça A: ${saiu.rotulo}.`, signal));
  }
  juntar(await documentoDeUrl(it.urlInteiroTeor,
    `Peça ${saiu ? 'A2' : 'A'}: inteiro teor do ${it.chave}, como APRESENTADO pelo autor (traz a justificativa).`, signal));
  const temOriginal = docs.length > 0;

  // Lado B — o texto em votação e o parecer que o sustenta.
  if (it.cenario === 6 || it.cenario === 7) {
    juntar(await documentoDeUrl(es.ems.url, `Peça B: ${textoEmVotacao(it).rotulo}.`, signal));
    if (es.parecerPos) {
      juntar(await documentoDeUrl(es.parecerPos.url,
        `Peça C: parecer da Câmara às emendas do Senado, de ${dataBR(es.parecerPos.data)} — diz o que o relator ACATA e o que REJEITA.`, signal));
    }
  } else {
    if (pp?.merito) {
      juntar(await documentoDeUrl(pp.merito.url,
        `Peça B: parecer de Plenário de ${dataBR(pp.data)}${pp.relator ? ` ${pp.relatorRotulo === 'relatora' ? 'pela relatora' : 'pelo relator'} ${pp.relator}` : ''}.`, signal));
    }
    const votacao = textoEmVotacao(it);
    if (votacao?.doc) juntar(await documentoDeUrl(votacao.doc.url, `Peça C: ${votacao.rotulo}.`, signal));
    if (it.cenario === 9) {
      for (const d of it.especial.filter(x => x.tipo === 'PRL').slice(-1)) {
        juntar(await documentoDeUrl(d.url, `Peça B: parecer do relator da Comissão Especial, de ${dataBR(d.data)}.`, signal));
      }
    }
  }
  return { docs, fonte: fonte.trim(), temOriginal };
}

// ---------- Conferência de citações (anti-alucinação) ----------
// Mesma heurística dos painéis de Plenário e da CCJC: se o resumo cita uma
// Lei/Decreto/EC/MP por número, esse número tem de aparecer na peça original.
// Não corrige nada — apenas marca para revisão humana.
function validarReferencias(textoGerado, textoFonte) {
  if (!textoFonte || textoFonte.length < 100) return [];
  const numerosFonte = new Set((textoFonte.match(/\d[\d.]*\d|\d/g) || []).map(s => s.replace(/\./g, '')));
  const re = /\b(Lei(?:\s+Complementar|\s+Delegada)?|Decreto(?:-Lei)?|Emenda\s+Constitucional|Medida\s+Provis[óo]ria)\s*(?:n?[º°o]?\.?\s*)?(\d[\d.]+\d|\d{3,})/gi;
  const suspeitas = [];
  const vistos = new Set();
  let m;
  while ((m = re.exec(textoGerado)) !== null) {
    const num = m[2].replace(/\./g, '');
    if (num.length < 4 || vistos.has(num)) continue;   // números curtos dão falso positivo demais
    vistos.add(num);
    if (!numerosFonte.has(num)) suspeitas.push(`${m[1].replace(/\s+/g, ' ')} nº ${m[2].trim()}`);
  }
  return suspeitas;
}

// ============================================================
//  RESUMO POR IA
// ============================================================
const REGRAS_RIGIDAS = `
REGRAS RÍGIDAS (cumprimento obrigatório):
- Baseie-se EXCLUSIVAMENTE no documento anexado e nos dados factuais deste prompt. Não recorra a conhecimento prévio.
- Não invente números de lei, artigos, decretos, datas, valores, nomes ou citações. Só mencione um dispositivo se ele aparecer literalmente no material.
- Se o documento anexado não trouxer a justificativa do autor, escreva exatamente "Justificativa não consta do inteiro teor disponível." — nunca preencha a lacuna com suposição.
- Não inclua recomendação de voto, juízo de mérito, elogio ou crítica à proposição.
- Responda APENAS com o objeto JSON pedido, sem texto antes ou depois e sem cercas de código.`;

// PEC, MPV e MSC são femininas; o resto é masculino. Sem isto o modelo escreve
// "O PEC 231/2019".
const ARTIGO_FEMININO = new Set(['PEC', 'MPV', 'MSC', 'SUG', 'INC', 'PDN']);
const artigoDe = sigla => ARTIGO_FEMININO.has(sigla) ? 'A' : 'O';

function montarPrompt(it) {
  const d = it.despachos || {};
  const pp = it.parecerPlen;
  const es = it.emendaSenado;
  const votacao = textoEmVotacao(it);
  const autoria = it.autoriaPdf || (it.autoresApi || []).join(', ') || 'não informada';

  const blocoParecer = pp ? `

PARECER DE PLENÁRIO — ${dataBR(pp.data)}${pp.relator ? ` · relator ${pp.relator}` : ''}${pp.substitutivo ? ' · COM SUBSTITUTIVO ADOTADO' : ''}
${pp.pareceres.map(p => `· ${p.ementa}`).join('\n')}` : '';

  const blocoSenado = es ? `

RETORNO DO SENADO — ${it.cenarioNome}
${it.senadoFato}
· ${es.ems.ementa}` : '';

  // O objetivo descreve SEMPRE o texto apresentado. Quem conta o que mudou é a
  // coluna própria — descrever o texto em votação aqui repetia a mesma
  // informação nas duas colunas.
  const instrucaoObjetivo = `Uma frase única, começando por \\"${artigoDe(it.sigla)} ${it.chave}, de autoria de ${autoria}, tem como objetivo …\\", descrevendo o que a proposição faz NO TEXTO APRESENTADO pelo autor — ignore aqui substitutivos e emendas, que vão em campo separado. Ajuste APENAS as preposições da autoria (de/do/da/dos/das) para a concordância correta, mantendo os nomes exatamente como estão. Cite as leis alteradas pelo nome usual quando houver (ex.: Lei de Responsabilidade Fiscal).`;

  // O analista precisa dos dois lados para orientar o líder ponto a ponto na
  // reunião, mas em reunião ninguém lê parágrafo: o campo é uma lista curta do
  // que MUDOU em relação ao inteiro teor, com teto de tamanho no próprio pedido
  // — sem o teto o modelo devolve dois parágrafos e o campo vira ilegível.
  const chaveComparativo = votacao ? `,
  "comparativo": "MUITO BREVE — no máximo 4 itens, cada um com no máximo 20 palavras, separados por ponto e vírgula, tudo numa linha só. Comece por \\"${votacao.nome}: \\" e liste apenas o que esse texto ALTERA, INCLUI ou SUPRIME em relação ao inteiro teor apresentado, usando esses verbos e citando o dispositivo quando couber. Não descreva o que ficou igual e não repita o objetivo. Só afirme mudança que você verifique confrontando as peças anexadas; se o confronto não for possível, escreva exatamente \\"Não foi possível cotejar as peças.\\"${es?.parecerPos ? ' Ao final, acrescente \\" | Parecer da Câmara: \\" e, em até 20 palavras, o que o relator ACATA e o que REJEITA.' : ''}"` : '';

  const chaveParecer = (pp && !es) ? `,
  "parecer": "Uma frase completando o registro do parecer de Plenário: por quais comissões o relator opinou e a conclusão de cada uma. Não repita a data nem o nome do relator, que já constam. Baseie-se apenas nos pareceres acima e nas peças anexadas."` : '';

  return `Você prepara o resumo das proposições que o Colégio de Líderes da Câmara dos Deputados vai avaliar para eventual inclusão na pauta do Plenário.

PROPOSIÇÃO: ${it.chave}
AUTORIA (lista da reunião): ${autoria}
AUTORIA (Dados Abertos): ${(it.autoresApi || []).join(', ') || 'não informada'}
EMENTA: ${it.ementa || it.descricaoPdf || 'não informada'}
SITUAÇÃO ATUAL: ${d.situacaoAtual || 'não informada'}

DESPACHOS DE DISTRIBUIÇÃO REGISTRADOS:
${(d.distribuicao || []).join('\n') || '(nenhum despacho de distribuição a comissões registrado)'}

ANDAMENTO POR COLEGIADO:
${(d.comissoes || []).join('\n') || '(nenhum registro em comissão)'}${blocoParecer}${blocoSenado}

As peças estão anexadas, cada uma precedida de um rótulo que diz o que ela é.

Devolva um JSON com exatamente estas chaves:

{
  "objetivo": "${instrucaoObjetivo}",
  "justificativa": "Um parágrafo curto começando por \\"Segundo a justificativa apresentada pelo autor, …\\", resumindo os motivos que o AUTOR da proposição apresenta no inteiro teor original — não os do relator. Se o inteiro teor não contiver justificativa, use a frase de abstenção prevista nas regras.",
  "comissoes": "Uma frase sobre as comissões competentes, indicando quais estão pendentes de parecer, com base APENAS nos despachos e no andamento acima. Se não houver despacho de distribuição registrado, escreva exatamente \\"Aguardando despacho do presidente.\\""${chaveComparativo}${chaveParecer}
}
${blocoInstrucoes()}${REGRAS_RIGIDAS}`;
}

function blocoInstrucoes() {
  const t = (app.instrucoes || '').trim();
  return t ? `\nINSTRUÇÕES ADICIONAIS DA EQUIPE (complementam, não substituem, o pedido acima):\n${t}\n` : '';
}

/** O modelo às vezes devolve o JSON entre cercas ou com texto em volta. */
function extrairJSON(texto) {
  const t = String(texto || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch (_) {}
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i >= 0 && f > i) {
    try { return JSON.parse(t.slice(i, f + 1)); } catch (_) {}
  }
  // Mostra o começo do que veio: sem isto, "não veio em JSON" não diz se o
  // modelo recusou, devolveu vazio ou foi cortado.
  const amostra = t.slice(0, 120).replace(/\s+/g, ' ');
  throw new Error(`resposta da IA não veio em JSON${amostra ? ` — recebido: "${amostra}…"` : ' — resposta vazia'}`);
}

async function resumirProposicao(it, signal) {
  if (!it.idCamara) await carregarDadosDaProposicao(it);

  const { docs, fonte, temOriginal } = await reunirDocumentos(it, signal);
  const resposta = await chamarIA(montarPrompt(it), docs, signal);
  const j = extrairJSON(resposta);

  it.objetivo      = String(j.objetivo || '').trim();
  it.justificativa = String(j.justificativa || '').trim();
  it.comissoes     = String(j.comissoes || '').trim();
  it.comparativo   = String(j.comparativo || '').trim();
  it.senado        = it.senadoFato;
  it.parecer = (it.parecerPlen && !it.emendaSenado)
    ? `${it.parecerFato} ${String(j.parecer || '').trim()}`.trim()
    : it.parecerFato;

  it.refsSuspeitas = validarReferencias(`${it.objetivo} ${it.justificativa} ${it.comparativo}`, fonte);
  const votacao = textoEmVotacao(it);
  const avisos = [];
  if (!temOriginal) {
    it.justificativa = 'Justificativa não consta do inteiro teor disponível.';
    avisos.push('Inteiro teor indisponível — resumo feito só com ementa e tramitação.');
  }
  if (it.emendaSenado && !textoQueSaiuDaCamara(it.emendaSenado)) {
    avisos.push('Texto aprovado pela Câmara não localizado — cotejo feito contra o inteiro teor original.');
  }
  if (it.refsSuspeitas.length) avisos.push(`Conferir no original: ${it.refsSuspeitas.join('; ')}`);
  it.avisoTeor = avisos.join(' · ');
  it.modelo = `${app.config.provedor}/${app.config.modelo}`;
  it.geradoEm = new Date().toISOString();
  it.status = 'ok';
  it.erro = '';
}

async function resumirLote(chaves) {
  if (app.processando) return;
  if (!app.reuniao?.itens?.length) return;
  if (!app.config.apiKey) {
    mostrarToast('Configure uma chave de IA em ⚙ Configurações.', 'erro');
    return;
  }
  const alvo = chaves?.length
    ? app.reuniao.itens.filter(i => chaves.includes(i.chave))
    : app.reuniao.itens;
  if (!alvo.length) return;

  app.processando = true;
  app.abortar = new AbortController();
  document.getElementById('btn-parar').style.display = '';
  ['btn-resumir-todos', 'btn-resumir-selecionados'].forEach(id => document.getElementById(id).disabled = true);

  let feitos = 0, erros = 0;
  // Duas por vez: cada chamada carrega um PDF inteiro e os provedores limitam
  // requisições por minuto — mais paralelismo só antecipa o 429.
  await mapLimit(alvo, 2, async it => {
    if (app.abortar.signal.aborted) return;
    try {
      await resumirProposicao(it, app.abortar.signal);
    } catch (e) {
      if (e.name === 'AbortError') return;
      it.status = 'erro';
      it.erro = e.message;
      erros++;
    }
    atualizarProgresso(++feitos, alvo.length, 'Resumindo');
    atualizarLinha(it);
    atualizarSidebar();
  });

  app.processando = false;
  document.getElementById('btn-parar').style.display = 'none';
  document.getElementById('btn-resumir-todos').disabled = false;
  atualizarBotaoSelecionadas();
  atualizarProgresso(0, 0);
  // Recolhe antes de redesenhar: as linhas que o usuário editou durante o lote
  // não foram atualizadas (atualizarLinha respeita o campo em foco) e o
  // redesenho as jogaria fora.
  coletarEdicoes();
  renderizarTabela();

  if (app.abortar.signal.aborted) mostrarToast(`Interrompido. ${feitos} de ${alvo.length} concluídas.`, 'aviso');
  else if (erros) mostrarToast(`${feitos - erros} resumidas, ${erros} com erro.`, 'aviso');
  else mostrarToast(`${feitos} proposições resumidas.`, 'sucesso');
}

// ============================================================
//  TABELA
// ============================================================
const CAMPOS_EDITAVEIS = ['objetivo', 'justificativa', 'comparativo', 'situacao', 'apensacao', 'comissoes', 'relatoria', 'parecer', 'senado'];

function renderizarTabela() {
  const tbody = document.getElementById('lid-tbody');
  if (!app.reuniao) { tbody.innerHTML = ''; return; }
  tbody.innerHTML = app.reuniao.itens.map(linhaHTML).join('');

  tbody.querySelectorAll('.lid-check').forEach(cb => cb.addEventListener('change', e => {
    if (e.target.checked) app.selecionados.add(cb.dataset.chave);
    else app.selecionados.delete(cb.dataset.chave);
    cb.closest('tr').classList.toggle('lid-sel', e.target.checked);
    atualizarBotaoSelecionadas();
  }));

  tbody.querySelectorAll('.lid-edit').forEach(el => el.addEventListener('blur', () => {
    const it = app.reuniao.itens.find(x => x.chave === el.dataset.chave);
    if (it) it[el.dataset.campo] = el.textContent.trim();
  }));
  aplicarBuscaLista();   // linhas recriadas: o filtro ativo continua valendo
}

// ---------- BUSCA NA LISTA ----------
// Filtra a tabela e a barra lateral em tempo real. O alvo é o CONTEÚDO do
// item (número, proposição, autores, ementa e todos os campos do resumo), não
// só o que está visível — buscar "aposta" acha o item cuja ementa fala de
// apostas mesmo com a coluna fora da tela.
function textoBuscavelDoItem(it) {
  return semAcento([it.numItem, it.chave, it.celulaProp, it.autoriaPdf,
    (it.autoresApi || []).join(' '), it.ementa, it.objetivo, it.justificativa,
    it.comparativo, it.situacao, it.apensacao, it.comissoes, it.relatoria,
    it.parecer, it.senado, it.cenarioNome].filter(Boolean).join('\n'));
}

function aplicarBuscaLista() {
  const campo = document.getElementById('lid-busca');
  if (!campo || !app.reuniao) return;
  const bruto = campo.value.trim();
  const termo = semAcento(bruto);
  // "pl4822/25", "PL 4822 2025" → também batem com a chave "PL 4822/2025"
  const ref = refDemanda(bruto);
  const chaveRef = ref ? semAcento(ref.chave) : null;

  const itens = app.reuniao.itens;
  const bateCache = new Map();
  const bate = chave => {
    if (bateCache.has(chave)) return bateCache.get(chave);
    const it = itens.find(x => x.chave === chave);
    const alvo = it ? textoBuscavelDoItem(it) : '';
    const b = !termo || alvo.includes(termo) || (chaveRef !== null && alvo.includes(chaveRef));
    bateCache.set(chave, b);
    return b;
  };

  let visiveis = 0;
  document.querySelectorAll('#lid-tbody tr[data-chave]').forEach(tr => {
    const b = bate(tr.dataset.chave);
    tr.style.display = b ? '' : 'none';
    if (b) visiveis++;
  });
  document.querySelectorAll('#lista-itens .lid-item-side').forEach(el => {
    el.style.display = bate(el.dataset.chave) ? '' : 'none';
  });

  const st = document.getElementById('lid-action-status');
  if (st && termo) st.textContent = `${visiveis} de ${itens.length} proposições na busca`;
  else if (st) st.textContent = `${itens.length} proposições · ${itens.filter(i => i.status === 'ok').length} resumidas`;
}

/** Enter na busca: rola até o primeiro resultado visível. */
function irAoPrimeiroResultado() {
  document.querySelector('#lid-tbody tr[data-chave]:not([style*="none"])')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function linhaHTML(it) {
  const marcada = app.selecionados.has(it.chave);
  const campo = (nome, rotulo) =>
    `<span class="lid-edit" contenteditable="true" data-chave="${esc(it.chave)}" data-campo="${nome}" data-vazio="${rotulo}">${esc(it[nome] || '')}</span>`;
  const link = it.urlInteiroTeor
    ? `<a class="lid-link" href="${esc(it.urlInteiroTeor)}" target="_blank" rel="noopener">inteiro teor ↗</a>` : '';
  const apenso = it.ehPrincipal ? '<span class="lid-apenso">principal</span>' : '';
  const etiquetas = etiquetasDe(it).map(t => `<span class="lid-marca">${esc(t)}</span>`).join('');
  const badgesPode =
    (it.autoriaPodemos ? `<span class="lid-badge-pode">★ ${it.autoriaPrincipalPodemos === false ? 'Coautoria' : 'Autoria'} Podemos</span>` : '') +
    (it.relatorPodemos ? '<span class="lid-badge-rel">Relatoria Podemos</span>' : '') +
    (it.apensadosPodemos || []).map(a => `<span class="lid-badge-apens">Apensado Podemos: ${esc(a.chave)}</span>`).join('');
  const erro = it.erro ? `<span class="lid-erro-msg">${esc(it.erro)}</span>` : '';
  const avisoTxt = avisosDe(it);
  const aviso = avisoTxt ? `<span class="lid-erro-msg" style="color:var(--amarelo)">${esc(avisoTxt)}</span>` : '';

  return `<tr class="${marcada ? 'lid-sel' : ''}" data-chave="${esc(it.chave)}">
    <td class="lid-c-check"><input type="checkbox" class="lid-check" data-chave="${esc(it.chave)}" ${marcada ? 'checked' : ''}></td>
    <td class="lid-c-num">${esc(it.numItem)}</td>
    <td class="lid-c-prop">
      ${esc(it.chave)}${etiquetas}${apenso}
      <span class="lid-badge ${it.status}">${rotuloStatus(it.status)}</span>
      ${badgesPode}
      ${link}${erro}${aviso}
    </td>
    <td class="lid-c-aut">${esc(it.autoriaPdf || (it.autoresApi || []).join(', '))}</td>
    <td class="lid-c-obj">${campo('objetivo', 'Objetivo')}</td>
    <td class="lid-c-just">${campo('justificativa', 'Justificativa')}</td>
    <td class="lid-c-comp">${campo('comparativo', '—')}</td>
    <td class="lid-c-sit">${campo('situacao', 'Situação')}</td>
    <td class="lid-c-ape">${campo('apensacao', 'Apensação')}</td>
    <td class="lid-c-com">${campo('comissoes', 'Comissões')}</td>
    <td class="lid-c-rel">${campo('relatoria', 'Relatoria')}</td>
    <td class="lid-c-par">${campo('parecer', 'Parecer de Plenário')}</td>
    <td class="lid-c-sen">${campo('senado', 'Emendas do Senado')}</td>
    <td class="lid-c-cen">${esc(it.cenarioNome || '')}</td>
  </tr>`;
}

const rotuloStatus = s => ({ pendente: 'pendente', dados: 'dados', ok: 'resumida', erro: 'erro' }[s] || s);

/** Etiquetas que acompanham o número da proposição. Vêm de duas origens que
 *  podem divergir: o marcador escrito na lista pela Liderança e o cenário
 *  apurado nos Dados Abertos. Quando divergem, as duas aparecem — esconder
 *  qualquer uma delas seria esconder a divergência. */
/** Alertas exibíveis. Reuniões salvas antes de o cenário virar coluna têm o
 *  texto dele gravado dentro do avisoTeor — na exibição ele sai daqui, senão
 *  voltaria a aparecer mesmo depois da mudança. */
function avisosDe(it) {
  return String(it.avisoTeor || '').split(' · ')
    .filter(a => a.trim() && !/^Cenário \d/.test(a.trim()))
    .join(' · ');
}

function etiquetasDe(it) {
  const out = [];
  if (it.marcador) out.push(it.marcador);
  const voltouDoSenado = it.cenario === 6 || it.cenario === 7;
  if (voltouDoSenado && !/EMS/.test(it.marcador || '')) out.push('EMS (apurado)');
  if (/EMS/.test(it.marcador || '') && it.cenario && !voltouDoSenado) out.push('sem EMS nos dados abertos');
  return out;
}

/** Redesenha só a linha alterada — com 80+ proposições, redesenhar a tabela
 *  inteira a cada resumo apagaria a edição em curso do usuário. */
function atualizarLinha(it) {
  const cb = document.querySelector(`.lid-check[data-chave="${cssEscape(it.chave)}"]`);
  const tr = cb?.closest('tr');
  if (!tr) return;
  const novo = document.createElement('tbody');
  novo.innerHTML = linhaHTML(it);
  const nova = novo.firstElementChild;
  // Não mexe na linha que está sendo editada neste momento.
  if (tr.contains(document.activeElement)) return;
  tr.replaceWith(nova);
  nova.querySelector('.lid-check')?.addEventListener('change', e => {
    if (e.target.checked) app.selecionados.add(it.chave); else app.selecionados.delete(it.chave);
    nova.classList.toggle('lid-sel', e.target.checked);
    atualizarBotaoSelecionadas();
  });
  nova.querySelectorAll('.lid-edit').forEach(el => el.addEventListener('blur', () => {
    it[el.dataset.campo] = el.textContent.trim();
  }));
}

const cssEscape = s => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

function marcarTodas(marcar) {
  app.selecionados.clear();
  if (marcar) app.reuniao?.itens.forEach(i => app.selecionados.add(i.chave));
  renderizarTabela();
  atualizarBotaoSelecionadas();
}

function atualizarBotaoSelecionadas() {
  const btn = document.getElementById('btn-resumir-selecionados');
  const n = app.selecionados.size;
  btn.disabled = n === 0 || app.processando;
  btn.querySelector('[data-role="sel-label"]').textContent =
    n ? `Resumir ${n} selecionada${n > 1 ? 's' : ''}` : 'Resumir selecionadas';
}

function atualizarSidebar() {
  const info = document.getElementById('reuniao-info');
  if (!app.reuniao) {
    info.className = 'sessao-info empty';
    info.innerHTML = '<span>Nenhuma reunião carregada</span>';
    document.getElementById('sidebar-itens-section').style.display = 'none';
    return;
  }
  const itens = app.reuniao.itens;
  const prontas = itens.filter(i => i.status === 'ok').length;
  info.className = 'sessao-info';
  // Se o título está sendo editado, não redesenha o bloco — a sidebar é
  // atualizada a cada item processado e apagaria o campo no meio da digitação.
  if (app._editandoTitulo) return;
  info.innerHTML = `<span class="lid-titulo-linha">
      <strong>${esc(app.reuniao.titulo)}</strong>
      <button id="btn-editar-titulo" class="lid-btn-lapis" title="Renomear a reunião">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
      </button>
    </span>
    <span style="font-size:11px;color:var(--text-dim)">${itens.length} proposições · ${prontas} resumidas</span>`;
  document.getElementById('btn-editar-titulo').addEventListener('click', editarTituloReuniao);

  document.getElementById('sidebar-itens-section').style.display = '';
  document.getElementById('lista-itens').innerHTML = itens.map(i => `
    <div class="lid-item-side" data-chave="${esc(i.chave)}">
      <span class="pt ${i.status}"></span>
      <span class="num">${esc(i.numItem)}</span>
      <span>${esc(i.chave)}</span>
    </div>`).join('');

  document.getElementById('lista-itens').querySelectorAll('.lid-item-side').forEach(el => {
    el.addEventListener('click', () => {
      const cb = document.querySelector(`.lid-check[data-chave="${cssEscape(el.dataset.chave)}"]`);
      cb?.closest('tr')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  const st = document.getElementById('lid-action-status');
  st.textContent = `${itens.length} proposições · ${prontas} resumidas`;
  aplicarBuscaLista();   // a lista lateral acabou de ser recriada — refiltra
}

/** Troca o título por um campo de edição; Enter/clicar fora salva, Esc cancela.
 *  Salva direto no Firebase — renomear é ação explícita, não pode se perder. */
function editarTituloReuniao() {
  const info = document.getElementById('reuniao-info');
  if (!app.reuniao || app._editandoTitulo) return;
  app._editandoTitulo = true;
  const original = app.reuniao.titulo;
  info.innerHTML = '<input type="text" id="input-titulo-reuniao" class="form-input" style="font-size:13px;padding:5px 8px">';
  const campo = document.getElementById('input-titulo-reuniao');
  campo.value = original;
  campo.focus();
  campo.select();

  let terminado = false;
  const terminar = async (salvar) => {
    if (terminado) return;
    terminado = true;
    app._editandoTitulo = false;
    const novoTitulo = campo.value.trim();
    if (salvar && novoTitulo && novoTitulo !== original) {
      app.reuniao.titulo = novoTitulo;
      atualizarSidebar();
      await salvarReuniao();
      carregarHistorico();
    } else {
      atualizarSidebar();
    }
  };
  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter') terminar(true);
    if (e.key === 'Escape') terminar(false);
  });
  campo.addEventListener('blur', () => terminar(true));
}

function atualizarProgresso(feitos, total, rotulo = '') {
  const wrap = document.getElementById('lid-progresso-wrap');
  if (!total) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  document.getElementById('lid-progresso-bar').style.width = `${Math.round(100 * feitos / total)}%`;
  document.getElementById('lid-progresso-label').textContent = `${rotulo} ${feitos}/${total}`;
}

// ============================================================
//  PLANILHA
// ============================================================
// ============================================================
//  MENSAGEM WHATSAPP — "Projetos do Podemos" (espelho do botão do Plenário)
// ============================================================
const itemDoPodemosLideres = it =>
  !!it.autoriaPodemos || !!it.relatorPodemos || (it.apensadosPodemos || []).length > 0;

function montarMensagemPodemos() {
  const itens = app.reuniao?.itens || [];
  // Um bloco por ITEM da lista: o item 12 tem duas proposições (apensado e
  // principal), mas na mensagem é uma entrada só, com a célula como está na
  // lista. Preferimos a linha que qualificou por autoria.
  const porItem = new Map();
  for (const it of itens.filter(itemDoPodemosLideres)) {
    const atual = porItem.get(it.numItem);
    if (!atual || (it.autoriaPodemos && !atual.autoriaPodemos)) porItem.set(it.numItem, it);
  }

  const blocos = [...porItem.values()].map(it => {
    // Negrito do WhatsApp (*texto*) na linha do item; o "* " inicial segue
    // sendo o marcador literal do formato combinado.
    const linhas = [`* *Item ${it.numItem} - ${it.celulaProp || it.chave}*`];
    linhas.push(`Autoria: ${it.autoriaPdf || (it.autoresApi || []).join(', ') || 'não informada'}`);
    linhas.push(`Ementa: ${it.ementa || it.descricaoPdf || '(sem ementa)'}`);
    if (it.situacao) linhas.push(`Situação: ${it.situacao}`);
    for (const a of (it.apensadosPodemos || [])) {
      linhas.push(`Apensado do Podemos: ${a.chave} (${a.autores.join(', ')})`);
    }
    if (it.relatorPodemos) linhas.push(`Relatoria de Plenário: ${it.relatoria}`);
    return linhas.join('\n');
  });

  if (!blocos.length) return null;
  return `PROJETOS DO PODEMOS PARA REUNIÃO DE LÍDERES\n\n${blocos.join('\n\n')}`;
}

async function copiarMensagemPodemos() {
  if (!app.reuniao?.itens?.length) { mostrarToast('Nenhuma reunião carregada.', 'erro'); return; }
  // Reunião antiga sem os campos do Podemos: completa antes, senão a mensagem
  // sai vazia sem estar errada — só desinformada.
  if (app.reuniao.itens.some(camposNovosFaltando)) await completarDadosFaltantes();
  coletarEdicoes();
  const msg = montarMensagemPodemos();
  if (!msg) {
    mostrarToast('Nenhum item com autoria, apensado ou relatoria do Podemos nesta reunião.', 'aviso');
    return;
  }
  const n = (msg.match(/^\* Item /gm) || []).length;
  try {
    await navigator.clipboard.writeText(msg);
  } catch (_) {
    // fallback: alguns contextos negam o clipboard assíncrono
    const ta = document.createElement('textarea');
    ta.value = msg;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  mostrarToast(`✓ ${n} item(ns) do Podemos copiados — cole no WhatsApp.`, 'sucesso');
}

// ============================================================
//  PDF (via window.print, mesmo caminho do módulo de Plenário)
// ============================================================
async function carregarLogoDataUrl() {
  try {
    const res = await fetch(chrome.runtime.getURL('icons/podemos-logo.png'));
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.onerror   = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch (_) { return null; }
}

/** As mesmas colunas da interface, MENOS "Emendas do Senado" — ela lista os
 *  documentos considerados, que interessam à revisão, não à reunião. */
function _htmlImpressaoLideres(reuniao, logoDataUrl) {
  const itens = reuniao.itens || [];
  const meta = `${esc(reuniao.titulo || '')} · ${itens.length} proposição(ões)`;

  const linhas = itens.map(it => {
    const marcas = etiquetasDe(it).map(t => `<span class="marca">${esc(t)}</span>`).join('');
    const apenso = it.ehPrincipal ? '<span class="apenso">principal</span>' : '';
    const avisoTxt = avisosDe(it);
    const aviso  = avisoTxt ? `<div class="aviso">${esc(avisoTxt)}</div>` : '';
    // Tarja amarela para autoria/relatoria do Podemos, com o selo textual junto
    // — numa impressão em preto e branco a tarja some, o selo fica.
    const doPode = it.autoriaPodemos || it.relatorPodemos || (it.apensadosPodemos || []).length;
    // Cada selo nomeia o(a) deputado(a) do Podemos que dá o atributo — o selo
    // sem nome obrigava a caçar na linha quem era.
    const nomesAut = (it.autoresPodemos || []).join(', ');
    const selos =
      (it.autoriaPodemos ? `<span class="selo-pode">★ ${it.autoriaPrincipalPodemos === false ? 'Coautoria' : 'Autoria'} Podemos${nomesAut ? ': ' + esc(nomesAut) : ''}</span>` : '') +
      (it.relatorPodemos ? `<span class="selo-rel">Relatoria Podemos${it.relatoria ? ': ' + esc(it.relatoria) : ''}</span>` : '') +
      (it.apensadosPodemos || []).map(a => `<span class="selo-apens">Apensado Podemos: ${esc(a.chave)}${a.autores?.length ? ' (' + esc(a.autores.join(', ')) + ')' : ''}</span>`).join('');
    return `<tr${doPode ? ' class="pode"' : ''}>
      <td class="c-num">${esc(it.numItem)}</td>
      <td class="c-prop"><b>${esc(it.chave)}</b>${marcas}${apenso}${selos}${aviso}</td>
      <td>${esc(it.autoriaPdf || (it.autoresApi || []).join(', '))}</td>
      <td>${esc(it.objetivo)}</td>
      <td>${esc(it.justificativa)}</td>
      <td>${esc(it.comparativo || '')}</td>
      <td>${esc(it.situacao)}</td>
      <td>${esc(it.apensacao || '')}</td>
      <td>${esc(it.comissoes)}</td>
      <td>${esc(it.relatoria)}</td>
      <td>${esc(it.parecer || '')}</td>
    </tr>`;
  }).join('');

  // Cabeçalho no padrão do PDF do módulo de Plenário: espaçador + título
  // centrado + logo à direita, filete verde, linha de meta em itálico.
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(reuniao.titulo || 'Reunião de Líderes')}</title>
  <style>
    @page { size:A4 landscape; margin:9mm 9mm 11mm; @bottom-center { content: counter(page); font-size:8pt; color:#888; } }
    * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { font-family:'Segoe UI',Arial,sans-serif; color:#1a1a1a; margin:0; }
    .cab { display:flex; align-items:center; gap:16px; }
    .cab .tit { flex:1; text-align:center; }
    .cab .tit h1 { font-size:16pt; font-weight:700; color:#003c1f; margin:0; }
    .cab .tit p  { font-size:10pt; color:#003c1f; margin:2px 0 0; }
    .cab img { height:42px; }
    .cab .sp { width:42px; }
    .rule { border-bottom:2px solid #00A859; margin:6px 0 8px; }
    .meta { text-align:center; font-style:italic; font-size:9pt; color:#6b7280; margin-bottom:10px; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:7pt; }
    th { background:#e7f4ec; color:#003c1f; font-weight:700; text-align:left;
         padding:3px 4px; border:1px solid #c4d6cb; }
    td { padding:3px 4px; border:1px solid #d7ded9; vertical-align:top; line-height:1.32; overflow-wrap:break-word; }
    /* Linha PODE quebrar entre páginas. Com break-inside:avoid, toda linha alta
       que não coubesse no espaço restante pulava inteira para a página seguinte
       e deixava meia página em branco — MEDIDO: só esta regra respondia por ~1/4
       das páginas do documento. O cabeçalho repete em cada página e as bordas
       seguram a leitura da linha partida. */
    thead { display:table-header-group; }
    /* Sem zebra: linha branca por padrão, e só a tarja amarela do Podemos
       marca linha — a alternância verde/branca disputava atenção com ela. */
    tbody tr.pode td { background:#fff3bf; }
    .selo-pode, .selo-rel, .selo-apens { display:block; width:fit-content; margin-top:3px; padding:0 5px;
      border-radius:4px; font-size:6.5pt; font-weight:700; }
    .selo-pode { color:#b3261e; border:1px solid #b3261e; }
    .selo-rel  { color:#0a4a7a; border:1px solid #0a4a7a; }
    .selo-apens { color:#02484d; border:1px solid #02484d; }
    .c-num  { width:3%; text-align:center; color:#666; }
    .c-prop { width:8%; }
    .marca  { display:inline-block; margin-left:4px; padding:0 4px; border:1px solid #b48a0a;
              border-radius:4px; color:#8a6d00; font-size:6.5pt; font-weight:700; }
    .apenso { display:block; color:#666; font-size:6.5pt; }
    .aviso  { color:#a15c00; font-size:6.8pt; margin-top:3px; }
    .ft { margin-top:14px; padding-top:6px; border-top:1px solid #e5e7eb; font-size:8.5pt; color:#9ca3af; text-align:center; }
  </style></head><body>
    <div class="cab">
      <div class="sp"></div>
      <div class="tit"><h1>Reunião de Líderes</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
    </div>
    <div class="rule"></div>
    <div class="meta">${meta}</div>
    <table>
      <colgroup>
        <col style="width:3%"><col style="width:8%"><col style="width:8%">
        <col style="width:15%"><col style="width:15%"><col style="width:11%">
        <col style="width:8%"><col style="width:9%"><col style="width:8%"><col style="width:7%"><col style="width:8%">
      </colgroup>
      <thead><tr>
        <th>Nº</th><th>Proposição</th><th>Autoria</th><th>Objetivo</th><th>Justificativa</th>
        <th>O que mudou</th><th>Situação</th><th>Apensação e urgência</th><th>Comissões</th><th>Relatoria de Plenário</th><th>Parecer de Plenário</th>
      </tr></thead>
      <tbody>${linhas || '<tr><td colspan="11">Reunião vazia.</td></tr>'}</tbody>
    </table>
    <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
  </body></html>`;
}

async function gerarPDF() {
  if (!app.reuniao?.itens?.length) { mostrarToast('Nada para exportar.', 'erro'); return; }
  coletarEdicoes();
  // Seleção (vazio = todas), na ordem da tabela — como no módulo de Plenário.
  const itens = app.selecionados.size
    ? app.reuniao.itens.filter(i => app.selecionados.has(i.chave))
    : app.reuniao.itens;

  // Abre a janela já no gesto do clique (evita bloqueio de pop-up).
  const win = window.open('', '_blank', 'width=1100,height=720');
  if (!win) { mostrarToast('Permita pop-ups para exportar o PDF.', 'aviso'); return; }
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando PDF…</title></head><body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Gerando o PDF…</body></html>');
  win.document.close();

  // Depois de abrir a janela (o pop-up exige o gesto do clique): reunião
  // antiga completa os campos do Podemos antes de imprimir, senão sai sem tarja.
  if (app.reuniao.itens.some(camposNovosFaltando)) await completarDadosFaltantes();
  const logoDataUrl = await carregarLogoDataUrl();
  if (win.closed) return;
  win.document.open();
  win.document.write(_htmlImpressaoLideres({ ...app.reuniao, itens }, logoDataUrl));
  win.document.close();

  // Paged.js numera as páginas; sem ele, imprime do mesmo jeito.
  let impresso = false;
  const imprimir = () => { if (impresso || win.closed) return; impresso = true; try { win.focus(); win.print(); } catch (_) {} };
  win.PagedConfig = { auto: true, after: imprimir };
  const s = win.document.createElement('script');
  s.src = chrome.runtime.getURL('libs/paged.polyfill.js');
  s.onerror = imprimir;
  win.document.head.appendChild(s);
  setTimeout(imprimir, 15000);          // rede de segurança
  mostrarToast('Gerando PDF… escolha "Salvar como PDF" na janela.', '');
}

function exportarPlanilha() {
  if (!app.reuniao?.itens?.length) { mostrarToast('Nada para exportar.', 'erro'); return; }
  if (typeof XLSX === 'undefined') { mostrarToast('Biblioteca de planilha não carregada.', 'erro'); return; }

  // As oito primeiras colunas são o resumo em si. As três últimas existem para
  // conferência: quem revisa consegue voltar à fonte sem reabrir o PDF.
  const cab = ['Nº', 'Proposição', 'Autoria', 'Objetivo', 'Justificativa', 'O que mudou',
               'Situação', 'Apensação e urgência', 'Comissões', 'Relatoria de Plenário', 'Parecer de Plenário', 'Emendas do Senado',
               'Cenário', 'Alertas', 'Ementa', 'Célula da lista (PDF)', 'Regime (PDF)',
               'Inteiro teor', 'Texto em votação'];
  const linhas = [cab, ...app.reuniao.itens.map(i => [
    i.numItem, [i.chave, ...etiquetasDe(i)].join(' – ') + (i.ehPrincipal ? ' (principal)' : ''),
    i.autoriaPdf || (i.autoresApi || []).join(', '),
    i.objetivo, i.justificativa, i.comparativo || '',
    i.situacao, i.apensacao || '', i.comissoes, i.relatoria, i.parecer || '', i.senado || '',
    i.cenarioNome || '', avisosDe(i) || i.erro || '',
    i.ementa, i.celulaProp || '', i.regimePdf || '', i.urlInteiroTeor || '',
    textoEmVotacao(i)?.doc?.url || '',
  ])];

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 28 }, { wch: 70 }, { wch: 70 }, { wch: 60 },
                 { wch: 34 }, { wch: 44 }, { wch: 40 }, { wch: 30 }, { wch: 50 }, { wch: 46 },
                 { wch: 34 }, { wch: 34 }, { wch: 60 }, { wch: 26 }, { wch: 24 },
                 { wch: 46 }, { wch: 46 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reunião de Líderes');

  const dia = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `reuniao-lideres-${dia}.xlsx`);
  mostrarToast('Planilha gerada.', 'sucesso');
}

// ============================================================
//  PERSISTÊNCIA (Firebase, com cópia local de segurança)
// ============================================================
async function fbSalvar(reuniao) {
  const res = await fetch(`${FIREBASE_URL}/lideres-reunioes/${reuniao.id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reuniao),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}
async function fbCarregar() {
  const res = await fetch(`${FIREBASE_URL}/lideres-reunioes.json`);
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  const d = await res.json();
  return d ? Object.values(d).filter(Boolean) : [];
}
async function fbApagar(id) {
  const res = await fetch(`${FIREBASE_URL}/lideres-reunioes/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}
async function carregarInstrucoes() {
  const res = await fetch(`${FIREBASE_URL}/lideres_instrucoes.json`);
  if (!res.ok) return;
  app.instrucoes = (await res.json()) || '';
}
async function salvarInstrucoes(texto) {
  const res = await fetch(`${FIREBASE_URL}/lideres_instrucoes.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(texto || ''),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}

const localSalvar = r => new Promise(res => chrome.storage.local.get('lideresReunioes', d => {
  const m = d.lideresReunioes || {}; m[r.id] = r;
  chrome.storage.local.set({ lideresReunioes: m }, res);
}));
const localCarregar = () => new Promise(res =>
  chrome.storage.local.get('lideresReunioes', d => res(Object.values(d.lideresReunioes || {}))));
const localApagar = id => new Promise(res => chrome.storage.local.get('lideresReunioes', d => {
  const m = d.lideresReunioes || {}; delete m[id];
  chrome.storage.local.set({ lideresReunioes: m }, res);
}));

async function salvarReuniao() {
  if (!app.reuniao) return;
  coletarEdicoes();
  app.reuniao.atualizada = new Date().toISOString();
  await localSalvar(app.reuniao);
  try {
    await fbSalvar(app.reuniao);
    mostrarToast('Reunião salva e compartilhada com a equipe.', 'sucesso');
  } catch (e) {
    mostrarToast(`Salva localmente. Firebase indisponível: ${e.message}`, 'aviso');
  }
  carregarHistorico();
}

/** O contenteditable só grava no blur; salvar com o cursor dentro de um campo
 *  perderia a última edição. */
function coletarEdicoes() {
  document.querySelectorAll('.lid-edit').forEach(el => {
    const it = app.reuniao?.itens.find(x => x.chave === el.dataset.chave);
    if (it) it[el.dataset.campo] = el.textContent.trim();
  });
}

async function carregarHistorico() {
  let reunioes = [];
  try { reunioes = await fbCarregar(); }
  catch (_) { reunioes = await localCarregar(); }
  reunioes.sort((a, b) => new Date(b.criada) - new Date(a.criada));

  const lista = document.getElementById('lista-historico');
  if (!reunioes.length) {
    lista.innerHTML = '<div class="empty-state"><p>Nenhuma reunião anterior</p></div>';
    return;
  }
  lista.innerHTML = reunioes.slice(0, 15).map(r => {
    const total = (r.itens || []).length;
    const ok = (r.itens || []).filter(i => i.status === 'ok').length;
    return `<div class="hist-item" data-id="${esc(r.id)}">
      <div class="hist-item-main">
        <div class="hist-item-titulo">${esc(r.titulo)}</div>
        <div class="hist-item-data">${total} proposições · ${ok} resumidas</div>
      </div>
      <button class="hist-item-delete" data-id="${esc(r.id)}" title="Apagar reunião">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>`;
  }).join('');

  lista.querySelectorAll('.hist-item').forEach(el => el.addEventListener('click', e => {
    if (!e.target.closest('.hist-item-delete')) restaurarReuniao(el.dataset.id, reunioes);
  }));
  lista.querySelectorAll('.hist-item-delete').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Apagar esta reunião permanentemente?')) return;
    const id = btn.dataset.id;
    try { await fbApagar(id); } catch (_) {}
    await localApagar(id);
    if (app.reuniao?.id === id) {
      app.reuniao = null;
      app.selecionados.clear();
      atualizarSidebar();
      mostrarTela('tela-upload');
      document.getElementById('lid-action-bar').style.display = 'none';
    }
    carregarHistorico();
    mostrarToast('Reunião apagada.', '');
  }));
}

function restaurarReuniao(id, reunioes) {
  const r = reunioes.find(x => x.id === id);
  if (!r) return;
  app.reuniao = { ...r, itens: (r.itens || []).map(i => ({ ...i })) };
  app.selecionados.clear();
  atualizarSidebar();
  renderizarTabela();
  mostrarTela('tela-lista');
  document.getElementById('lid-action-bar').style.display = 'flex';
  // Reunião salva antes de um campo existir não tem o dado — cura sozinha.
  completarDadosFaltantes();
}

// ---------- CURA DE REUNIÕES ANTIGAS ----------
// Os campos do Podemos (autoria, apensados, relatoria) nasceram DEPOIS de
// reuniões já consultadas na Câmara, e o "Resumir" não reconsulta quem já tem
// idCamara — então, sem isto, badge, tarja do PDF e o botão de WhatsApp
// falhavam em silêncio em reunião antiga: os campos simplesmente não existiam.
const camposNovosFaltando = it =>
  it.autoriaPodemos === undefined || it.apensadosPodemos === undefined || it.papel === undefined
  // marcada como autoria do Podemos antes de os NOMES serem guardados
  || (it.autoriaPodemos === true && it.autoresPodemos === undefined);

async function completarDadosFaltantes() {
  if (app._completando) return app._completando;      // uma cura por vez
  const alvo = (app.reuniao?.itens || []).filter(camposNovosFaltando);
  if (!alvo.length) return null;
  app._completando = (async () => {
    mostrarToast(`Reunião salva antes das marcações do Podemos — atualizando ${alvo.length} proposição(ões) na Câmara…`, '');
    let feitos = 0;
    await mapLimit(alvo, 6, async it => {
      // Recarrega os FATOS (situação, relatoria, apensação, Podemos). Os campos
      // de IA e as edições de objetivo/justificativa não são tocados.
      try { await carregarDadosDaProposicao(it); } catch (_) { /* mantém o que há */ }
      atualizarProgresso(++feitos, alvo.length, 'Atualizando dados');
    });
    atualizarProgresso(0, 0);
    coletarEdicoes();
    renderizarTabela();
    atualizarSidebar();
    mostrarToast('Marcações do Podemos atualizadas. Salve para compartilhar com a equipe.', 'sucesso');
  })().finally(() => { app._completando = null; });
  return app._completando;
}

// ============================================================
//  NAVEGAÇÃO ENTRE OS TRÊS SISTEMAS (abas)
// ============================================================
// 1 Análise da Lista · 2 Demandas de Deputados · 3 E-mail de Demandas.
// A barra lateral muda de conteúdo com a aba (seções marcadas com
// data-sistema); a barra de ações pertence só ao sistema 1. Trocar de aba
// não descarta nada: cada sistema fica exatamente como estava.
function mostrarSistema(s) {
  app.sistema = s;
  document.querySelectorAll('.lid-aba').forEach(b => b.classList.toggle('on', b.dataset.sistema === s));
  document.querySelectorAll('.sidebar-section[data-sistema]').forEach(sec => {
    sec.style.display = sec.dataset.sistema === s ? '' : 'none';
  });
  document.getElementById('btn-nova-reuniao').style.display = s === 'analise' ? '' : 'none';
  if (s === 'analise') {
    mostrarTela(app.reuniao ? 'tela-lista' : 'tela-upload');
    document.getElementById('lid-action-bar').style.display = app.reuniao ? 'flex' : 'none';
    atualizarSidebar();   // a seção PROPOSIÇÕES tem regra própria de exibição
  } else {
    document.getElementById('lid-action-bar').style.display = 'none';
    if (s === 'demandas') { mostrarTela('tela-demandas'); renderizarDemandas(); }
    else                  { mostrarTela('tela-email');    renderizarEmail(); }
  }
}

// ============================================================
//  SISTEMA 2 — DEMANDAS DE DEPUTADOS
// ============================================================
// O analista digita SÓ tratamento, deputado, proposição e natureza da
// demanda. Autoria, ementa e situação vêm dos Dados Abertos pelas MESMAS
// regras fixas do sistema 1 (situacaoDe etc.) — campo digitado à mão
// envelhece e diverge da fonte. O registro vai ao Firebase
// (lideres-demandas), compartilhado com a equipe como as reuniões.

async function fbDemandasCarregar() {
  const res = await fetch(`${FIREBASE_URL}/lideres-demandas.json`);
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
  const d = await res.json();
  return d ? Object.values(d).filter(Boolean) : [];
}
async function fbDemandaSalvar(dem) {
  const res = await fetch(`${FIREBASE_URL}/lideres-demandas/${dem.id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dem),
  });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}
async function fbDemandaApagar(id) {
  const res = await fetch(`${FIREBASE_URL}/lideres-demandas/${id}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
}

async function carregarDemandas() {
  try { app.demandas = await fbDemandasCarregar(); }
  catch (e) { console.warn('Demandas:', e.message); return; }
  app.demandas.sort((a, b) => (a.registradaEm || '').localeCompare(b.registradaEm || ''));
  if (app.sistema === 'demandas') renderizarDemandas();
  if (app.sistema === 'email')    renderizarEmail();
}

/** "PLP 78/2025", "plp78/25" → { sigla, numero, ano, chave } — ou null. */
function refDemanda(texto) {
  const m = String(texto || '').match(
    /\b(PL|PLP|PEC|PDL|PDC|PDS|PRC|PLV|PLN|MPV|MSC|PDN|INC|SUG)\s*\.?\s*n?[º°.]*\s*(\d{1,6})\s*[\/\s]\s*(\d{2,4})\b/i);
  if (!m) return null;
  let ano = parseInt(m[3], 10);
  if (m[3].length === 2) ano += ano < 50 ? 2000 : 1900;   // "…/25" digitado às pressas
  return { sigla: m[1].toUpperCase(), numero: parseInt(m[2], 10), ano,
           chave: `${m[1].toUpperCase()} ${parseInt(m[2], 10)}/${ano}` };
}

/** 1º signatário no padrão de registro da Liderança: "Bacelar PV/BA".
 *  Autor que não é deputado (Executivo, Senado) fica só com o nome. */
async function autoriaDemanda(idProp) {
  let dados = [];
  try {
    const r = await fetch(`${API_BASE}/proposicoes/${idProp}/autores`);
    if (r.ok) dados = (await r.json()).dados || [];
  } catch (_) { return ''; }
  if (!dados.length) return '';
  const ordenados = dados.slice().sort((a, b) => (a.ordemAssinatura || 99) - (b.ordemAssinatura || 99));
  const a = ordenados[0];
  const sufixo = dados.length > 1 ? ' e outros' : '';
  const m = (a.uri || '').match(/\/deputados\/(\d+)/);
  if (m) {
    const info = await infoDeputado(m[1]);
    if (info?.siglaPartido) {
      return `${a.nome || info.nome} ${info.siglaPartido}${info.siglaUf ? '/' + info.siglaUf : ''}${sufixo}`;
    }
  }
  return `${a.nome || ''}${sufixo}`.trim();
}

/** Fatos da proposição para o registro — sem IA, direto da fonte. */
async function fatosDaDemanda(ref) {
  const res = await fetch(`${API_BASE}/proposicoes?siglaTipo=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}&itens=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const item = (await res.json()).dados?.[0];
  if (!item) throw new Error(`${ref.chave} não localizada nos Dados Abertos`);
  let detalhe = item;
  try {
    const rd = await fetch(`${API_BASE}/proposicoes/${item.id}`);
    if (rd.ok) detalhe = (await rd.json()).dados || item;
  } catch (_) { /* fica com o item da lista */ }
  const [autoria, trams] = await Promise.all([autoriaDemanda(item.id), buscarTramitacoes(item.id)]);
  return {
    idCamara: item.id,
    ementa:   detalhe.ementa || item.ementa || '',
    autoria,
    situacao: situacaoDe(trams, ''),
  };
}

// ---------- Modal de registro ----------
// "Registrar" só habilita depois de "Buscar na Câmara" dar certo: demanda
// sem os fatos da fonte não entra — é a regra que impede o registro manual.
let _demandaPreparada = null;

function abrirModalNovaDemanda() {
  _demandaPreparada = null;
  ['dem-deputado', 'dem-prop', 'dem-natureza'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('dem-tratamento').value = 'Deputado';
  document.getElementById('dem-api-preview').style.display = 'none';
  document.getElementById('btn-dem-registrar').disabled = true;
  document.getElementById('modal-nova-demanda').style.display = 'flex';
  document.getElementById('dem-deputado').focus();
}

async function buscarDadosDemanda() {
  const ref = refDemanda(document.getElementById('dem-prop').value);
  if (!ref) return mostrarToast('Escreva a proposição como "PLP 78/2025".', 'erro');
  const btn  = document.getElementById('btn-dem-buscar');
  const prev = document.getElementById('dem-api-preview');
  btn.disabled = true; btn.textContent = 'Consultando…';
  try {
    const fatos = await fatosDaDemanda(ref);
    _demandaPreparada = { ...ref, ...fatos };
    prev.style.display = '';
    prev.innerHTML = `<div class="rot">${esc(ref.chave)} — dados da API da Câmara</div>
      <div class="campo-fixo">Autoria: <b>${esc(fatos.autoria || 'não informada')}</b></div>
      <div class="campo-fixo">Ementa: <b>${esc(fatos.ementa || '—')}</b></div>
      <div class="campo-fixo">Situação: <b>${esc(fatos.situacao)}</b></div>`;
    document.getElementById('btn-dem-registrar').disabled = false;
  } catch (e) {
    _demandaPreparada = null;
    prev.style.display = '';
    prev.innerHTML = `<div class="campo-fixo">Não consegui buscar: <b>${esc(e.message)}</b></div>`;
    document.getElementById('btn-dem-registrar').disabled = true;
  } finally {
    btn.disabled = false; btn.textContent = 'Buscar na Câmara';
  }
}

async function registrarDemanda() {
  const deputado = document.getElementById('dem-deputado').value.trim();
  const natureza = document.getElementById('dem-natureza').value.trim();
  if (!deputado) return mostrarToast('Informe quem demanda.', 'erro');
  if (!natureza) return mostrarToast('Informe a natureza da demanda.', 'erro');
  if (!_demandaPreparada) return mostrarToast('Busque a proposição na Câmara antes de registrar.', 'erro');
  // Se a proposição foi trocada depois da busca, os fatos não são dela.
  const refAtual = refDemanda(document.getElementById('dem-prop').value);
  if (!refAtual || refAtual.chave !== _demandaPreparada.chave) {
    return mostrarToast('A proposição mudou desde a busca — clique em "Buscar na Câmara" de novo.', 'erro');
  }
  const agora = new Date().toISOString();
  const dem = {
    id: `dem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tratamento: document.getElementById('dem-tratamento').value,
    deputado, natureza,
    ..._demandaPreparada,
    situacaoRegistro: _demandaPreparada.situacao,  // congela p/ detectar mudança depois
    registradaEm: agora, atualizadaEm: agora,
  };
  app.demandas.push(dem);
  fecharModal('modal-nova-demanda');
  renderizarDemandas();
  try {
    await fbDemandaSalvar(dem);
    mostrarToast('Demanda registrada e compartilhada com a equipe.', 'sucesso');
  } catch (e) {
    mostrarToast(`Registrada só nesta tela — Firebase indisponível: ${e.message}`, 'aviso');
  }
}

// ---------- Listagem ----------
const grupoDemanda = d => `${d.tratamento || 'Deputado'} ${d.deputado}`.trim();
// Ordem alfabética pelo NOME: comparar o rótulo inteiro poria toda "Deputada"
// antes de todo "Deputado" — MEDIDO na captura de tela do teste de layout.
const ordemPorNome = (a, b) =>
  a.replace(/^Deputad[oa] /, '').localeCompare(b.replace(/^Deputad[oa] /, ''), 'pt-BR');

function renderizarDemandas() {
  const wrap = document.getElementById('dem-wrap');
  const side = document.getElementById('dem-lista-deputados');
  if (!app.demandas.length) {
    side.innerHTML = '<div class="empty-state"><p>Nenhuma demanda registrada</p></div>';
    wrap.innerHTML = `<div class="empty-state"><p>Nenhuma demanda registrada ainda.<br>
      Use <strong>+ Nova demanda</strong> na barra lateral: você informa deputado, proposição e a natureza da demanda — autoria, ementa e situação vêm da API da Câmara.</p></div>`;
    return;
  }
  const grupos = new Map();
  for (const d of app.demandas) {
    const g = grupoDemanda(d);
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(d);
  }
  const nomes = [...grupos.keys()].sort(ordemPorNome);

  side.innerHTML = nomes.map(n => `
    <div class="dem-side-dep" data-grupo="${esc(n)}">
      <span>${esc(n.replace(/^Deputad[oa] /, ''))}</span>
      <span class="qtd">${grupos.get(n).length}</span>
    </div>`).join('');
  side.querySelectorAll('.dem-side-dep').forEach(el => el.addEventListener('click', () => {
    document.querySelector(`.dem-grupo[data-grupo="${cssEscape(el.dataset.grupo)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  wrap.innerHTML = nomes.map(n => `
    <div class="dem-grupo" data-grupo="${esc(n)}">
      <div class="dem-grupo-titulo">${esc(n)}</div>
      ${grupos.get(n).map(cardDemandaHTML).join('')}
    </div>`).join('');

  wrap.querySelectorAll('[data-acao]').forEach(btn => btn.addEventListener('click', () => {
    const d = app.demandas.find(x => x.id === btn.dataset.id);
    if (!d) return;
    if (btn.dataset.acao === 'apagar')    apagarDemanda(d);
    if (btn.dataset.acao === 'atualizar') atualizarSituacaoDemanda(d);
  }));
  // Natureza editável direto no cartão (é o único campo que é do analista;
  // os demais são da fonte e não se editam — se envelheceram, atualiza ↻).
  wrap.querySelectorAll('.dem-nat').forEach(el => el.addEventListener('blur', async () => {
    const d = app.demandas.find(x => x.id === el.dataset.id);
    const novo = el.textContent.trim();
    if (!d || !novo || novo === d.natureza) { if (d) el.textContent = d.natureza; return; }
    d.natureza = novo;
    try { await fbDemandaSalvar(d); mostrarToast('Natureza atualizada.', 'sucesso'); }
    catch (e) { mostrarToast(`Não salvou no Firebase: ${e.message}`, 'aviso'); }
  }));
}

function cardDemandaHTML(d) {
  const mudou = d.situacaoRegistro && d.situacao !== d.situacaoRegistro;
  const ficha = d.idCamara
    ? ` · <a class="lid-link" href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${d.idCamara}" target="_blank">ficha na Câmara</a>` : '';
  return `<div class="dem-card">
    <div class="dem-card-topo">
      <strong>${esc(d.chave)}</strong>
      ${mudou ? '<span class="dem-pill-mudou" title="A situação de hoje é diferente da do dia do registro">situação mudou desde o registro</span>' : ''}
      <span class="dem-card-acoes">
        <button class="dem-btn-ico" data-acao="atualizar" data-id="${esc(d.id)}" title="Reconsultar a situação na Câmara">↻</button>
        <button class="dem-btn-ico" data-acao="apagar" data-id="${esc(d.id)}" title="Apagar demanda">🗑</button>
      </span>
    </div>
    <div class="dem-campo">Natureza da demanda: <span class="dem-nat" contenteditable="true" data-id="${esc(d.id)}">${esc(d.natureza)}</span></div>
    <div class="dem-campo">Autoria: <b>${esc(d.autoria || 'não informada')}</b></div>
    <div class="dem-campo">Ementa: ${esc(d.ementa || '—')}</div>
    <div class="dem-campo">Situação: <b>${esc(d.situacao)}</b></div>
    <div class="dem-meta">Registrada em ${dataBR((d.registradaEm || '').slice(0, 10))}${ficha}</div>
  </div>`;
}

async function apagarDemanda(d) {
  if (!confirm(`Apagar a demanda de ${grupoDemanda(d)} sobre ${d.chave}?`)) return;
  app.demandas = app.demandas.filter(x => x.id !== d.id);
  app.selEmail.delete(d.id);
  renderizarDemandas();
  try { await fbDemandaApagar(d.id); }
  catch (e) { mostrarToast(`Apagada só nesta tela — Firebase indisponível: ${e.message}`, 'aviso'); }
}

/** Reconsulta a situação na Câmara; devolve true se mudou. */
async function atualizarSituacaoDemanda(d, { silencioso = false } = {}) {
  const trams = await buscarTramitacoes(d.idCamara);
  const nova = situacaoDe(trams, '');
  const mudou = nova !== d.situacao;
  if (mudou) {
    d.situacao = nova;
    d.atualizadaEm = new Date().toISOString();
    try { await fbDemandaSalvar(d); } catch (_) { /* fica na tela */ }
  }
  if (!silencioso) {
    renderizarDemandas();
    mostrarToast(mudou ? `Situação de ${d.chave} atualizada.` : `${d.chave}: situação não mudou.`, mudou ? 'sucesso' : '');
  }
  return mudou;
}

// ============================================================
//  SISTEMA 3 — E-MAIL DE DEMANDAS
// ============================================================
// Modelo do e-mail definido pela Liderança em 11/08/2026, montado por
// CÓDIGO — o mesmo princípio da mensagem do /ata: o padrão não depende de
// ninguém lembrar do modelo. Duas diferenças DELIBERADAS em relação ao
// registro do sistema 2: o e-mail NÃO agrupa por deputado demandante e NÃO
// leva a "Natureza da demanda" — quem pediu e por quê é registro interno da
// bancada; o destinatário recebe a lista de proposições prioritárias.
const EMAIL_ABERTURA =
  'Senhor Presidente,\n\n' +
  'Cumprimentando-o, remeto a lista de proposições prioritárias para a bancada do PODEMOS';

/** No e-mail a autoria vai só com o nome, como no modelo da Liderança:
 *  "Bacelar PV/BA e outros" → "Bacelar e outros". */
function autoriaSemPartido(autoria) {
  return String(autoria || '').replace(/\s+[^\s/]+\/[A-Z]{2}(?=( e outros)?$)/, '');
}

function blocoDemandaEmail(d) {
  const sit = (d.situacao || '').trim();
  return [`•\t${d.chave}`,
          `Autoria: ${autoriaSemPartido(d.autoria) || 'não informada'}`,
          `Ementa: ${d.ementa || '—'}`,
          `Situação: ${/[.!?]$/.test(sit) ? sit : sit + '.'}`].join('\n');
}

/** E-mail completo no modelo da Liderança. A assinatura vem de
 *  liderDoPodemos(); sem ela, fica o marcador para o analista preencher —
 *  nunca um nome silenciosamente errado. */
function montarEmailDemandas(demandas, assinatura) {
  return [EMAIL_ABERTURA,
          demandas.map(blocoDemandaEmail).join('\n\n'),
          `Respeitosamente,\n\n${assinatura || '<Líder do PODEMOS>'}`].join('\n\n');
}

// ---------- Assinatura: o líder do Podemos, SEMPRE da API ----------
// /partidos/{id} → status.lider é mantido pela própria Câmara; nome fixo no
// código envelheceria na primeira troca de liderança. O tratamento
// (Deputado/Deputada) vem do campo sexo da ficha — não de chute pelo nome.
let _liderCache = null;
async function liderDoPodemos() {
  if (_liderCache) return _liderCache;
  const r1 = await fetch(`${API_BASE}/partidos?sigla=${SIGLA_PODEMOS}&itens=1`);
  if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
  const partido = (await r1.json()).dados?.[0];
  if (!partido) throw new Error('partido não localizado');
  const r2 = await fetch(`${API_BASE}/partidos/${partido.id}`);
  if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
  const lider = (await r2.json()).dados?.status?.lider;
  if (!lider?.nome) throw new Error('líder não informado pela API');
  let tratamento = 'Deputado(a)';
  const m = (lider.uri || '').match(/\/deputados\/(\d+)/);
  if (m) {
    try {
      const r3 = await fetch(`${API_BASE}/deputados/${m[1]}`);
      if (r3.ok) {
        const sexo = (await r3.json()).dados?.sexo;
        if (sexo === 'F') tratamento = 'Deputada';
        else if (sexo === 'M') tratamento = 'Deputado';
      }
    } catch (_) { /* fica no neutro */ }
  }
  _liderCache = { nome: lider.nome, tratamento,
                  assinatura: `${tratamento} ${lider.nome}\nLíder do PODEMOS` };
  return _liderCache;
}

function demandasSelecionadas() {
  return app.demandas.filter(d => app.selEmail.has(d.id));
}

function renderizarEmail() {
  const side = document.getElementById('email-selecao');
  // Seleção só de demanda que ainda existe (pode ter sido apagada no sistema 2)
  app.selEmail = new Set([...app.selEmail].filter(id => app.demandas.some(d => d.id === id)));

  if (!app.demandas.length) {
    side.innerHTML = '<div class="empty-state"><p>Nenhuma demanda registrada</p></div>';
  } else {
    const grupos = new Map();
    for (const d of app.demandas) {
      const g = grupoDemanda(d);
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(d);
    }
    side.innerHTML = [...grupos.keys()].sort(ordemPorNome).map(n => `
      <div class="email-side-dep">${esc(n.replace(/^Deputad[oa] /, ''))}</div>
      ${grupos.get(n).map(d => `
        <label class="email-side-item">
          <input type="checkbox" data-id="${esc(d.id)}" ${app.selEmail.has(d.id) ? 'checked' : ''}>
          <span>${esc(d.chave)}<br><small style="color:var(--text-dim)">${esc(d.natureza)}</small></span>
        </label>`).join('')}`).join('');
    side.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) app.selEmail.add(cb.dataset.id); else app.selEmail.delete(cb.dataset.id);
      renderizarPreviaEmail();
    }));
  }
  renderizarPreviaEmail();
}

function renderizarPreviaEmail() {
  const sel    = demandasSelecionadas();
  const prev   = document.getElementById('email-preview');
  const status = document.getElementById('email-status');
  document.getElementById('btn-email-copiar').disabled = !sel.length;
  document.getElementById('btn-email-outlook').disabled = !sel.length;
  if (!sel.length) {
    status.textContent = app.demandas.length
      ? 'Nenhuma demanda selecionada' : 'Registre demandas na aba Demandas de Deputados';
    prev.textContent = 'Marque na barra lateral as demandas que devem entrar na mensagem.';
    return;
  }
  const deps = new Set(sel.map(grupoDemanda)).size;
  status.textContent = `${sel.length} demanda(s) de ${deps} deputado(s)`;
  prev.textContent = montarEmailDemandas(sel, _liderCache?.assinatura);
  // A assinatura chega da API depois do primeiro desenho; quando chegar,
  // redesenha — o marcador some sozinho.
  if (!_liderCache) liderDoPodemos().then(() => renderizarPreviaEmail()).catch(() => {});
}

async function atualizarSituacoesEmail() {
  const sel = demandasSelecionadas();
  if (!sel.length) return mostrarToast('Marque as demandas antes de atualizar.', 'erro');
  const btn = document.getElementById('btn-email-atualizar');
  btn.disabled = true;
  let mudadas = 0;
  await mapLimit(sel, 4, async d => { if (await atualizarSituacaoDemanda(d, { silencioso: true })) mudadas++; });
  btn.disabled = false;
  renderizarEmail();
  mostrarToast(mudadas
    ? `${mudadas} situação(ões) mudou(aram) desde o registro — confira os blocos.`
    : 'Nenhuma situação mudou.', mudadas ? 'aviso' : 'sucesso');
}

/** Texto final do e-mail: reconsulta a situação das selecionadas na Câmara
 *  (entre o registro e o envio a urgência pode ter sido aprovada — e-mail com
 *  situação velha é o defeito mais caro deste sistema) e busca a assinatura. */
async function prepararEmailFinal() {
  const sel = demandasSelecionadas();
  let mudadas = 0;
  try {
    await mapLimit(sel, 4, async d => { if (await atualizarSituacaoDemanda(d, { silencioso: true })) mudadas++; });
  } catch (_) { /* segue com o que há */ }
  let assinatura = _liderCache?.assinatura;
  if (!assinatura) {
    try { assinatura = (await liderDoPodemos()).assinatura; }
    catch (_) { /* fica o marcador — nunca um nome errado em silêncio */ }
  }
  renderizarEmail();
  const avisos = [];
  if (mudadas) avisos.push(`${mudadas} situação(ões) mudou(aram) desde o registro`);
  if (!assinatura) avisos.push('não consegui buscar o líder na API — a assinatura ficou como marcador');
  return { texto: montarEmailDemandas(demandasSelecionadas(), assinatura), avisos };
}

async function copiarEmailDemandas() {
  if (!demandasSelecionadas().length) return;
  const btn = document.getElementById('btn-email-copiar');
  btn.disabled = true; btn.textContent = 'Conferindo situações…';
  const { texto, avisos } = await prepararEmailFinal();
  await navigator.clipboard.writeText(texto);
  btn.disabled = false; btn.textContent = 'Copiar texto';
  mostrarToast(avisos.length
    ? `Copiado — atenção: ${avisos.join('; ')}.`
    : 'Texto copiado para a área de transferência.', avisos.length ? 'aviso' : 'sucesso');
}

// ---------- Abrir no Outlook (mailto:) ----------
// mailto: abre o CLIENTE PADRÃO da máquina (na Câmara, o Outlook) com o
// e-mail pronto — é o máximo que uma extensão consegue sem OAuth corporativo:
// ENVIAR sozinho exigiria Microsoft Graph com autorização da TI. O limite do
// mailto é o tamanho da URL (o Windows trunca na casa dos 2 mil caracteres, e
// ementa de lei estoura isso fácil); acima do limite, o corpo vai pela área
// de transferência e o Outlook abre só com o assunto — nunca truncado.
const ASSUNTO_EMAIL = 'Proposições prioritárias — bancada do PODEMOS';
const LIMITE_MAILTO = 1900;

function mailtoDoEmail(texto) {
  // Quebras como %0D%0A (RFC 6068) — só %0A alguns clientes ignoram.
  const url = `mailto:?subject=${encodeURIComponent(ASSUNTO_EMAIL)}` +
              `&body=${encodeURIComponent(String(texto).replace(/\r?\n/g, '\r\n'))}`;
  return { url, cabe: url.length <= LIMITE_MAILTO };
}

async function abrirEmailNoOutlook() {
  if (!demandasSelecionadas().length) return;
  const btn = document.getElementById('btn-email-outlook');
  btn.disabled = true;
  const { texto, avisos } = await prepararEmailFinal();
  const m = mailtoDoEmail(texto);
  if (m.cabe) {
    location.href = m.url;
  } else {
    await navigator.clipboard.writeText(texto);
    location.href = `mailto:?subject=${encodeURIComponent(ASSUNTO_EMAIL)}`;
    avisos.push('o corpo excede o limite do mailto — copiei o texto: cole no e-mail (Ctrl+V)');
  }
  btn.disabled = false;
  mostrarToast(avisos.length ? `Outlook aberto — atenção: ${avisos.join('; ')}.` : 'Outlook aberto com o e-mail pronto.',
    avisos.length ? 'aviso' : 'sucesso');
}

// ============================================================
//  CONFIGURAÇÕES (compartilhadas com os demais painéis)
// ============================================================
function carregarConfiguracao() {
  return new Promise(resolve => {
    chrome.storage.local.get('config', d => {
      if (d.config) Object.assign(app.config, d.config);
      resolve();
    });
  });
}

function onProvedorChange() {
  const p = PROVEDORES_META[document.getElementById('config-provedor').value];
  document.getElementById('config-api-key').placeholder = p.placeholderChave;
  document.getElementById('config-hint-chave').textContent = p.hintChave;
  popularSelectModelos();
}

function popularSelectModelos(selecionado) {
  const p = PROVEDORES_META[document.getElementById('config-provedor').value];
  const sel = document.getElementById('config-modelo');
  sel.innerHTML = p.modelosFallback.map(m => `<option value="${m.id}">${m.displayName}</option>`).join('');
  if (selecionado && p.modelosFallback.some(m => m.id === selecionado)) sel.value = selecionado;
  else if (app.config.modelo && p.modelosFallback.some(m => m.id === app.config.modelo)) sel.value = app.config.modelo;
}

async function carregarModelosDisponiveis() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim() || app.config.apiKey;
  const p = PROVEDORES_META[pid];
  const sel = document.getElementById('config-modelo');
  const st = document.getElementById('modelos-status');
  const btn = document.getElementById('btn-carregar-modelos');
  if (!key) { st.textContent = 'Cole a chave de API primeiro.'; st.style.color = 'var(--text-dim)'; st.style.display = 'block'; return; }
  btn.textContent = '↻ Carregando...'; btn.disabled = true; st.style.display = 'none';
  try {
    const lista = await p.listar(key);
    if (!lista.length) throw new Error('Nenhum modelo compatível encontrado.');
    const salvo = app.config.modelo;
    sel.innerHTML = lista.map(m => `<option value="${m.id}" ${m.id === salvo ? 'selected' : ''}>${m.displayName}</option>`).join('');
    if (!sel.value) sel.selectedIndex = 0;
    st.textContent = `✓ ${lista.length} modelo(s) carregado(s).`; st.style.color = '#3ad97d'; st.style.display = 'block';
  } catch (e) {
    st.textContent = `✗ ${e.message}`; st.style.color = 'var(--vermelho)'; st.style.display = 'block';
  } finally {
    btn.textContent = '↻ Carregar disponíveis'; btn.disabled = false;
  }
}

async function salvarConfiguracao() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim();
  const modelo = document.getElementById('config-modelo').value;
  const p = PROVEDORES_META[pid];
  const st = document.getElementById('config-status-ia');
  if (key && !p.regexChave.test(key)) {
    st.textContent = `⚠ Chave inválida para ${p.label}.`;
    st.className = 'config-status erro'; st.style.display = 'block';
    return;
  }
  app.config = { ...app.config, provedor: pid, apiKey: key, modelo };
  await new Promise(r => chrome.storage.local.set({ config: app.config }, r));

  const texto = document.getElementById('config-instrucoes').value.trim();
  if (texto !== (app.instrucoes || '').trim()) {
    app.instrucoes = texto;
    try { await salvarInstrucoes(texto); }
    catch (e) { mostrarToast(`Instruções não sincronizadas: ${e.message}`, 'aviso'); }
  }

  fecharModal('modal-configuracoes');
  mostrarToast(key ? 'Configurações salvas!' : 'Configurações salvas. Configure uma chave de IA para resumir.', key ? 'sucesso' : 'aviso');
}

async function testarConexao() {
  const pid = document.getElementById('config-provedor').value;
  const key = document.getElementById('config-api-key').value.trim() || app.config.apiKey;
  const modelo = document.getElementById('config-modelo').value || app.config.modelo;
  const st = document.getElementById('config-status-ia');
  const btn = document.getElementById('btn-testar-ia');
  if (!key) { st.textContent = 'Cole a chave de API antes de testar.'; st.className = 'config-status erro'; st.style.display = 'block'; return; }
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Testando...';
  st.textContent = '⏳ Testando conexão...'; st.className = 'config-status teste'; st.style.display = 'block';
  try {
    await testarProvedor(pid, key, modelo);
    st.textContent = '✓ Conexão OK — provedor pronto.'; st.className = 'config-status ok';
  } catch (e) {
    st.textContent = `✗ Erro: ${e.message}`; st.className = 'config-status erro';
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function testarProvedor(pid, key, modelo) {
  let res;
  if (pid === 'gemini') {
    res = await fetch(`${GEMINI_BASE}/${modelo || 'gemini-2.5-flash'}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Responda apenas: OK' }] }] }),
    });
  } else if (pid === 'anthropic') {
    res = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VER, 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: modelo || 'claude-opus-4-8', max_tokens: 16, messages: [{ role: 'user', content: 'Responda apenas: OK' }] }),
    });
  } else {
    res = await fetch(OPENAI_BASE, {
      method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo || 'gpt-4o', input: 'Responda apenas: OK', max_output_tokens: 64 }),
    });
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
}

async function abrirConfiguracoes() {
  const c = app.config || {};
  document.getElementById('config-provedor').value = c.provedor || 'gemini';
  document.getElementById('config-api-key').value = c.apiKey || '';
  onProvedorChange();
  popularSelectModelos(c.modelo);
  document.getElementById('config-status-ia').style.display = 'none';
  document.getElementById('modelos-status').style.display = 'none';
  document.getElementById('modal-configuracoes').style.display = 'flex';
  if (c.apiKey) carregarModelosDisponiveis();

  const ta = document.getElementById('config-instrucoes');
  const st = document.getElementById('instrucoes-status');
  st.textContent = 'Carregando…';
  try { await carregarInstrucoes(); st.textContent = ''; }
  catch (e) { st.textContent = `Não foi possível ler do Firebase: ${e.message}`; }
  ta.value = app.instrucoes || '';
}

// ============================================================
//  UTILITÁRIOS
// ============================================================
async function mapLimit(items, limit, fn) {
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${tipo}`;
  t.style.display = 'block';
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4500);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
