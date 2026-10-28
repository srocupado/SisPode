// Análise da pauta: o HTML da Câmara vai ao DOMParser sem atributos de evento.
//
// O caso (28/10/2026): a página de pareceres (prop_pareceres_substitutivos_votos)
// traz os links de inteiro teor com onclick="" e onkeypress="", e o Chrome
// registrava em chrome://extensions "Executing inline event handler violates …
// Content Security Policy" a cada leitura (analise.js, buscarPareceresPlenario).
// fetchHtmlCamara agora devolve o HTML sem esses atributos — e sem tocar no resto.
// Uso: node testes/analise-sem-eventos.test.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const semEventosInline = new Function(src.match(/function semEventosInline\([\s\S]*?\n}/)[0] + '; return semEventosInline;')();

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const link = '<a class="linkDownloadTeor" href="prop_mostrarintegra?codteor=3186277&amp;filename=PRLP+1+%3D%3E+PDL+274/2026" onclick="" onkeypress="" title="Clique para obter o inteiro teor">PRLP 1</a>';
ok(semEventosInline(link) === '<a class="linkDownloadTeor" href="prop_mostrarintegra?codteor=3186277&amp;filename=PRLP+1+%3D%3E+PDL+274/2026" title="Clique para obter o inteiro teor">PRLP 1</a>',
   'link de inteiro teor da página real: sai o onclick/onkeypress, ficam href e title');
ok(semEventosInline('<img src=x onerror=alert(1)>') === '<img src=x>', 'sem aspas também');
ok(semEventosInline('<td data-x="a > b" onmouseover=\'z()\'>1</td>') === '<td data-x="a > b">1</td>', '">" dentro de um valor entre aspas não corta a tag');
ok(semEventosInline('<a title="conteúdo com onda=1">texto onclick=1</a>') === '<a title="conteúdo com onda=1">texto onclick=1</a>', '"on…=" dentro de um valor ou no texto não é atributo: fica');
ok(semEventosInline('<p>a monitoria = b</p><br/><input disabled onfocus=x>') === '<p>a monitoria = b</p><br/><input disabled>', 'atributo sem valor e tag que fecha sozinha');
ok(/return semEventosInline\(html\)/.test(src.match(/async function fetchHtmlCamara\([\s\S]*?\n}/)[0]), 'fetchHtmlCamara devolve o HTML já limpo');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
