'use strict';
// Sistemas Eleitorais — núcleo PURO das simulações (sem DOM, sem rede): lê o
// arquivo de resultados do TSE de um estado e distribui as vagas da Câmara (ou
// da Assembleia) por sistema. Exportado para os testes (Node); na extensão, global.
//
// Sistemas:
//  · Proporcional (atual) — Código Eleitoral, arts. 106 a 111, com a Lei
//    14.211/2021 e a decisão do STF nas ADIs 7228, 7263 e 7325 (2024):
//      1. quociente eleitoral (QE) = votos válidos ÷ vagas, desprezada a fração
//         se igual ou inferior a meio, arredondada para cima se superior (art. 106);
//      2. quociente partidário (QP) = votos da agremiação ÷ QE, desprezada a
//         fração (art. 107); a agremiação elege até QP candidatos que tenham pelo
//         menos 10% do QE (art. 108);
//      3. sobras pelas maiores médias (votos ÷ (lugares + 1)), só entre
//         agremiações com 80% do QE e candidatos com 20% do QE (art. 109, I);
//      4. o que ainda sobrar vai pelas maiores médias a TODAS as agremiações,
//         sem as exigências de 80%/20% (art. 109, III, como o STF fixou);
//      5. se nenhuma agremiação alcançar o QE, elegem-se os mais votados (art. 111).
//    Federação conta como uma agremiação só (Lei 14.208/2021).
//  · Distritão — os mais votados do estado, sem quociente; legenda não elege.
//  · Distritão misto — parte das vagas pelos mais votados, parte pela votação
//    da agremiação (lista), paralelo ou compensatório.
// Os parâmetros de cada sistema vêm em `op`; o padrão é a regra vigente.

/** Número do TSE ("1.234" ou "1234") → inteiro. */
function snNum(x) { return Number(String(x == null ? 0 : x).replace(/\./g, '').replace(',', '.')) || 0; }

/**
 * Lê o arquivo de resultados de um estado/cargo (…/dados/{uf}/{uf}-c{cargo}-e{eleição}-u.json).
 * Votos da agremiação = votos VÁLIDOS dos seus candidatos + legenda dos seus
 * partidos (candidato "anulado sub judice" fica fora, como nos votos válidos do TSE).
 * Devolve { uf, cargo, vagas, validos, qeTse, final, pct, atualizado, eleitosReal, agrs: [{ id, nome, tipo, siglas, votos, legenda, porSigla, cands }] }
 * (porSigla: votos de cada partido da agremiação — para simular sem federação)
 * com cands = [{ sq, n, nome, partido, votos, valido, eleitoReal, situacao }], em ordem de votos.
 */
function snLerUF(j, uf) {
  const cargo = (j.carg || [])[0] || {};
  const agrs = [];
  for (const a of cargo.agr || []) {
    const ag = { id: String(a.n || a.nm), nome: a.nm || '', tipo: a.tp === 'f' ? 'federacao' : 'partido', siglas: [], votos: 0, legenda: 0, porSigla: {}, vagasReal: snNum(a.vag), cands: [] };
    for (const p of a.par || []) {
      ag.siglas.push(p.sg);
      const leg = snNum(p.tvtl);
      ag.legenda += leg; ag.votos += leg;
      ag.porSigla[p.sg] = (ag.porSigla[p.sg] || 0) + leg;
      for (const c of p.cand || []) {
        const valido = !/anulad/i.test(c.dvt || '');
        const votos = snNum(c.vap);
        if (valido) { ag.votos += votos; ag.porSigla[p.sg] += votos; }
        ag.cands.push({ sq: String(c.sqcand || c.n), n: String(c.n), nome: c.nmu || c.nm, partido: p.sg, votos, valido,
          eleitoReal: c.e === 's' || (/eleit/i.test(c.st || '') && !/n[ãa]o eleit/i.test(c.st || '')), situacao: c.st || '' });
      }
    }
    ag.cands.sort((x, y) => y.votos - x.votos || x.nome.localeCompare(y.nome));
    agrs.push(ag);
  }
  return { uf: String(uf || j.cdabr || '').toLowerCase(), cargo: snNum(cargo.cd), vagas: snNum(cargo.nv), validos: snNum((j.v || {}).vv),
    qeTse: snNum(cargo.qe), final: j.tf === 's', pct: snNum((j.s || {}).pst), atualizado: [j.dg, j.hg].filter(Boolean).join(' '),
    eleitosReal: agrs.reduce((s, a) => s + a.cands.filter(c => c.eleitoReal).length, 0), agrs };
}

