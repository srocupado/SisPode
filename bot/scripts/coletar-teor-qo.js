'use strict';
// Baixa o INTEIRO TEOR das questões de ordem para dados/qordem-teor.json.
//
// Arquivo SEPARADO de propósito: o bot em produção não usa o inteiro teor até
// a medida (scripts/avaliar-qo.js) mostrar que ele ganha da configuração atual.
// Assim dá para medir a mudança sem mexer no que está rodando.
//
// ~3 min, concorrência 5, ~30 MB.

require('dns').setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');
const qo = require('../src/questaoordem');

const DESTINO = path.join(__dirname, '..', 'dados', 'qordem-teor.json');
const HDR = { Accept: 'application/json', Referer: 'https://www.camara.leg.br/v-busca-qordem' };
const CONCORRENCIA = 5;
const MAX_TEXTO = 20000;      // média medida: 7,5 mil caracteres

const limpo = v => String(v || '').replace(/\s+/g, ' ').trim();

async function detalhe(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://www.camara.leg.br/busca-qordem-api/qordem/${id}`,
      { signal: ctrl.signal, headers: HDR });
    return r.ok ? await r.json() : null;
  } catch (_) { return null; }
  finally { clearTimeout(timer); }
}

(async () => {
  const t0 = Date.now();
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(DESTINO, 'utf8')).itens || {}; } catch (_) {}

  const corpus = await qo.garantirCorpus();
  const faltam = corpus.map(o => o.numInternoQOrdem)
    .filter(id => id != null && atual[id] === undefined);
  console.log(`acervo ${corpus.length} · já em cache ${Object.keys(atual).length} · a baixar ${faltam.length}`);
  if (!faltam.length) return console.log('nada a fazer.');

  const fila = [...faltam];
  let feitos = 0, vazios = 0, chars = 0;
  await Promise.all(Array.from({ length: CONCORRENCIA }, async () => {
    let id;
    while ((id = fila.pop()) != null) {
      const d = await detalhe(id);
      if (!d) continue;
      const t = limpo(d.txtQOrdem).slice(0, MAX_TEXTO);
      atual[id] = t;
      feitos++; chars += t.length;
      if (!t) vazios++;
      if (feitos % 500 === 0) console.log(`  ${feitos}/${faltam.length}…`);
    }
  }));

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, JSON.stringify({
    gerado: new Date().toISOString().slice(0, 10), itens: atual,
  }));
  console.log(`\n${feitos} baixados em ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min` +
    ` · sem texto ${vazios} · ${(chars / 1048576).toFixed(1)} MB` +
    ` · média ${Math.round(chars / Math.max(1, feitos - vazios))} chars`);
  console.log(`gravado em ${DESTINO}`);
})().catch(e => { console.error('falhou:', e); process.exit(1); });
