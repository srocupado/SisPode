// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Destaques do PLP 299/2026 (23/11/2026): o texto do dispositivo destacado.
//
// "DTQ 1 — §5º do Art. 5º da Lei Complementar nº 200 de 2023, que consta do Art 1º" e "DTQ 2 — Art. 6º-F" saíam
// com "não encontrado no texto do substitutivo". Quatro defeitos:
//   1. o PRLP 1 do relator — que aprova o texto do Senado SEM EMENDAS — era lido como "substitutivo";
//   2. sem substitutivo, o documento lido era o PDF do próprio destaque, que não traz o texto do dispositivo
//      (DTQ 1: uma página de pedido; DTQ 2: pedido e justificação);
//   3. "Art. 6º-F" virava "Artigo 6" e "que consta do Art 1º" não era reconhecido;
//   4. a ementa da Câmara vem com "?" no lugar do espaço depois de "nº".
// O texto em votação é o aprovado pelo Senado (Câmara como Casa revisora): o inteiro teor do PLP na Câmara.
// Documentos reais em testes/fixtures/destaques (trechos).
//
// Uso: node testes/destaque-texto-em-votacao.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'destaques');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const fx = n => fs.readFileSync(path.join(FX, n), 'utf8');

// PDFs pelo codteor: o "PDF" leva o codteor nos bytes, e o pdf.js de mentira devolve o texto do documento.
const PDFS = {
  3199667: fx('plp299-prlp1-final.txt'),                        // PRLP 1 do PLP 299: sem substitutivo
  3199234: fx('plp299-inteiro-teor-trecho.txt'),                // inteiro teor do PLP 299 (texto do Senado)
  3200770: fx('plp299-dtq1.txt'),                               // DTQ 1: só o pedido
  3200831: fx('plp299-dtq2.txt'),                               // DTQ 2: pedido e justificação
  3197480: fx('pl5229-prlp4-trechos.txt'),                      // PRLP 4 do PL 5229/2025: substitutivo dentro
  3132729: 'SUBSTITUTIVO AO PROJETO DE LEI Nº 4.822, DE 2025 Art. 1º Esta Lei altera…',   // SBT 1 do PL 4822
  3132666: 'Parecer… somos pela aprovação na forma do Substitutivo anexo. SUBSTITUTIVO AO PROJETO DE LEI Nº 4.822, DE 2025',
  3300001: 'PARECER DE PLENÁRIO PELA COMISSÃO DE CONSTITUIÇÃO E JUSTIÇA E DE CIDADANIA AO PROJETO DE LEI Nº 1, DE 2026. I - RELATÓRIO. '.repeat(3)
    + 'II - VOTO DO RELATOR. Ante o exposto, somos pela constitucionalidade, juridicidade e boa técnica legislativa e, no mérito, pela aprovação na forma do Substitutivo adotado pela Comissão de Saúde.', // PRLP que adota SBT de comissão
  3200000: 'SUBSTITUTIVO ADOTADO PELA COMISSÃO DE SAÚDE AO PROJETO DE LEI Nº 1, DE 2026 Art. 6º-F…',
};
let pagina = '';
const pedidos = [];
const pdfResp = (url, cod) => ({ ok: true, status: 200, url, headers: { get: h => (/content-type/i.test(h) ? 'application/pdf' : null) },
  arrayBuffer: async () => new TextEncoder().encode(`COD:${cod}`).buffer, clone() { return this; }, text: async () => '' });
const htmlResp = (url, corpo) => ({ ok: true, status: 200, url, headers: { get: h => (/content-type/i.test(h) ? 'text/html' : null) },
  text: async () => corpo, clone() { return this; }, arrayBuffer: async () => new TextEncoder().encode(corpo).buffer });
const pdfjsLib = {
  GlobalWorkerOptions: {},
  getDocument: ({ data }) => {
    const cod = (new TextDecoder().decode(data).match(/COD:(\d+)/) || [])[1];
    const linhas = String(PDFS[cod] || '').split('\n');
    return { promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: linhas.map((str, i) => ({ str, transform: [1, 0, 0, 1, 0, 800 - i * 12] })) }) }) }) };
  },
};

