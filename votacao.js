'use strict';

const API        = 'https://dadosabertos.camara.leg.br/api/v2';
// URL do Cloudflare Worker para contornar CORS quando necessário
const WORKER_URL = 'https://shrill-resonance-4d17.vinicius-const.workers.dev/';

// ── Helpers ──
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ── Fetch com fallback automático para proxy CORS ──
async function proxiedFetch(url, options) {
  try {
    var r = await fetch(url, options);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } catch (e) {
    if (!WORKER_URL) throw e;
    var r2 = await fetch(WORKER_URL + '?url=' + encodeURIComponent(url), options);
    if (!r2.ok) throw new Error('HTTP ' + r2.status);
    return r2;
  }
}

// ── Fetch com retry automático (para erros 5xx e falhas de rede) ──
async function fetchWithRetry(url, options, maxAttempts, onRetry) {
  maxAttempts = maxAttempts || 3;
  var lastErr;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      var r = await fetch(url, options);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) {
      lastErr = e;
      // Só tenta novamente em erros de rede ou 5xx (incl. 504)
      var is5xx = e.message && /HTTP 5\d\d/.test(e.message);
      var isNet = !e.message || !e.message.startsWith('HTTP');
      if (attempt < maxAttempts && (is5xx || isNet)) {
        var wait = attempt * 2000; // 2s, 4s
        if (onRetry) onRetry(attempt, maxAttempts, wait);
        await sleep(wait);
      } else {
        break;
      }
    }
  }
  throw lastErr;
}

/* ══════════════════════════════════════════
   SHARED STATE & UTILS
══════════════════════════════════════════ */

var partiesCache = null;

function addDays(dateStr, days) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

async function resolvePartySigla(input) {
  var upper = input.toUpperCase();
  if (!partiesCache) {
    try {
      var r = await fetch(API + '/partidos?itens=100&ordem=ASC&ordenarPor=sigla');
      var d = await r.json();
      partiesCache = {};
      (d.dados || []).forEach(function (p) {
        partiesCache[p.sigla.toUpperCase()] = p;
        if (p.nome) partiesCache[p.nome.toUpperCase()] = p;
      });
    } catch (e) { partiesCache = {}; }
  }
  if (partiesCache[upper]) return partiesCache[upper].sigla;
  var keys = Object.keys(partiesCache);
  for (var i = 0; i < keys.length; i++) {
    var p = partiesCache[keys[i]];
    if (p.sigla.toUpperCase() === upper) return p.sigla;
    if (p.nome && p.nome.toUpperCase() === upper) return p.sigla;
    if (p.nome && p.nome.toUpperCase().indexOf(upper) !== -1) return p.sigla;
    if (upper.indexOf(p.sigla.toUpperCase()) !== -1) return p.sigla;
  }
  return upper;
}

function votoClass(tipo) {
  if (!tipo) return 'absent';
  var t = tipo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === 'sim') return 'sim';
  if (t === 'nao') return 'nao';
  if (t.indexOf('abst') !== -1) return 'abstencao';
  if (t.indexOf('art')  !== -1) return 'art17';
  if (t.indexOf('obstr') !== -1) return 'obstrucao';
  return 'absent';
}

function votoColor(cls) {
  return {
    sim: 'var(--sim)', nao: 'var(--nao)', abstencao: 'var(--abstencao)',
    art17: 'var(--art17)', obstrucao: 'var(--obstrucao)', absent: 'var(--absent)'
  }[cls] || 'var(--text-dim)';
}

function fmtMs(ms) {
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}

/* ══════════════════════════════════════════
   TAB SWITCHING
══════════════════════════════════════════ */

function switchTab(tab) {
  document.getElementById('tab-historico').style.display = tab === 'historico' ? '' : 'none';
  document.getElementById('tab-portal').style.display    = tab === 'portal'    ? '' : 'none';
  document.getElementById('tabHistorico').classList.toggle('active', tab === 'historico');
  document.getElementById('tabPortal').classList.toggle('active',    tab === 'portal');
}

/* ══════════════════════════════════════════
   HISTÓRICO TAB
══════════════════════════════════════════ */

var votacoes      = [];
var cachedVotos   = null;
var cachedOrient  = null;
var cachedVotacao = null;
var lastRenderData = null;

function showStatus(msg, isError) {
  var el = document.getElementById('statusArea');
  el.className = 'status' + (isError ? ' error' : '');
  el.innerHTML = msg;
}

function showLoading(msg) {
  showStatus('<div class="spinner"></div><br>' + (msg || 'Buscando dados...'));
}

async function loadEvent() {
  var date = document.getElementById('dateInput').value;
  if (!date) { showStatus('Selecione uma data.', true); return; }

  var btn = document.getElementById('loadBtn');
  btn.disabled = true;
  showLoading('Carregando votações do Plenário em ' + date + '...');

  try {
    var dataFim     = addDays(date, 1);
    var allVotacoes = [];
    var pagina      = 1;
    while (pagina <= 10) {
      var resp = await fetchWithRetry(
        API + '/votacoes?dataInicio=' + date + '&dataFim=' + dataFim +
        '&idOrgao=180&itens=100&pagina=' + pagina + '&ordem=DESC&ordenarPor=dataHoraRegistro',
        {},
        3,
        function (attempt, max, wait) {
          showLoading('Servidor lento (504). Tentativa ' + attempt + '/' + max + '…<br><small>aguardando ' + (wait / 1000) + 's antes de tentar novamente</small>');
        }
      );
      var data  = await resp.json();
      var batch = data.dados || [];
      if (batch.length === 0) break;
      allVotacoes = allVotacoes.concat(batch);
      if (batch.length < 100) break;
      pagina++;
    }

    var nominalRegex = /Sim:\s*\d+.*N[ãa]o:\s*\d+/i;
    votacoes = allVotacoes.filter(function (v) {
      return v.data === date && v.descricao && nominalRegex.test(v.descricao);
    });

    if (votacoes.length === 0) {
      showStatus('Nenhuma votação nominal do Plenário encontrada para ' + date + '.', true);
      document.getElementById('votingSelectArea').classList.remove('show');
      document.getElementById('resultsArea').innerHTML = '';
      document.getElementById('generateArea').classList.remove('show');
      btn.disabled = false;
      return;
    }

    var select = document.getElementById('votingSelect');
    select.innerHTML = '';
    votacoes.forEach(function (v, i) {
      var opt   = document.createElement('option');
      opt.value = i;
      var hora  = v.dataHoraRegistro ? v.dataHoraRegistro.split('T')[1].substring(0, 5) : '';
      var prop  = v.proposicaoObjeto || '';
      var label = hora ? hora + ' — ' : '';
      label += v.descricao || 'Votação';
      if (prop) label += ' (' + prop + ')';
      opt.textContent = label;
      select.appendChild(opt);
    });

    document.getElementById('votingSelectArea').classList.add('show');
    document.getElementById('filterBtn').style.display = '';
    showStatus('');
    await loadVotes();
  } catch (e) {
    var msg = e.message || String(e);
    if (/HTTP 5/.test(msg)) {
      showStatus('A API da Câmara está lenta ou indisponível (' + msg + ').<br>' +
        '<small>Isso é temporário — aguarde alguns instantes e clique <b>Carregar</b> novamente.</small>', true);
    } else {
      showStatus('Erro ao carregar: ' + msg, true);
    }
  }
  btn.disabled = false;
}

