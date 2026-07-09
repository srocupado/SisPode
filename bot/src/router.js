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
- "verificar_pauta": buscar ON-LINE no site da Câmara se há Pauta da Semana nova ou Ordem do Dia de hoje. Use para "tem pauta nova?", "saiu a pauta?", "como está a pauta da Câmara?", "busca on-line".
- "escolher_pauta": listar as pautas guardadas no SisPode para o usuário ESCOLHER qual usar. Use para "quais pautas tem no sispode?", "trocar de pauta", "muda a pauta", "usar outra pauta".
- "importar_pauta": importar a pauta atual para o SisPode (AÇÃO QUE GRAVA — o sistema pedirá confirmação). Use para "importa a pauta", "põe a pauta no sispode".
- "ordem_do_dia": importar a Ordem do Dia (pauta DIÁRIA) da sessão de HOJE, direto da API da Câmara. Use para "importa a ordem do dia", "pega a pauta de hoje", "o que vai ser votado hoje?", "traz a ODD".
- "listar_itens": listar os itens da pauta importada no SisPode. Use para "o que tem na pauta?", "lista os itens", "quais projetos vão ser votados?".
- "ver_nota": MOSTRAR a nota técnica / análise pronta de uma proposição EXATAMENTE como foi salva no painel (texto integral, verbatim, SEM reprocessar pela IA). Use para "ver a nota técnica do PL 1234/2026", "me mostra a análise do PLP 41/2026", "traz a nota do PL X", "quero ler a nota do PL X".
- "perguntar": RESPONDER uma pergunta de conteúdo sobre uma proposição ou sobre a pauta, a partir da nota técnica e dos documentos (a IA elabora a resposta). Use para "o que o PL 1234/2026 muda?", "qual o impacto disso no SUS?", "a nota fala sobre financiamento?", "algum item é de autoria do Podemos?".
- "listar_documentos": listar os documentos da tramitação de uma proposição que NÃO foram considerados na nota técnica (pareceres, emendas, textos). Use para "quais documentos não entraram na análise do PL 1234/2026?", "que documentos da tramitação faltam?", "lista os documentos do PL X".
- "baixar_documentos": enviar/BAIXAR os arquivos (PDFs) dos documentos de uma proposição — os usados na nota E os adicionais da tramitação. Use para "baixa os documentos do PL 1234/2026", "me envia os PDFs usados na nota do PL X", "quero o inteiro teor do PL X".
- "pauta_comissao": pauta de uma ou mais COMISSÕES da Câmara numa DATA (dado oficial da API). GATE: use SEMPRE que o usuário NOMEAR a(s) comissão(ões) (CCJ, CCJC, Saúde, CMADS, Minas e Energia…) OU perguntar sobre projeto/partido/deputado numa comissão nomeada — mesmo que diga "em reuniões de hoje". Ex.: "o que a Comissão de Saúde vota dia 1º de julho?", "tem projeto do Podemos na pauta da CCJ amanhã?", "algo do deputado Fulano na CMADS hoje?". Preencha "comissoes" (TODAS as citadas, cada uma um item), "data", e "partido"/"deputado" se filtrar.
- "comissoes_reuniao": listar QUAIS comissões permanentes têm REUNIÃO DELIBERATIVA numa data (só nomes/horários, sem olhar projeto). GATE: só na pergunta ABERTA e SEM filtro ("quais comissões têm reunião hoje?", "que comissões se reúnem amanhã?"). Se citar comissão → pauta_comissao; se cruzar com partido/deputado sem nomear comissão → varrer_comissoes.
- "varrer_comissoes": VARRE todas as comissões com reunião deliberativa numa data e diz quais têm projeto de AUTORIA/RELATORIA de um partido/deputado. GATE: use quando a pergunta é ABERTA e cruza com partido/deputado SEM nomear comissão ("quais comissões com reunião hoje têm projeto do Podemos?", "nas reuniões de amanhã tem algo do PT?"). Varredura pesada. Preencha "data" e "partido" (padrão Podemos) ou "deputado".
- "votacao": listar as votações nominais do PLENÁRIO de um dia e gerar a IMAGEM do placar da bancada. Use para "como foi a votação de hoje?", "placar da votação", "gera a imagem da votação de 02/07/2026". (Plenário, não comissão.)
- "digest": radar do FANTÁSTICO — resume os temas do programa e avalia a relevância para ações legislativas (PL, requerimentos, CPI), com minuta em PDF sob demanda. Use para "o que deu no fantástico?", "radar do fantástico", "resumo do programa de domingo", "temas do fantástico para projetos".
- "analisar": gerar as notas técnicas dos itens da pauta importada (AÇÃO CARA — o sistema pedirá confirmação; roda na chave do analista). Use para "gera as análises", "analisa a pauta", "roda a IA na pauta".
- "exportar": gerar o PDF institucional da pauta com as análises. Use para "exporta o PDF", "gera o PDF da pauta", "me manda a pauta em PDF".
- "ajuda": explicar o que o bot faz.
- "responder": nenhuma das anteriores — responda você mesmo, brevemente (saudação, agradecimento, conversa social).`;

function montarPromptRoteador(mensagem) {
  return `Você é o roteador do bot de Telegram da Liderança do Podemos na Câmara dos Deputados (sistema SisPode). Dada a MENSAGEM do analista, escolha UMA ferramenta.

FERRAMENTAS:
${FERRAMENTAS}

Responda APENAS com um objeto JSON, sem cercas de código, no formato:
{"ferramenta": "<nome>", "argumentos": {"pergunta": "<p/ perguntar, ver_nota, listar_documentos ou votacao: o pedido, preservando siglas (PL 1234/2026) e datas>", "comissoes": ["<p/ pauta_comissao: cada comissão citada, nome ou sigla>"], "data": "<p/ pauta_comissao, comissoes_reuniao, varrer_comissoes: a data (dd/mm, aaaa-mm-dd, 'hoje', 'amanhã', '1º de julho')>", "partido": "<opcional p/ pauta_comissao/varrer_comissoes>", "deputado": "<opcional p/ pauta_comissao/varrer_comissoes>", "texto": "<apenas p/ responder: sua resposta curta em pt-BR>"}}

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
  const validas = ['verificar_pauta', 'escolher_pauta', 'importar_pauta', 'ordem_do_dia', 'listar_itens', 'ver_nota', 'perguntar', 'listar_documentos', 'baixar_documentos', 'pauta_comissao', 'comissoes_reuniao', 'varrer_comissoes', 'votacao', 'digest', 'analisar', 'exportar', 'ajuda', 'responder'];
  if (!validas.includes(j.ferramenta)) {
    return { ferramenta: 'perguntar', argumentos: { pergunta: mensagem } };
  }
  if (j.ferramenta === 'perguntar' && !j.argumentos?.pergunta) {
    j.argumentos = { ...(j.argumentos || {}), pergunta: mensagem };
  }
  return { ferramenta: j.ferramenta, argumentos: j.argumentos || {} };
}

module.exports = { rotear };
