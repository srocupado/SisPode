// Revisão do módulo Relatórios de 11/11/2026 — sistema eleitoral e demais relatórios.
//
// O que este teste trava (um bloco por achado da revisão):
//  Sistema eleitoral
//   1. compensação total: vencedor de distrito de agremiação fora da lista (abaixo da
//      cláusula, ou com o voto líquido zerado) não faz a Casa crescer até o teto;
//   2. votos dispersos: o candidato da agremiação no distrito é o que a simulação escala
//      ali, cada um num distrito só (não o mais votado bruto em todos os distritos);
//   3. retenção: a conta dos votos não retidos é de inteiros (o meio não erra), e o
//      memorial usa a mesma conta na fórmula;
//   4. voto líquido com o excedente que não leva: o memorial desconta os mesmos
//      vencedores que o simulador (todos, inclusive os que ficaram sem a cadeira);
//   5. desenho com erro (estado sem unidades) não derruba a simulação: tudo pela lista;
//   6. "regra atual" da Próxima cadeira = o card Proporcional, não a ADI 8.036;
//   7. QE sem o card Proporcional vem do art. 106, não de `qeTse` (nulo nos dados abertos);
//   8. a memória dos desenhos leva o nº de distritos federais (kF) na chave;
//   9. leitura cancelada ou que falhou devolve o PDF e o memorial do resultado anterior;
//  10. os votos por distrito são somados uma vez por simulação (eleição + ficha).
//  Demais relatórios
//  11. Leis aprovadas: falha ao apagar é dita; depois de apagar, a busca relê o banco;
//  12. Leis aprovadas: falha de leitura não vira "ainda não coletada";
//  13. Aderência: votação que não pôde ser lida fica fora do cálculo, contada e avisada;
//  14. documentos da legislatura/período: total sem voto Sim/Não sai "—", não "NaN%";
//  15. sem voto Sim/Não é "—", não 0% (número grande, gráfico temporal, rosca);
//  16. o recorte dos documentos usa a mesma data da seleção (`data`), e período sem
//      votação não derruba os rótulos;
//  17. nova tentativa nos Relatórios: a função tem nome próprio (fetchJsonRetry) — com o nome
//      `fetchJson` ela era encoberta pela de ia-comum.js, carregada depois, e nada se repetia;
//      429/5xx/rede repetem, 4xx não, e falha lenta (servidor fora) não repete e abre o disjuntor;
//  18. texto vindo do cache aberto do Firebase é escapado antes de ir ao HTML.
//
// Uso: node testes/relatorios-revisao-2026-11-11.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const S = require(path.join(RAIZ, 'sistemas-nucleo.js'));
const SD = require(path.join(RAIZ, 'sistemas-distrital.js'));
global.snSemFederacao = S.snSemFederacao;
global.snCompletarLista = S.snCompletarLista;
global.sdDistritalMisto = SD.sdDistritalMisto;
const M = require(path.join(RAIZ, 'sistemas-memorial.js'));
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const ler = arq => fs.readFileSync(path.join(RAIZ, arq), 'utf8');

// ------------------------------------------------------------------ sistema eleitoral
const cand = (sq, partido, votos) => ({ sq, n: sq, nome: 'C' + sq, partido, votos, valido: true, eleitoReal: false, situacao: '' });
const agr = (id, votos, cands, extra = {}) => Object.assign({ id, nome: id, tipo: 'partido', siglas: [id], votos,
  legenda: votos - cands.reduce((s, v) => s + v, 0), porSigla: { [id]: votos }, vagasReal: null,
  cands: cands.map((v, i) => cand(id.toLowerCase() + (i + 1), id, v)) }, extra);
const estado = (sigla, vagas, agrs) => ({ uf: sigla, cargo: 6, vagas, validos: agrs.reduce((s, a) => s + a.votos, 0), qeTse: null, agrs });
// dois distritos: oeste (unidade w) e leste (unidade e)
const base2 = () => ({ unidades: [{ id: 'm:w', mun: 'w', zonas: ['1'], nome: 'Oeste', aptos: 500, x: 0, y: 0, area: 1 }, { id: 'm:e', mun: 'e', zonas: ['1'], nome: 'Leste', aptos: 520, x: 10, y: 0, area: 1 }],
  viz: { 'm:w': new Set(['m:e']), 'm:e': new Set(['m:w']) } });
const primeiro = (d, sq, pct) => { const a = d.agrs.find(g => g.cands.some(c => c.sq === sq)); return { sq, agr: a.id, fase: 'distrito', cand: a.cands.find(c => c.sq === sq), pct }; };

console.log('== 1. compensação total: vencedor fora da lista não faz a Casa crescer ==');
{
  // 10 vagas, cláusula de 5%. C (3% dos válidos) vence um distrito.
  const d = estado('xx', 10, [agr('A', 520, Array(12).fill(10)), agr('B', 450, Array(12).fill(10)), agr('C', 30, [20, 10])]);
  const prim = [primeiro(d, 'c1', 0.4), primeiro(d, 'a1', 0.5), primeiro(d, 'b1', 0.45)];
  const r = S.snCompletarLista(d, prim, 10, { modelo: 'compensatorio', excedente: 'compensa', limiar: 0.05 });
  ok(r.vagas === 10 && r.extra === 0, `a Casa fica com 10 vagas (era 50: o teto de segurança de 4×) (${r.vagas}, +${r.extra})`);
  ok(r.eleitos.length === 10 && r.eleitos.some(e => e.sq === 'c1'), 'o vencedor de C guarda a cadeira, e as outras 9 saem das listas');
  // voto líquido zerado (votosBrutos acima da cláusula, votos de lista 0): o mesmo
  const dz = estado('xx', 10, [agr('A', 520, Array(12).fill(10)), agr('B', 380, Array(12).fill(10)), agr('D', 0, [60, 40], { votosBrutos: 100 })]);
  dz.validos = 1000;
  const rz = S.snCompletarLista(dz, [primeiro(dz, 'd1', 0.4), primeiro(dz, 'a1', 0.5)], 10, { modelo: 'compensatorio', excedente: 'compensa', limiar: 0.05 });
  ok(rz.vagas === 10, `agremiação acima da cláusula mas sem voto de lista (voto líquido 0): a Casa também não cresce (${rz.vagas})`);
  // controle: o excedente de quem disputa a lista continua sendo compensado
  const dc = estado('xx', 10, [agr('A', 300, Array(12).fill(10)), agr('B', 700, Array(12).fill(10))]);
  const pc = ['a1', 'a2', 'a3', 'a4', 'a5'].map(sq => primeiro(dc, sq, 0.5));
  const rc = S.snCompletarLista(dc, pc, 10, { modelo: 'compensatorio', excedente: 'compensa' });
  const nA = rc.eleitos.filter(e => e.agr === 'A').length;
  ok(rc.extra > 0 && nA === 5 && Math.abs(nA / rc.vagas - 0.3) < 0.05, `controle: A (30% dos votos, 5 distritos) faz a Casa crescer até a proporção fechar (${rc.vagas} vagas, A ${nA})`);
}

