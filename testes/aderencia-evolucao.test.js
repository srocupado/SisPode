// O gráfico "Evolução da Aderência" (aderencia.js).
//
// O defeito que o usuário viu em 15/09/2026, com PODE de 01/08 a 31/08/2026:
// o cabeçalho dizia 35,2% de aderência (38 aderiu, 31 divergiu, 39 ausente, 4
// votações, 108 votos possíveis) e a única barra do gráfico, da semana de
// 10/08 com as mesmas 4 votações, dizia 100%.
//
// A conta da barra era `aderiu / partySize`: somava os aderentes das QUATRO
// votações e dividia pela bancada de UMA — 38/27 = 140%. O clamp do desenho
// aparava em 100 e o resultado não parecia erro nenhum: parecia uma semana
// perfeita. O denominador certo é o mesmo do número grande, bancada × votações
// do período.
//
// O segundo defeito, no mesmo lugar: a chave da semana saía de toISOString()
// (UTC) e o rótulo, das partes locais da data. No fuso de Brasília, uma votação
// registrada às 22h atravessa a meia-noite em UTC e abria um SEGUNDO balde para
// a mesma semana — duas barras com o mesmo rótulo, cada uma com parte das
// votações.
//
// Uso: node testes/aderencia-evolucao.test.js
process.env.TZ = 'America/Sao_Paulo';   // o fuso em que a assessoria trabalha

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window } = parseHTML(html);
const ctx = {
  document, window, DOMParser, setTimeout, clearTimeout, URL, TextDecoder,
  // aderencia.html passou a carregar ia-comum.js, que declara um
  // AbortController no topo do arquivo. Sem ele no contexto, NENHUM script
  // da página chega a ser avaliado.
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
  requestAnimationFrame: () => 0,
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

/** Uma votação como o módulo a monta: data de registro + contagens da bancada. */
const votacao = (quando, aderiu, divergiu, partySize) => ({
  votacao: { id: quando, dataHoraRegistro: quando },
  adherentCount: aderiu,
  divergentCount: divergiu,
  ausenteCount: partySize - (aderiu + divergiu),
});

/** Canvas de mentira que guarda o que foi escrito — o rótulo da barra. */
function canvasFalso() {
  const escritos = [];
  const nada = () => {};
  const ctx2d = new Proxy({
    fillText: (t) => escritos.push(String(t)),
    setTransform: nada, clearRect: nada, fillRect: nada, beginPath: nada,
    moveTo: nada, lineTo: nada, stroke: nada, fill: nada, arc: nada,
  }, { get: (o, k) => (k in o ? o[k] : nada), set: () => true });
  return { escritos, canvas: { width: 0, height: 0, style: {}, parentElement: { clientWidth: 560 }, getContext: () => ctx2d } };
}

(async () => {
  console.log('== o caso real: PODE, 01/08 a 31/08/2026, 4 votações numa semana ==');
  {
    // 27 deputados; 4 votações na semana de segunda 10/08; 38 aderências ao
    // todo (12+10+9+7), 31 divergências — os números da tela do usuário.
    const PARTY = 27;
    ctx.__q = [
      votacao('2026-08-11T15:20:00-03:00', 12, 8, PARTY),
      votacao('2026-08-12T16:40:00-03:00', 10, 9, PARTY),
      votacao('2026-08-12T19:10:00-03:00',  9, 7, PARTY),
      votacao('2026-08-13T11:05:00-03:00',  7, 7, PARTY),
    ];
    const grupos = av(`agruparPorPeriodo(__q, '2026-08-01', '2026-08-31', 27)`);

    ok(grupos.length === 1, `uma semana, uma barra (${grupos.length})`);
    const g = grupos[0];
    ok(g.count === 4, 'com as 4 votações no balde');
    ok(g.aderiu === 38, `38 aderências somadas (${g.aderiu})`);
    ok(g.possiveis === 108, `e 108 votos possíveis — bancada × votações (${g.possiveis})`);
    ok(Math.abs(g.pct - 35.185) < 0.01, `a barra vale 35,2%, não 100% (${g.pct.toFixed(1)}%)`);

    // O número grande do topo, com a mesma conta: as duas têm de bater.
    const geral = (38 / (27 * 4)) * 100;
    ok(Math.abs(g.pct - geral) < 1e-9,
       'e é exatamente o número do cabeçalho, já que todas as votações caem na mesma semana');

    // A conta antiga, para deixar registrado o que se está impedindo.
    ok((38 / 27) * 100 > 100, 'a conta antiga (aderiu ÷ bancada) passava de 100% — o clamp é que a disfarçava');

    const { escritos, canvas } = canvasFalso();
    av('__draw = drawTemporalChart'); ctx.__canvas = canvas; ctx.__grupos = grupos;
    av('__draw(__canvas, __grupos)');
    ok(escritos.includes('35%'), `o rótulo desenhado é 35% (${escritos.filter(t => /%/.test(t)).join(' ')})`);
    ok(!escritos.includes('100%') || escritos.filter(t => t === '100%').length === 1,
       'o único "100%" que sobra é o da linha de grade do eixo');
    ok(escritos.includes('4v'), 'e o sub-rótulo continua dizendo quantas votações entraram');
  }

  console.log('\n== votação das 22h não abre uma segunda barra da mesma semana ==');
  {
    // 12/08 às 22h30 em Brasília é 13/08 em UTC: era aí que a semana se partia.
    ctx.__q = [
      votacao('2026-08-12T15:00:00-03:00', 10, 5, 27),
      votacao('2026-08-12T22:30:00-03:00',  8, 6, 27),
    ];
    const grupos = av(`agruparPorPeriodo(__q, '2026-08-01', '2026-08-31', 27)`);
    ok(grupos.length === 1, `as duas votações ficam na MESMA semana (${grupos.length} balde(s))`);
    ok(grupos[0].label === '10/08', `rotulada pela segunda-feira da semana (${grupos[0].label})`);
    ok(grupos[0].count === 2 && grupos[0].aderiu === 18, 'com as duas contadas juntas');
    ok(grupos[0].key === '2026-08-10', `e a chave é a data local, igual ao rótulo (${grupos[0].key})`);
  }

  console.log('\n== semanas diferentes continuam separadas, cada uma com a sua conta ==');
  {
    ctx.__q = [
      votacao('2026-08-04T15:00:00-03:00', 27, 0, 27),   // semana de 03/08: 100% de verdade
      votacao('2026-08-11T15:00:00-03:00',  0, 20, 27),  // semana de 10/08: 0%
      votacao('2026-08-12T15:00:00-03:00', 27, 0, 27),
    ];
    const grupos = av(`agruparPorPeriodo(__q, '2026-08-01', '2026-08-31', 27)`);
    ok(grupos.length === 2, `duas semanas, duas barras (${grupos.length})`);
    ok(grupos[0].label === '03/08' && Math.abs(grupos[0].pct - 100) < 1e-9,
       'a semana em que a bancada inteira aderiu marca 100% — e agora isso quer dizer alguma coisa');
    ok(grupos[1].label === '10/08' && Math.abs(grupos[1].pct - 50) < 1e-9,
       `a semana seguinte, com 27 de 54 possíveis, marca 50% (${grupos[1].pct.toFixed(1)}%)`);
    ok(grupos[0].key < grupos[1].key, 'e a ordem cronológica se mantém');
  }

  console.log('\n== período longo agrupa por mês, com o mesmo denominador ==');
  {
    ctx.__q = [
      votacao('2026-06-10T15:00:00-03:00', 20, 5, 27),
      votacao('2026-06-24T15:00:00-03:00', 14, 9, 27),
      votacao('2026-08-12T15:00:00-03:00', 27, 0, 27),
    ];
    const grupos = av(`agruparPorPeriodo(__q, '2026-06-01', '2026-08-31', 27)`);
    ok(grupos.length === 2, `junho e agosto (${grupos.length} baldes)`);
    ok(grupos[0].possiveis === 54, 'junho tem 2 votações: 54 votos possíveis');
    ok(Math.abs(grupos[0].pct - (34 / 54) * 100) < 1e-9,
       `e 34 aderências sobre 54 = ${((34 / 54) * 100).toFixed(1)}%`);
    ok(grupos[1].possiveis === 27 && Math.abs(grupos[1].pct - 100) < 1e-9, 'agosto, com uma votação, 100%');
  }

  console.log('\n== bancada vazia não vira divisão por zero ==');
  {
    ctx.__q = [votacao('2026-08-12T15:00:00-03:00', 0, 0, 0)];
    const grupos = av(`agruparPorPeriodo(__q, '2026-08-01', '2026-08-31', 0)`);
    ok(grupos.length === 1 && grupos[0].pct === 0, 'a barra vale 0%, não NaN');
    const { escritos, canvas } = canvasFalso();
    ctx.__canvas = canvas; ctx.__grupos = grupos;
    let erro = null; try { av('__draw(__canvas, __grupos)'); } catch (e) { erro = e; }
    ok(!erro, erro ? 'o desenho quebrou: ' + erro.message : 'e o desenho não quebra');
    ok(escritos.includes('0%'), 'com rótulo 0%');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
