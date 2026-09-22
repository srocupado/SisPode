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
// Começa VAZIA de propósito: é o caso que motivou esta tela — quem reseta o
// sistema e entra direto neste módulo não tem chave nenhuma cadastrada.
let CONFIG = {};
const MODELOS = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash'];
const pedidos = [];
let respostaDeBusca = { comFontes: true };

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
    // A chamada de teste de busca: devolve grounding ou não, conforme o caso.
    return { ok: true, status: 200, json: async () => ({ candidates: [{
      content: { parts: [{ text: 'uma resposta' }] }, finishReason: 'STOP',
      groundingMetadata: respostaDeBusca.comFontes
        ? { groundingChunks: [{ web: { uri: 'https://x/1', title: 'g1.globo.com' } }] } : undefined,
    }] }), text: async () => '' };
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
    ok(!!document.getElementById('btn-config-ia'), 'a engrenagem está na barra do topo');
    let g = document.getElementById('btn-config-ia'), gp = [];
    while (g && g.parentNode) { g = g.parentNode; if (g.className) gp.push(String(g.className)); }
    ok(gp.some(c => /top-bar/.test(c)), 'na barra do topo — visível em qualquer aba');

    // O campo já morou dentro da aba "Como votou o deputado", que nasce OCULTA,
    // e o módulo abre na aba Aderência: quem abria o módulo não o via em lugar
    // nenhum. Fica aferido onde ele MORA, não só que existe.
    let el = document.getElementById('cvIaModelo'), pais = [];
    while (el && el.parentNode) { el = el.parentNode; if (el.id) pais.push(el.id); }
    ok(!pais.includes('painel-consulta') && !pais.includes('painel-aderencia'),
       'e NÃO dentro de painel de aba nenhum, que nascem ocultos');
    ok(pais.includes('modalIa'), 'vive no modal da engrenagem');
    ok(document.getElementById('modalIa').hasAttribute('hidden'), 'que nasce fechado');

    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    const rec = manifest.web_accessible_resources.flatMap(w => w.resources);
    ok(rec.includes('modelo-ia.js'), 'modelo-ia.js está em web_accessible_resources');
    ok(!/<script src="parecer\.js"/.test(html),
       'e a página não carrega parecer.js, que deixou de ser usado aqui');
  }

  console.log('\n== o módulo configura o sistema INTEIRO, como os outros ==');
  {
    // O caso de uso: reset do sistema, e o usuário entra só neste módulo. Ele
    // precisa escolher provedor, colar a chave e escolher modelo daqui.
    ok(!!document.getElementById('cvIaProvedor'), 'escolhe o provedor');
    ok(!!document.getElementById('cvIaChave'), 'cola a chave de API');
    ok(!!document.getElementById('cvIaModelo'), 'escolhe o modelo');
    ok(!!document.getElementById('cvIaListar'), 'e pede a lista viva do provedor quando quiser');
    ok(!!document.getElementById('cvIaSalvar'), 'e salva');
    ok(document.getElementById('cvIaChave').getAttribute('type') === 'password',
       'a chave é campo de senha: ela não fica à mostra na tela');

    await chamar('mdlIniciar');
    const provs = [...document.getElementById('cvIaProvedor').querySelectorAll('option')]
      .map(o => o.getAttribute('value'));
    ok(provs.includes('gemini') && provs.includes('openai') && provs.includes('anthropic'),
       `os três provedores estão à escolha (${provs.join(', ')})`);
    ok([...document.getElementById('cvIaProvedor').querySelectorAll('option')]
         .every(o => /sem chave/.test(o.textContent)),
       'e sem chave nenhuma cadastrada, todos avisam que estão sem chave');
  }

  console.log('\n== a lista de modelos NÃO trava esperando a rede ==');
  {
    // As outras telas fazem assim, e é a diferença entre abrir instantâneo e
    // abrir esperando o provedor responder para mostrar o que já estava escolhido.
    const chamadasAoProvedor = () => pedidos.filter(u => /generativelanguage|api\.openai|api\.anthropic/.test(u)).length;
    ok(chamadasAoProvedor() === 0,
       `abrir a tela não chama o provedor (${chamadasAoProvedor()} chamada(s))`);
    const opts = [...document.getElementById('cvIaModelo').querySelectorAll('option')]
      .map(o => o.getAttribute('value'));
    ok(opts.length >= 2, `mas a lista já vem preenchida, com a de reserva (${opts.length} modelos)`);
    // Sem chave cadastrada, a tela diz isso; com chave, diz que a lista é a de
    // reserva. Nos dois casos ela avisa que aquilo NÃO é a lista da chave.
    ok(/Nenhuma chave deste provedor/.test(document.getElementById('cvIaModeloEstado').textContent),
       'e diz que não há chave, em vez de deixar a lista de reserva passar por lista da chave');
    chamar('mdlTrocarProvedor', 'gemini');

    // Sem chave, listar é recusado com o motivo — e sem gastar chamada.
    await chamar('mdlListarModelos');
    ok(chamadasAoProvedor() === 0, 'sem chave, o botão não chega a chamar o provedor');
    ok(/Cole a chave/.test(document.getElementById('cvIaModeloEstado').textContent),
       'e diz o que falta');

    // Com a chave, a lista viva vem — no clique, não antes.
    document.getElementById('cvIaChave').value = 'AIzaSyChaveDeTesteComTamanhoSuficiente';
    await chamar('mdlListarModelos');
    ok(chamadasAoProvedor() === 1, 'no clique, uma chamada — e só então');
    const vivos = [...document.getElementById('cvIaModelo').querySelectorAll('option')]
      .map(o => o.getAttribute('value'));
    ok(vivos.includes('gemini-3.8-flash'), `e a lista passa a ser a da chave (${vivos.length} modelos)`);
    ok(/disponíveis nesta chave/.test(document.getElementById('cvIaModeloEstado').textContent),
       'com a contagem à vista');
  }

  console.log('\n== salvar grava onde as outras telas leem ==');
  {
    document.getElementById('cvIaModelo').querySelector('option[value="gemini-3.8-flash"]').selected = true;
    await chamar('mdlSalvar');
    ok(CONFIG.provedor === 'gemini' && CONFIG.modelo === 'gemini-3.8-flash',
       `provedor e modelo vão para a config do aplicativo (${CONFIG.provedor}/${CONFIG.modelo})`);
    ok(CONFIG.apiKey === 'AIzaSyChaveDeTesteComTamanhoSuficiente'
       && CONFIG.chaves.gemini === CONFIG.apiKey,
       'a chave também, e no mapa por provedor');
    ok(document.getElementById('modalIa').hidden === true, 'e o modal fecha');

    // É a mesma configuração que as camadas de IA leem: sem isso haveria duas
    // verdades sobre qual modelo está em uso.
    const cfg = await chamar('rsmConfigIA');
    ok(cfg.modelo === 'gemini-3.8-flash' && cfg.apiKey === CONFIG.apiKey,
       'e é exatamente o que o resumo, a repercussão e a sustentação vão usar');
  }
  {
    // Chave com formato errado é recusada aqui, e não na primeira consulta,
    // onde apareceria como um erro do provedor que não diz o que houve.
    const antes = JSON.stringify(CONFIG);
    document.getElementById('cvIaChave').value = 'isto-não-é-chave';
    ok((await chamar('mdlSalvar')) === null, 'chave com formato inválido não salva');
    ok(/formato inválido/.test(document.getElementById('cvIaModeloEstado').textContent),
       'e a tela diz por quê');
    ok(JSON.stringify(CONFIG) === antes, 'e a configuração anterior fica intacta');
    document.getElementById('cvIaChave').value = 'AIzaSyChaveDeTesteComTamanhoSuficiente';
  }
  {
    // Trocar de provedor não pode perder a chave do anterior.
    CONFIG = { provedor: 'gemini', apiKey: 'AIzaSyChaveDoGemini1234567890', modelo: 'gemini-3.8-flash', chaves: {} };
    await chamar('mdlIniciar');
    document.getElementById('cvIaProvedor').querySelector('option[value="anthropic"]').selected = true;
    chamar('mdlTrocarProvedor', 'anthropic');
    document.getElementById('cvIaChave').value = 'sk-ant-chaveDeTesteComTamanhoSuficiente';
    await chamar('mdlSalvar');
    ok(CONFIG.chaves.gemini === 'AIzaSyChaveDoGemini1234567890',
       'a chave do provedor anterior é preservada no mapa');
    ok(CONFIG.chaves.anthropic === 'sk-ant-chaveDeTesteComTamanhoSuficiente' && CONFIG.provedor === 'anthropic',
       'e a nova entra sem apagar a outra — quem experimenta e volta não recola nada');
  }

  console.log('\n== o teste de busca, que é o acréscimo desta tela ==');
  {
    CONFIG = { provedor: 'gemini', apiKey: 'AIzaSyChaveDoGemini1234567890', modelo: 'gemini-3.8-flash', chaves: {} };
    await chamar('mdlIniciar');
    document.getElementById('cvIaChave').value = 'AIzaSyChaveDoGemini1234567890';

    // Ranking por nome diz quem redige bem; não diz quem busca. Só a chamada diz.
    respostaDeBusca = { comFontes: true };
    const r = await chamar('mdlTestarBusca');
    ok(r && r.ok === true, 'o teste faz uma chamada de verdade e vê se houve busca');
    ok((CONFIG.buscaWeb || {})['gemini/gemini-3.8-flash'].ok === true,
       'o resultado fica guardado por modelo, para não se testar a mesma coisa toda vez');
    ok(/Fez a busca na web/.test(document.getElementById('cvIaEstado').textContent),
       'e a tela diz o que se mediu');
    ok(/busca ✓/.test(document.getElementById('cvIaModelo').innerHTML),
       'a lista passa a marcar o modelo medido');

    respostaDeBusca = { comFontes: false };
    await chamar('mdlTestarBusca');
    ok((CONFIG.buscaWeb || {})['gemini/gemini-3.8-flash'].ok === false,
       'e um "não buscou" também fica registrado, que é a informação mais útil das duas');
    ok(/NÃO fez a busca/.test(document.getElementById('cvIaEstado').textContent),
       'com a tela dizendo o que ainda funciona sem busca');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
