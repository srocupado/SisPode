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

console.log('== escolha automática: versão decide, faixa desempata ==');
const lista = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash-image', 'gemini-3.8-flash', 'gemini-3.8-flash-lite'];
const esc = P.escolherModelo(lista, { padraoDoUsuario: 'gemini-3.1-flash-lite' });
ok(esc.modelo === 'gemini-3.8-flash', 'a versão mais alta não econômica vence a faixa pelo nome (3.8-flash > 3.1-pro-preview): ' + esc.modelo);
ok(/versão mais alta/.test(esc.motivo) && /não é usado/.test(esc.motivo) && /intermediária/.test(esc.ressalva || ''), 'motivo cita a regra e o padrão ignorado; ressalva de faixa vai impressa');
ok(P.escolherModelo(['gemini-3.1-pro-preview', 'gemini-3.1-pro'], {}).modelo === 'gemini-3.1-pro', 'mesma versão: o estável vence o preview');
ok(P.escolherModelo(lista, { fixado: 'gemini-2.5-pro' }).modelo === 'gemini-2.5-pro' && /fixado/.test(P.escolherModelo(lista, { fixado: 'gemini-2.5-pro' }).motivo), 'modelo fixado na configuração é respeitado quando elegível');
ok(P.escolherModelo(lista, { fixado: 'gemini-3.8-flash-lite' }).modelo === 'gemini-3.8-flash', 'modelo fixado econômico é ignorado: cai no automático');
const rk = P.ranquearModelos(lista);
ok(rk[0].id === 'gemini-3.8-flash' && rk.every(m => m.faixa !== 'outra_modalidade') && rk.filter(m => !m.elegivel).every(m => /econômica/.test(m.motivoInelegivel)), 'ranking para o diálogo: elegíveis primeiro, imagem fora, econômicos com motivo');
console.log('== faixa conhecida primeiro (16/11/2026: gemini-4-argon) ==');
const comArgon = [...lista, 'gemini-4-argon'];
ok(P.faixaDoModelo('gemini-4-argon') === 'nao_identificada', 'nome de código sem pro/flash/lite: faixa não identificada');
ok(P.escolherModelo(comArgon, {}).modelo === 'gemini-3.8-flash', 'versão mais alta, mas faixa desconhecida: perde para o de faixa conhecida');
ok(P.ranquearModelos(comArgon).findIndex(m => m.id === 'gemini-4-argon') > P.ranquearModelos(comArgon).findIndex(m => m.id === 'gemini-2.5-flash'), 'no ranking, o sem faixa vem depois de TODOS os de faixa conhecida');
const soArgon = P.escolherModelo(['gemini-4-argon', 'gemini-3.1-flash-lite'], {});
ok(soArgon.modelo === 'gemini-4-argon' && /nenhum de faixa conhecida/.test(soArgon.motivo) && /não foi identificada/.test(soArgon.ressalva || ''), 'sem alternativa: o de faixa desconhecida é usado, com motivo e ressalva');
ok(P.escolherModelo(['gpt-5', 'gpt-5-pro', 'gpt-5-mini'], {}).modelo === 'gpt-5-pro', 'OpenAI: gpt-5-pro (superior) antes do gpt-5 (sem marca)');
ok(P.escolherModelo(['gpt-5', 'gpt-5-mini'], {}).modelo === 'gpt-5', 'OpenAI só com gpt-5 e mini: gpt-5 (não econômico) segue elegível');
ok(P.escolherModelo(comArgon, { fixado: 'gemini-4-argon' }).modelo === 'gemini-4-argon', 'fixado pelo usuário: vale mesmo sem faixa conhecida');
console.log('== modelo de ponta, só para a NTA (21/11/2026) ==');
const g = ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-4-argon', 'gemini-4-neon', 'gemini-4-carbon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-3-pro-image'];
const nta = P.escolherModelo(g, { ponta: true });
ok(nta.modelo === 'gemini-4-carbon' && nta.faixa === 'superior' && !nta.ressalva && /modelo de ponta do provedor/.test(nta.motivo), 'NTA no Gemini: o Gemini 4 Carbon (raciocínio mais forte), sem ressalva de faixa');
ok(P.escolherModelo(g, {}).modelo === 'gemini-3.8-flash' && P.faixaDoModelo('gemini-4-carbon') === 'nao_identificada', 'fora da NTA nada muda: a nota de Plenário e a verificação seguem a regra de faixa conhecida');
const rkN = P.ranquearModelos(g, { ponta: true }).map(m => m.id);
ok(rkN.slice(0, 3).join() === 'gemini-4-carbon,gemini-4-neon,gemini-4-argon' && rkN.indexOf('gemini-3.1-flash-lite') > rkN.indexOf('gemini-4-hydrogen') && !rkN.includes('gemini-3-pro-image'), 'ordem na NTA: Carbon, Neon, Argon; depois a regra geral; econômico por último; imagem fora');
const a = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1'];
ok(P.escolherModelo(a, { ponta: true }).modelo === 'claude-fable-5-2' && P.ranquearModelos(a, { ponta: true })[2].id === 'claude-opus-5-5', 'NTA na Anthropic: Fable mais recente; depois o Opus mais recente');
ok(P.escolherModelo(a, { ponta: true, fixado: 'claude-opus-5-5' }).modelo === 'claude-opus-5-5' && P.pontaDoModelo('gemini-4-carbon-image') === 0 && P.pontaDoModelo('claude-haiku-5-5') === 0 && P.escolherModelo(['gpt-5', 'gpt-5-pro', 'gpt-5-mini'], { ponta: true }).modelo === 'gpt-5-pro', 'modelo fixado pelo usuário continua valendo; provedor sem modelo de ponta listado cai na regra geral');
const so = P.escolherModelo(['gemini-3.1-flash-lite', 'gpt-5-mini'], { padraoDoUsuario: 'gpt-5-mini' });
ok(!!so.erro, 'só econômicos → recusa com erro: ' + so.erro);