const { document, window, Event } = parseHTML(fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8'));
const ctx = {
  document, window, DOMParser, Event, pdfjsLib,
  console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {}, info: () => {} },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  fetch: async url => {
    const u = String(url); pedidos.push(u);
    if (/prop_pareceres_substitutivos_votos/.test(u)) return htmlResp(u, pagina);
    if (/prop_destaques\?idProposicao=2655570/.test(u)) return htmlResp(u, '<table><tr><td>Destaque</td><td>Data</td></tr>'
      + '<tr><td><a href="fichadetramitacao?idProposicao=2656731">DTQ 1 => PLP 299/2026</a></td><td>23/11/2026</td><td><a href="prop_mostrarintegra?codteor=3200770&amp;filename=DTQ+1">Inteiro teor</a></td></tr>'
      + '<tr><td><a href="fichadetramitacao?idProposicao=2656749">DTQ 2 => PLP 299/2026</a></td><td>23/11/2026</td><td><a href="prop_mostrarintegra?codteor=3200831&amp;filename=DTQ+2">Inteiro teor</a></td></tr></table>');
    const c = (u.match(/codteor=(\d+)/) || [])[1];
    if (c) return pdfResp(u, c);
    if (/\/proposicoes\/2655570$/.test(u)) return { ok: true, status: 200, json: async () => ({ dados: { urlInteiroTeor: 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3199234' } }) };
    if (/\/proposicoes\?siglaTipo=PLP&numero=299&ano=2026/.test(u)) return { ok: true, status: 200, json: async () => ({ dados: [{ id: 2655570, ementa: 'Altera a Lei Complementar nº?200, de 30 de agosto de 2023, a Lei nº?11.540, e a Lei Complementar nº? 224.' }] }) };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '', headers: { get: () => null } };
  },
  URL, TextDecoder, TextEncoder, AbortController, DOMException,
  btoa: s => Buffer.from(s, 'latin1').toString('base64'),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '4.0.0' }), reload: () => {} }, tabs: { create: () => {} } },
  alert: () => {}, confirm: () => false, prompt: () => null, docx: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(['pauta-parser.js', 'mpv.js', 'panel.js'].map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n'), ctx, { filename: 'painel.js' });
const av = e => vm.runInContext(e, ctx);

const PLP299 = { chave: 'PLP 299/2026', sigla: 'PLP', numero: 299, ano: 2026, idCamara: 2655570, autor: 'Senado Federal - Jaques Wagner', ementa: 'Altera a Lei Complementar nº 200…' };
const DTQ1 = { numero: 'DTQ 1', autoria: 'Fdr PSOL-REDE', tipo: '161, I', urlLink: 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3200770',
  descricao: 'Destaque para Votação em Separado do §5°, do Art. 5° da Lei Complementar n° 200 de 2023, que consta do Art 1°, apresentado ao PLP 299/2026' };
const DTQ2 = { numero: 'DTQ 2', autoria: 'AVANTE', tipo: '161, I', urlLink: 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3200831',
  descricao: 'Destaque para Votação em Separado do(a) Art. 6º-F, apresentado ao PLP 299/2026' };
const ler = async (d, prop) => { pedidos.length = 0; ctx.__d = d; ctx.__p = prop; return av('buscarTextoEmenda(__d, __p)'); };
const linha = (cod, nome) => `<tr><td><a href="prop_mostrarintegra?codteor=${cod}&amp;filename=${nome}+%3D%3E+PL">${nome}</a></td></tr>`;
const lidoComo = (info, cod) => info && (String(info.pdfBuffer ? new TextDecoder().decode(info.pdfBuffer) : '').includes(`COD:${cod}`));

(async () => {
  console.log('== PLP 299/2026: o relator aprova o texto do Senado sem emendas ==');
  pagina = `<table>${linha(3199667, 'PRLP+1')}</table>`;
  const i1 = await ler(DTQ1, PLP299);
  ok(lidoComo(i1, 3199234) && i1.tipo === 'pl_original' && i1.textoDoSenado === true, 'DTQ 1: o documento é o inteiro teor — o texto aprovado pelo Senado —, não o PRLP nem o PDF do destaque');
  ok(/Artigo 1[°º] do texto em votação — que altera o § 5º do Artigo 5º da Lei Complementar nº 200\/2023/.test(i1.referenciaLeg), `referência completa: ${i1.referenciaLeg}`);
  ok(!i1.textoDestaque || /destaque para votação em separado/i.test(i1.textoDestaque), 'o pedido do DTQ 1 (uma página) vai como texto auxiliar, se tiver conteúdo');
  const i2 = await ler(DTQ2, PLP299);
  ok(lidoComo(i2, 3199234) && i2.referenciaLeg === 'Artigo 6º-F', `DTQ 2: inteiro teor e "Artigo 6º-F" (${i2.referenciaLeg})`);
  ok(/empr[ée]stimo compuls[óo]rio/i.test(i2.textoDestaque || ''), 'a justificação do DTQ 2 vai junto, como texto auxiliar');
  ctx.__i2 = i2; ctx.__d2 = DTQ2; ctx.__p = PLP299;
  const pr = av('montarPrompt(__d2, __p, __i2)');
  ok(/TEXTO APROVADO PELO SENADO FEDERAL/.test(pr) && /TEXTO DO PRÓPRIO DESTAQUE/.test(pr) && /mantém o dispositivo no texto aprovado pelo Senado/.test(pr) && /nunca "substitutivo do relator"/.test(pr),
    'o prompt diz que o texto é o do Senado, traz a justificação à parte e não fala em substitutivo do relator');

  // a página que o módulo lê (pplen) não traz o link do PDF do destaque: ele vem de prop_destaques, pelo número
  const i2b = await ler({ ...DTQ2, urlLink: '' }, PLP299);
  ok(lidoComo(i2b, 3199234) && /empr[ée]stimo compuls[óo]rio/i.test(i2b.textoDestaque || '') && pedidos.some(u => /prop_destaques\?idProposicao=2655570/.test(u)) && pedidos.some(u => /codteor=3200831/.test(u)) && !pedidos.some(u => /codteor=3200770/.test(u)),
    'sem link na lista de destaques: o PDF do DTQ 2 (e não o do DTQ 1) é achado na página "Destaques" da proposição');

  console.log('\n== quando há substitutivo, ele é lido ==');
  pagina = `<table>${linha(3197480, 'PRLP+4')}</table>`;   // PL 5229/2025: substitutivo DENTRO do PRLP, sem "SBT" registrado
  const i3 = await ler(DTQ2, { ...PLP299, autor: 'Dep. Fulano' });
  ok(lidoComo(i3, 3197480) && i3.tipo === 'substitutivo', 'PRLP com "SUBSTITUTIVO AO PROJETO…" no PDF: é o substitutivo lido (PL 5229/2025)');
  pagina = `<table>${linha(3132666, 'PRLP+1')}${linha(3132729, 'SBT+1')}</table>`;   // PL 4822/2025: SBT em arquivo à parte
  const i4 = await ler(DTQ2, { ...PLP299, autor: 'Dep. Fulano' });
  ok(lidoComo(i4, 3132729) && i4.tipo === 'substitutivo', 'SBT mais recente que o PRLP: o SBT (PL 4822/2025)');
  pagina = `<table>${linha(3200000, 'SBT-A+1+CSAUDE')}${linha(3300001, 'PRLP+1')}</table>`;
  const i5 = await ler(DTQ2, { ...PLP299, autor: 'Dep. Fulano' });
  ok(lidoComo(i5, 3200000) && i5.tipo === 'substitutivo', 'PRLP que aprova "na forma do Substitutivo adotado pela Comissão": o SBT-A da comissão');

  console.log('\n== referência ==');
  const ref = async desc => (await ler({ ...DTQ2, descricao: desc, urlLink: '' }, PLP299)).referenciaLeg;
  ok(await ref('Destaque para Votação em Separado do art. 5º - a fim de suprimir, apresentado ao PL 1/2026') === 'Artigo 5º', '"art. 5º - a fim de" não vira "art. 5º-A"');
  ok(await ref('Destaque para Votação em Separado do art. 12 do Projeto de Lei nº 3278/2021') === 'Artigo 12', '"Projeto de Lei nº 3278/2021" é a proposição, não a lei alterada');
  ok(await ref('Destaque para Votação em Separado do art. 3º da Lei nº 9.430, de 27 de dezembro de 1996') === 'Artigo 3º da Lei nº 9.430/1996', 'data da lei por extenso');

  console.log('\n== ementa da Câmara com "?" depois de "nº" ==');
  const pa = await av(`buscarProposicaoAPI('PLP', 299, 2026)`);
  ok(pa && pa.ementa === 'Altera a Lei Complementar nº 200, de 30 de agosto de 2023, a Lei nº 11.540, e a Lei Complementar nº 224.', `ementa limpa: ${pa && pa.ementa}`);
  ok(av(`limparEmentaCamara('Requer urgência? Sim, 2 vezes. Art.?5º e §?2º')`) === 'Requer urgência? Sim, 2 vezes. Art. 5º e § 2º', 'só o "?" colado a um dígito; interrogação de verdade fica');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
