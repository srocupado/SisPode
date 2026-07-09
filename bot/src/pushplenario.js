'use strict';
// Receptor de PUSH do Plenário — FONTE EM TEMPO REAL (latência zero).
//
// A Câmara dispara notificações push (OneSignal) no EXATO instante em que o
// operador do painel do Plenário avança a fase da sessão: "Iniciada a Ordem do
// Dia", "Encerrada a Ordem do Dia", "Encerrada a sessão", votações. É a MESMA
// fonte que o app Infoleg usa — por isso o app avisa no mesmo segundo. Não é um
// endpoint de consulta (poll): é broadcast. O Dados Abertos (marcador da pauta)
// e as notas taquigráficas são derivados ATRASADOS desse mesmo evento.
//
// Este módulo assina esse canal PÚBLICO e opt-in (igual a qualquer usuário que
// clica "Aceitar" no site camara.leg.br/plenario) e emite cada notificação.
//
// COMO FUNCIONA (sem navegador):
//   1) Registra um token FCM/Web-Push via @eneris/push-receiver, usando um
//      projeto Firebase próprio (grátis, criado uma vez) só como veículo da
//      registração, e a chave VAPID do app OneSignal da Câmara (a que casa a
//      inscrição com o remetente).
//   2) Cria uma "assinatura" (player) no app OneSignal da Câmara com as tags
//      pauta/votacao/extrapauta, apontando para essa inscrição Web-Push.
//   3) Mantém a conexão MCS do Google (mtalk.google.com:5228) e recebe cada
//      push que a Câmara envia — na hora.
//
// REQUISITOS DE AMBIENTE:
//   - Projeto Firebase (grátis): FIREBASE_API_KEY, FIREBASE_APP_ID,
//     FIREBASE_PROJECT_ID, FIREBASE_SENDER_ID. Ver PUSH-PLENARIO.md.
//   - Saída TCP para mtalk.google.com:5228 (protocolo MCS). Servidores comuns
//     têm; alguns proxies corporativos bloqueiam.
//
// Este é um SPIKE de validação: emite os eventos e loga o texto real dos
// pushes. Só depois de confirmado o formato é que integramos ao monitor.

const fs = require('fs');
const path = require('path');

const ONESIGNAL_APP_ID = '062b3950-258a-4531-b67b-c8f053fda285';
const ONESIGNAL_API = 'https://onesignal.com/api/v1';
const SYNC_URL = `${ONESIGNAL_API}/sync/${ONESIGNAL_APP_ID}/web`;
// Chave VAPID do app (fallback; em runtime buscamos a atual no /sync).
const VAPID_FALLBACK = 'BL9AbyEzfsefeem2fp3ozV6OIssTt9QWa_YKU6HGjLEEMZ2Y4dtaWatWqzHZvzWNwSjOZBTT_1Nnp17gSaBqspA';

const CREDS_PATH = path.join(__dirname, '..', 'dados', 'push-plenario.json');
const PLAYER_PATH = path.join(__dirname, '..', 'dados', 'push-plenario-player.json');

// ---------- persistência local ----------
function carregar(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}
function salvar(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  } catch (e) { console.warn('[push] não consegui salvar', p, e.message); }
}

// ---------- config OneSignal (VAPID atual) ----------
async function vapidAtual() {
  try {
    const r = await fetch(SYNC_URL);
    if (r.ok) {
      const j = await r.json();
      const v = j?.config?.vapid_public_key;
      if (v) return v;
    }
  } catch (_) { /* usa fallback */ }
  return VAPID_FALLBACK;
}

