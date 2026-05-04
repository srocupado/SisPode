'use strict';

// ── CONSTANTES ───────────────────────────────────────────────────────────────
const API          = 'https://dadosabertos.camara.leg.br/api/v2/votacoes';
const API_DEPS     = 'https://dadosabertos.camara.leg.br/api/v2/deputados';
const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const CACHE_ROOT   = '/aderencia-cache';

// ── REFS DO DOM ───────────────────────────────────────────────────────────────
const dataIniEl   = document.getElementById('dataIni');
const dataFimEl   = document.getElementById('dataFim');
const partidoEl   = document.getElementById('partido');
const btnGerar    = document.getElementById('btnGerar');
const statusEl    = document.getElementById('status');
const resultadoEl = document.getElementById('resultado');

// ── PERÍODO PADRÃO ────────────────────────────────────────────────────────────
(function inicializarDatas() {
  const hoje     = new Date();
  const mesAtras = new Date();
  mesAtras.setDate(mesAtras.getDate() - 30);
  dataIniEl.value = mesAtras.toISOString().slice(0, 10);
  dataFimEl.value = hoje.toISOString().slice(0, 10);
})();

[dataIniEl, dataFimEl].forEach(el => {
  el.addEventListener('click', () => {
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); } catch (e) { /* ignorado */ }
    }
  });
});

document.getElementById('btn-voltar-home').addEventListener('click', () => window.close());

// ── UTILITÁRIOS GERAIS ────────────────────────────────────────────────────────
function formatarData(iso) {
  return iso.split('-').reverse().join('/');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Fetch JSON com retry em 429/5xx */
async function fetchJson(url, tentativa = 0) {
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      if ((resp.status === 429 || resp.status >= 500) && tentativa < 2) {
        await sleep(500 * (tentativa + 1));
        return fetchJson(url, tentativa + 1);
      }
      throw new Error('HTTP ' + resp.status);
    }
    return await resp.json();
  } catch (e) {
    if (tentativa < 2) {
      await sleep(500 * (tentativa + 1));
      return fetchJson(url, tentativa + 1);
    }
    throw e;
  }
}

