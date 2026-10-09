'use strict';
// Sistemas Eleitorais — memorial de cálculo (PURO, sem DOM): monta, a partir
// dos dados lidos do TSE e do resultado do simulador, as abas de uma planilha
// em que cada conta é refeita por FÓRMULA (quociente eleitoral, quociente
// partidário, médias das sobras, maiores médias das listas, tamanho dos
// distritos, indicadores) e comparada com o que o simulador deu, numa coluna
// "Confere" (CONFERE/DIVERGE). Quem abre a planilha no Excel ou no LibreOffice vê as
// contas recalculadas pelo próprio programa, não pelos números da extensão.
// As células de fórmula levam também o valor calculado aqui (para quem abre
// sem recalcular). A tela transforma as abas num .xlsx (SheetJS).
//
// Célula: número | texto | null | { f: 'fórmula sem =', v: valor }.

/** Letra(s) da coluna (0 → A). */
function smCol(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}
const smRef = (c, r) => smCol(c) + r;
const smAbs = (c, r) => '$' + smCol(c) + '$' + r;
/** Nome de aba numa fórmula ('Nome com espaço'!A1). */
const smAbaRef = nome => (/^[A-Za-z0-9_]+$/.test(nome) ? nome : `'${nome.replace(/'/g, "''")}'`);
const smTxt = s => '"' + String(s).replace(/"/g, '""') + '"';
// Resultado de cada conferência (palavras que não aparecem nos dados, para a contagem não confundir).
const SM_SIM = 'CONFERE', SM_NAO = 'DIVERGE';

/** Aba: linhas (arrays de células), larguras, e a coluna das conferências. */
function smNovaAba(nome, larguras = []) {
  const linhas = [];
  return { nome, linhas, larguras, add(l) { linhas.push(l || []); return linhas.length; }, prox() { return linhas.length + 1; } };
}

/** QE do art. 106 (fração ≤ 0,5 desprezada; > 0,5 para cima) — o mesmo do simulador. */
function smQE(validos, vagas) {
  if (!vagas) return 0;
  const q = validos / vagas, f = q - Math.floor(q);
  return f > 0.5 ? Math.ceil(q) : Math.floor(q);
}
const smConfere = (a, b) => (a === b ? SM_SIM : SM_NAO);
const smPerto = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/** Fórmula de conferência: CONFERE se as duas células são iguais. */
function smFConfere(ra, rb, va, vb) {
  return { f: `IF(${ra}=${rb},"${SM_SIM}","${SM_NAO}")`, v: smConfere(va, vb) };
}

/** Siglas da agremiação (federação: "PT/PCdoB/PV"). */
const smSiglas = a => (a.siglas && a.siglas.length ? a.siglas.join('/') : a.nome || a.id);

/** Agremiações que o sistema usou (proporcional sem federação desfaz as federações). */
function smAgrs(d, s) {
  if (s.tipo === 'proporcional' && s.op && s.op.federacoes === false) {
    const f = typeof snSemFederacao === 'function' ? snSemFederacao : require('./sistemas-nucleo.js').snSemFederacao;
    return f(d.agrs);
  }
  return d.agrs;
}

// ------------------------------------------------------------ abas de dados
/** Candidatos: os votos de cada um (a base de todas as somas). */
function smAbaCandidatos(dados, ufs) {
  const aba = smNovaAba('Candidatos', [5, 18, 12, 10, 32, 8, 12, 8, 10]);
  aba.add(['UF', 'Agremiação (id)', 'Agremiação', 'Partido', 'Candidato', 'Número', 'Votos', 'Válido', 'Eleito oficial']);
  for (const uf of ufs) for (const a of dados[uf].agrs) for (const c of a.cands) {
    aba.add([uf.toUpperCase(), a.id, smSiglas(a), c.partido, c.nome, c.n || '', c.votos, c.valido ? 'sim' : 'não', c.eleitoReal ? 'sim' : 'não']);
  }
  return aba;
}

/** Votos de cada agremiação: nominais válidos (soma dos candidatos, por fórmula) + legenda. */
function smAbaVotos(dados, ufs) {
  const aba = smNovaAba('Votos', [5, 18, 18, 10, 14, 12, 14, 14, 9]);
  aba.add(['UF', 'Agremiação (id)', 'Agremiação', 'Tipo', 'Nominais válidos (soma dos candidatos)', 'Legenda', 'Total (nominais + legenda)', 'Total no simulador', 'Confere']);
  const C = smAbaRef('Candidatos');
  const linhaDe = {};
  for (const uf of ufs) for (const a of dados[uf].agrs) {
    const r = aba.prox();
    const nom = a.cands.filter(c => c.valido).reduce((s, c) => s + c.votos, 0);
    aba.add([uf.toUpperCase(), a.id, smSiglas(a), a.tipo === 'federacao' ? 'federação' : 'partido',
      { f: `SUMIFS(${C}!G:G,${C}!A:A,A${r},${C}!B:B,B${r},${C}!H:H,"sim")`, v: nom }, a.legenda,
      { f: `E${r}+F${r}`, v: nom + a.legenda }, a.votos, smFConfere(`G${r}`, `H${r}`, nom + a.legenda, a.votos)]);
    linhaDe[uf + '|' + a.id] = r;
  }
  return { aba, linhaDe };
}

/** Estados: vagas, votos válidos (TSE) contra a soma das agremiações, QE. */
function smAbaEstados(dados, ufs) {
  const aba = smNovaAba('Estados', [5, 7, 14, 14, 9, 12, 12, 9]);
  aba.add(['UF', 'Vagas', 'Votos válidos (TSE)', 'Soma das agremiações', 'Confere', 'Quociente eleitoral (art. 106)', 'QE no arquivo do TSE', 'Confere']);
  const V = smAbaRef('Votos');
  for (const uf of ufs) {
    const d = dados[uf], r = aba.prox();
    const soma = d.agrs.reduce((s, a) => s + a.votos, 0), qe = smQE(d.validos, d.vagas);
    aba.add([uf.toUpperCase(), d.vagas, d.validos, { f: `SUMIF(${V}!A:A,A${r},${V}!G:G)`, v: soma }, smFConfere(`C${r}`, `D${r}`, d.validos, soma),
      { f: `IF(C${r}/B${r}-INT(C${r}/B${r})>0.5,INT(C${r}/B${r})+1,INT(C${r}/B${r}))`, v: qe }, d.qeTse || null,
      d.qeTse ? smFConfere(`F${r}`, `G${r}`, qe, d.qeTse) : '—']);
  }
  return aba;
}

// ------------------------------------------------------------ proporcional
/**
 * Proporcional, estado a estado: QE (fórmula), QP de cada agremiação (fórmula),
 * eleitos no QP (mínimo entre o QP e os candidatos com 10% do QE), e as sobras
 * rodada a rodada — a média de cada agremiação que pode disputar (fórmula:
 * votos ÷ (lugares + 1)) e a maior média (fórmula), contra quem o simulador elegeu.
 */
function smAbaProporcional(s, dados, ufs, res) {
  const op = s.op || {};
  const pctQP = op.pctQP != null ? op.pctQP : 0.10, pctP = op.pctPartido != null ? op.pctPartido : 0.80, pctC = op.pctCandidato != null ? op.pctCandidato : 0.20;
  const aberta = op.terceiraFaseAberta !== false;
  const aba = smNovaAba(s.nome.slice(0, 31), [16, 14, 10, 12, 12, 12, 9, 10, 10, 10, 9]);
  aba.add([`${s.nome}: quociente eleitoral, quociente partidário (art. 107, eleitos com ${Math.round(pctQP * 100)}% do QE — art. 108) e sobras pelas maiores médias (art. 109: agremiações com ${Math.round(pctP * 100)}% do QE e candidatos com ${Math.round(pctC * 100)}% do QE; depois, ${aberta ? 'todas as agremiações' : `só as de ${Math.round(pctP * 100)}%`}).`]);
  aba.add(['Fórmulas: QE = válidos ÷ vagas (fração acima de meio arredonda para cima); QP = INT(votos ÷ QE); média = votos ÷ (lugares + 1). A coluna "Confere" compara a conta da planilha com o simulador.']);
  for (const uf of ufs) {
    const d = dados[uf], agrs = smAgrs(d, s).slice().sort((a, b) => b.votos - a.votos), sim = res.porUf[uf];
    if (!sim) continue;
    const validos = op.validos != null ? op.validos : d.validos, vagas = d.vagas, qe = smQE(validos, vagas);
    aba.add([]);
    const r0 = aba.prox();
    aba.add([`${uf.toUpperCase()}`, 'Vagas', vagas, 'Votos válidos', validos, 'QE (fórmula)', { f: `IF(E${r0}/C${r0}-INT(E${r0}/C${r0})>0.5,INT(E${r0}/C${r0})+1,INT(E${r0}/C${r0}))`, v: qe },
      'QE do simulador', sim.qe, smFConfere(`G${r0}`, `I${r0}`, qe, sim.qe)]);
    const QE = smAbs(6, r0);
    const eleitos = sim.eleitos;
    const porAgr = id => eleitos.filter(x => x.agr === id);
    if (!agrs.some(a => a.votos >= qe)) {
      aba.add(['Nenhuma agremiação alcançou o QE: elegem-se os mais votados (art. 111) — ver a aba Eleitos.']);
      continue;
    }
    aba.add(['Agremiação', 'Votos', 'QP = INT(votos ÷ QE)', `Candidatos com ${Math.round(pctQP * 100)}% do QE`, 'Eleitos no QP (fórmula)', 'Eleitos no QP (simulador)', 'Confere',
      `Tem ${Math.round(pctP * 100)}% do QE?`, 'Eleitos nas sobras (simulador)', 'Total (simulador)', 'Confere total']);
    const linha = {};
    for (const a of agrs) {
      const r = aba.prox();
      linha[a.id] = r;
      const qp = Math.floor(a.votos / qe), c10 = a.cands.filter(c => c.valido && c.votos >= pctQP * qe).length;
      const noQP = porAgr(a.id).filter(x => x.fase === 'QP').length, total = sim.porAgr ? (sim.porAgr[a.id] || 0) : porAgr(a.id).length;
      const sob = porAgr(a.id).length - noQP;
      aba.add([smSiglas(a), a.votos, { f: `INT(B${r}/${QE})`, v: qp }, c10, { f: `MIN(C${r},D${r})`, v: Math.min(qp, c10) }, noQP, smFConfere(`E${r}`, `F${r}`, Math.min(qp, c10), noQP),
        { f: `IF(B${r}>=${pctP}*${QE},"sim","não")`, v: a.votos >= pctP * qe ? 'sim' : 'não' }, sob, porAgr(a.id).length,
        smFConfere(`J${r}`, `F${r}+I${r}`, porAgr(a.id).length, noQP + sob)]);
      void total;
    }
    // sobras, rodada a rodada (a ordem em que o simulador elegeu)
    const rodadas = eleitos.filter(x => x.fase !== 'QP');
    if (!rodadas.length) continue;
    aba.add(['Sobras: média de cada agremiação que pode disputar a vaga da rodada = votos ÷ (lugares + 1); em branco, quem não pode (abaixo do mínimo ou sem candidato que o alcance).']);
    const rc = aba.prox();
    aba.add(['Rodada', 'Fase', ...agrs.map(smSiglas), 'Eleita (simulador)', 'Maior média (fórmula)', 'Confere', 'Candidato eleito']);
    const c0 = 2, c1 = c0 + agrs.length - 1;
    const lug = {};
    for (const a of agrs) lug[a.id] = eleitos.filter(x => x.agr === a.id && x.fase === 'QP').length;
    const ja = new Set(eleitos.filter(x => x.fase === 'QP').map(x => x.sq));
    rodadas.forEach((x, k) => {
      const r = aba.prox();
      const terceira = /3ª/.test(x.fase);
      const cel = agrs.map(a => {
        const podeAgr = terceira ? (aberta || a.votos >= pctP * qe) : a.votos >= pctP * qe;
        const tem = a.cands.some(c => c.valido && !ja.has(c.sq) && (terceira || c.votos >= pctC * qe));
        if (!podeAgr || !tem) return null;
        return { f: `${smAbs(1, linha[a.id])}/${lug[a.id] + 1}`, v: a.votos / (lug[a.id] + 1) };
      });
      const vals = cel.map(c => (c ? c.v : -Infinity));
      const mx = Math.max(...vals), iMax = vals.indexOf(mx);
      const venc = agrs.find(a => a.id === x.agr);
      const rng = `${smRef(c0, r)}:${smRef(c1, r)}`;
      const maior = iMax >= 0 && mx > -Infinity ? smSiglas(agrs[iMax]) : '';
      aba.add([k + 1, terceira ? '3ª fase' : `${Math.round(pctP * 100)}/${Math.round(pctC * 100)}`, ...cel, venc ? smSiglas(venc) : x.agr,
        { f: `INDEX(${smAbs(c0, rc)}:${smAbs(c1, rc)},MATCH(MAX(${rng}),${rng},0))`, v: maior },
        smFConfere(smRef(c1 + 1, r), smRef(c1 + 2, r), venc ? smSiglas(venc) : x.agr, maior), x.cand ? x.cand.nome : '']);
      lug[x.agr] = (lug[x.agr] || 0) + 1;
      ja.add(x.sq);
    });
  }
  return aba;
}

// ------------------------------------------------------------ distritão
/** Distritão: o ranking dos candidatos válidos, com a linha de corte. */
function smAbaDistritao(s, dados, ufs, res) {
  const aba = smNovaAba(s.nome.slice(0, 31), [6, 6, 32, 10, 16, 12, 10, 9]);
  aba.add([`${s.nome}: os candidatos (válidos) mais votados do estado, até o número de vagas; legenda não elege. Mostra até 5 posições abaixo do corte.`]);
  for (const uf of ufs) {
    const d = dados[uf], sim = res.porUf[uf];
    if (!sim) continue;
    const vagas = d.vagas, eleitos = new Set(sim.eleitos.map(x => x.sq));
    const todos = d.agrs.flatMap(a => a.cands.filter(c => c.valido).map(c => ({ a, c }))).sort((x, y) => y.c.votos - x.c.votos);
    aba.add([]);
    const r0 = aba.prox();
    aba.add([uf.toUpperCase(), 'Vagas', vagas]);
    aba.add(['UF', 'Posição', 'Candidato', 'Partido', 'Agremiação', 'Votos', 'Eleito (simulador)', 'Confere']);
    todos.slice(0, vagas + 5).forEach(({ a, c }, i) => {
      const r = aba.prox(), el = eleitos.has(c.sq) ? 'sim' : 'não', pela = i + 1 <= vagas ? 'sim' : 'não';
      aba.add([uf.toUpperCase(), i + 1, c.nome, c.partido, smSiglas(a), c.votos, el,
        { f: `IF(IF(B${r}<=${smAbs(2, r0)},"sim","não")=G${r},"${SM_SIM}","${SM_NAO}")`, v: smConfere(pela, el) }]);
    });
  }
  return aba;
}

// ------------------------------------------------------------ mistos (lista)
/**
 * Repete a parte "lista" do simulador (snCompletarLista) guardando os passos:
 * alvo pelas maiores médias, lista = mín(candidatos que restam, máx(0, alvo − 1ª parte)),
 * cortes pela menor média (excedente) e acréscimos pela maior média (falta).
 */
function smListaPassos(d, primeiros, vagas, op) {
  const nLista = vagas - primeiros.length, limiar = op.limiar || 0;
  const ja = new Set(primeiros.map(x => x.sq));
  const n1 = {};
  for (const x of primeiros) n1[x.agr] = (n1[x.agr] || 0) + 1;
  const votos = Object.fromEntries(d.agrs.map(a => [a.id, a.votos]));
  const teto = Object.fromEntries(d.agrs.map(a => [a.id, a.cands.filter(c => c.valido && !ja.has(c.sq)).length]));
  const total = Object.values(votos).reduce((s, v) => s + v, 0);
  const entra = id => votos[id] > 0 && votos[id] >= limiar * total;
  const passos = [];
  let alvo = null, lista = {};
  const dh = (n, tem, resta) => {   // D'Hondt com o mesmo desempate do simulador (a primeira agremiação com a maior média)
    const ids = Object.keys(votos).filter(entra), lug = Object.fromEntries(ids.map(id => [id, tem[id] || 0])), out = Object.fromEntries(ids.map(id => [id, 0]));
    for (let i = 0; i < n; i++) {
      let m = null;
      for (const id of ids) if ((!resta || out[id] < (resta[id] || 0)) && (!m || votos[id] / (lug[id] + 1) > votos[m] / (lug[m] + 1))) m = id;
      if (!m) break;
      if (resta) passos.push({ tipo: 'acrescenta', id: m, lug: Object.assign({}, lug), ok: Object.keys(lug).filter(id => out[id] < (resta[id] || 0)) });
      lug[m]++; out[m]++;
    }
    return out;
  };
  if (op.modelo === 'compensatorio') {
    alvo = dh(vagas, {}, null);
    for (const id of Object.keys(votos)) lista[id] = Math.min(teto[id], Math.max(0, (alvo[id] || 0) - (n1[id] || 0)));
    let soma = Object.values(lista).reduce((s, v) => s + v, 0);
    while (soma > nLista) {
      let pior = null;
      for (const id of Object.keys(lista)) if (lista[id] > 0 && (!pior || votos[id] / ((n1[id] || 0) + lista[id]) < votos[pior] / ((n1[pior] || 0) + lista[pior]))) pior = id;
      passos.push({ tipo: 'corta', id: pior, lista: Object.assign({}, lista) });
      lista[pior]--; soma--;
    }
    if (soma < nLista) {
      const tem = {}, resta = {};
      for (const id of Object.keys(votos)) { tem[id] = (n1[id] || 0) + lista[id]; resta[id] = teto[id] - lista[id]; }
      const mais = dh(nLista - soma, tem, resta);
      for (const id of Object.keys(mais)) lista[id] += mais[id];
    }
  } else {
    lista = dh(Math.max(0, nLista), {}, teto);
    passos.length = 0;   // no paralelo, o teto só pesa se faltar candidato (aparece na conferência)
  }
  return { nLista: Math.max(0, nLista), n1, teto, alvo, lista, passos, entra, votos };
}

/**
 * Bloco da lista (D'Hondt) de um estado: a tabela de quocientes votos ÷ 1, 2, 3…
 * de cada agremiação; as cadeiras pela conta = quantos quocientes da linha estão
 * entre os N maiores da tabela (CONT.SE com MAIOR). Compensatório: N = todas as
 * vagas (o alvo), lista = mín(candidatos que restam; máx(0; alvo − 1ª parte)), e os
 * ajustes, passo a passo, pela menor (ou maior) média.
 */
function smBlocoLista(aba, d, sim, op, primeiros) {
  const comp = op.modelo === 'compensatorio';
  const p = smListaPassos(d, primeiros, d.vagas, op);
  // na ordem do arquivo do TSE: é a do desempate do simulador (em médias iguais, a que vem antes)
  const agrs = d.agrs.filter(a => p.entra(a.id));
  const N = comp ? d.vagas : p.nLista;
  if (!N || !agrs.length) { aba.add(['Lista: nenhuma vaga.']); return; }
  const porAgrLista = {};
  for (const x of sim.eleitos) if (x.fase === 'lista') porAgrLista[x.agr] = (porAgrLista[x.agr] || 0) + 1;
  const ndiv = N;
  aba.add([comp ? `Lista (compensatório): alvo de cada agremiação pelas maiores médias sobre TODAS as ${d.vagas} vagas; a lista completa o que a 1ª parte não deu (${p.nLista} vagas).`
    : `Lista (paralelo): as ${p.nLista} vagas da lista pelas maiores médias.`,
    'Quociente = votos ÷ divisor − ordem × 0,000000001 (o desempate: em médias iguais, leva a agremiação que vem antes no arquivo do TSE, como no simulador).']
    .concat(op.limiar ? [`Cláusula: ${op.limiar * 100}% dos válidos do estado.`] : []));
  const rc = aba.prox();
  const cab = ['Agremiação', 'Votos', '1ª parte (simulador)', 'Candidatos que restam', 'Ordem (desempate)'];
  const cq = cab.length;
  for (let i = 1; i <= ndiv; i++) cab.push('÷ ' + i);
  const cAlvo = cq + ndiv;
  if (comp) cab.push('Alvo (fórmula)', 'Lista = mín(restam; máx(0; alvo − 1ª parte))', 'Lista depois dos ajustes', 'Lista (simulador)', 'Confere');
  else cab.push('Lista (fórmula)', 'Lista (simulador)', 'Confere');
  aba.add(cab);
  const r1 = rc + 1, rN = rc + agrs.length;
  const mat = `${smAbs(cq, r1)}:${smAbs(cq + ndiv - 1, rN)}`;
  // valores (para as células) — a N-ésima maior média da tabela
  const q = (a, i) => a.votos / i - agrs.indexOf(a) * 1e-9;
  const todosQ = [];
  for (const a of agrs) for (let i = 1; i <= ndiv; i++) todosQ.push(q(a, i));
  todosQ.sort((x, y) => y - x);
  const corte = todosQ[N - 1];
  const linha = {};
  // tabela dos ajustes (se houver): linhas e colunas já conhecidas, para a fórmula "depois dos ajustes"
  const rA = rc + agrs.length + 4, rAf = rA + p.passos.length - 1;   // soma, texto, cabeçalho, passos
  const cOp = 1, cConta = 2 + agrs.length + 1;
  const ajuste = (r) => (comp && p.passos.length
    ? `-COUNTIFS(${smAbs(cConta, rA)}:${smAbs(cConta, rAf)},$A${r},${smAbs(cOp, rA)}:${smAbs(cOp, rAf)},"corta*")+COUNTIFS(${smAbs(cConta, rA)}:${smAbs(cConta, rAf)},$A${r},${smAbs(cOp, rA)}:${smAbs(cOp, rAf)},"acrescenta*")`
    : '');
  for (const a of agrs) {
    const r = aba.prox();
    linha[a.id] = r;
    const row = [smSiglas(a), a.votos, p.n1[a.id] || 0, p.teto[a.id], agrs.indexOf(a)];
    for (let i = 1; i <= ndiv; i++) row.push({ f: `${smAbs(1, r)}/${i}-${smAbs(4, r)}*1E-9`, v: q(a, i) });
    const rng = `${smRef(cq, r)}:${smRef(cq + ndiv - 1, r)}`;
    const conta = Array.from({ length: ndiv }, (_, i) => q(a, i + 1)).filter(x => x >= corte).length;
    row.push({ f: `COUNTIF(${rng},">="&LARGE(${mat},${N}))`, v: conta });
    const simL = porAgrLista[a.id] || 0;
    if (comp) {
      const l0 = Math.min(p.teto[a.id], Math.max(0, conta - (p.n1[a.id] || 0)));
      row.push({ f: `MIN(D${r},MAX(0,${smRef(cAlvo, r)}-C${r}))`, v: l0 }, { f: `${smRef(cAlvo + 1, r)}${ajuste(r)}`, v: p.lista[a.id] || 0 }, simL,
        smFConfere(smRef(cAlvo + 2, r), smRef(cAlvo + 3, r), p.lista[a.id] || 0, simL));
    } else {
      row.push(simL, smFConfere(smRef(cAlvo, r), smRef(cAlvo + 1, r), conta, simL));
    }
    aba.add(row);
  }
  const rs = aba.prox();
  const somaRow = ['Soma', { f: `SUM(B${r1}:B${rN})`, v: agrs.reduce((s, a) => s + a.votos, 0) }];
  while (somaRow.length < cAlvo) somaRow.push(null);
  if (comp) {
    const sAlvo = agrs.reduce((s, a) => s + Array.from({ length: ndiv }, (_, i) => q(a, i + 1)).filter(x => x >= corte).length, 0);
    somaRow.push({ f: `SUM(${smRef(cAlvo, r1)}:${smRef(cAlvo, rN)})`, v: sAlvo },
      { f: `SUM(${smRef(cAlvo + 1, r1)}:${smRef(cAlvo + 1, rN)})`, v: agrs.reduce((s, a) => s + Math.min(p.teto[a.id], Math.max(0, Array.from({ length: ndiv }, (_, i) => q(a, i + 1)).filter(x => x >= corte).length - (p.n1[a.id] || 0))), 0) },
      { f: `SUM(${smRef(cAlvo + 2, r1)}:${smRef(cAlvo + 2, rN)})`, v: agrs.reduce((s, a) => s + (p.lista[a.id] || 0), 0) },
      { f: `SUM(${smRef(cAlvo + 3, r1)}:${smRef(cAlvo + 3, rN)})`, v: Object.values(porAgrLista).reduce((s, v) => s + v, 0) });
  } else {
    somaRow.push({ f: `SUM(${smRef(cAlvo, r1)}:${smRef(cAlvo, rN)})`, v: agrs.reduce((s, a) => s + Array.from({ length: ndiv }, (_, i) => q(a, i + 1)).filter(x => x >= corte).length, 0) },
      { f: `SUM(${smRef(cAlvo + 1, r1)}:${smRef(cAlvo + 1, rN)})`, v: Object.values(porAgrLista).reduce((s, v) => s + v, 0) });
  }
  aba.add(somaRow);
  void rs;
  // ajustes do compensatório, passo a passo
  if (comp && p.passos.length) {
    aba.add(['Ajustes: quando as listas somam mais que as vagas da lista (alguém ganhou na 1ª parte mais do que o alvo), corta-se, uma a uma, a vaga de quem fica com a MENOR média votos ÷ (1ª parte + lista); se somam menos (falta candidato), acrescenta-se pela MAIOR média votos ÷ (cadeiras + 1).']);
    const ra = aba.prox();
    aba.add(['Passo', 'Operação', ...agrs.map(smSiglas), 'Escolhida (simulador)', 'Pela conta (fórmula)', 'Confere']);
    const c0 = 2, c1 = c0 + agrs.length - 1;
    p.passos.forEach((ps, k) => {
      const r = aba.prox();
      let cel;
      if (ps.tipo === 'corta') {
        cel = agrs.map(a => (ps.lista[a.id] > 0 ? { f: `${smAbs(1, linha[a.id])}/(${smAbs(2, linha[a.id])}+${ps.lista[a.id]})`, v: a.votos / ((p.n1[a.id] || 0) + ps.lista[a.id]) } : null));
      } else {
        cel = agrs.map(a => (ps.ok.includes(a.id) ? { f: `${smAbs(1, linha[a.id])}/(${ps.lug[a.id]}+1)`, v: a.votos / (ps.lug[a.id] + 1) } : null));
      }
      const vals = cel.map(c => (c ? c.v : null)).filter(v => v != null);
      const alvoV = ps.tipo === 'corta' ? Math.min(...vals) : Math.max(...vals);
      const iA = cel.findIndex(c => c && c.v === alvoV);
      const rng = `${smRef(c0, r)}:${smRef(c1, r)}`;
      const esc = agrs.find(a => a.id === ps.id);
      aba.add([k + 1, ps.tipo === 'corta' ? 'corta (menor média)' : 'acrescenta (maior média)', ...cel, esc ? smSiglas(esc) : ps.id,
        { f: `INDEX(${smAbs(c0, ra)}:${smAbs(c1, ra)},MATCH(${ps.tipo === 'corta' ? 'MIN' : 'MAX'}(${rng}),${rng},0))`, v: iA >= 0 ? smSiglas(agrs[iA]) : '' },
        smFConfere(smRef(c1 + 1, r), smRef(c1 + 2, r), esc ? smSiglas(esc) : ps.id, iA >= 0 ? smSiglas(agrs[iA]) : '')]);
    });
  }
}

/** Distritão misto: os N mais votados (com a linha de corte) e a lista. */
function smAbaDistritaoMisto(s, dados, ufs, res) {
  const op = s.op || {};
  const aba = smNovaAba(s.nome.slice(0, 31), [16, 14, 12, 12, 10, 10, 10, 10, 10, 10]);
  aba.add([`${s.nome}: ${Math.round((op.pctMaisVotados != null ? op.pctMaisVotados : 0.5) * 100)}% das vagas aos mais votados (nº = vagas × fração, arredondado), o resto pela lista, ${op.modelo === 'compensatorio' ? 'compensatório' : 'paralelo'}. Lista: votos da agremiação (nominais + legenda), maiores médias; preenchida pelos não eleitos, na ordem de votos.`]);
  for (const uf of ufs) {
    const d = dados[uf], sim = res.porUf[uf];
    if (!sim) continue;
    const nMais = sim.nMais != null ? sim.nMais : Math.round(d.vagas * (op.pctMaisVotados != null ? op.pctMaisVotados : 0.5));
    aba.add([]);
    const r0 = aba.prox();
    aba.add([uf.toUpperCase(), 'Vagas', d.vagas, 'Mais votados (fórmula)', { f: `ROUND(C${r0}*${op.pctMaisVotados != null ? op.pctMaisVotados : 0.5},0)`, v: nMais }, 'Simulador', nMais,
      smFConfere(`E${r0}`, `G${r0}`, nMais, nMais)]);
    const primeiros = sim.eleitos.filter(x => x.fase !== 'lista');
    const todos = d.agrs.flatMap(a => a.cands.filter(c => c.valido).map(c => ({ a, c }))).sort((x, y) => y.c.votos - x.c.votos);
    const corte = todos[nMais - 1];
    aba.add([`1ª parte: os ${nMais} mais votados (o último eleito: ${corte ? corte.c.nome + ', ' + corte.c.votos + ' votos' : '—'}; o 1º de fora: ${todos[nMais] ? todos[nMais].c.nome + ', ' + todos[nMais].c.votos + ' votos' : '—'}). Lista completa na aba Eleitos.`]);
    const ok = primeiros.length === nMais && primeiros.every(x => todos.slice(0, nMais).some(t => t.c.sq === x.sq));
    aba.add(['Confere: os eleitos na 1ª parte são exatamente os ' + nMais + ' mais votados', ok ? SM_SIM : SM_NAO]);
    smBlocoLista(aba, d, sim, op, primeiros);
  }
  return aba;
}

/** Distrital misto: os distritos (tamanho por fórmula, a partir da composição; quem leva) e a lista. */
function smAbaDistrital(s, dados, ufs, res) {
  const op = s.op || {};
  const aba = smNovaAba(s.nome.slice(0, 31), [16, 12, 10, 12, 16, 12, 16, 12, 28, 10, 12, 9]);
  const pop = op.base === 'populacao';
  aba.add([`${s.nome}: ${Math.round((op.pctDistrital != null ? op.pctDistrital : 0.5) * 100)}% das vagas em distritos de um eleito (${op.regra === 'candidato' ? 'o candidato mais votado do distrito' : 'a agremiação mais votada leva, com o seu candidato mais votado ali'}), o resto pela lista, ${op.modelo === 'compensatorio' ? 'compensatório' : 'paralelo'}. Tamanho dos distritos: ${pop ? 'população (Censo 2022)' : 'eleitores aptos'}.`]);
  const DC = smAbaRef('Distritos (composição)');
  for (const uf of ufs) {
    const d = dados[uf], sim = res.porUf[uf], x = (op.porUf || {})[uf];
    if (!sim || !x) continue;
    const dist = sim.distritos || [];
    aba.add([]);
    const r0 = aba.prox();
    const k = dist.length, soma = x.desenho.distritos.reduce((t, q) => t + q.aptos, 0);
    aba.add([uf.toUpperCase(), 'Vagas', d.vagas, 'Distritos', k, `Alvo (${pop ? 'habitantes' : 'eleitores'}) = soma ÷ distritos`, { f: k ? `SUMIF(${DC}!A:A,A${r0},${DC}!G:G)/E${r0}` : '0', v: k ? soma / k : 0 }]);
    if (!k) { smBlocoLista(aba, d, sim, op, []); continue; }
    const rc = aba.prox();
    aba.add(['Distrito', `Tamanho (soma da composição)`, 'Tamanho (simulador)', 'Confere', 'Desvio = tamanho ÷ alvo − 1', 'Votos válidos no distrito', '1ª agremiação', 'Votos', '2ª agremiação', 'Votos', 'Confere (a 1ª tem mais)', 'Eleito', 'Partido', 'Votos do eleito']);
    void rc;
    const des = new Map(x.desenho.distritos.map(q => [q.id, q]));
    for (const dt of dist) {
      const r = aba.prox(), w = dt.vencedor, sg = dt.segundo;
      const q = des.get(dt.id) || { aptos: dt.aptos };
      const v1 = w ? w.agrVotos : 0, v2 = sg ? sg.votos : 0;
      aba.add([dt.id, { f: `SUMIFS(${DC}!G:G,${DC}!A:A,${smAbs(0, r0)},${DC}!B:B,A${r})`, v: q.aptos }, dt.aptos, { f: `IF(ABS(B${r}-C${r})<0.5,"${SM_SIM}","${SM_NAO}")`, v: smPerto(q.aptos, dt.aptos, 0.5) ? SM_SIM : SM_NAO },
        { f: `B${r}/${smAbs(6, r0)}-1`, v: q.aptos / (soma / k) - 1 }, dt.validos, w ? w.agrNome : '—', v1, sg ? sg.nome : '—', v2,
        { f: `IF(${op.regra === 'candidato' ? 'TRUE' : `H${r}>=J${r}`},"${SM_SIM}","${SM_NAO}")`, v: op.regra === 'candidato' || v1 >= v2 ? SM_SIM : SM_NAO },
        w ? w.nome : '—', w ? w.partido : '', w ? w.votos : 0]);
    }
    const primeiros = sim.eleitos.filter(e => e.fase !== 'lista');
    smBlocoLista(aba, d, sim, op, primeiros);
  }
  return aba;
}

/** Composição dos distritos: cada unidade (município, zona eleitoral ou local de votação) e o seu peso. */
function smAbaComposicao(s, ufs) {
  const aba = smNovaAba('Distritos (composição)', [5, 8, 22, 30, 8, 8, 14]);
  const pop = (s.op || {}).base === 'populacao';
  aba.add(['UF', 'Distrito', 'Unidade', 'Município', 'Zona', 'Local', pop ? 'Habitantes (Censo 2022)' : 'Eleitores aptos']);
  for (const uf of ufs) {
    const x = ((s.op || {}).porUf || {})[uf];
    if (!x || !x.desenho || !x.desenho.distritos) continue;
    const U = new Map(x.base.unidades.map(u => [u.id, u]));
    for (const dt of x.desenho.distritos) for (const id of dt.unidades) {
      const u = U.get(id) || {};
      const tipo = id.startsWith('z:') ? 'zona eleitoral' : id.startsWith('l:') ? 'local de votação' : 'município';
      aba.add([uf.toUpperCase(), dt.id, tipo, (u.nome || '').split(' · ')[0], id.startsWith('m:') ? (u.zonas || []).join(', ') : (u.zonas || [])[0] || '', u.loc != null ? u.loc : '', u.aptos || 0]);
    }
  }
  return aba;
}

// ------------------------------------------------------------ eleitos, bancadas, indicadores
/** Eleitos de cada sistema (e o oficial), um por linha. */
function smAbaEleitos(res, ufs) {
  const aba = smNovaAba('Eleitos', [20, 5, 32, 10, 16, 12, 18, 12]);
  aba.add(['Sistema', 'UF', 'Candidato', 'Partido', 'Agremiação (id)', 'Votos', 'Como', 'Na comparação nacional']);
  const comp = new Set(res.comparadas);
  const linhas = (nome, porUf) => {
    for (const uf of ufs) for (const x of ((porUf[uf] || {}).eleitos || [])) {
      aba.add([nome, uf.toUpperCase(), x.cand ? x.cand.nome : x.sq, x.cand ? x.cand.partido : '', x.agr, x.cand ? x.cand.votos : '', x.fase || '', comp.has(uf) ? 'sim' : 'não']);
    }
  };
  if (res.real.total) linhas('Resultado oficial', res.real.porUf);
  for (const s of res.sims) linhas(s.nome, s.porUf);
  return aba;
}

/** Bancadas por partido: contadas na aba Eleitos (fórmula) contra o simulador. */
function smAbaBancadas(res, ordem) {
  const aba = smNovaAba('Bancadas', [12]);
  const sist = [...(res.real.total ? [{ nome: 'Resultado oficial', porPartido: res.real.porPartido }] : []), ...res.sims];
  const cab = ['Partido'];
  for (const s of sist) cab.push(`${s.nome} (contado em Eleitos)`, `${s.nome} (simulador)`, 'Confere');
  aba.add(['Bancadas nas UFs da comparação nacional: cada célula conta os eleitos do partido na aba Eleitos (CONT.SES) e compara com o simulador.']);
  const rc = aba.prox();
  aba.add(cab);
  const E = smAbaRef('Eleitos');
  for (const sg of ordem) {
    const r = aba.prox(), row = [sg];
    sist.forEach((s, i) => {
      const c = 1 + i * 3, n = s.porPartido[sg] || 0;
      row.push({ f: `COUNTIFS(${E}!A:A,${smTxt(s.nome)},${E}!D:D,$A${r},${E}!H:H,"sim")`, v: n }, n, smFConfere(smRef(c, r), smRef(c + 1, r), n, n));
    });
    aba.add(row);
  }
  const rT = aba.prox(), tot = ['Total'];
  sist.forEach((s, i) => {
    const c = 1 + i * 3, t = Object.values(s.porPartido).reduce((a, b) => a + b, 0);
    tot.push({ f: `SUM(${smRef(c, rc + 1)}:${smRef(c, rT - 1)})`, v: t }, t, smFConfere(smRef(c, rT), smRef(c + 1, rT), t, t));
  });
  aba.add(tot);
  return { aba, linhaDe: Object.fromEntries(ordem.map((sg, i) => [sg, rc + 1 + i])), colDe: Object.fromEntries(sist.map((s, i) => [s.nome, 1 + i * 3])), rT };
}

/**
 * Indicadores: fatia de votos e de cadeiras de cada partido (fórmulas), número efetivo
 * de partidos = 1 ÷ Σ fatia² e Gallagher = √(½ Σ (votos% − cadeiras%)²), contra o simulador.
 */
function smAbaIndicadores(res, ind, ordem, banc) {
  const aba = smNovaAba('Indicadores', [12, 14, 10]);
  const sist = [...(res.real.total ? [{ id: 'real', nome: 'Resultado oficial', porPartido: res.real.porPartido }] : []), ...res.sims];
  const siglas = [...new Set([...ordem, ...Object.keys(ind.votos)])];
  aba.add(['Votos de cada partido (nominais válidos + legenda; numa federação, os de cada partido) nas UFs da comparação; cadeiras da aba Bancadas.']);
  const rc = aba.prox();
  const cab = ['Partido', 'Votos', 'Votos %'];
  for (const s of sist) cab.push(`${s.nome}: cadeiras`, 'Cadeiras %', '(votos% − cadeiras%)²');
  aba.add(cab);
  const r1 = rc + 1, rN = rc + siglas.length;
  const totV = Object.values(ind.votos).reduce((a, b) => a + b, 0) || 1;
  const B = smAbaRef('Bancadas');
  for (const sg of siglas) {
    const r = aba.prox(), v = ind.votos[sg] || 0;
    const row = [sg, v, { f: `100*B${r}/SUM(${smAbs(1, r1)}:${smAbs(1, rN)})`, v: 100 * v / totV }];
    sist.forEach((s, i) => {
      const c = 3 + i * 3, n = s.porPartido[sg] || 0, tot = Object.values(s.porPartido).reduce((a, b) => a + b, 0) || 1;
      const lb = banc.linhaDe[sg];
      row.push(lb ? { f: `${B}!${smRef(banc.colDe[s.nome], lb)}`, v: n } : n,
        { f: `100*${smRef(c, r)}/SUM(${smAbs(c, r1)}:${smAbs(c, rN)})`, v: 100 * n / tot },
        { f: `(C${r}-${smRef(c + 1, r)})^2`, v: (100 * v / totV - 100 * n / tot) ** 2 });
    });
    aba.add(row);
  }
  aba.add([]);
  const rh = aba.prox();
  aba.add(['Sistema', 'Nº efetivo de partidos (fórmula)', 'Simulador', 'Confere', 'Gallagher (fórmula)', 'Simulador', 'Confere']);
  sist.forEach((s, i) => {
    const r = aba.prox(), c = 3 + i * 3, x = s.id === 'real' ? ind.real : ind.sims[s.id];
    const tot = Object.values(s.porPartido).reduce((a, b) => a + b, 0) || 1;
    const nep = 1 / Object.values(s.porPartido).reduce((a, n) => a + (n / tot) ** 2, 0);
    let q = 0;
    for (const sg of siglas) q += (100 * (ind.votos[sg] || 0) / totV - 100 * (s.porPartido[sg] || 0) / tot) ** 2;
    const gal = Math.sqrt(q / 2);
    aba.add([s.nome, { f: `1/SUMPRODUCT((${smRef(c + 1, r1)}:${smRef(c + 1, rN)}/100)^2)`, v: nep }, x ? x.nep : null,
      { f: `IF(ABS(B${r}-C${r})<0.000001,"${SM_SIM}","${SM_NAO}")`, v: x && smPerto(nep, x.nep, 1e-6) ? SM_SIM : SM_NAO },
      { f: `SQRT(SUM(${smRef(c + 2, r1)}:${smRef(c + 2, rN)})/2)`, v: gal }, x ? x.gallagher : null,
      { f: `IF(ABS(E${r}-F${r})<0.000001,"${SM_SIM}","${SM_NAO}")`, v: x && smPerto(gal, x.gallagher, 1e-6) ? SM_SIM : SM_NAO }]);
  });
  void rh;
  return aba;
}

// ------------------------------------------------------------ o memorial
/**
 * Monta o memorial. ent: { dados: { uf: d }, res (snSimular), sistemas (com op; o distrital com op.porUf),
 * ind (snIndicadores), ordem (snOrdemPartidos), meta: { titulo, eleicao, cargo, fonte, versoes, gerado, parametros: [texto] } }.
 * Devolve { abas: [{ nome, linhas, larguras }], conferencias: { aba: nº de células "Confere" } }.
 */
function smMemorial(ent) {
  const { dados, res, sistemas, ind, ordem, meta = {} } = ent;
  const ufs = res.ufs.slice().sort();
  const abas = [];
  const leia = smNovaAba('Leia-me', [34, 70]);
  abas.push(leia);
  abas.push(smAbaEstados(dados, ufs));
  const votos = smAbaVotos(dados, ufs);
  abas.push(votos.aba);
  abas.push(smAbaCandidatos(dados, ufs));
  for (const s of res.sims) {
    const def = sistemas.find(x => x.id === s.id) || s;
    const sx = Object.assign({}, def, { nome: s.nome });
    if (s.tipo === 'proporcional') abas.push(smAbaProporcional(sx, dados, ufs, s));
    else if (s.tipo === 'distritao') abas.push(smAbaDistritao(sx, dados, ufs, s));
    else if (s.tipo === 'misto') abas.push(smAbaDistritaoMisto(sx, dados, ufs, s));
    else if (s.tipo === 'distrital') { abas.push(smAbaDistrital(sx, dados, ufs, s)); abas.push(smAbaComposicao(sx, ufs)); }
  }
  abas.push(smAbaEleitos(res, ufs));
  const banc = smAbaBancadas(res, ordem);
  abas.push(banc.aba);
  abas.push(smAbaIndicadores(res, ind, ordem, banc));
  // nomes únicos (o Excel não aceita repetidos)
  const vistos = new Set();
  for (const a of abas) { let n = a.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), i = 2; while (vistos.has(n)) n = a.nome.slice(0, 28) + ' ' + i++; vistos.add(n); a.nome = n; }
  // conferências: quantas células "Confere" e quantas deram NÃO (pelo valor calculado aqui)
  const conf = {};
  for (const a of abas) {
    let n = 0, nao = 0;
    for (const l of a.linhas) for (const c of l) if (c && typeof c === 'object' && (c.f || '').includes(`"${SM_SIM}","${SM_NAO}"`)) { n++; if (c.v !== SM_SIM) nao++; }
    if (n) conf[a.nome] = { n, nao };
  }
  // leia-me
  leia.add([meta.titulo || 'Memorial de cálculo — sistemas eleitorais']);
  leia.add([]);
  for (const [k, v] of [['Eleição', meta.eleicao], ['Cargo', meta.cargo], ['Fonte dos votos', meta.fonte], ['Versão dos arquivos', meta.versoes], ['Gerado em', meta.gerado],
    ['Estados', ufs.map(u => u.toUpperCase()).join(', ')], ['Na comparação nacional', res.comparadas.map(u => u.toUpperCase()).join(', ')]]) if (v) leia.add([k, v]);
  leia.add([]);
  leia.add(['Sistemas e parâmetros']);
  for (const p of meta.parametros || []) leia.add(p);
  leia.add([]);
  leia.add(['Como conferir']);
  for (const t of [
    'Cada conta é refeita por fórmula nesta planilha, a partir dos votos de cada candidato (aba Candidatos): as somas das agremiações, o quociente eleitoral, o quociente partidário, as médias das sobras, as maiores médias das listas, o tamanho dos distritos, as bancadas e os indicadores.',
    `A coluna "Confere" compara a conta da planilha com o resultado do simulador: ${SM_SIM} quando batem, ${SM_NAO} quando não. Abaixo, quantas conferências há em cada aba e quantas deram ${SM_NAO} (fórmula: recalcula ao abrir).`,
    'Os votos vêm do TSE, lidos na hora pela extensão; a população (distrital por população), do IBGE. Nenhum número é digitado à mão.',
    'Proporcional: a ordem das rodadas das sobras é a do simulador; em cada rodada, a planilha calcula a média de quem pode disputar e aponta a maior.',
    'Listas (maiores médias): as cadeiras de cada agremiação = quantos quocientes votos ÷ 1, 2, 3… dela estão entre os N maiores da tabela (N = vagas da lista; no compensatório, todas as vagas, o alvo).',
    'Distrital: o tamanho de cada distrito é a soma das suas unidades na aba "Distritos (composição)". Os votos por distrito vêm dos votos por município e zona (e, onde afinado, por local de votação) do TSE.',
  ]) leia.add(['', t]);
  leia.add([]);
  const rC = leia.prox();
  leia.add(['Aba', 'Conferências', `${SM_NAO} (recalculado)`]);
  for (const [nome, x] of Object.entries(conf)) {
    leia.add([nome, x.n, { f: `COUNTIF(${smAbaRef(nome)}!A:ZZ,"${SM_NAO}")`, v: x.nao }]);
  }
  const rF = leia.prox() - 1;
  leia.add(['Total', { f: `SUM(B${rC + 1}:B${rF})`, v: Object.values(conf).reduce((s, x) => s + x.n, 0) }, { f: `SUM(C${rC + 1}:C${rF})`, v: Object.values(conf).reduce((s, x) => s + x.nao, 0) }]);
  return { abas, conferencias: conf };
}

/** Abas → planilha do SheetJS (com fórmulas e o valor já calculado). */
function smParaXlsx(XLSX, memo) {
  const wb = XLSX.utils.book_new();
  for (const a of memo.abas) {
    const ws = {};
    let maxC = 0;
    a.linhas.forEach((l, r) => l.forEach((c, i) => {
      if (c == null || c === '') return;
      const ref = smRef(i, r + 1);
      if (typeof c === 'object') {
        const v = c.v;
        ws[ref] = typeof v === 'number' ? (isFinite(v) ? { t: 'n', v, f: c.f } : { t: 's', v: '', f: c.f }) : { t: 's', v: v == null ? '' : String(v), f: c.f };
      } else ws[ref] = typeof c === 'number' ? { t: 'n', v: c } : { t: 's', v: String(c) };
      maxC = Math.max(maxC, i);
    }));
    ws['!ref'] = `A1:${smRef(maxC, Math.max(1, a.linhas.length))}`;
    if (a.larguras && a.larguras.length) ws['!cols'] = a.larguras.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, a.nome);
  }
  return wb;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { smCol, smRef, smQE, smListaPassos, smMemorial, smParaXlsx, SM_SIM, SM_NAO };
}
