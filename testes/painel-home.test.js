// A navegação da home do painel (panel.js + panel.html + panel.css).
//
// Duas correções gerais, ambas nascidas de um "cliquei e não aconteceu nada":
//
//   · registrarEventos() encadeia ~40 getElementById().addEventListener() sem
//     guarda. Um único id ausente — pasta da extensão atualizada pela metade —
//     lança TypeError e mata o resto da função. E renderHomeGrid() ficava no
//     FIM dela: tela normal, nenhum card respondendo, nenhum erro visível.
//   · .tela-home é fixed, inset 0 e OPACA, em z-index 200; .modal-overlay
//     estava em 100. Qualquer modal aberto a partir da própria home abria
//     ATRÁS dela: display:flex aplicado, console limpo, nada na tela.
//
// Uso: node testes/painel-home.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const HTML = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8');
const FONTE = ['pauta-parser.js', 'mpv.js', 'panel.js'].map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');

function montarPainel(htmlBruto = HTML) {
  const { document, window, Event } = parseHTML(htmlBruto);
  const erros = [], abertas = [];
  const ctx = {
    document, window, DOMParser, Event, abertas, erros,
    console: { log: () => {}, warn: () => {}, debug: () => {}, error: (...a) => erros.push(a.map(String).join(' ')) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    URL, TextDecoder, AbortController, DOMException, btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } },
              runtime: { getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '0' }), reload: () => {} },
              tabs: { create: o => abertas.push(o.url) } },
    pdfjsLib: { GlobalWorkerOptions: {} }, alert: () => {}, confirm: () => false, prompt: () => null, docx: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx, { filename: 'painel.js' });
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return { document, erros, abertas,
           clicar: sel => { const el = document.querySelector(sel); if (!el) return false;
                            el.dispatchEvent(new Event('click', { bubbles: true })); return true; } };
}

(async () => {
  console.log('== painel íntegro ==');
  {
    const p = montarPainel();
    ok(p.document.querySelectorAll('.home-card').length >= 8, `${p.document.querySelectorAll('.home-card').length} módulos na home`);
    ok(!p.erros.length, p.erros.length ? `erro no boot: ${p.erros[0]}` : 'boot sem erro');
    p.clicar('.home-card[data-modulo="ccjc"]');
    ok(p.abertas.some(u => u.endsWith('ccjc.html')), 'um módulo abre sua tela ao clique');
  }

  console.log('\n== pasta atualizada pela metade: um id que o panel.js exige some do HTML ==');
  {
    // btn-sync-manual é o último registro antes do fim de registrarEventos.
    const mutilado = HTML.replace(/id="btn-sync-manual"/, 'id="btn-sync-manual-sumiu"');
    const q = montarPainel(mutilado);
    ok(q.document.querySelectorAll('.home-card').length >= 8,
       'a home continua renderizada — ela vem ANTES dos registros e sobrevive à falha');
    q.clicar('.home-card[data-modulo="ccjc"]');
    ok(q.abertas.some(u => u.endsWith('ccjc.html')), 'e os módulos continuam abrindo');
    ok(q.erros.some(e => /registrarEventos parou em/.test(e)), 'a falha é registrada, não engolida');
    ok(!!q.document.querySelector('div[style*="7a1f1f"]') && /Falha ao inicializar o painel/.test(q.document.body.textContent),
       'e um banner na própria tela diz o que aconteceu — ninguém abre chrome://extensions antes de reclamar');
  }

  console.log('\n== camadas: o modal precisa cobrir a home ==');
  {
    const css = fs.readFileSync(path.join(RAIZ, 'panel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const zDe = sel => { const m = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*?z-index:\\s*(\\d+)`, 's').exec(css); return m ? Number(m[1]) : null; };
    const home = zDe('.tela-home'), modal = zDe('.modal-overlay'), toast = zDe('.toast');
    ok(home && modal && toast, `camadas lidas: home ${home}, modal ${modal}, toast ${toast}`);
    ok(modal > home, `o modal (${modal}) fica ACIMA da home (${home}) — senão abre invisível atrás dela`);
    ok(toast > modal, `e o toast (${toast}) acima do modal (${modal}), porque é o retorno das ações dele`);
    const regraHome = /\.tela-home\s*\{[^}]*\}/.exec(css)?.[0] || '';
    ok(/position:\s*fixed/.test(regraHome) && /inset:\s*0/.test(regraHome), 'a home é mesmo uma camada fixa de tela cheia');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
