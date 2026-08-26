'use strict';
// ============================================================================
// CHAT — assistente de dados da Liderança (Fases 1 e 2)
//
// Laço ReAct portado do bot (bot/src/agente.js), rodando na extensão. A IA
// escolhe QUAL ferramenta usar; ela NUNCA monta a consulta.
//
// Por que essa separação não é preferência de estilo:
//   Ao medir "projetos do Podemos votados nos últimos 30 dias" (20/08/2026),
//   a primeira tentativa filtrou por `siglaPartido === 'PODE'` no endpoint
//   /proposicoes/{id}/autores e devolveu ZERO. Esse campo NÃO EXISTE ali —
//   HTTP 200 em tudo, lista vazia, resposta confiante e errada. A resposta
//   certa (1: PL 3659/2026, Bruno Ganem) só aparece cruzando o id do
//   deputado extraído da `uri` contra a bancada. Uma IA que monta a própria
//   consulta produz o zero silencioso e não desconfia.
//   → Toda ferramenta aqui é função JS testada em testes/chat-ferramentas.test.js.
//
// Outras regras da casa que viram código, não texto de prompt:
//   · ferramentas SOMENTE-LEITURA (nenhuma escrita no Firebase);
//   · web só em domínio oficial, allow-list verificada no host FINAL;
//   · falha de fonte é DECLARADA na observação; jamais vira fato.
// ============================================================================

const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const API_CAMARA   = 'https://dadosabertos.camara.leg.br/api/v2';

const MAX_CONSULTAS = 4;       // teto de iterações de ferramenta por pergunta
const OBS_MAX       = 12000;   // teto de caracteres por observação
const MEM_TROCAS    = 8;       // últimas N trocas lembradas
const MEM_CORTE     = 1200;    // teto de chars por troca lembrada

// Domínios oficiais — decisão da Liderança, allow-list RÍGIDA no código.
const DOMINIOS_OFICIAIS = ['camara.leg.br', 'senado.leg.br', 'planalto.gov.br', 'in.gov.br'];

const app = {
  config: { provedor: 'gemini', apiKey: '', modelo: '' },
  trocas: [],          // memória da conversa
  ultimaTabela: null,  // { titulo, colunas:[], linhas:[[]], fonte } → export XLS/DOC
  pensando: false,
};

// ---------------------------------------------------------------- utilidades

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hostPermitido(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return DOMINIOS_OFICIAIS.some(d => h === d || h.endsWith('.' + d));
  } catch (_) { return false; }
}

function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Normaliza nome para casar entre fontes (a mesma regra do módulo Orçamento:
// o FNS grava "RENATA ABREU", a Câmara "Renata Abreu", o Senado com acento).
function chaveNome(n) {
  return String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

function brl(v) {
  const n = Number(v) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function hojeISO(offsetDias = 0) {
  const d = new Date(Date.now() + offsetDias * 86400000);
  return d.toISOString().slice(0, 10);
}

function dataBrasilia() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' })
    .format(new Date());
}

/** fetch com timeout que ESTOURA — quem chama decide como declarar a falha. */
async function buscar(url, opts = {}, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally { clearTimeout(t); }
}

/**
 * JSON com retry em 429 e 5xx.
 *
 * A API da Câmara limita taxa de verdade: uma consulta de votações dispara
 * ~180 requisições, e a seguinte pega 429. Sem retry, a ferramenta devolve
 * "ERRO:" por azar de momento — e o analista lê "não foi possível apurar"
 * quando o dado existe. Foi assim que os oradores do bot caíram (HTTP 429 ×3).
 * Erro de cliente (4xx que não seja 429) não se repete: estoura na hora.
 */
async function json(url, ms = 25000) {
  const espera = [0, 1500, 5000, 12000];
  let ultima = null;
  for (let i = 0; i < espera.length; i++) {
    if (espera[i]) await sleep(espera[i]);
    try {
      const r = await buscar(url, { headers: { Accept: 'application/json' } }, ms);
      return await r.json();
    } catch (e) {
      ultima = e;
      const m = /HTTP (\d+)/.exec(e.message || '');
      const status = m ? Number(m[1]) : 0;
      const valeRepetir = !status || status === 429 || (status >= 500 && status < 600);
      if (!valeRepetir) throw e;
    }
  }
  throw ultima || new Error('falha após várias tentativas');
}

/** Executa `fn` sobre `itens` com no máximo `n` em voo. Falha vira null. */
async function emParalelo(itens, n, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) {
      const k = i++;
      try { out[k] = await fn(itens[k], k); } catch (_) { out[k] = null; }
    }
  }));
  return out;
}

/** Guarda a tabela para exportação e devolve o texto para a IA. */
function comTabela(titulo, colunas, linhas, fonte, texto) {
  app.ultimaTabela = { titulo, colunas, linhas, fonte, em: new Date().toISOString() };
  return texto;
}

/**
 * Junta cabeçalho e itens respeitando o teto da observação SEM cortar calado.
 *
 * `texto.slice(0, OBS_MAX)` decepava no meio: numa consulta de 40 proposições
 * votadas no Plenário, 30 entravam e 10 sumiam — entre elas o PL 4578/2025,
 * que era justamente o que a pergunta procurava. A IA recebia uma lista
 * aparentemente completa e respondia "não há". Aqui, se não couber tudo, o que
 * ficou de fora é CONTADO e o que fazer a respeito vai escrito.
 */
function montarObservacao(cabecalho, itens, teto = OBS_MAX) {
  const cab = cabecalho.filter(v => v !== null && v !== undefined);
  const base = cab.join('\n') + '\n\n';
  const reserva = 220;                       // espaço do aviso de corte
  let usado = base.length;
  const dentro = [];
  for (const it of itens) {
    if (usado + it.length + 1 > teto - reserva) break;
    dentro.push(it);
    usado += it.length + 1;
  }
  const fora = itens.length - dentro.length;
  const aviso = fora > 0
    ? [`\n⚠ ${fora} de ${itens.length} itens NÃO couberam nesta observação. `
      + `Diga isso na resposta e ofereça a planilha (a tabela exportável tem TODOS). `
      + `Para ver os que faltam, restrinja a consulta (órgão, termo ou janela menor). `
      + `NÃO conclua que algo não existe a partir desta lista.`]
    : [];
  return [base + dentro.join('\n'), ...aviso].join('');
}

// ============================================================================
// PROVEDORES DE IA — mesma matriz dos demais módulos, na chave do usuário.
// ============================================================================

const PROVEDORES = {
  gemini: {
    label: 'Google Gemini',
    modeloPadrao: 'gemini-3.1-flash-lite',
    hint: 'Obtenha em aistudio.google.com → Get API key',
    regex: /^[\w.-]{20,}$/,
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    modeloPadrao: 'gpt-4o',
    hint: 'Obtenha em platform.openai.com/api-keys',
    regex: /^sk-[\w-]{20,}$/,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    modeloPadrao: 'claude-sonnet-4-6',
    hint: 'Obtenha em console.anthropic.com → Settings → API Keys',
    regex: /^sk-ant-[\w-]{20,}$/,
  },
};

/** Valida a chave com a chamada mais barata de cada provedor (listar modelos). */
async function testarChave({ provedor, apiKey }) {
  if (!apiKey) throw new Error('informe a chave');
  let res;
  if (provedor === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1`);
  } else if (provedor === 'openai') {
    res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
  } else if (provedor === 'anthropic') {
    res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
  } else {
    throw new Error(`provedor desconhecido: ${provedor}`);
  }
  if (res.ok) return true;
  if (res.status === 401 || res.status === 403) throw new Error('chave recusada pelo provedor');
  let det = null;
  try { det = await res.json(); } catch (_) { /* corpo não-JSON */ }
  throw new Error(det?.error?.message || `HTTP ${res.status}`);
}

async function fetchIA(url, init) {
  const espera = [0, 4000, 12000, 25000];
  let ultima = null;
  for (let i = 0; i < espera.length; i++) {
    if (espera[i]) await sleep(espera[i]);
    let res;
    try { res = await fetch(url, init); }
    catch (e) { ultima = e; continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      ultima = new Error(`HTTP ${res.status}`); continue;
    }
    let det = null;
    try { det = await res.json(); } catch (_) { /* corpo não-JSON */ }
    throw new Error(det?.error?.message || `HTTP ${res.status}`);
  }
  throw ultima || new Error('falha após várias tentativas');
}

async function chamarIAtexto({ provedor, apiKey, modelo, prompt, maxTokens = 2500 }) {
  if (provedor === 'gemini') {
    const m = modelo || PROVEDORES.gemini.modeloPadrao;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const j = await fetchIA(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
      }),
    });
    // Modelos "thinking" devolvem várias parts; junta só as de texto.
    return (j.candidates?.[0]?.content?.parts || [])
      .filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  }
  if (provedor === 'openai') {
    const m = modelo || PROVEDORES.openai.modeloPadrao;
    const j = await fetchIA('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m, input: prompt, max_output_tokens: maxTokens }),
    });
    return (j.output || []).flatMap(o => o.content || [])
      .filter(c => c.type === 'output_text').map(c => c.text).join('');
  }
  if (provedor === 'anthropic') {
    const m = modelo || PROVEDORES.anthropic.modeloPadrao;
    const j = await fetchIA('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: m, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  }
  throw new Error(`provedor desconhecido: ${provedor}`);
}

/** Extrai o primeiro objeto JSON da resposta, tolerando cercas de código. */
function extrairJson(bruto) {
  const s = String(bruto || '').replace(/```[a-z]*\n?/gi, '').trim();
  const i = s.indexOf('{');
  if (i < 0) return {};
  // Varre equilibrando chaves, ignorando as que estão dentro de string.
  let prof = 0, emStr = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { emStr = !emStr; continue; }
    if (emStr) continue;
    if (c === '{') prof++;
    else if (c === '}' && --prof === 0) {
      try { return JSON.parse(s.slice(i, k + 1)); } catch (_) { return {}; }
    }
  }
  return {};
}

