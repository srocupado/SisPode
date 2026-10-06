// Comissões — o cadastro compartilhado de deputados acompanha a bancada em
// exercício: quem sai (não reeleito na posse, troca de partido) sai do cadastro
// na atualização pela API, exceto quem ainda ocupa vaga em comissão, os
// incluídos à mão e as exceções fixas (licenciados acompanhados).
// Uso: node testes/comissoes-cadastro.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'comissoes.js'), 'utf8');
const pega = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const ctx = {};
vm.runInNewContext([
  pega(/const DEPS_SEMPRE_NO_CADASTRO = [^\n]+/), pega(/const DEPS_MINIMO_API = [^\n]+/),
  pega(/function depsForaDeExercicio\([\s\S]*?\n\}/), 'this.f = depsForaDeExercicio;'].join('\n'), ctx);
const f = ctx.f;
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const api = new Set(Array.from({ length: 27 }, (_, i) => 'cam_' + (1000 + i)));
const cad = {};
for (const id of api) cad[id] = { nome: id };
Object.assign(cad, { cam_1: { nome: 'Saiu A' }, cam_2: { nome: 'Saiu B, em comissão' }, cam_178989: { nome: 'Renata Abreu' }, manual_x: { nome: 'Incluído à mão' } });
const membros = { CCJC: { titulares: ['cam_1000'], suplentes: ['cam_2'] } };
const r = f(cad, api, membros);
ok(r.remover.join() === 'cam_1', 'quem saiu da bancada em exercício é removido');
ok(r.emComissao.join() === 'cam_2', 'quem ainda ocupa vaga em comissão fica (e é apontado)');
ok(!r.remover.includes('cam_178989') && !r.remover.includes('manual_x'), 'exceção fixa (licenciada acompanhada) e incluído à mão ficam');
const parcial = f(cad, new Set(['cam_1000', 'cam_1001']), membros);
ok(!parcial.remover.length && !parcial.emComissao.length, 'resposta da API pequena demais (falha parcial): ninguém sai');
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
