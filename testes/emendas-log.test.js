// Log da coleta e detecção de mudanças (módulo Orçamento — Emendas).
//
// O log é o que o analista copia e manda quando algo dá errado no navegador
// dele — nenhum outro instrumento chega lá. E a comparação com o retrato
// anterior é a razão de ser de um módulo de MONITORAMENTO: dizer o que virou
// pago desde a última consulta.
//
// Uso: node testes/emendas-log.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'emendas.js'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const trecho = re => src.match(re)[0];
const M = new Function(`
  ${trecho(/function etapaDe\([\s\S]*?\n}/)}
  ${trecho(/function linhaDoLog\([\s\S]*?\n}/)}
  ${trecho(/function compararComAnterior\([\s\S]*?\n}/)}
  ${trecho(/function resumoMudancas\([\s\S]*?\n}/)}
  return { linhaDoLog, compararComAnterior, resumoMudancas, etapaDe };
`)();

const prop = (n, o) => ({ nuProposta: n, deputado: 'RENATA ABREU', municipio: 'ARAPEI', uf: 'SP',
                          proposto: 100, pago: 0, situacao: 'Proposta Empenhada', ...o });

(async () => {
  console.log('== linha do log ==');
  {
    const bom = M.linhaDoLog({ uf: 'SP', podemos: 253, bytes: 485772, msDownload: 33841, ms: 34000, tentativas: 1, salvo: true });
    ok(/✓ SP/.test(bom) && /253 do PODE/.test(bom) && /474 KB/.test(bom) && /33\.8s/.test(bom),
       `estado que deu certo: ${bom}`);

    const ruim = M.linhaDoLog({ uf: 'RJ', erro: 'o FNS respondeu HTTP 504 para RJ', status: 504, tentativas: 3, ms: 92100 });
    ok(/✗ RJ/.test(ruim) && /504/.test(ruim) && /3 tentativa/.test(ruim) && /92\.1s/.test(ruim),
       `estado que falhou, com o motivo: ${ruim}`);

    const naoSalvo = M.linhaDoLog({ uf: 'MG', podemos: 12, bytes: 1024, msDownload: 5000, ms: 5100, tentativas: 1, salvo: false });
    ok(/NÃO SALVO/.test(naoSalvo), `lido mas não gravado fica explícito: ${naoSalvo}`);
  }

  console.log('\n== mudanças desde a busca anterior ==');
  {
    const antes = new Map([
      ['A|RENATA ABREU', prop('A', { pago: 0 })],
      ['B|RENATA ABREU', prop('B', { pago: 50 })],
      ['C|RENATA ABREU', prop('C', { pago: 100, situacao: 'Proposta Paga' })],
    ]);
    const agora = [
      prop('A', { pago: 100, situacao: 'Proposta Paga' }),   // virou paga
      prop('B', { pago: 80 }),                                // pagamento parcial novo
      prop('C', { pago: 100, situacao: 'Proposta Paga' }),    // igual
      prop('D', { pago: 0 }),                                 // nova
    ];
    const m = M.compararComAnterior(antes, agora);
    ok(m.pagas.length === 1 && m.pagas[0].nuProposta === 'A', 'detecta a que passou a paga');
    ok(m.subiu.length === 1 && m.subiu[0].nuProposta === 'B' && m.subiu[0].antes === 50,
       'detecta pagamento novo e guarda o valor anterior');
    ok(m.novas.length === 1 && m.novas[0].nuProposta === 'D', 'detecta proposta nova');
    ok(/1 nova/.test(M.resumoMudancas(m)) && /paga/.test(M.resumoMudancas(m)), `resumo: ${M.resumoMudancas(m)}`);
  }

  console.log('\n== primeira coleta não inventa "mudanças" ==');
  {
    const m = M.compararComAnterior(new Map(), [prop('A', {})]);
    ok(m.primeira === true && M.resumoMudancas(m) === '', 'sem retrato anterior, nada é anunciado como novidade');
  }

  console.log('\n== nada mudou é dito, não silenciado ==');
  {
    const antes = new Map([['A|RENATA ABREU', prop('A', { pago: 10 })]]);
    const m = M.compararComAnterior(antes, [prop('A', { pago: 10 })]);
    ok(/nada mudou/.test(M.resumoMudancas(m)), `dito claramente: "${M.resumoMudancas(m).trim()}"`);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
