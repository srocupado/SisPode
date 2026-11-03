// Bot · /update: o parser da pauta (raiz do repo) vem junto, e a lista de
// arquivos aplicada decide se o mesmo commit precisa ser baixado de novo.
// Uso: node testes/bot-autoupdate.test.js
const path = require('path'), fs = require('fs');
const RAIZ = path.join(__dirname, '..');
const A = require(path.join(RAIZ, 'bot', 'src', 'autoupdate.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'autoupdate.js'), 'utf8');
ok(/\{ repo: 'pauta-parser\.js', local: path\.join\('\.\.', 'pauta-parser\.js'\) \}/.test(src), 'a lista do /update traz o pauta-parser.js da raiz');
// o destino é o arquivo que o bot lê (bot/src/parser.js → ../../pauta-parser.js)
const BOT_DIR = path.join(RAIZ, 'bot');
ok(path.resolve(BOT_DIR, path.join('..', 'pauta-parser.js')) === path.resolve(BOT_DIR, 'src', '../../pauta-parser.js'), 'grava onde bot/src/parser.js lê');

const lista = [{ local: 'index.js' }, { local: 'package.json' }, { local: path.join('src', 'pauta.js') }, { local: path.join('..', 'pauta-parser.js') }];
ok(!A.jaAplicado({ sha: 'abc', msg: 'x' }, 'abc', lista), 'mesmo commit, versão antiga sem a lista (gravada pelo /update anterior) → baixa de novo e traz o parser');
ok(!A.jaAplicado({ sha: 'abc', arquivos: ['index.js', 'package.json', 'src/pauta.js'] }, 'abc', lista), 'mesmo commit, lista sem o parser → baixa de novo');
ok(A.jaAplicado({ sha: 'abc', arquivos: ['index.js', 'package.json', 'src/pauta.js', '../pauta-parser.js'], extensao: { gravados: 3 } }, 'abc', lista), 'mesmo commit com todos os arquivos e a extensão → "já atualizado" (o /update reentregue não reinicia o bot em laço)');
ok(!A.jaAplicado({ sha: 'abc', arquivos: ['index.js', 'package.json', 'src/pauta.js', '../pauta-parser.js'] }, 'abc', lista), 'mesmo commit sem a extensão aplicada (versão de antes) → baixa de novo e traz a extensão');
ok(!A.jaAplicado({ sha: 'velho', arquivos: ['index.js', 'package.json', 'src/pauta.js', '../pauta-parser.js'] }, 'abc', lista), 'commit novo → baixa');
ok(!A.jaAplicado(null, 'abc', lista), 'sem versão gravada → baixa');
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
