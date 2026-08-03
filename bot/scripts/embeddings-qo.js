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
// Uso: GEMINI_API_KEY=... node scripts/embeddings-qo.js [--dim 256] [--concorrencia 4]

require('dns').setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');

const ORIGEM = path.join(__dirname, '..', 'dados', 'qordem-extraido.json');
const DESTINO = path.join(__dirname, '..', 'src', 'qoembeddings.js');
const argv = process.argv.slice(2);
const opt = (n, p) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : p; };

const CHAVE = process.env.GEMINI_API_KEY || '';
const MODELO = opt('modelo', 'gemini-embedding-2');
const DIM = Number(opt('dim', 256));
const CONC = Number(opt('concorrencia', 4));
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

async function embutir(texto, tipo) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:embedContent?key=${CHAVE}`;
  const body = {
    model: `models/${MODELO}`,
    content: { parts: [{ text: texto }] },
    outputDimensionality: DIM,
    taskType: tipo,
  };
  const atrasos = [0, 4000, 12000, 30000];
  let ultimo = null;
  for (const ms of atrasos) {
    if (ms) await new Promise(r => setTimeout(r, ms));
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { ultimo = e; continue; }
    if (res.ok) return normalizar((await res.json()).embedding.values);
    if (res.status === 429 || res.status >= 500) { ultimo = new Error(`HTTP ${res.status}`); continue; }
    throw new Error(`HTTP ${res.status}`);
  }
  throw ultimo || new Error('falhou após as tentativas');
}

// O que vai para o vetor: a tese manda, a decisão contextualiza, os temas
// ancoram o vocabulário. Fora o número e a data, que não têm sentido semântico.
const textoDe = v => [v.tese, v.decisao && !/^n[aã]o consta$/i.test(v.decisao) ? v.decisao : '',
                      (v.temas || []).join(', ')].filter(Boolean).join(' — ');

(async () => {
  const t0 = Date.now();
  const itens = JSON.parse(fs.readFileSync(ORIGEM, 'utf8')).itens || {};
  const ids = Object.keys(itens);
  console.log(`${ids.length} verbetes · modelo ${MODELO} · ${DIM} dimensões · concorrência ${CONC}\n`);

  const vetores = new Array(ids.length).fill(null);
  const fila = ids.map((id, i) => [id, i]);
  let ok = 0, ruim = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    let par;
    while ((par = fila.pop())) {
      const [id, i] = par;
      try {
        vetores[i] = quantizar(await embutir(textoDe(itens[id]), 'RETRIEVAL_DOCUMENT'));
        ok++;
      } catch (_) { ruim++; }
      if ((ok + ruim) % 250 === 0) console.log(`  ${ok + ruim}/${ids.length}…`);
    }
  }));

  const bons = ids.map((id, i) => [id, vetores[i]]).filter(([, v]) => v);
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
