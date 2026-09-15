// Correções do lote 2 da varredura (14/09/2026) — CCJC, gestão de comissões e
// painel de votação. Cada teste reproduz o cenário que levava informação errada
// à mesa do deputado ou apagava trabalho da equipe.
//
// Uso: node testes/correcoes-lote2.test.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML, DOMParser } = require(path.join(RAIZ, 'bot/node_modules/linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

function carregarPagina(html, extras = {}) {
  const fonteHtml = fs.readFileSync(path.join(RAIZ, html), 'utf8');
  const scripts = [...fonteHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window } = parseHTML(fonteHtml);
  const ctx = {
    document, window, DOMParser, console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    URL, TextDecoder, AbortController, DOMException, Event, Buffer, FormData: class {},
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('latin1'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => p, getManifest: () => ({ version: '0' }) }, tabs: { create: () => {} } },
    pdfjsLib: { GlobalWorkerOptions: {} }, docx: {}, html2canvas: () => {},
    XLSX: { read: () => ({ SheetNames: [], Sheets: {} }), utils: {} },
    alert: () => {}, confirm: () => true, prompt: () => null,
    ...extras,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const fonte = scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n');
  new vm.Script(fonte, { filename: html.replace('.html', '-pagina.js') }).runInContext(ctx);
  return { ctx, av: expr => vm.runInContext(expr, ctx) };
}

/** Página de votação do portal, no formato que o módulo espera. */
function htmlPortal(deputados, contagens = {}) {
  const li = d => `<li><span class="nome">${d.nome}</span><span class="nomePartido">${d.partido}-${d.uf}</span><span class="voto">${d.voto || 'Sim'}</span></li>`;
  // 'omitir' = o portal não trouxe essa contagem (null cairia no ?? do default)
  const qtd = (cls, v) => v === 'omitir' ? '' : `<li class="${cls}"><span class="qtd">${v}</span></li>`;
  return `<html><body>
    <select><option selected>PL 1234/2026 — votação em turno único</option></select>
    <div class="reuniaoDataLocal">Sessão de 14/09/2026</div>
    <ul>
      ${qtd('quorum', contagens.quorum ?? 400)}
      ${qtd('sim', contagens.sim ?? 300)}
      ${qtd('nao', contagens.nao ?? 100)}
      ${qtd('abstencao', contagens.abstencao ?? 0)}
      ${qtd('obstrucao', contagens.obstrucao ?? 0)}
      ${qtd('totalVotantes', contagens.totalVotantes ?? 400)}
      ${deputados.map(li).join('\n')}
    </ul></body></html>`;
}

