'use strict';
// Sistemas eleitorais · DISTRITAL MISTO — núcleo PURO (sem DOM, sem rede).
//
// Parte das vagas do estado (metade, por padrão) sai de distritos de um eleito;
// o resto, da lista (snCompletarLista, sistemas-nucleo.js), paralela ou
// compensatória. Os distritos não existem no Brasil: são desenhados aqui, a cada
// simulação, só com dados públicos:
//  · unidades: os municípios (malha do IBGE em TopoJSON — contorno e vizinhança
//    pelas fronteiras comuns); o município com eleitorado grande demais para um
//    distrito entra dividido nas suas zonas eleitorais (posição = média das
//    coordenadas dos locais de votação, pesada pelos eleitores; vizinhança =
//    zonas mais próximas, e as da borda com os municípios vizinhos);
//  · peso: eleitores aptos (TSE, detalhe da votação por município e zona);
//  · desenho: bisseção recursiva — o pedaço cresce a partir de uma ponta, ao
//    longo de um eixo, até a proporção de eleitores dos distritos que lhe cabem
//    (testam-se vários eixos; fica o corte mais equilibrado e compacto) — e
//    trocas na fronteira que reduzem o desvio sem romper a contiguidade;
//  · eleição no distrito: a agremiação mais votada no distrito leva a vaga, com
//    o seu candidato mais votado ali (regra "partido", padrão), ou o candidato
//    mais votado no distrito (regra "candidato"); um candidato ganha um só.
// Os votos são os dados num sistema proporcional: num distrital, candidatos e
// eleitores fariam outras escolhas — a simulação mostra o efeito do recorte.
// Exportado para os testes (Node); na extensão, global (depois de sistemas-nucleo.js).

const sdNucleo = typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./sistemas-nucleo.js') : null;
const sdCompletarLista = (...a) => (sdNucleo ? sdNucleo.snCompletarLista : snCompletarLista)(...a);

// ------------------------------------------------------------ malha do IBGE
/**
 * TopoJSON do IBGE (municípios de uma UF) → { feicoes: { ibge: { id, poligonos: [[anel]] } },
 * vizinhos: { ibge: Set }, fronteira: { 'a|b': [[lon, lat]] } } — fronteira: o ponto
 * do meio de cada trecho de divisa entre dois municípios (onde ligar as zonas).
 */
function sdTopo(topo) {
  const t = topo && topo.transform;
  const arcos = ((topo && topo.arcs) || []).map(a => {
    if (!t) return a.map(p => [p[0], p[1]]);
    let x = 0, y = 0;
    return a.map(p => { x += p[0]; y += p[1]; return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]]; });
  });
  const arco = i => (i >= 0 ? arcos[i] : arcos[~i].slice().reverse());
  const anel = lista => {
    const pts = [];
    for (const i of lista) { const a = arco(i); for (let j = pts.length ? 1 : 0; j < a.length; j++) pts.push(a[j]); }
    return pts;
  };
  const obj = Object.values((topo && topo.objects) || {})[0] || { geometries: [] };
  const feicoes = {}, donos = new Map();
  for (const g of obj.geometries || []) {
    const id = String((g.properties || {}).codarea || g.id || '');
    const polis = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    for (const p of polis) for (const r of p) for (const i of r) {
      const k = i >= 0 ? i : ~i;
      if (!donos.has(k)) donos.set(k, new Set());
      donos.get(k).add(id);
    }
    feicoes[id] = { id, poligonos: polis.map(p => p.map(anel)) };
  }
  const vizinhos = {}, fronteira = {};
  for (const [k, ids] of donos) {
    if (ids.size < 2) continue;
    const [a, b] = [...ids];
    (vizinhos[a] = vizinhos[a] || new Set()).add(b);
    (vizinhos[b] = vizinhos[b] || new Set()).add(a);
    const ar = arcos[k];
    (fronteira[sdPar(a, b)] = fronteira[sdPar(a, b)] || []).push(ar[Math.floor(ar.length / 2)]);
  }
  return { feicoes, vizinhos, fronteira };
}
function sdPar(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

/** Projeção plana em km em torno de (lon0, lat0) — basta para distâncias dentro de um estado. */
function sdProjetor(lon0, lat0) {
  const kx = 111.32 * Math.cos(lat0 * Math.PI / 180), ky = 110.57;
  return p => [(p[0] - lon0) * kx, (p[1] - lat0) * ky];
}

/** Área (km²) e centroide projetado de um município: anéis externos somam, buracos subtraem (qualquer que seja o sentido do anel). */
function sdAreaCentro(poligonos, proj) {
  let A = 0, cx = 0, cy = 0;
  for (const p of poligonos) p.forEach((r, iAnel) => {
    let f2 = 0, x = 0, y = 0;   // f2 = 2 × área com sinal
    const q = r.map(proj);
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const f = q[j][0] * q[i][1] - q[i][0] * q[j][1];
      f2 += f; x += (q[j][0] + q[i][0]) * f; y += (q[j][1] + q[i][1]) * f;
    }
    if (!f2) return;
    const area = Math.abs(f2) / 2, peso = iAnel === 0 ? area : -area;
    A += peso; cx += peso * x / (3 * f2); cy += peso * y / (3 * f2);
  });
  return A > 0 ? { area: A, x: cx / A, y: cy / A } : null;
}

