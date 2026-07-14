'use strict';
// ESPIÃO do Plenário ao vivo (cosev/ws-plenario) — modo calibração.
//
// Consulta os endpoints PÚBLICOS do app Infoleg a cada intervalo e avisa cada
// MUDANÇA de estado do Plenário (sessão abre/fecha, ODD inicia/encerra, itens
// em votação). As mudanças vão ao GRUPO (quando configurado) e ao PRIVADO DO
// ADMIN; os DUMPS de JSON cru vão SÓ ao admin (diagnóstico — não polui o
// grupo). Sem heartbeat. Nunca derruba o bot.
//
// Ligar com BOT_COSEV_ESPIAO=1 no .env.

const { statusPlenario, sessaoAtual, itensEmVotacao, PRESENCA, SESSAO, ITENS } = require('./plenariocosev');

const INTERVALO_MS = 12_000;       // 12s — leve para 3 GETs públicos

// Busca crua (para dump fiel), sem normalização.
async function cru(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const txt = await r.text();
    return { http: r.status, txt };
  } catch (e) { return { http: 0, txt: `(erro: ${e.message})` }; }
  finally { clearTimeout(timer); }
}

function assinaturaItens(itens) {
  return (itens || []).map(i => `${i.descricao}|${i.tipoVotacao}|${i.aberta ? 'A' : 'F'}`).join(' ;; ');
}

function iniciarEspiaoCosev({ api, admin, grupo = null, log = console.log } = {}) {
  if (!admin && !grupo) { log('[cosev-espião] sem admin nem grupo — não iniciado.'); return { parar() {} }; }

  // Envia a um destino, tolerando falha. `mudou` (state changes) vai a admin +
  // grupo; `dump` (JSON cru) vai só ao admin.
  const enviarA = (dest, txt) => dest
    ? api.sendMessage(dest, txt.slice(0, 4000)).catch(e => log('[cosev-espião] envio falhou: ' + e.message))
    : Promise.resolve();
  const enviarMudanca = (txt) => Promise.all([...new Set([grupo, admin].filter(Boolean))].map(d => enviarA(d, txt)));
  const enviarDump    = (txt) => enviarA(admin, txt);

  let prev = { sessao: null, oddIni: null, oddFim: null, itensSig: null };
  let dumpouSessao = false, dumpouVotacao = false;

  async function tick() {
    try {
      const [st, sess, itens] = await Promise.all([
        statusPlenario().catch(() => null),
        sessaoAtual().catch(() => null),
        itensEmVotacao().catch(() => []),
      ]);

      const sessaoAberta = sess?.aberta === true;
      const mudou = [];   // ao grupo + admin
      const dumps = [];   // só ao admin (JSON cru)

      // --- sessão abriu/fechou ---
      if (sessaoAberta !== prev.sessao) {
        if (sessaoAberta) {
          mudou.push(`🟢 SESSÃO ABERTA — nº ${sess.numSessao ?? '?'} · tipo="${sess.tipo || '?'}" · deliberativa=${sess.deliberativa}`);
          if (!dumpouSessao) {
            dumpouSessao = true;
            const raw = await cru(SESSAO);
            dumps.push(`📦 sessao-atual (cru, HTTP ${raw.http}):\n${raw.txt.slice(0, 1500)}`);
          }
        } else if (prev.sessao !== null) {
          mudou.push('🔴 SESSÃO ENCERRADA (cosev: sem sessão aberta).');
          dumpouSessao = false; dumpouVotacao = false;
        }
        prev.sessao = sessaoAberta;
      }

      // --- flags da ODD ---
      if (st) {
        if (st.oddIniciada !== prev.oddIni) {
          if (prev.oddIni !== null || st.oddIniciada) mudou.push(`🟡 indOrdemDoDiaIniciada = ${st.oddIniciada}`);
          prev.oddIni = st.oddIniciada;
        }
        if (st.oddEncerrada !== prev.oddFim) {
          if (prev.oddFim !== null || st.oddEncerrada) mudou.push(`🔚 indOrdemDoDiaEncerrada = ${st.oddEncerrada}`);
          prev.oddFim = st.oddEncerrada;
        }
      }

      // --- itens em votação ---
      const sig = assinaturaItens(itens);
      if (sig !== prev.itensSig) {
        prev.itensSig = sig;
        if (itens.length) {
          const linhas = itens.map(i => `• ${i.aberta ? '🟢 ABERTA' : '⚪ fechada'} [${i.tipoVotacao}${i.nominal ? '/NOMINAL' : ''}] ${i.descricao}`);
          mudou.push(`🗳 Itens em votação (${itens.length}):\n${linhas.join('\n')}`);
          if (!dumpouVotacao) {
            dumpouVotacao = true;
            const raw = await cru(ITENS);
            dumps.push(`📦 itens-em-votacao (cru, HTTP ${raw.http}):\n${raw.txt.slice(0, 1800)}`);
          }
        } else if (sessaoAberta) {
          mudou.push('🗳 Nenhum item em votação no momento.');
        }
      }

      if (mudou.length) {
        const cab = st ? `👥 presentes=${st.presentes}` : '(presença indisponível)';
        await enviarMudanca(`🕵️ cosev — ${cab}\n\n${mudou.join('\n\n')}`);
      }
      for (const d of dumps) await enviarDump(d);   // JSON cru: só no privado
    } catch (e) {
      log('[cosev-espião] tick falhou: ' + e.message);
    }
  }

  const timer = setInterval(tick, INTERVALO_MS);
  tick();
  return { parar() { clearInterval(timer); } };
}

module.exports = { iniciarEspiaoCosev };
