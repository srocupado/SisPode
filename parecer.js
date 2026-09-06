/* ============================================================
   PARECER DE ESPECIALISTA — seleção de modelo, prompts e travas de saída

   O modo profundo do módulo de Plenário. Sob demanda explícita, nunca no
   "gerar todas", sem pedir confirmação, e escolhendo o modelo sozinho.

   POR QUE O MODELO IMPORTA AQUI, E NÃO IMPORTAVA ANTES

   A nota de pauta afirma coisas sobre um documento que está na mesa, e o JS
   confere cada número contra ele. O parecer afirma coisas sobre o MUNDO — e
   aí a trava tem um buraco que precisa ficar dito:

       o JS pega número inventado; não pega RACIOCÍNIO inventado.

   "A arrecadação passou de X para Y", com X e Y corretos na base, passa na
   conferência mesmo que a frase seguinte seja "o que demonstra a eficácia da
   medida" — inferência que ninguém autorizou. Nenhuma verificação automática
   pega isso.

   Por isso o critério de escolha do modelo não é escrever melhor: é RECUSAR-SE
   A PREENCHER LACUNA. É justamente nisso que a faixa econômica é fraca, porque
   é otimizada para custo e latência. Num resumo de pauta isso custa uma frase
   imprecisa; num parecer, custa uma afirmação causal falsa na tribuna.

   NOME DE MODELO NÃO SE FIXA

   O erro já está no repositório: PROVEDORES_META traz listas com gpt-5,
   claude-opus-4-8, gemini-2.5-pro. Lista assim envelhece em meses e passa a
   apontar para modelo que não existe. Aqui a classificação é por MARCA DE
   FAIXA no identificador — "lite", "mini", "haiku", "opus", "pro" —, que são
   convenções de nomenclatura estáveis entre provedores, e a escolha sai da
   listagem AO VIVO. Quando a convenção mudar, a faixa vira "não identificada"
   e o parecer declara isso, em vez de recusar tudo ou fingir que sabe.

   DUAS PASSAGENS

   1. APURAÇÃO — extrai fatos com citação literal. O JS confere.
   2. REDAÇÃO  — recebe só a base conferida e escreve. Não vê PDF, então não
                 tem de onde inventar cifra.

   Custo controlado (só a 2 usa o modelo caro), verificação real, e geração por
   seção, que resolve o truncamento de um parecer longo.
   ============================================================ */

'use strict';

// ============================================================
//  FAIXA DO MODELO
// ============================================================
// A ordem importa: "gemini-3.1-flash-lite" casa com "flash" E com "lite".
// Econômica é testada primeiro, senão o flash-lite passaria por intermediário.

const MARCA_ECONOMICA = /(^|[-_. ])(lite|mini|nano|small|tiny|instant|haiku|\d+b)([-_. ]|$)/i;
const MARCA_SUPERIOR  = /(^|[-_. ])(opus|ultra|pro|max|thinking|reasoning|o[1-9])([-_. ]|$)/i;
const MARCA_INTERMED  = /(^|[-_. ])(flash|sonnet|turbo)([-_. ]|$)/i;

// Modelos que NÃO redigem texto, por mais que o nome traga "pro" ou "flash".
// Medido na listagem ao vivo de 05/09/2026: gemini-3-pro-image,
// gemini-2.5-pro-preview-tts, gemini-3.5-transcribe, gemini-robotics-er-2,
// gemini-2.5-computer-use — todos com generateContent, todos casando com uma
// marca de faixa superior. Sem esta exclusão, um modelo de IMAGEM podia ser
// escolhido para escrever um parecer, e o carimbo diria "faixa superior".
const MARCA_OUTRA_MODALIDADE = /(^|[-_. ])(image|imagen|tts|audio|speech|transcribe|video|veo|embedding|embed|robotics|computer-use|live|omni|vision)([-_. ]|$)/i;

/**
 * Faixa de um modelo pelo identificador.
 * 'nao_identificada' NÃO é erro: é o que acontece quando o provedor muda a
 * convenção de nomes, e a resposta certa é usar e declarar, não travar.
 * 'outra_modalidade' É excludente: modelo de imagem ou voz não redige parecer.
 */