async function loadVotes() {
  var idx     = document.getElementById('votingSelect').value;
  var votacao = votacoes[idx];
  if (!votacao) return;

  showLoading('Carregando votos e orientações...');

  try {
    var results = await Promise.all([
      fetchWithRetry(API + '/votacoes/' + votacao.id + '/votos', {}, 3,
        function (a, m, w) { showLoading('API lenta (504). Tentativa ' + a + '/' + m + '…<br><small>aguardando ' + (w/1000) + 's</small>'); }),
      fetchWithRetry(API + '/votacoes/' + votacao.id + '/orientacoes', {}, 3, null)
        .catch(function () { return null; })
    ]);

    var votosData   = await results[0].json();
    var orientData  = results[1] ? await results[1].json() : { dados: [] };

    cachedVotos   = votosData.dados  || [];
    cachedOrient  = orientData.dados || [];
    cachedVotacao = votacao;

    await renderFiltered();
  } catch (e) {
    showStatus('Erro ao carregar votos: ' + e.message, true);
  }
}

async function refilter() {
  if (cachedVotos) await renderFiltered();
}

async function renderFiltered() {
  var rawParty = document.getElementById('partyInput').value.trim();
  if (!rawParty) { showStatus('Informe o partido.', true); return; }

  showLoading('Resolvendo sigla e carregando bancada...');

  var sigla = await resolvePartySigla(rawParty);

  var allDeputados = [];
  try {
    var dResp = await fetch(API + '/deputados?siglaPartido=' + sigla + '&itens=100&ordem=ASC&ordenarPor=nome');
    if (dResp.ok) {
      var dData    = await dResp.json();
      allDeputados = dData.dados || [];
    }
  } catch (e) {}

  document.getElementById('statusArea').innerHTML = '';

  var html = buildVotingHTML(sigla, cachedVotos, cachedOrient, cachedVotacao, allDeputados, 'da');
  document.getElementById('resultsArea').innerHTML = html.resultsHTML;
  lastRenderData = html.renderData;

  if (html.chartId && html.renderData) {
    var canvas = document.getElementById(html.chartId);
    if (canvas) {
      drawPieCanvas(canvas,
        html.renderData.pSim, html.renderData.pNao, html.renderData.pAbst,
        html.renderData.pArt17, html.renderData.pObst, html.renderData.pAusente);
    }
  }

  document.getElementById('generateArea').classList.add('show');
  document.getElementById('generateStatus').textContent = '';
}

/* ══════════════════════════════════════════
   SHARED RENDERING CORE
══════════════════════════════════════════ */

