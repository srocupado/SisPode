'use strict';
// Apuração · De onde vieram os votos — para qualquer candidato a deputado
// federal, estadual ou distrital (botão 📍 na linha do candidato).
//
// Dois níveis, pelos arquivos de dados abertos do TSE (cdn.tse.jus.br, lidos
// por partes — zip-remoto.js — direto no navegador, sem servidor):
//   · município e zona eleitoral: votacao_candidato_munzona_{ano}.zip, só o
//     arquivo do estado (de menos de 1 MB a ~42 MB comprimidos, em SP);
//   · local de votação (escola): votacao_secao_{ano}_{UF}.zip + coordenadas do
//     cadastro de locais (eleitorado_local_votacao_{ano}.zip). No DF — um
//     município só — é o nível que interessa e vem junto (~31 MB); nos outros
//     estados é opcional, com o tamanho dito antes (SP: ~770 MB).
// O mapa por município usa a malha do IBGE; o de locais, as coordenadas que o
// TSE publica. O relatório sai na tela e em PDF (impressão de #saImpressao,
// como a cláusula de barreira).
//
// Depende de zip-remoto.js, labs-mapa-nucleo.js (CSV e nomes de município) e
// apuracao-site.js (saEsc, saFmt, saOp).

const AO_TSE = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const AO_IBGE = 'https://servicodados.ibge.gov.br/api';
const AO_ZIP = {
  munzona: ano => `${AO_TSE}/votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`,
  secao: (ano, uf) => `${AO_TSE}/votacao_secao/votacao_secao_${ano}_${uf.toUpperCase()}.zip`,
  locais: ano => `${AO_TSE}/eleitorado_locais_votacao/eleitorado_local_votacao_${ano}.zip`,
};
const ao = { indices: {}, ibge: {}, atual: null, ocupado: false };
// No Node (testes), o leitor de CSV vem por require; na página já é global.
const AO_CAMPOS = typeof lmnCampos === 'function' ? lmnCampos : require('../labs-mapa-nucleo.js').lmnCampos;

// ============================================================
// Leitura (pura)
// ============================================================
/** Lê um CSV do TSE pelo cabeçalho: devolve linha(l) que chama fn(v) com v('COLUNA'). */
function aoCsv(exigidas, fn) {
  let ix = null;
  return l => {
    const c = AO_CAMPOS(l);
    if (!ix) {
      ix = {};
      c.forEach((h, i) => { ix[h.replace(/^﻿/, '').trim()] = i; });
      const falta = exigidas.filter(h => !(h in ix));
      if (falta.length) throw new Error('arquivo do TSE fora do formato esperado (faltam ' + falta.join(', ') + ')');
      return;
    }
    fn(k => (ix[k] == null ? '' : (c[ix[k]] || '').trim()));
  };
}

/**
 * Votos do candidato por município e por zona, no 1º turno, e o total de votos
 * nominais do cargo em cada um (para a fatia). cargo: '6', '7' ou '8'.
 * resultado(): { cand: { nome, partido, sit } | null, total, mun: { cd: { n, v, t } }, zonas: { 'cd|z': { cd, n, z, v, t } } }
 */
function aoLeitorMunzona(cargo, numero) {
  const mun = {}, zonas = {};
  let cand = null, total = 0;
  const linha = aoCsv(['CD_MUNICIPIO', 'NM_MUNICIPIO', 'NR_ZONA', 'CD_CARGO', 'NR_CANDIDATO', 'NR_TURNO'], v => {
    if (v('CD_CARGO') !== String(cargo) || v('NR_TURNO') !== '1') return;
    const q = Number(v('QT_VOTOS_NOMINAIS_VALIDOS') || v('QT_VOTOS_NOMINAIS')) || 0;
    const cd = v('CD_MUNICIPIO'), z = v('NR_ZONA'), kz = cd + '|' + z;
    const m = (mun[cd] = mun[cd] || { n: v('NM_MUNICIPIO'), v: 0, t: 0 });
    const zz = (zonas[kz] = zonas[kz] || { cd, n: m.n, z, v: 0, t: 0 });
    m.t += q; zz.t += q;
    if (v('NR_CANDIDATO') === String(numero)) {
      m.v += q; zz.v += q; total += q;
      if (!cand) cand = { nome: v('NM_URNA_CANDIDATO'), partido: v('SG_PARTIDO'), sit: v('DS_SIT_TOT_TURNO') };
    }
  });
  return { linha, resultado: () => ({ cand, total, mun, zonas }) };
}

