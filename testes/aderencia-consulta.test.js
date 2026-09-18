// Aba "Como votou o deputado" do módulo Relatórios (antes: Aderência ao Governo).
//
// A primeira aba responde "quanto o partido X aderiu ao governo no período".
// Esta responde "como o deputado Fulano votou nisto aqui" — por proposição ou
// por período, para deputado de qualquer partido.
//
// Dois achados da apuração manual do PL 3.626/2023 (17/09/2026) estão travados
// aqui, porque são o que separa um relatório certo de um errado:
//
//  1. A consulta por intervalo PERDE as votações do último dia. Medido: 13/09 a
//     13/09 devolve 1 votação do Plenário; 13/09 a 14/09 devolve 15, todas do
//     dia 13. A aba pede dataFim+1 e descarta o excedente.
//  2. O objeto de cada votação não existe em campo estruturado — só no texto da
//     tramitação, lido em ordem. E objeto errado é pior que objeto nenhum: o
//     casamento consome cada linha uma vez e desiste depois de 8 linhas.
//
// E a distinção que a tela existe para fazer: votação SIMBÓLICA não é ausência
// do deputado — a Câmara não registra voto individual nela.
//
// Uso: node testes/aderencia-consulta.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// ---------- API da Câmara de mentira ----------
const api = { deputados: [], props: [], votacoes: {}, votos: {}, orientacoes: {}, tramitacoes: {},
              periodo: {}, chamadas: [], derrubar: null };
const resp = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
const erro = s => ({ ok: false, status: s, json: async () => ({}), text: async () => '' });

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  // aderencia.html passou a carregar ia-comum.js, que declara um
  // AbortController no topo do arquivo. Sem ele no contexto, NENHUM script
  // da página chega a ser avaliado.
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({}), aoa_to_sheet: r => ({ _r: r }), book_append_sheet: () => {} }, writeFile: () => {} },
  fetch: async (url) => {
    const u = String(url);
    api.chamadas.push(u);
    if (api.derrubar && api.derrubar.test(u)) return erro(500);
    let m;
    if ((m = u.match(/\/deputados\?nome=([^&]+)/))) {
      const alvo = decodeURIComponent(m[1]).toLowerCase();
      return resp({ dados: api.deputados.filter(d => d.nome.toLowerCase().includes(alvo)) });
    }
    if ((m = u.match(/\/proposicoes\?siglaTipo=([^&]+)&numero=(\d+)&ano=(\d+)/))) {
      const p = api.props.find(x => x.siglaTipo === decodeURIComponent(m[1]) && String(x.numero) === m[2] && String(x.ano) === m[3]);
      return resp({ dados: p ? [p] : [] });
    }
    if ((m = u.match(/\/proposicoes\/(\d+)\/votacoes/)))    return resp({ dados: api.votacoes[m[1]] || [] });
    if ((m = u.match(/\/proposicoes\/(\d+)\/tramitacoes/))) return resp({ dados: api.tramitacoes[m[1]] || [] });
    if ((m = u.match(/\/votacoes\/([\w-]+)\/votos/)))       return resp({ dados: api.votos[m[1]] || [] });
    if ((m = u.match(/\/votacoes\/([\w-]+)\/orientacoes/))) return resp({ dados: api.orientacoes[m[1]] || [] });
    if ((m = u.match(/\/votacoes\?dataInicio=([\d-]+)&dataFim=([\d-]+)/))) {
      // O comportamento REAL da API: as votações do dataFim se perdem.
      const ini = m[1], fim = m[2];
      const dentro = (api.periodo.todas || []).filter(v => v.data >= ini && v.data < fim);
      return resp({ dados: dentro, links: [] });
    }
    return erro(599);
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
const clicar = sel => { const el = document.querySelector(sel); if (!el) return false;
                        el.dispatchEvent(new Event('click', { bubbles: true })); return true; };
const telaCvBruto = () => document.getElementById('cvResultado').innerHTML;

// ---------- o caso real: PL 3626/2023 ----------
const GAMBALE = { id: 220641, nome: 'Rodrigo Gambale', siglaPartido: 'PODE', siglaUf: 'SP' };
api.deputados = [
  GAMBALE,
  { id: 999001, nome: 'Rodrigo Gambale Filho', siglaPartido: 'PL', siglaUf: 'RJ' },  // homônimo
];
api.props = [{ id: 2374400, siglaTipo: 'PL', numero: 3626, ano: 2023, ementa: 'Dispõe sobre a modalidade lotérica denominada apostas de quota fixa.' }];
api.votacoes['2374400'] = [
  { id: '2374400-23', data: '2023-09-13', dataHoraRegistro: '2023-09-13T18:18:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/69908', descricao: 'Rejeitado o Requerimento.' },
  { id: '2374400-46', data: '2023-09-13', dataHoraRegistro: '2023-09-13T19:57:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/69908', descricao: 'Rejeitada a Emenda de Plenário nº 26. Sim: 82; não: 342; abstenção: 8; total: 432.' },
  { id: '2374400-53', data: '2023-09-13', dataHoraRegistro: '2023-09-13T20:26:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/69908', descricao: 'Suprimido o texto. Sim: 222; não: 242; abstenção: 2; total: 466.' },
  { id: '2374400-58', data: '2023-09-13', dataHoraRegistro: '2023-09-13T20:37:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/69908', descricao: 'Aprovada a Emenda de Plenário nº 34. Sim: 203; não: 164; total: 367.' },
  { id: '2374400-121', data: '2023-12-21', dataHoraRegistro: '2023-12-21T00:28:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/71780', descricao: 'Rejeitada a Emenda do Senado Federal nº 3. Sim: 120; não: 261; abstenção: 1; total: 382.' },
  // Sem correspondência na tramitação: é o caso em que o relatório precisa
  // dizer "objeto não identificado" em vez de aproximar.
  { id: '2374400-89', data: '2023-12-21', dataHoraRegistro: '2023-12-21T00:40:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/71780', descricao: 'Realizar o encaminhamento do PL-3626/2023 à CCJC (tramitação simultânea).' },
];
// Tramitação narrativa, como a Câmara publica: objeto, encaminhamento, resultado.
api.tramitacoes['2374400'] = [
  { sequencia: 20, despacho: 'Discussão em turno único.' },
  { sequencia: 21, despacho: 'Votação do Requerimento do Dep. Gilson Marques, que solicita a retirada de pauta deste Projeto de Lei.' },
  { sequencia: 22, despacho: 'Encaminhou a Votação o Dep. Gilson Marques (NOVO-SC).' },
  { sequencia: 23, despacho: 'Rejeitado o Requerimento.' },
  { sequencia: 41, despacho: 'Votação do DTQ 3: Bloco UNIÃO (SD): Emenda de Plenário nº 26 (art. 161, II).' },
  { sequencia: 42, despacho: 'Encaminhou a Votação o Dep. Aureo Ribeiro (SOLIDARI-RJ).' },
  { sequencia: 43, despacho: 'Rejeitada a Emenda de Plenário nº 26. Sim: 82; não: 342; abstenção: 8; total: 432.' },
  { sequencia: 50, despacho: 'Votação do DTQ 1: Bloco UNIÃO (PSB): Destaque para Votação em Separado do §10 do art. 23 da Lei nº 13.756, de 2018, constante do art. 53 do Substitutivo, para fins de supressão, apresentado ao PL 3626/2023. (art. 161, I).' },
  { sequencia: 51, despacho: 'Encaminhou a Votação o Dep. Felipe Carreras (PSB-PE).' },
  { sequencia: 52, despacho: 'Suprimido o texto. Sim: 222; não: 242; abstenção: 2; total: 466.' },
  { sequencia: 55, despacho: 'Votação do DTQ 6: Bloco MDB (Republicanos): Emenda de Plenário nº 34 (art. 161, II).' },
  { sequencia: 57, despacho: 'Aprovada a Emenda de Plenário nº 34. Sim: 203; não: 164; total: 367.' },
  { sequencia: 118, despacho: 'Votação das Emendas do Senado Federal nº 1 e outras, com parecer pela rejeição.' },
  { sequencia: 120, despacho: 'Rejeitada a Emenda do Senado Federal nº 3. Sim: 120; não: 261; abstenção: 1; total: 382.' },
  // Um retirado COM data e outro SEM: o recorte do relatório trata os dois
  // casos de forma diferente, e os dois precisam estar no material de teste.
  { sequencia: 121, dataHora: '2023-12-21T00:50', despacho: 'Retirado o DTQ 9: Bloco UNIÃO (Solidariedade): emenda n. 38 do Senado Federal, com fins de sua aprovação (art. 161, II).' },
  { sequencia: 122, despacho: 'Retirado o DTQ 10: PL: Destaque da emenda do Senado número 3 para fins de sua supressão (art. 161, II).' },
];
const voto = t => ({ deputado_: GAMBALE, tipoVoto: t });
api.votos['2374400-23']  = [];                       // simbólica
api.votos['2374400-46']  = [voto('Não'), { deputado_: { id: 1 }, tipoVoto: 'Sim' }];
api.votos['2374400-53']  = [voto('Sim')];
api.votos['2374400-58']  = [voto('Não')];
api.votos['2374400-121'] = [{ deputado_: { id: 1 }, tipoVoto: 'Sim' }];   // ele não votou
api.orientacoes['2374400-46']  = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Não' }];
api.orientacoes['2374400-53']  = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }];
api.orientacoes['2374400-58']  = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: '' }];   // sem orientação
api.orientacoes['2374400-121'] = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Não' }];

