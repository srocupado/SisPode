/* ============================================================
   ROTEIROS DE ESPECIALISTA — v2, revisada pela Liderança

   Base: "Roteiros de Especialista — v2 (revisada e incrementada)",
   data-base setembro/2026. Este arquivo é a TRANSCRIÇÃO FIEL daquela
   revisão em forma executável. O conteúdo técnico é da casa; o que é meu
   aqui é só a estrutura de dados e as travas de validade.

   ESTRUTURA
     bloco 0    Processo legislativo e técnica legislativa — sempre acionado
     1 a 11     As lentes materiais (4A/4B e 5A/5B são desdobramentos)
     bloco 12   Método comum de PREVISTO × REALIZADO
     checklist  Saída obrigatória do parecer

   POR QUE ROTEIRO, E NÃO "ATUE COMO ESPECIALISTA"
   Persona muda registro e vocabulário de forma confiável; não muda acurácia.
   O que um especialista tem e o rótulo não carrega são as PERGUNTAS que ele é
   obrigado a responder, as FONTES que contam como autoridade e as ARMADILHAS
   típicas do campo. É isso que está codificado.

   TRÊS TRAVAS QUE ESTE ARQUIVO CARREGA

   1. FATO VOLÁTIL TEM DATA. Os blocos `regimeVigente` e os itens `confirmar`
      guardam coisas que mudam: calendário da transição tributária, número de
      lei recém-sancionada, estágio de ADI, tese de repercussão geral. Escrever
      isso como texto fixo é garantir que envelheça em silêncio. Cada bloco tem
      `atualizadoEm`, e `ressalvasDeValidade()` obriga o parecer a declarar o
      que está vencido — em vez de afirmar com confiança um número velho.

   2. O TEXTO ANALISADO É O PRIMEIRO CAMPO. A armadilha nº 1 do bloco 0 —
      "analisar o texto original quando o Plenário vai votar o substitutivo" —
      não se resolve com instrução ao modelo: resolve-se identificando o
      documento antes de gerar, e mostrando qual é.

   3. A LENTE DECLARA O GATILHO QUE A ACIONOU. O checklist exige isso, então
      `sugerirEspecialistas` devolve o termo que casou, e não só a lente.
   ============================================================ */

'use strict';

/** Regra de citação — vale para todas as lentes. */
const REGRA_CITACAO = 'Classe + número + órgão julgador + relator + data. '
  + 'Súmula Vinculante cita-se pelo número. Tema de repercussão geral cita-se pelo número do Tema e do RE '
  + 'paradigma. Precedente sem esses elementos não entra no parecer.';

/** Regra do campo jurídico — o parecer não profere veredicto. */
const REGRA_JURIDICA = 'O parecer produz PONTOS QUE MERECEM EXAME, com o dispositivo citado — não veredictos. '
  + 'Afirmação de inconstitucionalidade só ancorada em precedente citado com classe, número, órgão e data. '
  + '"Não identifiquei questão nesta linha" é resposta válida e esperada.';

/**
 * Acionamento: tema oficial da Câmara OU gatilho na ementa OU gatilho no texto
 * das emendas/substitutivo. O terceiro critério é o que captura a matéria que
 * entra no fim da tramitação — o caso do PL 914/2024 (Lei 14.902/2024), cuja
 * tributação não aparece em nenhum dos quatro temas oficiais.
 */
