// Orçamento · Comparador de Portarias — NOTA DE UMA PORTARIA e "Pedir alterações".
//
// O que este teste trava:
//  1. conferência: trecho literal localizado, artigo existente, valor dentro do
//     trecho — o item inventado fica na nota MARCADO, não some;
//  2. prompts: nota técnica pede impactos/atenção/recomendações; a revisão leva
//     o pedido, os pedidos anteriores e a nota sem as marcas de conferência;
//  3. texto corrido para copiar; prazo em dias;
//  4. tela (IA simulada): abas; lançar o ato; gerar; quadros e gráficos; pedir
//     alteração (nova versão conferida de novo, histórico, resposta); desfazer;
//     falha da IA mantém a nota; caixa da nota comparativa no lugar, desabilitada.
//
// Uso: node testes/portarias-nota.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const N = require(path.join(RAIZ, 'portarias-nota.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const ATO = `PORTARIA CONJUNTA MGI/MF/CGU Nº 46, DE 10 DE JULHO DE 2026
Altera a Portaria Conjunta MGI/MF/CGU nº 28, de 21 de maio de 2024.
Art. 1º O regime simplificado aplica-se aos instrumentos com valor de repasse até R$ 1.500.000,00 (um milhão e quinhentos mil reais).
Art. 2º O convenente deverá apresentar a prestação de contas final no prazo de 60 (sessenta) dias contados do término da vigência.
Art. 3º O concedente analisará o plano de trabalho em até 15 (quinze) dias, prorrogáveis uma única vez.
Art. 4º Esta Portaria entra em vigor na data de sua publicação.`;

const RESP1 = {
  assunto: 'Ajusta o regime simplificado de transferências',
  resumo: 'A portaria altera limites e prazos do regime simplificado.',
  objeto: { texto: 'Limite do regime simplificado', artigos: ['Art. 1º'], trecho: 'O regime simplificado aplica-se aos instrumentos com valor de repasse até R$ 1.500.000,00' },
  pontos: [
    { tema: 'Limite', descricao: 'Até R$ 1,5 milhão', artigos: ['Art. 1º'], trecho: 'aplica-se aos instrumentos com valor de repasse até R$ 1.500.000,00' },
    { tema: 'Inventado', descricao: 'Exige audiência pública', artigos: ['Art. 9º'], trecho: 'o convenente realizará audiência pública prévia com a comunidade local' },
  ],
  aplicacao: [{ quem: 'Convenente', como: 'presta contas em 60 dias', artigos: ['Art. 2º'], trecho: 'O convenente deverá apresentar a prestação de contas final no prazo de 60 (sessenta) dias' }],
  prazos: [
    { prazo: '60 (sessenta) dias', evento: 'prestação de contas final', artigos: ['Art. 2º'], trecho: 'apresentar a prestação de contas final no prazo de 60 (sessenta) dias' },
    { prazo: '15 (quinze) dias', evento: 'análise do plano de trabalho', artigos: ['Art. 3º'], trecho: 'O concedente analisará o plano de trabalho em até 15 (quinze) dias' },
  ],
  valores: [{ valor: 'R$ 2.000.000,00', descricao: 'limite', artigos: ['Art. 1º'], trecho: 'aplica-se aos instrumentos com valor de repasse até R$ 1.500.000,00' }],
  vigencia: { texto: 'Na publicação', artigos: ['Art. 4º'], trecho: 'Esta Portaria entra em vigor na data de sua publicação' },
  visuais: ['numeros', 'relacoes', 'prazos', 'valores', 'inexistente'],
};

console.log('1. Conferência');
const c = N.ptConferirNota(RESP1, ATO);
ok(c.nota.pontos[0].conferido && !c.nota.pontos[1].conferido, 'trecho literal confere; trecho inventado não');
ok(c.nota.pontos[1].problemas.some(p => /não localizado/.test(p)) && c.nota.pontos[1].problemas.some(p => /Art\. 9º/.test(p)), 'problemas nomeados: trecho não localizado, artigo inexistente');
ok(!c.nota.valores[0].conferido && c.nota.valores[0].problemas.includes('valor não está no trecho citado'), 'valor que não está no trecho (R$ 2 mi × R$ 1,5 mi) é marcado');
ok(c.total === 8 && c.conferidos === 6 && c.problemas === 2, `contagem (${c.conferidos}/${c.total})`);
ok(c.nota.visuais.join() === 'numeros,relacoes,prazos,valores' && c.nota.extensao === 'normal', 'visuais desconhecidos descartados; extensão padrão');
ok(N.ptConferirNota({}, ATO).nota.visuais.join() === N.PT_VISUAIS_PADRAO.join(), 'sem "visuais": os padrões');

console.log('2. Prompts');
const pt = N.ptPromptNota({ tipo: 'tecnica', foco: 'municípios', cab: { identificacao: 'PORTARIA X', orgao: 'MGI' }, relacoes: { revoga: [], altera: [{ rotulo: 'Portaria nº 28, de 2024' }] } });
ok(/NOTA TÉCNICA/.test(pt) && /"impactos"/.test(pt) && /"recomendacoes"/.test(pt) && /municípios/.test(pt) && /altera Portaria nº 28/.test(pt), 'técnica: impactos/recomendações, foco e relações no prompt');
ok(!/"impactos"/.test(N.ptPromptNota({ tipo: 'informativa' })), 'informativa: sem impactos');
const pr = N.ptPromptRevisao({ nota: c.nota, pedido: 'Inclua mais gráficos', historico: ['Deixe mais curta'] });
ok(/<<<Inclua mais gráficos>>>/.test(pr) && /«Deixe mais curta»/.test(pr) && /"visuais"/.test(pr) && /"resposta"/.test(pr), 'revisão: pedido, histórico, visuais e resposta');
ok(!/"conferido"|"problemas"/.test(pr), 'revisão: a nota vai sem as marcas de conferência');

console.log('3. Texto e prazos');
const txt = N.ptNotaTexto(c.nota, { tipo: 'tecnica', identificacao: 'PORTARIA 46', relacoes: ['altera Portaria 28'] });
ok(/^NOTA TÉCNICA/.test(txt) && /Relações: altera Portaria 28/.test(txt) && /\[conferir\]/.test(txt) && /Art\. 4º/.test(txt), 'texto corrido com artigos e [conferir]');
ok(N.ptPrazoDias('60 (sessenta) dias') === 60 && N.ptPrazoDias('6 meses') === 180 && N.ptPrazoDias('1 ano') === 365 && N.ptPrazoDias('imediato') === null, 'prazo em dias');

console.log('4. Tela');
(async () => {
  const html = fs.readFileSync(path.join(RAIZ, 'portarias.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window, Event } = parseHTML(html);
  const respostas = [];
  let copiado = '';
  const ctx = { document, window, DOMParser, Event, setTimeout, clearTimeout, TextDecoder, console, confirm: () => true,
    navigator: { clipboard: { writeText: t => { copiado = t; return Promise.resolve(); } } },
    chrome: { runtime: { getURL: p => p }, storage: { local: { get: (k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'AIzaSyTESTE1234567890abc', modelo: 'gemini-2.5-flash' } }), set: (o, cb) => cb() } } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
  const prompts = [];
  ctx.chamarIAOrcamento = async ({ prompt }) => { prompts.push(prompt); const r = respostas.shift(); if (r instanceof Error) throw r; return { text: '```json\n' + JSON.stringify(r) + '\n```', truncated: false }; };
  vm.runInContext('chamarIAOrcamento = globalThis.chamarIAOrcamento', ctx);
  const $ = id => document.getElementById(id);
  const clica = el => el.dispatchEvent(new Event('click', { bubbles: true }));
  const espera = async cond => { for (let i = 0; i < 50 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };

  await espera(() => /gemini/.test($('btn-config-rotulo').textContent));
  ok(/gemini-2\.5-flash/.test($('btn-config-rotulo').textContent), 'IA configurada (chrome.storage) aparece no topo');
  ok(scripts.includes('orcamento-ia.js') && scripts.indexOf('portarias-avulsa.js') > scripts.indexOf('portarias.js'), 'scripts: camada de IA e tela da nota');
  ok($('pt-aba-seq').style.display === 'contents' && $('pt-aba-nota').style.display === 'none', 'abre na aba da sequência');
  clica(document.querySelector('[data-aba="nota"]'));
  ok($('pt-aba-nota').style.display === 'contents', 'aba "Notas de portarias" aparece');
  ok($('pt-aba-seq').style.display === 'none', 'e a da sequência some');
  ok(document.querySelector('[data-aba="nota"]').classList.contains('ativa') && !document.querySelector('[data-aba="seq"]').classList.contains('ativa'), 'botão da aba marcado');
  ok(/Gere a nota comparativa/.test($('pc-revisao').textContent), 'nota comparativa: caixa de alterações no lugar, esperando a nota');
  ok($('pn-gerar').disabled && /Gere a nota primeiro/.test($('pn-revisao').textContent), 'sem ato: "Gerar" desabilitado; caixa de alterações espera a nota');

  $('pn-texto').value = ATO;
  clica($('pn-usar-texto'));
  ok(document.querySelector('[data-pn-campo="identificacao"]').getAttribute('value').startsWith('PORTARIA CONJUNTA MGI/MF/CGU Nº 46') && /altera 28\/2024/.test($('pn-ato').textContent) && /4 artigo/.test($('pn-ato').textContent), 'ato lançado: identificação, relação e artigos por regra');
  ok(!$('pn-gerar').disabled, '"Gerar nota" habilitado');

  respostas.push(RESP1);
  // (linkedom: o seletor :checked lê o atributo)
  document.querySelector('input[name="pn-tipo"][value="informativa"]').removeAttribute('checked');
  document.querySelector('input[name="pn-tipo"][value="tecnica"]').setAttribute('checked', '');
  $('pn-foco').value = 'municípios';
  clica($('pn-gerar'));
  await espera(() => $('pn-doc'));
  const doc = () => $('pn-doc');
  ok(doc() && /Nota técnica/.test(doc().querySelector('.pn-tipo').textContent) && /NOTA TÉCNICA/.test(prompts[0]) && /municípios/.test(prompts[0]) && /TEXTO EXTRAÍDO DO DOCUMENTO/.test(prompts[0]), 'nota técnica gerada; foco e texto do ato no prompt');
  ok(doc().querySelector('.pn-tiles') && doc().querySelector('.pn-regua') && doc().querySelector('.pn-rel') && !doc().querySelector('.pn-tab'), 'quadros escolhidos: números, régua de prazos, relações (sem "quem faz o quê")');
  ok(/6\/8/.test(doc().querySelector('.pn-tiles').textContent) && doc().querySelectorAll('.pn-conf').length === 2, 'afirmações conferidas 6/8; 2 marcadas ⚠');
  const marcos = [...doc().querySelectorAll('.pn-regua .marco')];
  ok(marcos.length === 2 && /15/.test(marcos[0].textContent), 'régua: prazos em ordem (15 antes de 60 dias)');
  ok(/2 de 8|6 de 8/.test(doc().querySelector('.pn-rodape').textContent), 'rodapé informa a conferência');
  ok($('pn-acoes').style.display === 'flex' && $('pn-pedido'), 'nota pronta: PDF, copiar e caixa de alterações');

  // pedido de alteração
  clica(document.querySelector('.pt-sug[data-sug="Inclua mais gráficos"]'));
  ok($('pn-pedido').value === 'Inclua mais gráficos', 'sugestão preenche o pedido');
  $('pn-pedido').value += '. Acrescente um parágrafo sobre a análise do plano de trabalho';
  const RESP2 = Object.assign({}, RESP1, {
    visuais: ['numeros', 'prazos', 'aplicacao', 'temas'], resposta: 'Incluí o quadro "quem faz o quê", o gráfico da composição e um parágrafo.',
    secoes: [{ titulo: 'Análise do plano de trabalho', texto: 'O concedente tem 15 dias.', artigos: ['Art. 3º'], trecho: 'O concedente analisará o plano de trabalho em até 15 (quinze) dias' }],
  });
  respostas.push(RESP2);
  clica($('pn-pedir'));
  await espera(() => $('pn-doc') && $('pn-doc').querySelector('.pn-tab'));
  ok(/<<<Inclua mais gráficos\. Acrescente um parágrafo/.test(prompts[1]) && /TEXTO EXTRAÍDO DO DOCUMENTO/.test(prompts[1]), 'revisão leva o pedido e o texto do ato');
  ok(doc().querySelector('.pn-tab') && doc().querySelectorAll('.pn-barra').length >= 3 && /Análise do plano de trabalho/.test(doc().textContent), 'nova versão: quadro, gráfico e parágrafo pedidos');
  ok(/Incluí o quadro/.test($('pn-revisao').textContent) && /Pedidos aplicados/.test($('pn-revisao').textContent) && !$('pn-desfazer').disabled, 'resposta da IA, histórico e "Desfazer"');

  // segundo pedido leva o histórico; falha mantém a nota
  $('pn-pedido').value = 'Deixe mais curta';
  respostas.push(new Error('HTTP 503'));
  clica($('pn-pedir'));
  await espera(() => /falhou/.test($('pn-status').textContent));
  ok(/«Inclua mais gráficos/.test(prompts[2]) && /A nota anterior foi mantida/.test($('pn-status').textContent) && /Análise do plano/.test(doc().textContent), 'falha na revisão: avisa e mantém a nota');

  clica($('pn-desfazer'));
  ok(!doc().querySelector('.pn-tab') && !/Análise do plano/.test(doc().textContent) && $('pn-desfazer').disabled && !/Pedidos aplicados/.test($('pn-revisao').textContent), 'desfazer volta à versão anterior');

  // ⚠ na tela, fora do PDF
  let htmlPdf = '';
  ctx.window.print = () => { htmlPdf = $('pt-impressao').innerHTML; };
  vm.runInContext('window.print = globalThis.window.print', ctx);
  ok($('pn-doc').querySelectorAll('.pn-conf').length === 2 && /audiência pública/.test($('pn-doc').textContent), 'tela: itens não conferidos aparecem, com ⚠');
  clica($('pn-pdf'));
  ok(htmlPdf && !/audiência pública/.test(htmlPdf) && !/pn-conf/.test(htmlPdf) && !/R\$ 2\.000\.000/.test(htmlPdf), 'PDF: itens não conferidos ficam de fora');
  ok(/2 item\(ns\) cujo trecho não foi localizado ficaram fora deste PDF/.test(htmlPdf) && !/pn-tirar/.test(htmlPdf), 'PDF: rodapé diz quantos ficaram de fora; sem botões');

  // ✕ tira o item, sem IA
  const nPrompts = prompts.length;
  const tirar = [...$('pn-doc').querySelectorAll('[data-tirar]')].find(b => /audiência pública/.test(b.parentNode.textContent));
  clica(tirar);
  ok(!/audiência pública/.test($('pn-doc').textContent) && prompts.length === nPrompts && /Item tirado/.test($('pn-status').textContent), '✕ tira o item da nota na hora, sem chamar a IA');
  ok(/6\/7/.test($('pn-doc').querySelector('.pn-tiles').textContent), 'contagem de conferidas refeita (6/7)');
  clica($('pn-desfazer'));
  ok(/audiência pública/.test($('pn-doc').textContent), 'desfazer devolve o item');

  // IA diz que alterou e devolve a nota igual
  respostas.push(Object.assign({}, RESP1, { resposta: 'Removi o item da audiência pública.' }));
  const versoesAntes = vm.runInContext('pn.versoes.length', ctx);
  $('pn-pedido').value = 'Remova o item da audiência pública';
  clica($('pn-pedir'));
  await espera(() => /voltou igual/.test($('pn-status').textContent));
  ok(/nada foi alterado/.test($('pn-status').textContent) && vm.runInContext('pn.versoes.length', ctx) === versoesAntes && !/Removi o item/.test($('pn-revisao').textContent), 'IA diz que alterou mas devolve igual: avisa e não cria versão');

  clica($('pn-copiar'));
  await espera(() => copiado);
  ok(/^NOTA TÉCNICA/.test(copiado) && /altera Portaria Conjunta MGI\/MF\/CGU nº 28/.test(copiado), 'copiar: texto corrido com relações');
  let imprimiu = 0;
  ctx.window.print = () => imprimiu++;
  vm.runInContext('window.print = globalThis.window.print', ctx);
  clica($('pn-pdf'));
  ok(imprimiu === 1 && $('pt-impressao') && $('pt-impressao').parentNode === document.body && /Nota técnica/.test($('pt-impressao').textContent), 'PDF: a nota vai para o contêiner de impressão e abre a impressão');
  ok(/body > \*:not\(#pt-impressao\)/.test(html), 'PDF: na impressão, só o contêiner aparece');

  // ---- várias portarias, sem relação entre si, numa nota só ----
  const ATO2 = `PORTARIA MS Nº 7, DE 3 DE FEVEREIRO DE 2025
