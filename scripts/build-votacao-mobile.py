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

out = ROOT / 'votacao-mobile.html'
out.write_text(html, encoding='utf-8')
print(f'Wrote {out} ({out.stat().st_size:,} bytes)')
