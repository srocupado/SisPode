// Orçamento · Comparador de Portarias — NOTA COMPARATIVA (etapa 2).
//
// O que este teste trava:
//  1. motor: estrutura (capítulo + nome na linha seguinte); partes cortadas em
//     início de artigo; pares (ponto de partida, substitui, altera, instrumento
//     novo, par escolhido à mão); lotes de temas; matriz tema × comparação;
//  2. conferência: regra sem trecho literal é descartada; mudança com trecho de
//     antes/depois que não está no ato certo é descartada;
//  3. tela, ponta a ponta com IA simulada que responde A PARTIR DO PROMPT
//     (a extração copia linhas reais do ato; a comparação casa regras por aspecto):
//     progresso por passo, quadro "como era × como ficou", mapa de calor,
//     placar, linha do tempo; reaproveitamento das leituras; "Comparar com";
//     cancelar; pedir alterações + desfazer; copiar.
//
// Uso: node testes/portarias-comparacao.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const C = require(path.join(RAIZ, 'portarias-comparacao.js'));
const S = require(path.join(RAIZ, 'portarias-sequencia.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const A = `PORTARIA INTERMINISTERIAL Nº 10, DE 5 DE MARÇO DE 2020
Estabelece normas para convênios.
CAPÍTULO I
DA PROPOSTA
Art. 1º O proponente cadastrará a proposta no sistema em até 30 dias da divulgação do programa.
Art. 2º A contrapartida será de no mínimo 2% do valor do repasse para municípios.
CAPÍTULO II
DA PRESTAÇÃO DE CONTAS
Art. 3º A prestação de contas final será apresentada em até 60 dias após o fim da vigência.
Art. 4º O convenente manterá os documentos arquivados por 10 anos após a aprovação das contas.`;
const B = `PORTARIA CONJUNTA Nº 20, DE 10 DE JUNHO DE 2022
Estabelece novas normas para convênios.
CAPÍTULO I
DA PROPOSTA
Art. 1º O proponente cadastrará a proposta no sistema em até 15 dias da divulgação do programa.
Art. 2º A contrapartida será de no mínimo 1% do valor do repasse para municípios.
CAPÍTULO II
DA PRESTAÇÃO DE CONTAS
Art. 3º A prestação de contas final será apresentada em até 90 dias após o fim da vigência.
Art. 5º O concedente publicará painel de transparência com todos os instrumentos celebrados.
Art. 6º Fica revogada a Portaria Interministerial nº 10, de 5 de março de 2020.`;
const D = `PORTARIA CONJUNTA Nº 30, DE 1º DE AGOSTO DE 2023
Altera a Portaria Conjunta nº 20, de 10 de junho de 2022.
Art. 1º A Portaria Conjunta nº 20, de 2022, passa a vigorar com as seguintes alterações:
"Art. 1º O proponente cadastrará a proposta no sistema em até 20 dias da divulgação do programa." (NR)
Art. 2º Esta Portaria entra em vigor na data de sua publicação.`;

console.log('1. Motor');
ok(C.pcEstrutura(A).join('|') === 'CAPÍTULO I — DA PROPOSTA|CAPÍTULO II — DA PRESTAÇÃO DE CONTAS', 'estrutura: capítulo com o nome da linha seguinte');
const longo = ('Art. 1º ' + 'x'.repeat(300) + '\n').repeat(40);
const partes = C.pcPartes(longo, 3000);
ok(partes.length > 1 && partes.slice(1).every(p => /^Art\./.test(p)) && partes.join('') === longo, 'partes cortadas em início de artigo, sem perder texto');
const docs = [{ id: 1, texto: A, numero: '10', data: '2020-03-05' }, { id: 2, texto: B, numero: '20', data: '2022-06-10' }, { id: 3, texto: D, numero: '30', data: '2023-08-01' },
  { id: 4, texto: 'PORTARIA Nº 40, DE 2 DE JANEIRO DE 2024\nArt. 1º Institui o regime especial.', numero: '40', data: '2024-01-02' }];
const pares = C.pcPares(docs, S.ptSequencia(docs));
ok(pares.map(p => p.modo).join() === 'inicial,substituicao,alteracao,novo' && pares[1].baseId === 1 && pares[2].baseId === 2, 'pares: ponto de partida, substitui (revoga), altera, instrumento novo');
docs[3].comparaCom = 2;
ok(C.pcPares(docs, S.ptSequencia(docs))[3].baseId === 2 && C.pcPares(docs, S.ptSequencia(docs))[3].motivo === 'definido pelo analista', '"Comparar com" escolhido à mão');
docs[1].comparaCom = 'nenhum';
ok(C.pcPares(docs, S.ptSequencia(docs))[1].modo === 'novo', '"nenhum": instrumento novo');
const lotes = C.pcLotes(['T1', 'T2', 'T3'], [{ tema: 'T1', aspecto: 'a', regra: 'x'.repeat(500), trecho: '' }], [{ tema: 'T2', aspecto: 'b', regra: 'y'.repeat(500), trecho: '' }], 600);
ok(lotes.length === 2 && lotes[0].temas.join() === 'T1' && lotes[1].temas.join() === 'T2', 'lotes: limite de tamanho; tema sem regra fica de fora');

console.log('2. Conferência');
const temas = [{ nome: 'Proposta' }, { nome: 'Outros' }];
const rg = C.pcConfereRegras([{ tema: 'Proposta', aspecto: 'prazo', regra: '30 dias', artigos: ['Art. 1º'], trecho: 'O proponente cadastrará a proposta no sistema em até 30 dias' },
  { tema: 'Inexistente', aspecto: 'x', regra: 'y', artigos: ['Art. 9º'], trecho: 'texto que não existe em lugar nenhum do ato normativo' }], A, temas);
ok(rg[0].conferido && !rg[1].conferido && rg[1].tema === 'Outros' && rg[1].problemas.length === 2, 'regra: trecho e artigo conferidos; tema desconhecido vira "Outros"');
const mu = C.pcConfereMudancas({ mudancas: [
  { tema: 'Proposta', aspecto: 'prazo', tipo: 'alterada', antes: '30', depois: '15', trecho_antes: 'cadastrará a proposta no sistema em até 30 dias', trecho_depois: 'cadastrará a proposta no sistema em até 15 dias' },
  { tema: 'Proposta', aspecto: 'invertida', tipo: 'alterada', antes: '15', depois: '30', trecho_antes: 'cadastrará a proposta no sistema em até 15 dias', trecho_depois: 'cadastrará a proposta no sistema em até 30 dias' },
  { tema: 'Proposta', aspecto: 'm', tipo: 'mantida' }], mantidas: [{ tema: 'Proposta', aspecto: 'z' }] }, A, B, temas);
ok(mu.mudancas.length === 2 && mu.mudancas[0].conferido && !mu.mudancas[1].conferido && mu.mantidas.length === 1, 'mudança: antes conferido no ato anterior e depois no posterior (invertido não passa)');
const mz = C.pcMatriz([{ parId: 2, mudancas: [{ tema: 'P', tipo: 'nova' }, { tema: 'P', tipo: 'alterada' }] }]);
ok(mz.temas.join() === 'P' && mz.celula('P', 2).total === 2 && mz.celula('X', 2).total === 0, 'matriz tema × comparação');
ok(C.pcNormalizarSintese({ visuais: ['calor', 'xx'], extensao: 'gigante' }).visuais.join() === 'calor' && C.pcNormalizarSintese({}).extensao === 'normal', 'síntese normalizada (visuais e extensão válidos)');

console.log('3. Tela');
(async () => {
  const html = fs.readFileSync(path.join(RAIZ, 'portarias.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window, Event } = parseHTML(html);
  let copiado = '', confirmou = 0;
  const ctx = { document, window, DOMParser, Event, setTimeout, clearTimeout, TextDecoder, console, confirm: () => { confirmou++; return true; },
    navigator: { clipboard: { writeText: t => { copiado = t; return Promise.resolve(); } } },
    chrome: { runtime: { getURL: p => p }, storage: { local: { get: (k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'AIzaSyTESTE1234567890abc' } }), set: (o, cb) => cb() } } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);

  // IA simulada: responde a partir do próprio prompt.
  const log = [];
  let travar = null;
  const temaDe = l => /contas|documentos/i.test(l) ? 'Prestação de contas' : /proposta|contrapartida/i.test(l) ? 'Proposta e contrapartida' : 'Transparência';
  const aspectoDe = l => /cadastrar/i.test(l) ? 'prazo de cadastro da proposta' : /contrapartida/i.test(l) ? 'contrapartida mínima' : /presta[çc][ãa]o de contas final/i.test(l) ? 'prazo da prestação de contas'
    : /arquivados/i.test(l) ? 'guarda de documentos' : /painel/i.test(l) ? 'painel de transparência' : 'outro';
  ctx.ptChamarIAJson = async prompt => {
    if (travar) await travar;
    if (/Monte UMA lista de temas/.test(prompt)) { log.push('temas'); return { temas: [{ nome: 'Proposta e contrapartida' }, { nome: 'Prestação de contas' }, { nome: 'Transparência' }] }; }
    if (/extrai TODAS as regras/.test(prompt)) {
      log.push('extracao');
      const texto = prompt.split('TEXTO (parte')[1];
      const regras = texto.split('\n').filter(l => /^"?Art\. \d/.test(l) && !/revogada|vigor|passa a vigorar/.test(l)).map(l => {
        const t = l.replace(/^"/, '').replace(/" \(NR\)$/, '');
        return { tema: temaDe(t), aspecto: aspectoDe(t), regra: t.slice(8), artigos: [t.match(/^Art\. \d+º?/)[0]], trecho: t.slice(8, 120) };
      });
      return { regras };
    }
    if (/Compare como as regras ERAM/.test(prompt)) {
      log.push('comparacao');
      const parse = bloco => bloco.split('\n').filter(l => l.startsWith('[')).map(l => ({ tema: l.match(/^\[(.*?)\]/)[1], aspecto: l.match(/\] (.*?):/)[1], regra: l.split(': ').slice(1).join(': ').split(' (Art')[0], trecho: l.match(/«(.*)»/)[1] }));
      const antes = parse(prompt.split('REGRAS DO ANTES:')[1].split('REGRAS DO DEPOIS:')[0]), depois = parse(prompt.split('REGRAS DO DEPOIS:')[1]);
      const mudancas = [], mantidas = [];
      for (const d of depois) {
        const a = antes.find(x => x.aspecto === d.aspecto);
        if (!a) mudancas.push({ tema: d.tema, aspecto: d.aspecto, tipo: 'nova', antes: '', depois: d.regra, artigos_antes: [], artigos_depois: ['Art. 1º'], trecho_antes: '', trecho_depois: d.trecho, efeito: 'novo dever' });
        else if (a.trecho !== d.trecho) mudancas.push({ tema: d.tema, aspecto: d.aspecto, tipo: 'alterada', antes: a.regra, depois: d.regra, artigos_antes: ['Art. 1º'], artigos_depois: ['Art. 1º'], trecho_antes: a.trecho, trecho_depois: d.trecho, efeito: 'muda o prazo' });
        else mantidas.push({ tema: d.tema, aspecto: d.aspecto });
      }
      if (!/ALTERA o anterior/.test(prompt)) for (const a of antes) if (!depois.some(d => d.aspecto === a.aspecto)) mudancas.push({ tema: a.tema, aspecto: a.aspecto, tipo: 'suprimida', antes: a.regra, depois: '', artigos_antes: ['Art. 4º'], artigos_depois: [], trecho_antes: a.trecho, trecho_depois: '', efeito: 'deixa de existir' });
      // e uma mudança inventada, que a conferência tem de barrar
      mudancas.push({ tema: 'Transparência', aspecto: 'inventada', tipo: 'nova', antes: '', depois: 'audiência pública', trecho_antes: '', trecho_depois: 'realizará audiência pública com a comunidade antes da celebração' });
      return { mudancas, mantidas };
    }
    if (/INSTRUMENTO NOVO/.test(prompt)) { log.push('novo'); return { mudancas: [], mantidas: [] }; }
    if (/redige a síntese/.test(prompt)) { log.push('sintese'); return { resumo: 'Os prazos mudaram ao longo da sequência.', destaques: [{ titulo: 'Prazo de cadastro', texto: 'caiu de 30 para 15 e subiu para 20 dias', tema: 'Proposta e contrapartida' }], visuais: ['linha', 'placar', 'calor', 'quadro'] }; }
    if (/revisa a síntese/.test(prompt)) { log.push('revisao'); return { resumo: 'Versão curta.', destaques: [], visuais: ['calor', 'quadro', 'tamanho'], extensao: 'curta', secoes: [{ titulo: 'Contrapartida', texto: 'A contrapartida caiu.' }], resposta: 'Encurtei e incluí o gráfico de tamanho.' }; }
    throw new Error('prompt inesperado');
  };
  vm.runInContext('ptChamarIAJson = globalThis.ptChamarIAJson', ctx);
  const $ = id => document.getElementById(id);
  const clica = el => el.dispatchEvent(new Event('click', { bubbles: true }));
  const espera = async (cond, n = 200) => { for (let i = 0; i < n && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
  await espera(() => /gemini|IA/.test($('btn-config-rotulo').textContent));

  ok($('pc-gerar').disabled && /pelo menos dois atos/.test($('pc-requisito').textContent), 'sem atos: botão desabilitado, com o motivo');
  ctx.__t = [D, A, B];
  vm.runInContext(`__t.forEach(t => ptIncluir(t, { tipo: 'texto colado' }))`, ctx);
  const pars = [...document.querySelectorAll('.pt-par')].map(e => e.textContent.replace(/\s+/g, ' '));
  ok(/ponto de partida/.test(pars[0]) && /substitui PORTARIA INTERMINISTERIAL Nº 10/.test(pars[1]) && /altera PORTARIA CONJUNTA Nº 20/.test(pars[2]), 'cada ato mostra seu par na nota comparativa');
  ok(!$('pc-gerar').disabled, '"Gerar nota comparativa" habilitado');

  clica($('pc-gerar'));
  await espera(() => $('pc-doc'));
  const doc = () => $('pc-doc');
  ok(confirmou === 1 && doc(), 'confirma o custo e gera a nota');
  ok(log.join() === 'temas,extracao,extracao,extracao,comparacao,comparacao,sintese', `passos: ${log.join(' → ')}`);
  const passos = [...document.querySelectorAll('.pc-passos li')].map(l => l.textContent);
  ok(passos.length === 7 && passos.every(p => p.startsWith('✓')) && /4 temas/.test(passos[0]), 'progresso: todos os passos concluídos');
  ok(/1 nova\(s\), 3 alterada\(s\), 1 suprimida\(s\), 0 mantida\(s\) · 1 descartada/.test(passos[4]), `substituição: nova, alteradas, suprimida; a inventada descartada (${passos[4]})`);
  ok(/0 nova\(s\), 1 alterada\(s\), 0 suprimida/.test(passos[5]), 'alteração: só o dispositivo alterado');
  const quadro = doc().textContent;
  ok(/em até 30 dias/.test(quadro) && /em até 15 dias/.test(quadro) && /em até 20 dias/.test(quadro), 'quadro "como era × como ficou" com o texto dos atos');
  ok(!/audiência pública/.test(quadro), 'mudança inventada não entra na nota');
  ok(doc().querySelector('.pc-calor') && doc().querySelector('.pc-linha') && doc().querySelectorAll('.pc-pilha').length === 2, 'mapa de calor, linha do tempo e placar');
  ok(doc().querySelectorAll('.pc-no').length === 3 && /revoga 10\/2020/.test(doc().querySelector('.pc-linha').textContent), 'linha do tempo com as relações');
  ok(/Os prazos mudaram/.test(quadro) && /Prazo de cadastro/.test(quadro), 'resumo e destaques da síntese');

  // pedir alteração na nota comparativa
  ok($('pc-pedido') && !$('pc-pedir').disabled, 'caixa "Pedir alterações" habilitada');
  $('pc-pedido').value = 'Deixe mais curta e inclua o tamanho dos atos';
  clica($('pc-pedir'));
  await espera(() => /Encurtei/.test($('pc-revisao').textContent));
  ok(/Versão curta/.test(doc().textContent) && /Tamanho dos atos/.test(doc().textContent) && !doc().querySelector('.pc-linha') && /contrapartida caiu/.test(doc().textContent), 'revisão: resumo curto, gráfico pedido, parágrafo extra');
  ok(/em até 15 dias/.test(doc().textContent), 'revisão não mexe nas mudanças conferidas');
  clica($('pc-desfazer'));
  ok(/Os prazos mudaram/.test(doc().textContent) && doc().querySelector('.pc-linha'), 'desfazer');

  clica($('pc-copiar'));
  await espera(() => copiado);
  ok(/^NOTA INFORMATIVA COMPARATIVA/.test(copiado) && /\[Alterada\] prazo de cadastro da proposta/.test(copiado), 'copiar: texto corrido');

  // trocar o par invalida a nota; gerar de novo reaproveita as leituras
  const sel = document.querySelectorAll('.pt-par select')[2];
  // (linkedom: select.value só lê o atributo "selected")
  sel.querySelectorAll('option').forEach(o => o.value === 'nenhum' ? o.setAttribute('selected', '') : o.removeAttribute('selected'));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  ok(!$('pc-doc') && /A sequência mudou/.test($('pc-status').textContent), 'trocar o par: a nota sai, com aviso');
  log.length = 0;
  clica($('pc-gerar'));
  await espera(() => $('pc-doc'));
  ok(log.join() === 'comparacao,novo,sintese', `de novo: sem reler temas nem atos (${log.join(' → ')})`);

  // cancelar
  let solta;
  travar = new Promise(r => { solta = r; });
  vm.runInContext('pc.temas = null', ctx);
  clica($('pc-gerar'));
  await espera(() => $('pc-cancelar').style.display === '');
  clica($('pc-cancelar'));
  solta(); travar = null;
  await espera(() => /cancelada/.test($('pc-status').textContent));
  ok(/cancelada/.test($('pc-status').textContent) && !$('pc-doc') && !$('pc-gerar').disabled, 'cancelar para a geração e libera o botão');

  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  ok(['portarias-comparacao.js', 'portarias-comparativa.js'].every(f => man.web_accessible_resources[0].resources.includes(f)), 'scripts no manifest');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
