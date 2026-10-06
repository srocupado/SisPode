'use strict';
// Labs · Perfil da Bancada — NÚCLEO (puro: sem rede, sem tela).
//
// Lê o cadastro de candidaturas do TSE (consulta_cand_{ano}_BRASIL.csv) e,
// opcionalmente, os votos por município (votacao_candidato_munzona), e monta o
// perfil das candidaturas e dos eleitos de um partido por cargo, com recortes:
// gênero, cor/raça, faixa etária, escolaridade, ocupação, região e — para os
// eleitos da eleição mais recente — a trajetória (reeleição, mandato por outro
// partido, outro cargo, candidatura anterior, estreia).
//
// O cadastro do TSE traz CPF, e-mail e título de eleitor: NADA disso é lido ou
// gravado. O registro guardado por candidatura é só o que os recortes usam.

// Leitor de CSV do TSE: o mesmo do Mapa Territorial (labs-mapa-nucleo.js).
const _lpnMapa = typeof lmnCampos === 'function' ? null : require('./labs-mapa-nucleo.js');
function lpnCampos(t) { return (_lpnMapa ? _lpnMapa.lmnCampos : lmnCampos)(t); }

const LPN_PARTIDO = 'PODE';
const LPN_ANOS = ['2022', '2026'];
const LPN_GRUPOS = {
  fed: { nome: 'Deputado(a) federal', cargos: ['6'] },
  est: { nome: 'Deputado(a) estadual e distrital', cargos: ['7', '8'] },
  sen: { nome: 'Senador(a)', cargos: ['5'] },
};
const LPN_REGIAO = {
  AC: 'Norte', AM: 'Norte', AP: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MS: 'Centro-Oeste', MT: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
};
const LPN_ORDEM = {
  genero: ['Mulheres', 'Homens', 'Não informado'],
  raca: ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não informada'],
  faixa: ['Até 29 anos', '30 a 39', '40 a 49', '50 a 59', '60 anos ou mais', 'Não informada'],
  escolaridade: ['Superior completo', 'Superior incompleto', 'Ensino médio completo', 'Ensino médio incompleto',
    'Ensino fundamental completo', 'Ensino fundamental incompleto', 'Lê e escreve', 'Não informada'],
  regiao: ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'],
  trajetoria: ['Reeleito(a) pelo partido', 'Tinha mandato por outro partido', 'Veio de outro cargo eletivo', 'Concorreu na eleição anterior sem se eleger', 'Estreante'],
};
const LPN_RECORTES = [
  ['genero', 'Gênero'], ['raca', 'Cor/raça'], ['faixa', 'Faixa etária'], ['escolaridade', 'Escolaridade'],
  ['regiao', 'Região'], ['ocupacao', 'Ocupação declarada'],
];

function lpnNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase(); }
function lpnCap(s) { const t = String(s || '').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); }
function lpnEleito(sit) { return /^eleito/.test(lpnNorm(sit)); }

/** Idade completa na data (dd/mm/aaaa). null se a data não for válida. */
function lpnIdade(nasc, dataEleicao) {
  const a = /(\d\d)\/(\d\d)\/(\d{4})/.exec(nasc || ''), b = /(\d\d)\/(\d\d)\/(\d{4})/.exec(dataEleicao || '');
  if (!a || !b) return null;
  let i = +b[3] - +a[3];
  if (+b[2] < +a[2] || (+b[2] === +a[2] && +b[1] < +a[1])) i--;
  return i >= 18 && i < 110 ? i : null;
}

/** Categoria de cada recorte para uma candidatura (registro compacto). */
function lpnCategoria(c, recorte) {
  switch (recorte) {
    case 'genero': return c.g === 'FEMININO' ? 'Mulheres' : c.g === 'MASCULINO' ? 'Homens' : 'Não informado';
    case 'raca': { const r = lpnNorm(c.r); return { branca: 'Branca', preta: 'Preta', parda: 'Parda', amarela: 'Amarela', indigena: 'Indígena' }[r] || 'Não informada'; }
    case 'faixa': { const i = c.i; return i == null ? 'Não informada' : i < 30 ? 'Até 29 anos' : i < 40 ? '30 a 39' : i < 50 ? '40 a 49' : i < 60 ? '50 a 59' : '60 anos ou mais'; }
    case 'escolaridade': { const e = lpnCap(c.e); return LPN_ORDEM.escolaridade.includes(e) ? e : (/le e escreve/.test(lpnNorm(c.e)) ? 'Lê e escreve' : 'Não informada'); }
    case 'regiao': return LPN_REGIAO[c.u] || '—';
    case 'ocupacao': return c.o ? lpnCap(c.o) : 'Não informada';
    case 'trajetoria': return c.t || 'Estreante';
    default: return '—';
  }
}

/**
 * Leitor do cadastro de candidaturas: chamar `linha(texto)` para cada linha
 * (a 1ª é o cabeçalho). Guarda só as do partido; de TODOS os partidos, guarda
 * — se `procurar` for dado — as candidaturas das pessoas procuradas (nome civil
 * + UF), para a trajetória. resultado() → { ano, data, c: { sq: registro }, achados }.
 */