/** Votos por local de votação (soma das seções), 1º turno: { 'z|local': { z, l, nome, end, v, t } }. */
function aoLeitorSecao(cargo, numero) {
  const loc = {};
  let total = 0;
  const linha = aoCsv(['NR_ZONA', 'CD_CARGO', 'NR_VOTAVEL', 'QT_VOTOS', 'NR_LOCAL_VOTACAO', 'NR_TURNO'], v => {
    if (v('CD_CARGO') !== String(cargo) || v('NR_TURNO') !== '1') return;
    const z = v('NR_ZONA'), l = v('NR_LOCAL_VOTACAO'), k = z + '|' + l, nr = v('NR_VOTAVEL'), q = Number(v('QT_VOTOS')) || 0;
    const x = (loc[k] = loc[k] || { z, l, nome: v('NM_LOCAL_VOTACAO'), end: v('DS_LOCAL_VOTACAO_ENDERECO'), mun: v('NM_MUNICIPIO'), v: 0, t: 0 });
    if (nr.length >= 4) x.t += q;   // nominal: número de candidato (legenda, branco e nulo têm 2 dígitos)
    if (nr === String(numero)) { x.v += q; total += q; }
  });
  return { linha, resultado: () => ({ total, loc }) };
}

/** Coordenadas e bairro dos locais de votação: { 'z|local': { la, lo, bairro } }. */
function aoLeitorLocais() {
  const out = {};
  const linha = aoCsv(['NR_ZONA', 'NR_LOCAL_VOTACAO', 'NR_LATITUDE', 'NR_LONGITUDE'], v => {
    const k = v('NR_ZONA') + '|' + v('NR_LOCAL_VOTACAO');
    if (out[k]) return;
    const la = parseFloat(v('NR_LATITUDE').replace(',', '.')), lo = parseFloat(v('NR_LONGITUDE').replace(',', '.'));
    out[k] = { la: isFinite(la) && la !== -1 && la !== 0 ? la : null, lo: isFinite(lo) && lo !== -1 && lo !== 0 ? lo : null, bairro: v('NM_BAIRRO') };
  });
  return { linha, resultado: () => out };
}

/** Os itens com voto, do maior para o menor, e a fatia dos `n` primeiros no total. */
function aoOrdenar(obj) { return Object.values(obj).filter(x => x.v > 0).sort((a, b) => b.v - a.v); }
function aoConcentracao(lista, total, n = 10) { return total ? lista.slice(0, n).reduce((s, x) => s + x.v, 0) / total : 0; }

/** Quebras por quantis (5 classes) das fatias positivas. */
function aoQuebras(vals) {
  const s = vals.filter(x => x > 0).sort((a, b) => a - b);
  if (!s.length) return [];
  return [0.2, 0.4, 0.6, 0.8].map(q => s[Math.min(s.length - 1, Math.floor(q * s.length))]);
}

// ============================================================
// Desenho (SVG com classes: a tela e a impressão pintam cada uma no seu tema)
// ============================================================
function aoAneis(g) { return !g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []; }
function aoProj(features, larg) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of features) for (const a of aoAneis(f.geometry)) for (const [x, y] of a) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = Math.cos((y0 + y1) / 2 * Math.PI / 180), e = larg / ((x1 - x0) * k || 1);
  return { p: ([x, y]) => [(x - x0) * k * e, (y1 - y) * e], alt: Math.max(1, (y1 - y0) * e) };
}
function aoCaminho(g, p) { return aoAneis(g).map(a => a.map((c, i) => (i ? 'L' : 'M') + p(c).map(v => v.toFixed(1)).join(' ')).join('') + 'Z').join(''); }
function aoPct(x) { return (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: x && x < 0.01 ? 2 : 1 }) + '%'; }

