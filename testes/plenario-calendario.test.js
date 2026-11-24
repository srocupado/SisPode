// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Calendário do Plenário (plenario-calendario.js + importarPautaPdf em analise.js + botão e diálogo em analise.html).
//
// Pedido de 24/11/2026: o módulo de Plenário só reconhecia a pauta nova com o PDF carregado à mão; agora há
// também o calendário, no padrão da CCJC. Escolhida a sessão, o programa baixa a pauta oficial (o PDF do link
// "Pauta" da página da sessão) e importa pelo mesmo caminho do PDF carregado à mão.
//
// Fixtures (testes/fixtures/plenario-calendario/), respostas reais da Câmara em 24/11/2026:
//   api-eventos-2026-11.json        API /eventos?idOrgao=180, novembro/2026 (23 eventos, 9 sessões deliberativas)
//   sessoes-plen-2026-11-p1/p2.html lista "Sessões e reuniões" do site, idOrgaosSuperiores=180 (as mesmas 23)
//   evento-85464.html               página da sessão deliberativa de 24/11/2026, 13h55 (link da pauta: codteor=3203668)
//   pauta-85464.pdf                 a pauta oficial dessa sessão (13 itens)
// Uso: node testes/plenario-calendario.test.js
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'plenario-calendario');
const fx = n => fs.readFileSync(path.join(FX, n));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const B = require(path.join(RAIZ, 'ccjc-blocos.js'));
Object.assign(global, { buscarEventosMesSite: B.buscarEventosMesSite, linkPautaDoEvento: B.linkPautaDoEvento });
const P = require(path.join(RAIZ, 'plenario-calendario.js'));

