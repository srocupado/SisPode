// Bot · pauta de comissões pelo PORTAL da Câmara quando a API de Dados Abertos cai.
//
// Relato de 10/11/2026: a API inteira em HTTP 503 e o /varrercomissoes respondia
// "Erro na varredura: API da Câmara instável (5xx/timeout) após 3 tentativas".
// O portal seguia no ar: a agenda do dia e a página de cada reunião trazem o mesmo
// dado oficial, com autor e relator já com o partido.
//
// Fixtures: a agenda de 10/11/2026 e a página da reunião 83160 (CPOVOS), como o
// portal as serve. O teste troca o fetch: a API responde 503; o portal, as fixtures.
// Uso: node testes/bot-comissoes-portal.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'comissoes');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
const agenda = fs.readFileSync(path.join(FX, 'agenda-2026-11-10.html'), 'utf8');
const ev83160 = fs.readFileSync(path.join(FX, 'evento-83160.html'), 'utf8');

console.log('== agenda do dia (portal) ==');
const ag = P.parseAgendaPortal(agenda);
ok(ag.length === 15 && P.proximaPaginaAgenda(agenda) === null, `15 eventos numa página só (lidos: ${ag.length})`);
const delib = ag.filter(e => P.ehPermanente(e.orgao) && P.ehDeliberativa(e.tipo));
ok(JSON.stringify(delib.map(e => e.id)) === JSON.stringify([83155, 83164, 83211, 83160, 83192]),
  'reuniões deliberativas de comissão permanente: CPD, CASP, CSPCCO, CPOVOS e CCJC (fora: especial, externa, CMO, sessões do Plenário)');
const cp = ag.find(e => e.id === 83160);
ok(cp.orgao === 'Comissão da Amazônia e dos Povos Originários e Tradicionais' && cp.hora === '14:00' && cp.tipo === 'Reunião Deliberativa' && cp.situacao === 'convocada', 'órgão, hora, tipo e situação');

console.log('\n== página da reunião (portal) ==');
const ev = P.parseEventoPortal(ev83160);
const org = 'Comissão da Amazônia e dos Povos Originários e Tradicionais';
ok(ev.itens.length === 10 && P.siglaNaPagina(ev, org) === 'CPOVOS', '10 itens; a sigla da comissão lida da própria página');
const pl = ev.itens.find(i => i.titulo === 'PL 4212/2024');
ok(pl && pl.id === 2466435 && JSON.stringify(pl.autores) === '[["Silvia Waiãpi","PL"]]' && pl.relator === 'Paulo Guedes' && pl.relPartido === 'PT', 'autora e relator com o partido');
ok(P.votoNaComissao(pl, org) === 'pela aprovação, com substitutivo', 'o voto do relator nesta comissão, do parecer');
const pl6301 = ev.itens.find(i => i.titulo === 'PL 6301/2025');
ok(P.votoNaComissao(pl6301, org) === 'pela aprovação do PL 6301/25 e do Substitutivo da Comissão de Educação, com substitutivo', 'parecer de outra comissão (CE) não entra no voto desta');
ok(JSON.stringify(P.parsePessoas('Fulano de Tal (PODE-PR), Beltrana (PL-RJ)')) === '[["Fulano de Tal","PODE"],["Beltrana","PL"]]' && JSON.stringify(P.parsePessoas('do Tribunal Superior do Trabalho')) === '[["do Tribunal Superior do Trabalho",""]]', 'autores com e sem partido');

console.log('\n== o bot com a API em 503 ==');
const chamadas = { api: 0, portal: [] };
global.fetch = async (url) => {
  url = String(url);
  if (url.startsWith('https://dadosabertos.camara.leg.br')) { chamadas.api++; return { ok: false, status: 503, json: async () => ({}), text: async () => '' }; }
  chamadas.portal.push(url);
  const html = /\/agenda\?/.test(url) ? agenda : /evento-legislativo\/83160$/.test(url) ? ev83160 : /evento-legislativo\/\d+$/.test(url) ? '<html><body>sem itens</body></html>' : null;
  return html == null ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => html };
};
// sem as esperas de 1 s e 2 s entre as tentativas
const src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'comissoes.js'), 'utf8').replace(/function sleep\(ms\) \{[^}]*\}/, 'function sleep() { return Promise.resolve(); }')
  .replace(/require\('\.\/([^']+)'\)/g, (_, m) => `require(${JSON.stringify(path.join(RAIZ, 'bot', 'src', m))})`);
const destino = path.join(require('os').tmpdir(), 'sispode-comissoes-portal-teste.js');
fs.writeFileSync(destino, src);
const C = require(destino);

