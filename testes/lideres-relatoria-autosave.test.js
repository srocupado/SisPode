// Reunião de Líderes · relatoria (designado × pedido) e salvamento automático.
//
// 10/11/2026, dois pedidos:
//  1. A coluna "Relator" da lista mistura dois fatos diferentes — "DESIGNAÇÃO:
//     Aliel Machado (PV-PR), em 07/10/2025" (relator já designado) e "PEDIDO:
//     Julia Zanatta solicitou relatoria" / "PEDIDO: PCdoB indicou Lídice da
//     Mata" (alguém pediu; ninguém foi designado). A coluna Relatoria de
//     Plenário mostra os dois, rotulados. Nas MPV a célula traz a comissão
//     mista ("Presidente: … Relator: …"), que não é relatoria de Plenário.
//  2. Ao terminar um lote de resumos (Resumir Todas / selecionadas), a reunião
//     é salva sozinha — antes, o que não fosse salvo à mão se perdia.
// As células abaixo são as da lista de 10/11/2026.
// Uso: node testes/lideres-relatoria-autosave.test.js
const fs = require('fs'), path = require('path');
let fonte = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// O lote chama resumirProposicao (rede + IA); aqui ela é trocada por um resumo de mentira.
const CHAMADA = 'await resumirProposicao(it, app.abortar.signal);';
if (!fonte.includes(CHAMADA)) throw new Error('resumirLote mudou: ajuste o teste');
fonte = fonte.replace(CHAMADA, 'await __resumir(it);');

const toasts = [], gravacoes = [];
let fbFalha = null, wsDeputados = '';
const el = () => ({ style: {}, disabled: false, textContent: '', innerHTML: '', value: '', addEventListener() {}, querySelectorAll: () => [], classList: { toggle() {}, add() {}, remove() {} } });
const sandbox = {
  document: { addEventListener() {}, getElementById: () => el(), querySelectorAll: () => [], querySelector: () => null },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {} }, window: {}, console, setTimeout, clearTimeout, DOMException: globalThis.DOMException, XLSX: undefined, AbortSignal, AbortController,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  fetch: async (url, init = {}) => {
    if (/dadosabertos/.test(url)) return { ok: false, status: 504, json: async () => ({}) };
    if (/ObterDeputados/.test(url)) return { ok: true, status: 200, text: async () => wsDeputados };
    if (/firebaseio/.test(url) && init.method === 'PUT') { if (fbFalha) return { ok: false, status: 503, json: async () => ({}) }; gravacoes.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => null };
  },
  toasts,
  __resumir: async it => { if (it.chave === 'ERRO') throw new Error('IA fora'); it.objetivo = 'resumido'; it.status = 'ok'; },
};
const L = new Function(...Object.keys(sandbox),
  `${fonte}\n; mostrarToast = (m, t) => __toasts.push([m, t]); renderizarTabela = () => {}; atualizarLinha = () => {}; atualizarSidebar = () => {}; atualizarProgresso = () => {}; atualizarBotaoSelecionadas = () => {};
   return { solicitacoesDaLista, solicitacaoPodemos, rotuloPautaPodemos, _htmlImpressaoLideres, camposNovosFaltando, SITUACAO_MPV, situacaoDaMpv, relatoriaDaLista, comporRelatoria, resumirLote, salvarReuniao, app, papeisDeputadosComissaoMista, comissaoMistaPodemos, itemDoPodemosLideres, rotuloComissaoMista };`.replace('__toasts', 'toasts'))
  .call(null, ...Object.values(sandbox));
// mostrarToast etc. são declarações de função: reatribuí-las acima só funciona se forem `function` (são). O toast vai para `toasts`.

