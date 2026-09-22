// Correções do lote 4 da varredura (15/09/2026) — parser da pauta, gravação do
// parecer, deflator do dossiê e validação de URL das fontes.
//
// Uso: node testes/correcoes-lote4.test.js
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { parseHTML, DOMParser } = require(path.join(RAIZ, 'bot/node_modules/linkedom'));
const P = require(path.join(RAIZ, 'pauta-parser.js'));
const D = require(path.join(RAIZ, 'dossie.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const siglas = r => (r.itens || []).map(i => `${i.sigla} ${i.numero}/${i.ano}`).join(' | ');

(async () => {
  console.log('== PDF sem acento não engole item da pauta ==');
  {
    // A extração de PDF frequentemente perde crase, til e cedilha conforme a
    // fonte embutida. Antes, o cabeçalho sem acento não casava e o item era
    // importado sem ninguém ver falta.
    const linhas = [
      'ORDEM DO DIA',
      'PROPOSTA DE EMENDA A CONSTITUICAO Nº 45, DE 2019', 'Altera o Sistema Tributário Nacional.',
      'PROJETO DE LEI COMPLEMENTAR Nº 74, DE 2026', 'Dispõe sobre finanças públicas.',
      'MEDIDA PROVISORIA Nº 1357, DE 2026', 'Altera a tributação de remessas.',
      'MENSAGEM Nº 85, DE 2023', 'Convenção da OIT.',
      'PROJETO DE DECRETO LEGISLATIVO Nº 10, DE 2025', 'Susta ato do Executivo.',
    ].join('\n');
    const semAcento = siglas(P.parsearPauta(linhas));
    const comAcento = siglas(P.parsearPauta(linhas
      .replace('EMENDA A CONSTITUICAO', 'EMENDA À CONSTITUIÇÃO')
      .replace('MEDIDA PROVISORIA', 'MEDIDA PROVISÓRIA')));
    ok(/PEC 45\/2019/.test(semAcento), `a emenda constitucional entra mesmo sem crase e cedilha (${semAcento})`);
    ok(/MPV 1357\/2026/.test(semAcento), 'a medida provisória entra mesmo sem o acento agudo');
    ok(semAcento === comAcento, 'a pauta sai idêntica com e sem acentuação no PDF');
    ok(/MSC 85\/2023/.test(semAcento) && /PDL 10\/2025/.test(semAcento), 'os tipos sem acento continuam entrando');
  }

  console.log('\n== tipo por extenso sem acento não vira "PL" ==');
  {
    const rf = ['1. Redação Final ao Projeto de Lei Complementar nº 74, de 2026, do Sr. Fulano, que dispõe sobre finanças.',
      '2. Redação Final a Proposta de Emenda a Constituicao nº 45, de 2019, do Sr. Beltrano, que altera o sistema tributário.'].join('\n');
    const r = siglas(P.parsearPauta(rf));
    ok(/PLP 74\/2026/.test(r), `redação final de lei complementar mantém a sigla certa (${r})`);
    ok(!/PL 45\/2019/.test(r), 'e a emenda constitucional sem acento não entra como projeto de lei');
  }

  console.log('\n== mensagem do Executivo é reconhecida no dashboard compacto ==');
  {
    const compacto = ['Pauta 15/09/2026',
      '1 MSC 85/2023 [123] Pronta para Pauta', 'AUTOR: Poder Executivo', 'EMENTA: Convenção sobre trabalho.',
      '2 PL 1625/2026 [124] Pronta para Pauta', 'AUTOR: Dep. Fulano', 'EMENTA: Dispõe sobre algo.'].join('\n');
    const r = siglas(P.parsearPauta(compacto));
    ok(/MSC 85\/2023/.test(r), `a mensagem entra na importação (${r})`);
    ok(/PL 1625\/2026/.test(r), 'e os demais itens seguem entrando');
  }

  console.log('\n== média a preços de hoje não mistura mês sem índice ==');
  {
    const serie = [
      { mes: '2026-01', valor: 100 }, { mes: '2026-02', valor: 100 }, { mes: '2026-03', valor: 100 },
      { mes: '2026-04', valor: 100 }, { mes: '2026-05', valor: 100 }, { mes: '2026-06', valor: 100 },
    ];
    const completo = { '2026-01': 1.05, '2026-02': 1.04, '2026-03': 1.03, '2026-04': 1.02, '2026-05': 1.01, '2026-06': 1.00 };
    const comTudo = D.janelas(serie, '2026-04-01', { meses: 3, deflator: completo });
    ok(comTudo.antes.mediaReal > 100, `com todos os fatores, a média real é calculada (${comTudo.antes.mediaReal.toFixed(2)})`);
    const faltando = { ...completo }; delete faltando['2026-02'];
    const comFalta = D.janelas(serie, '2026-04-01', { meses: 3, deflator: faltando });
    ok(comFalta.antes.mediaReal === null, 'faltando o índice de um mês, a média real não é apresentada');
    ok(Array.isArray(comFalta.antes.semDeflator) && comFalta.antes.semDeflator.includes('2026-02'),
      `e a janela registra qual mês ficou sem índice (${JSON.stringify(comFalta.antes.semDeflator)})`);
    ok(comFalta.antes.media === 100, 'a média nominal continua sendo calculada normalmente');
  }

  console.log('\n== URL de fonte com caractere inválido não entra no parecer ==');
  {
    const re = /^https?:\/\/[^\s"'<>()[\]{}|\\^`]+$/i;
    ok(re.test('https://www.oecd.org/tax/relatorio-2024.pdf'), 'URL normal passa');
    ok(re.test('https://legis.senado.leg.br/norma/12345?ano=2026&x=1'), 'URL com parâmetros passa');
    ok(!re.test('https://example.com"'), 'URL com aspas é recusada');
    ok(!re.test('https://example.com<script>'), 'URL com sinal de menor é recusada');
    const fonte = fs.readFileSync(path.join(RAIZ, 'pipeline-parecer.js'), 'utf8');
    ok(!/\^https\?:\\\/\\\/\\S\+\$/.test(fonte), 'o pipeline não usa mais o padrão frouxo');
  }

  console.log('\n== falha ao salvar o parecer não passa por sucesso ==');
  {
    const fonteHtml = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8');
    const scripts = [...fonteHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
    const { document, window } = parseHTML(fonteHtml);
    const ctx = {
      document, window, DOMParser, console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
      fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
      URL, TextDecoder, AbortController, DOMException, Event, Buffer,
      btoa: s => Buffer.from(s, 'latin1').toString('base64'),
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => p, getManifest: () => ({ version: '0' }) }, tabs: { create: () => {} } },
      pdfjsLib: { GlobalWorkerOptions: {} }, Quill: function () {}, docx: {}, html2canvas: () => {},
      XLSX: { read: () => ({ SheetNames: [], Sheets: {} }), utils: {} },
      alert: () => {}, confirm: () => true, prompt: () => null,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n'), { filename: 'analise-pagina.js' }).runInContext(ctx);
    const av = e => vm.runInContext(e, ctx);

    // o trecho que grava: PUT que devolve 500 tem de virar aviso ao analista
    const fonte = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
    ok(!/PARECER_PATH\(chaveParecer\(it\)\), \{[\s\S]{0,200}\}\)\.catch\(e => console\.warn/.test(fonte),
      'a gravação do parecer não termina mais em catch que só escreve no console');
    ok(/NÃO foi salvo no Firebase/.test(fonte), 'e existe aviso explícito de que o parecer não foi salvo');
    ok(/exporte o PDF agora/.test(fonte), 'com instrução do que fazer para não perder o trabalho');
    ok(av('typeof chaveParecer') === 'function' && av('typeof PARECER_PATH') === 'function',
      'a página segue carregando com as funções de caminho do parecer');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