// ------------------------------------------------------------ leitura (dados abertos do TSE)
function sdCampos(linha) {
  const l = linha.replace(/\r$/, '');
  if (l.length > 1 && l[0] === '"' && l[l.length - 1] === '"' && l.indexOf('""') < 0) {
    const out = l.slice(1, -1).split('";"');
    if (!out.some(c => c.indexOf('"') >= 0)) return out;
  }
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ';') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
/** Linha a linha de um CSV do TSE com cabeçalho; cada arquivo novo traz o seu cabeçalho. */
function sdCsv(exigidas, fn) {
  let ix = null;
  return l => {
    const c = sdCampos(l);
    const h0 = (c[0] || '').replace(/^\uFEFF/, '').replace(/"/g, '').trim();
    if (h0 === 'DT_GERACAO' || (!ix && c.some(h => h.trim() === exigidas[0]))) {   // cabeçalho (cada arquivo traz o seu)
      ix = {}; c.forEach((h, i) => { ix[h.replace(/^\uFEFF/, '').replace(/"/g, '').trim()] = i; });
      const falta = exigidas.filter(h => !(h in ix));
      if (falta.length) throw new Error('arquivo do TSE fora do formato esperado (faltam ' + falta.join(', ') + ')');
      return;
    }
    if (!ix) return;
    fn(k => (ix[k] == null ? '' : (c[ix[k]] || '').trim()));
  };
}
const sdCoord = s => { const v = parseFloat(String(s || '').replace(',', '.')); return isFinite(v) && v !== -1 && v !== 0 ? v : null; };
// Os arquivos do TSE não escrevem os códigos do mesmo jeito ("01007" num, "1007" noutro): sem zeros à esquerda.
const sdCod = s => { const t = String(s || '').trim(), n = parseInt(t, 10); return isNaN(n) ? t : String(n); };

/**
 * Leitor dos arquivos de dados abertos do TSE para o distrital, de UM estado:
 *  · candidato.linha — votacao_candidato_munzona: votos de cada candidato por (município, zona);
 *  · partido.linha  — votacao_partido_munzona: votos de legenda de cada partido por (município, zona);
 *  · detalhe.linha  — detalhe_votacao_munzona: eleitores aptos por (município, zona);
 *  · locais.linha   — eleitorado_local_votacao: posição de cada (município, zona), média
 *    das coordenadas dos locais de votação pesada pelos eleitores das seções.
 * Só o 1º turno e os cargos pedidos ('6', '7', '8'). resultado() →
 * { mun: { cd: { nome, zonas: { z: { aptos, la, lo } } } }, votos: { cargo: { 'cd|z': { c: { sq: n }, l: { sigla: n } } } } }.
 */
function sdLeitorGeo(uf, cargos = ['6', '7', '8']) {
  const U = String(uf).toUpperCase(), cgs = new Set(cargos.map(String));
  const mun = {}, votos = Object.fromEntries([...cgs].map(c => [c, {}])), pos = {};
  const zona = (cd, nome, z) => {
    const m = (mun[cd] = mun[cd] || { nome, zonas: {} });
    if (!m.nome && nome) m.nome = nome;
    return (m.zonas[z] = m.zonas[z] || { aptos: 0, la: null, lo: null });
  };
  const daqui = v => v('SG_UF') === U && v('NR_TURNO') === '1';
  const celula = (cg, cd, z) => (votos[cg][cd + '|' + z] = votos[cg][cd + '|' + z] || { c: {}, l: {} });
  const candidato = sdCsv(['SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'CD_CARGO', 'NR_TURNO', 'SQ_CANDIDATO', 'QT_VOTOS_NOMINAIS_VALIDOS'], v => {
    const cg = v('CD_CARGO');
    if (!cgs.has(cg) || !daqui(v)) return;
    const n = Number(v('QT_VOTOS_NOMINAIS_VALIDOS')) || 0;
    if (!n) return;
    const cd = sdCod(v('CD_MUNICIPIO')), z = sdCod(v('NR_ZONA'));
    zona(cd, v('NM_MUNICIPIO'), z);
    const x = celula(cg, cd, z), sq = v('SQ_CANDIDATO');
    x.c[sq] = (x.c[sq] || 0) + n;
  });
  const partido = sdCsv(['SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'CD_CARGO', 'NR_TURNO', 'SG_PARTIDO', 'QT_TOTAL_VOTOS_LEG_VALIDOS'], v => {
    const cg = v('CD_CARGO');
    if (!cgs.has(cg) || !daqui(v)) return;
    const n = Number(v('QT_TOTAL_VOTOS_LEG_VALIDOS')) || 0;   // legenda + nominais que a lei manda para a legenda
    if (!n) return;
    const cd = sdCod(v('CD_MUNICIPIO')), z = sdCod(v('NR_ZONA')), sg = v('SG_PARTIDO');
    zona(cd, v('NM_MUNICIPIO'), z);
    const x = celula(cg, cd, z);
    x.l[sg] = (x.l[sg] || 0) + n;
  });
  // Os aptos são os mesmos em todos os cargos: vale a linha do 1º cargo pedido que aparecer.
  const vistos = new Set();
  const detalhe = sdCsv(['SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'CD_CARGO', 'NR_TURNO', 'QT_APTOS'], v => {
    if (!daqui(v) || !cgs.has(v('CD_CARGO'))) return;
    const cd = sdCod(v('CD_MUNICIPIO')), z = sdCod(v('NR_ZONA')), k = cd + '|' + z;
    if (vistos.has(k)) return;
    vistos.add(k);
    zona(cd, v('NM_MUNICIPIO'), z).aptos = Number(v('QT_APTOS')) || 0;
  });
  const locais = sdCsv(['SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LATITUDE', 'NR_LONGITUDE', 'QT_ELEITOR_SECAO'], v => {
    if (v('SG_UF') !== U) return;
    const la = sdCoord(v('NR_LATITUDE')), lo = sdCoord(v('NR_LONGITUDE')), q = Number(v('QT_ELEITOR_SECAO')) || 0;
    if (la == null || lo == null || !q) return;
    const k = sdCod(v('CD_MUNICIPIO')) + '|' + sdCod(v('NR_ZONA'));
    const p = (pos[k] = pos[k] || { la: 0, lo: 0, q: 0 });
    p.la += la * q; p.lo += lo * q; p.q += q;
  });
  const resultado = () => {
    for (const [k, p] of Object.entries(pos)) {
      const [cd, z] = k.split('|');
      const zz = mun[cd] && mun[cd].zonas[z];
      if (zz && p.q) { zz.la = p.la / p.q; zz.lo = p.lo / p.q; }
    }
    return { mun, votos };
  };
  return { candidato: { linha: candidato }, partido: { linha: partido }, detalhe: { linha: detalhe }, locais: { linha: locais }, resultado };
}

// ------------------------------------------------------------ unidades e vizinhança
/**
 * As unidades do desenho e a vizinhança entre elas.
 * geo: resultado de sdLeitorGeo; malha: sdTopo(...); ibgeDe(cd, nome) → código IBGE do município (ou null);
 * limite: eleitores acima dos quais o município (com mais de uma zona) entra dividido nas zonas.
 * Devolve { unidades: [{ id, mun, zonas: [z], nome, aptos, x, y, area, ibge }], viz: { id: Set }, semMapa: [nome], pontes: n, proj }.
 * Toda unidade fica ligada: ilhas e municípios sem contorno ganham uma "ponte" para a unidade mais próxima.
 */
function sdUnidades(geo, malha, ibgeDe, limite = Infinity) {
  const feicoes = Object.values(malha.feicoes);
  let lo0 = 0, la0 = 0, n0 = 0;
  for (const f of feicoes) for (const p of f.poligonos) for (const [x, y] of p[0] || []) { lo0 += x; la0 += y; n0++; }
  const proj = sdProjetor(n0 ? lo0 / n0 : 0, n0 ? la0 / n0 : 0);
  const forma = {};
  for (const f of feicoes) forma[f.id] = sdAreaCentro(f.poligonos, proj);
  const unidades = [], porIbge = {}, semMapa = [], zonasDe = {};
  const viz = {};
  const ligar = (a, b) => { if (a === b) return; (viz[a] = viz[a] || new Set()).add(b); (viz[b] = viz[b] || new Set()).add(a); };
  for (const [cd, m] of Object.entries(geo.mun)) {
    const zs = Object.entries(m.zonas).filter(([, z]) => z.aptos > 0);
    if (!zs.length) continue;
    const aptos = zs.reduce((s, [, z]) => s + z.aptos, 0);
    const ibge = ibgeDe(cd, m.nome);
    const f = ibge && forma[ibge];
    if (!f) semMapa.push(m.nome || cd);
    const pz = ([, z]) => (z.la != null && z.lo != null ? proj([z.lo, z.la]) : null);
    // posição de reserva (município sem contorno): média das zonas que têm coordenadas
    const comPos = zs.map(pz).filter(Boolean);
    const centro = f ? [f.x, f.y] : comPos.length ? [comPos.reduce((s, p) => s + p[0], 0) / comPos.length, comPos.reduce((s, p) => s + p[1], 0) / comPos.length] : null;
    const area = f ? f.area : 0;
    if (aptos > limite && zs.length > 1) {
      zonasDe[cd] = [];
      zs.forEach((e, i) => {
        const p = pz(e) || (centro ? [centro[0] + Math.cos(i) * 0.5, centro[1] + Math.sin(i) * 0.5] : null);
        const u = { id: 'z:' + cd + ':' + e[0], mun: cd, zonas: [e[0]], nome: (m.nome || cd) + ' · zona ' + e[0], aptos: e[1].aptos,
          x: p ? p[0] : null, y: p ? p[1] : null, area: area * e[1].aptos / aptos, ibge: ibge || null };
        unidades.push(u); zonasDe[cd].push(u);
      });
    } else {
      const u = { id: 'm:' + cd, mun: cd, zonas: zs.map(e => e[0]), nome: m.nome || cd, aptos, x: centro ? centro[0] : null, y: centro ? centro[1] : null, area, ibge: ibge || null };
      unidades.push(u);
    }
    // dois municípios do TSE com o mesmo código do IBGE (raro): as unidades se juntam
    if (ibge) porIbge[ibge] = { unidades: ((porIbge[ibge] || {}).unidades || []).concat(zonasDe[cd] || [unidades[unidades.length - 1]]) };
  }
  const dist2 = (u, p) => (u.x - p[0]) ** 2 + (u.y - p[1]) ** 2;
  // num município dividido, as 2 zonas mais perto do ponto (a divisa passa entre zonas)
  const maisPerto = (lista, p) => lista.length === 1 ? lista : lista.filter(u => u.x != null).sort((a, b) => dist2(a, p) - dist2(b, p)).slice(0, 2);
  // zonas de um município dividido: as 4 mais próximas
  for (const lista of Object.values(zonasDe)) {
    for (const u of lista) {
      if (u.x == null) continue;
      const p = [u.x, u.y];
      lista.filter(w => w !== u && w.x != null).sort((a, b) => dist2(a, p) - dist2(b, p)).slice(0, 4).forEach(w => ligar(u.id, w.id));
    }
  }
  // municípios vizinhos: pela divisa; num dividido, as zonas mais perto de cada trecho da divisa
  for (const [a, vs] of Object.entries(malha.vizinhos)) {
    const ua = porIbge[a];
    if (!ua) continue;
    for (const b of vs) {
      if (b < a || !porIbge[b]) continue;
      const ub = porIbge[b];
      if (ua.unidades.length === 1 && ub.unidades.length === 1) { ligar(ua.unidades[0].id, ub.unidades[0].id); continue; }
      for (const pt of malha.fronteira[sdPar(a, b)] || []) {
        const p = proj(pt);
        for (const x of maisPerto(ua.unidades, p)) for (const y of maisPerto(ub.unidades, p)) ligar(x.id, y.id);
      }
    }
  }
  // tudo ligado: cada pedaço solto (ilha, município sem contorno) ganha uma ponte para o mais próximo do resto
  let pontes = 0;
  for (;;) {
    const comps = sdComponentes(unidades.map(u => u.id), viz);
    if (comps.length <= 1) break;
    comps.sort((a, b) => b.length - a.length);
    const resto = new Set(comps[0]), pedaco = comps[1];
    const porId = new Map(unidades.map(u => [u.id, u]));
    let melhor = null;
    for (const i of pedaco) {
      const u = porId.get(i);
      for (const j of resto) {
        const w = porId.get(j);
        const d = u.x == null || w.x == null ? Infinity : (u.x - w.x) ** 2 + (u.y - w.y) ** 2;
        if (!melhor || d < melhor.d) melhor = { d, i, j };
      }
    }
    if (!melhor || melhor.d === Infinity) {   // sem posição: liga à maior unidade
      const maior = [...resto].map(i => porId.get(i)).sort((a, b) => b.aptos - a.aptos)[0];
      melhor = { i: pedaco[0], j: maior.id };
    }
    ligar(melhor.i, melhor.j);
    pontes++;
  }
  for (const u of unidades) if (u.x == null) { u.x = 0; u.y = 0; }
  return { unidades, viz, semMapa, pontes, proj };
}

/** Componentes conexos de `ids` no grafo `viz` (só arestas entre os próprios ids). */
function sdComponentes(ids, viz) {
  const dentro = new Set(ids), visto = new Set(), comps = [];
  for (const s of ids) {
    if (visto.has(s)) continue;
    const comp = [s], fila = [s];
    visto.add(s);
    while (fila.length) {
      const u = fila.pop();
      for (const w of viz[u] || []) if (dentro.has(w) && !visto.has(w)) { visto.add(w); comp.push(w); fila.push(w); }
    }
    comps.push(comp);
  }
  return comps;
}

// ------------------------------------------------------------ desenho dos distritos
/** Fila de prioridade mínima (heap binário) — [prioridade, valor]. */
function sdFila() {
  const h = [];
  return {
    get tamanho() { return h.length; },
    por(p, v) { h.push([p, v]); let i = h.length - 1; while (i) { const j = (i - 1) >> 1; if (h[j][0] <= h[i][0]) break; [h[i], h[j]] = [h[j], h[i]]; i = j; } },
    tirar() {
      const top = h[0], fim = h.pop();
      if (h.length) {
        h[0] = fim; let i = 0;
        for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < h.length && h[a][0] < h[m][0]) m = a; if (b < h.length && h[b][0] < h[m][0]) m = b; if (m === i) break; [h[i], h[m]] = [h[m], h[i]]; i = m; }
      }
      return top;
    },
  };
}

/**
 * Desenha `k` distritos de eleitorado parecido, contíguos e compactos.
 * base: sdUnidades(...). op: { iteracoes: 20000 }.
 * Várias tentativas (pesos e eixos diferentes no corte); fica a de menor desvio
 * máximo e, empatadas, a mais compacta.
 * Devolve { distritos: [{ id, unidades: [id], aptos, desvio, x, y, compacidade }], alvo, metricas } ou { erro }.
 */
function sdDistritar(base, k, op = {}) {
  const { unidades, viz } = base;
  const U = new Map(unidades.map(u => [u.id, u]));
  const ids = unidades.map(u => u.id);
  if (!k || k < 1) return { erro: 'nenhum distrito a desenhar' };
  if (ids.length < k) return { erro: `o estado tem ${ids.length} unidades (municípios e zonas) para ${k} distritos` };
  const soma = lista => { let s = 0; for (const i of lista) s += U.get(i).aptos; return s; };
  const total = soma(ids), alvo = total / k;
  const tentativas = [
    { peso: 3, angulos: 6, pulos: 4 }, { peso: 1.5, angulos: 6, pulos: 4 }, { peso: 6, angulos: 6, pulos: 4 },
    { peso: 3, angulos: 2, pulos: 0 }, { peso: 3, angulos: 12, pulos: 8 },
  ];
  let melhor = null;
  for (const t of tentativas) {
    const partes = sdCortar(ids, k, U, viz, soma, t);
    const it = sdRefinar(partes, U, viz, alvo, op.iteracoes || 20000);
    const r = sdMedir(partes, U, viz, alvo, k);
    r.metricas.trocas = it;
    const nota = Math.round(r.metricas.desvioMax * 200) * 10 - r.metricas.compacidadeMedia;   // degraus de 0,5% no desvio; depois, compacidade
    if (!melhor || nota < melhor.nota) melhor = Object.assign(r, { nota });
  }
  delete melhor.nota;
  return Object.assign(melhor, { alvo });
}

/** Bisseção recursiva: lista de `kk` partes contíguas. t: { peso do desvio na nota do corte, nº de eixos, unidades grandes que o crescimento pode pular }. */
function sdCortar(ids, k, U, viz, soma, t) {
  // inércia (momento de 2ª ordem, pesado pelos eleitores): a dispersão de um pedaço
  const inercia = lista => {
    let s = 0, x = 0, y = 0;
    for (const i of lista) { const u = U.get(i); s += u.aptos; x += u.aptos * u.x; y += u.aptos * u.y; }
    if (!s) return 0;
    x /= s; y /= s;
    let I = 0;
    for (const i of lista) { const u = U.get(i); I += u.aptos * ((u.x - x) ** 2 + (u.y - y) ** 2); }
    return I;
  };
  const eixoPrincipal = lista => {
    let s = 0, x = 0, y = 0;
    for (const i of lista) { const u = U.get(i); s += u.aptos; x += u.aptos * u.x; y += u.aptos * u.y; }
    x /= s || 1; y /= s || 1;
    let sxx = 0, syy = 0, sxy = 0;
    for (const i of lista) { const u = U.get(i), dx = u.x - x, dy = u.y - y; sxx += u.aptos * dx * dx; syy += u.aptos * dy * dy; sxy += u.aptos * dx * dy; }
    return 0.5 * Math.atan2(2 * sxy, sxx - syy);
  };
  // Cresce um lado a partir da ponta (menor projeção no eixo), sempre pela unidade
  // de menor projeção na borda, até a meta de eleitores; uma unidade que passaria
  // mais da meta do que falta é pulada (até t.pulos vezes) e o crescimento segue.
  const crescer = (lista, ang, lado, meta) => {
    const dentro = new Set(lista), cos = Math.cos(ang), sin = Math.sin(ang);
    const pr = i => { const u = U.get(i); return lado * (u.x * cos + u.y * sin); };
    let ini = lista[0];
    for (const i of lista) if (pr(i) < pr(ini)) ini = i;
    const A = new Set([ini]);
    let s = U.get(ini).aptos, pulos = 0;
    const fila = sdFila(), naFila = new Set([ini]);
    const vizinhos = i => { for (const w of viz[i] || []) if (dentro.has(w) && !naFila.has(w)) { naFila.add(w); fila.por(pr(w), w); } };
    vizinhos(ini);
    while (s < meta && fila.tamanho) {
      const [, i] = fila.tirar();
      const a = U.get(i).aptos;
      if (s + a - meta > meta - s) { if (++pulos > t.pulos) break; continue; }
      A.add(i); s += a; vizinhos(i);
    }
    return A;
  };
  const partes = [];
  const cortar = (lista, kk) => {
    if (kk <= 1) { partes.push(lista); return; }
    const k1 = Math.floor(kk / 2), k2 = kk - k1, tot = soma(lista), Itot = inercia(lista) || 1;
    const ep = eixoPrincipal(lista);
    const angulos = Array.from({ length: t.angulos }, (_, i) => ep + Math.PI * i / t.angulos);
    const divisoes = k1 === k2 ? [[k1, k2]] : [[k1, k2], [k2, k1]];
    let melhor = null;
    for (const ang of angulos) for (const lado of [1, -1]) for (const [ka, kb] of divisoes) {
      const A = crescer(lista, ang, lado, tot * ka / kk);
      let B = lista.filter(i => !A.has(i));
      // o outro lado precisa ser contíguo: pedaços soltos passam para A
      const comps = sdComponentes(B, viz);
      if (comps.length > 1) {
        comps.sort((x, y) => soma(y) - soma(x));
        for (const c of comps.slice(1)) for (const i of c) A.add(i);
        B = comps[0];
      }
      if (A.size < ka || B.length < kb) continue;
      const la = [...A], sa = soma(la), sb = tot - sa;
      const erro = Math.abs(sa / ka - sb / kb) / (tot / kk);
      const nota = t.peso * erro + (inercia(la) + inercia(B)) / Itot;
      if (!melhor || nota < melhor.nota) melhor = { nota, A: la, B, ka, kb };
    }
    if (!melhor) {   // sem corte possível (poucas unidades): reparte em fatias pelo eixo
      const ord = lista.slice().sort((a, b) => U.get(a).x - U.get(b).x);
      melhor = { A: ord.slice(0, k1), B: ord.slice(k1), ka: k1, kb: k2 };
    }
    cortar(melhor.A, melhor.ka);
    cortar(melhor.B, melhor.kb);
  };
  cortar(ids, k);
  return partes;
}

/**
 * Trocas na fronteira (no lugar, em `partes`): a unidade passa ao distrito vizinho
 * se o desvio total (soma dos quadrados) cai. Se a saída dela partiria o distrito
 * de origem, os pedaços que ficariam soltos vão junto (encostam nela, então o
 * destino segue contíguo). A unidade não pode ficar longe do novo distrito: até
 * 2× a distância ao centro do atual + 5 km, ou até 1,3× o raio que o novo já
 * ocupa (distritos compridos, no interior, têm o centro longe de tudo).
 * Devolve o número de trocas.
 */
function sdRefinar(partes, U, viz, alvo, maxIt) {
  const dist = new Map();
  partes.forEach((p, d) => { for (const i of p) dist.set(i, d); });
  const apt = partes.map(p => p.reduce((s, i) => s + U.get(i).aptos, 0));
  const cx = partes.map(() => 0), cy = partes.map(() => 0), raio = partes.map(() => 0);
  const centro = d => {
    let s = 0, x = 0, y = 0;
    for (const i of partes[d]) { const u = U.get(i); s += u.aptos; x += u.aptos * u.x; y += u.aptos * u.y; }
    cx[d] = s ? x / s : 0; cy[d] = s ? y / s : 0;
    raio[d] = 0;
    for (const i of partes[d]) { const u = U.get(i); raio[d] = Math.max(raio[d], Math.hypot(u.x - cx[d], u.y - cy[d])); }
  };
  partes.forEach((_, d) => centro(d));
  const desv = a => (a / alvo - 1) ** 2;
  let it = 0;
  for (; it < maxIt; it++) {
    let melhor = null;
    for (const [i, a] of dist) {
      if (partes[a].length <= 1) continue;
      const u = U.get(i);
      const vistos = new Set();
      for (const w of viz[i] || []) {
        const b = dist.get(w);
        if (b === a || vistos.has(b)) continue;
        vistos.add(b);
        const da = Math.hypot(u.x - cx[a], u.y - cy[a]), db = Math.hypot(u.x - cx[b], u.y - cy[b]);
        if (db > 2 * da + 5 && db > 1.3 * raio[b]) continue;
        // ganho só com a unidade (cota inferior barata para o caso com pedaços soltos)
        const so = desv(apt[a] - u.aptos) + desv(apt[b] + u.aptos) - desv(apt[a]) - desv(apt[b]);
        if (melhor && so >= melhor.delta && so < 0) continue;
        const resto = partes[a].filter(x => x !== i);
        const comps = sdComponentes(resto, viz);
        let leva = [i], q = u.aptos;
        if (comps.length > 1) {
          comps.sort((x, y) => y.reduce((s, j) => s + U.get(j).aptos, 0) - x.reduce((s, j) => s + U.get(j).aptos, 0));
          for (const c of comps.slice(1)) for (const j of c) { leva.push(j); q += U.get(j).aptos; }
        }
        const delta = desv(apt[a] - q) + desv(apt[b] + q) - desv(apt[a]) - desv(apt[b]);
        if (delta < -1e-12 && (!melhor || delta < melhor.delta)) melhor = { delta, leva, q, a, b };
      }
    }
    if (!melhor) break;
    const { leva, q, a, b } = melhor;
    const sai = new Set(leva);
    partes[a] = partes[a].filter(x => !sai.has(x));
    for (const j of leva) { partes[b].push(j); dist.set(j, b); }
    apt[a] -= q; apt[b] += q;
    centro(a); centro(b);
  }
  return it;
}

/** Distritos (numerados de norte a sul, de oeste a leste) e as métricas de qualidade. */
function sdMedir(partes, U, viz, alvo, k) {
  const distritos = partes.map(p => {
    let s = 0, x = 0, y = 0, A = 0, ax = 0, ay = 0;
    for (const i of p) { const u = U.get(i); s += u.aptos; x += u.aptos * u.x; y += u.aptos * u.y; A += u.area; ax += u.area * u.x; ay += u.area * u.y; }
    const mx = A ? ax / A : x / (s || 1), my = A ? ay / A : y / (s || 1);
    let I = 0;
    for (const i of p) { const u = U.get(i); I += u.area * ((u.x - mx) ** 2 + (u.y - my) ** 2) + u.area * u.area / (2 * Math.PI); }
    return { id: 0, unidades: p.slice(), aptos: s, desvio: s / alvo - 1, x: x / (s || 1), y: y / (s || 1), compacidade: I ? Math.min(1, A * A / (2 * Math.PI) / I) : 1 };
  });
  const ys = distritos.map(d => d.y), topo = Math.max(...ys), alt = (topo - Math.min(...ys)) || 1, faixa = alt / Math.max(1, Math.round(Math.sqrt(k)));
  distritos.sort((a, b) => Math.floor((topo - a.y) / faixa) - Math.floor((topo - b.y) / faixa) || a.x - b.x);
  distritos.forEach((d, i) => { d.id = i + 1; });
  const munDist = {};
  for (const d of distritos) for (const i of d.unidades) { const m = U.get(i).mun; (munDist[m] = munDist[m] || new Set()).add(d.id); }
  const abs = distritos.map(d => Math.abs(d.desvio));
  const metricas = {
    desvioMax: Math.max(...abs), desvioMedio: abs.reduce((s, v) => s + v, 0) / k,
    compacidadeMedia: distritos.reduce((s, d) => s + d.compacidade, 0) / k, compacidadeMin: Math.min(...distritos.map(d => d.compacidade)),
    contiguos: distritos.every(d => sdComponentes(d.unidades, viz).length === 1),
    municipiosDivididos: Object.values(munDist).filter(s => s.size > 1).length,
    unidades: U.size, zonas: [...U.keys()].filter(i => i.startsWith('z:')).length,
  };
  return { distritos, metricas };
}

// ------------------------------------------------------------ eleição
/** Nome curto da agremiação: as siglas (federação: "PT/PCdoB/PV"). */
function sdSiglas(a) { return a ? ((a.siglas || []).join('/') || a.nome || a.id) : ''; }

/**
 * Votos de cada distrito: por candidato (sq) e por agremiação (nominais válidos + legenda).
 * d: o estado (snLerUF / dados abertos); desenho: sdDistritar; base: sdUnidades; votos: geo.votos[cargo].
 */
function sdVotosDistritos(d, desenho, base, votos) {
  const U = new Map(base.unidades.map(u => [u.id, u]));
  const cand = new Map(), siglaAgr = {};
  for (const a of d.agrs) { for (const c of a.cands) cand.set(String(c.sq), { a, c }); for (const sg of a.siglas) siglaAgr[sg] = a; }
  return desenho.distritos.map(dt => {
    const porCand = {}, porAgr = {};
    let validos = 0;
    for (const id of dt.unidades) {
      const u = U.get(id);
      for (const z of u.zonas) {
        const v = votos[u.mun + '|' + z];
        if (!v) continue;
        for (const sq in v.c) {
          const x = cand.get(sq);
          if (!x || !x.c.valido) continue;
          const n = v.c[sq];
          porCand[sq] = (porCand[sq] || 0) + n; porAgr[x.a.id] = (porAgr[x.a.id] || 0) + n; validos += n;
        }
        for (const sg in v.l) {
          const a = siglaAgr[sg];
          if (!a) continue;
          porAgr[a.id] = (porAgr[a.id] || 0) + v.l[sg]; validos += v.l[sg];
        }
      }
    }
    return { id: dt.id, porCand, porAgr, validos };
  });
}

/**
 * Distrital misto num estado. op: { regra: 'partido'|'candidato', modelo: 'paralelo'|'compensatorio', limiar }
 * + desenho (sdDistritar), base (sdUnidades) e votos (geo.votos[cargo]).
 * Devolve como os outros sistemas ({ vagas, eleitos, porAgr, nLista }) e mais
 * nDistritos e distritos: [{ id, aptos, desvio, validos, vencedor: { sq, agr, votos, pct }, segundo: { agr, votos, pct } }].
 */
function sdDistritalMisto(d, op) {
  const vagas = op.vagas != null ? op.vagas : d.vagas;
  const vd = sdVotosDistritos(d, op.desenho, op.base, op.votos);
  const cand = new Map(), agr = new Map(d.agrs.map(a => [a.id, a]));
  for (const a of d.agrs) for (const c of a.cands) cand.set(String(c.sq), { a, c });
  const ganha = new Map(), usados = new Set();
  // líder de cada distrito (agremiação)
  const lider = vd.map(x => Object.entries(x.porAgr).sort((p, q) => q[1] - p[1]));
  const pares = [];
  vd.forEach((x, i) => {
    const so = op.regra === 'candidato' ? null : (lider[i][0] || [])[0];
    for (const sq in x.porCand) {
      const k = cand.get(sq);
      if (so && k.a.id !== so) continue;
      pares.push([x.porCand[sq] / (x.validos || 1), i, sq]);
    }
  });
  pares.sort((p, q) => q[0] - p[0] || q[2].localeCompare(p[2]));
  for (const [, i, sq] of pares) {
    if (ganha.has(i) || usados.has(sq)) continue;
    ganha.set(i, sq); usados.add(sq);
  }
  const primeiros = [];
  const distritos = op.desenho.distritos.map((dt, i) => {
    const x = vd[i], sq = ganha.get(i), k = sq && cand.get(sq);
    const lid = lider[i];
    const seg = k ? lid.find(([id]) => id !== k.a.id) : lid[1];
    if (k) primeiros.push({ sq, agr: k.a.id, fase: 'distrito ' + dt.id, cand: k.c, distrito: dt.id });
    return { id: dt.id, aptos: dt.aptos, desvio: dt.desvio, validos: x.validos,
      vencedor: k ? { sq, agr: k.a.id, nome: k.c.nome, partido: k.c.partido, votos: x.porCand[sq], pct: x.porCand[sq] / (x.validos || 1),
        agrNome: sdSiglas(k.a), agrVotos: x.porAgr[k.a.id] || 0, agrPct: (x.porAgr[k.a.id] || 0) / (x.validos || 1) } : null,
      segundo: seg ? { agr: seg[0], nome: sdSiglas(agr.get(seg[0])) || seg[0], votos: seg[1], pct: seg[1] / (x.validos || 1) } : null };
  });
  const r = sdCompletarLista(d, primeiros, vagas, op);
  return Object.assign(r, { nDistritos: primeiros.length, distritos });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sdTopo, sdProjetor, sdAreaCentro, sdLeitorGeo, sdUnidades, sdComponentes, sdFila, sdDistritar, sdCortar, sdRefinar, sdMedir, sdVotosDistritos, sdDistritalMisto };
}
