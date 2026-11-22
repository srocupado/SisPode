// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// NTA, ajustes de 22/11/2026: notícias das agências do Congresso, debate em quatro grupos de atores, mínimos de
// países e decisões (com a chamada complementar), um parágrafo por ator, quadro de tendência e quórum.
// node testes/nta-minimos.test.js
const A = require('../noticias-agencias.js'), PR = require('../pe5-prompts.js'), PL = require('../pe5-pipeline.js'), K = require('../pe5-conferencia.js'), H = require('../pe5-html.js');
let falhas = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };

(async () => {
  console.log('== notícias das agências ==');
  const buscaSenado = `<ul><li><a href="https://www12.senado.leg.br/noticias/materias/2026/11/18/senado-completa-votacao-e-ajuste-fiscal-segue-para-a-camara">Senado completa votação, e ajuste fiscal segue para a Câmara</a></li>
    <li><a href="https://www12.senado.leg.br/noticias/materias/2026/11/18/senado-completa-votacao-e-ajuste-fiscal-segue-para-a-camara/foto.jpg/@@images/image/mini">x</a></li>
    <li><a href="https://www12.senado.leg.br/noticias/materias/2014/09/16/outra-coisa">Deputados discutem propostas que coíbem o trabalho infantil</a></li>
    <li><a href="https://www12.senado.leg.br/noticias/materias/2026/11/17/sem-citar">Matéria que fala de outro assunto qualquer</a></li></ul>`;
  const L = A.agenciaSenadoLinks(buscaSenado);
  ok(L.length === 3 && L[0].data === '18/11/2026' && !L.some(l => /@@images/.test(l.url)), 'Senado: links das matérias com a data do endereço, sem as imagens');
  const pag = t => `<html><nav><p>menu menu menu menu menu menu menu menu</p></nav><div id="textoMateria"><p>${t}</p><p>Agência Senado (Reprodução autorizada mediante citação da Agência Senado)</p></div><footer></footer></html>`;
  ok(A.agenciaTextoDaPagina(pag('O Senado completou a votação do projeto do ajuste fiscal (PLP 299/2026), que segue para a Câmara.')) === 'O Senado completou a votação do projeto do ajuste fiscal (PLP 299/2026), que segue para a Câmara.', 'texto da notícia: só o corpo, sem menu nem a linha de reprodução');
  const cam = { hits: { hits: [{ _source: { titulo: 'Relator defende aprovação do ajuste fiscal', url: 'www.camara.leg.br/noticias/1320366-RELATOR', data: '2026-11-17T17:43:33', proposicoes: '2655570' } }, { _source: { titulo: 'Sem url' } }] } };
  const C = A.agenciaCamaraLinks(cam);
  ok(C.length === 1 && C[0].url === 'https://www.camara.leg.br/noticias/1320366-RELATOR' && C[0].data === '17/11/2026' && C[0].idsProposicao[0] === '2655570', 'Câmara: notícias da busca do portal, com endereço completo, data e id da proposição');
  const paginas = {
    'busca?SearchableText=PLP+299%2F2026': buscaSenado,
    'senado-completa-votacao': pag('O Senado completou, nesta quarta-feira (18), a votação do projeto do ajuste fiscal (PLP 299/2026).'),
    'outra-coisa': pag('Trabalho infantil, PLP 299/2014, nada a ver.'),
    'sem-citar': pag('O ajuste fiscal foi debatido, sem número de projeto nenhum no texto.'),
    'busca-api': JSON.stringify(cam),
    '1320366-RELATOR': pag('O relator, deputado Mauro Benevides Filho, defendeu aprovar o texto sem mudanças para evitar o retorno ao Senado, disse ele nesta terça-feira em entrevista. Segundo o relator, qualquer alteração faria a matéria voltar ao Senado e atrasaria a sanção.'),
  };
  const pedidos = [];
  const fetchTexto = async u => { pedidos.push(u); const k = Object.keys(paginas).find(x => u.includes(x)); if (!k) throw new Error('404'); return paginas[k]; };
  const N = await A.agenciasBuscarNoticias({ sigla: 'PLP', numero: 299, ano: 2026, idCamara: 2655570 }, fetchTexto, { desde: new Date('2026-11-01T00:00:00Z') });
  ok(N.length === 2 && N[0].casa === 'Senado' && N[0].veiculo === 'Agência Senado' && N[1].casa === 'Câmara', 'fica a notícia que cita a matéria no texto e a da Câmara ligada ao id da proposição; a anterior à data e a que não cita saem');
  ok(pedidos.some(u => /busca-api\/api\/v1\/busca\/noticias\/_search\?q=%22PLP%20299%22/.test(u)) && pedidos.some(u => /q=proposicoes%3A2655570/.test(u)) && !pedidos.some(u => /outra-coisa/.test(u)), 'Câmara: busca pela sigla e número entre aspas e pelo id; a notícia antiga nem é baixada');
  ok((await A.agenciasBuscarNoticias({ sigla: 'PLP', numero: 299, ano: 2026 }, async () => { throw new Error('fora do ar'); })).length === 0, 'agências fora do ar: lista vazia, sem erro');

  console.log('\n== pesquisa ==');
  const leitura = { resumo: 'r', blocos: [{ titulo: 'Redução de compensações', dispositivos: 'art. 1º (art. 6º-F)', explica: 'e' }, { titulo: 'Lei Kandir', dispositivos: 'art. 2º', explica: 'e' }],
    achados: [{ gravidade: 'alta', questao: 'q', dispositivo: 'art. 1º (art. 6º-F)', porque: 'pode ser questionado com base no art. 150, III, "b", da Constituição' }, { gravidade: 'baixa', questao: 'q', dispositivo: 'art. 9º', porque: 'art. 5º, XXXVI, da Constituição' }],
    controversias: [{ questao: 'saúde', explica: 'o mínimo é fixado pela Constituição (art. 198, § 2º, I, da Constituição) e o art. 91 do ADCT' }] };
  const teses = PR.pe5TesesConstitucionais(leitura);
  ok(teses.length === 3 && teses.some(t => /art\. 150, III, "b" da Constituição/.test(t)) && teses.some(t => /art\. 91 do ADCT/.test(t)) && !teses.some(t => /art\. 5º/.test(t)), 'teses constitucionais: os dispositivos citados nos pontos graves e nas controvérsias (ponto baixo fica de fora)');
  const base = { identificacao: 'PLP 299/2026', ementa: 'e', leitura, coleta: null, hoje: '22/11/2026' };
  const ctx = PR.pe5PromptContexto(base);
  ok(/DISPOSITIVOS DA CONSTITUIÇÃO EM JOGO/.test(ctx) && /NO MÍNIMO 4 e até 10 decisões/.test(ctx) && /acórdãos do TCU/.test(ctx) && /Ação ainda sem decisão NÃO entra aqui/.test(ctx), 'contexto: no mínimo quatro decisões, uma por dispositivo, em quatro frentes; ação sem decisão vai para a judicialização');
  const intl = PR.pe5PromptInternacional(base);
  ok(/NO MÍNIMO 5 e até 8 países/.test(intl) && /MECANISMOS DO TEXTO/.test(intl) && /Redução de compensações \(art\. 1º \(art\. 6º-F\)\) — tem ponto grave/.test(intl) && /"eixo": "qual dos eixos"/.test(intl), 'internacional: no mínimo cinco, um por eixo, com os mecanismos do texto e os de ponto grave marcados');
  const deb = PR.pe5PromptDebate({ ...base, foco: 'politica', noticias: [{ veiculo: 'Agência Senado', data: '18/11/2026', titulo: 'T', url: 'https://www12.senado.leg.br/x', texto: 'fala do senador' }] });
  ok(/NOTÍCIAS DAS AGÊNCIAS DO CONGRESSO/.test(deb) && /<<<NOTÍCIA 1: Agência Senado, 18\/11\/2026 — T — https:\/\/www12\.senado\.leg\.br\/x>>>/.test(deb) && !/NOTÍCIAS DAS AGÊNCIAS/.test(PR.pe5PromptDebate({ ...base, foco: 'economia', noticias: [{ url: 'u', texto: 't' }] })), 'as notícias das agências vão só à busca de governo e Congresso');
  const comp = PR.pe5PromptComplementar({ ...base, faltaPaises: 3, faltaDecisoes: 0, jaPaises: ['França', 'Itália'], eixosSemPais: ['Lei Kandir'] });
  ok(/mais 3 país/.test(comp) && /NÃO repita\): França; Itália/.test(comp) && /Mecanismos ainda sem país: Lei Kandir/.test(comp) && !/mais 0 decis/.test(comp), 'complementar: pede só o que falta, com o que já existe para não repetir');
  const j = PL.pe5JuntarDebates({ grupo: 'Governo e Congresso', atores: [{ id: 'Q1', ator: 'Senador Rogerio Marinho' }] }, { grupo: 'Setores econômicos e trabalhadores', atores: [{ id: 'Q1', ator: 'CNI' }] }, { atores: [] }, { grupo: 'Sociedade civil e análise', atores: [{ id: 'Q1', ator: 'Rogerio Marinho' }, { id: 'Q2', ator: 'Frente pela Vida' }] });
  ok(j.atores.length === 3 && j.atores.map(a => a.grupo).join('|') === 'Governo e Congresso|Setores econômicos e trabalhadores|Sociedade civil e análise' && j.atores.map(a => a.id).join() === 'Q1,Q2,Q3', 'quatro buscas se juntam: cada ator leva o grupo da busca; o repetido fica uma vez');

  console.log('\n== quadro de tendência ==');
  const T = H.pe5Tendencia([{ ator: 'Governo', grupo: 'Governo e Congresso', posicao: 'favorável' }, { ator: 'Senador B (PL-RN)', grupo: 'Governo e Congresso', posicao: 'contrário' }, { ator: 'CNI', grupo: 'Setores', posicao: 'contrário com ressalvas' }, { ator: 'X', grupo: 'Setores', posicao: 'favorável com ressalvas' }]);
  ok(T.length === 2 && T[0].favor.join() === 'Governo' && T[0].contra.join() === 'Senador B' && T[1].ressalva_c.join() === 'CNI' && T[1].ressalva_f.join() === 'X', 'tendência: atores por grupo e posição, "com ressalvas" separado do favorável e do contrário');

  console.log('\n== conferência ==');
  const p = (o = {}) => ({ doc: { abertura: { decide: o.decide || 'A Câmara decide.', frase: 'f', muda: [] }, caminhos: { opcoes: [] }, materia: { origem: [] }, debate: { posicoes: o.posicoes || [] }, internacional: { jurisdicoes: o.jur || [] }, analise: { jurisprudencia: o.dec || [] } },
    pesquisa: { debate: { atores: o.atores || [] }, internacional: { jurisdicoes: [] }, contexto: { jurisprudencia: [] } }, leitura: {}, coleta: { mapa: { quorum: { regra: 'maioria absoluta dos deputados', minimo: 257, base: 'art. 69 da Constituição' } } }, trechos: { recusados: [] }, alteracoes: [] });
  const item = (c, re) => c.itens.find(i => re.test(i.teste));
  const c1 = K.pe5Conferir(p({ jur: [{}, {}], dec: [{}] }));
  ok(!item(c1, /ao menos cinco países/).ok && !item(c1, /Decisões judiciais: ao menos quatro/).ok && !item(c1, /Quórum da matéria/).ok, 'dois países, uma decisão e a abertura sem os 257 votos: três apontamentos');
  const c2 = K.pe5Conferir(p({ jur: [{}, {}, {}, {}, {}], dec: [{}, {}, {}, {}], decide: 'Por ser lei complementar, a aprovação exige 257 votos.' }));
  ok(item(c2, /ao menos cinco países/).ok && item(c2, /Decisões judiciais: ao menos quatro/).ok && item(c2, /Quórum da matéria/).ok, 'cinco países, quatro decisões e o quórum dito: os três passam');
  const atores = Array.from({ length: 8 }, (_, i) => ({ id: `Q${i + 1}`, ator: `Ator ${i + 1}`, grupo: i < 5 ? 'Governo e Congresso' : 'Setores', argumentos: [{ tese: `t${i}` }] }));
  const c3 = K.pe5Conferir(p({ atores, posicoes: [{ texto: 'a', ev: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'] }] }));
  const c4 = K.pe5Conferir(p({ atores, posicoes: atores.slice(0, 6).map(a => ({ texto: 'a', ev: [a.id] })) }));
  ok(!item(c3, /um parágrafo por ator/).ok && /1 parágrafo\(s\) para 8 ator\(es\).*mínimo de 6.*Governo e Congresso: 5; Setores: 3/.test(item(c3, /um parágrafo por ator/).detalhe) && item(c4, /um parágrafo por ator/).ok, 'posições: oito atores num parágrafo só é apontado (com a conta por grupo); seis parágrafos para oito atores passam');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
