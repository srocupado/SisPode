// Bot: /avulsa — nota técnica de proposição FORA da pauta, em PDF institucional sem índice (16/11/2026).
//
// O que este teste trava (o fluxo de ponta a ponta — worker real, Chromium com a extensão, PDF — foi
// conferido à parte, com escritas no Firebase bloqueadas; ver o README):
//   1. a entrada: link da Câmara (ficha, "propostas-legislativas", Dados Abertos), número em várias grafias,
//      link de outro site recusado;
//   2. o PDF da proposição: cabeçalho da Câmara (com "-A", "N.º"), PLP, PEC, MPV com data por extenso; PDF
//      do SENADO não é resolvido pela numeração (colidiria com outro PL da Câmara); citações de lei no
//      corpo não confundem;
//   3. a resolução na Câmara: por id e por número; não localizada e tipo sem nota técnica dão mensagem;
//   4. a extensão: a "pauta" avulsa nunca é gravada como pauta da equipe; a varredura de órfãs não apaga
//      nota registrada como avulsa e não apaga nada se o registro estiver ilegível; o PDF avulso sai sem
//      índice e sem número de ordem, com o título "Nota Técnica"; quem pede é o Responsável;
//   5. o worker só chama funções que existem no painel (a API implícita);
//   6. o bot: comando registrado, PDF da proposição desviado da importação de pauta, registro da avulsa
//      ANTES de gerar (senão uma varredura no meio apagaria a nota), uma geração por vez.
// Uso: node testes/bot-avulsa.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const A = require(path.join(RAIZ, 'bot', 'src', 'avulsa.js'));
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const ia = fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8');
const worker = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'worker.js'), 'utf8');
const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const fn = nome => trecho(new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const J = x => JSON.stringify(x);

(async () => {
  console.log('== 1. a entrada ==');
  ok(J(A.entradaDoTexto('https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2515534')) === J({ id: 2515534 }), 'link da ficha de tramitação');
  ok(J(A.entradaDoTexto('https://www.camara.leg.br/propostas-legislativas/2515534')) === J({ id: 2515534 }), 'link "propostas-legislativas"');
  ok(J(A.entradaDoTexto('https://dadosabertos.camara.leg.br/api/v2/proposicoes/2515534')) === J({ id: 2515534 }), 'link dos Dados Abertos');
  ok(J(A.entradaDoTexto('https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?x=1&idProposicao=2647427#topo')) === J({ id: 2647427 }), 'ficha com outros parâmetros');
  ok(A.entradaDoTexto('https://www25.senado.leg.br/web/atividade/materias/-/materia/123').linkDesconhecido, 'link de outro site: recusado com aviso');
  ok(J(A.entradaDoTexto('PL 1234/2025')) === J({ sigla: 'PL', numero: 1234, ano: 2025 }), '"PL 1234/2025"');
  ok(J(A.entradaDoTexto('plp 230/25')) === J({ sigla: 'PLP', numero: 230, ano: 2025 }), '"plp 230/25" (ano com dois dígitos)');
  ok(J(A.entradaDoTexto('PEC nº 45, de 2019')) === J({ sigla: 'PEC', numero: 45, ano: 2019 }), '"PEC nº 45, de 2019"');
  // pedido em texto livre ou por voz (19/11/2026): "Gerar uma nota avulsa do PLP 42 de 2023." caiu na nota da pauta
  ok(J(A.pedidoDeAvulsa('Gerar uma nota avulsa do PLP 42 de 2023.')) === J({ entrada: { sigla: 'PLP', numero: 42, ano: 2023 } }), 'voz: "Gerar uma nota avulsa do PLP 42 de 2023." é pedido de avulsa, com a proposição');
  ok(J(A.pedidoDeAvulsa('faz a avulsa do projeto de lei complementar número 42 de 2023')) === J({ entrada: { sigla: 'PLP', numero: 42, ano: 2023 } }), 'voz por extenso: "projeto de lei complementar número 42 de 2023"');
  ok(J(A.refDoTexto('proposta de emenda à constituição 45 de 2019')) === J({ sigla: 'PEC', numero: 45, ano: 2019 }) && J(A.refDoTexto('projeto de lei 1.234/2025')) === J({ sigla: 'PL', numero: 1234, ano: 2025 }), 'tipos por extenso: PEC e PL');
  ok(J(A.pedidoDeAvulsa('quero uma nota avulsa')) === J({ entrada: null }), '"quero uma nota avulsa" sem proposição: é pedido, o bot pergunta qual');
  ok(A.pedidoDeAvulsa('qual a nota do PL 1234/2025?') === null && A.pedidoDeAvulsa('a pauta avulsa de hoje já saiu?') === null && A.pedidoDeAvulsa('anote: instruções avulsas do líder') === null, 'sem "avulsa", ou "avulsa" de outra coisa, não é pedido');
  ok(/const avulsa = pedidoDeAvulsa\(texto\);\s*if \(avulsa\) return cmdAvulsa\(ctx, avulsa\);/.test(idx) && idx.indexOf('const avulsa = pedidoDeAvulsa(texto)') < idx.indexOf('await conversar({ userId: ctx.from.id, perfil, texto'), 'o pedido de avulsa é atendido pelo código, antes da conversa com a IA');
  ok(/case 'nota_avulsa':\s+return cmdAvulsa\(/.test(idx) && /'nota_avulsa'/.test(fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'agente.js'), 'utf8')), 'a IA também tem a ação nota_avulsa');
  ok(/não está na pauta em uso\/\.test\(r\.erro\)/.test(idx) && /avq:\$\{ref\.sigla\}:\$\{ref\.numero\}:\$\{ref\.ano\}/.test(idx) && /bot\.callbackQuery\(\/\^avq:/.test(idx), 'nota pedida de proposição fora da pauta: o bot oferece o botão da nota avulsa');
  ok(J(A.entradaDoTexto('PL 2.475/2025')) === J({ sigla: 'PL', numero: 2475, ano: 2025 }), 'número com ponto de milhar');
  ok(A.entradaDoTexto('') === null && A.entradaDoTexto('qualquer coisa') === null, 'sem referência: nada');

  console.log('\n== 2. o PDF da proposição ==');
  const cabCamara = 'CÂMARA DOS DEPUTADOS PROJETO DE LEI N.º 2.475-A, DE 2025 (Do Sr. Célio Studart e outros) Altera a Lei nº 8.072, de 25 de julho de 1990 (Lei dos Crimes Hediondos)';
  ok(J(A.refDoPdf(cabCamara)) === J({ sigla: 'PL', numero: 2475, ano: 2025 }), 'avulso da Câmara: "PROJETO DE LEI N.º 2.475-A, DE 2025" (a Lei 8.072 citada não confunde)');
  ok(J(A.refDoPdf('CÂMARA DOS DEPUTADOS PROJETO DE LEI COMPLEMENTAR Nº 12, DE 2026 Altera a Lei Complementar nº 101')) === J({ sigla: 'PLP', numero: 12, ano: 2026 }), 'PLP');
  ok(J(A.refDoPdf('PROPOSTA DE EMENDA À CONSTITUIÇÃO Nº 45, DE 2019 Altera o Sistema Tributário')) === J({ sigla: 'PEC', numero: 45, ano: 2019 }), 'PEC');
  ok(J(A.refDoPdf('Presidência da República MEDIDA PROVISÓRIA Nº 1.303, DE 11 DE JUNHO DE 2025 Dispõe sobre')) === J({ sigla: 'MPV', numero: 1303, ano: 2025 }), 'MPV com a data por extenso');
  ok(A.refDoPdf('SENADO FEDERAL PROJETO DE LEI Nº 2338, DE 2023 Dispõe sobre o uso da Inteligência Artificial').senado === true, 'PDF do Senado: não resolve pela numeração (PL do Senado ≠ PL da Câmara)');
  ok(A.refDoPdf('Minuta de anteprojeto, sem número. Art. 1º Fica criado…') === null, 'texto sem número: nada (o bot pede o número ou o link)');

  console.log('\n== 3. resolução na Câmara ==');
  const respostas = {
    'proposicoes/2515534': { dados: { id: 2515534, siglaTipo: 'PL', numero: 2475, ano: 2025, ementa: 'Altera a Lei  nº 8.072…' } },
    'siglaTipo=PL&numero=2475&ano=2025': { dados: [{ id: 2515534 }] },
    'siglaTipo=PL&numero=9999&ano=2025': { dados: [] },
    'proposicoes/111': { dados: { id: 111, siglaTipo: 'REQ', numero: 10, ano: 2026, ementa: 'Requer…' } },
  };
  const falso = async url => {
    const k = Object.keys(respostas).find(x => url.includes(x));
    return { ok: !!k, status: k ? 200 : 404, json: async () => respostas[k] };
  };
  ok(J(await A.resolverProposicao({ id: 2515534 }, falso)) === J({ id: 2515534, sigla: 'PL', numero: 2475, ano: 2025, ementa: 'Altera a Lei nº 8.072…' }), 'por id (link)');
  ok((await A.resolverProposicao({ sigla: 'PL', numero: 2475, ano: 2025 }, falso)).id === 2515534, 'por número');
  const erro = async p => { try { await p; return ''; } catch (e) { return e.message; } };
  ok(/não encontrei PL 9999\/2025/.test(await erro(A.resolverProposicao({ sigla: 'PL', numero: 9999, ano: 2025 }, falso))), 'não localizada: mensagem clara');
  ok(/não é um tipo com nota técnica/.test(await erro(A.resolverProposicao({ id: 111 }, falso))), 'REQ: recusado (a nota avulsa é de proposição)');
  // API da Câmara fora do ar (16/11/2026: 504 em ~16 s em toda consulta): nova tentativa, depois mensagem clara
  let n504 = 0;
  const fora = async () => { n504++; return { ok: false, status: 504, json: async () => ({}) }; };
  const msg504 = await erro(A.resolverProposicao({ sigla: 'PL', numero: 4675, ano: 2025 }, fora, { esperaMs: 0 }));
  ok(/API da Câmara não está respondendo agora \(HTTP 504\)/.test(msg504) && n504 === 2, 'Câmara com 504: tenta 2 vezes e diz que é instabilidade da Câmara');
  let nPend = 0;
  const pendura = async (url, o) => { nPend++; return new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason))); };
  const vivo = setInterval(() => {}, 1000);   // o timer do AbortSignal.timeout não segura o processo (no bot, o polling segura)
  const msgPend = await erro(A.resolverProposicao({ id: 1 }, pendura, { esperaMs: 0, prazoMs: 50 }));
  clearInterval(vivo);
  ok(/API da Câmara não está respondendo agora \(sem resposta em/.test(msgPend) && nPend === 2, 'conexão pendurada: corta no prazo (não fica calado)');
  let nOk = 0;
  const volta = async url => (++nOk === 1 ? { ok: false, status: 502, json: async () => ({}) } : falso(url));
  ok((await A.resolverProposicao({ id: 2515534 }, volta, { esperaMs: 0 })).id === 2515534, 'falha passageira: a 2ª tentativa resolve');
  let n404 = 0;
  const nao = async () => { n404++; return { ok: false, status: 404, json: async () => ({}) }; };
  ok(/não encontrei essa proposição/.test(await erro(A.resolverProposicao({ id: 9 }, nao, { esperaMs: 0 }))) && n404 === 1, '404 é "não existe": sem repetir');
  ok(/🔎 Procurando \$\{alvo\} na Câmara/.test(idx) && idx.indexOf('🔎 Procurando') < idx.indexOf('await resolverProposicao(entrada)'),
    'o bot responde ANTES de consultar a Câmara (o servidor sabe que o pedido chegou)');
  // nota que a equipe já tem: avisada ANTES da confirmação (pedido de 16/11/2026)
  const ex = A.resumoNotasExistentes({
    'inteiro-teor': { markdown: '## Nota antiga', geradoEm: '2026-03-01T10:00:00Z', geradoPor: 'Ana' },
    'parecer-2026-04-22': { markdown: '## Nota', geradoEm: '2026-11-04T12:00:00Z', editadoEm: '2026-11-05T09:00:00Z', geradoPor: 'Pedro', verificacaoIA: { itens: [] } },
    'parecer-2026-05-01': { markdown: '', manual: true, geradoEm: '2026-11-10T00:00:00Z' },
  });
  ok(ex && ex.n === 2 && ex.base === 'parecer de 22/04/2026' && ex.quando === '05/11/2026' && ex.por === 'Pedro' && ex.verificada,
    'nota existente: a mais recente com texto (esqueleto vazio não conta), com parecer, data, autor e verificação');
  ok(A.resumoNotasExistentes(null) === null && A.resumoNotasExistentes({ x: { markdown: '  ' } }) === null, 'sem nota com texto: null');
  ok(A.resumoNotasExistentes({ 'inteiro-teor': { markdown: 'x', verificacaoIA: { falhou: 'HTTP 503' } } }).verificada === false, 'verificação que falhou não conta como verificada');
  ok(idx.indexOf("fbGet(`/analises_pauta/${chaveProp(prop)}`)") > 0 && idx.indexOf("fbGet(`/analises_pauta/${chaveProp(prop)}`)") < idx.indexOf("av:ok:${token}"),
    'o bot consulta a nota existente antes de oferecer os botões');
  ok(A.chaveProp({ sigla: 'PL', numero: 2475, ano: 2025 }) === 'PL-2475-2025' && /chave: it\.chave \|\| `\$\{it\.sigla\}-\$\{it\.numero\}-\$\{it\.ano\}`/.test(fn('normalizarItem')),
    'a chave do registro de avulsa é a mesma da nota no painel (SIGLA-numero-ano)');

  console.log('\n== 4. a extensão ==');
  // pauta avulsa não vai para o Firebase
  let chamadas = 0;
  const salvar = new Function('_fbSalvarPautaExec', 'state', `let _pautaSaveEmVoo = null; ${fn('fbSalvarPauta')}; return fbSalvarPauta;`)(async () => { chamadas++; }, {});
  await salvar({ origem: 'avulsa', itens: [] });
  ok(chamadas === 0, 'fbSalvarPauta ignora a "pauta" avulsa');
  await salvar({ id: 'x', itens: [] }).catch(() => {});
  ok(chamadas === 1, '…e salva as demais como sempre');
  // varredura de órfãs
  const varrer = (dados) => {
    const apagadas = [];
    const f = new Function('FIREBASE_URL', 'fetch', 'document', 'console', `${fn('varrerAnalisesOrfas')}; return varrerAnalisesOrfas;`)(
      'https://fb', async (url, init = {}) => {
        if ((init.method || 'GET') === 'DELETE') { apagadas.push(decodeURIComponent(url.match(/analises_pauta\/([^.]+)\.json/)[1])); return { ok: true }; }
        const k = Object.keys(dados).find(x => url.includes(x));
        const v = dados[k];
        return v === 'falha' ? { ok: false, json: async () => null } : { ok: true, json: async () => v };
      }, { getElementById: () => null }, { warn() {}, log() {} });
    return f(false).then(r => ({ r, apagadas }));
  };
  const base = {
    '/pautas.json': { p1: { itens: [{ chave: 'PL-1-2026' }, { chave: 'PL-2-2026' }] } },
    '/analises_pauta.json': { 'PL-1-2026': true, 'PL-2-2026': true, 'PL-5542-2026': true, 'PL-777-2020': true },
  };
  const r1 = await varrer({ ...base, '/analises_avulsas.json': { 'PL-5542-2026': true } });
  ok(J(r1.apagadas) === J(['PL-777-2020']), `nota avulsa registrada não é órfã; a órfã de verdade sai (${J(r1.apagadas)})`);
  const r2 = await varrer({ ...base, '/analises_avulsas.json': 'falha' });
  ok(r2.apagadas.length === 0 && r2.r.abortado, 'registro de avulsas ilegível: a varredura não apaga nada');
  // o PDF avulso
  const html = fn('_htmlImpressaoPautaPlenario');
  ok(/const num = \(it, i\) => \(avulsa \? '' :/.test(html) && /const indice = itens\.length && !avulsa \?/.test(html) && /\$\{avulsa \? 'Nota Técnica' : 'Pauta de Plenário'\}/.test(html),
    'PDF avulso: sem índice, sem número de ordem, título "Nota Técnica" (o resto do documento institucional igual)');
  const abrir = fn('abrirItemAvulso');
  ok(/origem: 'avulsa'/.test(abrir) && /analista: solicitante \|\| ''/.test(abrir) && /tipoCategoria: 'projeto'/.test(abrir), 'item avulso: pauta marcada como avulsa, quem pede é o Responsável');

  console.log('\n== 5. o worker só chama o que existe no painel ==');
  const lista = worker.match(/const FUNCOES_PAINEL = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
  const faltam = lista.filter(n => !new RegExp(`(?:^|\\n)(?:async )?function ${n}\\(`).test(src + '\n' + ia));
  ok(lista.includes('abrirItemAvulso') && lista.includes('verificarAtualizacaoItem') && !faltam.length, `FUNCOES_PAINEL: ${lista.length} funções, todas no painel${faltam.length ? ' — faltam: ' + faltam : ''}`);
  ok(/verificarAtualizacaoItem\(window\.__avIt\)[\s\S]{0,300}gerarAnaliseItem\(it, true\)/.test(worker), 'nota da equipe aproveitada é conferida contra a fonte; superada → gerada de novo');

  console.log('\n== 6. o bot ==');
  ok(/bot\.command\('avulsa', ctx => cmdAvulsa\(ctx\)\)/.test(idx) && /\{ command: 'avulsa'/.test(idx) && /\/avulsa PL 1234\/2025 — nota técnica de proposição FORA da pauta/.test(idx), 'comando registrado, no menu e na ajuda');
  const doc = idx.slice(idx.indexOf("bot.on('message:document'"));
  ok(doc.indexOf('if (paraAvulsa)') > 0 && doc.indexOf('if (paraAvulsa)') < doc.indexOf('parsearPauta(texto)'), 'PDF da proposição (depois de /avulsa ou com a legenda "avulsa") não vira importação de pauta');
  const cb = idx.slice(idx.indexOf("bot.callbackQuery(/^av:(ok|nova|no)"));
  ok(cb.indexOf('fbPut(`/analises_avulsas/') > 0 && cb.indexOf('fbPut(`/analises_avulsas/') < cb.indexOf('await notaAvulsa('), 'registro da avulsa ANTES de gerar');
  ok(/_workerOcupado = true;   \/\/ antes de qualquer await/.test(cb) && /finally \{\s*_workerOcupado = false;/.test(cb), 'uma geração por vez (a mesma trava do /analisar e do /exportar)');
  ok(/forcar: acao === 'nova'/.test(cb), '"Gerar nova" ignora a nota salva');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO FATAL:', e); process.exit(1); });
