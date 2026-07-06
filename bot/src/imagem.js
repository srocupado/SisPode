'use strict';
// Imagem do resultado de votação — equivalente server-side do generateImage
// da extensão (lá: html2canvas; aqui: SVG desenhado à mão e rasterizado em
// PNG pelo sharp). Cores e hierarquia visual copiadas do painel.
const sharp = require('sharp');
const { votoClass } = require('./votacao');

const COR = {
  fundo:  '#0e1a1d', card: '#14252a', borda: 'rgba(255,255,255,0.10)',
  texto:  '#e8eef0', dim: '#8fa3a8', verde: '#00a86b',
  sim: '#3ad97d', nao: '#f05454', abstencao: '#f0c040',
  art17: '#6eaaff', obstrucao: '#c084fc', ausente: '#5a6f74',
};
const ROTULO = {
  sim: 'Sim', nao: 'Não', abstencao: 'Abstenção',
  art17: 'Art. 17', obstrucao: 'Obstrução', ausente: 'Ausente',
};
const FONTE = 'DejaVu Sans, Verdana, Arial, sans-serif';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Quebra por palavras em linhas de até maxChars (aproximação de largura)
function quebraLinhas(texto, maxChars, maxLinhas = 3) {
  const palavras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ');
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > maxChars) {
      linhas.push(atual.trim());
      atual = p;
      if (linhas.length === maxLinhas) break;
    } else {
      atual = (atual + ' ' + p).trim();
    }
  }
  if (linhas.length < maxLinhas && atual) linhas.push(atual.trim());
  else if (linhas.length === maxLinhas && atual) {
    linhas[maxLinhas - 1] = linhas[maxLinhas - 1].replace(/.{3}$/, '') + '…';
  }
  return linhas;
}

