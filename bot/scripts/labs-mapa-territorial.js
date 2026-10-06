'use strict';
// Labs · Mapa Territorial — mesma coleta do /labsmapa, fora do Telegram.
// Não precisa de BOT_TOKEN: roda em qualquer máquina com Node e com os arquivos
// da extensão (usa labs-mapa-nucleo.js da raiz).
//
// Uso:
//   node bot/scripts/labs-mapa-territorial.js                     (eleição de 2026 + comparação com 2022, baixa do TSE)
//   node bot/scripts/labs-mapa-territorial.js 2022                (só 2022, bancada de hoje na Câmara)
//   node bot/scripts/labs-mapa-territorial.js 2026 --zip z2026.zip --zip-anterior z2022.zip
//                                                                  (usa zips já baixados)
// Emendas: só com TRANSPARENCIA_CHAVE no bot/.env.

const { atualizarMapaTerritorial, ANOS_SUPORTADOS } = require('../src/labsmapa');

(async () => {
  const args = process.argv.slice(2);
  const iz = args.indexOf('--zip');
  const ia = args.indexOf('--zip-anterior');
  const arquivoZip = iz >= 0 ? args[iz + 1] : undefined;
  const arquivoZipAnterior = ia >= 0 ? args[ia + 1] : undefined;
  const ano = args.find(a => /^\d{4}$/.test(a)) || ANOS_SUPORTADOS[0];
  const r = await atualizarMapaTerritorial({ ano, arquivoZip, arquivoZipAnterior, onProgresso: m => console.log(`[${ano}] ${m}`) });
  console.log('');
  for (const d of r.deputados) console.log(`✓ ${d.nome} (${d.uf}): ${d.total} votos em ${d.municipios} municípios` +
    (r.anterior ? (d.anterior != null ? ` · ${r.anterior.ano}: ${d.anterior}` : ` · não concorreu em ${r.anterior.ano}`) : ''));
  for (const n of r.naoEncontrados) console.log(`⚠ ${n.nome} (${n.uf}): ${n.motivo}`);
  if (r.semPar.length) console.log(`${r.semPar.length} município(s) do TSE sem par no IBGE: ${r.semPar.map(m => m.n + '/' + m.uf).join(', ')}`);
  console.log(r.emendas.anos.length ? `Emendas: ${r.emendas.anos.join(', ')} (${r.emendas.erros.length} falha(s))` : 'Emendas: sem TRANSPARENCIA_CHAVE — só votos.');
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