function lpnLeitorCadastro(ano, partido = LPN_PARTIDO, procurar = null) {
  let I = null, data = '', gerado = '';
  const c = {}, achados = {};
  const OBRIG = ['SG_UF', 'CD_CARGO', 'SQ_CANDIDATO', 'NM_CANDIDATO', 'NM_URNA_CANDIDATO', 'SG_PARTIDO', 'NR_TURNO', 'DS_GENERO', 'DS_COR_RACA', 'DT_NASCIMENTO', 'DS_GRAU_INSTRUCAO', 'DS_OCUPACAO', 'DS_SIT_TOT_TURNO'];
  return {
    linha(texto) {
      const f = lpnCampos(texto);
      if (!I) {
        I = {}; f.forEach((k, i) => { I[String(k).trim().toUpperCase()] = i; });
        const falta = OBRIG.filter(k => I[k] == null);
        if (falta.length) throw new Error('Arquivo fora do formato do cadastro de candidaturas do TSE. Faltam: ' + falta.join(', '));
        return;
      }
      const sq = f[I.SQ_CANDIDATO], turno = +f[I.NR_TURNO] || 1, uf = f[I.SG_UF];
      if (!data && I.DT_ELEICAO != null && turno === 1) data = f[I.DT_ELEICAO];
      if (!gerado && I.DT_GERACAO != null) gerado = f[I.DT_GERACAO];
      if (procurar) {
        const k = lpnNorm(f[I.NM_CANDIDATO]) + '|' + uf, ku = 'u:' + lpnNorm(f[I.NM_URNA_CANDIDATO]) + '|' + uf;
        for (const chave of [k, ku]) if (procurar.has(chave) && turno === 1) {
          (achados[chave] = achados[chave] || []).push({ cargo: f[I.CD_CARGO], dsCargo: f[I.DS_CARGO] || '', partido: f[I.SG_PARTIDO], sit: f[I.DS_SIT_TOT_TURNO] });
        }
      }
      if (f[I.SG_PARTIDO] !== partido) return;
      const r = c[sq] || (c[sq] = { u: uf, k: f[I.CD_CARGO], n: f[I.NM_URNA_CANDIDATO], g: f[I.DS_GENERO], r: f[I.DS_COR_RACA],
        nasc: f[I.DT_NASCIMENTO], e: f[I.DS_GRAU_INSTRUCAO], o: f[I.DS_OCUPACAO], s: '', tu: 0, v: 0, civil: lpnNorm(f[I.NM_CANDIDATO]) });
      if (turno >= r.tu) { r.tu = turno; r.s = f[I.DS_SIT_TOT_TURNO]; }   // situação final (2º turno, se houve)
    },
    resultado() {
      for (const r of Object.values(c)) { r.i = lpnIdade(r.nasc, data); delete r.nasc; delete r.tu; }
      return { ano: String(ano), data, gerado, c, achados };
    },
  };
}

/** Soma os votos nominais válidos (1º turno) do arquivo por município nas candidaturas do partido. Chamar com cada linha. */
function lpnSomadorVotos(cad, partido = LPN_PARTIDO) {
  let I = null, linhas = 0;
  return {
    novoArquivo() { I = null; },
    linha(texto) {
      const f = lpnCampos(texto);
      if (!I) { I = {}; f.forEach((k, i) => { I[String(k).trim().toUpperCase()] = i; }); return; }
      if (f[I.SG_PARTIDO] !== partido || (I.NR_TURNO != null && f[I.NR_TURNO] !== '1')) return;
      const r = cad.c[f[I.SQ_CANDIDATO]];
      if (r) { r.v += parseInt(f[I.QT_VOTOS_NOMINAIS_VALIDOS != null ? I.QT_VOTOS_NOMINAIS_VALIDOS : I.QT_VOTOS_NOMINAIS], 10) || 0; linhas++; }
    },
    linhas: () => linhas,
  };
}

/** Pessoas a procurar na eleição anterior: os eleitos do partido (nome civil + UF, e nome de urna como reserva). */
function lpnProcurados(cad) {
  const s = new Set();
  for (const r of Object.values(cad.c)) if (lpnEleito(r.s) && r.civil) { s.add(r.civil + '|' + r.u); s.add('u:' + lpnNorm(r.n) + '|' + r.u); }
  return s;
}

/**
 * Trajetória de cada eleito da eleição atual, pelo que ele fez na anterior
 * (achados do leitor da anterior). Nome civil primeiro; nome de urna só se
 * casar uma candidatura só. Grava em r.t e r.ant ("Deputado Federal pelo MDB — eleito").
 */
