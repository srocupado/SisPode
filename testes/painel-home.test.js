// A navegação da home do painel (panel.js + panel.html).
//
// O defeito que este teste existe para impedir tem uma assinatura muito
// específica: "cliquei no módulo e não aconteceu nada".
//
// registrarEventos() encadeia ~40 getElementById().addEventListener() sem
// guarda nenhuma. Um único elemento ausente — o caso real é uma pasta de
// extensão atualizada pela metade, com panel.js novo e panel.html antigo —
// lança TypeError e mata todo o resto da função. E renderHomeGrid() ficava no
// FIM dela: a tela abria com aparência normal, os cards apareciam (o grid é
// montado por JS... ou não aparecia nenhum), e nada respondia ao clique, sem
// erro visível para quem estava usando.
//
// O que se trava aqui:
//   · a home é renderizada ANTES dos registros, e sobrevive a qualquer falha
//     posterior;
//   · o clique no card Orçamento abre o modal de sub-painéis;
//   · com panel.html defasado, o clique DEGRADA para o comportamento anterior
//     em vez de não fazer nada;
//   · todo id que registrarEventos() exige sem `?.` existe no panel.html.
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
const FONTE = ['pauta-parser.js', 'mpv.js', 'panel.js']
  .map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');

/** Um painel carregado como o navegador carrega, opcionalmente mutilado. */
function montarPainel(htmlBruto = HTML) {
  const { document, window, Event } = parseHTML(htmlBruto);
  const erros = [];
  const abertas = [];
  const ctx = {
    document, window, DOMParser, Event, abertas, erros,
    console: { log: () => {}, warn: () => {}, debug: () => {}, error: (...a) => erros.push(a.map(String).join(' ')) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    URL, TextDecoder, AbortController, DOMException,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: {
      storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } },
      runtime: { getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '3.3.4' }), reload: () => {} },
      tabs: { create: o => abertas.push(o.url) },
    },
    pdfjsLib: { GlobalWorkerOptions: {} },
    alert: () => {}, confirm: () => false, prompt: () => null, docx: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx, { filename: 'painel.js' });
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return { document, ctx, erros, abertas,
           clicar: sel => { const el = document.querySelector(sel); if (!el) return false;
                            el.dispatchEvent(new Event('click', { bubbles: true })); return true; } };
}

