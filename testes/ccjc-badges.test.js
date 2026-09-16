// Badges do Podemos na CCJC — autoria (etapa 1 do port vindo do Plenário).
//
// A CCJC já fazia a chamada certa e jogava o resultado fora: pegava os três
// primeiros NOMES de /proposicoes/{id}/autores e descartava partido e ordem de
// assinatura, com um `catch (_) {}` que transformava falha em lista vazia.
//
// Enquanto a tela só listava nomes, isso era inofensivo. Com um badge, vira
// afirmação: consulta que falhou apareceria como "Autoria: não-Podemos". Por
// isso o port traz o estado de DÚVIDA junto — é ele que impede o badge de
// mentir, e é o que este teste trava antes de tudo.
//
// O que se verifica:
//   · autoria do Podemos, coautoria (ordem de assinatura > 1) e não-Podemos;
//   · falha de consulta vira "não verificada", nunca "não-Podemos";
//   · a falha de um deputado não é cacheada — a próxima apuração tenta de novo;
//   · `autores` continua sendo lista de nomes (o prompt da IA depende disso);
//   · a estrela da lista lateral só aparece para autoria do Podemos.
//
// Uso: node testes/ccjc-badges.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'ccjc.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window } = parseHTML(html);

// ---------- API da Câmara de mentira ----------
// `deputados` mapeia id → partido; `derrubar` força HTTP 500 no que casar.
const api = { deputados: {}, autores: {}, bancada: [], relacionadas: {}, props: {}, derrubar: null, chamadas: [] };
const resp = obj => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
const erro  = st => ({ ok: false, status: st, json: async () => ({}), text: async () => '' });

const ctx = {
  document, window, DOMParser, setTimeout, clearTimeout, URL, TextDecoder, AbortController,
  console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  btoa: s => Buffer.from(s, 'latin1').toString('base64'),
  fetch: async (url) => {
    const u = String(url);
    api.chamadas.push(u);
    if (api.derrubar && api.derrubar.test(u)) return erro(500);
    let m = u.match(/\/deputados\/(\d+)/);
    if (m) {
      const p = api.deputados[m[1]];
      return p ? resp({ dados: { ultimoStatus: { nome: p.nome, siglaPartido: p.partido, siglaUf: p.uf } } }) : erro(404);
    }
    if (/\/deputados\?siglaPartido=PODE/.test(u)) return resp({ dados: api.bancada });
    m = u.match(/\/proposicoes\/(\d+)\/relacionadas/);
    if (m) return resp({ dados: api.relacionadas[m[1]] || [] });
    m = u.match(/\/proposicoes\/(\d+)$/);
    if (m) return api.props[m[1]] ? resp({ dados: api.props[m[1]] }) : erro(404);
    m = u.match(/\/proposicoes\/(\d+)\/autores/);
    if (m) return resp({ dados: api.autores[m[1]] || [] });
    return erro(599);
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) },
  alert: () => {}, confirm: () => false, prompt: () => null,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

const dep = (id, ordem) => ({ nome: api.deputados[id]?.nome || `Dep ${id}`, uri: `https://x/deputados/${id}`, ordemAssinatura: ordem });