Dispõe sobre o repasse fundo a fundo para a atenção primária.
Art. 1º O Fundo Nacional de Saúde repassará os recursos em até 10 (dez) dias após a habilitação do município.
Art. 2º Esta Portaria entra em vigor na data de sua publicação.`;
  const RESP2ATO = { assunto: 'Repasse fundo a fundo na atenção primária', resumo: 'Fixa prazo de repasse.',
    prazos: [{ prazo: '10 (dez) dias', evento: 'repasse após habilitação', artigos: ['Art. 1º'], trecho: 'O Fundo Nacional de Saúde repassará os recursos em até 10 (dez) dias' }],
    vigencia: { texto: 'Na publicação', artigos: ['Art. 2º'], trecho: 'Esta Portaria entra em vigor na data de sua publicação' } };
  $('pn-texto').value = ATO2;
  clica($('pn-usar-texto'));
  ok(document.querySelectorAll('#pn-ato .pt-doc').length === 2 && !$('pn-doc') && /A lista de atos mudou/.test($('pn-status').textContent), 'segundo ato entra na lista; a nota anterior deixa de valer');
  ok(/Gerar nota dos 2 atos/.test($('pn-gerar').textContent) && /2 ato\(s\)/.test($('pn-contagem').textContent), 'botão e contagem para vários atos');
  const ordem = [...document.querySelectorAll('[data-pn-campo="identificacao"]')].map(i => i.getAttribute('value'));
  ok(/MS Nº 7/.test(ordem[0]) && /Nº 46/.test(ordem[1]), 'atos em ordem cronológica');
  prompts.length = 0;
  respostas.push(RESP2ATO, RESP1, { assunto: 'Dois atos sem relação', resumo: 'Os atos tratam de assuntos distintos.',
    conexoes: [{ texto: 'Não há relação entre os atos: um trata de saúde, o outro de convênios.', atos: [1, 2] }], atencao: [{ descricao: 'Prazo curto de repasse', atos: [1] }],
    recomendacoes: ['Acompanhar a habilitação dos municípios.'], visuais: ['numeros', 'relacoes', 'prazos', 'temas'] });
  clica($('pn-gerar'));
  await espera(() => $('pn-doc') && /Notas de portarias: 2 atos/.test($('pn-doc').textContent));
  ok(prompts.length === 3 && /Portaria MS Nº 7|PORTARIA MS Nº 7/.test(prompts[0]) && /Nº 46/.test(prompts[1]) && /parte geral/.test(prompts[2]) && /ATO 1:/.test(prompts[2]) && /ATO 2:/.test(prompts[2]), 'uma nota por ato + a parte geral sobre as duas');
  ok(!/TEXTO EXTRAÍDO/.test(prompts[2]), 'a parte geral não relê os textos: usa só as notas conferidas');
  const dm = $('pn-doc').textContent;
  ok(/Resumo do conjunto/.test(dm) && /Não há relação entre os atos/.test(dm) && /PORTARIA MS Nº 7/.test(dm) && /PORTARIA CONJUNTA MGI\/MF\/CGU Nº 46/.test(dm), 'nota única: resumo do conjunto, relação (ou falta dela) e uma seção por ato');
  ok(/Pontos de atenção/.test(dm) && /Acompanhar a habilitação/.test(dm), 'atenção e recomendações do conjunto');
  ok(/Em números · 2 atos/.test(dm) && /Relações de cada ato/.test(dm) && /sem relação com outros atos/.test(dm) && /Conteúdo por ato/.test(dm), 'quadros do conjunto');
  ok($('pn-doc').querySelectorAll('.pn-regua .marco').length === 3 && /\(Portaria Ms nº 7\/2025\)|\(Portaria MS nº 7\/2025\)/.test($('pn-doc').querySelector('.pn-regua').textContent), 'régua de prazos junta os atos, com o ato no rótulo');
  ok(/8 de 10 afirmações/.test(dm), 'conferência somada de todos os atos (2/2 + 6/8)');

  // revisão sobre o conjunto
  respostas.push({ geral: { assunto: 'Dois atos sem relação', resumo: 'Versão resumida.', conexoes: [], recomendacoes: [], visuais: ['numeros'], extensao: 'curta',
      secoes: [{ titulo: 'Contexto', texto: 'Parágrafo pedido pelo analista.' }], resposta: 'Resumi e incluí um parágrafo de contexto.' },
    atos: [Object.assign({ ato: 'MS 7' }, RESP2ATO, { resumo: 'Repasse em 10 dias.' }), Object.assign({ ato: 'PC 46' }, RESP1)] });
  $('pn-pedido').value = 'Resuma e inclua um parágrafo de contexto';
  clica($('pn-pedir'));
  await espera(() => /Resumi/.test($('pn-revisao').textContent));
  ok(/=== ATO 1: PORTARIA MS Nº 7/.test(prompts[3]) && /=== ATO 2: PORTARIA CONJUNTA/.test(prompts[3]) && /"atos"/.test(prompts[3]), 'revisão do conjunto leva a nota e o texto de todos os atos');
  ok(/Versão resumida/.test($('pn-doc').textContent) && /Parágrafo pedido/.test($('pn-doc').textContent) && /Repasse em 10 dias/.test($('pn-doc').textContent), 'revisão aplicada na parte geral e na nota de um ato');
  // resposta só com o ato que mudou, identificado pelo número
  const RESP1sem = Object.assign({}, RESP1, { pontos: RESP1.pontos.filter(p => p.tema !== 'Inventado') });
  respostas.push({ geral: { resumo: 'Versão resumida.', resposta: 'Tirei a audiência pública do ato 2.' }, atos: [Object.assign({ ato: 2 }, RESP1sem)] });
  $('pn-pedido').value = 'Tire o item da audiência pública';
  clica($('pn-pedir'));
  await espera(() => /Tirei a audiência/.test($('pn-revisao').textContent));
  ok(!/audiência pública/.test($('pn-doc').textContent) && /Repasse em 10 dias/.test($('pn-doc').textContent), 'resposta só com o ato alterado ("ato": 2): aplica nele e mantém o outro');
  clica($('pn-desfazer'));

  respostas.push({ geral: { resumo: 'Só a geral.', resposta: '' }, atos: [{}] });
  $('pn-pedido').value = 'Outra coisa';
  clica($('pn-pedir'));
  await espera(() => /Só a geral/.test($('pn-doc').textContent));
  ok(/Repasse em 10 dias/.test($('pn-doc').textContent) && /formato utilizável; essas ficaram como estavam/.test($('pn-revisao').textContent), 'resposta com ato vazio: notas dos atos preservadas, e isso é dito');
  clica($('pn-desfazer'));
  ok(/Versão resumida/.test($('pn-doc').textContent), 'desfazer no conjunto');
  copiado = '';
  clica($('pn-copiar'));
  await espera(() => copiado);
  ok(/— 2 ATOS/.test(copiado) && /===== ATO 1 =====/.test(copiado) && /===== ATO 2 =====/.test(copiado), 'copiar: texto do conjunto');

  // tirar um ato
  clica(document.querySelector('[data-pn-acao="remover"]'));
  ok(document.querySelectorAll('#pn-ato .pt-doc').length === 1 && !$('pn-doc'), 'tirar um ato: sai da lista e a nota deixa de valer');

  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  ok(['portarias-nota.js', 'portarias-avulsa.js'].every(f => man.web_accessible_resources[0].resources.includes(f)), 'scripts no manifest');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
