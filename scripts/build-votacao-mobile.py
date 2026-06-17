#!/usr/bin/env python3
"""
Gera votacao-mobile.html: versão autocontida do módulo Votação para abrir
em navegador comum (celular), sem a extensão do Chrome.

Uso: python3 scripts/build-votacao-mobile.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / 'votacao.html').read_text(encoding='utf-8')
html2canvas = (ROOT / 'libs' / 'html2canvas.min.js').read_text(encoding='utf-8')
votacao_js = (ROOT / 'votacao.js').read_text(encoding='utf-8')

# Substitui o WORKER_URL hardcoded por um valor lido de localStorage.
# Assim o usuário pode apontar para o próprio Cloudflare Worker sem editar o JS.
old_worker_const = (
    "const WORKER_URL = 'https://shrill-resonance-4d17.vinicius-const.workers.dev/';"
)
new_worker_const = (
    "const WORKER_URL = (function(){"
    " try { return localStorage.getItem('sispode.workerUrl') || ''; }"
    " catch(e) { return ''; }"
    " })();"
)
if old_worker_const not in votacao_js:
    sys.exit('Não encontrei a const WORKER_URL — votacao.js mudou; ajustar o script.')
votacao_js = votacao_js.replace(old_worker_const, new_worker_const)

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
    sys.exit('Não encontrei o bloco da top-bar — votacao.html mudou; ajustar o script.')
html = html.replace(old_topbar, new_topbar)

html = html.replace(
    '<title>Plenário — Votação · Podemos</title>',
    '<title>Plenário — Votação · Podemos (Mobile)</title>'
)

# UI para configurar o proxy CORS (necessário para a aba Link Portal sem
# extensão). Injetada como primeiro bloco dentro de #tab-portal.
proxy_config_block = '''<div id="tab-portal" style="display:none">
    <div class="input-section" id="proxyConfigSection" style="border-color:rgba(31,165,165,0.4)">
      <label>Proxy CORS (obrigatório nesta aba)</label>
      <div class="input-row">
        <input type="url" class="field" id="proxyUrlInput" placeholder="https://seu-worker.workers.dev/" inputmode="url" autocomplete="off" autocapitalize="off" />
        <button class="btn btn-sm" id="proxySaveBtn">Salvar</button>
      </div>
      <p class="help-text" id="proxyStatus" style="text-align:left;margin-top:8px;"></p>
    </div>
'''
old_portal_open = '<div id="tab-portal" style="display:none">'
if old_portal_open not in html:
    sys.exit('Não encontrei a abertura de #tab-portal — votacao.html mudou; ajustar o script.')
html = html.replace(old_portal_open, proxy_config_block, 1)

# Script que popula/salva o proxy. Roda depois do votacao.js.
proxy_runtime_script = '''<script>
(function () {
  var KEY = 'sispode.workerUrl';
  var input  = document.getElementById('proxyUrlInput');
  var btn    = document.getElementById('proxySaveBtn');
  var status = document.getElementById('proxyStatus');
  if (!input || !btn || !status) return;

  function render() {
    var cur = '';
    try { cur = localStorage.getItem(KEY) || ''; } catch (e) {}
    input.value = cur;
    if (cur) {
      status.innerHTML = '✅ Proxy configurado: <code style="color:var(--accent-light)">' +
        cur.replace(/</g, '&lt;') + '</code>';
    } else {
      status.innerHTML = '⚠️ Sem proxy esta aba não funciona no celular. ' +
        'Deploye um Cloudflare Worker (código em <code>cloudflare-worker.js</code>) ' +
        'e cole a URL acima.';
    }
  }

  btn.addEventListener('click', function () {
    var v = (input.value || '').trim();
    try {
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch (e) {
      status.textContent = 'Falha ao salvar no localStorage: ' + e.message;
      return;
    }
    status.textContent = 'Salvo. Recarregando…';
    setTimeout(function () { location.reload(); }, 350);
  });

  render();
})();
</script>
</body>'''
html = html.replace('</body>', proxy_runtime_script, 1)

out = ROOT / 'votacao-mobile.html'
out.write_text(html, encoding='utf-8')
print(f'Wrote {out} ({out.stat().st_size:,} bytes)')
