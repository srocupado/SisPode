// Testes da resiliência de fonte (branch fonte-site-camara-plenario):
//   A) fetchApiCamara — teto + repetição em 429/5xx, 4xx falha na hora
//   B) cache compartilhado /proposicoes-cache (id/ementa imutáveis)
//   C) tramitações pela FICHA do portal quando a API falha — com o contrato
//      honesto: a ficha CONFIRMA urgência/relatoria, nunca prova ausência.
//
// O parser da ficha roda contra HTML REAL gravado em testes/fixtures/ (capturado
// em 12/08/2026), e as regras fixas (situacaoDe/relatoriaDe) têm de produzir os
// MESMOS resultados que produziam com as tramitações da API.
//
// Uso: node testes/fonte-site.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { DOMParser } = require(path.join(__dirname, '..', 'bot', 'node_modules', 'linkedom'));

const fonteLideres = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
const FICHA_PLP230 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ficha-plp230-2580259.html'), 'utf8');
const FICHA_PL1828 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ficha-pl1828-2355883.html'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Sandbox do lideres.js com fetch ROTEÁVEL por teste.
function montarSandbox(rotear) {
  const sandbox = {
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
    pdfjsLib: { GlobalWorkerOptions: {} },
    window: {}, DOMParser,
    fetch: rotear,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    console: { ...console, warn() {}, debug() {} },
    setTimeout, clearTimeout,
    AbortController, DOMException: globalThis.DOMException,
    XLSX: undefined,
  };
  const exportar = ['fetchApiCamara', 'tramitacoesDaFicha', 'obterTramitacoes',
                    'situacaoComFonte', 'relatoriaComFonte', 'situacaoDe', 'relatoriaDe',
                    'fatosDaDemanda', 'refDemanda', 'fbCacheProposicaoGet'];
  const fn = new Function(...Object.keys(sandbox), `${fonteLideres}\n; return { ${exportar.join(', ')} };`);
  return fn(...Object.values(sandbox));
}

const R200 = (corpo, tipo = 'application/json') => ({
  ok: true, status: 200,
  json: async () => typeof corpo === 'string' ? JSON.parse(corpo) : corpo,
  text: async () => typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
});
const R = status => ({ ok: false, status, json: async () => ({}), text: async () => 'x' });

