// Tela de notas orçamentárias com o produto 4 (números do exercício), num
// quadro SINTÉTICO — sem rede.
//
// O teste de fumaça da tela (orcamento-tela.test.js) carrega o quadro REAL da
// LOA 2026, e é assim que tem de ser. Mas ele cai inteiro quando o Senado sai
// do ar — e foi exatamente numa dessas quedas (03/09/2026) que este produto
// foi escrito. Este teste monta a página como o navegador monta (mesmo
// harness) sobre um PLOA recém-chegado inventado: só a matéria, um
// informativo das Consultorias e a Mensagem dentro do PDF. É o estágio em que
// a nota mais precisa dizer alguma coisa e menos tem de onde tirar.
//
// O que se trava: o card dos números e os dois botões; a guarda de chave
// ANTES de qualquer confirm; o texto do confirm nomeando as fontes; o estado
// com números apurados (número com página, recusado com motivo, achado, modo
// de leitura declarado); a proposta de ficha vinda da Mensagem e o aceite; e
// a nota com os números na frente do prazo.
//
// Uso: node testes/orcamento-numeros-tela.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
let falhas = 0; const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const html = fs.readFileSync(path.join(RAIZ, 'orcamento-notas.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window } = parseHTML(html);
const protoSelect = Object.getPrototypeOf(document.createElement('select'));
Object.defineProperty(protoSelect, 'value', { configurable: true, get() { return this.__valor ?? (this.querySelector('option')?.getAttribute('value') ?? ''); }, set(v) { this.__valor = v; } });
const confirms = []; const toasts = [];
const ctx = { document, window, DOMParser, console, setTimeout, clearTimeout, fetch: async () => ({ ok: false, status: 599 }), URL, TextDecoder, AbortController, DOMException,
  btoa: s => Buffer.from(s, 'latin1').toString('base64'),
  chrome: { storage: { local: { get: (_k, cb) => cb({ config: {} }), set: (o, cb) => cb && cb() } }, runtime: { getURL: p => p } },
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) },
  alert: () => {}, confirm: q => { confirms.push(q); return false; }, prompt: () => null };
