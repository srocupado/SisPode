// Labs — Placar Preditivo, Simulador de Negociação e Mapa Territorial.
//
// O que este teste trava:
//  1. registro: o card "Labs" existe no painel com a descrição combinada, e o
//     manifest expõe as páginas e libera o IBGE;
//  2. orientação: partido achado dentro do nome do bloco/federação; liderança
//     (Governo/Oposição…) só pelo nome exato; janelas de consulta ≤ 80 dias;
//  3. placar: conta de Laplace, mínimo de histórico, mistura do tema;
//  4. simulador: perfil por partido (alinhamento ao Governo, coesão,
//     divergências), leitura do JSON do agente, cadeiras por posição, e a
//     rodada completa com IA de mentira — uma chamada por bancada + a síntese;
//  5. mapa (núcleo): CSV do TSE com aspas, casamento por nome civil e, na falta,
//     por nome de urna único; soma das zonas; cargo diferente ignorado;
//     ponte TSE → IBGE por nome (acento, "Moji"/"Mogi"); localidade e emendas;
//  6. mapa (tela): leitura latin1 em pedaços de um File e o desenho do SVG;
//  7. bot: leitor de ZIP (deflate e sem compressão) lendo o CSV de dentro do zip.
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
  ok(/id:\s+'labs'[\s\S]*?titulo: 'Labs'[\s\S]*?desenvolvimento de novas soluções[\s\S]*?homologadas[\s\S]*?acao:\s+abrirLabs/.test(panel), 'card Labs no painel, com a descrição combinada');
  ok(/function abrirLabs\(\)[\s\S]*?labs\.html/.test(panel), 'abrirLabs abre labs.html');
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  const recursos = man.web_accessible_resources[0].resources;
  const html = fs.readFileSync(path.join(RAIZ, 'labs.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  ok(scripts.every(s => recursos.includes(s) && fs.existsSync(path.join(RAIZ, s))), 'todos os scripts de labs.html existem e estão no manifest');
  ok(man.host_permissions.includes('https://servicodados.ibge.gov.br/*'), 'IBGE liberado no manifest');
  ok(/área de desenvolvimento de novas soluções/i.test(html) && /homologadas/.test(html), 'a página abre com a descrição do Labs');

  // ---------- contexto da página ----------
  const { document, window, Event } = parseHTML(html);
  const armazenado = { config: { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' } };
  const ctx = {
    document, window, DOMParser, Event, CustomEvent: window.CustomEvent || class extends Event { constructor(t, o) { super(t); this.detail = o && o.detail; } },
    setTimeout, clearTimeout, URL, TextDecoder, TextEncoder, AbortController, Blob, Response, Headers, Request, btoa,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
    chrome: { storage: { local: { get: (_k, cb) => cb(armazenado), set: () => {} } }, runtime: { getURL: p => p } },
    localStorage: { getItem: () => null, setItem: () => {} },
    alert: () => {}, confirm: () => true,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
  const av = e => vm.runInContext(e, ctx);
  // linkedom não deixa escrever select.value: marca a opção pelo atributo
  const selecionar = (id, v) => { for (const o of document.getElementById(id).querySelectorAll('option')) { if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } };

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

  // ---------- 3. placar ----------
  console.log('3. Placar');
  const voto = (id, t) => ({ deputado_: { id, siglaPartido: 'X' }, tipoVoto: t });
  const itens = [];
  for (let i = 0; i < 10; i++) {
    itens.push({ votacao: { id: 'v' + i }, orientacoes: [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }],
      votos: [voto(1, 'Sim'), voto(2, i < 5 ? 'Sim' : 'Não'), voto(3, i < 2 ? 'Não' : 'Abstenção')] });
  }
  ctx.__itens = itens;
  const r = av(`plCalcular(__itens, 'Governo', [{id:1,nome:'A'},{id:2,nome:'B'},{id:3,nome:'C'}], null)`);
  const L = id => r.linhas.find(l => l.id === id);
  ok(r.comparaveis === 10, '10 votações comparáveis');
  ok(Math.abs(L(1).p - 11 / 12) < 1e-9 && L(1).faixa === 'f5', 'seguiu 10 de 10 → (10+1)/(10+2), "quase sempre" (sem 100%)');
  ok(Math.abs(L(2).p - 0.5) < 1e-9 && L(2).faixa === 'f3', 'seguiu 5 de 10 → 50%, indeciso');
  ok(L(3).p === null && L(3).faixa === 'f0', 'só 2 votos Sim/Não (abstenção não conta) → sem histórico suficiente');
  ctx.__tema = new Set(['v5', 'v6', 'v7', 'v8', 'v9']);
  const rt = av(`plCalcular(__itens, 'Governo', [{id:2,nome:'B'}], __tema)`);
  const pt = (0 + 1) / (5 + 2), w = 5 / 10;
  ok(Math.abs(rt.linhas[0].p - (w * pt + (1 - w) * 0.5)) < 1e-9, 'com tema: mistura p_tema e p_geral com peso n/(n+5)');

  // ---------- 4. simulador ----------
  console.log('4. Simulador de Negociação');
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
  ok(pf.PODE.comparaveis === 4 && Math.abs(pf.PODE.alinhamentoGoverno - 0.75) < 1e-9, 'PODE (em bloco) com o Governo em 3 de 4');
  ok(pf.PL.alinhamentoGoverno === 0 && pf.PL.divergencias.length === 4, 'PL nunca com o Governo; divergências listadas');
  ok(/^Votação 3/.test(pf.PODE.divergencias[0]) && pf.PODE.divergencias.length === 1, 'divergência do PODE é a da votação 3 (mais recente primeiro)');
  ok(Math.abs(pf.PODE.coesao - (2 / 3 + 1 + 1 + 1) / 4) < 1e-9, 'coesão = média da fração com a maioria da bancada');
  const lida = av(`smLerResposta('Claro:\\n\`\`\`json\\n{"posicao":"Condiciona","objecoes":["prazo","custo"],"concessao":"180 dias","argumento":"a","risco":"b"}\\n\`\`\`')`);
  ok(lida.posicao === 'condiciona' && lida.objecoes.length === 2 && lida.concessao === '180 dias', 'lê JSON cercado por ``` e normaliza a posição');
  ok(av(`smLerResposta('{"posicao":"talvez"}').posicao`) === 'indefinida', 'posição fora da lista vira "indefinida"');
  let lancou = false; try { av(`smLerResposta('sem json aqui')`); } catch (e) { lancou = true; }
  ok(lancou, 'resposta sem JSON é erro (vira "sem resposta"), não posição inventada');
  const prompt = av(`smPromptAgente({sigla:'PL', cadeiras: 90}, smPerfis(__vs, ['PL']).PL, {sigla:'PL', numero:'1', ano:'2025', ementa:'Ementa X'}, 'Aprovar o texto do relator.', 6)`);
  ok(/PL na Câmara dos Deputados \(90 deputados/.test(prompt) && /Orientou igual ao Governo em 0%/.test(prompt) && /Ementa X/.test(prompt) && /Aprovar o texto do relator\./.test(prompt) && /"posicao"/.test(prompt),
    'prompt do agente traz cadeiras, perfil real, proposição, proposta e o formato JSON');

  // rodada completa, com a Câmara e a IA de mentira
  av(`labsDeputadosAtuais = async () => [].concat(
      Array.from({length: 5}, (_, i) => ({id: i, nome: 'p' + i, partido: 'PL', uf: 'SP'})),
      Array.from({length: 3}, (_, i) => ({id: 10 + i, nome: 'q' + i, partido: 'PODE', uf: 'SP'})),
      [{id: 20, nome: 'r', partido: 'NOVO', uf: 'SP'}])`);
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
  console.log('4b. Agentes configuráveis');
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
  ctx.fetch = fetchAntes;

  const antesSemChave = ctx.__prompts.length;
  armazenado.config = {};
  document.getElementById('smResultado').innerHTML = '';
  await av(`smSimularClick()`);
  ok(/Nenhuma chave de IA/.test(document.getElementById('smStatus').textContent) && ctx.__prompts.length === antesSemChave, 'sem chave de IA: avisa e não chama nada');

  // ---------- 5. mapa: núcleo ----------
  console.log('5. Mapa Territorial — núcleo');
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

  // ---------- 6. mapa: tela ----------
  console.log('6. Mapa Territorial — tela');
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
  ok(q.length === 4 && av(`mpCor(0, [0.1])`) === av(`MP_CORES[0]`), 'escala por quantis; zero voto na cor de fundo');

  // ---------- 7. bot: leitor de ZIP ----------
  console.log('7. Bot — leitor de ZIP');
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

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
