// SisPode — o que as telas de análise têm em comum: cliente de IA (Gemini,
// OpenAI, Anthropic, com streaming e retry), cancelamento global, download de
// PDF, markdown da nota, sanitização do HTML do editor, utilitários de tela e
// o CSS de impressão. Saiu do analise.js quando o módulo de Pautas de
// Comissões passou a precisar do mesmo cliente; é script clássico e vive no
// mesmo escopo global das páginas que o carregam (analise.html e
// pautas-comissoes.html) — carregue-o ANTES do script da tela.

const PROVEDORES_META = {
  gemini: {
    label: 'Google Gemini',
    placeholderChave: 'AIzaSy... ou AQ....',
    hintChave: 'Obtenha em aistudio.google.com → Get API key',
    regexChave: /^[\w.-]{20,}$/,
    modelosFallback: [
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro',   displayName: 'Gemini 2.5 Pro' },
    ],
    async listar(key) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=50`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      return (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && (m.name || '').includes('gemini'))
        .map(m => ({ id: (m.name || '').replace(/^models\//, ''), displayName: m.displayName || m.name }));
    },
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    placeholderChave: 'sk-...',
    hintChave: 'Obtenha em platform.openai.com/api-keys',
    regexChave: /^sk-[\w-]{20,}$/,
    modelosFallback: [
      { id: 'gpt-5',   displayName: 'GPT-5' },
      { id: 'gpt-4.1', displayName: 'GPT-4.1' },
      { id: 'gpt-4o',  displayName: 'GPT-4o' },
    ],
    async listar(key) {
      const res = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      const prefs = ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4'];
      const ids = (j.data || []).map(m => m.id).filter(id => prefs.some(p => id.startsWith(p)));
      return ids.length ? ids.map(id => ({ id, displayName: id })) : this.modelosFallback;
    },
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    placeholderChave: 'sk-ant-...',
    hintChave: 'Obtenha em console.anthropic.com → Settings → API Keys',
    regexChave: /^sk-ant-[\w-]{20,}$/,
    modelosFallback: [
      { id: 'claude-opus-4-8',           displayName: 'Claude Opus 4.8' },
      { id: 'claude-opus-4-7',           displayName: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    ],
    async listar(key) {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      const lista = (j.data || []).map(m => ({ id: m.id, displayName: m.display_name || m.id }));
      return lista.length ? lista : this.modelosFallback;
    },
  },
};

// Retorna { text, truncated } onde truncated=true sinaliza que o modelo
// atingiu o limite de tokens de saída (não terminou a resposta).
/**
 * `opcoes` (só o Parecer de Especialista as usa): maxSaida — limite de tokens
 * de saída (padrão 12000; o parecer pede 32000, porque no Gemini o raciocínio
 * conta dentro do limite e 12000 truncava a redação); pensar: 'alto' — liga o
 * raciocínio no nível máximo em cada provedor (Gemini 3: thinkingLevel high;
 * Gemini 2.5: thinkingBudget; Anthropic: extended thinking; OpenAI, modelos
 * de raciocínio: reasoning effort high). Sem `opcoes`, a chamada é a da nota
 * comum, intacta.
 */
/**
 * Modelos Claude com raciocínio adaptativo (thinking.type "adaptive" + output_config.effort):
 * família 4.6 em diante — Sonnet 4.6/5, Opus 4.6/4.7/4.8/5, Fable, Mythos. Antes disso (Haiku 4.5,
 * Sonnet 4.5, Opus 4.1, 3.7) o raciocínio é "enabled" com budget_tokens.
 */
function raciocinioAdaptativo(modelo) {
  const m = String(modelo || '');
  if (/claude-(fable|mythos)/.test(m)) return true;
  let r = m.match(/claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);
  if (!r) { r = m.match(/claude-(\d+)-(\d+)-/); if (!r) return false; }
  const maior = +r[1], menor = +(r[2] || 0);
  return maior >= 5 || (maior === 4 && menor >= 6);
}

async function chamarIA({ provedorId, apiKey, modelo, prompt, pdfBuffers, web, opcoes = {} }) {
  const pdfsBase64 = (pdfBuffers || []).map(b => arrayBufferToBase64(b));
  const maxSaida = opcoes.maxSaida || 12000;
  const pensarAlto = opcoes.pensar === 'alto';

  if (provedorId === 'gemini') {
    const m = modelo || 'gemini-2.5-flash';
    // Com raciocínio (parecer) a resposta demora minutos; sem streaming o Chrome derruba a conexão
    // que fica sem receber byte algum. O streaming mantém bytes chegando; o texto é juntado no fim.
    const url = pensarAlto
      ? `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse&key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const parts = pdfsBase64.map(d => ({ inline_data: { mime_type: 'application/pdf', data: d } }));
    parts.push({ text: prompt });
    const body = {
      contents: [{ parts }],
      // Com raciocínio ligado, o pensamento conta dentro de maxOutputTokens: o teto sobe.
      generationConfig: { temperature: 0.2, maxOutputTokens: pensarAlto ? Math.min(65536, maxSaida * 2) : maxSaida },
    };
    if (pensarAlto) body.generationConfig.thinkingConfig = /gemini-2\.5/.test(m) ? { thinkingBudget: 24576 } : { thinkingLevel: 'high' };
    if (web) body.tools = [{ google_search: {} }];   // grounding com Google Search
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    if (pensarAlto) {
      let texto = '', fim = '';
      for (const ev of await fetchIASse(url, init)) {
        if (ev.dados?.error) throw new Error(ev.dados.error.message || 'erro do Gemini');
        const cand = ev.dados?.candidates?.[0];
        for (const pt of cand?.content?.parts || []) if (pt.text && !pt.thought) texto += pt.text;
        if (cand?.finishReason) fim = cand.finishReason;
      }
      return { text: texto.trim(), truncated: fim.toUpperCase() === 'MAX_TOKENS' };
    }
    const json = await fetchIA(url, init);
    const cand = json.candidates?.[0];
    return {
      // Com grounding o texto pode vir em vários parts — concatena todos.
      text: (cand?.content?.parts || []).map(p => p.text || '').join('').trim(),
      truncated: (cand?.finishReason || '').toUpperCase() === 'MAX_TOKENS',
    };
  }

  if (provedorId === 'openai') {
    const m = modelo || 'gpt-4o';
    const content = pdfsBase64.map((d, i) => ({
      type: 'input_file',
      filename: `documento_${i + 1}.pdf`,
      file_data: `data:application/pdf;base64,${d}`,
    }));
    content.push({ type: 'input_text', text: prompt });
    const body = {
      model: m,
      input: [{ role: 'user', content }],
      temperature: 0.2,
      max_output_tokens: maxSaida,
    };
    // Modelos de raciocínio (o*, gpt-5*) não aceitam temperature e recebem o esforço.
    if (pensarAlto && /^(o\d|gpt-5)/.test(m)) { delete body.temperature; body.reasoning = { effort: 'high' }; body.max_output_tokens = maxSaida * 2; }   // o raciocínio conta no limite
    if (web) body.tools = [{ type: 'web_search' }];   // busca web na Responses API
    if (pensarAlto) {
      body.stream = true;
      let texto = '', fim = null;
      for (const ev of await fetchIASse('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) {
        if (ev.evento === 'error' || ev.dados?.type === 'error') throw new Error(ev.dados?.error?.message || ev.dados?.message || 'erro da OpenAI');
        if (ev.evento === 'response.output_text.delta' && ev.dados?.delta) texto += ev.dados.delta;
        if (/^response\.(completed|incomplete|failed)$/.test(ev.evento || '')) fim = ev.dados?.response || null;
      }
      if (fim?.status === 'failed') throw new Error(fim.error?.message || 'resposta falhou');
      return { text: texto.trim(), truncated: fim?.status === 'incomplete' || fim?.incomplete_details?.reason === 'max_output_tokens' };
    }
    const json = await fetchIA('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Concatena todo output_text (com web search há itens extras antes da mensagem final).
    let texto = '';
    for (const item of (json.output || [])) {
      for (const c of (item.content || [])) {
        if (c.type === 'output_text' && c.text) texto += (texto ? '\n' : '') + c.text;
      }
    }
    texto = texto.trim();
    if (!texto) texto = (json.output_text || '').trim();
    const trunc = (json.status === 'incomplete')
      || (json.incomplete_details?.reason === 'max_output_tokens');
    return { text: texto, truncated: trunc };
  }

  if (provedorId === 'anthropic') {
    const m = modelo || 'claude-sonnet-4-6';
    const content = pdfsBase64.map(d => ({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: d },
    }));
    content.push({ type: 'text', text: prompt });
    const body = {
      model: m,
      max_tokens: maxSaida,
      messages: [{ role: 'user', content }],
    };
    // Raciocínio: nos Claude 4.6 em diante (Sonnet 5, Opus 5, Fable) o modo é "adaptive" com o
    // esforço em output_config; budget_tokens é rejeitado com 400. Nos anteriores (Haiku 4.5, Sonnet 4.5,
    // 4.1, 3.7) vale o orçamento fixo. Nos dois casos o pensamento conta dentro de max_tokens, que sobe.
    if (pensarAlto) {
      if (raciocinioAdaptativo(m)) { body.thinking = { type: 'adaptive' }; body.output_config = { effort: 'high' }; }
      else body.thinking = { type: 'enabled', budget_tokens: 16000 };
      body.max_tokens = maxSaida + 16000;
    }
    // Busca na web: tipo novo nos Claude 4.6 em diante; o básico nos anteriores.
    if (web) body.tools = [{ type: raciocinioAdaptativo(m) ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    const cab = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json' };
    if (pensarAlto) {
      body.stream = true;
      let texto = '', parada = null;
      for (const ev of await fetchIASse('https://api.anthropic.com/v1/messages', { method: 'POST', headers: cab, body: JSON.stringify(body) })) {
        const d = ev.dados || {};
        if (ev.evento === 'error' || d.type === 'error') throw new Error(d.error?.message || 'erro da Anthropic');
        if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') texto += d.delta.text || '';
        if (d.type === 'message_delta' && d.delta?.stop_reason) parada = d.delta.stop_reason;
      }
      if (parada === 'refusal') throw new Error('O modelo recusou a solicitação (stop_reason refusal).');
      return { text: texto.trim(), truncated: parada === 'max_tokens' };
    }
    const json = await fetchIA('https://api.anthropic.com/v1/messages', { method: 'POST', headers: cab, body: JSON.stringify(body) });
    // Concatena todos os blocos de texto (com web search há blocos de busca no meio).
    let texto = '';
    for (const item of (json.content || [])) {
      if (item.type === 'text' && item.text) texto += (texto ? '\n' : '') + item.text;
    }
    return { text: texto.trim(), truncated: json.stop_reason === 'max_tokens' };
  }

  throw new Error(`Provedor desconhecido: ${provedorId}`);
}

/**
 * Wrapper de fetch para chamadas de IA, com retry/backoff em erros 429
 * (rate limit) e 5xx transitórios. Tentativas: 1 inicial + 3 retries em
 * intervalos de 5s, 15s e 30s.
 */
async function fetchIA(url, init) {
  const delays = [0, 5000, 15000, 30000];
  let ultimaErro = null;
  const signal = _abortAll.signal;
  for (let i = 0; i < delays.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (delays[i] > 0) await sleep(delays[i], signal);
    let res;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      if (isAbortError(e)) throw e;
      ultimaErro = e;
      continue; // erro de rede → retry
    }
    if (res.ok) return await res.json();
    // 429 ou 5xx: vale tentar de novo
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      try {
        const txt = await res.text();
        ultimaErro = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      } catch (_) { ultimaErro = new Error(`HTTP ${res.status}`); }
      continue;
    }
    // 4xx (exceto 429): erro permanente
    let detalhe;
    try { detalhe = await res.json(); } catch (_) { detalhe = null; }
    const msg = detalhe?.error?.message || detalhe?.error?.type || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  throw ultimaErro || new Error('Falha após retries');
}

/** Texto SSE completo → [{ evento, dados }] (uma entrada por linha "data:" com JSON). */
function eventosSse(texto) {
  const out = [];
  let evento = null;
  for (const linhaBruta of String(texto || '').split(/\r?\n/)) {
    const linha = linhaBruta.trimEnd();
    if (!linha) { evento = null; continue; }
    if (linha.startsWith(':')) continue;
    if (linha.startsWith('event:')) { evento = linha.slice(6).trim(); continue; }
    if (linha.startsWith('data:')) {
      const d = linha.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      try { out.push({ evento, dados: JSON.parse(d) }); } catch (_) { /* fragmento não-JSON: ignora */ }
    }
  }
  return out;
}

/**
 * Como fetchIA, mas para respostas em streaming (SSE): a conexão recebe bytes o tempo
 * todo, então o Chrome não a derruba nas chamadas de minutos com raciocínio. O corpo é
 * lido até o fim e devolvido como lista de eventos — a tela não precisa do incremental.
 */
async function fetchIASse(url, init) {
  const delays = [0, 5000, 15000, 30000];
  let ultimaErro = null;
  const signal = _abortAll.signal;
  for (let i = 0; i < delays.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (delays[i] > 0) await sleep(delays[i], signal);
    let res;
    try { res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Accept: 'text/event-stream' }, signal }); }
    catch (e) { if (isAbortError(e)) throw e; ultimaErro = e; continue; }
    if (res.ok) {
      let texto = '';
      if (res.body && res.body.getReader) {
        const leitor = res.body.getReader(); const dec = new TextDecoder();
        for (;;) { const { value, done } = await leitor.read(); if (done) break; texto += dec.decode(value, { stream: true }); }
        texto += dec.decode();
      } else texto = await res.text();
      return eventosSse(texto);
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      try { const txt = await res.text(); ultimaErro = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`); } catch (_) { ultimaErro = new Error(`HTTP ${res.status}`); }
      continue;
    }
    let detalhe; try { detalhe = await res.json(); } catch (_) { detalhe = null; }
    throw new Error(detalhe?.error?.message || detalhe?.error?.type || `HTTP ${res.status}`);
  }
  throw ultimaErro || new Error('Falha após retries');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

let _abortAll = new AbortController();

let _iaInFlight = 0;

function iaInFlightInc() { _iaInFlight++; atualizarBotaoParar(); }

function iaInFlightDec() { _iaInFlight = Math.max(0, _iaInFlight - 1); atualizarBotaoParar(); }

function atualizarBotaoParar() {
  const btn = document.getElementById('btn-parar-todas');
  if (!btn) return;
  btn.style.display = _iaInFlight > 0 ? 'inline-flex' : 'none';
}

function isAbortError(e) {
  return e?.name === 'AbortError' || /aborted/i.test(e?.message || '');
}

// Renova o AbortController abortado pelo "Parar tudo" antes de uma nova operação.
function resetAbortAll() {
  if (_abortAll.signal.aborted) _abortAll = new AbortController();
}

async function baixarPdf(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: _abortAll.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (e) {
    if (isAbortError(e)) throw e;
    console.error('[baixarPdf] falhou', url, e);
    throw new Error(`Falha ao baixar documento (${e.message}). URL: ${url.slice(0, 90)}…`);
  }
}

// Reescopa os marcadores de tamanho [[N]]…[[/]] para que sobrevivam às
// fronteiras de bloco. O marcador é inline (vira <span>/run de Word); quando a
// seleção abrange vários parágrafos, listas ou um título "##", o tamanho se
// perdia a partir do bloco seguinte. Aqui reaplicamos o tamanho linha a linha —
// mantendo os títulos sem tamanho (preservam a hierarquia) e deixando prefixos
// estruturais (marca de alinhamento e marcador de lista "- ") fora do tamanho,
// para não quebrar a detecção de lista/alinhamento adiante.
function reescoparTamanho(md) {
  if (!md || !/\[\[(?:10\.5|12|14|16)\]\]/.test(md)) return md || '';
  const tokenRe = /\[\[(10\.5|12|14|16)\]\]|\[\[\/\]\]/g;
  let limpo = '';
  const sizes = [];
  let cur = null, last = 0, m;
  const push = (txt) => { for (let k = 0; k < txt.length; k++) { limpo += txt[k]; sizes.push(cur); } };
  while ((m = tokenRe.exec(md)) !== null) {
    if (m.index > last) push(md.slice(last, m.index));
    cur = (m[0] === '[[/]]') ? null : m[1];
    last = m.index + m[0].length;
  }
  if (last < md.length) push(md.slice(last));

  const reHeading = /^\s*#{1,3}\s+/;
  const rePrefixo = /^(\s*(?:\[\[(?:left|center|right|justify)\]\]\s*)?(?:[-*]\s+)?)/i;
  const linhas = limpo.split('\n');
  let pos = 0;
  const out = linhas.map((linha) => {
    const inicio = pos;
    pos += linha.length + 1;                 // +1 do "\n" consumido pelo split
    if (reHeading.test(linha)) return linha;  // título: sem tamanho (opção b)
    const pre = (linha.match(rePrefixo) || [''])[0];
    let res = pre, i = pre.length;
    while (i < linha.length) {
      const sz = sizes[inicio + i];
      let j = i;
      while (j < linha.length && sizes[inicio + j] === sz) j++;
      const trecho = linha.slice(i, j);
      res += sz ? `[[${sz}]]${trecho}[[/]]` : trecho;
      i = j;
    }
    return res;
  });
  return out.join('\n');
}

// Saneamento leve do HTML de uma nota (origem própria, mas a base é compartilhada):
// remove scripts/handlers e atributos perigosos.
function sanitizarNotaHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
  doc.querySelectorAll('.ql-ui').forEach(n => n.remove());   // elementos auxiliares do Quill
  // Quill 2.0 usa <ol><li data-list="bullet"> para marcadores. Converte para
  // <ul>/<ol> padrão, que renderizam na tela, no PDF e no Word sem o CSS do Quill.
  doc.querySelectorAll('ol').forEach(ol => {
    const lis = [...ol.querySelectorAll(':scope > li')];
    const ehBullet = lis.length > 0 && lis.every(li => li.getAttribute('data-list') === 'bullet');
    if (ehBullet) {
      const ul = doc.createElement('ul');
      while (ol.firstChild) ul.appendChild(ol.firstChild);
      ol.replaceWith(ul);
    }
  });
  doc.querySelectorAll('li[data-list]').forEach(li => li.removeAttribute('data-list'));
  // Remove parágrafos vazios no fim (o Quill deixa um <p><br></p> de sobra).
  let ultimo;
  while ((ultimo = doc.body.lastElementChild) && ultimo.tagName === 'P'
         && !ultimo.textContent.trim() && !ultimo.querySelector('img')) ultimo.remove();
  // Remove handlers/atributos perigosos e classes do Quill.
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'src' || n === 'contenteditable'
          || (n === 'class' && /\bql-/.test(a.value))
          || (n === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}

function htmlParaTexto(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('p,div,h1,h2,h3,li,br').forEach(el => el.append('\n'));
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// Remove de um HTML a seção cujo título casa o regex (até o próximo título).

function renderMarkdown(md) {
  if (!md) return '';
  // Encurta referências longas a proposições ("Projeto de Lei nº 1234-G, de 12
  // de novembro de 2010" → "PL 1234/2010") antes de renderizar.
  md = encurtarProposicoes(md);
  md = reescoparTamanho(md);   // tamanho [[N]] sobrevive a títulos/parágrafos/listas
  // Escape básico
  let html = escapeHtml(md);
  // Um marcador de alinhamento colado antes de um título (ex.: ao justificar a
  // nota inteira) quebraria a detecção do heading e faria o "##" vazar. Títulos
  // não recebem alinhamento — removemos o marcador nesses casos.
  html = html.replace(/^[ \t]*\[\[(?:left|center|right|justify)\]\][ \t]*(?=#{1,3}\s)/gim, '');
  // Garante linha em branco após um título: sem ela, o corpo na linha seguinte
  // fica colado ao heading no mesmo bloco e não vira <p> (logo, não é alinhado).
  html = html.replace(/^(#{1,3}[ \t].+)\n(?!\n)/gm, '$1\n\n');
  // Headings
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // Bold/italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Tamanho de fonte — marcador [[N]]…[[/]] da barra de formatação do editor
  html = html.replace(/\[\[(10\.5|12|14|16)\]\]([\s\S]*?)\[\[\/\]\]/g, '<span style="font-size:$1pt">$2</span>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Listas
  html = html.replace(/(^|\n)(\s*[-*]\s+.+(?:\n\s*[-*]\s+.+)*)/g, (m, pre, bloco) => {
    const itens = bloco.split(/\n/).map(l => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
    return `${pre}<ul>${itens.map(i => `<li>${i}</li>`).join('')}</ul>`;
  });
  // Quebras de parágrafo (com alinhamento por marcador [[left|center|right|justify]]
  // no início do bloco, inserido pela barra de formatação do editor).
  html = html.split(/\n{2,}/).map(b => {
    let t = b.trim();
    if (/^<(h\d|ul|ol|pre|blockquote)/.test(t)) return b;
    let style = '';
    const am = t.match(/^\[\[(left|center|right|justify)\]\]\s*/i);
    if (am) { style = ` style="text-align:${am[1].toLowerCase()}"`; t = t.slice(am[0].length); }
    return `<p${style}>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

async function carregarLogoDataUrl() {
  try {
    const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL('icons/podemos-logo.png')
      : 'icons/podemos-logo.png';
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.onerror   = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Logo não carregada:', e.message);
    return null;
  }
}

// Encurta referências longas a proposições no corpo da nota — "Projeto de Lei
// nº 1234-G, de 12 de novembro de 2010" → "PL 1234/2010" — cobrindo sufixo de
// letra (-A/-G), data por extenso e a forma "nº X/AAAA". NÃO toca em "Lei nº…"
// (citações de normas vigentes ficam intactas).
function encurtarProposicoes(t) {
  if (!t) return t || '';
  const ano = '(?:\\s*[-–][A-Z]+)?\\s*(?:,?\\s*de\\s+(?:\\d{1,2}[ºo]?\\s+de\\s+[a-zà-ú]+\\s+de\\s+)?|\\/)\\s*(\\d{4})';
  const sub = (frase, sigla) => { t = t.replace(new RegExp(frase + '\\s+n?[º°o.\\s]*([\\d.]+)' + ano, 'gi'), (m, n, a) => `${sigla} ${n.replace(/\./g, '')}/${a}`); };
  sub('Projeto\\s+de\\s+Lei\\s+Complementar', 'PLP');
  sub('Projeto\\s+de\\s+Lei', 'PL');
  sub('Proposta\\s+de\\s+Emenda\\s+[àaÀA]\\s+Constitui[çc][ãa]o', 'PEC');
  sub('Projeto\\s+de\\s+Decreto\\s+Legislativo', 'PDL');
  sub('Medida\\s+Provis[óo]ria', 'MPV');
  sub('Projeto\\s+de\\s+Resolu[çc][ãa]o', 'PRC');
  return t;
}

// Remove uma seção "## <título>" inteira (até o próximo "## " ou o fim).

/**
 * CSS de impressão do Plenário — o formato da casa.
 *
 * Extraído para constante porque agora tem DOIS consumidores: a pauta
 * exportada e o Parecer de Especialista. Duplicar o bloco garantiria que os
 * dois divergissem na primeira vez que alguém ajustasse uma margem.
 *
 * O numero de pagina vem do @bottom-center, que e CSS Paged Media: quem o
 * renderiza e o paged.js, carregado antes de imprimir. O indice usa
 * target-counter, que so o paged.js resolve.
 */
const CSS_IMPRESSAO_PLENARIO = `    @page { size:A4; margin:16mm; @bottom-center { content: counter(page); font-size:9pt; color:#888; } }
    * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { font-family:'Segoe UI',Arial,sans-serif; color:#1a1a1a; margin:0; }
    .cab { display:flex; align-items:center; gap:16px; }
    .cab .tit { flex:1; text-align:center; }
    .cab .tit h1 { font-size:16pt; font-weight:700; color:#003c1f; margin:0; text-align:center; }
    .cab .tit p  { font-size:10pt; color:#003c1f; margin:2px 0 0; text-align:center; }
    .cab img { height:42px; }
    .cab .sp { width:42px; }
    .rule { border-bottom:2px solid #00A859; margin:6px 0 8px; }
    .meta { text-align:center; font-style:italic; font-size:9pt; color:#6b7280; margin-bottom:14px; }
    .indice { break-after:page; page-break-after:always; }
    .indice h2 { font-size:13pt; color:#003c1f; margin-bottom:4px; }
    .indice-legenda { font-size:9pt; font-style:italic; color:#555; margin:0 0 10px; }
    .indice-legenda b { font-style:normal; color:#006633; }
    .indice ul { list-style:none; margin:0; padding:0; }
    .indice li { font-size:12pt; margin-bottom:4px; }
    .indice a { display:flex; align-items:baseline; text-decoration:none; color:#003c1f; }
    .indice a .ld { flex:1 1 auto; border-bottom:1px dotted #b9c2cc; margin:0 5px; position:relative; top:-3px; }
    .indice a::after { content: target-counter(attr(href url), page); color:#444; white-space:nowrap; }
    .bloco { margin-bottom:8px; }
    .item-h { font-size:13pt; font-weight:700; color:#003c1f; border-bottom:1px solid #ccc; padding-bottom:3px; margin:18px 0 4px; page-break-after:avoid; break-after:avoid; }
    .item-meta { font-size:9pt; color:#555; margin-bottom:4px; }
    .badges { margin:2px 0 6px; font-size:9pt; }
    .responsavel { font-size:9pt; color:#444; margin:2px 0 2px; }
    .portal { font-size:9pt; margin:0 0 6px; }
    .portal a { color:#0a4a7a; text-decoration:none; font-weight:600; }
    .badge { display:inline-block; padding:2px 8px; border-radius:999px; margin-right:4px; font-weight:600; }
    .badge-pode { background:#d3f5e2; color:#006633; }
    .badge-apens { background:#d8eef0; color:#02484d; }
    .badge-rel { background:#cfe8ff; color:#0a4a7a; }
    h2 { font-size:13pt; color:#003c1f; margin:14px 0 4px; page-break-after:avoid; break-after:avoid; }
    h3 { font-size:12pt; color:#155724; margin:10px 0 3px; }
    p { font-size:12pt; line-height:1.6; margin:6px 0; text-align:justify; hyphens:auto; orphans:2; widows:2; }
    ul { margin:4px 0 6px 18px; padding:0; }
    li { font-size:12pt; line-height:1.6; text-align:justify; margin:3px 0; }
    .pendente { color:#888; font-style:italic; background:#fafafa; border:1px dashed #ddd; padding:8px 10px; border-radius:4px; margin:6px 0; }
    .ft { margin-top:24px; padding-top:8px; border-top:1px solid #e5e7eb; font-size:8.5pt; color:#9ca3af; text-align:center; }
`;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(''));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return await res.json();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mostrarToast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${tipo}`;
  el.style.display = 'block';
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}
