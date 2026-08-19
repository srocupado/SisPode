// Leitura da planilha oficial do Fundo Nacional de Saúde (módulo Emendas).
//
// Roda contra os arquivos REAIS baixados do portal em 19/08/2026:
//   POST /recursos/proposta/planilha  {sgUf:"AC"|"SP", ano:"2026"}
// O que o módulo inteiro depende de acertar aqui:
//   a) a coluna PARTIDO existe e separa a bancada — sem isso não há módulo;
//   b) os valores vêm em dois formatos na MESMA planilha (número cru em
//      "VALOR PROPOSTA" e "R$ 339.502,00" em empenho/pago);
//   c) mudança de formato da fonte tem de ESTOURAR, não devolver lista vazia.
//
// Uso: node testes/emendas-planilha.test.js
const fs = require('fs');
const path = require('path');
// A MESMA biblioteca que a extensão usa (libs/xlsx.full.min.js) — o teste
// exercita o caminho real, não outra implementação.
const XLSX = require(path.join(__dirname, '..', 'libs', 'xlsx.full.min.js'));

const src = fs.readFileSync(path.join(__dirname, '..', 'emendas.js'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Monta as funções puras do módulo com o XLSX do Node no lugar do da extensão.
const trecho = re => src.match(re)[0];
const modulo = new Function('XLSX', `
  const SIGLA_PODEMOS = 'PODE';
  ${trecho(/const COLUNAS = \{[\s\S]*?\n\};/)}
  ${trecho(/function normalizarCabecalho[\s\S]*?\n}/)}
  ${trecho(/function dinheiro[\s\S]*?\n}/)}
  ${trecho(/let _avisouPrecisao[\s\S]*?\n}/)}
  ${trecho(/function lerPlanilhaPodemos[\s\S]*?\n}/)}
  ${trecho(/function etapaDe[\s\S]*?\n}/)}
  ${trecho(/function somar[\s\S]*?\n}/)}
  ${trecho(/function porDeputado[\s\S]*?\n}/)}
  return { lerPlanilhaPodemos, dinheiro, etapaDe, somar, porDeputado, normalizarCabecalho, numeroDaProposta };
`)(XLSX);

const ler = arq => modulo.lerPlanilhaPodemos(
  fs.readFileSync(path.join(__dirname, 'fixtures', arq)).buffer, 'XX', '2026');

(async () => {
  console.log('== dinheiro nos dois formatos da mesma planilha ==');
  ok(modulo.dinheiro(339502) === 339502, 'número cru (coluna VALOR PROPOSTA)');
  ok(modulo.dinheiro('R$ 339.502,00') === 339502, 'texto "R$ 339.502,00" (colunas de empenho e pago)');
  ok(modulo.dinheiro('R$ 1.234.567,89') === 1234567.89, 'milhar e centavos');
  ok(modulo.dinheiro('') === 0 && modulo.dinheiro(null) === 0, 'vazio vira zero, não NaN');

  console.log('\n== planilha real do Acre (159 propostas individuais + demais tipos) ==');
  {
    // O Acre não tem deputado do Podemos com emenda à saúde em 2026 — o
    // resultado CERTO é lista vazia. O que o caso prova é que o cabeçalho foi
    // reconhecido (senão teria estourado) e que outros partidos não vazam.
    const itens = ler('planilha-fns-ac-2026.xlsx');
    ok(Array.isArray(itens) && itens.length === 0,
       `planilha lida e nenhum não-Podemos vazou (${itens.length} linhas)`);
  }

  console.log('\n== planilha real de São Paulo (4.468 propostas) ==');
  {
    const itens = ler('planilha-fns-sp-2026.xlsx');
    ok(itens.length > 200, `bancada do PODE em SP: ${itens.length} propostas`);
    const nomes = [...new Set(itens.map(i => i.deputado))];
    ok(nomes.includes('RENATA ABREU') && nomes.includes('RODRIGO GAMBALE'),
       `deputados identificados: ${nomes.slice(0, 4).join(', ')}`);

    const renata = itens.filter(i => i.deputado === 'RENATA ABREU');
    const t = modulo.somar(renata);
    ok(t.proposto > 0 && t.pago >= 0 && t.proposto >= t.pago,
       `valores coerentes — proposto ${Math.round(t.proposto)}, pago ${Math.round(t.pago)}`);

    // A proposta de Arapeí é o caso que conferi à mão contra o obter-proposta.
    const arapei = itens.find(i => i.nuProposta === '07241356000126001');
    ok(arapei && arapei.pago === 199873 && arapei.proposto === 199873,
       `Arapeí bate com o detalhe da API: proposto ${arapei?.proposto}, pago ${arapei?.pago}`);
    ok(arapei && modulo.etapaDe(arapei).chave === 'pago',
       `situação "${arapei?.situacao}" vira etapa paga`);

    const porDep = modulo.porDeputado(itens);
    ok(porDep[0].pago >= porDep[porDep.length - 1].pago, 'agregado por deputado sai ordenado pelo pago');
    ok(porDep.every(d => d.pct >= 0 && d.pct <= 100), 'percentual de execução dentro da faixa');
  }

  console.log('\n== classificação das situações reais da fonte ==');
  {
    const casos = [
      ['Proposta Paga', 'pago'],
      ['Proposta Empenhada aguardando Formalizacao', 'formal'],
      ['Proposta em Pagamento', 'empago'],
      ['Proposta Empenhada', 'empenho'],
      ['Em análise pela área técnica', 'neutro'],
    ];
    for (const [txt, esperado] of casos) {
      const e = modulo.etapaDe({ situacao: txt });
      ok(e.chave === esperado, `"${txt}" → ${e.chave} (${e.rotulo})`);
    }
  }

  console.log('\n== nº da proposta com 17 dígitos ==');
  {
    // O FNS grava essa coluna como TEXTO — é o que preserva os 17 dígitos.
    // Conferido contra a própria API em 19/08/2026: a proposta do Tocantins
    // é "36000765198202600" mesmo, terminada em 00; não falta dígito.
    ok(modulo.numeroDaProposta('36000765198202600', 'TO') === '36000765198202600',
       'texto de 17 dígitos passa intacto');
    ok(modulo.numeroDaProposta('07241356000126001', 'SP') === '07241356000126001',
       'zero à esquerda é preservado');
    // Se um dia vier como número, o estrago já aconteceu antes daqui — o teste
    // trava o comportamento de não exibir notação científica.
    ok(!/e\+/i.test(modulo.numeroDaProposta(36000765198202600, 'TO')),
       'número cru não vira notação científica na tela');
  }

  console.log('\n== mudança de formato da fonte estoura, não silencia ==');
  {
    const ws = XLSX.utils.aoa_to_sheet([['Nº Proposta', 'UF', 'VALOR PAGO'], ['123', 'SP', 'R$ 1,00']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'p');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    let erro = null;
    try { modulo.lerPlanilhaPodemos(buf, 'SP', '2026'); } catch (e) { erro = e.message; }
    ok(/PARTIDO/.test(erro || ''), `planilha sem a coluna do partido é recusada: ${erro}`);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
