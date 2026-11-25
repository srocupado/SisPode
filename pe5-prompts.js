// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Parecer de Especialista (refeito em 17/11/2026) — OS PROMPTS.
//
// Doze chamadas (eram oito até 21/11/2026), cada uma com um trabalho só e saída em JSON:
//   leitura        duas, em paralelo: o texto em votação (o que faz, o que muda, os achados) e os documentos de
//                  apoio (argumentos, estimativas, emendas, o que ficou sem resposta), com trecho literal de cada item
//   debate         duas, uma para cada lado: quem defende e quem critica, e o que argumentam (internet)
//   internacional  pesquisa o que outros países fizeram e o que aconteceu (internet)
//   contexto       pesquisa decisões judiciais, normas existentes, dados e proposições correlatas (internet)
//   congresso      pesquisa o histórico do tema no Congresso e os sinais de judicialização (internet)
//   redacao        quatro: a matéria e o debate (em paralelo), a análise, os caminhos e a abertura — em blocos
//                  por seção, só com o que está na base
//   revisao        recebe o que a conferência do programa apontou, lê o documento como adversário e devolve
//                  correções e acréscimos pontuais
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
- Sigla só depois do nome por extenso, na primeira vez em que aparece em cada seção: "Fundo Constitucional do Distrito Federal (FCDF)". Sigla que só o especialista conhece não se usa sozinha: escreva "relatório bimestral de avaliação de receitas e despesas", "Consultoria de Orçamentos do Senado", "termos de execução descentralizada".
- Tamanho: a nota inteira deve ficar perto de 60 páginas, e cada chamada tem um teto de palavras (bloco TAMANHO, no fim). Cumpra o teto cortando REPETIÇÃO e explicação que já está em outra seção — nunca cortando fato, número, nome, data ou argumento. O que é secundário entra como aposto ou em enumeração, na frase de um ponto vizinho. Não explique de novo, em outra seção, um mecanismo já explicado: refira-se a ele pelo artigo.
- Profundidade: explique o MECANISMO (o que dispara a regra, quem decide, quanto, até quando, o que acontece depois) e a consequência prática para quem é atingido. Frase curta não é texto raso: prefira mais frases curtas a menos informação.
- Aspas só para citação literal curta que esteja na base.
- O documento que você escreve se chama Nota Técnica Analítica (NTA). Para se referir a ele, escreva "esta nota"; nunca "este parecer". A palavra "parecer" fica reservada aos pareceres da tramitação (do relator, de comissão, de entidade).`;

const PE5_SO_JSON = 'Responda APENAS com o JSON, sem texto antes ou depois e sem cercas de código.';

function pe5ResumoColeta(G) {
  if (!G) return '(dados de tramitação não obtidos)';
  const L = [];
  const pr = G.proposicao || {};
  L.push(`Proposição: ${pr.sigla} ${pr.numero}/${pr.ano}. Autor(es): ${(pr.autores || []).join('; ') || 'não informado'}${pr.totalAutores > (pr.autores || []).length ? ` e mais ${pr.totalAutores - pr.autores.length}` : ''}. Apresentada em ${pr.apresentacao || '?'}.`);
  L.push(`Fase: ${G.fase?.descricao || '?'}`);
  L.push(`Situação registrada em ${G.status?.data || '?'}: ${G.status?.situacao || '?'} (${G.status?.orgao || '?'}). ${G.status?.despacho || ''}`);
  const u = G.urgencia || {};
  L.push(u.tem ? `Regime: ${u.tipo}${u.aprovadaEm ? `, aprovada em ${u.aprovadaEm}` : ''}. ${u.requerimento || ''}` : `Regime: sem urgência aprovada (${u.regime || 'regime não informado'}).${u.pedidaEm ? ` Requerimento de urgência apresentado em ${u.pedidaEm} e ainda não votado: ${u.requerimento || ''}` : ''}`);
  const S = G.senado;
  if (S) {
    L.push(`NO SENADO FEDERAL (dados abertos do Senado, lidos pelo programa; são fatos): ${S.identificacao}${S.autor ? `, de ${S.autor}` : ''}${S.casaIniciadora ? `; Casa iniciadora: ${S.casaIniciadora}` : ''}. Situação: ${S.situacao || '?'}${S.dataSituacao ? ` (${S.dataSituacao})` : ''}.${S.deliberacao ? ` Deliberação: ${S.deliberacao.tipo}, em ${S.deliberacao.data}${S.deliberacao.destino ? ` — ${S.deliberacao.destino}` : ''}.` : ''}`);
    if ((S.relatores || []).length) L.push(`  Relator(es) no Senado: ${S.relatores.map(r => `${r.nome} (${r.partido}-${r.uf})${r.colegiado ? `, ${r.colegiado}` : ''}${r.designadoEm ? `, designado em ${r.designadoEm}` : ''}`).join('; ')}.`);
    for (const v of S.votacoes || []) L.push(`  Votação nominal no Senado em ${v.data}: ${v.descricao} Resultado: ${v.resultado}. Placar: ${v.sim} sim, ${v.nao} não${v.abstencao ? `, ${v.abstencao} abstenção(ões)` : ''}.`);
    if ((S.andamentos || []).length) L.push('  Andamentos no Senado:\n' + S.andamentos.map(a => `    ${a.data}${a.orgao ? ` ${a.orgao}` : ''} — ${a.texto}`).join('\n'));
  }
  for (const v of (G.votacoes || []).filter(x => x.nominal)) {
    const b = v.bancada || {};
    L.push(`Votação nominal de ${v.data} (${v.orgao}): ${v.descricao} Placar ${v.sim} a ${v.nao}. Podemos: ${(b.sim || []).length} sim, ${(b.nao || []).length} não${(b.nao || []).length ? ` (não: ${b.nao.join(', ')})` : ''}. Por partido: ${(v.partidos || []).slice(0, 12).map(p => `${p.partido} ${p.sim}×${p.nao}`).join(', ')}.`);
  }
  if (G.pauta?.titulo) L.push(`Consta da pauta do Plenário registrada no SisPode: ${G.pauta.titulo}${G.pauta.data ? ` (${G.pauta.data})` : ''}.`);
  if ((G.marcos || []).length) L.push('Linha do tempo:\n' + G.marcos.map(m => `  ${m.data} ${m.orgao} — ${m.fato}`).join('\n'));
  if ((G.relacionadas || []).length) L.push(`Proposições relacionadas: ${G.relacionadas.map(r => r.rotulo).join('; ')}.`);
  const M = G.mapa;
  // O quórum vem da sigla e vale com ou sem votação anterior: na NTA do PLP 299/2026 a matéria ainda não tinha
  // sido votada na Câmara, a linha não saía e a nota não disse que eram precisos 257 votos.
  if (M && M.quorum) L.push(`Quórum para aprovar o mérito na Câmara: ${M.quorum.regra}${M.quorum.minimo ? ` (${M.quorum.minimo} votos sim)` : M.quorum.presenca ? ` (${M.quorum.presenca} presentes)` : ''}, ${M.quorum.base}.`);
  if (M && M.votacao) {
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
// A leitura pode ir em UMA chamada (matéria com um documento só) ou em DUAS, em paralelo (pe5-pipeline.js):
//   parte 'texto'  — o texto em votação: blocos, lei alterada, diferenças entre versões, achados das lentes;
//   parte 'apoio'  — pareceres, relatórios, notas e emendas: argumentos, estimativas, o que ficou sem resposta.
// Medido em 21/11/2026 no PLP 299/2026 (nove documentos, 193 mil caracteres): numa chamada só, o Gemini 4
// Carbon devolveu 7 blocos e 4 argumentos e deixou de fora as estimativas não refeitas e quase tudo o que o
// relator na Câmara sustenta; o raciocínio consumiu 40 mil dos 64 mil tokens de saída.
const PE5_LEITURA_CAMPOS = {
  resumo: ` "resumo": "uma frase: o que o texto em votação faz, em linguagem comum",`,
  blocos: ` "blocos": [ { "id": "B1", "titulo": "tema do bloco", "dispositivos": "arts. …", "documento": "…", "explica": "o que esse conjunto de artigos faz, em 3 a 8 frases, cobrindo regras, valores, percentuais, prazos, quem decide, o que fica para ato do Executivo e as exceções", "trecho": "…" } ],`,
  alteracoes: ` "alteracoes": [ { "id": "A1", "dispositivo": "art. 9º da Lei nº 12.529/2011", "tipo": "altera | acrescenta | revoga", "documento": "…", "muda": "o que muda, em 1 a 2 frases", "trecho": "…" } ],`,
  versoes: ` "versoes": [ { "id": "V1", "tema": "…", "antes": "como era no texto anterior", "depois": "como ficou no texto em votação", "trecho_antes": "…", "documento_antes": "…", "trecho_depois": "…", "documento_depois": "…" } ],`,
  emendas: ` "emendas": [ { "id": "E1", "rotulo": "…", "autor": "…", "muda": "…", "destino": "acolhida | rejeitada | parcialmente acolhida | sem deliberação", "documento": "…", "trecho": "…" } ],`,
  justificativa: ` "justificativa": [ { "id": "J1", "quem": "autor | relator (diga de qual Casa ou comissão) | consultoria | outro", "objetivo": "o que essa pessoa ou órgão diz que a proposta pretende, o argumento que usa ou a resposta que dá a uma crítica", "responde_a": "a crítica ou dúvida a que responde; omita se não responde a nenhuma", "documento": "…", "trecho": "…" } ],`,
  estimativas: ` "estimativas": [ { "id": "S1", "o_que": "impacto, custo, renúncia, economia, número de afetados", "valor": "como está no documento", "versao": "para qual versão do texto o número foi calculado (documento e data)", "refeita": "sim | não | não se aplica — o texto mudou, depois dessa conta, nos dispositivos a que o número se refere, e a conta foi refeita?", "depende_de": "efeito automático da lei | depende de ato facultativo do Executivo | depende de regulamento | não informado", "documento": "…", "trecho": "…" } ],`,
  controversias: ` "controversias": [ { "id": "C1", "questao": "ambiguidade, contradição interna ou ponto que o próprio documento registra como disputado", "explica": "…", "documento": "…", "trecho": "…" } ],`,
  achados: ` "achados": [ { "id": "T1", "lente": "número da lente", "questao": "o ponto, em uma frase", "dispositivo": "art. …", "porque": "por que merece exame, em 1 a 3 frases, só com o que está no texto", "documento": "…", "trecho": "…", "gravidade": "alta | media | baixa" } ],`,
  referencias: ` "referencias": [ { "id": "U1", "nome": "nome COMPLETO do documento, como está escrito (consulta pública, estudo, relatório, nota técnica, exposição de motivos, parecer, acórdão, tratado)", "o_que_e": "o que é e para que o texto o invoca, em 1 a 2 frases", "documento": "…", "trecho": "…" } ],`,
  ausencias: ` "ausencias": [ { "id": "X1", "o_que": "o que se esperaria encontrar e não está", "onde_procurou": "em quais documentos" } ],`,
  vigencia: ` "vigencia": { "clausula": "quando entra em vigor", "documento": "…", "trecho": "…" },`,
  termos_de_busca: ` "termos_de_busca": [ "de 3 a 5 termos de UMA palavra cada (substantivo específico do assunto, sem artigo nem preposição), com que a Câmara indexaria outras proposições sobre o mesmo tema" ]`,
};
const PE5_LEITURA_ORIENTA = {
  blocos: `- "blocos": cubra o texto em votação INTEIRO, agrupado por tema (de 6 a 16 blocos). Um bloco por tema: não junte temas diferentes para encurtar. Quem lê os blocos tem de saber tudo o que o texto faz, com cada valor, percentual, prazo e exceção.`,
  alteracoes: `- "alteracoes": uma entrada por artigo ou grupo contíguo de artigos de lei em vigor que o texto altera, acrescenta ou revoga. Escreva o dispositivo com o nome da lei por extenso, o número e o ano ("art. 14 da Lei Complementar nº 235/2026", nunca "LC 235/2026"): o programa usa esse nome para buscar o texto vigente. Uma lei por entrada.`,
  versoes: `- "versoes": só se houver mais de uma versão entre os documentos (original e substitutivo, texto da Câmara e do Senado). Uma entrada por diferença relevante, inclusive a exceção que ficou mais estreita ou mais larga do que a emenda que a originou. Se o texto novo criou algo que não existia, deixe "trecho_antes" vazio.`,
  achados: `- "achados": percorra as lentes abaixo. Registre o que merece exame E TAMBÉM o que está regular quando isso for relevante para quem decide (por exemplo, iniciativa correta). Não registre pergunta que não se aplica à matéria. Um mesmo problema entra uma vez, na lente mais apropriada. Não há número máximo: não deixe um ponto de fora para encurtar a resposta.
