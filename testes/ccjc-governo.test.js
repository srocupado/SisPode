// Pautas CCJC · posição do governo (ccjc-governo.js): o sumário do PDF
// "Liderança Digital" da Liderança do Governo na CD, lido sem IA.
// Fixture: o texto do sumário da pauta de 03/11/2026, como a extensão o extrai
// (extrairTextoPDF: os trechos de cada página na ordem do PDF).
// Uso: node testes/ccjc-governo.test.js
const fs = require('fs'), path = require('path');
global.escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const G = require(path.join(__dirname, '..', 'ccjc-governo.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const r = G.lerPosicoesGoverno(fs.readFileSync(path.join(__dirname, 'pautas', 'ccjc-governo-2026-11-03.txt'), 'utf8'));
const itens = Object.entries(r.itens);
console.log('== sumário de 03/11/2026 ==');
ok(r.governo && /Constitui[çc][ãa]o e Justi[çc]a/.test(r.comissao) && r.reuniao === '03/11/2026', `cabeçalho: Liderança do Governo, ${r.comissao}, reunião de ${r.reuniao}`);
ok(itens.length === 122 && JSON.stringify(itens.map(([, v]) => v.item).sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: 122 }, (_, i) => i + 1)), `os 122 itens, de 1 a 122 (lidos: ${itens.length})`);
const conta = {};
for (const [, v] of itens) conta[v.posicao] = (conta[v.posicao] || 0) + 1;
ok(JSON.stringify(conta) === JSON.stringify({ 'Não afeta ao governo': 1, 'Em Análise': 2, 'Favorável com ajustes': 1, 'Não': 1, 'Voto Livre': 115, Sim: 2 }), 'posições: 115 Voto Livre, 2 Sim, 2 Em Análise, 1 Não, 1 Favorável com ajustes, 1 Não afeta ao governo');
ok(r.itens['PL 1834/2023']?.posicao === 'Em Análise', 'tema com parênteses dentro ("(Lei das Drogas)") não derruba o item 2');
ok(r.itens['PL 182/2025']?.marcas === 'AA' && r.itens['PDL 626/2026']?.marcas === 'R,AA' && r.itens['PL 182/2025'].posicao === 'Favorável com ajustes', 'marcas da legenda (AA, R,AA) não entram na posição');
ok(r.itens['PDL 415/2026']?.posicao === 'Voto Livre' && r.itens['PDL 415/2026'].item === 47, 'PDL 415/2026 (relatoria do Podemos): item 47, Voto Livre');
ok(r.itens['PL 2918/2025']?.posicao === 'Sim' && r.itens['PL 2918/2025'].item === 122, 'último item, no fim da página');

console.log('\n== casamento com a pauta e cores ==');
const pauta = { governo: { itens: r.itens } };
ok(G.govPosicao(pauta, { sigla: 'PL', numero: 2500, ano: 2025 })?.posicao === 'Não' && G.govPosicao(pauta, { chave: 'PL 2500/2025' })?.posicao === 'Não', 'pela sigla/número/ano ou pela chave da pauta');
ok(G.govPosicao(pauta, { sigla: 'PL', numero: 9, ano: 2026 }) === null && G.govPosicao({}, { chave: 'PL 2500/2025' }) === null, 'sem posição → null');
ok(['Sim', 'Favorável com ajustes', 'Não', 'Em Análise', 'Não afeta ao governo', 'Voto Livre', 'Contrário', 'Liberado', 'Obstrução'].map(G.govClasse).join() === 'gv-sim,gv-fav,gv-nao,gv-analise,gv-naoafeta,gv-livre,gv-nao,gv-livre,gv-outra', 'cor de cada posição ("Não afeta" não é "Não")');
ok(G.govBadge('Não') === '<span class="gv gv-nao">Não</span>' && G.govBadge('') === '—', 'selo');
ok(Object.keys(G.lerPosicoesGoverno('texto qualquer sem sumário').itens).length === 0, 'PDF sem o sumário → nada lido');

console.log('\n== no resumo executivo ==');
Object.assign(global, { govPosicao: G.govPosicao, govBadge: G.govBadge, GOV_CSS: G.GOV_CSS });
const R = require(path.join(__dirname, '..', 'ccjc-resumo.js'));
const proj = (chave, extra = {}) => ({ chave, sigla: chave.split(' ')[0], numero: +chave.split(' ')[1].split('/')[0], ano: +chave.split('/')[1], ementa: 'x', relator: 'Rel', resumoOriginal: 'r', statusAnalise: 'concluido', ...extra });
const p2 = { titulo: 'CCJC – 03/11/2026', projetos: [proj('PL 2500/2025', { relatoria: 'pode', relator: 'Fulano' }), proj('PL 1834/2023'), proj('PL 9/2026'),
  { chave: 'PDL 415/2026', sigla: 'PDL', numero: 415, ano: 2026, relatoria: 'pode', relator: 'Felipe Francischini', statusAnalise: 'pendente', ementa: 'serviço de radiodifusão comunitária' }],
  governo: { arquivo: 'Liderança Digital.pdf', importadoEm: '2026-11-03T16:00:00Z', reuniao: '03/11/2026', itens: r.itens } };
const dados = ['PL 2500/2025', 'PL 1834/2023', 'PL 9/2026'].map(c => ({ chave: c, tema: 'T', parecerCurto: 'Aprovação', debate: 'Baixo', oQueFaz: 'f', oQueFazItens: [], parecer: 'p' }));
const g = R.resumoTextosGerais(p2, dados);
ok(/<b>PL 2500\/2025<\/b> \(dep\. Fulano\) — governo: <span class="gv gv-nao">Não<\/span>/.test(g.p1) && /<b>PDL 415\/2026<\/b> \(dep\. Felipe Francischini\), de rádio e TV — governo: <span class="gv gv-livre">Voto Livre<\/span>/.test(g.p1), 'itens do Podemos na visão geral com a posição do governo (o "Não" em vermelho)');
ok(/Posição do governo nos itens comentados: Não em 1 e Em Análise em 1; 1 sem posição no documento do governo\./.test(g.p2), 'contagem das posições nos itens comentados');
const h = R.resumoHTML(p2, { itens: dados }, null);
ok(/<th class="c">Governo<\/th>/.test(h) && (h.match(/<td class="c"><span class="gv /g) || []).length === 2 && /<td class="c">—<\/td><\/tr>/.test(h), 'coluna "Governo" na tabela ("—" sem posição)');
ok(/<tr class="tr-pode"><td class="ch">PL 2500\/2025<br><span class="pode">Podemos<\/span>/.test(h), 'linha do item do Podemos marcada na tabela');
ok((h.match(/<h3>Posição do governo<\/h3>/g) || []).length === 3 && /Posição do governo: Liderança do Governo na CD, reunião de 03\/11\/2026 \(Liderança Digital\.pdf/.test(h), 'posição no bloco de cada item e a fonte no rodapé');
const h0 = R.resumoHTML({ ...p2, governo: undefined }, { itens: dados }, null);
ok(!/Governo<\/th>/.test(h0) && !/Posição do governo/.test(h0), 'sem posição importada, o resumo fica como antes');
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
