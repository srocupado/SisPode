// Bot: print das votações NOMINAIS da sessão do Congresso Nacional (12/11/2026).
//
// A sessão conjunta corre no Plenário da Câmara, com o painel de votação no mesmo portal, mas nos Dados
// Abertos o evento é do órgão CN (111), não do Plenário (180): o monitor nunca a via e as nominais saíam sem
// print. Decisão da Liderança (opção 1): na sessão do CN o bot manda SÓ o anúncio da nominal e o print.
//
// O que este teste trava:
//   1. o monitor acha a sessão do órgão CN e a ativa sem "ABERTA A SESSÃO" nem oferta da Ordem do Dia;
//   2. no painel: só as nominais — anúncio "VOTAÇÃO NOMINAL — SESSÃO DO CONGRESSO NACIONAL" com o apelido da
//      pauta salva pelo módulo de Congresso, e o print (legenda da bancada; "votos dos deputados" no título);
//      simbólica não é anunciada; sem "INICIADA A ORDEM DO DIA", sem página do evento/oradores/fim da ODD;
//   3. o cosev (tickAbertura) não anuncia simbólica nem roda a rede de faltantes na sessão do CN;
//   4. o fim da sessão do CN não manda "ENCERRADA A SESSÃO" nem agenda resumo;
//   5. com sessão da Câmara e do CN em curso, vale a da Câmara — e o fluxo da Câmara segue como era.
// Uso: node testes/bot-congresso-nominal.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const portalReal = require(path.join(RAIZ, 'bot', 'src', 'portal.js'));

function montar({ eventos180 = [], eventos111 = [], itens = [], votacao = null }) {
  const reg = { msgs: [], fotos: [], patches: [], chamadas: { destaques: 0, faltantes: 0, discussao: 0, pagEvento: 0 }, descricoes: [] };
  const html = (sel) => `<select id="dropDownReunioes">${itens.map(i => `<option value="${i.id}"${String(i.id) === String(sel) ? ' selected' : ''}>${i.rotulo}</option>`).join('')}</select>`;
  const mocks = {
    './firebase': {
      fbGet: async p => ({
        '/congresso_pautas_meta': { p_596834: { data: '12/11/2026' }, p_574056: { data: '18/06/2026' } },
        '/congresso_pautas/p_596834/plns/pln-25-2026/apelido': 'Eletronuclear S.A',
      })[p] ?? null,
      fbPatch: async (p, v) => { reg.patches.push({ p, v }); }, fbPut: async () => {},
    },
    './portal': { ...portalReal,
      paginaSessao: async (id, item) => html(item),
      parsePlacarPortal: async (_h, o) => { reg.descricoes.push(o.descricao); return { temVotos: true, descricao: o.descricao, global: { sim: 261, nao: 155 }, bancada: [{ nome: 'Renata Abreu', siglaUf: 'SP', tipoVoto: 'Sim', classe: 'sim' }], parcial: {} }; },
    },
    './oradores': { listasDeOradores: async () => [], oradoresDaLista: async () => [], esperaPorTaxa: () => 0 },
    './faltamvotar': { faltamVotar: async () => { reg.chamadas.faltantes++; return { aberta: false }; }, formatarFaltantes: () => '' },
    './plenariocosev': {
      statusPlenario: async () => ({ presentes: 300, oddIniciada: true }),
      sessaoAtual: async () => ({ aberta: true, deliberativa: true, numSessao: 23, nome: 'SESSÃO CONJUNTA Nº 023 - 12/11/2026', votacao }),
    },
    './imagem': { imagemVotacao: async () => Buffer.from('PNG') },
    './worker': { resumoSessao: async () => '' },
    './pauta': { pautaAtualImportada: async () => null },
    './perguntar': { carregarAnaliseMaisRecente: async () => null },
    './destaques': { buscarDestaquePreparado: async () => { reg.chamadas.destaques++; return null; } },
    'grammy': { InlineKeyboard: class { text() { return this; } }, InputFile: class { constructor(b) { this.b = b; } } },
  };
  const fetchFake = async (url) => {
    url = String(url);
    const resp = (corpo) => ({ ok: true, status: 200, json: async () => corpo, text: async () => '' });
    if (/\/eventos\?/.test(url)) return resp({ dados: /idOrgao=180/.test(url) ? eventos180 : /idOrgao=111/.test(url) ? eventos111 : [] });
    if (/\/eventos\/\d+\/pauta/.test(url)) { reg.chamadas.pagEvento++; return resp({ dados: [] }); }
    if (/proposicoes\?/.test(url)) return resp({ dados: [{ ementa: 'Abre ao Orçamento de Investimento da União crédito suplementar.' }] });
    if (/evento-legislativo/.test(url)) { reg.chamadas.discussao++; return { ok: true, status: 200, text: async () => '<html></html>' }; }
    return resp({});
  };
  let src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'monitor.js'), 'utf8')
    .replace('function janelaAtiva() {', 'function janelaAtiva() { return true;')
    + `\nmodule.exports.__t = { tickEventos, tickPainel, tickAbertura, encerrarSessao, get sessao() { return _sessao; }, set cfg(c) { _cfg = c; } };`;
  const module = { exports: {} };
  const ctx = {
    module, exports: module.exports, require: n => mocks[n] || require(n), console: { log() {}, warn() {}, error() {} },
    fetch: fetchFake, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, AbortController, AbortSignal, Buffer, Intl, Date, URL,
  };
  vm.createContext(ctx);
  new vm.Script(src).runInContext(ctx);
  const T = module.exports.__t;
  T.cfg = {
    ligado: true, destino: () => 'grupo', admin: null, ensaio: () => false,
    api: {
      sendMessage: async (_d, t) => { reg.msgs.push(t); return { message_id: reg.msgs.length }; },
      sendPhoto: async (_d, f, o) => { reg.fotos.push(o && o.caption); return { message_id: 900 + reg.fotos.length }; },
    },
  };
  return { T, reg };
}