console.log('== prompt de apuração ==');
const lentes = [{ chave: 'processo', ordem: '0', rotulo: 'Processo legislativo e técnica legislativa' }, { chave: 'tributario', ordem: '2', rotulo: 'Tributário' }];
const pa = P.promptApuracao({ identificacao: 'MPV 1357/2026', ementa: 'x', textoAnalisado: 'Texto original' }, lentes, E.ESPECIALISTAS);
ok(/LENTE 2 — Tributário/.test(pa) && /2\.3\./.test(pa), 'as perguntas da lente vão numeradas');
for (const p of ['dispositivo', 'regra_antes', 'regra_depois', 'objetivo', 'estimativa']) ok(new RegExp(`"pergunta": "${p}"`).test(pa), `ficha do objeto: pede "${p}"`);
ok(/trecho.*CÓPIA EXATA/s.test(pa) && /semQuestao/.test(pa), 'trecho literal obrigatório e fórmula de ausência de questão');
const paSem = P.promptApuracao({ identificacao: 'MPV 1357/2026', ementa: 'x', textoAnalisado: 'Texto original' }, [lentes[1]], E.ESPECIALISTAS, { semFicha: true });
ok(!/ALÉM DAS LENTES/.test(paSem) && !/"pergunta": "dispositivo"/.test(paSem) && /LENTE 2 — Tributário/.test(paSem) && !/LENTE 0/.test(paSem), 'semFicha: só a lente pedida, sem a ficha do objeto');

console.log('== carimbo ==');
const c = P.carimboDoParecer({ modelo: 'gemini-3.1-pro-preview', faixa: 'superior', motivo: 'm', lentes: [{ ordem: '2', rotulo: 'Tributário', motivo: 'gatilho' }], em: new Date('2026-09-05T12:00:00Z'), por: 'equipe' });
ok(/05\/09\/2026/.test(c.linha) && /gemini-3\.1-pro-preview/.test(c.linha) && c.lentes.length === 1, 'carimbo com data, modelo e lentes');

console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