(async () => {
  const v = await C.varrerComissoesPartido('2026-11-10', { partido: 'PT' });
  ok(chamadas.api > 0 && /API de Dados Abertos da Câmara fora do ar — dados lidos do portal/.test(v), 'a varredura sai pelo portal e avisa a fonte');
  ok(/🏛️ Comissão da Amazônia e dos Povos Originários e Tradicionais \(CPOVOS\) — 10\/11\/2026/.test(v), 'a seção da comissão, com a sigla lida da página');
  ok(/• \*PL 4212\/2024\* → relatoria\n     autor: Silvia Waiãpi \(PL\) · relator: \*Paulo Guedes \(PT\)\*\n     🗳️ voto do relator: pela aprovação, com substitutivo/.test(v), 'item com relatoria do partido procurado, em negrito, com o voto');
  ok(/Sem nada de PT \(4\): Comissão de Administração/.test(v), 'as outras quatro comissões deliberativas, sem nada do PT');
  ok(!/Erro na varredura/.test(v) && !/instável/.test(v.split('fora do ar')[0]), 'nada de erro para o analista');
  const pode = await C.varrerComissoesPartido('2026-11-10', { partido: 'Podemos' });
  ok(/Nenhuma das comissões com reunião deliberativa hoje tem projeto \(autoria\/relatoria\) de Podemos/.test(pode), 'Podemos sem itens nessas pautas: diz isso, não erro');

  const l = await C.listarReunioesDeliberativas('2026-11-10');
  ok(/• Comissão da Amazônia e dos Povos Originários e Tradicionais — 14h/.test(l) && (l.match(/^• /gm) || []).length === 5 && /portal/.test(l), 'lista de reuniões deliberativas pelo portal (5)');

  const pc = await C.consultarPauta('Comissão da Amazônia', '10/11/2026', { partido: 'PDT' });
  ok(/• \*REQ 100\/2026\* → autoria\n     autor: \*Dorinaldo Malafaia \(PDT\)\*/.test(pc) && /fora do ar/.test(pc), 'pauta de uma comissão pelo nome, pelo portal');
  const pn = await C.consultarPauta('Comissão de Turismo', '10/11/2026', {});
  ok(/“Comissão de Turismo” — sem reunião dessa comissão na agenda do portal em 10\/11\/2026/.test(pn), 'comissão sem reunião no dia: diz isso');

  console.log('\n== portal respondendo 429 (pedidos demais) ==');
  // 10/11/2026: 15 de ~20 reuniões voltaram "HTTP 429" porque as páginas eram
  // abertas em paralelo. Agora vão uma por vez, e 429 espera e tenta de novo.
  Object.assign(P.RITMO, { intervaloMs: 5, intervaloPos429Ms: 20, intervaloMaxMs: 40, esperasMs: [30, 60, 90] });
  P.limparCache();   // as páginas da varredura anterior estão guardadas
  let emVoo = 0, picoEmVoo = 0, n429 = 0;
  const fetchNormal = global.fetch;
  global.fetch = async (url, init) => {
    emVoo++; picoEmVoo = Math.max(picoEmVoo, emVoo);
    await new Promise(r => setTimeout(r, 5));
    try {
      if (/evento-legislativo\/\d+$/.test(String(url)) && n429 < 4) {
        n429++;
        return { ok: false, status: 429, headers: { get: h => (h === 'retry-after' && n429 === 1 ? '0.05' : null) }, text: async () => '' };
      }
      return await fetchNormal(url, init);
    } finally { emVoo--; }
  };
  const v429 = await C.varrerComissoesPartido('2026-11-10', { partido: 'PT' });
  ok(picoEmVoo === 1, `um pedido ao portal por vez (pico em voo: ${picoEmVoo})`);
  ok(n429 === 4 && !/Não consegui ler/.test(v429) && /\*PL 4212\/2024\* → relatoria/.test(v429), 'os 429 esperam e repetem: a varredura sai completa');
  const antes = P.pedidosFeitos();
  await C.varrerComissoesPartido('2026-11-10', { partido: 'PT' });
  ok(P.pedidosFeitos() === antes, 'repetir a varredura logo depois usa as páginas guardadas (nenhum pedido novo ao portal)');
  global.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => '' });
  let e429 = null; try { await P.baixar('https://www.camara.leg.br/evento-legislativo/1'); } catch (e) { e429 = e.message; }
  ok(/HTTP 429 \(pedidos demais, mesmo depois de esperar\)/.test(e429 || ''), `429 que não passa: desiste depois das esperas e diz por quê (${e429})`);

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
