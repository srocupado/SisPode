// Sistemas Eleitorais — núcleo das simulações (proporcional, distritão, distritão misto).
// O motor proporcional foi conferido com o resultado oficial: 2026 (servidor de
// resultados, 27 UFs × Câmara e Assembleia) e 2022 (dados abertos) — os casos
// abaixo fixam cada regra em miniatura.
// Uso: node testes/sistemas.test.js
const path = require('path');
const S = require(path.join(__dirname, '..', 'sistemas-nucleo.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Agremiação de teste: candidatos com votos dados; o resto é legenda.
let seq = 0;
const agr = (id, votos, cands, extra = {}) => Object.assign({ id, nome: id, tipo: 'partido', siglas: [id], votos, legenda: votos - cands.reduce((s, v) => s + v, 0),
  vagasReal: null, cands: cands.map(v => ({ sq: id + (++seq), n: String(seq), nome: id + seq, partido: id, votos: v, valido: true, eleitoReal: false, situacao: '' })) }, extra);
const uf = (vagas, agrs) => ({ uf: 'xx', cargo: 6, vagas, validos: agrs.reduce((s, a) => s + a.votos, 0), agrs });
const conta = r => JSON.stringify(Object.fromEntries(Object.entries(r.porAgr).filter(([, n]) => n)));

console.log('Números e quociente eleitoral');
ok(S.snNum('1.234.567') === 1234567 && S.snNum('12,5') === 12.5 && S.snNum(null) === 0 && S.snNum('') === 0, 'número do TSE com ponto de milhar');
ok(S.snQuociente(1000, 3) === 333 && S.snQuociente(1000, 6) === 167 && S.snQuociente(7, 2) === 3 && S.snQuociente(10, 0) === 0,
  'QE: fração até meio desprezada, acima de meio arredonda para cima (art. 106)');

console.log('Leitura do arquivo de resultados');
const j = { cdabr: 'XX', tf: 's', v: { vv: '1.000' }, carg: [{ cd: '6', nv: '5', qe: '200', agr: [
  { n: '1', nm: 'Partido A', tp: 'p', vag: '2', par: [{ sg: 'PA', tvtl: '20', cand: [
    { sqcand: '11', n: '1111', nmu: 'Ana', vap: '300', e: 's', st: 'Eleito por QP' },
    { sqcand: '12', n: '1112', nmu: 'Beto', vap: '1.000', dvt: 'Anulado sub judice', st: 'Não eleito' },
    { sqcand: '13', n: '1113', nmu: 'Caio', vap: '80', st: 'Suplente' }] }] },
  { n: '9', nm: 'Federação F', tp: 'f', vag: '1', par: [
    { sg: 'PX', tvtl: '10', cand: [{ sqcand: '21', n: '2121', nmu: 'Dora', vap: '200', st: 'Eleito por média' }] },
    { sg: 'PY', tvtl: '5', cand: [{ sqcand: '22', n: '2222', nmu: 'Eva', vap: '50', st: 'Não eleito' }] }] }] }] };
const d = S.snLerUF(j);
const a1 = d.agrs[0], f9 = d.agrs[1];
ok(d.uf === 'xx' && d.cargo === 6 && d.vagas === 5 && d.validos === 1000 && d.qeTse === 200 && d.final, 'cabeçalho: UF, cargo, vagas, válidos, QE do TSE, totalização final');
ok(a1.votos === 400 && a1.legenda === 20 && a1.vagasReal === 2, 'votos da agremiação = nominais válidos + legenda (anulado sub judice fora)');
ok(a1.cands.map(c => c.nome).join() === 'Beto,Ana,Caio' && !a1.cands[0].valido && a1.cands[1].eleitoReal && !a1.cands[2].eleitoReal, 'candidatos em ordem de votos, com validade e eleito real');
ok(f9.tipo === 'federacao' && f9.siglas.join() === 'PX,PY' && f9.votos === 265 && f9.porSigla.PX === 210 && f9.porSigla.PY === 55 && f9.cands[0].eleitoReal,
  'federação: uma agremiação só, com os votos de cada partido guardados');

console.log('Proporcional (regra vigente)');
// QE = 1000 / 5 = 200; 10% = 20; 80% = 160; 20% = 40.
const base = () => uf(5, [agr('A', 500, [260, 180, 45, 15]), agr('B', 250, [18, 12]), agr('C', 150, [140, 10]), agr('D', 100, [100])]);
const p = S.snProporcional(base());
ok(p.qe === 200 && p.vagas === 5 && p.eleitos.length === 5, 'QE e número de eleitos');
ok(p.eleitos.filter(x => x.fase === 'QP').map(x => x.cand.votos).join() === '260,180', '1ª fase: A elege o QP (2); B tem QP 1 mas nenhum candidato com 10% do QE');
ok(p.eleitos.filter(x => x.fase === 'média').map(x => x.cand.votos).join() === '45', '2ª fase: só agremiação com 80% do QE e candidato com 20% do QE');
ok(p.eleitos.filter(x => x.fase === 'média (3ª fase)').map(x => x.agr + x.cand.votos).join() === 'B18,C140', '3ª fase aberta a todas (STF): B pela maior média, depois C (abaixo de 80%)');
ok(conta(p) === '{"A":3,"B":1,"C":1}', 'resultado: A 3, B 1, C 1');
const p80 = S.snProporcional(base(), { terceiraFaseAberta: false });
ok(conta(p80) === '{"A":4,"B":1}' && p80.eleitos[4].cand.votos === 15, '3ª fase só com 80% (texto da lei antes do STF): C fica de fora; empate de média vai à maior votação');
const p0 = S.snProporcional(base(), { pctQP: 0, pctCandidato: 0 });
ok(p0.eleitos.filter(x => x.fase === 'QP').map(x => x.agr + x.cand.votos).join() === 'A260,A180,B18' && conta(p0) === '{"A":4,"B":1}',
  'parâmetros ajustáveis: sem as exigências individuais, B ocupa o QP e as sobras ficam entre os de 80%');
const p7 = S.snProporcional(base(), { vagas: 7 });
ok(p7.qe === 143 && p7.eleitos.length === 7, 'número de vagas ajustável (o QE acompanha)');
const p111 = S.snProporcional(uf(3, [agr('A', 250, [120, 130]), agr('B', 250, [200, 50]), agr('C', 250, [90, 160]), agr('D', 250, [250])]));
ok(p111.eleitos.every(x => x.fase === 'mais votados (art. 111)') && p111.eleitos.map(x => x.cand.votos).join() === '250,200,160', 'ninguém alcança o QE: os mais votados (art. 111)');
const vazia = uf(4, [agr('A', 900, [880]), agr('B', 100, [100])]);
ok(S.snProporcional(vazia).eleitos.length === 2, 'agremiação sem candidatos bastantes: as vagas que ninguém pode ocupar ficam sem eleito');

console.log('Federações');
const fed = uf(3, [agr('F', 600, [250, 200, 100], { tipo: 'federacao', siglas: ['PX', 'PY'], porSigla: { PX: 380, PY: 220 } }), agr('B', 400, [300, 100])]);
fed.agrs[0].cands[0].partido = 'PX'; fed.agrs[0].cands[1].partido = 'PY'; fed.agrs[0].cands[2].partido = 'PX';
const sem = S.snSemFederacao(fed.agrs);
ok(sem.length === 3 && sem[0].id === 'F:PX' && sem[0].votos === 380 && sem[0].legenda === 30 && sem[1].votos === 220 && sem[1].legenda === 20 && sem[1].cands.length === 1 && sem[2] === fed.agrs[1],
  'sem federação: cada partido com os seus votos (nominais + legenda) e os seus candidatos');
ok(sem.reduce((s, a) => s + a.votos, 0) === 1000, 'a soma dos votos não muda');
ok(conta(S.snProporcional(fed)) === '{"F":2,"B":1}' && conta(S.snProporcional(fed, { federacoes: false })) === '{"F:PX":1,"B":2}',
  'com federação F faz 2; separados, PY não chega a 80% do QE e a cadeira vai para B');

console.log("Distritão e maiores médias (D'Hondt)");
const dt = S.snDistritao(base());
ok(dt.eleitos.map(x => x.cand.votos).join() === '260,180,140,100,45' && dt.corte === 45 && conta(dt) === '{"A":3,"C":1,"D":1}', 'distritão: os mais votados do estado; legenda não elege');
ok(JSON.stringify(S.snDhondt({ A: 100000, B: 80000, C: 30000, D: 20000 }, 8)) === '{"A":4,"B":3,"C":1,"D":0}', "D'Hondt: exemplo clássico (8 cadeiras)");
const lim = S.snDhondt({ A: 100000, B: 80000, C: 30000, D: 20000 }, 8, {}, 0.15);
ok(!('C' in lim) && !('D' in lim) && lim.A + lim.B === 8, 'cláusula de desempenho: abaixo do limiar não entra na divisão');
ok(JSON.stringify(S.snDhondt({ A: 100, B: 80, C: 30, D: 20 }, 4, { A: 3 })) === '{"A":0,"B":3,"C":1,"D":0}', 'cadeiras já obtidas entram no divisor (compensatório)');

console.log('Distritão misto');
// A: votação espalhada (7 × 100); B: três nomes fortes (105, 104, 91).
const mis = () => uf(6, [agr('A', 700, [100, 100, 100, 100, 100, 100, 100]), agr('B', 300, [105, 104, 91])]);
const par = S.snDistritaoMisto(mis(), { pctMaisVotados: 0.5, modelo: 'paralelo' });
ok(par.nMais === 3 && par.nLista === 3 && par.eleitos.filter(x => x.fase === 'mais votados').map(x => x.agr).join() === 'B,B,A', 'metade pelos mais votados');
ok(conta(par) === '{"A":3,"B":3}' && par.eleitos.length === 6, 'paralelo: a lista divide só a sua metade (A 2, B 1) e soma');
const com = S.snDistritaoMisto(mis(), { pctMaisVotados: 0.5, modelo: 'compensatorio' });
ok(conta(com) === '{"A":4,"B":2}' && com.eleitos.length === 6, 'compensatório: a proporção vale para o total (A 4, B 2)');
ok(new Set(com.eleitos.map(x => x.sq)).size === 6, 'ninguém eleito duas vezes');
const exc = S.snDistritaoMisto(uf(4, [agr('A', 700, [100, 100, 100, 100, 100, 100, 100]), agr('B', 300, [105, 104, 91])]), { pctMaisVotados: 0.75, modelo: 'compensatorio' });
ok(exc.nMais === 3 && exc.nLista === 1 && conta(exc) === '{"A":2,"B":2}' && exc.eleitos.length === 4, 'compensatório com cadeira a mais nos mais votados: B guarda as suas, a lista só cobre o que cabe');
ok(conta(S.snDistritaoMisto(mis(), { pctMaisVotados: 1 })) === conta(S.snDistritao(mis())), '100% pelos mais votados = distritão');

console.log('Dados abertos (anos fora do servidor de resultados)');
const hc = 'SG_UF;CD_CARGO;NR_TURNO;SQ_CANDIDATO;NR_CANDIDATO;NM_CANDIDATO;NM_URNA_CANDIDATO;NR_PARTIDO;SG_PARTIDO;NM_PARTIDO;NR_FEDERACAO;NM_FEDERACAO;NM_TIPO_DESTINACAO_VOTOS;QT_VOTOS_NOMINAIS_VALIDOS;DS_SIT_TOT_TURNO';
const hp = '﻿SG_UF;CD_CARGO;NR_TURNO;NR_PARTIDO;SG_PARTIDO;NM_PARTIDO;NR_FEDERACAO;NM_FEDERACAO;QT_VOTOS_NOMINAIS_VALIDOS;QT_TOTAL_VOTOS_LEG_VALIDOS';
const L = S.snLeitorDadosAbertos('6');
[hc,
  '"AC";"6";"1";"1";"2020";"ANA SILVA";"ANA";"20";"PSC";"Partido Social Cristão";"-1";"#NULO#";"Válido";"300";"ELEITO POR QP"',
  '"AC";"6";"1";"1";"2020";"ANA SILVA";"ANA";"20";"PSC";"Partido Social Cristão";"-1";"#NULO#";"Válido";"50";"ELEITO POR QP"',
  '"AC";"6";"1";"2";"2021";"BIA; LIMA";"BIA";"20";"PSC";"Partido Social Cristão";"-1";"#NULO#";"Válido (legenda)";"40";"NÃO ELEITO"',
  '"AC";"6";"1";"3";"1310";"CAIO";"CAIO";"13";"PT";"Partido dos Trabalhadores";"1";"Federação Brasil da Esperança";"Válido";"200";"ELEITO POR MÉDIA"',
  '"AC";"6";"1";"4";"6510";"DORA";"DORA";"65";"PC do B";"Partido Comunista do Brasil";"1";"Federação Brasil da Esperança";"Válido";"90";"SUPLENTE"',
  '"AC";"7";"1";"5";"20200";"OUTRO CARGO";"X";"20";"PSC";"Partido Social Cristão";"-1";"#NULO#";"Válido";"999";"ELEITO POR QP"',
  '"AC";"6";"2";"6";"2022";"OUTRO TURNO";"Y";"20";"PSC";"Partido Social Cristão";"-1";"#NULO#";"Válido";"999";"ELEITO"'].forEach(L.candidato.linha);
[hp,
  '"AC";"6";"1";"20";"PSC";"Partido Social Cristão";"-1";"#NULO#";"350";"60"',
  '"AC";"6";"1";"13";"PT";"Partido dos Trabalhadores";"1";"Federação Brasil da Esperança";"200";"30"',
  '"AC";"6";"1";"65";"PC do B";"Partido Comunista do Brasil";"1";"Federação Brasil da Esperança";"90";"5"',
  '"AC";"7";"1";"20";"PSC";"Partido Social Cristão";"-1";"#NULO#";"999";"999"'].forEach(L.partido.linha);
const ac = L.resultado({ ac: 8 }).ac;
const psc = ac.agrs.find(a => a.id === 'p20'), fe = ac.agrs.find(a => a.id === 'f1');
ok(ac.vagas === 8 && ac.validos === 735 && ac.eleitosReal === 2 && ac.cargo === 6, 'por UF: vagas informadas, válidos, eleitos reais (só o cargo e o 1º turno pedidos)');
ok(psc.votos === 410 && psc.legenda === 60 && psc.cands.length === 2 && psc.cands[0].votos === 350 && psc.cands[0].eleitoReal, 'candidato somado nas várias zonas; legenda inclui os votos convertidos');
ok(psc.cands[1].nome === 'BIA' && !psc.cands[1].valido && !psc.cands[1].eleitoReal, 'voto que foi para a legenda: candidato fora da disputa individual');
ok(fe.tipo === 'federacao' && fe.nome === 'Federação Brasil da Esperança' && fe.siglas.join() === 'PT,PC do B' && fe.votos === 325 && fe.porSigla['PC do B'] === 95,
  'federação reunida pelo número, com os votos de cada partido');
ok(!fe.cands[1].eleitoReal && fe.cands[0].eleitoReal, '"SUPLENTE" e "NÃO ELEITO" não contam como eleitos');
ok(S.snLeitorDadosAbertos('6').resultado({}).constructor === Object, 'sem linhas: resultado vazio');
let erro = '';
try { S.snLeitorDadosAbertos('6').partido.linha('SG_UF;CD_CARGO'); } catch (e) { erro = e.message; }
ok(/fora do formato esperado/.test(erro) && /NR_TURNO/.test(erro), 'cabeçalho diferente: erro claro (o TSE mudou o arquivo)');
ok(S.snCampos('"a;b";"c""d";e;').join('|') === 'a;b|c"d|e|', 'CSV do TSE: separador dentro de aspas e aspas dobradas');

console.log('Vagas e conferência');
ok(S.snVagasAssembleia('sp', 70) === 94 && S.snVagasAssembleia('MG', 53) === 77 && S.snVagasAssembleia('ac', 8) === 24 && S.snVagasAssembleia('am', 12) === 36 && S.snVagasAssembleia('df', 8) === 24,
  'Assembleia pela Constituição (art. 27); Câmara Legislativa do DF: 24');
const real = base();
real.agrs[0].cands[0].eleitoReal = real.agrs[0].cands[1].eleitoReal = real.agrs[3].cands[0].eleitoReal = true;
const cf = S.snConferir(real, S.snProporcional(real));
ok(cf.iguais === 2 && cf.faltam.map(c => c.votos).join() === '100' && cf.sobram.map(c => c.votos).sort().join() === '140,18,45', 'conferência com o resultado oficial: iguais, sobram e faltam');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
