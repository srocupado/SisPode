// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Bot: resposta do /faltamvotar (bot/src/faltamvotar.js).
//
// Pedido de 24/11/2026: a resposta lista numa só seção "🔴 Não votaram (N)" quem da bancada ainda não votou —
// antes saía "✅ Todos os presentes da bancada já votaram." seguido de "⚫ Fora da Casa (N)" com esses nomes.
// O motivo: no painel (infoleg ws-plenario/votacao/{id}), o deputado só aparece como presente (indPresente)
// DEPOIS de votar — medido em 23/11/2026, na votação 14017, de 12 em 12 segundos, nenhum "presente sem voto" —,
// então quem faltava ia para "Fora da Casa" e o resumo dizia que os presentes já tinham votado.
//
// Fixture: testes/fixtures/faltamvotar/painel-14017-2257.json — o painel real às 22:57:47 (bancada do Podemos,
// 15 de 27 votos; os 12 que faltavam são os do print do bot naquele instante), com 6 deputados de outros partidos.
// Uso: node testes/bot-faltamvotar.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const { faltamVotar, formatarFaltantes, formatarFaltantesTexto } = require(path.join(RAIZ, 'bot', 'src', 'faltamvotar.js'));
const PAINEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faltamvotar', 'painel-14017-2257.json'), 'utf8'));
const SESSAO = { sessaoAtual: { numSessao: 184, nomSessao: 'EXTRAORDINÁRIA Nº 184 - 23/11/2026' },
  votacaoAtual: { tipo: 'Votacao', idVotacao: 14017, tituloVotacao: 'PLP  Nº 299/2026 - DTQ 1 - FDR PSOL-REDE', tipoVotacao: 'E' } };
const resp = corpo => ({ ok: true, status: 200, text: async () => JSON.stringify(corpo) });