function faixaDoModelo(id) {
  const s = String(id || '');
  if (!s) return 'nao_identificada';
  if (MARCA_OUTRA_MODALIDADE.test(s)) return 'outra_modalidade';
  if (MARCA_ECONOMICA.test(s)) return 'economica';
  if (MARCA_SUPERIOR.test(s))  return 'superior';
  if (MARCA_INTERMED.test(s))  return 'intermediaria';
  return 'nao_identificada';
}

/** Versão embutida no id, para desempatar dentro da mesma faixa. */
function versaoDoModelo(id) {
  const m = String(id || '').match(/(\d+)[.\-_](\d+)|(\d+)/);
  if (!m) return 0;
  return m[1] ? Number(m[1]) + Number(m[2]) / 100 : Number(m[3]);
}

const ORDEM_FAIXA = { superior: 3, nao_identificada: 2, intermediaria: 1, economica: 0 };

/**
 * Escolhe o modelo do parecer a partir da listagem AO VIVO do provedor,
 * ignorando o que o usuário configurou como padrão — decisão da Liderança:
 * o modo profundo não deve depender de o analista lembrar de trocar.
 *
 * Devolve { modelo, faixa, motivo, ressalva } ou { erro } quando não há
 * modelo adequado. Recusar é o comportamento certo: entregar algo parecido com
 * um parecer, escrito por um modelo que preenche lacuna, é pior que não
 * entregar.
 */
/**
 * Ranking dos modelos de um provedor para o parecer. A regra mudou em
 * 05/09/2026, depois de uma comparação real: o gemini-3.8-flash produziu o
 * parecer mais informativo e a regra antiga (faixa pelo nome primeiro) o
 * preteria pelo 3.1-pro. A convenção de nomes envelheceu; a VERSÃO decide,
 * a faixa desempata, "preview" fica atrás do estável. A faixa econômica
 * continua fora (elegivel: false) — é a regra de faixa mínima da Liderança.
 */