const ESPECIALISTAS = [

  // ==========================================================
  {
    chave: 'processo', ordem: '0', rotulo: 'Processo legislativo e técnica legislativa',
    sempre: true, transversal: true, temas: [53],
    gatilhos: [],
    perguntas: [
      'Qual a espécie normativa (PL, PLP, PEC, MP, PDL, PRC) e o rito aplicável em Plenário? Há urgência (RICD, arts. 152 a 155; CF, art. 64, §§ 1º a 4º) e qual o prazo dela?',
      'A matéria tramitou nas comissões de mérito? Qual o texto-base em Plenário: original, substitutivo da comissão, texto do relator de Plenário? Identificar com precisão qual texto está sendo analisado.',
      'Sendo PLP: quórum de maioria absoluta (art. 69). Sendo PEC: dois turnos, 3/5 (art. 60, § 2º), e limites circunstanciais e materiais (art. 60, §§ 1º e 4º).',
      'Sendo MP: prazo de vigência (art. 62, §§ 3º e 7º), regime de urgência e sobrestamento de pauta (§ 6º), comissão mista (Resolução 1/2002-CN) e vedação de reedição na mesma sessão legislativa (§ 10).',
      'Sendo PDL de sustação (art. 49, V): o ato do Executivo exorbita do poder regulamentar ou da delegação? Sendo PDL de tratado (art. 49, I): há reserva ou declaração interpretativa?',
      'Técnica legislativa (LC 95/1998): a ementa corresponde ao conteúdo? Há cláusula de vigência e vacatio compatível com a complexidade (art. 8º)? A revogação é expressa e enumerada (art. 9º)? Há alteração de lei sem indicação do dispositivo alterado (art. 12)?',
      'Há dispositivo que delega a ato infralegal o que a Constituição reserva à lei (art. 5º, II; art. 84, IV e VI)?',
    ],
    fontes: [
      'CF, arts. 59 a 69; RICD; RCCN; Resolução 1/2002-CN',
      'LC 95/1998 e Decreto 12.002/2023 (redação e consolidação de atos normativos) — confirmar número do decreto vigente',
      'Ficha de tramitação e pareceres das comissões (Infoleg / dadosabertos.camara.leg.br)',
    ],
    armadilhas: [
      'Analisar o texto original quando o Plenário vai votar o substitutivo. É o erro mais frequente e invalida o parecer inteiro.',
      'Tratar má técnica legislativa (LC 95) como vício de inconstitucionalidade. Não é; é ponto de redação.',
      'Esquecer que emenda de Plenário e destaque podem reintroduzir dispositivo já retirado em comissão.',
    ],
  },

  // ==========================================================
  {
    chave: 'constitucional', ordem: '1', rotulo: 'Constitucional',
    sempre: true, temas: [68, 53, 74, 76],
    gatilhos: ['altera a Lei', 'regulamenta o art', 'dispõe sobre', 'institui', 'cria',
      'Poder Executivo', 'Poder Judiciário', 'Ministério Público', 'Estados e Municípios',
      'aplica-se retroativamente', 'convalida', 'anistia'],
    perguntas: [
      'A iniciativa é regular? Verificar iniciativa privativa do Presidente (art. 61, § 1º), dos Tribunais (art. 96, II), do MP (art. 127, § 2º), do TCU (art. 73 c/c 96) e das Mesas (arts. 51, IV, e 52, XIII). Identificar quem efetivamente propôs. Vício de iniciativa não se convalida por sanção (STF, ADI 2.867, Pleno, rel. Min. Celso de Mello, j. 03/12/2003; superação da Súmula 5/STF).',
      'A competência legislativa é da União? Distinguir privativa (art. 22), concorrente (art. 24, com normas gerais pela União e suplementação estadual, §§ 1º a 4º), comum (art. 23) e municipal (art. 30, I e II). Citar o inciso.',
      'A matéria exige lei complementar? Verificar as reservas expressas (arts. 146, 146-A, 148, 153, VII, 154, I, 155, § 1º, III, 156-A, 163, 165, § 9º, 169, 195, § 11, 198, § 3º, entre outras). Lei ordinária em matéria reservada é vício formal insanável.',
      'Há emenda parlamentar que aumente despesa em projeto de iniciativa privativa do Executivo (art. 63, I) ou dos demais Poderes (art. 63, II)? Há emenda sem pertinência temática (RICD, art. 125; Resolução 1/2002-CN, art. 4º, § 4º, para MPs)?',
      'Sendo Medida Provisória: (a) a matéria está entre as vedações do art. 62, § 1º? (b) há emenda sem pertinência temática — "contrabando legislativo"? Precedente-líder: ADI 5.127, Pleno, red. p/ acórdão Min. Edson Fachin, j. 15/10/2015, com modulação prospectiva.',
      'Há retroatividade que atinja ato jurídico perfeito, direito adquirido ou coisa julgada (art. 5º, XXXVI)? Distinguir retroatividade própria (fato consumado) de retrospectividade (efeitos futuros de situação em curso) — o STF protege a primeira, não a segunda.',
      'A proposição impõe despesa a Estados, DF ou Municípios sem prever transferência de recursos? Vedação do art. 167, XIV (EC 128/2022). É o ponto federativo mais recorrente em PLs de política pública.',
      'Sendo PEC: viola cláusula pétrea (art. 60, § 4º)? Está vigente intervenção federal, estado de defesa ou de sítio (§ 1º)?',
      'Sendo lei orçamentária (PPA, LDO, LOA, crédito): cabe controle concentrado (ADI 4.048-MC, Pleno, rel. Min. Gilmar Mendes, j. 14/05/2008). A análise formal fica nesta lente; a material vai para a lente 3.',
      'Existe precedente do STF sobre o dispositivo alterado ou sobre norma de teor equivalente (inclui leis estaduais idênticas)? Citar; não havendo, dizer que não se localizou.',
    ],
    fontes: [
      'Constituição Federal — texto do dispositivo, transcrito',
      'Jurisprudência do STF (portal de jurisprudência e "A Constituição e o Supremo"), citada por classe, número, órgão, relator e data',
      'Súmulas Vinculantes e Temas de repercussão geral',
      'RICD, RCCN, Resolução 1/2002-CN',
      'Parecer da CCJC, quando já existir nos autos',
    ],
    armadilhas: [
      'Confundir vício FORMAL (iniciativa, competência, procedimento, veículo) com vício MATERIAL (conteúdo). Analisar em blocos separados.',
      'Tratar como inconstitucionalidade o que é apenas inconveniência ou má técnica legislativa.',
      'Afirmar entendimento do STF sem citar o julgado.',
      'Supor que competência concorrente exclui atuação estadual.',
      'Confundir "lei federal" com "lei nacional": norma da União sobre os próprios órgãos não vincula os Estados; norma geral do art. 24 vincula.',
      'Esquecer que vício de iniciativa e de reserva de LC não se convalidam por sanção nem por conversão de MP.',
    ],
  },

  // ==========================================================
  {
    chave: 'tributario', ordem: '2', rotulo: 'Tributário',
    temas: [70, 40],
    regimeVigente: {
      atualizadoEm: '2026-09',
      validadePor: 'LDO',
      texto: [
        'Transição da EC 132/2023 regulamentada pela LC 214/2025 (IBS, CBS, IS) e pela LC do Comitê Gestor do IBS (PLP 108/2024, convertida em jan/2026 — confirmar número).',
        '2026: ano-teste — CBS 0,9% e IBS 0,1%, compensáveis com PIS/Cofins; sem arrecadação efetiva.',
        '2027: CBS integral; extinção de PIS e Cofins; IPI reduzido a zero exceto produtos com industrialização na ZFM; início do IS.',
        '2029-2032: redução progressiva de ICMS e ISS e escalonamento do IBS.',
        '2033: extinção de ICMS e ISS; regime pleno.',
        'Qualquer proposição que altere PIS, Cofins, IPI, ICMS ou ISS deve ser lida contra este calendário.',
      ],
    },
    gatilhos: ['imposto', 'taxa', 'contribuição', 'alíquota', 'base de cálculo', 'isenção', 'imunidade',
      'crédito presumido', 'regime especial', 'Simples', 'Zona Franca', 'incentivo fiscal', 'renúncia',
      'drawback', 'importação', 'remessa', 'tributação', 'tributo', 'desoneração', 'reoneração',
      'compensação', 'refis', 'parcelamento', 'anistia', 'IBS', 'CBS', 'Imposto Seletivo', 'cashback'],
    perguntas: [
      'Qual a espécie tributária criada ou alterada (arts. 145, 148, 149, 149-A)? A espécie declarada corresponde à natureza do que foi instituído? (Taxa com base de cálculo própria de imposto viola o art. 145, § 2º — Súmula Vinculante 29 admite apenas elementos parciais.)',
      'De quem é a competência (arts. 153 a 156-A)? A proposição a respeita? Contribuição social nova exige LC (art. 195, § 4º c/c 154, I).',
      'A PARTIR DE QUANDO pode ser cobrado? Aplicar: anterioridade anual (art. 150, III, "b") e nonagesimal ("c"); exceções do art. 150, § 1º (II, IE, IOF, imposto extraordinário e empréstimo compulsório de guerra: nenhuma; IPI: só nonagesimal; IR: só anual; base de cálculo de IPTU/IPVA: só anual); contribuições do art. 195: só nonagesimal (§ 6º); MP que institui ou majora imposto só produz efeitos no exercício seguinte se convertida em lei até o último dia do exercício de edição (art. 62, § 2º), salvo II, IE, IPI, IOF e extraordinário; alteração de prazo de recolhimento não se sujeita à anterioridade (Súmula Vinculante 50); revogação ou redução de benefício equivale a majoração indireta e se sujeita à anterioridade. Entregar a data por tributo e por dispositivo — é a resposta operacional que o gabinete mais precisa.',
      'A matéria exige lei complementar (arts. 146, 146-A, 155, § 2º, XII, 156, III, 156-A, 195, § 11)? O veículo é adequado? Simples Nacional é matéria de LC (LC 123/2006).',
      'Há majoração com efeito retroativo (art. 150, III, "a")? Há efeito confiscatório a examinar (art. 150, IV)? Multa moratória acima de 20% e punitiva acima de 100% do tributo têm sido consideradas confiscatórias pelo STF — citar o julgado localizado.',
      'Havendo renúncia de receita: consta (a) estimativa de impacto no exercício e nos dois seguintes e (b) compensação ou demonstração de que a renúncia foi considerada na LOA (LRF, art. 14)? Consta a estimativa do art. 113 do ADCT? Observar o art. 4º da EC 109/2021 e o dispositivo da LDO do exercício.',
      'Qual o regime vigente antes da alteração — fato gerador, base de cálculo, alíquota, sujeito passivo, responsável — e o que exatamente muda? Apresentar em quadro lado a lado, com o texto da lei atual e o proposto.',
      'Como a medida se relaciona com a transição da EC 132/2023? O tributo é extinto, mantido ou absorvido? Um benefício criado hoje em PIS/Cofins expira em 2027 por perda do objeto; a nota deve dizer isso.',
      'Há efeito sobre repartição de receitas (arts. 157 a 162) — FPE, FPM, IPI-Exportação? Renúncia em IR ou IPI reduz transferência a Estados e Municípios; quantificar quando houver estimativa.',
      'Havendo estimativa oficial e vigência suficiente: comparar PREVISTO × REALIZADO na série da rubrica afetada (método do bloco 12).',
    ],
    fontes: [
      'CF, Sistema Tributário Nacional (arts. 145 a 162) e ADCT, arts. 113, 124 a 133',
      'CTN (Lei 5.172/1966); LC 214/2025; LC 123/2006',
      'LRF (LC 101/2000), art. 14; EC 109/2021, art. 4º',
      'Estimativa de impacto da exposição de motivos, do parecer ou do Demonstrativo de Gastos Tributários da RFB (DGT) — é o "previsto"',
      'Nota técnica da CONOF/CD ou CONORF/SF; estudos da IFI (Senado)',
      'Séries de arrecadação da RFB ("Análise da Arrecadação das Receitas Federais", mensal); Comex Stat (MDIC); Siga Brasil (Senado)',
    ],
    armadilhas: [
      'Comparar série NOMINAL com série REAL. Se nominal, dizer que é nominal.',
      'Atribuir à medida a variação observada. A nota mostra previsto × realizado com o marco de vigência; não afirma causa.',
      'Ignorar antecipação: o anúncio altera comportamento ANTES da vigência (estoques, remessas, importações) e contamina o "antes".',
      'Confundir alíquota nominal com carga efetiva.',
      'Errar a data de cobrança por esquecer anterioridade, art. 195, § 6º ou art. 62, § 2º. Erro de maior consequência prática do campo.',
      'Analisar benefício em PIS/Cofins/IPI/ICMS/ISS sem dizer que o tributo está em extinção.',
      'Esquecer o efeito sobre FPE/FPM.',
    ],
    series: [
      'Arrecadação mensal da rubrica afetada (RFB)',
      'Importação por NCM, quando houver efeito sobre comércio exterior (Comex Stat)',
      'Câmbio e IPCA para deflacionar (BCB/SGS, IBGE/SIDRA)',
    ],
    confirmar: [
      'Número da LC do Comitê Gestor do IBS (PLP 108/2024).',
      'Prática da casa quanto ao art. 113 do ADCT (o STF fixou que vincula todos os entes — ADI 6.303, Pleno, rel. Min. Roberto Barroso, j. 2022); confirmar qual dispositivo da LDO vigente é citado nos pareceres da CFT.',
    ],
  },

  // ==========================================================
  {
    chave: 'orcamentario', ordem: '3', rotulo: 'Orçamentário-financeiro',
    temas: [70],
    regimeVigente: {
      atualizadoEm: '2026-09',
      validadePor: 'LDO',
      texto: [
        'Regime Fiscal Sustentável: LC 200/2023. Limite de despesa primária cresce 70% da variação real da receita, com piso de 0,6% e teto de 2,5% reais ao ano (art. 3º). Meta de resultado primário na LDO, com banda de ±0,25 p.p. do PIB.',
        'PPA 2024-2027: Lei 14.802/2024.',
        'Emendas parlamentares: art. 166, §§ 9º a 20 (EC 86, 100, 105, 126); LC 210/2024, editada após a ADPF 854/STF.',
        'Piso da saúde: 15% da RCL (art. 198, § 2º, I). Piso da educação: 18% da receita de impostos (art. 212).',
      ],
    },
    gatilhos: ['despesa', 'crédito', 'dotação', 'orçamento', 'fundo', 'repasse', 'transferência',
      'subvenção', 'subsídio', 'financiamento', 'garantia da União', 'precatório', 'dívida',
      'emenda parlamentar', 'piso', 'vinculação', 'gratuidade', 'benefício', 'auxílio', 'bolsa',
      'programa', 'política nacional'],
    perguntas: [
      'A proposição cria ou aumenta despesa? Apresenta estimativa do impacto no exercício e nos dois seguintes (LRF, art. 16, I) e declaração de adequação orçamentária (art. 16, II)?',
      'Trata-se de despesa obrigatória de caráter continuado (mais de dois exercícios)? Há compensação por aumento permanente de receita ou redução permanente de despesa (LRF, art. 17, §§ 1º a 5º)?',
      'É compatível com PPA, LDO e LOA vigentes? Citar o dispositivo de cada uma. Aplicar a distinção da Norma Interna da CFT: ADEQUAÇÃO (cabe na dotação) × COMPATIBILIDADE (conforma-se às normas). Uma proposição pode ser compatível e inadequada.',
      'Como a despesa se acomoda no limite da LC 200/2023? Pressiona despesa discricionária (risco de contingenciamento, art. 9º da LRF)? Há gatilhos do art. 167-A e do art. 5º da LC 200?',
      'Havendo abertura de crédito: fonte indicada e admissível (art. 167, II e V; Lei 4.320/1964, art. 43)? Há vinculação de receita de imposto vedada (art. 167, IV)?',
      'A medida altera o regime das emendas parlamentares — impositividade, cotas, prazos, execução, RP 6/7/8/9? Observar a LC 210/2024 e as decisões da ADPF 854.',
      'A proposição cria fundo? Fundo especial exige LC para a matéria geral (art. 165, § 9º, II) e a vinculação de receita de imposto a fundo é vedada (art. 167, IV e IX).',
      'Há impacto sobre Estados e Municípios sem fonte (art. 167, XIV) — ver lente 1, questão 7?',
      'Há estimativa oficial anterior sobre a mesma matéria que permita comparar previsto × realizado?',
    ],
    fontes: [
      'LRF (LC 101/2000), arts. 15 a 17; LC 200/2023; Lei 4.320/1964',
      'PPA, LDO e LOA do exercício, com o dispositivo citado',
      'Norma Interna da CFT (29/05/1996) — critérios de adequação e compatibilidade',
      'Resolução 1/2006-CN (CMO) e Resolução 1/2002-CN (art. 19: adequação financeira de MPs)',
      'Nota técnica da CONOF/CD ou CONORF/SF',
      'Relatórios da IFI (RAF mensal); Relatório de Avaliação de Receitas e Despesas Primárias (bimestral, MPO/MF)',
    ],
    armadilhas: [
      'Confundir adequação orçamentária (existe dotação?) com mérito (vale a pena?).',
      'Tomar autorização de despesa por obrigação de gasto — e o inverso: "programa" com direito subjetivo cria obrigação.',
      'Tratar renúncia de receita como se não fosse impacto fiscal. Para a LC 200, renúncia reduz receita e portanto reduz o limite futuro de despesa.',
      'Somar impactos de exercícios diferentes sem trazer a valor presente ou sem dizer que a soma é nominal.',
      'Aceitar "não há impacto" da justificação sem verificar. Se a proposição cria direito, há impacto.',
    ],
    series: [
      'Execução da ação/programa (SIOP; Painel do Orçamento Federal; Tesouro Transparente; Siga Brasil)',
      'RREO e RGF (Tesouro Nacional)',
      'Séries da LOA e dos créditos adicionais do exercício',
    ],
    confirmar: [
      'Como a CFT vem redigindo o ponto do regime fiscal nos pareceres (se cita o art. 3º da LC 200 ou apenas a LDO). Pedir dois pareceres recentes da CFT como modelo.',
    ],
  },

  // ==========================================================
  {
    chave: 'administrativo', ordem: '4A', rotulo: 'Administrativo e servidor público',
    temas: [34, 58],
    gatilhos: ['cargo', 'carreira', 'remuneração', 'subsídio', 'gratificação', 'vencimento', 'reajuste',
      'reestruturação', 'concurso', 'provimento', 'nomeação', 'comissionado', 'função de confiança',
      'estabilidade', 'teto', 'acumulação', 'licitação', 'contrato administrativo', 'concessão',
      'permissão', 'empresa estatal', 'autarquia', 'fundação', 'processo administrativo', 'improbidade'],
    perguntas: [
      'Criação de cargos, alteração de carreira ou aumento de remuneração observa a iniciativa privativa do Poder respectivo (art. 61, § 1º, II, "a" e "c"; arts. 51, IV, 52, XIII, 96, II)?',
      'O aumento vem em lei específica, com prévia dotação e autorização na LDO (art. 37, X, e art. 169, § 1º, I e II)? Sem os dois requisitos a lei é válida mas ineficaz no exercício (STF, ADI 3.599 e RE 905.357, Tema 942 — citar após localizar).',
      'Impacto sobre despesa com pessoal e posição nos limites da LRF (arts. 19 e 20)? Distinguir limite de ALERTA (90%, art. 59, § 1º, II), PRUDENCIAL (95%, art. 22, parágrafo único) e MÁXIMO (art. 20).',
      'Esbarra na vedação de aumento de despesa com pessoal nos 180 dias finais do mandato (LRF, art. 21, II, na redação da LC 173/2020)?',
      'Efeito sobre o teto (art. 37, XI) e sobre acumulação (art. 37, XVI e XVII)? Verbas indenizatórias fora do teto exigem lei (art. 37, § 11).',
      'Provimento respeita o concurso público (art. 37, II)? Há efetivação, transposição ou ascensão sem concurso (Súmula Vinculante 43)? Há vantagem estendida por isonomia (Súmula Vinculante 37)?',
      'Há criação de cargo em comissão para função não típica de direção, chefia ou assessoramento (art. 37, V; STF, RE 1.041.210, Tema 1.010)?',
      'Contratação, licitação ou concessão: como se compõe com a Lei 14.133/2021, com a Lei 8.987/1995 e a Lei 11.079/2004? A LINDB (arts. 20 a 30) é observada em norma sobre responsabilização do gestor?',
      'Havendo estimativa de impacto de pessoal: comparar previsto × realizado na folha do órgão (Painel Estatístico de Pessoal / SIAPE).',
    ],
    fontes: [
      'CF, arts. 37 a 41 e art. 169',
      'Lei 8.112/1990; Lei 14.133/2021; Lei 9.784/1999; LINDB (Decreto-Lei 4.657/1942, arts. 20 a 30); Lei 8.429/1992 (redação da Lei 14.230/2021)',
      'LRF, arts. 18 a 23',
      'Estimativa de impacto de pessoal dos autos; Painel Estatístico de Pessoal (MGI)',
    ],
    armadilhas: [
      'Tratar reestruturação de carreira como se não fosse aumento de despesa.',
      'Ignorar o efeito sobre inativos e pensionistas com paridade (transição das EC 41/2003 e 47/2005).',
      'Confundir limite prudencial com limite máximo.',
      'Confundir revisão geral anual (art. 37, X, 2ª parte) com reajuste de carreira.',
      'Analisar cargo em comissão sem verificar as atribuições descritas — o nome do cargo não decide.',
    ],
    confirmar: [
      'Estágio da PEC de reforma administrativa (apresentada em 2025 na Câmara), para sinalizar conflito superveniente em parecer sobre carreira.',
    ],
  },

  // ==========================================================
  {
    chave: 'previdencia', ordem: '4B', rotulo: 'Previdência (RGPS e RPPS)',
    temas: [52],
    gatilhos: ['aposentadoria', 'pensão', 'benefício previdenciário', 'contribuição previdenciária',
      'INSS', 'regime próprio', 'regime geral', 'tempo de contribuição', 'idade mínima',
      'aposentadoria especial', 'BPC', 'fator previdenciário', 'salário-maternidade',
      'auxílio-doença', 'incapacidade', 'revisão de benefício', 'desaposentação', 'aposentadoria rural'],
    perguntas: [
      'Regra de ouro previdenciária: o benefício criado, majorado ou estendido tem fonte de custeio total (art. 195, § 5º)? Sem fonte, é inconstitucional.',
      'Como a medida se compõe com a EC 103/2019 — idades, regras de transição (arts. 15 a 20), cálculo (art. 26) e aposentadoria especial (art. 10, § 1º, e art. 21)?',
      'RPPS: a matéria exige LC (art. 40, § 1º, §§ 4º-A a 4º-C, § 22)? A União tem competência para norma geral (Lei 9.717/1998) ou está invadindo a competência do ente?',
      'Há estimativa de impacto atuarial (LRF, art. 24; EC 103, art. 9º)? Qual o horizonte (75 anos é o padrão do anexo IV da LDO — Projeções Atuariais do RGPS)?',
      'Há retroatividade ou revisão de benefícios já concedidos (art. 5º, XXXVI; decadência do art. 103 da Lei 8.213/1991)?',
      'Efeito sobre a Seguridade e sobre o resultado primário (art. 194; LC 200)?',
      'Havendo medida vigente: comparar previsto × realizado no estoque e no fluxo de concessão do benefício afetado.',
    ],
    fontes: [
      'CF, arts. 40, 194, 195 e 201 a 203; EC 103/2019',
      'Lei 8.212/1991 e Lei 8.213/1991; Decreto 3.048/1999; Lei 9.717/1998',
      'Anexo IV da LDO (projeções atuariais); Boletim Estatístico da Previdência Social (BEPS, mensal) e Anuário (AEPS)',
      'Nota técnica da Secretaria de Regime Geral (MPS) e da CONOF',
    ],
    armadilhas: [
      'Tratar benefício previdenciário como assistencial ou o inverso — a fonte de custeio e o regime jurídico mudam.',
      'Calcular impacto só no fluxo do ano, ignorando o estoque (concessão vitalícia).',
      'Ignorar que reduzir a contribuição é renúncia (lente 2, art. 14 da LRF) E reduz a fonte de custeio (art. 195, § 5º) — dupla verificação.',
    ],
  },

  // ==========================================================
  {
    chave: 'regulatorio', ordem: '5A', rotulo: 'Regulação setorial, concorrência e infraestrutura',
    temas: [40, 66, 37, 54, 61],
    gatilhos: ['agência reguladora', 'ANATEL', 'ANEEL', 'ANP', 'ANS', 'ANVISA', 'ANTT', 'ANTAQ',
      'ANAC', 'ANA', 'ANM', 'ANCINE', 'tarifa', 'outorga', 'concessão', 'licença', 'autorização',
      'regulação', 'marco regulatório', 'monopólio', 'mercado', 'concorrência', 'CADE',
      'infraestrutura', 'energia', 'telecomunicações', 'transporte', 'portos', 'saneamento',
      'mineração', 'petróleo', 'gás', 'combustíveis', 'preço', 'reajuste'],
    perguntas: [
      'Altera competência de agência? Como se compõe com a Lei 13.848/2019 (autonomia, mandatos, AIR no art. 6º) e com a competência normativa da agência?',
      'Há Análise de Impacto Regulatório (Lei 13.874/2019, art. 5º; Decreto 10.411/2020 — verificar se substituído pelo Decreto 12.002/2024)? Se não houver, dizer que não consta.',
      'Custo de conformidade e sobre quem recai? Distinguir grandes e pequenos operadores; ME/EPP (art. 170, IX; art. 179; LC 123/2006).',
      'Cria barreira à entrada, reserva de mercado ou assimetria entre concorrentes (art. 170, IV; Lei 12.529/2011)? Há manifestação do CADE nos autos?',
      'Altera contrato de concessão vigente? Há quebra de equilíbrio econômico-financeiro (art. 37, XXI; Lei 8.987/1995, art. 9º, § 4º) e passivo de reequilíbrio para a União?',
      'Há reflexo tarifário? Quem estimou e com que método? Se ninguém estimou, a nota diz que ninguém estimou.',
      'Há sobreposição com competência de Estados e Municípios (saneamento: Lei 14.026/2020; transporte urbano; gás canalizado, art. 25, § 2º)?',
      'Havendo medida vigente: comparar previsto × realizado nos indicadores do setor.',
    ],
    fontes: [
      'CF, arts. 170 a 175 e art. 21',
      'Lei 13.848/2019; Lei 13.874/2019; Lei 12.529/2011; Lei 8.987/1995; Lei 11.079/2004; Lei 14.133/2021',
      'Leis setoriais (9.472/1997 telecom; 9.478/1997 petróleo; 10.848/2004 energia; 14.026/2020 saneamento; 12.815/2013 portos)',
      'Notas técnicas da agência do setor; pareceres do CADE; acórdãos do TCU',
    ],
    armadilhas: [
      'Confundir desregulamentação com aumento de concorrência.',
      'Tomar interesse do regulado por interesse público, ou o contrário.',
      'Estimar efeito sobre preço sem fonte.',
      'Legislar sobre matéria já disciplinada por resolução da agência sem dizer o que muda na hierarquia.',
      'Ignorar o passivo de reequilíbrio contratual — é despesa futura da União e aciona a lente 3.',
    ],
    series: [
      'Índices de preço por subitem (IPCA/IBGE-SIDRA; IPA/FGV)',
      'Indicadores das agências (ANEEL, ANATEL, ANP)',
      'Investimento setorial (dados abertos das agências; BNDES)',
    ],
  },

  // ==========================================================
  {
    chave: 'consumidor', ordem: '5B', rotulo: 'Consumidor e relações privadas',
    temas: [67, 42],
    gatilhos: ['consumidor', 'fornecedor', 'CDC', 'contrato', 'cláusula abusiva', 'garantia',
      'cobrança', 'juros', 'superendividamento', 'crédito', 'cartão', 'plano de saúde', 'seguro',
      'telemarketing', 'publicidade', 'rotulagem', 'recall', 'responsabilidade civil', 'indenização',
      'dano moral', 'prescrição', 'locação', 'condomínio', 'família', 'sucessão', 'registro público', 'cartório'],
    perguntas: [
      'Competência: direito civil é privativo da União (art. 22, I); consumo é concorrente (art. 24, V e VIII). A proposição respeita a distinção?',
      'Como se compõe com o CDC (Lei 8.078/1990) e com o Código Civil? Há revogação tácita ou antinomia com norma geral?',
      'Há efeito sobre contratos em curso (art. 5º, XXXVI; CC, art. 2.035)? Explicitar aplicação a contratos anteriores.',
      'Há intervenção em preço ou juros (art. 170; art. 192)? Há conflito com regulação do CMN/BCB?',
      'Há efeito sobre litigiosidade (JEC, Justiça em Números/CNJ) e sobre inadimplência (BCB/SGS)?',
      'Há orientação do STJ (súmulas, Temas repetitivos) sobre a matéria? Citar.',
      'Havendo medida vigente: comparar previsto × realizado (reclamações, inadimplência, litigância).',
    ],
    fontes: [
      'CDC; Código Civil; Lei 14.181/2021 (superendividamento); Lei 14.711/2023 (garantias)',
      'STJ: súmulas e Temas repetitivos, citados por número',
      'Senacon (Sindec, consumidor.gov.br); BCB/SGS; CNJ (Justiça em Números)',
    ],
    armadilhas: [
      'Confundir norma protetiva do consumidor com norma de intervenção econômica — a segunda tem controle mais rígido no art. 170.',
      'Presumir que toda relação é de consumo (finalismo mitigado do STJ).',
      'Ignorar que teto de juros por lei ordinária esbarra na Súmula Vinculante 7 e na competência do CMN.',
    ],
  },

  // ==========================================================
  {
    chave: 'penal', ordem: '6', rotulo: 'Penal e processual penal',
    temas: [43, 57],
    gatilhos: ['crime', 'pena', 'reclusão', 'detenção', 'tipifica', 'agravante', 'qualificadora',
      'hediondo', 'prisão', 'inquérito', 'processo penal', 'competência criminal', 'prescrição',
      'execução penal', 'progressão', 'facção', 'organização criminosa', 'tráfico', 'arma',
      'violência', 'feminicídio', 'Maria da Penha', 'lavagem', 'corrupção', 'terrorismo'],
    perguntas: [
      'O tipo satisfaz a legalidade estrita e a taxatividade (art. 5º, XXXIX; CP, art. 1º)? Apontar elementos vagos ("ou qualquer outro meio", "atentar contra").',
      'A conduta já é abrangida por tipo existente? Sobreposição, bis in idem e conflito aparente.',
      'A pena é proporcional? Quadro comparativo com tipos análogos do CP e de leis especiais, citando artigo e pena. Apontar inversões (crime contra o patrimônio com pena maior que crime contra a vida).',
      'Efeitos sistêmicos: prescrição (CP, art. 109), regime inicial (art. 33), progressão (LEP, art. 112, na redação da Lei 13.964/2019), penas restritivas (art. 44), ANPP (CPP, art. 28-A), hediondez (Lei 8.072/1990 — exige inclusão expressa no rol).',
      'Direito intertemporal: lei mais gravosa não retroage (art. 5º, XL); mais benéfica retroage inclusive sobre coisa julgada (CP, art. 2º). Explicitar qual é o caso e a partir de quando.',
      'Sendo norma penal em branco: o complemento está definido? Remissão a ato infralegal viola reserva?',
      'Há efeito sobre a população prisional e existe estimativa nos autos? Não havendo, dizer que não há e dimensionar com a série.',
      'PROCESSO PENAL — altera competência (Justiça Federal, art. 109; Júri, art. 5º, XXXVIII), rito, prisão cautelar (CPP, arts. 311 a 316), prazos ou meios de obtenção de prova (interceptação, infiltração, colaboração)?',
      'PROCESSO PENAL — como se compõe com o juiz das garantias (CPP, arts. 3º-A a 3º-F, na conformação dada pelo STF nas ADIs 6.298, 6.299, 6.300 e 6.305, Pleno, j. 24/08/2023)?',
      'PROCESSO PENAL — há efeito sobre o sistema de justiça (varas, Defensoria, MP) e estimativa de custo? Se não houver, dizer.',
    ],
    fontes: [
      'CP; CPP; LEP (Lei 7.210/1984); Lei 8.072/1990; Lei 11.343/2006; Lei 12.850/2013; Lei 13.964/2019',
      'STF e STJ, citados por classe, número e data; Temas repetitivos do STJ',
      'RELIPEN — Relatório de Informações Penais (SENAPPEN/MJSP, semestral; sucedeu o Infopen/SISDEPEN)',
      'Anuário Brasileiro de Segurança Pública (FBSP); Atlas da Violência (IPEA/FBSP); SINESP (MJSP)',
      'CNJ: Justiça em Números; BNMP; painéis de execução penal',
    ],
    armadilhas: [
      'Tratar aumento de pena como resposta suficiente sem examinar se a conduta já é criminalizada e por que a norma vigente não é aplicada.',
      'Ignorar a desproporção criada em relação a crimes mais graves — efeito colateral mais comum da inflação penal.',
      'Afirmar efeito dissuasório sem fonte.',
      'Confundir vigência da lei com punibilidade da conduta.',
      'Esquecer que MP não pode tratar de direito penal e processual penal (art. 62, § 1º, I, "b").',
      'Ignorar precedente que redefine o tipo: RE 635.659, Tema 506 (porte de cannabis para uso pessoal, tese fixada em 26/06/2024).',
    ],
    series: [
      'População prisional, perfil por tipo penal e ocupação (RELIPEN/SENAPPEN)',
      'Registros de ocorrência (SINESP; Anuário FBSP)',
      'Processos criminais novos e pendentes (CNJ)',
    ],
    confirmar: [
      'URL atual do portal de dados do SENAPPEN (gov.br/senappen).',
      'Estágio da PEC da Segurança Pública e do PL "antifacção" (2025-2026), antes de parecer sobre organização criminosa.',
    ],
  },

  // ==========================================================
  {
    chave: 'ambiental', ordem: '7', rotulo: 'Meio ambiente e clima',
    temas: [48, 51, 64, 54],
    regimeVigente: {
      atualizadoEm: '2026-09',
      validadePor: 'evento',
      texto: [
        'Lei Geral do Licenciamento Ambiental: Lei 15.190, de 08/08/2025, sancionada com vetos; a maior parte dos vetos foi derrubada pelo Congresso em 27/11/2025.',
        'Licença Ambiental Especial (LAE): MP 1.308/2025, convertida em lei — confirmar número.',
        'Há ADIs em curso no STF contra a LGLA — confirmar números e eventual liminar antes de qualquer parecer.',
        'Mercado regulado de carbono (SBCE): Lei 15.042/2024.',
        'NDC brasileira: redução de 59% a 67% das emissões até 2035 em relação a 2005 (apresentada em nov/2024).',
      ],
    },
    gatilhos: ['ambiental', 'licenciamento', 'licença', 'APP', 'reserva legal', 'unidade de conservação',
      'desmatamento', 'floresta', 'bioma', 'Amazônia', 'Cerrado', 'Pantanal', 'Mata Atlântica',
      'clima', 'emissões', 'carbono', 'recursos hídricos', 'água', 'outorga', 'resíduos', 'poluição',
      'agrotóxico', 'fauna', 'pesca', 'mineração', 'terra indígena', 'quilombola', 'CAR', 'PRA'],
    perguntas: [
      'Competência: comum de proteção (art. 23, VI e VII), legislativa concorrente (art. 24, VI e VIII) e repartição administrativa da LC 140/2011. A União pode editar norma geral; pode esvaziar a competência estadual de licenciar?',
      'Altera exigência de licenciamento? Qual etapa (LP, LI, LO, LAC, LAE), para qual atividade, e o que deixa de ser exigido? Ler contra a Lei 15.190/2025 e a Resolução CONAMA 237/1997 no que subsistir.',
      'Altera PADRÃO DE PROTEÇÃO (APP, Reserva Legal, UC, espécie protegida) ou apenas PROCEDIMENTO? A nota diz explicitamente qual dos dois.',
      'Como se compõe com o Código Florestal (Lei 12.651/2012), o SNUC (Lei 9.985/2000), a PNMA (Lei 6.938/1981), a Lei da Mata Atlântica (Lei 11.428/2006) e a PNRH (Lei 9.433/1997)?',
      'Há efeito sobre compromissos internacionais (Acordo de Paris; NDC) ou sobre o SBCE? Se houver estimativa oficial de emissões, citar; não havendo, dizer.',
      'Há manifestação técnica do órgão ambiental (IBAMA, ICMBio, MMA, ANA) nos autos?',
      'Há terra indígena ou quilombola afetada? Como se compõe com o art. 231, a Lei 14.701/2023 e o Tema 1.031/STF (RE 1.017.365, j. 27/09/2023)?',
      'Havendo medida vigente: comparar previsto × realizado nos indicadores pertinentes.',
    ],
    fontes: [
      'CF, art. 225 e art. 231; LC 140/2011',
      'Lei 15.190/2025; Lei 12.651/2012; Lei 9.985/2000; Lei 6.938/1981; Lei 15.042/2024',
      'Notas técnicas de IBAMA, ICMBio, MMA e ANA, quando nos autos',
      'PRODES e DETER (INPE/TerraBrasilis) — série oficial de desmatamento',
      'Inventário Nacional de Emissões (MCTI/SIRENE) — oficial; SEEG (Observatório do Clima) — estimativa não governamental, mais frequente',
    ],
    armadilhas: [
      'Apresentar simplificação de procedimento como redução de proteção, ou o inverso.',
      'Invocar "vedação ao retrocesso ambiental" como regra pacificada — é princípio de aplicação controvertida.',
      'Atribuir variação de desmatamento a uma norma: as séries têm sazonalidade e dependem de fiscalização, preço de commodity e câmbio.',
      'Confundir licenciamento federal com estadual sem verificar a LC 140.',
      'Citar SEEG como se fosse dado oficial. É referência aceita, mas a nota deve dizer a origem.',
    ],
    series: [
      'Desmatamento por bioma (PRODES anual, DETER alertas)',
      'Autos de infração e embargos (IBAMA, dados abertos)',
      'Emissões por setor (SIRENE oficial; SEEG anual)',
      'Focos de calor (INPE/BDQueimadas)',
    ],
    confirmar: [
      'Número da lei de conversão da MP 1.308/2025 (LAE).',
      'Estado das ADIs no STF contra a Lei 15.190/2025 e eventual liminar. Enquanto não confirmado, todo parecer ambiental carrega a ressalva.',
    ],
  },

  // ==========================================================
  {
    chave: 'saude', ordem: '8', rotulo: 'Saúde',
    temas: [56],
    gatilhos: ['SUS', 'saúde', 'medicamento', 'vacina', 'ANVISA', 'ANS', 'plano de saúde', 'CONITEC',
      'incorporação', 'tratamento', 'doença', 'hospital', 'atenção básica', 'piso da enfermagem',
      'agente comunitário', 'farmácia popular', 'registro sanitário', 'cannabis medicinal', 'tabaco',
      'álcool', 'rotulagem', 'obesidade', 'telessaúde'],
    perguntas: [
      'Competência: concorrente (art. 24, XII) e comum (art. 23, II); SUS como sistema único com direção por esfera (art. 198, I; Lei 8.080/1990, art. 9º). A União está criando obrigação para gestores estaduais/municipais sem fonte (art. 167, XIV)?',
      'Incorporação de tecnologia: a proposição determina fornecimento pelo SUS por lei, contornando o rito da CONITEC (Lei 8.080, arts. 19-Q e 19-R, incluídos pela Lei 12.401/2011)? Há avaliação de custo-efetividade nos autos?',
      'Como se compõe com os Temas 6 e 1.234 do STF (medicamentos de alto custo e não incorporados; teses fixadas em 2024) — a lei cria direito subjetivo que amplia a judicialização?',
      'Registro sanitário: a lei dispensa ou impõe registro da ANVISA (Lei 9.782/1999; Lei 6.360/1976)? Há invasão de competência técnica da agência?',
      'Impacto financeiro no piso da saúde (art. 198, § 2º; LC 141/2012) e no orçamento do MS — estimativa? Ver lente 3.',
      'Planos de saúde: altera o rol da ANS ou a Lei 9.656/1998 (Lei 14.454/2022 sobre rol exemplificativo)? Efeito sobre preço e sinistralidade estimado?',
      'Havendo política vigente: comparar previsto × realizado em cobertura, gasto e desfecho.',
    ],
    fontes: [
      'CF, arts. 196 a 200; Lei 8.080/1990; Lei 8.142/1990; LC 141/2012; Lei 9.782/1999; Lei 9.656/1998',
      'Relatórios e recomendações da CONITEC; notas técnicas do MS e da ANVISA nos autos',
      'DATASUS/TABNET (SIH, SIA, SIM, SINASC, SINAN); SIOPS; painéis da ANS',
    ],
    armadilhas: [
      'Criar direito subjetivo a tratamento por lei sem estimativa: a despesa é obrigatória e continuada (LRF, art. 17) e aciona a lente 3.',
      'Confundir registro sanitário (ANVISA) com incorporação ao SUS (CONITEC) — são etapas distintas.',
      'Tratar rol da ANS como exaustivo após a Lei 14.454/2022.',
      'Atribuir a uma lei variação de indicador de saúde com forte tendência secular.',
    ],
  },

  // ==========================================================
  {
    chave: 'educacao', ordem: '9', rotulo: 'Educação',
    temas: [46],
    gatilhos: ['educação', 'escola', 'ensino', 'LDB', 'FUNDEB', 'PNE', 'professor', 'magistério',
      'universidade', 'IFES', 'cotas', 'ENEM', 'FIES', 'PROUNI', 'creche', 'alfabetização',
      'currículo', 'BNCC', 'cívico-militar', 'homeschooling', 'merenda', 'PNAE', 'livro didático'],
    perguntas: [
      'Competência: art. 22, XXIV (privativa da União para DIRETRIZES E BASES) e art. 24, IX (concorrente para educação). Municípios atuam prioritariamente no fundamental e infantil (art. 211, § 2º); Estados no médio (§ 3º). A União está impondo obrigação de oferta a outro ente (art. 167, XIV)?',
      'Como se compõe com a LDB (Lei 9.394/1996) e com o PNE vigente (Lei 13.005/2014, prorrogada pela Lei 14.934/2024; novo PNE — PL 2.614/2024 — verificar se sancionado)?',
      'Impacto no FUNDEB (art. 212-A; Lei 14.113/2020): altera ponderações, complementação da União (VAAF, VAAT, VAAR) ou destinação de 70% a profissionais?',
      'Piso do magistério (Lei 11.738/2008): a proposição altera critério ou reajuste? Impacto sobre folhas municipais?',
      'Vinculação de receita (art. 212): a despesa conta como MDE (LDB, arts. 70 e 71)? Há risco de desvirtuamento?',
      'Currículo e BNCC: matéria de lei ou de ato do CNE? Há invasão de competência técnica?',
      'Havendo política vigente: comparar previsto × realizado em matrícula, IDEB/SAEB e gasto.',
    ],
    fontes: [
      'CF, arts. 205 a 214 e art. 212-A',
      'LDB; Lei 14.113/2020; Lei 11.738/2008; Lei 13.005/2014',
      'INEP: Censo Escolar, IDEB, SAEB, Censo da Educação Superior; SIOPE; FNDE',
    ],
    armadilhas: [
      'Confundir política nacional (indutiva, com adesão) com obrigação de oferta (impositiva).',
      'Ignorar que a maior parte do gasto é municipal e estadual: impacto na União pode ser pequeno e o impacto sistêmico, grande.',
      'Tratar indicador de aprendizagem (SAEB) como se respondesse a uma lei em prazo curto.',
    ],
  },

  // ==========================================================
  {
    chave: 'trabalho', ordem: '10', rotulo: 'Trabalho, emprego e assistência social',
    temas: [58, 52, 44],
    gatilhos: ['trabalho', 'trabalhador', 'emprego', 'CLT', 'jornada', 'escala 6x1', 'salário mínimo',
      'FGTS', 'seguro-desemprego', 'abono', 'terceirização', 'aplicativo', 'plataforma', 'motorista',
      'entregador', 'doméstico', 'estágio', 'aprendiz', 'sindicato', 'contribuição sindical', 'greve',
      'assédio', 'igualdade salarial', 'Bolsa Família', 'BPC', 'LOAS', 'CadÚnico', 'SUAS', 'CRAS',
      'vale-gás', 'tarifa social', 'auxílio'],
    perguntas: [
      'Competência: direito do trabalho é privativo da União (art. 22, I); assistência social é concorrente na execução (art. 23, II; art. 204).',
      'A proposição altera direito do art. 7º? Redução só por negociação coletiva onde o inciso permite (VI, XIII, XIV). Como se compõe com a reforma trabalhista (Lei 13.467/2017) e com o entendimento do STF sobre negociado × legislado (Tema 1.046)?',
      'Regulação de trabalho por plataforma: vínculo, autônomo ou categoria própria? Efeito previdenciário (lente 4B) e tributário (lente 2).',
      'Benefício assistencial: fonte de custeio (art. 195, § 5º; art. 204), critério de elegibilidade (LOAS, art. 20; Lei 14.601/2023 para o Bolsa Família), impacto como despesa obrigatória (LRF, art. 17) e posição no limite da LC 200.',
      'Há efeito sobre a folha de pagamento das empresas e sobre a arrecadação previdenciária? Estimativa?',
      'Havendo medida vigente: comparar previsto × realizado em emprego formal, rendimento e cobertura.',
    ],
    fontes: [
      'CF, arts. 7º a 11 e 203 a 204',
      'CLT; Lei 8.036/1990 (FGTS); Lei 7.998/1990; Lei 8.742/1993 (LOAS); Lei 14.601/2023',
      'PNAD Contínua (IBGE); Novo CAGED e RAIS (MTE); Cadastro Único e painéis do MDS; BEPS (BPC)',
    ],
    armadilhas: [
      'Confundir custo para a empresa com custo fiscal: são lentes diferentes (5A e 3).',
      'Tratar BPC como previdência — é assistência e não exige contribuição.',
      'Estimar efeito sobre emprego a partir da justificação sem fonte.',
    ],
  },

  // ==========================================================
  {
    chave: 'digital', ordem: '11', rotulo: 'Digital, proteção de dados e inteligência artificial',
    temas: [62, 37],
    gatilhos: ['internet', 'plataforma digital', 'rede social', 'aplicativo', 'dados pessoais', 'LGPD',
      'ANPD', 'inteligência artificial', 'algoritmo', 'deepfake', 'moderação', 'remoção', 'fake news',
      'jogos eletrônicos', 'apostas', 'criptoativo', 'cibersegurança', 'identidade digital',
      'governo digital', 'assinatura eletrônica', 'direitos autorais'],
    perguntas: [
      'Competência: direito civil, comercial e telecomunicações são privativos (art. 22, I e IV); proteção de dados é privativa da União (art. 22, XXX, EC 115/2022) e direito fundamental (art. 5º, LXXIX).',
      'Como se compõe com o Marco Civil (Lei 12.965/2014 — observar o Tema 987/STF sobre o art. 19, j. 2025), a LGPD (Lei 13.709/2018) e o ECA Digital (Lei 15.211/2025, vigente desde março/2026)?',
      'Há dever de remoção, moderação ou monitoramento que alcance a liberdade de expressão (art. 5º, IV e IX; art. 220)? Há definição suficiente do conteúdo ilícito ou termo aberto?',
      'IA: há marco legal geral em vigor ou em tramitação (PL 2.338/2023 — verificar estágio)? A proposição cria regime setorial que conflitará com a norma geral?',
      'Há invasão da competência regulatória da ANPD (Lei 14.460/2022) ou da ANATEL?',
      'Custo de conformidade e efeito sobre pequenos agentes de tratamento (LGPD, art. 55-J, XVIII)?',
      'Havendo medida vigente: comparar previsto × realizado (notificações de incidente, remoções, acessos).',
    ],
    fontes: [
      'CF, art. 5º, IV, IX, X, XII e LXXIX; art. 22, XXX',
      'Lei 12.965/2014; Lei 13.709/2018; Lei 15.211/2025; Lei 14.460/2022; Lei 12.737/2012; Lei 14.155/2021',
      'Resoluções e notas técnicas da ANPD; relatórios do CGI.br (TIC Domicílios, TIC Kids)',
      'STF, Tema 987 (responsabilidade de provedores)',
    ],
    armadilhas: [
      'Legislar sobre tecnologia específica em vez de função — a norma envelhece em meses.',
      'Criar dever de monitoramento geral sem dizer que o faz.',
      'Ignorar que a regra de responsabilidade de plataforma já foi redesenhada pelo STF (Tema 987) e que a lei nova pode conflitar com a tese.',
    ],
    confirmar: [
      'Estágio do PL 2.338/2023 (IA) na Câmara e se houve sanção.',
      'Data exata da tese do Tema 987 e seu texto para citação.',
    ],
  },
];

