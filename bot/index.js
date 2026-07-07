'use strict';
const crypto = require('crypto');
const { Bot, InlineKeyboard, InputFile } = require('grammy');

const { BOT_TOKEN, GRUPO_CHAT_ID, ADMIN_USER_ID, CRON_MINUTOS, TRANSCRIBE_GEMINI_KEY, SENHA_ACESSO, MONITOR_ATIVO, MONITOR_ENSAIO } = require('./src/config');
const { verificarPautaNova, resumoPauta, baixarPautaAtual, montarPautaFirebase, pautaJaExiste, gravarPauta, rotuloSituacao, rotuloPauta, ultimasPautas, pautaPorId } = require('./src/pauta');
const { getPerfil, setPerfil, removerChave, isAutorizado, autorizar, revogar, listarAutorizados } = require('./src/store');
const { PROVEDORES, testarChave, transcreverAudio } = require('./src/ia');
const { perguntar, limparConversa, listarDocumentos, agregarDocumentos } = require('./src/perguntar');
const { rotear } = require('./src/router');
const { listarVotacoesDia, placarVotacao } = require('./src/votacao');
const { descobrirSessaoPortal, paginaSessao, parseItens, parsePlacarPortal, identificarItem } = require('./src/portal');
const { importarOrdemDoDiaDeHoje, importarOrdemDoDia, eventosDeliberativos, buscarOrdemDoDia } = require('./src/odd');
const { definirPautaAtiva, pautaDoUsuario } = require('./src/sessao');
const { imagemVotacao } = require('./src/imagem');
const { analisarPauta, exportarPdfPauta } = require('./src/worker');
const { iniciarMonitor, setMonitorLigado, statusMonitor, marcarOddImportada } = require('./src/monitor');
const { extrairTextoPdf, parsearPauta } = require('./src/parser');

const bot = new Bot(BOT_TOKEN);

const TEXTO_AJUDA =
  'SisPode Bot — Liderança do Podemos na Câmara\n\n' +
  'Comandos:\n' +
  '/pauta — verifica se há Pauta da Semana nova no site da Câmara\n' +
  '/importar — importa a pauta atual para o SisPode (pede confirmação)\n' +
  '(também importo uma pauta se você me ENVIAR O PDF dela aqui no privado)\n' +
  '/ordemdodia — importa a Ordem do Dia (pauta diária) da sessão de hoje\n' +
  '/sispode — lista as pautas do SisPode e deixa você ESCOLHER qual usar\n' +
  '/analisar — gera as notas técnicas da pauta importada (na sua chave; pede confirmação)\n' +
  '/exportar — gera o PDF institucional da pauta com as análises\n' +
  '/perguntar PL 1234/2026 <pergunta> — pergunta sobre um item da pauta (usa a nota técnica e os documentos da matéria)\n' +
  '/perguntar <pergunta> — pergunta sobre a pauta em geral\n' +
  '/votacao [dd/mm/aaaa] — votações nominais do Plenário; gera a IMAGEM do placar da bancada\n' +
  '/monitor — status do monitor de sessão ao vivo (admin: /monitor on|off)\n' +
  '/documentos PL 1234/2026 — lista documentos da tramitação que NÃO entraram na nota\n' +
  '/agregar 1,3 — inclui documentos listados na conversa (a IA passa a considerá-los)\n' +
  '/limpar — zera a conversa atual com a IA\n' +
  '/config — configura seu provedor e chave de IA (somente no privado)\n' +
  '/minhachave — mostra qual chave está configurada (mascarada)\n' +
  '/removerchave — apaga sua chave\n' +
  '/modelo <id> — troca o modelo do seu provedor (opcional)\n' +
  '/ajuda — esta mensagem\n\n' +
  'Também entendo linguagem natural e mensagens de voz (no privado, ou me mencionando no grupo) — para isso é preciso ter a chave configurada em /config.';

// Estados voláteis
const configPendente = new Map();  // userId → { provedor }        (fluxo /config)
const importPendente = new Map();  // token  → { doc, ts }         (confirmação de /importar)
const pedidosAcesso  = new Map();  // userId → nome                (aprovação pelo admin)
const pautaEscolha   = new Map();  // token  → { id, ts }          (escolha de pauta do Firebase)
const IMPORT_TTL = 10 * 60e3;

const ehPrivado = ctx => ctx.chat?.type === 'private';
const nomeDe    = ctx => [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || (ctx.from?.username ? '@' + ctx.from.username : '');

// Fatia mensagens acima do limite de 4096 do Telegram, quebrando em fim de
// linha; um teclado inline opcional vai na ÚLTIMA parte.
function fatiarMensagem(texto, tam = 3900) {
  const partes = [];
  let resto = String(texto || '');
  while (resto.length > tam) {
    let corte = resto.lastIndexOf('\n', tam);
    if (corte < tam * 0.5) corte = tam;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\n+/, '');
  }
  if (resto) partes.push(resto);
  return partes;
}

async function responderLongo(ctx, texto, teclado) {
  const partes = fatiarMensagem(texto);
  for (let i = 0; i < partes.length; i++) {
    const ultima = i === partes.length - 1;
    await ctx.reply(partes[i], ultima && teclado ? { reply_markup: teclado } : undefined);
  }
}

async function enviarLongo(api, chatId, texto, teclado) {
  const partes = fatiarMensagem(texto);
  for (let i = 0; i < partes.length; i++) {
    const ultima = i === partes.length - 1;
    await api.sendMessage(chatId, partes[i], ultima && teclado ? { reply_markup: teclado } : undefined);
  }
}

// ============================================================
//  Acesso — palavra-chave (SENHA_ACESSO) ou aprovação do admin
// ============================================================
// Controle antichute: 5 erros de senha → bloqueio de 1 h.
const tentativasSenha = new Map();  // userId → { erros, bloqueadoAte }
const MAX_TENTATIVAS  = 5;
const BLOQUEIO_MS     = 60 * 60e3;

const TEXTO_BOAS_VINDAS =
  'Você foi autorizado(a) a usar o SisPode Bot! 🎉\n\n%AJUDA%' +
  '\n\nDica: comece configurando sua chave de IA com /config (aqui no privado).';

