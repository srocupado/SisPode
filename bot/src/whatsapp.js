'use strict';
// Mensagens do bot no formato do WHATSAPP — pedido de 10/11/2026: a equipe
// copia o que o bot manda no Telegram e cola no WhatsApp. Com parse_mode, o
// Telegram CONSOME os marcadores (*negrito* vira negrito na tela) e a cópia
// chega ao WhatsApp sem formatação nenhuma. Por isso toda mensagem sai como
// texto puro, com os marcadores do WhatsApp visíveis:
//   *negrito*  _itálico_  ~tachado~  `código`  ```bloco```
// Ponto único: o transformer da API (index.js) passa por aqui TODO envio e
// edição de texto ou legenda, venha de onde vier (monitor, comandos, agente).
//   · parse_mode 'Markdown' (o legado do Telegram): a sintaxe já é a do
//     WhatsApp; só o link [texto](url) vira "texto (url)".
//   · parse_mode 'HTML': <b>→*, <i>→_, <s>→~, <code>→`, <pre>→```, <a>→"texto (url)".
//   · qualquer texto: **negrito** (Markdown comum, saída de IA) → *negrito*, e
//     título "## X" → *X*.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const desentidade = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENT[n]);

/** Marcador do WhatsApp em volta do miolo, com os espaços das pontas para fora ("<b> x </b>" → " *x* "). */
function envolver(miolo, m) {
  const r = /^(\s*)([\s\S]*?)(\s*)$/.exec(miolo);
  return r[2] ? `${r[1]}${m}${r[2]}${m}${r[3]}` : miolo;
}

function htmlParaWhatsApp(h) {
  let s = String(h || '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, t) => {
    const u = desentidade(url), txt = t.replace(/<[^>]+>/g, '');
    return desentidade(txt).trim() === u ? txt : `${txt} (${url})`;
  });
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, x) => '```' + x.replace(/<\/?code[^>]*>/gi, '') + '```');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, x) => envolver(x, '`'));
  s = s.replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, (_, __, x) => envolver(x, '*'));
  s = s.replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, (_, __, x) => envolver(x, '_'));
  s = s.replace(/<(s|strike|del)>([\s\S]*?)<\/\1>/gi, (_, __, x) => envolver(x, '~'));
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, x) => x.split('\n').map(l => '> ' + l).join('\n'));
  s = s.replace(/<[^>]+>/g, '');   // <u>, <span class="tg-spoiler"> e o resto: sem equivalente
  return desentidade(s);
}

function markdownParaWhatsApp(t) {
  return String(t || '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, txt, url) => (txt.trim() === url ? url : `${txt} (${url})`))
    .replace(/\\([_*`\[])/g, '$1');
}

/** Normalização que vale para qualquer texto: **x** → *x*; "## Título" → *Título*. */
function normalizar(t) {
  return String(t || '')
    .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+(.+?)\s*#*$/gm, (_, x) => `*${x.replace(/^\*+|\*+$/g, '')}*`);
}

/** Texto (com o parse_mode original) → texto puro no formato do WhatsApp. */
function paraWhatsApp(texto, parseMode) {
  if (texto == null) return texto;
  let t = String(texto);
  if (/^html$/i.test(parseMode || '')) t = htmlParaWhatsApp(t);
  else if (/^markdown$/i.test(parseMode || '')) t = markdownParaWhatsApp(t);
  // MarkdownV2 não é usado no bot; se aparecer, sai como veio (sem parse_mode, os escapes ficariam visíveis — então mantém).
  else if (parseMode) return null;
  return normalizar(t);
}

const METODOS = new Set(['sendMessage', 'editMessageText', 'sendPhoto', 'sendDocument', 'sendVideo', 'sendAudio', 'sendAnimation', 'editMessageCaption']);

/** Payload da API do Telegram → payload com o texto/legenda no formato do WhatsApp e sem parse_mode. */
function payloadWhatsApp(method, payload) {
  if (!METODOS.has(method) || !payload) return payload;
  const campo = typeof payload.text === 'string' ? 'text' : typeof payload.caption === 'string' ? 'caption' : null;
  if (!campo) return payload;
  const novo = paraWhatsApp(payload[campo], payload.parse_mode);
  if (novo == null) return payload;
  const p = { ...payload, [campo]: novo };
  delete p.parse_mode;
  delete p.entities;
  delete p.caption_entities;
  return p;
}

module.exports = { paraWhatsApp, payloadWhatsApp, htmlParaWhatsApp, markdownParaWhatsApp };