(async () => {
  api.deputados = {
    '11': { nome: 'Ana Paula', partido: 'PODE', uf: 'SP' },
    '22': { nome: 'Bruno Lima', partido: 'PL',   uf: 'MG' },
    '33': { nome: 'Carla Dias', partido: 'PODE', uf: 'RS' },
    // Só do caso de falha: precisa de um deputado ainda NÃO consultado, senão
    // o cache responde e a queda da API nem chega a acontecer.
    '44': { nome: 'Décio Rocha', partido: 'PODE', uf: 'PR' },
  };

  console.log('== autoria do Podemos ==');
  {
    api.autores['100'] = [dep('11', 1), dep('22', 2)];
    const r = await av(`apurarAutoria('100')`);
    ok(r.autoria.podemos === true, 'deputada do Podemos como 1ª signatária → autoria do Podemos');
    ok(r.autoria.principal === true, 'e é autoria PRINCIPAL, não coautoria');
    ok(r.autoria.incerta === false, 'sem dúvida a declarar');
    ok(r.autoria.nomesPode.join() === 'Ana Paula', 'com o nome de quem é do Podemos');
    ok(r.nomes.join(', ') === 'Ana Paula, Bruno Lima', 'e a lista de nomes sai completa, para o prompt da IA');

    const b = await av(`badgeAutoria({ autoria: ${JSON.stringify(r.autoria)} })`);
    ok(b.texto === '★ Autoria Podemos', `badge por extenso (${b.texto})`);
    ok(b.cls === 'pode', 'na cor do Podemos');
  }

  console.log('\n== coautoria: o Podemos assina depois ==');
  {
    api.autores['101'] = [dep('22', 1), dep('33', 2)];
    const r = await av(`apurarAutoria('101')`);
    ok(r.autoria.podemos === true, 'segue sendo autoria do Podemos');
    ok(r.autoria.principal === false, 'mas não principal — a ordem de assinatura é 2');
    const b = await av(`badgeAutoria({ autoria: ${JSON.stringify(r.autoria)} })`);
    ok(b.texto === '★ Coautoria Podemos', `e o badge diz Coautoria (${b.texto})`);
  }

  console.log('\n== nenhum do Podemos ==');
  {
    api.autores['102'] = [dep('22', 1)];
    const r = await av(`apurarAutoria('102')`);
    ok(r.autoria.podemos === false && r.autoria.incerta === false, 'apurado e negativo');
    const b = await av(`badgeAutoria({ autoria: ${JSON.stringify(r.autoria)} })`);
    ok(b.texto === 'Autoria: não-Podemos', `o badge afirma, porque apurou (${b.texto})`);
    ok(b.cls === 'neutro', 'em tom neutro');
  }

  console.log('\n== o que este port existe para impedir: falha virando fato ==');
  {
    // O cadastro do deputado cai. Antes, `catch (_) {}` deixava a lista vazia e
    // o badge diria "não-Podemos" — afirmando o que não apurou.
    api.autores['103'] = [dep('44', 1)];
    api.derrubar = /\/deputados\/44$/;
    const r = await av(`apurarAutoria('103')`);
    api.derrubar = null;
    ok(r.autoria.podemos === false, 'sem confirmação, não afirma que é do Podemos');
    ok(r.autoria.incerta === true, 'mas registra a DÚVIDA');
    const b = await av(`badgeAutoria({ autoria: ${JSON.stringify(r.autoria)} })`);
    ok(b.texto === 'Autoria: não verificada', `e o badge diz isso (${b.texto})`);
    ok(b.cls === 'incerto' && /falhou/i.test(b.title), 'com o motivo ao passar o mouse');

    // E a falha não ficou cacheada: com a API de pé, a mesma apuração acerta.
    const r2 = await av(`apurarAutoria('103')`);
    ok(r2.autoria.podemos === true && r2.autoria.incerta === false,
       'a falha NÃO foi cacheada — a apuração seguinte acerta');
  }
  {
    // A lista de autores inteira falha.
    api.autores['104'] = [dep('11', 1)];
    api.derrubar = /\/proposicoes\/104\/autores/;
    const r = await av(`apurarAutoria('104')`);
    api.derrubar = null;
    ok(r.autoria.incerta === true && r.autoria.podemos === false,
       'consulta de autores fora do ar também vira dúvida, não negativa');
    ok(r.nomes.length === 0, 'e nenhum nome é inventado');
  }

  console.log('\n== cache poupa a rede quando dá certo ==');
  {
    api.autores['105'] = [dep('11', 1)];
    api.autores['106'] = [dep('11', 1)];
    await av(`apurarAutoria('105')`);
    const antes = api.chamadas.filter(u => /\/deputados\/11$/.test(u)).length;
    await av(`apurarAutoria('106')`);
    const depois = api.chamadas.filter(u => /\/deputados\/11$/.test(u)).length;
    ok(depois === antes, `o mesmo deputado não é consultado de novo (${antes} → ${depois})`);
  }

  console.log('\n== relatoria: casada contra a bancada, e calada quando não casa ==');
  {
    api.bancada = [
      { nome: 'Ana Paula Ferreira', nomeEleitoral: 'Ana Paula' },
      { nome: 'Décio Rocha',        nomeEleitoral: 'Delegado Décio' },
      { nome: 'Carla Dias' },
    ];

    ok(await av(`apurarRelatoria({ relator: 'Ana Paula' })`) === 'pode',
       'relatora pelo nome eleitoral, como a pauta costuma escrever');
    ok(await av(`apurarRelatoria({ relator: 'Ana Paula Ferreira' })`) === 'pode',
       'e pelo nome civil também');
    ok(await av(`apurarRelatoria({ relator: 'DELEGADO DÉCIO' })`) === 'pode',
       'acento e caixa não atrapalham o casamento');
    ok(await av(`apurarRelatoria({ relator: 'Bruno Lima' })`) === 'fora',
       'quem não está na bancada é apurado como de fora');
    ok(await av(`apurarRelatoria({ relator: '' })`) === null,
       'item sem relator na pauta: nada a apurar');

    const b = await av(`badgeRelatoria({ relatoria: 'pode', relator: 'Ana Paula' })`);
    ok(b && /Relatoria Podemos/.test(b.texto), `o badge sai por extenso (${b ? b.texto : 'nenhum'})`);
    ok(b.cls === 'rel' && /Ana Paula/.test(b.title), 'com o nome do relator ao passar o mouse');
    ok(av(`badgeRelatoria({ relatoria: 'fora', relator: 'Bruno Lima' })`) === null,
       'relator de fora NÃO ganha badge — a tela não precisa dizer de quem não é');
    ok(av(`badgeRelatoria({ relatoria: null, relator: 'Fulano' })`) === null,
       'e sem apuração também não');
  }

  console.log('\n== o nome que não casa se cala, em vez de negar ==');
  {
    // Um relator do Podemos que a pauta escreveu de um jeito que o cadastro não
    // tem. A regra combinada: não afirma nem nega — apenas não marca.
    ok(await av(`apurarRelatoria({ relator: 'Ana P. F.' })`) === 'fora',
       'grafia divergente não casa (limite conhecido da apuração por nome)');
    ok(av(`badgeRelatoria({ relatoria: 'fora', relator: 'Ana P. F.' })`) === null,
       'e, porque "fora" não gera badge, o erro é SILÊNCIO e não uma afirmação errada');
  }

  console.log('\n== bancada fora do ar: nenhuma relatoria é negada ==');
  {
    // Zera o cache do módulo para a consulta acontecer de novo.
    av('_bancadaPode = null');
    api.derrubar = /siglaPartido=PODE/;
    ok(await av(`apurarRelatoria({ relator: 'Ana Paula' })`) === null,
       'sem a bancada, a relatora do Podemos não vira "fora" — vira indefinida');
    api.derrubar = null;
    av('_bancadaPode = null');
    ok(await av(`apurarRelatoria({ relator: 'Ana Paula' })`) === 'pode',
       'e com a API de volta, acerta');
  }

  console.log('\n== apensadas do Podemos, apuradas sob demanda ==');
  {
    // 200 é a matéria da pauta. 201 é apensada a ela e é do Podemos; 202 é
    // apensada mas de outro partido; 203 tramita em conjunto de OUTRA cadeia.
    api.props = {
      '200': { statusProposicao: { descricaoSituacao: 'Pronta para Pauta' } },
      '201': { uriPropPrincipal: 'https://x/proposicoes/200', statusProposicao: { descricaoSituacao: 'Tramitando em Conjunto' } },
      '202': { uriPropPrincipal: 'https://x/proposicoes/200', statusProposicao: { descricaoSituacao: 'Tramitando em Conjunto' } },
      '203': { uriPropPrincipal: 'https://x/proposicoes/900', statusProposicao: { descricaoSituacao: 'Tramitando em Conjunto' } },
      '900': { statusProposicao: { descricaoSituacao: 'Pronta para Pauta' } },
      '204': { statusProposicao: { descricaoSituacao: 'Aguardando Parecer' } },
    };
    api.relacionadas['200'] = [
      { id: 201, siglaTipo: 'PL', numero: 2714, ano: 2025 },
      { id: 202, siglaTipo: 'PL', numero: 582,  ano: 2024 },
      { id: 203, siglaTipo: 'PL', numero: 111,  ano: 2023 },
      { id: 204, siglaTipo: 'PL', numero: 777,  ano: 2026 },
    ];
    api.autores['201'] = [dep('11', 1)];   // Ana Paula, PODE
    api.autores['202'] = [dep('22', 1)];   // Bruno Lima, PL
    api.autores['203'] = [dep('33', 1)];   // Carla Dias, PODE — mas outra cadeia

    const proj = { idCamara: 200 };
    ctx.__proj = proj;
    await av('apurarApensados(__proj)');

    ok(proj.apensados.falhou === false, 'apuração concluída');
    const chaves = proj.apensados.lista.map(a => `${a.siglaTipo} ${a.numero}/${a.ano}`);
    ok(chaves.join() === 'PL 2714/2025', `só a apensada do Podemos da MESMA cadeia entra (${chaves.join(', ') || 'nenhuma'})`);
    ok(proj.apensados.lista[0].nomes.join() === 'Ana Paula', 'com o nome de quem assina');

    const bs = av('badgesApensados(__proj)');
    ok(bs.length === 1 && /Apensado Podemos: PL 2714\/2025/.test(bs[0].texto), `badge por apensada (${bs[0]?.texto})`);
    ok(bs[0].cls === 'apens', 'na cor de apensado');
  }

  console.log('\n== falha na apuração das apensadas não vira "não há" ==');
  {
    const proj = { idCamara: 200, apensados: null };
    ctx.__proj2 = proj;
    api.derrubar = /\/proposicoes\/200\/relacionadas/;
    await av('apurarApensados(__proj2)');
    api.derrubar = null;

    ok(proj.apensados.falhou === true, 'a falha fica registrada');
    ok(proj.apensados.lista.length === 0, 'sem lista inventada');
    const bs = av('badgesApensados(__proj2)');
    ok(bs.length === 1 && /não verificadas/.test(bs[0].texto),
       `e a tela diz que não verificou, em vez de ficar muda (${bs[0]?.texto})`);
    ok(/Reabra o projeto/.test(bs[0].title), 'dizendo o que fazer');

    // Falhou antes → a próxima abertura do projeto tenta de novo.
    await av('apurarApensados(__proj2)');
    ok(proj.apensados.falhou === false, 'reabrir o projeto refaz a apuração que falhou');
  }

  console.log('\n== projeto sem apensada e projeto sem id ==');
  {
    api.relacionadas['205'] = [];
    api.props['205'] = { statusProposicao: {} };
    ctx.__proj3 = { idCamara: 205 };
    await av('apurarApensados(__proj3)');
    ok(av('__proj3.apensados.lista.length') === 0 && av('__proj3.apensados.falhou') === false,
       'sem apensadas, apuração concluída e vazia — que é diferente de falhada');
    ok(av('badgesApensados(__proj3)').length === 0, 'e nenhum badge');

    ctx.__proj4 = { idCamara: null };
    await av('apurarApensados(__proj4)');
    ok(av('__proj4.apensados') === undefined, 'projeto cuja proposição não foi resolvida não é apurado');
    ok(av('badgesApensados(__proj4)').length === 0, 'e não quebra a montagem dos badges');
  }

  console.log('\n== a estrela da lista lateral ==');
  {
    const comPode = av(`marcasCompactas({ autoria: { podemos: true, principal: true, nomesPode: ['Ana Paula'] } })`);
    ok(/★/.test(comPode) && /Autoria do Podemos/.test(comPode), 'autoria do Podemos ganha estrela, com o nome no title');
    const coaut = av(`marcasCompactas({ autoria: { podemos: true, principal: false, nomesPode: ['Carla Dias'] } })`);
    ok(/Coautoria do Podemos/.test(coaut), 'coautoria também, e o title distingue');
    ok(av(`marcasCompactas({ autoria: { podemos: false, incerta: false, nomesPode: [] } })`) === '',
       'não-Podemos não polui a lista');
    ok(av(`marcasCompactas({ autoria: { podemos: false, incerta: true, nomesPode: [] } })`) === '',
       'e dúvida também não: na lista, ausência de estrela não afirma nada — o badge está no cabeçalho');
    ok(av(`marcasCompactas({})`) === '', 'projeto ainda sem apuração não quebra a lista');

    const comR = av(`marcasCompactas({ relatoria: 'pode', relator: 'Ana Paula' })`);
    ok(/>R</.test(comR) && /Relatoria do Podemos/.test(comR), 'relatoria do Podemos vira um R na lista');
    ok(av(`marcasCompactas({ relatoria: 'fora', relator: 'Bruno Lima' })`) === '',
       'relatoria de fora não marca nada');
    const ambos = av(`marcasCompactas({ autoria: { podemos: true, principal: true, nomesPode: ['Ana Paula'] }, relatoria: 'pode', relator: 'Ana Paula' })`);
    ok(/★/.test(ambos) && />R</.test(ambos), 'autoria e relatoria convivem no mesmo item');
  }

  console.log('\n== o badge não entra no texto da nota ==');
  {
    const cab = av(`htmlBadgesProjeto({ autoria: { podemos: true, principal: true, nomesPode: ['Ana Paula'] } })`);
    ok(/ccjc-badge--pode/.test(cab), 'o cabeçalho monta o badge');
    ok(av(`htmlBadgesProjeto({})`) === '', 'e sem apuração não monta nada');

    const src = fs.readFileSync(path.join(RAIZ, 'ccjc.js'), 'utf8');
    ok(!/resumoOriginal[^\n]*htmlBadgesProjeto|htmlBadgesProjeto[^\n]*resumoOriginal/.test(src),
       'o badge não é injetado junto do texto gerado pela IA');
    ok(/GÊMEO: a mesma apuração existe em analise\.js/.test(src),
       'a duplicação com o Plenário está declarada no código, para quem for corrigir');
  }

  console.log('\n== CSS ==');
  {
    const css = fs.readFileSync(path.join(RAIZ, 'panel.css'), 'utf8');
    for (const c of ['pode', 'incerto', 'neutro', 'rel', 'apens']) {
      ok(new RegExp(`\\.ccjc-badge--${c}\\b`).test(css), `.ccjc-badge--${c} existe`);
    }
    ok(/\.ccjc-marca--pode/.test(css), 'e a estrela da lista tem cor própria');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
