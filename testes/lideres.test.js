// Testes do módulo Reunião de Líderes.
//
// lideres.js roda no navegador, então aqui ele é carregado num sandbox com os
// objetos que a extensão fornece (document, chrome, pdfjsLib) e só as funções
// puras são exercitadas — o parser do PDF e as regras de situação/relatoria,
// que são justamente as que produzem informação factual sem passar por IA.
//
// pdfjs-dist vem de bot/node_modules (a extensão distribui a versão de
// navegador em libs/), por isso o require aponta para lá.
//
// Ao carregar, o pdfjs avisa que não achou o módulo `canvas` e que "rendering
// may be broken". É RUÍDO, não falha: canvas só serve para DESENHAR a página,
// e aqui se extrai TEXTO — conferido extraindo texto de um PDF com o aviso na
// tela. O mesmo aviso aparece em todas as suítes que tocam pdfjs; ignore-o.
//
// Uso: node testes/lideres.test.js <pdf-de-07/07/2026> [outros-pdfs...]
//   O primeiro PDF é a lista de referência (62 itens, 68 proposições) e os
//   números conferidos abaixo são os dele. Os demais passam só pelas
//   invariantes estruturais — que é onde mora o risco: a grade de colunas MUDA
//   de uma reunião para outra.
const fs = require('fs');
const path = require('path');
const pdfjs = require(path.join(__dirname, '..', 'bot', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));

const fonte = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
const sandbox = {
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: pdfjs.getDocument },
  window: {},
  fetch: globalThis.fetch,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  console,
  setTimeout, clearTimeout,
  DOMException: globalThis.DOMException,
  XLSX: undefined,
};
const exportar = ['lerListaDoPDF', 'proposicoesDoItem', 'situacaoDe', 'relatoriaDe',
                  'despachosDeComissao', 'extrairJSON', 'formatarPartido',
                  'buscarDocumentosRelacionados', 'parecerPlenarioDe', 'emendaSenadoDe',
                  'fraseDoParecer', 'fraseDaEmendaSenado', 'cenarioDe', 'validarReferencias',
                  'textoQueSaiuDaCamara', 'marcadorDoItem', 'detectarColunas',
                  'papelDe', 'alvoDoREQ', 'frasePapel', 'fraseUrgenciaREQ', 'propsCitadas', 'buscarTramitacoes',
                  'ehRelatorPodemos', 'autoresDetalhados', 'apensadosDoPodemos'];
const fn = new Function(...Object.keys(sandbox),
  `${fonte}\n; return { ${exportar.join(', ')} };`);
const L = fn(...Object.values(sandbox));

const PDF = process.argv[2];
const API = 'https://dadosabertos.camara.leg.br/api/v2';
let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

