// Parecer de Especialista v3 — a página do Plenário carrega os módulos no
// mesmo escopo, e o pipeline roda DENTRO desse escopo (modo navegador: sem
// require, sem eval, referências pelo identificador) com um modelo falso.
//
// O que trava:
//   1. analise.html carrega os sete arquivos ANTES do analise.js;
//   2. todos avaliam num único escopo sem colisão de nomes;
//   3. cada símbolo que o handler da tela usa está definido;
//   4. gerarParecer roda no escopo da página (é aqui que `const` de script
//      clássico não estar em globalThis quebraria) e htmlParecer imprime.
//
// Uso: node testes/parecer-tela.test.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML, DOMParser } = require(path.join(RAIZ, 'bot/node_modules/linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const scriptsDaPagina = () => [...fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));

(async () => {
  console.log('== a página carrega inteira ==');
  const scripts = scriptsDaPagina();
  const novos = ['especialistas.js', 'dossie.js', 'ficha.js', 'tese.js', 'gates.js', 'parecer.js', 'pipeline-parecer.js', 'parecer-html.js'];
  ok(novos.every(s => scripts.includes(s)), `os oito arquivos do parecer estão no analise.html (faltam: ${novos.filter(s => !scripts.includes(s)).join(', ') || 'nenhum'})`);
  ok(novos.every(s => scripts.indexOf(s) < scripts.indexOf('analise.js')), 'e vêm ANTES do analise.js, que os consome');

  const { document, window } = parseHTML(fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8'));
  const ctx = {
    document, window, DOMParser, console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    URL, TextDecoder, AbortController, DOMException, Event, Buffer,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => p, getManifest: () => ({ version: '0' }) }, tabs: { create: () => {} } },
    pdfjsLib: { GlobalWorkerOptions: {} }, Quill: function () {}, docx: {}, html2canvas: () => {}, XLSX: { read: () => ({ SheetNames: [], Sheets: {} }), utils: { sheet_to_json: () => [] } },
    alert: () => {}, confirm: () => false, prompt: () => null,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const fonte = scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n');
  let erro = null;
  try { new vm.Script(fonte, { filename: 'pagina-analise.js' }).runInContext(ctx); } catch (e) { erro = e; }
  ok(!erro, erro ? `falhou ao avaliar: ${erro.message}` : 'os arquivos avaliam no mesmo escopo, sem colisão de nomes');
  const av = expr => vm.runInContext(expr, ctx);

  console.log('\n== todo símbolo que a tela usa está definido ==');
  const usados = ['ESPECIALISTAS', 'sugerirEspecialistas', 'ressalvasDeValidade', 'montarDossie', 'resumoDoDossie', 'tabelasDoDossie', 'montarFicha', 'fichaParaHtml',
    'catalogoDeEvidencias', 'validarTese', 'aplicarContraditorio', 'conferirRedacao', 'aplicarGates', 'rubricaMaquina', 'escolherModelo', 'promptApuracao', 'carimboDoParecer',
    'gerarParecer', 'htmlParecer', 'chamarIA', 'escolherDocumentos', 'baixarPdf', 'extrairTextoPdf', 'PROVEDORES_META', 'tituloComApelido', 'iaInFlightInc', 'iaInFlightDec',
    'isAbortError', 'mostrarToast', 'API_BASE', 'FIREBASE_URL', 'state', 'CSS_IMPRESSAO_PLENARIO', 'gerarParecerEspecialista', 'abrirParecerEspecialista', 'temasDaProposicao', 'situacaoDaProposicao', 'PARECER_PATH', 'chaveParecer', 'atualizarBotaoParecer', 'abrirParecerSalvo', 'fbCarregarParecer'];
  const faltando = usados.filter(n => av(`typeof ${n}`) === 'undefined');
  ok(!faltando.length, faltando.length ? `faltam no escopo: ${faltando.join(', ')}` : `os ${usados.length} símbolos usados pela tela estão definidos`);
  ok(!/\(0, eval\)|\beval\(/.test(fonte.replace(/\/\/[^\n]*/g, '')), 'nenhum eval nos scripts (a CSP da extensão o proíbe)');

  console.log('\n== todo host que o parecer consulta está em host_permissions (sem isso o CORS bloqueia) ==');
  {
    const manifesto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    const permitidos = (manifesto.host_permissions || []).map(h => h.replace(/\/\*$/, ''));
    const hosts = new Set();
    for (const f of ['dossie.js', 'ficha.js', 'pipeline-parecer.js', 'parecer.js', 'analise.js']) {
      for (const m of fs.readFileSync(path.join(RAIZ, f), 'utf8').matchAll(/https:\/\/[a-z0-9.-]+\.(?:gov\.br|leg\.br|googleapis\.com|openai\.com|anthropic\.com|firebaseio\.com)/g)) hosts.add(m[0]);
    }
    const semPermissao = [...hosts].filter(h => !permitidos.includes(h));
    ok(!semPermissao.length, semPermissao.length ? `hosts consultados sem permissão no manifesto: ${semPermissao.join(', ')}` : `os ${hosts.size} hosts consultados estão no manifesto`);
    ok(permitidos.includes('https://www.lexml.gov.br') && permitidos.includes('https://legis.senado.leg.br') && permitidos.includes('https://www.planalto.gov.br'), 'a cascata da lei vigente (Planalto → LexML → Senado) tem os três hosts');
  }

  console.log('\n== a chamada do parecer liga o raciocínio alto e 32 mil tokens de saída ==');
  {
    // fetchIA é declaração de função no escopo da página: reatribuível para capturar o corpo enviado.
    av(`var __corpos = [], __urls = [], __viaSse = [];
        fetchIA = async (url, init) => { __corpos.push(JSON.parse(init.body)); __urls.push(url); __viaSse.push(false); return { candidates: [], output: [], content: [] }; };
        fetchIASse = async (url, init) => { __corpos.push(JSON.parse(init.body)); __urls.push(url); __viaSse.push(true); return []; };`);
    await av('chamarIA({ provedorId: "gemini", apiKey: "k", modelo: "gemini-3.8-flash", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    await av('chamarIA({ provedorId: "gemini", apiKey: "k", modelo: "gemini-2.5-pro", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    await av('chamarIA({ provedorId: "anthropic", apiKey: "k", modelo: "claude-opus-5", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    await av('chamarIA({ provedorId: "openai", apiKey: "k", modelo: "gpt-5", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    await av('chamarIA({ provedorId: "gemini", apiKey: "k", modelo: "gemini-3.8-flash", prompt: "p", pdfBuffers: [] })');
    await av('chamarIA({ provedorId: "anthropic", apiKey: "k", modelo: "claude-haiku-4-5-20251001", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    await av('chamarIA({ provedorId: "anthropic", apiKey: "k", modelo: "claude-sonnet-5", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    const c = av('__corpos');
    ok(c[0].generationConfig.maxOutputTokens === 64000 && c[0].generationConfig.thinkingConfig?.thinkingLevel === 'high', 'Gemini 3: maxOutputTokens 64000 (o raciocínio conta no teto) e thinkingLevel high');
    ok(c[1].generationConfig.thinkingConfig?.thinkingBudget === 24576, 'Gemini 2.5: thinkingBudget');
    ok(c[2].max_tokens === 48000 && c[2].thinking?.type === 'adaptive' && c[2].thinking.budget_tokens === undefined && c[2].output_config?.effort === 'high' && c[2].temperature === undefined, 'Anthropic opus-5: thinking adaptive + effort high, sem budget_tokens nem temperature');
    ok(c[5].thinking?.type === 'enabled' && c[5].thinking.budget_tokens === 16000 && c[5].output_config === undefined, 'Anthropic haiku-4.5: ainda budget_tokens, sem output_config');
    ok(c[6].thinking?.type === 'adaptive' && c[6].output_config?.effort === 'high', 'Anthropic sonnet-5: adaptive (o erro "thinking.type.enabled is not supported" não volta)');
    for (const [m, e] of [['claude-sonnet-4-6', true], ['claude-opus-4-1-20250805', false], ['claude-3-7-sonnet-20250219', false], ['claude-fable-5-1', true], ['claude-opus-4-8', true]]) ok(av(`raciocinioAdaptativo(${JSON.stringify(m)})`) === e, `raciocinioAdaptativo(${m}) = ${e}`);
    ok(c[3].max_output_tokens === 64000 && c[3].reasoning?.effort === 'high' && c[3].temperature === undefined, 'OpenAI gpt-5: reasoning high e sem temperature');
    ok(c[4].generationConfig.maxOutputTokens === 12000 && !c[4].generationConfig.thinkingConfig, 'sem opcoes (nota comum): 12000 e sem thinkingConfig — intacta');
    const sse = av('__viaSse'), urls = av('__urls');
    ok(sse[0] && sse[2] && sse[3] && !sse[4] && /:streamGenerateContent\?alt=sse/.test(urls[0]) && c[2].stream === true && c[3].stream === true && c[4].stream === undefined, 'com raciocínio as três APIs vão em streaming (o Chrome derruba a conexão muda); a nota comum não');
    // o parser de SSE e a montagem do texto, com as respostas reais de cada provedor
    const A = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Olá "}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"mundo"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n';
    ctx.__sse = { A, G: 'data: {"candidates":[{"content":{"parts":[{"text":"pensando","thought":true},{"text":"Um "}]}}]}\r\n\r\ndata: {"candidates":[{"content":{"parts":[{"text":"dois"}]},"finishReason":"STOP"}]}\r\n\r\n', O: 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"a"}\n\nevent: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"b"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\ndata: [DONE]\n\n' };
    ok(av('eventosSse(__sse.A)').length === 5 && av('eventosSse(__sse.A)')[1].evento === 'content_block_delta', 'eventosSse: um evento por data:, com o nome do event:');
    av('fetchIASse = async (url) => eventosSse(/anthropic/.test(url) ? __sse.A : /openai/.test(url) ? __sse.O : __sse.G);');
    const rA = await av('chamarIA({ provedorId: "anthropic", apiKey: "k", modelo: "claude-sonnet-5", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    ok(rA.text === 'Olá mundo' && rA.truncated === true, 'Anthropic em streaming: junta só os text_delta (ignora thinking) e lê o stop_reason');
    const rG = await av('chamarIA({ provedorId: "gemini", apiKey: "k", modelo: "gemini-3.8-flash", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    ok(rG.text === 'Um dois' && rG.truncated === false, 'Gemini em streaming: junta os parts sem thought e lê o finishReason');
    const rO = await av('chamarIA({ provedorId: "openai", apiKey: "k", modelo: "gpt-5", prompt: "p", pdfBuffers: [], opcoes: { maxSaida: 32000, pensar: "alto" } })');
    ok(rO.text === 'ab' && rO.truncated === false, 'OpenAI em streaming: junta os output_text.delta e lê o status');
    av('fetchIASse = async () => eventosSse(\'event: error\\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\\n\\n\')');
    let erroA = null; try { await av('chamarIA({ provedorId: "anthropic", apiKey: "k", modelo: "claude-sonnet-5", prompt: "p", pdfBuffers: [], opcoes: { pensar: "alto" } })'); } catch (e) { erroA = e; }
    ok(erroA && /Overloaded/.test(erroA.message), 'evento error do stream vira exceção com a mensagem da API');
  }

  console.log('\n== o diálogo de confirmação pré-seleciona o melhor modelo de cada provedor ==');
  {
    // linkedom: <select>.value só tem getter. O navegador tem setter (seleciona a option de mesmo
    // value) e, sem option marcada, devolve a primeira não desabilitada. Shim fiel a esse comportamento.
    av(`(() => { const proto = Object.getPrototypeOf(document.createElement('select'));
      Object.defineProperty(proto, 'value', { configurable: true,
        get() { const o = this.querySelector('option[selected]') || this.querySelector('option:not([disabled])') || this.querySelector('option'); return o ? o.value : ''; },
        set(v) { for (const o of this.querySelectorAll('option')) o.selected = (o.value === String(v)); } }); })()`);
    av(`state.config = { provedor: 'gemini', apiKey: 'AIzaX', modelo: 'gemini-3.1-flash-lite', chaves: { anthropic: 'sk-ant-x' }, modeloParecer: {} };
        PROVEDORES_META.gemini.listar = async () => [{ id: 'gemini-3.1-pro-preview' }, { id: 'gemini-3.8-flash' }, { id: 'gemini-3.8-flash-lite' }, { id: 'gemini-3-pro-image' }];
        PROVEDORES_META.anthropic.listar = async () => [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5-20251001' }];
        mostrarToast = () => {};
        __dlg = confirmarModeloParecer({ sigla: 'MPV', numero: 1357, ano: 2026, ementa: 'x' });`);
    await new Promise(r => setTimeout(r, 30));
    const q = sel => av(`document.querySelector(${JSON.stringify(sel)})`);
    ok(!!q('#dlg-parecer'), 'o diálogo abre');
    ok(av(`document.querySelector('#dlg-parecer-provedor').value`) === 'gemini' && av(`[...document.querySelectorAll('#dlg-parecer-provedor option')].find(o => o.value === 'openai').hasAttribute('disabled')`) === true, 'provedor da nota vem selecionado; provedor sem chave aparece desabilitado');
    ok(av(`document.querySelector('#dlg-parecer-modelo').value`) === 'gemini-3.8-flash', 'o melhor modelo do provedor vem pré-selecionado (3.8-flash, pela versão)');
    ok(av(`[...document.querySelectorAll('#dlg-parecer-modelo option')].find(o => o.value === 'gemini-3.8-flash-lite').hasAttribute('disabled')`) === true && !av(`[...document.querySelectorAll('#dlg-parecer-modelo option')].some(o => /image/.test(o.value))`), 'econômico desabilitado; modelo de imagem fora da lista');
    ok(/versão mais alta/.test(av(`document.querySelector('#dlg-parecer-status').textContent`)), 'o motivo da pré-seleção está escrito no diálogo');
    // troca de provedor: a lista do outro provedor entra, pré-selecionada pelo melhor dele
    av(`document.querySelector('#dlg-parecer-provedor').value = 'anthropic'; document.querySelector('#dlg-parecer-provedor').dispatchEvent(new window.Event('change'));`);
    await new Promise(r => setTimeout(r, 30));
    ok(av(`document.querySelector('#dlg-parecer-modelo').value`) === 'claude-opus-5', 'ao trocar de provedor, o melhor dele é pré-selecionado (opus-5)');
    av(`document.querySelector('#dlg-parecer-gerar').dispatchEvent(new window.Event('click'))`);
    const esc = await av('__dlg');
    ok(esc && esc.pid === 'anthropic' && esc.apiKey === 'sk-ant-x' && esc.modelo === 'claude-opus-5' && !av(`document.querySelector('#dlg-parecer')`), 'Gerar devolve provedor, chave do provedor e modelo, e fecha o diálogo');
    ok(av(`chaveDoProvedor('gemini')`) === 'AIzaX' && av(`chaveDoProvedor('openai')`) === '', 'chaveDoProvedor: a chave antiga vale para o provedor da nota; sem chave → vazio');
  }

  console.log('\n== o card mostra "Abrir parecer" quando há parecer salvo ==');
  {
    av(`__card = document.createElement('div'); __card.innerHTML = '<button data-role="btn-abrir-parecer" style="display:none"></button>';
        atualizarBotaoParecer({ chave: 'k', parecerMeta: { em: '2026-09-05T12:00:00Z', por: 'equipe', modelo: 'gemini-3.8-flash', aprovado: false } }, __card);`);
    ok(av("__card.querySelector('button').style.display") === 'inline-flex' && /reprovado/.test(av("__card.querySelector('button').textContent")) && /gemini-3\.8-flash/.test(av("__card.querySelector('button').title")), 'com meta: botão visível, marcado como reprovado, modelo no título');
    av(`atualizarBotaoParecer({ chave: 'k' }, __card)`);
    ok(av("__card.querySelector('button').style.display") === 'none', 'sem meta: botão escondido');
    ok(/\/pareceres\/p1__c1\/meta\.json$/.test(av("state.pauta = { id: 'p1' }; PARECER_PATH(chaveParecer({ chave: 'c1' }), 'meta')")), 'a meta é lida num caminho próprio, sem baixar o parecer inteiro');
  }

  console.log('\n== o pipeline roda no escopo da página com modelo falso ==');
  {
    const TRECHO = 'De acordo com o art. 1º, § 2º-A, do Decreto-Lei nº 1.804, de 3 de setembro de 1980, o imposto de importação é calculado de acordo com a seguinte tabela progressiva: 0 50,00 20,0% - 50,01 3.000,00 60,0% US$ 20,00';
    const achados = [
      { lente: 'X', pergunta: 'dispositivo', achado: 'art. 1º, § 2º-A, do Decreto-Lei 1.804/1980', trecho: 'Decreto-Lei nº 1.804, de 3 de setembro de 1980, passa a vigorar', semQuestao: false },
      { lente: 'X', pergunta: 'regra_antes', achado: 'Até US$ 50,00: 20%; de US$ 50,01 a US$ 3.000,00: 60%, dedução de US$ 20,00.', trecho: TRECHO, semQuestao: false },
      { lente: 'X', pergunta: 'regra_depois', achado: 'Ato do Ministro poderá reduzir a zero até US$ 50,00 e a 30% até US$ 3.000,00.', trecho: 'inclusive para reduzi-las a zero na faixa de tributação de até US$ 50,00', semQuestao: false },
      { lente: '2', pergunta: '2.3', achado: 'O II é exceção às anterioridades (art. 150, § 1º, da CF).', trecho: 'Esta Medida Provisória entra em vigor na data de sua publicação', semQuestao: false },
      { lente: 'X', pergunta: 'historico', achado: 'A MP foi editada em 12 de maio de 2026.', trecho: 'entra em vigor na data de sua publicação. Brasília, 12 de maio de 2026', semQuestao: false },
    ];
    const respostas = {
      apuracao: JSON.stringify(achados),
      tese: JSON.stringify({ afirmacoes: [{ id: 'T1', secao: 'sintese', tipo: 'fato', texto: 'A MPV permite reduzir de 20% para zero até US$ 50 e de 60% para 30% até US$ 3.000, a partir de 12/05/2026.', evidencias: ['F1', 'A3'] }, { id: 'T2', secao: 'sintese', tipo: 'juizo', texto: 'Sem série, o efeito não é verificável.', evidencias: ['F1'] }],
        objetivos: [], lados: { apoia: { id: 'L1', argumento: 'Simplifica.', o_que_a_evidencia_diz: 'a EMI o afirma', evidencias: ['A3'] }, opoe: { id: 'L2', argumento: 'Renúncia sem estimativa.', o_que_a_evidencia_diz: 'a EMI nega renúncia', evidencias: ['F1'] } },
        opcoes: [{ id: 'P1', opcao: 'Aprovar', fiscal: 'renúncia não estimada', juridica: 'delegação regular', politica: 'alinha ao governo', evidencias: ['F1'] }], fatores_concorrentes: [] }),
      contraditorio: JSON.stringify([{ id: 'T1', refutada: false }, { id: 'T2', refutada: false }, { id: 'L1', refutada: false }, { id: 'L2', refutada: false }, { id: 'P1', refutada: false }]),
      redacao: 'Síntese\n\nO texto original da MPV permite reduzir de 20% para zero até US$ 50 e de 60% para 30% até US$ 3.000, a partir de 12/05/2026 [T1].\n\nSem série, o efeito não é verificável (nível de evidência C) [T2].\n\nContexto e processo\n\nNo Senado [S1].\n\nLei vigente e datas de efeito\n\nVale 20% até US$ 50 [F1].\n\nO que se previu\n\nNada consta [F1].\n\nAvaliação da política\n\nNenhuma unidade da tese sobreviveu à conferência nesta seção.\n\nOs dois lados\n\nQuem apoia diz que simplifica [L1]. Quem se opõe aponta renúncia [L2].\n\nOpções e consequências\n\nAprovar consolida a delegação [P1].\n\nRespostas por lente\n\nTributário\n\nO II é exceção às anterioridades [A4].',
    };
    ctx.__io = { chamarModelo: async ({ prompt }) => ({ text: respostas[/etapa de APURAÇÃO/.test(prompt) ? 'apuracao' : /formula a TESE/.test(prompt) ? 'tese' : /revisor ADVERSARIAL/.test(prompt) ? 'contraditorio' : 'redacao'], truncated: false }),
      lerPdf: async () => TRECHO + ' Esta Medida Provisória entra em vigor na data de sua publicação. Brasília, 12 de maio de 2026. Decreto-Lei nº 1.804, de 3 de setembro de 1980, passa a vigorar. inclusive para reduzi-las a zero na faixa de tributação de até US$ 50,00. ' + 'x'.repeat(600), fetchFn: null, abrirXlsx: null, onPasso: () => {} };
    ctx.__ctx = { identificacao: 'MPV 1357/2026', ementa: 'Altera o Decreto-Lei nº 1.804, de 3 de setembro de 1980, sobre tributação simplificada das remessas postais internacionais.', temas: [{ cod: 70 }], docs: [{ rotulo: 'Texto original da MPV 1357/2026', buffer: new Uint8Array(4).buffer }], situacao: 'No Senado.', hoje: new Date('2026-09-05T12:00:00Z') };
    let p = null, e2 = null;
    try { p = await av('gerarParecer(__ctx, __io)'); } catch (e) { e2 = e; }
    ok(p && !p.erro && !e2, e2 ? `gerarParecer falhou no escopo da página: ${e2.message}` : (p && p.erro ? `erro: ${p.erro}` : 'gerarParecer roda no escopo da página'));
    if (p && !p.erro) {
      ok(p.ficha.completa && p.rubrica.aprovado, 'ficha completa e rubrica aprovada: ' + (p.rubrica.pendentes.map(x => x.item).join('; ') || 'ok'));
      ctx.__p = p;
      const html = av('htmlParecer(__p, { materia: "MPV 1357/2026", css: CSS_IMPRESSAO_PLENARIO })');
      ok(/Ficha do objeto/.test(html) && /class="ficha"/.test(html) && /@page/.test(html) && /Limites deste parecer/.test(html) && /<td>T1<\/td>/.test(html), 'htmlParecer imprime no escopo da página com o CSS da nota, limites e anexo técnico');
      // ida e volta pelo Firebase: arrays e objetos vazios somem
      const semVazios = v => Array.isArray(v) ? (v.length ? v.map(semVazios) : undefined) : (v && typeof v === 'object') ? (Object.keys(v).length ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, semVazios(x)]).filter(([, x]) => x !== undefined)) : undefined) : v;
      ctx.__pfb = semVazios(JSON.parse(JSON.stringify(p)));
      let htmlFb = null, eFb = null;
      try { htmlFb = av('htmlParecer(__pfb, { materia: "MPV 1357/2026", css: CSS_IMPRESSAO_PLENARIO })'); } catch (e) { eFb = e; }
      ok(htmlFb && !eFb && /Tabela 1/.test(htmlFb), eFb ? `parecer reaberto do Firebase quebra: ${eFb.message}` : 'parecer reaberto do Firebase (sem arrays vazios) imprime igual');
    }
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
