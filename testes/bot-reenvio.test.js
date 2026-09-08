// Reenvio do Telegram: o que é falha transitória, o que é recusa definitiva.
// Uso: node testes/bot-reenvio.test.js
const path = require('path');
const R = require(path.join(__dirname, '..', 'bot/src/reenvio.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const semDormir = { dormir: async () => {}, log: () => {}, base: 1 };

// Erros como a grammY os produz.
const erroDeRede = () => { const e = new Error("Network request for 'sendMessage' failed!"); e.name = 'HttpError'; return e; };
const erroDoTelegram = (codigo, msg, parametros) => { const e = new Error(`Call to 'sendMessage' failed! (${codigo}: ${msg})`); e.name = 'GrammyError'; e.error_code = codigo; e.parameters = parametros || {}; return e; };

(async () => {
  console.log('== o que vale repetir ==');
  ok(R.ehTransitorio(erroDeRede()), 'falha de rede da grammY (HttpError) é transitória — é o erro que o usuário viu');
  ok(R.ehTransitorio(erroDoTelegram(429, 'Too Many Requests')), '429 é transitório');
  ok(R.ehTransitorio(erroDoTelegram(502, 'Bad Gateway')), '5xx é transitório');
  ok(!R.ehTransitorio(erroDoTelegram(403, 'bot was blocked by the user')), 'bot bloqueado NÃO se repete');
  ok(!R.ehTransitorio(erroDoTelegram(400, 'chat not found')), 'chat inexistente NÃO se repete');
  ok(R.ehTransitorio(new Error('fetch failed')) && R.ehTransitorio(new Error('read ECONNRESET')), 'erro de rede cru também conta');
  ok(!R.ehTransitorio(null) && !R.ehTransitorio(new Error('qualquer outra coisa')), 'erro desconhecido não vira repetição infinita');

  console.log('\n== espera entre tentativas ==');
  ok(R.esperaDe(erroDeRede(), 0) === 2000 && R.esperaDe(erroDeRede(), 1) === 4000 && R.esperaDe(erroDeRede(), 2) === 8000, 'dobra a cada tentativa: 2s, 4s, 8s');
  ok(R.esperaDe(erroDoTelegram(429, 'Too Many Requests', { retry_after: 30 }), 0) === 30000, 'o retry_after do Telegram tem prioridade sobre o cálculo');

  console.log('\n== comRepeticao ==');
  let n = 0;
  const r1 = await R.comRepeticao('t', async () => { n++; if (n < 3) throw erroDeRede(); return 'entregue'; }, semDormir);
  ok(r1 === 'entregue' && n === 3, 'falha de rede duas vezes e entrega na terceira');

  n = 0;
  let erro = null;
  try { await R.comRepeticao('t', async () => { n++; throw erroDoTelegram(403, 'bot was blocked by the user'); }, semDormir); } catch (e) { erro = e; }
  ok(erro && n === 1 && /blocked/.test(erro.message), 'recusa definitiva sai na primeira tentativa, com o erro original');

  n = 0; erro = null;
  try { await R.comRepeticao('t', async () => { n++; throw erroDeRede(); }, semDormir); } catch (e) { erro = e; }
  ok(erro && n === 4, 'rede fora do ar: tenta quatro vezes e desiste com o erro de rede');

  const esperas = [];
  n = 0;
  await R.comRepeticao('t', async () => { n++; if (n < 3) throw erroDoTelegram(429, 'Too Many Requests', { retry_after: 5 }); return 'ok'; },
    { ...semDormir, base: 2000, dormir: async ms => { esperas.push(ms); } });
  ok(esperas.join(',') === '5000,5000', 'com 429, espera o que o Telegram mandou esperar');

  console.log('\n== o tick do digest não pode marcar a semana antes de entregar ==');
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'bot/index.js'), 'utf8');
  const tick = src.slice(src.indexOf('async function tickDigest'), src.indexOf('setInterval(tickDigest'));
  const posEnvio = tick.indexOf('comRepeticao(\'digest\'');
  const posMarca = tick.indexOf('marcarEnvioDaSemana();   // alguém recebeu');
  ok(posEnvio > 0 && posMarca > posEnvio, 'marcarEnvioDaSemana vem DEPOIS do envio bem-sucedido');
  ok(/_digestPendente/.test(tick) && /reenviando aos/.test(tick), 'o que falhou fica pendente e é reenviado sem gerar o digest de novo');
  const tickRV = src.slice(src.indexOf('async function tickRodaViva'), src.indexOf('let _rodavivaEmCurso'));
  ok(tickRV.indexOf('marcarEnvioRodaViva(ep.videoId);\n    console.log') > tickRV.indexOf('comRepeticao(\'rodaviva\''), 'no Roda Viva idem: marca só depois de entregar');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
