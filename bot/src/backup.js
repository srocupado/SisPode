'use strict';
// Rede de segurança contra perda de dados no Firebase (regras abertas: qualquer
// aba/dispositivo pode sobrescrever/apagar). O bot roda 24h, então tira
// snapshots LOCAIS do banco — em disco, fora do banco compartilhado, imunes a
// quem apaga o Firebase. Restauração é NÃO-destrutiva: só repõe o que está
// FALTANDO, nunca sobrescreve o que existe.
//
// COBERTURA: até 11/08/2026 o backup cobria só /pautas e /analises_pauta — o
// que fazia sentido quando a extensão era essencialmente o módulo de Plenário.
// MEDIDO naquele dia: isso protegia 332 KB de 3,5 MB, ou 9% dos dados. Hoje
// cobre todos os nós de trabalho da equipe (NOS, abaixo).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { fbGet, fbPut } = require('./firebase');
const { DADOS_DIR } = require('./config');

const BACKUP_DIR = path.join(DADOS_DIR, 'backups');
const MANTER = 60;                 // guarda os últimos 60 snapshots

// Todo dado produzido pela equipe, na extensão ou no bot.
const NOS = [
  // Plenário
  '/pautas', '/analises_pauta', '/prompts_analise',
  // CCJC
  '/ccjc-pautas',
  // Congresso Nacional (vetos e PLNs)
  '/congresso_pautas', '/congresso_pautas_meta', '/vetos_resumos',
  // Reunião de Líderes (os três sistemas)
  '/lideres-reunioes', '/lideres-demandas', '/lideres_instrucoes',
  // Cadastros e contexto compartilhados
  '/comissoes-podemos', '/deputados', '/deputados_interesse',
  // Sessões e estado do bot (assinantes do digest, calibração do monitor)
  '/sessoes', '/bot',
];
// DE FORA, por decisão:
//   /aderencia-cache  — CACHE derivado das votações (1,6 MB): regenera sozinho
//                       e triplicaria cada snapshot sem proteger nada.
//   /app_versao_atual — operacional; repor uma versão velha faria a extensão
//                       anunciar atualização errada para a equipe.

const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const carimbo  = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()).replace(/[: ]/g, '-');

function garantirDir() { fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Registros de um nó: chaves, se for objeto; 1 se for escalar preenchido
 *  (/lideres_instrucoes é uma string); 0 se vazio. */
function contarRegistros(v) {
  if (ehObjeto(v)) return Object.keys(v).length;
  if (Array.isArray(v)) return v.length;
  return (v === null || v === undefined || v === '') ? 0 : 1;
}

/**
 * Snapshot de todos os NOS num arquivo local comprimido. O total de registros
 * vai no NOME (leitura da lista sem abrir os arquivos); a contagem por nó vai
 * DENTRO. Retorna { arquivo, total, contagem } ou { ignorado, ... }.
 */
async function fazerBackup() {
  garantirDir();
  const snap = { geradoEm: new Date().toISOString(), versao: 2 };
  const contagem = {};
  for (const no of NOS) {
    const v = await fbGet(no).catch(() => null);
    snap[no] = v === undefined ? null : v;
    contagem[no] = contarRegistros(v);
  }
  snap.contagem = contagem;
  const total = Object.values(contagem).reduce((a, b) => a + b, 0);

  // Proteção contra "backup do vazio": se o banco veio vazio mas o último
  // snapshot tinha dados, NÃO sobrescreve — evita gravar um snapshot inútil
  // por cima de um bom logo após uma perda.
  const ultimo = ultimoBackup();
  if (ultimo && total === 0 && ultimo.registros > 0) {
    console.warn('[backup] banco veio vazio — snapshot ignorado (mantido o anterior)');
    return { ignorado: true, total, contagem, referencia: ultimo };
  }

  // Comprimido: com todos os nós o snapshot passa de ~330 KB para ~3,5 MB, e
  // 60 deles ocupariam 210 MB do disco da máquina do bot. Gzip devolve ~10×.
  const nome = `backup-${carimbo()}--n${total}.json.gz`;
  fs.writeFileSync(path.join(BACKUP_DIR, nome), zlib.gzipSync(JSON.stringify(snap)));
  podar();
  console.log(`[backup] ${nome} (${total} registros em ${NOS.length} nós)`);
  return { arquivo: nome, total, contagem };
}

function listarArquivos() {
  garantirDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && (f.endsWith('.json') || f.endsWith('.json.gz')))
    .sort();   // carimbo YYYY-MM-DD-HH-MM-SS ordena cronologicamente por string
}

