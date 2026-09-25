// Sigla da bancada: uma definição só na extensão (bancada.js) e uma no bot
// (bot/src/bancada.js, via BANCADA_SIGLA do .env) — e os helpers de quem
// está na bancada hoje e numa data.
//
// O que este teste trava:
//  1. nenhum módulo da extensão ou do bot volta a ter 'PODE' solto em lógica
//     (o que sobra é dado: dicionário de nomes de partido, lista de partidos);
//  2. as páginas que usam BANCADA_SIGLA carregam bancada.js antes;
//  3. o bot lê a sigla do ambiente;
//  4. membrosAtuais: memo de 10 min, licenciados vindos do cadastro, lista
//     vazia é erro; membrosEm: histórico decide quem estava no dia;
//  5. extensão e bot aplicam a mesma regra de estado no instante.
//
// Uso: node testes/bancada-sigla.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

console.log('== uma sigla só ==');
{
  const extensao = ['analise.js', 'ccjc.js', 'emendas.js', 'lideres.js', 'radar.js', 'pautas-comissoes.js',
                    'pautas-comissoes-core.js', 'aderencia.js', 'comissoes.js', 'congresso.js'];
  for (const f of extensao) {
    const src = fs.readFileSync(path.join(RAIZ, f), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const soltos = (src.match(/'PODE'/g) || []).length;
    // pautas-comissoes-core.js roda puro no Node: o fallback quando bancada.js não está carregado é o único permitido.
    ok(soltos <= (f === 'pautas-comissoes-core.js' ? 1 : 0), `${f}: sem 'PODE' solto (${soltos})`);
  }
  const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
  ok(!/id="partido"[^>]*value="PODE"/.test(html), 'aderencia.html: o campo de partido não traz mais value="PODE" fixo');
  for (const [pagina, js] of [['analise.html', 'analise.js'], ['ccjc.html', 'ccjc.js'], ['emendas.html', 'emendas.js'],
    ['lideres.html', 'lideres.js'], ['pautas-comissoes.html', 'pautas-comissoes.js'], ['aderencia.html', 'aderencia.js']]) {
    const h = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
    const j = h.indexOf('src="bancada.js"'), k = h.indexOf(`src="${js}"`);
    ok(j > -1 && j < k, `${pagina}: bancada.js antes de ${js}`);
  }
  const bot = fs.readdirSync(path.join(RAIZ, 'bot', 'src')).filter(f => f.endsWith('.js') && f !== 'bancada.js')
    .map(f => path.join('bot', 'src', f)).concat(['bot/index.js']);
  const permitidos = { 'bot/src/comissoes.js': 2, 'bot/src/monitor.js': 1 }; // dicionário de nomes / lista de partidos
  for (const f of bot) {
    const n = (fs.readFileSync(path.join(RAIZ, f), 'utf8').match(/'PODE'/g) || []).length;
    if (n > (permitidos[f] || 0)) ok(false, `${f}: 'PODE' solto (${n})`);
  }
  ok(true, 'bot: nenhum módulo com \'PODE\' solto em lógica');
}

console.log('\n== bot: sigla do ambiente ==');
{
  const p = require.resolve(path.join(RAIZ, 'bot', 'src', 'bancada.js'));
  process.env.BANCADA_SIGLA = ' novo ';
  delete require.cache[p];
  const B = require(p);
  ok(B.SIGLA === 'NOVO', `BANCADA_SIGLA=" novo " → "NOVO" (${B.SIGLA})`);
  ok(B.ehDaBancada('novo') && !B.ehDaBancada('PODE'), 'ehDaBancada compara com a sigla configurada');
  delete process.env.BANCADA_SIGLA;
  delete require.cache[p];
  ok(require(p).SIGLA === 'PODE', 'sem a variável: PODE');
}

(async () => {
  console.log('\n== membrosAtuais e membrosEm (extensão) ==');
  const chamadas = [];
  let API_VAZIA = false;
  const HIST = {
    1: [{ dataHora: '2023-02-01T10:00', siglaPartido: 'PODE', situacao: 'Exercício' }],
    2: [{ dataHora: '2023-02-01T10:00', siglaPartido: 'PL', situacao: 'Exercício' },
        { dataHora: '2024-04-01T00:00', siglaPartido: 'PODE', situacao: 'Exercício' }],
    3: [{ dataHora: '2023-02-01T10:00', siglaPartido: 'PODE', situacao: 'Exercício' },
        { dataHora: '2024-03-01T00:00', siglaPartido: 'PODE', situacao: 'Licença' }],
  };
  const jsonOk = b => ({ ok: true, status: 200, json: async () => b });
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Date, Promise, Set, Map, Number, JSON, Object, encodeURIComponent,
    fetch: async (url, op) => {
      const u = String(url), metodo = (op && op.method) || 'GET';
      chamadas.push(`${metodo} ${u}`);
      let m;
      if (/\/deputados\?siglaPartido=PODE&itens=100/.test(u)) {
        return jsonOk({ dados: API_VAZIA ? [] : [{ id: 1, nome: 'Ana', siglaUf: 'SP', siglaPartido: 'PODE' }], links: [] });
      }
      if (/\/deputados\?siglaPartido=PODE&dataInicio=/.test(u)) {
        return jsonOk({ dados: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      }
      if ((m = u.match(/\/deputados\/(\d+)\/historico/))) return jsonOk({ dados: HIST[m[1]] || [] });
      if (u.endsWith('/deputados.json') && metodo === 'GET') {
        return jsonOk({ cam_1: { nome: 'Ana', idCamara: 1, situacao: 'exercicio' },
                        cam_9: { nome: 'Renata', uf: 'SP', partido: 'PODE', idCamara: 9, situacao: 'licenciado' },
                        cam_8: { nome: 'Ex', idCamara: 8, situacao: 'ex-membro' } });
      }
      if (u.endsWith('_sync.json') && metodo === 'GET') return jsonOk({ em: new Date().toISOString() });
      return jsonOk(null);
    },
  };
  vm.createContext(ctx);
  for (const f of ['legislatura.js', 'bancada.js']) new vm.Script(fs.readFileSync(path.join(RAIZ, f), 'utf8')).runInContext(ctx);
  const av = e => vm.runInContext(e, ctx);

  const a = await av('membrosAtuais()');
  ok(a.length === 1 && a[0].idCamara === 1, 'membrosAtuais: a lista em exercício da Câmara');
  const n = chamadas.length;
  await av('membrosAtuais()');
  ok(chamadas.length === n, 'segunda chamada em menos de 10 min não consulta a Câmara');
  const c = await av('membrosAtuais({ comLicenciados: true })');
  ok(c.map(d => d.nome).join() === 'Ana,Renata', `com licenciados: soma quem o cadastro marca 'licenciado', não o ex-membro (${c.map(d => d.nome)})`);
  API_VAZIA = true;
  let erro = null;
  try { await av('membrosAtuais({ forcar: true })'); } catch (e) { erro = e; }
  ok(erro && /vazia/.test(erro.message), 'lista vazia da Câmara é erro, não "bancada sem ninguém"');

  const em = await av(`membrosEm('2024-01-10').then(s => [...s].sort().join())`);
  ok(em === '1,3', `membrosEm(10/01/2024): 1 e 3; o dep 2 ainda era do PL (${em})`);
  const em2 = await av(`membrosEm('2024-06-10').then(s => [...s].sort().join())`);
  ok(em2 === '1,2', `membrosEm(10/06/2024): 1 e 2; o dep 3 está de licença (${em2})`);

  console.log('\n== extensão e bot: mesma regra de estado ==');
  const B = require(path.join(RAIZ, 'bot', 'src', 'bancada.js'));
  for (const [id, h] of Object.entries(HIST)) {
    for (const t of ['2023-01-01T00:00', '2023-06-01T00:00', '2024-03-15T00:00', '2024-06-01T00:00']) {
      ctx.__h = h;
      const ext = av(`JSON.stringify(estadoNoInstante(__h, '${t}'))`);
      const bot = JSON.stringify(B.estadoNoInstante(h, t));
      if (ext !== bot) ok(false, `dep ${id} em ${t}: extensão ${ext} × bot ${bot}`);
    }
  }
  ok(true, 'estadoNoInstante dá o mesmo resultado nas duas cópias');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
