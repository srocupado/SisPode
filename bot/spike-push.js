'use strict';
// SPIKE de validação do receptor de push do Plenário (Chromium headless).
// Roda SOZINHO (não mexe no bot nem no monitor): abre camara.leg.br/plenario num
// Chromium, se inscreve nas notificações do OneSignal e imprime CADA push
// recebido, com o texto real e o tipo classificado.
//
// Uso:
//   cd bot
//   npm install            # garante o puppeteer
//   node spike-push.js     # headless
//   set BOT_PUSH_VISIVEL=1 && node spike-push.js   # janela visível (diagnóstico)
//
// Deixe rodando durante uma sessão do Plenário e observe os eventos
// (sessao_inicio, odd_inicio, votacao, odd_fim, sessao_fim).

require('dotenv').config();
const { iniciarReceptorPush } = require('./src/pushplenario');

(async () => {
  const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[${hora()}] iniciando spike do receptor de push (Chromium)…`);
  try {
    const { parar } = await iniciarReceptorPush({
      headless: process.env.BOT_PUSH_VISIVEL !== '1',
      log: (m) => console.log(`[${hora()}] ${m}`),
      onEvento: (ev) => {
        console.log(`[${hora()}] >>> EVENTO tipo=${ev.tipo}`);
        console.log(`           título: ${ev.titulo}`);
        console.log(`           corpo : ${ev.corpo}`);
        console.log(`           data  : ${JSON.stringify(ev.data)}`);
      },
    });
    process.on('SIGINT', async () => { console.log('\nencerrando…'); await parar(); process.exit(0); });
    console.log(`[${hora()}] ouvindo. Ctrl+C para sair.`);
  } catch (e) {
    console.error(`[${hora()}] ERRO ao iniciar:`, e.message);
    process.exit(1);
  }
})();
