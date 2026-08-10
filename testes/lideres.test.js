// Testes do módulo Reunião de Líderes.
//
// lideres.js roda no navegador, então aqui ele é carregado num sandbox com os
// objetos que a extensão fornece (document, chrome, pdfjsLib) e só as funções
// puras são exercitadas — o parser do PDF e as regras de situação/relatoria,
// que são justamente as que produzem informação factual sem passar por IA.
//
// pdfjs-dist vem de bot/node_modules (a extensão distribui a versão de
// navegador em libs/), por isso o require aponta para lá.
//
// Uso: node testes/lideres.test.js <caminho-do-pdf-da-reuniao>
//   O PDF de referência é a lista do Colégio de Líderes de 07/07/2026 (62
//   itens, 68 proposições); os números conferidos abaixo são os dele.
const fs = require('fs');
const path = require('path');
const pdfjs = require(path.join(__dirname, '..', 'bot', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));

const fonte = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
const sandbox = {
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: pdfjs.getDocument },
  window: {},
  fetch: globalThis.fetch,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  console,
  setTimeout, clearTimeout,
  DOMException: globalThis.DOMException,
  XLSX: undefined,
};
const exportar = ['lerListaDoPDF', 'proposicoesDoItem', 'situacaoDe', 'relatoriaDe',
                  'despachosDeComissao', 'extrairJSON', 'formatarPartido', 'buscarTramitacoes'];
const fn = new Function(...Object.keys(sandbox),
  `${fonte}\n; return { ${exportar.join(', ')} };`);
const L = fn(...Object.values(sandbox));

const PDF = process.argv[2];
const API = 'https://dadosabertos.camara.leg.br/api/v2';
let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

(async () => {
  console.log('\n== Parser do PDF ==');
  const itens = await L.lerListaDoPDF({ arrayBuffer: async () => fs.readFileSync(PDF).buffer });
  ok(itens.length === 62, `62 itens (obtidos: ${itens.length})`);
  ok(itens[0].num === '1' && /^PLP 230\/2025$/.test(itens[0].prop), `item 1 = PLP 230/2025 (obtido: "${itens[0].prop}")`);
  ok(itens[0].autoria === 'Juscelino Filho e Luisa Canziani', `autoria do item 1 (obtida: "${itens[0].autoria}")`);
  ok(/especifica\.$/.test(itens[0].descricao), 'descrição do item 1 completa');
  ok(itens[3].autoria === 'Julio Lopes e Paulo Abi-Ackel', `hífen entre fragmentos (obtido: "${itens[3].autoria}")`);
  ok(itens.every(i => /^\d{1,3}$/.test(i.num)), 'todo item tem número limpo (sem cabeçalho colado)');
  ok(itens.map(i => Number(i.num)).every((n, k) => n === k + 1), 'numeração 1..62 sem furos');

  const props = itens.flatMap(i => L.proposicoesDoItem(i));
  console.log(`  · ${props.length} proposições em ${itens.length} itens`);
  const it12 = L.proposicoesDoItem(itens[11]);
  ok(it12.length === 2 && it12[0].chave === 'PL 101/2026' && it12[1].chave === 'PL 23/2026',
     `item 12 rende as duas proposições (obtido: ${it12.map(p => p.chave).join(', ')})`);
  ok(it12[1].ehPrincipal === true && it12[0].ehPrincipal === false, 'a que está em "(Principal: …)" é marcada como principal');
  ok(props.every(p => p.ano >= 1990 && p.ano <= 2030), 'anos plausíveis');

  console.log('\n== Situação e relatoria (PLP 230/2025, contra a API real) ==');
  const id = (await (await fetch(`${API}/proposicoes?siglaTipo=PLP&numero=230&ano=2025&itens=1`)).json()).dados[0].id;
  const det = (await (await fetch(`${API}/proposicoes/${id}`)).json()).dados;
  const trams = await L.buscarTramitacoes(id);
  const sit = L.situacaoDe(trams, itens[0].regime);
  ok(sit === 'Urgência aprovada (REQ. 2708/2026)', `situação = "${sit}"`);
  const rel = await L.relatoriaDe(trams, det.statusProposicao);
  ok(rel === 'Dep. Maria Rosas (Republicanos-SP)', `relatoria = "${rel}"`);
  const desp = L.despachosDeComissao(trams, det.statusProposicao);
  ok(desp.distribuicao.length === 0, `sem despacho de distribuição (${desp.distribuicao.length})`);

  console.log('\n== Regras de situação (casos sintéticos) ==');
  ok(L.situacaoDe([], 'REQ 3787/2025 (PL 3967/2025)') === 'Requerimento de urgência apresentado (REQ n. 3787/2025)',
     'sem API, o REQ do PDF vira "requerimento apresentado"');
  ok(L.situacaoDe([], 'Prioridade (Art. 151, II, RICD)') === 'Não há requerimento de urgência apresentado.',
     'regime de prioridade → sem requerimento de urgência');
  ok(L.situacaoDe([], 'Urgência aprovada em 16/06/2026') === 'Urgência aprovada em 16/06/2026',
     'sem API, vale o texto do PDF');
  ok(L.situacaoDe([{ despacho: 'Apresentação do REQ n. 900/2026 (Requerimento de Urgência (Art. 155 do RICD)), pelo Dep. X' }], '')
     === 'Requerimento de urgência apresentado (REQ n. 900/2026)', 'requerimento apresentado e não votado');

  ok(L.situacaoDe([], 'Ordinário (Art. 151, III, RICD) (Urgência aprovada em 26/05/2026)') === 'Urgência aprovada em 26/05/2026',
     'célula mista → só o trecho de urgência');
  ok(/sem requerimento de urg[êe]ncia localizado/.test(L.situacaoDe([], 'Urgência')),
     'lista diz "Urgência" e a API não tem nada → contradição declarada, não negada');

  console.log('\n== Relatoria: relator de comissão não é relatoria de Plenário ==');
  const relCom = await L.relatoriaDe(
    [{ siglaOrgao: 'CCJC', descricaoTramitacao: 'Designação de Relator(a)', despacho: 'Designado Relator, Dep. Fulano (PT-SP).' }], null);
  ok(relCom === 'Sem indicação', `designação em comissão → "${relCom}"`);

  console.log('\n== Extração de JSON da resposta da IA ==');
  ok(L.extrairJSON('```json\n{"objetivo":"a"}\n```').objetivo === 'a', 'JSON entre cercas');
  ok(L.extrairJSON('Segue:\n{"objetivo":"b"}\nAbraço').objetivo === 'b', 'JSON com texto em volta');
  ok(L.formatarPartido('REPUBLICANOS') === 'Republicanos' && L.formatarPartido('PSD') === 'PSD', 'partido formatado');

  console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTudo passou.\n');
  process.exit(falhas ? 1 : 0);
})();
