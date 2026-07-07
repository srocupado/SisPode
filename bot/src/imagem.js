'use strict';
// Imagem do resultado de votação — equivalente server-side do generateImage
// da extensão (lá: html2canvas; aqui: SVG desenhado à mão e rasterizado em
// PNG pelo sharp). Layout aprovado pela equipe: quórum em destaque,
// resultado final com total, faixa de orientação, donut da bancada e
// parlamentares AGRUPADOS por voto.
const sharp = require('sharp');
const { votoClass } = require('./votacao');

const COR = {
  fundo: '#0c1619', card: '#122226', cardClaro: '#16292e', faixa: '#173035',
  borda: 'rgba(255,255,255,0.07)', divisor: 'rgba(255,255,255,0.10)',
  texto: '#e8eef0', dim: '#7d949b', teal: '#14b8a6', tealClaro: '#2dd4bf',
  sim: '#3ad97d', nao: '#f05454', abstencao: '#f0c040',
  art17: '#6eaaff', obstrucao: '#c084fc', ausente: '#8a9ba1',
};
const ROTULO = {
  sim: 'Sim', nao: 'Não', abstencao: 'Abstenção',
  art17: 'Art. 17', obstrucao: 'Obstrução', ausente: 'Ausente',
};
const GRUPO_TITULO = {
  sim: 'VOTARAM SIM', nao: 'VOTARAM NÃO', abstencao: 'ABSTENÇÃO',
  art17: 'ART. 17', obstrucao: 'OBSTRUÇÃO', ausente: 'AUSENTES',
};
const ORDEM_GRUPOS = ['sim', 'nao', 'abstencao', 'art17', 'obstrucao', 'ausente'];
const FONTE = 'DejaVu Sans, Verdana, Arial, sans-serif';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// "Antonio Carlos Rodrigues" → "Antonio Carlos R." (abrevia até caber)
function nomeCurto(nome, max = 22) {
  let w = String(nome || '').trim().split(/\s+/);
  if (w.join(' ').length <= max) return w.join(' ');
  w[w.length - 1] = w[w.length - 1][0] + '.';           // abrevia o sobrenome final
  while (w.join(' ').length > max && w.length > 2) w.splice(w.length - 2, 1);
  const r = w.join(' ');
  return r.length <= max + 2 ? r : r.slice(0, max - 1) + '…';
}

function quebraLinhas(texto, maxChars, maxLinhas = 3) {
  const palavras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ');
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > maxChars) {
      linhas.push(atual.trim());
      atual = p;
      if (linhas.length === maxLinhas) break;
    } else atual = (atual + ' ' + p).trim();
  }
  if (linhas.length < maxLinhas && atual) linhas.push(atual.trim());
  else if (linhas.length === maxLinhas && atual) {
    linhas[maxLinhas - 1] = linhas[maxLinhas - 1].replace(/.{3}$/, '') + '…';
  }
  return linhas;
}

