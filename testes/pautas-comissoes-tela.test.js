// Pautas de Comissões — a TELA, no escopo da página (vm + linkedom), com a
// API da Câmara e o Firebase falsos: a página carrega, as abas aparecem (Semana
// + 30 comissões), a semana lista as reuniões, o calendário de uma comissão
// renderiza, a importação monta os cards e a análise de um item passa pela
// fila até a nota na tela e no Firebase.
// Uso: node testes/pautas-comissoes-tela.test.js
const path = require('path'), fs = require('fs'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML, DOMParser } = require(path.join(RAIZ, 'bot/node_modules/linkedom'));
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/comissoes', n), 'utf8'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const scriptsDe = html => [...fs.readFileSync(path.join(RAIZ, html), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

(async () => {
  console.log('== a página e o manifesto ==');
  const scripts = scriptsDe('pautas-comissoes.html');
  ok(scripts.indexOf('ia-comum.js') < scripts.indexOf('pautas-comissoes-core.js') && scripts.indexOf('pautas-comissoes-core.js') < scripts.indexOf('pautas-comissoes.js'), 'ia-comum.js e o núcleo vêm antes da tela');
  const scriptsAn = scriptsDe('analise.html');
  ok(scriptsAn.indexOf('ia-comum.js') >= 0 && scriptsAn.indexOf('ia-comum.js') < scriptsAn.indexOf('analise.js'), 'analise.html também carrega ia-comum.js antes do analise.js');
  const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  const recursos = manifest.web_accessible_resources.flatMap(w => w.resources);
  ok(['pautas-comissoes.html', 'pautas-comissoes.js', 'pautas-comissoes-core.js', 'ia-comum.js', 'analise.css'].every(r => recursos.includes(r)), 'os arquivos novos estão no manifesto');
  const an = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
  ok(!/^async function chamarIA\(/m.test(an) && !/^function renderMarkdown\(/m.test(an) && /^async function chamarIA\(/m.test(fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8')), 'chamarIA e renderMarkdown saíram do analise.js para o ia-comum.js (uma cópia só)');
  ok(/<link rel="stylesheet" href="analise.css">/.test(fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8')) && !/<style>/.test(fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8')) && /\.an-card \{/.test(fs.readFileSync(path.join(RAIZ, 'analise.css'), 'utf8')), 'o CSS dos cards vive em analise.css, ligado pelas duas páginas');
  const panel = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8'), panelJs = fs.readFileSync(path.join(RAIZ, 'panel.js'), 'utf8');
  ok(/id="modal-comissoes"/.test(panel) && /id="btn-sub-gestao"/.test(panel) && /id="btn-sub-pautas-comissoes"/.test(panel) && /abrirSubpainelComissoes\('pautas-comissoes\.html'\)/.test(panelJs) && /titulo: 'Comissões'/.test(panelJs), 'o início tem o modal Gestão / Pautas de Comissões');
  ok(/Gestão de Comissões/.test(fs.readFileSync(path.join(RAIZ, 'comissoes.html'), 'utf8')) && /btn-pautas-comissoes/.test(fs.readFileSync(path.join(RAIZ, 'comissoes.js'), 'utf8')), 'o Controle de Comissões virou Gestão e aponta para as Pautas');

  console.log('\n== a página carrega no escopo do navegador ==');
  const { document, window } = parseHTML(fs.readFileSync(path.join(RAIZ, 'pautas-comissoes.html'), 'utf8'));
  // linkedom: select.value é só getter; a tela atribui.
  const armazem = {};
  const fb = {};   // Firebase falso: caminho → valor
  const camara = {
    '/orgaos?codTipoOrgao=2': fx('orgaos-permanentes.json'),
    '/eventos?dataInicio=2026-09-07&dataFim=2026-09-11': { dados: fx('eventos-2026-09-01a03.json').dados.map(e => ({ ...e, dataHoraInicio: e.dataHoraInicio.replace('2026-09-0', '2026-09-0').replace(/2026-09-0([123])/, (m, d) => `2026-09-0${+d + 7}`) })), links: [] },
    '/orgaos/2003/eventos?dataInicio=2026-09-01': { dados: fx('eventos-2026-09-01a03.json').dados.filter(e => (e.orgaos || []).some(o => o.id === 2003)) },
    '/eventos/82841/pauta': fx('pauta-ccjc-82841.json'),
    '/deputados?siglaPartido=PODE': { dados: [{ id: 178873, nome: 'Helder Salomão' }] },   // finge que é do Podemos, para a badge
    '/proposicoes/2643817': { dados: { id: 2643817, urlInteiroTeor: 'https://www.camara.leg.br/prl1.pdf' } },
    '/proposicoes/2551091': { dados: { id: 2551091, urlInteiroTeor: 'https://www.camara.leg.br/pl4159.pdf' } },
  };
  const chamadas = [];
  const ctx = {
    document, window, DOMParser, console: { log: () => {}, warn: () => {}, error: e => console.error('  [erro na página]', e && e.message || e), debug: () => {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, setImmediate,
    URL, TextDecoder, TextEncoder, AbortController, DOMException, Event, Buffer, Node: window.Node,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'), confirm: () => true, alert: () => {}, history: { length: 1 },
    navigator: { clipboard: { writeText: async t => { ctx.__copiado = t; } } },
    chrome: { storage: { local: { get: (k, cb) => cb(Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in armazem).map(x => [x, armazem[x]]))), set: (o, cb) => { Object.assign(armazem, o); cb && cb(); }, remove: (k, cb) => { delete armazem[k]; cb && cb(); } } }, runtime: { getURL: p => p, getManifest: () => ({ version: '0' }) }, tabs: { create: () => {} } },
    fetch: async (url, init = {}) => {
      chamadas.push({ url, method: init.method || 'GET' });
      const j = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(8), blob: async () => null });
      if (url.includes('firebaseio.com')) {
        const cam = url.replace(/^.*pautas-comissoes\//, '').replace(/\.json.*$/, '');
        if (init.method === 'PUT') { fb[cam] = JSON.parse(init.body); return j({}); }
        if (init.method === 'PATCH') { fb[cam] = { ...(fb[cam] || {}), ...JSON.parse(init.body) }; return j({}); }
        // GET: monta a subárvore
        const sub = {}; let direto = null;
        for (const [k, v] of Object.entries(fb)) { if (k === cam) direto = v; else if (k.startsWith(cam + '/')) { const resto = k.slice(cam.length + 1).split('/'); let o = sub; for (let i = 0; i < resto.length - 1; i++) o = (o[resto[i]] = o[resto[i]] || {}); o[resto[resto.length - 1]] = v; } }
        return j(direto != null ? direto : (Object.keys(sub).length ? sub : null));
      }
      if (url.includes('camara.leg.br') && url.endsWith('.pdf')) return j('pdf');
      const chave = Object.keys(camara).find(k => url.includes(k));
      if (chave) return j(camara[chave]);
      return j({ dados: [] });
    },
  };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  const fonte = scripts.filter(s => !s.startsWith('libs/')).map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n');
  let erro = null;
  try { new vm.Script(fonte, { filename: 'pagina-pautas-comissoes.js' }).runInContext(ctx); } catch (e) { erro = e; }
  ok(!erro, erro ? `falhou ao avaliar: ${erro.message}` : 'ia-comum.js, o núcleo e a tela avaliam no mesmo escopo, sem colisão de nomes');
  const av = expr => vm.runInContext(expr, ctx);
  const usados = ['chamarIA', 'baixarPdf', 'renderMarkdown', 'sanitizarNotaHtml', 'escapeHtml', 'formatDataHora', 'mostrarToast', 'carregarLogoDataUrl', 'CSS_IMPRESSAO_PLENARIO', 'PROVEDORES_META', 'resetAbortAll', 'iaInFlightInc', 'isAbortError',
    'COMISSOES_PERMANENTES', 'itensDaPauta', 'eventosDeliberativos', 'promptComissao', 'criarFila', 'semanaDe', 'htmlImpressaoReuniao', 'textoPropPartido', 'gerarAnaliseItem', 'importarReuniao', 'renderAbas', 'renderCalendario', 'abrirConfigPC', 'pc'];
  const faltando = usados.filter(n => av(`typeof ${n}`) === 'undefined');
  ok(!faltando.length, faltando.length ? `faltam no escopo: ${faltando.join(', ')}` : `os ${usados.length} símbolos que a tela usa estão definidos`);
  ok(!/\(0, eval\)|\beval\(/.test(fonte.replace(/\/\/[^\n]*/g, '')), 'nenhum eval (a CSP da extensão o proíbe)');

  console.log('\n== boot: abas e semana ==');
  armazem.config = { provedor: 'gemini', apiKey: 'AIzaSyTESTE1234567890abcdefghij', modelo: 'gemini-3.8-flash', nomeUsuario: 'Ana', comissoes: { paralelas: 2, intervaloS: 0 } };
  // a semana em teste é a de 07 a 11/09/2026 (os eventos da fixture foram deslocados 7 dias)
  const DataReal = ctx.Date || Date;
  av(`Date = class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-09-08T12:00:00Z'])); } static now() { return new Date('2026-09-08T12:00:00Z').getTime(); } }`);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 80));
  const abas = [...document.querySelectorAll('.pc-aba')];
  ok(abas.length === 31 && abas[0].dataset.aba === 'semana' && abas.slice(1).map(a => a.dataset.aba).join(',') === fx('orgaos-permanentes.json').dados.map(o => o.sigla).sort().join(','), `31 abas: Semana + as 30 permanentes da API, em ordem (${abas.length})`);
  ok(av(`pc.aba`) === 'semana' && /Semana de 7 a 11 de setembro de 2026/.test(document.getElementById('pc-main').textContent), 'abre na Semana corrente');
  const linhas = [...document.querySelectorAll('#pc-main .pc-reu')];
  ok(linhas.length === 18 && linhas.every(l => l.querySelector('[data-importar], [data-abrir]') || l.classList.contains('cancelada')), `a semana lista as 18 reuniões deliberativas, cada uma com "Importar pauta" (${linhas.length})`);
  const abaCCJC = abas.find(a => a.dataset.aba === 'CCJC');
  ok(abaCCJC && abaCCJC.querySelector('.n').textContent === '2' && abas.find(a => a.dataset.aba === 'CTUR').querySelector('.n').classList.contains('zero'), 'o número da aba é quantas reuniões a comissão tem na semana (CCJC 2; CTUR 0)');
  ok(/Gerar todas as pautas da semana/.test(document.getElementById('pc-lat').textContent), 'a lateral da semana oferece gerar todas as pautas');

  console.log('\n== aba de uma comissão: calendário ==');
  abaCCJC.click();
  await new Promise(r => setTimeout(r, 60));
  ok(av(`pc.aba`) === 'CCJC' && /Calendário — Comissão de Constituição e Justiça e de Cidadania/.test(document.getElementById('pc-main').textContent), 'a aba abre no calendário da comissão');
  ok(document.querySelectorAll('.cal-dia.tem-reuniao').length >= 1 && document.querySelector('.cal-dia[data-dia="2026-09-01"]').classList.contains('tem-reuniao'), 'a grade marca o dia da reunião (01/09)');
  ok(/Nenhuma pauta salva desta comissão/.test(document.getElementById('pc-lat').textContent), 'lateral: sem pautas salvas ainda');
  document.querySelector('.cal-dia[data-dia="2026-09-01"]').click();
  await new Promise(r => setTimeout(r, 30));
  ok(/2 reuniões neste dia/.test(document.getElementById('cal-card').textContent) && document.querySelector('#cal-card [data-ev="82841"]'), 'dia com duas reuniões: o card pede para escolher');
  document.querySelector('#cal-card [data-ev="82841"]').click();
  await new Promise(r => setTimeout(r, 60));
  ok(/01\/09\/2026 · 16:18/.test(document.getElementById('cal-card').textContent) && /Item 1/.test(document.getElementById('cal-card').textContent) && /PL 4159\/2025/.test(document.getElementById('cal-card').textContent) && /e mais 16 itens/.test(document.getElementById('cal-card').textContent), 'o card da reunião traz a prévia da pauta lida da API');

  console.log('\n== importar a pauta e analisar um item ==');
  document.getElementById('cal-importar').click();
  await new Promise(r => setTimeout(r, 120));
  ok(av(`pc.reuniao && pc.reuniao.chave`) === '2003_82841' && av(`pc.reuniao.itens.length`) === 21, 'a reunião importada tem 21 itens');
  ok(fb['reunioes/2003_82841'] && fb['reunioes/2003_82841'].itens.length === 21 && fb['indice/2003/82841'] && fb['indice/2003/82841'].nItens === 21 && fb['indice/2003/82841'].nAnalisados === 0, 'salva no Firebase em pautas-comissoes/reunioes e no índice da comissão');
  const cards = [...document.querySelectorAll('#pc-lista .an-card')];
  ok(cards.length === 21 && /PL 4159\/2025/.test(cards[0].textContent) && /Helder Salomão/.test(cards[0].textContent) && /pela constitucionalidade/.test(cards[0].textContent), '21 cards, com relator e parecer da pauta');
  ok(/Relatoria Podemos/.test(cards[0].querySelector('[data-role=badges]').textContent) === false, 'sem badge de relatoria: o relator do item 1 é do PT');
  ok(/Reunião de 01\/09\/2026/.test(document.getElementById('pc-lat').textContent), 'a pauta salva aparece na lateral');
  // modelo falso: devolve a nota
  av(`chamarIA = async ({ prompt, pdfBuffers }) => { __prompt = prompt; __pdfs = (pdfBuffers || []).length; return { text: '## Objetivo\\n\\nInscreve o nome no Livro dos Heróis [nota de teste].\\n\\n## O que a comissão vota\\n\\nO parecer do relator conclui pela constitucionalidade.', truncated: false }; }`);
  cards[0].querySelector('[data-role=btn-gerar]').click();
  await new Promise(r => setTimeout(r, 150));
  ok(av(`__pdfs`) === 2 && /Documento 1 — PRL 1 — parecer do\(a\) relator\(a\) Helder Salomão/.test(av('__prompt')) && /## Admissibilidade/.test(av('__prompt')), 'a análise baixa os dois PDFs e manda o prompt de comissão (CCJC: admissibilidade)');
  ok(/Inscreve o nome no Livro dos Heróis/.test(cards[0].querySelector('[data-role=analise-conteudo]').innerHTML) && cards[0].querySelector('[data-role=painel-analise]').style.display !== 'none', 'a nota aparece no card');
  ok(fb['analises/2003_82841/PL-4159-2025'] && /Livro dos Heróis/.test(fb['analises/2003_82841/PL-4159-2025'].markdown) && fb['indice/2003/82841'].nAnalisados === 1, 'a nota vai a pautas-comissoes/analises e o índice conta 1 analisado');
  ok(/PRL 1 — parecer/.test(cards[0].querySelector('[data-role=analise-meta]').textContent) && /Google Gemini gemini-3\.8-flash/.test(cards[0].querySelector('[data-role=analise-meta]').textContent) && /por Ana/.test(cards[0].querySelector('[data-role=analise-meta]').textContent), 'a linha de meta diz o documento analisado, o modelo e quem gerou — sem cenário');
  // reabrir a pauta salva traz a nota de volta
  av(`pc.reuniao = null`);
  document.querySelector('[data-salva="82841"]').click();
  await new Promise(r => setTimeout(r, 100));
  ok(av(`pc.reuniao.itens[0].analise && /Livro/.test(pc.reuniao.itens[0].analise.markdown)`) === true, 'abrir a pauta salva recompõe a nota a partir do Firebase');

  console.log('\n== saídas e configuração ==');
  document.getElementById('pc-wa-resumo').click();
  await new Promise(r => setTimeout(r, 20));
  ok(/\*CCJC — Reunião Deliberativa de 01\/09\/2026, 16:18\*/.test(ctx.__copiado) && /21 item\(ns\)/.test(ctx.__copiado), 'Resumo da reunião vai à área de transferência');
  // linkedom: <select>.value só tem getter; shim fiel ao navegador (mesmo do teste do Plenário)
  av(`(() => { const proto = Object.getPrototypeOf(document.createElement('select'));
    Object.defineProperty(proto, 'value', { configurable: true,
      get() { const o = this.querySelector('option[selected]') || this.querySelector('option:not([disabled])') || this.querySelector('option'); return o ? o.value : ''; },
      set(v) { for (const o of this.querySelectorAll('option')) o.selected = (o.value === String(v)); } }); })()`);
  av(`abrirConfigPC()`);
  await new Promise(r => setTimeout(r, 30));
  ok(document.getElementById('modal-configuracoes').style.display === 'flex' && document.getElementById('config-paralelas').value === '2' && document.getElementById('config-intervalo').value === '0' && /Chave de API/.test(document.getElementById('modal-configuracoes').textContent), 'configurações: limites da fila e a mesma chave do Plenário');
  ok(av(`pc.fila.paralelas`) === 2, 'a fila nasce com os limites da configuração');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
