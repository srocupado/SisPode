// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Comissões · Pedidos de vagas (comissoes-pedidos-vagas.js + aba "Pedidos" em comissoes.html / comissoes.js).
//
// Pedido de 24/11/2026: registrar quais deputados pediram vaga em quais Comissões Permanentes, com tipo de vaga,
// ordem de preferência e situação; inacumulabilidade (RICD, art. 26, § 2º) aplicada NO REGISTRO, bloqueando.
// Uso: node testes/comissoes-pedidos-vagas.test.js
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const PV = require(path.join(RAIZ, 'comissoes-pedidos-vagas.js'));
const src = fs.readFileSync(path.join(RAIZ, 'comissoes.js'), 'utf8');
const PERMANENTES = eval(src.match(/const COMISSOES_PERMANENTES = (\[[\s\S]*?\]);/)[1]);
const GRUPOS = eval(src.match(/const GRUPOS_INCOMPATIVEIS = (\[[\s\S]*?\n\]);/)[1]);

// RICD, art. 26, § 2º (Resolução nº 1, de 2023): as ressalvadas, como o parágrafo as enumera
const RESSALVADAS = ['CLP', 'CSPCCO', 'CCULT', 'CPD', 'CDHMIR', 'CESPO', 'CMADS', 'CREDN', 'CTUR', 'CINDRE', 'CPOVOS', 'CCOM', 'CMULHER', 'CIDOSO', 'CDE', 'CASP'];

