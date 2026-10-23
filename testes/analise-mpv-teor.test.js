// MPV com parecer: o teor das emendas acolhidas que o parecer só cita por número.
//
// O caso (15/10/2026, MPV 1370/2026): o Relatório Legislativo da Comissão Mista
// acolhe 49 emendas, mas só as lista ("acolhimento total ou parcial das Emendas
// nºs 1, 8, 10, …") — a nota saía com 49 linhas "teor não detalhado no parecer".
// Regra: vale o teor que o parecer der (emenda tratada sozinha); o que faltar é
// lido do texto da própria emenda, no Senado/Congresso.
//
// Parte roda contra o Senado de verdade (relatório e emendas da MPV 1370/2026).
// Uso: node testes/analise-mpv-teor.test.js
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado em analise.js: ' + re); return m[0]; };
const mpv = require(path.join(RAIZ, 'mpv.js'));
const pdfjs = require(path.join(RAIZ, 'bot', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

async function extrairTextoPdf(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  let t = '';
  for (let p = 1; p <= doc.numPages; p++) t += (await (await doc.getPage(p)).getTextContent()).items.map(i => i.str).join(' ') + '\n';
  return t;
}
async function baixarPdf(url) { const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }
// o relatório, lido aqui pelo teste: o Senado recusa um pedido de vez em quando (HTTP 503 medido em 23/10/2026) — uma tentativa a mais
const baixarRelatorio = url => baixarPdf(url).catch(() => new Promise(r => setTimeout(r, 1500)).then(() => baixarPdf(url)));

const A = new Function('extrairTextoPdf', 'baixarPdf', 'senadoCodigoMateria', 'senadoEmendas', 'isAbortError', `
  ${trecho(/function extrairNumerosEmendas\([\s\S]*?\n}/)}
  ${trecho(/function emendasAcolhidasNoParecer\([\s\S]*?\n}/)}
  ${trecho(/function teorDaEmendaNoParecer\([\s\S]*?\n}/)}
  ${trecho(/function resumirTextoEmenda\([\s\S]*?\n}/)}
  ${trecho(/async function teorEmendasAcolhidas\([\s\S]*?\n}/)}
  return { emendasAcolhidasNoParecer, teorDaEmendaNoParecer, resumirTextoEmenda, teorEmendasAcolhidas };
`)(extrairTextoPdf, baixarPdf, mpv.senadoCodigoMateria, mpv.senadoEmendas, () => false);

(async () => {
  console.log('Quais emendas o parecer acolhe');
  const conclusao = `2. pela constitucionalidade de todas as emendas apresentadas, com exceção das Emendas nºs 53, 60, 84;
    3. pela inadequação orçamentária e financeira das Emendas nºs 23, 24, 187; 4. no mérito, pela aprovação da Medida Provisória nº 1.370, de 2026
    e pela aprovação total ou parcial das Emendas nºs 1, 8, 10, 13 e 19, na forma do Projeto de Lei de Conversão anexo, e pela rejeição das demais emendas.`;
  ok([...A.emendasAcolhidasNoParecer(conclusao)].sort((a, b) => a - b).join() === '1,8,10,13,19', 'acolhidas: só a lista da aprovação — não a das exceções nem a das inadequadas');
  ok([...A.emendasAcolhidasNoParecer('Emendas nºs 3, 5, 8, 9, 13 e 14 acolhidas e rejeição das Emendas nºs 1, 2 e 4.')].sort((a, b) => a - b).join() === '3,5,8,9,13,14', 'acolhidas: "Emendas nºs … acolhidas" (formato do PAR da MPV 1366)');
  ok(!A.emendasAcolhidasNoParecer('não acolhemos as Emendas nºs 7 e 9').size, '"não acolhemos" não conta como acolhida');

  console.log('O parecer traz o teor?');
  ok(A.teorDaEmendaNoParecer('A Emenda nº 8, do Dep. Fulano, propõe divulgar os resultados.', 8), 'emenda tratada sozinha: teor no parecer');
  ok(!A.teorDaEmendaNoParecer('acolhimento das Emendas nºs 1, 8, 10 e 13', 8), 'emenda só numa lista: sem teor no parecer');
  ok(!A.teorDaEmendaNoParecer('A Emenda nº 18 trata de outra coisa.', 8), 'número de outra emenda não conta');

  console.log('Texto da emenda enxuto');
  const r = A.resumirTextoEmenda('CONGRESSO NACIONAL EMENDA Nº - CMMPV 1370/2026 (à MPV 1370/2026) Dê-se nova redação ao inciso I . . . . . . . . I – a primeira etapa; JUSTIFICAÇÃO A presente emenda tem por fim dar segurança. *CD260046582300* Assinado eletronicamente pelo(a) Dep. Aureo Ribeiro Para verificar a assinatura, acesse https://x');
  ok(/^Dê-se nova redação/.test(r) && /Justificação \(início\): A presente emenda/.test(r) && !/CD2600|Assinado|CONGRESSO NACIONAL/.test(r), 'sem cabeçalho e sem assinatura; dispositivo + começo da justificação');

  console.log('Download da emenda: uma tentativa a mais');
  {
    // Senado de mentira: a 1ª tentativa de cada emenda falha (como o Senado de vez em quando); a 8 falha sempre
    const pedidos = {};
    const texto = n => `Dê-se nova redação ao art. ${n}, para tratar do assunto da emenda número ${n} com mais detalhe. JUSTIFICAÇÃO Esta emenda resolve.`;
    const baixar = async url => { pedidos[url] = (pedidos[url] || 0) + 1; if (pedidos[url] === 1 || url === 'u8') throw new Error('HTTP 503'); return { t: texto(url.slice(1)) }; };
    const emendas = async () => [1, 8, 10].map(n => ({ numero: n, autor: 'Dep. X', partido: 'P', url: 'u' + n }));
    const B = new Function('extrairTextoPdf', 'baixarPdf', 'senadoCodigoMateria', 'senadoEmendas', 'isAbortError', `
      ${trecho(/function extrairNumerosEmendas\([\s\S]*?\n}/)}
      ${trecho(/function emendasAcolhidasNoParecer\([\s\S]*?\n}/)}
      ${trecho(/function teorDaEmendaNoParecer\([\s\S]*?\n}/)}
      ${trecho(/function resumirTextoEmenda\([\s\S]*?\n}/)}
      ${trecho(/async function teorEmendasAcolhidas\([\s\S]*?\n}/)}
      return { teorEmendasAcolhidas };
    `)(async b => b.t, baixar, async () => '123', emendas, e => e.name === 'AbortError');
    const parecer = { t: 'Emendas nºs 1, 8 e 10 acolhidas e rejeição das demais.', slice() { return this; } };   // como um ArrayBuffer
    const t = await B.teorEmendasAcolhidas({ sigla: 'MPV', numero: 1, ano: 2026 }, [{ tipo: 'PAR_CMMPV' }], [parecer]);
    ok(t && t.doSenado.map(e => e.n).join() === '1,10' && t.semTeor.join() === '8' && pedidos.u1 === 2 && pedidos.u10 === 2 && pedidos.u8 === 2,
      'falhou uma vez: tenta de novo e lê o teor (1, 10); falhou duas: fica sem teor (8) — duas tentativas por emenda, nunca mais');
    const C = new Function('extrairTextoPdf', 'baixarPdf', 'senadoCodigoMateria', 'senadoEmendas', 'isAbortError', `
      ${trecho(/function extrairNumerosEmendas\([\s\S]*?\n}/)}
      ${trecho(/function emendasAcolhidasNoParecer\([\s\S]*?\n}/)}
      ${trecho(/function teorDaEmendaNoParecer\([\s\S]*?\n}/)}
      ${trecho(/function resumirTextoEmenda\([\s\S]*?\n}/)}
      ${trecho(/async function teorEmendasAcolhidas\([\s\S]*?\n}/)}
      return { teorEmendasAcolhidas };
    `)(async b => b.t, async () => { const e = new Error('aborted'); e.name = 'AbortError'; pedidos.abort = (pedidos.abort || 0) + 1; throw e; }, async () => '123', emendas, e => e.name === 'AbortError');
    let parou = false;
    try { await C.teorEmendasAcolhidas({ sigla: 'MPV', numero: 1, ano: 2026 }, [{ tipo: 'PAR_CMMPV' }], [parecer]); } catch (e) { parou = e.name === 'AbortError'; }
    ok(parou && pedidos.abort <= 3, '"Parar tudo" (AbortError) não tenta de novo: interrompe');
  }

  console.log('MPV 1370/2026 — relatório e emendas reais (Senado)');
  try {
    const rel = await baixarRelatorio('https://legis.senado.leg.br/sdleg-getter/dadosabertos/documento/1018b629-0c0a-48d7-8beb-cce3729a572f');
    const docs = [{ tipo: 'RELATORIO_CMMPV' }, { tipo: 'MPV_TEOR' }];
    const t = await A.teorEmendasAcolhidas({ sigla: 'MPV', numero: 1370, ano: 2026 }, docs, [rel, null]);
    const esperadas = '1,8,10,13,19,34,36,55,61,62,71,75,77,85,93,97,107,108,122,124,137,159,168,169,170,172,177,190,241,258,265,275,306,315,317,320,323,328,356,373,374,380,405,409,410,411,432,478,479';
    ok(t && t.acolhidas.join() === esperadas, `as 49 acolhidas do voto do relator (${t && t.acolhidas.length})`);
    ok(t && t.doParecer.length === 0, 'o relatório não detalha nenhuma: todas vão ao Senado');
    ok(t && t.doSenado.length + t.semTeor.length === 49 && t.doSenado.length >= 45, `teor lido no Senado: ${t && t.doSenado.length} de 49 (sem teor: ${t && t.semTeor.join(', ') || 'nenhuma'})`);
    const e1 = t && t.doSenado.find(e => e.n === 1);
    ok(e1 && /Aureo Ribeiro/.test(e1.autor) && /oitavo período/.test(e1.texto), 'Emenda nº 1 (Aureo Ribeiro): o texto fala do "oitavo período semestral"');
  } catch (e) { falhas++; console.log('  ✗ rede: ' + e.message); }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
