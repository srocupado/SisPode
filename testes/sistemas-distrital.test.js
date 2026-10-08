// Sistemas eleitorais · distrital misto — malha, leitura, unidades, desenho dos distritos e eleição.
// O desenho foi conferido com os dados reais de 2026 (TSE + IBGE): AC, DF, ES, SP, MG e RJ.
// Uso: node testes/sistemas-distrital.test.js
const path = require('path');
const SD = require(path.join(__dirname, '..', 'sistemas-distrital.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const perto = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('Malha do IBGE (TopoJSON)');
// Três municípios em fila (quadrados 1×1): A | B | C. Arcos: 0 = divisa A|B, 1 = divisa B|C,
// 2 = contorno de A, 3 = contorno de B (de cima e de baixo), 4 = contorno de C. Coordenadas absolutas (sem transform).
const topo = { type: 'Topology', arcs: [
  [[1, 0], [1, 1]],                         // 0: A|B, de baixo para cima
  [[2, 0], [2, 1]],                         // 1: B|C
  [[1, 1], [0, 1], [0, 0], [1, 0]],         // 2: A sem a divisa
  [[1, 0], [2, 0]],                         // 3: base de B
  [[2, 1], [3, 1], [3, 0], [2, 0]],         // 4: C sem a divisa
  [[2, 1], [1, 1]],                         // 5: topo de B
], objects: { m: { type: 'GeometryCollection', geometries: [
  { type: 'Polygon', arcs: [[0, 2]], properties: { codarea: 'A' } },
  { type: 'Polygon', arcs: [[3, 1, 5, ~0]], properties: { codarea: 'B' } },
  { type: 'Polygon', arcs: [[~1, 4]], properties: { codarea: 'C' } },
] } } };
const m = SD.sdTopo(topo);
ok(Object.keys(m.feicoes).join() === 'A,B,C' && m.feicoes.B.poligonos[0][0].length === 5, 'municípios e anéis montados pelos arcos');
ok([...m.vizinhos.B].sort().join() === 'A,C' && [...m.vizinhos.A].join() === 'B' && !m.vizinhos.A.has('C'), 'vizinhança pelas divisas comuns');
ok(m.fronteira['A|B'].length === 1 && m.fronteira['B|C'][0][0] === 2, 'ponto da divisa entre dois municípios');
const q = SD.sdTopo({ type: 'Topology', transform: { scale: [0.5, 2], translate: [10, 20] }, arcs: [[[0, 0], [2, 0], [0, 1], [-2, 0], [0, -1]]],
  objects: { m: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0]], properties: { codarea: 'X' } }] } } });
ok(JSON.stringify(q.feicoes.X.poligonos[0][0]) === '[[10,20],[11,20],[11,22],[10,22],[10,20]]', 'coordenadas quantizadas: deltas e transform');
const proj = p => p;   // plano, sem projeção
const ac = SD.sdAreaCentro(m.feicoes.B.poligonos, proj);
ok(perto(ac.area, 1) && perto(ac.x, 1.5) && perto(ac.y, 0.5), 'área e centroide de um quadrado');
const furado = SD.sdAreaCentro([[[[0, 0], [4, 0], [4, 4], [0, 4]], [[1, 1], [1, 2], [2, 2], [2, 1]]]], proj);
ok(perto(furado.area, 15) && perto(furado.x, (16 * 2 - 1.5) / 15) && perto(furado.y, (16 * 2 - 1.5) / 15), 'buraco subtrai, qualquer que seja o sentido do anel');
const pj = SD.sdProjetor(-47, -15);
ok(perto(pj([-46, -15])[0], 111.32 * Math.cos(15 * Math.PI / 180), 1e-9) && perto(pj([-47, -14])[1], 110.57), 'projeção em km');

console.log('Leitura dos dados abertos (um estado)');
const L = SD.sdLeitorGeo('ac', ['6']);
['"DT_GERACAO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"CD_CARGO";"NR_TURNO";"SQ_CANDIDATO";"QT_VOTOS_NOMINAIS_VALIDOS"',
  '"x";"AC";"1007";"BUJARI";"9";"6";"1";"101";"30"',
  '"x";"AC";"1007";"BUJARI";"9";"6";"1";"101";"5"',
  '"x";"AC";"1392";"RIO BRANCO";"1";"6";"1";"102";"700"',
  '"x";"AC";"1392";"RIO BRANCO";"1";"7";"1";"901";"999"',
  '"x";"AC";"1392";"RIO BRANCO";"1";"6";"2";"102";"999"',
  '"x";"AM";"2000";"MANAUS";"1";"6";"1";"300";"999"'].forEach(L.candidato.linha);
