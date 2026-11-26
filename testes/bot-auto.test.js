// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Bot · MODO AUTOMÁTICO (/auto on | off) — pedido de 26/11/2026.
//
// Com o modo ligado, a convocação de sessão COM pauta dispara sozinha o que a equipe fazia com /importar,
// /analisar e /exportar: a pauta da sessão entra no SisPode, as matérias sem nota são analisadas na chave do
// administrador e o grupo recebe o PDF, a mensagem dos apelidos e os itens do Podemos. Desligado, nada muda.
//
// O que este teste trava (sem rede: o painel e o Firebase são de mentira):
//   1. liga/desliga gravado no Firebase; na dúvida (Firebase fora do ar), o modo conta como desligado;
//   2. a rotina: desligada não faz nada; ligada, chama o painel com a chave do admin e a sessão, manda o PDF, os
//      apelidos e os itens do Podemos, e fecha com o resumo; uma vez por sessão;
//   3. os desvios: PDF da pauta ainda não publicado (tenta de novo, depois avisa), painel ocupado (espera a vez),
//      administrador sem chave, erro no painel — sempre com aviso no grupo e sem derrubar o bot;
//   4. a ligação: comando /auto só do admin, gatilho na convocação, a mesma trava do /analisar, e o painel
//      importando pelo caminho do calendário do Plenário em modo automático (que nunca sobrescreve).
// Uso: node testes/bot-auto.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const A = require(path.join(RAIZ, 'bot', 'src', 'auto.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const EV = { id: 83300, data: '2026-11-26', hora: '10:00', nome: 'Sessão Deliberativa Extraordinária' };
const RESULTADO = {
  pautaId: '26-11-2026', titulo: 'Pauta — 26/11/2026', numItens: 6, existente: false, semChave: false, comNota: 6,
  responsaveis: [{ item: 'PL 724/2003', analista: 'Pedro Ribeiro' }, { item: 'PL 294/2015', analista: 'Pedro Ribeiro' }, { item: 'PL 3944/2023', analista: 'Suellen Ali' },
    { item: 'PL 3965/2024', analista: 'Pedro Ribeiro' }, { item: 'PDL 235/2025', analista: 'Daniel Roriz' }, { item: 'PDL 366/2025', analista: '' }],
  notas: { total: 6, ok: 6, erro: 0, gerando: 0, rodando: false },
  apelidos: '▪️ *PL 724/2003* (Veículos de tração em rodovias)\n▪️ *PL 294/2015* (Religiosos de matriz africana na Previdência)',
  podemos: { texto: '*Itens do Podemos na Pauta de 26/11/2026*\n\n*▪️ Item 2. PL 294/2015* (apelido)', total: 1 },
  incertos: [], pdf: Buffer.from('%PDF-1.7 de mentira'),
};

