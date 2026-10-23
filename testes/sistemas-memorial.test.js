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
  { id: 'mistoP', nome: 'Distritão misto', tipo: 'misto', op: { pctMaisVotados: 0.5, modelo: 'paralelo' } },
  { id: 'mistoC', nome: 'Distritão misto comp.', tipo: 'misto', op: { pctMaisVotados: 0.75, modelo: 'compensatorio' } },
  // 2 distritos em cada estado: com 5 vagas (XA), 50% pela parte inteira
  { id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: { pctDistrital: 0.5, arred: 'baixo', regra: 'partido', modelo: 'compensatorio', limiar: 0, porUf } },
];
const res = S.snSimular(dados, sistemas);
const ind = S.snIndicadores(res, dados);
const memo = M.smMemorial({ dados, res, sistemas, ind, ordem: S.snOrdemPartidos(res), meta: { titulo: 'Teste', eleicao: 'teste', parametros: [['Proporcional', 'regra vigente']] } });
const aba = n => memo.abas.find(a => a.nome === n);
const celulas = a => a.linhas.flat().filter(c => c && typeof c === 'object');

console.log('Abas');
ok(memo.abas.map(a => a.nome).join('|') === 'Leia-me|Estados|Votos|Candidatos|Proporcional|Sem federações|Distritão misto|Distritão misto comp.|Distrital misto|Distritos (composição)|Eleitos|Bancadas|Indicadores',
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
ok(celulas(comp).some(c => /^SUMPRODUCT\(\(F\d+:I\d+>=LARGE\(\$F\$\d+:\$I\$\d+,4\)\)\*1\)$/.test(c.f)) && celulas(comp).some(c => /^\$B\$\d+\/2-\$E\$\d+\*1E-9$/.test(c.f)),
  'compensatório: quociente votos ÷ divisor (com o desempate); alvo = quocientes entre os N maiores (SOMARPRODUTO com MAIOR)');
ok(celulas(aba('Distritão misto')).filter(c => /^SUMPRODUCT/.test(c.f)).map(c => c.v).join() === '2,0,0,0,2,0', 'empate na última vaga da lista: leva quem vem antes no arquivo (como no simulador)');
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
    { id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: Object.assign({ pctDistrital: 0.5, arred: 'baixo', regra: 'partido', modelo: 'compensatorio', limiar: 0, porUf, excedente }, extra) }];
  const rr = S.snSimular(dados, ss);
  const mm = M.smMemorial({ dados, res: rr, sistemas: ss, ind: S.snIndicadores(rr, dados), ordem: S.snOrdemPartidos(rr), meta: { titulo: 'Teste', eleicao: 'teste', parametros: [] } });
  const n = Object.values(mm.conferencias).reduce((t, x) => t + x.n, 0), nao = Object.values(mm.conferencias).reduce((t, x) => t + x.nao, 0);
  const casa = rr.sims.map(x => x.total).join('/');
  ok(nao === 0 && n > 20, `${excedente}${extra.divisor ? ' + Sainte-Laguë' : ''}${extra.tetoExtra ? ' + teto' : ''}: as ${n} conferências batem (Casa ${casa})`);
}
console.log('Distrital misto com voto partidário líquido no memorial');
{
  const ssL = [{ id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: { pctDistrital: 0.5, arred: 'baixo', regra: 'partido', modelo: 'compensatorio', limiar: 0, porUf, votoLiquido: true } }];
  const rL = S.snSimular(dados, ssL);
  const mL = M.smMemorial({ dados, res: rL, sistemas: ssL, ind: S.snIndicadores(rL, dados), ordem: S.snOrdemPartidos(rL), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
  const cL = mL.conferencias['Distrital misto'], abaL = mL.abas.find(x => x.nome === 'Distrital misto');
  const cel = abaL.linhas.flat().filter(c => c && typeof c === 'object' && c.f);
  ok(cL.nao === 0 && cL.n > 5, `as ${cL.n} conferências do distrital com voto líquido batem`);
  ok(abaL.linhas.some(l => /^Voto partidário líquido = votos da agremiação − votos que elegeram/.test(l[0] || '')) && cel.some(c => /^N\d+(\+N\d+)*$/.test(c.f)),
    'voto líquido do distrital por fórmula: votos da agremiação menos os votos dos seus vencedores (coluna N de cada distrito)');
  // com aliança no distrito e cláusula: a coluna N traz os votos da aliada, o desconto vale só os do vencedor
  const sg = [...new Set(Object.values(dados).flatMap(d => d.agrs.map(a => a.siglas[0])))].slice(0, 2);
  const ssA = [{ id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: { pctDistrital: 0.5, arred: 'baixo', regra: 'partido', modelo: 'compensatorio', limiar: 0.05, porUf, votoLiquido: true, aliancas: [sg] } }];
  const rA = S.snSimular(dados, ssA);
  const mA = M.smMemorial({ dados, res: rA, sistemas: ssA, ind: S.snIndicadores(rA, dados), ordem: S.snOrdemPartidos(rA), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
  const cA = mA.conferencias['Distrital misto'], celA = mA.abas.find(x => x.nome === 'Distrital misto').linhas.flat().filter(c => c && typeof c === 'object' && c.f);
  ok(cA.nao === 0 && cA.n > 5 && !celA.some(c => /^N\d+(\+N\d+)*$/.test(c.f)), `com aliança (${sg.join(' + ')}) e cláusula: as ${cA.n} conferências batem, e o desconto usa os votos do próprio vencedor, não a coluna N`);
}
const ssl = [Object.assign({}, sistemas.find(x => x.id === 'mistoC'), { op: Object.assign({}, sistemas.find(x => x.id === 'mistoC').op, { divisor: 'sl' }) })], rsl = S.snSimular(dados, ssl);
const msl = M.smMemorial({ dados, res: rsl, sistemas: ssl, ind: S.snIndicadores(rsl, dados), ordem: S.snOrdemPartidos(rsl), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
ok(celulas(msl.abas.find(x => x.nome === 'Distritão misto comp.')).some(c => /^\$B\$\d+\/3-\$E\$\d+\*1E-9$/.test(c.f || '')), 'Sainte-Laguë: quociente votos ÷ 3 na 2ª coluna');

console.log('Estratégia: tolerância, próxima cadeira, distritos ao alcance, federação');
const dis = aba('Distrital misto');
ok(celulas(dis).some(c => /^IF\(ABS\(E\d+\)<=0\.05\+1E-9,"dentro",IF\(ABS\(E\d+\)<=0\.1\+1E-9,"exceção","fora"\)\)$/.test(c.f || ''))
  && celulas(dis).some(c => /^MAX\(1,INT\(0\.1\*\$E\$\d+\+1E-9\)\)$/.test(c.f || '')), 'tolerância: cada distrito (dentro/exceção/fora) e o estado contra as exceções permitidas, por fórmula');
global.snMargem = S.snMargem; global.snProporcional = S.snProporcional; global.snDhondt = S.snDhondt;
for (const foco of ['B', 'C', 'D']) {
  const sF = sistemas.slice(), dados2 = S.snFederar(dados, foco, 'A'), res2 = S.snSimular(dados2, sF);
  const me = M.smMemorial({ dados, res, sistemas: sF, ind, ordem: S.snOrdemPartidos(res), meta: { titulo: 'T', eleicao: 't', parametros: [] }, estrategia: { partido: foco, parceiro: 'A', dados2, res2 } });
  const nomes = me.abas.map(x => x.nome);
  const n = Object.values(me.conferencias).reduce((t2, x) => t2 + x.n, 0), nao = Object.values(me.conferencias).reduce((t2, x) => t2 + x.nao, 0);
  const prox = me.abas.find(x => x.nome === `Próxima cadeira (${foco})`);
  ok(nomes.includes(`Próxima cadeira (${foco})`) && nomes.includes(`Distritos ao alcance (${foco})`) && nomes.includes(`Federação ${foco}+A`) && nao === 0,
    `foco ${foco}: abas da estratégia e ${n} conferências, todas batem`);
  ok(celulas(prox).some(c => /^SUMPRODUCT\(\(\$D\$\d+:\$\w+\$\d+>=LARGE\(/.test(c.f || '')) && celulas(prox).some(c => /^IF\(B\d+-E\d+<1,"—",INT\(\(LARGE\(/.test(c.f || '')),
    'próxima cadeira: cota, faltam e folga por fórmula (LARGE na tabela de quocientes)');
}
const meSL = M.smMemorial({ dados, res: S.snSimular(dados, sistemas.map(x => x.tipo === 'distrital' ? Object.assign({}, x, { op: Object.assign({}, x.op, { divisor: 'sl' }) }) : x)),
  sistemas: sistemas.map(x => x.tipo === 'distrital' ? Object.assign({}, x, { op: Object.assign({}, x.op, { divisor: 'sl' }) }) : x), ind, ordem: [], meta: { titulo: 'T', eleicao: 't', parametros: [] }, estrategia: { partido: 'C' } });
ok(Object.values(meSL.conferencias).every(x => x.nao === 0) && celulas(meSL.abas.find(x => x.nome === 'Próxima cadeira (C)')).some(c => /\(2\*\(E\d+\+1\)-1\)/.test(c.f || '')), 'com Sainte-Laguë: o divisor da próxima cadeira é 2 × (cota + 1) − 1, e tudo confere');

console.log('Distritão Misto com redução v3 e Versão Minuta no memorial');
{
  // Versão Minuta: metade ARREDONDADA (XA, 5 vagas → 3 distritos; XB, 4 → 2)
  const porUfM = Object.assign({}, porUf);
  {
    const base = { unidades: ['w', 'c', 'e'].map((m, i) => ({ id: 'm:' + m, mun: m, zonas: ['1'], nome: m, aptos: 500 + i * 10, x: i * 10, y: 0, area: 1 })),
      viz: { 'm:w': new Set(['m:c']), 'm:c': new Set(['m:w', 'm:e']), 'm:e': new Set(['m:c']) } };
    const votos = {};
    xa.agrs.forEach((a, i) => a.cands.forEach((c, j) => {
      const k = ['w', 'c', 'e'][(i + j) % 3] + '|1';
      (votos[k] = votos[k] || { c: {}, l: {} }).c[c.sq] = c.votos;
    }));
    porUfM.xa = { desenho: SD.sdDistritar(base, 3), base, votos };
  }
  const ssR = [{ id: 'mistoR', nome: 'Distritão misto', tipo: 'misto', op: { pctMaisVotados: 0.5, arred: 'baixo', votoLiquido: true, modelo: 'compensatorio', limiar: 0 } },
    { id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: { pctDistrital: 0.5, arred: 'proximo', regra: 'candidato', modelo: 'compensatorio', limiar: 0, porUf: porUfM } }];
  const rrR = S.snSimular(dados, ssR);
  const mR = M.smMemorial({ dados, res: rrR, sistemas: ssR, ind: S.snIndicadores(rrR, dados), ordem: S.snOrdemPartidos(rrR), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
  const nR = Object.values(mR.conferencias).reduce((t2, x) => t2 + x.n, 0), naoR = Object.values(mR.conferencias).reduce((t2, x) => t2 + x.nao, 0);
  const aR = mR.abas.find(x => x.nome === 'Distritão misto');
  ok(naoR === 0 && celulas(aR).some(c => /^INT\(C\d+\*0\.5\+1E-9\)$/.test(c.f || '')) && celulas(aR).some(c => /^SUMIFS\(Eleitos!F:F,Eleitos!A:A,"Distritão misto",.*"mais votados"\)$/.test(c.f || '')),
    `Distritão Misto com redução v3: mais votados pela parte inteira e voto líquido por fórmula (votos − os dos eleitos na 1ª parte); ${nR} conferências, todas batem`);
  const aM = mR.abas.find(x => x.nome === 'Distrital misto');
  ok(celulas(aM).some(c => /^ROUND\(C\d+\*0\.5,0\)$/.test(c.f || '') && c.v === 3),
    'Versão Minuta: nº de distritos por fórmula, metade arredondada (5 vagas → 3), conferido com os desenhados');
  const linhasM = aM.linhas.filter(l => /^IF\(N\d+>=R\d+,/.test((l[10] || {}).f || ''));
  ok(linhasM.length === 5 && linhasM.every(l => l[10].v === 'CONFERE' && l[13] >= l[17]),
    `Versão Minuta: em cada distrito, o eleito contra o concorrente por fórmula (${linhasM.map(l => `${l[11]} ${l[13]} × ${l[15]} ${l[17]}`).join('; ')})`);
  // distritos ao alcance na regra do candidato: o eleito contra o concorrente (colunas N e R da aba do distrital), não as agremiações
  const alc = [...new Set(Object.values(dados).flatMap(d => d.agrs.flatMap(g => g.siglas)))].map(foco => {
    const me = M.smMemorial({ dados, res: rrR, sistemas: ssR, ind: S.snIndicadores(rrR, dados), ordem: S.snOrdemPartidos(rrR), meta: { titulo: 'T', eleicao: 't', parametros: [] }, estrategia: { partido: foco } });
    const ab = me.abas.find(x => x.nome === `Distritos ao alcance (${foco})`);
    return { foco, cel: celulas(ab), nao: Object.values(me.conferencias).reduce((t2, x) => t2 + x.nao, 0), texto: ab.linhas[0][0] };
  });
  ok(alc.some(x => x.cel.some(c => /!\$N\$\d+$/.test(c.f || '')) && x.cel.some(c => /!\$R\$\d+$/.test(c.f || ''))) && alc.every(x => x.nao === 0 && !x.cel.some(c => /!\$[HJ]\$\d+$/.test(c.f || '')) && /concorrente/.test(x.texto)),
    `Versão Minuta, distritos ao alcance: o eleito contra o concorrente (colunas N e R), não a 1ª contra a 2ª agremiação; tudo confere (${alc.map(x => x.foco).join(', ')})`);
  // A conferência pega o desenho errado: 2 distritos onde a regra dá 3.
  const ssErr = [Object.assign({}, ssR[1], { op: Object.assign({}, ssR[1].op, { porUf }) })];
  const rErr = S.snSimular(dados, ssErr);
  const mErr = M.smMemorial({ dados, res: rErr, sistemas: ssErr, ind: S.snIndicadores(rErr, dados), ordem: S.snOrdemPartidos(rErr), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
  ok(mErr.conferencias['Distrital misto'].nao === 1, 'nº de distritos que não segue a regra (5 vagas, metade arredondada, desenhadas 2) dá DIVERGE');
}

console.log('Deputados estaduais: nos distritos federais (Minuta, leitura b) e encaixado');
// Um estado com 24 vagas na Assembleia (8 federais, como o AC): 4 distritos federais, 12 cadeiras distritais.
const estadual = (() => {
  const cands = (n, base, passo) => Array.from({ length: n }, (_, i) => base - i * passo);
  const xc = uf('xc', 24, [agr('A', 4200, cands(16, 400, 20)), agr('B', 3000, cands(14, 300, 15)), agr('C', 1500, cands(10, 200, 15))]);
  // 16 unidades (malha 4×4); os votos de cada candidato vão para uma unidade, girando
  const un = [], viz = {}, id = (x, y) => `m:${x}${y}`;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { un.push({ id: id(x, y), mun: `${x}${y}`, zonas: ['1'], nome: `M${x}${y}`, aptos: 1000 + ((x * 5 + y * 3) % 4) * 10, x: x * 10, y: y * 10, area: 1 }); viz[id(x, y)] = new Set(); }
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (const [a, b] of [[1, 0], [0, 1]]) if (x + a < 4 && y + b < 4) { viz[id(x, y)].add(id(x + a, y + b)); viz[id(x + a, y + b)].add(id(x, y)); }
  const base = { unidades: un, viz }, votos = {};
  let j = 0;
  for (const a of xc.agrs) for (const c of a.cands) { const u = un[(j++ * 5) % 16]; (votos[`${u.mun}|1`] = votos[`${u.mun}|1`] || { c: {}, l: {} }).c[c.sq] = c.votos; }
  return { xc, base, votos };
})();
{
  const { xc, base, votos } = estadual;
  const desF = SD.sdDistritar(base, 4);
  const cad = SD.sdCadeirasPorDistrito(desF.distritos, 12);
  const desenhoFed = Object.assign({}, desF, { distritos: desF.distritos.map((d, i) => Object.assign({}, d, { cadeiras: cad[i] })) });
  const opF = { pctDistrital: 0.5, arred: 'proximo', regra: 'candidato', modelo: 'compensatorio', limiar: 0,
    porUf: { xc: { desenho: desenhoFed, base, votos, modoEstadual: 'fed', kF: 4, kE: 12, vagasFederais: 8, capPartido: 3 } } };
  const ssF = [{ id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: opF }];
  const rF = S.snSimular({ xc }, ssF);
  const mF = M.smMemorial({ dados: { xc }, res: rF, sistemas: ssF, ind: S.snIndicadores(rF, { xc }), ordem: S.snOrdemPartidos(rF), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
  const aF = mF.abas.find(x => x.nome === 'Distrital misto'), cF = mF.conferencias['Distrital misto'];
  const dF = rF.sims[0].porUf.xc.distritos;
  ok(dF.length === 4 && dF.every(d => d.cadeiras === 3 && d.vencedores.length === 3) && rF.sims[0].porUf.xc.eleitos.filter(e => e.fase !== 'lista').length === 12,
    'nos distritos federais: 4 distritos de 3 cadeiras, 12 eleitos distritais');
  ok(cF && cF.nao === 0 && celulas(aF).some(c => c.f === `IF(C${aF.linhas.findIndex(l => l[0] === 'XC') + 1}<=36,ROUND(C${aF.linhas.findIndex(l => l[0] === 'XC') + 1}/3,0),C${aF.linhas.findIndex(l => l[0] === 'XC') + 1}-24)`),
    `bancada federal pelo art. 27 por fórmula; ${cF ? cF.n : 0} conferências, todas batem`);
  ok(celulas(aF).filter(c => /^U\d+\+IF\(W\d+<=\$P\$\d+-SUM\(\$U\$\d+:\$U\$\d+\),1,0\)$/.test(c.f || '')).length === 4, 'cadeiras de cada distrito pelos maiores restos, por fórmula (uma por distrito)');
  ok(celulas(aF).filter(c => /^IF\(N\d+>=R\d+,/.test(c.f || '')).every(c => c.v === M.SM_SIM), 'o último eleito de cada distrito contra o concorrente');

  const an = SD.sdDistritarAninhado(base, 4, 3);
  const opA = { pctDistrital: 0.5, arred: 'proximo', regra: 'partido', modelo: 'compensatorio', limiar: 0,
    porUf: { xc: { desenho: an, base, votos, modoEstadual: 'ani', kF: 4, kE: 12, vagasFederais: 8 } } };
  const ssA = [{ id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: opA }];
  const rA = S.snSimular({ xc }, ssA);
  const mA = M.smMemorial({ dados: { xc }, res: rA, sistemas: ssA, ind: S.snIndicadores(rA, { xc }), ordem: S.snOrdemPartidos(rA), meta: { titulo: 'T', eleicao: 't', parametros: [] } });
  const aA = mA.abas.find(x => x.nome === 'Distrital misto'), cA = mA.conferencias['Distrital misto'];
  const enc = celulas(aA).filter(c => /^COUNTIFS\('Distritos \(composição\)'!A:A,\$A\$\d+,'Distritos \(composição\)'!B:B,A\d+,'Distritos \(composição\)'!H:H,"<>"&T\d+\)$/.test(c.f || ''));
  ok(an.distritos.length === 12 && enc.length === 12 && enc.every(c => c.v === 0) && cA && cA.nao === 0,
    `encaixado (regra do partido): 12 estaduais, cada um com 0 unidades fora do seu federal, conferido na composição; ${cA ? cA.n : 0} conferências, todas batem`);
  ok(mA.abas.find(x => x.nome === 'Distritos (composição)').linhas[0][7] === 'Distrito federal (encaixe)', 'composição traz o distrito federal de cada unidade');
  global.__estadual = { mF, mA };
}

console.log('Planilha (SheetJS)');
const wb = M.smParaXlsx(XLSX, memo);
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const lido = XLSX.read(buf, { type: 'buffer', cellFormula: true });
ok(lido.SheetNames.length === memo.abas.length && lido.Sheets.Estados.F2.f === 'IF(C2/B2-INT(C2/B2)>0.5,INT(C2/B2)+1,INT(C2/B2))' && lido.Sheets.Estados.F2.v === 200,
  'xlsx com as fórmulas e os valores calculados');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
