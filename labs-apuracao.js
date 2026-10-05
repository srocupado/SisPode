'use strict';
// Apuração 2026 — leitura da divulgação oficial do TSE (resultados.tse.jus.br).
//
// Funções puras compartilhadas pela aba Apuração do Labs e pelo site
// (apuracao/): endereço de cada arquivo por UF e cargo, código da eleição lido
// da configuração do TSE (com os códigos de 2026 conferidos em 03/10 como
// reserva), leitura de todos os partidos e candidatos com a projeção de eleitos
// e a cor do mapa. A tela fica em apuracao/apuracao-site.js.

const AP_BASE = 'https://resultados.tse.jus.br/oficial';
const AP_CICLO = 'ele2026';
const AP_ELEICAO_PADRAO = '6259';   // Eleição Ordinária Estadual 2026, 1º turno (conferido em 03/10/2026)
const AP_CARGO = 6;                 // Deputado Federal
const AP_INTERVALO = 30000;
const AP_UFS = { ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo',
  go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco',
  pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul',
  sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins' };

function apNum(s) { const n = parseFloat(String(s == null ? '' : s).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }

/** Código da eleição (1º turno) que tem o cargo, pela configuração do TSE. Pura. */
function apEleicaoDaConfig(cfg, cargo = AP_CARGO) {
  const pl = ((cfg && cfg.pl) || []).find(p => p.c === AP_CICLO);
  if (!pl) return null;
  const e = (pl.e || []).find(x => (x.abr || []).some(a => (a.cp || []).some(c => +c.cd === +cargo)) && String(x.t) === '1');
  return e ? String(e.cd) : null;
}

function apUrl(uf, eleicao = AP_ELEICAO_PADRAO, cargo = AP_CARGO) {
  const c = String(cargo).padStart(4, '0'), e = String(eleicao).padStart(6, '0');
  return `${AP_BASE}/${AP_CICLO}/${eleicao}/dados/${uf}/${uf}-c${c}-e${e}-u.json`;
}

/** Candidato eleito? O TSE marca "e":"s" e/ou descreve na situação ("Eleito por QP", "Eleito por média"…). */
function apEleito(c) {
  return c.e === 's' || (/eleit/i.test(c.st || '') && !/n[ãa]o eleit/i.test(c.st || ''));
}

/**
 * Lê o arquivo de uma UF com TODOS os partidos e candidatos. Pura.
 * Durante a apuração o TSE não marca eleitos, mas informa as vagas que cada
 * agremiação (partido isolado ou federação) obtém no momento: os N mais votados
 * dela ficam como "projetado" (eleito pela parcial). Nos cargos majoritários
 * (presidente, governador, senador) a projeção é estar entre os nv mais votados.
 * A marcação oficial do TSE (e/st) sempre prevalece.
 */
function apLerUFTodos(j, uf) {
  const s = j.s || {}, v = j.v || {};
  const cargo = (j.carg || [])[0] || {};
  const majoritario = [1, 3, 5].includes(+cargo.cd);
  const nv = apNum(cargo.nv);
  const partidos = [], candidatos = [];
  for (const a of cargo.agr || []) {
    const vag = apNum(a.vag), doAgr = [];
    for (const p of a.par || []) {
      const nominais = apNum(p.tvtn), legenda = apNum(p.tvtl);
      partidos.push({ numero: String(p.n), sigla: p.sg, nome: p.nm, nominais, legenda, total: nominais + legenda, vagas: vag, federacao: a.tp !== 'i' ? (a.nm || '') : '' });
      for (const c of p.cand || []) {
        doAgr.push({ numero: c.n, nome: c.nmu || c.nm, nomeCompleto: c.nm, partido: p.sg, partidoNum: String(p.n),
          votos: apNum(c.vap), pct: apNum(c.pvap), eleito: apEleito(c), situacao: c.st || '', projetado: false });
      }
    }
    doAgr.sort((x, y) => y.votos - x.votos);
    if (!majoritario) doAgr.forEach((c, i) => { c.projetado = !c.eleito && i < vag && c.votos > 0; });
    candidatos.push(...doAgr);
  }
  candidatos.sort((x, y) => y.votos - x.votos || x.nome.localeCompare(y.nome));
  if (majoritario && !candidatos.some(c => c.eleito)) candidatos.forEach((c, i) => { c.projetado = i < nv && c.votos > 0; });
  return {
    uf, nome: uf === 'br' ? 'Brasil' : (AP_UFS[uf] || uf.toUpperCase()), cargo: +cargo.cd, cargoNome: cargo.nmn || '', majoritario,
    secoes: apNum(s.ts), apuradas: apNum(s.st), pct: apNum(s.pst),
    atualizado: [j.dg, j.hg].filter(Boolean).join(' '), final: j.tf === 's',
    vagasUF: nv, quociente: apNum(cargo.qe), validos: apNum(v.vv), partidos, candidatos,
  };
}

/**
 * Cláusula de desempenho (barreira) de 2026 — EC 97/2017, art. 3º, parágrafo
 * único, III: o partido atinge se, para a Câmara, (a) tiver 2,5% dos votos
 * válidos do país, distribuídos em pelo menos 1/3 das UFs (9) com no mínimo
 * 1,5% dos válidos em cada uma; OU (b) eleger 13 deputados federais em pelo
 * menos 9 UFs. A federação conta como um partido só (Lei 14.208/2021).
 * Recebe as UFs lidas por apLerUFTodos (Deputado Federal). Conta como eleito o
 * oficial e o projetado. Pura.
 */
const AP_CLAUSULA = { pctBR: 2.5, pctUF: 1.5, ufs: 9, eleitos: 13 };
function apClausula(ufs) {
  const g = {};
  let validosBR = 0;
  const grupo = p => p.federacao || p.sigla;
  for (const d of ufs) {
    validosBR += d.validos;
    const daUF = {};
    for (const p of d.partidos) {
      const k = grupo(p);
      const x = g[k] = g[k] || { nome: k, federacao: !!p.federacao, siglas: [], votos: 0, ufs: [], eleitos: [] };
      if (!x.siglas.includes(p.sigla)) x.siglas.push(p.sigla);
      x.votos += p.total;
      daUF[k] = (daUF[k] || 0) + p.total;
    }
    for (const k of Object.keys(daUF)) g[k].ufs.push({ uf: d.uf, pct: d.validos ? 100 * daUF[k] / d.validos : 0 });
    for (const c of d.candidatos) {
      if (!c.eleito && !c.projetado) continue;
      const p = d.partidos.find(x => x.numero === c.partidoNum);
      if (p) g[grupo(p)].eleitos.push(Object.assign({ uf: d.uf }, c));
    }
  }
  return Object.values(g).map(x => {
    const pct = validosBR ? 100 * x.votos / validosBR : 0;
    x.ufs.sort((a, b) => b.pct - a.pct);
    const ufsMin = x.ufs.filter(u => u.pct >= AP_CLAUSULA.pctUF);
    const ufsEleitos = new Set(x.eleitos.map(c => c.uf)).size;
    const atingeA = pct >= AP_CLAUSULA.pctBR && ufsMin.length >= AP_CLAUSULA.ufs;
    const atingeB = x.eleitos.length >= AP_CLAUSULA.eleitos && ufsEleitos >= AP_CLAUSULA.ufs;
    x.eleitos.sort((a, b) => a.uf.localeCompare(b.uf) || b.votos - a.votos);
    // A UF que faltava, quando o partido passou dos 2,5% mas não das 9 UFs.
    const proxima = pct >= AP_CLAUSULA.pctBR && ufsMin.length < AP_CLAUSULA.ufs ? x.ufs[ufsMin.length] || null : null;
    return Object.assign(x, { pct, ufsMin: ufsMin.length, ufsEleitos, atingeA, atingeB, atinge: atingeA || atingeB,
      projetados: x.eleitos.filter(c => !c.eleito).length, proxima });
  }).sort((a, b) => b.votos - a.votos);
}

/** Cor da UF pelo percentual apurado: cinza (0%) → verde do partido (100%). */
function apCor(pct) {
  if (!(pct > 0)) return '#2b3440';
  const t = Math.min(1, pct / 100), a = [0x3a, 0x4a, 0x3c], b = [0x00, 0xa8, 0x59];
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { apEleicaoDaConfig, apUrl, apLerUFTodos, apClausula, AP_CLAUSULA, apEleito, apCor, apNum };
}