- Em todo texto, examine também, e registre como achado quando ocorrer:
  (a) o que o texto deixa para ato do Executivo ("poderá", "ato do Poder Executivo", "regulamento"): diga o que fica fora da lei (percentual, prazo, critério, quem escolhe, destino do dinheiro ou do crédito);
  (b) efeito que depende de decisão facultativa: se a regra é opção e não obrigação, o resultado anunciado depende de ela ser usada;
  (c) para CADA limite, teto, corte ou adiamento que o texto cria, um por um, responda às quatro perguntas — quando começa; quando termina; o valor é corrigido (por qual índice); o que acontece com o que passar do limite. Toda resposta "o texto não diz" é achado, mesmo que nenhum documento a levante. Quando o texto ADIA pagamento, entrega ou repasse (diferimento, recomposição, parcelamento), a pergunta sobre a correção vale para o valor ADIADO: quantia nominal paga anos depois vale menos, e o silêncio do texto sobre isso tem de ser registrado;
  (d) falha de redação ou de remissão (dispositivo que remete a outro que não existe, parágrafo sem sentido completo, ementa que não cobre o conteúdo): lente 0, gravidade baixa.`,
  emendas: `- "emendas": as que os documentos descrevem, com o destino que o relator deu a cada uma. Emendas iguais podem ir juntas, com os números de todas no rótulo.`,
  justificativa: `- "justificativa": para CADA documento que seja justificativa, relatório, parecer, voto ou nota técnica, registre os argumentos distintos que ele traz (em geral de 3 a 8 por documento), cada um com o trecho. O parecer MAIS RECENTE tem prioridade: registre cada resposta que ele dá a uma crítica, com "responde_a".`,
  estimativas: `- "estimativas": TODO número de impacto, custo, renúncia, economia ou alcance que os documentos trazem. Em "versao" e "refeita", confira as datas: número calculado para uma versão anterior, quando o texto mudou depois nos dispositivos a que ele se refere, é estimativa NÃO refeita. Em "depende_de", diga se o efeito é automático ou depende de ato facultativo.`,
  controversias: `- "controversias": o que os próprios documentos registram como disputado — crítica de consultoria ou de nota técnica, emenda rejeitada com justificativa, voto vencido, ressalva do relator.`,
  achadosApoio: `- "achados" (sobre os DOCUMENTOS DE APOIO; use o número da lente da lista abaixo, e ids a partir de T101):
  (a) estimativa feita para versão anterior e não refeita depois de o texto mudar;
  (b) ganho, economia ou efeito anunciado em parecer ou justificativa sem dispositivo que o sustente no texto em votação;
  (c) crítica, dúvida ou lacuna registrada em um documento (nota técnica, emenda, voto) que o parecer MAIS RECENTE não responde — o trecho é a passagem desse parecer mais próxima do assunto;
  (d) afirmação de parecer ou de justificativa que o texto em votação não confirma.`,
  referencias: `- "referencias": TODO documento que a justificativa, a exposição de motivos, o relatório ou o voto invocam como base da proposta: consulta pública, tomada de subsídios, estudo, relatório de órgão, nota técnica, grupo de trabalho, decisão, norma estrangeira usada como modelo. Copie o nome e o número exatamente como aparecem. Se o texto citar "um estudo" sem dar o título, registre assim mesmo e diga que o título não consta: a pesquisa vai procurá-lo. Inclua a própria exposição de motivos, com o número.`,
  ausencias: `- "ausencias": estimativa de impacto, relatório ou voto do relator, estudo que a justificativa cita e não anexa, definição de termo central, resposta do parecer mais recente a uma crítica registrada. Diga sempre onde procurou.`,
};
const PE5_LEITURA_PARTES = {
  // uma chamada só: tudo
  '': { campos: ['resumo', 'blocos', 'alteracoes', 'versoes', 'emendas', 'justificativa', 'estimativas', 'controversias', 'achados', 'referencias', 'ausencias', 'vigencia', 'termos_de_busca'],
    orienta: ['blocos', 'alteracoes', 'versoes', 'achados', 'emendas', 'justificativa', 'estimativas', 'controversias', 'referencias', 'ausencias'], lentes: 'completas',
    abre: 'Você vai ler os documentos de uma proposição legislativa e devolver, em JSON, o que eles dizem.' },
  texto: { campos: ['resumo', 'blocos', 'alteracoes', 'versoes', 'controversias', 'achados', 'ausencias', 'vigencia', 'termos_de_busca'],
    orienta: ['blocos', 'alteracoes', 'versoes', 'achados', 'ausencias'], lentes: 'completas',
    abre: 'Você vai ler os documentos de uma proposição legislativa e devolver, em JSON, o que o TEXTO EM VOTAÇÃO faz, o que ele muda na lei e em relação às versões anteriores, e os pontos que merecem exame. Outra leitura, em paralelo, cuida dos argumentos, das estimativas e das emendas: não os registre aqui.' },
  apoio: { campos: ['emendas', 'justificativa', 'estimativas', 'controversias', 'achados', 'referencias', 'ausencias'],
    orienta: ['emendas', 'justificativa', 'estimativas', 'controversias', 'achadosApoio', 'referencias', 'ausencias'], lentes: 'lista',
    abre: 'Você vai ler os documentos de uma proposição legislativa e devolver, em JSON, o que os DOCUMENTOS DE APOIO dizem — justificativa, relatórios, pareceres, votos, notas técnicas e emendas: quem argumenta o quê, que números apresentam, o que respondem e o que deixam sem resposta. Outra leitura, em paralelo, descreve o texto em votação artigo por artigo: não o descreva aqui. Use ids a partir de C101 nas controvérsias, T101 nos achados e X101 nas ausências.' },
};
function pe5PromptLeitura({ identificacao, ementa, documentos = [], coleta = null, lentes = [], catalogo = [], textoEmVotacao = '', parte = '' }) {
  const P = PE5_LEITURA_PARTES[parte] || PE5_LEITURA_PARTES[''];
  const blocoLentes = P.lentes === 'lista'
    ? lentes.map(l => `LENTE "${l.ordem}" — ${l.rotulo}`).join('\n')
    : lentes.map(l => {
      const e = catalogo.find(x => x.chave === l.chave) || {};
      return `LENTE "${l.ordem}" — ${l.rotulo}
  Perguntas de conferência (use como roteiro; registre SÓ o que tiver resposta relevante no texto):
${(e.perguntas || []).map((p, i) => `    ${i + 1}. ${p}`).join('\n')}
  Armadilhas do campo:
${(e.armadilhas || []).map(a => `    - ${a}`).join('\n')}`;
    }).join('\n\n');
  const docs = documentos.map((d, i) => `<<<DOCUMENTO ${i + 1}: ${d.rotulo}>>>\n${d.texto}\n<<<FIM DO DOCUMENTO ${i + 1}>>>`).join('\n\n');
  const campos = P.campos.map(c => PE5_LEITURA_CAMPOS[c]).join('\n').replace(/,\s*$/, '');
  return `${P.abre} Esta etapa é só leitura: não opine, não pesquise, não use o que sabe de memória sobre a matéria.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || '(sem ementa)'}
TEXTO EM VOTAÇÃO (é ele que se analisa; os demais documentos servem para comparar): ${textoEmVotacao || documentos[0]?.rotulo || ''}

DADOS DE TRAMITAÇÃO (do sistema da Câmara${coleta && coleta.senado ? ' e do Senado' : ''}; são fatos, não os contradiga):
${pe5ResumoColeta(coleta)}

REGRA DO TRECHO LITERAL
Todo item tem o campo "trecho": de 6 a 30 palavras CONSECUTIVAS copiadas do documento indicado em "documento", sem trocar, pular nem corrigir palavra. O programa vai procurar o trecho no documento; item cujo trecho não for encontrado é descartado. Escolha um trecho curto e distintivo. O campo "documento" repete exatamente o rótulo do documento.

O QUE DEVOLVER
{
${campos}
}

