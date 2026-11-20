// Plenário: parecer de relator em comissão que a comissão NÃO votou (19/11/2026).
//
// CASO REAL: PL 294/2015. Na CSSF (2021) e na CPASF (2026, retirado de pauta) só há PRL — o parecer que
// o(a) relator(a) apresenta. O programa chamava os dois documentos de "Parecer da Comissão …" e o prompt
// mandava escrever "A Comissão …, sob relatoria …, aprovou um substitutivo". A nota saiu dizendo que as
// comissões aprovaram, e a verificação por IA apontou (com razão) três trechos sem respaldo.
//
// O que este teste trava:
//   1. a leitura da página de pareceres marca `votado: false` quando só há PRL, e `votado: true` quando
//      há PAR (parecer da comissão) ou SBT-A (substitutivo adotado) da mesma comissão, na data do PRL ou depois;
//   2. o documento não votado recebe o rótulo "Parecer do(a) relator(a) na Comissão … — ainda não votado";
//   3. o prompt diz que a comissão não deliberou e proíbe "a Comissão aprovou" nesse caso;
//   4. o rótulo dos avisos (fundo claro) herda a cor do aviso: estava ilegível, em texto claro.
// Uso: node testes/parecer-comissao-nao-votado.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const { DOMParser } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const fn = nome => trecho(new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== 1. a comissão votou o parecer? ==');
  const buscar = html => new Function('fetchHtmlCamara', 'DOMParser', `${fn('buscarPareceresPlenario')}\nreturn buscarPareceresPlenario;`)(async () => html, DOMParser)(1);
  const real = await buscar(fs.readFileSync(path.join(__dirname, 'fixtures', 'camara', 'pareceres-pl294-2015.html'), 'utf8'));
  const de = (r, c) => r.comissoes.find(x => x.comissao === c);
  ok(real.comissoes.length === 2 && de(real, 'CSSF') && de(real, 'CPASF'), 'PL 294/2015: duas comissões com parecer (CSSF e CPASF)');
  ok(de(real, 'CSSF').votado === false && de(real, 'CPASF').votado === false, 'só há PRL nas duas: nenhuma votou o parecer');
  ok(de(real, 'CPASF').sigla === 'PRL' && de(real, 'CPASF').dataBR === '22/04/2026', 'na CPASF vale o PRL mais recente (22/04/2026)');
  const linha = (sig, tipo, data) => `<tr><td>${sig} => PL 1/2026</td><td>${tipo}</td><td>${data}</td><td>Fulano</td><td><a href="prop_mostrarintegra?codteor=${Math.abs(sig.split('').reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7))}">Inteiro teor</a></td></tr>`;
  const tabela = (...l) => `<html><body><table>${l.join('')}</table></body></html>`;
  const comPar = await buscar(tabela(linha('PRL 1 CCJC', 'Parecer do Relator', '10/03/2026'), linha('PAR 1 CCJC', 'Parecer de Comissão', '18/03/2026'), linha('PRL 1 CFT', 'Parecer do Relator', '02/04/2026')));
  ok(de(comPar, 'CCJC').votado === true && de(comPar, 'CCJC').votadoEm === '18/03/2026', 'PRL seguido de PAR da mesma comissão: votado, com a data da deliberação');
  ok(de(comPar, 'CFT').votado === false, 'a outra comissão, só com PRL, não votou');
  const reexame = await buscar(tabela(linha('PRL 1 CCJC', 'Parecer do Relator', '10/03/2026'), linha('PAR 1 CCJC', 'Parecer de Comissão', '18/03/2026'), linha('PRL 2 CCJC', 'Parecer do Relator', '20/05/2026')));
  ok(de(reexame, 'CCJC').dataBR === '20/05/2026' && de(reexame, 'CCJC').votado === false, 'PRL novo, posterior ao PAR (reexame): o parecer em mãos ainda não foi votado');
  const comSbtA = await buscar(tabela(linha('PRL 2 CSAUDE', 'Parecer do Relator', '05/05/2026'), linha('SBT-A 1 CSAUDE', 'Substitutivo adotado', '12/05/2026')));
  ok(de(comSbtA, 'CSAUDE').votado === true, 'substitutivo adotado pela comissão (SBT-A) depois do PRL: votado');
  // CASOS REAIS (PL 2559/2022 e PL 2819/2020): a data do PRL virou "a comissão aprovou em". Guarda-se a da deliberação.
  const duasDatas = await buscar(tabela(linha('PRL 1 CDHMIR', 'Parecer do Relator', '20/03/2025'), linha('SBT-A 1 CDHMIR', 'Substitutivo adotado', '02/09/2025')));
  ok(de(duasDatas, 'CDHMIR').dataBR === '20/03/2025' && de(duasDatas, 'CDHMIR').votadoEm === '02/09/2025' && de(duasDatas, 'CDHMIR').votadoPor === 'SBT-A', 'PRL de 20/03/2025 e substitutivo adotado em 02/09/2025: as duas datas ficam separadas');
  const parEsbt = await buscar(tabela(linha('PRL 6 CDHMIR', 'Parecer do Relator', '03/10/2025'), linha('PAR 1 CDHMIR', 'Parecer de Comissão', '22/04/2026'), linha('SBT-A 1 CDHMIR', 'Substitutivo adotado', '28/04/2026')));
  ok(de(parEsbt, 'CDHMIR').votadoEm === '22/04/2026' && de(parEsbt, 'CDHMIR').votadoPor === 'PAR', 'com PAR e SBT-A, a data da aprovação é a do parecer da comissão (PAR)');
  const soPar = await buscar(tabela(linha('PAR 1 CCJC', 'Parecer de Comissão', '18/03/2026')));
  ok(de(soPar, 'CCJC').votado === true, 'só o PAR na página: votado');

  console.log('\n== 2. rótulo do documento ==');
  const bloco = trecho(/for \(const pc of comissoesCron\) \{[\s\S]*?\n    \}/);
  const rotular = pc => { const docs = []; new Function('comissoesCron', 'docs', bloco)([pc], docs); return docs[0]; };
  const dNao = rotular({ comissao: 'CPASF', dataBR: '22/04/2026', url: 'u', votado: false });
  ok(dNao.rotulo === 'Parecer do(a) relator(a) na Comissão CPASF de 22/04/2026 — ainda não votado pela comissão' && dNao.naoVotado === true && dNao.tipo === 'PARECER_COMISSAO', 'não votado: "Parecer do(a) relator(a) na Comissão CPASF de 22/04/2026 — ainda não votado pela comissão"');
  const dSim = rotular({ comissao: 'CCJC', dataBR: '18/03/2026', url: 'u', votado: true });
  ok(dSim.rotulo === 'Parecer da Comissão CCJC de 18/03/2026' && !('naoVotado' in dSim), 'votado: "Parecer da Comissão CCJC de 18/03/2026"');
  ok(rotular({ comissao: 'CCJC', dataBR: '18/03/2026', url: 'u' }).rotulo === 'Parecer da Comissão CCJC de 18/03/2026', 'enriquecimento antigo, sem o campo: rótulo de antes');
  ok(rotular({ comissao: 'CDHMIR', dataBR: '20/03/2025', url: 'u', votado: true, votadoEm: '02/09/2025', votadoPor: 'SBT-A' }).rotulo === 'Parecer da Comissão CDHMIR — parecer do(a) relator(a) de 20/03/2025; substitutivo adotado pela comissão em 02/09/2025', 'votado em outra data: o rótulo traz a do parecer do relator e a da adoção do substitutivo');
  ok(rotular({ comissao: 'CDHMIR', dataBR: '03/10/2025', url: 'u', votado: true, votadoEm: '22/04/2026', votadoPor: 'PAR' }).rotulo === 'Parecer da Comissão CDHMIR — parecer do(a) relator(a) de 03/10/2025; aprovado pela comissão em 22/04/2026', 'idem com o parecer da comissão (PAR)');
  ok(rotular({ comissao: 'CCJC', dataBR: '18/03/2026', url: 'u', votado: true, votadoEm: '18/03/2026', votadoPor: 'PAR' }).rotulo === 'Parecer da Comissão CCJC de 18/03/2026', 'mesma data: rótulo simples');
  ok(rotular({ comissao: 'Comissão Especial', especial: true, dataBR: '01/06/2026', url: 'u', votado: false }).rotulo === 'Parecer do(a) relator(a) na Comissão Especial de 01/06/2026 — ainda não votado pela comissão', 'Comissão Especial não votada: mesmo padrão');

  console.log('\n== 3. prompt ==');
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
    return { montarPrompt, promptPDL };
  `)();
  const pl = { sigla: 'PL', numero: '294', ano: '2015', tipoCategoria: 'projeto', ementa: 'Altera as Leis nos 8.212 e 8.213…', enriquecimento: {} };
  const inteiro = { tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor da proposição', url: 'u' };
  const p = PR.montarPrompt(pl, [inteiro, { ...rotular({ comissao: 'CSSF', dataBR: '31/08/2021', url: 'u', votado: false }) }, dNao]);
  ok(/ATENÇÃO À NATUREZA DO PARECER DE COMISSÃO: os documentos "Parecer do\(a\) relator\(a\) na Comissão CSSF de 31\/08\/2021 — ainda não votado pela comissão" e "Parecer do\(a\) relator\(a\) na Comissão CPASF de 22\/04\/2026 — ainda não votado pela comissão" são pareceres apresentados pelo\(a\) relator\(a\) e NÃO foram votados pela comissão/.test(p), 'o cenário nomeia os pareceres não votados');
  ok(/nunca "a Comissão aprovou" nem "substitutivo aprovado \(ou adotado\) pela Comissão"/.test(p), 'a nota inteira não pode dizer "a Comissão aprovou" nem "substitutivo aprovado pela Comissão"');
  const sec = p.slice(p.indexOf('## Pareceres das comissões'));
  ok(/"Na Comissão de <nome>, o\(a\) relator\(a\), Deputado\(a\) <nome>, apresentou em <data> parecer/.test(sec) && /a comissão NÃO deliberou/.test(sec), 'a seção "Pareceres das comissões" tem o formato próprio do parecer não votado');
  ok(/só afirme que aprovou se o próprio documento registrar a deliberação/.test(sec), 'mesmo no "Parecer da Comissão", só se afirma aprovação que o documento registrar');
  ok(/A data do parecer do\(a\) relator\(a\) é a da APRESENTAÇÃO, nunca a da aprovação/.test(sec) && /a aprovação é a SEGUNDA/.test(sec), 'datas: a do parecer do relator é a da apresentação; com duas datas no rótulo, a aprovação é a segunda');
  ok(/no formato "20 de março de 2025" \(dia e ano em algarismos\), nunca com os números por extenso/.test(sec) && !/data por extenso/.test(sec) && /Não fale em "redação final" de comissão/.test(sec), 'datas em algarismos (não "vinte de março de dois mil e vinte e cinco") e sem "redação final" de comissão');
  // CASO REAL (PL 4887/2023, 19/11/2026): o Objetivo disse que o projeto abrange "desde a educação básica até o ensino
  // superior"; isso só está no substitutivo da relatora na CPASF, não votado. O projeto fala em "estabelecimentos de ensino".
  ok(/NÃO MISTURE OS DOIS TEXTOS: nas seções "Objetivo", "Justificativa" e de principais disposições, descreva só o que está no texto em votação/.test(p) && /não pode ser apresentado como conteúdo do projeto/.test(p), 'o que só consta do substitutivo não votado não entra no Objetivo nem nas disposições como conteúdo do projeto');
  // CASO REAL (PL 4887/2023, 2ª vez): "O texto que está sendo votado, conforme o substitutivo da relatora" — a seção pedia
  // "o conteúdo do parecer/substitutivo que está sendo votado" mesmo quando o que se vota é o projeto original.
  const secPar = p.slice(p.indexOf('## Pareceres e substitutivos'), p.indexOf('## Argumentos favoráveis e contrários'));
  ok(/diga que o texto em votação é o do projeto original \(documento "Inteiro teor da proposição"\)/.test(secPar) && /Nunca escreva que o texto em votação é um substitutivo, nem "conforme o substitutivo"/.test(secPar), 'só o projeto em votação: a seção de pareceres diz que o texto em votação é o projeto original');
  ok(!/descreva diretamente o conteúdo do parecer\/substitutivo\/emendas que está sendo votado/.test(p) && !/o substitutivo, a subemenda, o conjunto de emendas ou o próprio projeto/.test(p), 'e o prompt não fala mais em "parecer/substitutivo que está sendo votado"');
  ok(/Quais são os pontos centrais do projeto original \(documento "Inteiro teor da proposição"\), que é o texto em votação\? Descreva só o que está nesse documento\./.test(secPar), 'principais disposições: só o que está no projeto original');
  ok(/registre que há parecer de relator\(a\) em comissão ainda não votado/.test(secPar) && /sempre como proposta do\(a\) relator\(a\)/.test(secPar), 'o substitutivo não votado entra como proposta do relator, com o que difere do projeto');
  const pSbt = PR.montarPrompt(pl, [{ tipo: 'SBT_A', rotulo: 'Substitutivo adotado por comissão (SBT-A nº 1 — CDHMIR de 02/09/2025)', url: 'u' }, { tipo: 'REDACAO_ORIGINAL', rotulo: 'Redação original (inteiro teor)', url: 'u' }, dSim]);
  ok(/descreva diretamente o conteúdo do parecer\/substitutivo\/emendas que está sendo votado/.test(pSbt) && !/o texto em votação é o do projeto original/.test(pSbt), 'com substitutivo adotado, a instrução de antes continua valendo');
  // CASOS REAIS (PL 2819/2020 e PL 1969/2022, 19/11/2026): a nota disse que o substitutivo "introduz" a definição de racismo
  // institucional e a natureza personalíssima do benefício, que já estavam no projeto original; e escreveu
  // "1 de junho de 2021 (data de referência documental)" para um parecer de 01/06/2022.
  ok(/Antes de escrever que o texto em votação "introduz", "cria", "acrescenta" ou "inclui" uma regra, localize o dispositivo correspondente na redação original/.test(pSbt) && /Só chame de novo o que não existe na redação original/.test(pSbt), 'cotejo: o que já estava na redação original foi mantido, não introduzido');
  ok(/regra que já constava do projeto original foi mantida, não introduzida/.test(pSbt) && /A data de cada parecer é a que está no rótulo do documento, inteira/.test(pSbt), 'pareceres das comissões: não atribuir ao substitutivo o que já era do projeto; data inteira do rótulo, sem observações');
  const pVotado = PR.montarPrompt(pl, [inteiro, dSim]);
  ok(!/ATENÇÃO À NATUREZA DO PARECER DE COMISSÃO/.test(pVotado), 'com parecer votado, o aviso do cenário não aparece');
  const pdl = { sigla: 'PDL', numero: '10', ano: '2026', tipoCategoria: 'projeto', ementa: 'Aprova o texto do Acordo…', enriquecimento: {} };
  ok(/Documento com o rótulo "ainda não votado pela comissão" é parecer só apresentado/.test(PR.promptPDL(pdl, [inteiro, dNao])), 'PDL: o parágrafo por comissão também distingue o parecer só apresentado');

  console.log('\n== 4. rótulo dos avisos legível ==');
  ok(/<strong style="color:inherit">\$\{quem\}:<\/strong>/.test(src) && /<strong style="color:inherit">Conferência automática de referências/.test(src), 'os dois avisos de fundo claro herdam a cor escura no rótulo em negrito');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
