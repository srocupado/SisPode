// Reunião de Líderes · resumo com a API de Dados Abertos FORA DO AR.
//
// 10/11/2026: API em 503/504 o dia inteiro. A primeira consulta de cada item
// falhava e todo resumo morria antes da IA ("peço para resumir e não vem
// nada"). Agora os dados vêm do portal:
//   · busca do portal (busca-api): id, ementa, inteiro teor, autores com
//     partido e ordem de assinatura, apensação e a ÁRVORE de apensados — para
//     apurar apensado de autoria do Podemos;
//   · webservice do portal (SitCamaraWS), se a busca também cair.
// O que só a API dá (urgência/tramitação, relatoria, parecer) fica declarado
// como NÃO APURADO.
//
// As respostas da busca abaixo reproduzem os campos REAIS conferidos em
// 10/11/2026 — inclusive a PEC 17/2024, "Apensada à PEC 82/2007" com
// codProposicaoApensadaPai = 0. O XML do webservice é o real (fixture).
// Uso: node testes/lideres-api-fora.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const fonte = fs.readFileSync(path.join(RAIZ, 'lideres.js'), 'utf8');
const html = fs.readFileSync(path.join(RAIZ, 'lideres.html'), 'utf8');
const WS = n => fs.readFileSync(path.join(__dirname, 'fixtures', 'lideres', n), 'utf8');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const autor = (nome, partido, uf, seq) => ({ nome, siglaPartido: partido, siglaUF: uf, numSequencial: seq });
const P = (id, sigla, numero, ano, extra = {}) => ({ id, siglaProposicao: sigla, numero, ano, ementa: `Ementa ${sigla} ${numero}/${ano}.`, codArquivoTeor: id + 1,
  situacaoProposicao: '', codProposicaoApensadaPai: 0, autores: [], ...extra });
