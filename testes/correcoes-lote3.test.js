// Correções do lote 3 da varredura (15/09/2026) — orçamento (notas técnicas,
// conferência), emendas e datas.
//
// A família de defeitos é a mesma dos outros lotes: recusa que vira sucesso, e
// gravação que falha atrás de um toque de "✓".
//   1. "Aceitar todas" ignorava o {ok:false} de preencherCampo, esvaziava a
//      lista de propostas e anunciava os CANDIDATOS como preenchidos.
//   2. salvarFicha gravava o nó inteiro: a segunda aba a salvar apagava o campo
//      que a primeira acabara de preencher — a ficha é compartilhada.
//   3. Leitura de parâmetros da Mensagem dizia "gravado(s) na ficha" com a
//      falha do PUT morrendo num console.warn.
//   4. emendas: o aviso de nº arredondado nomeava só a PRIMEIRA UF e só no
//      console, enquanto a tela mostrava a lista com toast de sucesso.
//   5. cmo: faixa de datas sem ano nas duas pontas entrava no cronograma como
//      se fosse data ("06/12"), e a contagem de dias dizia "encerrado".
//
// Uso: node testes/correcoes-lote3.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// ---------- a tela de notas, como o navegador a carrega ----------
const html = fs.readFileSync(path.join(RAIZ, 'orcamento-notas.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window } = parseHTML(html);
const protoSelect = Object.getPrototypeOf(document.createElement('select'));
Object.defineProperty(protoSelect, 'value', { configurable: true,
  get() { return this.__valor ?? (this.querySelector('option')?.getAttribute('value') ?? ''); }, set(v) { this.__valor = v; } });

const toasts = [];
const pedidos = [];
// O Firebase da ficha: `remoto` é o que está no banco, `falharPut` derruba a
// gravação. Assim se exercita o encontro de duas abas na mesma ficha.
const fb = { remoto: null, falharPut: false };
const ctx = {
  document, window, DOMParser, setTimeout, clearTimeout, URL, TextDecoder, AbortController, DOMException,
  console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  btoa: s => Buffer.from(s, 'latin1').toString('base64'),
  fetch: async (url, opt = {}) => {
    const metodo = opt.method || 'GET';
    pedidos.push({ url: String(url), metodo, corpo: opt.body ? JSON.parse(opt.body) : null });
    if (/orcamento_ficha/.test(String(url))) {
      if (metodo === 'GET') return { ok: true, status: 200, json: async () => fb.remoto };
      if (fb.falharPut) return { ok: false, status: 503, json: async () => ({}) };
      fb.remoto = JSON.parse(opt.body);
      return { ok: true, status: 200, json: async () => fb.remoto };
    }
    return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({ config: {} }), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => p } },
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) },
  alert: () => {}, confirm: () => false, prompt: () => null,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
// mostrarToast é declaração de função: no vm dá para substituir e ler o que a
// tela DIZ, que é metade do que estes defeitos erravam.
ctx.__toasts = toasts;
av(`mostrarToast = (msg, tipo) => { __toasts.push({ msg: String(msg), tipo: tipo || 'sucesso' }); };`);

const QUADRO = {
  tipo: 'loa', anoOrcamento: '2027', fontesIndisponiveis: [],
  materia: { disponivel: true, identificacao: 'PLN 24/2026', apelido: 'PLOA 2027', ementa: 'Estima a receita.', urlDocumento: 'https://legis/pln24' },
  acompanhamento: { disponivel: false, motivo: 'x' },
  cronograma: { disponivel: false, motivo: 'A CMO ainda não publicou o cronograma.' },
  relatores: { disponivel: true, presidenteCMO: null, relatorGeral: null, relatorReceita: null, setoriais: [] },
  emendas: { disponivel: false, motivo: 'ainda não' },
  notas: { disponivel: false, motivo: 'x' },
  executivo: { disponivel: false, motivo: 'x' },
};
ctx.__q = QUADRO;

function fichaLimpa() {
  fb.remoto = null; fb.falharPut = false; pedidos.length = 0; toasts.length = 0;
  av(`estado.tipo='loa'; estado.ano='2027'; estado.quadro=__q; estado.ficha=fichaVazia('loa','2027');
      estado.serie=montarSerie([]); estado.ia={acoes:{},sintese:null}; estado.config={}; estado.propostas=null;`);
}