async function tratarNaoAutorizado(ctx) {
  const id   = String(ctx.from?.id || '');
  const nome = nomeDe(ctx);
  // Só interage no privado — em grupo, não autorizado é silêncio.
  if (ctx.chat?.type !== 'private' || !ctx.message?.text) return;
  const texto = ctx.message.text.trim();

  // Qualquer comando (/start, /ajuda…) de não autorizado → convite/pedido;
  // só texto livre conta como tentativa de senha.
  if (texto.startsWith('/') || !SENHA_ACESSO) {
    if (SENHA_ACESSO) {
      return ctx.reply(
        'Este bot é de uso interno da Liderança do Podemos.\n' +
        '🔑 Envie a palavra-chave de acesso para entrar.');
    }
    // Sem senha configurada: fluxo de aprovação manual pelo administrador.
    if (!texto.startsWith('/start')) return;
    pedidosAcesso.set(id, nome);
    await ctx.reply(
      'Este bot é de uso interno da Liderança do Podemos.\n' +
      `Seu ID do Telegram é: ${id}\n` +
      'Pedi autorização ao administrador — você será avisado(a) quando for liberado.');
    if (ADMIN_USER_ID) {
      await bot.api.sendMessage(ADMIN_USER_ID,
        `🔑 Pedido de acesso: ${nome || '(sem nome)'} — ID ${id}`,
        { reply_markup: new InlineKeyboard().text('✅ Autorizar', `auth:${id}`) }
      ).catch(() => {});
    }
    return;
  }

  // Texto livre de não autorizado com senha configurada = tentativa de senha.
  const t = tentativasSenha.get(id) || { erros: 0, bloqueadoAte: 0 };
  if (Date.now() < t.bloqueadoAte) {
    return ctx.reply('Muitas tentativas erradas — aguarde 1 hora e tente de novo.');
  }
  // Apaga a mensagem (certa ou errada): senha não fica no histórico do chat.
  await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});

  if (texto.toLowerCase() === SENHA_ACESSO.toLowerCase()) {
    autorizar(id, nome, 'senha');
    tentativasSenha.delete(id);
    await ctx.reply(TEXTO_BOAS_VINDAS.replace('%AJUDA%', TEXTO_AJUDA));
    if (ADMIN_USER_ID && id !== ADMIN_USER_ID) {
      await bot.api.sendMessage(ADMIN_USER_ID,
        `🔓 Entrou com a palavra-chave: ${nome || '(sem nome)'} — ID ${id}\n` +
        `(para remover: /revogar ${id})`).catch(() => {});
    }
    return;
  }

  t.erros++;
  if (t.erros >= MAX_TENTATIVAS) {
    t.bloqueadoAte = Date.now() + BLOQUEIO_MS;
    t.erros = 0;
    tentativasSenha.set(id, t);
    return ctx.reply('Palavra-chave incorreta. Limite de tentativas atingido — aguarde 1 hora.');
  }
  tentativasSenha.set(id, t);
  return ctx.reply(`Palavra-chave incorreta (${t.erros}/${MAX_TENTATIVAS} tentativas).`);
}

bot.use(async (ctx, next) => {
  const id = String(ctx.from?.id || '');
  if (isAutorizado(id)) return next();
  return tratarNaoAutorizado(ctx);
});

bot.callbackQuery(/^auth:(\d+)$/, async ctx => {
  if (String(ctx.from.id) !== ADMIN_USER_ID) return ctx.answerCallbackQuery({ text: 'Só o administrador autoriza.' });
  const id = ctx.match[1];
  const nome = pedidosAcesso.get(id) || '';
  autorizar(id, nome);
  pedidosAcesso.delete(id);
  await ctx.answerCallbackQuery({ text: 'Autorizado!' });
  await ctx.editMessageText(`✅ ${nome || 'Usuário'} (ID ${id}) autorizado.`);
  await bot.api.sendMessage(id,
    'Você foi autorizado(a) a usar o SisPode Bot! 🎉\n\n' + TEXTO_AJUDA +
    '\n\nDica: comece configurando sua chave de IA com /config (aqui no privado).'
  ).catch(() => {});
});

// ============================================================
//  Comandos básicos
// ============================================================
bot.command(['start', 'ajuda'], ctx => ctx.reply(TEXTO_AJUDA));

// Descobrir IDs sem sair do Telegram (útil p/ configurar GRUPO_CHAT_ID)
bot.command('id', ctx => ctx.reply(
  `ID deste chat: ${ctx.chat.id}\nSeu user_id: ${ctx.from.id}` +
  (ctx.chat.type !== 'private' ? '\n(use o ID do chat no GRUPO_CHAT_ID do .env)' : '')));

// ---------- Administração (só o ADMIN_USER_ID) ----------
bot.command('revogar', async ctx => {
  if (String(ctx.from.id) !== ADMIN_USER_ID) return;
  const id = String(ctx.match || '').trim();
  if (!/^\d+$/.test(id)) return ctx.reply('Uso: /revogar <id do usuário> (veja os IDs com /usuarios).');
  if (revogar(id)) return ctx.reply(`Acesso do ID ${id} revogado.`);
  return ctx.reply(`O ID ${id} não está na lista dinâmica (IDs fixos do .env só saem editando o arquivo).`);
});

bot.command('usuarios', async ctx => {
  if (String(ctx.from.id) !== ADMIN_USER_ID) return;
  const din = listarAutorizados();
  const linhas = Object.entries(din).map(([id, u]) =>
    `• ${u.nome || '(sem nome)'} — ${id} · via ${u.via || 'admin'} · ${String(u.autorizadoEm || '').slice(0, 10)}`);
  return ctx.reply(
    (linhas.length ? `Autorizados (dinâmicos):\n${linhas.join('\n')}` : 'Nenhum autorizado dinâmico ainda.') +
    '\n\nPara remover: /revogar <id>. IDs fixos do .env não aparecem aqui.');
});

// ---------- FASE 1: /pauta ----------

/** Cabeçalho com o quadro completo: período, situação da semana e importação. */
function quadroPauta(r) {
  const p = r.pauta;
  const linhas = [
    `📋 Pauta publicada no site: ${p.periodo || '(período não identificado)'} — ${p.itens.length} itens`,
    rotuloSituacao(r.situacao, p.periodo),
    r.jaImportada.importada
      ? `✅ Já importada no SisPode como "${r.jaImportada.titulo}" (${r.jaImportada.iguais} de ${r.jaImportada.total} itens coincidem)`
      : '📥 Ainda não importada no SisPode',
  ];
  // "🆕" só quando o período realmente mudou desde a checagem anterior —
  // na primeira checagem após instalar não há base de comparação.
  if (r.status === 'nova' && !r.primeiraChecagem) linhas.unshift('🆕 Mudança de semana desde a última checagem!');
  return linhas.join('\n');
}

// Quando a pauta SEMANAL do site está encerrada/ausente, a "pauta nova" do dia
// pode existir na forma da ORDEM DO DIA da sessão (API) — o pauta_s.pdf da
// Câmara costuma ficar defasado. Devolve { linha, kb } para anexar à resposta,
// ou null se não há sessão hoje.
async function ofertaOrdemDoDia() {
  try {
    const hoje = hojeBrasiliaISO();
    const eventos = await eventosDeliberativos(hoje);
    if (!eventos.length) return null;
    eventos.sort((a, b) => String(b.dataHoraInicio || '').localeCompare(String(a.dataHoraInicio || '')));
    const odd = await buscarOrdemDoDia(eventos[0].id, hoje);
    if (!odd) return null;
    const n = odd.parsed.itens.length;
    const jaTem = await pautaPorId(`odd-${hoje}`).catch(() => null);
    if (jaTem) {
      return { linha: `\n\n📌 Hoje há sessão com Ordem do Dia (${n} itens) — já importada no SisPode. Use /sispode para escolhê-la.`, kb: null };
    }
    const kb = new InlineKeyboard().text('📥 Importar Ordem do Dia de hoje', `oddimp:${eventos[0].id}:${hoje}`);
    return { linha: `\n\n📌 Mas HOJE há sessão com Ordem do Dia publicada (${n} itens) — é a pauta do dia, mais atual que a semanal.`, kb };
  } catch (_) { return null; }
}

