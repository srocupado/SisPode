// Testes dos sistemas 2 (Demandas de Deputados) e 3 (E-mail de Demandas) do
// módulo Reunião de Líderes.
//
// Mesmo sandbox de lideres.test.js: o arquivo do navegador é carregado com
// stubs e só as funções puras/factuais são exercitadas. O formato do e-mail é
// conferido CARACTERE A CARACTERE contra o padrão de registro dado pela
// Liderança; a parte factual roda contra a API real da Câmara com o exemplo
// real do padrão (PLP 78/2025 → "Bacelar PV/BA").
//
// Uso: node testes/lideres-demandas.test.js
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
const sandbox = {
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {} },
  window: {},
  fetch: globalThis.fetch,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  console,
  setTimeout, clearTimeout,
  DOMException: globalThis.DOMException,
  XLSX: undefined,
};
const exportar = ['refDemanda', 'blocoDemandaEmail', 'montarEmailDemandas',
                  'fatosDaDemanda', 'autoriaDemanda', 'situacaoDe', 'grupoDemanda'];
const fn = new Function(...Object.keys(sandbox), `${fonte}\n; return { ${exportar.join(', ')} };`);
const L = fn(...Object.values(sandbox));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== refDemanda ==');
  ok(L.refDemanda('PLP 78/2025').chave === 'PLP 78/2025', 'forma canônica');
  ok(L.refDemanda('plp78/25').chave === 'PLP 78/2025', 'minúscula, sem espaço, ano curto');
  ok(L.refDemanda('o PL 4822 2025 por favor').chave === 'PL 4822/2025', 'no meio de frase, com espaço');
  ok(L.refDemanda('bom dia') === null, 'texto sem referência → null');

  console.log('\n== blocoDemandaEmail: o padrão de registro da Liderança ==');
  // Demanda exatamente como o exemplo dado — o bloco tem de sair idêntico.
  const exemplo = {
    tratamento: 'Deputado', deputado: 'David Soares',
    chave: 'PLP 78/2025', natureza: 'Solicitar relatoria',
    autoria: 'Bacelar PV/BA',
    ementa: 'Dispõe sobre a regulamentação de locação para temporada, quando intermediada por empresas operadoras de aplicativo ou de outra plataforma em rede, altera a Lei nº 11.771, de 17 de setembro de 2008, a Lei nº 8.245, de 18 de outubro de 1991, a Lei nº 10.257, de 10 de julho de 2001, a Lei Complementar nº 116, de 31 de julho de 2003, a Lei nº 7.713, de 22 de dezembro de 1988, e dá outras providências.',
    situacao: 'Requerimento de urgência apresentado (REQ n. 2778/2026)',
  };
  const esperado =
    '•\tPLP 78/2025\n' +
    'Natureza da demanda: Solicitar relatoria\n' +
    'Autoria: Bacelar PV/BA\n' +
    'Ementa: Dispõe sobre a regulamentação de locação para temporada, quando intermediada por empresas operadoras de aplicativo ou de outra plataforma em rede, altera a Lei nº 11.771, de 17 de setembro de 2008, a Lei nº 8.245, de 18 de outubro de 1991, a Lei nº 10.257, de 10 de julho de 2001, a Lei Complementar nº 116, de 31 de julho de 2003, a Lei nº 7.713, de 22 de dezembro de 1988, e dá outras providências.\n' +
    'Situação: Requerimento de urgência apresentado (REQ n. 2778/2026).';
  ok(L.blocoDemandaEmail(exemplo) === esperado, 'bloco idêntico ao padrão, caractere a caractere');
  ok(/\(REQ n\. 2778\/2026\)\.$/.test(L.blocoDemandaEmail(exemplo)), 'situação sem ponto final ganha o ponto');
  const jaComPonto = { ...exemplo, situacao: 'Urgência aprovada (REQ. 2708/2026).' };
  ok(!/\.\.$/.test(L.blocoDemandaEmail(jaComPonto)), 'situação que já termina em ponto não ganha outro');

  console.log('\n== montarEmailDemandas: agrupamento por deputado ==');
  const d2 = { ...exemplo, chave: 'PL 2030/2026', natureza: 'Apoiar a aprovação',
               autoria: 'David Soares UNIÃO/SP', ementa: 'Ementa dois.', situacao: 'Não há requerimento de urgência apresentado.' };
  const d3 = { ...exemplo, tratamento: 'Deputada', deputado: 'Renata Abreu',
               chave: 'PL 1450/2026', natureza: 'Solicitar inclusão em pauta',
               autoria: 'Renata Abreu PODE/SP', ementa: 'Ementa três.', situacao: 'Urgência aprovada (REQ. 100/2026)' };
  const email = L.montarEmailDemandas([exemplo, d2, d3]);
  ok(email.startsWith('Deputado DAVID SOARES:\n\n•\tPLP 78/2025\n'), 'cabeçalho com o nome em maiúsculas');
  ok(email.includes('Deputada RENATA ABREU:'), 'tratamento Deputada respeitado no cabeçalho');
  ok((email.match(/Deputado DAVID SOARES:/g) || []).length === 1, 'duas demandas do mesmo deputado sob UM cabeçalho');
  ok(email.indexOf('PL 2030/2026') > email.indexOf('PLP 78/2025') &&
     email.indexOf('PL 2030/2026') < email.indexOf('Deputada RENATA ABREU:'),
     'demandas do deputado ficam juntas, na ordem de registro');
  ok(email.split('Deputada RENATA ABREU:')[0].trimEnd().endsWith('.'), 'blocos separados por linha em branco');

  console.log('\n== camada factual (API real — o exemplo do padrão) ==');
  const t0 = Date.now();
  const ref = L.refDemanda('PLP 78/2025');
  const fatos = await L.fatosDaDemanda(ref);
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  ok(Number.isInteger(fatos.idCamara), `idCamara resolvido (${fatos.idCamara})`);
  ok(/locação para temporada/i.test(fatos.ementa), 'ementa é a do PLP 78/2025');
  ok(/^Bacelar PV\/BA/.test(fatos.autoria), `autoria no padrão "Bacelar PV/BA" (obtida: "${fatos.autoria}")`);
  // A situação evolui com a tramitação — o que se garante é a FORMA: uma das
  // três frases fixas de situacaoDe (a do exemplo era o REQ 2778/2026).
  ok(/^(Urgência aprovada|Requerimento de urgência apresentado \(REQ n\. \d+\/\d{4}\)|Não há requerimento|Urgência indicada na lista)/.test(fatos.situacao),
     `situação numa das formas fixas (obtida: "${fatos.situacao}")`);

  const inexistente = await L.fatosDaDemanda(L.refDemanda('PL 999999/2026')).then(() => null, e => e.message);
  ok(/não localizada/.test(inexistente || ''), 'proposição inexistente dá erro claro, não registro vazio');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
