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
  ok($('pt-aba-nota').style.display === 'contents', 'aba "Nota de uma portaria" aparece');
  ok($('pt-aba-seq').style.display === 'none', 'e a da sequência some');
  ok(document.querySelector('[data-aba="nota"]').classList.contains('ativa') && !document.querySelector('[data-aba="seq"]').classList.contains('ativa'), 'botão da aba marcado');
  ok(/Disponível assim que a nota comparativa/.test($('pc-revisao').textContent), 'nota comparativa: caixa de alterações no lugar, desabilitada até a etapa 2');
  ok($('pn-gerar').disabled && /Gere a nota primeiro/.test($('pn-revisao').textContent), 'sem ato: "Gerar" desabilitado; caixa de alterações espera a nota');

  $('pn-texto').value = ATO;
  clica($('pn-usar-texto'));
  ok($('pn-ident').getAttribute('value').startsWith('PORTARIA CONJUNTA MGI/MF/CGU Nº 46') && /altera 28\/2024/.test($('pn-ato').textContent) && /4 artigo/.test($('pn-ato').textContent), 'ato lançado: identificação, relação e artigos por regra');
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

  clica($('pn-copiar'));
  await espera(() => copiado);
  ok(/^NOTA TÉCNICA/.test(copiado) && /altera Portaria Conjunta MGI\/MF\/CGU nº 28/.test(copiado), 'copiar: texto corrido com relações');
  let imprimiu = 0;
  ctx.window.print = () => imprimiu++;
  vm.runInContext('window.print = globalThis.window.print', ctx);
  clica($('pn-pdf'));
  ok(imprimiu === 1 && $('pt-impressao') && $('pt-impressao').parentNode === document.body && /Nota técnica/.test($('pt-impressao').textContent), 'PDF: a nota vai para o contêiner de impressão e abre a impressão');
  ok(/body > \*:not\(#pt-impressao\)/.test(html), 'PDF: na impressão, só o contêiner aparece');

  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  ok(['portarias-nota.js', 'portarias-avulsa.js'].every(f => man.web_accessible_resources[0].resources.includes(f)), 'scripts no manifest');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