(async () => {
  // ================= C) parser da ficha + regras fixas =================
  console.log('== C) ficha do portal alimenta as MESMAS regras fixas ==');
  {
    const L = montarSandbox(async url => {
      url = String(url);
      if (url.includes('fichadetramitacao?idProposicao=2580259')) return R200(FICHA_PLP230, 'text/html');
      if (url.includes('fichadetramitacao?idProposicao=2355883')) return R200(FICHA_PL1828, 'text/html');
      return R(504);
    });
    const trams = await L.tramitacoesDaFicha(2580259);
    ok(trams && trams.length >= 6, `PLP 230: ${trams?.length} tramitações extraídas da ficha real`);
    ok(L.situacaoDe(trams, '') === 'Urgência aprovada (REQ. 2708/2026)',
       `situação IGUAL à da API: ${L.situacaoDe(trams, '')}`);
    const rel = await L.relatoriaDe(trams, undefined);
    ok(rel === 'Dep. Maria Rosas (REPUBLIC-SP)', `relatoria pela ficha: ${rel}`);

    const trams1828 = await L.tramitacoesDaFicha(2355883);
    ok(trams1828 && trams1828.length >= 30, `PL 1828: ${trams1828?.length} tramitações na janela de ~1 ano da ficha`);
    const rel1828 = await L.relatoriaDe(trams1828, undefined);
    ok(/Isnaldo Bulh/i.test(rel1828), `pega a designação MAIS RECENTE de PLEN: ${rel1828}`);
  }

  // ================= C) contrato honesto da janela =================
  console.log('\n== C) a ficha confirma, nunca prova ausência ==');
  {
    const L = montarSandbox(async () => R(504));
    ok(/fonte: portal da Câmara$/.test(L.situacaoComFonte(
        [{ despacho: 'Aprovado o requerimento nº 2708/2026, que solicita urgência (art. 155) para o PLP.', descricaoTramitacao: '', siglaOrgao: 'PLEN' }], '', 'portal')),
       'achado POSITIVO pela ficha sai etiquetado com a fonte');
    ok(/Não foi possível confirmar/.test(L.situacaoComFonte([{ despacho: 'Prazo de emendas.', descricaoTramitacao: '', siglaOrgao: 'MESA' }], '', 'portal')),
       'janela sem urgência → "não foi possível confirmar", NUNCA "não há requerimento"');
    ok(L.situacaoComFonte([], '') === 'Não há requerimento de urgência apresentado.',
       'pela API, lista vazia continua sendo a afirmação normal');
    const relVazia = await L.relatoriaComFonte([], undefined, 'portal');
    ok(relVazia === 'Não verificada — API da Câmara instável no momento',
       'relatoria ausente na janela → não verificada');
  }

  // ================= A + C juntos: API caiu, portal salva =================
  console.log('\n== A+C) fatosDaDemanda com API de tramitações FORA e ficha de pé ==');
  {
    let chamadasTramitacoes = 0;
    const L = montarSandbox(async url => {
      url = String(url);
      if (url.includes('firebaseio.com')) return R200('null');           // cache vazio
      if (url.includes('/tramitacoes')) { chamadasTramitacoes++; return R(504); }
      if (url.includes('fichadetramitacao?idProposicao=2580259')) return R200(FICHA_PLP230);
      if (url.includes('proposicoes?siglaTipo=PLP&numero=230')) return R200({ dados: [{ id: 2580259 }] });
      if (/proposicoes\/2580259$/.test(url)) return R200({ dados: { ementa: 'Altera a LC 101…', statusProposicao: { descricaoSituacao: 'Pronta para a Pauta' } } });
      if (url.includes('/autores')) return R200({ dados: [{ nome: 'Juscelino Filho', uri: '' }] });
      return R200({ dados: [] });
    });
    const fatos = await L.fatosDaDemanda(L.refDemanda('PLP 230/2025'));
    ok(chamadasTramitacoes === 4, `tramitações tentadas 4x com backoff antes do fallback (${chamadasTramitacoes})`);
    ok(fatos.situacao === 'Urgência aprovada (REQ. 2708/2026) — fonte: portal da Câmara',
       `situação veio da FICHA, etiquetada: ${fatos.situacao}`);
    ok(fatos.idCamara === 2580259 && /Altera a LC/.test(fatos.ementa), 'id e ementa pela API normal');
  }

  // ================= B) cache compartilhado =================
  console.log('\n== B) cache /proposicoes-cache ==');
  {
    let listaChamada = 0; const puts = [];
    const L = montarSandbox(async (url, init) => {
      url = String(url);
      if (url.includes('/proposicoes-cache/PLP-230-2025.json')) {
        if ((init || {}).method === 'PUT') { puts.push(init.body); return R200('{}'); }
        return R200({ idCamara: 2580259, ementa: 'Ementa do cache.', urlInteiroTeor: null });
      }
      if (url.includes('proposicoes?siglaTipo=')) { listaChamada++; return R200({ dados: [{ id: 2580259 }] }); }
      if (/proposicoes\/2580259$/.test(url)) return R200({ dados: { ementa: 'Ementa fresca.', statusProposicao: {} } });
      if (url.includes('/tramitacoes')) return R200({ dados: [] });
      if (url.includes('/autores')) return R200({ dados: [] });
      return R200({ dados: [] });
    });
    const fatos = await L.fatosDaDemanda(L.refDemanda('PLP 230/2025'));
    ok(listaChamada === 0, 'com cache, o endpoint de LISTA nem é chamado');
    ok(fatos.idCamara === 2580259, 'id veio do cache compartilhado');
    ok(puts.length === 1 && /Ementa fresca/.test(puts[0]), 'detalhe fresco regrava o cache para a equipe');
  }

  // ================= A) política de repetição (servidor real) =================
  console.log('\n== A) fetchApiCamara contra servidor que oscila ==');
  await new Promise(done => {
    let n = 0, modo = '504x2';
    const srv = http.createServer((rq, rs) => {
      n++;
      if (modo === '504x2' && n <= 2) { rs.writeHead(504); return rs.end('x'); }
      if (modo === '404') { rs.writeHead(404); return rs.end('x'); }
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{"dados":[]}');
    });
    srv.listen(0, async () => {
      const L = montarSandbox(globalThis.fetch);
      const u = 'http://127.0.0.1:' + srv.address().port + '/x';
      const r = await L.fetchApiCamara(u);
      ok(r.ok && n === 3, `dois 504 e recupera na 3ª (${n} chamadas)`);
      modo = '404'; n = 0;
      const r2 = await L.fetchApiCamara(u);
      ok(r2.status === 404 && n === 1, '404 volta na hora, sem repetir');
      srv.close(); done();
    });
  });

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
