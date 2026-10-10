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
// município criado depois do censo (D saiu de B): a estimativa de D sai da população de B
const pd = SD.sdPesoPopulacao(geo, pop, (cd) => ({ 1: '1', 2: '2', 3: null, 4: null })[cd], { 'D': 'B' });
const somaB = Object.values(pd.geo.mun['2'].zonas).reduce((t, z) => t + z.aptos, 0), estD = Object.values(pd.geo.mun['4'].zonas).reduce((t, z) => t + z.aptos, 0);
ok(perto(somaB + estD, 6000) && estD > 0 && pd.descontos.length === 1 && pd.descontos[0].de === 'B' && pd.descontos[0].para === 'D',
  'município novo: a estimativa dele sai do de origem (sem contar a população duas vezes)');
ok(SD.SD_DESMEMBRADOS.MT && SD.SD_DESMEMBRADOS.MT['BOA ESPERANCA DO NORTE'] === 'SORRISO', 'Boa Esperança do Norte (MT) saiu de Sorriso');

console.log('Regras do PL 9.212/2017 (Senado)');
ok(SD.sdNumeroDistritos(9, 0.5) === 5 && SD.sdNumeroDistritos(9, 0.5, 'baixo') === 4 && SD.sdNumeroDistritos(70, 0.5, 'baixo') === 35 && SD.sdNumeroDistritos(8, 0.5, 'baixo') === 4,
  'número de distritos: arredondado (9 → 5) ou a parte inteira da metade, como no projeto (9 → 4)');
ok(SD.sdNumeroDistritos(10, 0.3, 'baixo') === 3 && SD.sdNumeroDistritos(10, 0.7, 'baixo') === 7, 'parte inteira sem erro de ponto flutuante');
const dv = xs => xs.map(desvio => ({ desvio }));
const t1 = SD.sdToleranciaSenado(dv([0.04, -0.05, 0.02, -0.01]));
ok(t1.ok && t1.ate5 === 4 && t1.permitidos === 1, 'todos até ±5%: dentro');
const t2 = SD.sdToleranciaSenado(dv([0.08, -0.03, 0.01, 0]));
ok(t2.ok && t2.entre5e10 === 1, 'um distrito entre 5% e 10%: permitido (até 1 ou 10% deles)');
const t3 = SD.sdToleranciaSenado(dv([0.08, -0.07, 0.01, 0]));
ok(!t3.ok && t3.entre5e10 === 2, 'dois entre 5% e 10% em 4 distritos: fora');
const t4 = SD.sdToleranciaSenado(dv(Array.from({ length: 35 }, (_, i) => i < 3 ? 0.09 : 0.01)));
ok(t4.ok && t4.permitidos === 3, '35 distritos: até 3 (10%, parte inteira) entre 5% e 10%');
const t5 = SD.sdToleranciaSenado(dv([0.11, 0, 0, 0]));
ok(!t5.ok && t5.acima10 === 1, 'acima de 10%: fora');

