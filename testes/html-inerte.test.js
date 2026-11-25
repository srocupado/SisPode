// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';
// html-inerte.js — HTML de terceiros lido pelo DOMParser sem os atributos de evento.
//
// O caso (25/11/2026): o registro de erros da extensão (chrome://extensions) enchia de "Executing inline event
// handler violates the following Content Security Policy directive 'script-src 'self''", apontando congresso.js:412
// (parseDetalheHtml). O programa só lê a página do Congresso; nada dela é executado, mas o Chrome registra um erro
// por atributo onclick/onload/onerror que encontra. O mesmo já tinha sido resolvido em 28/10/2026 num caminho só
// (analise.js, semEventosInline).
//
// O que se testa: a função; que TODA página da extensão carrega o arquivo antes dos outros scripts; e, no Chromium,
// com a mesma política de segurança da extensão, que a leitura registra os erros sem o arquivo e nenhum com ele.
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..');
const { htmlInerte } = require(path.join(RAIZ, 'html-inerte.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== 1. a função ==');
  ok(htmlInerte('<a class="x" href="p?a=1&amp;b=2" onclick="" title="Clique">PRLP 1</a>') === '<a class="x" href="p?a=1&amp;b=2" title="Clique">PRLP 1</a>', 'tira onclick="" e deixa os outros atributos');
  ok(htmlInerte('<body onload="iniciar()"><img src=x onerror=alert(1)><td data-x="a > b" onmouseover=\'z()\'>1</td></body>') === '<body><img src=x><td data-x="a > b">1</td></body>', 'com aspas duplas, simples ou sem aspas; ">" dentro de um valor não corta a tag');
  ok(htmlInerte('<a title="conteúdo com onda=1">texto onclick=1</a><p>a monitoria = b</p>') === '<a title="conteúdo com onda=1">texto onclick=1</a><p>a monitoria = b</p>', '"on…=" dentro de um valor ou no texto fica como está');
  ok(htmlInerte('<input disabled onfocus=x><br/><one-tag online="1">') === '<input disabled><br/><one-tag>' && htmlInerte('') === '' && htmlInerte(null) === 'null', 'atributo sem valor ao lado, tag que fecha em si; entrada vazia não quebra');
  const mesma = new Function(fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8').match(/function semEventosInline\([\s\S]*?\n}/)[0] + '; return semEventosInline;')();
  const amostra = '<div onclick="a(\'>\')" class="c"><span ONLOAD=x data-on="1">t</span></div>';
  ok(htmlInerte(amostra) === mesma(amostra) && htmlInerte(amostra) === '<div class="c"><span data-on="1">t</span></div>', 'mesmo resultado de semEventosInline (analise.js), inclusive com maiúsculas');

  console.log('\n== 2. todas as páginas carregam o arquivo antes dos outros scripts ==');
  const paginas = fs.readdirSync(RAIZ).filter(f => f.endsWith('.html'));
  const fora = paginas.filter(f => { const h = fs.readFileSync(path.join(RAIZ, f), 'utf8'); const p = h.search(/<script\b/); return !/^<script src="html-inerte\.js"><\/script>/.test(h.slice(p)); });
  ok(paginas.length >= 13 && fora.length === 0, `${paginas.length} páginas, todas com html-inerte.js como primeiro script${fora.length ? ' — faltam: ' + fora.join(', ') : ''}`);
  const comParser = fs.readdirSync(RAIZ).filter(f => f.endsWith('.js') && /parseFromString\(.*'text\/html'\)/.test(fs.readFileSync(path.join(RAIZ, f), 'utf8')));
  ok(comParser.includes('congresso.js') && comParser.length >= 9, `${comParser.length} arquivos leem HTML com o DOMParser (entre eles congresso.js): o filtro vale para todos, sem mudar cada chamada`);

  console.log('\n== 3. no navegador, com a política de segurança da extensão ==');
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { console.log('  (playwright indisponível: bloco 3 não executado)'); }
  if (chromium) {
    const srv = http.createServer((q, rs) => {
      const cab = { 'content-security-policy': "script-src 'self'" };
      if (q.url === '/html-inerte.js') { rs.writeHead(200, { ...cab, 'content-type': 'text/javascript' }); return rs.end(fs.readFileSync(path.join(RAIZ, 'html-inerte.js'))); }
      rs.writeHead(200, { ...cab, 'content-type': 'text/html' });
      rs.end(`<!doctype html><html><head>${q.url === '/com' ? '<script src="html-inerte.js"></script>' : ''}</head><body>ok</body></html>`);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const b = await chromium.launch();
    // página do Congresso em miniatura: tabela de dispositivos vetados e link do documento, com atributos de evento
    const pagina = '<html><body onload="iniciar()"><table class="cn-detalhe-veto--partes-vetadas"><tbody><tr onclick="abrir(1)"><td><p>Art. 1º</p></td></tr></tbody></table><a href="sdleg-getter/documento?dm=1" onclick="return baixar(this)">Razões</a><img src="x.png" onerror="y()"></body></html>';
    const ler = async caminho => {
      const pg = await b.newPage(); const erros = [];
      pg.on('console', m => { if (m.type() === 'error' && /inline event handler/.test(m.text())) erros.push(m.text()); });
      await pg.goto(`http://127.0.0.1:${srv.address().port}${caminho}`);
      const r = await pg.evaluate(h => { const d = new DOMParser().parseFromString(h, 'text/html'); const x = new DOMParser().parseFromString('<a onclick="z()">1</a>', 'text/xml');
        return { linhas: d.querySelectorAll('table.cn-detalhe-veto--partes-vetadas tbody tr').length, texto: d.querySelector('td p').textContent, link: d.querySelector('a[href*="sdleg-getter/documento"]').getAttribute('href'), eventos: d.querySelectorAll('[onclick],[onload],[onerror]').length, xml: x.documentElement.getAttribute('onclick') }; }, pagina);
      await pg.waitForTimeout(200); await pg.close();
      return { ...r, erros: erros.length };
    };
    const sem = await ler('/sem'), com = await ler('/com');
    ok(sem.erros === 4 && sem.eventos === 4, `sem o arquivo: o Chrome registra um erro por atributo de evento (${sem.erros}) — o que aparecia em chrome://extensions`);
    ok(com.erros === 0 && com.eventos === 0, `com o arquivo: nenhum erro (${com.erros})`);
    ok(com.linhas === 1 && com.texto === 'Art. 1º' && com.link === 'sdleg-getter/documento?dm=1' && sem.linhas === 1, 'a leitura continua a mesma: a tabela, o texto e o link do documento');
    ok(com.xml === 'z()', 'XML não passa pelo filtro');
    await b.close(); srv.close();
  }
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
