// Prints de votação: o mesmo desenho no bot e na extensão.
//
// O bot manda no grupo o print de cada votação nominal encerrada e grava o
// placar em /bot/monitor_sessao/{evento}/prints/{item}; o Painel de Votação
// ("Prints da sessão") desenha o MESMO print com bot/src/imagem-svg.js.
// Uso: node testes/bot-prints.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const bancada = ['Ana Paula Leão', 'Bruno Ganem', 'Gilson Daniel', 'Nely Aquino', 'Rodrigo Gambale']
  .map((nome, i) => ({ nome, siglaUf: 'SP', siglaPartido: 'PODE', tipoVoto: ['Sim', 'Sim', 'Não', 'Abstenção', null][i], classe: ['sim', 'sim', 'nao', 'abstencao', 'ausente'][i] }));
const placar = {
  sigla: 'PODE', descricao: 'Votação da Urgência do PL 849/2025 & <outros>', data: '2026-10-28', hora: '16:40', orgao: 'PLEN',
  quorum: 451, global: { sim: 300, nao: 140, abstencao: 3, art17: 1, obstrucao: 7 },
  parcial: { sim: 2, nao: 1, abstencao: 1, art17: 0, obstrucao: 0, ausente: 1 },
  orientPartido: 'Sim', orientGoverno: 'Não', bancada, temVotos: true,
};

(async () => {
  console.log('== o desenho compartilhado ==');
  const S = require(path.join(RAIZ, 'bot', 'src', 'imagem-svg.js'));
  const r = S.svgVotacao(placar);
  ok(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1080"/.test(r.svg) && r.largura === 1080 && r.altura > 1000, `SVG de 1080 de largura (${r.largura} × ${r.altura})`);
  ok(/&amp; &lt;outros&gt;/.test(r.svg) && !/& <outros>/.test(r.svg), 'texto da Câmara escapado');
  ok(S.svgVotacao({ ...placar, orientPartido: '', orientGoverno: '' }).altura === r.altura - 120, 'sem orientações, o placar encolhe as duas faixas');
  ok(S.votoClass('Não') === 'nao' && S.votoClass('Obstrução') === 'obstrucao' && S.votoClass(null) === 'ausente', 'classe do voto');
  ok(require(path.join(RAIZ, 'bot', 'src', 'votacao.js')).votoClass === S.votoClass, 'votacao.js do bot usa a mesma classe do voto');

  // Na extensão (script clássico): um nome global só, sem vazar as funções internas.
  const janela = {};
  janela.self = janela;
  vm.createContext(janela);
  new vm.Script(fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'imagem-svg.js'), 'utf8')).runInContext(janela);
  ok(janela.ImagemVotacao && typeof janela.ImagemVotacao.svgVotacao === 'function', 'no navegador: window.ImagemVotacao');
  ok(!('votoClass' in janela) && !('COR' in janela), 'sem vazar votoClass/COR (o votacao.js da extensão tem votoClass próprio)');
  ok(janela.ImagemVotacao.svgVotacao(placar).svg === r.svg, 'mesmo SVG no navegador e no Node');

  console.log('\n== o PNG do bot ==');
  const png = await require(path.join(RAIZ, 'bot', 'src', 'imagem.js')).imagemVotacao(placar);
  ok(png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 2160, `PNG em 2× (${png.readUInt32BE(16)} px de largura, ${Math.round(png.length / 1024)} KB)`);

  console.log('\n== o que o bot grava no Firebase ==');
  const mon = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'monitor.js'), 'utf8');
  const placarDoPrint = new Function(mon.match(/function placarDoPrint\([\s\S]*?\n}/)[0] + '; return placarDoPrint;')();
  const gravado = placarDoPrint(placar);
  ok(!('temVotos' in gravado) && !('tipoVoto' in gravado.bancada[0]) && !('siglaPartido' in gravado.bancada[0]), 'só o que o desenho usa');
  ok(S.svgVotacao(gravado).svg === r.svg, 'o placar gravado desenha o mesmo print');
  const grande = placarDoPrint({ ...placar, bancada: Array.from({ length: 30 }, (_, i) => ({ ...bancada[0], nome: 'Deputado Fulano de Tal ' + i })) });
  ok(JSON.stringify(grande).length < 5000, `poucos KB por print (bancada de 30: ${JSON.stringify(grande).length} bytes; o PNG tem ~${Math.round(png.length / 1024)} KB)`);
  ok(/\[`prints\/\$\{item\.id\}`\]: \{ ts: Date\.now\(\), legenda: legenda \|\| '', placar: placarDoPrint\(placar\) \}/.test(mon),
     'o monitor grava o print junto com a marca de encerramento');

  console.log('\n== a extensão lê o que o Firebase devolve ==');
  const ext = fs.readFileSync(path.join(RAIZ, 'votacao-prints.js'), 'utf8');
  const printsNormalizar = new Function(ext.match(/function printsNormalizar\([\s\S]*?\n}/)[0] + '; return printsNormalizar;')();
  // O Firebase não guarda lista vazia nem chave com valor nulo.
  const doFirebase = JSON.parse(JSON.stringify({ ...gravado, bancada: undefined, global: { sim: 300, nao: 140 }, parcial: {} }));
  const n = printsNormalizar(doFirebase);
  ok(Array.isArray(n.bancada) && n.bancada.length === 0 && n.global.obstrucao === 0 && n.parcial.ausente === 0, 'bancada vazia e contagens ausentes viram [] e 0');
  let desenhou = true;
  try { S.svgVotacao(n); } catch (e) { desenhou = false; }
  ok(desenhou, 'e o desenho não quebra');
  const html = fs.readFileSync(path.join(RAIZ, 'votacao.html'), 'utf8');
  ok(html.indexOf('src="bot/src/imagem-svg.js"') > html.indexOf('src="votacao.js"') && html.indexOf('src="votacao-prints.js"') > html.indexOf('src="bot/src/imagem-svg.js"'),
     'o Painel de Votação carrega o desenho do bot e depois a aba');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
