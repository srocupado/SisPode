// Regressão do caso PL 25/2024 (12/08/2026): o PDF oficial da pauta listava 4
// apensados — dois do Podemos (PL 236/2024, Felipe Becari; PL 951/2024,
// Delegado Bruno Lima) — e a API /relacionadas não devolvia NENHUM deles
// (constavam "Arquivada", sem vínculo com o principal). A varredura
// "bem-sucedida" com zero apensados matava os badges do Podemos em silêncio.
// Contrato: a lista do PDF da pauta é fonte primária; a API complementa; e
// falha de autoria vira 'autoriaNaoVerificada' declarada, nunca não-Podemos.
// Uso: node testes/apensados-pauta.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

function montar({ daApi, resolve, autores }) {
  const fn = new Function('fetchApensados', 'resolveProposicao', 'fetchAutoresProposicao',
    'return (async()=>{' + src.match(/async function resolverApensados[\s\S]*?\n}/)[0] + '; return resolverApensados;})()');
  return fn(
    async () => { if (daApi instanceof Error) throw daApi; return daApi; },
    resolve,
    autores);
}

const PAUTA_PL25 = [
  { sigla: 'PL', numero: '236', ano: '2024' },
  { sigla: 'PL', numero: '257', ano: '2024' },
  { sigla: 'PL', numero: '951', ano: '2024' },
  { sigla: 'PL', numero: '5384', ano: '2025' },
];
const IDS = { '236': 2417718, '257': 2417921, '951': 2423187, '5384': 2575644 };
const AUTORES = {
  2417718: [{ nome: 'Felipe Becari', siglaPartido: 'PODE', isPodemos: true }],
  2417921: [{ nome: 'Célio Studart', siglaPartido: 'PSD', isPodemos: false }],
  2423187: [{ nome: 'Delegado Bruno Lima', siglaPartido: 'PODE', isPodemos: true }],
  2575644: [{ nome: 'Geraldo Mendes', siglaPartido: 'UNIÃO', isPodemos: false }],
};

(async () => {
  console.log('== caso real PL 25/2024: API responde VAZIA, PDF lista 4 ==');
  {
    const f = await montar({
      daApi: [],
      resolve: async (s, n) => ({ id: IDS[n], ementa: 'E ' + n }),
      autores: async id => AUTORES[id],
    });
    const { apensados, varreduraApiFalhou } = await f(2416877, PAUTA_PL25);
    ok(apensados.length === 4, `os 4 apensados do PDF entram (${apensados.length})`);
    const pode = apensados.filter(a => a.autoriaPodemos).map(a => a.numero);
    ok(pode.length === 2 && pode.includes('236') && pode.includes('951'),
       `os DOIS do Podemos vivem: PL ${pode.join(', PL ')}`);
    ok(varreduraApiFalhou === false, 'varredura da API não é marcada como falha (respondeu)');
  }

  console.log('\n== API caiu de vez, PDF cobre — e a parcialidade fica declarada ==');
  {
    const f = await montar({
      daApi: new Error('HTTP 504'),
      resolve: async (s, n) => ({ id: IDS[n], ementa: '' }),
      autores: async id => AUTORES[id],
    });
    const { apensados, varreduraApiFalhou } = await f(2416877, PAUTA_PL25);
    ok(apensados.filter(a => a.autoriaPodemos).length === 2, 'Podemos identificados mesmo com a API fora');
    ok(varreduraApiFalhou === true, 'falha da varredura declarada (pode haver apensado além do PDF)');
  }

  console.log('\n== API caiu e NÃO há lista do PDF → o erro sobe (badge "não verificados") ==');
  {
    const f = await montar({ daApi: new Error('HTTP 504'), resolve: async () => ({}), autores: async () => [] });
    const err = await f(1, []).then(() => null, e => e.message);
    ok(/504/.test(err || ''), `erro explícito: ${err}`);
  }

  console.log('\n== autoria de um apensado falha → não vira "não-Podemos" silencioso ==');
  {
    const f = await montar({
      daApi: [],
      resolve: async (s, n) => ({ id: IDS[n], ementa: '' }),
      autores: async id => { if (id === 2417718) throw new Error('HTTP 504'); return AUTORES[id]; },
    });
    const { apensados } = await f(2416877, PAUTA_PL25);
    const becari = apensados.find(a => a.numero === '236');
    ok(becari.autoriaNaoVerificada === true && becari.autoriaPodemos === false,
       'apensado com autoria não verificada fica DECLARADO, não descartado');
  }

  console.log('\n== API e PDF trazem o mesmo apensado → sem duplicata ==');
  {
    const f = await montar({
      daApi: [{ id: 2417718, siglaTipo: 'PL', numero: '236', ano: '2024' }],
      resolve: async (s, n) => ({ id: IDS[n], ementa: '' }),
      autores: async id => AUTORES[id],
    });
    const { apensados } = await f(2416877, [PAUTA_PL25[0]]);
    ok(apensados.length === 1, `união por id, sem duplicar (${apensados.length})`);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
