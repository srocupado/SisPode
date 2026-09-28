'use strict';
// Labs · Mapa Territorial — coleta server-side (comando /labsmapa, admin).
//
// O navegador não baixa o arquivo do TSE (centenas de MB, sem CORS); o bot
// baixa. Fluxo:
//   1. bancada do PODE hoje, com nome civil (API da Câmara);
//   2. baixa votacao_candidato_munzona_{ano}.zip do CDN do TSE para um arquivo
//      temporário e lê SÓ os CSV dos estados da bancada, direto de dentro do zip
//      (leitor mínimo abaixo — sem dependência nova), linha a linha;
//   3. agrega com o núcleo compartilhado com a extensão (labs-mapa-nucleo.js,
//      na raiz — mesmo padrão de pauta-parser.js), casa município TSE → IBGE;
//   4. com TRANSPARENCIA_CHAVE, agrega as emendas pagas (ano anterior e atual);
//   5. grava em /labs/mapa/{ano} e /labs/mapa/emendas/{ano} — o mesmo formato
//      que a extensão grava no processamento manual.
//
// O núcleo é carregado só na hora do comando: o /update baixa bot/src, não a
// raiz; se o arquivo da raiz faltar, o comando avisa em vez de derrubar o bot.

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { fbGet, fbPut, fbPatch } = require('./firebase');
const { TRANSPARENCIA_CHAVE } = require('./config');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
const TRANSP = 'https://api.portaldatransparencia.gov.br/api-de-dados';
const EXT_DIR = process.env.BOT_EXT_DIR || path.join(__dirname, '..', '..');

function urlTse(ano) {
  return `https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`;
}

function nucleo() {
  const arq = path.join(EXT_DIR, 'labs-mapa-nucleo.js');
  try { return require(arq); }
  catch (e) {
    throw new Error(`não encontrei ${arq} — copie os arquivos atuais da extensão para a máquina do bot (o /update só atualiza bot/src).`);
  }
}

async function json(url, headers) {
  let ultimo;
  for (let t = 0; t < 3; t++) {
    if (t) await new Promise(r => setTimeout(r, 1000 * t));
    try {
      const r = await fetch(url, { headers: Object.assign({ Accept: 'application/json' }, headers || {}) });
      if (r.ok) return r.json();
      ultimo = new Error(`HTTP ${r.status} em ${url}`);
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) { ultimo = e; }
  }
  throw ultimo;
}

// ---------- leitor mínimo de ZIP (diretório central + inflate) ----------
async function lerTrecho(fh, pos, n) {
  const b = Buffer.alloc(n);
  const { bytesRead } = await fh.read(b, 0, n, pos);
  return b.subarray(0, bytesRead);
}

/**
 * Entradas do zip: [{ nome, metodo, comprimido, tamanho, offsetLocal }].
 * Suporta ZIP64 (arquivos e deslocamentos acima de 4 GB).
 */
