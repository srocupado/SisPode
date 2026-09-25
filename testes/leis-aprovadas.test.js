// Aba "Leis aprovadas" do módulo Relatórios.
//
// Esta aba não coleta nada — só lê o agregado que o bot/ já gravou em
// /leis_aprovadas/{legislatura} no Firebase (bot/src/leisaprovadas.js faz a
// coleta pesada, com os arquivos em massa da Câmara). O que este teste trava:
//  1. a aba existe, está cadastrada em CV_ABAS e o script está em
//     web_accessible_resources — sem isso ela não carrega dentro da extensão;
//  2. o agregado de mais de uma legislatura é combinado corretamente;
//  3. os filtros (nome, partido, UF, condição, só-com-lei) batem no cliente,
//     sem chamada nova à API — o dado já veio pronto;
//  4. legislatura sem dado agregado ainda não derruba a tela: aparece um aviso,
//     não um erro nem uma lista vazia sem explicação;
//  5. os projetos de cada deputado são os dele (por id, entre os autores do
//     projeto), não de outro;
//  6. as legislaturas saem da DATA (a 58ª aparece sozinha em fev/2027), com
//     os checkboxes gerados e as duas mais recentes marcadas por padrão;
//  7. dado velho da corrente mostra aviso com "Coletar agora", e a coleta pela
//     extensão baixa os arquivos direto da Câmara; as travas impedem gravar
//     coleta incompleta (ano faltando, autor não apurado) e pedem confirmação
//     extra quando a coleta traz MENOS projetos que o salvo.
//
// Uso: node testes/leis-aprovadas.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// LIMITAÇÃO DO HARNESS, não do código: no linkedom, <select>.value é somente
// leitura, e no navegador é gravável (mesmo shim de testes/orcamento-tela.test.js).
const protoSelect = Object.getPrototypeOf(document.createElement('select'));
if (!Object.getOwnPropertyDescriptor(protoSelect, 'value')?.set) {
  Object.defineProperty(protoSelect, 'value', {
    configurable: true,
    get() {
      if (this.__valor !== undefined) return this.__valor;
      const o = this.querySelector('option');
      return o ? (o.getAttribute('value') ?? o.textContent) : '';
    },
    set(v) { this.__valor = v; },
  });
}

const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const FIRE = { '57': null, '56': null, '55': null, '54': null, '53': null };
const chamadas = [];

// Material do caminho MANUAL (upload de arquivos locais): roster, autores e
// histórico da API — tudo com CORS liberado, diferente dos arquivos em massa.
const API_ROSTER = {
  53: [{ id: 10, nome: 'Duda Veterana', siglaPartido: 'PODE', siglaUf: 'BA' }],
  57: [{ id: 1, nome: 'Ana Fulana', siglaPartido: 'PODE', siglaUf: 'SP' }],
};
// Arquivos em massa servidos "direto da Câmara" para a coleta pela extensão.
const ARQ_BASE = 'https://dadosabertos.camara.leg.br/arquivos/proposicoes/json';
const ARQUIVOS_CAMARA = {
  2023: [{ id: 950, siglaTipo: 'PL', numero: 1, ano: 2023, ementa: 'Lei da 57ª.', dataApresentacao: '2023-05-01', ultimoStatus: { idSituacao: 1140 } },
         { id: 951, siglaTipo: 'PL', numero: 2, ano: 2023, ementa: 'Janeiro — ainda 56ª.', dataApresentacao: '2023-01-10', ultimoStatus: { idSituacao: 1140 } }],
};
let FALHAR_ANO = null;
const API_AUTORES = { 700: [10, 11], 950: [1] }; // 11 fora do roster — precisa aparecer mesmo assim
const API_HISTORICO = { 10: [{ idLegislatura: 53, condicaoEleitoral: 'Titular' }] };

