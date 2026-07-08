'use strict';
// "Pergunte ao revisor" fora do painel — porte de analise.js
// (montarContextoChat / montarPromptChat / enviarPerguntaIA).
//
// Ponto-chave que barateia o porte: as URLs dos documentos da matéria ficam
// SALVAS dentro da análise no Firebase (analise.documentos[{tipo,rotulo,url}]),
// então não é preciso refazer a detecção de cenário/scraping — basta ler a
// análise pronta, baixar os PDFs e montar o contexto.

const { fbGet } = require('./firebase');
const { extrairTextoPdf } = require('./parser');
const { rotuloPauta } = require('./pauta');
const { pautaDoUsuario } = require('./sessao');
const { chamarIAtexto } = require('./ia');
const { resolveProposicao, listarDocumentosDisponiveis } = require('./documentos');

const API_CAMARA = 'https://dadosabertos.camara.leg.br/api/v2';

const CHAT_CTX_MAX  = 60000;        // teto de caracteres do contexto (igual ao painel)
const EXTRA_DOC_MAX = 50000;        // teto por documento extra agregado (igual ao painel)
const CONVERSA_TTL  = 60 * 60e3;    // 1 h — chat é efêmero, como no painel

// ---------- Estado de conversa por usuário (em memória) ----------
// { userId: { chave, itemLabel, contexto, truncado, mensagens[], ts } }
const conversas = new Map();

function conversaDe(userId) {
  const c = conversas.get(String(userId));
  if (c && Date.now() - c.ts < CONVERSA_TTL) return c;
  conversas.delete(String(userId));
  return null;
}

function limparConversa(userId) { conversas.delete(String(userId)); }

// ---------- Localização de item e análise ----------

// "PL 1234/2026", "pl 1234 2026", "PLP 12/25" → { sigla, numero, ano } ou null
function extrairRefProposicao(texto) {
  const m = String(texto || '').toUpperCase()
    .match(/\b(PL|PLP|PEC|PDL|PDC|MPV|PRC|REQ)\s*\.?\s*(\d{1,6})\s*[\/\s]\s*(\d{2,4})\b/);
  if (!m) return null;
  let ano = m[3];
  if (ano.length === 2) ano = (parseInt(ano, 10) > 50 ? '19' : '20') + ano;
  return { sigla: m[1], numero: parseInt(m[2], 10), ano };
}

// Localiza o item numa pauta já resolvida (a ativa do usuário).
function acharItemNaPauta(ref, pauta) {
  if (!pauta) return { pauta: null, item: null };
  const item = (pauta.itens || []).find(it =>
    it.sigla === ref.sigla && String(it.numero) === String(ref.numero) && String(it.ano) === String(ref.ano));
  return { pauta, item: item || null };
}

/** Análise mais recente do item em /analises_pauta/{chave} (indexada por parecerKey). */
async function carregarAnaliseMaisRecente(chave) {
  let porParecer = null;
  try { porParecer = await fbGet(`/analises_pauta/${encodeURIComponent(chave)}`); } catch (_) {}
  if (!porParecer) return null;
  const entradas = Object.values(porParecer).filter(a => a && (a.markdown || a.html));
  if (!entradas.length) return null;
  entradas.sort((a, b) =>
    new Date(b.editadoEm || b.geradoEm || 0) - new Date(a.editadoEm || a.geradoEm || 0));
  return entradas[0];
}

// ---------- Montagem de contexto ----------

// Markdown da nota sem os marcadores internos do editor ([[12]], [[justify]]…)
function notaTextoPlano(analise) {
  const md = analise?.markdown || '';
  return md.replace(/\[\[[^\]]{0,12}\]\]/g, '').trim();
}

