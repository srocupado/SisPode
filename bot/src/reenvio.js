'use strict';
// Reenvio de mensagens do Telegram quando a falha é transitória.
//
// "Network request for 'sendMessage' failed!" é a mensagem da grammY para
// falha de REDE (DNS, TLS, conexão cortada) — não é recusa do Telegram, que
// viria como "Call to 'sendMessage' failed!". Num envio automático a diferença
// importa: a recusa é definitiva (bot bloqueado, chat inexistente) e repetir
// não adianta; a falha de rede dura segundos e some na segunda tentativa.
//
// Sem isso, um soluço de rede de meio minuto custava o digest inteiro da
// semana: o envio era marcado como feito antes de acontecer, e o assinante
// não recebia nada.

/** Erro que vale repetir: rede, excesso de chamadas (429) ou erro do servidor. */
function ehTransitorio(e) {
  if (!e) return false;
  const nome = e.name || e.constructor?.name || '';
  if (nome === 'HttpError') return true;
  const codigo = e.error_code ?? e.parameters?.error_code;
  if (typeof codigo === 'number') return codigo === 429 || codigo >= 500;
  return /network request|fetch failed|timeout|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(e.message || '');
}

/** Espera antes da próxima tentativa: o "retry_after" do Telegram tem prioridade. */
function esperaDe(e, tentativa, base = 2000) {
  const ra = e?.parameters?.retry_after;
  return ra ? ra * 1000 : base * 2 ** tentativa;   // 2s, 4s, 8s…
}

/**
 * Executa `fn` repetindo enquanto o erro for transitório. Erro definitivo sai
 * na primeira tentativa — repetir "chat not found" só atrasa o aviso.
 */
async function comRepeticao(rotulo, fn, { tentativas = 4, base = 2000, dormir = ms => new Promise(r => setTimeout(r, ms)), log = console.warn } = {}) {
  let ultimo = null;
  for (let i = 0; i < tentativas; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      if (!ehTransitorio(e) || i === tentativas - 1) break;
      const espera = esperaDe(e, i, base);
      log(`[${rotulo}] tentativa ${i + 1} de ${tentativas} falhou (${e.message}); repetindo em ${Math.round(espera / 1000)}s`);
      await dormir(espera);
    }
  }
  throw ultimo;
}

module.exports = { comRepeticao, ehTransitorio, esperaDe };
