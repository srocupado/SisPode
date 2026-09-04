/* ============================================================
   ROTEIROS DE ESPECIALISTA — o miolo do "Parecer de Especialista"

   PROPOSTA PARA REVISÃO. Nada aqui é definitivo: os roteiros são a régua
   técnica da casa, e quem a tem é a Liderança e a consultoria. O campo
   `revisar` de cada lente marca os pontos em que EU não tenho segurança — é
   por eles que a revisão deve começar.

   POR QUE ROTEIRO, E NÃO "ATUE COMO ESPECIALISTA"

   Dizer ao modelo "você é um tributarista" muda registro e vocabulário de
   forma confiável. Não melhora acurácia de forma confiável, e às vezes piora:
   produz prosa com cara de parecer sem o conteúdo de um. O que um especialista
   humano tem, e o rótulo não carrega, são três coisas — e são estas que os
   roteiros codificam:

     perguntas   o que o parecer é OBRIGADO a responder naquele campo
     fontes      o que conta como autoridade ali (e o que não conta)
     armadilhas  os erros típicos daquele campo, ditos para serem evitados

   A TRAVA QUE O CAMPO JURÍDICO EXIGE

   Um roteiro que pergunta "há vício de iniciativa?" convida a responder sim ou
   não com confiança. Num documento da Liderança isso é perigoso: afirmação de
   inconstitucionalidade é opinião jurídica com consequência. Por isso o parecer
   produz PONTOS QUE MERECEM EXAME, com o dispositivo citado — e só vira
   afirmação quando ancorada em precedente efetivamente citado com fonte.
   "Não identifiquei questão nesta linha" é resposta válida e esperada.

   COMO A LENTE É ESCOLHIDA

   Pelos temas oficiais da Câmara (32, medidos em 04/09/2026 no endpoint
   /referencias/proposicoes/codTema) MAIS gatilhos na ementa. Os dois, porque o
   tema oficial sozinho falha: o PL 914/2024 — o Mover, que veiculou a taxa das
   blusinhas — volta com Ciência e Tecnologia, Finanças Públicas, Meio Ambiente
   e Transporte. A tributação entrou por emenda no fim da tramitação e NÃO
   aparece como tema. Escolhendo só pelo tema, o parecer da taxa das blusinhas
   sairia sem a lente tributária.

   A sugestão é sempre revisável pelo analista antes de rodar.
   ============================================================ */

'use strict';

/**
 * As sete lentes. Uma proposição normalmente aciona mais de uma — no PL 914
 * seriam pelo menos tributária, orçamentária e ambiental.
 */
