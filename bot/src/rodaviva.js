'use strict';
// Roda Viva (TV Cultura) — resumo do programa de segunda para o grupo.
//
// O programa vai ao ar toda SEGUNDA às 22h e o episódio completo sobe no
// canal do YouTube em seguida, com o título "RODA VIVA | CONVIDADO | data".
// Aqui: localizamos o episódio pelo RSS público do canal (sem chave do
// YouTube), baixamos a TRANSCRIÇÃO (legenda pt — a revisada quando existir,
// senão a automática), resumimos com IA (convidado + principais pontos
// debatidos) e enviamos ao grupo na TERÇA a partir das 8h (Brasília).
// Também sob demanda com /rodaviva (na chave do solicitante).
//
// Plano B da transcrição: quando o fetch direto esbarra no anti-bot do
// YouTube, um Chromium descartável (puppeteer, já dependência) abre a página
// e lê a legenda de dentro dela.

const fs = require('fs');
const path = require('path');
const { DADOS_DIR } = require('./config');
const { chamarIAtexto } = require('./ia');

const RSS_URL = 'https://www.youtube.com/feeds/videos.xml?user=rodaviva';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_TRANSCRICAO = 300000;   // ~1h30 de fala cabe com folga; teto de segurança

// ---------- persistência local (bot/dados/, fora do git) ----------
function carregarJson(nome, padrao) {
  try { return JSON.parse(fs.readFileSync(path.join(DADOS_DIR, nome), 'utf8')); }
  catch (_) { return padrao; }
}
function gravarJson(nome, obj) {
  fs.mkdirSync(DADOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DADOS_DIR, nome), JSON.stringify(obj, null, 2));
}

