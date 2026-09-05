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
- "pergunta": "regra_antes" — a REGRA HOJE, como o documento a descreve ou transcreve (alíquotas, valores, prazos, penas,
  em algarismos), com o trecho literal. Se o documento não a descreve, "semQuestao": true.
- "pergunta": "regra_depois" — a REGRA PROPOSTA, em algarismos, com trecho.
- "pergunta": "objetivo" — o OBJETIVO DECLARADO da proposição (o que a justificação, a exposição de motivos ou
  o parecer dizem que ela pretende alcançar: proteger setor, arrecadar, simplificar, reduzir preço etc.), com o
  trecho literal que o enuncia. Havendo mais de um objetivo, um achado para cada.
- "pergunta": "estimativa" — a ESTIMATIVA OFICIAL de impacto (valor, período, hipóteses), com trecho; não
  havendo, "semQuestao": true.
- "pergunta": "historico" — a ORIGEM da regra que a proposição altera e da própria proposição, como os documentos
  a contam: quem propôs; quem relatou e O QUE o relator propôs (manter, suprimir, alterar — com o argumento dele);
  emendas acatadas ou rejeitadas e de quem; o que o Plenário decidiu; datas. UM achado por fato, cada um com
  trecho literal; três a oito achados quando os documentos permitirem. É isto que diz ao leitor "de onde veio
  isto" e "quem defendeu o quê" — sem isto o parecer sai sem contexto.`}
${lentes.map(bloco).join('\n')}`;
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
    promptApuracao, promptHistorico, carimboDoParecer,
  };
}
