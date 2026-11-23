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
  const t2 = PR.pe5TesesConstitucionais({ achados: [{ gravidade: 'media', questao: 'O fundamento constitucional invocado para reduzir compensação tributária é o art. 163, VIII, "d".', porque: 'x' }],
    controversias: [{ questao: 'saúde', explica: 'O Executivo aplicou a vedação do art. 14 ao mínimo da saúde no projeto de orçamento, e isso é controvertido porque o mínimo é fixado pela Constituição.' }] });
  ok(t2.length === 1 && /art\. 163, VIII, "d" da Constituição/.test(t2[0]), 'tese: "art. 163" não quebra a frase; o art. 14 da lei, longe da palavra Constituição, não vira tese constitucional');
  const marca = PR.pe5EixosComparacao({ blocos: [{ titulo: 'Explicação pública', dispositivos: 'art. 1º (art. 2º, § 5º, da LC 200/2023)' }, { titulo: 'Lei Kandir', dispositivos: 'art. 2º (art. 1º, § 6º, da LC 176/2020)' }, { titulo: 'Restos a pagar', dispositivos: 'art. 14' }],
    achados: [{ gravidade: 'alta', dispositivo: 'art. 2º (LC 176/2020, art. 1º, § 6º)' }, { gravidade: 'alta', dispositivo: 'art. 3º (LC 235/2026, art. 14, caput)' }] }).split('\n');
  ok(!/grave/.test(marca[0]) && /grave/.test(marca[1]) && !/grave/.test(marca[2]), 'ponto grave: o art. 2º da Lei Kandir não marca o art. 2º da LC 200, e o art. 14 da LC 235 não marca o art. 14 do projeto');
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

  // histórico: a origem de cada lei alterada; internacional: um país de modelo oposto (22/11/2026)
  {
    const PP = PR;
    const Lx = { alteracoes: [{ dispositivo: 'art. 2º da Lei Complementar nº 200/2023' }, { dispositivo: 'art. 5º da Lei Complementar nº 200/2023' }, { dispositivo: 'art. 1º da LC 176/2020' }, { dispositivo: 'art. 8º-C da Lei nº 9.796, de 5 de maio de 1999' }, { dispositivo: 'art. 12-A da Lei nº 11.540/2007' }],
      blocos: [{ titulo: 'Lei Kandir', dispositivos: 'art. 2º (art. 1º, § 6º, da LC 176/2020)', explica: 'Limita a entrega.' }, { titulo: 'Teto remuneratório', dispositivos: 'art. 10', explica: 'O Congresso deverá apreciar em até 60 dias o projeto que disciplinará o § 11 do art. 37 da Constituição. A despesa fica sujeita a limite fixado em lei específica ou na lei orçamentária.' }],
      achados: [{ gravidade: 'alta', dispositivo: 'art. 2º (LC 176/2020, art. 1º, § 6º)' }] };
    const leis = PP.pe5LeisAlteradas(Lx);
    ok(leis.map(l => `${l.lei}${l.obrigatoria ? '*' : ''}`).join('|') === 'Lei Complementar nº 200/2023*|Lei Complementar nº 176/2020*|Lei nº 9.796/1999|Lei nº 11.540/2007', 'leis alteradas: a mais alterada e a de ponto grave são obrigatórias; data por extenso é lida');
    ok(PP.pe5OrigensFaltantes(leis, [{ tipo: 'origem da lei alterada', proposicao: 'PLP 93/2023', lei_resultante: 'Lei Complementar nº 200, de 30 de agosto de 2023', desfecho: 'virou lei' }, { tipo: 'tentativa anterior', o_que_propunha: 'Alterava a LC 176/2020', desfecho: 'arquivada' }]).map(l => l.lei).join('|') === 'Lei Complementar nº 176/2020', 'origem localizada pela lei resultante (número e ano); projeto que só ALTERAVA a lei não conta como origem');
    const del = PP.pe5TemasDelegados(Lx);
    ok(del.length === 1 && /60 dias o projeto que disciplinará o § 11 do art\. 37 da Constituição\.$/.test(del[0]), 'tema delegado: o prazo para o projeto do teto entra inteiro ("art. 37" não corta a frase); "limite fixado em lei específica" não é delegação');
    ok(PP.pe5EhContraste({ contraste: true }) && PP.pe5EhContraste({ contraste: 'sim' }) && !PP.pe5EhContraste({ contraste: false }) && !PP.pe5EhContraste({}), 'país de modelo oposto: "contraste" verdadeiro');
    const pk = (o = {}) => ({ doc: { abertura: { decide: '257', frase: 'f', muda: [] }, caminhos: { opcoes: [] }, materia: { origem: [], historico: o.hist || [] }, debate: { posicoes: [] }, internacional: { jurisdicoes: o.jurN || [] }, analise: { jurisprudencia: [] } },
      pesquisa: { debate: { atores: [] }, internacional: { jurisdicoes: o.jur || [] }, contexto: { jurisprudencia: [] }, congresso: { historico: o.h || [] } }, leitura: Lx, coleta: {}, trechos: { recusados: [] }, alteracoes: [] });
    const jur = [{ id: 'W1', lugar: 'Estados Unidos', contraste: true }, { id: 'W2', lugar: 'França', contraste: false }];
    const h = [{ id: 'H1', tipo: 'origem da lei alterada', lei_resultante: 'Lei Complementar nº 200/2023', desfecho: 'virou lei' }, { id: 'H2', tipo: 'origem da lei alterada', lei_resultante: 'Lei Complementar nº 176/2020', desfecho: 'virou lei' }];
    const kOk = K.pe5Conferir(pk({ jur, jurN: [{ lugar: 'EUA', regra: 'r', ev: ['W1'] }], h, hist: [{ proposicao: 'PLP 93/2023', ev: ['H1'] }, { proposicao: 'PLP 133/2020', ev: ['H2'] }] }));
    const kFora = K.pe5Conferir(pk({ jur, jurN: [{ lugar: 'França', regra: 'r', ev: ['W2'] }], h, hist: [{ proposicao: 'PLP 93/2023', ev: ['H1'] }] }));
    const kSem = K.pe5Conferir(pk({ jur: [jur[1]], h: [h[0]] }));
    ok(item(kOk, /modelo oposto/).ok && item(kOk, /projeto de origem/).ok, 'país oposto e origens na pesquisa e na nota: os dois testes passam');
    ok(/está na pesquisa, mas não na nota/.test(item(kFora, /modelo oposto/).detalhe) && /Origem pesquisada e fora da nota: Lei Complementar nº 176\/2020/.test(item(kFora, /projeto de origem/).detalhe), 'pesquisados e deixados fora da nota: apontado');
    ok(/A pesquisa não trouxe país/.test(item(kSem, /modelo oposto/).detalhe) && /Sem a origem na pesquisa: Lei Complementar nº 176\/2020/.test(item(kSem, /projeto de origem/).detalhe), 'ausentes da pesquisa: apontado');
  }

  // revisão do código (22/11/2026): nove correções
  {
    const { gerarReferencia } = require('./pe5-referencia.js');
    // 1. o mesmo ator com nomes diferentes entre os grupos fica uma vez
    const jd = PL.pe5JuntarDebates(
      { grupo: 'A', atores: [{ id: 'Q1', ator: 'Confederação Nacional da Indústria (CNI), presidente Ricardo Alban', posicao: 'contrário', argumentos: [{ tese: 'x' }] }, { id: 'Q2', ator: 'Senador Eduardo Braga (MDB-AM), relator no Senado', posicao: 'favorável', argumentos: [{ tese: 'a' }] }, { id: 'Q3', ator: 'Governadora Raquel Lyra (Pernambuco)', posicao: 'contrário', argumentos: [] }] },
      { grupo: 'B', atores: [{ id: 'Q1', ator: 'Confederação Nacional da Indústria (CNI)', posicao: 'contrário com ressalvas', argumentos: [{ tese: 'y' }] }, { id: 'Q2', ator: 'Eduardo Braga', posicao: 'favorável', argumentos: [{ tese: 'b' }] }, { id: 'Q3', ator: 'CNI', posicao: 'contrário', argumentos: [] }, { id: 'Q4', ator: 'Governadores (mobilização coordenada)', posicao: 'contrário', argumentos: [] }, { id: 'Q5', ator: 'Senador Carlos Portinho (PL-RJ)', posicao: 'contrário', argumentos: [] }, { id: 'Q6', ator: 'Senador Sergio Moro (PL-PR)', posicao: 'contrário', argumentos: [] }], controversias: [{ questao: 'A regra deve valer para todos os créditos tributários?', favor: ['Q2'], contra: ['Q1', 'Q3'] }] });
    ok(jd.atores.length === 6 && jd.atores[0].argumentos.length === 2 && jd.atores[1].argumentos.length === 2 && jd.controversias[0].favor[0] === 'Q2' && jd.controversias[0].contra.join() === 'Q1', 'CNI (nome completo, com aposto e só a sigla) e Eduardo Braga (com e sem cargo) ficam uma vez cada, com os argumentos somados; governadora e governadores, e dois senadores do mesmo partido, não se confundem');
    ok(jd.avisos.some(a => /Posição divergente.*Confederação Nacional da Indústria.*"contrário" numa busca e "contrário com ressalvas"/.test(a)), 'posição diferente entre as buscas vira aviso');
    // 2. "Quem se posicionou" truncada não derruba a nota
    const tr = await gerarReferencia({ respostas: { 'redacao-1c': '{"quem": {"posicoes": [ {"texto": "O Ministério' } });
    ok(!tr.p.erro && tr.p.doc.materia && tr.p.conferencia.itens.some(i => /Quem se posicionou e como/.test(i.teste) && i.critico && /não foi redigida/.test(i.detalhe)), '"Quem se posicionou e como" ilegível: a nota sai sem a seção, com aviso crítico na conferência');
    // 3. origem só de lei dos últimos vinte anos; decreto-lei nunca
    const lx = PR.pe5LeisAlteradas({ alteracoes: [{ dispositivo: 'art. 59 do Decreto-Lei nº 5.452, de 1º de maio de 1943' }, { dispositivo: 'art. 60 do Decreto-Lei nº 5.452/1943' }, { dispositivo: 'art. 3º da Lei nº 8.666/1993' }, { dispositivo: 'art. 2º da Lei nº 14.133/2021' }], achados: [{ gravidade: 'alta', dispositivo: 'art. 2º da Lei nº 14.133/2021' }, { gravidade: 'alta', dispositivo: 'art. 3º da Lei nº 8.666/1993' }] }, { anoRef: 2026 });
    ok(lx.filter(l => l.obrigatoria).map(l => l.lei).join() === 'Lei nº 14.133/2021', 'origem obrigatória: decreto-lei (a CLT) e lei de 1993 ficam de fora; a lei de 2021 com ponto grave entra');
    // 4. sem busca na internet, os mínimos de pesquisa não são cobrados
    const sw = await gerarReferencia({ io: { semWeb: true } });
    ok(sw.p.pesquisa.semBusca === true && !sw.p.conferencia.itens.some(i => /ao menos cinco países|ao menos quatro|modelo oposto|projeto de origem/.test(i.teste)), 'sem busca: a conferência não cobra países, decisões, país oposto nem origem das leis');
    // 6. tema delegado: só o que o texto empurra para outra lei
    const td = PR.pe5TemasDelegados({ blocos: [{ titulo: 'T', dispositivos: 'art. 1º', explica: 'O projeto regulamenta o uso de créditos. O projeto de lei orçamentária poderá dispor sobre bolsas. O valor será fixado em lei. Os critérios serão definidos em lei. Lei específica disporá sobre o fundo.' }] });
    ok(td.length === 3 && /valor será fixado em lei/.test(td[0]) && /critérios serão definidos em lei/.test(td[1]) && /Lei específica disporá/.test(td[2]), 'tema delegado: "o projeto regulamenta" e "o projeto de lei orçamentária poderá dispor" não entram; "será fixado em lei", "serão definidos em lei" e "lei específica disporá" entram');
    // 7. quadro de tendência: nome sem cortar o segundo ator; posição fora das previstas é dita
    const tt = H.pe5Tendencia([{ ator: 'Senadores Tereza Cristina (PP-MS) e Wanderlan Cardoso (PSD-GO)', posicao: 'contrário com ressalvas', grupo: 'G' }, { ator: 'Bruno Moretti, ministro do Planejamento e Orçamento', posicao: 'favorável', grupo: 'G' }, { ator: 'Fulano', posicao: 'dividido', grupo: 'G' }, { ator: 'Beltrano', posicao: 'neutro', grupo: 'G' }]);
    ok(tt[0].ressalva_c[0] === 'Senadores Tereza Cristina e Wanderlan Cardoso' && tt[0].favor[0] === 'Bruno Moretti' && tt.semClasse.join() === 'Fulano ("dividido")' && /Contados em "Neutros"[^<]*Fulano/.test(H.pe5TendenciaHtml([{ ator: 'Fulano', posicao: 'dividido', grupo: 'G' }], null, x => x)), 'tendência: dois atores no mesmo item ficam com os dois nomes; o aposto de cargo sai; posição não prevista é avisada na nota do quadro');
    // 8. notícias em paralelo e com limite de tempo
    const busca = '<a href="https://www12.senado.leg.br/noticias/materias/2026/11/12/uma-noticia-sobre-o-ajuste">Uma notícia sobre o ajuste fiscal</a><a href="https://www12.senado.leg.br/noticias/materias/2026/11/13/pagina-que-nao-responde">Página que nunca responde aqui</a>';
    let simultaneas = 0, pico = 0; const t0 = Date.now();
    const lento = async u => { if (/busca\?/.test(u)) return /b_start/.test(u) ? '' : busca; if (/busca-api/.test(u)) return '{}'; simultaneas++; pico = Math.max(pico, simultaneas); try { if (/nao-responde/.test(u)) await new Promise(() => {}); await new Promise(r => setTimeout(r, 30)); return '<div id="textoMateria"><p>O Senado aprovou o PLP 299/2026, que trata do ajuste fiscal do governo.</p></div><footer>'; } finally { simultaneas--; } };
    const nt = await A.agenciasBuscarNoticias({ sigla: 'PLP', numero: 299, ano: 2026 }, lento, { esperaMs: 150 });
    ok(nt.length === 1 && pico === 2 && Date.now() - t0 < 2000, 'notícias: as páginas são lidas em paralelo, e a que não responde é abandonada no limite de tempo sem travar');
    // 9. a origem é reconhecida pela lei citada, não por número solto
    const l200 = [{ lei: 'Lei Complementar nº 200/2023', numero: '200', ano: '2023', obrigatoria: true }];
    ok(PR.pe5OrigensFaltantes(l200, [{ desfecho: 'virou lei', o_que_propunha: 'Crédito de R$ 200 milhões em 2023' }]).length === 1 && PR.pe5OrigensFaltantes(l200, [{ desfecho: 'virou lei', lei_resultante: 'LC 200/2023' }]).length === 0, 'origem: "R$ 200 milhões em 2023" não é a LC 200/2023; "LC 200/2023" é');
    // revisão: "R$" seguido de sinal especial no texto novo entra como está
    const dd = { a: [{ texto: 'O custo estimado é de cem reais por unidade vendida.', ev: [] }] };
    PL.pe5AplicarRevisao(dd, [{ trecho: 'cem reais por unidade', novo: "R$$ 100 (US$& 17) por unidade" }], []);
    ok(dd.a[0].texto === "O custo estimado é de R$$ 100 (US$& 17) por unidade vendida.", 'revisão: cifrão no texto novo não é tratado como padrão de substituição');
  }

  // valores em euro e libra depois de espaço são lidos (o \b antes de "€" nunca casava), e a conversão pelo câmbio passa
  const nums = K.pe5Numeros('anulou € 10 bilhões; teto de £ 2 milhões').map(x => `${x.moeda} ${x.valor}`);
  ok(nums.join('|') === 'EUR 10000000000|GBP 2000000', '€ e £ depois de espaço são lidos como valores');
  const pc = p({ jur: [{ lugar: 'França', aconteceu: 'O decreto anulou € 10 bilhões (cerca de R$ 64,7 bilhões, a R$ 6,4672 por euro).', ev: ['W1'] }] });
  pc.pesquisa.internacional.jurisdicoes = [{ id: 'W1', aconteceu: [{ fato: 'Decreto anulou € 10 bilhões' }] }];
  pc.cambio = { data: '19/11/2026', taxas: { EUR: 6.4672 } };
  const cv = item(K.pe5Conferir(pc), /Valores, percentuais/);
  ok(!/64,7|6,4672/.test(cv.detalhe || ''), 'conversão de € 10 bilhões pelo câmbio da base e a taxa citada não são apontadas');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
