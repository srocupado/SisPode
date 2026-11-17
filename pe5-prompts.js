// Parecer de Especialista (refeito em 17/11/2026) — OS PROMPTS.
//
// Oito chamadas, cada uma com um trabalho só e saída em JSON:
//   leitura        lê os documentos e devolve o que eles dizem, com trecho literal de cada item
//   debate         pesquisa quem se posicionou e o que argumenta (internet)
//   internacional  pesquisa o que outros países fizeram e o que aconteceu (internet)
//   contexto       pesquisa decisões judiciais, normas existentes, dados e proposições correlatas (internet)
//   congresso      pesquisa o histórico do tema, o que espera a matéria na outra Casa e os sinais de judicialização (internet)
//   redacao 1 e 2  escreve o documento, em blocos por seção, só com o que está na base
//   revisao        lê o documento pronto como adversário e devolve correções pontuais
//
// O que o modelo NÃO faz: tramitação, votações, voto da bancada, fase, texto da lei vigente, câmbio e
// lista de fontes — isso é do programa (pe5-coleta.js) e chega pronto.
//
// Script clássico (global na extensão) + module.exports para os testes.

'use strict';

const PE5_ESTILO = `COMO ESCREVER
- Português direto, frase curta, verbo na voz ativa. Escreva para um assessor parlamentar que precisa entender e explicar a matéria.
- Proibido juridiquês e enfeite: nada de "destarte", "outrossim", "novel", "no bojo", "resta consubstanciado", "hígido", "pecha", "plenário soberano", "no que tange", "em apreço", "ensejar".
- O documento é DETALHADO. O leitor quer o nome completo de cada órgão, cargo, documento, estudo e entidade, exatamente como está na base, e a enumeração inteira de critérios, requisitos e obrigações. Nunca troque o nome por um genérico ("uma unidade", "um estudo", "alguns critérios", "entidades do setor"): escreva o nome e enumere.
- Cada informação é EXPLICADA uma vez, na seção dela. Fora da abertura, não reconte em outra seção o que já foi explicado.
- Nunca recomende voto nem diga o que "deve" ser aprovado ou rejeitado. Mostre o texto, os argumentos e as consequências.
- Todo número (valor, percentual, prazo, data, quantidade) tem de estar na BASE fornecida. Não arredonde para outro número, não estime, não complete de memória. Conta simples a partir da base (soma de prazos, multiplicação, conversão pelo câmbio fornecido) é permitida e deve ficar evidente na frase.
- Quando algo não existir, diga ONDE procurou: "nos documentos lidos não há…", "nas fontes pesquisadas não foi localizado…". Nunca afirme ausência sem esse escopo.
- Cite o dispositivo (art. 47-C, § 2º) quando falar de regra do texto. Só cite artigo que esteja na base.
- Não escreva identificadores (B1, Q7, W2…) dentro do texto. Eles vão apenas no campo "ev".
- Não use termos internos: "cenário", "lente", "achado", "base", "evidência".
- Aspas só para citação literal curta que esteja na base.`;

const PE5_SO_JSON = 'Responda APENAS com o JSON, sem texto antes ou depois e sem cercas de código.';

function pe5ResumoColeta(G) {
  if (!G) return '(dados de tramitação não obtidos)';
  const L = [];
  const pr = G.proposicao || {};
  L.push(`Proposição: ${pr.sigla} ${pr.numero}/${pr.ano}. Autor(es): ${(pr.autores || []).join('; ') || 'não informado'}${pr.totalAutores > (pr.autores || []).length ? ` e mais ${pr.totalAutores - pr.autores.length}` : ''}. Apresentada em ${pr.apresentacao || '?'}.`);
  L.push(`Fase: ${G.fase?.descricao || '?'}`);
  L.push(`Situação registrada em ${G.status?.data || '?'}: ${G.status?.situacao || '?'} (${G.status?.orgao || '?'}). ${G.status?.despacho || ''}`);
  const u = G.urgencia || {};
  L.push(u.tem ? `Regime: ${u.tipo}${u.aprovadaEm ? `, aprovada em ${u.aprovadaEm}` : ''}. ${u.requerimento || ''}` : `Regime: ${u.regime || 'sem urgência'}.`);
  for (const v of (G.votacoes || []).filter(x => x.nominal)) {
    const b = v.bancada || {};
    L.push(`Votação nominal de ${v.data} (${v.orgao}): ${v.descricao} Placar ${v.sim} a ${v.nao}. Podemos: ${(b.sim || []).length} sim, ${(b.nao || []).length} não${(b.nao || []).length ? ` (não: ${b.nao.join(', ')})` : ''}. Por partido: ${(v.partidos || []).slice(0, 12).map(p => `${p.partido} ${p.sim}×${p.nao}`).join(', ')}.`);
  }
  if (G.pauta?.titulo) L.push(`Consta da pauta do Plenário registrada no SisPode: ${G.pauta.titulo}${G.pauta.data ? ` (${G.pauta.data})` : ''}.`);
  if ((G.marcos || []).length) L.push('Linha do tempo:\n' + G.marcos.map(m => `  ${m.data} ${m.orgao} — ${m.fato}`).join('\n'));
  if ((G.relacionadas || []).length) L.push(`Proposições relacionadas: ${G.relacionadas.map(r => r.rotulo).join('; ')}.`);
  const M = G.mapa;
  if (M && M.votacao) {
    L.push(`Quórum para aprovar o mérito: ${M.quorum.regra}${M.quorum.minimo ? ` (${M.quorum.minimo} votos)` : M.quorum.presenca ? ` (${M.quorum.presenca} presentes)` : ''}, ${M.quorum.base}.`);
    const div = M.divididos.filter(d => d.sim + d.nao >= 10);
    if (div.length) L.push(`Partidos divididos na votação nominal de ${M.votacao.data} (ao menos um quarto dos votos de cada lado): ${div.map(d => `${d.partido} ${d.sim}×${d.nao}`).join(', ')}.`);
    if (M.podemos) L.push(`Orientação do Podemos naquela votação: ${M.podemos.orientacao || 'não registrada'}${M.podemos.orientadoPor ? ` (pelo ${M.podemos.orientadoPor})` : ''}.`);
  }
  const P = G.partido;
  if (P) {
    L.push('O PODEMOS E A MATÉRIA (dados da Câmara, lidos pelo programa):');
    L.push(`  Deputados do Podemos autores da proposição: ${(P.autoresDaMateria || []).join(', ') || 'nenhum'}.`);
    L.push(`  Requerimentos, emendas e destaques de deputado do Podemos nesta matéria: ${(P.acessorias || []).map(a => `${a.rotulo} (${a.autores.join(', ')}): ${a.ementa}`).join(' | ') || 'nenhum localizado'}.`);
    L.push(`  Projetos de deputados do Podemos indexados com os termos ${(P.termos || []).join(', ') || '—'} (NEM TODOS tratam do mesmo assunto; use só os pertinentes):`);
    for (const x of P.projetos || []) L.push(`    ${x.rotulo} — ${(x.autores || []).join(', ') || 'autor não obtido'}${x.apresentacao ? `, de ${x.apresentacao}` : ''} — ${x.ementa}${x.situacao ? ` Situação: ${x.situacao}.` : ''}`);
    if (!(P.projetos || []).length) L.push('    (nenhum localizado)');
    L.push('  Como a bancada votou, em Plenário, nas proposições correlatas identificadas na pesquisa:');
    for (const v of P.votacoesCorrelatas || []) {
      if (!v.encontrada) { L.push(`    ${v.rotulo}: não localizada na base da Câmara.`); continue; }
      if (!(v.nominais || []).length) { L.push(`    ${v.rotulo}: sem votação nominal em Plenário.`); continue; }
      for (const n of v.nominais) L.push(`    ${v.rotulo}, ${n.data}: ${n.descricao} Podemos: ${n.podemosSim} sim, ${n.podemosNao} não${n.orientacao ? `; orientação ${n.orientacao}${n.orientadoPor ? ` (dada pelo ${n.orientadoPor}, de que o partido fazia parte)` : ''}` : ''}.`);
    }
    if (!(P.votacoesCorrelatas || []).length) L.push('    (nenhuma proposição correlata consultada)');
    for (const a of P.avisos || []) L.push(`  Aviso: ${a}.`);
  }
  return L.join('\n');
}

