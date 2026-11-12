// Painel de Votação · aba "Prints da sessão": download do Firebase (12/11/2026).
//
// Antes, a consulta de 15 s lia de novo TODOS os prints da sessão (~2 KB cada), mesmo com a página em
// segundo plano. O que este teste trava:
//   1. a carga inicial lê os prints da sessão numa leitura só;
//   2. a consulta periódica lê só a LISTA de itens (?shallow=true) e baixa o placar apenas do print novo —
//      o que já está na tela não é baixado de novo;
//   3. com a página escondida, a consulta não lê nada; ao reaparecer, atualiza na hora.
// Uso: node testes/prints-download.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const d = new Date();
const HOJE = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const placar = n => ({ sigla: 'PODE', descricao: `Sessão Conjunta · votos dos deputados · PLN ${n}/2026`, data: HOJE, hora: '13:08', quorum: 416,
  global: { sim: 261, nao: 155 }, parcial: { sim: 15, nao: 6, ausente: 6 }, bancada: [{ nome: 'Renata Abreu', siglaUf: 'SP', classe: 'sim' }] });
const fb = { prints: { 13991: { ts: 1, legenda: 'Bancada: 15 Sim', placar: placar(25) } } };

const pedidos = [];
let bytes = 0;
const html = fs.readFileSync(path.join(RAIZ, 'votacao.html'), 'utf8');
const { document, window } = parseHTML(html);
let escondida = false;
Object.defineProperty(document, 'hidden', { get: () => escondida, configurable: true });
let relogio = null;
const ctx = {
  document, window, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
  setInterval: (f) => { relogio = f; return 1; }, clearInterval: () => {},
  Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  navigator: {}, Date,
  fetch: async (url) => {
    url = String(url);
    const caminho = url.replace(/^https:\/\/[^/]+/, '').replace(/\.json.*$/, '');
    const shallow = /shallow=true/.test(url);
    pedidos.push(caminho + (shallow ? ' (shallow)' : ''));
    let corpo = null;
    if (caminho === '/bot/monitor_sessao') corpo = shallow ? { 83280: true } : null;
    else if (caminho === '/bot/monitor_sessao/83280/dataISO') corpo = HOJE;
    else if (caminho === '/bot/monitor_sessao/83280/prints') corpo = shallow ? Object.fromEntries(Object.keys(fb.prints).map(k => [k, true])) : fb.prints;
    else { const m = caminho.match(/\/bot\/monitor_sessao\/83280\/prints\/(\d+)$/); if (m) corpo = fb.prints[m[1]] || null; }
    const txt = JSON.stringify(corpo);
    bytes += txt.length;
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
new vm.Script(fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'imagem-svg.js'), 'utf8')).runInContext(ctx);
new vm.Script(fs.readFileSync(path.join(RAIZ, 'votacao-prints.js'), 'utf8')).runInContext(ctx);
const espera = () => new Promise(r => setTimeout(r, 50));
const cards = () => document.querySelectorAll('.print-card').length;

(async () => {
  console.log('== 1. carga inicial ==');
  await espera();
  ok(cards() === 1, 'o print da sessão de hoje aparece');
  ok(pedidos.filter(p => p === '/bot/monitor_sessao/83280/prints').length === 1, 'uma leitura com os prints da sessão');

  console.log('\n== 2. consulta de 15 s: só o que é novo ==');
  pedidos.length = 0; bytes = 0;
  relogio(); await espera();
  ok(pedidos.length === 1 && pedidos[0] === '/bot/monitor_sessao/83280/prints (shallow)', `sem print novo: só a lista de itens (${pedidos.join(', ')})`);
  ok(bytes < 40, `…dezenas de bytes (${bytes}), não o placar (~${JSON.stringify(fb.prints[13991]).length} bytes por print)`);
  fb.prints[13992] = { ts: 2, legenda: 'Bancada: 14 Sim', placar: placar(23) };
  pedidos.length = 0;
  relogio(); await espera();
  ok(cards() === 2, 'o print novo aparece');
  ok(pedidos.includes('/bot/monitor_sessao/83280/prints/13992') && !pedidos.some(p => /prints\/13991$/.test(p)) && !pedidos.includes('/bot/monitor_sessao/83280/prints'),
    `baixa só o novo (13992); o 13991, já na tela, não (${pedidos.join(', ')})`);

  console.log('\n== 3. página escondida ==');
  escondida = true; pedidos.length = 0;
  relogio(); await espera();
  ok(pedidos.length === 0, 'escondida: a consulta não lê nada');
  fb.prints[13993] = { ts: 3, legenda: '', placar: placar(1) };
  escondida = false;
  document.dispatchEvent(new window.Event('visibilitychange'));
  await espera();
  ok(cards() === 3 && pedidos.includes('/bot/monitor_sessao/83280/prints/13993'), 'ao reaparecer, atualiza na hora');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO FATAL:', e); process.exit(1); });
