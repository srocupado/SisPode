'use strict';
// Receptor de PUSH do Plenário — FONTE EM TEMPO REAL (latência zero).
//
// A Câmara dispara notificações push (OneSignal) no EXATO instante em que o
// operador do painel do Plenário avança a fase da sessão: "Iniciada a Ordem do
// Dia", "Encerrada a Ordem do Dia", "Encerrada a sessão", votações. É a MESMA
// fonte que o app Infoleg usa. Não é consulta (poll) — é broadcast; por isso o
// Dados Abertos (marcador da pauta, ~10 min de atraso) e as notas taquigráficas
// (~30 min) chegam sempre depois.
//
// COMO FUNCIONA: em vez de reimplementar o registro FCM/Web-Push no Node (que o
// Google bloqueia do lado servidor — fcmregistrations exige OAuth), usamos um
// Chromium REAL (o mesmo puppeteer do worker). Ele abre camara.leg.br/plenario,
// se inscreve no OneSignal EXATAMENTE como o site faz (respeitando o
// restrict_origin), e recebe os pushes. Capturamos cada push por dois caminhos
// redundantes:
//   (1) o evento oficial OneSignal.on('notificationDisplay') na PÁGINA — a
//       ponte SW→página que a própria OneSignal mantém; e
//   (2) um listener injetado no service worker que repassa o push aos clientes.
// Ambos desaguam em __pushRecebido (dedup por id).
//
// Requisitos: só o Chromium do puppeteer (já instalado). NÃO precisa de Firebase
// nem de porta especial. Mantém um Chromium headless vivo enquanto roda.

const path = require('path');
const puppeteer = require('puppeteer');

// Produção: a página e o app OneSignal da Câmara. Todos são sobrescrevíveis por
// env para o TESTE de recepção com um app OneSignal próprio (ver PUSH-PLENARIO.md):
//   BOT_PUSH_URL, BOT_PUSH_ORIGIN, BOT_PUSH_APPID, BOT_PUSH_NO_INIT=1
const PLENARIO_URL = process.env.BOT_PUSH_URL || 'https://www.camara.leg.br/plenario';
const ORIGIN = process.env.BOT_PUSH_ORIGIN || new URL(PLENARIO_URL).origin;
const CHROME_DATA = path.join(__dirname, '..', 'dados', 'push-chrome');
// appId do app OneSignal da Câmara (confirmado no HTML de /plenario).
const ONESIGNAL_APP_ID = process.env.BOT_PUSH_APPID || '062b3950-258a-4531-b67b-c8f053fda285';
// No teste com página hospedada pela OneSignal (os.tc), a própria página já
// inicializa a SDK — aí pulamos a nossa init e só anexamos os ouvintes.
const PULAR_INIT = process.env.BOT_PUSH_NO_INIT === '1';

// ---------- classificação do evento pelo texto do push ----------
// A Câmara escreve mensagens explícitas ("Encerrada a Ordem do Dia",
// "Encerrada a sessão"...). Classificamos por regex no título+corpo.
function classificar(titulo, corpo) {
  const t = `${titulo || ''} ${corpo || ''}`.toLowerCase();
  if (/encerrad[ao]\s+a\s+ordem\s+do\s+dia/.test(t)) return 'odd_fim';
  if (/iniciad[ao]\s+a\s+ordem\s+do\s+dia|passa-se\s+à\s+ordem/.test(t)) return 'odd_inicio';
  if (/encerrad[ao]\s+a\s+sess[ãa]o/.test(t)) return 'sessao_fim';
  if (/abert[ao]\s+a\s+sess[ãa]o|iniciad[ao]\s+a\s+sess[ãa]o/.test(t)) return 'sessao_inicio';
  if (/vota[çc][ãa]o/.test(t)) return 'votacao';
  return 'outro';
}