async function cmdVerificarPauta(ctx) {
  await ctx.replyWithChatAction('typing');
  try {
    const r = await verificarPautaNova();
    if (r.status === 'sem_pauta') {
      // Sem pauta nova no site, mas pode haver pautas já importadas: oferece as
      // 3 últimas do Firebase para o usuário escolher qual quer ver/usar.
      const odd = await ofertaOrdemDoDia();
      const ultimas = await ultimasPautas(3).catch(() => []);
      if (!ultimas.length) {
        return ctx.reply('Nenhuma pauta publicada no site agora (o PDF oficial não está disponível) e nenhuma importada no SisPode ainda.' +
          (odd ? odd.linha : ''), odd?.kb ? { reply_markup: odd.kb } : undefined);
      }
      const kb = new InlineKeyboard();
      for (const p of ultimas) {
        const token = crypto.randomBytes(4).toString('hex');
        pautaEscolha.set(token, { id: p.id, ts: Date.now() });
        kb.text(`${rotuloPauta(p)} · ${(p.itens || []).length} itens`.slice(0, 62), `psel:${token}`).row();
      }
      if (odd?.kb) kb.row().text('📥 Importar Ordem do Dia de hoje', odd.kb.inline_keyboard[0][0].callback_data);
      return ctx.reply(
        'Nenhuma pauta nova publicada no site da Câmara agora.' + (odd ? odd.linha : '') +
        '\n\nEstas são as últimas importadas no SisPode — escolha uma para ver os itens:',
        { reply_markup: kb });
    }
    let texto = `${quadroPauta(r)}\n\n${resumoPauta(r.pauta)}`;
    // Botão de importar só quando faz sentido (não importada e semana não encerrada)
    const comBotao = !r.jaImportada.importada && r.situacao !== 'encerrada';
    // Semana do PDF encerrada → verifica se há Ordem do Dia de HOJE para oferecer
    let kbFinal = comBotao ? tecladoImportar() : undefined;
    if (r.situacao === 'encerrada') {
      const odd = await ofertaOrdemDoDia();
      if (odd) { texto += odd.linha; if (odd.kb) kbFinal = odd.kb; }
    }
    return responderLongo(ctx, texto, kbFinal);
  } catch (e) {
    console.error('/pauta falhou:', e);
    return ctx.reply(`Erro ao verificar a pauta: ${e.message}`);
  }
}
bot.command('pauta', cmdVerificarPauta);

// ---------- FASE 2: /importar (com confirmação) ----------
function tecladoImportar() {
  return new InlineKeyboard().text('📥 Importar para o SisPode', 'imp:baixar');
}

async function prepararImportacao(ctx) {
  await ctx.replyWithChatAction('typing');
  const parsed = await baixarPautaAtual();
  if (!parsed) return ctx.reply('Nenhuma pauta publicada no momento — nada para importar.');
  if (!parsed.itens.length) {
    return ctx.reply('O PDF foi baixado mas o parser não identificou itens (o formato pode ter mudado). Importação recusada — verifique no painel.');
  }
  const doc = montarPautaFirebase(parsed, `bot-telegram (${nomeDe(ctx)})`);
  const token = crypto.randomBytes(6).toString('hex');
  importPendente.set(token, { doc, ts: Date.now() });

  if (await pautaJaExiste(doc.id)) {
    return ctx.reply(
      `⚠️ Já existe a pauta "${doc.titulo}" no SisPode — ela pode ter edições da equipe ` +
      `(itens adicionados/removidos, responsáveis, renomeação).\n\nSobrescrever?`,
      { reply_markup: new InlineKeyboard().text('⚠️ Sobrescrever', `imp:ok:${token}`).text('Cancelar', `imp:no:${token}`) });
  }
  return ctx.reply(
    `Importar "${doc.titulo}" (${doc.itens.length} itens) para o SisPode?`,
    { reply_markup: new InlineKeyboard().text('✅ Confirmar', `imp:ok:${token}`).text('Cancelar', `imp:no:${token}`) });
}
bot.command('importar', prepararImportacao);

bot.callbackQuery('imp:baixar', async ctx => {
  await ctx.answerCallbackQuery();
  return prepararImportacao(ctx);
});

bot.callbackQuery(/^imp:(ok|no):([a-f0-9]+)$/, async ctx => {
  const [, acao, token] = ctx.match;
  const pend = importPendente.get(token);
  importPendente.delete(token);
  if (!pend || Date.now() - pend.ts > IMPORT_TTL) {
    return ctx.answerCallbackQuery({ text: 'Pedido expirado — use /importar de novo.', show_alert: true });
  }
  if (acao === 'no') {
    await ctx.answerCallbackQuery({ text: 'Cancelado.' });
    return ctx.editMessageText('Importação cancelada — a pauta existente foi mantida.');
  }
  await ctx.answerCallbackQuery();
  try {
    const id = await gravarPauta(pend.doc);
    await ctx.editMessageText(
      `✅ Pauta "${pend.doc.titulo}" importada (${pend.doc.itens.length} itens).\n` +
      `Já está disponível para toda a equipe no painel "Análise de Pauta" do SisPode. (id: ${id})`);
  } catch (e) {
    await ctx.editMessageText(`Erro ao gravar no Firebase: ${e.message}`);
  }
});

// ---------- FASE 3a: perfis (/config) ----------
bot.command('config', async ctx => {
  if (!ehPrivado(ctx)) {
    return ctx.reply('Por segurança, a configuração de chave é feita no privado — me chame no chat direto e envie /config lá.');
  }
  const kb = new InlineKeyboard();
  for (const [id, p] of Object.entries(PROVEDORES)) kb.text(p.label, `cfg:${id}`).row();
  return ctx.reply(
    'Escolha seu provedor de IA (a mesma chave que você usa na extensão serve):', { reply_markup: kb });
});

bot.callbackQuery(/^cfg:(gemini|openai|anthropic)$/, async ctx => {
  if (!ehPrivado(ctx)) return ctx.answerCallbackQuery({ text: 'Só no privado.' });
  const provedor = ctx.match[1];
  configPendente.set(String(ctx.from.id), { provedor });
  await ctx.answerCallbackQuery();
  return ctx.reply(
    `${PROVEDORES[provedor].label} selecionado.\n\n` +
    `Agora cole aqui a sua chave de API.\n(${PROVEDORES[provedor].hintChave})\n\n` +
    'Assim que eu validar, apago a sua mensagem com a chave.');
});

async function tratarChaveColada(ctx) {
  const userId = String(ctx.from.id);
  const pend = configPendente.get(userId);
  const chave = (ctx.message.text || '').trim();
  const meta = PROVEDORES[pend.provedor];

  if (!meta.regexChave.test(chave)) {
    return ctx.reply(`Isso não parece uma chave ${meta.label} válida. ${meta.hintChave}\nCole a chave, ou envie /config para recomeçar.`);
  }
  await ctx.replyWithChatAction('typing');
  try {
    await testarChave(pend.provedor, chave);
  } catch (e) {
    return ctx.reply(`A chave não passou no teste de conexão (${e.message}). Confira e cole de novo, ou /config para recomeçar.`);
  }
  setPerfil(userId, {
    nome: nomeDe(ctx), provedor: pend.provedor, modelo: meta.modeloPadrao,
    apiKey: chave, configuradoEm: new Date().toISOString(),
  });
  configPendente.delete(userId);
  // Apaga a mensagem que continha a chave (fica só no arquivo local do bot).
  await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  return ctx.reply(
    `✅ Chave ${meta.label} validada e salva (${chave.slice(0, 6)}…).\n` +
    `Modelo: ${meta.modeloPadrao} (troque com /modelo <id> se quiser).\n\n` +
    'Agora você pode usar /perguntar, linguagem natural e mensagens de voz.');
}

