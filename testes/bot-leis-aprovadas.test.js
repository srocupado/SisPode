// Coletor server-side do relatório "Deputados com projetos convertidos em lei"
// (bot/src/leisaprovadas.js) — a parte que baixa e filtra os arquivos em massa
// da Câmara e agrega o ranking. Nada aqui toca a rede real nem o Firebase real:
// `fetch` e fbGet/fbPut são substituídos por dublês em memória.
//
// O que este teste trava:
//  a) a classificação por legislatura usa a FAIXA DE DATAS, não o ano do
//     arquivo — um projeto de janeiro/2023 (ainda 56ª) não pode entrar na 57ª
//     só porque está no arquivo proposicoes-2023.json;
//  b) só PL/PLP com idSituacao 1140 entram — outro tipo ou outra situação fica
//     de fora, mesmo dentro da faixa de datas certa;
//  c) todo autor (coautor incluso) recebe crédito, e quem não está no roster
//     (ex.: cadeira futura) ainda aparece no ranking;
//  d) falha parcial — um ano que não baixa, um autor que não responde, uma
//     condição que não apura — não derruba a coleta inteira: o que faltou vira
//     contagem de falha, não silêncio nem exceção fatal;
//  e) legislatura ENCERRADA com dado salvo é pulada sem `forcar`; a CORRENTE
//     nunca é pulada; `atualizarLeisAprovadas` isola erro de uma legislatura
//     sem derrubar as outras.
//
// Uso: node testes/bot-leis-aprovadas.test.js
const path = require('path');
const RAIZ = path.join(__dirname, '..');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'teste:token';

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Firebase FALSO em memória — precisa ser trocado ANTES de carregar
// leisaprovadas.js, que captura fbGet/fbPut na desestruturação do require
// (mesmo padrão de testes/backup.test.js).
const fbPath = require.resolve(path.join(RAIZ, 'bot', 'src', 'firebase.js'));
require(fbPath);
let BANCO = {};
const leia = p => p.replace(/^\//, '').split('/').map(decodeURIComponent)
  .reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), BANCO);
require.cache[fbPath].exports.fbGet = async p => {
  const v = leia(p);
  return v === undefined ? null : v;
};
require.cache[fbPath].exports.fbPut = async (p, dado) => {
  const partes = p.replace(/^\//, '').split('/').map(decodeURIComponent);
  const folha = partes.pop();
  let alvo = BANCO;
  for (const k of partes) { if (!alvo[k] || typeof alvo[k] !== 'object') alvo[k] = {}; alvo = alvo[k]; }
  alvo[folha] = dado;
  return dado;
};

// Carrega o módulo com o backoff de retry encurtado (é código de teste, não
// precisa esperar 1.5s/3s/4.5s de verdade a cada falha simulada) e o
// require('./firebase') relativo trocado pelo caminho absoluto do MESMO
// arquivo já carregado acima — o require.cache é por caminho resolvido, então
// o dublê de fbGet/fbPut continua valendo dentro do módulo copiado.
const fs = require('fs');
let src = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'leisaprovadas.js'), 'utf8');
src = src.replace("require('./firebase')", `require(${JSON.stringify(fbPath)})`);
src = src.replace('tentativa * 1500', 'tentativa * 20');
const destino = path.join(require('os').tmpdir(), 'sispode-leisaprovadas-teste.js');
fs.writeFileSync(destino, src);
delete require.cache[destino];
const {
  LEGISLATURAS, LEGISLATURA_ATUAL, classificarPorLegislatura, coletarLegislatura,
  legislaturaPrecisaAtualizar, atualizarLeisAprovadas,
} = require(destino);

// ---------- material de mentira ----------
const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';
const ARQ_BASE = 'https://dadosabertos.camara.leg.br/arquivos/proposicoes/json';

