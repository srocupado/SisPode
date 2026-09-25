'use strict';
// Popula/atualiza o relatório "Deputados com projetos convertidos em lei" no
// Firebase. Baixa os arquivos em massa da Câmara (server-side — sem a barreira
// de CORS que o navegador tem), filtra os PL/PLP transformados em norma
// jurídica e grava só o agregado (ranking + lista de projetos) em
// /leis_aprovadas/{legislatura}.
//
// Legislaturas ENCERRADAS são puladas se já tiverem dado salvo — use --forcar
// para reprocessar mesmo assim. A CORRENTE (calculada pela data) é sempre
// reprocessada; a anterior, na carência de 12 meses, se o dado tiver > 7 dias.
// Não precisa de BOT_TOKEN: roda em qualquer máquina com Node, mesmo sem o bot.
//
// Uso:
//   node bot/scripts/atualizar-leis-aprovadas.js                 (todas, da 53ª à corrente)
//   node bot/scripts/atualizar-leis-aprovadas.js 57 56            (só as listadas)
//   node bot/scripts/atualizar-leis-aprovadas.js --forcar 57      (ignora o "já tem dado")
//   node bot/scripts/atualizar-leis-aprovadas.js --sem-condicao   (pula titular/suplente — mais rápido)
//
// Cada legislatura baixa de 4 a 5 arquivos de 50–165 MB — é coleta pesada,
// deliberada (não roda sozinha por engano): rode de propósito, numa rede boa.

const { atualizarLeisAprovadas, listarLegislaturas, legislaturaValida } = require('../src/leisaprovadas');

(async () => {
  const args = process.argv.slice(2);
  const forcar = args.includes('--forcar');
  const comCondicao = !args.includes('--sem-condicao');
  const legislaturas = args.filter(a => !a.startsWith('--'));
  const alvo = legislaturas.length ? legislaturas : listarLegislaturas();

  for (const leg of alvo) {
    if (!legislaturaValida(leg)) {
      console.error(`Legislatura desconhecida: "${leg}". Válidas: ${listarLegislaturas().join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Atualizando: ${alvo.join(', ')}${forcar ? ' (forçado)' : ''}${comCondicao ? '' : ' (sem condição titular/suplente)'}\n`);

  const r = await atualizarLeisAprovadas({
    legislaturas: alvo, comCondicao, forcar, origem: 'script',
    onProgresso: (leg, fase) => console.log(`[${leg}] ${fase}`),
  });

  console.log('');
  for (const p of r.processadas) {
    console.log(`✓ ${p.leg} (${p.rotulo}): ${p.leis} projeto(s) em lei, ${p.deputados} deputado(s) no ranking.`);
  }
  for (const leg of r.puladas) {
    console.log(`— ${leg}: já tinha dado salvo, pulada (use --forcar para reprocessar).`);
  }
  for (const a of r.aguardando) {
    console.log(`… ${a.leg}: ${a.motivo}.`);
  }
  for (const e of r.erros) {
    console.log(`✗ ${e.leg}: ${e.erro}`);
  }

  process.exit(r.erros.length ? 1 : 0);
})();