const BASE = [
  P(354302, 'PEC', 82, 2007, { autores: [autor('FLÁVIO DINO', 'PCdoB', 'MA', 1)] }),
  P(2432987, 'PEC', 17, 2024, { situacaoProposicao: 'Apensada à PEC 82/2007',   // pai = 0 de verdade
    autores: [autor('Carlos Sampaio', 'PSD', 'SP', 1), autor('Nely Aquino', 'PODE', 'MG', 7), autor('Renata Abreu', 'PODE', 'SP', 9)] }),
  P(9452, 'PEC', 452, 2009, { codProposicaoApensadaPai: 354302, situacaoProposicao: 'Apensada à PEC 82/2007', autores: [autor('Fulano', 'PT', 'BA', 1)] }),
  P(2628364, 'PL', 2649, 2026, { autores: [autor('Duda Ramos', 'PODE', 'RR', 1)] }),
  P(2641101, 'PL', 4414, 2026, { codProposicaoApensadaPai: 2628364, situacaoProposicao: 'Apensado ao PL 2649/2026', autores: [autor('Duda Ramos', 'PODE', 'RR', 1)] }),
  P(2641242, 'PL', 4554, 2026, { codProposicaoApensadaPai: 2641101, situacaoProposicao: 'Apensado ao PL 4414/2026', autores: [autor('Duda Ramos', 'PODE', 'RR', 1)] }),
  P(2641300, 'PL', 4555, 2026, { codProposicaoApensadaPai: 2641242, situacaoProposicao: 'Apensado ao PL 4554/2026', autores: [autor('Beltrano', 'PL', 'SP', 1), autor('Duda Ramos', 'PODE', 'RR', 2)] }),
  P(2556748, 'PL', 4399, 2025, { autores: [autor('Delegado Bruno Lima', 'PP', 'SP', 1)] }),
  P(2611932, 'PL', 1403, 2026, { autores: [autor('Renata Abreu', 'PODE', 'SP', 1)] }),
  P(2562481, 'PL', 4675, 2025, { autores: [{ nome: 'Poder Executivo', numSequencial: 1 }] }),
];
// Busca de mentira com a semântica da real: campo:valor, AND, aspas.
function buscar(q) {
  const termos = q.split(/\s+AND\s+/).map(t => /^(\w+):"?(.*?)"?$/.exec(t)).filter(Boolean);
  return BASE.filter(p => termos.every(([, k, v]) => k === 'situacaoProposicao' ? String(p.situacaoProposicao).includes(v) : String(p[k]) === v));
}
let chamadas = { api: 0, busca: 0, ws: 0 }, buscaFora = false;
const sandbox = {
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  chrome: { runtime: { getURL: x => x }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } },
  pdfjsLib: { GlobalWorkerOptions: {} }, window: {}, console, setTimeout, clearTimeout, DOMException: globalThis.DOMException, XLSX: undefined, AbortSignal,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  fetch: async (url, init = {}) => {
    url = String(url);
    if (url.includes('dadosabertos')) { chamadas.api++; return { ok: false, status: 504, json: async () => ({}) }; }
    if (url.includes('busca-api')) {
      chamadas.busca++;
      if (buscaFora) return { ok: false, status: 503 };
      const { q, pagina } = JSON.parse(init.body);
      const todos = buscar(q), pag = todos.slice((pagina - 1) * 2, pagina * 2);   // 2 por página: exercita a paginação
      return { ok: true, status: 200, json: async () => ({ hits: { total: { value: todos.length }, hits: pag.map(_source => ({ _source })) } }) };
    }
    if (/fichadetramitacao\?idProposicao=2562481$/.test(url)) return { ok: true, status: 200, text: async () => WS('ficha-PL-4675-2025.html') };
    if (/prop_pareceres_substitutivos_votos\?idProposicao=2562481$/.test(url)) return { ok: true, status: 200, text: async () => WS('pareceres-PL-4675-2025.html') };
    if (url.includes('SitCamaraWS')) {
      chamadas.ws++;
      const m = /tipo=(\w+)&numero=(\d+)&ano=(\d+)/.exec(url);
      const f = path.join(__dirname, 'fixtures', 'lideres', `ws-${m[1]}-${m[2]}-${m[3]}.xml`);
      return fs.existsSync(f) ? { ok: true, status: 200, text: async () => WS(path.basename(f)) } : { ok: false, status: 404, text: async () => '' };
    }
    return { ok: false, status: 404 };
  },
};
const L = new Function(...Object.keys(sandbox), `${fonte}\n; return { carregarDadosDaProposicao, fichaDoPortal, app, tramitacoesDaFicha, documentosDaFicha, emendaSenadoDe, fraseDaEmendaSenado, etiquetasDe };`)(...Object.values(sandbox));
const carregar = async (sigla, numero, ano) => { const it = { sigla, numero, ano, celulaProp: '' }; await L.carregarDadosDaProposicao(it); return it; };

