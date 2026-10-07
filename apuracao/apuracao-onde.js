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
// Só na EXTENSÃO: o servidor de arquivos do TSE responde com o cabeçalho CORS
// duplicado ("Access-Control-Allow-Origin: *, *", conferido em 07/10/2026) e
// todo navegador recusa a resposta numa página comum — no site publicado o
// botão não aparece. A extensão lê direto (permissão de host), sem intermediário.
const AO_IBGE = 'https://servicodados.ibge.gov.br/api';
const AO_ZIP = {
  munzona: (b, ano) => `${b}/votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`,
  secao: (b, ano, uf) => `${b}/votacao_secao/votacao_secao_${ano}_${uf.toUpperCase()}.zip`,
  locais: (b, ano) => `${b}/eleitorado_locais_votacao/eleitorado_local_votacao_${ano}.zip`,
};

/** A página é a extensão? (só ali os arquivos do TSE podem ser lidos) */
function aoNaExtensao() {
  const p = typeof location !== 'undefined' ? location.protocol : '';
  return p === 'chrome-extension:' || p === 'moz-extension:';
}
const ao = { indices: {}, ibge: {}, atual: null, ocupado: false };

// Zonas eleitorais do DF (um município só: a zona é o recorte que importa). Nome
// pelas regiões administrativas que cada zona atende e ponto central (média das
// coordenadas dos locais de votação, pesada pelo eleitorado) — tirados do
// cadastro de locais de votação do TSE de 2026 (eleitorado_local_votacao_2026_DF);
// os bairros genéricos ("Setor Leste"…) foram lidos pela região (17ª = Gama).
const AO_ZONAS_DF = {
  1: ['Asa Sul (Plano Piloto)', -15.819, -47.9063], 2: ['Paranoá, Itapoã, Lago Norte e Varjão', -15.7511, -47.8061],
  3: ['Taguatinga Norte', -15.8153, -48.0903], 4: ['Santa Maria', -16.0212, -48.0128],
  5: ['Sobradinho e Sobradinho II', -15.6442, -47.8112], 6: ['Planaltina', -15.6263, -47.6492],
  8: ['Ceilândia (Norte e Sul)', -15.8169, -48.1132], 9: ['Guará e Cidade Estrutural', -15.8227, -47.9807],
  10: ['Núcleo Bandeirante, Riacho Fundo I e II e Candangolândia', -15.8883, -47.9999], 11: ['Cruzeiro, Sudoeste e Octogonal', -15.7955, -47.9348],
  13: ['Samambaia', -15.8787, -48.1022], 14: ['Asa Norte (Plano Piloto)', -15.7608, -47.8882],
  15: ['Águas Claras e Taguatinga Sul', -15.8413, -48.0346], 16: ['Ceilândia Norte e Brazlândia', -15.7604, -48.1546],
  17: ['Gama', -16.0168, -48.0678], 18: ['São Sebastião, Lago Sul e Jardim Botânico', -15.8861, -47.799],
  19: ['Taguatinga Norte e Vicente Pires', -15.8094, -48.0531], 20: ['Ceilândia Sul', -15.8402, -48.1162],
  21: ['Recanto das Emas e Samambaia', -15.907, -48.078],
};
function aoZonaDf(z) { return AO_ZONAS_DF[Number(z)] || null; }