function lpnTrajetorias(cad, achados, partido = LPN_PARTIDO) {
  for (const r of Object.values(cad.c)) {
    if (!lpnEleito(r.s)) continue;
    let l = achados[r.civil + '|' + r.u];
    if (!l || !l.length) { const lu = achados['u:' + lpnNorm(r.n) + '|' + r.u]; if (lu && lu.length === 1) l = lu; }
    if (!l || !l.length) { r.t = 'Estreante'; continue; }
    const el = l.find(x => lpnEleito(x.sit)), x = el || l[0];
    r.ant = `${lpnCap(x.dsCargo)} pelo ${x.partido} — ${lpnCap(x.sit)}`;
    const mesmoGrupo = a => Object.values(LPN_GRUPOS).some(g => g.cargos.includes(a) && g.cargos.includes(r.k));
    r.t = !el ? 'Concorreu na eleição anterior sem se eleger'
      : !mesmoGrupo(el.cargo) ? 'Veio de outro cargo eletivo'
      : el.partido === partido ? 'Reeleito(a) pelo partido' : 'Tinha mandato por outro partido';
  }
  return cad;
}

/** Registro para gravar no banco: sem nome civil (só servia para a trajetória). */
function lpnParaBanco(cad, meta) {
  const c = {};
  for (const [sq, r] of Object.entries(cad.c)) { const x = Object.assign({}, r); delete x.civil; c['s' + sq] = x; }
  return { meta: Object.assign({ ano: cad.ano, data: cad.data }, meta), c };
}

/** Candidaturas de um grupo de cargos (lista de registros). */
function lpnDoGrupo(dados, grupo) {
  const cargos = LPN_GRUPOS[grupo].cargos;
  return Object.values((dados && dados.c) || {}).filter(r => r && cargos.includes(String(r.k)));
}

/**
 * Tabela de um recorte comparando as eleições: [{ cat, cand:[a,b], el:[a,b], votos:[a,b] }]
 * na ordem natural do recorte (ocupação: pelas mais frequentes entre os eleitos e
 * as candidaturas, as demais em "Outras"). `porAno` = { 2022: dados, 2026: dados }.
 */
function lpnTabela(porAno, grupo, recorte, anos = LPN_ANOS, maxOcupacoes = 12) {
  const linhas = {};
  anos.forEach((a, j) => {
    for (const r of lpnDoGrupo(porAno[a], grupo)) {
      const cat = lpnCategoria(r, recorte);
      const l = linhas[cat] || (linhas[cat] = { cat, cand: anos.map(() => 0), el: anos.map(() => 0), votos: anos.map(() => 0) });
      l.cand[j]++; l.votos[j] += r.v || 0;
      if (lpnEleito(r.s)) l.el[j]++;
    }
  });
  let l = Object.values(linhas);
  if (LPN_ORDEM[recorte]) {
    const o = LPN_ORDEM[recorte];
    l = l.sort((a, b) => o.indexOf(a.cat) - o.indexOf(b.cat)).filter(x => recorte !== 'genero' || x.cat !== 'Não informado' || x.cand.some(Boolean));
  } else {
    const peso = x => x.el.reduce((s, n) => s + n, 0) * 1000 + x.cand.reduce((s, n) => s + n, 0);
    l.sort((a, b) => peso(b) - peso(a));
    if (l.length > maxOcupacoes) {
      const resto = l.slice(maxOcupacoes), out = { cat: 'Outras', cand: anos.map(() => 0), el: anos.map(() => 0), votos: anos.map(() => 0) };
      for (const x of resto) anos.forEach((_, j) => { out.cand[j] += x.cand[j]; out.el[j] += x.el[j]; out.votos[j] += x.votos[j]; });
      l = l.slice(0, maxOcupacoes).concat([out]);
    }
  }
  return l;
}

/** Números de capa de um grupo numa eleição. */
function lpnResumo(dados, grupo) {
  const l = lpnDoGrupo(dados, grupo), el = l.filter(r => lpnEleito(r.s));
  const idades = el.map(r => r.i).filter(x => x != null);
  const negros = r => ['preta', 'parda'].includes(lpnNorm(r.r));
  return {
    cand: l.length, eleitos: el.length,
    mulheresCand: l.filter(r => r.g === 'FEMININO').length, mulheresEl: el.filter(r => r.g === 'FEMININO').length,
    negrosCand: l.filter(negros).length, negrosEl: el.filter(negros).length,
    idadeMedia: idades.length ? idades.reduce((s, x) => s + x, 0) / idades.length : null,
    votos: l.reduce((s, r) => s + (r.v || 0), 0), votosMulheres: l.filter(r => r.g === 'FEMININO').reduce((s, r) => s + (r.v || 0), 0),
    estreantes: el.filter(r => r.t === 'Estreante').length, comTrajetoria: el.filter(r => r.t).length,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LPN_PARTIDO, LPN_ANOS, LPN_GRUPOS, LPN_RECORTES, LPN_ORDEM, LPN_REGIAO, lpnNorm, lpnIdade, lpnCategoria, lpnEleito,
    lpnLeitorCadastro, lpnSomadorVotos, lpnProcurados, lpnTrajetorias, lpnParaBanco, lpnDoGrupo, lpnTabela, lpnResumo };
}
