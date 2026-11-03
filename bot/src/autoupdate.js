'use strict';
// AUTO-ATUALIZAÇÃO do bot pelo GitHub (comando /update, admin).
//
// A máquina do bot roda arquivos COPIADOS (não é um clone git) e sem acesso de
// admin. Então, em vez de `git pull`, baixamos os arquivos do branch `main`
// direto pela API do GitHub (token de leitura em GH_TOKEN) e sobrescrevemos em
// disco. Fluxo SEGURO: baixa tudo para memória → grava em staging → `node
// --check` em cada .js → só então sobrescreve os arquivos reais. Erro de
// sintaxe = aborta e NÃO toca no que está rodando (o bot continua na versão
// atual). O restart em si é do supervisor externo (iniciar-bot.bat em loop):
// o /update encerra o processo e o loop sobe com o código novo.

const path = require('path');
const fsp = require('fs').promises;
const { execFile } = require('child_process');
const crypto = require('crypto');

// Rede corporativa/gov costuma ter IPv6 quebrado: o navegador cai para IPv4
// sozinho (Happy Eyeballs), mas o fetch do Node tenta IPv6 e estoura em
// "fetch failed". Preferir IPv4 resolve — vale para TODAS as chamadas do bot
// (este módulo é carregado no arranque pelo index.js).
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) {}

// Extrai a causa REAL de um erro de fetch (que só diz "fetch failed").
function causaRede(e) {
  const c = e && e.cause;
  return (c && (c.code || c.message)) || e.message || 'erro de rede';
}

const REPO = process.env.GH_REPO || 'srocupado/SisPode';
const BRANCH = process.env.GH_BRANCH || 'main';
const TOKEN = process.env.GH_TOKEN || '';
const API = 'https://api.github.com';
const BOT_DIR = path.resolve(__dirname, '..');           // .../bot
const VERSAO_JSON = path.join(BOT_DIR, 'dados', 'versao-bot.json');
// Pasta da EXTENSÃO que o bot roda no navegador interno (worker.js): a mesma regra
// de lá — BOT_EXT_DIR no .env ou a pasta-mãe da pasta do bot.
const EXT_DIR = path.resolve(process.env.BOT_EXT_DIR || path.join(BOT_DIR, '..'));
// O que no repositório NÃO é a extensão (o bot vem pela lista própria).
const FORA_DA_EXTENSAO = /^(bot|testes|varredura|docs|\.github|\.claude)\/|^(README\.md|\.gitignore)$/;

async function gh(caminho, { raw = false } = {}) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SisPodeBot-update',
  };
  // Retry com backoff: rede instável (fetch failed) e 429/5xx tentam de novo;
  // 401/403/404 são permanentes e falham na hora.
  const esperas = [0, 1500, 4000, 8000];
  let ultimo = null;
  for (let i = 0; i < esperas.length; i++) {
    if (esperas[i]) await new Promise(r => setTimeout(r, esperas[i]));
    let r;
    try { r = await fetch(`${API}${caminho}`, { headers }); }
    catch (e) { ultimo = new Error(`rede: ${causaRede(e)}`); continue; }   // falha de rede → repete (com a causa real)
    if (r.ok) return raw ? r.text() : r.json();
    if (r.status === 429 || (r.status >= 500 && r.status < 600)) { ultimo = new Error(`GitHub ${r.status}`); continue; }
    const dica = r.status === 401 ? ' (GH_TOKEN inválido/expirado?)'
      : r.status === 403 ? ' (sem permissão ou rate limit)'
      : r.status === 404 ? ' (repo/arquivo não encontrado ou token sem acesso a ele)' : '';
    throw new Error(`GitHub ${r.status}${dica}`);
  }
  throw ultimo || new Error('fetch failed (rede indisponível após tentativas)');
}

async function commitMain() {
  const c = await gh(`/repos/${REPO}/commits/${BRANCH}`);
  return { sha: c.sha, msg: (c.commit?.message || '').split('\n')[0], data: c.commit?.committer?.date || null, tree: c.commit?.tree?.sha || c.sha };
}

