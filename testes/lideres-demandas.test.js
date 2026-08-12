// Testes dos sistemas 2 (Demandas de Deputados) e 3 (E-mail de Demandas) do
// módulo Reunião de Líderes.
//
// Mesmo sandbox de lideres.test.js: o arquivo do navegador é carregado com
// stubs e só as funções puras/factuais são exercitadas. O formato do e-mail é
// conferido CARACTERE A CARACTERE contra o padrão de registro dado pela
// Liderança; a parte factual roda contra a API real da Câmara com o exemplo
// real do padrão (PLP 78/2025 → "Bacelar PV/BA").
//
// Uso: node testes/lideres-demandas.test.js
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'lideres.js'), 'utf8');
const sandbox = {
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {} },
  window: {},
  fetch: globalThis.fetch,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  console,
  setTimeout, clearTimeout,
  DOMException: globalThis.DOMException,
  XLSX: undefined,
};
const exportar = ['refDemanda', 'blocoDemandaEmail', 'montarEmailDemandas',
                  'fatosDaDemanda', 'autoriaDemanda', 'situacaoDe', 'grupoDemanda',
                  'autoriaSemPartido', 'liderDoPodemos', 'mailtoDoEmail', 'historicoEmListas',
                  'separarDemandasRelatorio', '_htmlRelatorioDemandas'];
