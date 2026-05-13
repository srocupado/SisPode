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

// Tipos de proposição que reconhecemos no PDF
const TIPOS_PROPOSICAO = [
  { sigla: 'PL',  regex: /PROJETO DE LEI\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                                 prefixo: 'PROJETO DE LEI' },
  { sigla: 'PLP', regex: /PROJETO DE LEI COMPLEMENTAR\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                    prefixo: 'PROJETO DE LEI COMPLEMENTAR' },
  { sigla: 'PEC', regex: /PROPOSTA DE EMENDA (?:À|A) CONSTITUI[ÇC][ÃA]O\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,    prefixo: 'PROPOSTA DE EMENDA À CONSTITUIÇÃO' },
  { sigla: 'PDL', regex: /PROJETO DE DECRETO LEGISLATIVO\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                  prefixo: 'PROJETO DE DECRETO LEGISLATIVO' },
  { sigla: 'MPV', regex: /MEDIDA PROVIS[ÓO]RIA\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                            prefixo: 'MEDIDA PROVISÓRIA' },
  { sigla: 'PRC', regex: /PROJETO DE RESOLU[ÇC][ÃA]O\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                       prefixo: 'PROJETO DE RESOLUÇÃO' },
];

// pdf.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
}

// ---------- PROVEDORES DE IA (listagem de modelos) ----------
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

// ---------- ESTADO ----------
const state = {
  config:    null,             // chrome.storage.local 'config'
  pauta:     null,             // { id, titulo, periodo, uploadedAt, uploadedBy, itens[], pdfBase64 }
  cacheAutoria: new Map(),     // idDeputado → { nome, siglaPartido, isPodemos }
  cacheProposicao: new Map(),  // "PL-488-2019" → { id, urlInteiroTeor, autores, apensados, relator }
};

// ============================================================
//  BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await carregarConfig();

  document.getElementById('btn-voltar').addEventListener('click', () => {
    history.length > 1 ? history.back() : window.close();
  });

  document.getElementById('input-pauta-pdf').addEventListener('change', onPdfSelecionado);
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPdf);
  document.getElementById('btn-salvar-firebase').addEventListener('click', salvarPautaManual);
  document.getElementById('btn-configuracoes').addEventListener('click', abrirConfig);

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

  // Tenta carregar a última pauta persistida
  await carregarUltimaPauta();
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
    // pdf.js transfere/desanexa o ArrayBuffer que recebe — clonamos para
    // poder também converter em base64 depois (persistência no Firebase).
    const bufParaPdf  = arrayBuffer.slice(0);
    const bufParaB64  = arrayBuffer.slice(0);
    const texto       = await extrairTextoPdf(bufParaPdf);
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
      pdfBase64:  arrayBufferToBase64(bufParaB64),
      pdfNome:    file.name,
      itens:      parsed.itens.map(normalizarItem),
    };

    renderizarPauta();
    document.getElementById('btn-exportar-pdf').disabled = false;
    document.getElementById('btn-salvar-firebase').disabled = false;

    mostrarToast(`✓ ${parsed.itens.length} itens identificados`, 'sucesso');

    // Enriquecimento assíncrono (autoria + apensados + parecer) para cada item
    enriquecerItens();

    // Persiste no Firebase em background
    fbSalvarPauta(state.pauta).catch(e => {
      console.warn('Firebase indisponível:', e.message);
      mostrarToast('⚠ Não foi possível salvar a pauta no Firebase', 'aviso');
    });
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao processar o PDF: ' + e.message, 'erro');
  }
}

async function extrairTextoPdf(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const linhas = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page    = await doc.getPage(p);
    const content = await page.getTextContent();

    // Agrupa por linha usando coordenada y, com tolerância de 2 unidades.
    // Trechos com sub/sobrescrito ou kerning podem cair em y ligeiramente
    // diferentes; sem tolerância, isso quebra "(DO SR. LUIZ ...)" em pedaços.
    const itensOrdenados = content.items.slice().sort((a, b) => b.transform[5] - a.transform[5]);
    const grupos = []; // [{ y, itens: [] }]
    for (const it of itensOrdenados) {
      const y = it.transform[5];
      let alvo = grupos.find(g => Math.abs(g.y - y) <= 2);
      if (!alvo) { alvo = { y, itens: [] }; grupos.push(alvo); }
      alvo.itens.push(it);
    }
    for (const g of grupos) {
      g.itens.sort((a, b) => a.transform[4] - b.transform[4]);
      const linha = g.itens.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (linha) linhas.push(linha);
    }
  }
  return linhas.join('\n');
}