(async () => {
  // ── Painel de votação ───────────────────────────────────────────────────
  console.log('== deputado com nome parecido não some mais do placar ==');
  const V = carregarPagina('votacao.html');
  {
    // A bancada tem dois deputados cujo nome de um começa o do outro; só o
    // primeiro aparece na página da votação, o segundo é ausente e vem da API.
    const doc = new DOMParser().parseFromString(htmlPortal([
      { nome: 'Ana Paula', partido: 'PODE', uf: 'SP' },
    ]), 'text/html');
    V.ctx.__doc = doc;
    V.av(`for (const id of ['portalParty', 'portalStatusArea', 'portalResultsArea']) {
            if (!document.getElementById(id)) { const el = document.createElement(id === 'portalParty' ? 'input' : 'div'); el.id = id; document.body.appendChild(el); }
          }
          document.getElementById('portalParty').value = 'PODE';
          showPortalStatus = () => {}; showPortalLoading = () => {};
          drawPieCanvas = () => {};            // sem canvas no linkedom
          fetch = async (url) => {
            if (/\\/deputados\\?siglaPartido/.test(String(url))) {
              return { ok: true, status: 200, json: async () => ({ dados: [
                { id: 1, nome: 'Ana Paula',      siglaPartido: 'PODE', siglaUf: 'SP' },
                { id: 2, nome: 'Ana Paula Lima', siglaPartido: 'PODE', siglaUf: 'MG' },
                { id: 3, nome: 'Ana Paula Lima', siglaPartido: 'PODE', siglaUf: 'SP' }
              ] }) };
            }
            return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
          };`);
    ok(V.av(`document.getElementById('portalParty').value`) === 'PODE', 'preparação: partido informado na tela');
    await V.av('processPortalDoc(__doc, 0)');
    const html = V.av(`document.getElementById('portalResultsArea') ? document.getElementById('portalResultsArea').innerHTML : ''`);
    ok(/Ana Paula Lima/.test(html), 'o deputado cujo nome começa com o de outro entra no placar como ausente');
    const ocorrencias = (html.match(/Ana Paula Lima/g) || []).length;
    ok(ocorrencias >= 2, `os dois homônimos parciais de UFs diferentes aparecem (${ocorrencias} ocorrência(s))`);
    ok(!/Ana Paula<\/div>\s*<div class="deputy-name">Ana Paula</.test(html), 'e quem já estava na página não é duplicado');
  }

  console.log('\n== contagem que o portal não traz não é apresentada como zero ==');
  {
    // mesmo cenário do bloco anterior (que chega até a renderização), mas o
    // portal deixou de trazer duas contagens
    const doc = new DOMParser().parseFromString(htmlPortal(
      [{ nome: 'Ana Paula', partido: 'PODE', uf: 'SP' }],
      { sim: 'omitir', nao: 'omitir' },
    ), 'text/html');
    V.ctx.__doc2 = doc;
    V.av(`__status = null; showPortalStatus = (m, e) => { __status = [String(m), e]; };`);
    await V.av('processPortalDoc(__doc2)');
    const html = V.av(`document.getElementById('portalResultsArea').innerHTML`);

    ok(/não lida/i.test(html), 'a tela avisa que houve contagem não lida no HTML do portal');
    ok(/2 contagem/.test(html), `e diz quantas foram (${/(\d+) contagem/.exec(html)?.[1]})`);
  }

  // ── CCJC ────────────────────────────────────────────────────────────────
  console.log('\n== argumentos sem separação não são rotulados como favoráveis ==');
  const C = carregarPagina('ccjc.html');
  {
    const comCabecalho = C.av(`splitArgumentos("ARGUMENTOS FAVORÁVEIS\\nmelhora o acesso\\nARGUMENTOS CONTRÁRIOS\\ncusta caro")`);
    ok(/melhora o acesso/.test(comCabecalho[0]) && /custa caro/.test(comCabecalho[1]) && !comCabecalho[2],
      'com os títulos, a separação continua igual');
    const sem = C.av(`splitArgumentos("A favor: amplia o direito. Contra: cria despesa sem fonte.")`);
    ok(sem[0] === '' && sem[1] === '' && /cria despesa sem fonte/.test(sem[2]),
      'sem os títulos, nada é dado como favorável e o texto inteiro fica no campo sem rótulo');
  }

  console.log('\n== conferência de referências não realizada aparece na tela ==');
  {
    C.av(`if (!document.getElementById('revisao-conteudo')) { const d = document.createElement('div'); d.id = 'revisao-conteudo'; document.body.appendChild(d); }
          app.config = app.config || {};
          app.projetoAtivo = { chave: 'PL 1/2026', sigla: 'PL', numero: '1', ano: '2026', titulo: 'x', ementa: 'y',
            comissoes: [], refsSuspeitas: [], refsConferidas: false,
            refsMotivo: 'não foi possível ler o documento-fonte (HTTP 502)' };
          renderizarRevisao();`);
    const html = C.av(`document.getElementById('revisao-conteudo').innerHTML`);
    ok(/N[ÃA]O realizada/i.test(html) && /502/.test(html),
      'o card diz que a conferência não foi feita e por quê');
    C.av(`app.projetoAtivo.refsConferidas = true; app.projetoAtivo.refsMotivo = ''; renderizarRevisao();`);
    ok(!/N[ÃA]O realizada/i.test(C.av(`document.getElementById('revisao-conteudo').innerHTML`)),
      'e some quando a conferência foi feita');
  }

  console.log('\n== salvar pauta: cada destino é relatado por si ==');
  {
    C.av(`__toasts = []; mostrarToast = (m, t) => __toasts.push([m, t]);
          carregarHistorico = () => {};
          app.pautaAtual = { id: 'p1', projetos: [] };
          document.body.innerHTML += '<button id="btn-salvar-pauta"></button>';`);
    // local falha, Firebase funciona
    C.av(`localSalvar = async () => { throw new Error('QuotaExceeded'); }; fbSalvarPauta = async () => true;`);
    await C.av('salvarPauta()');
    ok(C.av('__toasts').some(([m]) => /Firebase/i.test(m) && /local/i.test(m) && /falhou/i.test(m)),
      `falhando só o local, o aviso diz isso e o Firebase foi tentado (${JSON.stringify(C.av('__toasts').slice(-1))})`);
    // os dois falham
    C.av(`__toasts = []; fbSalvarPauta = async () => { throw new Error('HTTP 500'); };`);
    await C.av('salvarPauta()');
    ok(C.av('__toasts').some(([m, t]) => /NÃO foi possível salvar/i.test(m) && t === 'erro'),
      'falhando os dois, o analista é avisado de que nada foi salvo');
  }

  // ── Gestão de comissões ─────────────────────────────────────────────────
  console.log('\n== designar não apaga o trabalho de outro analista ==');
  const G = carregarPagina('comissoes.html');
  {
    G.av(`__remoto = { CCJC: { titulares: ['dep_outro'], suplentes: [] } };
          __gravados = [];
          fbGet = async p => JSON.parse(JSON.stringify(__remoto[p.split('/').pop()] || null));
          fbPut = async (p, d) => { __gravados.push([p, JSON.parse(JSON.stringify(d))]); __remoto[p.split('/').pop()] = JSON.parse(JSON.stringify(d)); return d; };
          // a tela foi carregada ANTES de o colega designar dep_outro
          state.membros = { CCJC: { titulares: [], suplentes: [] } };
          state.deputados = { dep_novo: { nome: 'Fulana', partido: 'PODE' } };
          state.vagas = { CCJC: { titulares: 5, suplentes: 5 } };
          vagasDisponiveis = () => 3; vagasEfetivas = () => 5; comissaoConflitante = () => null;
          mostrarToast = () => {};`);
    await G.av(`adicionarMembro('CCJC', 'dep_novo', 'titular', false)`);
    const remoto = G.av('__remoto.CCJC.titulares');
    ok(remoto.includes('dep_outro') && remoto.includes('dep_novo'),
      `a designação do colega sobrevive à minha (${JSON.stringify(remoto)})`);
    ok(G.av('state.membros.CCJC.titulares').includes('dep_outro'),
      'e a tela passa a mostrar os dois, não só o meu');
  }

  console.log('\n== falha na gravação não deixa a tela mentindo ==');
  {
    G.av(`__remoto = { CFT: { titulares: [], suplentes: [] } };
          state.membros = { CFT: { titulares: [], suplentes: [] } };
          fbPut = async () => { throw new Error('Firebase PUT 503'); };`);
    let erro = null;
    try { await G.av(`adicionarMembro('CFT', 'dep_novo', 'titular', false)`); } catch (e) { erro = e; }
    ok(!!erro, 'a falha de gravação chega a quem chamou');
    ok(!G.av('state.membros.CFT.titulares').includes('dep_novo'),
      'e o deputado NÃO fica na tela como se estivesse designado');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
