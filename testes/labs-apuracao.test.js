// Labs · Apuração 2026 — leitura dos arquivos de divulgação do TSE.
// Formato conferido no arquivo real de SP (ele2026/6259, Deputado Federal) em 03/10/2026.
// Uso: node testes/labs-apuracao.test.js
const path = require('path');
const A = require(path.join(__dirname, '..', 'labs-apuracao.js'));
const { AP_MAPA } = require(path.join(__dirname, '..', 'labs-apuracao-mapa.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Configuração do TSE (formato real de ele-c.json, resumido).
const cfg = { pl: [
  { cd: '3220', c: 'ele2026', dt: '04/10/2026', e: [
    { cd: '6257', cdt2: '6258', t: '1', tp: '8', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] },
    { cd: '6259', cdt2: '6260', t: '1', tp: '1', abr: [{ cd: 'br', cp: [{ cd: '3' }, { cd: '5' }, { cd: '6' }, { cd: '7' }, { cd: '8' }] }] },
    { cd: '6261', t: '1', tp: '3', abr: [{ cd: 'br', cp: [{ cd: '25' }] }] }] },
  { cd: '3237', c: 'ele2024', dt: '21/06/2026', e: [{ cd: '6278', cdt2: '6279', t: '1', tp: '2', abr: [{ cd: 'rr', cp: [{ cd: '3' }] }] }] },
  { cd: '452', c: 'ele2024', dt: '06/10/2024', e: [{ cd: '619', t: '1', tp: '3', abr: [{ cd: 'br', cp: [{ cd: '11' }, { cd: '13' }] }] }] }] };
const antes = A.apEleicoesGerais(cfg, new Date(2026, 9, 3));
ok(antes.length === 1 && antes[0].id === 'ele2026-1-3220' && antes[0].ano === 2026 && antes[0].turno === 1, 'só eleições gerais ordinárias (sem municipal, suplementar ou consulta)');
ok(antes[0].cargos[1].eleicao === '6257' && antes[0].cargos[6].eleicao === '6259' && antes[0].cargos[6].ufs === null && !antes[0].cargos[25], 'código da eleição por cargo');
const depois = A.apEleicoesGerais(cfg, new Date(2026, 9, 6));
ok(depois.length === 2 && depois[0].previsto && depois[0].turno === 2 && depois[0].cargos[1].eleicao === '6258' && depois[0].cargos[3].eleicao === '6260' && !depois[0].cargos[6],
  'passado o 1º turno, o 2º entra previsto (Presidente e Governador) pelo código reservado');
ok(A.apEleicaoInicial(depois).id === 'ele2026-1-3220', 'abre na mais recente já publicada');
const cfg2 = JSON.parse(JSON.stringify(cfg));
cfg2.pl.unshift({ cd: '3300', c: 'ele2026', dt: '25/10/2026', e: [{ cd: '6258', t: '2', tp: '8', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] },
  { cd: '6260', t: '2', tp: '1', abr: [{ cd: 'sp', cp: [{ cd: '3' }] }, { cd: 'rj', cp: [{ cd: '3' }] }] }] });
const pub = A.apEleicoesGerais(cfg2, new Date(2026, 9, 26));
ok(pub.length === 2 && pub[0].id === 'ele2026-2-3300' && !pub[0].previsto && pub[0].cargos[3].ufs.join() === 'sp,rj' && A.apEleicaoInicial(pub).id === 'ele2026-2-3300',
  '2º turno publicado: substitui o previsto, só as UFs com 2º turno, e vira o padrão');
ok(A.apEleicoesGerais({ pl: [] }).length === 0 && A.apEleicaoInicial([]).id === 'ele2026-1-3220', 'sem configuração: reserva 2026, 1º turno');
ok(A.apUrl('sp', '6259') === 'https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0006-e006259-u.json'
  && A.apUrl('br', '6258', 1, 'ele2030') === 'https://resultados.tse.jus.br/oficial/ele2030/6258/dados/br/br-c0001-e006258-u.json', 'endereço do arquivo por ciclo, eleição, cargo e UF');
const r = y => { const x = A.apClausulaRegra(y); return x && [x.pctBR, x.pctUF, x.eleitos].join('/'); };
ok(A.apClausulaRegra(2014) === null && r(2018) === '1.5/1/9' && r(2022) === '2/1/11' && r(2026) === '2.5/1.5/13' && r(2030) === '3/2/15' && r(2034) === '3/2/15',
  'cláusula de barreira pela regra do ano (2018, 2022, 2026, 2030 em diante)');