(async () => {
  console.log('== 1. quais comissões são inacumuláveis ==');
  const inac = PERMANENTES.filter(c => PV.pvInacumulavel(c.sigla, GRUPOS)).map(c => c.sigla);
  ok(PERMANENTES.length === 30 && inac.length === 14, `30 permanentes, 14 inacumuláveis (${inac.length})`);
  ok(PERMANENTES.filter(c => !inac.includes(c.sigla)).map(c => c.sigla).sort().join() === RESSALVADAS.slice().sort().join(),
    'as que ficam de fora são exatamente as 16 ressalvadas do art. 26, § 2º');

  console.log('\n== 2. validação no registro ==');
  const membros = { '1': { titulares: ['CCJC'], suplentes: ['CFT'] }, '2': { titulares: ['CCULT'], suplentes: [] } };
  const ctx = (pedidos = []) => ({ permanentes: PERMANENTES, grupos: GRUPOS, membrosDe: id => membros[id] || { titulares: [], suplentes: [] }, pedidos, legAtual: 57 });
  const v = (p, pedidos) => PV.pvValidarPedido(Object.assign({ ordem: 1, legislatura: 57 }, p), ctx(pedidos));

  let r = v({ depId: '1', sigla: 'CFT', tipo: 'titular' });
  ok(!r.ok && r.inacumulavel === 'CCJC' && /Inacumulável: o deputado já é titular em CCJC/.test(r.erro) && /RICD, art\. 26, § 2º/.test(r.erro),
    'titular na CCJC pede titular na CFT: BLOQUEADO, com a comissão e o artigo');
  ok(v({ depId: '1', sigla: 'CFT', tipo: 'suplente' }).ok === false && /já é suplente em CFT/.test(v({ depId: '1', sigla: 'CFT', tipo: 'suplente' }).erro), 'já é suplente na CFT: não pede suplência de novo');
  ok(v({ depId: '1', sigla: 'CE', tipo: 'suplente' }).ok, 'suplência numa inacumulável: aceita (o limite é só para titular)');
  ok(v({ depId: '1', sigla: 'CCULT', tipo: 'titular' }).ok, 'titular numa ressalvada (Cultura), sendo titular na CCJC: aceito');
  ok(v({ depId: '2', sigla: 'CCJC', tipo: 'titular' }).ok, 'titular só em ressalvada (Cultura) pede titular na CCJC: aceito');
  ok(/já é titular em CCJC/.test(v({ depId: '1', sigla: 'CCJC', tipo: 'titular' }).erro), 'já é titular na própria comissão: recusado');
  ok(v({ depId: '3', sigla: 'CCJC', tipo: 'titular' }).ok && v({ depId: '3', sigla: 'CFT', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'pendente' }]).ok,
    'sem titularidade: pode pedir titular em duas inacumuláveis como opções (pendentes)');
  r = v({ depId: '3', sigla: 'CFT', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'atendido' }]);
  ok(!r.ok && /já é titular em CCJC \(pedido atendido, \d+ª legislatura\)/.test(r.erro), 'pedido de titular já ATENDIDO numa inacumulável conta como titularidade: bloqueia outra');
  ok(/Já há um pedido pendente de titular em CCJC/.test(v({ depId: '3', sigla: 'CCJC', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'pendente' }]).erro), 'pedido pendente igual: recusado');
  ok(v({ depId: '3', sigla: 'CCJC', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'negado' }]).ok, 'pedido igual já negado não impede um novo');
  ok(/Comissão Permanente/.test(v({ depId: '3', sigla: 'CPIXYZ', tipo: 'titular' }).erro), 'só Comissões Permanentes');
  ok(/preferência vai de 1 a 10/.test(v({ depId: '3', sigla: 'CE', tipo: 'titular', ordem: 11 }).erro), 'preferência de 1 a 10');

  console.log('\n== 2b. legislatura e deputado digitado (24/11/2026) ==');
  ok(PV.pvLegislaturaDe(new Date(2026, 10, 24)) === 57 && PV.pvLegislaturaDe(new Date(2027, 0, 31)) === 57 && PV.pvLegislaturaDe(new Date(2027, 1, 1)) === 58,
    'legislatura pela data: a 58ª começa em 1º/2/2027');
  ok(PV.pvLegislaturaPadrao(new Date(2026, 10, 24)) === 58 && PV.pvLegislaturaPadrao(new Date(2026, 5, 1)) === 57, 'o formulário oferece a próxima a partir de outubro do ano da eleição');
  ok(v({ depId: '1', sigla: 'CFT', tipo: 'titular', legislatura: 58 }).ok, 'titular na CCJC HOJE pede titular na CFT para a 58ª: aceito (a composição de hoje não vale para a próxima)');
  r = v({ depId: '1', sigla: 'CFT', tipo: 'titular', legislatura: 58 }, [{ depId: '1', sigla: 'CE', tipo: 'titular', situacao: 'atendido', legislatura: 58 }]);
  ok(!r.ok && /já é titular em CE \(pedido atendido, 58ª legislatura\)/.test(r.erro), 'na 58ª, pedido de titular já atendido para a 58ª bloqueia outra inacumulável');
  ok(v({ depId: '3', sigla: 'CFT', tipo: 'titular', legislatura: 57 }, [{ depId: '3', sigla: 'CE', tipo: 'titular', situacao: 'atendido', legislatura: 58 }]).ok, 'o atendido da 58ª não bloqueia pedido da 57ª');
  ok(v({ depId: '3', sigla: 'CCJC', tipo: 'titular', legislatura: 58 }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'pendente' }]).ok,
    'pedido igual pendente de OUTRA legislatura (o antigo, sem legislatura, é da atual) não é repetido');
  ok(/Legislatura inválida/.test(v({ depId: '3', sigla: 'CE', tipo: 'titular', legislatura: 59 }).erro), 'só a atual ou a próxima');
  ok(/Digite o nome/.test(v({ depId: '__manual', depManual: true, depNome: '', sigla: 'CE', tipo: 'titular' }).erro), 'deputado digitado sem nome: pede o nome');
  ok(PV.pvIdManual('José da Silva Júnior') === 'm_jose-da-silva-junior' && PV.pvIdManual('jose  da silva JUNIOR') === 'm_jose-da-silva-junior', 'o mesmo nome digitado (sem acento e caixa) é o mesmo deputado');
  ok(PV.pvResolverManual('ana  exemplo', { a1: { nome: 'Ana Exemplo' } }).depId === 'a1', 'nome digitado igual ao de um deputado cadastrado aponta para o cadastrado');
  const regM = PV.pvNovoRegistro({ depId: 'm_novo', depManual: true, depNome: ' Novo Deputado ', depUf: 'rj', sigla: 'CE', tipo: 'titular', ordem: 1, legislatura: 58 }, '2026-11-24T12:00:00.000Z');
  ok(regM.depNome === 'Novo Deputado' && regM.depUf === 'RJ' && regM.legislatura === 58, 'registro do digitado guarda nome, UF e legislatura');
  ok(PV.pvProximaOrdem('m_novo', [{ depId: 'm_novo', ordem: 1, situacao: 'pendente', legislatura: 58 }], 57, 57) === 1 && PV.pvProximaOrdem('m_novo', [{ depId: 'm_novo', ordem: 1, situacao: 'pendente', legislatura: 58 }], 58, 57) === 2,
    'a preferência é contada dentro da legislatura');

  console.log('\n== 3. preferência e situação ==');
  ok(PV.pvProximaOrdem('3', [{ depId: '3', ordem: 1, situacao: 'pendente' }, { depId: '3', ordem: 2, situacao: 'negado' }, { depId: '4', ordem: 2, situacao: 'pendente' }]) === 2,
    'próxima preferência: a primeira livre entre os pendentes do próprio deputado');
  const reg = PV.pvNovoRegistro({ depId: '3', sigla: 'CE', tipo: 'titular', ordem: '2' }, '2026-11-24T12:00:00.000Z');
  ok(reg.situacao === 'pendente' && reg.ordem === 2 && reg.historico.length === 1, 'registro novo: pendente, com histórico');
  const at = PV.pvComSituacao(reg, 'atendido', '2026-11-25T12:00:00.000Z');
  ok(at.situacao === 'atendido' && at.historico.map(h => h.situacao).join() === 'pendente,atendido' && reg.historico.length === 1, 'mudar a situação acrescenta ao histórico, sem alterar o registro anterior');

  console.log('\n== 4. no navegador: aba "Pedidos", registro e bloqueio ==');
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { console.log('  (playwright indisponível: bloco 4 não executado)'); }
  if (chromium) {
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    const srv = http.createServer((q, rs) => { const f = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); rs.end(fs.readFileSync(f)); });
    await new Promise(rs => srv.listen(0, '127.0.0.1', rs));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const b = await chromium.launch(); const pg = await b.newPage();
    const fb = { gravacoes: [], erros: [] };
    pg.on('pageerror', e => fb.erros.push(e.message));
    await pg.addInitScript(() => { window.chrome = { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } }, runtime: { getURL: u => u } }; });
    const DADOS = { '/deputados': { a1: { nome: 'Ana Teste', uf: 'SP' }, b2: { nome: 'Bruno Teste', uf: 'PR' } }, '/membros': { CCJC: { titulares: ['a1'], suplentes: [] } } };
    await pg.route('**/*', async rt => {
      const u = rt.request().url(), met = rt.request().method();
      if (u.startsWith(base)) return rt.continue();
      const cors = { 'access-control-allow-origin': '*' };
      const m = /firebaseio\.com\/comissoes-podemos(\/[^?]*)\.json/.exec(u);
      if (m) {
        if (met !== 'GET') { fb.gravacoes.push({ met, caminho: m[1], corpo: rt.request().postData() }); return rt.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: rt.request().postData() || 'null' }); }
        return rt.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(DADOS[m[1]] ?? null) });
      }
      return rt.abort();
    });
    await pg.goto(base + '/comissoes.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof renderPainelPedidosVagas === 'function' && state && state.deputados && Object.keys(state.deputados).length === 2);
    await pg.click('.com-tab[data-view="vagas"]');
    const aba = await pg.evaluate(() => ({ titulo: document.querySelector('.pv-titulo')?.textContent || '', filtros: [...document.querySelectorAll('[data-pv-filtro]')].map(e => e.querySelector('.com-item-nome').textContent + ' ' + e.querySelector('.com-item-badge').textContent),
      opcoes: document.querySelectorAll('#pv-com option').length - 1, inac: [...document.querySelectorAll('#pv-com option')].filter(o => /inacumulável/.test(o.textContent)).length, busca: document.getElementById('busca-wrap').style.display }));
    ok(/Pedidos de vagas/.test(aba.titulo) && aba.opcoes === 30 && aba.inac === 14 && aba.busca === 'none', 'a aba "Pedidos" abre o painel com as 30 permanentes (14 marcadas inacumuláveis)');
    ok(aba.filtros.join(' | ') === 'Pendentes 0 | Atendidos 0 | Negados 0 | Todos 0', 'barra lateral com os filtros por situação e as contagens (' + aba.filtros.join(' | ') + ')');

    const legs = await pg.$$eval('#pv-leg option', os => os.map(o => o.textContent + (o.selected ? ' *' : '')));
    ok(legs.length === 2 && /ª \(atual\)/.test(legs[0]) && /ª \(próxima, a partir de 1º\/2\/\d{4}\)/.test(legs[1]), `campo Legislatura com a atual e a próxima (${legs.join(' | ')})`);
    // Ana é titular na CCJC: na legislatura atual, pedir titular na CFT é bloqueado
    await pg.selectOption('#pv-leg', String(await pg.evaluate(() => pvLegislaturaDe())));
    await pg.selectOption('#pv-dep', 'a1');
    const sit = await pg.textContent('#pv-dep-situacao');
    ok(/Hoje: titular em CCJC inacumulável/.test(sit), 'ao escolher o deputado, a tela mostra onde ele já é titular');
    await pg.selectOption('#pv-com', 'CFT'); await pg.selectOption('#pv-tipo', 'titular');
    await pg.click('#pv-registrar');
    const erro = await pg.evaluate(() => ({ vis: document.getElementById('pv-erro').style.display, txt: document.getElementById('pv-erro').textContent }));
    ok(erro.vis === '' && /Inacumulável: o deputado já é titular em CCJC/.test(erro.txt) && !fb.gravacoes.length, 'registro bloqueado: a mensagem aparece e nada é gravado');

    // como suplente, passa
    await pg.selectOption('#pv-tipo', 'suplente');
    await pg.click('#pv-registrar');
    await pg.waitForFunction(() => Object.keys(state.pedidosVagas).length === 1);
    const g1 = fb.gravacoes[0], c1 = JSON.parse(g1.corpo);
    ok(g1.met === 'PUT' && /^\/pedidos-vagas\/pv_\d+$/.test(g1.caminho) && c1.depId === 'a1' && c1.sigla === 'CFT' && c1.tipo === 'suplente' && c1.ordem === 1 && c1.situacao === 'pendente',
      'suplente na CFT: gravado em /pedidos-vagas (interceptado no teste), pendente, 1ª preferência');

    // Bruno: duas opções de titular, a preferência avança sozinha
    await pg.selectOption('#pv-dep', 'b2');
    ok(await pg.inputValue('#pv-ordem') === '1', 'deputado sem pedidos: 1ª preferência');
    await pg.selectOption('#pv-com', 'CCJC'); await pg.selectOption('#pv-tipo', 'titular'); await pg.click('#pv-registrar');
    await pg.waitForFunction(() => Object.keys(state.pedidosVagas).length === 2);
    await pg.selectOption('#pv-dep', 'b2');
    ok(await pg.inputValue('#pv-ordem') === '2', 'segunda opção do mesmo deputado: 2ª preferência sugerida');
    await pg.selectOption('#pv-com', 'CFT'); await pg.selectOption('#pv-tipo', 'titular'); await pg.click('#pv-registrar');
    await pg.waitForFunction(() => Object.keys(state.pedidosVagas).length === 3);
    const linhas = await pg.$$eval('.pv-tabela tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
    ok(linhas.length === 3 && linhas.some(l => /^Ana Teste/.test(l)) && /^Bruno Teste .*1ª CCJC/.test(linhas.find(l => /CCJC/.test(l)) || '') && /^Bruno Teste .*2ª CFT/.test(linhas.find(l => /Bruno.*CFT/.test(l)) || ''), `lista por legislatura, deputado e preferência (${linhas.join(' / ')})`);

    // atender a CCJC do Bruno: daí em diante a CFT como titular seria bloqueada; reabrir também respeita a regra
    const idCcjc = await pg.evaluate(() => Object.entries(state.pedidosVagas).find(([, r]) => r.depId === 'b2' && r.sigla === 'CCJC')[0]);
    await pg.click(`[data-pv-sit="atendido"][data-pv-id="${idCcjc}"]`);
    await pg.waitForFunction(id => state.pedidosVagas[id].situacao === 'atendido', idCcjc);
    const hist = await pg.evaluate(id => state.pedidosVagas[id].historico.map(h => h.situacao).join(), idCcjc);
    ok(hist === 'pendente,atendido', '"Atendido" muda a situação e guarda o histórico');
    const novo = await pg.evaluate(id => pvValidarPedido({ depId: 'b2', sigla: 'CE', tipo: 'titular', ordem: 3, legislatura: state.pedidosVagas[id].legislatura }, pvCtx()), idCcjc);
    ok(!novo.ok && /já é titular em CCJC \(pedido atendido, \d+ª legislatura\)/.test(novo.erro), 'com a CCJC atendida, novo pedido de titular em outra inacumulável é bloqueado');
    // próxima legislatura: deputado digitado
    const legAtualPg = await pg.evaluate(() => pvLegislaturaDe());
    await pg.selectOption('#pv-leg', String(legAtualPg + 1));
    await pg.selectOption('#pv-dep', '__manual');
    ok(await pg.$eval('#pv-manual-nome', e => e.style.display) === '' && /Pedido para a \d+ª legislatura/.test(await pg.textContent('#pv-dep-situacao')), '"Digitar nome" mostra os campos de nome e UF');
    await pg.selectOption('#pv-com', 'CE'); await pg.selectOption('#pv-tipo', 'titular'); await pg.click('#pv-registrar');
    ok(/Digite o nome do deputado/.test(await pg.textContent('#pv-erro')), 'sem o nome: pede o nome, nada gravado');
    const antes = fb.gravacoes.length;
    await pg.fill('#pv-dep-nome', 'Carlos Novo Eleito'); await pg.fill('#pv-dep-uf', 'ba');
    await pg.click('#pv-registrar');
    await pg.waitForFunction(n => Object.keys(state.pedidosVagas).length === n, 4);
    const cm = JSON.parse(fb.gravacoes[antes].corpo);
    ok(cm.depId === 'm_carlos-novo-eleito' && cm.depNome === 'Carlos Novo Eleito' && cm.depUf === 'BA' && cm.legislatura === legAtualPg + 1 && cm.tipo === 'titular' && cm.sigla === 'CE',
      'deputado digitado: gravado com nome, UF e a próxima legislatura');
    // Ana (titular na CCJC hoje) pede titular na CFT para a próxima: aceito
    await pg.selectOption('#pv-leg', String(legAtualPg + 1));
    await pg.selectOption('#pv-dep', 'a1'); await pg.selectOption('#pv-com', 'CFT'); await pg.selectOption('#pv-tipo', 'titular'); await pg.click('#pv-registrar');
    await pg.waitForFunction(n => Object.keys(state.pedidosVagas).length === n, 5);
    ok(true, 'titular na CCJC hoje pede titular na CFT para a próxima legislatura: registrado');
    // o digitado aparece na lista de deputados para o próximo pedido, e o mesmo nome digitado de novo é o mesmo id
    const opcDig = await pg.$$eval('#pv-dep optgroup[label="Digitados em pedidos anteriores"] option', os => os.map(o => o.value + '=' + o.textContent));
    ok(opcDig.join() === 'm_carlos-novo-eleito=Carlos Novo Eleito (BA)', 'o deputado digitado passa a aparecer na lista ("Digitados em pedidos anteriores")');
    await pg.selectOption('#pv-leg', String(legAtualPg + 1));
    await pg.selectOption('#pv-dep', '__manual'); await pg.fill('#pv-dep-nome', 'carlos novo eleito'); await pg.selectOption('#pv-com', 'CE'); await pg.selectOption('#pv-tipo', 'titular'); await pg.click('#pv-registrar');
    ok(/Já há um pedido pendente de titular em CE para este deputado na \d+ª legislatura/.test(await pg.textContent('#pv-erro')), 'o mesmo nome digitado de novo é o mesmo deputado: o pedido repetido é recusado');
    const linhaDig = (await pg.$$eval('.pv-tabela tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()))).find(l => /Carlos Novo Eleito/.test(l)) || '';
    ok(/Carlos Novo Eleito \(BA\) · digitado \d+ª 1ª CE/.test(linhaDig), `na tabela: nome, UF, "digitado", legislatura e preferência (${linhaDig})`);

    await pg.click('[data-pv-filtro=""]');
    const filtros = await pg.$$eval('[data-pv-filtro]', es => es.map(e => e.querySelector('.com-item-nome').textContent + ' ' + e.querySelector('.com-item-badge').textContent).join(' | '));
    ok(filtros === 'Pendentes 4 | Atendidos 1 | Negados 0 | Todos 5', `contagens por situação atualizadas (${filtros})`);
    ok(!fb.erros.length, `sem erro de JavaScript na página${fb.erros.length ? ': ' + fb.erros.join(' | ') : ''}`);
    await b.close(); srv.close();
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