/**
 * Situação do arquivo do estado: 'final'; 'retotalizando' (tudo apurado, mas o
 * TSE reabriu a totalização e não há eleito marcado — PE em 06/10/2026); 'parcial'.
 */
function snSituacao(d) {
  if (d.final) return 'final';
  return d.pct >= 100 && !d.eleitosReal ? 'retotalizando' : 'parcial';
}

/** QE do art. 106: fração ≤ 0,5 desprezada; > 0,5 arredonda para cima. */
function snQuociente(validos, vagas) {
  if (!vagas) return 0;
  const q = validos / vagas, f = q - Math.floor(q);
  return f > 0.5 ? Math.ceil(q) : Math.floor(q);
}

/**
 * Proporcional. op: { pctQP: 0.10, pctPartido: 0.80, pctCandidato: 0.20, terceiraFaseAberta: true,
 * federacoes: true, vagas, validos }. Devolve { qe, eleitos: [{ sq, agr, fase }], porAgr: { id: n }, fases }.
 * Com federacoes:false, cada partido da federação disputa sozinho (simulação sem federação).
 */
function snProporcional(d, op = {}) {
  const pctQP = op.pctQP != null ? op.pctQP : 0.10, pctP = op.pctPartido != null ? op.pctPartido : 0.80, pctC = op.pctCandidato != null ? op.pctCandidato : 0.20;
  const aberta = op.terceiraFaseAberta !== false;
  const vagas = op.vagas != null ? op.vagas : d.vagas;
  const agrs = op.federacoes === false ? snSemFederacao(d.agrs) : d.agrs;
  const validos = op.validos != null ? op.validos : d.validos;
  const qe = snQuociente(validos, vagas);
  const est = agrs.map(a => ({ a, lugares: 0, prox: 0, eleitos: [] }));
  const eleitos = [];
  const eleger = (e, c, fase) => { e.eleitos.push(c); e.lugares++; eleitos.push({ sq: c.sq, agr: e.a.id, fase, cand: c }); };
  const restantes = e => e.a.cands.filter(c => c.valido && !e.eleitos.includes(c));
  // art. 111: ninguém alcançou o QE → os mais votados
  if (!agrs.some(a => a.votos >= qe)) {
    const todos = est.flatMap(e => e.a.cands.filter(c => c.valido).map(c => ({ e, c }))).sort((x, y) => y.c.votos - x.c.votos);
    for (const { e, c } of todos.slice(0, vagas)) eleger(e, c, 'mais votados (art. 111)');
    return snResultado(est, eleitos, qe, vagas);
  }
  // 1ª fase: QP com 10% do QE
  for (const e of est) {
    const qp = Math.floor(e.a.votos / qe);
    for (const c of e.a.cands) {
      if (e.lugares >= qp || eleitos.length >= vagas) break;
      if (c.valido && c.votos >= pctQP * qe) eleger(e, c, 'QP');
    }
  }
  // 2ª fase: sobras entre quem tem 80% do QE, candidatos com 20%
  const media = e => e.a.votos / (e.lugares + 1);
  const rodada = (podeAgr, podeCand, fase) => {
    while (eleitos.length < vagas) {
      let melhor = null, cand = null;
      for (const e of est) {
        if (!podeAgr(e)) continue;
        const c = restantes(e).find(podeCand);
        if (!c) continue;
        if (!melhor || media(e) > media(melhor) || (media(e) === media(melhor) && e.a.votos > melhor.a.votos)) { melhor = e; cand = c; }
      }
      if (!melhor) return;
      eleger(melhor, cand, fase);
    }
  };
  rodada(e => e.a.votos >= pctP * qe, c => c.votos >= pctC * qe, 'média');
  // 3ª fase: maiores médias, todas as agremiações (STF) — ou só as de 80% (texto da lei sem a decisão)
  if (eleitos.length < vagas) rodada(e => aberta || e.a.votos >= pctP * qe, () => true, 'média (3ª fase)');
  return snResultado(est, eleitos, qe, vagas);
}

