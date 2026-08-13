// Limite de taxa do portal na varredura de oradores (HTTP 429, 13/08/2026).
// A varredura da sessão cheia dispara ~30 GETs por minuto; o portal fechava a
// porta e o log repetia "HTTP 429 na página de oradores" a cada minuto,
// enquanto a insistência renovava o castigo.
//
// Contrato: 429 pausa TODAS as consultas ao portal (respeitando Retry-After),
// as requisições saem espaçadas em vez de em rajada, e quem pediu /oradores
// recebe o último quadro com a ressalva — nunca um erro cru.
//
// Uso: node testes/oradores-taxa.test.js
const path = require('path');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const CAMINHO = path.join(__dirname, '..', 'bot', 'src', 'oradores.js');
// Cada cenário precisa do módulo com o estado zerado (a pausa é de processo).
function carregar(rotear) {
  delete require.cache[require.resolve(CAMINHO)];
  global.fetch = rotear;
  return require(CAMINHO);
}

const resposta = (status, corpo = '', headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: h => headers[h.toLowerCase()] ?? null },
  text: async () => corpo,
});

const HTML_CATALOGO = '<select><option value="Breves Comunicações;123;BC">x</option></select>' +
  'Breves Comunicações da Sessão 150 de 13/08/2026';

(async () => {
  console.log('== 429 pausa as consultas em vez de insistir ==');
  {
    let chamadas = 0;
    const O = carregar(async () => { chamadas++; return resposta(429); });
    await O.listasDeOradores(1).then(() => null, () => null);
    ok(chamadas === 1, `a 1ª tentativa vai à rede (${chamadas})`);
    ok(O.esperaPorTaxa() > 240, `pausa de ~5 min registrada (${O.esperaPorTaxa()}s)`);

    const err = await O.listasDeOradores(1).then(() => null, e => e.message);
    ok(chamadas === 1, 'a 2ª nem toca a rede enquanto a pausa vale');
    ok(/limite de taxa/.test(err || ''), `motivo explícito: ${err}`);
  }

  console.log('\n== Retry-After do portal é respeitado ==');
  {
    const O = carregar(async () => resposta(429, '', { 'retry-after': '90' }));
    await O.listasDeOradores(1).catch(() => {});
    const e = O.esperaPorTaxa();
    ok(e > 80 && e <= 90, `espera segue o Retry-After (${e}s), não o padrão de 300s`);
  }

  console.log('\n== requisições saem espaçadas, não em rajada ==');
  {
    const marcas = [];
    const O = carregar(async () => { marcas.push(Date.now()); return resposta(200, HTML_CATALOGO); });
    await O.listasDeOradores(1);
    await O.oradoresDaLista(1, { idLista: '123', tipo: 'BC' });
    const gap = marcas[1] - marcas[0];
    ok(gap >= 380, `respiro entre GETs consecutivos: ${gap}ms`);
  }

  console.log('\n== catálogo cacheado corta uma requisição por varredura ==');
  {
    let chamadas = 0;
    const O = carregar(async () => { chamadas++; return resposta(200, HTML_CATALOGO); });
    await O.listasDeOradores(7);
    const segundo = await O.listasDeOradores(7);
    ok(chamadas === 1, `2ª leitura do catálogo vem do cache (${chamadas} requisição)`);
    ok(segundo.listas.length === 1 && segundo.listas[0].idLista === '123', 'dados do cache são os mesmos');
  }

  console.log('\n== /oradores durante a pausa: quadro anterior + ressalva ==');
  {
    let modo = 200;
    const O = carregar(async () => modo === 200
      ? resposta(200, HTML_CATALOGO + '<tr class="g-table__row"><td data-th="Orador"><a href="/deputados/1">Dep. Fulano</a></td><td data-th="Partido">PODE</td><td data-th="UF">SP</td><td data-th="Situação">falou</td></tr>')
      : resposta(429));
    const bom = await O.resumoOradores(9);
    ok(/Fulano/.test(bom), 'quadro normal quando o portal responde');

    modo = 429;
    await O.listasDeOradores(9, { cache: false }).catch(() => {});   // dispara a pausa
    // Espera o cache de 60s expirar não é necessário: o texto guardado é servido
    // com a ressalva assim que a pausa está valendo.
    const durante = await O.resumoOradores(9);
    ok(/Fulano/.test(durante), 'o pedido do usuário ainda recebe conteúdo (o último quadro)');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