console.log('Tolerância ajustável (PL 9.213 e substitutivo da CCJ: eleitores, ±10%)');
const c1 = SD.sdTolerancia(dv([0.09, -0.1, 0.02]), SD.SD_TOL_CCJ);
ok(c1.ok && c1.dentro === 3 && c1.permitidos === 0, '±10% sem exceção: todos até 10% cabem');
const c2 = SD.sdTolerancia(dv([0.11, 0, 0]), SD.SD_TOL_CCJ);
ok(!c2.ok && c2.fora === 1, '±10% sem exceção: acima de 10% fica fora');
const c3 = SD.sdTolerancia(dv([0.07, 0.12, 0, 0, 0]), { pct: 0.08, exc: 0.15, excN: 1, excFrac: 0 });
ok(c3.ok && c3.excecao === 1 && c3.permitidos === 1, 'tolerância qualquer: ±8%, ±15% em 1 distrito');
const c4 = SD.sdTolerancia(dv([0.04, 0.08]), SD.SD_TOL_SENADO), c4b = SD.sdToleranciaSenado(dv([0.04, 0.08]));
ok(c4.ok === c4b.ok && c4b.entre5e10 === c4.excecao && c4b.ate5 === c4.dentro, 'a do Senado é um caso da genérica (mesmos números)');
// desenho até a tolerância: entre as tentativas que cabem, a mais compacta (troca desvio por forma)
const g8 = grade(8, (i, j) => 100 + ((i * 7 + j * 13) % 11) * 40 + (j < 2 ? 300 : 0));
const justo = SD.sdDistritar(g8, 5), solto = SD.sdDistritar(g8, 5, { tol: { pct: 0.15, exc: 0 }, ateTol: true });
ok(SD.sdTolerancia(solto.distritos, { pct: 0.15, exc: 0 }).ok && solto.metricas.contiguos && solto.metricas.desvioMax > justo.metricas.desvioMax
  && solto.metricas.compacidadeMedia > justo.metricas.compacidadeMedia,
  `desenho até ±15%: cabe, mais compacto (${justo.metricas.compacidadeMedia.toFixed(2)} → ${solto.metricas.compacidadeMedia.toFixed(2)}) com mais desvio (${(justo.metricas.desvioMax * 100).toFixed(1)}% → ${(solto.metricas.desvioMax * 100).toFixed(1)}%)`);
ok(SD.sdDistritar(g8, 5, { tol: { pct: 0.15, exc: 0 } }).metricas.desvioMax === justo.metricas.desvioMax, 'só conferir: o desenho não muda');

console.log('Locais de votação (para afinar o desenho)');
ok(SD.sdUrlSecao(2026, 'rr') === 'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2026_RR.zip', 'endereço da votação por seção do estado');
const rep = SD.sdReparte(10, [1, 1, 1]);
ok(rep.join() === '4,3,3' && SD.sdReparte(7, [0, 0]).reduce((a, b) => a + b) === 7 && SD.sdReparte(5, [3, 1]).join() === '4,1', 'repartição inteira pelos maiores restos (sem peso: por igual)');
const LL = SD.sdLeitorLocais('rr', '6');
const hl = '"DT_GERACAO";"NR_TURNO";"SG_UF";"CD_MUNICIPIO";"NR_ZONA";"NR_SECAO";"NR_LOCAL_VOTACAO";"NR_LATITUDE";"NR_LONGITUDE";"QT_ELEITOR_SECAO";"NR_LOCAL_VOTACAO_ORIGINAL"';
LL.locais.linha(hl);
for (const l of ['"x";1;"RR";"03018";1;10;2445;"2,8";"-60,6";100;2445', '"x";1;"RR";"03018";1;11;2445;"2,8";"-60,6";50;2445', '"x";2;"RR";"03018";1;10;2445;"2,8";"-60,6";100;2445',
  '"x";1;"RR";"03018";1;12;3824;"-1";"-1";80;2208', '"x";1;"AM";"02000";1;12;1;"-3";"-60";80;1']) LL.locais.linha(l);
const hs = '"DT_GERACAO";"NR_TURNO";"SG_UF";"CD_MUNICIPIO";"NR_ZONA";"NR_SECAO";"CD_CARGO";"NR_VOTAVEL";"QT_VOTOS";"NR_LOCAL_VOTACAO";"SQ_CANDIDATO"';
LL.secao.linha(hs);
for (const l of ['"x";1;"RR";3018;1;10;6;2200;30;2445;111', '"x";1;"RR";3018;1;11;6;2200;10;2445;111', '"x";1;"RR";3018;1;10;6;22;5;2445;-3', '"x";1;"RR";3018;1;10;6;95;7;2445;-1',
  '"x";1;"RR";3018;1;12;6;2200;20;2208;111', '"x";1;"RR";3018;1;12;7;22000;9;2208;222', '"x";2;"RR";3018;1;12;6;2200;99;2208;111']) LL.secao.linha(l);