async function baixarPdf(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Contexto de UM item: nota técnica + texto dos documentos salvos na análise. */
async function montarContextoItem(analise) {
  let ctx = `NOTA TÉCNICA JÁ PRODUZIDA:\n${notaTextoPlano(analise) || '(sem nota)'}\n`;
  const docs = (analise?.documentos || []).filter(d => d && d.url);
  if (docs.length) {
    ctx += `\n=== DOCUMENTOS DA MATÉRIA ===\n`;
    for (const d of docs) {
      if (ctx.length > CHAT_CTX_MAX) break;
      try {
        const buf = await baixarPdf(d.url);
        const txt = await extrairTextoPdf(buf);
        ctx += `\n## ${d.rotulo}\n${txt}\n`;
      } catch (_) {
        ctx += `\n## ${d.rotulo}\n(não foi possível ler este documento)\n`;
      }
    }
  }
  const truncado = ctx.length > CHAT_CTX_MAX;
  return { contexto: truncado ? ctx.slice(0, CHAT_CTX_MAX) : ctx, truncado };
}

// ---------- Autoria Podemos por item (via API da Câmara — MESMA lógica do painel) ----------
// A pauta salva só tem o nome do autor (autorTexto), não o partido. Aqui
// reproduzimos exatamente o enriquecerItem/resolverApensados da extensão
// (analise.js) para que bot e painel NUNCA divirjam:
//   - autoria por deputado: /deputados/{id}.ultimoStatus.siglaPartido === PODE
//   - autor principal (1º signatário, ordemAssinatura=1) vs coautor
//   - apensados pela cadeia real da API (/relacionadas + raiz uriPropPrincipal),
//     não pelo texto do PDF — pega apensadas que o PDF não lista, e só as que
//     pertencem à mesma cadeia de apensamento.
const SIGLA_PODE = 'PODE';
const _autoriaCache = new Map();   // pautaId → Map(chave → entrada)
const _depCache = new Map();       // idDep → siglaPartido | null
const _detCache = new Map();       // idProp → detalhe.dados | null

async function fetchJsonCamara(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Partido atual de um deputado (ultimoStatus), como fetchInfoDeputado do painel. */
async function siglaPartidoDep(idDep) {
  if (_depCache.has(idDep)) return _depCache.get(idDep);
  let sig = null;
  try {
    const j = await fetchJsonCamara(`${API_CAMARA}/deputados/${idDep}`);
    sig = j.dados?.ultimoStatus?.siglaPartido || null;
  } catch (_) { sig = null; }
  _depCache.set(idDep, sig);
  return sig;
}

/** Autores de uma proposição marcando quais são do Podemos + ordem de assinatura. */
async function autoresProp(idProp) {
  const j = await fetchJsonCamara(`${API_CAMARA}/proposicoes/${idProp}/autores`);
  const autores = j.dados || [];
  const out = [];
  for (const a of autores) {
    const idDep = Number((a.uri || '').match(/\/deputados\/(\d+)/)?.[1]) || null;
    const isPode = idDep ? (await siglaPartidoDep(idDep)) === SIGLA_PODE : false;
    out.push({ nome: a.nome, ordem: a.ordemAssinatura, idDep, isPode });
  }
  return out;
}

/**
 * Resumo de autoria Podemos de UMA proposição: { ehPode, principal, autores[] }.
 * principal = há autor(a) Podemos como 1º signatário (ordemAssinatura=1); sem
 * info de ordem (dados antigos), assume principal — igual ao painel.
 */
async function autoriaPodeDe(idProp) {
  const autores = await autoresProp(idProp);
  const pode = autores.filter(a => a.isPode);
  if (!pode.length) return { ehPode: false, principal: false, autores: [] };
  const temOrdem = autores.some(a => Number.isFinite(Number(a.ordem)));
  const principal = temOrdem ? pode.some(a => Number(a.ordem) === 1) : true;
  return { ehPode: true, principal, autores: pode.map(a => a.nome) };
}

// ----- Apensados pela cadeia real da API (porte de fetchApensados do painel) -----
async function detalheProp(id) {
  if (_detCache.has(id)) return _detCache.get(id);
  let d = null;
  try { d = (await fetchJsonCamara(`${API_CAMARA}/proposicoes/${id}`)).dados || null; }
  catch (_) { d = null; }
  _detCache.set(id, d);
  return d;
}
const _idDaUri = uri => uri ? Number(String(uri).split('/').pop()) : null;
async function raizApensamento(id, depth = 0) {
  if (depth > 6) return id;
  const pai = _idDaUri((await detalheProp(id))?.uriPropPrincipal);
  return pai ? raizApensamento(pai, depth + 1) : id;
}
/** Apensadas que compartilham a raiz de apensamento da proposição-alvo. */
async function apensadosDe(idProp) {
  let rel = [];
  try { rel = (await fetchJsonCamara(`${API_CAMARA}/proposicoes/${idProp}/relacionadas`)).dados || []; }
  catch (_) { return []; }
  if (!rel.length) return [];
  const raizAlvo = await raizApensamento(Number(idProp));
  const out = [];
  for (const r of rel) {
    const d = await detalheProp(r.id);
    if (!d) continue;
    const sit = ((d.statusProposicao || {}).descricaoSituacao || '').toLowerCase();
    if (!d.uriPropPrincipal && !sit.includes('conjunto') && !sit.includes('apens')) continue;
    if (await raizApensamento(r.id) !== raizAlvo) continue;
    out.push({ id: r.id, sigla: r.siglaTipo, numero: r.numero, ano: r.ano });
  }
  return out;
}

async function mapLimit(itens, limite, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const idx = i++; out[idx] = await fn(itens[idx], idx); }
  }));
  return out;
}

