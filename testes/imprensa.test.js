// Repercussão pública da matéria, na aba "Como votou o deputado".
//
// Esta é a única camada do relatório cujo material não é da Câmara: vem da web
// aberta, por busca do provedor de IA. É por isso a mais fácil de estragar o
// documento, e é por isso que este teste existe.
//
// A regra que ele guarda acima de todas: AFIRMAÇÃO SEM FONTE NÃO ENTRA. O modelo
// tem de dizer, ponto por ponto, de que veículos aquilo saiu; o ponto cujos
// veículos não aparecem nas fontes que o provedor de fato consultou é
// descartado, e o descarte é CONTADO — lista que encolhe em silêncio esconde
// exatamente o caso em que o modelo inventou repercussão.
//
// A segunda: isto não descreve a matéria. O que a matéria faz sai do documento
// oficial. Se manchete virasse descrição de matéria, o relatório deixaria de ser
// peça de conferência.
//
// A terceira: levantar não é publicar. Como a sustentação, a repercussão só
// entra no PDF quando o analista marca — e ponto por ponto ele pode desmarcar o
// que não se sustenta na leitura dele.
//
// Uso: node testes/imprensa.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// O provedor de mentira: devolve o que for enfileirado e guarda o que recebeu,
// porque metade do que este teste afere está no PEDIDO (a busca foi pedida?) e
// não na resposta.
const respostas = [];
const pedidos = [];

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} },
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error('sem pdf')) }) },
  fetch: async (url, init) => {
    pedidos.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    const r = respostas.shift();
    if (!r) return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r) };
  },
  chrome: { storage: { local: {
              get: (_k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' } }),
              set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
const chamar = (fn, ...args) => vm.runInContext(fn, ctx)(...args);

const PROP = { siglaTipo: 'PL', numero: 3626, ano: 2023, ementa: 'Dispõe sobre as apostas de quota fixa.' };

// O levantamento são DUAS chamadas: a que BUSCA, em prosa, e a que ESTRUTURA
// aquele texto em JSON. A separação existe porque pedir JSON na mesma chamada
// desliga a ferramenta de busca (medido em 22/09/2026: gemini-3.1-flash-lite
// busca 4/4 com pedido curto em prosa e 0/3 pedindo JSON).

/** A 1ª chamada: prosa + grounding, na forma REAL do Gemini. */
const respostaBusca = (texto, fontes, buscas, suportes) => ({
  candidates: [{
    content: { parts: [{ text: texto }] },
    finishReason: 'STOP',
    groundingMetadata: {
      webSearchQueries: buscas || ['PL 3626 críticas', 'PL 3626 benefícios'],
      // Medido em 21/09/2026: a uri é sempre um redirecionador do Google e o
      // DOMÍNIO vem no title. O teste usa a forma real, não a forma cômoda.
      groundingChunks: (fontes || []).map(d => ({
        web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/' + encodeURIComponent(d), title: d },
      })),
      // groundingSupports: o provedor dizendo qual fonte sustenta qual frase.
      groundingSupports: (suportes || []).map(([texto, idx]) => ({
        segment: { text: texto }, groundingChunkIndices: idx,
      })),
    },
  }],
});

/** A 2ª chamada: só o JSON, sem busca nenhuma. */
const respostaJson = obj => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
});

/** Enfileira o par de uma tentativa completa. */
function enfileirar(obj, fontes, buscas, suportes, relato) {
  respostas.push(respostaBusca(relato || 'relato da busca em prosa', fontes, buscas, suportes));
  respostas.push(respostaJson(obj));
}

/** Compatível com o formato antigo: o ponto declara os veículos no JSON. */
const respostaGemini = (obj, fontes, buscas) => { enfileirar(obj, fontes, buscas); return null; };

const levantar = args => chamar('impLevantar', args);

(async () => {
  console.log('== o controle existe, e só na aba certa ==');
  {
    const cx = document.getElementById('cvImprensa');
    ok(!!cx, 'a caixa "levantar a repercussão pública" está no painel da consulta');
    let el = cx, pais = [];
    while (el && el.parentNode) { el = el.parentNode; if (el.id) pais.push(el.id); }
    ok(pais.includes('painel-consulta'), 'e vive dentro do painel "Como votou o deputado"');
    ok(!pais.includes('painel-producao') && !pais.includes('painel-radar') && !pais.includes('painel-aderencia'),
       'e em nenhum dos outros painéis');
    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    ok(manifest.web_accessible_resources.flatMap(w => w.resources).includes('imprensa.js'),
       'imprensa.js está em web_accessible_resources — sem isso o script não carrega');
    for (const arq of ['producao.js', 'radar.js']) {
      ok(!/\bimp[A-Z]|imprensa/.test(fs.readFileSync(path.join(RAIZ, arq), 'utf8')),
         `${arq} não toca na repercussão — os relatórios dele são só registro`);
    }
  }
  {
    // Repercussão é de UMA matéria. Num período com dezenas, "a repercussão" não
    // tem sujeito, e o controle sai da tela em vez de ficar sem efeito.
    const linha = document.getElementById('cvImprensaLinha');
    av("cvTrocarModo('proposicao')");
    ok(linha.hidden === false, 'no modo por proposição, o controle aparece');
    av("cvEl.imprensa.checked = true; cvTrocarModo('periodo')");
    ok(linha.hidden === true, 'no modo por período, ele SOME');
    ok(av('cvEl.imprensa.checked') === false,
       'e desmarca — marcação pendurada geraria busca que não ia a lugar nenhum');
    av("cvTrocarModo('proposicao')");
  }

  console.log('\n== as seções novas seguem o padrão de cor do documento ==');
  {
    // Elas usam o verde-azulado da casa, como o resto do painel. O que não
    // podem usar é cor de TIPO DE VOTO — lilás é Obstrução, azul é Art. 17 —,
    // que é significado que não é delas. O empréstimo é invisível para quem
    // escreve o CSS e evidente para quem lê a tela, então fica aferido.
    const VOTO = [['--art17', 'Art. 17'], ['--obstrucao', 'Obstrução'],
                  ['#6eaaff', 'Art. 17'], ['#c084fc', 'Obstrução'],
                  ['110,170,255', 'Art. 17'], ['192,132,252', 'Obstrução']];
    // As regras dos apartes ocupam um bloco contíguo: do primeiro `.dfs` até o
    // fim do bloco `.imp`, que é como elas estão no arquivo.
    const ini = html.indexOf('.dfs-campo {'), fim = html.indexOf('select.field {');
    const bloco = html.slice(ini, fim);
    ok(ini > 0 && fim > ini, 'os blocos de estilo dos apartes foram localizados');
    for (const [tok, quem] of VOTO) {
      ok(!bloco.includes(tok), `o CSS dos apartes não usa ${tok} — é a cor do voto "${quem}"`);
    }
    ok(/--aparte:\s*var\(--accent-light\)/.test(html),
       'o tom dos apartes é o verde-azulado do aplicativo, e não um matiz só deles');
    ok(/\.cv-apelido[^}]*var\(--aparte\)/.test(html), 'e o apelido segue o mesmo tom');

    // No PDF, as duas seções novas usam o mesmo vocabulário do resto do
    // documento: título verde padrão e caixa com a borda e o fundo das outras.
    // O que diz que ali não é registro é o título da seção e a nota dela.
    const js = fs.readFileSync(path.join(RAIZ, 'aderencia.js'), 'utf8');
    const cssPdf = js.slice(js.indexOf('const CSS_PDF_VOTOS'), js.indexOf('function cvHtmlPDF'));
    ok(/\.dfs \{[^}]*border: 1px solid #c9ddd2/.test(cssPdf),
       'no PDF a sustentação usa a borda verde do documento');
    ok(/\.imp-pdf \{[^}]*border: 1px solid #c9ddd2/.test(cssPdf),
       'e a repercussão usa exatamente a mesma');
    ok(!/h2\.(dfs|imp)-h\s*[,{]/.test(cssPdf),
       'os títulos das duas não sobrescrevem nada — caem no h2 verde padrão');
    ok(!/#7c3aed|#6d28d9|#2b6cb0|#64748b|#94a3b8/.test(cssPdf),
       'e nenhum roxo, azul ou ardósia sobrou no impresso');
  }

  console.log('\n== casar o veículo que o modelo citou com a fonte que ele consultou ==');
  {
    const fontes = [
      { url: 'https://x/1', veiculo: 'g1.globo.com' },
      { url: 'https://x/2', veiculo: 'estadao.com.br' },
      { url: 'https://x/3', veiculo: 'poder360.com.br' },
    ];
    ok(chamar('impCasarVeiculo', 'G1', fontes) === fontes[0],
       'o modelo escreve "G1" e a fonte diz "g1.globo.com" — casa');
    // O acento é o caso que mais derrubaria ponto bom em silêncio.
    ok(chamar('impCasarVeiculo', 'Estadão', fontes) === fontes[1],
       '"Estadão" casa com "estadao.com.br" — o acento não pode custar a fonte');
    ok(chamar('impCasarVeiculo', 'poder360.com.br', fontes) === fontes[2], 'o domínio inteiro casa');
    ok(chamar('impCasarVeiculo', 'Folha de S.Paulo', fontes) === null,
       'veículo que não está entre as fontes consultadas não casa');
    ok(chamar('impCasarVeiculo', 'a', fontes) === null, 'nem nome curto demais para significar algo');
  }

  console.log('\n== ponto sem fonte não entra, e o descarte é contado ==');
  {
    const fontes = [{ url: 'https://x/1', veiculo: 'g1.globo.com' }];
    const r = chamar('impValidarPontos', [
      { ponto: 'A cobertura destacou a tributação do setor.', veiculos: ['G1'] },
      { ponto: 'Dizem que o mercado movimenta bilhões.', veiculos: [] },
      { ponto: 'Houve críticas na imprensa internacional.', veiculos: ['nytimes.com'] },
      { ponto: '   ', veiculos: ['G1'] },
    ], fontes);
    ok(r.pontos.length === 1, `só o ponto com fonte conferida entra (${r.pontos.length})`);
    ok(r.descartados === 2,
       `os dois com veículo que não confere são contados como descarte (${r.descartados})`);
    ok(r.pontos[0].fontes[0] === fontes[0], 'e o ponto guarda a fonte, não o nome que o modelo deu');
    ok(r.pontos[0].usar === true, 'nasce marcado: passou pela conferência de fonte');
  }
  {
    // Os dois contadores são coisas diferentes, e somá-los faria a tela gritar
    // "inventou fonte" quando só houve lista comprida.
    const fontes = [{ url: 'https://x/1', veiculo: 'g1.globo.com' }];
    const muitos = Array.from({ length: 9 }, (_, i) => ({ ponto: `Ponto ${i}.`, veiculos: ['G1'] }));
    const r = chamar('impValidarPontos', muitos, fontes);
    ok(r.pontos.length === 6, `o teto por lista é respeitado (${r.pontos.length})`);
    ok(r.cortados === 3 && r.descartados === 0,
       `o que passou do teto é CORTADO, não descartado (${r.cortados} cortado, ${r.descartados} descartado)`);
  }
  {
    // O modelo devolve "**Crítica:** o projeto…", e o documento escapa HTML —
    // sem limpar, sairia o asterisco literal na frente da frase.
    const fontes = [{ url: 'https://x/1', veiculo: 'g1.globo.com' }];
    const r = chamar('impValidarPontos',
      [{ ponto: '**Crítica:** Entidades apontaram risco de endividamento.', veiculos: ['G1'] }], fontes);
    ok(r.pontos[0].texto === 'Entidades apontaram risco de endividamento.',
       `o negrito de markdown e o rótulo redundante caem (${JSON.stringify(r.pontos[0].texto)})`);
  }

  console.log('\n== quem diz de onde veio cada ponto é o PROVEDOR, não o modelo ==');
  {
    // O caminho principal de atribuição. O Gemini devolve, em groundingSupports,
    // qual fonte sustenta qual frase do texto que ele escreveu. Isso vale mais
    // do que pedir ao modelo que anote o domínio de cada linha — medido, num
    // pedido curto (o único que o faz buscar) ele ignora essa instrução.
    const RELATO = 'A bancada evangélica criticou a regulamentação do jogo. '
                 + 'A tributação das operadoras foi objeto de disputa entre as Casas.';
    respostas.push(respostaBusca(RELATO, ['gazetadopovo.com.br', 'senado.leg.br'], null, [
      ['A bancada evangélica criticou a regulamentação do jogo.', [0]],
      ['A tributação das operadoras foi objeto de disputa entre as Casas.', [1]],
    ]));
    // O JSON NÃO declara veículo nenhum: quem atribui é o grounding.
    respostas.push(respostaJson({ apelido: null, focos: [], contencioso: [
      { ponto: 'A bancada evangélica criticou a regulamentação do jogo.', veiculos: [] },
      { ponto: 'A tributação das operadoras foi objeto de disputa entre as Casas.', veiculos: [] },
    ] }));
    const imp = await levantar({ prop: PROP });
    ok(imp.ok === true, `o levantamento sai sem o modelo declarar fonte nenhuma (${imp.motivo || 'ok'})`);
    ok(imp.contencioso.length === 2 && imp.descartados === 0,
       `os dois pontos entram, atribuídos pelo grounding (${imp.contencioso.length} pontos, ${imp.descartados} descartados)`);
    ok(imp.contencioso[0].fontes[0].veiculo === 'gazetadopovo.com.br'
       && imp.contencioso[1].fontes[0].veiculo === 'senado.leg.br',
       'e cada ponto recebe A SUA fonte, não a lista inteira da consulta');
  }
  {
    // A falha que não pode ser confundida com a outra: a busca trouxe fontes,
    // mas o provedor não disse qual sustenta o quê, e o modelo também não. Isso
    // não é fonte inventada — é atribuição ausente, e a tela tem de distinguir.
    // Três pares: ele repete no mesmo modelo e depois tenta o de reserva, e só
    // então desiste. Sem atribuição é retentável — numa chamada seguinte o
    // provedor costuma mandar o mapa de trechos que faltou.
    for (let i = 0; i < 3; i++) {
      respostas.push(respostaBusca('um relato sem suportes', ['g1.globo.com']));   // sem groundingSupports
      respostas.push(respostaJson({ apelido: null, focos: [{ ponto: 'Um ponto qualquer.', veiculos: [] }], contencioso: [] }));
    }
    const imp = await levantar({ prop: PROP });
    ok(imp.ok === false && imp.motivo === 'sem-atribuicao',
       `sem saber qual fonte sustenta qual ponto, o levantamento é recusado (${imp.motivo})`);
    const tela = chamar('impHtml', imp);
    ok(/não informou qual delas sustenta cada ponto/.test(tela),
       'e a tela diz o que de fato houve, em vez de acusar o modelo de inventar fonte');
  }

  console.log('\n== o levantamento de ponta a ponta ==');
  {
    void (respostaGemini({
      apelido: 'PL das bets',
      focos: [{ ponto: 'A cobertura tratou sobretudo da tributação das casas de aposta.', veiculos: ['g1.globo.com'] }],
      contencioso: [
        { ponto: 'Entidades apontaram risco de endividamento de apostadores.', veiculos: ['Estadão'] },
        { ponto: 'Um estudo mostrou que 80% dos apostadores se endividam.', veiculos: ['institutoinventado.org'] },
      ],
    }, ['g1.globo.com', 'estadao.com.br'], ['PL 3626 bets críticas', 'PL 3626 bets benefícios']));

    const imp = await levantar({ prop: PROP });
    ok(imp.ok === true, `o levantamento sai (${imp.motivo || 'ok'})`);
    // O par: a 1ª chamada busca, a 2ª só estrutura. A 2ª NÃO pode pedir busca —
    // é o que garante que o JSON nunca disputa espaço com a ferramenta.
    const par = pedidos.slice(-2);
    ok(par[0].body.tools && par[0].body.tools[0].google_search !== undefined,
       'a 1ª chamada pede a busca na web — sem isso não há o que levantar');
    ok(!par[1].body.tools,
       'e a 2ª, que é a que pede JSON, NÃO pede busca: pedir JSON desliga a ferramenta');
    ok(!/JSON/.test(par[0].body.contents[0].parts[0].text),
       'o pedido de busca não menciona JSON em lugar nenhum');
    ok(/JSON/.test(par[1].body.contents[0].parts[0].text),
       'e o de estruturar menciona, que é o trabalho dele');
    ok(imp.apelido === 'PL das bets', 'o apelido público vem no levantamento');
    ok(imp.focos.length === 1 && imp.contencioso.length === 1,
       `o ponto de fonte inventada cai (${imp.focos.length} foco, ${imp.contencioso.length} contencioso)`);
    ok(imp.descartados === 1, 'e o descarte aparece, em vez de a lista encolher calada');
    ok(imp.fontes.length === 2 && imp.fontes[0].veiculo === 'g1.globo.com',
       'as fontes consultadas ficam guardadas, com o veículo tirado do redirecionador do Gemini');
    ok(imp.buscas.length === 2 && imp.buscas.some(b => /críticas/.test(b)) && imp.buscas.some(b => /benefícios/.test(b)),
       'e as buscas feitas ficam à vista — inclusive para se ver se ela foi de um lado só');
    ok(imp.incluir === false,
       'nasce FORA do PDF: levantar e publicar são atos diferentes, como na sustentação');

    const pdfAntes = chamar('impHtmlPDF', imp, chamar('cvEsc') ? undefined : undefined);
    ok(pdfAntes === '', 'e o PDF sai sem a seção enquanto ninguém marcou');
  }

  console.log('\n== o que vai ao PDF é o que o analista deixou marcado ==');
  {
    void (respostaGemini({
      apelido: null,
      focos: [{ ponto: 'Foco que fica.', veiculos: ['g1.globo.com'] }],
      contencioso: [{ ponto: 'Crítica que o analista vai cortar.', veiculos: ['estadao.com.br'] }],
    }, ['g1.globo.com', 'estadao.com.br']));
    const imp = await levantar({ prop: PROP });
    imp.incluir = true;

    let pdf = chamar('impHtmlPDF', imp);
    ok(/Foco que fica/.test(pdf) && /Crítica que o analista vai cortar/.test(pdf),
       'marcada, a seção sai com os dois pontos');
    ok(/g1\.globo\.com/.test(pdf), 'com o veículo de cada fonte — é por ele que se confere');
    // No papel, o endereço do redirecionador é cem caracteres de token opaco que
    // ninguém digita, iguais entre si, estampando o domínio do buscador no lugar
    // do veículo. Fica de fora, e o documento diz por quê.
    ok(!/vertexaisearch/.test(pdf), 'e SEM o endereço do redirecionador, que no impresso não serve a ninguém');
    ok(/não informa o endereço da página, apenas o veículo/.test(pdf.replace(/\s+/g, ' ')),
       'o documento explica a ausência, em vez de deixar a lista parecendo incompleta');
    ok(/Buscas feitas/.test(pdf), 'e com as buscas feitas, que são o que orientou a resposta');

    imp.contencioso[0].usar = false;
    pdf = chamar('impHtmlPDF', imp);
    ok(!/Crítica que o analista vai cortar/.test(pdf), 'desmarcado o ponto, ele sai do documento');
    ok(!/estadao\.com\.br/.test(pdf),
       'e a fonte que só ele citava sai também — fonte de nada não é fonte');
    ok(/Foco que fica/.test(pdf) && /g1\.globo\.com/.test(pdf), 'o resto fica');

    imp.focos[0].usar = false;
    ok(chamar('impHtmlPDF', imp) === '',
       'desmarcado tudo, a seção desaparece em vez de sair um título vazio');
  }
  {
    // Provedor que devolve a URL de verdade (OpenAI e Anthropic devolvem): aí o
    // endereço vai ao papel, porque aí ele diz alguma coisa.
    const imp = { ok: true, incluir: true, usarApelido: false, apelido: null, buscas: [], descartados: 0, cortados: 0,
      focos: [{ texto: 'Um ponto.', usar: true,
                fontes: [{ url: 'https://www1.folha.uol.com.br/poder/bets.shtml', veiculo: 'folha.uol.com.br' }] }],
      contencioso: [], fontes: [], modelo: 'm' };
    const pdf = chamar('impHtmlPDF', imp);
    ok(/www1\.folha\.uol\.com\.br\/poder\/bets\.shtml/.test(pdf),
       'endereço real sai impresso — quem confere consegue digitar esse');
    ok(!/não informa o endereço da página/.test(pdf.replace(/\s+/g, ' ')),
       'e a ressalva não aparece quando não há o que ressalvar');
    ok(/href="https:\/\/www1\.folha/.test(chamar('impHtml', imp)), 'na tela, o veículo é link');
  }

  console.log('\n== o que o modelo NÃO consegue fazer passar ==');
  {
    // Apelido é afirmação sobre o mundo como qualquer outra.
    void (respostaGemini({ apelido: 'PL 3626/2023', focos: [], contencioso: [] }, ['g1.globo.com']));
    ok((await levantar({ prop: PROP })).apelido === null,
       'o número da matéria não é apelido — ninguém chama o projeto assim na rua');

    void (respostaGemini({ apelido: 'x', focos: [], contencioso: [] }, ['g1.globo.com']));
    ok((await levantar({ prop: PROP })).apelido === null, 'nem uma letra solta');

    // Provedor que respondeu de memória, sem buscar: é o caso mais perigoso,
    // porque a resposta VEM e parece boa. Em nenhum modelo, é recusa.
    const deMemoria = () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      apelido: 'PL das bets',
      focos: [{ ponto: 'Sei de cabeça que houve polêmica.', veiculos: ['g1.globo.com'] }],
      contencioso: [] }) }] }, finishReason: 'STOP' }] });
    respostas.push(deMemoria(), deMemoria(), deMemoria());
    const semBusca = await levantar({ prop: PROP });
    ok(semBusca.ok === false && semBusca.motivo === 'sem-busca',
       'resposta sem nenhuma busca é RECUSADA, mesmo vindo completa e plausível');
    ok(semBusca.tentados.length >= 2 && new Set(semBusca.tentados).size === semBusca.tentados.length,
       `e foram tentados modelos DIFERENTES, não o mesmo duas vezes (${semBusca.tentados.join(', ')})`);
    const tela = chamar('impHtml', semBusca);
    ok(/Nenhum dos modelos tentados consultou a web/.test(tela) && /troque o modelo/.test(tela),
       'a tela aponta o modelo, que é a causa, e não a chave, que costuma estar boa');
    ok(new RegExp(semBusca.tentados[0]).test(tela), 'e nomeia o que foi tentado');

    // Aqui a BUSCA sai bem; quem vem quebrada é a estruturação.
    const parIlegivel = () => {
      respostas.push(respostaBusca('relato bom', ['g1.globo.com']));
      respostas.push({ candidates: [{ content: { parts: [{ text: 'não é json nenhum' }] }, finishReason: 'STOP' }] });
    };
    parIlegivel(); parIlegivel(); parIlegivel();
    ok((await levantar({ prop: PROP })).motivo === 'resposta-ilegivel', 'resposta ilegível não vira meio levantamento');

    ok((await levantar({ prop: null })).motivo === 'sem-materia', 'sem matéria não há repercussão a buscar');
  }

  console.log('\n== as duas falhas parecem iguais na tela e pedem remédios opostos ==');
  {
    // ILEGÍVEL é sorteio: o mesmo modelo, chamado de novo, costuma acertar.
    // Repetir resolve, e trocar de modelo seria trocar o que não está quebrado.
    const modeloDe = u => (String(u).match(/models\/([^:]+):/) || [])[1];
    const antes = pedidos.length;
    respostas.push(respostaBusca('relato bom', ['g1.globo.com']));
    respostas.push({ candidates: [{ content: { parts: [{ text: 'não é json' }] }, finishReason: 'STOP' }] });
    void (respostaGemini({ apelido: 'PL das bets', focos: [{ ponto: 'Foco bom.', veiculos: ['g1.globo.com'] }],
                                    contencioso: [] }, ['g1.globo.com']));
    const imp = await levantar({ prop: PROP });
    ok(imp.ok === true, `a segunda tentativa salva o levantamento (${imp.motivo || 'ok'})`);
    const usados = [...new Set(pedidos.slice(antes).map(p => modeloDe(p.url)))];
    ok(usados.length === 1,
       `resposta ilegível repete o MESMO modelo — é sorteio, não capacidade (${usados.join(' → ')})`);
    ok(imp.modelo === imp.modeloConfigurado, 'e o resultado sai pelo modelo que o analista configurou');
    ok(!/era o previsto, respondeu sem consultar a web/.test(chamar('impHtml', imp)),
       'sem aviso de troca, porque troca não houve');
  }
  {
    // SEM BUSCA quase nunca é sorteio: medido em 22/09/2026, há modelos que
    // NUNCA acionam a ferramenta (gemini-3.5-flash e gemini-3.6-flash: 0 em 3)
    // e outros que sempre acionam (gemini-3.8-flash: 3 em 3). Contra um modelo
    // que não busca, repetir é esperar duas vezes pelo mesmo "não" — o que
    // resolve é trocar.
    const modeloDe = u => (String(u).match(/models\/([^:]+):/) || [])[1];
    const antes = pedidos.length;
    respostas.push({ candidates: [{ content: { parts: [{ text: 'relato de memória' }] },
                                    finishReason: 'STOP' }] });   // sem grounding: não buscou
    void (respostaGemini({ apelido: 'PL das bets', focos: [{ ponto: 'Foco bom.', veiculos: ['g1.globo.com'] }],
                                    contencioso: [] }, ['g1.globo.com']));
    const imp = await levantar({ prop: PROP });
    ok(imp.ok === true, `o levantamento sai pelo modelo de reserva (${imp.motivo || 'ok'})`);
    const usados = pedidos.slice(antes).map(p => modeloDe(p.url));
    ok(usados[0] !== usados[1], `e o segundo modelo é OUTRO (${usados.join(' → ')})`);
    ok(imp.modelo !== imp.modeloConfigurado && imp.modelo === usados[1],
       'o resultado registra qual modelo de fato levantou');
    ok(/era o previsto, respondeu sem consultar a web/.test(chamar('impHtml', imp))
       && new RegExp(imp.modeloConfigurado).test(chamar('impHtml', imp)),
       'e a tela avisa da troca — trocar por baixo do analista seria decidir por ele');
  }
  {
    // Mas só o que é sorteio se repete. Chave inválida na segunda volta dá o
    // mesmo "não" e faz o analista esperar duas vezes por ele.
    const antes = pedidos.length;
    respostas.push({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] });
    const r = await levantar({ prop: PROP });
    ok(r.ok === false && r.motivo === 'erro', `recusa do provedor é erro, não sorteio (${r.motivo})`);
    ok(pedidos.length - antes === 1, 'e não se repete: uma chamada, um "não"');
  }

  console.log('\n== JSON com vírgula sobrando ==');
  {
    // O defeito mais comum de JSON gerado por modelo, e o único que dá para
    // consertar sem adivinhar conteúdo.
    const j = chamar('rsmJson', '{"apelido":"x","focos":[{"ponto":"a","veiculos":["b",],},],}');
    ok(j && j.apelido === 'x' && j.focos.length === 1,
       'vírgula antes de fechar não derruba a resposta inteira');
    ok(chamar('rsmJson', '{"apelido": lixo}') === null,
       'mas JSON quebrado de outro jeito segue sendo null — remendo às cegas viraria dado inventado');
  }

  console.log('\n== matéria sem repercussão é um achado, não uma falha ==');
  {
    void (respostaGemini({ apelido: null, semCobertura: true, focos: [], contencioso: [] },
                                  ['senado.leg.br']));
    const imp = await levantar({ prop: PROP });
    ok(imp.ok === true && imp.semCobertura === true, 'o levantamento sai dizendo que não há cobertura');
    const tela = chamar('impHtml', imp);
    ok(/não encontrou repercussão relevante/.test(tela), 'e a tela diz isso com clareza');
    ok(chamar('impHtmlPDF', imp) === '', 'e nada vai ao PDF: não há o que relatar');
  }

  console.log('\n== a costura: do levantamento até a tela e o PDF ==');
  {
    // As partes já foram aferidas uma a uma. Falta a emenda entre elas, que é
    // onde some coisa: o levantamento tem de atravessar cvRender, ficar em
    // cv.ultimo e chegar ao cvHtmlPDF ainda sendo o mesmo objeto — senão o
    // analista marca na tela e o documento sai sem.
    void (respostaGemini({
      apelido: 'PL das Bets',
      focos: [{ ponto: 'A cobertura tratou da tributação.', veiculos: ['g1.globo.com'] }],
      contencioso: [{ ponto: 'Apontou-se risco de endividamento.', veiculos: ['estadao.com.br'] }],
    }, ['g1.globo.com', 'estadao.com.br']));
    const imprensa = await levantar({ prop: PROP });

    av("cv.deputado = { id: 7, nome: 'Fulana de Tal', partido: 'PODE', uf: 'SP' }");
    const votacao = { id: 'v1', data: '2023-09-13', descricao: 'Votação da Redação Final.' };
    chamar('cvRender', {
      itens: [{ votacao, votos: [{ deputado_: { id: 7 }, tipoVoto: 'Sim' }], orientacoes: [] }],
      objetos: { v1: 'Votação da Redação Final.' },
      prop: PROP, propDetalhada: PROP, retirados: [], imprensa,
    });

    const tela = document.getElementById('cvResultado').innerHTML;
    ok(/Repercussão pública/.test(tela), 'o bloco aparece na tela do resultado');
    ok(/conhecida como PL das Bets/i.test(tela), 'e o apelido sobe ao cabeçalho, declarado como apelido');
    ok(/Dispõe sobre as apostas/.test(tela),
       'sem tomar o lugar da ementa, que é o que a matéria diz de si');

    ok(av('cv.ultimo.imprensa') === imprensa, 'o mesmo objeto fica em cv.ultimo, que é o que o PDF lê');
    ok(chamar('cvHtmlPDF', null).indexOf('Repercussão pública da matéria') === -1,
       'e o PDF sai sem a seção enquanto o analista não marcou');

    imprensa.incluir = true;
    const pdf = chamar('cvHtmlPDF', null);
    ok(/Repercussão pública da matéria/.test(pdf), 'marcada, a seção entra no documento');
    ok(/risco de endividamento/.test(pdf), 'com os pontos levantados');
    ok(/PL 3626\/2023 \(“PL das Bets”\)/.test(pdf),
       'e o apelido entra no título entre aspas, sem virar um segundo travessão na linha da ementa');
  }

  console.log('\n== cada chamada carrega o que é dela ==');
  {
    // O PEDIDO DE BUSCA É CURTO DE PROPÓSITO. Medido em 22/09/2026: o mesmo
    // gemini-3.1-flash-lite busca 4/4 com pedido curto em prosa, 0/4 com o
    // pedido longo e cheio de regras, e 0/3 quando se pede JSON. Regra a mais
    // nessa chamada custa a busca, que é a única coisa que só ela pode fazer.
    const busca = chamar('impPromptBusca', { prop: PROP, ementa: PROP.ementa, simples: '' });
    const linhas = busca.split('\n').length;
    ok(linhas <= 20, `o pedido de busca é curto (${linhas} linhas)`);
    ok(!/JSON/i.test(busca), 'e não menciona JSON, que é o que desligaria a ferramenta de busca');
    const b = busca.replace(/\s+/g, ' ');
    ok(/Busque os dois lados/i.test(b) && /críticas/.test(b) && /benefícios/.test(b),
       'a busca é pedida dos dois lados — consulta de um lado só devolve um lado só');
    ok(/Não descreva o que a matéria faz/.test(b),
       'e as duas travas que não cabe perder aqui: não descrever a matéria…');
    ok(/Não invente número nem citação/.test(b) && /Não opine/.test(b),
       '…e não inventar nem opinar');

    // A DISCIPLINA TODA MORA NA SEGUNDA CHAMADA, onde não custa busca nenhuma.
    const est = chamar('impPromptEstruturar', { prop: PROP, relato: 'um relato qualquer' })
      .replace(/\s+/g, ' ');
    ok(/NÃO acrescente ponto, domínio, número ou apelido que não esteja no texto/.test(est),
       'a estruturação é proibida de acrescentar o que não estava no relato');
    ok(/Você não pesquisou nada/.test(est), 'e é avisada de que não pesquisou nada');
    ok(/vertexaisearch/.test(est), 'o redirecionador do buscador não pode virar veículo');
    ok(/ENQUADRAMENTO público, não o conteúdo da lei/.test(est),
       'foco é enquadramento, não descrição da matéria');
    ok(/Responda SOMENTE com JSON/.test(est), 'e é aqui que o JSON aparece, quando já não custa nada');
  }

  console.log('\n== a sustentação usa a repercussão, mas não busca por conta própria ==');
  {
    const imp = {
      ok: true, apelido: 'PL das bets', incluir: false, usarApelido: true,
      focos: [{ texto: 'A cobertura tratou da tributação.', fontes: [{ veiculo: 'g1.globo.com' }], usar: true }],
      contencioso: [
        { texto: 'Apontou-se risco de endividamento.', fontes: [{ veiculo: 'estadao.com.br' }], usar: true },
        { texto: 'Crítica que o analista desmarcou.', fontes: [{ veiculo: 'poder360.com.br' }], usar: false },
      ],
      fontes: [], buscas: [], descartados: 0, modelo: 'm',
    };
    const p = chamar('dfsPrompt', { posicao: 'favoravel', dep: { nome: 'F', partido: 'PODE', uf: 'SP' },
      prop: PROP, materia: 'apostas', itens: [], registro: { posicao: null }, imprensa: imp })
      .replace(/\s+/g, ' ');
    ok(/risco de endividamento/.test(p), 'o ponto contestado chega ao pedido da sustentação');
    ok(/Crítica que o analista desmarcou/.test(p) === false,
       'o que o analista desmarcou NÃO chega — a curadoria dele vale para as duas coisas');
    ok(/é a isto que a sustentação precisa dar resposta/.test(p),
       'e chega como objeção a enfrentar');
    ok(/NÃO repita como verdade o que está aí/.test(p) && /não diga "a imprensa afirma que"/.test(p),
       'com a proibição de repetir a crítica como fato: a sustentação é prosa livre, que ninguém confere frase a frase');
    ok(/NÃO reaproveite número, percentual, valor em reais/.test(p),
       'e a proibição específica de reaproveitar cifra de terceiro, que é o que ele mais tenta fazer');
    ok(/conhecida publicamente como "PL das bets"/.test(p), 'e o apelido vai, porque é como se fala da matéria');

    const sem = chamar('dfsPrompt', { posicao: 'favoravel', dep: { nome: 'F', partido: 'PODE', uf: 'SP' },
      prop: PROP, materia: 'apostas', itens: [], registro: { posicao: null } });
    ok(!/REPERCUSSÃO/.test(sem), 'sem levantamento, o pedido não ganha seção nenhuma a mais');

    // E o invariante que protege o texto: a sustentação NÃO busca.
    respostas.push({ candidates: [{ content: { parts: [{ text:
      'A matéria enfrenta um problema real e a posição se justifica pelo que ela protege. '
      + 'O texto aprovado organiza um setor que operava sem regra nenhuma, e essa é a diferença '
      + 'que interessa a quem estava exposto. Manter tudo como estava não era neutralidade: era escolha.' }] },
      finishReason: 'STOP' }] });
    const d = await chamar('dfsGerar', { posicao: 'favoravel', dep: { id: 1, nome: 'F', partido: 'PODE', uf: 'SP' },
      prop: PROP, resumos: null, linhas: [], objetos: {}, imprensa: imp });
    ok(d.ok === true, `a sustentação sai (${d.motivo || 'ok'})`);
    ok(!pedidos.at(-1).body.tools,
       'e o pedido dela NÃO liga busca na web: quem busca é a etapa que valida fonte por fonte');
    ok(d.usouImprensa === true, 'ela registra que foi orientada pela repercussão');
    ok(d.incluir === false, 'e continua nascendo fora do PDF');

    // Medido contra o provedor: mesmo proibida, a sustentação reaproveita as
    // cifras dos pontos contestados. A instrução reduz, não elimina — então a
    // tela manda o analista olhar exatamente onde o defeito aparece.
    ok(/Confira os números/.test(chamar('dfsHtml', d)),
       'e a tela avisa, dirigido, para conferir os números quando o texto saiu da repercussão');
    ok(!/Confira os números/.test(chamar('dfsHtml', Object.assign({}, d, { usouImprensa: false }))),
       'sem repercussão, o aviso não aparece — aviso que aparece sempre ninguém lê');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