const arq = { ele: '6259', dg: '04/10/2026', hg: '19:42:10', tf: 'n',
  s: { ts: '103656', st: '51828', pst: '50,00' },
  carg: [{ cd: '6', nv: '70', qe: '312.456', agr: [
    { n: '1', nm: 'FEDERAÇÃO X', tp: 'f', vag: '9', par: [{ n: '13', sg: 'PT', tvtn: '900', tvtl: '10', cand: [{ n: '1300', nmu: 'FULANO', vap: '900', pvap: '1,00', e: 'n', st: '' }] }] },
    { n: '2', nm: 'PODEMOS', tp: 'i', vag: '2', par: [{ n: '20', sg: 'PODE', tvtn: '1500', tvtl: '80', cand: [
      { n: '2017', nm: 'MIRELLE FABIANA TREVISAN', nmu: 'MIRELLE TREVISAN', vap: '500', pvap: '0,50', e: 'n', st: 'Suplente' },
      { n: '2020', nm: 'CANDIDATO A', nmu: 'CAND A', vap: '1000', pvap: '1,00', e: 's', st: 'Eleito por QP' },
      { n: '2099', nm: 'CANDIDATO B', nmu: 'CAND B', vap: '0', pvap: '0,00', e: 'n', st: 'Não eleito' }] }] }] }] };
const sp = A.apLerUFTodos(arq, 'sp');
ok(sp.pct === 50 && sp.secoes === 103656 && sp.apuradas === 51828 && sp.atualizado === '04/10/2026 19:42:10' && !sp.final, 'seções apuradas, percentual e hora da divulgação');
ok(sp.vagasUF === 70 && sp.quociente === 312456 && !sp.majoritario, 'vagas da UF e quociente eleitoral');
const pode = sp.partidos.find(p => p.numero === '20');
ok(sp.partidos.length === 2 && pode.total === 1580 && pode.legenda === 80 && pode.vagas === 2 && pode.federacao === ''
  && sp.partidos.find(p => p.numero === '13').federacao === 'FEDERAÇÃO X', 'todos os partidos: votos nominais + legenda, vagas e federação');
ok(sp.candidatos.map(c => c.numero).join() === '2020,1300,2017,2099', 'todos os candidatos em ordem de votos');
const c = n => sp.candidatos.find(x => x.numero === n);
ok(c('2020').eleito && !c('2020').projetado && c('2017').projetado && !c('2017').eleito, 'eleito oficial prevalece; os demais dentro das vagas do partido ficam em projeção');
ok(!c('2099').eleito && !c('2099').projetado && c('1300').projetado, '"Não eleito" e candidato sem votos não contam; projeção vale por agremiação');
const gov = A.apLerUFTodos({ s: { ts: '10', st: '5', pst: '50,00' }, carg: [{ cd: '3', nv: '1', agr: [
  { n: '1', tp: 'i', par: [{ n: '20', sg: 'PODE', cand: [{ n: '20', nmu: 'A', vap: '10', e: 'n' }] }] },
  { n: '2', tp: 'i', par: [{ n: '13', sg: 'PT', cand: [{ n: '13', nmu: 'B', vap: '20', e: 'n' }] }] }] }] }, 'go');
ok(gov.majoritario && gov.candidatos[0].numero === '13' && gov.candidatos[0].projetado && !gov.candidatos[1].projetado, 'majoritário: à frente = entre os mais votados nas vagas');
const sem = A.apLerUFTodos({ s: { ts: '10', st: '0', pst: '0,00' }, carg: [{ nv: '8', agr: [] }] }, 'al');
ok(sem.partidos.length === 0 && sem.candidatos.length === 0 && sem.nome === 'Alagoas', 'UF ainda sem dados');
// Cláusula de barreira: 10 UFs fictícias com 1.000 válidos cada.
const ufC = (uf, votosA, votosB, eleitosB) => A.apLerUFTodos({ s: { ts: '1', st: '1', pst: '100,00' }, tf: 's', v: { vv: '1000' }, carg: [{ cd: '6', nv: '8', agr: [
  { n: '1', nm: 'FED A', tp: 'f', vag: '0', par: [{ n: '10', sg: 'A1', tvtn: String(votosA - 5), tvtl: '0', cand: [] }, { n: '11', sg: 'A2', tvtn: '5', tvtl: '0', cand: [] }] },
  { n: '2', nm: 'B', tp: 'i', vag: String(eleitosB), par: [{ n: '20', sg: 'B', tvtn: String(votosB), tvtl: '0',
    cand: Array.from({ length: eleitosB }, (_, i) => ({ n: '20' + i, nmu: 'B' + uf + i, vap: '10', e: 's', st: 'Eleito por QP' })) }] }] }] }, uf);