// index.js + package.json + todos os src/*.js do main + o parser da pauta,
// que fica na RAIZ do repositório (bot/src/parser.js o lê de ../../pauta-parser.js:
// a correção de um formato novo da pauta da Câmara chega ao bot pelo mesmo /update).
// Antes de 03/11/2026 o parser ficava de fora e o bot seguia com o antigo.
async function listarArquivos() {
  const src = await gh(`/repos/${REPO}/contents/bot/src?ref=${BRANCH}`);
  if (!Array.isArray(src)) throw new Error('não consegui listar bot/src');
  return [
    { repo: 'bot/index.js', local: 'index.js' },
    { repo: 'bot/package.json', local: 'package.json' },
    ...src.filter(f => f.type === 'file' && f.name.endsWith('.js'))
          .map(f => ({ repo: `bot/src/${f.name}`, local: path.join('src', f.name) })),
    { repo: 'pauta-parser.js', local: path.join('..', 'pauta-parser.js') },
  ];
}

/** O "blob sha" do git de um conteúdo — compara o arquivo local com o do commit sem baixá-lo. */
function blobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/**
 * Os arquivos da EXTENSÃO que mudaram no commit (worker.js roda a extensão
 * inteira — análises, PDF da pauta —, e antes de 03/11/2026 o /update não a
 * tocava: o bot gerava notas com o analise.js de quando a pasta foi copiada).
 * Uma chamada lista a árvore; só vai para o download o que difere do disco.
 * Sem manifest.json na pasta, a extensão não está ali: não grava nada.
 * arvore: [{ path, type, sha }] (git/trees recursivo); ignorar: destinos que a lista do bot já grava.
 */
async function planoExtensao(arvore, ignorar = new Set(), dir = EXT_DIR) {
  try { await fsp.access(path.join(dir, 'manifest.json')); }
  catch (_) { return { dir, ausente: true, mudados: [] }; }
  const mudados = [];
  for (const e of arvore) {
    if (e.type !== 'blob' || FORA_DA_EXTENSAO.test(e.path)) continue;
    const destino = path.join(dir, ...e.path.split('/'));
    if (ignorar.has(destino)) continue;
    let local = null;
    try { local = blobSha(await fsp.readFile(destino)); } catch (_) {}
    if (local !== e.sha) mudados.push({ repo: e.path, destino, blob: e.sha });
  }
  return { dir, ausente: false, mudados };
}

/**
 * Essa sha já foi aplicada COM todos os arquivos da lista? A versão gravada
 * guarda a lista aplicada: quando a lista cresce (o parser da raiz entrou), o
 * mesmo commit é baixado de novo para trazer o que faltou — sem isso, o /update
 * seguinte ao que trouxe o código novo responderia "já atualizado".
 */
function jaAplicado(local, sha, lista) {
  if (!local || local.sha !== sha || !local.extensao) return false;   // extensão: só a partir de 03/11/2026
  const feitos = new Set(local.arquivos || []);
  return lista.every(a => feitos.has(a.local.replace(/\\/g, '/')));
}

function nodeCheck(arquivo) {
  return new Promise(res => {
    execFile(process.execPath, ['--check', arquivo], (err, _o, se) => res(err ? (se || err.message).trim() : null));
  });
}

/**
 * Baixa o main, valida e sobrescreve. Nada é escrito nos arquivos reais até
 * TODOS baixarem e passarem no node --check. Se a sha pedida já é a sha local
 * (idempotência — ver comentário abaixo), não baixa nada: devolve
 * `jaAtualizado: true` direto.
 * @returns {Promise<{ok:boolean, erro?, sha?, msg?, arquivos?, pkgMudou?, jaAtualizado?}>}
 */