/** Desfaz as federações: cada partido vira uma agremiação (para simular sem federação). */
function snSemFederacao(agrs) {
  const out = [];
  for (const a of agrs) {
    if (a.tipo !== 'federacao') { out.push(a); continue; }
    for (const sg of a.siglas) {
      const cands = a.cands.filter(c => c.partido === sg);
      const nominais = cands.filter(c => c.valido).reduce((s, c) => s + c.votos, 0);
      const votos = a.porSigla && a.porSigla[sg] != null ? a.porSigla[sg] : nominais;
      out.push({ id: a.id + ':' + sg, nome: sg, tipo: 'partido', siglas: [sg], votos, legenda: votos - nominais, porSigla: { [sg]: votos }, cands, vagasReal: null });
    }
  }
  return out;
}

function snResultado(est, eleitos, qe, vagas) {
  const porAgr = {};
  for (const e of est) porAgr[e.a.id] = e.lugares;
  return { qe, vagas, eleitos, porAgr };
}

/** Distritão: os `vagas` candidatos (válidos) mais votados do estado. */
function snDistritao(d, op = {}) {
  const vagas = op.vagas != null ? op.vagas : d.vagas;
  const todos = d.agrs.flatMap(a => a.cands.filter(c => c.valido).map(c => ({ a, c }))).sort((x, y) => y.c.votos - x.c.votos);
  const eleitos = todos.slice(0, vagas).map(({ a, c }) => ({ sq: c.sq, agr: a.id, fase: 'mais votados', cand: c }));
  const porAgr = {};
  for (const a of d.agrs) porAgr[a.id] = 0;
  for (const x of eleitos) porAgr[x.agr]++;
  return { vagas, eleitos, porAgr, corte: todos[vagas - 1] ? todos[vagas - 1].c.votos : 0 };
}

/**
 * Divisão de `n` cadeiras pelas maiores médias (D'Hondt) entre agremiações com
 * os votos dados; `ja` = cadeiras que cada uma já tem (compensatório) — devolve
 * as cadeiras da LISTA de cada uma. limiar: fração dos votos válidos para entrar.
 * teto: { id: máximo de cadeiras da lista } (candidatos que ainda restam).
 */
function snDhondt(votos, n, ja = {}, limiar = 0, teto = null) {
  const total = Object.values(votos).reduce((s, v) => s + v, 0);
  const ids = Object.keys(votos).filter(id => votos[id] > 0 && votos[id] >= limiar * total);
  const lugares = Object.fromEntries(ids.map(id => [id, ja[id] || 0]));
  const lista = Object.fromEntries(ids.map(id => [id, 0]));
  const cabe = id => !teto || lista[id] < (teto[id] || 0);
  for (let i = 0; i < n; i++) {
    let m = null;
    for (const id of ids) if (cabe(id) && (!m || votos[id] / (lugares[id] + 1) > votos[m] / (lugares[m] + 1))) m = id;
    if (!m) break;
    lugares[m]++; lista[m]++;
  }
  return lista;
}

