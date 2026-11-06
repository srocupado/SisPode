'use strict';
// Perfil dos distritos (distrital misto): o núcleo (sistemas-perfil.js) e as
// peças do gerador (sistemas/perfil/gerar-perfil.js) que não dependem da rede.
// Usa o arquivo gerado do DF (sistemas/perfil/perfil-2026-DF.json): totais
// conferidos contra as fontes — 2.253.132 eleitores no perfil do TSE e
// 2.817.381 habitantes no Censo 2022 (o número oficial do DF).
const fs = require('fs');
const path = require('path');
const S = require('../sistemas-perfil.js');
const G = require('../sistemas/perfil/gerar-perfil.js');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const perto = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log('\n== arquivo do DF: totais das fontes ==');
const doc = JSON.parse(fs.readFileSync(process.env.PERFIL_DF || path.join(__dirname, '..', 'sistemas', 'perfil', 'perfil-2026-DF.json'), 'utf8'));
const P = S.spIndice(doc);
const tot = P.mun.get('97012');
ok(P.mun.size === 1 && tot, 'DF: um município (Brasília, código TSE 97012)');
ok(tot[P.i.eleitores] === 2253132, `eleitores no perfil do TSE = 2.253.132 (${tot[P.i.eleitores]})`);
ok(tot[P.i.pop] === 2817381, `população do Censo 2022 = 2.817.381, a oficial (${tot[P.i.pop]})`);
ok(doc.validacao.eleitoresSemLocal === 0 && doc.validacao.popSemLocal === 0, 'nenhum eleitor nem habitante sem local de votação');
ok(P.zona.size === 19, `19 zonas eleitorais (${P.zona.size})`);
const somaZonas = [...P.zona.values()].reduce((s, v) => s + v[P.i.pop], 0);
ok(somaZonas === tot[P.i.pop], 'a soma das zonas = o município (nada se perde na atribuição)');

console.log('\n== indicadores ==');
const sup = S.spValor(P, tot, 'superior'), neg = S.spValor(P, tot, 'negros'), esg = S.spValor(P, tot, 'esgoto');
ok(sup > 0.2 && sup < 0.27, `superior completo no DF ≈ 23% (${(100 * sup).toFixed(1)}%)`);
ok(neg > 0.55 && neg < 0.63, `pretos e pardos no DF ≈ 59% (${(100 * neg).toFixed(1)}%)`);
ok(esg > 0.8 && esg < 0.92, `domicílios com esgoto na rede ≈ 86% (${(100 * esg).toFixed(1)}%)`);
const z1 = P.zona.get('97012|1'), z21 = P.zona.get('97012|21');
ok(S.spValor(P, z1, 'superior') > 0.5 && S.spValor(P, z21, 'superior') < 0.1, 'zona 1 (central) > 50% com superior; zona 21 < 10%');
ok(S.SP_IND.every(i => i.fonte === 'tse' || i.fonte === 'censo'), 'cada indicador declara a fonte');
ok(!S.SP_IND.some(i => /sexo|mulher|estado civil/i.test(i.nome)), 'sem sexo e sem estado civil do eleitorado (não distinguem distritos)');

console.log('\n== unidades e distritos ==');
const zonas = [...P.zona.keys()].map(k => k.split('|')[1]);
const locais = [...P.loc.keys()].filter(k => k.startsWith('97012|1|'));
// Município dividido vira só unidades de zona (e de local): nunca 'm:' parcial.
const outras = zonas.filter(z => z !== '1' && z !== '21');
const base = { unidades: [
  ...outras.map(z => ({ id: 'z:97012:' + z, mun: '97012', zonas: [z] })),
  { id: 'z:97012:21', mun: '97012', zonas: ['21'] },
  ...locais.map(k => ({ id: 'l:' + k.replace(/\|/g, ':'), mun: '97012', zonas: ['1'], loc: k.split('|')[2] })),
] };
const uZ21 = base.unidades.find(u => u.id === 'z:97012:21'), uLocs = base.unidades.filter(u => u.id.startsWith('l:'));
ok(S.spUnidade(P, uZ21)[P.i.pop] === z21[P.i.pop], "unidade 'z:' = a zona");
ok(S.spUnidade(P, uLocs[0]) === P.loc.get(locais[0]), "unidade 'l:' = o local de votação");
ok(S.spUnidade(P, { id: 'm:97012', mun: '97012', zonas: [] })[P.i.pop] === tot[P.i.pop], "unidade 'm:' = o município inteiro");
const desenho = { distritos: [
  { id: 1, unidades: outras.map(z => 'z:97012:' + z) },
  { id: 2, unidades: ['z:97012:21', ...uLocs.map(u => u.id)] },
] };
const perf = S.spDistritos(P, base, desenho);
ok(perf[1][P.i.pop] + perf[2][P.i.pop] === tot[P.i.pop], 'os distritos somam o estado inteiro');
ok(perto(perf[2][P.i.eleitores], z21[P.i.eleitores] + P.zona.get('97012|1')[P.i.eleitores]), 'distrito 2 = zona 21 + os locais da zona 1');