(async () => {
  console.log('== API fora: dados pela busca do portal ==');
  const pec82 = await carregar('PEC', 82, 2007);
  ok(chamadas.api === 1, 'só a 1ª consulta vai à API; depois, 2 min direto pelo portal');
  ok(pec82.idCamara === 354302 && pec82.ementa === 'Ementa PEC 82/2007.' && /codteor=354303$/.test(pec82.urlInteiroTeor) && pec82.dadosPeloPortal, 'id, ementa e inteiro teor');
  ok(/Apensado do Podemos: PEC 17\/2024 \(Nely Aquino, Renata Abreu\)/.test(pec82.apensacao), `apensado do Podemos achado pela SITUAÇÃO (pai = 0 na busca): ${pec82.apensacao.split('\n')[1]}`);
  ok(!/452/.test(pec82.apensacao.split('\n')[1] || '') && /^Principal \(com apensados\)\./.test(pec82.apensacao), 'apensado sem Podemos não entra na lista; principal com apensados');
  ok(/Não apurada — a API/.test(pec82.situacao) && pec82.situacaoFalhou && /Não apurado/.test(pec82.parecerFato), 'urgência e parecer: NÃO apurados, nunca "não há"');

  const pec17 = await carregar('PEC', 17, 2024);
  ok(pec17.papel.apensada && pec17.papel.principal === 'PEC 82/2007' && /^Apensado ao PEC 82\/2007\./.test(pec17.apensacao), 'apensada lida pela situação ("Apensada à PEC 82/2007")');
  ok(pec17.autoriaPodemos && !pec17.autoriaPrincipalPodemos && JSON.stringify(pec17.autoresPodemos) === '["Nely Aquino","Renata Abreu"]', 'coautoria do Podemos (não é a 1ª signatária)');
  ok(pec17.autoresApi[0] === 'Carlos Sampaio (PSD-SP)', 'autores com partido, na ordem de assinatura');

  const pl2649 = await carregar('PL', 2649, 2026);
  ok(/Apensado do Podemos: PL 4414\/2026 \(Duda Ramos\); PL 4554\/2026 \(Duda Ramos\); PL 4555\/2026 \(Duda Ramos\)\./.test(pl2649.apensacao), 'árvore de vários níveis (4414 → 4554 → 4555), coautor do Podemos incluído');
  ok(pl2649.autoriaPodemos && pl2649.autoriaPrincipalPodemos, 'autoria do Podemos (1ª signatária)');
  const pl4399 = await carregar('PL', 4399, 2025);
  ok(/^Sem apensação\./.test(pl4399.apensacao) && !pl4399.autoriaPodemos, 'sem apensados e sem Podemos: diz isso');

  console.log('\n== situação da urgência, relatoria e parecer pelo portal (ficha e pareceres reais do PL 4675/2025) ==');
  const pl4675 = await (async () => { const it = { sigla: 'PL', numero: 4675, ano: 2025, celulaProp: '', regimePdf: 'Urgência aprovada em 18/03/2026' }; await L.carregarDadosDaProposicao(it); return it; })();
  ok(pl4675.situacao === 'Urgência aprovada (REQ. 4612/2025)' && !pl4675.situacaoFalhou, `situação pela ficha ("Aprovado o requerimento nº 4612/2025,do Sr. …"): ${pl4675.situacao}`);
  ok(pl4675.relatoria === 'Designado: Dep. Aliel Machado (PV-PR)' && pl4675.relatorDesignado === 'Dep. Aliel Machado (PV-PR)', `relatoria pela ficha ("Designado Relator"): ${pl4675.relatoria}`);
  ok(pl4675.parecerPlen && pl4675.parecerPlen.data === '2026-07-08' && /^Parecer proferido em Plenário em 08\/07\/2026, pelo relator Dep\. Aliel Machado/.test(pl4675.parecer), `parecer pelo histórico de pareceres: ${pl4675.parecer}`);
  ok(/codteor=3159491/.test(pl4675.parecerPlen.merito?.url || pl4675.parecerPlen.pareceres[0].url), 'o inteiro teor do PRLP vai para a IA');
  ok(JSON.stringify(pl4675.portalApurou) === '{"tramitacao":true,"pareceres":true}', 'marca o que o portal apurou (o aviso do item lista só o que faltou)');
  const sem = await carregar('PL', 1403, 2026);   // páginas do portal indisponíveis (404) para este
  ok(/Não apurada/.test(sem.situacao) && /Não apurado/.test(sem.parecer) && JSON.stringify(sem.portalApurou) === '{"tramitacao":false,"pareceres":false}', 'sem as páginas do portal, continua NÃO apurado (nunca "não há")');

  console.log('\n== emendas do Senado pela ficha (as três redações reais da volta do Senado) ==');
  const senado = n => { const d = L.documentosDaFicha(L.tramitacoesDaFicha(WS(`ficha-PL-${n}.html`))); return L.fraseDaEmendaSenado(L.emendaSenadoDe(d)); };
  ok(senado('2979-2023') === 'Emenda/Substitutivo do Senado recebido em 16/07/2026; texto que saiu da Câmara: autógrafo de 27/10/2025.', `"Apresentação da EMS": ${senado('2979-2023')}`);
  ok(/^Emenda\/Substitutivo do Senado recebido em 14\/08\/2026; texto que saiu da Câmara: autógrafo de 26\/08\/2025/.test(senado('3099-2019')), `"Recebido Ofício … Senado Federal aprovou … substitutivo": ${senado('3099-2019')}`);
  ok(/^Emenda\/Substitutivo do Senado recebido em 29\/05\/2025; texto que saiu da Câmara: autógrafo de 23\/08\/2023/.test(senado('4558-2019')), `"Apresentação do PL … pelo Senado Federal, que Substitutivo do Senado": ${senado('4558-2019')}`);
  ok(senado('4675-2025') === 'Não há emenda do Senado.', 'proposição que não voltou do Senado: "Não há emenda do Senado."');
  const es2979 = L.emendaSenadoDe(L.documentosDaFicha(L.tramitacoesDaFicha(WS('ficha-PL-2979-2023.html'))));
  ok(/codteor=3163743/.test(es2979.ems.url) && /codteor=3023979/.test(es2979.autografo.url), 'confronto com a EMS (não o ofício do mesmo dia) e o autógrafo');
  ok(JSON.stringify(L.etiquetasDe({ marcador: 'EMS', cenario: 1, dadosPeloPortal: true, portalApurou: { tramitacao: false } })) === '["EMS"]', 'ficha indisponível: não afirma "sem EMS"');
  ok(JSON.stringify(L.etiquetasDe({ marcador: 'EMS', cenario: 1, dadosPeloPortal: true, portalApurou: { tramitacao: true } })) === '["EMS","sem EMS na ficha do portal"]', 'ficha lida e sem EMS: diz onde procurou');

  console.log('\n== busca do portal também fora: webservice (2ª via) ==');
  buscaFora = true;
  const pl1403 = await carregar('PL', 1403, 2026);
  ok(pl1403.idCamara === 2611932 && pl1403.autoriaPodemos && /Renata Abreu \(PODE/.test(pl1403.autoresApi[0]), 'id, ementa e autor (PODE) pelo webservice');
  ok(/^Apensação e apensados do Podemos NÃO apurados/.test(pl1403.apensacao), 'sem a busca, apensados do Podemos ficam declarados como NÃO apurados');
  ok(/^https:\/\/www\.camara\.leg\.br\/proposicoesWeb\/prop_mostrarintegra\?codteor=\d+$/.test(pl1403.urlInteiroTeor), 'link do inteiro teor no domínio atual');
  const pl2561 = await carregar('PL', 2561, 2024);
  ok(/Último despacho no portal \(02\/08\/2024\): Apense-se à\(ao\) PL-678\/2024/.test(pl2561.apensacao), 'o webservice não dá o principal (vem vazio): vai o último despacho, como fato da fonte');
  let erro = null; try { await carregar('PL', 1, 1990); } catch (e) { erro = e.message; }
  ok(/API da Câmara fora do ar .* e o portal também falhou/.test(erro || ''), `tudo fora: o erro diz o quê (${erro})`);

  console.log('\n== o resumo e o aviso ==');
  ok(/if \(!it\.idCamara \|\| it\.dadosPeloPortal\) await carregarDadosDaProposicao\(it\);/.test(fonte), 'item lido pelo portal é refeito pela API no próximo resumo');
  ok(/NÃO apurado: \$\{falta\.join\(', '\)\}/.test(fonte), 'o resumo leva o aviso do que não foi apurado');

  console.log('\n== excluir a reunião ==');
  ok(/id="btn-excluir-reuniao"[^>]*>[\s\S]*?Excluir reunião/.test(html), 'botão "Excluir reunião" na barra da reunião aberta');
  ok(/getElementById\('btn-excluir-reuniao'\)\.addEventListener\('click', \(\) => app\.reuniao && apagarReuniao\(app\.reuniao\.id/.test(fonte), 'ligado à exclusão');
  ok(/if \(erroFb\) \{ mostrarToast\(`Não excluí: o Firebase falhou/.test(fonte), 'falha do Firebase não vira "apagada" (antes era engolida e a reunião voltava)');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
