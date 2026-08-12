// Autoria com o PORTAL como fonte PRIMÁRIA e a API de reserva (invertido por
// decisão do usuário em 12/08/2026, com a API 504 em produção). A página
// prop_autores é renderizada no servidor e traz "Nome - PARTIDO/UF" na ordem
// de assinatura, com o id do deputado no link — uma requisição no lugar das
// 1+N da via API.
//
// Roda contra o HTML REAL gravado em testes/fixtures/ (12/08/2026).
// Uso: node testes/autores-portal.test.js
const fs = require('fs');
const path = require('path');
const { DOMParser } = require(path.join(__dirname, '..', 'bot', 'node_modules', 'linkedom'));

const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const HTML_RCP = fs.readFileSync(path.join(__dirname, 'fixtures', 'autores-rcp2-2617166.html'), 'utf8');
const HTML_PL = fs.readFileSync(path.join(__dirname, 'fixtures', 'autores-pl1828-2355883.html'), 'utf8');
// Página REAL do PL 25/2024 (12/08/2026): o portal omite o "- PARTIDO/UF" do
// Delegado Bruno Lima (Podemos) — só nome e link. Caso do não-Podemos silencioso.
const HTML_PL25 = fs.readFileSync(path.join(__dirname, 'fixtures', 'autores-pl25-2416877.html'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Monta autoresDoPortal + fetchAutoresProposicao com dependências stubadas.
function montar({ api, deputado, portalHtml }) {
  const partes = [
    "const SIGLA_PODEMOS = 'PODE';",
    "const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';",
    'const state = { cacheAutoria: new Map() };',
    src.match(/async function autoresDoPortal[\s\S]*?\n}/)[0],
    src.match(/async function preencherPartidosFaltantes[\s\S]*?\n}/)[0],
    src.match(/async function fetchAutoresProposicao[\s\S]*?\n}/)[0],
    src.match(/async function fetchInfoDeputado[\s\S]*?\n}/)[0],
    src.match(/async function _mapLimit[\s\S]*?\n}/)[0],
  ].join('\n');
  const fetchJson = async url => {
    if (url.includes('/autores')) { if (api instanceof Error) throw api; return { dados: api }; }
    if (url.includes('/deputados/')) { if (deputado instanceof Error) throw deputado; return { dados: deputado }; }
    throw new Error('url inesperada: ' + url);
  };
  const fetchJsonCamara = async url => fetchJson(url);   // fetchInfoDeputado usa 2 tentativas
  const fetchHtmlCamara = async () => portalHtml || null;
  return new Function('fetchJson', 'fetchJsonCamara', 'fetchHtmlCamara', 'DOMParser', 'console',
    'return (async()=>{' + partes + '; return fetchAutoresProposicao;})()')(
    fetchJson, fetchJsonCamara, fetchHtmlCamara, DOMParser, { ...console, warn() {} });
}

(async () => {
  console.log('== portal é a fonte PRIMÁRIA ==');
  {
    // API saudável E portal saudável → quem responde é o PORTAL (uma
    // requisição), e a API nem é chamada.
    let apiChamada = false;
    const f = await montar({
      api: (apiChamada = true, [{ nome: 'X', uri: 'x/deputados/1', ordemAssinatura: 1 }]),
      deputado: { ultimoStatus: { siglaPartido: 'PT' } },
      portalHtml: HTML_PL,
    });
    const a = await f(2355883);
    ok(a[0].fonte === 'portal' && a[0].nome === 'Rodrigo Gambale', 'portal responde primeiro');
  }

  console.log('\n== portal fora → a API assume (reserva) ==');
  {
    const f = await montar({
      api: [{ nome: 'Renata Abreu', uri: 'x/deputados/1', ordemAssinatura: 1 }],
      deputado: { ultimoStatus: { nome: 'Renata Abreu', siglaPartido: 'PODE', siglaUf: 'SP' } },
      portalHtml: null,
    });
    const a = await f(99);
    ok(a.length === 1 && a[0].isPodemos === true && a[0].fonte === undefined, 'API cobre quando o portal falha');
  }

  console.log('\n== os dois pelo HTML real (portal) ==');
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

  console.log('\n== portal omite o partido de um deputado → ficha da API completa ==');
  {
    // Caso real PL 25/2024: "Delegado Bruno Lima" vem SEM "- PARTIDO/UF" na
    // página; os outros três vêm completos. A ficha da API preenche a lacuna.
    const f = await montar({
      api: new Error('não deve ser chamada'),
      deputado: { ultimoStatus: { nome: 'Delegado Bruno Lima', siglaPartido: 'PODE', siglaUf: 'SP' } },
      portalHtml: HTML_PL25,
    });
    const a = await f(2416877);
    const bruno = a.find(x => /Bruno Lima/.test(x.nome));
    ok(a.length === 4, `4 autores da página real (${a.length})`);
    ok(bruno.siglaPartido === 'PODE' && bruno.isPodemos === true,
       `lacuna preenchida pela ficha: ${bruno.nome} [${bruno.siglaPartido}/${bruno.siglaUf}]`);
    ok(a.find(x => /Laiola/.test(x.nome)).siglaPartido === 'UNIÃO', 'quem veio completo não é tocado');
  }

  console.log('\n== portal omite o partido E a ficha falha → lacuna DECLARADA ==');
  {
    const f = await montar({
      api: new Error('não deve ser chamada'),
      deputado: new Error('HTTP 504'),
      portalHtml: HTML_PL25,
    });
    const a = await f(2416877);
    const bruno = a.find(x => /Bruno Lima/.test(x.nome));
    ok(bruno.partidoNaoVerificado === true && !bruno.isPodemos,
       'sem fonte para o partido, fica partidoNaoVerificado — não "não-Podemos" mudo');
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
