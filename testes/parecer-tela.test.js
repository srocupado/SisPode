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
    'isAbortError', 'mostrarToast', 'API_BASE', 'FIREBASE_URL', 'state', 'CSS_IMPRESSAO_PLENARIO', 'gerarParecerEspecialista', 'abrirParecerEspecialista', 'temasDaProposicao', 'situacaoDaProposicao', 'PARECER_PATH'];
  const faltando = usados.filter(n => av(`typeof ${n}`) === 'undefined');
  ok(!faltando.length, faltando.length ? `faltam no escopo: ${faltando.join(', ')}` : `os ${usados.length} símbolos usados pela tela estão definidos`);
  ok(!/\(0, eval\)|\beval\(/.test(fonte.replace(/\/\/[^\n]*/g, '')), 'nenhum eval nos scripts (a CSP da extensão o proíbe)');

  console.log('\n== o pipeline roda no escopo da página com modelo falso ==');
  {
    const TRECHO = 'De acordo com o art. 1º, § 2º-A, do Decreto-Lei nº 1.804, de 3 de setembro de 1980, o imposto de importação é calculado de acordo com a seguinte tabela progressiva: 0 50,00 20,0% - 50,01 3.000,00 60,0% US$ 20,00';
    const achados = [
      { lente: 'X', pergunta: 'dispositivo', achado: 'art. 1º, § 2º-A, do Decreto-Lei 1.804/1980', trecho: 'Decreto-Lei nº 1.804, de 3 de setembro de 1980, passa a vigorar', semQuestao: false },
      { lente: 'X', pergunta: 'regra_antes', achado: 'Até US$ 50,00: 20%; de US$ 50,01 a US$ 3.000,00: 60%, dedução de US$ 20,00.', trecho: TRECHO, semQuestao: false },
      { lente: 'X', pergunta: 'regra_depois', achado: 'Ato do Ministro poderá reduzir a zero até US$ 50,00 e a 30% até US$ 3.000,00.', trecho: 'inclusive para reduzi-las a zero na faixa de tributação de até US$ 50,00', semQuestao: false },
      { lente: '2', pergunta: '2.3', achado: 'O II é exceção às anterioridades (art. 150, § 1º, da CF).', trecho: 'Esta Medida Provisória entra em vigor na data de sua publicação', semQuestao: false },
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
      ok(/Ficha do objeto/.test(html) && /class="ficha"/.test(html) && /@page/.test(html) && /<sup class="ev">T1<\/sup>/.test(html), 'htmlParecer imprime no escopo da página com o CSS da nota');
    }
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