/** Mapa por município: cor pela fatia do candidato nos votos nominais do cargo no município. */
function aoMapaMunicipios(geo, porIbge) {
  const feats = geo.features || [];
  const { p, alt } = aoProj(feats, 760);
  const fat = k => { const m = porIbge[k]; return m && m.t ? m.v / m.t : 0; };
  const qb = aoQuebras(feats.map(f => fat('m' + f.properties.codarea)));
  const classe = f => { if (!f) return 0; let i = 1; for (const q of qb) if (f > q) i++; return Math.min(5, i); };
  let s = '';
  for (const f of feats) {
    const k = 'm' + f.properties.codarea, m = porIbge[k];
    s += `<path class="ao-q${classe(fat(k))}" d="${aoCaminho(f.geometry, p)}"><title>${saEsc(m ? m.n : '')}${m ? `: ${saFmt(m.v)} votos (${aoPct(fat(k))} dos votos nominais)` : ''}</title></path>`;
  }
  const leg = qb.length ? ['sem voto', `até ${aoPct(qb[0])}`, `${aoPct(qb[0])} a ${aoPct(qb[1])}`, `${aoPct(qb[1])} a ${aoPct(qb[2])}`, `${aoPct(qb[2])} a ${aoPct(qb[3])}`, `acima de ${aoPct(qb[3])}`] : [];
  return `<svg class="ao-mapa" viewBox="0 0 760 ${Math.round(alt)}" role="img" aria-label="Mapa dos votos por município">${s}</svg>
    <div class="ao-leg">${leg.map((r, i) => `<span><i class="ao-q${i}"></i>${r}</span>`).join('')}<span>dos votos nominais do cargo no município</span></div>`;
}

/** Mapa por local de votação: contorno do estado e um círculo por escola (área ∝ votos). */
function aoMapaLocais(geo, pontos, larg = 760, moldura = null) {
  const feats = geo.features || [];
  let p, alt, fundo = '';
  if (moldura) {
    const { la0, lo0, meia, k } = moldura;
    p = ([lo, la]) => [((lo - (lo0 - meia / k)) / (2 * meia / k)) * larg, (((la0 + meia) - la) / (2 * meia)) * larg];
    alt = larg;
    fundo = `<rect class="ao-zoom" width="${larg}" height="${larg}"></rect>`;
  } else {
    ({ p, alt } = aoProj(feats, larg));
    fundo = feats.map(f => `<path class="ao-uf" d="${aoCaminho(f.geometry, p)}"></path>`).join('');
  }
  const vmax = Math.max(1, ...pontos.map(x => x.v));
  const c = pontos.slice().sort((a, b) => b.v - a.v).map(x => {
    const [cx, cy] = p([x.lo, x.la]);
    return `<circle class="ao-pt" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${((moldura ? 5 : 3) + (moldura ? 24 : 15) * Math.sqrt(x.v / vmax)).toFixed(1)}"><title>${saEsc(x.nome)}: ${saFmt(x.v)} voto(s)</title></circle>`
      + (x.ordem && x.ordem <= (moldura ? 20 : 6) ? `<text class="ao-rot" x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}">${x.ordem}</text>` : '');
  }).join('');
  return `<svg class="ao-mapa" viewBox="0 0 ${larg} ${Math.round(alt)}" role="img" aria-label="Mapa dos locais de votação">${fundo}${c}</svg>`;
}

/** Moldura do detalhe: todos os locais do bairro mais forte, com folga. */
function aoMoldura(pts) {
  if (pts.length < 2) return null;
  const las = pts.map(x => x.la), los = pts.map(x => x.lo);
  const la0 = (Math.min(...las) + Math.max(...las)) / 2, lo0 = (Math.min(...los) + Math.max(...los)) / 2;
  const k = Math.cos(la0 * Math.PI / 180);
  const meia = Math.max((Math.max(...las) - Math.min(...las)) / 2, (Math.max(...los) - Math.min(...los)) * k / 2, 0.002) * 1.5;
  return { la0, lo0, meia, k };
}

function aoTabela(cab, linhas) {
  return `<div class="tab-rolagem"><table class="ao-tab"><tr>${cab.map(([t, r]) => `<th${r ? ' class="r"' : ''}>${t}</th>`).join('')}</tr>${linhas.join('')}</table></div>`;
}