const lido = LL.resultado();
const l1 = lido.locais['3018|1'];
ok(l1['2445'].aptos === 150 && perto(l1['2445'].la, 2.8) && l1['3824'].aptos === 80 && l1['3824'].la == null && !lido.locais['2000|1'], 'locais: eleitores do 1º turno, posição; sem coordenada fica sem posição; só o estado pedido');
ok(lido.votos['3018|1|2445'].c['111'] === 40 && lido.votos['3018|1|2445'].n['22'] === 5 && !lido.votos['3018|1|2445'].n['95'] && lido.prefixo['111'] === '22', 'votos por local: candidato, legenda pelo nº do partido; branco e nulo fora; só o cargo e o 1º turno');
ok(lido.votos['3018|1|3824'] && lido.votos['3018|1|3824'].c['111'] === 20 && !lido.votos['3018|1|2208'], 'local que mudou de número: os votos vão para o número de hoje');
const vzL = { '3018|1': { c: { 111: 61, 333: 9 }, l: { PX: 11 } } };
const vlL = SD.sdVotosLocais(vzL, lido, nr => (nr === '22' ? 'PX' : null));
ok(vlL['3018|1|2445'].c['111'] + vlL['3018|1|3824'].c['111'] === 61 && vlL['3018|1|2445'].c['111'] === 41, 'o total da zona (só válidos) se reparte pelos votos de cada local na votação por seção');
ok((vlL['3018|1|2445'].c['333'] || 0) + (vlL['3018|1|3824'].c['333'] || 0) === 9 && vlL['3018|1|2445'].c['333'] === 6, 'sem voto na seção: pela proporção dos eleitores');
ok(vlL['3018|1|2445'].l.PX === 11 && !vlL['3018|1|3824'].l.PX, 'legenda: pelo número do partido convertido em sigla');
// Afinação: zona A (800, à esquerda) e zona B (200, à direita), um distrito cada; A tem 8 locais de 100.
const baseL = { unidades: [{ id: 'z:1:1', mun: '1', zonas: ['1'], nome: 'M · zona 1', aptos: 800, x: 0, y: 0, area: 8, ibge: 'M' }, { id: 'z:1:2', mun: '1', zonas: ['2'], nome: 'M · zona 2', aptos: 200, x: 10, y: 0, area: 2, ibge: 'M' }],
  viz: { 'z:1:1': new Set(['z:1:2']), 'z:1:2': new Set(['z:1:1']) }, proj: p => [p[0], p[1]] };
const desL = SD.sdDistritar(baseL, 2);
const locaisL = { '1|1': Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1), { aptos: 50, la: 0, lo: i - 3 }])), '1|2': { 9: { aptos: 30, la: 0, lo: 9 }, 10: { aptos: 30, la: 0, lo: 11 } } };
ok(desL.metricas.desvioMax > 0.5, 'antes: as zonas são grandes demais (desvio de 60%)');
const rL = SD.sdRefinarLocais(baseL, desL, locaisL);
ok(rL && rL.desenho.metricas.desvioMax === 0 && rL.desenho.metricas.contiguos && rL.desenho.metricas.locais === 10, 'com os locais: desvio zero, contíguos');
const doB = rL.desenho.distritos.find(d => d.unidades.includes('l:1:2:9'));
ok(doB.unidades.filter(i => i.startsWith('l:1:1:')).sort().join() === 'l:1:1:6,l:1:1:7,l:1:1:8', 'passam os locais da zona A do lado da zona B');
ok(rL.base.unidades.every(u => u.loc && perto(u.aptos, u.id.startsWith('l:1:1:') ? 100 : 100)) && rL.desenho.locais, 'cada local com a sua fatia do peso da zona');
ok(SD.sdRefinarLocais(baseL, desL, {}) === null, 'sem locais: nada a afinar');
const vdL = SD.sdVotosDistritos({ agrs: [{ id: 'X', siglas: ['PX'], cands: [{ sq: '111', valido: true }] }] }, rL.desenho, rL.base,
  Object.fromEntries(Object.keys(locaisL).flatMap(kz => Object.keys(locaisL[kz]).map(l => [kz + '|' + l, { c: { 111: 1 }, l: {} }]))));