ORIENTAÇÕES
${P.orienta.map(o => PE5_LEITURA_ORIENTA[o]).join('\n')}
- Se um documento estiver ilegível ou incompleto, registre em "ausencias".
- Profundidade vale mais que brevidade: esta leitura é a única vez em que os documentos são lidos; o que não for registrado aqui não chega à nota.

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
- Em "avisos", diga também o que procurou e não encontrou.
- ABRA E LEIA as páginas que a busca trouxer antes de registrar: o resumo do buscador não basta para dizer o que uma decisão decidiu, o que uma lei estrangeira exige ou o que uma entidade argumenta. Leia a decisão, a lei, a nota — a página da fonte primária, quando existir.
- As PISTAS, quando houver, são sugestões de ONDE PROCURAR, escritas antes da busca e sem consulta a fonte alguma. Pista não é fato: use-a para escolher os termos de busca e só registre o que uma página lida confirmar. Pista que a busca não confirmou vai em "avisos" ("procurado e não localizado"), nunca na lista.
- Uma busca só não basta. Faça VÁRIAS buscas, com termos diferentes: pelo número da matéria; pelo nome que a imprensa lhe dá; por cada grupo de atores ou de fontes pedido abaixo; por cada ponto sensível listado. Só pare quando as buscas novas deixarem de trazer nome ou fato novo.`;

// MÍNIMOS DA PESQUISA (25/11/2026). A NTA do PL 4675/2025 gerada pelo Sonnet 5.5 saiu com 2 países, nenhuma decisão
// judicial e 15 atores; a mesma matéria, pesquisada à mão, tinha 7 países, 4 decisões e 37 atores. Decisão da
// Liderança: 6 países, 6 decisões, 20 atores (ao menos 5 a favor e 5 contra); o que faltar é pedido de novo, em até
// três rodadas; se ainda faltar, a nota sai com aviso. A NTA é feita para matéria complexa: não há teto de custo.
const PE5_MIN_PESQUISA = { paises: 6, decisoes: 6, atores: 20, porLado: 5, rodadas: 3 };

/** De que lado o ator está: "favorável com ressalvas" conta a favor; "contrário com ressalvas", contra. */
function pe5LadoAtor(posicao) { const p = String(posicao || '').trim(); return /^favor/i.test(p) ? 'favor' : /^contr/i.test(p) ? 'contra' : 'neutro'; }
function pe5ContagemAtores(atores) {
  const c = { total: 0, favor: 0, contra: 0, neutro: 0 };
  for (const a of atores || []) { if (!a || !a.ator) continue; c.total++; c[pe5LadoAtor(a.posicao)]++; }
  return c;
}
/** O que ainda falta para os mínimos. `alguma` diz se vale uma rodada complementar. */
function pe5FaltasPesquisa({ paises = 0, decisoes = 0, atores = [], semContraste = false, faltaOrigens = [] } = {}) {
  const M = PE5_MIN_PESQUISA, c = pe5ContagemAtores(atores);
  const f = { paises: Math.max(0, M.paises - paises), decisoes: Math.max(0, M.decisoes - decisoes), atores: Math.max(0, M.atores - c.total),
    favor: Math.max(0, M.porLado - c.favor), contra: Math.max(0, M.porLado - c.contra), contraste: !!semContraste, origens: faltaOrigens || [] };
  f.alguma = !!(f.paises || f.decisoes || f.atores || f.favor || f.contra || f.contraste || f.origens.length);
  return f;
}

/**
 * ETAPA DE PISTAS (25/11/2026): antes de buscar, o modelo lista ONDE PROCURAR — leis de outros países, decisões,
 * quem costuma se manifestar. É a única chamada em que ele usa o que sabe de memória, e nada dela vai para a nota:
 * as pistas só orientam as buscas, e só entra o que uma página lida confirmar. Sem elas, o modelo gastava as buscas
 * com termos genéricos e voltava com dois países.
 */
function pe5PromptPistas({ identificacao, ementa, leitura, coleta, hoje }) {
  return `Você vai preparar a PESQUISA sobre a proposição abaixo. Ainda não é a pesquisa: é a lista de ONDE PROCURAR, que as buscas seguintes vão conferir uma a uma. Use o que você sabe sobre o assunto para apontar caminhos. Nada do que você escrever aqui entra na nota técnica sem ser confirmado depois em página lida — por isso prefira apontar um caminho a mais do que um a menos, e marque o que for incerto.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO (lidos nos documentos):
${pe5FatosDoTexto(leitura)}

TRAMITAÇÃO:
${pe5ResumoColeta(coleta)}

PONTOS SENSÍVEIS DO TEXTO:
${pe5PontosSensiveis(leitura)}

O QUE DEVOLVER
{
 "termos": [ "os nomes pelos quais a imprensa e o setor chamam a matéria e o tema (apelidos, siglas, expressões em inglês)" ],
 "paises": [ { "lugar": "país ou bloco", "norma": "nome pelo qual a regra ou o projeto é conhecido lá (sigla, número, se souber)", "por_que": "o que tem de parecido — ou de oposto — com o texto", "contraste": false, "certeza": "alta | média | baixa" } ],
 "decisoes": [ { "tribunal": "STF | STJ | TCU", "referencia": "classe e número, tema de repercussão geral ou o nome pelo qual a decisão é conhecida", "por_que": "que ponto do texto ela toca", "certeza": "alta | média | baixa" } ],
 "atores": {
   "politica": [ { "nome": "…", "lado_provavel": "favorável | contrário | incerto", "onde": "onde costuma se manifestar (site, nota, audiência, rede social)" } ],
   "economia": [ … ], "federacao": [ … ], "sociedade": [ … ]
 }
}
- "paises": de 8 a 12, incluídos ao menos dois de MODELO OPOSTO ("contraste": true: o mecanismo é proibido lá, foi rejeitado, retirado ou é bem mais estreito) e os que discutiram e desistiram.
- "decisoes": de 8 a 12 — sobre regras parecidas, sobre os dispositivos da Constituição em jogo e sobre as leis que o texto altera. Se não tiver certeza do número, descreva a decisão em "referencia" e marque "certeza": "baixa"; a busca confere.
- "atores": de 8 a 12 por grupo, dos DOIS lados em cada grupo — politica (governo, relator, líderes, bancadas, parlamentares que costumam falar do tema), economia (confederações, associações setoriais, empresas atingidas, sindicatos), federacao (estados, municípios, órgãos públicos, agências, tribunais de contas, Ministério Público) e sociedade (organizações, institutos, pesquisadores, juristas, editoriais).
- Não descreva o que cada um decidiu ou disse: isso é trabalho da busca. Aqui só o caminho.

${PE5_SO_JSON}`;
}
/** Pistas devolvidas pelo modelo, só com o que tem nome; listas que não vieram ficam vazias. */
function pe5PistasLimpar(j) {
  const lista = (v, campo) => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object' && String(x[campo] || '').trim()).slice(0, 14);
  const at = (j && j.atores && typeof j.atores === 'object') ? j.atores : {};
  return { termos: (Array.isArray(j && j.termos) ? j.termos : []).map(t => String(t || '').trim()).filter(Boolean).slice(0, 12),
    paises: lista(j && j.paises, 'lugar'), decisoes: lista(j && j.decisoes, 'referencia'),
    atores: Object.fromEntries(Object.keys(PE5_GRUPOS_DEBATE).map(g => [g, lista(at[g], 'nome')])) };
}
function pe5PistasVazias(p) { return !p || !((p.paises || []).length || (p.decisoes || []).length || (p.termos || []).length || Object.values(p.atores || {}).some(l => (l || []).length)); }
/** O bloco de pistas de cada busca: `alvo` é um grupo do debate, 'atores' (os quatro), 'paises', 'decisoes' ou 'tudo' (rodada complementar). */
function pe5PistasTexto(pistas, alvo) {
  if (pe5PistasVazias(pistas)) return '';
  const L = [], incerto = x => (/baixa/i.test(x.certeza || '') ? ' (incerto)' : '');
  const termos = (pistas.termos || []).length ? `Termos de busca: ${pistas.termos.join('; ')}.` : '';
  const pais = x => `- ${x.lugar}${x.norma ? `: ${x.norma}` : ''}${pe5EhContraste(x) ? ' [modelo oposto]' : ''}${x.por_que ? ` — ${x.por_que}` : ''}${incerto(x)}`;
  const dec = x => `- ${[x.tribunal, x.referencia].filter(Boolean).join(' ')}${x.por_que ? ` — ${x.por_que}` : ''}${incerto(x)}`;
  const ator = x => `- ${x.nome}${x.lado_provavel ? ` (${x.lado_provavel})` : ''}${x.onde ? ` — ${x.onde}` : ''}`;
  if ((alvo === 'paises' || alvo === 'tudo') && (pistas.paises || []).length) L.push(`Países e blocos a conferir:\n${pistas.paises.map(pais).join('\n')}`);
  if ((alvo === 'decisoes' || alvo === 'tudo') && (pistas.decisoes || []).length) L.push(`Decisões a conferir:\n${pistas.decisoes.map(dec).join('\n')}`);
  for (const g of Object.keys(PE5_GRUPOS_DEBATE)) {
    if ((alvo === g || alvo === 'atores' || alvo === 'tudo') && ((pistas.atores || {})[g] || []).length) L.push(`Quem procurar — ${PE5_GRUPOS_DEBATE[g].rotulo}:\n${pistas.atores[g].map(ator).join('\n')}`);
  }
  if (!L.length) return '';
  return `\nPISTAS (onde procurar; escritas antes da busca, sem consulta a fonte: confira cada uma e registre só o que a página lida confirmar)\n${[termos, ...L].filter(Boolean).join('\n')}\n`;
}

/** Os pontos que a leitura marcou como graves: a pesquisa procura quem falou de cada um. */
function pe5PontosSensiveis(L) {
  const a = (L?.achados || []).filter(x => /alta|m[ée]dia/i.test(x.gravidade || '')).slice(0, 14);
  return a.length ? a.map(x => `- ${x.questao}${x.dispositivo ? ` (${x.dispositivo})` : ''}`).join('\n') : '(a leitura não marcou ponto de gravidade alta ou média)';
}
// O debate vai em QUATRO buscas, uma por GRUPO de atores, cada uma com os dois lados. "Quem se posicionou e como"
// é a seção que dá ao parlamentar a tendência da votação: precisa do maior número possível de atores. Em duas
// buscas (apoio e crítica), o modelo concentrava as tentativas nos parlamentares e deixava entidades, entes e
// sociedade civil com dois ou três nomes (NTA do PLP 299/2026, 22/11/2026).
const PE5_GRUPOS_DEBATE = {
  politica: { rotulo: 'Governo e Congresso', foco: 'FOCO DESTA BUSCA: GOVERNO E CONGRESSO — o Presidente da República, os ministros e órgãos do governo que falaram, o autor, os relatores nas duas Casas, os presidentes da Câmara e do Senado, os líderes do governo, da oposição e dos partidos, as bancadas e frentes parlamentares, e CADA parlamentar que se manifestou (em Plenário, em comissão, em entrevista, em rede social), com o partido e a UF. Registre os dois lados e como cada um responde ao outro. As notícias das agências do Congresso, abaixo, já foram lidas pelo programa: use-as como fonte (com o endereço indicado) e gaste as buscas com o que elas não trazem.' },
  economia: { rotulo: 'Setores econômicos e trabalhadores', foco: 'FOCO DESTA BUSCA: SETORES ECONÔMICOS E TRABALHADORES — confederações nacionais (indústria, comércio, agricultura, transporte, serviços, instituições financeiras), federações estaduais, associações setoriais, empresas que se manifestaram, centrais sindicais, sindicatos e conselhos profissionais. Para cada entidade, quem ela representa (associados, setor). Os dois lados: quem ganha e quem perde com o texto. Procure notas oficiais, manifestos e cartas abertas, com a lista de signatários.' },
  federacao: { rotulo: 'Estados, municípios e órgãos públicos', foco: 'FOCO DESTA BUSCA: ESTADOS, MUNICÍPIOS E ÓRGÃOS PÚBLICOS — governadores, secretários de Estado e seus colegiados (de Fazenda, de Saúde, de Educação), a Confederação Nacional de Municípios, a Frente Nacional de Prefeitos, consórcios e associações de municípios, conselhos de políticas públicas, Tribunal de Contas da União e tribunais de contas, Ministério Público, Defensoria, Advocacia-Geral da União, agências reguladoras, Instituição Fiscal Independente e as consultorias legislativas e de orçamento das duas Casas. Os dois lados.' },
  sociedade: { rotulo: 'Sociedade civil e análise', foco: 'FOCO DESTA BUSCA: SOCIEDADE CIVIL E ANÁLISE — organizações não governamentais, frentes e movimentos, institutos de pesquisa e think tanks, universidades e pesquisadores, economistas e juristas que publicaram análise, escritórios que divulgaram parecer, e os editoriais dos principais jornais. Os dois lados.' },
};
const PE5_FOCO_DEBATE = Object.fromEntries(Object.entries(PE5_GRUPOS_DEBATE).map(([k, v]) => [k, v.foco]));

/** Notícias das agências do Congresso já lidas pelo programa (noticias-agencias.js), para a busca do debate. */
function pe5NoticiasAgencias(noticias) {
  const n = (noticias || []).filter(x => x && x.url && x.texto);
  return n.length ? `NOTÍCIAS DAS AGÊNCIAS DO CONGRESSO (lidas pelo programa; são fonte primária: use o endereço de cada uma em "fonte_url"):\n${n.map((x, i) => `<<<NOTÍCIA ${i + 1}: ${x.veiculo}, ${x.data} — ${x.titulo} — ${x.url}>>>\n${x.texto}`).join('\n\n')}\n` : '';
}

function pe5PromptDebate({ identificacao, ementa, leitura, coleta, hoje, foco = '', noticias = [], pistas = null }) {
  return `Pesquise na internet QUEM SE POSICIONOU sobre a proposição abaixo e O QUE CADA UM ARGUMENTA. O objetivo é montar o mapa do debate para um assessor parlamentar: os dois lados, com os argumentos e a evidência que cada um apresenta.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO (lidos nos documentos; servem para você reconhecer de qual versão cada fonte fala):
