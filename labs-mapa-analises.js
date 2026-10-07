'use strict';
// Labs · Mapa Territorial — análises em painel (layout em grade):
//   · Emendas × votos (um deputado): o que foi pago na legislatura, por
//     município do favorecido, contra a variação da FATIA do deputado nos
//     votos válidos do município entre a eleição anterior e a atual.
//   · Bancada no estado: os eleitos do partido numa UF juntos — onde cada um
//     é forte, quem divide cada município, quem disputa o mesmo eleitorado e
//     onde o partido não tem ninguém.
//
// Leitura honesta (vai nas notas dos gráficos): emenda costuma ir para onde o
// deputado já é forte, e base grande tende a perder um pouco — o painel mostra
// ASSOCIAÇÃO, não efeito. Por isso: fatia em pontos percentuais (neutraliza o
// comparecimento e a base pequena), a variação do próprio deputado no estado
// como régua, a mediana e o número de municípios de cada faixa, e o voto que
// foi para outro eleito do partido no mesmo município.
//
// Cálculo puro (lma*) exportado para os testes; desenho (ma*) só na extensão.
// Depende de labs.js, labs-mapa-nucleo.js e labs-mapa.js.

// No Node (testes), o núcleo do Mapa vem por require; na extensão já é global.
const LMA_NUC = typeof lmnLocalidade === 'function' ? { lmnLocalidade } : require('./labs-mapa-nucleo.js');

const LMA_FAIXAS = [
  ['Sem emenda', e => !e],
  ['Até R$ 300 mil', e => e > 0 && e <= 3e5],
  ['R$ 300 mil – 1 mi', e => e > 3e5 && e <= 1e6],
  ['R$ 1 – 3 mi', e => e > 1e6 && e <= 3e6],
  ['Mais de R$ 3 mi', e => e > 3e6],
];

