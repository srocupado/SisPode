// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Destaques do PLP 299/2026 (23/11/2026): o texto do dispositivo destacado.
//
// "DVS do §5º, do Art. 5º da Lei Complementar nº 200 de 2023, que consta do Art 1º" e "DVS do Art. 6º-F" saíam
// com "não encontrado no texto do substitutivo": o módulo lia o PRLP 1 do relator — que aprova o texto do Senado
// SEM EMENDAS, sem substitutivo — como se fosse o substitutivo; e reduzia "Art. 6º-F" a "Artigo 6".
// Quando o parecer de Plenário traz substitutivo, a Câmara registra "SBT n" com o MESMO codteor do PRLP
// (PL 2475/2025: PRLP 2 e SBT 1 → 3193619). PRLP sem SBT é parecer sem texto normativo.
//
// Uso: node testes/destaque-texto-em-votacao.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const HTML = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8');
const FONTE = ['pauta-parser.js', 'mpv.js', 'panel.js'].map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');

let paginaPareceres = '';
const pedidos = [];
const pdf = url => ({ ok: true, status: 200, url, headers: { get: h => (/content-type/i.test(h) ? 'application/pdf' : null) }, arrayBuffer: async () => new ArrayBuffer(64), clone() { return this; }, text: async () => '' });
const html = (url, corpo) => ({ ok: true, status: 200, url, headers: { get: h => (/content-type/i.test(h) ? 'text/html' : null) }, text: async () => corpo, clone() { return this; }, arrayBuffer: async () => Buffer.from(corpo) });

const { document, window, Event } = parseHTML(HTML);
const ctx = {
  document, window, DOMParser, Event,
  console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {}, info: () => {} },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  fetch: async url => {
    const u = String(url); pedidos.push(u);
    if (/prop_pareceres_substitutivos_votos/.test(u)) return html(u, paginaPareceres);
    if (/prop_mostrarintegra|destaque\.pdf/.test(u)) return pdf(u);
    if (/\/proposicoes\/2655570$/.test(u)) return { ok: true, status: 200, json: async () => ({ dados: { urlInteiroTeor: 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3198000' } }) };
    if (/\/proposicoes\?siglaTipo=PLP&numero=299&ano=2026/.test(u)) return { ok: true, status: 200, json: async () => ({ dados: [{ id: 2655570, ementa: 'Altera a Lei Complementar nº?200, de 30 de agosto de 2023, a Lei nº?11.540, e a Lei Complementar nº? 224.' }] }) };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '', headers: { get: () => null } };
  },
  URL, TextDecoder, AbortController, DOMException,
  btoa: s => Buffer.from(s, 'latin1').toString('base64'),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '4.0.0' }), reload: () => {} }, tabs: { create: () => {} } },
  pdfjsLib: { GlobalWorkerOptions: {} }, alert: () => {}, confirm: () => false, prompt: () => null, docx: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(FONTE, ctx, { filename: 'painel.js' });
const av = e => vm.runInContext(e, ctx);

const prop = { chave: 'PLP 299/2026', sigla: 'PLP', numero: 299, ano: 2026, idCamara: 2655570 };
const ler = async desc => { pedidos.length = 0; ctx.__d = { numero: 'DTQ 1', descricao: desc, tipo: '161, I', urlLink: 'https://www.camara.leg.br/destaque.pdf' }; ctx.__p = prop; return av('buscarTextoEmenda(__d, __p)'); };
const SO_PRLP = '<html><body><table><tr><td><a href="prop_mostrarintegra?codteor=3199667&amp;filename=PRLP+1+%3D%3E+PLP+299/2026">PRLP 1</a></td></tr></table></body></html>';
const COM_SBT = '<html><body><table><tr><td><a href="prop_mostrarintegra?codteor=3199667&amp;filename=PRLP+1+%3D%3E+PLP+299/2026">PRLP 1</a></td></tr>'
  + '<tr><td><a href="prop_mostrarintegra?codteor=3199999&amp;filename=PRLP+2+%3D%3E+PLP+299/2026">PRLP 2</a></td></tr>'
  + '<tr><td><a href="prop_mostrarintegra?codteor=3199999&amp;filename=SBT+1+%3D%3E+PLP+299/2026">SBT 1</a></td></tr></table></body></html>';

(async () => {
  console.log('== DVS de dispositivo, parecer de Plenário SEM substitutivo (PLP 299/2026) ==');
  paginaPareceres = SO_PRLP;
  const i1 = await ler('Destaque para Votação em Separado do §5º, do Art. 5º da Lei Complementar nº 200 de 2023, que consta do Art 1º, apresentado ao PLP 299/2026');
  ok(i1 && i1.tipo === 'pl_original' && !pedidos.some(u => /codteor=3199667/.test(u)), `o PRLP sem SBT não é lido como substitutivo (tipo: ${i1 && i1.tipo})`);
  ok(i1 && /Artigo 1[°º] do texto em votação — que altera o § 5º do Artigo 5º da Lei Complementar nº 200\/2023/.test(i1.referenciaLeg), `"que consta do Art 1º" e a lei entram na referência: ${i1 && i1.referenciaLeg}`);
  const i2 = await ler('Destaque para Votação em Separado do(a) Art. 6º-F, apresentado ao PLP 299/2026');
  ok(i2 && i2.tipo === 'pl_original' && /^Artigo 6º-F$/.test(i2.referenciaLeg), `"Art. 6º-F" fica "Artigo 6º-F", não "Artigo 6" (${i2 && i2.referenciaLeg})`);

  console.log('\n== com substitutivo registrado (SBT com o codteor do PRLP) ==');
  paginaPareceres = COM_SBT;
  const i3 = await ler('Destaque para Votação em Separado do(a) Art. 6º-F, apresentado ao PLP 299/2026');
  ok(i3 && i3.tipo === 'substitutivo' && pedidos.some(u => /codteor=3199999/.test(u)), `havendo SBT, ele é o substitutivo lido (tipo: ${i3 && i3.tipo})`);

  console.log('\n== ementa da Câmara com "?" no lugar do espaço depois de "nº" ==');
  const pa = await av(`buscarProposicaoAPI('PLP', 299, 2026)`);
  ok(pa && pa.ementa === 'Altera a Lei Complementar nº 200, de 30 de agosto de 2023, a Lei nº 11.540, e a Lei Complementar nº 224.', `ementa limpa: ${pa && pa.ementa}`);
  ok(av(`limparEmentaCamara('Requer urgência? Sim, 2 vezes')`) === 'Requer urgência? Sim, 2 vezes', 'interrogação de verdade não é mexida');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
