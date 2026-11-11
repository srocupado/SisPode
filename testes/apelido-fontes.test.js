// Apelido das matérias (extensão, bot e CCJC): de onde a IA tira o conteúdo, e o que acontece quando ele não está lá.
//
// Caso real (11/11/2026): PL 215/2015 apareceu como "Aumento de pena para crimes contra idosos". A ementa oficial
// só cita o dispositivo — "Acrescenta inciso V ao art. 141 do Decreto-Lei nº 2.848, de 7 de dezembro de 1940." —,
// a IA recebia só ela e tinha de adivinhar (o art. 141 do Código Penal é o do aumento de pena nos crimes contra a
// honra, e o inciso IV, o mais conhecido, é o da vítima idosa). O projeto pune crimes contra a honra nas redes
// sociais — é o que dizem a ementa detalhada e a indexação da Câmara (lidas da API em 11/11/2026).
//
// O que este teste trava:
//   1. o prompt é o MESMO nos três lugares (analise.js, ccjc.js, bot/src/convocacao.js);
//   2. ele leva a ementa detalhada, a indexação e o resumo da nota, proíbe deduzir pelo número do artigo e
//      permite responder SEM_INFORMACAO;
//   3. extensão: a ficha (ementa detalhada) é buscada quando falta; o objetivo da nota entra; SEM_INFORMACAO → '';
//      o apelido de reserva prefere a ementa detalhada;
//   4. bot: a ficha vem da API (lista + detalhe); SEM_INFORMACAO → o de reserva; REQ homônimo não escolhe;
//   5. CCJC: SEM_INFORMACAO → o de reserva, com nova chance na próxima vez.
// Uso: node testes/apelido-fontes.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const srcA = ler('analise.js'), srcC = ler('ccjc.js'), srcB = ler('bot/src/convocacao.js');
const pega = (src, re) => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const fn = (src, nome) => pega(src, new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const PL215 = {
  ementa: 'Acrescenta inciso V ao art. 141 do Decreto-Lei nº 2.848, de 7 de dezembro de 1940.',
  ementaDetalhada: 'Pune os crimes contra a honra praticados nas redes sociais.',
  indexacao: 'Alteração, Código Penal, crime contra a honra, aumento da pena, utilização, rede social, internet.',
};

(async () => {
  console.log('== 1. o mesmo prompt nos três lugares ==');
  const tA = fn(srcA, 'textoPromptApelido'), tC = fn(srcC, 'textoPromptApelido'), tB = fn(srcB, 'textoPromptApelido');
  ok(tA === tC && tA === tB, 'textoPromptApelido é idêntico em analise.js, ccjc.js e bot/src/convocacao.js');
  const reA = pega(srcA, /const APELIDO_SEM_INFORMACAO = [^\n]+/);
  ok(reA === pega(srcC, /const APELIDO_SEM_INFORMACAO = [^\n]+/) && reA === pega(srcB, /const APELIDO_SEM_INFORMACAO = [^\n]+/), 'e o reconhecimento de SEM_INFORMACAO também');

  console.log('\n== 2. o que o prompt leva ==');
  const textoPromptApelido = new Function(`${tA}; return textoPromptApelido;`)();
  const SEM = new Function(`${reA}; return APELIDO_SEM_INFORMACAO;`)();
  const p = textoPromptApelido('PL 215/2015', PL215);
  ok(p.includes(`Ementa oficial: "${PL215.ementa}"`) && p.includes(`Ementa detalhada (Câmara): "${PL215.ementaDetalhada}"`) && p.includes('Indexação (Câmara): "Alteração, Código Penal, crime contra a honra'),
    'PL 215/2015: vão a ementa oficial, a ementa detalhada e a indexação');
  ok(/NÃO deduza o conteúdo pelo número do artigo/.test(p) && /responda exatamente SEM_INFORMACAO/.test(p) && /Use SOMENTE as informações abaixo/.test(p),
    'proíbe deduzir pelo número do artigo e dá a saída SEM_INFORMACAO');
  const so = textoPromptApelido('PL 1/2026', { ementa: 'Altera a Lei nº 9.503, de 1997.' });
  ok(!/Ementa detalhada/.test(so) && !/Indexação/.test(so) && !/Resumo da matéria/.test(so), 'fonte vazia não entra (nada de "Ementa detalhada: \"\"")');
  ok(textoPromptApelido('PL 1/2026', { ementa: 'x', resumo: 'O projeto cria a política X.' }).includes('Resumo da matéria (nota técnica): "O projeto cria a política X."'), 'o resumo da nota entra quando há');
  ok(SEM.test('SEM_INFORMACAO') && SEM.test('sem informação') && SEM.test('SEM-INFORMACAO') && !SEM.test('Informação ao consumidor'), 'reconhece SEM_INFORMACAO nas grafias prováveis, sem pegar apelido de verdade');

  console.log('\n== 3. extensão (analise.js) ==');
  {
    const pedidos = [], prompts = [];
    let resposta = 'Pune crimes contra a honra nas redes sociais';
    const X = new Function('chamarIA', 'fetchJson', 'API_BASE', 'resolveProposicao', 'isAbortError', 'tipoLabel', 'notaTextoPlano', 'normalizarReferencias', `
      ${tA}
      ${reA}
      ${fn(srcA, '_alvoItem')}
      ${fn(srcA, 'promptApelido')}
      ${fn(srcA, 'objetivoDaNota')}
      ${fn(srcA, 'contextoApelido')}
      ${fn(srcA, 'gerarApelidoIA')}
      ${fn(srcA, 'apelidoFallback')}
      return { gerarApelidoIA, apelidoFallback, objetivoDaNota };`)(
      async ({ prompt }) => { prompts.push(prompt); return { text: resposta }; },
      async url => { pedidos.push(url); return { dados: { ementaDetalhada: PL215.ementaDetalhada, keywords: PL215.indexacao } }; },
      'https://api', async () => { throw new Error('não deveria: há o id'); }, () => false, s => s,
      it => it.analise.markdown, t => t);
    const it = { sigla: 'PL', numero: '215', ano: '2015', tipoCategoria: 'projeto', ementa: PL215.ementa, enriquecimento: { idProposicao: 946034 } };
    const ap = await X.gerarApelidoIA(it, {});
    ok(ap === resposta && pedidos.length === 1 && /\/proposicoes\/946034$/.test(pedidos[0]), 'sem a ementa detalhada no item, busca a ficha pelo id (uma vez)');
    ok(prompts[0].includes(PL215.ementaDetalhada) && prompts[0].includes('rede social'), 'e a IA recebe a ementa detalhada e a indexação');
    await X.gerarApelidoIA(it, {});
    ok(pedidos.length === 1, 'na segunda vez, a ficha já está no item: nenhum pedido');
    // o objetivo da nota
    const nota = '## Objetivo\n\nO Projeto de Lei nº 215 de 2015 visa combater crimes contra a honra praticados por meios digitais.\n\n## Justificativa\n\nTexto que não entra.';
    await X.gerarApelidoIA(it, {}, { nota });
    ok(prompts[2].includes('Resumo da matéria (nota técnica): "O Projeto de Lei nº 215 de 2015 visa combater crimes contra a honra praticados por meios digitais."') && !prompts[2].includes('Texto que não entra'),
      'ao gerar a nota, o "Objetivo" dela entra (e só ele)');
    ok(X.objetivoDaNota('Objetivo\nCria a política X.\nJustificativa\nPorque sim.') === 'Cria a política X.', 'nota em HTML convertida em texto (títulos sem ##): o objetivo também é achado');
    ok(X.objetivoDaNota('## Síntese\nalgo') === '', 'nota sem a seção Objetivo: nada (sem inventar resumo)');
    // SEM_INFORMACAO → ''
    resposta = 'SEM_INFORMACAO';
    const it2 = { sigla: 'PL', numero: '1', ano: '2026', tipoCategoria: 'projeto', ementa: 'Altera a Lei nº 9.503.', enriquecimento: { ementaDetalhada: '', indexacao: '' } };
    ok((await X.gerarApelidoIA(it2, {})) === '', 'a IA responde SEM_INFORMACAO: o apelido vem vazio (quem chama decide a reserva) — nada inventado');
    // reserva: a ementa detalhada primeiro
    ok(X.apelidoFallback({ sigla: 'PL', numero: '215', ano: '2015', ementa: PL215.ementa, enriquecimento: { ementaDetalhada: PL215.ementaDetalhada } }) === 'Pune os crimes contra a honra praticados nas redes sociais',
      'apelido de reserva: a ementa detalhada, quando há (antes: "Acrescenta inciso V ao art. 141 do Decreto-Lei…")');
    ok(X.apelidoFallback({ sigla: 'PL', numero: '1', ano: '2026', ementa: 'Institui o Dia X.', enriquecimento: {} }) === 'Institui o Dia X', 'sem ela, a ementa oficial, como antes');
    // requerimento: a ficha é a do projeto da urgência
    pedidos.length = 0; resposta = 'Apelido';
    const req = { sigla: 'REQ', numero: '9', ano: '2026', tipoCategoria: 'requerimento', ementa: 'Requer urgência.', projetoUrgenciado: { sigla: 'PL', numero: '215', ano: '2015', ementa: PL215.ementa }, enriquecimento: { idProposicao: 946034 } };
    await X.gerarApelidoIA(req, {});
    ok(prompts[prompts.length - 1].includes('proposição PL 215/2015') && prompts[prompts.length - 1].includes(PL215.ementaDetalhada), 'requerimento de urgência: o apelido é o do projeto, com a ficha dele');
    // os pontos que chamam
    ok(/\{ nota: markdown \}\);/.test(srcA), 'a geração da nota passa o texto recém-gerado');
    ok(/if \(!ap\) \{\s*mostrarToast\('A IA não achou o conteúdo da matéria nas fontes/.test(srcA), 'o botão de regerar avisa (em vez de "erro") quando as fontes não dizem o conteúdo');
    ok(/it\.apelido = \(await gerarApelidoIA\(it, cfg\)\) \|\| apelidoFallback\(it\);/.test(srcA), 'a lista de apelidos cai na reserva');
    ok(/ementaDetalhada: det\.dados\?\.ementaDetalhada \|\| '',/.test(srcA) && /it\.enriquecimento\.ementaDetalhada = prop\.ementaDetalhada;/.test(srcA), 'o enriquecimento já guarda a ementa detalhada e a indexação');
  }

  console.log('\n== 4. bot (convocação) ==');
  {
    const C = require(path.join(RAIZ, 'bot', 'src', 'convocacao.js'));
    const pedidos = [];
    let lista = [{ id: 946034, siglaTipo: 'PL', numero: 215, ano: 2015, ementa: PL215.ementa }];
    global.fetch = async url => {
      url = String(url); pedidos.push(url);
      const json = o => ({ ok: true, status: 200, json: async () => o });
      if (/firebaseio/.test(url)) return json(null);
      if (/\/proposicoes\?/.test(url)) return json({ dados: lista });
      if (/\/proposicoes\/946034$/.test(url)) return json({ dados: { ementaDetalhada: PL215.ementaDetalhada, keywords: PL215.indexacao } });
      if (/busca-api/.test(url)) return json({ hits: { hits: [] } });
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const f = await C.fichaDe({ sigla: 'PL', numero: '215', ano: '2015' });
    ok(f.ementa === PL215.ementa && f.ementaDetalhada === PL215.ementaDetalhada && /rede social/.test(f.indexacao), 'a ficha vem da API: lista + detalhe (só o detalhe traz a ementa detalhada)');
    ok(C.promptApelido({ sigla: 'PL', numero: '215', ano: '2015', ...PL215 }).includes(PL215.ementaDetalhada), 'o prompt do bot leva a ementa detalhada');
    lista = [{ id: 1, ementa: 'Requer sessão solene' }, { id: 2, ementa: 'Requer audiência' }];
    const fh = await C.fichaDe({ sigla: 'REQ', numero: '5', ano: '2026' });
    ok(!fh.ementa && !fh.ementaDetalhada, 'REQ com homônimos: não escolhe nenhum');
    // apelidoDoItem: sem IA, a reserva sai da ementa detalhada; com SEM_INFORMACAO, também
    lista = [{ id: 946034, siglaTipo: 'PL', numero: 215, ano: 2015, ementa: PL215.ementa }];
    const it = { sigla: 'PL', numero: '215', ano: '2015', ementa: PL215.ementa };
    ok((await C.apelidoDoItem(it, { perfil: null, pautaImportada: null })) === 'Pune os crimes contra a honra praticados nas redes sociais', 'sem IA: o apelido de reserva é a ementa detalhada');
    ok(!pedidos.some(u => /busca-api/.test(u)), 'com a ementa da pauta em mãos, não vai à busca do portal');
    // com IA: a resposta SEM_INFORMACAO cai na reserva; um apelido de verdade passa
    let respostaIA = 'SEM_INFORMACAO', promptIA = '';
    const fetch0 = global.fetch;
    global.fetch = async (url, init) => {
      if (/generativelanguage/.test(String(url))) {
        promptIA = JSON.parse(init.body).contents[0].parts[0].text;
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: respostaIA }] } }] }) };
      }
      return fetch0(url, init);
    };
    const perfil = { provedor: 'gemini', apiKey: 'k', modelo: '' };
    const it2 = { sigla: 'PL', numero: '215', ano: '2015', ementa: PL215.ementa };
    ok((await C.apelidoDoItem(it2, { perfil, pautaImportada: null })) === 'Pune os crimes contra a honra praticados nas redes sociais' && promptIA.includes(PL215.ementaDetalhada),
      'com IA e resposta SEM_INFORMACAO: fica o de reserva (a IA recebeu a ementa detalhada)');
    respostaIA = 'Crimes contra a honra nas redes sociais';
    const it3 = { sigla: 'PL', numero: '215', ano: '2015', ementa: PL215.ementa };
    ok((await C.apelidoDoItem(it3, { perfil, pautaImportada: null })) === respostaIA, 'com apelido de verdade, vale o da IA');
    global.fetch = fetch0;
  }

  console.log('\n== 5. CCJC ==');
  {
    const app = { config: { apiKey: 'k' } };
    let resposta = 'SEM_INFORMACAO';
    const K = new Function('app', 'aiCall', 'console', `
      ${tC}
      ${reA}
      ${fn(srcC, 'apelidoFallbackCCJC')}
      ${fn(srcC, 'promptApelidoCCJC')}
      ${fn(srcC, 'prepararApelidos')}
      return { prepararApelidos, promptApelidoCCJC };`)(app, async () => resposta, { warn() {} });
    const proj = { chave: 'PL 215/2015', ...PL215, resumoOriginal: 'Cria causa de aumento de pena para crimes contra a honra nas redes sociais.' };
    ok(K.promptApelidoCCJC(proj).includes(PL215.ementaDetalhada) && K.promptApelidoCCJC(proj).includes('Resumo da matéria (nota técnica): "Cria causa de aumento'), 'o prompt da CCJC leva a ementa detalhada e o resumo do texto original');
    const r = await K.prepararApelidos([proj]);
    ok(proj.apelido === 'Pune os crimes contra a honra praticados nas redes sociais' && proj.apelidoReserva === true && r.reserva === 1,
      'SEM_INFORMACAO: fica o de reserva (pela ementa detalhada), marcado para nova chance');
    resposta = 'Crimes contra a honra nas redes sociais';
    await K.prepararApelidos([proj]);
    ok(proj.apelido === resposta && proj.apelidoReserva === false, 'na próxima vez, com apelido de verdade, ele substitui o de reserva');
    ok(/ementaDetalhada: detalhe\.ementaDetalhada \|\| '',/.test(srcC) && /proj\.ementaDetalhada = dados\.ementaDetalhada \|\| '';/.test(srcC), 'a busca da proposição na CCJC guarda a ementa detalhada e a indexação');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
