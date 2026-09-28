// Filtros "Só não atendidas" e "Só atendidas" da aba Demandas de Deputados (lideres.html).
//
// O que este teste trava:
//  1. o filtro começa SEMPRE desligado — todas as demandas aparecem;
//  2. a contagem da lateral é "em aberto / total" por deputado, e não muda
//     com o filtro;
//  3. ligado, só aparecem as demandas em aberto; o deputado sem nenhuma em
//     aberto sai da lateral e da lista;
//  4. ligado, um aviso diz quantas atendidas estão ocultas, e "Mostrar todas"
//     desliga o filtro (e desmarca o checkbox);
//  5. tudo atendido + filtro ligado: a tela diz isso, não fica em branco;
//  6. "Só atendidas" é o espelho, e os dois checkboxes se excluem;
//  7. o relatório em PDF segue o filtro e diz no título que é recorte.
//
// Uso: node testes/lideres-filtro-demandas.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'lideres.html'), 'utf8');
const { document, window, Event } = parseHTML(html);
const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  URL, TextDecoder, AbortController, DOMException,
  console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  btoa: s => Buffer.from(s, 'latin1').toString('base64'),
  fetch: async () => ({ ok: true, status: 200, json: async () => null, text: async () => '' }),
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }, runtime: { getURL: p => p } },
  pdfjsLib: { GlobalWorkerOptions: {} }, XLSX: undefined,
  alert: () => {}, confirm: () => false, prompt: () => null,
  CSS: { escape: s => String(s).replace(/"/g, '\\"') },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'lideres.js'), 'utf8'), ctx, { filename: 'lideres.js' });
document.dispatchEvent(new Event('DOMContentLoaded'));
const av = e => vm.runInContext(e, ctx);

const dem = (id, dep, chave, atendida) => ({
  id, tratamento: dep.startsWith('Nely') ? 'Deputada' : 'Deputado', deputado: dep, chave,
  natureza: 'Pautar', autoria: dep, ementa: 'Ementa.', situacao: 'Aguardando Parecer',
  registradaEm: '2026-08-05T10:00:00Z',
  atendimento: atendida ? { rotulo: 'entrou na lista', em: '2026-09-01T10:00:00Z' } : null,
});
ctx.__dem = [
  dem('1', 'Gilson Daniel', 'PL 1/2025', false),
  dem('2', 'Gilson Daniel', 'PL 2/2025', true),
  dem('3', 'Nely Aquino', 'PL 3/2025', false),
  dem('4', 'Nely Aquino', 'PL 4/2025', false),
  dem('5', 'Rodrigo Gambale', 'PL 5/2025', true),   // só atendidas: some com o filtro ligado
];

const lado = () => [...document.querySelectorAll('#dem-lista-deputados .dem-side-dep')]
  .map(el => el.textContent.replace(/\s+/g, ' ').trim());
const cartoes = () => [...document.querySelectorAll('#dem-wrap .dem-card strong')].map(s => s.textContent);
const cb = () => document.getElementById('dem-so-abertas');

(async () => {
  av('app.demandas = __dem; renderizarDemandas()');

  console.log('== começa desligado ==');
  ok(!!cb() && !cb().checked, 'o checkbox "Só não atendidas" existe e começa desmarcado');
  ok(av('app.demFiltro') === 'todas', 'e o estado também começa desligado (todas)');
  ok(cartoes().length === 5, `todas as 5 demandas aparecem (${cartoes().length})`);
  ok(!document.querySelector('.dem-aviso-filtro'), 'sem aviso de filtro');

  console.log('\n== contagem "em aberto / total" por deputado ==');
  const l0 = lado();
  ok(l0.some(t => /Gilson Daniel 1 \/ 2/.test(t)) && l0.some(t => /Nely Aquino 2 \/ 2/.test(t)) && l0.some(t => /Rodrigo Gambale 0 \/ 1/.test(t)),
     `cada deputado mostra em aberto / total (${l0.join(' | ')})`);

  console.log('\n== filtro ligado ==');
  cb().checked = true;
  cb().dispatchEvent(new Event('change'));
  ok(av('app.demFiltro') === 'abertas', 'marcar o checkbox liga o filtro');
  ok(cartoes().join(',') === 'PL 1/2025,PL 3/2025,PL 4/2025', `só as 3 em aberto aparecem (${cartoes().join(', ')})`);
  const l1 = lado();
  ok(!l1.some(t => /Rodrigo Gambale/.test(t)), 'deputado sem demanda em aberto sai da lateral');
  ok(!document.querySelector('.dem-grupo[data-grupo*="Gambale"]'), 'e da lista');
  ok(l1.some(t => /Gilson Daniel 1 \/ 2/.test(t)), 'a contagem de quem fica não muda com o filtro (1 / 2)');
  const aviso = document.querySelector('.dem-aviso-filtro');
  ok(aviso && /2 demanda\(s\) atendida\(s\) estão ocultas/.test(aviso.textContent), 'o aviso diz quantas atendidas estão ocultas');

  console.log('\n== "Mostrar todas" desliga ==');
  document.querySelector('[data-mostrar-todas]').dispatchEvent(new Event('click'));
  ok(av('app.demFiltro') === 'todas' && !cb().checked, 'desliga o filtro e desmarca o checkbox');
  ok(cartoes().length === 5 && !document.querySelector('.dem-aviso-filtro'), 'e volta a mostrar as 5, sem aviso');

  console.log('\n== tudo atendido, filtro ligado ==');
  av(`app.demandas = __dem.map(d => ({ ...d, atendimento: { rotulo: 'ok', em: '2026-09-01' } })); definirFiltroDemandas('abertas')`);
  ok(cartoes().length === 0, 'nenhum cartão');
  ok(/Nenhuma demanda em aberto — todas as 5 registradas foram atendidas/.test(document.getElementById('dem-wrap').textContent),
     'a tela diz que tudo foi atendido, em vez de ficar em branco');
  ok(/Nenhuma demanda em aberto/.test(document.getElementById('dem-lista-deputados').textContent), 'e a lateral também');

  console.log('\n== "Só atendidas" ==');
  const cbAt = () => document.getElementById('dem-so-atendidas');
  av(`app.demandas = __dem; definirFiltroDemandas('abertas')`);
  cbAt().checked = true;
  cbAt().dispatchEvent(new Event('change'));
  ok(av('app.demFiltro') === 'atendidas' && !cb().checked, 'marcar "Só atendidas" desmarca "Só não atendidas" — os dois se excluem');
  ok(cartoes().join(',') === 'PL 2/2025,PL 5/2025', `só as 2 atendidas aparecem (${cartoes().join(', ')})`);
  ok(!lado().some(t => /Nely Aquino/.test(t)), 'quem não tem atendida (Nely) sai da lateral');
  ok(/3 demanda\(s\) em aberto estão ocultas/.test(document.querySelector('.dem-aviso-filtro').textContent), 'o aviso diz quantas em aberto estão ocultas');
  cbAt().checked = false;
  cbAt().dispatchEvent(new Event('change'));
  ok(av('app.demFiltro') === 'todas' && cartoes().length === 5, 'desmarcar volta a mostrar todas');

  console.log('\n== o relatório segue o filtro ==');
  const rel = (filtro) => av(`_htmlRelatorioDemandas(filtrarDemandas(__dem, '${filtro}'), null, [], '${filtro}')`);
  const hAt = rel('atendidas');
  ok(/Somente demandas atendidas/i.test(hAt) && /PL 2\/2025/.test(hAt) && !/PL 1\/2025/.test(hAt),
     'filtro "Só atendidas": o PDF traz só as atendidas e diz no título que é recorte');
  ok(/as em aberto não entram neste relatório/.test(hAt), 'e a linha de totais avisa o que ficou de fora');
  const hAb = rel('abertas');
  ok(/Somente demandas em aberto/i.test(hAb) && /PL 3\/2025/.test(hAb) && !/PL 5\/2025/.test(hAb), 'filtro "Só não atendidas": só as em aberto');
  const hTodas = rel('todas');
  ok(!/Somente/.test(hTodas) && /PL 1\/2025/.test(hTodas) && /PL 5\/2025/.test(hTodas), 'sem filtro: relatório completo, sem aviso de recorte');
  av(`definirFiltroDemandas('atendidas'); abrirModalRelatorio()`);
  const itens = [...document.querySelectorAll('#rel-deputados input')].map(i => i.dataset.grupo);
  ok(itens.length === 2 && !itens.some(g => /Nely/.test(g)), `o modal só oferece deputados com demanda no recorte (${itens.join(', ')})`);
  ok(/só as demandas atendidas/.test(document.getElementById('rel-recorte').textContent), 'e avisa que o relatório segue o filtro');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