(async () => {
  console.log('== 1. o painel real das 22:57:47 ==');
  global.fetch = async u => (/sessao-atual/.test(u) ? resp(SESSAO) : /ws-plenario\/votacao\/14017$/.test(u) ? resp(PAINEL) : { ok: false, status: 404, text: async () => '' });
  const r = await faltamVotar('PODE');
  const txt = formatarFaltantes(r);
  const esperado = ['Bruno Ganem (SP)', 'Cristiane Lopes (RO)', 'David Soares (SP)', 'Delegado Bruno Lima (SP)', 'Dra. Alessandra Haber (PA)',
    'Felipe Francischini (PR)', 'Fábio Macedo (MA)', 'Gilson Daniel (ES)', 'Luiz Carlos Hauly (PR)', 'Rafael Fera (RO)', 'Sargento Portugal (RJ)', 'Tiago Dimas (TO)'];
  ok(r.aberta && r.total === 27 && r.votaram === 15, 'bancada de 27, 15 já votaram (só a bancada do Podemos, os outros partidos ficam de fora)');
  ok(JSON.stringify(r.naoVotaram) === JSON.stringify(esperado), 'os 12 que não votaram, em ordem alfabética — os mesmos do print do bot');
  ok(txt === `🗳 *PLP Nº 299/2026* — bancada PODE (15/27 já votaram)\n\n🔴 Não votaram (12):\n${esperado.map(n => `• ${n}`).join('\n')}`,
    'resposta no formato pedido: cabeçalho e "🔴 Não votaram (12):" com um nome por linha');
  ok(!/Fora da Casa|presentes/i.test(txt), 'sem "Fora da Casa" e sem "Todos os presentes já votaram"');

  console.log('\n== 2. o exemplo do pedido e a bancada completa ==');
  const ex = { aberta: true, prop: 'PLP Nº 299/2026', total: 27, votaram: 25, naoVotaram: ['Felipe Becari (SP)', 'Marangoni (SP)'], presentesNaoVotaram: [], foraDaCasa: ['Felipe Becari (SP)', 'Marangoni (SP)'] };
  ok(formatarFaltantes(ex) === '🗳 *PLP Nº 299/2026* — bancada PODE (25/27 já votaram)\n\n🔴 Não votaram (2):\n• Felipe Becari (SP)\n• Marangoni (SP)', 'exemplo do pedido (25/27, Felipe Becari e Marangoni): sai exatamente como pedido');
  ok(formatarFaltantes({ ...ex, votaram: 27, naoVotaram: [] }) === '🗳 *PLP Nº 299/2026* — bancada PODE (27/27 já votaram)\n\n✅ Toda a bancada já votou.', 'todos votaram: "✅ Toda a bancada já votou."');
  ok(formatarFaltantes({ aberta: false, motivo: 'não há votação em curso' }) === 'Sem lista de faltantes agora — não há votação em curso.', 'sem votação nominal: a mensagem de antes, sem mudança');

  console.log('\n== 3. pergunta em texto livre: a mesma mensagem do /faltamvotar (24/11/2026, PL 1969/2022) ==');
  // Pelo agente, a lista ia para o modelo, que reescrevia ("Atualmente, 25 parlamentares… ainda não registraram")
  // e cortava o "(2/27 já votaram)": a lista de 25 parecia a bancada inteira. Fixture: painel real da votação 14025,
  // com a bancada no instante da pergunta (só Delegado Palumbo e Dra. Alessandra Haber tinham voto, às 17:30).
  const P2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faltamvotar', 'painel-14025-reconstruido.json'), 'utf8'));
  const S2 = { sessaoAtual: { numSessao: 187, nomSessao: 'EXTRAORDINÁRIA Nº 187 - 24/11/2026' },
    votacaoAtual: { tipo: 'Votacao', idVotacao: 14025, tituloVotacao: 'PL   Nº 1969/2022 - SUBSTITUTIVO OFERECIDO PELO RELATOR', tipoVotacao: 'E' } };
  global.fetch = async u => (/sessao-atual/.test(u) ? resp(S2) : /ws-plenario\/votacao\/14025$/.test(u) ? resp(P2) : { ok: false, status: 404, text: async () => '' });
  const r2 = await faltamVotar('PODE');
  const t2 = formatarFaltantes(r2);
  ok(r2.total === 27 && r2.votaram === 2 && r2.naoVotaram.length === 25, 'bancada de 27: 2 votaram, 25 faltam');
  ok(t2.startsWith('🗳 *PL Nº 1969/2022* — bancada PODE (2/27 já votaram)\n\n🔴 Não votaram (25):\n• Antonio Carlos Rodrigues (SP)'), 'mensagem: "(2/27 já votaram)" no cabeçalho e "🔴 Não votaram (25)"');
  ok(!/Delegado Palumbo|Alessandra Haber/.test(t2), 'quem já votou não está na lista');
  const AG = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'agente.js'), 'utf8'), IX = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
  const acoes = AG.slice(AG.indexOf('const CATALOGO_ACOES'), AG.indexOf('`;', AG.indexOf('const CATALOGO_ACOES')));
  ok(/- "faltam_votar" \{\}:/.test(acoes) && /const ACOES = \[[^\]]*'faltam_votar'/.test(AG), 'agente: "faltam_votar" é AÇÃO (envia a lista pronta), não consulta que o modelo reescreve');
  ok((AG.match(/- "faltam_votar"/g) || []).length === 1 && !/faltam_votar: async/.test(IX), 'saiu das ferramentas de consulta');
  ok(/case 'faltam_votar':\s+return responderFaltantes\(ctx, \{ textoLivre: true \}\);/.test(IX) && /async function cmdFaltamVotar[\s\S]*?return responderFaltantes\(ctx\);/.test(IX),
    'a ação usa o texto da pergunta livre; o /faltamvotar, o formato dele');

  console.log('\n== 4. texto da pergunta livre, como pedido em 24/11/2026 ==');
  const pedido = 'Até o momento, 19 de 27 deputados do Podemos votaram no PL nº 1969/2022. Segue a relação dos parlamentares da bancada que ainda não registraram voto:\n\n'
    + ['Felipe Becari (SP)', 'Gilberto Nascimento (SP)', 'Glaustin da Fokus (GO)', 'Luiz Carlos Hauly (PR)', 'Nely Aquino (MG)', 'Rafael Fera (RO)', 'Renata Abreu (SP)', 'Rodrigo Gambale (SP)'].map(n => `• ${n}`).join('\n');
  const r19 = { ...r2, votaram: 19, naoVotaram: ['Felipe Becari (SP)', 'Gilberto Nascimento (SP)', 'Glaustin da Fokus (GO)', 'Luiz Carlos Hauly (PR)', 'Nely Aquino (MG)', 'Rafael Fera (RO)', 'Renata Abreu (SP)', 'Rodrigo Gambale (SP)'] };
  ok(formatarFaltantesTexto(r19) === pedido, 'sai exatamente o texto pedido (19 de 27, PL nº 1969/2022, 8 nomes)');
  ok(formatarFaltantesTexto(r2).startsWith('Até o momento, 2 de 27 deputados do Podemos votaram no PL nº 1969/2022. Segue'), 'o caso dos 25: "2 de 27" na primeira linha');
  ok(formatarFaltantesTexto({ ...r2, votaram: 27, naoVotaram: [] }) === 'Até o momento, 27 de 27 deputados do Podemos votaram no PL nº 1969/2022. Toda a bancada já votou.', 'toda a bancada votou');
  ok(/votaram na MPV nº 1300\/2026\./.test(formatarFaltantesTexto({ ...r19, prop: 'MPV Nº 1300/2026' })) && /votaram na PEC nº 66\/2023\./.test(formatarFaltantesTexto({ ...r19, prop: 'PEC Nº 66/2023' })), '"na" para MPV e PEC');
  ok(formatarFaltantesTexto({ aberta: false, motivo: 'não há votação em curso' }) === 'Sem lista de faltantes agora — não há votação em curso.', 'sem votação nominal: a mensagem de sempre');

  // ACOMPANHAMENTO AUTOMÁTICO (26/11/2026): depois de 257 votos na Casa, uma mensagem no grupo com quem do Podemos
  // falta votar, atualizada a cada 15 segundos, até a bancada toda votar ou a votação encerrar.
  console.log('\n== 5. acompanhamento automático (/faltamvotar auto on|off) ==');
  {
    const F = require(path.join(RAIZ, 'bot', 'src', 'faltamvotar.js'));
    ok(F.ACOMP_INTERVALO_MS === 15000 && F.ACOMP_MINIMO_CASA === 257, 'a cada 15 segundos, depois de 257 votos na Casa');
    const ret = (casa, votaram, faltam, extra = {}) => ({ aberta: true, idVotacao: 14017, prop: 'PLP Nº 299/2026', total: 27, votaram, naoVotaram: faltam, casaRegistrou: casa, casaTotal: 513, ...extra });
    /** Ambiente: o painel devolve a fila `leituras` (a última se repete); o relógio anda 15 s por passo. */
    const amb = (leituras, { ligado = true, porId = null, salvo = null } = {}) => {
      const env = [], ed = [], marcas = [], t = { n: 0, parou: 0, fn: null };
      let i = 0, seg = 0, on = ligado;
      const A = F.criarAcompanhamentoFaltantes({
        consultarAtual: async () => { const r = leituras[Math.min(i++, leituras.length - 1)]; if (r instanceof Error) throw r; return r; },
        consultarPorId: async () => { if (porId instanceof Error) throw porId; return porId; },
        enviar: async texto => { env.push(texto); return { chat: 'GRUPO', mid: 900 + env.length }; },
        editar: async (msg, texto) => { ed.push({ ...msg, texto }); },
        ligado: () => on, aoEnviar: (id, m) => marcas.push(['msg', id, m.mid]), aoConcluir: id => marcas.push(['fim', id]),
        agora: () => new Date(Date.UTC(2026, 10, 24, 1, 57, 47) + (seg++) * 15000),
        timers: { setInterval: (fn, ms) => { t.fn = fn; t.ms = ms; return ++t.n; }, clearInterval: () => { t.parou++; t.fn = null; } },
      });
      // `iniciar` espera o primeiro passo, que o acompanhamento dá sozinho ao começar (é a 1ª leitura da fila)
      const iniciar = async (...args) => { const r = A.acompanhar(...args); await new Promise(x => setTimeout(x, 5)); return r; };
      return { A, env, ed, marcas, t, iniciar, desligar: () => { on = false; }, passos: async n => { for (let k = 0; k < n; k++) await A.passo(); } };
    };
    const TIT = 'PLP  Nº 299/2026 - DTQ 1 - FDR PSOL-REDE';

    // antes dos 257: silêncio; depois: uma mensagem, que se atualiza
    const a = amb([ret(120, 5, ['A (SP)', 'B (RJ)', 'C (PR)']), ret(256, 10, ['A (SP)', 'B (RJ)', 'C (PR)']), ret(257, 24, ['A (SP)', 'B (RJ)', 'C (PR)']), ret(300, 25, ['A (SP)', 'C (PR)']), ret(300, 25, ['A (SP)', 'C (PR)']), ret(410, 27, [])]);
    ok(await a.iniciar(14017, TIT) === true && a.t.ms === 15000 && a.A.acompanhar(14017, TIT) === false, 'a primeira nominal vista começa o acompanhamento, de 15 em 15 segundos; ver a mesma votação de novo não começa outro');
    await a.passos(1);   // 2ª leitura: ainda abaixo de 257
    ok(a.env.length === 0 && a.ed.length === 0, 'com menos de 257 votos na Casa, nada vai ao grupo (quem quiser a lista, pede)');
    await a.passos(1);
    ok(a.env.length === 1 && a.env[0] === '🗳 Votação nominal — PLP Nº 299/2026 - DTQ 1 - FDR PSOL-REDE\nNa Casa, 257 de 513 deputados já votaram.\nAté o momento, 24 de 27 deputados do Podemos votaram. Ainda não registraram voto:\n\n• A (SP)\n• B (RJ)\n• C (PR)\n\nAtualizado às 22:58:17 — esta mensagem se atualiza a cada 15 segundos.',
      'no 257º voto, a mensagem vai ao grupo: a votação (com o destaque), a contagem da Casa, a da bancada, quem falta e a hora de Brasília');
    await a.passos(2);
    ok(a.env.length === 1 && a.ed.length === 2 && a.ed.every(e => e.chat === 'GRUPO' && e.mid === 901) && /Na Casa, 300 de 513/.test(a.ed[0].texto) && /25 de 27 deputados do Podemos votaram\. Ainda não registraram voto:\n\n• A \(SP\)\n• C \(PR\)\n\nAtualizado às 22:58:32/.test(a.ed[0].texto) && /Atualizado às 22:58:47/.test(a.ed[1].texto),
      'daí em diante é a MESMA mensagem, editada a cada passo: a lista encolhe e a hora anda mesmo sem voto novo');
    await a.passos(1);
    ok(a.ed.at(-1).texto === '✅ Votação nominal — PLP Nº 299/2026 - DTQ 1 - FDR PSOL-REDE\nToda a bancada do Podemos votou (27 de 27).\nNa Casa, 410 de 513 deputados já votaram.' && a.t.parou === 1 && a.A.emCurso() === null,
      'quando o último vota, a mensagem vira "✅ Toda a bancada do Podemos votou" e o acompanhamento para');
    ok(JSON.stringify(a.marcas) === '[["msg",14017,901],["fim",14017]]' && a.A.acompanhar(14017, TIT) === false, 'a mensagem e o fim ficam registrados; a mesma votação não recomeça');

    // a votação encerra com gente sem votar
    const final = { prop: 'PLP Nº 299/2026', total: 27, votaram: 26, naoVotaram: ['C (PR)'], casaRegistrou: 480, casaTotal: 513 };
    const b = amb([ret(300, 25, ['A (SP)', 'C (PR)']), { aberta: false, motivo: 'não há votação em curso' }, { aberta: false, motivo: 'não há votação em curso' }], { porId: final });
    await b.iniciar(14017, 'PLP Nº 299/2026');
    await b.passos(1);
    ok(b.env.length === 1 && b.ed.length === 0 && b.A.emCurso(), 'uma leitura sem votação não encerra nada (pode ser falha de rede)');
    await b.passos(1);
    ok(b.ed.at(-1).texto === '🗳 Votação nominal encerrada — PLP Nº 299/2026\nNa Casa, 480 de 513 deputados votaram.\n26 de 27 deputados do Podemos votaram. Não registraram voto:\n\n• C (PR)' && b.A.emCurso() === null,
      'na segunda leitura seguida, a mensagem fecha com o retrato FINAL da votação (quem votou nos últimos segundos sai da lista)');
    const c = amb([ret(300, 25, ['A (SP)', 'C (PR)']), ret(1, 0, ['X (SP)'], { idVotacao: 14018 })], { porId: new Error('500') });
    await c.iniciar(14017, ''); await c.passos(1);
    ok(/^🗳 Votação nominal encerrada — PLP Nº 299\/2026\n/.test(c.ed.at(-1).texto) && /Não registraram voto \(última leitura, às 22:57:47\):\n\n• A \(SP\)\n• C \(PR\)$/.test(c.ed.at(-1).texto) && c.A.emCurso() === null,
      'outra votação já aberta no painel: encerra de imediato; sem o retrato final, vale a última leitura, com a hora dita');
    const d = amb([ret(100, 3, ['A (SP)']), { aberta: false, motivo: 'x' }, { aberta: false, motivo: 'x' }]);
    await d.iniciar(14017, ''); await d.passos(2);
    ok(d.env.length === 0 && d.ed.length === 0 && d.A.emCurso() === null && JSON.stringify(d.marcas) === '[["fim",14017]]', 'votação que encerra antes dos 257 votos: nada foi nem vai ao grupo');

    // tropeços
    const e = amb([ret(300, 25, ['A (SP)']), new Error('rede'), { aberta: false, motivo: 'o painel ainda não trouxe os votos individuais', idVotacao: 14017 }, { aberta: false, motivo: 'idem', idVotacao: 14017 }, ret(310, 26, ['A (SP)'])]);
    await e.iniciar(14017, ''); await e.passos(3);
    ok(e.env.length === 1 && e.ed.length === 0 && e.A.emCurso(), 'falha de leitura e painel momentaneamente sem os votos não encerram o acompanhamento');
    await e.passos(1);
    ok(e.ed.length === 1 && /310 de 513/.test(e.ed[0].texto), 'e na leitura boa seguinte a mensagem volta a se atualizar');
    const f = amb([ret(300, 25, ['A (SP)'])]);
    await f.iniciar(14017, ''); f.desligar(); await f.passos(1);
    ok(f.env.length === 1 && f.ed.length === 1 && /Última leitura às 22:57:47\. O acompanhamento automático foi desligado: esta mensagem não é mais atualizada\.$/.test(f.ed[0].texto) && !/se atualiza a cada 15 segundos/.test(f.ed[0].texto) && f.A.emCurso() === null && !f.marcas.some(m => m[0] === 'fim'),
      '/faltamvotar auto off no meio da votação: para de atualizar e a mensagem passa a dizer isso (não fica prometendo atualização)');
    const f2 = amb([ret(300, 25, ['A (SP)'])]);
    await f2.iniciar(14017, ''); await f2.A.desligar();
    ok(f2.ed.length === 1 && /foi desligado/.test(f2.ed[0].texto) && f2.t.parou === 1 && f2.A.emCurso() === null, 'o mesmo pelo comando (o monitor chama desligar): edita na hora, sem esperar o passo seguinte');
    const f3 = amb([ret(310, 26, ['A (SP)'])]);
    ok(await f3.iniciar(14017, '', { chat: 'GRUPO', mid: 901 }) === true && f3.ed.length === 1 && /se atualiza a cada 15 segundos/.test(f3.ed[0].texto), 'religando com a votação ainda aberta, a mesma mensagem volta a ser atualizada');
    // mensagem apagada no grupo: a edição passa a falhar sempre
    const apagada = { marcas: [] };
    const AA = F.criarAcompanhamentoFaltantes({ consultarAtual: async () => ret(300 + Math.floor(Math.random() * 50), 25, ['A (SP)'], { idVotacao: 14030 }), consultarPorId: async () => null,
      enviar: async () => ({ chat: 'GRUPO', mid: 1 }), editar: async () => { throw new Error('Bad Request: message to edit not found'); }, ligado: () => true,
      aoConcluir: id => apagada.marcas.push(['fim-apagada', id]), agora: () => new Date(Date.now() + Math.random() * 1e6), timers: { setInterval: () => 1, clearInterval: () => {} } });
    const logOriginal = console.warn; console.warn = () => {};
    AA.acompanhar(14030, ''); await new Promise(x => setTimeout(x, 5));
    for (let k = 0; k < F.ACOMP_MAX_ERROS - 1; k++) await AA.passo();
    const aindaTentando = !!AA.emCurso();
    await AA.passo();
    console.warn = logOriginal;
    ok(F.ACOMP_MAX_ERROS === 8 && aindaTentando && AA.emCurso() === null && apagada.marcas.some(m => m[0] === 'fim-apagada' && m[1] === 14030) && AA.acompanhar(14030, '') === false,
      'mensagem apagada no grupo (a edição falha sempre): depois de oito tentativas o acompanhamento desiste desta votação, em vez de insistir até a próxima nominal');
    ok(amb([ret(300, 25, ['A (SP)'])], { ligado: false }).A.acompanhar(14017, '') === false, 'desligado, nenhuma votação é acompanhada');
    // o bot reiniciou no meio da votação: retoma a mesma mensagem; votação já encerrada não recomeça
    const g = amb([ret(300, 25, ['A (SP)'])]);
    await g.iniciar(14017, '', { chat: 'GRUPO', mid: 777 });
    ok(g.env.length === 0 && g.ed.length === 1 && g.ed[0].mid === 777, 'bot reiniciado no meio da votação: continua editando a mensagem que já estava no grupo, sem mandar outra');
    ok(amb([ret(300, 25, [])]).A.acompanhar(14017, '', { fim: true }) === false && amb([ret(300, 25, [])]).A.acompanhar(14017, '', true) === false, 'votação já encerrada (ou avisada pelo formato antigo) não recomeça depois do reinício');
    const h = amb([ret(300, 27, [])]);
    await h.iniciar(14017, '');
    ok(h.env.length === 1 && /^✅ Votação nominal — PLP Nº 299\/2026\nToda a bancada do Podemos votou \(27 de 27\)\./.test(h.env[0]) && h.A.emCurso() === null, 'bancada toda já votou quando a Casa chega a 257: um aviso só, e fim');

    // Varredura de 26/11/2026 (M1): painel fora do ar NÃO é votação encerrada.
    const FALHA = { aberta: false, falha: true, motivo: 'não consegui ler o painel da Câmara agora' };
    const m1 = amb([ret(300, 25, ['A (SP)']), FALHA, FALHA, FALHA, FALHA, ret(320, 26, ['A (SP)'])]);
    await m1.iniciar(14017, ''); await m1.passos(4);
    ok(m1.env.length === 1 && m1.ed.length === 0 && m1.A.emCurso() && !m1.marcas.some(x => x[0] === 'fim'), 'quatro leituras seguidas sem resposta do painel (um minuto fora do ar): a mensagem NÃO é fechada como "encerrada"');
    await m1.passos(1);
    ok(m1.ed.length === 1 && /320 de 513/.test(m1.ed[0].texto) && !/encerrada/.test(m1.ed[0].texto), 'quando o painel volta, a mesma mensagem segue sendo atualizada');
    const m1b = amb([ret(300, 25, ['A (SP)']), FALHA]);
    await m1b.iniciar(14017, ''); await m1b.passos(F.ACOMP_MAX_FALHAS);
    ok(F.ACOMP_MAX_FALHAS === 40 && m1b.ed.length === 1 && /⚠️ Última leitura às 22:57:47\. O painel da Câmara parou de responder: a lista pode estar desatualizada\.$/.test(m1b.ed[0].texto) && !/se atualiza a cada 15 segundos/.test(m1b.ed[0].texto) && m1b.A.emCurso() === null && !m1b.marcas.some(x => x[0] === 'fim'),
      'dez minutos sem resposta: a mensagem avisa que parou de ser atualizada e o acompanhamento é suspenso — sem dar a votação por concluída');
    const m1c = amb([ret(330, 26, ['A (SP)'])]);
    ok(await m1c.iniciar(14017, '', { chat: 'GRUPO', mid: 901 }) === true && m1c.env.length === 0 && m1c.ed.length === 1 && m1c.ed[0].mid === 901, 'se o painel volta com a votação aberta, o monitor a entrega de novo e a mesma mensagem é retomada');
    // (M2) nominais em sequência: a nova abre antes do passo seguinte da anterior
    const finalA = { prop: 'PLP Nº 299/2026', total: 27, votaram: 26, naoVotaram: ['C (PR)'], casaRegistrou: 470, casaTotal: 513 };
    const m2 = amb([ret(300, 25, ['A (SP)', 'C (PR)']), ret(40, 2, ['X (SP)'], { idVotacao: 14018 })], { porId: finalA });
    await m2.iniciar(14017, 'PLP Nº 299/2026 - DTQ 1');
    ok(await m2.iniciar(14018, 'PLP Nº 299/2026 - DTQ 2') === true && m2.A.emCurso().id === 14018, 'outra nominal abre com a anterior ainda em acompanhamento: a nova passa a ser acompanhada');
    ok(m2.ed.length === 1 && m2.ed[0].mid === 901 && m2.ed[0].texto === '🗳 Votação nominal encerrada — PLP Nº 299/2026 - DTQ 1\nNa Casa, 470 de 513 deputados votaram.\n26 de 27 deputados do Podemos votaram. Não registraram voto:\n\n• C (PR)' && JSON.stringify(m2.marcas) === '[["msg",14017,901],["fim",14017]]',
      'e a mensagem da anterior é FECHADA com o retrato final, em vez de ficar para sempre dizendo que se atualiza');
    ok(m2.env.length === 1 && m2.A.acompanhar(14017, '') === false, 'a nova (ainda abaixo de 257 votos) não mandou nada; a anterior não recomeça');
    // faltamVotar: falha de rede × painel sem sessão
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    const semRede = await faltamVotar('PODE');
    global.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
    const erro503 = await faltamVotar('PODE');
    global.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
    const semSessao = await faltamVotar('PODE');
    ok(semRede.falha === true && erro503.falha === true && /não consegui ler o painel/.test(semRede.motivo) && !semSessao.falha && semSessao.motivo === 'não há sessão aberta no momento', 'faltamVotar distingue "não consegui ler o painel" (rede, HTTP de erro) de "não há sessão aberta" (o painel respondeu vazio)');
    const C = require(path.join(RAIZ, 'bot', 'src', 'plenariocosev.js'));
    global.fetch = async () => { throw new Error('x'); };
    ok(await C.sessaoAtual() === null && (await C.leituraDaSessao()).falha === true, 'quem usa sessaoAtual continua recebendo null na falha (nada muda para o monitor)');

    // painel sem ninguém do partido não é "toda a bancada votou (0 de 0)"
    global.fetch = async u => (/sessao-atual/.test(u) ? resp(SESSAO) : /ws-plenario\/votacao\/14017$/.test(u) ? resp({ nomeProposicao: 'PL 1/2026', parlamentaresVotos: [{ nomeParlamentar: 'Fulano', siglaPartido: 'PT', uf: 'SP', dataRegistroVoto: '2026-11-26T10:00:00' }] }) : { ok: false, status: 404, text: async () => '' });
    const semBancada = await faltamVotar('PODE');
    ok(semBancada.aberta === false && semBancada.idVotacao === 14017 && /não trouxe os votos individuais da bancada/.test(semBancada.motivo) && await F.retratoDaVotacao(14017, 'PODE') === null && !/0\/0|Toda a bancada/.test(formatarFaltantes(semBancada)),
      'painel sem nenhum deputado do partido: não vira "0 de 0 — toda a bancada votou"; quem pede recebe que o painel ainda não trouxe os votos, e o acompanhamento espera');

    // faltamVotar diz que a votação continua aberta mesmo sem os votos individuais; o retrato por id serve à encerrada
    global.fetch = async u => (/sessao-atual/.test(u) ? resp(SESSAO) : /ws-plenario\/votacao\/14017$/.test(u) ? resp({ parlamentaresVotos: [] }) : { ok: false, status: 404, text: async () => '' });
    const semVotos = await faltamVotar('PODE');
    ok(semVotos.aberta === false && semVotos.idVotacao === 14017, 'painel aberto ainda sem os votos: "não aberta", mas com o id da votação (o acompanhamento não toma por encerramento)');
    global.fetch = async u => (/ws-plenario\/votacao\/14017$/.test(u) ? resp(PAINEL) : { ok: false, status: 404, text: async () => '' });
    const porId = await F.retratoDaVotacao(14017, 'PODE');
    ok(porId && porId.total === 27 && porId.votaram === 15 && porId.naoVotaram.length === 12 && porId.casaTotal === PAINEL.parlamentaresVotos.length && porId.idVotacao === 14017, 'o retrato de uma votação pelo id não depende de a sessão ainda mostrá-la (serve ao fechamento)');

    // a ligação com o monitor e com o comando
    const mon = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'monitor.js'), 'utf8'), idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
    ok(/if \(!v\.simbolica && String\(v\.tipoVotacao \|\| ''\)\.toUpperCase\(\) === 'E' && v\.id != null && _faltantesAuto\) \{\s*acompFaltantes\(\)\.acompanhar\(v\.id, v\.titulo, est\.faltantesAvisados\[v\.id\]\);/.test(mon) && !/FALTANTES_LIMIAR|presentesNaoVotaram/.test(mon),
      'o monitor entrega ao acompanhamento toda nominal em curso (a de destaque também); a rede de segurança dos 80% saiu');
    ok(/ligado: \(\) => !!\(_cfg && _cfg\.ligado && _faltantesAuto\)/.test(mon) && /editar: \(msg, texto\) => _cfg\.api\.editMessageText\(msg\.chat, msg\.mid, texto\)/.test(mon) && /aoConcluir: id => gravar\(id, \{ fim: true \}\)/.test(mon) && /if \(!v && _acompFaltantes\) _acompFaltantes\.desligar\(\)\.catch\(/.test(mon),
      'liga/desliga pelo mesmo /faltamvotar auto on|off; a mensagem é editada no lugar; o estado fica gravado na sessão');
    ok(/Acompanhamento automático dos faltantes LIGADO\./.test(idx) && /Acompanhamento automático dos faltantes DESLIGADO\. A lista continua saindo para quem pedir/.test(idx) && !/Rede de segurança de faltantes/.test(idx), 'o comando fala do acompanhamento, não mais da rede de segurança');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