async function fetchTexto(url, { ms = 30000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', ...headers } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

// ---------- episódio mais recente pelo RSS ----------
const desEnt = s => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * Último episódio COMPLETO do canal (título "RODA VIVA | CONVIDADO | data").
 * @returns {Promise<{videoId,titulo,convidado,dataRotulo,publicadoEm,url}|null>}
 */
async function ultimoEpisodio() {
  const xml = await fetchTexto(RSS_URL);
  const eps = [];
  const reEntry = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = reEntry.exec(xml)) !== null) {
    const e = m[1];
    const titulo = desEnt((e.match(/<title>([^<]*)<\/title>/) || [])[1]);
    if (!/^RODA\s*VIVA\s*\|/i.test(titulo)) continue;   // ignora os cortes
    const videoId = (e.match(/<yt:videoId>([^<]*)</) || [])[1];
    const publicadoEm = (e.match(/<published>([^<]*)</) || [])[1] || '';
    if (!videoId) continue;
    const partes = titulo.split('|').map(s => s.trim());
    eps.push({
      videoId, titulo,
      convidado: partes[1] || '',
      dataRotulo: partes[2] || '',
      publicadoEm,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  eps.sort((a, b) => String(b.publicadoEm).localeCompare(String(a.publicadoEm)));
  return eps[0] || null;
}

// ---------- transcrição ----------
// Extrai o JSON de ytInitialPlayerResponse do HTML por contagem de chaves
// (regex quebraria: o objeto tem strings com "}" dentro).
function extrairPlayerResponse(html) {
  const marca = 'ytInitialPlayerResponse';
  let i = html.indexOf(marca);
  while (i !== -1) {
    const ini = html.indexOf('{', i);
    if (ini === -1) return null;
    let prof = 0, emStr = false, esc = false;
    for (let k = ini; k < html.length && k < ini + 3_000_000; k++) {
      const ch = html[k];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { emStr = !emStr; continue; }
      if (emStr) continue;
      if (ch === '{') prof++;
      else if (ch === '}') {
        prof--;
        if (prof === 0) {
          try { return JSON.parse(html.slice(ini, k + 1)); } catch (_) { break; }
        }
      }
    }
    i = html.indexOf(marca, i + marca.length);
  }
  return null;
}

// Prefere legenda pt revisada; senão a automática (asr); senão a primeira.
function escolherTrilha(tracks) {
  const pt = tracks.filter(t => /^pt/i.test(t.languageCode || ''));
  return pt.find(t => t.kind !== 'asr') || pt[0] || tracks[0] || null;
}

function transcricaoDeJson3(txt) {
  // O endpoint de legenda devolve corpo VAZIO quando exige o token de
  // navegador ("pot") — sem este guard, o JSON.parse dava o críptico
  // "Unexpected end of JSON input".
  if (!txt || !txt.trim()) throw new Error('legenda veio vazia (proteção anti-robô do YouTube)');
  const j = JSON.parse(txt);
  const partes = [];
  for (const ev of (j.events || [])) for (const seg of (ev.segs || [])) {
    if (seg.utf8) partes.push(seg.utf8);
  }
  return partes.join('').replace(/\s+/g, ' ').trim();
}

// Colhe os segmentos de texto de uma resposta do get_transcript (painel
// "Mostrar transcrição" do YouTube).
function colherSegmentosTranscript(obj) {
  const segs = [];
  (function anda(o) {
    if (!o || typeof o !== 'object') return;
    if (o.transcriptSegmentRenderer?.snippet) {
      segs.push((o.transcriptSegmentRenderer.snippet.runs || []).map(x => x.text).join(''));
      return;
    }
    for (const v of Object.values(o)) anda(v);
  })(obj);
  return segs;
}

/** Tenta a via direta (fetch da página + fetch da legenda). */
async function transcricaoDireta(videoId) {
  const html = await fetchTexto(`https://www.youtube.com/watch?v=${videoId}&hl=pt`, { ms: 40000 });
  const pr = extrairPlayerResponse(html);
  if (!pr || pr.playabilityStatus?.status !== 'OK') {
    throw new Error(`página do vídeo indisponível (${pr?.playabilityStatus?.status || 'sem playerResponse'})`);
  }
  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const trilha = escolherTrilha(tracks);
  if (!trilha) throw new Error('vídeo sem legenda/transcrição.');
  const legenda = await fetchTexto(trilha.baseUrl + '&fmt=json3', { ms: 40000 });
  const texto = transcricaoDeJson3(legenda);
  if (!texto) throw new Error('legenda veio vazia.');
  return texto;
}

// ---------- via "aplicativo" (API interna, clientes IOS/ANDROID) ----------
// As URLs de legenda entregues aos clientes de APP não carregam a exigência
// do token de navegador ("pot") que zera as do cliente WEB. Sem navegador,
// resposta em ~2s, independe da duração do vídeo. O IOS é o mais permissivo
// (validado: entrega a legenda inteira mesmo de IP de datacenter).
const CLIENTES_APP = [
  { name: 'IOS', version: '20.10.4', extras: { deviceModel: 'iPhone16,2' },
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)' },
  { name: 'ANDROID', version: '20.10.38', extras: { androidSdkVersion: 30 },
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' },
];

async function transcricaoViaApp(videoId, log = () => {}) {
  let ultimo = null;
  for (const c of CLIENTES_APP) {
    try {
      const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua },
        body: JSON.stringify({
          context: { client: { clientName: c.name, clientVersion: c.version, hl: 'pt', ...c.extras } },
          videoId, contentCheckOk: true, racyCheckOk: true,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const st = j.playabilityStatus?.status;
      if (st !== 'OK') throw new Error(`status ${st}`);
      const trilha = escolherTrilha(j.captions?.playerCaptionsTracklistRenderer?.captionTracks || []);
      if (!trilha) throw new Error('sem trilha de legenda');
      const legenda = await fetchTexto(trilha.baseUrl + '&fmt=json3', { ms: 40000, headers: { 'User-Agent': c.ua } });
      return transcricaoDeJson3(legenda);
    } catch (e) {
      ultimo = e;
      log(`via app ${c.name} falhou: ${e.message}`);
    }
  }
  throw ultimo || new Error('nenhum cliente de app funcionou.');
}

/** Plano C: Chromium descartável — o get_transcript SÓ funciona chamado da
 *  sessão de um navegador de verdade; e, se nem isso, ligamos o player com
 *  legenda e capturamos o pedido de legenda que ELE mesmo faz (vem com o
 *  token anti-robô "pot" que falta nas buscas de fora). */
async function transcricaoViaChromium(videoId, log = () => {}) {
  const puppeteer = require('puppeteer');
  const args = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-setuid-sandbox');
  const browser = await puppeteer.launch({
    // BOT_RV_VISIVEL=1 abre a janela de verdade — ajuda a depurar e, de quebra,
    // costuma passar onde o headless é barrado.
    headless: process.env.BOT_RV_VISIVEL !== '1', args,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);

    // Captura, desde já, qualquer legenda que o player venha a pedir.
    let capturada = null;
    page.on('response', res => {
      if (capturada || !/\/api\/timedtext/.test(res.url())) return;
      res.text().then(txt => { if (txt && txt.length > 500) capturada = { url: res.url(), txt }; }).catch(() => {});
    });

    await page.goto(`https://www.youtube.com/watch?v=${videoId}&hl=pt`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Diagnóstico: o que o YouTube serviu ao navegador? (a "casca" anti-robô
    // vem sem ytInitialData útil e sem player)
    const diag = await page.evaluate(() => ({
      status: window.ytInitialPlayerResponse?.playabilityStatus?.status || null,
      temDados: !!window.ytInitialData,
      temVideo: !!document.querySelector('video'),
    }));
    log(`chromium: status=${diag.status} dados=${diag.temDados} video=${diag.temVideo}`);

    // 1ª via: painel "Mostrar transcrição" pela API interna, DE DENTRO da
    // página (contexto/sessão do próprio YouTube — passa na pré-condição).
    const viaPainel = await page.evaluate(async () => {
      try {
        const ctx = (window.ytcfg && (ytcfg.data_ || {}).INNERTUBE_CONTEXT) || null;
        let params = null;
        (function acha(o) {
          if (!o || typeof o !== 'object' || params) return;
          if (o.getTranscriptEndpoint && o.getTranscriptEndpoint.params) { params = o.getTranscriptEndpoint.params; return; }
          for (const k in o) acha(o[k]);
        })(window.ytInitialData);
        if (!ctx || !params) return null;
        const r = await fetch('/youtubei/v1/get_transcript?prettyPrint=false', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: ctx, params }),
        });
        if (!r.ok) return null;
        const j = await r.json();
        const segs = [];
        (function anda(o) {
          if (!o || typeof o !== 'object') return;
          if (o.transcriptSegmentRenderer && o.transcriptSegmentRenderer.snippet) {
            segs.push((o.transcriptSegmentRenderer.snippet.runs || []).map(x => x.text).join(''));
            return;
          }
          for (const k in o) anda(o[k]);
        })(j);
        return segs.length > 20 ? segs.join(' ') : null;
      } catch (_) { return null; }
    });
    if (viaPainel) { log('chromium: transcrição obtida pelo painel'); return viaPainel.replace(/\s+/g, ' ').trim(); }
    log('chromium: painel de transcrição não veio — tentando o player com CC');

    // 2ª via: dá o play com legenda ligada e espera o pedido do próprio player.
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    });
    // Liga a legenda pelo BOTÃO do player (mais confiável que o atalho de teclado).
    await page.hover('.html5-video-player').catch(() => {});
    const ccOk = await page.evaluate(() => {
      const b = document.querySelector('.ytp-subtitles-button');
      if (!b) return false;
      if (b.getAttribute('aria-pressed') !== 'true') b.click();
      return true;
    }).catch(() => false);
    if (!ccOk) { await page.click('video').catch(() => {}); await page.keyboard.press('c').catch(() => {}); }
    const fim = Date.now() + 45000;
    while (!capturada && Date.now() < fim) await new Promise(r => setTimeout(r, 500));
    if (!capturada) {
      throw new Error(`não consegui capturar a legenda no navegador (página: status=${diag.status} dados=${diag.temDados} video=${diag.temVideo} ccBotao=${ccOk}).`);
    }
    if (/^\s*\{/.test(capturada.txt)) return transcricaoDeJson3(capturada.txt);
    // Formato XML (fmt padrão do player em alguns casos)
    return capturada.txt
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function transcricaoVideo(videoId, log = () => {}) {
  // A via de app é a mais confiável e a mais rápida — vai primeiro.
  try { return await transcricaoViaApp(videoId, log); }
  catch (e) { log(`via app falhou (${e.message}) — tentando a página…`); }
  try { return await transcricaoDireta(videoId); }
  catch (e) { log(`transcrição direta falhou (${e.message}) — tentando via Chromium…`); }
  return await transcricaoViaChromium(videoId, log);
}

// ---------- resumo ----------
function promptResumo(ep, transcricao) {
  return `Você é assessor parlamentar da Liderança do Podemos na Câmara dos Deputados. Abaixo está a TRANSCRIÇÃO da entrevista do programa Roda Viva (TV Cultura) com ${ep.convidado || 'o(a) convidado(a)'}${ep.dataRotulo ? `, exibida em ${ep.dataRotulo}` : ''}.

Produza um RESUMO para o grupo de Telegram da equipe, neste formato (texto puro, sem markdown além dos marcadores "•"):

1ª linha: quem é o(a) convidado(a) — nome e qualificação (cargo/atividade), em uma frase. Comece DIRETO nessa linha, sem preâmbulo ("Aqui está o resumo…" etc.) e sem asteriscos/negrito.
Depois, a seção "Principais pontos debatidos:" com 5 a 8 marcadores "•", cada um com UMA ideia objetiva dita na entrevista (posições, anúncios, críticas, dados citados).
Se a entrevista tocar em temas de interesse do Congresso (projetos, regulação, políticas públicas), feche com a seção "Radar legislativo:" e 1 a 3 marcadores "•" apontando o tema e por que interessa ao parlamento. Se não tocar, omita a seção.

Regras: seja fiel à transcrição — não invente nem extrapole; nada de opinião sua; máximo de 2.500 caracteres no total.

TRANSCRIÇÃO:
${transcricao.slice(0, MAX_TRANSCRICAO)}`;
}

// Último recurso: manda o VÍDEO do YouTube direto ao Gemini (a API aceita a
// URL como anexo e processa o vídeo do lado de lá). Custa muito mais tokens
// e demora minutos — só quando toda a escada de legendas falhar; só Gemini.
async function resumoDoVideoGemini(perfil, ep) {
  const m = perfil.modelo || 'gemini-3.1-flash-lite';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8 * 60_000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${perfil.apiKey}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { fileData: { fileUri: ep.url } },
          { text: promptResumo(ep, '(a entrevista está no VÍDEO anexado — resuma a partir do áudio dele)') },
        ] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    return (j.candidates?.[0]?.content?.parts || [])
      .filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('').trim();
  } finally { clearTimeout(timer); }
}

/**
 * Localiza o último episódio, transcreve e resume.
 * @returns {Promise<{ep, texto}>} texto pronto para o Telegram.
 */
async function gerarResumoRodaViva({ perfil, log = () => {} }) {
  if (!perfil?.apiKey) throw new Error('sem chave de IA configurada (use /config no privado).');
  const ep = await ultimoEpisodio();
  if (!ep) throw new Error('não encontrei episódio completo no canal do Roda Viva.');
  log(`episódio: ${ep.titulo} (${ep.videoId})`);
  let resumo;
  try {
    const transcricao = await transcricaoVideo(ep.videoId, log);
    log(`transcrição: ${transcricao.length} caracteres`);
    resumo = await chamarIAtexto({
      provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
      prompt: promptResumo(ep, transcricao), maxTokens: 8000,
    });
  } catch (e) {
    if (perfil.provedor !== 'gemini') throw e;
    log(`sem transcrição (${e.message}) — mandando o vídeo direto ao Gemini (leva alguns minutos)…`);
    resumo = await resumoDoVideoGemini(perfil, ep);
  }
  if (!resumo?.trim()) throw new Error('a IA não devolveu o resumo.');
  // Faxina de formato: sem negrito de markdown (sairia literal no Telegram)
  // e sem preâmbulo ("Aqui está o resumo…").
  const linhas = resumo.replace(/\*\*/g, '').trim().split('\n');
  while (linhas.length && /^(aqui est[áa]|aqui vai|segue|claro\b|resumo da entrevista)/i.test(linhas[0].trim())) linhas.shift();
  const corpo = linhas.join('\n').trim();
  const cab = `📺 RODA VIVA — ${ep.convidado || ep.titulo}${ep.dataRotulo ? ` (${ep.dataRotulo})` : ''}`;
  const rodape = `\n\n🔗 ${ep.url}`;
  return { ep, texto: `${cab}\n\n${corpo}${rodape}` };
}

// ---------- agenda do envio (padrão: terça 8h; ajustável pelo /rodaviva) ----------
const ARQ_ENVIO  = 'rodaviva-envio.json';
const ARQ_AGENDA = 'rodaviva-agenda.json';

const DIA_CODIGO = { domingo: 'Sun', segunda: 'Mon', terca: 'Tue', terça: 'Tue', quarta: 'Wed', quinta: 'Thu', sexta: 'Fri', sabado: 'Sat', sábado: 'Sat' };
const DIA_ROTULO = { Sun: 'domingo', Mon: 'segunda', Tue: 'terça', Wed: 'quarta', Thu: 'quinta', Fri: 'sexta', Sat: 'sábado' };

function agendaEnvio() {
  return { ativo: true, dia: 'Tue', hora: 8, ...carregarJson(ARQ_AGENDA, {}) };
}
function descreverAgenda() {
  const a = agendaEnvio();
  return a.ativo
    ? `Envio automático LIGADO — toda ${DIA_ROTULO[a.dia] || a.dia}, a partir das ${a.hora}h (Brasília), no grupo.`
    : 'Envio automático DESLIGADO — o resumo só sai sob demanda com /rodaviva.';
}

/**
 * Ajusta a agenda por comando: "off"/"desligar", "on"/"ligar", "status",
 * ou dia/hora ("terça 9h", "quarta 10", "9h" mantém o dia).
 * @returns {string} mensagem de confirmação para o Telegram.
 */
function ajustarAgendaRodaViva(arg) {
  const a = agendaEnvio();
  const t = String(arg || '').trim().toLowerCase();
  if (['off', 'desligar', 'desliga', 'parar'].includes(t)) {
    gravarJson(ARQ_AGENDA, { ...a, ativo: false });
    return '⏸ Envio automático DESLIGADO. Religue com /rodaviva on; o resumo sob demanda continua funcionando.';
  }
  if (['on', 'ligar', 'liga'].includes(t)) {
    gravarJson(ARQ_AGENDA, { ...a, ativo: true });
    return '▶️ ' + descreverAgenda();
  }
  if (t === 'status' || t === 'agenda') return '📅 ' + descreverAgenda();
  const m = t.match(/^(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)?\s*(?:[àa]s?\s*)?(\d{1,2})\s*h?(?:00)?$/);
  if (m) {
    const hora = parseInt(m[2], 10);
    if (hora > 23) return 'Hora inválida (0 a 23). Ex.: /rodaviva terça 8h';
    const dia = m[1] ? DIA_CODIGO[m[1].replace('ç', 'c')] || DIA_CODIGO[m[1]] : a.dia;
    gravarJson(ARQ_AGENDA, { ativo: true, dia, hora });
    return `✅ Agendado: toda ${DIA_ROTULO[dia]}, a partir das ${hora}h (Brasília), no grupo.`;
  }
  return 'Não entendi. Use: /rodaviva (resumo agora) · /rodaviva off · /rodaviva on · /rodaviva status · /rodaviva terça 9h (mudar dia/hora)';
}

/** true se agora (SP) bate com a agenda configurada. */
function ehHoraDoEnvioRodaViva() {
  const a = agendaEnvio();
  if (!a.ativo) return false;
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const dia = p.find(x => x.type === 'weekday').value;
  const hora = parseInt(p.find(x => x.type === 'hour').value, 10) % 24;
  // Janela de 2h a partir do horário configurado: recupera num restart logo
  // após a hora certa, mas não dispara à noite se o bot subir tarde (a
  // idempotência por vídeo já evita reenvio; isto evita o envio fora de hora).
  return dia === a.dia && hora >= a.hora && hora < a.hora + 2;
}
function jaEnviadoRodaViva(videoId) {
  return carregarJson(ARQ_ENVIO, {}).videoId === videoId;
}
function marcarEnvioRodaViva(videoId) {
  gravarJson(ARQ_ENVIO, { videoId, em: new Date().toISOString() });
}
/** Episódio recente o bastante para o envio automático (evita repostar reprise antiga). */
function episodioRecente(ep, dias = 5) {
  const t = Date.parse(ep?.publicadoEm || '');
  return Number.isFinite(t) && (Date.now() - t) < dias * 24 * 60 * 60 * 1000;
}

module.exports = {
  ultimoEpisodio, transcricaoVideo, gerarResumoRodaViva,
  ehHoraDoEnvioRodaViva, jaEnviadoRodaViva, marcarEnvioRodaViva, episodioRecente,
  ajustarAgendaRodaViva, descreverAgenda,
};
