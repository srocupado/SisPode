'use strict';
// Regera src/ricd.js a partir do texto consolidado do LEGIN.
// Rode SÓ quando uma nova Resolução alterar o Regimento — o arquivo embutido é
// a fonte que o bot consulta, e atualizá-lo é ato deliberado (não automático,
// para que a norma nunca dependa da rede em produção).
//   uso: node scripts/atualizar-ricd.js
const fs = require('fs'); const path = require('path');
const { htmlParaTexto, partirEmArtigos, URL_RICD } = require('../src/regimento');

(async () => {
  console.log('baixando o RICD consolidado do LEGIN…');
  let html = null, erro = null;
  for (const espera of [0, 4000, 12000]) {
    if (espera) await new Promise(r => setTimeout(r, espera));
    try {
      const r = await fetch(URL_RICD, { headers: { 'User-Agent': 'SisPodeBot/1.0' } });
      if (!r.ok) { erro = new Error(`HTTP ${r.status}`); continue; }
      html = await r.text(); break;
    } catch (e) { erro = e; }
  }
  if (!html) { console.error('falhou:', erro?.message); process.exit(1); }

  const artigos = partirEmArtigos(htmlParaTexto(html));
  if (artigos.length < 200) { console.error(`parse suspeito: só ${artigos.length} artigos — abortado.`); process.exit(1); }

  const destino = path.join(__dirname, '..', 'src', 'ricd.js');
  const anterior = (() => { try { return require(destino).artigos.length; } catch { return 0; } })();
  const cab = `'use strict';\n// REGIMENTO INTERNO DA CÂMARA — texto consolidado, EMBUTIDO no bot.\n` +
    `// Gerado de: LEGIN, Resolução 17/1989 (norma atualizada), em ${new Date().toISOString().slice(0, 10)}.\n` +
    `// Embutido de propósito: a consulta regimental não pode depender da rede.\n` +
    `// Para atualizar após nova Resolução: node scripts/atualizar-ricd.js\n\n`;
  fs.writeFileSync(destino, cab + 'module.exports = ' + JSON.stringify({ gerado: new Date().toISOString().slice(0, 10), artigos }) + ';\n');
  console.log(`src/ricd.js atualizado: ${artigos.length} artigos (antes: ${anterior}).`);
})();