function ranquearModelos(lista = []) {
  const ids = (lista || []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
  return ids
    .map(id => ({ id, faixa: faixaDoModelo(id), versao: versaoDoModelo(id), preview: /preview|exp/i.test(id) ? 1 : 0 }))
    .filter(m => m.faixa !== 'outra_modalidade')
    .map(m => ({ ...m, elegivel: m.faixa !== 'economica', motivoInelegivel: m.faixa === 'economica' ? 'faixa econômica: o parecer exige faixa mínima intermediária' : null }))
    .sort((a, b) => (b.elegivel - a.elegivel) || (b.versao - a.versao) || (ORDEM_FAIXA[b.faixa] - ORDEM_FAIXA[a.faixa]) || (a.preview - b.preview));
}

/**
 * Escolhe o modelo do parecer a partir da listagem AO VIVO do provedor.
 * `fixado`: modelo que o usuário fixou na configuração para o parecer — vale
 * se estiver na lista e for elegível. `padraoDoUsuario`: o modelo da nota
 * comum, que NÃO é usado (só citado no motivo).
 *
 * Devolve { modelo, faixa, motivo, ressalva } ou { erro } quando não há
 * modelo adequado. Recusar é o comportamento certo: entregar algo parecido com
 * um parecer, escrito por um modelo que preenche lacuna, é pior que não
 * entregar.
 */
function escolherModelo(lista = [], { padraoDoUsuario = null, fixado = null } = {}) {
  const ids = (lista || []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
  if (!ids.length) {
    return { erro: 'Não foi possível listar os modelos do provedor. Sem a lista ao vivo o parecer não escolhe modelo — e não usa o padrão da tela, que pode ser de faixa econômica.' };
  }
  const ranqueados = ranquearModelos(ids);
  if (!ranqueados.length) {
    return { erro: `Os ${ids.length} modelos listados são todos de outra modalidade (imagem, voz, vídeo) — nenhum redige texto.` };
  }
  const elegiveis = ranqueados.filter(m => m.elegivel);
  if (!elegiveis.length) {
    return { erro: 'Nenhum modelo adequado disponível nesta chave: todos os '
      + `${ids.length} modelos oferecidos são de faixa econômica (${ranqueados.slice(0, 3).map(r => r.id).join(', ')}). `
      + 'O Parecer de Especialista exige ao menos a faixa intermediária — a faixa econômica é otimizada para custo e latência e '
      + 'tende a completar lacuna com o plausível, que num parecer técnico é o erro de maior consequência.' };
  }
  const fix = fixado ? elegiveis.find(m => m.id === fixado) : null;
  const alvo = fix || elegiveis[0];
  const ressalva = alvo.faixa === 'superior' ? null
    : alvo.faixa === 'intermediaria'
      ? `O modelo ${alvo.id} é de faixa intermediária pela convenção de nomes; foi escolhido pela versão mais alta. Esta ressalva vai impressa no parecer.`
      : `A faixa do modelo ${alvo.id} não foi identificada pela convenção de nomes conhecida. O parecer sai, e esta ressalva vai impressa nele.`;
  return {
    modelo: alvo.id, faixa: alvo.faixa, ressalva,
    motivo: fix
      ? `Modelo fixado pelo usuário na configuração do parecer (${alvo.id}, faixa ${alvo.faixa}).`
      : `Escolhido automaticamente: versão mais alta entre os modelos não econômicos do provedor (${alvo.id}, faixa ${alvo.faixa})${padraoDoUsuario && padraoDoUsuario !== alvo.id ? `; o padrão da nota comum (${padraoDoUsuario}) não é usado no parecer` : ''}.`,
  };
}

// ============================================================
//  PASSAGEM 1 — APURAÇÃO
// ============================================================

/**
 * Prompt da apuração. Pede fato com citação literal, e permite explicitamente
 * "não identifiquei questão nesta linha" — que no roteiro da casa é resposta
 * válida e esperada, não lacuna.
 */
function promptApuracao(ctx = {}, lentes = [], catalogo = [], { semFicha = false } = {}) {
  const bloco = l => {
    const e = catalogo.find(x => x.chave === l.chave);
    if (!e) return '';
    return `\n### LENTE ${e.ordem} — ${e.rotulo}\n`
      + e.perguntas.map((p, i) => `${e.ordem}.${i + 1}. ${p}`).join('\n')
      + `\n\nArmadilhas desta lente, a evitar:\n` + e.armadilhas.map(a => `  · ${a}`).join('\n');
  };

  return `Você apura fatos para um PARECER TÉCNICO da Liderança do Podemos na Câmara dos Deputados.
Esta é a etapa de APURAÇÃO: você NÃO redige o parecer, apenas localiza e cita.

MATÉRIA
  ${ctx.identificacao || '(não informada)'} — ${ctx.ementa || ''}
  Autoria: ${ctx.autoria || 'não informada'}
  Relator: ${ctx.relator || 'não informado'}

TEXTO ANALISADO: ${ctx.textoAnalisado || '(não identificado)'}
Este é o ÚNICO texto a analisar. Se o documento anexado não corresponder a ele, diga isso e pare.

Responda, para cada pergunta de cada lente abaixo, em JSON:
[
  { "lente": "2", "pergunta": "2.3", "achado": "resposta objetiva, em uma a quatro frases",
    "dispositivo": "art. 1º do projeto / art. 150, III, 'b', da CF",
    "trecho": "transcrição LITERAL de 30 a 300 caracteres do documento que sustenta o achado",
    "semQuestao": false }
]

REGRAS QUE NÃO PODEM SER QUEBRADAS
- "trecho" é CÓPIA EXATA do documento analisado. Ele será procurado no texto extraído do PDF; não sendo
  encontrado, o achado é descartado. Não parafraseie, não corrija, não resuma.
- Quando não houver questão a apontar naquela linha, responda com "semQuestao": true e achado
  "Não identifiquei questão nesta linha." Isso é resposta CORRETA e esperada, não lacuna a preencher.
- NÃO afirme inconstitucionalidade. Aponte o dispositivo e o ponto que merece exame. Se houver precedente,
  cite classe, número, órgão, relator e data; sem esses elementos, não cite.
- NÃO invente número, data, lei, processo ou valor. O que não estiver no documento não existe para esta etapa.
- Quando o documento sustentar MAIS DE UM ponto para a mesma pergunta, devolva um achado por ponto (até três por
  pergunta), cada um com o seu trecho. O parecer é detalhado; achado a mais com trecho vale, achado sem trecho não.
- Se a proposição tiver estimativa oficial de impacto (exposição de motivos, parecer, anexo), registre-a como
  achado próprio com o valor, a fonte e o trecho.
${semFicha ? '' : `
ALÉM DAS LENTES, registre estes achados com "lente": "X" (são a FICHA DO OBJETO; sem eles o parecer sai incompleto):
- "pergunta": "dispositivo" — o dispositivo da norma vigente que a proposição altera ou cria (ex.: "art. 1º, § 2º-A, do
  Decreto-Lei 1.804/1980"), com trecho.
- "pergunta": "regra_antes" — a REGRA HOJE, como o documento a descreve ou transcreve. Regra numérica (alíquota, valor,
  prazo, pena): em algarismos. Regra sem números (competência, direito, vedação, procedimento): o enunciado dela. Quando
  NÃO HÁ regra (matéria nova, lacuna, dispositivo revogado ou declarado inconstitucional), isso É o achado — "não há lei
  que discipline X; vale Y" — com o trecho que o diz. Só "semQuestao": true se o documento não falar do estado atual.
- "pergunta": "regra_depois" — a REGRA PROPOSTA: em algarismos quando numérica; senão, o enunciado, com trecho.
- "pergunta": "objetivo" — o OBJETIVO DECLARADO da proposição (o que a justificação, a exposição de motivos ou
  o parecer dizem que ela pretende alcançar: proteger setor, arrecadar, simplificar, reduzir preço etc.), com o
  trecho literal que o enuncia. Havendo mais de um objetivo, um achado para cada.
- "pergunta": "estimativa" — a ESTIMATIVA OFICIAL de impacto (valor, período, hipóteses), com trecho; não
  havendo, "semQuestao": true.
- "pergunta": "historico" — a ORIGEM da regra que a proposição altera e da própria proposição, como os documentos
  a contam: quem propôs; quem relatou e O QUE o relator propôs (manter, suprimir, alterar — com o argumento dele);
  emendas acatadas ou rejeitadas e de quem; o que o Plenário decidiu; datas. UM achado por fato, cada um com
  trecho literal; três a oito achados quando os documentos permitirem. É isto que diz ao leitor "de onde veio
  isto" e "quem defendeu o quê" — sem isto o parecer sai sem contexto.
${blocoTramitacao(ctx.processo)}`}
${lentes.map(bloco).join('\n')}`;
}

/**
 * O que o módulo de Plenário sabe da tramitação (cenário, relator, documentos
 * anexados, emendas, comissões) vai ao modelo como fato do sistema, e a
 * apuração devolve UM achado por documento, por emenda e por dispositivo
 * alterado — é isso que dá ao leitor "o que ocorreu ao longo do processo".
 */
function descreverProcesso(pr) {
  if (!pr) return '';
  const L = [];
  if (pr.cenario) L.push(`Cenário: ${pr.cenario}.${pr.textoEmVotacao ? ` Texto em votação: ${pr.textoEmVotacao}.` : ''}`);
  if (pr.relator) L.push(`Relator(a): ${pr.relator.nome}${pr.relator.partido ? ` (${pr.relator.partido}${pr.relator.uf ? '-' + pr.relator.uf : ''})` : ''}${pr.relator.data ? `, designado(a) em ${pr.relator.data}` : ''}.`);
  if (pr.documentos?.length) L.push(`Documentos anexados, nesta ordem: ${pr.documentos.map((d, i) => `${i + 1}. ${d.rotulo}`).join('; ')}.`);
  if (pr.emendas?.length) L.push(`Emendas e substitutivos na tramitação: ${pr.emendas.map(e => e.rotulo).join('; ')}.`);
  if (pr.comissoes?.length) L.push(`Comissões por onde tramitou: ${pr.comissoes.map(c => `${c.comissao}${c.dataBR ? ` (${c.dataBR})` : ''}${c.relator ? `, relator(a) ${c.relator}` : ''}${c.posicao ? `: ${c.posicao}` : ''}`).join('; ')}.`);
  if (pr.apensados?.length) L.push(`Apensados de autoria do Podemos: ${pr.apensados.join('; ')}.`);
  return L.join('\n  ');
}
function blocoTramitacao(pr) {
  if (!pr) return '';
  return `
TRAMITAÇÃO (informada pelo sistema — use-a para localizar cada documento e não a contradiga):
  ${descreverProcesso(pr)}
Registre também, com "lente": "X":
- "pergunta": "documento" — UM achado por documento anexado (campo "documento": o rótulo dele): o que é, quem assina,
  o que conclui ou propõe, em duas a quatro frases, com trecho literal DESSE documento.
- "pergunta": "emenda" — UM achado por emenda, substitutivo ou subemenda anexado ou mencionado nos documentos: número,
  autor, o que altera e o destino que o relator lhe deu (acolhida, rejeitada, parcialmente), com trecho.
- "pergunta": "altera" — UM achado por dispositivo da legislação vigente que a proposição altera, revoga ou acrescenta
  ("dispositivo": "art. 92 da Lei 8.112/1990"): o que muda, em uma a três frases, com trecho. Até 12.`;
}

/**
 * Apuração dedicada do HISTÓRICO. Na apuração geral o modelo pulou a pergunta
 * "historico" em cinco rodadas reais seguidas — o relatório do Senado contava
 * que o relator do Podemos tentou derrubar a cobrança, e nada disso chegou ao
 * parecer. Quando a apuração geral não traz histórico e há parecer ou
 * relatório entre os documentos, esta chamada lê só para isso.
 */
function promptHistorico(ctx = {}) {
  return `Você apura o HISTÓRICO para um parecer técnico da Liderança do Podemos na Câmara dos Deputados sobre
${ctx.identificacao || '(não informada)'} — ${ctx.ementa || ''}. Só isto, nesta etapa.

Leia os documentos anexados (texto da proposição, exposição de motivos, pareceres, relatórios) e extraia, em JSON, os FATOS
da história da regra que a proposição altera e da própria proposição, como os documentos os contam:
[
  { "lente": "X", "pergunta": "historico", "achado": "um fato, em uma a três frases, com data e nome quando o documento os der",
    "dispositivo": "documento e trecho de onde vem (ex.: relatório do Senado, item II)",
    "trecho": "transcrição LITERAL de 30 a 300 caracteres do documento que sustenta o fato", "semQuestao": false }
]

O QUE PROCURAR, um achado por fato: quem propôs a regra atual e quando; quem relatou e O QUE o relator propôs (manter,
suprimir, alterar) e com que argumento; emendas apresentadas, de quem, acatadas ou rejeitadas; o que o Plenário decidiu e
quando; o que a exposição de motivos da proposição atual diz sobre a experiência da regra. Entre 3 e 10 achados quando os
documentos permitirem; se nada houver, [].

REGRAS: "trecho" é CÓPIA EXATA do documento — será procurado no texto e, não encontrado, o achado é descartado. Não invente
nome, data ou voto que não esteja escrito. Nomeie partidos e senadores/deputados só como aparecem no documento.`;
}

/**
 * Apuração dedicada da FICHA DO OBJETO. Na apuração geral o modelo pula
 * "regra_antes"/"regra_depois" quando a regra não tem número (o PL 1893/2026,
 * negociação coletiva no setor público, saiu "incompleto" por isso). Esta
 * chamada pede só a ficha, com a instrução de que regra qualitativa e
 * "não há regra" são respostas.
 */
function promptFicha(ctx = {}) {
  return `Você preenche a FICHA DO OBJETO de um parecer técnico da Liderança do Podemos na Câmara dos Deputados sobre
${ctx.identificacao || '(não informada)'} — ${ctx.ementa || ''}. Só isto, nesta etapa.

TEXTO ANALISADO: ${ctx.textoAnalisado || '(não identificado)'}. Leia os documentos anexados e responda em JSON:
[
  { "lente": "X", "pergunta": "dispositivo", "achado": "…", "dispositivo": "…", "trecho": "cópia literal (30 a 300 caracteres)", "semQuestao": false },
  { "lente": "X", "pergunta": "regra_antes", "achado": "…", "trecho": "…", "semQuestao": false },
  { "lente": "X", "pergunta": "regra_depois", "achado": "…", "trecho": "…", "semQuestao": false }
]

- "dispositivo": o dispositivo da norma vigente que a proposição altera, revoga ou cria (ex.: "art. 240 da Lei 8.112/1990";
  "lei nova: arts. 1º a 19"). Se a proposição institui regime novo, diga "norma nova" e cite a lei que ela toca, se alguma.
- "regra_antes": a REGRA HOJE. Numérica: em algarismos. Sem números (direito, competência, vedação, procedimento): o
  enunciado. NÃO HAVENDO regra (lacuna, matéria não regulamentada, dispositivo revogado ou declarado inconstitucional):
  diga isso — é a resposta — com o trecho do documento que o afirma (a justificação e o parecer costumam dizê-lo:
  "atualmente", "hoje", "não há", "lacuna", "carece de regulamentação").
- "regra_depois": o que passa a valer com a proposição, em uma a quatro frases; em algarismos quando houver números.
- "trecho" é CÓPIA EXATA do documento; será procurado no texto extraído e, não encontrado, o achado é descartado.
- "semQuestao": true só se os documentos não disserem nada sobre aquele item.`;
}

/**
 * Experiência comparada, com busca na web. O leitor quer saber se regra
 * parecida funcionou em outro lugar; o modelo procura, nomeia a fonte e o
 * programa imprime "fonte não conferida". Sem fonte, o item não entra.
 */
function promptComparada(ctx = {}) {
  return `Você levanta a EXPERIÊNCIA COMPARADA para um parecer técnico da Liderança do Podemos na Câmara dos Deputados sobre
${ctx.identificacao || '(não informada)'} — ${ctx.ementa || ''}.
Regra em exame: ${ctx.regra || '(ver ementa)'}.

Use a busca na web. Procure de 3 a 6 casos em que outro país, ou outro ente brasileiro (estado, município), adotou regra
semelhante e em que exista avaliação, estudo ou dado oficial sobre o resultado. Prefira OCDE, OIT, FMI, Banco Mundial,
tribunais de contas, institutos de estatística, universidades. Responda SOMENTE com JSON:
[
  { "lugar": "país ou ente", "quando": "ano ou período", "medida": "o que foi adotado, em uma ou duas frases",
    "o_que_se_mediu": "indicador e período", "resultado": "o que a avaliação encontrou, com números quando houver",
    "fonte_nome": "nome do documento e instituição", "fonte_url": "https://…" }
]
REGRAS: cada item TEM fonte com endereço (URL) real, encontrado na busca; item sem fonte não existe. Não invente número:
o que a fonte não traz, escreva "não informado". Não conclua que "funcionará no Brasil": relate o que se mediu lá.
Se a busca não encontrar avaliação de caso semelhante, responda [].`;
}

// A redação, a tese e as travas de saída vivem em tese.js e gates.js: o juízo
// virou dado conferível, não prosa gerada de uma vez.

/** Carimbo do parecer — sem isto, o documento não se defende depois. */
function carimboDoParecer({ modelo, faixa, motivo, ressalva, lentes = [], em = new Date(), por = 'equipe' }) {
  const data = `${String(em.getDate()).padStart(2, '0')}/${String(em.getMonth() + 1).padStart(2, '0')}/${em.getFullYear()}`;
  return {
    linha: `Parecer produzido com apoio de inteligência artificial em ${data} por ${por}. `
      + `Modelo: ${modelo} (faixa ${faixa}). ${motivo}`,
    ressalva: ressalva || null,
    lentes: lentes.map(l => `${l.ordem}. ${l.rotulo} — acionada por ${l.motivo}${l.confianca === 'baixa' ? ' [confiança baixa]' : ''}`),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    faixaDoModelo, versaoDoModelo, escolherModelo, ranquearModelos,
    promptApuracao, promptHistorico, promptFicha, promptComparada, descreverProcesso, carimboDoParecer,
  };
}
