// Correções do lote 5 da varredura (15/09/2026) — bot do Telegram: falha de
// consulta não vira fato, registro de mensagem não falha calado e ferramenta do
// agente tem prazo.
//
// Uso: node testes/correcoes-lote5.test.js
const path = require('path');
const fs = require('fs');
const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Substitui o fetch global por um roteador de rotas, e devolve o que restaurar. */
function comFetch(rotas) {
  const antes = globalThis.fetch;
  globalThis.fetch = async (url) => {
    for (const [re, resp] of rotas) if (re.test(String(url))) return resp(String(url));
    return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
  };
  return () => { globalThis.fetch = antes; };
}
const json = obj => () => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
const erro = st => () => ({ ok: false, status: st, json: async () => ({}), text: async () => '' });

(async () => {
  console.log('== /colegio não inventa situação quando a API cai ==');
  {
    const materia = require(path.join(RAIZ, 'bot/src/materia.js'));
    const fn = materia.buscarTramitacoes || materia._buscarTramitacoes;
    if (typeof fn === 'function') {
      let restaurar = comFetch([[/\/tramitacoes/, erro(503)]]);
      ok(await fn(123) === null, 'API fora do ar devolve null, não lista vazia');
      restaurar();
      restaurar = comFetch([[/\/tramitacoes/, json({ dados: [] })]]);
      const vazio = await fn(123);
      ok(Array.isArray(vazio) && !vazio.length, 'proposição realmente sem tramitação segue devolvendo lista vazia');
      restaurar();
      ok(await fn(undefined) === null, 'sem identificador, nem consulta');
    } else {
      // a função é interna ao módulo: confere pelo código-fonte
      const src = fs.readFileSync(path.join(RAIZ, 'bot/src/materia.js'), 'utf8');
      ok(/async function buscarTramitacoes[\s\S]{0,400}if \(!res\.ok\) return null;[\s\S]{0,200}catch \(_\) \{ return null; \}/.test(src),
        'buscarTramitacoes devolve null em falha (e não lista vazia)');
      ok(/it\.situacao\s*=\s*trams\s*\?/.test(src), 'a ficha só deriva situação quando houve tramitação lida');
      ok(/Não apurada — a consulta de tramitação na Câmara falhou/.test(src),
        'e declara "não apurada" quando a consulta falhou, em vez de "não há requerimento"');
      ok(!/situacaoDe\(trams\);/.test(src), 'não há mais derivação incondicional da situação');
    }
  }

  console.log('\n== o bot não afirma autoria que não conseguiu verificar ==');
  {
    const src = fs.readFileSync(path.join(RAIZ, 'bot/src/perguntar.js'), 'utf8');
    ok(!/catch \(_\) \{ sig = null; \}/.test(src),
      'a consulta de partido não engole mais a falha devolvendo nulo');
    ok(!/_depCache\.set\(idDep, sig\);[\s\S]{0,40}catch/.test(src) && /const j = await fetchJsonCamara\(`\$\{API_CAMARA\}\/deputados/.test(src),
      'a falha não é guardada em cache — a próxima pergunta tenta de novo');
    ok(/try \{ a = await autoriaPodeDe\(prop\.id\); \}[\s\S]{0,200}return '';/.test(src),
      'falhando a apuração, a linha de autoria SOME (a IA não fala de autoria) em vez de afirmar');
    ok(!/const ra = await autoriaPodeDe\(ap\.id\)\.catch\(\(\) => \(\{ ehPode: false \}\)\)/.test(src),
      'e a falha numa apensada não vira "não é do Podemos"');
    ok(/apensada\(s\) não puderam ser verificadas/i.test(src),
      'o analista é avisado de quantas apensadas ficaram sem verificação');

    // a frase categórica continua existindo — só que agora só no caminho verificado
    ok(/nenhum\(a\) autor\(a\)\/coautor\(a\) filiado\(a\) ao Podemos hoje/.test(src),
      'o texto para o caso realmente verificado continua lá');
  }

  console.log('\n== registro das mensagens do grupo não falha calado ==');
  {
    const src = fs.readFileSync(path.join(RAIZ, 'bot/src/monitor.js'), 'utf8');
    ok(!/fbPut\('\/bot\/msgs_grupo', _msgsGrupo\)\.catch\(\(\) => \{\}\)/.test(src),
      'a gravação do registro não termina mais em catch vazio');
    ok(/registro de mensagem do grupo não foi salvo no Firebase/.test(src),
      'a falha é registrada, para o /revisar_msg não ter lacuna silenciosa');
  }

  console.log('\n== ferramenta do agente tem prazo ==');
  {
    const src = fs.readFileSync(path.join(RAIZ, 'bot/src/agente.js'), 'utf8');
    ok(/function comPrazo\(/.test(src) && /TIMEOUT_FERRAMENTA_MS/.test(src), 'existe prazo por ferramenta');
    ok(/comPrazo\(fn\(j\.argumentos \|\| \{\}\), TIMEOUT_FERRAMENTA_MS/.test(src),
      'e ele é aplicado na chamada da ferramenta dentro do laço');

    // comportamento da função de prazo, isolada
    const comPrazo = new Function(`${/function comPrazo\([\s\S]*?\n\}/.exec(src)[0]}; return comPrazo;`)();
    const rapida = comPrazo(Promise.resolve('ok'), 1000, 'x');
    ok(await rapida === 'ok', 'consulta que responde a tempo passa intacta');
    let capturado = null;
    try { await comPrazo(new Promise(() => {}), 30, 'varrer_comissoes'); } catch (e) { capturado = e; }
    ok(!!capturado && /varrer_comissoes/.test(capturado.message) && /sem responder/.test(capturado.message),
      `consulta pendurada vira erro nomeado (${capturado ? capturado.message : 'NÃO LANÇOU'})`);
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
