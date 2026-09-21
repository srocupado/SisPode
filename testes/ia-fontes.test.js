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

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