// FileReader de mentira: o linkedom não implementa a API de verdade. Os
// "arquivos" que os testes passam são objetos simples { name, size, _json },
// e o shim só precisa devolver esse texto de forma assíncrona (readAsText).
class FakeFileReader {
  readAsText(file) {
    setTimeout(() => {
      if (this.onprogress) this.onprogress({ lengthComputable: true, loaded: file.size, total: file.size });
      this.result = file._json;
      if (this.onload) this.onload();
    }, 0);
  }
}
const arquivoFalso = (nome, dados) => {
  const j = JSON.stringify(dados);
  return { name: nome, size: j.length, _json: j };
};

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  FileReader: FakeFileReader,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({ abas: {} }), json_to_sheet: r => ({ _r: r }),
                   book_append_sheet: (wb, ws, nome) => { wb.abas[nome] = ws; } },
          writeFile: (wb, nome) => { ctx._planilha = { wb, nome }; } },
  fetch: async (url, opcoes) => {
    const u = String(url);
    const metodo = (opcoes && opcoes.method) || 'GET';
    chamadas.push(`${metodo} ${u}`);
    let m;
    if ((m = u.match(new RegExp(FIREBASE_URL + '/leis_aprovadas/(\\d+)/projetos\\.json')))) {
      const d = FIRE[m[1]];
      return { ok: true, status: 200, json: async () => (d ? d.projetos : null) };
    }
    if ((m = u.match(new RegExp(ARQ_BASE + '/proposicoes-(\\d+)\\.json')))) {
      if (Number(m[1]) === FALHAR_ANO) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: k => (k.toLowerCase() === 'last-modified' ? 'Fri, 25 Sep 2026 04:33:51 GMT' : null) },
               json: async () => ARQUIVOS_CAMARA[m[1]] || [] };
    }
    if ((m = u.match(new RegExp(FIREBASE_URL + '/leis_aprovadas/(\\d+)\\.json')))) {
      const leg = m[1];
      if (metodo === 'PUT') { FIRE[leg] = JSON.parse(opcoes.body); return { ok: true, status: 200, json: async () => FIRE[leg] }; }
      if (metodo === 'DELETE') { FIRE[leg] = null; return { ok: true, status: 200, json: async () => null }; }
      return { ok: true, status: 200, json: async () => (leg in FIRE ? FIRE[leg] : null) };
    }
    if ((m = u.match(/\/deputados\?idLegislatura=(\d+)/))) {
      return { ok: true, status: 200, json: async () => ({ dados: API_ROSTER[m[1]] || [] }) };
    }
    if ((m = u.match(/\/proposicoes\/(\d+)\/autores/))) {
      const ids = API_AUTORES[m[1]] || [];
      return { ok: true, status: 200, json: async () => ({ dados: ids.map(id => ({ codTipo: 10000, uri: `https://dadosabertos.camara.leg.br/api/v2/deputados/${id}`, nome: `Dep ${id}` })) }) };
    }
    if ((m = u.match(/\/deputados\/(\d+)\/historico/))) {
      return { ok: true, status: 200, json: async () => ({ dados: API_HISTORICO[m[1]] || [] }) };
    }
    return { ok: false, status: 599, json: async () => ({}) };
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