const lc = A.apClausula(['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma'].map((uf, i) => ufC(uf, i < 8 ? 30 : i === 8 ? 14 : 400, 10, i < 9 ? 2 : 0)));
const fa = lc.find(x => x.nome === 'FED A'), pb = lc.find(x => x.nome === 'B');
ok(fa.federacao && fa.siglas.join() === 'A1,A2' && Math.abs(fa.pct - 6.54) < 0.01 && fa.ufsMin === 9 && fa.atingeA, 'federação soma os partidos; 2,5% no país e 1,5% em 9 UFs atinge');
ok(pb.pct === 1 && !pb.atingeA && pb.eleitos.length === 18 && pb.ufsEleitos === 9 && pb.atingeB && pb.atinge, '13 eleitos em 9 UFs atinge mesmo sem os votos');
const lc2 = A.apClausula(['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go'].map((uf, i) => ufC(uf, i < 8 ? 30 : 14, 10, i < 8 ? 2 : 0)));
const fa2 = lc2.find(x => x.nome === 'FED A'), pb2 = lc2.find(x => x.nome === 'B');
ok(!fa2.atinge && fa2.ufsMin === 8 && fa2.proxima.uf === 'go' && Math.abs(fa2.proxima.pct - 1.4) < 1e-9, '1,4% na 9ª UF não basta; aponta a UF mais perto');
ok(!pb2.atinge && pb2.eleitos.length === 16 && pb2.ufsEleitos === 8, '16 eleitos em só 8 UFs não atinge');
const fa22 = A.apClausula(['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go'].map((uf, i) => ufC(uf, i < 8 ? 30 : 14, 10, 0)), A.apClausulaRegra(2022)).find(x => x.nome === 'FED A');
ok(fa22.ufsMin === 9 && fa22.atingeA, 'regra de 2022: 1,4% já conta (mínimo 1% por estado)');
// Retotalização (PE, 06/10/2026): 100% apurado, não finalizado, vagas zeradas, nenhum eleito marcado.
const retotJ = (tf, vag, st) => ({ s: { ts: '10', st: '10', pst: '100,00' }, tf, v: { vv: '100' }, carg: [{ cd: '6', nv: '25', agr: [
  { tp: 'i', vag, par: [{ n: '20', sg: 'PODE', tvtn: '90', tvtl: '10', cand: [{ n: '2000', nmu: 'FULANO', vap: '90', pvap: '90,00', st }] }] }] }] });
const pe = A.apLerUFTodos(retotJ('n', '0', ''), 'pe');
ok(pe.retotalizando && pe.candidatos[0].projetado === false, 'retotalização: 100% apurado, não final, sem vagas nem eleito → marcada (e sem projeção)');
ok(!A.apLerUFTodos(retotJ('s', '3', 'Eleito por QP'), 'pe').retotalizando, 'UF finalizada com eleitos não é retotalização');
ok(!A.apLerUFTodos(retotJ('n', '3', ''), 'pe').retotalizando, 'não final mas com vagas (projeção possível) não é retotalização');
ok(!A.apLerUFTodos(Object.assign(retotJ('n', '0', ''), { s: { ts: '10', st: '5', pst: '50,00' } }), 'pe').retotalizando, 'apuração em andamento (50%) não é retotalização');
ok(A.apRetotalizando({ final: false, pct: 100, majoritario: true, partidos: [], candidatos: [{ eleito: false }] }) && !A.apRetotalizando({ final: false, pct: 100, majoritario: true, partidos: [], candidatos: [{ eleito: true }] }),
  'retotalização também em cargo majoritário (sem eleito marcado com 100% apurado)');
ok(A.apCor(0) === '#2b3440' && A.apCor(100) === '#00a859', 'cor do mapa: 0% cinza, 100% verde');
ok(Object.keys(AP_MAPA.uf).length === 27 && Object.keys(AP_MAPA.centro).length === 27, 'mapa embutido com as 27 UFs');
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
