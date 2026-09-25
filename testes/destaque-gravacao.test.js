// Gravação do destaque (panel.js · fbSalvarDestaque): escrita condicional.
//
// O defeito: o voto/explicação/orientação de um destaque era gravado com
// PATCH em …/proposicoes/{i}/destaques/{j} — a POSIÇÃO local. Se outra pessoa
// tinha atualizado a lista no banco (destaque novo vindo da Câmara, proposição
// removida), o texto caía no destaque errado ou criava um nó órfão. E quando o
// objeto local não era achado, o "fallback seguro" fazia PUT da sessão
// inteira — o último a salvar apagava o trabalho de todos os outros.
//
// O que se trava aqui, contra um Firebase de mentira que implementa ETag e
// if-match como o de verdade:
//   1. caso simples: grava no destaque certo, sem tocar nos outros campos;
//   2. a proposição mudou de posição no banco: re-localiza pela chave;
//   3. o destaque mudou de posição: acha pelo número;
//   4. alguém grava entre a leitura e a escrita (412): relê e reaplica, sem
//      perder a gravação do outro;
//   5. o destaque/proposição sumiu do banco: NÃO grava, erro nomeado;
//   6. nunca um PUT da sessão inteira, nunca PATCH por índice;
//   7. a estrutura continua em arrays (versões antigas da extensão).
//
// Uso: node testes/destaque-gravacao.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const HTML = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8');
const FONTE = ['pauta-parser.js', 'mpv.js', 'panel.js']
  .map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');
const FB = 'https://plenario-podemos-default-rtdb.firebaseio.com';

// ---------- Firebase de mentira, com ETag ----------
let BANCO = {};
let versao = 0;
const etags = new Map(); // caminho → etag atual
const chamadas = [];
let antesDaEscrita = null; // gancho: simula outra pessoa gravando entre leitura e escrita

const ler = partes => partes.reduce((o, k) => (o == null ? undefined : o[k]), BANCO);
function gravar(partes, valor) {
  let o = BANCO;
  for (const k of partes.slice(0, -1)) { if (o[k] == null) o[k] = /^\d+$/.test(k) ? [] : {}; o = o[k]; }
  o[partes[partes.length - 1]] = valor;
  // Qualquer escrita invalida as ETags do caminho e dos ancestrais/descendentes.
  etags.clear();
  versao++;
}
const etagDe = caminho => { if (!etags.has(caminho)) etags.set(caminho, `etag-${versao}-${caminho.length}`); return etags.get(caminho); };
const clone = x => JSON.parse(JSON.stringify(x === undefined ? null : x));

async function fetchFalso(url, op = {}) {
  const u = new URL(String(url));
  const caminho = u.pathname.replace(/\.json$/, '');
  const partes = caminho.split('/').filter(Boolean);
  const metodo = op.method || 'GET';
  const h = op.headers || {};
  chamadas.push({ metodo, caminho, h, corpo: op.body ? JSON.parse(op.body) : undefined });
  const resp = (status, corpo, headers = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => clone(corpo), text: async () => JSON.stringify(corpo),
  });
  if (metodo === 'GET') {
    const v = ler(partes);
    return resp(200, v, h['X-Firebase-ETag'] ? { ETag: etagDe(caminho) } : {});
  }
  if (metodo === 'PUT') {
    if (h['if-match'] !== undefined && h['if-match'] !== etagDe(caminho)) {
      return resp(412, { error: 'ETag mismatch' }, { ETag: etagDe(caminho) });
    }
    if (antesDaEscrita) { const f = antesDaEscrita; antesDaEscrita = null; f(); return fetchFalso(url, op); }
    gravar(partes, JSON.parse(op.body));
    return resp(200, JSON.parse(op.body));
  }
  if (metodo === 'PATCH') {
    const atual = ler(partes) || {};
    gravar(partes, { ...atual, ...JSON.parse(op.body) });
    return resp(200, {});
  }
  return resp(405, {});
}