bot.command('minhachave', ctx => {
  const p = getPerfil(ctx.from.id);
  if (!p?.apiKey) return ctx.reply('Nenhuma chave configurada. Use /config no privado.');
  return ctx.reply(`Provedor: ${PROVEDORES[p.provedor]?.label || p.provedor}\nModelo: ${p.modelo}\nChave: ${p.apiKey.slice(0, 6)}…`);
});

bot.command('removerchave', ctx => {
  removerChave(ctx.from.id);
  return ctx.reply('Chave removida. Use /config quando quiser configurar de novo.');
});

bot.command('modelo', ctx => {
  const p = getPerfil(ctx.from.id);
  if (!p?.apiKey) return ctx.reply('Configure a chave primeiro com /config.');
  const id = (ctx.match || '').trim();
  if (!id) return ctx.reply(`Modelo atual: ${p.modelo}\nPara trocar: /modelo <id do modelo>`);
  setPerfil(ctx.from.id, { modelo: id });
  return ctx.reply(`Modelo alterado para: ${id}`);
});

// ---------- FASE 3a: /perguntar e /limpar ----------
async function fluxoPerguntar(ctx, texto) {
  const perfil = getPerfil(ctx.from.id);
  if (!perfil?.apiKey) {
    return ctx.reply('Para perguntar à IA você precisa configurar sua chave: me chame no privado e envie /config.');
  }
  if (!texto?.trim()) {
    return ctx.reply('Uso: /perguntar PL 1234/2026 <sua pergunta> — ou /perguntar <pergunta sobre a pauta>.');
  }
  await ctx.replyWithChatAction('typing');
  try {
    const r = await perguntar({ userId: ctx.from.id, perfil, texto: texto.trim() });
    if (r.erro) return ctx.reply(r.erro);
    // Deixa claro sobre qual pauta o bot respondeu (o analista pode estar
    // vendo outra pauta aberta no painel — problema 3 da varredura).
    const rodape = r.pautaRef ? `\n\n— Base: ${r.pautaRef}` : '';
    return responderLongo(ctx, r.resposta + rodape);
  } catch (e) {
    console.error('/perguntar falhou:', e);
    return ctx.reply(`Erro ao consultar a IA: ${e.message}`);
  }
}
bot.command('perguntar', ctx => fluxoPerguntar(ctx, ctx.match));
bot.command('limpar', ctx => { limparConversa(ctx.from.id); return ctx.reply('Conversa zerada (histórico e documentos agregados).'); });

// ---------- Documentos extras (porte do seletor do painel) ----------
async function cmdDocumentos(ctx, texto) {
  await ctx.replyWithChatAction('typing');
  try {
    const r = await listarDocumentos({ userId: ctx.from.id, texto });
    if (r.erro) return ctx.reply(r.erro);
    if (!r.docs.length) {
      return ctx.reply(`Todos os documentos da tramitação de ${r.itemLabel} já foram considerados na nota — não há extras disponíveis.`);
    }
    let msg = `📄 Documentos da tramitação de ${r.itemLabel} que NÃO entraram na nota técnica:\n`;
    let grupoAtual = '';
    r.docs.forEach((d, i) => {
      if (d.grupo !== grupoAtual) { grupoAtual = d.grupo; msg += `\n— ${grupoAtual} —\n`; }
      msg += `${i + 1}. ${d.rotulo}\n`;
    });
    msg += `\nPara incluir na conversa: /agregar 1,3 (números da lista acima).`;
    if (!r.temAnalise) {
      msg += `\n⚠️ Este item ainda não tem análise no painel — gere a nota primeiro para poder perguntar/agregar.`;
    } else if (r.usadosNaNota.length) {
      msg += `\n\nJá considerados na nota: ${r.usadosNaNota.join(' · ')}`;
    }
    return responderLongo(ctx, msg);
  } catch (e) {
    console.error('/documentos falhou:', e);
    return ctx.reply(`Erro ao listar documentos: ${e.message}`);
  }
}
bot.command('documentos', ctx => cmdDocumentos(ctx, ctx.match));

bot.command('agregar', async ctx => {
  const indices = String(ctx.match || '').split(/[,\s]+/).map(n => parseInt(n, 10)).filter(Number.isFinite);
  if (!indices.length) return ctx.reply('Uso: /agregar 1,3 — com os números listados pelo /documentos.');
  await ctx.replyWithChatAction('typing');
  try {
    const r = await agregarDocumentos({ userId: ctx.from.id, indices });
    if (r.erro) return ctx.reply(r.erro);
    let msg = r.ok.length
      ? `✅ Agregado(s) à conversa sobre ${r.itemLabel}:\n• ${r.ok.join('\n• ')}`
      : 'Nenhum documento novo agregado (os escolhidos já estavam na conversa).';
    if (r.falhas.length) msg += `\n⚠️ Falhou a leitura de: ${r.falhas.join(' · ')}`;
    msg += `\n\nPode perguntar — a IA agora considera também esse(s) documento(s). ` +
           `(${r.total} extra(s) na conversa; /limpar remove tudo.)`;
    return ctx.reply(msg);
  } catch (e) {
    console.error('/agregar falhou:', e);
    return ctx.reply(`Erro ao agregar: ${e.message}`);
  }
});

// ---------- /analisar e /exportar (worker Puppeteer — código do painel) ----------
let _workerOcupado = false;          // um trabalho de painel por vez
const analisePendente = new Map();   // token → { pautaId, titulo, ts }

async function cmdAnalisar(ctx) {
  const perfil = getPerfil(ctx.from.id);
  if (!perfil?.apiKey) {
    return ctx.reply('O /analisar gera as notas na SUA chave de IA — configure com /config no privado.');
  }
  if (_workerOcupado) return ctx.reply('Já há uma geração/exportação em andamento — aguarde terminar.');
  await ctx.replyWithChatAction('typing');
  const pauta = await pautaDoUsuario(ctx.from.id);
  if (!pauta) return ctx.reply('Nenhuma pauta importada no SisPode ainda. Use /importar.');
  const token = crypto.randomBytes(6).toString('hex');
  analisePendente.set(token, { pautaId: pauta.id, titulo: pauta.nome || pauta.titulo || pauta.id, ts: Date.now() });
  return ctx.reply(
    `Gerar as análises da pauta "${pauta.nome || pauta.titulo}" (${(pauta.itens || []).length} itens)?\n` +
    'Itens que já têm nota são pulados; MPVs ficam de fora (edição manual). ' +
    'As chamadas de IA rodam na SUA chave.',
    { reply_markup: new InlineKeyboard().text('🤖 Gerar análises', `ana:ok:${token}`).text('Cancelar', `ana:no:${token}`) });
}
bot.command('analisar', cmdAnalisar);

