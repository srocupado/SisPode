// O voto SIM e o voto NÃO de um destaque saíam TROCADOS na análise da IA.
//
// O defeito (14/10/2026, PLP 281/2019, DTQ 4 e DTQ 6): o prompt dizia "Em DVS:
// SIM = aprova o destaque (suprime/altera o dispositivo destacado)". No
// Plenário da Câmara, o DVS de dispositivo do texto vota a MANUTENÇÃO do
// trecho destacado: SIM mantém, NÃO retira. A análise vinha com "SIM: suprime
// o art. 47" — o contrário do painel de votação.
//
// O que se trava aqui:
//   · DVS de dispositivo (substitutivo, PL original, PLV): SIM = mantém;
//   · destaque de emenda: SIM = aprova a emenda; preferência: SIM = prevalece o texto preferido;
//   · o prompt não traz mais a regra errada;
//   · resposta da IA que ainda venha trocada num DVS de dispositivo é destrocada.
//
// Uso: node testes/destaque-sentido.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const HTML = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8');
const FONTE = ['pauta-parser.js', 'mpv.js', 'panel.js']
  .map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');

function montarPainel() {
  const { document, window, Event } = parseHTML(HTML);
  const erros = [];
  const gravacoes = [];
  const ctx = {
    document, window, DOMParser, Event, erros, gravacoes,
    console: { log: () => {}, warn: () => {}, debug: () => {}, error: (...a) => erros.push(a.map(String).join(' ')) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async (url, opt) => { gravacoes.push({ url: String(url), metodo: opt?.method || 'GET' });
                                 return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; },
    URL, TextDecoder, AbortController, DOMException,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: {
      storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } },
      runtime: { getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '4.0.0' }), reload: () => {} },
      tabs: { create: () => {} },
    },
    pdfjsLib: { GlobalWorkerOptions: {} },
    alert: () => {}, confirm: () => false, prompt: () => null, docx: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx, { filename: 'painel.js' });
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const av = e => vm.runInContext(e, ctx);
  return { document, ctx, erros, gravacoes, av,
           clicar: sel => { const el = document.querySelector(sel); if (!el) return false;
                            el.dispatchEvent(new Event('click', { bubbles: true })); return true; } };
}


(async () => {
  const p = montarPainel();
  const av = p.av;
  console.log('Sentido do voto por tipo de destaque');
  const sent = (desc, tipo) => av(`sentidoDoVotoDestaque(${JSON.stringify({ descricao: desc })}, ${tipo ? JSON.stringify({ tipo }) : 'null'})`);
  ok(sent('Destaque para Votação em Separado do art. 47 do substitutivo, apresentado ao PLP 281/2019.', 'substitutivo') === 'manutencao', 'DVS do art. 47 do substitutivo → manutenção (o caso do PLP 281/2019)');
  ok(sent('Destaque para Votação em Separado do(a) parágrafo 3º do art. 8, apresentado ao PLP 281/2019', 'pl_original') === 'manutencao', 'DVS do § 3º do art. 8 → manutenção');
  ok(sent('Destaque para Votação em Separado do art. 5º', null) === 'manutencao', 'sem documento, dispositivo → manutenção');
  ok(sent('Destaque para Votação em Separado da Emenda nº 12', 'emenda') === 'emenda', 'destaque de emenda → aprova a emenda');
  ok(sent('Destaque para Votação em Separado da Emenda de Plenário nº 3', null) === 'emenda', 'sem documento, emenda → aprova a emenda');
  ok(sent('DVS do art. 9º da Emenda Substitutiva Global', null) === 'manutencao', 'dispositivo da emenda substitutiva global (o texto em votação) → manutenção');
  ok(sent('Destaque de preferência para o substitutivo da CCJC', 'destaque_preferencia') === 'preferencia', 'preferência → prevalece o texto preferido');

  console.log('Prompt');
  const prompt = av(`montarPrompt({ numero: 'DTQ 4', autoria: 'Fdr PSOL-REDE', descricao: 'Destaque para Votação em Separado do art. 47 do substitutivo', tipo: '161, I' },
                                 { chave: 'PLP-281-2019', ementa: 'Regimes de resolução' }, { tipo: 'substitutivo', textoCompleto: 'Art. 47. ...', referenciaLeg: 'art. 47' })`);
  ok(!/SIM = aprova o destaque/.test(prompt), 'a regra errada ("SIM = aprova o destaque, suprime") saiu do prompt');
  ok(/SIM = MANTÉM o dispositivo/.test(prompt) && /NÃO = RETIRA/.test(prompt), 'DVS de dispositivo: SIM mantém, NÃO retira');
  const pe = av(`montarPrompt({ numero: 'DVS 9', autoria: 'NOVO', descricao: 'Destaque para Votação em Separado da Emenda nº 44' }, { chave: 'PL 1/2026' }, { tipo: 'emenda', textoCompleto: 'Emenda 44' })`);
  ok(/SIM = APROVA a emenda/.test(pe) && /NÃO = REJEITA a emenda/.test(pe), 'destaque de emenda: SIM aprova, NÃO rejeita');

  console.log('Trava contra a inversão');
  const cor = (r, s) => av(`corrigirSentidoDoVoto(${JSON.stringify(r)}, ${JSON.stringify(s)})`);
  const r1 = cor({ votoSim: 'Suprime o artigo 47 do substitutivo, impedindo empréstimos', votoNao: 'Mantém o artigo 47, autorizando empréstimos', explicacao: 'x' }, 'manutencao');
  ok(/^Mantém o artigo 47/.test(r1.votoSim) && /^Suprime o artigo 47/.test(r1.votoNao) && r1.explicacao === 'x', 'DTQ 4 do PLP 281 (como saiu): destrocado — SIM mantém o art. 47');
  const r2 = cor({ votoSim: 'Suprime o poder da autoridade de resolução', votoNao: 'Mantém o poder da autoridade de resolução' }, 'manutencao');
  ok(/^Mantém/.test(r2.votoSim), 'DTQ 6 do PLP 281 (como saiu): destrocado');
  const r3 = cor({ votoSim: 'Mantém o art. 12', votoNao: 'Retira o art. 12' }, 'manutencao');
  ok(r3.votoSim === 'Mantém o art. 12' && !r3.destrocado, 'resposta certa fica como veio');
  const r4 = cor({ votoSim: 'Suprime a exigência de licença', votoNao: 'Mantém a exigência' }, 'emenda');
  ok(r4.votoSim === 'Suprime a exigência de licença', 'emenda supressiva aprovada por SIM: não se mexe');
  ok(!p.erros.length, 'sem erros no console do painel');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