// ============================================================================
// FERRAMENTAS — cada uma devolve STRING. Falha vira "ERRO: …" explícito.
// ============================================================================

// ---------- Orçamento (Firebase: coletas do próprio módulo) ----------

async function orcamentoCobertura() {
  const [fns, tr] = await Promise.all([
    json(`${FIREBASE_URL}/emendas-fns.json?shallow=true`).catch(() => null),
    json(`${FIREBASE_URL}/orcamento-transparencia.json?shallow=true`).catch(() => null),
  ]);
  if (!fns && !tr) return 'ERRO: não foi possível ler a base do Orçamento no Firebase.';
  const linhas = ['COBERTURA DA BASE DO MÓDULO ORÇAMENTO'];
  const anosFns = fns ? Object.keys(fns).sort() : [];
  linhas.push(`Saúde/FNS — anos coletados: ${anosFns.join(', ') || 'nenhum'}`);
  for (const ano of anosFns) {
    const ufs = await json(`${FIREBASE_URL}/emendas-fns/${ano}.json?shallow=true`).catch(() => null);
    const lista = ufs ? Object.keys(ufs).sort() : [];
    linhas.push(`  ${ano}: ${lista.length} UF — ${lista.join(' ') || '(vazio)'}`);
    if (lista.length < 27) {
      linhas.push(`  ATENÇÃO: faltam ${27 - lista.length} UF em ${ano}. Números desse ano são PARCIAIS.`);
    }
  }
  linhas.push(`Demais pastas/Transparência — anos: ${tr ? Object.keys(tr).sort().join(', ') : 'nenhum'}`);
  return linhas.join('\n');
}

async function lerTransparencia(ano) {
  const d = await json(`${FIREBASE_URL}/orcamento-transparencia/${ano}.json`, 40000);
  if (!d || !Array.isArray(d.itens)) return null;
  return d;
}

async function orcamentoPanorama({ ano, funcao }) {
  ano = String(ano || new Date().getFullYear()).replace(/\D/g, '');
  let d;
  try { d = await lerTransparencia(ano); }
  catch (e) { return `ERRO: falha ao ler a base do Orçamento (${e.message}).`; }
  if (!d) return `Nenhuma coleta do Portal da Transparência para ${ano}. Rode "Atualizar panorama" no módulo Orçamento.`;

  let itens = d.itens;
  if (funcao) {
    const f = chaveNome(funcao);
    itens = itens.filter(i => chaveNome(i.funcao).includes(f));
    if (!itens.length) {
      const disp = [...new Set(d.itens.map(i => i.funcao))].sort();
      return `Nenhuma emenda na função "${funcao}" em ${ano}. Funções presentes na base: ${disp.join('; ')}.`;
    }
  }
  const soma = k => itens.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  const porFuncao = {};
  for (const i of itens) {
    const f = i.funcao || '(sem função)';
    porFuncao[f] = porFuncao[f] || { n: 0, empenhado: 0, pago: 0 };
    porFuncao[f].n++;
    porFuncao[f].empenhado += Number(i.empenhado) || 0;
    porFuncao[f].pago += Number(i.pago) || 0;
  }
  const ordenadas = Object.entries(porFuncao).sort((a, b) => b[1].pago - a[1].pago);
  const linhas = ordenadas.map(([f, v]) => [f, v.n, Math.round(v.empenhado), Math.round(v.pago)]);

  const txt = [
    `PANORAMA ${ano}${funcao ? ` — função "${funcao}"` : ''} (Portal da Transparência)`,
    `Coletado em ${String(d.em || '').slice(0, 10)} · ${d.parlamentares || '?'} parlamentares · ${itens.length} emendas`,
    d.composicao ? `Composição da bancada: ${d.composicao}` : null,
    d.falhas ? `ATENÇÃO: ${d.falhas} parlamentar(es) falharam na coleta — os totais estão INCOMPLETOS.` : null,
    '',
    `Empenhado ${brl(soma('empenhado'))} · Liquidado ${brl(soma('liquidado'))} · Pago ${brl(soma('pago'))}`,
    `Restos inscritos ${brl(soma('restoInscrito'))} · Restos pagos ${brl(soma('restoPago'))}`,
    '',
    'Por função (ordenado pelo pago):',
    ...ordenadas.map(([f, v]) => `• ${f}: ${v.n} emendas · empenhado ${brl(v.empenhado)} · pago ${brl(v.pago)}`),
  ].filter(v => v !== null).join('\n');

  return comTabela(`Panorama ${ano}${funcao ? ' — ' + funcao : ''}`,
    ['Função', 'Emendas', 'Empenhado', 'Pago'], linhas,
    `Portal da Transparência, coleta de ${String(d.em || '').slice(0, 10)}`, txt.slice(0, OBS_MAX));
}

async function orcamentoParlamentar({ nome, ano }) {
  if (!nome) return 'ERRO: informe o nome do parlamentar.';
  ano = String(ano || new Date().getFullYear()).replace(/\D/g, '');
  let d;
  try { d = await lerTransparencia(ano); }
  catch (e) { return `ERRO: falha ao ler a base do Orçamento (${e.message}).`; }
  if (!d) return `Nenhuma coleta do Portal da Transparência para ${ano}.`;

  const alvo = chaveNome(nome);
  let itens = d.itens.filter(i => chaveNome(i.parlamentar) === alvo);
  if (!itens.length) itens = d.itens.filter(i => chaveNome(i.parlamentar).includes(alvo));
  if (!itens.length) {
    const nomes = [...new Set(d.itens.map(i => i.parlamentar))].sort();
    return `Nenhuma emenda de "${nome}" em ${ano}. Parlamentares com emenda na base: ${nomes.join('; ')}.`;
  }
  const quem = itens[0].parlamentar;
  const soma = k => itens.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  const porFuncao = {};
  for (const i of itens) {
    const f = i.funcao || '(sem função)';
    porFuncao[f] = porFuncao[f] || { n: 0, empenhado: 0, pago: 0 };
    porFuncao[f].n++;
    porFuncao[f].empenhado += Number(i.empenhado) || 0;
    porFuncao[f].pago += Number(i.pago) || 0;
  }
  const linhas = itens.map(i => [i.codigo, i.funcao, i.localidade, i.tipo,
    Math.round(i.empenhado || 0), Math.round(i.pago || 0)]);

  const txt = [
    `${quem} — ${itens[0].casa === 'senador' ? 'Senador(a)' : 'Deputado(a)'} · situação: ${itens[0].situacao || '?'}`,
    `Exercício ${ano} · ${itens.length} emendas (Portal da Transparência)`,
    `Empenhado ${brl(soma('empenhado'))} · Liquidado ${brl(soma('liquidado'))} · Pago ${brl(soma('pago'))}`,
    '',
    'Por função:',
    ...Object.entries(porFuncao).sort((a, b) => b[1].pago - a[1].pago)
      .map(([f, v]) => `• ${f}: ${v.n} emendas · pago ${brl(v.pago)} de ${brl(v.empenhado)} empenhado`),
  ].join('\n');

  return comTabela(`${quem} — emendas ${ano}`,
    ['Código', 'Função', 'Localidade', 'Tipo', 'Empenhado', 'Pago'], linhas,
    `Portal da Transparência, coleta de ${String(d.em || '').slice(0, 10)}`, txt.slice(0, OBS_MAX));
}

