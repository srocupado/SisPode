// Pautas CCJC · Resumo executivo (ccjc-resumo.js): o que é contagem sai dos
// dados, o texto de cada item sai da IA a partir da nota já gerada.
// Pauta no formato da de 03/11/2026: 122 itens, 7 comentados, 115 PDLs de rádio
// e TV, um deles sob relatoria do Podemos. A IA é simulada.
// Uso: node testes/ccjc-resumo.test.js
const path = require('path');
global.escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
// funções da posição do governo (ccjc-governo.js), globais na página
const G = require(path.join(__dirname, '..', 'ccjc-governo.js'));
Object.assign(global, { govPosicao: G.govPosicao, govBadge: G.govBadge, GOV_CSS: G.GOV_CSS });
const R = require(path.join(__dirname, '..', 'ccjc-resumo.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const comentados = ['PRC 345/2018', 'PL 1834/2023', 'PL 182/2025', 'PL 2500/2025', 'PL 2046/2011', 'PL 2721/2015', 'PL 2918/2025']
  .map((chave, i) => ({ chave, sigla: chave.split(' ')[0], ementa: 'Ementa ' + i, relator: 'Relator ' + i, autores: ['Autor ' + i], resumoOriginal: 'Resumo ' + i,
    statusAnalise: 'concluido', analiseEm: '2026-11-03T13:0' + i + ':00Z', comissoes: [{ sigla: 'CCJC', nome: 'Comissão de Constituição e Justiça e de Cidadania', resumo: 'Parecer ' + i }] }));
const radios = Array.from({ length: 115 }, (_, i) => ({ chave: `PDL ${300 + i}/2026`, sigla: 'PDL', statusAnalise: 'pendente', relator: 'Fulano',
  ementa: 'Aprova o ato que renova a autorização outorgada à Associação X para executar serviço de radiodifusão comunitária no Município Y.' }));
radios[5].relatoria = 'pode'; radios[5].relator = 'Felipe Francischini'; radios[5].chave = 'PDL 415/2026';
const pauta = { titulo: 'CCJC – 03/11/2026', projetos: [...comentados, ...radios] };

console.log('== dados da pauta ==');
ok(radios.every(R.resumoEhRotina) && !comentados.some(R.resumoEhRotina), 'PDL de rádio e TV é rotina; PL e PRC não');
ok(!R.resumoEhRotina({ sigla: 'PDL', ementa: 'Susta o Decreto nº 1, de 2026' }), 'PDL que não é de radiodifusão não é rotina');
ok(pauta.projetos.filter(R.resumoComAnalise).length === 7, '7 itens com análise');
ok(R.resumoAssinatura(comentados.slice(0, 2)) === 'PRC 345/2018@2026-11-03T13:00:00Z|PL 1834/2023@2026-11-03T13:01:00Z', 'assinatura = chave + data da análise (muda quando a análise é refeita)');

console.log('\n== um item, com a IA simulada ==');
ok(R.resumoJSON('```json\n{"a": 1}\n```').a === 1 && R.resumoJSON('Segue:\n{"a": 2}').a === 2, 'JSON com ou sem cerca de código');
const pr = R.resumoPromptItem({ ...comentados[2], comissoes: [...comentados[2].comissoes, { sigla: 'CFT', nome: 'Comissão de Finanças e Tributação', resumo: 'CFT tornou facultativo' }] });
ok(/\[Parecer em votação na CCJC\]\nParecer 2/.test(pr) && /Comissão de Finanças e Tributação \(CFT\): CFT tornou facultativo/.test(pr) && /Não recomende voto/.test(pr), 'o prompt leva a nota (CCJC à parte das outras comissões) e as regras');
global.aiCall = async () => '```json\n' + JSON.stringify({ tema: 'Busca de desaparecidos', titulo: 'Busca de desaparecidos com Alerta Âmber', oQueFaz: 'Moderniza a política.',
  oQueFazItens: ['câmeras', 'cadastro', ''], tramitacao: '', parecerCurto: 'Aprovação com subemenda', parecer: 'Aprova com subemenda.', pontosAtencao: 'Privacidade.', focoDebate: 'privacidade', debate: 'medio' }) + '\n```';
(async () => {
  const it = await R.resumoGerarItem(comentados[2]);
  ok(it.chave === 'PL 182/2025' && it.debate === 'Médio' && it.oQueFazItens.length === 2, `campos conferidos (debate "medio" → ${it.debate}; item vazio da lista some)`);

  console.log('\n== textos gerais (sem IA) ==');
  const dados = comentados.map((p, i) => ({ chave: p.chave, tema: 'Tema ' + i, parecerCurto: i === 6 ? 'Rejeição' : 'Aprovação com emenda', debate: ['Baixo', 'Baixo', 'Alto', 'Alto', 'Alto', 'Médio', 'Baixo'][i],
    focoDebate: ['', '', 'complexidade e privacidade', 'política penal', 'termos sobre sexualidade', '', ''][i], oQueFaz: 'Faz', oQueFazItens: [], tramitacao: '', parecer: 'P', pontosAtencao: 'A' }));
  const g = R.resumoTextosGerais(pauta, dados);
  ok(g.p1.startsWith('A pauta tem 122 itens, dos quais 7 foram comentados. Os outros 115 são PDLs de renovação ou autorização de rádio e TV, matéria de rotina.'), 'visão geral: contagens e os PDLs de rádio e TV');
  ok(/Há um item sob relatoria do Podemos: <b>PDL 415\/2026<\/b> \(dep\. Felipe Francischini\), de rádio e TV\./.test(g.p1), 'relatoria do Podemos na pauta inteira, inclusive entre os PDLs');
  ok(/^Em 6 dos 7 itens comentados, o parecer do relator na CCJC é favorável; <b>PL 2918\/2025<\/b> tem outra conclusão\./.test(g.p2), 'parecer: quantos favoráveis e quem fugiu');
  ok(g.leitura === 'Os itens com maior potencial de debate são o <b>PL 182/2025</b> (complexidade e privacidade), o <b>PL 2500/2025</b> (política penal) e o <b>PL 2046/2011</b> (termos sobre sexualidade). Os demais tendem a ter tramitação tranquila.', 'leitura geral a partir dos itens de debate alto');
  const g2 = R.resumoTextosGerais({ titulo: 'x', projetos: [...comentados, radios[0], { chave: 'PL 9/2026', sigla: 'PL', ementa: 'x' }] }, dados.slice(0, 6));
  ok(/Dos 2 sem análise, 1 é PDL de renovação/.test(g2.p1) && /Ainda sem análise: <b>PL 9\/2026<\/b>\./.test(g2.p1) && /^Em todos os 6 itens comentados/.test(g2.p2), 'sem análise que não é rádio aparece pelo nome');

  console.log('\n== o documento ==');
  const h = R.resumoHTML(pauta, { itens: dados, geradoEm: '2026-11-03T15:00:00Z', modelo: 'modelo-x', falhas: ['PL 1/2026'] }, 'data:image/png;base64,AAA');
  ok(/LIDERANÇA DO PODEMOS NA CÂMARA DOS DEPUTADOS/.test(h) && /#0B8A4B 0 40%,#7C9A2F 40% 62%,#1F5FA8 62% 82%,#D9531E 82% 100%/.test(h) && /color:#0b5e3a/.test(h), 'identidade dos relatórios: linha da Liderança, filete de 4 cores, títulos em #0b5e3a, logo');
  ok(/Resumo executivo · 122 projeto\(s\) em pauta · 7 com análise · 115 sem análise/.test(h), 'linha de contagem');
  ok((h.match(/<tr><td class="ch">/g) || []).length === 7 && /<span class="db db-a">Alto<\/span>/.test(h), 'tabela com os 7 itens e o selo de debate');
  ok((h.match(/<section class="item">/g) || []).length === 8, 'um bloco por item + a leitura geral');
  ok(/Sem resumo \(a IA falhou\): PL 1\/2026/.test(h), 'item que a IA não resumiu é dito, não omitido');
  const hr = R.resumoHTML({ ...pauta, responsavel: 'Maria <Silva>' }, { itens: dados }, null);
  ok(/· Servidor responsável: Maria &lt;Silva&gt;<\/div>/.test(hr) && !/Servidor responsável/.test(h), 'servidor responsável pela pauta na linha de contagem (escapado), só quando preenchido');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