(async () => {
  console.log('== o painel íntegro ==');
  const p = montarPainel();
  {
    const cards = p.document.querySelectorAll('.home-card');
    ok(cards.length >= 8, `${cards.length} módulos na home`);
    ok(!p.erros.length, p.erros.length ? `erro no boot: ${p.erros[0]}` : 'boot sem erro');

    const modal = p.document.getElementById('modal-orcamento');
    ok(!!modal, 'o modal de sub-painéis do Orçamento existe no HTML');
    ok(modal.style.display === 'none', 'e começa fechado');

    ok(p.clicar('.home-card[data-modulo="emendas"]'), 'o card Orçamento está na home');
    // Este estado do DOM SEMPRE esteve certo, inclusive quando o clique parecia
    // não fazer nada: o modal abria atrás da home. Quem pega aquilo é a
    // verificação de camadas, mais abaixo — não esta.
    ok(modal.style.display === 'flex', 'clicar nele abre o modal');

    ok(p.clicar('#btn-sub-notas'), 'o sub-painel de notas técnicas está no modal');
    ok(p.abertas.some(u => u.endsWith('orcamento-notas.html')),
       `e abre a tela certa: ${p.abertas[p.abertas.length - 1]}`);
    ok(modal.style.display === 'none', 'fechando o modal atrás');

    p.clicar('.home-card[data-modulo="emendas"]');
    p.clicar('#btn-sub-emendas');
    ok(p.abertas.some(u => u.endsWith('emendas.html')), 'e o outro sub-painel abre o acompanhamento de emendas');
  }

  console.log('\n== pasta atualizada pela metade: panel.js novo, panel.html antigo ==');
  {
    // Remove do HTML o modal inteiro — é o estado de quem copiou só o .js.
    const semModal = HTML.replace(/<div id="modal-orcamento"[\s\S]*?\n  <\/div>\n/, '');
    ok(!/modal-orcamento/.test(semModal), 'o HTML mutilado realmente não tem o modal');

    const q = montarPainel(semModal);
    ok(q.document.querySelectorAll('.home-card').length >= 8,
       'a home continua renderizada — a navegação não morre junto com o modal ausente');

    // Todos os outros módulos precisam continuar funcionando.
    q.clicar('.home-card[data-modulo="ccjc"]');
    ok(q.abertas.some(u => u.endsWith('ccjc.html')), 'os demais módulos continuam abrindo');

    // E o Orçamento DEGRADA em vez de não fazer nada.
    q.clicar('.home-card[data-modulo="emendas"]');
    ok(q.abertas.some(u => u.endsWith('emendas.html')),
       'o card Orçamento cai no comportamento anterior em vez de silenciar');
  }

  console.log('\n== as camadas: o modal precisa cobrir a home ==');
  {
    // A CAUSA RAIZ do "clique que não faz nada".
    //
    // .tela-home é fixed, inset 0 e OPACA. Enquanto todos os modais eram
    // abertos de dentro da tela de destaques — com a home já em display:none —
    // o z-index 100 do overlay nunca incomodou. O modal de sub-painéis do
    // Orçamento é o primeiro aberto a partir da PRÓPRIA home, e abria atrás
    // dela: display:flex aplicado, nenhum erro no console, nada na tela.
    //
    // Nenhum teste de JS pega isso: o estado do DOM estava certo o tempo todo.
    // Por isso a ordem das camadas é travada aqui, como regra.
    const css = fs.readFileSync(path.join(RAIZ, 'panel.css'), 'utf8');
    const zDe = seletor => {
      const re = new RegExp(`${seletor.replace('.', '\\.')}\\s*\\{[^}]*?z-index:\\s*(\\d+)`, 's');
      const m = re.exec(css);
      return m ? Number(m[1]) : null;
    };
    const home = zDe('.tela-home'), modal = zDe('.modal-overlay'), toast = zDe('.toast');
    ok(home && modal && toast, `camadas lidas: home ${home}, modal ${modal}, toast ${toast}`);
    ok(modal > home, `o modal (${modal}) fica ACIMA da home (${home}) — senão abre invisível atrás dela`);
    ok(toast > modal, `e o toast (${toast}) acima do modal (${modal}), porque é o retorno das ações dele`);
    const regraHome = /\.tela-home\s*\{[^}]*\}/.exec(css)?.[0] || '';
    ok(/position:\s*fixed/.test(regraHome) && /inset:\s*0/.test(regraHome),
       'a home é mesmo uma camada fixa de tela cheia — é isso que a torna capaz de esconder um modal');
  }

  console.log('\n== todo id exigido sem guarda existe no HTML ==');
  {
    // A causa raiz: getElementById('x').addEventListener sem `?.`. Se o id não
    // estiver no HTML, o registro inteiro morre a partir dali.
    const js = fs.readFileSync(path.join(RAIZ, 'panel.js'), 'utf8');
    const ini = js.indexOf('function registrarEventos()');
    const corpo = js.slice(ini, js.indexOf('\n}\n', ini));
    const exigidos = [...corpo.matchAll(/getElementById\('([^']+)'\)\s*\n?\s*\./g)]
      .filter(m => !corpo.slice(m.index, m.index + m[0].length + 2).includes('?.'))
      .map(m => m[1]);
    const unicos = [...new Set(exigidos)];
    const ausentes = unicos.filter(id => !p.document.getElementById(id));
    ok(!ausentes.length,
       ausentes.length ? `ids exigidos que NÃO existem no panel.html: ${ausentes.join(', ')}`
                       : `os ${unicos.length} ids exigidos sem guarda estão todos no panel.html`);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