const resp = (status, corpo, tipo = 'text/html') => ({
  ok: status === 200, status,
  text: async () => Buffer.from(corpo).toString('utf8'),
  json: async () => JSON.parse(Buffer.from(corpo).toString('utf8')),
  arrayBuffer: async () => { const b = Buffer.from(corpo); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  headers: { get: () => tipo },
});

(async () => {
  console.log('== 1. o que é sessão deliberativa ==');
  ok(P.plenEhDeliberativa('Sessão Deliberativa') && P.plenEhDeliberativa('Sessão para a votação de propostas legislativas Sessão Deliberativa Extraordinária'),
    'API ("Sessão Deliberativa") e site ("Sessão para a votação de propostas legislativas") contam');
  ok(!P.plenEhDeliberativa('Sessão Não Deliberativa Solene') && !P.plenEhDeliberativa('Sessão Não Deliberativa Solene Homenagem'), 'sessão solene ("Não Deliberativa") não conta');

  console.log('\n== 2. sessões do mês: API e, com ela fora, o site ==');
  const urls = [];
  const fetchApi = async u => { urls.push(u); return /dadosabertos/.test(u) ? resp(200, fx('api-eventos-2026-11.json'), 'application/json') : resp(404, ''); };
  const mApi = await P.plenEventosMes(2026, 10, fetchApi);
  const datas = Object.keys(mApi).sort();
  const n = Object.values(mApi).reduce((s, a) => s + a.length, 0);
  ok(/eventos\?idOrgao=180&dataInicio=2026-11-01&dataFim=2026-11-30/.test(urls[0]), 'consulta a API do órgão 180 no mês inteiro');
  ok(n === 9 && !mApi.__fonte, `API: as 9 sessões deliberativas de novembro, sem as solenes (${n})`);
  ok(datas.join() === '2026-11-03,2026-11-04,2026-11-05,2026-11-10,2026-11-11,2026-11-17,2026-11-18,2026-11-23,2026-11-24', 'API: um dia por sessão, nas datas certas');
  ok(mApi['2026-11-24'][0].id === 85464 && /Sessão Deliberativa Extraordinária/.test(mApi['2026-11-24'][0].descricao), 'API: 24/11 é a sessão 85464, com a descrição');

  const fetchSite = async u => {
    if (/dadosabertos/.test(u)) return resp(504, 'Gateway Timeout');
    if (/sessoesereunioes\?idOrgaosSuperiores=180/.test(u)) return resp(200, fx(/pagina=2/.test(u) ? 'sessoes-plen-2026-11-p2.html' : 'sessoes-plen-2026-11-p1.html'));
    return resp(404, '');
  };
  const mSite = await P.plenEventosMes(2026, 10, fetchSite);
  const fonte = mSite.__fonte; delete mSite.__fonte;
  const idsSite = Object.values(mSite).flat().map(e => e.id).sort().join();
  const idsApi = Object.values(mApi).flat().map(e => e.id).sort().join();
  ok(/^site da Câmara \(API: HTTP 504\)$/.test(fonte || ''), 'API em 504: as sessões vêm do site, e o calendário diz a fonte');
  ok(idsSite === idsApi, 'site: as mesmas 9 sessões da API (as duas páginas da lista), sem as solenes');

  // a CCJC continua igual: sem opções, o site é filtrado por "Reunião Deliberativa" no órgão 2003
  let urlCcjc = '';
  await B.buscarEventosMesSite(2026, 10, async u => { urlCcjc = u; return resp(200, '<html></html>'); });
  ok(/idOrgaosSuperiores=2003/.test(urlCcjc), 'calendário da CCJC: sem opções, continua consultando o órgão 2003');

  console.log('\n== 3. a pauta oficial da sessão ==');
  const pedidos = [];
  const fetchPauta = (pagina, pdf) => async u => {
    pedidos.push(u);
    if (/evento-legislativo\/85464$/.test(u)) return resp(200, pagina);
    if (/prop_mostrarintegra\?codteor=3203668$/.test(u)) return resp(200, pdf, 'application/pdf');
    return resp(404, '');
  };
  const pdf = await P.plenPdfDaSessao(85464, fetchPauta(fx('evento-85464.html'), fx('pauta-85464.pdf')));
  ok(pdf && pdf.url === 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3203668' && pdf.buffer.byteLength === fx('pauta-85464.pdf').length,
    'página da sessão → link "Pauta" (codteor=3203668) → o PDF inteiro');
  ok(await P.plenPdfDaSessao(85464, fetchPauta('<html><body>sem pauta</body></html>', '')) === null, 'página sem o link da pauta (ainda não publicada): null, sem erro');
  let erroHtml = '';
  try { await P.plenPdfDaSessao(85464, fetchPauta(fx('evento-85464.html'), '<html>erro</html>')); } catch (e) { erroHtml = e.message; }
  ok(/não devolveu um PDF/.test(erroHtml), 'link que devolve HTML no lugar do PDF: erro dito como tal');
  ok(P.plenNomeArquivo('2026-11-24', { dataHoraInicio: '2026-11-24T13:55' }) === 'pauta-plenario-24-11-2026-13h55.pdf', 'nome do arquivo: data e hora da sessão');

  console.log('\n== 4. no navegador: botão, calendário e importação pelo mesmo caminho do PDF ==');
  const html = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8');
  const iBlocos = html.indexOf('<script src="ccjc-blocos.js"></script>'), iCal = html.indexOf('<script src="plenario-calendario.js"></script>'), iAn = html.indexOf('<script src="analise.js"></script>');
  ok(iBlocos > 0 && iCal > iBlocos && iAn > iCal, 'analise.html carrega ccjc-blocos.js e plenario-calendario.js antes de analise.js');
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { console.log('  (playwright indisponível: bloco 4 não executado)'); }
  if (chromium) {
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
    const srv = http.createServer((q, rs) => { const f = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); rs.end(fs.readFileSync(f)); });
    await new Promise(rs => srv.listen(0, '127.0.0.1', rs));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const b = await chromium.launch(); const pg = await b.newPage();
    const rede = { apiFora: false, gravacoes: [], errosPagina: [], semPauta: false };
    pg.on('pageerror', e => rede.errosPagina.push(e.message));
    await pg.addInitScript(() => { window.chrome = { storage: { local: { get: (k, cb) => cb({ config: { nomeUsuario: 'teste' } }), set: (o, cb) => cb && cb() } }, runtime: { getURL: u => u, getManifest: () => ({ version: 'teste' }) } }; });
    await pg.route('**/*', async rt => {
      const u = rt.request().url(), met = rt.request().method();
      if (u.startsWith(base)) return rt.continue();
      const cors = { 'access-control-allow-origin': '*' };
      if (met !== 'GET') { rede.gravacoes.push({ met, u }); return rt.abort(); }   // nada é gravado
      if (/firebaseio\.com/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: 'null' });
      if (/dadosabertos\.camara\.leg\.br\/api\/v2\/eventos\?idOrgao=180/.test(u)) {
        if (rede.apiFora) return rt.fulfill({ status: 504, headers: cors, body: 'Gateway Timeout' });
        return rt.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: fx('api-eventos-2026-11.json') });
      }
      if (/dadosabertos\.camara\.leg\.br/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"dados":[]}' });
      if (/sessoesereunioes\?idOrgaosSuperiores=180/.test(u)) return rt.fulfill({ status: 200, contentType: 'text/html', headers: cors, body: fx(/pagina=2/.test(u) ? 'sessoes-plen-2026-11-p2.html' : 'sessoes-plen-2026-11-p1.html') });
      if (/evento-legislativo\/85464$/.test(u)) return rt.fulfill({ status: 200, contentType: 'text/html', headers: cors, body: rede.semPauta ? '<html>sem pauta</html>' : fx('evento-85464.html') });
      if (/codteor=3203668$/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/pdf', headers: cors, body: fx('pauta-85464.pdf') });
      return rt.abort();
    });
    await pg.goto(base + '/analise.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof importarPautaPdf === 'function' && typeof plenCalAbrir === 'function');
    await pg.evaluate(() => { plenCal.ano = 2026; plenCal.mes = 10; window.__toasts = []; const t0 = window.mostrarToast; window.mostrarToast = (m, t) => { window.__toasts.push(String(m)); return t0 && t0(m, t); }; });

    await pg.click('#btn-calendario-plen');
    await pg.waitForFunction(() => /sess(ões|ão) deliberativas? neste mês/.test(document.getElementById('plcal-status').textContent));
    const cal = await pg.evaluate(() => ({ modal: document.getElementById('modal-calendario-plen').style.display, titulo: document.getElementById('plcal-titulo').textContent,
      dias: [...document.querySelectorAll('#plcal-grade .cal-dia.tem-reuniao')].map(e => +e.textContent), status: document.getElementById('plcal-status').textContent }));
    ok(cal.modal === 'flex' && cal.titulo === 'Novembro 2026', 'o botão "Calendário" abre o diálogo no mês');
    ok(cal.dias.join() === '3,4,5,10,11,17,18,23,24' && /^9 sessões deliberativas neste mês$/.test(cal.status), 'os dias com sessão deliberativa ficam marcados, com a contagem');

    await pg.click('#plcal-grade .cal-dia[data-data="2026-11-24"]');
    const card = await pg.evaluate(() => ({ vis: document.getElementById('plcal-card').style.display, data: document.getElementById('plcal-data').textContent,
      info: document.getElementById('plcal-info').textContent, btn: document.getElementById('plcal-carregar').style.display }));
    ok(card.vis === '' && card.data === '24/11/2026 · 13:55' && /Sessão Deliberativa Extraordinária/.test(card.info) && card.btn === '', 'clicar no dia mostra a sessão (data, hora, descrição) e o botão de carregar');

    // pauta ainda não publicada: aviso no cartão, nada importado
    rede.semPauta = true;
    await pg.click('#plcal-carregar');
    await pg.waitForFunction(() => /ainda não publicou a pauta/.test(document.getElementById('plcal-aviso').textContent));
    ok(await pg.evaluate(() => !state.pauta && document.getElementById('modal-calendario-plen').style.display === 'flex'), 'sessão sem pauta publicada: aviso no cartão, o diálogo continua aberto e nada é importado');

    rede.semPauta = false;
    await pg.click('#plcal-carregar');
    await pg.waitForFunction(() => state.pauta && state.pauta.itens && state.pauta.itens.length > 0 && /24\/11\/2026/.test(document.getElementById('pauta-titulo').textContent), null, { timeout: 60000 });
    const imp = await pg.evaluate(() => ({ modal: document.getElementById('modal-calendario-plen').style.display, id: state.pauta.id, titulo: state.pauta.titulo, periodo: state.pauta.periodo,
      n: state.pauta.itens.length, chaves: state.pauta.itens.map(i => i.chave).join(), primeiros: state.pauta.itens.slice(0, 3).map(i => `${i.ordem} ${i.sigla} ${i.numero}/${i.ano}`), pdfNome: state.pauta.pdfNome, sessaoOficial: state.pauta.sessaoOficial, origem: state.pauta.origem,
      tela: document.getElementById('pauta-titulo').textContent }));
    ok(imp.modal === 'none' && imp.n === 13 && imp.primeiros.join(' | ') === '1 PL 724/2003 | 2 PL 7103/2014 | 3 PL 294/2015', `"Carregar a pauta desta sessão": o PDF oficial é lido e a pauta entra com os 13 itens (${imp.n})`);
    ok(imp.periodo === '24/11/2026' && imp.id === '24-11-2026' && /24\/11\/2026/.test(imp.tela), `período e id saem do próprio PDF, como no carregamento à mão (${imp.periodo} · ${imp.id} · ${imp.tela})`);
    ok(imp.pdfNome === 'pauta-plenario-24-11-2026-13h55.pdf' && imp.sessaoOficial && imp.sessaoOficial.eventoId === '85464' && /codteor=3203668$/.test(imp.sessaoOficial.url) && imp.sessaoOficial.data === '2026-11-24' && imp.origem === undefined,
      'a pauta guarda de onde veio (sessaoOficial: sessão, link e data), sem tocar no campo "origem" das notas avulsas');
    for (let t = 0; t < 50 && !rede.gravacoes.some(g => /pautas\/24-11-2026\.json/.test(g.u)); t++) await pg.waitForTimeout(100);
    ok(rede.gravacoes.some(g => g.met === 'PUT' && /firebaseio\.com\/pautas\/24-11-2026\.json/.test(g.u)), 'a pauta segue para a gravação no Firebase (PUT em pautas/24-11-2026), como a do PDF — interceptada no teste: nada foi gravado');

    // o mesmo PDF pelo botão "Carregar pauta (PDF)" dá a mesma pauta
    const viaPdf = await pg.evaluate(async b64 => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      state.pauta = null;
      await importarPautaPdf(bin.buffer, 'pauta.pdf');
      return { n: state.pauta.itens.length, chaves: state.pauta.itens.map(i => i.chave).join(), origem: state.pauta.sessaoOficial || null };
    }, fx('pauta-85464.pdf').toString('base64'));
    ok(viaPdf.n === 13 && viaPdf.chaves === imp.chaves && viaPdf.origem === null, 'o mesmo PDF pelo "Carregar pauta (PDF)" dá os mesmos itens, na mesma ordem (sem a marca de origem)');

    // API fora: o calendário usa o site
    rede.apiFora = true;
    await pg.evaluate(() => { plenCal.cache = {}; document.getElementById('modal-calendario-plen').style.display = 'none'; });
    await pg.click('#btn-calendario-plen');
    await pg.waitForFunction(() => /sess(ões|ão) deliberativas? neste mês/.test(document.getElementById('plcal-status').textContent));
    const fora = await pg.evaluate(() => ({ dias: [...document.querySelectorAll('#plcal-grade .cal-dia.tem-reuniao')].map(e => +e.textContent).join(), status: document.getElementById('plcal-status').textContent }));
    ok(fora.dias === '3,4,5,10,11,17,18,23,24' && /pelo site da Câmara \(API: HTTP 504\)/.test(fora.status), 'API em 504: o calendário mostra as mesmas sessões, lidas do site, e diz a fonte');
    ok(!rede.errosPagina.length, `sem erro de JavaScript na página${rede.errosPagina.length ? ': ' + rede.errosPagina.join(' | ') : ''}`);
    await b.close(); srv.close();
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