/** O relatório (mesmo HTML na tela e no PDF). */
function aoRelatorioHtml(r) {
  const { cand, uf, cargoNome, ano, mz, sec, geoMun, geoUf, porIbge, semPar } = r;
  const total = mz ? mz.total : sec.total;
  const muns = mz ? aoOrdenar(mz.mun) : [];
  const zonas = mz ? aoOrdenar(mz.zonas) : [];
  const um = muns.length <= 1 && uf === 'df';
  let locais = [], porBairro = [], moldura = null, semCoord = 0;
  if (sec) {
    locais = aoOrdenar(sec.loc).map((x, i) => Object.assign({ ordem: i + 1 }, x, sec.coord[x.z + '|' + x.l] || {}));
    semCoord = locais.filter(x => x.la == null).reduce((s, x) => s + x.v, 0);
    const b = {};
    for (const x of locais) { const n = (x.bairro || 'Sem bairro no cadastro') + (uf !== 'df' && x.mun ? ' (' + x.mun + ')' : ''); b[n] = (b[n] || 0) + x.v; }
    porBairro = Object.entries(b).map(([n, v]) => ({ n, v })).sort((a, b2) => b2.v - a.v);
    const top = locais[0];
    if (top && top.la != null) moldura = aoMoldura(locais.filter(x => x.la != null && x.bairro === top.bairro && x.mun === top.mun));
  }
  const kpi = (v, l) => `<div class="card"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const nLoc = sec ? locais.length : muns.length;
  let h = `<div class="ao-cab"><b>${saEsc(cand.nome)}</b> <span class="sigla">${saEsc(cand.partido)} · ${saEsc(cand.numero)}</span>
      <div class="ao-sub">${saEsc(cargoNome)} · ${saEsc(uf.toUpperCase())} · eleição de ${saEsc(ano)}${cand.sit ? ' · ' + saEsc(cand.sit) : ''}</div></div>
    <div class="cards ao-cards">${kpi(saFmt(total), 'votos no 1º turno')}${kpi(saFmt(nLoc), sec ? 'locais de votação com voto' : 'municípios com voto')}
      ${kpi(saFmt(new Set((zonas.length ? zonas : locais).map(x => x.z)).size), 'zonas eleitorais')}${kpi(aoPct(aoConcentracao(sec ? locais : muns, total)), `dos votos nos 10 ${sec ? 'locais' : 'municípios'} mais fortes`)}</div>`;
  // mapas
  if (sec && geoUf) {
    const pts = locais.filter(x => x.la != null);
    const det = moldura ? pts.filter(x => Math.abs(x.la - moldura.la0) <= moldura.meia && Math.abs(x.lo - moldura.lo0) <= moldura.meia / moldura.k) : [];
    const vDet = det.reduce((s, x) => s + x.v, 0);
    h += `<h3 class="ao-h">Onde vieram os votos — por local de votação</h3><div class="ao-mapas">
      <div>${aoMapaLocais(geoUf, pts)}</div>
      ${moldura ? `<div>${aoMapaLocais(geoUf, det, 380, moldura)}<div class="ao-nota">Detalhe: ${saEsc(locais[0].bairro || 'local mais forte')} — ${saFmt(vDet)} votos (${aoPct(total ? vDet / total : 0)}) em ${det.length} locais. Números = posição na tabela de locais.</div></div>` : ''}</div>
      <div class="ao-nota">Cada círculo é um local de votação; a área é proporcional aos votos. ${semCoord ? saFmt(semCoord) + ' voto(s) em locais sem coordenada no cadastro do TSE ficam só nas tabelas.' : ''}</div>`;
  }
  if (mz && geoMun && !um) {
    h += `<h3 class="ao-h">Onde vieram os votos — por município</h3>${aoMapaMunicipios(geoMun, porIbge)}
      ${semPar && semPar.length ? `<div class="ao-nota">Sem par no mapa do IBGE: ${saEsc(semPar.join(', '))} (estão na tabela).</div>` : ''}`;
  }
  // tabelas
  const linha = (cols) => `<tr>${cols.map(([t, r]) => `<td${r ? ' class="r"' : ''}>${t}</td>`).join('')}</tr>`;
  const blocos = [];
  if (mz && !um) blocos.push(`<div><h3 class="ao-h">Por município</h3>${aoTabela([['#'], ['Município'], ['Votos', 1], ['% dos votos dele(a)', 1], ['% no município', 1]],
    muns.slice(0, 40).map((x, i) => linha([[i + 1 + 'º'], [saEsc(x.n)], [saFmt(x.v), 1], [aoPct(x.v / total), 1], [aoPct(x.t ? x.v / x.t : 0), 1]])))}
    ${muns.length > 40 ? `<div class="ao-nota">E mais ${saFmt(muns.length - 40)} municípios com voto.</div>` : ''}</div>`);
  if (sec && porBairro.length) blocos.push(`<div><h3 class="ao-h">Por bairro do local de votação</h3>${aoTabela([['Bairro'], ['Votos', 1], ['%', 1]],
    porBairro.slice(0, 15).map(x => linha([[saEsc(x.n)], [saFmt(x.v), 1], [aoPct(x.v / total), 1]])))}</div>`);
  if (zonas.length) blocos.push(`<div><h3 class="ao-h">Por zona eleitoral</h3>${aoTabela([['Zona'], ['Município'], ['Votos', 1], ['%', 1]],
    zonas.slice(0, 20).map(x => linha([[x.z + 'ª'], [saEsc(x.n)], [saFmt(x.v), 1], [aoPct(x.v / total), 1]])))}</div>`);
  h += `<div class="ao-duas">${blocos.join('')}</div>`;
  if (sec) h += `<h3 class="ao-h">Os ${Math.min(20, locais.length)} locais de votação com mais votos</h3>${aoTabela([['#'], ['Local de votação'], ['Bairro'], ['Votos', 1], ['% no local', 1]],
    locais.slice(0, 20).map(x => linha([[x.ordem + 'º'], [`${saEsc(x.nome)}<div class="ao-end">${saEsc(x.end || '')}${uf !== 'df' && x.mun ? ' · ' + saEsc(x.mun) : ''}</div>`], [saEsc(x.bairro || '')], [saFmt(x.v), 1], [aoPct(x.t ? x.v / x.t : 0), 1]])))}
    <div class="ao-nota">"% no local" e "% no município": votos dele(a) ÷ votos nominais em todos os candidatos ao cargo ali (sem legenda, brancos e nulos).</div>`;
  h += `<div class="ao-nota">Fontes: TSE — dados abertos (votação por município e zona${sec ? ', votação por seção e cadastro de locais de votação com coordenadas' : ''}); IBGE — malhas. 1º turno.</div>`;
  return h;
}

// ============================================================
// Tela
// ============================================================
function aoPainel() {
  let el = document.getElementById('aoPainel');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'aoPainel';
  el.innerHTML = `<div class="ao-caixa"><div class="ao-topo"><b>📍 De onde vieram os votos</b><span class="ao-acoes">
      <button id="aoDetalhar" hidden></button><button id="aoPdf" disabled>⬇ Salvar em PDF</button><button id="aoFechar" title="Fechar">✕</button></span></div>
    <div id="aoStatus" class="ao-status"></div><div id="aoCorpo"></div></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', ev => { if (ev.target === el) aoFechar(); });
  el.querySelector('#aoFechar').addEventListener('click', aoFechar);
  el.querySelector('#aoPdf').addEventListener('click', aoPdf);
  el.querySelector('#aoDetalhar').addEventListener('click', () => ao.atual && aoCarregar(ao.atual.cand, ao.atual.uf, true));
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && el.style.display === 'flex') aoFechar(); });
  return el;
}
function aoFechar() { const el = document.getElementById('aoPainel'); if (el) el.style.display = 'none'; }
function aoSt(m) { const s = document.getElementById('aoStatus'); if (s) s.innerHTML = m ? `<span class="pulso on"></span> ${m}` : ''; }
function aoMb(n) { return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: n < 1e7 ? 1 : 0 }) + ' MB'; }

