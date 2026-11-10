// Bot · Ordem do Dia com a API de Dados Abertos fora.
//
// 10/11/2026: "Bot não puxou a pauta hoje". A Ordem do Dia (odd.js) dependia só
// da API — sem prazo, sem nova tentativa, sem alternativa — e a falha da API
// virava "não há sessão hoje". Agora: API com prazo e novas tentativas; se ela
// falhar, a sessão vem da agenda do Plenário no portal e os itens da página da
// sessão; as duas fontes fora = erro dito como tal.
// Fixtures: a agenda do Plenário de 10 a 20/11/2026 e a página da sessão 83243
// (seção "Propostas analisadas", 9 itens).
// Uso: node testes/bot-odd-contingencia.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'plenario');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
Object.assign(P.RITMO, { intervaloMs: 1, esperasMs: [] });
const agenda = fs.readFileSync(path.join(FX, 'agenda-2026-11-10a20.html'), 'utf8');
const sessao = fs.readFileSync(path.join(FX, 'evento-83243-analisados.html'), 'utf8');
let portalFora = false, api = 0;
global.fetch = async (url) => {
  url = String(url);
  if (url.startsWith('https://dadosabertos.camara.leg.br')) { api++; return { ok: false, status: 504, json: async () => ({}) }; }
  if (portalFora) return { ok: false, status: 503, headers: { get: () => null }, text: async () => '' };
  if (/\/agenda\?/.test(url)) return { ok: true, status: 200, text: async () => agenda };
  if (/evento-legislativo\/83243$/.test(url)) return { ok: true, status: 200, text: async () => sessao };
  return { ok: false, status: 404, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
};
// sem as esperas de 1 s/2 s entre as tentativas da API
let src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'odd.js'), 'utf8')
  .replace('await new Promise(r => setTimeout(r, 1000 * t));', 'await null;')
  .replace(/require\('\.\/([^']+)'\)/g, (_, m) => `require(${JSON.stringify(path.join(RAIZ, 'bot', 'src', m))})`);
const destino = path.join(require('os').tmpdir(), 'sispode-odd-teste.js');
fs.writeFileSync(destino, src);
const O = require(destino);

(async () => {
  console.log('== API fora: a sessão pela agenda do portal ==');
  const evs = await O.eventosDeliberativos('2026-11-10');
  ok(api === 3, `a API foi tentada 3 vezes (${api})`);
  ok(evs.length === 1 && evs[0].id === 83243 && evs[0].fonte === 'portal' && /Extraordinária/.test(evs[0].descricao), 'a sessão deliberativa de hoje (83243) — as solenes ficam de fora');

  console.log('\n== API fora: os itens pela página da sessão ==');
  const odd = await O.buscarOrdemDoDia(83243, '2026-11-10');
  const its = odd.parsed.itens;
  ok(odd.fonte === 'portal' && its.length === 9, `${its.length} itens, fonte portal`);
  const req = its.find(i => i.chave === 'REQ-2994-2026');
  ok(req && req.tipoCategoria === 'requerimento' && req.projetoUrgenciado && req.projetoUrgenciado.sigla === 'PLP' && req.projetoUrgenciado.numero === '226', 'urgência → PLP 226/2025 (da ementa)');
  const rec = its.find(i => i.chave === 'REC-20-2024');
  ok(rec && rec.projetoUrgenciado && rec.projetoUrgenciado.numero === '2168' && rec.projetoUrgenciado.ano === '2021', 'recurso → PL 2168/2021');
  const mpv = its.find(i => i.chave === 'MPV-1376-2026');
  ok(mpv && mpv.tipoCategoria === 'projeto' && /linhas de crédito/.test(mpv.ementa) && /Poder Executivo/.test(mpv.autorTexto), 'MPV com ementa e autor');
  ok(its.every(i => i.chave && i.sigla && i.numero && i.ano && 'pareceresComissao' in i), 'mesmo formato dos itens da API');

  console.log('\n== API e portal fora: erro dito como tal ==');
  portalFora = true;
  let e1 = null; try { await O.eventosDeliberativos('2026-11-10'); } catch (e) { e1 = e.message; }
  ok(/API da Câmara: HTTP 504; portal da Câmara: HTTP 503/.test(e1 || ''), `erro com as duas fontes (${e1})`);
  let e2 = null, r2 = null; try { r2 = await O.importarOrdemDoDiaDeHoje('2026-11-10', 't'); } catch (e) { e2 = e.message; }
  ok(e2 && !r2, 'o /ordemdodia recebe o erro — não "não há sessão hoje"');
  let e3 = null; try { await O.buscarOrdemDoDia(83243, '2026-11-10'); } catch (e) { e3 = e.message; }
  ok(/não consegui ler a pauta do evento 83243 — API da Câmara: HTTP 504; portal da Câmara: HTTP 503/.test(e3 || ''), `pauta: erro com as duas fontes (${e3})`);

  const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
  ok(/lidos da página da sessão no portal: a API da Câmara está fora/.test(idx), 'a mensagem de importação diz quando os itens vieram do portal');
  ok(/⚠️ Não consegui verificar a Ordem do Dia de hoje/.test(idx), 'o /pauta avisa quando não deu para verificar a Ordem do Dia');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
