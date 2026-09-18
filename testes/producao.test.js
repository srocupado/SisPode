// Aba "Produção legislativa" do módulo Relatórios.
//
// O relatório existe para NÃO responder "o que o deputado produziu" com um
// número só. Medido na API em 18/09/2026: um deputado da bancada tem 828
// proposições de autoria, das quais 462 são REQ e 115 são DOC. "Apresentou 828
// proposições" é a estatística que não sobrevive à primeira pergunta de um
// jornalista — e é ela que este teste impede de sair.
//
// Duas armadilhas travadas aqui:
//  1. a API devolve 100 por página e NÃO avisa que cortou. Sem seguir
//     `links.next`, o relatório diria 100 para quem tem 828.
//  2. ler a situação de cada matéria falha às vezes. Falha não pode virar
//     "sem situação" indistinguível de uma situação em branco de verdade,
//     nem pode fazer a matéria sumir.
//
// Uso: node testes/producao.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// ---------- API de mentira ----------
const api = { props: [], detalhe: {}, temas: {}, chamadas: [], derrubarDetalhe: null };
const resp = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
const erro = s => ({ ok: false, status: s, json: async () => ({}), text: async () => '' });

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  // aderencia.html passou a carregar ia-comum.js, que declara um
  // AbortController no topo do arquivo. Sem ele no contexto, NENHUM script
  // da página chega a ser avaliado.
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({ abas: {} }), aoa_to_sheet: r => ({ _r: r }),
                   book_append_sheet: (wb, ws, nome) => { wb.abas[nome] = ws; } },
          writeFile: (wb, nome) => { api.planilha = { wb, nome }; } },
  fetch: async (url) => {
    const u = String(url);
    api.chamadas.push(u);
    let m;
    // paginação de verdade: 100 por página, com links.next
    if ((m = u.match(/\/proposicoes\?idDeputadoAutor=(\d+)/))) {
      const pag = Number((u.match(/[?&]pagina=(\d+)/) || [])[1] || 1);
      const ano = (u.match(/[?&]ano=(\d{4})/) || [])[1];
      const todas = api.props.filter(p => !ano || String(p.ano) === ano);
      const fatia = todas.slice((pag - 1) * 100, pag * 100);
      const temMais = todas.length > pag * 100;
      const base = u.replace(/[?&]pagina=\d+/, '');
      return resp({ dados: fatia,
        links: temMais ? [{ rel: 'next', href: base + '&pagina=' + (pag + 1) }] : [] });
    }
    if ((m = u.match(/\/proposicoes\/(\d+)\/temas/))) return resp({ dados: api.temas[m[1]] || [] });
    if ((m = u.match(/\/proposicoes\/(\d+)$/))) {
      if (api.derrubarDetalhe && api.derrubarDetalhe.includes(m[1])) return erro(500);
      return resp({ dados: api.detalhe[m[1]] || { id: Number(m[1]) } });
    }
    if (/\/referencias\//.test(u)) return resp({ dados: [] });
    if (/\/deputados\?nome=/.test(u)) return resp({ dados: [] });
    return erro(599);
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

// ---------- material: um mandato com a forma do real ----------
// 240 registros: 12 de mérito, 3 pareceres, 2 de fiscalização, 3 emendas,
// 180 requerimentos de andamento e 40 documentos. A desproporção é o ponto.
let id = 1000;
const nova = (siglaTipo, ano, ementa) => {
  const p = { id: ++id, siglaTipo, numero: id, ano, ementa: ementa || `Ementa de ${siglaTipo}.` };
  api.props.push(p);
  return p;
};
const merito = [];
for (let i = 0; i < 10; i++) merito.push(nova('PL', 2025, `Projeto de lei nº ${i}.`));
merito.push(nova('PEC', 2025));
merito.push(nova('PLP', 2025));
for (let i = 0; i < 3; i++) nova('PRL', 2025);
nova('RIC', 2025); nova('RCP', 2025);
nova('EMC', 2025); nova('EMP', 2025); nova('DTQ', 2025);
for (let i = 0; i < 180; i++) nova('REQ', 2025);
for (let i = 0; i < 40; i++) nova('DOC', 2025);

// Situações: duas viraram norma, o resto está parado em lugares diferentes.
const SITUACOES = ['Transformado em Norma Jurídica', 'Transformado em Norma Jurídica',
  'Aguardando Designação de Relator(a)', 'Aguardando Parecer', 'Aguardando Parecer',
  'Arquivada', 'Tramitando em Conjunto', 'Pronta para Pauta', 'Aguardando Parecer',
  'Aguardando Despacho', 'Aguardando Parecer', 'Arquivada'];
merito.forEach((p, i) => {
  api.detalhe[p.id] = { id: p.id, statusProposicao: {
    siglaOrgao: i % 2 ? 'CCJC' : 'PLEN', descricaoSituacao: SITUACOES[i] } };
  api.temas[p.id] = i < 6 ? [{ tema: 'Saúde' }] : [{ tema: 'Direito Penal e Processual Penal' }];
});

(async () => {
  console.log('== os scripts das abas novas são carregáveis ==');
  {
    // Script fora de web_accessible_resources não carrega quando a página é
    // aberta pela extensão: a aba apareceria e não faria nada.
    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    const recursos = manifest.web_accessible_resources.flatMap(w => w.resources);
    for (const f of ['producao.js', 'radar.js']) {
      ok(recursos.includes(f), `${f} está em web_accessible_resources`);
      ok(html.includes(`<script src="${f}">`), `e é carregado por aderencia.html`);
    }
    // A ordem importa: os dois reaproveitam globais de aderencia.js.
    ok(html.indexOf('aderencia.js') < html.indexOf('producao.js')
       && html.indexOf('aderencia.js') < html.indexOf('radar.js'),
       'e vêm DEPOIS de aderencia.js, de quem reaproveitam fetchJson, cvEsc e CSS_PDF_VOTOS');
  }

  console.log('\n== a aba existe e troca ==');
  {
    ok(!!document.getElementById('aba-producao'), 'a aba "Produção legislativa" está no HTML');
    ok(document.getElementById('painel-producao').hidden === true, 'e começa escondida');
    document.getElementById('aba-producao').dispatchEvent(new Event('click', { bubbles: true }));
    ok(document.getElementById('painel-producao').hidden === false, 'clicar abre o painel');
    ok(document.getElementById('painel-aderencia').hidden === true, 'e fecha os outros');
    ok(document.getElementById('painel-consulta').hidden === true, 'todos eles');
  }

  console.log('\n== a paginação é seguida ==');
  {
    av(`prd.deputado = { id: 42, nome: 'Fulana de Tal', partido: 'PODE', uf: 'SP' }`);
    document.getElementById('prdAno').value = '';
    api.chamadas.length = 0;
    await av('prdConsultar()');

    const u = av('prd.ultimo');
    ok(u.todas.length === 240,
       `as 240 proposições entram, não as 100 da primeira página (${u.todas.length})`);
    const pgs = api.chamadas.filter(c => /idDeputadoAutor/.test(c)).length;
    ok(pgs === 3, `três páginas foram pedidas (${pgs})`);
  }

  console.log('\n== o número bruto não passa por medida de produção ==');
  {
    const u = av('prd.ultimo');
    const g = u.porGrupo;
    ok(g.merito.length === 12, `mérito: 12 (${g.merito.length})`);
    ok(g.relatoria.length === 3, `relatoria: 3 pareceres (${g.relatoria.length})`);
    ok(g.fiscal.length === 2, `fiscalização: 2 (${g.fiscal.length})`);
    ok(g.texto.length === 3, `atuação sobre o texto: 3 (${g.texto.length})`);
    ok(g.andamento.length === 180, `requerimentos de andamento: 180 (${g.andamento.length})`);
    ok(g.outros.length === 40, `documentos e processo: 40 (${g.outros.length})`);
    ok(g.merito.length + g.relatoria.length + g.fiscal.length + g.texto.length
       + g.andamento.length + g.outros.length === u.todas.length,
       'e a soma dos grupos fecha com o total — nenhum tipo cai no vão');

    const tela = document.getElementById('prdResultado').textContent;
    ok(/não deve ser usado sozinho/.test(tela),
       'a tela diz, ao lado do número bruto, que ele não vale sozinho');
  }

  console.log('\n== o destino é o que separa relatório de release ==');
  {
    const u = av('prd.ultimo');
    const d = Object.fromEntries(u.destinoOrd);
    ok(d['Transformado em Norma Jurídica'] === 2, `2 viraram norma (${d['Transformado em Norma Jurídica']})`);
    ok(d['Aguardando Parecer'] === 4, `4 aguardando parecer (${d['Aguardando Parecer']})`);
    ok(d['Arquivada'] === 2, `2 arquivadas (${d['Arquivada']})`);
    const soma = u.destinoOrd.reduce((s, [, n]) => s + n, 0);
    ok(soma === u.merito.length, `o destino cobre todas as de mérito (${soma} de ${u.merito.length})`);
  }

  console.log('\n== só o mérito é detalhado ==');
  {
    const detalhes = api.chamadas.filter(c => /\/proposicoes\/\d+$/.test(c)).length;
    ok(detalhes === 12,
       `uma leitura individual por matéria de mérito, e nenhuma pelos 180 REQ (${detalhes})`);
  }

  console.log('\n== falha de leitura não apaga a matéria ==');
  {
    api.derrubarDetalhe = [String(merito[0].id), String(merito[1].id)];
    await av('prdConsultar()');
    const u = av('prd.ultimo');
    ok(u.merito.length === 12, `as 12 continuam na lista (${u.merito.length})`);
    ok(u.merito.filter(m => m.falhou).length === 2, 'duas marcadas como não lidas');
    const tela = document.getElementById('prdResultado').textContent;
    ok(/2 matéria\(s\) de mérito não puderam ter a situação lida/.test(tela),
       'e a tela diz que o que faltou foi a consulta, não o dado');
    const d = Object.fromEntries(u.destinoOrd);
    ok(d['sem situação registrada'] === 2,
       'no destino elas aparecem como "sem situação registrada", não somem nem inventam situação');
    api.derrubarDetalhe = null;
  }

  console.log('\n== o filtro por ano ==');
  {
    nova('PL', 2024, 'De outro ano.');
    document.getElementById('prdAno').value = '2024';
    await av('prdConsultar()');
    ok(av('prd.ultimo').todas.length === 1, 'o ano filtra na origem, não na tela');
    document.getElementById('prdAno').value = 'abc';
    await av('prdConsultar()');
    ok(/quatro dígitos/.test(document.getElementById('prdStatus').textContent),
       'ano inválido é recusado antes de consultar');
    document.getElementById('prdAno').value = '';
    await av('prdConsultar()');
  }

  console.log('\n== o documento ==');
  {
    const doc = av('prdHtmlPDF(null)');
    const plano = doc.replace(/\s+/g, ' ');
    ok(/^<!DOCTYPE html>/.test(doc), 'é um documento completo');
    ok(/<h2>Por natureza do instrumento<\/h2>/.test(doc), 'a seção da natureza existe');
    ok(/<h2>Destino das matérias de mérito<\/h2>/.test(doc), 'a do destino também');
    ok(/<h2>Relatoria<\/h2>/.test(doc), 'e a da relatoria');
    ok(/Transformado em Norma Jurídica/.test(doc), 'com as situações reais');

    // A ressalva medida na API: o parecer não liga à matéria relatada.
    ok(/não traz vínculo com a matéria relatada/.test(plano),
       'o documento declara que a relatoria não aponta para o projeto — a API não dá esse vínculo');
    ok(/esse número bruto não é medida de produção/i.test(plano),
       'e que o total bruto não é medida de produção');
    ok(/fichadetramitacao\?idProposicao=/.test(doc), 'cada matéria leva o link da ficha');
  }

  console.log('\n== a planilha ==');
  {
    av('prdExportar()');
    const abas = Object.keys(api.planilha.wb.abas);
    ok(abas.join(',') === 'Resumo,Mérito,Tudo',
       `três abas: resumo, mérito e tudo (${abas.join(', ')})`);
    const resumo = api.planilha.wb.abas['Resumo']._r;
    ok(resumo.length === 7, 'o resumo traz uma linha por grupo, e o cabeçalho');
    ok(resumo.some(l => l[0] === 'Requerimentos de andamento' && l[1] === 180),
       'com a quantidade de cada um');
    // 241 porque o bloco do filtro por ano acrescentou um PL de 2024 ao material.
    const tudo = api.planilha.wb.abas['Tudo']._r;
    const esperado = av('prd.ultimo').todas.length;
    ok(tudo.length === esperado + 1,
       `a aba "Tudo" leva todos os registros, não só os de mérito (${tudo.length - 1} de ${esperado})`);
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
