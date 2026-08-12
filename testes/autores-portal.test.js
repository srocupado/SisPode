// Autoria com fallback pelo portal (emergência de 12/08/2026, API 504 em
// produção): a via API (1+N chamadas por item) morria e levava junto o
// enriquecimento, os badges e os apelidos. A página prop_autores do portal é
// renderizada no servidor e traz "Nome - PARTIDO/UF" na ordem de assinatura,
// com o id do deputado no link.
//
// Roda contra o HTML REAL gravado em testes/fixtures/ (12/08/2026).
// Uso: node testes/autores-portal.test.js
const fs = require('fs');
const path = require('path');
const { DOMParser } = require(path.join(__dirname, '..', 'bot', 'node_modules', 'linkedom'));

const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const HTML_RCP = fs.readFileSync(path.join(__dirname, 'fixtures', 'autores-rcp2-2617166.html'), 'utf8');
const HTML_PL = fs.readFileSync(path.join(__dirname, 'fixtures', 'autores-pl1828-2355883.html'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Monta autoresDoPortal + fetchAutoresProposicao com dependências stubadas.
function montar({ api, deputado, portalHtml }) {
  const partes = [
    "const SIGLA_PODEMOS = 'PODE';",
    "const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';",
    'const state = { cacheAutoria: new Map() };',
    src.match(/async function autoresDoPortal[\s\S]*?\n}/)[0],
    src.match(/async function fetchAutoresProposicao[\s\S]*?\n}/)[0],
    src.match(/async function fetchInfoDeputado[\s\S]*?\n}/)[0],
  ].join('\n');
  const fetchJson = async url => {
    if (url.includes('/autores')) { if (api instanceof Error) throw api; return { dados: api }; }
    if (url.includes('/deputados/')) { if (deputado instanceof Error) throw deputado; return { dados: deputado }; }
    throw new Error('url inesperada: ' + url);
  };
  const fetchHtmlCamara = async () => portalHtml || null;
  return new Function('fetchJson', 'fetchHtmlCamara', 'DOMParser', 'console',
    'return (async()=>{' + partes + '; return fetchAutoresProposicao;})()')(
    fetchJson, fetchHtmlCamara, DOMParser, { ...console, warn() {} });
}

(async () => {
  console.log('== via API saudável: nada muda ==');
  {
    const f = await montar({
      api: [{ nome: 'Renata Abreu', uri: 'x/deputados/1', ordemAssinatura: 1 }],
      deputado: { ultimoStatus: { nome: 'Renata Abreu', siglaPartido: 'PODE', siglaUf: 'SP' } },
      portalHtml: null,
    });
    const a = await f(99);
    ok(a.length === 1 && a[0].isPodemos === true && a[0].fonte === undefined, 'API ok → resultado da API, sem portal');
  }

  console.log('\n== API fora → portal, com o HTML real ==');
  {
    const f = await montar({ api: new Error('HTTP 504'), deputado: null, portalHtml: HTML_RCP });
    const a = await f(2617166);
    ok(a.length >= 100, `${a.length} signatários do RCP pela página do portal`);
    ok(a[0].nome === 'Delegado Bruno Lima' && a[0].siglaPartido === 'PODE' && a[0].ordem === 1 && a[0].isPodemos,
       `1º signatário certo: ${a[0].nome} (${a[0].siglaPartido}/${a[0].siglaUf})`);
    ok(a[0].fonte === 'portal', 'resultado marcado com a fonte');
  }

  console.log('\n== ficha do deputado fora → partido viria vazio → portal cobre ==');
  {
    // A API de autores responde, mas a ficha do deputado falha: sem o
    // fallback, o item viraria "não-Podemos" SILENCIOSO — o pior defeito.
    const f = await montar({
      api: [{ nome: 'Rodrigo Gambale', uri: 'x/deputados/220641', ordemAssinatura: 1 }],
      deputado: new Error('HTTP 504'),
      portalHtml: HTML_PL,
    });
    const a = await f(2355883);
    ok(a[0].siglaPartido === 'PODE' && a[0].isPodemos === true,
       `partido resgatado pelo portal: ${a[0].nome} ${a[0].siglaPartido}/${a[0].siglaUf}`);
  }

  console.log('\n== tudo fora → o erro sobe (nunca lista vazia silenciosa) ==');
  {
    const f = await montar({ api: new Error('HTTP 504'), deputado: null, portalHtml: null });
    const err = await f(1).then(() => null, e => e.message);
    ok(/504/.test(err || ''), `erro explícito: ${err}`);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
