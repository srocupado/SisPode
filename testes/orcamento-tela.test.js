// Teste de fumaça da TELA de notas orçamentárias.
//
// Por que ele existe: os arquivos desta extensão são scripts clássicos que
// compartilham um escopo global, e o que não está carregado na página só falha
// em runtime, no clique. Foi exatamente assim que orcamento-notas.js ficou
// chamando `mostrarToast` (que vive em panel.js) e lendo `state.config` (que
// vive em analise.js) — duas ReferenceError esperando o primeiro erro de
// gravação da ficha para aparecer, justamente quando o aviso importa.
//
// O teste monta o escopo da página exatamente como o navegador monta: lê as
// tags <script> do HTML, concatena os arquivos NA ORDEM e avalia tudo junto.
// Depois renderiza com um quadro real da CMO. Qualquer símbolo faltando
// estoura aqui, e não no gabinete.
//
// Uso: node testes/orcamento-tela.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Os scripts que a página carrega, na ordem, menos as bibliotecas externas. */
function scriptsDaPagina() {
  const html = fs.readFileSync(path.join(RAIZ, 'orcamento-notas.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m => m[1])
    .filter(s => !s.startsWith('libs/'));
}

/** Um escopo de página com o mínimo que a extensão oferece. */
function montarPagina() {
  const { document, window } = parseHTML(fs.readFileSync(path.join(RAIZ, 'orcamento-notas.html'), 'utf8'));

  // LIMITAÇÃO DO HARNESS, não do código: no linkedom, <select>.value é somente
  // leitura, e no navegador é gravável. Sem este shim o teste acusaria um erro
  // que não existe em produção. O getter devolve o que foi gravado ou, na
  // falta, a primeira <option> — que é o comportamento do navegador.
  const protoSelect = Object.getPrototypeOf(document.createElement('select'));
  if (!Object.getOwnPropertyDescriptor(protoSelect, 'value')?.set) {
    Object.defineProperty(protoSelect, 'value', {
      configurable: true,
      get() {
        if (this.__valor !== undefined) return this.__valor;
        const o = this.querySelector('option');
        return o ? (o.getAttribute('value') ?? o.textContent) : '';
      },
      set(v) { this.__valor = v; },
    });
  }
  const gravado = {};
  const ctx = {
    document, window, DOMParser, console, gravado,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: globalThis.fetch, URL, TextDecoder, AbortController, DOMException,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    chrome: {
      storage: { local: {
        get: (_k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'gemini-2.5-flash', nomeUsuario: 'Teste' } }),
        // Guarda o que foi gravado para o teste conferir a MESCLAGEM: o nó
        // `config` é compartilhado com os outros painéis.
        set: (obj, cb) => { Object.assign(gravado, obj); if (cb) cb(); },
      } },
      runtime: { getURL: p => p },
    },
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) },
    alert: () => {}, confirm: () => false, prompt: () => null,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const fonte = scriptsDaPagina().map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n');
  // Um `const` no topo de um <script> é visível para os outros scripts da
  // página, mas NÃO vira propriedade de window. Por isso o teste avalia
  // expressões DENTRO do escopo (av) em vez de ler propriedades do contexto —
  // é o mesmo acesso que o código da página tem.
  const script = new vm.Script(fonte, { filename: 'pagina-orcamento.js' });
  const av = expr => vm.runInContext(expr, ctx);
  script.runInContext(ctx);
  return { ctx, av, doc: document, gravado };
}

