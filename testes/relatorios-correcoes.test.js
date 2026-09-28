// Correções da varredura de 28/09/2026 no módulo Relatórios (aderencia.html).
//
// O que este teste trava:
//  1. Aderência pede à API um dia A MAIS e descarta o excedente — medido em
//     28/09/2026, "13/09 a 13/09" devolve 1 das 14 votações do Plenário no dia;
//  2. a aderência do partido é medida contra quem ERA do partido, em exercício,
//     em cada votação: quem saiu depois conta nas votações em que estava, quem
//     entrou depois não é cobrado antes de entrar, e "Ausente" nunca fica
//     negativo. O histórico usa só entradas da legislatura da votação (a API
//     data com 2023 registros da 54ª);
//  3. Como votou: votação que falhou ao carregar não é "simbólica";
//  4. Radar: recorte pela data de apresentação (inclui `ano: 0`), limite de 8
//     anos contando os extremos, e o aviso de truncamento sobrevive ao "só da
//     bancada";
//  5. Produção: o aviso de truncamento não manda mais "filtrar por ano";
//  6. Leis aprovadas: coleta não gravada é dita como não gravada;
//  7. datas padrão dos formulários são LOCAIS, não UTC.
//
// Uso: node testes/relatorios-correcoes.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// A API de mentira: cada teste troca `rota`.
let rota = () => null;
const chamadas = [];
const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => '' });

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: async (url, op) => {
    chamadas.push(String(url));
    const r = rota(String(url), op || {});
    return r || resp({}, 599);
  },
  requestAnimationFrame: () => 0,
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

// Histórico REAL de Romero Rodrigues (160629), lido da API em 28/09/2026:
// PSC na posse, PODE a partir de 22/08/2023, licença em 06/07/2026 — e uma
// entrada da 54ª legislatura datada de 01/02/2023, que é a armadilha.
const HIST_ROMERO = [
  { dataHora: '2023-02-01T00:00', siglaPartido: 'PSC', situacao: null, idLegislatura: 57 },
  { dataHora: '2023-02-01T12:05', siglaPartido: 'PSC', situacao: 'Exercício', idLegislatura: 57 },
  { dataHora: '2023-08-22T00:00', siglaPartido: 'PODE', situacao: 'Exercício', idLegislatura: 57 },
  { dataHora: '2026-07-06T23:58', siglaPartido: 'PODE', situacao: 'Licença', idLegislatura: 57 },
  { dataHora: '2011-02-01T00:00', siglaPartido: 'PSDB', situacao: 'Exercício', idLegislatura: 54 },
  { dataHora: '2013-01-01T00:00', siglaPartido: 'PSDB', situacao: 'VACANCIA', idLegislatura: 54 },
  { dataHora: '2023-02-01T00:00', siglaPartido: 'PSDB', situacao: null, idLegislatura: 54 },
];

