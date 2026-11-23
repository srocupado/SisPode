// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Pautas CCJC · blocos e números dos itens (ccjc-blocos.js): a pauta oficial da reunião
// (link "Pauta" da página do evento) lida sem IA, a visão geral do resumo executivo e da
// pauta comentada.
// Fixtures: o texto das pautas oficiais de 03/11/2026 (122 itens) e 04/11/2026 (82 itens),
// como a extensão o extrai (uma linha por elemento do HTML).
// Uso: node testes/ccjc-blocos.test.js
const fs = require('fs'), path = require('path');
global.escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const B = require(path.join(__dirname, '..', 'ccjc-blocos.js'));
Object.assign(global, B);
const G = require(path.join(__dirname, '..', 'ccjc-governo.js'));
Object.assign(global, { govPosicao: G.govPosicao, govBadge: G.govBadge, GOV_CSS: G.GOV_CSS });
const R = require(path.join(__dirname, '..', 'ccjc-resumo.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const ler = n => fs.readFileSync(path.join(__dirname, 'pautas', n), 'utf8');

console.log('== pauta oficial de 03/11/2026 ==');
const a = B.pautaBlocosDoTexto(ler('ccjc-pauta-2026-11-03.txt'));
ok(JSON.stringify(a.blocos) === JSON.stringify([{ letra: 'A', nome: 'Proposições Sujeitas à Apreciação do Plenário' }, { letra: 'B', nome: 'Proposições Sujeitas à Apreciação Conclusiva pelas Comissões' }]), 'dois blocos, com letra e nome');
ok(a.itens.length === 122 && a.itens.every((it, i) => it.n === i + 1), `os 122 itens, numerados de 1 a 122 (lidos: ${a.itens.length})`);
const conta = {};
for (const it of a.itens) conta[`${it.letra}|${it.regime}|${it.sigla}`] = (conta[`${it.letra}|${it.regime}|${it.sigla}`] || 0) + 1;
ok(JSON.stringify(conta) === JSON.stringify({ 'A|PRIORIDADE|PRC': 1, 'A|TRAMITAÇÃO ORDINÁRIA|PL': 3, 'B|PRAZO CONSTITUCIONAL|PDL': 115, 'B|TRAMITAÇÃO ORDINÁRIA|PL': 3 }),
  'regimes dentro dos blocos: 115 PDLs com prazo constitucional no bloco B');
ok(a.itens.find(it => it.chave === 'PDL 415/2026')?.n === 47, 'PDL 415/2026 (relatoria do Podemos) é o item 47 — o mesmo do documento do governo');

console.log('\n== pauta oficial de 04/11/2026 ==');
const b = B.pautaBlocosDoTexto(ler('ccjc-pauta-2026-11-04.txt'));
ok(b.blocos.map(x => `${x.letra} – ${x.nome}`).join(' | ') === 'A – Redações Finais | B – Proposições Sujeitas à Apreciação Conclusiva pelas Comissões', 'Redações Finais e conclusivas');
ok(b.itens.length === 82 && b.itens.filter(it => it.letra === 'A').length === 70, `82 itens, 70 no bloco de Redações Finais (lidos: ${b.itens.length})`);
ok(b.itens.find(it => it.n === 35)?.chave === 'PDL 85/2024', 'número da proposição que quebra de linha ("Nº" / "85/2024")');
ok(b.itens.find(it => it.n === 5)?.chave === 'PL 8332/2015', 'número com ponto de milhar (8.332) vira 8332');

console.log('\n== faixas de itens ==');
ok(B.faixasItens([20, 21, 22, 23]) === 'itens 20 a 23' && B.faixasItens([1, 3, 5, 6, 7]) === 'itens 1, 3 e 5 a 7' && B.faixasItens([15]) === 'item 15', 'faixas e listas');
ok(B.faixasItens([1, 2]) === 'itens 1 e 2' && B.faixasItens([3, 4, 120, 121, 122]) === 'itens 3, 4 e 120 a 122', 'dois seguidos não viram faixa');

console.log('\n== visão geral (a pauta da imagem: 61 itens, 3 blocos) ==');
const proj = (n, extra) => Object.assign({ item: n, chave: `PL ${1000 + n}/2025`, sigla: 'PL', numero: 1000 + n, ano: 2025, ementa: 'x', relator: 'Rel ' + n, statusAnalise: 'pendente' }, extra);
const projs = [];
for (let n = 1; n <= 19; n++) projs.push(proj(n, { bloco: 'A' }));
for (let n = 20; n <= 23; n++) projs.push(proj(n, { bloco: 'B', resumoOriginal: 'r', statusAnalise: 'concluido' }));
for (let n = 24; n <= 47; n++) projs.push(proj(n, { bloco: 'C', chave: `PDL ${n}/2026`, sigla: 'PDL', regimeBloco: 'PRAZO CONSTITUCIONAL', ementa: 'Aprova o ato que renova a concessão para executar serviço de radiodifusão sonora.' }));
for (let n = 48; n <= 61; n++) projs.push(proj(n, { bloco: 'C', resumoOriginal: 'r', statusAnalise: 'concluido' }));
Object.assign(projs[14], { chave: 'PL 5981/2025', numero: 5981, relatoria: 'pode', relator: 'Felipe Francischini' });
const pauta = { titulo: 'CCJC – 10/11/2026', blocos: [{ letra: 'A', nome: 'Redações Finais' }, { letra: 'B', nome: 'Proposições sujeitas à apreciação do Plenário' }, { letra: 'C', nome: 'Proposições sujeitas à apreciação conclusiva pelas Comissões' }], blocosFonte: 'oficial', projetos: projs };
const dados = projs.filter(R.resumoComAnalise).map(p => ({ chave: p.chave, tema: 'T', parecerCurto: 'Aprovação', debate: 'Baixo', oQueFaz: 'f', oQueFazItens: [], parecer: 'p', pontosAtencao: 'a' }));
const g = R.resumoTextosGerais(pauta, dados);
const txt = g.abertura.map(t => t.replace(/<[^>]+>/g, ''));
ok(txt[0] === 'A pauta tem 61 itens, organizados em três blocos: A – Redações Finais (itens 1 a 19), B – Proposições sujeitas à apreciação do Plenário (itens 20 a 23) e C – Proposições sujeitas à apreciação conclusiva pelas Comissões (itens 24 a 61).', '1º parágrafo: os blocos e as faixas → ' + txt[0]);
ok(txt[1] === 'Os 18 itens comentados estão nos blocos B (itens 20 a 23) e C (itens 48 a 61). Os 43 itens sem análise pertencem todos a um de dois blocos de rotina: as 19 redações finais (itens 1 a 19) e os 24 PDLs de radiodifusão com prazo constitucional (itens 24 a 47). A relação completa está na seção “Itens sem análise”, ao final deste resumo.', '2º parágrafo: comentados e sem análise → ' + txt[1]);
ok(txt[2] === 'Há um item sob relatoria do Podemos: item 15 – PL 5981/2025 (dep. Felipe Francischini), no bloco de Redação Final.', '3º parágrafo: o item do Podemos com número e bloco → ' + txt[2]);
ok(txt[3] === 'Em todos os 18 itens comentados, o parecer do relator na CCJC é favorável. Os pontos de atenção são possíveis focos de debate, não argumentos registrados no parecer.', '4º parágrafo: o parecer');

console.log('\n== pauta mista (03/11/2026): sem análise que não são de rotina ==');
const mista = { blocos: a.blocos, projetos: a.itens.map(it => ({ item: it.n, chave: it.chave, sigla: it.sigla, bloco: it.letra, regimeBloco: it.regime,
  ementa: it.sigla === 'PDL' ? 'serviço de radiodifusão comunitária' : 'x', resumoOriginal: it.n <= 2 ? 'r' : '', statusAnalise: it.n <= 2 ? 'concluido' : 'pendente' })) };
const vm2 = B.pautaVisaoGeral(mista, { comAnalise: R.resumoComAnalise, rotina: R.resumoEhRotina });
ok(vm2.p2.replace(/<[^>]+>/g, '') === 'Os 2 itens comentados estão no bloco A (itens 1 e 2). Dos 120 itens sem análise, 115 são PDLs de radiodifusão com prazo constitucional (itens 5 a 119) e 5 são outros itens (itens 3, 4 e 120 a 122).', '→ ' + vm2.p2.replace(/<[^>]+>/g, ''));

console.log('\n== o resumo executivo ==');
const h = R.resumoHTML(pauta, { itens: dados }, null);
ok(/<h2 class="sec" style="margin-top:0">Itens sem análise<\/h2>/.test(h) && (h.match(/<tr[^>]*><td class="c">\d+<\/td>/g) || []).length === 43, 'seção "Itens sem análise" com os 43 itens');
ok(/<td class="c">15<\/td><td class="ch">PL 5981\/2025<br><span class="pode">Podemos<\/span><\/td><td class="c">A<\/td>/.test(h) && /Blocos: A – Redações Finais; B – /.test(h), 'na lista: número, proposição, marca do Podemos e a letra do bloco (os nomes na nota)');
ok(/<h2>Item 48 – PL 1048\/2025/.test(h) && /<span class="ni">Item 20<\/span><br>PL 1020\/2025/.test(h), 'itens comentados com o número oficial (bloco e tabela)');

console.log('\n== sem blocos: como antes ==');
const semB = R.resumoTextosGerais({ titulo: 'x', projetos: projs.map(p => Object.assign({}, p, { item: undefined, bloco: undefined })) }, dados);
ok(!semB.comBlocos && /^A pauta tem 61 itens, dos quais 18 foram comentados\./.test(semB.abertura[0]), 'pauta sem blocos mantém a visão geral antiga');
ok(!/Itens sem análise<\/h2>/.test(R.resumoHTML({ titulo: 'x', projetos: projs.map(p => Object.assign({}, p, { item: undefined, bloco: undefined })) }, { itens: dados }, null)), 'e não ganha a seção remissiva');

console.log('\n== aplicar à pauta (casamento pela sigla/número/ano) ==');
const pz = { projetos: [{ sigla: 'PDL', numero: 415, ano: 2026, chave: 'PDL 415/2026' }, { sigla: 'PL', numero: 9, ano: 1999, chave: 'PL 9/1999' }] };
ok(B.pautaBlocosAplicar(pz, a, 'oficial') === 1 && pz.projetos[0].item === 47 && pz.projetos[0].bloco === 'B' && pz.projetos[0].regimeBloco === 'PRAZO CONSTITUCIONAL' && pz.projetos[1].item === undefined && pz.blocos.length === 2,
  'quem casa ganha número, bloco e regime; quem não casa fica como estava');
const papi = { projetos: [{ topico: 'Redações Finais', item: 1 }, { topico: 'Tramitação Ordinária', item: 2 }] };
ok(B.pautaBlocosDaApi(papi) && papi.blocos.map(x => x.nome).join() === 'Redações Finais,Tramitação Ordinária' && papi.blocosFonte === 'api', 'sem a pauta oficial: blocos pelos tópicos da API');


// PDF da pauta (botão "Via PDF"), 24/11/2026: o texto extraído pelo pdf.js da extensão (com textoComLinhas) dá
// os 77 itens. Antes, a página inteira saía numa linha e o módulo achava 18 "projetos" — os apensados citados
// nas ementas, escritos com sigla.
console.log('\n== PDF da pauta: itens pela pauta oficial ==');
const t24 = ler('ccjc-pdf-24-11-2026.txt');
const r24 = B.pautaRefsDoTexto(t24);
const porSigla = r24.reduce((m, x) => (m[x.sigla] = (m[x.sigla] || 0) + 1, m), {});
ok(r24.lido.itens.length === 77 && r24.length === 76 && porSigla.PL === 41 && porSigla.PDL === 34 && porSigla.PRC === 1, `os 77 itens: 76 projetos (41 PL, 34 PDL, 1 PRC) — ${r24.length}`);
ok(r24.requerimentos.map(q => q.chave).join() === 'REQ 29/2026' && !r24.some(x => x.sigla === 'REQ'), 'o requerimento da comissão (item 1) fica fora da análise e é informado');
ok(r24.filter(x => x.redacaoFinal).map(x => x.item).join() === '2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18', 'os itens 2 a 18 (bloco B) são Redação Final; os demais, não');
ok(r24.find(x => x.chave === 'PDL 1050/2025').item === 40 && r24.find(x => x.chave === 'PDL 1050/2025').bloco === 'D' && r24.find(x => x.chave === 'PL 4493/2020').item === 4, 'número com ponto de milhar (1.050, 4.493) e o item e o bloco de cada projeto');
ok(!r24.some(x => ['PL 2539/2020', 'PL 51/2021', 'PL 4783/2023', 'PL 415/2023'].includes(x.chave)), 'apensado citado na ementa ("Apensados: PL 2539/2020…") não vira item');
// textoComLinhas: a linha muda no fim de linha marcado pelo pdf.js ou quando a altura muda
const itensPdf = [{ str: '12 - PROJETO DE LEI Nº', transform: [1, 0, 0, 1, 50, 700] }, { str: '4.493/2020 - do Sr. X', transform: [1, 0, 0, 1, 200, 700], hasEOL: true },
  { str: 'que "altera a lei".', transform: [1, 0, 0, 1, 60, 688] }, { str: 'RELATOR: Deputado Y.', transform: [1, 0, 0, 1, 60, 676] }];
ok(B.textoComLinhas(itensPdf) === '12 - PROJETO DE LEI Nº 4.493/2020 - do Sr. X\nque "altera a lei". \nRELATOR: Deputado Y. '.replace(/ \n/g, '\n'), 'textoComLinhas: uma linha por linha da página');


// Plano B (23/11/2026): a API de Dados Abertos devolvia 504 em tudo; o calendário e a pauta vêm do site.
console.log('\n== API fora do ar: calendário e pauta pelo site da Câmara ==');
(async () => {
  const lista = fs.readFileSync(path.join(__dirname, 'pautas', 'ccjc-sessoesereunioes-2026-11.html'), 'utf8');
  const ag = B.agendaCcjcDoHtml(lista);
  ok(ag.total === 7 && ag.eventos.length === 7 && ag.eventos[5].id === 83357 && ag.eventos[5].data === '2026-11-24' && ag.eventos[5].hora === '14:30' && ag.eventos[5].situacao === 'convocada' && ag.eventos[5].tipo === 'Reunião Deliberativa' && /Anexo II/.test(ag.eventos[5].local), 'lista "Sessões e reuniões": os 7 eventos de novembro, com id, data, hora, tipo, situação e local');
  ok(B.linkPautaDoEvento(fs.readFileSync(path.join(__dirname, 'pautas', 'ccjc-evento-83357-trecho.html'), 'utf8')) === 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3198580', 'página do evento: o link da pauta oficial');
  // paginação: 20 por página; a segunda página é pedida enquanto faltar evento
  const li = (id, d, tipo) => `<li class="g-agenda__evento"><span class="g-agenda__data">${d}</span><span class="g-agenda__hora">9h</span><a href="https://www.camara.leg.br/evento-legislativo/${id}" class="g-agenda__nome">X</a><span class="g-agenda__tipo">${tipo}</span><span class="g-agenda__situacao">encerrada</span><span class="g-agenda__local">L</span></li>`;
  const pedidos = [];
  const falso = async u => { pedidos.push(u); const p2 = /pagina=2/.test(u); return { ok: true, text: async () => `Exibindo ${p2 ? '21 a 21' : '1 a 20'} de 21 encontrados` + (p2 ? li(999, '30/11/2026', 'Reunião Deliberativa') : Array.from({ length: 20 }, (_, i) => li(i + 1, '03/11/2026', i % 2 ? 'Audiência Pública' : 'Reunião Deliberativa')).join('')) }; };
  const mes = await B.buscarEventosMesSite(2026, 10, falso);
  ok(pedidos.length === 2 && /dataInicial=01%2F11%2F2026&dataFinal=30%2F11%2F2026/.test(pedidos[0]) && mes['2026-11-03'].length === 10 && mes['2026-11-30'][0].id === 999 && mes['2026-11-03'][0].dataHoraInicio === '2026-11-03T09:00', 'mês pelo site: todas as páginas, só reunião deliberativa, no formato do calendário');
  // a pauta oficial lida do site dá o mesmo que o PDF
  const rOf = B.pautaRefsDoTexto(ler('ccjc-pauta-oficial-24-11-2026.txt'));
  ok(rOf.lido.itens.length === 77 && rOf.length === 76 && rOf.map(x => x.chave).join() === B.pautaRefsDoTexto(ler('ccjc-pdf-24-11-2026.txt')).map(x => x.chave).join(), 'pauta oficial pelo site: os mesmos 77 itens e 76 projetos do PDF, na mesma ordem');
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();

