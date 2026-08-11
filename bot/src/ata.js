'use strict';
// /ata — modo de ANOTAÇÃO da Reunião de Líderes.
//
// O analista abre a ata, vai escrevendo (ou ditando) o que acontece durante a
// reunião do Colégio de Líderes, e ao final o bot devolve UMA mensagem pronta
// para repassar aos deputados no WhatsApp, no padrão fixado pela Liderança:
//
//     Amigos,
//
//     Compartilho as definições da reunião de líderes de hoje:
//
//     Nesta semana: …
//
//     Próxima semana: …
//
//     ⚠️  Atenção: …
//
// DIVISÃO DE TRABALHO (a mesma do resto do SisPode): a IA escreve a PROSA,
// o CÓDIGO monta o FORMATO. O modelo devolve só os blocos em JSON; a saudação,
// a ordem, o espaçamento e o marcador de atenção são montados aqui. Assim o
// padrão da mensagem não depende de o modelo "lembrar" do template — e mudar
// o padrão é mudar uma função, não um prompt.
//
// ONDE FICAM AS ANOTAÇÕES: em disco, na máquina do bot (bot/dados/atas.json),
// NUNCA no Firebase. O RTDB do projeto é aberto, e anotação de reunião de
// líderes é deliberação interna da Liderança — mesmo critério que já vale para
// as chaves de API em store.js. O arquivo local também faz a ata sobreviver a
// restart e a /update, que numa reunião de uma hora é o que importa.
//
// Módulo isolado, como os demais: não compartilha código com lideres.js nem
// com materia.js. A única dependência é a matriz de provedores de IA (ia.js),
// que é infraestrutura comum do bot desde sempre.

const fs = require('fs');
const path = require('path');
const { DADOS_DIR } = require('./config');
const { chamarIAtexto, extrairJson } = require('./ia');

const ARQUIVO = 'atas.json';
const MAX_NOTAS = 500;          // teto de segurança; uma reunião longa dá ~80
const MAX_HISTORICO = 20;       // atas fechadas guardadas por analista
const MAX_CHARS_PROMPT = 60000; // acima disto, corta as anotações mais ANTIGAS

// ============================================================
//  PERSISTÊNCIA
// ============================================================
function carregar() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DADOS_DIR, ARQUIVO), 'utf8'));
  } catch (_) {
    return {};
  }
}

function gravar(obj) {
  fs.mkdirSync(DADOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DADOS_DIR, ARQUIVO), JSON.stringify(obj, null, 2));
}

function doUsuario(todos, userId) {
  const id = String(userId);
  if (!todos[id]) todos[id] = { aberta: null, historico: [] };
  return todos[id];
}

// ============================================================
//  DATAS (fuso de Brasília — o bot pode rodar em máquina com outro TZ)
// ============================================================
const fmtData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
});
const fmtHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
});

const diaBR  = (d = new Date()) => fmtData.format(d instanceof Date ? d : new Date(d));
const horaBR = (d = new Date()) => fmtHora.format(d instanceof Date ? d : new Date(d));

// ============================================================
//  CICLO DE VIDA DA ATA
// ============================================================

/** Ata aberta do analista (ou null). */
function ataAberta(userId) {
  return doUsuario(carregar(), userId).aberta;
}

/**
 * Abre a ata do dia. Se já houver uma aberta, NÃO cria outra — devolve a
 * existente com jaEstava=true. Reabrir por engano no meio da reunião e perder
 * o que já foi anotado seria o pior defeito possível deste módulo.
 */
function abrirAta(userId, { titulo } = {}) {
  const todos = carregar();
  const u = doUsuario(todos, userId);
  if (u.aberta) return { ata: u.aberta, jaEstava: true };
  u.aberta = {
    iniciadaEm: new Date().toISOString(),
    titulo: titulo || '',
    notas: [],
  };
  gravar(todos);
  return { ata: u.aberta, jaEstava: false };
}

