#!/usr/bin/env python3
"""
Gera votacao-mobile.html: versão autocontida do módulo Votação para abrir
em navegador comum (celular), sem a extensão do Chrome.

A aba "Link Portal" é reescrita aqui para usar somente a API Dados Abertos
(dadosabertos.camara.leg.br) — que tem CORS habilitado — eliminando a
necessidade de raspar o HTML do portal e qualquer proxy CORS.

Uso: python3 scripts/build-votacao-mobile.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / 'votacao.html').read_text(encoding='utf-8')
html2canvas = (ROOT / 'libs' / 'html2canvas.min.js').read_text(encoding='utf-8')
votacao_js = (ROOT / 'votacao.js').read_text(encoding='utf-8')


def replace_async_fn(js, name, replacement):
    """Substitui 'async function NAME(...) { ... }' (top-level) pelo replacement.
    Identifica início e fim por '^async function NAME' até '^}' (chave em col 0)."""
    pattern = re.compile(
        r'^async function ' + re.escape(name) + r'\b[^\n]*\n(?:.*?\n)*?\}\n',
        re.MULTILINE,
    )
    repl_text = replacement.rstrip() + '\n'
    new_js, n = pattern.subn(lambda m: repl_text, js, count=1)
    if n == 0:
        sys.exit(f'Não encontrei async function {name}')
    return new_js


# Declara o cache compartilhado entre as novas funções do portal.
# Inserido logo após as outras variáveis de cache do portal.
old_cache_block = 'var portalCachedDoc     = null;'
new_cache_block = (
    'var portalCachedDoc     = null;\n'
    'var portalCachedVotacoes = null;'
)
if old_cache_block not in votacao_js:
    sys.exit('Não encontrei o bloco de cache do portal — votacao.js mudou.')
votacao_js = votacao_js.replace(old_cache_block, new_cache_block, 1)


# ── Substituições das funções da aba "Link Portal" ─────────────────
# Todas usam API Dados Abertos (CORS-ok) — sem raspagem de HTML, sem proxy.

votacao_js = replace_async_fn(votacao_js, 'detectSessaoEmAndamento', r"""
async function detectSessaoEmAndamento() {
  var btn = document.getElementById('detectPlenarioBtn');
  btn.disabled = true;
  btn.textContent = '🔍 Buscando…';
  showPortalStatus('<div class="spinner"></div><br>Procurando sessão de Plenário em andamento…');
  try {
    var t = new Date();
    var hojeStr = t.getFullYear() + '-' +
      String(t.getMonth() + 1).padStart(2, '0') + '-' +
      String(t.getDate()).padStart(2, '0');
    // codSituacao=3 (Em Andamento), codTipoEvento=110 (Sessão Deliberativa)
    var resp = await fetch(API + '/eventos?dataInicio=' + hojeStr +
      '&codSituacao=3&codTipoEvento=110&itens=30');
    var evento = null;
    if (resp.ok) {
      var data = await resp.json();
      evento = (data.dados || []).find(function (e) {
        return (e.orgaos || []).some(function (o) { return o.sigla === 'PLEN'; });
      });
    }
    if (!evento) {
      var resp2 = await fetch(API + '/eventos?dataInicio=' + hojeStr +
        '&codSituacao=3&itens=50');
      if (resp2.ok) {
        var data2 = await resp2.json();
        evento = (data2.dados || []).find(function (e) {
          return (e.orgaos || []).some(function (o) { return o.sigla === 'PLEN'; });
        });
      }
    }
    if (!evento) {
      showPortalStatus(
        'Nenhuma sessão de Plenário em andamento agora.<br>' +
        '<small>Se a Câmara já abriu, cole o link manualmente.</small>', true);
      return;
    }
    document.getElementById('portalUrlInput').value =
      'https://www.camara.leg.br/presenca-comissoes/votacao-portal?reuniao=' + evento.id;
    showPortalStatus('Sessão detectada — reunião ' + evento.id + '. Carregando votações…');
    await loadFromPortalUrl();
  } catch (e) {
    showPortalStatus('Erro ao buscar sessão: ' + e.message +
      '<br><small>Cole o link manualmente.</small>', true);
  }
  btn.disabled = false;
  btn.textContent = '🔍 Detectar sessão em andamento';
}
""")

votacao_js = replace_async_fn(votacao_js, 'loadFromPortalUrl', r"""
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
  var eventoId = rm[1];
  var ivm = url.match(/itemVotacao=(\d+)/);
  var preferItem = ivm ? ivm[1] : null;

  var btn = document.getElementById('loadPortalBtn');
  btn.disabled = true;
  showPortalLoading('Carregando votações da reunião ' + eventoId + '…');
  try {
    var resp = await fetch(API + '/eventos/' + eventoId + '/votacoes');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    var lista = (data.dados || []).slice();
    if (lista.length === 0) {
      showPortalStatus('Nenhuma votação registrada nesta reunião ainda.<br>' +
        '<small>A primeira votação aparece após registro pela Mesa.</small>', true);
      btn.disabled = false;
      return;
    }
    lista.sort(function (a, b) {
      return (b.dataHoraRegistro || '').localeCompare(a.dataHoraRegistro || '');
    });
    portalCachedBaseUrl =
      'https://www.camara.leg.br/presenca-comissoes/votacao-portal?reuniao=' + eventoId;
    portalCachedVotacoes = lista;

    var select = document.getElementById('portalVotingSelect');
    select.innerHTML = '';
    lista.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v.id;
      var hora = v.dataHoraRegistro
        ? v.dataHoraRegistro.split('T')[1].substring(0, 5) : '';
      opt.textContent = (hora ? hora + ' — ' : '') + (v.descricao || 'Votação');
      select.appendChild(opt);
    });
    select.value =
      (preferItem && lista.some(function (v) { return String(v.id) === String(preferItem); }))
        ? preferItem : String(lista[0].id);
    document.getElementById('portalVotingSelectArea').classList.add('show');
    document.getElementById('portalFilterBtn').style.display = '';
    portalCachedVotingId = select.value;
    await onPortalVotacaoChange();
  } catch (e) {
    showPortalStatus('Erro ao carregar: ' + e.message, true);
  }
  btn.disabled = false;
}
""")

votacao_js = replace_async_fn(votacao_js, 'onPortalVotacaoChange', r"""
async function onPortalVotacaoChange() {
  if (!portalCachedVotacoes) return;
  var id = document.getElementById('portalVotingSelect').value;
  var votacao = null;
  for (var i = 0; i < portalCachedVotacoes.length; i++) {
    if (String(portalCachedVotacoes[i].id) === String(id)) {
      votacao = portalCachedVotacoes[i];
      break;
    }
  }
  if (!votacao) return;
  portalCachedVotingId = id;
  await _renderPortalVotacaoApi(votacao);
}
""")

votacao_js = replace_async_fn(votacao_js, 'refreshPortalVotacao', r"""
async function refreshPortalVotacao() {
  if (!portalCachedBaseUrl) {
    showPortalStatus('Detecte ou carregue uma sessão antes de atualizar.', true);
    return;
  }
  var btn = document.getElementById('refreshPortalBtn');
  btn.disabled = true;
  showPortalLoading('Buscando atualização…');
  try {
    document.getElementById('portalUrlInput').value = portalCachedBaseUrl;
    await loadFromPortalUrl();
  } catch (e) {
    showPortalStatus('Erro ao atualizar: ' + e.message, true);
  }
  btn.disabled = false;
}
""")

votacao_js = replace_async_fn(votacao_js, 'refilterPortal', r"""
async function refilterPortal() {
  if (!portalCachedVotacoes) return;
  var id = document.getElementById('portalVotingSelect').value;
  var votacao = null;
  for (var i = 0; i < portalCachedVotacoes.length; i++) {
    if (String(portalCachedVotacoes[i].id) === String(id)) {
      votacao = portalCachedVotacoes[i];
      break;
    }
  }
  if (votacao) await _renderPortalVotacaoApi(votacao);
}
""")

votacao_js = replace_async_fn(votacao_js, 'generatePortalImage', r"""
async function generatePortalImage() {
  return await generateImage(portalLastRenderData);
}

