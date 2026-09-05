// Parecer de Especialista v3 — ficha, tese, contraditório, gates, rubrica e o
// pipeline inteiro sem rede e com modelo falso.
//
// O que estes testes travam, cada um por um defeito visto numa rodada real:
//   1. a ficha sai da transcrição do documento (EMI da MPV 1357) quando a lei
//      não é obtida, com os valores 20%, 60%, US$ 50 — e diz a origem;
//   2. a síntese que não enuncia esses valores reprova (G2);
//   3. afirmação que cita evidência inexistente, ou traz número fora das
//      evidências citadas, é removida; veredito "atingido" com nível B é
//      rebaixado; atribuição causal é removida;
//   4. contraditório: fato refutado sai; juízo refutado vira "não verificável";
//   5. redação: parágrafo de juízo sem marcador reprova; cifra por extenso
//      reprova; G3 rebaixa "atingido" no texto;
//   6. o pipeline completo, com modelo falso, produz um parecer aprovado na
//      rubrica — e, com um modelo que inventa, produz um parecer que a
//      conferência marca.
//
// Uso: node testes/parecer-v3.test.js
const path = require('path');
const fs = require('fs');
const RAIZ = path.join(__dirname, '..');
const F = require(path.join(RAIZ, 'ficha.js'));
const T = require(path.join(RAIZ, 'tese.js'));
const G = require(path.join(RAIZ, 'gates.js'));
const D = require(path.join(RAIZ, 'dossie.js'));
const PP = require(path.join(RAIZ, 'pipeline-parecer.js'));
const H = require(path.join(RAIZ, 'parecer-html.js'));
const fx = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const TRECHO_EMI = 'De acordo com o art. 1º, § 2º-A, do Decreto-Lei nº 1.804, de 3 de setembro de 1980, o imposto de importação do regime de tributação simplificada é calculado de acordo com a seguinte tabela progressiva: De (US$) Até (US$) Alíquota Parcela a Deduzir 0 50,00 20,0% - 50,01 3.000,00 60,0% US$ 20,00';
const achadosX = [
  { lente: 'X', pergunta: 'dispositivo', achado: 'art. 1º, § 2º-A e § 2º-B, do Decreto-Lei 1.804/1980', trecho: 'Decreto-Lei nº 1.804, de 3 de setembro de 1980, passa a vigorar' },
  { lente: 'X', pergunta: 'regra_antes', achado: 'Até US$ 50,00: alíquota de 20%; de US$ 50,01 a US$ 3.000,00: 60%, com parcela a deduzir de US$ 20,00.', trecho: TRECHO_EMI },
  { lente: 'X', pergunta: 'regra_depois', achado: 'Ato do Ministro da Fazenda poderá reduzir a alíquota a zero até US$ 50,00 e a 30% na faixa até US$ 3.000,00.', trecho: 'inclusive para reduzi-las a zero na faixa de tributação de até US$ 50,00' },
  { lente: 'X', pergunta: 'objetivo', achado: 'Aperfeiçoar a conformidade tributária e aduaneira no comércio eletrônico internacional.', trecho: 'aperfeiçoar os mecanismos de conformidade tributária e aduaneira' },
  { lente: 'X', pergunta: 'historico', achado: 'A MP foi editada em 12 de maio de 2026.', trecho: 'entra em vigor na data de sua publicação. Brasília, 12 de maio de 2026' },
  { lente: '2', pergunta: '2.3', achado: 'O II é exceção às anterioridades (art. 150, § 1º, da CF); efeitos desde a publicação.', dispositivo: 'art. 2º da MPV', trecho: 'Esta Medida Provisória entra em vigor na data de sua publicação' },
];