/** Acrescenta uma anotação. Devolve { n, total }. Lança se não houver ata aberta. */
function anotar(userId, texto, via = 'texto') {
  const t = String(texto || '').trim();
  if (!t) throw new Error('Anotação vazia.');
  const todos = carregar();
  const u = doUsuario(todos, userId);
  if (!u.aberta) throw new Error('Não há ata aberta.');
  if (u.aberta.notas.length >= MAX_NOTAS) throw new Error(`Limite de ${MAX_NOTAS} anotações atingido.`);
  u.aberta.notas.push({ ts: new Date().toISOString(), texto: t, via });
  gravar(todos);
  return { n: u.aberta.notas.length, total: u.aberta.notas.length };
}

/** Apaga a anotação de número n (1-based). Devolve o texto apagado, ou null. */
function apagarNota(userId, n) {
  const todos = carregar();
  const u = doUsuario(todos, userId);
  if (!u.aberta) return null;
  const i = Number(n) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= u.aberta.notas.length) return null;
  const [fora] = u.aberta.notas.splice(i, 1);
  gravar(todos);
  return fora.texto;
}

/** Descarta a ata aberta sem gerar mensagem. Devolve quantas anotações se perderam. */
function descartarAta(userId) {
  const todos = carregar();
  const u = doUsuario(todos, userId);
  const n = u.aberta ? u.aberta.notas.length : 0;
  u.aberta = null;
  gravar(todos);
  return n;
}

/** Fecha a ata, guarda no histórico com a mensagem gerada e devolve a ata fechada. */
function fecharAta(userId, mensagem) {
  const todos = carregar();
  const u = doUsuario(todos, userId);
  if (!u.aberta) return null;
  const fechada = { ...u.aberta, fechadaEm: new Date().toISOString(), mensagem: mensagem || '' };
  u.historico.unshift(fechada);
  u.historico = u.historico.slice(0, MAX_HISTORICO);
  u.aberta = null;
  gravar(todos);
  return fechada;
}

/** Última ata fechada (para reenviar a mensagem sem regerar). */
function ultimaAtaFechada(userId) {
  return doUsuario(carregar(), userId).historico[0] || null;
}

/** Anotações numeradas, com a hora — o que o analista vê em /ata ver. */
function listarNotas(ata) {
  if (!ata || !ata.notas.length) return '(nenhuma anotação ainda)';
  return ata.notas
    .map((nt, i) => `${i + 1}. [${horaBR(nt.ts)}]${nt.via === 'voz' ? ' 🎤' : ''} ${nt.texto}`)
    .join('\n');
}

// ============================================================
//  MONTAGEM DA MENSAGEM (formato fixo, sem IA)
// ============================================================

// Reproduz o padrão dado pela Liderança, inclusive o espaçamento do marcador
// de atenção. Bloco sem conteúdo é OMITIDO — mensagem com "Próxima semana:"
// vazio diria à bancada que nada foi definido, o que não é a mesma coisa que
// não ter sido tratado.
function montarMensagem(blocos, { data, hoje } = {}) {
  const b = blocos || {};
  const quando = (!data || data === (hoje || diaBR()))
    ? 'de hoje'
    : `do dia ${String(data).slice(0, 5)}`;

  const partes = ['Amigos,', `Compartilho as definições da reunião de líderes ${quando}:`];

  const limpo = s => String(s || '').replace(/\s+/g, ' ').trim();

  if (limpo(b.nestaSemana))   partes.push(`Nesta semana: ${limpo(b.nestaSemana)}`);
  if (limpo(b.proximaSemana)) partes.push(`Próxima semana: ${limpo(b.proximaSemana)}`);

  for (const o of (b.outros || [])) {
    const rotulo = limpo(o?.rotulo), texto = limpo(o?.texto);
    if (rotulo && texto) partes.push(`${rotulo}: ${texto}`);
  }

  const alertas = (b.atencao || []).map(limpo).filter(Boolean);
  if (alertas.length === 1) {
    partes.push(`⚠️  Atenção: ${alertas[0]}`);
  } else if (alertas.length > 1) {
    // Vários pendentes: um marcador só, itens em linhas — repetir "⚠️ Atenção:"
    // três vezes seguidas fica ruim de ler no WhatsApp.
    partes.push(`⚠️  Atenção:\n${alertas.map(a => `• ${a}`).join('\n')}`);
  }

  return partes.join('\n\n');
}

