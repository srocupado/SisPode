'use strict';
// SPIKE de validação do receptor de push do Plenário.
// Roda SOZINHO (não mexe no bot nem no monitor): assina o canal OneSignal da
// Câmara e imprime CADA notificação recebida, com o texto real e o tipo
// classificado. Use durante uma sessão do Plenário para confirmar que os
// pushes chegam na hora e ver as frases exatas ("Encerrada a Ordem do Dia" etc.).
//
// Uso:
//   1) Configure o .env (veja PUSH-PLENARIO.md): FIREBASE_API_KEY, FIREBASE_APP_ID,
//      FIREBASE_PROJECT_ID, FIREBASE_SENDER_ID.
//   2) node spike-push.js
//   3) Deixe rodando durante uma sessão e observe os logs.
//
// Ao registrar pela 1ª vez, o OneSignal manda uma notificação de boas-vindas
// ("Inscrição feita com sucesso!") — se ela aparecer, o canal de recebimento
// está funcionando de ponta a ponta, mesmo fora de sessão.

require('dotenv').config();
const { iniciarReceptorPush } = require('./src/pushplenario');

(async () => {
  const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[${hora()}] iniciando spike do receptor de push...`);
  try {
    const { parar } = await iniciarReceptorPush({
      log: (m) => console.log(`[${hora()}] ${m}`),
      onEvento: (ev) => {
        console.log(`[${hora()}] >>> EVENTO tipo=${ev.tipo}`);
        console.log(`           título: ${ev.titulo}`);
        console.log(`           corpo : ${ev.corpo}`);
        console.log(`           data  : ${JSON.stringify(ev.data)}`);
      },
    });
    process.on('SIGINT', () => { console.log('\nencerrando...'); parar(); process.exit(0); });
    console.log(`[${hora()}] ouvindo. Ctrl+C para sair.`);
  } catch (e) {
    console.error(`[${hora()}] ERRO ao iniciar:`, e.message);
    process.exit(1);
  }
})();
