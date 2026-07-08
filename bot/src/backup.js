'use strict';
// Rede de segurança contra perda de dados no Firebase (regras abertas: qualquer
// aba/dispositivo pode sobrescrever/apagar). O bot roda 24h, então tira
// snapshots LOCAIS de /pautas e /analises_pauta — em disco, fora do banco
// compartilhado, imunes a quem apaga o Firebase. Restauração é NÃO-destrutiva:
// só repõe o que está FALTANDO, nunca sobrescreve o que existe.
const fs = require('fs');
const path = require('path');
const { fbGet, fbPut } = require('./firebase');
const { DADOS_DIR } = require('./config');

const BACKUP_DIR = path.join(DADOS_DIR, 'backups');
const MANTER = 60;                 // guarda os últimos 60 snapshots
const NOS = ['/pautas', '/analises_pauta'];

const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const carimbo  = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()).replace(/[: ]/g, '-');

function garantirDir() { fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

function contarChaves(obj) { return obj && typeof obj === 'object' ? Object.keys(obj).length : 0; }

/**
 * Tira um snapshot de /pautas e /analises_pauta para um arquivo local.
 * Anexa a contagem no nome para leitura rápida. Retorna { arquivo, pautas, analises }.
 */
async function fazerBackup() {
  garantirDir();
  const snap = { geradoEm: new Date().toISOString() };
  for (const no of NOS) snap[no] = await fbGet(no).catch(() => null);

  const pautas   = contarChaves(snap['/pautas']);
  const analises = contarChaves(snap['/analises_pauta']);

  // Proteção contra "backup do vazio": se o banco veio vazio mas o último
  // snapshot tinha dados, NÃO sobrescreve — evita gravar um snapshot inútil
  // por cima de um bom logo após uma perda.
  const ultimo = ultimoBackup();
  if (ultimo && pautas === 0 && analises === 0 && (ultimo.pautas > 0 || ultimo.analises > 0)) {
    console.warn('[backup] banco veio vazio — snapshot ignorado (mantido o anterior)');
    return { ignorado: true, pautas, analises, referencia: ultimo };
  }

  const nome = `backup-${carimbo()}--p${pautas}-a${analises}.json`;
  const arquivo = path.join(BACKUP_DIR, nome);
  fs.writeFileSync(arquivo, JSON.stringify(snap));
  podar();
  console.log(`[backup] ${nome} (${pautas} pautas, ${analises} análises)`);
  return { arquivo: nome, pautas, analises };
}

function listarArquivos() {
  garantirDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
    .sort();   // carimbo YYYY-MM-DD-HH-MM-SS ordena cronologicamente por string
}

function podar() {
  const arqs = listarArquivos();
  for (const f of arqs.slice(0, Math.max(0, arqs.length - MANTER))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {}
  }
}

// Lê o cabeçalho (contagens) do backup mais recente sem carregar tudo do disco.
function ultimoBackup() {
  const arqs = listarArquivos();
  if (!arqs.length) return null;
  const nome = arqs[arqs.length - 1];
  const m = nome.match(/--p(\d+)-a(\d+)\.json$/);
  return { nome, pautas: m ? +m[1] : 0, analises: m ? +m[2] : 0 };
}

function carregarSnap(nome) {
  const arquivo = nome
    ? path.join(BACKUP_DIR, nome)
    : path.join(BACKUP_DIR, listarArquivos().slice(-1)[0] || '');
  if (!arquivo || !fs.existsSync(arquivo)) return null;
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (_) { return null; }
}

/** Lista os backups (nome + contagens + data) para o /backups do Telegram. */
function listarBackups() {
  return listarArquivos().map(nome => {
    const m = nome.match(/^backup-(.+?)--p(\d+)-a(\d+)\.json$/);
    return { nome, quando: m ? m[1] : '', pautas: m ? +m[2] : 0, analises: m ? +m[3] : 0 };
  }).reverse();   // mais recente primeiro
}

/**
 * Restauração NÃO-DESTRUTIVA: repõe no Firebase apenas as pautas/análises que
 * estão FALTANDO agora (compara com o estado atual). Nunca sobrescreve o que
 * existe — então restaurar é sempre seguro, mesmo com trabalho novo no banco.
 * Retorna { pautas:[repostas], analises:[repostas], jaExistiam:{...} }.
 */
async function restaurarFaltantes(nome) {
  const snap = carregarSnap(nome);
  if (!snap) throw new Error('backup não encontrado');

  const repostos = { pautas: [], analises: [], jaPautas: 0, jaAnalises: 0 };
  const atualPautas   = await fbGet('/pautas').catch(() => ({})) || {};
  const atualAnalises = await fbGet('/analises_pauta').catch(() => ({})) || {};

  for (const [id, doc] of Object.entries(snap['/pautas'] || {})) {
    if (atualPautas[id]) { repostos.jaPautas++; continue; }
    await fbPut(`/pautas/${encodeURIComponent(id)}`, doc);
    repostos.pautas.push(id);
  }
  for (const [chave, node] of Object.entries(snap['/analises_pauta'] || {})) {
    if (atualAnalises[chave]) { repostos.jaAnalises++; continue; }
    await fbPut(`/analises_pauta/${encodeURIComponent(chave)}`, node);
    repostos.analises.push(chave);
  }
  return repostos;
}

module.exports = { fazerBackup, listarBackups, restaurarFaltantes, ultimoBackup, hojeISO };