// ============================================================
//  CONFERÊNCIA ANTIALUCINAÇÃO
// ============================================================
const SIGLAS = 'PL|PLP|PEC|PDL|PDC|PDS|PRC|PLV|PLN|MPV|MSC|REQ|RIC|PDN|INC|SUG';
const RE_REF = new RegExp(`\\b(${SIGLAS})\\s*\\.?\\s*n?[º°.]*\\s*(\\d{1,6})\\s*[\\/\\s]\\s*(\\d{2,4})\\b`, 'gi');

/** Referências de proposição normalizadas ("PL 4822/2025") num texto. */
function refsDe(texto) {
  const out = new Set();
  for (const m of String(texto || '').matchAll(RE_REF)) {
    let ano = parseInt(m[3], 10);
    if (m[3].length === 2) ano += ano < 50 ? 2000 : 1900;
    out.add(`${m[1].toUpperCase()} ${parseInt(m[2], 10)}/${ano}`);
  }
  return out;
}

/**
 * Confere a mensagem contra as anotações. Duas perguntas, as duas importantes:
 *  - a mensagem cita proposição que NÃO está nas anotações? (invenção)
 *  - as anotações citam proposição que ficou FORA da mensagem? (omissão)
 * Nenhuma das duas é corrigida automaticamente: quem decide o que vai para os
 * deputados é o analista. O bot só aponta.
 */
function conferirCitacoes(mensagem, notas) {
  const naMsg = refsDe(mensagem);
  const nasNotas = refsDe((notas || []).map(n => n.texto || n).join('\n'));
  const inventadas = [...naMsg].filter(r => !nasNotas.has(r));
  const omitidas   = [...nasNotas].filter(r => !naMsg.has(r));
  return { inventadas, omitidas };
}

// ============================================================
//  GERAÇÃO (IA — na chave do analista)
// ============================================================
const EXEMPLO =
  'Amigos,\n\n' +
  'Compartilho as definições da reunião de líderes de hoje:\n\n' +
  'Nesta semana: a pauta do Plenário será focada nos projetos de interesse do Agro, conforme acordo no Colégio de Líderes. ' +
  'Na sessão de hoje, também será votado o PL 4822/2025 (Minirreforma da Lei dos Partidos Políticos).\n\n' +
  'Próxima semana: há previsão de que as sessões sejam convocadas já a partir de segunda-feira.\n\n' +
  '⚠️  Atenção: Ainda aguardamos a definição se o registro de presença e votação para a próxima semana será ' +
  'exclusivamente presencial no Plenário ou liberado via aplicativo Infoleg.';