function buildVotingHTML(sigla, allVotos, orientacoes, votacao, allDeputados, sourceTag) {
  // Global counts
  var gSim = 0, gNao = 0, gAbst = 0, gArt17 = 0, gObst = 0;
  allVotos.forEach(function (v) {
    var c = votoClass(v.tipoVoto);
    if (c === 'sim') gSim++;
    else if (c === 'nao') gNao++;
    else if (c === 'abstencao') gAbst++;
    else if (c === 'art17') gArt17++;
    else if (c === 'obstrucao') gObst++;
  });

  // Party votes
  var votedFromParty = allVotos.filter(function (v) {
    if (!v.deputado_ || !v.deputado_.siglaPartido) return false;
    var sp = v.deputado_.siglaPartido.toUpperCase();
    var s  = sigla.toUpperCase();
    if (sp === s) return true;
    if (partiesCache && partiesCache[sp] && partiesCache[sp].sigla) {
      return partiesCache[sp].sigla.toUpperCase() === s;
    }
    return false;
  });

  // Merge roster + votes
  var mergedMap = {};
  allDeputados.forEach(function (dep) {
    mergedMap[dep.id] = {
      id: dep.id, nome: dep.nome,
      siglaPartido: dep.siglaPartido, siglaUf: dep.siglaUf, tipoVoto: null
    };
  });
  votedFromParty.forEach(function (v) {
    var d = v.deputado_;
    if (mergedMap[d.id]) {
      mergedMap[d.id].tipoVoto = v.tipoVoto;
    } else {
      mergedMap[d.id] = {
        id: d.id, nome: d.nome,
        siglaPartido: d.siglaPartido, siglaUf: d.siglaUf, tipoVoto: v.tipoVoto
      };
    }
  });

  var merged = Object.values(mergedMap);
  merged.sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });

  if (merged.length === 0) {
    return {
      resultsHTML:
        '<div class="vote-header"><div class="vote-title-bar">' +
        '<div class="vote-description">' + (votacao ? votacao.descricao : '') + '</div></div></div>' +
        '<div class="status error">Nenhum deputado encontrado para "' + sigla + '".<br>Tente a sigla oficial (ex: PODE, REPUBLICANOS).</div>',
      renderData: null,
      chartId: null
    };
  }

  // Party counts
  var chartId = 'bchart-' + Math.random().toString(36).slice(2, 8);
  var pSim = 0, pNao = 0, pAbst = 0, pArt17 = 0, pObst = 0, pAusente = 0;
  merged.forEach(function (d) {
    var c = votoClass(d.tipoVoto);
    if (c === 'sim') pSim++;
    else if (c === 'nao') pNao++;
    else if (c === 'abstencao') pAbst++;
    else if (c === 'art17') pArt17++;
    else if (c === 'obstrucao') pObst++;
    else pAusente++;
  });

  // Orientations
  var orientacao = '', orientGoverno = '';
  for (var i = 0; i < orientacoes.length; i++) {
    var oSig = (orientacoes[i].siglaPartidoBloco || '').toUpperCase();
    if (!orientacao && (oSig === sigla.toUpperCase() || oSig.indexOf(sigla.toUpperCase()) !== -1))
      orientacao = orientacoes[i].orientacaoVoto || '';
    if (!orientGoverno && oSig === 'GOVERNO')
      orientGoverno = orientacoes[i].orientacaoVoto || '';
  }

  var dataVot = votacao ? (votacao.data || '') : '';
  var hora    = votacao && votacao.dataHoraRegistro
    ? votacao.dataHoraRegistro.split('T')[1].substring(0, 5) : '';

  var orientHTML = orientacao
    ? '<div class="orientation-banner">' +
        '<span class="ob-label">Orientação da Liderança</span>' +
        '<span class="ob-party">' + sigla + '</span>' +
        '<span class="ob-vote" style="color:' + votoColor(votoClass(orientacao)) + '">' + orientacao + '</span>' +
      '</div>' : '';

  var orientGovHTML = orientGoverno
    ? '<div class="orientation-banner">' +
        '<span class="ob-label">Orientação do</span>' +
        '<span class="ob-party">GOVERNO</span>' +
        '<span class="ob-vote" style="color:' + votoColor(votoClass(orientGoverno)) + '">' + orientGoverno + '</span>' +
      '</div>' : '';

  var sourceBadge = '<span class="vote-source-badge da">Dados Abertos</span>';

  // Deputy rows
  var rows = '';
  merged.forEach(function (d) {
    var cls   = votoClass(d.tipoVoto);
    var label = d.tipoVoto || '';
    rows +=
      '<div class="deputy-item">' +
        '<div>' +
          '<div class="deputy-name">' + (d.nome || '?') + '</div>' +
          '<div class="deputy-party">(' + (d.siglaPartido || '?') + '-' + (d.siglaUf || '?') + ')</div>' +
        '</div>' +
        '<div class="deputy-vote ' + cls + '">' + label + '</div>' +
      '</div>';
  });

  var legendItems =
    (pSim     > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#3ad97d"></span>Sim<span class="legend-value" style="color:#3ad97d">'       + pSim     + '</span></div>' : '') +
    (pNao     > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#f05454"></span>Não<span class="legend-value" style="color:#f05454">'       + pNao     + '</span></div>' : '') +
    (pAbst    > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#f0c040"></span>Abstenção<span class="legend-value" style="color:#f0c040">' + pAbst    + '</span></div>' : '') +
    (pArt17   > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#6eaaff"></span>Art. 17<span class="legend-value" style="color:#6eaaff">'   + pArt17   + '</span></div>' : '') +
    (pObst    > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#c084fc"></span>Obstrução<span class="legend-value" style="color:#c084fc">' + pObst    + '</span></div>' : '') +
    (pAusente > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#5a6f74"></span>Ausente<span class="legend-value" style="color:#5a6f74">'   + pAusente + '</span></div>' : '');

  var resultsHTML =
    '<div class="vote-header">' +
      '<div class="vote-title-bar">' +
        '<div><span class="vote-party-badge">partido: ' + sigla + '</span>' + sourceBadge + '</div>' +
        '<div class="vote-description">' + (votacao ? (votacao.descricao || '') : '') + '</div>' +
        '<div class="vote-dates">' + dataVot + ' às ' + hora + ' · ' + (votacao ? (votacao.siglaOrgao || 'PLEN') : 'PLEN') + '</div>' +
      '</div>' +
      '<div class="quorum-big"><div class="q-label">Quórum da votação</div><div class="q-value">' + allVotos.length + '</div></div>' +
      '<div class="result-title">Resultado final</div>' +
      '<div class="result-row"><span class="r-label">Sim</span><span class="r-value sim">'             + gSim  + '</span></div>' +
      '<div class="result-row"><span class="r-label">Não</span><span class="r-value nao">'             + gNao  + '</span></div>' +
      '<div class="result-row"><span class="r-label">Abstenção</span><span class="r-value abstencao">' + gAbst + '</span></div>' +
      '<div class="result-row"><span class="r-label">Art. 17</span><span class="r-value art17">'       + gArt17 + '</span></div>' +
      '<div class="result-row"><span class="r-label">Obstrução</span><span class="r-value obstrucao">' + gObst + '</span></div>' +
      '<div class="result-divider"></div>' +
      '<div class="result-total"><span>Total</span><span>' + allVotos.length + '</span></div>' +
      orientHTML + orientGovHTML +
    '</div>' +
    '<div class="vote-header" style="margin-bottom:16px">' +
      '<div class="result-title" style="padding-top:14px">Bancada ' + sigla + '</div>' +
      '<div class="chart-section">' +
        '<canvas class="bancada-chart-canvas" id="' + chartId + '" width="120" height="120"></canvas>' +
        '<div class="chart-legend">' + legendItems + '</div>' +
      '</div>' +
      '<div class="result-divider"></div>' +
      '<div class="result-total"><span>Total bancada</span><span>' + merged.length + '</span></div>' +
    '</div>' +
    '<div class="deputy-list">' +
      '<div class="deputy-list-header"><h3>Deputados</h3><span class="deputy-count">' + merged.length + ' parlamentares</span></div>' +
      rows +
    '</div>';

  var renderData = {
    sigla, votacao, allVotos, merged, orientacao,
    gSim, gNao, gAbst, gArt17, gObst,
    pSim, pNao, pAbst, pArt17, pObst, pAusente,
    dataVot, hora, orientHTML, orientGovHTML
  };

  return { resultsHTML, renderData, chartId };
}


/* ══════════════════════════════════════════
   IMAGE GENERATION
══════════════════════════════════════════ */

function drawPieCanvas(canvas, sim, nao, abst, art17, obst, ausente) {
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var cx = W / 2, cy = H / 2, R = Math.min(cx, cy) - 4;

  var slices = [
    { v: sim,     c: '#3ad97d' }, { v: nao,     c: '#f05454' },
    { v: abst,    c: '#f0c040' }, { v: art17,   c: '#6eaaff' },
    { v: obst,    c: '#c084fc' }, { v: ausente, c: '#5a6f74' }
  ].filter(function (s) { return s.v > 0; });

  var total = 0;
  slices.forEach(function (s) { total += s.v; });
  if (total === 0) return;

  var startAngle = -Math.PI / 2;
  slices.forEach(function (s) {
    var sweep = (s.v / total) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, startAngle, startAngle + sweep); ctx.closePath();
    ctx.fillStyle = s.c; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#0e1c1f'; ctx.stroke();
    startAngle += sweep;
  });

  ctx.beginPath(); ctx.arc(cx, cy, R * 0.52, 0, 2 * Math.PI);
  ctx.fillStyle = '#142a2f'; ctx.fill();
  ctx.fillStyle = '#e8ecec'; ctx.font = 'bold 22px DM Sans, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy - 6);
  ctx.fillStyle = '#8da3a8'; ctx.font = '9px DM Sans, sans-serif';
  ctx.fillText('TOTAL', cx, cy + 10);
}

function buildGroupHTML(title, deps, dotColor, countColor) {
  if (deps.length === 0) return '';
  var items = '';
  deps.forEach(function (d) {
    items += '<span class="dep-compact">' + (d.nome || '?') +
      ' <span class="dep-uf">(' + (d.siglaUf || '?') + ')</span></span>';
  });
  return '<div class="dep-group">' +
    '<div class="dep-group-header"><h4><span class="group-dot" style="background:' + dotColor + '"></span>' + title + '</h4>' +
    '<span class="group-count" style="color:' + countColor + '">' + deps.length + '</span></div>' +
    '<div class="dep-group-body">' + items + '</div></div>';
}

async function generateImage(overrideData) {
  var D = overrideData || lastRenderData;
  if (!D) return;

  var btn    = document.getElementById('generateBtn');
  var status = document.getElementById('generateStatus');
  btn.disabled      = true;
  status.textContent = 'Gerando imagem, aguarde...';

  try {
    var depSim = [], depNao = [], depAbst = [], depArt17 = [], depObst = [], depAusente = [];
    D.merged.forEach(function (d) {
      var c = votoClass(d.tipoVoto);
      if (c === 'sim') depSim.push(d);
      else if (c === 'nao') depNao.push(d);
      else if (c === 'abstencao') depAbst.push(d);
      else if (c === 'art17') depArt17.push(d);
      else if (c === 'obstrucao') depObst.push(d);
      else depAusente.push(d);
    });

    var groupsHTML =
      buildGroupHTML('Votaram Sim',  depSim,     '#3ad97d', '#3ad97d') +
      buildGroupHTML('Votaram Não',  depNao,     '#f05454', '#f05454') +
      buildGroupHTML('Abstenção',    depAbst,    '#f0c040', '#f0c040') +
      buildGroupHTML('Art. 17',      depArt17,   '#6eaaff', '#6eaaff') +
      buildGroupHTML('Obstrução',    depObst,    '#c084fc', '#c084fc') +
      buildGroupHTML('Ausentes',     depAusente, '#5a6f74', '#5a6f74');

    var legendItems = '';
    if (D.pSim)     legendItems += '<div class="legend-item"><span class="legend-dot" style="background:#3ad97d"></span>Sim<span class="legend-value" style="color:#3ad97d">'       + D.pSim     + '</span></div>';
    if (D.pNao)     legendItems += '<div class="legend-item"><span class="legend-dot" style="background:#f05454"></span>Não<span class="legend-value" style="color:#f05454">'       + D.pNao     + '</span></div>';
    if (D.pAbst)    legendItems += '<div class="legend-item"><span class="legend-dot" style="background:#f0c040"></span>Abstenção<span class="legend-value" style="color:#f0c040">' + D.pAbst    + '</span></div>';
    if (D.pArt17)   legendItems += '<div class="legend-item"><span class="legend-dot" style="background:#6eaaff"></span>Art. 17<span class="legend-value" style="color:#6eaaff">'   + D.pArt17   + '</span></div>';
    if (D.pObst)    legendItems += '<div class="legend-item"><span class="legend-dot" style="background:#c084fc"></span>Obstrução<span class="legend-value" style="color:#c084fc">' + D.pObst    + '</span></div>';
    if (D.pAusente) legendItems += '<div class="legend-item"><span class="legend-dot" style="background:#5a6f74"></span>Ausente<span class="legend-value" style="color:#5a6f74">'   + D.pAusente + '</span></div>';

    var offscreen = document.createElement('div');
    offscreen.style.cssText = 'position:fixed;left:-9999px;top:0;width:500px;background:#0e1c1f;padding:20px;font-family:DM Sans,sans-serif;color:#e8ecec;';
    offscreen.innerHTML =
      '<div class="vote-header">' +
        '<div class="vote-title-bar">' +
          '<div class="vote-party-badge">partido: ' + D.sigla + '</div>' +
          '<div class="vote-description">' + (D.votacao ? (D.votacao.descricao || '') : '') + '</div>' +
          '<div class="vote-dates">' + D.dataVot + ' às ' + D.hora + ' · ' + (D.votacao ? (D.votacao.siglaOrgao || 'PLEN') : 'PLEN') + '</div>' +
        '</div>' +
        '<div class="quorum-big"><div class="q-label">Quórum da votação</div><div class="q-value">' + D.allVotos.length + '</div></div>' +
        '<div class="result-title">Resultado final</div>' +
        '<div class="result-row"><span class="r-label">Sim</span><span class="r-value sim">'             + D.gSim  + '</span></div>' +
        '<div class="result-row"><span class="r-label">Não</span><span class="r-value nao">'             + D.gNao  + '</span></div>' +
        '<div class="result-row"><span class="r-label">Abstenção</span><span class="r-value abstencao">' + D.gAbst + '</span></div>' +
        '<div class="result-row"><span class="r-label">Art. 17</span><span class="r-value art17">'       + D.gArt17 + '</span></div>' +
        '<div class="result-row"><span class="r-label">Obstrução</span><span class="r-value obstrucao">' + D.gObst + '</span></div>' +
        '<div class="result-divider"></div>' +
        '<div class="result-total"><span>Total</span><span>' + D.allVotos.length + '</span></div>' +
        D.orientHTML + D.orientGovHTML +
      '</div>' +
      '<div class="vote-header" style="margin-top:12px">' +
        '<div class="result-title" style="padding-top:14px">Bancada ' + D.sigla + '</div>' +
        '<div class="chart-section">' +
          '<canvas id="pieChartImg" width="140" height="140"></canvas>' +
          '<div class="chart-legend">' + legendItems + '</div>' +
        '</div>' +
        '<div class="result-divider"></div>' +
        '<div class="result-total"><span>Total bancada</span><span>' + D.merged.length + '</span></div>' +
      '</div>' +
      '<div class="dep-groups" style="margin-top:12px">' + groupsHTML + '</div>' +
      '<div class="signature">' +
        '<div class="signature-line"></div>' +
        '<div class="signature-text">Liderança do Podemos</div>' +
        '<div class="signature-sub">Câmara dos Deputados · ' + D.dataVot + '</div>' +
      '</div>';

    document.body.appendChild(offscreen);
    var pieCanvas = offscreen.querySelector('#pieChartImg');
    if (pieCanvas) drawPieCanvas(pieCanvas, D.pSim, D.pNao, D.pAbst, D.pArt17, D.pObst, D.pAusente);

    await new Promise(function (r) { setTimeout(r, 100); });

    var canvas = await html2canvas(offscreen, {
      backgroundColor: '#0e1c1f', scale: 2, useCORS: true, logging: false, windowWidth: 540
    });

    document.body.removeChild(offscreen);

    var link  = document.createElement('a');
    link.download = 'votacao-' + D.sigla.toLowerCase() + '-' + D.dataVot + '.png';
    link.href     = canvas.toDataURL('image/png');
    link.click();

    status.textContent = 'Imagem salva com sucesso!';
    setTimeout(function () { status.textContent = ''; }, 3000);

  } catch (e) {
    status.textContent = 'Erro ao gerar imagem: ' + e.message;
    var leftover = document.querySelector('[style*="left:-9999px"]');
    if (leftover) document.body.removeChild(leftover);
  }

  btn.disabled = false;
}

/* ══════════════════════════════════════════
   DETECÇÃO AUTOMÁTICA — PLENÁRIO EM ANDAMENTO
══════════════════════════════════════════ */

async function detectSessaoEmAndamento() {
  var btn = document.getElementById('detectPlenarioBtn');
  btn.disabled = true;
  btn.textContent = '🔍 Buscando…';
  showPortalStatus('<div class="spinner"></div><br>Acessando camara.leg.br/plenario…');

  try {
    // Busca a página do Plenário — mesma cadeia de fallbacks do fetchPortalPage
    var plenarioUrl = 'https://www.camara.leg.br/plenario';
    var html = null;

    try {
      var r = await fetch(plenarioUrl);
      if (r.ok) html = await r.text();
    } catch (e) { /* segue para proxy */ }

    if (!html) {
      try {
        var r2 = await fetch(CODETABS + encodeURIComponent(plenarioUrl));
        if (r2.ok) html = await r2.text();
      } catch (e) { /* segue para Worker */ }
    }

    if (!html && WORKER_URL) {
      var r3 = await fetch(WORKER_URL + '?url=' + encodeURIComponent(plenarioUrl));
      if (!r3.ok) throw new Error('Proxy HTTP ' + r3.status);
      html = await r3.text();
    }

    if (!html) throw new Error('Não foi possível carregar a página do Plenário.');

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var reuniaoId    = null;
    var itemVotacaoId = null;

    // Estratégia 1: link direto para votacao-portal (pode já ter itemVotacao)
    var portalLinks = doc.querySelectorAll('a[href*="votacao-portal"]');
    portalLinks.forEach(function (a) {
      if (reuniaoId) return;
      var href = a.getAttribute('href') || '';
      var rm = href.match(/reuniao=(\d+)/);
      if (!rm) return;
      var container = a.closest('li') || a.closest('article') || a.closest('div') || a.parentElement;
      var textoContainer = container ? container.textContent.toLowerCase() : '';
      if (textoContainer.includes('em andamento') || a.textContent.toLowerCase().includes('acompanhe')) {
        reuniaoId = rm[1];
        var ivm = href.match(/itemVotacao=(\d+)/);
        if (ivm) itemVotacaoId = ivm[1];
      }
    });

    // Estratégia 2: links evento-legislativo próximos de "em andamento"
    if (!reuniaoId) {
      var evLinks = doc.querySelectorAll('a[href*="evento-legislativo/"]');
      evLinks.forEach(function (a) {
        if (reuniaoId) return;
        var container = a.closest('li') || a.closest('article') || a.closest('div') || a.parentElement;
        if (container && container.textContent.toLowerCase().includes('em andamento')) {
          var m = (a.getAttribute('href') || '').match(/evento-legislativo\/(\d+)/);
          if (m) reuniaoId = m[1];
        }
      });
    }

    // Estratégia 3: varredura no HTML bruto ao redor de "em andamento"
    if (!reuniaoId) {
      var idx = html.toLowerCase().indexOf('em andamento');
      if (idx !== -1) {
        // Janela ampla para capturar links que apareçam antes ou depois do texto
        var trecho = html.substring(Math.max(0, idx - 1000), idx + 1000);
        // Tenta pegar votacao-portal com itemVotacao (inclui &amp; do HTML)
        var mp = trecho.match(/votacao-portal\?reuniao=(\d+)(?:&(?:amp;)?itemVotacao=(\d+))?/);
        if (mp) {
          reuniaoId = mp[1];
          if (mp[2]) itemVotacaoId = mp[2];
        } else {
          var m2 = trecho.match(/evento-legislativo\/(\d+)/);
          if (m2) reuniaoId = m2[1];
        }
      }
    }

    // Estratégia 4: qualquer link votacao-portal no documento (sem exigir "em andamento")
    if (!reuniaoId) {
      portalLinks.forEach(function (a) {
        if (reuniaoId) return;
        var href = a.getAttribute('href') || '';
        var rm = href.match(/reuniao=(\d+)/);
        if (rm) {
          reuniaoId = rm[1];
          var ivm = href.match(/itemVotacao=(\d+)/);
          if (ivm) itemVotacaoId = ivm[1];
        }
      });
    }

    if (!reuniaoId) {
      showPortalStatus(
        'Nenhuma sessão "em andamento" encontrada no Plenário agora.<br>' +
        '<small>Pode não haver sessão no momento. Cole o link manualmente.</small>', true);
      return;
    }

    var url = 'https://www.camara.leg.br/presenca-comissoes/votacao-portal?reuniao=' + reuniaoId;
    if (itemVotacaoId) url += '&itemVotacao=' + itemVotacaoId;
    document.getElementById('portalUrlInput').value = url;
    showPortalStatus('Sessão detectada — reunião ' + reuniaoId + '. Carregando dados…');
    await loadFromPortalUrl();

  } catch (e) {
    showPortalStatus('Erro ao buscar sessão: ' + e.message + '<br><small>Cole o link manualmente.</small>', true);
  }

  btn.disabled = false;
  btn.textContent = '🔍 Detectar sessão em andamento';
}

/* ══════════════════════════════════════════
   PORTAL WEB TAB
══════════════════════════════════════════ */

var portalCachedDoc     = null;
var portalCachedBaseUrl = '';
var portalCachedVotingId = null;
var portalLastRenderData = null;

function showPortalStatus(msg, isError) {
  var el = document.getElementById('portalStatusArea');
  el.className = 'status' + (isError ? ' error' : (msg ? ' info' : ''));
  el.innerHTML = msg;
}

function showPortalLoading(msg) {
  showPortalStatus('<div class="spinner"></div><br>' + (msg || 'Buscando dados...'));
}

var CODETABS = 'https://api.codetabs.com/v1/proxy?quest=';

// Página válida se tiver o dropdown de votações OU os dados dos deputados
function _htmlPortalValido(html) {
  return html && (
    html.includes('dropDownReunioes') ||
    html.includes('name="itemVotacao"') ||
    html.includes('nomePartido')
  );
}

async function fetchPortalPage(url) {
  var lastErr;

  // Tentativa 1: direto (extensão tem host_permissions para camara.leg.br)
  try {
    var r = await fetch(url);
    if (r.ok) {
      var html = await r.text();
      if (_htmlPortalValido(html))
        return new DOMParser().parseFromString(html, 'text/html');
    }
  } catch (e) { lastErr = e; }

  // Tentativa 2: codetabs (proxy público — confirmado funcional)
  try {
    var r2 = await fetch(CODETABS + encodeURIComponent(url));
    if (!r2.ok) throw new Error('Codetabs HTTP ' + r2.status);
    var html2 = await r2.text();
    if (!_htmlPortalValido(html2)) throw new Error('Página sem dados de votação');
    return new DOMParser().parseFromString(html2, 'text/html');
  } catch (e2) { lastErr = e2; }

  // Tentativa 3: Cloudflare Worker (fallback)
  if (WORKER_URL) {
    try {
      var r3 = await fetch(WORKER_URL + '?url=' + encodeURIComponent(url));
      if (!r3.ok) throw new Error('Worker HTTP ' + r3.status);
      var html3 = await r3.text();
      if (!_htmlPortalValido(html3)) throw new Error('Página sem dados de votação');
      return new DOMParser().parseFromString(html3, 'text/html');
    } catch (e3) { lastErr = e3; }
  }

  throw lastErr || new Error('Não foi possível acessar a página da Câmara.');
}

async function loadFromPortalUrl() {
  var url = document.getElementById('portalUrlInput').value.trim();
  if (!url || !url.includes('camara.leg.br')) {
    showPortalStatus('Insira um link válido do camara.leg.br.', true);
    return;
  }
  var rm = url.match(/reuniao=(\d+)/);
  if (!rm) {
    showPortalStatus('O link deve conter <b>reuniao=XXXXX</b>.', true);
    return;
  }
  var reuniao = rm[1];
  var ivm     = url.match(/itemVotacao=(\d+)/);
  var itemVotacao = ivm ? ivm[1] : null;

  var btn = document.getElementById('loadPortalBtn');
  btn.disabled = true;
  showPortalLoading('Buscando página do portal (reunião ' + reuniao + ')…');

  try {
    portalCachedBaseUrl = 'https://www.camara.leg.br/presenca-comissoes/votacao-portal?reuniao=' + reuniao;

    // Se tiver itemVotacao no link, tenta com ele; se falhar, cai para a URL base
    var doc = null;
    if (itemVotacao) {
      try {
        doc = await fetchPortalPage(portalCachedBaseUrl + '&itemVotacao=' + itemVotacao);
      } catch (e) {
        showPortalLoading('Link com itemVotacao falhou — buscando lista de votações da sessão…');
        doc = await fetchPortalPage(portalCachedBaseUrl);
      }
    } else {
      doc = await fetchPortalPage(portalCachedBaseUrl);
    }

    await _aplicarDocPortal(doc, itemVotacao);
  } catch (e) {
    showPortalStatus(
      'Erro ao carregar: ' + e.message +
      '<br><small>Tente colar o código-fonte abaixo (Ctrl+U na página → Ctrl+A → Ctrl+C).</small>', true);
    document.getElementById('portalFallbackSection').style.display = 'block';
  }
  btn.disabled = false;
}

// Função interna: popula o select e carrega o doc
async function _aplicarDocPortal(doc, preferItemVotacao) {
  // Mira no select específico da página da Câmara
  var srcSelect = doc.querySelector('#dropDownReunioes') ||
                  doc.querySelector('select[name="itemVotacao"]') ||
                  doc.querySelector('select[id*="eunio"]') ||
                  doc.querySelector('select[id*="otaca"]');

  var options = srcSelect
    ? srcSelect.querySelectorAll('option')
    : doc.querySelectorAll('option[value]');

  var select = document.getElementById('portalVotingSelect');
  select.innerHTML = '';
  var selectedIdx = null, count = 0;

  options.forEach(function (opt) {
    var val  = opt.getAttribute('value');
    var text = opt.textContent.trim();
    if (!val || !text) return;
    var o = document.createElement('option');
    o.value = val; o.textContent = text;
    select.appendChild(o);
    if (opt.hasAttribute('selected') || (preferItemVotacao && val === String(preferItemVotacao)))
      selectedIdx = val;
    count++;
  });

  if (count === 0) {
    showPortalStatus('Nenhuma votação encontrada na página.', true);
    return;
  }

  // Se nenhuma opção veio marcada como selected, usa a primeira (mais recente na lista)
  select.value = selectedIdx || select.options[0].value;
  document.getElementById('portalVotingSelectArea').classList.add('show');
  document.getElementById('portalFilterBtn').style.display = '';
  portalCachedDoc      = doc;
  portalCachedVotingId = select.value;

  await processPortalDoc(doc);
}

async function onPortalVotacaoChange() {
  var newId = document.getElementById('portalVotingSelect').value;
  if (newId === portalCachedVotingId && portalCachedDoc) {
    await processPortalDoc(portalCachedDoc);
    return;
  }
  showPortalLoading('Carregando votação…');
  try {
    var doc;
    try {
      doc = await fetchPortalPage(portalCachedBaseUrl + '&itemVotacao=' + newId);
    } catch (e) {
      // Se falhar com itemVotacao, tenta sem para mostrar o que está disponível
      showPortalLoading('Erro com itemVotacao — buscando sessão novamente…');
      doc = await fetchPortalPage(portalCachedBaseUrl);
    }
    portalCachedDoc      = doc;
    portalCachedVotingId = newId;
    await processPortalDoc(doc);
  } catch (e) {
    showPortalStatus('Erro: ' + e.message, true);
  }
}

function parseFromPortalSource() {
  var html = document.getElementById('portalHtmlSource').value;
  if (!html || !html.includes('nomePartido')) {
    showPortalStatus('HTML sem dados de votação.', true);
    return;
  }
  var doc = new DOMParser().parseFromString(html, 'text/html');
  portalCachedDoc = doc;

  var srcSel  = doc.querySelector('#dropDownReunioes') || doc.querySelector('select[name="itemVotacao"]');
  var options = srcSel ? srcSel.querySelectorAll('option') : doc.querySelectorAll('option[value]');
  var select  = document.getElementById('portalVotingSelect');
  if (select.options.length === 0) {
    select.innerHTML = '';
    options.forEach(function (opt) {
      var val = opt.getAttribute('value');
      if (!val || !/^\d+$/.test(val)) return;
      var o = document.createElement('option');
      o.value = val; o.textContent = opt.textContent.trim();
      if (opt.hasAttribute('selected')) o.selected = true;
      select.appendChild(o);
    });
    if (select.options.length > 0) {
      document.getElementById('portalVotingSelectArea').classList.add('show');
      document.getElementById('portalFilterBtn').style.display = '';
    }
  }
  processPortalDoc(doc);
}

async function processPortalDoc(doc) {
  var party = document.getElementById('portalPartyInput').value.trim();
  if (!party) { showPortalStatus('Informe o partido.', true); return; }
  showPortalLoading('Processando dados…');

  // Título da votação
  var selectedOpt = doc.querySelector('option[selected]');
  var votingDesc  = selectedOpt ? selectedOpt.textContent.trim() : 'Votação';

  // Contagens globais direto do HTML
  function getQtd(cls) {
    var el = doc.querySelector('li.' + cls + ' .qtd');
    return el ? parseInt(el.textContent.trim()) || 0 : 0;
  }
  var quorum       = getQtd('quorum');
  var totalSim     = getQtd('sim');
  var totalNao     = getQtd('nao');
  var totalAbst    = getQtd('abstencao');
  var totalObst    = getQtd('obstrucao');
  var totalVotantes = getQtd('totalVotantes');
  var vpEl         = doc.querySelector('li.votoPresidente .qtd');
  var totalArt17   = vpEl ? parseInt(vpEl.textContent.trim()) || 0 : 0;

  // Data da sessão
  var sessionDate = '';
  var ri = doc.querySelector('.reuniaoDataLocal');
  if (ri) {
    var dm = ri.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (dm) sessionDate = dm[1];
  }

  // Orientações
  var orientacao = '', orientGoverno = '';
  doc.querySelectorAll('.lideranca').forEach(function (el) {
    var name = el.textContent.trim().toUpperCase();
    var pLi  = el.closest('li');
    var vEl  = pLi ? pLi.querySelector('.voto') : null;
    var voto = vEl ? vEl.textContent.trim() : '';
    if (!orientacao   && name.includes(party.toUpperCase())) orientacao   = voto;
    if (!orientGoverno && name === 'GOVERNO')                orientGoverno = voto;
  });

  // Normaliza nome para dedup: remove títulos, iniciais e espaços → só letras
  function normNome(nome) {
    return nome.toUpperCase()
      .replace(/\b(DR\.?|DRA\.?|DEL\.?|DELEGAD[OA]\.?|PROF\.?|PROFESSORA?\.?|DEP\.?)\b\.?\s*/g, '')
      .replace(/\b[A-Z]\.\s*/g, '')       // iniciais como "H.", "B."
      .replace(/[^A-ZÁÉÍÓÚÀÃÕÇÂÊÎ]/g, ''); // só letras, sem espaços ou pontuação
  }
  // Verdadeiro se as chaves normalizadas indicam o mesmo deputado
  function mesmoDeputado(a, b) {
    if (a === b) return true;
    var shorter = a.length <= b.length ? a : b;
    var longer  = a.length <= b.length ? b : a;
    return shorter.length >= 6 && longer.startsWith(shorter);
  }

  // Deputados presentes na página
  var allDeps = [];
  doc.querySelectorAll('li').forEach(function (li) {
    var nEl = li.querySelector('span.nome');
    var pEl = li.querySelector('span.nomePartido');
    if (!nEl || !pEl) return;
    var nome  = nEl.textContent.trim();
    var pFull = pEl.textContent.trim();
    var voto  = '';
    var vCls  = 'absent';
    var votouEl = li.querySelector('span.votou');
    if (votouEl) {
      var vs = votouEl.querySelector('span.voto');
      if (vs) {
        voto = vs.textContent.trim();
        if      (vs.classList.contains('sim'))  vCls = 'sim';
        else if (vs.classList.contains('nao'))  vCls = 'nao';
        else if (voto.includes('Art'))          vCls = 'art17';
        else if (voto.toLowerCase().includes('abst'))  vCls = 'abstencao';
        else if (voto.toLowerCase().includes('obstr')) vCls = 'obstrucao';
      }
    }
    var ufM  = pFull.match(/-([A-Z]{2})\)/);
    var sigM = pFull.match(/\(([^-)]+)/);
    // Tenta extrair ID do deputado de link no li (ex: href="/deputados/12345/...")
    var depId = null;
    var aEl = li.querySelector('a[href*="/deputados/"]');
    if (aEl) {
      var idM = (aEl.getAttribute('href') || '').match(/\/deputados\/(\d+)/);
      if (idM) depId = idM[1];
    }
    allDeps.push({
      id:           depId,
      nome:         nome,
      siglaPartido: sigM ? sigM[1].trim() : '',
      siglaUf:      ufM  ? ufM[1]         : '',
      tipoVoto:     voto || null,
      votoClass:    vCls
    });
  });

  // Resolve sigla oficial antes de filtrar (evita PODE ⊂ PODEMOS)
  var siglaAPI = party.toUpperCase();
  try {
    var resolvedSigla = await resolvePartySigla(party);
    if (resolvedSigla) siglaAPI = resolvedSigla.toUpperCase();
  } catch (e) {}

  // Filtrar pelo partido — comparação exata com sigla normalizada
  var partyLower   = party.toLowerCase();
  var siglaAPILower = siglaAPI.toLowerCase();
  var filtered = allDeps.filter(function (d) {
    var sp = d.siglaPartido.toUpperCase();
    if (sp === siglaAPI || sp.toLowerCase() === partyLower) return true;
    // Normaliza via cache (ex: "Podemos" no HTML → sigla "PODE" na API)
    if (partiesCache && partiesCache[sp]) {
      return partiesCache[sp].sigla.toUpperCase() === siglaAPI;
    }
    return false;
  });

  // Completar com roster da API (para ausentes não listados)
  try {
    var dResp = await fetch(API + '/deputados?siglaPartido=' + siglaAPI + '&itens=100&ordem=ASC&ordenarPor=nome');
    if (dResp.ok) {
      var dData   = await dResp.json();
      var roster  = dData.dados || [];
      var existingIds   = {};
      var existingChaves = [];
      filtered.forEach(function (d) {
        if (d.id) existingIds[d.id] = true;
        existingChaves.push(normNome(d.nome));
      });
      roster.forEach(function (dep) {
        var depId    = String(dep.id || '');
        var depChave = normNome(dep.nome);
        if (depId && existingIds[depId]) return;
        if (existingChaves.some(function(c) { return mesmoDeputado(c, depChave); })) return;
        filtered.push({
          nome: dep.nome, siglaPartido: dep.siglaPartido, siglaUf: dep.siglaUf,
          tipoVoto: null, votoClass: 'absent'
        });
      });
    }
  } catch (e) { /* API lenta — usa só dados do portal */ }

  filtered.sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });

  if (filtered.length === 0) {
    showPortalStatus('Nenhum deputado encontrado para "' + party + '".', true);
    document.getElementById('portalResultsArea').innerHTML = '';
    document.getElementById('portalGenerateArea').classList.remove('show');
    return;
  }

  // Contagens da bancada
  var pSim=0, pNao=0, pAbst=0, pArt17=0, pObst=0, pAusente=0;
  filtered.forEach(function (d) {
    if      (d.votoClass === 'sim')       pSim++;
    else if (d.votoClass === 'nao')       pNao++;
    else if (d.votoClass === 'abstencao') pAbst++;
    else if (d.votoClass === 'art17')     pArt17++;
    else if (d.votoClass === 'obstrucao') pObst++;
    else                                  pAusente++;
  });

  var orientCls    = votoClass(orientacao);
  var orientHTML   = orientacao
    ? '<div class="orientation-banner"><span class="ob-label">Orientação da Liderança</span>' +
      '<span class="ob-party">' + siglaAPI + '</span>' +
      '<span class="ob-vote" style="color:' + votoColor(orientCls) + '">' + orientacao + '</span></div>'
    : '';
  var orientGovHTML = orientGoverno
    ? '<div class="orientation-banner"><span class="ob-label">Orientação do</span>' +
      '<span class="ob-party">GOVERNO</span>' +
      '<span class="ob-vote" style="color:' + votoColor(votoClass(orientGoverno)) + '">' + orientGoverno + '</span></div>'
    : '';

  var chartId = 'wpchart-' + Math.random().toString(36).slice(2, 8);

  var legendItems =
    (pSim    > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#3ad97d"></span>Sim<span class="legend-value" style="color:#3ad97d">'       + pSim    + '</span></div>' : '') +
    (pNao    > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#f05454"></span>Não<span class="legend-value" style="color:#f05454">'       + pNao    + '</span></div>' : '') +
    (pAbst   > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#f0c040"></span>Abstenção<span class="legend-value" style="color:#f0c040">' + pAbst   + '</span></div>' : '') +
    (pArt17  > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#6eaaff"></span>Art. 17<span class="legend-value" style="color:#6eaaff">'   + pArt17  + '</span></div>' : '') +
    (pObst   > 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#c084fc"></span>Obstrução<span class="legend-value" style="color:#c084fc">' + pObst   + '</span></div>' : '') +
    (pAusente> 0 ? '<div class="legend-item"><span class="legend-dot" style="background:#5a6f74"></span>Ausente<span class="legend-value" style="color:#5a6f74">'   + pAusente+ '</span></div>' : '');

  var rows = '';
  filtered.forEach(function (d) {
    rows +=
      '<div class="deputy-item">' +
        '<div><div class="deputy-name">'  + (d.nome || '?') + '</div>' +
        '<div class="deputy-party">(' + (d.siglaPartido || '?') + '-' + (d.siglaUf || '?') + ')</div></div>' +
        '<div class="deputy-vote ' + d.votoClass + '">' + (d.tipoVoto || '') + '</div>' +
      '</div>';
  });

  var sourceBadge = '<span class="vote-source-badge" style="background:rgba(255,170,50,0.15);color:#ffb347;border:1px solid rgba(255,170,50,0.3);margin-left:6px;">🌐 Portal Web</span>';

  document.getElementById('portalStatusArea').innerHTML = '';
  document.getElementById('portalResultsArea').innerHTML =
    '<div class="vote-header">' +
      '<div class="vote-title-bar">' +
        '<div><span class="vote-party-badge">partido: ' + siglaAPI + '</span>' + sourceBadge + '</div>' +
        '<div class="vote-description">' + votingDesc + '</div>' +
        '<div class="vote-dates">' + sessionDate + ' · PLEN</div>' +
      '</div>' +
      '<div class="quorum-big"><div class="q-label">Quórum da votação</div><div class="q-value">' + quorum + '</div></div>' +
      '<div class="result-title">Resultado final</div>' +
      '<div class="result-row"><span class="r-label">Sim</span><span class="r-value sim">'              + totalSim   + '</span></div>' +
      '<div class="result-row"><span class="r-label">Não</span><span class="r-value nao">'              + totalNao   + '</span></div>' +
      '<div class="result-row"><span class="r-label">Abstenção</span><span class="r-value abstencao">'  + totalAbst  + '</span></div>' +
      '<div class="result-row"><span class="r-label">Art. 17</span><span class="r-value art17">'        + totalArt17 + '</span></div>' +
      '<div class="result-row"><span class="r-label">Obstrução</span><span class="r-value obstrucao">'  + totalObst  + '</span></div>' +
      '<div class="result-divider"></div>' +
      '<div class="result-total"><span>Total</span><span>' + totalVotantes + '</span></div>' +
      orientHTML + orientGovHTML +
    '</div>' +
    '<div class="vote-header" style="margin-bottom:16px">' +
      '<div class="result-title" style="padding-top:14px">Bancada ' + siglaAPI + '</div>' +
      '<div class="chart-section">' +
        '<canvas class="bancada-chart-canvas" id="' + chartId + '" width="120" height="120"></canvas>' +
        '<div class="chart-legend">' + legendItems + '</div>' +
      '</div>' +
      '<div class="result-divider"></div>' +
      '<div class="result-total"><span>Total bancada</span><span>' + filtered.length + '</span></div>' +
    '</div>' +
    '<div class="deputy-list">' +
      '<div class="deputy-list-header"><h3>Deputados</h3><span class="deputy-count">' + filtered.length + ' parlamentares</span></div>' +
      rows +
    '</div>';

  var canvas = document.getElementById(chartId);
  if (canvas) drawPieCanvas(canvas, pSim, pNao, pAbst, pArt17, pObst, pAusente);

  portalLastRenderData = {
    sigla: siglaAPI, votingDesc: votingDesc, sessionDate: sessionDate,
    quorum: quorum, totalSim: totalSim, totalNao: totalNao, totalAbst: totalAbst,
    totalArt17: totalArt17, totalObst: totalObst, totalVotantes: totalVotantes,
    merged: filtered, pSim: pSim, pNao: pNao, pAbst: pAbst, pArt17: pArt17,
    pObst: pObst, pAusente: pAusente, orientHTML: orientHTML, orientGovHTML: orientGovHTML
  };

  document.getElementById('portalGenerateArea').classList.add('show');
  document.getElementById('portalGenerateStatus').textContent = '';
}

async function refreshPortalVotacao() {
  if (!portalCachedBaseUrl) return;
  var btn = document.getElementById('refreshPortalBtn');
  btn.disabled = true;
  showPortalLoading('Buscando nova votação na sessão…');
  try {
    // Sempre busca sem itemVotacao para pegar a lista completa e a votação mais recente
    var doc = await fetchPortalPage(portalCachedBaseUrl);
    await _aplicarDocPortal(doc, null);
  } catch (e) {
    showPortalStatus('Erro ao atualizar: ' + e.message, true);
  }
  btn.disabled = false;
}

async function refilterPortal() {
  if (portalCachedDoc) await processPortalDoc(portalCachedDoc);
}

async function generatePortalImage() {
  var D = portalLastRenderData;
  if (!D) return;
  var btn    = document.getElementById('portalGenerateBtn');
  var status = document.getElementById('portalGenerateStatus');
  btn.disabled = true;
  status.textContent = 'Gerando imagem, aguarde...';

  var off = null;
  try {
    var resultsArea = document.getElementById('portalResultsArea');
    if (!resultsArea) throw new Error('Área de resultados não encontrada');

    // Clone the rendered HTML exactly as displayed, then append signature
    off = document.createElement('div');
    off.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + resultsArea.offsetWidth + 'px;background:#0e1c1f;padding:0;font-family:DM Sans,sans-serif;color:#e8ecec;';
    off.innerHTML = resultsArea.innerHTML +
      '<div class="signature">' +
        '<div class="signature-line"></div>' +
        '<div class="signature-text">Liderança do Podemos</div>' +
        '<div class="signature-sub">Câmara dos Deputados · ' + D.sessionDate + '</div>' +
      '</div>';

    // Re-draw the pie chart that exists in the cloned HTML
    var origCanvas = resultsArea.querySelector('canvas.bancada-chart-canvas');
    var cloneCanvas = off.querySelector('canvas.bancada-chart-canvas');
    if (origCanvas && cloneCanvas) {
      cloneCanvas.width  = origCanvas.width;
      cloneCanvas.height = origCanvas.height;
      drawPieCanvas(cloneCanvas, D.pSim, D.pNao, D.pAbst, D.pArt17, D.pObst, D.pAusente);
    }

    document.body.appendChild(off);
    await new Promise(function (r) { setTimeout(r, 100); });

    var c2 = await html2canvas(off, { backgroundColor: '#0e1c1f', scale: 2, useCORS: true, logging: false });
    document.body.removeChild(off);
    off = null;

    var link      = document.createElement('a');
    link.download = 'votacao-' + D.sigla.toLowerCase() + '-' + (D.sessionDate || 'portal').replace(/\//g, '-') + '.png';
    link.href     = c2.toDataURL('image/png');
    link.click();

    status.textContent = 'Imagem salva com sucesso!';
    setTimeout(function () { status.textContent = ''; }, 3000);
  } catch (e) {
    status.textContent = 'Erro ao gerar imagem: ' + e.message;
    if (off && off.parentNode) off.parentNode.removeChild(off);
  }
  btn.disabled = false;
}

/* ══════════════════════════════════════════
   EVENT LISTENERS (sem inline handlers — MV3 CSP)
══════════════════════════════════════════ */

// Navegação
document.getElementById('btn-voltar-home').addEventListener('click', function () { window.close(); });

// Abas
document.getElementById('tabHistorico').addEventListener('click', function () { switchTab('historico'); });
document.getElementById('tabPortal').addEventListener('click',    function () { switchTab('portal'); });

// Aba Dados Abertos
document.getElementById('loadBtn').addEventListener('click', loadEvent);
document.getElementById('votingSelect').addEventListener('change', loadVotes);
document.getElementById('filterBtn').addEventListener('click', refilter);
document.getElementById('generateBtn').addEventListener('click', function () { generateImage(); });

document.getElementById('partyInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && cachedVotos) refilter();
});
document.getElementById('dateInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') loadEvent();
});

// Aba Portal Web
document.getElementById('detectPlenarioBtn').addEventListener('click', detectSessaoEmAndamento);
document.getElementById('loadPortalBtn').addEventListener('click', loadFromPortalUrl);
document.getElementById('refreshPortalBtn').addEventListener('click', refreshPortalVotacao);
document.getElementById('portalVotingSelect').addEventListener('change', onPortalVotacaoChange);
document.getElementById('portalFilterBtn').addEventListener('click', refilterPortal);
document.getElementById('portalParseBtn').addEventListener('click', parseFromPortalSource);
document.getElementById('portalGenerateBtn').addEventListener('click', generatePortalImage);

document.getElementById('portalPartyInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && portalCachedDoc) refilterPortal();
});
document.getElementById('portalUrlInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') loadFromPortalUrl();
});

// Data padrão: hoje na aba Dados Abertos
(function () {
  var t     = new Date();
  var today = t.getFullYear() + '-' +
    String(t.getMonth() + 1).padStart(2, '0') + '-' +
    String(t.getDate()).padStart(2, '0');
  document.getElementById('dateInput').value = today;
})();