const ESPECIALISTAS = [

  // ==========================================================
  {
    chave: 'constitucional',
    rotulo: 'Constitucional',
    // Aplica-se a QUASE TUDO: iniciativa e competência são perguntas de
    // qualquer projeto. Por isso vem sugerida sempre, e não por tema.
    sempre: true,
    temas: [68, 53, 74, 76],
    gatilhos: /constitui|emenda\s+[àa]\s+constitui|compet[êe]ncia|inicia|PEC\b/i,

    perguntas: [
      'A iniciativa é regular? Verificar se a matéria é de iniciativa privativa do Presidente da República (art. 61, § 1º) ou de outro Poder, e quem efetivamente a propôs.',
      'A competência legislativa é da União? Distinguir privativa (art. 22), concorrente (art. 24) e municipal (art. 30), citando o inciso aplicável.',
      'A matéria exige lei complementar? Se sim, o veículo escolhido é adequado (art. 146, art. 163 e demais reservas expressas)?',
      'Há emenda parlamentar que aumente despesa em projeto de iniciativa privativa do Executivo (art. 63, I)?',
      'Sendo Medida Provisória: a matéria está entre as vedações do art. 62, § 1º? Há pertinência temática entre a MP original e o que se acrescentou (o STF já anulou dispositivos por "contrabando legislativo")?',
      'Há retroatividade que atinja ato jurídico perfeito, direito adquirido ou coisa julgada (art. 5º, XXXVI)?',
      'Existe precedente do STF sobre o dispositivo alterado ou sobre norma de teor equivalente? Citar processo e data; não havendo, dizer que não se localizou.',
    ],
    fontes: [
      'Constituição Federal — texto do dispositivo, transcrito',
      'Jurisprudência do STF, citada por classe, número e data de julgamento',
      'Regimento Interno da Câmara e do Congresso, quando a questão for de processo legislativo',
      'Parecer da CCJC, quando já existir nos autos',
    ],
    armadilhas: [
      'Confundir vício FORMAL (iniciativa, competência, procedimento) com vício MATERIAL (conteúdo incompatível com a Constituição). São análises distintas e a nota deve separá-las.',
      'Tratar como inconstitucionalidade o que é apenas inconveniência ou má técnica legislativa.',
      'Afirmar entendimento do STF sem citar o julgado. Sem citação verificável, a afirmação não entra.',
      'Supor que a competência concorrente exclui a atuação estadual — no art. 24 a União edita normas gerais e os Estados suplementam.',
    ],
    revisar: [
      'Vale incluir controle de constitucionalidade das leis orçamentárias em separado, ou isso fica na lente orçamentária?',
      'A referência ao "contrabando legislativo" deve citar a ADI de origem? Não tenho segurança sobre qual citar como líder.',
    ],
  },

  // ==========================================================
  {
    chave: 'tributario',
    rotulo: 'Tributário',
    // NENHUM tema oficial se chama "tributário". Por isso os gatilhos de
    // ementa aqui não são reforço — são o mecanismo principal.
    temas: [70, 40],
    gatilhos: /tribut|imposto|al[íi]quota|isen[çc][ãa]o|contribui[çc][ãa]o social|IPI\b|ICMS\b|ISS\b|IRPJ|CSLL|PIS\b|COFINS|IOF\b|II\b|taxa[çc][ãa]o|ren[úu]ncia (de|da) receita|base de c[áa]lculo|IBS\b|CBS\b|imposto seletivo/i,

    perguntas: [
      'Qual a espécie tributária criada ou alterada — imposto, taxa, contribuição de melhoria, empréstimo compulsório ou contribuição especial (arts. 145, 148 e 149)? A espécie declarada corresponde à natureza do que foi instituído?',
      'De quem é a competência para instituir o tributo, e a proposição a respeita?',
      'A partir de quando o tributo pode ser cobrado? Aplicar a anterioridade anual (art. 150, III, "b") e a nonagesimal (art. 150, III, "c"), verificando as exceções do art. 150, § 1º. Esta é a resposta operacional que o gabinete mais precisa.',
      'A matéria exige lei complementar (art. 146)? O veículo é adequado?',
      'Há majoração com efeito retroativo (art. 150, III, "a")? Há efeito confiscatório a examinar (art. 150, IV)?',
      'Havendo renúncia de receita: a proposição traz a estimativa de impacto e a compensação exigidas pelo art. 14 da Lei de Responsabilidade Fiscal, e a estimativa do art. 113 do ADCT?',
      'Qual o regime vigente antes da alteração — base de cálculo, alíquota e sujeito passivo — e o que exatamente muda? Apresentar lado a lado.',
      'Como a medida se relaciona com a transição da reforma tributária (EC 132/2023) — o tributo alterado é extinto, mantido ou absorvido pelo novo regime?',
      'Havendo estimativa oficial de impacto e tempo de vigência suficiente: comparar PREVISTO × REALIZADO na série da rubrica afetada.',
    ],
    fontes: [
      'Constituição Federal, Sistema Tributário Nacional (arts. 145 a 162)',
      'Código Tributário Nacional (Lei 5.172/1966)',
      'Lei de Responsabilidade Fiscal (LC 101/2000), art. 14',
      'Estimativa de impacto constante da exposição de motivos, do parecer ou do anexo da LDO — é o "previsto"',
      'Séries de arrecadação da Receita Federal; Comex Stat (MDIC) para tributos sobre comércio exterior',
    ],
    armadilhas: [
      'Comparar série NOMINAL com série REAL, ou comparar anos sem deflacionar. Se a comparação for nominal, dizer que é nominal.',
      'Atribuir à medida a variação observada na arrecadação. A nota apresenta previsto × realizado e a série com o marco da vigência; não afirma causa.',
      'Ignorar o efeito de antecipação: o anúncio da tributação altera comportamento ANTES da vigência, o que contamina o "antes".',
      'Confundir alíquota nominal com carga efetiva.',
      'Esquecer a anterioridade e informar ao gabinete uma data de cobrança errada. Este é o erro de maior consequência prática do campo.',
    ],
    series: [
      'Arrecadação mensal da rubrica afetada (Receita Federal)',
      'Importação por NCM, quando houver efeito sobre comércio exterior (Comex Stat)',
      'Câmbio e IPCA para deflacionar e para descontar efeito de preço (BCB/SGS, IBGE/SIDRA)',
    ],
    revisar: [
      'A transição da EC 132/2023 muda ano a ano. Precisamos fixar como o roteiro se mantém atualizado — talvez um campo de "regime vigente no exercício" preenchido pela consultoria.',
      'Confirmar se a estimativa do art. 113 do ADCT continua sendo a referência usada na casa, ou se a prática migrou para outro dispositivo.',
    ],
  },

  // ==========================================================
  {
    chave: 'orcamentario',
    rotulo: 'Orçamentário-financeiro',
    temas: [70],
    gatilhos: /or[çc]ament|despesa|cr[ée]dito (suplementar|especial|extraordin)|LDO|LOA\b|PPA\b|responsabilidade fiscal|arcabou[çc]o|meta fiscal|emenda parlamentar/i,

    perguntas: [
      'A proposição cria ou aumenta despesa? Se sim, apresenta a estimativa do impacto orçamentário e financeiro no exercício e nos dois seguintes (LRF, art. 16)?',
      'Trata-se de despesa obrigatória de caráter continuado? Havendo, há a compensação do art. 17 da LRF?',
      'A medida é compatível com o Plano Plurianual, com a LDO do exercício e com a Lei Orçamentária vigente? Apontar o dispositivo de cada uma.',
      'Como a despesa se acomoda no limite do regime fiscal vigente?',
      'Havendo abertura de crédito: a fonte de recursos está indicada e é admissível (art. 167)?',
      'A medida altera o regime das emendas parlamentares — impositividade, cotas, prazos ou execução?',
      'Há estimativa oficial anterior sobre a mesma matéria que permita comparar previsto × realizado?',
    ],
    fontes: [
      'Lei de Responsabilidade Fiscal (LC 101/2000), arts. 15 a 17',
      'LDO e LOA do exercício, com o dispositivo citado',
      'Nota técnica da consultoria de orçamento (CONOF/CD, CONORF/SF), quando existir nos autos',
      'Relatório Geral da CMO, quando a matéria for orçamentária',
    ],
    armadilhas: [
      'Confundir adequação orçamentária (existe dotação?) com mérito da despesa (vale a pena?). São perguntas distintas.',
      'Tomar autorização de despesa por obrigação de gasto.',
      'Tratar renúncia de receita como se não fosse impacto fiscal.',
      'Somar impactos de exercícios diferentes sem trazer a valor presente ou sem dizer que a soma é nominal.',
    ],
    series: [
      'Execução orçamentária da ação ou programa afetado',
      'Séries da própria LOA e dos créditos adicionais do exercício',
    ],
    revisar: [
      'Não tenho segurança sobre como a casa vem tratando o limite de despesa do novo regime fiscal nos pareceres. Precisa da régua de vocês.',
    ],
  },

  // ==========================================================
  {
    chave: 'administrativo',
    rotulo: 'Administrativo e servidor público',
    temas: [34, 58, 52],
    gatilhos: /servidor|cargo|carreira|remunera[çc][ãa]o|subs[íi]dio|concurso p[úu]blico|regime jur[íi]dico|autarquia|funda[çc][ãa]o p[úu]blica|estatut|aposentadoria|gratifica[çc][ãa]o/i,

    perguntas: [
      'A criação de cargos, a alteração de carreira ou o aumento de remuneração observa a iniciativa privativa do Poder respectivo (art. 61, § 1º, II, e arts. 51 e 52)?',
      'O aumento de remuneração vem em lei específica e com prévia dotação orçamentária e autorização na LDO (art. 37, X, e art. 169, § 1º)?',
      'Qual o impacto sobre a despesa com pessoal e como ele se situa nos limites da LRF (arts. 19 a 23)?',
      'A medida esbarra na vedação de aumento de despesa com pessoal nos últimos 180 dias do mandato (LRF, art. 21)?',
      'Há efeito sobre o teto remuneratório (art. 37, XI) ou risco de acumulação vedada?',
      'A forma de provimento respeita a exigência de concurso público (art. 37, II)? Há efetivação sem concurso?',
      'Havendo alteração previdenciária: qual o efeito sobre o regime próprio e como ele se compõe com a EC 103/2019?',
    ],
    fontes: [
      'Constituição Federal, arts. 37 a 41 e art. 169',
      'Lei 8.112/1990, para servidores federais civis',
      'Lei de Responsabilidade Fiscal, arts. 18 a 23',
      'Estimativa de impacto de pessoal constante dos autos',
    ],
    armadilhas: [
      'Tratar reestruturação de carreira como se não fosse aumento de despesa.',
      'Ignorar o efeito acumulado sobre inativos e pensionistas.',
      'Confundir o limite prudencial com o limite máximo da LRF.',
    ],
    revisar: [
      'Vale separar "servidor público" de "previdência" em duas lentes? Hoje juntei, mas são análises bem diferentes.',
    ],
  },

  // ==========================================================
  {
    chave: 'regulatorio',
    rotulo: 'Regulatório e econômico',
    temas: [40, 66, 67, 37, 54, 61],
    gatilhos: /ag[êe]ncia reguladora|regula[çc][ãa]o|concess[ãa]o|permiss[ãa]o|autoriza[çc][ãa]o|concorr[êe]ncia|mercado|licitac|contrato administrativo|consumidor|tarifa/i,

    perguntas: [
      'A medida altera competência de agência reguladora? Se sim, como se compõe com a Lei 13.848/2019 e com a autonomia decisória da agência?',
      'Há Análise de Impacto Regulatório, quando exigível (Lei 13.874/2019 e Decreto 10.411/2020)? Se não houver, dizer que não consta.',
      'Qual o custo de conformidade imposto ao regulado, e sobre quem ele recai? Distinguir efeito sobre grandes e pequenos operadores.',
      'A medida cria barreira à entrada, reserva de mercado ou tratamento assimétrico entre concorrentes? Examinar à luz do art. 170 e da Lei 12.529/2011.',
      'Há tratamento favorecido a microempresas e empresas de pequeno porte, quando cabível (art. 170, IX, e LC 123/2006)?',
      'O efeito sobre preço ao consumidor é estimado por alguém nos autos? Quem, e com que método?',
      'Havendo medida já vigente: comparar previsto × realizado nos indicadores do setor.',
    ],
    fontes: [
      'Constituição Federal, art. 170 e art. 174',
      'Lei 13.848/2019 (agências reguladoras); Lei 13.874/2019 (liberdade econômica)',
      'Lei 12.529/2011 e manifestações do CADE, quando houver',
      'Notas técnicas da agência do setor',
    ],
    armadilhas: [
      'Confundir desregulamentação com aumento de concorrência: retirar norma pode concentrar mercado.',
      'Tomar o interesse do setor regulado como equivalente ao interesse público, ou o contrário.',
      'Estimar efeito sobre preço sem fonte. Se ninguém estimou, a nota diz que ninguém estimou.',
    ],
    series: [
      'Índices setoriais de preço (IBGE/SIDRA), quando houver rubrica específica',
      'Indicadores da agência do setor',
    ],
    revisar: [
      'Esta lente ficou larga — cobre desde telecomunicações até consumidor. Talvez precise ser dividida depois que rodarmos alguns casos.',
    ],
  },

  // ==========================================================
  {
    chave: 'penal',
    rotulo: 'Penal e processual penal',
    temas: [43, 57],
    gatilhos: /crime|pena|penal|tipifica|delito|priva[çc][ãa]o de liberdade|reclus[ãa]o|deten[çc][ãa]o|hediondo|execu[çc][ãa]o penal|inquérito|pris[ãa]o/i,

    perguntas: [
      'O tipo penal é determinado o bastante para satisfazer a legalidade estrita e a taxatividade (art. 5º, XXXIX, da CF; art. 1º do Código Penal)? Apontar elementos vagos, se houver.',
      'A conduta já é abrangida por tipo existente? Identificar sobreposição e risco de bis in idem.',
      'A pena cominada é proporcional? Comparar com os tipos análogos já existentes no Código Penal e na legislação especial, citando os artigos e as penas.',
      'Quais os efeitos sistêmicos: prescrição, regime inicial, progressão, cabimento de penas alternativas, classificação como hediondo (Lei 8.072/1990)?',
      'Sendo lei mais gravosa, não retroage (art. 5º, XL); sendo mais benéfica, retroage. Explicitar qual é o caso e a partir de quando se aplica.',
      'Há efeito processual — competência, rito, prisão cautelar, prazos?',
      'Qual o efeito esperado sobre a população prisional, e existe alguma estimativa nos autos? Não havendo, dizer que não há.',
    ],
    fontes: [
      'Código Penal e legislação penal especial, com os artigos transcritos',
      'Lei de Execução Penal (Lei 7.210/1984)',
      'Jurisprudência do STF e do STJ, citada por processo e data',
      'Dados do sistema prisional (SENAPPEN) para dimensionar o efeito',
    ],
    armadilhas: [
      'Tratar aumento de pena como resposta suficiente ao problema, sem examinar se a conduta já é criminalizada e por que a norma existente não é aplicada.',
      'Ignorar a desproporção criada em relação a crimes mais graves já tipificados — é o efeito colateral mais comum da inflação penal.',
      'Afirmar efeito dissuasório sem fonte. Não há como sustentar isso a partir do texto do projeto.',
      'Confundir a data de vigência da lei com a data a partir da qual a conduta é punível.',
    ],
    series: [
      'População prisional e perfil por tipo penal (SENAPPEN)',
      'Registros de ocorrência do tipo afetado, quando houver série pública comparável',
    ],
    revisar: [
      'A fonte de dados prisionais mudou de nome nos últimos anos e não tenho segurança sobre a denominação e o endereço atuais. Precisa de confirmação.',
      'Vale separar processual penal em lente própria?',
    ],
  },

  // ==========================================================
  {
    chave: 'ambiental',
    rotulo: 'Meio ambiente',
    temas: [48, 51, 64, 54],
    gatilhos: /ambient|licenciamento|desmatamento|floresta|preserva[çc][ãa]o|APP\b|reserva legal|unidade de conserva[çc][ãa]o|res[íi]duo|emiss[ãa]o|clima|carbono|recursos h[íi]dricos|fauna|flora/i,

    perguntas: [
      'De quem é a competência? Distinguir a competência comum de proteção (art. 23, VI e VII), a legislativa concorrente (art. 24, VI) e a repartição da LC 140/2011.',
      'A medida altera exigência de licenciamento ambiental? Se sim, qual etapa, para qual atividade, e o que deixa de ser exigido?',
      'Há alteração de padrão de proteção — APP, Reserva Legal, unidade de conservação — ou apenas de procedimento? A nota deve dizer explicitamente qual dos dois, porque a diferença é frequentemente obscurecida no debate.',
      'Como a medida se compõe com o Código Florestal (Lei 12.651/2012) e com o SNUC (Lei 9.985/2000)?',
      'Há efeito sobre compromissos internacionais assumidos pelo País em matéria de clima? Se houver estimativa oficial, citá-la; não havendo, dizer que não há.',
      'Há manifestação técnica do órgão ambiental competente nos autos?',
      'Havendo medida já vigente: comparar previsto × realizado nos indicadores ambientais pertinentes.',
    ],
    fontes: [
      'Constituição Federal, art. 225',
      'Código Florestal (Lei 12.651/2012); SNUC (Lei 9.985/2000); Política Nacional do Meio Ambiente (Lei 6.938/1981)',
      'LC 140/2011, para a repartição de competências',
      'Notas técnicas do IBAMA, do ICMBio e do Ministério do Meio Ambiente, quando existirem nos autos',
      'PRODES e DETER (INPE) para desmatamento; SEEG para emissões',
    ],
    armadilhas: [
      'Apresentar simplificação de procedimento como se fosse redução de proteção, ou o inverso. São coisas distintas e a nota deve separá-las.',
      'Invocar "vedação ao retrocesso ambiental" como se fosse regra pacificada — é princípio de aplicação controvertida, e usá-lo como argumento fechado enfraquece o parecer.',
      'Atribuir variação de desmatamento a uma norma. As séries têm sazonalidade, dependem de fiscalização e de preço de commodity.',
      'Confundir o licenciamento federal com o estadual sem verificar a LC 140.',
    ],
    series: [
      'Desmatamento por bioma (PRODES/DETER, INPE)',
      'Autos de infração e embargos (IBAMA)',
      'Emissões por setor (SEEG)',
    ],
    revisar: [
      'A lei geral do licenciamento ambiental foi sancionada com vetos e eu NÃO tenho segurança sobre o número da lei nem sobre quais dispositivos sobreviveram. Este item precisa ser preenchido por vocês antes de rodar qualquer parecer ambiental — é o ponto mais frágil de todo este arquivo.',
      'Confirmar se PRODES/DETER e SEEG são as séries que a casa aceita, ou se há preferência por outra base.',
    ],
  },
];