ctx.globalThis = ctx; vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
ctx.__q = {
  tipo: 'loa', anoOrcamento: '2027', fontesIndisponiveis: [],
  materia: { disponivel: true, identificacao: 'PLN 24/2026', apelido: 'PLOA 2027', ementa: 'Estima a receita e fixa a despesa da União para 2027.', autoria: 'Presidência da República', dataApresentacao: '2026-08-31', situacaoAtual: 'AGUARDANDO DESPACHO', urlDocumento: 'https://legis/pln24' },
  acompanhamento: { disponivel: true, etapas: [{ nome: 'Recebimento', estado: 'Em andamento' }], documentos: [], documentosOmitidos: 0, relatoriosSetoriais: [], distribuicaoBancadas: [] },
  cronograma: { disponivel: false, motivo: 'A CMO ainda não publicou o cronograma.' },
  relatores: { disponivel: true, presidenteCMO: null, relatorGeral: null, relatorReceita: null, setoriais: [] },
  emendas: { disponivel: false, motivo: 'ainda não' },
  notas: { disponivel: true, notas: [{ data: '16/09/2026', titulo: 'Informativo Conjunto LOA 2027 - PLN 24/2026', url: 'https://cn/inf27' }] },
  executivo: { disponivel: false, motivo: 'x' },
};
av(`estado.tipo='loa'; estado.ano='2027'; estado.quadro=__q; estado.ficha=fichaVazia('loa','2027'); estado.serie=montarSerie([]); estado.ia={acoes:{},sintese:null}; estado.config={};`);
let erro = null; try { av('render()'); } catch (e) { erro = e; }
ok(!erro, erro ? 'render quebrou: ' + erro.stack : 'render com quadro sintético (sem numeros no estado.ia)');
let h = document.getElementById('on-corpo').innerHTML;
ok(/Números do exercício/.test(h) && /Apurar números com IA/.test(h) && /Apurar tudo e redigir/.test(h), 'card dos números com os dois botões');
ok(/Ler parâmetros da Mensagem/.test(h), 'a ficha oferece ler os parâmetros macroeconômicos da Mensagem, sem IA');
ok(/Informativo Conjunto LOA 2027/.test(h) && /Mensagem Presidencial \(PLN 24\/2026\)/.test(h), 'as fontes localizadas são listadas');
const f = av('fontesDeNumeros(estado.quadro)');
ok(f.map(x => x.classe).join() === 'informativo,mensagem', 'fontes: informativo, mensagem');
// sem chave: apurar abre o modal e não chama nada
(async () => {
  await av('apurarNumeros()');
  ok(document.getElementById('modal-configuracoes').style.display === 'flex', 'apurar sem chave abre as configurações');
  document.getElementById('modal-configuracoes').style.display = 'none';
  await av('apurarTudo()');
  ok(document.getElementById('modal-configuracoes').style.display === 'flex' && confirms.length === 0, 'apurar tudo sem chave abre as configurações antes de qualquer confirm');
  // com chave e confirm=false: nada roda
  av(`estado.config={provedor:'gemini',apiKey:'chave-de-teste-longa-o-bastante',modelo:'m'}`);
  await av('apurarNumeros()');
  ok(confirms.length === 1 && /Ler 2 documento\(s\) com IA/.test(confirms[0]) && /Informativo Conjunto/.test(confirms[0]), 'com chave, pede confirmação nomeando as fontes: ' + confirms[0].split('\n')[0]);
  await av('apurarTudo()');
  ok(confirms.length === 2 && /apurar os números em 2 fonte\(s\)/.test(confirms[1]) && /redigir a síntese/.test(confirms[1]), 'apurar tudo descreve os passos: ' + confirms[1].slice(0, 120));
  // estado com números apurados
  av(`estado.ia.numeros = { [chaveDocumento('https://legis/pln24')]: { url:'https://legis/pln24', rotulo:'Mensagem Presidencial (PLN 24/2026)', modoLeitura:'texto', motivoModo:'a Mensagem está dentro do PDF do projeto (3.235 páginas); foram lidas as 45 páginas mais relevantes.', conferido:true,
    apurados:[{chave:'salario_minimo',rotulo:'Salário mínimo',grupo:'Parâmetros macroeconômicos',ficha:'salario_minimo',valor:'R$ 1.741,00',exercicio:'2027',pagina:'128',trecho:'t'},{chave:null,rotulo:'Bolsa Família',grupo:'Outros números',ficha:null,valor:'157.062,2',pagina:'129',trecho:'t'}],
    achados:[{tema:'Reserva',afirmacao:'O projeto deve conter reservas para emendas individuais e de bancada.',pagina:'129',trecho:'t'}],
    recusados:[{tipo:'indicador',chave:'pib',valor:'2,5%',motivo:'o valor "2,5%" não aparece dentro do trecho citado'}] } };
    estado.propostas=null; proporFichaDosNumeros(); render();`);
  h = document.getElementById('on-corpo').innerHTML;
  ok(/R\$ 1\.741,00/.test(h) && /p\. 128/.test(h) && /Ler as 1 fonte\(s\) que faltam/.test(h), 'número com página; botão passa a "ler as que faltam"');
  ok(/1 item\(ns\) descartado\(s\)/.test(h) && /2,5%/.test(h), 'recusado com motivo');
  ok(/Destaques apontados nas fontes/.test(h) && /45 páginas mais relevantes/.test(h), 'achados e o modo de leitura degradado declarado');
  ok(av('estado.propostas.aceitas.length') === 1 && av("estado.propostas.aceitas[0].documento") === 'Mensagem Presidencial (PLN 24/2026)', 'proposta de ficha com o documento certo');
  ok(/Propostas de preenchimento/.test(h) && /aceitar<\/a>/.test(h), 'card de propostas oferece o aceite');
  av("aceitarProposta('salario_minimo')");
  ok(av("estado.ficha.valores.salario_minimo.valor") === 'R$ 1.741,00' && av("estado.ficha.valores.salario_minimo.documento") === 'Mensagem Presidencial (PLN 24/2026)' && av("estado.ficha.valores.salario_minimo.pagina") === '128', 'aceitar grava valor, documento e página na ficha');
  const nota = av('htmlNota(estado.quadro, null, estado.ficha, estado.serie, null, estado.ia)');
  const txt = nota.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok(/Números do exercício/.test(txt) && /R\$ 1\.741,00/.test(txt) && /Bolsa Família/.test(txt) && !/2,5%/.test(txt), 'a nota traz os números conferidos e não o recusado');
  ok(/Destaques registrados nas fontes/.test(txt) && /Parâmetros do exercício/.test(txt), 'com destaques e a ficha alimentada');
  ok(nota.indexOf('<h2>Números do exercício') < nota.indexOf('<h2>Prazo de emendas'), 'a seção dos números vem antes da seção do prazo (ordem é conteúdo)');
  ok(/class="cartoes"/.test(nota) && /cartao-valor">R\$ 1\.741,00/.test(nota) && /Prazo de emendas<\/div><div class="cartao-valor">não fixado/.test(nota),
     'a primeira dobra tem os cartões de destaque: salário mínimo apurado e o prazo, que diz "não fixado" quando não há cronograma');
  ok(/id="btn-pdf"/.test(nota) && /Salvar em PDF/.test(nota), 'a nota traz o botão de salvar em PDF');
  ok(/class="passos"/.test(nota) && /passo--andamento/.test(nota), 'as etapas viram passos, com o estado escrito ao lado da cor');
  // a leitura é automática: ao abrir com a ficha vazia e o PDF do projeto, ela roda sozinha
  ok(av("precisaLerParametros(estado.quadro, fichaVazia('loa', '2027'))") === true, 'ficha vazia + PDF do projeto → a leitura automática dispara');
  ok(av("precisaLerParametros({ materia: { disponivel: false } }, fichaVazia('loa', '2027'))") === false, 'sem matéria, não');
  ok(av("(() => { const f = fichaVazia('loa','2027'); f.leituraMensagem = { em: 'x', encontrados: [], faltando: ['pib'] }; return precisaLerParametros(estado.quadro, f); })()") === false,
     'Mensagem já lida neste exercício (marca na ficha compartilhada) → não baixa de novo o PDF de 27 MB');
  ok(av("(() => { const f = fichaVazia('loa','2027'); ['pib','ipca','selic','cambio','salario_minimo','reserva_emendas_total'].forEach(c => preencherCampo(f, c, { valor: '1', documento: 'd' })); return precisaLerParametros(estado.quadro, f); })()") === false,
     'todos os campos da Mensagem preenchidos → nada a ler');

  // parâmetros macroeconômicos lidos da Mensagem entram na ficha, com procedência
  const fxMsg = fs.readFileSync(path.join(RAIZ, 'testes', 'fixtures', 'mensagem-ploa2027-paginas.txt'), 'utf8');
  const partes = fxMsg.split(/\[\[PAGINA (\d+)\]\]/);
  ctx.__pags = []; for (let i = 1; i < partes.length; i += 2) ctx.__pags.push({ numero: +partes[i], texto: partes[i + 1] });
  av(`estado.ficha = fichaVazia('loa', '2027'); preencherCampo(estado.ficha, 'ipca', { valor: '4,0%', documento: 'preenchido à mão' });`);
  h = document.getElementById('on-corpo').innerHTML;
  await av('aplicarParametrosDaMensagem(__pags)');
  ok(av("estado.ficha.valores.salario_minimo.valor") === 'R$ 1.741,00' && av("estado.ficha.valores.pib.valor") === '2,5%' && av("estado.ficha.valores.selic.valor") === '12,53%' && av("estado.ficha.valores.cambio.valor") === 'R$/US$ 5,22',
     'PIB, Selic, câmbio e salário mínimo entram na ficha a partir da Mensagem');
  ok(av("estado.ficha.valores.ipca.valor") === '4,0%' && av("estado.ficha.valores.ipca.documento") === 'preenchido à mão', 'o campo já preenchido pelo analista NÃO é sobrescrito');
  ok(av("estado.ficha.valores.salario_minimo.documento") === 'Mensagem Presidencial (PLN 24/2026)' && av("estado.ficha.valores.salario_minimo.pagina") === '128' && /estimado em R\$ 1\.741,00/.test(av("estado.ficha.valores.salario_minimo.trecho")),
     'com documento, página e trecho literal — a mesma procedência do preenchimento manual');
  ok(av("estado.ficha.valores.pib.conferencia.localizado") === true, 'e já conferido, porque o trecho é o do próprio documento');
  ok(av("estado.ficha.leituraMensagem.encontrados.length") === 5 && av("precisaLerParametros(estado.quadro, estado.ficha)") === false,
     'a ficha guarda a marca da leitura, e a automática não repete');
  av('render()'); h = document.getElementById('on-corpo').innerHTML;
  ok(!/>Ler parâmetros da Mensagem</.test(h), 'depois da leitura o botão de primeira leitura some (o campo pendente que restar oferece "Reler")');
  ok(/R\$\/US\$ 5,22/.test(h) && /R\$ 1\.741,00/.test(h), 'a ficha na tela mostra os valores lidos');

  // prompt da síntese com os números
  const p = av("promptSintese({ numeros: numerosApurados(estado.ia, estado.quadro), achados: achadosApurados(estado.ia), ficha: estado.ficha, quadro: estado.quadro, pendencias: pendenciasDo(estado.quadro) })");
  ok(/Salário mínimo: R\$ 1\.741,00 \(2027\)/.test(p) && /Bolsa Família: 157\.062,2/.test(p) && /Reserva: O projeto deve conter/.test(p), 'o prompt da síntese recebe números e achados');
  // gerarNota sem window.open não roda aqui; só a guarda de aviso
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO', e); process.exit(1); });