console.log('\n== 2. votos dispersos: cada candidato concorre num distrito só ==');
let d2, op2;
{
  // A: a1 é o mais votado dela nos DOIS distritos; leva o oeste (fatia maior) e o leste fica com a2.
  d2 = estado('xx', 4, [agr('A', 700, [500, 200]), agr('B', 220, [220])]);
  const base = base2(), desenho = SD.sdDistritar(base, 2);
  const votos = { 'w|1': { c: { a1: 300, a2: 50, b1: 100 }, l: {} }, 'e|1': { c: { a1: 200, a2: 150, b1: 120 }, l: {} } };
  op2 = { regra: 'candidato', modelo: 'paralelo', desenho, base, votos };
  const r = SD.sdDistritalMisto(d2, op2);
  const iW = desenho.distritos.findIndex(x => x.unidades.includes('m:w')), iE = 1 - iW;
  ok(r.distritos[iW].vencedor.sq === 'a1' && r.distritos[iE].vencedor.sq === 'a2', 'a1 leva o oeste; no leste, o eleito é a2 (a1 já levou um distrito)');
  // A: 700 nominais − (a1 no oeste 300 + a2 no leste 150) = 250. Antes: 200 — os 150 de a2, que levou o
  // leste, contavam como dispersos, e os 200 de a1 no leste (onde não concorre), não.
  ok(r.dispersos.A === 250, `A: dispersos = 700 − 300 (a1, oeste) − 150 (a2, leste) = 250 (${r.dispersos.A})`);
  // B tem um candidato só: concorre no leste (fatia maior); os 100 votos dele no oeste são dispersos (antes: 0)
  ok(r.dispersos.B === 100, `B: o único candidato concorre num distrito; os votos dele no outro são dispersos (${r.dispersos.B})`);
  // os vencedores entram fixos: escalando a2 no oeste, a1 só pode ficar com o leste
  const vd = SD.sdVotosDistritos(d2, desenho, base, votos);
  const fixo = SD.sdDispersos(vd, d2, 1, new Map([['a2', iW]]));
  ok(fixo.A === 700 - 50 - 200, `o vencedor dado em \`fixos\` é o candidato do distrito que levou (${fixo.A})`);
  // retenção + voto líquido: nenhum voto é descontado duas vezes
  const rl = SD.sdDistritalMisto(d2, Object.assign({}, op2, { modelo: 'compensatorio', retencao: 0.5, votoLiquido: true }));
  ok(rl.retidos.A === 700 - 125 && rl.liquido.A === 575 - 450, `com 50% de retenção e voto líquido: A retém 575 e fica com 125 líquidos (${rl.retidos.A}, ${rl.liquido.A})`);
  ok(/cada candidato num distrito só/.test(ler('sistemas/sistemas-tela.js')) && /cada candidato num distrito só/.test(ler('sistemas-memorial.js')),
    'a tela e o memorial explicam a definição nova');
}

console.log('\n== 3. retenção: conta de inteiros ==');
{
  ok(Math.round((1 - 0.9) * 15) === 1, '(o defeito: em ponto flutuante, (1 − 0,9) × 15 arredonda para 1)');
  ok(SD.sdNaoRetidos(0.9, 15) === 2 && SD.sdNaoRetidos(0.55, 30) === 14, `90% de 15 dispersos perde 2; 55% de 30 perde 14 (${SD.sdNaoRetidos(0.9, 15)}, ${SD.sdNaoRetidos(0.55, 30)})`);
  ok(SD.sdNaoRetidos(1, 99) === 0 && SD.sdNaoRetidos(0, 7) === 7 && SD.sdNaoRetidos(0.5, undefined) === 0, 'extremos: 100% não perde nada, 0% perde tudo, sem dispersos perde 0');
  // no simulador: B com 15 dispersos a 90%
  const d = estado('xx', 2, [agr('A', 400, [400]), agr('B', 215, [200, 15])]);
  const base = base2(), desenho = SD.sdDistritar(base, 2);
  const votos = { 'w|1': { c: { a1: 400, b1: 100, b2: 15 }, l: {} }, 'e|1': { c: { b1: 100 }, l: {} } };
  const r = SD.sdDistritalMisto(d, { regra: 'candidato', modelo: 'compensatorio', desenho, base, votos, retencao: 0.9 });
  // b1 concorre no leste (100 de 100); no oeste o nome de B é b2 (15): dispersos = os 100 de b1 no oeste
  ok(r.dispersos.B === 100 && r.retidos.B === 205, `B: 100 dispersos, retém 215 − 10 = 205 (${r.dispersos.B}, ${r.retidos.B})`);
}