(async () => {
  console.log('== "Aceitar todas" não conta como preenchido o que a ficha recusou ==');
  {
    fichaLimpa();
    // Duas propostas: uma completa e uma SEM documento de origem — a recusa que
    // existe para impedir número sem procedência de entrar na ficha.
    av(`estado.propostas = { conferido: true, documento: 'Manual de Emendas da LOA 2027', aceitas: [
          { campo: 'cota_individual_deputado', rotulo: 'Cota individual', valor: 'R$ 40.252.007,00', pagina: '18', trecho: 'cota de R$ 40.252.007,00' },
          { campo: 'piso_obras', rotulo: 'Piso de obras', valor: 'R$ 250.000,00', pagina: '', trecho: 'piso', documento: '' }
        ], recusadas: [] };`);
    // A proposta sem procedência: o documento do card não vale para ela.
    av(`estado.propostas.aceitas[1].documento = ''; estado.propostas.documento = '';`);

    await av('(async () => { aceitarTodasPropostas(); await new Promise(r => setTimeout(r, 10)); })()');

    ok(av('Object.keys(estado.ficha.valores).length') === 0,
       'sem procedência, nenhum valor entrou na ficha');
    const restantes = av('estado.propostas.aceitas.map(p => p.campo)');
    ok(restantes.length === 2, `as duas continuam na lista quando nenhuma tinha procedência (${restantes.join(',')})`);
    ok(av('estado.propostas.aceitas.every(p => !!p.motivoRecusa)'), 'cada uma com o motivo da recusa');
    ok(toasts.some(t => t.tipo !== 'sucesso' && /Nenhum campo entrou na ficha/.test(t.msg)),
       `e a tela diz que nada entrou (${toasts.map(t => t.tipo).join(',')})`);
    ok(!toasts.some(t => /campo\(s\) preenchido\(s\)/.test(t.msg) && t.tipo === 'sucesso'),
       'sem nenhum "✓ N campo(s) preenchido(s)"');
  }
  {
    // Agora com procedência numa e não na outra: a boa entra, a outra fica.
    fichaLimpa();
    av(`estado.propostas = { conferido: true, documento: 'Manual de Emendas da LOA 2027', aceitas: [
          { campo: 'cota_individual_deputado', rotulo: 'Cota individual', valor: 'R$ 40.252.007,00', pagina: '18', trecho: 'cota' },
          { campo: 'piso_obras', rotulo: 'Piso de obras', valor: '', pagina: '', trecho: 'piso' }
        ], recusadas: [] };`);
    await av('(async () => { aceitarTodasPropostas(); await new Promise(r => setTimeout(r, 10)); })()');

    ok(!!av(`estado.ficha.valores['cota_individual_deputado']`), 'a proposta completa entrou na ficha');
    ok(!av(`estado.ficha.valores['piso_obras']`), 'a proposta sem valor NÃO entrou');
    ok(av(`estado.propostas.aceitas.map(p => p.campo).join()`) === 'piso_obras',
       'e é ela que permanece na lista, para o analista completar');
    const t = toasts.find(x => /preenchido/.test(x.msg));
    ok(!!t && /✓ 1 campo\(s\)/.test(t.msg), `o toast conta 1, não 2 (${t ? t.msg : 'sem toast'})`);
    ok(!!t && /1 recusada\(s\)/.test(t.msg) && t.tipo === 'aviso', 'e diz que houve recusa, como aviso');

    av('render()');
    ok(/não entrou na ficha/.test(document.getElementById('on-corpo').innerHTML),
       'o card da proposta mostra por que ela não entrou');
  }

  console.log('\n== a ficha compartilhada: a segunda aba não apaga o campo da primeira ==');
  {
    fichaLimpa();
    // A OUTRA aba já gravou o IPCA. Esta aba carregou a ficha antes disso e
    // agora preenche o PIB.
    fb.remoto = { tipo: 'loa', ano: '2027', atualizadaEm: '2026-09-15T10:00:00.000Z', valores: {
      ipca: { valor: '3,60%', documento: 'Mensagem Presidencial', pagina: '7', trecho: 'IPCA 3,60',
              exercicio: '2027', preenchidoPor: 'colega', preenchidoEm: '2026-09-15T10:00:00.000Z', conferencia: null },
    } };
    av(`preencherCampo(estado.ficha, 'pib', { valor: '2,44%', documento: 'Mensagem Presidencial', pagina: '7', trecho: 'PIB 2,44' });`);
    await av('salvarFicha()');

    const put = pedidos.filter(p => p.metodo === 'PUT').pop();
    ok(!!put, 'houve gravação');
    ok(!!put.corpo.valores.pib, 'o PIB desta aba está no que foi gravado');
    ok(!!put.corpo.valores.ipca, 'e o IPCA da outra aba SOBREVIVEU (antes era apagado)');
    ok(av(`!!estado.ficha.valores.ipca`), 'o estado local também passa a conhecer o campo da outra aba');
    ok(pedidos.some(p => p.metodo === 'GET' && /orcamento_ficha/.test(p.url)),
       'porque a gravação lê o banco antes de escrever');
  }
  {
    // Mesmo campo nas duas pontas: vence o mais recente, não "o último a salvar".
    fichaLimpa();
    fb.remoto = { tipo: 'loa', ano: '2027', valores: {
      pib: { valor: '2,90%', documento: 'Mensagem', preenchidoEm: '2026-09-15T12:00:00.000Z' },
    } };
    av(`estado.ficha.valores.pib = { valor: '1,00%', documento: 'rascunho antigo', preenchidoEm: '2026-09-15T08:00:00.000Z' };`);
    await av('salvarFicha()');
    const put = pedidos.filter(p => p.metodo === 'PUT').pop();
    ok(put.corpo.valores.pib.valor === '2,90%',
       `o valor mais novo prevalece (${put.corpo.valores.pib.valor})`);
    ok(av('estado.ficha.valores.pib.valor') === '2,90%', 'e a tela passa a mostrar o que está no banco');
  }

  console.log('\n== leitura da Mensagem não diz "gravado" sem ter gravado ==');
  {
    const PAGINAS = [{ numero: 7, texto: [
      'Projeções macroeconômicas 2026 2027 2028 2029',
      'PIB 1,50 2,44 2,50 2,60',
      'IPCA 4,50 3,60 3,00 3,00',
    ].join('\n') }];
    ctx.__paginas = PAGINAS;

    fichaLimpa();
    await av('aplicarParametrosDaMensagem(__paginas)');
    ok(av(`!!estado.ficha.valores.pib && estado.ficha.valores.pib.valor === '2,44%'`),
       'com Firebase de pé, os parâmetros entram na ficha');
    ok(toasts.some(t => t.tipo === 'sucesso' && /gravado\(s\) na ficha/.test(t.msg)),
       'e aí sim a tela diz "gravado(s) na ficha"');

    fichaLimpa();
    fb.falharPut = true;
    await av('aplicarParametrosDaMensagem(__paginas)');
    const t = toasts.find(x => x.tipo === 'erro');
    ok(!!t && /NÃO foi salva no Firebase/.test(t.msg),
       `com o PUT falhando, a tela declara a falha (${t ? t.msg.slice(0, 60) : 'nenhum toast de erro'})`);
    ok(!toasts.some(x => /gravado\(s\) na ficha/.test(x.msg)), 'e nunca afirma que gravou');
  }

  console.log('\n== conferência da ficha contra o Manual: falha de gravação é dita ==');
  {
    // conferirNormas depende de extrair um PDF de 259 páginas; o que se trava
    // aqui é que o toast do resultado passou a depender do PUT.
    const src = fs.readFileSync(path.join(RAIZ, 'orcamento-notas.js'), 'utf8');
    ok(!/await salvarFicha\(\)\.catch\(e => console\.warn\('Firebase:', e\.message\)\);\s*\n\s*mostrarToast\(`Ficha conferida/.test(src),
       'o toast de "Ficha conferida" não vem mais depois de um catch que só faz console.warn');
    ok(/NÃO foi salva no Firebase[\s\S]{0,120}não vai encontrá-la/.test(src),
       'e existe a mensagem que diz que o próximo a abrir a ficha não vai achar a conferência');
    ok(/a leitura FOI FEITA mas não ficou registrada no Firebase/.test(src),
       'o mesmo para a leitura de cartilha, cujo registro evita a chamada repetida de IA');
  }

  console.log('\n== emendas: nº arredondado é dito por estado, e na tela ==');
  {
    const XLSX = require(path.join(RAIZ, 'libs', 'xlsx.full.min.js'));
    const src = fs.readFileSync(path.join(RAIZ, 'emendas.js'), 'utf8');
    const trecho = re => src.match(re)[0];
    const mod = new Function('XLSX', `
      ${trecho(/const _ufsNumeroArredondado[\s\S]*?\n}/)}
      ${trecho(/function numeroArredondadoEm\([^\n]*\n?/)}
      return { numeroDaProposta, numeroArredondadoEm };
    `)(XLSX);

    mod.numeroDaProposta(36000765198202600, 'SP');
    mod.numeroDaProposta(36000765198202601, 'TO');
    ok(mod.numeroArredondadoEm('SP') && mod.numeroArredondadoEm('TO'),
       'as DUAS UFs afetadas ficam marcadas (antes, só a primeira era nomeada)');
    ok(!mod.numeroArredondadoEm('AC'), 'e a UF que veio como texto não é acusada');
    ok(mod.numeroDaProposta('36000765198202600', 'AC') === '36000765198202600', 'texto continua intacto');

    ok(/if \(numeroArredondadoEm\(uf\)\)[\s\S]{0,260}falhas\.push\(/.test(src),
       'a coleta leva o problema para `falhas` — que o toast e o log da coleta exibem');
    ok(/_ufsNumeroArredondado\.delete\(uf\)/.test(src),
       'e uma releitura do estado começa sem a marca da rodada anterior');
  }

  console.log('\n== cmo: prazo sem ano não vira data nem "encerrado" ==');
  {
    const cmo = require(path.join(RAIZ, 'cmo.js'));
    // O caso real que o comentário do módulo descreve, com o ano numa ponta.
    const comAno = cmo.itensDoCronograma(`Cronograma (publicado em 01/11/2024)
      5. Publicação do relatório preliminar de 06/12 (10h02) a 06/12/2024
      6. Apresentação de emendas ao relatório preliminar de 09/12/2024 a 11/12/2024`);
    const i5 = comAno.itens.find(i => i.ordem === 5);
    ok(!!i5 && i5.inicio === '06/12/2024', 'o ano continua sendo herdado da outra ponta');
    ok(!i5.dataIncompleta, 'e nesse caso nada é marcado como incompleto');

    // As duas pontas sem ano: antes entrava "06/12" como se fosse data.
    const semAno = cmo.itensDoCronograma(`Cronograma da Comissão
      5. Publicação do relatório preliminar de 06/12 (10h02) a 08/12 (18h)
      6. Apresentação de emendas ao relatório preliminar de 09/12/2024 a 11/12/2024`);
    const j5 = semAno.itens.find(i => i.ordem === 5);
    ok(!!j5, 'o item continua sendo lido — descartá-lo em silêncio é pior');
    ok(j5.dataIncompleta === true, 'mas vem marcado como data incompleta');
    ok(/não trouxe o ano/.test(j5.motivoData || ''), 'com o motivo por escrito');
    const j6 = semAno.itens.find(i => i.ordem === 6);
    ok(j6 && !j6.dataIncompleta, 'o item completo do mesmo cronograma segue limpo');

    // E a tela não conta dias de uma data sem ano.
    fichaLimpa();
    av(`estado.quadro = { ...__q, cronograma: { disponivel: true, publicadoEm: '', itens: [
          { ordem: 6, descricao: 'Apresentação de emendas ao projeto', inicio: '09/12', fim: '11/12',
            dataIncompleta: true, motivoData: 'o texto do cronograma não trouxe o ano em nenhuma das pontas do prazo', observacao: null }
        ], prazoEmendas: { ordem: 6, descricao: 'Apresentação de emendas ao projeto', inicio: '09/12', fim: '11/12',
            dataIncompleta: true, motivoData: 'o texto do cronograma não trouxe o ano em nenhuma das pontas do prazo' } } };
        render();`);
    const h = document.getElementById('on-corpo').innerHTML;
    ok(!/encerrado/.test(h), 'a tela NÃO declara o prazo encerrado por não saber contar os dias');
    ok(/não trouxe o ano deste prazo|data incompleta/.test(h), 'ela diz que a data está incompleta');
    ok(/confira a data no documento/.test(h), 'e manda conferir no documento');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