/**
 * MÉTODO COMUM — previsto × realizado. Aplica-se a todas as lentes.
 * A frase padrão é o que impede a nota de virar afirmação causal.
 */
const METODO_PREVISTO_REALIZADO = {
  entrega: [
    'PREVISTO: o número oficial, com fonte, data e hipóteses. Sem estimativa oficial, dizer que não há e NÃO substituir por estimativa própria.',
    'MARCO: data de vigência efetiva (após anterioridade, vacatio ou regulamentação), não a data de publicação.',
    'REALIZADO: série da rubrica afetada, na mesma unidade e periodicidade do previsto, deflacionada quando o previsto for real (IPCA/IBGE) ou declarada nominal.',
    'JANELA: no mínimo 12 meses antes e 12 depois do marco, quando disponíveis. Assinalar sazonalidade.',
    'CONTAMINAÇÃO DO "ANTES": antecipação de comportamento após o anúncio (datas da proposição, da aprovação e da sanção como marcos secundários).',
    'FATORES CONCORRENTES: listar ao menos os macroeconômicos (câmbio, atividade, preço de commodity) e normativos (outra lei no mesmo período). NÃO estimar a contribuição de cada um.',
  ],
  fraseP: 'A série mostra X após o marco; a estimativa oficial previa Y. A nota não atribui a diferença à medida.',
  niveis: {
    A: 'estimativa oficial + série pública comparável + vigência ≥ 12 meses',
    B: 'estimativa oficial + série, mas vigência < 12 meses ou série com quebra metodológica',
    C: 'sem estimativa oficial ou sem série comparável — a nota apenas descreve a série',
  },
  fontesTransversais: [
    'BCB/SGS (câmbio, juros, crédito, inadimplência)',
    'IBGE/SIDRA (IPCA por subitem, PNAD, PIB)',
    'Tesouro Transparente e Siga Brasil (execução)',
    'RFB (arrecadação); Comex Stat (comércio exterior)',
    'IPEADATA (séries longas consolidadas)',
  ],
};