// ============================================================
//  PARSER DA PAUTA
// ============================================================
function parsearPauta(texto) {
  const resultado = { titulo: '', periodo: '', itens: [] };

  // Período
  const periodoMatch = texto.match(/PAUTA\s+PREVISTA\s+PARA\s+([\s\S]{5,80}?)(?:\(|\n)/i);
  if (periodoMatch) resultado.periodo = periodoMatch[1].trim().replace(/\s+/g, ' ');
  resultado.titulo = resultado.periodo ? `Pauta — ${resultado.periodo}` : 'Pauta da Semana';

  // === REQUERIMENTOS DE URGÊNCIA ===
  // Padrão: "1. Requerimento nº 1.180, de 2026, dos Srs. Líderes, ... apreciação do Projeto de Lei nº 5.900, de 2025, do Sr. X..."
  // O número 1, 2... é o número de ordem na pauta.
  const reqRegex = /(\d{1,2})\.\s+Requerimento\s+n[ºo]\s*([\d.]+),\s*de\s*(\d{4})([\s\S]{0,1500}?)(?=\n\d{1,2}\.\s+Requerimento|\nURG[ÊE]NCIA|\n[A-Z][A-Z\s]{8,}\n|\Z)/gi;
  let m;
  while ((m = reqRegex.exec(texto)) !== null) {
    const ordem = parseInt(m[1], 10);
    const numero = limpaNumero(m[2]);
    const ano    = m[3];
    const bloco  = m[4];

    // Tenta identificar o projeto cujo regime de urgência está sendo pedido
    const projInternoSigla = TIPOS_PROPOSICAO.find(t => bloco.match(new RegExp(t.prefixo + '\\s+n[ºo]', 'i')));
    let proj = null;
    if (projInternoSigla) {
      const m2 = bloco.match(new RegExp(projInternoSigla.prefixo + '\\s+n[ºo]\\s*([\\d.]+)(?:-[A-Z]+)?,?\\s*de\\s*(\\d{4})', 'i'));
      if (m2) proj = { sigla: projInternoSigla.sigla, numero: limpaNumero(m2[1]), ano: m2[2] };
    }
    const autorMatch = bloco.match(/d[oa]s?\s+(Sr\.|Sra\.|Senhor|Senhora|Srs?\.?\s+L[íi]deres)[^,.]{0,80}/i);

    resultado.itens.push({
      ordem,
      tipoCategoria: 'requerimento',
      sigla:    'REQ',
      numero,
      ano,
      ementa:   bloco.replace(/\s+/g, ' ').trim().slice(0, 600),
      autorTexto: (autorMatch?.[0] || '').trim(),
      projetoUrgenciado: proj,
      apensadosTexto: [],
      relator: null,
    });
  }

  // === PROJETOS / OUTRAS PROPOSIÇÕES ===
  // Estratégia: localizar TODOS os cabeçalhos "TIPO Nº N, DE AAAA" e fatiar o
  // texto entre cabeçalhos consecutivos. Mais robusto que uma única regex com
  // lookahead complexo (que truncava blocos em sinais ambíguos).
  // Importante: tipos mais longos primeiro (PROJETO DE LEI COMPLEMENTAR antes
  // de PROJETO DE LEI) para o split por prefixo identificar a sigla correta.
  const tiposOrdenados = TIPOS_PROPOSICAO.slice().sort((a, b) => b.prefixo.length - a.prefixo.length);
  // Cabeçalhos no PDF da pauta são SEMPRE em maiúsculas. Usar match case-
  // sensitive e ancorado ao início da linha evita falsos positivos quando o
  // mesmo nome aparece em title case dentro da ementa.
  const headerRegex = new RegExp(
    `(?:^|\\n)\\s*(${tiposOrdenados.map(t => t.prefixo).join('|')})\\s+N[º]\\s*([\\d.]+)(?:-[A-Z]+)?,?\\s*DE\\s+(\\d{4})`,
    'g'
  );
  const headers = [];
  while ((m = headerRegex.exec(texto)) !== null) {
    // Posição do prefixo (não do início da linha capturado por `(?:^|\\n)\\s*`)
    const prefixoIdx = m.index + m[0].indexOf(m[1]);
    headers.push({
      idx:     prefixoIdx,
      end:     m.index + m[0].length,
      prefixo: m[1],
      numero:  limpaNumero(m[2]),
      ano:     m[3],
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const tipo = tiposOrdenados.find(t => t.prefixo === h.prefixo);
    if (!tipo) continue;

    const fim = i + 1 < headers.length ? headers[i + 1].idx : texto.length;
    const bloco = texto.slice(h.end, fim);

    // Ordem: número(s) isolado(s) antes do cabeçalho (na mesma linha ou linha acima)
    const antes = texto.slice(Math.max(0, h.idx - 60), h.idx);
    const ordemMatch = antes.match(/(?:^|\n)\s*(\d{1,3})\s*\n[^\n]*$/);
    const ordemRaw = ordemMatch ? parseInt(ordemMatch[1], 10) : null;

    const chave = `${tipo.sigla}-${h.numero}-${h.ano}`;
    if (resultado.itens.some(it => it.tipoCategoria === 'projeto' && `${it.sigla}-${it.numero}-${it.ano}` === chave)) {
      continue; // duplicata
    }

    // Autor: linha "(DO SR. X)" / "(DA SRA. X)" / "(DO SENADO FEDERAL)".
    // Permite quebras de linha entre nome e fechamento de parêntese.
    const autorMatch = bloco.match(/\(\s*(D[OA](?:S)?\s+[^()]{2,180}?)\s*\)/);
    const autorTexto = autorMatch ? autorMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Ementa: prefere o trecho "Discussão, em turno único..." até a próxima
    // seção (Pendente/Tendo/APROVADO/RELATOR). Fallback: texto inteiro do
    // bloco até essas mesmas marcações.
    let ementa = '';
    const ementaMatch = bloco.match(/Discuss[ãa]o,\s*em\s*turno[\s\S]*?(?=Pendente|Tendo\s+apens|APROVADO|RELATOR|$)/i);
    if (ementaMatch) {
      ementa = ementaMatch[0];
    } else {
      // Remove o "(autor)" do início e usa o restante
      ementa = bloco.replace(/^[\s\n]*\([^)]*\)[\s\n]*/, '').split(/Pendente|Tendo\s+apens|APROVADO|RELATOR/i)[0] || bloco;
    }
    ementa = ementa.replace(/\s+/g, ' ').trim().slice(0, 1200);

    // Apensados
    const apensadosTexto = [];
    const apensM = bloco.match(/Tendo\s+apensad[oa]s?\s*(?:\(\d+\)\s*)?(?:os?\s+)?([\s\S]*?)(?:\.\s|\n\s*APROVADO|\n\s*RELATOR|\n\s*Pendente|\n\s*$)/i);
    if (apensM) {
      const lista = apensM[1];
      const reAp = /(PLs?|PLPs?|PECs?|PDLs?|MPVs?|PRCs?)\s*([\d.]+)\s*\/\s*(\d{2,4})/gi;
      let am;
      while ((am = reAp.exec(lista)) !== null) {
        let sigla = am[1].toUpperCase().replace(/S$/, '');
        const ano2dig = am[3];
        const anoF = ano2dig.length === 2 ? (parseInt(ano2dig, 10) > 50 ? '19' + ano2dig : '20' + ano2dig) : ano2dig;
        apensadosTexto.push({ sigla, numero: limpaNumero(am[2]), ano: anoF });
      }
    }

    // Relator: pega a ÚLTIMA ocorrência (mais recente)
    const relRegex = /RELATOR(?:A)?:\s*DEP\.\s*([^()\n]+?)\s*\(([A-ZÁÀÂÃÄÉÊÍÓÔÕÚÇ]+)-([A-Z]{2})\)\s*,?\s*EM\s*(\d{2}\/\d{2}\/\d{4})/gi;
    let relator = null, rm;
    while ((rm = relRegex.exec(bloco)) !== null) {
      relator = { nome: rm[1].trim(), partido: rm[2].trim(), uf: rm[3].trim(), data: rm[4] };
    }

    const temUrgencia = /APROVADO\s+O\s+REQUERIMENTO\s+DE\s+URG[ÊE]NCIA/i.test(bloco);

    resultado.itens.push({
      ordem: ordemRaw,
      tipoCategoria: 'projeto',
      sigla:  tipo.sigla,
      numero: h.numero,
      ano:    h.ano,
      ementa,
      autorTexto,
      apensadosTexto,
      relator,
      temUrgencia,
    });
  }

  // Ordena: requerimentos antes (por ordem), depois projetos (por ordem)
  resultado.itens.sort((a, b) => {
    if (a.tipoCategoria !== b.tipoCategoria) return a.tipoCategoria === 'requerimento' ? -1 : 1;
    return (a.ordem || 999) - (b.ordem || 999);
  });

  return resultado;
}

function limpaNumero(s) {
  return (s || '').replace(/[^\d]/g, '');
}

function normalizarItem(it) {
  return {
    ...it,
    chave: `${it.sigla}-${it.numero}-${it.ano}`,
    enriquecimento: { status: 'pendente' }, // pendente | carregando | ok | erro
    analise:        null,
    analiseStatus:  'sem_analise',           // sem_analise | gerando | ok | erro
  };
}

function gerarIdPauta(periodo, fileName) {
  const semId = (periodo || fileName || 'pauta').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
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

  // Seção: Requerimentos
  const reqs = state.pauta.itens.filter(i => i.tipoCategoria === 'requerimento');
  const projs = state.pauta.itens.filter(i => i.tipoCategoria === 'projeto');

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
  const card = document.createElement('div');
  card.className = 'an-card';
  card.dataset.chave = it.chave;
  card.innerHTML = `
    <div class="an-card-head">
      <div class="an-card-num">${it.ordem ?? '–'}</div>
      <div class="an-card-info">
        <div class="an-card-tipo">${tipoLabel(it.sigla)} ${it.numero}/${it.ano}</div>
        <div class="an-card-ementa">${escapeHtml(it.ementa)}</div>
        <div class="an-card-meta">
          ${it.autorTexto ? `<span><b>Autor:</b> ${escapeHtml(it.autorTexto)}</span>` : ''}
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
    </div>
    <div class="an-analise" data-role="painel-analise">
      <div class="an-analise-head">
        <span class="an-analise-meta" data-role="analise-meta"></span>
        <button class="btn btn-outline btn-sm" data-role="btn-regerar">Regerar</button>
      </div>
      <div class="an-analise-conteudo" data-role="analise-conteudo"></div>
    </div>
  `;

  card.querySelector('[data-role=btn-gerar]').addEventListener('click', () => gerarAnaliseItem(it));
  card.querySelector('[data-role=btn-regerar]').addEventListener('click', () => gerarAnaliseItem(it, true));
  card.querySelector('[data-role=btn-toggle]').addEventListener('click', () => {
    const painel = card.querySelector('[data-role=painel-analise]');
    painel.classList.toggle('aberto');
  });
  return card;
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
      console.warn('Enriquecimento falhou para', it.chave, e);
      it.enriquecimento = { status: 'erro', erro: e.message };
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

  const prop = await resolveProposicao(alvo.sigla, alvo.numero, alvo.ano);
  it.enriquecimento.idProposicao = prop.id;
  it.enriquecimento.urlInteiroTeor = prop.urlInteiroTeor;

  // Autoria principal
  const autores = await fetchAutoresProposicao(prop.id);
  it.enriquecimento.autores = autores;
  it.enriquecimento.autoriaPodemos = autores.some(a => a.isPodemos);

  // Apensados via API
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

  // URL do parecer mais recente do relator (para projetos)
  if (it.tipoCategoria === 'projeto' && it.relator) {
    try {
      it.enriquecimento.urlParecer = await buscarUrlParecer(prop.id, it.relator);
    } catch (e) {
      console.warn('Não encontrou parecer:', e.message);
    }
  }

  it.enriquecimento.status = 'ok';
  atualizarBadgesCard(it);
}

const cacheProp = state.cacheProposicao;

async function resolveProposicao(sigla, numero, ano) {
  const ck = `${sigla}-${numero}-${ano}`;
  if (cacheProp.has(ck)) return cacheProp.get(ck);

  const url = `${API_BASE}/proposicoes?siglaTipo=${encodeURIComponent(sigla)}&numero=${numero}&ano=${ano}`;
  const json = await fetchJson(url);
  const hit  = (json.dados || [])[0];
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

async function buscarUrlParecer(idProp, relator) {
  // Busca tramitações ordenadas; procura por descrição de parecer próxima à data do relator.
  const json = await fetchJson(`${API_BASE}/proposicoes/${idProp}/tramitacoes`);
  const lista = (json.dados || []).slice().reverse(); // mais recente primeiro

  const dataAlvo = parseDataBR(relator.data);
  const candidatos = lista.filter(t => /parecer/i.test(`${t.descricaoTramitacao || ''} ${t.despacho || ''} ${t.descricaoSituacao || ''}`));

  // Preferência: mesma data exata
  let escolhido = candidatos.find(t => {
    const d = (t.dataHora || '').slice(0, 10);
    return d === dataAlvo;
  });

  // Fallback: tramitação de parecer com URL não-vazia, mais recente
  if (!escolhido) escolhido = candidatos.find(t => t.url);
  if (!escolhido) escolhido = candidatos[0];

  return escolhido?.url || null;
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

  // Apensados Podemos
  for (const ap of (enr.apensadosPodemos || [])) {
    const auts = (ap.autores || []).filter(a => a.isPodemos).map(a => a.nome).join(', ');
    const badge = document.createElement('span');
    badge.className = 'an-badge an-badge--apens';
    badge.dataset.role = 'badge-extra';
    badge.textContent = `Apensado Podemos: ${ap.siglaTipo} ${ap.numero}/${ap.ano}${auts ? ' — ' + auts : ''}`;
    cont.appendChild(badge);
  }
}

// ============================================================
//  GERAÇÃO DE ANÁLISE VIA IA
// ============================================================
async function gerarAnaliseItem(it, forcar = false) {
  await carregarConfig();
  if (!state.config?.apiKey) {
    mostrarToast('Configure a chave de API no painel principal (Configurações).', 'aviso');
    return;
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

  try {
    const urlDoc = escolherUrlDocumento(it);
    if (!urlDoc) throw new Error('Documento (parecer ou inteiro teor) não disponível na API.');

    const pdfBuffer = await baixarPdf(urlDoc);

    btnGer.innerHTML = `<span class="an-spinner"></span> Gerando análise...`;
    conteudo.innerHTML = '<div class="an-progress"><span class="an-spinner"></span> Enviando ao provedor de IA...</div>';

    const prompt   = montarPrompt(it);
    const markdown = await chamarIA({
      provedorId: state.config.provedor || 'gemini',
      apiKey:     state.config.apiKey,
      modelo:     state.config.modelo,
      prompt,
      pdfBuffer,
    });

    it.analise = {
      markdown,
      provedor:    state.config.provedor || 'gemini',
      modelo:      state.config.modelo,
      urlDocumento: urlDoc,
      geradoEm:    new Date().toISOString(),
      geradoPor:   state.config?.nomeUsuario || 'equipe',
      parecerKey:  parecerKey(it),
    };
    it.analiseStatus = 'ok';

    renderAnaliseCard(it);
    fbSalvarAnalise(it).catch(e => console.warn('Firebase save falhou:', e.message));
    mostrarToast('✓ Análise gerada', 'sucesso');
  } catch (e) {
    console.error(e);
    it.analiseStatus = 'erro';
    conteudo.innerHTML = `<div class="an-analise-erro">Erro: ${escapeHtml(e.message)}</div>`;
    btnGer.disabled = false;
    btnGer.innerHTML = iconeGerar() + ' Gerar Análise';
  }
}

function escolherUrlDocumento(it) {
  const enr = it.enriquecimento || {};
  // Projeto com parecer encontrado
  if (it.tipoCategoria === 'projeto' && enr.urlParecer) return enr.urlParecer;
  // Requerimento: inteiro teor do projeto urgenciado se houver
  return enr.urlInteiroTeor || null;
}

function parecerKey(it) {
  if (it.tipoCategoria === 'requerimento') return 'inteiro-teor';
  if (it.relator?.data) return 'parecer-' + (parseDataBR(it.relator.data) || it.relator.data);
  return 'inteiro-teor';
}

function montarPrompt(it) {
  const enr = it.enriquecimento || {};
  const apensadosPodemos = (enr.apensadosPodemos || []).map(ap => {
    const auts = (ap.autores || []).filter(a => a.isPodemos).map(a => a.nome).join(', ');
    return `- ${ap.siglaTipo} ${ap.numero}/${ap.ano}${auts ? ' (autor(es) Podemos: ' + auts + ')' : ''}`;
  }).join('\n');

  const contextoPodemos = [
    enr.autoriaPodemos ? '⚠ ATENÇÃO: O projeto principal é de autoria de deputado(a) do Podemos.' : null,
    enr.apensadosPodemos?.length ? `⚠ ATENÇÃO: Há apensado(s) de autoria Podemos:\n${apensadosPodemos}` : null,
  ].filter(Boolean).join('\n');

  const tipoDoc = it.tipoCategoria === 'requerimento'
    ? 'inteiro teor da proposição cuja urgência é solicitada'
    : `parecer mais recente do(a) relator(a) Dep. ${it.relator?.nome || ''} (${it.relator?.partido || ''}-${it.relator?.uf || ''}), de ${it.relator?.data || ''}`;

  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos na Câmara dos Deputados.

Analise o documento anexo (${tipoDoc}) referente à proposição **${tipoLabel(it.sigla)} ${it.numero}/${it.ano}**.

Ementa/descrição extraída da Pauta:
"${(it.ementa || '').slice(0, 800)}"

${contextoPodemos ? 'Contexto político:\n' + contextoPodemos + '\n' : ''}
Produza a análise em **Português do Brasil**, formato **Markdown**, em **parágrafos corridos** (sem listas com bullets, sem itens marcados com "-" ou "*"), com as seguintes seções (use exatamente esses títulos com "##"):

## Resumo da matéria
Parágrafo único explicando, em até 6 linhas, o que a proposição/parecer propõe na prática.

## Pontos centrais do parecer do relator
Um ou dois parágrafos descrevendo a posição do relator e as mudanças propostas. **Se houver substitutivo, descreva especificamente as mudanças promovidas pelo substitutivo em relação ao texto original.** **Se houver emenda(s), idem — descreva o que cada emenda altera no texto.**

## Argumentos favoráveis à aprovação
Parágrafo(s) corrido(s) apresentando a fundamentação técnica, jurídica ou de mérito que sustenta a aprovação.

## Argumentos contrários à aprovação
Parágrafo(s) corrido(s) apresentando a fundamentação técnica, jurídica ou de mérito que sustenta a rejeição.

## Riscos jurídicos / constitucionais
Parágrafo discutindo riscos identificados no documento. Caso não haja, escreva exatamente: "Sem riscos jurídicos relevantes identificados."

## Impacto orçamentário-financeiro
Parágrafo discutindo impactos identificados. Caso não haja elementos, escreva exatamente: "Sem impacto orçamentário-financeiro identificado."

## Pontos de atenção para o Podemos
Parágrafo discutindo as implicações específicas considerando o contexto político informado. Se não houver autoria Podemos nem apensado Podemos, mencione brevemente posicionamentos prováveis da bancada.

REGRAS RÍGIDAS:
- Use apenas informação contida no documento anexo. Não invente fatos.
- NÃO inclua recomendação de voto (favorável/contrário/abstenção).
- **NÃO use bullets, listas, "-", "*" ou numeração.** Toda a análise deve ser escrita em parágrafos corridos.
- Se identificar substitutivo, descreva detalhadamente as mudanças promovidas em relação ao texto original.
- Se identificar emendas, descreva o que cada emenda altera.
- Responda em texto Markdown puro, sem cercas de código \`\`\`.`;
}

// ---------- IA: chamada adaptada para resposta em Markdown ----------
async function chamarIA({ provedorId, apiKey, modelo, prompt, pdfBuffer }) {
  const base64 = arrayBufferToBase64(pdfBuffer);

  if (provedorId === 'gemini') {
    const m = modelo || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const body = {
      contents: [{ parts: [
        { inline_data: { mime_type: 'application/pdf', data: base64 } },
        { text: prompt },
      ]}],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4000 },
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `Erro HTTP ${res.status}`);
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }

  if (provedorId === 'openai') {
    const m = modelo || 'gpt-4o';
    const body = {
      model: m,
      input: [{ role: 'user', content: [
        { type: 'input_file', filename: 'documento.pdf', file_data: `data:application/pdf;base64,${base64}` },
        { type: 'input_text', text: prompt },
      ]}],
      temperature: 0.2,
      max_output_tokens: 4000,
    };
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `Erro HTTP ${res.status}`);
    for (const item of (json.output || [])) {
      for (const c of (item.content || [])) {
        if (c.type === 'output_text' && c.text) return c.text.trim();
      }
    }
    return (json.output_text || '').trim();
  }

  if (provedorId === 'anthropic') {
    const m = modelo || 'claude-sonnet-4-6';
    const body = {
      model: m,
      max_tokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: prompt },
      ]}],
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `Erro HTTP ${res.status}`);
    for (const item of (json.content || [])) {
      if (item.type === 'text' && item.text) return item.text.trim();
    }
    return '';
  }

  throw new Error(`Provedor desconhecido: ${provedorId}`);
}