/** Executa fn sobre items com no máximo limit promessas simultâneas */
async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let idx = 0, done = 0;
  async function worker() {
    while (idx < items.length) {
      const meu = idx++;
      try { results[meu] = await fn(items[meu], meu); }
      catch (e) { results[meu] = null; }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function normGov(o) {
  if (!o) return null;
  const t = o.toLowerCase();
  if (t === 'sim') return 'Sim';
  if (t === 'não' || t === 'nao') return 'Não';
  return null;
}

function sameVote(tipoVoto, govOrient) {
  if (!tipoVoto || !govOrient) return false;
  const t = tipoVoto.toLowerCase();
  const g = govOrient.toLowerCase();
  if (g === 'sim') return t === 'sim';
  if (g === 'não' || g === 'nao') return t === 'não' || t === 'nao';
  return false;
}

/** Classifica voto em 3 estados */
function classifyVote(tipoVoto, govOrient) {
  const t = (tipoVoto || '').toLowerCase();
  const isSimNao = t === 'sim' || t === 'não' || t === 'nao';
  if (!isSimNao) return 'ausente';
  return sameVote(tipoVoto, govOrient) ? 'aderente' : 'divergente';
}

function votoClass(tipo) {
  if (!tipo) return 'ausente';
  const t = tipo.toLowerCase();
  if (t === 'sim') return 'sim';
  if (t === 'não' || t === 'nao') return 'nao';
  if (t.includes('abst')) return 'abstencao';
  if (t.includes('art')) return 'art17';
  if (t.includes('obstr')) return 'obstrucao';
  return 'ausente';
}

function pctColor(pct) {
  return pct >= 70 ? '#3ad97d' : (pct >= 40 ? '#f0c040' : '#f05454');
}

// ── STATUS / LOADING ──────────────────────────────────────────────────────────
function showStatus(msg, tipo, progressPct) {
  if (tipo === 'loading') {
    statusEl.className = 'status';
    let html = '<div class="spinner"></div><div>' + msg + '</div>';
    if (typeof progressPct === 'number') {
      html += '<div class="progress"><div class="progress-bar" style="width:' + progressPct + '%"></div></div>';
    }
    statusEl.innerHTML = html;
  } else {
    statusEl.className = 'status' + (tipo === 'error' ? ' error' : '');
    statusEl.textContent = msg;
  }
}

function clearStatus() {
  statusEl.innerHTML = '';
  statusEl.className = 'status';
}

// ── FIREBASE CACHE ────────────────────────────────────────────────────────────
/** Sanitiza ID para chave Firebase (remove ., #, $, [, ], /) */
function sanitizeId(id) {
  return String(id).replace(/[.#$\[\]/]/g, '_');
}

/** Retorna Set com os IDs já em cache (falha silenciosa → Set vazio) */
async function cacheGetKeys() {
  try {
    const res = await fetch(FIREBASE_URL + CACHE_ROOT + '.json?shallow=true');
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set(data ? Object.keys(data) : []);
  } catch (e) {
    return new Set();
  }
}

/** Lê uma entrada do cache; retorna { votos, orientacoes } ou null */
async function cacheGet(id) {
  try {
    const res = await fetch(FIREBASE_URL + CACHE_ROOT + '/' + sanitizeId(id) + '.json');
    if (!res.ok) return null;
    const entry = await res.json();
    if (!entry) return null;
    // Descomprime formato compacto: v = array de arrays, o = array de arrays
    const votos = (entry.v || []).map(r => ({
      deputado_: { id: r[0], nome: r[1], siglaPartido: r[2], siglaUf: r[3] },
      tipoVoto:  r[4]
    }));
    const orientacoes = (entry.o || []).map(r => ({
      siglaPartidoBloco: r[0],
      orientacaoVoto:    r[1]
    }));
    return { votos, orientacoes };
  } catch (e) {
    return null;
  }
}

/** Salva uma entrada no cache (fire-and-forget — não bloqueia) */
function cacheSet(id, votos, orientacoes) {
  const entry = {
    v: (votos || []).map(v => {
      const d = v.deputado_ || {};
      return [d.id, d.nome || '', d.siglaPartido || '', d.siglaUf || '', v.tipoVoto || ''];
    }),
    o: (orientacoes || []).map(o => [o.siglaPartidoBloco || '', o.orientacaoVoto || '']),
    t: Date.now()
  };
  fetch(FIREBASE_URL + CACHE_ROOT + '/' + sanitizeId(id) + '.json', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(entry)
  }).catch(() => { /* ignorado — cache best-effort */ });
}

// ── CANVAS: DONUT ─────────────────────────────────────────────────────────────
function drawAdherenceDonut(canvas, pct, size) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = size / 2, cy = size / 2, R = size / 2 - 6;
  const matched = Math.max(0, Math.min(100, pct));

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();

  if (matched > 0) {
    const sweep = (matched / 100) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.closePath();
    ctx.fillStyle = pctColor(matched);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.62, 0, 2 * Math.PI);
  ctx.fillStyle = '#142a2f';
  ctx.fill();

  ctx.fillStyle = '#e8ecec';
  ctx.font = 'bold ' + Math.round(size * 0.18) + 'px DM Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(matched.toFixed(1) + '%', cx, cy);
}

// ── CANVAS: GRÁFICO TEMPORAL ──────────────────────────────────────────────────
/** Agrupa qualifying por semana ou mês conforme extensão do período */
function agruparPorPeriodo(qualifying, dataIni, dataFim, partySize) {
  const start   = new Date(dataIni);
  const end     = new Date(dataFim);
  const diffDias = (end - start) / 864e5;
  const porMes  = diffDias > 60;

  const buckets = {};

  qualifying.forEach(e => {
    const dt = new Date(e.votacao.dataHoraRegistro || dataIni);
    let key, label;
    if (porMes) {
      key   = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      label = dt.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    } else {
      // Semana: segunda-feira da semana ISO
      const d   = new Date(dt);
      const day = d.getDay() || 7; // 0 domingo → 7
      d.setDate(d.getDate() - day + 1);
      key   = d.toISOString().slice(0, 10);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      label = dd + '/' + mm;
    }
    if (!buckets[key]) buckets[key] = { key, label, aderiu: 0, count: 0 };
    buckets[key].aderiu += e.adherentCount;
    buckets[key].count++;
  });

  return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
}

function drawTemporalChart(canvas, groups, partySize) {
  const dpr  = window.devicePixelRatio || 1;
  const W    = canvas.parentElement ? (canvas.parentElement.clientWidth - 32) : 496;
  const H    = 160;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padL = 36, padR = 10, padT = 18, padB = 38;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n      = groups.length;
  if (n === 0) return;

  const slotW = chartW / n;
  const barW  = Math.max(6, Math.min(36, slotW * 0.6));

  ctx.clearRect(0, 0, W, H);

  // Gridlines e labels eixo Y
  [0, 50, 100].forEach(pct => {
    const y = padT + chartH * (1 - pct / 100);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillStyle    = '#5a6f74';
    ctx.font         = '9px DM Sans, sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', padL - 4, y);
  });

  // Barras
  groups.forEach((g, i) => {
    const rawPct = partySize > 0 ? (g.aderiu / partySize) * 100 : 0;
    const pct    = Math.max(0, Math.min(100, rawPct));
    const barH   = chartH * (pct / 100);
    const x      = padL + slotW * i + slotW / 2 - barW / 2;
    const yTop   = padT + chartH - barH;
    const col    = pctColor(pct);

    // fundo cinza da coluna
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(x, padT, barW, chartH);

    // barra colorida
    ctx.fillStyle = col;
    ctx.fillRect(x, yTop, barW, barH);

    // rótulo % (dentro se espaço, acima se barra pequena)
    ctx.font      = 'bold 10px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    if (barH >= 18) {
      ctx.fillStyle    = '#fff';
      ctx.textBaseline = 'top';
      ctx.fillText(Math.round(pct) + '%', x + barW / 2, yTop + 4);
    } else {
      ctx.fillStyle    = col;
      ctx.textBaseline = 'bottom';
      ctx.fillText(Math.round(pct) + '%', x + barW / 2, yTop - 2);
    }

    // rótulo eixo X (período)
    ctx.fillStyle    = '#8da3a8';
    ctx.font         = '9px DM Sans, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(g.label, x + barW / 2, H - padB + 6);

    // sub-rótulo: nº votações
    ctx.fillStyle = '#5a6f74';
    ctx.font      = '8px DM Sans, sans-serif';
    ctx.fillText(g.count + 'v', x + barW / 2, H - padB + 18);
  });
}