(async () => {
  console.log('== partido e situação na data, pelo histórico ==');
  {
    ctx.__h = HIST_ROMERO;
    const s1 = av(`aderSituacaoNaData(__h, '2023-05-10T15:00:00')`);
    ok(s1.partido === 'PSC' && s1.situacao === 'Exercício', `maio/2023: PSC, em exercício (${JSON.stringify(s1)})`);
    const s2 = av(`aderSituacaoNaData(__h, '2023-09-13T19:00:00')`);
    ok(s2.partido === 'PODE' && s2.situacao === 'Exercício', 'setembro/2023: PODE, em exercício');
    const s3 = av(`aderSituacaoNaData(__h, '2026-08-01T15:00:00')`);
    ok(s3.partido === 'PODE' && s3.situacao === 'Licença', 'agosto/2026: de licença — não conta como bancada');
    const s4 = av(`aderSituacaoNaData(__h, '2023-02-01T06:00:00')`);
    ok(s4.partido === 'PSC', 'a entrada da 54ª datada de 01/02/2023 NÃO vira o partido de 2023 (seria PSDB)');
    ok(s4.situacao === null, 'e antes da posse não há situação — não é bancada');
  }

  console.log('\n== aderência: último dia e bancada de cada votação ==');
  {
    // Partido X. Três deputados:
    //  1 (Ana)  — em X o período todo; faltou à votação 2 → ausente ali;
    //  2 (Beto) — votou por X na votação 1 e depois saiu (não está na bancada de hoje);
    //  3 (Caio) — entrou em X depois da votação 1; faltou a ela → NÃO é cobrado.
    // Votação 3 é do dia seguinte ao fim do período: veio porque se pediu um
    // dia a mais, e tem de ser descartada.
    const V = [
      { id: 'v1', data: '2026-08-10', dataHoraRegistro: '2026-08-10T15:00:00', siglaOrgao: 'PLEN', descricao: 'Votação 1' },
      { id: 'v2', data: '2026-08-12', dataHoraRegistro: '2026-08-12T15:00:00', siglaOrgao: 'PLEN', descricao: 'Votação 2' },
      { id: 'v3', data: '2026-08-13', dataHoraRegistro: '2026-08-13T15:00:00', siglaOrgao: 'PLEN', descricao: 'Fora do período' },
    ];
    const dep = (id, nome, partido) => ({ id, nome, siglaPartido: partido, siglaUf: 'SP' });
    const VOTOS = {
      v1: [{ deputado_: dep(1, 'Ana', 'X'), tipoVoto: 'Sim' }, { deputado_: dep(2, 'Beto', 'X'), tipoVoto: 'Não' },
           { deputado_: dep(9, 'Outro', 'Y'), tipoVoto: 'Sim' }],
      v2: [{ deputado_: dep(3, 'Caio', 'X'), tipoVoto: 'Sim' }, { deputado_: dep(2, 'Beto', 'Y'), tipoVoto: 'Sim' },
           { deputado_: dep(9, 'Outro', 'Y'), tipoVoto: 'Sim' }],
      v3: [{ deputado_: dep(1, 'Ana', 'X'), tipoVoto: 'Não' }],
    };
    const HIST = {
      1: [{ dataHora: '2023-02-01T12:00', siglaPartido: 'X', situacao: 'Exercício', idLegislatura: 57 }],
      2: [{ dataHora: '2023-02-01T12:00', siglaPartido: 'X', situacao: 'Exercício', idLegislatura: 57 },
          { dataHora: '2026-08-11T10:00', siglaPartido: 'Y', situacao: 'Exercício', idLegislatura: 57 }],
      3: [{ dataHora: '2023-02-01T12:00', siglaPartido: 'Z', situacao: 'Exercício', idLegislatura: 57 },
          { dataHora: '2026-08-11T10:00', siglaPartido: 'X', situacao: 'Exercício', idLegislatura: 57 }],
    };
    rota = (u) => {
      let m;
      if (u.includes('/aderencia-cache')) return resp(null);
      if ((m = u.match(/\/votacoes\?dataInicio=([\d-]+)&dataFim=([\d-]+)/))) return resp({ dados: V, links: [] });
      if ((m = u.match(/\/votacoes\/(v\d)\/votos/))) return resp({ dados: VOTOS[m[1]] });
      if ((m = u.match(/\/votacoes\/(v\d)\/orientacoes/))) return resp({ dados: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }] });
      if (u.includes('/deputados?siglaPartido=X')) return resp({ dados: [dep(1, 'Ana', 'X'), dep(3, 'Caio', 'X')] });
      if ((m = u.match(/\/deputados\/(\d+)\/historico/))) return resp({ dados: HIST[m[1]] || [] });
      return null;
    };
    document.getElementById('dataIni').value = '2026-08-10';
    document.getElementById('dataFim').value = '2026-08-12';
    document.getElementById('partido').value = 'X';
    chamadas.length = 0;
    await av('gerarRelatorio()');

    ok(chamadas.some(u => /\/votacoes\?dataInicio=2026-08-10&dataFim=2026-08-13/.test(u)),
       'pede à API até o dia SEGUINTE ao fim do período (o intervalo da API perde o último dia)');
    const c = av('window._relatorioCtx');
    ok(c && c.qualifying.length === 2, `e descarta o excedente: 2 votações, não 3 (${c && c.qualifying.length})`);

    const [e1, e2] = c.qualifying;
    ok(e1.membros.map(m => m.id).sort().join(',') === '1,2',
       `votação 1: bancada = Ana e Beto (Caio ainda não era do partido) (${e1.membros.map(m => m.id)})`);
    ok(e2.membros.map(m => m.id).sort().join(',') === '1,3',
       `votação 2: bancada = Ana e Caio (Beto já tinha saído, e votou por Y) (${e2.membros.map(m => m.id)})`);
    ok(e1.adherentCount === 1 && e1.divergentCount === 1 && e1.ausenteCount === 0, 'votação 1: 1 aderiu, 1 divergiu, 0 ausente');
    ok(e2.adherentCount === 1 && e2.ausenteCount === 1, 'votação 2: Caio aderiu, Ana ausente');
    ok(c.qualifying.every(e => e.ausenteCount >= 0), '"Ausente" nunca é negativo');
    ok(c.totalPossivel === 4 && c.totalAderiu === 2 && Math.abs(c.overallPct - 50) < 1e-9,
       `total: 2 aderências em 4 votos possíveis = 50% (${c.totalAderiu}/${c.totalPossivel})`);
    ok(c.partySize === 3, `3 deputados passaram pela bancada no período (${c.partySize})`);

    const porDep = Object.fromEntries(c.depMetrics.map(m => [m.dep.id, m]));
    ok(porDep[2] && porDep[2].votacoes === 1 && porDep[2].divergiu === 1 && !porDep[2].naBancadaAtual,
       'Beto, que saiu, é medido só na votação em que estava — e marcado como fora do partido hoje');
    ok(porDep[3] && porDep[3].votacoes === 1 && porDep[3].ausente === 0,
       'Caio, que entrou depois, não é cobrado pela votação anterior à entrada');
    ok(porDep[1].votacoes === 2 && porDep[1].ausente === 1, 'Ana, o período todo: 2 votações, 1 ausência');
    const soma = c.depMetrics.reduce((s, m) => s + m.aderiu, 0);
    ok(soma === c.totalAderiu, 'a soma do ranking bate com o total do partido');
    const grupos = av(`agruparPorPeriodo(window._relatorioCtx.qualifying, '2026-08-10', '2026-08-12', 99)`);
    ok(grupos[0].possiveis === 4, `o gráfico usa a bancada de cada votação, não um tamanho fixo (${grupos[0].possiveis})`);
  }

  console.log('\n== período longo: janelas de até 80 dias (a API recusa mais de 3 meses) ==');
  {
    const j = av(`janelasDeVotacao('2026-06-01', '2026-09-01')`);
    ok(j.length === 2 && j[0][0] === '2026-06-01' && j[1][1] === '2026-09-02',
       `3 meses exatos viram 2 janelas, a última com o dia a mais (${JSON.stringify(j)})`);
    const dias = ([a, b]) => (new Date(b) - new Date(a)) / 864e5;
    const j12 = av(`janelasDeVotacao('2025-09-01', '2026-09-01')`);
    ok(j12.every(x => dias(x) <= 85), `nenhuma janela passa de 85 dias (${j12.map(dias).join(', ')})`);
    ok(j12.every((x, i) => i === 0 || x[0] === j12[i - 1][1]), 'cada janela começa onde a anterior terminou — nenhum dia fica de fora');
    // A API de mentira recusa mais de 3 meses, como a real.
    const rotaAnt = rota;
    const pedidos = [];
    rota = (u) => {
      const m = u.match(/\/votacoes\?dataInicio=([\d-]+)&dataFim=([\d-]+)/);
      if (!m) return rotaAnt(u);
      pedidos.push([m[1], m[2]]);
      if ((new Date(m[2]) - new Date(m[1])) / 864e5 > 92) return resp({ detail: 'A diferença entre as datas não pode ser maior que 3 meses' }, 400);
      return resp({ dados: [{ id: 'x-' + m[1], data: m[1], siglaOrgao: 'PLEN' }, { id: 'dup', data: '2026-08-20', siglaOrgao: 'PLEN' }], links: [] });
    };
    const r = await av(`buscarVotacoesPeriodo('2025-09-01', '2026-09-01')`);
    ok(pedidos.length === j12.length, 'uma consulta por janela, nenhuma recusada');
    ok(r.filter(v => v.id === 'dup').length === 1, 'a mesma votação vinda de duas janelas entra uma vez só');
    rota = rotaAnt;
  }

  console.log('\n== aderência: histórico ilegível cai na regra antiga e é avisado ==');
  {
    const rotaAnterior = rota;
    rota = (u, op) => (/\/deputados\/3\/historico/.test(u) ? resp({}, 500) : rotaAnterior(u, op));
    await av('gerarRelatorio()');
    const c = av('window._relatorioCtx');
    ok(c.falhasHistorico === 1, 'a falha é contada');
    ok(/histórico de 1 deputado/.test(document.getElementById('resultado').textContent), 'e a tela avisa');
    rota = rotaAnterior;
  }

  console.log('\n== Como votou: leitura que falhou não é votação simbólica ==');
  {
    const s = av(`cvSituacao({ nominal: false, falhou: true, votos: [] }, 1)`);
    ok(s.situacao === 'falha', `falha de leitura → "falha" (${s.situacao})`);
    ok(av(`cvSituacao({ nominal: false, falhou: false, votos: [] }, 1)`).situacao === 'simbolica', 'simbólica de verdade continua simbólica');
    ok(av(`CV_ROTULO.falha`) === 'Não lida', 'com rótulo próprio');
  }

  console.log('\n== Radar ==');
  {
    ok(av(`rdrDesignacao({ siglaTipo: 'PRL', numero: 3, ano: 0, dataApresentacao: '2025-06-03T10:00' })`) === 'PRL 3/2025',
       'ano 0 vira o ano da apresentação ("PRL 3/2025", não "PRL 3/0")');

    rota = (u) => (u.includes('/proposicoes?') ? resp({ dados: [], links: [] }) : null);
    chamadas.length = 0;
    await av(`rdrColetar({ tema: '46', palavra: '', tipo: '', anoIni: '2025', anoFim: '2025' })`);
    const janelas = chamadas.filter(u => /proposicoes\?/.test(u) && !/siglaPartidoAutor/.test(u))
      .map(u => u.match(/dataApresentacaoInicio=([\d-]+)&dataApresentacaoFim=([\d-]+)/)).filter(Boolean).map(m => m[1] + '..' + m[2]);
    ok(janelas.join(' ') === '2025-01-01..2025-03-31 2025-04-01..2025-06-30 2025-07-01..2025-09-30 2025-10-01..2025-12-31',
       `recorta pela data de apresentação, um trimestre por consulta (a API recusa mais de 3 meses) (${janelas.join(' ')})`);
    ok(!chamadas.some(u => /[?&]ano=/.test(u)), 'e não por `ano=`, que perde os itens com ano 0');

    document.getElementById('rdrPalavra').value = 'saude';
    document.getElementById('rdrAnoIni').value = '2018';
    document.getElementById('rdrAnoFim').value = '2026';
    await av('rdrConsultar()');
    ok(/Limite de 8 anos/.test(document.getElementById('rdrStatus').textContent), '2018–2026 (9 anos) é recusado');
    document.getElementById('rdrAnoIni').value = '2019';
    chamadas.length = 0;
    await av('rdrConsultar()');
    ok(!/Limite/.test(document.getElementById('rdrStatus').textContent) && chamadas.length > 0, '2019–2026 (8 anos) passa');

    ctx.__dados = { itens: [{ id: 1, siglaTipo: 'PL', numero: 1, ano: 2025, ementa: 'x' }], daBancada: new Set(),
                    truncado: true, filtro: { rotulo: 'Teste', periodo: '2025' } };
    av('rdrRender(__dados)');
    const cx = document.getElementById('rdrSoBancada');
    cx.checked = true; cx.dispatchEvent(new Event('change'));
    cx.checked = false; cx.dispatchEvent(new Event('change'));
    ok(/limite de páginas/.test(document.getElementById('rdrResultado').textContent),
       'o aviso de lista incompleta continua depois de marcar e desmarcar "só da bancada"');
  }

  console.log('\n== Produção: aviso de truncamento ==');
  {
    av(`prdRender({ todas: [{ id: 1, siglaTipo: 'PL', numero: 1, ano: 2025, dataApresentacao: '2025-01-01' }], detalhes: [],
                    dep: { nome: 'Ana', partido: 'X', uf: 'SP' }, ano: '2025', truncado: true, teto: false, semData: 0 })`);
    const t = document.getElementById('prdResultado').textContent;
    ok(!/Filtre por ano/.test(t), 'não manda mais "filtrar por ano", que não resolvia');
    ok(/depois de baixar/.test(t), 'e explica que o ano escolhido pode ter ficado de fora em parte');
  }

  console.log('\n== Leis aprovadas: coleta não gravada ==');
  {
    const leg = av('leaLegislaturaAtual()');
    ctx.__res = { [leg]: { rotulo: 'teste', ranking: [], projetos: [], anosFaltando: [], falhasAutores: 0 } };
    av('leaUpMostrar(__res)');
    const aviso = av('leaAvisoDadoVelho()');
    ok(/NÃO gravada/.test(aviso), 'o aviso diz que a coleta ainda não está no banco');
    ok(!/Ainda não há dado coletado/.test(aviso), 'em vez de dizer que não há dado');
  }

  console.log('\n== datas padrão locais ==');
  {
    ok(av(`isoLocal(new Date(2026, 8, 28, 22, 30))`) === '2026-09-28', '22h30 de 28/09 em Brasília continua 28/09 (UTC já seria 29/09)');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