const fn = new Function(...Object.keys(sandbox), `${fonte}\n; return { ${exportar.join(', ')} };`);
const L = fn(...Object.values(sandbox));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== refDemanda ==');
  ok(L.refDemanda('PLP 78/2025').chave === 'PLP 78/2025', 'forma canônica');
  ok(L.refDemanda('plp78/25').chave === 'PLP 78/2025', 'minúscula, sem espaço, ano curto');
  ok(L.refDemanda('o PL 4822 2025 por favor').chave === 'PL 4822/2025', 'no meio de frase, com espaço');
  ok(L.refDemanda('bom dia') === null, 'texto sem referência → null');
  ok(L.refDemanda('RCP 2/2026').chave === 'RCP 2/2026', 'RCP (criação de CPI) é aceito');
  ok(L.refDemanda('req 2778/2026').chave === 'REQ 2778/2026', 'REQ é aceito');

  console.log('\n== autoriaSemPartido: no e-mail, autoria só com o nome ==');
  ok(L.autoriaSemPartido('Bacelar PV/BA') === 'Bacelar', '"Bacelar PV/BA" → "Bacelar"');
  ok(L.autoriaSemPartido('David Soares UNIÃO/SP e outros') === 'David Soares e outros', 'sigla com acento + "e outros"');
  ok(L.autoriaSemPartido('Poder Executivo') === 'Poder Executivo', 'autor que não é deputado fica intacto');
  ok(L.autoriaSemPartido('Romero Rodrigues PODE/PB') === 'Romero Rodrigues', 'padrão do registro vira o do e-mail');

  console.log('\n== montarEmailDemandas: o MODELO da Liderança, caractere a caractere ==');
  // As duas demandas do modelo dado em 11/08/2026 — o e-mail tem de sair idêntico.
  const dA = {
    tratamento: 'Deputado', deputado: 'Qualquer Demandante',
    chave: 'PL 3932/2024', natureza: 'Solicitar inclusão em pauta',
    autoria: 'Romero Rodrigues PODE/PB',
    ementa: 'Institui a Política Nacional de Conscientização e Combate ao Vício Tecnológico em crianças e adolescentes e altera a Lei nº 14.790, de 29 de dezembro de 2023, a fim de prever medidas adicionais de combate à participação de menores de 18 (dezoito) anos na condição de apostador em apostas de quota fixa.',
    situacao: 'Urgência aprovada',
  };
  const dB = {
    tratamento: 'Deputada', deputado: 'Outra Demandante',
    chave: 'PL 3052/2023', natureza: 'Solicitar relatoria',
    autoria: 'Renata Abreu PODE/SP',
    ementa: 'Proclama São Vicente a Capital Simbólica do Brasil.',
    situacao: 'Urgência aprovada',
  };
  const esperado =
    'Senhor Presidente,\n' +
    '\n' +
    'Cumprimentando-o, remeto a lista de proposições prioritárias para a bancada do PODEMOS\n' +
    '\n' +
    '•\tPL 3932/2024\n' +
    'Autoria: Romero Rodrigues\n' +
    'Ementa: Institui a Política Nacional de Conscientização e Combate ao Vício Tecnológico em crianças e adolescentes e altera a Lei nº 14.790, de 29 de dezembro de 2023, a fim de prever medidas adicionais de combate à participação de menores de 18 (dezoito) anos na condição de apostador em apostas de quota fixa.\n' +
    'Situação: Urgência aprovada.\n' +
    '\n' +
    '•\tPL 3052/2023\n' +
    'Autoria: Renata Abreu\n' +
    'Ementa: Proclama São Vicente a Capital Simbólica do Brasil.\n' +
    'Situação: Urgência aprovada.\n' +
    '\n' +
    'Respeitosamente,\n' +
    '\n' +
    'Deputado Rodrigo Gambale\n' +
    'Líder do PODEMOS';
  const email = L.montarEmailDemandas([dA, dB], 'Deputado Rodrigo Gambale\nLíder do PODEMOS');
  ok(email === esperado, 'e-mail idêntico ao modelo, caractere a caractere');
  ok(!email.includes('Natureza da demanda'), 'natureza (registro interno) NÃO vai no e-mail');
  ok(!email.includes('Demandante'), 'deputado demandante (registro interno) NÃO vai no e-mail');
  ok(L.montarEmailDemandas([dA]).includes('<Líder do PODEMOS>'), 'sem assinatura da API, fica o marcador — nunca nome errado');
  const jaComPonto = { ...dA, situacao: 'Urgência aprovada (REQ. 2708/2026).' };
  ok(!/\.\.$/m.test(L.blocoDemandaEmail(jaComPonto)), 'situação que já termina em ponto não ganha outro');

  console.log('\n== historicoEmListas: a demanda entrou em lista do sistema 1? ==');
  const reunioes = [
    { id: 'r1', titulo: 'Lista de 07/07/2026', criada: '2026-07-07T10:00:00Z',
      itens: [{ chave: 'PLP 78/2025', numItem: '3' }, { chave: 'PL 23/2026', numItem: '12' }] },
    { id: 'r2', titulo: 'Lista de 11/08/2026', criada: '2026-08-11T10:00:00Z',
      itens: [{ chave: 'PLP 78/2025', numItem: '7' }, { chave: 'PL 101/2026', numItem: '12' }] },
  ];
  const h1 = L.historicoEmListas('PLP 78/2025', reunioes);
  ok(h1.length === 2, 'acha as duas listas em que a proposição esteve');
  ok(h1[0].titulo === 'Lista de 11/08/2026' && h1[0].numItem === '7', 'mais recente primeiro, com o nº do item');
  ok(L.historicoEmListas('RCP 2/2026', reunioes).length === 0, 'proposição que nunca entrou → lista vazia');
  ok(L.historicoEmListas('PL 101/2026', reunioes).length === 1, 'apensado que virou item próprio também conta');
  ok(L.historicoEmListas('PLP 78/2025', null) === null, 'reuniões ainda não carregadas → null (não "nunca entrou")');

  console.log('\n== relatório de demandas (abertas × atendidas) ==');
  const dAberta = { id: 'x1', tratamento: 'Deputado', deputado: 'Bruno Lima', chave: 'RCP 2/2026',
    natureza: 'Solicitar despacho do Presidente', autoria: 'Delegado Bruno Lima PODE/SP e outros',
    ementa: 'Cria CPI.', situacao: 'Aguardando Despacho do Presidente da Câmara dos Deputados',
    registradaEm: '2026-08-11T10:00:00Z', atendimento: null };
  const dAtendida = { id: 'x2', tratamento: 'Deputada', deputado: 'Renata Abreu', chave: 'PL 3052/2023',
    natureza: 'Solicitar inclusão em pauta', autoria: 'Renata Abreu PODE/SP',
    ementa: 'Capital simbólica.', situacao: 'Urgência aprovada',
    registradaEm: '2026-07-01T10:00:00Z',
    atendimento: { reuniaoId: 'r2', rotulo: 'Lista de 11/08/2026', em: '2026-08-11T18:00:00Z' } };
  const sep = L.separarDemandasRelatorio([dAberta, dAtendida]);
  ok(sep.abertas.length === 1 && sep.abertas[0].id === 'x1', 'separa as em aberto');
  ok(sep.atendidas.length === 1 && sep.atendidas[0].id === 'x2', 'separa as atendidas');
  ok(L.separarDemandasRelatorio([]).abertas.length === 0, 'lista vazia não quebra');

  const reunioesRel = [{ id: 'r2', titulo: 'Lista de 11/08/2026', criada: '2026-08-11',
    itens: [{ chave: 'PL 3052/2023', numItem: '9' }] }];
  const htmlRel = L._htmlRelatorioDemandas([dAberta, dAtendida], null, reunioesRel);
  ok(htmlRel.includes('Em aberto (1)') && htmlRel.includes('Atendidas (1)'), 'seções com contagem');
  ok(htmlRel.indexOf('Em aberto') < htmlRel.indexOf('Atendidas'), 'em aberto vem primeiro (é o que cobra ação)');
  ok(htmlRel.includes('RCP 2/2026 — Solicitar despacho do Presidente'), 'demanda aberta com natureza');
  ok(htmlRel.includes('✔ Atendida — Lista de 11/08/2026'), 'atendida nomeia a reunião');
  ok(htmlRel.includes('Lista de 11/08/2026 (item 9)'), 'histórico de listas entra no relatório');
  ok(htmlRel.includes('Demandante: Deputado Bruno Lima'), 'demandante identificado');
  ok(htmlRel.includes('1 em aberto · 1 atendida(s)'), 'meta com o placar');

  console.log('\n== mailtoDoEmail: abrir no Outlook ==');
  const curto = L.mailtoDoEmail('Senhor Presidente,\n\nLinha dois.');
  ok(curto.cabe && curto.url.startsWith('mailto:?subject='), 'corpo curto cabe na URL do mailto');
  ok(curto.url.includes('%0D%0A'), 'quebras de linha como %0D%0A (RFC 6068)');
  ok(!L.mailtoDoEmail('x'.repeat(4000)).cabe, 'corpo longo é detectado — vai pela área de transferência');
  ok(L.mailtoDoEmail(email).cabe === (L.mailtoDoEmail(email).url.length <= 1900),
     `o e-mail do modelo ${L.mailtoDoEmail(email).cabe ? 'cabe' : 'não cabe'} no mailto (${L.mailtoDoEmail(email).url.length} chars)`);

  console.log('\n== liderDoPodemos (API real) ==');
  const lider = await L.liderDoPodemos();
  console.log(`  · líder pela API: ${lider.assinatura.replace('\n', ' — ')}`);
  ok(lider.nome && lider.nome.length > 3, `nome do líder veio da API ("${lider.nome}")`);
  ok(['Deputado', 'Deputada', 'Deputado(a)'].includes(lider.tratamento), `tratamento derivado da ficha (${lider.tratamento})`);
  ok(lider.assinatura === `${lider.tratamento} ${lider.nome}\nLíder do PODEMOS`, 'assinatura no formato do fecho');

  console.log('\n== camada factual (API real — o exemplo do padrão) ==');
  const t0 = Date.now();
  const ref = L.refDemanda('PLP 78/2025');
  const fatos = await L.fatosDaDemanda(ref);
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  ok(Number.isInteger(fatos.idCamara), `idCamara resolvido (${fatos.idCamara})`);
  ok(/locação para temporada/i.test(fatos.ementa), 'ementa é a do PLP 78/2025');
  ok(/^Bacelar PV\/BA/.test(fatos.autoria), `autoria no padrão "Bacelar PV/BA" (obtida: "${fatos.autoria}")`);
  // A situação evolui com a tramitação — o que se garante é a FORMA: uma das
  // três frases fixas de situacaoDe (a do exemplo era o REQ 2778/2026).
  ok(/^(Urgência aprovada|Requerimento de urgência apresentado \(REQ n\. \d+\/\d{4}\)|Não há requerimento|Urgência indicada na lista)/.test(fatos.situacao),
     `situação numa das formas fixas (obtida: "${fatos.situacao}")`);

  const inexistente = await L.fatosDaDemanda(L.refDemanda('PL 999999/2026')).then(() => null, e => e.message);
  ok(/não localizada/.test(inexistente || ''), 'proposição inexistente dá erro claro, não registro vazio');

  console.log('\n== RCP 2/2026 (caso real: despacho do Presidente) ==');
  const rcp = await L.fatosDaDemanda(L.refDemanda('RCP 2/2026'));
  ok(rcp.idCamara === 2617166, `RCP resolvido na API (${rcp.idCamara})`);
  ok(/Comissão Parlamentar de Inquérito/i.test(rcp.ementa), 'ementa é a do RCP (criação de CPI)');
  ok(rcp.autoria && rcp.autoria.length > 3, `autoria veio (${rcp.autoria})`);
  // Sem sinal de urgência, a situação cai na OFICIAL da ficha — que é o fato
  // que interessa ("Aguardando Despacho…"), não "não há requerimento".
  ok(!/^Não há requerimento/.test(rcp.situacao), `situação não é o vazio da urgência (obtida: "${rcp.situacao}")`);

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