async function aoJson(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url); return r.json(); }
async function aoIndice(url) {
  if (!ao.indices[url]) ao.indices[url] = zrIndice(url).catch(e => { delete ao.indices[url]; throw e; });
  return ao.indices[url];
}
async function aoIbge(uf) {
  const U = uf.toUpperCase();
  if (!ao.ibge[U]) {
    ao.ibge[U] = Promise.all([
      aoJson(`${AO_IBGE}/v3/malhas/estados/${U}?formato=application/vnd.geo%2Bjson&intrarregiao=municipio&qualidade=minima`),
      aoJson(`${AO_IBGE}/v3/malhas/estados/${U}?formato=application/vnd.geo%2Bjson&qualidade=minima`),
      aoJson(`${AO_IBGE}/v1/localidades/estados/${U}/municipios`),
    ]).then(([mun, uf1, lista]) => ({ mun, uf: uf1, lista: (lista || []).map(m => ({ id: m.id, nome: m.nome })) }))
      .catch(e => { delete ao.ibge[U]; throw e; });
  }
  return ao.ibge[U];
}
async function aoLerEntrada(ix, filtro, leitor, rotulo) {
  const e = ix.entradas.find(filtro);
  if (!e) throw new Error(`o arquivo do TSE não tem ${rotulo}`);
  await zrLerEntradaRemota(ix.url, e, l => leitor.linha(l), n => aoSt(`${rotulo}: ${aoMb(n)} de ${aoMb(e.comprimido)}…`));
  return leitor.resultado();
}