['"DT_GERACAO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"CD_CARGO";"NR_TURNO";"SG_PARTIDO";"QT_TOTAL_VOTOS_LEG_VALIDOS"',
  '"x";"AC";"1392";"RIO BRANCO";"1";"6";"1";"PP";"40"'].forEach(L.partido.linha);
['"DT_GERACAO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"CD_CARGO";"NR_TURNO";"QT_APTOS"',
  '"x";"AC";"01007";"BUJARI";"0009";"6";"1";"11152"',
  '"x";"AC";"01007";"BUJARI";"0009";"7";"1";"11152"',
  '"x";"AC";"01392";"RIO BRANCO";"0001";"6";"1";"150000"'].forEach(L.detalhe.linha);
['"DT_GERACAO";"SG_UF";"CD_MUNICIPIO";"NR_ZONA";"NR_LATITUDE";"NR_LONGITUDE";"QT_ELEITOR_SECAO"',
  '"x";"AC";"01392";"1";"-10,0";"-68,0";"100"',
  '"x";"AC";"01392";"1";"-10.2";"-68.2";"300"',
  '"x";"AC";"01392";"1";"-1";"-1";"500"'].forEach(L.locais.linha);
const g = L.resultado();
ok(Object.keys(g.mun).sort().join() === '1007,1392' && g.mun['1007'].zonas['9'].aptos === 11152 && g.mun['1392'].nome === 'RIO BRANCO',
  'códigos sem zeros à esquerda ("01007" e "1007" são o mesmo município); aptos por município e zona');
ok(g.votos['6']['1007|9'].c['101'] === 35 && g.votos['6']['1392|1'].c['102'] === 700 && g.votos['6']['1392|1'].l.PP === 40 && !g.votos['7'],
  'votos por candidato e legenda por partido, por zona; só o cargo e o 1º turno pedidos, só a UF');
ok(perto(g.mun['1392'].zonas['1'].la, -10.15) && perto(g.mun['1392'].zonas['1'].lo, -68.15), 'posição da zona: média dos locais pesada pelos eleitores (coordenada -1 ignorada; vírgula ou ponto)');
let erro = '';
try { SD.sdLeitorGeo('ac').detalhe.linha('"DT_GERACAO";"SG_UF"'); } catch (e) { erro = e.message; }
ok(/fora do formato esperado/.test(erro), 'cabeçalho diferente: erro claro');

console.log('Unidades e vizinhança');
// B é grande (3 zonas); A e C, municípios inteiros; D é uma ilha (sem divisa).
const geo = { mun: {
  1: { nome: 'A', zonas: { 1: { aptos: 100, la: null, lo: null } } },
  2: { nome: 'B', zonas: { 2: { aptos: 300, la: 0.2, lo: 1.2 }, 3: { aptos: 300, la: 0.8, lo: 1.5 }, 4: { aptos: 300, la: 0.5, lo: 1.8 } } },
  3: { nome: 'C', zonas: { 5: { aptos: 100, la: null, lo: null } } },
  4: { nome: 'D', zonas: { 6: { aptos: 50, la: null, lo: null } } },
} };
const malhaD = SD.sdTopo({ type: 'Topology', arcs: topo.arcs.concat([[[5, 0], [6, 0], [6, 1], [5, 1], [5, 0]]]), objects: { m: { type: 'GeometryCollection',
  geometries: topo.objects.m.geometries.concat([{ type: 'Polygon', arcs: [[6]], properties: { codarea: 'D' } }]) } } });
const base = SD.sdUnidades(geo, malhaD, (cd, nome) => nome, 500);
const ids = base.unidades.map(u => u.id).sort().join();
ok(ids === 'm:1,m:3,m:4,z:2:2,z:2:3,z:2:4', 'município acima do limite entra dividido nas zonas; os demais, inteiros');
ok(base.viz['m:1'].size >= 1 && [...base.viz['m:1']].every(i => i.startsWith('z:2:')) && [...base.viz['m:3']].some(i => i.startsWith('z:2:')), 'vizinhos de um município dividido ligam às zonas da divisa');
ok(base.pontes === 1 && base.viz['m:4'].size === 1, 'ilha ligada por uma ponte à unidade mais próxima');
ok(SD.sdComponentes(base.unidades.map(u => u.id), base.viz).length === 1, 'tudo conexo');
ok(perto(base.unidades.find(u => u.id === 'z:2:3').area * 3, base.unidades.find(u => u.id === 'm:1').area, 1), 'área da zona: a do município repartida pelos eleitores');