bot.callbackQuery(/^ana:(ok|no):([a-f0-9]+)$/, async ctx => {
  const [, acao, token] = ctx.match;
  const pend = analisePendente.get(token);
  analisePendente.delete(token);
  if (!pend || Date.now() - pend.ts > IMPORT_TTL) {
    return ctx.answerCallbackQuery({ text: 'Pedido expirado — use /analisar de novo.', show_alert: true });
  }
  if (acao === 'no') {
    await ctx.answerCallbackQuery({ text: 'Cancelado.' });
    return ctx.editMessageText('Geração cancelada.');
  }
  const perfil = getPerfil(ctx.from.id);
  if (!perfil?.apiKey) return ctx.answerCallbackQuery({ text: 'Configure sua chave com /config.', show_alert: true });
  if (_workerOcupado) return ctx.answerCallbackQuery({ text: 'Worker ocupado — tente em instantes.', show_alert: true });
  await ctx.answerCallbackQuery();
  _workerOcupado = true;
  await ctx.editMessageText(`⚙️ Abrindo o painel no worker para "${pend.titulo}"…`);
  try {
    const final = await analisarPauta({
      perfil, pautaId: pend.pautaId,
      onProgress: p => ctx.editMessageText(
        `🤖 Gerando análises de "${pend.titulo}"… ${p.ok}/${p.total}` +
        (p.erro ? ` · ${p.erro} falha(s)` : '') + (p.gerando ? ' (em andamento)' : '')
      ).catch(() => {}),
    });
    await ctx.editMessageText(
      `✅ Análises de "${pend.titulo}": ${final.ok}/${final.total} prontas` +
      (final.erro ? ` · ${final.erro} falha(s) — tente de novo mais tarde ou gere no painel` : '') +
      '.\nJá estão no painel de todos e o /perguntar responde sobre os itens.');
  } catch (e) {
    console.error('/analisar falhou:', e);
    await ctx.editMessageText(`Erro na geração: ${e.message}`).catch(() => {});
  } finally {
    _workerOcupado = false;
  }
});

async function cmdExportar(ctx) {
  if (_workerOcupado) return ctx.reply('Já há uma geração/exportação em andamento — aguarde terminar.');
  await ctx.replyWithChatAction('typing');
  const pauta = await pautaDoUsuario(ctx.from.id);
  if (!pauta) return ctx.reply('Nenhuma pauta importada no SisPode ainda. Use /importar.');
  _workerOcupado = true;
  const aviso = await ctx.reply(`📄 Gerando o PDF institucional de "${pauta.nome || pauta.titulo}"… (1–3 min)`);
  try {
    const r = await exportarPdfPauta({ perfil: getPerfil(ctx.from.id), pautaId: pauta.id });
    await ctx.replyWithChatAction('upload_document');
    await ctx.replyWithDocument(
      new InputFile(r.pdf, `${String(r.titulo).replace(/[^\w\- ]+/g, '').trim() || 'pauta'}.pdf`),
      { caption: `${r.titulo} — ${r.numItens} itens · PDF institucional gerado pelo SisPode Bot` });
    await ctx.api.deleteMessage(aviso.chat.id, aviso.message_id).catch(() => {});
  } catch (e) {
    console.error('/exportar falhou:', e);
    await ctx.api.editMessageText(aviso.chat.id, aviso.message_id, `Erro ao gerar o PDF: ${e.message}`).catch(() => {});
  } finally {
    _workerOcupado = false;
  }
}
bot.command('exportar', cmdExportar);

// ---------- Receber a pauta em PDF pelo chat ----------
bot.on('message:document', async ctx => {
  if (!ehPrivado(ctx)) return;   // só no privado
  const doc = ctx.message.document;
  const ehPdf = doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name || '');
  if (!ehPdf) return ctx.reply('Só sei importar pautas em PDF.');
  if (doc.file_size > 20 * 1024 * 1024) return ctx.reply('PDF acima de 20 MB — o Telegram não deixa o bot baixar. Importe pelo painel.');

  await ctx.replyWithChatAction('typing');
  try {
    const file = await ctx.getFile();
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
    const texto  = await extrairTextoPdf(new Uint8Array(await res.arrayBuffer()));
    const parsed = parsearPauta(texto);
    if (!parsed.itens.length) {
      return ctx.reply('Não identifiquei itens nesse PDF — ele está num dos formatos de pauta conhecidos (oficial da Câmara ou dashboard da Liderança)?');
    }
    const docFb = montarPautaFirebase(parsed, `bot-telegram (${nomeDe(ctx)})`, doc.file_name || 'pauta.pdf');
    const token = crypto.randomBytes(6).toString('hex');
    importPendente.set(token, { doc: docFb, ts: Date.now() });

    const cab = `📋 "${docFb.titulo}" — ${docFb.itens.length} itens identificados no PDF.`;
    if (await pautaJaExiste(docFb.id)) {
      return ctx.reply(
        `${cab}\n⚠️ Já existe pauta com esse período no SisPode (pode ter edições da equipe). Sobrescrever?`,
        { reply_markup: new InlineKeyboard().text('⚠️ Sobrescrever', `imp:ok:${token}`).text('Cancelar', `imp:no:${token}`) });
    }
    return ctx.reply(`${cab}\nImportar para o SisPode?`,
      { reply_markup: new InlineKeyboard().text('✅ Importar', `imp:ok:${token}`).text('Cancelar', `imp:no:${token}`) });
  } catch (e) {
    console.error('importação por PDF falhou:', e);
    return ctx.reply(`Erro ao ler o PDF: ${e.message}`);
  }
});

// ---------- Monitor de sessão: /monitor [on|off] ----------
bot.command('monitor', async ctx => {
  const arg = String(ctx.match || '').trim().toLowerCase();
  if (arg === 'on' || arg === 'off') {
    if (String(ctx.from.id) !== ADMIN_USER_ID) return ctx.reply('Só o administrador liga/desliga o monitor.');
    setMonitorLigado(arg === 'on');
    return ctx.reply(`Monitor de sessão ${arg === 'on' ? 'LIGADO' : 'DESLIGADO'}.`);
  }
  const s = statusMonitor();
  return ctx.reply(
    `Monitor de sessão: ${s.ligado ? '🟢 ligado' : '🔴 desligado'}` +
    `${s.ensaio ? ' · MODO ENSAIO (mensagens só p/ admin)' : ' · produção (grupo)'}\n` +
    `Janela de vigilância: ${s.janelaAtiva ? 'ativa' : 'fora do horário (seg–sex 8h–2h)'}\n` +
    (s.sessao
      ? `Sessão em acompanhamento: ${s.sessao.id} (${s.sessao.dataISO}) — ${s.sessao.itens} item(ns) visto(s), ${s.sessao.encerrados} votado(s).`
      : 'Nenhuma sessão em andamento.'));
});