async function aplicarUpdate() {
  if (!TOKEN) return { ok: false, erro: 'GH_TOKEN não configurado no .env' };
  const { sha, msg, tree } = await commitMain();

  // Idempotência: já está nessa sha? Não baixa nem reinicia de novo.
  // Sem isso, um /update REENTREGUE pelo Telegram (o long-polling reenvia a
  // mensagem se o processo sair antes de confirmar o offset — sempre um
  // risco num restart abrupto) reinicia o bot pra sempre: cada boot reprocessa
  // o /update de novo, e o bot nunca sobra vivo tempo suficiente pra atender
  // o que vier depois dele na fila. Aqui é a segunda camada de defesa (a
  // primeira é bot.stop() no lugar de process.exit() cru, em index.js).
  let local = null;
  try { local = JSON.parse(await fsp.readFile(VERSAO_JSON, 'utf8')); } catch (_) {}
  const lista = await listarArquivos();
  if (jaAplicado(local, sha, lista)) return { ok: true, jaAtualizado: true, sha, msg };

  // 1) baixa TUDO para memória (falha aqui = nada foi escrito)
  const baixados = [];
  for (const a of lista) baixados.push({ ...a, conteudo: await gh(`/repos/${REPO}/contents/${a.repo}?ref=${BRANCH}`, { raw: true }) });
  // a extensão: só o que mudou, pelo blob (base64 — ícones e PNGs não podem passar por texto)
  const arv = await gh(`/repos/${REPO}/git/trees/${tree}?recursive=1`);
  if (arv.truncated) return { ok: false, erro: 'a árvore do repositório veio truncada pelo GitHub' };
  const ext = await planoExtensao(arv.tree || [], new Set(lista.map(a => path.resolve(BOT_DIR, a.local))));
  for (const a of ext.mudados) {
    const b = await gh(`/repos/${REPO}/git/blobs/${a.blob}`);
    a.conteudo = Buffer.from(b.content || '', b.encoding === 'base64' ? 'base64' : 'utf8');
    if (blobSha(a.conteudo) !== a.blob) return { ok: false, erro: `download incompleto de ${a.repo}` };
  }

  // 2) staging + node --check
  const stage = path.join(BOT_DIR, '.update-stage');
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });
  try {
    for (const a of baixados) {
      if (!a.local.endsWith('.js')) continue;
      const sp = path.join(stage, a.local.replace(/[\\/]/g, '__'));
      await fsp.writeFile(sp, a.conteudo);
      const erro = await nodeCheck(sp);
      if (erro) return { ok: false, erro: `sintaxe em ${a.local}: ${erro.split('\n')[0]}` };
    }
    for (const a of ext.mudados) {
      if (!a.repo.endsWith('.js')) continue;
      const sp = path.join(stage, 'ext__' + a.repo.replace(/[\\/]/g, '__'));
      await fsp.writeFile(sp, a.conteudo);
      const erro = await nodeCheck(sp);
      if (erro) return { ok: false, erro: `sintaxe em ${a.repo} (extensão): ${erro.split('\n')[0]}` };
    }
  } finally { await fsp.rm(stage, { recursive: true, force: true }).catch(() => {}); }

  // 3) as DEPENDÊNCIAS mudaram? (compara os mapas parseados, não o texto —
  // evita falso positivo por quebra de linha CRLF/LF ou formatação)
  let pkgMudou = false;
  try {
    const atual = JSON.parse(await fsp.readFile(path.join(BOT_DIR, 'package.json'), 'utf8').catch(() => '{}') || '{}');
    const novo = JSON.parse(baixados.find(b => b.local === 'package.json')?.conteudo || '{}');
    const eq = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
    pkgMudou = !eq(atual.dependencies, novo.dependencies) || !eq(atual.devDependencies, novo.devDependencies);
  } catch (_) {}

  // 4) aplica (tudo validado)
  await fsp.mkdir(path.join(BOT_DIR, 'src'), { recursive: true });
  for (const a of baixados) await fsp.writeFile(path.join(BOT_DIR, a.local), a.conteudo);
  for (const a of ext.mudados) {
    await fsp.mkdir(path.dirname(a.destino), { recursive: true });
    await fsp.writeFile(a.destino, a.conteudo);
  }

  // 5) marca a versão aplicada
  try {
    await fsp.mkdir(path.dirname(VERSAO_JSON), { recursive: true });
    await fsp.writeFile(VERSAO_JSON, JSON.stringify({ sha, msg, em: new Date().toISOString(),
      arquivos: baixados.map(b => b.local.replace(/\\/g, '/')),
      extensao: ext.ausente ? { ausente: true, dir: ext.dir } : { dir: ext.dir, gravados: ext.mudados.length } }, null, 2));
  } catch (_) {}

  return { ok: true, sha, msg, arquivos: baixados.map(b => b.local), pkgMudou,
    extensao: { dir: ext.dir, ausente: ext.ausente, gravados: ext.mudados.map(a => a.repo) } };
}

async function statusUpdate() {
  const m = await commitMain();
  let local = null;
  try { local = JSON.parse(await fsp.readFile(VERSAO_JSON, 'utf8')); } catch (_) {}
  return { main: m, local, atualizado: !!(local && local.sha === m.sha) };
}

module.exports = { aplicarUpdate, statusUpdate, jaAplicado, planoExtensao, blobSha, FORA_DA_EXTENSAO, REPO, BRANCH };