console.log('Desenho dos distritos');
// Grade 6 × 6 de unidades iguais, vizinhança de 4 lados.
const grade = (n, apt = () => 100) => {
  const unidades = [], viz = {};
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) unidades.push({ id: `g${i}-${j}`, mun: `g${i}-${j}`, zonas: ['1'], nome: `${i},${j}`, aptos: apt(i, j), x: j * 10, y: i * 10, area: 100 });
  for (const u of unidades) {
    const [i, j] = u.id.slice(1).split('-').map(Number);
    viz[u.id] = new Set([[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n).map(([a, b]) => `g${a}-${b}`));
  }
  return { unidades, viz };
};
const g6 = grade(6);
const d4 = SD.sdDistritar(g6, 4);
ok(d4.distritos.length === 4 && d4.distritos.every(d => d.unidades.length === 9 && d.aptos === 900) && d4.metricas.desvioMax === 0, '6×6 em 4: quatro distritos de 9, desvio zero');
ok(d4.metricas.contiguos && d4.metricas.compacidadeMedia > 0.8, 'contíguos e compactos (quadrados)');
ok(new Set(d4.distritos.flatMap(d => d.unidades)).size === 36, 'cada unidade em um distrito só');
ok(d4.distritos[0].y >= d4.distritos[3].y && d4.distritos.map(d => d.id).join() === '1,2,3,4', 'numerados de norte a sul');
const d3 = SD.sdDistritar(grade(6), 3);
ok(d3.metricas.desvioMax === 0 && d3.metricas.contiguos, '6×6 em 3: doze unidades cada');
const d36 = SD.sdDistritar(grade(6), 36);
ok(d36.distritos.every(d => d.unidades.length === 1), 'uma unidade por distrito');
ok(/36 unidades .* 37 distritos/.test(SD.sdDistritar(grade(6), 37).erro), 'mais distritos que unidades: erro claro');
// Distribuição desigual: a coluna da esquerda é densa (cidade).
const desigual = grade(6, (i, j) => (j === 0 ? 500 : 100));
const dd = SD.sdDistritar(desigual, 4);
ok(dd.metricas.contiguos && dd.metricas.desvioMax <= 0.1 && Math.abs(dd.distritos.reduce((s, d) => s + d.aptos, 0) - 6000) < 1e-9, 'eleitorado desigual: contíguos, desvio de até 10%, ninguém de fora');
// Trocas na fronteira: um corte desequilibrado é corrigido.
const partes = [['g0-0', 'g0-1', 'g0-2', 'g1-0', 'g1-1', 'g1-2'], ['g2-0', 'g2-1', 'g2-2']];
const g3 = { unidades: grade(3).unidades, viz: grade(3).viz };
const U3 = new Map(g3.unidades.map(u => [u.id, u]));
const trocas = SD.sdRefinar(partes, U3, g3.viz, 450, 100);
ok(trocas >= 1 && Math.abs(partes[0].length - partes[1].length) <= 1 && SD.sdComponentes(partes[0], g3.viz).length === 1 && SD.sdComponentes(partes[1], g3.viz).length === 1,
  'trocas na fronteira equilibram sem partir distritos');

console.log('Eleição nos distritos');
// Estado com 4 vagas, 2 distritos: oeste (unidade w) e leste (unidade e).
const cand = (sq, partido, votos) => ({ sq, n: sq, nome: 'C' + sq, partido, votos, valido: true, eleitoReal: false });
const dEst = { uf: 'xx', vagas: 4, validos: 1000, agrs: [
  { id: 'A', nome: 'Partido A', siglas: ['PA'], votos: 560, cands: [cand('a1', 'PA', 300), cand('a2', 'PA', 150), cand('a3', 'PA', 100)] },
  { id: 'B', nome: 'Partido B', siglas: ['PB'], votos: 440, cands: [cand('b1', 'PB', 250), cand('b2', 'PB', 160), cand('b3', 'PB', 30)] }] };