/**
 * Distritão misto. op: { pctMaisVotados: 0.5, modelo: 'paralelo'|'compensatorio', limiar: 0 }.
 *  · A parte "mais votados" = os N mais votados do estado (como o distritão).
 *  · A parte "lista" vai pela votação da agremiação (nominal + legenda) em maiores
 *    médias; paralelo: só essas cadeiras; compensatório: a proporção vale para o
 *    TOTAL e a lista completa o que falta (quem já passou do que teria guarda as suas).
 *  · limiar: cláusula de desempenho para a lista, em fração dos votos válidos do estado.
 *  · A lista é preenchida pelos candidatos da agremiação ainda não eleitos, na
 *    ordem de votos (uma lista pré-ordenada pelo partido não existe nos dados);
 *    agremiação sem candidatos bastantes cede a cadeira à média seguinte.
 */
function snDistritaoMisto(d, op = {}) {
  const vagas = op.vagas != null ? op.vagas : d.vagas;
  const nMais = Math.round(vagas * (op.pctMaisVotados != null ? op.pctMaisVotados : 0.5));
  const parte1 = snDistritao(d, { vagas: nMais });
  const r = snCompletarLista(d, parte1.eleitos.map(x => Object.assign({}, x, { fase: 'mais votados' })), vagas, op);
  return Object.assign(r, { nMais, corte: parte1.corte });
}

/**
 * A parte "lista" dos sistemas mistos (distritão misto e distrital misto): as
 * vagas que sobram depois de `primeiros` (os eleitos pelo voto no candidato)
 * vão pela votação da agremiação (nominal + legenda), em maiores médias.
 *  · paralelo: a lista divide só as suas vagas;
 *  · compensatório: a proporção vale para o TOTAL e a lista completa quem ficou
 *    abaixo dela (quem já passou guarda as suas — o total de vagas não muda).
 *  · limiar: cláusula de desempenho para a lista, em fração dos válidos do estado.
 * A lista é preenchida pelos candidatos da agremiação ainda não eleitos, na
 * ordem de votos; agremiação sem candidatos bastantes cede a vaga à média seguinte.
 * Devolve { vagas, eleitos, porAgr, nLista }.
 */
function snCompletarLista(d, primeiros, vagas, op = {}) {
  const nLista = vagas - primeiros.length;
  const limiar = op.limiar || 0;
  const ja = new Set(primeiros.map(x => x.sq));
  const p1 = {};
  for (const x of primeiros) p1[x.agr] = (p1[x.agr] || 0) + 1;
  const n1 = id => p1[id] || 0;
  const votos = Object.fromEntries(d.agrs.map(a => [a.id, a.votos]));
  const teto = Object.fromEntries(d.agrs.map(a => [a.id, a.cands.filter(c => c.valido && !ja.has(c.sq)).length]));
  let lista;
  if (op.modelo === 'compensatorio') {
    const alvo = snDhondt(votos, vagas, {}, limiar);
    lista = {};
    for (const id of Object.keys(votos)) lista[id] = Math.min(teto[id], Math.max(0, (alvo[id] || 0) - n1(id)));
    let soma = Object.values(lista).reduce((s, v) => s + v, 0);
    // mais do que cabe: corta de quem fica com a menor média com a vaga a mais
    while (soma > nLista) {
      let pior = null;
      for (const id of Object.keys(lista)) if (lista[id] > 0 && (!pior || votos[id] / (n1(id) + lista[id]) < votos[pior] / (n1(pior) + lista[pior]))) pior = id;
      lista[pior]--; soma--;
    }
    // menos do que cabe: o resto pelas maiores médias, contando o que cada uma já tem
    if (soma < nLista) {
      const tem = {}, resta = {};
      for (const id of Object.keys(votos)) { tem[id] = n1(id) + lista[id]; resta[id] = teto[id] - lista[id]; }
      const mais = snDhondt(votos, nLista - soma, tem, limiar, resta);
      for (const id of Object.keys(mais)) lista[id] += mais[id];
    }
  } else {
    lista = snDhondt(votos, Math.max(0, nLista), {}, limiar, teto);
  }
  const eleitos = primeiros.slice();
  for (const a of d.agrs) {
    const fila = a.cands.filter(c => c.valido && !ja.has(c.sq));
    for (const c of fila.slice(0, lista[a.id] || 0)) eleitos.push({ sq: c.sq, agr: a.id, fase: 'lista', cand: c });
  }
  const porAgr = {};
  for (const a of d.agrs) porAgr[a.id] = 0;
  for (const x of eleitos) porAgr[x.agr] = (porAgr[x.agr] || 0) + 1;
  return { vagas, eleitos, porAgr, nLista: Math.max(0, nLista) };
}

