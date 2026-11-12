// Módulo de Congresso Nacional (congresso.html): pauta de Sessão Conjunta.
//
// O que este teste trava:
//   1. itens pelo CABEÇALHO da sessão ("Destinada à deliberação dos Vetos nºs … e dos Projetos de Lei do
//      Congresso Nacional nºs …") — a convocação prévia sai às vezes só com ele (pauta 596834, 11/11/2026).
//      Os três cabeçalhos abaixo são reais; o conjunto lido de cada um foi conferido (12/11/2026) contra as
//      matérias listadas uma a uma na própria página: 26, 64 e 5 itens, idênticos;
//   2. importar pelo link uma pauta que só tem o cabeçalho: os PLNs vêm com a página da matéria (código nos
//      Dados Abertos do Senado), e reimportar a mesma pauta não apaga as análises já feitas;
//   3. a lista de sessões mostra a MAIS NOVA no topo (a data vem "dd/mm/aaaa"; o texto puro ordenava pelo dia);
//   4. "Resumir todos" numa pauta de sessão inclui os PLNs/MPVs (antes: "todos os vetos já estão resumidos");
//   5. a caixa "Selecionar todos os PLNs" marca e desmarca os PLNs da pauta;
//   6. o botão Apelidos copia para o WhatsApp "▪️ *o que será votado* (apelido)", no formato do Plenário, com o
//      apelido oficial (assunto do veto, apelido do PLN no site do Congresso) — sem IA.
// Uso: node testes/congresso-pauta.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Cabeçalhos reais (texto da página, 12/11/2026)
const CAB_596834 = 'Destinada à deliberação dos Projetos de Lei do Congresso Nacional nºs 1, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 23, 25, 26, 27, 28, 29, 30, 33 e 35 de 2026; e à eleição de membro do Conselho de Comunicação Social.';
const CAB_574056 = 'Destinada à deliberação do Veto nº 9 de 2023; do Veto nº 14 de 2023 (dispositivos 1 a 3, 5 a 53, 61 a 64, 66, 67, 109 a 114, 116, 119 a 315, 317, 319 a 390 e 393 a 397); do Veto nº 46 de 2023 (dispositivos 1 a 3 e 6); dos Vetos nºs 10 e 12 de 2024; dos Vetos nºs 17, 18 e 22 a 25 de 2024; do Veto n° 26 de 2024 (dispositivos 1 a 7); dos Vetos nºs 29, 39, 48 e 50 de 2024; dos Vetos nºs 1, 12 a 16, 18, 19, 21, 23 a 26, 28, 30, 32, 33, 35 a 39, 43 e 44 de 2025; do Veto nº 46 de 2025 (dispositivos 1 a 3, 16 a 22 e 25 a 27); dos Vetos nºs 47, 49 e 50 de 2025; do Veto nº 51 de 2025 (dispositivos 1 a 3, 6 a 15, 17 a 22, 24, 26 a 44); dos Vetos nºs 1, 2, 4, 6, 7, 9, 10, 14 a 16, 18; do Veto nº 19 de 2026 (dispositivos 3, 7, 8, e 34 a 38); dos Vetos nºs 22 e 29 de 2026; dos Projetos de Lei do Congresso Nacional nºs 1, 3, 6, 7 e 13 de 2026; e eleição de membro do Conselho de Comunicação Social.';
const CAB_538947 = 'Destinada à deliberação dos Vetos nºs 5 e 29 de 2025 e 31 de 2024; dos Projetos de Lei do Congresso Nacional n°s 14 e 31 de 2025; e à eleição do Conselho de Comunicação Social.';

// A página da convocação prévia: cabeçalho, sem as matérias uma a uma (como estava a 596834 em 11/11/2026)
const paginaSoCabecalho = `<!doctype html><html><body>
  <h1>Sessão Conjunta</h1> <span>Convocada</span>
  <div>Plenário da Câmara dos Deputados</div>
  <div> 12/11/2026 09h00 Semipresencial </div>
  <p>${CAB_596834.replace('nºs 1, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 23, 25, 26, 27, 28, 29, 30, 33 e 35', 'nºs 1, 3 e 4')}</p>
  <div>Sessões do Congresso Nacional</div></body></html>`;