// memorial: dados e desenho para os blocos 3, 4 e 6
const memorial = (dados, sistemas, extra = {}) => {
  const res = S.snSimular(dados, sistemas);
  return { res, memo: M.smMemorial(Object.assign({ dados, res, sistemas, ind: S.snIndicadores(res, dados), ordem: S.snOrdemPartidos(res), meta: { titulo: 'T', eleicao: 't', parametros: [] } }, extra)) };
};
const celulas = a => a.linhas.flat().filter(c => c && typeof c === 'object');

console.log('\n== 3 e 4. memorial: retenção por inteiros e voto líquido com o excedente que não leva ==');
{
  // 4 vagas, 2 distritos. A vence os dois distritos pelo candidato (160 e 140) mas tem poucos votos de
  // partido; B e C não vencem distrito. Compensatório com voto líquido: A passa do alvo → 'naoLeva'.
  const xx = estado('xx', 4, [agr('A', 360, [160, 140]), agr('B', 400, [80, 80, 80, 80, 80]), agr('C', 240, [60, 60, 60, 60])]);
  for (const x of S.snProporcional(xx).eleitos) x.cand.eleitoReal = true;
  const base = base2(), desenho = SD.sdDistritar(base, 2);
  const votos = { 'w|1': { c: { a1: 160, b1: 80, b2: 80, b3: 40, c1: 60, c2: 60 }, l: { A: 60 } }, 'e|1': { c: { a2: 140, b3: 40, b4: 80, b5: 80, c3: 60, c4: 60 }, l: {} } };
  const porUf = { xx: { desenho, base, votos } };
  const opBase = { pctDistrital: 0.5, arred: 'baixo', regra: 'candidato', modelo: 'compensatorio', limiar: 0, porUf };
  // 4: excedente que não leva + voto líquido
  const ssN = [{ id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: Object.assign({}, opBase, { excedente: 'naoLeva', votoLiquido: true }) }];
  const { res: rN, memo: mN } = memorial({ xx }, ssN);
  const su = rN.sims[0].porUf.xx;
  const semCadeira = su.distritos.flatMap(dt => dt.vencedores).filter(w => w.semCadeira).length;
  ok(semCadeira >= 1, `o caso tem vencedor de distrito sem cadeira pelo excedente (${semCadeira})`);
  ok(su.liquido.A === 360 - 300, `o simulador desconta de A os votos dos DOIS vencedores, também o que ficou sem a cadeira (${su.liquido.A})`);
  ok(su.distritos.every(dt => dt.vencedores.every(w => typeof w.votosDistrito === 'number')), 'cada vencedor de distrito leva os seus votos próprios ali (votosDistrito), para o memorial');
  const cN = mN.conferencias['Distrital misto'];
  ok(cN.nao === 0 && cN.n > 5, `memorial: as ${cN.n} conferências batem (antes, o voto líquido de A divergia) (${cN.nao} divergência(s))`);
  ok(mN.abas.find(x => x.nome === 'Distrital misto').linhas.some(l => /inclui os vencedores que ficaram sem a cadeira/.test(l[0] || '')), 'e o memorial diz que o desconto inclui quem ficou sem a cadeira');
  // 3: retenção de 90% — a fórmula usa a fração não retida em milionésimos
  const ssR = [{ id: 'distrital', nome: 'Distrital misto', tipo: 'distrital', op: Object.assign({}, opBase, { retencao: 0.9 }) }];
  const { memo: mR } = memorial({ xx }, ssR);
  const cel = celulas(mR.abas.find(x => x.nome === 'Distrital misto'));
  ok(cel.some(c => /^C\d+-MIN\(C\d+,ROUND\(100000\*D\d+\/1000000,0\)\)$/.test(c.f || '')), 'memorial: retidos = votos − MÍN(votos; ARRED(100000 × dispersos ÷ 1.000.000))');
  ok(!cel.some(c => /\(1-0\.9\)/.test(c.f || '')), 'e não mais ARRED((1 − 0,9) × dispersos), que o Excel podia arredondar para o outro lado');
  ok(mR.conferencias['Distrital misto'].nao === 0, 'as conferências da retenção batem');
}

