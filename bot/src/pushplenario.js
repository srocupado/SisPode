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

const PLENARIO_URL = 'https://www.camara.leg.br/plenario';
const ORIGIN = 'https://www.camara.leg.br';
const CHROME_DATA = path.join(__dirname, '..', 'dados', 'push-chrome');

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
async function iniciarReceptorPush({ onEvento, log = console.log, headless = true } = {}) {
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

  // Encaminha o console interno da página/SDK OneSignal (diagnóstico). Com
  // BOT_PUSH_DEBUG=1 encaminha TUDO; senão só o que menciona push/onesignal.
  const debugConsole = process.env.BOT_PUSH_DEBUG === '1';
  page.on('console', (m) => {
    const t = m.text();
    if (debugConsole || /onesignal|push|notif|subscri|service worker/i.test(t)) {
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
  await page.goto(PLENARIO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Caminho (1): inscreve no OneSignal como o site + tags + escuta o evento
  // oficial de exibição de notificação (a ponte SW→página da própria OneSignal).
  await page.evaluate(() => {
    window.OneSignal = window.OneSignal || [];
    window.OneSignal.push(function () {
      try { OneSignal.log && OneSignal.log.setLevel && OneSignal.log.setLevel('trace'); } catch (e) {}
      try { OneSignal.on('notificationDisplay', function (ev) { window.__pushRecebido && window.__pushRecebido(ev); }); } catch (e) {}
      try { OneSignal.on('subscriptionChange', function (v) { console.log('OneSignal subscriptionChange=' + v); }); } catch (e) {}
      try { OneSignal.setSubscription(true); } catch (e) {}
      try { if (OneSignal.registerForPushNotifications) OneSignal.registerForPushNotifications(); } catch (e) {}
      try { OneSignal.sendTags({ pauta: true, votacao: true, extrapauta: true }); } catch (e) {}
    });
  });

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
        res(out);
      });
      setTimeout(() => res(out), 2500);
    })).catch(() => null);
  }

  let st = null;
  for (let i = 0; i < 20; i++) {
    st = await statusInscricao();
    if (st && st.userId) break;                 // inscrição confirmada no servidor
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (st && st.userId) {
    log(`[push] inscrito no OneSignal ✓  player(userId)=${st.userId}`);
    log(`[push]   permissão=${st.permission}  push_habilitado=${st.enabled}  token=${st.token ? String(st.token).slice(0, 20) + '…' : '(sem)'}`);
    log(`[push]   tags=${JSON.stringify(st.tags || {})}`);
  } else {
    log('[push] ⚠ inscrição NÃO confirmada (sem userId). Status atual:');
    log(`[push]   permissão=${st?.permission}  push_habilitado=${st?.enabled}  token=${st?.token ? 'sim' : '(sem)'}  tags=${JSON.stringify(st?.tags || {})}`);
    log('[push]   Rode com BOT_PUSH_VISIVEL=1 e BOT_PUSH_DEBUG=1 para ver o log interno da SDK.');
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
  if (await injetarSW()) log('[push] hook do service worker instalado ✓');
  const tHook = setInterval(injetarSW, 20000);

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
