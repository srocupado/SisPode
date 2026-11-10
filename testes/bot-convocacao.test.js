// Bot · aviso de CONVOCAÇÃO de sessão deliberativa e formato do WhatsApp.
//
// Pedido de 10/11/2026: quando o site publica a sessão deliberativa, o grupo
// recebe
//   ❗ *CONVOCAÇÃO DE SESSÃO EXTRAORDINÁRIA – TERÇA-FEIRA (10/11) – 13h55*
//
//   🗒️  *Pauta*  + os itens com o apelido      (pauta publicada)
//   🗒️  *Pauta a ser divulgada oportunamente.*  (sem pauta)
// e toda mensagem do bot sai como texto puro com os marcadores do WhatsApp.
//
// Fixtures: a agenda do Plenário de 10 a 20/11/2026 (portal), a página da
// sessão 83243 antes da pauta e a da 83159 (com itens), como o portal as serve.
// Nada sai para a rede: o fetch é trocado e o Firebase é um objeto em memória.
// Uso: node testes/bot-convocacao.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'plenario');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const C = require(path.join(RAIZ, 'bot', 'src', 'convocacao.js'));
const W = require(path.join(RAIZ, 'bot', 'src', 'whatsapp.js'));
const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
const agenda = fs.readFileSync(path.join(FX, 'agenda-2026-11-10a20.html'), 'utf8');
const semPauta = fs.readFileSync(path.join(FX, 'evento-83243-sem-pauta.html'), 'utf8');
const comPauta = fs.readFileSync(path.join(FX, 'evento-83159.html'), 'utf8');

console.log('== quais sessões anunciar ==');
const ag = P.parseAgendaPortal(agenda).map(e => ({ id: e.id, data: e.data, hora: e.hora, nome: e.tema, tipo: e.tipo, situacao: e.situacao }));
ok(ag.length === 10 && ag.every(e => /^2026-11-\d{2}$/.test(e.data)), 'a agenda do intervalo traz a data de cada sessão');
const alvo = ag.filter(e => C.ehSessaoDeliberativa(e) && C.ehConvocada(e, '2026-11-10T09:00'));
ok(alvo.length === 1 && alvo[0].id === 83243, 'só a deliberativa convocada (fora as solenes, as encerradas e as agendadas não deliberativas)');
ok(!alvo.filter(e => C.ehConvocada(e, '2026-11-10T14:00')).length, 'sessão que já devia ter começado não é anunciada');

console.log('\n== o texto ==');
const ev = alvo[0];
ok(C.cabecalho(ev) === '❗ *CONVOCAÇÃO DE SESSÃO EXTRAORDINÁRIA – TERÇA-FEIRA (10/11) – 13h55*', 'cabeçalho no formato pedido');
ok(C.cabecalho({ data: '2026-11-11', hora: '09:00', nome: 'Sessão Deliberativa Ordinária' }) === '❗ *CONVOCAÇÃO DE SESSÃO ORDINÁRIA – QUARTA-FEIRA (11/11) – 09h*', 'ordinária, quarta, hora cheia');
ok(C.montarMensagem(ev, []) === '❗ *CONVOCAÇÃO DE SESSÃO EXTRAORDINÁRIA – TERÇA-FEIRA (10/11) – 13h55*\n\n🗒️  *Pauta a ser divulgada oportunamente.*', 'sem pauta: o texto exato');
const itens = C.itensDoPortal(P.parseEventoPortal(comPauta));
ok(itens.length === 5 && itens[0].alvo && itens[0].alvo.sigla === 'PL' && itens[0].alvo.numero === '2167', 'requerimento de urgência aponta o projeto urgenciado');
ok(C.linhaItem(itens[0], 'Apelido', 1) === '1. Urgência ao PL 2167/2026 (Apelido)' && C.linhaItem(itens[2], 'Drones em presídios', 3) === '3. PL 5902/2023 (Drones em presídios)', 'linha do item: "o que será votado (apelido)", como no índice da extensão');
ok(C.apelidoFallback(itens[3].ementa) === 'Institui o Dia Nacional da Consolidação da Independência do…', 'apelido de reserva: a 1ª oração da ementa, cortada em 60 caracteres (a regra da extensão)');
const api = C.itensDaApi([
  { ordem: 2, titulo: 'PL 3220/2019', proposicao_: { siglaTipo: 'PL', numero: 3220, ano: 2019, ementa: 'Dispõe sobre postes.' } },
  { ordem: 1, titulo: 'REQ 4375/2026', proposicao_: { siglaTipo: 'REQ', numero: 4375, ano: 2026, ementa: 'Requer urgência para o Projeto de Lei nº 2.167, de 2026.' },
    proposicaoRelacionada_: { siglaTipo: 'PL', numero: '2167', ano: '2026', ementa: 'Cria o programa X.' } },
]);
ok(api.length === 2 && api[0].sigla === 'REQ' && api[0].alvo.numero === '2167' && api[0].alvo.ementa === 'Cria o programa X.' && api[1].ementa === 'Dispõe sobre postes.', 'pauta pela API: ordem, urgência e ementas');