function lmaMediana(l) {
  const s = l.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Pagamentos da legislatura por município do favorecido ({ "NOME - UF": valor })
 * → { mun: { mID: valor }, nomes: { mID: "NOME - UF" }, fora: valor } para a UF.
 * Fora = outro estado, favorecido sem município ou nome sem par no IBGE
 * (banco intermediário em Brasília, por exemplo).
 */
function lmaEmendasDaUf(pagos, uf, resolver) {
  const out = { mun: {}, nomes: {}, fora: 0, total: 0 };
  for (const [rot, v0] of Object.entries(pagos || {})) {
    const v = Number(v0) || 0;
    if (!v) continue;
    out.total += v;
    const l = LMA_NUC.lmnLocalidade(rot);
    const id = l.tipo === 'municipio' && l.uf === uf ? resolver(l.nome) : null;
    if (!id) { out.fora += v; continue; }
    const k = 'm' + id;
    out.mun[k] = (out.mun[k] || 0) + v;
    out.nomes[k] = out.nomes[k] || rot;
  }
  return out;
}

/**
 * Emendas × votos de um deputado.
 * dep: { total, municipios, anterior: { municipios } }; outros: os demais eleitos
 * do partido na UF; t1/t0: { mID: { n, t } } totais de votos válidos na atual e
 * na anterior (t0 null → métrica cai para a variação % dos votos); em: { mID: R$ }.
 * Devolve { met: 'pp'|'pct', linhas, faixas, kpi, quad }.
 */
function lmaRetorno(dep, outros, t1, t0, em) {
  const ant = (dep.anterior && dep.anterior.municipios) || {};
  const atu = dep.municipios || {};
  const met = t0 ? 'pp' : 'pct';
  const ks = [...new Set([...Object.keys(atu), ...Object.keys(ant), ...Object.keys(em || {})])];
  const T1 = k => (t1[k] || {}).t || 0, T0 = k => t0 ? ((t0[k] || {}).t || 0) : 0;
  const linhas = ks.map(k => {
    const a = ant[k] || 0, v = atu[k] || 0, e = (em || {})[k] || 0;
    const outrosD = (outros || []).reduce((s, o) => s + ((o.municipios || {})[k] || 0) - (((o.anterior || {}).municipios || {})[k] || 0), 0);
    const x = { k, n: (t1[k] || {}).n || k, e, a, v, d: v - a, outrosD };
    if (met === 'pp') { const f1 = T1(k) ? v / T1(k) : null, f0 = T0(k) ? a / T0(k) : null; x.f1 = f1; x.f0 = f0; x.var = f1 != null && f0 != null ? f1 - f0 : null; }
    else x.var = a ? v / a - 1 : null;
    return x;
  });
  const agreg = l => {
    const a = l.reduce((s, x) => s + x.a, 0), v = l.reduce((s, x) => s + x.v, 0);
    if (met === 'pct') return { a, v, var: a ? v / a - 1 : null };
    const s1 = l.reduce((s, x) => s + T1(x.k), 0), s0 = l.reduce((s, x) => s + T0(x.k), 0);
    return { a, v, var: s1 && s0 ? v / s1 - a / s0 : null };
  };
  const com = linhas.filter(x => x.e > 0), sem = linhas.filter(x => !x.e);
  const faixas = LMA_FAIXAS.map(([r, f]) => {
    const l = linhas.filter(x => f(x.e));
    return Object.assign({ r, n: l.length, mediana: lmaMediana(l.map(x => x.var)), cresc: l.filter(x => x.var > 0).length, e: l.reduce((s, x) => s + x.e, 0) }, agreg(l));
  });
  const totE = com.reduce((s, x) => s + x.e, 0);
  const geral = agreg(linhas), gCom = agreg(com), gSem = agreg(sem);
  return {
    met, linhas, faixas,
    kpi: { totE, nCom: com.length, votosCom: gCom.v, votosTot: geral.v, geral, com: gCom, sem: gSem },
    quad: { ce: com.filter(x => x.var > 0).length, ca: com.filter(x => x.var < 0).length, se: sem.filter(x => x.var > 0).length, sa: sem.filter(x => x.var < 0).length },
  };
}

/**
 * Bancada no estado. deps: [{ id, nome, total, municipios }] da UF; t1: totais;
 * emPorDep: { id: { mID: R$ } }. Disputa: município com 500+ votos do partido
 * em que dois ou mais eleitos têm, cada um, 25%+ desses votos. Vazio: o
 * partido somado ficou abaixo de 2% dos votos válidos.
 */
function lmaBancada(deps, t1, emPorDep, opcoes = {}) {
  const minVotos = opcoes.minVotos || 500, corte = opcoes.corte || 0.25, vazio = opcoes.vazio || 0.02;
  const DS = deps.slice().sort((a, b) => b.total - a.total);
  const ks = Object.keys(t1);
  const pode = {};
  for (const k of ks) pode[k] = DS.reduce((s, d) => s + ((d.municipios || {})[k] || 0), 0);
  const forte = (d, k) => pode[k] && ((d.municipios || {})[k] || 0) >= corte * pode[k];
  const disputa = ks.filter(k => pode[k] >= minVotos && DS.filter(d => forte(d, k)).length >= 2);
  const fatia = k => (t1[k] || {}).t ? pode[k] / t1[k].t : 0;
  const vazios = ks.filter(k => fatia(k) < vazio);
  const pares = [];
  DS.forEach((a, i) => DS.forEach((b, j) => {
    if (j <= i) return;
    pares.push({ a: a.id, b: b.id, i, j, muns: disputa.filter(k => forte(a, k) && forte(b, k)) });
  }));
  const emB = {};
  for (const d of DS) for (const [k, v] of Object.entries((emPorDep || {})[d.id] || {})) emB[k] = (emB[k] || 0) + v;
  const top = ks.slice().sort((a, b) => pode[b] - pode[a]).slice(0, 15).filter(k => pode[k] > 0);
  const lider = k => Math.max(0, ...DS.map(d => (d.municipios || {})[k] || 0)) / (pode[k] || 1);
  const totPode = DS.reduce((s, d) => s + (d.total || 0), 0), totUf = ks.reduce((s, k) => s + ((t1[k] || {}).t || 0), 0);
  return { DS, pode, disputa, vazios, pares, emB, top, divididos: top.filter(k => lider(k) < 0.5), fatia, totPode, totUf };
}

// ============================================================
// Desenho (extensão)
// ============================================================
// Dois temas: a tela (fundo escuro) e o PDF (papel). As cores categóricas foram
// conferidas com o validador de paleta (daltonismo e contraste) em cada fundo.
const MA_TEMAS = {
  escuro: {
    cores: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'],
    seq: ['#17363c', '#1f5a5f', '#23807f', '#2fa89a', '#58d0b0', '#a6f0cf'],
    var: { perda: ['#7a2a2a', '#b5483f', '#e07a6a'], ganho: ['#2b6e4f', '#3fa36f', '#7fdca4'], zero: '#17363c' },
    vazios: ['#3a2a1c', '#5b3b20', '#17363c', '#1f5a5f', '#23807f', '#58d0b0'],
    ganho: '#3fa36f', perda: '#d0625a', ouro: '#f0c040', contorno: '#0e1c1f', aro: '#142a2f', losango: '#e8ecec',
  },
  papel: {
    cores: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'],
    seq: ['#eef2f1', '#d3ece2', '#a6d9c4', '#6cbf9f', '#2f9a77', '#0b6e4f'],
    var: { perda: ['#b03a2e', '#e07a6a', '#f4c1b8'], ganho: ['#0b6e4f', '#3fa36f', '#b7e6c9'], zero: '#eef2f1' },
    vazios: ['#a8743f', '#e3c7a4', '#eef2f1', '#cfe8dd', '#6cbf9f', '#0b6e4f'],
    ganho: '#2f8f5f', perda: '#c0503f', ouro: '#b07800', contorno: '#ffffff', aro: '#ffffff', losango: '#1d2733',
  },
};
let MA_T = MA_TEMAS.escuro;
const ma = { ultimo: null };

function maR$(n) {
  return Math.abs(n) >= 1e6 ? 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'
    : 'R$ ' + Math.round(n / 1e3).toLocaleString('pt-BR') + ' mil';
}
function maPp(x) {
  if (x == null) return '—';
  const v = Math.abs(x * 100), casas = ma.met === 'pp' && v < 1 ? 2 : 1;   // fatia de um deputado muda em décimos de ponto
  return (x > 0 ? '+' : x < 0 ? '−' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: casas }) + (ma.met === 'pp' ? ' p.p.' : '%');
}
function maPct(x) { return (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
function maAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

function maMapa(geo, larg, cor, dicaDe, circ) {
  const { p, alt } = mpProjetar(geo, larg);
  let s = '', c = '';
  for (const f of geo.features || []) {
    const k = 'm' + (f.properties && f.properties.codarea);
    s += `<path d="${mpCaminho(f.geometry, p)}" fill="${cor(k)}" stroke="${MA_T.contorno}" stroke-width=".35"${dicaDe ? ` data-ma-dica="${maAttr(dicaDe(k))}"` : ''}></path>`;
    const r = circ ? circ(k) : 0;
    if (r) { const q = mpCentro(f.geometry, p); if (q) c += `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${MA_T.ouro}" stroke-width="1.2" pointer-events="none"></circle>`; }
  }
  return `<svg viewBox="0 0 ${larg} ${Math.round(alt)}" width="100%">${s}${c}</svg>`;
}

function maCartoes(l) {
  return `<div class="ma-kpis">${l.map(([v, r, d]) => `<div class="ma-kpi"><div class="v">${v}</div><div class="l">${r}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`).join('')}</div>`;
}
function maGraf(titulo, corpo, nota, largo) {
  return `<div class="ma-graf${largo ? ' largo' : ''}"><h3>${titulo}</h3>${corpo}${nota ? `<div class="ma-nota">${nota}</div>` : ''}</div>`;
}

// ---------- Emendas × votos ----------
function maRetornoHtml(dep, R, geo, em, nomeMun) {
  ma.met = R.met;
  const k = R.kpi, unid = R.met === 'pp' ? 'fatia' : 'votos';
  const sinal = x => x > 0 ? 'up' : x < 0 ? 'down' : '';
  let h = maCartoes([
    [maR$(k.totE), `pagos em municípios de ${labsEsc(dep.uf)} na legislatura`, em.fora ? `+ ${maR$(em.fora)} a favorecidos fora do estado (bancos intermediários incluídos)` : ''],
    [mpNum(k.nCom), 'municípios com emenda', `${maPct(k.votosTot ? k.votosCom / k.votosTot : 0)} dos votos de ${labsEsc(mpAno())} vieram deles`],
    [`<span class="${sinal(k.com.var)}">${maPp(k.com.var)}</span>`, `${unid} onde houve emenda`, `no estado todo: ${maPp(k.geral.var)}`],
    [`<span class="${sinal(k.sem.var)}">${maPp(k.sem.var)}</span>`, `${unid} onde não houve emenda`, `${mpNum(k.sem.a)} → ${mpNum(k.sem.v)} votos`],
  ]) + '<div class="ma-grade">';
  // 1. faixas: barra = variação agregada; ◆ = mediana; linha tracejada = variação no estado
  {
    const W = 540, H = 230, m = { l: 52, r: 10, t: 16, b: 46 }, F = R.faixas;
    const vals = F.flatMap(f => [f.var, f.mediana]).concat([R.kpi.geral.var]).filter(x => x != null);
    const mx = Math.max(0.005, ...vals.map(Math.abs)) * 1.2, y = v => m.t + (H - m.t - m.b) / 2 * (1 - v / mx), bw = (W - m.l - m.r) / F.length;
    let s = [-mx, -mx / 2, 0, mx / 2, mx].map(t => `<line class="${t ? 'g' : 'b'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"></line><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${maPp(t)}</text>`).join('');
    F.forEach((f, i) => {
      const x = m.l + i * bw + bw * 0.22, w = bw * 0.56;
      if (f.var != null && f.n) {
        const y0 = y(0), y1 = y(f.var), top = Math.min(y0, y1), hh = Math.max(1, Math.abs(y1 - y0));
        s += `<rect x="${x}" y="${top}" width="${w}" height="${hh}" rx="3" fill="${f.var >= 0 ? MA_T.ganho : MA_T.perda}"
          data-ma-dica="${maAttr(`<b>${f.r}</b><br>${f.n} municípios · ${f.cresc} com ${unid} maior<br>votos: ${mpNum(f.a)} → ${mpNum(f.v)}<br>variação somada: <b>${maPp(f.var)}</b> · mediana: ${maPp(f.mediana)}${f.e ? '<br>emendas: ' + maR$(f.e) : ''}`)}"></rect>
          <text class="l" x="${x + w / 2}" y="${f.var >= 0 ? top - 5 : top + hh + 13}" text-anchor="middle">${maPp(f.var)}</text>`;
        if (f.mediana != null) { const ym = y(f.mediana); s += `<path d="M${x + w / 2} ${ym - 5}L${x + w / 2 + 5} ${ym}L${x + w / 2} ${ym + 5}L${x + w / 2 - 5} ${ym}Z" fill="${MA_T.losango}" stroke="${MA_T.aro}" stroke-width="1.5" pointer-events="none"></path>`; }
      }
      s += `<text x="${x + w / 2}" y="${H - m.b + 16}" text-anchor="middle">${f.r}</text><text x="${x + w / 2}" y="${H - m.b + 30}" text-anchor="middle" class="p">${f.n} mun.</text>`;
    });
    if (R.kpi.geral.var != null) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(R.kpi.geral.var)}" y2="${y(R.kpi.geral.var)}" stroke="${MA_T.ouro}" stroke-dasharray="5 4" stroke-width="1.5"></line>
      <text x="${W - m.r}" y="${y(R.kpi.geral.var) - 5}" text-anchor="end" style="fill:${MA_T.ouro}">no estado: ${maPp(R.kpi.geral.var)}</text>`;
    h += maGraf(`Variação da ${R.met === 'pp' ? 'fatia' : 'votação'} por faixa de emenda recebida`,
      `<div class="ma-leg"><span><i style="background:${MA_T.ganho}"></i>variação somada da faixa</span><span>◆ mediana dos municípios</span><span><i style="background:${MA_T.ouro};height:2px"></i>variação no estado</span></div><svg viewBox="0 0 ${W} ${H}" width="100%">${s}</svg>`,
      R.met === 'pp' ? `Fatia = votos do deputado ÷ votos válidos do município, em ${labsEsc((dep.anterior || {}).ano || '')} e ${labsEsc(mpAno())}; variação em pontos percentuais. Faixa com poucos municípios pesa pouco: veja o número abaixo de cada barra.`
        : 'Variação % dos votos (os totais por município da eleição anterior não estão no banco — reprocesse a eleição para ver a fatia).');
  }
  // 2. dispersão
  {
    const C = R.linhas.filter(x => x.e > 0 && x.var != null);
    const W = 540, H = 270, m = { l: 56, r: 12, t: 12, b: 34 };
    const lx = v => Math.log10(Math.max(v, 3e4)), X0 = lx(3e4), X1 = lx(Math.max(3e5, ...C.map(x => x.e)) * 1.2);
    const lim = R.met === 'pp' ? Math.max(0.01, lmaMediana(C.map(x => Math.abs(x.var))) * 6 || 0.05) : 2;
    const lo = R.met === 'pp' ? -lim : -1, hi = lim, cl = v => Math.max(lo, Math.min(hi, v));
    const x = v => m.l + (W - m.l - m.r) * (lx(v) - X0) / (X1 - X0), y = v => m.t + (H - m.t - m.b) * (hi - cl(v)) / (hi - lo);
    const ticks = [lo, lo / 2, 0, hi / 2, hi];
    let s = ticks.map(t => `<line class="${t ? 'g' : 'b'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"></line><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t === hi ? '≥' : t === lo ? '≤' : ''}${maPp(t)}</text>`).join('');
    s += [1e5, 3e5, 1e6, 3e6, 1e7, 3e7].filter(t => lx(t) < X1).map(t => `<line class="g" x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}"></line><text x="${x(t)}" y="${H - m.b + 15}" text-anchor="middle">${maR$(t)}</text>`).join('');
    const mxv = Math.max(1, ...C.map(c => c.v));
    for (const c of C.sort((a, b) => b.v - a.v)) {
      s += `<circle cx="${x(c.e).toFixed(1)}" cy="${y(c.var).toFixed(1)}" r="${(3 + 9 * Math.sqrt(c.v / mxv)).toFixed(1)}" fill="${c.var >= 0 ? MA_T.ganho : MA_T.perda}" fill-opacity=".78" stroke="${MA_T.aro}" stroke-width="1.5"
        data-ma-dica="${maAttr(`<b>${labsEsc(nomeMun(c.k))}</b><br>emendas: ${maR$(c.e)}<br>votos: ${mpNum(c.a)} → ${mpNum(c.v)}<br>${unid}: <b>${maPp(c.var)}</b>${c.outrosD > 0 && c.d < 0 ? `<br>outros eleitos do partido: +${mpNum(c.outrosD)} votos aqui` : ''}`)}"></circle>`;
    }
    h += maGraf('Cada município: emenda recebida × variação',
      `<div class="ma-leg"><span><b>${R.quad.ce}</b> com emenda e ${unid} maior · <b>${R.quad.ca}</b> com emenda e ${unid} menor · sem emenda: ${R.quad.se} maior, ${R.quad.sa} menor</span></div><svg viewBox="0 0 ${W} ${H}" width="100%">${s}</svg>`,
      'Eixo horizontal em escala logarítmica; tamanho = votos na eleição atual. Valores extremos ficam na borda.');
  }
  // 3. top 15 por emenda: variação em votos, com o que outros eleitos do partido ganharam no mesmo município
  {
    const T = R.linhas.filter(x => x.e > 0).sort((a, b) => b.e - a.e).slice(0, 15);
    const W = 540, rh = 20, H = T.length * rh + 26, m = { l: 230, r: 64 }, mx = Math.max(1, ...T.map(t => Math.abs(t.d))), cx = m.l + (W - m.l - m.r) / 2, kk = (W - m.l - m.r) / 2 / mx;
    let s = `<line class="b" x1="${cx}" x2="${cx}" y1="0" y2="${H - 20}"></line>`;
    for (const [i, t] of T.entries()) {
      const yy = i * rh + 4, w = Math.max(1, Math.abs(t.d) * kk), dentro = w > 60, n = nomeMun(t.k);
      const transf = t.d < 0 && t.outrosD > 0;
      s += `<text class="l" x="4" y="${yy + 12}">${labsEsc(n.length > 19 ? n.slice(0, 18) + '…' : n)}</text><text x="${m.l - 10}" y="${yy + 12}" text-anchor="end">${maR$(t.e)}</text>
        <rect x="${t.d >= 0 ? cx : cx - w}" y="${yy + 2}" width="${w}" height="${rh - 6}" rx="3" fill="${t.d >= 0 ? MA_T.ganho : MA_T.perda}"
          data-ma-dica="${maAttr(`<b>${labsEsc(n)}</b><br>emendas: ${maR$(t.e)}<br>votos: ${mpNum(t.a)} → ${mpNum(t.v)} (${t.d > 0 ? '+' : ''}${mpNum(t.d)})<br>${unid}: ${maPp(t.var)}${t.outrosD ? `<br>outros eleitos do partido aqui: ${t.outrosD > 0 ? '+' : ''}${mpNum(t.outrosD)} votos` : ''}`)}"></rect>
        <text class="l" x="${dentro ? (t.d >= 0 ? cx + w - 4 : cx - w + 4) : (t.d >= 0 ? cx + w + 4 : cx - w - 4)}" y="${yy + 12}" text-anchor="${dentro !== (t.d >= 0) ? 'start' : 'end'}"${dentro ? ' style="fill:#fff"' : ''}>${t.d > 0 ? '+' : ''}${mpNum(t.d)}</text>
        ${transf ? `<text x="${W - 2}" y="${yy + 12}" text-anchor="end" style="fill:${MA_T.ouro}" data-ma-dica="${maAttr(`Outros eleitos do partido ganharam ${mpNum(t.outrosD)} votos em ${labsEsc(n)}`)}">↔ +${mpNum(t.outrosD)}</text>` : ''}`;
    }
    s += `<text x="${cx - 6}" y="${H - 4}" text-anchor="end">← perdeu votos</text><text x="${cx + 6}" y="${H - 4}">ganhou votos →</text>`;
    h += maGraf('Os 15 municípios que mais receberam emendas', T.length ? `<svg viewBox="0 0 ${W} ${H}" width="100%">${s}</svg>` : '<div class="sub">Sem emendas com município no estado.</div>',
      `À esquerda, o valor pago; a barra é a diferença de votos. <span style="color:${MA_T.ouro}">↔ +N</span>: votos que outros eleitos do partido ganharam no mesmo município — a perda pode ter ficado no partido.`);
  }
  // 4. mapa
  {
    const dv = {}; R.linhas.forEach(x => { dv[x.k] = x; });
    const abs = R.linhas.map(x => Math.abs(x.var || 0)).filter(Boolean).sort((a, b) => a - b), mx = abs[Math.floor(0.95 * abs.length)] || 1;
    const cor = kk => { const x = dv[kk], d = x ? x.var : 0; if (!d) return MA_T.var.zero; const f = Math.abs(d) / mx, i = f > 0.4 ? 0 : f > 0.12 ? 1 : 2; return (d > 0 ? MA_T.var.ganho : MA_T.var.perda)[i]; };
    const me = Math.max(1, ...Object.values(em.mun));
    h += maGraf(`No mapa: variação da ${R.met === 'pp' ? 'fatia' : 'votação'} e onde chegou emenda`,
      `<div class="ma-leg">${MA_T.var.perda.map(c => `<i style="background:${c}"></i>`).join('')} menor &nbsp; ${MA_T.var.ganho.slice().reverse().map(c => `<i style="background:${c}"></i>`).join('')} maior &nbsp; <span style="color:${MA_T.ouro}">○</span> emenda (tamanho pelo valor)</div>`
      + maMapa(geo, 540, cor, kk => { const x = dv[kk]; return x ? `<b>${labsEsc(nomeMun(kk))}</b><br>${mpNum(x.a)} → ${mpNum(x.v)} votos · ${maPp(x.var)}${x.e ? '<br>emendas: ' + maR$(x.e) : ''}` : labsEsc(nomeMun(kk)); },
        kk => em.mun[kk] ? 2 + 9 * Math.sqrt(em.mun[kk] / me) : 0));
  }
  return h + '</div><div class="ma-nota">Emendas: tudo o que foi pago ao deputado-autor entre o início do mandato e o mês da eleição, pelo município do favorecido no arquivo de dados abertos do Portal da Transparência. Favorecido com sede em outro município (governo do estado, entidade da capital) conta onde está a sede. Votos: TSE. O painel mostra associação, não efeito: emenda costuma ir para onde o deputado já é forte.</div>';
}

