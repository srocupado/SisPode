// Correções do lote 6 da varredura (15/09/2026) — situação dos destaques e a
// corrida entre pautas que tenham a mesma proposição.
//
// Uso: node testes/correcoes-lote6.test.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML, DOMParser } = require(path.join(RAIZ, 'bot/node_modules/linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

function carregarPagina(html) {
  const fonteHtml = fs.readFileSync(path.join(RAIZ, html), 'utf8');
  const scripts = [...fonteHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window } = parseHTML(fonteHtml);
  const ctx = {
    document, window, DOMParser, console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    URL, TextDecoder, AbortController, DOMException, Event, Buffer,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => p, getManifest: () => ({ version: '0' }) }, tabs: { create: () => {} } },
    pdfjsLib: { GlobalWorkerOptions: {} }, Quill: function () {}, docx: {}, html2canvas: () => {},
    XLSX: { read: () => ({ SheetNames: [], Sheets: {} }), utils: {} },
    alert: () => {}, confirm: () => true, prompt: () => null,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n'), { filename: html.replace('.html', '-pagina.js') }).runInContext(ctx);
  return { ctx, av: expr => vm.runInContext(expr, ctx) };
}

(async () => {
  console.log('== destaque já votado não aparece como pendente ==');
  {
    const P = carregarPagina('panel.html');
    const inativas = P.av('SITUACOES_INATIVAS');
    const ativo = sit => !inativas.some(s => sit.toLowerCase().includes(s));

    ok(!ativo('Aprovado'), 'destaque aprovado deixa de contar como pendente de votação');
    ok(!ativo('Mantido o texto'), 'e "mantido o texto", que é resultado de DVS já votado, também');
    ok(!ativo('Rejeitado') && !ativo('Prejudicado') && !ativo('Retirado') && !ativo('Não admitido'),
      'as situações que já eram inativas continuam inativas');
    ok(ativo('Pendente') && ativo('Aguardando votação') && ativo(''),
      'o que ainda vai a votos continua ativo');
    // coerência interna: tudo que o mapa de cores trata como concluído está na lista
    const classes = P.av('SITUACAO_CLASSES');
    const conclusivas = Object.keys(classes).filter(k => /aprovado|mantido|rejeitado|retirado|prejudicado|admitido/.test(k));
    const fora = conclusivas.filter(k => ativo(k));
    ok(!fora.length, `nenhuma situação com cor de concluído fica como ativa (fora: ${fora.join(', ') || 'nenhuma'})`);
  }

  console.log('\n== resultado da pauta antiga não pinta o card da pauta nova ==');
  {
    const A = carregarPagina('analise.html');
    A.av(`
      document.body.innerHTML = '<div id="pauta-lista"></div>';
      // a pauta ABERTA é a B; o item da pauta A tem a MESMA proposição
      __itemB = { chave: 'PL-1234-2026', sigla: 'PL', numero: '1234', ano: '2026', tipoCategoria: 'projeto',
                  analise: { markdown: 'ANÁLISE DA PAUTA B', formato: 'markdown' }, analiseStatus: 'ok',
                  enriquecimento: { status: 'ok' } };
      __itemA = { chave: 'PL-1234-2026', sigla: 'PL', numero: '1234', ano: '2026', tipoCategoria: 'projeto',
                  analise: { markdown: 'ANÁLISE DA PAUTA A', formato: 'markdown' }, analiseStatus: 'ok',
                  enriquecimento: { status: 'ok' } };
      state.pauta = { id: 'pauta-B', nome: 'Pauta B', itens: [__itemB], uploadedAt: new Date().toISOString() };
      // um card com a chave da proposição, como o da pauta aberta
      const d = document.createElement('div');
      d.className = 'an-card'; d.dataset.chave = 'PL-1234-2026';
      d.innerHTML = ['btn-gerar', 'btn-toggle', 'btn-editar', 'btn-completar', 'btn-reanalisar', 'btn-regerar', 'btn-verificar-item']
                      .map(r => '<button data-role="' + r + '"></button>').join('')
                  + '<input data-role="inp-analista"><input data-role="inp-apelido"><div data-role="apelido-row"></div>'
                  + '<div data-role="quill-wrap"></div>'
                  + '<div data-role="painel-analise"><div data-role="analise-conteudo"></div><div data-role="analise-meta"></div></div>'
                  + '<button data-role="btn-abrir-parecer" style="display:none"></button>'
                  + '<button data-role="btn-abrir-conferencia" style="display:none"></button>';
      document.getElementById('pauta-lista').appendChild(d);
    `);
    A.av('renderAnaliseCard(__itemB)');
    const depoisDeB = A.av(`document.querySelector('[data-role=analise-conteudo]').innerHTML`);
    ok(/PAUTA B/.test(depoisDeB), 'o item da pauta aberta é renderizado normalmente');

    A.av('renderAnaliseCard(__itemA)');   // chega atrasado, da pauta anterior
    const depoisDeA = A.av(`document.querySelector('[data-role=analise-conteudo]').innerHTML`);
    ok(!/PAUTA A/.test(depoisDeA) && /PAUTA B/.test(depoisDeA),
      'a análise da pauta anterior NÃO substitui a do card homônimo da pauta aberta');

    // o botão do parecer segue a mesma regra
    A.av(`__itemA.parecerMeta = { em: '2026-09-01T12:00:00Z', por: 'equipe', modelo: 'm', pontos: 0 };
          atualizarBotaoParecer(__itemA);`);
    ok(A.av(`document.querySelector('[data-role=btn-abrir-parecer]').style.display`) === 'none',
      'e o botão "Abrir parecer" não é ligado pelo parecer da pauta anterior');

    A.av(`__itemB.parecerMeta = { em: '2026-09-15T12:00:00Z', por: 'equipe', modelo: 'm', pontos: 0 };
          atualizarBotaoParecer(__itemB);`);
    ok(A.av(`document.querySelector('[data-role=btn-abrir-parecer]').style.display`) === 'inline-flex',
      'o parecer do item da pauta aberta continua ligando o botão');
  }

  console.log('\n== o teste da MPV não depende mais do estado vivo da proposição ==');
  {
    const fonte = fs.readFileSync(path.join(RAIZ, 'testes/analise-mpv.test.js'), 'utf8');
    ok(/if \(s\.temPLV\)[\s\S]{0,400}else \{[\s\S]{0,200}notas\.length >= 1/.test(fonte),
      'a exigência de nota vale só no caso sem PLV, que é onde há ausência a declarar');
    ok(!/ok\(s\.notas\.length >= 1, `mas o diagnóstico/.test(fonte),
      'a asserção incondicional saiu');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
