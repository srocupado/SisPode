'use strict';
// Apuração — leitura da divulgação oficial do TSE (resultados.tse.jus.br).
//
// Funções puras compartilhadas pela aba Apuração do Labs e pelo site
// (apuracao/): as eleições gerais e turnos que o TSE publica (lidos da
// configuração dele, com 2026 1º turno conferido em 03/10 como reserva),
// endereço de cada arquivo por UF e cargo, leitura de todos os partidos e
// candidatos com a projeção de eleitos, cláusula de barreira do ano e a cor do
// mapa. A tela fica em apuracao/apuracao-site.js.

const AP_BASE = 'https://resultados.tse.jus.br/oficial';
const AP_CICLO = 'ele2026';         // reserva, se a configuração do TSE não carregar
const AP_ELEICAO_PADRAO = '6259';   // Eleição Ordinária Estadual 2026, 1º turno (conferido em 03/10/2026)
const AP_CARGOS_GERAIS = [1, 3, 5, 6, 7, 8];   // Presidente, Governador, Senador, Dep. Federal, Estadual, Distrital
const AP_CARGO = 6;                 // Deputado Federal
const AP_INTERVALO = 30000;
const AP_UFS = { ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo',
  go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco',
  pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul',
  sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins' };

function apNum(s) { const n = parseFloat(String(s == null ? '' : s).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }

/**
 * Eleições GERAIS publicadas na configuração do TSE (ele-c.json), uma opção
 * por pleito e turno, da mais recente para a mais antiga. Só as ordinárias
 * federal (tp 8) e estadual (tp 1): ficam de fora municipais, suplementares e
 * consultas. Cada opção traz, por cargo, o código
 * da eleição e as UFs com arquivo (null = todas; no 2º turno de governador, só
 * as UFs que têm 2º turno). O 2º turno ainda não publicado entra pelo código
 * que o TSE já reserva no 1º (cdt2), quando a data do 1º turno já passou —
 * assim o painel acompanha o 2º turno desde a primeira divulgação. Pura.
 */
function apEleicoesGerais(cfg, hoje = new Date()) {
  const data = s => { const m = /(\d+)\/(\d+)\/(\d+)/.exec(s || ''); return m ? new Date(+m[3], m[2] - 1, +m[1]) : null; };
  const ops = [], vistos = new Set();
  for (const pl of (cfg && cfg.pl) || []) {
    const op = { id: '', ciclo: pl.c, ano: +String(pl.c).replace(/\D/g, '') || 0, data: pl.dt || '', turno: 0, cargos: {} };
    for (const e of pl.e || []) {
      if (!['1', '8'].includes(String(e.tp))) continue;
      for (const a of e.abr || []) for (const cp of a.cp || []) {
        const cd = +cp.cd;
        if (!AP_CARGOS_GERAIS.includes(cd)) continue;
        op.turno = +e.t || 1;
        const c = op.cargos[cd] = op.cargos[cd] || { eleicao: String(e.cd), ufs: [] };
        if (a.cd === 'br') c.ufs = null; else if (c.ufs) c.ufs.push(a.cd);
        if (e.cdt2) op.cdt2 = Object.assign(op.cdt2 || {}, { [cd]: String(e.cdt2) });
      }
    }
    if (!Object.keys(op.cargos).length) continue;
    op.id = `${pl.c}-${op.turno}-${pl.cd}`;
    vistos.add(`${pl.c}-${op.turno}`);
    ops.push(op);
  }
  // 2º turno ainda não publicado: só Presidente e Governador vão a 2º turno.
  for (const op of ops.slice()) {
    if (op.turno !== 1 || !op.cdt2 || vistos.has(`${op.ciclo}-2`)) continue;
    const d1 = data(op.data);
    if (!d1 || hoje < d1) continue;
    const cargos = {};
    for (const cd of [1, 3]) if (op.cdt2[cd]) cargos[cd] = { eleicao: op.cdt2[cd], ufs: null };
    if (Object.keys(cargos).length) ops.push({ id: `${op.ciclo}-2-previsto`, ciclo: op.ciclo, ano: op.ano, data: '', turno: 2, cargos, previsto: true });
  }
  for (const op of ops) delete op.cdt2;
  const chave = op => (data(op.data) || new Date(op.ano, 11, 31)).getTime() + op.turno;
  return ops.sort((a, b) => chave(b) - chave(a));
}

/** A opção que o painel abre: a mais recente já publicada (o 2º turno previsto só quando escolhido). */
function apEleicaoInicial(ops) { return ops.find(o => !o.previsto) || ops[0] || apEleicaoReserva(); }

/** Reserva, se a configuração do TSE não carregar: 2026, 1º turno (códigos conferidos em 03/10/2026). */
function apEleicaoReserva() {
  return { id: 'ele2026-1-3220', ciclo: AP_CICLO, ano: 2026, data: '04/10/2026', turno: 1, cargos: {
    1: { eleicao: '6257', ufs: null }, 3: { eleicao: AP_ELEICAO_PADRAO, ufs: null }, 5: { eleicao: AP_ELEICAO_PADRAO, ufs: null },
    6: { eleicao: AP_ELEICAO_PADRAO, ufs: null }, 7: { eleicao: AP_ELEICAO_PADRAO, ufs: null }, 8: { eleicao: AP_ELEICAO_PADRAO, ufs: null } } };
}

function apUrl(uf, eleicao = AP_ELEICAO_PADRAO, cargo = AP_CARGO, ciclo = AP_CICLO) {
  const c = String(cargo).padStart(4, '0'), e = String(eleicao).padStart(6, '0');
  return `${AP_BASE}/${ciclo}/${eleicao}/dados/${uf}/${uf}-c${c}-e${e}-u.json`;
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
 * Cláusula de desempenho (barreira) — EC 97/2017, art. 3º, parágrafo único
 * (transição até 2030) e art. 17, § 3º, da Constituição (a partir de 2030): o
 * partido atinge se, para a Câmara, (a) tiver pctBR% dos votos válidos do país,
 * distribuídos em pelo menos 1/3 das UFs (9) com no mínimo pctUF% em cada uma;
 * OU (b) eleger `eleitos` deputados federais em pelo menos 9 UFs. A federação
 * conta como um partido só (Lei 14.208/2021, a partir de 2022).
 */
const AP_CLAUSULA_ANOS = {
  2018: { pctBR: 1.5, pctUF: 1, ufs: 9, eleitos: 9, base: 'EC 97/2017, art. 3º, parágrafo único, I' },
  2022: { pctBR: 2, pctUF: 1, ufs: 9, eleitos: 11, base: 'EC 97/2017, art. 3º, parágrafo único, II' },
  2026: { pctBR: 2.5, pctUF: 1.5, ufs: 9, eleitos: 13, base: 'EC 97/2017, art. 3º, parágrafo único, III' },
  2030: { pctBR: 3, pctUF: 2, ufs: 9, eleitos: 15, base: 'Constituição, art. 17, § 3º (redação da EC 97/2017)' },
};
/** Regra da cláusula para o ano da eleição (null antes de 2018, quando não havia). Pura. */
function apClausulaRegra(ano) {
  const anos = Object.keys(AP_CLAUSULA_ANOS).map(Number).filter(a => a <= ano);
  return anos.length ? Object.assign({ ano }, AP_CLAUSULA_ANOS[Math.max(...anos)]) : null;
}
const AP_CLAUSULA = apClausulaRegra(2026);

/**
 * Aplica a cláusula às UFs lidas por apLerUFTodos (Deputado Federal). Conta
 * como eleito o oficial e o projetado. Pura.
 */
function apClausula(ufs, regra = AP_CLAUSULA) {
  const R = regra;
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
    const ufsMin = x.ufs.filter(u => u.pct >= R.pctUF);
    const ufsEleitos = new Set(x.eleitos.map(c => c.uf)).size;
    const atingeA = pct >= R.pctBR && ufsMin.length >= R.ufs;
    const atingeB = x.eleitos.length >= R.eleitos && ufsEleitos >= R.ufs;
    x.eleitos.sort((a, b) => a.uf.localeCompare(b.uf) || b.votos - a.votos);
    // A UF que faltava, quando o partido passou dos 2,5% mas não das 9 UFs.
    const proxima = pct >= R.pctBR && ufsMin.length < R.ufs ? x.ufs[ufsMin.length] || null : null;
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
  module.exports = { apEleicoesGerais, apEleicaoInicial, apEleicaoReserva, apUrl, apLerUFTodos, apClausula, apClausulaRegra, AP_CLAUSULA, apEleito, apCor, apNum };
}
