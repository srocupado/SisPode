// Pauta: o relator aparece como "Dep. Nome (PARTIDO-UF)", venha de onde vier.
//
// O caso (28/10/2026): a Ordem do Dia importada pelo bot (bot/src/odd.js)
// gravava o relator só como texto (o nome), e a pauta mostrava
// "Relator: Dep. (undefined-undefined) — undefined" — PL 68/2025 e outros.
// O bot passa a gravar { nome, partido, uf, data } (o formato do parser da
// extensão), e a extensão aceita também o formato antigo, já gravado no Firebase.
// Uso: node testes/analise-relator.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const { normalizarRelator, textoRelator } = new Function(`${trecho(/function normalizarRelator\([\s\S]*?\n}/)}\n${trecho(/function textoRelator\([\s\S]*?\n}/)}\nreturn { normalizarRelator, textoRelator };`)();

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

console.log('== formatos do relator ==');
ok(textoRelator({ nome: 'Natália Bonavides', partido: 'PT', uf: 'RN', data: '10/09/2025' }, true) === 'Dep. Natália Bonavides (PT-RN) — 10/09/2025', 'do PDF da pauta: completo, com a data');
ok(textoRelator('Natália Bonavides', true) === 'Dep. Natália Bonavides', 'formato antigo do bot (só o nome): sem "undefined"');
ok(textoRelator({ nome: 'Natália Bonavides', partido: 'PT', uf: 'RN', data: '' }, true) === 'Dep. Natália Bonavides (PT-RN)', 'sem data: sem " — "');
ok(textoRelator({ nome: 'Fulano', partido: 'PT' }) === 'Dep. Fulano (PT)', 'sem UF: só o partido');
ok(normalizarRelator('') === null && normalizarRelator(null) === null && normalizarRelator({ partido: 'PT' }) === null, 'sem nome: sem relator');
ok(JSON.stringify(normalizarRelator('Fulano')) === JSON.stringify({ nome: 'Fulano', partido: '', uf: '', data: '' }), 'texto vira o objeto da tela');

console.log('\n== a tela não monta mais o relator à mão ==');
ok(!/it\.relator\.partido\}-\$\{it\.relator\.uf/.test(src) && !/\(\$\{esc\(it\.relator\.partido\)\}/.test(src), 'nenhum "(${partido}-${uf})" direto do item');
ok((src.match(/relator: normalizarRelator\(it\.relator\)/g) || []).length >= 3, 'importação do PDF e as duas cargas do Firebase normalizam o relator');

console.log('\n== o bot grava o relator completo ==');
const odd = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'odd.js'), 'utf8');
const itemDaApi = new Function(odd.match(/function itemDaApi\([\s\S]*?\n}/)[0] + '; return itemDaApi;')();
// Item da API real (evento 83108, 28/10/2026), PL 68/2025.
const it = itemDaApi({ ordem: 4, regime: 'Urgência (Art. 155, RICD)', proposicao_: { siglaTipo: 'PL', numero: 68, ano: 2025, ementa: 'Altera a Lei nº 14.192…' },
  relator: { id: 204453, nome: 'Natália Bonavides', siglaPartido: 'PT', siglaUf: 'RN', idLegislatura: 57 } });
ok(JSON.stringify(it.relator) === JSON.stringify({ nome: 'Natália Bonavides', partido: 'PT', uf: 'RN', data: '' }), `PL 68/2025: ${JSON.stringify(it.relator)}`);
ok(textoRelator(it.relator) === 'Dep. Natália Bonavides (PT-RN)', 'e a tela mostra "Dep. Natália Bonavides (PT-RN)"');
ok(itemDaApi({ proposicao_: { siglaTipo: 'REQ', numero: 1, ano: 2026 }, relator: null }).relator === null, 'sem relator na API: null');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