(async () => {
  console.log('== a aba existe e troca ==');
  {
    ok(!!document.getElementById('aba-consulta'), 'a aba "Consulta de votos" está no HTML');
    ok(document.getElementById('painel-consulta').hidden === true, 'e começa escondida');
    clicar('#aba-consulta');
    ok(document.getElementById('painel-consulta').hidden === false, 'clicar abre o painel da consulta');
    ok(document.getElementById('painel-aderencia').hidden === true, 'e esconde o da aderência');
    clicar('#aba-aderencia');
    ok(document.getElementById('painel-aderencia').hidden === false, 'e volta');
    clicar('#aba-consulta');
  }

  console.log('\n== homônimo não é resolvido por adivinhação ==');
  {
    const achados = await av(`cvBuscarDeputados('Gambale')`);
    ok(achados.length === 2, `a busca devolve os dois homônimos (${achados.length})`);
    ok(achados.every(d => d.partido && d.uf), 'com partido e UF, que é o que distingue um do outro');
    av(`cvRenderEscolha(${JSON.stringify(achados)})`);
    const ops = document.querySelectorAll('#cvEscolha .cv-op');
    ok(ops.length === 2, 'a tela oferece os dois para escolha, em vez de escolher sozinha');
    ops[0].dispatchEvent(new Event('click', { bubbles: true }));
    ok(av('cv.deputado.id') === 220641, 'e o escolhido fica selecionado');
    ok(/Rodrigo Gambale/.test(document.getElementById('cvEscolha').textContent), 'com o nome confirmado na tela');
  }

  console.log('\n== o objeto de cada votação sai da tramitação ==');
  {
    const objs = av(`objetosDaTramitacao(${JSON.stringify(api.votacoes['2374400'])}, ${JSON.stringify(api.tramitacoes['2374400'])})`);
    ok(/DTQ 1:.*PSB.*§10 do art\. 23/.test(objs['2374400-53'] || ''),
       'o DVS do §10 do art. 23, do PSB, é amarrado à votação certa');
    ok(/DTQ 3:.*Emenda de Plenário nº 26/.test(objs['2374400-46'] || ''), 'e o destaque da Emenda 26');
    ok(/Requerimento do Dep\. Gilson Marques/.test(objs['2374400-23'] || ''), 'o requerimento de retirada de pauta também');
    ok(/Votação das Emendas do Senado/.test(objs['2374400-121'] || ''),
       'inclusive quando a linha começa com "Votação DAS", e não "do"');
  }
  {
    // A salvaguarda: linha consumida uma vez, em ordem. Duas votações com a
    // MESMA descrição não podem casar com o mesmo trecho da tramitação.
    const vots = [
      { id: 'v-1', dataHoraRegistro: '2023-01-01T10:00', descricao: 'Rejeitado o Requerimento.' },
      { id: 'v-2', dataHoraRegistro: '2023-01-01T11:00', descricao: 'Rejeitado o Requerimento.' },
    ];
    const tram = [
      { sequencia: 1, despacho: 'Votação do Requerimento do Dep. A, que solicita adiamento da discussão.' },
      { sequencia: 2, despacho: 'Rejeitado o Requerimento.' },
      { sequencia: 3, despacho: 'Votação do Requerimento do Dep. B, que solicita adiamento da votação.' },
      { sequencia: 4, despacho: 'Rejeitado o Requerimento.' },
    ];
    const objs = av(`objetosDaTramitacao(${JSON.stringify(vots)}, ${JSON.stringify(tram)})`);
    ok(/Dep\. A/.test(objs['v-1'] || ''), 'a primeira casa com o primeiro requerimento');
    ok(/Dep\. B/.test(objs['v-2'] || ''), 'e a segunda com o segundo — cada linha é consumida uma vez');
  }
  {
    // Objeto longe demais não é objeto: melhor calar que errar.
    const vots = [{ id: 'v-9', dataHoraRegistro: '2023-01-01T10:00', descricao: 'Aprovado.' }];
    const tram = [{ sequencia: 1, despacho: 'Votação do DTQ 99: coisa nenhuma.' }];
    for (let i = 2; i <= 12; i++) tram.push({ sequencia: i, despacho: 'Linha intermediária ' + i });
    tram.push({ sequencia: 13, despacho: 'Aprovado.' });
    const objs = av(`objetosDaTramitacao(${JSON.stringify(vots)}, ${JSON.stringify(tram)})`);
    ok(!objs['v-9'], 'objeto a mais de 8 linhas de distância é descartado — não se inventa contexto');
  }

  console.log('\n== consulta por proposição: o caso real ==');
  {
    document.getElementById('cvNumero').value = '3626';
    document.getElementById('cvAno').value = '2023';
    await av('cvConsultar()');

    // Cinco das seis: a votação 2374400-89 não tem correspondência na
    // tramitação, e o que não foi identificado fica fora do relatório.
    const itens = [...document.querySelectorAll('#cvResultado .cv-item')];
    ok(itens.length === 5, `as votações com objeto identificado aparecem (${itens.length} de 6)`);

    const ver = itens.map(i => i.querySelector('.cv-ver').textContent.trim());
    ok(ver.join(',') === 'Simbólica,Aderiu,Aderiu,Sem orientação,Ausente',
       `cada uma com o seu veredito (${ver.join(', ')})`);

    const votos = itens.map(i => i.querySelector('.cv-voto').textContent.replace(/\s+/g, ' ').trim());
    ok(votos[2] === 'Voto: Sim', `o voto aparece rotulado à esquerda (${votos[2]})`);
    ok(votos[0] === 'Voto: —', 'e a simbólica não inventa voto');

    const cab = document.querySelector('#cvResultado .cv-cab').textContent.replace(/\s+/g, ' ');
    ok(/Rodrigo Gambale/.test(cab) && /PODE-SP/.test(cab), 'o cabeçalho identifica o deputado');
    ok(/PL 3626\/2023/.test(cab), 'e a proposição');
    ok(/100\.0%/.test(cab), `aderência de 100% sobre as comparáveis (${(cab.match(/[\d.]+%/) || [])[0]})`);
    ok(/simbólica\(s\).*não contam como ausência/.test(cab),
       'e a tela explica que simbólica não é ausência');
    ok(/sem orientação do governo ficam fora do cálculo/.test(cab),
       'e que votação sem orientação fica fora da conta');

    ok(/DTQ 1:.*PSB/.test(itens[2].textContent), 'o item traz o objeto lido da tramitação');
    ok(/Governo: Sim/.test(itens[2].textContent), 'e a orientação que ele enfrentou');
  }

  console.log('\n== a perda do último dia do período está corrigida ==');
  {
    api.periodo.todas = [
      { id: 'p-1', data: '2026-08-10', dataHoraRegistro: '2026-08-10T15:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/69908', descricao: 'Aprovado A.' },
      { id: 'p-2', data: '2026-08-31', dataHoraRegistro: '2026-08-31T15:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/69908', descricao: 'Aprovado B.' },
      { id: 'p-3', data: '2026-09-01', dataHoraRegistro: '2026-09-01T15:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/69908', descricao: 'Fora do período.' },
      { id: 'p-4', data: '2026-08-20', dataHoraRegistro: '2026-08-20T15:00', siglaOrgao: 'CCJC', descricao: 'De comissão.' },
    ];
    api.votos['p-1'] = [voto('Sim')]; api.votos['p-2'] = [voto('Não')];
    api.votos['p-3'] = [voto('Sim')]; api.votos['p-4'] = [voto('Sim')];
    api.orientacoes['p-1'] = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }];
    api.orientacoes['p-2'] = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }];

    const r = await av(`cvPorPeriodo('2026-08-01','2026-08-31')`);
    const ids = r.itens.map(i => i.votacao.id).sort();
    ok(ids.join() === 'p-1,p-2',
       `a votação do ÚLTIMO dia (31/08) entra — era ela que se perdia (${ids.join(', ') || 'nenhuma'})`);
    ok(!ids.includes('p-3'), 'e o dia seguinte, pedido só para destravar a API, é descartado');
    ok(!ids.includes('p-4'), 'votação de comissão não entra: a aderência é de Plenário');

    const url = api.chamadas.find(u => /dataInicio=2026-08-01/.test(u));
    ok(/dataFim=2026-09-01/.test(url || ''), `a API é consultada até dataFim+1 (${(url || '').match(/dataFim=[\d-]+/)})`);
  }

  console.log('\n== falha de consulta é declarada, não silenciada ==');
  {
    api.derrubar = /\/votacoes\/2374400-53\/votos/;
    document.getElementById('cvNumero').value = '3626';
    await av('cvConsultar()');
    api.derrubar = null;
    const aviso = document.querySelector('#cvResultado .cv-aviso');
    ok(!!aviso && /não puderam ser lidas/.test(aviso.textContent),
       'a tela avisa quantas votações não foram lidas');
    ok(/o que está faltando é a consulta, não o voto/.test(aviso.textContent),
       'e diz o que a lacuna significa, para ninguém ler como ausência do deputado');
  }

  console.log('\n== exportação em PDF, no padrão do documento de conferência ==');
  {
    // Refaz a consulta do PL 3626 para ter `cv.ultimo` populado.
    document.getElementById('cvNumero').value = '3626';
    document.getElementById('cvAno').value = '2023';
    await av('cvConsultar()');

    ok(!!document.getElementById('cvExportarPdf'), 'o botão de PDF está na tela');
    ok(!!document.getElementById('cvExportar'), 'e o de Excel continua');

    const doc = av(`cvHtmlPDF('data:image/png;base64,AAAA')`);
    ok(/<h1>Dep\. Rodrigo Gambale \(PODE-SP\)<\/h1>/.test(doc), 'cabeçalho com o deputado');
    ok(/PL 3626\/2023/.test(doc), 'e a matéria consultada');
    ok(/src="data:image\/png;base64,AAAA"/.test(doc), 'a logo entra embutida, não por URL de extensão');

    ok(/<h2>Consolidado<\/h2>/.test(doc), 'seção Consolidado');
    ok(/<h2>Sessão de 13\/09\/2023/.test(doc) && /<h2>Sessão de 21\/12\/2023/.test(doc),
       'uma tabela por sessão');
    ok(!/<h2>Procedência dos dados<\/h2>/.test(doc) && !/objetosPossiveis/.test(doc),
       'e NÃO leva a procedência dos dados: o documento é de conferência, não de método');

    // O consolidado do documento tem de bater com o da tela.
    const cx = av('cv.ultimo.cont');
    const semEspaco = doc.replace(/\s+/g, ' ');

    // A faixa precisa FECHAR sozinha: votos dele = aderiu + divergiu + sem
    // orientação. Sem essa caixa, um relatório com 6 votos, 5 adesões e 0
    // divergências deixa o sexto voto sem explicação na própria linha, e a
    // pergunta vai para quem recebeu o documento.
    ok(/<div class="v">\d+<\/div><div class="l">Sem orientação<\/div>/.test(semEspaco),
       'a faixa do consolidado tem a caixa "Sem orientação"');
    const votosDele = (cx.aderente + cx.divergente + cx.ausente + cx['sem-gov']) - cx.ausente;
    ok(votosDele === cx.aderente + cx.divergente + cx['sem-gov'],
       'e a conta fecha: votos dele = aderiu + divergiu + sem orientação');
    ok(semEspaco.includes(`<div class="v">${cx.aderente}</div><div class="l">Aderiu</div>`),
       `as caixas repetem a contagem da tela (aderiu=${cx.aderente})`);
    ok(semEspaco.includes(`<div class="v">${cx.ausente}</div><div class="l">Ausente</div>`),
       `e a de ausências (ausente=${cx.ausente})`);

    ok(/Como ler\./.test(doc), 'a nota de "como ler" vai junto');
    ok(/simbólicas.*não são ausência do deputado/s.test(doc),
       'dizendo que simbólica não é ausência — é o que impede a leitura errada do número');
    ok(/sem orientação do Governo.*fica fora do cálculo/s.test(doc), 'e que sem orientação fica fora do cálculo');

    ok(/votação simbólica|tag-simb/.test(doc), 'as simbólicas são marcadas na tabela');
    ok(!/não identificado na tramitação/.test(doc),
       'item sem casamento seguro NÃO entra: o documento não carrega linha sem objeto');
    ok(/<b>1 votação\(ões\)<\/b> da ficha não entraram/.test(doc.replace(/\s+/g, ' ')),
       'mas o documento diz quantas ficaram de fora, e por quê — some o item, não a informação');
  }

  console.log('\n== link público de cada item ==');
  {
    const L = av(`cvLinks({ id: '2374400-53', uriEvento: 'https://x/eventos/69908' })`);
    ok(L.prop === 'https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2374400',
       `a ficha de tramitação sai do prefixo do id (${L.prop})`);
    ok(L.evento === 'https://www.camara.leg.br/evento-legislativo/69908', `e a sessão, do uriEvento (${L.evento})`);

    // Votação de proposição ANEXA aponta para a anexa, não para a matéria
    // consultada — é lá que está o requerimento de urgência.
    const A = av(`cvLinks({ id: '2414600-8', uriEvento: 'https://x/eventos/71780', proposicaoObjeto: 'REQ 4322/2023' })`);
    ok(/idProposicao=2414600/.test(A.prop), 'votação de anexa linka para a anexa');
    ok(A.rotuloProp === 'REQ 4322/2023', 'com o rótulo que a API dá, quando dá');

    // Sem dado, sem link inventado.
    const V = av(`cvLinks({ id: 'sem-id-numerico' })`);
    ok(V.prop === null && V.evento === null, 'sem id numérico e sem evento, nenhum link é fabricado');

    // O link é do GRUPO, não do item: nesta consulta todas as votações são da
    // mesma matéria e da mesma sessão, então repeti-lo em cada linha seria o
    // mesmo endereço seis vezes.
    const g = av('cvAgruparLinks(cv.ultimo.linhas)');
    ok(/idProposicao=2374400/.test(g.fichaComum || ''),
       'a ficha PREDOMINANTE é a do grupo (não precisa ser a única)');

    const cab = document.querySelector('#cvResultado .cv-cab');
    const hrefsCab = [...cab.querySelectorAll('.cv-links a')].map(a => a.getAttribute('href'));
    ok(hrefsCab.some(h => /fichadetramitacao/.test(h)), 'por isso ela sobe para o cabeçalho');
    ok([...cab.querySelectorAll('.cv-links a')].every(a => a.getAttribute('target') === '_blank'),
       'abrindo em aba nova, para não perder a consulta feita');

    const itens = [...document.querySelectorAll('#cvResultado .cv-item')];
    const naLinha = itens.flatMap(i => [...i.querySelectorAll('.cv-links a')].map(a => a.getAttribute('href')));
    ok(!naLinha.includes(g.fichaComum),
       'e nenhuma linha repete a ficha que já está no cabeçalho');
    ok(new Set(naLinha).size === naLinha.length,
       `nenhum link se repete entre as linhas (${naLinha.length} links, ${new Set(naLinha).size} distintos)`);
    const sessoesNaLinha = naLinha.filter(h => /evento-legislativo/.test(h));
    ok(sessoesNaLinha.length === 2 && new Set(sessoesNaLinha).size === 2,
       `cada sessão aparece UMA vez, na sua primeira votação — é separador, não etiqueta de linha (${sessoesNaLinha.length})`);

    const doc = av('cvHtmlPDF(null)');
    ok(/Ficha de tramitação no portal da Câmara/.test(doc), 'no PDF a ficha fica no cabeçalho');
    ok(/ver a sessão no portal/.test(doc), 'e o link da sessão, no título de cada sessão');
    const noPdf = [...doc.matchAll(/href="(https:\/\/www\.camara[^"]+)"/g)].map(m => m[1]);
    ok(new Set(noPdf).size === noPdf.length,
       `no PDF nenhum link se repete (${noPdf.length} links, ${new Set(noPdf).size} distintos)`);
  }

  console.log('\n== quando o link difere, ele fica na linha ==');
  {
    // Consulta por período: cada votação é de uma proposição diferente, e há
    // dois dias de sessão. Aí o link é informação da linha, não do grupo.
    av(`cv.ultimo = { linhas: [
        { it: { votacao: { id: '111-1', data: '2026-08-10', uriEvento: 'https://x/eventos/900', descricao: 'A' }, govOrient: 'Sim', nominal: true, votos: [] }, s: { voto: null, situacao: 'ausente' } },
        { it: { votacao: { id: '222-3', data: '2026-08-20', uriEvento: 'https://x/eventos/901', descricao: 'B' }, govOrient: 'Sim', nominal: true, votos: [] }, s: { voto: null, situacao: 'ausente' } }
      ], objetos: {}, prop: null, periodo: ['2026-08-01','2026-08-31'],
      dep: { nome: 'Fulano', partido: 'XX', uf: 'DF' }, retirados: [],
      cont: { aderente: 0, divergente: 0, ausente: 2, 'sem-gov': 0, simbolica: 0 }, pct: null }`);

    const g = av('cvAgruparLinks(cv.ultimo.linhas)');
    ok(g.fichaComum === null, 'com uma proposição por linha, não há ficha predominante');

    const doc = av('cvHtmlPDF(null)');
    ok(/idProposicao=111/.test(doc) && /idProposicao=222/.test(doc),
       'e cada linha leva a ficha da SUA proposição');
    ok(/evento-legislativo\/900/.test(doc) && /evento-legislativo\/901/.test(doc),
       'e cada sessão a sua');
    ok(!/Ficha de tramitação no portal/.test(doc), 'sem link de matéria no cabeçalho, que aqui não existe');
  }

  console.log('\n== destaques retirados entram no documento ==');
  {
    // Refaz a consulta: o bloco anterior trocou cv.ultimo por um caso sintético.
    document.getElementById('cvNumero').value = '3626';
    document.getElementById('cvAno').value = '2023';
    await av('cvConsultar()');
    const ret = av('cv.ultimo.retirados');
    ok(Array.isArray(ret) && ret.length > 0, `os destaques retirados são colhidos da tramitação (${ret.length})`);
    ok(ret.every(x => !/^Retirado o /.test(x.t)), 'sem o prefixo "Retirado o", que a seção já diz');
    const doc = av(`cvHtmlPDF(null)`);
    ok(/<h2>Destaques retirados antes da votação<\/h2>/.test(doc), 'a seção existe quando há retirados');
    ok(/não há voto a registrar/.test(doc), 'explicando que não houve votação');
    ok(/menos votações do que destaques apresentados/.test(doc),
       'e por que a matéria tem menos votações do que se esperaria');
  }

  console.log('\n== o que a tramitação não identifica fica fora ==');
  {
    document.getElementById('cvNumero').value = '3626';
    document.getElementById('cvAno').value = '2023';
    await av('cvConsultar()');
    const ids = av('cv.completo.linhas.map(l => l.it.votacao.id)');
    ok(!ids.includes('2374400-89'),
       'a votação sem casamento na tramitação não entra na lista');
    ok(ids.length === 5 && av('cv.completo.semObjeto') === 1,
       `sobram as 5 identificadas, e a descartada é contada (${ids.length}, descartadas: ${av('cv.completo.semObjeto')})`);
    ok(!/não identificado/.test(telaCvBruto()),
       'e o rótulo "objeto não identificado" não aparece mais na tela');
    ok(/1 votação\(ões\) da ficha ficaram fora do relatório/.test(telaCvBruto()),
       'a tela diz quantas saíram e por quê — some o item, não a informação');

    // A conta tem de acompanhar: contar uma votação que não se mostra seria
    // um consolidado que não fecha com a própria tabela.
    const c = av('cv.ultimo.cont');
    ok(c.simbolica === 1, `a simbólica descartada saiu também da contagem (simbólicas: ${c.simbolica})`);
  }
  {
    // Modo período: antes NENHUM item tinha objeto, porque a tramitação não era
    // lida. Aplicar a regra sem ler esvaziaria o relatório inteiro.
    api.periodo.todas = [
      { id: '888-1', data: '2026-03-10', dataHoraRegistro: '2026-03-10T15:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/5', descricao: 'Aprovado o Requerimento de urgência.' },
      { id: '888-2', data: '2026-03-10', dataHoraRegistro: '2026-03-10T16:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/5', descricao: 'Sem eco na tramitação.' },
    ];
    api.tramitacoes['888'] = [
      { sequencia: 1, despacho: 'Votação do Requerimento de urgência para o Projeto de Lei nº 1 de 2026.' },
      { sequencia: 2, despacho: 'Aprovado o Requerimento de urgência.' },
    ];
    api.votos['888-1'] = [voto('Sim')]; api.votos['888-2'] = [voto('Sim')];
    api.orientacoes['888-1'] = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }];
    api.orientacoes['888-2'] = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }];

    av("cvTrocarModo('periodo')");
    document.getElementById('cvDataIni').value = '2026-03-01';
    document.getElementById('cvDataFim').value = '2026-03-31';
    await av('cvConsultar()');
    ok(av('cv.completo.linhas.length') === 1,
       'no modo período a tramitação também é lida: o item com objeto fica');
    ok(av('cv.completo.semObjeto') === 1, 'e o sem objeto sai, como na consulta por proposição');
    ok(/Votação do Requerimento de urgência/.test(telaCvBruto()),
       'o objeto real aparece — antes o modo período não mostrava nenhum');
    av("cvTrocarModo('proposicao')");
  }

  console.log('\n== recorte: delimitar o período que sai no relatório ==');
  const telaCv = () => document.getElementById('cvResultado').textContent;
  const recortar = (ini, fim) => {
    const a = document.getElementById('cvRecIni'), b = document.getElementById('cvRecFim');
    a.value = ini; b.value = fim;
    b.dispatchEvent(new Event('change', { bubbles: true }));
  };
  {
    // Refaz a consulta: o bloco anterior deixou o estado no modo período.
    document.getElementById('cvNumero').value = '3626';
    document.getElementById('cvAno').value = '2023';
    await av('cvConsultar()');
    ok(av('cv.completo.linhas.length') === 5, 'a consulta guarda a tramitação inteira, menos o que não se identificou (5 de 6)');
    ok(av('cv.completo.semObjeto') === 1, 'e registra quantas foram descartadas por falta de objeto');
    const ini = document.getElementById('cvRecIni'), fim = document.getElementById('cvRecFim');
    ok(!!ini && !!fim, 'a faixa de recorte aparece com o resultado');
    ok(ini.value === '2023-09-13' && fim.value === '2023-12-21',
       'já preenchida com os limites do que veio — o padrão é TUDO, não um recorte');
    ok(ini.getAttribute('min') === '2023-09-13' && fim.getAttribute('max') === '2023-12-21',
       'e o calendário não oferece data fora do que existe');
    ok(document.getElementById('cvRecTudo').hasAttribute('disabled'),
       'o botão "Tudo" nasce desabilitado, porque já se está vendo tudo');
    const doc = av('cvHtmlPDF(null)');
    ok(!/Este documento é um recorte/.test(doc) && !/recorte de \d/.test(doc),
       'sem recorte, o documento não fala em recorte');
  }
  {
    const antes = api.chamadas.length;
    recortar('2023-09-13', '2023-09-13');

    ok(api.chamadas.length === antes, 'mudar o recorte NÃO consulta a API de novo — os dados já estão em mãos');
    ok(av('cv.ultimo.linhas.length') === 4, 'só as 4 votações da sessão de 13/09 entram (de 6)');
    ok(av('cv.completo.linhas.length') === 5, 'e as 5 continuam carregadas, prontas para alargar');
    ok(av('JSON.stringify(cv.ultimo.cont)') === JSON.stringify({ aderente: 2, divergente: 0, ausente: 0, 'sem-gov': 1, simbolica: 1 }),
       'o consolidado é recalculado sobre o recorte, não herdado do total');
    ok(!document.getElementById('cvRecTudo').hasAttribute('disabled'), 'e o botão "Tudo" se habilita');
    ok(/1 fora do recorte/.test(document.querySelector('.cv-recorte .cnt').textContent),
       'a tela diz quantas ficaram de fora');
  }
  {
    const doc = av('cvHtmlPDF(null)');
    ok(/recorte de 13\/09\/2023 a 13\/09\/2023/.test(doc),
       'o recorte é marcado no subtítulo do documento, junto da matéria');
    ok(/<title>[^<]*\(recorte 13\/09\/2023/.test(doc),
       'e no título da janela, que é o nome sugerido do arquivo');
    ok(!/Este documento é um recorte/.test(doc),
       'sem caixa de aviso no corpo — o subtítulo basta');
    ok(!/21\/12\/2023<\/td>|Sessão de 21\/12\/2023/.test(doc), 'as votações de dezembro não aparecem');

    // Destaque retirado em 21/12 num documento que cobre 13/09 seria um erro
    // factual: o documento diria que houve acordo numa sessão em que não houve.
    ok(!/DTQ 9/.test(doc), 'destaque retirado FORA do recorte sai do documento');
    ok(/DTQ 10/.test(doc), 'e o que não tem data legível fica — some só o que se sabe estar fora');
  }
  {
    // A distribuição precisa seguir o recorte; um gráfico do total sob um
    // consolidado do recorte seria o pior dos dois mundos.
    const svg = av('cvSvgEstatistica(cv.ultimo.cont, cv.ultimo.linhas.length)');
    ok(/>2<\/text>/.test(svg.replace(/\s+/g, ' ')) && />de 4<\/text>/.test(svg.replace(/\s+/g, ' ')),
       'o gráfico conta 2 qualificadas de 4 — os números do recorte');
  }
  {
    document.getElementById('cvRecTudo').dispatchEvent(new Event('click', { bubbles: true }));
    ok(av('cv.ultimo.linhas.length') === 5, '"Tudo" devolve o conjunto inteiro');
    ok(av('cv.ultimo.recorte') === null, 'e o documento volta a não ser recorte');
    ok(!/recorte/.test(av('cvHtmlPDF(null)')), 'nem no subtítulo');
  }
  {
    // Janela mais larga que a tramitação: nada fica de fora, logo não há
    // recorte a declarar. O contrário seria o documento ressalvar "0 ficaram
    // fora deste recorte", que é ruído se passando por rigor.
    recortar('2020-01-01', '2030-12-31');
    ok(av('cv.ultimo.linhas.length') === 5, 'janela larga demais mostra tudo');
    ok(av('cv.ultimo.recorte') === null, 'e não se declara recorte quando nada ficou de fora');
    ok(!/fora do recorte/.test(telaCv()), 'nem a tela fala em recorte');
  }
  {
    recortar('2024-01-01', '2024-12-31');
    ok(av('cv.ultimo.linhas.length') === 0, 'recorte que não pega nada não inventa linhas');
    ok(/Nenhuma das 5 votações/.test(telaCv()), 'a tela diz o que houve');
    ok(!document.getElementById('cvExportarPdf'), 'e não oferece exportar um documento vazio');
    ok(!!document.getElementById('cvRecTudo'), 'o controle continua na tela, para poder voltar');
  }
  {
    recortar('2023-12-21', '2023-09-13');
    ok(/data inicial do recorte é posterior/.test(telaCv()),
       'intervalo invertido é dito, em vez de sair um relatório vazio sem explicação');
    document.getElementById('cvRecTudo').dispatchEvent(new Event('click', { bubbles: true }));
    ok(av('cv.ultimo.linhas.length') === 5, 'e dá para voltar de lá');
  }

  console.log('\n== período: o documento se adapta ==');
  {
    av(`cv.ultimo = { linhas: [], objetos: {}, prop: null, periodo: ['2026-08-01','2026-08-31'],
        dep: { nome: 'Fulano', partido: 'XX', uf: 'DF' }, retirados: [],
        cont: { aderente: 0, divergente: 0, ausente: 0, 'sem-gov': 0, simbolica: 0 }, pct: null }`);
    const doc = av('cvHtmlPDF(null)');
    ok(/01\/08\/2026 a 31\/08\/2026/.test(doc), 'o título vira o período consultado');
    ok(!/Destaques retirados/.test(doc), 'sem retirados, a seção não aparece vazia');
    ok(!/dataFim \+ 1/.test(doc) && !/\/votacoes\/\{id\}/.test(doc),
       'e o documento não carrega nota de método nem nome de rota da API');
  }

  console.log('\n== todas as votações da matéria, de todos os anos ==');
  {
    // Uma matéria votada em anos diferentes: nada pode ficar de fora, e a
    // paginação (se a API um dia passar a cortar) tem de ser seguida.
    api.props.push({ id: 777, siglaTipo: 'PL', numero: 2148, ano: 2015, ementa: 'Matéria longeva.' });
    api.votacoes['777'] = [
      { id: '777-1', data: '2023-05-02', dataHoraRegistro: '2023-05-02T15:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/1', descricao: 'Aprovado em 2023.' },
      { id: '777-2', data: '2024-04-10', dataHoraRegistro: '2024-04-10T15:00', siglaOrgao: 'PLEN', uriEvento: 'https://x/eventos/2', descricao: 'Aprovado em 2024.' },
    ];
    // A tramitação precisa existir: item sem objeto identificado não entra no
    // relatório, e sem ela as duas votações sumiriam — que é o que se quer
    // provar aqui que NÃO acontece quando a tramitação responde.
    api.tramitacoes['777'] = [
      { sequencia: 1, despacho: 'Votação do Projeto de Lei, em turno único.' },
      { sequencia: 2, despacho: 'Aprovado em 2023.' },
      { sequencia: 3, despacho: 'Votação das Emendas do Senado ao Projeto de Lei.' },
      { sequencia: 4, despacho: 'Aprovado em 2024.' },
    ];
    api.votos['777-1'] = [voto('Sim')]; api.votos['777-2'] = [voto('Não')];
    api.orientacoes['777-1'] = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }];
    api.orientacoes['777-2'] = [{ siglaPartidoBloco: 'Governo', orientacaoVoto: 'Sim' }];

    document.getElementById('cvNumero').value = '2148';
    document.getElementById('cvAno').value = '2015';
    av(`cv.deputado = { id: 220641, nome: 'Rodrigo Gambale', partido: 'PODE', uf: 'SP' }`);
    await av('cvConsultar()');

    const itens = [...document.querySelectorAll('#cvResultado .cv-item')];
    ok(itens.length === 2, `as votações dos DOIS anos entram (${itens.length})`);
    const doc = av('cvHtmlPDF(null)');
    ok(/Sessão de 02\/05\/2023/.test(doc) && /Sessão de 10\/04\/2024/.test(doc),
       'e o PDF abre uma tabela para cada ano de sessão');

    // O parâmetro que NÃO pode voltar: nesta rota ele zera a lista em silêncio.
    const chamada = api.chamadas.find(u => /\/proposicoes\/777\/votacoes/.test(u));
    ok(!/[?&]itens=/.test(chamada || ''),
       `a consulta de votações não passa \`itens\` — nesta rota isso devolve lista vazia (${chamada})`);
  }

  console.log('\n== o gráfico da distribuição ==');
  {
    const svg = av(`cvSvgEstatistica({ aderente: 5, divergente: 0, ausente: 2, 'sem-gov': 0, simbolica: 33 }, 40)`);
    const plano = svg.replace(/\s+/g, ' ');
    ok(/^<svg /.test(svg), 'é SVG inline — imprime sem depender de script, como a CSP da janela exige');
    ok(/>7<\/text>/.test(plano) && /qualificadas<\/text>/.test(plano) && />de 40<\/text>/.test(plano),
       'o miolo da rosquinha diz quantas entraram no cálculo, e de que universo');
    ok(/33 das 40 votações ficaram fora do cálculo/.test(plano), 'e quantas ficaram de fora, com o motivo');
    ok(/aria-label="[^"]*de um universo de 40[^"]*"/.test(svg), 'com descrição textual para leitor de tela');

    // O recorte "7 de 40" é razão de duas partes: vira número, nunca uma segunda
    // rosquinha — pizza de duas fatias é justamente o que o manual reprova.
    ok((plano.match(/<path /g) || []).length === 2,
       'há um arco por categoria presente, e nenhuma figura extra para o recorte');

    // A ordem NÃO é decorativa: âmbar entre verde e vermelho é o que salva o
    // par adjacente na daltonia. Verde antes de âmbar antes de vermelho.
    const ordem = [...svg.matchAll(/fill="(#008300|#eda100|#d03b3b)"/g)].map(m => m[1]);
    ok(ordem[0] === '#008300' && ordem[1] === '#eda100',
       `Aderiu vem antes de Ausente, e o vermelho nunca encosta no verde (${ordem.join(' → ')})`);
    ok(!/#006633/.test(svg),
       'o verde do texto (#006633) NÃO é usado no gráfico: reprova em protanopia contra o vermelho');

    ok(!/#d03b3b/.test(svg), 'fatia de valor zero não é desenhada (Divergiu = 0)');
    ok(/>Aderiu<\/text> <text[^>]*>5 de 7 — 71\.4%/.test(plano) &&
       />Ausente<\/text> <text[^>]*>2 de 7 — 28\.6%/.test(plano),
       'a legenda traz rótulo, valor absoluto e percentual');
    ok(!/Divergiu/.test(svg), 'e não lista a categoria que não ocorreu');
  }
  {
    // Rótulo direto: dentro do anel quando a fatia comporta, fora quando não —
    // e a cor acompanha. Era aqui que saía tinta escura sobre fundo escuro.
    const largo = av(`cvSvgEstatistica({ aderente: 30, divergente: 5, ausente: 5, 'sem-gov': 0, simbolica: 0 }, 40)`);
    ok(/fill="#ffffff">30<\/text>/.test(largo.replace(/\s+/g, ' ')),
       'fatia larga: número dentro do anel, em branco');
    const fina = av(`cvSvgEstatistica({ aderente: 199, divergente: 1, ausente: 0, 'sem-gov': 0, simbolica: 0 }, 200)`);
    ok(/fill="#0b0b0b">1<\/text>/.test(fina.replace(/\s+/g, ' ')),
       'fatia fina: número fora do anel, em tinta — nunca escuro sobre escuro');
  }
  {
    // Uma volta inteira não cabe num único comando de arco do SVG: o caso de
    // categoria única se parte em duas metades, e sem vão.
    const unica = av(`cvSvgEstatistica({ aderente: 3, divergente: 0, ausente: 0, 'sem-gov': 0, simbolica: 8 }, 11)`);
    ok(/fill-rule="evenodd"/.test(unica), 'categoria única fecha o anel inteiro, sem fatia fantasma');
    ok(/3 de 3 — 100%/.test(unica.replace(/\s+/g, ' ')), 'e a legenda diz 100% sem casa decimal');
  }
  {
    ok(av(`cvSvgEstatistica({ aderente: 0, divergente: 0, ausente: 0, 'sem-gov': 0, simbolica: 12 }, 12)`) === '',
       'sem nenhuma votação qualificada, não se desenha figura de zero');
    ok(av(`cvSvgEstatistica({ aderente: 0, divergente: 0, ausente: 0, 'sem-gov': 0, simbolica: 0 }, 0)`) === '',
       'nem com consulta vazia');
  }
  {
    // No documento, a figura FECHA o corpo.
    document.getElementById('cvNumero').value = '3626';
    document.getElementById('cvAno').value = '2023';
    await av('cvConsultar()');
    const doc = av('cvHtmlPDF(null)');
    ok(/<h2>Distribuição dos votos<\/h2>/.test(doc), 'a seção existe no PDF');
    ok(doc.indexOf('Distribuição dos votos') > doc.indexOf('<h2>Consolidado</h2>')
       && /Distribuição dos votos[\s\S]*<div class="ft">/.test(doc),
       'e fecha o corpo, entre as tabelas e a assinatura');
    ok(/break-inside: avoid/.test(doc), 'a figura não se parte entre páginas');
  }

  console.log('\n== proposição sem votação, e sem deputado escolhido ==');
  {
    api.props.push({ id: 999, siglaTipo: 'PL', numero: 1, ano: 2026, ementa: 'Sem votação.' });
    api.votacoes['999'] = [];
    document.getElementById('cvNumero').value = '1';
    document.getElementById('cvAno').value = '2026';
    await av('cvConsultar()');
    ok(/não tem votação registrada/.test(document.getElementById('cvStatus').textContent),
       'proposição sem votação é dita, não some');

    av('cv.deputado = null');
    await av('cvConsultar()');
    ok(/Escolha o\(a\) deputado/.test(document.getElementById('cvStatus').textContent),
       'e sem deputado a consulta não roda');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