/** Checklist de saída — o parecer não fecha sem isto. */
const CHECKLIST_SAIDA = [
  'Texto analisado identificado (original, substitutivo, relator de Plenário) com data.',
  'Lentes acionadas listadas, com o gatilho que acionou cada uma.',
  'Cada lente responde às PERGUNTAS ou registra "não identifiquei questão nesta linha".',
  'Toda afirmação de inconstitucionalidade tem precedente citado com classe, número, órgão e data.',
  'Data de produção de efeitos entregue por dispositivo (lente 2) quando houver tributo.',
  'Impacto fiscal: estimativa citada ou ausência declarada; enquadramento na LC 200 (lente 3).',
  'Art. 167, XIV verificado quando houver obrigação a Estados/Municípios.',
  'Previsto × realizado com nível de evidência declarado, quando houver medida vigente.',
  'Itens ">> CONFIRMAR" da lente pertinente citados como ressalva se ainda não resolvidos pela casa.',
];

// ============================================================
//  ACIONAMENTO
// ============================================================

/** Casamento de gatilho tolerante a acento e caixa, respeitando limite de palavra. */
function _casaGatilho(texto, termo) {
  const norm = s => String(s).normalize('NFD').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  const t = norm(texto), g = norm(termo).trim();
  if (!g) return false;
  return new RegExp(`(^|\\s)${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(t);
}

/**
 * Sugere as lentes de uma proposição.
 *
 * Três critérios, na ordem da revisão v2: tema oficial da Câmara, gatilho na
 * ementa, gatilho no texto das emendas ou do substitutivo. O terceiro existe
 * porque os dois primeiros falham no caso que originou tudo isto — o PL
 * 914/2024, cuja tributação entrou por emenda e não aparece em nenhum dos
 * quatro temas oficiais.
 *
 * Devolve o TERMO que acionou cada lente, porque o checklist de saída exige
 * que o parecer declare o gatilho.
 */
function sugerirEspecialistas({ temas = [], ementa = '', textoEmendas = '' } = {}) {
  const codigos = new Set((temas || []).map(t => Number(t.codTema ?? t)));
  const out = [];

  for (const e of ESPECIALISTAS) {
    const porTema = (e.temas || []).filter(c => codigos.has(c));
    const naEmenta = (e.gatilhos || []).find(g => _casaGatilho(ementa, g));
    const noTexto = (e.gatilhos || []).find(g => _casaGatilho(textoEmendas, g));
    if (!e.sempre && !porTema.length && !naEmenta && !noTexto) continue;

    const motivos = [];
    if (e.sempre) motivos.push('sempre acionada');
    if (porTema.length) motivos.push(`tema oficial da Câmara (${porTema.join(', ')})`);
    if (naEmenta) motivos.push(`gatilho na ementa: "${naEmenta}"`);
    if (noTexto && noTexto !== naEmenta) motivos.push(`gatilho no texto das emendas/substitutivo: "${noTexto}"`);

    out.push({
      chave: e.chave, ordem: e.ordem, rotulo: e.rotulo,
      transversal: !!e.transversal,
      gatilho: naEmenta || noTexto || null,
      // Só pelo tema não teria acionado — é o caso que o terceiro critério salva.
      soPorTexto: !e.sempre && !porTema.length,
      motivo: motivos.join('; '),
      perguntas: (e.perguntas || []).length,
    });
  }
  return out;
}

/**
 * Ressalvas de validade: o que está vencido ou pendente de confirmação.
 *
 * Fato volátil escrito como texto fixo envelhece em silêncio — e um parecer que
 * afirma com confiança um calendário tributário do ano passado é pior que um
 * parecer omisso. `mesesDeValidade` é conservador de propósito.
 */
function ressalvasDeValidade(chaves = [], hoje = new Date(), mesesDeValidade = 6) {
  const alvo = chaves.length ? ESPECIALISTAS.filter(e => chaves.includes(e.chave)) : ESPECIALISTAS;
  const ressalvas = [];
  for (const e of alvo) {
    if (e.regimeVigente?.atualizadoEm) {
      const [a, m] = e.regimeVigente.atualizadoEm.split('-').map(Number);
      const meses = (hoje.getFullYear() - a) * 12 + (hoje.getMonth() + 1 - m);
      if (meses > mesesDeValidade) {
        ressalvas.push({ lente: e.rotulo, tipo: 'regime',
          texto: `O quadro de regime vigente da lente ${e.rotulo} foi atualizado em ${e.regimeVigente.atualizadoEm} `
            + `(há ${meses} meses) e sua validade é revista ${e.regimeVigente.validadePor === 'LDO' ? 'a cada LDO' : 'por evento'}. `
            + 'Confirme antes de usar os números deste bloco.' });
      }
    }
    for (const c of (e.confirmar || [])) {
      ressalvas.push({ lente: e.rotulo, tipo: 'confirmar', texto: c });
    }
  }
  return ressalvas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ESPECIALISTAS, METODO_PREVISTO_REALIZADO, CHECKLIST_SAIDA,
    REGRA_CITACAO, REGRA_JURIDICA,
    sugerirEspecialistas, ressalvasDeValidade,
  };
}
