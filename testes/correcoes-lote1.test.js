// Correções do lote 1 da varredura (14/09/2026) — Reunião de Líderes e
// Congresso. Cada teste reproduz o cenário que produzia informação errada ou
// perda de trabalho da equipe, no escopo real da página (scripts clássicos num
// único escopo global), com fetch e provedor falsos.
//
// Uso: node testes/correcoes-lote1.test.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML, DOMParser } = require(path.join(RAIZ, 'bot/node_modules/linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Carrega uma página da extensão (os scripts próprios, não as libs) num contexto vm. */
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
    pdfjsLib: { GlobalWorkerOptions: {} }, docx: {}, XLSX: { read: () => ({ SheetNames: [], Sheets: {} }), utils: {} },
    alert: () => {}, confirm: () => true, prompt: () => null,
    ...extras,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const fonte = scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n');
  new vm.Script(fonte, { filename: html.replace('.html', '-pagina.js') }).runInContext(ctx);
  return { ctx, av: expr => vm.runInContext(expr, ctx) };
}

(async () => {
  // ── Reunião de Líderes ──────────────────────────────────────────────────
  console.log('== falha na consulta de tramitação não vira fato ==');
  const L = carregarPagina('lideres.html');
  {
    // fetch programável por rota
    L.ctx.__rotas = [];
    L.av(`fetch = async (url) => {
      for (const r of __rotas) if (r.re.test(String(url))) return r.resp();
      return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
    };`);
    const rota = (re, resp) => { L.ctx.__rotas.push({ re, resp }); };
    const json = obj => () => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

    // 1. a consulta falha → null (e não lista vazia, que significaria "não há requerimento")
    rota(/\/tramitacoes/, () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }));
    ok(await L.av('buscarTramitacoes(123)') === null, 'API fora do ar devolve null, não lista vazia');
    L.ctx.__rotas.length = 0;
    rota(/\/tramitacoes/, json({ dados: [] }));
    const vazio = await L.av('buscarTramitacoes(123)');
    ok(Array.isArray(vazio) && vazio.length === 0, 'proposição realmente sem tramitação continua devolvendo lista vazia');
    ok(await L.av('buscarTramitacoes(undefined)') === null, 'sem identificador, nem chega a consultar');

    // 2. a situação "não há requerimento" é o que a lista vazia produz — a razão do defeito
    ok(/Não há requerimento/i.test(L.av('situacaoDe([], "")')), 'contexto: lista vazia significa "não há requerimento de urgência"');

    // 3. atualizar demanda com a API fora do ar: não grava, não mente
    L.ctx.__rotas.length = 0;
    rota(/\/tramitacoes/, () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '' }));
    L.av(`__gravou = 0; fbDemandaSalvar = async () => { __gravou++; };
          __toasts = []; mostrarToast = (m, t) => __toasts.push([m, t]);
          renderizarDemandas = () => {};
          __d = { id: 'd1', chave: 'PL 1/2026', idCamara: 111, situacao: 'Urgência aprovada (REQ. 123/2026)' };`);
    let erro = null;
    try { await L.av('atualizarSituacaoDemanda(__d)'); } catch (e) { erro = e; }
    ok(!!erro && /falhou/i.test(erro.message), `a atualização falha declarando a causa (${erro ? erro.message.slice(0, 60) : 'NÃO LANÇOU'})`);
    ok(L.av('__d.situacao') === 'Urgência aprovada (REQ. 123/2026)', 'a urgência aprovada permanece no registro');
    ok(L.av('__gravou') === 0, 'e nada é gravado no Firebase compartilhado');

    // 4. com a API respondendo, a mudança real é registrada
    L.ctx.__rotas.length = 0;
    rota(/\/tramitacoes/, json({ dados: [{ descricaoTramitacao: 'Aprovação de Urgência', despacho: 'Aprovado o Requerimento n. 999/2026 de urgência' }] }));
    L.av(`__d2 = { id: 'd2', chave: 'PL 2/2026', idCamara: 222, situacao: 'Não há requerimento de urgência apresentado.' }`);
    const mudou = await L.av('atualizarSituacaoDemanda(__d2, { silencioso: true })');
    ok(mudou === true && /999\/2026/.test(L.av('__d2.situacao')), `mudança real continua sendo apurada e gravada (${L.av('__d2.situacao')})`);
    ok(L.av('__gravou') === 1, 'e aí sim grava no Firebase');
  }

  console.log('\n== e-mail avisa quando não conseguiu conferir a situação ==');
  {
    L.av(`__toasts = [];
          demandasSelecionadas = () => [{ id: 'a', chave: 'PL 1/2026' }, { id: 'b', chave: 'PL 2/2026' }];
          atualizarSituacaoDemanda = async d => { throw new Error(d.chave + ': a consulta de tramitação na Câmara falhou'); };
          renderizarEmail = () => {}; montarEmailDemandas = () => 'texto do e-mail';
          liderDoPodemos = async () => ({ assinatura: 'Deputado Fulano' });`);
    const r = await L.av('prepararEmailFinal()');
    ok(Array.isArray(r.avisos) && r.avisos.some(a => /N[ÃA]O pôde/i.test(a) && /2/.test(a)),
      `o aviso diz quantas situações não foram conferidas (avisos: ${JSON.stringify(r.avisos)})`);
    ok(/texto do e-mail/.test(r.texto), 'e o e-mail continua sendo montado, com a situação do registro');
  }

  console.log('\n== o selo "principal" fica só na proposição dentro do parêntese ==');
  {
    const casos = [
      ['(Principal: PL 23/2026) PL 1242/2026', { 'PL 23/2026': true, 'PL 1242/2026': false }],
      ['PL 1242/2026 (Principal: PL 23/2026)', { 'PL 23/2026': true, 'PL 1242/2026': false }],
      ['PL 9/2026 (Principal: PL 1/2020) PL 7/2021', { 'PL 1/2020': true, 'PL 9/2026': false, 'PL 7/2021': false }],
      ['PL 500/2025', { 'PL 500/2025': false }],
    ];
    for (const [prop, esperado] of casos) {
      L.ctx.__item = { prop };
      const achados = L.av('proposicoesDoItem(__item)');
      const mapa = Object.fromEntries(achados.map(a => [a.chave, a.ehPrincipal]));
      const bate = Object.entries(esperado).every(([k, v]) => mapa[k] === v);
      ok(bate, `"${prop}" → ${achados.map(a => a.chave + (a.ehPrincipal ? ' [principal]' : '')).join(' | ')}`);
    }
  }

  // ── Congresso ───────────────────────────────────────────────────────────
  console.log('\n== parar no meio das razões não apaga as razões completas ==');
  const C = carregarPagina('congresso.html');
  {
    C.av(`__toasts = []; mostrarToast = (m, t) => __toasts.push([m, t]);
          __persistidos = []; persistirResumo = async v => { __persistidos.push(JSON.parse(JSON.stringify(v.razoesGrupos || []))); return true; };
          garantirRazoesTexto = async () => true;
          renderLista = () => {}; iaInc = () => {}; iaDec = () => {};
          app.config = { apiKey: 'k', provedor: 'gemini', modelo: 'm' };
          app.editando = false;
          // cada chamada devolve um grupo; o abort é ligado depois da primeira
          __chamadas = 0;
          chamarIAtexto = async () => { __chamadas++; _abort.abort(); return JSON.stringify([{ codigos: ['01.001.001'], resumo: 'razão parcial ' + __chamadas }]); };
          __veto = { key: 'v1', numero: 12, tipo: 'Parcial', detalheCarregado: true, razoesPdfUrl: 'http://x/r.pdf',
                     dispositivos: Array.from({ length: 45 }, (_, i) => ({ codigo: '01.001.' + String(i).padStart(3, '0') })),
                     razoesGrupos: [{ codigos: ['01.001.001'], resumo: 'razão completa e antiga' }] };`);
    const r = await C.av('resumirRazoes(__veto, { force: true })');
    const grupos = C.av('__veto.razoesGrupos');
    ok(r === false, 'a operação interrompida não se declara concluída');
    ok(grupos.length === 1 && /completa e antiga/.test(grupos[0].resumo), `as razões anteriores permanecem (${JSON.stringify(grupos).slice(0, 80)})`);
    ok(C.av('__persistidos').length === 0, 'e nada parcial é gravado por cima no Firebase');
    ok(C.av('__toasts').some(([m]) => /mantidas/i.test(m)), 'o analista é avisado de que as anteriores foram mantidas');

    // sem razões anteriores, o parcial é aproveitado e marcado
    C.av(`_abort = new AbortController(); __chamadas = 0;
          __veto2 = { ...__veto, key: 'v2', razoesGrupos: undefined };`);
    const r2 = await C.av('resumirRazoes(__veto2, { force: true, silencioso: true })');
    ok(C.av('__veto2.razoesGrupos') && C.av('__veto2.razoesGrupos').length === 1 && C.av('__veto2.razoesParciais') === true,
      `sem nada gravado antes, o parcial entra marcado como parcial (r=${r2})`);
  }

  console.log('\n== apagar pauta espera o índice, e avisa se ele sobreviver ==');
  {
    C.av(`__toasts = []; mostrarToast = (m, t) => __toasts.push([m, t]);
          __apagados = [];
          fetch = async (url) => {                     // o espelho de índice falha; a pauta apaga normalmente
            __apagados.push(String(url));
            const ehIndice = /meta/i.test(String(url));
            return { ok: !ehIndice, status: ehIndice ? 500 : 200, json: async () => ({}), text: async () => '' };
          };`);
    let erro = null;
    try { await C.av('fbApagarPauta("p1")'); } catch (e) { erro = e; }
    const urls = C.av('__apagados');
    ok(!erro, 'apagar a pauta não quebra quando o índice falha');
    ok(urls.length === 2, `as duas exclusões são disparadas (${urls.length})`);
    ok(C.av('__toasts').some(([m]) => /índice/i.test(m) && /reaparecer/i.test(m)),
      'e o analista é avisado de que a pauta pode reaparecer vazia na lista');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
