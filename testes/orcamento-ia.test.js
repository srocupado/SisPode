// Camada de IA do módulo de orçamento (orcamento-ia.js).
//
// A regra do projeto é uma só: a IA lê e redige, o JS confere. Estes testes não
// verificam se o modelo responde bem — verificam se a conferência PEGA quando
// ele responde mal, que é a única coisa sob nosso controle.
//
// Os três erros que os testes reproduzem são erros reais, não hipotéticos:
//
//   1. a ação orçamentária que não está na cartilha (o modelo completa a lista
//      com o que "costuma" existir);
//   2. o piso de R$ 250.000,00 da LOA 2023 aparecendo numa ficha da LOA 2026,
//      onde o valor é R$ 200.000,00 — o erro que a ficha inteira existe para
//      impedir, agora tentado pela IA em vez de pelo analista com pressa;
//   3. a cifra inventada no meio de um parágrafo bem escrito, que é a mais
//      difícil de enxergar lendo e a que mais chance tem de ir à tribuna.
//
// Uso: node testes/orcamento-ia.test.js
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const IA = require(path.join(RAIZ, 'orcamento-ia.js'));
const F = require(path.join(RAIZ, 'ficha.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Um "PDF extraído" com a cara do que o pdf.js devolve: espaçamento irregular,
// quebra no meio da frase, tudo numa sopa de linhas.
const CARTILHA = `
MINISTÉRIO DA SAÚDE — FUNDO NACIONAL DE SAÚDE
Cartilha de Emendas Parlamentares — Exercício de 2026

Ação 2E90 - Atenção à Saúde da População para Procedimentos de Média e Alta
Complexidade. Os recursos destinam-se ao custeio de procedimentos de média e alta
complexidade ambulatorial e hospitalar, sendo vedada a aquisição de equipamentos
e a realização de obras. O valor mínimo por proposta é de R$ 200.000,00.

Ação 20JP - Fomento ao Esporte e Lazer. Destina-se ao apoio a projetos esportivos
e à aquisição de material esportivo, observada a habilitação prévia do ente
beneficiário junto ao Ministério do Esporte.
` + 'linha de preenchimento para o documento ter tamanho de documento. '.repeat(12);

const MANUAL = `
MANUAL DE EMENDAS AO PROJETO DE LEI ORÇAMENTÁRIA ANUAL PARA 2026
Comissão Mista de Planos, Orçamentos Públicos e Fiscalização

Cada Deputado e cada Senador poderá apresentar até 25 (vinte e cinco) emendas
individuais ao projeto, cujo somatório não poderá exceder R$ 40.252.007,00 por
parlamentar, dos quais no mínimo 50% (cinquenta por cento) serão destinados a
ações e serviços públicos de saúde.

O valor mínimo de repasse para obras e serviços de engenharia é de
R$ 200.000,00 por instrumento de transferência.
` + 'texto normativo de preenchimento para o documento ter tamanho real. '.repeat(12);

(async () => {
  console.log('== leitura da resposta do modelo ==');
  {
    ok(IA.extrairJSON('```json\n[{"a":1}]\n```')?.[0]?.a === 1, 'cerca de código não impede a leitura');
    ok(IA.extrairJSON('Claro! Aqui está:\n[{"codigo":"2E90"}]\nEspero ter ajudado.')?.[0]?.codigo === '2E90',
       'prosa antes e depois do JSON também não');
    ok(IA.extrairJSON('{"campos":[{"v":"a}b"}]}')?.campos?.[0]?.v === 'a}b',
       'chave dentro de string não fecha o objeto cedo demais');
    ok(IA.extrairJSON('não consegui responder') === null, 'resposta sem JSON devolve null, não explode');
    ok(IA.extrairJSON('[{"a":1},') === null, 'JSON truncado devolve null em vez de metade dos dados');
  }

  console.log('\n== conferência das cartilhas ==');
  {
    const boas = [{
      codigo: '2E90', nome: 'Atenção à Saúde — Média e Alta Complexidade',
      orgao: 'Ministério da Saúde', permite: ['custeio de procedimentos de média e alta complexidade'],
      naoPermite: ['aquisição de equipamentos', 'realização de obras'],
      observacoes: 'Valor mínimo por proposta de R$ 200.000,00', pagina: '4',
      trecho: 'Os recursos destinam-se ao custeio de procedimentos de média e alta complexidade ambulatorial e hospitalar',
    }];
    const r = IA.conferirAcoes(boas, CARTILHA);
    ok(r.conferido && r.aprovadas.length === 1 && !r.recusadas.length,
       `a ação que está no documento passa: ${r.aprovadas[0]?.codigo}`);
    ok(r.aprovadas[0].naoPermite.length === 2, 'e traz o que é VEDADO, que é metade da informação útil');

    // O erro nº 1: a ação que o modelo completou de cabeça.
    const inventada = [{ codigo: '8535', nome: 'Estruturação de Unidades de Atenção Especializada',
      permite: ['aquisição de equipamentos'], pagina: '9',
      trecho: 'A ação 8535 destina-se à estruturação de unidades de atenção especializada em saúde, permitindo a aquisição de equipamentos.' }];
    const r2 = IA.conferirAcoes(inventada, CARTILHA);
    ok(!r2.aprovadas.length && /trecho citado não foi localizado/.test(r2.recusadas[0].motivo),
       `ação inventada é descartada: "${r2.recusadas[0].motivo}"`);
    ok(r2.recusadas[0].codigo === '8535', 'e continua visível com o motivo — quem revisa precisa saber que houve alucinação');

    // Trecho verdadeiro, valor trocado: o caso mais perigoso, porque o texto
    // em volta está todo certo.
    const valorTrocado = [{ codigo: '2E90', nome: 'Média e Alta Complexidade',
      permite: ['custeio'], observacoes: 'Valor mínimo por proposta de R$ 250.000,00', pagina: '4',
      trecho: 'Os recursos destinam-se ao custeio de procedimentos de média e alta complexidade ambulatorial e hospitalar' }];
    const r3 = IA.conferirAcoes(valorTrocado, CARTILHA);
    ok(!r3.aprovadas.length && /250\.000,00/.test(r3.recusadas[0].motivo),
       `trecho certo com valor do ano errado é pego pelo valor: "${r3.recusadas[0].motivo}"`);

    const curto = IA.conferirAcoes([{ codigo: '2E90', trecho: 'custeio' }], CARTILHA);
    ok(!curto.aprovadas.length, 'trecho curto demais não serve de prova (casaria com qualquer documento)');

    const semFonte = IA.conferirAcoes(boas, 'pdf ilegível');
    ok(!semFonte.conferido && !semFonte.aprovadas.length && /não pôde ser extraído/.test(semFonte.motivo),
       `documento ilegível não aprova nada, e diz por quê: "${semFonte.motivo.slice(0, 60)}…"`);
  }

  console.log('\n== conferência das propostas de ficha ==');
  {
    const propostas = [
      { campo: 'cota_individual_deputado', valor: 'R$ 40.252.007,00', pagina: '18',
        trecho: 'cujo somatório não poderá exceder R$ 40.252.007,00 por parlamentar' },
      { campo: 'qtd_emendas_individuais', valor: '25', pagina: '18',
        trecho: 'poderá apresentar até 25 (vinte e cinco) emendas individuais ao projeto' },
      { campo: 'piso_obras', valor: 'R$ 200.000,00', pagina: '31',
        trecho: 'O valor mínimo de repasse para obras e serviços de engenharia é de R$ 200.000,00 por instrumento' },
    ];
    const r = IA.conferirPropostasFicha(propostas, MANUAL, F.CAMPOS_FICHA);
    ok(r.conferido && r.aceitas.length === 3 && !r.recusadas.length,
       `os 3 valores estão no Manual e passam: ${r.aceitas.map(a => a.valor).join(', ')}`);
    ok(r.aceitas[0].rotulo === 'Cota por deputado', 'a proposta aceita já vem com o rótulo do campo da ficha');

    // O erro nº 2, que é O erro: o piso do exercício anterior.
    const herdado = [{ campo: 'piso_obras', valor: 'R$ 250.000,00', pagina: '31',
      trecho: 'O valor mínimo de repasse para obras e serviços de engenharia é de R$ 200.000,00 por instrumento' }];
    const r2 = IA.conferirPropostasFicha(herdado, MANUAL, F.CAMPOS_FICHA);
    ok(!r2.aceitas.length && /não aparece dentro do trecho/.test(r2.recusadas[0].motivo),
       `R$ 250.000,00 (LOA 2023) num Manual que diz R$ 200.000,00 é recusado: "${r2.recusadas[0].motivo}"`);

    const forjado = [{ campo: 'cota_bancada', valor: 'R$ 285.200.000,00', pagina: '20',
      trecho: 'O valor por bancada estadual corresponde a R$ 285.200.000,00, resultado da divisão do total reservado' }];
    const r3 = IA.conferirPropostasFicha(forjado, MANUAL, F.CAMPOS_FICHA);
    ok(!r3.aceitas.length && /trecho citado não foi localizado/.test(r3.recusadas[0].motivo),
       'trecho inteiro forjado não passa, ainda que o valor seja plausível');

    const desconhecido = IA.conferirPropostasFicha([{ campo: 'cota_do_lider', valor: 'R$ 1,00', trecho: MANUAL.slice(50, 200) }], MANUAL, F.CAMPOS_FICHA);
    ok(/campo desconhecido/.test(desconhecido.recusadas[0].motivo), 'campo fora do esquema da ficha é recusado');

    // O prompt tem de pedir o essencial, senão a conferência só reprova.
    const p = IA.promptFicha(F.CAMPOS_FICHA.slice(0, 3), { rotulo: 'Manual de Emendas 2026', exercicio: '2026' });
    ok(/trecho.*C[ÓO]PIA EXATA/i.test(p) && /CONTER o "valor"/.test(p), 'o prompt exige trecho literal contendo o valor');
    ok(/NÃO use conhecimento de exercícios anteriores/.test(p), 'e proíbe explicitamente herdar do ano anterior');
    ok(/cota_individual_deputado/.test(p), 'e nomeia os campos pedidos');
  }

  console.log('\n== a síntese: números amarrados à base ==');
  {
    const variacao = {
      comparado: true, de: 'LOA 2026', para: 'PLOA 2027',
      itens: [
        { rotulo: 'XIV.1. Juros e Encargos da Dívida', de: 643939.8, para: 826175.4, pct: 28.3 },
        { rotulo: 'XIV.2. Operações Oficiais de Crédito', de: 10000, para: 7030, pct: -29.7 },
      ],
      porOrgao: { linhas: [{ codigo: '26000', orgao: 'Ministério da Educação', valor: 1697 }],
                  total: 24402.4, soma: 24402.4, confere: true },
    };
    const serie = [{ rotulo: 'Cota individual — deputado', lacunas: ['2024', '2025'],
      pontos: [{ ano: '2023', valor: 19704897, texto: 'R$ 19.704.897,00' },
               { ano: '2026', valor: 40252007, texto: 'R$ 40.252.007,00' }],
      variacao: { pct: 104.3 } }];
    const permitidos = IA.numerosDaBase({ variacao, serie, ficha: { valores: { piso_obras: { valor: 'R$ 200.000,00' } } } });

    ok(permitidos.has(826175.4) && permitidos.has(28.3) && permitidos.has(40252007) && permitidos.has(200000),
       `a base branca reúne ${permitidos.size} números conferidos, de todas as fontes`);

    const bomTexto = `Os Juros e Encargos da Dívida passam de 643.939,8 para 826.175,4 milhões, alta de 28,3%, ` +
      `enquanto as Operações Oficiais de Crédito recuam 29,7%. A cota individual por deputado, que era ` +
      `R$ 19.704.897,00 em 2023, chegou a R$ 40.252.007,00 em 2026. O piso de repasse para obras é de R$ 200.000,00.`;
    const c1 = IA.conferirSintese(bomTexto, permitidos);
    ok(c1.limpo, `texto escrito só com os dados apurados passa limpo (${c1.conferidos}/${c1.total} números conferidos)`);

    // O erro nº 3: um número plausível, bem colocado, que não existe em lugar nenhum.
    const comInvencao = bomTexto + ' O Ministério da Saúde receberá 3.812,7 milhões em emendas impositivas.';
    const c2 = IA.conferirSintese(comInvencao, permitidos);
    ok(!c2.limpo && c2.suspeitos.length === 1 && c2.suspeitos[0].numero === '3.812,7',
       `a cifra inventada é isolada: ${c2.suspeitos[0]?.numero}`);
    ok(/Ministério da Saúde receberá 3\.812,7/.test(c2.suspeitos[0].contexto),
       `com o contexto para o revisor achar no texto: "${c2.suspeitos[0].contexto.slice(0, 70)}…"`);
    ok(/não constam da base conferida/.test(c2.motivo), 'e um motivo pronto para exibir na nota');

    // Arredondar não pode virar alarme falso: o texto bem escrito arredonda.
    const arredondado = 'Os juros sobem para R$ 826,2 bilhões, alta de 28,3%.';
    ok(IA.conferirSintese(arredondado, permitidos).limpo,
       '826,2 bilhões é reconhecido como 826.175,4 milhões arredondado — texto natural não é punido');
    ok(!IA.conferirSintese('Os juros sobem para R$ 890,4 bilhões.', permitidos).limpo,
       'mas 890,4 bilhões não passa: arredondamento tem limite');

    // Ano e contagem não são dinheiro, e flagrá-los encheria a tela de ruído.
    const comAnos = 'Em 2027 a Comissão designou 16 relatores setoriais, com prazo até 20 de outubro.';
    ok(IA.conferirSintese(comAnos, permitidos).limpo, 'ano, contagem pequena e dia não são flagrados');
    ok(IA.conferirSintese('', permitidos).limpo && IA.conferirSintese('texto sem números', permitidos).total === 0,
       'texto sem número não gera suspeita nem divisão por zero');

    // O prompt da síntese entrega os números PRONTOS — a IA não extrai nada.
    const p = IA.promptSintese({ variacao, serie, materia: 'PLN 24/2026', pendencias: ['designação do Relator-Geral'] });
    ok(/826175\.4|826175,4|826175/.test(p.replace(/\s/g, '')), 'os valores apurados vão dentro do prompt');
    ok(/NÃO escreva nenhum número que não esteja na lista/.test(p), 'com a proibição de inventar cifra');
    ok(/NÃO recomende voto/.test(p), 'e sem recomendação de voto — a orientação é da Liderança');
    ok(/designação do Relator-Geral/.test(p), 'as pendências entram para serem ditas, não escondidas');
    ok(/sem registro em 2024, 2025/.test(p), 'e a lacuna da série vai junto, para o texto não fingir continuidade');

    const vazio = IA.promptSintese({});
    ok(/nenhum dado numérico apurado/.test(vazio), 'sem dados apurados, o prompt diz isso em vez de convidar à invenção');
  }

  console.log('\n== documento grande demais para ir como PDF ==');
  {
    // Tamanhos MEDIDOS em 03/09/2026 nas cartilhas da LOA 2026.
    const mb = n => n * 1024 * 1024;
    ok(IA.modoDeLeitura({ bytes: mb(0.6), paginas: 30, provedorId: 'gemini' }).modo === 'pdf',
       'cartilha do Ministério do Trabalho (622 KB) vai como PDF');
    ok(IA.modoDeLeitura({ bytes: mb(8.4), paginas: 60, provedorId: 'anthropic' }).modo === 'pdf',
       'a do Ministério da Justiça (8,4 MB) ainda cabe');

    const fns = IA.modoDeLeitura({ bytes: mb(22), paginas: 80, provedorId: 'gemini' });
    ok(fns.modo === 'texto' && /22,0 MB|22\.0 MB/.test(fns.motivo.replace('.', ',')),
       `a do Fundo Nacional de Saúde (22 MB) cai para texto, e o motivo diz o tamanho: "${fns.motivo}"`);

    // O Manual de Emendas 2026 tem 259 páginas — a OpenAI recusa acima de 100.
    const manual = IA.modoDeLeitura({ bytes: mb(9), paginas: 259, provedorId: 'openai' });
    ok(manual.modo === 'texto' && /259 páginas/.test(manual.motivo),
       `o Manual de 259 páginas vai como texto na OpenAI: "${manual.motivo}"`);
    ok(IA.modoDeLeitura({ bytes: mb(9), paginas: 259, provedorId: 'anthropic' }).modo === 'pdf',
       'e continua indo como PDF onde o limite de páginas não existe');

    const p = IA.comTextoDoDocumento('INSTRUÇÕES', 'conteúdo do documento');
    ok(/INSTRUÇÕES/.test(p) && /conteúdo do documento/.test(p), 'o texto é anexado ao prompt');
    ok(!/truncado/.test(p), 'documento curto não é declarado truncado');
    const longo = IA.comTextoDoDocumento('INSTRUÇÕES', 'x'.repeat(IA.LIMITE_TEXTO_PROMPT + 5000));
    ok(/truncado/.test(longo) && /não complete o que falta/.test(longo),
       'documento longo é cortado E o modelo é avisado para não completar o que falta');
    ok(longo.length < IA.LIMITE_TEXTO_PROMPT + 1000, 'e o corte é real, não decorativo');
  }

  console.log('\n== a normalização não afrouxa a conferência ==');
  {
    ok(IA.compacto('R$ 200.000,00') === 'r20000000' && IA.compacto('R$ 250.000,00') !== IA.compacto('R$ 200.000,00'),
       'pontuação some, número não: 200.000 continua diferente de 250.000');
    ok(IA.contemTrecho('...o valor mínimo  de\nrepasse  é de R$ 200.000,00 por instrumento...',
                       'O valor mínimo de repasse é de R$ 200.000,00 por instrumento'),
       'espaçamento e quebra de linha do PDF não derrubam a conferência');
    ok(!IA.contemTrecho('o valor mínimo de repasse é de R$ 200.000,00 por instrumento de transferência',
                        'o valor mínimo de repasse é de R$ 250.000,00 por instrumento de transferência'),
       'mas um dígito trocado, sim');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