${pe5FatosDoTexto(leitura)}

TRAMITAÇÃO:
${pe5ResumoColeta(coleta)}

PONTOS SENSÍVEIS DO TEXTO (apontados na leitura; procure quem se manifestou sobre cada um):
${pe5PontosSensiveis(leitura)}
${PE5_FOCO_DEBATE[foco] ? `\n${PE5_FOCO_DEBATE[foco]}\n` : ''}${foco === 'politica' ? `\n${pe5NoticiasAgencias(noticias)}` : ''}${pe5PistasTexto(pistas, PE5_FOCO_DEBATE[foco] ? foco : 'atores')}
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
${foco ? `O MAIOR NÚMERO POSSÍVEL de atores deste grupo — de 8 a 30 —, dos dois lados, cada um com TODOS os argumentos que a fonte traz. Ator que só repete outro entra assim mesmo, com a fonte dele: o número de quem se manifestou de cada lado é informação para o parlamentar. Ao menos TRÊS de cada lado (a favor e contra), se houver: a nota precisa de, no total, ${PE5_MIN_PESQUISA.atores} atores com ${PE5_MIN_PESQUISA.porLado} de cada lado. Não registre ator sem manifestação localizada (esse vai em "avisos"). De 3 a 8 controvérsias: a pergunta em disputa e os atores desta busca que argumentam de um lado e de outro (o programa junta com as buscas dos outros grupos).` : 'De 8 a 18 atores. De 4 a 9 controvérsias, cada uma ligando os atores que argumentam de um lado e de outro.'}

${PE5_SO_JSON}`;
}

/** Os mecanismos do texto que a comparação internacional cobre: os blocos da leitura, com os de ponto grave marcados. */
// O bloco é "art. 1º (art. 6º-C da LC 200/2023)": vale o artigo mais interno (6º-C) e, se houver, o número da lei;
// achado de outro artigo ou de outra lei não marca o bloco.
function pe5BlocoTemPontoGrave(b, graves) {
  const arts = String(b.dispositivos || '').match(/arts?\.\s*\d+[º°o]?(?:-[A-Z])?/gi) || []; if (!arts.length) return false;
  const norm = t => t.toLowerCase().replace(/arts?\.\s*/, 'art. ').replace(/[°o]$/, 'º').replace(/\s+/g, '');
  const alvo = norm(arts[arts.length - 1]), lei = (String(b.dispositivos).match(/(?:LC|Lei Complementar|Lei)\s*(?:n[ºo°.]*\s*)?([\d.]+)\/\d{4}/i) || [])[1];
  return graves.some(d => { const ta = (d.match(/arts?\.\s*\d+[º°o]?(?:-[A-Z])?/gi) || []).map(norm); const leiA = (d.match(/(?:LC|Lei Complementar|Lei)\s*(?:n[ºo°.]*\s*)?([\d.]+)\/\d{4}/i) || [])[1]; return ta.includes(alvo) && (lei || '') === (leiA || ''); });   // "art. 14" do projeto não é o art. 14 da LC 235
}
function pe5EixosComparacao(L) {
  const graves = (L?.achados || []).filter(a => /alta|m[ée]dia/i.test(a.gravidade || '')).map(a => String(a.dispositivo || ''));
  return (L?.blocos || []).map(b => `- ${b.titulo} (${b.dispositivos})${pe5BlocoTemPontoGrave(b, graves) ? ' — tem ponto grave' : ''}`).join('\n');
}
// Leis que o texto altera, da leitura (alterações e, sem elas, dispositivos dos blocos). A NTA do PLP 299/2026 não trouxe
// no histórico o projeto que deu origem à Lei Complementar nº 200/2023 (PLP 93/2023), a lei mais alterada pelo texto.
// "obrigatoria": a mais alterada e as que têm ponto grave (até quatro), se forem lei dos últimos vinte anos — destas o histórico TEM de trazer a origem.
const PE5_RE_LEI = /\b(Lei Complementar|LC|Decreto-Lei|Lei)\s*(?:n[ºo°.]*\s*)?(\d[\d.]*\d|\d)\s*(?:\/|,\s*de\s+\d{1,2}[º°]?\s+de\s+[a-zç]+\s+de\s+)(\d{4})/gi;
function pe5LeisAlteradas(L, { anoRef = new Date().getFullYear() } = {}) {
  const m = new Map();
  const achar = s => [...String(s || '').matchAll(PE5_RE_LEI)].map(x => { const tipo = /^(LC|Lei Complementar)$/i.test(x[1]) ? 'Lei Complementar' : /decreto/i.test(x[1]) ? 'Decreto-Lei' : 'Lei'; const numero = x[2].replace(/\./g, ''); return { k: `${tipo}|${numero}|${x[3]}`, tipo, numero, ano: x[3], rot: `${tipo} nº ${x[2]}/${x[3]}` }; });
  const fontes = (L?.alteracoes || []).length ? L.alteracoes.map(a => a.dispositivo) : (L?.blocos || []).map(b => b.dispositivos);
  for (const s of fontes) for (const x of achar(s)) { const e = m.get(x.k) || { lei: x.rot, tipo: x.tipo, numero: x.numero, ano: x.ano, alteracoes: 0, grave: false }; e.alteracoes++; m.set(x.k, e); }
  const graves = (L?.achados || []).filter(a => /alta/i.test(a.gravidade || '')).map(a => String(a.dispositivo || ''));
  for (const b of L?.blocos || []) if (pe5BlocoTemPontoGrave(b, graves)) for (const x of achar(b.dispositivos)) if (m.has(x.k)) m.get(x.k).grave = true;
  for (const g of graves) for (const x of achar(g)) if (m.has(x.k)) m.get(x.k).grave = true;
  const lista = [...m.values()].sort((a, b) => b.alteracoes - a.alteracoes);
  // Só se exige a origem de lei ou lei complementar dos últimos vinte anos: decreto-lei não nasceu de projeto, e o
  // debate de origem de lei antiga (CLT, Lei nº 8.666/1993) pouco diz sobre o texto de hoje.
  const elegivel = e => e.tipo !== 'Decreto-Lei' && Number(e.ano) >= anoRef - 20;
  const obrig = new Set([...new Set([lista[0], ...lista.filter(e => e.grave)].filter(Boolean))].filter(elegivel).slice(0, 4));
  return lista.map(e => ({ ...e, obrigatoria: obrig.has(e) }));
}
/** Leis obrigatórias (pe5LeisAlteradas) cuja origem não está no histórico pesquisado. */
function pe5OrigensFaltantes(leis, historico) {
  const origens = (historico || []).filter(h => /origem/i.test(h.tipo || '') || /virou lei/i.test(h.desfecho || ''));
  // Compara pela LEI citada no item (número e ano), não por número solto: "R$ 200 milhões em 2023" não é a LC 200/2023.
  const citadas = h => [...[h.lei_resultante, h.o_que_propunha, h.por_que, h.desfecho].join(' ').matchAll(PE5_RE_LEI)].map(x => `${x[2].replace(/\./g, '')}|${x[3]}`);
  return (leis || []).filter(l => l.obrigatoria).filter(l => !origens.some(h => citadas(h).includes(`${l.numero}|${l.ano}`)));
}
/** Temas que o texto manda tratar em outra lei ou para os quais dá prazo ("o Congresso apreciará em 60 dias o projeto que…"). */
function pe5TemasDelegados(L) {
  const out = [];
  for (const b of L?.blocos || []) for (const f of String(b.explica || '').split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ])/)) {   // "art. 37" não corta a frase
    // Só o que o texto EMPURRA para outra lei: prazo para apreciar projeto, "projeto que disciplinará", "lei específica
    // disporá", "será regulamentado em lei". "O projeto regulamenta…" descreve a própria matéria e não entra.
    const projeto = /\b(projeto|lei)\b[^.;]*\b(em|no prazo de|até)\s+\d+\s+dias\b|\b(em|no prazo de|até)\s+\d+\s+dias\b[^.;]*\b(projeto|lei)\b/i.test(f) || /\bprojeto( de lei( complementar)?)? que (disciplinar[áa]|regulamentar[áa]|tratar[áa]|dispor[áa])/i.test(f);
    const leiPropria = /\blei (complementar )?(específica|própria)\s+(que\s+)?(disciplin|regulament|dispor|dispõe|tratar|definir|fixar)/i.test(f) || /\b(ser[áa]|ser[ãa]o|dever[áa] ser|dever[ãa]o ser) (regulamentad|disciplinad|definid|fixad)[oa]s? (por|em) lei\b/i.test(f);
    if (projeto || leiPropria) out.push(`- ${b.titulo} (${b.dispositivos}): ${f.trim()}`);
  }
  return [...new Set(out)].slice(0, 8);
}
/** Jurisdição marcada como modelo oposto ao do texto. */
const pe5EhContraste = j => j && (j.contraste === true || /^(sim|true)$/i.test(String(j.contraste || '')));
function pe5PromptInternacional({ identificacao, ementa, leitura, hoje, pistas = null }) {
  return `Pesquise na internet a EXPERIÊNCIA DE OUTROS PAÍSES com regra parecida com a da proposição abaixo: o que cada um adotou, com quais parâmetros, e O QUE ACONTECEU depois.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO (para você saber o que comparar):