// ── FETCH VOTAÇÕES ────────────────────────────────────────────────────────────
async function fetchVotacoesRange(dataIni, dataFim) {
  const pages = [];
  let url = API + '?dataInicio=' + dataIni + '&dataFim=' + dataFim + '&itens=200&ordem=ASC&ordenarPor=dataHoraRegistro';
  let paginas = 0;
  while (url && paginas < 20) {
    const json = await fetchJson(url);
    pages.push(...(json.dados || []));
    const next = (json.links || []).find(l => l.rel === 'next');
    url = next ? next.href : null;
    paginas++;
  }
  return pages;
}

// ── GERAR RELATÓRIO ───────────────────────────────────────────────────────────
async function gerarRelatorio() {
  const dataIni = dataIniEl.value;
  const dataFim = dataFimEl.value;
  const sigla   = partidoEl.value.trim().toUpperCase();

  if (!dataIni || !dataFim) { showStatus('Preencha as duas datas.', 'error'); return; }
  if (dataIni > dataFim)    { showStatus('Data início posterior à data fim.', 'error'); return; }
  if (!sigla)               { showStatus('Informe a sigla do partido.', 'error'); return; }

  resultadoEl.innerHTML = '';
  btnGerar.disabled = true;
  showStatus('Buscando votações do período...', 'loading');

  try {
    // 1. Metadados das votações (leve)
    const todas = await fetchVotacoesRange(dataIni, dataFim);
    const plen  = todas.filter(v => v.siglaOrgao === 'PLEN');

    if (plen.length === 0) {
      clearStatus();
      resultadoEl.innerHTML = '<div class="status">Nenhuma votação do Plenário no período.</div>';
      return;
    }

    // 2. Verificar cache Firebase
    showStatus('Verificando cache...', 'loading');
    const cachedKeys = await cacheGetKeys();
    const emCache = plen.filter(v => cachedKeys.has(sanitizeId(v.id))).length;
    const aFetchar = plen.length - emCache;

    showStatus(
      'Carregando: ' + emCache + ' em cache · ' + aFetchar + ' da API...',
      'loading', 0
    );

    // 3. Enriquece cada votação (cache-first)
    const enriched = await mapLimit(plen, 5, async (v) => {
      const key = sanitizeId(v.id);

      if (cachedKeys.has(key)) {
        const cached = await cacheGet(v.id);
        if (cached) return { votacao: v, votos: cached.votos, orientacoes: cached.orientacoes, fromCache: true };
      }

      // Busca da API e salva no cache
      const [votosJ, orientJ] = await Promise.all([
        fetchJson(API + '/' + v.id + '/votos').catch(() => ({ dados: [] })),
        fetchJson(API + '/' + v.id + '/orientacoes').catch(() => ({ dados: [] }))
      ]);
      cacheSet(v.id, votosJ.dados, orientJ.dados);
      return { votacao: v, votos: votosJ.dados || [], orientacoes: orientJ.dados || [], fromCache: false };

    }, (done, total) => {
      showStatus(
        'Carregando: ' + emCache + ' em cache · ' + aFetchar + ' da API (' + done + '/' + total + ')...',
        'loading', (done / total) * 100
      );
    });

    // 4. Filtra qualificadas: govOrient Sim/Não e pelo menos um voto Sim/Não
    const qualifying = enriched.filter(e => {
      if (!e || e.votos.length === 0) return false;
      const temSimNao = e.votos.some(v => {
        const t = (v.tipoVoto || '').toLowerCase();
        return t === 'sim' || t === 'não' || t === 'nao';
      });
      if (!temSimNao) return false;
      const gov = e.orientacoes.find(o => o.siglaPartidoBloco === 'Governo');
      if (!gov) return false;
      const go = normGov(gov.orientacaoVoto);
      if (!go) return false;
      e.govOrient = go;
      return true;
    });

    if (qualifying.length === 0) {
      clearStatus();
      resultadoEl.innerHTML = '<div class="status">Nenhuma votação qualificada no período ' +
        '(PLEN, nominal, com orientação Sim/Não do Governo).</div>';
      return;
    }

    // 5. Bancada atual
    showStatus('Carregando bancada do ' + sigla + '...', 'loading');
    const benchJ    = await fetchJson(API_DEPS + '?siglaPartido=' + encodeURIComponent(sigla) + '&ordem=ASC&ordenarPor=nome&itens=100');
    const bench     = benchJ.dados || [];
    const partySize = bench.length;

    if (partySize === 0) {
      clearStatus();
      resultadoEl.innerHTML = '<div class="status error">Nenhum deputado encontrado para "' + sigla + '".</div>';
      return;
    }

    // 6. Métricas 3-state por votação
    qualifying.forEach(e => {
      const partyVotes = e.votos.filter(v => v.deputado_ && v.deputado_.siglaPartido === sigla);
      let aderiu = 0, divergiu = 0;
      partyVotes.forEach(v => {
        const s = classifyVote(v.tipoVoto, e.govOrient);
        if (s === 'aderente')  aderiu++;
        if (s === 'divergente') divergiu++;
      });
      e.adherentCount  = aderiu;
      e.divergentCount = divergiu;
      e.ausenteCount   = partySize - (aderiu + divergiu);
      e.partyVotes     = partyVotes;
      e.specificPct    = (aderiu / partySize) * 100;
    });

    // 7. Métricas 3-state por deputado
    const idsBancada = new Set(bench.map(d => d.id));
    const depMetrics = bench.map(dep => {
      let aderiu = 0, divergiu = 0, ausente = 0;
      qualifying.forEach(e => {
        const voto = e.votos.find(v => v.deputado_ && v.deputado_.id === dep.id);
        const s    = classifyVote(voto ? voto.tipoVoto : null, e.govOrient);
        if (s === 'aderente')   aderiu++;
        else if (s === 'divergente') divergiu++;
        else                    ausente++;
      });
      return { dep, aderiu, divergiu, ausente, pct: qualifying.length > 0 ? (aderiu / qualifying.length) * 100 : 0 };
    });
    depMetrics.sort((a, b) => b.pct - a.pct);

    // 8. Totais gerais
    const totalAderiu   = qualifying.reduce((s, e) => s + e.adherentCount,  0);
    const totalDivergiu = qualifying.reduce((s, e) => s + e.divergentCount, 0);
    const totalAusente  = qualifying.reduce((s, e) => s + e.ausenteCount,   0);
    const totalPossivel = partySize * qualifying.length;
    const overallPct    = totalPossivel > 0 ? (totalAderiu / totalPossivel) * 100 : 0;

    clearStatus();
    renderRelatorio({
      sigla, partySize, bench, idsBancada, qualifying, depMetrics,
      overallPct, totalAderiu, totalDivergiu, totalAusente, totalPossivel,
      dataIni, dataFim, emCache, aFetchar
    });

  } catch (e) {
    showStatus('Erro: ' + e.message, 'error');
    console.error(e);
  } finally {
    btnGerar.disabled = false;
  }
}

