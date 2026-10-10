// Sistemas eleitorais — memorial de cálculo: as abas da planilha, as fórmulas e as conferências.
// A planilha refaz cada conta por fórmula; aqui, o valor que acompanha cada fórmula
// (calculado pelo memorial, independente do simulador) tem de conferir com o simulador.
// A conferência com o LibreOffice recalculando as fórmulas foi feita com os dados reais de 2026.
// Uso: node testes/sistemas-memorial.test.js
const path = require('path');
const S = require(path.join(__dirname, '..', 'sistemas-nucleo.js'));
const SD = require(path.join(__dirname, '..', 'sistemas-distrital.js'));
global.snSemFederacao = S.snSemFederacao;
global.snCompletarLista = S.snCompletarLista;
global.sdDistritalMisto = SD.sdDistritalMisto;
const M = require(path.join(__dirname, '..', 'sistemas-memorial.js'));
const XLSX = require(path.join(__dirname, '..', 'libs', 'xlsx.full.min.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

let seq = 0;
const agr = (id, votos, cands, extra = {}) => Object.assign({ id, nome: id, tipo: 'partido', siglas: [id], votos, legenda: votos - cands.reduce((s, v) => s + v, 0),
  porSigla: { [id]: votos }, vagasReal: null, cands: cands.map(v => ({ sq: id + (++seq), n: String(seq), nome: id + seq, partido: id, votos: v, valido: true, eleitoReal: false, situacao: '' })) }, extra);
const uf = (sigla, vagas, agrs) => ({ uf: sigla, cargo: 6, vagas, validos: agrs.reduce((s, a) => s + a.votos, 0), qeTse: 0, agrs });

console.log('Funções básicas');
ok(M.smCol(0) === 'A' && M.smCol(25) === 'Z' && M.smCol(26) === 'AA' && M.smCol(701) === 'ZZ' && M.smRef(2, 7) === 'C7', 'colunas da planilha (A… Z, AA… ZZ)');
ok(M.smQE(1000, 3) === 333 && M.smQE(1000, 6) === 167 && M.smQE(7, 2) === 3, 'QE do art. 106');

// Dois estados: XA (proporcional com as três fases) e XB (mistos com excedente no compensatório).
const xa = uf('xa', 5, [agr('A', 500, [260, 180, 45, 15]), agr('B', 250, [18, 12]), agr('C', 150, [140, 10]), agr('D', 100, [100])]);
const xb = uf('xb', 4, [agr('A', 700, [100, 100, 100, 100, 100, 100, 100]), agr('B', 300, [105, 104, 91])]);
// eleitos oficiais (para a comparação): os do proporcional
for (const d of [xa, xb]) { const p = S.snProporcional(d); for (const x of p.eleitos) x.cand.eleitoReal = true; }
const dados = { xa, xb };
// distrital: cada estado em 2 distritos de 2 unidades (oeste e leste)
const porUf = {};
for (const [sg, d] of Object.entries(dados)) {
  const base = { unidades: [{ id: 'm:w', mun: 'w', zonas: ['1'], nome: 'Oeste', aptos: 500, x: 0, y: 0, area: 1 }, { id: 'm:e', mun: 'e', zonas: ['1'], nome: 'Leste', aptos: 520, x: 10, y: 0, area: 1 }],
    viz: { 'm:w': new Set(['m:e']), 'm:e': new Set(['m:w']) } };
  const desenho = SD.sdDistritar(base, 2);
  const votos = {};
  d.agrs.forEach((a, i) => a.cands.forEach((c, j) => {
    const k = (i + j) % 2 ? 'e|1' : 'w|1';
    (votos[k] = votos[k] || { c: {}, l: {} }).c[c.sq] = c.votos;
  }));
  porUf[sg] = { desenho, base, votos };
}
const sistemas = [
  { id: 'proporcional', nome: 'Proporcional', tipo: 'proporcional', op: {} },
  { id: 'semfed', nome: 'Sem federações', tipo: 'proporcional', op: { federacoes: false } },
  { id: 'distritao', nome: 'Distritão', tipo: 'distritao', op: {} },
  { id: 'mistoP', nome: 'Distritão misto', tipo: 'misto', op: { pctMaisVotados: 0.5, modelo: 'paralelo' } },
  { id: 'mistoC', nome: 'Distritão misto comp.', tipo: 'misto', op: { pctMaisVotados: 0.75, modelo: 'compensatorio' } },
  { id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: { pctDistrital: 0.5, regra: 'partido', modelo: 'compensatorio', limiar: 0, porUf } },
];
const res = S.snSimular(dados, sistemas);
const ind = S.snIndicadores(res, dados);
const memo = M.smMemorial({ dados, res, sistemas, ind, ordem: S.snOrdemPartidos(res), meta: { titulo: 'Teste', eleicao: 'teste', parametros: [['Proporcional', 'regra vigente']] } });
const aba = n => memo.abas.find(a => a.nome === n);
const celulas = a => a.linhas.flat().filter(c => c && typeof c === 'object');

console.log('Abas');
ok(memo.abas.map(a => a.nome).join('|') === 'Leia-me|Estados|Votos|Candidatos|Proporcional|Sem federações|Distritão|Distritão misto|Distritão misto comp.|Distrital misto|Distritos (composição)|Eleitos|Bancadas|Indicadores',
  'leia-me, dados, uma aba por sistema (o distrital com a composição dos distritos), eleitos, bancadas, indicadores');
ok(Object.values(memo.conferencias).every(x => x.nao === 0) && Object.values(memo.conferencias).reduce((s, x) => s + x.n, 0) > 60,
  'todas as conferências batem com o simulador (' + Object.values(memo.conferencias).reduce((s, x) => s + x.n, 0) + ')');

console.log('Fórmulas');
const est = aba('Estados').linhas[1];
ok(est[5].f === 'IF(C2/B2-INT(C2/B2)>0.5,INT(C2/B2)+1,INT(C2/B2))' && est[5].v === 200 && est[3].f === 'SUMIF(Votos!A:A,A2,Votos!G:G)', 'QE do art. 106 por fórmula; válidos = soma das agremiações');
const vt = aba('Votos').linhas[1];
ok(vt[4].f === 'SUMIFS(Candidatos!G:G,Candidatos!A:A,A2,Candidatos!B:B,B2,Candidatos!H:H,"sim")' && vt[4].v === 500 && vt[6].v === 500, 'votos nominais = soma dos candidatos válidos (aba Candidatos)');
const prop = aba('Proporcional');
const qp = celulas(prop).filter(c => /^INT\(B\d+\/\$G\$\d+\)$/.test(c.f));
ok(qp.length === 4 + 2 && qp[0].v === 2, 'QP = INT(votos ÷ QE) de cada agremiação');
const rod = prop.linhas.filter(l => typeof l[0] === 'number' && l.some(c => c && c.f && /^INDEX/.test(c.f)));
ok(rod.length === 4 && rod[0][1] === '80/20' && rod[1][1] === '3ª fase' && rod[2][1] === '3ª fase', 'sobras: uma linha por rodada (2ª fase, 3ª fase), estado a estado');
const r1 = rod[0];
ok(r1[2].f === '$B$6/3' && r1[2].v === 500 / 3 && r1[3] === null && r1[4] === null, 'média = votos ÷ (lugares + 1), só de quem pode disputar (B e C abaixo de 80% ficam em branco)');
const comp = aba('Distritão misto comp.');
ok(celulas(comp).some(c => /^COUNTIF\(F\d+:I\d+,">="&LARGE\(\$F\$\d+:\$I\$\d+,4\)\)$/.test(c.f)) && celulas(comp).some(c => /^\$B\$\d+\/2-\$E\$\d+\*1E-9$/.test(c.f)),
  'compensatório: quociente votos ÷ divisor (com o desempate); alvo = quocientes entre os N maiores (CONT.SE com MAIOR)');
ok(celulas(aba('Distritão misto')).filter(c => /^COUNTIF/.test(c.f)).map(c => c.v).join() === '2,0,0,0,2,0', 'empate na última vaga da lista: leva quem vem antes no arquivo (como no simulador)');
const ajustes = comp.linhas.filter(l => l[1] === 'corta (menor média)');
ok(ajustes.length >= 1 && ajustes.every(l => l[l.length - 1].v === M.SM_SIM), 'excedente: cada corte pela menor média, conferido passo a passo');
ok(celulas(comp).some(c => /-COUNTIFS\(/.test(c.f || '')), 'lista depois dos ajustes = lista − cortes (+ acréscimos), por fórmula');
const dist = aba('Distrital misto');
ok(celulas(dist).some(c => /^SUMIFS\('Distritos \(composição\)'!G:G/.test(c.f)) && aba('Distritos (composição)').linhas.length === 1 + 4, 'distrital: tamanho de cada distrito = soma das suas unidades (aba de composição)');
const ban = aba('Bancadas');
ok(celulas(ban).some(c => c.f === 'COUNTIFS(Eleitos!A:A,"Proporcional",Eleitos!D:D,$A3,Eleitos!H:H,"sim")'), 'bancadas contadas na aba Eleitos');
const indA = aba('Indicadores');
ok(celulas(indA).some(c => /^1\/SUMPRODUCT/.test(c.f)) && celulas(indA).some(c => /^SQRT\(SUM/.test(c.f)), 'número efetivo de partidos e Gallagher por fórmula');
ok(celulas(aba('Leia-me')).some(c => c.f === `COUNTIF(Proporcional!A:ZZ,"${M.SM_NAO}")`), 'leia-me: quantas conferências deram ' + M.SM_NAO + ', por aba (recalculado)');

console.log('Excedente e divisor no memorial');
for (const [excedente, extra] of [['cresce', {}], ['compensa', {}], ['compensa', { tetoExtra: 0.25 }], ['naoLeva', {}], ['corta', { divisor: 'sl' }], ['cresce', { divisor: 'sl' }]]) {
  const ss = [{ id: 'mistoC', nome: 'Distritão misto comp.', tipo: 'misto', op: Object.assign({ pctMaisVotados: 0.75, modelo: 'compensatorio', excedente }, extra) },
    { id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: Object.assign({ pctDistrital: 0.5, regra: 'partido', modelo: 'compensatorio', limiar: 0, porUf, excedente }, extra) }];
  const rr = S.snSimular(dados, ss);
  const mm = M.smMemorial({ dados, res: rr, sistemas: ss, ind: S.snIndicadores(rr, dados), ordem: S.snOrdemPartidos(rr), meta: { titulo: 'Teste', eleicao: 'teste', parametros: [] } });
  const n = Object.values(mm.conferencias).reduce((t, x) => t + x.n, 0), nao = Object.values(mm.conferencias).reduce((t, x) => t + x.nao, 0);
  const casa = rr.sims.map(x => x.total).join('/');
  ok(nao === 0 && n > 20, `${excedente}${extra.divisor ? ' + Sainte-Laguë' : ''}${extra.tetoExtra ? ' + teto' : ''}: as ${n} conferências batem (Casa ${casa})`);
}
const ssl = [Object.assign({}, sistemas[4], { op: Object.assign({}, sistemas[4].op, { divisor: 'sl' }) })], rsl = S.snSimular(dados, ssl);
const msl = M.smMemorial({ dados, res: rsl, sistemas: ssl, ind: S.snIndicadores(rsl, dados), ordem: S.snOrdemPartidos(rsl), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
ok(celulas(msl.abas.find(x => x.nome === 'Distritão misto comp.')).some(c => /^\$B\$\d+\/3-\$E\$\d+\*1E-9$/.test(c.f || '')), 'Sainte-Laguë: quociente votos ÷ 3 na 2ª coluna');

console.log('Planilha (SheetJS)');
const wb = M.smParaXlsx(XLSX, memo);
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const lido = XLSX.read(buf, { type: 'buffer', cellFormula: true });
ok(lido.SheetNames.length === memo.abas.length && lido.Sheets.Estados.F2.f === 'IF(C2/B2-INT(C2/B2)>0.5,INT(C2/B2)+1,INT(C2/B2))' && lido.Sheets.Estados.F2.v === 200,
  'xlsx com as fórmulas e os valores calculados');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