console.log('\n== terços, quantis, eleitos ==');
const ds = [...P.zona.keys()].map((k, j) => ({ id: k, partido: ['PL', 'PT', 'PODE'][j % 3] }));
const t = S.spTercos(P, ds, Object.fromEntries(P.zona), 'superior');
ok(t && t.tercos.length === 3 && t.tercos.reduce((s, g) => s + g.n, 0) === 19, 'terços cobrem os 19 distritos');
ok(t.tercos[0].max <= t.tercos[1].min && t.tercos[1].max <= t.tercos[2].min, 'terços em ordem, sem sobreposição');
const q = S.spQuantis([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
ok(q.length === 4 && S.spClasse(1, q) === 0 && S.spClasse(10, q) === 4 && S.spClasse(null, q) === -1, 'quintis: 5 faixas, nulo fora');
const cad = { cand: { 1: ['F', 'parda', 40, 7], 2: ['M', 'branca', 60, 5], 3: ['M', 'preta', 50, 7] } };
const e = S.spPerfilEleitos(cad, [1, 2, 3, 99]);
ok(e.n === 3 && e.mulheres === 1 && e.negros === 2 && e.superior === 2 && e.idadeMedia === 50 && e.semCadastro === 1, 'perfil dos eleitos pelo cadastro (e quem falta no cadastro)');

console.log('\n== gerador: geometria e leitura ==');
// GeoPackage: cabeçalho 'GP', versão 0, flags (little endian, sem envelope), srs 4674; WKB Polygon de um quadrado 0..2
const wkb = Buffer.alloc(1 + 4 + 4 + 4 + 5 * 16);
let o = 0; wkb[o++] = 1; wkb.writeUInt32LE(3, o); o += 4; wkb.writeUInt32LE(1, o); o += 4; wkb.writeUInt32LE(5, o); o += 4;
for (const [x, y] of [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]) { wkb.writeDoubleLE(x, o); o += 8; wkb.writeDoubleLE(y, o); o += 8; }
const gp = Buffer.concat([Buffer.from([0x47, 0x50, 0, 1]), Buffer.from([0x42, 0x12, 0, 0]), wkb]);
const c = G.centroGpkg(gp);
ok(c && perto(c[0], 1, 1e-9) && perto(c[1], 1, 1e-9), `centro do quadrado 0..2 = (1, 1) → (${c && c.join(', ')})`);
ok(G.campoIdade('16 anos') === 'id16a24' && G.campoIdade('60 a 64 anos') === 'id60a69' && G.campoIdade('100 anos ou mais') === 'id70mais' && G.campoIdade('Inválido') === 'idNaoInf', 'faixas de idade do TSE');
ok(G.ESC.find(([re]) => re.test('ENSINO FUNDAMENTAL INCOMPLETO'))[1] === 'escFundInc' && G.ESC.find(([re]) => re.test('SUPERIOR COMPLETO'))[1] === 'escSupComp'
  && G.ESC.find(([re]) => re.test('SUPERIOR INCOMPLETO'))[1] === 'escSupInc', 'escolaridade: incompleto não vira completo');
ok(G.num('X') === 0 && G.num('1234') === 1234 && G.numDec('0,5393102') === 0.5393102, 'números: sigilo (X) = 0; decimal com vírgula');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nTudo passou.');