async function orcamentoSaudeUF({ uf, ano, deputado }) {
  if (!uf) return 'ERRO: informe a UF (ex.: SP).';
  uf = String(uf).toUpperCase().trim();
  ano = String(ano || new Date().getFullYear()).replace(/\D/g, '');
  let d;
  try { d = await json(`${FIREBASE_URL}/emendas-fns/${ano}/${uf}.json`, 40000); }
  catch (e) { return `ERRO: falha ao ler a base do FNS (${e.message}).`; }
  if (!d || !Array.isArray(d.itens)) {
    return `Nenhuma coleta do FNS para ${uf} em ${ano}. Colete a UF no módulo Orçamento.`;
  }
  let itens = d.itens;
  if (deputado) {
    const alvo = chaveNome(deputado);
    itens = itens.filter(i => chaveNome(i.deputado).includes(alvo));
    if (!itens.length) {
      const nomes = [...new Set(d.itens.map(i => i.deputado))].sort();
      return `Nenhuma proposta de "${deputado}" em ${uf}/${ano}. Na UF constam: ${nomes.join('; ')}.`;
    }
  }
  const soma = k => itens.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  const porEtapa = {};
  for (const i of itens) {
    const s = i.situacao || '(sem situação)';
    porEtapa[s] = (porEtapa[s] || 0) + 1;
  }
  const linhas = itens.map(i => [i.nuProposta, i.deputado, i.municipio, i.entidade,
    i.situacao, Math.round(i.proposto || 0), Math.round(i.pago || 0)]);

  const txt = [
    `SAÚDE/FNS — ${uf}, exercício ${ano}${deputado ? ` · filtro "${deputado}"` : ''}`,
    `Coletado em ${String(d.em || '').slice(0, 10)} · ${itens.length} propostas do Podemos`,
    `Proposto ${brl(soma('proposto'))} · Empenhado ${brl(soma('empenhado'))} · Pago ${brl(soma('pago'))}`,
    '',
    'Por situação:',
    ...Object.entries(porEtapa).sort((a, b) => b[1] - a[1]).map(([s, n]) => `• ${s}: ${n}`),
  ].join('\n');

  return comTabela(`Saúde/FNS — ${uf} ${ano}`,
    ['Nº Proposta', 'Deputado', 'Município', 'Entidade', 'Situação', 'Proposto', 'Pago'], linhas,
    `Fundo Nacional de Saúde, coleta de ${String(d.em || '').slice(0, 10)}`, txt.slice(0, OBS_MAX));
}

// ---------- Firebase: bases dos outros módulos ----------

async function notasTecnicas({ termo }) {
  let d;
  try { d = await json(`${FIREBASE_URL}/analises_pauta.json`, 40000); }
  catch (e) { return `ERRO: falha ao ler as análises no Firebase (${e.message}).`; }
  if (!d || typeof d !== 'object') return 'Nenhuma análise de pauta salva no Firebase.';

  const entradas = Object.entries(d);
  if (!termo) {
    return `Há ${entradas.length} análises salvas. Identificadores: ${entradas.map(([k]) => k).slice(0, 60).join(', ')}`;
  }
  const alvo = chaveNome(termo);
  const achados = entradas.filter(([k, v]) =>
    chaveNome(k).includes(alvo) || chaveNome(JSON.stringify(v)).includes(alvo));
  if (!achados.length) {
    return `Nenhuma análise menciona "${termo}". Foram procuradas ${entradas.length} análises.`;
  }
  return achados.slice(0, 5).map(([k, v]) => {
    const texto = typeof v === 'string' ? v : (v?.texto || v?.analise || JSON.stringify(v));
    return `— ${k}\n${String(texto).slice(0, 2500)}`;
  }).join('\n\n').slice(0, OBS_MAX);
}

// ---------- API da Câmara ----------

/**
 * Bancada do Podemos — REGRA ÚNICA, usada por todas as ferramentas.
 *
 * Duas armadilhas, as duas já custaram caro:
 *  1. `?siglaPartido=PODE` SEM legislatura omite licenciados — a presidente do
 *     partido sumia da própria bancada. Por isso a legislatura entra.
 *  2. A lista da legislatura inclui QUEM JÁ SAIU e repete o mesmo id com
 *     partidos diferentes (Mauricio Marcon aparece como PODE e como PL). Sem
 *     conferir a filiação de HOJE, ex-membros entram na conta: em 26/08/2026 a
 *     lista de proposições da bancada trouxe Dr. Victor Linhalis (PSB) e
 *     Mauricio Marcon (PL) como se fossem do Podemos.
 *
 * Filtra por `ultimoStatus.siglaPartido` — filiação de hoje — INDEPENDENTE da
 * situação, para que licenciado continue na bancada e ex-membro saia dela.
 * O resultado é memorizado na sessão: são ~43 fichas por chamada.
 */
let _bancadaCache = null;

async function bancadaAtual() {
  if (_bancadaCache) return _bancadaCache;
  const leg = await json(`${API_CAMARA}/legislaturas?ordem=DESC&ordenarPor=id&itens=1`);
  const idLeg = leg.dados?.[0]?.id;
  if (!idLeg) throw new Error('não foi possível descobrir a legislatura atual');
  const d = await json(`${API_CAMARA}/deputados?siglaPartido=PODE&idLegislatura=${idLeg}&itens=100`);
  const candidatos = [...new Set((d.dados || []).map(x => x.id))];

  const fichas = await emParalelo(candidatos, 6, async id => {
    const f = await json(`${API_CAMARA}/deputados/${id}`);
    const u = f.dados?.ultimoStatus || {};
    return { id, nome: u.nomeEleitoral || f.dados?.nomeCivil, uf: u.siglaUf, partido: u.siglaPartido, situacao: u.situacao };
  });
  const lidas = fichas.filter(Boolean);
  const naoLidas = fichas.length - lidas.length;

  const membros = new Map();
  for (const f of lidas) if (/^PODE$/i.test(f.partido || '')) membros.set(f.id, f);
  const sairam = lidas.filter(f => f.partido && !/^PODE$/i.test(f.partido));

  _bancadaCache = { membros, sairam, naoLidas, candidatos: candidatos.length };
  return _bancadaCache;
}

async function bancadaPodemos() {
  let b;
  try { b = await bancadaAtual(); }
  catch (e) { return `ERRO: falha ao consultar a bancada na API da Câmara (${e.message}).`; }
  const atuais = [...b.membros.values()].sort((a, b2) => a.nome.localeCompare(b2.nome));
  const linhas = atuais.map(f => [f.nome, f.uf, f.situacao]);
  const txt = [
    `BANCADA DO PODEMOS NA CÂMARA — ${atuais.length} deputados hoje no partido`,
    b.naoLidas ? `ATENÇÃO: ${b.naoLidas} ficha(s) não puderam ser lidas — a lista pode estar incompleta.` : null,
    '',
    ...atuais.map(f => `• ${f.nome} (${f.uf}) — ${f.situacao}`),
    b.sairam.length
      ? `\nApareceram na legislatura pelo Podemos mas HOJE estão em outro partido (NÃO contam como bancada): ${b.sairam.map(f => `${f.nome} (${f.partido})`).join(', ')}`
      : null,
  ].filter(v => v !== null).join('\n');

  return comTabela('Bancada do Podemos na Câmara', ['Nome', 'UF', 'Situação'], linhas,
    'API de Dados Abertos da Câmara', txt.slice(0, OBS_MAX));
}

async function situacaoProposicao({ sigla, numero, ano }) {
  sigla  = String(sigla || '').toUpperCase().trim();
  numero = String(numero || '').replace(/\D/g, '');
  ano    = String(ano || '').replace(/\D/g, '');
  if (!sigla || !numero || !ano) return 'ERRO: informe sigla, numero e ano (ex.: PL, 3659, 2026).';
  let busca;
  try { busca = await json(`${API_CAMARA}/proposicoes?siglaTipo=${sigla}&numero=${numero}&ano=${ano}&itens=1`); }
  catch (e) { return `ERRO: falha na API da Câmara (${e.message}).`; }
  const p = (busca.dados || [])[0];
  if (!p) return `Nenhuma proposição ${sigla} ${numero}/${ano} na API da Câmara.`;
  const det = (await json(`${API_CAMARA}/proposicoes/${p.id}`)).dados || {};
  const st = det.statusProposicao || {};
  let autores = [];
  try { autores = (await json(`${API_CAMARA}/proposicoes/${p.id}/autores`)).dados || []; } catch (_) { /* declarado abaixo */ }
  const banc = (await bancadaAtual().catch(() => null))?.membros || new Map();
  const idDe = u => { const m = /\/deputados\/(\d+)/.exec(u || ''); return m ? +m[1] : null; };
  const doPode = autores.filter(a => banc.has(idDe(a.uri))).map(a => a.nome);

  return [
    `${sigla} ${numero}/${ano} — id ${p.id}`,
    `Ementa: ${det.ementa || p.ementa || '(sem ementa)'}`,
    autores.length ? `Autoria: ${autores.slice(0, 6).map(a => a.nome).join(', ')}${autores.length > 6 ? ' e outros' : ''}`
                   : 'Autoria: não foi possível consultar.',
    doPode.length ? `Do Podemos: ${doPode.join(', ')}`
                  : (autores.length ? 'Do Podemos: nenhum autor da bancada.' : null),
    st.descricaoSituacao ? `Situação: ${st.descricaoSituacao}` : null,
    st.siglaOrgao ? `Onde está: ${st.siglaOrgao}` : null,
    st.descricaoTramitacao ? `Última tramitação: ${st.descricaoTramitacao}${st.dataHora ? ` (${String(st.dataHora).slice(0, 10)})` : ''}` : null,
    det.urlInteiroTeor ? `Inteiro teor: ${det.urlInteiroTeor}` : null,
  ].filter(Boolean).join('\n').slice(0, OBS_MAX);
}