console.log('\n== 5. desenho com erro não derruba a simulação ==');
{
  const vazio = SD.sdDistritar({ unidades: [], viz: {} }, 0);
  ok(!!vazio.erro && Array.isArray(vazio.distritos) && vazio.distritos.length === 0, 'estado sem unidades: o desenho vem com o erro E a lista de distritos vazia');
  const d = estado('ro', 3, [agr('A', 600, [300, 200, 100]), agr('B', 400, [250, 150])]);
  let r = null, erro = null;
  try { r = SD.sdDistritalMisto(d, { regra: 'partido', modelo: 'paralelo', desenho: { erro: 'sem unidades' }, base: { unidades: [], viz: {} }, votos: {} }); } catch (e) { erro = e; }
  ok(!erro && r && r.nDistritos === 0 && r.eleitos.length === 3 && r.eleitos.every(e => e.fase === 'lista'), `desenho só com { erro }: nenhum distrito, as 3 vagas pela lista (${erro ? erro.message : r.eleitos.length})`);
  const tela = ler('sistemas/sistemas-tela.js');
  const sim = tela.slice(tela.indexOf('async function siSimular()'), tela.indexOf('function siResumoStatus()'));
  ok(/try \{[\s\S]*snSimular\(si\.dados, sistemas\)[\s\S]*\} catch \(e\) \{[\s\S]*Não foi possível simular/.test(sim), 'a tela: erro na simulação vira aviso, em vez de ficar na barra de progresso');
  ok(tela.indexOf('if (desenho.erro) return h') < tela.indexOf("if (!(desenho.distritos || []).length) return h"), 'e o quadro do estado mostra o motivo do erro antes de "nenhuma vaga em distritos"');
}

console.log('\n== 6. Próxima cadeira: a regra atual é a do card Proporcional ==');
{
  const xa = estado('xa', 5, [agr('A', 500, [260, 180, 45, 15]), agr('B', 250, [18, 12]), agr('C', 150, [140, 10]), agr('D', 100, [100])]);
  for (const x of S.snProporcional(xa).eleitos) x.cand.eleitoReal = true;
  const ADI = { pctQP: 0.10, pctPartido: 0, pctCandidato: 0.20, terceiraFaseAberta: true, federacoes: true, sobras: 'restos', umaPorRodada: true };
  const opAtual = { pctQP: 0.1, pctPartido: 0.8, pctCandidato: 0.2, terceiraFaseAberta: true, federacoes: true, sobras: 'dhondt' };
  // Proporcional FORA da seleção do relatório: a lista traz só a ADI 8.036 (também de tipo 'proporcional')
  const ss = [{ id: 'adi8036', nome: 'ADI 8.036', tipo: 'proporcional', op: ADI }];
  const usados = [];
  global.snMargem = S.snMargem; global.snDhondt = S.snDhondt;
  global.snProporcional = (d, op) => { usados.push(op); return S.snProporcional(d, op); };
  memorial({ xa }, ss, { estrategia: { partido: 'B', opAtual } });
  ok(usados.length > 0 && usados.every(op => op === opAtual), `com as opções do card dadas pela tela, a regra atual usa elas (${usados.length} contas, nenhuma com as da ADI)`);
  usados.length = 0;
  memorial({ xa }, ss, { estrategia: { partido: 'B' } });
  ok(usados.length > 0 && usados.every(op => op.sobras !== 'restos'), 'sem elas, vale a regra vigente padrão — nunca a primeira "proporcional" da lista (a ADI)');
  usados.length = 0;
  const comProp = [{ id: 'adi8036', nome: 'ADI 8.036', tipo: 'proporcional', op: ADI }, { id: 'proporcional', nome: 'Proporcional', tipo: 'proporcional', op: opAtual }];
  memorial({ xa }, comProp, { estrategia: { partido: 'B' } });
  ok(usados.length > 0 && usados.every(op => op === opAtual), 'e com o card na lista, acha-o pelo id, esteja em que posição estiver');
  global.snProporcional = S.snProporcional;
  // a tela: siOpAtual lê a lista completa mesmo dentro da seleção do relatório
  const tela = ler('sistemas/sistemas-tela.js');
  const si = { sistemas: ss, todosSistemas: comProp };
  const siOpAtual = new Function('si', 'return ' + tela.match(/const siOpAtual = (.*);/)[1])(si);
  ok(siOpAtual() === opAtual, 'tela: dentro da seleção do relatório, a regra atual vem da lista completa de sistemas');
  si.todosSistemas = null;
  ok(JSON.stringify(siOpAtual()) === '{}', 'tela: sem o card em lugar nenhum, as opções padrão (não as da ADI)');
  ok(/si\.todosSistemas = s0;/.test(tela) && /si\.todosSistemas = null; \}/.test(tela) && /const opP = siOpAtual\(\);/.test(tela) && /opAtual: siOpAtual\(\)/.test(tela),
    'tela: a seleção guarda a lista completa, a Próxima cadeira e o memorial usam siOpAtual');
}

console.log('\n== 7. QE sem o card Proporcional ==');
{
  const tela = ler('sistemas/sistemas-tela.js');
  const siQe = new Function('snQuociente', 'return ' + tela.match(/const siQe = (.*);/)[1])(S.snQuociente);
  ok(siQe({ validos: 1000, vagas: 3, qeTse: null }) === 333 && siQe({ validos: 1000, vagas: 6, qeTse: null }) === 167, 'QE pelo art. 106 com `qeTse` nulo (dados abertos): 333 e 167, não 0');
  ok(!/\{ qe: d\.qeTse \}/.test(tela) && (tela.match(/\{ qe: siQe\(d\) \}/g) || []).length === 2, 'os dois pontos do relatório (estado a estado e detalhe) usam siQe');
}

