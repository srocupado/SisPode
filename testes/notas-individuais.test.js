// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';
// Notas Técnicas Individuais (notas-individuais.js; analise.html?modo=notas) — pedido de 25/11/2026.
//
// A equipe recebe pedidos de análise de projetos fora da pauta e produzia o material por fora. O módulo é a
// página do Plenário em outro modo: a nota sai pelo mesmo caminho de um item de pauta e fica no mesmo acervo.
//
// O que se testa:
//   1. as funções sem tela: nomes de servidor, leitura do que foi digitado, chaves, registro, linhas da lista;
//   2. a ligação com o Plenário e com o painel (leitura do código);
//   3. a página real, no Chromium, com a rede trocada por um Firebase em memória e respostas da Câmara e do
//      Senado: escolher o servidor e manter a lista do módulo, "Minhas notas" × as dos demais, abrir a nota como
//      card do Plenário, criar por número, por palavras, do Senado e de texto sem número, usar em pauta, remover;
//   4. no Plenário: o item de pauta avisa que a proposição já tem nota no acervo e passa a usá-la no clique.
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..'), FX = path.join(__dirname, 'fixtures', 'senado');
const N = require(path.join(RAIZ, 'notas-individuais.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const fx = f => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
const ANO = String(new Date().getFullYear());

(async () => {
  console.log('\n== 1. funções sem tela ==');
  ok(N.niMesmoServidor('Vinicius L', 'Vinícius Lára') && N.niMesmoServidor('PEDRO RIBEIRO', 'pedro  ribeiro') && N.niMesmoServidor('Pedro', 'Pedro Ribeiro'),
    'mesmo servidor: sem acento e sem caixa, ou um nome é o começo do outro (o bot grava "Vinicius L")');
  ok(!N.niMesmoServidor('Ana', 'Ana Paula') && !N.niMesmoServidor('Daniel Roriz', 'Daniel Rocha') && !N.niMesmoServidor('', 'Pedro'), 'não confunde: prefixo curto, sobrenome diferente, nome vazio');
  ok(JSON.stringify(N.niListaServidores(['Pedro Ribeiro', ' pedro ribeiro ', '', null, 'Maria  Exemplo'])) === '["Pedro Ribeiro","Maria Exemplo"]', 'lista de servidores: sem vazios nem repetidos');
  const le = t => JSON.stringify(N.niLerEntrada(t));
  ok(le('PL 1234/2025') === '{"sigla":"PL","numero":"1234","ano":"2025"}' && le('plp nº 12, de 2024') === '{"sigla":"PLP","numero":"12","ano":"2024"}' && le('PEC 6 2019') === '{"sigla":"PEC","numero":"6","ano":"2019"}' && le('MP 1.300/2026') === '{"sigla":"MPV","numero":"1300","ano":"2026"}',
    'lê "PL 1234/2025", "plp nº 12, de 2024", "PEC 6 2019" e "MP 1.300/2026" (vira MPV)');
  ok(le('https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2562481') === '{"idCamara":2562481}' && le('https://www.camara.leg.br/propostas-legislativas/2562481') === '{"idCamara":2562481}', 'lê o link da ficha de tramitação e o do portal');
  ok(N.niLerEntrada('mercados digitais') === null && N.niLerEntrada('PL 0/2025') === null && N.niLerEntrada('') === null, 'o que não é número nem link devolve nulo');
  ok(N.niChave({ sigla: 'PL', numero: '5', ano: '2025' }) === 'PL-5-2025' && N.niChave({ entrada: 'senado', sigla: 'PL', numero: '5', ano: '2025' }) === 'SF-PL-5-2025',
    'chave: a da Câmara é a do item de pauta; a do Senado tem prefixo (o mesmo número pode ser outra proposição na Câmara)');
  ok(N.niProximaMinuta({}, '2026') === 1 && N.niProximaMinuta({ 'MINUTA-1-2026': {}, 'MINUTA-7-2026': {}, 'MINUTA-9-2025': {}, 'PL-30-2026': {} }, '2026') === 8, 'minuta: o próximo número do ano');
  const reg = N.niRegistro({ entrada: 'camara', sigla: 'PL', numero: 12, ano: 2025, idCamara: 77, ementa: '  Institui   algo. ', responsavel: 'Maria Exemplo' }, 'Vinícius Lára', new Date('2026-11-25T12:00:00Z'));
  ok(reg.responsavel === 'Maria Exemplo' && reg.pedidoPor === 'Vinícius Lára' && reg.pedidoEm === '2026-11-25T12:00:00.000Z' && reg.numero === '12' && reg.ementa === 'Institui algo.' && reg.origem === 'painel' && reg.idCamara === 77,
    'registro: responsável, quem criou, data, ementa limpa — com os campos que o bot já usa (pedidoPor, pedidoEm)');
  ok(N.niDoServidor({ pedidoPor: 'Vinicius L' }, 'Vinícius Lára') && N.niDoServidor(reg, 'maria exemplo') && !N.niDoServidor(reg, 'Vinícius Lára'), 'de quem é a nota: o responsável; sem ele, quem pediu');
  const itS = N.niItem({ sigla: 'PL', numero: '5', ano: '2025', entrada: 'senado', responsavel: 'A' }, 'SF-PL-5-2025');
  const itT = N.niItem({ sigla: 'MINUTA', numero: '2', ano: '2026', entrada: 'texto', titulo: 'Minuta X' }, 'MINUTA-2-2026');
  const itB = N.niItem({ sigla: 'PL', numero: 9, ano: 2025, pedidoPor: 'Vinicius L' }, 'PL-9-2025');
  ok(itS.fonteSenado === true && itS.chave === 'SF-PL-5-2025' && itT.textoProprio.titulo === 'Minuta X' && itT.ementa === 'Minuta X' && !itB.fonteSenado && !itB.textoProprio && itB.analista === 'Vinicius L' && itB.numero === '9',
    'item do painel: marca de matéria do Senado, de texto sem número, e o responsável (registro do bot: quem pediu)');
  ok(N.niRotulo({ sigla: 'MINUTA', numero: '2', ano: '2026' }, 'MINUTA-2-2026') === 'Minuta 2/2026' && N.niRotulo({ sigla: 'PL', numero: '5', ano: '2025' }, 'SF-PL-5-2025') === 'PL 5/2025 (Senado)', 'rótulos: "Minuta 2/2026" e "PL 5/2025 (Senado)"');
  const recente = N.niNotaMaisRecente({ 'inteiro-teor': { markdown: 'a', geradoEm: '2026-11-01T00:00:00Z' }, 'parecer-2026-11-10': { markdown: 'b', geradoEm: '2026-11-10T00:00:00Z' }, x: { markdown: 'c', geradoEm: '2026-10-01T00:00:00Z', editadoEm: '2026-11-20T00:00:00Z' }, lixo: true });
  ok(recente.markdown === 'c' && N.niNotaMaisRecente(null) === null && N.niNotaMaisRecente({ a: { geradoEm: 'x' } }) === null, 'nota mais recente entre as de cada parecer (a edição conta); sem nota, nulo');
  const linha = N.niLinha('PL-9-2025', { sigla: 'PL', numero: 9, ano: 2025, pedidoPor: 'Vinicius L', ementa: 'Ementa' }, { apelido: 'Apelido', geradoEm: '2026-11-10T00:00:00Z', revisado: { por: 'Maria' }, verificacaoIA: {} }, true);
  ok(linha.descricao === 'Apelido' && linha.temNota && linha.temNTA && linha.revisada && linha.revisadaPor === 'Maria' && linha.verificada && linha.responsavel === 'Vinicius L' && N.niLinha('PL-9-2025', { sigla: 'PL', numero: 9, ano: 2025, ementa: 'Ementa' }, null).descricao === 'Ementa',
    'linha da lista: apelido da nota (sem nota, a ementa), produtos, revisão e responsável');
  ok(JSON.stringify(N.niRegistroDaChave('PLP-73-2025')) === '{"sigla":"PLP","numero":"73","ano":"2025","entrada":"camara"}' && N.niRegistroDaChave('SF-PL-5-2025').entrada === 'senado' && N.niRegistroDaChave('REQ-sn-PL5902-2023-2026') === null,
    'nota que só existe no acervo das pautas: o registro sai da chave; chave fora do padrão fica de fora');
  ok(N.niFiltrar([linha, { ...linha, rotulo: 'PL 1/2020', descricao: 'Outra', responsavel: 'Zé', chave: 'PL-1-2020' }], 'apeli').length === 1 && N.niFiltrar([linha], 'VINICIUS').length === 1 && N.niFiltrar([linha], '').length === 1, 'busca na lista: por apelido e por responsável, sem acento');
  const aviso = N.niAvisoAcervo({ geradoEm: '2026-11-24T20:45:00Z', analista: 'Vinicius L', documentos: [{ rotulo: 'PRLP nº 2 de 23/11/2026' }] }, true);
  ok(/já tem nota individual no acervo de 24\/11\/2026, de Vinicius L, feita sobre: PRLP nº 2 de 23\/11\/2026\./.test(aviso), 'aviso no Plenário: quando, de quem e sobre que documentos a nota foi feita');

  console.log('\n== 2. ligação com o Plenário e com o painel (código) ==');
  const an = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8'), pn = fs.readFileSync(path.join(RAIZ, 'panel.js'), 'utf8'), html = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8');
  ok(/<script src="notas-individuais\.js"><\/script>\s*<script src="analise\.js">/.test(html), 'analise.html carrega notas-individuais.js antes do analise.js');
  ok(/id:\s+'notas',\s+titulo: 'Notas Técnicas Individuais'/.test(pn) && /acao:\s+abrirNotasIndividuais/.test(pn) && /getURL\('analise\.html\?modo=notas'\)/.test(pn), 'painel: módulo "Notas Técnicas Individuais" abre analise.html?modo=notas');
  ok(/if \(niModoAtivo\(\)\) \{\s+await niIniciar\(\);/.test(an) && /if \(niModoAtivo\(\)\) return;\s+\/\/ no módulo de notas individuais a barra lateral/.test(an), 'no modo de notas a página não lista pautas nem abre a última');
  ok(/fonteSenado: it\.fonteSenado \|\| null,\s+textoProprio: it\.textoProprio \|\| null,/.test(an), 'a pauta gravada guarda as marcas do item vindo das notas individuais');
  ok(/if \(it\.textoProprio\) return \[\];\s+if \(it\.fonteSenado\) return \(it\.provisorio\?\.senado\?\.documentos/.test(an), 'documentos: texto sem número não consulta ninguém; matéria do Senado usa só os documentos de lá');
  ok(/if \(state\.pauta\?\.notaIndividual\) return niAoRemover\(it\);/.test(an) && an.indexOf('return niAoRemover(it);') < an.indexOf("const pk = parecerKey(it);\n  fetch(`${FIREBASE_URL}/analises_pauta/"), 'remover no modo de notas não chega ao trecho que apaga a nota');

  console.log('\n== 3. a página, no navegador ==');
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { console.log('  (playwright indisponível: blocos 3 e 4 não executados)'); }
  if (chromium) {
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
    const srv = http.createServer((q, rs) => { const f = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rs); });
    await new Promise(rs => srv.listen(0, '127.0.0.1', rs));
    const base = `http://127.0.0.1:${srv.address().port}`;

    // ---- Firebase em memória
    const nota = (o = {}) => ({ markdown: '## Objetivo\n\nTexto da nota.', apelido: 'Apelido cem', cenario: 'Cenário 1', geradoEm: '2026-11-24T20:45:00.000Z', geradoPor: 'equipe', analista: '', parecerKey: 'inteiro-teor', provedor: 'gemini', modelo: 'gemini-x', truncada: false, documentos: [{ tipo: 'INTEIRO_TEOR', rotulo: 'Redação original (inteiro teor)', url: 'https://www.camara.leg.br/teor100.pdf' }], ...o });
    const itemPauta = (ordem, numero, ano, extra = {}) => ({ ordem, tipoCategoria: 'projeto', sigla: 'PL', numero: String(numero), ano: String(ano), ementa: `Ementa ${numero}`, autorTexto: '', apensadosTexto: [], relator: null, temUrgencia: false, chave: `PL-${numero}-${ano}`, ...extra });
    const fb = {
      analises_avulsas: {
        'PL-100-2025': { sigla: 'PL', numero: 100, ano: 2025, idCamara: 9100, pedidoEm: '2026-11-16T14:30:47.404Z', pedidoPor: 'Vinicius L' },   // como o bot grava
        'PL-200-2025': { sigla: 'PL', numero: '200', ano: '2025', entrada: 'camara', origem: 'painel', responsavel: 'Pedro Ribeiro', pedidoPor: 'Pedro Ribeiro', pedidoEm: '2026-11-20T10:00:00.000Z', ementa: 'Ementa duzentos' },
      },
      analises_pauta: { 'PL-100-2025': { 'inteiro-teor': nota({ verificacaoIA: { corrigidos: [], apontamentos: [] } }) }, 'PL-300-2024': { 'inteiro-teor': nota({ apelido: 'Apelido trezentos', analista: 'Daniel Roriz' }) } },
      pareceres: { 'nota-pl-100-2025__PL-100-2025': { meta: { em: '2026-11-24T21:00:00.000Z', por: 'Vinicius L', modelo: 'modelo-nta', pontos: 0 } } },
      pautas: { p1: { id: 'p1', titulo: 'Pauta — teste', periodo: '25/11/2026', uploadedAt: '2026-11-25T10:00:00.000Z', uploadedBy: 'teste',
        itens: [itemPauta(1, 100, 2025, { relator: { nome: 'Fulano', partido: 'PT', uf: 'SP', data: '10/11/2026' } }), itemPauta(2, 300, 2024)] } },
      plenario_servidores: ['Pedro Ribeiro', 'Vinícius Lára'],
    };
    const noCaminho = k => k.split('/').filter(Boolean).map(decodeURIComponent);
    const fbLer = k => noCaminho(k).reduce((o, p) => (o == null ? null : (o[p] ?? null)), fb);
    const fbGravar = (k, v) => { const ps = noCaminho(k); let o = fb; for (const p of ps.slice(0, -1)) o = o[p] = (o[p] && typeof o[p] === 'object') ? o[p] : {}; const ult = ps.at(-1); if (v === null) { if (Array.isArray(o)) o.splice(Number(ult), 1); else delete o[ult]; } else o[ult] = v; };

    // ---- Câmara: quatro proposições; a de número 100 tem urgência
    const props = { 9100: { n: 100, a: 2025, e: 'Ementa cem', regime: 'Urgência (Art. 155, RICD)' }, 9200: { n: 200, a: 2025, e: 'Ementa duzentos' }, 9300: { n: 300, a: 2024, e: 'Ementa trezentos' }, 9400: { n: 400, a: 2025, e: 'Ementa quatrocentos' } };
    const novaPagina = async (b, { nome = '' } = {}) => {
      const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
      const rede = { escritas: [], pedidos: [], erros: [] };
      pg.on('pageerror', e => rede.erros.push(e.message));
      pg.on('dialog', d => d.accept());
      await pg.addInitScript(n => { window.__cfg = { config: n ? { nomeUsuario: n } : {} }; window.chrome = { storage: { local: { get: (k, cb) => cb(JSON.parse(JSON.stringify(window.__cfg))), set: (o, cb) => { Object.assign(window.__cfg, o); cb && cb(); } } }, runtime: { getURL: u => u, getManifest: () => ({ version: 'teste' }) }, tabs: { create() {} } }; }, nome);
      await pg.route('**/*', async rt => {
        const q = rt.request(), u = q.url(), met = q.method();
        if (u.startsWith(base)) return rt.continue();
        const cab = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS' };
        const json = o => rt.fulfill({ status: 200, contentType: 'application/json', headers: cab, body: JSON.stringify(o) });
        if (met === 'OPTIONS') return rt.fulfill({ status: 204, headers: cab });
        rede.pedidos.push(`${met} ${u}`);
        const f = /firebaseio\.com\/(.+?)\.json(\?.*)?$/.exec(u);
        if (f) {
          if (met === 'GET') { const v = fbLer(f[1]); return json(/shallow=true/.test(f[2] || '') && v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map(k => [k, true])) : v); }
          rede.escritas.push(`${met} ${decodeURIComponent(f[1])}`);
          fbGravar(f[1], met === 'DELETE' ? null : JSON.parse(q.postData() || 'null'));
          return json(met === 'DELETE' ? null : JSON.parse(q.postData() || 'null'));
        }
        if (/camara\.leg\.br\/busca-api\//.test(u)) {
          const src = (id, sg) => ({ _source: { id, siglaProposicao: sg, numero: props[id].n, ano: props[id].a, ementa: props[id].e, txtRegime: 'Ordinário (Art. 151, III, RICD)', qtdeDeAutores: 1, autores: [{ nome: 'Duda Ramos', siglaPartido: 'PODE', siglaUF: 'RR', bolAutorExibir: true }] } });
          return json({ hits: { hits: [src(9400, 'PL'), src(9200, 'PL'), src(9300, 'REQ')] } });
        }
        if (met !== 'GET') return rt.abort();
        let m;
        if ((m = /dadosabertos\.camara\.leg\.br\/api\/v2\/proposicoes\?(.*)/.exec(u))) {
          const qs = new URLSearchParams(m[1]);
          const id = Object.keys(props).find(i => qs.get('siglaTipo') === 'PL' && Number(qs.get('numero')) === props[i].n && Number(qs.get('ano')) === props[i].a);
          return json({ dados: id ? [{ id: Number(id), siglaTipo: 'PL', numero: props[id].n, ano: props[id].a, ementa: props[id].e }] : [] });
        }
        if ((m = /dadosabertos\.camara\.leg\.br\/api\/v2\/proposicoes\/(\d+)$/.exec(u)) && props[m[1]]) {
          const p = props[m[1]];
          return json({ dados: { id: Number(m[1]), siglaTipo: 'PL', numero: p.n, ano: p.a, ementa: p.e, urlInteiroTeor: `https://www.camara.leg.br/teor${p.n}.pdf`, statusProposicao: { regime: p.regime || 'Ordinário (Art. 151, III, RICD)' } } });
        }
        if (/dadosabertos\.camara\.leg\.br/.test(u)) return json({ dados: [] });
        if (/legis\.senado\.leg\.br\/dadosabertos\//.test(u)) {
          if (/processo\?/.test(u)) return json(/numero=299/.test(u) ? fx('processo-lista-plp299.json') : []);
          if (/processo\/documento/.test(u)) return json(fx('processo-documentos-plp299.json'));
          return json(fx('processo-plp299.json'));
        }
        return rt.abort();
      });
      return { pg, rede };
    };
    const b = await chromium.launch();
    const { pg, rede } = await novaPagina(b);
    await pg.goto(base + '/analise.html?modo=notas', { waitUntil: 'load' });
    const linhas = () => pg.$$eval('.ni-tab tbody tr', trs => trs.map(t => t.dataset.chave));
    const lateral = () => pg.$$eval('.ni-filtro', fs2 => fs2.map(f => f.innerText.replace(/\s+/g, ' ').trim()));
    const escritasDe = re => rede.escritas.filter(e => re.test(e));

    // --- quem está usando; a lista do módulo fica em Configurações
    await pg.waitForSelector('#ni-modal-servidor');
    ok(JSON.stringify(await pg.$$eval('.ni-serv-nome', bs => bs.map(x => x.textContent))) === '["Pedro Ribeiro","Vinícius Lára"]' && !(await pg.$('#ni-modal-servidor .modal-close')) && !(await pg.$('#ni-modal-servidor input')),
      'sem nome guardado, a tela pede o servidor e não fecha sem escolha; é só a escolha (sem cadastro), e a lista começa pela do Plenário, como sugestão');
    await pg.click('#ni-modal-servidor [data-ni=config]');
    await pg.waitForFunction(() => document.getElementById('modal-configuracoes').style.display === 'flex' && getComputedStyle(document.querySelector('[data-config-panel="notas-servidores"]')).display !== 'none');
    const cfg = await pg.evaluate(() => ({ abaPlen: getComputedStyle(document.querySelector('.config-tab-btn[data-config-tab="servidores"]')).display, aba: document.querySelector('.config-tab-btn.is-active').textContent, lista: document.getElementById('ni-config-servidores').value, escolha: !!document.getElementById('ni-modal-servidor') }));
    ok(cfg.abaPlen === 'none' && cfg.aba === 'Servidores das notas individuais' && cfg.lista === 'Pedro Ribeiro\nVinícius Lára' && !cfg.escolha,
      'o cadastro fica em Configurações → "Servidores das notas individuais" (a aba dos servidores do Plenário não aparece neste módulo)');
    await pg.fill('#ni-config-servidores', ''); await pg.click('#ni-config-salvar');
    ok(/ao menos um nome/.test(await pg.textContent('#ni-config-st')) && fb.notas_individuais_servidores === undefined, 'lista vazia não é gravada');
    await pg.fill('#ni-config-servidores', 'Vinícius Lára\nMaria Exemplo\n\n maria  exemplo ');
    await pg.click('#ni-config-salvar');
    await pg.waitForFunction(() => /2 servidor\(es\) salvos/.test(document.getElementById('ni-config-st').textContent));
    ok(JSON.stringify(fb.notas_individuais_servidores) === '["Vinícius Lára","Maria Exemplo"]' && JSON.stringify(fb.plenario_servidores) === '["Pedro Ribeiro","Vinícius Lára"]',
      'salvar grava a lista PRÓPRIA do módulo, sem repetidos; a do Plenário não muda');
    await pg.click('#modal-configuracoes .modal-close');
    await pg.waitForSelector('#ni-modal-servidor');
    ok(JSON.stringify(await pg.$$eval('.ni-serv-nome', bs => bs.map(x => x.textContent))) === '["Vinícius Lára","Maria Exemplo"]', 'fechadas as Configurações, a escolha volta com a lista nova');
    await pg.click('.ni-serv-nome >> text=Vinícius Lára');
    await pg.waitForSelector('.ni-tab');
    ok((await pg.evaluate(() => window.__cfg.config.nomeUsuario)) === 'Vinícius Lára' && !(await pg.$('#ni-modal-servidor')), 'o nome escolhido fica guardado no navegador e o diálogo fecha');

    // --- minhas notas × as dos demais
    const lat = await lateral();
    ok(JSON.stringify(await linhas()) === '["PL-100-2025"]' && lat[0] === 'Minhas notas 1' && lat[1] === 'Todas as individuais 2' && /Minhas notas — Vinícius Lára/.test(await pg.textContent('#pauta-titulo')),
      '"Minhas notas" abre só com a do servidor — a pedida pelo bot como "Vinicius L" é dele; a do Pedro fica fora');
    const l1 = await pg.$eval('tr[data-chave="PL-100-2025"]', t => t.innerText.replace(/\s+/g, ' '));
    ok(/PL 100\/2025 Apelido cem/.test(l1) && /✓ Nota técnica/.test(l1) && /✓ NTA/.test(l1) && /Agente revisor/.test(l1) && /24\/11\/2026/.test(l1), 'a linha mostra o apelido, os produtos (nota técnica, NTA, agente revisor) e a data da nota');
    await pg.click('[data-visao=individuais]');
    const l2 = await pg.$eval('tr[data-chave="PL-200-2025"]', t => t.innerText.replace(/\s+/g, ' '));
    ok((await linhas()).length === 2 && /Ementa duzentos/.test(l2) && /○ Nota técnica/.test(l2) && /Pedro Ribeiro/.test(l2), '"Todas as individuais" mostra as duas; a do Pedro, ainda sem nota, aparece com a ementa');
    await pg.fill('#ni-busca', 'pedro');
    ok(JSON.stringify(await linhas()) === '["PL-200-2025"]', 'a busca filtra por responsável');
    await pg.fill('#ni-busca', '');
    await pg.click('[data-visao=equipe]');
    await pg.waitForFunction(() => /pautas do Plenário/.test(document.getElementById('pauta-titulo').textContent) && document.querySelector('.ni-tab'));
    ok(JSON.stringify(await linhas()) === '["PL-300-2024"]' && /Apelido trezentos/.test(await pg.textContent('.ni-tab')), '"Notas das pautas do Plenário": o acervo da equipe, sem repetir as individuais');
    await pg.click('[data-visao=minhas]');

    // --- a nota aberta é um card do Plenário
    await pg.click('tr[data-chave="PL-100-2025"]');
    await pg.waitForFunction(() => state.pauta?.itens?.[0]?.analise && state.pauta.itens[0].parecerMeta && document.querySelector('[data-role=ni-urg]'), null, { timeout: 20000 });
    const ab = await pg.evaluate(() => { const it = state.pauta.itens[0], c = document.querySelector('.an-card'); const vis = s => getComputedStyle(document.querySelector(s)).display !== 'none';
      return { origem: state.pauta.origem, ind: state.pauta.notaIndividual, chave: it.chave, analista: c.querySelector('[data-role=inp-analista]').value, urg: c.querySelector('[data-role=ni-urg]').textContent, nta: c.querySelector('[data-role=btn-abrir-parecer]').style.display, chNTA: chaveParecer(it),
        botoes: ['btn-toggle', 'btn-doc-proprio', 'btn-editar', 'btn-parecer'].map(r => !!c.querySelector(`[data-role=${r}]`)), nota: c.querySelector('[data-role=painel-analise]').innerText.includes('Texto da nota.'),
        selbar: vis('.an-selbar'), num: vis('.an-card-num'), carregar: vis('label[for="input-pauta-pdf"]'), usar: vis('#ni-usar-pauta'), titulo: document.getElementById('pauta-titulo').textContent, meta: document.getElementById('pauta-meta').textContent }; });
    ok(ab.origem === 'avulsa' && ab.ind === true && ab.chave === 'PL-100-2025' && ab.nota && ab.analista === 'Vinicius L' && ab.titulo === 'PL 100/2025' && /Nota individual · responsável: Vinicius L/.test(ab.meta),
      'abrir a nota: um item avulso em memória, com a nota salva carregada e o responsável do registro');
    ok(ab.urg === 'Urgência (Art. 155, RICD)' && ab.nta === 'inline-flex' && ab.chNTA === 'nota-pl-100-2025__PL-100-2025', 'o card traz o selo de urgência (regime na Câmara) e o botão "Abrir NTA" da nota individual');
    ok(!ab.selbar && !ab.num && !ab.carregar && ab.usar, 'o que é de pauta some (seleção para o PDF, número de ordem, "Carregar pauta"); aparece "Usar em pauta"');
    // NTA guardada como PDF pronto (feita fora do sistema): "Abrir NTA" abre o arquivo; não há conferência
    const pdfNta = await pg.evaluate(async () => { const it = state.pauta.itens[0], c = document.querySelector('.an-card'); const abertos = [], abrir = window.open; window.open = u => { abertos.push(String(u)); return {}; };
      const antes = { parecer: it.parecer, meta: it.parecerMeta };
      it.parecer = { versao: 'pdf', arquivo: 'nta.pdf', pdfBase64: btoa('%PDF-1.4 teste'), meta: { em: '2026-11-25T15:00:00.000Z', por: 'Vinicius L', modelo: 'PDF', pdf: true } };
      atualizarBotaoParecer(it);
      const r = { conf: c.querySelector('[data-role=btn-abrir-conferencia]').style.display, titulo: c.querySelector('[data-role=btn-abrir-parecer]').title };
      await abrirParecerEspecialista(it); await abrirParecerEspecialista(it, 'conferencia');
      const tam = abertos[0] ? (await (await fetch(abertos[0])).blob()) : null;
      window.open = abrir; it.parecer = antes.parecer; it.parecerMeta = antes.meta; atualizarBotaoParecer(it);
      return { ...r, abertos, tipo: tam && tam.type, bytes: tam && tam.size, confDepois: c.querySelector('[data-role=btn-abrir-conferencia]').style.display }; });
    ok(pdfNta.abertos.length === 1 && /^blob:/.test(pdfNta.abertos[0]) && pdfNta.tipo === 'application/pdf' && pdfNta.bytes === 14 && pdfNta.conf === 'none' && /NTA\) em PDF, gravada em/.test(pdfNta.titulo) && pdfNta.confDepois === 'inline-flex',
      'NTA gravada em PDF: "Abrir NTA" abre o próprio arquivo, e o botão da conferência não aparece (nas demais, continua)');
    await pg.fill('.an-card [data-role=inp-analista]', 'Maria Exemplo'); await pg.press('.an-card [data-role=inp-analista]', 'Tab');
    await pg.waitForFunction(() => /Maria Exemplo/.test(document.getElementById('pauta-meta').textContent));
    await pg.waitForTimeout(300);
    ok(fb.analises_avulsas['PL-100-2025'].responsavel === 'Maria Exemplo' && fb.analises_pauta['PL-100-2025']['inteiro-teor'].analista === 'Maria Exemplo', 'mudar o responsável no card grava na nota e no registro');
    await pg.click('#ni-volta'); await pg.waitForSelector('.ni-tab, .ni-vazio');
    await pg.waitForFunction(() => document.querySelector('.ni-vazio') && /ainda não tem notas/.test(document.querySelector('.ni-vazio').textContent));
    ok((await lateral())[0] === 'Minhas notas 0', 'a nota passou para a Maria: sai de "Minhas notas" do Vinícius');

    // --- nova nota: por número
    await pg.click('#ni-nova');
    await pg.fill('#ni-n-texto', 'mercados digitais'); await pg.click('[data-ni=buscar-numero]');
    ok(/Não entendi/.test(await pg.textContent('#ni-nova-st')) && await pg.$eval('[data-ni=criar]', x => x.disabled), 'texto que não é número nem link: pede o formato e não deixa criar');
    await pg.fill('#ni-n-texto', 'pl 400 de 2025'); await pg.click('[data-ni=buscar-numero]');
    await pg.waitForFunction(() => document.getElementById('ni-achado').style.display !== 'none');
    ok(/✓ PL 400\/2025 — Ementa quatrocentos/.test(await pg.textContent('#ni-achado')) && /Ainda não está nas notas individuais/.test(await pg.textContent('#ni-achado')) && (await pg.$eval('#ni-resp', s => s.value)) === 'Vinícius Lára',
      'por número: a proposição é conferida na Câmara, e o responsável sugerido é quem está usando');
    await pg.click('[data-ni=criar]');
    await pg.waitForFunction(() => state.pauta?.itens?.[0]?.chave === 'PL-400-2025' && state.pauta.itens[0].enriquecimento?.status === 'ok', null, { timeout: 20000 });
    const r400 = fb.analises_avulsas['PL-400-2025'];
    ok(r400 && r400.responsavel === 'Vinícius Lára' && r400.pedidoPor === 'Vinícius Lára' && r400.entrada === 'camara' && r400.idCamara === 9400 && r400.ementa === 'Ementa quatrocentos' && r400.origem === 'painel',
      'criar grava o registro (o mesmo nó do /avulsa do bot, que a limpeza de notas sem uso respeita) e abre a nota');
    ok(await pg.$eval('.an-card [data-role=btn-gerar]', x => x.style.display !== 'none') && (await pg.textContent('.an-card-ementa')) === 'Ementa quatrocentos', 'nota nova: o card abre com a ementa e o botão "Gerar Análise" do Plenário');

    // --- usar em pauta
    await pg.click('#ni-usar-pauta'); await pg.waitForSelector('#ni-menu-pauta .op');
    ok(/Pauta — teste/.test(await pg.textContent('#ni-menu-pauta')) && /2 itens/.test(await pg.textContent('#ni-menu-pauta')), '"Usar em pauta" lista as pautas salvas');
    await pg.click('#ni-menu-pauta .op');
    await pg.waitForFunction(() => document.body.innerText.includes('Incluída em'));
    const novoItem = fb.pautas.p1.itens[2];
    ok(fb.pautas.p1.itens.length === 3 && novoItem.chave === 'PL-400-2025' && novoItem.ordem === 3 && novoItem.analista === 'Vinícius Lára' && novoItem.ementa === 'Ementa quatrocentos' && JSON.stringify(escritasDe(/pautas\//)) === '["PUT pautas/p1/itens/2"]',
      'a proposição entra no fim da pauta escolhida (um item acrescentado; o resto da pauta não é regravado)');
    await pg.click('#ni-usar-pauta'); await pg.waitForSelector('#ni-menu-pauta .op.ja');
    ok(/já está nesta pauta/.test(await pg.textContent('#ni-menu-pauta')), 'pauta que já tem a proposição aparece marcada e não a recebe de novo');
    await pg.mouse.click(700, 800);

    // --- remover
    await pg.click('.an-card [data-role=btn-remover]');
    ok(/sai das notas individuais\. A nota não é apagada agora/.test(await pg.textContent('#modal-remover .modal-body')), 'remover: o diálogo explica que a proposição sai da lista e a nota não é apagada');
    await pg.click('#btn-confirmar-remover');
    await pg.waitForFunction(() => !document.querySelector('.an-card'));
    ok(!fb.analises_avulsas['PL-400-2025'] && JSON.stringify(escritasDe(/^DELETE/)) === '["DELETE analises_avulsas/PL-400-2025"]', 'remover apaga só o registro; nenhuma nota é apagada');

    // --- consultar a base da Câmara por palavras
    await pg.click('#ni-nova'); await pg.click('.ni-aba[data-aba=busca]');
    await pg.fill('#ni-b-texto', 'mercados digitais'); await pg.click('[data-ni=buscar-palavras]');
    await pg.waitForSelector('.ni-hit');
    const hits = await pg.$$eval('.ni-hit', hs => hs.map(h => h.innerText.replace(/\s+/g, ' ')));
    ok(hits.length === 2 && /^PL 400\/2025 — Ementa quatrocentos Autor: Duda Ramos \(PODE-RR\) · Regime: Ordinário/.test(hits[0]) && rede.pedidos.some(p => /^POST .*busca-api/.test(p)),
      'por palavras: a busca do portal da Câmara devolve as proposições com autor e regime; requerimento fica fora');
    await pg.click('.ni-hit >> nth=1');
    ok(/✓ PL 200\/2025 — Ementa duzentos/.test(await pg.textContent('#ni-achado')) && /Já está nas notas individuais, em nome de Pedro Ribeiro; ainda sem nota\. Criar vai abrir a que existe/.test(await pg.textContent('#ni-achado')) && (await pg.textContent('[data-ni=criar]')) === 'Abrir a nota',
      'proposição que já está nas notas individuais: a tela diz de quem é e abre a que existe, sem criar outra');

    // --- matéria do Senado
    await pg.click('.ni-aba[data-aba=senado]');
    await pg.selectOption('#ni-s-sigla', 'PLP'); await pg.fill('#ni-s-numero', '299'); await pg.fill('#ni-s-ano', '2026'); await pg.click('[data-ni=buscar-senado]');
    await pg.waitForFunction(() => document.getElementById('ni-achado').style.display !== 'none', null, { timeout: 20000 });
    ok(/✓ PLP 299\/2026 \(Senado\) — Altera a Lei Complementar nº 200/.test(await pg.textContent('#ni-achado')) && /Senador Jaques Wagner/.test(await pg.textContent('#ni-achado')), 'Senado: a matéria é localizada lá, com ementa, autor e situação');
    const antes = rede.pedidos.length;
    await pg.click('[data-ni=criar]');
    await pg.waitForFunction(() => state.pauta?.itens?.[0]?.chave === 'SF-PLP-299-2026' && state.pauta.itens[0].enriquecimento?.status === 'ok', null, { timeout: 20000 });
    const sen = await pg.evaluate(async () => { const it = state.pauta.itens[0]; const docs = await escolherDocumentos(it); await verificarAtualizacaoItem(it);
      return { fonte: it.fonteSenado, prov: it.provisorio?.fonteSenado, docs: docs.length, doSenado: docs.every(d => d.doSenado), selo: document.querySelector('[data-role=autoria-flag]').textContent, linha: document.querySelector('[data-role=prov-linha]').innerText, id: it.enriquecimento.idProposicao || null }; });
    const camara299 = rede.pedidos.slice(antes).filter(p => /dadosabertos\.camara|camara\.leg\.br/.test(p));
    ok(fb.analises_avulsas['SF-PLP-299-2026']?.entrada === 'senado' && sen.fonte === true && sen.prov === true && sen.selo === '🏛 Matéria do Senado Federal' && /A análise usa os documentos do Senado \(2\)/.test(sen.linha) && !/Aguardando registro/.test(sen.linha),
      'a nota do Senado tem chave própria (SF-…) e o card diz "Matéria do Senado Federal", não "aguardando registro"');
    ok(sen.docs === 2 && sen.doSenado && sen.id === null && camara299.length === 0, 'os documentos são só os do Senado, e a Câmara não é consultada (lá o mesmo número pode ser outra proposição)');
    await pg.click('#ni-volta'); await pg.waitForSelector('.ni-tab');

    // --- texto sem número
    await pg.click('#ni-nova'); await pg.click('.ni-aba[data-aba=texto]');
    ok(await pg.$eval('[data-ni=criar]', x => x.disabled), 'texto sem número: sem título não cria');
    await pg.fill('#ni-t-titulo', 'Minuta de projeto sobre aviação agrícola');
    await pg.click('[data-ni=criar]');
    await pg.waitForFunction(() => state.pauta?.itens?.[0]?.textoProprio && document.getElementById('modal-doc-analista')?.style.display === 'flex', null, { timeout: 20000 });
    const tx = await pg.evaluate(async () => { const it = state.pauta.itens[0]; return { chave: it.chave, tipo: document.querySelector('.an-card-tipo').textContent, ementa: document.querySelector('.an-card-ementa').textContent, selo: document.querySelector('[data-role=autoria-flag]').textContent, docs: (await escolherDocumentos(it)).length, enr: it.enriquecimento }; });
    const chMin = `MINUTA-1-${ANO}`;
    ok(tx.chave === chMin && tx.tipo === `Minuta 1/${ANO}` && tx.ementa === 'Minuta de projeto sobre aviação agrícola' && tx.selo === 'Texto sem número' && tx.docs === 0 && tx.enr.textoProprio === true && fb.analises_avulsas[chMin]?.entrada === 'texto' && fb.analises_avulsas[chMin].titulo === 'Minuta de projeto sobre aviação agrícola',
      'texto sem número: vira "Minuta 1/ano", não consulta Casa nenhuma e já abre o diálogo para anexar o documento');
    ok(rede.erros.length === 0 && escritasDe(/^(PUT|DELETE) pautas\/p1$/).length === 0 && escritasDe(/analises_pauta/).length === 1, `nenhum erro na página; a "pauta" da nota não é gravada; nas notas, só a mudança de responsável foi escrita${rede.erros.length ? ' — ' + rede.erros[0] : ''}`);
    if (rede.erros.length || escritasDe(/analises_pauta/).length !== 1) console.log('    erros:', rede.erros, '| escritas:', rede.escritas.join(' | '));
    await pg.close();

    console.log('\n== 4. no Plenário: a proposição já tem nota no acervo ==');
    const { pg: pl, rede: redePl } = await novaPagina(b, { nome: 'Daniel Roriz' });
    await pl.goto(base + '/analise.html', { waitUntil: 'load' });
    await pl.waitForSelector('.an-card[data-chave="PL-100-2025"] [data-role=ni-acervo]', { timeout: 20000 });
    const pp = await pl.evaluate(() => { const it = state.pauta.itens.find(i => i.chave === 'PL-100-2025'), c = document.querySelector('.an-card[data-chave="PL-100-2025"]');
      return { titulo: document.querySelector('.header-main').textContent, lateral: document.querySelector('.an-sidebar-titulo').textContent, pk: parecerKey(it), nota: !!it.analise, aviso: c.querySelector('[data-role=ni-acervo]').innerText.replace(/\s+/g, ' '), outro: !!document.querySelector('.an-card[data-chave="PL-300-2024"] [data-role=ni-acervo]'), n: state.pauta.itens.length }; });
    ok(pp.titulo === 'Análise de Pauta de Plenário' && pp.lateral === 'Pautas salvas' && pp.n === 3, 'sem "?modo=notas" a página é o Plenário de sempre, com a pauta — e o item incluído pelo "Usar em pauta"');
    ok(pp.pk === 'parecer-2026-11-10' && !pp.nota && /Esta proposição já tem nota individual no acervo de 24\/11\/2026, de Maria Exemplo, feita sobre: Redação original \(inteiro teor\)\. Usar esta nota/.test(pp.aviso) && !pp.outro,
      'item cujo parecer não tem nota, mas a proposição tem: o card avisa (quando, de quem, sobre que documento) — e só nele');
    await pl.click('.an-card[data-chave="PL-100-2025"] [data-role=ni-usar]');
    await pl.waitForFunction(() => state.pauta.itens.find(i => i.chave === 'PL-100-2025').analise && !document.querySelector('[data-role=ni-acervo]'));
    await pl.waitForTimeout(600);
    const copiada = fb.analises_pauta['PL-100-2025']['parecer-2026-11-10'];
    ok(copiada && copiada.parecerKey === 'parecer-2026-11-10' && /^nota do acervo de 24\/11\/2026$/.test(copiada.reaproveitadaDe) && copiada.markdown.includes('Texto da nota.') && !!fb.analises_pauta['PL-100-2025']['inteiro-teor'],
      '"Usar esta nota": a nota passa a valer para o parecer desta pauta, com a procedência registrada; a original fica como estava');
    const ntaPl = await pl.evaluate(() => { const it = state.pauta.itens.find(i => i.chave === 'PL-100-2025'); return { btn: document.querySelector('.an-card[data-chave="PL-100-2025"] [data-role=btn-abrir-parecer]').style.display, ch: it._chaveParecer || '' }; });
    ok(ntaPl.btn === 'inline-flex' && ntaPl.ch === 'nota-pl-100-2025__PL-100-2025', 'a NTA feita nas notas individuais aparece no item da pauta ("Abrir NTA")');
    ok(redePl.erros.length === 0, `nenhum erro na página do Plenário${redePl.erros.length ? ' — ' + redePl.erros[0] : ''}`);
    await b.close(); srv.close();
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
