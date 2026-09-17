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

// ---------- o caso real: PL 3626/2023 ----------
const GAMBALE = { id: 220641, nome: 'Rodrigo Gambale', siglaPartido: 'PODE', siglaUf: 'SP' };
api.deputados = [
  GAMBALE,
  { id: 999001, nome: 'Rodrigo Gambale Filho', siglaPartido: 'PL', siglaUf: 'RJ' },  // homônimo
];
api.props = [{ id: 2374400, siglaTipo: 'PL', numero: 3626, ano: 2023, ementa: 'Dispõe sobre a modalidade lotérica denominada apostas de quota fixa.' }];
api.votacoes['2374400'] = [
  { id: '2374400-23', data: '2023-09-13', dataHoraRegistro: '2023-09-13T18:18:00', siglaOrgao: 'PLEN', descricao: 'Rejeitado o Requerimento.' },
  { id: '2374400-46', data: '2023-09-13', dataHoraRegistro: '2023-09-13T19:57:00', siglaOrgao: 'PLEN', descricao: 'Rejeitada a Emenda de Plenário nº 26. Sim: 82; não: 342; abstenção: 8; total: 432.' },
  { id: '2374400-53', data: '2023-09-13', dataHoraRegistro: '2023-09-13T20:26:00', siglaOrgao: 'PLEN', descricao: 'Suprimido o texto. Sim: 222; não: 242; abstenção: 2; total: 466.' },
  { id: '2374400-58', data: '2023-09-13', dataHoraRegistro: '2023-09-13T20:37:00', siglaOrgao: 'PLEN', descricao: 'Aprovada a Emenda de Plenário nº 34. Sim: 203; não: 164; total: 367.' },
  { id: '2374400-121', data: '2023-12-21', dataHoraRegistro: '2023-12-21T00:28:00', siglaOrgao: 'PLEN', descricao: 'Rejeitada a Emenda do Senado Federal nº 3. Sim: 120; não: 261; abstenção: 1; total: 382.' },
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

    const itens = [...document.querySelectorAll('#cvResultado .cv-item')];
    ok(itens.length === 5, `as cinco votações aparecem (${itens.length})`);

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
      { id: 'p-1', data: '2026-08-10', dataHoraRegistro: '2026-08-10T15:00', siglaOrgao: 'PLEN', descricao: 'Aprovado A.' },
      { id: 'p-2', data: '2026-08-31', dataHoraRegistro: '2026-08-31T15:00', siglaOrgao: 'PLEN', descricao: 'Aprovado B.' },
      { id: 'p-3', data: '2026-09-01', dataHoraRegistro: '2026-09-01T15:00', siglaOrgao: 'PLEN', descricao: 'Fora do período.' },
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