const baseE = { unidades: [{ id: 'm:w', mun: 'w', zonas: ['1'], aptos: 500, x: 0, y: 0, area: 1 }, { id: 'm:e', mun: 'e', zonas: ['1'], aptos: 500, x: 10, y: 0, area: 1 }],
  viz: { 'm:w': new Set(['m:e']), 'm:e': new Set(['m:w']) } };
const desE = SD.sdDistritar(baseE, 2);
// A lidera o oeste (a1 na frente); no leste, B lidera como agremiação e b1 é o mais votado.
const votos = { 'w|1': { c: { a1: 200, a2: 100, b1: 50, b2: 40 }, l: { PA: 10 } }, 'e|1': { c: { a1: 100, a3: 100, b1: 200, b2: 120, b3: 30 }, l: { PB: 0 } } };
const vd = SD.sdVotosDistritos(dEst, desE, baseE, votos);
const oeste = vd.find(x => x.porCand.a2), leste = vd.find(x => x.porCand.a3);
ok(oeste.validos === 400 && oeste.porAgr.A === 310 && leste.porAgr.B === 350 && leste.porCand.a1 === 100, 'votos de cada distrito: por candidato e por agremiação (com legenda)');
const rp = SD.sdDistritalMisto(dEst, { regra: 'partido', modelo: 'paralelo', desenho: desE, base: baseE, votos });
const venc = rp.distritos.map(x => x.vencedor.nome).sort().join();
ok(rp.nDistritos === 2 && venc === 'C' + 'a1,C' + 'b1', 'regra do partido: a agremiação mais votada no distrito leva, com o seu mais votado ali');
ok(rp.eleitos.length === 4 && rp.eleitos.filter(x => x.fase === 'lista').length === 2, 'as outras vagas vão pela lista');
const rc = SD.sdDistritalMisto(dEst, { regra: 'candidato', modelo: 'paralelo', desenho: desE, base: baseE, votos });
ok(rc.distritos.map(x => x.vencedor.nome).sort().join() === 'C' + 'a1,C' + 'b1' && new Set(rc.eleitos.map(x => x.sq)).size === 4,
  'regra do candidato: o mais votado do distrito; quem já ganhou um distrito não ganha outro');
const rcomp = SD.sdDistritalMisto(dEst, { regra: 'partido', modelo: 'compensatorio', desenho: desE, base: baseE, votos });
const conta = r => { const o = {}; for (const x of r.eleitos) o[x.agr] = (o[x.agr] || 0) + 1; return JSON.stringify(o); };
ok(conta(rcomp) === '{"A":2,"B":2}' && rcomp.eleitos.length === 4, 'compensatório: o total segue a proporção da votação');
ok(rp.distritos.every(x => x.segundo && x.segundo.agr !== x.vencedor.agr && x.vencedor.agrPct > 0), 'segundo colocado (agremiação) e a fatia do vencedor no distrito');

console.log('Peso pela população (Censo 2022)');
ok(SD.sdUrlPopulacao(35) === 'https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=' + encodeURIComponent('N6[N3[35]]'), 'endereço do agregado 4709 (população residente), municípios da UF');
const popJ = [{ id: '93', resultados: [{ series: [{ localidade: { id: '1' }, serie: { 2022: '1000' } }, { localidade: { id: '2' }, serie: { 2022: '6000' } }, { localidade: { id: '9' }, serie: { 2022: '-' } }] }] }];
const pop = SD.sdLerPopulacao(popJ);
ok(pop['1'] === 1000 && pop['2'] === 6000 && !('9' in pop), 'leitura da resposta do IBGE');
const pp = SD.sdPesoPopulacao(geo, pop, (cd) => ({ 1: '1', 2: '2', 3: null, 4: null })[cd]);
const z = pp.geo.mun['2'].zonas;
ok(pp.geo.mun['1'].zonas['1'].aptos === 1000 && z['2'].aptos === 2000 && z['3'].aptos === 2000 && z['4'].aptos === 2000 && z['3'].la === 0.8, 'município com a sua população; zonas pela proporção de eleitores; posições preservadas');
ok(Math.abs(pp.geo.mun['3'].zonas['5'].aptos - 100 * 7000 / 1000) < 1e-9 && pp.semPopulacao.join() === 'C,D' && pp.geo.votos === geo.votos && geo.mun['1'].zonas['1'].aptos === 100,
  'sem par no IBGE: eleitores × razão do estado (avisado); votos iguais; o original intocado');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