/**
 * Sugere as lentes de uma proposição a partir dos temas oficiais da Câmara e
 * da ementa. Devolve `sugeridas` e `motivo` de cada uma — o analista confirma.
 *
 * A ementa entra porque o tema oficial falha justamente nos casos difíceis:
 * matéria acrescentada por emenda no fim da tramitação não muda o tema.
 */
function sugerirEspecialistas({ temas = [], ementa = '' } = {}) {
  const codigos = new Set((temas || []).map(t => Number(t.codTema ?? t)));
  const texto = String(ementa || '');
  const sugeridas = [];

  for (const e of ESPECIALISTAS) {
    const porTema = (e.temas || []).filter(c => codigos.has(c));
    const porEmenta = e.gatilhos && e.gatilhos.test(texto);
    if (!e.sempre && !porTema.length && !porEmenta) continue;
    sugeridas.push({
      chave: e.chave, rotulo: e.rotulo,
      motivo: e.sempre ? 'aplica-se a qualquer proposição (iniciativa e competência)'
        : porTema.length && porEmenta ? 'tema oficial da Câmara e termos da ementa'
        : porTema.length ? 'tema oficial da Câmara'
        : 'termos da ementa (o tema oficial não indicaria esta lente)',
    });
  }
  return sugeridas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ESPECIALISTAS, sugerirEspecialistas };
}
