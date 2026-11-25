// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Captura das fontes da busca na web, em ia-comum.js.
//
// Quando `web` está ligado, o modelo sai do material que a gente deu e traz
// texto de estranho da internet. Num documento de conferência isso só se
// sustenta se der para conferir — e até hoje `chamarIA` devolvia só o texto,
// sem dizer de onde veio nem o que foi procurado.
//
// A parte menos óbvia é a CONSULTA. Procurar "PL 3626 críticas" devolve
// crítica; "PL 3626 benefícios" devolve o oposto. Quem escreve a consulta
// escreve a conclusão, então ela precisa sair junto do texto.
//
// Os três provedores devolvem isso em formatos diferentes, e cada um em dois
// caminhos (direto e streaming). São seis pontos de retorno, e este teste passa
// pelos seis com a forma REAL de cada resposta.
//
// Uso: node testes/ia-fontes.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// ---------- contexto ----------
const respostas = [];          // o que o fetch de mentira devolve, em ordem
const pedidos = [];            // o que foi enviado, para conferir os tools
const ctx = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout, clearTimeout, AbortController, TextDecoder, TextEncoder, URL, btoa,
  document: { getElementById: () => null, querySelector: () => null,
              createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }),
              body: { appendChild() {} } },
  fetch: async (url, init) => {
    pedidos.push({ url: String(url), body: JSON.parse(init.body) });
    const r = respostas.shift();
    // recusa do provedor (HTTP 4xx), para o recuo da leitura de páginas
    if (r.status) return { ok: false, status: r.status, json: async () => ({ error: { message: r.erro || `HTTP ${r.status}` } }), text: async () => r.erro || '' };
    if (r.sse) {
      // `comEvento` reproduz a linha "event:" que a OpenAI manda antes do dado;
      // sem ela, o nome do evento só existe dentro do próprio JSON.
      const bloco = o => (r.comEvento && o.type ? `event: ${o.type}\n` : '') + 'data: ' + JSON.stringify(o);
      return { ok: true, status: 200, text: async () => r.sse.map(bloco).join('\n\n') + '\n\n' };
    }
    return { ok: true, status: 200, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  },
};
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8'), ctx);
const chamar = (fn, ...a) => vm.runInContext(fn, ctx)(...a);
const ia = args => vm.runInContext('chamarIA', ctx)(args);

