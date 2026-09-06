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
const P = require(path.join(RAIZ, 'parecer.js'));
const E = require(path.join(RAIZ, 'especialistas.js'));
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

  console.log('== ficha de matéria qualitativa (PL 1893/2026: negociação coletiva, sem números) ==');
  {
    const fontePL = 'A lacuna tornou-se ainda mais sensível após o Supremo Tribunal Federal declarar a inconstitucionalidade das alíneas d e e do art. 240 da Lei nº 8.112, de 11 de dezembro de 1990. Art. 19. Esta Lei entra em vigor noventa dias após a data de sua publicação. Brasília, 11 de agosto de 2026.';
    const achadosPL = [
      { lente: 'X', pergunta: 'dispositivo', achado: 'art. 240 da Lei 8.112/1990 e lei nova (arts. 1º a 19)', trecho: 'alíneas d e e do art. 240 da Lei nº 8.112, de 11 de dezembro de 1990' },
      { lente: 'X', pergunta: 'regra_antes', achado: 'Não há lei que discipline a negociação coletiva no setor público; as alíneas d e e do art. 240 da Lei 8.112/1990 foram declaradas inconstitucionais.', trecho: 'A lacuna tornou-se ainda mais sensível após o Supremo Tribunal Federal' },
      { lente: 'X', pergunta: 'regra_depois', achado: 'Institui a negociação das relações de trabalho no setor público e a representação sindical dos servidores.', trecho: 'Esta Lei entra em vigor noventa dias após a data de sua publicação' },
    ];
    const fq = F.montarFicha({ achados: achadosPL, leiVigente: [{ norma: 'Lei nº 8.112, de 11 de dezembro de 1990', compilado: false, desatualizado: true, url: 'u', trechos: [{ artigo: 'Art. 240', texto: 'Art. 240. Ao servidor público civil é assegurado, nos termos da Constituição Federal, o direito à livre associação sindical e os seguintes direitos, entre outros, dela decorrentes: d) de negociação coletiva; e) de ajuizamento' }] }],
      marco: { data: '2026-08-11', trecho: 'entra em vigor na data de sua publicação — Brasília, 11 de agosto de 2026' }, identificacao: 'PL 1893/2026', fonte: fontePL, sigla: 'PL' });
    ok(fq.completa && !fq.quantitativa && !fq.faltas.length, 'regra sem números: ficha completa sem exigir valores (faltas: ' + fq.faltas.join(', ') + ')');
    ok(fq.regraVigente && fq.regraVigente.origem === 'documento' && /Não há lei/.test(fq.regraVigente.texto), 'texto original de 1990 recusado; "não há lei que discipline" vale como regra vigente, com origem declarada');
    ok(fq.dataEfeito && fq.dataEfeito.data === null && /noventa dias/.test(fq.dataEfeito.clausula) && fq.dataEfeito.condicional && /se aprovado/.test(F.dataEfeitoTexto(fq)), 'projeto: a data do fecho do parecer não vira vigência; vale a cláusula, condicionada à aprovação');
    ok(F.objetoEnunciado('O PL 1893/2026 institui a negociação coletiva e altera o art. 240 da Lei 8.112/1990.', fq).ok && !F.objetoEnunciado('O projeto institui a negociação coletiva.', fq).ok, 'G2 sem números: a síntese tem de nomear a norma alterada (8.112)');
    const comLegin = F.montarFicha({ achados: achadosPL.map(a => a.pergunta === 'dispositivo' ? { ...a, achado: 'A proposição institui marco legal autônomo sobre negociação no setor público.' } : a),
      leiVigente: [{ norma: 'Lei nº 8.112, de 11 de dezembro de 1990', origem: 'camara', compilado: true, url: 'https://www2.camara.leg.br/legin/x-normaatualizada-pl.html', trechos: [{ artigo: 'Art. 92', texto: 'Art. 92. É assegurado ao servidor o direito à licença sem remuneração' }, { artigo: 'Art. 240', texto: 'Art. 240. Ao servidor público civil é assegurado o direito à livre associação sindical: d) (Revogada pela Lei nº 9.527, de 10/12/1997 )' }] }],
      marco: null, identificacao: 'PL 1893/2026', fonte: fontePL, sigla: 'PL' });
    ok(comLegin.regraVigente && comLegin.regraVigente.origem === 'camara' && /Art\. 240/.test(comLegin.regraVigente.texto) && /Portal da Legislação da Câmara/.test(comLegin.regraVigente.fonte) && /Não há lei/.test(comLegin.regraVigente.noDocumento || ''), 'com o LEGIN: o art. 240 citado na regra_antes (não no dispositivo) casa com a lei lida; a descrição do documento vai junto');
    ok(/Como o documento analisado descreve/.test(F.fichaParaHtml(comLegin)) && /ficha-doc/.test(F.fichaParaHtml(comLegin)), 'a ficha impressa mostra a lei e, abaixo, a situação como o documento a descreve');
    const semRegraPL = F.montarFicha({ achados: achadosPL.filter(a => a.pergunta !== 'regra_antes'), leiVigente: fq.leiTentada.map(l => ({ norma: l.norma, compilado: false, desatualizado: true, trechos: [] })), marco: null, identificacao: 'PL 1893/2026', fonte: fontePL });
    const gq = G.aplicarGates({ ficha: semRegraPL, dossie: { avisos: [] }, tese: { afirmacoes: [] }, texto: 'Síntese\n\nx', nivel: 'C' });
    ok(gq.faixas.some(f => /texto original de Lei nº 8\.112/.test(f) && /não vale como regra vigente/.test(f)), 'G1 diz a causa exata: Planalto mudo, Senado só com o texto original, documento sem a regra atual');
    const clausulas = ['Esta Lei entra em vigor na data de sua publicação.', 'Esta Lei entra em vigor 180 (cento e oitenta) dias após a sua publicação oficial.', 'entrará em vigor no primeiro dia do exercício financeiro seguinte'];
    ok(clausulas.every(c => F.clausulaDeVigencia(c)) && /180 \(cento e oitenta\) dias após/.test(F.clausulaDeVigencia(clausulas[1]).clausula), 'clausulaDeVigencia lê as três formas usuais');
  }

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
  const bom = `Síntese\n\nO texto original da MPV 1357/2026 permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% acima disso, a partir de 12/05/2026 [T1].\n\nO imposto devido caiu de R$ 446,6 milhões para R$ 297,0 milhões por mês [T2].\n\nContexto e processo\n\nA MP foi editada em maio de 2026 e aprovada pela Câmara em setembro [A1].\n\nLei vigente e datas de efeito\n\nVale hoje 20% até US$ 50 [F1]. Efeitos imediatos por ser II [A5].\n\nO que se previu\n\nA EMI declara que não há renúncia [D2].\n\nO que aconteceu\n\nNos 3 meses posteriores, com maio parcial, o II devido total caiu de R$ 446,6 milhões para R$ 297,0 milhões por mês (nível de evidência B) [T2]. O parecer não atribui a diferença à medida.\n\nAvaliação da política\n\nObjetivo de conformidade: não verificável, porque a janela tem 3 meses [O1].\n\nObjetivo de reduzir a tributação: não verificável [O2].\n\nOs dois lados\n\nQuem apoia diz que menos tributo formaliza; a evidência mostra um ponto de participação em três meses [L1]. Quem se opõe aponta a queda de R$ 446,6 para R$ 297,0 milhões por mês [L2].\n\nOpções e consequências\n\nAprovar o PLV consolida a delegação, mantém a queda de arrecadação e atende ao consumidor [P1].\n\nRespostas por lente\n\nTributário\n\nO II é exceção às anterioridades (art. 150, § 1º, da CF) [A5].\n\nConclusão e posicionamento sugerido\n\nSugere-se aprovar o PLV com ressalva quanto à ausência de estimativa [P1]. A posição mudaria se o governo apresentasse a estimativa de renúncia [P1].`;
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

  console.log('== M7 relato de decisão × afirmação própria; G8 nível declarado pelo programa ==');
  {
    const relato = 'Síntese\n\nx [T1].\n\nAvaliação da política\n\nO quadro foi agravado após a declaração de inconstitucionalidade das alíneas d e e do art. 240 pelo Supremo Tribunal Federal, que as declarou formalmente inconstitucionais [T1].\n\nOs dois lados\n\ny [L1].';
    const proprio = relato.replace('O quadro foi agravado após a declaração de inconstitucionalidade das alíneas d e e do art. 240 pelo Supremo Tribunal Federal, que as declarou formalmente inconstitucionais [T1].', 'O art. 5º do substitutivo é inconstitucional por vício de iniciativa [T1].');
    const base = { ficha, dossie: { avisos: [] }, tese: { afirmacoes: [] }, nivel: 'C', temSerie: false, conferencia: { ok: true, semEvidencia: [], numerosSuspeitos: [], idsInexistentes: [] } };
    const gR = G.aplicarGates({ ...base, texto: relato });
    const rR = G.rubricaMaquina({ ...base, texto: gR.texto, gates: gR });
    const gP = G.aplicarGates({ ...base, texto: proprio });
    const rP = G.rubricaMaquina({ ...base, texto: gP.texto, gates: gP });
    ok(rR.itens.find(i => /^M7/.test(i.item)).ok && !rP.itens.find(i => /^M7/.test(i.item)).ok, 'M7 aceita o relato da decisão do STF e reprova a inconstitucionalidade afirmada pelo parecer sem precedente');
    ok(gP.reprovacoes.some(r => r.gate === 'G9' && /merece exame/.test(r.detalhe)) && !gR.reprovacoes.some(r => r.gate === 'G9'), 'G9: inconstitucionalidade afirmada pelo parecer reprova a redação com instrução de reescrita; o relato não');
    const gVoto = G.aplicarGates({ ...base, texto: relato.replace('y [L1].', 'Diante do exposto, recomenda-se a aprovação do substitutivo [T6].') });
    ok(gVoto.reprovacoes.some(r => r.gate === 'G10' && /não recomenda voto/.test(r.detalhe)), 'G10: recomendação de voto do próprio parecer manda refazer a redação');
    const relato2 = relato.replace('y [L1].', 'O projeto busca preencher o vácuo consolidado após o Supremo Tribunal Federal declarar a inconstitucionalidade das alíneas d e e do art. 240 da Lei 8.112/1990 no âmbito da Ação Direta de Inconstitucionalidade nº 492 [T2].');
    const g2 = G.aplicarGates({ ...base, texto: relato2 });
    ok(G.rubricaMaquina({ ...base, texto: g2.texto, gates: g2 }).itens.find(i => /^M7/.test(i.item)).ok, 'M7: "após o STF declarar a inconstitucionalidade… Ação Direta de Inconstitucionalidade nº 492" é relato com precedente (rodada r7)');
    const relatoVoto = relato.replace('y [L1].', 'A manifestação do relator consolidou as adequações acolhidas na comissão e recomendou a aprovação do texto [T6]. O parecer da CASP opina pela aprovação [T6].');
    const votoProprio = relato.replace('y [L1].', 'Diante do exposto, recomenda-se a aprovação do substitutivo [T6].');
    const mk = tx => { const g = G.aplicarGates({ ...base, texto: tx }); return G.rubricaMaquina({ ...base, texto: g.texto, gates: g }).itens.find(i => /^M11/.test(i.item)).ok; };
    ok(mk(relatoVoto) && !mk(votoProprio), 'M11 aceita "o relator recomendou a aprovação" (relato) e reprova "recomenda-se a aprovação" (voto do parecer)');
    ok(/Não há dados oficiais que permitam comparar o antes e o depois/.test(gR.texto) && !/n[íi]vel de evid[êe]ncia/i.test(gR.texto) && gR.notas.some(n => /inserida pelo programa/.test(n)) && rR.itens.find(i => /^M10/.test(i.item)).ok, 'G8: sem a frase em palavras, o programa a insere na abertura da Avaliação, sem rótulo, e a rubrica M10 passa');
    const jaTem = G.aplicarGates({ ...base, texto: relato.replace('Avaliação da política\n\n', 'Avaliação da política\n\nNão há dados oficiais que permitam comparar o antes e o depois da mudança [T1].\n\n') });
    ok(!jaTem.notas.some(n => /inserida pelo programa/.test(n)), 'com a frase em palavras presente, nada é inserido');
    const comRotulo = G.aplicarGates({ ...base, texto: relato.replace('y [L1].', 'A comparação é fraca (nível de evidência C) [L1].') });
    ok(!/n[íi]vel de evid[êe]ncia/i.test(comRotulo.texto) && /sem base para comparar/.test(comRotulo.texto), 'o rótulo "nível de evidência C" some do corpo: vira "sem base para comparar"');
    const gProj = G.aplicarGates({ ...base, texto: relato, emVigor: false });
    ok(/ainda não está em vigor, não há resultados a comparar/.test(gProj.texto), 'proposição ainda não em vigor: a frase diz que não há resultados a comparar, não que "não há série"');
    ok(/Não há dados oficiais/.test(G.fraseDoNivel('C', true)) && /12 meses/.test(G.fraseDoNivel('A')) && /indicam uma direção/.test(G.fraseDoNivel('B')), 'fraseDoNivel: uma frase por nível, em palavras');
  }

  console.log('== tramitação: o que o módulo de Plenário sabe entra no catálogo, na apuração, na rubrica e na 1ª página ==');
  {
    const processo = { cenario: 'Cenário 3 — parecer de plenário (PRLP)', textoEmVotacao: 'PRLP nº 4 de 11/08/2026',
      relator: { nome: 'André Figueiredo', partido: 'PDT', uf: 'CE', data: '22/04/2026' },
      documentos: [{ rotulo: 'PRLP nº 4 de 11/08/2026' }, { rotulo: 'Redação original (inteiro teor)' }, { rotulo: 'Emenda — EMP 1 · 31/08/2026' }],
      emendas: [{ rotulo: 'EMP 1 · 31/08/2026', anexada: true }, { rotulo: 'EMP 2 · 01/09/2026', anexada: true }],
      comissoes: [{ comissao: 'CASP', dataBR: '15/07/2026' }], apensados: ['PL 2000/2026 — Dep. X'] };
    const cat = T.catalogoDeEvidencias({ achados: [], dossie: null, ficha: null, situacao: 'No Plenário.', processo });
    const ids = cat.itens.map(i => i.id);
    ok(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].every(id => ids.includes(id)) && /André Figueiredo \(PDT-CE\)/.test(cat.itens.find(i => i.id === 'S3').texto) && /EMP 1/.test(cat.itens.find(i => i.id === 'S5').texto), 'catálogo: S2 cenário, S3 relator, S4 documentos, S5 emendas, S6 comissões, S7 apensados');
    const pa = P.promptApuracao({ identificacao: 'PL 1893/2026', ementa: 'x', textoAnalisado: 'PRLP 4', processo }, [], E.ESPECIALISTAS);
    ok(/TRAMITAÇÃO/.test(pa) && /André Figueiredo/.test(pa) && /"pergunta": "documento"/.test(pa) && /"pergunta": "emenda"/.test(pa) && /"pergunta": "altera"/.test(pa), 'apuração: bloco TRAMITAÇÃO com o relator, e pede achados "documento", "emenda" e "altera"');
    ok(!/TRAMITAÇÃO/.test(P.promptApuracao({ identificacao: 'x', processo }, [], E.ESPECIALISTAS, { semFicha: true })), 'lente a lente (semFicha): sem repetir o bloco de tramitação');
    const base = { ficha, dossie: { avisos: [] }, tese: { afirmacoes: [] }, nivel: 'C', temSerie: false, conferencia: { ok: true, semEvidencia: [], numerosSuspeitos: [], idsInexistentes: [] }, processo };
    const m12 = tx => { const g = G.aplicarGates({ ...base, texto: tx }); return G.rubricaMaquina({ ...base, texto: g.texto, gates: g }).itens.find(i => /^M12/.test(i.item)); };
    const completo = 'Síntese\n\nx [T1].\n\nContexto e processo\n\nO relator, Deputado André Figueiredo (PDT-CE), apresentou o PRLP 4 [S3]. A EMP 1, do Deputado Cleber Verde, e a emenda nº 2 foram apresentadas em Plenário [S5].\n\nAvaliação da política\n\ny [T1].';
    ok(m12(completo).ok && !m12(completo.replace('André Figueiredo', 'o relator').replace('EMP 1', 'uma emenda')).ok && /Figueiredo/.test(m12(completo.replace('André Figueiredo', 'o relator')).detalhe), 'M12: passa com relator e emendas nomeados; reprova e diz o que falta');
    ok(G.chaveDaEmenda('SBT-A 2 · 10/07/2026').sigla === 'SBT-A' && G.emendaCitada('o substitutivo SBT-A nº 2 foi', G.chaveDaEmenda('SBT-A 2')) && G.emendaCitada('acolheu a Emenda nº 2 do', G.chaveDaEmenda('EMP 2')), 'chaveDaEmenda/emendaCitada: sigla com número, "Emenda nº 2" vale para EMP 2');
    const alt = F.tabelaAlteracoes({ achados: [
      { lente: 'X', pergunta: 'altera', dispositivo: 'art. 92 da Lei 8.112/1990', achado: 'Amplia a licença para o mandato classista.', trecho: 't1' },
      { lente: 'X', pergunta: 'altera', dispositivo: 'art. 240 da Lei nº 8.112, de 1990', achado: 'Restabelece a negociação coletiva.', trecho: 't2' },
      { lente: 'X', pergunta: 'altera', dispositivo: 'arts. 1º a 19 (lei nova)', achado: 'Institui o regime de negociação.', trecho: 't3' }],
      leiVigente: [{ norma: 'Lei nº 8.112, de 11 de dezembro de 1990', origem: 'camara', compilado: true, trechos: [{ artigo: 'Art. 92', texto: 'Art. 92. É assegurado ao servidor o direito à licença sem remuneração para o desempenho de mandato' }, { artigo: 'Art. 240', texto: 'Art. 240. Ao servidor público civil é assegurado' }] }] });
    ok(alt.length === 3 && /licença sem remuneração/.test(alt[0].vigente) && /Câmara/.test(alt[0].fonte) && /Art\. 240/.test(alt[1].vigente) && alt[2].vigente === null && alt[2].novo, 'tabelaAlteracoes: arts. 92 e 240 casam com o texto lido; "lei nova" fica sem correspondente');
    const html = F.alteracoesParaHtml(alt);
    ok(/O que vale hoje/.test(html) && /texto novo/.test(html), 'alteracoesParaHtml imprime as três colunas');
  }

  console.log('== proposição ainda não em vigor: vereditos "o texto prevê meios"; experiência comparada (W) ==');
  {
    const cat = T.catalogoDeEvidencias({ achados: [{ lente: 'X', pergunta: 'altera', achado: 'Institui rodada anual de negociação.', trecho: 't', dispositivo: 'art. 5º' }], situacao: 'x',
      comparada: [{ lugar: 'Portugal', quando: '2014', medida: 'negociação coletiva na administração pública (LTFP)', o_que_se_mediu: 'acordos firmados 2015-2020', resultado: '35 acordos coletivos', fonte_nome: 'OCDE, Government at a Glance', fonte_url: 'https://www.oecd.org/x' }] });
    ok(cat.itens.some(i => i.id === 'W1' && i.tipo === 'externa' && /não conferida pelo programa/.test(i.texto) && i.numeros.includes(35)), 'W1 entra no catálogo como externa, com a fonte e os números');
    const tese = { afirmacoes: [
      { id: 'T1', secao: 'comparada', tipo: 'fato', texto: 'Portugal firmou 35 acordos coletivos entre 2015 e 2020.', evidencias: ['W1'] },
      { id: 'T2', secao: 'sintese', tipo: 'fato', texto: 'Portugal firmou 35 acordos coletivos.', evidencias: ['W1'] } ],
      objetivos: [{ id: 'O1', objetivo: 'Regulamentar a Convenção 151 da OIT', veredito: 'não verificável', justificativa: 'x', evidencias: ['A1'] }, { id: 'O2', objetivo: 'Reduzir greves', veredito: 'o texto prevê meios em parte', justificativa: 'y', evidencias: ['A1'] }], lados: {}, opcoes: [], fatores_concorrentes: [] };
    const v = T.validarTese(JSON.parse(JSON.stringify(tese)), cat, { nivel: 'C', emVigor: false });
    ok(v.tese.afirmacoes.some(a => a.id === 'T1') && v.removidas.some(r => r.id === 'T2' && /fonte buscada na internet/.test(r.motivo)), 'fato apoiado só em W vale na seção "comparada" e cai fora dela');
    ok(v.tese.objetivos.find(o => o.id === 'O2').veredito === 'o texto prevê meios em parte' && v.tese.objetivos.find(o => o.id === 'O1').veredito === 'não verificável', 'projeto: vereditos "o texto prevê meios…" são aceitos como estão');
    const vEmVigor = T.validarTese(JSON.parse(JSON.stringify(tese)), cat, { nivel: 'C', emVigor: true });
    ok(vEmVigor.tese.objetivos.find(o => o.id === 'O2').veredito === 'não verificável', 'em vigor sem série: o veredito de projeto é rebaixado a "não verificável"');
    const pt = T.promptTese({ identificacao: 'PL 1893/2026', ficha, catalogo: cat, nivel: 'C', emVigor: false, temComparada: true });
    ok(/AINDA NÃO ESTÁ EM VIGOR/.test(pt) && /"o texto prevê meios"/.test(pt) && /regulamentar \/ instituir \/ criar X/.test(pt) && /EXPERIÊNCIA COMPARADA \(W\)/.test(pt), 'prompt da tese: regras de projeto e de experiência comparada');
    const pr = T.promptRedacao({ identificacao: 'PL 1893/2026', ficha, tese: v.tese, catalogo: cat, nivel: 'C', temSerie: false, emVigor: false, temComparada: true });
    ok(/NUNCA escreva "nível de evidência"/.test(pr) && /ainda não está em vigor, não há resultados a comparar/.test(pr) && /Experiência de outros países e entes/.test(pr) && /NÃO escreva "não verificável" para ele/.test(pr), 'prompt da redação: solidez em palavras, seção comparada, avaliação de projeto');
    ok(/fonte_url/.test(P.promptComparada({ identificacao: 'x', ementa: 'y', regra: 'z' })) && T.TITULOS.comparada === 'Experiência de outros países e entes', 'promptComparada pede fonte com URL; a seção existe nos títulos');
  }

  console.log('== atores, implementação, aprimoramentos, viabilidade e conclusão ==');
  {
    const cat = T.catalogoDeEvidencias({
      achados: [{ lente: 'X', pergunta: 'posicao', achado: 'A CNTE apoia a matéria.', trecho: 't1' }, { lente: 'X', pergunta: 'execucao', achado: 'A execução cabe ao Ministério da Gestão, em 90 dias.', trecho: 't2' }],
      situacao: 'Pronta para pauta no Plenário.',
      processo: { cenario: 'Cenário 3 — parecer de plenário (PRLP)', relator: { nome: 'André Figueiredo', partido: 'PDT', uf: 'CE' }, emendas: [{ rotulo: 'EMP 1' }] },
      jurisprudencia: [{ tribunal: 'STF', processo: 'ADI 492, Pleno', relator: 'Min. Carlos Velloso', data: '12/11/1992', norma_examinada: 'Lei federal 8.112/1990, art. 240, d e e', decisao: 'declarou inconstitucionais as alíneas', relacao: 'é o vácuo que a proposição preenche', fonte_nome: 'STF', fonte_url: 'https://portal.stf.jus.br/x' }],
      infralegal: [{ norma: 'Decreto 10.088/2019', orgao: 'Presidência', data: '2019', o_que_disciplina: 'promulga a Convenção 151 da OIT', relacao: 'a proposição dá status legal ao que hoje é decreto', fonte_nome: 'Planalto', fonte_url: 'https://www.planalto.gov.br/y' }],
      posicoes: [{ ator: 'Confederação Nacional dos Municípios', tipo: 'setor regulado', posicao: 'contrário', data: '2026', o_que_defende: 'alega impacto fiscal nos municípios', fonte_nome: 'CNM', fonte_url: 'https://cnm.org.br/z' }] });
    const ids = cat.itens.map(i => i.id);
    ok(ids.includes('J1') && ids.includes('N1') && ids.includes('Q1') && cat.itens.find(i => i.id === 'J1').externa === 'J' && /ADI 492/.test(cat.itens.find(i => i.id === 'J1').texto), 'catálogo: J (jurisprudência), N (infralegal) e Q (posições), cada um com fonte');
    const bruta = {
      afirmacoes: [{ id: 'T1', secao: 'jurisprudencia', tipo: 'fato', texto: 'O STF declarou inconstitucionais as alíneas d e e na ADI 492.', evidencias: ['J1'] }],
      objetivos: [], lados: {}, fatores_concorrentes: [],
      opcoes: [{ id: 'P1', opcao: 'Aprovar com as emendas', fiscal: 'a', juridica: 'b', politica: 'c', evidencias: ['A1'] }],
      atores: [
        { id: 'AT1', ator: 'CNM', tipo: 'setor regulado', posicao: 'contrário', o_que_defende: 'impacto fiscal', evidencias: ['Q1'] },
        { id: 'AT2', ator: 'Entidade inventada', tipo: 'sociedade civil', posicao: 'favorável', o_que_defende: 'apoia', evidencias: [] },
        { id: 'AT3', ator: 'CNTE', tipo: 'entidade de classe', posicao: 'entusiasmada', o_que_defende: 'apoia a matéria', evidencias: ['A1'] }],
      implementacao: [{ id: 'I1', aspecto: 'órgão executor', texto: 'A execução cabe ao Ministério da Gestão, em 90 dias.', evidencias: ['A2'] }],
      aprimoramentos: [
        { id: 'R1', dispositivo: 'art. 5º', tipo: 'redacional', problema: 'prazo sem termo inicial', sugestao: 'fixar o termo na publicação', evidencias: ['A2'] },
        { id: 'R2', dispositivo: '', tipo: 'mérito', problema: 'não gosto', sugestao: '', evidencias: ['A1'] }],
      viabilidade: [
        { id: 'V1', sinal: 'Matéria pronta para pauta no Plenário.', peso: 'favorece', evidencias: ['S1'] },
        { id: 'V2', sinal: 'A base do governo já garantiu apoio suficiente para aprovar.', peso: 'favorece', evidencias: ['J1'] }],
      conclusao: { id: 'CC', posicao: 'Aprovar com as emendas de Plenário', porque: 'o vácuo normativo é real e o texto o preenche', o_que_mudaria: 'se a estimativa de impacto fiscal for apresentada e contrariar o parecer', evidencias: ['P1', 'A1'] },
    };
    const v = T.validarTese(JSON.parse(JSON.stringify(bruta)), cat, { nivel: 'C', emVigor: false });
    ok(v.tese.atores.length === 2 && v.removidas.some(r => r.id === 'AT2') && v.tese.atores.find(a => a.id === 'AT3').posicao === 'não declarada', 'atores: sem fonte é removido; posição fora da lista vira "não declarada"');
    ok(v.tese.aprimoramentos.length === 1 && v.removidas.some(r => r.id === 'R2' && /sem dispositivo ou sem sugestão/.test(r.motivo)), 'aprimoramento sem dispositivo ou sem sugestão acionável é removido');
    ok(v.tese.viabilidade.length === 1 && v.removidas.some(r => r.id === 'V2' && /sem fato da tramitação/.test(r.motivo)), 'viabilidade: só sinal apoiado em fato da tramitação (S) ou do documento (A) — aposta de votos cai');
    ok(v.tese.conclusao && v.tese.conclusao.opcoes.join() === 'P1' && !v.tese.conclusao.evidencias.includes('P1'), 'conclusão: a opção citada é separada das evidências do catálogo');
    const semMudaria = T.validarTese({ ...JSON.parse(JSON.stringify(bruta)), conclusao: { id: 'CC', posicao: 'Aprovar', porque: 'x', evidencias: ['P1'] } }, cat, { nivel: 'C', emVigor: false });
    ok(!semMudaria.tese.conclusao && semMudaria.removidas.some(r => r.id === 'CC' && /o que mudaria/.test(r.motivo)), 'conclusão sem "o que mudaria a posição" é removida');
    const semOpcao = T.validarTese({ ...JSON.parse(JSON.stringify(bruta)), conclusao: { id: 'CC', posicao: 'Aprovar', porque: 'x', o_que_mudaria: 'y', evidencias: ['A1'] } }, cat, { nivel: 'C', emVigor: false });
    ok(!semOpcao.tese.conclusao && semOpcao.removidas.some(r => /não se liga a nenhuma das opções/.test(r.motivo)), 'conclusão que não se liga a nenhuma opção é removida');
    // seções ativas seguem o que a tese alimentou
    const ativas = T.secoesAtivas(v.tese, { temSerie: false });
    ok(ativas.includes('jurisprudencia') && ativas.includes('atores') && ativas.includes('redacional') && ativas.includes('viabilidade') && ativas.includes('conclusao') && !ativas.includes('aconteceu') && !ativas.includes('comparada'), 'secoesAtivas: entram as que a tese alimentou; sem série e sem comparada, ficam fora');
    // contraditório: conclusão refutada perde a posição, ator só cai com erro concreto
    const c2 = T.aplicarContraditorio(JSON.parse(JSON.stringify(v.tese)), [
      { id: 'CC', refutada: true, motivo: 'a posição ignora o impacto declarado pela CNM' },
      { id: 'AT1', refutada: true, motivo: 'faltou dizer a data' },
      { id: 'R1', refutada: true, motivo: 'a redação sugerida repete o que a lei já diz' }], cat);
    ok(c2.tese.conclusao && c2.tese.conclusao.posicao === null && /ignora o impacto/.test(c2.tese.conclusao.contestada), 'conclusão refutada perde a posição e guarda o motivo');
    ok(c2.tese.atores.length === 2 && c2.ressalvas.some(r => r.id === 'AT1'), 'ator refutado sem erro concreto vira ressalva, não sai');
    ok(!c2.tese.aprimoramentos.length && c2.refutadas.some(r => r.id === 'R1'), 'aprimoramento refutado sai (sugestão errada é pior que sugestão a menos)');
    // prompts
    const pt = T.promptTese({ identificacao: 'PL 1893/2026', ficha, catalogo: cat, nivel: 'C', emVigor: false });
    ok(/"atores"/.test(pt) && /"implementacao"/.test(pt) && /"aprimoramentos"/.test(pt) && /"viabilidade"/.test(pt) && /"conclusao"/.test(pt) && /JURISPRUDÊNCIA \(J\)/.test(pt) && /NORMAS INFRALEGAIS \(N\)/.test(pt), 'prompt da tese pede os cinco blocos novos e cita J e N quando existem');
    ok(/Recomendação de voto SÓ na "conclusao"/.test(pt) && /SÓ sinais objetivos/.test(pt), 'prompt: voto só na conclusão; viabilidade só com sinal objetivo');
    const pr = T.promptRedacao({ identificacao: 'x', ficha, tese: v.tese, catalogo: cat, nivel: 'C', temSerie: false, emVigor: false });
    ok(/Quem se posicionou e como/.test(pr) && /Implementação e custo de conformidade/.test(pr) && /Aprimoramentos e sugestões de emenda/.test(pr) && /Prioridade e viabilidade/.test(pr) && /Conclusão e posicionamento sugerido/.test(pr) && /ÚNICA seção em que o\s+parecer recomenda/.test(pr), 'prompt da redação lista as seções novas e diz que só a conclusão recomenda');
    const pe = P.promptExterno({ identificacao: 'x', ementa: 'y', regra: 'z', normas: 'Lei 8.112/1990' });
    ok(/"jurisprudencia"/.test(pe) && /"infralegal"/.test(pe) && /"posicoes"/.test(pe) && /leis estaduais e\s+municipais análogas/.test(pe) && /Ouça OS DOIS lados/.test(pe), 'promptExterno pede jurisprudência (inclusive de leis estaduais), normas infralegais e os dois lados');
    // gates: voto permitido na conclusão, proibido fora
    const baseG = { ficha, dossie: { avisos: [] }, tese: v.tese, nivel: 'C', temSerie: false, conferencia: { ok: true, semEvidencia: [], numerosSuspeitos: [], idsInexistentes: [] } };
    const corpo = 'Síntese\n\nx [T1].\n\nAvaliação da política\n\nNão há dados oficiais que permitam comparar o antes e o depois da mudança [T1].\n\nConclusão e posicionamento sugerido\n\nSugere-se aprovar o texto com as emendas de Plenário [CC]. A posição mudaria se a estimativa de impacto fiscal for apresentada [CC].';
    const gC = G.aplicarGates({ ...baseG, texto: corpo });
    const rC = G.rubricaMaquina({ ...baseG, texto: gC.texto, gates: gC });
    ok(!gC.reprovacoes.some(r => r.gate === 'G10') && rC.itens.find(i => /^M11/.test(i.item)).ok, 'recomendação DENTRO da conclusão é permitida (M11 e G10 não reprovam)');
    const foraDaConclusao = corpo.replace('x [T1].', 'Recomenda-se a aprovação do texto [T1].');
    const gF = G.aplicarGates({ ...baseG, texto: foraDaConclusao });
    ok(gF.reprovacoes.some(r => r.gate === 'G10') && !G.rubricaMaquina({ ...baseG, texto: gF.texto, gates: gF }).itens.find(i => /^M11/.test(i.item)).ok, 'a mesma recomendação na Síntese reprova');
    ok(rC.itens.find(i => /^M13/.test(i.item)).ok && !G.rubricaMaquina({ ...baseG, texto: corpo.replace('A posição mudaria se a estimativa de impacto fiscal for apresentada [CC].', ''), gates: gC }).itens.find(i => /^M13/.test(i.item)).ok, 'M13 exige a conclusão escrita com o que mudaria a posição');
    // impressão
    const pImp = { texto: gC.texto, textoLimpo: T.limparMarcadores(gC.texto), tese: v.tese, ficha, nivel: 'C', emVigor: false, gates: gC, rubrica: rC, jurisprudencia: [{ tribunal: 'STF', processo: 'ADI 492', norma_examinada: 'n', decisao: 'd', fonte_nome: 'STF', fonte_url: 'https://portal.stf.jus.br/x' }], infralegal: [], posicoes: [], comparada: [], conferencia: baseG.conferencia, validacao: { removidas: [] }, contraditorio: { refutadas: [], contestadas: [], ressalvas: [] } };
    const htmlP = H.htmlParecer(pImp, { materia: 'PL 1893/2026' });
    ok(/Posicionamento sugerido/.test(htmlP) && /Aprovar com as emendas de Plenário/.test(htmlP) && /juízo da assessoria/.test(htmlP) && /A decisão é da Liderança/.test(htmlP), 'a 1ª página traz "Posicionamento sugerido" com a posição e o aviso de que é juízo da assessoria');
    ok(/Fontes buscadas na internet/.test(htmlP) && /ADI 492/.test(htmlP) && /portal\.stf\.jus\.br/.test(htmlP), 'o anexo lista as fontes buscadas na internet, com endereço');
    const semPos = H.htmlParecer({ ...pImp, tese: { ...v.tese, conclusao: { ...v.tese.conclusao, posicao: null, contestada: 'a posição não se sustentou' } } }, { materia: 'x' });
    ok(/não sustentou posição/.test(semPos), 'conclusão contestada: o PDF diz que a assessoria não sustentou posição e por quê');
  }

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
      opcoes: [{ id: 'P1', opcao: 'Aprovar o texto', fiscal: 'renúncia não estimada', juridica: 'delegação regular', politica: 'alinha ao governo', evidencias: ['F1'] }, { id: 'P2', opcao: 'Condicionar à estimativa', fiscal: 'a', juridica: 'b', politica: 'c', evidencias: ['F1'] }], fatores_concorrentes: [],
      conclusao: { id: 'CC', posicao: 'Aprovar o texto condicionado à apresentação da estimativa de renúncia', porque: 'a delegação é regular, mas a renúncia não foi estimada.', o_que_mudaria: 'a apresentação da estimativa antes da votação', evidencias: ['P2', 'F1'] } }),
    contraditorio: JSON.stringify([{ id: 'T1', refutada: false }, { id: 'T2', refutada: false }, { id: 'T3', refutada: false }, { id: 'O1', refutada: true, motivo: 'objetivo declarado não é resultado' }, { id: 'L1', refutada: false }, { id: 'L2', refutada: false }, { id: 'P1', refutada: false }, { id: 'P2', refutada: false }, { id: 'CC', refutada: false }]),
    redacao: 'Síntese\n\nO texto original da MPV 1357/2026 permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% até US$ 3.000, a partir de 12/05/2026 [T1].\n\nSem série oficial, o efeito não é verificável (nível de evidência C) [T2].\n\nContexto e processo\n\nA EMI declara que não há renúncia [T3].\n\nLei vigente e datas de efeito\n\nVale 20% até US$ 50 [F1].\n\nO que se previu\n\nA EMI nega renúncia [D1].\n\nAvaliação da política\n\nObjetivo de conformidade: não verificável [O1].\n\nOs dois lados\n\nQuem apoia diz que simplifica [L1]. Quem se opõe aponta renúncia sem estimativa [L2].\n\nOpções e consequências\n\nAprovar consolida a delegação sem estimativa [P1].\n\nCondicionar à estimativa atende à LRF [P2].\n\nRespostas por lente\n\nTributário\n\nO II é exceção às anterioridades [A5]. Não identifiquei questão quanto à espécie tributária.\n\nConclusão e posicionamento sugerido\n\nSugere-se aprovar o texto condicionado à apresentação da estimativa de renúncia [CC]. A posição mudaria se o governo apresentasse a estimativa antes da votação [CC].',
  };
  const io = {
    semWeb: true,
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
    ok(p.rubrica.aprovado && p.aprovado, 'rubrica aprova: ' + p.rubrica.pendentes.map(x => `${x.item} — ${x.detalhe || ''}`).join('; ') + ' | conf: ' + JSON.stringify(p.conferencia).slice(0, 400));
    ok(p.chamadas.length === 5 && p.chamadas.some(c => c.nome === 'historico') && !p.refeita, 'cinco chamadas (com a de histórico, porque a apuração trouxe menos de três fatos), sem redação refeita');
    ok(T.validarTese({ afirmacoes: [{ id: 'T1', secao: 'opcoes', tipo: 'fato', texto: 'Rejeitada, a MP perde eficácia desde a edição, nos termos do art. 62, § 3º, da CF.', evidencias: ['F1'] }] }, T.catalogoDeEvidencias({ achados: achadosX, ficha }), { nivel: 'C' }).tese.afirmacoes.length === 1, '"art. 62" numa afirmação é referência normativa, não cifra fora da base');
    ok(p.gates.faixas.length === 0 && p.nivel === 'C', 'sem faixa de incompletude (regra veio do documento) e nível C');
    const html = H.htmlParecer(p, { materia: 'MPV 1357/2026', css: '' });
    const corpoHtml = html.slice(0, html.indexOf('<h3 class="item-h">Anexo técnico'));
    ok(/Ficha do objeto/.test(html) && /class="ficha"/.test(html) && !/\[T1\]|<sup class="ev">/.test(corpoHtml) && /id="l_Síntese"|id="l_S.ntese"/.test(html), 'HTML traz ficha e seções com âncora, e o corpo sai SEM identificadores de evidência');
    ok(/Limites deste parecer/.test(corpoHtml) && /juízo da assessoria/.test(corpoHtml) && /Anexo técnico — conferência/.test(html) && /M1 Ficha do objeto/.test(html.slice(html.indexOf('<h3 class="item-h">Anexo técnico'))), '"Limites deste parecer" em palavras no corpo; rubrica e tese com identificadores só no anexo técnico');
    ok(/<td>T1<\/td>/.test(html) && /Tese aprovada, com evidências/.test(html), 'a rastreabilidade (T1 → evidências) está na tabela do anexo técnico');
    // "Nível de evidência C" era jargão no PDF (crítica do usuário, duas vezes): sai do corpo; a 1ª página explica em palavras.
    ok(/Não há dados oficiais que permitam comparar o antes e o depois/.test(corpoHtml), 'a solidez da comparação é explicada em palavras na primeira página');
    ok(!/n[íi]vel de evid[êe]ncia/i.test(corpoHtml), 'o corpo do parecer não usa a expressão "nível de evidência"');
  }
  // modelo que não enuncia o objeto: a redação é refeita uma vez e, persistindo, o parecer sai reprovado
  const respostasRuins = { ...respostas, redacao: respostas.redacao.replace('permite reduzir de 20% para zero a alíquota até US$ 50 e de 60% para 30% até US$ 3.000, a partir de 12/05/2026', 'delega ao Ministro a alteração das alíquotas') };
  const io2 = { ...io, chamarModelo: async ({ prompt }) => { const nome = /etapa de APURAÇÃO/.test(prompt) ? 'apuracao' : /apura o HISTÓRICO/.test(prompt) ? 'historico' : /formula a TESE/.test(prompt) ? 'tese' : /revisor ADVERSARIAL/.test(prompt) ? 'contraditorio' : 'redacao'; return { text: respostasRuins[nome] || '[]', truncated: false }; } };
  // sem histórico na apuração geral, o pipeline faz UMA chamada só para ele
  const io3 = { ...io, chamarModelo: async ({ prompt }) => { if (/etapa de APURAÇÃO/.test(prompt)) return { text: JSON.stringify(achadosX.filter(a => a.pergunta !== 'historico')), truncated: false }; if (/apura o HISTÓRICO/.test(prompt)) return { text: JSON.stringify([{ lente: 'X', pergunta: 'historico', achado: 'A MP foi editada em 12 de maio de 2026.', trecho: 'entra em vigor na data de sua publicação. Brasília, 12 de maio de 2026' }]), truncated: false }; return io.chamarModelo({ prompt }); } };
  // sem regra_antes na apuração geral, há uma chamada só para a ficha do objeto
  let promptFichaVisto = '';
  const io5 = { ...io, chamarModelo: async ({ prompt }) => { if (/etapa de APURAÇÃO/.test(prompt)) return { text: JSON.stringify(achadosX.filter(a => a.pergunta !== 'regra_antes')), truncated: false }; if (/FICHA DO OBJETO de um parecer/.test(prompt)) { promptFichaVisto = prompt; return { text: JSON.stringify(achadosX.filter(a => ['regra_antes', 'dispositivo'].includes(a.pergunta))), truncated: false }; } return io.chamarModelo({ prompt }); } };
  const p5 = await PP.gerarParecer(ctx, io5);
  const io6 = { ...io, chamarModelo: async ({ prompt }) => { if (/etapa de APURAÇÃO/.test(prompt)) { if (!/TRAMITAÇÃO/.test(prompt) || !/Rodrigo Cunha/.test(prompt)) throw new Error('apuração sem o bloco de tramitação'); return { text: JSON.stringify(achadosX.concat([{ lente: 'X', pergunta: 'altera', dispositivo: 'art. 1º do Decreto-Lei 1.804/1980', achado: 'Permite reduzir a alíquota a zero até US$ 50.', trecho: 'inclusive para reduzi-las a zero na faixa de tributação de até US$ 50,00' }])), truncated: false }; } return io.chamarModelo({ prompt }); } };
  const p6 = await PP.gerarParecer({ ...ctx, processo: { cenario: 'Cenário 8a — MPV (texto original do Executivo)', textoEmVotacao: 'Texto original', relator: { nome: 'Rodrigo Cunha', partido: 'PODE', uf: 'AL' }, documentos: [{ rotulo: 'Texto original da MPV 1357/2026' }], emendas: [], comissoes: [] } }, io6);
  ok(!p6.erro && p6.processo && p6.processo.relator.nome === 'Rodrigo Cunha' && Array.isArray(p6.alteracoes) && p6.alteracoes.length === 1 && p6.rubrica.itens.some(i => /^M12/.test(i.item)), 'pipeline: tramitação vai à apuração, volta no parecer (processo, alteracoes) e a rubrica avalia M12');
  ok(!p5.erro && p5.chamadas.some(c => c.nome === 'ficha') && p5.ficha.regraVigente && /NÃO HAVENDO regra/.test(promptFichaVisto) && p5.apuracao.aprovados === p.apuracao.aprovados, 'sem regra_antes: chamada dedicada à ficha, achado entra uma vez só (dispositivo já existente não duplica)');
  // com busca na web: a chamada "comparada" recebe web:true e os itens com fonte entram (W) e vão ao parecer
  const io7 = { ...io, semWeb: false, chamarModelo: async ({ prompt, web }) => { if (/EXPERIÊNCIA COMPARADA para um parecer/.test(prompt)) { if (!web) throw new Error('comparada sem web'); return { text: JSON.stringify([{ lugar: 'Portugal', quando: '2014', medida: 'm', o_que_se_mediu: 'x', resultado: 'r', fonte_nome: 'OCDE', fonte_url: 'https://www.oecd.org/x' }, { lugar: 'sem fonte', medida: 'm', resultado: 'r' }]), truncated: false }; } return io.chamarModelo({ prompt }); } };
  const p7 = await PP.gerarParecer(ctx, io7);
  ok(!p7.erro && p7.chamadas.some(c => c.nome === 'comparada' && c.web) && p7.comparada.length === 1 && p7.comparada[0].lugar === 'Portugal', 'pipeline: busca comparada com web:true; item sem fonte cai; o parecer devolve a lista');
  const htmlC = H.htmlParecer(p7, { materia: 'x' });
  ok(/Fontes buscadas na internet/.test(htmlC) && /oecd\.org/.test(htmlC) && /NÃO conferidas pelo programa/.test(htmlC) && !/Parecer produzido com apoio/.test(htmlC), 'impresso: fontes externas no anexo e aviso nos limites; sem o carimbo do modelo');
  const p3 = await PP.gerarParecer(ctx, io3);
  ok(!p3.erro && p3.chamadas.some(c => c.nome === 'historico') && p3.chamadas.length === 5 && p3.catalogo.itens > p.catalogo.itens - 1, 'sem histórico na apuração geral, há uma chamada dedicada e o achado entra');
  // apuração geral truncada (o raciocínio conta no teto de saída): uma chamada por lente, ficha só na primeira
  const promptsLente = [];
  const io4 = { ...io, chamarModelo: async ({ prompt }) => {
    if (/etapa de APURAÇÃO/.test(prompt)) {
      const nLentes = (prompt.match(/### LENTE /g) || []).length;
      if (nLentes > 1) return { text: '[{"lente": "X", "pergunta": "dispositivo", "achado": "cortado', truncated: true };
      promptsLente.push(prompt);
      return { text: JSON.stringify(promptsLente.length === 1 ? achadosX.map(a => ({ ...a, semQuestao: false })) : [{ lente: '2', pergunta: '2.1', semQuestao: true }]), truncated: false };
    }
    return io.chamarModelo({ prompt }); } };
  const p4 = await PP.gerarParecer(ctx, io4);
  const nomesLente = p4.chamadas ? p4.chamadas.filter(c => /^apuracao-lente-/.test(c.nome)) : [];
  ok(!p4.erro && nomesLente.length >= 2 && p4.chamadas[0].truncada && p4.ficha.completa, 'apuração truncada: repete lente a lente e o parecer sai inteiro: ' + (p4.erro || nomesLente.map(c => c.nome).join(', ')));
  ok(/ALÉM DAS LENTES/.test(promptsLente[0]) && promptsLente.slice(1).every(pr => !/ALÉM DAS LENTES/.test(pr)), 'a ficha do objeto é pedida só na primeira lente');
  // redação que decreta inconstitucionalidade: refeita uma vez com a instrução do G9; a segunda passa
  let vezes = 0;
  const ehRedacao = pr => !/etapa de APURAÇÃO|apura o HISTÓRICO|FICHA DO OBJETO de um parecer|formula a TESE|revisor ADVERSARIAL|EXPERIÊNCIA COMPARADA/.test(pr);
  const io8 = { ...io, chamarModelo: async ({ prompt }) => { if (ehRedacao(prompt)) { vezes++; if (vezes === 1) return { text: respostas.redacao.replace('Aprovar consolida a delegação sem estimativa [P1].', 'A delegação é inconstitucional por vício de iniciativa [P1].'), truncated: false }; if (!/G9/.test(prompt) || !/merece exame/.test(prompt)) throw new Error('segunda redação sem a instrução do G9'); } return io.chamarModelo({ prompt }); } };
  const p8 = await PP.gerarParecer(ctx, io8);
  ok(!p8.erro && p8.refeita && p8.aprovado && vezes === 2, `G9 na primeira redação: refeita com a instrução, e a segunda é aprovada (${p8.erro || `refeita=${p8.refeita} aprovado=${p8.aprovado} vezes=${vezes} pendentes=${(p8.rubrica?.pendentes || []).map(x => x.item.slice(0, 4)).join(',')} reprov=${(p8.gates?.reprovacoes || []).map(r => r.gate).join(',')}`})`);
  const p2 = await PP.gerarParecer(ctx, io2);
  ok(!p2.erro && p2.refeita && p2.chamadas.length === 6 && !p2.aprovado && p2.gates.reprovacoes.some(r => r.gate === 'G2'), 'síntese sem o objeto: redação refeita e, persistindo, parecer reprovado no G2');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