function podar() {
  const arqs = listarArquivos();
  for (const f of arqs.slice(0, Math.max(0, arqs.length - MANTER))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {}
  }
}

/** Lê o total do NOME do arquivo — sem abrir o disco. Entende o formato antigo
 *  (--p12-a37.json, só pautas/análises) e o novo (--n1234.json.gz). */
function dadosDoNome(nome) {
  const novo = nome.match(/^backup-(.+?)--n(\d+)\.json(?:\.gz)?$/);
  if (novo) return { nome, quando: novo[1], registros: +novo[2] };
  const velho = nome.match(/^backup-(.+?)--p(\d+)-a(\d+)\.json(?:\.gz)?$/);
  if (velho) return { nome, quando: velho[1], registros: +velho[2] + +velho[3], formatoAntigo: true };
  return { nome, quando: '', registros: 0 };
}

function ultimoBackup() {
  const arqs = listarArquivos();
  if (!arqs.length) return null;
  return dadosDoNome(arqs[arqs.length - 1]);
}

function carregarSnap(nome) {
  const alvo = nome || listarArquivos().slice(-1)[0];
  if (!alvo) return null;
  const arquivo = path.join(BACKUP_DIR, alvo);
  if (!fs.existsSync(arquivo)) return null;
  try {
    const bruto = fs.readFileSync(arquivo);
    return JSON.parse(alvo.endsWith('.gz') ? zlib.gunzipSync(bruto) : bruto.toString('utf8'));
  } catch (_) { return null; }
}

/** Lista os backups (nome + total + data) para o /backups do Telegram. */
function listarBackups() {
  return listarArquivos().map(dadosDoNome).reverse();   // mais recente primeiro
}

/**
 * Restauração NÃO-DESTRUTIVA: repõe no Firebase apenas os registros que estão
 * FALTANDO agora (compara com o estado atual), nó a nó. Nunca sobrescreve o
 * que existe — então restaurar é sempre seguro, mesmo com trabalho novo no
 * banco. Retorna { total, jaExistiam, porNo: { '/pautas': {repostos, ja} } }.
 */
async function restaurarFaltantes(nome) {
  const snap = carregarSnap(nome);
  if (!snap) throw new Error('backup não encontrado');

  const porNo = {};
  let total = 0, jaExistiam = 0;

  for (const no of NOS) {
    const doSnap = snap[no];
    if (doSnap === null || doSnap === undefined) continue;   // nó ausente no snapshot
    const atual = await fbGet(no).catch(() => null);
    const repostos = [];
    let ja = 0;

    if (ehObjeto(doSnap)) {
      const at = ehObjeto(atual) ? atual : {};
      for (const [k, v] of Object.entries(doSnap)) {
        if (at[k] !== undefined && at[k] !== null) { ja++; continue; }
        await fbPut(`${no}/${encodeURIComponent(k)}`, v);
        repostos.push(k);
      }
    } else {
      // Escalar (ex.: /lideres_instrucoes): repõe só se não houver NADA hoje.
      if (atual === null || atual === undefined || atual === '') {
        await fbPut(no, doSnap);
        repostos.push(no);
      } else { ja++; }
    }

    if (repostos.length || ja) porNo[no] = { repostos: repostos.length, ja, exemplos: repostos.slice(0, 3) };
    total += repostos.length;
    jaExistiam += ja;
  }
  return { total, jaExistiam, porNo };
}

module.exports = { fazerBackup, listarBackups, restaurarFaltantes, ultimoBackup, hojeISO, NOS };