// ---------- Votação: placar da bancada como IMAGEM ----------
function hojeBrasiliaISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function cmdVotacao(ctx, texto) {
  // Data opcional: "/votacao 02/07/2026" (padrão: hoje)
  const m = String(texto || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const dataISO = m ? `${m[3]}-${m[2]}-${m[1]}` : hojeBrasiliaISO();
  const dataBR  = dataISO.split('-').reverse().join('/');

  await ctx.replyWithChatAction('typing');

  // HOJE: usa o painel AO VIVO (mesma fonte do monitor) — Dados Abertos tem
  // ~5min de atraso e esconde votos até o encerramento. Só cai para Dados
  // Abertos se não houver sessão com painel disponível (ex.: sessão já saiu
  // do portal). Datas passadas usam Dados Abertos (dado final, sem atraso).
  if (dataISO === hojeBrasiliaISO()) {
    try {
      const sessao = await descobrirSessaoPortal(dataISO);
      if (sessao) {
        const kb = new InlineKeyboard();
        for (const it of sessao.itens.slice(0, 50)) {
          const rot = identificarItem(it.rotulo).texto.replace(/\*/g, '').slice(0, 60);
          kb.text(rot || `Item ${it.id}`, `votp:${sessao.reuniaoId}:${it.id}`).row();
        }
        return ctx.reply(
          `🗳 Votações nominais do Plenário em ${dataBR} — *painel ao vivo* (${sessao.itens.length}):\n` +
          'Escolha uma para gerar a imagem do placar. Se a votação ainda estiver em curso, ' +
          'os votos individuais aparecem só após o encerramento.',
          { reply_markup: kb, parse_mode: 'Markdown' });
      }
    } catch (e) {
      console.warn('/votacao painel ao vivo indisponível, usando Dados Abertos:', e.message);
    }
  }

  try {
    const lista = await listarVotacoesDia(dataISO);
    if (!lista.length) {
      return ctx.reply(`Nenhuma votação nominal do Plenário em ${dataBR}.` +
        (m ? '' : ' Para outra data: /votacao dd/mm/aaaa'));
    }
    const MAX_BOTOES = 50;   // Telegram aceita até 100; 50 cobre qualquer sessão real
    const kb = new InlineKeyboard();
    for (const v of lista.slice(0, MAX_BOTOES)) {
      // A DESCRIÇÃO distingue votações da mesma matéria (substitutivo, DVS,
      // emenda…) — a proposição sozinha geraria botões idênticos. O placar
      // embutido na descrição ("Sim: 293; Não: …") é cortado do rótulo.
      const desc = v.descricao.split(/Sim:\s*\d/i)[0].replace(/[\s,;:—-]+$/, '').trim();
      const rotulo = `${v.hora ? v.hora + ' — ' : ''}${v.proposicao ? v.proposicao + ' · ' : ''}${desc}`
        .replace(/\s+/g, ' ').slice(0, 60);
      kb.text(rotulo || `Votação ${v.id}`, `vot:${v.id}`).row();
    }
    return ctx.reply(
      `🗳 Votações nominais do Plenário em ${dataBR} (${lista.length}):\n` +
      'Escolha uma para gerar a imagem do placar da bancada:' +
      (lista.length > MAX_BOTOES ? `\n⚠️ Mostrando as ${MAX_BOTOES} primeiras de ${lista.length}.` : ''),
      { reply_markup: kb });
  } catch (e) {
    console.error('/votacao falhou:', e);
    return ctx.reply(`Erro ao buscar votações: ${e.message}`);
  }
}
bot.command('votacao', ctx => cmdVotacao(ctx, ctx.match));

bot.callbackQuery(/^vot:(.+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.replyWithChatAction('upload_photo');
  try {
    const pl = await placarVotacao(ctx.match[1], 'PODE');
    const png = await imagemVotacao(pl);
    const cap = `${pl.descricao}`.slice(0, 900) +
      `\n${pl.data.split('-').reverse().join('/')}${pl.hora ? ' às ' + pl.hora : ''} · quórum ${pl.quorum}`;
    return ctx.replyWithPhoto(new InputFile(png, 'votacao.png'), { caption: cap });
  } catch (e) {
    console.error('imagem de votação falhou:', e);
    return ctx.reply(`Erro ao gerar a imagem: ${e.message}`);
  }
});

// Placar via PAINEL AO VIVO (votp:{reuniao}:{item}) — fonte do monitor, sem o
// atraso de Dados Abertos. Votos individuais só existem após o encerramento.
bot.callbackQuery(/^votp:(\d+):(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  await ctx.replyWithChatAction('upload_photo');
  const [, reuniao, item] = ctx.match;
  try {
    const html = await paginaSessao(reuniao, item);
    const itens = parseItens(html);
    const sel = itens.find(i => i.selecionado) || itens.find(i => i.id === item);
    if (sel && sel.id !== item) {
      return ctx.reply('O painel não abriu esse item específico agora — tente novamente em instantes.');
    }
    const ident = identificarItem(sel ? sel.rotulo : '');
    const placar = await parsePlacarPortal(html, { descricao: ident.texto.replace(/\*/g, '') });
    if (!placar.temVotos) {
      return ctx.reply(
        `⏳ ${ident.texto.replace(/\*/g, '')} — votação ainda em curso.\n` +
        'Os votos individuais só aparecem no painel após o encerramento. Tente de novo em instantes.');
    }
    const png = await imagemVotacao(placar);
    const g = placar.global, p = placar.parcial;
    const cap = `${ident.texto.replace(/\*/g, '')}`.slice(0, 800) +
      `\n${placar.data ? placar.data.split('-').reverse().join('/') + ' · ' : ''}quórum ${placar.quorum}` +
      `\nSim ${g.sim} · Não ${g.nao}${g.abstencao ? ` · Abst. ${g.abstencao}` : ''}` +
      `\nBancada PODE: ${p.sim} Sim / ${p.nao} Não${p.abstencao ? ` / ${p.abstencao} Abst.` : ''}${p.ausente ? ` / ${p.ausente} Aus.` : ''}`;
    return ctx.replyWithPhoto(new InputFile(png, 'votacao.png'), { caption: cap });
  } catch (e) {
    console.error('imagem de votação (portal) falhou:', e);
    return ctx.reply(`Erro ao gerar a imagem do painel: ${e.message}`);
  }
});

// ---------- listar itens (usada pelo roteador da fase 4) ----------
function linhasItensPauta(pauta) {
  return (pauta.itens || []).map(it =>
    `${it.ordem}. ${it.sigla} ${it.numero}/${it.ano}${it.temUrgencia ? ' ⚡' : ''} — ${(it.ementa || '').replace(/\s+/g, ' ').slice(0, 90)}`).join('\n');
}

async function cmdListarItens(ctx) {
  await ctx.replyWithChatAction('typing');
  const pauta = await pautaDoUsuario(ctx.from.id);
  if (!pauta) return ctx.reply('Nenhuma pauta importada no SisPode ainda. Use /importar.');
  return responderLongo(ctx,
    `📋 ${rotuloPauta(pauta)}${pauta.uploadedBy ? ` por ${pauta.uploadedBy}` : ''}\n` +
    `ℹ️ Para trocar de pauta use /sispode; para a pauta publicada no site, /pauta.\n\n${linhasItensPauta(pauta)}`);
}

// Escolha de uma das últimas pautas do Firebase (botões do /pauta quando o
// site não tem pauta nova) → mostra os itens da pauta escolhida.
bot.callbackQuery(/^psel:([a-f0-9]+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const esc = pautaEscolha.get(ctx.match[1]);
  pautaEscolha.delete(ctx.match[1]);
  if (!esc || Date.now() - esc.ts > IMPORT_TTL) {
    return ctx.reply('Escolha expirada — use /pauta de novo.');
  }
  const pauta = await pautaPorId(esc.id);
  if (!pauta) return ctx.reply('Não encontrei essa pauta no SisPode (pode ter sido removida).');
  return responderLongo(ctx,
    `📋 ${rotuloPauta(pauta)}${pauta.uploadedBy ? ` por ${pauta.uploadedBy}` : ''}\n\n` +
    `${linhasItensPauta(pauta)}\n\n` +
    'Para perguntar sobre um item: /perguntar ' + (pauta.itens?.[0] ? `${pauta.itens[0].sigla} ${pauta.itens[0].numero}/${pauta.itens[0].ano} ` : 'PL 1234/2026 ') + '<sua pergunta>');
});

// ---------- /sispode — lista as pautas do SisPode e fixa a que o usuário quer usar ----------
async function cmdSisPode(ctx) {
  await ctx.replyWithChatAction('typing');
  const pautas = await ultimasPautas(8).catch(() => []);
  if (!pautas.length) {
    return ctx.reply('Nenhuma pauta importada no SisPode ainda. Use /importar, /ordemdodia ou me envie o PDF da pauta.');
  }
  const atual = await pautaDoUsuario(ctx.from.id).catch(() => null);
  const kb = new InlineKeyboard();
  for (const p of pautas) {
    const token = crypto.randomBytes(4).toString('hex');
    pautaEscolha.set(token, { id: p.id, ts: Date.now() });
    const marca = atual && atual.id === p.id ? '✅ ' : '';
    kb.text(`${marca}${rotuloPauta(p)} · ${(p.itens || []).length} itens`.slice(0, 62), `pusar:${token}`).row();
  }
  return ctx.reply(
    '📚 Pautas no SisPode — escolha qual usar. A escolhida vale para /listar, ' +
    '/perguntar, /analisar e /exportar (por ~12h ou até você trocar):',
    { reply_markup: kb });
}
bot.command('sispode', cmdSisPode);

// Fixa a pauta escolhida como ATIVA do usuário e mostra seus itens.
bot.callbackQuery(/^pusar:([a-f0-9]+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const esc = pautaEscolha.get(ctx.match[1]);
  pautaEscolha.delete(ctx.match[1]);
  if (!esc || Date.now() - esc.ts > IMPORT_TTL) {
    return ctx.reply('Escolha expirada — use /sispode de novo.');
  }
  const pauta = await pautaPorId(esc.id);
  if (!pauta) return ctx.reply('Não encontrei essa pauta no SisPode (pode ter sido removida).');
  definirPautaAtiva(ctx.from.id, esc.id);
  limparConversa(ctx.from.id);   // a conversa anterior podia estar noutra pauta
  return responderLongo(ctx,
    `✅ Agora você está usando: ${rotuloPauta(pauta)}.\n` +
    `Vale para /listar, /perguntar, /analisar e /exportar.\n\n${linhasItensPauta(pauta)}`);
});

// ---------- /ordemdodia — importa a Ordem do Dia (pauta diária) da sessão ----------
// O monitor faz isso sozinho ao detectar a sessão; este comando é o atalho
// sob demanda (e útil para testar fora de sessão ao vivo).
async function cmdOrdemDoDia(ctx) {
  await ctx.replyWithChatAction('typing');
  try {
    const r = await importarOrdemDoDiaDeHoje(hojeBrasiliaISO(), `telegram:${ctx.from.id}`);
    if (r.semSessao) return ctx.reply('Não há sessão deliberativa do Plenário hoje — sem Ordem do Dia publicada.');
    if (r.vazio)     return ctx.reply('A sessão de hoje ainda não tem itens na Ordem do Dia.');
    const p = r.doc;
    return ctx.reply(
      `📋 Ordem do Dia de hoje importada — ${(p.itens || []).length} itens. ` +
      'Agora é a pauta de referência do dia: use /listar, /perguntar, /analisar ou /exportar.');
  } catch (e) {
    console.error('/ordemdodia falhou:', e);
    return ctx.reply(`Erro ao importar a Ordem do Dia: ${e.message}`);
  }
}
bot.command('ordemdodia', cmdOrdemDoDia);

// Confirmação da oferta do monitor (botão "Importar Ordem do Dia").
bot.callbackQuery(/^oddimp:(\d+):(\d{4}-\d{2}-\d{2})$/, async ctx => {
  await ctx.answerCallbackQuery();
  const [, eventoId, dataISO] = ctx.match;
  try {
    const doc = await importarOrdemDoDia({ eventoId, dataISO, uploadedBy: `telegram:${ctx.from.id}` });
    if (!doc) return ctx.editMessageText('A Ordem do Dia dessa sessão ainda não tem itens.').catch(() => {});
    marcarOddImportada(eventoId);
    return ctx.editMessageText(
      `📋 Ordem do Dia importada — ${(doc.itens || []).length} itens. ` +
      'Agora é a pauta de referência do dia: /listar, /perguntar, /analisar, /exportar.').catch(() => {});
  } catch (e) {
    console.error('oddimp falhou:', e);
    return ctx.reply(`Erro ao importar a Ordem do Dia: ${e.message}`);
  }
});

// ============================================================
//  FASE 4 — linguagem natural (texto livre) e voz
// ============================================================
async function executarDecisao(ctx, decisao) {
  switch (decisao.ferramenta) {
    case 'verificar_pauta': return cmdVerificarPauta(ctx);
    case 'importar_pauta':  return prepararImportacao(ctx);   // sempre com botão de confirmação
    case 'ordem_do_dia':    return cmdOrdemDoDia(ctx);
    case 'sispode':         return cmdSisPode(ctx);
    case 'listar_itens':    return cmdListarItens(ctx);
    case 'perguntar':          return fluxoPerguntar(ctx, decisao.argumentos.pergunta);
    case 'listar_documentos':  return cmdDocumentos(ctx, decisao.argumentos.pergunta || '');
    case 'votacao':            return cmdVotacao(ctx, decisao.argumentos.pergunta || '');
    case 'analisar':           return cmdAnalisar(ctx);   // tem confirmação própria (custo de IA)
    case 'exportar':           return cmdExportar(ctx);
    case 'ajuda':              return ctx.reply(TEXTO_AJUDA);
    case 'responder':       return ctx.reply(decisao.argumentos.texto || 'Certo!');
    default:                return ctx.reply(TEXTO_AJUDA);
  }
}

async function tratarLinguagemNatural(ctx, texto) {
  const perfil = getPerfil(ctx.from.id);
  if (!perfil?.apiKey) {
    return ctx.reply(
      'Entendo linguagem natural, mas para isso preciso da sua chave de IA (a interpretação roda na sua conta).\n' +
      'Configure com /config no privado — ou use os comandos: /pauta, /importar, /ajuda.');
  }
  await ctx.replyWithChatAction('typing');
  try {
    const decisao = await rotear(perfil, texto);
    return executarDecisao(ctx, decisao);
  } catch (e) {
    console.error('roteador falhou:', e);
    return ctx.reply(`Não consegui interpretar (${e.message}). Tente um comando: /pauta, /importar, /perguntar…`);
  }
}

// No grupo, só reage a texto livre quando o bot é mencionado.
function textoParaOBot(ctx) {
  const texto = ctx.message?.text || '';
  if (ehPrivado(ctx)) return texto;
  const mencao = '@' + (ctx.me?.username || '');
  if (mencao.length > 1 && texto.includes(mencao)) return texto.split(mencao).join(' ').trim();
  return null;
}

bot.on('message:text', async ctx => {
  // Fluxo do /config aguardando a chave (só no privado)
  if (ehPrivado(ctx) && configPendente.has(String(ctx.from.id))) return tratarChaveColada(ctx);

  const texto = textoParaOBot(ctx);
  if (texto === null || !texto.trim()) return;          // grupo sem menção: ignora
  return tratarLinguagemNatural(ctx, texto.trim());
});

// ---------- Voz ----------
bot.on('message:voice', async ctx => {
  if (!ehPrivado(ctx)) return;   // voz só no privado (no grupo não há menção em áudio)
  const perfil = getPerfil(ctx.from.id);
  if (!perfil?.apiKey) return ctx.reply('Para usar voz, configure sua chave com /config.');

  await ctx.replyWithChatAction('typing');
  try {
    const file = await ctx.getFile();
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    if (!res.ok) throw new Error(`download do áudio: HTTP ${res.status}`);
    const buffer = new Uint8Array(await res.arrayBuffer());

    // Transcrição: com TRANSCRIBE_GEMINI_KEY configurada, TODO áudio é
    // reconhecido pelo Gemini (transcritor padrão do bot, cota gratuita) —
    // padroniza a qualidade e não consome a chave pessoal do analista.
    // Sem ela, cai no provedor do próprio usuário (Gemini/OpenAI aceitam
    // áudio; a API da Anthropic não).
    let texto;
    if (TRANSCRIBE_GEMINI_KEY) {
      // Modelo do /modelo do usuário quando for Gemini; senão o padrão do provedor
      texto = await transcreverAudio({ provedor: 'gemini', apiKey: TRANSCRIBE_GEMINI_KEY, modelo: perfil.modelo, buffer });
    } else if (perfil.provedor === 'anthropic') {
      return ctx.reply('Seu provedor (Anthropic) não aceita áudio e o bot está sem transcritor padrão configurado (TRANSCRIBE_GEMINI_KEY no .env). Envie por texto.');
    } else {
      texto = await transcreverAudio({ provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo, buffer });
    }
    if (!texto) return ctx.reply('Não consegui transcrever o áudio — tente de novo ou envie por texto.');

    await ctx.reply(`🎤 Entendi: "${texto}"`);
    return tratarLinguagemNatural(ctx, texto);
  } catch (e) {
    console.error('voz falhou:', e);
    return ctx.reply(`Erro ao processar o áudio: ${e.message}`);
  }
});

// ============================================================
//  Cron: seg–sex, 7h–21h (Brasília), a cada CRON_MINUTOS
// ============================================================
function horarioUtilBrasilia() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const dia  = partes.find(p => p.type === 'weekday').value;          // 'Mon' … 'Sun'
  const hora = parseInt(partes.find(p => p.type === 'hour').value, 10);
  return !['Sat', 'Sun'].includes(dia) && hora >= 7 && hora <= 21;
}