async function entradasZip(arquivo) {
  const fh = await fsp.open(arquivo, 'r');
  try {
    const { size } = await fh.stat();
    const cauda = await lerTrecho(fh, Math.max(0, size - 65557), Math.min(size, 65557));
    let eocd = -1;
    for (let i = cauda.length - 22; i >= 0; i--) if (cauda.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('arquivo não é um zip válido (fim do diretório não encontrado)');
    let total = cauda.readUInt16LE(eocd + 10);
    let tamCd = cauda.readUInt32LE(eocd + 12);
    let offCd = cauda.readUInt32LE(eocd + 16);
    if (offCd === 0xffffffff || tamCd === 0xffffffff || total === 0xffff) {
      const loc = eocd - 20;
      if (loc < 0 || cauda.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64 sem localizador');
      const off64 = Number(cauda.readBigUInt64LE(loc + 8));
      const e64 = await lerTrecho(fh, off64, 56);
      if (e64.readUInt32LE(0) !== 0x06064b50) throw new Error('zip64: registro de fim inválido');
      total = Number(e64.readBigUInt64LE(32));
      tamCd = Number(e64.readBigUInt64LE(40));
      offCd = Number(e64.readBigUInt64LE(48));
    }
    const cd = await lerTrecho(fh, offCd, tamCd);
    const out = [];
    let p = 0;
    for (let k = 0; k < total && p + 46 <= cd.length; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório central corrompido');
      const metodo = cd.readUInt16LE(p + 10);
      let comprimido = cd.readUInt32LE(p + 20);
      let tamanho = cd.readUInt32LE(p + 24);
      const nLen = cd.readUInt16LE(p + 28), xLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
      let offsetLocal = cd.readUInt32LE(p + 42);
      const nome = cd.subarray(p + 46, p + 46 + nLen).toString('utf8');
      // Campo extra ZIP64 (0x0001): traz, na ordem, só os valores que estouraram.
      let x = p + 46 + nLen;
      const fimX = x + xLen;
      while (x + 4 <= fimX) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (tamanho === 0xffffffff) { tamanho = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (comprimido === 0xffffffff) { comprimido = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offsetLocal === 0xffffffff) { offsetLocal = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        x += 4 + len;
      }
      out.push({ nome, metodo, comprimido, tamanho, offsetLocal });
      p += 46 + nLen + xLen + cLen;
    }
    return out;
  } finally { await fh.close(); }
}

/** Fluxo (Readable) com o conteúdo DESCOMPACTADO de uma entrada. */
async function fluxoEntrada(arquivo, e) {
  const fh = await fsp.open(arquivo, 'r');
  let cab;
  try { cab = await lerTrecho(fh, e.offsetLocal, 30); } finally { await fh.close(); }
  if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error(`cabeçalho local inválido em ${e.nome}`);
  const ini = e.offsetLocal + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
  const bruto = fs.createReadStream(arquivo, { start: ini, end: ini + e.comprimido - 1 });
  if (e.metodo === 0) return bruto;
  if (e.metodo !== 8) throw new Error(`método de compressão ${e.metodo} não suportado em ${e.nome}`);
  return bruto.pipe(zlib.createInflateRaw());
}

/** Lê uma entrada latin1 linha a linha. */
async function lerLinhasEntrada(arquivo, e, aoLer) {
  const { lmnLinhas } = nucleo();
  const lin = lmnLinhas(aoLer);
  const fluxo = await fluxoEntrada(arquivo, e);
  for await (const pedaco of fluxo) lin.empurrar(pedaco.toString('latin1'));   // latin1: 1 byte = 1 caractere, corte de pedaço é seguro
  lin.fim();
}

/** UF da entrada "…_munzona_2022_SP.csv" (null para BRASIL, leia-me etc.). */
function ufDaEntrada(nome) {
  const m = String(nome).match(/_([A-Z]{2})\.(csv|txt)$/i);
  return m && m[1].toUpperCase() !== 'BR' ? m[1].toUpperCase() : null;
}

// ---------- fontes ----------
async function bancadaPodemos() {
  const lista = (await json(`${API}/deputados?siglaPartido=PODE&ordem=ASC&ordenarPor=nome&itens=100`)).dados || [];
  const out = [];
  for (const d of lista) {
    let civil = '';
    try { civil = ((await json(`${API}/deputados/${d.id}`)).dados || {}).nomeCivil || ''; } catch (_) {}
    out.push({ id: String(d.id), nome: d.nome, uf: d.siglaUf, nomeCivil: civil });
  }
  return out;
}

const cacheIbge = {};
async function ibgeUf(uf) {
  if (!cacheIbge[uf]) cacheIbge[uf] = ((await json(`${IBGE}/${uf}/municipios`)) || []).map(m => ({ id: m.id, nome: m.nome }));
  return cacheIbge[uf];
}

async function baixar(url, destino, aoAndar) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SisPode bot)' } });
  if (!r.ok) throw new Error(`TSE respondeu HTTP ${r.status} ao baixar ${url}`);
  const total = Number(r.headers.get('content-length')) || 0;
  let lidos = 0, ultimoAviso = 0;
  const corpo = Readable.fromWeb(r.body);
  corpo.on('data', c => {
    lidos += c.length;
    if (aoAndar && lidos - ultimoAviso > 50e6) { ultimoAviso = lidos; aoAndar(`baixando ${Math.round(lidos / 1e6)} MB${total ? ' de ' + Math.round(total / 1e6) : ''}`); }
  });
  await pipeline(corpo, fs.createWriteStream(destino));
  return lidos;
}

async function emendasDoAutor(nome, ano) {
  const { lmnNomeAutor } = nucleo();
  const out = [];
  for (let pagina = 1; pagina <= 60; pagina++) {
    const lote = await json(`${TRANSP}/emendas?ano=${ano}&nomeAutor=${encodeURIComponent(lmnNomeAutor(nome))}&pagina=${pagina}`,
      { 'chave-api-dados': TRANSPARENCIA_CHAVE });
    if (!Array.isArray(lote) || !lote.length) break;
    out.push(...lote);
  }
  return out;
}

// ---------- orquestração ----------
/**
 * Processa a eleição `ano` (padrão 2022) e grava no banco.
 * Opções: arquivoZip (usa um zip já baixado em vez de baixar), onProgresso(msg).
 */
async function atualizarMapaTerritorial({ ano = '2022', arquivoZip, onProgresso } = {}) {
  const N = nucleo();
  const avisar = m => onProgresso && onProgresso(m);
  avisar('buscando a bancada');
  const alvos = await bancadaPodemos();
  const ufsAlvo = new Set(alvos.map(a => a.uf));

  let zip = arquivoZip, temp = null;
  if (!zip) {
    temp = path.join(os.tmpdir(), `sispode-tse-munzona-${ano}-${Date.now()}.zip`);
    avisar('baixando o arquivo do TSE');
    await baixar(urlTse(ano), temp, avisar);
    zip = temp;
  }
  try {
    const entradas = (await entradasZip(zip)).filter(e => ufsAlvo.has(ufDaEntrada(e.nome)));
    if (!entradas.length) throw new Error('o zip não tem os CSV por estado esperados');
    const ag = N.lmnAgregador(alvos);
    for (const e of entradas) {
      avisar(`lendo ${e.nome}`);
      ag.novoArquivo();
      await lerLinhasEntrada(zip, e, l => ag.linha(l));
    }
    const res = ag.resultado();
    const ibgePorUf = {};
    for (const uf of res.ufs) ibgePorUf[uf] = await ibgeUf(uf);
    const reg = N.lmnParaIbge(res, ibgePorUf);

    const base = `/labs/mapa/${ano}`;
    avisar('gravando no banco');
    const metaAntiga = await fbGet(`${base}/meta`).catch(() => null);
    if (Object.keys(reg.deputados).length) await fbPatch(`${base}/deputados`, reg.deputados);
    for (const [uf, m] of Object.entries(reg.municipios)) await fbPut(`${base}/municipios/${uf}`, m);
    const ufs = [...new Set([...((metaAntiga && metaAntiga.ufs) || []), ...res.ufs])].sort();
    await fbPut(`${base}/meta`, { atualizadoEm: new Date().toISOString(), origem: 'bot', ufs, naoEncontrados: res.naoEncontrados.length, semPar: reg.semPar.length });

    const emendas = { anos: [], erros: [] };
    if (TRANSPARENCIA_CHAVE) {
      const atual = new Date().getFullYear();
      for (const a of [atual - 1, atual]) {
        avisar(`emendas de ${a}`);
        emendas.anos.push(a);
        for (const al of alvos) {
          try {
            const brutas = await emendasDoAutor(al.nome, a);
            const resolv = {};
            for (const e of brutas) {
              const l = N.lmnLocalidade(e.localidadeDoGasto);
              if (l.tipo === 'municipio' && !resolv[l.uf]) resolv[l.uf] = N.lmnResolvedor(await ibgeUf(l.uf).catch(() => []));
            }
            const agE = N.lmnAgregarEmendas(brutas, (n, uf) => resolv[uf] ? resolv[uf](n) : null);
            await fbPut(`/labs/mapa/emendas/${a}/${al.id}`, Object.assign({ atualizadoEm: new Date().toISOString(), origem: 'bot' }, agE));
          } catch (e) { emendas.erros.push(`${al.nome} ${a}: ${e.message}`); }
        }
      }
    }
    return {
      ano, ufs: res.ufs,
      deputados: Object.values(reg.deputados).map(d => ({ nome: d.nome, uf: d.uf, total: d.total, municipios: Object.keys(d.municipios).length })),
      naoEncontrados: res.naoEncontrados, semPar: reg.semPar, emendas,
    };
  } finally {
    if (temp) await fsp.unlink(temp).catch(() => {});
  }
}

module.exports = { atualizarMapaTerritorial, entradasZip, fluxoEntrada, lerLinhasEntrada, ufDaEntrada, urlTse };
