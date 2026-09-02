// Rede instável não pode virar espera silenciosa — e o agente não pode gastar
// o teto de consultas listando comissões uma a uma.
//
// Relato de 26/08/2026, duas perguntas do mesmo analista:
//   · "Qual quórum da sessão?" → "Não consegui interpretar (HTTP 503)" depois
//     de ~50 s. O provedor de IA estava sobrecarregado; a pergunta estava
//     perfeita e o /quorum responderia sem IA nenhuma.
//   · "Temos projetos do Podemos nas comissões amanhã?" → o agente listou as
//     11 comissões e foi consultar UMA A UMA, estourando MAX_CONSULTAS na
//     terceira. Resposta: "atingi o limite de consultas", com 9 comissões por
//     olhar — existindo uma ferramenta que faz tudo em uma chamada.
//
// O que este teste trava:
//   a) `fetch` SEM teto de tempo. O padrão do Node espera ~5 min por tentativa;
//      com 3-4 tentativas o analista via "digitando…" por até 20 minutos sem
//      receber nada — nem erro. Demora tem de virar falha DECLARADA.
//   b) a classificação do erro: 4xx é erro do PEDIDO e sobe na hora (repetir
//      não adianta e queima a cota do analista); 429/5xx/tempo esgotado são
//      instabilidade e repetem.
//   c) `varrer_comissoes` como ferramenta de DADO, não de AÇÃO.
//
// Uso: node testes/bot-comissoes-timeout.test.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Servidor de mentira: responde por rota e CONTA as requisições recebidas. */
function servidor() {
  const hits = { ok: 0, e4xx: 0, e5xx: 0, pendura: 0 };
  const srv = http.createServer((req, res) => {
    if (req.url.includes('e4xx')) {
      hits.e4xx++;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'API key not valid' } }));
    } else if (req.url.includes('e5xx')) {
      hits.e5xx++; res.writeHead(503); res.end('{}');
    } else if (req.url.includes('pendura')) {
      hits.pendura++;                      // aceita e NUNCA responde
    } else {
      hits.ok++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ dados: [{ id: 1 }], ok: 1 }));
    }
  });
  return { srv, hits };
}