// ------------------------------------------------------------------------------------------------
// 1. LEITURA
// ------------------------------------------------------------------------------------------------
function pe5PromptLeitura({ identificacao, ementa, documentos = [], coleta = null, lentes = [], catalogo = [], textoEmVotacao = '' }) {
  const blocoLentes = lentes.map(l => {
    const e = catalogo.find(x => x.chave === l.chave) || {};
    return `LENTE "${l.ordem}" — ${l.rotulo}
  Perguntas de conferência (use como roteiro; registre SÓ o que tiver resposta relevante no texto):
${(e.perguntas || []).map((p, i) => `    ${i + 1}. ${p}`).join('\n')}
  Armadilhas do campo:
${(e.armadilhas || []).map(a => `    - ${a}`).join('\n')}`;
  }).join('\n\n');
  const docs = documentos.map((d, i) => `<<<DOCUMENTO ${i + 1}: ${d.rotulo}>>>\n${d.texto}\n<<<FIM DO DOCUMENTO ${i + 1}>>>`).join('\n\n');
  return `Você vai ler os documentos de uma proposição legislativa e devolver, em JSON, o que eles dizem. Esta etapa é só leitura: não opine, não pesquise, não use o que sabe de memória sobre a matéria.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || '(sem ementa)'}
TEXTO EM VOTAÇÃO (é ele que se analisa; os demais documentos servem para comparar): ${textoEmVotacao || documentos[0]?.rotulo || ''}

DADOS DE TRAMITAÇÃO (do sistema da Câmara; são fatos, não os contradiga):
${pe5ResumoColeta(coleta)}

REGRA DO TRECHO LITERAL
Todo item tem o campo "trecho": de 6 a 30 palavras CONSECUTIVAS copiadas do documento indicado em "documento", sem trocar, pular nem corrigir palavra. O programa vai procurar o trecho no documento; item cujo trecho não for encontrado é descartado. Escolha um trecho curto e distintivo. O campo "documento" repete exatamente o rótulo do documento.

O QUE DEVOLVER
{
 "resumo": "uma frase: o que o texto em votação faz, em linguagem comum",
 "blocos": [ { "id": "B1", "titulo": "tema do bloco", "dispositivos": "arts. …", "documento": "…", "explica": "o que esse conjunto de artigos faz, em 2 a 6 frases, cobrindo regras, prazos, valores e quem decide", "trecho": "…" } ],
 "alteracoes": [ { "id": "A1", "dispositivo": "art. 9º da Lei nº 12.529/2011", "tipo": "altera | acrescenta | revoga", "documento": "…", "muda": "o que muda, em 1 a 2 frases", "trecho": "…" } ],
 "versoes": [ { "id": "V1", "tema": "…", "antes": "como era no texto anterior", "depois": "como ficou no texto em votação", "trecho_antes": "…", "documento_antes": "…", "trecho_depois": "…", "documento_depois": "…" } ],
 "emendas": [ { "id": "E1", "rotulo": "…", "autor": "…", "muda": "…", "destino": "acolhida | rejeitada | parcialmente acolhida | sem deliberação", "documento": "…", "trecho": "…" } ],
 "justificativa": [ { "id": "J1", "objetivo": "o que o autor ou o relator diz que a proposta pretende, ou o argumento que usa", "documento": "…", "trecho": "…" } ],
 "estimativas": [ { "id": "S1", "o_que": "impacto, custo, renúncia, número de afetados", "valor": "como está no documento", "documento": "…", "trecho": "…" } ],
 "controversias": [ { "id": "C1", "questao": "ambiguidade, contradição interna ou ponto que o próprio documento registra como disputado", "explica": "…", "documento": "…", "trecho": "…" } ],
 "achados": [ { "id": "T1", "lente": "número da lente", "questao": "o ponto, em uma frase", "dispositivo": "art. …", "porque": "por que merece exame, em 1 a 3 frases, só com o que está no texto", "documento": "…", "trecho": "…", "gravidade": "alta | media | baixa" } ],
 "referencias": [ { "id": "U1", "nome": "nome COMPLETO do documento, como está escrito (consulta pública, estudo, relatório, nota técnica, exposição de motivos, parecer, acórdão, tratado)", "o_que_e": "o que é e para que o texto o invoca, em 1 a 2 frases", "documento": "…", "trecho": "…" } ],
 "ausencias": [ { "id": "X1", "o_que": "o que se esperaria encontrar e não está", "onde_procurou": "em quais documentos" } ],
 "vigencia": { "clausula": "quando entra em vigor", "documento": "…", "trecho": "…" },
 "termos_de_busca": [ "de 3 a 5 termos de UMA palavra cada (substantivo específico do assunto, sem artigo nem preposição), com que a Câmara indexaria outras proposições sobre o mesmo tema" ]
}

ORIENTAÇÕES
- "blocos": cubra o texto em votação INTEIRO, agrupado por tema (de 4 a 12 blocos). Quem lê os blocos tem de saber tudo o que o texto faz.
- "alteracoes": uma entrada por artigo ou grupo contíguo de artigos de lei em vigor que o texto altera, acrescenta ou revoga. Escreva o dispositivo com o número e o ano da lei.
- "versoes": só se houver mais de uma versão entre os documentos (original e substitutivo, texto da Câmara e do Senado). Uma entrada por diferença relevante. Se o texto novo criou algo que não existia, deixe "trecho_antes" vazio.
- "achados": percorra as lentes abaixo. Registre o que merece exame E TAMBÉM o que está regular quando isso for relevante para quem decide (por exemplo, iniciativa correta). Não registre pergunta que não se aplica à matéria. Um mesmo problema entra uma vez, na lente mais apropriada.
- "referencias": TODO documento que a justificativa, a exposição de motivos, o relatório ou o voto invocam como base da proposta: consulta pública, tomada de subsídios, estudo, relatório de órgão, nota técnica, grupo de trabalho, decisão, norma estrangeira usada como modelo. Copie o nome e o número exatamente como aparecem. Se o texto citar "um estudo" sem dar o título, registre assim mesmo e diga que o título não consta: a pesquisa vai procurá-lo. Inclua a própria exposição de motivos, com o número.
- "ausencias": estimativa de impacto, relatório ou voto do relator, estudo que a justificativa cita e não anexa, definição de termo central. Diga sempre onde procurou.
- Se um documento estiver ilegível ou incompleto, registre em "ausencias".

LENTES
${blocoLentes}

DOCUMENTOS
${docs}

${PE5_SO_JSON}`;
}