/** Abre o painel e carrega (cand: { nome, numero, partido }, uf: 'sp'…; detalhar: ler também por local de votação). */
async function aoCarregar(cand, uf, detalhar) {
  if (ao.ocupado) return;
  const op = saOp(), ano = String(op.ano), U = uf.toUpperCase();
  const cargo = sa.cargo === '7' && uf === 'df' ? '8' : sa.cargo;
  const cargoNome = { 6: 'Deputado(a) federal', 7: 'Deputado(a) estadual', 8: 'Deputado(a) distrital' }[cargo];
  const painel = aoPainel();
  painel.style.display = 'flex';
  const corpo = document.getElementById('aoCorpo'), btDet = document.getElementById('aoDetalhar'), btPdf = document.getElementById('aoPdf');
  if (!detalhar) { corpo.innerHTML = ''; btPdf.disabled = true; }
  btDet.hidden = true;
  ao.ocupado = true;
  try {
    const porLocal = detalhar || uf === 'df';
    aoSt('Lendo o índice dos arquivos do TSE…');
    const r = ao.atual && ao.atual.uf === uf && ao.atual.cand.numero === cand.numero && ao.atual.ano === ano && ao.atual.cargo === cargo ? ao.atual
      : { cand: Object.assign({}, cand), uf, ano, cargo, cargoNome };
    const [ixMz, ibge] = await Promise.all([aoIndice(AO_ZIP.munzona(ano)), aoIbge(uf)]);
    if (!r.mz) {
      r.mz = await aoLerEntrada(ixMz, e => zrUfDaEntrada(e.nome) === U, aoLeitorMunzona(cargo, cand.numero), `Votação por município (${U})`);
      if (r.mz.cand) Object.assign(r.cand, { sit: r.mz.cand.sit, partido: r.mz.cand.partido || r.cand.partido });
      const res = lmnResolvedor(ibge.lista, U);
      r.porIbge = {}; r.semPar = [];
      for (const m of Object.values(r.mz.mun)) {
        if (!m.v && !m.t) continue;
        const id = res(m.n);
        if (id) { const k = 'm' + id, x = (r.porIbge[k] = r.porIbge[k] || { n: m.n, v: 0, t: 0 }); x.v += m.v; x.t += m.t; }
        else if (m.v) r.semPar.push(m.n);
      }
      r.geoMun = ibge.mun; r.geoUf = ibge.uf;
    }
    if (!r.mz.total) throw new Error(`nenhum voto do número ${cand.numero} para ${cargoNome.toLowerCase()} em ${U} no arquivo do TSE de ${ano}`);
    if (porLocal && !r.sec) {
      const ixS = await aoIndice(AO_ZIP.secao(ano, uf));
      const tam = ixS.entradas.filter(e => /\.csv$/i.test(e.nome)).reduce((s, e) => s + e.comprimido, 0);
      if (uf !== 'df' && !confirm(`Detalhar por local de votação: baixa ${aoMb(tam)} do TSE (votação por seção de ${U}) e o cadastro de locais. Pode levar alguns minutos. Continuar?`)) {
        aoSt('');
      } else {
        const sec = await aoLerEntrada(ixS, e => /\.csv$/i.test(e.nome), aoLeitorSecao(cargo, cand.numero), `Votação por seção (${U})`);
        const ixL = await aoIndice(AO_ZIP.locais(ano));
        sec.coord = await aoLerEntrada(ixL, e => new RegExp(`_${U}\\.csv$`, 'i').test(e.nome), aoLeitorLocais(), `Locais de votação (${U})`);
        r.sec = sec;
      }
    }
    ao.atual = r;
    aoSt('');
    corpo.innerHTML = aoRelatorioHtml(r);
    btPdf.disabled = false;
    if (!r.sec && uf !== 'df') {
      const ixS = await aoIndice(AO_ZIP.secao(ano, uf)).catch(() => null);
      if (ixS) { btDet.hidden = false; btDet.textContent = `🏫 Detalhar por local de votação (${aoMb(ixS.entradas.filter(e => /\.csv$/i.test(e.nome)).reduce((s, e) => s + e.comprimido, 0))})`; }
    }
  } catch (e) {
    aoSt('');
    corpo.innerHTML = `<div class="vazio grande">Não foi possível montar o relatório: ${saEsc(e.message)}.${/HTTP 404/.test(e.message) ? ' O TSE publica esses arquivos alguns dias depois da eleição.' : ''}</div>`;
  } finally {
    ao.ocupado = false;
  }
}