// Destinatários do aviso: todos os analistas autorizados, no PRIVADO
// (admin + IDs fixos do .env + quem entrou pela palavra-chave/aprovação).
function destinatariosAviso() {
  const ids = new Set();
  if (ADMIN_USER_ID) ids.add(ADMIN_USER_ID);
  for (const id of ALLOWED_USER_IDS) ids.add(id);
  for (const id of Object.keys(listarAutorizados())) ids.add(id);
  return [...ids];
}

async function tickCron() {
  if (!horarioUtilBrasilia()) return;
  try {
    const r = await verificarPautaNova();
    // Só vale um aviso quando: mudou o período E a semana não está encerrada
    // E a equipe ainda não importou (evita anunciar como "nova" uma pauta
    // velha ou que alguém já colocou no SisPode — ex.: primeiro boot).
    if (r.status !== 'nova') return;
    if (r.situacao === 'encerrada' || r.jaImportada.importada) {
      console.log(`cron: pauta "${r.pauta.periodo}" detectada mas não anunciada ` +
        `(situação: ${r.situacao}; importada: ${r.jaImportada.importada})`);
      return;
    }
    const p = r.pauta;
    const msg =
      `🆕 📋 Pauta nova da semana${p.periodo ? ` — ${p.periodo}` : ''}\n` +
      `${rotuloSituacao(r.situacao, p.periodo)}\n` +
      `${p.itens.length} itens identificados\n\n${resumoPauta(p)}`;

    // Privado de cada analista. Quem nunca abriu conversa com o bot não pode
    // receber DM (regra do Telegram) — a falha individual é só logada.
    let enviados = 0;
    for (const id of destinatariosAviso()) {
      try { await enviarLongo(bot.api, id, msg, tecladoImportar()); enviados++; }
      catch (e) { console.warn(`cron: não foi possível avisar ${id}: ${e.message}`); }
    }
    // Grupo é opcional: se GRUPO_CHAT_ID estiver configurado, avisa lá também.
    if (GRUPO_CHAT_ID) {
      try { await enviarLongo(bot.api, GRUPO_CHAT_ID, msg, tecladoImportar()); }
      catch (e) { console.warn('cron: aviso ao grupo falhou:', e.message); }
    }
    console.log(`cron: pauta nova "${p.periodo}" anunciada a ${enviados} analista(s)` +
      (GRUPO_CHAT_ID ? ' + grupo' : ''));
  } catch (e) {
    // Falha transitória (Câmara fora do ar etc.): só loga; o próximo tick tenta de novo.
    console.warn('cron da pauta falhou:', e.message);
  }
}

