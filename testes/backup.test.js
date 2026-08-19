// Testes do backup/restauração do bot.
//
// É o código cujo defeito só aparece no pior dia possível — então aqui ele roda
// a viagem de ida e volta inteira contra um Firebase FALSO em memória: tira o
// snapshot, apaga o banco, restaura e confere que tudo voltou. Nada toca o
// Firebase real nem a pasta bot/dados/ da máquina.
//
// Uso: node testes/backup.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-teste-'));
process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'teste:token';

// DADOS_DIR → sandbox (o backup grava em DADOS_DIR/backups)
const configPath = require.resolve(path.join(__dirname, '..', 'bot', 'src', 'config.js'));
require(configPath);
require.cache[configPath].exports.DADOS_DIR = SANDBOX;

// Firebase FALSO, em memória. Precisa ser trocado ANTES de carregar o
// backup.js, que captura fbGet/fbPut na desestruturação do require.
const fbPath = require.resolve(path.join(__dirname, '..', 'bot', 'src', 'firebase.js'));
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

const B = require(path.join(__dirname, '..', 'bot', 'src', 'backup.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Banco de exemplo cobrindo os formatos que existem de verdade. */
function bancoCheio() {
  return {
    'pautas':             { 'pauta-a': { nome: 'Semana 1' }, 'pauta-b': { nome: 'Semana 2' } },
    'analises_pauta':     { 'PL-1-2026': { pk1: { texto: 'nota' } } },
    'prompts_analise':    { p1: { nome: 'Prompt' } },
    'ccjc-pautas':        { 'ccjc-1': { itens: [] } },
    'congresso_pautas':   { p_1: { nome: 'Sessão' } },
    'congresso_pautas_meta': { p_1: { totalVetos: 59 } },
    'vetos_resumos':      { '1-2026': { resumo: 'x' } },
    'lideres-reunioes':   { 'lid-1': { titulo: 'Lista de 11/08/2026' } },
    'lideres-demandas':   { 'dem-1': { chave: 'RCP 2/2026' } },
    'lideres_instrucoes': 'Destaque sempre o impacto fiscal.',   // ESCALAR (string)
    'comissoes-podemos':  { c1: { sigla: 'CCJC' } },
    'deputados':          { cam_1: { nome: 'Fulano' } },
    'deputados_interesse': { d1: { temas: ['saúde'] } },
    'sessoes':            { s1: { data: '2026-08-11' } },
    'bot':                { monitor_cosev: { quorumSessao: 149 } },
    'aderencia-cache':    { x: 1 },        // NÃO deve ser copiado
    'app_versao_atual':   '3.2.3',         // NÃO deve ser copiado
  };
}

(async () => {
  console.log('== cobertura dos nós ==');
  ok(B.NOS.length === 15, `15 nós na lista (obtidos: ${B.NOS.length})`);
  for (const n of ['/pautas', '/analises_pauta', '/ccjc-pautas', '/vetos_resumos',
                   '/lideres-reunioes', '/lideres-demandas', '/congresso_pautas'])
    ok(B.NOS.includes(n), `cobre ${n}`);
  ok(!B.NOS.includes('/aderencia-cache'), 'NÃO copia o cache de aderência (regenerável, 1,6 MB)');
  ok(!B.NOS.includes('/app_versao_atual'), 'NÃO copia a versão (repor versão velha daria banner errado)');

  console.log('\n== snapshot ==');
  BANCO = bancoCheio();
  const r1 = await B.fazerBackup();
  ok(r1.arquivo && r1.arquivo.endsWith('.json.gz'), `arquivo comprimido (${r1.arquivo})`);
  ok(r1.total === 16, `16 registros no total (obtidos: ${r1.total})`);
  ok(r1.contagem['/lideres_instrucoes'] === 1, 'nó escalar conta como 1 registro');
  ok(r1.contagem['/pautas'] === 2, 'nó de objeto conta as chaves');
  const tam = fs.statSync(path.join(SANDBOX, 'backups', r1.arquivo)).size;
  ok(tam > 0 && tam < 4000, `gzip mantém o arquivo pequeno (${tam} bytes)`);

  console.log('\n== listagem ==');
  const lista = B.listarBackups();
  ok(lista.length === 1 && lista[0].registros === 16, 'lista lê o total do NOME do arquivo (sem abrir)');
  ok(!lista[0].formatoAntigo, 'snapshot novo não é marcado como antigo');
  // compatibilidade com os arquivos antigos, que só tinham pautas e análises
  fs.writeFileSync(path.join(SANDBOX, 'backups', 'backup-2026-07-01-10-00-00--p12-a37.json'), '{}');
  const listaMista = B.listarBackups();
  const antigo = listaMista.find(b => b.formatoAntigo);
  ok(antigo && antigo.registros === 49, 'entende o nome do formato antigo (12p + 37a = 49)');
  ok(listaMista[0].registros === 16, 'mais recente primeiro, mesmo com formatos misturados');

  console.log('\n== restauração do banco ZERADO ==');
  BANCO = {};
  const r2 = await B.restaurarFaltantes(r1.arquivo);
  ok(r2.total === 16, `repôs os 16 registros (obtidos: ${r2.total})`);
  ok(JSON.stringify(BANCO['lideres-demandas']) === JSON.stringify({ 'dem-1': { chave: 'RCP 2/2026' } }),
     'demandas de deputados voltaram');
  ok(BANCO['lideres_instrucoes'] === 'Destaque sempre o impacto fiscal.', 'nó ESCALAR voltou como string, não caractere a caractere');
  ok(BANCO['ccjc-pautas'] && BANCO['vetos_resumos'] && BANCO['congresso_pautas'], 'CCJC, vetos e Congresso voltaram');
  ok(BANCO['aderencia-cache'] === undefined, 'o cache não foi reposto (não estava no snapshot)');
  ok(BANCO['app_versao_atual'] === undefined, 'a versão não foi reposta');

  console.log('\n== restauração é NÃO-DESTRUTIVA ==');
  BANCO = bancoCheio();
  BANCO['pautas']['pauta-a'] = { nome: 'Semana 1 EDITADA pela equipe' };
  delete BANCO['pautas']['pauta-b'];
  BANCO['lideres_instrucoes'] = 'instrução nova';
  const r3 = await B.restaurarFaltantes(r1.arquivo);
  ok(BANCO['pautas']['pauta-a'].nome === 'Semana 1 EDITADA pela equipe', 'NÃO sobrescreve o que existe (edição da equipe intacta)');
  ok(BANCO['pautas']['pauta-b'].nome === 'Semana 2', 'repõe só o que faltava');
  ok(BANCO['lideres_instrucoes'] === 'instrução nova', 'escalar preenchido não é sobrescrito');
  ok(r3.total === 1 && r3.porNo['/pautas'].repostos === 1, `só 1 reposição (obtida: ${r3.total})`);
  ok(r3.jaExistiam === 15, `15 já existiam (obtidos: ${r3.jaExistiam})`);

  console.log('\n== proteção contra "backup do vazio" ==');
  BANCO = {};
  const r4 = await B.fazerBackup();
  ok(r4.ignorado === true, 'banco vazio → snapshot IGNORADO (não grava por cima do bom)');
  ok(r4.referencia.registros === 16, 'aponta o último backup bom como referência');
  ok(B.listarBackups().filter(b => !b.formatoAntigo).length === 1, 'nenhum snapshot vazio foi gravado');

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
