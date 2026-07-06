'use strict';
const crypto = require('crypto');
const { Bot, InlineKeyboard } = require('grammy');

const { BOT_TOKEN, GRUPO_CHAT_ID, ADMIN_USER_ID, CRON_MINUTOS, TRANSCRIBE_GEMINI_KEY } = require('./src/config');
const { verificarPautaNova, resumoPauta, baixarPautaAtual, montarPautaFirebase, pautaJaExiste, gravarPauta, pautaAtualImportada, rotuloSituacao } = require('./src/pauta');
const { getPerfil, setPerfil, removerChave, isAutorizado, autorizar } = require('./src/store');
const { PROVEDORES, testarChave, transcreverAudio } = require('./src/ia');
const { perguntar, limparConversa } = require('./src/perguntar');
const { rotear } = require('./src/router');

const bot = new Bot(BOT_TOKEN);

const TEXTO_AJUDA =
  'SisPode Bot — Liderança do Podemos na Câmara\n\n' +
  'Comandos:\n' +
  '/pauta — verifica se há Pauta da Semana nova no site da Câmara\n' +
  '/importar — importa a pauta atual para o SisPode (pede confirmação)\n' +
  '/perguntar PL 1234/2026 <pergunta> — pergunta sobre um item da pauta (usa a nota técnica e os documentos da matéria)\n' +
  '/perguntar <pergunta> — pergunta sobre a pauta em geral\n' +
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
//  Allowlist — só analistas autorizados; /start pede acesso
// ============================================================
bot.use(async (ctx, next) => {
  const id = String(ctx.from?.id || '');
  if (isAutorizado(id)) return next();

  if (ctx.message?.text?.startsWith('/start')) {
    const nome = nomeDe(ctx);
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
  }
  // Demais mensagens de não autorizados: silêncio.
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

async function cmdVerificarPauta(ctx) {
  await ctx.replyWithChatAction('typing');
  try {
    const r = await verificarPautaNova();
    if (r.status === 'sem_pauta') {
      return ctx.reply('Nenhuma pauta publicada no momento (o PDF oficial não está disponível).');
    }
    const texto = `${quadroPauta(r)}\n\n${resumoPauta(r.pauta)}`;
    // Botão de importar só quando faz sentido (não importada e semana não encerrada)
    const comBotao = !r.jaImportada.importada && r.situacao !== 'encerrada';
    return responderLongo(ctx, texto, comBotao ? tecladoImportar() : undefined);
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
    return responderLongo(ctx, r.resposta);
  } catch (e) {
    console.error('/perguntar falhou:', e);
    return ctx.reply(`Erro ao consultar a IA: ${e.message}`);
  }
}
bot.command('perguntar', ctx => fluxoPerguntar(ctx, ctx.match));
bot.command('limpar', ctx => { limparConversa(ctx.from.id); return ctx.reply('Conversa zerada.'); });

// ---------- listar itens (usada pelo roteador da fase 4) ----------
async function cmdListarItens(ctx) {
  await ctx.replyWithChatAction('typing');
  const pauta = await pautaAtualImportada();
  if (!pauta) return ctx.reply('Nenhuma pauta importada no SisPode ainda. Use /importar.');
  const linhas = (pauta.itens || []).map(it =>
    `${it.ordem}. ${it.sigla} ${it.numero}/${it.ano}${it.temUrgencia ? ' ⚡' : ''} — ${(it.ementa || '').replace(/\s+/g, ' ').slice(0, 90)}`);
  return responderLongo(ctx, `📋 ${pauta.titulo || 'Pauta'} (${pauta.periodo || 'período n/d'}):\n\n${linhas.join('\n')}`);
}

// ============================================================
//  FASE 4 — linguagem natural (texto livre) e voz
// ============================================================
async function executarDecisao(ctx, decisao) {
  switch (decisao.ferramenta) {
    case 'verificar_pauta': return cmdVerificarPauta(ctx);
    case 'importar_pauta':  return prepararImportacao(ctx);   // sempre com botão de confirmação
    case 'listar_itens':    return cmdListarItens(ctx);
    case 'perguntar':       return fluxoPerguntar(ctx, decisao.argumentos.pergunta);
    case 'ajuda':           return ctx.reply(TEXTO_AJUDA);
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

    // Anthropic não aceita áudio — usa o transcritor padrão do bot (Gemini).
    let texto;
    if (perfil.provedor === 'anthropic') {
      if (!TRANSCRIBE_GEMINI_KEY) {
        return ctx.reply('Seu provedor (Anthropic) não aceita áudio e o bot está sem transcritor padrão configurado (TRANSCRIBE_GEMINI_KEY). Envie por texto.');
      }
      texto = await transcreverAudio({ provedor: 'gemini', apiKey: TRANSCRIBE_GEMINI_KEY, buffer });
    } else {
      texto = await transcreverAudio({ provedor: perfil.provedor, apiKey: perfil.apiKey, buffer });
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

async function tickCron() {
  if (!GRUPO_CHAT_ID || !horarioUtilBrasilia()) return;
  try {
    const r = await verificarPautaNova();
    // Só vale um aviso no grupo quando: mudou o período E a semana não está
    // encerrada E a equipe ainda não importou (evita anunciar como "nova" uma
    // pauta velha ou que alguém já colocou no SisPode — ex.: primeiro boot).
    if (r.status !== 'nova') return;
    if (r.situacao === 'encerrada' || r.jaImportada.importada) {
      console.log(`cron: pauta "${r.pauta.periodo}" detectada mas não anunciada ` +
        `(situação: ${r.situacao}; importada: ${r.jaImportada.importada})`);
      return;
    }
    const p = r.pauta;
    await enviarLongo(
      bot.api, GRUPO_CHAT_ID,
      `🆕 📋 Pauta nova da semana${p.periodo ? ` — ${p.periodo}` : ''}\n` +
      `${rotuloSituacao(r.situacao, p.periodo)}\n` +
      `${p.itens.length} itens identificados\n\n${resumoPauta(p)}`,
      tecladoImportar());
  } catch (e) {
    // Falha transitória (Câmara fora do ar etc.): só loga; o próximo tick tenta de novo.
    console.warn('cron da pauta falhou:', e.message);
  }
}

setInterval(tickCron, CRON_MINUTOS * 60 * 1000);
tickCron(); // primeira checagem ao subir

if (!GRUPO_CHAT_ID) console.warn('GRUPO_CHAT_ID vazio — aviso automático de pauta nova DESLIGADO (o /pauta continua funcionando).');
if (!ADMIN_USER_ID) console.warn('ADMIN_USER_ID vazio — pedidos de acesso não serão encaminhados a ninguém.');

bot.catch(err => console.error('Erro no bot:', err));
bot.start({
  onStart: me => console.log(`SisPode Bot online como @${me.username} — monitor a cada ${CRON_MINUTOS} min`),
});