/**
 * Votações num período.
 *
 * VERSÃO ANTERIOR PERDIA 75% DAS VOTAÇÕES. Ela filtrava por
 * `v.proposicaoObjeto`, que vem NULO na maioria: em 10–14/08/2026 foram 486
 * votações, das quais só 120 tinham esse campo. As 366 restantes eram
 * descartadas sem aviso — inclusive as duas do PL 4578/2025 (futebol
 * feminino), aprovado no Plenário em 13/08. A pergunta "houve projeto sobre
 * futebol feminino aprovado?" recebeu "não houve" com o dado na base.
 *
 * O identificador da votação carrega a proposição: "2560976-30" → 2560976 =
 * PL 4578/2025. É daí que a matéria sai, sem requisição nenhuma.
 *
 * Dois sentidos de "matéria votada", e os dois importam:
 *   · o PREFIXO do id é o objeto posto em votação (pode ser um REQ);
 *   · `proposicoesAfetadas` (só no detalhe) é a matéria atingida — a votação
 *     2642749-7 é do REQ 4019/2026 e afeta o PL 1800/2023.
 * O prefixo é de graça e cobre o caso comum; `detalhar:true` acrescenta as
 * afetadas ao custo de uma requisição por votação.
 *
 * Autoria cruza por ID DO DEPUTADO extraído da `uri`: /autores NÃO tem
 * `siglaPartido`, e filtrar por esse campo devolve zero silencioso.
 */
async function votacoesPeriodo({ dias, dataInicio, dataFim, orgao, termo, apenasPodemos = false, detalhar = false }) {
  const fim = dataFim || hojeISO();
  const ini = dataInicio || hojeISO(-(Number(dias) || 30));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return 'ERRO: datas devem ser AAAA-MM-DD.';
  }
  if (fim < ini) return `ERRO: a data final (${fim}) é anterior à inicial (${ini}).`;

  let vots = [];
  try {
    for (let pag = 1; pag <= 30; pag++) {
      const d = await json(`${API_CAMARA}/votacoes?dataInicio=${ini}&dataFim=${fim}&itens=100&pagina=${pag}`, 30000);
      vots.push(...(d.dados || []));
      if ((d.dados || []).length < 100) break;   // itens=100 é o teto real da API
    }
  } catch (e) { return `ERRO: falha ao listar votações (${e.message}).`; }
  if (!vots.length) return `JANELA CONSULTADA: ${ini} a ${fim}.\nNenhuma votação registrada no período.`;

  const totalVots = vots.length;
  const todas = vots;
  const orgaoAlvo = orgao ? String(orgao).toUpperCase().trim() : null;
  if (orgaoAlvo) {
    const antes = vots.length;
    vots = vots.filter(v => String(v.siglaOrgao || '').toUpperCase() === orgaoAlvo);
    if (!vots.length) {
      const orgaos = {};
      for (const v of todas) orgaos[v.siglaOrgao] = (orgaos[v.siglaOrgao] || 0) + 1;
      return `JANELA CONSULTADA: ${ini} a ${fim}.\n`
        + `Nenhuma votação no órgão "${orgaoAlvo}". Houve ${antes} votações no período, nestes órgãos: `
        + `${Object.entries(orgaos).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join('; ')}.`;
    }
  }

  // Agrupa por proposição usando o PREFIXO do id — nada é descartado.
  const porProp = new Map();
  for (const v of vots) {
    const pid = String(v.id).split('-')[0];
    if (!/^\d+$/.test(pid)) continue;
    if (!porProp.has(pid)) porProp.set(pid, []);
    porProp.get(pid).push(v);
  }
  const semId = vots.length - [...porProp.values()].reduce((s, a) => s + a.length, 0);

  // `detalhar` acrescenta as matérias AFETADAS (um REQ de urgência sobre um PL
  // faz o PL aparecer). Custa uma requisição por votação.
  let falhasDet = 0;
  if (detalhar) {
    const extras = await emParalelo(vots, 6, async v => {
      const d = await json(`${API_CAMARA}/votacoes/${v.id}`);
      return { v, af: (d.dados?.proposicoesAfetadas || []).map(p => String(p.id)) };
    });
    falhasDet = extras.filter(x => x === null).length;
    for (const x of extras.filter(Boolean)) {
      for (const pid of x.af) {
        if (!porProp.has(pid)) porProp.set(pid, []);
        if (!porProp.get(pid).includes(x.v)) porProp.get(pid).push(x.v);
      }
    }
  }

  const ids = [...porProp.keys()];
  const TETO = 260;
  if (ids.length > TETO) {
    const orgaos = {};
    for (const v of vots) orgaos[v.siglaOrgao] = (orgaos[v.siglaOrgao] || 0) + 1;
    return `JANELA CONSULTADA: ${ini} a ${fim}.\n`
      + `São ${vots.length} votações em ${ids.length} proposições distintas — demais para detalhar de uma vez.\n`
      + `RESTRINJA e consulte de novo: por órgão (orgao:"PLEN" para o Plenário) ou por janela menor.\n`
      + `Votações por órgão no período: ${Object.entries(orgaos).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join('; ')}.`;
  }

  const fichas = await emParalelo(ids, 6, async pid => {
    const d = await json(`${API_CAMARA}/proposicoes/${pid}`);
    const p = d.dados || {};
    return { pid, sigla: p.siglaTipo, numero: p.numero, ano: p.ano, ementa: p.ementa || '' };
  });
  const lidas = fichas.filter(Boolean);
  const naoLidas = fichas.length - lidas.length;

  let itens = lidas.map(f => {
    const vv = porProp.get(f.pid);
    return {
      ...f,
      votacoes: vv,
      datas: [...new Set(vv.map(v => v.data))].sort(),
      orgaos: [...new Set(vv.map(v => v.siglaOrgao))],
      descricoes: vv.map(v => v.descricao || '').filter(Boolean),
    };
  });

  // Filtro por tema: procura na ementa E na descrição da votação (é lá que
  // está "Aprovada a Redação Final…", "Aprovado o Substitutivo…").
  let filtradoPor = null;
  if (termo) {
    const alvo = chaveNome(termo);
    const palavras = alvo.split(' ').filter(w => w.length > 2);
    const casa = t => { const k = chaveNome(t); return palavras.every(w => k.includes(w)); };
    const antes = itens.length;
    itens = itens.filter(x => casa(x.ementa) || x.descricoes.some(casa));
    filtradoPor = `termo "${termo}": ${itens.length} de ${antes} proposições votadas`;
  }

  const banc = (await bancadaAtual().catch(() => null))?.membros || null;
  const idDe = u => { const m = /\/deputados\/(\d+)/.exec(u || ''); return m ? +m[1] : null; };
  if (banc && itens.length <= TETO) {
    const comAutor = await emParalelo(itens, 6, async x => {
      const a = (await json(`${API_CAMARA}/proposicoes/${x.pid}/autores`)).dados || [];
      x.podemos = a.filter(y => banc.has(idDe(y.uri))).map(y => y.nome);
      return true;
    });
    void comAutor;
  }
  if (apenasPodemos) {
    if (!banc) return 'ERRO: não foi possível montar a bancada, então não dá para filtrar por autoria. Consulte sem o filtro.';
    itens = itens.filter(x => (x.podemos || []).length);
  }

  itens.sort((a, b) => (a.datas[0] || '').localeCompare(b.datas[0] || '')
    || `${a.sigla}${a.numero}`.localeCompare(`${b.sigla}${b.numero}`));

  const cab = [
    `JANELA CONSULTADA: ${ini} a ${fim}.  ← use ESTA janela na resposta, não outra.`,
    `${totalVots} votações no período${orgaoAlvo ? `, ${vots.length} no órgão ${orgaoAlvo}` : ''} → ${ids.length} proposições distintas.`,
    detalhar
      ? `Matérias afetadas incluídas (detalhe de cada votação).${falhasDet ? ` ATENÇÃO: ${falhasDet} votação(ões) não puderam ser detalhadas.` : ''}`
      : `Matéria obtida do identificador da votação. Requerimentos que AFETAM outra matéria só aparecem com detalhar:true.`,
    filtradoPor,
    apenasPodemos ? `Filtro de autoria: só matérias com autor da bancada.` : null,
    semId ? `ATENÇÃO: ${semId} votação(ões) sem proposição no identificador.` : null,
    naoLidas ? `ATENÇÃO: ${naoLidas} proposição(ões) não puderam ser lidas — a lista pode estar incompleta.` : null,
    !banc ? `ATENÇÃO: bancada indisponível — a marcação de autoria do Podemos não pôde ser feita.` : null,
    `A LISTA ABAIXO ESTÁ COMPLETA (${itens.length} itens). Reproduza os que interessam; não invente nem omita.`,
  ].filter(v => v !== null && v !== undefined);

  if (!itens.length) {
    cab.push('', termo
      ? `Nenhuma das ${ids.length} proposições votadas casa com "${termo}".`
      : 'Nenhuma proposição votada no recorte pedido.');
  }

  // Orçamento de texto por item: com muitos itens, ementa curta cabe todo
  // mundo; com poucos, cabe o detalhe. É preferível listar TODAS as matérias
  // com ementa curta a listar 3/4 delas com ementa longa — foi o corte que
  // fez o PL 4578/2025 desaparecer de uma lista aparentemente completa.
  // Teto DURO por item, dividido entre ementa e descrições das votações. Uma
  // matéria com 5 votações estourava sozinha o orçamento e empurrava outras
  // para fora da lista.
  const porItem = Math.max(170, Math.floor((OBS_MAX - 1800) / Math.max(1, itens.length)));
  const corpo = itens.map(x => {
    const q = (x.podemos || []);
    const cabItem = `• ${x.sigla} ${x.numero}/${x.ano} — ${x.datas.join(', ')} · ${x.orgaos.join(', ')}`
      + (q.length ? ` · AUTORIA PODEMOS: ${q.join(', ')}` : '');
    const sobra = Math.max(80, porItem - cabItem.length);
    const paraEmenta = Math.ceil(sobra * 0.6);
    const paraVotos = sobra - paraEmenta;
    const votos = x.descricoes.join(' | ');
    return cabItem
      + `\n  ${x.ementa.slice(0, paraEmenta)}`
      + (votos ? `\n  Votações: ${votos.slice(0, paraVotos)}` : '');
  });

  const linhas = itens.map(x => [`${x.sigla} ${x.numero}/${x.ano}`, x.datas.join(', '),
    x.orgaos.join(', '), (x.podemos || []).join(', '), x.descricoes.join(' | ').slice(0, 300),
    x.ementa.slice(0, 300)]);

  return comTabela(`Votações ${ini} a ${fim}`,
    ['Proposição', 'Data', 'Órgão', 'Autoria Podemos', 'Votações', 'Ementa'], linhas,
    'API de Dados Abertos da Câmara', montarObservacao(cab, corpo));
}

