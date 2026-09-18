// Resumo de cada item votado, na aba "Como votou o deputado".
//
// A tramitação diz que se votou "DTQ 3: Bloco UNIÃO (SD): Emenda de Plenário
// nº 26". Não diz o que a emenda 26 fazia. Este módulo busca isso no inteiro
// teor e entrega DUAS camadas: a TRANSCRIÇÃO literal, que é o que se confere, e
// a EXPLICAÇÃO em linguagem comum, escrita pelo provedor de IA a partir dessa
// transcrição e de mais nada. O que este teste guarda é a fronteira entre elas:
// o modelo só reescreve o que recebe, id que ele invente é descartado, e o
// documento diz o que é transcrito e o que é gerado.
//
// A armadilha que custou a achar, e que este teste existe para impedir de
// voltar: `objetosPossiveis` CRESCE ao longo da sessão. Medido no PL 3.626/2023
// em 18/09/2026 — a primeira votação de 13/09 lista 50 objetos e 1 destaque; a
// última do mesmo dia lista 79 e 8. Lendo a primeira, 2 de 18 itens achavam
// resumo; lendo a última, 10 de 18. E o erro era mudo: o relatório saía quase
// sem resumo nenhum, sem nenhuma falha aparente.
//
// Uso: node testes/resumos.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// ---------- PDFs de mentira ----------
// O texto é o que o pdf.js devolveria; o "PDF" é só o cabeçalho %PDF mais o id.
const PDFS = {
  'dtq3': 'CÂMARA DOS DEPUTADOS DESTAQUE DE EMENDA - PL 3626/2023 Senhor(a) Presidente, '
        + 'Requeiro a V. Exa., nos termos do art. 161, II, do Regimento Interno da Câmara dos Deputados, '
        + 'destaque para Emenda de Plenário nº 26 apresentada à(ao) PL 3626/2023 '
        + 'Sala das Sessões, ____/_____/_____. AUREO RIBEIRO *CD232644576000* LexEdit '
        + 'Assinado por chancela eletrônica do(a) Dep. Aureo Ribeiro Para verificar a assinatura, acesse https://x/y',
  'emp26': 'CÂMARA DOS DEPUTADOS EMENDA ADITIVA Incluam-se os seguintes incisos ao art. 26 do substitutivo: '
        + 'VII - devedores inadimplentes. JUSTIFICAÇÃO A emenda tem como objetivo vedar a participação, na '
        + 'condição de apostador, de devedores inadimplentes inscritos em entidades de proteção ao crédito. '
        + 'Trata-se de medida de proteção para que pessoas endividadas não recorram às apostas. '
        + 'Fl. 1 de 2 *CD234170017600* Assinado eletronicamente pelo(a) Dep. Aureo Ribeiro',
  // Justificação com o título espaçado, como alguns documentos da Casa fazem.
  'emp27': 'EMENDA DE PLENÁRIO Texto da emenda. J U S T I F I C A T I V A A emenda preserva a rede '
        + 'lotérica existente, que emprega milhares de pessoas em todo o país e responde por parte '
        + 'relevante da arrecadação. Sala das Sessões, 13/09/2023.',
  // Documento sem justificação nenhuma — o caso do PL 3.626/2023, 14 páginas.
  'pl3626': 'PROJETO DE LEI Nº 3.626, DE 2023 Art. 1º Esta Lei dispõe sobre apostas de quota fixa. '
        + 'Art. 2º Para os efeitos desta Lei considera-se ... Art. 30. Esta Lei entra em vigor na data de sua publicação.',
  'emp99': 'EMENDA JUSTIFICAÇÃO curta.',        // abaixo do mínimo: não conta como justificação
};