// ------------------------------------------------------------------------------------------------
// 2 a 4. PESQUISAS NA INTERNET
// ------------------------------------------------------------------------------------------------
function pe5FatosDoTexto(L) {
  const l = [];
  if (L?.resumo) l.push(`Resumo: ${L.resumo}`);
  for (const b of L?.blocos || []) l.push(`- ${b.titulo} (${b.dispositivos}): ${b.explica}`);
  for (const v of L?.versoes || []) l.push(`- Mudança entre versões — ${v.tema}: antes: ${v.antes} Depois: ${v.depois}`);
  return l.join('\n');
}
const PE5_REGRAS_PESQUISA = `REGRAS DA PESQUISA
- Use a busca na internet. Registre só o que a página consultada diz; não complete de memória.
- "fonte_url" é o endereço da página que você leu, e "fonte_nome", o nome do veículo ou do órgão. Item sem fonte é descartado pelo programa.
- "fonte_tipo": "primária" (órgão oficial, texto da lei, decisão, nota da própria entidade), "imprensa" ou "terceiro" (escritório, consultoria, entidade comentando outra).
- Prefira fonte primária. Quando só houver imprensa, use a mais recente.
- Toda informação tem data ("dd/mm/aaaa" ou "mês de aaaa"). Sem data conhecida, escreva "sem data".
- Se uma fonte disser algo que contradiz os FATOS DO TEXTO abaixo (um prazo, um valor, o regime de tramitação), não corrija a fonte em silêncio: registre a divergência em "avisos".
- Em "avisos", diga também o que procurou e não encontrou.`;

function pe5PromptDebate({ identificacao, ementa, leitura, coleta, hoje }) {
  return `Pesquise na internet QUEM SE POSICIONOU sobre a proposição abaixo e O QUE CADA UM ARGUMENTA. O objetivo é montar o mapa do debate para um assessor parlamentar: os dois lados, com os argumentos e a evidência que cada um apresenta.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO (lidos nos documentos; servem para você reconhecer de qual versão cada fonte fala):
${pe5FatosDoTexto(leitura)}

TRAMITAÇÃO:
${pe5ResumoColeta(coleta)}

O QUE PROCURAR
- Governo, relator e autor: o que defendem e como respondem às críticas.
- Empresas e setores diretamente afetados, e as entidades que os representam. Diga quem a entidade representa (associados, setor).
- Setores que se beneficiam ou dependem da regra.
- Organizações da sociedade civil, academia, órgãos públicos (agências, Ministério Público, tribunais de contas), outros Poderes.
- Parlamentares e bancadas: quem lidera o apoio e a oposição.
- Governos e entidades estrangeiros, quando se manifestaram.
- Procure os DOIS lados de cada controvérsia. Se só achar um, diga em "avisos".
- Prefira a manifestação mais recente de cada ator e diga se ela é sobre o texto original ou sobre o texto em votação.

${PE5_REGRAS_PESQUISA}

O QUE DEVOLVER
{
 "atores": [ { "id": "Q1", "ator": "nome (e porta-voz, se houver)", "quem_e": "o que é e que interesse representa", "posicao": "favorável | favorável com ressalvas | contrário com ressalvas | contrário | neutro",
     "versao": "original | substitutivo | não especificada", "data": "dd/mm/aaaa",
     "argumentos": [ { "tese": "o argumento, em uma ou duas frases, fiel à fonte", "evidencia_citada": "dado, estudo ou exemplo que o ator apresenta; omita o campo se não apresenta" } ],
     "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "primária | imprensa | terceiro" } ],
 "controversias": [ { "id": "D1", "questao": "a pergunta em disputa, em uma frase", "favor": ["Q1"], "contra": ["Q7"] } ],
 "avisos": [ "divergência entre fonte e texto; ator relevante sem manifestação localizada; documento citado e não encontrado" ]
}
De 8 a 18 atores. De 4 a 9 controvérsias, cada uma ligando os atores que argumentam de um lado e de outro.

${PE5_SO_JSON}`;
}

