'use strict';
// Item provisório: proposição que está na pauta do Plenário e que a Câmara ainda não registrou.
//
// O caso (17/11/2026): o PLP 299/2026 entrou na pauta antes de o Senado terminar de votá-lo. A API da
// Câmara não o devolvia. Em uma pauta o item entrou e ficou com "documento não disponível"; na seguinte,
// o título veio quebrado pela geração do PDF ("P ROJETO DE LEI COMPLEMENTAR Nº 2 99 , DE 20 26"), a IA o
// leu e o item foi recusado ("a Câmara não confirmou a proposição lida"), com o motivo errado ("tipo de
// proposição não previsto").
//
// O que se testa:
//   1. o leitor da pauta lê título com letras e números separados, sem IA, e o diagnóstico não culpa o tipo;
//   2. a consulta ao Senado (senado-materia.js), com as respostas reais gravadas em 17/11/2026;
//   3. a ligação com a tela e com o bot (leitura do código);
//   4. a página real da extensão, no Chromium, com a rede trocada por respostas gravadas: o item entra como
//      "aguardando registro", traz os dados do Senado, gera a nota com os documentos de lá, aceita edição à
//      mão e se vincula sozinho quando a Câmara registra. Nenhum pedido de gravação sai da página.
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..'), FX = path.join(__dirname, 'fixtures', 'senado');
const P = require(path.join(RAIZ, 'pauta-parser.js'));
const S = require(path.join(RAIZ, 'senado-materia.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const fx = f => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
const EMENTA = 'Altera a Lei Complementar nº 200, de 30 de agosto de 2023, para conferir ao Poder Executivo federal novos instrumentos de gestão';

(async () => {
  console.log('\n== 1. leitor da pauta: título quebrado pela geração do PDF ==');
  const c = P.consertarTitulosQuebrados;
  ok(c('P ROJETO DE LEI COMPLEMENTAR Nº 2 99 , DE 20 26') === 'PROJETO DE LEI COMPLEMENTAR Nº 299, DE 2026', 'o título do item 2 da pauta de 17/11/2026 volta à forma padrão');
  ok(c('P RO JETO DE LEI N º 5. 2 29 - A , DE 2 0 25 (DO SENADO FEDERAL)') === 'PROJETO DE LEI Nº 5.229-A, DE 2025 (DO SENADO FEDERAL)', 'número com ponto e sufixo de letra, e o resto da linha preservado');
  ok(c('PROPOSTA DE EMENDA A CONSTITUI CAO No 4 5, DE 2019') === 'PROPOSTA DE EMENDA À CONSTITUIÇÃO Nº 45, DE 2019' && c('M EDIDA PROVIS ÓRIA Nº 1 . 391 , DE 2026') === 'MEDIDA PROVISÓRIA Nº 1.391, DE 2026', 'PEC sem acento e MPV: o tipo mais longo é reconhecido primeiro');
  ok(c('PROJETO DE LEI N º 5.229 - A, DE 2025') === 'PROJETO DE LEI N º 5.229 - A, DE 2025' && c('Projeto de Lei n º 12, de 2020') === 'Projeto de Lei n º 12, de 2020' && c('DISCUSSAO, EM TURNO UNICO, DO PROJETO 12 DE 2020') === 'DISCUSSAO, EM TURNO UNICO, DO PROJETO 12 DE 2020', 'não mexe no que já está no padrão, em título fora de maiúsculas nem em linha comum');
  // nas pautas reais do acervo nada muda (nenhum título delas vinha quebrado desse jeito)
  const dir = path.join(__dirname, 'pautas', 'corpus');
  const corpus = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  ok(corpus.length >= 26 && corpus.every(t => c(t) === t), `${corpus.length} pautas do acervo: o conserto não altera nenhuma linha`);
  // uma pauta real com o título de um item quebrado de propósito: o item continua sendo lido, sem lacuna
  const real = corpus.find(t => /\n\d{1,2}\nPROJETO DE LEI N[º°] [\d.]+, DE \d{4}/.test(t));
  const m = /\n(\d{1,2})\n(PROJETO DE LEI) N[º°] ([\d.]+), DE (\d{4})/.exec(real);
  const quebrada = real.replace(m[0], `\n${m[1]}\nP ROJETO DE LEI N º ${m[3].split('').join(' ')} , DE ${m[4].slice(0, 2)} ${m[4].slice(2)}`);
  const antes = P.parsearPauta(real), depois = P.parsearPauta(quebrada);
  ok(quebrada !== real && antes.itens.length === depois.itens.length && depois.itens.some(i => i.ordem === Number(m[1]) && i.numero === m[3].replace(/\./g, '') && i.ano === m[4]) && !P.detectarLacunasPauta(quebrada, depois.itens).faltando.length,
    `pauta real com o item ${m[1]} quebrado ("P ROJETO DE LEI N º ${m[3].split('').join(' ')}"): mesmos ${antes.itens.length} itens, nenhuma lacuna, nenhuma chamada de IA`);
  const d = P.diagnosticarLacuna('2\nP ROJETO DE LEI COMPLEMENTAR Nº 2 99 , DE 20 26\n(DO SENADO FEDERAL)', 2);
  ok(/letras ou números separados/.test(d.motivo) && !/tipo de proposição não previsto/.test(d.motivo), 'diagnóstico: título quebrado não é "tipo de proposição não previsto"');
  ok(/tipo de proposição não previsto: "PROJETO DE LEI DA CÂMARA"/.test(P.diagnosticarLacuna('9\nPROJETO DE LEI DA CÂMARA Nº 12, DE 2020', 9).motivo), 'tipo realmente desconhecido continua sendo apontado');

  // a IA leu, o número está no texto, e a Câmara respondeu que não tem a proposição: entra como provisório
  const lac = { faltando: [2, 3, 4], trechos: { 2: '2\nP ROJETO DE LEI COMPLEMENTAR Nº 2 99 , DE 20 26', 3: '3\nPROJETO DE LEI Nº 10, DE 2026', 4: '4\nPROJETO DE LEI Nº 11, DE 2026' }, diagnosticos: {} };
  const resp = JSON.stringify([{ ordem: 2, categoria: 'projeto', sigla: 'PLP', numero: '299', ano: '2026', ementa: 'x' }, { ordem: 3, categoria: 'projeto', sigla: 'PL', numero: '10', ano: '2026', ementa: 'y' }, { ordem: 4, categoria: 'projeto', sigla: 'PL', numero: '11', ano: '2026', ementa: 'z' }]);
  const r = await P.recuperarLacunasPauta(lac, { chamarIA: async () => resp, confirmar: async ref => ref.numero === '299' ? 'sem-registro' : ref.numero === '10' });
  const it2 = r.recuperados.find(i => i.ordem === 2);
  ok(it2 && it2.provisorio && it2.provisorio.motivo === 'sem registro na Câmara' && r.recuperados.some(i => i.ordem === 3 && !i.provisorio) && r.pendentes.length === 1 && r.pendentes[0].ordem === 4 && /não confirmou/.test(r.pendentes[0].motivo),
    'recuperação: sem registro na Câmara → entra provisório; confirmada → entra normal; consulta que falhou → fica pendente, como antes');

  console.log('\n== 2. consulta ao Senado (respostas gravadas do PLP 299/2026) ==');
  const pedidos = [];
  const senado = async u => { pedidos.push(u);
    if (/processo\?sigla=PLP&numero=299&ano=2026$/.test(u)) return fx('processo-lista-plp299.json');
    if (/processo\/documento\?idProcesso=9127383$/.test(u)) return fx('processo-documentos-plp299.json');
    if (/processo\/9127383$/.test(u)) return fx('processo-plp299.json');
    return []; };
  const sen = await S.senadoBuscar({ sigla: 'PLP', numero: '299', ano: '2026' }, senado);
  ok(sen && sen.codigoMateria === 176328 && sen.autor === 'Senador Jaques Wagner (PT/BA)' && /^Altera a Lei Complementar nº 200/.test(sen.ementa) && sen.tramitando && sen.situacao === 'INCLUÍDA EM ORDEM DO DIA' && sen.dataSituacao === '17/11/2026' && /materia\/176328$/.test(sen.url),
    'matéria localizada pela mesma sigla, número e ano: ementa, autor, situação e página no Senado');
  ok(sen.ultimoAndamento && sen.ultimoAndamento.data === '17/11/2026' && /Ordem do Dia da Sessão Deliberativa Ordinária Semipresencial de 18\/11\/2026/.test(sen.ultimoAndamento.texto), 'último andamento: o mais recente dos informes');
  ok(sen.documentos.length === 2 && sen.documentos[0].tipo === 'PRLP' && /P\.S 221\/2026 - PLEN/.test(sen.documentos[0].rotulo) && /de 12\/11\/2026/.test(sen.documentos[0].rotulo) && sen.documentos[1].tipo === 'INTEIRO_TEOR' && /Texto inicial no Senado/.test(sen.documentos[1].rotulo) && sen.documentos.every(x => x.doSenado && /^https:\/\/legis\.senado\.leg\.br\//.test(x.url)),
    'documentos para a análise: o parecer aprovado (que traz o substitutivo) e o texto inicial; emendas avulsas e requerimentos ficam de fora');
  ok(pedidos.every(u => u.startsWith('https://legis.senado.leg.br/dadosabertos/processo')), 'usa o serviço atual do Senado (/processo), não o descontinuado (/materia)');
  ok(await S.senadoBuscar({ sigla: 'PLP', numero: '123456', ano: '2026' }, senado) === null && await S.senadoBuscar({ sigla: 'PRC', numero: '5', ano: '2026' }, senado) === null && await S.senadoBuscar({ sigla: 'REQ', numero: '5', ano: '2026' }, senado) === null,
    'o Senado não tem a matéria, ou a sigla não existe lá (PRC, REQ): devolve nulo, sem inventar');
  let lancou = false; try { await S.senadoBuscar({ sigla: 'PL', numero: '1', ano: '2026' }, async () => { throw new Error('HTTP 503'); }); } catch (e) { lancou = /503/.test(e.message); }
  ok(lancou, 'Senado fora do ar: lança (quem chama registra a falha; não confunde com "não tem a matéria")');
  const semDocs = await S.senadoBuscar({ sigla: 'PLP', numero: '299', ano: '2026' }, async u => { if (/documento/.test(u)) throw new Error('HTTP 500'); return senado(u); });
  ok(semDocs.documentos.length === 1 && /Texto inicial no Senado/.test(semDocs.documentos[0].rotulo) && /documentos não lidos/.test(semDocs.avisos.join()), 'lista de documentos indisponível: sobra o texto inicial que vem na busca, e o aviso diz o que faltou');
  const esc = S.senadoEscolherDocumentos;
  ok(esc([{ siglaTipo: 'RELATORIO', identificacao: 'Relatório 1', dataRecebimento: '2026-11-11', urlDocumento: 'https://legis.senado.gov.br/a' }, { siglaTipo: 'RELATORIO', identificacao: 'Relatório 2', dataRecebimento: '2026-11-12', urlDocumento: 'https://legis.senado.leg.br/b' }])[0].url === 'https://legis.senado.leg.br/b',
    'sem parecer aprovado: vale o relatório legislativo mais recente');
  const comFinal = esc([...fx('processo-documentos-plp299.json'), { siglaTipo: 'REDACAO_FINAL', descricaoTipo: 'Redação final', dataRecebimento: '2026-11-18', urlDocumento: 'http://legis.senado.gov.br/rf' }]);
  ok(comFinal[0].tipo === 'INTEIRO_TEOR' && /Texto aprovado no Senado/.test(comFinal[0].rotulo) && comFinal[0].url === 'https://legis.senado.leg.br/rf' && comFinal.length === 2 && !comFinal.some(x => /Texto inicial/.test(x.rotulo)),
    'quando o Senado publicar a redação final, ela passa a ser o texto e o inicial sai');
  const mm = S.senadoMesmaMateria;
  ok(mm(EMENTA, sen.ementa).parecida && !mm('Dispõe sobre a criação de cargos na Justiça do Trabalho da 2ª Região', sen.ementa).parecida && mm('', sen.ementa).indefinido, 'conferência da ementa: mesma matéria, matéria diferente e pauta sem ementa');
  const instr = S.senadoInstrucao(sen, 'PLP 299/2026');
  ok(/DOCUMENTOS DO SENADO FEDERAL/.test(instr) && /a Câmara ainda não tem registro/.test(instr) && /P\.S 221\/2026/.test(instr) && /o texto ainda pode mudar/.test(instr) && /Não afirme fatos de tramitação na Câmara/.test(instr), 'instrução à IA: de onde vêm os documentos, que o texto pode mudar e que não há tramitação na Câmara');
  ok(/análise usa os documentos de lá \(2\)/.test(S.provisorioAviso({ senado: sen }, 'PLP 299/2026')) && /o Senado também não\. Edite os detalhes à mão e entregue o documento/.test(S.provisorioAviso({}, 'PRC 5/2026')) && /remova o item e inclua de novo/.test(S.provisorioAviso({}, 'PRC 5/2026')) && /consulta ao Senado falhou \(HTTP 503\)/.test(S.provisorioAviso({ senadoErro: 'HTTP 503' }, 'PL 1/2026')) && /este tipo de proposição não tramita no Senado/.test(S.provisorioAviso({ semSenado: true }, 'PRC 5/2026')),
    'aviso do item: com documentos do Senado; sem a matéria no Senado (editar à mão, anexar o documento ou remover e incluir depois); Senado fora do ar');

  console.log('\n== 3. ligação com a tela e com o bot ==');
  const js = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8'), html = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8');
  ok(html.indexOf('<script src="senado-materia.js">') > 0 && html.indexOf('<script src="senado-materia.js">') < html.indexOf('<script src="analise.js">') && /id="modal-detalhes-item"/.test(html) && /id="det-ementa"/.test(html) && /id="btn-salvar-detalhes"/.test(html), 'a página carrega o módulo do Senado antes do painel e tem o diálogo de detalhes');
  ok(/\{ naoEncontrada: true \}/.test(js) && /if \(e\.naoEncontrada && etapa === 'resolveProposicao'\) \{ await tratarSemRegistro\(it, alvo\); return; \}/.test(js), '"não encontrada" é resposta da Câmara, separada de API fora do ar, e leva ao estado provisório');
  ok(/if \(it\.provisorio\) vincularRegistroCamara\(it\);/.test(js) && /setInterval\(\(\) => \{[\s\S]{0,260}it\.provisorio[\s\S]{0,120}enriquecerItem\(it\)/.test(js), 'o vínculo é tentado a cada enriquecimento (carga da pauta) e a cada 10 minutos');
  ok(/provisorio: it\.provisorio \|\| null,/.test(js) && /detalhesManuais: it\.detalhesManuais \|\| null,/.test(js), 'o estado provisório e os detalhes digitados são gravados com a pauta');
  ok(/e\.ambiguo \? true : e\.naoEncontrada \? 'sem-registro' : false/.test(js) && /if \(e\.naoEncontrada\) \{ semRegistro = true; return null; \}/.test(js), 'importação da pauta e "Adicionar à mão" aceitam proposição ainda sem registro');
  ok(/doSenado \? \{ docsDoSenado: true \} : \{\}/.test(js) && /doSenado \? SENADO_CENARIO/.test(js) && /docsMeta\.some\(d => d\.doSenado\) \? SENADO_CENARIO/.test(js), 'a nota e o Parecer de Especialista registram que os documentos vieram do Senado');
  const bot = fs.readFileSync(path.join(RAIZ, 'bot/src/pauta.js'), 'utf8');
  ok(/return apiVazia \? 'sem-registro' : false;/.test(bot) && /provisorio:\s+it\.provisorio \|\| null,/.test(bot) && /provisorios: novos\.filter\(i => i\.provisorio\)/.test(bot), 'bot: distingue "a Câmara não tem" de "não consegui consultar", grava o estado e o informa');
  const B = require(path.join(RAIZ, 'bot/src/pauta.js'));
  const fetchReal = global.fetch;
  const resposta = (okk, corpo) => ({ ok: okk, status: okk ? 200 : 503, json: async () => corpo, text: async () => typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
  global.fetch = async u => /dadosabertos/.test(String(u)) ? resposta(true, { dados: [] }) : /busca-api/.test(String(u)) ? resposta(true, { hits: { hits: [] } }) : resposta(true, '<erro/>');
  const semReg = await B.confirmarProposicaoCamara({ sigla: 'PLP', numero: '299', ano: '2026' });
  global.fetch = async () => { throw new Error('rede fora'); };
  const fora = await B.confirmarProposicaoCamara({ sigla: 'PLP', numero: '299', ano: '2026' });
  global.fetch = async u => /dadosabertos/.test(String(u)) ? resposta(true, { dados: [{ id: 1 }] }) : resposta(false, {});
  const tem = await B.confirmarProposicaoCamara({ sigla: 'PLP', numero: '299', ano: '2026' });
  global.fetch = fetchReal;
  ok(semReg === 'sem-registro' && fora === false && tem === true, 'bot: API respondeu vazio → "sem-registro"; tudo fora do ar → falso (fica pendente); existe → verdadeiro');
  const msg = B.textoLacunas({ faltando: [2, 5], recuperados: [2, 5], provisorios: [2], pendentes: [], diagnosticos: {} });
  ok(/Item\(ns\) 5 não reconhecido\(s\) pelo leitor — lido\(s\) pela IA e confirmado\(s\) na Câmara/.test(msg) && /Item\(ns\) 2 lido\(s\) pela IA; a Câmara ainda não registrou a proposição — entrou\(aram\) como "aguardando registro"/.test(msg), 'bot: a mensagem separa o item confirmado do que entrou aguardando registro');

  console.log('\n== 4. a página da extensão, no navegador ==');
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { console.log('  (playwright indisponível: bloco 4 não executado)'); }
  if (chromium) {
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
    const srv = http.createServer((q, rs) => { const f = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); rs.end(fs.readFileSync(f)); });
    await new Promise(rs => srv.listen(0, '127.0.0.1', rs));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const b = await chromium.launch(); const pg = await b.newPage();
    const rede = { camaraTem: false, senadoFora: false, gravacoes: [], errosPagina: [] };
    pg.on('pageerror', e => rede.errosPagina.push(e.message));
    await pg.addInitScript(() => { window.chrome = { storage: { local: { get: (k, cb) => cb({ config: { nomeUsuario: 'teste' } }), set: (o, cb) => cb && cb() } }, runtime: { getURL: u => u, getManifest: () => ({ version: 'teste' }) } }; });
    await pg.route('**/*', async rt => {
      const u = rt.request().url(), met = rt.request().method();
      if (u.startsWith(base)) return rt.continue();
      const json = o => rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      // Nada é gravado: todo pedido que não seja leitura é registrado e abortado.
      if (met !== 'GET') { rede.gravacoes.push({ met, u, corpo: rt.request().postData() || '' }); return rt.abort(); }
      if (/firebaseio\.com/.test(u)) return json(null);
      if (/dadosabertos\.camara\.leg\.br\/api\/v2\/proposicoes\?/.test(u)) return json({ dados: rede.camaraTem && /numero=299/.test(u) ? [{ id: 9999001, siglaTipo: 'PLP', numero: 299, ano: 2026, ementa: EMENTA }] : [] });
      if (/dadosabertos\.camara\.leg\.br\/api\/v2\/proposicoes\/9999001$/.test(u)) return json({ dados: { id: 9999001, ementa: EMENTA, urlInteiroTeor: 'https://www.camara.leg.br/teor.pdf' } });
      if (/dadosabertos\.camara\.leg\.br/.test(u)) return json({ dados: [] });
      if (/legis\.senado\.leg\.br\/dadosabertos\//.test(u)) {
        if (rede.senadoFora) return rt.fulfill({ status: 503, body: 'fora' });
        if (/processo\?/.test(u)) return json(/numero=299/.test(u) ? fx('processo-lista-plp299.json') : []);
        if (/processo\/documento/.test(u)) return json(fx('processo-documentos-plp299.json'));
        return json(fx('processo-plp299.json'));
      }
      return rt.abort();
    });
    await pg.goto(base + '/analise.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof enriquecerItem === 'function' && typeof senadoBuscar === 'function');
    const cartao = ch => `.an-card[data-chave="${ch}"]`;

    // --- entra como provisório, com os dados do Senado
    const e1 = await pg.evaluate(async () => {
      window.__toasts = []; const t0 = window.mostrarToast; window.mostrarToast = (m, t) => { window.__toasts.push(String(m)); return t0 && t0(m, t); };
      const novo = (o, s, n) => normalizarItem({ ordem: o, tipoCategoria: 'projeto', sigla: s, numero: n, ano: '2026', ementa: '', autorTexto: '', apensadosTexto: [], relator: null });
      state.pauta = { id: 'teste-provisorio', titulo: 'Pauta de teste', periodo: '17/11/2026', itens: [novo(2, 'PLP', '299'), novo(3, 'PRC', '77777')] };
      renderizarPauta();
      const [a, c2] = state.pauta.itens;
      await enriquecerItem(a); await enriquecerItem(c2);
      return { prov: a.provisorio, enr: a.enriquecimento, ementa: a.ementa, autor: a.autorTexto, docs: await escolherDocumentos(a), prov2: c2.provisorio, docs2: await escolherDocumentos(c2), toasts: window.__toasts.slice() };
    });
    ok(e1.prov && e1.prov.alvo === 'PLP 299/2026' && e1.prov.senado && e1.prov.senado.codigoMateria === 176328 && e1.enr.status === 'ok' && e1.enr.semRegistro === true && !e1.prov.conferir, 'proposição que a Câmara não tem: o item fica "aguardando registro", com o que o Senado informou — não vira erro');
    ok(/^Altera a Lei Complementar nº 200/.test(e1.ementa) && e1.autor === 'Senador Jaques Wagner (PT/BA)', 'a ementa e o autor que a pauta não trouxe são completados pelo Senado');
    ok(e1.docs.length === 2 && e1.docs.every(x => x.doSenado) && e1.docs[0].tipo === 'PRLP', 'os documentos da análise passam a ser os do Senado');
    ok(e1.toasts.some(t => /PLP 299\/2026: a Câmara ainda não registrou a proposição/.test(t) && /dados e documentos lidos no Senado/.test(t)), 'o usuário é avisado na hora');
    const linha = await pg.$eval(`${cartao('PLP-299-2026')} [data-role=prov-linha]`, e => ({ t: e.innerText, vis: e.style.display !== 'none', link: e.querySelector('a')?.href || '' }));
    const selo = await pg.$eval(`${cartao('PLP-299-2026')} [data-role=autoria-flag]`, e => e.textContent);
    ok(selo === '⏳ Aguardando registro na Câmara' && linha.vis && /A Câmara ainda não tem registro de PLP 299\/2026/.test(linha.t) && /situação: Incluída em ordem do dia \(17\/11\/2026\)/.test(linha.t) && /materia\/176328$/.test(linha.link) && /Editar detalhes/.test(linha.t) && /Verificar registro/.test(linha.t),
      'card: selo, aviso, situação no Senado com link e os botões "Editar detalhes" e "Verificar registro"');
    const linha2 = await pg.$eval(`${cartao('PRC-77777-2026')} [data-role=prov-linha]`, e => e.innerText);
    ok(e1.prov2 && !e1.prov2.senado && e1.prov2.semSenado === true && e1.docs2.length === 0 && /este tipo de proposição não tramita no Senado\. Edite os detalhes à mão e entregue o documento em "Documento próprio" para a análise, ou remova o item e inclua de novo/.test(linha2), 'projeto de resolução (não tramita no Senado): o aviso manda editar à mão e entregar o documento, ou remover e incluir depois');

    // --- editar os detalhes à mão
    await pg.click(`${cartao('PRC-77777-2026')} [data-role=btn-prov-editar]`);
    ok(await pg.$eval('#modal-detalhes-item', e => e.style.display === 'flex') && /PRC 77777\/2026 — item 3/.test(await pg.$eval('#det-alvo', e => e.textContent)), '"Editar detalhes" abre o diálogo do item');
    await pg.fill('#det-ementa', 'Institui a comissão de teste.'); await pg.fill('#det-autor', 'Mesa Diretora'); await pg.fill('#det-relator', 'Dep. Fulano de Tal');
    await pg.click('#btn-salvar-detalhes');
    const ed = await pg.evaluate(() => { const i = state.pauta.itens[1]; const cd = document.querySelector('.an-card[data-chave="PRC-77777-2026"]'); return { ementa: i.ementa, autor: i.autorTexto, rel: i.relator, manual: i.detalhesManuais, cardEmenta: cd.querySelector('.an-card-ementa').textContent, cardMeta: cd.querySelector('.an-card-meta').innerText, linha: cd.querySelector('[data-role=prov-linha]').style.display !== 'none', modal: document.getElementById('modal-detalhes-item').style.display }; });
    ok(ed.ementa === 'Institui a comissão de teste.' && ed.autor === 'Mesa Diretora' && ed.rel && ed.rel.nome === 'Dep. Fulano de Tal' && ed.manual === true && ed.modal === 'none' && ed.cardEmenta === 'Institui a comissão de teste.' && /Mesa Diretora/.test(ed.cardMeta) && /Fulano de Tal/.test(ed.cardMeta) && ed.linha,
      'salvar: ementa, autor e relator ficam no item e no card, e o item continua marcado como aguardando registro');
    const naoSobrescreve = await pg.evaluate(async () => { const a = state.pauta.itens[0]; a.ementa = 'Ementa digitada pelo analista sobre a lei complementar do executivo federal e os instrumentos de gestão.'; a.detalhesManuais = true; await enriquecerItem(a); return a.ementa; });
    ok(/^Ementa digitada pelo analista/.test(naoSobrescreve), 'o que foi digitado à mão não é sobrescrito pela consulta ao Senado');

    // --- gerar a nota com os documentos do Senado (a IA é trocada por uma resposta fixa; nenhuma chave é usada)
    const ger = await pg.evaluate(async () => {
      window.__ia = []; window.__baixados = [];
      window.chamarIA = async a => { window.__ia.push({ prompt: a.prompt, nPdf: (a.pdfBuffers || []).length }); return { text: '## 1. Resumo\n\nNota de teste, baseada em documentos do Senado.\n\n## 2. Análise\n\nTexto.', truncated: false, usage: null }; };
      window.baixarPdf = async url => { window.__baixados.push(url); return new TextEncoder().encode('%PDF-1.4 documento de teste').buffer; };
      state.config = { apiKey: 'chave-de-teste', provedor: 'gemini', modelo: 'modelo-de-teste', nomeUsuario: 'teste' };
      window.carregarConfig = async () => state.config;
      const a = state.pauta.itens[0];
      await gerarAnaliseItem(a, true);
      return { status: a.analiseStatus, cenario: a.analise?.cenario, doSenado: a.analise?.docsDoSenado, docs: (a.analise?.documentos || []).map(x => x.tipo), prompt: window.__ia[0]?.prompt || '', nPdf: window.__ia[0]?.nPdf, baixados: window.__baixados };
    });
    ok(ger.status === 'ok' && ger.cenario === 'Documentos do Senado (matéria ainda sem registro na Câmara)' && ger.doSenado === true && ger.docs.join() === 'PRLP,INTEIRO_TEOR' && ger.nPdf === 2 && ger.baixados.length >= 2 && ger.baixados.every(u => /legis\.senado\.leg\.br/.test(u)),
      'gerar análise: baixa os dois documentos do Senado e grava a nota com o cenário "Documentos do Senado"');
    ok(/DOCUMENTOS DO SENADO FEDERAL/.test(ger.prompt) && /a Câmara ainda não tem registro da proposição/.test(ger.prompt) && /Continuação da votação, em turno único/.test(ger.prompt) && /o texto ainda pode mudar/.test(ger.prompt), 'a IA recebe a origem dos documentos, a situação no Senado e a ordem de avisar que o texto pode mudar');

    // --- verificar registro: ainda não; Senado fora do ar não apaga o que já se sabia
    rede.senadoFora = true;
    await pg.click(`${cartao('PLP-299-2026')} [data-role=btn-prov-verificar]`);
    await pg.waitForFunction(() => window.__toasts.some(t => /ainda sem registro na Câmara/.test(t)));
    const fora2 = await pg.evaluate(() => { const a = state.pauta.itens[0]; return { erro: a.provisorio?.senadoErro || '', docs: (a.provisorio?.senado?.documentos || []).length }; });
    ok(/503/.test(fora2.erro) && fora2.docs === 2, '"Verificar registro" com o Senado fora do ar: registra a falha e mantém os dados e documentos já lidos');
    rede.senadoFora = false;

    // --- a Câmara registra a matéria: o vínculo é feito sozinho e a nota fica marcada para conferência
    rede.camaraTem = true;
    const vinc = await pg.evaluate(async () => { const a = state.pauta.itens[0]; window.__toasts.length = 0; await enriquecerItem(a); const cd = document.querySelector('.an-card[data-chave="PLP-299-2026"]');
      return { prov: a.provisorio || null, id: a.enriquecimento.idProposicao, linha: cd.querySelector('[data-role=prov-linha]').style.display, selos: [...cd.querySelectorAll('.an-badge')].map(x => x.textContent), desat: a.desatualizacao, nota: !!a.analise, toasts: window.__toasts.slice() }; });
    ok(vinc.prov === null && vinc.id === 9999001 && vinc.linha === 'none' && vinc.nota && vinc.toasts.some(t => /PLP 299\/2026 foi registrado na Câmara — vínculo feito/.test(t)), 'a Câmara registrou: o item deixa de ser provisório, ganha o id da Câmara e mantém a nota — sem apagar e inserir de novo');
    ok(vinc.selos.includes('⚠ Pode estar desatualizada') && /a nota foi feita com documentos do Senado/.test(vinc.desat.novos[0].rotulo) && !vinc.selos.some(x => /Aguardando registro/.test(x)), 'a nota feita com documentos do Senado fica marcada para conferência depois do vínculo');

    // --- adicionar à mão uma proposição ainda sem registro
    rede.camaraTem = false;
    await pg.evaluate(() => { cacheProp.clear(); abrirModalAdicionar(); });
    await pg.selectOption('#add-tipo', 'PLP'); await pg.fill('#add-numero', '300'); await pg.fill('#add-ano', '2026'); await pg.fill('#add-ordem', '4');
    await pg.click('#btn-confirmar-adicionar');
    await pg.waitForFunction(() => state.pauta.itens.some(i => i.chave === 'PLP-300-2026' && i.provisorio));
    const add = await pg.evaluate(() => ({ fechou: document.getElementById('modal-adicionar').style.display === 'none', toast: window.__toasts.some(t => /PLP 300\/2026 adicionado à pauta — a Câmara ainda não registrou esta proposição/.test(t)), n: state.pauta.itens.length }));
    ok(add.fechou && add.toast && add.n === 3, '"Adicionar à mão": proposição ainda sem registro entra na pauta, como aguardando registro, em vez de dar erro');

    // --- o que iria para o Firebase (pedido registrado e abortado): o estado provisório vai junto
    await pg.evaluate(() => fbSalvarPauta(state.pauta).catch(() => {}));
    const put = rede.gravacoes.filter(g => g.met === 'PUT' && /\/pautas\/teste-provisorio\.json/.test(g.u)).pop();
    const corpo = put ? JSON.parse(put.corpo) : { itens: [] };
    const gPrc = corpo.itens.find(i => i.chave === 'PRC-77777-2026') || {}, gPlp = corpo.itens.find(i => i.chave === 'PLP-299-2026') || {}, g300 = corpo.itens.find(i => i.chave === 'PLP-300-2026') || {};
    ok(put && gPrc.provisorio && gPrc.detalhesManuais === true && gPrc.ementa === 'Institui a comissão de teste.' && !gPlp.provisorio && g300.provisorio && g300.provisorio.alvo === 'PLP 300/2026', 'gravação da pauta: leva o estado provisório e os detalhes digitados; o item já vinculado vai sem ele');
    ok(rede.gravacoes.every(g => /firebaseio\.com|busca-api/.test(g.u)) && !rede.errosPagina.length, `nenhum pedido de gravação saiu da página (${rede.gravacoes.length} registrados e abortados) e a página não lançou erro`);
    await b.close(); srv.close();
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO', e.stack); process.exit(1); });