(async () => {
  console.log('== a página carrega inteira, como no navegador ==');
  let pag, av;
  {
    const scripts = scriptsDaPagina();
    ok(scripts.includes('orcamento-ia.js'), `a camada de IA está no HTML (${scripts.length} scripts próprios)`);
    try { pag = montarPagina(); av = pag.av; ok(true, 'todos os arquivos avaliam no mesmo escopo, sem erro'); }
    catch (e) { ok(false, `falhou ao montar o escopo: ${e.message}`); throw e; }
  }
  const corpo = () => pag.doc.getElementById('on-corpo').innerHTML;

  console.log('\n== nenhum símbolo de outra página vaza para esta ==');
  {
    // As duas armadilhas reais, agora travadas.
    ok(av('typeof mostrarToast') === 'function', 'mostrarToast existe NESTA página (vivia só em panel.js/analise.js)');
    ok(av('typeof state') === 'undefined', 'e o `state` de analise.js NÃO é usado aqui — o estado desta tela é `estado`');

    // Tudo que a tela chama por nome tem de estar definido em algum dos scripts.
    const usados = ['carregarExercicio', 'conferirContraFonte', 'resumoConferencia', 'CAMPOS_FICHA',
      'GRUPOS_FICHA', 'fichaVazia', 'preencherCampo', 'estadoDaFicha', 'resumoDaFicha', 'conferirFicha',
      'valoresDeOutroExercicio', 'montarSerie', 'seriesComDados', 'frasSerie', 'montarGuia',
      'tabelaComparativa', 'tabelaPorOrgao', 'variacaoEntre', 'formatarBR',
      'promptCartilha', 'conferirAcoes', 'promptFicha', 'conferirPropostasFicha',
      'promptSintese', 'numerosDaBase', 'conferirSintese', 'extrairJSON',
      'chamarIAOrcamento', 'modoDeLeitura', 'comTextoDoDocumento', 'PROVEDORES_ORCAMENTO'];
    const faltando = usados.filter(n => av(`typeof ${n}`) === 'undefined');
    ok(!faltando.length, faltando.length ? `faltam no escopo: ${faltando.join(', ')}` : `os ${usados.length} símbolos usados pela tela estão todos definidos`);
  }

  console.log('\n== render com o quadro REAL da matéria ==');
  {
    const C = require(path.join(RAIZ, 'cmo.js'));
    globalThis.DOMParser = DOMParser;
    pag.ctx.__q = await C.carregarExercicio('loa', 2026);
    av(`estado.tipo = 'loa'; estado.ano = '2026'; estado.quadro = __q;
        estado.ficha = fichaVazia('loa', '2026'); estado.serie = montarSerie([]);
        estado.ia = { acoes: {}, sintese: null };`);

    let erro = null;
    try { av('render()'); } catch (e) { erro = e; }
    ok(!erro, erro ? `render quebrou: ${erro.message}` : 'a tela renderiza sem quebrar');

    const html = corpo();
    ok(html.length > 3000, `${html.length} caracteres de painel`);
    ok(/Síntese analítica/.test(html), 'o card da síntese aparece');
    ok(/o que dá para fazer com o dinheiro/i.test(html), 'o card das ações orçamentárias aparece');
    ok(/Guia de aplicação das emendas/.test(html), 'e o guia por área temática');
    ok(/Ler as cartilhas com IA/.test(html), 'com o botão de leitura, porque há cartilhas publicadas');
    ok(/Extrair da fonte com IA/.test(html), 'e o de extração da ficha, porque há orientação normativa');

    // O guia tem de mostrar as cartilhas reais, e não 16 linhas vazias.
    const g = av('montarGuia(estado.quadro.emendas, estado.quadro.relatores)');
    ok(g.totalCartilhas >= 20 && g.semArea.length === 0,
       `${g.totalCartilhas} cartilhas, todas casadas com sua área temática`);
    ok(!/sem cartilha publicada/.test(html) || g.areas.some(a => !a.cartilhas.length),
       'e "sem cartilha publicada" só aparece em área que realmente não tem');
  }

  console.log('\n== os cards da IA em cada estado ==');
  {
    // Estado 1: leitura que passou na conferência.
    av(`estado.ia = { acoes: { d1: { url: 'u', rotulo: 'Cartilha do FNS', modoLeitura: 'pdf',
      conferido: true, resumo: '2 ações conferidas.',
      aprovadas: [{ codigo: '2E90', nome: 'Média e Alta Complexidade', permite: ['custeio'], naoPermite: ['obras'] }],
      recusadas: [{ codigo: '8535', motivo: 'o trecho citado não foi localizado no texto do documento' }] } },
      sintese: null }; render();`);
    let html = corpo();
    ok(/2E90/.test(html) && /custeio/.test(html), 'a ação conferida é exibida com o que ela permite');
    ok(/1 item\(ns\) descartado\(s\) na conferência/.test(html) && /8535/.test(html),
       'e a descartada aparece SEPARADA, com o motivo — quem revisa precisa saber que houve alucinação');

    // Estado 2: documento que precisou ir como texto.
    av(`estado.ia.acoes.d1.modoLeitura = 'texto';
        estado.ia.acoes.d1.motivoModo = 'o PDF tem 22,0 MB, acima do limite de envio — enviado o texto extraído, não o arquivo.';
        render();`);
    html = corpo();
    ok(/lido\(s\) como texto extraído/.test(html) && /22,0 MB/.test(html),
       'o modo de leitura degradado é declarado na tela, com o motivo');
    ok(/deixa de ser por dois caminhos independentes/.test(html),
       'e explica o que isso enfraquece — a garantia não pode ser vendida mais forte do que é');

    // Estado 3: síntese com número não conferido.
    av(`estado.ia.sintese = { texto: 'O Ministério da Saúde receberá 3.812,7 milhões.',
      modelo: 'gemini/gemini-2.5-flash', redigidaEm: '2026-09-03T12:00:00Z', redigidaPor: 'Teste',
      conferencia: { limpo: false, conferidos: 0, suspeitos: [{ numero: '3.812,7', contexto: '…receberá 3.812,7 milhões…' }],
                     motivo: '1 de 1 número(s) do texto não constam da base conferida: 3.812,7.' } };
      render();`);
    html = corpo();
    ok(/não constam da base conferida/.test(html) && /3\.812,7/.test(html),
       'a síntese sai com o número suspeito NOMEADO, não escondida nem apagada');
    ok(/Onde estão os números não conferidos/.test(html), 'e com o contexto para o revisor localizar no texto');
  }

  console.log('\n== o menu de chave de IA ==');
  {
    // Sem ele, a única forma de informar a chave era voltar ao painel
    // principal — e as três leituras deste módulo simplesmente não rodavam.
    // As demais telas autônomas (analise, congresso, lideres, ccjc) já tinham
    // o seu; esta ficou sem.
    const modal = pag.doc.getElementById('modal-configuracoes');
    ok(!!modal, 'a tela tem modal de configurações de IA');
    ok(modal.style.display === 'none', 'fechado por padrão');
    ok(['config-provedor', 'config-api-key', 'config-modelo', 'btn-salvar-config',
        'btn-carregar-modelos', 'btn-testar-conexao', 'btn-toggle-key']
       .every(id => pag.doc.getElementById(id)),
       'com provedor, chave, modelo, teste de conexão e gravação');
    ok(!!pag.doc.getElementById('btn-config'), 'e o botão no topo para abri-lo');

    av('abrirConfiguracoes()');
    ok(modal.style.display === 'flex', 'o botão abre o modal');
    ok(pag.doc.getElementById('config-modelo').querySelectorAll('option').length >= 2,
       'a lista de modelos vem preenchida mesmo sem chave — a tela nunca abre vazia');
    ok(/aistudio\.google\.com/.test(pag.doc.getElementById('config-hint-chave').textContent),
       'e diz onde obter a chave do provedor selecionado');

    // Chave com formato errado não é gravada: é o erro que só apareceria na
    // primeira chamada real, depois de baixar um PDF de 20 MB.
    av(`$('config-api-key').value = 'chave-qualquer'`);
    const antes = JSON.stringify(av('estado.config'));
    await av('salvarConfig()');
    ok(JSON.stringify(av('estado.config')) === antes, 'chave com formato inválido não é gravada');

    // A MESCLAGEM: o nó `config` é compartilhado com os outros painéis e guarda
    // nomeUsuario e a chave do Portal da Transparência. Substituir o objeto
    // apagaria a configuração deles em silêncio.
    av(`estado.config = { nomeUsuario: 'Fulano', transparenciaKey: 'abc', provedor: 'gemini', apiKey: 'antiga-mas-longa-o-suficiente' };
        $('config-provedor').value = 'anthropic';
        $('config-api-key').value = 'sk-ant-chave-de-teste-com-tamanho-suficiente';
        popularModelos();`);
    await av('salvarConfig()');
    const c = av('estado.config');
    ok(c.provedor === 'anthropic' && /^sk-ant-/.test(c.apiKey), `provedor e chave gravados: ${c.provedor}`);
    ok(c.nomeUsuario === 'Fulano' && c.transparenciaKey === 'abc',
       'e o que era dos OUTROS painéis continua lá — a gravação mescla, não substitui');
    ok(modal.style.display === 'none', 'o modal fecha ao salvar');

    // O topo passa a dizer o que está em uso, em vez de deixar adivinhar.
    ok(/claude|anthropic/i.test(pag.doc.getElementById('btn-config-rotulo').textContent),
       `o botão do topo mostra o modelo em uso: "${pag.doc.getElementById('btn-config-rotulo').textContent}"`);
    av(`estado.config = {}; atualizarSeloConfig();`);
    ok(/configurar/i.test(pag.doc.getElementById('btn-config-rotulo').textContent),
       'e avisa quando não há chave nenhuma');

    // Sem chave, pedir uma leitura ABRE o lugar de resolver.
    modal.style.display = 'none';
    await av('redigirSintese()');
    ok(modal.style.display === 'flex',
       'pedir IA sem chave abre as configurações, em vez de só avisar e parar');
    modal.style.display = 'none';
  }

  console.log('\n== a nota gerada a partir desse estado ==');
  {
    const html = av('htmlNota(estado.quadro, null, estado.ficha, estado.serie, null, estado.ia)');
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    ok(/NOTA TÉCNICA/.test(txt), 'a nota é gerada com a camada de IA no estado');
    ok(/Ressalva de conferência/.test(txt) && /3\.812,7/.test(txt),
       'e a ressalva vai IMPRESSA: quem recebe o PDF não vê o painel');
    ok(/2E90/.test(txt) && !/8535/.test(txt),
       'só a ação conferida entra na nota; a descartada fica no painel');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
