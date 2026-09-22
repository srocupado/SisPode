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
// A lista viva do Gemini NÃO é só de modelos de texto: imagem, voz, vídeo e
// embedding vêm junto, todos com generateContent. A fixture reproduz isso
// porque foi exatamente o que quebrou a tela em 22/09/2026 — ver o bloco
// "a lista viva traz modelos que não redigem".
const MODELOS = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash',
                 'gemini-3-pro-image', 'gemini-2.5-pro-preview-tts', 'gemini-embedding-001'];
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
    ok(/<script src="parecer\.js"/.test(html) && rec.includes('parecer.js'),
       'e parecer.js está carregado: é dele que vem a faixa do modelo, como no Plenário');
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
    ok(/modelo\(s\) de texto nesta chave/.test(document.getElementById('cvIaModeloEstado').textContent),
       'com a contagem à vista');
  }

  console.log('\n== a lista viva traz modelos que NÃO redigem ==');
  {
    // O erro de 22/09/2026, na tela: "Não consegui listar (undefined is not
    // iterable (cannot read property Symbol(Symbol.iterator)))". A lista viva
    // tinha chegado; quem quebrou foi a MONTAGEM dela, dentro do try — e o
    // catch culpou o provedor. A causa: faixaDoModelo devolve
    // 'outra_modalidade' para gemini-3-pro-image e afins, chave que esta tela
    // não tinha nos seus mapas, e o `const [classe, txt] = MAPA[faixa]`
    // destruturava undefined.
    const ids = () => [...document.getElementById('cvIaModelo').querySelectorAll('option')]
      .map(o => o.getAttribute('value'));

    // SEM modelo salvo — que é o caso que originou esta tela: quem reseta o
    // sistema e entra direto no módulo. Sem modelo salvo, a lista marca a
    // PRIMEIRA opção, e a ordenação quebrada (peso[undefined] = NaN, que é
    // falsy, então só a versão decidia) punha o gemini-3-pro-image no topo.
    // Selecionado ele, o aviso da faixa estourava — dentro do try do listar.
    CONFIG = { provedor: 'gemini', apiKey: 'AIzaSyChaveDoGemini1234567890', chaves: {} };
    await chamar('mdlIniciar');
    document.getElementById('cvIaChave').value = 'AIzaSyChaveDoGemini1234567890';
    const lista = await chamar('mdlListarModelos');

    ok(lista && lista.length === MODELOS.length, 'a lista do provedor chega inteira');
    let est = document.getElementById('cvIaModeloEstado').textContent;
    ok(!/Não consegui listar/.test(est), `sem modelo salvo, listar não quebra na montagem (${est})`);
    ok(chamar('mdlValorSel', document.getElementById('cvIaModelo')) === 'gemini-3.1-pro-preview',
       'e a primeira opção é o melhor modelo de TEXTO, não o de imagem mais novo');

    CONFIG = { provedor: 'gemini', apiKey: 'AIzaSyChaveDoGemini1234567890', modelo: 'gemini-3.8-flash', chaves: {} };
    await chamar('mdlIniciar');
    document.getElementById('cvIaChave').value = 'AIzaSyChaveDoGemini1234567890';
    await chamar('mdlListarModelos');
    est = document.getElementById('cvIaModeloEstado').textContent;
    ok(!/Não consegui listar/.test(est), `com modelo salvo, idem (${est})`);

    ok(!ids().includes('gemini-3-pro-image'), 'modelo de imagem fica fora da escolha');
    ok(!ids().includes('gemini-2.5-pro-preview-tts'), 'modelo de voz também');
    ok(!ids().includes('gemini-embedding-001'), 'e o de embedding');
    ok(ids().includes('gemini-3.8-flash') && ids().includes('gemini-3.1-pro-preview'),
       'enquanto os de texto continuam todos lá');
    ok(/3 de imagem, voz ou embedding ficaram de fora/.test(est),
       'e a contagem diz quantos ficaram de fora, em vez de o analista procurar o que não está lá');

    // Um modelo de outra modalidade JÁ SALVO não some em silêncio: some seria
    // trocar a escolha de alguém sem avisar, e o sintoma seria uma análise que
    // não sai. Ele entra, e o rótulo diz o que ele é.
    CONFIG = { provedor: 'gemini', apiKey: 'AIzaSyChaveDoGemini1234567890', modelo: 'gemini-3-pro-image', chaves: {} };
    await chamar('mdlIniciar');
    chamar('mdlMontarModelos', 'gemini', MODELOS.map(id => ({ id, displayName: id })));
    ok(ids().includes('gemini-3-pro-image'), 'o modelo de imagem já salvo continua na lista');
    const opt = [...document.getElementById('cvIaModelo').querySelectorAll('option')]
      .find(o => o.getAttribute('value') === 'gemini-3-pro-image');
    ok(/não redige texto/.test(opt.textContent), 'marcado com o que ele é');
    ok(!/não ofertado pelo provedor agora/.test(opt.textContent),
       'e sem dizer que o provedor não o oferta, porque oferta — só não serve aqui');

    // O aviso abaixo do campo é onde o `[classe, txt] = undefined` estourava.
    chamar('mdlMarcar', document.getElementById('cvIaModelo'), 'gemini-3-pro-image');
    chamar('mdlPintarFaixa');
    ok(/não redige texto/.test(document.getElementById('cvIaFaixa').textContent),
       'e o aviso da faixa diz por que nada vai sair, em vez de derrubar a tela');
  }

  console.log('\n== a lista de modelos é a do Plenário, que é o padrão da casa ==');
  {
    const opcoes = () => [...document.getElementById('cvIaModelo').querySelectorAll('option')];
    const textos = () => opcoes().map(o => o.textContent.trim());

    // Cada opção diz a sua faixa. Escolher por nome não diz se o modelo dá conta.
    ok(textos().every(t => /faixa (superior|intermediária|econômica|não identificada)|não redige texto/.test(t)),
       `toda opção declara a faixa (${textos()[0]})`);

    // Ordenada por faixa, e dentro da faixa o mais novo primeiro.
    const faixas = opcoes().map(o => chamar('mdlFaixa', o.getAttribute('value')));
    const peso = { superior: 3, nao_identificada: 2, intermediaria: 1, economica: 0, outra_modalidade: -1 };
    ok(faixas.every((f, i) => i === 0 || peso[faixas[i - 1]] >= peso[f]),
       `e vem ordenada da faixa mais alta para a mais baixa (${faixas.join(' > ')})`);

    // O aviso do que aquela faixa significa.
    ok(document.getElementById('cvIaFaixa').textContent.length > 20,
       `abaixo do campo, o que a faixa escolhida significa ("${document.getElementById('cvIaFaixa').textContent.slice(0, 44)}…")`);

    // Um modelo salvo que o provedor não oferta mais não some em silêncio.
    CONFIG = { provedor: 'gemini', apiKey: 'AIzaSyChaveDoGemini1234567890', modelo: 'gemini-modelo-aposentado', chaves: {} };
    await chamar('mdlIniciar');
    const salvo = opcoes().find(o => o.getAttribute('value') === 'gemini-modelo-aposentado');
    ok(!!salvo, 'o modelo salvo entra na lista mesmo fora da oferta do provedor');
    ok(/não ofertado pelo provedor agora/.test(salvo.textContent),
       'e se anuncia como tal, em vez de sumir e trocar a escolha de alguém em silêncio');

    // O olho, que é do Plenário também: chave é senha, mas dá para conferir.
    const c = document.getElementById('cvIaChave');
    ok(c.getAttribute('type') === 'password', 'a chave nasce oculta');
    document.getElementById('cvIaOlho').dispatchEvent(new Event('click'));
    ok(c.getAttribute('type') === 'text', 'e o olho revela, para conferir o que se colou');
    document.getElementById('cvIaOlho').dispatchEvent(new Event('click'));
    ok(c.getAttribute('type') === 'password', 'e esconde de novo');
  }

  console.log('\n== salvar grava onde as outras telas leem ==');
  {
    CONFIG = {};
    await chamar('mdlIniciar');
    document.getElementById('cvIaChave').value = 'AIzaSyChaveDeTesteComTamanhoSuficiente';
    await chamar('mdlListarModelos');
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

    // Reabrir tem de mostrar o que está SALVO, e não a edição abandonada. O
    // provedor é onde isso custa mais caro: um campo que ficou em Anthropic
    // manda a chamada seguinte para o provedor errado, com a chave do outro.
    CONFIG = { provedor: 'gemini', apiKey: 'AIzaSyChaveDoGemini1234567890', modelo: 'gemini-2.5-pro', chaves: {} };
    document.getElementById('cvIaProvedor').querySelector('option[value="anthropic"]').selected = true;
    await chamar('mdlIniciar');
    ok(chamar('mdlValorSel', document.getElementById('cvIaProvedor')) === 'gemini',
       'reabrir devolve o provedor salvo, e não o que ficou selecionado sem salvar');
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
    ok(/busca na web ✓/.test(document.getElementById('cvIaModelo').innerHTML),
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
