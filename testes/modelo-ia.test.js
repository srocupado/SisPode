// Escolha do modelo de IA dentro do módulo de relatórios.
//
// O caso que originou isto: o analista tinha gemini-3.1-flash-lite nas
// Configurações gerais e a repercussão voltava vazia numa matéria de farta
// cobertura, enquanto o Parecer de Especialista, com a MESMA chave, funcionava.
// A diferença é que o parecer ignora o modelo configurado e escolhe sozinho — e
// o flash-lite nem entra na disputa lá, por ser de faixa econômica.
//
// Duas coisas este teste guarda:
//
// 1. O módulo escolhe sozinho por padrão, pela mesma regra do parecer. Depender
//    de o analista lembrar de trocar é pior aqui do que lá, porque o sintoma de
//    esquecer não é um erro: é uma seção que volta vazia.
//
// 2. Ranking NÃO é prova de que o modelo busca. Medido em 22/09/2026,
//    gemini-3.1-pro-preview ganha o ranqueamento e não busca (0 em 3). Por isso
//    existe o teste de busca de verdade, e por isso o que ele mede vence o
//    ranking na escolha automática.
//
// Uso: node testes/modelo-ia.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// Config de mentira, que é o que a tela lê e grava.
let CONFIG = { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'gemini-3.1-flash-lite' };
const MODELOS = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash'];
const pedidos = [];
let respostaBusca = { fontes: [] };

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: {}, writeFile: () => {} },
  pdfjsLib: { GlobalWorkerOptions: {} },
  fetch: async (url) => {
    pedidos.push(String(url));
    if (/\/models\?/.test(String(url))) {
      return { ok: true, status: 200, json: async () => ({ models: MODELOS.map(id => ({
        name: 'models/' + id, displayName: id, supportedGenerationMethods: ['generateContent'] })) }) };
    }
    return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
  },
  chrome: { storage: { local: {
    get: (_k, cb) => cb({ config: CONFIG }),
    set: (o, cb) => { CONFIG = o.config; if (cb) cb(); },
  } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
const chamar = (fn, ...a) => vm.runInContext(fn, ctx)(...a);

(async () => {
  console.log('== a configuração está na ENGRENAGEM do módulo ==');
  {
    ok(!!document.getElementById('cvIaProvedor'), 'há seletor de provedor');
    ok(!!document.getElementById('cvIaModelo'), 'e de modelo');
    ok(!!document.getElementById('cvIaTestar'), 'e o botão de testar a busca');
    ok(!!document.getElementById('btn-config-ia'), 'a engrenagem está na barra do topo');

    // A configuração é do MÓDULO. Ela morava dentro da aba "Como votou o
    // deputado", que nasce OCULTA — e o módulo abre na aba Aderência. Resultado:
    // quem abria o módulo não via o campo em lugar nenhum. Fica aferido, porque
    // é o tipo de defeito que só aparece abrindo a tela.
    let el = document.getElementById('cvIaModelo'), pais = [];
    while (el && el.parentNode) { el = el.parentNode; if (el.id) pais.push(el.id); }
    ok(!pais.includes('painel-consulta') && !pais.includes('painel-aderencia'),
       'e NÃO vive dentro de nenhum painel de aba, que nascem ocultos');
    ok(pais.includes('modalIa'), 'vive no modal da engrenagem');
    let g = document.getElementById('btn-config-ia'), gp = [];
    while (g && g.parentNode) { g = g.parentNode; if (g.className) gp.push(String(g.className)); }
    ok(gp.some(c => /top-bar/.test(c)), 'e a engrenagem, na barra do topo — visível em qualquer aba');
    ok(document.getElementById('modalIa').hasAttribute('hidden'),
       'o modal nasce fechado: é ajuste, não é o trabalho');
    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    const rec = manifest.web_accessible_resources.flatMap(w => w.resources);
    ok(rec.includes('modelo-ia.js') && rec.includes('parecer.js'),
       'modelo-ia.js e parecer.js estão em web_accessible_resources');
  }

  console.log('\n== a partida não acontece sozinha fora do navegador ==');
  {
    // mdlIniciar faz chamada de rede. Num harness sem ciclo de vida de
    // documento, disparar sozinho consumiria a resposta de outro teste.
    const aoProvedor = pedidos.filter(u => /generativelanguage|api\.openai|api\.anthropic/.test(u));
    ok(aoProvedor.length === 0,
       `o script carregou sem chamar o provedor de IA (${aoProvedor.length}: ${aoProvedor.join(', ') || '—'})`);
  }

  console.log('\n== por padrão, o módulo escolhe sozinho ==');
  {
    await chamar('mdlIniciar');
    const sel = document.getElementById('cvIaModelo');
    const vals = [...sel.querySelectorAll('option')].map(o => o.getAttribute('value'));
    ok(vals[0] === '', 'a primeira opção é o automático, e é a que fica marcada');
    ok(/automático/.test(sel.querySelector('option').textContent), 'e ela se anuncia como automático');
    ok(sel.querySelector('option').textContent.includes('gemini-3.8-flash'),
       `dizendo QUAL modelo vai usar (${sel.querySelector('option').textContent.trim()})`);
    ok(CONFIG.modeloRelatoriosAuto === 'gemini-3.8-flash',
       `e o automático fica GRAVADO, para quem chama a IA poder ler (${CONFIG.modeloRelatoriosAuto})`);
    ok(!vals.includes(undefined), 'a lista do provedor entra inteira');
    const lite = [...sel.querySelectorAll('option')].find(o => o.getAttribute('value') === 'gemini-3.1-flash-lite');
    ok(/econômica/.test(lite.textContent), 'e o modelo econômico aparece marcado como tal');
  }

  console.log('\n== o automático vence o padrão geral, que era o do problema ==');
  {
    const cfg = await chamar('rsmConfigIA');
    ok(cfg.modelo === 'gemini-3.8-flash',
       `quem chama a IA recebe o automático, e não o gemini-3.1-flash-lite das Configurações (${cfg.modelo})`);
    ok(cfg.apiKey === 'chave-de-teste', 'a chave continua vindo das Configurações gerais');
  }

  console.log('\n== o analista pode fixar um modelo ==');
  {
    const sel = document.getElementById('cvIaModelo');
    sel.querySelector('option[value="gemini-2.5-flash"]').selected = true;
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));
    ok(CONFIG.modeloRelatorios === 'gemini-2.5-flash', 'a escolha é gravada');
    const cfg = await chamar('rsmConfigIA');
    ok(cfg.modelo === 'gemini-2.5-flash', 'e vence o automático — quem manda no modelo é ele');
    CONFIG.modeloRelatorios = '';
  }

  console.log('\n== medir vence deduzir ==');
  {
    // O ranqueamento por nome diz quem redige bem; não diz quem busca. Um
    // modelo medido buscando passa à frente na escolha automática.
    CONFIG.buscaWeb = { 'gemini/gemini-2.5-flash': { ok: true, em: Date.now() } };
    const auto = chamar('mdlAutomatico', MODELOS, CONFIG);
    ok(auto.modelo === 'gemini-2.5-flash',
       `o modelo COMPROVADO buscando ganha do melhor ranqueado (${auto.modelo})`);
    ok(/mediu buscando/.test(auto.motivo), 'e o motivo diz por quê');

    CONFIG.buscaWeb = {};
    ok(chamar('mdlAutomatico', MODELOS, CONFIG).modelo === 'gemini-3.8-flash',
       'sem medição, vale o ranqueamento do parecer');
  }

  console.log('\n== a tela diz o que se sabe daquele modelo ==');
  {
    const semTeste = chamar('mdlEstadoHtml', 'gemini', 'gemini-3.8-flash', CONFIG);
    ok(/ainda não foi testada/.test(semTeste) && /não dá para saber pelo nome/.test(semTeste),
       'sem medição, admite que não sabe — em vez de deixar o analista supor');

    const cfgOk = { ...CONFIG, buscaWeb: { 'gemini/gemini-3.8-flash': { ok: true, em: Date.now() } } };
    ok(/fez a busca na web/.test(chamar('mdlEstadoHtml', 'gemini', 'gemini-3.8-flash', cfgOk)),
       'medido e bom, diz que buscou');

    const cfgRuim = { ...CONFIG, buscaWeb: { 'gemini/gemini-3.1-flash-lite': { ok: false, em: Date.now() } } };
    const ruim = chamar('mdlEstadoHtml', 'gemini', 'gemini-3.1-flash-lite', cfgRuim);
    ok(/NÃO fez a busca/.test(ruim) && /resumo e a sustentação funcionam/.test(ruim),
       'medido e ruim, diz o que ainda funciona e o que vai cair na reserva');

    ok(/Sem chave/.test(chamar('mdlEstadoHtml', 'anthropic', 'claude-x', CONFIG)),
       'sem chave do provedor, manda cadastrar em Configurações — a chave não mora aqui');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