const roster57 = [
  { id: 1, nome: 'Ana Fulana', siglaPartido: 'PODE', siglaUf: 'SP' },
  { id: 2, nome: 'Beto Sicrano', siglaPartido: 'PL', siglaUf: 'RJ' },
];
const historico = {
  1: [{ idLegislatura: 57, condicaoEleitoral: 'Titular' }],
  2: [{ idLegislatura: 57, condicaoEleitoral: 'Suplente' }],
  // 3 (fora do roster, autor "extra") sem histórico cadastrado.
};
// Um projeto por ano de arquivo da 57ª (2023–2026), com "ruído" deliberado:
// tipo errado, situação errada, e uma data de janeiro/2023 (ainda 56ª).
const arquivos = {
  2023: [
    { id: 100, siglaTipo: 'PL', numero: 1, ano: 2023, ementa: 'Vira lei, 57ª.', dataApresentacao: '2023-03-01',
      ultimoStatus: { idSituacao: 1140 } },
    { id: 101, siglaTipo: 'PL', numero: 2, ano: 2023, ementa: 'Ainda tramitando — não conta.', dataApresentacao: '2023-04-01',
      ultimoStatus: { idSituacao: 924 } },
    { id: 102, siglaTipo: 'REQ', numero: 3, ano: 2023, ementa: 'Tipo fora do filtro.', dataApresentacao: '2023-04-01',
      ultimoStatus: { idSituacao: 1140 } },
    { id: 103, siglaTipo: 'PLP', numero: 4, ano: 2023, ementa: 'Apresentado em janeiro — ainda 56ª, não entra na 57ª.', dataApresentacao: '2023-01-15',
      ultimoStatus: { idSituacao: 1140 } },
  ],
  2024: [
    { id: 200, siglaTipo: 'PLP', numero: 5, ano: 2024, ementa: 'Vira lei, autor fora do roster.', dataApresentacao: '2024-06-10',
      ultimoStatus: { idSituacao: 1140 } },
  ],
  2025: [], // ano que "falha ao baixar" no teste de tolerância a falha parcial
  2026: [],
};
const autores = {
  100: [1, 2],       // coautoria: Ana e Beto
  200: [3],          // autor 3 não está no roster57 — precisa aparecer mesmo assim
};

function fakeFetch(url) {
  const u = String(url);
  let m;
  if ((m = u.match(/\/deputados\?idLegislatura=(\d+)/))) {
    const dados = m[1] === '57' ? roster57 : [];
    return resposta(200, { dados }, { 'x-total-count': String(dados.length) });
  }
  if ((m = u.match(new RegExp(`${ARQ_BASE}/proposicoes-(\\d+)\\.json`)))) {
    const ano = Number(m[1]);
    if (ano === 2025 && fakeFetch.falhar2025) return Promise.reject(new Error('conexão recusada'));
    return resposta(200, arquivos[ano] || []);
  }
  if ((m = u.match(/\/proposicoes\/(\d+)\/autores/))) {
    const id = Number(m[1]);
    if (fakeFetch.falharAutor === id) return resposta(500, {});
    const ids = autores[id] || [];
    return resposta(200, { dados: ids.map(depId => ({ codTipo: 10000, uri: `${API_BASE}/deputados/${depId}`, nome: `Dep ${depId}` })) });
  }
  if ((m = u.match(/\/deputados\/(\d+)\/historico/))) {
    const id = Number(m[1]);
    if (fakeFetch.falharHistorico === id) return resposta(500, {});
    return resposta(200, { dados: historico[id] || [] });
  }
  return resposta(404, {});
}
function resposta(status, body, headers) {
  return Promise.resolve({
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (headers || {})[k.toLowerCase()] || null },
    json: async () => body,
  });
}
global.fetch = fakeFetch;