setInterval(tickCron, CRON_MINUTOS * 60 * 1000);
tickCron(); // primeira checagem ao subir

if (!ADMIN_USER_ID) console.warn('ADMIN_USER_ID vazio — pedidos de acesso não serão encaminhados a ninguém.');

// ---------- Monitor de Sessão ao Vivo ----------
if (MONITOR_ATIVO) {
  iniciarMonitor({
    api: bot.api,
    admin: ADMIN_USER_ID,
    ensaio: () => MONITOR_ENSAIO,
    // Ensaio: tudo vai só para o admin. Produção: grupo da equipe.
    destino: () => (MONITOR_ENSAIO ? ADMIN_USER_ID : GRUPO_CHAT_ID),
    ligadoInicial: true,
  });
  if (!MONITOR_ENSAIO && !GRUPO_CHAT_ID) {
    console.warn('Monitor em modo produção sem GRUPO_CHAT_ID — mensagens serão descartadas. Configure o grupo ou ligue MONITOR_ENSAIO=1.');
  }
} else {
  console.log('Monitor de sessão desativado (MONITOR_ATIVO=0).');
}

bot.catch(err => console.error('Erro no bot:', err));
bot.start({
  onStart: me => console.log(`SisPode Bot online como @${me.username} — monitor a cada ${CRON_MINUTOS} min`),
});
