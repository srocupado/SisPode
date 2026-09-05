// Parecer de Especialista — escolha de modelo por faixa e prompt de apuração.
// Uso: node testes/parecer-modelo.test.js
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const P = require(path.join(RAIZ, 'parecer.js'));
const E = require(path.join(RAIZ, 'especialistas.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

console.log('== faixa pela convenção de nomes ==');
ok(P.faixaDoModelo('gemini-3.1-flash-lite') === 'economica', 'flash-lite → econômica ("lite" vence "flash")');
ok(P.faixaDoModelo('gemini-3.1-pro-preview') === 'superior', 'gemini-3.1-pro-preview → superior');
ok(P.faixaDoModelo('claude-opus-5') === 'superior' && P.faixaDoModelo('claude-haiku-4-5-20251001') === 'economica', 'opus superior, haiku econômica');
ok(P.faixaDoModelo('gemini-2.5-flash-image') === 'outra_modalidade' && P.faixaDoModelo('gemini-2.5-pro-tts') === 'outra_modalidade', 'imagem e TTS não são candidatos');

console.log('== escolha automática ==');
const lista = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash-image'];
const esc = P.escolherModelo(lista, { padraoDoUsuario: 'gemini-3.1-flash-lite' });
ok(esc.modelo && P.faixaDoModelo(esc.modelo) === 'superior', 'ignora o padrão econômico do usuário e escolhe a faixa superior: ' + esc.modelo);
ok(!esc.erro, 'sem erro quando há modelo superior');
const so = P.escolherModelo(['gemini-3.1-flash-lite', 'gpt-5-mini'], { padraoDoUsuario: 'gpt-5-mini' });
ok(!!so.erro, 'só econômicos → recusa com erro: ' + so.erro);

console.log('== prompt de apuração ==');
const lentes = [{ chave: 'processo', ordem: '0', rotulo: 'Processo legislativo e técnica legislativa' }, { chave: 'tributario', ordem: '2', rotulo: 'Tributário' }];
const pa = P.promptApuracao({ identificacao: 'MPV 1357/2026', ementa: 'x', textoAnalisado: 'Texto original' }, lentes, E.ESPECIALISTAS);
ok(/LENTE 2 — Tributário/.test(pa) && /2\.3\./.test(pa), 'as perguntas da lente vão numeradas');
for (const p of ['dispositivo', 'regra_antes', 'regra_depois', 'objetivo', 'estimativa']) ok(new RegExp(`"pergunta": "${p}"`).test(pa), `ficha do objeto: pede "${p}"`);
ok(/trecho.*CÓPIA EXATA/s.test(pa) && /semQuestao/.test(pa), 'trecho literal obrigatório e fórmula de ausência de questão');

console.log('== carimbo ==');
const c = P.carimboDoParecer({ modelo: 'gemini-3.1-pro-preview', faixa: 'superior', motivo: 'm', lentes: [{ ordem: '2', rotulo: 'Tributário', motivo: 'gatilho' }], em: new Date('2026-09-05T12:00:00Z'), por: 'equipe' });
ok(/05\/09\/2026/.test(c.linha) && /gemini-3\.1-pro-preview/.test(c.linha) && c.lentes.length === 1, 'carimbo com data, modelo e lentes');

console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
