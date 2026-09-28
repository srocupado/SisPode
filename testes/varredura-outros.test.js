// Correções da varredura de 28/09/2026 fora do módulo Relatórios.
//
// O que este teste trava:
//  1. CCJC — apensadas: falha de consulta (detalhe de proposição, autoria)
//     NÃO vira "não há apensada do Podemos"; o que se apurou continua na tela
//     junto do aviso; a falha não fica presa no cache;
//  2. CCJC — o resultado das apensadas vence em 24h e é refeito;
//  3. CCJC — apelidos do PDF: no máximo 4 chamadas de IA ao mesmo tempo, e o
//     que caiu na ementa é contado e tentado de novo na próxima geração;
//  4. Painel — o destaque é gravado na posição que ele tem NO SERVIDOR (pela
//     chave da proposição e pelo número do destaque), e o que não existe lá é
//     acrescentado no fim, sem PUT da sessão inteira;
//  5. IA compartilhada — citação da OpenAI sem posição não vira "fonte do
//     texto inteiro";
//  6. a chave do Gemini vai no cabeçalho x-goog-api-key, nunca na URL.
//
// Uso: node testes/varredura-outros.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const resp = obj => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
const erro = st => ({ ok: false, status: st, json: async () => ({}), text: async () => '' });

// ---------------------------------------------------------------- CCJC
function montarCCJC(api) {
  const html = fs.readFileSync(path.join(RAIZ, 'ccjc.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window } = parseHTML(html);
  const ctx = {
    document, window, DOMParser, setTimeout, clearTimeout, URL, TextDecoder, AbortController,
    console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    fetch: async (url) => {
      const u = String(url);
      api.chamadas.push(u);
      if (api.derrubar && api.derrubar.test(u)) return erro(500);
      let m = u.match(/\/deputados\/(\d+)$/);
      if (m) {
        const p = api.deputados[m[1]];
        return p ? resp({ dados: { ultimoStatus: { nome: p.nome, siglaPartido: p.partido, siglaUf: 'SP' } } }) : erro(404);
      }
      m = u.match(/\/proposicoes\/(\d+)\/relacionadas/);
      if (m) return resp({ dados: api.relacionadas[m[1]] || [] });
      m = u.match(/\/proposicoes\/(\d+)\/autores/);
      if (m) return resp({ dados: api.autores[m[1]] || [] });
      m = u.match(/\/proposicoes\/(\d+)$/);
      if (m) return api.props[m[1]] ? resp({ dados: api.props[m[1]] }) : erro(404);
      return erro(599);
    },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) },
    alert: () => {}, confirm: () => false, prompt: () => null,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
  return { ctx, av: e => vm.runInContext(e, ctx) };
}

// ---------------------------------------------------------------- Painel
function montarPainel(servidor, gravacoes) {
  const HTML = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8');
  const FONTE = ['pauta-parser.js', 'mpv.js', 'panel.js'].map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');
  const { document, window, Event } = parseHTML(HTML);
  // Firebase de mentira: um objeto, com GET (inclusive ?shallow), PUT e PATCH por caminho.
  const caminho = u => decodeURIComponent(new URL(u).pathname.replace(/\.json$/, '')).split('/').filter(Boolean);
  const ler = partes => partes.reduce((o, k) => (o == null ? undefined : o[k]), servidor);
  const escrever = (partes, valor, patch) => {
    let o = servidor;
    for (const k of partes.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k]; }
    const f = partes[partes.length - 1];
    o[f] = patch ? { ...(o[f] || {}), ...valor } : valor;
  };
  const ctx = {
    document, window, DOMParser, Event,
    console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async (url, opt) => {
      const u = String(url), metodo = (opt && opt.method) || 'GET';
      if (!/firebaseio\.com/.test(u)) return resp({});
      const partes = caminho(u);
      gravacoes.push({ metodo, partes: partes.join('/') });
      if (metodo === 'GET') {
        const v = ler(partes);
        if (/shallow=true/.test(u)) return resp(v == null ? null : Object.fromEntries(Object.keys(v).map(k => [k, true])));
        return resp(v === undefined ? null : v);
      }
      escrever(partes, JSON.parse(opt.body), metodo === 'PATCH');
      return resp({});
    },
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
  return { ctx, av: e => vm.runInContext(e, ctx) };
}

(async () => {
  console.log('== CCJC: apensadas — falha de consulta não é ausência ==');
  {
    const api = {
      chamadas: [], derrubar: null,
      deputados: { 11: { nome: 'Ana Pode', partido: 'PODE' }, 22: { nome: 'Beto PL', partido: 'PL' } },
      relacionadas: { 100: [{ id: 201, siglaTipo: 'PL', numero: 1, ano: 2025 },
                            { id: 202, siglaTipo: 'PL', numero: 2, ano: 2025 },
                            { id: 203, siglaTipo: 'PL', numero: 3, ano: 2025 }] },
      props: {
        100: { id: 100, statusProposicao: { descricaoSituacao: 'Aguardando Parecer' } },
        201: { id: 201, uriPropPrincipal: 'https://x/proposicoes/100', statusProposicao: { descricaoSituacao: 'Tramitando em Conjunto' } },
        202: { id: 202, uriPropPrincipal: 'https://x/proposicoes/100', statusProposicao: { descricaoSituacao: 'Tramitando em Conjunto' } },
        203: { id: 203, uriPropPrincipal: 'https://x/proposicoes/100', statusProposicao: { descricaoSituacao: 'Tramitando em Conjunto' } },
      },
      autores: {
        201: [{ nome: 'Ana Pode', uri: 'https://x/deputados/11', ordemAssinatura: 1 }],
        202: [{ nome: 'Ana Pode', uri: 'https://x/deputados/11', ordemAssinatura: 1 }],
        203: [{ nome: 'Beto PL', uri: 'https://x/deputados/99', ordemAssinatura: 1 }],   // deputado 99: consulta falha
      },
    };
    const { ctx, av } = montarCCJC(api);
    api.derrubar = /\/proposicoes\/202$/;
    ctx.__p = { chave: 'PL 100/2025', idCamara: 100 };
    await av('apurarApensados(__p, 1000)');
    const a = av('__p.apensados');
    ok(a.lista.length === 1 && a.lista[0].id === 201, `a apensada do Podemos que se apurou (201) continua na lista (${a.lista.map(x => x.id)})`);
    ok(a.falhou === true, 'e o resultado é "não verificado", não "sem outras apensadas"');
    ok(/PL 2\/2025/.test(a.motivo), `o motivo nomeia a proposição que não se pôde examinar (${a.motivo})`);
    ok(/autoria de PL 3\/2025 não verificada/.test(a.motivo), 'e a apensada cuja autoria não se apurou');
    const badges = av('badgesApensados(__p)');
    ok(badges.some(b => b.cls === 'apens') && badges.some(b => b.cls === 'incerto' && /Outras apensadas/.test(b.texto)),
       `a tela mostra a apensada encontrada E o aviso (${badges.map(b => b.texto).join(' | ')})`);

    // A falha não ficou no cache: com a API de volta, a próxima abertura acha a 202.
    api.derrubar = null;
    api.deputados[99] = { nome: 'Beto PL', partido: 'PL' };
    await av('apurarApensados(__p, 2000)');
    const b = av('__p.apensados');
    ok(!b.falhou && b.lista.map(x => x.id).sort().join(',') === '201,202',
       `refeito sem falha, as duas apensadas do Podemos aparecem (${b.lista.map(x => x.id)})`);

    console.log('\n== CCJC: o resultado das apensadas vence em 24h ==');
    api.chamadas.length = 0;
    await av('apurarApensados(__p, 2000 + 60 * 60 * 1000)');
    ok(!api.chamadas.some(u => /relacionadas/.test(u)), 'uma hora depois, não consulta de novo');
    await av('apurarApensados(__p, 2000 + 25 * 60 * 60 * 1000)');
    ok(api.chamadas.some(u => /relacionadas/.test(u)), '25 horas depois, refaz a apuração (pega apensamento novo)');
  }

  console.log('\n== CCJC: apelidos — no máximo 4 chamadas ao mesmo tempo ==');
  {
    const { ctx, av } = montarCCJC({ chamadas: [], deputados: {}, relacionadas: {}, props: {}, autores: {} });
    av(`app.config = { apiKey: 'x', provedor: 'gemini', modelo: 'm' }`);
    let ativas = 0, pico = 0, n = 0;
    ctx.__aiCall = async () => {
      const minha = ++n;   // o número desta chamada, fixado ANTES da espera
      ativas++; pico = Math.max(pico, ativas);
      await new Promise(r => setTimeout(r, 5));
      ativas--;
      if (minha % 3 === 0) throw new Error('429 Too Many Requests');
      return 'Apelido gerado';
    };
    av('aiCall = __aiCall');
    ctx.__ps = Array.from({ length: 12 }, (_, i) => ({ chave: `PL ${i + 1}/2026`, ementa: `Altera a Lei nº 9.503, de 1997, item ${i + 1}.` }));
    const r = await av('prepararApelidos(__ps)');
    ok(pico <= 4, `pico de ${pico} chamadas simultâneas (teto 4)`);
    ok(r.reserva === 4, `as 4 que falharam são contadas (${r.reserva})`);
    ok(ctx.__ps.filter(p => p.apelidoReserva).length === 4 && ctx.__ps.every(p => p.apelido),
       'e saem com o apelido da ementa, marcadas como reserva — o PDF não fica sem apelido');
    const antes = ctx.__ps.filter(p => !p.apelidoReserva).map(p => p.apelido);
    let chamadasDaSegunda = 0;
    ctx.__aiCall = async () => { chamadasDaSegunda++; return 'Apelido novo'; };
    av('aiCall = __aiCall');
    await av('prepararApelidos(__ps)');
    ok(chamadasDaSegunda === 4, `a segunda geração só tenta de novo as 4 da reserva (${chamadasDaSegunda} chamadas)`);
    ok(ctx.__ps.every(p => !p.apelidoReserva), 'e agora todas têm apelido da IA');
    ok(ctx.__ps.filter(p => p.apelido === 'Apelido gerado').length === antes.length, 'os que já estavam bons não foram refeitos');
  }

  console.log('\n== Painel: destaque gravado na posição do SERVIDOR ==');
  {
    const destaque = (numero, extra) => ({ numero, descricao: `Destaque ${numero}`, votoSim: '', votoNao: '', explicacao: '', orientacao: '', ...extra });
    // No servidor, outro analista já mudou a ordem: a proposição do analista
    // está na posição 1 (local: 0), e o destaque 3 está na posição 0 (local: 2).
    const servidor = { sessoes: { S1: { id: 'S1', proposicoes: [
      { chave: 'PL 9/2026', destaques: [destaque('1', { explicacao: 'de outro analista' })] },
      { chave: 'PL 5/2026', destaques: [destaque('3'), destaque('1'), destaque('2')] },
    ] } } };
    const gravacoes = [];
    const { ctx, av } = montarPainel(servidor, gravacoes);
    ctx.__sess = { id: 'S1', proposicoes: [{ chave: 'PL 5/2026', destaques: [destaque('1'), destaque('2'), destaque('3')] }] };
    ctx.__prop = ctx.__sess.proposicoes[0];
    ctx.__d = ctx.__prop.destaques[2];
    ctx.__d.explicacao = 'Texto do analista para o destaque 3.';
    await av('fbSalvarDestaque(__sess, __prop, __d)');
    const s = servidor.sessoes.S1;
    ok(s.proposicoes[1].destaques[0].explicacao === 'Texto do analista para o destaque 3.',
       'o texto vai para o destaque 3 do servidor (posição 1/0), não para a posição local (0/2)');
    ok(s.proposicoes[1].destaques[2].explicacao === '' && s.proposicoes[0].destaques[0].explicacao === 'de outro analista',
       'nada mais é tocado — nem o destaque 2, nem a proposição do outro analista');
    ok(gravacoes.some(g => g.metodo === 'PATCH' && g.partes === 'sessoes/S1/proposicoes/1/destaques/0'), 'por PATCH, só nos campos do destaque');
    ok(!gravacoes.some(g => g.metodo === 'PUT' && g.partes === 'sessoes/S1'), 'e nunca PUT da sessão inteira');

    console.log('\n== Painel: o que não existe no servidor é acrescentado no fim ==');
    gravacoes.length = 0;
    ctx.__novo = destaque('7', { explicacao: 'Destaque que o servidor ainda não tem.' });
    ctx.__prop.destaques.push(ctx.__novo);
    await av('fbSalvarDestaque(__sess, __prop, __novo)');
    ok(s.proposicoes[1].destaques[3] && s.proposicoes[1].destaques[3].numero === '7', 'destaque novo entra na próxima posição livre (3)');
    ok(s.proposicoes[1].destaques.length === 4 && s.proposicoes[1].destaques[0].explicacao === 'Texto do analista para o destaque 3.',
       'sem apagar os que já estavam lá');
    ok(!gravacoes.some(g => g.partes === 'sessoes/S1' && g.metodo === 'PUT'), 'sem PUT da sessão inteira');

    ctx.__prop2 = { chave: 'PL 77/2026', destaques: [destaque('1', { explicacao: 'x' })] };
    ctx.__sess.proposicoes.push(ctx.__prop2);
    await av('fbSalvarDestaque(__sess, __prop2, __prop2.destaques[0])');
    ok(s.proposicoes[2] && s.proposicoes[2].chave === 'PL 77/2026' && s.proposicoes[0].chave === 'PL 9/2026',
       'proposição que o servidor não tem entra no fim da lista, sem tirar as outras');

    delete servidor.sessoes.S1;
    gravacoes.length = 0;
    await av('fbSalvarDestaque(__sess, __prop, __d)');
    ok(servidor.sessoes.S1 && servidor.sessoes.S1.proposicoes.length === 2 && gravacoes.some(g => g.metodo === 'PUT' && g.partes === 'sessoes/S1'),
       'sessão que não existe no servidor é gravada inteira — não há trabalho de ninguém a sobrescrever');
  }

  console.log('\n== IA compartilhada: fontes da OpenAI e chave do Gemini ==');
  {
    const pedidos = [];
    const ctx = {
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout, clearTimeout, URL, TextDecoder, TextEncoder, AbortController, Blob, Response, Headers, Request, btoa,
      fetch: async (url, init) => {
        pedidos.push({ url: String(url), headers: (init && init.headers) || {} });
        return resp({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] });
      },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8'), ctx);
    const av = e => vm.runInContext(e, ctx);

    const acc = av(`iaFontesOpenAI([{ type: 'message', content: [{ type: 'output_text',
      text: 'Primeira afirmação. Segunda afirmação, de outra fonte.',
      annotations: [{ type: 'url_citation', url: 'https://a.com/x', title: 'A' },
                    { type: 'url_citation', url: 'https://b.com/y', title: 'B', start_index: 20, end_index: 53 }] }] }],
      { fontes: [], buscas: [], trechos: [] })`);
    ok(acc.fontes.some(f => f.url === 'https://a.com/x'), 'a citação sem posição continua listada como fonte');
    ok(!acc.trechos.some(t => t.urls.includes('https://a.com/x')), 'mas não vira "fonte do texto inteiro"');
    ok(acc.trechos.length === 1 && acc.trechos[0].urls[0] === 'https://b.com/y' && /Segunda afirmação/.test(acc.trechos[0].texto),
       'a citação com posição sustenta só o pedaço que delimita');

    await av(`chamarIA({ provedorId: 'gemini', apiKey: 'CHAVE-SECRETA', modelo: 'gemini-2.5-flash', prompt: 'oi' })`);
    const p = pedidos[pedidos.length - 1];
    ok(!/CHAVE-SECRETA|[?&]key=/.test(p.url), `a chave NÃO vai na URL (${p.url})`);
    ok(p.headers['x-goog-api-key'] === 'CHAVE-SECRETA', 'vai no cabeçalho x-goog-api-key');
  }

  console.log('\n== nenhuma chamada ao Gemini leva a chave na URL, em arquivo nenhum ==');
  {
    const { execSync } = require('child_process');
    const achados = execSync(`grep -rn --include=*.js -E "(\\?|&)key=\\$\\{" . | grep -v node_modules | grep -v "^./testes" || true`,
      { cwd: RAIZ }).toString().trim();
    ok(!achados, achados ? 'ainda há chave na URL:\n' + achados : 'nenhum `?key=${…}` nos fontes da extensão e do bot');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