function pe5PromptInternacional({ identificacao, ementa, leitura, hoje }) {
  return `Pesquise na internet a EXPERIÊNCIA DE OUTROS PAÍSES com regra parecida com a da proposição abaixo: o que cada um adotou, com quais parâmetros, e O QUE ACONTECEU depois.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO (para você saber o que comparar):
${pe5FatosDoTexto(leitura)}

O QUE PROCURAR
- De 3 a 6 países ou blocos com regra em vigor comparável. Para cada um: a norma, desde quando vale, a autoridade, quem é alcançado (com os números do critério na moeda original), como funciona, a sanção e a duração.
- O que aconteceu: quantos casos, quem foi alcançado, decisões, multas, mudanças de conduta, revisões oficiais da própria lei, decisões de tribunais. Com data.
- As críticas, dos dois lados: de quem acha a regra fraca ou mal aplicada e de quem acha que ela prejudica.
- Países que discutiram regra parecida e DESISTIRAM, adiaram ou revogaram, e por quê.
- Avaliações de organismos internacionais (OCDE, Banco Mundial, FMI, órgãos da ONU), se houver.
- Estudos que meçam efeito (preço, investimento, entrada de concorrentes, arrecadação, conforme a matéria). Se não houver, diga em "avisos".
- Fonte primária sempre que possível: a autoridade, o diário oficial, o relatório de revisão.

${PE5_REGRAS_PESQUISA}

O QUE DEVOLVER
{
 "jurisdicoes": [ { "id": "W1", "lugar": "…", "norma": "nome e número", "desde": "…", "autoridade": "…",
     "quem_e_alcancado": "critérios, com os números na moeda original", "como_funciona": "…", "sancao": "…", "duracao": "…",
     "aconteceu": [ { "fato": "…", "data": "…" } ],
     "criticas": [ { "critica": "…", "quem": "…", "data": "…", "fonte_nome": "…", "fonte_url": "https://…" } ],
     "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "primária | imprensa | terceiro" } ],
 "avisos": [ "o que não foi possível confirmar em fonte oficial; o que procurou e não achou" ]
}
Para país que não aprovou a regra, use os mesmos campos, com "—" no que não se aplica e a história em "como_funciona" e "aconteceu".

${PE5_SO_JSON}`;
}

function pe5PromptContexto({ identificacao, ementa, leitura, hoje }) {
  const normas = [...new Set((leitura?.alteracoes || []).map(a => String(a.dispositivo).replace(/^arts?\.?[^d]*d[ae]\s+/i, '')))].join('; ');
  const pontos = (leitura?.achados || []).filter(a => a.gravidade !== 'baixa').map(a => `- ${a.questao} (${a.dispositivo})`).join('\n');
  const refs = (leitura?.referencias || []).map(r => `- ${r.nome}: ${r.o_que_e}`).join('\n');
  return `Pesquise na internet o CONTEXTO JURÍDICO E DE FATO da proposição abaixo: decisões judiciais sobre regras parecidas, normas que já tratam do assunto, dados que dimensionam o alcance e o custo, e outras proposições sobre o mesmo tema.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}
NORMAS QUE O TEXTO ALTERA: ${normas || '(nenhuma identificada)'}

FATOS DO TEXTO:
${pe5FatosDoTexto(leitura)}

PONTOS QUE A LEITURA DESTACOU (procure precedente e norma sobre eles):
${pontos || '(nenhum)'}

DOCUMENTOS QUE A PROPOSIÇÃO CITA COMO BASE (localize cada um):
${refs || '(nenhum identificado na leitura)'}

O QUE PROCURAR
- "jurisprudencia": de 2 a 6 decisões do STF, do STJ, do TCU ou de tribunais superiores sobre regra análoga. Identifique tribunal, órgão julgador, classe e número, relator e data. Diga O QUE A DECISÃO DECIDIU, por que interessa aqui e ONDE A ANALOGIA PARA (o que o caso tinha de diferente). Não atribua à decisão conclusão que ela não tomou. Se não tiver certeza do número ou do relator, não inclua.
- "normas": leis, decretos, portarias e resoluções em vigor que já disciplinam a matéria ou serão afetados, com o que cada um dispõe.
- "dados": números oficiais ou de estudo que dimensionem quem é afetado, quanto custa, quanto se arrecada ou se gasta. Diga quem produziu o número e se é parte interessada.
- "correlatas": outras proposições no Congresso sobre o mesmo tema, com a situação.
- "documentos_base": os documentos que deram origem à proposição — a consulta pública, o estudo, o relatório, a nota técnica, o grupo de trabalho. Para cada um da lista acima e para outros que encontrar: o TÍTULO COMPLETO, o órgão, a data, o que contém (número de contribuições, de propostas, conclusão principal) e o endereço onde está publicado. Se a proposição cita um estudo sem título, descubra qual é. Se não localizar, diga em "avisos".
- "alcance": QUEM, PELO NOME, é alcançado pelos critérios do texto. Se o texto fixa um critério objetivo (faturamento, porte, número de usuários, setor), procure os dados públicos mais recentes de cada grupo, empresa, ente ou categoria que provavelmente o supera e liste um por um, com o número e a fonte. Inclua nacionais e estrangeiros. Só liste quem tiver número publicado; os demais vão para "avisos" ("receita no Brasil não divulgada"). Se o critério não permite nomear (alcança pessoas físicas em geral, por exemplo), procure a estimativa oficial de quantos são.

${PE5_REGRAS_PESQUISA}

O QUE DEVOLVER
{
 "jurisprudencia": [ { "id": "R1", "tribunal": "STF, Plenário", "processo": "ADI 0000", "relator": "Min. …", "data": "dd/mm/aaaa", "decidiu": "…", "pertinencia": "…", "limite": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "normas": [ { "id": "M1", "norma": "…", "o_que_disciplina": "…", "relacao": "como se liga ao texto", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "dados": [ { "id": "F1", "dado": "…", "valor": "…", "quem_produziu": "…", "data_ref": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "correlatas": [ { "id": "K1", "proposicao": "PL 0000/0000", "casa": "…", "situacao": "…", "relacao": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "documentos_base": [ { "id": "Y1", "documento": "título completo", "orgao": "…", "data": "dd/mm/aaaa", "o_que_e": "o que é, o que contém e como se liga à proposição", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "alcance": [ { "id": "Z1", "grupo": "nome", "atividade": "…", "piso": "qual critério do texto supera", "dado": "o número, com o período a que se refere", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "avisos": [ "dado importante que não existe em fonte pública; decisão citada no debate e não localizada; documento-base não encontrado" ]
}

${PE5_SO_JSON}`;
}