// Alvo da autoria: para requerimento de urgência, o projeto urgenciado; senão o próprio item.
function alvoAutoria(it) {
  if (it.tipoCategoria === 'requerimento' && it.projetoUrgenciado?.sigla) return it.projetoUrgenciado;
  return { sigla: it.sigla, numero: it.numero, ano: it.ano };
}

/**
 * Autoria/coautoria Podemos de cada item da pauta, resolvida como o painel.
 * entrada = { ehPode, principal, autores[], apensadosPode:[{rotulo,autores,principal}] }
 *   ehPode: true/false, ou null quando não foi possível verificar (não afirma).
 * Cache por pauta.id.
 */
async function resolverAutoriaPauta(pauta) {
  if (_autoriaCache.has(pauta.id)) return _autoriaCache.get(pauta.id);
  const mapa = new Map();
  await mapLimit(pauta.itens || [], 4, async (it) => {
    const chave = it.chave || `${it.sigla}-${it.numero}-${it.ano}`;
    const entrada = { ehPode: null, principal: false, autores: [], apensadosPode: [] };
    try {
      const alvo = alvoAutoria(it);
      if (String(alvo.sigla).toUpperCase() === 'REQ') {
        entrada.ehPode = false;               // requerimento sem projeto-alvo
      } else {
        const prop = await resolveProposicao(alvo.sigla, alvo.numero, alvo.ano);
        if (prop) {
          const a = await autoriaPodeDe(prop.id);
          entrada.ehPode = a.ehPode; entrada.principal = a.principal; entrada.autores = a.autores;
          // Apensadas pela cadeia real da API (mesma da extensão), com autoria/coautoria
          for (const ap of await apensadosDe(prop.id)) {
            const ra = await autoriaPodeDe(ap.id).catch(() => ({ ehPode: false }));
            if (ra.ehPode) entrada.apensadosPode.push({
              rotulo: `${ap.sigla} ${ap.numero}/${ap.ano}`, autores: ra.autores, principal: ra.principal,
            });
          }
        }
        // prop nulo → ehPode fica null (não verificado)
      }
    } catch (_) { /* falha → mantém o que já preencheu; ehPode null se nem a principal saiu */ }
    mapa.set(chave, entrada);
  });
  _autoriaCache.set(pauta.id, mapa);
  return mapa;
}

