// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Comissões · Pedidos de vagas (comissoes-pedidos-vagas.js + aba "Pedidos" em comissoes.html / comissoes.js).
//
// Pedido de 24/11/2026: registrar quais deputados pediram vaga em quais Comissões Permanentes, com tipo de vaga,
// ordem de preferência e situação; inacumulabilidade (RICD, art. 26, § 2º) verificada NO REGISTRO.
// Ajuste de 24/11/2026: o conflito não bloqueia mais — alerta quem cadastra e fica marcado ao lado do nome do deputado.
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
  ok(r.ok && r.conflitos.map(c => c.sigla + ':' + c.origem).join() === 'CCJC:composicao' && /já é titular em CCJC/.test(r.alerta) && /RICD, art\. 26, § 2º/.test(r.alerta) && /pode ser registrado/.test(r.alerta),
    'titular na CCJC pede titular na CFT: REGISTRÁVEL, com alerta do conflito (comissão e artigo)');
  ok(!v({ depId: '1', sigla: 'CE', tipo: 'suplente' }).conflitos.length && !v({ depId: '3', sigla: 'CE', tipo: 'titular' }).conflitos.length && !v({ depId: '1', sigla: 'CCULT', tipo: 'titular' }).conflitos.length,
    'sem conflito: suplência, deputado sem titularidade, comissão ressalvada');
  ok(v({ depId: '1', sigla: 'CFT', tipo: 'suplente' }).ok === false && /já é suplente em CFT/.test(v({ depId: '1', sigla: 'CFT', tipo: 'suplente' }).erro), 'já é suplente na CFT: não pede suplência de novo');
  ok(v({ depId: '1', sigla: 'CE', tipo: 'suplente' }).ok, 'suplência numa inacumulável: aceita (o limite é só para titular)');
  ok(v({ depId: '1', sigla: 'CCULT', tipo: 'titular' }).ok, 'titular numa ressalvada (Cultura), sendo titular na CCJC: aceito');
  ok(v({ depId: '2', sigla: 'CCJC', tipo: 'titular' }).ok, 'titular só em ressalvada (Cultura) pede titular na CCJC: aceito');
  ok(/já é titular em CCJC/.test(v({ depId: '1', sigla: 'CCJC', tipo: 'titular' }).erro), 'já é titular na própria comissão: recusado');
  ok(v({ depId: '3', sigla: 'CCJC', tipo: 'titular' }).ok && v({ depId: '3', sigla: 'CFT', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'pendente' }]).ok,
    'sem titularidade: pode pedir titular em duas inacumuláveis como opções (pendentes)');
  r = v({ depId: '3', sigla: 'CFT', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'atendido' }]);
  ok(r.ok && r.conflitos[0].origem === 'atendido' && /já é titular em CCJC \(pedido atendido, \d+ª legislatura\)/.test(r.alerta), 'pedido de titular já ATENDIDO numa inacumulável conta como titularidade: conflito com a outra');
  ok(!PV.pvConflitosInacumulaveis({ id: 'x', depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'atendido' }, ctx([{ id: 'x', depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'atendido' }])).length,
    'o pedido atendido não conflita com ele mesmo');
  ok(PV.pvNovoRegistro({ depId: '1', sigla: 'CFT', tipo: 'titular', ordem: 1, legislatura: 57, conflitos: [{ sigla: 'CCJC', origem: 'composicao' }] }, '2026-11-24T12:00:00.000Z').conflitoRegistro.join() === 'CCJC'
    && !('conflitoRegistro' in PV.pvNovoRegistro({ depId: '3', sigla: 'CE', tipo: 'titular', ordem: 1, legislatura: 57 }, '2026-11-24T12:00:00.000Z')),
    'o registro guarda o colegiado em conflito no momento do cadastro (só quando há)');
  ok(/Já há um pedido pendente de titular em CCJC/.test(v({ depId: '3', sigla: 'CCJC', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'pendente' }]).erro), 'pedido pendente igual: recusado');
  ok(v({ depId: '3', sigla: 'CCJC', tipo: 'titular' }, [{ depId: '3', sigla: 'CCJC', tipo: 'titular', situacao: 'negado' }]).ok, 'pedido igual já negado não impede um novo');
  ok(/Comissão Permanente/.test(v({ depId: '3', sigla: 'CPIXYZ', tipo: 'titular' }).erro), 'só Comissões Permanentes');
  ok(/preferência vai de 1 a 10/.test(v({ depId: '3', sigla: 'CE', tipo: 'titular', ordem: 11 }).erro), 'preferência de 1 a 10');

  console.log('\n== 2b. legislatura e deputado digitado (24/11/2026) ==');
  ok(PV.pvLegislaturaDe(new Date(2026, 10, 24)) === 57 && PV.pvLegislaturaDe(new Date(2027, 0, 31)) === 57 && PV.pvLegislaturaDe(new Date(2027, 1, 1)) === 58,
    'legislatura pela data: a 58ª começa em 1º/2/2027');
  ok(PV.pvLegislaturaPadrao(new Date(2026, 10, 24)) === 58 && PV.pvLegislaturaPadrao(new Date(2026, 5, 1)) === 57, 'o formulário oferece a próxima a partir de outubro do ano da eleição');
  ok(v({ depId: '1', sigla: 'CFT', tipo: 'titular', legislatura: 58 }).ok && !v({ depId: '1', sigla: 'CFT', tipo: 'titular', legislatura: 58 }).conflitos.length, 'titular na CCJC HOJE pede titular na CFT para a 58ª: aceito (a composição de hoje não vale para a próxima)');
  r = v({ depId: '1', sigla: 'CFT', tipo: 'titular', legislatura: 58 }, [{ depId: '1', sigla: 'CE', tipo: 'titular', situacao: 'atendido', legislatura: 58 }]);
  ok(r.ok && /já é titular em CE \(pedido atendido, 58ª legislatura\)/.test(r.alerta), 'na 58ª, pedido de titular já atendido para a 58ª dá conflito com outra inacumulável');
  ok(!v({ depId: '3', sigla: 'CFT', tipo: 'titular', legislatura: 57 }, [{ depId: '3', sigla: 'CE', tipo: 'titular', situacao: 'atendido', legislatura: 58 }]).conflitos.length, 'o atendido da 58ª não dá conflito com pedido da 57ª');
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

  console.log('\n== 3b. atendido nomeia (plano) ==');
  const pl = (reg, o = {}) => PV.pvPlanoAtendimento(Object.assign({ depId: 'd', sigla: 'CFT', tipo: 'titular', legislatura: 57 }, reg), Object.assign({
    legAtual: 57, cadastrado: true, membros: { titulares: [], suplentes: [] }, vagasLivres: () => 1, conflito: () => null }, o));
  ok(pl({}).acao === 'nomear' && !pl({}).sairDaSuplencia, 'cadastrado, vaga livre, sem conflito: nomeia');
  ok(pl({}, { membros: { titulares: [], suplentes: ['CFT'] } }).sairDaSuplencia === true, 'suplente na CFT atendido como titular: nomeia e sai da suplência');
  ok(pl({ legislatura: 58 }).acao === 'so-marcar' && /58ª legislatura/.test(pl({ legislatura: 58 }).motivo), 'pedido da próxima legislatura: só marca');
  ok(pl({}, { cadastrado: false }).acao === 'so-marcar' && /digitado/.test(pl({}, { cadastrado: false }).motivo), 'deputado digitado: só marca');
  ok(pl({}, { conflito: () => 'CCJC' }).acao === 'bloqueio' && /titular em CCJC, comissão inacumulável/.test(pl({}, { conflito: () => 'CCJC' }).motivo), 'conflito de inacumulabilidade: não nomeia (pergunta)');
  ok(pl({}, { vagasLivres: () => 0 }).acao === 'bloqueio' && /não há vaga de titular/.test(pl({}, { vagasLivres: () => 0 }).motivo), 'sem vaga do partido: não nomeia (pergunta)');
  ok(pl({ tipo: 'suplente' }, { membros: { titulares: [], suplentes: ['CFT'] } }).acao === 'ja', 'já está na composição: só marca');
  ok(pl({ tipo: 'suplente' }, { membros: { titulares: ['CFT'], suplentes: [] } }).acao === 'bloqueio', 'pedido de suplência de quem já é titular ali: não nomeia');

  console.log('\n== 3c. relatório (PDF) ==');
  const todosR = [
    { id: 'p1', depId: 'a1', sigla: 'CFT', tipo: 'titular', ordem: 1, legislatura: 57, situacao: 'pendente', data: '2026-11-24T10:00:00Z' },
    { id: 'p2', depId: 'a1', sigla: 'CE', tipo: 'suplente', ordem: 2, legislatura: 57, situacao: 'atendido', data: '2026-11-24T10:00:00Z', nomeacao: { sigla: 'CE', tipo: 'suplente' } },
    { id: 'p3', depId: 'b2', sigla: 'CFT', tipo: 'suplente', ordem: 1, legislatura: 57, situacao: 'pendente', data: '2026-11-23T10:00:00Z' },
    { id: 'p4', depId: 'm_x', depNome: 'Novo <Eleito>', depUf: 'BA', sigla: 'CCJC', tipo: 'titular', ordem: 1, legislatura: 58, situacao: 'pendente', data: '2026-11-24T10:00:00Z' },
  ];
  const depsR = { a1: { nome: 'Ana Teste', uf: 'SP' }, b2: { nome: 'Bruno Teste', uf: 'PR' } };
  const ctxR = { todos: todosR, permanentes: PERMANENTES, grupos: GRUPOS, legAtual: 57, membrosDe: id => (id === 'a1' ? { titulares: ['CCJC'], suplentes: ['CE'] } : { titulares: [], suplentes: [] }),
    deputadoDe: x => (depsR[x.depId] ? Object.assign({ manual: false }, depsR[x.depId]) : { nome: x.depNome, uf: x.depUf, manual: true }),
    vagas: (sg, t) => ({ livres: t === 'titular' ? 1 : 0, total: 2 }), filtroRotulo: 'de todas as situações', hojeBR: '24/11/2026', logo: null };
  const html = PV.pvHtmlRelatorio(todosR, ctxR);
  const txt = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok(/Pedidos de vagas nas Comissões Permanentes/.test(txt) && /Pedidos de todas as situações · 4 pedido\(s\) · gerado em 24\/11\/2026/.test(txt), 'cabeçalho com o filtro, o total e a data');
  ok(/57ª legislatura \(atual\)/.test(txt) && /58ª legislatura \(próxima\)/.test(txt) && html.indexOf('57ª legislatura') < html.indexOf('58ª legislatura') && /class="quebra"/.test(html), 'uma parte por legislatura (atual, depois a próxima, em página nova)');
  ok((txt.match(/Por comissão/g) || []).length === 2 && (txt.match(/Por deputado/g) || []).length === 2, 'em cada legislatura: por comissão e por deputado');
  ok(/CFT · Finanças e Tributação inacumulável 1 pedido\(s\) de titular · 1 de suplente — vagas do partido livres hoje: titular 1 de 2, suplente 0 de 2/.test(txt), 'por comissão: pedidos por tipo e vagas livres do partido (legislatura atual)');
  ok(!/CCJC · Constituição[^]*?vagas do partido/.test(txt.slice(txt.indexOf('58ª legislatura'), txt.indexOf('Por deputado', txt.indexOf('58ª legislatura')))), 'na próxima legislatura, sem vagas (não há composição)');
  ok(/<span class="tag t-conf">⚠ CCJC<\/span>/.test(html) && (html.match(/t-conf">⚠ CCJC/g) || []).length === 2 + 0, 'o pedido em conflito leva o selo vermelho com o colegiado (na parte por comissão e na por deputado)');
  ok(/Ana Teste \(SP\) Hoje: titular em CCJC · suplente em CE/.test(txt) && /Atendido · nomeado/.test(txt), 'por deputado: onde já é titular/suplente e a marca de nomeado');
  ok(/Novo &lt;Eleito&gt;/.test(html) && !/Novo <Eleito>/.test(html) && /· digitado/.test(txt), 'deputado digitado, com o nome escapado');
  ok(txt.indexOf('Bruno Teste') > 0 && txt.indexOf('Ana Teste', txt.indexOf('Por deputado')) < txt.indexOf('Bruno Teste', txt.indexOf('Por deputado')), 'deputados em ordem alfabética');
  ok(/Nenhum pedido neste filtro/.test(PV.pvHtmlRelatorio([], ctxR)), 'filtro vazio: diz que não há pedidos');

  console.log('\n== 4. no navegador: aba "Pedidos", registro e alerta ==');
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
    const DADOS = { '/deputados': { a1: { nome: 'Ana Teste', uf: 'SP' }, b2: { nome: 'Bruno Teste', uf: 'PR' } }, '/membros': { CCJC: { titulares: ['a1'], suplentes: [] } }, '/config': { CFT: { titular: 2, suplente: 2 } } };
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
    const alerta = await pg.evaluate(() => ({ vis: document.getElementById('pv-alerta').style.display, txt: document.getElementById('pv-alerta').textContent }));
    ok(alerta.vis === '' && /já é titular em CCJC/.test(alerta.txt) && /CFT também é comissão/.test(alerta.txt), 'ao escolher titular na CFT, o formulário já alerta o conflito com a CCJC');
    // na confirmação, "Cancelar": nada é gravado
    const dialogos = []; let aceitar = false;
    pg.on('dialog', d => { if (d.type() !== 'confirm') return d.dismiss(); dialogos.push(d.message()); return aceitar ? d.accept() : d.dismiss(); });
    await pg.click('#pv-registrar');
    await pg.waitForTimeout(150);
    ok(dialogos.length === 1 && /Inacumulabilidade/.test(dialogos[0]) && /titular em CCJC/.test(dialogos[0]) && /Registrar o pedido mesmo assim\?/.test(dialogos[0]) && !fb.gravacoes.length,
      'ao registrar, pede confirmação com o conflito; cancelado, nada é gravado');

    // como suplente, passa sem alerta
    await pg.selectOption('#pv-tipo', 'suplente');
    ok(await pg.$eval('#pv-alerta', e => e.style.display) === 'none', 'suplente: o alerta some');
    await pg.click('#pv-registrar');
    await pg.waitForFunction(() => Object.keys(state.pedidosVagas).length === 1);
    ok(dialogos.length === 1, 'suplente: registra sem pedir confirmação');
    const g1 = fb.gravacoes[0], c1 = JSON.parse(g1.corpo);
    ok(g1.met === 'PUT' && /^\/pedidos-vagas\/pv_\d+$/.test(g1.caminho) && c1.depId === 'a1' && c1.sigla === 'CFT' && c1.tipo === 'suplente' && c1.ordem === 1 && c1.situacao === 'pendente',
      'suplente na CFT: gravado em /pedidos-vagas (interceptado no teste), pendente, 1ª preferência');

    // titular na CFT, confirmando: gravado com o conflito, e a lista mostra o colegiado ao lado do nome
    aceitar = true;
    await pg.selectOption('#pv-leg', String(await pg.evaluate(() => pvLegislaturaDe())));
    await pg.selectOption('#pv-dep', 'a1'); await pg.selectOption('#pv-com', 'CFT'); await pg.selectOption('#pv-tipo', 'titular');
    await pg.click('#pv-registrar');
    await pg.waitForFunction(() => Object.keys(state.pedidosVagas).length === 2);
    const cConf = JSON.parse(fb.gravacoes[1].corpo);
    ok(dialogos.length === 2 && cConf.tipo === 'titular' && cConf.sigla === 'CFT' && cConf.conflitoRegistro.join() === 'CCJC', 'confirmado: o pedido é gravado, com o colegiado em conflito (conflitoRegistro: CCJC)');
    const linhaAna = (await pg.$$eval('.pv-tabela tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()))).find(l => /^Ana Teste.*Titular/.test(l)) || '';
    ok(/^Ana Teste \(SP\) ⚠ CCJC /.test(linhaAna), `na lista, ao lado do nome: badge "⚠ CCJC" (${linhaAna})`);
    const badge = await pg.evaluate(() => { const e = [...document.querySelectorAll('.pv-conflito')][0]; const cs = getComputedStyle(e); return { txt: e.textContent, bg: cs.backgroundColor, dica: e.title }; });
    ok(badge.txt === '⚠ CCJC' && badge.bg === 'rgb(192, 57, 43)' && /já é titular em CCJC/.test(badge.dica), `badge vermelho com o colegiado, explicação na dica (${badge.bg})`);
    // limpeza: o pedido de titular da Ana sai, para o resto do roteiro seguir como antes
    const idAnaTit = await pg.evaluate(() => Object.entries(state.pedidosVagas).find(([, r]) => r.depId === 'a1' && r.tipo === 'titular')[0]);
    await pg.click(`[data-pv-del="${idAnaTit}"]`);
    await pg.waitForFunction(() => Object.keys(state.pedidosVagas).length === 1);

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
    ok(novo.ok && /já é titular em CCJC \(pedido atendido, \d+ª legislatura\)/.test(novo.alerta), 'com a CCJC atendida, novo pedido de titular em outra inacumulável vem com o alerta');
    const linhaCft = (await pg.$$eval('.pv-tabela tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()))).find(l => /^Bruno Teste.*CFT/.test(l)) || '';
    const linhaCcjc = (await pg.$$eval('.pv-tabela tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()))).find(l => /^Bruno Teste.*\dª CCJC/.test(l)) || '';
    ok(/⚠ CCJC/.test(linhaCft) && !/⚠/.test(linhaCcjc), `atendida a CCJC, o pedido pendente da CFT passa a mostrar o conflito; o atendido, não (${linhaCft})`);
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
    // ATENDIDO NOMEIA: o pedido de suplente da Ana na CFT (legislatura atual) — vira suplente na composição
    const idAnaSup = await pg.evaluate(() => Object.entries(state.pedidosVagas).find(([, r]) => r.depId === 'a1' && r.sigla === 'CFT' && r.tipo === 'suplente')[0]);
    const nGrav = fb.gravacoes.length, nDlg = dialogos.length;
    await pg.click(`[data-pv-sit="atendido"][data-pv-id="${idAnaSup}"]`);
    await pg.waitForFunction(id => state.pedidosVagas[id].situacao === 'atendido', idAnaSup);
    const gMem = fb.gravacoes.slice(nGrav).find(g => g.caminho === '/membros/CFT');
    const est = await pg.evaluate(id => ({ sup: (state.membros.CFT || {}).suplentes || [], nom: state.pedidosVagas[id].nomeacao, toast: document.getElementById('toast').textContent }), idAnaSup);
    ok(gMem && JSON.parse(gMem.corpo).suplentes.includes('a1') && est.sup.includes('a1') && est.nom && est.nom.sigla === 'CFT' && est.nom.tipo === 'suplente' && dialogos.length === nDlg,
      'Atendido: a Ana é nomeada suplente na CFT (gravado em /membros/CFT), sem perguntar, e o pedido guarda a nomeação');
    ok(/Ana Teste nomeado suplente em CFT/.test(est.toast), `aviso da nomeação (${est.toast})`);
    // o atendido da próxima legislatura (Bruno, CCJC) não mexeu na composição
    ok(!fb.gravacoes.some(g => g.caminho === '/membros/CCJC') && !(await pg.evaluate(() => (state.membros.CCJC.titulares || []).includes('b2'))), 'pedido da próxima legislatura atendido: a composição de hoje não muda');
    // reabrir: pergunta se tira da composição; OK tira
    await pg.click('[data-pv-filtro="atendido"]');
    await pg.click(`[data-pv-sit="pendente"][data-pv-id="${idAnaSup}"]`);
    await pg.waitForFunction(id => state.pedidosVagas[id].situacao === 'pendente', idAnaSup);
    const depois = await pg.evaluate(id => ({ sup: (state.membros.CFT || {}).suplentes || [], nom: state.pedidosVagas[id].nomeacao }), idAnaSup);
    ok(/foi nomeado suplente em CFT por este pedido/.test(dialogos[dialogos.length - 1]) && !depois.sup.includes('a1') && !depois.nom, 'Reabrir um atendido que nomeou: pergunta e, confirmado, tira da composição');

    // relatório: abre a janela com o documento
    await pg.click('[data-pv-filtro=""]');
    const [pop] = await Promise.all([pg.waitForEvent('popup'), pg.click('#pv-relatorio')]);
    await pop.waitForFunction(() => /Pedidos de vagas nas Comissões Permanentes/.test(document.body && document.body.textContent || ''), null, { timeout: 15000 });
    const rel = await pop.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    ok(/Pedidos de todas as situações · 5 pedido\(s\)/.test(rel) && /Por comissão/.test(rel) && /Por deputado/.test(rel) && /Carlos Novo Eleito/.test(rel), 'botão "Relatório (PDF)": abre o documento com os pedidos do filtro da tela');
    await pop.close();

    ok(!fb.erros.length, `sem erro de JavaScript na página${fb.erros.length ? ': ' + fb.erros.join(' | ') : ''}`);
    await b.close(); srv.close();
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
