'use strict';
// FASE 4 — roteador de linguagem natural (modo híbrido).
//
// Texto livre de um analista com chave configurada passa por UMA chamada de
// IA (na chave dele) que escolhe a ferramenta e devolve JSON. Estratégia de
// "JSON tool choice" via prompt — um único código para os 3 provedores, em
// vez de três integrações nativas de function calling.
//
// Ações que GRAVAM (importar_pauta) nunca executam direto: o roteador só
// devolve a intenção e o index.js manda botão de confirmação.

const { chamarIAtexto, extrairJson } = require('./ia');

const FERRAMENTAS = `
- "verificar_pauta": checar se há Pauta da Semana nova no site da Câmara. Use para "tem pauta nova?", "saiu a pauta?", "como está a pauta da Câmara?".
- "importar_pauta": importar a pauta atual para o SisPode (AÇÃO QUE GRAVA — o sistema pedirá confirmação). Use para "importa a pauta", "põe a pauta no sispode".
- "listar_itens": listar os itens da pauta importada no SisPode. Use para "o que tem na pauta?", "lista os itens", "quais projetos vão ser votados?".
- "perguntar": responder pergunta de conteúdo sobre uma proposição da pauta ou sobre a pauta em geral (usa a nota técnica e os documentos da matéria). Use para "o que o PL 1234/2026 muda?", "qual o impacto disso no SUS?", "algum item é de autoria do Podemos?".
- "listar_documentos": listar os documentos da tramitação de uma proposição que NÃO foram considerados na nota técnica (pareceres, emendas, textos). Use para "quais documentos não entraram na análise do PL 1234/2026?", "que documentos da tramitação faltam?", "lista os documentos do PL X".
- "ajuda": explicar o que o bot faz.
- "responder": nenhuma das anteriores — responda você mesmo, brevemente (saudação, agradecimento, conversa social).`;

function montarPromptRoteador(mensagem) {
  return `Você é o roteador do bot de Telegram da Liderança do Podemos na Câmara dos Deputados (sistema SisPode). Dada a MENSAGEM do analista, escolha UMA ferramenta.

FERRAMENTAS:
${FERRAMENTAS}

Responda APENAS com um objeto JSON, sem cercas de código, no formato:
{"ferramenta": "<nome>", "argumentos": {"pergunta": "<p/ perguntar ou listar_documentos: o pedido, preservando qualquer sigla tipo PL 1234/2026>", "texto": "<apenas p/ responder: sua resposta curta em pt-BR>"}}

MENSAGEM: ${mensagem}`;
}

/**
 * Decide a ferramenta para uma mensagem em linguagem natural.
 * Retorna { ferramenta, argumentos } — 'perguntar' como padrão de segurança
 * se a IA devolver algo não reconhecido (é a ferramenta inofensiva mais útil).
 */
async function rotear(perfil, mensagem) {
  const bruto = await chamarIAtexto({
    provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
    prompt: montarPromptRoteador(mensagem), maxTokens: 400,
  });
  const j = extrairJson(bruto);
  const validas = ['verificar_pauta', 'importar_pauta', 'listar_itens', 'perguntar', 'listar_documentos', 'ajuda', 'responder'];
  if (!validas.includes(j.ferramenta)) {
    return { ferramenta: 'perguntar', argumentos: { pergunta: mensagem } };
  }
  if (j.ferramenta === 'perguntar' && !j.argumentos?.pergunta) {
    j.argumentos = { ...(j.argumentos || {}), pergunta: mensagem };
  }
  return { ferramenta: j.ferramenta, argumentos: j.argumentos || {} };
}

module.exports = { rotear };