const api = { chamadas: [], derrubarPdf: null, props: {}, votacoes: {}, objetosPorVotacao: {} };
const resp = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
const erro = s => ({ ok: false, status: s, json: async () => ({}), text: async () => '' });
const pdfResp = chave => ({
  ok: true, status: 200,
  arrayBuffer: async () => {
    const t = '%PDF-1.4\n' + chave;
    const b = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
    return b.buffer;
  },
});

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  // aderencia.html passou a carregar ia-comum.js, que declara um
  // AbortController no topo do arquivo. Sem ele no contexto, NENHUM script
  // da página chega a ser avaliado.
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} },
  // pdf.js de mentira: devolve o texto da tabela acima a partir do miolo do PDF.
  pdfjsLib: {
    GlobalWorkerOptions: {},
    getDocument: ({ data }) => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => {
          const chave = String.fromCharCode(...data).replace('%PDF-1.4\n', '');
          return { items: (PDFS[chave] || '').split(' ').map(str => ({ str })) };
        } }),
      }),
    }),
  },
  fetch: async (url) => {
    const u = String(url);
    api.chamadas.push(u);
    let m;
    if ((m = u.match(/mostrarintegra\?codteor=(\w+)/))) {
      if (api.derrubarPdf && api.derrubarPdf.includes(m[1])) return erro(500);
      return pdfResp(m[1]);
    }
    if ((m = u.match(/\/votacoes\/([\w-]+)$/))) {
      return resp({ dados: { id: m[1], objetosPossiveis: api.objetosPorVotacao[m[1]] || [] } });
    }
    if ((m = u.match(/\/proposicoes\/(\d+)$/))) return resp({ dados: api.props[m[1]] || {} });
    if ((m = u.match(/\/proposicoes\/(\d+)\/votacoes/))) return resp({ dados: api.votacoes[m[1]] || [] });
    if ((m = u.match(/\/proposicoes\/(\d+)\/tramitacoes/))) return resp({ dados: api.tramitacoes || [] });
    if ((m = u.match(/\/votacoes\/([\w-]+)\/votos/))) return resp({ dados: api.votos && api.votos[m[1]] || [] });
    if ((m = u.match(/\/votacoes\/([\w-]+)\/orientacoes/))) return resp({ dados: api.orient && api.orient[m[1]] || [] });
    if (/\/proposicoes\?/.test(u)) return resp({ dados: [api.props['2374400']] });
    if (/\/deputados\?nome=/.test(u)) return resp({ dados: [] });
    if (/\/referencias\//.test(u)) return resp({ dados: [] });
    return erro(599);
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
const chamar = (fn, ...args) => vm.runInContext(fn, ctx)(...args);

const iT = c => 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=' + c;

(async () => {
  console.log('== extração: o que o documento diz, e só ==');
  {
    const t = PDFS.emp26;
    const j = chamar('rsmJustificacao', t);
    ok(/^A emenda tem como objetivo vedar/.test(j), 'a justificação sai a partir do título');
    ok(!/Assinado eletronicamente|CD2341|Fl\. 1 de 2/.test(j),
       'sem o rodapé de assinatura, que não é conteúdo');

    ok(/^A emenda preserva a rede lotérica/.test(chamar('rsmJustificacao', PDFS.emp27)),
       'JUSTIFICATIVA com as letras espaçadas também é reconhecida');
    ok(chamar('rsmJustificacao', PDFS.pl3626) === null,
       'documento sem justificação devolve null — não se inventa uma');
    ok(chamar('rsmJustificacao', PDFS.emp99) === null,
       'e um trecho curto demais não passa por justificação');

    const p = chamar('rsmPedido', PDFS.dtq3);
    ok(/destaque para Emenda de Plenário nº 26/.test(p), 'o pedido do destaque sai do requerimento');
    ok(!/Sala das Sessões|AUREO RIBEIRO/.test(p), 'e para antes da sala das sessões');
    ok(chamar('rsmPedido', PDFS.emp26) === null, 'uma emenda não tem pedido de destaque');
  }

  console.log('\n== cortar: sem objeto de texto nulo ==');
  {
    ok(chamar('rsmCortar', null) === null,
       'sem texto, devolve null — não um objeto com texto nulo, que o código de cima leria como achado');
    const c = chamar('rsmCortar', 'a'.repeat(400) + '. ' + 'b'.repeat(400));
    ok(c.cortado === true && / \[…\]$/.test(c.texto), 'texto longo é cortado, e o corte é declarado');
    ok(c.texto.length < 760, 'perto do teto, não muito além dele');
    ok(chamar('rsmCortar', 'nos termos do art. 161').texto === 'Nos termos do art. 161',
       'a transcrição começa em maiúscula: ela pega a frase do documento pelo meio');
  }

  console.log('\n== o casador de alvos ==');
  {
    const objs = [{ id: 1, siglaTipo: 'DTQ', numero: 3 }, { id: 2, siglaTipo: 'EMP', numero: 26 },
                  { id: 3, siglaTipo: 'EMP', numero: 27 }, { id: 4, siglaTipo: 'EMS', numero: 3626 }];
    const a = chamar('rsmAlvos', 'Votação do DTQ 3: Bloco UNIÃO (SD): Emenda de Plenário nº 26 (art. 161, II).', objs);
    ok(a.length === 2 && a[0].papel === 'destaque' && a[1].papel === 'emenda',
       'o destaque e a emenda destacada saem do mesmo texto');
    ok(a[0].prop.id === 1 && a[1].prop.id === 2, 'e apontam para as proposições certas');

    ok(chamar('rsmAlvos', 'Votação do DTQ 7: Bloco Fdr PT-PCdoB-PV: Emenda de Plenário 27 (art. 161, II).', objs)
       .some(x => x.prop.id === 3), 'número sem "nº" também casa');
    ok(chamar('rsmAlvos', 'Votação da Redação Final.', objs).length === 0,
       'texto que não cita destaque nem emenda não inventa alvo');
    ok(chamar('rsmAlvos', 'Votação do DTQ 99: coisa que não existe na lista.', objs).length === 0,
       'destaque citado mas ausente da lista não vira alvo — nada de casar por aproximação');
    // Emenda do Senado: a Câmara registra todas num documento só.
    ok(chamar('rsmAlvos', 'Votação do DTQ 17: PL (EMS): Destaque da Emenda do Senado Federal n. 3.', objs)
       .every(x => x.prop.siglaTipo !== 'EMS'), 'emenda do Senado não é apontada individualmente');
  }

  console.log('\n== o item: transcrição e fonte ==');
  {
    const objs = [{ id: 1, siglaTipo: 'DTQ', numero: 3, urlInteiroTeor: iT('dtq3') },
                  { id: 2, siglaTipo: 'EMP', numero: 26, urlInteiroTeor: iT('emp26') }];
    const r = await chamar('rsmDoItem', 'Votação do DTQ 3: Emenda de Plenário nº 26.', objs);
    ok(/destaque para Emenda de Plenário nº 26/.test(r.pedido.texto), 'o item traz o que o destaque pedia');
    ok(/vedar a participação/.test(r.justificacao.texto), 'e a justificação da emenda');
    ok(r.fontes.length === 2 && r.fontes.every(f => /mostrarintegra/.test(f.url)),
       'com o link dos dois documentos de origem — a transcrição é conferível');
    ok(r.falhou === false, 'e nada falhou');

    const htmlItem = chamar('rsmHtmlItem', r);
    ok(/Transcrito de/.test(htmlItem), 'na tela, o bloco diz que é transcrição');
    ok(/DTQ 3/.test(htmlItem) && /EMP 26/.test(htmlItem), 'e nomeia as duas fontes');
  }

  console.log('\n== leitura que falha não vira "documento sem justificação" ==');
  {
    api.derrubarPdf = ['emp26'];
    av('_rsmCache.clear()');
    const objs = [{ id: 2, siglaTipo: 'EMP', numero: 26, urlInteiroTeor: iT('emp26') }];
    const r = await chamar('rsmDoItem', 'Votação do DTQ 3: Emenda de Plenário nº 26.', objs);
    ok(r && r.falhou === true, 'a falha é registrada');
    ok(r.justificacao == null, 'e não se finge que o documento não tinha justificação');
    ok(/não pôde ser lido agora/.test(chamar('rsmHtmlItem', r)),
       'a tela diz que o que faltou foi a consulta, não o documento');
    api.derrubarPdf = null;
    av('_rsmCache.clear()');
  }

  console.log('\n== o cache não baixa o mesmo PDF duas vezes ==');
  {
    av('_rsmCache.clear()');
    api.chamadas.length = 0;
    const objs = [{ id: 2, siglaTipo: 'EMP', numero: 26, urlInteiroTeor: iT('emp26') }];
    await chamar('rsmDoItem', 'DTQ 3: Emenda de Plenário nº 26.', objs);
    await chamar('rsmDoItem', 'DTQ 4: Emenda de Plenário nº 26.', objs);
    const baixas = api.chamadas.filter(c => /codteor=emp26/.test(c)).length;
    ok(baixas === 1, `o mesmo documento é baixado uma vez só (${baixas})`);
  }

  console.log('\n== a matéria: indexação e justificação, quando existe ==');
  {
    const m1 = await chamar('rsmDaMateria',
      { keywords: 'aposta esportiva, loteria, Ministério da Fazenda', urlInteiroTeor: iT('pl3626') });
    ok(/aposta esportiva/.test(m1.palavras), 'as palavras-chave da indexação da Câmara entram');
    ok(m1.justificacao == null,
       'e o projeto sem justificação no inteiro teor não ganha uma — o PL 3.626/2023 é esse caso');

    const m2 = await chamar('rsmDaMateria', { keywords: '', urlInteiroTeor: iT('emp26') });
    ok(/vedar a participação/.test(m2.justificacao.texto), 'quando existe, a justificação do autor entra');
    ok(await chamar('rsmDaMateria', null) === null, 'sem proposição, não se monta resumo nenhum');
  }

  // ---------- a integração com a consulta ----------
  console.log('\n== objetosPossiveis: a ÚLTIMA votação do dia, não a primeira ==');
  {
    api.props['2374400'] = { id: 2374400, siglaTipo: 'PL', numero: 3626, ano: 2023,
                             ementa: 'Apostas de quota fixa.', keywords: 'aposta esportiva',
                             urlInteiroTeor: iT('pl3626') };
    api.votacoes['2374400'] = [
      { id: '2374400-23', data: '2023-09-13', dataHoraRegistro: '2023-09-13T18:18', siglaOrgao: 'PLEN', descricao: 'Rejeitado o Requerimento.' },
      { id: '2374400-46', data: '2023-09-13', dataHoraRegistro: '2023-09-13T19:57', siglaOrgao: 'PLEN', descricao: 'Rejeitada a Emenda de Plenário nº 26.' },
    ];
    api.tramitacoes = [
      { sequencia: 1, despacho: 'Votação do Requerimento do Dep. Gilson Marques, que solicita a retirada de pauta.' },
      { sequencia: 2, despacho: 'Rejeitado o Requerimento.' },
      { sequencia: 3, despacho: 'Votação do DTQ 3: Bloco UNIÃO (SD): Emenda de Plenário nº 26 (art. 161, II).' },
      { sequencia: 4, despacho: 'Rejeitada a Emenda de Plenário nº 26.' },
    ];
    api.votos = { '2374400-46': [{ deputado_: { id: 7 }, tipoVoto: 'Não' }] };
    api.orient = { '2374400-46': [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Não' }] };
    // O comportamento REAL: a lista cresce ao longo da sessão.
    api.objetosPorVotacao['2374400-23'] = [{ id: 9, siglaTipo: 'DTQ', numero: 1 }];
    api.objetosPorVotacao['2374400-46'] = [
      { id: 9, siglaTipo: 'DTQ', numero: 1 },
      { id: 1, siglaTipo: 'DTQ', numero: 3, urlInteiroTeor: iT('dtq3') },
      { id: 2, siglaTipo: 'EMP', numero: 26, urlInteiroTeor: iT('emp26') },
    ];

    av(`cv.deputado = { id: 7, nome: 'Fulana', partido: 'PODE', uf: 'SP' }`);
    document.getElementById('cvNumero').value = '3626';
    document.getElementById('cvAno').value = '2023';
    document.getElementById('cvResumos').checked = true;
    await av('cvConsultar()');

    const objs = av('cv.completo.objetosPossiveis');
    ok(objs.length === 3,
       `os objetos vêm da última votação do dia, que é a lista completa (${objs.length} de 3)`);
    ok(objs.some(o => o.siglaTipo === 'EMP' && o.numero === 26),
       'a emenda só aparece na lista da última votação — pela primeira, o resumo sumiria em silêncio');

    const r = av('cv.ultimo.resumos');
    ok(!!r, 'a consulta com a caixa marcada carrega os resumos');
    ok(/vedar a participação/.test(r.itens['2374400-46'].justificacao.texto),
       'e o item da emenda 26 traz a justificação do autor');
    ok(!r.itens['2374400-23'], 'o requerimento de retirada de pauta não tem destaque, e não ganha resumo');
    ok(/aposta esportiva/.test(r.materia.palavras), 'a matéria traz a indexação');
  }

  console.log('\n== na tela e no documento ==');
  {
    const tela = document.getElementById('cvResultado').innerHTML;
    ok(/Justificação:/.test(tela), 'a tela mostra a justificação literal');
    ok(/Transcrito de/.test(tela), 'dizendo de onde veio');

    const doc = av('cvHtmlPDF(null)');
    const plano = doc.replace(/\s+/g, ' ');
    ok(/Justificação:<\/b> A emenda tem como objetivo vedar/.test(plano),
       'o PDF leva a justificação junto do item');
    ok(/Requerimento:<\/b>/.test(plano), 'e o requerimento do destaque');
    ok(/Indexação da Câmara:<\/b> aposta esportiva/.test(plano), 'a indexação da matéria vai no consolidado');
    ok(/não são resumo redigido por este relatório/.test(plano),
       'e o documento declara que é transcrição literal — o que impede que o texto seja lido como nosso');
  }

  console.log('\n== a explicação em linguagem comum ==');
  {
    // A partir daqui há chave configurada e um provedor de mentira.
    api.ia = { chamadas: [], responder: null };
    av(`chrome.storage.local.get = (_k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' } })`);
    av(`chamarIA = async (args) => { globalThis.__ia = args; return { text: globalThis.__respostaIA }; }`);

    const base = { materia: { ementa: 'Dispõe sobre apostas.', palavras: 'aposta esportiva',
                              justificacao: { texto: 'A proposta regulamenta o setor.' } },
                   itens: { 'v1': { pedido: { texto: 'Nos termos do art. 161, II, destaque para a Emenda 26.' },
                                    justificacao: { texto: 'A emenda veda a participação de endividados.' },
                                    fontes: [], falhou: false } } };
    const objetos = { 'v1': 'Votação do DTQ 3: Emenda de Plenário nº 26 (art. 161, II).' };

    av(`globalThis.__respostaIA = ${JSON.stringify(JSON.stringify({
      materia: 'A proposta cria regras para apostas esportivas no Brasil.',
      itens: { v1: 'A emenda queria impedir que pessoas endividadas apostassem.' },
    }))}`);
    const r1 = await chamar('rsmExplicar', base, objetos);
    ok(r1.feito === true && r1.aplicados === 1, 'a explicação é gerada e aplicada ao item');
    ok(base.itens.v1.simples === 'A emenda queria impedir que pessoas endividadas apostassem.',
       'o item ganha a versão em linguagem comum');
    ok(base.materia.simples === 'A proposta cria regras para apostas esportivas no Brasil.',
       'e a matéria também');
    ok(base.gerado.modelo === 'modelo-de-teste', 'o modelo fica registrado, para o documento poder dizer qual foi');
    ok(base.itens.v1.justificacao.texto === 'A emenda veda a participação de endividados.',
       'e a transcrição literal continua intacta ao lado — a explicação não a substitui no estado');

    const prompt = av('globalThis.__ia.prompt');
    ok(/A emenda veda a participação de endividados/.test(prompt),
       'o modelo recebe a transcrição — ele reescreve o documento, não busca a matéria por fora');
    ok(/NÃO cite dispositivo regimental/.test(prompt), 'com a ordem de não citar dispositivo regimental');
    ok(/O documento não detalha o que a medida mudava/.test(prompt),
       'e com a fórmula obrigatória para quando o trecho não disser o que mudava');
    ok(/NÃO avalie mérito/.test(prompt), 'e a proibição de avaliar mérito ou atribuir intenção');
  }
  {
    // Id que o modelo invente não pode colar texto em item nenhum.
    const base = { materia: null, itens: {
      'v1': { pedido: { texto: 'Destaque para a Emenda 26 do projeto.' }, fontes: [], falhou: false } } };
    av(`globalThis.__respostaIA = ${JSON.stringify(JSON.stringify({
      materia: '', itens: { v1: 'Explicação certa.', 'v-inventado': 'Explicação de um item que não existe.' },
    }))}`);
    const r = await chamar('rsmExplicar', base, { 'v1': 'Votação do DTQ 3.' });
    ok(r.aplicados === 1, 'só o id conhecido recebe texto');
    ok(base.itens.v1.simples === 'Explicação certa.', 'e recebe o texto certo');
    ok(!base.itens['v-inventado'], 'o id inventado pelo modelo é descartado — colar no item errado seria pior que nada');
  }
  {
    // Resposta ilegível e erro de rede não podem virar explicação inventada.
    const base = { materia: null, itens: { 'v1': { pedido: { texto: 'Destaque para a Emenda 26.' }, fontes: [], falhou: false } } };
    av(`globalThis.__respostaIA = 'isto não é json'`);
    const r1 = await chamar('rsmExplicar', base, { 'v1': 'Votação do DTQ 3.' });
    ok(r1.feito === false && r1.motivo === 'resposta-ilegivel', 'resposta que não é JSON é recusada');
    ok(!base.itens.v1.simples, 'e o item fica sem explicação, não com uma inventada');

    av(`chamarIA = async () => { throw new Error('rede caiu'); }`);
    const r2 = await chamar('rsmExplicar', base, { 'v1': 'Votação do DTQ 3.' });
    ok(r2.feito === false && r2.motivo === 'erro', 'falha de rede é registrada como falha');
    ok(!base.itens.v1.simples, 'e continua sem explicação');
  }
  {
    // A cerca de código do modelo não pode derrubar a leitura.
    av(`chamarIA = async () => ({ text: '\u0060\u0060\u0060json\\n{"materia":"","itens":{"v1":"Com cerca."}}\\n\u0060\u0060\u0060' })`);
    const base = { materia: null, itens: { 'v1': { pedido: { texto: 'Destaque para a Emenda 26.' }, fontes: [], falhou: false } } };
    const r = await chamar('rsmExplicar', base, { 'v1': 'Votação do DTQ 3.' });
    ok(r.feito === true && base.itens.v1.simples === 'Com cerca.', 'JSON em cerca de código é lido do mesmo jeito');
  }
  {
    // Sem chave, a camada some e o relatório fica com a transcrição.
    av(`chrome.storage.local.get = (_k, cb) => cb({ config: {} })`);
    const base = { materia: null, itens: { 'v1': { pedido: { texto: 'Destaque para a Emenda 26.' }, fontes: [], falhou: false } } };
    const r = await chamar('rsmExplicar', base, { 'v1': 'Votação do DTQ 3.' });
    ok(r.feito === false && r.motivo === 'sem-chave',
       'sem chave de IA, a camada não roda — e diz por quê, em vez de falhar calada');
    ok(!base.itens.v1.simples, 'o item continua só com a transcrição, que é pior de ler e continua correta');
    av(`chrome.storage.local.get = (_k, cb) => cb({})`);
  }
  {
    // Na tela e no PDF, a explicação vem primeiro e o literal fica recolhido.
    const r = { simples: 'A emenda queria impedir que pessoas endividadas apostassem.',
                pedido: { texto: 'Nos termos do art. 161, II, destaque para a Emenda 26.' },
                justificacao: { texto: 'A emenda veda a participação de endividados.' },
                fontes: [{ papel: 'emenda', rotulo: 'EMP 26', url: 'https://x/emp26' }], falhou: false };
    const h = chamar('rsmHtmlItem', r);
    ok(h.indexOf('endividadas apostassem') < h.indexOf('art. 161'),
       'a linguagem comum vem antes do texto regimental');
    ok(/<details class="rsm-literal"><summary>texto literal do documento<\/summary>/.test(h),
       'e o literal fica recolhido, disponível para quem quiser conferir');
    ok(/O que o destaque fazia/.test(h), 'com o rótulo que responde à pergunta de quem lê');
  }

  console.log('\n== sem a caixa marcada, nada disso acontece ==');
  {
    document.getElementById('cvResumos').checked = false;
    api.chamadas.length = 0;
    await av('cvConsultar()');
    ok(av('cv.ultimo.resumos') == null, 'a consulta normal não carrega resumo');
    ok(!api.chamadas.some(c => /mostrarintegra/.test(c)), 'e não baixa PDF nenhum');
    ok(!/Transcrito de/.test(document.getElementById('cvResultado').innerHTML), 'nem mostra bloco de transcrição');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
