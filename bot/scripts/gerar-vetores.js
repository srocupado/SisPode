'use strict';
// Empacota os arquivos de vetores (dados/qordem-vetores-*.json) em
// src/qoembeddings.js, que é o formato que o /update leva para quem roda o bot.
//
// A vetorização é repartida entre as chaves — cada processo grava o seu
// arquivo — e aqui as fatias viram um índice só, com os ids na mesma ordem dos
// blocos de bytes.
//
// Uso: node scripts/gerar-vetores.js

const fs = require('fs');
const path = require('path');

const DADOS = path.join(__dirname, '..', 'dados');
const DESTINO = path.join(__dirname, '..', 'src', 'qoembeddings.js');
const MIN_ACEITAVEL = 3800;   // guarda: índice pela metade daria busca torta

const arquivos = fs.readdirSync(DADOS).filter(f => /^qordem-vetores.*\.json$/.test(f)).sort();
const itens = new Map();
let modelo = null, dim = null;
for (const f of arquivos) {
  const a = JSON.parse(fs.readFileSync(path.join(DADOS, f), 'utf8'));
  if (modelo && (a.modelo !== modelo || a.dim !== dim)) {
    console.error(`ERRO: ${f} usa ${a.modelo}/${a.dim}, os outros usam ${modelo}/${dim}.`);
    console.error('Vetores de modelos diferentes não se comparam — refaça tudo com um só.');
    process.exit(1);
  }
  modelo = a.modelo; dim = a.dim;
  for (const [id, b64] of Object.entries(a.itens || {})) itens.set(id, b64);
}
console.log(`fontes: ${arquivos.join(', ') || '(nenhuma)'}`);

if (itens.size < MIN_ACEITAVEL) {
  console.error(`Só ${itens.size} vetores — abaixo do mínimo de ${MIN_ACEITAVEL}.`);
  console.error('Rode a vetorização até cobrir o acervo (ela retoma de onde parou).');
  process.exit(1);
}

const ids = [...itens.keys()];
const buf = Buffer.concat(ids.map(id => Buffer.from(itens.get(id), 'base64')));
const cab = `'use strict';
// VETORES SEMÂNTICOS das teses — GERADO, não editar à mão.
// Refazer com: node scripts/embeddings-qo.js && node scripts/gerar-vetores.js
// Modelo ${modelo} · ${dim} dimensões · int8 · ${ids.length} questões de ordem
// Ordem dos ids = ordem dos blocos de ${dim} bytes em 'vetores' (base64).
`;
fs.writeFileSync(DESTINO, cab + 'module.exports = ' + JSON.stringify({
  modelo, dim, gerado: new Date().toISOString().slice(0, 10),
  ids: ids.map(Number), vetores: buf.toString('base64'),
}) + ';\n');
console.log(`${ids.length} vetores → ${DESTINO} · ${(fs.statSync(DESTINO).size / 1048576).toFixed(2)} MB`);
