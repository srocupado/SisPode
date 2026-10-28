// Cópia dos dados do IBGE no Firebase (ibge-cache.js): confere e regrava só o que mudou;
// com o IBGE fora do ar, usa a cópia; sem cópia, devolve o erro do IBGE.
// Uso: node testes/ibge-cache.test.js
const path = require('path');
const { icChave, icHash, icJson, icReiniciar, IC_RAIZ, IC_PAUSA_MS } = require(path.join(__dirname, '..', 'ibge-cache.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Firebase de mentira: guarda o que se grava e responde às leituras
function fbFalso(inicial = {}) {
  const db = Object.assign({}, inicial), log = [];
  const f = async (url, op = {}) => {
    const m = url.match(/\/ibge_cache\/([^/]+?)(\/h)?\.json$/), k = m[1];
    log.push((op.method || 'GET') + ' ' + k + (m[2] ? '/h' : ''));
    if (op.method === 'PUT') { db[k] = JSON.parse(op.body); return { ok: true, json: async () => null }; }
    const v = db[k] ? (m[2] ? db[k].h : db[k]) : null;
    return { ok: true, json: async () => v };
  };
  return { f, db, log };
}
const URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/SP/municipios';
const MALHA = { type: 'Topology', objects: { x: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0]], properties: { codarea: '3550308' } }] } }, arcs: [[[0, 0], [1, 0], [0, 1]]], vazia: [] };

(async () => {
  console.log('Chave e carimbo');
  ok(icChave(URL) === 'v1_localidades_estados_SP_municipios', 'chave sem o servidor e sem caracteres proibidos no Firebase');
  ok(icChave('https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6%5BN3%5B35%5D%5D')
    === 'v3_agregados_4709_periodos_2022_variaveis_93_localidades_N6_N3_35', 'consulta decodificada e limpa (população da UF 35)');
  ok(icHash('abc') === icHash('abc') && icHash('abc') !== icHash('abd'), 'carimbo igual para o mesmo conteúdo e diferente se muda');
  ok(IC_RAIZ === '/ibge_cache', 'nó próprio no Firebase');

  console.log('IBGE no ar');
  let fb = fbFalso();
  let r = await icJson(URL, { ler: async () => MALHA, fetch: fb.f, base: 'http://fb', esperarCopia: true });
  ok(r.fonte === 'ibge' && r.dados === MALHA, 'devolve o que o IBGE mandou');
  ok(fb.log.join('|') === 'GET v1_localidades_estados_SP_municipios/h|PUT v1_localidades_estados_SP_municipios', 'sem cópia: confere o carimbo e grava');
  const g = fb.db.v1_localidades_estados_SP_municipios;
  ok(g.h === icHash(JSON.stringify(MALHA)) && g.url === URL && g.em > 0 && JSON.parse(g.d).vazia.length === 0, 'grava carimbo, endereço, data e o conteúdo em texto (lista vazia preservada)');
  fb.log.length = 0;
  await icJson(URL, { ler: async () => MALHA, fetch: fb.f, base: 'http://fb', esperarCopia: true });
  ok(fb.log.join('|') === 'GET v1_localidades_estados_SP_municipios/h', 'conteúdo igual: só confere, não regrava');
  fb.log.length = 0;
  await icJson(URL, { ler: async () => Object.assign({}, MALHA, { arcs: [[[0, 0], [2, 0]]] }), fetch: fb.f, base: 'http://fb', esperarCopia: true });
  ok(fb.log.join('|') === 'GET v1_localidades_estados_SP_municipios/h|PUT v1_localidades_estados_SP_municipios', 'conteúdo mudou: regrava');
  r = await icJson(URL, { ler: async () => MALHA, fetch: async () => { throw new Error('Firebase fora'); }, base: 'http://fb', esperarCopia: true });
  ok(r.fonte === 'ibge' && r.dados === MALHA, 'Firebase fora do ar não atrapalha a leitura do IBGE');

  console.log('IBGE fora do ar');
  fb = fbFalso({ v1_localidades_estados_SP_municipios: { h: 'x', d: JSON.stringify(MALHA), em: 1761000000000, url: URL } });
  r = await icJson(URL, { ler: async () => { throw new Error('HTTP 502'); }, fetch: fb.f, base: 'http://fb' });
  ok(r.fonte === 'copia' && r.em === 1761000000000 && JSON.stringify(r.dados) === JSON.stringify(MALHA), 'usa a cópia e diz de quando ela é');
  ok(!fb.log.some(l => l.startsWith('PUT')), 'com a cópia, nada é gravado');
  // depois da falha, as leituras seguintes vão direto à cópia, sem tentar o IBGE, até a pausa acabar
  let tentou = 0, t0 = Date.now();
  r = await icJson(URL, { ler: async () => { tentou++; return MALHA; }, fetch: fb.f, base: 'http://fb', agora: () => t0 + 1000 });
  ok(tentou === 0 && r.fonte === 'copia', 'logo depois de uma falha: vai direto à cópia (sem esperar novas tentativas do IBGE)');
  r = await icJson(URL, { ler: async () => { tentou++; return MALHA; }, fetch: fb.f, base: 'http://fb', agora: () => t0 + IC_PAUSA_MS + 1000 });
  ok(tentou === 1 && r.fonte === 'ibge', 'passada a pausa: tenta o IBGE de novo');
  icReiniciar();
  let erro = null;
  try { await icJson(URL, { ler: async () => { throw new Error('HTTP 502'); }, fetch: fbFalso().f, base: 'http://fb' }); } catch (e) { erro = e; }
  ok(erro && erro.message === 'HTTP 502', 'sem cópia: devolve o erro do IBGE');

  console.log(falhas ? `\n${falhas} teste(s) falharam` : '\nTodos os testes passaram');
  process.exit(falhas ? 1 : 0);
})();