function pe5PromptCongresso({ identificacao, ementa, leitura, coleta, hoje }) {
  const fase = coleta?.fase || {};
  const outra = fase.codigo === 'senado' ? 'a Câmara dos Deputados, se o Senado alterar o texto' : fase.revisao ? 'a sanção ou a promulgação' : 'o Senado Federal';
  const pontos = (leitura?.achados || []).filter(a => a.gravidade === 'alta' || /^(1|1B)$/.test(String(a.lente))).map(a => `- ${a.questao} (${a.dispositivo})`).join('\n');
  return `Pesquise na internet três coisas sobre a proposição abaixo: o HISTÓRICO do tema no Congresso Nacional, o que ESPERA a matéria na próxima etapa (${outra}) e os SINAIS DE JUDICIALIZAÇÃO.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO:
${pe5FatosDoTexto(leitura)}

TRAMITAÇÃO:
${pe5ResumoColeta(coleta)}

PONTOS JURÍDICOS QUE A LEITURA DESTACOU (procure se alguém já os contesta em juízo ou anuncia que contestará):
${pontos || '(nenhum)'}

O QUE PROCURAR
- "historico": as tentativas ANTERIORES de legislar sobre o mesmo assunto, na Câmara e no Senado: projetos arquivados, rejeitados, vetados, medidas provisórias que perderam a eficácia, textos aprovados em uma Casa e parados na outra, comissões especiais e CPIs que trataram do tema. Para cada uma: a proposição com número e ano, o autor, o que propunha em relação ao texto atual, o desfecho e — o mais importante — POR QUE não avançou ou como terminou, segundo a fonte. Inclua as proposições em andamento que disputam o mesmo espaço. De 3 a 8 itens; se o tema é novo no Congresso, diga em "avisos".
- "outra_casa": o que espera a matéria em ${outra}: proposições correlatas que já tramitam lá e em que comissão estão; as comissões por onde matéria desse tipo costuma passar; declarações de presidente da Casa, líderes, relator provável ou senadores e deputados que já se posicionaram; calendário anunciado; acordos ou compromissos públicos de alteração do texto. Só o que tiver fonte; não suponha tramitação.
- "judicializacao": sinais concretos de que a lei, se aprovada, será levada ao Judiciário: (a) ação em curso no STF ou em tribunal superior contra lei de teor parecido (federal, estadual ou a própria lei que o texto altera), com classe, número, relator e situação; (b) partido, confederação, entidade de classe ou órgão que ANUNCIOU que irá questionar o texto, ou que tem legitimidade (art. 103 da Constituição) e já se manifestou contra; (c) parecer jurídico público (consultoria legislativa, órgão do governo, Ministério Público, entidade) que aponte vício no texto; (d) lei análoga, no Brasil, que foi suspensa ou derrubada. Diga o dispositivo ou o tema visado e o fundamento alegado. Registre o que as fontes dizem; NÃO conclua que o texto é inconstitucional. Se não houver sinal localizado, devolva a lista vazia e diga em "avisos" o que procurou.

${PE5_REGRAS_PESQUISA}

O QUE DEVOLVER
{
 "historico": [ { "id": "H1", "proposicao": "PL 0000/0000", "casa": "Câmara | Senado | Congresso", "ano": "aaaa", "autor": "…", "o_que_propunha": "…", "desfecho": "em tramitação | arquivada | rejeitada | vetada | perdeu a eficácia | aprovada em uma Casa | virou lei", "por_que": "o que travou ou decidiu, segundo a fonte", "data": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "outra_casa": [ { "id": "N1", "assunto": "proposição correlata | comissões | posição de parlamentar | calendário | acordo", "o_que": "…", "quem": "…", "data": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "judicializacao": [ { "id": "L1", "sinal": "ação em curso | anúncio de questionamento | parecer que aponta vício | lei análoga suspensa ou derrubada", "quem": "…", "alvo": "dispositivo ou tema do texto", "fundamento": "o que se alega, com o artigo da Constituição", "situacao": "…", "data": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "avisos": [ "o que procurou e não encontrou" ]
}

${PE5_SO_JSON}`;
}

// ------------------------------------------------------------------------------------------------
// 5. REDAÇÃO (duas chamadas: o que é descrição, depois o que é análise)
// ------------------------------------------------------------------------------------------------
function pe5Base({ leitura, pesquisa, coleta, alteracoes, cambio, leiIntegral }) {
  const j = o => JSON.stringify(o);
  const alt = (alteracoes || []).map(a => `- ${a.dispositivo}: ${a.novo ? 'NÃO EXISTE HOJE (dispositivo novo)' : a.vigente ? `hoje: ${String(a.vigente).slice(0, 900)}` : 'texto vigente não obtido'}`).join('\n');
  return `=== BASE ===
[G] DADOS DO PROGRAMA (tramitação, votações, bancada). Referência: "G".
${pe5ResumoColeta(coleta)}

LEITURA DOS DOCUMENTOS (itens conferidos pelo programa; ids B, A, V, E, J, S, C, T, U, X):
${j(leitura || {})}

LEI VIGENTE, artigo por artigo (lida pelo programa):
${alt || '(nenhum artigo de lei vigente identificado)'}

PESQUISA DO DEBATE (ids Q e D; fonte da internet, não conferida pelo programa):
${j(pesquisa?.debate || {})}

PESQUISA INTERNACIONAL (ids W; fonte da internet):
${j(pesquisa?.internacional || {})}

PESQUISA DE CONTEXTO (ids R, M, F, K, Y, Z; fonte da internet):
${j(pesquisa?.contexto || {})}

PESQUISA DO CONGRESSO (ids H: histórico do tema; N: o que espera a matéria na próxima etapa; L: sinais de judicialização; fonte da internet):
${j(pesquisa?.congresso || {})}

${leiIntegral ? `LEI EM VIGOR, TEXTO INTEGRAL (lido pelo programa; use para verificar se a lei atual já tem regra parecida e cite o artigo):\n${leiIntegral}\n\n` : ''}CÂMBIO DO BANCO CENTRAL${cambio?.data ? ` em ${cambio.data}` : ''} (reais por unidade da moeda): ${cambio?.taxas ? Object.entries(cambio.taxas).map(([m, v]) => `${m} ${v}`).join('; ') : 'não obtido — não converta valores'}
=== FIM DA BASE ===`;
}

const PE5_REGRA_EV = 'Cada bloco tem o campo "ev": a lista dos identificadores da base que sustentam o que o bloco afirma (por exemplo ["B2","T5"], ou ["G"] para dado de tramitação). Bloco sem "ev" é tratado como sem base. Não invente identificador.';