// ── RENDERIZAR RELATÓRIO ──────────────────────────────────────────────────────
function renderRelatorio(ctx) {
  window._relatorioCtx = ctx;
  const {
    sigla, partySize, qualifying, depMetrics,
    overallPct, totalAderiu, totalDivergiu, totalAusente, totalPossivel,
    dataIni, dataFim, emCache, aFetchar
  } = ctx;

  const cacheBadge = emCache > 0
    ? '<span class="cache-badge">⚡ ' + emCache + ' do cache</span>'
    : '';

  resultadoEl.innerHTML =
    // ── Card resultado geral
    '<div class="result-card">' +
      '<div class="result-title-bar">Aderência geral ao Governo' + cacheBadge + '</div>' +
      '<div class="result-body">' +
        '<div class="big-pct">' + overallPct.toFixed(1) + '<span class="sign">%</span></div>' +
        '<div class="big-label">do partido ' + sigla + '</div>' +
        '<div class="result-3state">' +
          '<div class="state-item state-aderiu"><span class="state-v">' + totalAderiu + '</span><span class="state-l">✓ Aderiu</span></div>' +
          '<div class="state-item state-divergiu"><span class="state-v">' + totalDivergiu + '</span><span class="state-l">✗ Divergiu</span></div>' +
          '<div class="state-item state-ausente"><span class="state-v">' + totalAusente + '</span><span class="state-l">— Ausente</span></div>' +
        '</div>' +
        '<div class="result-meta">' +
          '<div class="meta-item"><span class="v">' + partySize + '</span><span class="l">Deputados</span></div>' +
          '<div class="meta-item"><span class="v">' + qualifying.length + '</span><span class="l">Votações</span></div>' +
          '<div class="meta-item"><span class="v">' + totalPossivel + '</span><span class="l">Votos possíveis</span></div>' +
        '</div>' +
        '<div class="result-period">' + formatarData(dataIni) + ' a ' + formatarData(dataFim) + '</div>' +
        '<button id="btnExportar" class="export-btn" type="button"><span class="icon">⬇</span> Exportar Excel</button>' +
      '</div>' +
    '</div>' +

    // ── Gráfico temporal
    '<div class="temporal-card">' +
      '<div class="temporal-title-bar"><span>Evolução da Aderência</span><span class="temporal-sub" id="temporal-sub"></span></div>' +
      '<div class="temporal-canvas-wrap"><canvas id="temporal-canvas"></canvas></div>' +
    '</div>' +

    // ── Ranking de deputados
    '<div class="ranking-card">' +
      '<div class="ranking-title-bar">' +
        '<span>Ranking de Deputados</span>' +
        '<div class="ranking-sort-bar">' +
          '<button class="sort-btn active" data-sort="pct">Aderência ↓</button>' +
          '<button class="sort-btn" data-sort="div">Mais divergentes</button>' +
          '<button class="sort-btn" data-sort="nome">Nome A-Z</button>' +
        '</div>' +
      '</div>' +
      '<div id="rankingList"></div>' +
    '</div>' +

    // ── Lista de votações
    '<div class="list-header">Votações consideradas (' + qualifying.length + ')</div>' +
    '<div id="votingsList"></div>';

  document.getElementById('btnExportar').addEventListener('click', exportarExcel);

  // Sortable ranking
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRankingDeputados(btn.dataset.sort);
    });
  });

  // Gráfico temporal
  requestAnimationFrame(() => {
    const canvas = document.getElementById('temporal-canvas');
    const groups = agruparPorPeriodo(qualifying, dataIni, dataFim, partySize);
    const diffDias = (new Date(dataFim) - new Date(dataIni)) / 864e5;
    const subEl = document.getElementById('temporal-sub');
    if (subEl) subEl.textContent = diffDias > 60 ? 'por mês' : 'por semana';
    if (canvas && groups.length > 0) {
      drawTemporalChart(canvas, groups, partySize);
    }
  });

  renderRankingDeputados('pct');
  renderVotingsList(ctx);
}

