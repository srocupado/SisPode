// Reunião de Líderes · leitura do PDF com número de colunas VARIÁVEL e
// conferência por IA do que a leitura não entregar.
//
// 10/11/2026: a lista passou de 5 para 8 colunas (… Descrição · Relator ·
// Parecer · Solicitações de Pauta) e o número do item ficou centralizado na
// vertical, numa linha sem proposição. O parser elegia a grade errada e o PDF
// virava "nenhuma proposição encontrada".
//
// O PDF real não fica no repositório (documento de trabalho da Liderança):
// aqui as páginas são montadas no formato que o pdf.js entrega
// ({ str, transform: [.., .., .., .., x, y] }), com as posições MEDIDAS nas
// duas listas — a de 5 colunas (grade 38 · 66 · 129 · 256 · 333) e a de 8
// (conteúdo em 38 · 133 · 179 · 234 · 323 · 520 · 656 · 715; títulos
// centralizados em 72 · 133 · 189 · 262 · 401 · 571 · 668 · 721).
// Para conferir um PDF real: node testes/lideres.test.js <lista.pdf>.
// Uso: node testes/lideres-pdf-colunas.test.js
const fs = require('fs'), path = require('path');
const fonte = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

let respostaIA = '[]', pedidosIA = 0, promptIA = '';
const sandbox = {
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(PDF_ATUAL) }) },
  window: {}, console, setTimeout, clearTimeout, DOMException: globalThis.DOMException, XLSX: undefined,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  fetch: async (url, init) => {
    pedidosIA++; promptIA = JSON.parse(init.body).contents[0].parts[0].text;
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: respostaIA }] } }] }) };
  },
};
let PDF_ATUAL = null;
const L = new Function(...Object.keys(sandbox), `${fonte}\n; return { lerListaDoPDF, proposicoesDoItem, conferirLeitura, itensAConferir, recuperarComIA, detectarColunas, app };`)(...Object.values(sandbox));

const it = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], hasEOL: true });
const pdfDe = paginas => ({ numPages: paginas.length, getPage: async p => ({ getTextContent: async () => ({ items: paginas[p - 1] }) }) });
const ler = paginas => { PDF_ATUAL = pdfDe(paginas); return L.lerListaDoPDF({ arrayBuffer: async () => new ArrayBuffer(8) }); };

// ---------- lista de 5 colunas (formato até outubro) ----------
function pagina5() {
  const out = [it('REUNIÃO DE LÍDERES - 07/07/26', 38, 560), it('Num.', 38, 540), it('Proposição', 66, 540), it('Autoria', 129, 540), it('Regime', 256, 540), it('Descrição', 333, 540)];
  let y = 520;
  for (let n = 1; n <= 6; n++) {
    out.push(it(String(n), 38, y), it(`PL ${100 + n}/2026`, 66, y), it(`Autor ${n}`, 129, y), it('Urgência aprovada', 256, y), it(`Institui a política ${n}, que`, 333, y));
    out.push(it('trata de outra coisa.', 333, y - 10), it('e outros', 129, y - 10));
    y -= 40;
  }
  return out;
}
// ---------- lista de 8 colunas (10/11/2026): número centralizado, linha só com o regime ----------
function pagina8(ini, fim, { semProp = [] } = {}) {
  const out = [it('Num.', 72, 556), it('Proposição', 133, 556), it('Autoria', 189, 556), it('Regime', 262, 556), it('Descrição', 401, 556),
    it('Relator', 571, 556), it('Parecer', 668, 556), it('Solicitações de Pauta', 721, 556)];
  let y = 530;
  for (let n = ini; n <= fim; n++) {
    if (!semProp.includes(n)) out.push(it('PL', 133, y));
    out.push(it('Poder', 179, y), it(`Altera a Lei nº ${n}, de 2020, para`, 323, y));
    out.push(it(String(n), 38, y - 10), it('.', 234, y - 10), it('dispor sobre o tema.', 323, y - 10), it('PRLP 1, em', 656, y - 10), it('Governo na CD', 715, y - 10));
    if (!semProp.includes(n)) out.push(it(`${5000 + n}/2026`, 133, y - 20));
    out.push(it('Executivo', 179, y - 20), it(`DESIGNAÇÃO: Dep. ${n} (PV-PR)`, 520, y - 20), it('08/07/2026', 656, y - 20));
    y -= 60;
  }
  for (let k = 0; k < 40; k++) out.push(it('continuação da descrição', 323, 40 + k * 0.01));   // a descrição é a coluna mais repetida, como no real
  return out;
}

