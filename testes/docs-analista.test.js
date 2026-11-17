// Documento próprio do(a) analista (docs-analista.js + ligação em analise.js / analise.html).
//
// Nasceu do PLP 299/2026 (17/11/2026): estava na pauta da Câmara, ainda em votação no Senado, e o item
// ficava com "Documento não disponível na API", sem saída. O(a) analista agora anexa o PDF ou o link e
// gera a nota ou o Parecer de Especialista sobre ele, ou escreve a nota à mão.
//
// Três blocos: (1) a lógica sem tela; (2) a ligação no painel, lida do código; (3) o diálogo de verdade,
// no Chromium, com o gerador trocado por um espião. Nenhuma chamada de IA nem escrita no Firebase.
//
// Uso: node testes/docs-analista.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const D = require(path.join(RAIZ, 'docs-analista.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const pdf = (texto = 'x') => new TextEncoder().encode('%PDF-1.4\n' + texto).buffer;

(async () => {
  console.log('== 1. lógica ==');
  ok(D.docanEhPdf(pdf()) && !D.docanEhPdf(new TextEncoder().encode('<html>erro 404</html>').buffer) && !D.docanEhPdf(new ArrayBuffer(0)), 'PDF é reconhecido pelos primeiros bytes; página de erro e arquivo vazio, não');
  ok(D.docanLinkValido('https://legis.senado.leg.br/sdleg-getter/documento/abc') && !D.docanLinkValido('http://x.com/a.pdf') && !D.docanLinkValido('legis.senado.leg.br/doc') && !D.docanLinkValido(''), 'link tem de ser completo e https');
  let r = D.docanMontar([]);
  ok(!r.docs.length && /Anexe ao menos um PDF/.test(r.erros[0]), 'sem documento: erro claro');
  r = D.docanMontar([{ origem: 'arquivo', nome: 'emendas.pdf', buffer: pdf(), tipo: 'apoio' }]);
  ok(!r.docs.length && /Texto em votação/.test(r.erros.join(' ')), 'só documento de apoio: pede o texto principal');
  r = D.docanMontar([{ origem: 'arquivo', nome: 'nota.docx', buffer: new TextEncoder().encode('PK\u0003\u0004word').buffer, tipo: 'texto' }]);
  ok(!r.docs.length && /não é um PDF/.test(r.erros[0]), 'arquivo que não é PDF: recusado com orientação');
  r = D.docanMontar([{ origem: 'link', url: 'ftp://x/y', tipo: 'texto' }]);
  ok(!r.docs.length && /Link inválido/.test(r.erros[0]), 'link inválido: recusado');
  r = D.docanMontar([
    { origem: 'arquivo', nome: 'emendas.pdf', buffer: pdf('e'), tipo: 'apoio', descricao: 'emendas de Plenário do Senado' },
    { origem: 'link', url: 'https://legis.senado.leg.br/sdleg-getter/documento/38df22dd', tipo: 'texto', descricao: 'substitutivo em votação no Senado' },
    { origem: 'arquivo', nome: 'parecer.pdf', buffer: pdf('p'), tipo: 'parecer' },
  ]);
  ok(!r.erros.length && r.docs.length === 3 && r.docs[0].tipo === 'INTEIRO_TEOR' && r.docs[1].tipo === 'PRLP' && r.docs[2].tipo === 'DOC_ANALISTA', 'três documentos válidos; o texto principal vai à frente e o de apoio, ao fim');
  ok(r.docs[0].rotulo === 'Texto em votação — substitutivo em votação no Senado (fornecido pelo(a) analista)' && r.docs[0].url.startsWith('https://legis.senado') && !r.docs[0].arquivo
    && r.docs[1].rotulo === 'Parecer do relator — parecer.pdf (fornecido pelo(a) analista)' && r.docs[1].arquivo === 'parecer.pdf' && r.docs.every(d => d.doAnalista), 'rótulo diz o que é o documento e que veio do(a) analista; arquivo guarda o nome, link guarda o endereço');
  const meta = D.docanMetadados(r.docs);
  ok(meta.every(m => !('buffer' in m)) && meta[1].arquivo === 'parecer.pdf' && meta[0].url && meta[0].doAnalista && JSON.stringify(meta).length < 900, 'o que vai para a análise gravada não leva os bytes do arquivo');
  const juntos = D.docanJuntar(r.docs, [{ tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor (Câmara)', url: 'https://www.camara.leg.br/x' }, { tipo: 'SBT_A', rotulo: 'Substitutivo da comissão', url: 'https://www.camara.leg.br/y' }]);
  ok(juntos.length === 4 && !juntos.some(d => d.rotulo === 'Inteiro teor (Câmara)') && juntos.some(d => d.tipo === 'SBT_A'), 'somar aos da Câmara: o texto do(a) analista prevalece sobre o de mesmo papel; os demais entram');
  ok(D.docanCenario(r.docs) === 'Documento fornecido pelo(a) analista' && D.docanCenario(juntos) === 'Documento fornecido pelo(a) analista + documentos da Câmara', 'o cenário da nota diz de onde veio o documento');
  const ins = D.docanInstrucao(r.docs, { naCamara: false, identificacao: 'PLP 299/2026' });
  ok(/não foram baixados do sistema da Câmara/.test(ins) && /PLP 299\/2026 ainda não consta do sistema da Câmara/.test(ins) && /em que documento ela se baseia/.test(ins) && /texto ainda pode mudar/.test(ins) && /substitutivo em votação no Senado/.test(ins), 'instrução ao modelo: origem dos documentos, matéria fora da Câmara, declarar a base e avisar se o texto ainda pode mudar');
  ok(!/ainda não consta do sistema/.test(D.docanInstrucao(r.docs, { naCamara: true })) && D.docanInstrucao([{ tipo: 'PRLP', rotulo: 'x' }]) === '', 'matéria que já está na Câmara não recebe o aviso; sem documento do(a) analista, sem instrução');
  ok(D.docanSoLinks([{ doAnalista: true, url: 'https://a/b' }, { url: 'https://camara' }]) && !D.docanSoLinks(meta) && !D.docanSoLinks([{ url: 'https://camara' }]), 'só análise feita com links pode ser regerada sem anexar de novo');

  console.log('\n== 2. ligação no painel ==');
  const js = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8'), html = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8');
  ok(html.indexOf('<script src="docs-analista.js"></script>') > 0 && html.indexOf('<script src="docs-analista.js"></script>') < html.indexOf('<script src="analise.js"></script>'), 'analise.html carrega docs-analista.js antes de analise.js');
  ok(/id="modal-doc-analista"/.test(html) && /id="docan-arquivos"[^>]*accept="application\/pdf,\.pdf" multiple/.test(html) && /id="btn-docan-gerar"/.test(html) && /id="btn-docan-parecer"/.test(html) && /id="btn-docan-livre"/.test(html) && /id="docan-somar"/.test(html), 'diálogo: arquivos, link, somar aos da Câmara e as três ações (nota, parecer, escrever à mão)');
  ok(/data-role="btn-doc-proprio"/.test(js) && /querySelector\('\[data-role=btn-doc-proprio\]'\)\.addEventListener\('click', \(\) => abrirDocAnalista\(it\)\)/.test(js), 'cada item tem o botão "Documento próprio"');
  ok(!/não disponível na API/.test(js) && /e\.semDocumento = true/.test(js) && /data-role="btn-semdoc-anexar"/.test(js) && /data-role="btn-semdoc-livre"/.test(js), 'sem documento na Câmara: em vez do erro seco, as duas saídas (anexar ou escrever)');
  ok(/const docs = opts\.docsAnalista \? await documentosComAnalista\(/.test(js) && /if \(opts\.docsAnalista\) forcar = true;/.test(js) && /docanInstrucao\(docs, \{ naCamara: !!it\.enriquecimento\?\.idProposicao/.test(js), 'a geração usa os documentos do(a) analista, ignora o cache e avisa o modelo da origem');
  ok(/documentos:\s+comAnalista \? docanMetadados\(docs\)/.test(js) && /docsDoAnalista: true/.test(js) && /cenario:\s+comAnalista \? docanCenario\(docs\)/.test(js), 'a análise gravada registra os documentos (sem bytes), a origem e o cenário');
  ok((js.match(/const pdfBuffers = await baixarDocumentos\(docs\);/g) || []).length === 2 && /d\.buffer \? Promise\.resolve\(d\.buffer\.slice\(0\)\) : baixarPdf\(d\.url\)/.test(js), 'gerar e completar usam o arquivo em memória (cópia), sem tentar baixar o que não tem link');
  ok(/const proprios = docsProprios\(it\);\s+const docsMeta = proprios \? await documentosComAnalista\(it, proprios\) : await escolherDocumentos\(it\);/.test(js) && /buffer: d\.buffer \? d\.buffer\.slice\(0\) : await baixarPdf\(d\.url\)/.test(js), 'o Parecer de Especialista usa os documentos do(a) analista quando existem');
  ok(/abrirDocAnalista\(it, 'A Câmara ainda não tem documento desta matéria\. Anexe o texto/.test(js), 'Parecer de Especialista sem documento: abre o diálogo para anexar, em vez de só avisar');
  ok(/if \(outro\.analise\.docsDoAnalista\) continue;/.test(js) && (js.match(/\|\| it\.analise\.docsDoAnalista\) return null;/g) || []).length === 2 && /!it\.analise\.manual && !it\.analise\.docsDoAnalista\) \? 'inline-flex'/.test(js), 'análise com documento próprio não é replicada em outro item nem entra na verificação de atualização da Câmara');
  ok(/async function iniciarAnaliseLivre\(it, cenario\)/.test(js) && /cenario \|\| \(ehMPV\(it\) \? CENARIO_MPV : DOCAN_CENARIO_LIVRE\)/.test(js) && /function iniciarAnaliseLivreMPV\(it\) \{ return iniciarAnaliseLivre\(it, CENARIO_MPV\); \}/.test(js), 'edição livre vale para qualquer item; a da MPV continua com o rótulo do Cenário 8');
  ok(/const _docsAnalista = new Map\(\);/.test(js) && !/fbSalvar[A-Za-z]*\([^)]*_docsAnalista/.test(js) && !/it\.docsAnalista\s*=/.test(js), 'os arquivos ficam só na memória da aba: nada de gravá-los no item nem no Firebase');
  const H = require(path.join(RAIZ, 'pe5-html.js'));
  const semCamara = H.htmlParecerPE5({ versao: 5, doc: { abertura: { frase: 'x' } }, coleta: null, pesquisa: {} }, {});
  ok(/não tinha registro de tramitação desta matéria/.test(semCamara) && !/<b>Regime\.<\/b>/.test(semCamara), 'Parecer de Especialista de matéria fora da Câmara: o quadro político diz que não há registro, sem linhas vazias');

  console.log('\n== 3. o diálogo, no navegador ==');
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { console.log('  (playwright indisponível: bloco 3 não executado)'); }
  if (chromium) {
    const bloco = js.slice(js.indexOf('//  DOCUMENTO PRÓPRIO: o(a) analista entrega'), js.indexOf('//  GERAÇÃO DE ANÁLISE VIA IA'));
    const modal = html.slice(html.indexOf('<div id="modal-doc-analista"'), html.indexOf('<!-- ===== MODAL: COLISÃO DE PAUTA'));
    const b = await chromium.launch(); const pg = await b.newPage();
    await pg.route('**/*', rt => rt.abort());                    // nada sai para a rede
    await pg.setContent(`<html><body><div class="an-card" data-chave="PLP-299-2026"><button data-role="btn-doc-proprio">📎 Documento próprio</button></div>${modal}</body></html>`);
    await pg.addScriptTag({ content: fs.readFileSync(path.join(RAIZ, 'docs-analista.js'), 'utf8') });
    await pg.addScriptTag({ content: `
      window.chamadas = []; window.confirm = () => true;
      const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const tipoLabel = s => s, isAbortError = () => false, mostrarToast = (m) => window.chamadas.push(['toast', m]);
      const pdfFalso = t => new TextEncoder().encode('%PDF-1.4 ' + t).buffer;
      async function baixarPdf(url) { window.chamadas.push(['baixar', url]); if (/quebrado/.test(url)) throw new Error('HTTP 404'); return /html/.test(url) ? new TextEncoder().encode('<html>').buffer : pdfFalso(url); }
      async function escolherDocumentos(it) { return [{ tipo: 'SBT_A', rotulo: 'Substitutivo (Câmara)', url: 'https://www.camara.leg.br/sbt' }]; }
      async function gerarAnaliseItem(it, forcar, opts) { window.chamadas.push(['nota', forcar, opts.docsAnalista.map(d => d.rotulo), opts.somarCamara, opts.docsAnalista.every(d => d.buffer && d.buffer.byteLength > 0)]); }
      async function gerarParecerEspecialista(it) { const g = docsProprios(it); window.chamadas.push(['parecer', g.docs.length, (await documentosComAnalista(it, g)).map(d => d.tipo)]); }
      function entrarEdicaoAnalise(it) { window.chamadas.push(['editar']); }
      async function iniciarAnaliseLivre(it) { window.chamadas.push(['livre']); }
      //${bloco}
      window.it = { chave: 'PLP-299-2026', sigla: 'PLP', numero: '299', ano: '2026', ordem: 12, analise: null };
      document.getElementById('docan-arquivos').addEventListener('change', onDocanArquivos);
      document.getElementById('btn-docan-add-link').addEventListener('click', onDocanAddLink);
      document.getElementById('btn-docan-gerar').addEventListener('click', () => confirmarDocAnalista('nota'));
      document.getElementById('btn-docan-parecer').addEventListener('click', () => confirmarDocAnalista('parecer'));
      document.getElementById('btn-docan-livre').addEventListener('click', () => confirmarDocAnalista('livre'));
      window.abrir = aviso => abrirDocAnalista(window.it, aviso);
      window.proprios = () => { const g = docsProprios(window.it); return g ? { n: g.docs.length, somar: g.somarCamara, links: g.docs.map(d => d.url) } : null; };
    ` });
    const txt = sel => pg.$eval(sel, e => e.textContent.trim());
    const visivel = () => pg.$eval('#modal-doc-analista', e => e.style.display !== 'none');

    await pg.evaluate(() => window.abrir(''));
    ok(await visivel() && /PLP 299\/2026 — item 12/.test(await txt('#docan-alvo')) && /Nenhum documento adicionado/.test(await txt('#docan-lista')), 'o diálogo abre com o item e a lista vazia');
    await pg.click('#btn-docan-gerar');
    ok(await visivel() && /Anexe ao menos um PDF/.test(await txt('#docan-status')), 'gerar sem documento: o diálogo fica aberto e diz o que falta');

    await pg.setInputFiles('#docan-arquivos', [
      { name: 'substitutivo-senado.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 texto do substitutivo') },
      { name: 'emendas.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 emendas') },
    ]);
    await pg.waitForFunction(() => document.querySelectorAll('[data-docan-tipo]').length === 2);
    const tipos = await pg.$$eval('[data-docan-tipo]', els => els.map(e => e.value));
    ok(tipos.join() === 'texto,apoio', 'o primeiro arquivo entra como texto em votação e o segundo como apoio; o(a) analista pode trocar');
    await pg.fill('[data-docan-desc="0"]', 'substitutivo em votação no Senado');
    await pg.fill('#docan-link', 'senado.leg.br/doc'); await pg.click('#btn-docan-add-link');
    ok(/começando por https/.test(await txt('#docan-status')), 'link incompleto: recusado na hora');
    await pg.fill('#docan-link', 'https://legis.senado.leg.br/html-nao-pdf'); await pg.click('#btn-docan-add-link');
    await pg.click('#btn-docan-gerar');
    await pg.waitForFunction(() => /não devolveu um PDF/.test(document.getElementById('docan-status').textContent));
    ok(await visivel() && !(await pg.evaluate(() => window.chamadas.some(c => c[0] === 'nota'))), 'link que não devolve PDF: erro no diálogo, antes de gastar chamada de IA');
    await pg.click('[data-docan-rem="2"]');
    await pg.fill('#docan-link', 'https://legis.senado.leg.br/sdleg-getter/documento/parecer-221'); await pg.click('#btn-docan-add-link');
    await pg.selectOption('[data-docan-tipo="2"]', 'parecer');
    await pg.check('#docan-somar');
    await pg.click('#btn-docan-gerar');
    await pg.waitForFunction(() => window.chamadas.some(c => c[0] === 'nota'));
    const nota = await pg.evaluate(() => window.chamadas.find(c => c[0] === 'nota'));
    ok(!(await visivel()) && nota[1] === true && nota[2].length === 3 && /^Texto em votação — substitutivo em votação no Senado/.test(nota[2][0]) && /^Parecer do relator/.test(nota[2][1]) && /^Documento de apoio — emendas\.pdf/.test(nota[2][2]) && nota[3] === true && nota[4] === true, 'gerar: fecha o diálogo e chama o gerador com os três documentos, na ordem certa, já com os bytes, forçando nova análise');
    ok(/Documento próprio \(3\)/.test(await txt('[data-role=btn-doc-proprio]')), 'o botão do item passa a mostrar quantos documentos estão anexados');

    await pg.evaluate(() => window.abrir(''));
    ok((await pg.$$eval('[data-docan-tipo]', els => els.length)) === 3 && await pg.isChecked('#docan-somar'), 'reabrir o diálogo traz o que já estava anexado nesta aba');
    await pg.click('#btn-docan-parecer');
    await pg.waitForFunction(() => window.chamadas.some(c => c[0] === 'parecer'));
    const par = await pg.evaluate(() => window.chamadas.find(c => c[0] === 'parecer'));
    ok(par[1] === 3 && par[2].join() === 'INTEIRO_TEOR,PRLP,DOC_ANALISTA,SBT_A', 'Parecer de Especialista: recebe os documentos do(a) analista e, por opção, soma os da Câmara');

    await pg.evaluate(() => window.abrir('Anexe de novo.'));
    ok(/Anexe de novo\./.test(await txt('#docan-aviso')) && await pg.$eval('#docan-aviso', e => e.style.display === 'block'), 'o diálogo mostra o aviso de quem o abriu (regerar sem os arquivos, parecer sem documento)');
    await pg.click('#btn-docan-livre');
    ok(!(await visivel()) && await pg.evaluate(() => window.chamadas.some(c => c[0] === 'livre')), 'escrever à mão: abre a edição livre, sem exigir documento');

    // análise gravada só com links pode ser regerada em outra aba; com arquivo, não
    const outraAba = await pg.evaluate(() => { _docsAnalista.clear(); window.it.analise = { docsDoAnalista: true, somouCamara: false, documentos: [{ tipo: 'INTEIRO_TEOR', rotulo: 'Texto', url: 'https://legis.senado.leg.br/x', doAnalista: true }] }; const a = window.proprios(); window.it.analise.documentos.push({ tipo: 'DOC_ANALISTA', rotulo: 'Apoio', url: '', arquivo: 'emendas.pdf', doAnalista: true }); return [a, window.proprios()]; });
    ok(outraAba[0] && outraAba[0].n === 1 && outraAba[0].links[0] === 'https://legis.senado.leg.br/x' && outraAba[1] === null, 'em outra aba: análise feita só com links tem os documentos de volta; com arquivo anexado, é preciso anexar de novo');
    await b.close();
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO', e.stack); process.exit(1); });
