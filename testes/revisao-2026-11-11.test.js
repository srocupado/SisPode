// Revisão de 11/11/2026 — os nove defeitos achados na revisão das mudanças feitas
// durante a instabilidade da API da Câmara (4.1.8.12 → 4.1.8.24). Cada bloco
// reproduz o defeito e trava a correção.
//   1. Líderes: reunião reaberta era reconsultada item a item (o Firebase não guarda
//      lista vazia) e as edições de situação/relatoria/apensação eram sobrescritas.
//   2. Bot: a primeira queda da API ficava guardada e o bot seguia pelo portal para sempre.
//   3. Bot: "/comissao CCJC" com a API fora respondia "sem reunião dessa comissão".
//   4. Bot: convocação repetida a cada 5 min quando a gravação no Firebase falhava.
//   5. Bot: "/ata fim" passava na frente do áudio ainda em transcrição.
//   6. Bot: dois pedidos ao worker passavam pela trava.
//   7. Resumo: votação incidental sobre um REC virava "recurso rejeitado"; recurso de
//      outro tipo ganhava a consequência do conclusivo.
//   8. Bot: a urgência da convocação lia menos redações que a Ordem do Dia.
//   9. Bot: agenda do Plenário com mais de uma página — só a 1ª era lida.
// Uso: node testes/revisao-2026-11-11.test.js
const fs = require('fs'), path = require('path'), os = require('os');
const RAIZ = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const esperar = ms => new Promise(r => setTimeout(r, ms));
const copia = (arquivo, nome, trocas = []) => {
  let src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', arquivo), 'utf8');
  for (const [de, para] of trocas) { if (!de.test(src)) throw new Error(`padrão não encontrado em ${arquivo}: ${de}`); src = src.replace(de, para); }
  src = src.replace(/require\('\.\/([^']+)'\)/g, (_, m) => `require(${JSON.stringify(path.join(RAIZ, 'bot', 'src', m))})`);
  const destino = path.join(os.tmpdir(), nome);
  fs.writeFileSync(destino, src);
  delete require.cache[destino];
  return require(destino);
};