(async () => {
  console.log('== lista de 5 colunas (o formato antigo continua lido) ==');
  const a = await ler([pagina5()]);
  ok(a.length === 6 && a.every((x, k) => x.num === String(k + 1)), `6 itens, numeração 1..6 (${a.length})`);
  ok(a[0].prop === 'PL 101/2026' && a[0].autoria === 'Autor 1 e outros' && a[0].regime === 'Urgência aprovada' && a[0].descricao === 'Institui a política 1, que trata de outra coisa.', 'colunas no lugar');
  ok(!Object.keys(a[0].extras).length && !L.conferirLeitura(a).length, 'sem colunas extras e sem pendência');

  console.log('\n== lista de 8 colunas (10/11/2026) ==');
  const b = await ler([pagina8(1, 5), pagina8(6, 9)]);
  ok(b.length === 9 && b.every((x, k) => x.num === String(k + 1)), `9 itens em 2 páginas, numeração 1..9 (lidos: ${b.map(x => x.num).join(',')})`);
  ok(b[0].prop === 'PL 5001/2026' && b[0].autoria === 'Poder Executivo' && b[0].regime === '.' && b[0].descricao === 'Altera a Lei nº 1, de 2020, para dispor sobre o tema.', 'número centralizado: proposição, autoria, regime e descrição do item certo');
  ok(b[1].extras.relator === 'DESIGNAÇÃO: Dep. 2 (PV-PR)' && b[1].extras.parecer === 'PRLP 1, em 08/07/2026' && b[1].extras.solicitacoes === 'Governo na CD', 'Relator, Parecer e Solicitações de Pauta vão para extras (nada vaza para a descrição)');
  ok(b.flatMap(x => L.proposicoesDoItem(x)).length === 9 && !L.conferirLeitura(b).length, '9 proposições, leitura conferida');

  console.log('\n== o que a leitura não entrega vira pendência e vai para a IA ==');
  const c = await ler([pagina8(1, 5, { semProp: [3, 4] })]);
  const conf = L.conferirLeitura(c);
  ok(conf.length === 1 && /3, 4/.test(conf[0]) && JSON.stringify(L.itensAConferir(c)) === '[3,4]', `itens sem proposição denunciados: ${conf[0]}`);
  // o texto do documento traz a proposição do item 3 (escrita noutro lugar da página), mas não a "inventada" do item 4
  PDF_ATUAL.getPage = (orig => async p => { const pg = await orig(p); const t = await pg.getTextContent(); t.items.push(it('Item 3: PL 5003/2026 — retirado da lista anterior', 323, 30)); return { getTextContent: async () => t }; })(PDF_ATUAL.getPage);
  const c2 = await L.lerListaDoPDF({ arrayBuffer: async () => new ArrayBuffer(8) });
  L.app.config.apiKey = 'chave-de-teste';
  respostaIA = JSON.stringify([
    { num: 3, proposicoes: ['PL 5003/2026'], autoria: 'Poder Executivo', regime: '.', descricao: 'x' },
    { num: 4, proposicoes: ['PL 9999/2026'], autoria: 'Inventado', regime: '', descricao: '' },   // não está no PDF
    { num: 7, proposicoes: ['PL 5001/2026'] },                                                      // item que não foi pedido
  ]);
  const r = await L.recuperarComIA(c2);
  ok(pedidosIA === 1 && /itens 3, 4/.test(promptIA) && /PL 5003\/2026/.test(promptIA), 'uma chamada, só com os itens pendentes e o texto do PDF');
  ok(JSON.stringify(r.recuperados) === '[3]' && JSON.stringify(r.pendentes) === '[4]', `IA lê o item 3; o 4 (proposição que não está escrita no PDF) fica pendente (${JSON.stringify(r)})`.slice(0, 160));
  const i3 = r.itens.find(x => x.num === '3');
  ok(i3.lidoPorIA && i3.prop === 'PL 5003/2026' && i3.descricao === 'Altera a Lei nº 3, de 2020, para dispor sobre o tema.', 'item 3 marcado como lido pela IA, mantendo o que a leitura por colunas já tinha');
  ok(!r.itens.some(x => /9999/.test(x.prop)) && r.itens.length === 5, 'nada inventado entra; item não pedido é ignorado');
  pedidosIA = 0;
  await L.recuperarComIA(b);
  ok(pedidosIA === 0, 'leitura completa não chama a IA');

  console.log('\n== formato irreconhecível: a IA lê a lista inteira ==');
  const d = await ler([[it('LISTA DE PROPOSIÇÕES', 300, 560), it('Item 1 — PL 7001/2026 (Fulano): cria o programa X.', 300, 540), it('Item 2 — PLP 12/2025 (Beltrana): altera a LC 101.', 300, 520)]]);
  ok(d.length === 0, 'leitura por colunas não entrega nada');
  pedidosIA = 0;
  respostaIA = JSON.stringify([{ num: 1, proposicoes: ['PL 7001/2026'], autoria: 'Fulano' }, { num: 2, proposicoes: ['PLP 12/2025'] }, { num: 3, proposicoes: ['PL 1/2026'] }]);
  const rd = await L.recuperarComIA(d);
  ok(pedidosIA === 1 && /não reconheceu o formato/.test(promptIA), 'pede a lista inteira');
  ok(JSON.stringify(rd.itens.map(x => x.prop)) === '["PL 7001/2026","PLP 12/2025"]' && rd.itens.every(x => x.lidoPorIA), `entram os itens escritos no PDF, marcados; o inventado (PL 1/2026) não (${rd.itens.map(x => x.prop).join(', ')})`);

  const src = fonte;
  ok(/\(itensAConferir\(itens\)\.length \|\| !itens\.length\) && app\.config\.apiKey/.test(src) && /lido\(s\) pela IA — confira/.test(src), 'o modal chama a IA só com pendência (ou nada lido) e chave, e avisa o que veio dela');
  ok(/const avisos = it\.lidoPorIA \? \[AVISO_LIDO_POR_IA\] : \[\];/.test(src), 'o aviso "lido pela IA" sobrevive ao resumo do item');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