(async () => {
  console.log('== o script está cadastrado corretamente ==');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    const recursos = manifest.web_accessible_resources.flatMap(w => w.resources);
    ok(recursos.includes('leisaprovadas.js'), 'leisaprovadas.js está em web_accessible_resources');
    ok(html.includes('<script src="leisaprovadas.js">'), 'e é carregado por aderencia.html');
    ok(html.indexOf('aderencia.js') < html.indexOf('leisaprovadas.js'),
       'vem DEPOIS de aderencia.js, de quem reaproveita FIREBASE_URL, mapLimit e cvEsc');
  }

  console.log('\n== legislaturas calculadas pela data ==');
  {
    ok(av(`leaLegislaturaAtual(new Date('2027-01-31T12:00:00Z'))`) === '57', '31/jan/2027 ainda é 57ª');
    ok(av(`leaLegislaturaAtual(new Date('2027-02-01T12:00:00Z'))`) === '58', '1º/fev/2027 já é 58ª — sem editar código');
    ok(av(`leaLegislaturaAtual(new Date('2031-02-01T12:00:00Z'))`) === '59', 'e 1º/fev/2031, 59ª');
    ok(av(`leaCfg('58').rotulo`) === '58ª (2027–2031)', 'rótulo da 58ª calculado');
    ok(av(`leaCfg('57').anos.join(',')`) === '2023,2024,2025,2026,2027', 'anos incluem o ano final (janeiro)');
    ok(av(`leaAnosParaColetar('57', new Date('2026-09-25T12:00:00Z')).join(',')`) === '2023,2024,2025,2026',
       'mas a coleta só pede arquivos até o ano corrente');
    const legs = av('leaListarLegislaturas()');
    const caixas = [...document.querySelectorAll('.lea-leg')].map(c => c.value);
    ok(caixas.join(',') === legs.join(','), `os checkboxes da consulta são gerados da conta (${caixas.join(', ')})`);
    ok([...document.querySelectorAll('.lea-up-leg')].length === legs.length, 'e os do upload também');
    const marcadas = [...document.querySelectorAll('.lea-leg')].filter(c => c.checked).map(c => c.value);
    ok(marcadas.join(',') === legs.slice(0, 2).join(','), `padrão: as duas mais recentes marcadas (${marcadas.join(', ')})`);
    ok(document.getElementById('leaFaixa').textContent === `da 53ª à ${legs[0]}ª legislatura`, 'a descrição acompanha a faixa');
    document.querySelectorAll('.lea-leg').forEach(c => { c.checked = false; });
  }

  console.log('\n== a aba existe e troca ==');
  {
    ok(!!document.getElementById('aba-leis'), 'a aba "Leis aprovadas" está no HTML');
    ok(document.getElementById('painel-leis').hidden === true, 'e começa escondida');
    document.getElementById('aba-leis').dispatchEvent(new Event('click', { bubbles: true }));
    ok(document.getElementById('painel-leis').hidden === false, 'clicar abre o painel');
    ok(document.getElementById('painel-producao').hidden === true, 'e fecha os outros');
    ok(document.getElementById('painel-aderencia').hidden === true, 'todos eles');
  }

  console.log('\n== material: duas legislaturas, com coautoria ==');
  {
    FIRE['57'] = {
      rotulo: '57ª (2023–2027)', atualizadoEm: '2026-09-20T10:00:00.000Z',
      ranking: [
        { depId: 1, nome: 'Ana Fulana', partido: 'PODE', uf: 'SP', condicao: 'Titular', total: 2 },
        { depId: 2, nome: 'Beto Sicrano', partido: 'PL', uf: 'RJ', condicao: 'Suplente', total: 1 },
        { depId: 3, nome: 'Carla Zero', partido: 'PODE', uf: 'MG', condicao: 'Titular', total: 0 },
      ],
      projetos: [
        { id: 900, tipo: 'PL', numero: 10, ano: 2023, ementa: 'Projeto conjunto de Ana e Beto.', dataApresentacao: '2023-05-01', autores: [1, 2] },
        { id: 901, tipo: 'PLP', numero: 20, ano: 2024, ementa: 'Projeto só de Ana.', dataApresentacao: '2024-03-10', autores: [1] },
      ],
    };
    FIRE['56'] = {
      rotulo: '56ª (2019–2023)', atualizadoEm: '2026-01-05T10:00:00.000Z',
      ranking: [
        { depId: 1, nome: 'Ana Fulana', partido: 'PT', uf: 'SP', condicao: 'Titular', total: 1 },
      ],
      projetos: [
        { id: 800, tipo: 'PL', numero: 5, ano: 2020, ementa: 'Projeto da legislatura passada.', dataApresentacao: '2020-06-01', autores: [1] },
      ],
    };
    // 55ª deliberadamente SEM dado agregado — é o caso "coleta ainda não rodou".
  }

  console.log('\n== duas legislaturas escolhidas: o agregado combina ==');
  {
    document.querySelector('.lea-leg[value="57"]').checked = true;
    document.querySelector('.lea-leg[value="56"]').checked = true;
    chamadas.length = 0;
    await av('leaConsultar()');
    ok(chamadas.some(c => c.includes('/leis_aprovadas/57.json')) && chamadas.some(c => c.includes('/leis_aprovadas/56.json')),
       'busca as duas legislaturas marcadas');
    const linhas = av('lea.linhas');
    ok(linhas.length === 4, `4 linhas: 3 de 57ª + 1 de 56ª (${linhas.length})`);
    ok(linhas.filter(l => l.nome === 'Ana Fulana').length === 2,
       'Ana aparece duas vezes — uma por legislatura, não fundida numa só');
    // A contagem "projetos" é a SOMA dos créditos (mesma semântica do app
    // original: todo coautor recebe crédito) — não o nº de projetos distintos.
    // 57ª: Ana(2) + Beto(1) + Carla(0) = 3; 56ª: Ana(1) = 1; total = 4.
    const tela = document.getElementById('leaResultado').textContent;
    ok(/4 registro\(s\)/.test(tela) && /4 projeto\(s\)/.test(tela),
       'a tela soma os créditos (4), consistente com "todo coautor recebe crédito"');
  }

  console.log('\n== data/hora da coleta e aviso de dado velho ==');
  {
    const texto = av(`leaAtualizadoEmTexto(['57'])`);
    ok(/20\/09\/2026/.test(texto) && /07:00/.test(texto) && /Brasília/.test(texto),
       `mostra data E hora, no horário de Brasília (${texto})`);
    ok(av(`leaAvisoDadoVelho(new Date('2026-09-21T10:00:00Z'))`) === '', 'dado da corrente com 1 dia: sem aviso');
    const aviso = av(`leaAvisoDadoVelho(new Date('2026-09-30T10:00:00Z'))`);
    ok(/não é atualizado desde/.test(aviso) && /Coletar agora/.test(aviso), 'com mais de 3 dias: aviso + botão "Coletar agora"');
  }

  console.log('\n== a coautoria credita os DOIS, e cada um só vê o que é dele ==');
  {
    const linhas = av('lea.linhas');
    const ana57 = linhas.find(l => l.nome === 'Ana Fulana' && l.legislatura === '57');
    const beto57 = linhas.find(l => l.nome === 'Beto Sicrano');
    ok(ana57.projetos.length === 2, `Ana (57ª) tem os 2 projetos que assinou (${ana57.projetos.length})`);
    ok(beto57.projetos.length === 1, `Beto tem só o projeto conjunto, não o solo de Ana (${beto57.projetos.length})`);
    ok(beto57.projetos[0].id === 900, 'e é o projeto certo (id 900)');
  }

  console.log('\n== filtros batem sem chamada nova à API ==');
  {
    chamadas.length = 0;
    document.getElementById('leaPartido').value = 'PODE';
    document.getElementById('leaPartido').dispatchEvent(new Event('input'));
    let linhas = av('leaFiltradas()');
    ok(linhas.every(l => l.partido === 'PODE'), 'filtro de partido restringe a PODE');
    ok(chamadas.length === 0, 'sem nenhuma chamada de rede nova — o filtro é local');

    document.getElementById('leaPartido').value = '';
    document.getElementById('leaSoComLei').checked = true;
    linhas = av('leaFiltradas()');
    ok(linhas.every(l => l.total > 0), '"só com ≥1 projeto" tira Carla Zero (total 0)');
    ok(!linhas.some(l => l.nome === 'Carla Zero'), 'especificamente: Carla some da lista');
    document.getElementById('leaSoComLei').checked = false;

    document.getElementById('leaCondicao').value = 'suplente';
    linhas = av('leaFiltradas()');
    ok(linhas.length === 1 && linhas[0].nome === 'Beto Sicrano', 'filtro de condição isola o suplente (Beto)');
    document.getElementById('leaCondicao').value = '';
  }

  console.log('\n== legislatura sem dado agregado: aviso, não erro nem silêncio ==');
  {
    document.querySelectorAll('.lea-leg').forEach(c => { c.checked = c.value === '55'; });
    await av('leaConsultar()');
    const tela = document.getElementById('leaResultado').innerHTML;
    ok(/coleta roda no bot/.test(tela), 'a tela explica que a coleta ainda não rodou para 55ª, em vez de aparentar lista vazia por ausência de leis');
    ok(!document.getElementById('leaStatus').classList.contains('error'),
       'e isso NÃO é tratado como erro — é o estado normal antes da primeira coleta');
  }

  console.log('\n== a planilha ==');
  {
    document.querySelectorAll('.lea-leg').forEach(c => { c.checked = c.value === '57' || c.value === '56'; });
    await av('leaConsultar()');
    av('leaExportar()');
    const abas = Object.keys(ctx._planilha.wb.abas);
    ok(abas.join(',') === 'Ranking,Projetos', `duas abas: ranking e projetos (${abas.join(', ')})`);
    const projetos = ctx._planilha.wb.abas['Projetos']._r;
    // Uma linha por (deputado, projeto): Ana/57(900), Ana/57(901), Beto/57(900), Ana/56(800) = 4.
    // O projeto 900 aparece duas vezes (uma por autor) — é a mesma crediação dupla do ranking.
    ok(projetos.length === 4, `a aba Projetos tem uma linha por (deputado, projeto), inclusive repetida entre coautores — 4 no total (${projetos.length})`);
    ok(projetos.some(p => p.Deputado === 'Beto Sicrano' && p.idProposicao === 900),
       'o projeto conjunto aparece na linha do Beto');
    ok(projetos.some(p => p.Deputado === 'Ana Fulana' && p.idProposicao === 900)
       && projetos.some(p => p.Deputado === 'Ana Fulana' && p.idProposicao === 901),
       'e nas duas linhas da Ana (901 é só dela)');
  }

  console.log('\n== caminho MANUAL: classificação e filtro (funções puras) ==');
  {
    ok(av(`leaClassificarPorLegislatura('2007-02-01')`) === '53', 'início exato da faixa entra (inclusive)');
    ok(av(`leaClassificarPorLegislatura('2023-01-15')`) === '56',
       'janeiro/2023 ainda é 56ª, mesmo que apareça no arquivo proposicoes-2023.json (mesma regra do bot)');
    ok(av(`leaClassificarPorLegislatura(null)`) === null, 'sem data, não classifica');

    const leis = av(`leaFiltrarProjetosLei([
      { id: 1, siglaTipo: 'PL', numero: 1, ano: 2007, ementa: 'Vira lei.', dataApresentacao: '2007-05-01', ultimoStatus: { idSituacao: 1140 } },
      { id: 2, siglaTipo: 'PL', numero: 2, ano: 2007, ementa: 'Ainda tramitando.', dataApresentacao: '2007-05-01', ultimoStatus: { idSituacao: 924 } },
      { id: 3, siglaTipo: 'REQ', numero: 3, ano: 2007, ementa: 'Tipo fora do filtro.', dataApresentacao: '2007-05-01', ultimoStatus: { idSituacao: 1140 } },
    ], ['PL', 'PLP'])`);
    ok(leis.length === 1 && leis[0].id === 1, `só o PL com situação 1140 entra (${JSON.stringify(leis.map(l => l.id))})`);
  }

  console.log('\n== caminho MANUAL: processar arquivo(s) local(is) ==');
  let resultado53;
  {
    // Um "arquivo" cobrindo a 53ª, com o mesmo ruído do teste do bot: tipo
    // fora do filtro, situação errada, e um autor (11) fora do roster.
    ctx.__arquivo2007 = arquivoFalso('proposicoes-2007.json', [
      { id: 700, siglaTipo: 'PL', numero: 10, ano: 2007, ementa: 'Vira lei, coautoria com quem não está no roster.',
        dataApresentacao: '2007-04-01', ultimoStatus: { idSituacao: 1140 } },
      { id: 701, siglaTipo: 'PL', numero: 11, ano: 2007, ementa: 'Situação errada.',
        dataApresentacao: '2007-04-01', ultimoStatus: { idSituacao: 924 } },
    ]);
    ctx.__fases = [];
    chamadas.length = 0;
    resultado53 = await av(`leaProcessarLocal(['53'], [__arquivo2007], { comCondicao: true, onFase: f => __fases.push(f) })`);

    ok(resultado53['53'].projetos.length === 1 && resultado53['53'].projetos[0].id === 700,
       `só o projeto com situação certa entra (${JSON.stringify(resultado53['53'].projetos.map(p => p.id))})`);
    const porDep = Object.fromEntries(resultado53['53'].ranking.map(r => [r.depId, r]));
    ok(porDep[10] && porDep[10].total === 1 && porDep[10].nome === 'Duda Veterana',
       'o autor do roster aparece com o nome certo');
    ok(porDep[11] && porDep[11].total === 1, 'o coautor FORA do roster aparece assim mesmo, com crédito');
    ok(porDep[10].condicao === 'Titular', 'condição titular/suplente veio do histórico');
    ok(porDep[11].condicao === '—', 'sem histórico cadastrado, condição fica "—" — não trava o processamento');
    ok(ctx.__fases.some(f => /Lendo "proposicoes-2007\.json"/.test(f)), 'o progresso de leitura do arquivo é reportado');
    ok(chamadas.some(c => c.includes('idLegislatura=53')) && chamadas.some(c => c.includes('/700/autores'))
       && chamadas.some(c => c.includes('/historico')), 'busca roster, autores e histórico na API (tudo com CORS)');
    ok(!chamadas.some(c => c.includes('leis_aprovadas')), 'processar sozinho NÃO grava nada no Firebase — é um passo à parte');
    ok(resultado53['53'].anosFaltando.join(',') === '2008,2009,2010,2011',
       `anota os anos da legislatura que não vieram entre os arquivos (${resultado53['53'].anosFaltando.join(',')})`);
    ok(av(`leaMotivosParaNaoGravar(${JSON.stringify(resultado53['53'])})`).length === 1, 'e isso vira motivo para NÃO gravar');
  }

  console.log('\n== coleta pela extensão, direto da Câmara ==');
  {
    chamadas.length = 0;
    ctx.__fases = [];
    const r = await av(`leaColetarDaCamara('57', { comCondicao: false, onFase: f => __fases.push(f) })`);
    ok(chamadas.some(c => c.includes(ARQ_BASE + '/proposicoes-2023.json')), 'baixa os arquivos em massa direto (host_permissions da extensão)');
    ok(r.projetos.length === 1 && r.projetos[0].id === 950, 'classifica pela data: o PL de janeiro/2023 (56ª) fica de fora');
    ok(r.ranking.find(x => x.depId === 1).total === 1, 'e credita o autor');
    ok(r.anosFaltando.length === 0 && r.dataArquivos['2023'] === '2026-09-25T04:33:51.000Z',
       'sem ano faltando, e com a data do arquivo da Câmara (Last-Modified)');
    ok(r.origem === 'extensão', 'origem registrada');
    ok(av(`leaMotivosParaNaoGravar(${JSON.stringify(r)})`).length === 0, 'coleta completa: pode gravar');

    FALHAR_ANO = 2024;
    const r2 = await av(`leaColetarDaCamara('57', { comCondicao: false })`);
    FALHAR_ANO = null;
    ok(r2.anosFaltando.join(',') === '2024', 'um ano que não baixa é anotado, sem derrubar a coleta');
    ok(/2024/.test(av(`leaMotivosParaNaoGravar(${JSON.stringify(r2)})`)[0] || ''), 'e bloqueia a gravação');
  }

  console.log('\n== caminho MANUAL: "Gravar no Firebase" e "Limpar no Firebase" ==');
  {
    ctx.__resultado53 = resultado53['53'];
    FIRE['53'] = null;
    chamadas.length = 0;
    await av(`leaGravarFirebase('53', __resultado53)`);
    ok(!!FIRE['53'], 'leaGravarFirebase grava no Firebase (falso)');
    ok(FIRE['53'].projetos.length === 1 && FIRE['53'].ranking.length === 2, 'com o ranking e os projetos processados');
    ok(chamadas.some(c => c.startsWith('PUT') && c.includes('/leis_aprovadas/53.json')), 'via PUT no caminho certo');
    ok(av(`lea.cache['53']`).projetos.length === 1, 'e atualiza o cache local — a tela já reflete sem precisar buscar de novo');

    // "Limpar no Firebase" pede confirmação: recusada, não apaga nada.
    document.querySelectorAll('.lea-leg').forEach(c => { c.checked = c.value === '53'; });
    ctx.confirm = () => false;
    chamadas.length = 0;
    await av('leaLimparClick()');
    ok(!!FIRE['53'], 'confirmação recusada: nada é apagado');
    ok(!chamadas.some(c => c.startsWith('DELETE')), 'e nenhuma chamada DELETE é feita');

    // Aceita: apaga de verdade.
    ctx.confirm = () => true;
    await av('leaLimparClick()');
    ok(FIRE['53'] === null, 'confirmação aceita: o agregado da 53ª é apagado no Firebase (falso)');
    ok(av(`lea.linhas`).length === 0, 'e a tela local esvazia — precisa buscar de novo para repopular');
    ctx.confirm = () => false; // devolve o padrão para o resto do arquivo
  }

  console.log('\n== travas no clique de gravar ==');
  {
    ctx.__st = [];
    ctx.__incompleto = { rotulo: '57ª (2023–2027)', ranking: [], projetos: [], anosFaltando: [2024], falhasAutores: 0 };
    chamadas.length = 0;
    await av(`leaGravarComTravas('57', __incompleto, (m, t) => __st.push([m, t]))`);
    ok(!chamadas.some(c => c.startsWith('PUT')), 'coleta com ano faltando: NENHUM PUT');
    ok(ctx.__st.some(([m, t]) => t === 'error' && /NÃO gravado/.test(m)), 'e o motivo aparece como erro');

    // 57ª salva com 2 projetos; coleta nova com 1 → confirmação extra, recusada.
    let perguntas = [];
    ctx.confirm = (msg) => { perguntas.push(msg); return false; };
    ctx.__menor = { rotulo: '57ª (2023–2027)', ranking: [], projetos: [{ id: 1 }], anosFaltando: [], falhasAutores: 0 };
    chamadas.length = 0;
    await av(`leaGravarComTravas('57', __menor, (m, t) => __st.push([m, t]))`);
    ok(perguntas.length === 1 && /MENOS que os 2 já salvos/.test(perguntas[0]), 'menos projetos que o salvo: confirmação específica');
    ok(!chamadas.some(c => c.startsWith('PUT')), 'recusada: nada gravado');
    ctx.confirm = () => true;
    await av(`leaGravarComTravas('57', __menor, (m, t) => __st.push([m, t]))`);
    ok(FIRE['57'].projetos.length === 1 && FIRE['57'].origem === 'extensão', 'aceita: grava, com a origem');
    ctx.confirm = () => false;
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