(async () => {
  console.log('== coluna Relator da lista: designado × pedido ==');
  const R = c => L.relatoriaDaLista(c);
  ok(JSON.stringify(R('DESIGNAÇÃO: Aliel Machado (PV-PR), em 07/10/2025')) === '{"designacao":"Aliel Machado (PV-PR), em 07/10/2025","pedidos":[],"outros":[]}', 'designação');
  ok(R('DESIGNAÇÃO: Silvia Cristina (PL- RO), em 15/08/2023').designacao === 'Silvia Cristina (PL-RO), em 15/08/2023', 'partido quebrado no PDF ("PL- RO") é recomposto');
  ok(JSON.stringify(R('PEDIDO: Julia Zanatta solicitou relatoria').pedidos) === '["Julia Zanatta solicitou relatoria"]' && JSON.stringify(R('PEDIDO: Governo na CD indicou Helder Salomão, Afonso Florence').pedidos) === '["Governo na CD indicou Helder Salomão, Afonso Florence"]', 'pedidos (deputado que solicitou; bancada que indicou)');
  const ambos = R('DESIGNAÇÃO: Fulano (PT-SP), em 01/10/2026 PEDIDO: Podemos indicou Beltrana');
  ok(ambos.designacao === 'Fulano (PT-SP), em 01/10/2026' && JSON.stringify(ambos.pedidos) === '["Podemos indicou Beltrana"]', 'os dois na mesma célula');

  console.log('\n== a coluna Relatoria de Plenário ==');
  const it1 = { extrasPdf: { relator: 'PEDIDO: Julia Zanatta solicitou relatoria' } };
  ok(L.comporRelatoria(it1, 'Sem indicação') === 'Sem relator designado\nPedido de relatoria: Julia Zanatta solicitou relatoria' && !it1.relatorPodemos, 'pedido sem designação: "Sem relator designado" + o pedido');
  const it2 = { extrasPdf: { relator: 'DESIGNAÇÃO: Aliel Machado (PV-PR), em 07/10/2025' } };
  ok(L.comporRelatoria(it2, 'Dep. Aliel Machado (PV-PR)') === 'Designado: Dep. Aliel Machado (PV-PR)' && it2.relatorDesignado === 'Dep. Aliel Machado (PV-PR)', 'designado: vale o da Câmara');
  const it3 = { extrasPdf: { relator: 'DESIGNAÇÃO: Benes Leocádio (UNIÃO-RN), em 10/11/2026' } };
  ok(L.comporRelatoria(it3, 'Sem indicação') === 'Designado: Dep. Benes Leocádio (UNIÃO-RN), em 10/11/2026 (segundo a lista da reunião)', 'Câmara ainda sem a designação: vale a da lista, dita como da lista');
  const it4 = { extrasPdf: { relator: 'DESIGNAÇÃO: Duda Ramos (PODE-RR), em 10/11/2026 PEDIDO: PL indicou Fulano' } };
  ok(L.comporRelatoria(it4, '') === 'Designado: Dep. Duda Ramos (PODE-RR), em 10/11/2026 (segundo a lista da reunião)\nPedido de relatoria: PL indicou Fulano' && it4.relatorPodemos, 'relatoria do Podemos pela designação (consulta à Câmara falhou)');
  const it5 = { extrasPdf: { relator: 'PEDIDO: Podemos indicou Duda Ramos (PODE-RR)' } };
  L.comporRelatoria(it5, 'Sem indicação');
  ok(!it5.relatorPodemos, 'PEDIDO do Podemos não vira "Relatoria Podemos" (ninguém foi designado)');
  const it6 = { extrasPdf: { relator: 'Presidente: Dep. Nely Aquino Relator: Sen. Leany Lemos' } };
  ok(L.comporRelatoria(it6, 'Sem indicação') === 'Sem relator designado\nComissão mista — Presidente: Dep. Nely Aquino · Relator: Sen. Leany Lemos' && !it6.relatorPodemos, 'MPV: comissão mista rotulada à parte, sem virar designado');
  ok(L.comporRelatoria({ extrasPdf: {} }, '') === 'Designação não apurada (consulta à Câmara falhou)', 'sem lista e sem consulta: "não apurada", nunca "sem relator"');
  ok(L.comporRelatoria({ sigla: 'MPV', extrasPdf: { relator: 'Presidente: Sen. Renan Calheiros Relator: Dep. Paulo Pimenta' } }, '') === 'Relatoria na comissão mista\nComissão mista — Presidente: Sen. Renan Calheiros · Relator: Dep. Paulo Pimenta', 'MPV: "Relatoria na comissão mista" (nada de "não apurada")');

  console.log('\n== comissão mista de MPV com deputado do Podemos: selo ==');
  ok(JSON.stringify(L.papeisDeputadosComissaoMista(['Comissão mista — Presidente: Dep. Nely Aquino · Relator: Sen. Leany Lemos'])) === '[{"papel":"Presidência","nome":"Nely Aquino"}]', 'só deputados (o senador fica de fora)');
  ok(JSON.stringify(L.papeisDeputadosComissaoMista(['Comissão mista — Presidente: Sen. Renan Calheiros · Relator: Dep. Paulo Pimenta'])) === '[{"papel":"Relatoria","nome":"Paulo Pimenta"}]', 'relatoria de deputado');
  wsDeputados = '<deputados><deputado><nomeParlamentar>Nely Aquino</nomeParlamentar><partido>PODE</partido></deputado><deputado><nomeParlamentar>Paulo Pimenta</nomeParlamentar><partido>PT</partido></deputado></deputados>';
  const mpv = { extrasPdf: { relator: 'Presidente: Dep. Nely Aquino Relator: Sen. Leany Lemos' } };
  mpv.comissaoMistaPodemos = await L.comissaoMistaPodemos(mpv);
  ok(JSON.stringify(mpv.comissaoMistaPodemos) === '[{"papel":"Presidência","nome":"Nely Aquino"}]' && L.itemDoPodemosLideres(mpv), 'Nely Aquino (PODE, pela bancada do webservice com a API fora): selo e item do Podemos');
  ok(L.rotuloComissaoMista(mpv.comissaoMistaPodemos[0]) === 'Presidência da comissão mista: Nely Aquino (Podemos)', 'texto do selo');
  const mpv2 = { extrasPdf: { relator: 'Presidente: Sen. Renan Calheiros Relator: Dep. Paulo Pimenta' } };
  ok(JSON.stringify(await L.comissaoMistaPodemos(mpv2)) === '[]', 'relator do PT: sem selo');
  ok(/comissaoMistaPodemos \|\| \[\]\)\.map\(p => `<span class="lid-badge-rel"/.test(fonte) && /for \(const p of \(it\.comissaoMistaPodemos \|\| \[\]\)\) linhas\.push\(rotuloComissaoMista\(p\)\)/.test(fonte), 'selo na tabela e linha na mensagem do Podemos');

  console.log('\n== Solicitações de Pauta: pedido do Podemos vira selo azul ==');
  ok(JSON.stringify(L.solicitacoesDaLista('PL 68/2025: Bancada Feminina; PT')) === '[{"prop":"PL 68/2025","quem":"Bancada Feminina"},{"prop":"","quem":"PT"}]', 'coluna lida: entradas e a proposição a que a entrada se prende');
  const p1 = { extrasPdf: { solicitacoes: 'PODEMOS' } };
  p1.solicitacaoPodemos = await L.solicitacaoPodemos(p1);
  ok(L.rotuloPautaPodemos(p1.solicitacaoPodemos) === 'Pauta pedida pelo Podemos' && L.itemDoPodemosLideres(p1), '"PODEMOS" (itens 29 e 30 da lista de 10/11): selo e item do Podemos');
  wsDeputados = '<deputados><deputado><nomeParlamentar>Nely Aquino</nomeParlamentar><partido>PODE</partido></deputado><deputado><nomeParlamentar>Júlia Zanatta</nomeParlamentar><partido>PL</partido></deputado></deputados>';
  const p2 = { extrasPdf: { solicitacoes: 'Julia Zanatta; PL 1446/2025: Nely Aquino; MDB' } };
  p2.solicitacaoPodemos = await L.solicitacaoPodemos(p2);
  ok(L.rotuloPautaPodemos(p2.solicitacaoPodemos) === 'Pauta pedida pelo Podemos: Dep. Nely Aquino (PL 1446/2025)', `deputado da bancada (pelo nome, sem acento): ${L.rotuloPautaPodemos(p2.solicitacaoPodemos)}`);
  const p3 = { extrasPdf: { solicitacoes: 'Governo na CD; PDT; Julia Zanatta' } };
  ok(JSON.stringify(await L.solicitacaoPodemos(p3)) === '[]', 'pedido de outros (Julia Zanatta é do PL): sem selo');
  const html = L._htmlImpressaoLideres({ titulo: 'RL', itens: [{ numItem: '29', chave: 'PL 888/2025', solicitacaoPodemos: p1.solicitacaoPodemos, autoriaPodemos: true, autoresPodemos: ['X'] }] }, '');
  ok(/<b>PL 888\/2025<\/b><span class="selo-pauta">Pauta pedida pelo Podemos<\/span><span class="selo-pode">/.test(html) && /class="pode"/.test(html), 'PDF: selo logo abaixo do nome, antes dos outros, com a tarja do Podemos');
  ok(/\.selo-pauta \{ color:#fff; background:#1d4ed8/.test(fonte) && /lid-badge-pauta/.test(fonte), 'azul na tela e no PDF');

  console.log('\n== MPV: urgência constitucional, não requerimento ==');
  const m = { sigla: 'MPV', situacao: 'Não apurada — a API de Dados Abertos da Câmara está fora do ar; refaça a busca quando ela voltar, antes de usar.', situacaoFalhou: true };
  L.situacaoDaMpv(m);
  ok(m.situacao === 'Urgência constitucional (art. 62 da CF) — medida provisória' && !m.situacaoFalhou, `MPV: ${m.situacao}`);
  const pl = { sigla: 'PL', situacao: 'Urgência aprovada (REQ. 1/2026)' };
  L.situacaoDaMpv(pl);
  ok(pl.situacao === 'Urgência aprovada (REQ. 1/2026)', 'PL não é tocado');
  ok((fonte.match(/situacaoDaMpv\(it\);\n  it\.relatoria = comporRelatoria/g) || []).length === 2, 'vale nos dois caminhos (API e portal)');
  const salva = { sigla: 'MPV', autoriaPodemos: false, apensadosPodemos: [], papel: {}, situacao: 'Não apurada — a API…' };
  ok(L.camposNovosFaltando(salva) && !L.camposNovosFaltando({ ...salva, situacao: L.SITUACAO_MPV }), 'reunião salva com MPV "Não apurada" é recarregada ao abrir; corrigida, não');

  console.log('\n== salvamento automático ao fim do lote ==');
  L.app.config.apiKey = 'x';
  L.app.reuniao = { id: 'lid-1', titulo: 'RL 10/11', criada: '2026-11-10', itens: [{ chave: 'PL 1/2026' }, { chave: 'PL 2/2026' }] };
  await L.resumirLote(null);
  ok(gravacoes.length === 1 && gravacoes[0].itens.every(i => i.objetivo === 'resumido'), 'Resumir Todas: grava a reunião com os resumos no Firebase');
  ok(/2 proposições resumidas\. Salvo automaticamente\./.test(toasts.at(-1)[0]), `o aviso diz que salvou: "${toasts.at(-1)[0]}"`);
  L.app.reuniao.itens.push({ chave: 'ERRO' });
  await L.resumirLote(['ERRO', 'PL 1/2026']);
  ok(gravacoes.length === 2 && /1 resumidas, 1 com erro\. Salvo automaticamente\./.test(toasts.at(-1)[0]), 'resumir selecionadas, com erro: salva também');
  fbFalha = true;
  await L.resumirLote(['PL 2/2026']);
  ok(/Salvo só neste navegador \(Firebase: Firebase HTTP 503\) — clique em Salvar depois\./.test(toasts.at(-1)[0]) && toasts.at(-1)[1] === 'aviso', 'Firebase fora: avisa que ficou só no navegador');
  ok(/const salvo = await salvarReuniao\(\{ auto: true \}\)[\s\S]{0,200}Dados carregados/.test(fonte), 'a importação do PDF também salva ao terminar de carregar os dados');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
