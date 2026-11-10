// Bot · varredura de comissões com a API fora e o portal limitando pedidos.
//
// 10/11/2026, noite: API em 504 e portal recusando pedidos (11 de 29 em 429).
// A varredura levava 164 s e deixava 8 comissões de fora ("peça de novo").
// Duas mudanças, travadas aqui:
//   a) API marcada como fora: depois de uma falha, as consultas seguintes vão
//      DIRETO ao portal (antes, ~1 min em 3 tentativas a cada varredura);
//   b) complemento em segundo plano: o que o portal não liberou no teto da
//      resposta continua sendo lido e chega numa 2ª mensagem.
// Fixtures: a agenda de 10/11/2026 e a página da reunião 83160 (CPOVOS).
// Uso: node testes/bot-comissoes-complemento.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'comissoes');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
Object.assign(P.RITMO, { intervaloMs: 1, intervaloPos429Ms: 2, intervaloMaxMs: 5, esperasMs: [5, 5, 5] });
const agenda = fs.readFileSync(path.join(FX, 'agenda-2026-11-10.html'), 'utf8');
const ev83160 = fs.readFileSync(path.join(FX, 'evento-83160.html'), 'utf8');

let portalRecusa = true;
const chamadas = { api: 0 };
global.fetch = async (url) => {
  url = String(url);
  if (url.startsWith('https://dadosabertos.camara.leg.br')) { chamadas.api++; return { ok: false, status: 504, json: async () => ({}), text: async () => '' }; }
  if (/\/agenda\?/.test(url)) return { ok: true, status: 200, text: async () => agenda };
  if (/evento-legislativo\/83160$/.test(url)) return portalRecusa ? { ok: false, status: 429, headers: { get: () => null }, text: async () => '' } : { ok: true, status: 200, text: async () => ev83160 };
  if (/evento-legislativo\/\d+$/.test(url)) return { ok: true, status: 200, text: async () => '<html><body>sem itens</body></html>' };
  return { ok: false, status: 404, text: async () => '' };
};
// cópia com os tempos encurtados (e sem as esperas de 1 s/2 s entre tentativas da API)
let src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'comissoes.js'), 'utf8');
for (const [de, para] of [
  [/function sleep\(ms\) \{[^}]*\}/, 'function sleep(ms) { return new Promise(r => setTimeout(r, Math.min(ms, 30))); }'],
  [/const PRAZO_VARREDURA_PORTAL_MS = [^;]+;/, 'const PRAZO_VARREDURA_PORTAL_MS = 1500;'],
  [/const PRAZO_COMPLEMENTO_MS = [^;]+;/, 'const PRAZO_COMPLEMENTO_MS = 3000;'],
  [/const PAUSA_ENTRE_RODADAS_MS = [^;]+;/, 'const PAUSA_ENTRE_RODADAS_MS = 50;'],
]) { if (!de.test(src)) throw new Error('padrão não encontrado: ' + de); src = src.replace(de, para); }
src = src.replace(/require\('\.\/([^']+)'\)/g, (_, m) => `require(${JSON.stringify(path.join(RAIZ, 'bot', 'src', m))})`);
const destino = path.join(require('os').tmpdir(), 'sispode-comissoes-complemento-teste.js');
fs.writeFileSync(destino, src);
const C = require(destino);

(async () => {
  console.log('== API marcada como fora: a 2ª consulta vai direto ao portal ==');
  const l1 = await C.listarReunioesDeliberativas('2026-11-10');
  const apiDepois1 = chamadas.api;
  ok(apiDepois1 > 0 && /portal/.test(l1), `1ª consulta tenta a API (${apiDepois1} pedido(s)) e sai pelo portal`);
  ok(C.apiForaRecente() && /consulta direta ao portal/.test(C.apiForaRecente().message), 'a falha fica marcada');

  console.log('\n== portal limitando: resposta no teto + complemento depois ==');
  const recebidos = [];
  let avisar;
  const chegou = new Promise(r => { avisar = r; });
  const v = await C.varrerComissoesPartido('2026-11-10', { partido: 'PT', aoCompletar: async t => { recebidos.push(t); avisar(); } });
  ok(chamadas.api === apiDepois1, `a varredura não tocou na API (pedidos à API: ${chamadas.api - apiDepois1})`);
  ok(/⏳ Ainda lendo 1 comissão\(ões\) — o portal da Câmara está limitando os pedidos: Comissão da Amazônia e dos Povos Originários e Tradicionais\. Mando o complemento aqui/.test(v), 'a resposta diz o que ainda está sendo lido e que o complemento vem');
  ok(!/Não consegui ler a pauta/.test(v), 'não vira "não consegui" (nem "peça de novo")');
  ok(/Sem nada de PT \(4\)/.test(v), 'as outras quatro comissões já vêm na resposta');
  portalRecusa = false;   // o portal volta a liberar
  await Promise.race([chegou, new Promise(r => setTimeout(r, 4000))]);
  const c = recebidos[0] || '';
  ok(recebidos.length === 1, 'chega UMA mensagem de complemento');
  ok(/^🏛️ Complemento da varredura de 10\/11\/2026 — PT \(as 1 comissão\(ões\) que faltaram\)/.test(c), 'cabeçalho do complemento');
  ok(/• \*PL 4212\/2024\* → relatoria\n     autor: Silvia Waiãpi \(PL\) · relator: \*Paulo Guedes \(PT\)\*/.test(c), 'a comissão que faltou chega com o item do partido');

  console.log('\n== portal recusando até o fim: o complemento diz o que não deu ==');
  portalRecusa = true;
  P.limparCache();   // a página lida no cenário anterior está guardada (10 min)
  const r2 = [];
  let avisar2;
  const chegou2 = new Promise(r => { avisar2 = r; });
  await C.varrerComissoesPartido('2026-11-10', { partido: 'PSOL', aoCompletar: async t => { r2.push(t); avisar2(); } });
  await Promise.race([chegou2, new Promise(r => setTimeout(r, 6000))]);
  ok(/⚠️ Mesmo assim não consegui ler: Comissão da Amazônia e dos Povos Originários e Tradicionais \(.*\)\. O portal da Câmara segue recusando pedidos — tente mais tarde\./.test(r2[0] || ''), 'complemento avisa a comissão que não saiu');

  console.log('\n== sem quem receba o complemento (uso antigo): como antes ==');
  P.limparCache();
  const v3 = await C.varrerComissoesPartido('2026-11-10', { partido: 'PT' });
  ok(/⚠️ Não consegui ler a pauta de 1 comissão/.test(v3) && !/⏳/.test(v3), 'lista o que faltou e sugere repetir');

  const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
  ok(/aoCompletar: texto => responderLongo\(ctx, texto\)/.test(idx), '/varrercomissoes manda o complemento na conversa');
  ok(/aoCompletar: texto => enviarLongo\(bot\.api, chatId, texto\)/.test(idx) && /ferramentasDado\(ctx\.from\.id, perfil, ctx\.chat\.id\)/.test(idx), 'pela pergunta ao agente também (no chat da pergunta)');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
