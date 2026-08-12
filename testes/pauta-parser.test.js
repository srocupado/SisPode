// Testes do parser da Pauta de Plenário (pauta-parser.js).
//
// Nasceu de um defeito real: na pauta de 12/08/2026 o módulo identificou 26 de
// 27 itens. O item 7 sumiu EM SILÊNCIO porque a Câmara o escreveu
// "Requerimento 4.027, de 2026" — sem o "nº" que os outros 26 traziam. Perder
// item sem erro nenhum é o pior defeito possível num parser de pauta, então os
// casos abaixo travam as variações de grafia que já vimos na fonte.
//
// Uso: node testes/pauta-parser.test.js
const path = require('path');
const P = require(path.join(__dirname, '..', 'pauta-parser.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Monta uma pauta extensa sintética com os requerimentos dados. */
const pauta = linhas => `CÂMARA DOS DEPUTADOS\nEm 12 de agosto de 2026 (Quarta-feira)\n\nURGÊNCIA\n\n${linhas.join('\n')}\n`;

const req = (ordem, comoEscreve, projeto) =>
  `${ordem}. Requerimento ${comoEscreve}, de 2026, dos Srs. Líderes, que requer, nos termos do\n` +
  `artigo 155 do Regimento Interno da Câmara dos Deputados, regime de urgência\n` +
  `para apreciação do Projeto de Lei nº ${projeto}, de 2015, do Sr. Fulano, que\n` +
  `dispõe sobre coisa nenhuma. (REQ NT62 NT64)`;

(async () => {
  console.log('== grafias do número do requerimento ==');
  const r = P.parsearPauta(pauta([
    req(1, 'nº 4.011', '4.159'),      // a forma corrente
    req(2, '4.027', '1.400'),         // SEM o "nº" — o caso de 12/08/2026
    req(3, 'n° 4.028', '1.290'),      // "n°" com grau, não masculino ordinal
    req(4, 's/nº', '2.500'),          // ainda não autuado
    req(5, 'nº. 4.030', '3.000'),     // "nº." com ponto
  ]));
  const ordens = r.itens.map(i => i.ordem).sort((a, b) => a - b);
  ok(r.itens.length === 5, `os 5 requerimentos entram (obtidos: ${r.itens.length} — ordens ${ordens.join(',')})`);

  const porOrdem = n => r.itens.find(i => i.ordem === n);
  ok(porOrdem(1)?.numero === '4011', 'com "nº": número limpo do separador de milhar');
  ok(porOrdem(2)?.numero === '4027', 'SEM "nº": o item 7 da pauta de 12/08/2026 é capturado');
  ok(porOrdem(3)?.numero === '4028', 'com "n°" (sinal de grau)');
  ok(porOrdem(4)?.numero === 's/nº', 'sem protocolo continua marcado como s/nº');
  ok(porOrdem(5)?.numero === '4030', 'com "nº." (ponto depois)');
  ok(r.itens.every(i => i.tipoCategoria === 'requerimento'), 'todos classificados como requerimento');

  console.log('\n== o projeto urgenciado continua sendo identificado ==');
  ok(porOrdem(2)?.projetoUrgenciado?.numero === '1400' && porOrdem(2)?.projetoUrgenciado?.ano === '2015',
     `item sem "nº" ainda vincula o projeto (obtido: ${JSON.stringify(porOrdem(2)?.projetoUrgenciado)})`);
  ok(porOrdem(1)?.projetoUrgenciado?.numero === '4159', 'item com "nº" vincula o projeto');

  console.log('\n== não inventa item onde não há ==');
  const vazio = P.parsearPauta(pauta(['Nada aqui que se pareça com uma proposição.']));
  ok(vazio.itens.length === 0, 'texto sem requerimento não produz item');
  ok(P.parsearPauta(pauta([req(1, 'nº 1.000', '2.000')])).periodo === '12/08/2026',
     'período lido do cabeçalho por extenso');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