/**
 * Classes de matéria. "Projeto" NÃO é sinônimo de "proposição": numa semana
 * comum (10 a 14/08/2026) a bancada figurou em 41 proposições de 13 tipos, das
 * quais só 12 eram PL. Requerimento, parecer de relator e substitutivo entraram
 * numa lista única e foram apresentados ao usuário como se fossem projetos.
 */
const CLASSES = {
  projeto:    ['PL', 'PLP', 'PEC', 'PDL', 'PDC', 'PLV', 'MPV', 'PLN', 'PRC'],
  requerimento: ['REQ', 'RIC', 'REC', 'INC', 'DOC', 'RCP'],
  relatoria:  ['PRL', 'PRLP', 'SBT', 'CPR'],       // trabalho de relator
  emenda:     ['EMP', 'EMC', 'EMS', 'EMR', 'ERD'],
};

function classeDe(sigla) {
  const s = String(sigla || '').toUpperCase();
  for (const [classe, siglas] of Object.entries(CLASSES)) if (siglas.includes(s)) return classe;
  return 'outros';
}

const ROTULO_CLASSE = {
  projeto: 'PROJETOS (PL, PLP, PEC, PDL…)',
  requerimento: 'REQUERIMENTOS (REQ, RIC, REC, INC…)',
  relatoria: 'RELATORIA (pareceres, substitutivos)',
  emenda: 'EMENDAS',
  outros: 'OUTROS TIPOS',
};

/**
 * Proposições APRESENTADAS pela bancada num período.
 *
 * `classe` restringe ao que o usuário pediu: quem pergunta por "projetos"
 * quer projeto, não requerimento. `apensados: true` resolve, para cada
 * projeto, a proposição a que ele foi apensado (campo `uriPropPrincipal`) —
 * é isso que responde "coautoria inclusive de apensado".
 */
async function proposicoesBancada({ dias, dataInicio, dataFim, sigla, classe, apensados }) {
  const fim = dataFim || hojeISO();
  const ini = dataInicio || hojeISO(-(Number(dias) || 30));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return 'ERRO: datas devem ser AAAA-MM-DD.';
  }
  if (fim < ini) return `ERRO: a data final (${fim}) é anterior à inicial (${ini}).`;
  if (classe && !ROTULO_CLASSE[classe]) {
    return `ERRO: classe "${classe}" não existe. Use: ${Object.keys(ROTULO_CLASSE).join(', ')}.`;
  }

  let b;
  try { b = await bancadaAtual(); }
  catch (e) { return `ERRO: falha ao montar a bancada (${e.message}).`; }

  const ids = [...b.membros.keys()];
  const partes = await emParalelo(ids, 5, async id => {
    const u = `${API_CAMARA}/proposicoes?idDeputadoAutor=${id}&dataApresentacaoInicio=${ini}&dataApresentacaoFim=${fim}`
            + `${sigla ? `&siglaTipo=${String(sigla).toUpperCase()}` : ''}&itens=100&ordem=DESC&ordenarPor=id`;
    return { id, itens: (await json(u)).dados || [] };
  });
  const ok = partes.filter(Boolean);
  const falhas = partes.length - ok.length;

  const mapa = new Map();
  for (const p of ok) for (const it of p.itens) {
    if (!mapa.has(it.id)) mapa.set(it.id, { it, autores: [], classe: classeDe(it.siglaTipo) });
    mapa.get(it.id).autores.push(b.membros.get(p.id).nome);
  }
  let lista = [...mapa.values()];
  const totalBruto = lista.length;
  if (classe) lista = lista.filter(x => x.classe === classe);

  if (!lista.length) {
    const porClasse = {};
    for (const x of mapa.values()) porClasse[x.classe] = (porClasse[x.classe] || 0) + 1;
    return `JANELA CONSULTADA: ${ini} a ${fim}.\n`
      + `Nenhum item da classe "${classe || 'qualquer'}" apresentado pela bancada nesse período.`
      + (totalBruto ? ` Havia ${totalBruto} proposição(ões) de outras classes: `
          + Object.entries(porClasse).map(([c, n]) => `${ROTULO_CLASSE[c]} ${n}`).join('; ') + '.' : '')
      + (falhas ? ` ATENÇÃO: ${falhas} deputado(s) falharam na consulta.` : '');
  }

  // Apensamento: só faz sentido para projeto, e custa 1 requisição por item.
  let apensou = 0;
  if (apensados) {
    const projetos = lista.filter(x => x.classe === 'projeto');
    await emParalelo(projetos, 6, async x => {
      const det = (await json(`${API_CAMARA}/proposicoes/${x.it.id}`)).dados || {};
      if (!det.uriPropPrincipal) return null;
      const pr = (await json(det.uriPropPrincipal)).dados || {};
      x.principal = `${pr.siglaTipo} ${pr.numero}/${pr.ano}`;
      apensou++;
      return null;
    });
  }

  lista.sort((a, c) => a.classe.localeCompare(c.classe)
    || `${a.it.siglaTipo}${a.it.numero}`.localeCompare(`${c.it.siglaTipo}${c.it.numero}`));

  const linhas = lista.map(x => [`${x.it.siglaTipo} ${x.it.numero}/${x.it.ano}`,
    ROTULO_CLASSE[x.classe].split(' (')[0], x.autores.join(', '),
    x.principal || '', (x.it.ementa || '').slice(0, 300)]);

  const grupos = {};
  for (const x of lista) (grupos[x.classe] = grupos[x.classe] || []).push(x);

  const corpo = [];
  for (const c of ['projeto', 'requerimento', 'relatoria', 'emenda', 'outros']) {
    if (!grupos[c]) continue;
    corpo.push('', `${ROTULO_CLASSE[c]} — ${grupos[c].length}:`);
    for (const x of grupos[c]) {
      corpo.push(`• ${x.it.siglaTipo} ${x.it.numero}/${x.it.ano} — ${x.autores.join(', ')}`
        + (x.principal ? `  [apensado a ${x.principal}]` : ''));
      if (x.it.ementa) corpo.push(`  ${x.it.ementa.slice(0, 200)}`);
    }
  }

  const cab = [
    `JANELA CONSULTADA: ${ini} a ${fim}.  ← use ESTA janela na resposta, não outra.`,
    `Bancada: ${b.membros.size} deputados HOJE no Podemos${b.sairam.length ? ` (${b.sairam.length} ex-membro(s) excluído(s): ${b.sairam.map(f => `${f.nome} → ${f.partido}`).join(', ')})` : ''}.`,
    classe
      ? `Filtro de classe: ${ROTULO_CLASSE[classe]}. ${lista.length} de ${totalBruto} proposições do período.`
      : `${lista.length} proposições, de ${Object.keys(grupos).length} classes diferentes. ATENÇÃO: "projeto" é só a classe PROJETOS — não apresente requerimento, parecer ou emenda como projeto.`,
    `A LISTA ABAIXO ESTÁ COMPLETA (${lista.length} itens). Reproduza TODOS; não resuma nem corte.`,
    apensados ? `Apensamento conferido: ${apensou} de ${grupos.projeto?.length || 0} projeto(s) estão apensados a outra proposição.` : null,
    falhas ? `ATENÇÃO: ${falhas} deputado(s) falharam na consulta — a lista pode estar incompleta.` : null,
    b.naoLidas ? `ATENÇÃO: ${b.naoLidas} ficha(s) de deputado não puderam ser lidas.` : null,
  ].filter(v => v !== null);

  return comTabela(`Proposições da bancada ${ini} a ${fim}`,
    ['Proposição', 'Classe', 'Autoria Podemos', 'Apensado a', 'Ementa'], linhas,
    'API de Dados Abertos da Câmara', montarObservacao(cab, corpo));
}

