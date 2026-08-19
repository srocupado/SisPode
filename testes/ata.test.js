// Testes do /ata (bot) — anotação da Reunião de Líderes e a mensagem da bancada.
//
// O que dá para testar sem IA é justamente o que não pode falhar: o FORMATO da
// mensagem (montado por código, não pelo modelo), o ciclo de vida da ata em
// disco e a conferência antialucinação. A geração por IA só roda com
// GEMINI_API_KEY no ambiente.
//
// Uso: node testes/ata.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');

// O módulo grava em DADOS_DIR (config.js), que por sua vez exige BOT_TOKEN.
// Aponta os dois para um sandbox: o teste não pode encostar em bot/dados/.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-teste-'));
process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'teste:token';
const configPath = require.resolve(path.join(__dirname, '..', 'bot', 'src', 'config.js'));
require(configPath);
require.cache[configPath].exports.DADOS_DIR = SANDBOX;

const A = require(path.join(__dirname, '..', 'bot', 'src', 'ata.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const U = 999999;   // usuário fictício do teste

(async () => {
  console.log('== montarMensagem: o padrão da Liderança ==');
  const hoje = A.diaBR();
  const msg = A.montarMensagem({
    nestaSemana: 'a pauta do Plenário será focada nos projetos de interesse do Agro, conforme acordo no Colégio de Líderes. Na sessão de hoje, também será votado o PL 4822/2025 (Minirreforma da Lei dos Partidos Políticos).',
    proximaSemana: 'há previsão de que as sessões sejam convocadas já a partir de segunda-feira.',
    atencao: ['Ainda aguardamos a definição se o registro de presença e votação para a próxima semana será exclusivamente presencial no Plenário ou liberado via aplicativo Infoleg.'],
  }, { data: hoje, hoje });

  const esperado =
    'Amigos,\n\n' +
    'Compartilho as definições da reunião de líderes de hoje:\n\n' +
    'Nesta semana: a pauta do Plenário será focada nos projetos de interesse do Agro, conforme acordo no Colégio de Líderes. Na sessão de hoje, também será votado o PL 4822/2025 (Minirreforma da Lei dos Partidos Políticos).\n\n' +
    'Próxima semana: há previsão de que as sessões sejam convocadas já a partir de segunda-feira.\n\n' +
    '⚠️  Atenção: Ainda aguardamos a definição se o registro de presença e votação para a próxima semana será exclusivamente presencial no Plenário ou liberado via aplicativo Infoleg.';
  ok(msg === esperado, 'reproduz o modelo dado pela Liderança, caractere a caractere');

  console.log('\n== montarMensagem: blocos ausentes e variações ==');
  const so1 = A.montarMensagem({ nestaSemana: 'sessão só de discussão.' }, { data: hoje, hoje });
  ok(!so1.includes('Próxima semana'), 'bloco vazio é OMITIDO, não vira "Próxima semana: (nada)"');
  ok(!so1.includes('Atenção'), 'sem pendência, não há marcador de atenção');
  ok(so1.split('\n\n').length === 3, 'saudação + convite + um bloco');

  const doisAlertas = A.montarMensagem({
    nestaSemana: 'x', atencao: ['primeira pendência', 'segunda pendência'],
  }, { data: hoje, hoje });
  ok(/⚠️  Atenção:\n• primeira pendência\n• segunda pendência/.test(doisAlertas),
     'duas pendências: um marcador só, itens em linhas');

  const outroDia = A.montarMensagem({ nestaSemana: 'x' }, { data: '04/08/2026', hoje: '11/08/2026' });
  ok(outroDia.includes('reunião de líderes do dia 04/08:'), 'ata gerada depois nomeia a data, não diz "de hoje"');

  const comOutros = A.montarMensagem({
    nestaSemana: 'x', outros: [{ rotulo: 'Congresso Nacional', texto: 'sessão conjunta na quarta.' }],
  }, { data: hoje, hoje });
  ok(comOutros.includes('Congresso Nacional: sessão conjunta na quarta.'), 'bloco extra rotulado entra na mensagem');
  ok(comOutros.indexOf('Congresso Nacional') > comOutros.indexOf('Nesta semana'), 'bloco extra vem depois dos fixos');

  console.log('\n== conferência antialucinação ==');
  ok([...A.refsDe('votar o PL 4822/2025 e a pec 45/19')].join(' ') === 'PL 4822/2025 PEC 45/2019',
     'refsDe normaliza sigla e ano de dois dígitos');
  const notas = [{ texto: 'hoje vota PL 4822/2025' }, { texto: 'REQ 1258/2026 aprovado' }];
  const c1 = A.conferirCitacoes('Nesta semana: será votado o PL 4822/2025 e o PL 9999/2026.', notas);
  ok(c1.inventadas.join() === 'PL 9999/2026', 'acusa proposição citada que NÃO está nas anotações');
  ok(c1.omitidas.join() === 'REQ 1258/2026', 'acusa proposição anotada que ficou de fora da mensagem');
  const c2 = A.conferirCitacoes('Nesta semana: PL 4822/2025 e REQ 1258/2026.', notas);
  ok(!c2.inventadas.length && !c2.omitidas.length, 'mensagem fiel às anotações não gera aviso');

  console.log('\n== ciclo de vida da ata (em disco) ==');
  const a1 = A.abrirAta(U);
  ok(!a1.jaEstava && a1.ata.notas.length === 0, 'abre vazia');
  const a2 = A.abrirAta(U);
  ok(a2.jaEstava, 'abrir de novo NÃO cria outra ata (não perde o que já foi anotado)');

  A.anotar(U, 'pauta focada no Agro');
  A.anotar(U, 'hoje vota PL 4822/2025');
  const r3 = A.anotar(U, 'engano, apagar isto', 'voz');
  ok(r3.n === 3, 'numeração sequencial');
  ok(A.ataAberta(U).notas.length === 3, 'anotações persistem entre chamadas (leitura do disco)');

  const apagada = A.apagarNota(U, 3);
  ok(apagada === 'engano, apagar isto' && A.ataAberta(U).notas.length === 2, 'apagar por número');
  ok(A.apagarNota(U, 9) === null, 'número inexistente não quebra nem apaga outra');

  const listagem = A.listarNotas(A.ataAberta(U));
  ok(/^1\. \[\d{2}:\d{2}\] pauta focada no Agro/.test(listagem), 'listagem numerada e com hora');

  const fechada = A.fecharAta(U, 'MENSAGEM FINAL');
  ok(fechada.notas.length === 2 && fechada.mensagem === 'MENSAGEM FINAL', 'fecha guardando a mensagem');
  ok(A.ataAberta(U) === null, 'depois de fechar não há ata aberta');
  ok(A.ultimaAtaFechada(U).mensagem === 'MENSAGEM FINAL', '/ata ultima recupera sem regerar');

  A.abrirAta(U); A.anotar(U, 'algo');
  ok(A.descartarAta(U) === 1 && A.ataAberta(U) === null, 'descartar joga a ata fora');

  let erro = null;
  try { A.anotar(U, 'sem ata aberta'); } catch (e) { erro = e.message; }
  ok(/Não há ata aberta/.test(erro || ''), 'anotar sem ata aberta é erro explícito, não silêncio');

  console.log('\n== prompt ==');
  A.abrirAta(U);
  A.anotar(U, 'pauta da semana focada no Agro');
  const { prompt } = A.montarPrompt(A.ataAberta(U));
  ok(prompt.includes('use SOMENTE o que está nas anotações'), 'trava antialucinação no prompt');
  ok(prompt.includes('pauta da semana focada no Agro'), 'anotações entram no prompt');
  ok(prompt.includes('descartado'), 'pede o que ficou de fora, para o analista conferir');
  A.descartarAta(U);

  if (process.env.GEMINI_API_KEY) {
    console.log('\n== geração por IA (chave real) ==');
    A.abrirAta(U);
    for (const n of [
      'pauta do plenário essa semana vai ser focada nos projetos do agro, acordo do colégio de líderes',
      'hoje ainda vota o PL 4822/2025, minirreforma da lei dos partidos',
      'semana que vem tem previsão de convocar sessão já a partir de segunda',
      'ainda não definiram se presença e votação semana que vem vai ser só presencial no plenário ou libera o infoleg',
      'lembrar de ligar pro gabinete do deputado depois',
    ]) A.anotar(U, n);

    const t0 = Date.now();
    const r = await A.gerarMensagem({
      perfil: { provedor: 'gemini', apiKey: process.env.GEMINI_API_KEY },
      ata: A.ataAberta(U),
    });
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log('\n--- mensagem gerada ---\n' + r.mensagem + '\n-----------------------');
    ok(r.mensagem.startsWith('Amigos,\n\nCompartilho as definições da reunião de líderes'), 'abre no padrão');
    ok(/\nNesta semana: /.test(r.mensagem), 'tem o bloco da semana corrente');
    ok(/\nPróxima semana: /.test(r.mensagem), 'tem o bloco da semana seguinte');
    ok(/⚠️  Atenção: /.test(r.mensagem), 'a pendência do Infoleg virou atenção');
    ok(r.mensagem.includes('PL 4822/2025'), 'preserva o número da proposição como anotado');
    ok(!r.avisos.some(a => /NÃO encontrado/.test(a)), 'não inventou proposição' + (r.avisos.length ? ` (avisos: ${r.avisos.join(' | ')})` : ''));
    ok(!/asteriscos|\*\*/.test(r.mensagem), 'sem markdown na mensagem do WhatsApp');
    ok(!/gabinete/i.test(r.mensagem), 'recado interno não vaza para a bancada');
    ok(r.descartado.length > 0, `declara o que descartou (${r.descartado.join(' | ') || 'nada'})`);
    A.descartarAta(U);
  } else {
    console.log('\n(defina GEMINI_API_KEY para testar também a geração por IA)');
  }

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