(async () => {
  console.log('== normalização de uma fonte ==');
  {
    const f = chamar('iaFonte', 'https://www1.folha.uol.com.br/poder/materia.shtml',
                     { titulo: '  Câmara   aprova  regulamentação ', data: '3 days ago', trecho: 'um trecho citado' });
    ok(f.veiculo === 'folha.uol.com.br', `o veículo sai do domínio, sem www (${f.veiculo})`);
    ok(f.titulo === 'Câmara aprova regulamentação', 'o título vem com os espaços normalizados');
    ok(f.data === '3 days ago', 'a data vem como o provedor informou');
    ok(chamar('iaFonte', 'não é url') === null, 'sem URL não é fonte — vira null, não entra na lista');
    ok(chamar('iaFonte', 'ftp://x/y') === null, 'e esquema que não é http(s) também não');
    ok(chamar('iaFonte', 'https://x/y').data === null,
       'o que o provedor não informou fica NULO — data que não veio não se inventa');
  }

  console.log('\n== o redirecionador do Gemini ==');
  {
    // Medido em 21/09/2026: o Gemini nunca manda a URL do artigo. Manda um
    // redirecionador e põe o DOMÍNIO no campo `title`. Sem tratar, toda fonte
    // de toda consulta sairia como sendo do veículo "cloud.google.com".
    const redir = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG2a0hu';
    const f = chamar('iaFonte', redir, { titulo: 'www25.senado.leg.br' });
    ok(f.veiculo === 'senado.leg.br', `o veículo sai do "título", que é o domínio (${f.veiculo})`);
    ok(f.titulo === null, 'e o campo título fica nulo — domínio não é título de matéria');
    ok(f.url === redir, 'a URL segue sendo a do redirecionador: é a única que temos, e ela abre');
    const semTitulo = chamar('iaFonte', redir);
    ok(semTitulo.veiculo === null,
       'sem título, o veículo fica nulo em vez de virar "vertexaisearch.cloud.google.com"');
    const normal = chamar('iaFonte', 'https://g1.globo.com/a', { titulo: 'Câmara aprova o texto' });
    ok(normal.titulo === 'Câmara aprova o texto' && normal.veiculo === 'g1.globo.com',
       'e um título de verdade continua sendo título');
  }

  console.log('\n== a mesma URL em blocos diferentes se completa, não se duplica ==');
  {
    const acc = [];
    chamar('iaJuntarFontes', acc, [chamar('iaFonte', 'https://g1.globo.com/a', { titulo: 'Título' })]);
    chamar('iaJuntarFontes', acc, [chamar('iaFonte', 'https://g1.globo.com/a', { trecho: 'o trecho citado no texto' })]);
    ok(acc.length === 1, 'a URL repetida não entra duas vezes');
    ok(acc[0].titulo === 'Título' && acc[0].trecho === 'o trecho citado no texto',
       'e o segundo bloco COMPLETA o que faltava — o provedor manda em pedaços');
  }

  console.log('\n== Gemini ==');
  {
    // groundingMetadata, como o Gemini devolve com google_search.
    const gm = {
      webSearchQueries: ['PL 3626 2023 bets críticas', 'PL 3626 2023 bets críticas'],
      groundingChunks: [
        { web: { uri: 'https://g1.globo.com/politica/noticia/bets.ghtml', title: 'Câmara aprova bets' } },
        { web: { uri: 'https://www.estadao.com.br/politica/bets/', title: 'O que muda' } },
        { web: {} },                                    // sem uri: tem de sumir
      ],
    };
    respostas.push({ json: { candidates: [{ content: { parts: [{ text: 'resposta com base na web' }] },
                                            groundingMetadata: gm, finishReason: 'STOP' }] } });
    const r = await ia({ provedorId: 'gemini', apiKey: 'k', prompt: 'p', web: true });
    ok(pedidos.at(-1).body.tools[0].google_search !== undefined, 'a busca é pedida ao provedor');
    ok(r.fontes.length === 2, `as duas fontes com URL entram, a vazia não (${r.fontes.length})`);
    ok(r.fontes[0].veiculo === 'g1.globo.com', 'com o veículo identificado');
    ok(r.buscas.length === 1 && /críticas/.test(r.buscas[0]),
       'e a consulta usada sai junto, sem repetir — é ela que decide a resposta');
  }
  {
    // Streaming: o grounding chega espalhado nos eventos.
    respostas.push({ sse: [
      { candidates: [{ content: { parts: [{ text: 'parte 1 ' }] },
                       groundingMetadata: { webSearchQueries: ['consulta A'],
                                            groundingChunks: [{ web: { uri: 'https://a.com/1', title: 'A' } }] } }] },
      { candidates: [{ content: { parts: [{ text: 'parte 2' }] },
                       groundingMetadata: { webSearchQueries: ['consulta B'],
                                            groundingChunks: [{ web: { uri: 'https://b.com/2', title: 'B' } }] },
                       finishReason: 'STOP' }] },
    ] });
    const r = await ia({ provedorId: 'gemini', apiKey: 'k', prompt: 'p', web: true, opcoes: { pensar: 'alto' } });
    ok(r.text === 'parte 1 parte 2', 'o texto é juntado dos eventos');
    ok(r.fontes.length === 2 && r.buscas.length === 2,
       `e as fontes e consultas se acumulam ao longo do stream (${r.fontes.length}/${r.buscas.length})`);
  }

  console.log('\n== OpenAI ==');
  {
    const output = [
      { type: 'web_search_call', action: { query: 'PL 3626 repercussão' } },
      { type: 'message', content: [{ type: 'output_text', text: 'texto final',
          annotations: [
            { type: 'url_citation', url: 'https://oglobo.globo.com/x', title: 'O Globo sobre bets' },
            { type: 'url_citation', url: 'https://oglobo.globo.com/x', title: 'repetida' },
          ] }] },
    ];
    respostas.push({ json: { output, status: 'completed' } });
    const r = await ia({ provedorId: 'openai', apiKey: 'k', prompt: 'p', web: true });
    ok(r.fontes.length === 1 && r.fontes[0].veiculo === 'oglobo.globo.com',
       'a citação vira fonte, e a repetida não duplica');
    ok(r.buscas[0] === 'PL 3626 repercussão', 'a consulta sai do web_search_call');
  }
  {
    // Streaming: o objeto final da Responses API traz o output inteiro. Os mesmos
    // eventos são lidos duas vezes — com a linha "event:", como a OpenAI manda, e
    // sem ela. O nome do evento se repete dentro do dado, então perder a linha
    // "event:" no caminho não pode custar o texto nem as fontes.
    const eventos = [
      { type: 'response.output_text.delta', delta: 'texto ' },
      { type: 'response.output_text.delta', delta: 'do stream' },
      { type: 'response.completed', response: { status: 'completed', output: [
        { type: 'web_search_call', action: { query: 'consulta do stream' } },
        { type: 'message', content: [{ type: 'output_text', text: 'x',
            annotations: [{ type: 'url_citation', url: 'https://valor.globo.com/y', title: 'Valor' }] }] },
      ] } },
    ];
    for (const comEvento of [true, false]) {
      const como = comEvento ? 'com a linha "event:"' : 'só com o "type" dentro do dado';
      respostas.push({ sse: eventos, comEvento });
      const r = await ia({ provedorId: 'openai', apiKey: 'k', prompt: 'p', web: true, opcoes: { pensar: 'alto' } })
        .catch(e => ({ erro: e.message }));
      ok(r.text === 'texto do stream', `o texto é juntado dos deltas, ${como} (${r.erro || r.text})`);
      ok(r.fontes?.length === 1 && r.fontes[0].veiculo === 'valor.globo.com',
         `as fontes saem do objeto final, que carrega o output inteiro — ${como}`);
      ok(r.buscas?.[0] === 'consulta do stream', `e a consulta também — ${como}`);
    }
  }

  console.log('\n== Anthropic ==');
  {
    const content = [
      { type: 'server_tool_use', name: 'web_search', input: { query: 'bets regulamentação críticas' } },
      { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', url: 'https://folha.uol.com.br/a', title: 'Folha', page_age: 'March 12, 2026' },
        { type: 'web_search_result', url: 'https://cnnbrasil.com.br/b', title: 'CNN' },
      ] },
      { type: 'text', text: 'a resposta',
        citations: [{ type: 'web_search_result_location', url: 'https://folha.uol.com.br/a',
                      title: 'Folha', cited_text: 'o trecho exato que foi citado' }] },
    ];
    respostas.push({ json: { content, stop_reason: 'end_turn' } });
    const r = await ia({ provedorId: 'anthropic', apiKey: 'k', prompt: 'p', web: true });
    ok(r.fontes.length === 2, `os dois resultados entram (${r.fontes.length})`);
    const folha = r.fontes.find(f => f.veiculo === 'folha.uol.com.br');
    ok(folha.data === 'March 12, 2026', 'a Anthropic informa a idade da página, e ela é guardada');
    ok(folha.trecho === 'o trecho exato que foi citado',
       'e a citação COMPLETA a mesma fonte com o trecho — resultado e citação vêm em blocos diferentes');
    ok(r.buscas[0] === 'bets regulamentação críticas', 'a consulta sai do server_tool_use');
  }
  {
    // Streaming: os blocos de busca chegam em content_block_start; os deltas
    // de texto NÃO os carregam.
    respostas.push({ sse: [
      { type: 'content_block_start', content_block: { type: 'server_tool_use', input: { query: 'consulta no stream' } } },
      { type: 'content_block_start', content_block: { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', url: 'https://poder360.com.br/z', title: 'Poder360' } ] } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'texto do stream' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ] });
    const r = await ia({ provedorId: 'anthropic', apiKey: 'k', prompt: 'p', web: true, opcoes: { pensar: 'alto' } });
    ok(r.text === 'texto do stream', 'o texto sai dos deltas');
    ok(r.fontes.length === 1 && r.fontes[0].veiculo === 'poder360.com.br',
       'e a fonte sai do content_block_start, que é onde ela chega no streaming');
    ok(r.buscas[0] === 'consulta no stream', 'a consulta também');
  }

  console.log('\n== sem web, os campos existem e estão vazios ==');
  {
    respostas.push({ json: { candidates: [{ content: { parts: [{ text: 'sem busca' }] }, finishReason: 'STOP' }] } });
    const r = await ia({ provedorId: 'gemini', apiKey: 'k', prompt: 'p' });
    ok(Array.isArray(r.fontes) && r.fontes.length === 0, 'fontes é lista vazia, não ausente');
    ok(Array.isArray(r.buscas) && r.buscas.length === 0, 'buscas também');
    ok(pedidos.at(-1).body.tools === undefined, 'e nenhuma ferramenta de busca é pedida ao provedor');
  }

  // Leitura de páginas (25/11/2026): com `lerPaginas`, o modelo abre e lê a página além de buscar. Cada provedor
  // tem a ferramenta dele; se o provedor recusar o pedido, a chamada é refeita sem ela e o recuo fica em `avisos`.
  console.log('\n== leitura de páginas: Anthropic ==');
  {
    const content = [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'ADI 4874 acórdão' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://portal.stf.jus.br/a', title: 'STF' }] },
      { type: 'server_tool_use', id: 's2', name: 'web_fetch', input: { url: 'https://portal.stf.jus.br/a' } },
      { type: 'web_fetch_tool_result', tool_use_id: 's2', content: { type: 'web_fetch_result', url: 'https://portal.stf.jus.br/a', retrieved_at: '2026-11-25T12:00:00Z', content: { type: 'document', title: 'ADI 4.874 — acórdão', source: { type: 'text', data: '…' } } } },
      { type: 'server_tool_use', id: 's3', name: 'web_fetch', input: { url: 'https://fora.do.ar/x' } },
      { type: 'web_fetch_tool_result', tool_use_id: 's3', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } },
      { type: 'text', text: 'a resposta' },
    ];
    respostas.push({ json: { content, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } });
    const r = await ia({ provedorId: 'anthropic', apiKey: 'k', modelo: 'claude-sonnet-5-5', prompt: 'p', web: true, opcoes: { lerPaginas: true, maxBuscas: 12 } });
    const t = pedidos.at(-1).body.tools;
    ok(t.length === 2 && t[0].name === 'web_search' && t[0].max_uses === 12 && t[1].type === 'web_fetch_20260209' && t[1].name === 'web_fetch' && t[1].max_uses === 12 && t[1].max_content_tokens === 30000, 'o pedido leva a busca e a leitura de páginas, doze de cada, com teto de tamanho por página');
    ok(r.paginas.join() === 'https://portal.stf.jus.br/a' && r.fontes.find(f => f.url === 'https://portal.stf.jus.br/a').titulo === 'STF' && r.avisos.length === 0, 'a página lida fica em `paginas` e nas fontes; a que deu erro de leitura não conta');
    respostas.push({ json: { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' } });
    await ia({ provedorId: 'anthropic', apiKey: 'k', modelo: 'claude-haiku-4-5', prompt: 'p', web: true, opcoes: { lerPaginas: true } });
    ok(pedidos.at(-1).body.tools[1].type === 'web_fetch_20250910' && pedidos.at(-1).body.tools[0].type === 'web_search_20250305' && pedidos.at(-1).body.tools[0].max_uses === 5, 'modelo anterior ao 4.6 recebe a versão básica das duas ferramentas');
    respostas.push({ json: { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' } });
    const semLer = await ia({ provedorId: 'anthropic', apiKey: 'k', modelo: 'claude-sonnet-5-5', prompt: 'p', web: true });
    ok(pedidos.at(-1).body.tools.length === 1 && pedidos.at(-1).body.tools[0].max_uses === 5 && semLer.paginas.length === 0, 'sem `lerPaginas` nada muda: só a busca, com cinco consultas');
    // recuo: a API recusa a ferramenta nova, depois a básica; a chamada sai só com a busca e avisa
    const n0 = pedidos.length;
    respostas.push({ status: 400, erro: 'tools.1: unknown tool type' }, { status: 400, erro: 'web_fetch not enabled' }, { json: { content: [{ type: 'text', text: 'só busca' }], stop_reason: 'end_turn' } });
    const rec = await ia({ provedorId: 'anthropic', apiKey: 'k', modelo: 'claude-sonnet-5-5', prompt: 'p', web: true, opcoes: { lerPaginas: true, maxBuscas: 30 } });
    const tipos = pedidos.slice(n0).map(p => p.body.tools.map(x => x.type).join('+'));
    ok(tipos.join(' | ') === 'web_search_20260209+web_fetch_20260209 | web_search_20260209+web_fetch_20250910 | web_search_20260209' && rec.text === 'só busca', 'recusada a leitura nova, tenta a básica; recusada de novo, vai só com a busca');
    ok(rec.avisos.length === 1 && /O provedor recusou a leitura de páginas \(web_fetch not enabled\); a pesquisa foi feita só com a busca\./.test(rec.avisos[0]), 'e o recuo fica dito em `avisos`, uma vez');
    respostas.push({ status: 401, erro: 'invalid x-api-key' });
    let erro = null; try { await ia({ provedorId: 'anthropic', apiKey: 'k', modelo: 'claude-sonnet-5-5', prompt: 'p', web: true, opcoes: { lerPaginas: true } }); } catch (e) { erro = e; }
    ok(erro && /invalid x-api-key/.test(erro.message) && erro.status === 401 && respostas.length === 0, 'erro que não é recusa do pedido (chave inválida) não é repetido');
  }
  {
    // Turno pausado: com muitas buscas e leituras o servidor para com "pause_turn"; a resposta volta como veio,
    // remontada dos eventos do streaming, e o servidor continua.
    const n0 = pedidos.length;
    respostas.push({ sse: [
      { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'vou procurar' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'ASSINATURA' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"query": "DMA ' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'revisão 2026"}' } },
      { type: 'content_block_start', index: 3, content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://ec.europa.eu/dma', title: 'DMA', encrypted_content: 'abc' }] } },
      { type: 'content_block_start', index: 4, content_block: { type: 'text', text: '', citations: [] } },
      { type: 'content_block_delta', index: 4, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://ec.europa.eu/dma', title: 'DMA', cited_text: 'trecho', encrypted_index: 'i1' } } },
      { type: 'content_block_delta', index: 4, delta: { type: 'text_delta', text: '{"jurisdicoes":[' } },
      { type: 'content_block_start', index: 5, content_block: { type: 'server_tool_use', id: 's2', name: 'web_fetch', input: {} } },
      { type: 'content_block_delta', index: 5, delta: { type: 'input_json_delta', partial_json: '{"url":"https://ec.europa.eu/dma"}' } },
      { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 40 } },
    ] }, { sse: [
      { type: 'message_start', message: { usage: { input_tokens: 300, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'web_fetch_tool_result', tool_use_id: 's2', content: { type: 'web_fetch_result', url: 'https://ec.europa.eu/dma', content: { type: 'document', title: 'Digital Markets Act' } } } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"lugar":"UE"}]}' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 60 } },
    ] });
    const r = await ia({ provedorId: 'anthropic', apiKey: 'k', modelo: 'claude-sonnet-5-5', prompt: 'pergunta', web: true, opcoes: { lerPaginas: true, stream: true } });
    const volta = pedidos.at(-1).body.messages;
    ok(pedidos.length === n0 + 2 && volta.length === 2 && volta[0].role === 'user' && volta[1].role === 'assistant' && JSON.stringify(pedidos.at(-1).body.tools) === JSON.stringify(pedidos.at(-2).body.tools), 'turno pausado: o pedido volta com a resposta do modelo, sem mensagem nova e com as mesmas ferramentas');
    const bl = volta[1].content;
    ok(bl.map(b => b.type).join() === 'thinking,server_tool_use,web_search_tool_result,text,server_tool_use' && bl[0].thinking === 'vou procurar' && bl[0].signature === 'ASSINATURA' && bl[1].input.query === 'DMA revisão 2026' && bl[1]._json === undefined && bl[2].content[0].encrypted_content === 'abc' && bl[3].text === '{"jurisdicoes":[' && bl[3].citations[0].encrypted_index === 'i1' && bl[4].input.url === 'https://ec.europa.eu/dma', 'os blocos voltam inteiros (raciocínio com assinatura, consulta, resultado, texto com citação); o bloco de texto vazio fica de fora');
    ok(r.text === '{"jurisdicoes":[{"lugar":"UE"}]}' && !r.truncated && r.usage.entrada === 400 && r.usage.saida === 100, 'o texto das duas partes sai junto, e o consumo é a soma das duas');
    ok(r.paginas.join() === 'https://ec.europa.eu/dma' && r.buscas.join() === 'DMA revisão 2026' && r.fontes.length === 1 && r.fontes[0].trecho === 'trecho', 'buscas, página lida e citação (que no streaming chega em delta) ficam registradas');
    // a retomada falha: a pesquisa é refeita com a busca curta, que cabe num turno
    const n1 = pedidos.length;
    respostas.push({ sse: [{ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } } }, { type: 'message_delta', delta: { stop_reason: 'pause_turn' } }] },
      { status: 400, erro: 'messages.1: invalid block' }, { sse: [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'resposta curta' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }] });
    const rr = await ia({ provedorId: 'anthropic', apiKey: 'k', modelo: 'claude-sonnet-5-5', prompt: 'p', web: true, opcoes: { lerPaginas: true, maxBuscas: 30, stream: true } });
    ok(pedidos.length === n1 + 3 && pedidos.at(-1).body.tools.length === 1 && pedidos.at(-1).body.tools[0].max_uses === 5 && pedidos.at(-1).body.messages.length === 1 && rr.text === 'resposta curta' && /não pôde ser retomada.*refeita com a busca curta/.test(rr.avisos[0]), 'se a retomada é recusada, a pesquisa é refeita do início com a busca curta, e isso fica dito');
  }

  console.log('\n== leitura de páginas: Gemini ==');
  {
    respostas.push({ json: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP',
      urlContextMetadata: { urlMetadata: [{ retrievedUrl: 'https://www.planalto.gov.br/lei', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' }, { retrievedUrl: 'https://pago.com/x', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_PAYWALL' }] } }] } });
    const r = await ia({ provedorId: 'gemini', apiKey: 'k', prompt: 'p', web: true, opcoes: { lerPaginas: true } });
    ok(JSON.stringify(pedidos.at(-1).body.tools) === '[{"google_search":{}},{"url_context":{}}]' && r.paginas.join() === 'https://www.planalto.gov.br/lei' && r.fontes.some(f => f.url === 'https://www.planalto.gov.br/lei'), 'busca e contexto de URL vão juntos; página lida com sucesso entra, a barrada por paywall não');
    respostas.push({ status: 400, erro: 'url_context cannot be combined' }, { json: { candidates: [{ content: { parts: [{ text: 'só busca' }] }, finishReason: 'STOP' }] } });
    const rec = await ia({ provedorId: 'gemini', apiKey: 'k', prompt: 'p', web: true, opcoes: { lerPaginas: true } });
    ok(JSON.stringify(pedidos.at(-1).body.tools) === '[{"google_search":{}}]' && rec.text === 'só busca' && /recusou a leitura de páginas/.test(rec.avisos[0]), 'se o Gemini recusa as duas juntas, vai só a busca, com aviso');
    respostas.push({ json: { candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] } });
    await ia({ provedorId: 'gemini', apiKey: 'k', prompt: 'p', web: true });
    ok(JSON.stringify(pedidos.at(-1).body.tools) === '[{"google_search":{}}]', 'sem `lerPaginas`, o pedido ao Gemini é o de sempre');
  }

  console.log('\n== leitura de páginas: OpenAI ==');
  {
    respostas.push({ json: { status: 'completed', output: [
      { type: 'web_search_call', action: { type: 'search', query: 'cade mercados digitais', sources: [{ type: 'url', url: 'https://www.gov.br/cade/a' }, { type: 'url', url: 'https://jota.info/b' }] } },
      { type: 'web_search_call', action: { type: 'open_page', url: 'https://www.gov.br/cade/a' } },
      { type: 'web_search_call', action: { type: 'find_in_page', url: 'https://www.gov.br/cade/a', pattern: 'designação' } },
      { type: 'message', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }] } });
    const r = await ia({ provedorId: 'openai', apiKey: 'k', modelo: 'gpt-5', prompt: 'p', web: true, opcoes: { lerPaginas: true } });
    const b = pedidos.at(-1).body;
    ok(b.tools[0].type === 'web_search' && b.tools[0].search_context_size === 'high' && b.include.join() === 'web_search_call.action.sources', 'a busca vai com contexto alto e pede a lista completa das fontes');
    ok(r.paginas.join() === 'https://www.gov.br/cade/a' && r.fontes.length === 2 && r.buscas.join() === 'cade mercados digitais', 'página aberta pelo modelo (open_page) fica em `paginas`; as fontes consultadas entram na lista');
    respostas.push({ status: 400, erro: 'unknown parameter include' }, { json: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'só busca' }] }] } });
    const rec = await ia({ provedorId: 'openai', apiKey: 'k', modelo: 'gpt-5', prompt: 'p', web: true, opcoes: { lerPaginas: true } });
    ok(JSON.stringify(pedidos.at(-1).body.tools) === '[{"type":"web_search"}]' && pedidos.at(-1).body.include === undefined && rec.text === 'só busca' && rec.avisos.length === 1, 'recusado, o pedido volta ao formato de sempre, com aviso');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
