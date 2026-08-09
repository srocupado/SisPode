'use strict';
// CAMADA 3 — vetores semânticos das teses extraídas.
//
// O BM25 acha quem repete a palavra. Precedente é quem repete a TESE: a mesma
// questão jurídica aparece em 1997 e em 2021 com vocabulário diferente. O vetor
// aproxima pelo sentido — MEDIDO com gemini-embedding-2 em 256 dimensões,
// "prejudicialidade de requerimento de adiamento de discussão" e "o requerimento
// de adiamento fica prejudicado quando rejeitada antes a retirada de pauta"
// ficam a 0.839 de similaridade, contra 0.590 de um assunto distinto.
//
// Embeddamos a TESE e a DECISÃO extraídas, não o texto bruto: é a formulação
// limpa do problema jurídico que faz o pareamento funcionar.
//
// Gerado UMA vez e distribuído com o bot (src/qoembeddings.js). Na consulta só
// a pergunta do usuário precisa ser vetorizada — uma chamada curta. Quem usa
// chave Anthropic não tem essa API e cai na busca léxica, que continua boa.
//
// EM LOTE, COM RITMO. batchEmbedContents aceita ~50 textos por chamada, mas
// cada texto conta como uma requisição na cota — MEDIDO:
// EmbedContentRequestsPerMinutePerProjectPerModel-FreeTier = 100/min. Ou seja,
// o lote economiza viagem de rede, não cota. Sem espaçar, 82 lotes disparados
// em sequência entregaram 412 vetores e 3.650 falhas.
// Com um lote a cada ~33s (90 req/min, folga sob o teto), saem ~45 min por
// chave — ou metade disso repartindo com --fatia entre as duas.
//
// Uso: GEMINI_API_KEY=... node scripts/embeddings-qo.js [--dim 256] [--lote 50]

require('dns').setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');

const DADOS = path.join(__dirname, '..', 'dados');
const DESTINO = path.join(__dirname, '..', 'src', 'qoembeddings.js');
const argv = process.argv.slice(2);
const opt = (n, p) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : p; };

const CHAVE = process.env.GEMINI_API_KEY || '';
const MODELO = opt('modelo', 'gemini-embedding-2');
const DIM = Number(opt('dim', 256));
const LOTE = Number(opt('lote', 50));
const CONC = Number(opt('concorrencia', 1));
const RPM = Number(opt('rpm', 90));            // folga sob o teto medido de 100
const FATIA = (() => {
  const m = String(opt('fatia', '') || '').match(/^(\d+)\/(\d+)$/);
  return m ? { i: Number(m[1]), n: Number(m[2]) } : null;
})();

// Ritmo: um lote consome LOTE requisições da cota por minuto.
const MIN_INTERVALO = 60000 * LOTE / RPM;
let _proximoSlot = 0;
async function aguardarSlot() {
  const agora = Date.now();
  const slot = Math.max(agora, _proximoSlot);
  _proximoSlot = slot + MIN_INTERVALO;
  if (slot > agora) await new Promise(r => setTimeout(r, slot - agora));
}
if (!CHAVE) { console.error('Defina GEMINI_API_KEY no ambiente.'); process.exit(1); }

/** Unitário: com truncagem Matryoshka o vetor sai sem norma 1, e sem isto o
 *  produto escalar deixa de ser cosseno. */
