// Monitor do bot: o resumo da sessão espera o despacho de destino.
//
// O caso (28/10/2026): fim da ODD às 16:52:29, resumo às 16:53:08 sem o
// destino do PDL 274/2026, e o "📍 Encaminhamento das matérias" numa 2ª
// mensagem às 16:55:31 — a equipe já tinha levado o resumo ao WhatsApp.
// Regra: matéria concluída sem destino → o resumo espera o despacho (vigia de
// 45s) até RESUMO_ESPERA_DESTINO_MS e sai completo; passado o teto, sai como
// estiver e a vigia segue para ATUALIZAR o resumo quando o despacho sair.
// 03/11/2026: o resumo saiu só com as urgências; o PL 4674/2024 (aprovado às
// 16:58) chegou depois, num "📍 Encaminhamento das matérias" à parte. Agora:
// matéria aprovada sem proposição identificada também segura o resumo, e o que
// chega depois EDITA a mensagem do resumo — o resultado numa mensagem só.
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
    _cfg: { admin: 1, destino: () => 'grupo', api: { sendMessage: async (_d, t) => { T.admin.push(t); } } },
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
    ok(T.complemento === 1, 'e a vigia segue, para atualizar o resumo quando o despacho sair');
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

  console.log('\n== 03/11: matéria aprovada que os Dados Abertos ainda não apontam ==');
  {
    const SEM_PROP = { texto: '📌 Matérias apreciadas…\n▪️ *Urgência ao PL 504/2021*', destinos: [], semDestino: 0, semProposicao: 1 };
    const COMPLETO = { texto: '📌 Matérias apreciadas…\n▪️ *Urgência ao PL 504/2021*\n▪️ *PL 4674/2024* (…)➡️ Vai ao Senado', destinos: ['PL 4674/2024 ➡️ Vai ao Senado'], semDestino: 0, semProposicao: 0 };
    const { F, T, s, ciclo } = montar({ resumos: [SEM_PROP, COMPLETO], despacho: t => t >= 90e3 });
    await F.tentarResumo(s, 0);
    ok(T.enviados.length === 0 && T.intervalos.length === 1, 'votação aprovada sem proposição: o resumo espera, como pelo destino');
    await ciclo(); await ciclo();
    ok(T.enviados.length === 1 && /PL 4674\/2024.*Vai ao Senado/.test(T.enviados[0]), 'e sai numa mensagem só, com a matéria e o destino');
  }

  console.log('\n== resumo já enviado: o que chega depois edita a mesma mensagem ==');
  {
    const montarAtualizar = ({ resumos, editar = async () => {} }) => {
      const T = { enviados: [], edicoes: [], marcas: [] };
      let i = 0;
      const deps = {
        pautaAtualImportada: async () => null,
        resumoSessao: async () => resumos[Math.min(i++, resumos.length - 1)],
        enviarOuFalhar: async t => { T.enviados.push(t); return [{ message_id: 900 + T.enviados.length }]; },
        marcar: (_id, p) => T.marcas.push(p),
        fatiar: t => [t],
        _cfg: { destino: () => 'grupo', api: { editMessageText: async (chat, id, t) => { await editar(chat, id, t); T.edicoes.push({ chat, id, t }); } } },
        console: { log: () => {}, warn: () => {} },
      };
      const nomes = Object.keys(deps);
      const F = new Function(...nomes, `${trecho(/async function atualizarResumoEnviado\([\s\S]*?\n}/)}; return atualizarResumoEnviado;`)(...nomes.map(n => deps[n]));
      return { F, T };
    };
    const ANTES = '📌 …\n▪️ *Urgência ao PL 504/2021*';
    const DEPOIS = { texto: ANTES + '\n▪️ *PL 4674/2024* (…)➡️ Vai ao Senado', destinos: ['x'], semDestino: 0, semProposicao: 0 };
    let { F, T } = montarAtualizar({ resumos: [DEPOIS] });
    const s = { id: 83141, estado: { resumoMsg: { chat: 'grupo', ids: [777], texto: ANTES } } };
    await F(s);
    ok(T.edicoes.length === 1 && T.edicoes[0].id === 777 && T.edicoes[0].t === DEPOIS.texto && T.enviados.length === 0, 'edita a mensagem do resumo com o texto completo — nenhuma mensagem nova');
    ok(!T.enviados.some(t => /Encaminhamento/.test(t)), 'nada de "📍 Encaminhamento das matérias" à parte');
    ok(s.estado.destinosEnviado && s.estado.resumoMsg.texto === DEPOIS.texto, 'completo: registra o texto novo e a vigia para');
    ({ F, T } = montarAtualizar({ resumos: [DEPOIS], editar: async () => { throw { description: 'Bad Request: message to edit not found' }; } }));
    const s2 = { id: 1, estado: { resumoMsg: { chat: 'grupo', ids: [777], texto: ANTES } } };
    await F(s2);
    ok(T.enviados.length === 1 && T.enviados[0] === DEPOIS.texto && s2.estado.resumoMsg.ids[0] === 901, 'mensagem que não dá para editar: manda o resumo COMPLETO de novo (e passa a editar a nova)');
    ({ F, T } = montarAtualizar({ resumos: [{ ...DEPOIS, texto: ANTES, semDestino: 1 }] }));
    const s3 = { id: 2, estado: { resumoMsg: { chat: 'grupo', ids: [777], texto: ANTES } } };
    await F(s3);
    ok(T.edicoes.length === 0 && T.enviados.length === 0 && !s3.estado.destinosEnviado, 'nada mudou: não mexe na mensagem e segue vigiando');
  }

  console.log('\n== a vigia só refaz o resumo quando aparece despacho novo ==');
  {
    const T = { chamadas: 0, intervalos: [] };
    let despachos = 1;
    const deps = {
      algumDespachoDeDestino: async () => despachos,
      atualizarResumoEnviado: async () => { T.chamadas++; },
      setInterval: fn => { const h = { fn, vivo: true }; T.intervalos.push(h); return h; },
      clearInterval: h => { if (h) h.vivo = false; },
      Date: { now: () => 0 }, console: { log: () => {}, warn: () => {} },
    };
    const nomes = Object.keys(deps);
    const F = new Function(...nomes, `${trecho(/const DESTINOS_POLL_MS = .*;/)}\n${trecho(/const DESTINOS_LIMITE_MS = .*;/)}\n${trecho(/function iniciarPollDestinos\([\s\S]*?\n}/)}; return iniciarPollDestinos;`)(...nomes.map(n => deps[n]));
    const s = { estado: {} };
    F(s);
    for (let k = 0; k < 5; k++) await T.intervalos[0].fn();
    ok(T.chamadas === 1, '5 ciclos com o mesmo despacho: o resumo é refeito UMA vez (não a cada 45 s)');
    despachos = 2; await T.intervalos[0].fn();
    ok(T.chamadas === 2, 'despacho novo publicado: refaz de novo');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