// Bairro do local de votação (cadastro do TSE, DF) → região administrativa.
// Os nomes genéricos dependem da zona: "Setor Norte/Sul" é Gama na 17ª e Brazlândia na 16ª.
// Atribuições aproximadas (o cadastro não traz a RA): Setor Militar Urbano/Complementar,
// Setor de Indústrias Gráficas e Granja do Torto → Plano Piloto; Areal → Arniqueira;
// "Zona rural" da 18ª → São Sebastião.
const AO_RA_DF = [
  [/^ASA (NORTE|SUL)$|^SETOR MILITAR|^SETOR DE INDUSTRIAS GRAFICAS$|^GRANJA DO TORTO$/, 'Plano Piloto'],
  [/^AREAL/, 'Arniqueira'], [/AGUAS CLARAS/, 'Águas Claras'], [/^ARAPOANGA$/, 'Arapoanga'],
  [/^AREA OCTOGONAL|^SETOR SUDOESTE$/, 'Sudoeste/Octogonal'], [/^CRUZEIRO/, 'Cruzeiro'],
  [/^BRAZLANDIA$|^VILA SAO JOSE$|^SETOR VEREDAS$|^N\.?R\.? ?ALEX|^SETOR TRADICIONAL$/, 'Brazlândia'],
  [/^CANDANGOLANDIA$/, 'Candangolândia'], [/^CEILANDIA/, 'Ceilândia'],
  [/^CIDADE ESTRUTURAL$|^ZONA INDUSTRIAL$/, 'SCIA/Estrutural'],
  [/^SANTA MARIA$|^CIDADE NOVA$|^RESIDENCIAL SANTOS DUMONT$/, 'Santa Maria'], [/VICENTE PIRES/, 'Vicente Pires'],
  [/^ENGENHO DAS LAJES$|^PONTE ALTA/, 'Gama'], [/^GUARA/, 'Guará'], [/^ITAPOA$/, 'Itapoã'],
  [/^JARDINS MANGUEIRAL$|JARDIM BOTANICO/, 'Jardim Botânico'], [/^LAGO NORTE$|^TAQUARI$/, 'Lago Norte'], [/^LAGO SUL$/, 'Lago Sul'],
  [/^NUCLEO BANDEIRANTE$/, 'Núcleo Bandeirante'], [/^PARANOA$/, 'Paranoá'], [/PARK WAY/, 'Park Way'],
  [/^PLANALTINA$|^ESTANCIA MESTRE|^JARDIM RORIZ$|^VALE DO AMANHECER$|^SETOR RESIDENCIAL (LESTE|NORTE)$/, 'Planaltina'],
  [/^RECANTO DAS EMAS$/, 'Recanto das Emas'], [/^RIACHO FUNDO II$/, 'Riacho Fundo II'], [/^RIACHO FUNDO$/, 'Riacho Fundo'],
  [/^SAMAMBAIA/, 'Samambaia'], [/SAO SEBASTIAO|SAO BARTOLOMEU/, 'São Sebastião'],
  [/^SOBRADINHO II$/, 'Sobradinho II'], [/^SOBRADINHO$|CORREGO DO ARROZAL/, 'Sobradinho'], [/^TAGUATINGA/, 'Taguatinga'], [/^VARJAO$/, 'Varjão'],
];
function aoRaDf(bairro, zona) {
  const b = String(bairro || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const z = Number(zona);
  if (/^SETOR (NORTE|SUL)$/.test(b)) return z === 16 ? 'Brazlândia' : z === 17 ? 'Gama' : null;
  if (/^SETOR (CENTRAL|LESTE|OESTE)$/.test(b) && z === 17) return 'Gama';
  if (b === 'ZONA RURAL' && z === 18) return 'São Sebastião';
  for (const [re, ra] of AO_RA_DF) if (re.test(b)) return ra;
  return null;
}
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
function aoPct(x) { if (x > 0 && x < 0.00005) return '<0,01%'; return (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: x && x < 0.01 ? 2 : 1 }) + '%'; }

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
    for (const x of locais) {
      const n = uf === 'df' ? (aoRaDf(x.bairro, x.z) || (x.bairro ? 'Outros (' + x.bairro + ')' : 'Sem bairro no cadastro'))
        : (x.bairro || 'Sem bairro no cadastro') + (x.mun ? ' (' + x.mun + ')' : '');
      b[n] = b[n] || { v: 0, t: 0, locais: 0 }; b[n].v += x.v; b[n].t += x.t; b[n].locais++;
    }
    porBairro = Object.entries(b).map(([n, o]) => ({ n, v: o.v, t: o.t, locais: o.locais })).sort((a, b2) => b2.v - a.v);
    const top = locais[0];
    if (top && top.la != null) moldura = aoMoldura(locais.filter(x => x.la != null && x.bairro === top.bairro && x.mun === top.mun));
  }
  const kpi = (v, l) => `<div class="card"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const nLoc = sec ? locais.length : muns.length;
  let h = `<div class="ao-cab"><b>${saEsc(cand.nome)}</b> <span class="sigla">${saEsc(cand.partido)} · ${saEsc(cand.numero)}</span>
      <div class="ao-sub">${saEsc(cargoNome)} · ${saEsc(uf.toUpperCase())} · eleição de ${saEsc(ano)}${cand.sit ? ' · ' + saEsc(cand.sit) : ''}</div></div>
    <div class="cards ao-cards">${kpi(saFmt(total), 'votos no 1º turno')}${um && !sec
        // DF sem o detalhe por escola: a unidade é a zona eleitoral
        ? kpi(saFmt(zonas.length), 'zonas eleitorais com voto') + kpi(aoPct(muns[0] && muns[0].t ? total / muns[0].t : 0), 'dos votos nominais do cargo no DF')
          + kpi(aoPct(aoConcentracao(zonas, total, 3)), 'dos votos nas 3 zonas mais fortes')
        : kpi(saFmt(nLoc), sec ? 'locais de votação com voto' : 'municípios com voto')
          + (zonas.length || locais.length
            ? kpi(saFmt(new Set((zonas.length ? zonas : locais).map(x => x.z)).size), 'zonas eleitorais')
            : kpi(aoPct(muns.reduce((s2, x) => s2 + x.t, 0) ? total / muns.reduce((s2, x) => s2 + x.t, 0) : 0), 'dos votos nominais do cargo no estado'))
          + kpi(aoPct(aoConcentracao(sec ? locais : muns, total)), `dos votos nos 10 ${sec ? 'locais' : 'municípios'} mais fortes`)}</div>`;
  // mapas
  if (!sec && uf === 'df' && zonas.length && geoUf) {
    // DF sem o detalhe por escola: uma bolha por zona, no centro da região que ela atende.
    const pts = zonas.map((x, i) => { const zd = aoZonaDf(x.z); return zd ? { la: zd[1], lo: zd[2], v: x.v, nome: `${x.z}ª zona — ${zd[0]}`, ordem: i + 1 } : null; }).filter(Boolean);
    h += `<h3 class="ao-h">Onde vieram os votos — por zona eleitoral</h3>${aoMapaLocais(geoUf, pts)}
      <div class="ao-nota">Cada círculo é uma zona eleitoral, no centro da região que ela atende; a área é proporcional aos votos. Números = posição na tabela de zonas.</div>`;
  }
  if (sec && geoUf) {
    const pts = locais.filter(x => x.la != null);
    const det = moldura ? pts.filter(x => Math.abs(x.la - moldura.la0) <= moldura.meia && Math.abs(x.lo - moldura.lo0) <= moldura.meia / moldura.k) : [];
    const vDet = det.reduce((s, x) => s + x.v, 0);
    h += `<h3 class="ao-h">Onde vieram os votos — por local de votação</h3><div class="ao-mapas">
      <div>${aoMapaLocais(geoUf, pts)}</div>
      ${moldura ? `<div>${aoMapaLocais(geoUf, det, 380, moldura)}<div class="ao-nota">Detalhe: ${saEsc(locais[0].bairro || 'local mais forte')} — ${saFmt(vDet)} votos (${aoPct(total ? vDet / total : 0)}) em ${det.length} locais. Números = posição na tabela de locais.</div></div>` : ''}</div>
      <div class="ao-nota">Cada círculo é um local de votação; a área é proporcional aos votos. ${semCoord ? saFmt(semCoord) + ' voto(s) em locais sem coordenada no cadastro do TSE ficam só nas tabelas.' : ''}</div>`;
  }
  if (r.semMapa && !um) h += '<div class="ao-nota">Mapa indisponível: o serviço de malhas do IBGE não respondeu. As tabelas estão completas; para o mapa, feche e abra de novo em instantes.</div>';
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
  if (sec && porBairro.length && uf === 'df') blocos.push(`<div><h3 class="ao-h">Por região administrativa</h3>${aoTabela([['#'], ['Região administrativa'], ['Locais', 1], ['Votos', 1], ['%', 1], ['% na RA', 1]],
    porBairro.map((x, i) => linha([[i + 1 + 'º'], [saEsc(x.n)], [saFmt(x.locais), 1], [saFmt(x.v), 1], [aoPct(x.v / total), 1], [aoPct(x.t ? x.v / x.t : 0), 1]])))}
    <div class="ao-nota">RA pelo bairro do local de votação no cadastro do TSE (onde o eleitor vota, não onde mora). "% na RA": votos dele(a) ÷ votos nominais no cargo nos locais da RA onde teve voto.</div></div>`);
  else if (sec && porBairro.length) blocos.push(`<div><h3 class="ao-h">Por bairro do local de votação</h3>${aoTabela([['Bairro'], ['Votos', 1], ['%', 1]],
    porBairro.slice(0, 15).map(x => linha([[saEsc(x.n)], [saFmt(x.v), 1], [aoPct(x.v / total), 1]])))}</div>`);
  if (zonas.length && uf === 'df') blocos.push(`<div><h3 class="ao-h">Por zona eleitoral</h3>${aoTabela([['#'], ['Zona'], ['Regiões que atende'], ['Votos', 1], ['%', 1], ['% na zona', 1]],
    zonas.map((x, i) => linha([[i + 1 + 'º'], [x.z + 'ª'], [saEsc((aoZonaDf(x.z) || ['—'])[0])], [saFmt(x.v), 1], [aoPct(x.v / total), 1], [aoPct(x.t ? x.v / x.t : 0), 1]])))}
    <div class="ao-nota">"% na zona": votos dele(a) ÷ votos nominais em todos os candidatos ao cargo na zona. Regiões pela lista de locais de votação do TSE de 2026.</div></div>`);
  else if (zonas.length) blocos.push(`<div><h3 class="ao-h">Por zona eleitoral</h3>${aoTabela([['Zona'], ['Município'], ['Votos', 1], ['%', 1]],
    zonas.slice(0, 20).map(x => linha([[x.z + 'ª'], [saEsc(x.n)], [saFmt(x.v), 1], [aoPct(x.v / total), 1]])))}</div>`);
  h += `<div class="ao-duas">${blocos.join('')}</div>`;
  if (sec) h += `<h3 class="ao-h">Os ${Math.min(20, locais.length)} locais de votação com mais votos</h3>${aoTabela([['#'], ['Local de votação'], ['Bairro'], ['Votos', 1], ['% no local', 1]],
    locais.slice(0, 20).map(x => linha([[x.ordem + 'º'], [`${saEsc(x.nome)}<div class="ao-end">${saEsc(x.end || '')}${uf !== 'df' && x.mun ? ' · ' + saEsc(x.mun) : ''}</div>`], [saEsc(x.bairro || '')], [saFmt(x.v), 1], [aoPct(x.t ? x.v / x.t : 0), 1]])))}
    <div class="ao-nota">"% no local" e "% no município": votos dele(a) ÷ votos nominais em todos os candidatos ao cargo ali (sem legenda, brancos e nulos).</div>`;
  h += r.fonteSite
    ? `<div class="ao-nota">Fontes: TSE — divulgação oficial de resultados, por ${um ? 'zona eleitoral' : 'município'}; IBGE — malhas. 1º turno. O detalhe por local de votação (escolas) e por zona em todos os estados fica na extensão SisPode.</div>`
    : `<div class="ao-nota">Fontes: TSE — dados abertos (votação por município e zona${sec ? ', votação por seção e cadastro de locais de votação com coordenadas' : ''}); IBGE — malhas. 1º turno.</div>`;
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

async function aoJson(url) { return zrJson(url); }
/** Põe o nome da fonte na mensagem de erro (qual servidor não respondeu). */
function aoFonte(p, nome) { return p.catch(e => { throw new Error(`${nome}: ${e && e.message || e}`); }); }
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

/**
 * Votos por município (ou por zona, no DF) pelo servidor de RESULTADOS do TSE —
 * o caminho do site, que não pode ler os zips (cabeçalho CORS duplicado no
 * servidor de arquivos). O índice da eleição (config/mun-e…-cm.json) lista os
 * municípios de cada UF com o código IBGE e as zonas; cada arquivo traz todos os
 * candidatos do cargo ali (~50 KB comprimidos). Mesmo formato de aoLeitorMunzona.
 */
async function aoMunzonaResultados(op, cargo, uf, numero) {
  const c = op.cargos[cargo] || op.cargos[sa.cargo];
  const el = c.eleicao, e6 = String(el).padStart(6, '0'), c4 = String(cargo).padStart(4, '0');
  const raiz = `${AP_BASE}/${op.ciclo}/${el}`;
  if (!ao.cm || ao.cm.el !== el) ao.cm = { el, d: await zrJson(`${raiz}/config/mun-e${e6}-cm.json`) };
  const abr = (ao.cm.d.abr || []).find(x => String(x.cd).toLowerCase() === uf);
  if (!abr) throw new Error('o TSE não lista os municípios de ' + uf.toUpperCase());
  const muns = abr.mu || [];
  const umSo = muns.length === 1;
  // DF: um município só — o detalhe é a zona eleitoral.
  const alvos = umSo ? muns[0].z.map(z => ({ m: muns[0], z })) : muns.map(m => ({ m }));
  const out = { cand: null, total: 0, mun: {}, zonas: {} };
  let feitos = 0;
  const um = async ({ m, z }) => {
    const url = `${raiz}/dados/${uf}/${uf}${m.cd}${z ? '-z' + z : ''}-c${c4}-e${e6}-u.json`;
    const d = apLerUFTodos(await zrJson(url), uf);
    feitos++;
    if (feitos % 10 === 0 || feitos === alvos.length) aoSt(`Resultados do TSE: ${feitos} de ${alvos.length} ${umSo ? 'zonas' : 'municípios'}…`);
    const x = d.candidatos.find(k => String(k.numero) === String(numero));
    const t = d.candidatos.reduce((s, k) => s + k.votos, 0);
    const v = x ? x.votos : 0;
    if (x && !out.cand) out.cand = { nome: x.nome, partido: x.partido, sit: x.situacao };
    const mm = (out.mun[m.cd] = out.mun[m.cd] || { n: m.nm, cdi: m.cdi, v: 0, t: 0 });
    mm.v += v; mm.t += t;
    if (z) out.zonas[m.cd + '|' + Number(z)] = { cd: m.cd, n: m.nm, z: String(Number(z)), v, t };
    out.total += v;
  };
  // 8 pedidos de cada vez: SP são 645 arquivos.
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < alvos.length) await um(alvos[i++]); }));
  return out;
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
    // O mapa do IBGE é acessório: se ele não responder, o relatório sai só com as tabelas.
    const base = AO_TSE, naExt = aoNaExtensao();
    const ibgeP = aoIbge(uf).catch(() => null);
    if (!r.mz && !naExt) {
      // Site: o servidor de RESULTADOS do TSE (o do painel), um arquivo por município — ou por zona no DF.
      r.mz = await aoFonte(aoMunzonaResultados(op, cargo, uf, cand.numero), 'resultados do TSE por município');
      const ibge = await ibgeP;
      r.semMapa = !ibge; r.semPar = [];
      r.porIbge = {};
      for (const m of Object.values(r.mz.mun)) if (m.cdi) r.porIbge['m' + m.cdi] = { n: m.n, v: m.v, t: m.t };
      r.geoMun = ibge && ibge.mun; r.geoUf = ibge && ibge.uf;
      r.fonteSite = true;
      // A situação final (eleito/suplente) vem do arquivo do estado, que o painel já leu.
      const doUf = sa.dados[uf] && sa.dados[uf].candidatos.find(k => String(k.numero) === String(cand.numero));
      if (doUf && doUf.situacao) r.cand.sit = doUf.situacao;
      else if (r.mz.cand && r.mz.cand.sit) r.cand.sit = r.mz.cand.sit;
    }
    if (!r.mz) {
      const [ixMz, ibge] = await Promise.all([aoFonte(aoIndice(AO_ZIP.munzona(base, ano)), 'arquivo de votação do TSE'), ibgeP]);
      r.mz = await aoLerEntrada(ixMz, e => zrUfDaEntrada(e.nome) === U, aoLeitorMunzona(cargo, cand.numero), `Votação por município (${U})`);
      if (r.mz.cand) Object.assign(r.cand, { sit: r.mz.cand.sit, partido: r.mz.cand.partido || r.cand.partido });
      const res = ibge ? lmnResolvedor(ibge.lista, U) : () => null;
      r.semMapa = !ibge;
      r.porIbge = {}; r.semPar = [];
      for (const m of Object.values(r.mz.mun)) {
        if (!m.v && !m.t) continue;
        const id = res(m.n);
        if (id) { const k = 'm' + id, x = (r.porIbge[k] = r.porIbge[k] || { n: m.n, v: 0, t: 0 }); x.v += m.v; x.t += m.t; }
        else if (m.v && ibge) r.semPar.push(m.n);
      }
      r.geoMun = ibge && ibge.mun; r.geoUf = ibge && ibge.uf;
    }
    if (!r.mz.total) throw new Error(`nenhum voto do número ${cand.numero} para ${cargoNome.toLowerCase()} em ${U} no arquivo do TSE de ${ano}`);
    if (porLocal && !r.sec && naExt) {
      const ixS = await aoFonte(aoIndice(AO_ZIP.secao(base, ano, uf)), 'votação por seção do TSE');
      const tam = ixS.entradas.filter(e => /\.csv$/i.test(e.nome)).reduce((s, e) => s + e.comprimido, 0);
      if (uf !== 'df' && !confirm(`Detalhar por local de votação: baixa ${aoMb(tam)} do TSE (votação por seção de ${U}) e o cadastro de locais. Pode levar alguns minutos. Continuar?`)) {
        aoSt('');
      } else {
        const sec = await aoLerEntrada(ixS, e => /\.csv$/i.test(e.nome), aoLeitorSecao(cargo, cand.numero), `Votação por seção (${U})`);
        const ixL = await aoFonte(aoIndice(AO_ZIP.locais(base, ano)), 'cadastro de locais de votação do TSE');
        sec.coord = await aoLerEntrada(ixL, e => new RegExp(`_${U}\\.csv$`, 'i').test(e.nome), aoLeitorLocais(), `Locais de votação (${U})`);
        r.sec = sec;
      }
    }
    ao.atual = r;
    aoSt('');
    corpo.innerHTML = aoRelatorioHtml(r);
    btPdf.disabled = false;
    if (!r.sec && uf !== 'df' && naExt) {
      const ixS = await aoIndice(AO_ZIP.secao(base, ano, uf)).catch(() => null);
      if (ixS) { btDet.hidden = false; btDet.textContent = `🏫 Detalhar por local de votação (${aoMb(ixS.entradas.filter(e => /\.csv$/i.test(e.nome)).reduce((s, e) => s + e.comprimido, 0))})`; }
    }
  } catch (e) {
    aoSt('');
    const rede = /failed to fetch|load failed|networkerror|HTTP 403/i.test(e.message);
    corpo.innerHTML = `<div class="vazio grande">Não foi possível montar o relatório: ${saEsc(e.message)}.
      ${/HTTP 404/.test(e.message) ? ' O TSE publica esses arquivos alguns dias depois da eleição.' : ''}
      ${rede ? '<br>O servidor do TSE recusa pedidos de vez em quando, por alguns segundos (o painel já tentou 5 vezes). Tente de novo em instantes; se persistir, confira a conexão.' : ''}
      <br><button id="aoDeNovo" class="ao-bt" style="font-size:13px;padding:6px 12px;margin-top:10px">↻ Tentar de novo</button></div>`;
    const dn = document.getElementById('aoDeNovo');
    if (dn) dn.addEventListener('click', () => aoCarregar(cand, uf, detalhar));
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
      <div class="imp-sub">${saEsc(r.cargoNome)} · ${saEsc(r.uf.toUpperCase())} · eleição de ${saEsc(r.ano)} · fonte: TSE (${r.fonteSite ? 'divulgação oficial de resultados' : 'dados abertos'}) e IBGE · gerado em ${saEsc(agora)}</div></div></div>
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

if (typeof module !== 'undefined' && module.exports) module.exports = { aoRaDf, aoLeitorMunzona, aoLeitorSecao, aoLeitorLocais, aoQuebras, aoConcentracao, aoOrdenar, aoMoldura };