console.log('\n== 8. a chave da memória dos desenhos leva kF ==');
{
  const tela = ler('sistemas/sistemas-tela.js');
  const m = tela.match(/const chave = `([^`]*)`;/);
  ok(m && /\$\{modo === 'ani' \|\| modo === 'ind' \? '\|f' \+ kF : ''\}/.test(m[1]), 'estaduais com mapa próprio: encaixe e federal de referência dependem de kF, que entra na chave');
  const chave = new Function('si', 'uf', 'siCargoArq', 'modo', 'k', 'kF', 'op', 'siTolChave', 'return `' + m[1] + '`');
  const arg = (modo, kF) => chave({ op: { ano: 2026 } }, 'sp', () => '7', modo, 12, kF, { base: 'eleitorado', tol: { modo: 'medir' } }, () => '');
  ok(arg('ind', 4) !== arg('ind', 5) && arg('ani', 4) !== arg('ani', 6), 'mesmo nº de distritos estaduais com outro nº de federais: outra chave');
  ok(arg('u', 4) === arg('u', 5) && arg('fed', 4) === arg('fed', 5), 'federal e estaduais nos distritos federais: a chave não muda (k já diz tudo)');
}

console.log('\n== 9. leitura cancelada ou que falhou devolve o PDF e o memorial ==');
{
  const tela = ler('sistemas/sistemas-tela.js');
  const lerFn = tela.slice(tela.indexOf('async function siLer(forcar)'), tela.indexOf('function siTravar(sim)'));
  ok(/let trocou = false;/.test(lerFn) && /si\.dados = dados; si\.ufSel = ufSel; trocou = true;/.test(lerFn), 'siLer marca quando os dados da tela mudaram');
  ok(/finally \{\s*siTravar\(false\);[\s\S]*if \(!trocou\) siSelRelPintar\(\);/.test(lerFn), 'e, se não mudaram (cancelada ou falhou), repinta os botões do resultado que continua na tela');
}

console.log('\n== 10. votos por distrito somados uma vez por simulação ==');
{
  const d = estado('xx', 4, [agr('A', 700, [500, 200]), agr('B', 220, [220])]);
  const base = base2(), desenho = SD.sdDistritar(base, 2);
  // conta as leituras do mapa de votos (uma por unidade e zona, a cada soma)
  let leituras = 0;
  const cru = { 'w|1': { c: { a1: 300, a2: 50, b1: 100 }, l: {} }, 'e|1': { c: { a1: 200, a2: 150, b1: 120 }, l: {} } };
  const votos = new Proxy(cru, { get: (t, k) => { leituras++; return t[k]; } });
  SD.sdDistritalMisto(d, { regra: 'candidato', modelo: 'paralelo', desenho, base, votos });
  const n1 = leituras;
  const ficha = SD.sdFichaCandidatos(d, desenho, base, votos, ['a1', 'b1']);
  ok(n1 === 2 && leituras === n1, `a ficha dos candidatos reaproveita a soma da eleição (${n1} leituras, depois ${leituras})`);
  ok(ficha.length === 2 && ficha[0].votosDistrito === 300, 'e o resultado da ficha é o mesmo');
  // outro mapa de votos (ou outro estado): soma de novo
  SD.sdVotosDistritos(d, desenho, base, new Proxy(cru, { get: (t, k) => { leituras++; return t[k]; } }));
  ok(leituras === n1 + 2, 'com outros votos, a soma é refeita (a memória vale só para os mesmos objetos)');
  const outro = Object.assign({}, desenho, { distritos: desenho.distritos.slice().reverse() });
  ok(SD.sdVotosDistritos(d, outro, base, votos)[0].id === outro.distritos[0].id, 'e outro desenho tem a sua própria soma');
}

// ------------------------------------------------------------------ demais relatórios (aderencia.html)
const html = ler('aderencia.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);
let rota = () => null;
const chamadas = [];
const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => '' });
const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: async (url, op) => {
    chamadas.push((op && op.method ? op.method + ' ' : '') + String(url));
    const r = rota(String(url), op || {});
    if (r instanceof Error) throw r;
    return r || resp({}, 599);
  },
  requestAnimationFrame: () => 0,
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => true,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => ler(s)).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
av('sleep = async () => {}');   // as esperas entre tentativas não interessam ao teste

(async () => {
  console.log('\n== 17. nova tentativa nos Relatórios (fetchJsonRetry) ==');
  {
    // Isolada, com rede, espera e relógio de mentira.
    const src = ler('aderencia.js');
    const i0 = src.indexOf('const _relForaAte = new Map();');
    const corpo = src.slice(i0, src.indexOf('\n}\n', i0) + 2);
    let fila = [], pedidos = 0, agora = 1e6, demora = 0;
    const fetchFalso = async () => { pedidos++; agora += demora; const r = fila.shift(); if (r instanceof Error) throw r; return r; };
    const novo = () => new Function('fetch', 'sleep', 'Date', corpo + '; return fetchJsonRetry;')(fetchFalso, async () => {}, { now: () => agora });
    let fj = novo(), erro = null;
    fila = [resp({}, 404), resp({}, 404), resp({}, 404)]; pedidos = 0;
    try { await fj('https://x/nao-existe'); } catch (e) { erro = e; }
    ok(erro && erro.message === 'HTTP 404' && pedidos === 1, `404: um pedido só, e o erro sobe (${pedidos} pedido(s))`);
    fila = [resp({}, 503), resp({}, 503), resp({}, 503)]; pedidos = 0; erro = null;
    try { await fj('https://x/fora'); } catch (e) { erro = e; }
    ok(erro && erro.message === 'HTTP 503' && pedidos === 3, `503 rápido: três tentativas (${pedidos})`);
    fila = [resp({}, 429), resp({ dados: [7] })]; pedidos = 0;
    ok((await fj('https://x/limite')).dados[0] === 7 && pedidos === 2, '429 e depois 200: lê na segunda');
    fila = [new Error('rede'), new Error('rede'), resp({ dados: [1] })]; pedidos = 0;
    ok((await fj('https://x/rede')).dados[0] === 1 && pedidos === 3, 'falha de rede: repete e lê na terceira');
    // falha LENTA = servidor fora do ar: não repete, e os pedidos seguintes falham na hora por 60 s
    fj = novo(); demora = 9000; fila = [resp({}, 504), resp({ dados: [1] })]; pedidos = 0; erro = null;
    try { await fj('https://api.camara/x'); } catch (e) { erro = e; }
    ok(erro && erro.message === 'HTTP 504' && pedidos === 1, `504 depois de 9 s: NÃO repete (${pedidos} pedido)`);
    demora = 0; erro = null;
    try { await fj('https://api.camara/y'); } catch (e) { erro = e; }
    ok(erro && /fora do ar/.test(erro.message) && pedidos === 1, 'e o pedido seguinte ao mesmo servidor falha na hora, sem ir à rede');
    fila = [resp({ dados: [3] })];
    ok((await fj('https://outro.servidor/z')).dados[0] === 3, 'outro servidor não é afetado');
    agora += 61000; fila = [resp({ dados: [2] })];
    ok((await fj('https://api.camara/y')).dados[0] === 2, 'passados os 60 s, volta a consultar');
    fj = novo(); fila = [Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }), resp({ dados: [1] })]; pedidos = 0; erro = null;
    try { await fj('https://api.camara/x'); } catch (e) { erro = e; }
    ok(erro && /não respondeu em 25 s/.test(erro.message) && pedidos === 1, 'prazo de 25 s estourado: não repete, e a mensagem diz o que houve');

    // Na página: a função dos Relatórios não é mais encoberta pela de ia-comum.js
    ok(av('typeof fetchJsonRetry') === 'function' && av('fetchJsonRetry !== fetchJson'), 'na página, fetchJsonRetry existe com nome próprio (o fetchJson de ia-comum.js não a encobre)');
    for (const arq of ['aderencia.js', 'aderencia-legislatura.js', 'producao.js', 'radar.js', 'leisaprovadas.js']) {
      const t = ler(arq).replace(/^\s*(\/\/|\*).*$/gm, '');
      ok(!/(?<![\w.])fetchJson\(/.test(t), `${arq}: nenhuma chamada ao fetchJson sem nova tentativa`);
    }
    let n = 0;
    rota = () => (++n < 3 ? resp({}, 503) : resp({ dados: [9] }));
    ok((await av(`fetchJsonRetry('https://dadosabertos.camara.leg.br/api/v2/x')`)).dados[0] === 9 && n === 3, 'na página: dois 503 e depois 200 → lê na terceira');
  }

  // Partido X: Ana (1) e Caio (3). v1 lida; v2 com os votos fora do ar (404).
  const dep = (id, nome, partido) => ({ id, nome, siglaPartido: partido, siglaUf: 'SP' });
  const HIST = { 1: [{ dataHora: '2023-02-01T12:00', siglaPartido: 'X', situacao: 'Exercício', idLegislatura: 57 }],
    3: [{ dataHora: '2023-02-01T12:00', siglaPartido: 'X', situacao: 'Exercício', idLegislatura: 57 }] };
  const rotaAder = (V, VOTOS, falha = {}) => (u) => {
    let m;
    if (u.includes('/aderencia-cache')) return resp(null);
    if (/\/votacoes\?dataInicio=/.test(u)) return resp({ dados: V, links: [] });
    if ((m = u.match(/\/votacoes\/(v\d)\/votos/))) return falha[m[1]] ? resp({}, 404) : resp({ dados: VOTOS[m[1]] });
    if ((m = u.match(/\/votacoes\/(v\d)\/orientacoes/))) return resp({ dados: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }] });
    if (u.includes('/deputados?siglaPartido=X')) return resp({ dados: [dep(1, 'Ana', 'X'), dep(3, 'Caio', 'X')] });
    if ((m = u.match(/\/deputados\/(\d+)\/historico/))) return resp({ dados: HIST[m[1]] || [] });
    return null;
  };
  const gerar = async (ini, fim) => {
    document.getElementById('dataIni').value = ini;
    document.getElementById('dataFim').value = fim;
    document.getElementById('partido').value = 'X';
    av('window._relatorioCtx = null');
    await av('gerarRelatorio()');
    return av('window._relatorioCtx');
  };

  console.log('\n== 13. votação que não pôde ser lida: fora do cálculo, contada e avisada ==');
  {
    const V = [{ id: 'v1', data: '2026-08-10', dataHoraRegistro: '2026-08-10T15:00:00', siglaOrgao: 'PLEN', descricao: 'Votação 1' },
      { id: 'v2', data: '2026-08-12', dataHoraRegistro: '2026-08-12T15:00:00', siglaOrgao: 'PLEN', descricao: 'Votação 2' }];
    const VOTOS = { v1: [{ deputado_: dep(1, 'Ana', 'X'), tipoVoto: 'Sim' }, { deputado_: dep(3, 'Caio', 'X'), tipoVoto: 'Não' }], v2: [] };
    rota = rotaAder(V, VOTOS, { v2: true });
    const c = await gerar('2026-08-10', '2026-08-12');
    ok(c && c.qualifying.length === 1 && c.falhasVotacoes === 1, `1 votação no cálculo e 1 contada como não lida (${c && c.qualifying.length}, ${c && c.falhasVotacoes})`);
    const tela = av('resultadoEl.innerHTML');
    ok(/1 votação\(ões\) do Plenário no período não pôde ser lida na API da Câmara e ficou fora do cálculo/.test(tela), 'a tela avisa que uma votação ficou fora do cálculo');
    // 429 passageiro nos votos de v2: com a nova tentativa, a votação entra no cálculo
    let batidas = 0;
    const base = rotaAder(V, Object.assign({}, VOTOS, { v2: [{ deputado_: dep(1, 'Ana', 'X'), tipoVoto: 'Sim' }] }));
    rota = u => (/\/votacoes\/v2\/votos/.test(u) && ++batidas === 1 ? resp({}, 429) : base(u));
    const cr = await gerar('2026-08-10', '2026-08-12');
    ok(cr && cr.qualifying.length === 2 && cr.falhasVotacoes === 0 && batidas === 2, `429 e depois 200 nos votos: as 2 votações contam, nenhuma "não lida" (${cr && cr.qualifying.length}, ${cr && cr.falhasVotacoes})`);
    // todas falharam: o "nenhuma votação qualificada" vem com o aviso, não sozinho
    rota = rotaAder(V, VOTOS, { v1: true, v2: true });
    await gerar('2026-08-10', '2026-08-12');
    const vazio = av('resultadoEl.innerHTML');
    ok(/2 votação\(ões\)[^<]*não puderam ser lidas/.test(vazio) && /Nenhuma votação qualificada/.test(vazio), 'todas falharam: "nenhuma qualificada" vem junto com o aviso das que não foram lidas');
    // documento do período: o aviso vai junto
    rota = rotaAder(V, VOTOS, { v2: true });
    const c2 = await gerar('2026-08-10', '2026-08-12');
    ctx.__L = av('legDoRelatorio(window._relatorioCtx)');
    ok(ctx.__L.falhasVotacoes === 1 && /não pôde ser lida na API da Câmara e ficou fora do cálculo/.test(av(`legHtmlPDF(__L, '')`)), 'o PDF do período leva o mesmo aviso');
    void c2;
  }

  console.log('\n== 15 e 14. sem voto Sim/Não: "—", não 0% nem NaN% ==');
  {
    // a bancada (Ana e Caio) não votou; só um deputado de outro partido
    const V = [{ id: 'v1', data: '2026-08-10', dataHoraRegistro: '2026-08-10T15:00:00', siglaOrgao: 'PLEN', descricao: 'Votação 1' }];
    const VOTOS = { v1: [{ deputado_: dep(9, 'Outro', 'Y'), tipoVoto: 'Sim' }] };
    rota = rotaAder(V, VOTOS);
    const c = await gerar('2026-08-10', '2026-08-10');
    ok(c && c.overallPct === null && c.totalAusente === 2, `a aderência geral fica sem número (null), com 2 ausências (${c && c.overallPct})`);
    const tela = av('resultadoEl.innerHTML');
    ok(/<div class="big-pct">—<\/div>/.test(tela) && !/big-pct">0\.0/.test(tela), 'o número grande mostra "—", não 0.0%');
    const g = av(`agruparPorPeriodo(window._relatorioCtx.qualifying, '2026-08-10', '2026-08-10', 2)`);
    ok(g.length === 1 && g[0].pct === null, 'o balde do gráfico temporal fica sem porcentagem (a barra sai "—")');
    // gráfico temporal e rosca: o texto desenhado
    const textos = [];
    const tela2d = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
      setLineDash() {}, measureText: () => ({ width: 10 }), fillText: t => textos.push(String(t)) };
    ctx.__cv = { getContext: () => tela2d, style: {}, parentElement: { clientWidth: 500 }, width: 0, height: 0 };
    ctx.__g = g;
    av('drawTemporalChart(__cv, __g)');
    ok(textos.includes('—') && !textos.includes('NaN%'), 'gráfico temporal: a barra sem voto Sim/Não leva "—"');
    ok(textos.filter(t => t === '0%').length === 1, '(o único "0%" desenhado é o do eixo)');
    textos.length = 0;
    av('drawAdherenceDonut(__cv, null, 120)');
    ok(textos.join() === '—', `rosca sem voto Sim/Não: "—" (${textos.join()})`);
    textos.length = 0;
    av('drawAdherenceDonut(__cv, 0, 120)');
    ok(textos.join() === '0.0%', 'rosca com 0% de verdade (todos divergiram): continua 0.0%');
    // 14: documentos do período com total sem voto Sim/Não
    ok(av(`legTaxa(0, 0)`) === '—' && av(`legTaxa(1, 2)`) === '50,0%', 'legTaxa: 0 ÷ 0 é "—"; 1 ÷ 2 é 50,0%');
    ctx.__L = av('legDoRelatorio(window._relatorioCtx)');
    const pdf = av(`legHtmlPDF(__L, '')`);
    ok(ctx.__L.todos.n === 0 && !/NaN/.test(pdf) && /—/.test(pdf), 'PDF do período só de ausências: nenhum "NaN%"');
    ok(!/legPct\(100 \* [\w.]+ \/ [\w.]+\)/.test(ler('aderencia-legislatura.js')), 'nenhuma divisão direta pelo total sobrou nos documentos (PDF e Word usam legTaxa)');
    av('legRenderTela(Object.assign({}, __L, { modo: "legislatura", leg: 57 }))');
    ok(!/NaN/.test(av('resultadoEl.innerHTML')), 'tela da legislatura: sem "NaN" quando o total não tem voto Sim/Não');
  }

  console.log('\n== 16. o recorte dos documentos usa a data da seleção ==');
  {
    ok(av(`legDataVot({ votacao: { data: '2026-12-31', dataHoraRegistro: '2027-01-01T00:30:00' } })`) === '2026-12-31', 'sessão que passa da meia-noite: vale o dia da votação (`data`), não o do registro');
    ok(av(`legDataVot({ votacao: { dataHoraRegistro: '2026-08-10T15:00:00' } })`) === '2026-08-10', 'sem `data`, o dia do registro');
    // a votação de 12/08 registrada às 00h20 de 13/08 fica no documento de 10 a 12/08
    const V = [{ id: 'v1', data: '2026-08-12', dataHoraRegistro: '2026-08-13T00:20:00', siglaOrgao: 'PLEN', descricao: 'Votação da madrugada' }];
    const VOTOS = { v1: [{ deputado_: dep(1, 'Ana', 'X'), tipoVoto: 'Sim' }, { deputado_: dep(3, 'Caio', 'X'), tipoVoto: 'Sim' }] };
    rota = rotaAder(V, VOTOS);
    const c = await gerar('2026-08-10', '2026-08-12');
    const L = av('legDoRelatorio(window._relatorioCtx)');
    ok(c.qualifying.length === 1 && L.todos.v === 1, `a tela conta 1 votação e o documento também (${c.qualifying.length}, ${L.todos.v})`);
    let rot = null, erro = null;
    try { rot = av(`legRotulos({ modo: 'periodo', anos: [], ini: '2026-08-01', fim: '2026-08-31', leg: 57, hoje: '2026-11-11', sigla: 'X' })`); } catch (e) { erro = e; }
    ok(!erro && rot && rot.arquivo === '2026-08-01-a-2026-08-31', 'período sem nenhum ano com votação: os rótulos saem do período pedido, sem erro');
  }

  console.log('\n== 18. texto do cache é escapado ==');
  {
    const mau = '<img src=x onerror=alert(1)>';
    const V = [{ id: 'v1', data: '2026-08-10', dataHoraRegistro: '2026-08-10T15:00:00', siglaOrgao: 'PLEN', descricao: 'Votação 1' }];
    const VOTOS = { v1: [{ deputado_: dep(1, 'Ana', 'X'), tipoVoto: mau }, { deputado_: dep(3, 'Caio', 'X'), tipoVoto: 'Sim' }] };
    rota = rotaAder(V, VOTOS);
    const c = await gerar('2026-08-10', '2026-08-10');
    ctx.__m = c.depMetrics.find(m => m.dep.id === 1);
    const det = av('buildDepDetailHTML(__m, window._relatorioCtx)');
    ok(!det.includes('<img') && det.includes('&lt;img src=x onerror=alert(1)&gt;'), 'detalhe do deputado: o voto vai escapado (no texto e no title)');
    const el = document.createElement('div');
    ctx.__el = el;
    av('renderVoteDetail(__el, window._relatorioCtx.qualifying[0], window._relatorioCtx)');
    ok(!el.querySelector('img') && el.innerHTML.includes('&lt;img'), 'detalhe da votação: idem');
  }

  // ---------------- Leis aprovadas ----------------
  const FIRE = {};
  let falharLeitura = new Set(), falharApagar = new Set();
  const rotaLea = (u, op) => {
    const m = u.match(/\/leis_aprovadas\/(\d+)\.json/);
    if (!m) return null;
    if (op.method === 'DELETE') { if (falharApagar.has(m[1])) return resp({}, 500); delete FIRE[m[1]]; return resp(null); }
    if (falharLeitura.has(m[1])) return resp({}, 503);
    return resp(FIRE[m[1]] || null);
  };
  const marcar = legs => document.querySelectorAll('.lea-leg').forEach(c => { c.checked = legs.includes(c.value); });
  const statusLea = () => document.getElementById('leaStatus');
  const atual = av('leaLegislaturaAtual()');
  const agregado = (rotulo, extra = {}) => Object.assign({ rotulo, atualizadoEm: new Date().toISOString(),
    ranking: [{ depId: 1, nome: 'Ana Fulana', partido: 'PODE', uf: 'SP', total: 1 }],
    projetos: [{ id: 950, tipo: 'PL', numero: 1, ano: 2023, ementa: 'Lei.', dataApresentacao: '2023-05-01', autores: [1] }] }, extra);

  console.log('\n== 12. Leis aprovadas: falha de leitura não é "ainda não coletada" ==');
  {
    rota = rotaLea;
    FIRE[atual] = agregado(atual + 'ª'); FIRE['56'] = agregado('56ª');
    falharLeitura = new Set(['56']);
    marcar(['56']);
    await av('leaConsultar()');
    ok(/Não foi possível ler o banco de dados: 56ª \(HTTP 503\)/.test(statusLea().textContent) && /error/.test(statusLea().className), `a falha é dita, com a legislatura e o motivo (${statusLea().textContent.trim().slice(0, 80)})`);
    ok(!/Nenhum dado agregado ainda/.test(document.getElementById('leaResultado').innerHTML) && !document.querySelector('#leaResultado .lea-coletar'), 'e a tela NÃO diz "ainda não coletada" nem oferece nova coleta');
    ok(av('lea.cache["56"]') === undefined, 'a legislatura que falhou não fica na memória como "sem dado"');
    falharLeitura = new Set();
    await av('leaConsultar()');
    ok(av('lea.linhas.length') === 1 && !/error/.test(statusLea().className), 'na tentativa seguinte, com o banco no ar, o dado aparece');
    // sugestões de nome: sem sugestão quando a leitura falha, e sem erro
    falharLeitura = new Set(['55']);
    marcar(['55']);
    document.getElementById('leaNome').value = 'Ana';
    let erro = null;
    try { await av('leaNomeDigitado()'); } catch (e) { erro = e; }
    ok(!erro && document.getElementById('leaEscolha').innerHTML === '', 'sugestão de nome: leitura que falha fica sem sugestão, sem erro');
    document.getElementById('leaNome').value = '';
    falharLeitura = new Set();
  }

  console.log('\n== 11. Leis aprovadas: apagar ==');
  {
    FIRE['56'] = agregado('56ª'); FIRE['55'] = agregado('55ª');
    marcar(['56', '55']);
    await av('leaConsultar()');
    falharApagar = new Set(['55']);
    chamadas.length = 0;
    await av('leaLimparClick()');
    const txt = statusLea().textContent;
    ok(/NÃO foi possível apagar: 55ª \(HTTP 500\)/.test(txt) && /Apagado: 56ª/.test(txt) && /error/.test(statusLea().className), `falha ao apagar é dita, separando o que foi do que não foi (${txt.trim().slice(0, 90)})`);
    ok(!/^Apagado no banco de dados/.test(txt.trim()), 'e não a mensagem de sucesso');
    ok(!!FIRE['55'] && !FIRE['56'], '(no banco de mentira: a 55ª continua lá, a 56ª saiu)');
    // depois de apagar, uma coleta nova aparece no próximo "Buscar"
    FIRE['56'] = agregado('56ª', { ranking: [{ depId: 2, nome: 'Beto Novo', partido: 'PODE', uf: 'RJ', total: 3 }] });
    marcar(['56']);
    chamadas.length = 0;
    await av('leaConsultar()');
    ok(chamadas.some(c => c.includes('/leis_aprovadas/56.json') && !c.startsWith('DELETE')), 'depois de apagada, a legislatura é lida de novo do banco');
    ok(av('lea.linhas.length') === 1 && av('lea.linhas[0].nome') === 'Beto Novo', 'e a coleta feita depois do apagamento aparece (antes: "sem dado" até recarregar)');
    falharApagar = new Set();
    await av('leaLimparClick()');
    ok(/^Apagado no banco de dados: 56ª/.test(statusLea().textContent.trim()), 'apagamento que deu certo: a mensagem de sucesso');
  }

  console.log('\n== 18. Leis aprovadas: campos do banco escapados ==');
  {
    const mau = '"><img src=x onerror=alert(1)>';
    FIRE['56'] = agregado('56ª', { ranking: [{ depId: mau, nome: 'Ana Fulana', partido: 'PODE', uf: 'SP', total: mau }],
      projetos: [{ id: mau, tipo: 'PL', numero: 1, ano: 2023, ementa: 'Lei.', dataApresentacao: '2023-05-01', autores: [mau] }] });
    marcar(['56']);
    await av('leaConsultar()');
    const res = document.getElementById('leaResultado');
    ok(!res.querySelector('img'), 'ranking: nenhum elemento nasce do total ou do id do deputado');
    ctx.__d = av('lea.linhas[0]');
    const det = av('leaDetalheHtml(__d)');
    ok(!det.includes('<img') && det.includes('idProposicao=%22%3E%3Cimg'), 'link da ficha: o id vai codificado na URL');
    ctx.__lista = [{ depId: mau, nome: 'Ana', partido: 'PODE', uf: 'SP', legs: ['56'], total: mau }];
    av('leaRenderEscolha(__lista)');
    ok(!document.getElementById('leaEscolha').querySelector('img'), 'sugestões de nome: idem');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