async function paginaOficial({ url }) {
  if (!url) return 'ERRO: informe a url.';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!hostPermitido(url)) {
    return `ERRO: domínio fora da lista oficial permitida (${DOMINIOS_OFICIAIS.join(', ')}).`;
  }
  let r;
  try { r = await buscar(url, { redirect: 'follow' }, 20000); }
  catch (e) { return `ERRO: ${e.name === 'AbortError' ? 'tempo esgotado' : e.message}.`; }
  // O redirect pode ter saído do domínio oficial — recusa também.
  if (r.url && !hostPermitido(r.url)) return 'ERRO: a página redirecionou para fora dos domínios oficiais.';
  const tipo = r.headers.get('content-type') || '';
  if (/pdf|octet-stream|image|audio|video/i.test(tipo)) return 'ERRO: a URL não é página de texto.';
  const texto = htmlParaTexto(await r.text());
  if (!texto) return 'ERRO: página sem texto legível.';
  return `[Fonte: ${r.url || url}]\n${texto.slice(0, OBS_MAX)}`;
}

const FERRAMENTAS = {
  orcamento_cobertura:   orcamentoCobertura,
  orcamento_panorama:    orcamentoPanorama,
  orcamento_parlamentar: orcamentoParlamentar,
  orcamento_saude_uf:    orcamentoSaudeUF,
  notas_tecnicas:        notasTecnicas,
  bancada_podemos:       bancadaPodemos,
  situacao_proposicao:   situacaoProposicao,
  votacoes_periodo:      votacoesPeriodo,
  proposicoes_bancada:   proposicoesBancada,
  pagina_oficial:        paginaOficial,
};

const CATALOGO = `
FERRAMENTAS (o resultado volta para você como OBSERVAÇÃO, para continuar raciocinando):

ORÇAMENTO — base do próprio SisPode (coletada pelo módulo Orçamento):
- "orcamento_cobertura" {}: quais anos e UFs já foram coletados. Use ANTES de afirmar totais, para saber se a base está completa.
- "orcamento_panorama" {"ano":"2026","funcao":null}: total empenhado/liquidado/pago da bancada no exercício, quebrado por função (Saúde, Assistência social, Educação…). "funcao" filtra uma pasta.
- "orcamento_parlamentar" {"nome":"Renata Abreu","ano":"2026"}: emendas de UM parlamentar, com totais e quebra por função.
- "orcamento_saude_uf" {"uf":"SP","ano":"2026","deputado":null}: propostas de saúde no FNS numa UF — município, entidade, situação e valor pago. É a fonte FINA da saúde; fora da saúde só existe o Portal da Transparência.

CÂMARA — API oficial de Dados Abertos:
- "bancada_podemos" {}: quem é a bancada hoje, com UF e situação (exercício, licença, suplência).
- "situacao_proposicao" {"sigla":"PL","numero":"3659","ano":"2026"}: ementa, autoria, situação e última tramitação de qualquer proposição. Já diz se há autoria da bancada.
- "votacoes_periodo" {"dias":30,"orgao":null,"termo":null,"apenasPodemos":false,"detalhar":false}: o que foi VOTADO no período. Para período FECHADO mande SEMPRE o par {"dataInicio":"2026-07-01","dataFim":"2026-07-31"} — só dataInicio faz a janela ir até HOJE.
  "orgao":"PLEN" restringe ao PLENÁRIO. Use SEMPRE que a pergunta disser "em plenário" — sem isso vêm também as comissões, e numa semana comum são ~486 votações em 25 órgãos.
  "termo":"futebol feminino" filtra por ASSUNTO, procurando na ementa E na descrição da votação ("Aprovada a Redação Final…"). Use quando a pergunta for temática. O termo casa por palavras, sem acento e sem caixa.
  "apenasPodemos":true restringe a matérias com autor da bancada — só use se a pergunta for sobre autoria. A autoria do Podemos é marcada na lista de qualquer jeito.
  "detalhar":true acrescenta as matérias AFETADAS por cada votação (um requerimento de urgência sobre um PL faz o PL aparecer). Custa uma requisição por votação; use quando a busca sem ele não achou o que deveria.
  Se vier "RESTRINJA e consulte de novo", o recorte é largo demais: chame outra vez com "orgao" ou janela menor. NÃO responda com o aviso.
- "proposicoes_bancada" {"dias":30,"classe":null,"sigla":null,"apensados":false}: o que a bancada APRESENTOU no período. Aceita o par dataInicio/dataFim — para semana fechada mande OS DOIS.
  "classe" restringe ao que foi pedido e é o parâmetro que mais importa:
    · "projeto"      → PL, PLP, PEC, PDL, PDC, PLV, MPV, PLN, PRC
    · "requerimento" → REQ, RIC, REC, INC, DOC, RCP
    · "relatoria"    → PRL, PRLP, SBT (parecer e substitutivo de relator)
    · "emenda"       → EMP, EMC, EMS…
  PROJETO NÃO É SINÔNIMO DE PROPOSIÇÃO. Se o usuário pediu "projetos", mande classe:"projeto" — requerimento e parecer NÃO são projetos. Sem "classe" vem tudo, separado por seção, e aí a resposta tem de manter a separação.
  "apensados":true resolve, para cada projeto, a proposição a que ele foi apensado. Use quando a pergunta mencionar apensado/apensamento.
- "pagina_oficial" {"url":"https://www.camara.leg.br/..."}: lê página de site OFICIAL (só camara.leg.br, senado.leg.br, planalto.gov.br, in.gov.br).

OUTRAS BASES DO SISPODE:
- "notas_tecnicas" {"termo":"PL 1234/2026"}: procura nas análises de pauta salvas. Sem "termo", lista o que existe.

EXPORTAÇÃO (o usuário pede; você só confirma que dá):
- "exportar_planilha" {}: gera XLSX da ÚLTIMA tabela consultada.
- "exportar_documento" {}: gera DOCX da ÚLTIMA tabela consultada.`;

const EXPORTACOES = ['exportar_planilha', 'exportar_documento'];

// ============================================================================
// LAÇO ReAct
// ============================================================================