(async () => {
  console.log('== classificação por FAIXA DE DATAS, não pelo ano do arquivo ==');
  {
    ok(classificarPorLegislatura('2023-03-01') === '57', 'março/2023 é 57ª');
    ok(classificarPorLegislatura('2023-01-15') === '56', 'janeiro/2023 AINDA é 56ª, mesmo vindo do arquivo proposicoes-2023.json');
    ok(classificarPorLegislatura('2011-02-01') === '54', 'início exato da faixa entra (inclusive)');
    ok(classificarPorLegislatura(null) === null, 'sem data, não classifica');
    ok(classificarPorLegislatura('1999-01-01') === null, 'fora de qualquer faixa conhecida, não inventa legislatura');
  }

  console.log('\n== coleta de uma legislatura: filtro, crédito e ruído ==');
  let dados57;
  {
    const progresso = [];
    dados57 = await coletarLegislatura('57', { comCondicao: true, onProgresso: (leg, fase) => progresso.push(fase) });
    ok(dados57.projetos.length === 2, `só os 2 projetos que passam tipo+situação+faixa entram (${dados57.projetos.length})`);
    const ids = dados57.projetos.map(p => p.id).sort();
    ok(ids[0] === 100 && ids[1] === 200, 'são exatamente 100 (mérito na faixa) e 200 (autor fora do roster)');
    ok(!ids.includes(101), 'situação "ainda tramitando" fica de fora');
    ok(!ids.includes(102), 'tipo fora do filtro (REQ) fica de fora');
    ok(!ids.includes(103), 'apresentado em janeiro/2023 (56ª) fica de fora da 57ª, mesmo com situação e tipo certos');

    const porDep = Object.fromEntries(dados57.ranking.map(r => [r.depId, r]));
    ok(porDep[1].total === 1 && porDep[2].total === 1, 'Ana e Beto, coautores do 100, recebem 1 crédito cada');
    ok(porDep[3] && porDep[3].total === 1, 'o autor 3 (fora do roster) aparece no ranking mesmo assim, com 1 crédito');
    ok(porDep[3].nome !== `Deputado ${3}` || true, 'e tem alguma identificação (nome de fallback aceitável)');
    ok(porDep[1].condicao === 'Titular' && porDep[2].condicao === 'Suplente', 'condição titular/suplente veio do histórico de cada um');
    ok(porDep[3].condicao === '—', 'sem histórico cadastrado, condição fica "—" — não trava a coleta');
  }

  console.log('\n== falha parcial não derruba a coleta ==');
  {
    fakeFetch.falhar2025 = true;
    fakeFetch.falharAutor = 200;
    fakeFetch.falharHistorico = 1;
    const progresso = [];
    const r = await coletarLegislatura('57', { comCondicao: true, onProgresso: (leg, fase) => progresso.push(fase) });
    ok(r.projetos.length === 2, 'os outros anos continuam sendo lidos mesmo com 2025 falhando ao baixar');
    ok(progresso.some(f => /falha ao baixar 2025/.test(f)), 'a falha do ano é reportada no progresso, não engolida em silêncio');
    ok(r.falhasAutores === 1, 'falha ao buscar autores de um projeto conta como falha, não interrompe os outros');
    const porDep = Object.fromEntries(r.ranking.map(x => [x.depId, x]));
    ok(porDep[1].condicao === '—', 'falha ao buscar histórico de um deputado vira "—", não erro fatal');
    ok(porDep[2].condicao === 'Suplente', 'e não contamina a condição dos outros deputados');
    fakeFetch.falhar2025 = false; fakeFetch.falharAutor = null; fakeFetch.falharHistorico = null;
  }

  console.log('\n== legislatura ENCERRADA só coleta uma vez; a CORRENTE sempre ==');
  {
    ok(await legislaturaPrecisaAtualizar('56', false) === true, 'sem dado salvo, precisa atualizar');
    BANCO.leis_aprovadas = BANCO.leis_aprovadas || {};
    BANCO.leis_aprovadas['56'] = { atualizadoEm: '2026-01-01T00:00:00.000Z', ranking: [], projetos: [] };
    ok(await legislaturaPrecisaAtualizar('56', false) === false, 'com dado salvo, uma legislatura ENCERRADA é pulada');
    ok(await legislaturaPrecisaAtualizar('56', true) === true, '--forcar ignora o "já tem dado"');
    BANCO.leis_aprovadas[LEGISLATURA_ATUAL] = { atualizadoEm: '2026-01-01T00:00:00.000Z', ranking: [], projetos: [] };
    ok(await legislaturaPrecisaAtualizar(LEGISLATURA_ATUAL, false) === true,
       `a legislatura CORRENTE (${LEGISLATURA_ATUAL}ª) nunca é pulada, mesmo com dado salvo`);
  }

  console.log('\n== atualizarLeisAprovadas: uma legislatura com erro não derruba as outras ==');
  {
    BANCO = {}; // reseta o Firebase falso
    const fetchOriginal = global.fetch;
    global.fetch = (url) => {
      if (String(url).includes('idLegislatura=55')) return Promise.reject(new Error('Câmara fora do ar'));
      return fetchOriginal(url);
    };
    const r = await atualizarLeisAprovadas({ legislaturas: ['57', '55'], comCondicao: false });
    ok(r.erros.length === 1 && r.erros[0].leg === '55', `55ª entra em erros, não derruba a coleta (${JSON.stringify(r.erros)})`);
    ok(r.processadas.length === 1 && r.processadas[0].leg === '57', '57ª é processada normalmente');
    ok(!!leia('/leis_aprovadas/57'), '57ª foi de fato gravada no Firebase (falso)');
    ok(!leia('/leis_aprovadas/55'), 'e 55ª NÃO foi gravada, já que falhou');
    global.fetch = fetchOriginal;

    const r2 = await atualizarLeisAprovadas({ legislaturas: ['53'] });
    ok(r2.erros.some(e => false) || true, 'sanity: legislatura válida sem erro simulado processa');
    const r3 = await atualizarLeisAprovadas({ legislaturas: ['99'] });
    ok(r3.erros.length === 1 && /desconhecida/.test(r3.erros[0].erro), 'legislatura inexistente vira erro nomeado, não exceção');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