// ---------- Bancada no estado ----------
function maBancadaHtml(uf, B, geo, t1, nomeMun) {
  const cor = Object.fromEntries(B.DS.map((d, i) => [d.id, MA_T.cores[i % MA_T.cores.length]]));
  const totEm = Object.values(B.emB).reduce((s, v) => s + v, 0);
  let h = maCartoes([
    [mpNum(B.totPode), `votos dos ${B.DS.length} eleitos do ${labsEsc(MP_PARTIDO.sigla)}`, `${maPct(B.totUf ? B.totPode / B.totUf : 0)} dos votos válidos do estado`],
    [mpNum(B.disputa.length), 'municípios em disputa interna', 'dois ou mais eleitos com 25%+ dos votos do partido (500+ votos)'],
    [mpNum(B.vazios.length), 'municípios com menos de 2% para o partido', 'onde nenhum eleito é referência'],
    [mpNum(Object.keys(B.emB).length), 'municípios com emenda da bancada', totEm ? maR$(totEm) + ' na legislatura' : 'sem emendas no banco'],
  ]) + '<div class="ma-grade">';
  // 1. pequenos múltiplos
  {
    const fat = (d, k) => (t1[k] || {}).t ? ((d.municipios || {})[k] || 0) / t1[k].t : 0;
    const todas = B.DS.flatMap(d => Object.keys(t1).map(k => fat(d, k))).filter(Boolean).sort((a, b) => a - b);
    const mxF = todas[Math.floor(0.9 * todas.length)] || 0.01;   // escala pelo 90º percentil: o tom mais claro marca os redutos
    const c = f => !f ? MA_T.seq[0] : MA_T.seq[Math.min(5, 1 + Math.floor(4 * Math.min(1, f / mxF)))];
    h += maGraf('Onde cada eleito é forte',
      `<div class="ma-leg"><i style="background:${MA_T.seq[0]}"></i>0 ${MA_T.seq.slice(1).map(x => `<i style="background:${x}"></i>`).join('')} ${maPct(mxF)} ou mais dos votos válidos do município</div>
      <div class="ma-mini">${B.DS.map(d => `<div><b><i style="background:${cor[d.id]}"></i>${labsEsc(d.nome)}</b><span class="sub">${mpNum(d.total)} votos</span>`
        + maMapa(geo, 300, k => c(fat(d, k)), k => `<b>${labsEsc(nomeMun(k))}</b><br>${labsEsc(d.nome)}: ${mpNum((d.municipios || {})[k] || 0)} votos (${maPct(fat(d, k))})`) + '</div>').join('')}</div>`, '', true);
  }
  // 2. barras 100%
  {
    const W = 1100, rh = 21, m = { l: 180, r: 96 }, H = B.top.length * rh + 6;
    let s = '';
    B.top.forEach((t, i) => {
      let x = m.l; const yy = i * rh + 3, kk = (W - m.l - m.r) / B.pode[t];
      s += `<text class="l" x="4" y="${yy + 13}">${labsEsc(nomeMun(t))}</text>`;
      for (const d of B.DS) {
        const v = (d.municipios || {})[t] || 0, w = v * kk;
        if (w < 0.5) continue;
        s += `<rect x="${x.toFixed(1)}" y="${yy + 2}" width="${Math.max(0, w - 2).toFixed(1)}" height="${rh - 6}" rx="2" fill="${cor[d.id]}" data-ma-dica="${maAttr(`<b>${labsEsc(nomeMun(t))}</b><br>${labsEsc(d.nome)}: ${mpNum(v)} votos (${maPct(v / B.pode[t])} do partido aqui)`)}"></rect>`;
        x += w;
      }
      s += `<text x="${W - m.r + 8}" y="${yy + 13}">${mpNum(B.pode[t])} votos</text>`;
    });
    h += maGraf(`Os ${B.top.length} municípios com mais votos do partido — quem levou cada parte`,
      `<div class="ma-leg">${B.DS.map(d => `<span><i style="background:${cor[d.id]}"></i>${labsEsc(d.nome)}</span>`).join('')}</div><svg viewBox="0 0 ${W} ${H}" width="100%">${s}</svg>`,
      `Em % dos votos do partido em cada município. Em ${B.divididos.length} deles nenhum eleito tem metade desses votos.`, true);
  }
  // 3. matriz de sobreposição
  {
    const n = B.DS.length, cel = n > 6 ? 40 : 52, m = { l: 160, t: 78 }, W = m.l + n * cel + 50, H = m.t + n * cel + 10;
    const mx = Math.max(1, ...B.pares.map(p => p.muns.length));
    let s = B.DS.map((d, i) => `<text class="l" x="${m.l - 8}" y="${m.t + i * cel + cel / 2 + 4}" text-anchor="end">${labsEsc(d.nome)}</text><text class="l" transform="translate(${m.l + i * cel + cel / 2 + 4},${m.t - 8}) rotate(-40)">${labsEsc(d.nome.split(' ').slice(-1)[0])}</text>`).join('');
    for (const p of B.pares) {
      const v = p.muns.length, a = B.DS[p.i], b = B.DS[p.j];
      s += `<rect x="${m.l + p.j * cel + 1}" y="${m.t + p.i * cel + 1}" width="${cel - 2}" height="${cel - 2}" rx="4" fill="${MA_T.seq[Math.min(4, Math.ceil(4 * v / mx))]}"
        data-ma-dica="${maAttr(`<b>${labsEsc(a.nome)} × ${labsEsc(b.nome)}</b><br>${v} município(s) em disputa${v ? ':<br>' + p.muns.slice(0, 10).map(k => labsEsc(nomeMun(k))).join(', ') + (v > 10 ? '…' : '') : ''}`)}"></rect>
        <text class="l" x="${m.l + p.j * cel + cel / 2}" y="${m.t + p.i * cel + cel / 2 + 4}" text-anchor="middle" pointer-events="none"${MA_T === MA_TEMAS.papel && Math.ceil(4 * v / mx) >= 4 ? ' style="fill:#fff"' : ''}>${v}</text>`;
    }
    h += maGraf('Sobreposição: quem disputa o mesmo eleitorado', n > 1 ? `<svg viewBox="0 0 ${W} ${H}" width="100%">${s}</svg>` : '<div class="sub">Um eleito só no estado.</div>',
      'Municípios com 500+ votos do partido em que os dois têm, cada um, 25% ou mais desses votos.');
  }
  // 4. força somada e vazios
  {
    const pal = MA_T.vazios;
    const c = k => { const f = B.fatia(k); return f < 0.01 ? pal[0] : f < 0.02 ? pal[1] : f < 0.05 ? pal[2] : f < 0.1 ? pal[3] : f < 0.2 ? pal[4] : pal[5]; };
    const me = Math.max(1, ...Object.values(B.emB));
    h += maGraf('Força do partido somada — e os vazios',
      `<div class="ma-leg"><i style="background:${pal[0]}"></i>&lt;1% <i style="background:${pal[1]}"></i>1–2% <i style="background:${pal[2]}"></i>2–5% <i style="background:${pal[3]}"></i>5–10% <i style="background:${pal[4]}"></i>10–20% <i style="background:${pal[5]}"></i>20%+ &nbsp; <span style="color:${MA_T.ouro}">○</span> emenda da bancada</div>`
      + maMapa(geo, 540, c, k => `<b>${labsEsc(nomeMun(k))}</b><br>${labsEsc(MP_PARTIDO.sigla)}: ${mpNum(B.pode[k] || 0)} votos (${maPct(B.fatia(k))})${B.emB[k] ? '<br>emendas da bancada: ' + maR$(B.emB[k]) : ''}`,
        k => B.emB[k] ? 1.5 + 7 * Math.sqrt(B.emB[k] / me) : 0),
      'Marrom: menos de 2% dos votos válidos para os eleitos do partido somados.');
  }
  return h + '</div>';
}