function pe5PromptRedacao1(ctx) {
  return `Você vai escrever a primeira metade de um parecer técnico para a assessoria de uma liderança partidária na Câmara dos Deputados: A MATÉRIA, O DEBATE e A EXPERIÊNCIA INTERNACIONAL. O leitor é o analista que vai orientar o parlamentar; ele precisa do máximo de informação útil, organizada e sem repetição.

MATÉRIA: ${ctx.identificacao}
DATA DE HOJE: ${ctx.hoje}

Escreva SÓ com o que está na base abaixo. O programa imprime por conta própria: a linha do tempo da tramitação, o placar das votações e o voto da bancada, a tabela "o que muda na legislação" e os links das fontes. Não repita essas tabelas em texto: use os fatos delas quando ajudarem a explicar.

${PE5_ESTILO}

${PE5_REGRA_EV}

${pe5Base(ctx)}

O QUE DEVOLVER
{
 "materia": {
   "faz": [ { "titulo": "…", "dispositivos": "arts. …", "texto": "explicação completa desse conjunto de regras, em linguagem comum: o que muda para quem, prazos, valores, quem decide", "ev": ["B1"] } ],
   "origem": [ { "texto": "um parágrafo por etapa: quem propôs e por quê; por onde tramitou; o que o relator apresentou; o que está pendente", "ev": ["J1","G"] } ],
   "versoes": [ { "tema": "…", "original": "…", "atual": "…", "efeito": "o que a mudança significa na prática", "ev": ["V1"] } ],
   "documentos": [ { "documento": "título completo e número", "o_que_e": "o que é, quem produziu, quando, o que contém e que papel tem na proposição", "onde": "onde está publicado ou em que documento vem anexo", "ev": ["U1","Y1"] } ],
   "contexto": [ { "titulo": "…", "texto": "o que já existe hoje sobre o assunto, outras proposições, fatores externos relevantes", "ev": ["M1"] } ],
   "historico": [ { "proposicao": "PL 0000/0000 (Casa)", "ano": "aaaa", "o_que_propunha": "o que propunha, comparado ao texto atual", "desfecho": "como terminou ou onde está", "por_que": "por que não avançou ou o que decidiu", "ev": ["H1"] } ]
 },
 "debate": {
   "posicoes": [ { "texto": "um parágrafo de texto corrido sobre UM ator", "ev": ["Q1"] } ],
   "lados": {
     "apoia": { "argumento": "um parágrafo: quem são os defensores, pelo nome, e o argumento deles no seu melhor", "evidencia": "um parágrafo: o que o texto em votação, a lei vigente e os dados mostram sobre esses argumentos", "ev": ["Q1","B2"] },
     "opoe": { "argumento": "um parágrafo: quem são os críticos, pelo nome, e o argumento deles no seu melhor", "evidencia": "um parágrafo: o que o texto em votação, a lei vigente e os dados mostram sobre essas objeções", "ev": ["Q7","V1"] }
   },
   "controversias": [ { "questao": "pergunta em disputa", "dispositivos": "arts. … ou —",
       "favor": [ { "argumento": "…", "quem": "quem sustenta", "evidencia": "o que apresenta como prova, ou \\"Não apresentada na fonte.\\"" } ],
       "contra": [ { "argumento": "…", "quem": "…", "evidencia": "…" } ],
       "estado": "como a questão está resolvida, ou não, no texto em votação", "ev": ["Q1","Q7","V1"] } ],
   "da_analise": [ { "lado": "favorável | contrário", "argumento": "argumento relevante que decorre do texto ou da comparação internacional e que NENHUM ator levantou", "ev": ["T5","W1"] } ]
 },
 "internacional": {
   "jurisdicoes": [ { "lugar": "…", "norma": "nome e desde quando vale", "regra": "como é a regra e quem alcança", "aconteceu": "o que aconteceu, com datas e números", "criticas": "as críticas dos dois lados, ou a frase de que nenhuma foi localizada nas fontes lidas", "ev": ["W1"] } ],
   "comparativo": { "colunas": ["Brasil (texto em votação)", "…"], "linhas": [ { "parametro": "…", "valores": ["…"] } ] },
   "licoes": [ { "texto": "o que a experiência dos outros permite concluir", "ev": ["W2"] } ],
   "limites": [ "onde a comparação não vale e o que ela não permite afirmar" ]
 }
}

ORIENTAÇÕES POR SEÇÃO
- "faz": cubra o texto inteiro, em 4 a 9 blocos. Comece pelo que muda de mais importante. Explique o mecanismo, não transcreva artigos.
- "origem": nomeie os documentos (a exposição de motivos com o número, a consulta, o estudo). Diga expressamente o que NÃO foi lido (relatório, voto, estudo citado), quando a leitura registrar a ausência, e por quê.
- "documentos": a relação taxativa dos documentos que embasam a proposição, para consulta posterior: o texto original, a justificativa ou exposição de motivos, cada consulta, estudo, relatório ou nota que a leitura (ids U) e a pesquisa (ids Y) identificaram, o parecer e o substitutivo. Título completo, como está na base. Documento que foi localizado e não lido leva essa informação em "o_que_e".
- "historico": uma linha por tentativa anterior de legislar sobre o tema (ids H), da mais antiga para a mais recente, terminando nas que estão em andamento. Em "por_que", o motivo que a fonte dá; se a fonte não diz, escreva "A fonte lida não informa o motivo.". Não repita aqui as proposições já explicadas em "contexto": se uma delas é a principal concorrente, ela fica aqui, e "contexto" trata do resto.
- "versoes": uma linha por mudança relevante entre o texto anterior e o texto em votação. Omita a seção se houver uma versão só.
- "controversias": é o coração do parecer. Para cada pergunta em disputa, os argumentos de um lado e do outro, com QUEM sustenta e QUE EVIDÊNCIA apresenta. Argumento sem evidência na fonte leva "Não apresentada na fonte.". Se um lado não tem argumento localizado, deixe a lista vazia. Em "estado", diga o que o texto em votação fez com a questão e o que ficou em aberto. Quando dois críticos se contradizem, diga.
- "posicoes" (seção "Quem se posicionou e como"): TEXTO CORRIDO, um parágrafo por ator da pesquisa do debate — governo e autor, relator, órgãos públicos, entidades de classe, setor regulado, sociedade civil, academia, parlamentares, governos e parlamentares estrangeiros. Cada parágrafo diz, em prosa: quem é o ator e o que ou quem representa (para entidade, os associados); a posição (favorável, favorável com ressalvas, contrário com ressalvas, contrário); sobre qual texto fala (o original ou o texto em votação); por que meio e em que data se manifestou (exposição de motivos, carta, nota, estudo, declaração a tal veículo); e o que defende, com TODOS os argumentos que a pesquisa registra e a evidência que apresenta (estudo, número, exemplo). Sempre atribuído: "a entidade sustenta que…", "segundo a empresa…". Nome completo da entidade, com a sigla. Não avalie o argumento aqui e não use tabela, lista nem tópicos. Comece pelos favoráveis (governo, relator, apoiadores) e siga para os contrários. Quem não se manifestou não ganha parágrafo: feche com um parágrafo dizendo quem, entre os diretamente afetados, NÃO teve manifestação localizada nas fontes pesquisadas. Todo ator da pesquisa (ids Q) aparece em algum parágrafo.
- "lados" (seção "Os dois lados"): dois parágrafos por lado. Em "argumento", o melhor argumento do lado, nomeando quem o sustenta. Em "evidencia", o que o texto e os documentos mostram sobre o que esse lado afirma, ponto por ponto e com o artigo: o que se confirma; o que se confirma só em parte, e qual parte; o que o texto em votação ou a lei vigente contradizem; o que o substitutivo já atendeu; o que não há dado para verificar; e o que é divergência de mérito, que o texto não resolve. Se um argumento foi feito sobre a versão original e o texto em votação mudou a regra, diga. Avalia-se o ARGUMENTO, não a proposição: não diga quem tem razão no mérito nem se o texto deve ser aprovado.
- "da_analise": de 2 a 5 argumentos que a leitura do texto ou a comparação internacional sustentam e que ninguém levantou. São da assessoria e serão impressos como tal.
- "jurisdicoes": um bloco por país, mais um bloco para os que recuaram ou adiaram, se houver.
- "comparativo": a primeira coluna é sempre o Brasil. De 5 a 8 linhas com os parâmetros que permitem comparar (como funciona, quem é alcançado, duração, sanção, resultado até agora). Valor em moeda estrangeira vem acompanhado da conversão em reais pelo câmbio da base, com "cerca de".
- "licoes" e "limites": seja específico. Diga o que NÃO se pode concluir.
- Seção sem conteúdo na base: devolva a lista vazia. Não preencha com generalidades.

${PE5_SO_JSON}`;
}

