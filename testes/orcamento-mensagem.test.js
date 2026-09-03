// Tabelas da Mensagem Presidencial (mensagem.js) — "o que subiu e o que caiu".
//
// A crítica que originou este arquivo: o módulo dizia ONDE o processo está e
// não o que muda para o gabinete. As notas LID.PODE que funcionam trazem a
// variação por rubrica — "Minas e Energia +401%", "Saúde −12,13%" —, e é isso
// que um deputado leva à tribuna.
//
// A OBJEÇÃO CERTA a extrair número de PDF com regex é que ela pode "não pegar"
// e ninguém percebe. A resposta aqui não é confiar na regex: é fazer a leitura
// se conferir contra o TOTAL IMPRESSO no próprio documento. Se a soma das
// linhas lidas não fecha com o total, o extrator declara que está incompleta e
// diz de quanto é a diferença. Número publicável é número que fechou.
//
// A fixture traz as páginas 34, 71, 114-116, 128 e 137 do PLN 24/2026 (PLOA
// 2027) — 27 MB e 3.235 páginas no original —, extraídas com o mesmo
// agrupamento por linha que o módulo usa no navegador.
//
// Uso: node testes/orcamento-mensagem.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const M = require(path.join(RAIZ, 'mensagem.js'));
const TXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'mensagem-ploa2027-paginas.txt'), 'utf8');