function montarPrompt({ mensagem, observacoes, forcarResposta }) {
  const hist = app.trocas.map(t => `${t.de === 'usuario' ? 'USUÁRIO' : 'VOCÊ'}: ${t.texto}`).join('\n');
  const obs = observacoes
    .map((o, i) => `OBSERVAÇÃO ${i + 1} — ${o.ferramenta}(${JSON.stringify(o.argumentos)}):\n${o.resultado}`)
    .join('\n\n');

  return `Você é o assistente de dados da Liderança do Podemos na Câmara dos Deputados (SisPode). Hoje é ${dataBrasilia()} (Brasília). Responda em pt-BR, direto e preciso — é ambiente de trabalho parlamentar.

REGRAS QUE NÃO SE NEGOCIAM:
- NUNCA invente número, valor, data, placar, situação ou autoria. Se precisa de um dado, CONSULTE uma ferramenta.
- Se a OBSERVAÇÃO começar com "ERRO:", a fonte FALHOU. Diga que falhou e o que falhou. NÃO preencha o buraco com conhecimento próprio, NÃO estime, NÃO troque por outro dado parecido fingindo que responde. Resposta ausente é melhor que resposta sem lastro.
- Se a observação trouxer "ATENÇÃO: … incompleto/parcial", REPRODUZA essa ressalva na resposta. Total parcial apresentado como total é erro grave.
- BUSCA INCOMPLETA NÃO VIRA "NÃO EXISTE". Se a observação disser que N itens não puderam ser lidos ou detalhados, você NÃO pode concluir que algo não existe — só pode dizer que não apareceu no que foi lido. Antes de responder "não houve", esgote o que a ferramenta oferece: refaça com "orgao", com "termo", ou com "detalhar":true. Uma negativa sobre busca furada é o pior erro possível aqui.
- Lista vazia é RESPOSTA, não falha: se a ferramenta diz que não há nada, diga que não há — e diga em quantos itens foi procurado.
- A JANELA é a que a observação declara, NUNCA a que o usuário pediu. Se a observação disser "JANELA CONSULTADA: X a Y", é X a Y que você escreve na resposta. Se não for a janela pedida, DIGA isso e ofereça refazer. Nunca escreva o período do usuário sobre dados de outro período.
- NÃO RESUMA LISTA. Quando a observação disser que a lista está completa com N itens, entregue os N. Se não couber, diga quantos ficaram de fora e ofereça a planilha — jamais corte em silêncio.
- Respeite a CLASSE do que foi pedido. "Projeto" é PL/PLP/PEC/PDL e afins. Requerimento (REQ, RIC, REC, INC), parecer de relator (PRL, SBT) e emenda NÃO são projetos e não entram numa lista pedida como "projetos".
- Cite sempre a fonte ("segundo a API da Câmara", "pela coleta do FNS de 19/08").
- Ao listar pessoas ou matérias, use UM POR LINHA com "• ".
- Valores em reais no formato brasileiro.
- Quando o usuário pedir planilha ou documento, use "exportar_planilha" / "exportar_documento" — eles exportam a ÚLTIMA tabela consultada, então CONSULTE o dado antes de exportar.
${CATALOGO}

${hist ? `CONVERSA RECENTE:\n${hist}\n\n` : ''}${obs ? `${obs}\n\n` : ''}MENSAGEM DO USUÁRIO: ${mensagem}

${forcarResposta
  ? 'Você atingiu o limite de consultas. Responda AGORA com o que tem, declarando o que não conseguiu apurar: {"acao":"responder","texto":"..."}'
  : `Responda APENAS com um objeto JSON, sem cercas de código, em UMA das formas:
{"acao":"consultar","ferramenta":"<nome>","argumentos":{...}}
{"acao":"exportar","ferramenta":"exportar_planilha"|"exportar_documento"}
{"acao":"responder","texto":"<sua resposta>"}`}`;
}

function lembrar(de, texto) {
  app.trocas.push({ de, texto: String(texto || '').slice(0, MEM_CORTE) });
  if (app.trocas.length > MEM_TROCAS) app.trocas = app.trocas.slice(-MEM_TROCAS);
}

async function conversar(mensagem, aoPassar) {
  const observacoes = [];
  for (let volta = 0; volta <= MAX_CONSULTAS; volta++) {
    const forcarResposta = volta === MAX_CONSULTAS;
    const bruto = await chamarIAtexto({
      provedor: app.config.provedor, apiKey: app.config.apiKey, modelo: app.config.modelo,
      prompt: montarPrompt({ mensagem, observacoes, forcarResposta }),
    });
    const j = extrairJson(bruto);

    // A IA respondeu em prosa (sem JSON)? Entregar é melhor que falhar por formalidade.
    if (!j.acao) {
      const prosa = String(bruto || '').replace(/```[a-z]*\n?/gi, '').trim();
      return { texto: prosa || 'Não consegui elaborar uma resposta — tente reformular.' };
    }
    if (j.acao === 'responder') {
      return { texto: String(j.texto || '').trim() || 'Certo.' };
    }
    if (j.acao === 'exportar') {
      if (!EXPORTACOES.includes(j.ferramenta)) {
        observacoes.push({ ferramenta: j.ferramenta, argumentos: {}, resultado: 'ERRO: exportação inexistente.' });
        continue;
      }
      if (!app.ultimaTabela) {
        observacoes.push({ ferramenta: j.ferramenta, argumentos: {}, resultado: 'ERRO: não há tabela consultada ainda. Consulte um dado antes de exportar.' });
        continue;
      }
      return { exportar: j.ferramenta, tabela: app.ultimaTabela };
    }

    const fn = FERRAMENTAS[j.ferramenta];
    if (typeof fn !== 'function') {
      observacoes.push({ ferramenta: j.ferramenta, argumentos: j.argumentos || {}, resultado: 'ERRO: ferramenta inexistente. Escolha uma do catálogo.' });
      continue;
    }
    aoPassar?.(j.ferramenta, j.argumentos || {});
    let resultado;
    try { resultado = String(await fn(j.argumentos || {}) || '(vazio)').slice(0, OBS_MAX); }
    catch (e) { resultado = `ERRO: ${e.message}`; }
    observacoes.push({ ferramenta: j.ferramenta, argumentos: j.argumentos || {}, resultado });
  }
  return { texto: 'Não consegui concluir a consulta dentro do limite de passos.' };
}

// ============================================================================
// EXPORTAÇÃO — XLSX e DOCX a partir da última tabela
// ============================================================================

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function nomeArquivo(titulo, ext) {
  const base = String(titulo || 'sispode').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'sispode'}-${hojeISO()}.${ext}`;
}

function exportarPlanilha(t) {
  if (typeof XLSX === 'undefined') throw new Error('biblioteca de planilha não carregada');
  const aoa = [
    [t.titulo],
    [`Fonte: ${t.fonte}`],
    [`Gerado em ${new Date().toLocaleString('pt-BR')}`],
    [],
    t.colunas,
    ...t.linhas,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = t.colunas.map((c, i) => ({
    wch: Math.min(60, Math.max(String(c).length + 2,
      ...t.linhas.map(l => String(l[i] ?? '').length + 2))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  baixar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    nomeArquivo(t.titulo, 'xlsx'));
}

async function exportarDocumento(t) {
  if (typeof docx === 'undefined') throw new Error('biblioteca de documento não carregada');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType } = docx;
  const cel = (texto, negrito) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(texto ?? ''), bold: !!negrito, size: 18 })] })],
  });
  const tabela = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: t.colunas.map(c => cel(c, true)), tableHeader: true }),
      ...t.linhas.map(l => new TableRow({ children: t.colunas.map((_, i) => cel(l[i])) })),
    ],
  });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: t.titulo, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: `Fonte: ${t.fonte}`, italics: true, size: 18 })] }),
        new Paragraph({ children: [new TextRun({ text: `Gerado em ${new Date().toLocaleString('pt-BR')}`, italics: true, size: 18 })] }),
        new Paragraph({ text: '' }),
        tabela,
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: 'Documento gerado pelo SisPode — Liderança do Podemos na Câmara dos Deputados.', size: 16 })], alignment: AlignmentType.CENTER }),
      ],
    }],
  });
  baixar(await Packer.toBlob(doc), nomeArquivo(t.titulo, 'docx'));
}

// ============================================================================
// INTERFACE
// ============================================================================

function el(id) { return document.getElementById(id); }