/** Ambiente de mentira: Firebase em memória, Telegram que só registra, painel que devolve o que o teste mandar. */
function ambiente({ ligado = true, respostas = [RESULTADO], ocupadoPor = 0, chave = 'k', fbFalha = false } = {}) {
  const fb = { '/bot/auto': ligado ? { ligado: true } : null }, env = [], edicoes = [], execs = [], esperas = [];
  let trava = false, ocupado = ocupadoPor, n = 0;
  const cfg = {
    api: {
      sendMessage: async (chat, texto) => { env.push({ tipo: 'msg', chat, texto }); return { message_id: env.length }; },
      editMessageText: async (chat, id, texto) => { edicoes.push({ chat, id, texto }); },
      sendDocument: async (chat, doc, extra) => { env.push({ tipo: 'doc', chat, doc, legenda: extra && extra.caption }); return { message_id: env.length }; },
    },
    destino: () => 'GRUPO',
    perfil: () => (chave ? { apiKey: chave, provedor: 'anthropic', modelo: 'm', nome: 'Admin' } : null),
    executar: async a => {
      execs.push({ ...a, travaFechada: trava });
      if (a.onProgress) { await a.onProgress({ fase: 'pauta' }); await a.onProgress({ fase: 'notas', titulo: 'Pauta — 26/11/2026', ok: 2, total: 6, erro: 0 }); }
      const r = respostas[Math.min(n++, respostas.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    arquivo: (buf, nome) => ({ buf, nome }),
    travar: () => { if (ocupado > 0) { ocupado--; return false; } if (trava) return false; trava = true; return true; },
    destravar: () => { trava = false; },
    fbGet: async p => { if (fbFalha) throw new Error('Firebase GET 503'); return fb[p] === undefined ? null : fb[p]; },
    fbPatch: async (p, v) => { fb[p] = { ...(fb[p] || {}), ...v }; return v; },
    esperar: async ms => { esperas.push(ms); },
  };
  return { cfg, fb, env, edicoes, execs, esperas, travaAberta: () => !trava };
}

(async () => {
  console.log('== 1. liga e desliga ==');
  {
    const fb = {};
    const ler = async p => fb[p] || null, gravar = async (p, v) => { fb[p] = v; };
    ok(await A.autoLigado(ler) === false, 'sem registro, o modo está desligado (o padrão)');
    await A.setAutoLigado(true, 'Vinicius', gravar);
    ok(fb['/bot/auto'].ligado === true && fb['/bot/auto'].por === 'Vinicius' && /^\d{4}-\d\d-\d\dT/.test(fb['/bot/auto'].em) && await A.autoLigado(ler) === true, '/auto on fica gravado no Firebase (sobrevive à reinicialização do bot), com quem ligou e quando');
    await A.setAutoLigado(false, 'Vinicius', gravar);
    ok(await A.autoLigado(ler) === false && (await A.statusAuto(ler)).ligado === false, '/auto off desliga');
    ok(await A.autoLigado(async () => { throw new Error('503'); }) === false && (await A.statusAuto(async () => { throw new Error('503'); })).erro === '503', 'Firebase fora do ar: conta como desligado (não gasta a chave no escuro)');
  }

  console.log('\n== 2. a rotina ==');
  {
    const off = ambiente({ ligado: false });
    const r0 = await A.rotinaAuto(EV, off.cfg);
    ok(r0.pulou === 'desligado' && !off.env.length && !off.execs.length && !off.fb['/bot/auto_rotinas/83300'], 'desligado: nada é enviado, o painel não é aberto, nada é gravado — o bot fica como sempre foi');

    const a = ambiente();
    const r = await A.rotinaAuto(EV, a.cfg);
    ok(r.ok && r.pautaId === '26-11-2026' && a.execs.length === 1 && a.execs[0].perfil.apiKey === 'k' && JSON.stringify(a.execs[0].sessao) === '{"id":83300,"data":"2026-11-26","hora":"10:00"}', 'ligado: o painel roda uma vez, com a chave do administrador e a sessão convocada');
    ok(a.execs[0].travaFechada && a.travaAberta(), 'o painel roda com a trava fechada (um trabalho por vez) e a devolve no fim');
    ok(a.env.map(e => e.tipo).join() === 'msg,doc,msg,msg' && a.env.every(e => e.chat === 'GRUPO'), 'o grupo recebe, nesta ordem: o aviso de início, o PDF, os apelidos e os itens do Podemos');
    ok(/^⚙️ Modo automático: preparando a pauta da sessão de 26\/11, 10h — importação, notas das matérias pendentes, PDF, apelidos e itens do Podemos\./.test(a.env[0].texto), 'o aviso de início diz de que sessão é e o que vem');
    ok(a.env[1].doc.nome === 'Pauta  26112026.pdf' && a.env[1].doc.buf === RESULTADO.pdf && a.env[1].legenda === 'Pauta — 26/11/2026 — 6 itens · PDF institucional gerado pelo SisPode Bot', 'o PDF sai com o nome e a legenda do /exportar');
    ok(a.env[2].texto === RESULTADO.apelidos && a.env[3].texto === RESULTADO.podemos.texto, 'os apelidos e os itens do Podemos saem como a extensão os monta, prontos para colar no WhatsApp');
    const fim = a.edicoes.at(-1);
    ok(fim.id === 1 && /^✅ Modo automático — Pauta — 26\/11\/2026 \(6 itens\), sessão de 26\/11, 10h\.\n• Pauta: importada do site da Câmara\.\n• Notas: 6 de 6 com nota\.\n• Responsáveis: Daniel Roriz 1 · Pedro Ribeiro 3 · Suellen Ali 1 · sem responsável 1\.\n• Itens do Podemos: 1 \(mensagem abaixo\)\.\nO PDF é material de urgência: as notas geradas agora ainda não foram revisadas\.$/.test(fim.texto), 'o aviso de início vira o resumo: pauta, notas, carga de cada servidor, itens do Podemos e o lembrete de que as notas não foram revisadas');
    ok(a.edicoes.some(e => /gerando as notas… 2\/6/.test(e.texto)), 'durante a geração, o mesmo aviso mostra o andamento');
    const reg = a.fb['/bot/auto_rotinas/83300'];
    ok(reg && reg.pautaId === '26-11-2026' && reg.itens === 6 && reg.comNota === 6 && reg.iniciadaEm && reg.terminadaEm && !reg.erro, 'a rotina da sessão fica registrada');
    const r2 = await A.rotinaAuto(EV, a.cfg);
    ok(r2.pulou === 'já feita' && a.execs.length === 1 && a.env.length === 4, 'a mesma sessão não roda duas vezes (nem gasta a chave de novo)');
    const semFb = ambiente({ fbFalha: true });
    ok((await A.rotinaAuto(EV, semFb.cfg)).pulou === 'desligado' && !semFb.execs.length, 'sem ler o Firebase, não roda');
  }

  console.log('\n== 3. os desvios ==');
  {
    // a pauta da equipe já existia; sem itens do Podemos; nota que falhou; autoria não verificada
    const b = ambiente({ respostas: [{ ...RESULTADO, existente: true, comNota: 4, notas: { total: 6, ok: 4, erro: 2 }, podemos: { texto: '', total: 0 }, incertos: ['PL 724/2003'] }] });
    await A.rotinaAuto(EV, b.cfg);
    const t = b.edicoes.at(-1).texto;
    ok(b.env.map(e => e.tipo).join() === 'msg,doc,msg' && /• Pauta: já estava no SisPode — mantida como a equipe deixou\./.test(t) && /• Notas: 4 de 6 com nota — 2 sem nota \(2 falha\(s\) na geração\): gere no painel ou com \/analisar\./.test(t)
      && /• Itens do Podemos: nenhum de autoria, apensado ou relatoria\./.test(t) && /⚠ Autoria ou apensados NÃO verificados \(podem faltar entre os itens do Podemos\): PL 724\/2003\./.test(t),
      'pauta que já existia fica como a equipe deixou; sem item do Podemos não há a terceira mensagem; falha de nota e autoria não verificada são ditas no resumo');

    // administrador sem chave: importa e manda o material, sem gerar
    const c = ambiente({ chave: '', respostas: [{ ...RESULTADO, semChave: true, notas: null, comNota: 1 }] });
    await A.rotinaAuto(EV, c.cfg);
    ok(c.execs[0].perfil === null && !/notas das matérias pendentes/.test(c.env[0].texto) && /• Notas: não gerei \(o administrador está sem chave de IA no \/config\) — 1 de 6 já tinham nota\./.test(c.edicoes.at(-1).texto), 'administrador sem chave de IA: a pauta e o material saem, e o resumo diz que as notas não foram geradas');

    // o PDF da pauta ainda não está na página da sessão: tenta de novo a cada 5 minutos
    const d = ambiente({ respostas: [{ semPdf: true }, { semPdf: true }, RESULTADO] });
    const rd = await A.rotinaAuto(EV, d.cfg);
    ok(rd.ok && d.execs.length === 3 && d.esperas.join() === '300000,300000' && d.env.map(e => e.tipo).join() === 'msg,doc,msg,msg' && d.travaAberta(), 'PDF da pauta ainda fora da página da sessão: tenta de novo a cada cinco minutos, soltando o painel entre as tentativas');
    const e = ambiente({ respostas: [{ semPdf: true }] });
    const re = await A.rotinaAuto(EV, e.cfg);
    ok(re.erro && e.execs.length === 6 && e.env.length === 1 && /^⚠️ Modo automático: a Câmara ainda não pôs o PDF da pauta na página da sessão de 26\/11, 10h\./.test(e.edicoes.at(-1).texto) && e.fb['/bot/auto_rotinas/83300'].erro, 'depois de seis tentativas, avisa o grupo e desiste (o caminho manual continua valendo)');

    // painel ocupado por um /analisar: espera a vez
    const f = ambiente({ ocupadoPor: 3 });
    const rf = await A.rotinaAuto(EV, f.cfg);
    ok(rf.ok && f.esperas.join() === '30000,30000,30000' && f.execs.length === 1, 'painel ocupado (um /analisar em curso): espera a vez em vez de derrubar o trabalho do colega');
    const g = ambiente({ ocupadoPor: 1e6 });
    const rg = await A.rotinaAuto(EV, g.cfg);
    ok(rg.erro && !g.execs.length && /o painel ficou ocupado por mais de 40 minutos/.test(g.edicoes.at(-1).texto), 'painel ocupado por mais de 40 minutos: avisa e desiste');

    // erro no painel
    const h = ambiente({ respostas: [new Error('A extensão mudou — funções não encontradas no painel: importarPautaPdf')] });
    const rh = await A.rotinaAuto(EV, h.cfg);
    ok(rh.erro && h.travaAberta() && h.env.length === 1 && /^⚠️ Modo automático: não consegui preparar a pauta da sessão de 26\/11, 10h \(A extensão mudou[^)]*\)\. O que já foi feito está salvo; termine com \/importar, \/analisar e \/exportar\.$/.test(h.edicoes.at(-1).texto) && /A extensão mudou/.test(h.fb['/bot/auto_rotinas/83300'].erro),
      'erro no painel: o grupo é avisado com a causa e o caminho manual, a trava é devolvida e nada estoura');
    ok(A.cargaResponsaveis([]) === '' && A.nomePdf('') === 'pauta.pdf' && /sessão de 26\/11\.$|sessão de 26\/11…$/.test(A.textoProgresso({ data: '2026-11-26' }, { fase: 'pauta' })), 'textos de reserva: sem responsáveis, sem título e sessão sem hora');
  }

  console.log('\n== 4. a ligação com o bot e com a extensão ==');
  {
    const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8'), worker = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'worker.js'), 'utf8');
    const conv = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'convocacao.js'), 'utf8'), an = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
    const cmd = idx.slice(idx.indexOf("bot.command('auto'"), idx.indexOf('// ---------- Corrigir uma mensagem publicada no grupo'));
    ok(/if \(String\(ctx\.from\.id\) !== ADMIN_USER_ID\) return ctx\.reply\('Só o administrador liga\/desliga o modo automático/.test(cmd) && /await setAutoLigado\(arg === 'on', nomeDe\(ctx\)\)/.test(cmd) && /const s = await statusAuto\(\);/.test(cmd), '/auto on|off é só do administrador (a chave é dele); sem argumento, mostra o estado');
    ok(/\{ command: 'auto', description: /.test(idx) && /'\/auto — modo automático:/.test(idx), 'o comando está no menu do administrador e na ajuda');
    const liga = idx.slice(idx.indexOf('aoAnunciarComPauta: ev => rotinaAuto(ev, {'), idx.indexOf("console.log('Monitor de sessão desativado"));
    ok(/perfil: \(\) => getPerfil\(ADMIN_USER_ID\)/.test(liga) && /executar: rotinaPautaDaSessao/.test(liga) && /destino: \(\) => \(MONITOR_ENSAIO \? ADMIN_USER_ID : GRUPO_CHAT_ID\)/.test(liga)
      && /travar: \(\) => \{ if \(_workerOcupado\) return false; _workerOcupado = true; return true; \}/.test(liga) && /destravar: \(\) => \{ _workerOcupado = false; \}/.test(liga),
      'o gatilho é a convocação com pauta: chave do admin, mesmo destino da convocação (grupo; em ensaio, o admin) e a mesma trava do /analisar');
    ok(/if \(linhas\.length && cfg\.aoAnunciarComPauta\) \{\s*Promise\.resolve\(\)\.then\(\(\) => cfg\.aoAnunciarComPauta\(ev\)\)\.catch\(/.test(conv), 'a convocação não espera a rotina (que leva minutos) nem cai se ela falhar');
    const rot = worker.slice(worker.indexOf('async function rotinaPautaDaSessao('), worker.indexOf('/** Renderiza o HTML de impressão'));
    ok(/String\(p\.sessaoOficial\?\.eventoId \|\| ''\) === String\(ev\.id\)/.test(rot) && /await carregarPautaPorId\(ja\[0\]\);/.test(rot) && rot.indexOf('carregarPautaPorId(ja[0])') < rot.indexOf('plenPdfDaSessao(ev.id)'), 'pauta desta sessão já importada pela equipe: é ela que vale, antes de baixar qualquer coisa');
    ok(/await importarPautaPdf\(pdf\.buffer, plenNomeArquivo\(ev\.data, [^)]*\),\s*\{ eventoId: String\(ev\.id\), url: pdf\.url, data: ev\.data \}, \{ automatico: true \}\)/.test(rot), 'senão, importa a pauta oficial pelo caminho do calendário do Plenário, em modo automático');
    ok(/if \(perfil\?\.apiKey\) \{[\s\S]*?gerarEAguardar\(page,/.test(rot) && /montarMensagemApelidos\(\)\.texto/.test(rot) && /podemos: montarMensagemPropPartido\(\)/.test(rot) && /_htmlImpressaoPautaPlenario\(state\.pauta, logo, false\)/.test(rot) && !/\beval\(/.test(rot),
      'o painel gera só com chave, e o material sai das funções da extensão (apelidos, itens do Podemos, PDF); sem eval, que a página da extensão proíbe');
    // tudo o que a rotina chama existe no painel
    const pag = an + ['plenario-calendario.js', 'ia-comum.js'].map(a => fs.readFileSync(path.join(RAIZ, a), 'utf8')).join('\n');
    const nomes = ['importarPautaPdf', 'plenPdfDaSessao', 'plenNomeArquivo', 'montarMensagemApelidos', 'montarMensagemPropPartido', 'enriquecerItem', 'carregarPautaPorId', 'prepararApelidos', 'carregarLogoDataUrl', '_htmlImpressaoPautaPlenario', 'gerarTodasAsAnalises', 'carregarConfig', 'tipoLabel'];
    const faltam = nomes.filter(n => !new RegExp(`(?:async )?function ${n}\\(`).test(pag));
    ok(!faltam.length && /const enriquecimentoFalhou = /.test(an) && /<script src="plenario-calendario\.js">/.test(fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8')), `as funções que a rotina chama existem na página do Plenário${faltam.length ? ' — faltam: ' + faltam.join(', ') : ''}`);
    const imp = an.slice(an.indexOf('async function importarPautaPdf('), an.indexOf('function normalizarItem('));
    ok(/if \(escolha && escolha\.existente\) \{[\s\S]*?await carregarPautaPorId\(escolha\.existente\);\s*return 'existente';/.test(imp) && /if \(opcoes\.automatico\) return iguais \? \{ existente: idPauta \} : await proximoIdLivre\(idPauta\);/.test(an)
      && imp.indexOf('herdarResponsaveis(state.pauta.itens') > 0 && imp.indexOf('herdarResponsaveis(state.pauta.itens') < imp.indexOf('distribuirResponsaveis(state.pauta.itens'),
      'na extensão, a importação automática não pergunta nem sobrescreve; a pauta nova mantém o responsável de quem já acompanhava a matéria e sorteia o resto');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
