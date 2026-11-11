// Revisão do módulo de Plenário (Análise de Pauta) de 11/11/2026 — dez correções.
//
// O que este teste trava (um bloco por achado):
//   1. parecer novo publicado no MESMO dia marca a nota como desatualizada, e o PRLP do dia em
//      que as emendas do Senado chegaram é o delas;
//   2. página de emendas que não carrega é FALHA, não "sem emendas do Senado": a geração para,
//      a verificação fica inconclusiva e a falha não fica em cache;
//   3. autoria de apensado que não pôde ser consultada fica "não verificada", não "não-Podemos";
//   4. a mensagem "Itens do Podemos" avisa os itens cuja autoria/apensados não foram verificados;
//   5. fonte que falha não apaga o vínculo do requerimento já apurado;
//   6. o analista e o apelido digitados no card são gravados no item da pauta;
//   7. requerimento s/nº sem projeto lido tem chave própria de cada pauta;
//   8. REQ com homônimos (mesmo número em vários órgãos): vale o de urgência; sem um só, não escolhe;
//   9. OpenAI: modelos de raciocínio nunca recebem temperature;
//  10. a varredura de análises órfãs lê só as chaves (shallow=true).
//
// As funções de analise.js são avaliadas em escopo próprio, com colaboradores de mentira
// (rede e DOM), como em testes/analise-mpv.test.js.
// Uso: node testes/plenario-revisao-2026-11-11.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const { DOMParser } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const P = require(path.join(RAIZ, 'pauta-parser.js'));
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const srcIA = fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8');
const trechoDe = (fonte, re) => { const m = fonte.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const trecho = re => trechoDe(src, re);
const fn = nome => trecho(new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const rejeita = async p => { try { await p; return null; } catch (e) { return e; } };

(async () => {
  // ---------------------------------------------------------------- 1 e 2: documentos operativos
  let respostaEMS = { ems: null, ssp: null }, chamadasEMS = 0;
  const A = new Function('console', 'resolverMPVDeclarando', 'buscarEmendasSenadoESSP', 'resolverApensados', 'fetchJson', 'API_BASE',
    'buscarPareceresPlenario', 'resolveProposicao', 'atualizarBadgesCard', 'isAbortError', `
    ${trecho(/const CENARIO_MPV\s+= [^\n]+/)}
    ${trecho(/const CENARIO_MPV_8A = [^\n]+/)}
    ${trecho(/const CENARIO_MPV_8B = [^\n]+/)}
    ${trecho(/const CENARIO_MPV_8B_PROPOSTO = [^\n]+/)}
    ${trecho(/const TIPOS_MPV = [^\n]+/)}
    ${trecho(/const TIPOS_OPERATIVOS = [^\n]+/)}
    ${fn('tipoLabel')}
    ${fn('ehMPV')}
    ${fn('ehPDL')}
    ${fn('classificarCenario')}
    ${fn('operativosAtuais')}
    ${fn('desatualizacaoOperativa')}
    ${fn('escolherDocumentos')}
    ${fn('verificarAtualizacaoItem')}
    return { classificarCenario, desatualizacaoOperativa, escolherDocumentos, verificarAtualizacaoItem };
  `)(
    { log() {}, warn() {}, info() {} },
    async () => { throw new Error('não é MPV'); },
    async () => { chamadasEMS++; return respostaEMS; },
    async () => [],
    async () => ({ dados: {} }), 'https://api',
    async () => ({ comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null, prlEspecial: null, sbtAEspecial: null }),
    async () => ({ id: 1 }), () => {}, () => false);

  const projeto = (enr, documentos) => ({ tipoCategoria: 'projeto', sigla: 'PL', numero: '1828', ano: '2023', chave: 'PL-1828-2023',
    enriquecimento: Object.assign({ status: 'ok', idProposicao: 1, urlInteiroTeor: 'https://c/teor', apensadosPodemos: [] }, enr),
    ...(documentos ? { analise: { documentos } } : {}) });
  const pareceres = extra => Object.assign({ comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null, prlEspecial: null, sbtAEspecial: null }, extra);

  console.log('== 1. parecer novo no mesmo dia ==');
  {
    const prlp3 = { sigla: 'PRLP', sequencial: 3, url: 'https://c/prlp3', data: '2026-08-12', dataBR: '12/08/2026' };
    const nota = [{ tipo: 'PRLP', rotulo: 'PRLP nº 2 de 12/08/2026', url: 'https://c/prlp2' }, { tipo: 'REDACAO_ORIGINAL', rotulo: 'Redação original (inteiro teor)', url: 'https://c/teor' }];
    const it = projeto({ pareceresPlenario: pareceres({ prlp: prlp3 }), emendasSenado: { ems: null, ssp: null } }, nota);
    const d = A.desatualizacaoOperativa(it);
    ok(d.novos.length === 1 && d.novos[0].url === 'https://c/prlp3', `nota sobre o PRLP 2 de 12/08 e PRLP 3 publicado no mesmo dia → desatualizada (${d.novos.length} novo(s))`);
    // controle: o mesmo documento da nota não é novo; e um documento MAIS ANTIGO que a nota também não
    const mesmo = projeto({ pareceresPlenario: pareceres({ prlp: { url: 'https://c/prlp2', data: '2026-08-12' } }), emendasSenado: { ems: null, ssp: null } }, nota);
    ok(A.desatualizacaoOperativa(mesmo).novos.length === 0, 'o próprio documento da nota não conta como novo');
    const antigo = projeto({ pareceresPlenario: pareceres({ sbtA: { url: 'https://c/sbta', data: '2026-06-01' } }), emendasSenado: { ems: null, ssp: null } }, nota);
    ok(A.desatualizacaoOperativa(antigo).novos.length === 0, 'documento operativo anterior ao da nota continua fora (sem falso positivo)');
    // PRLP proferido no dia em que as emendas do Senado chegaram
    const ems = { url: 'https://c/ems', seq: 9, data: '2026-09-01', dataBR: '01/09/2026' };
    const itE = projeto({ pareceresPlenario: pareceres({ prlp: { sequencial: 4, url: 'https://c/prlp4', data: '2026-09-01', dataBR: '01/09/2026' } }), emendasSenado: { ems, ssp: null } });
    const docs = await A.escolherDocumentos(itE);
    ok(docs.some(x => x.tipo === 'PRLP') && /Cenário 7/.test(A.classificarCenario(docs)), `PRLP do mesmo dia da EMS entra como o parecer das emendas (${A.classificarCenario(docs)})`);
    const itA = projeto({ pareceresPlenario: pareceres({ prlp: { sequencial: 1, url: 'https://c/prlp1', data: '2025-03-10', dataBR: '10/03/2025' } }), emendasSenado: { ems, ssp: null } });
    ok(/Cenário 6/.test(A.classificarCenario(await A.escolherDocumentos(itA))), 'PRLP da 1ª passagem (anterior ao Senado) continua de fora: Cenário 6');
  }

  console.log('\n== 2. página de emendas que não carrega ==');
  {
    // a função de leitura: página que não veio → falha; página lida sem EMS → sem falha
    let paginas = [null, null];
    const B = new Function('fetchHtmlCamara', 'DOMParser', `${fn('parseDataBR')}\n${fn('buscarEmendasSenadoESSP')}\nreturn buscarEmendasSenadoESSP;`)(async () => paginas.shift(), DOMParser);
    const f1 = await B(1);
    ok(f1.falha === true && !f1.ems && !f1.ssp, 'nenhuma das duas listas veio: { falha: true } (antes: "sem EMS", igual a uma página lida)');
    const html = linhas => `<html><body><table>${linhas}</table></body></html>`;
    paginas = [html('<tr><td>EMP 1</td><td>10/03/2025</td></tr>'), html('')];
    const f2 = await B(1);
    ok(!f2.falha && !f2.ems, 'as duas listas lidas e sem EMS: sem emendas do Senado, sem marca de falha');
    paginas = [html('<tr><td>Emenda/Substitutivo do Senado</td><td>01/09/2026</td><td><a href="prop_mostrarintegra?codteor=77">EMS</a></td></tr>'), null];
    const f3 = await B(1);
    ok(!!f3.ems && f3.falha === true, 'uma lista com a EMS e a outra que não veio: a EMS vale, e a falha fica marcada');

    // a geração: falha → para com mensagem; não fica em cache; na tentativa seguinte, lê de novo
    const it = projeto({ pareceresPlenario: pareceres({ prlp: { sequencial: 1, url: 'https://c/prlp1', data: '2025-03-10', dataBR: '10/03/2025' } }) });
    respostaEMS = { ems: null, ssp: null, falha: true }; chamadasEMS = 0;
    const e1 = await rejeita(A.escolherDocumentos(it));
    ok(e1 && /página de emendas/.test(e1.message), `geração para: "${e1 && e1.message.slice(0, 60)}…" (antes: nota de Cenário 3 sobre o texto anterior ao Senado)`);
    const e2 = await rejeita(A.escolherDocumentos(it));
    ok(e2 && chamadasEMS === 2, 'a falha não fica em cache: a nova tentativa reconsulta a página');
    respostaEMS = { ems: { url: 'https://c/ems', seq: 9, data: '2026-09-01', dataBR: '01/09/2026' }, ssp: null };
    const docs = await A.escolherDocumentos(it);
    ok(docs.some(d => d.tipo === 'EMS') && chamadasEMS === 3, 'com a página no ar, a EMS aparece e a nota sai no cenário do retorno do Senado');
    // EMS achada com a outra lista fora: o cenário já está definido, a geração segue
    const itP = projeto({ pareceresPlenario: pareceres() });
    respostaEMS = { ems: { url: 'https://c/ems', seq: 9, data: '2026-09-01', dataBR: '01/09/2026' }, ssp: null, falha: true };
    ok((await A.escolherDocumentos(itP)).some(d => d.tipo === 'EMS'), 'EMS em mãos com a outra lista fora do ar: a geração segue');

    // a verificação: inconclusiva, e o cache anterior é mantido
    const itV = projeto({ pareceresPlenario: pareceres(), emendasSenado: { ems: null, ssp: null } }, [{ tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor', url: 'https://c/teor' }]);
    respostaEMS = { ems: null, ssp: null, falha: true };
    const dv = await A.verificarAtualizacaoItem(itV);
    ok(dv.inconclusa === true && !itV.enriquecimento.emendasSenado.falha, '"Verificar atualização" com a página de emendas fora: inconclusiva (antes: "em dia"), cache mantido');
    respostaEMS = { ems: null, ssp: null };
    ok(!(await A.verificarAtualizacaoItem(itV)).inconclusa, 'com a página lida e nada novo: em dia');
  }

  console.log('\n== 3. autoria de apensado não verificada ==');
  {
    const R = new Function('fetchApensados', 'fetchAutoresProposicao', `${fn('resolverApensados')}\nreturn resolverApensados;`)(
      async () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      async id => { if (id === 2) throw new Error('HTTP 504'); return id === 1 ? [{ nome: 'Ana', isPodemos: true }] : id === 3 ? [{ nome: '?', isPodemos: false, autoriaIncerta: true }] : [{ nome: 'Zé', isPodemos: false }]; });
    const [a1, a2, a3, a4] = await R(99);
    ok(a1.autoriaPodemos === true && !a1.autoriaIncerta, 'apensado do Podemos: marcado, sem incerteza');
    ok(a2.autoriaPodemos === false && a2.autoriaIncerta === true, 'consulta dos autores que falhou: NÃO VERIFICADA (antes: só "não é do Podemos")');
    ok(a3.autoriaIncerta === true, 'autor cujo partido não pôde ser consultado: também não verificada');
    ok(a4.autoriaPodemos === false && a4.autoriaIncerta === false, 'autoria lida e de outro partido: não-Podemos, sem incerteza');
    const enr = fn('enriquecerItem');
    ok(/const incertos = apensados\.filter\(ap => ap\.autoriaIncerta\)\.length;\s*if \(incertos\) it\.enriquecimento\.apensadosFalha = /.test(enr), 'o enriquecimento marca o item (apensadosFalha) — o card oferece ↻ Reverificar');
    ok(/if \(incertos\) enr\.apensadosFalha = /.test(fn('escolherDocumentos')), 'e a resolução sob demanda, ao gerar, marca do mesmo jeito');
  }

  console.log('\n== 4. mensagem "Itens do Podemos" avisa o que não foi verificado ==');
  {
    const toasts = [];
    let msg = { texto: 'x', total: 1 };
    const state = { pauta: { itens: [
      { sigla: 'PL', numero: '1', ano: '2026', enriquecimento: { status: 'ok', autoriaPodemos: true } },
      { sigla: 'PL', numero: '2', ano: '2026', enriquecimento: { status: 'erro', erro: 'HTTP 504' } },
      { sigla: 'PLP', numero: '3', ano: '2026', enriquecimento: { status: 'ok', apensadosFalha: 'autoria de 1 apensado(s) não verificada' } },
      { sigla: 'PL', numero: '4', ano: '2026', enriquecimento: { status: 'ok' } }] } };
    const C = new Function('state', 'mostrarToast', 'enriquecerItem', 'prepararApelidos', 'itemDoPodemos', 'montarMensagemPropPartido', 'copiarParaAreaTransferencia', `
      ${trecho(/const enriquecimentoFalhou = [^\n]+/)}
      ${fn('tipoLabel')}
      ${fn('copiarPropPartido')}
      return copiarPropPartido;`)(state, (t, tom) => toasts.push({ t, tom }), async () => {}, async () => {}, () => true, () => msg, async () => true);
    await C();
    const t = toasts[toasts.length - 1];
    ok(/✓ 1 item\(ns\) do Podemos copiados/.test(t.t) && /⚠ 2 item\(ns\) com autoria ou apensados NÃO verificados/.test(t.t) && /2\/2026/.test(t.t) && /3\/2026/.test(t.t) && !/4\/2026/.test(t.t),
      'copiou, e avisa os 2 itens não verificados pelo nome (o item conferido e fora da lista não é citado)');
    ok(t.tom === 'aviso', 'o tom é de aviso, não de sucesso');
    msg = { texto: '', total: 0 };
    await C();
    ok(/Nenhuma proposição do Podemos confirmada/.test(toasts[toasts.length - 1].t) && /NÃO verificados/.test(toasts[toasts.length - 1].t), 'lista vazia com itens não verificados: "nenhuma CONFIRMADA", com o aviso (antes: "nenhuma nesta pauta")');
    state.pauta.itens = [state.pauta.itens[3]];
    await C();
    ok(/^Nenhuma proposição do Podemos \(autoria, apensado ou relatoria\) nesta pauta\.$/.test(toasts[toasts.length - 1].t), 'tudo verificado e nada do Podemos: a mensagem de sempre');
  }

  console.log('\n== 5. fonte que falha não apaga o vínculo do requerimento ==');
  {
    let erroFicha = new Error('HTTP 504'), mapa = Object.assign(new Map(), { falhou: true });
    const V = new Function('resolveProposicao', 'vinculosDoEvento', 'dataPautaISO', 'detectarProjetoUrgenciado', `
      ${trecho(/const mesmoAlvo = [^\n]+\n[^\n]+;/)}
      ${fn('decidirVinculo')}
      ${fn('apurarVinculoReq')}
      return apurarVinculoReq;`)(async () => { if (erroFicha) throw erroFicha; return { ementa: 'urgência do PL 9/2026' }; }, async () => mapa, () => '2026-11-11', () => ({ sigla: 'PL', numero: '9', ano: '2026' }));
    const pl = { sigla: 'PL', numero: '1381', ano: '2026' };
    const req = v => ({ sigla: 'REQ', numero: '4027', ano: '2026', tipoCategoria: 'requerimento', projetoUrgenciado: { ...pl }, vinculo: v });
    // vínculo apurado na véspera pela FICHA (o PDF não trazia o projeto); hoje API e portal fora
    const it = req({ fonte: 'ficha', pdf: null, ficha: { ...pl }, evento: null, divergencia: [] });
    const mudou = await V(it);
    ok(mudou === false && it.projetoUrgenciado && it.projetoUrgenciado.numero === '1381', 'ficha e evento com erro: o projeto vinculado é mantido e nada é marcado para gravar (antes: zerado e salvo)');
    ok(it.vinculo.fichaFalhou === true && it.vinculo.fonte === 'ficha', 'e o card continua sabendo que a ficha não foi reconsultada');
    // vínculo que veio da pauta estruturada da sessão
    const itE = req({ fonte: 'evento', pdf: null, ficha: null, evento: { ...pl }, divergencia: [] });
    ok((await V(itE)) === false && itE.projetoUrgenciado.numero === '1381', 'o mesmo para o vínculo que veio da pauta da sessão nos Dados Abertos');
    // controle: as fontes RESPONDERAM e não trazem mais o projeto → aí sim o vínculo cai
    erroFicha = null; mapa = new Map();
    const V2 = new Function('resolveProposicao', 'vinculosDoEvento', 'dataPautaISO', 'detectarProjetoUrgenciado', `
      ${trecho(/const mesmoAlvo = [^\n]+\n[^\n]+;/)}
      ${fn('decidirVinculo')}
      ${fn('apurarVinculoReq')}
      return apurarVinculoReq;`)(async () => ({ ementa: 'sem projeto' }), async () => new Map(), () => '2026-11-11', () => null);
    const itC = req({ fonte: 'evento', pdf: null, ficha: null, evento: { ...pl }, divergencia: [] });
    ok((await V2(itC)) === true && itC.projetoUrgenciado === null, 'controle: fontes no ar e sem o projeto → o vínculo é retirado, como antes');
    // requerimento homônimo (ambíguo) não é falha de rede: a ficha fica vazia
    const V3 = new Function('resolveProposicao', 'vinculosDoEvento', 'dataPautaISO', 'detectarProjetoUrgenciado', `
      ${trecho(/const mesmoAlvo = [^\n]+\n[^\n]+;/)}
      ${fn('decidirVinculo')}
      ${fn('apurarVinculoReq')}
      return apurarVinculoReq;`)(async () => { throw Object.assign(new Error('15 requerimentos'), { ambiguo: true }); }, async () => new Map(), () => '2026-11-11', () => null);
    const itH = req({ fonte: 'ficha', pdf: null, ficha: { ...pl }, evento: null, divergencia: [] });
    await V3(itH);
    ok(itH.vinculo.ficha === null, 'consulta ambígua (homônimos) não é "fonte fora do ar": não ressuscita a ficha antiga');
    // a pauta estruturada: falha volta marcada, e não fica no cache
    const E = new Function('acharSessoesDeliberativas', 'fetchJson', 'API_BASE', `
      ${trecho(/const _vinculosEvento = [^\n]+/)}
      ${fn('vinculosDoEvento')}
      return { vinculosDoEvento, cache: _vinculosEvento };`)(async () => { throw new Error('HTTP 503'); }, async () => ({ dados: [] }), 'https://api');
    const m = await E.vinculosDoEvento('2026-11-11');
    ok(m instanceof Map && m.falhou === true && !E.cache.has('2026-11-11'), 'vinculosDoEvento: erro devolve o mapa MARCADO como falha e fora do cache');
  }

  console.log('\n== 6. analista e apelido gravados no item da pauta ==');
  {
    let corpo = null;
    const state = { historico: {}, dirty: true };
    const S = new Function('state', 'fetch', 'FIREBASE_URL', 'atualizarStatusSync', 'atualizarSidebarPautas', 'setTimeout', `
      let _dirtySeq = 0;
      ${fn('_fbSalvarPautaExec')}
      return _fbSalvarPautaExec;`)(state, async (_u, init) => { corpo = JSON.parse(init.body); return { ok: true, status: 200 }; }, 'https://fb', () => {}, () => {}, () => {});
    const item = extra => Object.assign({ ordem: 1, tipoCategoria: 'projeto', sigla: 'PL', numero: '1', ano: '2026', ementa: 'e', chave: 'PL-1-2026', enriquecimento: { status: 'ok' }, analise: null }, extra);
    await S({ id: 'p1', titulo: 'T', itens: [
      item({ analista: 'Maria', apelido: 'Marco das eólicas', apelidoManual: true }),
      item({ numero: '2', chave: 'PL-2-2026', apelido: 'apelido de reserva, da ementa' }),
      item({ numero: '3', chave: 'PL-3-2026' })] });
    ok(corpo.itens[0].analista === 'Maria', 'o responsável digitado no card vai no item (antes: sumia ao recarregar, com "Sincronizado" na tela)');
    ok(corpo.itens[0].apelido === 'Marco das eólicas' && corpo.itens[0].apelidoManual === true, 'o apelido DIGITADO vai no item, marcado como digitado');
    ok(corpo.itens[1].apelido === null && corpo.itens[1].apelidoManual === null, 'o apelido de reserva (cache da sessão) NÃO é gravado — senão impediria a IA de gerar o definitivo');
    ok(corpo.itens[2].analista === null && corpo.itens[2].apelido === null, 'sem nada digitado: nulos (o Firebase não guarda)');
    ok(!('enriquecimento' in corpo.itens[0]) && !('analise' in corpo.itens[0]), 'campos transientes continuam fora do que é gravado');
    ok(/it\.apelido = v;\s*it\.apelidoManual = !!v;/.test(src), 'o campo de apelido do card marca o que foi digitado');
  }

  console.log('\n== 7. chave do requerimento s/nº sem projeto ==');
  {
    const pauta = (data, linhas, cab = 'CÂMARA DOS DEPUTADOS') => `${cab}\nEm ${data} (Terça-feira)\n\nURGÊNCIA\n\n${linhas.join('\n')}\n`;
    const semProjeto = ordem => `${ordem}. Requerimento s/nº, de 2026, dos Srs. Líderes, que requer, nos termos do\nartigo 155 do Regimento Interno da Câmara dos Deputados, regime de urgência\npara apreciação de matéria ainda sem número.`;
    const comProjeto = ordem => `${ordem}. Requerimento s/nº, de 2026, dos Srs. Líderes, que requer, nos termos do\nartigo 155 do Regimento Interno da Câmara dos Deputados, regime de urgência\npara apreciação do Projeto de Lei nº 1.893, de 2026, do Sr. Fulano, que dispõe sobre coisa nenhuma.`;
    const k = (r, ordem) => (r.itens.find(i => i.ordem === ordem) || {}).chave;
    const terca = P.parsearPauta(pauta('10 de novembro de 2026', [semProjeto(1), comProjeto(2)]));
    const quarta = P.parsearPauta(pauta('11 de novembro de 2026', [semProjeto(1), comProjeto(2)]));
    ok(k(terca, 1) === 'REQ-sn-ordem1-d10112026-2026' && k(quarta, 1) === 'REQ-sn-ordem1-d11112026-2026', `item 1 sem projeto: chaves diferentes na terça e na quarta (${k(terca, 1)} × ${k(quarta, 1)})`);
    ok(k(P.parsearPauta(pauta('10 de novembro de 2026', [semProjeto(1), comProjeto(2)])), 1) === k(terca, 1), 'a mesma pauta reimportada dá a mesma chave (a nota continua ligada)');
    ok(k(terca, 2) === 'REQ-sn-PL1893-2026-2026' && k(quarta, 2) === k(terca, 2), 'com o projeto lido, a chave continua a do projeto (a mesma análise serve às duas pautas)');
    const segunda = P.parsearPauta(pauta('10 de novembro de 2026', [semProjeto(1)], '2ª SESSÃO DELIBERATIVA\n(EXTRAORDINÁRIA)'));
    ok(k(segunda, 1) === 'REQ-sn-ordem1-d10112026s2-2026', `duas sessões no mesmo dia: o ordinal da sessão entra na chave (${k(segunda, 1)})`);
    ok(/^[A-Za-z0-9-]+$/.test(k(segunda, 1)), 'a chave segue só com letras, dígitos e hífen (seletor de DOM e caminho do Firebase)');
  }

  console.log('\n== 8. REQ com homônimos ==');
  {
    let lista = [], pedidos = [], portal = 0;
    const cacheProp = new Map();
    const Rp = new Function('cacheProp', 'fetchJson', 'API_BASE', 'resolveProposicaoBusca', 'resolveProposicaoPortal', 'console', `
      ${trecho(/const SIGLAS_EQUIVALENTES = [^\n]+/)}
      ${fn('resolveProposicao')}
      return resolveProposicao;`)(cacheProp,
      async url => { pedidos.push(url); return /\/proposicoes\?/.test(url) ? { dados: lista } : { dados: { ementa: 'detalhe', urlInteiroTeor: 'https://c/teor' } }; },
      'https://api', async () => { portal++; return { id: 999, ementa: 'portal', urlInteiroTeor: null }; }, async () => { portal++; return { id: 998 }; }, { info() {}, warn() {} });
    const r = (id, ementa) => ({ id, siglaTipo: 'REQ', numero: 5, ano: 2026, ementa });
    lista = [r(1, 'Requer a realização de Sessão Solene'), r(2, 'Requer regime de urgência para apreciação do Projeto de Lei nº 1.381, de 2026'), r(3, 'Requer audiência pública')];
    const p = await Rp('REQ', '5', '2026');
    ok(p.id === 2, `três requerimentos 5/2026 e um só de urgência: vale ele (id ${p.id}; antes, o primeiro da lista)`);
    ok(/[?&]itens=100\b/.test(pedidos[0]), 'a consulta pede a página inteira (o padrão da API são 15 por página)');
    cacheProp.clear(); portal = 0;
    lista = [r(1, 'Requer a realização de Sessão Solene'), r(3, 'Requer audiência pública')];
    const e = await rejeita(Rp('REQ', '5', '2026'));
    ok(e && e.ambiguo === true && portal === 0, 'nenhum de urgência entre os homônimos: consulta AMBÍGUA, sem escolher e sem cair no portal (que teria a mesma ambiguidade)');
    lista = [r(1, 'Requer urgência para o PL 1/2026'), r(2, 'Requer urgência para o PL 2/2026')];
    ok((await rejeita(Rp('REQ', '5', '2026')))?.ambiguo === true, 'dois de urgência: também ambígua');
    cacheProp.clear();
    lista = [r(7, 'Requer a realização de Sessão Solene')];
    ok((await Rp('REQ', '5', '2026')).id === 7, 'um resultado só: vale ele, como sempre');
    cacheProp.clear();
    lista = [{ id: 10, siglaTipo: 'PL', numero: 1, ano: 2026, ementa: 'a' }, { id: 11, siglaTipo: 'PL', numero: 1, ano: 2026, ementa: 'b' }];
    ok((await Rp('PL', '1', '2026')).id === 10, 'outros tipos não mudam: o primeiro resultado');
    ok(/catch \(e\) \{ return !!e\.ambiguo; \}/.test(src) && /if \(e\.ambiguo\) return null; throw e;/.test(src) && /if \(e\.ambiguo\) ok\.push\(\{ ref, ementa: '' \}\);/.test(src),
      'quem só precisa saber se o requerimento EXISTE (lacunas, inclusão manual, pauta manual) aceita o homônimo');
  }

  console.log('\n== 9. OpenAI: modelos de raciocínio sem temperature ==');
  {
    const corpos = [];
    const IA = new Function('arrayBufferToBase64', 'fetchIA', 'fetchIASse', 'exigirTexto', 'iaFontesGemini', 'iaFontesOpenAI', 'iaFontesAnthropic', 'raciocinioAdaptativo',
      `${trechoDe(srcIA, /async function chamarIA\([\s\S]*?\n}/)}\nreturn chamarIA;`)(
      () => '', async (_u, init) => { corpos.push(JSON.parse(init.body)); return { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'ok' }] }] }; },
      async () => [], t => t, () => {}, () => {}, () => {}, () => false);
    for (const modelo of ['gpt-5', 'o3', 'gpt-5-mini', 'gpt-4o']) await IA({ provedorId: 'openai', apiKey: 'k', modelo, prompt: 'p' });
    ok(corpos[0].temperature === undefined && corpos[1].temperature === undefined && corpos[2].temperature === undefined, 'gpt-5, o3 e gpt-5-mini na chamada comum (nota, apelido, chat): sem temperature (antes: 0.2 → 400)');
    ok(corpos[0].reasoning === undefined && corpos[0].max_output_tokens === 12000, 'e sem esforço de raciocínio nem teto dobrado: isso continua só no raciocínio alto');
    ok(corpos[3].temperature === 0.2, 'gpt-4o continua com temperature 0.2');
  }

  console.log('\n== 10. a varredura de órfãs lê só as chaves ==');
  {
    const pedidos = [];
    const banco = { '/pautas.json': { p1: { itens: [{ chave: 'A' }, { chave: 'B' }] } }, '/analises_pauta.json?shallow=true': { A: true, B: true, C: true } };
    const Vo = new Function('fetch', 'FIREBASE_URL', 'document', 'console', `${fn('varrerAnalisesOrfas')}\nreturn varrerAnalisesOrfas;`)(
      async (url, init) => { pedidos.push((init?.method || 'GET') + ' ' + url); const k = url.replace('https://fb', ''); return { ok: true, json: async () => banco[k] ?? null }; },
      'https://fb', { getElementById: () => null }, { log() {}, warn() {} });
    const r = await Vo(false);
    ok(pedidos.includes('GET https://fb/analises_pauta.json?shallow=true') && !pedidos.some(p => /shallow=false/.test(p)), 'pede /analises_pauta.json?shallow=true (antes: o conteúdo de todas as notas a cada abertura da página)');
    ok(r.removidas === 1 && pedidos.filter(p => p.startsWith('DELETE')).join() === 'DELETE https://fb/analises_pauta/C.json', 'e a varredura funciona igual com { chave: true }: apaga só a órfã');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