/** Contexto da PAUTA inteira (leve — sem baixar PDF): itens + autoria Podemos + análises. */
async function montarContextoPauta(pauta) {
  if (!pauta) return null;
  const autoria = await resolverAutoriaPauta(pauta).catch(() => new Map());

  const podemosItens = [];
  const linhas = [];
  for (const it of (pauta.itens || [])) {
    const chave = it.chave || `${it.sigla}-${it.numero}-${it.ano}`;
    const aut = autoria.get(chave);
    let resumoNota = '';
    try {
      const a = await carregarAnaliseMaisRecente(chave);
      if (a) resumoNota = notaTextoPlano(a).slice(0, 400);
    } catch (_) {}
    let linhaAutoria = '';
    if (aut?.ehPode === true) {
      const tipo = aut.principal ? 'AUTORIA' : 'COAUTORIA';
      linhaAutoria = `  ✔ ${tipo} PODEMOS${aut.autores.length ? ` (${aut.autores.join(', ')})` : ''}\n`;
      podemosItens.push(`${it.sigla} ${it.numero}/${it.ano} [${aut.principal ? 'autoria' : 'coautoria'}]${aut.autores.length ? ` — ${aut.autores.join(', ')}` : ''}`);
    } else if (aut?.ehPode === null) {
      linhaAutoria = '  (autoria Podemos não verificada)\n';
    }
    for (const ap of (aut?.apensadosPode || [])) {
      const tipo = ap.principal ? 'AUTORIA' : 'COAUTORIA';
      linhaAutoria += `  ✔ APENSADA — ${tipo} PODEMOS: ${ap.rotulo}${ap.autores.length ? ` (${ap.autores.join(', ')})` : ''}\n`;
      podemosItens.push(`${ap.rotulo} (apensada ao item ${it.sigla} ${it.numero}/${it.ano}) [${ap.principal ? 'autoria' : 'coautoria'}]${ap.autores.length ? ` — ${ap.autores.join(', ')}` : ''}`);
    }
    linhas.push(
      `— Item ${it.ordem}: ${it.sigla} ${it.numero}/${it.ano}` +
      `${it.temUrgencia ? ' (urgência)' : ''}\n` +
      `  Ementa: ${(it.ementa || '(sem ementa)').replace(/\s+/g, ' ').slice(0, 300)}\n` +
      `${it.autorTexto ? `  Autor: ${it.autorTexto}\n` : ''}` +
      linhaAutoria +
      `${resumoNota ? `  Início da nota técnica: ${resumoNota.replace(/\s+/g, ' ')}…\n` : '  (nota técnica ainda não gerada)\n'}`);
  }
  const resumoAutoria = podemosItens.length
    ? `ITENS DE AUTORIA/COAUTORIA DO PODEMOS (inclui proposições apensadas; autor(a) filiado(a) ao Podemos hoje, verificado na API da Câmara): ${podemosItens.join('; ')}.`
    : 'ITENS DE AUTORIA/COAUTORIA DO PODEMOS: nenhum item (nem apensada) cujo autor esteja filiado ao Podemos hoje foi identificado nesta pauta.';
  const ctx =
    `PAUTA DA SEMANA IMPORTADA NO SISPODE — ${pauta.titulo || ''} (${pauta.periodo || 'período n/d'})\n` +
    `${(pauta.itens || []).length} itens.\n\n${resumoAutoria}\n\n${linhas.join('\n')}`;
  const truncado = ctx.length > CHAT_CTX_MAX;
  return { pauta, contexto: truncado ? ctx.slice(0, CHAT_CTX_MAX) : ctx, truncado };
}

// ---------- Prompt (adaptado de montarPromptChat, analise.js) ----------