console.log('\n== o ciclo do bot ==');
let pagina = semPauta;
const fb = {};
global.fetch = async (url, init = {}) => {
  url = String(url);
  const json = (o, s = 200) => ({ ok: s < 400, status: s, json: async () => o, text: async () => JSON.stringify(o) });
  const html = h => ({ ok: true, status: 200, text: async () => h });
  if (/firebaseio\.com/.test(url)) return json(null);
  if (url.startsWith('https://dadosabertos.camara.leg.br')) return json({}, 503);
  if (/\/agenda\?/.test(url)) return html(agenda);
  if (/evento-legislativo\/83243$/.test(url)) return html(pagina);
  if (/busca-api/.test(url)) return json({ hits: { hits: [{ _source: { numero: 2167, ano: 2026, ementa: 'Cria a Política Nacional de Cuidados Paliativos; e dá outras providências.' } }] } });
  return json({}, 404);
};
const env = [];
const cfg = {
  api: { sendMessage: async (chat, texto) => { env.push({ chat, texto }); return { message_id: env.length }; } },
  destino: () => 'GRUPO', perfilIA: () => null, agora: () => '2026-11-10T09:00',
  fbGet: async p => (p === '/bot/convocacoes' ? fb : null),
  fbPatch: async (p, v) => { fb[p.split('/').pop()] = v; return v; },
};
(async () => {
  let m = await C.tickConvocacoes(cfg);
  ok(m.length === 1 && env[0].chat === 'GRUPO' && /Pauta a ser divulgada oportunamente/.test(env[0].texto) && fb[83243] && fb[83243].comPauta === false, 'convocada sem pauta: avisa e registra');
  ok(env.length === 2 && env[1].chat === 'GRUPO' && env[1].texto === '*ATENÇÃO*❗️\n\n*Registro de presença e participação pelo app Infoleg*', 'semipresencial: em seguida, o aviso do app Infoleg (texto exato)');
  ok(!C.ehSemipresencial({ nome: 'Sessão Deliberativa Extraordinária', tipo: 'Sessão para a votação de propostas legislativas' }), 'presencial não recebe o aviso');
  env.splice(1, 1);   // daqui em diante só as convocações
  m = await C.tickConvocacoes(cfg);
  ok(m.length === 0 && env.length === 1, 'o tick seguinte não repete');
  pagina = comPauta;   // a pauta saiu
  m = await C.tickConvocacoes(cfg);
  const t = env[1] && env[1].texto;
  ok(m.length === 1 && /^❗ \*CONVOCAÇÃO DE SESSÃO EXTRAORDINÁRIA – TERÇA-FEIRA \(10\/11\) – 13h55\*\n\n🗒️  \*Pauta\*\n1\. /.test(t || ''), 'a pauta saiu: reenvia a convocação com a pauta');
  ok(/^1\. Urgência ao PL 2167\/2026 \(Cria a Política Nacional de Cuidados Paliativos\)$/m.test(t || '') && /^5\. PL 5815\/2025 \(/m.test(t || ''), 'itens numerados com apelido (sem IA: o de reserva; urgência pela ementa do projeto)');
  m = await C.tickConvocacoes(cfg);
  ok(m.length === 0 && env.length === 2 && fb[83243].comPauta === true, 'com pauta enviada, não manda mais (e o reenvio com a pauta não repetiu o aviso do Infoleg)');
  const falhaFb = { ...cfg, fbGet: async () => { throw new Error('Firebase GET 503'); } };
  let erro = null; try { await C.tickConvocacoes({ ...falhaFb, agora: () => '2026-11-10T09:00' }); } catch (e) { erro = e.message; }
  ok(erro && env.length === 2, 'sem ler o registro, não envia (evita mensagem em dobro)');

  console.log('\n== formato do WhatsApp ==');
  const md = W.payloadWhatsApp('sendMessage', { chat_id: 1, text: 'Anunciado o *PL 1/2026* — veja [a pauta](https://x.y/p)', parse_mode: 'Markdown' });
  ok(md.text === 'Anunciado o *PL 1/2026* — veja a pauta (https://x.y/p)' && !('parse_mode' in md), 'Markdown do Telegram: texto puro, asteriscos visíveis, link por extenso');
  const ht = W.payloadWhatsApp('sendMessage', { chat_id: 1, text: '📎 <b>Documentos de PL 1/2026</b> (2)\n• <a href="https://c.br/a?x=1&amp;y=2">Parecer</a>\n<i>nota</i> &lt;3', parse_mode: 'HTML' });
  ok(ht.text === '📎 *Documentos de PL 1/2026* (2)\n• Parecer (https://c.br/a?x=1&y=2)\n_nota_ <3' && !('parse_mode' in ht), 'HTML: <b>→*, <i>→_, link e entidades');
  const ia = W.payloadWhatsApp('sendMessage', { chat_id: 1, text: '## Resumo\nO **relator** votou.' });
  ok(ia.text === '*Resumo*\nO *relator* votou.', 'saída de IA: **negrito** e título viram o negrito do WhatsApp');
  const ed = W.payloadWhatsApp('editMessageText', { chat_id: 1, message_id: 2, text: '*ok*', parse_mode: 'Markdown' });
  ok(ed.text === '*ok*' && !ed.parse_mode, 'edição também');
  const cap = W.payloadWhatsApp('sendPhoto', { chat_id: 1, photo: 'x', caption: '<b>Placar</b>', parse_mode: 'HTML' });
  ok(cap.caption === '*Placar*' && !cap.parse_mode, 'legenda de foto também');
  const outro = { chat_id: 1, callback_query_id: 'z', text: 'Configure sua chave' };
  ok(W.payloadWhatsApp('answerCallbackQuery', outro) === outro, 'outros métodos passam intactos');

  const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
  ok(/bot\.api\.config\.use\(\(prev, method, payload, signal\) => prev\(method, payloadWhatsApp\(method, payload\), signal\)\)/.test(idx), 'index.js aplica o formato a toda chamada da API');
  ok(/iniciarConvocacoes\(\{/.test(idx), 'index.js liga a vigia de convocações');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