/** PDF: o mesmo relatório em #saImpressao (tema claro, com a logo), como a cláusula de barreira. */
async function aoPdf() {
  const r = ao.atual;
  if (!r) return;
  const logo = (document.querySelector('.topo img') || {}).src || '';
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  let el = saEl('saImpressao');
  if (!el) { el = document.createElement('div'); el.id = 'saImpressao'; document.body.appendChild(el); }
  el.innerHTML = `<div class="imp-cab">${logo ? `<img src="${logo}" alt="Podemos">` : ''}<div><div class="imp-org">Liderança do Podemos na Câmara dos Deputados</div>
      <h1>De onde vieram os votos — ${saEsc(r.cand.nome)}</h1>
      <div class="imp-sub">${saEsc(r.cargoNome)} · ${saEsc(r.uf.toUpperCase())} · eleição de ${saEsc(r.ano)} · fonte: TSE (dados abertos) e IBGE · gerado em ${saEsc(agora)}</div></div></div>
    <div class="imp-filete"></div><div class="ao-imp">${aoRelatorioHtml(r)}</div>
    <div class="imp-rodape">Painel desenvolvido pela Liderança do Podemos na Câmara dos Deputados.</div>`;
  const titulo = document.title;
  document.title = `Votos - ${r.cand.nome} - ${r.uf.toUpperCase()} ${r.ano}`;
  const volta = () => { document.title = titulo; window.removeEventListener('afterprint', volta); };
  window.addEventListener('afterprint', volta);
  await Promise.all([...el.querySelectorAll('img')].map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => {})));
  window.print();
}

/** Botão na linha do candidato (só deputados; majoritários não). */
function aoBotao(c, uf) {
  if (!uf || uf === 'br' || !['6', '7'].includes(sa.cargo) || saOp().turno === 2) return '';
  return ` <button class="ao-bt" data-ao="${saEsc(uf)}|${saEsc(c.numero)}|${saEsc(c.partido || '')}|${saEsc(c.nome)}" title="De onde vieram os votos (mapa e PDF)">📍</button>`;
}
function aoClique(ev) {
  const b = ev.target.closest && ev.target.closest('[data-ao]');
  if (!b) return false;
  const [uf, numero, partido, ...nome] = b.dataset.ao.split('|');
  aoCarregar({ numero, partido, nome: nome.join('|') }, uf, false);
  return true;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { aoLeitorMunzona, aoLeitorSecao, aoLeitorLocais, aoQuebras, aoConcentracao, aoOrdenar, aoMoldura };
