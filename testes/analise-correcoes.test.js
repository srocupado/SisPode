// Correções da varredura de 14/09/2026 — cada teste abaixo nasceu de um defeito
// encontrado no código e confirmado lendo/executando o trecho. O teste reproduz
// o CENÁRIO que produzia informação errada na mão do deputado, não a linha.
//
// Roda no escopo real da página (analise.html carrega todos os módulos no mesmo
// escopo global; `const` de script clássico não está em globalThis), com fetch
// e provedores falsos.
//
// Uso: node testes/analise-correcoes.test.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML, DOMParser } = require(path.join(RAIZ, 'bot/node_modules/linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// fetch programável: a cada teste, `rotas` diz o que cada URL devolve.
let rotas = [];
const respostaJson = obj => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj), headers: { get: () => 'application/json' } });

(async () => {
  const scripts = [...fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window } = parseHTML(fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8'));
  const ctx = {
    document, window, DOMParser, console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async (url, init) => {
      for (const r of rotas) if (r.casa(String(url), init)) return r.resposta(String(url), init);
      return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
    },
    URL, TextDecoder, AbortController, DOMException, Event, Buffer,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => p, getManifest: () => ({ version: '0' }) }, tabs: { create: () => {} } },
    pdfjsLib: { GlobalWorkerOptions: {} }, Quill: function () {}, docx: {}, html2canvas: () => {},
    XLSX: { read: () => ({ SheetNames: [], Sheets: {} }), utils: { sheet_to_json: () => [] } },
    alert: () => {}, confirm: () => false, prompt: () => null,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const fonte = scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n');
  new vm.Script(fonte, { filename: 'pagina-analise.js' }).runInContext(ctx);
  const av = expr => vm.runInContext(expr, ctx);
  const chamar = async (fn, ...args) => { ctx.__args = args; return await av(`${fn}(...__args)`); };

  // ── 1. Resposta sem texto é falha, não análise vazia ────────────────────
  console.log('== resposta sem texto do provedor vira erro declarado ==');
  {
    const casos = [
      { nome: 'Gemini bloqueado por conteúdo (200 sem candidates)', provedor: 'gemini',
        corpo: { promptFeedback: { blockReason: 'SAFETY' } }, espera: /pol[íi]tica de conte[úu]do|SAFETY/i },
      { nome: 'Gemini com finishReason RECITATION e sem texto', provedor: 'gemini',
        corpo: { candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }] }, espera: /recita[çc][ãa]o/i },
      { nome: 'Gemini gastou o teto no raciocínio (MAX_TOKENS sem texto)', provedor: 'gemini',
        corpo: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '' }] } }] }, espera: /limite de sa[íi]da/i },
      { nome: 'OpenAI incompleta sem output_text', provedor: 'openai',
        corpo: { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] }, espera: /content_filter/i },
      { nome: 'OpenAI com bloco de recusa', provedor: 'openai',
        corpo: { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'não posso' }] }] }, espera: /recusou/i },
      { nome: 'Anthropic com stop_reason refusal', provedor: 'anthropic',
        corpo: { stop_reason: 'refusal', content: [] }, espera: /recusou/i },
      { nome: 'Anthropic sem bloco de texto', provedor: 'anthropic',
        corpo: { stop_reason: 'end_turn', content: [{ type: 'tool_use' }] }, espera: /n[ãa]o devolveu texto/i },
    ];
    for (const c of casos) {
      rotas = [{ casa: () => true, resposta: () => respostaJson(c.corpo) }];
      let erro = null, saida = null;
      try { saida = await chamar('chamarIA', { provedorId: c.provedor, apiKey: 'k', modelo: 'm', prompt: 'p', pdfBuffers: [] }); }
      catch (e) { erro = e; }
      ok(!!erro && c.espera.test(erro.message), `${c.nome}: lança erro explicando a causa (${erro ? erro.message.slice(0, 80) : 'NÃO LANÇOU, devolveu ' + JSON.stringify(saida)})`);
    }
    rotas = [{ casa: () => true, resposta: () => respostaJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Texto da nota.' }] } }] }) }];
    const boa = await chamar('chamarIA', { provedorId: 'gemini', apiKey: 'k', modelo: 'm', prompt: 'p', pdfBuffers: [] });
    ok(boa.text === 'Texto da nota.' && boa.truncated === false, 'resposta normal continua passando intacta');
  }

  // ── 2. Costura da continuação ───────────────────────────────────────────
  console.log('\n== continuação truncada não duplica o trecho repetido ==');
  {
    const base = 'O substitutivo mantém a redação do art. 2º do texto original, que trata do prazo de vigência';
    let todas = true;
    for (const k of [13, 17, 25, 40, 47, 73, 91]) {
      const rep = base.slice(-k);
      ctx.__args = [base, rep + ' de cinco anos, contados da publicação.'];
      const out = await av('costurarContinuacao(...__args)');
      const repNorm = rep.trim();
      const dup = out.indexOf(repNorm) !== out.lastIndexOf(repNorm);
      if (dup) { todas = false; console.log(`    repetição de ${k} caracteres ainda duplica: …${out.slice(-70)}`); }
    }
    ok(todas, 'repetições de 13 a 91 caracteres são recortadas (antes só funcionava em múltiplos exatos de 10)');
    ctx.__args = ['Texto anterior.', 'Parágrafo novo e independente.'];
    const semOverlap = await av('costurarContinuacao(...__args)');
    ok(/Texto anterior\. Parágrafo novo/.test(semOverlap), 'sem repetição, a continuação é apenas emendada');
  }

  // ── 3. Subtipo do decreto legislativo ───────────────────────────────────
  console.log('\n== subtipo do PDL não confunde "sustentável" com sustação ==');
  {
    const sub = e => { ctx.__args = [{ ementa: e }]; return av('subtipoPDL(...__args)'); };
    ok(sub('Aprova o texto do Acordo de Cooperação para o desenvolvimento sustentável entre Brasil e Chile') === 'tratado',
      'acordo sobre "desenvolvimento sustentável" é ato internacional, não sustação');
    ok(sub('Aprova o texto da Convenção sobre sustentabilidade ambiental') === 'tratado', '"sustentabilidade" idem');
    ok(sub('Susta os efeitos do Decreto nº 11.000, de 2022') === 'sustacao', 'sustação continua sendo sustação');
    ok(sub('Sustar a aplicação da Portaria nº 10 do Ministério da Fazenda') === 'sustacao', 'a forma "sustar" também');
    ok(sub('Dispõe sobre a sustação de ato normativo do Poder Executivo') === 'sustacao', 'e o substantivo "sustação"');
    ok(sub('Aprova o ato que outorga concessão à Rádio Difusora de Anápolis') === 'outorga', 'outorga de rádio segue outorga');
  }

  // ── 4. Editar a nota não apaga a avaliação dos apensados ────────────────
  console.log('\n== o marcador de acolhimento sai, a avaliação fica ==');
  {
    const md = '## Projetos apensados de autoria do Podemos\n\n'
      + '- [[ACOLHIMENTO:PARCIAL 1405/2026]] PL 1405/2026 (Dep. Fulana): a ideia do apensado foi incorporada em parte — o art. 7º do substitutivo adota a cota, mas sem a fiscalização do art. 3º.\n';
    ctx.__args = [md];
    const limpo = await av('mdSemAcolhimento(...__args)');
    ok(!/ACOLHIMENTO/.test(limpo), 'o marcador sensível não circula');
    ok(/incorporada em parte/.test(limpo) && /art\. 7º do substitutivo/.test(limpo),
      'a justificativa que a Liderança usa permanece no texto (antes a linha inteira era apagada)');
    ok(/^- PL 1405\/2026/m.test(limpo), 'o item da lista continua um item de lista, sem espaço sobrando');
  }

  // ── 5 e 6. Escolha de documentos: PEC com parecer de Plenário, e a corrida ──
  console.log('\n== PEC com parecer proferido em Plenário não vira "sem parecer" ==');
  {
    const pareceres = { comissoes: [], prlp: { url: 'http://x/prlp3.pdf', sequencial: '3', dataBR: '06/07/2023', data: '2023-07-06' },
      prle: null, sbtA: { url: 'http://x/sbt1.pdf', sequencial: '1', dataBR: '06/07/2023', data: '2023-07-06' },
      autografo: null, prlEspecial: null, sbtAEspecial: null };
    ctx.__pec = { sigla: 'PEC', numero: '45', ano: '2019', tipoCategoria: 'projeto',
      enriquecimento: { idProposicao: 2196833, urlInteiroTeor: 'http://x/teor.pdf', apensadosPodemos: [], pareceresPlenario: pareceres } };
    const docs = await av('escolherDocumentos(__pec)');
    const tipos = docs.map(d => d.tipo);
    ok(tipos.includes('PRLP') && tipos.includes('SBT_A'),
      `o parecer de Plenário e o substitutivo são anexados (tipos: ${tipos.join(', ')})`);
    ctx.__docs = docs;
    ok(!/Cenário 1/.test(av('classificarCenario(__docs)')), 'e o cenário deixa de ser "sem parecer": ' + av('classificarCenario(__docs)'));
    // com parecer da Comissão Especial, ele continua sendo o documento operativo
    ctx.__pec2 = { ...ctx.__pec, enriquecimento: { ...ctx.__pec.enriquecimento,
      pareceresPlenario: { ...pareceres, prlEspecial: { url: 'http://x/prl-esp.pdf', sequencial: '1', dataBR: '10/06/2023' } } } };
    const docs2 = await av('escolherDocumentos(__pec2)');
    ok(docs2.some(d => d.tipo === 'PRL_ESPECIAL') && !docs2.some(d => d.tipo === 'PRLP'),
      'havendo parecer da Comissão Especial, ele prevalece e o PRLP não entra');
  }

  console.log('\n== enriquecimento que não terminou é resolvido na hora, não vira "sem parecer" ==');
  {
    av(`__chamou = 0; buscarPareceresPlenario = async () => { __chamou++; return { comissoes: [], prlp: { url: 'http://x/prlp1.pdf', sequencial: '1', dataBR: '01/09/2026', data: '2026-09-01' }, prle: null, sbtA: null, autografo: null, prlEspecial: null, sbtAEspecial: null }; };`);
    ctx.__pl = { sigla: 'PL', numero: '4822', ano: '2025', tipoCategoria: 'projeto',
      enriquecimento: { idProposicao: 123456, urlInteiroTeor: 'http://x/teor.pdf', apensadosPodemos: [], emendasSenado: { ems: null, ssp: null } } };
    const docs = await av('escolherDocumentos(__pl)');
    ok(av('__chamou') === 1 && docs.some(d => d.tipo === 'PRLP'),
      `o parecer é buscado sob demanda quando falta (chamadas: ${av('__chamou')}; tipos: ${docs.map(d => d.tipo).join(', ')})`);
  }

  // ── 7. Redação Final não localizada ─────────────────────────────────────
  console.log('\n== Redação Final não localizada não é apresentada como aprovada ==');
  {
    ctx.__rf = { sigla: 'PL', numero: '1234', ano: '2024', tipoCategoria: 'redacao_final', ementa: 'Dispõe sobre x.',
      enriquecimento: { idProposicao: 1, urlInteiroTeor: 'http://x/teor.pdf', apensadosPodemos: [] } };
    ctx.__docsRF = [{ tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor da proposição', url: 'http://x/teor.pdf' }];
    const promptSem = av('montarPrompt(__rf, __docsRF, "")');
    ok(/N[ÃA]O foi localizado/i.test(promptSem) && /inteiro teor/i.test(promptSem),
      'o prompt avisa que a Redação Final não foi localizada e que o anexo é o texto original');
    ok(!/esta é a redação final aprovada/i.test(promptSem), 'e não afirma que aquele texto é a redação final aprovada');
    ctx.__docsRF2 = [{ tipo: 'REDACAO_FINAL', rotulo: 'Redação Final', url: 'http://x/rf.pdf' }];
    const promptCom = av('montarPrompt(__rf, __docsRF2, "")');
    ok(/esta é a redação final aprovada/i.test(promptCom), 'com o documento certo, o prompt volta ao texto de sempre');
  }

  // ── 8. "Completar" numa nota já editada ─────────────────────────────────
  console.log('\n== "Completar" numa nota editada aparece na tela e no PDF ==');
  {
    av(`
      __salvo = null;
      escolherDocumentos = async () => [];
      baixarPdf = async () => new ArrayBuffer(4);
      calcularRefsSuspeitas = async () => [];
      calcularEmendasSuspeitas = async () => [];
      renderAnaliseCard = () => {};
      fbSalvarAnalise = async it => { __salvo = it.analise; };
      chamarIA = async () => ({ text: 'Parágrafo final que faltava.', truncated: false });
      carregarConfig = async () => {};
      state.config = { provedor: 'gemini', apiKey: 'k', modelo: 'm' };
      document.body.innerHTML = '<div class="an-card" data-chave="c1"><button data-role="btn-completar"></button></div>';
      __it = { chave: 'c1', sigla: 'PL', numero: '1', ano: '2026', tipoCategoria: 'projeto',
        analise: { formato: 'html', html: '<p>Texto editado pelo analista.</p>', markdown: 'Texto editado pelo analista.', truncada: true } };
    `);
    await av('completarAnalise(__it)');
    const html = av('__it.analise.html'), md = av('__it.analise.markdown');
    ok(/Parágrafo final que faltava/.test(html), `a continuação entra no html que a tela e o PDF leem (html: ${String(html).slice(0, 90)})`);
    ok(/Texto editado pelo analista/.test(html), 'e a edição do analista é preservada');
    ok(/Parágrafo final que faltava/.test(md), 'o espelho em texto também fica completo');
    ok(av('__it.analise.formato') === 'html', 'a nota continua em html (não volta a markdown)');
  }

  // ── 9. Falha na consulta do deputado ────────────────────────────────────
  console.log('\n== falha ao consultar o deputado não vira "Autoria: não-Podemos" ==');
  {
    av('state.cacheAutoria = new Map();');
    rotas = [
      { casa: u => /\/proposicoes\/999\/autores/.test(u), resposta: () => respostaJson({ dados: [{ nome: 'Dep. Fulano', uri: 'https://dadosabertos.camara.leg.br/api/v2/deputados/74856', tipo: 'Deputado', ordemAssinatura: 1, proponente: 1 }] }) },
      { casa: u => /\/deputados\/74856/.test(u), resposta: () => ({ ok: false, status: 429, json: async () => ({}), text: async () => 'rate limit' }) },
    ];
    const autores = await chamar('fetchAutoresProposicao', 999);
    ok(autores.length === 1 && autores[0].isPodemos === false && autores[0].autoriaIncerta === true,
      'o autor sai marcado como não verificado, e não como de outro partido');
    ok(av('state.cacheAutoria.size') === 0, 'a falha NÃO é cacheada: a próxima geração tenta de novo');
    // com a API respondendo, o partido é lido normalmente
    rotas = [
      { casa: u => /\/proposicoes\/998\/autores/.test(u), resposta: () => respostaJson({ dados: [{ nome: 'Dep. Beltrana', uri: 'https://dadosabertos.camara.leg.br/api/v2/deputados/12345', tipo: 'Deputado', ordemAssinatura: 1, proponente: 1 }] }) },
      { casa: u => /\/deputados\/12345/.test(u), resposta: () => respostaJson({ dados: { ultimoStatus: { nome: 'Beltrana', siglaPartido: 'PODE', siglaUf: 'SP' } } }) },
    ];
    const autores2 = await chamar('fetchAutoresProposicao', 998);
    ok(autores2[0].isPodemos === true && !autores2[0].autoriaIncerta, 'autoria do Podemos continua sendo reconhecida');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