ok(vdL.map(x => x.validos).sort().join() === '5,5', 'votos do distrito somam os locais');

console.log('Segundo voto (cenário)');
const dSV = { agrs: [
  { id: 'A', siglas: ['PA'], cands: [{ sq: 'a1' }, { sq: 'a2' }] }, { id: 'B', siglas: ['PB'], cands: [{ sq: 'b1' }] },
  { id: 'C', siglas: ['PC'], cands: [{ sq: 'c1' }] }, { id: 'F', siglas: ['PX', 'PY'], cands: [{ sq: 'f1' }] }] };
const vdSV = [{ id: 1, validos: 1000, porAgr: { A: 400, B: 300, C: 200, F: 100 }, porCand: { a1: 300, a2: 80, b1: 290, c1: 190, f1: 95 } }];
ok(SD.sdSegundoVoto(vdSV, dSV, {}) === vdSV, 'desligado: os votos do distrito ficam como estão');
const u = SD.sdSegundoVoto(vdSV, dSV, { votoUtil: 0.5 })[0];
ok(u.porAgr.C === 100 && u.porAgr.F === 50 && u.porAgr.A === 475 && u.porAgr.B === 375 && u.validos === 1000,
  'voto útil 50%: metade dos votos das de fora dos dois primeiros vai para eles, meio a meio');
ok(u.porCand.a1 === 375 && u.porCand.a2 === 80 && u.porCand.c1 === 95 && vdSV[0].porAgr.C === 200, 'o voto vai para o candidato mais votado da agremiação; o original intocado');
const ua = SD.sdSegundoVoto(vdSV, dSV, { votoUtil: 0.5, aliancas: [['PC', 'PB']] })[0];
ok(ua.porAgr.B === 525 && ua.porAgr.A === 425 && ua.porAgr.C === 0, 'com aliança e voto útil: a aliada concorre junto (e o voto útil das outras segue meio a meio)');
const vd4 = [{ id: 1, validos: 1000, porAgr: { A: 360, B: 340, C: 300 }, porCand: { a1: 360, b1: 340, c1: 300 } }];
const ub = SD.sdSegundoVoto(vd4, dSV, { votoUtil: 1, aliancas: [['PC', 'PB']] })[0];
ok(ub.porAgr.B === 640 && ub.porAgr.A === 360, 'voto útil de quem tem aliada entre as duas primeiras vai todo para ela');
const al = SD.sdSegundoVoto(vdSV, dSV, { aliancas: [['PB', 'PC']] })[0];
ok(al.porAgr.B === 500 && al.porAgr.C === 0 && al.porCand.b1 === 490 && !('c1' in al.porCand), 'aliança: a mais votada no distrito concorre com os votos da aliada, que não lança candidato');
const al2 = SD.sdSegundoVoto(vdSV, dSV, { aliancas: [['PC', 'PY'], ['PB', 'PC']] })[0];
ok(al2.porAgr.B === 600 && al2.porAgr.C === 0 && al2.porAgr.F === 0, 'pares encadeados formam um grupo (federação pela sigla de qualquer partido dela)');
const r2 = SD.sdDistritalMisto(dEst, { regra: 'partido', modelo: 'paralelo', desenho: desE, base: baseE, votos, aliancas: [['PA', 'PB']] });
ok(r2.distritos.every(x => x.vencedor.agr === 'A' || x.vencedor.agr === 'B') && r2.distritos.length === 2, 'o distrital misto usa o segundo voto para escolher quem leva o distrito');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