// ── RANKING DE DEPUTADOS ──────────────────────────────────────────────────────
function renderRankingDeputados(sortKey) {
  const ctx     = window._relatorioCtx;
  const listEl  = document.getElementById('rankingList');
  if (!ctx || !listEl) return;

  const items = ctx.depMetrics.slice();
  if (sortKey === 'div')  items.sort((a, b) => b.divergiu - a.divergiu);
  if (sortKey === 'nome') items.sort((a, b) => (a.dep.nome || '').localeCompare(b.dep.nome || '', 'pt-BR'));
  // 'pct' já está ordenado por aderência desc (padrão)

  listEl.innerHTML = '';

  items.forEach((m, rank) => {
    const col    = pctColor(m.pct);
    const pctVal = m.pct.toFixed(1);

    const row = document.createElement('div');
    row.className = 'ranking-row';
    row.innerHTML =
      '<div class="ranking-summary">' +
        '<div class="rank-num">' + (rank + 1) + '</div>' +
        '<div class="rank-info">' +
          '<div class="rank-name">' + (m.dep.nome || '?') + '</div>' +
          '<div class="rank-meta">' + ctx.sigla + ' · ' + (m.dep.siglaUf || '') + '</div>' +
        '</div>' +
        '<div class="rank-counts">' +
          '<span class="rank-ade" title="Aderiu">' + m.aderiu + '✓</span>' +
          '<span class="rank-div" title="Divergiu">' + m.divergiu + '✗</span>' +
          '<span class="rank-aus" title="Ausente">' + m.ausente + '—</span>' +
        '</div>' +
        '<div class="rank-pct-wrap">' +
          '<div class="rank-pct-bar"><div class="rank-pct-fill" style="width:' + pctVal + '%;background:' + col + '"></div></div>' +
          '<span class="rank-pct-num" style="color:' + col + '">' + pctVal + '%</span>' +
        '</div>' +
        '<div class="rank-chevron">›</div>' +
      '</div>' +
      '<div class="rank-detail" id="rank-detail-' + m.dep.id + '"></div>';

    const summaryEl = row.querySelector('.ranking-summary');
    summaryEl.addEventListener('click', () => {
      const isOpen = row.classList.contains('open');
      document.querySelectorAll('.ranking-row.open').forEach(r => { if (r !== row) r.classList.remove('open'); });
      if (isOpen) {
        row.classList.remove('open');
      } else {
        row.classList.add('open');
        const detailEl = row.querySelector('.rank-detail');
        if (!detailEl.dataset.rendered) {
          detailEl.innerHTML = buildDepDetailHTML(m, ctx);
          detailEl.dataset.rendered = '1';
        }
      }
    });

    listEl.appendChild(row);
  });
}

