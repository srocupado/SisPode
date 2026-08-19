// Panorama por pasta — Portal da Transparência (módulo Orçamento).
//
// Roda contra o retorno REAL da API, gravado em
// testes/fixtures/transparencia-pode-2026.json (5 parlamentares do Podemos,
// consultados em 19/08/2026 com a chave da Liderança). A chave NÃO está aqui
// nem no repositório: cada analista guarda a sua no próprio navegador.
//
// O que precisa estar certo:
//   a) valores vêm em texto pt-BR ("166.530,00") — e viram número;
//   b) codigoEmenda casa com o coEmendaPolitica do FNS (autor + número);
//   c) transferência ESPECIAL não tem proposta no FNS — a tela não pode
//      oferecer um detalhe que não existe;
//   d) a matriz parlamentar × pasta soma o que deve e não perde emenda
//      nenhuma na coluna "Outras".
//
// Uso: node testes/orcamento-panorama.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'emendas.js'), 'utf8');
const CRU = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'transparencia-pode-2026.json'), 'utf8'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const fmtN = n => (n || 0).toLocaleString('pt-BR');

const trecho = re => src.match(re)[0];
const M = new Function(`
  ${trecho(/function dinheiro\([\s\S]*?\n}/)}
  ${trecho(/function partesDoCodigo\([\s\S]*?\n}/)}
  ${trecho(/function normalizarEmenda\([\s\S]*?\n}/)}
  ${trecho(/function pagoIncoerente\([\s\S]*?\n}/)}
  ${trecho(/function temPropostaNoFns\([\s\S]*?\n}/)}
  ${trecho(/function somarEmendas\([\s\S]*?\n}/)}
  ${trecho(/function matrizPorPasta\([\s\S]*?\n}/)}
  return { dinheiro, partesDoCodigo, normalizarEmenda, temPropostaNoFns, somarEmendas, matrizPorPasta, pagoIncoerente };
`)();

const emendas = CRU.map(M.normalizarEmenda);