(async () => {
  // ============ 1. Líderes: cura por versão ============
  console.log('== 1. Líderes: reabrir a reunião não reconsulta nem sobrescreve ==');
  {
    const fonte = fs.readFileSync(path.join(RAIZ, 'lideres.js'), 'utf8');
    const pedidos = { camara: 0, firebasePut: 0 };
    const el = () => ({ style: {}, disabled: false, textContent: '', innerHTML: '', value: '', addEventListener() {}, querySelectorAll: () => [], classList: { toggle() {}, add() {}, remove() {} } });
    const sb = {
      document: { addEventListener() {}, getElementById: () => el(), querySelectorAll: () => [], querySelector: () => null },
      chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
      pdfjsLib: { GlobalWorkerOptions: {} }, window: {}, console, setTimeout, clearTimeout, DOMException: globalThis.DOMException, XLSX: undefined, AbortSignal,
      btoa: s => s,
      fetch: async (url, init = {}) => {
        url = String(url);
        if (/firebaseio/.test(url)) { if (init.method === 'PUT') pedidos.firebasePut++; return { ok: true, status: 200, json: async () => null }; }
        if (/ObterDeputados/.test(url)) return { ok: true, status: 200, text: async () => '<deputados><deputado><nomeParlamentar>Nely Aquino</nomeParlamentar><partido>PODE</partido></deputado></deputados>' };
        if (/siglaPartido=PODE/.test(url)) return { ok: false, status: 504 };
        pedidos.camara++;
        return { ok: false, status: 504, json: async () => ({}), text: async () => '' };
      },
    };
    const L = new Function(...Object.keys(sb), `${fonte}\n; mostrarToast = () => {}; renderizarTabela = () => {}; atualizarSidebar = () => {}; atualizarProgresso = () => {};
      return { app, camposNovosFaltando, completarDadosFaltantes, FATOS_V };`)(...Object.values(sb));
    // o que o Firebase devolve: listas vazias e nulls NÃO voltam
    const doFirebase = o => JSON.parse(JSON.stringify(o, (k, v) => (v === null || (Array.isArray(v) && !v.length) ? undefined : v)));
    const curado = doFirebase({ chave: 'PL 1/2026', sigla: 'PL', autoriaPodemos: false, autoresPodemos: [], apensadosPodemos: [], papel: { apensada: false, temApensados: false },
      relatorDesignado: '', comissaoMistaPodemos: [], solicitacaoPodemos: [], extrasPdf: { relator: 'PEDIDO: X solicitou relatoria', solicitacoes: 'PT' }, situacao: 'editada à mão', fatosV: L.FATOS_V });
    ok(curado.apensadosPodemos === undefined && curado.comissaoMistaPodemos === undefined, 'no Firebase as listas vazias somem (o que disparava a cura a cada abertura)');
    ok(L.camposNovosFaltando(curado) === false, 'item com a marca de versão NÃO é curado de novo');

    const legado = doFirebase({ chave: 'PL 2/2026', sigla: 'PL', idCamara: 7, autoriaPodemos: false, papel: { apensada: false, temApensados: false },
      situacao: 'Urgência aprovada — texto editado pelo analista', relatoria: 'Dep. Fulano (PT-SP)', apensacao: 'editada', parecer: 'editado',
      extrasPdf: { relator: 'PEDIDO: PCdoB indicou Beltrana', solicitacoes: 'PODEMOS; PT' } });
    const mpv = doFirebase({ chave: 'MPV 9/2026', sigla: 'MPV', idCamara: 8, autoriaPodemos: false, papel: { apensada: false },
      situacao: 'Não apurada — a API de Dados Abertos da Câmara está fora do ar; refaça a busca quando ela voltar, antes de usar.', relatoria: '',
      extrasPdf: { relator: 'Presidente: Dep. Nely Aquino Relator: Sen. Fulano' } });
    const mpvEditada = doFirebase({ chave: 'MPV 8/2026', sigla: 'MPV', idCamara: 9, autoriaPodemos: false, papel: { apensada: false }, situacao: 'Texto do analista', relatoria: '' });
    L.app.reuniao = { id: 't', titulo: 'T', itens: [curado, legado, mpv, mpvEditada] };
    await L.completarDadosFaltantes();
    ok(pedidos.camara === 0, `itens que já têm os fatos de base: nenhuma consulta à proposição na Câmara (${pedidos.camara})`);
    ok(legado.situacao === 'Urgência aprovada — texto editado pelo analista' && legado.apensacao === 'editada' && legado.parecer === 'editado', 'o que o analista editou fica como está');
    ok(legado.relatoria === 'Designado: Dep. Fulano (PT-SP)\nPedido de relatoria: PCdoB indicou Beltrana' && legado.solicitacaoPodemos.length === 1, 'campos derivados da lista são completados (relatoria designado × pedido, pedido de pauta do Podemos)');
    ok(mpv.situacao === 'Urgência constitucional (art. 62 da CF) — medida provisória' && mpv.comissaoMistaPodemos.length === 1, 'MPV "Não apurada" corrigida; presidência do Podemos na comissão mista marcada');
    ok(mpvEditada.situacao === 'Texto do analista', 'MPV com a situação editada não é sobrescrita');
    ok([legado, mpv, mpvEditada].every(i => i.fatosV === L.FATOS_V) && pedidos.firebasePut === 1, 'a marca é gravada e a reunião salva — a próxima abertura não cura de novo');
    const depois = doFirebase(legado);
    ok(L.camposNovosFaltando(depois) === false, 'depois de ir e voltar do Firebase, continua curado');
  }

  // ============ 2 e 3. comissões ============
  console.log('\n== 2. Bot: a queda da API não fica guardada ==');
  {
    const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
    Object.assign(P.RITMO, { intervaloMs: 1, esperasMs: [] });
    P.limparCache();
    let apiFora = true, pedidosApi = 0;
    const orgaos = JSON.parse(fs.readFileSync(path.join(FX, 'comissoes', 'orgaos-permanentes.json'), 'utf8'));
    const agenda = fs.readFileSync(path.join(FX, 'comissoes', 'agenda-2026-11-10.html'), 'utf8');
    global.fetch = async url => {
      url = String(url);
      if (url.startsWith('https://dadosabertos.camara.leg.br')) {
        pedidosApi++;
        if (apiFora) return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => (/\/orgaos/.test(url) ? orgaos : { dados: [] }) };
      }
      if (/\/agenda\?/.test(url)) return { ok: true, status: 200, text: async () => agenda };
      if (/evento-legislativo\/\d+$/.test(url)) return { ok: true, status: 200, text: async () => '<html><body>sem itens</body></html>' };
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
    };
    const C = copia('comissoes.js', 'sispode-rev-comissoes.js', [[/function sleep\(ms\) \{[^}]*\}/, 'function sleep() { return Promise.resolve(); }']]);
    let e1 = null; try { await C.ensureComissoes(); } catch (e) { e1 = e.message; }
    ok(/instável/.test(e1 || ''), 'com a API fora, a consulta falha');
    apiFora = false;
    const antes = pedidosApi;
    let cat = null, e2 = null; try { cat = await C.ensureComissoes(); } catch (e) { e2 = e.message; }
    ok(!e2 && cat && cat.length === 30 && pedidosApi > antes, `API de volta: a consulta é refeita e funciona (${cat ? cat.length : 0} comissões)${e2 ? ' — ' + e2 : ''}`);

    console.log('\n== 3. Bot: /comissao pela SIGLA com a API fora ==');
    apiFora = true;
    const C2 = copia('comissoes.js', 'sispode-rev-comissoes2.js', [[/function sleep\(ms\) \{[^}]*\}/, 'function sleep() { return Promise.resolve(); }']]);
    const r = await C2.consultarPauta('CCJC', '10/11/2026', {});
    ok(/🏛️ Comissão de Constituição e Justiça e de Cidadania \(CCJC\)/.test(r) && !/sem reunião dessa comissão/.test(r), 'bot recém-iniciado, API fora: "CCJC" acha a comissão (tabela de siglas)');
    const r2 = await C2.consultarPauta('ccj', '10/11/2026', {});
    ok(/Comissão de Constituição e Justiça e de Cidadania/.test(r2), 'a abreviação "ccj" também');
    ok(C2.siglaDaComissao('Comissão de Saúde') === 'CSAUDE' && C2.siglaDaComissao('Comissão Inexistente') === '', 'sigla pela tabela; comissão desconhecida fica sem sigla');
  }

  // ============ 4. convocação ============
  console.log('\n== 4. Bot: convocação não repete quando a gravação no Firebase falha ==');
  {
    const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
    P.limparCache();
    const agenda = fs.readFileSync(path.join(FX, 'plenario', 'agenda-2026-11-10a20.html'), 'utf8');
    const sessao = fs.readFileSync(path.join(FX, 'plenario', 'evento-83243-sem-pauta.html'), 'utf8');
    global.fetch = async url => {
      url = String(url);
      if (/firebaseio/.test(url)) return { ok: true, status: 200, json: async () => null };
      if (url.startsWith('https://dadosabertos.camara.leg.br')) return { ok: false, status: 503, json: async () => ({}) };
      if (/\/agenda\?/.test(url)) return { ok: true, status: 200, text: async () => agenda };
      if (/evento-legislativo\/83243$/.test(url)) return { ok: true, status: 200, text: async () => sessao };
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    };
    const V = copia('convocacao.js', 'sispode-rev-convocacao.js');
    const env = [];
    const cfg = { api: { sendMessage: async (c, t) => { env.push(t); return {}; } }, destino: () => 'G', perfilIA: () => null, agora: () => '2026-11-10T09:00',
      fbGet: async () => ({}), fbPatch: async () => { throw new Error('Firebase PATCH 401'); } };
    await V.tickConvocacoes(cfg);
    const n1 = env.length;
    await V.tickConvocacoes(cfg); await V.tickConvocacoes(cfg);
    ok(n1 === 2 && env.length === 2, `gravação recusada: a convocação (e o aviso do Infoleg) saem uma vez só (${env.length} mensagens em 3 ciclos)`);
  }

  // ============ 5 e 6. index.js ============
  console.log('\n== 5. Bot: /ata respeita a ordem da conversa ==');
  const idx = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
  {
    const fonte = /const _filaConversa = new Map\(\);[^\n]*\n(function rodarSemTravar[\s\S]*?\n\})/.exec(idx);
    const rodarSemTravar = new Function('_filaConversa', `${fonte[1]}; return rodarSemTravar;`)(new Map());
    const log = [];
    const upd = (texto, ms) => rodarSemTravar({ chat: { id: 1 }, message: { text: texto } }, async () => { await esperar(ms); log.push(texto); });
    upd('áudio em transcrição', 80); upd('/ata fim', 5); upd('/quorum', 5); upd('/atalho', 5);
    await esperar(40);
    ok(log.includes('/quorum') && log.includes('/atalho') && !log.includes('/ata fim'), `/quorum responde na hora; "/ata fim" espera a anotação anterior (${log.join(' · ')})`);
    await esperar(120);
    ok(log.indexOf('áudio em transcrição') < log.indexOf('/ata fim'), 'a ata fecha DEPOIS da anotação');
  }
  console.log('\n== 6. Bot: a trava do worker fecha antes de qualquer espera ==');
  {
    const trecho = nome => { const i = idx.indexOf(nome); return idx.slice(i, idx.indexOf('\n}', i)); };
    const travaAntesDoAwait = t => { const c = t.indexOf('if (_workerOcupado)'), s = t.indexOf('_workerOcupado = true', c), a = t.indexOf('await ', c); return c >= 0 && s > c && s < a; };
    ok(travaAntesDoAwait(trecho('async function cmdExportar')), '/exportar');
    ok(travaAntesDoAwait(trecho('async function cmdResumo')), '/resumo');
    const ana = idx.slice(idx.indexOf("bot.callbackQuery(/^ana:(ok|no)"));
    const c = ana.indexOf("if (_workerOcupado)"), resto = ana.slice(c + 20);
    ok(resto.indexOf('_workerOcupado = true') < resto.indexOf('await '), 'geração de análises (botão)');
    ok(/if \(!pauta\) return await ctx\.reply\('Nenhuma pauta importada/.test(trecho('async function cmdExportar')) && /finally \{\s*_workerOcupado = false;/.test(trecho('async function cmdExportar')), '/exportar sem pauta solta a trava');
  }

  // ============ 7. recurso pela API ============
  console.log('\n== 7. Resumo: só a votação DO recurso conta; outro tipo de recurso não ganha consequência ==');
  {
    const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
    const ia = fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8');
    const fn = (t, n) => t.match(new RegExp(`(?:async )?function ${n}\\([\\s\\S]*?\\n}`))[0];
    const cn = n => src.match(new RegExp(`const ${n} = [^\\n]*`))[0];
    const votacoes = [
      { id: '1-1', aprovacao: 0, proposicaoObjeto: 'REC 20/2024', descricao: 'Rejeitado o Requerimento de Retirada de Pauta.', dataHoraRegistro: '2026-11-10T15:00', uriProposicaoObjeto: 'x/100' },
      { id: '1-2', aprovacao: null, proposicaoObjeto: 'REC 7/2025', descricao: 'Rejeitado o Recurso nº 7/2025.', dataHoraRegistro: '2026-11-10T15:10', uriProposicaoObjeto: 'x/101' },
      { id: '1-3', aprovacao: 0, proposicaoObjeto: 'REC 9/2026', descricao: 'Rejeitado o Recurso nº 9/2026 (art. 95, § 8º, RICD).', dataHoraRegistro: '2026-11-10T15:20', uriProposicaoObjeto: 'x/102' },
    ];
    const fetchJsonCamara = async url => {
      if (/\/eventos\/\d+\/votacoes/.test(url)) return { dados: votacoes };
      if (/\/proposicoes\/102$/.test(url)) return { dados: { ementa: 'Recurso contra decisão da Presidência em questão de ordem.' } };
      return { dados: [] };
    };
    const ctx = new Function('fetchJsonCamara', `
      const API_BASE = 'https://api';
      // (a extração de _idDeUri, de uma linha só, traz junto a acharSessoesDeliberativas real — que usa fetchJson)
      const fetchJson = async () => ({ dados: [{ id: 1, descricaoTipo: 'Sessão Deliberativa', orgaos: [{ sigla: 'PLEN' }] }] });
      ${fn(ia, 'encurtarProposicoes')} ${fn(src, 'siglaComissao')} ${fn(src, 'destinoDeConclusao')} ${fn(src, 'extrairRefProposicao')}
      ${cn('_ascVot')} ${fn(src, '_mapLimit')} ${fn(src, '_idDeUri')} ${fn(src, 'propsDaVotacao')}
      ${cn('tipoRecurso')} ${cn('destinoDoRecurso')} ${fn(src, 'fraseResultadoRecurso')} ${fn(src, 'ementaTextoResumo')} ${fn(src, 'coletarResumoSessaoApi')}
      const tipoLabel = s => s, dataPautaCurta = () => '', apelidoDaPautaPorRef = () => '', apelidoDeAnalisePorRef = async () => '';
      ${fn(src, 'montarMensagemResumo')}
      return { coletarResumoSessaoApi, montarMensagemResumo, tipoRecurso, fraseResultadoRecurso };`)(fetchJsonCamara);
    const r = await ctx.coletarResumoSessaoApi('2026-11-10');
    ok(r.recursos.length === 1 && r.recursos[0].numero === '9', `requerimento de retirada de pauta sobre o REC e votação sem resultado ficam de fora (${r.recursos.map(x => x.numero + '/' + x.ano).join(', ')})`);
    ok(r.recursos[0].tipo === 'outro' && ctx.fraseResultadoRecurso(false, 'outro') === '', 'recurso contra decisão da Presidência: tipo "outro", sem frase de consequência');
    const msg = await ctx.montarMensagemResumo([], [], '2026-11-10', r.recursos);
    ok(/▪️ \*Recurso 9\/2026 rejeitado\*$/m.test(msg) && !/➡️/.test(msg), `a linha sai só com o resultado: ${msg.split('\n').pop()}`);
    ok(ctx.tipoRecurso('') === 'outro' && ctx.tipoRecurso('Recurso contra tramitação conclusiva do PL 1/2024') === 'conclusivo' && ctx.tipoRecurso('contra parecer terminativo') === 'terminativo', 'ementa não lida não vira "conclusivo"');
  }

  // ============ 8 e 9. portal ============
  console.log('\n== 8. Bot: o projeto alvo da urgência, num leitor só ==');
  {
    const P = require(path.join(RAIZ, 'bot', 'src', 'comissoes-portal.js'));
    const V = require(path.join(os.tmpdir(), 'sispode-rev-convocacao.js'));
    const O = copia('odd.js', 'sispode-rev-odd.js');
    const casos = [
      ['Requer urgência para o PL nº 5072 de 2026', 'PL 5072/2026'],
      ['Requer regime de urgência para o Projeto de Decreto Legislativo nº 123, de 2026.', 'PDL 123/2026'],
      ['Requer urgência para a Proposta de Emenda à Constituição nº 3/2024', 'PEC 3/2024'],
      ['Requer urgência para o Projeto de Lei Complementar nº 131, de 2026', 'PLP 131/2026'],
      ['Requer a urgência para a apreciação do Projeto de Lei nº 2.167, de 2026', 'PL 2167/2026'],
    ];
    const txt = a => (a ? `${a.sigla} ${a.numero}/${a.ano}` : 'null');
    ok(casos.every(([e, esperado]) => txt(V.alvoDaUrgencia('REQ', e)) === esperado), `convocação lê todas as redações (${casos.map(([e]) => txt(V.alvoDaUrgencia('REQ', e))).join(', ')})`);
    ok(casos.every(([e, esperado]) => txt(O.alvoDaEmenta(e)) === esperado) && casos.every(([e]) => txt(P.proposicaoCitada(e)) === txt(O.alvoDaEmenta(e))), 'a Ordem do Dia usa o mesmo leitor');
    ok(V.alvoDaUrgencia('REQ', 'Requer a retirada de pauta do PL 1/2026') === null && V.alvoDaUrgencia('PL', 'urgência PL 1/2026') === null, 'requerimento que não é de urgência não vira urgência');

    console.log('\n== 9. Bot: agenda com mais de uma página ==');
    const li = (id, data, nome) => `<li class="g-agenda__evento"><span class="g-agenda__data">${data}</span><span class="g-agenda__hora">13h55</span><span class="g-agenda__categoria">Plenário</span>`
      + `<a href="https://www.camara.leg.br/evento-legislativo/${id}" class="g-agenda__nome">${nome}</a><span class="g-agenda__tipo">Sessão para a votação de propostas legislativas</span><span class="g-agenda__situacao">convocada</span></li>`;
    const pag1 = `<ul>${li(90001, '17/11/2026', 'Homenagem ao Dia X')}</ul><ul><li class="pagination-list__nav pagination-list__nav--next"> <a href="/agenda?pagina=2&amp;categorias=Plen%C3%A1rio">próxima</a></li></ul>`;
    const pag2 = `<ul>${li(90002, '18/11/2026', 'Sessão Deliberativa Extraordinária Semipresencial (AM nº 123/2020)')}</ul><ul><li class="pagination-list__nav pagination-list__nav--next disabled"> <a href="#">próxima</a></li></ul>`;
    const urls = [];
    global.fetch = async url => {
      url = String(url); urls.push(url);
      if (url.startsWith('https://dadosabertos.camara.leg.br')) return { ok: false, status: 503, json: async () => ({}) };
      if (/pagina=2/.test(url)) return { ok: true, status: 200, text: async () => pag2 };
      if (/\/agenda\?/.test(url)) return { ok: true, status: 200, text: async () => pag1 };
      return { ok: true, status: 200, text: async () => '<html></html>' };
    };
    P.limparCache();
    const evs = await P.agendaPortal({ de: '2026-11-17', ate: '2026-11-24', categoria: 'Plenário' }, { fresco: true });
    ok(evs.length === 2 && evs[1].id === 90002 && urls.some(u => u === 'https://www.camara.leg.br/agenda?pagina=2&categorias=Plen%C3%A1rio'), `as duas páginas são lidas, com o link relativo resolvido (${evs.map(e => e.id).join(', ')})`);
    const env = [];
    await V.tickConvocacoes({ api: { sendMessage: async (c, t) => { env.push(t); return {}; } }, destino: () => 'G', perfilIA: () => null, agora: () => '2026-11-17T09:00', fbGet: async () => ({}), fbPatch: async () => ({}) });
    ok(/CONVOCAÇÃO DE SESSÃO EXTRAORDINÁRIA – QUARTA-FEIRA \(18\/11\)/.test(env[0] || ''), 'a sessão que estava na 2ª página é anunciada');
    const sess = await O.eventosDeliberativos('2026-11-18');
    ok(sess.some(e => e.id === 90002), 'e a Ordem do Dia também a encontra');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