(async () => {
  console.log('== ficha do objeto ==');
  const ficha = F.montarFicha({ achados: achadosX, leiVigente: [], marco: { data: '2026-05-12', trecho: 'entra em vigor na data de sua publicação — Brasília, 12 de maio de 2026' }, identificacao: 'MPV 1357/2026' });
  ok(ficha.regraVigente && ficha.regraVigente.origem === 'documento', 'sem lei obtida, a regra vigente vem do documento e a origem diz isso');
  const normas = ficha.valores.map(v => v.norm);
  ok(normas.includes('20%') && normas.includes('60%') && normas.includes('us$50') && normas.includes('us$3000') && normas.includes('30%'), 'valores da regra: 20%, 60%, US$ 50, US$ 3.000, 30% (' + normas.join(' ') + ')');
  ok(ficha.completa, 'ficha completa: ' + ficha.faltas.join(','));
  const comLei = F.montarFicha({ achados: achadosX, leiVigente: [{ norma: 'Lei nº 14.902, de 2024', compilado: true, url: 'u', trechos: [{ artigo: 'Art. 32', texto: 'Art. 32. O art. 1º do Decreto-Lei nº 1.804 passa a vigorar: § 2º-A tabela 0 50,00 20,0% 50,01 3.000,00 60,0% US$ 20,00' }] }], marco: ficha.dataEfeito });
  ok(comLei.regraVigente.origem === 'planalto' && /Art\. 32/.test(comLei.regraVigente.fonte), 'com lei obtida, a regra vigente vem do texto compilado (casou pelos valores)');
  // Rodada real: o texto ORIGINAL de 1980 do DL 1.804 (Senado, não compilado) entrou como regra vigente com uma isenção revogada.
  const antigo = F.montarFicha({ achados: achadosX, leiVigente: [{ norma: 'Decreto-Lei nº 1.804, de 1980', compilado: false, desatualizado: true, url: 'u', trechos: [{ artigo: 'Art. 2º', texto: 'isenção do imposto de importação dos bens contidos em remessas de valor até US$20.00 quando destinadas a pessoas físicas' }] }], marco: ficha.dataEfeito });
  ok(antigo.regraVigente.origem === 'documento', 'texto original não compilado de norma antiga NÃO vira regra vigente; cai para a transcrição do documento');
  const semAntes = F.montarFicha({ achados: achadosX.filter(a => a.pergunta !== 'regra_antes'), leiVigente: [], marco: null });
  ok(semAntes.faltas.includes('regra vigente') && semAntes.faltas.includes('data de efeito') && !semAntes.completa, 'sem regra antes nem marco, a ficha declara as faltas');
  // Rodada 4 real: o modelo não devolveu "regra_antes" embora a EMI transcreva a tabela — o programa a localiza.
  const porPrograma = F.montarFicha({ achados: achadosX.filter(a => a.pergunta !== 'regra_antes'), leiVigente: [], marco: ficha.dataEfeito, fonte: 'Considerando que ' + TRECHO_EMI + '. Outro parágrafo.' });
  ok(porPrograma.regraVigente && /localizada por programa/.test(porPrograma.regraVigente.fonte) && porPrograma.valores.some(v => v.norm === '20%'), 'sem achado "regra_antes", a regra vigente é localizada no texto por padrão ("tabela progressiva") com os valores');
  ok(!F.regraVigenteNoTexto('Atualmente, a proposta é boa e simples.'), 'padrão sem ao menos dois valores não vira regra vigente');
  ok(F.objetoEnunciado('A alíquota passa de 20% para zero até US$ 50, e de 60% para 30% acima disso.', ficha).ok, 'síntese que enuncia 20%, 60%, US$ 50 passa no G2');
  ok(!F.objetoEnunciado('A MP delega ao Ministro a alteração das alíquotas do regime simplificado.', ficha).ok, 'síntese sem valores reprova no G2 (o caso real)');
  ok(/Regra vigente \(transcri/.test(F.fichaParaTexto(ficha)) && /<table class="ficha">/.test(F.fichaParaHtml(ficha)), 'ficha em texto e em HTML');

  console.log('== catálogo e validação da tese ==');
  const dossie = { nivel: 'B', estimativas: [{ literal: 'R$ 3,5 bilhões', trecho: 'para 2024, R$ 3,5 bilhões associados ao Programa Mover', rotulo: 'Parecer do Senado', vinculo: false }], negacoes: [{ trecho: 'não ocasiona renúncia de receitas tributárias', rotulo: 'EMI 1146/2026' }], marco: { data: '2026-05-12', trecho: 'x' }, leiVigente: [], janelas: {}, fontes: [], avisos: [],
    prc: { relatorios: 29, primeiro: '2023-08', ultimo: '2026-07', janelas: { nivel: 'B', antes: { de: '2025-05', ate: '2026-04', meses: 12, porMes: { remessas: 15.2e6, usd: 305.8e6, ii: 446.6e6, iiPrc: 319.6e6, iiNaoPrc: 127e6 }, ticketUsd: 20.07, aliquotaEfetiva: 0.272, participacaoPrc: 0.965 }, depois: { de: '2026-05', ate: '2026-07', meses: 3, porMes: { remessas: 25.1e6, usd: 517.2e6, ii: 297e6, iiPrc: 139.4e6, iiNaoPrc: 157.6e6 }, ticketUsd: 20.83, aliquotaEfetiva: 0.113, participacaoPrc: 0.975 } } } };
  const cat = T.catalogoDeEvidencias({ achados: achadosX, dossie, ficha, situacao: 'Aprovada pela Câmara em 03/09/2026; a MP perde vigência em 08/09/2026.' });
  ok(cat.porId.has('A1') && cat.porId.has('F1') && cat.porId.has('S1') && [...cat.porId.keys()].some(k => /^D\d+$/.test(k)), 'catálogo com situação (S1), achados, dossiê e ficha');
  ok(T.validarTese({ afirmacoes: [{ id: 'T1', secao: 'contexto', tipo: 'fato', texto: 'A MP perde vigência em 08/09/2026.', evidencias: ['S1'] }] }, cat, { nivel: 'B' }).tese.afirmacoes.length === 1, 'fato apoiado na situação da tramitação (S1) é aceito');
  const dIIdevido = cat.itens.find(i => /II devido total por m/.test(i.texto));
  ok(dIIdevido && dIIdevido.numeros.includes(446.6) && dIIdevido.numeros.includes(297), 'item do dossiê carrega os números da série (446,6 e 297,0)');
  const dNaoVinc = cat.itens.find(i => /NÃO vinculada/.test(i.texto));
  ok(!!dNaoVinc, 'estimativa do Mover marcada como não vinculada ao objeto (G6)');

  const tese = { afirmacoes: [
    { id: 'T1', secao: 'sintese', tipo: 'fato', texto: 'A alíquota de 20% até US$ 50 pode ser reduzida a zero por ato do Ministro.', evidencias: ['F1', 'A3'] },
    { id: 'T2', secao: 'aconteceu', tipo: 'calculo', texto: 'O II devido total caiu de R$ 446,6 milhões para R$ 297,0 milhões por mês.', evidencias: [dIIdevido.id] },
    { id: 'T3', secao: 'aconteceu', tipo: 'calculo', texto: 'O II devido caiu 48% ao mês.', evidencias: [dIIdevido.id] },
    { id: 'T4', secao: 'sintese', tipo: 'juizo', texto: 'A medida provocou a queda do imposto.', evidencias: [dIIdevido.id] },
    { id: 'T5', secao: 'contexto', tipo: 'fato', texto: 'A MP foi editada em 2026.', evidencias: ['Z9'] },
    { id: 'T6', secao: 'previu', tipo: 'fato', texto: 'O processo traz R$ 3,5 bilhões, mas associados ao Programa Mover.', evidencias: [dNaoVinc.id] },
  ], objetivos: [
    { id: 'O1', objetivo: 'Aperfeiçoar a conformidade', veredito: 'atingido', justificativa: 'a participação subiu', evidencias: [cat.itens.find(i => /participação do PRC/.test(i.texto)).id] },
    { id: 'O2', objetivo: 'Reduzir a tributação', veredito: 'não verificável', justificativa: 'x', evidencias: ['F1'] },
  ], lados: { apoia: { id: 'L1', argumento: 'Menos tributo, mais formalização.', o_que_a_evidencia_diz: 'a participação subiu 1 ponto', evidencias: [cat.itens.find(i => /participação do PRC/.test(i.texto)).id] }, opoe: { id: 'L2', argumento: 'Perda de arrecadação.', o_que_a_evidencia_diz: 'queda de 446,6 para 297,0', evidencias: [dIIdevido.id] } },
    opcoes: [ { id: 'P1', opcao: 'Aprovar o PLV', fiscal: 'queda de R$ 446,6 para R$ 297,0 milhões/mês', juridica: 'consolida a delegação', politica: 'atende ao consumidor', evidencias: [dIIdevido.id, 'F1'] }, { id: 'P2', opcao: 'Rejeitar', fiscal: 'x', juridica: 'y', politica: 'recomendamos o voto contrário', evidencias: ['F1'] } ],
    fatores_concorrentes: [{ fator: 'câmbio', evidencias: ['Z1'] }] };
  const v = T.validarTese(tese, cat, { nivel: 'B' });
  const ids = v.tese.afirmacoes.map(a => a.id);
  ok(ids.includes('T1') && ids.includes('T2') && ids.includes('T6'), 'afirmações bem apoiadas ficam (T1, T2, T6)');
  ok(v.removidas.some(r => r.id === 'T3' && /número fora/.test(r.motivo)), 'T3: número (48) fora das evidências citadas é removida');
  ok(v.removidas.some(r => r.id === 'T4' && /causal/.test(r.motivo)), 'T4: atribuição causal é removida');
  ok(v.removidas.some(r => r.id === 'T5' && /sem evidência/.test(r.motivo)), 'T5: evidência inexistente é removida');
  const o1 = v.tese.objetivos.find(o => o.id === 'O1');
  ok(o1 && o1.veredito === 'indícios de atingimento' && v.rebaixadas.some(r => r.id === 'O1'), 'O1: "atingido" com nível B rebaixado para "indícios de atingimento"');
  ok(v.tese.opcoes.length === 1 && v.removidas.some(r => r.id === 'P2' && /voto/.test(r.motivo)), 'P2: opção com recomendação de voto é removida');
  ok(v.tese.fatores_concorrentes.length === 0, 'fator concorrente sem evidência existente sai');

  console.log('== contraditório ==');
  const c = T.aplicarContraditorio(v.tese, [{ id: 'T2', refutada: false }, { id: 'T6', refutada: true, motivo: 'a evidência refere-se ao Programa Mover, outra parte do processo' }, { id: 'O1', refutada: true, motivo: 'um ponto em três meses não é indício' }, { id: 'L1', refutada: true, motivo: 'volume não é formalização' }, { id: 'P1', refutada: false }]);
  ok(!c.tese.afirmacoes.some(a => a.id === 'T6') && c.refutadas.some(r => r.id === 'T6'), 'fato refutado com erro concreto ("a evidência é do Mover") sai');
  const cOmissao = T.aplicarContraditorio(v.tese, [{ id: 'T2', refutada: true, motivo: 'A afirmação omite que a evidência tem limitações (nível B) e que maio é parcial.' }], cat);
  ok(cOmissao.tese.afirmacoes.some(a => a.id === 'T2') && cOmissao.ressalvas.some(r => r.id === 'T2') && !cOmissao.refutadas.length, 'cálculo "refutado" só por não repetir a ressalva da série é MANTIDO, com a ressalva registrada');
  const cConfunde = T.aplicarContraditorio(v.tese, [{ id: 'T2', refutada: true, motivo: 'Confunde imposto devido com arrecadação.' }], cat);
  ok(!cConfunde.tese.afirmacoes.some(a => a.id === 'T2'), 'cálculo refutado por erro de conceito ("confunde") sai');
  const subcit = T.validarTese({ afirmacoes: [{ id: 'T1', secao: 'aconteceu', tipo: 'calculo', texto: 'O II devido total caiu de R$ 446,6 milhões para R$ 297,0 milhões por mês.', evidencias: [cat.itens.find(i => /remessas recebidas por m/.test(i.texto)).id] }] }, cat, { nivel: 'B' });
  ok(subcit.tese.afirmacoes.length === 1 && subcit.tese.afirmacoes[0].evidenciasAcrescidas?.length === 1, 'número que existe em outro item do catálogo: a evidência é acrescentada em vez de remover a afirmação');
  ok(c.tese.objetivos.find(o => o.id === 'O1').veredito === 'não verificável' && c.contestadas.some(x => x.id === 'O1'), 'objetivo contestado vira "não verificável"');
  ok(c.tese.lados.apoia && /volume não é formalização/.test(c.tese.lados.apoia.contestado), 'lado contestado fica marcado');
  const pc = T.promptContraditorio({ identificacao: 'MPV 1357/2026', tese: v.tese, catalogo: cat, nivel: 'B' });
  ok(/REFUTAR/.test(pc) && /excede o nível/.test(pc) && /formalização/.test(pc), 'prompt do contraditório pede refutação por excesso de nível e por leitura errada de número');

  console.log('== redação: conferência, gates e rubrica ==');
  const teseFinal = c.tese;
  const bom = `Síntese\n\nO texto original da MPV 1357/2026 permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% acima disso, a partir de 12/05/2026 [T1].\n\nO imposto devido caiu de R$ 446,6 milhões para R$ 297,0 milhões por mês [T2].\n\nContexto e processo\n\nA MP foi editada em maio de 2026 e aprovada pela Câmara em setembro [A1].\n\nLei vigente e datas de efeito\n\nVale hoje 20% até US$ 50 [F1]. Efeitos imediatos por ser II [A5].\n\nO que se previu\n\nA EMI declara que não há renúncia [D2].\n\nO que aconteceu\n\nNos 3 meses posteriores, com maio parcial, o II devido total caiu de R$ 446,6 milhões para R$ 297,0 milhões por mês (nível de evidência B) [T2]. O parecer não atribui a diferença à medida.\n\nAvaliação da política\n\nObjetivo de conformidade: não verificável, porque a janela tem 3 meses [O1].\n\nObjetivo de reduzir a tributação: não verificável [O2].\n\nOs dois lados\n\nQuem apoia diz que menos tributo formaliza; a evidência mostra um ponto de participação em três meses [L1]. Quem se opõe aponta a queda de R$ 446,6 para R$ 297,0 milhões por mês [L2].\n\nOpções e consequências\n\nAprovar o PLV consolida a delegação, mantém a queda de arrecadação e atende ao consumidor [P1].\n\nRespostas por lente\n\nTributário\n\nO II é exceção às anterioridades (art. 150, § 1º, da CF) [A5].`;
  const conf = T.conferirRedacao(bom, { tese: teseFinal, catalogo: cat, ficha });
  ok(conf.ok, 'redação boa: sem parágrafo sem evidência, sem número fora da base (' + JSON.stringify({ s: conf.semEvidencia.length, n: conf.numerosSuspeitos.map(x => x.numero), i: conf.idsInexistentes }) + ')');
  const ruim = bom.replace('[T2].\n\nContexto', '.\n\nContexto').replace('R$ 446,6 milhões para R$ 297,0 milhões por mês (nível', 'R$ 500,0 milhões para R$ 297,0 milhões por mês (nível');
  const conf2 = T.conferirRedacao(ruim, { tese: teseFinal, catalogo: cat, ficha });
  ok(conf2.semEvidencia.length === 1 && conf2.numerosSuspeitos.some(n => n.numero === '500,0'), 'parágrafo de síntese sem marcador e número 500,0 fora da base são apontados');
  const lentes = [{ chave: 'tributario', ordem: '2', rotulo: 'Tributário' }];
  const g = G.aplicarGates({ ficha, dossie, tese: teseFinal, texto: bom, nivel: 'B' });
  ok(!g.reprovacoes.length && g.notas.some(n => /3 mês/.test(n)) && g.notas.some(n => /meio do mês|parcial/.test(n)) && g.notas.some(n => /Mover|outra parte/.test(n)), 'gates: sem reprovação; notas de janela curta, mês parcial e estimativa não vinculada, em linguagem de leitor');
  const semObjeto = bom.replace('permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% acima disso', 'delega ao Ministro a alteração das alíquotas');
  ok(G.aplicarGates({ ficha, dossie, tese: teseFinal, texto: semObjeto, nivel: 'B' }).reprovacoes.some(r => r.gate === 'G2'), 'G2 reprova a síntese que não enuncia a regra em algarismos');
  const comExtenso = bom.replace('R$ 446,6 milhões', 'quatrocentos e quarenta e seis milhões');
  ok(G.aplicarGates({ ficha, dossie, tese: teseFinal, texto: comExtenso, nivel: 'B' }).reprovacoes.some(r => r.gate === 'G5'), 'G5 reprova cifra por extenso');
  const atingido = bom.replace('Objetivo de conformidade: não verificável, porque a janela tem 3 meses [O1].', 'Objetivo de conformidade: atingido [O1].');
  const g3 = G.aplicarGates({ ficha, dossie, tese: teseFinal, texto: atingido, nivel: 'B' });
  ok(g3.rebaixamentos.some(r => r.gate === 'G3') && /ind[íi]cios de atingimento \[O1\]/.test(g3.texto), 'G3 rebaixa "atingido" para "indícios de atingimento" com nível B');
  const g3c = G.aplicarGates({ ficha, dossie, tese: teseFinal, texto: atingido, nivel: 'C' });
  ok(/n[ãa]o verific[áa]vel \[O1\]/.test(g3c.texto), 'G3 com nível C rebaixa para "não verificável"');
  const semRegra = F.montarFicha({ achados: achadosX.filter(a => a.pergunta !== 'regra_antes'), leiVigente: [], marco: ficha.dataEfeito });
  ok(G.aplicarGates({ ficha: semRegra, dossie, tese: teseFinal, texto: bom, nivel: 'B' }).faixas.some(f => /INCOMPLETO/.test(f)), 'G1 imprime a faixa de incompletude quando a regra vigente não foi obtida');
  ok(G.causaisNaoAtribuidas('Quem apoia argumenta que a medida aumentou a formalização [L1].').length === 0 && G.causaisNaoAtribuidas('A medida aumentou a formalização [T1].').length === 1, 'causalidade relatada como posição de um lado não conta; causalidade própria conta (M11)');
  ok(G.causaisNaoAtribuidas('A data de efeito da medida é 12/05/2026 [T1].').length === 0 && G.causaisNaoAtribuidas('O efeito da medida foi a queda do imposto [T1].').length === 1, '"data de efeito da medida" não é causa; "o efeito da medida foi a queda" é');
  const rub = G.rubricaMaquina({ texto: g.texto, ficha, tese: teseFinal, dossie, nivel: 'B', conferencia: conf, gates: g, temSerie: true });
  ok(rub.aprovado, 'rubrica aprova o parecer bom: ' + rub.pendentes.map(p => p.item).join('; '));
  const v3 = fx('real-blusinhas-parecer-v2.md');
  const fichaV3 = ficha;
  const rubV3 = G.rubricaMaquina({ texto: v3, ficha: fichaV3, tese: teseFinal, dossie, nivel: 'B', conferencia: T.conferirRedacao(v3, { tese: teseFinal, catalogo: cat, ficha }), gates: G.aplicarGates({ ficha, dossie, tese: teseFinal, texto: v3, nivel: 'B' }), temSerie: true });
  ok(!rubV3.aprovado && rubV3.pendentes.some(p => /M3/.test(p.item)) && rubV3.pendentes.some(p => /M4/.test(p.item)), 'a rubrica reprova o parecer real v2 rejeitado (M3 sem evidência; M4 "atingido" com nível B): ' + rubV3.pendentes.map(p => p.item.slice(0, 3)).join(','));
  ok(G.aplicarGates({ ficha, dossie, tese: teseFinal, texto: v3, nivel: 'B' }).reprovacoes.some(r => r.gate === 'G2'), 'e o G2 reprova o parecer real v2 por não enunciar 20%/60%/US$ 50');

  console.log('== conferência de trecho com quebra de página ==');
  {
    const doc = 'x'.repeat(600) + ' Apoiamos, dessa forma, o conteúdo da Emenda nº 3 – PLEN, do Senador Mecias de Jesus. Por ser incompatível [p12] 12 SF/24692.28045-78 com essa supressão, rejeitamos as Emendas nº 4 e 11 – PLEN, que propõem a tributação com alíquotas diferenciadas.';
    const trecho = 'Apoiamos, dessa forma, o conteúdo da Emenda nº 3 – PLEN, do Senador Mecias de Jesus. Por ser incompatível com essa supressão, rejeitamos as Emendas nº 4 e 11 – PLEN';
    const c = PP.conferirAchados([{ lente: 'X', pergunta: 'historico', achado: 'O relator apoiou a supressão.', trecho }], doc);
    ok(c.aprovados.length === 1, 'trecho que atravessa cabeçalho de página é localizado pelas duas metades');
    ok(PP.conferirAchados([{ lente: 'X', pergunta: 'historico', achado: 'x', trecho: 'Frase que não está no documento analisado de forma alguma, inventada pelo modelo.' }], doc).recusados.length === 1, 'trecho inventado continua recusado');
  }

  console.log('== pipeline completo com modelo falso ==');
  const textoDoc = fx('emi1146-trecho.txt') + ' ' + TRECHO_EMI + ' Esta Medida Provisória entra em vigor na data de sua publicação. Brasília, 12 de maio de 2026. Art. 1º O Decreto-Lei nº 1.804, de 3 de setembro de 1980, passa a vigorar. ' + 'inclusive para reduzi-las a zero na faixa de tributação de até US$ 50,00. aperfeiçoar os mecanismos de conformidade tributária e aduaneira. '.repeat(3) + 'x'.repeat(600);
  const respostas = {
    apuracao: JSON.stringify(achadosX.map(a => ({ ...a, semQuestao: false })).concat([{ lente: '2', pergunta: '2.1', semQuestao: true }])),
    tese: JSON.stringify({ afirmacoes: [
      { id: 'T1', secao: 'sintese', tipo: 'fato', texto: 'A MPV 1357/2026 permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% até US$ 3.000, a partir de 12/05/2026.', evidencias: ['F1', 'A3'] },
      { id: 'T2', secao: 'sintese', tipo: 'juizo', texto: 'Sem série oficial, o efeito da medida não é verificável.', evidencias: ['F1'] },
      { id: 'T3', secao: 'contexto', tipo: 'fato', texto: 'A EMI declara que a medida não ocasiona renúncia de receitas tributárias.', evidencias: ['D1', 'D2'] },
      { id: 'T9', secao: 'sintese', tipo: 'calculo', texto: 'A arrecadação cairá R$ 2,4 bilhões.', evidencias: ['F1'] },
    ], objetivos: [{ id: 'O1', objetivo: 'Aperfeiçoar a conformidade tributária', veredito: 'atingido', justificativa: 'x', evidencias: ['A4'] }],
      lados: { apoia: { id: 'L1', argumento: 'Simplifica e reduz a carga.', o_que_a_evidencia_diz: 'a EMI o afirma', evidencias: ['A4'] }, opoe: { id: 'L2', argumento: 'Renúncia sem estimativa.', o_que_a_evidencia_diz: 'a EMI nega renúncia', evidencias: ['D1', 'D2'] } },
      opcoes: [{ id: 'P1', opcao: 'Aprovar o texto', fiscal: 'renúncia não estimada', juridica: 'delegação regular', politica: 'alinha ao governo', evidencias: ['F1'] }, { id: 'P2', opcao: 'Condicionar à estimativa', fiscal: 'a', juridica: 'b', politica: 'c', evidencias: ['F1'] }], fatores_concorrentes: [] }),
    contraditorio: JSON.stringify([{ id: 'T1', refutada: false }, { id: 'T2', refutada: false }, { id: 'T3', refutada: false }, { id: 'O1', refutada: true, motivo: 'objetivo declarado não é resultado' }, { id: 'L1', refutada: false }, { id: 'L2', refutada: false }, { id: 'P1', refutada: false }, { id: 'P2', refutada: false }]),
    redacao: 'Síntese\n\nO texto original da MPV 1357/2026 permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% até US$ 3.000, a partir de 12/05/2026 [T1].\n\nSem série oficial, o efeito não é verificável (nível de evidência C) [T2].\n\nContexto e processo\n\nA EMI declara que não há renúncia [T3].\n\nLei vigente e datas de efeito\n\nVale 20% até US$ 50 [F1].\n\nO que se previu\n\nA EMI nega renúncia [D1].\n\nAvaliação da política\n\nObjetivo de conformidade: não verificável [O1].\n\nOs dois lados\n\nQuem apoia diz que simplifica [L1]. Quem se opõe aponta renúncia sem estimativa [L2].\n\nOpções e consequências\n\nAprovar consolida a delegação sem estimativa [P1].\n\nCondicionar à estimativa atende à LRF [P2].\n\nRespostas por lente\n\nTributário\n\nO II é exceção às anterioridades [A5]. Não identifiquei questão quanto à espécie tributária.',
  };
  const io = {
    chamarModelo: async ({ prompt }) => { const nome = /etapa de APURAÇÃO/.test(prompt) ? 'apuracao' : /apura o HISTÓRICO/.test(prompt) ? 'historico' : /formula a TESE/.test(prompt) ? 'tese' : /revisor ADVERSARIAL/.test(prompt) ? 'contraditorio' : 'redacao'; return { text: respostas[nome] || '[]', truncated: false }; },
    lerPdf: async () => textoDoc, fetchFn: null, abrirXlsx: null, onPasso: () => {},
  };
  const ctx = { identificacao: 'MPV 1357/2026', ementa: 'Altera o Decreto-Lei nº 1.804, de 3 de setembro de 1980, que dispõe sobre tributação simplificada das remessas postais internacionais.', temas: [{ cod: 70 }], docs: [{ rotulo: 'Texto original da MPV 1357/2026', buffer: Buffer.alloc(10) }], situacao: 'No Senado.', hoje: new Date('2026-09-05T12:00:00Z') };
  const p = await PP.gerarParecer(ctx, io);
  ok(!p.erro, 'pipeline roda de ponta a ponta sem rede: ' + (p.erro || 'ok'));
  if (!p.erro) {
    ok(p.ficha.completa && p.ficha.regraVigente.origem === 'documento', 'ficha montada do documento (Planalto indisponível)');
    ok(p.validacao.removidas.some(r => r.id === 'T9'), 'T9 (R$ 2,4 bi sem evidência) removida antes da redação');
    ok(p.contraditorio.contestadas.some(x => x.id === 'O1') && p.tese.objetivos[0].veredito === 'não verificável', 'O1 contestado vira "não verificável"');
    ok(p.rubrica.aprovado && p.aprovado, 'rubrica aprova: ' + p.rubrica.pendentes.map(x => x.item).join('; '));
    ok(p.chamadas.length === 5 && p.chamadas.some(c => c.nome === 'historico') && !p.refeita, 'cinco chamadas (com a de histórico, porque a apuração trouxe menos de três fatos), sem redação refeita');
    ok(T.validarTese({ afirmacoes: [{ id: 'T1', secao: 'opcoes', tipo: 'fato', texto: 'Rejeitada, a MP perde eficácia desde a edição, nos termos do art. 62, § 3º, da CF.', evidencias: ['F1'] }] }, T.catalogoDeEvidencias({ achados: achadosX, ficha }), { nivel: 'C' }).tese.afirmacoes.length === 1, '"art. 62" numa afirmação é referência normativa, não cifra fora da base');
    ok(p.gates.faixas.length === 0 && p.nivel === 'C', 'sem faixa de incompletude (regra veio do documento) e nível C');
    const html = H.htmlParecer(p, { materia: 'MPV 1357/2026', css: '' });
    ok(/Ficha do objeto/.test(html) && /class="ficha"/.test(html) && /<sup class="ev">T1<\/sup>/.test(html) && /id="l_Síntese"|id="l_S.ntese"/.test(html), 'HTML traz ficha, marcadores como sobrescrito e seções com âncora');
    ok(/M1 Ficha do objeto/.test(html) && /Conferência e ressalvas/.test(html), 'HTML traz a rubrica na conferência');
    // "Nível de evidência B" era jargão repetido no PDF sem explicação (crítica do usuário).
    ok(/Solidez da comparação antes × depois: <b>não comparável<\/b> — não há série oficial/.test(html), 'o nível de evidência é explicado em palavras na primeira página');
    const ocorr = html.match(/nível de evidência C/gi) || [];
    ok(ocorr.length >= 1 && /nível de evidência C \(sem base para comparar\)/.test(html), 'no corpo, a primeira ocorrência vem traduzida entre parênteses');
  }
  // modelo que não enuncia o objeto: a redação é refeita uma vez e, persistindo, o parecer sai reprovado
  const respostasRuins = { ...respostas, redacao: respostas.redacao.replace('permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% até US$ 3.000, a partir de 12/05/2026', 'delega ao Ministro a alteração das alíquotas') };
  const io2 = { ...io, chamarModelo: async ({ prompt }) => { const nome = /etapa de APURAÇÃO/.test(prompt) ? 'apuracao' : /apura o HISTÓRICO/.test(prompt) ? 'historico' : /formula a TESE/.test(prompt) ? 'tese' : /revisor ADVERSARIAL/.test(prompt) ? 'contraditorio' : 'redacao'; return { text: respostasRuins[nome] || '[]', truncated: false }; } };
  // sem histórico na apuração geral, o pipeline faz UMA chamada só para ele
  const io3 = { ...io, chamarModelo: async ({ prompt }) => { if (/etapa de APURAÇÃO/.test(prompt)) return { text: JSON.stringify(achadosX.filter(a => a.pergunta !== 'historico')), truncated: false }; if (/apura o HISTÓRICO/.test(prompt)) return { text: JSON.stringify([{ lente: 'X', pergunta: 'historico', achado: 'A MP foi editada em 12 de maio de 2026.', trecho: 'entra em vigor na data de sua publicação. Brasília, 12 de maio de 2026' }]), truncated: false }; return io.chamarModelo({ prompt }); } };
  const p3 = await PP.gerarParecer(ctx, io3);
  ok(!p3.erro && p3.chamadas.some(c => c.nome === 'historico') && p3.chamadas.length === 5 && p3.catalogo.itens > p.catalogo.itens - 1, 'sem histórico na apuração geral, há uma chamada dedicada e o achado entra');
  const p2 = await PP.gerarParecer(ctx, io2);
  ok(!p2.erro && p2.refeita && p2.chamadas.length === 6 && !p2.aprovado && p2.gates.reprovacoes.some(r => r.gate === 'G2'), 'síntese sem o objeto: redação refeita e, persistindo, parecer reprovado no G2');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