function pe5PromptRedacao2(ctx) {
  const fase = ctx.coleta?.fase || {};
  return `Você vai escrever a segunda metade de um parecer técnico para a assessoria de uma liderança partidária na Câmara dos Deputados: A ANÁLISE TÉCNICA, OS CAMINHOS e A ABERTURA (o resumo da primeira página). A primeira metade já está escrita e vem abaixo: NÃO repita o que ela já diz; refira-se aos temas sem recontá-los.

MATÉRIA: ${ctx.identificacao}
DATA DE HOJE: ${ctx.hoje}
FASE DA TRAMITAÇÃO (do programa): ${fase.descricao || '?'}${fase.jaVotadaNaCamara ? ' ATENÇÃO: a Câmara JÁ VOTOU. As opções não podem ser "aprovar" ou "rejeitar" na Câmara; trate do que ainda pode acontecer.' : ''}${fase.revisao ? ' ATENÇÃO: a Câmara só delibera sobre o que o Senado alterou.' : ''}

${PE5_ESTILO}

${PE5_REGRA_EV}

${pe5Base(ctx)}

PRIMEIRA METADE, JÁ ESCRITA:
${JSON.stringify(ctx.parte1 || {})}

O QUE DEVOLVER
{
 "analise": {
   "lentes": [ { "lente": "nome do campo (Constitucional, Orçamentário-financeiro, …)", "pontos": [ { "questao": "título curto do ponto", "dispositivo": "art. …", "gravidade": "alta | media | baixa",
       "exame": "o que o texto faz e por que isso merece atenção", "objecao": "o melhor argumento em sentido contrário", "saida": "o que resolveria: informação a pedir, emenda, pergunta", "ev": ["T1"] } ] } ],
   "sem_achado": [ "campos examinados em que não há ponto a registrar" ],
   "jurisprudencia": [ { "processo": "tribunal, classe e número, órgão, relator, data", "decidiu": "…", "pertinencia": "…", "limite": "…", "ev": ["R1"] } ],
   "judicializacao": [ { "alvo": "dispositivo ou tema que pode ser questionado", "quem": "quem tem legitimidade e interesse para questionar, e se já se manifestou", "fundamento": "o que seria alegado, com o artigo da Constituição ou da lei", "sinal": "o que existe de concreto: ação em curso, anúncio, parecer, precedente; ou \"Nenhum sinal localizado nas fontes pesquisadas.\"", "reduz": "o que reduziria o risco: ajuste de redação, estimativa, regra de transição", "ev": ["T1","L1","R1"] } ],
   "impacto": { "fiscal": [ { "texto": "…", "ev": ["S1"] } ], "economico": [ { "texto": "…", "ev": ["F1"] } ], "implementacao": [ { "texto": "o que depende de regulamento, de nomeação, de orçamento; prazos somados", "ev": ["B5"] } ] }
 },
 "caminhos": {
   "opcoes": [ { "opcao": "…", "consequencias": "o que acontece se esse for o caminho", "ev": ["V1"] } ],
   "emendas": [ { "dispositivo": "art. …", "problema": "o que a emenda corrige, em uma frase", "redacao": "o texto da emenda, redigido como dispositivo de lei", "ev": ["C1"] } ],
   "perguntas": [ { "a_quem": "…", "pergunta": "…", "por_que": "…" } ],
   "acompanhar": [ "fato ou data a acompanhar" ],
   "proxima_etapa": [ { "texto": "um parágrafo: o que espera a matéria depois desta votação", "ev": ["N1"] } ],
   "partido": { "texto": [ { "texto": "um parágrafo sobre a relação entre a matéria e a atuação da bancada do Podemos", "ev": ["G"] } ],
       "projetos": [ "rótulos (PL 0000/0000) dos projetos de deputados do Podemos, da lista da base, que tratam do MESMO assunto" ] }
 },
 "abertura": {
   "frase": "uma frase, até 260 caracteres: o que a proposição faz",
   "decide": "um parágrafo detalhado (de 900 a 1.600 caracteres): o que se vota agora e em que fase; qual é o texto (original, substitutivo, emendas do Senado), de quem, de quando; a escolha de fundo; e, havendo substitutivo, o que ele manteve e o que mudou em relação ao original, ponto por ponto",
   "muda": [ "de 5 a 10 itens completos: cada mudança com o nome próprio do que cria, a enumeração dos critérios ou requisitos, os números, os prazos e o artigo" ],
   "alcance": "quem é alcançado, como se chega a eles (os critérios, em ordem) e o que não se sabe; sem repetir a tabela abaixo",
   "alcancados": [ { "grupo": "nome", "piso": "qual critério supera", "dado": "o número público, com o período; valor em moeda estrangeira com a conversão", "ev": ["Z1"] } ],
   "pontos": [ { "titulo": "…", "gravidade": "alta | media | baixa", "texto": "uma frase" } ],
   "falta": [ "o que falta saber para decidir" ]
 }
}

ORIENTAÇÕES POR SEÇÃO
- "lentes": um ponto por achado relevante da leitura (ids T), agrupado por campo, do mais grave ao menos grave. Em "exame", explique; em "objecao", dê o melhor contra-argumento, inclusive regra parecida que já exista na lei vigente; em "saida", o que resolveria. Ponto que está regular (iniciativa, competência) entra uma vez, curto, com "objecao" e "saida" vazios. NÃO escreva sobre o que não se aplica: liste em "sem_achado".
- "jurisprudencia": só decisões que estão na pesquisa de contexto. Repita o que ela decidiu e o limite da analogia; não amplie o alcance da decisão.
- "judicializacao": de 0 a 6 itens. Um item para cada dispositivo que a análise apontou com gravidade alta ou média em matéria constitucional, de iniciativa, de competência, federativa ou orçamentária, e um para cada sinal da pesquisa (ids L). É exame de RISCO, não de mérito: diga onde a lei pode ser questionada depois de aprovada, por quem e com que argumento. NUNCA escreva que o dispositivo "é inconstitucional", "viola" ou "ofende" a Constituição: escreva "pode ser questionado com base em…", "a tese contrária é…". Em "quem", só legitimado do art. 103 da Constituição, parte diretamente atingida ou quem a pesquisa registra; não suponha intenção. Se não há ponto com esse perfil, devolva a lista vazia.
- "impacto": fiscal (estimativa oficial, ou a ausência dela e a quem pedir), econômico (quem paga, quem ganha, com os números da base e quem os produziu), implementação.
- "opcoes": as que existem NA FASE ATUAL, inclusive adiar, emendar e destacar, quando couber. Para cada uma, a consequência concreta. Sem recomendar.
- "emendas": de 2 a 7, só para problema apontado na análise. Redija o dispositivo de verdade, na técnica da lei que se altera. Onde a escolha for política (um número, um prazo), deixe entre colchetes.
- "proxima_etapa": de 1 a 4 parágrafos com o que a pesquisa (ids N) registra sobre a etapa seguinte: proposições correlatas que já tramitam lá, comissões, quem já se posicionou, calendário, compromissos de alterar o texto. Só o que está na base; sem a pesquisa, devolva a lista vazia. Não estime votos.
- "partido": de 1 a 4 parágrafos, só com os dados do bloco "O PODEMOS E A MATÉRIA" e das votações. Diga: como a bancada votou nesta matéria e quem divergiu; se deputado do partido é autor, relator ou apresentou requerimento, emenda ou destaque, e o que pedia; quais projetos de deputados do partido tratam do mesmo assunto e se vão na MESMA direção do texto em votação, em direção DIFERENTE ou tratam de aspecto que o texto não cobre (explique com a ementa); e como a bancada votou nas proposições correlatas. A lista de projetos vem de busca por palavra e traz itens sem relação: cite e inclua em "projetos" SÓ os que tratam do mesmo assunto; se nenhum tratar, diga que a busca não localizou projeto da bancada sobre o tema. É registro de coerência, não orientação: não diga como a bancada deve votar.
- "perguntas": o que o parlamentar pode perguntar ao governo, ao relator ou ao órgão executor para obter o que falta.
- "abertura": escreva por último. É o único lugar onde se resume o que já foi dito — mas resumo DETALHADO: quem lê só a abertura tem de sair sabendo o que o texto cria, com os nomes. Órgão, cargo ou unidade novos vão com o NOME COMPLETO que o texto lhes dá e com a posição que ocupam na estrutura (não "uma unidade": "a Superintendência …, novo órgão do …"). Lista de critérios, requisitos ou condições vai ENUMERADA por inteiro (não "seis características": as seis). Em "decide", se o texto em votação é um substitutivo ou veio alterado da outra Casa, diga o que ele mudou.
- "alcancados": se a pesquisa de contexto trouxe "alcance" (ids Z), liste TODOS, pelo nome, com o dado. Nunca escreva que o texto "alcança também" alguém sem dizer quem. Se não há como nomear, diga em "alcance" por quê e dê a estimativa de quantidade que houver.
- "pontos": de 3 a 6, os que mais pesam, com a mesma gravidade usada na análise.

${PE5_SO_JSON}`;
}

