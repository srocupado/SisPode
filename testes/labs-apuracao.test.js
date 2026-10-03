// Labs · Apuração 2026 — leitura dos arquivos de divulgação do TSE.
// Formato conferido no arquivo real de SP (ele2026/6259, Deputado Federal) em 03/10/2026.
// Uso: node testes/labs-apuracao.test.js
const path = require('path');
const A = require(path.join(__dirname, '..', 'labs-apuracao.js'));
const { AP_MAPA } = require(path.join(__dirname, '..', 'labs-apuracao-mapa.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const cfg = { pl: [{ c: 'ele2026', e: [
  { cd: '6257', t: '1', abr: [{ cp: [{ cd: '1', ds: 'Presidente' }] }] },
  { cd: '6259', t: '1', abr: [{ cp: [{ cd: '3' }, { cd: '6', ds: 'Deputado Federal' }] }] },
  { cd: '6260', t: '2', abr: [{ cp: [{ cd: '3' }] }] }] }] };
ok(A.apEleicaoDaConfig(cfg) === '6259' && A.apEleicaoDaConfig({ pl: [] }) === null, 'eleição de Deputado Federal lida da configuração do TSE');
ok(A.apUrl('sp', '6259') === 'https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0006-e006259-u.json', 'endereço do arquivo da UF');

const arq = { ele: '6259', dg: '04/10/2026', hg: '19:42:10', tf: 'n',
  s: { ts: '103656', st: '51828', pst: '50,00' },
  carg: [{ cd: '6', nv: '70', qe: '312.456', agr: [
    { n: '1', nm: 'FEDERAÇÃO X', tp: 'f', vag: '9', par: [{ n: '13', sg: 'PT', tvtn: '900', tvtl: '10', cand: [{ n: '1300', nmu: 'FULANO', vap: '900', pvap: '1,00', e: 'n', st: '' }] }] },
    { n: '2', nm: 'PODEMOS', tp: 'i', vag: '2', par: [{ n: '20', sg: 'PODE', tvtn: '1500', tvtl: '80', cand: [
      { n: '2017', nm: 'MIRELLE FABIANA TREVISAN', nmu: 'MIRELLE TREVISAN', vap: '500', pvap: '0,50', e: 'n', st: 'Suplente' },
      { n: '2020', nm: 'CANDIDATO A', nmu: 'CAND A', vap: '1000', pvap: '1,00', e: 's', st: 'Eleito por QP' },
      { n: '2099', nm: 'CANDIDATO B', nmu: 'CAND B', vap: '0', pvap: '0,00', e: 'n', st: 'Não eleito' }] }] }] }] };
const sp = A.apLerUF(arq, 'sp');
ok(sp.pct === 50 && sp.secoes === 103656 && sp.apuradas === 51828 && sp.atualizado === '04/10/2026 19:42:10' && !sp.final, 'seções apuradas, percentual e hora da divulgação');
ok(sp.vagasUF === 70 && sp.quociente === 312456, 'vagas da UF e quociente eleitoral');
ok(sp.partido.total === 1580 && sp.partido.legenda === 80 && sp.partido.vagas === 2 && sp.partido.federacao === '', 'Podemos: votos nominais + legenda, vagas, sem federação');
ok(sp.candidatos.map(c => c.numero).join() === '2020,2017,2099' && sp.candidatos[0].eleito && !sp.candidatos[1].eleito && !sp.candidatos[2].eleito, 'candidatos em ordem de votos; "Não eleito" não conta como eleito');
const sem = A.apLerUF({ s: { ts: '10', st: '0', pst: '0,00' }, carg: [{ nv: '8', agr: [] }] }, 'al');
ok(sem.partido === null && sem.candidatos.length === 0, 'UF sem candidatos do Podemos');
const r = A.apResumo({ sp, al: Object.assign(sem, { secoes: 103656, apuradas: 103656, pct: 100 }) });
ok(Math.round(r.pct) === 75 && r.votos === 1580 && r.eleitos === 1 && r.concluidas === 1, 'resumo do Brasil ponderado pelas seções');
ok(A.apCor(0) === '#2b3440' && A.apCor(100) === '#00a859', 'cor do mapa: 0% cinza, 100% verde');
ok(Object.keys(AP_MAPA.uf).length === 27 && Object.keys(AP_MAPA.centro).length === 27, 'mapa embutido com as 27 UFs');
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