// Donut de segmentos via stroke-dasharray (rotacionado para começar no topo)
function donutSVG(cx, cy, r, larg, contagens) {
  const total = Object.values(contagens).reduce((a, b) => a + b, 0) || 1;
  const C = 2 * Math.PI * r;
  let acum = 0, segs = '';
  for (const [classe, n] of Object.entries(contagens)) {
    if (!n) continue;
    const len = (n / total) * C;
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COR[classe]}" ` +
      `stroke-width="${larg}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" ` +
      `stroke-dashoffset="${(-acum).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    acum += len;
  }
  return segs;
}

/** Gera o PNG do placar (retorna Buffer). Recebe o objeto de placarVotacao(). */
async function imagemVotacao(pl) {
  const W = 1080, M = 40;                    // largura e margem
  const dataBR = (pl.data || '').split('-').reverse().join('/');

  const descLinhas = quebraLinhas(pl.descricao, 70, 4);
  const bancada = pl.bancada || [];
  const colunas = 2, colW = (W - 2 * M) / colunas, rowH = 46;
  const linhasDep = Math.ceil(bancada.length / colunas);

  // Alturas por seção (layout vertical)
  const yHeader   = 56;
  const hHeader   = 40 + descLinhas.length * 34 + 34;
  const yPlacar   = yHeader + hHeader + 16;
  const hPlacar   = 210;
  const temOrient = !!(pl.orientPartido || pl.orientGoverno);
  const yOrient   = yPlacar + hPlacar + 16;
  const hOrient   = temOrient ? 64 : 0;
  const yBancada  = yOrient + hOrient + (temOrient ? 16 : 0);
  const hBancada  = 250;
  const yDeps     = yBancada + hBancada + 16;
  const hDeps     = 56 + linhasDep * rowH + 16;
  const yRodape   = yDeps + hDeps + 14;
  const H         = yRodape + 40;

  // — Cabeçalho —
  let svg = `
  <rect width="${W}" height="${H}" fill="${COR.fundo}"/>
  <rect x="${M}" y="${yHeader - 34}" rx="8" width="150" height="34" fill="${COR.verde}"/>
  <text x="${M + 75}" y="${yHeader - 11}" text-anchor="middle" font-family="${FONTE}" font-size="18" font-weight="bold" fill="#ffffff">${esc(pl.sigla)}</text>
  <text x="${M + 166}" y="${yHeader - 12}" font-family="${FONTE}" font-size="15" fill="${COR.dim}">Dados Abertos · Câmara dos Deputados</text>`;
  descLinhas.forEach((l, i) => {
    svg += `<text x="${M}" y="${yHeader + 28 + i * 34}" font-family="${FONTE}" font-size="24" font-weight="bold" fill="${COR.texto}">${esc(l)}</text>`;
  });
  svg += `<text x="${M}" y="${yHeader + 28 + descLinhas.length * 34}" font-family="${FONTE}" font-size="17" fill="${COR.dim}">${esc(dataBR)}${pl.hora ? ' às ' + esc(pl.hora) : ''} · ${esc(pl.orgao)}</text>`;

  // — Placar geral —
  svg += `<rect x="${M}" y="${yPlacar}" rx="14" width="${W - 2 * M}" height="${hPlacar}" fill="${COR.card}" stroke="${COR.borda}"/>`;
  svg += `<text x="${M + 24}" y="${yPlacar + 38}" font-family="${FONTE}" font-size="16" font-weight="bold" fill="${COR.dim}">RESULTADO FINAL (PLENÁRIO)</text>`;
  const gOrd = ['sim', 'nao', 'abstencao', 'art17', 'obstrucao'];
  gOrd.forEach((k, i) => {
    const y = yPlacar + 74 + i * 26;
    svg += `<text x="${M + 24}" y="${y}" font-family="${FONTE}" font-size="19" fill="${COR.texto}">${ROTULO[k]}</text>` +
           `<text x="${M + 320}" y="${y}" text-anchor="end" font-family="${FONTE}" font-size="19" font-weight="bold" fill="${COR[k]}">${pl.global[k]}</text>`;
  });
  // Quórum em destaque à direita
  svg += `<text x="${W - M - 60}" y="${yPlacar + 100}" text-anchor="middle" font-family="${FONTE}" font-size="16" fill="${COR.dim}">Quórum</text>` +
         `<text x="${W - M - 60}" y="${yPlacar + 152}" text-anchor="middle" font-family="${FONTE}" font-size="46" font-weight="bold" fill="${COR.texto}">${pl.quorum}</text>`;

  // — Orientações —
  if (temOrient) {
    svg += `<rect x="${M}" y="${yOrient}" rx="14" width="${W - 2 * M}" height="${hOrient}" fill="${COR.card}" stroke="${COR.borda}"/>`;
    let x = M + 24;
    if (pl.orientPartido) {
      const c = COR[votoClass(pl.orientPartido)] || COR.texto;
      svg += `<text x="${x}" y="${yOrient + 40}" font-family="${FONTE}" font-size="18" fill="${COR.dim}">Orientação ${esc(pl.sigla)}: </text>` +
             `<text x="${x + 190}" y="${yOrient + 40}" font-family="${FONTE}" font-size="19" font-weight="bold" fill="${c}">${esc(pl.orientPartido)}</text>`;
      x += 430;
    }
    if (pl.orientGoverno) {
      const c = COR[votoClass(pl.orientGoverno)] || COR.texto;
      svg += `<text x="${x}" y="${yOrient + 40}" font-family="${FONTE}" font-size="18" fill="${COR.dim}">Orientação GOVERNO: </text>` +
             `<text x="${x + 230}" y="${yOrient + 40}" font-family="${FONTE}" font-size="19" font-weight="bold" fill="${c}">${esc(pl.orientGoverno)}</text>`;
    }
  }

  // — Bancada: donut + legenda —
  svg += `<rect x="${M}" y="${yBancada}" rx="14" width="${W - 2 * M}" height="${hBancada}" fill="${COR.card}" stroke="${COR.borda}"/>`;
  svg += `<text x="${M + 24}" y="${yBancada + 38}" font-family="${FONTE}" font-size="16" font-weight="bold" fill="${COR.dim}">BANCADA ${esc(pl.sigla)} — ${bancada.length} PARLAMENTARES</text>`;
  const cx = M + 130, cy = yBancada + 145, r = 62;
  svg += donutSVG(cx, cy, r, 30, pl.parcial);
  svg += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-family="${FONTE}" font-size="26" font-weight="bold" fill="${COR.texto}">${bancada.length}</text>`;
  let ly = yBancada + 78;
  for (const k of ['sim', 'nao', 'abstencao', 'art17', 'obstrucao', 'ausente']) {
    if (!pl.parcial[k]) continue;
    svg += `<circle cx="${M + 300}" cy="${ly - 6}" r="8" fill="${COR[k]}"/>` +
           `<text x="${M + 320}" y="${ly}" font-family="${FONTE}" font-size="19" fill="${COR.texto}">${ROTULO[k]}</text>` +
           `<text x="${M + 520}" y="${ly}" text-anchor="end" font-family="${FONTE}" font-size="19" font-weight="bold" fill="${COR[k]}">${pl.parcial[k]}</text>`;
    ly += 30;
  }

  // — Lista de deputados (2 colunas) —
  svg += `<rect x="${M}" y="${yDeps}" rx="14" width="${W - 2 * M}" height="${hDeps}" fill="${COR.card}" stroke="${COR.borda}"/>`;
  svg += `<text x="${M + 24}" y="${yDeps + 38}" font-family="${FONTE}" font-size="16" font-weight="bold" fill="${COR.dim}">VOTOS DA BANCADA</text>`;
  bancada.forEach((d, i) => {
    const col = i % colunas, lin = Math.floor(i / colunas);
    const x = M + 24 + col * colW;
    const y = yDeps + 74 + lin * rowH;
    const nome = quebraLinhas(`${d.nome} (${d.siglaPartido}-${d.siglaUf})`, 34, 1)[0] || '';
    svg += `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="17" fill="${COR.texto}">${esc(nome)}</text>` +
           `<text x="${x + colW - 48}" y="${y}" text-anchor="end" font-family="${FONTE}" font-size="17" font-weight="bold" fill="${COR[d.classe]}">${esc(d.tipoVoto || 'Ausente')}</text>`;
  });

  // — Rodapé —
  svg += `<text x="${W / 2}" y="${yRodape + 8}" text-anchor="middle" font-family="${FONTE}" font-size="14" fill="${COR.dim}">SisPode · Liderança do Podemos na Câmara dos Deputados</text>`;

  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  return sharp(Buffer.from(doc), { density: 144 }).png().toBuffer();
}

module.exports = { imagemVotacao };