// ------------------------------------------------------------
// Comparação dos sistemas (a aba): todas as UFs, somas por partido.
// ------------------------------------------------------------
/** Soma os eleitos por partido (sigla do candidato — numa federação, o partido de cada um). */
function snSomar(alvo, eleitos) {
  for (const x of eleitos) { alvo.porPartido[x.cand.partido] = (alvo.porPartido[x.cand.partido] || 0) + 1; alvo.total++; }
}

const SN_TIPOS = {
  proporcional: (d, op) => snProporcional(d, op),
  distritao: (d, op) => snDistritao(d, op),
  misto: (d, op) => snDistritaoMisto(d, op),
  // distrital misto (sistemas-distrital.js): op.porUf[uf] = { desenho, base, votos } de cada estado
  distrital: (d, op) => {
    const f = typeof sdDistritalMisto === 'function' ? sdDistritalMisto : require('./sistemas-distrital.js').sdDistritalMisto;
    return f(d, Object.assign({}, op, op.porUf[d.uf]));
  },
};

/**
 * Roda os sistemas em cada UF e compara com o resultado oficial (a marcação do TSE).
 * dados: { uf: d }; sistemas: [{ id, nome, tipo: 'proporcional'|'distritao'|'misto', op }].
 * Devolve { ufs, comparadas, real, sims }:
 *  · real: { porPartido, total, porUf: { uf: { eleitos } }, semReal: [uf] } — UF sem eleito
 *    marcado (retotalização, apuração em curso) fica fora do real;
 *  · sims[i]: { id, nome, tipo, porPartido, total, porUf: { uf: { eleitos, entram, saem, qe, corte, nMais, nLista } } }.
 * As somas nacionais contam só as UFs comparáveis (com o real), para a comparação
 * ser de igual para igual; sem nenhuma, contam todas.
 */
function snSimular(dados, sistemas) {
  const ufs = Object.keys(dados).sort();
  const real = { id: 'real', nome: 'Resultado oficial', porPartido: {}, total: 0, porUf: {}, semReal: [] };
  for (const uf of ufs) {
    const eleitos = dados[uf].agrs.flatMap(a => a.cands.filter(c => c.eleitoReal).map(c => ({ sq: c.sq, agr: a.id, fase: 'oficial', cand: c })));
    if (!eleitos.length) { real.semReal.push(uf); continue; }
    real.porUf[uf] = { eleitos };
    snSomar(real, eleitos);
  }
  const comparadas = real.semReal.length === ufs.length ? ufs : ufs.filter(uf => !real.semReal.includes(uf));
  const porVotos = (x, y) => y.cand.votos - x.cand.votos;
  const sims = sistemas.map(s => {
    const out = { id: s.id, nome: s.nome, tipo: s.tipo, porPartido: {}, total: 0, porUf: {} };
    for (const uf of ufs) {
      const r = SN_TIPOS[s.tipo](dados[uf], s.op || {});
      const ru = real.porUf[uf];
      const sim = new Set(r.eleitos.map(x => x.sq)), rs = new Set(ru ? ru.eleitos.map(x => x.sq) : []);
      out.porUf[uf] = { eleitos: r.eleitos, qe: r.qe, corte: r.corte, nMais: r.nMais, nLista: r.nLista, nDistritos: r.nDistritos, distritos: r.distritos,
        entram: ru ? r.eleitos.filter(x => !rs.has(x.sq)).sort(porVotos) : [], saem: ru ? ru.eleitos.filter(x => !sim.has(x.sq)).sort(porVotos) : [] };
      if (comparadas.includes(uf)) snSomar(out, r.eleitos);
    }
    return out;
  });
  return { ufs, comparadas, real, sims };
}