async function _renderPortalVotacaoApi(votacao) {
  var rawParty = document.getElementById('portalPartyInput').value.trim();
  if (!rawParty) { showPortalStatus('Informe o partido.', true); return; }
  showPortalLoading('Carregando votos e orientações…');
  try {
    var results = await Promise.all([
      fetch(API + '/votacoes/' + votacao.id + '/votos'),
      fetch(API + '/votacoes/' + votacao.id + '/orientacoes').catch(function () { return null; })
    ]);
    if (!results[0].ok) throw new Error('HTTP ' + results[0].status + ' nos votos');
    var votosData = await results[0].json();
    var orientData = (results[1] && results[1].ok)
      ? await results[1].json() : { dados: [] };
    var votos = votosData.dados || [];
    var orient = orientData.dados || [];

    var sigla = await resolvePartySigla(rawParty);
    var allDeputados = [];
    try {
      var dResp = await fetch(API + '/deputados?siglaPartido=' + sigla +
        '&itens=100&ordem=ASC&ordenarPor=nome');
      if (dResp.ok) {
        var dData = await dResp.json();
        allDeputados = dData.dados || [];
      }
    } catch (e) {}

    document.getElementById('portalStatusArea').innerHTML = '';
    var built = buildVotingHTML(sigla, votos, orient, votacao, allDeputados, 'da');
    document.getElementById('portalResultsArea').innerHTML = built.resultsHTML;
    portalLastRenderData = built.renderData;
    if (built.chartId && built.renderData) {
      var c = document.getElementById(built.chartId);
      if (c) drawPieCanvas(c,
        built.renderData.pSim, built.renderData.pNao, built.renderData.pAbst,
        built.renderData.pArt17, built.renderData.pObst, built.renderData.pAusente);
    }
    document.getElementById('portalGenerateArea').classList.add('show');
    document.getElementById('portalGenerateStatus').textContent = '';
  } catch (e) {
    showPortalStatus('Erro: ' + e.message, true);
  }
}
""")


html = re.sub(
    r'<script src="libs/html2canvas\.min\.js"></script>',
    lambda m: '<script>\n' + html2canvas + '\n</script>',
    html, count=1
)
html = re.sub(
    r'<script src="votacao\.js"></script>',
    lambda m: '<script>\n' + votacao_js + '\n</script>',
    html, count=1
)

old_topbar = '''<div class="top-bar-row">
    <button class="top-bar-back" id="btn-voltar-home">← Início</button>
    <span class="top-bar-title">Plenário — Votação</span>
    <div style="width:80px"></div>
  </div>'''

new_topbar = '''<div class="top-bar-row" style="justify-content:center">
    <button class="top-bar-back" id="btn-voltar-home" style="display:none">← Início</button>
    <span class="top-bar-title">Plenário — Votação</span>
  </div>'''

if old_topbar not in html:
    sys.exit('Não encontrei o bloco da top-bar — votacao.html mudou.')
html = html.replace(old_topbar, new_topbar)

html = html.replace(
    '<title>Plenário — Votação · Podemos</title>',
    '<title>Plenário — Votação · Podemos (Mobile)</title>'
)

# A seção de fallback de paste HTML não serve mais (usamos só API)
html = html.replace(
    'id="portalFallbackSection" style="display:none;margin-top:12px;"',
    'id="portalFallbackSection" style="display:none !important"',
    1,
)

out = ROOT / 'votacao-mobile.html'
out.write_text(html, encoding='utf-8')
print(f'Wrote {out} ({out.stat().st_size:,} bytes)')