const EV_CN = { id: 83280, descricaoTipo: 'Sessão Deliberativa', situacao: 'Em Andamento', dataHoraInicio: '2026-11-12T08:00', descricao: "Apreciação dos PLN's" };
const EV_CD = { id: 83300, descricaoTipo: 'Sessão Deliberativa Extraordinária', situacao: 'Em Andamento', dataHoraInicio: '2026-11-12T14:00', descricao: 'Sessão Deliberativa Extraordinária' };
const ITENS = [
  { id: 13990, rotulo: 'REQUERIMENTO DE INVERSÃO DE PAUTA' },
  { id: 13991, rotulo: 'PLN Nº 25/2026 - PROJETO DE LEI DO CONGRESSO NACIONAL (Nominal)' },
];

(async () => {
  console.log('== 1. a sessão do órgão CN é achada e ativada só para as nominais ==');
  {
    const { T, reg } = montar({ eventos111: [EV_CN], itens: ITENS });
    await T.tickEventos();
    await new Promise(r => setTimeout(r, 30));
    ok(T.sessao && T.sessao.id === 83280 && T.sessao.cn === true, 'sessão 83280 (órgão CN) ativa, marcada como do Congresso');
    ok(!reg.msgs.some(m => /ABERTA A SESS[ÃA]O|Importar a \*Ordem do Dia/.test(m)), 'sem "ABERTA A SESSÃO" e sem oferta de importar a Ordem do Dia');

    console.log('\n== 2. painel: anúncio da nominal + print; nada mais ==');
    await T.tickPainel();   // garante um tick completo (o da ativação pode ter corrido em paralelo)
    await T.tickPainel();
    const anuncios = reg.msgs.filter(m => /VOTAÇÃO NOMINAL/.test(m));
    ok(anuncios.length === 1 && /^\*VOTAÇÃO NOMINAL — SESSÃO DO CONGRESSO NACIONAL\*\n\n.*PLN 25\/2026.* \(Eletronuclear S\.A\)$/.test(anuncios[0]), `anúncio único, com o apelido da pauta do Congresso: ${JSON.stringify(anuncios[0])}`);
    ok(reg.fotos.length === 1, 'um print (a votação já tem votos)');
    ok(reg.descricoes[0] === 'Sessão Conjunta · votos dos deputados · PLN 25/2026', `título do print, numa linha: ${reg.descricoes[0]}`);
    ok(reg.patches.some(x => /monitor_sessao\/83280/.test(x.p) && x.v['prints/13991']), 'o placar vai para o Firebase (Prints da sessão da extensão)');
    ok(!reg.msgs.some(m => /INICIADA A ORDEM DO DIA|INVERSÃO|simbolicamente|Anunciad/i.test(m)), 'sem "INICIADA A ORDEM DO DIA" e sem anúncio da simbólica');
    ok(reg.chamadas.discussao === 0 && reg.chamadas.pagEvento === 0 && reg.chamadas.destaques === 0, 'sem página do evento, sem fim da ODD, sem módulo de Destaques');

    console.log('\n== 3. cosev: sem simbólicas nem faltantes na sessão do CN ==');
    const r3 = montar({ eventos111: [EV_CN], itens: ITENS, votacao: { id: 13995, tipoVotacao: 'S', simbolica: true, titulo: 'PLN Nº 4/2026 - PROJETO DE LEI DO CONGRESSO NACIONAL' } });
    await r3.T.tickEventos();
    await r3.T.tickAbertura();
    ok(!r3.reg.msgs.some(m => /PLN 4\/2026|simbolicamente/i.test(m)), 'a simbólica vista no cosev não é anunciada');
    const r3b = montar({ eventos111: [EV_CN], itens: [], votacao: { id: 13991, tipoVotacao: 'E', simbolica: false, titulo: 'PLN Nº 25/2026 - PROJETO DE LEI DO CONGRESSO NACIONAL' } });
    await r3b.T.tickEventos();
    await r3b.T.tickAbertura();
    ok(r3b.reg.chamadas.faltantes === 0, 'a rede de faltantes (Câmara) não roda');

    console.log('\n== 4. fim da sessão do CN ==');
    const antes = reg.msgs.length;
    await T.encerrarSessao();
    ok(!T.sessao && reg.msgs.length === antes, 'encerra em silêncio: sem "ENCERRADA A SESSÃO" e sem resumo');
  }

  console.log('\n== rótulos do painel do Congresso ==');
  {
    const id = r => portalReal.identificarItem(r);
    ok(id('PLN  Nº 25/2026 - PROJETO DE LEI DO CONGRESSO NACIONAL (Nominal)').texto === 'Votação do *PLN 25/2026*', 'PLN (rótulo real, com dois espaços) vira "Votação do *PLN 25/2026*" — antes: "Votação: PLN  Nº 25/2026 - …", sem referência');
    ok(id('PLN Nº 23/2026 - SUBSTITUTIVO AO PROJETO DE LEI DO CONGRESSO NACIONAL (Nominal)').texto === 'Votação do Substitutivo do *PLN 23/2026*', 'substitutivo do PLN (rótulo real)');
    ok(JSON.stringify(id('VETO Nº 14/2025 - VETO PARCIAL (Nominal)').ref) === JSON.stringify({ sigla: 'VET', numero: '14', ano: '2025' }), 'veto vira a referência VET');
    ok(id('REQ Nº 1233/2026 - URGÊNCIA PARA APRECIAÇÃO DO PL Nº 849/2025 (Nominal)').texto === 'Votação da Urgência do *PL 849/2025*', 'rótulo da Câmara: como era');
  }

  console.log('\n== 5. sessão da Câmara: prioridade e fluxo de sempre ==');
  {
    const { T, reg } = montar({ eventos180: [EV_CD], eventos111: [EV_CN], itens: ITENS });
    await T.tickEventos();
    await new Promise(r => setTimeout(r, 30));
    ok(T.sessao && T.sessao.id === 83300 && !T.sessao.cn, 'com as duas em curso, vale a sessão da Câmara');
    ok(reg.msgs.some(m => /ABERTA A SESSÃO EXTRAORDINÁRIA/.test(m)), 'a Câmara segue com "ABERTA A SESSÃO"');
    await T.tickPainel();
    ok(reg.msgs.some(m => /INICIADA A ORDEM DO DIA/.test(m)), '…"INICIADA A ORDEM DO DIA"');
    ok(reg.msgs.some(m => /^\*VOTAÇÃO NOMINAL\*\n\n/.test(m)) && !reg.msgs.some(m => /SESSÃO DO CONGRESSO/.test(m)), '…anúncio da nominal sem a marca do Congresso');
    ok(reg.msgs.some(m => /INVERSÃO DE PAUTA/i.test(m)), '…e a simbólica anunciada');
    ok(reg.descricoes.every(d => !/Sessão Conjunta/.test(d)), '…print sem a marca da sessão conjunta');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO FATAL:', e); process.exit(1); });
