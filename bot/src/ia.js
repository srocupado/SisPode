'use strict';
// Matriz dos 3 provedores de IA — portada de congresso.js (chamarIAtexto +
// fetchIA), a implementação mais completa entre os módulos da extensão
// (retry/backoff em 429/5xx). Toda chamada roda na chave do usuário.

const ANTHROPIC_VER = '2023-06-01';

const PROVEDORES = {
  gemini: {
    label: 'Google Gemini',
    hintChave: 'Obtenha em aistudio.google.com → Get API key',
    regexChave: /^[\w.-]{20,}$/,
    modeloPadrao: 'gemini-3.1-flash-lite',
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    hintChave: 'Obtenha em platform.openai.com/api-keys',
    regexChave: /^sk-[\w-]{20,}$/,
    modeloPadrao: 'gpt-4o',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    hintChave: 'Obtenha em console.anthropic.com → Settings → API Keys',
    regexChave: /^sk-ant-[\w-]{20,}$/,
    modeloPadrao: 'claude-sonnet-4-6',
  },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** fetch para IA com retry/backoff em 429 e 5xx (5s/15s/30s). */
async function fetchIA(url, init) {
  const delays = [0, 5000, 15000, 30000];
  let ultima = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]);
    let res;
    try { res = await fetch(url, init); }
    catch (e) { ultima = e; continue; }
    if (res.ok) return await res.json();
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      ultima = new Error(`HTTP ${res.status}`); continue;
    }
    let det; try { det = await res.json(); } catch (_) { det = null; }
    throw new Error(det?.error?.message || det?.error?.type || `HTTP ${res.status}`);
  }
  throw ultima || new Error('Falha após várias tentativas.');
}

/** Chamada de IA somente-texto, na chave do usuário. */
async function chamarIAtexto({ provedor, apiKey, modelo, prompt, maxTokens = 8000 }) {
  if (provedor === 'gemini') {
    const m = modelo || PROVEDORES.gemini.modeloPadrao;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens } };
    const j = await fetchIA(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }
  if (provedor === 'openai') {
    const m = modelo || PROVEDORES.openai.modeloPadrao;
    const body = { model: m, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], temperature: 0.2, max_output_tokens: maxTokens };
    const j = await fetchIA('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (j.output_text) return j.output_text.trim();
    for (const item of (j.output || [])) for (const c of (item.content || [])) if (c.type === 'output_text' && c.text) return c.text.trim();
    return '';
  }
  if (provedor === 'anthropic') {
    const m = modelo || PROVEDORES.anthropic.modeloPadrao;
    const body = { model: m, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
    const j = await fetchIA('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VER, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    for (const item of (j.content || [])) if (item.type === 'text' && item.text) return item.text.trim();
    return '';
  }
  throw new Error(`Provedor desconhecido: ${provedor}`);
}

/** Valida a chave com a chamada mais barata de cada provedor (listar modelos). */
async function testarChave(provedor, apiKey) {
  let res;
  if (provedor === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1`);
  } else if (provedor === 'openai') {
    res = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
  } else if (provedor === 'anthropic') {
    res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VER },
    });
  } else {
    throw new Error(`Provedor desconhecido: ${provedor}`);
  }
  if (!res.ok) {
    let det; try { det = await res.json(); } catch (_) { det = null; }
    throw new Error(det?.error?.message || `HTTP ${res.status}`);
  }
  return true;
}

// Vocabulário do domínio legislativo — orienta o reconhecimento de voz a
// preferir termos/siglas da Câmara em vez de palavras foneticamente próximas
// (ex.: "pauta nova" em vez de "pauta corrida").
const VOCAB_LEGISLATIVO =
  'pauta, pauta nova, pauta da semana, importar a pauta, plenário, sessão, ' +
  'votação, urgência, destaque, parecer, substitutivo, emenda, ementa, ' +
  'relator, comissão, bancada, orientação, veto, redação final, apensado, ' +
  'nota técnica, tramitação, proposição, Liderança do Podemos, ' +
  'PL, PLP, PEC, PDL, MPV, PRC, REQ, CCJC, SisPode';

/**
 * Transcreve uma mensagem de voz (buffer OGG/Opus do Telegram).
 * Gemini e OpenAI aceitam áudio nas próprias APIs; Anthropic não — o
 * chamador deve usar a chave-fallback de transcrição (TRANSCRIBE_GEMINI_KEY).
 */
async function transcreverAudio({ provedor, apiKey, modelo, buffer, mime = 'audio/ogg' }) {
  if (provedor === 'gemini') {
    // Adota o modelo do /modelo do usuário quando for da família Gemini
    // (o transcritor-fallback pode receber perfil Anthropic — aí usa o padrão).
    const m = (modelo && /^gemini/i.test(modelo)) ? modelo : PROVEDORES.gemini.modeloPadrao;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const body = {
      contents: [{
        parts: [
          { text: 'Transcreva fielmente este áudio em Português do Brasil. ' +
                  `Contexto: é um(a) assessor(a) legislativo(a) da Câmara dos Deputados falando com um sistema de acompanhamento de pautas; termos prováveis: ${VOCAB_LEGISLATIVO}. ` +
                  'Na dúvida entre palavras parecidas, prefira as desse vocabulário. Responda APENAS com a transcrição, sem comentários.' },
          { inline_data: { mime_type: mime, data: Buffer.from(buffer).toString('base64') } },
        ],
      }],
      generationConfig: { temperature: 0 },
    };
    const j = await fetchIA(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }
  if (provedor === 'openai') {
    const form = new FormData();
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    // O campo "prompt" do Whisper enviesa o reconhecimento para o vocabulário dado.
    form.append('prompt', VOCAB_LEGISLATIVO);
    form.append('file', new Blob([buffer], { type: mime }), 'voz.ogg');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
    return (j.text || '').trim();
  }
  throw new Error('Este provedor não aceita áudio.');
}

/** Extrai o objeto JSON da resposta da IA, tolerando texto/cercas ao redor (de congresso.js). */
function extrairJson(texto) {
  if (!texto) return {};
  let t = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini >= 0 && fim > ini) t = t.slice(ini, fim + 1);
  try { return JSON.parse(t); } catch (_) { return {}; }
}

module.exports = { PROVEDORES, chamarIAtexto, testarChave, transcreverAudio, extrairJson, fetchIA };