(async () => {
  // O parser precisa de um PDF real, passado como argumento — o repositório
  // não guarda a lista do Colégio de Líderes (documento de trabalho). Sem o
  // argumento o teste ESTOURAVA em fs.readFileSync(undefined) e derrubava a
  // suíte inteira, inclusive as dezenas de asserções que não dependem de PDF.
  // Agora só esta seção é pulada, com o aviso de como exercitá-la.
  let itens = null;   // preenchido só quando há PDF; ver a seção seguinte
  console.log('\n== Parser do PDF ==');
  if (!PDF) {
    console.log('  ⏭ pulado: nenhum PDF informado.');
    console.log('     Para exercitar o parser: node testes/lideres.test.js <lista.pdf> [outros.pdf ...]');
  } else {
  itens = await L.lerListaDoPDF({ arrayBuffer: async () => fs.readFileSync(PDF).buffer });
  ok(itens.length === 62, `62 itens (obtidos: ${itens.length})`);
  // PDF que não é a lista (ou que o parser não entendeu) devolve zero itens, e
  // as asserções seguintes estouravam em itens[0] — erro de acesso no lugar da
  // informação útil, que é "este arquivo não serve".
  if (!itens.length) {
    console.log(`  ⚠ nenhum item extraído de "${PDF}". As demais asserções de parser`);
    console.log('     dependem da lista de referência (07/07/2026, 62 itens) e foram puladas.');
    itens = null;
  } else {
  ok(itens[0].num === '1' && /^PLP 230\/2025$/.test(itens[0].prop), `item 1 = PLP 230/2025 (obtido: "${itens[0].prop}")`);
  ok(itens[0].autoria === 'Juscelino Filho e Luisa Canziani', `autoria do item 1 (obtida: "${itens[0].autoria}")`);
  ok(/especifica\.$/.test(itens[0].descricao), 'descrição do item 1 completa');
  ok(itens[3].autoria === 'Julio Lopes e Paulo Abi-Ackel', `hífen entre fragmentos (obtido: "${itens[3].autoria}")`);
  ok(itens.every(i => /^\d{1,3}$/.test(i.num)), 'todo item tem número limpo (sem cabeçalho colado)');
  ok(itens.map(i => Number(i.num)).every((n, k) => n === k + 1), 'numeração 1..62 sem furos');

  const props = itens.flatMap(i => L.proposicoesDoItem(i));
  console.log(`  · ${props.length} proposições em ${itens.length} itens`);
  const it12 = L.proposicoesDoItem(itens[11]);
  ok(it12.length === 2 && it12[0].chave === 'PL 101/2026' && it12[1].chave === 'PL 23/2026',
     `item 12 rende as duas proposições (obtido: ${it12.map(p => p.chave).join(', ')})`);
  ok(it12[1].ehPrincipal === true && it12[0].ehPrincipal === false, 'a que está em "(Principal: …)" é marcada como principal');
  ok(props.every(p => p.ano >= 1990 && p.ano <= 2030), 'anos plausíveis');
  }

  }

  console.log('\n== Marcador da célula (o "- EMS" da lista) ==');
  ok(L.marcadorDoItem('PL 1242/2026-EMS') === 'EMS', `"PL 1242/2026-EMS" → EMS (obtido: "${L.marcadorDoItem('PL 1242/2026-EMS')}")`);
  ok(L.marcadorDoItem('PL 101/2026 (Principal: PL 23/2026)') === '', 'apensação não vira marcador (já tem campo próprio)');
  ok(L.marcadorDoItem('PLP 230/2025') === '', 'célula limpa não inventa marcador');

  console.log('\n== Invariantes estruturais em cada PDF fornecido ==');
  for (const arq of process.argv.slice(2)) {
    const nome = arq.split('/').pop().slice(0, 38);
    const its = await L.lerListaDoPDF({ arrayBuffer: async () => fs.readFileSync(arq).buffer });
    ok(its.length > 10, `${nome}: ${its.length} itens`);
    ok(its.map(i => Number(i.num)).every((n, k) => n === k + 1), `${nome}: numeração sem furos`);
    // A grade de colunas é detectada no documento; se ela escorregar, o regime
    // vaza para dentro da descrição sem erro nenhum aparecer.
    const vazou = its.filter(i => /^(Urg[êe]ncia|Priorid|Ordin[áa]rio|Especial|REQ\b)/i.test(i.descricao));
    ok(vazou.length === 0, `${nome}: regime não vaza para a descrição${vazou.length ? ' (itens ' + vazou.map(i => i.num).join(',') + ')' : ''}`);
    ok(its.every(i => i.prop.trim()), `${nome}: toda linha tem proposição`);
  }

  console.log('\n== Situação e relatoria (PLP 230/2025, contra a API real) ==');
  const id = (await (await fetch(`${API}/proposicoes?siglaTipo=PLP&numero=230&ano=2025&itens=1`)).json()).dados[0].id;
  const det = (await (await fetch(`${API}/proposicoes/${id}`)).json()).dados;
  const trams = await L.buscarTramitacoes(id);
  // O regime vindo do PDF é só um palpite de partida: quando a API traz
  // tramitação, ela prevalece — conferido passando '', o regime do PDF e um
  // regime contraditório, os três dando a MESMA situação. Por isso esta
  // seção vale mesmo sem PDF.
  const sit = L.situacaoDe(trams, itens ? itens[0].regime : '');
  ok(sit === 'Urgência aprovada (REQ. 2708/2026)', `situação = "${sit}"`);
  const rel = await L.relatoriaDe(trams, det.statusProposicao);
  ok(rel === 'Dep. Maria Rosas (Republicanos-SP)', `relatoria = "${rel}"`);
  // Este caso era um RETRATO: afirmava "zero despachos de distribuição". Em
  // 12/08/2026 o PLP 230/2025 recebeu um ("Às Comissões de Comunicação;
  // Finanças e Tributação…") e o teste quebrou — sem que nada no código
  // mudasse. Matéria em tramitação anda; congelar o estado dela num teste
  // fabrica falha futura. Agora vale a REGRA: o que a função devolve tem de
  // ser bem formado e conferir com a tramitação, quantos quer que sejam.
  const desp = L.despachosDeComissao(trams, det.statusProposicao);
  ok(Array.isArray(desp.distribuicao), `distribuição devolvida como lista (${desp.distribuicao.length} despacho(s))`);
  ok(desp.distribuicao.every(d => /^\d{4}-\d{2}-\d{2} — .+/.test(d)),
     'todo despacho traz data ISO e texto');
  ok(desp.distribuicao.every(d => /Comiss/i.test(d)),
     'todo despacho de distribuição menciona comissão — não é despacho de outra coisa');
  // E não inventa: cada despacho listado tem de existir na tramitação lida.
  const textosTram = trams.map(t => String(t.despacho || '').replace(/\s+/g, ''));
  ok(desp.distribuicao.every(d => {
    const corpo = d.replace(/^\d{4}-\d{2}-\d{2} — /, '').replace(/\s+/g, '');
    return textosTram.some(t => t.includes(corpo.slice(0, 40)));
  }), 'todo despacho listado existe na tramitação da API');

  console.log('\n== Regras de situação (casos sintéticos) ==');
  ok(L.situacaoDe([], 'REQ 3787/2025 (PL 3967/2025)') === 'Requerimento de urgência apresentado (REQ n. 3787/2025)',
     'sem API, o REQ do PDF vira "requerimento apresentado"');
  ok(L.situacaoDe([], 'Prioridade (Art. 151, II, RICD)') === 'Não há requerimento de urgência apresentado.',
     'regime de prioridade → sem requerimento de urgência');
  ok(L.situacaoDe([], 'Urgência aprovada em 16/06/2026') === 'Urgência aprovada em 16/06/2026',
     'sem API, vale o texto do PDF');
  ok(L.situacaoDe([{ despacho: 'Apresentação do REQ n. 900/2026 (Requerimento de Urgência (Art. 155 do RICD)), pelo Dep. X' }], '')
     === 'Requerimento de urgência apresentado (REQ n. 900/2026)', 'requerimento apresentado e não votado');

  ok(L.situacaoDe([], 'Ordinário (Art. 151, III, RICD) (Urgência aprovada em 26/05/2026)') === 'Urgência aprovada em 26/05/2026',
     'célula mista → só o trecho de urgência');
  ok(/sem requerimento de urg[êe]ncia localizado/.test(L.situacaoDe([], 'Urgência')),
     'lista diz "Urgência" e a API não tem nada → contradição declarada, não negada');

  console.log('\n== Relatoria: relator de comissão não é relatoria de Plenário ==');
  const relCom = await L.relatoriaDe(
    [{ siglaOrgao: 'CCJC', descricaoTramitacao: 'Designação de Relator(a)', despacho: 'Designado Relator, Dep. Fulano (PT-SP).' }], null);
  ok(relCom === 'Sem indicação', `designação em comissão → "${relCom}"`);

  console.log('\n== Parecer proferido em Plenário ==');
  // O PL 2465/2026 teve parecer com substitutivo em 07/07/2026 — a data da
  // própria lista. É o caso que mostra por que o resumo não pode se apoiar só
  // no texto apresentado.
  const idPP = (await (await fetch(`${API}/proposicoes?siglaTipo=PL&numero=2465&ano=2026&itens=1`)).json()).dados[0].id;
  const relPP = await L.buscarDocumentosRelacionados(idPP, 'PL');
  const pp = L.parecerPlenarioDe(relPP);
  ok(!!pp, 'parecer de Plenário localizado');
  ok(pp?.data === '2026-07-07', `data do parecer (obtida: ${pp?.data})`);
  ok(!!pp?.substitutivo?.url, 'substitutivo adotado tem inteiro teor');
  ok(/Antonio Brito/.test(pp?.relator || ''), `relator do parecer (obtido: "${pp?.relator}")`);
  ok(!!pp?.merito, 'parecer de mérito identificado entre os do dia');
  ok(L.fraseDoParecer(pp) === 'Parecer proferido em Plenário em 07/07/2026, pelo relator Dep. Antonio Brito (PSD-BA), com substitutivo adotado.',
     `frase factual do parecer (obtida: "${L.fraseDoParecer(pp)}")`);
  ok(L.fraseDoParecer(null) === 'Sem parecer proferido em Plenário.', 'sem parecer → frase própria');

  // Parecer de COMISSÃO não pode ser confundido com parecer de Plenário.
  const idCom = (await (await fetch(`${API}/proposicoes?siglaTipo=PL&numero=3052&ano=2023&itens=1`)).json()).dados[0].id;
  const docsCom = await L.buscarDocumentosRelacionados(idCom, 'PL');
  const semPP = L.parecerPlenarioDe(docsCom);
  ok(semPP === null, `PL 3052/2023 tem PRL e SBT de comissão, e nenhum de Plenário (obtido: ${semPP ? 'parecer' : 'null'})`);
  ok(L.cenarioDe({ sigla: 'PL' }, docsCom) === 2, `PL 3052/2023 → cenário 2, substitutivo de comissão (obtido: ${L.cenarioDe({ sigla: 'PL' }, docsCom)})`);
  ok(L.cenarioDe({ sigla: 'PL' }, relPP) === 4, `PL 2465/2026 → cenário 4, parecer de plenário na forma do substitutivo (obtido: ${L.cenarioDe({ sigla: 'PL' }, relPP)})`);

  console.log('\n== Retorno do Senado (itens marcados "- EMS" na lista) ==');
  const idEMS = (await (await fetch(`${API}/proposicoes?siglaTipo=PL&numero=6003&ano=2019&itens=1`)).json()).dados[0].id;
  const relEMS = await L.buscarDocumentosRelacionados(idEMS, 'PL');
  const es = L.emendaSenadoDe(relEMS);
  ok(!!es, 'emenda do Senado localizada');
  ok(es?.ems?.data === '2019-11-12', `data do EMS (obtida: ${es?.ems?.data})`);
  // O parecer da Câmara às emendas do Senado tem de ser POSTERIOR a elas.
  ok(es?.parecerPos?.data === '2024-03-20', `parecer POSTERIOR ao EMS (obtido: ${es?.parecerPos?.data})`);
  const cen = L.cenarioDe({ sigla: 'PL' }, relEMS);
  ok(cen === 7, `PL 6003/2019 → cenário 7, retorno do Senado com parecer da Câmara (obtido: ${cen})`);
  const saiu = L.textoQueSaiuDaCamara(es);
  ok(!!saiu?.doc?.url, `texto que saiu da Câmara tem inteiro teor (${saiu?.doc?.tipo})`);
  ok((saiu?.doc?.data || '') <= es.ems.data, 'o texto que saiu é ANTERIOR à emenda do Senado');
  ok(L.emendaSenadoDe(relPP) === null, 'proposição que não foi ao Senado não inventa emenda');

  console.log('\n== Principal × apensado, e de quem é a urgência ==');
  ok(JSON.stringify(L.propsCitadas('Projeto de Lei nº 2.338, de 2023 e o PL 641/2020')) === JSON.stringify(['PL 641/2020', 'PL 2338/2023']),
     `citações nas duas grafias (obtido: ${JSON.stringify(L.propsCitadas('Projeto de Lei nº 2.338, de 2023 e o PL 641/2020'))})`);

  // PL 101/2026 é APENSADO ao PL 23/2026, e o REQ 1258/2026 pede urgência para
  // ELE (o apensado) — o caso que mostra por que a coluna existe.
  const idAp = (await (await fetch(`${API}/proposicoes?siglaTipo=PL&numero=101&ano=2026&itens=1`)).json()).dados[0].id;
  const detAp = (await (await fetch(`${API}/proposicoes/${idAp}`)).json()).dados;
  const trAp = await L.buscarTramitacoes(idAp);
  const papelAp = await L.papelDe(detAp, trAp);
  ok(papelAp.apensada === true && papelAp.principal === 'PL 23/2026',
     `PL 101/2026 apensado ao PL 23/2026 (obtido: ${JSON.stringify(papelAp)})`);
  const itAp = { chave: 'PL 101/2026', situacao: 'Urgência aprovada (REQ. 1258/2026)', regimePdf: '', papel: papelAp };
  const reqAp = await L.alvoDoREQ(itAp);
  ok(L.fraseUrgenciaREQ(itAp, reqAp) === 'REQ 1258/2026 refere-se a este projeto (o apensado).',
     `urgência do apensado (obtido: "${L.fraseUrgenciaREQ(itAp, reqAp)}")`);

  // O principal PL 23/2026 tem apensados e o mesmo REQ refere-se ao OUTRO.
  const idPr = (await (await fetch(`${API}/proposicoes?siglaTipo=PL&numero=23&ano=2026&itens=1`)).json()).dados[0].id;
  const detPr = (await (await fetch(`${API}/proposicoes/${idPr}`)).json()).dados;
  const papelPr = await L.papelDe(detPr, await L.buscarTramitacoes(idPr));
  ok(papelPr.apensada === false && papelPr.temApensados === true,
     `PL 23/2026 é principal com apensados (obtido: ${JSON.stringify(papelPr)})`);
  ok(L.frasePapel({ papel: papelPr }) === 'Principal (com apensados).', 'frase do principal');
  const itPr = { chave: 'PL 23/2026', situacao: 'Urgência aprovada (REQ. 1258/2026)', regimePdf: '', papel: papelPr };
  ok(L.fraseUrgenciaREQ(itPr, await L.alvoDoREQ(itPr)) === 'REQ 1258/2026 refere-se ao PL 101/2026.',
     'no principal, o mesmo REQ aponta para o apensado');

  // Anotação da própria lista dispensa a API.
  const itAn = { chave: 'PL 2338/2023', situacao: 'Requerimento de urgência apresentado (REQ n. 3787/2025)',
                 regimePdf: 'REQ 3787/2025 (PL 3967/2025)', papel: { apensada: false } };
  const reqAn = await L.alvoDoREQ(itAn);
  ok(L.fraseUrgenciaREQ(itAn, reqAn) === 'REQ 3787/2025 refere-se ao PL 3967/2025.',
     `anotação da lista vale como fonte (obtido: "${L.fraseUrgenciaREQ(itAn, reqAn)}")`);

  // Divergência lista × Dados Abertos aparece, não some.
  ok(/a lista indica PL 4194\/2019 como principal/.test(
       L.frasePapel({ papel: { apensada: true, principal: 'PL 2217/2019' }, celulaProp: 'PL 4315/2023 (Principal: PL 4194/2019)' })),
     'principal divergente entre a lista e a API é declarado');

  console.log('\n== Autoria e relatoria do Podemos ==');
  ok(L.ehRelatorPodemos('Dep. Exemplo Sintético (PODE-MG)') === true, 'relatoria PODE detectada');
  ok(L.ehRelatorPodemos('Dep. Maria Rosas (Republicanos-SP)') === false, 'outros partidos não marcam');
  ok(L.ehRelatorPodemos('Dep. Fulano (Podemos-MG)') === true, 'grafia "Podemos" por extenso também marca');
  ok(L.ehRelatorPodemos('Sem indicação') === false, 'sem relatoria não marca');
  // PLP 230/2025: autores Juscelino Filho e Luisa Canziani — nenhum do Podemos.
  const idAut = (await (await fetch(`${API}/proposicoes?siglaTipo=PLP&numero=230&ano=2025&itens=1`)).json()).dados[0].id;
  const auts = await L.autoresDetalhados(idAut);
  ok(auts.length >= 2 && auts.every(a => typeof a.isPodemos === 'boolean'),
     `autores com partido resolvido (${auts.map(a => a.nome).join(', ')})`);
  ok(auts.every(a => !a.isPodemos), 'PLP 230/2025 sem autoria Podemos');

  // Varredura de apensados: PL 23/2026 tem o PL 101/2026 apensado DIRETO.
  // O achado depende do partido real do autor — o teste confere a coerência:
  // se o autor do apensado é do Podemos, a varredura tem de achá-lo.
  const idPr23 = (await (await fetch(`${API}/proposicoes?siglaTipo=PL&numero=23&ano=2026&itens=1`)).json()).dados[0].id;
  const ap = await L.apensadosDoPodemos(idPr23);
  ok(Array.isArray(ap.achados) && typeof ap.truncado === 'boolean', 'varredura devolve forma esperada');
  const id101 = (await (await fetch(`${API}/proposicoes?siglaTipo=PL&numero=101&ano=2026&itens=1`)).json()).dados[0].id;
  const auts101 = await L.autoresDetalhados(id101);
  const temPode101 = auts101.some(a => a.isPodemos);
  ok(ap.achados.some(a => a.chave === 'PL 101/2026') === temPode101,
     `coerência: autor do PL 101/2026 ${temPode101 ? 'é' : 'não é'} Podemos e a varredura ${temPode101 ? 'achou' : 'não listou'} (achados: ${JSON.stringify(ap.achados)})`);

  console.log('\n== Conferência de citações ==');
  // A conferência exige uma fonte com corpo: abaixo de 100 caracteres ela se
  // cala, porque extração vazia marcaria tudo como suspeito.
  const fonteFalsa = 'Projeto de lei que altera a Lei nº 9.998, de 17 de agosto de 2000, '
    + 'para dispor sobre o Fundo de Universalização dos Serviços de Telecomunicações e dá outras providências.';
  ok(L.validarReferencias('Altera a Lei nº 9.998, de 2000.', fonteFalsa).length === 0,
     'lei citada que existe na fonte não é marcada');
  const sus = L.validarReferencias('Altera a Lei nº 12.345, de 2011.', fonteFalsa);
  ok(sus.length === 1, `lei citada que NÃO existe na fonte é marcada (obtido: ${JSON.stringify(sus)})`);
  ok(L.validarReferencias('Altera a Lei nº 12.345.', 'curto demais').length === 0,
     'fonte curta demais → conferência se cala em vez de marcar tudo');

  console.log('\n== Extração de JSON da resposta da IA ==');
  ok(L.extrairJSON('```json\n{"objetivo":"a"}\n```').objetivo === 'a', 'JSON entre cercas');
  ok(L.extrairJSON('Segue:\n{"objetivo":"b"}\nAbraço').objetivo === 'b', 'JSON com texto em volta');
  ok(L.formatarPartido('REPUBLICANOS') === 'Republicanos' && L.formatarPartido('PSD') === 'PSD', 'partido formatado');

  console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTudo passou.\n');
  process.exit(falhas ? 1 : 0);
})();