// ---- o módulo inteiro, num sandbox com a página congresso.html (o boot DOMContentLoaded não dispara)
const html = fs.readFileSync(path.join(RAIZ, 'congresso.html'), 'utf8');
const { document, window } = parseHTML(html);
const rede = { firebase: {}, senado: {}, paginas: {}, pedidos: [] };
const resp = (corpo, status = 200, texto = null) => ({ ok: status < 400, status, json: async () => corpo, text: async () => (texto != null ? texto : JSON.stringify(corpo)), arrayBuffer: async () => new ArrayBuffer(0) });
const ctx = {
  document, window, DOMParser, URL, console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout, clearTimeout, AbortController,
  TextDecoder, TextEncoder, Blob, Event: window.Event,
  chrome: { runtime: { getURL: p => p }, storage: { local: { get: (_k, cb) => cb && cb({}), set: () => {} } } },
  pdfjsLib: { GlobalWorkerOptions: {} }, localStorage: { getItem: () => null, setItem: () => {} }, confirm: () => true, alert: () => {},
  fetch: async (url, init = {}) => {
    url = String(url); rede.pedidos.push((init.method || 'GET') + ' ' + url);
    if (/firebaseio\.com/.test(url)) {
      const k = url.replace(/^https:\/\/[^/]+\//, '').replace(/\.json.*$/, '');
      if ((init.method || 'GET') === 'GET') return resp(rede.firebase[k] === undefined ? null : rede.firebase[k]);
      return resp(null);
    }
    if (/legis\.senado\.leg\.br\/dadosabertos\/materia\/pesquisa\/lista/.test(url)) {
      const q = new URL(url).searchParams;
      const cod = rede.senado[`${q.get('sigla')}-${+q.get('numero')}-${q.get('ano')}`];
      return resp(cod ? { PesquisaBasicaMateria: { Materias: { Materia: [{ Codigo: cod, Sigla: q.get('sigla'), Numero: String(q.get('numero')).padStart(5, '0'), Ano: q.get('ano') }] } } } : { PesquisaBasicaMateria: {} });
    }
    if (rede.paginas[url] != null) return resp(null, 200, rede.paginas[url]);
    return resp({}, 404);
  },
};
ctx.globalThis = ctx; ctx.window = window;
vm.createContext(ctx);
new vm.Script(fs.readFileSync(path.join(RAIZ, 'congresso.js'), 'utf8')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
const toasts = [];
av('mostrarToast = (m, t) => __toasts.push({ m, t })'); ctx.__toasts = toasts;
av('baixarArrayBuffer = async () => { throw new Error("sem a lista oficial no teste"); }');
av('carregarDetalhe = async () => {}');
av('abrirPauta = async () => {}');
av('sleep = async () => {}');

(async () => {
  console.log('== 1. itens pelo cabeçalho da sessão ==');
  {
    const lista = r => [...r.vetos.map(v => `VET ${v.num}/${v.ano}`), ...r.plns.map(p => `${p.sigla} ${p.num}/${p.ano}`)];
    const a = av(`itensDoCabecalho(${JSON.stringify(CAB_596834)}, 2026)`);
    ok(a.plns.length === 26 && !a.vetos.length && lista(a).join() === [1, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 23, 25, 26, 27, 28, 29, 30, 33, 35].map(n => `PLN ${n}/2026`).join(),
      'pauta 596834: os 26 PLNs, na ordem, e nenhum veto (a eleição do Conselho fica de fora)');
    const b = av(`itensDoCabecalho(${JSON.stringify(CAB_574056)}, 2026)`), lb = lista(b);
    ok(b.vetos.length === 59 && b.plns.length === 5, `pauta 574056: 59 vetos + 5 PLNs (${b.vetos.length} + ${b.plns.length}) — o mesmo que a página lista uma a uma`);
    ok(['VET 9/2023', 'VET 14/2023', 'VET 46/2023', 'VET 22/2024', 'VET 25/2024', 'VET 35/2025', 'VET 39/2025', 'VET 51/2025', 'VET 19/2026', 'VET 29/2026', 'PLN 13/2026'].every(x => lb.includes(x)),
      'faixas ("22 a 25", "35 a 39") e um item por veto');
    ok(!lb.includes('VET 397/2023') && !lb.includes('VET 315/2023') && !lb.includes('VET 3/2023'), 'os dispositivos entre parênteses não viram vetos');
    ok(['VET 1/2026', 'VET 2/2026', 'VET 14/2026', 'VET 16/2026', 'VET 18/2026'].every(x => lb.includes(x)) && !b.deduzidos.length,
      'o trecho sem ano ("dos Vetos nºs 1, 2, 4 … 18;") fica com o ano do trecho seguinte do mesmo tipo (2026)');
    const c = av(`itensDoCabecalho(${JSON.stringify(CAB_538947)}, 2025)`), lc = lista(c);
    ok(lc.join() === 'VET 5/2025,VET 29/2025,VET 31/2024,PLN 14/2025,PLN 31/2025', `pauta 538947: anos diferentes no mesmo trecho ("5 e 29 de 2025 e 31 de 2024") e "n°s" com grau (${lc.join(', ')})`);
    const d = av(`itensDoCabecalho('Destinada à deliberação dos Vetos nºs 3 e 4; e eleição.', 2026)`);
    ok(lista(d).join() === 'VET 3/2026,VET 4/2026' && d.deduzidos.join() === 'VET 3/2026,VET 4/2026', 'sem ano em lugar nenhum: o da sessão, listado como deduzido (para o aviso)');
    ok(lista(av(`itensDoCabecalho('Sessão solene em homenagem a…', 2026)`)).length === 0, 'sem a frase "Destinada à deliberação": nada');
  }

  console.log('\n== 2. importar pelo link a convocação prévia (só o cabeçalho) ==');
  {
    const URL_PAUTA = 'https://www.congressonacional.leg.br/sessoes/agenda-do-congresso-nacional/-/pauta/596834';
    rede.paginas[URL_PAUTA] = paginaSoCabecalho;
    rede.senado = { 'PLN-1-2026': '173378', 'PLN-3-2026': '173739' };   // PLN 4: o Senado não acha
    const materia = (ementa, apelido) => `<html><head><meta name="sf_ementa" content="${ementa}"><meta name="sf_autor" content="Presidência da República"><meta name="sf_apelido" content="${apelido}"></head><body><a href="https://legis.senado.leg.br/sdleg-getter/documento?dm=1">Parecer CMO (11/11/2026)</a></body></html>`;
    rede.paginas['https://www.congressonacional.leg.br/materias/pesquisa/-/materia/173378'] = materia('Altera o Anexo V à Lei nº 15.346.', 'Receita Federal');
    rede.paginas['https://www.congressonacional.leg.br/materias/pesquisa/-/materia/173739'] = materia('Abre crédito ao MCTI.', 'MCTI');
    let salvo = null;
    av('fbSalvarPauta = async p => { __salvo = p; }'); ctx.__salvo = null;
    av('carregarSessoes = async () => {}');
    await av(`importarPauta(${JSON.stringify(URL_PAUTA + '#pauta')})`);
    salvo = ctx.__salvo;
    ok(salvo && salvo.id === 'p_596834' && salvo.data === '12/11/2026', `o link com "#pauta" no fim serve (pauta ${salvo && salvo.id}, sessão de ${salvo && salvo.data})`);
    ok(salvo && salvo.plns.map(p => p.key).join() === 'pln-1-2026,pln-3-2026,pln-4-2026', 'os 3 PLNs do cabeçalho entram na pauta (antes: "Nenhum veto/PLN encontrado")');
    const p1 = salvo.plns[0];
    ok(p1.materiaUrl.endsWith('/materia/173378') && p1.ementa === 'Altera o Anexo V à Lei nº 15.346.' && /sdleg-getter/.test(p1.parecerUrl), 'cada PLN vem com a página da matéria (pelo código no Senado): ementa e parecer');
    const t = toasts[toasts.length - 1];
    ok(/3 lido\(s\) do cabeçalho da sessão/.test(t.m) && /sem a página da matéria: PLN 4\/2026/.test(t.m) && t.t === 'aviso', 'o aviso diz que os itens vieram do cabeçalho e qual PLN ficou sem a página da matéria');
    // reimportar a mesma pauta: a análise feita fica
    rede.firebase['congresso_pautas/p_596834'] = { criadoEm: '2026-11-11T20:36:37.510Z', plns: { 'pln-1-2026': { key: 'pln-1-2026', analise: 'Análise já feita pela equipe.', analiseMeta: { provedor: 'gemini' }, interessados: [{ id: '1', nome: 'Fulano' }] } } };
    await av(`importarPauta(${JSON.stringify(URL_PAUTA)})`);
    const s2 = ctx.__salvo, q1 = s2.plns.find(p => p.key === 'pln-1-2026');
    ok(q1.analise === 'Análise já feita pela equipe.' && q1.interessados.length === 1 && s2.criadoEm === '2026-11-11T20:36:37.510Z', 'reimportar a mesma pauta não apaga a análise nem os interessados (e mantém a data de importação)');
    // a página completa (com as matérias uma a uma) continua sendo lida como antes, e o cabeçalho não duplica
    const completa = paginaSoCabecalho.replace('</body>', `<div class="accordion-group"><div class="titulo-materia">PROJETO DE LEI DO CONGRESSO NACIONAL Nº 1, DE 2026</div><div class="accordion-conteudo">Receita Federal. Discussão, em turno único, do PLN 1.<a href="https://www.congressonacional.leg.br/materias/pesquisa/-/materia/173378">ver</a></div></div></body>`);
    rede.paginas[URL_PAUTA] = completa;
    await av(`importarPauta(${JSON.stringify(URL_PAUTA)})`);
    const s3 = ctx.__salvo;
    ok(s3.plns.length === 3 && s3.plns.filter(p => p.key === 'pln-1-2026').length === 1 && s3.plns[0].titulo === 'Receita Federal.', 'página com as matérias: lida como antes, e o item do cabeçalho não duplica');
  }

  console.log('\n== 3. sessões: a mais nova no topo ==');
  {
    rede.firebase['congresso_pautas_meta'] = {
      p_574056: { nome: 'Sessão Conjunta Cancelada — 18/06/2026', data: '18/06/2026', criadoEm: '2026-06-18T14:44:15.605Z' },
      p_596834: { nome: 'Sessão Conjunta Convocada — 12/11/2026', data: '12/11/2026', criadoEm: '2026-11-11T20:36:37.510Z' },
      p_538947: { nome: 'Sessão Conjunta — 27/11/2025', data: '27/11/2025', criadoEm: '2025-11-26T10:00:00Z' },
      p_sem: { nome: 'Sem data', criadoEm: '2026-01-10T10:00:00Z' },
    };
    const ids = (await av('fbCarregarSessoes()')).map(s => s.id);
    ok(ids.join() === 'p_596834,p_574056,p_sem,p_538947', `12/11/2026, 18/06/2026, (importada em 10/01/2026), 27/11/2025 — antes, 18/06 vinha acima de 12/11 (${ids.join(', ')})`);
  }

  console.log('\n== 4. "Resumir todos" numa pauta de sessão inclui os PLNs ==');
  {
    const resumidos = [];
    av('resumirPLN = async (p) => { __resumidos.push(p.key); p.analise = "ok"; return true; }'); ctx.__resumidos = resumidos;
    av('resumirVeto = async (v) => { __resumidos.push("veto-" + v.key); return true; }');
    av(`app.config = { apiKey: 'k', provedor: 'gemini' }; app.vetos = [];
        app.sessaoAtiva = { id: 'p_596834', nome: 'x', plns: [
          { key: 'pln-1-2026', sigla: 'PLN', numero: '1/2026', parecerUrl: 'u1', analise: '' },
          { key: 'pln-3-2026', sigla: 'PLN', numero: '3/2026', parecerUrl: 'u3', analise: 'já tem' },
          { key: 'pln-4-2026', sigla: 'PLN', numero: '4/2026', parecerUrl: '', analise: '' } ] };`);
    toasts.length = 0;
    await av('gerarTodosResumos()');
    const t = toasts[toasts.length - 1];
    ok(resumidos.join() === 'pln-1-2026', `pauta só de PLNs: analisa o PLN sem análise e com parecer (${resumidos.join(', ')}) — antes dizia que todos os vetos já estavam resumidos`);
    ok(/Resumos gerados \(1\)/.test(t.m) && /1 PLN\/MPV sem parecer localizado/.test(t.m), 'e avisa o PLN sem parecer (fica para análise à mão)');
    toasts.length = 0; resumidos.length = 0;
    await av('gerarTodosResumos()');
    ok(!resumidos.length && /Nada a resumir: os vetos e os PLNs\/MPVs da pauta já têm resumo ou análise/.test(toasts[0].m), 'tudo feito: diz que nada falta, falando de vetos E PLNs');
    av(`app.sessaoAtiva = null; app.vetos = [{ key: '9-2026', numero: '9/2026', detalheUrl: 'd', detalheCarregado: false, dispositivos: [] }];`);
    toasts.length = 0; resumidos.length = 0;
    await av('gerarTodosResumos()');
    ok(resumidos.join() === 'veto-9-2026', 'fora de pauta (vetos ao vivo): como antes, só os vetos');
  }

  console.log('\n== 5. caixa "Selecionar todos os PLNs" ==');
  {
    av(`app.vetos = []; app.busca = ''; app.selecionados.clear(); app.sessaoAtiva = { id: 'p', nome: 'x', plns: [
      { key: 'pln-1-2026', sigla: 'PLN', numero: '1/2026', num: 1, ano: 2026, titulo: 'a', interessados: [] },
      { key: 'pln-3-2026', sigla: 'PLN', numero: '3/2026', num: 3, ano: 2026, titulo: 'b', interessados: [] } ] };`);
    av('renderLista()');
    const cx = () => document.getElementById('cn-sel-plns');
    // LIMITAÇÃO DO HARNESS: no linkedom, o atributo `checked` do HTML gerado não vira a propriedade (no navegador
    // vira); o estado desenhado é conferido pelo atributo.
    const marcada = () => cx().hasAttribute('checked');
    ok(!!cx() && !marcada(), 'a seção de PLNs tem a caixa, desmarcada');
    cx().checked = true; cx().dispatchEvent(new window.Event('change'));
    ok(av('[...app.selecionados].sort().join()') === 'pln-1-2026,pln-3-2026' && marcada(), 'marcar: os dois PLNs entram na seleção (e a caixa volta marcada)');
    av(`app.selecionados.delete('pln-3-2026'); renderLista();`);
    ok(!marcada() && cx().indeterminate === true, 'só parte marcada: a caixa fica no estado parcial');
    cx().checked = false; cx().dispatchEvent(new window.Event('change'));
    ok(av('app.selecionados.size') === 0, 'desmarcar: tira todos os PLNs da seleção');
    ok(/Selecionar todos os PLNs/.test(document.getElementById('cn-lista').innerHTML), 'o rótulo diz o que faz');
  }

  console.log('\n== 6. botão Apelidos (WhatsApp), no formato do Plenário ==');
  {
    // ementas e apelidos reais (pauta 596834) e vetos da pauta 574056
    av(`app.busca = ''; app.selecionados.clear();
      app.vetos = [
        { key: '14-2026', numero: '14/2026', num: 14, ano: 2026, tipo: 'Parcial', materia: 'PL 5582/2025', assunto: 'Marco Legal do Combate ao Crime Organizado', dispositivos: [] },
        { key: '10-2026', numero: '10/2026', num: 10, ano: 2026, tipo: 'Parcial', materia: 'MPV 1313/2025', assunto: 'Auxílio Gás do Povo', dispositivos: [] },
        { key: '1-2026', numero: '1/2026', num: 1, ano: 2026, tipo: 'Total', materia: 'PL 1469/2020', assunto: 'Carreiras das Polícias Militares e dos Corpos de Bombeiros Militares', dispositivos: [] },
        { key: '3-2026', numero: '3/2026', num: 3, ano: 2026, tipo: '', materia: '', assunto: '(sem assunto)', dispositivos: [] } ];
      app.sessaoAtiva = { id: 'p', nome: 'x', plns: [
        { key: 'pln-1-2026', sigla: 'PLN', numero: '1/2026', num: 1, ano: 2026, apelido: 'Receita Federal do Brasil e outros servidores federais', ementa: 'Altera o Anexo V à Lei nº 15.346, de 14 de janeiro de 2026, que estima a receita e fixa a despesa da União para o exercício financeiro de 2026.', interessados: [] },
        { key: 'pln-3-2026', sigla: 'PLN', numero: '3/2026', num: 3, ano: 2026, apelido: 'Ministério da Ciência, Tecnologia e Inovação', ementa: 'Abre ao Orçamento Fiscal da União, em favor do Ministério da Ciência, Tecnologia e Inovação, crédito suplementar no valor de R$ 13.186.131,00, para reforço de dotação constante da Lei Orçamentária vigente.', interessados: [] },
        { key: 'pln-7-2026', sigla: 'PLN', numero: '7/2026', num: 7, ano: 2026, apelido: 'Copa do Mundo Feminina da FIFA 2027 e Primeiro Hospital Inteligente do Brasil', ementa: 'Altera a Lei nº 15.321, de 31 de dezembro de 2025, que dispõe sobre as diretrizes para a elaboração e a execução da Lei Orçamentária de 2026.', interessados: [] },
        { key: 'pln-18-2026', sigla: 'PLN', numero: '18/2026', num: 18, ano: 2026, apelido: 'Altera LOA 2026 - ajustar autorizações de suplementação e remanejamento', ementa: 'Altera o art. 4º da Lei nº 15.346, de 14 de janeiro de 2026, que estima a receita e fixa a despesa da União para o exercício financeiro de 2026.', interessados: [] },
        { key: 'pln-8-2026', sigla: 'PLN', numero: '8/2026', num: 8, ano: 2026, apelido: '', titulo: '', ementa: 'Abre ao Orçamento da Seguridade Social da União, em favor das Justiças Federal e do Trabalho, crédito especial no valor de R$ 21.557.807,00, para os fins que especifica.', interessados: [] } ] };`);
    const { texto, total } = av('montarMensagemApelidos(app.vetos, app.sessaoAtiva.plns)');
    const L = texto.split('\n');
    ok(total === 9 && L[0].startsWith('▪️ *Veto') && L[4].startsWith('▪️ *PLN'), 'vetos primeiro, depois os PLNs — uma linha por item');
    ok(L[0] === '▪️ *Veto 14/2026 (parcial) ao PL 5582/2025* (Marco Legal do Combate ao Crime Organizado)', `veto: tipo e projeto vetado em negrito, o assunto oficial entre parênteses (${L[0]})`);
    ok(L[1] === '▪️ *Veto 10/2026 (parcial) à MPV 1313/2025* (Auxílio Gás do Povo)' && L[2].startsWith('▪️ *Veto 1/2026 (total) ao PL 1469/2020*'), '"à MPV", "(total)"');
    ok(L[3] === '▪️ *Veto 3/2026*', 'veto lido só do cabeçalho (sem tipo, matéria nem assunto): só o número, nada inventado');
    ok(L[4] === '▪️ *PLN 1/2026* – altera a LOA 2026 (Receita Federal do Brasil e outros servidores federais)', `PLN que altera a LOA: o tipo antes do apelido oficial (${L[4]})`);
    ok(L[5] === '▪️ *PLN 3/2026* – crédito suplementar (Ministério da Ciência, Tecnologia e Inovação)', 'PLN de crédito: "crédito suplementar", sem o valor');
    ok(L[6] === '▪️ *PLN 7/2026* – altera a LDO 2026 (Copa do Mundo Feminina da FIFA 2027 e Primeiro Hospital Inteligente do Brasil)', 'PLN que altera a LDO');
    ok(L[7] === '▪️ *PLN 18/2026* (Altera LOA 2026 - ajustar autorizações de suplementação e remanejamento)', 'o apelido que já diz "LOA" não ganha o tipo de novo (sem "altera a LOA 2026 (Altera LOA 2026…)")');
    ok(L[8] === '▪️ *PLN 8/2026* – crédito especial', 'sem apelido: só o tipo, sem parênteses vazios');
    // copiar: com marcação, só os marcados
    const copiado = [];
    ctx.navigator = { clipboard: { writeText: async t => { copiado.push(t); } } };
    av(`app.selecionados.clear(); app.selecionados.add('pln-3-2026'); app.selecionados.add('14-2026');`);
    toasts.length = 0;
    await av('copiarApelidos()');
    ok(copiado[0] === '▪️ *Veto 14/2026 (parcial) ao PL 5582/2025* (Marco Legal do Combate ao Crime Organizado)\n▪️ *PLN 3/2026* – crédito suplementar (Ministério da Ciência, Tecnologia e Inovação)'
      && /✓ 2 apelido\(s\) copiados/.test(toasts[0].m), 'com itens marcados: copia só eles');
    av('app.selecionados.clear()');
    await av('copiarApelidos()');
    ok(copiado[1].split('\n').length === 9, 'sem marcação: a pauta inteira');
    av('renderLista()');
    ok(document.getElementById('btn-apelidos').disabled === false, 'com uma pauta de sessão aberta, o botão fica ativo');
    av('app.sessaoAtiva = null; renderLista()');
    ok(document.getElementById('btn-apelidos').disabled === true, 'na lista de vetos ao vivo (sem pauta), o botão fica desligado');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
