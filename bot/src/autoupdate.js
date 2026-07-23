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

const REPO = process.env.GH_REPO || 'srocupado/SisPode';
const BRANCH = process.env.GH_BRANCH || 'main';
const TOKEN = process.env.GH_TOKEN || '';
const API = 'https://api.github.com';
const BOT_DIR = path.resolve(__dirname, '..');           // .../bot
const VERSAO_JSON = path.join(BOT_DIR, 'dados', 'versao-bot.json');

async function gh(caminho, { raw = false } = {}) {
  const r = await fetch(`${API}${caminho}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SisPodeBot-update',
    },
  });
  if (!r.ok) {
    const dica = r.status === 401 ? ' (GH_TOKEN inválido/expirado?)'
      : r.status === 403 ? ' (sem permissão ou rate limit)'
      : r.status === 404 ? ' (repo/arquivo não encontrado ou token sem acesso a ele)' : '';
    throw new Error(`GitHub ${r.status}${dica}`);
  }
  return raw ? r.text() : r.json();
}

async function commitMain() {
  const c = await gh(`/repos/${REPO}/commits/${BRANCH}`);
  return { sha: c.sha, msg: (c.commit?.message || '').split('\n')[0], data: c.commit?.committer?.date || null };
}

// index.js + package.json + todos os src/*.js do main.
async function listarArquivos() {
  const src = await gh(`/repos/${REPO}/contents/bot/src?ref=${BRANCH}`);
  if (!Array.isArray(src)) throw new Error('não consegui listar bot/src');
  return [
    { repo: 'bot/index.js', local: 'index.js' },
    { repo: 'bot/package.json', local: 'package.json' },
    ...src.filter(f => f.type === 'file' && f.name.endsWith('.js'))
          .map(f => ({ repo: `bot/src/${f.name}`, local: path.join('src', f.name) })),
  ];
}

function nodeCheck(arquivo) {
  return new Promise(res => {
    execFile(process.execPath, ['--check', arquivo], (err, _o, se) => res(err ? (se || err.message).trim() : null));
  });
}

/**
 * Baixa o main, valida e sobrescreve. Nada é escrito nos arquivos reais até
 * TODOS baixarem e passarem no node --check.
 * @returns {Promise<{ok:boolean, erro?, sha?, msg?, arquivos?, pkgMudou?}>}
 */
async function aplicarUpdate() {
  if (!TOKEN) return { ok: false, erro: 'GH_TOKEN não configurado no .env' };
  const { sha, msg } = await commitMain();
  const lista = await listarArquivos();

  // 1) baixa TUDO para memória (falha aqui = nada foi escrito)
  const baixados = [];
  for (const a of lista) baixados.push({ ...a, conteudo: await gh(`/repos/${REPO}/contents/${a.repo}?ref=${BRANCH}`, { raw: true }) });

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

  // 5) marca a versão aplicada
  try {
    await fsp.mkdir(path.dirname(VERSAO_JSON), { recursive: true });
    await fsp.writeFile(VERSAO_JSON, JSON.stringify({ sha, msg, em: new Date().toISOString() }, null, 2));
  } catch (_) {}

  return { ok: true, sha, msg, arquivos: baixados.map(b => b.local), pkgMudou };
}

async function statusUpdate() {
  const m = await commitMain();
  let local = null;
  try { local = JSON.parse(await fsp.readFile(VERSAO_JSON, 'utf8')); } catch (_) {}
  return { main: m, local, atualizado: !!(local && local.sha === m.sha) };
}

module.exports = { aplicarUpdate, statusUpdate, REPO, BRANCH };