${pe5FatosDoTexto(leitura)}

MECANISMOS DO TEXTO (escolha entre eles de 3 a 5 EIXOS de comparação, priorizando os que têm ponto grave; um texto com vários mecanismos não se compara por um só):
${pe5EixosComparacao(leitura)}
${pe5PistasTexto(pistas, 'paises')}
O QUE PROCURAR
- NO MÍNIMO ${PE5_MIN_PESQUISA.paises} e até 10 países ou blocos, com AO MENOS UM por eixo escolhido. Cada jurisdição diz em "eixo" qual mecanismo do texto ela permite comparar. Para cada um: a norma, desde quando vale, a autoridade, quem é alcançado (com os números do critério na moeda original), como funciona, a sanção e a duração.
- AO MENOS UM país com o MODELO OPOSTO ao do texto num dos eixos (de preferência no que tem ponto grave): onde o mecanismo é proibido, depende de aprovação do Legislativo, tem limite fixado em lei bem mais estreito, ou foi revogado. Marque-o com "contraste": true e diga em "como_funciona" em que ele é o oposto. Ele conta para o mínimo. Os demais levam "contraste": false.
- O que aconteceu: quantos casos, quem foi alcançado, decisões, multas, mudanças de conduta, revisões oficiais da própria lei, decisões de tribunais. Com data.
- As críticas, dos dois lados: de quem acha a regra fraca ou mal aplicada e de quem acha que ela prejudica.
- Países que discutiram regra parecida e DESISTIRAM, adiaram ou revogaram, e por quê. Contam para o mínimo.
- Avaliações de organismos internacionais (OCDE, Banco Mundial, FMI, órgãos da ONU), se houver.
- Estudos que meçam efeito (preço, investimento, entrada de concorrentes, arrecadação, conforme a matéria). Se não houver, diga em "avisos".
- Fonte primária sempre que possível: a autoridade, o diário oficial, o relatório de revisão. Abra a página da norma ou da autoridade de cada país: jurisdição descrita só pelo resumo da busca não entra.

${PE5_REGRAS_PESQUISA}