// Normaliza os vários formatos de payload (evento notificationDisplay do SDK,
// payload cru do push OneSignal com `custom`, etc.) para {titulo,corpo,id,data}.
function normalizarPayload(p) {
  if (!p) return { titulo: '', corpo: '', id: '', data: {} };
  const titulo = p.heading || p.title || p.aps?.alert?.title || '';
  let corpo = p.content || p.body || p.alert || '';
  if (!corpo && typeof p.aps?.alert === 'string') corpo = p.aps.alert;
  if (!corpo && p.aps?.alert?.body) corpo = p.aps.alert.body;
  const id = p.notificationId || p.id || p.custom?.i || '';
  const data = p.data || p.additionalData || p.custom?.a || {};
  return { titulo, corpo, id, data };
}

/**
 * Inicia o receptor de push do Plenário via Chromium headless.
 * @param {object} opts
 * @param {(ev:{tipo,titulo,corpo,data}) => void} opts.onEvento
 * @param {(msg:string) => void} [opts.log]
 * @param {boolean} [opts.headless=true]  false abre a janela (diagnóstico)
 * @returns {Promise<{ parar: () => Promise<void> }>}
 */
async function iniciarReceptorPush({ onEvento, log = console.log, headless = true, debugConsole } = {}) {
  log('[push] subindo Chromium…');
  const browser = await puppeteer.launch({
    headless,
    userDataDir: CHROME_DATA,                       // persiste a inscrição
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 300000,
  });

  // Concede permissão de notificações ao domínio da Câmara (sem prompt).
  await browser.defaultBrowserContext().overridePermissions(ORIGIN, ['notifications']);

  const page = await browser.newPage();

  // Encaminho do console interno da SDK OneSignal para a janela:
  //   debugConsole === true      → TUDO (enxurrada — só p/ depurar)
  //   debugConsole === false     → NADA (janela limpa; pushes ainda aparecem
  //                                 pelo onEvento e o status pelos [push] …)
  //   debugConsole === undefined → filtrado (linhas de push/onesignal), ou
  //                                 tudo se BOT_PUSH_DEBUG=1
  page.on('console', (m) => {
    if (debugConsole === false) return;
    const tudo = debugConsole === true || process.env.BOT_PUSH_DEBUG === '1';
    const t = m.text();
    if (tudo || /onesignal|push|notif|subscri|service worker/i.test(t)) {
      log(`   [browser] ${t}`);
    }
  });
  page.on('pageerror', (e) => log(`   [browser:erro] ${e.message}`));

  // Dedup: o mesmo push pode chegar pelos dois caminhos (evento + SW).
  const vistos = new Set();
  await page.exposeFunction('__pushRecebido', (payload) => {
    const { titulo, corpo, id, data } = normalizarPayload(payload);
    const chave = id || `${titulo}|${corpo}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    const tipo = classificar(titulo, corpo);
    log(`[push] recebido [${tipo}] título=${JSON.stringify(titulo)} corpo=${JSON.stringify(corpo)}`);
    try { onEvento && onEvento({ tipo, titulo, corpo, data }); }
    catch (e) { log(`[push] onEvento lançou: ${e.message}`); }
  });

  // Confirmação da inscrição por EVENTO (não por janela de tempo): a inscrição
  // pode levar de 5 a 40 s (mais em perfil novo). Quando o OneSignal conclui,
  // dispara subscriptionChange e a página chama isto — aí logamos o ✓ na hora.
  let confirmado = false;
  await page.exposeFunction('__inscricaoConfirmada', (st) => {
    if (confirmado) return;
    confirmado = true;
    log(`[push] inscrito no OneSignal ✓  player(userId)=${st.userId}`);
    log(`[push]   permissão=${st.permission}  push_habilitado=${st.enabled}  token=${st.token ? String(st.token).slice(0, 24) + '…' : '(sem)'}`);
    log(`[push]   tags=${JSON.stringify(st.tags || {})}`);
  });

  // Caminho (2): mensagens do SW chegam à página e são repassadas ao Node.
  await page.evaluateOnNewDocument(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e && e.data && e.data.__sispodePush && window.__pushRecebido) {
          window.__pushRecebido(e.data.payload);
        }
      });
    }
  });

  log('[push] abrindo camara.leg.br/plenario…');
  await page.goto(PLENARIO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    .catch((e) => log(`[push] goto: ${e.message}`));

  // Espera a SDK do OneSignal carregar (o script é assíncrono).
  await page.waitForFunction(
    () => window.OneSignal && typeof window.OneSignal.init === 'function',
    { timeout: 30000 },
  ).then(() => log('[push] SDK OneSignal carregada'))
    .catch(() => log('[push] ⚠ SDK OneSignal não carregou em 30s'));

  // A init do PRÓPRIO site quebra em headless: o os.js da Câmara mexe no widget
  // #oneSignal (que não existe aqui) e lança antes de chamar OneSignal.init — a
  // SDK carrega mas não inicializa. Então inicializamos NÓS MESMOS, com o appId
  // real, e assinamos com as tags — mesmo efeito do site, sem o widget.
  await page.evaluate((appId, pularInit) => {
    window.OneSignal = window.OneSignal || [];
    function reportarStatus() {
      window.OneSignal.push(async function () {
        try {
          const st = { permission: (typeof Notification !== 'undefined' ? Notification.permission : '?'), enabled: null, userId: null, token: null, tags: null };
          st.enabled = await OneSignal.isPushNotificationsEnabled();
          st.userId = await OneSignal.getUserId();
          st.token = await OneSignal.getRegistrationId();
          st.tags = await OneSignal.getTags();
          // As tags só "grudam" DEPOIS que existe o device (userId). Se ainda
          // faltam, reenviamos agora — senão o segmento da Câmara não entrega.
          if (st.userId && (!st.tags || !st.tags.pauta)) {
            try { await OneSignal.sendTags({ pauta: true, votacao: true, extrapauta: true }); } catch (e) {}
            try { st.tags = await OneSignal.getTags(); } catch (e) {}
          }
          if (st.userId && window.__inscricaoConfirmada) window.__inscricaoConfirmada(st);
        } catch (e) {}
      });
    }
    function assinar() {
      try { OneSignal.on('notificationDisplay', function (ev) { window.__pushRecebido && window.__pushRecebido(ev); }); } catch (e) {}
      try { OneSignal.on('subscriptionChange', function (v) { console.log('subscriptionChange=' + v); if (v === true) reportarStatus(); }); } catch (e) {}
      try { OneSignal.setSubscription(true); } catch (e) {}
      try { if (OneSignal.registerForPushNotifications) OneSignal.registerForPushNotifications(); } catch (e) {}
      try { OneSignal.sendTags({ pauta: true, votacao: true, extrapauta: true }); } catch (e) {}
    }
    window.OneSignal.push(function () {
      try { OneSignal.log && OneSignal.log.setLevel && OneSignal.log.setLevel('trace'); } catch (e) {}
      if (pularInit) { console.log('pulando init (página já inicializa a SDK) — só assinando'); assinar(); return; }
      var p;
      try {
        p = OneSignal.init({ appId: appId, allowLocalhostAsSecureOrigin: true, autoRegister: false, notifyButton: { enable: false } });
        console.log('OneSignal.init chamado por nós (appId ' + appId + ')');
      } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(assinar).catch(function (e) {
        console.log('init retornou erro (' + (e && e.message) + ') — assinando mesmo assim');
        assinar();
      });
    });
  }, ONESIGNAL_APP_ID, PULAR_INIT);

  // Coleta o STATUS completo da inscrição — o sinal definitivo é o userId
  // (UUID do "player" no OneSignal): se existir, a inscrição foi criada nos
  // servidores da OneSignal. Também mostra token de push, permissão e tags.
  async function statusInscricao() {
    return await page.evaluate(() => new Promise((res) => {
      const out = { permission: (typeof Notification !== 'undefined' ? Notification.permission : '?'), enabled: null, userId: null, token: null, tags: null };
      window.OneSignal = window.OneSignal || [];
      window.OneSignal.push(async function () {
        try { out.enabled = await OneSignal.isPushNotificationsEnabled(); } catch (e) {}
        try { out.userId = await OneSignal.getUserId(); } catch (e) {}
        try { out.token = await OneSignal.getRegistrationId(); } catch (e) {}
        try { out.tags = await OneSignal.getTags(); } catch (e) {}
        // Garante as tags depois que o device existe (senão o segmento não entrega).
        if (out.userId && (!out.tags || !out.tags.pauta)) {
          try { await OneSignal.sendTags({ pauta: true, votacao: true, extrapauta: true }); } catch (e) {}
          try { out.tags = await OneSignal.getTags(); } catch (e) {}
        }
        res(out);
      });
      setTimeout(() => res(out), 2500);
    })).catch(() => null);
  }

  // Sondagem de reforço: além do evento subscriptionChange, checamos o status
  // por até ~90 s (perfil novo pode demorar). O que confirmar primeiro loga o ✓;
  // se passar da janela sem confirmar, avisamos sem alarme (o evento ainda pode
  // confirmar depois — o receptor segue ativo de qualquer forma).
  let ultimo = null;
  for (let i = 0; i < 45 && !confirmado; i++) {
    ultimo = await statusInscricao();
    if (ultimo && ultimo.userId && !confirmado) {
      confirmado = true;
      log(`[push] inscrito no OneSignal ✓  player(userId)=${ultimo.userId}`);
      log(`[push]   permissão=${ultimo.permission}  push_habilitado=${ultimo.enabled}  token=${ultimo.token ? String(ultimo.token).slice(0, 24) + '…' : '(sem)'}`);
      log(`[push]   tags=${JSON.stringify(ultimo.tags || {})}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!confirmado) {
    log('[push] inscrição ainda concluindo (perfil novo pode levar mais tempo).');
    log(`[push]   status parcial: permissão=${ultimo?.permission} push_habilitado=${ultimo?.enabled} token=${ultimo?.token ? 'sim' : '(sem)'}`);
    log('[push]   Assim que o OneSignal terminar, logo o "inscrito ✓" automaticamente (evento subscriptionChange).');
  }

  // Injeta o hook no service worker do OneSignal e reforça periodicamente
  // (o SW pode ser reciclado; re-injetar garante o listener presente).
  async function injetarSW() {
    try {
      const alvo = browser.targets().find(
        (t) => t.type() === 'service_worker' && /onesignal/i.test(t.url()));
      if (!alvo) return false;
      const w = await alvo.worker();
      if (!w) return false;
      await w.evaluate(() => {
        if (self.__sispodeHook) return;
        self.__sispodeHook = true;
        self.addEventListener('push', (event) => {
          let payload = null;
          try { payload = event.data ? event.data.json() : null; }
          catch (_) { try { payload = { body: event.data && event.data.text() }; } catch (__) {} }
          event.waitUntil(
            self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
              .then((cs) => cs.forEach((c) => c.postMessage({ __sispodePush: true, payload }))));
        });
      });
      return true;
    } catch (_) { return false; }
  }
  let hookOk = await injetarSW();
  if (hookOk) log('[push] hook do service worker instalado ✓');
  // Reforça o hook (SW pode ser reciclado / instalar só depois em perfil novo).
  const tHook = setInterval(async () => {
    const ok = await injetarSW();
    if (ok && !hookOk) { hookOk = true; log('[push] hook do service worker instalado ✓'); }
  }, 20000);

  // Mantém o SW/página aquecidos (evita reciclagem que perderia o hook).
  const tWarm = setInterval(() => {
    page.evaluate(() => { try { return !!navigator.serviceWorker; } catch (e) { return false; } }).catch(() => {});
  }, 20000);

  log('[push] ativo — ouvindo notificações do Plenário em tempo real');

  return {
    parar: async () => {
      clearInterval(tHook); clearInterval(tWarm);
      await browser.close().catch(() => {});
    },
  };
}

module.exports = { iniciarReceptorPush, classificar, normalizarPayload, PLENARIO_URL };