(async () => {
  console.log('== retorno real da API vira número ==');
  {
    const renata = emendas.filter(e => e.parlamentar === 'RENATA ABREU');
    ok(renata.length === 13, `13 emendas de Renata Abreu em 2026 (${renata.length})`);
    ok(emendas.every(e => Number.isFinite(e.empenhado) && Number.isFinite(e.pago)),
       'todo valor virou número — nenhum NaN escapou do formato "166.530,00"');
    const saude = renata.filter(e => e.funcao === 'Saúde');
    const t = M.somarEmendas(saude);
    ok(Math.round(t.pago) === 25877285,
       `pago em saúde bate com a fonte: ${Math.round(t.pago).toLocaleString('pt-BR')}`);
    // Confere contra a OUTRA fonte: a base do FNS deu 25.890.015 pagos para a
    // mesma deputada. As duas se corroboram dentro do erro de momento (0,05%).
    const difFns = Math.abs(t.pago - 25890015) / 25890015;
    ok(difFns < 0.01, `confere com o FNS dentro de 1% (diferença de ${(difFns * 100).toFixed(2)}%)`);
  }

  console.log('\n== o código da emenda é a ponte com o FNS ==');
  {
    const p = M.partesDoCodigo('202637460001');
    ok(p && p.ano === '2026' && p.autor === '3746' && p.numero === '0001',
       `202637460001 → ano ${p?.ano}, autor ${p?.autor}, nº ${p?.numero}`);
    // O FNS traz coEmendaPolitica "37460001" para a proposta de Arapeí, da
    // Renata: autor + número, exatamente o que sai daqui.
    ok(p.autor + p.numero === '37460001', 'autor+número reproduz o coEmendaPolitica do FNS');
    ok(M.partesDoCodigo('123') === null && M.partesDoCodigo('') === null,
       'código fora do padrão não é inventado');
    const daRenata = emendas.filter(e => e.parlamentar === 'RENATA ABREU');
    ok(daRenata.every(e => e.codigoAutor === '3746'), 'todas as emendas dela carregam o mesmo código de autor');
  }

  console.log('\n== transferência especial não tem para onde descer ==');
  {
    const especiais = emendas.filter(e => /especia/i.test(e.tipo));
    const definidas = emendas.filter(e => /finalidade\s+definida/i.test(e.tipo) && e.funcao === 'Saúde');
    ok(especiais.length > 0, `${especiais.length} transferência(s) especial(is) na amostra real`);
    ok(especiais.every(e => !M.temPropostaNoFns(e)),
       'nenhuma especial promete detalhe no FNS');
    ok(definidas.length > 0 && definidas.every(e => M.temPropostaNoFns(e)),
       `saúde com finalidade definida aponta para o FNS (${definidas.length})`);
    ok(!M.temPropostaNoFns({ tipo: 'Emenda Individual - Transferências com Finalidade Definida', funcao: 'Educação' }),
       'fora da saúde não promete FNS, mesmo com finalidade definida');
  }

  console.log('\n== contradição da fonte é marcada, não aparada ==');
  {
    // Caso REAL: emenda 202644370009 (Nely Aquino, desporto) — empenhado
    // 392.000, liquidado 391.984,80 e pago 783.969,60. O Portal se contradiz;
    // aparar para 100% esconderia isso da Liderança.
    const bicho = emendas.find(e => e.codigo === '202644370009');
    ok(bicho && M.pagoIncoerente(bicho),
       `pago (${fmtN(bicho?.pago)}) acima do empenhado (${fmtN(bicho?.empenhado)}) é detectado`);
    ok(bicho.pago === 783969.6, 'o valor é preservado exatamente como veio da fonte');
    ok(!M.pagoIncoerente({ empenhado: 100, pago: 100 }) && !M.pagoIncoerente({ empenhado: 100, pago: 40 }),
       'caso normal não é marcado');
    ok(!M.pagoIncoerente({ empenhado: 0, pago: 0 }), 'emenda sem empenho não vira falso alarme');
  }

  console.log('\n== matriz parlamentar × pasta ==');
  {
    const { colunas, linhas } = M.matrizPorPasta(emendas);
    ok(colunas.length <= 7, `no máximo 6 pastas + "Outras" (${colunas.length}: ${colunas.join(', ')})`);
    ok(colunas[0] === 'Saúde', `a pasta com mais empenho vem primeiro: ${colunas[0]}`);
    ok(linhas.length === 5, `uma linha por parlamentar (${linhas.length})`);

    // Nada pode se perder: a soma das células tem de ser a soma das emendas.
    const somaCelulas = linhas.reduce((a, l) =>
      a + Object.values(l.celulas).reduce((b, c) => b + c.pago, 0), 0);
    const somaEmendas = M.somarEmendas(emendas).pago;
    ok(Math.abs(somaCelulas - somaEmendas) < 0.01,
       `a matriz não perde dinheiro: ${Math.round(somaCelulas).toLocaleString('pt-BR')}`);

    ok(linhas[0].total.pago >= linhas[linhas.length - 1].total.pago, 'ordenado pelo total pago');
    const semEmendas = M.matrizPorPasta([]);
    ok(semEmendas.linhas.length === 0 && semEmendas.colunas.length === 0, 'lista vazia não quebra a matriz');
  }

  console.log('\n== restos a pagar entram na conta ==');
  {
    const t = M.somarEmendas([
      { empenhado: 100, liquidado: 50, pago: 40, restoInscrito: 30, restoPago: 10 },
      { empenhado: 200, liquidado: 200, pago: 200, restoInscrito: 0, restoPago: 0 },
    ]);
    ok(t.restos === 20, `restos = inscrito - pago, sem contar negativo (${t.restos})`);
    ok(t.empenhado === 300 && t.pago === 240, 'somas simples conferem');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
