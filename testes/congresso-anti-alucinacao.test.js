// Módulo de Congresso Nacional: mecanismos anti-alucinação (12/11/2026), o mesmo padrão da nota do Plenário.
//
// O que este teste trava:
//   a. os prompts (dispositivos, Resumo do Projeto, razões, PLN) proíbem fatos/órgãos/siglas/valores de fora
//      da fonte; o Resumo do Projeto sai só da ementa — sem ementa a IA não é chamada, e SEM_INFORMACAO vira a
//      ementa literal;
//   c. o documento do PLN guarda o RÓTULO ("Parecer de Plenário", "Relatório Legislativo"…) e o prompt diz o
//      que ele é: parecer de Plenário não é "a CMO aprovou"; relatório é proposta do relator;
//   b. conferência sem IA: valor em R$ na precisão citada (caso real: "R$ 185,55 bilhões" no PLN 23/2026, que a
//      fonte não traz), código de ação, sigla (aceita quando a fonte traz o nome por extenso), aspas (palavras
//      que não estão na fonte; a citação partida pelo PDF passa), lei, parlamentar e proposição;
//   e. verificação por IA: PLN com o mesmo PDF, veto em lotes (projeto+razões; dispositivos de 40 em 40); modelo
//      não econômico de versão mais alta; só trechos literais; falha registrada; texto que mudou durante a
//      verificação não recebe o resultado; "Parar tudo" não grava; avisos no card; campos persistidos.
// Uso: node testes/congresso-anti-alucinacao.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'congresso.html'), 'utf8');
const { document, window } = parseHTML(html);
const pedidos = [];
const ctx = {
  document, window, DOMParser, URL, console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout, clearTimeout, AbortController,
  TextDecoder, TextEncoder, Blob, Event: window.Event, DOMException,
  chrome: { runtime: { getURL: p => p }, storage: { local: { get: (_k, cb) => cb && cb({}), set: () => {} } } },
  pdfjsLib: { GlobalWorkerOptions: {} }, localStorage: { getItem: () => null, setItem: () => {} }, confirm: () => true, alert: () => {},
  fetch: async (url, init = {}) => { pedidos.push({ m: init.method || 'GET', url: String(url), body: init.body }); return { ok: true, status: 200, json: async () => null }; },
};
ctx.globalThis = ctx; ctx.window = window;
vm.createContext(ctx);
ok(/<script src="parecer\.js"><\/script>[\s\S]*<script src="congresso\.js">/.test(html), 'a página carrega o parecer.js (escolherModelo) antes do congresso.js');
new vm.Script(fs.readFileSync(path.join(RAIZ, 'parecer.js'), 'utf8')).runInContext(ctx);
new vm.Script(fs.readFileSync(path.join(RAIZ, 'congresso.js'), 'utf8')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
ctx.__toasts = [];
av('mostrarToast = (m, t) => __toasts.push({ m, t }); sleep = async () => {}; carregarDetalhe = async () => {};');
av(`app.config = { provedor: 'gemini', apiKey: 'k', modelo: 'gemini-3.1-flash-lite' };
    PROVEDORES_META.gemini.listar = async () => [{ id: 'gemini-3.1-flash-lite' }, { id: 'gemini-3.8-flash' }, { id: 'gemini-3-pro-image' }];`);

// IA de mentira: responde conforme o tipo de prompt e registra cada chamada
ctx.__ia = { chamadas: [], verificador: () => '{"itens":[]}', falhar: null, durante: null };
av(`
  chamarIAtexto = async (a) => { __ia.chamadas.push({ tipo: 'texto', ...a });
    if (__ia.durante) __ia.durante(a);
    if (/revisor\\(a\\) de textos/.test(a.prompt)) { if (__ia.falhar) throw __ia.falhar; return __ia.verificador(a); }
    if (/"Resumo do Projeto"/.test(a.prompt)) return __ia.projeto || 'Torna hediondo o crime de maus-tratos.';
    if (/Razões do veto/.test(a.prompt) && /\\[\\{"codigos"/.test(a.prompt)) return JSON.stringify([{ codigos: __ia.codigos, resumo: 'O dispositivo contraria o interesse público por gerar despesa sem estimativa.' }]);
    const cods = [...a.prompt.matchAll(/Código (\\S+) —/g)].map(m => m[1]);
    return JSON.stringify(Object.fromEntries(cods.map(c => [c, __ia.resumoDisp ? __ia.resumoDisp(c) : 'Estabelece a composição do CNE com 18 representantes.'])));
  };
  chamarIApdf = async (a) => { __ia.chamadas.push({ tipo: 'pdf', ...a });
    if (/revisor\\(a\\) de textos/.test(a.prompt)) { if (__ia.falhar) throw __ia.falhar; return __ia.verificador(a); }
    return __ia.analisePln;
  };
`);

(async () => {
  // ------------------------------------------------------------------ a
  console.log('\n== a. prompts ==');
  const veto = n => ({ key: `vet-${n}`, numero: `${n}/2025`, tipo: 'Parcial', materia: 'PL 1/2025', assunto: 'Lei Geral do Esporte', ementa: 'Institui a Lei Geral do Esporte.',
    dispositivos: [], detalheCarregado: true, razoesPdfUrl: 'https://x/razoes.pdf' });
  ctx.__v = veto(1);
  ok(av('promptResumo(__v, [{ codigo: "1.1", descricao: "inciso I", texto: "18 representantes" }])').includes(av('REGRA_FONTE_CN')) && /sem completar com o nome que você supõe/.test(av('promptResumo(__v, [{ codigo: "1.1", descricao: "x", texto: "y" }])')), 'dispositivos: regra da fonte + "inciso isolado: não complete com o nome que supõe"');
  const pp = av('promptProjeto(__v)');
  ok(pp.includes(av('REGRA_FONTE_CN')) && /APENAS na ementa/.test(pp) && /SEM_INFORMACAO/.test(pp) && !/a quem se destina\. Foque/.test(pp), 'Resumo do Projeto: só a ementa, escreve menos em vez de deduzir, SEM_INFORMACAO quando a ementa só cita dispositivos');
  ok(av('promptRazoesTotal(__v)').includes(av('REGRA_FONTE_CN')) && av('promptRazoesGrupos(__v, [])').includes(av('REGRA_FONTE_CN')), 'razões (total e por grupos) com a mesma regra');
  ctx.__ia.chamadas = [];
  ctx.__v = { ...veto(2), ementa: '' };
  ok(await av('resumirProjeto(__v, { render: false })') === false && ctx.__ia.chamadas.length === 0 && !ctx.__v.resumoProjeto, 'sem ementa, a IA não é chamada: o resumo fica em branco para o analista (não sai do assunto)');
  ctx.__ia.projeto = 'SEM_INFORMACAO';
  ctx.__v = { ...veto(3), ementa: 'Altera o art. 5º da Lei nº 9.615, de 24 de março de 1998.' };
  await av('resumirProjeto(__v, { render: false })');
  ok(ctx.__v.resumoProjeto === 'Altera o art. 5º da Lei nº 9.615, de 24 de março de 1998.', 'SEM_INFORMACAO: o resumo é a ementa literal');
  ctx.__ia.projeto = null;

  // ------------------------------------------------------------------ c
  console.log('\n== c. o documento do PLN e a atribuição ==');
  const pagina = links => new DOMParser().parseFromString(`<html><body>${links.map(([h, t]) => `<a href="https://legis.senado.leg.br/sdleg-getter/documento?dm=${h}">${t}</a>`).join(' ')}</body></html>`, 'text/html');
  ctx.__doc = pagina([['1', 'Calendário'], ['2', 'Relatório Legislativo'], ['3', 'Parecer de Plenário']]);
  ok(av('acharParecer(__doc).rotulo') === 'Parecer de Plenário' && /dm=3/.test(av('acharParecerUrl(__doc)')), 'acharParecer devolve o documento E o rótulo dele');
  ctx.__doc = pagina([['1', 'Calendário'], ['2', 'Relatório Legislativo']]);
  ok(av('acharParecer(__doc).rotulo') === 'Relatório Legislativo', '…o relatório, quando não há parecer');
  const pln = (rot) => ({ key: 'pln-23-2026', sigla: 'PLN', numero: '23/2026', ementa: 'Abre crédito suplementar.', apelido: '', parecerRotulo: rot, parecerUrl: 'https://x/p.pdf' });
  ctx.__p = pln('Parecer de Plenário');
  ok(/PARECER DE PLENÁRIO[\s\S]*nunca "a CMO aprovou"/.test(av('promptPLN(__p)')) && av('promptPLN(__p)').includes('"Parecer de Plenário"'), 'parecer de Plenário: "o relator, em Plenário, pela CMO" — nunca "a CMO aprovou"');
  ctx.__p = pln('Relatório Legislativo');
  ok(/PROPOSTA do\(a\) relator\(a\)/.test(av('promptPLN(__p)')), 'relatório: proposta do relator, não decisão da CMO');
  ctx.__p = pln('');
  ok(/Não afirme que a CMO ou o Plenário aprovou/.test(av('promptPLN(__p)')) && /sem somar, arredondar ou converter/.test(av('promptPLN(__p)')), 'PLN antigo sem rótulo: regra genérica de atribuição; valores copiados como estão');

  // ------------------------------------------------------------------ b
  console.log('\n== b. conferência sem IA ==');
  const C = (t, f, m) => { ctx.__t = t; ctx.__f = f; ctx.__m = m; return av('conferirTextoCN(__t, __f, __m)'); };
  const FONTE_PLN = `Abre ao Orçamento Fiscal da União crédito suplementar no valor de R$ 13.186.131,00, para a ação "21H0 - Proteção
Socioassistencial". O total da LOA é de R$ 149.440.000.000,00. Comissão Mista de Planos, Orçamentos Públicos e Fiscalização. Relator: Deputado Fulano de Tal.
Altera a Lei nº 15.346, de 14 de janeiro de 2026.`;
  ok(C('O crédito de R$ 13.186.131,00 (cerca de R$ 13,2 milhões) reforça a ação 21H0, nos termos da Lei nº 15.346.', FONTE_PLN).length === 0, 'valor por extenso e abreviado na precisão citada, ação e lei da fonte: nada sinalizado');
  const r = C('O PLN soma R$ 185,55 bilhões, reforça a ação 00SR e cita a Lei nº 14.133 e o Deputado Beltrano Inventado.', FONTE_PLN);
  ok(r.includes('valor R$ 185,55 bilhões'), `valor que a fonte não traz (caso real do PLN 23/2026): ${r.join(' | ')}`);
  ok(r.includes('ação 00SR') && r.includes('Lei nº 14.133') && r.includes('Deputado Beltrano Inventado'), 'ação, lei e parlamentar que a fonte não traz');
  ok(C('O total é de R$ 149,4 bilhões.', FONTE_PLN).length === 0 && C('O total é de R$ 149,5 bilhões.', FONTE_PLN).length === 1, 'arredondamento: 149,4 bi bate com 149.440.000.000; 149,5 não');
  ok(C('Define a composição do CNE.', 'Conselho Nacional de Educação, com 18 representantes governamentais', 20).length === 0, 'sigla cujo nome por extenso está na fonte (CNE ← Conselho Nacional de Educação)');
  ok(C('Define a composição do CNE.', '18 (dezoito) representantes governamentais, inclusive 1 representante da Câmara', 20).includes('sigla CNE'), 'inciso isolado que não diz o órgão: a sigla que a IA supôs é sinalizada');
  ok(C('Reforça a ação “00X3 - Compensação Financeira entre o RPPSU”.', 'a ação “00X3 -\n\fCONGRESSO NACIONAL\n3\nCompensação Financeira entre o RPPSU e os demais RPPS dos entes federados, ...........').length === 0, 'citação entre aspas partida pela quebra de página do PDF: passa');
  ok(C('A medida atinge o “uso de animais de tração”.', 'maus-tratos a animais de produção em práticas agropecuárias regulares .....................').some(x => /tracao/.test(x)), 'aspas com termo que a fonte não traz: sinalizado, com o termo');

  // ------------------------------------------------------------------ e: PLN
  console.log('\n== e. verificação por IA — PLN ==');
  av('app.sessaoAtiva = { id: "p_1", plns: [], vetos: [], vetoKeys: new Set() };');
  av('baixarArrayBuffer = async () => new ArrayBuffer(8); extrairTextoPdf = async () => __fontePdf;');
  ctx.__fontePdf = FONTE_PLN.repeat(3);
  ctx.__ia.analisePln = 'Abre crédito de R$ 13.186.131,00 para a ação 21H0. O total chega a R$ 185,55 bilhões.';
  ctx.__ia.verificador = () => '```json\n{"itens":[{"onde":"análise","trecho":"O total chega a R$ 185,55 bilhões","motivo":"o documento traz R$ 149,44 bilhões"},{"onde":"análise","trecho":"frase que não está no texto","motivo":"x"}]}\n```';
  ctx.__ia.chamadas = []; pedidos.length = 0;
  ctx.__p = pln('Parecer de Plenário');
  await av('resumirPLN(__p, { silencioso: true })');
  const verif = ctx.__ia.chamadas.find(c => /revisor/.test(c.prompt));
  ok(verif && verif.tipo === 'pdf' && verif.modelo === 'gemini-3.8-flash' && verif.pdfBuffers.length === 1, 'PLN: o verificador lê o mesmo PDF, com o modelo não econômico de versão mais alta');
  ok(ctx.__p.refsSuspeitas.includes('valor R$ 185,55 bilhões'), 'PLN: a conferência sem IA acusa o valor');
  ok(ctx.__p.verificacaoIA.itens.length === 1 && ctx.__p.verificacaoIA.itens[0].onde === 'análise', 'PLN: só o trecho literal fica (o inventado pelo verificador cai)');
  ok(pedidos.filter(x => x.m === 'PUT' && /plns\/pln-23-2026/.test(x.url)).length === 2 && /verificacaoIA/.test(pedidos.filter(x => /plns\/pln-23-2026/.test(x.url)).at(-1).body), 'PLN: salvo com a análise e de novo com a verificação');
  ok(!JSON.parse(pedidos.filter(x => /plns\/pln-23-2026/.test(x.url)).at(-1).body)._verificando, 'o estado transitório (_verificando) não vai para o Firebase');
  ctx.__html = av('renderPlnCard(__p, "")');
  ok(/Conferência automática/.test(ctx.__html) && /Verificação por IA \(gemini-3\.8-flash\)/.test(ctx.__html) && /185,55 bilhões/.test(ctx.__html) && /Parecer de Plenário \(PDF\)/.test(ctx.__html), 'card do PLN: os dois avisos e o rótulo do documento no link');

  ctx.__ia.falhar = new Error('HTTP 429');
  await av('resumirPLN(__p, { silencioso: true })');
  ok(ctx.__p.verificacaoIA.falhou === 'HTTP 429' && /não concluída/.test(av('renderPlnCard(__p, "")')), 'falha do verificador fica registrada e visível');
  ctx.__ia.falhar = null;

  // ------------------------------------------------------------------ e: veto
  console.log('\n== e. verificação por IA — veto (em lotes) ==');
  const disps = Array.from({ length: 45 }, (_, i) => ({ codigo: `14.23.${String(i + 1).padStart(3, '0')}`, descricao: `inciso ${i + 1} do art. 21`, texto: '18 (dezoito) representantes governamentais, inclusive 1 representante da Câmara dos Deputados' }));
  ctx.__v = { ...veto(14), dispositivos: disps };
  ctx.__ia.codigos = disps.map(d => d.codigo);
  av('garantirRazoesTexto = async v => { v.razoesTexto = "Razões do veto: o dispositivo contraria o interesse público por gerar despesa sem estimativa de impacto orçamentário e financeiro. ".repeat(3); return true; }');
  ctx.__ia.verificador = a => /\[Dispositivo 14\.23\.001\]/.test(a.prompt)
    ? '{"itens":[{"onde":"Dispositivo 14.23.001","trecho":"Estabelece a composição do CNE","motivo":"o texto não cita o CNE"}]}'
    : '{"itens":[]}';
  ctx.__ia.chamadas = [];
  av('app.sessaoAtiva = null;');
  await av('resumirVeto(__v, { silencioso: true, render: false })');
  const verifs = ctx.__ia.chamadas.filter(c => /revisor/.test(c.prompt));
  ok(verifs.length === 3 && verifs.every(c => c.modelo === 'gemini-3.8-flash'), `veto de 45 dispositivos: 3 verificações (projeto+razões; 40 + 5 dispositivos) — ${verifs.length}`);
  ok(/Mensagem de veto \(razões\):\nRazões do veto/.test(verifs[0].prompt) && /\[Resumo do Projeto\]/.test(verifs[0].prompt), 'o 1º lote leva a Mensagem de veto e confere o Resumo do Projeto e as razões');
  ok(ctx.__v.refsSuspeitas.filter(x => /^Dispositivo 14\.23\.\d+: sigla CNE$/.test(x)).length === 45, 'conferência sem IA: o CNE que o inciso isolado não cita, em cada dispositivo');
  ok(ctx.__v.verificacaoIA.itens.length === 1 && ctx.__v.verificacaoIA.itens[0].onde === 'Dispositivo 14.23.001', 'verificação: o apontamento com o lugar (dispositivo)');
  const salvo = JSON.parse(pedidos.filter(x => /vetos_resumos\/vet-14/.test(x.url)).at(-1).body);
  ok(salvo.refsSuspeitas.length === 45 && salvo.verificacaoIA.itens.length === 1, 'veto: refsSuspeitas e verificacaoIA gravados em vetos_resumos');
  ok(/Dispositivo 14\.23\.001:<\/em> “Estabelece a composição do CNE”/.test(av('avisosConferenciaHtml(__v)')), 'card do veto: o apontamento com o dispositivo');

  // nada mudou e já verificado: não verifica de novo
  ctx.__ia.chamadas = [];
  await av('resumirVeto(__v, { silencioso: true, render: false })');
  ok(!ctx.__ia.chamadas.some(c => /revisor/.test(c.prompt)), 'veto sem texto novo e já verificado: nenhuma chamada extra');

  // regerado durante a verificação: resultado descartado
  ctx.__ia.durante = a => { if (/revisor/.test(a.prompt)) ctx.__v.resumoProjeto = 'editado pelo analista'; };
  await av('conferirEVerificarVeto(__v, { render: false })');
  ctx.__ia.durante = null;
  ok(!ctx.__v.verificacaoIA, 'texto mudou durante a verificação: o resultado (de outro texto) não é gravado');

  // "Parar tudo"
  const ab = new DOMException('x', 'AbortError');
  ctx.__ia.falhar = ab;
  await av('conferirEVerificarVeto(__v, { render: false })');
  ctx.__ia.falhar = null;
  ok(!ctx.__v.verificacaoIA && !ctx.__v._verificando && av('_iaInFlight') === 0, '"Parar tudo": nada gravado, contador de IA zerado');

  // persistência e herança
  ok(!('_verificando' in av('leanVeto({ ...__v, _verificando: true })')) && !('_verificando' in av('leanPln({ a: 1, _verificando: true })')), 'leanVeto/leanPln não levam _verificando');
  ctx.__antigo = { refsSuspeitas: ['x'], verificacaoIA: { modelo: 'm', itens: [] } };
  ok(av('herdarDaPautaAnterior({}, __antigo)').verificacaoIA.modelo === 'm', 'reimportar a pauta herda a conferência e a verificação');

  const src = fs.readFileSync(path.join(RAIZ, 'congresso.js'), 'utf8');
  ok(/if \(\/\^\(o\\d\|gpt-5\)\/\.test\(m\)\) delete body\.temperature;/.test(src) && /\.\.\.\(\/\^\(o\\d\|gpt-5\)\/\.test\(m\) \? \{\} : \{ temperature: 0\.2 \}\)/.test(src),
    'OpenAI: modelo de raciocínio (que o verificador pode escolher) não recebe temperature, no texto e no PDF');
  ok(/maxSaida: 8000 \}\)/.test(src), 'verificação com PDF: teto de saída maior que o da análise (o raciocínio conta na saída)');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO FATAL:', e); process.exit(1); });