// ---------- painel ----------
const { document, window, Event } = parseHTML(HTML);
const ctx = {
  document, window, DOMParser, Event,
  console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  fetch: fetchFalso,
  URL, TextDecoder, AbortController, DOMException,
  btoa: s => Buffer.from(s, 'latin1').toString('base64'),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  chrome: {
    storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } },
    runtime: { getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '4.0.0' }), reload: () => {} },
    tabs: { create: () => {} },
  },
  pdfjsLib: { GlobalWorkerOptions: {} },
  alert: () => {}, confirm: () => false, prompt: () => null, docx: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(FONTE, ctx, { filename: 'painel.js' });
const av = e => vm.runInContext(e, ctx);

const dtq = (numero, extra = {}) => ({ numero, autoria: 'PL', descricao: `DTQ ${numero}`, situacao: 'Pendente', ativo: true, ...extra });
const propPL = () => ({ chave: 'PL 100/2026', sigla: 'PL', destaques: [dtq('1'), dtq('2'), dtq('3')] });
const propPEC = () => ({ chave: 'PEC 5/2026', sigla: 'PEC', destaques: [dtq('1')] });

function sessaoLocal() {
  // O objeto local, como a tela o tem: PL na posição 0, destaque "2" na posição 1.
  const s = { id: 'S1', proposicoes: [propPL(), propPEC()] };
  ctx.__s = s; ctx.__p = s.proposicoes[0]; ctx.__d = s.proposicoes[0].destaques[1];
  ctx.__d.votoSim = 'SIM: mantém o texto'; ctx.__d.orientacao = 'NÃO';
  return s;
}
const salvar = () => av('fbSalvarDestaque(__s, __p, __d)').then(() => null, e => e);
const escritas = () => chamadas.filter(c => c.metodo !== 'GET');