function normalizar(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

/** int8: 256 floats por QO seriam 4 MB no repositório; assim são 1 MB, e a
 *  perda de precisão fica muito abaixo da diferença entre um precedente e
 *  outro (medida: quantizar move o cosseno em menos de 0,002). */
const quantizar = v => Buffer.from(v.map(x => Math.max(-127, Math.min(127, Math.round(x * 127)))));

async function embutirLote(textos, tipo) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:batchEmbedContents?key=${CHAVE}`;
  const body = {
    requests: textos.map(t => ({
      model: `models/${MODELO}`, content: { parts: [{ text: t }] },
      outputDimensionality: DIM, taskType: tipo,
    })),
  };
  let ultimo = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    await aguardarSlot();
    // Timeout obrigatório: conexão pendurada travaria o worker para sempre.
    const ctrl = new AbortController();
    const alarme = setTimeout(() => ctrl.abort(), 120000);
    let res;
    try {
      res = await fetch(url, { method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { ultimo = e; await new Promise(r => setTimeout(r, 5000 * (tentativa + 1))); continue; }
    finally { clearTimeout(alarme); }
    if (res.ok) return (await res.json()).embeddings.map(e => normalizar(e.values));
    const corpo = await res.json().catch(() => null);
    if (res.status === 429 || res.status >= 500) {
      const d = String((corpo?.error?.details || []).map(x => x.retryDelay).find(Boolean) || '')
        .match(/^(\d+(?:\.\d+)?)s$/);
      ultimo = new Error(`HTTP ${res.status}`);
      await new Promise(r => setTimeout(r, d ? Number(d[1]) * 1000 : 15000 * (tentativa + 1)));
      continue;
    }
    throw new Error(corpo?.error?.message || `HTTP ${res.status}`);
  }
  throw ultimo || new Error('falhou após as tentativas');
}

// O que vai para o vetor: a tese manda, a decisão contextualiza, os temas
// ancoram o vocabulário. Fora o número e a data, que não têm sentido semântico.
const textoDe = v => [v.tese, v.decisao && !/^n[aã]o consta$/i.test(v.decisao) ? v.decisao : '',
                      (v.temas || []).join(', ')].filter(Boolean).join(' — ');

(async () => {
  const t0 = Date.now();
  // Junta as fatias: duas chaves em paralelo gravam um arquivo cada.
  const itens = {};
  for (const f of fs.readdirSync(DADOS).filter(x => /^qordem-extraido.*\.json$/.test(x)).sort()) {
    Object.assign(itens, JSON.parse(fs.readFileSync(path.join(DADOS, f), 'utf8')).itens || {});
  }
  let ids = Object.keys(itens);

  // RETOMADA: reaproveita o que já foi vetorizado numa execução anterior. Sem
  // isto, uma rodada interrompida pela cota jogava fora tudo que tinha feito.
  const feitos = new Map();
  try {
    const ant = require(DESTINO);
    if (ant.dim === DIM && ant.modelo === MODELO) {
      const buf = Buffer.from(ant.vetores, 'base64');
      ant.ids.forEach((id, i) => feitos.set(String(id), buf.subarray(i * DIM, (i + 1) * DIM)));
      console.log(`retomando: ${feitos.size} vetores já prontos`);
    }
  } catch (_) { /* primeira execução */ }
  if (FATIA) ids = ids.filter((_, i) => i % FATIA.n === FATIA.i || feitos.has(ids[i]));
  console.log(`${ids.length} verbetes · modelo ${MODELO} · ${DIM} dimensões · concorrência ${CONC}\n`);

  // Fatia em lotes e processa alguns lotes em paralelo.
  const lotes = [];
  const pendentes = ids.filter(id => !feitos.has(id));
  for (let i = 0; i < pendentes.length; i += LOTE) lotes.push(pendentes.slice(i, i + LOTE));
  console.log(`${pendentes.length} a vetorizar · ${lotes.length} lotes de até ${LOTE}` +
    `${FATIA ? ` · fatia ${FATIA.i}/${FATIA.n}` : ''} · ${(MIN_INTERVALO / 1000).toFixed(0)}s entre lotes\n`);

  const vetores = new Map(feitos);
  let ok = 0, ruim = 0, lotesFeitos = 0;
  const fila = [...lotes];
  await Promise.all(Array.from({ length: CONC }, async () => {
    let lote;
    while ((lote = fila.pop())) {
      try {
        const vs = await embutirLote(lote.map(id => textoDe(itens[id])), 'RETRIEVAL_DOCUMENT');
        lote.forEach((id, k) => { if (vs[k]) vetores.set(id, quantizar(vs[k])); });
        ok += lote.length;
      } catch (e) { ruim += lote.length; console.warn(`  lote falhou: ${e.message}`); }
      if (++lotesFeitos % 5 === 0) console.log(`  ${lotesFeitos}/${lotes.length} lotes · ${ok} vetores`);
    }
  }));

  const bons = ids.map(id => [id, vetores.get(id)]).filter(([, v]) => v);
  const buf = Buffer.concat(bons.map(([, v]) => v));
  const cab = `'use strict';
// VETORES SEMÂNTICOS das teses — GERADO, não editar à mão.
// Refazer com: node scripts/embeddings-qo.js
// Modelo ${MODELO} · ${DIM} dimensões · int8 · ${bons.length} questões de ordem
// Ordem dos ids = ordem dos blocos de ${DIM} bytes em 'vetores' (base64).
`;
  fs.writeFileSync(DESTINO, cab + 'module.exports = ' + JSON.stringify({
    modelo: MODELO, dim: DIM, gerado: new Date().toISOString().slice(0, 10),
    ids: bons.map(([id]) => Number(id)), vetores: buf.toString('base64'),
  }) + ';\n');

  console.log(`\n${ok} vetorizadas · ${ruim} falhas · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`${DESTINO} · ${(fs.statSync(DESTINO).size / 1024 / 1024).toFixed(2)} MB`);
})().catch(e => { console.error('falhou:', e); process.exit(1); });