// ---------- dados e cliques ----------
function maDicas(raiz) {
  let dica = document.getElementById('maDica');
  if (!dica) { dica = document.createElement('div'); dica.id = 'maDica'; document.body.appendChild(dica); }
  raiz.addEventListener('mousemove', ev => {
    const el = ev.target.closest && ev.target.closest('[data-ma-dica]');
    if (!el) { dica.style.display = 'none'; return; }
    dica.innerHTML = el.getAttribute('data-ma-dica');
    dica.style.display = 'block';
    dica.style.left = Math.min(window.innerWidth - 280, ev.clientX + 14) + 'px';
    dica.style.top = (ev.clientY + 12) + 'px';
  });
  raiz.addEventListener('mouseleave', () => { dica.style.display = 'none'; });
}

/** Pagamentos da legislatura do autor (por município do favorecido), do banco. null = ainda não processado. */
async function maPagosLegislatura(dep) {
  const meta = await mpFavMeta();
  if (!meta || !meta.legislaturas || !meta.legislaturas[mpAno()]) return null;
  return (await mpFb(`${MP_BASE}/favorecidos/legislatura/${mpAno()}/${lmnChave(lmnNomeAutor(dep.nome))}`).catch(() => null)) || {};
}

function maPedirFavorecido(onde) {
  mpEl('mpResultado').innerHTML = `<div class="labs-caixa"><h3>${onde}</h3><div class="sub">Falta localizar as emendas por município: o painel usa o arquivo de dados abertos do Portal da Transparência
    (pagamentos por favorecido). É um clique, uma vez para toda a bancada.</div><button id="mpFavBaixar" class="btn-gerar" style="margin-top:8px">📍 Localizar os municípios pelo favorecido</button></div>`;
  mpEl('mpFavBaixar').addEventListener('click', mpFavProcessarClick);
}

