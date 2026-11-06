'use strict';
// Identidade visual dos PDFs do sistema (Sistemas eleitorais, Mapa Territorial, Perfil): verde do
// Podemos, filete em quatro cores, logo do sistema, títulos verdes sublinhados, A4 em pé.
const fs = require('fs');
const LOGO = 'data:image/png;base64,' + fs.readFileSync('/home/user/SisPode/icons/podemos-logo.png').toString('base64');
const C = { verde: '#0B8A4B', verdeEsc: '#0b5e3a', texto: '#1d2733', cinza: '#5b6b7b', grade: '#dfe5ea', thBg: '#f2f6f3', podeBg: '#e3f4ea',
  sobe: '#0b6e4f', cai: '#b03a2e', barra: '#8a9aa8', ama: '#9a6a00', azul: '#1F5FA8', laranja: '#D9531E', oliva: '#7C9A2F' };
const FILETE = 'linear-gradient(90deg, #0B8A4B 0 40%, #7C9A2F 40% 62%, #1F5FA8 62% 82%, #D9531E 82% 100%)';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n, d = 0) => n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => x == null ? '—' : fmt(100 * x, d) + '%';
const pp = (x, d = 1) => x == null ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(100 * x), d) + ' p.p.';
const CSS = `
@page { size: A4; margin: 12mm 11mm 15mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Segoe UI", Roboto, Arial, sans-serif; color: ${C.texto}; font-size: 9.6pt; line-height: 1.45; background: #fff; }
.cab { display: flex; align-items: center; gap: 14px; padding: 2px 0 8px; }
.cab img { height: 46px; } .cab .tit { flex: 1; }
.cab .org { font-size: 9pt; font-weight: 700; color: ${C.verde}; text-transform: uppercase; letter-spacing: .4px; }
.cab h1 { font-size: 16pt; margin: 2px 0; line-height: 1.15; color: ${C.verdeEsc}; }
.cab .sub { font-size: 9pt; color: ${C.cinza}; }
.cab .meta { text-align: right; font-size: 8.5pt; color: ${C.cinza}; line-height: 1.4; white-space: nowrap; }
.filete { height: 5px; margin: 0 0 12px; border-radius: 3px; background: ${FILETE}; }
.sec { break-before: page; } .sec.primeira { break-before: auto; }
h2 { font-size: 13pt; color: ${C.verdeEsc}; margin: 4px 0 8px; padding-bottom: 3px; border-bottom: 2px solid ${C.verde}; break-after: avoid; }
h3 { font-size: 10.5pt; color: ${C.verdeEsc}; margin: 12px 0 5px; break-after: avoid; }
p { margin: 0 0 6px; } ul, ol { margin: 0 0 6px; padding-left: 18px; } li { margin: 0 0 4px; }
.cards { display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 8px; margin: 6px 0 12px; }
.cards > div { border: 1px solid ${C.grade}; border-top: 4px solid ${C.verde}; border-radius: 8px; padding: 6px 10px; break-inside: avoid; }
.cards > div:nth-child(2) { border-top-color: ${C.oliva}; } .cards > div:nth-child(3) { border-top-color: ${C.azul}; } .cards > div:nth-child(4) { border-top-color: ${C.laranja}; }
.cards .t { font-size: 8.5pt; color: ${C.cinza}; text-transform: uppercase; letter-spacing: .3px; }
.cards .v { font-size: 17pt; font-weight: 700; color: ${C.verdeEsc}; line-height: 1.2; margin: 2px 0; } .cards .l { font-size: 8pt; color: ${C.cinza}; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 6px; }
td, th { border-bottom: 1px solid ${C.grade}; padding: 3px 5px; text-align: left; font-size: 8.4pt; vertical-align: top; }
th { background: ${C.thBg}; color: ${C.verdeEsc}; font-size: 7.8pt; font-weight: 700; }
tr { break-inside: avoid; } td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr.pode td { background: ${C.podeBg}; } tr.tot td { font-weight: 700; border-top: 1.5px solid ${C.verde}; }
.pos { color: ${C.sobe}; font-weight: 600; } .neg { color: ${C.cai}; font-weight: 600; }
.nota { font-size: 8pt; color: ${C.cinza}; font-style: italic; margin: 2px 0 8px; }
.duas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.tres { display: block; }
.caixa { border: 1px solid ${C.grade}; border-left: 4px solid ${C.verde}; border-radius: 6px; padding: 6px 10px; margin: 6px 0 10px; break-inside: avoid; }
.caixa b.r { color: ${C.verdeEsc}; }
.aviso { border-left-color: ${C.ama}; }
.fig { margin: 4px 0 6px; break-inside: avoid; } .fig .ft { font-weight: 700; font-size: 9pt; color: ${C.verdeEsc}; margin-bottom: 3px; }
svg { max-width: 100%; height: auto; display: block; }
.ref { font-size: 8.3pt; } .ref li { margin-bottom: 3px; }
.peq { font-size: 8.4pt; } .mut { color: ${C.cinza}; }
`;
/** Documento inteiro: cabeçalho do sistema (logo, organização, título, meta) + filete, e as seções. */
function documento(secoes, { titulo, sub, meta }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>
<div class="cab"><img src="${LOGO}" alt="Podemos"><div class="tit"><div class="org">Liderança do Podemos na Câmara dos Deputados</div><h1>${esc(titulo)}</h1><div class="sub">${esc(sub)}</div></div><div class="meta">${meta}</div></div>
<div class="filete"></div>
${secoes.map((s, i) => `<section class="sec${!i || s.startsWith('<!--cont-->') ? ' primeira' : ''}">${s}</section>`).join('\n')}
</body></html>`;
}
const RODAPE = data => `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#5b6b7b;padding:0 11mm;display:flex;justify-content:space-between;border-top:1px solid #dfe5ea;margin:0 11mm;padding-top:4px">
<span>Liderança do Podemos na Câmara dos Deputados · Estudo técnico com dados públicos do TSE e do IBGE · ${data}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;

/** Barras horizontais (SVG): itens [{ rot, v, lo, hi, destaque }]. */
function barras(itens, { larg = 680, fmtv = v => fmt(v), max = null, min = null, cor = C.barra, corD = C.verde, rotLarg = 130 } = {}) {
  const h = 15, H = itens.length * h + 8, x0 = rotLarg, W = larg - x0 - 60;
  const vmax = max != null ? max : Math.max(...itens.map(i => Math.max(i.v, i.hi ?? i.v)), 0), vmin = min != null ? min : Math.min(0, ...itens.map(i => Math.min(i.v, i.lo ?? i.v)));
  const X = v => x0 + (W * (v - vmin)) / ((vmax - vmin) || 1);
  let s = `<svg width="${larg}" height="${H}" viewBox="0 0 ${larg} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Roboto, Arial" font-size="9">`;
  s += `<line x1="${X(0)}" x2="${X(0)}" y1="0" y2="${H - 4}" stroke="${C.grade}"/>`;
  itens.forEach((it, k) => {
    const y = 4 + k * h, a = X(Math.min(0, it.v)), b = X(Math.max(0, it.v));
    s += `<text x="${x0 - 6}" y="${y + 9}" text-anchor="end" fill="${C.texto}">${esc(it.rot)}</text>`;
    s += `<rect x="${a}" y="${y + 1}" width="${Math.max(1, b - a)}" height="${h - 5}" rx="2" fill="${it.destaque ? corD : it.v < 0 ? C.cai : cor}"/>`;
    if (it.lo != null) s += `<line x1="${X(it.lo)}" x2="${X(it.hi)}" y1="${y + 5.5}" y2="${y + 5.5}" stroke="${C.texto}"/><line x1="${X(it.lo)}" x2="${X(it.lo)}" y1="${y + 3}" y2="${y + 8}" stroke="${C.texto}"/><line x1="${X(it.hi)}" x2="${X(it.hi)}" y1="${y + 3}" y2="${y + 8}" stroke="${C.texto}"/>`;
    s += `<text x="${X(Math.max(it.v, it.hi ?? it.v)) + 4}" y="${y + 9}" fill="${C.texto}">${esc(fmtv(it.v))}</text>`;
  });
  return s + '</svg>';
}
/** Regressão descontínua: médias por faixa de margem e a tendência de cada lado. */
function graficoRD(pts, { larg = 680, alt = 260, h = 0.3 } = {}) {
  const ml = 46, mr = 10, mt = 10, mb = 32, W = larg - ml - mr, Hh = alt - mt - mb;
  const ys = pts.map(p => p.y), ymin = Math.min(...ys, 0) - 0.01, ymax = Math.max(...ys, 0) + 0.01;
  const X = x => ml + W * (x + h) / (2 * h), Y = y => mt + Hh * (1 - (y - ymin) / (ymax - ymin));
  let s = `<svg width="${larg}" height="${alt}" viewBox="0 0 ${larg} ${alt}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Roboto, Arial" font-size="9">`;
  for (let t = Math.ceil(ymin * 50) / 50; t <= ymax; t += 0.02) s += `<line x1="${ml}" x2="${ml + W}" y1="${Y(t)}" y2="${Y(t)}" stroke="#eef2f5"/><text x="${ml - 4}" y="${Y(t) + 3}" text-anchor="end" fill="${C.cinza}">${t > 0.001 ? '+' : ''}${fmt(100 * t, 0)}</text>`;
  s += `<line x1="${X(0)}" x2="${X(0)}" y1="${mt}" y2="${mt + Hh}" stroke="${C.texto}" stroke-dasharray="3 2"/>`;
  for (const t of [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) s += `<text x="${X(t)}" y="${mt + Hh + 12}" text-anchor="middle" fill="${C.cinza}">${t > 0 ? '+' : ''}${fmt(100 * t, 0)}</text>`;
  s += `<text x="${ml + W / 2}" y="${alt - 3}" text-anchor="middle" fill="${C.texto}">Margem do partido na disputa pela prefeitura em 2024 (p.p.) — à direita da linha, venceu</text>`;
  s += `<text transform="translate(11 ${mt + Hh / 2}) rotate(-90)" text-anchor="middle" fill="${C.texto}">Variação da fatia, 2022→2026 (p.p.)</text>`;
  for (const lado of [-1, 1]) {
    const q = pts.filter(p => (lado < 0 ? p.x < 0 : p.x > 0));
    const sw = q.reduce((a, p) => a + p.n, 0), mx = q.reduce((a, p) => a + p.n * p.x, 0) / sw, my = q.reduce((a, p) => a + p.n * p.y, 0) / sw;
    const b = q.reduce((a, p) => a + p.n * (p.x - mx) * (p.y - my), 0) / q.reduce((a, p) => a + p.n * (p.x - mx) ** 2, 0), a0 = my - b * mx;
    const x1 = lado < 0 ? -h : 0, x2 = lado < 0 ? 0 : h;
    s += `<line x1="${X(x1)}" x2="${X(x2)}" y1="${Y(a0 + b * x1)}" y2="${Y(a0 + b * x2)}" stroke="${lado > 0 ? C.verde : C.cinza}" stroke-width="2"/>`;
  }
  for (const p of pts) s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${Math.max(2.5, Math.min(6, Math.sqrt(p.n) / 3))}" fill="${p.x > 0 ? C.verde : C.cinza}" fill-opacity=".8" stroke="#fff" stroke-width="1"/>`;
  return s + '</svg>';
}
module.exports = { C, CSS, LOGO, esc, fmt, pct, pp, documento, RODAPE, barras, graficoRD };
