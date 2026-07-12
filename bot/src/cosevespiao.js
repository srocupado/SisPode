'use strict';
// ESPIÃO do Plenário ao vivo (cosev/ws-plenario) — modo calibração.
//
// Consulta os endpoints PÚBLICOS do app Infoleg a cada intervalo e manda ao
// PRIVADO DO ADMIN cada MUDANÇA de estado, com o JSON cru dos campos que
// importam. Serve para, durante uma sessão real, vermos a forma exata dos
// dados (tipo da sessão, itens em votação, encerramento da ODD) e calibrar o
// monitor. Não envia nada ao grupo; nunca derruba o bot.
//
// Ligar com BOT_COSEV_ESPIAO=1 no .env.

const { statusPlenario, sessaoAtual, itensEmVotacao, PRESENCA, SESSAO, ITENS } = require('./plenariocosev');

const INTERVALO_MS = 12_000;       // 12s — leve para 3 GETs públicos
const HEARTBEAT_MS = 3 * 60_000;   // enquanto houver sessão, um "vivo" a cada 3 min

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

function iniciarEspiaoCosev({ api, admin, log = console.log } = {}) {
  if (!admin) { log('[cosev-espião] sem ADMIN_USER_ID — não iniciado.'); return { parar() {} }; }

  const enviar = (txt) => api.sendMessage(admin, txt.slice(0, 4000)).catch(e => log('[cosev-espião] envio falhou: ' + e.message));

  let prev = { sessao: null, oddIni: null, oddFim: null, itensSig: null };
  let dumpouSessao = false, dumpouVotacao = false, ultimoHeartbeat = 0;

  enviar('🕵️ Espião cosev LIGADO — vou avisar aqui cada mudança do Plenário ao vivo (com o JSON cru). Fonte: painel público do app Infoleg.');

  async function tick() {
    try {
      const [st, sess, itens] = await Promise.all([
        statusPlenario().catch(() => null),
        sessaoAtual().catch(() => null),
        itensEmVotacao().catch(() => []),
      ]);

      const sessaoAberta = sess?.aberta === true;
      const mudou = [];

      // --- sessão abriu/fechou ---
      if (sessaoAberta !== prev.sessao) {
        if (sessaoAberta) {
          mudou.push(`🟢 SESSÃO ABERTA — nº ${sess.numSessao ?? '?'} · tipo="${sess.tipo || '?'}" · deliberativa=${sess.deliberativa}`);
          if (!dumpouSessao) {
            dumpouSessao = true;
            const raw = await cru(SESSAO);
            mudou.push(`📦 sessao-atual (cru, HTTP ${raw.http}):\n${raw.txt.slice(0, 1500)}`);
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
            mudou.push(`📦 itens-em-votacao (cru, HTTP ${raw.http}):\n${raw.txt.slice(0, 1800)}`);
          }
        } else if (sessaoAberta) {
          mudou.push('🗳 Nenhum item em votação no momento.');
        }
      }

      if (mudou.length) {
        const cab = st ? `👥 presentes=${st.presentes}` : '(presença indisponível)';
        await enviar(`🕵️ cosev — ${cab}\n\n${mudou.join('\n\n')}`);
        ultimoHeartbeat = Date.now();
      } else if (sessaoAberta && Date.now() - ultimoHeartbeat > HEARTBEAT_MS) {
        ultimoHeartbeat = Date.now();
        await enviar(`🕵️ cosev vivo — presentes=${st?.presentes ?? '?'} · ODD ini=${st?.oddIniciada ?? prev.oddIni} fim=${st?.oddEncerrada ?? prev.oddFim} · itens=${(itens || []).length}`);
      }
    } catch (e) {
      log('[cosev-espião] tick falhou: ' + e.message);
    }
  }

  const timer = setInterval(tick, INTERVALO_MS);
  tick();
  return { parar() { clearInterval(timer); } };
}

module.exports = { iniciarEspiaoCosev };