/** Partidos na ordem de exibição: bancada oficial, depois a maior simulada, depois a sigla. */
function snOrdemPartidos(res) {
  const todas = new Set([...Object.keys(res.real.porPartido), ...res.sims.flatMap(s => Object.keys(s.porPartido))]);
  const max = sg => Math.max(0, ...res.sims.map(s => s.porPartido[sg] || 0));
  return [...todas].sort((a, b) => (res.real.porPartido[b] || 0) - (res.real.porPartido[a] || 0) || max(b) - max(a) || a.localeCompare(b));
}

/**
 * Posições das cadeiras num hemiciclo (unidades: raio externo 1, centro na base),
 * da esquerda para a direita — a ordem em que se pintam os partidos. Devolve
 * { pontos: [{ x, y }], r } (r = raio de cada bolinha).
 */
function snHemiciclo(n) {
  if (!n) return { pontos: [], r: 0 };
  const linhas = Math.max(1, Math.min(14, Math.round(Math.sqrt(n / 3.2))));
  const interno = linhas === 1 ? 1 : 0.38;
  const raios = Array.from({ length: linhas }, (_, i) => linhas === 1 ? 1 : interno + (1 - interno) * i / (linhas - 1));
  const soma = raios.reduce((s, r) => s + r, 0);
  const cotas = raios.map(r => n * r / soma), qtd = cotas.map(Math.floor);
  let falta = n - qtd.reduce((s, v) => s + v, 0);
  cotas.map((c, i) => [c - qtd[i], i]).sort((a, b) => b[0] - a[0]).slice(0, falta).forEach(([, i]) => qtd[i]++);
  const pts = [];
  raios.forEach((r, i) => {
    const k = qtd[i];
    for (let j = 0; j < k; j++) {
      const a = k === 1 ? Math.PI / 2 : Math.PI * j / (k - 1);
      pts.push({ x: -Math.cos(a) * r, y: Math.max(0, Math.sin(a) * r), a, r });
    }
  });
  pts.sort((p, q) => p.a - q.a || q.r - p.r);
  const passo = linhas === 1 ? Math.PI / Math.max(1, n) : (1 - interno) / (linhas - 1);
  const arco = Math.PI * interno / Math.max(1, qtd[0] - 1);
  return { pontos: pts.map(p => ({ x: p.x, y: p.y })), r: Math.min(passo, arco, 0.12) * 0.42 };
}

/**
 * Eleições que a aba oferece, da mais recente para a mais antiga:
 *  · as gerais do servidor de resultados do TSE (1º turno, com deputados) — ops de apEleicoesGerais;
 *  · os anos gerais desde 2022 (federações; mesma regra de hoje) que o servidor
 *    já não guarda, pelos dados abertos do TSE.
 * Devolve [{ id, ano, fonte: 'resultados'|'abertos', ciclo, eleicao: { 6, 7, 8 } }].
 */
function snEleicoes(ops, hoje = new Date()) {
  const out = [];
  for (const o of ops || []) {
    if (o.previsto || o.turno !== 1 || !o.cargos || !o.cargos[6]) continue;
    out.push({ id: o.id, ano: o.ano, fonte: 'resultados', ciclo: o.ciclo,
      eleicao: { 6: o.cargos[6].eleicao, 7: (o.cargos[7] || o.cargos[6]).eleicao, 8: (o.cargos[8] || o.cargos[6]).eleicao } });
  }
  for (let ano = 2022; ano <= hoje.getFullYear(); ano += 4) {
    const fim = new Date(ano, 9, 31);   // a apuração de outubro já terminou
    if (hoje < fim || out.some(o => o.ano === ano)) continue;
    out.push({ id: 'abertos-' + ano, ano, fonte: 'abertos' });
  }
  return out.sort((a, b) => b.ano - a.ano);
}