/** Gera o HTML do histórico individual de um deputado */
function buildDepDetailHTML(m, ctx) {
  const detalhes = [];
  ctx.qualifying.forEach(e => {
    const voto     = e.votos.find(v => v.deputado_ && v.deputado_.id === m.dep.id);
    const tipoVoto = voto ? voto.tipoVoto : null;
    const status   = classifyVote(tipoVoto, e.govOrient);
    detalhes.push({ e, tipoVoto, status });
  });
  detalhes.sort((a, b) => (b.e.votacao.dataHoraRegistro || '').localeCompare(a.e.votacao.dataHoraRegistro || ''));

  let listHTML = '';
  detalhes.forEach(d => {
    const v        = d.e.votacao;
    const hora     = v.dataHoraRegistro
      ? new Date(v.dataHoraRegistro).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : '—';
    const desc     = (v.descricao || '(sem descrição)').substring(0, 140);
    const govLabel = 'Gov: ' + d.e.govOrient + ' · ' + hora;
    const markSym  = d.status === 'aderente' ? '✓' : (d.status === 'divergente' ? '✗' : '—');

    const tl = (d.tipoVoto || '').toLowerCase();
    let voteCls = 'ausente';
    if (tl === 'sim') voteCls = 'sim';
    else if (tl === 'não' || tl === 'nao') voteCls = 'nao';

    listHTML +=
      '<div class="item">' +
        '<div class="mark ' + d.status + '">' + markSym + '</div>' +
        '<div class="desc">' + desc +
          '<span class="gov">' + govLabel + '</span>' +
        '</div>' +
        '<span class="vote ' + voteCls + '">' + (d.tipoVoto || 'Ausente') + '</span>' +
      '</div>';
  });

  return '<div class="dep-individual">' +
    '<div class="dep-individual-pct">' +
      '<span class="num" style="color:' + pctColor(m.pct) + '">' + m.pct.toFixed(1) + '%</span>' +
      '<span class="lbl">Aderência ao Governo</span>' +
    '</div>' +
    '<div class="dep-individual-stats">' +
      '<div class="stat aderente"><span class="v">' + m.aderiu + '</span><span class="l">✓ Aderiu</span></div>' +
      '<div class="stat divergente"><span class="v">' + m.divergiu + '</span><span class="l">✗ Divergiu</span></div>' +
      '<div class="stat ausente"><span class="v">' + m.ausente + '</span><span class="l">— Ausente</span></div>' +
    '</div>' +
    '<div class="dep-individual-list">' + listHTML + '</div>' +
  '</div>';
}

// ── LISTA DE VOTAÇÕES ─────────────────────────────────────────────────────────
function renderVotingsList(ctx) {
  const listEl = document.getElementById('votingsList');
  if (!listEl) return;

  ctx.qualifying.forEach(e => {
    const v      = e.votacao;
    const hora   = v.dataHoraRegistro
      ? new Date(v.dataHoraRegistro).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';
    const desc     = (v.descricao || '(sem descrição)').substring(0, 180);
    const govClass = e.govOrient.toLowerCase() === 'sim' ? 'sim' : 'nao';
    const col      = pctColor(e.specificPct);

    const row = document.createElement('div');
    row.className = 'vote-row';
    row.innerHTML =
      '<div class="vote-summary">' +
        '<div class="vote-pct-mini" style="background:' + col + '22;color:' + col + ';border:2px solid ' + col + '">' +
          Math.round(e.specificPct) + '%' +
        '</div>' +
        '<div class="vote-info">' +
          '<div class="vote-desc">' + desc + '</div>' +
          '<div class="vote-sub">' +
            '<span>' + hora + '</span>' +
            '<span>Gov: <span class="gov-mini ' + govClass + '">' + e.govOrient + '</span></span>' +
            '<span class="sub-ade">' + e.adherentCount + '✓</span>' +
            '<span class="sub-div">' + e.divergentCount + '✗</span>' +
            '<span class="sub-aus">' + e.ausenteCount + '—</span>' +
          '</div>' +
        '</div>' +
        '<div class="chevron">›</div>' +
      '</div>' +
      '<div class="vote-detail"></div>';

    const summaryEl = row.querySelector('.vote-summary');
    const detailEl  = row.querySelector('.vote-detail');
    summaryEl.addEventListener('click', () => {
      const isOpen = row.classList.contains('open');
      document.querySelectorAll('.vote-row.open').forEach(r => { if (r !== row) r.classList.remove('open'); });
      if (isOpen) {
        row.classList.remove('open');
      } else {
        row.classList.add('open');
        if (!detailEl.dataset.rendered) {
          renderVoteDetail(detailEl, e, ctx);
          detailEl.dataset.rendered = '1';
        }
      }
    });

    listEl.appendChild(row);
  });
}