function montarPrompt(ata) {
  const notas = ata.notas.map((n, i) => `${i + 1}. [${horaBR(n.ts)}] ${n.texto}`);
  let corpo = notas.join('\n');
  let cortadas = 0;
  while (corpo.length > MAX_CHARS_PROMPT && notas.length > 1) {
    notas.shift(); cortadas++;
    corpo = notas.join('\n');
  }

  const prompt =
`Você é assessor(a) da Liderança do Podemos na Câmara dos Deputados. Acabou a reunião do Colégio de Líderes e o analista anotou, ao vivo, o que foi sendo definido. Sua tarefa é organizar essas anotações na mensagem que o líder vai repassar aos deputados da bancada pelo WhatsApp.

REGRA PRINCIPAL: use SOMENTE o que está nas anotações. Não complete lacuna, não deduza consequência, não acrescente contexto que você conhece de fora. Se um assunto não foi anotado, ele não existe nesta mensagem.

Registro: português do Brasil, formal e cordial, frases completas, terceira pessoa. É comunicação entre parlamentares — direta, sem jargão de bastidor ("o líder falou que", "ficou meio indefinido"), sem markdown, sem asteriscos, sem emojis (o marcador de atenção é acrescentado depois pelo sistema).

Distribua o conteúdo assim:
- nestaSemana: o que vale para a semana CORRENTE — foco da pauta do Plenário, o que será votado hoje ou nos próximos dias, acordos fechados.
- proximaSemana: o que foi previsto para a semana SEGUINTE — convocação de sessões, matérias prometidas, calendário.
- outros: assunto que não cabe nos dois anteriores (ex.: Congresso Nacional, comissões, esforço concentrado). Rótulo curto, no máximo três blocos. Use só se realmente não couber acima.
- atencao: o que ficou PENDENTE de definição ou exige cuidado da bancada. Cada pendência é um item.
- descartado: anotações que você NÃO usou, cada uma com o motivo em poucas palavras (ex.: "recado interno", "repetida no item 4"). Isto não vai para a bancada — serve para o analista conferir que nada importante se perdeu.

Proposições: escreva o número exatamente como está anotado (ex.: PL 4822/2025). Se a anotação não disser o nome/assunto do projeto, NÃO invente — cite só o número.

Bloco sem conteúdo nas anotações: devolva string vazia (ou lista vazia). Não preencha por simetria.

Este é o padrão da mensagem final, para você calibrar o tom (o sistema monta a saudação e o espaçamento; você entrega só os textos dos blocos):
---
${EXEMPLO}
---

ANOTAÇÕES DA REUNIÃO (${diaBR(ata.iniciadaEm)}${cortadas ? `; as ${cortadas} primeiras foram omitidas por tamanho` : ''}):
${corpo}

Responda APENAS com JSON, neste formato:
{"nestaSemana":"","proximaSemana":"","outros":[{"rotulo":"","texto":""}],"atencao":[""],"descartado":[""]}`;

  return { prompt, cortadas };
}

/**
 * Gera a mensagem da ata. Devolve { mensagem, blocos, descartado, avisos }.
 * A IA entra só na redação dos blocos; formato e conferência são código.
 */
async function gerarMensagem({ perfil, ata }) {
  if (!ata || !ata.notas.length) throw new Error('A ata está sem anotações.');
  if (!perfil?.apiKey) throw new Error('Sem chave de IA configurada (/config).');

  const { prompt, cortadas } = montarPrompt(ata);
  const bruto = await chamarIAtexto({
    provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
    prompt, maxTokens: 4000,
  });
  const j = extrairJson(bruto);

  const blocos = {
    nestaSemana: String(j.nestaSemana || ''),
    proximaSemana: String(j.proximaSemana || ''),
    outros: Array.isArray(j.outros) ? j.outros.slice(0, 3) : [],
    atencao: Array.isArray(j.atencao) ? j.atencao.map(String).filter(s => s.trim()) : [],
  };
  const descartado = Array.isArray(j.descartado) ? j.descartado.map(String).filter(s => s.trim()) : [];

  const temConteudo = blocos.nestaSemana.trim() || blocos.proximaSemana.trim()
    || blocos.atencao.length || (blocos.outros || []).some(o => o?.texto);
  if (!temConteudo) {
    throw new Error('A IA não devolveu conteúdo aproveitável — confira as anotações com /ata ver e tente de novo.'
      + (bruto ? `\n\nResposta recebida: ${String(bruto).slice(0, 300)}` : ''));
  }

  const mensagem = montarMensagem(blocos, { data: diaBR(ata.iniciadaEm) });
  const { inventadas, omitidas } = conferirCitacoes(mensagem, ata.notas);

  const avisos = [];
  if (cortadas) avisos.push(`As ${cortadas} anotações mais antigas ficaram de fora por tamanho.`);
  if (inventadas.length) avisos.push(`Citado na mensagem mas NÃO encontrado nas anotações: ${inventadas.join(', ')}. Confira antes de enviar.`);
  if (omitidas.length) avisos.push(`Anotado mas fora da mensagem: ${omitidas.join(', ')}.`);

  return { mensagem, blocos, descartado, avisos };
}

module.exports = {
  // ciclo de vida
  abrirAta, ataAberta, anotar, apagarNota, descartarAta, fecharAta, ultimaAtaFechada, listarNotas,
  // geração
  gerarMensagem, montarMensagem, montarPrompt,
  // conferência (exportadas para teste)
  conferirCitacoes, refsDe, diaBR, horaBR,
};