function montarPromptChat({ rotuloMateria, contexto, truncado, historico, pergunta, extras }) {
  const hist = (historico || [])
    .map(m => `${m.role === 'user' ? 'PERGUNTA' : 'RESPOSTA'}: ${m.content}`).join('\n\n');
  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos na Câmara dos Deputados. Responda à NOVA PERGUNTA do(a) assessor(a) sobre ${rotuloMateria}, baseando-se PRIORITARIAMENTE no material fornecido abaixo.

REGRAS:
- Cite o dispositivo, artigo ou trecho do documento quando possível.
- Se a resposta NÃO constar no material, diga "não consta nos documentos" e, se útil, ofereça uma ponderação deixando claro que é inferência, não fato do documento.
- Não invente números de lei, dispositivos, datas, valores ou nomes.
- NÃO afirme situação de tramitação, parecer ou voto do relator, acolhimento/rejeição em comissão (CCJC, CFT etc.), existência de substitutivo/emenda, apensamento nem resultado de votação, A MENOS que isso apareça LITERALMENTE no material. Trechos rotulados "Início da nota técnica" são apenas o começo do texto — não deduza a conclusão, o parecer nem o encaminhamento a partir deles.
- Sobre autoria/coautoria do Podemos, use SOMENTE o que estiver marcado com "✔" (linhas "✔ AUTORIA PODEMOS", "✔ COAUTORIA PODEMOS", "✔ APENSADA — AUTORIA/COAUTORIA PODEMOS") ou o resumo de autoria no topo. Respeite a distinção: "autoria" = 1º signatário; "coautoria" = assinou depois. Não chame coautoria de autoria, nem infira filiação por conta própria.
- Quando a pergunta for sobre QUAIS itens/projetos são do Podemos (ou qualquer enumeração sobre a pauta), liste TODOS os itens correspondentes que constam no material — completo, não apenas um exemplo. Inclua as proposições principais E as apensadas marcadas como do Podemos, indicando se é autoria ou coautoria.
- Responda em Português do Brasil, de forma direta e objetiva. A resposta será lida no Telegram: use texto corrido e travessões, sem cabeçalhos Markdown. EXCEÇÃO: quando a resposta for uma enumeração (ex.: a lista dos itens do Podemos), apresente um item por linha com travessão, cada um com sigla/número/ano e autor(a).${truncado ? '\n- Observação: os documentos foram truncados por tamanho; se algo não aparecer, registre que pode estar fora do trecho disponível.' : ''}

=== MATERIAL ===
${contexto}
${(extras || []).length ? `\n=== DOCUMENTOS ADICIONAIS (incluídos a pedido — também são da matéria) ===\n${extras.map(e => `\n## ${e.rotulo}${e.trunc ? ' (truncado)' : ''}\n${e.texto}`).join('\n')}\n` : ''}
${hist ? `\n=== CONVERSA ATÉ AQUI ===\n${hist}\n` : ''}
=== NOVA PERGUNTA ===
${pergunta}`;
}

// ---------- Fluxo principal ----------

/**
 * Responde uma pergunta. Se `texto` citar uma proposição (ou já houver item
 * ativo na conversa), usa o contexto do item; senão, o da pauta inteira.
 * Retorna { resposta } ou { erro } com mensagem amigável.
 */
async function perguntar({ userId, perfil, texto }) {
  const ref = extrairRefProposicao(texto);
  let conversa = conversaDe(userId);

  // Nova referência de item na mensagem → (re)ancora a conversa nesse item
  if (ref) {
    const pauta = await pautaDoUsuario(userId);
    if (!pauta) return { erro: 'Nenhuma pauta importada no SisPode ainda. Use /importar primeiro.' };
    const { item } = acharItemNaPauta(ref, pauta);
    if (!item) {
      return { erro: `${ref.sigla} ${ref.numero}/${ref.ano} não está na pauta em uso (${pauta.periodo || pauta.titulo}). Troque de pauta com /sispode se precisar.` };
    }
    const chave = item.chave || `${item.sigla}-${item.numero}-${item.ano}`;
    // Já era o item ativo? Mantém a conversa (histórico e documentos agregados).
    if (!conversa || conversa.chave !== chave) {
      const analise = await carregarAnaliseMaisRecente(chave);
      if (!analise) {
        return { erro: `${item.sigla} ${item.numero}/${item.ano} ainda não tem análise gerada. Gere no painel "Análise de Pauta" do SisPode e pergunte de novo.` };
      }
      const { contexto, truncado } = await montarContextoItem(analise);
      conversa = {
        chave, itemLabel: `a proposição ${item.sigla} ${item.numero}/${item.ano}`,
        pautaRef: rotuloPauta(pauta),
        contexto, truncado, mensagens: [], extras: [], ts: Date.now(),
      };
      conversas.set(String(userId), conversa);
    }
  }

  // Sem item ativo → contexto da pauta inteira
  if (!conversa) {
    const pauta = await pautaDoUsuario(userId);
    if (!pauta) return { erro: 'Nenhuma pauta importada no SisPode ainda. Use /importar primeiro.' };
    const geral = await montarContextoPauta(pauta);
    if (!geral) return { erro: 'Nenhuma pauta importada no SisPode ainda. Use /importar primeiro.' };
    conversa = {
      chave: null, itemLabel: 'a pauta em uso',
      pautaRef: rotuloPauta(pauta),
      contexto: geral.contexto, truncado: geral.truncado, mensagens: [], ts: Date.now(),
    };
    conversas.set(String(userId), conversa);
  }

  const pergunta = ref
    ? texto.replace(/\b(PL|PLP|PEC|PDL|PDC|MPV|PRC|REQ)\s*\.?\s*\d{1,6}\s*[\/\s]\s*\d{2,4}\b/i, '').trim() || texto
    : texto;

  const prompt = montarPromptChat({
    rotuloMateria: conversa.itemLabel,
    contexto:      conversa.contexto,
    truncado:      conversa.truncado,
    historico:     conversa.mensagens,
    extras:        conversa.extras,
    pergunta,
  });

  const resposta = await chamarIAtexto({
    provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo, prompt,
  });
  if (!resposta) return { erro: 'A IA não retornou resposta. Tente reformular a pergunta.' };

  conversa.mensagens.push({ role: 'user', content: pergunta }, { role: 'assistant', content: resposta });
  conversa.mensagens = conversa.mensagens.slice(-10);  // mantém as 5 últimas trocas
  conversa.ts = Date.now();

  return { resposta, itemLabel: conversa.itemLabel, pautaRef: conversa.pautaRef };
}

/**
 * Devolve a NOTA TÉCNICA como está SALVA no painel (texto integral, verbatim) —
 * SEM reprocessar pela IA. É a diferença entre "ver a nota" (mostrar o que a
 * equipe escreveu) e "perguntar sobre a nota" (a IA responde a partir dela).
 * `texto` pode citar a proposição; sem citação, usa o item ativo da conversa.
 * Retorna { itemLabel, apelido, nota } ou { erro }.
 */
async function mostrarNota({ userId, texto }) {
  const ref = extrairRefProposicao(texto || '');
  let chave = null, itemLabel = '';
  if (ref) {
    const pauta = await pautaDoUsuario(userId);
    if (!pauta) return { erro: 'Nenhuma pauta importada no SisPode ainda. Use /importar primeiro.' };
    const { item } = acharItemNaPauta(ref, pauta);
    if (!item) return { erro: `${ref.sigla} ${ref.numero}/${ref.ano} não está na pauta em uso.` };
    chave = item.chave || `${item.sigla}-${item.numero}-${item.ano}`;
    itemLabel = `${item.sigla} ${item.numero}/${item.ano}`;
  } else {
    const c = conversaDe(userId);
    if (!c?.chave) return { erro: 'Diga qual proposição: /nota PL 1234/2026.' };
    chave = c.chave;
    const [s, n, a] = String(chave).split('-');
    itemLabel = `${s} ${n}/${a}`;
  }

  const analise = await carregarAnaliseMaisRecente(chave);
  if (!analise) {
    return { erro: `${itemLabel} ainda não tem nota técnica gerada no SisPode. Gere no painel "Análise de Pauta" e tente de novo.` };
  }
  const nota = notaTextoPlano(analise);
  if (!nota) return { erro: `A nota de ${itemLabel} está vazia no SisPode.` };
  return { itemLabel, apelido: (analise.apelido || '').trim(), nota };
}

// ============================================================
//  Documentos extras — porte do seletor "documentos adicionais" do painel:
//  lista o que a tramitação tem e NÃO entrou na nota, e agrega à conversa.
// ============================================================

// Última listagem por usuário (o /agregar referencia os números dela)
const docsListados = new Map(); // userId → { chave, itemLabel, docs[], temAnalise, ts }

/**
 * Lista os documentos da tramitação que NÃO foram considerados na nota do
 * item. `texto` pode citar a proposição; sem citação, usa o item ativo.
 * Retorna { itemLabel, docs[{rotulo,url,grupo}], usadosNaNota[], temAnalise } ou { erro }.
 */
async function listarDocumentos({ userId, texto }) {
  const ref = extrairRefProposicao(texto || '');
  const pauta = await pautaDoUsuario(userId);
  if (!pauta) return { erro: 'Nenhuma pauta importada no SisPode ainda. Use /importar primeiro.' };
  let item = null;

  if (ref) {
    const r = acharItemNaPauta(ref, pauta);
    if (!r.item)  return { erro: `${ref.sigla} ${ref.numero}/${ref.ano} não está na pauta em uso.` };
    item = r.item;
  } else {
    const c = conversaDe(userId);
    if (!c?.chave) return { erro: 'Diga qual proposição: /documentos PL 1234/2026.' };
    const [sigla, numero, ano] = String(c.chave).split('-');
    const r = acharItemNaPauta({ sigla, numero, ano }, pauta);
    if (!r.item) return { erro: 'Não localizei o item ativo na pauta em uso. Informe: /documentos PL 1234/2026.' };
    item = r.item;
  }

  const chave     = item.chave || `${item.sigla}-${item.numero}-${item.ano}`;
  const itemLabel = `${item.sigla} ${item.numero}/${item.ano}`;
  const analise   = await carregarAnaliseMaisRecente(chave);        // pode não existir
  const usados    = new Set((analise?.documentos || []).map(d => d.url));

  const prop = await resolveProposicao(item.sigla, item.numero, item.ano);
  if (!prop) return { erro: `Não encontrei ${itemLabel} na API da Câmara para listar a tramitação.` };

  const grupos = await listarDocumentosDisponiveis({
    idProp: prop.id,
    urlInteiroTeor: prop.urlInteiroTeor,
    usados,
    incluirRedacaoFinal: item.tipoCategoria === 'redacao_final',
  });

  const docs = [];
  for (const [grupo, lista] of Object.entries(grupos)) {
    for (const d of lista) docs.push({ ...d, grupo });
  }
  docsListados.set(String(userId), { chave, itemLabel, docs, temAnalise: !!analise, ts: Date.now() });

  return {
    itemLabel, docs, temAnalise: !!analise,
    usadosNaNota: (analise?.documentos || []).map(d => d.rotulo),
  };
}

/**
 * Agrega documentos (pelos números da última listagem) à conversa do item:
 * baixa cada PDF, extrai o texto (teto de EXTRA_DOC_MAX) e passa a incluí-lo
 * na seção "DOCUMENTOS ADICIONAIS" das próximas perguntas.
 * Retorna { ok[], falhas[], total, itemLabel } ou { erro }.
 */
async function agregarDocumentos({ userId, indices }) {
  const listagem = docsListados.get(String(userId));
  if (!listagem || Date.now() - listagem.ts > CONVERSA_TTL) {
    return { erro: 'Liste primeiro os documentos: /documentos PL 1234/2026 (a listagem vale 1 hora).' };
  }
  if (!listagem.temAnalise) {
    return { erro: `${listagem.itemLabel} ainda não tem análise no painel — os documentos extras complementam a conversa sobre a nota. Gere a análise primeiro.` };
  }
  const escolhidos = indices.map(i => listagem.docs[i - 1]).filter(Boolean);
  if (!escolhidos.length) return { erro: 'Números inválidos. Use os da listagem do /documentos, ex.: /agregar 1,3.' };

  // Garante a conversa ancorada no item (mesmo fluxo do perguntar)
  let conversa = conversaDe(userId);
  if (!conversa || conversa.chave !== listagem.chave) {
    const analise = await carregarAnaliseMaisRecente(listagem.chave);
    if (!analise) return { erro: 'A análise deste item não está mais disponível no Firebase.' };
    const { contexto, truncado } = await montarContextoItem(analise);
    conversa = {
      chave: listagem.chave, itemLabel: `a proposição ${listagem.itemLabel}`,
      contexto, truncado, mensagens: [], extras: [], ts: Date.now(),
    };
    conversas.set(String(userId), conversa);
  }
  conversa.extras = conversa.extras || [];

  const ok = [], falhas = [];
  for (const d of escolhidos) {
    if (conversa.extras.some(e => e.url === d.url)) continue; // já agregado
    try {
      const buf = await baixarPdf(d.url);
      const txt = await extrairTextoPdf(buf);
      const trunc = txt.length > EXTRA_DOC_MAX;
      conversa.extras.push({ rotulo: d.rotulo, url: d.url, texto: trunc ? txt.slice(0, EXTRA_DOC_MAX) : txt, trunc });
      ok.push(d.rotulo);
    } catch (_) {
      falhas.push(d.rotulo);
    }
  }
  conversa.ts = Date.now();
  return { ok, falhas, total: conversa.extras.length, itemLabel: listagem.itemLabel };
}

module.exports = {
  perguntar, limparConversa, conversaDe, extrairRefProposicao,
  listarDocumentos, agregarDocumentos, carregarAnaliseMaisRecente,
  mostrarNota,
};
