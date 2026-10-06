// Labs — Simulador de Negociação e Mapa Territorial.
//
// O que este teste trava:
//  1. registro: o card "Labs" existe no painel com a descrição combinada, e o
//     manifest expõe as páginas e libera o IBGE; o Placar Preditivo saiu e o
//     Simulador é a aba que abre;
//  2. orientação: partido achado dentro do nome do bloco/federação; liderança
//     (Governo/Oposição…) só pelo nome exato; janelas de consulta ≤ 80 dias;
//  3. simulador: perfil por partido (alinhamento ao Governo, coesão,
//     divergências), leitura do JSON do agente, cadeiras por posição, e a
//     rodada completa com IA de mentira — uma chamada por bancada + a síntese;
//  4. mapa (núcleo): CSV do TSE com aspas, casamento por nome civil e, na falta,
//     por nome de urna único; soma das zonas; cargo diferente ignorado;
//     ponte TSE → IBGE por nome (acento, "Moji"/"Mogi"); localidade e emendas;
//  5. mapa (tela): leitura latin1 em pedaços de um File e o desenho do SVG;
//  6. bot: leitor de ZIP (deflate e sem compressão) lendo o CSV de dentro do zip.
//
// Uso: node testes/labs.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), os = require('os');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  // ---------- 1. registro ----------
  console.log('1. Registro do módulo');
  const panel = fs.readFileSync(path.join(RAIZ, 'panel.js'), 'utf8');
  ok(/id:\s+'labs'[\s\S]*?titulo: 'Labs'[\s\S]*?desc:\s+'Área de desenvolvimento\.'[\s\S]*?acao:\s+abrirLabs/.test(panel), 'card Labs no painel: "Área de desenvolvimento."');
  ok(/function abrirLabs\(\)[\s\S]*?labs\.html/.test(panel), 'abrirLabs abre labs.html');
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  const recursos = man.web_accessible_resources[0].resources;
  const html = fs.readFileSync(path.join(RAIZ, 'labs.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  ok(scripts.every(s => recursos.includes(s) && fs.existsSync(path.join(RAIZ, s))), 'todos os scripts de labs.html existem e estão no manifest');
  ok(man.host_permissions.includes('https://servicodados.ibge.gov.br/*'), 'IBGE liberado no manifest');
  ok(/área de desenvolvimento de novas soluções/i.test(html) && /homologadas/.test(html), 'a página abre com a descrição do Labs');
  ok(!/placar/i.test(scripts.join(' ')) && !recursos.includes('labs-placar.js') && !/id="(aba|painel)-placar"/.test(html) && !fs.existsSync(path.join(RAIZ, 'labs-placar.js')), 'Placar Preditivo removido (aba, painel, script e manifest)');
  ok(/class="aba ativa" id="aba-simulador"/.test(html) && /<div id="painel-simulador">/.test(html) && /<div id="painel-mapa" hidden>/.test(html), 'Simulador é a aba que abre; Mapa começa oculto');

  // ---------- contexto da página ----------
  const { document, window, Event } = parseHTML(html);
  const armazenado = { config: { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' } };
  const ctx = {
    document, window, DOMParser, Event, CustomEvent: window.CustomEvent || class extends Event { constructor(t, o) { super(t); this.detail = o && o.detail; } },
    setTimeout, clearTimeout, URL, TextDecoder, TextEncoder, AbortController, Blob, Response, Headers, Request, btoa,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    chrome: { storage: { local: { get: (_k, cb) => cb(armazenado), set: (o, cb) => { Object.assign(armazenado, o); if (cb) cb(); } } }, runtime: { getURL: p => p } },
    localStorage: { getItem: () => null, setItem: () => {} },
    alert: () => {}, confirm: () => true,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
  const av = e => vm.runInContext(e, ctx);
  // linkedom não deixa escrever select.value: marca a opção pelo atributo
  const selecionar = (id, v) => { for (const o of document.getElementById(id).querySelectorAll('option')) { if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } };

  // ---------- 1b. ⚙ de IA na própria página ----------
  console.log('1b. Configuração de IA no Labs');
  ok(!!document.getElementById('btn-config-ia') && !!document.getElementById('modalIa') && document.getElementById('modalIa').hasAttribute('hidden'), 'engrenagem na barra do topo; modal começa fechado');
  await av(`mdlIniciar()`);
  const provs = [...document.querySelectorAll('#cvIaProvedor option')].map(o => o.getAttribute('value'));
  ok(provs.join(',') === 'gemini,openai,anthropic', 'modal lista os três provedores');
  document.getElementById('btn-config-ia').dispatchEvent(new Event('click'));
  await new Promise(r => setTimeout(r, 20));
  ok(!document.getElementById('modalIa').hasAttribute('hidden'), '⚙ abre o modal');
  ok(document.getElementById('cvIaChave').value === 'chave-de-teste', 'modal mostra a chave já configurada no aplicativo');
  for (const o of document.querySelectorAll('#cvIaProvedor option')) { if (o.getAttribute('value') === 'anthropic') o.setAttribute('selected', ''); else o.removeAttribute('selected'); }
  document.getElementById('cvIaProvedor').dispatchEvent(new Event('change'));
  document.getElementById('cvIaChave').value = 'sk-ant-' + 'x'.repeat(30);
  const salvo = await av(`mdlSalvar()`);
  ok(salvo && armazenado.config.provedor === 'anthropic' && armazenado.config.apiKey === 'sk-ant-' + 'x'.repeat(30) && armazenado.config.chaves.gemini === 'chave-de-teste',
    'Salvar grava provedor e chave na configuração do aplicativo (a chave do Gemini fica guardada)');
  ok(document.getElementById('modalIa').hasAttribute('hidden'), 'modal fecha ao salvar');
  document.getElementById('cvIaChave').value = 'chave-errada';
  ok(await av(`mdlSalvar()`) === null && /formato inválido/.test(document.getElementById('cvIaModeloEstado').textContent), 'chave fora do formato do provedor é recusada');
  armazenado.config = { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' };

  // ---------- 2. orientação e janelas ----------
  console.log('2. Orientação e janelas');
  const ORI = [
    { siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' },
    { siglaPartidoBloco: 'Bl MdbPsdRepPode', orientacaoVoto: 'Não' },
    { siglaPartidoBloco: 'Fdr PT-PCdoB-PV', orientacaoVoto: 'Sim' },
    { siglaPartidoBloco: 'PL', orientacaoVoto: 'Liberado' },
  ];
  ctx.__ORI = ORI;
  ok(av(`labsOrientacao(__ORI, 'Governo')`) === 'Sim', 'Governo pelo nome exato');
  ok(av(`labsOrientacao(__ORI, 'PODE')`) === 'Não', 'PODE achado dentro de "Bl MdbPsdRepPode"');
  ok(av(`labsOrientacao(__ORI, 'PCdoB')`) === 'Sim', 'PCdoB achado dentro da federação');
  ok(av(`labsOrientacao(__ORI, 'PL')`) === null, 'orientação "Liberado" não conta como Sim/Não');
  ok(av(`labsOrientacao(__ORI, 'Oposição')`) === null, 'liderança sem orientação não herda de bloco');
  // Bloco com rótulo cortado pela API: só a composição (de /blocos) diz quem está nele.
  ctx.__ORI2 = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }, { siglaPartidoBloco: 'Bl UniPpPsd...', orientacaoVoto: 'Não' }];
  ok(av(`labsOrientacao(__ORI2, 'PODE', [])`) === null, 'sem a composição dos blocos, rótulo cortado não inventa orientação');
  av(`__BL = [{ ordem: ['uniao','pp','psd','republicanos','mdb','psdb','cidadania','pode'], membros: new Set(['psdb','cidadania','uniao','pp','republicanos','psd','mdb','pode']) },
              { ordem: ['avante','solidariedade','prd'], membros: new Set(['avante','solidariedade','prd']) }]`);
  ok(av(`labsOrientacao(__ORI2, 'PODE', __BL)`) === 'Não' && av(`labsOrientacao(__ORI2, 'UNIÃO', __BL)`) === 'Não', '"Bl UniPpPsd..." resolvido pela composição: PODE e UNIÃO (com acento) orientaram Não');
  ok(av(`labsOrientacao(__ORI2, 'AVANTE', __BL)`) === null, 'partido de outro bloco não herda a orientação');
  ok(av(`labsBlocoDoRotulo('Bl UniPpPsdbCid...', __BL)`) === null, 'abreviação que não casa na ordem ("psdb" ≠ "psd") não resolve — conservador');
  ok(av(`labsOrientacao(__ORI, 'PODE', __BL)`) === 'Não', 'bloco antigo, fora dos em vigor, ainda vale pelo rótulo inteiro');
  const jan = av(`labsJanelas('2025-01-01', '2025-12-31')`);
  const dias = ([a, b]) => (new Date(b) - new Date(a)) / 864e5;
  ok(jan.every(j => dias(j) <= 80) && jan[0][0] === '2025-01-01' && jan[jan.length - 1][1] === '2026-01-01', `12 meses em ${jan.length} janelas de ≤ 80 dias, cobrindo até o último dia (+1)`);

  // ---------- 3. simulador ----------
  console.log('3. Simulador de Negociação');
  const vs = [];
  for (let i = 0; i < 4; i++) {
    vs.push({
      votacao: { id: 's' + i, dataHoraRegistro: `2025-0${i + 1}-10T10:00`, descricao: 'Votação ' + i },
      orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }, { siglaPartidoBloco: 'Bl MdbPsdRepPode', orientacaoVoto: i < 3 ? 'Sim' : 'Não' },
        { siglaPartidoBloco: 'PL', orientacaoVoto: 'Não' }],
      votos: [
        { deputado_: { id: 1, siglaPartido: 'PODE' }, tipoVoto: 'Sim' }, { deputado_: { id: 2, siglaPartido: 'PODE' }, tipoVoto: 'Sim' },
        { deputado_: { id: 3, siglaPartido: 'PODE' }, tipoVoto: i === 0 ? 'Não' : 'Sim' },
        { deputado_: { id: 4, siglaPartido: 'PL' }, tipoVoto: 'Não' }, { deputado_: { id: 5, siglaPartido: 'PL' }, tipoVoto: 'Não' },
      ],
    });
  }
  ctx.__vs = vs;
  const pf = av(`smPerfis(__vs, ['PODE', 'PL'])`);
  ok(pf.PODE.comparaveisOrientacao === 4 && Math.abs(pf.PODE.alinhamentoOrientacao - 0.75) < 1e-9, 'orientação do bloco do PODE igual à do Governo em 3 de 4');
  ok(pf.PODE.comparaveis === 4 && pf.PODE.alinhamentoGoverno === 1 && !pf.PODE.divergencias.length, 'pelo VOTO, a maioria do PODE seguiu o Governo nas 4 (a orientação do bloco na 4ª não foi seguida)');
  ok(pf.PL.alinhamentoGoverno === 0 && pf.PL.divergencias.length === 4, 'PL: maioria votou contra o Governo nas 4; divergências listadas');
  ok(/^2025-04-10: Votação 3 \(maioria da bancada: Não; Governo orientou: Sim\)$/.test(pf.PL.divergencias[0]), 'divergência mais recente primeiro, com data e o voto da bancada');
  ok(Math.abs(pf.PODE.coesao - (2 / 3 + 1 + 1 + 1) / 4) < 1e-9, 'coesão = média da fração com a maioria da bancada');
  const lida = av(`smLerResposta('Claro:\\n\`\`\`json\\n{"posicao":"Condiciona","objecoes":["prazo","custo"],"concessao":"180 dias","argumento":"a","risco":"b"}\\n\`\`\`')`);
  ok(lida.posicao === 'condiciona' && lida.objecoes.length === 2 && lida.concessao === '180 dias', 'lê JSON cercado por ``` e normaliza a posição');
  ok(av(`smLerResposta('{"posicao":"talvez"}').posicao`) === 'indefinida', 'posição fora da lista vira "indefinida"');
  let lancou = false; try { av(`smLerResposta('sem json aqui')`); } catch (e) { lancou = true; }
  ok(lancou, 'resposta sem JSON é erro (vira "sem resposta"), não posição inventada');
  const prompt = av(`smPromptAgente({sigla:'PL', cadeiras: 90}, smPerfis(__vs, ['PL']).PL, {sigla:'PL', numero:'1', ano:'2025', ementa:'Ementa X'}, 'Aprovar o texto do relator.', 6)`);
  ok(/PL na Câmara dos Deputados \(90 deputados/.test(prompt) && /votou como o Governo orientou em 0% das 4 votações/.test(prompt) && /orientação do líder[\s\S]*0% de 4/.test(prompt) && /Ementa X/.test(prompt) && /Aprovar o texto do relator\./.test(prompt) && /"posicao"/.test(prompt),
    'prompt do agente traz cadeiras, perfil real, proposição, proposta e o formato JSON');

  // rodada completa, com a Câmara e a IA de mentira
  av(`labsDeputadosAtuais = async () => [].concat(
      Array.from({length: 5}, (_, i) => ({id: i, nome: 'p' + i, partido: 'PL', uf: 'SP'})),
      Array.from({length: 3}, (_, i) => ({id: 10 + i, nome: 'q' + i, partido: 'PODE', uf: 'SP'})),
      [{id: 20, nome: 'r', partido: 'NOVO', uf: 'SP'}])`);
  av(`__votacoesOrig = labsVotacoesPlenario`);
  av(`labsVotacoesPlenario = async () => ({ itens: __vs, falhas: 1, periodo: ['2025-01-01', '2025-06-30'] })`);
  ctx.__prompts = [];
  av(`chamarIA = async (o) => { __prompts.push(o); if (/SOMENTE com um objeto JSON/.test(o.prompt)) {
        const pos = /do PL/.test(o.prompt) ? 'rejeita' : /do PODE/.test(o.prompt) ? 'apoia' : 'condiciona';
        return { text: JSON.stringify({ posicao: pos, objecoes: ['obj ' + pos], concessao: 'c', argumento: 'a', risco: 'r' }) };
      } return { text: '## Mapa de objeções\\n- tudo certo' }; }`);
  av(`labsTrocarAba('aba-simulador')`);
  for (let t = 0; t < 100 && !document.querySelector('#smBancadas [data-sm-marca]'); t++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 50));
  const caixas = [...document.querySelectorAll('#smBancadas [data-sm-marca]')];
  ok(caixas.length === 4 && av(`sm.agentes[0].chave`) === '__governo' && av(`sm.agentes[1].sigla`) === 'PL', 'agentes carregados ao abrir a aba: Governo + partidos por tamanho');
  const modelos = [...document.querySelectorAll('#smModeloSintese option')].map(o => o.value);
  ok(modelos[0] === '' && modelos.includes('gemini-2.5-pro'), 'modelos da síntese: "o configurado" + os do provedor');
  document.getElementById('smProposta').value = 'Aprovar o texto do relator com prazo de 180 dias.';
  document.getElementById('smNumero').value = '';
  document.getElementById('smAno').value = '';
  await av(`smSimularClick()`);
  const saida = document.getElementById('smResultado').innerHTML;
  const agentes = ctx.__prompts.filter(o => /SOMENTE com um objeto JSON/.test(o.prompt));
  ok(agentes.length === 4 && ctx.__prompts.length === 5, 'uma chamada por bancada marcada (4) + a síntese');
  ok(ctx.__prompts.every(o => o.apiKey === 'chave-de-teste' && o.modelo === 'modelo-de-teste' && o.provedorId === 'gemini'), 'usa a chave, o provedor e o modelo configurados pelo usuário');
  ok(/5 chamadas de IA/.test(saida) && /modelo-de-teste/.test(saida), 'a tela diz quantas chamadas a rodada gastou e com que modelo');
  ok(/<div class="v">3<\/div><div class="l">cadeiras: apoia/.test(saida) && /<div class="v">5<\/div><div class="l">cadeiras: rejeita/.test(saida) && /<div class="v">1<\/div><div class="l">cadeiras: condiciona/.test(saida),
    'cadeiras por posição (PODE 3 apoia, PL 5 rejeita, NOVO 1 condiciona; Governo sem cadeira)');
  ok(/Mapa de objeções/.test(saida) && /1 votações não puderam ser lidas/.test(saida), 'síntese e aviso de votações não lidas aparecem');
  // ---- configuração dos agentes ----
  console.log('3b. Agentes configuráveis');
  const pCtx = av(`smPromptAgente({ tipo: 'partido', sigla: 'PL', cadeiras: 90, contexto: 'O líder já sinalizou apoio se o art. 5º cair.' }, null, null, 'Proposta qualquer aqui.', 6, [])`);
  ok(/CONTEXTO DADO PELA EQUIPE[\s\S]*art\. 5º cair/.test(pCtx), 'o contexto do analista entra no prompt do agente');
  const pFrente = av(`smPromptAgente({ tipo: 'frente', sigla: 'x-fpa', nome: 'Frente Parlamentar da Agropecuária', descricao: 'Prioriza segurança jurídica no campo.', cadeiras: 0 }, undefined, null, 'Proposta qualquer aqui.', 6, [])`);
  ok(/Frente Parlamentar da Agropecuária \(frente parlamentar\)/.test(pFrente) && /QUEM É E O QUE DEFENDE[\s\S]*segurança jurídica/.test(pFrente) && !/PERFIL \(votações/.test(pFrente), 'agente personalizado: descrição da equipe no lugar do perfil de votações');
  const pR2 = av(`smPromptAgente({ tipo: 'partido', sigla: 'PL', cadeiras: 90 }, null, null, 'Prazo de 360 dias.', 6,
      [{ proposta: 'Prazo de 180 dias.', resposta: { posicao: 'rejeita', objecoes: ['prazo curto'], concessao: '360 dias', argumento: '', risco: '' } }])`);
  ok(/RODADAS ANTERIORES[\s\S]*Rodada 1\. Proposta: Prazo de 180 dias[\s\S]*Sua resposta: rejeita[\s\S]*360 dias[\s\S]*PROPOSTA REFORMULADA \(rodada 2\)[\s\S]*Prazo de 360 dias/.test(pR2), 'rodada 2: o agente recebe o que disse antes e a proposta reformulada');
  ok(av(`smApoioEstimado([{ bancada: { tipo: 'frente', sigla: 'x', cadeiras: 300 }, resposta: { posicao: 'apoia' } }, { bancada: { tipo: 'partido', sigla: 'PL', cadeiras: 90 }, resposta: { posicao: 'apoia' } }]).apoia`) === 90, 'agente personalizado não soma cadeiras');
  const montados = av(`smMontarAgentes([{ sigla: 'PL', cadeiras: 90 }, { sigla: 'PT', cadeiras: 60 }], {
      PL: { tipo: 'partido', contexto: 'ctx salvo', quem: 'Ana', atualizadoEm: '2026-09-01T10:00:00Z' },
      'x-fpa': { tipo: 'frente', nome: 'FPA', descricao: 'desc', contexto: 'c2', atualizadoEm: '2026-09-02T10:00:00Z' } })`);
  ok(montados.length === 4 && montados[1].contexto === 'ctx salvo' && montados[1].salvo.quem === 'Ana' && montados[3].tipo === 'frente' && montados[3].descricao === 'desc' && !montados[3].marcado,
    'perfis salvos voltam preenchidos (contexto, quem salvou); personalizado salvo aparece desmarcado');

  // salvar perfil e adicionar agentes pela tela
  const gravados = [];
  const fetchAntes = ctx.fetch;
  ctx.fetch = async (url, o) => { if (o && (o.method === 'PUT' || o.method === 'DELETE')) { gravados.push({ url, o }); return { ok: true, json: async () => ({}) }; } return fetchAntes(url, o); };
  document.querySelector('[data-sm-ctx="1"]').value = 'Líder do PL fechou questão contra.';
  document.querySelector('[data-sm-ctx="1"]').dispatchEvent(new Event('input'));
  document.getElementById('smQuem').value = 'Beto';
  await av(`smSalvarAgente(1)`);
  const g = gravados[0];
  ok(g && /\/labs\/simulador\/perfis\/PL\.json$/.test(g.url) && JSON.parse(g.o.body).contexto === 'Líder do PL fechou questão contra.' && JSON.parse(g.o.body).quem === 'Beto', 'Salvar para a equipe grava o contexto no banco compartilhado, com quem salvou');
  document.getElementById('smNovoNome').value = 'Frente Parlamentar Evangélica';
  document.getElementById('smNovoDesc').value = 'Pauta de costumes; resiste a mudanças no ECA.';
  selecionar('smNovoTipo', 'frente');
  av(`smNovoAgenteClick()`);
  ok(av(`sm.agentes.some(a => a.chave === 'x-frente-parlamentar-evangelica' && a.tipo === 'frente' && a.marcado)`), 'agente personalizado adicionado e marcado');
  document.getElementById('smAddPartido').value = 'NOVO';
  av(`smAddPartidoClick()`);
  ok(av(`sm.agentes.filter(a => a.sigla === 'NOVO').length`) === 1, 'partido avulso não duplica');

  // rodada 1 + rodada 2 com modelos separados
  ctx.__prompts = [];
  armazenado.config = { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' };
  selecionar('smModeloAgentes', 'gemini-2.5-flash');
  selecionar('smModeloSintese', 'gemini-2.5-pro');
  av(`chamarIA = async (o) => { __prompts.push(o); if (/SOMENTE com um objeto JSON/.test(o.prompt)) {
        const r2 = /PROPOSTA REFORMULADA/.test(o.prompt);
        const pos = /do PL/.test(o.prompt) ? (r2 ? 'condiciona' : 'rejeita') : /do PODE/.test(o.prompt) ? 'apoia' : 'condiciona';
        return { text: JSON.stringify({ posicao: pos, objecoes: ['obj'], concessao: 'c', argumento: 'a', risco: 'r' }) };
      } return { text: '## O que mudou nesta rodada\\n- PL cedeu' }; }`);
  await av(`smSimularClick()`);
  const nAg = av(`sm.sessao.agentes.length`);
  ok(ctx.__prompts.length === nAg + 1 && ctx.__prompts.slice(0, nAg).every(o => o.modelo === 'gemini-2.5-flash') && ctx.__prompts[nAg].modelo === 'gemini-2.5-pro',
    `modelos separados: ${nAg} agentes no modelo dos agentes, a síntese no modelo da síntese`);
  ok(ctx.__prompts.some(o => /fechou questão contra/.test(o.prompt)) && ctx.__prompts.some(o => /resiste a mudanças no ECA/.test(o.prompt)), 'contexto e agente personalizado chegam à IA');
  document.getElementById('smPropostaNova').value = 'Aprovar o texto do relator com prazo de 360 dias.';
  await av(`smNovaRodadaClick()`);
  const s2 = document.getElementById('smResultado').innerHTML;
  const r2Prompts = ctx.__prompts.slice(nAg + 1);
  ok(r2Prompts.length === nAg + 1 && r2Prompts.filter(o => /PROPOSTA REFORMULADA \(rodada 2\)/.test(o.prompt)).length === nAg, 'rodada 2: mesmos agentes, cada um com seu histórico');
  ok(/RODADAS ANTERIORES/.test(r2Prompts[nAg].prompt) && /O que mudou nesta rodada/.test(r2Prompts[nAg].prompt), 'síntese da rodada 2 recebe a rodada anterior e explica o que mudou');
  ok(/Evolução da negociação/.test(s2) && /class="mudou"><span class="labs-pos condiciona">/.test(s2) && /Rodada 2/.test(s2), 'tela mostra a evolução, destacando quem mudou (PL: rejeita → condiciona)');
  ok(new RegExp(`Custo até aqui: ${2 * (nAg + 1)} chamadas`).test(s2) && /gemini-2\.5-flash/.test(s2) && /gemini-2\.5-pro/.test(s2), 'custo acumulado das rodadas, por modelo');
  // relatório em PDF: aba própria com todas as rodadas
  let escrito = '', impresso = 0;
  const ouvintes = {};
  const aba = { document: { write: h => { escrito += h; }, close: () => {}, readyState: 'complete',
    getElementById: id => id === 'btn-pdf' ? { addEventListener: (_e, f) => { ouvintes.pdf = f; } } : null }, print: () => { impresso++; }, addEventListener: () => {} };
  ctx.window.open = () => aba;
  vm.runInContext('window.open = globalThis.window.open', ctx);
  ok(document.getElementById('smRelatorio') && /Exportar relatório/.test(document.getElementById('smRelatorio').textContent), 'botão "Exportar relatório (PDF)" no resultado');
  await av(`smExportarRelatorio()`);
  ok(/Relatório de simulação de negociação/.test(escrito) && /<h2>Rodada 1<\/h2>/.test(escrito) && /<h2>Rodada 2<\/h2>/.test(escrito), 'relatório traz todas as rodadas');
  ok(/Evolução da negociação/.test(escrito) && /class="mudou"/.test(escrito) && /Parâmetros da simulação/.test(escrito) && /Aprovar o texto do relator com prazo de 360 dias/.test(escrito), 'evolução, parâmetros e a proposta de cada rodada');
  ok(/Não é previsão de placar/.test(escrito) && /print-color-adjust: exact/.test(escrito) && /O que mudou nesta rodada/.test(escrito), 'cautelas da tela, cores na impressão e a síntese');
  ok(new RegExp(`${2 * (nAg + 1)} concluídas`).test(escrito), 'custo das chamadas no relatório');
  ouvintes.pdf && ouvintes.pdf();
  ok(impresso === 1, '"Salvar em PDF" abre o diálogo de impressão');
  ctx.fetch = fetchAntes;

  const antesSemChave = ctx.__prompts.length;
  armazenado.config = {};
  document.getElementById('smResultado').innerHTML = '';
  await av(`smSimularClick()`);
  ok(/Nenhuma chave de IA/.test(document.getElementById('smStatus').textContent) && ctx.__prompts.length === antesSemChave, 'sem chave de IA: avisa e não chama nada');

  // ---------- 4. mapa: núcleo ----------
  console.log('4. Mapa Territorial — núcleo');
  const N = require(path.join(RAIZ, 'labs-mapa-nucleo.js'));
  ok(JSON.stringify(N.lmnCampos('"a";"b;c";"d ""e"""')) === JSON.stringify(['a', 'b;c', 'd "e"']), 'CSV: ; dentro de aspas e aspas escapadas');
  const CAB = '"DT_GERACAO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"CD_CARGO";"DS_CARGO";"SQ_CANDIDATO";"NM_CANDIDATO";"NM_URNA_CANDIDATO";"SG_PARTIDO";"QT_VOTOS_NOMINAIS_VALIDOS"';
  const lin = (mun, nome, zona, cargo, sq, civil, urna, part, v) => `"x";"SP";"${mun}";"${nome}";"${zona}";"${cargo}";"${cargo === '6' ? 'DEPUTADO FEDERAL' : 'DEPUTADO ESTADUAL'}";"${sq}";"${civil}";"${urna}";"${part}";"${v}"`;
  const CSV_SP = [CAB,
    lin('71072', 'SÃO PAULO', '1', '6', '111', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 'PODE', 1000),
    lin('71072', 'SÃO PAULO', '2', '6', '111', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 'PODE', 500),
    lin('71072', 'SÃO PAULO', '1', '6', '999', 'OUTRO CANDIDATO', 'OUTRO', 'PT', 8500),
    lin('62910', 'MOJI MIRIM', '5', '6', '111', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 'PODE', 300),
    lin('62910', 'MOJI MIRIM', '5', '6', '999', 'OUTRO CANDIDATO', 'OUTRO', 'PT', 700),
    lin('71072', 'SÃO PAULO', '1', '7', '111', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 'PODE', 99999),
    lin('71072', 'SÃO PAULO', '1', '6', '222', 'JOSÉ ANTÔNIO PEREIRA', 'ZÉ DO POVO', 'MDB', 400),
    lin('71072', 'SÃO PAULO', '1', '6', '333', 'FULANO A', 'CICLANO', 'X', 10),
    lin('71072', 'SÃO PAULO', '1', '6', '334', 'FULANO B', 'CICLANO', 'Y', 10),
  ];
  const alvos = [
    { id: '1', nome: 'Maria Souza', nomeCivil: 'Maria da Silva Souza', uf: 'SP' },
    { id: '2', nome: 'Zé do Povo', nomeCivil: 'José Antonio Pereira Filho', uf: 'SP' },
    { id: '3', nome: 'Ciclano', nomeCivil: 'Nome Que Não Existe', uf: 'SP' },
    { id: '4', nome: 'Beltrano', nomeCivil: 'Beltrano de Tal', uf: 'MG' },
  ];
  const ag = N.lmnAgregador(alvos);
  ag.novoArquivo();
  CSV_SP.forEach(l => ag.linha(l));
  const res = ag.resultado();
  ok(res.deputados['1'] && res.deputados['1'].total === 1800 && res.deputados['1'].municipios['71072'] === 1500, 'nome civil casa; zonas somadas por município; estadual (cargo 7) ignorado');
  ok(res.deputados['2'] && res.deputados['2'].total === 400 && res.deputados['2'].partidoEleicao === 'MDB', 'sem par no civil → casa pelo nome de urna único (e guarda o partido da eleição)');
  const nao = Object.fromEntries(res.naoEncontrados.map(n => [n.id, n.motivo]));
  ok(nao['3'] === 'nome de urna ambíguo', 'nome de urna repetido não é aceito');
  ok(nao['4'] === 'arquivo de MG não processado', 'UF sem arquivo é dita, não zerada');
  ok(res.municipios['71072'].t === 10420 && res.municipios['62910'].t === 1000, 'total de votos de deputado federal por município');
  let erroCab = ''; try { const a2 = N.lmnAgregador(alvos); a2.novoArquivo(); a2.linha('"A";"B"'); } catch (e) { erroCab = e.message; }
  ok(/Faltam as colunas/.test(erroCab), 'arquivo fora do formato: erro claro dizendo as colunas que faltam');
  const IBGE_SP = [{ id: 3550308, nome: 'São Paulo' }, { id: 3530805, nome: 'Mogi Mirim' }, { id: 3530706, nome: 'Mogi Guaçu' }];
  const reg = N.lmnParaIbge(res, { SP: IBGE_SP });
  ok(reg.deputados['1'].municipios.m3550308 === 1500 && reg.deputados['1'].municipios.m3530805 === 300, 'ponte TSE → IBGE: acento e "Moji"/"Mogi" resolvidos; chaves com prefixo m');
  ok(reg.municipios.SP.m3550308.t === 10420 && !reg.semPar.length, 'totais por município no código IBGE');
  const r2 = N.lmnResolvedor(IBGE_SP);
  ok(r2('Mogi Guacu') === '3530706' && r2('Santos') === null, 'resolvedor: sem acento casa; município inexistente é null');
  ok(JSON.stringify(N.lmnLocalidade('CAMPINAS - SP')) === JSON.stringify({ tipo: 'municipio', nome: 'CAMPINAS', uf: 'SP' }) &&
     N.lmnLocalidade('SÃO PAULO (UF)').tipo === 'uf' && N.lmnLocalidade('MÚLTIPLO').tipo === 'outro', 'localidade da emenda: município, UF, múltiplo');
  const em = N.lmnAgregarEmendas([
    { valorPago: '1.000,50', localidadeDoGasto: 'SÃO PAULO - SP' },
    { valorPago: '2.000,00', localidadeDoGasto: 'MÚLTIPLO' },
    { valorPago: '0,00', localidadeDoGasto: 'MOGI MIRIM - SP' },
    { valorPago: '500,00', localidadeDoGasto: 'SANTOS - SP' },
  ], (n, uf) => uf === 'SP' ? r2(n) : null);
  ok(em.total === 3500.5 && em.municipais.m3550308 === 1000.5 && em.outros['MÚLTIPLO'] === 2000 && em.outros['SANTOS - SP'] === 500 && em.n === 4,
    'emendas: só o pago; município identificado vira círculo; o resto fica listado pelo rótulo');
  ok(N.lmnNomeAutor('Fábio Macedo') === 'FABIO MACEDO', 'nome do autor na forma do Portal (maiúsculas, sem acento)');

  // ---------- 5. mapa: tela ----------
  console.log('5. Mapa Territorial — tela');
  const bytes = Buffer.from(CSV_SP.join('\n'), 'latin1');
  ctx.__arquivo = {
    size: bytes.length,
    stream: () => new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 37) c.enqueue(new Uint8Array(bytes.subarray(i, i + 37))); c.close(); } }),
  };
  ctx.ReadableStream = ReadableStream;
  ctx.__linhas = [];
  await av(`mpLerArquivo(__arquivo, l => __linhas.push(l))`);
  ok(ctx.__linhas.length === CSV_SP.length && ctx.__linhas[1].includes('SÃO PAULO') && ctx.__linhas[7].includes('JOSÉ ANTÔNIO'), 'File lido em pedaços de 37 bytes, latin1 decodificado, linhas inteiras');
  const GEO = { type: 'FeatureCollection', features: [
    { properties: { codarea: '3550308' }, geometry: { type: 'Polygon', coordinates: [[[-46.8, -23.4], [-46.4, -23.4], [-46.4, -23.8], [-46.8, -23.8], [-46.8, -23.4]]] } },
    { properties: { codarea: '3530805' }, geometry: { type: 'MultiPolygon', coordinates: [[[[-47.0, -22.3], [-46.8, -22.3], [-46.8, -22.5], [-47.0, -22.5], [-47.0, -22.3]]]] } },
  ] };
  ctx.__geo = GEO; ctx.__reg = reg;
  av(`mpRender(Object.assign({ total: 1800, partidoEleicao: 'PODE', nomeUrna: 'MARIA SOUZA', nome: 'Maria Souza' }, __reg.deputados['1']), __geo, __reg.municipios.SP,
      { total: 1000.5, n: 1, municipais: { m3550308: 1000.5 }, outros: { 'MÚLTIPLO': 200 } }, '2025')`);
  const mapa = document.getElementById('mpResultado').innerHTML;
  ok((mapa.match(/<path /g) || []).length === 2 && (mapa.match(/<circle /g) || []).length === 1, 'SVG: um contorno por município, um círculo por município com emenda');
  ok(/data-k="m3550308"/.test(mapa) && /MÚLTIPLO/.test(mapa) && /83,3%/.test(mapa), 'tooltip por código; emenda sem município listada; 1.500 de 1.800 votos (83,3%) onde teve emenda');
  const q = av(`mpQuebras([0, 0.1, 0.2, 0.3, 0.4, 0.5])`);
  ok(q.length === 3 && q.every((x, i) => !i || x > q[i - 1]) && av(`mpCor(0, [0.1])`) === av(`MP_CORES[0]`), 'escala por quantis, sem quebra repetida; zero voto na cor de fundo');

  // ---------- 6. bot: leitor de ZIP ----------
  console.log('6. Bot — leitor de ZIP');
  // config/firebase de mentira: o teste não precisa de .env nem de dependências do bot
  const cfg = path.join(RAIZ, 'bot', 'src', 'config.js');
  require.cache[require.resolve(cfg)] = { id: cfg, filename: cfg, loaded: true, exports: { TRANSPARENCIA_CHAVE: '', FIREBASE_URL: 'http://x' } };
  const B = require(path.join(RAIZ, 'bot', 'src', 'labsmapa.js'));
  const tmp = path.join(os.tmpdir(), `labs-zip-${process.pid}.zip`);
  const entradas = [
    { nome: 'leiame.pdf', dado: Buffer.from('%PDF'), metodo: 0 },
    { nome: 'votacao_candidato_munzona_2022_SP.csv', dado: bytes, metodo: 8 },
    { nome: 'votacao_candidato_munzona_2022_BRASIL.csv', dado: bytes, metodo: 8 },
  ];
  const locais = [], centrais = [];
  let off = 0;
  for (const e of entradas) {
    const comp = e.metodo === 8 ? zlib.deflateRawSync(e.dado) : e.dado;
    const nome = Buffer.from(e.nome);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.metodo, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.dado.length, 22); lh.writeUInt16LE(nome.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.metodo, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.dado.length, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(off, 42);
    locais.push(lh, nome, comp); centrais.push(ch, nome);
    off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entradas.length, 8); eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  fs.writeFileSync(tmp, Buffer.concat([...locais, cd, eocd]));
  try {
    const lidas = await B.entradasZip(tmp);
    ok(lidas.length === 3 && lidas[1].nome.endsWith('_SP.csv') && lidas[1].tamanho === bytes.length, 'diretório central lido (nomes, tamanhos)');
    ok(B.ufDaEntrada(lidas[1].nome) === 'SP' && B.ufDaEntrada(lidas[2].nome) === null && B.ufDaEntrada(lidas[0].nome) === null, 'só os CSV por estado entram (BRASIL e leia-me ficam fora — senão contaria em dobro)');
    const agB = N.lmnAgregador(alvos);
    agB.novoArquivo();
    await B.lerLinhasEntrada(tmp, lidas[1], l => agB.linha(l));
    const rb = agB.resultado();
    ok(rb.deputados['1'].total === 1800 && rb.municipios['71072'].n === 'SÃO PAULO', 'CSV descompactado de dentro do zip dá o mesmo resultado (latin1 preservado)');
    let txt = '';
    for await (const c of await B.fluxoEntrada(tmp, lidas[0])) txt += c.toString('latin1');
    ok(txt === '%PDF', 'entrada sem compressão (método 0) também é lida');
    ok(/votacao_candidato_munzona_2022\.zip$/.test(B.urlTse('2022')), 'URL do TSE montada pelo ano');
  } finally { fs.unlinkSync(tmp); }

  // ---------- 7. correções da varredura de bugs ----------
  console.log('7. Correções da varredura');
  // (1) bloco que acabou (AVANTE-SOLIDARIEDADE-PRD) e prefixo das abreviações
  ctx.__ORI3 = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }, { siglaPartidoBloco: 'Bl AvanSolidPrd...', orientacaoVoto: 'Sim' }];
  av(`LABS_SIGLAS = new Set(['avante', 'solidariedade', 'prd', 'psd', 'psdb', 'pl', 'pp', 'uniao', 'republicanos'])`);
  ok(av(`labsOrientacao(__ORI3, 'AVANTE', [])`) === 'Sim' && av(`labsOrientacao(__ORI3, 'SOLIDARIEDADE', [])`) === 'Sim' && av(`labsOrientacao(__ORI3, 'PRD', [])`) === 'Sim',
    '"Bl AvanSolidPrd...": AVANTE e SOLIDARIEDADE achados pelo prefixo (antes só o PRD)');
  ok(av(`labsOrientacao([{ siglaPartidoBloco: 'Bl PsdPp', orientacaoVoto: 'Sim' }], 'PSDB', [])`) === null, 'prefixo não confunde: "psd" é sigla de outro partido, não vira PSDB');
  ok(av(`labsOrientacao([{ siglaPartidoBloco: 'Bl UniRep', orientacaoVoto: 'Não' }], 'REPUBLICANOS', [])`) === 'Não' && av(`labsOrientacao([{ siglaPartidoBloco: 'Bl UniRep', orientacaoVoto: 'Não' }], 'UNIÃO', [])`) === 'Não', '"Rep" → REPUBLICANOS, "Uni" → UNIÃO');
  ok(av(`labsOrientacao([{ siglaPartidoBloco: 'PL', orientacaoVoto: 'Obstrução' }], 'PL', [])`) === 'Obstrução', 'obstrução é lida como orientação');
  const vsOb = [{ votacao: { id: 'o1', data: '2026-05-01' }, orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }, { siglaPartidoBloco: 'PL', orientacaoVoto: 'Obstrução' }],
    votos: [{ deputado_: { id: 1, siglaPartido: 'PL' }, tipoVoto: 'Obstrução' }, { deputado_: { id: 2, siglaPartido: 'PL' }, tipoVoto: 'Obstrução' }, { deputado_: { id: 3, siglaPartido: 'PL' }, tipoVoto: 'Sim' }] }];
  ctx.__vsOb = vsOb;
  const pOb = av(`smPerfis(__vsOb, ['PL']).PL`);
  ok(pOb.comparaveisOrientacao === 1 && pOb.alinhamentoOrientacao === 0 && pOb.comparaveis === 1 && pOb.alinhamentoGoverno === 0, 'obstrução contra o Sim do Governo conta como divergência (na orientação e no voto)');
  ctx.__vsObj = [{ votacao: { id: 'd1', data: '2026-06-02', descricao: 'Aprovado o Requerimento de Urgência (Art. 155 do RICD).', proposicaoObjeto: 'REQ 3839/2025' },
    orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }], votos: [{ deputado_: { id: 1, siglaPartido: 'PL' }, tipoVoto: 'Não' }, { deputado_: { id: 2, siglaPartido: 'PL' }, tipoVoto: 'Não' }] }];
  ctx.__vs1 = [{ votacao: { id: 'u1', data: '2026-06-03' }, orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }], votos: [{ deputado_: { id: 9, siglaPartido: 'MISSÃO' }, tipoVoto: 'Não' }, { deputado_: { id: 1, siglaPartido: 'PL' }, tipoVoto: 'Sim' }] },
                { votacao: { id: 'u2', data: '2026-06-04' }, orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }], votos: [{ deputado_: { id: 1, siglaPartido: 'PL' }, tipoVoto: 'Sim' }, { deputado_: { id: 2, siglaPartido: 'PL' }, tipoVoto: 'Sim' }] }];
  const p1 = av(`smPerfis(__vs1, ['MISSÃO', 'PL'])`);
  ok(p1['MISSÃO'].comparaveis === 1 && p1['MISSÃO'].alinhamentoGoverno === 0 && p1.PL.comparaveis === 1, 'bancada de 1 deputado: o voto dele é o da bancada; nas maiores, 1 voto isolado não define maioria');
  ok(/^2026-06-02: REQ 3839\/2025 — Aprovado o Requerimento de Urgência/.test(av(`smPerfis(__vsObj, ['PL']).PL.divergencias[0]`)), 'divergência diz a proposição votada (proposicaoObjeto), não só "requerimento de urgência"');

  // (2) blocos: falha não fica guardada; carrega os da legislatura (inclusive os extintos)
  const fAntes = ctx.fetch;
  av(`LABS_BLOCOS = null`);
  ctx.fetch = async () => { throw new Error('rede fora'); };
  const b1 = await av(`labsCarregarBlocos()`);
  ok(b1.length === 0 && av(`LABS_BLOCOS_FALHOU`) === true && av(`LABS_BLOCOS`) === null, 'falha ao ler os blocos: avisa e NÃO guarda o vazio');
  const pedidas = [];
  ctx.fetch = async url => {
    pedidas.push(url);
    const j = /legislaturas/.test(url) ? { dados: [{ id: 57 }] }
      : /blocos\?itens/.test(url) ? { dados: [{ id: '589', nome: 'UNIÃO, PP, PSD, REPUBLICANOS, MDB, Federação PSDB CIDADANIA, PODE', federacao: false }] }
      : /idLegislatura=57/.test(url) ? { dados: [{ id: '590', nome: 'AVANTE, SOLIDARIEDADE, PRD', federacao: false }, { id: '584', nome: 'Federação Brasil da Esperança', federacao: true }] }
      : /blocos\/589\/partidos/.test(url) ? { dados: ['PSDB', 'CIDADANIA', 'UNIÃO', 'PP', 'REPUBLICANOS', 'PSD', 'MDB', 'PODE'].map(sigla => ({ sigla })) }
      : { dados: [] };
    return { ok: true, status: 200, json: async () => j };
  };
  const b2 = await av(`labsCarregarBlocos()`);
  ok(b2.length === 2 && av(`LABS_BLOCOS_FALHOU`) === false && b2.some(b => b.ordem.join() === 'avante,solidariedade,prd' && b.membros.has('avante')), 'tenta de novo; traz o bloco extinto 590 (sem lista de partidos → vale a ordem do nome)');
  ok(av(`labsOrientacao(__ORI3, 'AVANTE')`) === 'Sim', 'com os blocos da legislatura, "Bl AvanSolidPrd..." resolve pela composição');

  // (3) votação sem lista de votos (404) não é "falha de leitura"
  ctx.fetch = async (url, o) => {
    if (o && o.method === 'PUT') return { ok: true, json: async () => ({}) };
    if (/firebaseio/.test(url)) return { ok: true, status: 200, json: async () => null };
    if (/\/votacoes\?/.test(url)) return { ok: true, status: 200, json: async () => ({ dados: [
      { id: 'n1', siglaOrgao: 'PLEN', data: av(`labsPeriodoMeses(6)[1]`) }, { id: 's1', siglaOrgao: 'PLEN', data: av(`labsPeriodoMeses(6)[1]`) }], links: [] }) };
    if (/votacoes\/s1\//.test(url)) return { ok: false, status: 404, json: async () => ({}) };
    if (/votacoes\/n1\/votos/.test(url)) return { ok: true, status: 200, json: async () => ({ dados: [{ deputado_: { id: 1, siglaPartido: 'PL' }, tipoVoto: 'Sim' }] }) };
    if (/votacoes\/n1\/orientacoes/.test(url)) return { ok: true, status: 200, json: async () => ({ dados: [] }) };
    if (/votacoes\/.*\/votos|orientacoes/.test(url)) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ dados: [] }) };
  };
  av(`LABS_BLOCOS = []`);
  const rv = await av(`__votacoesOrig(6)`);
  ok(rv.falhas === 0 && rv.itens.length === 1, 'votação simbólica (404 nos votos) sai do cálculo sem contar como falha');
  ctx.fetch = fAntes;

  // (4) posição da IA lida com tolerância; "não legível" ≠ "sem resposta"
  ok(av(`smPosicao('Apoia parcialmente')`) === 'condiciona' && av(`smPosicao('apoio')`) === 'apoia' && av(`smPosicao('condicionado')`) === 'condiciona'
    && av(`smPosicao('Contrário')`) === 'rejeita' && av(`smPosicao('talvez')`) === 'indefinida', 'posição por prefixo: "apoio", "condicionado", "contrário", "apoia parcialmente"');
  const apx = av(`smApoioEstimado([{ bancada: { tipo: 'partido', sigla: 'PL', cadeiras: 98 }, resposta: { posicao: 'indefinida' } }, { bancada: { tipo: 'partido', sigla: 'PT', cadeiras: 65 }, resposta: null }])`);
  ok(apx.indefinida === 98 && apx.semResposta === 65 && apx.total === 163, 'cadeiras de quem respondeu sem posição legível separadas das de chamada que falhou');

  // (5) núcleo do mapa
  const ag2 = N.lmnAgregador(alvos);
  ag2.novoArquivo(); CSV_SP.forEach(l => ag2.linha(l));
  ag2.novoArquivo();
  let dup = ''; try { CSV_SP.forEach(l => ag2.linha(l)); } catch (e) { dup = e.message; }
  ok(/SP aparece em mais de um arquivo/.test(dup), 'mesmo estado em dois arquivos (ou BRASIL + estado): recusa em vez de somar em dobro');
  const CAB2 = CAB.replace('"QT_VOTOS_NOMINAIS_VALIDOS"', '"QT_VOTOS_NOMINAIS";"QT_VOTOS_NOMINAIS_VALIDOS";"NM_TIPO_DESTINACAO_VOTOS"');
  const l2 = (mun, nome, sq, civ, urna, nom, val, dest) => `"x";"SP";"${mun}";"${nome}";"1";"6";"DEPUTADO FEDERAL";"${sq}";"${civ}";"${urna}";"PODE";"${nom}";"${val}";"${dest}"`;
  const ag3 = N.lmnAgregador(alvos);
  ag3.novoArquivo();
  [CAB2, l2('71072', 'SÃO PAULO', '111', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 700, 0, 'Anulado sub judice'),
   l2('62910', 'MOJI MIRIM', '111', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 0, 0, 'Válido'),
   l2('62910', 'MOJI MIRIM', '999', 'OUTRO', 'OUTRO', 50, 50, 'Válido')].forEach(l => ag3.linha(l));
  const r3 = ag3.resultado().deputados['1'];
  ok(r3.total === 700 && r3.municipios['71072'] === 700, 'candidato "Anulado sub judice" na data do arquivo: usa os votos nominais');
  ok(!('62910' in r3.municipios), 'município sem voto não conta em "municípios com voto"');
  const IBGE_RN = [{ id: 2401206, nome: 'Arez' }, { id: 2406403, nome: 'Lajes' }, { id: 2405306, nome: 'Januário Cicco' }];
  const rRN = N.lmnResolvedor(IBGE_RN, 'RN');
  ok(rRN('ARÊS') === '2401206' && rRN('BOA SAÚDE') === '2405306', 'apelidos TSE → IBGE: Arês → Arez, Boa Saúde → Januário Cicco');
  const col = N.lmnParaIbge({ municipios: { a: { n: 'AREZ', uf: 'RN', t: 1000 }, b: { n: 'ARÊS', uf: 'RN', t: 100 } },
    deputados: { 1: { nome: 'X', uf: 'RN', total: 150, municipios: { a: 100, b: 50 } } } }, { RN: IBGE_RN });
  ok(col.municipios.RN.m2401206.t === 1100 && col.deputados['1'].municipios.m2401206 === 150, 'dois nomes do TSE no mesmo município: totais somam (fatia 150/1100, não 150%)');
  const em2 = N.lmnAgregarEmendas([
    { nomeAutor: 'MARIA SOUZA', valorPago: '1.000,00', valorRestoPago: '4.000,00', localidadeDoGasto: 'SÃO PAULO - SP' },
    { nomeAutor: 'MARIA SOUZA FILHA', valorPago: '9.999,00', valorRestoPago: '0,00', localidadeDoGasto: 'MÚLTIPLO' },
  ], (n, uf) => uf === 'SP' ? r2(n) : null, 'Maria Souza');
  ok(em2.total === 5000 && em2.pagoNoAno === 1000 && em2.restoPago === 4000 && em2.deOutroAutor === 1 && em2.nomesMun.m3550308 === 'SÃO PAULO - SP',
    'emendas: pago no ano + restos a pagar; registro de outro autor descartado; nome do município guardado');
  const upd = N.lmnAtualizacao(reg, res, { ufs: ['MG'] }, 'teste', new Date('2026-09-29T12:00:00Z'));
  ok(upd['deputados/1'] && upd['municipios/SP'] && upd.meta.ufs.join() === 'MG,SP' && upd.meta.origem === 'teste', 'gravação numa atualização só (multi-caminho), mantendo os estados já gravados');

  // (6) tela do mapa
  const agora = Date.parse('2026-09-29T12:00:00Z');
  ctx.__agora = agora;
  ok(av(`mpCacheFresco({ atualizadoEm: '2025-06-01T00:00:00Z', restoPago: 0 }, 2025, __agora)`) === false, 'cache de 2025 gravado em junho/2025 não fica congelado');
  ok(av(`mpCacheFresco({ atualizadoEm: '2026-09-27T12:00:00Z', restoPago: 0 }, 2025, __agora)`) === true && av(`mpCacheFresco({ atualizadoEm: '2026-09-29T00:00:00Z', total: 5 }, 2026, __agora)`) === false,
    'ano passado vale 7 dias; cache do formato antigo (sem restos a pagar) é refeito');
  const leg = av(`mpLegenda(mpQuebras([0.0003, 0.0003, 0.0003, 0.0003, 0.0003, 0.0005, 0.0005, 0.4]))`);
  ok(!leg.some(([, r]) => /(^|–)0%/.test(r) || /0%–0%/.test(r)) && new Set(leg.map(x => x[1])).size === leg.length, 'legenda sem "0%–0%": faixas únicas e fatias pequenas com 2 algarismos (' + leg.map(x => x[1]).join(' | ') + ')');
  const U = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]] };
  ctx.__U = U;
  ok(av(`(() => { const pr = mpProjetar({ features: [{ geometry: __U }] }); const c = mpCentro(__U, pr.p); return mpDentro(c, __U.coordinates[0].map(pr.p)); })()`), 'círculo da emenda cai DENTRO de município côncavo (em forma de U)');
  av(`mpRender(Object.assign({ total: 1800, partidoEleicao: 'PODE', nomeUrna: 'MARIA SOUZA', nome: 'Maria Souza' }, __reg.deputados['1']), __geo, __reg.municipios.SP,
      { total: 1900, pagoNoAno: 1900, restoPago: 0, n: 2, municipais: { m3550308: 1000, m3106200: 900 }, nomesMun: { m3106200: 'BELO HORIZONTE - MG' }, outros: {} }, '2025')`);
  const m2 = document.getElementById('mpResultado').innerHTML;
  ok(/Em municípios de outros estados/.test(m2) && /BELO HORIZONTE - MG/.test(m2) && !/>m3106200</.test(m2) && (m2.match(/<circle /g) || []).length === 1 && /r="16\.0"/.test(m2),
    'emenda de outro estado listada pelo nome, fora do mapa, sem encolher os círculos do estado');
  ok(/votos NOMINAIS \(sem os votos só na legenda\)/.test(m2), 'a legenda diz o denominador da fatia');
  const fBad = ctx.fetch;
  ctx.fetch = async url => ({ ok: true, json: async () => /meta/.test(url) ? null : { 1: { nome: 'Ana', uf: 'SP' }, 2: { uf: 'SP' }, 3: 'lixo' } });
  await av(`mpCarregar()`);
  ok(document.querySelectorAll('#mpDep option').length === 1, 'registro torto no banco não trava a lista de deputados');
  ctx.fetch = fBad;
  ctx.__arqs = [{ name: 'votacao_candidato_munzona_2018_SP.csv' }, { name: 'votacao_candidato_munzona_2022_SP.csv' }];
  Object.defineProperty(document.getElementById('mpArquivos'), 'files', { value: ctx.__arqs, configurable: true });
  await av(`mpProcessarClick()`);
  ok(/eleições diferentes \(2018, 2022\)/.test(document.getElementById('mpUpStatus').textContent), 'arquivos de eleições diferentes: recusa em vez de somar');

  // (7) bot
  const vazio = path.join(os.tmpdir(), `labs-zip0-${process.pid}.zip`);
  {
    const nome = Buffer.from('votacao_candidato_munzona_2022_AC.csv');
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(nome.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(nome.length, 28);
    const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10);
    eo.writeUInt32LE(46 + nome.length, 12); eo.writeUInt32LE(30 + nome.length, 16);
    fs.writeFileSync(vazio, Buffer.concat([lh, nome, ch, nome, eo]));
  }
  try {
    const [e0] = await B.entradasZip(vazio);
    let li = 0; await B.lerLinhasEntrada(vazio, e0, () => li++);
    ok(li === 0, 'entrada vazia no zip é lida como vazia (antes derrubava a coleta)');
  } finally { fs.unlinkSync(vazio); }
  let erroAno = ''; try { await B.atualizarMapaTerritorial({ ano: '2024' }); } catch (e) { erroAno = e.message; }
  ok(/não suportada/.test(erroAno), '/labsmapa 2024 (eleição municipal) é recusado antes de baixar qualquer coisa');
  const fetchNode = global.fetch;
  const antes = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('sispode-tse-munzona-')));
  global.fetch = async url => {
    if (/\/deputados\?/.test(url)) return new Response(JSON.stringify({ dados: [{ id: 1, nome: 'Maria Souza', siglaUf: 'SP' }] }));
    if (/\/deputados\/1/.test(url)) return new Response(JSON.stringify({ dados: { nomeCivil: 'Maria da Silva Souza' } }));
    let n = 0;
    return new Response(new ReadableStream({ pull(c) { if (++n > 3) c.error(new Error('ECONNRESET simulado')); else c.enqueue(new Uint8Array(100000)); } }));
  };
  let erroDl = ''; try { await B.atualizarMapaTerritorial({ ano: '2022' }); } catch (e) { erroDl = e.message; }
  global.fetch = fetchNode;
  const sobra = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('sispode-tse-munzona-') && !antes.has(f));
  ok(/ECONNRESET/.test(erroDl) && !sobra.length, 'download que cai no meio: o arquivo parcial é apagado');

  // ---------- 8. estudos recentes: pontos, notas, ancoragem, Governo primeiro, teste contra o passado ----------
  console.log('8. Ajustes vindos dos estudos');
  // (2) proposta em pontos
  ok(JSON.stringify(av(`smPontos('1. Prazo de 180 dias\\n2) Supressão do art. 12\\n   e do art. 13\\n- Fundo de compensação')`)) === JSON.stringify(['Prazo de 180 dias', 'Supressão do art. 12 e do art. 13', 'Fundo de compensação']),
    'pontos: números e traços; linha de continuação junta ao ponto anterior');
  ok(av(`smPontos('Aprovar o texto do relator.')`).length === 1, 'texto corrido = um ponto só');
  const pP = av(`smPromptAgente({ tipo: 'partido', sigla: 'PL', cadeiras: 90 }, null, null, '1. Prazo de 180 dias\\n2. Supressão do art. 12', 6, [])`);
  ok(/1\. Prazo de 180 dias\n2\. Supressão do art\. 12/.test(pP) && /Para CADA um dos 2 pontos/.test(pP) && /"pontos":\[\{"n":1,"acao":"apoia\|rejeita\|reformula\|troca","importancia"/.test(pP), 'prompt pede ação e importância (1–5) por ponto');
  const lr = av(`smLerResposta('{"posicao":"rejeita","objecoes":[{"texto":"prazo curto","base":"perfil"},{"texto":"custo","base":"chute"},"sem objeto"],"pontos":[{"n":1,"acao":"Reformular","importancia":5,"redacao":"360 dias"},{"n":2,"acao":"apoio","importancia":"2"}],"notas":"Pedi 360 dias; linha vermelha: prazo."}')`);
  ok(lr.objecoes[0].base === 'perfil' && lr.objecoes[1].base === 'nenhuma' && lr.objecoes[2].base === 'nenhuma', 'ancoragem: base declarada é lida; base inválida ou ausente vira "sem base"');
  ok(lr.pontos[0].acao === 'reformula' && lr.pontos[0].importancia === 5 && lr.pontos[0].redacao === '360 dias' && lr.pontos[1].acao === 'apoia' && lr.pontos[1].importancia === 2, 'pontos lidos com tolerância ("Reformular", "apoio", "2")');
  ok(lr.notas === 'Pedi 360 dias; linha vermelha: prazo.', 'notas do agente lidas');
  // (3) notas próprias voltam ao MESMO agente na rodada seguinte
  ctx.__lr = lr;
  const pN = av(`smPromptAgente({ tipo: 'partido', sigla: 'PL', cadeiras: 90 }, null, null, 'Prazo de 360 dias.', 6, [{ proposta: 'Prazo de 180 dias.', resposta: __lr }])`);
  ok(/SUAS PRÓPRIAS NOTAS DA RODADA ANTERIOR[\s\S]*Pedi 360 dias; linha vermelha: prazo\./.test(pN), 'rodada 2: o agente recebe as notas que ELE escreveu (não um resumo pronto)');
  ok(/"notas":"suas notas para a próxima rodada"/.test(pN) && /Defenda os interesses desse ator com firmeza/.test(pN), 'pede as notas de novo e instrui a não ceder só para agradar');
  // (4) ancoragem no prompt e na tela
  ok(/"base": "perfil" \(dados de votação acima\)[\s\S]*"nenhuma" \(sem apoio nos dados — prefira isso a inventar\)/.test(pP), 'prompt exige a base de cada objeção, com "nenhuma" como saída honesta');
  // mapa por ponto
  const mapaP = av(`smMapaPontos({ proposta: '1. A\\n2. B', resultados: [
    { bancada: { tipo: 'partido', sigla: 'PL', cadeiras: 90, nome: 'PL' }, resposta: { pontos: [{ n: 1, acao: 'apoia', importancia: 2 }, { n: 2, acao: 'rejeita', importancia: 5 }] } },
    { bancada: { tipo: 'partido', sigla: 'PT', cadeiras: 60, nome: 'PT' }, resposta: { pontos: [{ n: 1, acao: 'rejeita', importancia: 3 }, { n: 2, acao: 'apoia', importancia: 4 }] } },
    { bancada: { tipo: 'governo', sigla: '__governo', cadeiras: 0, nome: 'Governo' }, resposta: { pontos: [{ n: 1, acao: 'apoia', importancia: 5 }] } }] })`);
  ok(mapaP.linhas[0].cadeirasApoio === 90 && mapaP.linhas[0].cadeirasRejeicao === 60 && mapaP.linhas[1].cadeirasRejeicao === 90 && mapaP.linhas[1].celulas[2].acao === null,
    'mapa por ponto: cadeiras que apoiam/rejeitam cada ponto; Governo não soma cadeiras');

  // (5) Governo primeiro — ligado e desligado
  armazenado.config = { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' };
  av(`sm.agentes.forEach(a => { a.marcado = a.tipo === 'governo' || (a.tipo === 'partido' && ['PL', 'PODE'].includes(a.sigla)); })`);
  av(`chamarIA = async (o) => { __prompts.push(o); if (/SOMENTE com um objeto JSON/.test(o.prompt)) {
        const gov = /LIDERANÇA DO GOVERNO na Câmara/.test(o.prompt);
        return { text: JSON.stringify({ posicao: gov ? 'apoia' : 'condiciona', objecoes: [{ texto: gov ? 'nenhuma' : 'x', base: 'proposta' }], concessao: '', argumento: '', risco: '',
          pontos: [{ n: 1, acao: 'apoia', importancia: 3 }, { n: 2, acao: gov ? 'apoia' : 'troca', importancia: 4, troca: 'aceito se cair o 1' }], notas: 'nota ' + (gov ? 'gov' : 'bancada') }) };
      } return { text: '## Por ponto\\n- ok' }; }`);
  document.getElementById('smProposta').value = '1. Prazo de 180 dias para regulamentar\n2. Supressão do art. 12 do substitutivo';
  const gp = document.getElementById('smGovPrimeiro');
  gp.checked = true; gp.setAttribute('checked', '');
  ctx.__prompts = [];
  await av(`smSimularClick()`);
  const pr = ctx.__prompts.filter(o => /SOMENTE com um objeto JSON/.test(o.prompt));
  ok(pr.length === 3 && /LIDERANÇA DO GOVERNO na Câmara/.test(pr[0].prompt) && pr.slice(1).every(o => /POSIÇÃO JÁ DECLARADA PELA LIDERANÇA DO GOVERNO NESTA RODADA:\napoia\./.test(o.prompt)),
    'Governo primeiro LIGADO: o Governo responde antes e as bancadas recebem a posição dele');
  const htmlGP = document.getElementById('smResultado').innerHTML;
  ok(/Governo respondeu primeiro/.test(htmlGP) && /Mapa por ponto/.test(htmlGP) && /⇄ troca/.test(htmlGP) && /base: proposta/.test(htmlGP) && /Notas do agente/.test(htmlGP),
    'tela: aviso do modo, mapa por ponto, base das objeções e notas do agente');
  gp.checked = false; gp.removeAttribute('checked');
  ctx.__prompts = [];
  await av(`smSimularClick()`);
  ok(!ctx.__prompts.some(o => /POSIÇÃO JÁ DECLARADA/.test(o.prompt)) && !/Governo respondeu primeiro/.test(document.getElementById('smResultado').innerHTML),
    'Governo primeiro DESLIGADO (padrão): todos respondem independentes');
  ok(document.getElementById('smGovPrimeiro') && !document.getElementById('smGovPrimeiro').hasAttribute('checked') && /id="smGovPrimeiro">/.test(html), 'a caixa começa desmarcada');

  // (1) teste contra o passado — funções puras
  ok(av(`smBtObjeto('Aprovado o Substitutivo ao Projeto de Lei Complementar nº 230, de 2025. Sim: 333; Não: 91; Total: 424.')`) === 'Substitutivo ao Projeto de Lei Complementar nº 230, de 2025.'
    && av(`smBtObjeto('Rejeitada a Emenda de Plenário nº 3. Sim: 120; não: 300.')`) === 'Emenda de Plenário nº 3.', 'a votação vai ao modelo SEM o resultado (sem "Aprovado" e sem placar)');
  const vt = [];
  for (let i = 0; i < 12; i++) {
    const gov = i % 2 ? 'Sim' : 'Não', contra = gov === 'Sim' ? 'Não' : 'Sim';
    vt.push({ votacao: { id: 'b' + i, data: `2026-0${1 + Math.floor(i / 3)}-1${i % 3}`, descricao: `Aprovado o PL ${i}. Sim: 300; Não: 100.`, proposicaoObjeto: 'PL ' + i + '/2026' },
      orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: gov }],
      votos: [{ deputado_: { id: 1, siglaPartido: 'PODE' }, tipoVoto: gov }, { deputado_: { id: 2, siglaPartido: 'PODE' }, tipoVoto: gov },
              { deputado_: { id: 3, siglaPartido: 'PL' }, tipoVoto: contra }, { deputado_: { id: 4, siglaPartido: 'PL' }, tipoVoto: i === 11 ? 'Obstrução' : contra }, { deputado_: { id: 5, siglaPartido: 'PL' }, tipoVoto: i === 11 ? 'Obstrução' : contra }] });
  }
  ctx.__vt = vt;
  const sel = av(`smBtSelecionar(__vt.slice().reverse(), 4)`);
  ok(sel.teste.length === 4 && sel.teste[0].votacao.id === 'b8' && sel.treino.length === 8 && sel.treino.every(t => t.votacao.data < sel.teste[0].votacao.data), 'teste = as mais recentes; perfil só com votações ANTERIORES (sem ver o futuro)');
  ok(av(`smBtMaioria(__vt[11], 'PL')`) === 'Obstrução' && av(`smBtMaioria(__vt[0], 'PODE')`) === 'Não' && av(`smBtMaioria(__vt[0], 'NOVO')`) === null, 'verdade = voto da maioria da bancada (inclui obstrução)');
  ok(av(`smBtEstatistica({ alinhamentoGoverno: 0.8 }, 'Sim')`) === 'Sim' && av(`smBtEstatistica({ alinhamentoGoverno: 0.2 }, 'Sim')`) === 'Não' && av(`smBtEstatistica({ alinhamentoGoverno: null }, 'Sim')`) === null, 'previsão estatística');
  const mt = av(`smBtMetricas([{ verdade: 'Sim', previsto: 'Sim' }, { verdade: 'Sim', previsto: 'Sim' }, { verdade: 'Não', previsto: 'Sim' }, { verdade: 'Não', previsto: null }, { verdade: null, previsto: 'Sim' }])`);
  ok(mt.n === 4 && mt.acuracia === 0.5 && Math.abs(mt.macroF1 - (0.8 + 0) / 2) < 1e-9 && mt.cobertura === 0.75, 'métricas: acerto, F1 macro (Sim 0,8 · Não 0) e cobertura; sem previsão conta como erro');
  ok(JSON.stringify(av(`smBtLerIngenuo('{"PODE":"sim","Pl":"NÃO","UNIAO":"Obstrução"}', ['PODE', 'PL', 'UNIÃO', 'PT'])`)) === JSON.stringify({ PODE: 'Sim', PL: 'Não', 'UNIÃO': 'Obstrução', PT: null }), 'IA ingênua: chaves sem acento/caixa casam com as siglas');
  const pb = av(`smBtPromptAgente('PL', 90, null, __vt[3], { proposicao: { siglaTipo: 'PL', numero: 3, ano: 2026, ementa: 'Ementa três' } }, 'Sim')`);
  ok(!/Sim: 300/.test(pb) && !/Aprovado/.test(pb) && /Em votação: PL 3\./.test(pb) && /Ementa três/.test(pb) && /O Governo orientou: Sim/.test(pb), 'prompt do teste sem o resultado, com ementa e orientação do Governo');

  // (1) teste contra o passado — rodada completa (PODE sempre com o Governo, PL sempre contra)
  av(`labsVotacoesPlenario = async () => ({ itens: __vt, falhas: 0, periodo: ['2026-01-01', '2026-04-30'] })`);
  const putsBt = [];
  const fB = ctx.fetch;
  ctx.fetch = async (url, o) => {
    if (o && o.method === 'PUT') { putsBt.push(url); return { ok: true, json: async () => ({}) }; }
    if (/\/votacoes\/b\d+$/.test(url)) return { ok: true, status: 200, json: async () => ({ dados: { proposicoesAfetadas: [{ siglaTipo: 'PL', numero: 1, ano: 2026, ementa: 'X' }] } }) };
    if (/validacoes/.test(url)) return { ok: true, status: 200, json: async () => null };
    return fB(url, o);
  };
  // agente: repete a orientação do Governo (erra o PL); ingênua: tudo "Sim"
  av(`chamarIA = async (o) => { __prompts.push(o);
      if (/Para cada partido abaixo/.test(o.prompt)) return { text: '{"PL":"Sim","PODE":"Sim"}' };
      const g = (o.prompt.match(/O Governo orientou: (Sim|Não)/) || [])[1];
      return { text: JSON.stringify({ voto: g, confianca: 3 }) }; }`);
  document.getElementById('smTesteN').innerHTML = '<option value="4" selected>4</option>';
  ctx.__prompts = [];
  await av(`smTestarClick()`);
  const tr = document.getElementById('smTesteResultado').innerHTML;
  const nums = [...tr.matchAll(/<td style="text-align:right">(\d+|—)%?<\/td>/g)].map(m => m[1]);
  ok(/Estatística \(sem IA\)/.test(tr) && /IA ingênua/.test(tr) && /Agentes do Simulador/.test(tr), 'resultado com os três métodos');
  ok(nums[0] === '88' && nums[3] === '50' && nums[6] === '50', `acerto: estatística 7/8 (erra só a obstrução do PL), IA ingênua 4/8, agentes 4/8 (${nums.slice(0, 9).join(' ')})`);
  ok(/Empate técnico:<\/b> no total, os agentes acertaram 38 pontos a menos[\s\S]*menos em <b>3<\/b> e empataram em 1/.test(tr) && /0 acertos só dos agentes × 3 só da estatística/.test(tr),
    'veredito contado por VOTAÇÃO (3 piores, 1 empate): empate técnico, não "38 pontos a menos"');
  ok(/<b>Por votação<\/b>/.test(tr) && (tr.match(/<details><summary>PL 1\/2026 — PL \d+\.<\/summary>/g) || []).length === 4 && /<b>2\/2<\/b><\/td><td style="text-align:right">1\/2<\/td><td style="text-align:right">1\/2/.test(tr),
    'tabela por votação: proposição, acertos de cada método (melhor em negrito) e detalhe bancada a bancada');
  ok(/PL<\/td><td>Obstrução<\/td><td><span class="sm-acao-rejeita">Não ✗/.test(tr), 'detalhe mostra o voto real e o erro de cada método (PL em obstrução)');
  ok(JSON.stringify(av(`smBtComparar([...Array(12)].map((_, i) => ({ verdade: 'Sim', ag: 'Sim', est: i < 10 ? 'Não' : 'Sim' })), 'ag', 'est')`)) === JSON.stringify({ b: 10, c: 0, significativo: true })
    && av(`smBtComparar([{ verdade: 'Sim', ag: 'Sim', est: 'Não' }, { verdade: 'Sim', ag: 'Sim', est: 'Não' }], 'ag', 'est').significativo`) === false, 'McNemar: 10 × 0 é diferença real; 2 × 0 é acaso');
  ctx.__secreta = [{ votacao: { id: 'sec', data: '2026-05-30' }, orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }], votos: [{ deputado_: { id: 1, siglaPartido: 'PL' }, tipoVoto: null }] }];
  ok(av(`smBtSelecionar(__vt.concat(__secreta), 4).teste.every(t => t.votacao.id !== 'sec')`), 'votação secreta (votos sem Sim/Não) fica fora do teste');
  const linhasVot = ctx.__prompts.map(o => (o.prompt.match(/Em votação: .*/) || [''])[0]);
  ok(ctx.__prompts.length === 4 * 2 + 4 && linhasVot.every(l => l && !/Sim: \d|Aprovad|Rejeitad/.test(l)),
    'custo previsto (4 votações × 2 bancadas + 4 ingênuas) e a votação testada nunca leva o próprio resultado');
  ok(putsBt.some(u => /\/labs\/simulador\/validacoes\/\d+\.json$/.test(u)), 'resultado do teste guardado para a equipe');
  ctx.fetch = fB;

  // teste do sinal por votação
  ok(Math.abs(av(`smBtBinomial(0, 6)`) - 0.03125) < 1e-12 && av(`smBtBinomial(3, 6)`) === 1 && Math.abs(av(`smBtBinomial(1, 10)`) - 22 / 1024) < 1e-12, 'p-valor exato do teste do sinal');
  ctx.__pv = [...Array(8)].map((_, i) => ({ n: 8, acertos: { est: 5, ing: 5, ag: i < 7 ? 8 : 5 } }));
  const sg = av(`smBtSinal(__pv, 'ag', 'est')`);
  ok(sg.melhor === 7 && sg.pior === 0 && sg.empate === 1 && sg.significativo, 'agentes melhores em 7 de 7 votações com diferença: significativo');
  ctx.__pv2 = [{ n: 8, acertos: { est: 3, ing: 3, ag: 8 } }, { n: 8, acertos: { est: 3, ing: 3, ag: 8 } }, { n: 8, acertos: { est: 8, ing: 8, ag: 8 } }];
  const sg2 = av(`smBtSinal(__pv2, 'ag', 'est')`);
  ok(sg2.melhor === 2 && !sg2.significativo, '10 bancadas a mais concentradas em 2 votações: NÃO é significativo (bancadas votam em bloco)');
  ok(putsBt.length && /historico|validacoes/.test(putsBt[0]), 'teste guardado com o detalhe por votação');

  // ---------- 9. contexto: consenso × conflito com a Oposição ----------
  console.log('9. Consenso × conflito');
  ok(av(`smContexto('Sim', 'Sim')`) === 'consenso' && av(`smContexto('Sim', 'Não')`) === 'conflito' && av(`smContexto('Sim', 'Obstrução')`) === 'conflito' && av(`smContexto('Sim', null)`) === 'semOposicao', 'contexto pela orientação da Oposição');
  // PL de mentira: sempre com o Governo no consenso, sempre contra no conflito
  const vc = [];
  for (let i = 0; i < 10; i++) {
    const gov = i % 2 ? 'Sim' : 'Não', cons = i < 4, contra = gov === 'Sim' ? 'Não' : 'Sim';
    vc.push({ votacao: { id: 'c' + i, data: `2026-03-${10 + i}` },
      orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: gov }, { siglaPartidoBloco: 'Oposição', orientacaoVoto: cons ? gov : contra }],
      votos: [1, 2, 3].map(id => ({ deputado_: { id, siglaPartido: 'PL' }, tipoVoto: cons ? gov : contra })) });
  }
  ctx.__vc = vc;
  const pc = av(`smPerfis(__vc, ['PL']).PL`);
  ok(pc.porContexto.consenso.n === 4 && pc.porContexto.consenso.alinhamento === 1 && pc.porContexto.conflito.n === 6 && pc.porContexto.conflito.alinhamento === 0 && Math.abs(pc.alinhamentoGoverno - 0.4) < 1e-9,
    'perfil por contexto: PL 100% no consenso, 0% no conflito (geral 40% escondia isso)');
  ctx.__pc = pc;
  ok(av(`smBtEstatistica(__pc, 'Sim', 'Sim')`) === 'Sim' && av(`smBtEstatistica(__pc, 'Sim', 'Não')`) === 'Não', 'estatística por contexto: segue o Governo no consenso, vota contra no conflito');
  ok(av(`smBtEstatistica(__pc, 'Sim')`) === 'Não', 'sem a Oposição, vale o alinhamento geral (40% → contra)');
  ok(av(`smBtEstatistica(__pc, 'Sim', null)`) === 'Não', 'contexto com menos de 3 votações no histórico cai no geral');
  const lc = av(`smLinhasContexto(__pc)`);
  ok(lc.length === 2 && /consenso\), a maioria da bancada votou com o Governo em 100% de 4/.test(lc[0]) && /conflito\), a maioria da bancada votou com o Governo em 0% de 6/.test(lc[1]), 'linhas do perfil por contexto para os prompts');
  const pbo = av(`smBtPromptAgente('PL', 90, __pc, __vc[9], null, 'Sim', 'Não')`);
  ok(/O Governo orientou: Sim\.\nA Oposição orientou: Não\./.test(pbo) && /consenso\), a maioria/.test(pbo), 'teste contra o passado: agente recebe a orientação da Oposição e o perfil por contexto');
  ok(/A Oposição liberou a bancada ou não orientou Sim\/Não\./.test(av(`smBtPromptIngenuo(['PL'], __vc[0], null, 'Não', null)`)), 'IA ingênua também recebe a Oposição (comparação justa)');
  const pso = av(`smPromptAgente({ tipo: 'partido', sigla: 'PL', cadeiras: 90 }, __pc, null, 'Proposta X qualquer.', 6, [], { oposicao: 'Sim' })`);
  ok(/EXPECTATIVA DA EQUIPE: a liderança da OPOSIÇÃO deve orientar a FAVOR da proposta/.test(pso) && /consenso\), a maioria/.test(pso), 'Simulador: expectativa da Oposição e perfil por contexto no prompt');
  ok(!/EXPECTATIVA DA EQUIPE/.test(av(`smPromptAgente({ tipo: 'partido', sigla: 'PL', cadeiras: 90 }, __pc, null, 'Proposta X qualquer.', 6, [])`)), '"não sei" (padrão): sem expectativa no prompt');
  ok(/<option value="" selected>não sei<\/option>/.test(html), 'campo da Oposição começa em "não sei"');

  // ---------- 10. limite de resposta e conteúdo desconhecido ----------
  console.log('10. Limite de resposta e conteúdo desconhecido');
  ok(av(`smBtConteudoDesconhecido('Rejeitado o Requerimento. Sim: 126; Não: 274; Abstenção: 2; Total: 402.')`) && av(`smBtConteudoDesconhecido('Aprovado o Requerimento.')`)
    && av(`smBtConteudoDesconhecido('Resultado.')`) && av(`smBtConteudoDesconhecido('')`), '"Requerimento." / "Resultado." sem descrição = conteúdo desconhecido');
  ok(!av(`smBtConteudoDesconhecido('Aprovado o Requerimento de Urgência (Art. 155 do RICD). Sim: 320; Não: 67.')`) && !av(`smBtConteudoDesconhecido('Aprovado o Substitutivo ao PLP 230/2025.')`)
    && !av(`smBtConteudoDesconhecido('Aprovado o Requerimento nº 4.491/2024, dos Senhores Líderes, que solicita a quebra de interstício')`), 'urgência, substitutivo e requerimento descrito NÃO são desconhecidos');
  ok(/maxSaida: SM_BT_MAX_SAIDA/.test(fs.readFileSync(path.join(RAIZ, 'labs-simulador-teste.js'), 'utf8')) && av(`SM_BT_MAX_SAIDA`) >= 8000
    && /maxSaida: 8000/.test(fs.readFileSync(path.join(RAIZ, 'labs-simulador.js'), 'utf8')), 'limite de resposta folgado (8.000) no teste e nos agentes');
  // rodada do teste com 1 votação desconhecida e 1 resposta cortada
  const vd = vt.map((x, i) => i === 10 ? Object.assign({}, x, { votacao: Object.assign({}, x.votacao, { descricao: 'Rejeitado o Requerimento. Sim: 100; Não: 300.' }) }) : x);
  ctx.__vd = vd;
  av(`labsVotacoesPlenario = async () => ({ itens: __vd, falhas: 0, periodo: ['2026-01-01', '2026-04-30'] })`);
  const fD = ctx.fetch;
  ctx.fetch = async (url, o) => {
    if (o && o.method === 'PUT') return { ok: true, json: async () => ({}) };
    if (/\/votacoes\/b\d+$/.test(url)) return { ok: true, status: 200, json: async () => ({ dados: { proposicoesAfetadas: [{ siglaTipo: 'PL', numero: 1, ano: 2026, ementa: 'X' }] } }) };
    if (/validacoes/.test(url)) return { ok: true, status: 200, json: async () => null };
    return fD(url, o);
  };
  av(`chamarIA = async (o) => { __prompts.push(o);
      if (/Para cada partido abaixo/.test(o.prompt)) return { text: '{"PL":"Sim","PODE":"Sim"}' };
      if (!__cortou && /bancada do PL/.test(o.prompt)) { __cortou = true; return { text: '{"voto":', truncated: true }; }
      const g = (o.prompt.match(/O Governo orientou: (Sim|Não)/) || [])[1];
      return { text: JSON.stringify({ voto: g, confianca: 3 }) }; }`);
  ctx.__cortou = false;
  await av(`smTestarClick()`);
  const td = document.getElementById('smTesteResultado').innerHTML;
  ok(/1 respostas cortadas pelo limite/.test(td), 'resposta cortada pelo limite aparece no cabeçalho do resultado');
  ok(/Sem as 1 votação\(ões\) de conteúdo desconhecido[\s\S]*sobre 3 votações/.test(td) && (td.match(/conteúdo desconhecido<\/span>/g) || []).length === 1,
    'resultado também SEM as votações de conteúdo desconhecido, que ficam marcadas na tabela');
  ctx.fetch = fD;

  // ---------- 11. correções do teste real (PL 3626/2023) ----------
  console.log('11. Correções do teste real');
  const p11 = av(`smPromptAgente({ tipo: 'partido', sigla: 'PL', cadeiras: 90 }, null, null, 'Vedar apostas por beneficiários do Bolsa Família.', 6, [])`);
  ok(!/diga "condiciona" e explique o que falta/.test(p11) && /TOME POSIÇÃO/.test(p11) && /"condiciona" SÓ com uma condição concreta e verificável/.test(p11) && /"apoia\|condiciona\|rejeita\|indefinida"/.test(p11),
    '(1) sem "na dúvida, condiciona": condição tem de ser concreta; "indefinida" quando falta informação');
  ok(/não é argumento: não cite percentuais de alinhamento/.test(p11), '(3) perfil calibra a posição, não vira argumento');
  ok(av(`smPosicao('indefinida')`) === 'indefinida', '"indefinida" é posição legítima');
  // (2) base declarada × recebida
  const rv2 = av(`smValidarBases({ objecoes: [{ texto: 'a', base: 'contexto' }, { texto: 'b', base: 'proposta' }, { texto: 'c', base: 'governo' }, { texto: 'd', base: 'perfil' }, { texto: 'e', base: 'proposicao' }] },
                  smRecebido({ tipo: 'governo', sigla: '__governo', contexto: '' }, undefined, null, {}))`);
  ok(rv2.objecoes[0].base === 'nenhuma' && rv2.objecoes[0].baseDeclarada === 'contexto' && rv2.objecoes[1].base === 'proposta'
    && rv2.objecoes[2].base === 'nenhuma' && rv2.objecoes[3].base === 'nenhuma' && rv2.objecoes[4].base === 'nenhuma',
    '(2) Governo sem contexto, sem perfil, sem proposição: "contexto/governo/votações/ementa" declarados viram "sem base"');
  const rv3 = av(`smValidarBases({ objecoes: [{ texto: 'a', base: 'contexto' }, { texto: 'd', base: 'perfil' }, { texto: 'g', base: 'governo' }] },
                  smRecebido({ tipo: 'partido', sigla: 'PL', contexto: 'O líder fechou questão.' }, { comparaveis: 10 }, { sigla: 'PL' }, { governo: { posicao: 'apoia' } }))`);
  ok(rv3.objecoes.every(o => o.base !== 'nenhuma'), 'com contexto, perfil e posição do Governo recebidos, as bases valem');
  // (4) proposição que já virou lei
  ctx.__lei = { sigla: 'PL', numero: '3626', ano: '2023', ementa: 'Apostas de quota fixa', situacao: 'Transformado em Norma Jurídica' };
  ok(av(`smJaEhLei(__lei)`) && !av(`smJaEhLei({ situacao: 'Aguardando Deliberação' })`), '(4) detecta proposição transformada em lei');
  ok(/JÁ FOI TRANSFORMADA EM LEI \(Transformado em Norma Jurídica\)[\s\S]*ALTERAÇÃO da lei vigente/.test(av(`smTextoProposicao(__lei)`)), 'prompt avisa os agentes que o texto está em vigor');
  // rodada completa: aviso de lei na tela + base inexistente marcada
  const fL = ctx.fetch;
  ctx.fetch = async (url, o) => {
    if (/proposicoes\?siglaTipo=PL&numero=3626/.test(url)) return { ok: true, status: 200, json: async () => ({ dados: [{ id: 2370108 }] }) };
    if (/proposicoes\/2370108$/.test(url)) return { ok: true, status: 200, json: async () => ({ dados: { ementa: 'Apostas de quota fixa', statusProposicao: { descricaoSituacao: 'Transformado em Norma Jurídica' } } }) };
    return fL(url, o);
  };
  armazenado.config = { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' };
  av(`sm.agentes.forEach(a => { a.marcado = a.tipo === 'governo'; a.contexto = ''; })`);
  av(`chamarIA = async (o) => { __prompts.push(o); if (/SOMENTE com um objeto JSON/.test(o.prompt))
        return { text: JSON.stringify({ posicao: 'condiciona', objecoes: [{ texto: 'não há integração de dados', base: 'contexto' }], concessao: 'x', argumento: '', risco: '' }) };
      return { text: 'síntese' }; }`);
  document.getElementById('smSigla').value = 'PL'; document.getElementById('smNumero').value = '3626'; document.getElementById('smAno').value = '2023';
  document.getElementById('smProposta').value = 'Vedar apostas por beneficiários do Bolsa Família, com bloqueio por CPF.';
  ctx.__prompts = [];
  await av(`smSimularClick()`);
  const h11 = document.getElementById('smResultado').innerHTML;
  ok(/Esta proposição já virou lei<\/b> \(situação na Câmara: Transformado em Norma Jurídica\)/.test(h11) && /JÁ FOI TRANSFORMADA EM LEI/.test(ctx.__prompts[0].prompt), 'tela e prompt avisam que a proposição já é lei');
  ok(/sem base — citou contexto da equipe, que ele não recebeu/.test(h11), 'objeção com base inexistente aparece como tal');
  document.getElementById('smNumero').value = ''; document.getElementById('smAno').value = '';
  ctx.fetch = fL;

  // ---------- 12. Mapa Territorial: eleição de 2026 (bancada eleita, comparação, 1 clique) ----------
  console.log('12. Mapa Territorial — 2026');
  {
    const CAB26 = '"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"CD_CARGO";"SQ_CANDIDATO";"NR_CANDIDATO";"NM_CANDIDATO";"NM_URNA_CANDIDATO";"SG_PARTIDO";"QT_VOTOS_NOMINAIS_VALIDOS";"DS_SIT_TOT_TURNO"';
    const l26 = (mun, nome, sq, nr, civ, urna, part, v, sit, cargo = '6') => `"SP";"${mun}";"${nome}";"${cargo}";"${sq}";"${nr}";"${civ}";"${urna}";"${part}";"${v}";"${sit}"`;
    const CSV26 = [CAB26,
      l26('71072', 'SÃO PAULO', '111', '2020', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 'PODE', 900, 'ELEITO POR QP'),
      l26('62910', 'MOJI MIRIM', '111', '2020', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 'PODE', 600, 'ELEITO POR QP'),
      l26('71072', 'SÃO PAULO', '112', '2021', 'JOAO SUPLENTE', 'JOAO', 'PODE', 300, 'SUPLENTE'),
      l26('71072', 'SÃO PAULO', '113', '2022', 'NAO ELEITO DE TAL', 'NAO ELEITO', 'PODE', 10, 'NÃO ELEITO'),
      l26('71072', 'SÃO PAULO', '999', '1313', 'OUTRO CANDIDATO', 'OUTRO', 'PT', 5000, 'ELEITO POR QP'),
      l26('71072', 'SÃO PAULO', '111', '20200', 'MARIA DA SILVA SOUZA', 'MARIA SOUZA', 'PODE', 77777, 'ELEITO', '7')];
    const CSV22 = [CAB26,
      l26('71072', 'SÃO PAULO', '501', '1500', 'MARIA DA SILVA SOUZA', 'MARIA DO BAIRRO', 'MDB', 1200, 'ELEITO POR MÉDIA'),
      l26('71072', 'SÃO PAULO', '502', '1313', 'OUTRO CANDIDATO', 'OUTRO', 'PT', 4000, 'ELEITO POR QP')];
    const a26 = N.lmnAgregador([], { eleitosDoPartido: 'PODE' });
    a26.novoArquivo(); CSV26.forEach(l => a26.linha(l));
    const r26 = a26.resultado();
    const m = r26.deputados.tse111;
    ok(Object.keys(r26.deputados).join() === 'tse111' && m.total === 1500 && m.nome === 'Maria Souza' && m.nomeCivil === 'MARIA DA SILVA SOUZA' && m.situacao === 'ELEITO POR QP' && m.numero === '2020',
      '2026: a bancada sai do arquivo — só os ELEITOS do PODE (suplente, "não eleito", outro partido e outro cargo ficam de fora)');
    ok(r26.municipios['71072'].t === 6210, 'totais do município contam todos os candidatos a deputado federal');
    let semSit = ''; try { const x = N.lmnAgregador([], { eleitosDoPartido: 'PODE' }); x.novoArquivo(); x.linha(CAB); } catch (e) { semSit = e.message; }
    ok(/DS_SIT_TOT_TURNO/.test(semSit), 'arquivo sem a situação dos candidatos: erro claro (não dá para saber quem foi eleito)');
    const a22 = N.lmnAgregador(N.lmnAlvosAnterior(r26.deputados));
    a22.novoArquivo(); CSV22.forEach(l => a22.linha(l));
    const reg26 = N.lmnParaIbge(r26, { SP: IBGE_SP });
    N.lmnAnexarAnterior(reg26, N.lmnParaIbge(a22.resultado(), { SP: IBGE_SP }), '2022');
    const ant = reg26.deputados.tse111.anterior;
    ok(ant && ant.total === 1200 && ant.partido === 'MDB' && ant.nomeUrna === 'MARIA DO BAIRRO' && ant.municipios.m3550308 === 1200,
      'comparação: a mesma pessoa em 2022 pelo nome civil, mesmo com outro partido e outro nome de urna');
    const v = N.lmnVariacao(reg26.deputados.tse111.municipios, ant.municipios);
    ok(v.length === 2 && v[0].k === 'm3530805' && v[0].d === 600 && v[1].k === 'm3550308' && v[1].d === -300, 'variação por município: do maior ganho à maior perda');
    ok(N.lmnNomeProprio('DR. JAIME GAZOLA') === 'Dr. Jaime Gazola' && N.lmnNomeProprio('DA COSTA DO PERDEU PIÁ') === 'Da Costa do Perdeu Piá', 'nome de urna para exibir: "Dr.", "do"/"da" no meio');
    ok(N.LMN_ANOS[0] === '2026' && N.lmnBancadaDoArquivo('2026') && !N.lmnBancadaDoArquivo('2022'), '2026 é a eleição padrão; 2022 continua pela bancada da Câmara');

    // Tela: mapa com a comparação e o modo ganho/perda.
    ctx.__d26 = Object.assign({ nome: 'Maria Souza', partidoEleicao: 'PODE', nomeUrna: 'MARIA SOUZA', situacao: 'ELEITO POR QP' }, reg26.deputados.tse111);
    ctx.__reg26 = reg26;
    av(`mp.modo = 'fatia'; mpRender(__d26, __geo, __reg26.municipios.SP, { total: 0, n: 0, municipais: {}, outros: {} }, '2026')`);
    let h = document.getElementById('mpResultado').innerHTML;
    ok(/votos em 2022 \(MDB\)/.test(h) && /\+25%/.test(h) && /Onde mais ganhou votos/.test(h) && /Onde mais perdeu votos/.test(h) && /ganho\/perda desde 2022/.test(h),
      'tela: cartão 2022 → 2026 (+25%), onde mais ganhou e perdeu, e o botão do modo ganho/perda');
    ok(/Sem emendas: se o mandato começa em 2027/.test(h) === false, 'quem já era eleito em 2022 não recebe o aviso de mandato novo');
    av(`mp.modo = 'variacao'; mpRender(__d26, __geo, __reg26.municipios.SP, { total: 0, n: 0, municipais: {}, outros: {} }, '2026')`);
    h = document.getElementById('mpResultado').innerHTML;
    ok(h.includes('fill="#2b6e4f"') && h.includes('fill="#7a2a2a"') && /perdeu/.test(h), 'modo ganho/perda: verde onde ganhou, vermelho onde perdeu');
    av(`mp.modo = 'fatia'; mpRender(Object.assign({}, __d26, { anterior: null }), __geo, __reg26.municipios.SP, { total: 0, n: 0, municipais: {}, outros: {} }, '2026')`);
    h = document.getElementById('mpResultado').innerHTML;
    ok(/Não concorreu a deputado federal por SP em 2022/.test(h) && /Sem emendas: se o mandato começa em 2027/.test(h), 'sem 2022: diz que não concorreu, e avisa que deputado novo ainda não tem emendas');

    // Um clique: índice do zip + só os bytes dos estados, por Range.
    const zipDe = ents => {
      const loc = [], cen = []; let off = 0;
      for (const e of ents) {
        const nome = Buffer.from(e.nome), dado = zlib.deflateRawSync(e.dado);
        const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(dado.length, 18); lh.writeUInt32LE(e.dado.length, 22); lh.writeUInt16LE(nome.length, 26);
        const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(dado.length, 20); ch.writeUInt32LE(e.dado.length, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(off, 42);
        loc.push(lh, nome, dado); cen.push(ch, nome); off += 30 + nome.length + dado.length;
      }
      const cd = Buffer.concat(cen), eo = Buffer.alloc(22);
      eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(ents.length, 8); eo.writeUInt16LE(ents.length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
      return Buffer.concat([...loc, cd, eo]);
    };
    const enorme = Buffer.alloc(200000, 0x41);   // o "BRASIL": não pode ser baixado
    const zips = {
      2026: zipDe([{ nome: 'leiame.pdf', dado: Buffer.from('%PDF') }, { nome: 'votacao_candidato_munzona_2026_BRASIL.csv', dado: enorme },
        { nome: 'votacao_candidato_munzona_2026_SP.csv', dado: Buffer.from(CSV26.join('\n'), 'latin1') }, { nome: 'votacao_candidato_munzona_2026_MG.csv', dado: enorme }]),
      2022: zipDe([{ nome: 'votacao_candidato_munzona_2022_SP.csv', dado: Buffer.from(CSV22.join('\r\n'), 'latin1') }, { nome: 'votacao_candidato_munzona_2022_RJ.csv', dado: enorme }]),
    };
    const pedidos = [];
    const cfgTse = { pl: [{ cd: '3220', c: 'ele2026', dt: '04/10/2026', e: [{ cd: '6259', cdt2: '6260', t: '1', tp: '1', abr: [{ cd: 'br', cp: [{ cd: '6' }] }] }] }] };
    const resUf = uf => ({ s: { ts: '1', st: '1', pst: '100,00' }, tf: 's', v: { vv: '1' }, carg: [{ cd: '6', nv: '1', agr: uf !== 'sp' ? [] : [
      { n: '1', tp: 'i', vag: '1', par: [{ n: '20', sg: 'PODE', cand: [{ n: '2020', nmu: 'MARIA SOUZA', vap: '1500', e: 's', st: 'Eleito por QP' }] }] }] }] });
    ctx.fetch = async (url, op) => {
      url = String(url);
      const m26 = url.match(/munzona_(\d{4})\.zip$/);
      if (m26) {
        const z = zips[m26[1]], r = /bytes=(\d+)-(\d+)/.exec((op && op.headers && op.headers.Range) || '');
        if (!r) return new Response(z, { status: 200 });
        const ini = +r[1], fim = Math.min(+r[2], z.length - 1);
        pedidos.push({ ano: m26[1], ini, fim });
        return new Response(z.subarray(ini, fim + 1), { status: 206, headers: { 'content-range': `bytes ${ini}-${fim}/${z.length}` } });
      }
      if (/ele-c\.json/.test(url)) return new Response(JSON.stringify(cfgTse));
      const u = url.match(/\/dados\/(\w\w)\//); if (u) return new Response(JSON.stringify(resUf(u[1])));
      if (/localidades\/estados\/SP\/municipios/.test(url)) return new Response(JSON.stringify(IBGE_SP));
      return new Response('null');
    };
    Object.assign(ctx, { DecompressionStream, TransformStream, ReadableStream });
    let confirmou = '';
    ctx.confirm = msg => { confirmou = msg; return true; };
    // linkedom não lê o "checked" inicial da caixa; no Chrome ela vem marcada.
    Object.defineProperty(document.getElementById('mpComparar'), 'checked', { value: true, configurable: true });
    await av(`mpBaixarTseClick()`);
    const proc = av(`mp.processado`);
    const dep = proc && proc.reg.deputados.tse111;
    ok(dep && dep.total === 1500 && dep.anterior && dep.anterior.total === 1200 && proc.ano === '2026', '1 clique: lê os eleitos de 2026 e a votação de 2022 pelos arquivos remotos (' + (document.getElementById('mpUpStatus').textContent || 'ok') + ')');
    ok(/só dos estados SP/.test(confirmou) && /e de 2022 \(comparação\)/.test(confirmou), 'pede confirmação dizendo o tamanho, as eleições e os estados');
    const baixado = pedidos.reduce((t, p) => t + (p.fim - p.ini + 1), 0);
    ok(pedidos.length && baixado < (enorme.length / 2) && !pedidos.some(p => p.fim - p.ini + 1 > 70000 && p.fim - p.ini + 1 >= 65557 + 1),
      `só os pedaços necessários: ${baixado} bytes baixados (BRASIL, MG e RJ, de ${enorme.length} bytes cada, ficaram de fora)`);
    ok(/Maria Souza/.test(document.getElementById('mpUpResultado').innerHTML) && /1\.200/.test(document.getElementById('mpUpResultado').innerHTML) && /mpGravar/.test(document.getElementById('mpUpResultado').innerHTML),
      'resumo antes de gravar: deputado, votos de 2022 e o botão de gravar');
    const zeros = av(`mpUfDaEntrada('votacao_candidato_munzona_2026_BRASIL.csv') === null && mpUfDaEntrada('x_2026_BR.csv') === null && mpUfDaEntrada('x_2026_sp.csv') === 'SP'`);
    ok(zeros, 'entradas do zip: BRASIL e BR não contam como estado');
    // Rede instável: um bloco do download falha uma vez e é pedido de novo.
    const fBase = ctx.fetch;
    let falhou = 0;
    ctx.fetch = async (url, op) => {
      const r = /bytes=(\d+)-(\d+)/.exec((op && op.headers && op.headers.Range) || '');
      if (r && confirmou && +r[2] - +r[1] > 100 && !falhou) { falhou++; throw new TypeError('Failed to fetch'); }   // já no download dos dados
      return fBase(url, op);
    };
    av(`mp.processado = null`);
    confirmou = '';
    await av(`mpBaixarTseClick()`);
    ok(falhou === 1 && av(`mp.processado && mp.processado.reg.deputados.tse111.total`) === 1500, 'bloco do download que cai é pedido de novo, sem perder o processamento');
    ctx.fetch = fBase;
    // Painel de resultados instável: o estado que não responde entra por precaução, em vez de derrubar tudo.
    const fOk = ctx.fetch;
    ctx.fetch = async (url, op) => /\/dados\/(rj|mg)\//.test(String(url)) ? new Response('erro', { status: 503 }) : fOk(url, op);
    let ufsInst = await av(`mpUfsComEleitos('2026')`);
    // Totalização reaberta (vagas zeradas, ninguém marcado) com candidato do partido: entra também.
    ctx.fetch = async (url, op) => /\/dados\/pe\//.test(String(url)) ? new Response(JSON.stringify({ s: { pst: '100,00' }, tf: 'n', carg: [{ cd: '6', nv: '25', agr: [
      { n: '1', tp: 'i', vag: '0', par: [{ n: '20', sg: 'PODE', cand: [{ n: '2000', nmu: 'X', vap: '100', e: 'n', st: '' }] }] }] }] })) : fOk(url, op);
    ok((await av(`mpUfsComEleitos('2026')`)).join() === 'PE,SP', 'UF com a totalização reaberta pelo TSE (vagas zeradas) e candidato do partido entra por precaução');
    ctx.fetch = async (url, op) => /\/dados\/(rj|mg)\//.test(String(url)) ? new Response('erro', { status: 503 }) : fOk(url, op);
    ufsInst = await av(`mpUfsComEleitos('2026')`);
    ok(ufsInst.join() === 'MG,RJ,SP', 'resultado do TSE fora do ar em MG e RJ: entram por precaução (SP pelos eleitos) — ' + ufsInst.join());
    ctx.fetch = async (url, op) => /\/dados\//.test(String(url)) ? new Response('erro', { status: 503 }) : fOk(url, op);
    let semTse = ''; try { await av(`mpUfsComEleitos('2026')`); } catch (e) { semTse = e.message; }
    ok(/não respondeu/.test(semTse), 'TSE todo fora do ar: erro claro');
    ctx.fetch = fOk;
  }
  {
    const Bm = require(path.join(RAIZ, 'bot', 'src', 'labsmapa.js'));
    ok(Bm.ANOS_SUPORTADOS[0] === '2026' && Bm.ANOS_SUPORTADOS.includes('2022'), 'bot: /labsmapa aceita 2026 (padrão) e 2022');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