/** Carrega um módulo do bot com os tempos encurtados, para o teste ser rápido. */
function carregarComTemposCurtos(arquivo, substituicoes, exporta) {
  let src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', arquivo), 'utf8');
  for (const [de, para] of substituicoes) {
    if (!de.test(src)) throw new Error(`padrão não encontrado em ${arquivo}: ${de}`);
    src = src.replace(de, para);
  }
  src = src.replace(/module\.exports = \{/, `module.exports = { ${exporta},`);
  const destino = path.join(require('os').tmpdir(), `sispode-${arquivo}`);
  fs.writeFileSync(destino, src);
  delete require.cache[destino];
  return require(destino);
}

(async () => {
  const { srv, hits } = servidor();
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  console.log('== API da Câmara: teto de tempo por requisição ==');
  {
    const M = carregarComTemposCurtos('comissoes.js', [
      [/const API = '[^']+'/, `const API = '${base}'`],
      [/const TIMEOUT_MS = \d+;/, 'const TIMEOUT_MS = 600;'],
    ], 'apiGet');

    const antes = { ...hits };
    const t = Date.now();
    let erro = null;
    try { await M.apiGet('/pendura'); } catch (e) { erro = e.message; }
    const seg = (Date.now() - t) / 1000;
    // Sem AbortController isto levaria ~5 min POR TENTATIVA (padrão do Node).
    ok(seg < 10, `conexão pendurada falha em ${seg.toFixed(1)}s, não em minutos`);
    ok(/tempo esgotado/.test(erro || ''), `o erro DIZ que foi tempo esgotado: ${erro}`);
    ok(hits.pendura - antes.pendura === 3, `repetiu as 3 tentativas (${hits.pendura - antes.pendura})`);
  }

  console.log('\n== API da Câmara: 4xx é erro do pedido, 5xx é instabilidade ==');
  {
    const M = carregarComTemposCurtos('comissoes.js', [
      [/const API = '[^']+'/, `const API = '${base}'`],
      [/const TIMEOUT_MS = \d+;/, 'const TIMEOUT_MS = 600;'],
    ], 'apiGet');

    const a = { ...hits };
    let e4 = null;
    try { await M.apiGet('/e4xx'); } catch (e) { e4 = e.message; }
    ok(hits.e4xx - a.e4xx === 1, `4xx NÃO repete — 1 requisição (${hits.e4xx - a.e4xx})`);
    ok(/HTTP 400/.test(e4 || ''), `e sobe com o status: ${e4}`);

    const b = { ...hits };
    let e5 = null;
    try { await M.apiGet('/e5xx'); } catch (e) { e5 = e.message; }
    ok(hits.e5xx - b.e5xx === 3, `5xx repete as 3 tentativas (${hits.e5xx - b.e5xx})`);
    ok(/instável/.test(e5 || ''), `e a mensagem declara instabilidade: ${e5}`);

    const c = { ...hits };
    const d = await M.apiGet('/ok');
    ok(Array.isArray(d) && d.length === 1, 'o caminho feliz continua devolvendo os dados');
    ok(hits.ok - c.ok === 1, 'sem requisição sobrando no sucesso');
  }

  console.log('\n== provedor de IA: teto de tempo e classificação do erro ==');
  {
    const M = carregarComTemposCurtos('ia.js', [
      [/const TIMEOUT_IA_MS = \d+;/, 'const TIMEOUT_IA_MS = 600;'],
      [/const delays = \[0, 5000, 15000, 30000\];/, 'const delays = [0, 100, 200, 300];'],
    ], 'fetchIA');

    const a = { ...hits };
    const t = Date.now();
    let erro = null;
    try { await M.fetchIA(`${base}/pendura`, { method: 'POST' }); } catch (e) { erro = e.message; }
    ok((Date.now() - t) / 1000 < 10, 'provedor pendurado não segura o bot por minutos');
    ok(/não respondeu em/.test(erro || ''), `o erro nomeia o tempo esgotado: ${erro}`);
    ok(hits.pendura - a.pendura === 4, `repetiu as 4 tentativas (${hits.pendura - a.pendura})`);

    // Chave inválida é 400: repetir 4× não conserta e ainda demora — sobe já,
    // com a mensagem do provedor, que é o que o analista precisa ler.
    const b = { ...hits };
    let e4 = null;
    try { await M.fetchIA(`${base}/e4xx`, { method: 'POST' }); } catch (e) { e4 = e.message; }
    ok(hits.e4xx - b.e4xx === 1, `4xx do provedor NÃO repete (${hits.e4xx - b.e4xx} requisição)`);
    ok(e4 === 'API key not valid', `e entrega a mensagem do provedor, não "HTTP 400": ${e4}`);

    // 503 do Gemini ("model is overloaded") — o caso do relato.
    const c = { ...hits };
    let e5 = null;
    try { await M.fetchIA(`${base}/e5xx`, { method: 'POST' }); } catch (e) { e5 = e.message; }
    ok(hits.e5xx - c.e5xx === 4, `sobrecarga do provedor repete (${hits.e5xx - c.e5xx} tentativas)`);
    ok(/HTTP 503/.test(e5 || ''), `e o erro final preserva o status: ${e5}`);
  }

  console.log('\n== varredura de comissões é ferramenta de DADO, não de AÇÃO ==');
  {
    const src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'agente.js'), 'utf8');
    const catDados = src.match(/const CATALOGO_DADOS = `([\s\S]*?)`;/)[1];
    const catAcoes = src.match(/const CATALOGO_ACOES = `([\s\S]*?)`;/)[1];
    const acoes    = src.match(/const ACOES = \[([\s\S]*?)\];/)[1];

    ok(/"varrer_comissoes"/.test(catDados), 'está no catálogo de DADOS');
    ok(!/"varrer_comissoes"/.test(catAcoes), 'saiu do catálogo de AÇÕES');
    ok(!/varrer_comissoes/.test(acoes),
       'saiu da lista ACOES — como AÇÃO ela encerrava a vez do agente');
    // Sem esta instrução o modelo refaz o caminho de 11 chamadas: a regra
    // "prefira responder você mesmo a despachar ação" empurra para lá.
    ok(/uma a uma/.test(catDados), 'o catálogo proíbe consultar comissão por comissão');
    ok(/Para o conjunto do dia, use "varrer_comissoes"/.test(catDados),
       'pauta_comissao redireciona para a varredura');

    const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
    const reg = idx.match(/function ferramentasDado[\s\S]*?\n  \};/)[0];
    ok(/varrer_comissoes:/.test(reg), 'index.js registra a ferramenta de dado');
    ok(/varrerComissoesPartido/.test(reg), 'que chama varrerComissoesPartido');
    ok(/'Podemos'/.test(reg), 'sem partido explícito, procura o Podemos (é o bot da bancada)');
    // O comando manual não pode ter sido quebrado pela mudança.
    ok(/bot\.command\('varrercomissoes'/.test(idx), '/varrercomissoes continua existindo');
  }

  srv.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