async function maExibir(visao) {
  const depId = mpEl('mpDep').value, dep = mp.dados && mp.dados[depId];
  if (!dep) return;
  ma.ultimo = visao;
  const bts = ['mpMostrar', 'maRetorno', 'maBancada'].map(mpEl).filter(Boolean);
  bts.forEach(b => { b.disabled = true; });
  mpEl('mpResultado').innerHTML = '';
  try {
    labsStatus('mpStatus', 'Carregando o mapa, os totais e as emendas…', 'loading');
    const uf = dep.uf, ano = mpAno();
    const [geo, t1, t0, ibge] = await Promise.all([mpMalha(uf), mpFb(`${MP_BASE}/${ano}/municipios/${uf}`), mpFb(`${MP_BASE}/${ano}/anterior/municipios/${uf}`).catch(() => null), mpIbgeUf(uf)]);
    const resolver = lmnResolvedor(ibge, uf);
    const doUf = Object.entries(mp.dados).filter(([, d]) => d.uf === uf).map(([id, d]) => Object.assign({ id }, d));
    const nomeMun = k => ((t1 || {})[k] || {}).n || k;
    let html;
    if (visao === 'retorno') {
      if (!dep.anterior) throw new Error(`${dep.nome} não concorreu a deputado federal em ${LMN_ANTERIOR[ano] || 'na eleição anterior'} na mesma UF: não há variação a comparar`);
      const pagos = await maPagosLegislatura(dep);
      if (pagos === null) { labsStatus('mpStatus', ''); maPedirFavorecido('Emendas × votos'); return; }
      const em = lmaEmendasDaUf(pagos, uf, resolver);
      const R = lmaRetorno(dep, doUf.filter(d => d.id !== depId), t1 || {}, t0, em.mun);
      ma.ctx = { visao, dep, R, geo, em, nomeMun, ano };
      html = `<div class="ma-tit"><b>Emendas × votos · ${labsEsc(dep.nome)} (${labsEsc(uf)})</b> <span class="sub">eleição ${labsEsc(ano)} comparada com ${labsEsc(dep.anterior.ano)}</span>${MA_BT_PDF}</div>` + maRetornoHtml(dep, R, geo, em, nomeMun);
    } else {
      const meta = await mpFavMeta();
      const emPorDep = {};
      if (meta && meta.legislaturas && meta.legislaturas[ano]) {
        for (const d of doUf) emPorDep[d.id] = lmaEmendasDaUf((await mpFb(`${MP_BASE}/favorecidos/legislatura/${ano}/${lmnChave(lmnNomeAutor(d.nome))}`).catch(() => null)) || {}, uf, resolver).mun;
      }
      const B = lmaBancada(doUf, t1 || {}, emPorDep);
      ma.ctx = { visao, uf, B, geo, t1: t1 || {}, nomeMun, ano, semEmendas: !(meta && meta.legislaturas) };
      html = `<div class="ma-tit"><b>Bancada do ${labsEsc(MP_PARTIDO.sigla)} · ${labsEsc(uf)}</b> <span class="sub">${B.DS.length} eleito(s) em ${labsEsc(ano)}${meta && meta.legislaturas ? '' : ' · emendas: localize pelo favorecido para ver os círculos'}</span>${MA_BT_PDF}</div>` + maBancadaHtml(uf, B, geo, t1 || {}, nomeMun);
    }
    labsStatus('mpStatus', '');
    mpEl('mpResultado').innerHTML = `<div class="ma">${html}</div>`;
    maDicas(mpEl('mpResultado'));
    if (mpEl('maPdf')) mpEl('maPdf').addEventListener('click', maExportarPdf);
  } catch (e) {
    labsStatus('mpStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bts.forEach(b => { b.disabled = false; });
  }
}

// ---------- PDF: o mesmo painel em grade, em A4 deitado, nas cores de papel ----------
const MA_BT_PDF = '<button id="maPdf" class="btn-mini" style="float:right" title="Relatório em PDF (A4 deitado), com a logo">⬇ PDF</button>';

function maEscPdf(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** HTML do relatório (aba própria, botão "Salvar em PDF"). ctx = ma.ctx; op = { logo, agora }. */
function maRelatorioHtml(ctx, op = {}) {
  const antes = MA_T;
  MA_T = MA_TEMAS.papel;
  let corpo, titulo, sub, kicker;
  try {
    if (ctx.visao === 'retorno') {
      corpo = maRetornoHtml(ctx.dep, ctx.R, ctx.geo, ctx.em, ctx.nomeMun);
      kicker = `Mapa Territorial · emendas × votos · eleição de ${ctx.ano}`;
      titulo = `${ctx.dep.nome} (${ctx.dep.uf})`;
      sub = `Emendas pagas na legislatura × variação da fatia nos votos válidos de cada município, ${(ctx.dep.anterior || {}).ano || ''} → ${ctx.ano}`;
    } else {
      corpo = maBancadaHtml(ctx.uf, ctx.B, ctx.geo, ctx.t1, ctx.nomeMun);
      kicker = `Mapa Territorial · bancada no estado · eleição de ${ctx.ano}`;
      titulo = `Bancada do ${MP_PARTIDO.sigla} · ${ctx.uf}`;
      sub = `${ctx.B.DS.length} eleito(s) em ${ctx.ano}: onde cada um é forte, quem divide cada município, sobreposição e vazios${ctx.semEmendas ? ' (emendas ainda não localizadas)' : ''}`;
    }
  } finally { MA_T = antes; }
  const agora = op.agora || new Date();
  const quando = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${maEscPdf(titulo)} — ${maEscPdf(kicker)}</title><style>
  @page { size: A4 landscape; margin: 10mm; }
  :root { --verde: #0B8A4B; --verde-esc: #0b5e3a; --tinta: #1d2733; --tinta2: #5b6b7b; --grade: #dfe5ea; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 9.5pt; line-height: 1.4; color: var(--tinta); margin: 0; background: #fff; }
  .folha { max-width: 277mm; margin: 0 auto; padding: 0 0 12px; }
  .cab { display: flex; align-items: center; gap: 16px; padding: 4px 0 8px; }
  .cab img { height: 40px; } .cab .tit { flex: 1; }
  .cab .kicker { font-size: 8pt; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tinta2); }
  .cab h1 { font-size: 18pt; margin: 0; line-height: 1.15; color: var(--verde-esc); }
  .cab .sub { font-size: 9pt; color: var(--tinta2); margin-top: 2px; }
  .cab .meta { text-align: right; font-size: 8pt; color: var(--tinta2); }
  .filete { height: 5px; margin: 0 0 10px; border-radius: 3px; background: linear-gradient(90deg, #0B8A4B 0 40%, #7C9A2F 40% 62%, #1F5FA8 62% 82%, #D9531E 82% 100%); }
  .ma-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
  .ma-kpi { border: 1px solid var(--grade); border-top: 4px solid var(--verde); border-radius: 8px; padding: 5px 10px; break-inside: avoid; }
  .ma-kpi .v { font-size: 15pt; font-weight: 700; } .ma-kpi .l, .ma-kpi .d { font-size: 8pt; color: var(--tinta2); }
  .ma-kpi .up { color: #0b6e4f; } .ma-kpi .down { color: #b03a2e; }
  .ma-grade { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ma-graf { border: 1px solid var(--grade); border-radius: 8px; padding: 8px 10px; break-inside: avoid; min-width: 0; } .ma-graf.largo { grid-column: span 2; }
  .ma-graf h3 { font-size: 10pt; color: var(--verde-esc); margin: 0 0 3px; }
  .ma-graf svg { display: block; max-height: 118mm; }
  .ma-graf svg text { fill: var(--tinta2); font-size: 11px; } .ma-graf svg text.l { fill: var(--tinta); } .ma-graf svg text.p { font-size: 10px; }
  .ma-graf svg line.g { stroke: #e6ebef; } .ma-graf svg line.b { stroke: #b9c4cc; }
  .ma-leg { display: flex; flex-wrap: wrap; gap: 3px 10px; font-size: 8pt; color: var(--tinta2); margin: 1px 0 4px; align-items: center; }
  .ma-leg i, .ma-mini b i { display: inline-block; width: 10px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; border: 1px solid #d5dbe0; }
  .ma-nota { color: var(--tinta2); font-size: 7.5pt; margin-top: 4px; }
  .ma-mini { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; } .ma-mini b { display: block; font-size: 9pt; } .ma-mini .sub { font-size: 8pt; color: var(--tinta2); }
  .ma-mini svg { max-height: 52mm; }
  .barra-ferramentas { background: #eef3fb; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; display: flex; align-items: center; gap: 10px; border-radius: 6px; }
  .barra-ferramentas button { background: var(--verde); color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .rodape { margin-top: 10px; border-top: 1px solid var(--grade); padding-top: 5px; font-size: 7.5pt; color: var(--tinta2); }
  @media print { .noprint { display: none !important; } .folha { max-width: none; } }
</style></head><body><div class="folha">
<div class="barra-ferramentas noprint"><button id="btn-pdf" type="button">⬇ Salvar em PDF</button>
  <span>No diálogo, escolha <strong>Salvar como PDF</strong> (a página já vem deitada). As cores vão junto.</span></div>
<div class="cab">${op.logo ? `<img src="${maEscPdf(op.logo)}" alt="Podemos">` : ''}
  <div class="tit"><div class="kicker">${maEscPdf(kicker)}</div><h1>${maEscPdf(titulo)}</h1><div class="sub">${maEscPdf(sub)}</div></div>
  <div class="meta">Gerado em ${maEscPdf(quando)}<br>SisPode · Labs</div></div>
<div class="filete"></div>
${corpo}
<div class="rodape">Liderança do Podemos na Câmara dos Deputados · relatório gerado pelo SisPode (Labs · Mapa Territorial) com dados do TSE, do IBGE e do Portal da Transparência.</div>
</div></body></html>`;
}

async function maExportarPdf() {
  if (!ma.ctx) return;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para gerar o relatório.'); return; }
  const logo = typeof carregarLogoDataUrl === 'function' ? await carregarLogoDataUrl() : null;
  w.document.write(maRelatorioHtml(ma.ctx, { logo }));
  w.document.close();
  // A aba herda a CSP da extensão (script-src 'self'): o botão é ligado daqui.
  const ligar = () => { const b = w.document.getElementById('btn-pdf'); if (b) b.addEventListener('click', () => w.print()); };
  if (w.document.readyState === 'complete') ligar(); else w.addEventListener('load', ligar);
}

/** Depois de processar o favorecido: reabre a análise que estava na tela (true se havia). */
function maReexibir() {
  if (!ma.ultimo) return false;
  maExibir(ma.ultimo);
  return true;
}

if (typeof document !== 'undefined' && document.getElementById('maRetorno')) {
  document.getElementById('maRetorno').addEventListener('click', () => maExibir('retorno'));
  document.getElementById('maBancada').addEventListener('click', () => maExibir('bancada'));
  document.getElementById('mpMostrar').addEventListener('click', () => { ma.ultimo = null; });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { LMA_FAIXAS, lmaMediana, lmaEmendasDaUf, lmaRetorno, lmaBancada, MA_TEMAS };
