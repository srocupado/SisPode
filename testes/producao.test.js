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
      // A API filtraria por `ano`; o relatório deixou de usar esse parâmetro,
      // então o fake devolve tudo — e falha se alguém voltar a mandá-lo.
      const todas = api.props.slice();
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
// A forma REAL da lista, medida em 22/09/2026: ela traz `dataApresentacao`, e
// o campo `ano` vem ZERO numa fatia grande dos itens — de 13% a 28% da produção
// de um deputado, concentrada em pareceres, substitutivos e emendas.
// `anoReal` é o ano de apresentação; `ano` é o campo cru da API.
const nova = (siglaTipo, ano, ementa, anoReal) => {
  const a = anoReal || ano;
  const p = { id: ++id, siglaTipo, numero: id, ano, ementa: ementa || `Ementa de ${siglaTipo}.`,
              dataApresentacao: a ? `${a}-06-15T10:00` : null };
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

  console.log('\n== a taxonomia cobre o que a API realmente devolve ==');
  {
    // As siglas abaixo foram COLHIDAS da produção real de três deputados da
    // bancada em 22/09/2026, não inventadas. Seis delas caíam em "Documentos e
    // processo interno — sem conteúdo legislativo próprio": chamar um Parecer
    // às Emendas de Plenário ou um Voto em Separado de ofício sem conteúdo é
    // errar na parte do trabalho que este relatório existe para mostrar.
    const ESPERADO = {
      PRL: 'relatoria',   // Parecer do Relator
      PRLP: 'relatoria',  // Parecer Preliminar de Plenário
      PRLE: 'relatoria',  // Parecer Preliminar às Emendas de Plenário
      PEP: 'relatoria',   // Parecer às Emendas de Plenário
      PPP: 'relatoria',   // Parecer Proferido em Plenário
      PSS: 'relatoria',   // Parecer às Emendas ou ao Substitutivo do Senado
      RDF: 'relatoria',   // Redação Final
      EMR: 'relatoria',   // Emenda de Relator
      SBR: 'relatoria',   // Subemenda de Relator
      CVO: 'relatoria',   // Complementação de Voto
      VTS: 'relatoria',   // Voto em Separado
      SBT: 'texto',       // Substitutivo
      ESB: 'texto',       // Emenda ao Substitutivo
      SLD: 'texto',       // Sugestão de Emenda à LDO
      EMC: 'texto', EMP: 'texto', DTQ: 'texto',
      PL: 'merito', PEC: 'merito', PLP: 'merito', PDL: 'merito', PRC: 'merito',
      RIC: 'fiscal', RCP: 'fiscal', PFC: 'fiscal',
      REQ: 'andamento', RPD: 'andamento',
      DOC: 'outros', PROC: 'outros', REC: 'outros',
    };
    let erros = 0;
    for (const [sigla, grupo] of Object.entries(ESPERADO)) {
      const achou = av(`prdGrupoDe('${sigla}')`);
      if (achou !== grupo) { erros++; console.log(`  ✗ ${sigla} caiu em "${achou}", devia ser "${grupo}"`); }
    }
    ok(erros === 0, `as ${Object.keys(ESPERADO).length} siglas vistas na produção real caem no grupo certo`);

    // E a designação não pode sair com "/0": a API manda ano 0 em parecer,
    // substitutivo e emenda, e "PRL 3/0" não designa nada.
    ok(av(`prdDesignacao({ siglaTipo: 'PRL', numero: 3, ano: 0, dataApresentacao: '2024-11-19T14:50' })`) === 'PRL 3/2024',
       'com ano 0, a designação usa o ano de apresentação');
    ok(av(`prdDesignacao({ siglaTipo: 'PL', numero: 12, ano: 2025, dataApresentacao: '2025-03-01T10:00' })`) === 'PL 12/2025',
       'e com ano de verdade, usa o ano de verdade');
    ok(av(`prdDesignacao({ siglaTipo: 'PRL', numero: 3, ano: 0, dataApresentacao: null })`) === 'PRL 3',
       'sem nenhum dos dois, sai sem ano — em vez de "/0"');
  }

  console.log('\n== o filtro por ano vai pela DATA DE APRESENTAÇÃO ==');
  {
    // O defeito que isto guarda, medido em três deputados da bancada: o
    // parâmetro `ano` da API descarta em silêncio os itens que vêm com ano 0 —
    // de 13% a 28% da produção, e a relatoria quase inteira. Em 2025, Bruno
    // Ganem tinha 79 pelo filtro da API e 130 pela data real.
    nova('PL', 2024, 'De outro ano.');
    const parecer = nova('PRL', 0, 'Parecer do relator, apresentado em 2024.', 2024);
    const subst = nova('SBT', 0, 'Substitutivo apresentado em 2024.', 2024);
    const semData = nova('EMC', 0, 'Sem data na API.');
    document.getElementById('prdAno').value = '2024';
    await av('prdConsultar()');
    const u2024 = av('prd.ultimo');
    ok(u2024.todas.length === 3,
       `o recorte traz os 3 apresentados em 2024, e não só o que tem o campo ano (${u2024.todas.length})`);
    const ids = u2024.todas.map(p => p.id);
    ok(ids.includes(parecer.id) && ids.includes(subst.id),
       'o parecer e o substitutivo com ano 0 ENTRAM — é a relatoria que o filtro antigo apagava');
    ok(!ids.includes(semData.id), 'e o que não tem data nenhuma fica de fora');
    ok(/1\s*\n?\s*proposição\(ões\) ficaram fora do recorte/.test(
         document.getElementById('prdResultado').innerHTML.replace(/\s+/g, ' ')
       ) || /ficaram fora do recorte/.test(document.getElementById('prdResultado').innerHTML),
       'e a tela diz quantas ficaram de fora por falta de data, em vez de sumir com elas');
    ok(!api.chamadas.some(c => /[?&]ano=/.test(c)),
       'o parâmetro `ano` da API não é mais usado: é ele que descartava em silêncio');
    document.getElementById('prdAno').value = 'abc';
    await av('prdConsultar()');
    ok(/quatro dígitos/.test(document.getElementById('prdStatus').textContent),
       'ano inválido é recusado antes de consultar');
    document.getElementById('prdAno').value = '';
    await av('prdConsultar()');
  }

  console.log('\n== o filtro de categorias, no resultado ==');
  {
    const escolher = k => {
      const sel = document.getElementById('prdCategoria');
      for (const o of sel.querySelectorAll('option')) o.removeAttribute('selected');
      const alvo = sel.querySelector(`option[value="${k}"]`);
      alvo.setAttribute('selected', ''); alvo.selected = true;
      sel.value = k;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.getElementById('prdAno').value = '';
    api.chamadas.length = 0;
    await av('prdConsultar()');
    const cheio = av('prd.ultimo').todas.length;
    const chamadasDaConsulta = api.chamadas.length;

    // O filtro nasce DEPOIS da geração, dentro do resultado — é escolha de
    // leitura, e antes de gerar não há o que escolher.
    const sel = document.getElementById('prdCategoria');
    ok(!!sel, 'o dropdown aparece no resultado');
    let el = sel, pais = [];
    while (el && el.parentNode) { el = el.parentNode; if (el.id) pais.push(el.id); }
    ok(pais.includes('prdResultado'), 'dentro do resultado, e não nos campos da consulta');

    const vals = [...sel.querySelectorAll('option')].map(o => o.getAttribute('value'));
    ok(vals[0] === '' && vals.slice(1).join(',') === av('PRD_GRUPOS.map(g => g.k)').join(','),
       `"todas" primeiro, e depois uma opção por grupo da taxonomia (${vals.slice(1).join(', ')})`);
    const textos = [...sel.querySelectorAll('option')].map(o => o.textContent.trim());
    ok(/\(\d+\)$/.test(textos[1]),
       `cada opção diz quantos há naquela categoria (${textos[1]})`);

    // Trocar de categoria é redesenho: não pode custar uma nova consulta.
    api.chamadas.length = 0;
    escolher('relatoria');
    ok(api.chamadas.length === 0,
       `trocar de categoria não chama a API (${api.chamadas.length}, contra ${chamadasDaConsulta} da consulta)`);

    const u = av('prd.ultimo');
    const esperado = api.props.filter(p => av(`prdGrupoDe('${p.siglaTipo}')`) === 'relatoria').length;
    ok(u.todas.length === esperado && u.todas.every(p => av(`prdGrupoDe('${p.siglaTipo}')`) === 'relatoria'),
       `o relatório passa a mostrar só a categoria escolhida (${u.todas.length} de ${esperado})`);
    ok(u.parcial === true && u.colhidas === cheio,
       'e guarda que é recorte, junto do total colhido — o documento precisa das duas coisas');

    const tela = document.getElementById('prdResultado').innerHTML;
    ok(/<b>Recorte:<\/b> só Relatoria/.test(tela), 'a tela declara o recorte e nomeia a categoria');
    ok(!/Requerimentos de andamento/.test(tela.replace(/<option[^>]*>[^<]*<\/option>/g, '')),
       'e não mostra o cartão das categorias de fora — só no dropdown, que é a escolha');

    // O documento sai igual.
    const pdf = av('prdHtmlPDF(null)').replace(/\s+/g, ' ');
    ok(/Este documento é um RECORTE/.test(pdf), 'o PDF avisa que é recorte');
    ok(new RegExp(`de um total de <b>${cheio}</b>`).test(pdf),
       'dizendo de que total ele saiu — sem isso o número pareceria a produção inteira');
    ok(!/Requerimentos de andamento/.test(pdf), 'e não traz as categorias de fora');

    // Voltar para "todas" devolve o relatório inteiro.
    escolher('');
    ok(av('prd.ultimo').todas.length === cheio && av('prd.ultimo').parcial === false,
       'voltar a "todas as categorias" devolve o relatório inteiro');
    ok(!/<b>Recorte:<\/b>/.test(document.getElementById('prdResultado').innerHTML),
       'e a ressalva de recorte some junto');
  }
  {
    // Consulta nova não herda o filtro da anterior: o recorte era daquele
    // relatório, e sair um relatório já filtrado sem ninguém ter pedido é a
    // forma mais fácil de ler um número parcial como se fosse o total.
    const sel = () => document.getElementById('prdCategoria');
    const alvo = sel().querySelector('option[value="fiscal"]');
    alvo.setAttribute('selected', ''); alvo.selected = true; sel().value = 'fiscal';
    sel().dispatchEvent(new Event('change', { bubbles: true }));
    ok(av('prd.ultimo').parcial === true, 'com a categoria escolhida, o relatório está recortado');
    await av('prdConsultar()');
    ok(av('prd.filtro') === '' && av('prd.ultimo').parcial === false,
       'a consulta seguinte começa mostrando todas as categorias');
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
