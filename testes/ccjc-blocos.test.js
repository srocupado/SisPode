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

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
