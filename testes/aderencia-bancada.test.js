// Aderência ao Governo: o denominador é a bancada DE CADA VOTAÇÃO.
//
// O defeito: o relatório dividia todas as votações pela bancada de HOJE
// (/deputados?siglaPartido=X). Num período longo, com o partido tendo 12
// deputados em 2023 e 30 em 2026, a votação de 2023 ganhava 18 "ausências" de
// gente que nem era do partido, e o deputado que chegou em 2024 levava falta
// em tudo o que veio antes. Com a virada para a 58ª legislatura a bancada
// muda inteira de uma vez, e o erro fica gritante.
//
// O material abaixo é o caso de 12 contra 30:
//  - dep 1–10: PODE desde a posse (fev/2023);
//  - dep 11–30: posse no PL, migram para o PODE em abr/2024;
//  - dep 31: PODE em 2023, sai para o PL em 2024 (não está na bancada de hoje);
//  - dep 32: PODE em 2023, de licença desde jul/2026 (idem).
// V1 (mar/2023): bancada = 1–10, 31, 32 → 12. V2 (ago/2026): 1–30 → 30.
//
// Uso: node testes/aderencia-bancada.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window } = parseHTML(html);

// ---------- material ----------
const ids = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const posse = (sigla) => ({ dataHora: '2023-02-01T11:45', siglaPartido: sigla, situacao: 'Exercício', descricaoStatus: 'Entrada - Posse' });
const marcoInicio = (sigla) => ({ dataHora: '2023-02-01T00:00', siglaPartido: sigla, situacao: null, descricaoStatus: 'Nome no início da legislatura' });
const HIST = {};
for (const id of ids(1, 10)) HIST[id] = [marcoInicio('PODE'), posse('PODE')];
for (const id of ids(11, 30)) HIST[id] = [marcoInicio('PL'), posse('PL'),
  { dataHora: '2024-04-01T00:00', siglaPartido: 'PODE', situacao: 'Exercício', descricaoStatus: 'Alteração de partido' }];
HIST[31] = [marcoInicio('PODE'), posse('PODE'),
  { dataHora: '2024-04-02T00:00', siglaPartido: 'PL', situacao: 'Exercício', descricaoStatus: 'Alteração de partido' }];
HIST[32] = [marcoInicio('PODE'), posse('PODE'),
  { dataHora: '2026-07-01T00:00', siglaPartido: 'PODE', situacao: 'Licença', descricaoStatus: 'Saída - Afastamento' }];

const dep = (id, sigla) => ({ id, nome: `Dep ${String(id).padStart(2, '0')}`, siglaPartido: sigla, siglaUf: 'SP' });
const BANCADA_HOJE = ids(1, 30).map(id => dep(id, 'PODE'));
const NO_PERIODO = ids(1, 32).map(id => dep(id, 'PODE'));

const VOTACOES = [
  { id: 'V1-2023', siglaOrgao: 'PLEN', dataHoraRegistro: '2023-03-10T15:00:00', descricao: 'Votação de 2023', aprovacao: 1 },
  { id: 'V2-2026', siglaOrgao: 'PLEN', dataHoraRegistro: '2026-08-12T15:00:00', descricao: 'Votação de 2026', aprovacao: 1 },
];
const voto = (id, sigla, tipo) => ({ deputado_: dep(id, sigla), tipoVoto: tipo });
const VOTOS = {
  // Governo: Sim. PODE: 1–10 Sim, 31 Não, 32 ausente. 11–15 votam Sim, mas pelo PL.
  'V1-2023': [...ids(1, 10).map(id => voto(id, 'PODE', 'Sim')), voto(31, 'PODE', 'Não'),
              ...ids(11, 15).map(id => voto(id, 'PL', 'Sim'))],
  // Governo: Não. 1–20 Não, 21–25 Sim, 26–30 ausentes; 31 vota Não, mas pelo PL.
  'V2-2026': [...ids(1, 20).map(id => voto(id, 'PODE', 'Não')), ...ids(21, 25).map(id => voto(id, 'PODE', 'Sim')),
              voto(31, 'PL', 'Não')],
};
const ORIENT = { 'V1-2023': 'Sim', 'V2-2026': 'Não' };

