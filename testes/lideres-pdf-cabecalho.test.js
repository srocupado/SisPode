// Reunião de Líderes · PDF com o cabeçalho das colunas em TODA página.
//
// 10/11/2026: o cabeçalho saía só na página 1. Causa: o Paged.js (que numerava
// as páginas) pagina sozinho e, ao partir a tabela, não repete o <thead> —
// MEDIDO numa reunião de 52 itens: cabeçalho só na página 1, 26 páginas. Na
// impressão nativa do Chrome o thead repete em toda página, o número sai pelo
// @page @bottom-center (Chrome 131+) e o mesmo documento cabe em 14 páginas.
//
// Este teste imprime o HTML do PDF no Chromium (Playwright) e confere cada
// página. Sem Playwright instalado, confere só o código e avisa.
// Uso: node testes/lideres-pdf-cabecalho.test.js
const fs = require('fs'), path = require('path'), os = require('os');
const { execSync } = require('child_process');
const fonte = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const sb = {
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {} }, window: {}, console, setTimeout, clearTimeout, DOMException: globalThis.DOMException,
  XLSX: undefined, AbortSignal, btoa: s => s, fetch: async () => ({ ok: false }),
};
const L = new Function(...Object.keys(sb), `${fonte}\n; return { _htmlImpressaoLideres };`)(...Object.values(sb));

(async () => {
  console.log('== o PDF não usa Paged.js (que não repete o cabeçalho) ==');
  const gerar = /async function gerarPDF\(\)[\s\S]*?\n\}/.exec(fonte)[0];
  ok(!/paged\.polyfill|PagedConfig/.test(gerar), 'gerarPDF imprime nativo, sem carregar o Paged.js');
  ok(/win\.print\(\)/.test(gerar), 'e chama a impressão do navegador');
  const html = L._htmlImpressaoLideres({ titulo: 'RL', itens: [] }, '');
  ok(/thead \{ display:table-header-group; \}/.test(html) && /@bottom-center \{ content: counter\(page\)/.test(html), 'cabeçalho como table-header-group e número pelo @page');

  let pw = null;
  try { pw = require('playwright'); } catch (_) { /* sem Playwright */ }
  if (!pw) {
    console.log('\n  ⏭ render pulado: Playwright não instalado (o restante foi conferido).');
  } else {
    console.log('\n== impresso no Chromium: cabeçalho e número em cada página ==');
    const txt = 'Texto de resumo para ocupar a linha da tabela como nos resumos reais da IA. '.repeat(5);
    const itens = Array.from({ length: 52 }, (_, i) => ({ numItem: String(i + 1), chave: `PL ${1000 + i}/2026`, autoriaPdf: 'Poder Executivo',
      objetivo: txt, justificativa: txt, comparativo: 'x', situacao: 's', apensacao: 'a', comissoes: '', relatoria: 'r', parecer: 'p' }));
    const arq = path.join(os.tmpdir(), `lideres-cab-${process.pid}.pdf`);
    const b = await pw.chromium.launch();
    const p = await b.newPage();
    await p.setContent(L._htmlImpressaoLideres({ titulo: 'RL 10/11', itens }, ''));
    await p.pdf({ path: arq, preferCSSPageSize: true, printBackground: true });
    await b.close();
    let n = 0;
    try { n = +execSync(`pdfinfo "${arq}"`).toString().match(/Pages:\s+(\d+)/)[1]; } catch (_) { /* sem poppler */ }
    if (!n) {
      console.log('  ⏭ conferência por página pulada: pdfinfo/pdftotext (poppler) não instalados.');
    } else {
      const semCab = [], semNum = [];
      for (let i = 1; i <= n; i++) {
        const t = execSync(`pdftotext -f ${i} -l ${i} -layout "${arq}" -`).toString();
        if (!/Nº\s+Proposição\s+Autoria\s+Objetivo/.test(t)) semCab.push(i);
        // o número fica no rodapé (faixa de baixo da página A4 paisagem)
        const rod = execSync(`pdftotext -f ${i} -l ${i} -x 0 -y 560 -W 842 -H 35 "${arq}" -`).toString();
        if (!new RegExp(`(^|\\s)${i}(\\s|$)`).test(rod)) semNum.push(i);
      }
      ok(n > 1, `a reunião de 52 itens ocupa ${n} páginas`);
      ok(!semCab.length, `cabeçalho das colunas em todas as ${n} páginas${semCab.length ? ' (faltou em ' + semCab.join(', ') + ')' : ''}`);
      ok(!semNum.length, `número da página no rodapé de todas${semNum.length ? ' (faltou em ' + semNum.join(', ') + ')' : ''}`);
    }
    fs.rmSync(arq, { force: true });
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
