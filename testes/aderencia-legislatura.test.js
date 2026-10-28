// Aderência: registro transitório na sigla e relatório da legislatura ano a ano.
//
// O caso (28/10/2026): no relatório de 2026 o Ilacir Bicalho contava como
// bancada do Podemos, e no de 2024 o Duarte Gonçalves Jr. Suplentes eleitos
// pelo PSC: a Câmara os registra como PODE ao convocá-los (incorporação do PSC)
// e os votos dos primeiros dias saem com a sigla PODE, mas dias depois passaram
// ao Republicanos. Regra: entrada na sigla por alteração de partido ainda
// CONVOCADO e saída em até 30 dias → fora da bancada nesse intervalo, com aviso.
// Os eleitos do PSC que ficaram (entrada em exercício, 22/08/2023) não mudam.
//
// Uso: node testes/aderencia-legislatura.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

let rota = () => null;
const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => '' });
const guardado = {};
const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: async (url, op) => rota(String(url), op || {}) || resp({}, 599),
  requestAnimationFrame: () => 0,
  localStorage: { getItem: k => guardado[k] || null, setItem: (k, v) => { guardado[k] = v; } },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

// Históricos REAIS (API da Câmara, 28/10/2026), só a 57ª.
const h = (dataHora, siglaPartido, situacao, descricaoStatus) => ({ dataHora, siglaPartido, situacao, descricaoStatus, idLegislatura: 57 });
const HIST_ILACIR = [   // 235620
  h('2023-02-01T00:00', 'PSC', null, 'Nome no início da legislatura / Partido no início da legislatura'),
  h('2026-03-25T17:16', 'PSC', 'CONVOCADO', 'DIVERSO - Convocação Eleito ou Suplente - Aguardando Convocação de Suplente'),
  h('2026-03-25T17:17', 'PSC', 'CONVOCADO', 'DIVERSO - Convocação Eleito ou Suplente'),
  h('2026-03-25T17:18', 'PODE', 'CONVOCADO', 'Alteração de partido'),
  h('2026-03-25T17:52', 'PODE', 'Exercício', 'Entrada - Posse de Suplente - Posse como Suplente'),
  h('2026-04-01T14:00', 'REPUBLICANOS', 'Exercício', 'Alteração de partido'),
  h('2026-07-25T00:00', 'REPUBLICANOS', 'SUPLENCIA', 'Saída - Afastamento sem prazo determinado - Afastamento de Suplente (automático)'),
];
const HIST_DUARTE = [   // 227800
  h('2023-02-01T00:00', 'PSC', null, 'Nome no início da legislatura / Partido no início da legislatura'),
  h('2024-02-22T15:15', 'PSC', 'CONVOCADO', 'DIVERSO - Convocação Eleito ou Suplente - Aguardando Convocação de Suplente'),
  h('2024-02-22T15:20', 'PSC', 'CONVOCADO', 'DIVERSO - Convocação Eleito ou Suplente'),
  h('2024-02-22T15:22', 'PODE', 'CONVOCADO', 'Alteração de partido'),
  h('2024-02-27T17:42', 'PODE', 'Exercício', 'Entrada - Posse de Suplente - Posse como Suplente'),
  h('2024-03-12T19:29', 'REPUBLICANOS', 'Exercício', 'Alteração de partido'),
  h('2024-06-22T00:00', 'REPUBLICANOS', 'SUPLENCIA', 'Saída - Afastamento sem prazo determinado - Afastamento de Suplente (automático)'),
];
const HIST_ROMERO = [   // 160629: eleito pelo PSC, PODE desde a incorporação, ficou
  h('2023-02-01T00:00', 'PSC', null, 'Nome no início da legislatura / Partido no início da legislatura'),
  h('2023-02-01T12:05', 'PSC', 'Exercício', 'Entrada - Posse de Eleito Titular'),
  h('2023-08-22T00:00', 'PODE', 'Exercício', 'Alteração de partido'),
  h('2026-07-06T23:58', 'PODE', 'Licença', 'Saída - Licença'),
];