const falharHistorico = new Set();
const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
async function fakeFetch(url) {
  const u = String(url);
  let m;
  if (u.includes('firebaseio.com')) return jsonOk(null);
  if (/\/votacoes\?dataInicio=/.test(u)) return jsonOk({ dados: VOTACOES, links: [] });
  if ((m = u.match(/\/votacoes\/([^/]+)\/votos/))) return jsonOk({ dados: VOTOS[m[1]] || [] });
  if ((m = u.match(/\/votacoes\/([^/]+)\/orientacoes/))) {
    return jsonOk({ dados: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: ORIENT[m[1]] }] });
  }
  if ((m = u.match(/\/deputados\/(\d+)\/historico/))) {
    if (falharHistorico.has(Number(m[1]))) return { ok: false, status: 404, json: async () => ({}) };
    return jsonOk({ dados: HIST[m[1]] || [] });
  }
  if (/\/deputados\?siglaPartido=PODE/.test(u)) {
    return jsonOk({ dados: u.includes('dataInicio=') ? NO_PERIODO : BANCADA_HOJE });
  }
  return { ok: false, status: 404, json: async () => ({}) };
}

const ctx = {
  document, window, DOMParser, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: fakeFetch,
  requestAnimationFrame: () => 0,
  XLSX: {
    utils: { book_new: () => ({ abas: {} }), aoa_to_sheet: r => ({ _r: r }), json_to_sheet: r => ({ _r: r }),
             book_append_sheet: (wb, ws, nome) => { wb.abas[nome] = ws._r; } },
    writeFile: (wb, nome) => { ctx._planilha = { abas: wb.abas, nome }; },
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

async function gerar(ini, fim) {
  document.getElementById('dataIni').value = ini;
  document.getElementById('dataFim').value = fim;
  document.getElementById('partido').value = 'PODE';
  av('cvHistoricoCache.clear()');
  await av('gerarRelatorio()');
  return av('window._relatorioCtx');
}

(async () => {
  console.log('== estado do deputado num instante (funções puras) ==');
  {
    ctx.__h = HIST[11];
    ok(av(`estadoNoInstante(__h, '2023-03-10T15:00').partido`) === 'PL', 'dep 11 era do PL em mar/2023');
    ok(av(`estadoNoInstante(__h, '2026-08-12T15:00').partido`) === 'PODE', 'e do PODE em ago/2026');
    ctx.__h = HIST[1];
    ok(av(`estadoNoInstante(__h, '2023-02-01T05:00').situacao`) === null,
       'o marco de início (situação nula) não põe ninguém em exercício antes da posse');
    ctx.__h = HIST[32];
    ok(av(`estadoNoInstante(__h, '2026-08-12T15:00').situacao`) === 'Licença', 'dep 32 de licença em ago/2026');
  }

  console.log('\n== 12 contra 30: cada votação com a sua bancada ==');
  const r = await gerar('2023-03-01', '2026-08-31');
  {
    ok(!!r, 'o relatório foi gerado');
    const [v1, v2] = r.qualifying;
    ok(v1.membros.size === 12, `V1 (2023): bancada de 12, não de 30 (${v1.membros.size})`);
    ok(v2.membros.size === 30, `V2 (2026): bancada de 30 (${v2.membros.size})`);
    ok(v1.membros.has(31) && v1.membros.has(32), 'quem saiu do partido depois conta na votação em que ainda era do PODE');
    ok(!v1.membros.has(11), 'quem ainda era do PL em 2023 não conta na V1');
    ok(!v2.membros.has(31), 'quem já tinha saído não conta na V2, mesmo tendo votado (pelo PL)');
    ok(!v2.membros.has(32), 'quem está de licença não conta na V2');

    ok(v1.adherentCount === 10 && v1.divergentCount === 1 && v1.ausenteCount === 1,
       `V1: 10 aderiu, 1 divergiu, 1 ausente (${v1.adherentCount}/${v1.divergentCount}/${v1.ausenteCount})`);
    ok(Math.abs(v1.specificPct - 1000 / 12) < 1e-9, `V1: 83,3% (${v1.specificPct.toFixed(1)}%), não 33,3% sobre 30`);
    ok(v2.adherentCount === 20 && v2.divergentCount === 5 && v2.ausenteCount === 5, 'V2: 20 aderiu, 5 divergiu, 5 ausente');

    ok(r.totalPossivel === 42, `votos possíveis = 12 + 30 = 42, não 30 × 2 = 60 (${r.totalPossivel})`);
    ok(Math.abs(r.overallPct - 3000 / 42) < 1e-9, `aderência geral 71,4% (${r.overallPct.toFixed(1)}%)`);
    ok(r.bancadaMedia === 21, `bancada média 21 (${r.bancadaMedia})`);
    ok(r.partySize === 30, 'a bancada atual continua disponível (30)');
    ok(r.atravessaLegislaturas === null, 'período inteiro dentro da 57ª: sem aviso de legislatura');

    const grupos = av(`agruparPorPeriodo(window._relatorioCtx.qualifying, '2023-03-01', '2026-08-31', 30)`);
    const g23 = grupos.find(g => g.key === '2023-03'), g26 = grupos.find(g => g.key === '2026-08');
    ok(g23.possiveis === 12 && g26.possiveis === 30, `barras do gráfico com a bancada de cada mês (${g23.possiveis}/${g26.possiveis})`);
  }

  console.log('\n== ranking por deputado: só as votações em que ele era da bancada ==');
  {
    const m = id => r.depMetrics.find(x => x.dep.id === id);
    ok(m(11).n === 1 && m(11).ausente === 0 && m(11).pct === 100,
       `quem chegou em 2024 não leva falta pela votação de 2023 (n=${m(11).n}, ${m(11).pct}%)`);
    ok(m(1).n === 2 && m(1).pct === 100, 'quem estava nas duas tem n=2');
    ok(m(31).n === 1 && m(31).divergiu === 1 && m(31).atual === false, 'o ex-membro aparece, com n=1 e marcado fora da bancada atual');
    ok(m(32).n === 1 && m(32).ausente === 1, 'o licenciado conta só na votação em que estava em exercício');
    ok(r.depMetrics.length === 32, `32 deputados passaram pela bancada no período (${r.depMetrics.length})`);
    ok(r.depMetrics.every(x => x.n > 0), 'ninguém entra no ranking com zero votações elegíveis');

    av('renderRankingDeputados("pct")');
    const metas = [...document.querySelectorAll('#rankingList .rank-meta')].map(e => e.textContent);
    ok(metas.some(t => /1 votação na bancada · fora da bancada atual/.test(t)), 'a tela mostra o n e marca quem saiu');
  }

  console.log('\n== detalhe da votação e planilha usam a bancada daquela votação ==');
  {
    av('exportarExcel()');
    const abas = ctx._planilha.abas;
    const vot = abas['Votações'];
    const col = vot[0].indexOf('Bancada');
    ok(vot[1][col] === 12 && vot[2][col] === 30, `coluna "Bancada" por votação: ${vot[1][col]} e ${vot[2][col]}`);
    const det = abas['Detalhes'];
    ok(det.filter(l => l[1] === 'V1-2023').length === 12, 'aba Detalhes: 12 linhas na V1');
    ok(det.filter(l => l[1] === 'V2-2026').length === 30, 'e 30 na V2');
    const rank = abas['Ranking Deputados'];
    ok(rank[0].includes('Votações na bancada') && rank[0].includes('Na bancada atual'), 'ranking exportado traz n e "na bancada atual"');
    const resumo = abas['Resumo'].map(l => l.join(' | '));
    ok(resumo.some(l => /Bancada média por votação \| 21/.test(l)), 'resumo traz a bancada média');
    ok(!resumo.some(l => /Atenção/.test(l)), 'sem aviso quando o período não atravessa legislaturas');
  }

  console.log('\n== período que atravessa legislaturas é declarado ==');
  {
    const r2 = await gerar('2022-12-01', '2026-08-31');
    ok(r2.atravessaLegislaturas && r2.atravessaLegislaturas.de === 56 && r2.atravessaLegislaturas.ate === 57,
       'de dez/2022 a ago/2026: 56ª a 57ª');
    ok(/atravessa legislaturas \(56ª a 57ª\)/.test(document.getElementById('resultado').textContent), 'a tela avisa');
    av('exportarExcel()');
    ok(ctx._planilha.abas['Resumo'].some(l => /^Atenção: O período atravessa legislaturas/.test(l[0] || '')), 'e a planilha também');
  }

  console.log('\n== histórico indisponível: cai na bancada atual, e avisa ==');
  {
    falharHistorico.add(11);
    const r3 = await gerar('2023-03-01', '2026-08-31');
    falharHistorico.clear();
    ok(r3.qualifying[0].membros.has(11), 'sem histórico, o dep 11 (bancada atual) conta também na V1 — o critério antigo');
    ok(r3.semHistorico === 1, 'e o relatório registra 1 deputado sem histórico');
    ok(/Histórico indisponível para 1 deputado/.test(document.getElementById('resultado').textContent), 'com aviso na tela');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