// Donut por stroke-dasharray, começando no topo
function donutSVG(cx, cy, r, larg, contagens) {
  const total = Object.values(contagens).reduce((a, b) => a + b, 0) || 1;
  const C = 2 * Math.PI * r;
  let acum = 0, segs = '';
  for (const k of ORDEM_GRUPOS) {
    const n = contagens[k] || 0;
    if (!n) continue;
    const len = (n / total) * C;
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COR[k]}" ` +
      `stroke-width="${larg}" stroke-dasharray="${Math.max(len - 3, 1).toFixed(2)} ${C.toFixed(2)}" ` +
      `stroke-dashoffset="${(-acum).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    acum += len;
  }
  return segs;
}

/** Gera o PNG do placar (Buffer). Recebe o objeto de placarVotacao(). */
async function imagemVotacao(pl) {
  const W = 1080, M = 48, CW = W - 2 * M, PAD = 34;
  const dataBR = (pl.data || '').split('-').reverse().join('/');
  const bancada = pl.bancada || [];

  // Grupos de parlamentares por voto (só os com gente)
  const grupos = ORDEM_GRUPOS
    .map(k => ({ k, deps: bancada.filter(d => d.classe === k) }))
    .filter(g => g.deps.length);

  // Orientações exibidas (Liderança do partido e Governo)
  const orients = [];
  if (pl.orientPartido) orients.push({ rot: `Orientação da Liderança`, quem: pl.sigla, val: pl.orientPartido });
  if (pl.orientGoverno) orients.push({ rot: 'Orientação do', quem: 'GOVERNO', val: pl.orientGoverno });

  const descLinhas = pl.descricao ? quebraLinhas(pl.descricao, 74, 2) : [];

  // ---------- Cálculo vertical ----------
  const GAP = 26;
  let y = 40;
  const yHeader = y, hHeader = 118 + descLinhas.length * 30;
  y += hHeader + GAP;
  const yPlacar = y;
  const hQuorum = 128, hLinhas = 5 * 48, hTotal = 66, hOrients = orients.length * 60;
  const hPlacar = hQuorum + 44 + hLinhas + hTotal + hOrients + 8;
  y += hPlacar + GAP;
  const yBancada = y, hBancada = 330;
  y += hBancada + GAP;

  const COLS = 3, colW = (CW - 2 * PAD) / COLS, rowH = 46;
  const gruposPos = grupos.map(g => {
    const linhas = Math.ceil(g.deps.length / COLS);
    const h = 62 + linhas * rowH + 14;
    const pos = { ...g, y, h, linhas };
    y += h + 18;
    return pos;
  });
  const yRodape = y + 16;
  const H = yRodape + 92;

  // ---------- Desenho ----------
  let svg = `<rect width="${W}" height="${H}" fill="${COR.fundo}"/>`;

  // Cabeçalho
  svg += `<rect x="${M}" y="${yHeader}" rx="16" width="${CW}" height="${hHeader}" fill="${COR.cardClaro}" stroke="${COR.borda}"/>`;
  const badgeTxt = `partido: ${pl.sigla}`;
  const badgeW = 40 + badgeTxt.length * 11;
  svg += `<rect x="${M + PAD}" y="${yHeader + 26}" rx="9" width="${badgeW}" height="36" fill="${COR.teal}"/>` +
         `<text x="${M + PAD + badgeW / 2}" y="${yHeader + 50}" text-anchor="middle" font-family="${FONTE}" font-size="17" font-weight="bold" fill="#ffffff">${esc(badgeTxt)}</text>`;
  const titulo = pl.proposicao || 'Votação';
  svg += `<text x="${M + PAD}" y="${yHeader + 96}" font-family="${FONTE}" font-size="26" font-weight="bold" fill="${COR.texto}">${esc(titulo)}</text>`;
  descLinhas.forEach((l, i) => {
    svg += `<text x="${M + PAD}" y="${yHeader + 96 + 30 + i * 30}" font-family="${FONTE}" font-size="17" fill="${COR.dim}">${esc(l)}</text>`;
  });
  svg += `<text x="${W - M - PAD}" y="${yHeader + 96 + descLinhas.length * 30}" text-anchor="end" font-family="${FONTE}" font-size="17" fill="${COR.dim}">${esc(dataBR)}${pl.hora ? ' às ' + esc(pl.hora) : ''} · ${esc(pl.orgao)}</text>`;

  // Card do placar geral
  svg += `<rect x="${M}" y="${yPlacar}" rx="16" width="${CW}" height="${hPlacar}" fill="${COR.card}" stroke="${COR.borda}"/>`;
  svg += `<text x="${W / 2}" y="${yPlacar + 48}" text-anchor="middle" font-family="${FONTE}" font-size="17" letter-spacing="2" fill="${COR.dim}">QUÓRUM DA VOTAÇÃO</text>` +
         `<text x="${W / 2}" y="${yPlacar + 112}" text-anchor="middle" font-family="${FONTE}" font-size="62" font-weight="bold" fill="${COR.texto}">${pl.quorum}</text>`;
  let yy = yPlacar + hQuorum + 40;
  svg += `<text x="${M + PAD}" y="${yy - 6}" font-family="${FONTE}" font-size="16" letter-spacing="2" font-weight="bold" fill="${COR.dim}">RESULTADO FINAL</text>`;
  yy += 34;
  for (const k of ['sim', 'nao', 'abstencao', 'art17', 'obstrucao']) {
    svg += `<text x="${M + PAD}" y="${yy}" font-family="${FONTE}" font-size="22" fill="${COR.texto}">${ROTULO[k]}</text>` +
           `<text x="${W - M - PAD}" y="${yy}" text-anchor="end" font-family="${FONTE}" font-size="22" font-weight="bold" fill="${COR[k]}">${pl.global[k]}</text>`;
    yy += 48;
  }
  svg += `<line x1="${M + PAD}" y1="${yy - 24}" x2="${W - M - PAD}" y2="${yy - 24}" stroke="${COR.divisor}"/>`;
  const totalGeral = Object.values(pl.global).reduce((a, b) => a + b, 0);
  svg += `<text x="${M + PAD}" y="${yy + 12}" font-family="${FONTE}" font-size="23" font-weight="bold" fill="${COR.texto}">Total</text>` +
         `<text x="${W - M - PAD}" y="${yy + 12}" text-anchor="end" font-family="${FONTE}" font-size="23" font-weight="bold" fill="${COR.texto}">${totalGeral}</text>`;
  yy += 44;
  for (const o of orients) {
    const c = COR[votoClass(o.val)] || COR.texto;
    // Rótulo + nome no MESMO <text>: o <tspan> continua o fluxo do texto,
    // sem estimativa manual de largura (que fazia o nome atropelar o rótulo).
    svg += `<rect x="${M + 1}" y="${yy - 2}" width="${CW - 2}" height="56" fill="${COR.faixa}"/>` +
           `<text x="${M + PAD}" y="${yy + 33}" font-family="${FONTE}" font-size="19" fill="${COR.dim}">${esc(o.rot)} <tspan font-weight="bold" fill="${COR.tealClaro}">${esc(o.quem)}</tspan></text>` +
           `<text x="${W - M - PAD}" y="${yy + 33}" text-anchor="end" font-family="${FONTE}" font-size="20" font-weight="bold" fill="${c}">${esc(o.val)}</text>`;
    yy += 60;
  }

  // Card da bancada (donut + legenda + total)
  svg += `<rect x="${M}" y="${yBancada}" rx="16" width="${CW}" height="${hBancada}" fill="${COR.card}" stroke="${COR.borda}"/>`;
  svg += `<text x="${M + PAD}" y="${yBancada + 46}" font-family="${FONTE}" font-size="17" letter-spacing="2" font-weight="bold" fill="${COR.dim}">BANCADA ${esc(pl.sigla)}</text>`;
  const cx = M + PAD + 130, cy = yBancada + 165, r = 78;
  svg += donutSVG(cx, cy, r, 38, pl.parcial);
  svg += `<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-family="${FONTE}" font-size="34" font-weight="bold" fill="${COR.texto}">${bancada.length}</text>` +
         `<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-family="${FONTE}" font-size="13" letter-spacing="1" fill="${COR.dim}">TOTAL</text>`;
  let ly = yBancada + 108;
  for (const k of ORDEM_GRUPOS) {
    if (!pl.parcial[k]) continue;
    svg += `<circle cx="${M + PAD + 330}" cy="${ly - 7}" r="8" fill="${COR[k]}"/>` +
           `<text x="${M + PAD + 352}" y="${ly}" font-family="${FONTE}" font-size="21" fill="${COR.texto}">${ROTULO[k]}</text>` +
           `<text x="${M + PAD + 560}" y="${ly}" text-anchor="end" font-family="${FONTE}" font-size="21" font-weight="bold" fill="${COR[k]}">${pl.parcial[k]}</text>`;
    ly += 38;
  }
  svg += `<line x1="${M + PAD}" y1="${yBancada + hBancada - 62}" x2="${W - M - PAD}" y2="${yBancada + hBancada - 62}" stroke="${COR.divisor}"/>` +
         `<text x="${M + PAD}" y="${yBancada + hBancada - 24}" font-family="${FONTE}" font-size="23" font-weight="bold" fill="${COR.texto}">Total bancada</text>` +
         `<text x="${W - M - PAD}" y="${yBancada + hBancada - 24}" text-anchor="end" font-family="${FONTE}" font-size="23" font-weight="bold" fill="${COR.texto}">${bancada.length}</text>`;

  // Cards de parlamentares agrupados por voto
  for (const g of gruposPos) {
    svg += `<rect x="${M}" y="${g.y}" rx="16" width="${CW}" height="${g.h}" fill="${COR.card}" stroke="${COR.borda}"/>`;
    svg += `<circle cx="${M + PAD + 8}" cy="${g.y + 36}" r="7" fill="${COR[g.k]}"/>` +
           `<text x="${M + PAD + 28}" y="${g.y + 43}" font-family="${FONTE}" font-size="18" letter-spacing="2" font-weight="bold" fill="${COR.texto}">${GRUPO_TITULO[g.k]}</text>` +
           `<text x="${W - M - PAD}" y="${g.y + 43}" text-anchor="end" font-family="${FONTE}" font-size="21" font-weight="bold" fill="${COR[g.k]}">${g.deps.length}</text>`;
    svg += `<line x1="${M + 1}" y1="${g.y + 60}" x2="${W - M - 1}" y2="${g.y + 60}" stroke="${COR.divisor}"/>`;
    g.deps.forEach((d, i) => {
      const col = i % COLS, lin = Math.floor(i / COLS);
      const x = M + PAD + col * colW;
      const yD = g.y + 62 + 32 + lin * rowH;
      const nome = nomeCurto(d.nome, 20);
      svg += `<text x="${x}" y="${yD}" font-family="${FONTE}" font-size="18" fill="${COR.texto}">${esc(nome)} <tspan font-size="15" fill="${COR.dim}">(${esc(d.siglaUf || '?')})</tspan></text>`;
    });
  }

  // Rodapé
  svg += `<line x1="${W / 2 - 120}" y1="${yRodape + 6}" x2="${W / 2 + 120}" y2="${yRodape + 6}" stroke="${COR.divisor}"/>` +
         `<text x="${W / 2}" y="${yRodape + 42}" text-anchor="middle" font-family="${FONTE}" font-size="20" letter-spacing="4" font-weight="bold" fill="${COR.tealClaro}">LIDERANÇA DO PODEMOS</text>` +
         `<text x="${W / 2}" y="${yRodape + 70}" text-anchor="middle" font-family="${FONTE}" font-size="15" fill="${COR.dim}">Câmara dos Deputados · ${esc(dataBR)}</text>`;

  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  return sharp(Buffer.from(doc), { density: 144 }).png().toBuffer();
}

module.exports = { imagemVotacao };
