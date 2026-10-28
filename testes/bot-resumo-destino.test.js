// Monitor do bot: o resumo da sessão espera o despacho de destino.
//
// O caso (28/10/2026): fim da ODD às 16:52:29, resumo às 16:53:08 sem o
// destino do PDL 274/2026, e o "📍 Encaminhamento das matérias" numa 2ª
// mensagem às 16:55:31 — a equipe já tinha levado o resumo ao WhatsApp.
// Regra: matéria concluída sem destino → o resumo espera o despacho (vigia de
// 45s) até RESUMO_ESPERA_DESTINO_MS e sai completo; passado o teto, sai como
// estiver e o complemento de sempre continua valendo.
//
// Roda as funções de bot/src/monitor.js com relógio e dependências falsas.
// Uso: node testes/bot-resumo-destino.test.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'src', 'monitor.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado em monitor.js: ' + re); return m[0]; };

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const RESUMO_SEM = { texto: '📌 Matérias apreciadas…\n▪️ *PDL 274/2026* (Medidas protetivas no Mercosul)', destinos: [], semDestino: 1 };
const RESUMO_COM = { texto: '📌 Matérias apreciadas…\n▪️ *PDL 274/2026* (Medidas protetivas no Mercosul)➡️ Vai ao Senado', destinos: ['PDL 274/2026 ➡️ Vai ao Senado'], semDestino: 0 };
const SO_URGENCIAS = { texto: '📌 Matérias apreciadas…\n▪️ *Urgência ao PL 1/2026*', destinos: [], semDestino: 0 };

/** Um monitor de mentira: `resumos` dá o resultado de cada chamada ao worker, em ordem. */
function montar({ resumos, despacho = () => false, enviar = async () => {} }) {
  const T = { agora: 0, intervalos: [], enviados: [], admin: [], complemento: 0, chamadasWorker: 0 };
  let i = 0;
  const deps = {
    pautaAtualImportada: async () => null,
    resumoSessao: async () => { T.chamadasWorker++; const r = resumos[Math.min(i++, resumos.length - 1)]; return typeof r === 'function' ? r() : r; },
    enviarOuFalhar: async t => { await enviar(t); T.enviados.push(t); },
    enviar: async t => T.enviados.push(t),
    marcar: () => {},
    iniciarPollDestinos: () => { T.complemento++; },
    algumDespachoDeDestino: async () => despacho(T.agora),
    _cfg: { admin: 1, api: { sendMessage: async (_d, t) => { T.admin.push(t); } } },
    console: { log: () => {}, warn: () => {} },
    setInterval: fn => { const h = { fn, vivo: true }; T.intervalos.push(h); return h; },
    clearInterval: h => { if (h) h.vivo = false; },
    setTimeout: fn => fn(),
    Date: { now: () => T.agora },
  };
  const nomes = Object.keys(deps);
  const F = new Function(...nomes, `
    ${trecho(/const RESUMO_TENTATIVAS_MIN = .*;/)}
    ${trecho(/const RESUMO_ESPERA_DESTINO_MS = .*;/)}
    ${trecho(/const DESTINOS_POLL_MS = .*;/)}
    ${trecho(/async function tentarResumo\([\s\S]*?\n}/)}
    ${trecho(/function iniciarEsperaDestinos\([\s\S]*?\n}/)}
    return { tentarResumo, RESUMO_ESPERA_DESTINO_MS, DESTINOS_POLL_MS };
  `)(...nomes.map(n => deps[n]));
  const s = { dataISO: '2026-10-28', estado: {} };
  // avança o relógio um ciclo da vigia e roda os intervalos vivos
  const ciclo = async () => { T.agora += F.DESTINOS_POLL_MS; for (const h of T.intervalos.filter(x => x.vivo)) await h.fn(); };
  return { F, T, s, ciclo };
}

