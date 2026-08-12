// Resolução de proposição com o PORTAL como fonte primária (SitCamaraWS) e a
// API de reserva — o elo que faltava na emergência de 12/08/2026: nos REQs o
// enriquecimento morria na resolução do projeto-alvo, antes de o fallback de
// autoria poder agir. Fixture: XML real do WS (12/08/2026).
// Uso: node testes/resolve-portal.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'ws-pl2726-2022.xml'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

function montar({ ws, api }) {
  const partes = [
    "const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';",
    'const SIGLAS_EQUIVALENTES = { PDL: ["PDL", "PDC"], PDC: ["PDC", "PDL"] };',
    'const cacheProp = new Map();',
    'const fbCacheProposicaoGet = async () => null; const fbCacheProposicaoPut = () => {};',
    src.match(/async function resolverProposicaoDoPortal[\s\S]*?\n}/)[0],
    src.match(/async function resolveProposicao\(sigla, numero, ano\)[\s\S]*?\n}/)[0],
  ].join('\n');
  const fetchComTimeout = async url => {
    if (ws instanceof Error) throw ws;
    return { ok: ws !== null, status: ws === null ? 500 : 200, text: async () => ws };
  };
  const fetchJson = async url => {
    if (api instanceof Error) throw api;
    if (url.includes('?siglaTipo=')) return { dados: api ? [{ id: api.id, ementa: api.ementa }] : [] };
    return { dados: { ementa: api.ementa, urlInteiroTeor: null } };
  };
  return new Function('fetchComTimeout', 'fetchJson',
    'return (async()=>{' + partes + '; return resolveProposicao;})()')(fetchComTimeout, fetchJson);
}

(async () => {
  console.log('== portal primeiro, com o XML real ==');
  {
    const f = await montar({ ws: XML, api: new Error('HTTP 504') });
    const r = await f('PL', 2726, 2022);
    ok(r.id === 2336566, `id do XML do WS (${r.id})`);
    ok(/Convivência Sociocultural/.test(r.ementa), 'ementa veio junto');
    ok(r.urlInteiroTeor === 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=2212779',
       'teor normalizado para https + camara.leg.br');
  }
  console.log('\n== WS fora → API assume ==');
  {
    const f = await montar({ ws: new Error('timeout'), api: { id: 777, ementa: 'Pela API.' } });
    const r = await f('PL', 1, 2020);
    ok(r.id === 777, 'reserva pela API funcionou');
  }
  console.log('\n== os dois fora → erro claro ==');
  {
    const f = await montar({ ws: null, api: new Error('HTTP 504') });
    const err = await f('PL', 1, 2020).then(() => null, e => e.message);
    ok(/504/.test(err || ''), `erro sobe: ${err}`);
  }
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