(async () => {
  console.log('== registro transitório na sigla ==');
  {
    ctx.__h = HIST_ILACIR;
    const j = av(`aderRegistroTransitorio(__h, 'PODE')`);
    ok(j.length === 1 && j[0].de === '2026-03-25T17:18' && j[0].ate === '2026-04-01T14:00' && j[0].para === 'REPUBLICANOS',
       `Ilacir Bicalho: PODE de 25/03/2026 a 01/04/2026, depois REPUBLICANOS (${JSON.stringify(j)})`);
    ctx.__h = HIST_DUARTE;
    const k = av(`aderRegistroTransitorio(__h, 'PODE')`);
    ok(k.length === 1 && k[0].de === '2024-02-22T15:22' && k[0].ate === '2024-03-12T19:29', 'Duarte Gonçalves Jr: 22/02/2024 a 12/03/2024');
    ctx.__h = HIST_ROMERO;
    ok(av(`aderRegistroTransitorio(__h, 'PODE')`).length === 0, 'Romero Rodrigues (ex-PSC que ficou, entrada em exercício): nada muda');
    ctx.__h = HIST_ILACIR.slice(0, 5);
    ok(av(`aderRegistroTransitorio(__h, 'PODE')`).length === 0, 'suplente convocado na sigla que fica nela: nada muda');
    ctx.__h = HIST_ILACIR.map(x => x.siglaPartido === 'REPUBLICANOS' ? Object.assign({}, x, { dataHora: x.dataHora.replace('2026-04-01', '2026-05-10') }) : x);
    ok(av(`aderRegistroTransitorio(__h, 'PODE')`).length === 0, 'saída depois de 30 dias: é bancada de verdade, conta');
    ctx.__h = HIST_ILACIR;
    ok(av(`aderRegistroTransitorio(__h, 'REPUBLICANOS')`).length === 0, 'para a sigla de destino não há nada a tirar');
  }

  console.log('\n== o relatório tira o suplente da bancada e avisa ==');
  {
    // Partido PODE; votações de 25/03/2026 (Ilacir votou com a sigla PODE) e de
    // 07/04/2026 (já no Republicanos). Ana é da bancada o tempo todo.
    const V = [
      { id: '100-1', data: '2026-03-25', dataHoraRegistro: '2026-03-25T19:00:00', siglaOrgao: 'PLEN', descricao: 'Aprovado o projeto. Sim: 300; Não: 100', proposicaoObjeto: 'PL 1/2026' },
      { id: '200-1', data: '2026-04-07', dataHoraRegistro: '2026-04-07T19:00:00', siglaOrgao: 'PLEN', descricao: 'Rejeitada a emenda', proposicaoObjeto: 'PL 2/2026' },
    ];
    const dep = (id, nome, partido) => ({ id, nome, siglaPartido: partido, siglaUf: 'MG' });
    const VOTOS = {
      '100-1': [{ deputado_: dep(1, 'Ana', 'PODE'), tipoVoto: 'Sim' }, { deputado_: dep(235620, 'Ilacir Bicalho', 'PODE'), tipoVoto: 'Não' }],
      '200-1': [{ deputado_: dep(1, 'Ana', 'PODE'), tipoVoto: 'Não' }, { deputado_: dep(235620, 'Ilacir Bicalho', 'REPUBLICANOS'), tipoVoto: 'Sim' }],
    };
    const HIST = { 1: [h('2023-02-01T12:00', 'PODE', 'Exercício', 'Posse')], 235620: HIST_ILACIR };
    const PROPS = { 100: { siglaTipo: 'PL', numero: 1, ano: 2026, ementa: 'Dispõe sobre a primeira coisa.' }, 200: { siglaTipo: 'PL', numero: 2, ano: 2026, ementa: 'Dispõe sobre a segunda.' } };
    rota = (u) => {
      let m;
      if (u.includes('/aderencia-cache')) return resp(null);
      if (/\/votacoes\?dataInicio=/.test(u)) {
        const [, a, b] = u.match(/dataInicio=([\d-]+)&dataFim=([\d-]+)/);
        return resp({ dados: V.filter(v => v.data >= a && v.data <= b), links: [] });
      }
      if ((m = u.match(/\/votacoes\/([\d-]+)\/votos/))) return resp({ dados: VOTOS[m[1]] });
      if ((m = u.match(/\/votacoes\/([\d-]+)\/orientacoes/))) return resp({ dados: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }] });
      if (u.includes('/deputados?siglaPartido=PODE')) return resp({ dados: [dep(1, 'Ana', 'PODE')] });
      if ((m = u.match(/\/deputados\/(\d+)\/historico/))) return resp({ dados: HIST[m[1]] || [] });
      if ((m = u.match(/\/proposicoes\/(\d+)$/))) return resp({ dados: PROPS[m[1]] });
      return null;
    };
    document.getElementById('dataIni').value = '2026-03-20';
    document.getElementById('dataFim').value = '2026-04-10';
    document.getElementById('partido').value = 'PODE';
    await av('gerarRelatorio()');
    const c = av('window._relatorioCtx');
    ok(c && c.qualifying[0].membros.map(m => m.id).join() === '1', `25/03: bancada = só Ana — o voto do Ilacir com a sigla PODE não conta (${c && c.qualifying[0].membros.map(m => m.id)})`);
    ok(c.qualifying[0].possiveis === 1 && c.totalPossivel === 2 && c.totalAderiu === 1, `total: 1 aderência em 2 votos possíveis (${c.totalAderiu}/${c.totalPossivel})`);
    ok(!c.depMetrics.some(m => m.dep.id === 235620), 'Ilacir fora do ranking');
    ok(c.desconsiderados.length === 1 && c.desconsiderados[0].nome === 'Ilacir Bicalho' && c.desconsiderados[0].votacoes === 1, 'e listado como desconsiderado, com 1 votação');
    const txt = document.getElementById('resultado').textContent;
    ok(/Ilacir Bicalho/.test(txt) && /25\/03\/2026 a 01\/04\/2026/.test(txt) && /30 dias/.test(txt), 'a tela avisa quem saiu da conta, de quando a quando e por quê');

    console.log('\n== relatório da legislatura ==');
    const L = av(`aderAnosDaLegislatura('2026-10-28')`);
    ok(L.leg === 57 && L.anos.map(a => a.ano + ':' + a.ini + '..' + a.fim).join() ===
       '2023:2023-02-01..2023-12-31,2024:2024-01-01..2024-12-31,2025:2025-01-01..2025-12-31,2026:2026-01-01..2026-10-28',
       `57ª em 28/10/2026: 2023 desde a posse, 2026 até hoje (${JSON.stringify(L.anos)})`);
    const L2 = av(`aderAnosDaLegislatura('2027-01-20')`);
    ok(L2.leg === 57 && L2.anos.length === 5 && L2.anos[4].ini === '2027-01-01' && L2.anos[4].fim === '2027-01-20', 'janeiro de 2027 ainda é a 57ª');
    ok(av(`aderAnosDaLegislatura('2027-02-01')`).leg === 58, '1º/02/2027: 58ª, começa do zero');

    // O relatório ano a ano com "hoje" fixo, sobre a API de mentira.
    ctx.__hoje = '2026-10-28';
    // "hoje" fixo só para a data de agora; as outras datas seguem pelo isoLocal de verdade (janelasDeVotacao usa)
    av(`{ const real = isoLocal; isoLocal = x => Math.abs(x - Date.now()) < 60000 ? __hoje : real(x); }`);
    await av('aderGerarLegislatura()');
    const R = av('window._legislaturaCtx');
    ok(R && R.anos.length === 1 && R.anos[0].ano === '2026', `só 2026 tem votações aqui: um ano no relatório (${R && R.anos.map(a => a.ano)})`);
    const a = R.anos[0];
    ok(a.vot.length === 2 && a.vot[0].rotulo === 'PL 1/2026' && a.vot[0].ementa === 'Dispõe sobre a primeira coisa.' && a.vot[0].desc === 'Aprovado o projeto.',
       'cada votação com proposição (pelo id da votação), ementa e a descrição sem o placar');
    ok(a.vot[0].n === 1 && a.vot[0].c.a === 1, 'e com a bancada daquela votação');
    ok(R.desconsiderados.length === 1 && R.desconsiderados[0].para === 'REPUBLICANOS', 'o ajuste do Ilacir chega ao relatório da legislatura');
    ok(guardado['aderLegProp:100'], 'a proposição fica guardada no navegador');
    ok(/Relatório da legislatura|57ª legislatura/.test(document.getElementById('resultado').textContent) && document.getElementById('btnLegPdf') && document.getElementById('btnLegWord'),
       'a tela mostra o resumo e os botões PDF e Word');

    const pdf = av(`legHtmlPDF(window._legislaturaCtx, 'data:image/png;base64,AAAA')`);
    ok(/LIDERANÇA DO PODEMOS|Liderança do Podemos na Câmara dos Deputados/.test(pdf) && /#0B8A4B 0 40%, #7C9A2F 40% 62%, #1F5FA8 62% 82%, #D9531E 82% 100%/.test(pdf),
       'PDF na identidade dos relatórios: linha da Liderança e filete de quatro cores');
    ok(/Aderência da bancada do Podemos às orientações do Governo/.test(pdf), 'título com o nome do partido');
    ok(/counter\(page\)/.test(pdf), 'numeração de página');
    ok(/Ilacir Bicalho \(MG\): registrado como PODE ao ser convocado, em 25\/03\/2026, e no REPUBLICANOS em 01\/04\/2026 — 1 votação fora da conta/.test(pdf),
       'a nota de método e o aviso dizem quem foi tirado — sem nome fixo no código');
    ok(/Ex-PSC/.test(pdf), 'PODE na 57ª: a nota explica a incorporação do PSC');
    ok(!/<script/i.test(pdf.replace(/<script src=/g, '')), 'sem script inline (a janela herda a CSP da extensão)');

    console.log('\n== o mesmo documento para o período pedido ==');
    document.getElementById('dataIni').value = '2026-03-20';
    document.getElementById('dataFim').value = '2026-04-10';
    await av('gerarRelatorio()');
    ok(document.getElementById('btnRelPdf') && document.getElementById('btnRelWord') && document.getElementById('btnExportar'),
       'o relatório comum tem PDF e Word ao lado do Excel');
    const um = av('legDoRelatorio(window._relatorioCtx)');
    const c1 = av('window._relatorioCtx');
    ok(um.modo === 'periodo' && um.anos.length === 1 && um.anos[0].ini === '2026-03-20' && um.anos[0].fim === '2026-04-10',
       'período dentro de um ano: um ano, com as datas pedidas');
    ok(um.todos.n === c1.totalAderiu + c1.totalDivergiu && um.todos.a === c1.totalAderiu && um.todos.v === c1.qualifying.length
       && Math.abs(100 * um.todos.a / um.todos.n - c1.overallPct) < 1e-9, 'totais e aderência iguais aos da tela');
    ok(JSON.stringify(um.anos[0].deps.map(d => [d.id, d.n, d.a, d.d, d.x])) ===
       JSON.stringify(c1.depMetrics.map(m => [m.dep.id, m.votacoes, m.aderiu, m.divergiu, m.ausente])),
       'deputados recontados pela bancada de cada votação: iguais ao ranking da tela');
    ok(um.desconsiderados.length === 1 && um.desconsiderados[0].nome === 'Ilacir Bicalho', 'o ajuste do Ilacir vai junto');
    ctx.__um = um;
    await av('legGarantirProposicoes(__um)');
    const p1 = av(`legHtmlPDF(__um, null)`);
    ok(/Período de 20\/03\/2026 a 10\/04\/2026 ·/.test(p1) && /Aderência às orientações do Governo, 20\/03\/2026 a 10\/04\/2026/.test(p1),
       'cabeçalho e rodapé com o período, não a legislatura');
    ok(!/Resumo do período/.test(p1) && !/class="quebra"><\/div><h2>2026/.test(p1), 'num ano só, sem o resumo (repetiria a seção do ano) e sem página em branco');
    ok(/PL 1\/2026/.test(p1), 'as votações com a proposição');
    ok(!/Ausên|Ausente|possíveis/.test(p1) && /votos Sim e Não da bancada/.test(p1),
       'aderência sobre os votos Sim e Não: sem ausência no documento, e a nota de método diz a conta');
    ok(av(`legNomeArquivo(__um, 'pdf')`) === 'Aderencia-PODE-2026-03-20-a-2026-04-10.pdf', 'nome do arquivo com o período');

    // Período que atravessa o ano: dezembro de 2025 a abril de 2026.
    V.push({ id: '300-1', data: '2025-12-10', dataHoraRegistro: '2025-12-10T19:00:00', siglaOrgao: 'PLEN', descricao: 'Aprovada a MPV', proposicaoObjeto: 'MPV 3/2025' });
    VOTOS['300-1'] = [{ deputado_: dep(1, 'Ana', 'PODE'), tipoVoto: 'Não' }];
    PROPS[300] = { siglaTipo: 'MPV', numero: 3, ano: 2025, ementa: 'Medida.' };
    document.getElementById('dataIni').value = '2025-12-01';
    await av('gerarRelatorio()');
    const dois = av('legDoRelatorio(window._relatorioCtx)');
    const c2 = av('window._relatorioCtx');
    ok(dois.anos.map(a => a.ano + ':' + a.ini + '..' + a.fim).join() === '2025:2025-12-01..2025-12-31,2026:2026-01-01..2026-04-10',
       `atravessa o ano: um bloco por ano, cortado no período (${dois.anos.map(a => a.ano + ':' + a.ini + '..' + a.fim)})`);
    ok(dois.anos[0].vot.length === 1 && dois.anos[1].vot.length === 2 && dois.anos[0].deps[0].n === 1 && dois.anos[1].deps[0].n === 2,
       'cada votação no seu ano, e cada deputado contado no ano');
    ok(dois.todos.n === c2.totalAderiu + c2.totalDivergiu && dois.todos.a === c2.totalAderiu, 'a soma dos anos é o total da tela');
    ctx.__dois = dois;
    await av('legGarantirProposicoes(__dois)');
    const p2 = av(`legHtmlPDF(__dois, null)`);
    ok(/Resumo do período/.test(p2) && /Período de 01\/12\/2025 a 10\/04\/2026, ano a ano/.test(p2) && /<td><b>Período<\/b><\/td>/.test(p2) && /01\/12 a 31\/12/.test(p2),
       'mais de um ano: resumo do período, com a linha de cada ano e a do total');
    ok(/MPV 3\/2025/.test(p2), 'a proposição de 2025 também é buscada');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