// ── DETALHE DE UMA VOTAÇÃO ────────────────────────────────────────────────────
function renderVoteDetail(detailEl, e, ctx) {
  const { bench } = ctx;

  const votosPorId = {};
  e.votos.forEach(v => {
    if (v.deputado_ && v.deputado_.id != null) votosPorId[v.deputado_.id] = v.tipoVoto;
  });

  const merged = bench.map(d => ({
    id: d.id, nome: d.nome, siglaUf: d.siglaUf, tipoVoto: votosPorId[d.id] || null
  }));

  const idsB = new Set(bench.map(d => d.id));
  e.partyVotes.forEach(v => {
    const dep = v.deputado_;
    if (dep && !idsB.has(dep.id)) {
      merged.push({ id: dep.id, nome: dep.nome, siglaUf: dep.siglaUf, tipoVoto: v.tipoVoto });
    }
  });
  merged.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

  let aderiu = 0, divergiu = 0, ausente = 0;
  merged.forEach(d => {
    const s = classifyVote(d.tipoVoto, e.govOrient);
    d.status = s;
    if (s === 'aderente')   aderiu++;
    else if (s === 'divergente') divergiu++;
    else                    ausente++;
  });

  const pct      = merged.length > 0 ? (aderiu / merged.length) * 100 : 0;
  const canvasId = 'det-canvas-' + e.votacao.id.replace(/[^a-zA-Z0-9]/g, '');

  let rowsHTML = '';
  merged.forEach(d => {
    const cls       = votoClass(d.tipoVoto);
    const matchCls  = d.status === 'aderente' ? 'yes' : 'no';
    const matchSym  = d.status === 'aderente' ? '✓' : (d.status === 'divergente' ? '✗' : '—');
    rowsHTML +=
      '<div class="dep-row">' +
        '<div class="match-mark ' + matchCls + '">' + matchSym + '</div>' +
        '<div class="dep-name">' + (d.nome || '?') + '<span class="dep-uf">(' + (d.siglaUf || '?') + ')</span></div>' +
        '<span class="dep-vote ' + cls + '">' + (d.tipoVoto || 'Ausente') + '</span>' +
      '</div>';
  });

  detailEl.innerHTML =
    '<div class="detail-chart">' +
      '<canvas id="' + canvasId + '"></canvas>' +
      '<div class="detail-legend">' +
        '<div class="line"><span class="dot" style="background:#3ad97d"></span><div><div class="label">Aderiu</div><div class="value" style="color:#3ad97d">' + aderiu + '</div></div></div>' +
        '<div class="line"><span class="dot" style="background:#f05454"></span><div><div class="label">Divergiu</div><div class="value" style="color:#f05454">' + divergiu + '</div></div></div>' +
        '<div class="line"><span class="dot" style="background:rgba(255,255,255,0.12)"></span><div><div class="label">Ausente</div><div class="value" style="color:#5a6f74">' + ausente + '</div></div></div>' +
      '</div>' +
    '</div>' +
    '<div class="detail-deputies">' + rowsHTML + '</div>';

  const canvas = document.getElementById(canvasId);
  if (canvas) drawAdherenceDonut(canvas, pct, 120);
}

