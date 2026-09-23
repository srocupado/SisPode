'use strict';
// Popula/atualiza o relatório "Deputados com projetos convertidos em lei" no
// Firebase. Baixa os arquivos em massa da Câmara (server-side — sem a barreira
// de CORS que o navegador tem), filtra os PL/PLP transformados em norma
// jurídica e grava só o agregado (ranking + lista de projetos) em
// /leis_aprovadas/{legislatura}.
//
// Legislaturas ENCERRADAS (53ª–56ª) são puladas se já tiverem dado salvo — use
// --forcar para reprocessar mesmo assim. A CORRENTE (57ª) é sempre reprocessada
// (é ela que o cron do bot atualiza sozinho, em bot/index.js).
//
// Uso:
//   node bot/scripts/atualizar-leis-aprovadas.js                 (todas as 5)
//   node bot/scripts/atualizar-leis-aprovadas.js 57 56            (só as listadas)
//   node bot/scripts/atualizar-leis-aprovadas.js --forcar 57      (ignora o "já tem dado")
//   node bot/scripts/atualizar-leis-aprovadas.js --sem-condicao   (pula titular/suplente — mais rápido)
//
// Cada legislatura baixa de 4 a 5 arquivos de 50–165 MB — é coleta pesada,
// deliberada (não roda sozinha por engano): rode de propósito, numa rede boa.

const { atualizarLeisAprovadas, LEGISLATURAS } = require('../src/leisaprovadas');

(async () => {
  const args = process.argv.slice(2);
  const forcar = args.includes('--forcar');
  const comCondicao = !args.includes('--sem-condicao');
  const legislaturas = args.filter(a => !a.startsWith('--'));
  const alvo = legislaturas.length ? legislaturas : Object.keys(LEGISLATURAS);

  for (const leg of alvo) {
    if (!LEGISLATURAS[leg]) {
      console.error(`Legislatura desconhecida: "${leg}". Válidas: ${Object.keys(LEGISLATURAS).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Atualizando: ${alvo.join(', ')}${forcar ? ' (forçado)' : ''}${comCondicao ? '' : ' (sem condição titular/suplente)'}\n`);

  const r = await atualizarLeisAprovadas({
    legislaturas: alvo, comCondicao, forcar,
    onProgresso: (leg, fase) => console.log(`[${leg}] ${fase}`),
  });

  console.log('');
  for (const p of r.processadas) {
    console.log(`✓ ${p.leg} (${p.rotulo}): ${p.leis} projeto(s) em lei, ${p.deputados} deputado(s) no ranking.`);
  }
  for (const leg of r.puladas) {
    console.log(`— ${leg}: já tinha dado salvo, pulada (use --forcar para reprocessar).`);
  }
  for (const e of r.erros) {
    console.log(`✗ ${e.leg}: ${e.erro}`);
  }

  process.exit(r.erros.length ? 1 : 0);
})();