O QUE DEVOLVER
{
 "eixos": [ "os mecanismos do texto escolhidos para comparar" ],
 "jurisdicoes": [ { "id": "W1", "eixo": "qual dos eixos", "contraste": false, "lugar": "…", "norma": "nome e número", "desde": "…", "autoridade": "…",
     "quem_e_alcancado": "critérios, com os números na moeda original", "como_funciona": "…", "sancao": "…", "duracao": "…",
     "aconteceu": [ { "fato": "…", "data": "…" } ],
     "criticas": [ { "critica": "…", "quem": "…", "data": "…", "fonte_nome": "…", "fonte_url": "https://…" } ],
     "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "primária | imprensa | terceiro" } ],
 "avisos": [ "o que não foi possível confirmar em fonte oficial; o que procurou e não achou" ]
}
Para país que não aprovou a regra, use os mesmos campos, com "—" no que não se aplica e a história em "como_funciona" e "aconteceu".

${PE5_SO_JSON}`;
}

/**
 * Os dispositivos da Constituição (e do ADCT) que a leitura cita nos pontos de gravidade alta ou média e nas
 * controvérsias: cada um é uma tese a procurar no STF. Vale o artigo seguido de "da Constituição" ou "do ADCT" e
 * também o citado numa frase que fala da Constituição ("o fundamento constitucional invocado é o art. 163, VIII").
 */
function pe5TesesConstitucionais(L) {
  const frases = [...(L?.achados || []).filter(a => /alta|m[ée]dia/i.test(a.gravidade || '')).flatMap(a => [a.questao, a.porque]), ...(L?.controversias || []).flatMap(c => [c.questao, c.explica])]
    .join(' \n ').split(/\n|(?<=[;!?])\s+|(?<=\.)\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ"“])/);   // "art. 163" não quebra a frase
  const out = new Map();
  const reArt = /art\.\s*(\d+)[ºo°]?(?:-[A-Z])?((?:,?\s*(?:§\s*\d+[ºo°]?|inciso\s+[IVXLC]+|[IVXLC]+\b|al[íi]nea\s+["“]?[a-z]["”]?|["“][a-z]["”]))*)/gi;
  for (const f of frases) {
    for (const m of f.matchAll(reArt)) {
      const depois = f.slice(m.index + m[0].length, m.index + m[0].length + 45);
      // a Constituição tem de estar PERTO do artigo (até 70 caracteres antes ou 45 depois), não só na mesma frase
      if (!/Constitui[çc][ãa]o|constitucion|ADCT|Disposi[çc][õo]es Constitucionais/i.test(f.slice(Math.max(0, m.index - 70), m.index) + depois)) continue;
      if (/^\s*,?\s*(?:da|do)\s+(?:Lei|LC|Lei Complementar|Decreto|C[óo]digo|Regimento)\b/i.test(depois)) continue;   // artigo de lei, não da Constituição
      const adct = /^\s*,?\s*do\s+(?:ADCT|Ato das Disposi)/i.test(depois);
      const k = `art. ${m[1]}${m[2] ? m[2].replace(/\s+/g, ' ').replace(/^,?\s*/, ', ').replace(/,\s*$/, '') : ''}${adct ? ' do ADCT' : ' da Constituição'}`;
      if (!out.has(k.replace(/,.*? (d[ao] )/, ' $1'))) out.set(k.replace(/,.*? (d[ao] )/, ' $1'), k);
    }
  }
  return [...out.values()].slice(0, 10);
}
function pe5PromptContexto({ identificacao, ementa, leitura, hoje, pistas = null }) {
  const teses = pe5TesesConstitucionais(leitura);
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

DISPOSITIVOS DA CONSTITUIÇÃO EM JOGO (procure UMA decisão por dispositivo, no mínimo):
${teses.length ? teses.map(t => `- ${t}`).join('\n') : '(a leitura não citou dispositivo da Constituição; procure pelos pontos acima)'}

DOCUMENTOS QUE A PROPOSIÇÃO CITA COMO BASE (localize cada um):
${refs || '(nenhum identificado na leitura)'}
${pe5PistasTexto(pistas, 'decisoes')}
O QUE PROCURAR
- "jurisprudencia": NO MÍNIMO ${PE5_MIN_PESQUISA.decisoes} e até 12 decisões já tomadas, buscadas em quatro frentes: (1) STF sobre cada dispositivo da Constituição listado acima; (2) ações contra as leis que o texto altera (as normas listadas no alto), já julgadas ou com liminar; (3) acórdãos do TCU sobre o mecanismo que o texto cria ou muda; (4) STJ, se a matéria for tributária ou administrativa. Ação ainda sem decisão NÃO entra aqui (vai para a pesquisa de judicialização). Identifique tribunal, órgão julgador, classe e número, relator e data. Diga O QUE A DECISÃO DECIDIU, por que interessa aqui e ONDE A ANALOGIA PARA (o que o caso tinha de diferente). Não atribua à decisão conclusão que ela não tomou. Se não tiver certeza do número ou do relator, não inclua. SÓ ENTRA a decisão cuja página (o acórdão, a notícia do tribunal, o informativo) você abriu e leu: "decidiu" diz o que foi decidido — quem ganhou, que regra caiu ou ficou de pé —, não o assunto do processo. Decisão de que você só conhece o tema fica em "avisos".
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

/**
 * Chamada complementar: roda quando a pesquisa veio abaixo dos mínimos (países, decisões, atores, atores de cada
 * lado) ou sem o que é obrigatório (país de modelo oposto, origem das leis alteradas). Pede só o que falta, dizendo
 * o que já se tem para não repetir. Pode rodar até três vezes (PE5_MIN_PESQUISA.rodadas); `rodada` diz qual é.
 */
function pe5PromptComplementar({ identificacao, ementa, leitura, hoje, faltaPaises = 0, faltaDecisoes = 0, jaPaises = [], jaDecisoes = [], eixosSemPais = [], faltaContraste = false, faltaOrigens = [],
  faltaAtores = 0, faltaFavor = 0, faltaContra = 0, jaAtores = [], pistas = null, rodada = 1 }) {
  const teses = pe5TesesConstitucionais(leitura);
  const querAtores = faltaAtores > 0 || faltaFavor > 0 || faltaContra > 0;
  const pedidoAtores = [faltaAtores > 0 ? `mais ${faltaAtores} ator(es) com manifestação localizada sobre a matéria` : '', faltaFavor > 0 ? `ao menos ${faltaFavor} FAVORÁVEL(IS) ao texto (inclui "favorável com ressalvas")` : '', faltaContra > 0 ? `ao menos ${faltaContra} CONTRÁRIO(S) ao texto (inclui "contrário com ressalvas")` : ''].filter(Boolean).join('; ');
  return `Pesquise na internet para COMPLETAR a pesquisa sobre a proposição abaixo. ${rodada > 1 ? `Esta é a ${rodada}ª tentativa: as anteriores não alcançaram o mínimo. Mude os termos de busca (outro idioma, o nome da norma, o nome da entidade, o número do processo) em vez de repetir os que já foram usados.` : 'A primeira busca trouxe menos do que o mínimo ou deixou de fora o que é obrigatório.'}

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO:
${pe5FatosDoTexto(leitura)}
${querAtores ? `\nPONTOS SENSÍVEIS DO TEXTO:\n${pe5PontosSensiveis(leitura)}\n` : ''}${pe5PistasTexto(pistas, 'tudo')}
O QUE FALTA
${faltaPaises > 0 ? `- "jurisdicoes": mais ${faltaPaises} país(es) ou bloco(s) com regra comparável (ou que discutiram e desistiram).${eixosSemPais.length ? ` Mecanismos ainda sem país: ${eixosSemPais.join('; ')}.` : ''} Já pesquisados (NÃO repita): ${jaPaises.join('; ') || 'nenhum'}.\n` : ''}${faltaDecisoes > 0 ? `- "jurisprudencia": mais ${faltaDecisoes} decisão(ões) já tomada(s) do STF, STJ ou TCU. Dispositivos da Constituição em jogo: ${teses.join('; ') || '(ver os fatos do texto)'}. Também ações já julgadas contra as leis que o texto altera. Só entra a decisão cuja página você abriu e leu: "decidiu" diz o que foi decidido, não o assunto do processo. Já localizadas (NÃO repita): ${jaDecisoes.join('; ') || 'nenhuma'}.\n` : ''}${faltaContraste ? `- "jurisdicoes": UM país ou bloco com o MODELO OPOSTO ao do texto num dos mecanismos (o mecanismo é proibido lá, depende de aprovação do Legislativo, tem limite fixado em lei bem mais estreito, ou foi revogado), com "contraste": true e, em "como_funciona", em que ele é o oposto. Já pesquisados (NÃO repita): ${jaPaises.join('; ') || 'nenhum'}.\n` : ''}${faltaOrigens.length ? `- "historico": o projeto que deu origem a cada uma destas leis, que o texto altera: ${faltaOrigens.join('; ')}. Número, ano, autor, quando virou lei e o que ela criou; "tipo": "origem da lei alterada" e, em "lei_resultante", a lei.\n` : ''}${querAtores ? `- "atores": ${pedidoAtores}. Cada um com a posição, TODOS os argumentos que a fonte traz e a página em que se manifestou; em "grupo", um destes: ${Object.values(PE5_GRUPOS_DEBATE).map(g => `"${g.rotulo}"`).join(', ')}. Não registre ator sem manifestação localizada, nem mude a posição de ninguém para fechar a conta: se não houver quem se manifeste de um lado, diga em "avisos" onde procurou. Já registrados (NÃO repita): ${jaAtores.join('; ') || 'nenhum'}.\n` : ''}
${PE5_REGRAS_PESQUISA}

O QUE DEVOLVER
{
 "jurisdicoes": [ { "id": "W1", "eixo": "…", "contraste": false, "lugar": "…", "norma": "nome e número", "desde": "…", "autoridade": "…", "quem_e_alcancado": "…", "como_funciona": "…", "sancao": "…", "duracao": "…", "aconteceu": [ { "fato": "…", "data": "…" } ], "criticas": [ { "critica": "…", "quem": "…", "data": "…", "fonte_nome": "…", "fonte_url": "https://…" } ], "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "jurisprudencia": [ { "id": "R1", "tribunal": "…", "processo": "…", "relator": "…", "data": "dd/mm/aaaa", "decidiu": "…", "pertinencia": "…", "limite": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "historico": [ { "id": "H1", "tipo": "origem da lei alterada", "proposicao": "PL 0000/0000", "casa": "…", "ano": "aaaa", "autor": "…", "o_que_propunha": "…", "desfecho": "virou lei", "lei_resultante": "…", "por_que": "…", "data": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "atores": [ { "id": "Q1", "grupo": "…", "ator": "nome (e porta-voz, se houver)", "quem_e": "o que é e que interesse representa", "posicao": "favorável | favorável com ressalvas | contrário com ressalvas | contrário | neutro", "versao": "original | substitutivo | não especificada", "data": "dd/mm/aaaa", "argumentos": [ { "tese": "…", "evidencia_citada": "…" } ], "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
 "avisos": [ "o que procurou e não encontrou" ]
}
Se não houver o que acrescentar num dos grupos, devolva a lista vazia e diga em "avisos" onde procurou. Não invente número de processo, relator, data ou manifestação.

${PE5_SO_JSON}`;
}

function pe5PromptCongresso({ identificacao, ementa, leitura, coleta, hoje }) {
  const leis = pe5LeisAlteradas(leitura), delegados = pe5TemasDelegados(leitura);
  const pontos = (leitura?.achados || []).filter(a => a.gravidade === 'alta' || /^(1|1B)$/.test(String(a.lente))).map(a => `- ${a.questao} (${a.dispositivo})`).join('\n');
  return `Pesquise na internet duas coisas sobre a proposição abaixo: o HISTÓRICO do tema no Congresso Nacional e os SINAIS DE JUDICIALIZAÇÃO.

MATÉRIA: ${identificacao}
EMENTA: ${ementa || ''}
DATA DE HOJE: ${hoje}

FATOS DO TEXTO:
${pe5FatosDoTexto(leitura)}

TRAMITAÇÃO:
${pe5ResumoColeta(coleta)}

PONTOS JURÍDICOS QUE A LEITURA DESTACOU (procure se alguém já os contesta em juízo ou anuncia que contestará):
${pontos || '(nenhum)'}

PONTOS SENSÍVEIS DO TEXTO (apontados na leitura; para a judicialização, procure ação em curso, anúncio ou parecer sobre cada um):
${pe5PontosSensiveis(leitura)}

LEIS QUE O TEXTO ALTERA (lidas pelo programa; "obrigatória" = o histórico TEM de trazer o projeto que lhe deu origem):
${leis.map(l => `- ${l.lei} — ${l.alteracoes} alteração(ões)${l.grave ? ', com ponto grave' : ''}${l.obrigatoria ? ' — obrigatória' : ''}`).join('\n') || '(nenhuma identificada)'}

TEMAS QUE O TEXTO MANDA TRATAR EM OUTRA LEI OU PARA OS QUAIS DÁ PRAZO (procure os projetos em andamento sobre cada um):
${delegados.join('\n') || '(nenhum identificado pelo programa; confira nos fatos do texto)'}

O QUE PROCURAR
- "historico", em quatro tipos (campo "tipo"):
  (1) "origem da lei alterada": o projeto que deu origem a CADA lei obrigatória acima (número, ano, autor, quando virou lei e o que ela criou); em "lei_resultante", a lei. Um item por lei; para as demais leis da lista, só se o debate de origem iluminar o texto atual.
  (2) "tentativa anterior" e (3) "em andamento": ver abaixo.
  (4) "tema delegado": para cada tema que o texto manda tratar em outra lei ou com prazo, o projeto que já tramita sobre ele, onde está parado e por quê.
- "historico" (tipos 2 e 3): as tentativas ANTERIORES de legislar sobre o mesmo assunto, na Câmara e no Senado: projetos arquivados, rejeitados, vetados, medidas provisórias que perderam a eficácia, textos aprovados em uma Casa e parados na outra, comissões especiais e CPIs que trataram do tema. Para cada uma: a proposição com número e ano, o autor, o que propunha em relação ao texto atual, o desfecho e — o mais importante — POR QUE não avançou ou como terminou, segundo a fonte. Inclua as proposições em andamento que disputam o mesmo espaço. De 4 a 12 itens no total; se o tema é novo no Congresso, diga em "avisos".
- "judicializacao": sinais concretos de que a lei, se aprovada, será levada ao Judiciário: (a) ação em curso no STF ou em tribunal superior contra lei de teor parecido (federal, estadual ou a própria lei que o texto altera), com classe, número, relator e situação; (b) partido, confederação, entidade de classe ou órgão que ANUNCIOU que irá questionar o texto, ou que tem legitimidade (art. 103 da Constituição) e já se manifestou contra; (c) parecer jurídico público (consultoria legislativa, órgão do governo, Ministério Público, entidade) que aponte vício no texto; (d) lei análoga, no Brasil, que foi suspensa ou derrubada. Diga o dispositivo ou o tema visado e o fundamento alegado. Registre o que as fontes dizem; NÃO conclua que o texto é inconstitucional. Se não houver sinal localizado, devolva a lista vazia e diga em "avisos" o que procurou.

${PE5_REGRAS_PESQUISA}

O QUE DEVOLVER
{
 "historico": [ { "id": "H1", "tipo": "origem da lei alterada | tentativa anterior | em andamento | tema delegado", "proposicao": "PL 0000/0000", "casa": "Câmara | Senado | Congresso", "ano": "aaaa", "autor": "…", "o_que_propunha": "…", "desfecho": "em tramitação | arquivada | rejeitada | vetada | perdeu a eficácia | aprovada em uma Casa | virou lei", "lei_resultante": "a lei em que se transformou, ou \"—\"", "por_que": "o que travou ou decidiu, segundo a fonte", "data": "…", "fonte_nome": "…", "fonte_url": "https://…", "fonte_tipo": "…" } ],
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

PESQUISA DO CONGRESSO (ids H: histórico do tema; L: sinais de judicialização; fonte da internet):
${j(pesquisa?.congresso || {})}

${leiIntegral ? `LEI EM VIGOR, TEXTO INTEGRAL (lido pelo programa; use para verificar se a lei atual já tem regra parecida e cite o artigo):\n${leiIntegral}\n\n` : ''}CÂMBIO DO BANCO CENTRAL${cambio?.data ? ` em ${cambio.data}` : ''} (reais por unidade da moeda): ${cambio?.taxas ? Object.entries(cambio.taxas).map(([m, v]) => `${m} ${v}`).join('; ') : 'não obtido — não converta valores'}
=== FIM DA BASE ===`;
}

/** Lista do que a leitura apontou e a nota não pode deixar de fora (o programa confere pelo "ev"). */
function pe5Cobertura(L, grupos) {
  const curto = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 110);
  const linhas = [];
  for (const g of grupos) for (const x of (L && L[g]) || []) {
    if (!x || !x.id) continue;
    if (g === 'achados' && !/alta|m[ée]dia/i.test(x.gravidade || '')) continue;
    linhas.push(`  ${x.id} — ${curto(g === 'achados' ? x.questao : g === 'estimativas' ? `${x.o_que}: ${x.valor}${/^n[ãa]o/i.test(x.refeita || '') ? ' (NÃO refeita para o texto em votação)' : ''}` : g === 'versoes' ? x.tema : g === 'justificativa' ? `${x.quem ? x.quem + ': ' : ''}${x.objetivo}` : x.questao || x.o_que || x.rotulo || '')}`);
  }
  return linhas.length ? `COBERTURA OBRIGATÓRIA (o programa confere): cada identificador abaixo tem de constar no "ev" de pelo menos um bloco desta metade, com o conteúdo dele tratado no texto (para o que é secundário, uma frase ou um aposto bastam). Não é para listar os itens nem para dar um parágrafo a cada um: é para nenhum ficar de fora. Vários identificadores podem sustentar o mesmo bloco.\n${linhas.join('\n')}` : '';
}

const PE5_REGRA_EV = 'Cada bloco tem o campo "ev": a lista dos identificadores da base que sustentam o que o bloco afirma (por exemplo ["B2","T5"], ou ["G"] para dado de tramitação). Bloco sem "ev" é tratado como sem base. Não invente identificador.';

// A redação vai em QUATRO chamadas (pe5-pipeline.js), cada uma com as seções dela. Em duas, a resposta chegava
// perto do limite de saída: no Gemini 4 Carbon o raciocínio consumiu 44 mil dos 64 mil tokens e a primeira
// metade veio cortada (PLP 299/2026, 21/11/2026). O prompt é o mesmo; a função abaixo deixa, no formato de
// resposta e nas orientações, só as seções da parte pedida.
const PE5_PARTES_REDACAO = {
  materia: { chaves: ['materia'], campos: ['faz', 'origem', 'documentos', 'historico', 'versoes'],
    tamanho: 'Teto desta chamada: cerca de 4.000 palavras. "faz": até 130 palavras por bloco. "origem": até 5 parágrafos de até 130 palavras. "versoes": cada campo em até 35 palavras; mudanças pequenas do mesmo artigo vão na mesma linha. "documentos": "o_que_e" em até 45 palavras. "contexto": até 4 blocos de até 110 palavras. "historico": cada campo em até 30 palavras.',
    diz: 'A MATÉRIA (o que o texto faz, de onde vem, o que mudou entre as versões, os documentos, o contexto e o histórico)' },
  quem: { chaves: ['quem'], campos: ['posicoes', 'sintese'],
    tamanho: 'Esta chamada não tem teto total: o tamanho é o número de atores. "posicoes": até 110 palavras por ator; argumento igual ao de ator já descrito não se repete ("no mesmo sentido de …", e só o que ele acrescenta). "sintese": até 180 palavras.',
    diz: 'QUEM SE POSICIONOU E COMO (um parágrafo por ator e a síntese da distribuição das posições)' },
  debate: { chaves: ['debate', 'internacional'], campos: ['controversias', 'lados', 'da_analise', 'jurisdicoes', 'comparativo', 'licoes'],
    tamanho: 'Teto desta chamada: cerca de 5.500 palavras. "Quem se posicionou e como" é escrito em outra chamada: aqui, refira-se aos atores pelo nome, sem recontar quem são. "controversias": de 5 a 9, as que decidem o voto; cada argumento em até 35 palavras; pergunta parecida com outra se junta a ela. "lados": até 150 palavras por parágrafo. "jurisdicoes": cada campo em até 60 palavras. "licoes" e "limites": até 5 itens cada.',
    diz: 'O DEBATE (sem "Quem se posicionou e como", escrito em outra chamada) e A EXPERIÊNCIA INTERNACIONAL' },
  analise: { chaves: ['analise'], campos: ['lentes', 'jurisprudencia', 'judicializacao', 'impacto'],
    tamanho: 'Teto desta chamada: cerca de 5.500 palavras. "lentes": ponto de gravidade alta com exame de até 150 palavras; média, até 60; baixa, uma frase. Não reexplique o mecanismo que a primeira metade já explicou: refira-se a ele pelo artigo. "judicializacao": cada campo em até 50 palavras. "impacto": até 6 parágrafos de até 120 palavras.',
    diz: 'A ANÁLISE TÉCNICA' },
  caminhos: { chaves: ['caminhos', 'abertura'], campos: ['opcoes', 'emendas', 'partido', 'perguntas', 'abertura', 'alcancados', 'pontos'],
    tamanho: 'Teto desta chamada: cerca de 3.000 palavras. "opcoes": consequências em até 70 palavras cada. "emendas": de 2 a 5. "perguntas": de 5 a 8, as que destravam o que falta saber. "abertura": "decide" em até 230 palavras; "muda" em até 10 itens de até 55 palavras.',
    diz: 'OS CAMINHOS e A ABERTURA (o resumo da primeira página)' },
};
function pe5RecortarRedacao(prompt, parte) {
  const P = PE5_PARTES_REDACAO[parte]; if (!P) return prompt;
  const ini = prompt.lastIndexOf('O QUE DEVOLVER\n{'), ori = prompt.indexOf('ORIENTAÇÕES POR SEÇÃO', ini);
  if (ini < 0 || ori < 0) return prompt;
  // formato de resposta: só os blocos de primeiro nível da parte (cada um começa em ' "chave": {' e fecha em ' }')
  const corpo = prompt.slice(ini, ori), blocos = [...corpo.matchAll(/\n "([a-z_]+)": \{[\s\S]*?\n \},?(?=\n)/g)].filter(m => P.chaves.includes(m[1])).map(m => m[0].replace(/,$/, ''));
  const formato = `O QUE DEVOLVER\n{${blocos.join(',')}\n}\n\n`;
  // orientações: as linhas '- "campo"' da parte e as gerais (que não começam por campo)
  const [cab, ...linhas] = prompt.slice(ori).split('\n');
  const fica = linhas.filter(l => { const m = l.match(/^- "([a-z_]+)"/); return !m || P.campos.includes(m[1]); });
  const resto = fica.join('\n'), fim = resto.lastIndexOf(PE5_SO_JSON);
  const corpoOri = fim >= 0 ? resto.slice(0, fim).trimEnd() : resto.trimEnd();
  return `${prompt.slice(0, ini)}NESTA CHAMADA escreva SÓ ${P.diz}. As demais seções são escritas em outra chamada: não as devolva.\n\n${formato}${cab}\n${corpoOri}\n\nTAMANHO\n${P.tamanho}\n\n${PE5_SO_JSON}`;
}

function pe5PromptRedacao1(ctx) {
  return pe5RecortarRedacao(pe5PromptRedacao1Inteiro(ctx), ctx.parte);
}
function pe5PromptRedacao1Inteiro(ctx) {
  return `Você vai escrever a primeira metade de um parecer técnico para a assessoria de uma liderança partidária na Câmara dos Deputados: A MATÉRIA, O DEBATE e A EXPERIÊNCIA INTERNACIONAL. O leitor é o analista que vai orientar o parlamentar; ele precisa do máximo de informação útil, organizada e sem repetição.

MATÉRIA: ${ctx.identificacao}
DATA DE HOJE: ${ctx.hoje}

Escreva SÓ com o que está na base abaixo. O programa imprime por conta própria: a linha do tempo da tramitação, o placar das votações e o voto da bancada, a tabela "o que muda na legislação" e os links das fontes. Não repita essas tabelas em texto: use os fatos delas quando ajudarem a explicar.

${PE5_ESTILO}

${PE5_REGRA_EV}

${ctx.parte === 'debate' || ctx.parte === 'quem' ? '' : pe5Cobertura(ctx.leitura, ['versoes', 'justificativa'])}

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
 "quem": {
   "posicoes": [ { "texto": "um parágrafo de texto corrido sobre UM ator", "ev": ["Q1"] } ],
   "sintese": { "texto": "um parágrafo: como as posições se distribuem entre os grupos (governo e Congresso, setores econômicos, entes e órgãos públicos, sociedade civil), quem lidera cada lado e o que o placar das votações já feitas mostra", "ev": ["G","Q1"] }
 },
 "debate": {
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
- "faz": cubra o texto inteiro, em 5 a 14 blocos (um por tema; não funda temas para encurtar). Comece pelo que muda de mais importante. Explique o mecanismo, não transcreva artigos: o que dispara a regra, quem decide, valores e percentuais, prazos, exceções e o que fica para ato do Executivo.
- "origem": um parágrafo por etapa, em ordem. Quando a base trouxer o histórico NO SENADO (bloco "NO SENADO FEDERAL" dos dados do programa), dedique um parágrafo a ele: autor, relator, as datas e CADA votação nominal com o placar e o que decidiu (urgência, texto-base, cada destaque, turno suplementar). Dedique outro à situação NA CÂMARA: relator, o que o parecer dele vota e o que NÃO propõe (emenda, substitutivo), requerimento de urgência pendente ou aprovado, emendas de Plenário, e o que acontece se o texto for aprovado sem mudança e se for alterado. Nomeie os documentos (a exposição de motivos com o número, a consulta, o estudo). Diga expressamente o que NÃO foi lido (relatório, voto, estudo citado), quando a leitura registrar a ausência, e por quê.
- "documentos": a relação taxativa dos documentos que embasam a proposição, para consulta posterior: o texto original, a justificativa ou exposição de motivos, cada consulta, estudo, relatório ou nota que a leitura (ids U) e a pesquisa (ids Y) identificaram, o parecer e o substitutivo. Título completo, como está na base. Documento que foi localizado e não lido leva essa informação em "o_que_e".
- "historico": uma linha por item do histórico pesquisado (ids H), da mais antiga para a mais recente, terminando nas que estão em andamento: a origem de cada lei que o texto altera (o projeto que a criou), as tentativas anteriores de legislar sobre o tema, as que estão em andamento e os projetos sobre temas que o texto manda tratar em outra lei ou com prazo (diga, em "por_que", a que dispositivo do texto ele se liga). Em "por_que", o motivo que a fonte dá; se a fonte não diz, escreva "A fonte lida não informa o motivo.". Não repita aqui as proposições já explicadas em "contexto": se uma delas é a principal concorrente, ela fica aqui, e "contexto" trata do resto.
- "versoes": uma linha por mudança relevante entre o texto anterior e o texto em votação. Omita a seção se houver uma versão só.
- "controversias": é o coração do parecer. Para cada pergunta em disputa, os argumentos de um lado e do outro, com QUEM sustenta e QUE EVIDÊNCIA apresenta. Argumento sem evidência na fonte leva "Não apresentada na fonte.". Se um lado não tem argumento localizado, deixe a lista vazia. Em "estado", diga o que o texto em votação fez com a questão e o que ficou em aberto. Quando dois críticos se contradizem, diga.
- "posicoes" (seção "Quem se posicionou e como"): é a seção que mostra ao parlamentar a TENDÊNCIA da votação; cubra TODOS os atores da pesquisa do debate (ids Q). TEXTO CORRIDO, UM PARÁGRAFO POR ATOR que tenha argumento próprio — governo e autor, relator, órgãos públicos, entidades de classe, setor regulado, sociedade civil, academia, parlamentares, governos e parlamentares estrangeiros. Só divide parágrafo quem apenas REPETE o argumento de outro: nesse caso, um parágrafo com todos os nomes, o partido ou o setor de cada um e a frase "no mesmo sentido de…". Ordem: governo e Congresso, setores econômicos, entes e órgãos públicos, sociedade civil; dentro de cada grupo, favoráveis, com ressalvas, contrários. Cada parágrafo diz, em prosa: quem é o ator e o que ou quem representa (para entidade, os associados); a posição (favorável, favorável com ressalvas, contrário com ressalvas, contrário); sobre qual texto fala (o original ou o texto em votação); por que meio e em que data se manifestou (exposição de motivos, carta, nota, estudo, declaração a tal veículo); e o que defende, com TODOS os argumentos que a pesquisa registra e a evidência que apresenta (estudo, número, exemplo). Sempre atribuído: "a entidade sustenta que…", "segundo a empresa…". Nome completo da entidade, com a sigla. Não avalie o argumento aqui e não use tabela, lista nem tópicos. Comece pelos favoráveis (governo, relator, apoiadores) e siga para os contrários. Quem não se manifestou não ganha parágrafo: feche com um parágrafo dizendo quem, entre os diretamente afetados, NÃO teve manifestação localizada nas fontes pesquisadas. Todo ator da pesquisa (ids Q) aparece em algum parágrafo. O relator da Casa em que a matéria está ganha parágrafo próprio, com cada argumento do parecer dele que a leitura registrou (ids J), ainda que a pesquisa na internet não o traga.
- "sintese": um parágrafo que descreve, sem recomendar voto, como as posições se distribuem por grupo e por lado, quem lidera cada lado e o placar das votações já feitas (dados do programa). O programa imprime ao lado um quadro com a contagem por grupo.
- "lados" (seção "Os dois lados"): dois parágrafos por lado. Em "argumento", o melhor argumento do lado, nomeando quem o sustenta. Em "evidencia", o que o texto e os documentos mostram sobre o que esse lado afirma, ponto por ponto e com o artigo: o que se confirma; o que se confirma só em parte, e qual parte; o que o texto em votação ou a lei vigente contradizem; o que o substitutivo já atendeu; o que não há dado para verificar; e o que é divergência de mérito, que o texto não resolve. Se um argumento foi feito sobre a versão original e o texto em votação mudou a regra, diga. Avalia-se o ARGUMENTO, não a proposição: não diga quem tem razão no mérito nem se o texto deve ser aprovado.
- "da_analise": de 2 a 5 argumentos que a leitura do texto ou a comparação internacional sustentam e que ninguém levantou. São da assessoria e serão impressos como tal.
- "jurisdicoes": um bloco por país ou bloco da pesquisa internacional (ids W) — TODOS, no mínimo cinco quando a pesquisa os trouxer —, inclusive os que recuaram ou adiaram. Diga em "regra" qual mecanismo do texto brasileiro ele permite comparar. O país marcado como modelo oposto ("contraste") é apresentado como contraponto: diga em "regra" que lá o mecanismo é vedado, depende do Legislativo ou é mais estreito, e a que dispositivo do texto ele se opõe; ele entra também no "comparativo".
- "comparativo": a primeira coluna é sempre o Brasil. De 5 a 8 linhas com os parâmetros que permitem comparar (como funciona, quem é alcançado, duração, sanção, resultado até agora). Valor em moeda estrangeira vem acompanhado da conversão em reais pelo câmbio da base, com "cerca de".
- "licoes" e "limites": seja específico. Diga o que NÃO se pode concluir.
- Seção sem conteúdo na base: devolva a lista vazia. Não preencha com generalidades.

${PE5_SO_JSON}`;
}

function pe5PromptRedacao2(ctx) {
  return pe5RecortarRedacao(pe5PromptRedacao2Inteiro(ctx), ctx.parte);
}
function pe5PromptRedacao2Inteiro(ctx) {
  const fase = ctx.coleta?.fase || {};
  return `Você vai escrever a segunda metade de um parecer técnico para a assessoria de uma liderança partidária na Câmara dos Deputados: A ANÁLISE TÉCNICA, OS CAMINHOS e A ABERTURA (o resumo da primeira página). A primeira metade já está escrita e vem abaixo: NÃO repita o que ela já diz; refira-se aos temas sem recontá-los.

MATÉRIA: ${ctx.identificacao}
DATA DE HOJE: ${ctx.hoje}
FASE DA TRAMITAÇÃO (do programa): ${fase.descricao || '?'}${fase.jaVotadaNaCamara ? ' ATENÇÃO: a Câmara JÁ VOTOU. As opções não podem ser "aprovar" ou "rejeitar" na Câmara; trate do que ainda pode acontecer.' : ''}${fase.revisao ? ' ATENÇÃO: a Câmara só delibera sobre o que o Senado alterou.' : ''}

${PE5_ESTILO}

${PE5_REGRA_EV}

${ctx.parte === 'caminhos' ? '' : pe5Cobertura(ctx.leitura, ['achados', 'estimativas'])}

${pe5Base(ctx)}

PRIMEIRA METADE, JÁ ESCRITA:
${JSON.stringify(ctx.parte1 || {})}${ctx.analise ? `\n\nANÁLISE TÉCNICA, JÁ ESCRITA (os caminhos e a abertura partem dela; não a reescreva):\n${JSON.stringify(ctx.analise)}` : ''}

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
- "lentes": um ponto por achado relevante da leitura (ids T), agrupado por campo, do mais grave ao menos grave. Achados sobre o MESMO dispositivo e o mesmo problema viram UM ponto, com os identificadores de todos no "ev": a cobertura é conferida pelo "ev", não pelo número de pontos. O detalhe acompanha a gravidade — alta: exame completo, objeção e saída; média: exame em até 60 palavras, objeção e saída em uma frase cada; baixa: uma frase no exame, com "objecao" e "saida" vazios. Quando o parecer do relator responde ao ponto, a resposta dele vai em "objecao"; quando não responde, diga isso em "exame". Em "exame", explique; em "objecao", dê o melhor contra-argumento, inclusive regra parecida que já exista na lei vigente; em "saida", o que resolveria. Ponto que está regular (iniciativa, competência) entra uma vez, curto, com "objecao" e "saida" vazios. NÃO escreva sobre o que não se aplica: liste em "sem_achado".
- "jurisprudencia": só decisões que estão na pesquisa de contexto. Repita o que ela decidiu e o limite da analogia; não amplie o alcance da decisão.
- "judicializacao": de 0 a 6 itens. Um item para cada dispositivo que a análise apontou com gravidade alta ou média em matéria constitucional, de iniciativa, de competência, federativa ou orçamentária, e um para cada sinal da pesquisa (ids L). É exame de RISCO, não de mérito: diga onde a lei pode ser questionada depois de aprovada, por quem e com que argumento. NUNCA escreva que o dispositivo "é inconstitucional", "viola" ou "ofende" a Constituição: escreva "pode ser questionado com base em…", "a tese contrária é…". Em "quem", só legitimado do art. 103 da Constituição, parte diretamente atingida ou quem a pesquisa registra; não suponha intenção. Se não há ponto com esse perfil, devolva a lista vazia.
- "impacto": fiscal (CADA estimativa da leitura, ids S, com quem a produziu, para qual versão do texto e se foi refeita; a ausência de estimativa e a quem pedir; o que depende de ato facultativo do Executivo), econômico (quem paga, quem ganha, com os números da base e quem os produziu), implementação.
- "opcoes": as que existem NA FASE ATUAL, inclusive adiar, emendar e destacar, quando couber. Para cada uma, a consequência concreta. Sem recomendar.
- "emendas": de 2 a 7, só para problema apontado na análise. Redija o dispositivo de verdade, na técnica da lei que se altera. Onde a escolha for política (um número, um prazo), deixe entre colchetes.
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

${(ctx.apontamentos || []).length ? `O PROGRAMA JÁ CONFERIU O TEXTO E APONTOU O QUE SEGUE. Resolva CADA item: com uma correção (número sem base, ausência sem dizer onde se procurou, frase repetida a remover, sigla sem o nome por extenso) ou com um acréscimo (item lido ou pesquisado que ficou de fora). Só deixe para "observacoes" o que não tiver conserto pontual.
${ctx.apontamentos.map(x => `- ${x}`).join('\n')}
` : ''}
${pe5Base(ctx)}

PARECER A REVISAR:
${JSON.stringify(ctx.doc || {})}

O QUE DEVOLVER
{ "correcoes": [ { "trecho": "cópia EXATA de um pedaço do parecer (de 5 a 40 palavras), suficiente para localizá-lo", "novo": "o texto que deve entrar no lugar; vazio para apenas remover o trecho", "motivo": "o erro, em uma frase" } ],
  "acrescimos": [ { "depois_de": "cópia EXATA de um pedaço do parecer (de 5 a 40 palavras), no fim de uma frase; o texto novo entra logo depois dele, no mesmo bloco", "texto": "a frase ou as frases que faltam, só com o que está na base e no estilo do parecer", "ev": ["identificadores da base que sustentam o acréscimo"], "motivo": "o que estava faltando" } ],
  "observacoes": [ "problema que não se resolve trocando um trecho (seção que falta, lado do debate sem argumento, fonte fraca)" ] }
Se não houver erro nem falta, devolva { "correcoes": [], "acrescimos": [], "observacoes": [] }. Não proponha mudança de estilo que não corrija erro.

${PE5_SO_JSON}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PE5_ESTILO, PE5_GRUPOS_DEBATE, PE5_MIN_PESQUISA, pe5LadoAtor, pe5ContagemAtores, pe5FaltasPesquisa, pe5PromptPistas, pe5PistasLimpar, pe5PistasVazias, pe5PistasTexto, pe5ResumoColeta, pe5PromptLeitura, pe5PromptDebate, pe5PromptComplementar, pe5TesesConstitucionais, pe5EixosComparacao, pe5LeisAlteradas, pe5OrigensFaltantes, pe5TemasDelegados, pe5EhContraste, pe5NoticiasAgencias, pe5PromptInternacional, pe5PromptContexto, pe5PromptCongresso, pe5Base, pe5PromptRedacao1, pe5PromptRedacao2, pe5PromptRevisao, pe5RecortarRedacao };
}