// ------------------------------------------------------------------------------------------------
// 6. REVISÃO
// ------------------------------------------------------------------------------------------------
function pe5PromptRevisao(ctx) {
  return `Você é o revisor de um parecer técnico legislativo. Leia o parecer abaixo procurando ERROS, contra a base que o acompanha. Não reescreva o parecer: devolva só correções pontuais.

MATÉRIA: ${ctx.identificacao}

PROCURE
1. Afirmação que a base não sustenta, ou que diz mais do que a base diz.
2. Número, prazo, data, nome ou artigo diferente do que está na base.
3. Decisão judicial ou experiência estrangeira a que se atribui conclusão que a fonte não traz.
4. Argumento atribuído a quem não o sustentou, ou posição trocada (favorável por contrário).
5. Fato da tramitação que contradiz os dados do programa [G].
6. Informação repetida em mais de uma seção (indique a repetição a remover).
7. Frase que recomenda voto, juridiquês, termo interno ("cenário", "lente", "achado") ou identificador da base no meio do texto.
8. Afirmação de ausência ("não há", "não consta") sem dizer onde se procurou.
9. Emenda cuja redação não corrige o problema apontado, ou que cita dispositivo inexistente.
10. Em "Os dois lados", avaliação de argumento ("confirma-se", "procede", "não procede"…) que o texto em votação ou a lei vigente não sustentam, ou feita contra a versão errada do texto.
11. Afirmação de que um dispositivo "é inconstitucional" ou "viola" a Constituição feita pelo próprio parecer (só se relata decisão já tomada ou alegação atribuída a alguém).
12. Projeto de deputado do Podemos citado como relacionado sem tratar do mesmo assunto, ou voto da bancada diferente do que está nos dados do programa.
13. Nome genérico onde a base traz o nome próprio (órgão, documento, estudo, entidade), ou enumeração anunciada e não feita ("seis critérios" sem dizer quais).

${pe5Base(ctx)}

PARECER A REVISAR:
${JSON.stringify(ctx.doc || {})}

O QUE DEVOLVER
{ "correcoes": [ { "trecho": "cópia EXATA de um pedaço do parecer (de 5 a 40 palavras), suficiente para localizá-lo", "novo": "o texto que deve entrar no lugar; vazio para apenas remover o trecho", "motivo": "o erro, em uma frase" } ],
  "observacoes": [ "problema que não se resolve trocando um trecho (seção que falta, lado do debate sem argumento, fonte fraca)" ] }
Se não houver erro, devolva { "correcoes": [], "observacoes": [] }. Não proponha mudança de estilo que não corrija erro.

${PE5_SO_JSON}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PE5_ESTILO, pe5ResumoColeta, pe5PromptLeitura, pe5PromptDebate, pe5PromptInternacional, pe5PromptContexto, pe5PromptCongresso, pe5Base, pe5PromptRedacao1, pe5PromptRedacao2, pe5PromptRevisao };
}
