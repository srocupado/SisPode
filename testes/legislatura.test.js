// legislatura.js — legislaturas da Câmara calculadas pela data.
//
// O arquivo existe em dois lugares (raiz, script clássico da extensão; e
// bot/src/, módulo do bot, que o /update baixa sozinho). O que este teste trava:
//  1. as duas cópias são IDÊNTICAS — mudar uma sem a outra desalinha a
//     extensão e o bot na virada de legislatura;
//  2. a fronteira de fevereiro: janeiro ainda é da legislatura que sai;
//  3. o ano de término entra nos anos de arquivo (jan/2027 é 57ª);
//  4. a lista de legislaturas cresce sozinha em fev/2027, sem editar código;
//  5. a cópia da raiz funciona como script clássico (as funções viram globais).
//
// Uso: node testes/legislatura.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const raiz = fs.readFileSync(path.join(RAIZ, 'legislatura.js'), 'utf8');
const doBot = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'legislatura.js'), 'utf8');

console.log('== as duas cópias ==');
ok(raiz === doBot, 'legislatura.js (raiz) e bot/src/legislatura.js são idênticos');
const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
ok(manifest.web_accessible_resources.flatMap(w => w.resources).includes('legislatura.js'),
   'legislatura.js está em web_accessible_resources');
const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
ok(html.indexOf('legislatura.js') > -1 && html.indexOf('legislatura.js') < html.indexOf('aderencia.js"'),
   'aderencia.html carrega legislatura.js antes de aderencia.js');

const L = require(path.join(RAIZ, 'bot', 'src', 'legislatura.js'));

console.log('\n== fronteira de fevereiro ==');
ok(L.legislaturaEm('2023-01-31') === 56, '31/jan/2023 → 56ª');
ok(L.legislaturaEm('2023-02-01') === 57, '1º/fev/2023 → 57ª');
ok(L.legislaturaEm('2027-01-31') === 57, '31/jan/2027 → ainda 57ª');
ok(L.legislaturaEm('2027-02-01') === 58, '1º/fev/2027 → 58ª');
ok(L.legislaturaEm('2007-02-01') === 53, '1º/fev/2007 → 53ª');
ok(L.legislaturaEm('2031-02-01') === 59, '1º/fev/2031 → 59ª');
ok(L.legislaturaEm(new Date(2027, 0, 31, 23, 59)) === 57, 'Date local de 31/jan/2027 23h59 → 57ª');
ok(L.legislaturaEm(new Date(2027, 1, 1, 0, 1)) === 58, 'Date local de 1º/fev/2027 00h01 → 58ª');
ok(L.legislaturaEm('lixo') === null, 'data inválida → null, não um número inventado');
ok(L.legislaturaDaData('2023-01-15T10:00:00') === '56', 'legislaturaDaData aceita data-hora e devolve chave string');
ok(L.legislaturaDaData('') === null, 'sem data → null');

console.log('\n== faixa, rótulo e anos de arquivo ==');
const i57 = L.legislaturaInfo('57');
ok(i57.rotulo === '57ª (2023–2027)', `rótulo da 57ª (${i57.rotulo})`);
ok(i57.inicio === '2023-02-01' && i57.fim === '2027-01-31', 'faixa da 57ª');
ok(i57.anos.join() === '2023,2024,2025,2026,2027', 'anos de arquivo incluem o de término (2027)');
const i53 = L.legislaturaInfo(53);
ok(i53.rotulo === '53ª (2007–2011)' && i53.anos[0] === 2007 && i53.anos[4] === 2011, '53ª: mesma tabela que era fixa');
ok(L.legislaturaInfo(58).inicio === '2027-02-01', '58ª começa em 1º/fev/2027');

console.log('\n== a lista cresce sozinha ==');
ok(L.legislaturasDesde(53, '2026-09-25').join() === '57,56,55,54,53', 'em 2026: 57ª a 53ª');
ok(L.legislaturasDesde(53, '2027-02-01').join() === '58,57,56,55,54,53', 'em fev/2027: 58ª entra no topo');

console.log('\n== a cópia da raiz como script clássico ==');
{
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(raiz).runInContext(ctx);
  ok(typeof vm.runInContext('legislaturaEm', ctx) === 'function', 'legislaturaEm vira global');
  ok(vm.runInContext("legislaturaInfo('56').rotulo", ctx) === '56ª (2019–2023)', 'e legislaturaInfo também');
  ok(vm.runInContext('LEG_PRIMEIRA_COM_ARQUIVOS', ctx) === 53, 'e a constante do piso');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