(async () => {
  console.log('== o caso de 28/10: o despacho sai 2 min depois ==');
  {
    // despacho publicado ~2 min após a 1ª tentativa
    const { F, T, s, ciclo } = montar({ resumos: [RESUMO_SEM, RESUMO_COM], despacho: t => t >= 120e3 });
    await F.tentarResumo(s, 0);
    ok(T.enviados.length === 0, 'sem destino: o resumo NÃO sai na hora');
    ok(T.intervalos.length === 1, 'e começa a vigia do despacho');
    await ciclo(); await ciclo();
    ok(T.enviados.length === 0, 'despacho ainda não publicado: segue esperando');
    await ciclo();
    ok(T.enviados.length === 1 && /➡️ Vai ao Senado/.test(T.enviados[0]), 'despacho publicado: UMA mensagem, já com o destino');
    ok(T.complemento === 0, 'sem a 2ª mensagem de encaminhamento');
    await F.tentarResumo(s, 1);
    await ciclo();
    ok(T.enviados.length === 1 && T.intervalos.every(h => !h.vivo), 'tentativa agendada depois não reenvia; a vigia para');
  }

  console.log('\n== o despacho não sai ==');
  {
    const { F, T, s, ciclo } = montar({ resumos: [RESUMO_SEM] });
    await F.tentarResumo(s, 0);
    const ciclos = Math.ceil(F.RESUMO_ESPERA_DESTINO_MS / F.DESTINOS_POLL_MS);
    for (let k = 0; k < ciclos - 1; k++) await ciclo();
    ok(T.enviados.length === 0, `até o teto (${F.RESUMO_ESPERA_DESTINO_MS / 60e3} min), espera`);
    await ciclo();
    ok(T.enviados.length === 1 && !/➡️/.test(T.enviados[0]), 'no teto: o resumo sai como estiver');
    ok(T.complemento === 1, 'e o complemento de encaminhamento continua valendo');
    ok(T.intervalos.every(h => !h.vivo), 'a vigia da espera para');
  }

  console.log('\n== nada a esperar ==');
  {
    const { F, T, s } = montar({ resumos: [SO_URGENCIAS] });
    await F.tentarResumo(s, 0);
    ok(T.enviados.length === 1 && T.intervalos.length === 0, 'só urgências (sem destino a esperar): sai na hora, como antes');
    const b = montar({ resumos: [RESUMO_COM] });
    await b.F.tentarResumo(b.s, 0);
    ok(b.T.enviados.length === 1 && b.T.complemento === 0, 'destino já publicado: sai na hora, completo');
  }

  console.log('\n== tentativa agendada em curso quando a espera acaba ==');
  {
    let soltar;
    const lenta = () => new Promise(r => { soltar = () => r(RESUMO_SEM); });
    const { F, T, s, ciclo } = montar({ resumos: [RESUMO_SEM, lenta, RESUMO_SEM] });
    await F.tentarResumo(s, 0);
    T.agora = F.RESUMO_ESPERA_DESTINO_MS - F.DESTINOS_POLL_MS - 1000;
    const agendada = F.tentarResumo(s, 2);          // a de 10 min, montando o resumo
    await ciclo();                                   // a vigia chega ao teto com ela em curso
    ok(T.enviados.length === 0 && T.intervalos[0].vivo, 'a vigia não desiste: espera a tentativa em curso');
    soltar(); await agendada;
    await ciclo();
    ok(T.enviados.length === 1, 'e no ciclo seguinte envia');
  }

  console.log('\n== envio que falha ==');
  {
    const { F, T, s, ciclo } = montar({ resumos: [RESUMO_SEM], enviar: async () => { throw new Error('rede'); } });
    await F.tentarResumo(s, 0);
    for (let k = 0; k < 20; k++) await ciclo();
    ok(T.admin.length === 1 && /falhou/.test(T.admin[0]), 'no teto, a última tentativa falha: UM aviso ao admin');
    ok(T.intervalos.every(h => !h.vivo), 'e a vigia para — não insiste a cada 45 s');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
