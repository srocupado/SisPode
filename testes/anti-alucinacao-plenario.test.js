// Mecanismos anti-alucinação da nota do Plenário (12/11/2026). CASO REAL: a nota do PL 2475/2025
// (maus-tratos a animais) falou em "tração animal", que não está em nenhum dos 15 documentos da
// proposição, e disse que "a CCJC aprovou um substitutivo" quando o PRLP é parecer do relator em Plenário.
//
// O que este teste trava:
//   a. a seção "Argumentos favoráveis e contrários" não autoriza mais fatos/exemplos de fora dos
//      documentos (PL e PDL), e as regras rígidas dizem isso;
//   c. com PRLP/PRLE, o prompt explica que é parecer do relator em Plenário, não deliberação de
//      comissão, e a seção "Pareceres das comissões" não recebe os pareceres de Plenário;
//   b. conferência de citações: parlamentar, proposição, aspas e sigla que a fonte não traz são
//      sinalizados; o que a fonte (PDFs + dados da pauta) traz, não; sem PDF lido, nada é sinalizado;
//   e. verificação por IA: só ficam trechos literais da nota; o modelo é o não econômico de versão mais
//      alta; o resultado é salvo; falha fica registrada; nota que mudou durante a verificação não recebe
//      o resultado; e a geração dispara a verificação depois de salvar.
//
// Funções de analise.js avaliadas em escopo próprio, com colaboradores de mentira (rede, DOM, IA).
// Uso: node testes/anti-alucinacao-plenario.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const srcParecer = fs.readFileSync(path.join(RAIZ, 'parecer.js'), 'utf8');
const trechoDe = (fonte, re) => { const m = fonte.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const trecho = re => trechoDe(src, re);
const fn = (nome, fonte = src) => trechoDe(fonte, new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  // ------------------------------------------------------------------ a e c: prompts
  console.log('\n== a/c. prompts ==');
  const PR = new Function(`
    ${trecho(/const TIPOS_MPV = [^\n]+/)}
    ${trecho(/const REGRA_ARGUMENTOS = [^\n]+/)}
    ${trecho(/const FORMATO_PADRAO_NOTA = [^\n]+/)}
    ${fn('tipoLabel')}
    ${fn('ehMPV')}
    ${fn('ehPDL')}
    ${trecho(/const RE_SUSTACAO\s*=[^\n]+/)}
    ${fn('subtipoPDL')}
    ${fn('montarPrompt')}
    ${fn('promptPDL')}
    return { montarPrompt, REGRA_ARGUMENTOS };
  `)();
  const doc = (tipo, rotulo) => ({ tipo, rotulo, url: 'u' });
  const pl = { sigla: 'PL', numero: '2475', ano: '2025', tipoCategoria: 'projeto', ementa: 'Torna hediondo…', enriquecimento: {} };
  const comPRLP = PR.montarPrompt(pl, [doc('PRLP', 'PRLP nº 2'), doc('PRLE', 'PRLE nº 2'), doc('REDACAO_ORIGINAL', 'Redação original'), doc('PARECER_COMISSAO', 'Parecer da Comissão CMADS')]);
  const secArg = comPRLP.slice(comPRLP.indexOf('## Argumentos favoráveis e contrários'));
  ok(secArg.includes(PR.REGRA_ARGUMENTOS) && /não introduza fatos, exemplos, atividades/.test(PR.REGRA_ARGUMENTOS), 'a: a seção de argumentos traz a regra "não introduza fatos, exemplos, atividades…"');
  ok(!/pode recorrer a conhecimento geral/.test(comPRLP), 'a: o prompt do PL não autoriza mais "recorrer a conhecimento geral"');
  ok(/nem na seção "Argumentos favoráveis e contrários"/.test(comPRLP) && /Não acrescente exemplos, atividades, setores/.test(comPRLP), 'a: as regras rígidas não abrem exceção para fatos na seção de argumentos');
  for (const ementa of ['Susta os efeitos do Decreto nº 1', 'Aprova o texto do Acordo entre o Brasil e X', 'Dispõe sobre a realização de plebiscito']) {
    const pdl = PR.montarPrompt({ ...pl, sigla: 'PDL', ementa }, [doc('INTEIRO_TEOR', 'Inteiro teor')]);
    ok(pdl.includes(PR.REGRA_ARGUMENTOS) && !/pode usar conhecimento geral|pode recorrer a conhecimento geral/.test(pdl), `a: PDL (${ementa.slice(0, 20)}…) com a mesma regra`);
  }
  ok(/ATENÇÃO À NATUREZA DO PARECER/.test(comPRLP) && /nunca "a Comissão aprovou"/.test(comPRLP), 'c: com PRLP/PRLE, o prompt diz que é parecer do relator em Plenário, nunca "a Comissão aprovou"');
  ok(/Não inclua nesta seção os pareceres proferidos em Plenário/.test(comPRLP), 'c: "Pareceres das comissões" não recebe os pareceres de Plenário');
  const semPRLP = PR.montarPrompt(pl, [doc('REDACAO_ORIGINAL', 'Redação original')]);
  ok(!/ATENÇÃO À NATUREZA DO PARECER/.test(semPRLP), 'c: sem PRLP/PRLE, a observação não entra');

  // ------------------------------------------------------------------ b: conferência de citações
  console.log('\n== b. conferência de citações ==');
  let textoPdf = '';
  const B = new Function('extrairTextoPdf', `
    ${fn('validarReferencias')}
    ${trecho(/const _planoTexto = [\s\S]*?;\n/)}
    ${trecho(/const _TITULO_OU_LIGACAO = [^\n]+/)}
    ${trecho(/const _SIGLAS_DO_SISTEMA = [^\n]+/)}
    ${fn('conferirCitacoes')}
    ${fn('calcularRefsSuspeitas')}
    ${fn('dadosDaPautaParaConferencia')}
    return { conferirCitacoes, calcularRefsSuspeitas, dadosDaPautaParaConferencia };
  `)(async () => textoPdf);
  // fonte sintética no formato dos pareceres de Plenário (quebra de linha com hífen, como sai do PDF)
  const FONTE = `PARECER DE PLENÁRIO PELAS COMISSÕES DE MEIO AMBIENTE E DESENVOLVIMENTO SUSTENTÁVEL E DE CONSTITUIÇÃO E
JUSTIÇA E DE CIDADANIA AO PROJETO DE LEI Nº 2.475, DE 2025. Apensados: PL nº 4.151/2025.
Relator: Deputado DELEGADO MATHEUS LAIOLA. A Emenda nº 1, de autoria do ilustre Deputado Pedro Lupion,
propõe que não se caracterize maus-tratos a morte decorrente de práticas agrope-
cuárias ou sanitárias regulares envolvendo animais de produção. Altera a Lei nº 9.605, de 1998, e a Lei nº 8.072, de 1990.
A Comissão de Meio Ambiente (CMADS) aprovou o substitutivo. O texto evita a "prática reiterada".`.repeat(2);
  const NOTA_BOA = `## Objetivo
O PL nº 2.475/2025 altera a Lei nº 8.072, de 1990. O relator, Deputado Delegado Matheus Laiola, pela CMADS e pela CCJC, propôs substitutivo; o apensado PL 4.151/2025 foi considerado. A Emenda nº 1, do Dep. Pedro Lupion, ressalva "práticas agropecuárias ou sanitárias regulares".`;
  ok(B.conferirCitacoes(NOTA_BOA, FONTE).length === 0, 'nota fiel (nomes, PL com ponto de milhar, aspas que quebram linha com hífen no PDF, siglas do sistema): nenhum aviso');
  const NOTA_RUIM = `## Argumentos
O Deputado Fulano Inventado lembra o PL 9.999/2024 e diz que a medida atinge o "uso de animais de tração", cabendo ao IPHAN e ao Ibama fiscalizar.`;
  const r = B.conferirCitacoes(NOTA_RUIM, FONTE);
  ok(r.includes('Deputado Fulano Inventado'), 'parlamentar que a fonte não traz');
  ok(r.includes('PL 9.999/2024'), 'proposição que a fonte não traz');
  ok(r.some(x => x.startsWith('“uso de animais de tração”')), 'trecho entre aspas que não está nos documentos');
  ok(r.includes('sigla IPHAN') && !r.some(x => /Ibama/.test(x)), 'sigla que a fonte não traz (só as de 3+ maiúsculas)');
  ok(B.conferirCitacoes('O Dep. Dr. Ismael diz "x y".', FONTE).every(x => !/Dr/.test(x)), 'título sozinho ("Dep. Dr.") não vira parlamentar suspeito');
  ok(B.conferirCitacoes('Inciso XIX do art. 5º; o PLV e o RICD.', FONTE).length === 0, 'numeral romano e siglas do sistema não são sinalizados');
  // CASO REAL (PL 294/2015, 19/11/2026): citações curtas ("g") faziam o texto ENTRE duas citações ser lido como citação
  const NOTA_ALINEAS = 'O art. 1º altera a alínea "c" do inciso V do art. 12 da Lei nº 9.605, de 1998. O art. 2º faz o mesmo com a alínea "c" do inciso V do art. 11 da Lei nº 8.072, de 1990. O texto evita a "prática reiterada".';
  ok(B.conferirCitacoes(NOTA_ALINEAS, FONTE).length === 0, 'citações curtas (alínea "c") não deslocam o par de aspas: o texto fora das aspas não é acusado');
  const longa = 'práticas agropecuárias ou sanitárias regulares envolvendo animais de produção '.repeat(4).trim();
  ok(B.conferirCitacoes(`O texto passa a dizer: "${longa}". A cláusula de vigência é imediata. O relator fala em "prática reiterada".`, FONTE).length === 0, 'citação longa (mais de 200 caracteres) também não desloca o par');
  ok(B.conferirCitacoes('O relator fala em "uso de animais de tração" e cita a alínea "c".', FONTE).some(x => x.startsWith('“uso de animais de tração”')), 'a citação inventada continua sendo acusada');
  ok(B.conferirCitacoes('Trecho com aspas sem fechar: "uso de animais de tração e mais texto.', FONTE).length === 0, 'aspas retas em número ímpar no parágrafo: ambíguo, não confere');
  ok(B.conferirCitacoes('Usa aspas curvas: “uso de animais de tração”, e a alínea “c”.', FONTE).some(x => x.startsWith('“uso de animais de tração”')), 'aspas curvas são pareadas pelo abre e fecha');
  // dados da pauta contam como fonte, mas só com o PDF lido
  const it = { sigla: 'REQ', numero: '3883', ano: '2026', ementa: 'Requer urgência', pareceresComissao: [{ comissao: 'Segurança Pública', posicao: 'aprovado', relator: 'Dep. Sargento Fahur (PSD-PR)' }],
    projetoUrgenciado: { sigla: 'PLP', numero: '42', ano: '2023' }, enriquecimento: {} };
  const dados = B.dadosDaPautaParaConferencia(it, [doc('INTEIRO_TEOR', 'Inteiro teor do PLP 42/2023')]);
  const notaReq = 'A Comissão aprovou o parecer do Dep. Sargento Fahur (PSD-PR) sobre o PLP 42/2023.';
  textoPdf = FONTE;
  ok((await B.calcularRefsSuspeitas(notaReq, [new ArrayBuffer(1)], dados)).length === 0, 'relator e projeto que vieram da pauta (não do PDF) não são sinalizados');
  ok((await B.calcularRefsSuspeitas(notaReq, [new ArrayBuffer(1)], '')).length === 3, '…e sem os dados da pauta seriam (parlamentar, projeto, sigla PSD)');
  textoPdf = '';
  ok((await B.calcularRefsSuspeitas(NOTA_RUIM + ' Lei nº 1.234', [new ArrayBuffer(1)], dados)).length === 0, 'PDF ilegível: nada é sinalizado, nem com os dados da pauta (seria tudo falso positivo)');

  // ------------------------------------------------------------------ e: verificação por IA
  console.log('\n== e. verificação por IA ==');
  let respostaIA = '', chamadas = [], salvos = [], renders = 0, falharIA = null, durante = null, filaIA = [];
  const state = { config: { provedor: 'gemini', apiKey: 'k', modelo: 'gemini-3.1-flash-lite' } };
  let emVoo = 0, maxVoo = 0;
  const E = new Function('state', 'chamarIA', 'listarModelosDoProvedor', 'fbSalvarAnalise', 'renderAnaliseCard', 'isAbortError', 'escapeHtml', 'iaInFlightInc', 'iaInFlightDec', `
    ${trecho(/const _planoTexto = [\s\S]*?;\n/)}
    ${fn('promptVerificacao')}
    ${fn('lerVerificacao')}
    ${fn('promptCorrecao')}
    ${fn('lerCorrecao')}
    ${fn('aplicarCorrecoes')}
    ${fn('modeloDaVerificacao')}
    ${fn('verificarNotaComIA')}
    ${fn('avisoVerificacaoHtml')}
    return { promptVerificacao, lerVerificacao, verificarNotaComIA, avisoVerificacaoHtml, promptCorrecao, lerCorrecao, aplicarCorrecoes };
  `)(
    state,
    async a => { chamadas.push(a); if (durante) durante(); if (falharIA) throw falharIA; return { text: filaIA.length ? filaIA.shift() : respostaIA }; },
    async () => [{ id: 'gemini-3.1-flash-lite' }, { id: 'gemini-3.8-flash' }, { id: 'gemini-3-pro-image' }],
    async it => { salvos.push(JSON.parse(JSON.stringify(it.analise))); },
    () => { renders++; },
    e => e && e.name === 'AbortError',
    s => String(s).replace(/</g, '&lt;'),
    () => { emVoo++; maxVoo = Math.max(maxVoo, emVoo); }, () => { emVoo--; },
  );
  // escolherModelo vem do parecer.js (carregado antes do analise.js na página)
  const P = new Function(`
    ${trechoDe(srcParecer, /const MARCA_ECONOMICA[^\n]+/)}
    ${trechoDe(srcParecer, /const MARCA_SUPERIOR[^\n]+/)}
    ${trechoDe(srcParecer, /const MARCA_INTERMED[^\n]+/)}
    ${trechoDe(srcParecer, /const MARCA_OUTRA_MODALIDADE[^\n]+/)}
    ${trechoDe(srcParecer, /const ORDEM_FAIXA[^\n]+/)}
    ${fn('faixaDoModelo', srcParecer)}
    ${fn('versaoDoModelo', srcParecer)}
    ${fn('ranquearModelos', srcParecer)}
    ${fn('escolherModelo', srcParecer)}
    return escolherModelo;
  `)();
  globalThis.escolherModelo = P;

  const NOTA = `## Objetivo
O projeto torna hediondo o crime de maus-tratos com morte.

## Argumentos favoráveis e contrários
Argumentos contrários: a medida pode alcançar o uso de animais de tração no campo e encarecer a produção.`;
  ok(/DADOS DA PAUTA:\nTorna hediondo/.test(E.promptVerificacao(NOTA, 'Torna hediondo')) && E.promptVerificacao(NOTA, '').includes(NOTA), 'o prompt leva os dados da pauta e a nota inteira');
  const lidos = E.lerVerificacao('```json\n{"itens":[{"trecho":"o uso de animais de tração no campo","motivo":"os documentos falam de animais de produção, não de tração"},{"trecho":"trecho que não está na nota","motivo":"x"},{"trecho":"curto","motivo":"y"}]}\n```', NOTA);
  ok(lidos.length === 1 && lidos[0].trecho === 'o uso de animais de tração no campo', 'só fica o trecho que existe literalmente na nota (cerca de código tolerada; inventado e curto demais caem)');
  ok((() => { try { E.lerVerificacao('não achei nada', NOTA); return false; } catch (_) { return true; } })(), 'resposta sem JSON é falha, não "nada apontado"');

  const item = { chave: 'PL-2475-2025', analise: { markdown: NOTA, geradoEm: 'g' } };
  respostaIA = '{"itens":[{"trecho":"uso de animais de tração no campo","motivo":"não consta dos documentos"}]}';
  await E.verificarNotaComIA(item, [new ArrayBuffer(1)], 'dados');
  ok(chamadas[0].modelo === 'gemini-3.8-flash' && chamadas[0].pdfBuffers.length === 1, 'verificador: modelo não econômico de versão mais alta (não o flash-lite da nota), com os mesmos PDFs');
  ok(item.analise.verificacaoIA.itens.length === 1 && salvos.at(-1).verificacaoIA.modelo === 'gemini-3.8-flash' && !item._verificando, 'resultado gravado na análise e salvo no Firebase');
  const html = E.avisoVerificacaoHtml(item);
  ok(/Agente revisor \(gemini-3\.8-flash\):/.test(html) && !/Verificação por IA/.test(html) && /uso de animais de tração no campo/.test(html), 'o card atribui o apontamento ao "Agente revisor (<modelo de revisão>)" e mostra o trecho');

  respostaIA = '{"itens":[]}';
  await E.verificarNotaComIA(item, [], 'dados');
  ok(/nenhum trecho sem respaldo apontado/.test(E.avisoVerificacaoHtml(item)), 'sem apontamentos: diz que a verificação rodou e nada apontou');

  falharIA = new Error('HTTP 429');
  await E.verificarNotaComIA(item, [], 'dados');
  ok(item.analise.verificacaoIA.falhou === 'HTTP 429' && /não concluída/.test(E.avisoVerificacaoHtml(item)), 'falha do verificador fica registrada e visível (não vira "nada apontado")');
  falharIA = null;

  const nSalvos = salvos.length;
  durante = () => { item.analise = { markdown: 'nota regerada', geradoEm: 'g2' }; };
  respostaIA = '{"itens":[{"trecho":"uso de animais de tração no campo","motivo":"x"}]}';
  await E.verificarNotaComIA(item, [], 'dados');
  durante = null;
  ok(!item.analise.verificacaoIA && salvos.length === nSalvos, 'nota regerada durante a verificação: o resultado (de outro texto) é descartado');

  const ab = new Error('x'); ab.name = 'AbortError'; falharIA = ab;
  const it2 = { chave: 'X', analise: { markdown: NOTA } };
  await E.verificarNotaComIA(it2, [], '');
  ok(!it2.analise.verificacaoIA && !it2._verificando, '"Parar tudo": nada é gravado');
  ok(maxVoo === 1 && emVoo === 0, 'a verificação conta como chamada de IA em voo (o "Parar tudo" aparece) e sai da conta ao terminar, falhar ou ser cancelada');
  falharIA = null;

  globalThis.escolherModelo = undefined;
  chamadas = [];
  await E.verificarNotaComIA({ chave: 'Y', analise: { markdown: NOTA } }, [], '');
  ok(chamadas[0].modelo === 'gemini-3.1-flash-lite', 'sem o escolherModelo (página sem o parecer.js) ou sem lista: usa o modelo da configuração');

  // ------------------------------------------------------------------ f: correção automática pelo agente revisor
  console.log('\n== f. correção automática ==');
  globalThis.escolherModelo = P;
  const NOTA_F = `## Principais Disposições do último substitutivo apresentado
O substitutivo altera o art. 2º e introduz uma definição de racismo institucional no texto. A pensão é mensal.

## Argumentos favoráveis e contrários
**Argumentos contrários:** a medida pode alcançar o uso de animais de tração no campo e encarecer a produção.`;
  const ITENS_F = [{ trecho: 'introduz uma definição de racismo institucional', motivo: 'a definição já constava do art. 2º, § 2º, do projeto original' }, { trecho: 'o uso de animais de tração no campo', motivo: 'não consta dos documentos' }];
  const pc = E.promptCorrecao(NOTA_F, ITENS_F, 'dados da pauta');
  ok(pc.includes(NOTA_F) && /1\. "introduz uma definição de racismo institucional" — a definição já constava/.test(pc) && /2\. "o uso de animais de tração no campo"/.test(pc) && /copiada LITERALMENTE/.test(pc), 'o prompt da correção leva a nota, os dados e os trechos numerados com o motivo');
  const FRASE1 = 'O substitutivo altera o art. 2º e introduz uma definição de racismo institucional no texto.';
  const NOVA1 = 'O substitutivo altera o art. 2º e mantém a definição de racismo institucional que já constava do projeto original.';
  const ac = E.aplicarCorrecoes(NOTA_F, ITENS_F, E.lerCorrecao(JSON.stringify({ correcoes: [{ n: 1, frase: FRASE1, nova: NOVA1 }, { n: 2, frase: 'frase que não existe na nota sobre o uso de animais de tração no campo.', nova: 'x' }] })));
  ok(ac.markdown.includes(NOVA1) && !ac.markdown.includes(FRASE1) && ac.markdown.includes('A pensão é mensal.'), 'a frase apontada é trocada pela corrigida; o resto da nota fica igual');
  ok(ac.corrigidos.length === 1 && ac.corrigidos[0].antes === FRASE1 && ac.corrigidos[0].depois === NOVA1 && /já constava/.test(ac.corrigidos[0].motivo), 'fica o registro do antes, do depois e do motivo');
  ok(ac.pendentes.length === 1 && ac.pendentes[0].trecho === 'o uso de animais de tração no campo', 'frase devolvida que não existe literalmente na nota: não aplica, o apontamento continua pendente');
  const naoMuda = (c, m) => ok(E.aplicarCorrecoes(NOTA_F, [ITENS_F[0]], [c]).corrigidos.length === 0, m);
  naoMuda({ n: 1, frase: FRASE1, nova: 'O substitutivo introduz uma definição de racismo institucional, de fato.' }, 'frase nova que repete o trecho apontado: recusada');
  naoMuda({ n: 1, frase: 'A pensão é mensal.', nova: 'A pensão é vitalícia.' }, 'frase que não contém o trecho apontado: recusada (o revisor não reescreve outra parte da nota)');
  naoMuda({ n: 1, frase: FRASE1, nova: 'Linha um.\n## Nova seção' }, 'frase nova com quebra de linha ou título: recusada');
  naoMuda({ n: 1, frase: '## Principais Disposições do último substitutivo apresentado', nova: '## Outro título' }, 'título de seção não é reescrito');
  const sup = E.aplicarCorrecoes(NOTA_F, [ITENS_F[0]], [{ n: 1, frase: FRASE1, nova: '' }]);
  ok(sup.corrigidos.length === 1 && sup.corrigidos[0].depois === '' && /apresentado\nA pensão é mensal\./.test(sup.markdown), 'frase nova vazia: a frase é suprimida');

  // ponta a ponta: revisão aponta, correção aplica, tudo é gravado
  chamadas = []; salvos = [];
  const itF = { chave: 'PL-2819-2020', analise: { markdown: NOTA_F, geradoEm: 'g' } };
  filaIA = [JSON.stringify({ itens: ITENS_F }), JSON.stringify({ correcoes: [{ n: 1, frase: FRASE1, nova: NOVA1 }] })];
  await E.verificarNotaComIA(itF, [new ArrayBuffer(1)], 'dados');
  ok(chamadas.length === 2 && chamadas[1].modelo === 'gemini-3.8-flash' && chamadas[1].pdfBuffers.length === 1 && /TRECHOS APONTADOS/.test(chamadas[1].prompt), 'com apontamentos, há uma chamada a mais: o mesmo modelo da revisão, com os mesmos PDFs');
  ok(itF.analise.markdown.includes(NOVA1) && itF.analise.verificacaoIA.corrigidos.length === 1 && itF.analise.verificacaoIA.itens.length === 1 && !itF._verificando, 'a nota fica corrigida; um apontamento corrigido, um pendente');
  ok(salvos.at(-1).markdown.includes(NOVA1) && salvos.at(-1).verificacaoIA.corrigidos[0].antes === FRASE1, 'a nota corrigida e o registro da correção vão para o Firebase');
  const hF = E.avisoVerificacaoHtml(itF);
  ok(/✔ <strong style="color:inherit">Agente revisor \(gemini-3\.8-flash\):<\/strong> encontrou um trecho sem respaldo nos documentos e corrigiu a frase/.test(hF) && hF.includes(FRASE1.replace(/</g, '&lt;')) && hF.includes(NOVA1), 'o card diz que o Agente revisor corrigiu e mostra o antes e o depois');
  ok(/⚠ <strong style="color:inherit">Agente revisor \(gemini-3\.8-flash\):<\/strong> o trecho a seguir não tem respaldo nos documentos e não pôde ser corrigido automaticamente/.test(hF) && /uso de animais de tração no campo/.test(hF), 'o que não foi corrigido continua como aviso, atribuído ao Agente revisor');

  chamadas = [];
  const itG = { chave: 'G', analise: { markdown: NOTA_F, geradoEm: 'g' } };
  filaIA = [JSON.stringify({ itens: [ITENS_F[0]] }), 'resposta sem json'];
  await E.verificarNotaComIA(itG, [], 'dados');
  ok(itG.analise.markdown === NOTA_F && itG.analise.verificacaoIA.itens.length === 1 && itG.analise.verificacaoIA.correcaoFalhou && /não pôde ser corrigido automaticamente/.test(E.avisoVerificacaoHtml(itG)), 'correção que falha não mexe na nota: o apontamento fica, como antes');
  chamadas = [];
  const itH = { chave: 'H', analise: { markdown: NOTA_F, formato: 'html', html: '<p>editada</p>' } };
  filaIA = [JSON.stringify({ itens: [ITENS_F[0]] })];
  await E.verificarNotaComIA(itH, [], 'dados');
  ok(chamadas.length === 1 && itH.analise.markdown === NOTA_F, 'nota editada à mão não é corrigida automaticamente (só apontada)');
  chamadas = []; filaIA = [];
  respostaIA = '{"itens":[]}';
  await E.verificarNotaComIA({ chave: 'I', analise: { markdown: NOTA_F } }, [], 'dados');
  ok(chamadas.length === 1, 'sem apontamentos, não há chamada de correção');
  globalThis.escolherModelo = undefined;

  // a geração dispara a verificação depois de salvar; "Completar" verifica de novo
  ok(/\.finally\(\(\) => verificarNotaComIA\(it, pdfBuffers, dadosPauta\)\)/.test(src), 'a geração verifica a nota depois de salvá-la');
  ok(/delete it\.analise\.verificacaoIA;[\s\S]{0,400}verificarNotaComIA\(it, pdfBuffers, dadosPauta\);/.test(src), '"Completar" descarta a verificação do texto truncado e verifica de novo');
  ok(/conteudo\.innerHTML = avisoVerificacaoHtml\(it\) \+ avisoRefs \+ notaDisplayHtml\(it\);/.test(src), 'o card mostra os dois avisos acima da nota');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
