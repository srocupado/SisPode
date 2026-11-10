// Bot · varredura de comissões com a API fora e o portal limitando pedidos:
// UMA mensagem, só com tudo coletado.
//
// 10/11/2026, noite: API em 504 e portal recusando pedidos (11 de 29 em 429).
// Uma tentativa de resposta parcial + "complemento" foi rejeitada pelo analista:
// "ele só pode mandar mensagem depois de coletar todas as informações". Agora:
//   a) API marcada como fora: depois de uma falha, as consultas seguintes vão
//      DIRETO ao portal (antes, ~1 min em 3 tentativas a cada varredura);
//   b) o que o portal recusar volta em RODADAS, com pausa, até o teto (9 min),
//      e a resposta sai UMA vez, completa. Só o que ele recusou até o fim é
//      citado, numa linha.
// Fixtures: a agenda de 10/11/2026 e a página da reunião 83160 (CPOVOS).
// Uso: node testes/bot-comissoes-rodadas.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'comissoes');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
Object.assign(P.RITMO, { intervaloMs: 1, intervaloPos429Ms: 2, intervaloMaxMs: 5, esperasMs: [5, 5, 5] });
const agenda = fs.readFileSync(path.join(FX, 'agenda-2026-11-10.html'), 'utf8');
const ev83160 = fs.readFileSync(path.join(FX, 'evento-83160.html'), 'utf8');

let portalRecusa = true, pedidos83160 = 0, recusarAte = Infinity;
const chamadas = { api: 0 };
global.fetch = async (url) => {
  url = String(url);
  if (url.startsWith('https://dadosabertos.camara.leg.br')) { chamadas.api++; return { ok: false, status: 504, json: async () => ({}), text: async () => '' }; }
  if (/\/agenda\?/.test(url)) return { ok: true, status: 200, text: async () => agenda };
  if (/evento-legislativo\/83160$/.test(url)) { pedidos83160++; return (portalRecusa && pedidos83160 <= recusarAte) ? { ok: false, status: 429, headers: { get: () => null }, text: async () => '' } : { ok: true, status: 200, text: async () => ev83160 }; }
  if (/evento-legislativo\/\d+$/.test(url)) return { ok: true, status: 200, text: async () => '<html><body>sem itens</body></html>' };
  return { ok: false, status: 404, text: async () => '' };
};
// cópia com os tempos encurtados (e sem as esperas de 1 s/2 s entre tentativas da API)
let src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'comissoes.js'), 'utf8');
for (const [de, para] of [
  [/function sleep\(ms\) \{[^}]*\}/, 'function sleep(ms) { return new Promise(r => setTimeout(r, Math.min(ms, 30))); }'],
  [/const PRAZO_VARREDURA_PORTAL_MS = [^;]+;/, 'const PRAZO_VARREDURA_PORTAL_MS = 1500;'],
  [/const PAUSA_ENTRE_RODADAS_MS = [^;]+;/, 'const PAUSA_ENTRE_RODADAS_MS = 50;'],
]) { if (!de.test(src)) throw new Error('padrão não encontrado: ' + de); src = src.replace(de, para); }
src = src.replace(/require\('\.\/([^']+)'\)/g, (_, m) => `require(${JSON.stringify(path.join(RAIZ, 'bot', 'src', m))})`);
const destino = path.join(require('os').tmpdir(), 'sispode-comissoes-rodadas-teste.js');
fs.writeFileSync(destino, src);
const C = require(destino);

(async () => {
  console.log('== API marcada como fora: a 2ª consulta vai direto ao portal ==');
  const l1 = await C.listarReunioesDeliberativas('2026-11-10');
  const apiDepois1 = chamadas.api;
  ok(apiDepois1 > 0 && /portal/.test(l1), `1ª consulta tenta a API (${apiDepois1} pedido(s)) e sai pelo portal`);
  ok(C.apiForaRecente() && /consulta direta ao portal/.test(C.apiForaRecente().message), 'a falha fica marcada');

  console.log('\n== portal recusa e depois libera: uma resposta, completa ==');
  recusarAte = 6;   // recusa os 6 primeiros pedidos dessa página (a 1ª passada faz 4) e depois libera
  const v = await C.varrerComissoesPartido('2026-11-10', { partido: 'PT' });
  ok(chamadas.api === apiDepois1, `a varredura não tocou na API (pedidos à API: ${chamadas.api - apiDepois1})`);
  ok(pedidos83160 > 4, `a comissão recusada foi tentada de novo em rodadas (${pedidos83160} pedidos)`);
  ok(/• \*PL 4212\/2024\* → relatoria\n     autor: Silvia Waiãpi \(PL\) · relator: \*Paulo Guedes \(PT\)\*/.test(v) && /Sem nada de PT \(4\)/.test(v), 'a resposta traz TODAS as comissões, inclusive a que o portal recusou no começo');
  ok(!/⏳|Ainda lendo|complemento|Sem leitura|Não consegui/i.test(v), 'nada de resposta parcial, aviso de espera ou complemento');

  console.log('\n== portal recusando até o fim: a resposta cita só o que faltou ==');
  portalRecusa = true; recusarAte = Infinity;
  P.limparCache();   // a página lida no cenário anterior está guardada (10 min)
  const v2 = await C.varrerComissoesPartido('2026-11-10', { partido: 'PSOL' });
  ok(/⚠️ Sem leitura \(o portal da Câmara recusou os pedidos até o fim\): Comissão da Amazônia e dos Povos Originários e Tradicionais\./.test(v2), 'uma linha curta com a comissão que não saiu');
  ok(!/⏳|complemento|Peça a varredura/i.test(v2), 'sem pedir para repetir nem prometer complemento');

  const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
  ok(!/aoCompletar/.test(idx) && /mando o resultado completo numa mensagem só/.test(idx), '/varrercomissoes: aviso inicial e uma resposta só');
  const ag = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'agente.js'), 'utf8');
  ok(/varrer_comissoes: 9 \* 60e3/.test(ag), 'o agente espera a varredura completa (prazo acima das rodadas)');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