// ---------- assinatura no app OneSignal da Câmara ----------
// Cria (ou atualiza) o "player" web-push com as tags pauta/votacao/extrapauta.
// device_type 5 = Chrome Web Push. identifier = endpoint FCM; web_p256/web_auth
// = as chaves da inscrição (mesmas que o navegador enviaria).
async function garantirAssinatura(creds, log) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${creds.fcm.token}`;
  const corpo = {
    app_id: ONESIGNAL_APP_ID,
    device_type: 5,
    identifier: endpoint,
    web_p256: creds.keys.publicKey,
    web_auth: creds.keys.authSecret,
    notification_types: 1,
    language: 'pt',
    timezone: -10800,
    tags: { pauta: 'true', votacao: 'true', extrapauta: 'true' },
    sdk: 'sispode-push-receiver',
  };
  const player = carregar(PLAYER_PATH);
  const url = player?.id ? `${ONESIGNAL_API}/players/${player.id}` : `${ONESIGNAL_API}/players`;
  const metodo = player?.id ? 'PUT' : 'POST';
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { log(`[push] OneSignal ${metodo} /players HTTP ${r.status}: ${JSON.stringify(j)}`); return null; }
    if (j.id) salvar(PLAYER_PATH, { id: j.id, criadoEm: new Date().toISOString() });
    log(`[push] assinatura OneSignal OK (player ${j.id || player?.id}) — tags pauta/votacao/extrapauta`);
    return j.id || player?.id;
  } catch (e) { log(`[push] falha ao criar assinatura OneSignal: ${e.message}`); return null; }
}

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

// ---------- extrai título/corpo do envelope do push ----------
// OneSignal entrega o conteúdo dentro do data-message do FCM. Tentamos os
// formatos conhecidos (custom JSON da OneSignal, campos notification, alert).
function extrairTexto(envelope) {
  const m = envelope?.message || {};
  const data = m.data || m.notification || {};
  let titulo = data.title || data.alert_title || m.title || '';
  let corpo = data.body || data.alert || data.msg || m.body || '';
  // OneSignal às vezes empacota tudo em data.custom (JSON) ou data.a (payload)
  for (const campo of ['custom', 'a']) {
    if (!corpo && typeof data[campo] === 'string') {
      try {
        const c = JSON.parse(data[campo]);
        titulo = titulo || c.title || c?.a?.title || '';
        corpo = corpo || c.body || c.alert || c?.a?.body || '';
      } catch (_) { /* ignore */ }
    }
  }
  return { titulo, corpo, data };
}

// ---------- API pública ----------
/**
 * Inicia o receptor de push do Plenário.
 * @param {object} opts
 * @param {(ev:{tipo:string,titulo:string,corpo:string,data:object}) => void} opts.onEvento
 * @param {(msg:string) => void} [opts.log]
 * @returns {Promise<{ parar: () => void }>}
 */
async function iniciarReceptorPush({ onEvento, log = console.log } = {}) {
  const { PushReceiver } = require('@eneris/push-receiver');

  const firebase = {
    apiKey: process.env.FIREBASE_API_KEY,
    appId: process.env.FIREBASE_APP_ID,
    projectId: process.env.FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.FIREBASE_SENDER_ID,
  };
  for (const [k, v] of Object.entries(firebase)) {
    if (!v) throw new Error(`Falta a variável de ambiente FIREBASE_${k === 'messagingSenderId' ? 'SENDER_ID' : k.replace(/([A-Z])/g, '_$1').toUpperCase()} (veja PUSH-PLENARIO.md)`);
  }

  const vapidKey = await vapidAtual();
  const credentials = carregar(CREDS_PATH) || undefined;

  const receiver = new PushReceiver({ firebase, vapidKey, credentials, persistentIds: [] });

  receiver.onCredentialsChanged(async ({ newCredentials }) => {
    salvar(CREDS_PATH, newCredentials);
    log('[push] credenciais FCM (re)geradas — atualizando assinatura OneSignal');
    await garantirAssinatura(newCredentials, log);
  });

  receiver.onNotification((envelope) => {
    const { titulo, corpo, data } = extrairTexto(envelope);
    const tipo = classificar(titulo, corpo);
    log(`[push] recebido [${tipo}] título=${JSON.stringify(titulo)} corpo=${JSON.stringify(corpo)}`);
    try { onEvento && onEvento({ tipo, titulo, corpo, data }); }
    catch (e) { log(`[push] onEvento lançou: ${e.message}`); }
  });

  await receiver.connect();
  log('[push] conectado ao MCS — ouvindo pushes do Plenário');

  // Garante a assinatura mesmo quando as credenciais já existiam (sem trocar).
  const cred = receiver.config?.credentials || carregar(CREDS_PATH);
  if (cred) await garantirAssinatura(cred, log);

  return { parar: () => { try { receiver.destroy(); } catch (_) {} } };
}

module.exports = { iniciarReceptorPush, classificar, extrairTexto, ONESIGNAL_APP_ID };