/** Recorta uma página da fixture. */
function pagina(n) {
  const partes = TXT.split(/\[\[PAGINA (\d+)\]\]/);
  const mapa = {};
  for (let i = 1; i < partes.length; i += 2) mapa[partes[i]] = partes[i + 1];
  return mapa[String(n)] || '';
}

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== números em pt-BR ==');
  {
    ok(M.numeroBR('1.697,0') === 1697, '"1.697,0" → 1697');
    ok(M.numeroBR('24.402,4') === 24402.4, '"24.402,4" → 24402.4');
    ok(M.numeroBR('2.658.836,4') === 2658836.4, 'milhões com dois separadores');
    ok(M.numeroBR('9,8') === 9.8, 'valor pequeno');
    ok(M.numeroBR('abc') === null && M.numeroBR('') === null, 'texto não vira número');
    // "2027" é ano, não valor: sem casa decimal e sem separador, não deve ser
    // confundido com dinheiro em nenhuma tabela.
    ok(M.numeroBR('2027') === 2027, '"2027" é número válido — cabe a quem chama distinguir ano de valor');
    ok(M.formatarBR(1241945) === '1.241.945,0', `formatação de volta: ${M.formatarBR(1241945)}`);
  }

  console.log('\n== tabela POR ÓRGÃO, com autoconferência (p.71) ==');
  {
    const t = M.tabelaPorOrgao(pagina(71));
    ok(t.linhas.length === 11, `${t.linhas.length} órgãos lidos`);
    ok(t.total === 24402.4, `total impresso no documento: ${t.total}`);
    // A GUARDA CENTRAL: a soma das linhas tem de fechar com o total impresso.
    ok(t.confere, `a soma (${t.soma.toFixed(1)}) fecha com o total (${t.total}) — leitura completa`);
    ok(t.motivo === null, 'e não há motivo de ressalva a exibir');

    const educacao = t.linhas.find(l => /Educação/.test(l.orgao));
    ok(educacao && educacao.codigo === '26000' && educacao.valor === 1697,
       `código e valor por órgão: ${educacao?.codigo} ${educacao?.orgao} = ${educacao?.valor}`);
    ok(t.linhas.every(l => /^\d{5}$/.test(l.codigo)), 'todo órgão vem com o código de cinco dígitos');
    ok(!t.linhas.some(l => /^Total/i.test(l.orgao)), 'a linha de total não entra como se fosse um órgão');

    // O QUE ACONTECE QUANDO A LEITURA FALHA: uma linha suprimida tem de virar
    // ressalva, nunca tabela silenciosamente menor.
    const mutilada = pagina(71).split('\n').filter(l => !/39000/.test(l)).join('\n');
    const t2 = M.tabelaPorOrgao(mutilada);
    ok(t2.linhas.length === 10 && !t2.confere,
       'perdendo o Ministério dos Transportes, a conferência ACUSA');
    ok(/não fecha com o total impresso/.test(t2.motivo || ''),
       `e explica: "${(t2.motivo || '').slice(0, 90)}…"`);
    ok(/11\.016,6|11016/.test(M.formatarBR(Math.abs(t2.diferenca))) || Math.abs(t2.diferenca) > 11000,
       `a diferença aponta o tamanho do que faltou (${M.formatarBR(t2.diferenca)})`);

    // Tabela sem total impresso: também não se declara completa.
    const semTotal = pagina(71).split('\n').filter(l => !/^Total/i.test(l.trim())).join('\n');
    const t3 = M.tabelaPorOrgao(semTotal);
    ok(t3.linhas.length === 11 && !t3.confere && /não traz total impresso/.test(t3.motivo),
       'sem total no documento, a leitura não se declara conferida');
  }

  console.log('\n== tabela COMPARATIVA entre exercícios (p.116) ==');
  {
    const t = M.tabelaComparativa(pagina(116));
    ok(t.exercicios.length === 4, `4 colunas: ${t.exercicios.join(' | ')}`);
    ok(t.exercicios[1] === 'LOA 2026' && t.exercicios[3] === 'PLOA 2027',
       'as colunas são nomeadas pelo próprio documento');
    ok(t.linhas.length === 8, `${t.linhas.length} rubricas lidas`);

    // O rótulo QUEBRA em várias linhas no PDF, antes e depois dos números.
    // Sem remontar, metade sai sem nome ou com o nome do vizinho.
    const remuneracao = t.linhas.find(l => /Remuneração/.test(l.rotulo));
    ok(remuneracao && /XIV\.4\. Remuneração das Disponibilidades do Tesouro/.test(remuneracao.rotulo),
       `rótulo remontado de três linhas: "${remuneracao?.rotulo}"`);
    ok(t.linhas.every(l => /^[IVXLC]+/.test(l.rotulo)), 'toda linha começa pela rubrica do documento');
    ok(!t.linhas.some(l => /Mensagem Presidencial|Discriminação/.test(l.rotulo)),
       'o cabeçalho da página NÃO vaza para dentro de nenhum rótulo');

    const juros = t.linhas.find(l => /Juros e Encargos/.test(l.rotulo));
    ok(juros && juros.valores[3].valor === 826175.4 && juros.valores[3].pctPIB === 5.6,
       `valor e % do PIB por coluna: ${juros?.valores[3].valor} (${juros?.valores[3].pctPIB}% do PIB)`);
    ok(t.linhas.every(l => l.valores.length === 4), 'toda linha tem os 4 exercícios');

    ok(/não identificado/i.test(M.tabelaComparativa('texto qualquer sem tabela').motivo || ''),
       'página sem tabela devolve motivo, não lista vazia muda');
  }

  console.log('\n== a variação, que é o produto ==');
  {
    const t = M.tabelaComparativa(pagina(116));
    const v = M.variacaoEntre(t, 'LOA 2026', 'PLOA 2027');
    ok(v.comparado && v.de === 'LOA 2026' && v.para === 'PLOA 2027', `${v.de} → ${v.para}`);
    ok(v.itens.length === 8, 'todas as rubricas comparadas');

    const juros = v.itens.find(i => /Juros e Encargos/.test(i.rotulo));
    ok(juros && Math.abs(juros.pct - 28.3) < 0.1,
       `Juros da Dívida: ${M.formatarBR(juros.de)} → ${M.formatarBR(juros.para)} (${M.formatarBR(juros.pct)}%)`);

    ok(v.maioresAltas.length && v.maioresAltas[0].pct >= v.maioresAltas[1].pct,
       `maiores altas ordenadas: ${v.maioresAltas[0].rotulo.slice(0, 40)} ${M.formatarBR(v.maioresAltas[0].pct)}%`);
    ok(v.maioresQuedas.length && v.maioresQuedas[0].pct < 0,
       `e as quedas: ${v.maioresQuedas[0].rotulo.slice(0, 40)} ${M.formatarBR(v.maioresQuedas[0].pct)}%`);
    ok(v.maioresQuedas.every(q => q.pct < 0) && v.maioresAltas.every(a => a.pct > 0),
       'alta e queda não se misturam');

    ok(/^\d[\d.]*,\d \(−?\+?\d/.test(M.rotuloVariacao(juros).replace('−', '-').replace('-', '−')) ||
       /\(\+28,3%\)/.test(M.rotuloVariacao(juros)),
       `rótulo pronto para a nota: "${M.rotuloVariacao(juros)}"`);

    const inexistente = M.variacaoEntre(t, 'LOA 2019', 'PLOA 2027');
    ok(!inexistente.comparado && /não encontradas/i.test(inexistente.motivo),
       `coluna inexistente é declarada: "${inexistente.motivo.slice(0, 70)}…"`);

    // Base zero não vira Infinity aparecendo como número na nota.
    const zerada = { exercicios: ['A 2026', 'B 2027'],
      linhas: [{ rotulo: 'I. Teste', valores: [{ valor: 0 }, { valor: 100 }] }] };
    const vz = M.variacaoEntre(zerada, 'A', 'B');
    ok(vz.itens[0].pct === null && /base zero/.test(M.rotuloVariacao(vz.itens[0])),
       'variação sobre base zero é declarada, não calculada');
  }

  console.log('\n== a fixture é o documento real ==');
  {
    ok(/Tabela 3 - Distribuição dos recursos/.test(TXT), 'traz a Tabela 3 do PLOA 2027');
    ok(/Realizado 2025 LOA 2026 Reprogramação 2026 PLOA 2027/.test(TXT), 'e a comparativa de quatro exercícios');
    ok(/R\$ 1\.741,00/.test(TXT) || /1\.741,00/.test(TXT), 'e o salário mínimo projetado (p.128)');
    ok(/44,8 bilhões para Reserva para Emendas/.test(TXT), 'e a Reserva para Emendas (p.137)');
  }

  console.log('\n== parâmetros macroeconômicos: PIB, IPCA, Selic, câmbio e salário mínimo ==');
  {
    // PLOA 2027: a grade por ano (p.34) e a frase do salário mínimo (p.128).
    const paginas = [34, 71, 114, 115, 116, 128, 137].map(n => ({ numero: n, texto: pagina(n) }));
    const r = M.parametrosMacro(paginas, '2027');
    ok(r.encontrados.length === 5 && r.faltando.length === 0, `os cinco localizados (${r.encontrados.join(', ')})`);
    ok(r.pib?.valor === '2,5%' && r.pib.pagina === '34', `PIB 2027 = ${r.pib?.valor} (coluna certa da grade, p. ${r.pib?.pagina})`);
    ok(r.ipca?.valor === '3,60%', `IPCA 2027 = ${r.ipca?.valor}`);
    ok(r.cambio?.valor === 'R$/US$ 5,22', `câmbio 2027 = ${r.cambio?.valor} (rótulo quebrado em três linhas)`);
    ok(r.selic?.valor === '12,53%', `Selic 2027 = ${r.selic?.valor}`);
    ok(r.salario_minimo?.valor === 'R$ 1.741,00' && r.salario_minimo.pagina === '128', `salário mínimo = ${r.salario_minimo?.valor} (p. ${r.salario_minimo?.pagina}, "salá-/rio" hifenizado)`);
    ok(/PIB \(var\. % anual\) 3,0 3,2/.test(r.pib.trecho) && /Taxa Selic 12,34/.test(r.selic.trecho), 'cada valor traz o trecho literal da linha');
    ok(/estimado em R\$ 1\.741,00/.test(r.salario_minimo.trecho) && /2027/.test(r.salario_minimo.trecho), 'e a frase do salário mínimo nomeia o exercício');

    // A coluna segue o exercício pedido: a mesma grade lida para 2026 dá os
    // valores de 2026 — é o que impede o número do ano vizinho de entrar.
    const r26 = M.parametrosMacro(paginas, '2026');
    ok(r26.pib?.valor === '2,3%' && r26.ipca?.valor === '5,08%' && r26.selic?.valor === '14,16%' && r26.cambio?.valor === 'R$/US$ 5,16',
       `a grade lida para 2026 devolve a coluna de 2026 (PIB ${r26.pib?.valor}, IPCA ${r26.ipca?.valor})`);
    ok(!r26.salario_minimo, 'e a frase do salário mínimo de 2027 NÃO serve para 2026');
    ok(M.parametrosMacro(paginas, '2031').encontrados.length === 0, 'ano fora da grade: nada é inventado');

    // PLOA 2026: o glossário do "Orçamento Cidadão" dentro da Mensagem (p.171, MEDIDO).
    const glossario = { numero: 171, texto: 'Orçamento Cidadão | Projeto de Lei Orçamentária Anual 2026 Projeções Macroeconômicas para 2026 Como o PLOA de um determinado ano é elaborado no ano anterior, é necessário projetar quanto será arrecadado. Salário mínimo R$ 1.631,00 É o menor valor que um (a) empregador (a) pode pagar a um (a) trabalhador (a). Inflação 3,60% É o aumento geral dos preços de bens e serviços na economia. O principal índice de inflação utilizado no PLOA é o IPCA acumulado. PIB 2,44% É uma forma de medir a riqueza de um país. Câmbio R$ 5,76 Taxa de câmbio é o valor da moeda de um país em relação ao valor da moeda de outro país. Juros 13,11% É a remuneração do dinheiro emprestado. No empréstimo entre bancos, é o Banco Central que decide a taxa de juros de referência, a taxa SELIC.' };
    const g = M.parametrosMacro([glossario], '2026');
    ok(g.encontrados.length === 5, `o glossário de 2026 rende os cinco (${g.encontrados.join(', ')})`);
    ok(g.salario_minimo?.valor === 'R$ 1.631,00' && g.ipca?.valor === '3,60%' && g.pib?.valor === '2,44%' && g.cambio?.valor === 'R$/US$ 5,76' && g.selic?.valor === '13,11%',
       'com os valores medidos na Mensagem do PLOA 2026');
    ok(g.pib.origem === 'glossario' && r.pib.origem === 'grade', 'e cada leitura declara de qual formato veio');
    ok(M.parametrosMacro([{ numero: 1, texto: 'PIB 2,44% em texto solto, sem contexto de projeções. Salário mínimo R$ 1.631,00.' }], '2026').encontrados.length === 0,
       'sem o contexto de projeções, "PIB 2,44%" solto não é lido — evita pescar número de outra seção');
    ok(M.parametrosMacro([], '2027').faltando.length === 5 && M.parametrosMacro([{ numero: 1, texto: '' }]).faltando.length === 5, 'vazio → tudo faltando, sem erro');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