async function baixarPdf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar documento (HTTP ${res.status})`);
  return await res.arrayBuffer();
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

  metaEl.innerHTML = `Gerada em ${formatDataHora(it.analise.geradoEm)} · ${it.analise.provedor}${it.analise.modelo ? ' / ' + it.analise.modelo : ''}${it.analise.urlDocumento ? ' · <a href="' + it.analise.urlDocumento + '" target="_blank" rel="noopener">documento analisado</a>' : ''}`;
  conteudo.innerHTML = renderMarkdown(it.analise.markdown);
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
//  FIREBASE — PAUTA + ANÁLISES
// ============================================================
async function fbSalvarPauta(pauta) {
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
  if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
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
}

// ============================================================
//  EXPORTAR PDF (via window.print da própria página)
// ============================================================
function exportarPdf() {
  if (!state.pauta) return;
  // Constrói uma janela "limpa" com cabeçalho + análises
  const win = window.open('', '_blank');
  if (!win) {
    mostrarToast('Permita pop-ups para exportar o PDF.', 'aviso');
    return;
  }

  const itensAnalisados = state.pauta.itens.filter(it => it.analiseStatus === 'ok');

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>${escapeHtml(state.pauta.titulo)} — Análise</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: 'DM Sans', Arial, sans-serif; color: #1a1a1a; max-width: 780px; margin: 0 auto; line-height: 1.55; font-size: 12pt; }
  h1 { font-size: 18pt; margin: 0 0 4px; color: #003c1f; }
  h2 { font-size: 14pt; margin: 18px 0 6px; color: #003c1f; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  h3 { font-size: 11pt; margin: 12px 0 4px; color: #155724; }
  .cabecalho { border-bottom: 2px solid #00A859; padding-bottom: 10px; margin-bottom: 16px; }
  .meta { font-size: 10pt; color: #555; }
  .item { page-break-inside: avoid; margin-bottom: 24px; padding-bottom: 14px; border-bottom: 1px dashed #ccc; }
  .item-titulo { font-size: 12pt; font-weight: 700; }
  .badges { margin: 4px 0 8px; font-size: 9pt; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; margin-right: 4px; font-weight: 600; }
  .badge-pode { background: #d3f5e2; color: #006633; }
  .badge-apens { background: #d8eef0; color: #02484d; }
  ul { margin: 4px 0 6px 18px; padding: 0; }
  p { margin: 4px 0; }
  .empty { color: #888; font-style: italic; }
</style></head><body>
  <div class="cabecalho">
    <h1>${escapeHtml(state.pauta.titulo)}</h1>
    <div class="meta">${escapeHtml(state.pauta.periodo || '')} · Liderança do Podemos – Câmara dos Deputados</div>
    <div class="meta">Gerado em ${formatDataHora(new Date().toISOString())}</div>
  </div>
  ${itensAnalisados.length === 0 ? '<p class="empty">Nenhuma análise gerada ainda.</p>' : ''}
  ${itensAnalisados.map(it => `
    <div class="item">
      <div class="item-titulo">${tipoLabel(it.sigla)} ${it.numero}/${it.ano} ${it.ordem ? '· item ' + it.ordem : ''}</div>
      <div class="meta">${escapeHtml(it.autorTexto || '')}${it.relator ? ' · Relator: Dep. ' + escapeHtml(it.relator.nome) + ' (' + it.relator.partido + '-' + it.relator.uf + ')' : ''}</div>
      <div class="badges">
        ${it.enriquecimento?.autoriaPodemos ? '<span class="badge badge-pode">★ Autoria Podemos</span>' : ''}
        ${(it.enriquecimento?.apensadosPodemos || []).map(ap => `<span class="badge badge-apens">Apensado Podemos: ${ap.siglaTipo} ${ap.numero}/${ap.ano}</span>`).join('')}
      </div>
      ${renderMarkdown(it.analise.markdown)}
    </div>
  `).join('')}
  <script>setTimeout(() => window.print(), 400);<\/script>
</body></html>`;

  win.document.write(html);
  win.document.close();
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
  document.getElementById('modal-configuracoes').style.display = 'flex';
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
