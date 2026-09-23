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
//     projeto), não de outro.
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

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({ abas: {} }), json_to_sheet: r => ({ _r: r }),
                   book_append_sheet: (wb, ws, nome) => { wb.abas[nome] = ws; } },
          writeFile: (wb, nome) => { ctx._planilha = { wb, nome }; } },
  fetch: async (url) => {
    const u = String(url);
    chamadas.push(u);
    const m = u.match(new RegExp(FIREBASE_URL + '/leis_aprovadas/(\\d+)\\.json'));
    if (m) {
      const leg = m[1];
      return { ok: true, status: 200, json: async () => (leg in FIRE ? FIRE[leg] : null) };
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

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
