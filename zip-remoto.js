'use strict';
// Leitura de um zip REMOTO por partes (HTTP Range), sem baixar o arquivo
// inteiro: o índice (diretório central, com ZIP64) vem do fim do arquivo e cada
// entrada é pedida em blocos de 8 MB com nova tentativa, descompactada em fluxo
// (DecompressionStream 'deflate-raw') e entregue linha a linha (latin1, como os
// CSV do TSE e do Portal da Transparência).
// Usado pelo Labs (Mapa Territorial, Perfil da Bancada) e pela Apuração
// (extensão e site). Sem dependências.

const zrDormir = ms => new Promise(r => setTimeout(r, ms));

/** Separa um fluxo de texto em linhas: { empurrar(texto), fim() }. */
function zrLinhas(aoLer) {
  let resto = '';
  return {
    empurrar(txt) {
      const partes = (resto + txt).split('\n');
      resto = partes.pop();
      for (const l of partes) if (l) aoLer(l);
    },
    fim() { if (resto) aoLer(resto); resto = ''; },
  };
}

/** Índice de um zip remoto: { url, total, entradas }. */
async function zrIndice(url) {
  const total = await zrTamanhoRemoto(url);
  const entradas = await zrEntradasZip(total, async (ini, n) => new Uint8Array(await (await zrFaixa(url, ini, ini + n - 1)).arrayBuffer()));
  return { url, total, entradas };
}

async function zrFaixa(url, ini, fim) {
  let ultimo;
  for (let t = 0; t < 3; t++) {
    if (t) await zrDormir(1500 * t);
    let r;
    try { r = await fetch(url, { headers: { Range: `bytes=${ini}-${fim}` } }); }
    catch (e) { ultimo = e; continue; }                               // queda de rede: tenta de novo
    if (r.status === 206) return r;
    ultimo = new Error(`o servidor de dados não atendeu o pedido parcial (HTTP ${r.status})`);
    if (r.status < 500 && r.status !== 429) break;                    // 200 (sem Range), 404…: não adianta repetir
  }
  throw ultimo;
}

/** Tamanho total do arquivo remoto, pelo Content-Range de um pedido de 1 byte. */
async function zrTamanhoRemoto(url) {
  const r = await zrFaixa(url, 0, 0);
  let t = Number(String(r.headers.get('content-range') || '').split('/')[1]);
  try { await r.arrayBuffer(); } catch (_) {}
  // Numa página comum (o site da Apuração), o servidor do TSE libera o acesso
  // mas não expõe o Content-Range (sem Access-Control-Expose-Headers): o tamanho
  // vem então do Content-Length de um HEAD, que o navegador sempre deixa ler.
  // Na extensão (permissão de host) o Content-Range já basta.
  if (!(t > 0)) {
    try { const h = await fetch(url, { method: 'HEAD' }); t = Number(h.headers.get('content-length')); } catch (_) {}
  }
  if (!(t > 0)) throw new Error('o servidor não informou o tamanho do arquivo');
  return t;
}

/**
 * Entradas de um zip: [{ nome, metodo, comprimido, tamanho, offsetLocal }],
 * lendo só o fim do arquivo. `ler(ini, n)` devolve Uint8Array. Suporta ZIP64
 * (o CSV do Brasil inteiro passa de 4 GB). Pura (a leitura vem de fora).
 */
