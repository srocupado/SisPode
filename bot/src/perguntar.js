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
const { pautaAtualImportada } = require('./pauta');
const { chamarIAtexto } = require('./ia');

const CHAT_CTX_MAX  = 60000;        // teto de caracteres do contexto (igual ao painel)
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

async function acharItemNaPauta(ref) {
  const pauta = await pautaAtualImportada();
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

/** Contexto da PAUTA inteira (leve — sem baixar PDF): itens + análises existentes. */
async function montarContextoPauta() {
  const pauta = await pautaAtualImportada();
  if (!pauta) return null;
  const linhas = [];
  for (const it of (pauta.itens || [])) {
    const chave = it.chave || `${it.sigla}-${it.numero}-${it.ano}`;
    let resumoNota = '';
    try {
      const a = await carregarAnaliseMaisRecente(chave);
      if (a) resumoNota = notaTextoPlano(a).slice(0, 400);
    } catch (_) {}
    linhas.push(
      `— Item ${it.ordem}: ${it.sigla} ${it.numero}/${it.ano}` +
      `${it.temUrgencia ? ' (urgência)' : ''}\n` +
      `  Ementa: ${(it.ementa || '(sem ementa)').replace(/\s+/g, ' ').slice(0, 300)}\n` +
      `${it.autorTexto ? `  Autor: ${it.autorTexto}\n` : ''}` +
      `${resumoNota ? `  Início da nota técnica: ${resumoNota.replace(/\s+/g, ' ')}…\n` : '  (nota técnica ainda não gerada)\n'}`);
  }
  const ctx =
    `PAUTA DA SEMANA IMPORTADA NO SISPODE — ${pauta.titulo || ''} (${pauta.periodo || 'período n/d'})\n` +
    `${(pauta.itens || []).length} itens:\n\n${linhas.join('\n')}`;
  const truncado = ctx.length > CHAT_CTX_MAX;
  return { pauta, contexto: truncado ? ctx.slice(0, CHAT_CTX_MAX) : ctx, truncado };
}

// ---------- Prompt (adaptado de montarPromptChat, analise.js) ----------

function montarPromptChat({ rotuloMateria, contexto, truncado, historico, pergunta }) {
  const hist = (historico || [])
    .map(m => `${m.role === 'user' ? 'PERGUNTA' : 'RESPOSTA'}: ${m.content}`).join('\n\n');
  return `Você é assessor(a) técnico(a) legislativo(a) da Liderança do Podemos na Câmara dos Deputados. Responda à NOVA PERGUNTA do(a) assessor(a) sobre ${rotuloMateria}, baseando-se PRIORITARIAMENTE no material fornecido abaixo.

REGRAS:
- Cite o dispositivo, artigo ou trecho do documento quando possível.
- Se a resposta NÃO constar no material, diga "não consta nos documentos" e, se útil, ofereça uma ponderação deixando claro que é inferência, não fato do documento.
- Não invente números de lei, dispositivos, datas, valores ou nomes.
- Responda em Português do Brasil, de forma direta e objetiva. A resposta será lida no Telegram: use texto corrido e travessões, sem cabeçalhos Markdown.${truncado ? '\n- Observação: os documentos foram truncados por tamanho; se algo não aparecer, registre que pode estar fora do trecho disponível.' : ''}

=== MATERIAL ===
${contexto}
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
    const { pauta, item } = await acharItemNaPauta(ref);
    if (!pauta) return { erro: 'Nenhuma pauta importada no SisPode ainda. Use /importar primeiro.' };
    if (!item) {
      return { erro: `${ref.sigla} ${ref.numero}/${ref.ano} não está na pauta atual (${pauta.periodo || pauta.titulo}).` };
    }
    const chave = item.chave || `${item.sigla}-${item.numero}-${item.ano}`;
    const analise = await carregarAnaliseMaisRecente(chave);
    if (!analise) {
      return { erro: `${item.sigla} ${item.numero}/${item.ano} ainda não tem análise gerada. Gere no painel "Análise de Pauta" do SisPode e pergunte de novo.` };
    }
    const { contexto, truncado } = await montarContextoItem(analise);
    conversa = {
      chave, itemLabel: `a proposição ${item.sigla} ${item.numero}/${item.ano}`,
      contexto, truncado, mensagens: [], ts: Date.now(),
    };
    conversas.set(String(userId), conversa);
  }

  // Sem item ativo → contexto da pauta inteira
  if (!conversa) {
    const geral = await montarContextoPauta();
    if (!geral) return { erro: 'Nenhuma pauta importada no SisPode ainda. Use /importar primeiro.' };
    conversa = {
      chave: null, itemLabel: 'a Pauta da Semana',
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
    pergunta,
  });

  const resposta = await chamarIAtexto({
    provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo, prompt,
  });
  if (!resposta) return { erro: 'A IA não retornou resposta. Tente reformular a pergunta.' };

  conversa.mensagens.push({ role: 'user', content: pergunta }, { role: 'assistant', content: resposta });
  conversa.mensagens = conversa.mensagens.slice(-10);  // mantém as 5 últimas trocas
  conversa.ts = Date.now();

  return { resposta, itemLabel: conversa.itemLabel };
}

module.exports = { perguntar, limparConversa, conversaDe, extrairRefProposicao };
