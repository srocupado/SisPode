// Série histórica das cotas (serie.js) e guia de aplicação (guia-emendas.js).
//
// Os dois produtos que faltavam para a nota falar com o deputado, e não só com
// a coordenação:
//
//   · SÉRIE — "sua cota é de R$ 40,25 milhões" não informa nada a quem não sabe
//     quanto era antes. A nota 005/2020 da Coordenação comparava 2016 a 2020
//     lado a lado, e é a série que mostra se o parlamento ganhou ou perdeu
//     espaço. Medido: a cota individual por deputado saiu de R$ 19.704.897,00
//     na LOA 2023 para R$ 40.252.007,00 na LOA 2026 — mais que dobrou.
//
//   · GUIA — o documento mais consultado por um gabinete é a lista do que cada
//     ação permite custear. Aqui ele é INDEXADO por área temática e casado com
//     o relator setorial; o resumo do conteúdo depende da camada de IA, que
//     ainda não existe neste módulo, e isso é dito em vez de disfarçado.
//
// O que os testes travam: a série só aceita valor COM procedência e do
// exercício certo, e lacuna nunca vira interpolação.
//
// Uso: node testes/orcamento-serie-guia.test.js
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const S = require(path.join(RAIZ, 'serie.js'));
const G = require(path.join(RAIZ, 'guia-emendas.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Ficha de um exercício, no formato que o Firebase guarda. */
const ficha = (ano, valores) => ({ ano: String(ano), valores });
const campo = (valor, extra = {}) => ({ valor, documento: `Manual de Emendas ${extra.ano || ''}`.trim(),
  pagina: '18', exercicio: String(extra.exercicio ?? extra.ano ?? ''), ...extra });

(async () => {
  console.log('== a série, com os valores reais medidos ==');
  {
    const fichas = [
      ficha(2023, { cota_individual_deputado: campo('R$ 19.704.897,00', { ano: 2023, exercicio: '2023' }) }),
      ficha(2026, { cota_individual_deputado: campo('R$ 40.252.007,00', { ano: 2026, exercicio: '2026' }) }),
    ];
    const serie = S.montarSerie(fichas).find(s => s.campo === 'cota_individual_deputado');
    ok(serie.pontos.length === 2, 'os dois exercícios entram');
    ok(serie.pontos[0].valor === 19704897 && serie.pontos[1].valor === 40252007,
       `valores lidos: ${serie.pontos.map(p => p.texto).join(' → ')}`);
    ok(serie.variacao && Math.abs(serie.variacao.pct - 104.3) < 1,
       `mais que dobrou: ${serie.variacao.pct.toFixed(1)}%`);
    const frase = S.frasSerie(serie);
    ok(/de R\$ 19\.704\.897,00 em 2023 para R\$ 40\.252\.007,00 em 2026/.test(frase), `frase pronta: "${frase.slice(0, 96)}…"`);
    ok(/alta de 104/.test(frase), 'com a variação por extenso');
    // A série não é contígua (falta 2024 e 2025) e isso PRECISA aparecer,
    // senão lê-se como evolução ano a ano.
    ok(!serie.variacao.contiguo && /sem registro/.test(frase),
       'e a frase avisa que há exercícios sem registro');
  }

  console.log('\n== o que a série recusa ==');
  {
    // Sem documento: é justamente o valor "preenchido para não deixar em branco".
    const semDoc = [ficha(2026, { cota_bancada: { valor: 'R$ 285.200.000,00', exercicio: '2026' } })];
    const s1 = S.montarSerie(semDoc).find(s => s.campo === 'cota_bancada');
    ok(!s1.pontos.length && s1.descartados.some(d => /sem documento/.test(d.motivo)),
       `valor sem procedência não entra: "${s1.descartados[0]?.motivo}"`);

    // Carimbado com outro exercício: é a ficha copiada de um ano para o outro.
    const herdado = [ficha(2027, { cota_individual_deputado: campo('R$ 40.252.007,00', { ano: 2026, exercicio: '2026' }) })];
    const s2 = S.montarSerie(herdado).find(s => s.campo === 'cota_individual_deputado');
    ok(!s2.pontos.length && s2.descartados.some(d => /carimbado com o exercício 2026/.test(d.motivo)),
       `valor herdado é recusado e o motivo diz de onde veio: "${s2.descartados[0]?.motivo}"`);

    const textual = [ficha(2026, { cota_bancada: campo('a definir', { ano: 2026, exercicio: '2026' }) })];
    ok(S.montarSerie(textual).find(s => s.campo === 'cota_bancada').descartados.some(d => /não numérico/.test(d.motivo)),
       'texto livre não vira ponto de série');
  }

  console.log('\n== lacunas ==');
  {
    const fichas = [
      ficha(2024, {}),
      ficha(2025, { cota_individual_deputado: campo('R$ 30.000.000,00', { ano: 2025, exercicio: '2025' }) }),
      ficha(2026, { cota_individual_deputado: campo('R$ 40.252.007,00', { ano: 2026, exercicio: '2026' }) }),
    ];
    const s = S.montarSerie(fichas).find(x => x.campo === 'cota_individual_deputado');
    ok(s.lacunas.includes('2024'), `o exercício sem ficha aparece como lacuna nomeada: ${s.lacunas.join(', ')}`);
    ok(s.pontos.length === 2, 'e não é interpolado nem estimado');
    ok(s.variacao.primeiro.ano === '2025', 'a variação parte do primeiro ponto REAL, não da lacuna');

    const vazia = S.montarSerie([ficha(2027, {})]).find(x => x.campo === 'cota_bancada');
    ok(!vazia.pontos.length && /sem valor registrado/.test(S.frasSerie(vazia)), 'série vazia diz que está vazia');
    ok(S.seriesComDados(S.montarSerie([ficha(2027, {})])).length === 0, 'e não é oferecida para exibição');

    const um = S.montarSerie([ficha(2026, { salario_minimo: campo('R$ 1.621,00', { ano: 2026, exercicio: '2026' }) })]);
    const u = um.find(x => x.campo === 'salario_minimo');
    ok(u.pontos.length === 1 && !u.variacao && /único exercício/.test(S.frasSerie(u)),
       'um só ponto não gera variação inventada');
  }

  console.log('\n== guia: áreas temáticas e relatoria ==');
  {
    const relatores = { setoriais: [
      { area: 'I - Infraestrutura, Minas e Energia', casa: 'Câmara', nome: 'José Nelto', partido: 'UNIÃO', uf: 'GO' },
      { area: 'II - Saúde', casa: 'Senado', nome: 'Veneziano Vital do Rêgo', partido: 'MDB', uf: 'PB' },
      { area: 'XIV - Trabalho e Previdência', casa: 'Senado', nome: 'Carlos Viana', partido: 'PODEMOS', uf: 'MG' },
      { area: 'XV - Justiça e Segurança Pública', casa: 'Câmara', nome: 'Romero Rodrigues', partido: 'PODEMOS', uf: 'PB' },
    ] };
    const emendas = { documentos: [
      { rotulo: 'I - Infraestrutura, Minas e Energia — Ministério de Portos e Aeroportos', url: 'u1', classe: 'cartilha' },
      { rotulo: 'II - Saúde — Fundo Nacional de Saúde - FNS', url: 'u2', classe: 'cartilha' },
      { rotulo: 'Cartilha avulsa do Ministério da Cultura', url: 'u3', classe: 'cartilha' },
      { rotulo: 'Manual de Emendas', url: 'u4', classe: 'manual' },
    ] };

    const g = G.montarGuia(emendas, relatores);
    ok(g.disponivel && g.areas.length === 4, `${g.areas.length} áreas temáticas organizadas`);
    ok(g.areas[0].cartilhas.length === 1 && g.areas[0].cartilhas[0].url === 'u1', 'a cartilha casa com a área pelo número romano');
    ok(g.areas[2].cartilhas.length === 0, 'área sem cartilha publicada fica vazia, e continua listada');
    // Cartilha que não casou não pode sumir: é documento que o gabinete procura.
    ok(g.semArea.length === 1 && g.semArea[0].url === 'u3',
       `cartilha sem área identificada fica visível: "${g.semArea[0]?.rotulo}"`);
    ok(g.totalCartilhas === 3, 'o Manual não é contado como cartilha');

    ok(g.areasDaBancada.length === 2 && g.areasDaBancada.every(a => a.relator.daBancada),
       `as áreas relatadas pela bancada são destacadas: ${g.areasDaBancada.map(a => a.nome).join('; ')}`);
    ok(g.areas[0].relator.daBancada === false, 'e as demais não');

    // A RESSALVA que impede o índice de passar por conteúdo.
    ok(/não foi resumido/.test(g.ressalva), `a ressalva é explícita: "${g.ressalva.slice(0, 80)}…"`);

    const semCartilha = G.montarGuia({ documentos: [] }, relatores);
    ok(/ainda não publicou cartilhas/.test(semCartilha.ressalva), 'sem cartilhas, diz que a CMO não publicou');

    const semRelator = G.montarGuia(emendas, { setoriais: [] });
    ok(!semRelator.areas.length && /ainda não foram designados/.test(semRelator.motivo),
       `sem relatores setoriais: "${semRelator.motivo}"`);
    ok(semRelator.semArea.length === 3, 'mas as cartilhas continuam acessíveis');

    const p = G.partesDaArea('XIV - Trabalho e Previdência');
    ok(p.numero === 'XIV' && p.nome === 'Trabalho e Previdência', 'a área é separada em número e nome');
    ok(G.partesDaArea('Sem numeração').numero === null, 'área fora do padrão não quebra');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