function escapar(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Markdown mínimo: **negrito**, listas com "• " e quebras de linha. */
function formatar(texto) {
  return escapar(texto)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function bolha(de, texto, extra) {
  const div = document.createElement('div');
  div.className = `bolha bolha-${de}`;
  div.innerHTML = de === 'usuario' ? escapar(texto) : formatar(texto);
  if (extra) div.appendChild(extra);
  el('conversa').appendChild(div);
  el('conversa').scrollTop = el('conversa').scrollHeight;
  return div;
}

function passo(texto) {
  const d = el('passos');
  d.style.display = 'block';
  d.textContent = texto;
}

function limparPassos() { el('passos').style.display = 'none'; }

function botoesExport(tabela) {
  const box = document.createElement('div');
  box.className = 'export-box';
  const info = document.createElement('span');
  info.className = 'export-info';
  info.textContent = `${tabela.linhas.length} linha(s) · ${tabela.titulo}`;
  box.appendChild(info);
  for (const [rot, fn, ext] of [
    ['⤓ Planilha (.xlsx)', () => exportarPlanilha(tabela), 'xlsx'],
    ['⤓ Documento (.docx)', () => exportarDocumento(tabela), 'docx'],
  ]) {
    const b = document.createElement('button');
    b.className = 'btn-export';
    b.textContent = rot;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); }
      catch (e) { bolha('bot', `ERRO ao gerar o ${ext}: ${e.message}`); }
      finally { b.disabled = false; }
    });
    box.appendChild(b);
  }
  return box;
}

async function enviar() {
  if (app.pensando) return;
  const campo = el('entrada');
  const texto = campo.value.trim();
  if (!texto) return;
  if (!app.config.apiKey) {
    bolha('bot', 'ERRO: nenhuma chave de IA configurada. Clique em "⚙ Chave" aqui em cima para cadastrar a sua.');
    abrirConfig();
    return;
  }
  campo.value = '';
  campo.style.height = 'auto';
  bolha('usuario', texto);
  app.pensando = true;
  el('btn-enviar').disabled = true;
  passo('pensando…');

  try {
    const r = await conversar(texto, (ferr, args) => {
      const arg = Object.entries(args).filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${v}`).join(' ');
      passo(`consultando ${ferr}${arg ? ` (${arg})` : ''}…`);
    });
    limparPassos();
    if (r.exportar) {
      const t = r.tabela;
      const b = bolha('bot', `Pronto — ${t.linhas.length} linha(s) de "${t.titulo}".\nFonte: ${t.fonte}`);
      b.appendChild(botoesExport(t));
      try {
        if (r.exportar === 'exportar_planilha') exportarPlanilha(t); else await exportarDocumento(t);
      } catch (e) { bolha('bot', `ERRO ao gerar o arquivo: ${e.message}`); }
      lembrar('usuario', texto);
      lembrar('bot', `[exportei ${t.titulo}]`);
    } else {
      const b = bolha('bot', r.texto);
      if (app.ultimaTabela && app.ultimaTabela.linhas.length) b.appendChild(botoesExport(app.ultimaTabela));
      lembrar('usuario', texto);
      lembrar('bot', r.texto);
    }
  } catch (e) {
    limparPassos();
    bolha('bot', `ERRO na chamada de IA: ${e.message}`);
  } finally {
    app.pensando = false;
    el('btn-enviar').disabled = false;
    campo.focus();
  }
}

/**
 * Lê o perfil de IA compartilhado com os demais módulos.
 * NUNCA rejeita: se o storage falhar, a interface tem de continuar de pé
 * mostrando o problema — antes isso do que a página inteira morrer muda
 * porque os listeners nunca chegaram a ser ligados.
 */
function pintarEstado(aviso) {
  const alvo = el('estado-ia');
  if (aviso) {
    alvo.textContent = aviso;
    alvo.className = 'estado alerta';
    return;
  }
  const p = PROVEDORES[app.config.provedor];
  alvo.textContent = app.config.apiKey
    ? `${p?.label || app.config.provedor} · ${app.config.modelo || p?.modeloPadrao || 'modelo padrão'}`
    : 'sem chave — clique para configurar';
  alvo.className = app.config.apiKey ? 'estado ok' : 'estado alerta';
}

function carregarConfig() {
  return new Promise(resolve => {
    const pronto = aviso => { pintarEstado(aviso); resolve(); };
    try {
      chrome.storage.local.get('config', d => {
        if (chrome.runtime?.lastError) return pronto('falha ao ler a configuração');
        if (d && d.config) app.config = { ...app.config, ...d.config };
        pronto(null);
      });
    } catch (e) {
      pronto(`configuração indisponível: ${e.message}`);
    }
  });
}

// ---------------------------------------------------- modal de configuração

function msgConfig(texto, tipo = 'neutro') {
  const m = el('cfg-msg');
  m.textContent = texto;
  m.className = `msg ${tipo}`;
}

function abrirConfig() {
  el('cfg-provedor').value = app.config.provedor || 'gemini';
  el('cfg-chave').value    = app.config.apiKey || '';
  el('cfg-modelo').value   = app.config.modelo || '';
  atualizarDicaConfig();
  msgConfig('');
  el('modal-config').classList.add('aberto');
  el('cfg-chave').focus();
}

function fecharConfig() { el('modal-config').classList.remove('aberto'); }

function atualizarDicaConfig() {
  const p = PROVEDORES[el('cfg-provedor').value];
  el('cfg-dica').textContent = p?.hint || '';
  el('cfg-modelo').placeholder = p?.modeloPadrao || '';
}

function registrarConfig() {
  el('btn-config').addEventListener('click', abrirConfig);
  el('estado-ia').addEventListener('click', abrirConfig);
  el('cfg-fechar').addEventListener('click', fecharConfig);
  el('modal-config').addEventListener('click', e => {
    if (e.target === el('modal-config')) fecharConfig();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el('modal-config').classList.contains('aberto')) fecharConfig();
  });

  // Trocar de provedor limpa chave e modelo: chave de um não serve no outro,
  // e modelo herdado do provedor anterior quebra a primeira chamada.
  el('cfg-provedor').addEventListener('change', () => {
    el('cfg-chave').value = '';
    el('cfg-modelo').value = '';
    atualizarDicaConfig();
    msgConfig('');
  });

  el('cfg-ver').addEventListener('click', () => {
    const i = el('cfg-chave');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  el('cfg-testar').addEventListener('click', async () => {
    const provedor = el('cfg-provedor').value;
    const apiKey = el('cfg-chave').value.trim();
    const b = el('cfg-testar');
    b.disabled = true;
    msgConfig('testando…');
    try {
      await testarChave({ provedor, apiKey });
      msgConfig('chave aceita pelo provedor', 'ok');
    } catch (e) {
      msgConfig(e.message, 'erro');
    } finally { b.disabled = false; }
  });

  el('cfg-salvar').addEventListener('click', () => {
    const provedor = el('cfg-provedor').value;
    const apiKey = el('cfg-chave').value.trim();
    const modelo = el('cfg-modelo').value.trim();
    const p = PROVEDORES[provedor];
    // Formato errado é o erro mais comum (chave de outro provedor colada aqui);
    // avisa, mas não impede — o provedor é a autoridade final, não este regex.
    if (apiKey && p?.regex && !p.regex.test(apiKey)) {
      msgConfig(`atenção: não parece uma chave do ${p.label} — salvo assim mesmo`, 'erro');
    }
    app.config = { ...app.config, provedor, apiKey, modelo };
    try {
      chrome.storage.local.get('config', d => {
        const cfg = { ...(d?.config || {}), provedor, apiKey, modelo };
        chrome.storage.local.set({ config: cfg }, () => {
          if (chrome.runtime?.lastError) {
            msgConfig(`falha ao gravar: ${chrome.runtime.lastError.message}`, 'erro');
            return;
          }
          pintarEstado();
          if (!el('cfg-msg').classList.contains('erro')) msgConfig('salvo', 'ok');
          setTimeout(fecharConfig, 700);
        });
      });
    } catch (e) {
      msgConfig(`falha ao gravar: ${e.message}`, 'erro');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await carregarConfig();
  registrarConfig();

  const campo = el('entrada');
  campo.addEventListener('input', () => {
    campo.style.height = 'auto';
    campo.style.height = Math.min(160, campo.scrollHeight) + 'px';
  });
  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
  });
  el('btn-enviar').addEventListener('click', enviar);
  el('btn-limpar').addEventListener('click', () => {
    app.trocas = [];
    app.ultimaTabela = null;
    el('conversa').innerHTML = '';
    bolha('bot', 'Conversa limpa. Pergunte de novo.');
  });
  document.querySelectorAll('.sugestao').forEach(b => {
    b.addEventListener('click', () => { campo.value = b.textContent; enviar(); });
  });
  campo.focus();
});

// Exportado para os testes em Node (o arquivo é carregado como <script> na extensão).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chaveNome, hostPermitido, htmlParaTexto, extrairJson, brl, hojeISO,
    montarObservacao, classeDe, FERRAMENTAS, DOMINIOS_OFICIAIS,
    // A tabela exportável guarda TODOS os itens, mesmo quando a observação
    // corta — os testes conferem essa diferença.
    ultimaTabela: () => app.ultimaTabela,
  };
}