async function zrEntradasZip(total, ler) {
  const nCauda = Math.min(total, 65557);
  const cauda = await ler(total - nCauda, nCauda);
  const dv = new DataView(cauda.buffer, cauda.byteOffset, cauda.byteLength);
  let eocd = -1;
  for (let i = cauda.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('o arquivo não é um zip válido');
  let n = dv.getUint16(eocd + 10, true), tamCd = dv.getUint32(eocd + 12, true), offCd = dv.getUint32(eocd + 16, true);
  if (offCd === 0xffffffff || tamCd === 0xffffffff || n === 0xffff) {
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw new Error('zip64 sem localizador');
    const e64 = await ler(Number(dv.getBigUint64(loc + 8, true)), 56);
    const d64 = new DataView(e64.buffer, e64.byteOffset, e64.byteLength);
    if (d64.getUint32(0, true) !== 0x06064b50) throw new Error('zip64: registro de fim inválido');
    n = Number(d64.getBigUint64(32, true)); tamCd = Number(d64.getBigUint64(40, true)); offCd = Number(d64.getBigUint64(48, true));
  }
  const cd = offCd >= total - nCauda ? cauda.subarray(offCd - (total - nCauda), offCd - (total - nCauda) + tamCd) : await ler(offCd, tamCd);
  const c = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const out = [];
  let p = 0;
  for (let k = 0; k < n && p + 46 <= cd.length; k++) {
    if (c.getUint32(p, true) !== 0x02014b50) throw new Error('índice do zip corrompido');
    const metodo = c.getUint16(p + 10, true);
    let comprimido = c.getUint32(p + 20, true), tamanho = c.getUint32(p + 24, true), offsetLocal = c.getUint32(p + 42, true);
    const nLen = c.getUint16(p + 28, true), xLen = c.getUint16(p + 30, true), cLen = c.getUint16(p + 32, true);
    const nome = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nLen));
    for (let x = p + 46 + nLen, fimX = x + xLen; x + 4 <= fimX;) {
      const id = c.getUint16(x, true), len = c.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (tamanho === 0xffffffff) { tamanho = Number(c.getBigUint64(q, true)); q += 8; }
        if (comprimido === 0xffffffff) { comprimido = Number(c.getBigUint64(q, true)); q += 8; }
        if (offsetLocal === 0xffffffff) { offsetLocal = Number(c.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + len;
    }
    out.push({ nome, metodo, comprimido, tamanho, offsetLocal });
    p += 46 + nLen + xLen + cLen;
  }
  return out;
}

/** UF da entrada "…_munzona_2026_SP.csv" (null para BRASIL, BR, leia-me). */
function zrUfDaEntrada(nome) {
  const m = String(nome).match(/_([A-Z]{2})\.(csv|txt)$/i);
  return m && m[1].toUpperCase() !== 'BR' ? m[1].toUpperCase() : null;
}

// Blocos do download: 8 MB, cada um com até 3 tentativas — numa queda de rede
// perde-se um bloco, não os ~100 MB de um estado grande.
const ZR_BLOCO = 8 * 1024 * 1024;

/** Os bytes [ini, fim] do arquivo remoto como fluxo, pedidos em blocos com nova tentativa. */
function zrFluxoRemoto(url, ini, fim, aoReceber) {
  let pos = ini;
  return new ReadableStream({
    async pull(c) {
      if (pos > fim) { c.close(); return; }
      const ate = Math.min(fim, pos + ZR_BLOCO - 1);
      let erro = null;
      for (let t = 0; t < 3; t++) {
        if (t) await zrDormir(1500 * t);
        try {
          const b = new Uint8Array(await (await zrFaixa(url, pos, ate)).arrayBuffer());
          if (b.length !== ate - pos + 1) throw new Error('bloco incompleto');
          pos = ate + 1;
          if (aoReceber) aoReceber(b.length);
          c.enqueue(b);
          return;
        } catch (e) { erro = e; }
      }
      c.error(new Error('download interrompido: ' + erro.message));
    },
  });
}

/** Lê uma entrada do zip remoto linha a linha. aoAndar(bytesComprimidosLidos). */
async function zrLerEntradaRemota(url, e, aoLer, aoAndar) {
  const cab = new Uint8Array(await (await zrFaixa(url, e.offsetLocal, e.offsetLocal + 29)).arrayBuffer());
  const dv = new DataView(cab.buffer);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error(`cabeçalho inválido em ${e.nome}`);
  if (!e.comprimido) return;
  const ini = e.offsetLocal + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  let lidos = 0;
  let fluxo = zrFluxoRemoto(url, ini, ini + e.comprimido - 1, n => { lidos += n; if (aoAndar) aoAndar(lidos); });
  if (e.metodo === 8) fluxo = fluxo.pipeThrough(new DecompressionStream('deflate-raw'));
  else if (e.metodo !== 0) throw new Error(`compressão ${e.metodo} não suportada em ${e.nome}`);
  const dec = new TextDecoder('latin1');
  const lin = zrLinhas(aoLer);
  const leitor = fluxo.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lin.empurrar(dec.decode(value, { stream: true }));
  }
  lin.empurrar(dec.decode());
  lin.fim();
}


if (typeof module !== 'undefined' && module.exports) module.exports = { zrEntradasZip, zrUfDaEntrada, zrLinhas };