(async () => {
  console.log('== caso simples: grava no destaque certo ==');
  {
    BANCO = { sessoes: { S1: { id: 'S1', titulo: 'Sessão', proposicoes: [propPL(), propPEC()] } } };
    sessaoLocal(); chamadas.length = 0;
    const erro = await salvar();
    ok(!erro, `sem erro (${erro && erro.message})`);
    const d2 = BANCO.sessoes.S1.proposicoes[0].destaques[1];
    ok(d2.votoSim === 'SIM: mantém o texto' && d2.orientacao === 'NÃO', 'o destaque 2 recebeu os campos');
    ok(d2.descricao === 'DTQ 2' && d2.situacao === 'Pendente', 'sem perder o que já estava nele');
    ok(!BANCO.sessoes.S1.proposicoes[0].destaques[0].votoSim, 'o destaque 1 não foi tocado');
    const w = escritas();
    ok(w.length === 1 && w[0].metodo === 'PUT' && w[0].caminho === '/sessoes/S1/proposicoes/0', 'uma escrita, só da proposição');
    ok(!!w[0].h['if-match'], 'e condicional (if-match com a ETag lida)');
    ok(Array.isArray(BANCO.sessoes.S1.proposicoes[0].destaques), 'destaques continuam em array');
  }

  console.log('\n== a proposição mudou de posição no banco: re-localiza pela chave ==');
  {
    // Alguém removeu uma proposição antes do PL: no banco ele agora está na posição 1.
    BANCO = { sessoes: { S1: { id: 'S1', proposicoes: [propPEC(), propPL()] } } };
    sessaoLocal(); chamadas.length = 0;
    const erro = await salvar();
    ok(!erro, 'sem erro');
    ok(BANCO.sessoes.S1.proposicoes[1].destaques[1].votoSim === 'SIM: mantém o texto', 'gravou no PL, que está na posição 1');
    ok(!BANCO.sessoes.S1.proposicoes[0].destaques[0].votoSim, 'e NÃO na PEC que ocupa a posição 0 (o defeito antigo)');
    ok(escritas().every(c => c.caminho === '/sessoes/S1/proposicoes/1'), 'escreveu só na posição certa');
  }

  console.log('\n== o destaque mudou de posição: acha pelo número ==');
  {
    const pl = propPL();
    pl.destaques = [dtq('0'), dtq('1'), dtq('2'), dtq('3')]; // entrou um destaque novo no início
    BANCO = { sessoes: { S1: { id: 'S1', proposicoes: [pl, propPEC()] } } };
    sessaoLocal();
    const erro = await salvar();
    ok(!erro, 'sem erro');
    const ds = BANCO.sessoes.S1.proposicoes[0].destaques;
    ok(ds[2].numero === '2' && ds[2].votoSim === 'SIM: mantém o texto', 'gravou no destaque 2 (agora na posição 2)');
    ok(!ds[1].votoSim, 'e não no destaque 1, que ocupa a posição local antiga');
  }

  console.log('\n== alguém grava entre a leitura e a escrita (412) ==');
  {
    BANCO = { sessoes: { S1: { id: 'S1', proposicoes: [propPL(), propPEC()] } } };
    sessaoLocal(); chamadas.length = 0;
    antesDaEscrita = () => {
      // Outra pessoa salva a explicação do destaque 3 no mesmo instante.
      const pl = clone(BANCO.sessoes.S1.proposicoes[0]);
      pl.destaques[2].explicacao = 'texto do colega';
      gravar(['sessoes', 'S1', 'proposicoes', '0'], pl);
    };
    const erro = await salvar();
    ok(!erro, `sem erro (${erro && erro.message})`);
    const ds = BANCO.sessoes.S1.proposicoes[0].destaques;
    ok(ds[1].votoSim === 'SIM: mantém o texto', 'a nossa gravação entrou');
    ok(ds[2].explicacao === 'texto do colega', 'e a do colega NÃO foi apagada (é o que o PUT sem condição fazia)');
    ok(chamadas.filter(c => c.metodo === 'GET' && c.h['X-Firebase-ETag']).length >= 2, 'houve releitura depois do 412');
  }

  console.log('\n== sumiu do banco: não grava, erro nomeado ==');
  {
    const pl = propPL(); pl.destaques = [dtq('1'), dtq('3')]; // o destaque 2 foi removido
    BANCO = { sessoes: { S1: { id: 'S1', proposicoes: [pl, propPEC()] } } };
    sessaoLocal(); chamadas.length = 0;
    let erro = await salvar();
    ok(erro && erro.code === 'destaque-removido', `destaque removido → erro "destaque-removido" (${erro && erro.message})`);
    ok(escritas().length === 0, 'e nenhuma escrita');

    BANCO = { sessoes: { S1: { id: 'S1', proposicoes: [propPEC()] } } };
    sessaoLocal(); chamadas.length = 0;
    erro = await salvar();
    ok(erro && erro.code === 'destaque-removido' && /PL 100\/2026/.test(erro.message), 'proposição removida → idem, nomeando a proposição');
    ok(escritas().length === 0, 'e nenhuma escrita');

    // Objeto local que não está na sessão local (o caso do antigo "fallback seguro").
    BANCO = { sessoes: { S1: { id: 'S1', titulo: 'Sessão', proposicoes: [propPL(), propPEC()] } } };
    sessaoLocal(); ctx.__p = { chave: 'PL 999/2026', destaques: [] }; chamadas.length = 0;
    erro = await salvar();
    ok(erro && erro.code === 'destaque-removido', 'objeto fora da sessão local: erro, não PUT da sessão');
    ok(!escritas().some(c => c.caminho === '/sessoes/S1'), 'nunca um PUT da sessão inteira');
  }

  console.log('\n== o código não volta ao jeito antigo ==');
  {
    const src = fs.readFileSync(path.join(RAIZ, 'panel.js'), 'utf8');
    const corpo = src.slice(src.indexOf('async function fbSalvarDestaque'), src.indexOf('async function salvarDestaque'));
    ok(!/fbSalvar\(sessao\)/.test(corpo), 'sem o fallback de PUT da sessão inteira');
    ok(!/method:\s*'PATCH'/.test(corpo), 'sem PATCH por índice');
    ok(/'if-match'/.test(corpo) && /X-Firebase-ETag/.test(corpo), 'com ETag e if-match');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