/**
 * Arquivos de dados abertos do TSE de um ano: votação por candidato e por partido
 * (por município e zona); e, para o distrital, o detalhe da votação (eleitores
 * aptos por município e zona) e o cadastro de locais de votação (coordenadas).
 */
function snUrlsAbertos(ano, base = 'https://cdn.tse.jus.br/estatistica/sead/odsele') {
  return { candidato: `${base}/votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`,
    partido: `${base}/votacao_partido_munzona/votacao_partido_munzona_${ano}.zip`,
    detalhe: `${base}/detalhe_votacao_munzona/detalhe_votacao_munzona_${ano}.zip`,
    locais: `${base}/eleitorado_locais_votacao/eleitorado_local_votacao_${ano}.zip` };
}

// ------------------------------------------------------------
// Dados abertos do TSE (anos que o servidor de resultados não guarda — 2022):
// votacao_candidato_munzona_{ano} (votos de cada candidato por município/zona,
// situação final) + votacao_partido_munzona_{ano} (legenda, e os votos nominais
// de candidatos indeferidos que a lei converte para a legenda). Monta, por
// estado, a mesma estrutura de snLerUF.
// ------------------------------------------------------------
/** Campos de uma linha CSV do TSE (separador ';', aspas). */
function snCampos(linha) {
  // Atalho: o TSE põe todo campo entre aspas — "a";"b";"c" — e quase nunca há aspas dentro.
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
function snCsv(exigidas, fn) {
  let ix = null;
  return l => {
    const c = snCampos(l);
    if (!ix) {
      ix = {}; c.forEach((h, i) => { ix[h.replace(/^﻿/, '').trim()] = i; });
      const falta = exigidas.filter(h => !(h in ix));
      if (falta.length) throw new Error('arquivo do TSE fora do formato esperado (faltam ' + falta.join(', ') + ')');
      return;
    }
    fn(k => (ix[k] == null ? '' : (c[ix[k]] || '').trim()));
  };
}

/** Vagas da Assembleia pela Constituição (art. 27): 3× os deputados federais até 12; acima, 36 + o que passar de 12. DF: 24. */
function snVagasAssembleia(uf, vagasCamara) {
  if (String(uf).toLowerCase() === 'df') return 24;
  return vagasCamara <= 12 ? 3 * vagasCamara : 36 + (vagasCamara - 12);
}

/**
 * Leitor dos dois arquivos de dados abertos para um ou mais cargos ('6' federal,
 * '7' estadual, '8' distrital — ou ['6', '7', '8'], numa leitura só do arquivo).
 * candidato.linha(l) / partido.linha(l); resultado(vagasPorUf, cargo) → { uf: dados como snLerUF }
 * (cargo: o pedido, ou o primeiro da lista).
 */
function snLeitorDadosAbertos(cargo) {
  const cargos = [].concat(cargo).map(String);
  const porCargo = Object.fromEntries(cargos.map(c => [c, {}]));
  const ag = (cg, uf, v) => {
    const fed = v('NR_FEDERACAO') && v('NR_FEDERACAO') !== '-1';
    const id = fed ? 'f' + v('NR_FEDERACAO') : 'p' + v('NR_PARTIDO');
    const u = (porCargo[cg][uf] = porCargo[cg][uf] || { agrs: {} });
    return (u.agrs[id] = u.agrs[id] || { id, nome: fed ? v('NM_FEDERACAO') : v('NM_PARTIDO'), tipo: fed ? 'federacao' : 'partido', siglas: [], votos: 0, legenda: 0, porSigla: {}, vagasReal: null, cands: {} });
  };
  const doCargo = v => { const cg = v('CD_CARGO'); return porCargo[cg] && v('NR_TURNO') === '1' ? cg : null; };
  const candidato = snCsv(['SG_UF', 'CD_CARGO', 'NR_TURNO', 'SQ_CANDIDATO', 'NR_PARTIDO', 'SG_PARTIDO', 'QT_VOTOS_NOMINAIS_VALIDOS', 'DS_SIT_TOT_TURNO'], v => {
    const cg = doCargo(v);
    if (!cg) return;
    const uf = v('SG_UF').toLowerCase(), a = ag(cg, uf, v), sq = v('SQ_CANDIDATO');
    if (!a.siglas.includes(v('SG_PARTIDO'))) a.siglas.push(v('SG_PARTIDO'));
    const dest = v('NM_TIPO_DESTINACAO_VOTOS');
    const c = (a.cands[sq] = a.cands[sq] || { sq, n: v('NR_CANDIDATO'), nome: v('NM_URNA_CANDIDATO') || v('NM_CANDIDATO'), partido: v('SG_PARTIDO'), votos: 0,
      valido: !dest || dest === 'Válido', eleitoReal: /^ELEITO/i.test(v('DS_SIT_TOT_TURNO')), situacao: v('DS_SIT_TOT_TURNO') });
    c.votos += Number(v('QT_VOTOS_NOMINAIS_VALIDOS')) || 0;
  });
  const partido = snCsv(['SG_UF', 'CD_CARGO', 'NR_TURNO', 'NR_PARTIDO', 'QT_VOTOS_NOMINAIS_VALIDOS', 'QT_TOTAL_VOTOS_LEG_VALIDOS'], v => {
    const cg = doCargo(v);
    if (!cg) return;
    const a = ag(cg, v('SG_UF').toLowerCase(), v);
    if (!a.siglas.includes(v('SG_PARTIDO'))) a.siglas.push(v('SG_PARTIDO'));
    const leg = Number(v('QT_TOTAL_VOTOS_LEG_VALIDOS')) || 0;     // legenda + nominais convertidos para a legenda
    const votos = leg + (Number(v('QT_VOTOS_NOMINAIS_VALIDOS')) || 0);
    a.legenda += leg;
    a.votos += votos;
    a.porSigla[v('SG_PARTIDO')] = (a.porSigla[v('SG_PARTIDO')] || 0) + votos;
  });
  const resultado = (vagasPorUf = {}, cg = cargos[0]) => {
    const out = {};
    for (const [uf, u] of Object.entries(porCargo[String(cg)] || {})) {
      const agrs = Object.values(u.agrs).map(a => Object.assign({}, a, { cands: Object.values(a.cands).sort((x, y) => y.votos - x.votos || x.nome.localeCompare(y.nome)) }));
      const validos = agrs.reduce((s, a) => s + a.votos, 0);
      const eleitosReal = agrs.reduce((s, a) => s + a.cands.filter(c => c.eleitoReal).length, 0);
      out[uf] = { uf, cargo: Number(cg), vagas: vagasPorUf[uf] || eleitosReal, validos, qeTse: null, final: true, pct: 100, atualizado: '', eleitosReal, agrs };
    }
    return out;
  };
  return { candidato: { linha: candidato }, partido: { linha: partido }, resultado };
}

/** Confere um resultado simulado com o real (marcação do TSE): { iguais, sobram: [cand], faltam: [cand] }. */
function snConferir(d, res) {
  const real = new Set(d.agrs.flatMap(a => a.cands.filter(c => c.eleitoReal).map(c => c.sq)));
  const sim = new Set(res.eleitos.map(x => x.sq));
  const todos = Object.fromEntries(d.agrs.flatMap(a => a.cands.map(c => [c.sq, c])));
  return { iguais: [...sim].filter(s => real.has(s)).length, sobram: [...sim].filter(s => !real.has(s)).map(s => todos[s]), faltam: [...real].filter(s => !sim.has(s)).map(s => todos[s]) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { snCampos, snVagasAssembleia, snLeitorDadosAbertos, snNum, snLerUF, snSituacao, snQuociente, snProporcional, snSemFederacao, snDistritao, snDhondt,
    snDistritaoMisto, snCompletarLista, snSimular, snOrdemPartidos, snHemiciclo, snEleicoes, snUrlsAbertos, snConferir };
}