// ── EXPORTAR EXCEL ────────────────────────────────────────────────────────────
function exportarExcel() {
  const ctx = window._relatorioCtx;
  if (!ctx) return;
  const { sigla, partySize, bench, qualifying, depMetrics, overallPct, totalAderiu, totalDivergiu, totalAusente, totalPossivel, dataIni, dataFim } = ctx;

  const wb = XLSX.utils.book_new();

  // Aba 1 — Resumo
  const resumoData = [
    ['Relatório de Aderência ao Governo'],
    [],
    ['Partido', sigla],
    ['Período', formatarData(dataIni) + ' a ' + formatarData(dataFim)],
    ['Deputados na bancada', partySize],
    ['Votações consideradas', qualifying.length],
    ['Votos possíveis', totalPossivel],
    ['Votos aderentes (✓)', totalAderiu],
    ['Votos divergentes (✗)', totalDivergiu],
    ['Ausências (—)', totalAusente],
    ['Aderência geral (%)', Number(overallPct.toFixed(2))],
    [],
    ['Critérios:'],
    ['- Apenas votações do Plenário (PLEN)'],
    ['- Apenas votações com pelo menos um voto Sim ou Não'],
    ['- Apenas votações em que o Governo orientou Sim ou Não']
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
  wsResumo['!cols'] = [{ wch: 42 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

  // Aba 2 — Ranking de Deputados
  const rankHeader = ['Posição', 'Deputado', 'UF', 'Aderiu (✓)', 'Divergiu (✗)', 'Ausente (—)', 'Aderência (%)'];
  const rankRows   = [rankHeader];
  depMetrics.slice().sort((a, b) => b.pct - a.pct).forEach((m, i) => {
    rankRows.push([i + 1, m.dep.nome || '', m.dep.siglaUf || '', m.aderiu, m.divergiu, m.ausente, Number(m.pct.toFixed(2))]);
  });
  const wsRanking = XLSX.utils.aoa_to_sheet(rankRows);
  wsRanking['!cols'] = [{ wch: 8 }, { wch: 32 }, { wch: 5 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsRanking, 'Ranking Deputados');

  // Aba 3 — Votações
  const votRows = [['Data', 'Hora', 'ID Votação', 'Descrição', 'Resultado', 'Gov', 'Aderiu', 'Divergiu', 'Ausente', 'Bancada', 'Aderência (%)']];
  qualifying.forEach(e => {
    const v      = e.votacao;
    const dt     = v.dataHoraRegistro ? new Date(v.dataHoraRegistro) : null;
    const result = v.aprovacao === 1 ? 'Aprovada' : v.aprovacao === 0 ? 'Rejeitada' : '—';
    votRows.push([
      dt ? dt.toLocaleDateString('pt-BR') : '',
      dt ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
      v.id, v.descricao || '', result, e.govOrient,
      e.adherentCount, e.divergentCount, e.ausenteCount, partySize, Number(e.specificPct.toFixed(2))
    ]);
  });
  const wsVot = XLSX.utils.aoa_to_sheet(votRows);
  wsVot['!cols'] = [{ wch: 11 }, { wch: 7 }, { wch: 14 }, { wch: 68 }, { wch: 11 }, { wch: 6 }, { wch: 9 }, { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsVot, 'Votações');

  // Aba 4 — Detalhes (deputado × votação)
  const detRows = [['Data', 'ID Votação', 'Descrição', 'Gov', 'Deputado', 'UF', 'Voto', 'Status']];
  qualifying.forEach(e => {
    const v          = e.votacao;
    const dt         = v.dataHoraRegistro ? new Date(v.dataHoraRegistro) : null;
    const data       = dt ? dt.toLocaleDateString('pt-BR') : '';
    const votosPorId = {};
    e.votos.forEach(x => {
      if (x.deputado_ && x.deputado_.id != null) votosPorId[x.deputado_.id] = x.tipoVoto;
    });
    const merged = bench.map(d => ({ ...d, tipoVoto: votosPorId[d.id] || null }));
    const idsB   = new Set(bench.map(d => d.id));
    e.partyVotes.forEach(x => {
      const dep = x.deputado_;
      if (dep && !idsB.has(dep.id)) merged.push({ id: dep.id, nome: dep.nome, siglaUf: dep.siglaUf, tipoVoto: x.tipoVoto });
    });
    merged.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    merged.forEach(d => {
      const s = classifyVote(d.tipoVoto, e.govOrient);
      const statusLabel = s === 'aderente' ? '✓ Aderiu' : (s === 'divergente' ? '✗ Divergiu' : '— Ausente');
      detRows.push([data, v.id, v.descricao || '', e.govOrient, d.nome || '', d.siglaUf || '', d.tipoVoto || 'Ausente', statusLabel]);
    });
  });
  const wsDet = XLSX.utils.aoa_to_sheet(detRows);
  wsDet['!cols'] = [{ wch: 11 }, { wch: 14 }, { wch: 60 }, { wch: 6 }, { wch: 32 }, { wch: 5 }, { wch: 12 }, { wch: 12 }];
  wsDet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalhes');

  XLSX.writeFile(wb, 'aderencia_' + sigla + '_' + dataIni + '_' + dataFim + '.xlsx');
}

// ── INICIAR ───────────────────────────────────────────────────────────────────
btnGerar.addEventListener('click', gerarRelatorio);
