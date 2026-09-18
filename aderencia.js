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
/**
 * Agrupa qualifying por semana ou mês conforme extensão do período.
 *
 * Cada balde carrega o que a barra precisa para ser uma PORCENTAGEM: os votos
 * aderentes e os votos POSSÍVEIS do período — bancada × votações do balde, o
 * mesmo denominador do número grande do topo (partySize × qualifying.length).
 * Dividir a soma de aderentes de várias votações pela bancada de UMA dava mais
 * de 100% e o clamp do desenho transformava isso em barra cheia: em agosto de
 * 2026, 38 aderências em 4 votações de uma bancada de 27 viravam "100%" sob um
 * cabeçalho que dizia 35,2%.
 */
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
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      // A chave vem das partes LOCAIS da data, como o rótulo. Com
      // toISOString() ela era convertida para UTC: no fuso de Brasília, uma
      // votação registrada às 22h caía no dia seguinte em UTC e abria um
      // segundo balde para a MESMA semana — duas barras com o mesmo rótulo.
      key   = d.getFullYear() + '-' + mm + '-' + dd;
      label = dd + '/' + mm;
    }
    if (!buckets[key]) buckets[key] = { key, label, aderiu: 0, count: 0, possiveis: 0 };
    buckets[key].aderiu += e.adherentCount;
    buckets[key].possiveis += partySize;
    buckets[key].count++;
  });

  return Object.values(buckets)
    .map(b => ({ ...b, pct: b.possiveis > 0 ? (b.aderiu / b.possiveis) * 100 : 0 }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function drawTemporalChart(canvas, groups) {
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
    // A porcentagem vem pronta de agruparPorPeriodo, sobre os votos POSSÍVEIS
    // do período. O clamp abaixo é só proteção da geometria: com o denominador
    // certo ele não tem mais o que cortar — era ele que escondia o 140% que
    // virava barra cheia.
    const rawPct = Number.isFinite(g.pct) ? g.pct : 0;
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

      // Busca da API. Marca o sucesso de cada chamada para NÃO cachear
      // resultado proveniente de falha (evita "envenenar" o cache com vazio
      // por erro temporário da API, que ficaria preso e seria descartado
      // silenciosamente nas próximas execuções).
      const [votosR, orientR] = await Promise.all([
        fetchJson(API + '/' + v.id + '/votos')
          .then(j => ({ ok: true, dados: j.dados || [] }))
          .catch(() => ({ ok: false, dados: [] })),
        fetchJson(API + '/' + v.id + '/orientacoes')
          .then(j => ({ ok: true, dados: j.dados || [] }))
          .catch(() => ({ ok: false, dados: [] }))
      ]);
      // Só grava no cache quando ambas as chamadas retornaram com sucesso.
      // Um vazio "real" (votação sem votos nominais) é legítimo e pode ser
      // cacheado; um vazio por falha de rede/HTTP não.
      if (votosR.ok && orientR.ok) cacheSet(v.id, votosR.dados, orientR.dados);
      return { votacao: v, votos: votosR.dados, orientacoes: orientR.dados, fromCache: false };

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
      drawTemporalChart(canvas, groups);
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

    // Cada item tem três coisas para dizer, e cada uma ocupa um lugar:
    //   · à esquerda, O QUE O DEPUTADO FEZ — o voto, literal ("Sim", "Não",
    //     "Obstrução", "Abstenção"), ou "—" quando não registrou voto;
    //   · embaixo, CONTRA O QUE — a orientação do governo, e a data;
    //   · à direita, O VEREDITO — aderiu, divergiu ou ausente.
    // Antes a esquerda trazia ✓/✗, que é o mesmo veredito da direita: dois
    // sinais para o mesmo significado, e o voto — o único fato da linha —
    // aparecia como SIM/NÃO onde se esperava o julgamento. Votar NÃO quando o
    // governo orientou NÃO é ADERIR, e a linha agora se lê nessa ordem.
    const veredito = d.status === 'aderente' ? 'Aderiu' : (d.status === 'divergente' ? 'Divergiu' : 'Ausente');
    const voto     = d.tipoVoto || '—';
    const votoTit  = d.tipoVoto ? 'Voto do deputado: ' + d.tipoVoto : 'Não registrou voto nesta votação';

    listHTML +=
      '<div class="item">' +
        '<div class="mark ' + votoClass(d.tipoVoto) + '" title="' + votoTit + '">' +
          '<span class="rot">Voto:</span> ' + voto +
        '</div>' +
        '<div class="item-corpo">' +
          '<div class="desc">' + desc + '</div>' +
          '<div class="gov">Governo: ' + (d.e.govOrient || '—') + ' · ' + hora + '</div>' +
        '</div>' +
        '<span class="vote ' + d.status + '">' + veredito + '</span>' +
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

// ============================================================
//  ABA 2 — COMO VOTOU O DEPUTADO
// ============================================================
// A primeira aba responde "quanto o partido X aderiu ao governo no período".
// Esta responde outra pergunta, que a assessoria faz o tempo todo e que não
// tinha ferramenta: "como o deputado Fulano votou nisto aqui?" — por
// proposição ou por período, para deputado de QUALQUER partido.
//
// Duas coisas aprendidas na apuração manual do PL 3.626/2023 e que moldam o
// código abaixo:
//
//  1. A consulta por intervalo de datas PERDE as votações do último dia. Medido
//     em 17/09/2026: 13/09 a 13/09 devolve 1 votação do Plenário; 13/09 a 14/09
//     devolve 15, todas do dia 13. Por isso se pede à API até dataFim+1 e o
//     excedente é descartado aqui.
//  2. O objeto de cada votação ("DVS do §10 do art. 23, do PSB") NÃO existe em
//     campo estruturado: objetosPossiveis e ultimaApresentacaoProposicao
//     repetem o mesmo conteúdo em todas as votações do bloco. A única fonte é o
//     texto da tramitação, lido em ordem — ver objetosDaTramitacao().

const cvEl = {
  aba:      document.getElementById('aba-consulta'),
  abaAder:  document.getElementById('aba-aderencia'),
  painel:   document.getElementById('painel-consulta'),
  painelAd: document.getElementById('painel-aderencia'),
  dep:      document.getElementById('cvDeputado'),
  escolha:  document.getElementById('cvEscolha'),
  modoProp: document.getElementById('cvModoProp'),
  modoPer:  document.getElementById('cvModoPer'),
  camposProp: document.getElementById('cvCamposProp'),
  camposPer:  document.getElementById('cvCamposPer'),
  sigla:    document.getElementById('cvSigla'),
  numero:   document.getElementById('cvNumero'),
  ano:      document.getElementById('cvAno'),
  dataIni:  document.getElementById('cvDataIni'),
  dataFim:  document.getElementById('cvDataFim'),
  buscar:   document.getElementById('cvBuscar'),
  status:   document.getElementById('cvStatus'),
  resultado: document.getElementById('cvResultado'),
};

// `completo` é tudo o que a API devolveu; `recorte` é a janela que o usuário
// escolheu mostrar; `ultimo` é o que efetivamente sai na tela e nos exports.
// A separação existe para que mudar o recorte não custe uma consulta nova — a
// tramitação inteira já está em mãos — e para que o documento possa dizer
// quanta coisa ficou de fora, que é o que impede o recorte de virar omissão.
const cv = { modo: 'proposicao', deputado: null, completo: null, recorte: null, ultimo: null };

// ---------- infra ----------
const API_PROP = 'https://dadosabertos.camara.leg.br/api/v2/proposicoes';
const API_DEP  = 'https://dadosabertos.camara.leg.br/api/v2/deputados';

function cvStatus(msg, tipo) {
  if (!msg) { cvEl.status.innerHTML = ''; cvEl.status.className = 'status'; return; }
  if (tipo === 'loading') {
    cvEl.status.className = 'status';
    cvEl.status.innerHTML = '<div class="spinner"></div><div>' + msg + '</div>';
  } else {
    cvEl.status.className = 'status' + (tipo === 'error' ? ' error' : '');
    cvEl.status.textContent = msg;
  }
}

/** Escapa para uso em HTML. */
function cvEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Um dia depois, em ISO — a correção da perda do último dia. */
function cvDiaSeguinte(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------- deputado ----------
/**
 * Procura deputados pelo nome. Devolve SEMPRE a lista: homônimo e grafia
 * parecida são resolvidos pelo usuário escolhendo, nunca por adivinhação do
 * código — nome errado aqui contamina o relatório inteiro.
 */
async function cvBuscarDeputados(nome) {
  const j = await fetchJson(API_DEP + '?nome=' + encodeURIComponent(nome) + '&ordem=ASC&ordenarPor=nome&itens=30');
  return (j.dados || []).map(d => ({ id: d.id, nome: d.nome, partido: d.siglaPartido, uf: d.siglaUf }));
}

function cvRenderEscolha(lista) {
  if (!lista.length) {
    cvEl.escolha.innerHTML = '<div class="cv-escolha cv-escolha-tit">Nenhum deputado com esse nome na legislatura atual.</div>';
    return;
  }
  cvEl.escolha.innerHTML = '<div class="cv-escolha"><div class="cv-escolha-tit">'
    + (lista.length === 1 ? 'Confirme:' : lista.length + ' deputados com esse nome — escolha:') + '</div>'
    + lista.map(d => `<button class="cv-op" data-dep="${d.id}">${cvEsc(d.nome)} <span class="p">(${cvEsc(d.partido)}-${cvEsc(d.uf)})</span></button>`).join('')
    + '</div>';
  cvEl.escolha.querySelectorAll('[data-dep]').forEach(b => {
    b.addEventListener('click', () => {
      cv.deputado = lista.find(x => String(x.id) === b.dataset.dep);
      cvRenderSelecionado();
    });
  });
}

function cvRenderSelecionado() {
  const d = cv.deputado;
  if (!d) { cvEl.escolha.innerHTML = ''; return; }
  cvEl.escolha.innerHTML = `<div class="cv-sel">✓ <b>${cvEsc(d.nome)}</b> (${cvEsc(d.partido)}-${cvEsc(d.uf)})
    <button class="x" id="cvLimparDep" title="Trocar de deputado">×</button></div>`;
  document.getElementById('cvLimparDep').addEventListener('click', () => {
    cv.deputado = null; cvEl.dep.value = ''; cvEl.escolha.innerHTML = '';
  });
}

// ---------- objeto de cada votação, lido da tramitação ----------
/**
 * Amarra cada votação ao trecho da tramitação que diz O QUE estava em votação.
 *
 * A tramitação é narrativa e vem em ordem:
 *     Votação do DTQ 1: Bloco UNIÃO (PSB): DVS do §10 do art. 23 …
 *     Encaminhou a Votação o Dep. Felipe Carreras (PSB-PE).
 *     Suprimido o texto. Sim: 222; não: 242; abstenção: 2; total: 466.
 *
 * A última linha é IDÊNTICA ao campo `descricao` da votação — é esse o gancho.
 * Achada a linha do resultado, sobe-se até a "Votação de…" mais próxima.
 *
 * Duas salvaguardas, porque objeto errado é pior que objeto nenhum:
 *  · cada linha da tramitação é consumida UMA vez, na ordem cronológica das
 *    votações — senão "Rejeitado o Requerimento." (que se repete) casaria
 *    sempre com a primeira ocorrência;
 *  · a subida para no máximo 8 linhas atrás. Passando disso, é outro assunto,
 *    e o objeto sai como não identificado.
 */
function objetosDaTramitacao(votacoes, tramitacoes) {
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const RE_OBJETO = /^Vota(ção|ções)\s+d[oa]s?\s/i;
  const linhas = (tramitacoes || []).slice().sort((a, b) => (a.sequencia || 0) - (b.sequencia || 0));
  const ordenadas = (votacoes || []).slice()
    .sort((a, b) => String(a.dataHoraRegistro || '').localeCompare(String(b.dataHoraRegistro || '')));

  const usadas = new Set();
  const mapa = {};
  for (const v of ordenadas) {
    const alvo = norm(v.descricao);
    if (!alvo) continue;
    let idx = -1;
    for (let i = 0; i < linhas.length; i++) {
      if (!usadas.has(i) && norm(linhas[i].despacho) === alvo) { idx = i; break; }
    }
    if (idx < 0) continue;
    usadas.add(idx);
    for (let i = idx - 1; i >= 0 && i > idx - 9; i--) {
      const t = norm(linhas[i].despacho);
      if (RE_OBJETO.test(t)) { mapa[v.id] = t; break; }
    }
  }
  return mapa;
}

// ---------- votos e orientações de uma votação ----------
async function cvEnriquecer(votacoes, aoAndar) {
  return mapLimit(votacoes, 5, async v => {
    const [votos, orients] = await Promise.all([
      // Atenção: /votos NÃO aceita ?itens= — devolve HTTP 400 e a leitura vira
      // "votação sem voto nominal", que é falso.
      fetchJson(API + '/' + v.id + '/votos').then(j => ({ ok: true, d: j.dados || [] })).catch(() => ({ ok: false, d: [] })),
      fetchJson(API + '/' + v.id + '/orientacoes').then(j => ({ ok: true, d: j.dados || [] })).catch(() => ({ ok: false, d: [] })),
    ]);
    const gov = (orients.d || []).find(o => /governo/i.test(o.siglaPartidoBloco || ''));
    return {
      votacao: v,
      votos: votos.d,
      falhou: !votos.ok || !orients.ok,
      nominal: votos.ok && votos.d.length > 0,
      govOrient: normGov(gov && gov.orientacaoVoto),
      orientacoes: orients.d,
    };
  }, aoAndar);
}

// ---------- as duas buscas ----------
async function cvPorProposicao(sigla, numero, ano) {
  const busca = await fetchJson(API_PROP + `?siglaTipo=${encodeURIComponent(sigla)}&numero=${encodeURIComponent(numero)}&ano=${encodeURIComponent(ano)}&itens=1`);
  const prop = (busca.dados || [])[0];
  if (!prop) throw new Error(`${sigla} ${numero}/${ano} não foi localizado na base da Câmara.`);

  // TODAS as votações da matéria, de todos os anos — PL 2.148/2015, por
  // exemplo, tem 40, entre 2023 e 2024, e as quatro décadas de tramitação de
  // uma proposição antiga cabem na mesma lista.
  //
  // NÃO passar `itens` aqui: medido em 17/09/2026, este endpoint devolve LISTA
  // VAZIA quando recebe o parâmetro — não um erro. Seria um zero silencioso, e
  // o relatório sairia dizendo que a matéria nunca foi votada.
  //
  // A paginação é seguida por precaução: hoje a API devolve tudo de uma vez
  // (conferido com 22 e com 40 votações, sem link `next`), mas se um dia
  // passar a cortar, o corte seria mudo.
  const vots = [];
  let urlV = API_PROP + '/' + prop.id + '/votacoes?ordem=ASC&ordenarPor=dataHoraRegistro';
  let pag = 0;
  while (urlV && pag < 20) {
    const j = await fetchJson(urlV);
    vots.push(...(j.dados || []));
    const next = (j.links || []).find(l => l.rel === 'next');
    urlV = next ? next.href : null;
    pag++;
  }
  if (!vots.length) return { prop, itens: [], objetos: {} };

  cvStatus(`Lendo ${vots.length} votação(ões)…`, 'loading');
  const itens = await cvEnriquecer(vots, (f, t) => cvStatus(`Lendo votações… ${f}/${t}`, 'loading'));

  // O objeto de cada votação vem do texto da tramitação — ver
  // objetosDaTramitacao. Falhar aqui não impede o resultado: os itens saem com
  // "objeto não identificado", que é honesto, em vez de sumirem.
  //
  // Nem toda votação da matéria mora na tramitação DELA: o requerimento de
  // urgência, por exemplo, é proposição própria (o PL 3.626 tem a votação
  // 2414600-8, do REQ 4322/2023). O prefixo do id da votação é o id da
  // proposição, então busca-se a tramitação de cada uma que aparecer.
  const objetos = {};
  const retirados = [];
  const porProp = new Map();
  for (const v of vots) {
    const idp = String(v.id).split('-')[0];
    if (!porProp.has(idp)) porProp.set(idp, []);
    porProp.get(idp).push(v);
  }
  for (const [idp, lista] of porProp) {
    try {
      const tram = (await fetchJson(API_PROP + '/' + idp + '/tramitacoes')).dados || [];
      Object.assign(objetos, objetosDaTramitacao(lista, tram));
      // Destaque RETIRADO não foi votado — não há voto a registrar, e é
      // justamente por isso que ele precisa ser dito: o relatório mostraria
      // menos itens que o esperado sem explicar o que aconteceu com o resto.
      for (const t of tram) {
        const d = String(t.despacho || '').replace(/\s+/g, ' ').trim();
        // A data vem junto porque o relatório pode ser recortado a um trecho da
        // tramitação: destaque retirado em dezembro não pode aparecer num
        // documento que cobre só setembro.
        if (/^Retirado o DTQ/i.test(d)) {
          retirados.push({ t: d.replace(/^Retirado o /i, ''), data: String(t.dataHora || '').slice(0, 10) });
        }
      }
    } catch (e) {
      console.warn(`[consulta] tramitação de ${idp} não lida:`, e.message);
    }
    // Votação de proposição ANEXA (o requerimento de urgência, por exemplo) não
    // tem "Votação de…" na própria narrativa — ela é apresentada e votada. Aí o
    // objeto é a proposição em si, que identifica a matéria com precisão.
    if (idp !== String(prop.id) && lista.some(v => !objetos[v.id])) {
      try {
        const p = (await fetchJson(API_PROP + '/' + idp)).dados;
        if (p) {
          const rot = `${p.siglaTipo} ${p.numero}/${p.ano}` + (p.ementa ? ' — ' + String(p.ementa).replace(/\s+/g, ' ').slice(0, 180) : '');
          for (const v of lista) if (!objetos[v.id]) objetos[v.id] = rot;
        }
      } catch (e) {
        console.warn(`[consulta] proposição ${idp} não lida:`, e.message);
      }
    }
  }
  return { prop, itens: itens.filter(Boolean), objetos, retirados };
}

async function cvPorPeriodo(dataIni, dataFim) {
  // dataFim+1: a API perde as votações do último dia do intervalo (medido em
  // 17/09/2026). Pede-se um dia a mais e descarta-se o excedente aqui.
  let url = API + '?dataInicio=' + dataIni + '&dataFim=' + cvDiaSeguinte(dataFim)
          + '&itens=200&ordem=ASC&ordenarPor=dataHoraRegistro';
  const todas = [];
  let p = 0;
  while (url && p < 40) {
    const j = await fetchJson(url);
    todas.push(...(j.dados || []));
    const next = (j.links || []).find(l => l.rel === 'next');
    url = next ? next.href : null;
    p++;
    cvStatus(`Buscando votações do período… ${todas.length}`, 'loading');
  }
  const plen = todas.filter(v => v.siglaOrgao === 'PLEN' && String(v.data) >= dataIni && String(v.data) <= dataFim);
  if (!plen.length) return { itens: [], objetos: {} };
  const itens = await cvEnriquecer(plen, (f, t) => cvStatus(`Lendo votações… ${f}/${t}`, 'loading'));

  // A consulta por período também lê a tramitação. Antes não lia, e o efeito
  // era que NENHUM item tinha objeto — o relatório saía com uma lista de
  // resultados sem dizer o que estava em votação. São poucas chamadas: as
  // votações de um período se concentram em poucas proposições (medido em
  // 18/09/2026: 20 proposições para 57 votações, ~4s).
  const objetos = await cvObjetosDeVarias(plen);
  return { itens: itens.filter(Boolean), objetos };
}

/**
 * Objetos da tramitação para um conjunto qualquer de votações, agrupando por
 * proposição — o prefixo do id da votação é o id da proposição.
 * Falha de leitura não derruba o resto: a proposição sai sem objeto.
 */
async function cvObjetosDeVarias(votacoes) {
  const porProp = new Map();
  for (const v of votacoes) {
    const idp = String(v.id).split('-')[0];
    if (!porProp.has(idp)) porProp.set(idp, []);
    porProp.get(idp).push(v);
  }
  const objetos = {};
  let lidas = 0;
  for (const [idp, lista] of porProp) {
    try {
      const tram = (await fetchJson(API_PROP + '/' + idp + '/tramitacoes')).dados || [];
      Object.assign(objetos, objetosDaTramitacao(lista, tram));
    } catch (e) {
      console.warn(`[consulta] tramitação de ${idp} não lida:`, e.message);
    }
    cvStatus(`Lendo a tramitação… ${++lidas}/${porProp.size}`, 'loading');
  }
  return objetos;
}

// ---------- links públicos de cada item ----------
/**
 * Dois links por votação, ambos derivados do que a listagem já traz — nenhuma
 * consulta a mais:
 *   · a PROPOSIÇÃO votada, pela ficha de tramitação. O prefixo do id da votação
 *     é o id da proposição, e para votação de anexa (o requerimento de urgência
 *     é proposição própria) o link vai para a anexa, que é o certo.
 *   · a SESSÃO, pela página do evento.
 *
 * NÃO existe página pública por VOTAÇÃO — procurada e não encontrada em
 * 17/09/2026, por três caminhos: camara.leg.br/votacoes/{id} devolve 404; a
 * página legada internet/votacao/mostraVotacao.asp responde 200 com o corpo
 * VAZIO (morta, e o 200 engana quem só olha o status); e
 * busca-portal/votacoes/{id} responde 200 mas renderiza, no navegador, a mesma
 * casca vazia para um id válido e para um inventado.
 *
 * Consequência de desenho, em cvAgruparLinks: como os dois links são do GRUPO
 * (a matéria, a sessão) e não do item, repeti-los em toda linha é ruído — na
 * consulta por proposição eles seriam idênticos do primeiro ao último item. O
 * link só aparece na linha quando difere do grupo; quando é um só para todos,
 * vai uma vez no cabeçalho.
 */
function cvLinks(v) {
  const idProp = String(v.id || '').split('-')[0];
  const idEvento = String(v.uriEvento || '').split('/').pop();
  return {
    prop: /^\d+$/.test(idProp)
      ? 'https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=' + idProp : null,
    rotuloProp: v.proposicaoObjeto || null,
    evento: /^\d+$/.test(idEvento)
      ? 'https://www.camara.leg.br/evento-legislativo/' + idEvento : null,
  };
}

/**
 * Separa o que é link do GRUPO do que é link da LINHA. Quando há um único
 * valor para todas as votações, ele é do grupo e sobe para o cabeçalho; quando
 * há mais de um, é informação de cada linha e fica nela.
 *
 * Na prática: consulta por proposição costuma ter uma ficha só (as exceções são
 * as proposições anexas, como o requerimento de urgência) e uma sessão por dia;
 * consulta por período tem uma proposição diferente em cada linha.
 */
function cvAgruparLinks(linhas) {
  // A ficha PREDOMINANTE é a do grupo. "Uma única ficha" seria estrito demais:
  // no PL 3.626/2023 são 21 votações da matéria e 1 do requerimento de urgência
  // — com a regra do valor único, a ficha voltaria a se repetir nas 22 linhas.
  const conta = new Map();
  for (const { it } of linhas) {
    const L = cvLinks(it.votacao);
    if (L.prop) conta.set(L.prop, (conta.get(L.prop) || 0) + 1);
  }
  let fichaComum = null, maior = 1;
  for (const [u, n] of conta) if (n > maior) { maior = n; fichaComum = u; }

  // A sessão pertence ao DIA, não ao item: entra na linha só quando muda, o que
  // na lista cronológica funciona como separador de sessão.
  const primeiraDaSessao = new Set();
  let anterior = null;
  for (const { it } of linhas) {
    const ev = cvLinks(it.votacao).evento;
    if (ev && ev !== anterior) { primeiraDaSessao.add(it.votacao.id); anterior = ev; }
  }
  return { fichaComum, primeiraDaSessao };
}

// ---------- veredito de um item para o deputado escolhido ----------
/**
 * Devolve { voto, situacao, rotulo }. As situações são quatro, e a distinção
 * entre elas é o ponto da tela:
 *   simbolica  — não houve voto nominal; a Câmara não registra voto individual.
 *                NÃO é ausência do deputado, e não entra em conta nenhuma.
 *   sem-gov    — votou, mas o governo não orientou: fica fora do cálculo de
 *                aderência, embora o voto exista e seja mostrado.
 *   ausente    — votação nominal, com orientação, e ele não votou.
 *   aderente / divergente — comparação feita.
 */
function cvSituacao(item, idDep) {
  if (!item.nominal) return { voto: null, situacao: 'simbolica' };
  const meu = item.votos.find(v => v.deputado_ && v.deputado_.id === idDep);
  const voto = meu ? meu.tipoVoto : null;
  if (!voto) return { voto: null, situacao: 'ausente' };
  if (!item.govOrient) return { voto, situacao: 'sem-gov' };
  return { voto, situacao: classifyVote(voto, item.govOrient) };
}

const CV_ROTULO = {
  aderente: 'Aderiu', divergente: 'Divergiu', ausente: 'Ausente',
  'sem-gov': 'Sem orientação', simbolica: 'Simbólica',
};
const CV_CLASSE = {
  aderente: 'aderente', divergente: 'divergente', ausente: 'ausente',
  'sem-gov': 'fora', simbolica: 'fora',
};

// ---------- recorte do relatório ----------
/** Menor e maior data do conjunto — os limites que o recorte pode assumir. */
function cvLimites(linhas) {
  const ds = linhas.map(l => String(l.it.votacao.data || '')).filter(Boolean).sort();
  return ds.length ? { ini: ds[0], fim: ds[ds.length - 1] } : { ini: '', fim: '' };
}

/** A janela em vigor e se ela é mais estreita que o conjunto inteiro. */
function cvJanela() {
  const lim = cvLimites(cv.completo.linhas);
  const r = cv.recorte && (cv.recorte.ini || cv.recorte.fim) ? cv.recorte : lim;
  return { lim, r, parcial: r.ini !== lim.ini || r.fim !== lim.fim, invertido: !!(r.ini && r.fim && r.ini > r.fim) };
}

// ---------- render ----------
/**
 * Guarda o resultado inteiro da consulta e desenha. A partir daqui, mudar o
 * recorte não refaz consulta nenhuma: cvDesenhar filtra o que já está em mãos.
 */
function cvRender(dados) {
  const dep = cv.deputado;
  const objetos = dados.objetos || {};

  // Votação cujo objeto não foi identificado na tramitação NÃO entra no
  // relatório. A linha existia com o rótulo "objeto não identificado" e só
  // ocupava espaço: o resultado registrado ("Rejeitado o Requerimento.") não
  // diz O QUE foi rejeitado, que é a única coisa que a linha precisava dizer.
  // A contagem de descartadas fica guardada, e é dita — sumir em silêncio faria
  // o total do documento divergir da ficha da Câmara sem explicação.
  const todas = dados.itens.map(it => ({ it, s: cvSituacao(it, dep.id) }));
  const linhas = todas.filter(l => objetos[l.it.votacao.id]);
  const semObjeto = todas.length - linhas.length;

  cv.completo = {
    linhas, objetos, prop: dados.prop, periodo: dados.periodo,
    dep, retirados: dados.retirados || [], semObjeto,
  };
  cv.recorte = cvLimites(linhas);
  cvDesenhar();
}

function cvDesenhar() {
  if (!cv.completo) return;
  const { objetos, prop, periodo, dep, semObjeto } = cv.completo;
  const { lim, r, parcial, invertido } = cvJanela();

  const linhas = !parcial ? cv.completo.linhas : cv.completo.linhas.filter(l => {
    const d = String(l.it.votacao.data || '');
    return (!r.ini || d >= r.ini) && (!r.fim || d <= r.fim);
  });
  const fora = cv.completo.linhas.length - linhas.length;

  // Destaque retirado tem data própria: fora do recorte, sai do documento
  // junto com as votações do mesmo trecho da tramitação. Retirado sem data
  // legível fica — some só o que se sabe que está fora.
  const retirados = !parcial ? cv.completo.retirados : cv.completo.retirados.filter(x =>
    !x.data || ((!r.ini || x.data >= r.ini) && (!r.fim || x.data <= r.fim)));

  const comum = cvAgruparLinks(linhas);
  const cont = { aderente: 0, divergente: 0, ausente: 0, 'sem-gov': 0, simbolica: 0 };
  for (const l of linhas) cont[l.s.situacao]++;
  const qualificadas = cont.aderente + cont.divergente + cont.ausente;
  const pct = (cont.aderente + cont.divergente) > 0
    ? (cont.aderente / (cont.aderente + cont.divergente)) * 100 : null;

  const falhas = linhas.filter(l => l.it.falhou).length;

  // O recorte é registrado no estado, e não só aplicado, porque o documento
  // PRECISA dizer que é recorte — senão sai um relatório que parece cobrir a
  // tramitação inteira e cobre um pedaço.
  //
  // O que define recorte é DEIXAR COISA DE FORA, não a data digitada: uma
  // janela mais larga que a tramitação (13/09/2023 a 31/12/2030) mostra tudo, e
  // aí o documento não tem ressalva nenhuma a fazer — diria "0 ficaram fora".
  const corta = fora > 0;
  cv.ultimo = { linhas, objetos, prop, periodo, dep, retirados, cont, pct, semObjeto,
                recorte: corta ? { ini: r.ini, fim: r.fim, fora, total: cv.completo.linhas.length, limites: lim } : null };

  const ctrl = cvCtrlRecorte(linhas.length, fora, lim, r, parcial, invertido);

  const cabecalho = prop
    ? `<h3>${cvEsc(prop.siglaTipo)} ${cvEsc(prop.numero)}/${cvEsc(prop.ano)}</h3>
       <div class="sub">${cvEsc(String(prop.ementa || '').slice(0, 300))}</div>`
    : `<h3>Votações do Plenário · ${formatarData(periodo[0])} a ${formatarData(periodo[1])}</h3>
       <div class="sub">Todas as votações do Plenário no período.</div>`;

  const html = `
    ${falhas ? `<div class="cv-aviso">⚠ ${falhas} votação(ões) não puderam ser lidas na API da Câmara agora.
       Elas aparecem abaixo sem voto e sem orientação — o que está faltando é a consulta, não o voto.
       Refaça a busca para tentar de novo.</div>` : ''}

    <div class="cv-cab">
      ${cabecalho}
      <div class="sub" style="margin-top:6px">
        <b>${cvEsc(dep.nome)}</b> (${cvEsc(dep.partido)}-${cvEsc(dep.uf)})
      </div>
      ${ctrl}
      <div class="cv-nums">
        <div class="cv-num"><div class="v">${linhas.length}</div><div class="l">Votações</div></div>
        <div class="cv-num"><div class="v">${linhas.length - cont.simbolica}</div><div class="l">Nominais</div></div>
        <div class="cv-num ade"><div class="v">${cont.aderente}</div><div class="l">Aderiu</div></div>
        <div class="cv-num div"><div class="v">${cont.divergente}</div><div class="l">Divergiu</div></div>
        <div class="cv-num aus"><div class="v">${cont.ausente}</div><div class="l">Ausente</div></div>
        <div class="cv-num"><div class="v">${pct == null ? '—' : pct.toFixed(1) + '%'}</div><div class="l">Aderência</div></div>
      </div>
      <div class="sub" style="margin-top:9px">
        ${semObjeto ? `${semObjeto} votação(ões) da ficha ficaram fora do relatório: a tramitação não diz o que estava em votação. ` : ''}
        ${cont.simbolica ? `${cont.simbolica} votação(ões) simbólica(s) — sem registro individual de voto, não contam como ausência. ` : ''}
        ${cont['sem-gov'] ? `${cont['sem-gov']} votação(ões) nominal(is) sem orientação do governo ficam fora do cálculo. ` : ''}
        A aderência é calculada sobre ${cont.aderente + cont.divergente} votação(ões) comparável(is),
        de ${qualificadas} qualificada(s).
      </div>
      ${comum.fichaComum ? `<div class="cv-links" style="margin-top:8px">
        <a href="${comum.fichaComum}" target="_blank" rel="noopener">Ficha da proposição ↗</a>
      </div>` : ''}
      <div class="cv-acoes">
        <button class="btn-gerar" id="cvExportarPdf" style="margin-top:0">Exportar PDF</button>
        <button class="btn-gerar" id="cvExportar" style="margin-top:0;background:rgba(255,255,255,0.06);color:var(--text-dim)">Excel</button>
      </div>
    </div>

    <div class="cv-lista">
      ${linhas.map(({ it, s }) => {
        const v = it.votacao;
        const obj = objetos[v.id];
        const data = String(v.data || '').split('-').reverse().join('/');
        const hora = String(v.dataHoraRegistro || '').slice(11, 16);
        const votoTxt = s.situacao === 'simbolica' ? '—' : (s.voto || '—');
        return `<div class="cv-item${s.situacao === 'simbolica' ? ' simbolica' : ''}">
          <div class="cv-voto${s.voto ? '' : ' ausente'}" title="${s.voto ? 'Voto do deputado: ' + cvEsc(s.voto) : (s.situacao === 'simbolica' ? 'Votação simbólica — a Câmara não registra voto individual' : 'Não registrou voto nesta votação')}">
            <span class="rot">Voto:</span> ${cvEsc(votoTxt)}
          </div>
          <div class="cv-corpo">
            <div class="cv-obj">${cvEsc(obj)}</div>
            <div class="cv-res">${cvEsc(v.descricao || '')}</div>
            <div class="cv-meta">${cvEsc(data)}${hora ? ' · ' + cvEsc(hora) : ''} · Governo: ${it.govOrient || '—'}</div>
            ${(() => { const L = cvLinks(v); const p = [];
              // Só entra o link que ACRESCENTA: o que vale para todas as
              // votações já está no cabeçalho, e repetido aqui seria ruído.
              if (L.prop && L.prop !== comum.fichaComum)
                p.push(`<a href="${L.prop}" target="_blank" rel="noopener">${cvEsc(L.rotuloProp || 'Ficha da proposição')} ↗</a>`);
              if (L.evento && comum.primeiraDaSessao.has(v.id))
                p.push(`<a href="${L.evento}" target="_blank" rel="noopener">Sessão ↗</a>`);
              return p.length ? `<div class="cv-links">${p.join('')}</div>` : '';
            })()}
          </div>
          <span class="cv-ver ${CV_CLASSE[s.situacao]}">${CV_ROTULO[s.situacao]}</span>
        </div>`;
      }).join('')}
    </div>`;

  // Recorte que não pega nada: mostra o cabeçalho e o controle, e diz o que
  // houve. Não se desenha um consolidado de zero nem se oferece exportação —
  // um PDF vazio seria um documento afirmando que o deputado não votou nada.
  const vazio = `
    <div class="cv-cab">
      ${cabecalho}
      <div class="sub" style="margin-top:6px"><b>${cvEsc(dep.nome)}</b> (${cvEsc(dep.partido)}-${cvEsc(dep.uf)})</div>
      ${ctrl}
      <div class="cv-aviso" style="margin-top:10px">${invertido
        ? 'A data inicial do recorte é posterior à final.'
        : `Nenhuma das ${cv.completo.linhas.length} votações da consulta cai nesse recorte.`}
        As votações continuam carregadas — alargue o recorte ou clique em <b>Tudo</b>.</div>
    </div>`;

  cvEl.resultado.innerHTML = linhas.length ? html : vazio;
  cvLigarRecorte();
  const btn = document.getElementById('cvExportar');
  if (btn) btn.addEventListener('click', cvExportar);
  const btnPdf = document.getElementById('cvExportarPdf');
  if (btnPdf) btnPdf.addEventListener('click', cvExportarPDF);
}

/** A faixa de recorte, redesenhada junto com o resultado. */
function cvCtrlRecorte(mostradas, fora, lim, r, parcial, invertido) {
  if (!lim.ini) return '';
  return `<div class="cv-recorte">
    <span class="rl">Recorte do relatório</span>
    <input type="date" id="cvRecIni" value="${cvEsc(r.ini)}" min="${cvEsc(lim.ini)}" max="${cvEsc(lim.fim)}">
    <span class="ate">a</span>
    <input type="date" id="cvRecFim" value="${cvEsc(r.fim)}" min="${cvEsc(lim.ini)}" max="${cvEsc(lim.fim)}">
    <button id="cvRecTudo"${parcial ? '' : ' disabled'}>Tudo</button>
    <span class="cnt${fora > 0 ? ' ativo' : ''}">${invertido
      ? 'intervalo invertido'
      : (fora > 0
        ? `${mostradas} de ${mostradas + fora} votações — ${fora} fora do recorte`
        : `${mostradas} votação(ões), de ${formatarData(lim.ini)} a ${formatarData(lim.fim)}`)}</span>
  </div>`;
}

/** Religa os campos do recorte depois de cada redesenho. */
function cvLigarRecorte() {
  const ini = document.getElementById('cvRecIni');
  const fim = document.getElementById('cvRecFim');
  const tudo = document.getElementById('cvRecTudo');
  if (!ini || !fim) return;
  const aplicar = () => { cv.recorte = { ini: ini.value, fim: fim.value }; cvDesenhar(); };
  ini.addEventListener('change', aplicar);
  fim.addEventListener('change', aplicar);
  if (tudo) tudo.addEventListener('click', () => { cv.recorte = cvLimites(cv.completo.linhas); cvDesenhar(); });
}

function cvExportar() {
  if (!cv.ultimo) return;
  const { linhas, objetos, prop, periodo, dep, recorte } = cv.ultimo;
  const rows = [];
  // A planilha abre dizendo que é recorte. Sem isso, um arquivo com 7 linhas
  // passa por ser a matéria inteira assim que sai da tela que o recortou.
  if (recorte) {
    rows.push([`RECORTE: ${formatarData(recorte.ini)} a ${formatarData(recorte.fim)} — `
      + `${recorte.fora} de ${recorte.total} votação(ões) da consulta ficaram fora desta planilha `
      + `(tudo: ${formatarData(recorte.limites.ini)} a ${formatarData(recorte.limites.fim)}).`]);
    rows.push([]);
  }
  rows.push(['Data', 'Hora', 'Votação', 'Objeto (tramitação)', 'Resultado registrado',
              'Voto do deputado', 'Orientação do Governo', 'Situação',
              'Ficha da proposição', 'Sessão']);
  for (const { it, s } of linhas) {
    const v = it.votacao;
    rows.push([
      String(v.data || '').split('-').reverse().join('/'),
      String(v.dataHoraRegistro || '').slice(11, 16),
      v.id,
      objetos[v.id],
      v.descricao || '',
      s.situacao === 'simbolica' ? 'votação simbólica' : (s.voto || 'não votou'),
      it.govOrient || '',
      CV_ROTULO[s.situacao],
      cvLinks(v).prop || '',
      cvLinks(v).evento || '',
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 11 }, { wch: 6 }, { wch: 14 }, { wch: 70 }, { wch: 70 }, { wch: 16 }, { wch: 18 }, { wch: 15 },
                 { wch: 62 }, { wch: 46 }];
  ws['!freeze'] = { xSplit: 0, ySplit: recorte ? 3 : 1 };
  XLSX.utils.book_append_sheet(wb, ws, 'Votos');
  const alvo = prop ? `${prop.siglaTipo}${prop.numero}-${prop.ano}` : `${periodo[0]}_${periodo[1]}`;
  const corte = recorte ? `_recorte-${recorte.ini}_${recorte.fim}` : '';
  XLSX.writeFile(wb, `votos_${dep.nome.replace(/\s+/g, '-')}_${alvo}${corte}.xlsx`);
}

// ---------- fluxo ----------
async function cvConsultar() {
  if (!cv.deputado) { cvStatus('Escolha o(a) deputado(a) primeiro.', 'error'); return; }
  cvEl.resultado.innerHTML = '';
  cvEl.buscar.disabled = true;
  try {
    let dados;
    if (cv.modo === 'proposicao') {
      const sigla  = cvEl.sigla.value.trim().toUpperCase();
      const numero = cvEl.numero.value.trim();
      const ano    = cvEl.ano.value.trim();
      if (!sigla || !numero || !ano) throw new Error('Informe sigla, número e ano da proposição.');
      cvStatus('Localizando a proposição…', 'loading');
      dados = await cvPorProposicao(sigla, numero, ano);
      if (!dados.itens.length) { cvStatus(`${sigla} ${numero}/${ano} não tem votação registrada na Câmara.`, 'error'); return; }
    } else {
      const ini = cvEl.dataIni.value, fim = cvEl.dataFim.value;
      if (!ini || !fim) throw new Error('Informe as duas datas.');
      if (ini > fim) throw new Error('A data inicial é posterior à final.');
      cvStatus('Buscando votações do período…', 'loading');
      dados = await cvPorPeriodo(ini, fim);
      dados.periodo = [ini, fim];
      if (!dados.itens.length) { cvStatus('Nenhuma votação do Plenário nesse período.', 'error'); return; }
    }
    cvStatus('');
    cvRender(dados);
  } catch (e) {
    cvStatus('Erro: ' + e.message, 'error');
    console.error(e);
  } finally {
    cvEl.buscar.disabled = false;
  }
}

function cvTrocarAba(qual) {
  const consulta = qual === 'consulta';
  cvEl.painel.hidden   = !consulta;
  cvEl.painelAd.hidden = consulta;
  cvEl.aba.classList.toggle('ativa', consulta);
  cvEl.abaAder.classList.toggle('ativa', !consulta);
}

function cvTrocarModo(modo) {
  cv.modo = modo;
  const prop = modo === 'proposicao';
  cvEl.camposProp.hidden = !prop;
  cvEl.camposPer.hidden  = prop;
  cvEl.modoProp.classList.toggle('ativo', prop);
  cvEl.modoPer.classList.toggle('ativo', !prop);
}

// Registro de eventos com guarda: um id ausente (pasta de extensão atualizada
// pela metade) não pode matar o resto da tela — é o defeito que o teste da home
// do painel existe para impedir.
if (cvEl.aba && cvEl.painel) {
  cvEl.aba.addEventListener('click', () => cvTrocarAba('consulta'));
  cvEl.abaAder.addEventListener('click', () => cvTrocarAba('aderencia'));
  cvEl.modoProp.addEventListener('click', () => cvTrocarModo('proposicao'));
  cvEl.modoPer.addEventListener('click', () => cvTrocarModo('periodo'));
  cvEl.buscar.addEventListener('click', cvConsultar);

  let tBusca = null;
  cvEl.dep.addEventListener('input', () => {
    cv.deputado = null;
    const nome = cvEl.dep.value.trim();
    clearTimeout(tBusca);
    if (nome.length < 3) { cvEl.escolha.innerHTML = ''; return; }
    tBusca = setTimeout(async () => {
      try {
        cvRenderEscolha(await cvBuscarDeputados(nome));
      } catch (e) {
        // Falha de consulta NÃO é "não existe deputado com esse nome".
        cvEl.escolha.innerHTML = '<div class="cv-escolha cv-escolha-tit">Não consegui consultar o cadastro da Câmara agora ('
          + cvEsc(e.message) + '). Tente de novo.</div>';
      }
    }, 400);
  });

  [cvEl.dataIni, cvEl.dataFim].forEach(el => {
    el.addEventListener('click', () => { if (typeof el.showPicker === 'function') { try { el.showPicker(); } catch (_) {} } });
  });
  const hoje = new Date(), mesAtras = new Date();
  mesAtras.setDate(mesAtras.getDate() - 30);
  cvEl.dataIni.value = mesAtras.toISOString().slice(0, 10);
  cvEl.dataFim.value = hoje.toISOString().slice(0, 10);
}

// ---------- exportação em PDF ----------
// O layout é o do documento de conferência que a assessoria já usa: cabeçalho
// institucional, consolidado, a nota de "como ler" (que é o que impede a
// contagem de ser mal interpretada), as votações agrupadas por sessão, os
// destaques retirados e a procedência dos dados.
//
// Impressão pelo paged.js, como nos demais módulos: ele resolve o número de
// página do rodapé e avisa quando terminou de montar. Sem ele, imprime mesmo
// assim — só sem numeração.

const CSS_PDF_VOTOS = `
  @page { size: A4; margin: 15mm 14mm; @bottom-center { content: counter(page); font-size: 8pt; color: #888; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #1a1a1a; background: #fff; }
  .cab { display: flex; align-items: center; gap: 14px; }
  .cab .tit { flex: 1; text-align: center; }
  .cab h1 { font-size: 15pt; color: #003c1f; }
  .cab .sub { font-size: 9.5pt; color: #003c1f; margin-top: 2px; }
  .cab img { height: 42px; }
  .cab .sp { width: 42px; }
  .rule { border-bottom: 2px solid #00A859; margin: 7px 0 10px; }
  .meta { text-align: center; font-style: italic; font-size: 8.5pt; color: #6b7280; margin-bottom: 14px; }
  h2 { font-size: 11.5pt; color: #003c1f; margin: 16px 0 6px; border-left: 3px solid #00A859; padding-left: 7px; }
  h2:first-of-type { margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th { background: #eef4f0; color: #003c1f; font-size: 8pt; text-transform: uppercase; letter-spacing: .3px;
       padding: 5px 6px; text-align: left; border-bottom: 1.5px solid #c9ddd2; }
  td { padding: 6px; border-bottom: 1px solid #e6eae7; vertical-align: top; font-size: 9pt; }
  td.c { text-align: center; white-space: nowrap; }
  td.hora { white-space: nowrap; font-size: 8.5pt; }
  tr.simb td { background: #fafafa; color: #6b7280; }
  .res { font-size: 8pt; color: #6b7280; margin-top: 3px; font-style: italic; }
  .links { font-size: 7.5pt; margin-top: 3px; }
  .links a { color: #1d4ed8; text-decoration: none; }
  .nada { color: #9aa5a0; }
  .tag { display: inline-block; font-size: 8pt; font-weight: 700; padding: 1px 7px; border-radius: 999px; border: 1px solid; }
  .tag-voto { color: #1a1a1a; border-color: #c9ccc9; background: #f4f5f4; }
  .tag-ade  { color: #006633; border-color: #9ed7b6; background: #eaf7f0; }
  .tag-div  { color: #b02a1f; border-color: #f0b4ad; background: #fdeeec; }
  .tag-aus  { color: #8a6d00; border-color: #e8d28a; background: #fdf7e3; }
  .tag-simb { color: #6b7280; border-color: #d8dcda; background: #f4f5f4; }
  .resumo { display: flex; gap: 10px; margin: 4px 0 12px; }
  .bx { flex: 1; border: 1px solid #d8e3dc; border-radius: 6px; padding: 9px; text-align: center; }
  .bx .v { font-size: 17pt; font-weight: 700; color: #003c1f; }
  .bx .l { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .4px; color: #6b7280; margin-top: 2px; }
  .nota { font-size: 8.5pt; color: #444; background: #f7f9f8; border-left: 3px solid #c9ddd2;
          padding: 8px 10px; margin: 8px 0; line-height: 1.5; }
  .nota b { color: #003c1f; }
  ul.ret { font-size: 8pt; color: #555; margin: 4px 0 0 16px; line-height: 1.45; }
  .figura { margin: 8px 0 4px; break-inside: avoid; page-break-inside: avoid; text-align: center; }
  .ft { margin-top: 16px; padding-top: 7px; border-top: 1px solid #ddd; font-size: 7.5pt; color: #888; text-align: center; }
  @media print { .bx, .tag, th, tr.simb td { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

const CV_TAG_PDF = {
  aderente: 'tag-ade', divergente: 'tag-div', ausente: 'tag-aus',
  'sem-gov': 'tag-simb', simbolica: 'tag-simb',
};

function cvHtmlPDF(logoDataUrl) {
  const u = cv.ultimo;
  const { linhas, objetos, prop, periodo, dep, retirados, cont, pct, recorte, semObjeto } = u;
  const e = cvEsc;
  const comum = cvAgruparLinks(linhas);

  const titulo = prop
    ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}`
    : `Votações do Plenário · ${formatarData(periodo[0])} a ${formatarData(periodo[1])}`;
  const faixa = recorte ? `${formatarData(recorte.ini)} a ${formatarData(recorte.fim)}` : '';
  const subtitulo = prop
    ? String(prop.ementa || '').replace(/\s+/g, ' ').slice(0, 260)
    : 'Todas as votações do Plenário no período.';

  // Uma tabela por dia de sessão, como o documento de conferência faz.
  const porDia = new Map();
  for (const l of linhas) {
    const d = String(l.it.votacao.data || '');
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(l);
  }
  const dias = [...porDia.keys()].sort();

  // O link da sessão pertence ao DIA, não à linha: vai no título da tabela.
  const sessaoDoDia = dia => {
    const evs = new Set(porDia.get(dia).map(l => cvLinks(l.it.votacao).evento).filter(Boolean));
    return evs.size === 1 ? [...evs][0] : null;
  };

  const linhaHtml = ({ it, s }) => {
    const v = it.votacao;
    const obj = objetos[v.id];
    const hora = String(v.dataHoraRegistro || '').slice(11, 16);
    const voto = s.situacao === 'simbolica'
      ? '<span class="tag tag-simb">simbólica</span>'
      : (s.voto ? `<span class="tag tag-voto">${e(s.voto)}</span>` : '<span class="tag tag-aus">não votou</span>');
    return `<tr class="${s.situacao === 'simbolica' ? 'simb' : ''}">
      <td class="hora">${e(String(v.data || '').split('-').reverse().join('/'))}<br><span class="nada">${e(hora)}</span></td>
      <td><b>${e(obj)}</b>
          <div class="res">${e(v.descricao || '')}</div>
          ${(() => { const L = cvLinks(v); const p = [];
            if (L.prop && L.prop !== comum.fichaComum)
              p.push(`<a href="${L.prop}">${e(L.rotuloProp || 'ficha da proposição')}</a>`);
            // A sessão está no título da tabela do dia; na linha, só se diferir.
            if (L.evento && L.evento !== sessaoDoDia(String(v.data || '')))
              p.push(`<a href="${L.evento}">sessão</a>`);
            return p.length ? `<div class="links">${p.join(' · ')}</div>` : '';
          })()}</td>
      <td class="c">${voto}</td>
      <td class="c">${it.govOrient ? e(it.govOrient) : '<span class="nada">—</span>'}</td>
      <td class="c"><span class="tag ${CV_TAG_PDF[s.situacao]}">${CV_ROTULO[s.situacao]}</span></td>
    </tr>`;
  };

  const tabela = dia => `
    <h2>Sessão de ${e(dia.split('-').reverse().join('/'))}${sessaoDoDia(dia)
      ? ` <a href="${sessaoDoDia(dia)}" style="font-size:8.5pt;font-weight:400">ver a sessão no portal</a>` : ''}</h2>
    <table>
      <tr><th style="width:62px">Data</th><th>Objeto da votação</th><th style="width:74px">Voto</th>
          <th style="width:52px">Governo</th><th style="width:66px">Veredito</th></tr>
      ${porDia.get(dia).map(linhaHtml).join('')}
    </table>`;

  const comparaveis = cont.aderente + cont.divergente;
  const qualificadas = comparaveis + cont.ausente;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>${e(dep.nome)} — ${e(titulo)}${recorte ? ` (recorte ${e(faixa)})` : ''}</title><style>${CSS_PDF_VOTOS}</style></head><body>
  <div class="cab">
    <div class="sp"></div>
    <div class="tit"><h1>Dep. ${e(dep.nome)} (${e(dep.partido)}-${e(dep.uf)})</h1>
      <div class="sub">${e(titulo)}${recorte ? ` · recorte de ${e(faixa)}` : ''}</div></div>
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
  </div>
  <div class="rule"></div>
  <div class="meta">Documento de conferência · dados da API de Dados Abertos da Câmara dos Deputados,
    consultados em ${new Date().toLocaleDateString('pt-BR')}</div>

  <h2>Consolidado</h2>
  ${prop ? `<div class="nota" style="margin-top:0"><b>${e(titulo)}</b> — ${e(subtitulo)}${
      comum.fichaComum ? `<br><a href="${comum.fichaComum}" style="color:#1d4ed8">Ficha de tramitação no portal da Câmara</a>` : ''}</div>` : ''}
  <div class="resumo">
    <div class="bx"><div class="v">${linhas.length}</div><div class="l">Votações</div></div>
    <div class="bx"><div class="v">${linhas.length - cont.simbolica}</div><div class="l">Nominais</div></div>
    <div class="bx"><div class="v">${linhas.length - cont.simbolica - cont.ausente}</div><div class="l">Votos dele</div></div>
    <div class="bx"><div class="v">${cont.aderente}</div><div class="l">Aderiu</div></div>
    <div class="bx"><div class="v">${cont.divergente}</div><div class="l">Divergiu</div></div>
    <div class="bx"><div class="v">${cont.ausente}</div><div class="l">Ausente</div></div>
  </div>
  <div class="nota">
    <b>Como ler.</b> "Aderiu/Divergiu" compara o voto com a orientação do <b>Governo</b>, que é o critério
    do relatório de Aderência. Votações <b>simbólicas</b> não têm registro individual de voto — a Câmara
    não o produz —, então não entram em conta nenhuma: não são ausência do deputado. Votação nominal
    <b>sem orientação do Governo</b> também fica fora do cálculo, embora o voto exista e apareça.
    A aderência é calculada sobre <b>${comparaveis} votação(ões) comparável(is)</b>, de ${qualificadas}
    qualificada(s)${pct == null ? '' : `, e resulta em <b>${pct.toFixed(1)}%</b>`}.${semObjeto ? `
    <br><b>${semObjeto} votação(ões)</b> da ficha não entraram neste documento porque a tramitação não
    registra o que estava em votação — listá-las sem objeto não informaria nada.` : ''}
  </div>


  ${dias.map(tabela).join('')}

  ${retirados.length ? `<h2>Destaques retirados antes da votação</h2>
    <div class="nota">Retirados em acordo, sem votação — não há voto a registrar. Ficam listados para
      explicar por que a matéria tem menos votações do que destaques apresentados.${
      recorte ? ' Listados apenas os do recorte.' : ''}</div>
    <ul class="ret">${retirados.map(x => `<li>${e(String(x && x.t || x).slice(0, 220))}</li>`).join('')}</ul>` : ''}

  ${cvSvgEstatistica(cont, linhas.length) ? `<h2>Distribuição dos votos</h2>
  <div class="figura">${cvSvgEstatistica(cont, linhas.length)}</div>` : ''}

  <div class="ft">Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
</body></html>`;
}

async function cvExportarPDF() {
  if (!cv.ultimo) return;
  // A janela abre AGORA, no gesto do clique: pop-up aberto depois de um await
  // é bloqueado pelo navegador.
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) { cvStatus('Permita pop-ups para gerar o PDF.', 'error'); return; }
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando PDF…</title></head>'
    + '<body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Montando o documento…</body></html>');
  win.document.close();

  let logo = null;
  try {
    const res = await fetch(chrome.runtime.getURL('icons/podemos-logo.png'));
    if (res.ok) {
      const blob = await res.blob();
      logo = await new Promise((ok, err) => {
        const fr = new FileReader();
        fr.onloadend = () => ok(fr.result);
        fr.onerror = () => err(fr.error);
        fr.readAsDataURL(blob);
      });
    }
  } catch (e) { console.warn('Logo não carregada:', e.message); }
  if (win.closed) return;

  win.document.open();
  win.document.write(cvHtmlPDF(logo));
  win.document.close();

  let impresso = false;
  const imprimir = () => { if (impresso || win.closed) return; impresso = true; try { win.focus(); win.print(); } catch (_) {} };
  win.PagedConfig = { auto: true, after: imprimir };
  const s = win.document.createElement('script');
  s.src = chrome.runtime.getURL('libs/paged.polyfill.js');
  s.onerror = imprimir;            // sem a lib, imprime sem numeração de página
  win.document.head.appendChild(s);
  setTimeout(imprimir, 30000);     // rede de segurança
}

// ---------- gráfico da distribuição (SVG inline) ----------
// SVG inline pelo mesmo motivo das notas de orçamento: imprime, sobrevive ao
// "Salvar como PDF" e não depende de script — a janela de impressão herda a CSP
// da extensão e não roda script inline.
//
// São DUAS figuras, porque são duas perguntas e uma só barra as confundiria:
//
//   1. MEDIDOR — quantas das votações entraram no cálculo. No PL 182/2024 são 7
//      de 40: sem isso, "100% de aderência" parece cobrir as 40. É a figura que
//      impede a leitura errada do número grande.
//   2. BARRA EMPILHADA — como se distribuem as qualificadas, que é parte-de-todo
//      (o formato que o manual indica para essa função).
//
// A ordem dos segmentos é Aderiu → Ausente → Divergiu, e a razão é técnica: o
// par verde/vermelho é o pior que existe para daltonismo (ΔE 1,2 em protanopia
// com o verde do documento; 5,9 com o verde puro). Com o âmbar entre os dois,
// nenhum par ADJACENTE — os únicos que se tocam no anel da rosquinha — fica
// abaixo do limite: o pior vira ΔE 16,2. Conferido com o validador do manual de
// visualização, que reprova a ordem ingênua.
const CV_COR = {
  aderente:   '#008300',   // verde puro: o #006633 do texto reprova em protanopia
  ausente:    '#eda100',
  divergente: '#d03b3b',
  tinta:      '#0b0b0b',
  tinta2:     '#52514e',
  muda:       '#898781',
  superficie: '#ffffff',
};

/** Ponto do círculo, com o ângulo medido do topo no sentido do relógio. */
function _cvPonto(cx, cy, r, a) {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/**
 * Setor de anel (a fatia da rosquinha) entre dois ângulos, em radianos, medidos
 * do topo no sentido do relógio. Uma volta inteira não cabe num único comando de
 * arco do SVG, então o caso de 360° se parte em duas metades.
 */
function _cvArco(cx, cy, rFora, rDentro, a0, a1) {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    const meia = (r) => {
      const [x0, y0] = _cvPonto(cx, cy, r, 0);
      const [x1, y1] = _cvPonto(cx, cy, r, Math.PI);
      return { x0, y0, x1, y1 };
    };
    const F = meia(rFora), D = meia(rDentro);
    return `<path d="M${F.x0},${F.y0} A${rFora},${rFora} 0 0 1 ${F.x1},${F.y1}`
      + ` A${rFora},${rFora} 0 0 1 ${F.x0},${F.y0}`
      + ` M${D.x0},${D.y0} A${rDentro},${rDentro} 0 0 0 ${D.x1},${D.y1}`
      + ` A${rDentro},${rDentro} 0 0 0 ${D.x0},${D.y0} z" fill-rule="evenodd"`;
  }
  const [xf0, yf0] = _cvPonto(cx, cy, rFora, a0);
  const [xf1, yf1] = _cvPonto(cx, cy, rFora, a1);
  const [xd1, yd1] = _cvPonto(cx, cy, rDentro, a1);
  const [xd0, yd0] = _cvPonto(cx, cy, rDentro, a0);
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  return `<path d="M${xf0},${yf0} A${rFora},${rFora} 0 ${grande} 1 ${xf1},${yf1}`
    + ` L${xd1},${yd1} A${rDentro},${rDentro} 0 ${grande} 0 ${xd0},${yd0} z"`;
}

/**
 * A figura da distribuição: rosquinha da conduta nas votações qualificadas, com
 * o total no miolo e a razão sobre o universo na linha de baixo. `cont` vem de
 * cvRender; `total` é o nº de votações.
 *
 * O recorte ("N de M entraram no cálculo") NÃO ganha figura própria: como razão
 * de duas partes, uma rosquinha dele seria uma pizza de duas fatias, que o
 * manual de visualização reprova. Ele vale mais como número, no miolo e no pé.
 *
 * Devolve '' quando não há o que mostrar — figura de zero não informa nada.
 */
function cvSvgEstatistica(cont, total) {
  const qual = cont.aderente + cont.divergente + cont.ausente;
  if (!total || !qual) return '';

  // A folga vertical acima do anel é deliberada: o rótulo de uma fatia fina sai
  // para fora, a R_FORA+13, e sem essa folga ele bateria no título da figura.
  const L = 620, ALT = 220;
  const cy = 114, R_FORA = 76, R_DENTRO = 48, VAO_LEG = 44;
  const rMeio = (R_FORA + R_DENTRO) / 2;

  // A ordem é a validada: Aderiu → Ausente → Divergiu (âmbar entre verde e vermelho).
  const partes = [
    { k: 'aderente',   rot: 'Aderiu',   n: cont.aderente },
    { k: 'ausente',    rot: 'Ausente',  n: cont.ausente },
    { k: 'divergente', rot: 'Divergiu', n: cont.divergente },
  ].filter(p => p.n > 0);          // fatia de zero não se desenha

  // O conjunto anel + legenda é centrado na figura, e a figura na página. A
  // largura da legenda se estima do texto mais longo: sem isso o bloco fica
  // encostado à esquerda com um vazio à direita, que foi como nasceu.
  const larguraLegenda = 17 + Math.max(...partes.map(p => {
    const pct = ((p.n / qual) * 100).toFixed(p.n / qual >= 0.995 ? 0 : 1);
    return Math.max(p.rot.length * 6.4, `${p.n} de ${qual} — ${pct}%`.length * 5.4);
  }));
  const larguraBloco = 2 * R_FORA + VAO_LEG + larguraLegenda;
  const x0 = Math.max((L - larguraBloco) / 2, 0);
  const cx = x0 + R_FORA;

  // Vão de 2px na cor da superfície entre fatias vizinhas, convertido de pixels
  // para ângulo no raio médio do anel. Fatia única fecha a volta, sem vão.
  const vao = partes.length > 1 ? 2 / rMeio : 0;
  const VOLTA = 2 * Math.PI;

  let a = 0;
  const fatias = [];
  const rotulos = [];
  partes.forEach((p) => {
    const fim = a + (p.n / qual) * VOLTA;
    const a0 = a + vao / 2, a1 = fim - vao / 2;
    fatias.push(`${_cvArco(cx, cy, R_FORA, R_DENTRO, a0, Math.max(a1, a0 + 1e-4))} fill="${CV_COR[p.k]}"/>`);

    // Rótulo direto: dentro do anel quando a fatia comporta o número com folga;
    // senão para fora, em tinta. Posição e cor se decidem juntas.
    const meio = (a0 + a1) / 2;
    const arco = (a1 - a0) * rMeio;
    const dentro = arco >= 26;
    const r = dentro ? rMeio : R_FORA + 13;
    const [tx, ty] = _cvPonto(cx, cy, r, meio);
    const ancora = dentro ? 'middle' : (Math.sin(meio) >= 0 ? 'start' : 'end');
    rotulos.push(`<text x="${tx.toFixed(1)}" y="${(ty + 3.6).toFixed(1)}" font-size="11" font-weight="700"
      text-anchor="${ancora}" fill="${dentro ? '#ffffff' : CV_COR.tinta}">${p.n}</text>`);
    a = fim;
  });

  const legenda = partes.map((p, i) => {
    const pct = ((p.n / qual) * 100).toFixed(p.n / qual >= 0.995 ? 0 : 1);
    return `<g transform="translate(0,${i * 27})">
      <rect x="0" y="0" width="10" height="10" rx="2" fill="${CV_COR[p.k]}"/>
      <text x="17" y="9" font-size="11" font-weight="600" fill="${CV_COR.tinta}">${p.rot}</text>
      <text x="17" y="22" font-size="10" fill="${CV_COR.tinta2}">${p.n} de ${qual} — ${pct}%</text>
    </g>`;
  }).join('');

  const fora = total - qual;
  return `<svg width="${L}" height="${ALT}" viewBox="0 0 ${L} ${ALT}" role="img"
    aria-label="Conduta nas ${qual} votações qualificadas, de um universo de ${total}: ${partes.map(p => p.rot + ' ' + p.n).join(', ')}."
    style="max-width:100%;height:auto">
    <text x="${L / 2}" y="12" font-size="10.5" font-weight="600" text-anchor="middle" fill="${CV_COR.tinta2}">Conduta nas votações qualificadas</text>
    <g>
      ${fatias.join('\n      ')}
      ${rotulos.join('\n      ')}
      <text x="${cx}" y="${cy - 2}" font-size="30" font-weight="700" text-anchor="middle" fill="${CV_COR.tinta}">${qual}</text>
      <text x="${cx}" y="${cy + 14}" font-size="9.5" text-anchor="middle" fill="${CV_COR.muda}">qualificadas</text>
      <text x="${cx}" y="${cy + 26}" font-size="9.5" text-anchor="middle" fill="${CV_COR.muda}">de ${total}</text>
    </g>
    <g transform="translate(${(x0 + 2 * R_FORA + VAO_LEG).toFixed(1)},${cy - (partes.length * 27) / 2 + 4})">${legenda}</g>
    <text x="${L / 2}" y="${ALT - 6}" font-size="9" text-anchor="middle" fill="${CV_COR.muda}">
      ${fora} das ${total} votações ${fora === 1 ? 'ficou' : 'ficaram'} fora do cálculo — votação simbólica ou sem orientação do governo</text>
  </svg>`;
}
