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
                  'separarDemandasRelatorio', '_htmlRelatorioDemandas',
                  'tramiteDemanda', 'linhasTramite', 'situacaoDemanda', 'camposTramiteHTML'];
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

  console.log('\n== tramiteDemanda: regime, relator e parecer (tramitações reais, congeladas) ==');
  // Trechos das tramitações reais da API (ordem ascendente, como ela devolve).
  const T = (dataHora, siglaOrgao, codTipoTramitacao, descricaoTramitacao, despacho) =>
    ({ dataHora: dataHora + 'T10:00', siglaOrgao, codTipoTramitacao, descricaoTramitacao, despacho });
  // PL 5839/2025 em 13/10/2026: relator designado na CME, sem parecer.
  const tr5839 = L.tramiteDemanda(
    { regime: 'Ordinário (Art. 151, III, RICD)', siglaOrgao: 'CME', descricaoSituacao: 'Aguardando Parecer' }, [
      T('2025-11-13', 'MESA', '100', 'Apresentação de Proposição', 'Apresentação do PL n. 5839/2025'),
      T('2025-11-14', 'MESA', '110', 'Distribuição', 'Às Comissões de Minas e Energia; Finanças e Tributação'),
      T('2025-11-18', 'CME', '500', 'Recebimento', 'Recebimento pela CME.'),
      T('2026-03-11', 'CME', '320', 'Designação de Relator(a)', 'Designado Relator, Dep. Adriano do Baldy (PP-GO).'),
      T('2026-03-24', 'CME', '600', 'Encerramento de Prazo', 'Encerrado o prazo de 5 sessões.'),
    ]);
  const l5839 = L.linhasTramite(tr5839);
  ok(l5839.regime === 'Ordinário (Art. 151, III, RICD)', 'regime vem da ficha');
  ok(l5839.relator === 'Dep. Adriano do Baldy (PP-GO), na CME, desde 11/03/2026', `relator da comissão atual (${l5839.relator})`);
  ok(l5839.parecer === 'não apresentado na CME', `sem parecer (${l5839.parecer})`);
  ok(l5839.anteriores === '', 'sem comissões anteriores');

  // PLP 78/2025: a ficha diz MESA (último ato foi um REQ), mas o projeto está
  // na CTUR, cujo relator saiu; a CDU já aprovou parecer pela rejeição.
  const tr78 = L.tramiteDemanda(
    { regime: 'Prioridade (Art. 151, II, RICD)', siglaOrgao: 'MESA' }, [
      T('2025-06-09', 'CDU', '500', 'Recebimento', 'Recebimento pela CDU.'),
      T('2025-07-09', 'CDU', '320', 'Designação de Relator(a)', 'Designado Relator, Dep. Icaro de Valmir (PL-SE).'),
      T('2025-11-12', 'CDU', '322', 'Parecer do(a) Relator(a)', 'Parecer do Relator, Dep. Icaro de Valmir (PL-SE), pela rejeição.'),
      T('2025-11-26', 'CDU', '336', 'Aprovação do Parecer', 'Aprovado o Parecer.'),
      T('2025-11-27', 'CCP', '604', 'Publicação de Proposição', 'Parecer recebido para publicação.'),
      T('2025-11-27', 'CTUR', '500', 'Recebimento', 'Recebimento pelo(a) CTUR.'),
      T('2025-12-02', 'CTUR', '320', 'Designação de Relator(a)', 'Designado Relator, Dep. Vermelho (PP-PR).'),
      T('2026-04-22', 'CTUR', '1250', 'Saída de Relator(a) da Comissão - Sem Parecer', 'O Relator, Dep. Vermelho, deixou de ser membro da Comissão'),
      T('2026-05-08', 'CTUR', '507', 'Recebimento - Relator(a) (Sem Manifestação)', 'Devolvida pelo Relator sem Manifestação.'),
      T('2026-05-12', 'MESA', '194', 'Apresentação de Requerimento', 'Apresentação do REQ n. 2778/2026 (Requerimento de Urgência (Art. 155 do RICD))'),
    ]);
  const l78 = L.linhasTramite(tr78);
  ok(tr78.orgao === 'CTUR', `comissão atual é a CTUR, não a MESA da ficha (${tr78.orgao})`);
  ok(l78.relator === 'não designado na CTUR — Dep. Vermelho (PP-PR) deixou a relatoria em 22/04/2026', `relator que saiu não conta (${l78.relator})`);
  ok(l78.parecer === 'não apresentado na CTUR', 'parecer da CDU não passa por parecer da CTUR');
  ok(l78.anteriores === 'CDU: aprovado em 26/11/2025 (pela rejeição)', `parecer da comissão anterior (${l78.anteriores})`);

  // PL 3052/2023: relator com ponto no nome, parecer aprovado na CCJC na forma
  // do substitutivo de outra comissão; CCULT antes, com relatores que saíram.
  const tr3052 = L.tramiteDemanda({ regime: 'Urgência', siglaOrgao: 'CCP' }, [
    T('2023-08-04', 'CCULT', '500', 'Recebimento', 'Recebimento pela CCULT.'),
    T('2023-08-24', 'CCULT', '320', 'Designação de Relator(a)', 'Designado Relator, Dep. Jeferson Rodrigues (REPUBLIC-GO)'),
    T('2023-12-12', 'CCULT', '1250', 'Saída de Relator(a) da Comissão - Sem Parecer', 'O Relator, Dep. Jeferson Rodrigues, deixou de ser membro da Comissão'),
    T('2024-08-14', 'CCULT', '320', 'Designação de Relator(a)', 'Designado Relator, Dep. Douglas Viegas (UNIÃO-SP)'),
    T('2025-05-26', 'CCULT', '322', 'Parecer do(a) Relator(a)', 'Parecer do Relator, Dep. Douglas Viegas (UNIÃO-SP), pela aprovação, com substitutivo.'),
    T('2025-05-28', 'CCULT', '336', 'Aprovação do Parecer', 'Aprovado o Parecer.'),
    T('2025-06-12', 'CCJC', '500', 'Recebimento', 'Recebimento pela CCJC.'),
    T('2025-11-03', 'CCJC', '320', 'Designação de Relator(a)', 'Designado Relator, Dep. Dr. Victor Linhalis (PODE-ES).'),
    T('2025-11-18', 'CCJC', '322', 'Parecer do(a) Relator(a)', 'Parecer do Relator, Dep. Dr. Victor Linhalis (PODE-ES), pela constitucionalidade, juridicidade, técnica legislativa e, no mérito, pela aprovação deste, na forma do Substitutivo da Comissão de Cultura.'),
    T('2025-11-26', 'CCJC', '336', 'Aprovação do Parecer', 'Aprovado o Parecer.'),
    T('2025-11-27', 'CCP', '604', 'Publicação de Proposição', 'Encaminhada à publicação.'),
  ]);
  const l3052 = L.linhasTramite(tr3052);
  ok(l3052.relator === 'Dep. Dr. Victor Linhalis (PODE-ES), na CCJC, desde 03/11/2025', `nome com ponto inteiro (${l3052.relator})`);
  ok(l3052.parecer === 'apresentado em 18/11/2025 (pela aprovação, na forma do substitutivo da Comissão de Cultura); aprovado na comissão em 26/11/2025',
     `conclusão de mérito e aprovação (${l3052.parecer})`);
  ok(l3052.anteriores === 'CCULT: aprovado em 28/05/2025 (pela aprovação, com substitutivo)', `CCULT anterior (${l3052.anteriores})`);

  // PL 3932/2024: urgência aprovada direto no Plenário, nenhum relator.
  const l3932 = L.linhasTramite(L.tramiteDemanda({ regime: 'Urgência (Art. 155, RICD)', siglaOrgao: 'PLEN' }, [
    T('2024-11-04', 'PLEN', '196', 'Aprovação de Urgência (154, 155 ou 64 CF)', 'Aprovado o requerimento nº 4402/2024'),
  ]));
  ok(l3932.relator === 'não designado no Plenário' && l3932.parecer === 'não apresentado no Plenário',
     `sem relator nem parecer no Plenário (${l3932.relator} / ${l3932.parecer})`);

  // Parecer de relator que já saiu, ainda não votado, diz de quem é.
  const lSaiu = L.linhasTramite(L.tramiteDemanda({ siglaOrgao: 'CFT' }, [
    T('2026-01-10', 'CFT', '500', 'Recebimento', 'Recebimento pela CFT.'),
    T('2026-02-01', 'CFT', '320', 'Designação de Relator(a)', 'Designada Relatora, Dep. Ana Silva (PODE-SP).'),
    T('2026-03-01', 'CFT', '322', 'Parecer do(a) Relator(a)', 'Parecer da Relatora, Dep. Ana Silva (PODE-SP), pela aprovação.'),
    T('2026-04-01', 'CFT', '1255', 'Saída de Relator(a) da Comissão - Com Parecer', 'A Relatora, Dep. Ana Silva, deixou de ser membro da Comissão'),
    T('2026-05-01', 'CFT', '320', 'Designação de Relator(a)', 'Designado Relator, Dep. João Souza (PSD-MG).'),
  ]));
  ok(lSaiu.relator === 'Dep. João Souza (PSD-MG), na CFT, desde 01/05/2026', 'novo relator é o atual');
  ok(lSaiu.parecer === 'apresentado em 01/03/2026 pela Dep. Ana Silva (PODE-SP) (pela aprovação); ainda não votado na comissão',
     `parecer do relator anterior leva o nome (${lSaiu.parecer})`);
  const lRegimeVazio = L.linhasTramite(L.tramiteDemanda(null, []));
  ok(lRegimeVazio.regime === 'não informado' && lRegimeVazio.relator === 'não designado', 'sem ficha nem tramitação não quebra');
  ok(L.linhasTramite(undefined) === null, 'demanda antiga (sem tramite) → null');
  ok(L.camposTramiteHTML(undefined, 'x') === '', 'demanda antiga não ganha linhas vazias no cartão/PDF');
  ok(/Pareceres anteriores: CDU/.test(L.camposTramiteHTML(tr78, 'dem-l', false)), 'PDF/cartão trazem os pareceres anteriores');
  // Firebase devolve sem null nem lista vazia: campos ausentes são "não há".
  const doFirebase = JSON.parse(JSON.stringify({ ...tr5839, parecer: undefined, anteriores: undefined, relatorSaiu: undefined }));
  ok(JSON.stringify(L.linhasTramite(doFirebase)) === JSON.stringify(l5839), 'campos que o Firebase omite não mudam as linhas');

  console.log('\n== situacaoDemanda: a mesma regra no registro e no ↻ ==');
  ok(L.situacaoDemanda([], { descricaoSituacao: 'Aguardando Parecer' }) === 'Aguardando Parecer', 'sem urgência → situação oficial da ficha');
  ok(L.situacaoDemanda([], null) === 'Não há requerimento de urgência apresentado.', 'sem ficha → frase fixa');
  ok(L.situacaoDemanda([T('2024-11-04', 'PLEN', '196', 'Aprovação de Urgência (154, 155 ou 64 CF)', 'Aprovado o requerimento nº 4402/2024, que solicita urgência')],
     { descricaoSituacao: 'Pronta para Pauta' }) === 'Urgência aprovada (REQ. 4402/2024)', 'urgência manda sobre a ficha');

  console.log('\n== e-mail com regime, relator e parecer ==');
  const blocoTr = L.blocoDemandaEmail({ ...dA, tramite: tr78 });
  ok(blocoTr === [
    '•\tPL 3932/2024', 'Autoria: Romero Rodrigues', `Ementa: ${dA.ementa}`, 'Situação: Urgência aprovada.',
    'Regime de tramitação: Prioridade (Art. 151, II, RICD).',
    'Relator: não designado na CTUR — Dep. Vermelho (PP-PR) deixou a relatoria em 22/04/2026.',
    'Parecer: não apresentado na CTUR.',
    'Pareceres anteriores: CDU: aprovado em 26/11/2025 (pela rejeição).'].join('\n'),
    'bloco ganha as linhas depois da situação, com ponto final');
  ok(!L.blocoDemandaEmail({ ...dA, tramite: tr5839 }).includes('Pareceres anteriores'), 'sem comissão anterior, sem a linha');

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
  // Uma terceira demanda do MESMO deputado, atendida — para testar as
  // subseções dentro do grupo.
  const dBruno2 = { ...dAberta, id: 'x3', chave: 'PL 500/2026', natureza: 'Apoiar a aprovação',
    atendimento: { reuniaoId: null, rotulo: 'Acordo em plenário', em: '2026-08-01T10:00:00Z' } };
  const htmlRel = L._htmlRelatorioDemandas([dAberta, dAtendida, dBruno2], null, reunioesRel);
  ok(htmlRel.includes('Deputado Bruno Lima') && htmlRel.includes('Deputada Renata Abreu'),
     'seção própria por deputado');
  ok(htmlRel.indexOf('Deputado Bruno Lima') < htmlRel.indexOf('Deputada Renata Abreu'),
     'deputados em ordem alfabética pelo nome');
  const blocoBruno = htmlRel.split('Deputada Renata Abreu')[0];
  ok(blocoBruno.includes('Em aberto (1)') && blocoBruno.includes('Atendidas (1)'),
     'subseções com contagem DENTRO do deputado');
  ok(blocoBruno.indexOf('Em aberto (1)') < blocoBruno.indexOf('Atendidas (1)'),
     'em aberto vem primeiro (é o que cobra ação)');
  ok(blocoBruno.includes('2 demanda(s) · 1 em aberto'), 'placar no cabeçalho do deputado');
  ok(!/Deputada Renata Abreu[\s\S]*Em aberto \(/.test(htmlRel),
     'deputada só com atendida não ganha subseção "Em aberto" vazia');
  ok(htmlRel.includes('RCP 2/2026 — Solicitar despacho do Presidente'), 'demanda aberta com natureza');
  ok(htmlRel.includes('✔ Atendida — Lista de 11/08/2026'), 'atendida nomeia a reunião');
  ok(htmlRel.includes('Lista de 11/08/2026 (item 9)'), 'histórico de listas entra no relatório');
  ok(htmlRel.includes('2 deputado(s) · 1 em aberto · 2 atendida(s)'), 'meta geral com o placar');
  // A escolha de deputados é um FILTRO antes do builder: só o selecionado sai.
  const soRenata = L._htmlRelatorioDemandas([dAtendida], null, reunioesRel);
  ok(soRenata.includes('Deputada Renata Abreu') && !soRenata.includes('Bruno Lima'),
     'relatório filtrado leva só o deputado escolhido');

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

  ok(fatos.tramite && /\(Art\. \d+/.test(fatos.tramite.regime), `regime da ficha veio (${fatos.tramite?.regime})`);
  const lf = L.linhasTramite(fatos.tramite);
  ok(lf && lf.relator && lf.parecer, `relator e parecer em frase (${lf?.relator} | ${lf?.parecer})`);
  ok(/CDU: aprovado em 26\/11\/2025/.test(lf?.anteriores || ''), `parecer da CDU nas anteriores (${lf?.anteriores})`);

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
