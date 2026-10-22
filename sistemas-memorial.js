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

// ------------------------------------------------------------ mistos (lista)
/**
 * Repete a parte "lista" do simulador (snCompletarLista) guardando os passos:
 * alvo pelas maiores médias, lista = mín(candidatos que restam, máx(0, alvo − 1ª parte)),
 * cortes pela menor média (excedente) e acréscimos pela maior média (falta).
 */
function smListaPassos(d, primeiros, vagas, op, casa = vagas) {
  // vagas: as do alvo (na compensação total, a Casa já crescida); casa: o tamanho final da Casa
  const nLista = casa - primeiros.length, limiar = op.limiar || 0, sl = op.divisor === 'sl', dv = k => (sl ? 2 * k + 1 : k + 1);
  const ja = new Set(primeiros.map(x => x.sq));
  const n1 = {};
  for (const x of primeiros) n1[x.agr] = (n1[x.agr] || 0) + 1;
  const votos = Object.fromEntries(d.agrs.map(a => [a.id, a.votos]));
  const teto = Object.fromEntries(d.agrs.map(a => [a.id, a.cands.filter(c => c.valido && !ja.has(c.sq)).length]));
  // a cláusula vale sobre os válidos do estado (como no simulador), não sobre a soma (que encolhe com o voto líquido)
  const total = d.validos != null ? d.validos : Object.values(votos).reduce((s, v) => s + v, 0);
  const entra = id => votos[id] > 0 && votos[id] >= limiar * total;
  const passos = [];
  let alvo = null, lista = {};
  const dh = (n, tem, resta) => {   // D'Hondt com o mesmo desempate do simulador (a primeira agremiação com a maior média)
    const ids = Object.keys(votos).filter(entra), lug = Object.fromEntries(ids.map(id => [id, tem[id] || 0])), out = Object.fromEntries(ids.map(id => [id, 0]));
    for (let i = 0; i < n; i++) {
      let m = null;
      for (const id of ids) if ((!resta || out[id] < (resta[id] || 0)) && (!m || votos[id] / dv(lug[id]) > votos[m] / dv(lug[m]))) m = id;
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
      for (const id of Object.keys(lista)) if (lista[id] > 0 && (!pior || votos[id] / dv((n1[id] || 0) + lista[id] - 1) < votos[pior] / dv((n1[pior] || 0) + lista[pior] - 1))) pior = id;
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
  return { nLista: Math.max(0, nLista), n1, teto, alvo, lista, passos, entra, votos, dv, sl };
}

/**
 * Bloco da lista (D'Hondt) de um estado: a tabela de quocientes votos ÷ 1, 2, 3…
 * de cada agremiação; as cadeiras pela conta = quantos quocientes da linha estão
 * entre os N maiores da tabela (CONT.SE com MAIOR). Compensatório: N = todas as
 * vagas (o alvo), lista = mín(candidatos que restam; máx(0; alvo − 1ª parte)), e os
 * ajustes, passo a passo, pela menor (ou maior) média.
 */
function smBlocoLista(aba, d, sim, op, primeiros) {
  const comp = op.modelo === 'compensatorio', exc = comp ? (op.excedente || 'corta') : 'corta';
  const total = sim.vagas || d.vagas, vAlvo = exc === 'compensa' ? total : d.vagas;
  const p = smListaPassos(d, primeiros, vAlvo, op, total);
  const div = i => (p.sl ? 2 * i - 1 : i);   // o divisor da i-ésima cadeira
  // na ordem do arquivo do TSE: é a do desempate do simulador (em médias iguais, a que vem antes)
  const agrs = d.agrs.filter(a => p.entra(a.id));
  const N = comp ? vAlvo : p.nLista;
  if (!N || !agrs.length) { aba.add(['Lista: nenhuma vaga.']); return; }
  const porAgrLista = {};
  for (const x of sim.eleitos) if (x.fase === 'lista') porAgrLista[x.agr] = (porAgrLista[x.agr] || 0) + 1;
  const ndiv = N;
  const excTxt = { corta: `excedente: quem ganha na 1ª parte mais que o alvo fica com as cadeiras e as vagas saem das listas pela menor média (a Casa fica com ${d.vagas})`,
    cresce: `excedente: quem ganha na 1ª parte mais que o alvo fica com as cadeiras e a Casa cresce o tanto do excedente${op.tetoExtra != null ? ` (até ${Math.round(op.tetoExtra * 100)}% das vagas; o resto corta)` : ''} — aqui ${total} vagas`,
    compensa: `compensação total: a Casa cresce até o alvo de todas cobrir a 1ª parte${op.tetoExtra != null ? ` (até ${Math.round(op.tetoExtra * 100)}% das vagas; o resto corta)` : ''} — o alvo abaixo já é sobre as ${total} vagas`,
    naoLeva: `excedente não leva: o distrito além do alvo fica sem cadeira (sai o vencedor de menor votação relativa); a 1ª parte abaixo conta só os que ficaram${(sim.descobertos || []).length ? ` (sem cadeira: ${sim.descobertos.length})` : ''}` }[exc];
  aba.add([comp ? `Lista (compensatório): alvo de cada agremiação pelas maiores médias sobre ${vAlvo === d.vagas ? 'TODAS as ' + d.vagas : 'as ' + vAlvo} vagas; a lista completa o que a 1ª parte não deu (${p.nLista} vagas); ${excTxt}.`
    : `Lista (paralelo): as ${p.nLista} vagas da lista pelas maiores médias.`,
    `Quociente = votos ÷ divisor (${p.sl ? 'Sainte-Laguë: 1, 3, 5…' : "D'Hondt: 1, 2, 3…"}) − ordem × 0,000000001 (o desempate: em médias iguais, leva a agremiação que vem antes no arquivo do TSE, como no simulador).`]
    .concat(op.limiar ? [`Cláusula: ${op.limiar * 100}% dos válidos do estado.`] : []));
  const rc = aba.prox();
  const cab = ['Agremiação', 'Votos', '1ª parte (simulador)', 'Candidatos que restam', 'Ordem (desempate)'];
  const cq = cab.length;
  for (let i = 1; i <= ndiv; i++) cab.push('÷ ' + div(i));
  const cAlvo = cq + ndiv;
  if (comp) cab.push('Alvo (fórmula)', 'Lista = mín(restam; máx(0; alvo − 1ª parte))', 'Lista depois dos ajustes', 'Lista (simulador)', 'Confere');
  else cab.push('Lista (fórmula)', 'Lista (simulador)', 'Confere');
  aba.add(cab);
  const r1 = rc + 1, rN = rc + agrs.length;
  const mat = `${smAbs(cq, r1)}:${smAbs(cq + ndiv - 1, rN)}`;
  // valores (para as células) — a N-ésima maior média da tabela
  const q = (a, i) => a.votos / div(i) - agrs.indexOf(a) * 1e-9;
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
    for (let i = 1; i <= ndiv; i++) row.push({ f: `${smAbs(1, r)}/${div(i)}-${smAbs(4, r)}*1E-9`, v: q(a, i) });
    const rng = `${smRef(cq, r)}:${smRef(cq + ndiv - 1, r)}`;
    const conta = Array.from({ length: ndiv }, (_, i) => q(a, i + 1)).filter(x => x >= corte).length;
    // SUMPRODUCT compara número com número; COUNTIF(">="&x) passa x para texto com 15 dígitos e pode errar o próprio x
    row.push({ f: `SUMPRODUCT((${rng}>=LARGE(${mat},${N}))*1)`, v: conta });
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
    aba.add([`Ajustes: quando as listas somam mais que as vagas da lista (alguém ganhou na 1ª parte mais do que o alvo), corta-se, uma a uma, a vaga de quem fica com a MENOR média votos ÷ ${p.sl ? '(2 × (1ª parte + lista) − 1)' : '(1ª parte + lista)'}; se somam menos (falta candidato), acrescenta-se pela MAIOR média votos ÷ ${p.sl ? '(2 × cadeiras + 1)' : '(cadeiras + 1)'}.`]);
    const ra = aba.prox();
    aba.add(['Passo', 'Operação', ...agrs.map(smSiglas), 'Escolhida (simulador)', 'Pela conta (fórmula)', 'Confere']);
    const c0 = 2, c1 = c0 + agrs.length - 1;
    p.passos.forEach((ps, k) => {
      const r = aba.prox();
      let cel;
      if (ps.tipo === 'corta') {
        cel = agrs.map(a => (ps.lista[a.id] > 0 ? { f: p.sl ? `${smAbs(1, linha[a.id])}/(2*(${smAbs(2, linha[a.id])}+${ps.lista[a.id]})-1)` : `${smAbs(1, linha[a.id])}/(${smAbs(2, linha[a.id])}+${ps.lista[a.id]})`, v: a.votos / p.dv((p.n1[a.id] || 0) + ps.lista[a.id] - 1) } : null));
      } else {
        cel = agrs.map(a => (ps.ok.includes(a.id) ? { f: p.sl ? `${smAbs(1, linha[a.id])}/(2*${ps.lug[a.id]}+1)` : `${smAbs(1, linha[a.id])}/(${ps.lug[a.id]}+1)`, v: a.votos / p.dv(ps.lug[a.id]) } : null));
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
function smAbaDistritaoMisto(s, dados, ufs, res, votosLinha) {
  const op = s.op || {};
  const aba = smNovaAba(s.nome.slice(0, 31), [16, 14, 12, 12, 10, 10, 10, 10, 10, 10]);
  const baixo = op.arred === 'baixo';
  aba.add([`${s.nome}: ${Math.round((op.pctMaisVotados != null ? op.pctMaisVotados : 0.5) * 100)}% das vagas aos mais votados (nº = vagas × fração, ${baixo ? 'parte inteira' : 'arredondado'}), o resto pela lista, ${op.modelo === 'compensatorio' ? 'compensatório' : 'paralelo'}. `
    + `Lista: ${op.votoLiquido ? 'voto partidário LÍQUIDO (votos da agremiação, nominais + legenda, menos os votos nominais dos seus eleitos na 1ª parte)' : 'votos da agremiação (nominais + legenda)'}, maiores médias; preenchida pelos não eleitos, na ordem de votos.`]);
  const E = smAbaRef('Eleitos'), V = smAbaRef('Votos');
  for (const uf of ufs) {
    const d = dados[uf], sim = res.porUf[uf];
    if (!sim) continue;
    const nMais = sim.nMais != null ? sim.nMais : Math.round(d.vagas * (op.pctMaisVotados != null ? op.pctMaisVotados : 0.5));
    aba.add([]);
    const r0 = aba.prox();
    const fr = op.pctMaisVotados != null ? op.pctMaisVotados : 0.5;
    aba.add([uf.toUpperCase(), 'Vagas', d.vagas, 'Mais votados (fórmula)', { f: baixo ? `INT(C${r0}*${fr}+1E-9)` : `ROUND(C${r0}*${fr},0)`, v: nMais }, 'Simulador', nMais,
      smFConfere(`E${r0}`, `G${r0}`, nMais, nMais)]);
    const primeiros = sim.eleitos.filter(x => x.fase !== 'lista');
    const todos = d.agrs.flatMap(a => a.cands.filter(c => c.valido).map(c => ({ a, c }))).sort((x, y) => y.c.votos - x.c.votos);
    const corte = todos[nMais - 1];
    aba.add([`1ª parte: os ${nMais} mais votados (o último eleito: ${corte ? corte.c.nome + ', ' + corte.c.votos + ' votos' : '—'}; o 1º de fora: ${todos[nMais] ? todos[nMais].c.nome + ', ' + todos[nMais].c.votos + ' votos' : '—'}). Lista completa na aba Eleitos.`]);
    const ok = primeiros.length === nMais && primeiros.every(x => todos.slice(0, nMais).some(t => t.c.sq === x.sq));
    aba.add(['Confere: os eleitos na 1ª parte são exatamente os ' + nMais + ' mais votados', ok ? SM_SIM : SM_NAO]);
    let dl = d;
    if (op.votoLiquido) {
      // voto partidário líquido: total da agremiação (aba Votos) − votos nominais dos seus eleitos na 1ª parte (aba Eleitos)
      const usado = {};
      for (const x of primeiros) usado[x.agr] = (usado[x.agr] || 0) + x.cand.votos;
      aba.add(['Voto partidário líquido = votos da agremiação − votos nominais dos seus eleitos entre os mais votados']);
      aba.add(['Agremiação (id)', 'Agremiação', 'Votos (aba Votos)', 'Votos dos eleitos na 1ª parte (aba Eleitos)', 'Voto líquido (fórmula)', 'Voto líquido (simulador)', 'Confere']);
      for (const a of d.agrs) {
        const r = aba.prox(), liq = a.votos - (usado[a.id] || 0), simLiq = sim.liquido && sim.liquido[a.id] != null ? sim.liquido[a.id] : a.votos;
        const vr = votosLinha && votosLinha[uf + '|' + a.id];
        aba.add([a.id, smSiglas(a), vr ? { f: `${V}!$G$${vr}`, v: a.votos } : a.votos,
          { f: `SUMIFS(${E}!F:F,${E}!A:A,${smTxt(s.nome)},${E}!B:B,${smTxt(uf.toUpperCase())},${E}!E:E,A${r},${E}!G:G,"mais votados")`, v: usado[a.id] || 0 },
          { f: `C${r}-D${r}`, v: liq }, simLiq, smFConfere(`E${r}`, `F${r}`, liq, simLiq)]);
      }
      dl = Object.assign({}, d, { agrs: d.agrs.map(a => (usado[a.id] ? Object.assign({}, a, { votos: a.votos - usado[a.id] }) : a)) });
    }
    smBlocoLista(aba, dl, sim, op, primeiros);
  }
  return aba;
}

/** Distrital misto: os distritos (tamanho por fórmula, a partir da composição; quem leva) e a lista. */
function smAbaDistrital(s, dados, ufs, res, votosLinha) {
  const op = s.op || {}, V = smAbaRef('Votos');
  const aba = smNovaAba(s.nome.slice(0, 31), [16, 12, 10, 12, 16, 12, 16, 12, 28, 10, 12, 9, 12, 10, 12, 10, 10, 10, 12, 12, 9]);
  aba.linhaDist = {};
  const pop = op.base === 'populacao';
  // tolerância de tamanho (a do cálculo; sem ela, a do PL 9.212)
  const tol = op.tol || { pct: 0.05, exc: 0.10, excN: 1, excFrac: 0.10 }, temExc = tol.exc > tol.pct, pc = x => Math.round(x * 1000) / 10 + '%';
  const tolTxt = `±${pc(tol.pct)}` + (temExc ? ` (±${pc(tol.exc)} em até ${tol.excN} distrito(s) ou ${pc(tol.excFrac)} deles, o que for maior)` : '');
  const classe = x => (Math.abs(x) <= tol.pct + 1e-9 ? 'dentro' : temExc && Math.abs(x) <= tol.exc + 1e-9 ? 'exceção' : 'fora');
  const algumFed = ufs.some(uf => ((op.porUf || {})[uf] || {}).modoEstadual === 'fed');
  if (ufs.some(uf => ['ani', 'ind', 'fed'].includes(((op.porUf || {})[uf] || {}).modoEstadual))) aba.add([`Deputados estaduais e distritais: a bancada federal de cada estado sai das vagas da Assembleia pelo art. 27 da Constituição (até 36 vagas: um terço; acima: vagas − 24; DF: 8). `
    + (algumFed ? 'Nos distritos federais (Versão Minuta, leitura com vários eleitos por distrito): as cadeiras distritais da Assembleia se repartem entre os distritos federais na proporção do tamanho (maiores restos, mínimo 1), e cada distrito elege os mais votados, até 3 da mesma agremiação nas UFs com até 20 deputados federais e até 2 nas demais.'
      : 'Mapa próprio: onde o nº de distritos estaduais é múltiplo do de federais, cada distrito federal se divide em estaduais (GT do TSE, 2019, critério 4(e)) e a coluna "Unidades fora dele" confere, pela aba de composição, que nenhuma unidade está em outro federal; nos demais estados, mapa independente.')]);
  aba.add([`${s.nome}: ${Math.round((op.pctDistrital != null ? op.pctDistrital : 0.5) * 100)}% das vagas em distritos de ${algumFed ? 'um ou mais eleitos' : 'um eleito'} (${op.regra === 'candidato' ? 'o candidato mais votado do distrito; quem é o mais votado em mais de um fica com aquele em que teve a maior proporção dos votos, e o outro distrito vai ao seguinte — a coluna do concorrente mostra quem o eleito precisava superar' : op.regra === 'partidoNominal' ? 'a agremiação com mais votos NOMINAIS leva (a legenda não conta), com o seu candidato mais votado ali' : 'a agremiação mais votada leva, com o seu candidato mais votado ali'}), o resto pela lista, ${op.modelo === 'compensatorio' ? 'compensatório' : 'paralelo'}. Tamanho dos distritos: ${pop ? 'população (Censo 2022)' : 'eleitores aptos'}.${op.votoLiquido ? ' Lista com o voto partidário LÍQUIDO: votos da agremiação menos os votos que elegeram os seus vencedores de distrito (os de cada um no seu distrito).' : ''}`]);
  const DC = smAbaRef('Distritos (composição)');
  for (const uf of ufs) {
    const d = dados[uf], sim = res.porUf[uf], x = (op.porUf || {})[uf];
    if (!sim || !x) continue;
    const dist = sim.distritos || [];
    aba.add([]);
    const r0 = aba.prox();
    const k = dist.length, soma = x.desenho.distritos.reduce((t, q) => t + q.aptos, 0);
    // Nº de distritos = vagas × fração, arredondado (metade para cima: 9 → 5) ou
    // só a parte inteira (9 → 4), por fórmula; confere com os desenhados.
    const fr = op.pctDistrital != null ? op.pctDistrital : 0.5, baixo = op.arred === 'baixo';
    const nArr = (v, c) => (baixo ? { f: `INT(${c}*${fr}+1E-9)`, v: Math.floor(v * fr + 1e-9) } : { f: `ROUND(${c}*${fr},0)`, v: Math.round(v * fr) });
    // Estaduais e distritais: a bancada federal pelo art. 27 da CF (L), os
    // distritos federais (N) e, no encaixe, quantos estaduais por federal (P);
    // nos distritos federais (Minuta, leitura b), as cadeiras distritais (P).
    const me = x.modoEstadual, est = me === 'ani' || me === 'ind' || me === 'fed';
    const vF = x.vagasFederais, kFed = nArr(vF || 0, `L${r0}`);
    const kForm = me === 'fed' ? { f: `N${r0}`, v: kFed.v } : nArr(d.vagas, `C${r0}`);
    aba.add([uf.toUpperCase(), est ? 'Vagas na Assembleia' : 'Vagas', d.vagas, me === 'fed' ? 'Distritos = os distritos federais (N)' : `Distritos = ${baixo ? 'INT' : 'ARRED'}(vagas × ${fr})`, kForm,
      `Alvo (${pop ? 'habitantes' : 'eleitores'}) = soma ÷ distritos`, { f: k ? `SUMIF(${DC}!A:A,A${r0},${DC}!G:G)/E${r0}` : '0', v: k ? soma / k : 0 },
      'Distritos desenhados (simulador)', k, smFConfere(`E${r0}`, `I${r0}`, kForm.v, k),
      ...(est ? ['Deputados federais (CF, art. 27)', uf === 'df' ? 8 : { f: `IF(C${r0}<=36,ROUND(C${r0}/3,0),C${r0}-24)`, v: vF },
        `Distritos federais = ${baixo ? 'INT' : 'ARRED'}(federais × ${fr})`, kFed,
        ...(me === 'ani' ? ['Estaduais por distrito federal = E ÷ N', { f: `E${r0}/N${r0}`, v: x.kE / x.kF }]
          : me === 'fed' ? ['Cadeiras distritais da Assembleia', nArr(d.vagas, `C${r0}`), 'Até da mesma agremiação por distrito (art. 10, II)', { f: `IF(L${r0}<=20,3,2)`, v: x.capPartido }]
          : ['Encaixe', x.encaixeFalhou ? `mapa próprio: o encaixe não coube (${x.encaixeFalhou}) — ler os locais de votação` : `mapa próprio: ${x.kE} não é múltiplo de ${x.kF}`])] : [])]);
    if (x.cobertura != null && x.cobertura < 0.95) aba.add([`ATENÇÃO: os votos por município e zona do TSE (dados abertos) cobrem só ${Math.round(x.cobertura * 1000) / 10}% dos válidos deste cargo em ${uf.toUpperCase()} — o arquivo publicado não traz os votos dos candidatos; os distritos não têm com o que eleger e as conferências abaixo divergem por isso.${x.retotalizando ? ' O estado está em retotalização, provável causa do arquivo incompleto.' : ''}`]);
    if (!k) { smBlocoLista(aba, d, sim, op, []); continue; }
    const rc = aba.prox();
    const porCand = op.regra === 'candidato', multi = me === 'fed', ani = me === 'ani';
    const rD1p = aba.prox() + 1, rD2p = rD1p + k - 1;   // as linhas dos distritos (para as fórmulas de coluna)
    aba.add(['Distrito', `Tamanho (soma da composição)`, 'Tamanho (simulador)', 'Confere', 'Desvio = tamanho ÷ alvo − 1', 'Votos válidos no distrito',
      porCand ? 'Agremiação do eleito' : '1ª agremiação', 'Votos', porCand ? 'Outra agremiação mais votada' : '2ª agremiação', 'Votos',
      porCand ? (multi ? 'Confere (o último eleito tem mais votos que o concorrente)' : 'Confere (o eleito tem mais votos que o concorrente)') : 'Confere (a 1ª tem mais)',
      multi ? 'Eleitos' : 'Eleito', 'Partido', multi ? 'Votos do último eleito' : 'Votos do eleito', `Tolerância ${tolTxt}`,
      ...(porCand ? [multi ? 'Concorrente: o mais votado ali fora os eleitos, quem levou outro distrito e quem o limite da agremiação barrou' : 'Concorrente: o mais votado ali fora o eleito e quem levou outro distrito', 'Partido', 'Votos',
        multi ? 'Mais votados que o último eleito ali, mas eleitos em outro distrito ou barrados pelo limite da agremiação' : 'Mais votados que o eleito ali, mas eleitos em outro distrito'] : []),
      ...(ani ? ['Federal que o contém', 'Unidades fora dele (composição)', 'Confere (encaixado)'] : []),
      ...(multi ? ['Cota = tamanho ÷ soma × cadeiras', 'Parte inteira (mín. 1)', 'Resto', 'Posição do resto', 'Cadeiras (fórmula)', 'Cadeiras (simulador)', 'Confere'] : [])]);
    void rc;
    const des = new Map(x.desenho.distritos.map(q => [q.id, q]));
    // posição do resto de cada distrito (maiores restos; empate: o que vem antes)
    const posResto = new Map();
    if (multi) {
      const rs = x.desenho.distritos.map(z => { const c = z.aptos / soma * x.kE; return c - Math.floor(c + 1e-9); });
      x.desenho.distritos.forEach((z, j) => posResto.set(z.id, rs.filter(v => v > rs[j]).length + rs.slice(0, j + 1).filter(v => v === rs[j]).length));
    }
    const fedDe = new Map();
    if (ani && x.desenho.aninhado) for (const f of x.desenho.aninhado.federais) for (const u of f.unidades) fedDe.set(u, f.id);
    const rD1 = aba.prox();
    for (const dt of dist) {
      const r = aba.prox(), w = dt.vencedor, sg = dt.segundo;
      aba.linhaDist[uf + '|' + dt.id] = r;
      const q = des.get(dt.id) || { aptos: dt.aptos };
      const v1 = w ? w.agrVotos : 0, v2 = sg ? sg.votos : 0;
      aba.add([dt.id, { f: `SUMIFS(${DC}!G:G,${DC}!A:A,${smAbs(0, r0)},${DC}!B:B,A${r})`, v: q.aptos }, dt.aptos, { f: `IF(ABS(B${r}-C${r})<0.5,"${SM_SIM}","${SM_NAO}")`, v: smPerto(q.aptos, dt.aptos, 0.5) ? SM_SIM : SM_NAO },
        { f: `B${r}/${smAbs(6, r0)}-1`, v: q.aptos / (soma / k) - 1 }, dt.validos, w ? w.agrNome : '—', v1, sg ? sg.nome : '—', v2,
        // regra 'candidato': o eleito contra o concorrente (coluna R); sem
        // concorrente (ninguém mais votou ali), conta zero
        porCand ? { f: `IF(N${r}>=R${r},"${SM_SIM}","${SM_NAO}")`, v: !w || (multi ? Math.min(...dt.vencedores.map(y => y.votos)) : w.votos) >= (dt.concorrente ? dt.concorrente.votos : 0) ? SM_SIM : SM_NAO }
          : { f: `IF(H${r}>=J${r},"${SM_SIM}","${SM_NAO}")`, v: v1 >= v2 ? SM_SIM : SM_NAO },
        ...(multi
          ? [(dt.vencedores || []).map(y => y.nome + (y.semCadeira ? ' (sem cadeira: excedente)' : '')).join('; ') || '—', (dt.vencedores || []).map(y => y.partido).join('; '),
            (dt.vencedores || []).length ? Math.min(...dt.vencedores.map(y => y.votos)) : 0]
          : [w ? w.nome + (dt.semCadeira ? ' (sem cadeira: excedente)' : '') : '—', w ? w.partido : '', w ? w.votos : 0]),
        { f: temExc ? `IF(ABS(E${r})<=${tol.pct}+1E-9,"dentro",IF(ABS(E${r})<=${tol.exc}+1E-9,"exceção","fora"))` : `IF(ABS(E${r})<=${tol.pct}+1E-9,"dentro","fora")`, v: classe(q.aptos / (soma / k) - 1) },
        ...(porCand ? [dt.concorrente ? dt.concorrente.nome : '—', dt.concorrente ? dt.concorrente.partido : '', dt.concorrente ? dt.concorrente.votos : 0,
          (dt.acima || []).map(c => `${c.nome} (${c.partido}, ${c.votos} votos; ${c.distrito != null ? `eleito no distrito ${c.distrito}` : c.motivo})`).join('; ')] : (ani || multi ? ['', '', '', ''] : [])),
        // encaixe: o federal que contém o distrito, e as unidades da composição que estão em outro federal (tem de dar 0)
        ...(ani ? (() => { const fora = x.desenho.distritos.find(q => q.id === dt.id); const pai = fora && fora.pai;
          const nFora = fora ? fora.unidades.filter(u => fedDe.get(u) !== pai).length : 0;
          return [pai, { f: `COUNTIFS(${DC}!A:A,${smAbs(0, r0)},${DC}!B:B,A${r},${DC}!H:H,"<>"&T${r})`, v: nFora }, { f: `IF(U${r}=0,"${SM_SIM}","${SM_NAO}")`, v: nFora === 0 ? SM_SIM : SM_NAO }]; })() : []),
        // cadeiras do distrito (maiores restos), por fórmula contra o simulador
        ...(multi ? (() => { const qd = x.desenho.distritos.find(z => z.id === dt.id) || q, cota = qd.aptos / soma * x.kE, pi = Math.max(1, Math.floor(cota + 1e-9));
          return [{ f: `B${r}/SUM(${smAbs(1, rD1p)}:${smAbs(1, rD2p)})*${smAbs(15, r0)}`, v: cota }, { f: `MAX(1,INT(T${r}+1E-9))`, v: pi }, { f: `T${r}-INT(T${r}+1E-9)`, v: cota - Math.floor(cota + 1e-9) },
            // posição do resto: SUMPRODUCT compara número com número (COUNTIF com ">"&V passa V para texto e erra — medido no CE)
            { f: `SUMPRODUCT((${smAbs(21, rD1p)}:${smAbs(21, rD2p)}>V${r})*1)+SUMPRODUCT((${smAbs(21, rD1p)}:V${r}=V${r})*1)`, v: posResto.get(dt.id) },
            { f: `U${r}+IF(W${r}<=${smAbs(15, r0)}-SUM(${smAbs(20, rD1p)}:${smAbs(20, rD2p)}),1,0)`, v: dt.cadeiras }, dt.cadeiras, smFConfere(`X${r}`, `Y${r}`, dt.cadeiras, dt.cadeiras)]; })() : [])]);
    }
    // o estado na tolerância: fórmula contra o simulador (pelo desvio que o simulador calculou)
    const rD2 = aba.prox() - 1, faixa = `O${rD1}:O${rD2}`, rt = aba.prox();
    const cnt = c => dist.filter(dt => classe(dt.desvio) === c).length, cntF = c => x.desenho.distritos.filter(q => classe(q.aptos / (soma / k) - 1) === c).length;
    const perm = temExc ? Math.max(tol.excN || 0, Math.floor(k * (tol.excFrac || 0) + 1e-9)) : 0;
    const okF = !cntF('fora') && cntF('exceção') <= perm, okS = !cnt('fora') && cnt('exceção') <= perm;
    aba.add([`Tolerância ${tolTxt}`, 'Dentro', { f: `COUNTIF(${faixa},"dentro")`, v: cntF('dentro') }, 'Exceção', { f: `COUNTIF(${faixa},"exceção")`, v: cntF('exceção') }, 'Fora', { f: `COUNTIF(${faixa},"fora")`, v: cntF('fora') },
      'Exceções permitidas', { f: temExc ? `MAX(${tol.excN || 0},INT(${tol.excFrac || 0}*${smAbs(4, r0)}+1E-9))` : '0', v: perm },
      'Estado na tolerância (fórmula)', { f: `IF(AND(G${rt}=0,E${rt}<=I${rt}),"sim","não")`, v: okF ? 'sim' : 'não' }, 'Simulador', okS ? 'sim' : 'não', smFConfere(`K${rt}`, `M${rt}`, okF ? 'sim' : 'não', okS ? 'sim' : 'não')]);
    const primeiros = sim.eleitos.filter(e => e.fase !== 'lista');
    let dl = d;
    if (op.votoLiquido) {
      // voto partidário líquido: votos da agremiação (aba Votos) − votos dos seus vencedores, cada um no seu distrito
      // (coluna N da tabela dos distritos acima; com vários eleitos por distrito, o valor do simulador)
      const usado = {}, refs = {};
      for (const e of primeiros) {
        usado[e.agr] = (usado[e.agr] || 0) + (e.votosDistrito || 0);
        const rr = aba.linhaDist[uf + '|' + e.distrito];
        (refs[e.agr] = refs[e.agr] || []).push(!multi && rr ? `N${rr}` : String(e.votosDistrito || 0));
      }
      aba.add([]);
      aba.add(['Voto partidário líquido = votos da agremiação − votos que elegeram os seus vencedores de distrito (os de cada um no seu distrito)']);
      aba.add(['Agremiação (id)', 'Agremiação', 'Votos (aba Votos)', 'Votos dos seus vencedores nos distritos', 'Voto líquido (fórmula)', 'Voto líquido (simulador)', 'Confere']);
      for (const a of d.agrs) {
        const r = aba.prox(), liq = a.votos - (usado[a.id] || 0), simLiq = sim.liquido && sim.liquido[a.id] != null ? sim.liquido[a.id] : a.votos;
        const vr = votosLinha && votosLinha[uf + '|' + a.id];
        aba.add([a.id, smSiglas(a), vr ? { f: `${V}!$G$${vr}`, v: a.votos } : a.votos,
          refs[a.id] ? { f: refs[a.id].join('+'), v: usado[a.id] } : 0,
          { f: `C${r}-D${r}`, v: liq }, simLiq, smFConfere(`E${r}`, `F${r}`, liq, simLiq)]);
      }
      dl = Object.assign({}, d, { agrs: d.agrs.map(a => (usado[a.id] ? Object.assign({}, a, { votos: a.votos - usado[a.id] }) : a)) });
    }
    smBlocoLista(aba, dl, sim, op, primeiros);
  }
  return aba;
}

/** Composição dos distritos: cada unidade (município, zona eleitoral ou local de votação) e o seu peso. */
function smAbaComposicao(s, ufs) {
  const aba = smNovaAba('Distritos (composição)', [5, 8, 22, 30, 8, 8, 14]);
  const pop = (s.op || {}).base === 'populacao';
  const temFed = ufs.some(uf => ((((s.op || {}).porUf || {})[uf] || {}).desenho || {}).aninhado);
  aba.add(['UF', 'Distrito', 'Unidade', 'Município', 'Zona', 'Local', pop ? 'Habitantes (Censo 2022)' : 'Eleitores aptos', ...(temFed ? ['Distrito federal (encaixe)'] : [])]);
  for (const uf of ufs) {
    const x = ((s.op || {}).porUf || {})[uf];
    if (!x || !x.desenho || !x.desenho.distritos) continue;
    const U = new Map(x.base.unidades.map(u => [u.id, u]));
    // no encaixe, o distrito federal de cada unidade (do desenho federal, independente do estadual)
    const fedDe = new Map();
    if (x.desenho.aninhado) for (const f of x.desenho.aninhado.federais) for (const u of f.unidades) fedDe.set(u, f.id);
    for (const dt of x.desenho.distritos) for (const id of dt.unidades) {
      const u = U.get(id) || {};
      const tipo = id.startsWith('z:') ? 'zona eleitoral' : id.startsWith('l:') ? 'local de votação' : 'município';
      aba.add([uf.toUpperCase(), dt.id, tipo, (u.nome || '').split(' · ')[0], id.startsWith('m:') ? (u.zonas || []).join(', ') : (u.zonas || [])[0] || '', u.loc != null ? u.loc : '', u.aptos || 0,
        ...(temFed ? [fedDe.has(id) ? fedDe.get(id) : ''] : [])]);
    }
  }
  return aba;
}

// ------------------------------------------------------------ estratégia (o partido em foco)
const smNucleo = () => (typeof snMargem === 'function' ? { snMargem, snProporcional, snDhondt } : require('./sistemas-nucleo.js'));
/** Os dados com x votos a mais (ou a menos) na legenda da agremiação — como em snMargem. */
function smMuda(d, id, x, sigla) {
  return Object.assign({}, d, { validos: d.validos + x, agrs: d.agrs.map(a => (a.id !== id ? a : Object.assign({}, a, { votos: a.votos + x, legenda: (a.legenda || 0) + x },
    a.porSigla && a.porSigla[sigla] != null ? { porSigla: Object.assign({}, a.porSigla, { [sigla]: a.porSigla[sigla] + x }) } : {}))) });
}

/**
 * Próxima cadeira do partido em foco, estado a estado.
 * Cota do projeto (maiores médias sobre todas as vagas): por fórmula, numa tabela de quocientes por estado
 * (a agremiação em foco na 1ª linha, as outras embaixo): cota = quocientes dela entre os N maiores;
 * faltam = (o (N − cota)-ésimo maior quociente das outras) × divisor da próxima − votos, +1;
 * folga = votos − (o (N − cota + 1)-ésimo maior das outras) × divisor da última, −1. Contra o simulador (snMargem).
 * Regra atual: sem conta fechada (o QE e as sobras mudam juntos) — a prova pelo simulador: com os votos que faltam, a cadeira vem; com um a menos, não.
 */
function smAbaProxima(dados, ufs, sistemas, votosLinha, partido) {
  const N = smNucleo();
  const dist = sistemas.find(s => s.tipo === 'distrital'), prop = sistemas.find(s => s.tipo === 'proporcional');
  const opD = (dist && dist.op) || {}, opP = (prop && prop.op) || {}, sl = opD.divisor === 'sl', lim = opD.limiar || 0;
  const div = k => (sl ? 2 * k - 1 : k), divF = e => (sl ? `(2*(${e})-1)` : `(${e})`);
  const aba = smNovaAba(`Próxima cadeira (${partido})`.slice(0, 31), [5, 6, 16, 12, 8, 11, 11, 8, 11, 11, 9, 9, 9, 9, 11, 11, 11, 11, 9, 11, 11, 9]);
  const V = smAbaRef('Votos');
  aba.add([`Próxima cadeira do ${partido}, estado a estado: os votos a mais para a próxima cadeira ("faltam") e os que pode perder sem perder a última ("folga"), com os votos dos outros parados; os votos entram ou saem como voto no partido.`]);
  aba.add([`Cota do projeto: maiores médias (${sl ? 'Sainte-Laguë: ÷ 1, 3, 5…' : "D'Hondt: ÷ 1, 2, 3…"}) sobre todas as vagas do estado, antes dos cortes do excedente — por fórmula, nas tabelas de quocientes abaixo (quociente = votos ÷ divisor − ordem × 0,000000001, o desempate do simulador).`]);
  aba.add(['Regra atual (quociente eleitoral e sobras): sem conta fechada, porque o quociente e as sobras mudam junto com os votos — a planilha traz o valor do simulador e a prova: com os votos que faltam, a cadeira vem (às vezes mais de uma); com um a menos, não (e o mesmo para a folga). Voto só no partido não elege quem não tem candidato com 10% do quociente (1ª fase) ou 20% (sobras): nesses estados, só a 3ª fase dá a cadeira, e o número fica alto.']);
  const cab = ['UF', 'Vagas', 'Agremiação', 'Votos', 'Cota (fórmula)', 'Faltam p/ +1 (fórmula)', 'Folga (fórmula)', 'Cota (simulador)', 'Faltam (simulador)', 'Folga (simulador)', 'Confere', 'Confere', 'Confere',
    'Regra atual: cadeiras', 'Faltam p/ +1', 'Folga', 'Cadeiras com + faltam', 'Com + faltam − 1', 'Confere', 'Cadeiras com − folga', 'Com − (folga + 1)', 'Confere'];
  const rCab = aba.prox();
  aba.add(cab);
  const est = ufs.map(uf => {
    const d = dados[uf], total = d.agrs.reduce((t, a) => t + a.votos, 0);
    const consid = d.agrs.filter(a => a.votos > 0 && a.votos >= lim * total);
    const fa = d.agrs.find(a => (a.siglas || []).includes(partido));
    return { uf, d, fa: fa && consid.includes(fa) ? fa : null, semChapa: !fa, consid, outros: fa ? consid.filter(a => a !== fa) : [] };
  });
  // posições das tabelas de quocientes (embaixo da tabela principal)
  let rB = rCab + ufs.length + 3;
  for (const e of est) {
    if (!e.fa || !e.outros.length) continue;
    e.rT = rB; e.rF = rB + 2; e.rO1 = rB + 3; e.rO2 = rB + 2 + e.outros.length;
    rB = e.rO2 + 2;
  }
  const cota = (d, id) => dd => N.snDhondt(Object.fromEntries(dd.agrs.map(g => [g.id, g.votos])), dd.vagas, {}, lim, null, opD.divisor || 'dhondt', dd.validos)[id] || 0;
  for (const e of est) {
    const r = aba.prox(), d = e.d;
    if (!e.fa || !e.outros.length) { aba.add([e.uf.toUpperCase(), d.vagas, e.semChapa ? `sem chapa do ${partido}` : 'sem cota possível']); continue; }
    const fa = e.fa, c0 = 3, c1 = 3 + d.vagas;   // colunas dos quocientes (÷ 1 … ÷ vagas+1)
    const faixa = (ra, rb) => `${smAbs(c0, ra)}:${smAbs(c1, rb)}`;
    const focoR = faixa(e.rF, e.rF), outrosR = faixa(e.rO1, e.rO2), todosR = faixa(e.rF, e.rO2);
    // valores (os mesmos das fórmulas)
    const ord = a => e.consid.indexOf(a);
    const q = (a, k) => a.votos / div(k) - ord(a) * 1e-9;
    const outrosQ = e.outros.flatMap(a => Array.from({ length: d.vagas + 1 }, (_, i) => q(a, i + 1))).sort((x, y) => y - x);
    const todosQ = outrosQ.concat(Array.from({ length: d.vagas + 1 }, (_, i) => q(fa, i + 1))).sort((x, y) => y - x);
    const corte = todosQ[d.vagas - 1];
    const s = Array.from({ length: d.vagas + 1 }, (_, i) => q(fa, i + 1)).filter(x => x >= corte).length;
    const faltaV = d.vagas - s < 1 ? '—' : Math.floor((outrosQ[d.vagas - s - 1] + ord(fa) * 1e-9) * div(s + 1)) + 1 - fa.votos;
    const folgaV = s < 1 ? '—' : fa.votos - Math.floor((outrosQ[d.vagas - s] + ord(fa) * 1e-9) * div(s)) - 1;
    const mc = N.snMargem(d, fa.id, cota(d, fa.id), partido);
    const dele = x => (fa.siglas || [partido]).includes(x.cand.partido);
    const atual = dd => N.snProporcional(dd, opP).eleitos.filter(dele).length;
    const ma = N.snMargem(d, fa.id, atual, partido);
    const prova = x => atual(smMuda(d, fa.id, x, partido));
    const pF1 = ma.falta != null ? prova(ma.falta) : '—', pF0 = ma.falta != null ? prova(ma.falta - 1) : '—';
    const pG1 = ma.folga != null ? prova(-ma.folga) : '—', pG0 = ma.folga != null ? prova(-(ma.folga + 1)) : '—';
    const nv = x => (x == null ? '—' : x);
    aba.add([e.uf.toUpperCase(), d.vagas, smSiglas(fa), { f: smAbs(2, e.rF), v: fa.votos },
      { f: `SUMPRODUCT((${focoR}>=LARGE(${todosR},B${r}))*1)`, v: s },
      { f: `IF(B${r}-E${r}<1,"—",INT((LARGE(${outrosR},B${r}-E${r})+${smAbs(1, e.rF)}*1E-9)*${divF(`E${r}+1`)})+1-D${r})`, v: faltaV },
      { f: `IF(E${r}<1,"—",D${r}-INT((LARGE(${outrosR},B${r}-E${r}+1)+${smAbs(1, e.rF)}*1E-9)*${divF(`E${r}`)})-1)`, v: folgaV },
      mc.cadeiras, nv(mc.falta), nv(mc.folga),
      smFConfere(`E${r}`, `H${r}`, s, mc.cadeiras), smFConfere(`F${r}`, `I${r}`, faltaV, nv(mc.falta)), smFConfere(`G${r}`, `J${r}`, folgaV, nv(mc.folga)),
      ma.cadeiras, nv(ma.falta), nv(ma.folga), pF1, pF0,
      ma.falta == null ? '—' : { f: `IF(AND(Q${r}>N${r},R${r}=N${r}),"${SM_SIM}","${SM_NAO}")`, v: pF1 > ma.cadeiras && pF0 === ma.cadeiras ? SM_SIM : SM_NAO },
      pG1, pG0,
      ma.folga == null ? '—' : { f: `IF(AND(T${r}>=N${r},U${r}<N${r}),"${SM_SIM}","${SM_NAO}")`, v: pG1 >= ma.cadeiras && pG0 < ma.cadeiras ? SM_SIM : SM_NAO }]);
  }
  aba.add([]);
  aba.add([`Tabelas de quocientes da cota (por estado): a agremiação do ${partido} na 1ª linha, as outras embaixo; votos da aba Votos.`]);
  for (const e of est) {
    if (!e.rT) continue;
    while (aba.prox() < e.rT) aba.add([]);
    const d = e.d;
    aba.add([e.uf.toUpperCase(), `${d.vagas} vagas`]);
    aba.add(['Agremiação', 'Ordem (desempate)', 'Votos', ...Array.from({ length: d.vagas + 1 }, (_, i) => '÷ ' + div(i + 1))]);
    for (const a of [e.fa, ...e.outros]) {
      const r = aba.prox(), o = e.consid.indexOf(a), vr = votosLinha[e.uf + '|' + a.id];
      aba.add([smSiglas(a), o, vr ? { f: `${V}!$G$${vr}`, v: a.votos } : a.votos,
        ...Array.from({ length: d.vagas + 1 }, (_, i) => ({ f: `$C${r}/${div(i + 1)}-$B${r}*1E-9`, v: a.votos / div(i + 1) - o * 1e-9 }))]);
    }
  }
  return aba;
}

/** Distritos ao alcance do partido em foco: os ganhos e os em 2º lugar, com a diferença por fórmula (votos da aba do distrital). */
function smAbaAlcance(res, dados, ufs, abaDist, partido) {
  const sd = res.sims.find(s => s.tipo === 'distrital');
  const aba = smNovaAba(`Distritos ao alcance (${partido})`.slice(0, 31), [5, 8, 7, 18, 12, 18, 12, 12, 12, 10, 12, 9, 16]);
  const D = smAbaRef(abaDist.nome);
  aba.add([`Distritos em que o ${partido} é o 1º ou o 2º colocado (votação de cada agremiação no distrito: nominais + legenda). Diferença = votos do 1º − votos do 2º, das colunas da aba "${abaDist.nome}".`]);
  aba.add(['UF', 'Distrito', 'Posição', '1º', 'Votos do 1º', '2º', 'Votos do 2º', 'Válidos no distrito', 'Diferença (fórmula)', 'Pontos (fórmula)', 'Diferença (simulador)', 'Confere', 'O 1º passou da cota no estado?']);
  const linhas = [];
  for (const uf of ufs) {
    const x = sd && sd.porUf[uf], fa = dados[uf].agrs.find(a => (a.siglas || []).includes(partido));
    if (!x || !fa) continue;
    for (const dt of x.distritos || []) {
      const w = dt.vencedor, s2 = dt.segundo, rr = abaDist.linhaDist && abaDist.linhaDist[uf + '|' + dt.id];
      if (!w || !s2 || !rr || (dt.cadeiras || 1) > 1 || (w.agr !== fa.id && s2.agr !== fa.id)) continue;
      linhas.push({ uf, dt, w, s2, rr, pos: w.agr === fa.id ? '1º' : '2º', exc: ((x.excedentes || {})[w.agr] || 0) > 0, pct: (w.agrVotos - s2.votos) / (dt.validos || 1) });
    }
  }
  linhas.sort((a, b) => a.pos.localeCompare(b.pos) || a.pct - b.pct);
  for (const l of linhas) {
    const r = aba.prox(), m = l.w.agrVotos - l.s2.votos;
    aba.add([l.uf.toUpperCase(), l.dt.id, l.pos, l.w.agrNome, { f: `${D}!$H$${l.rr}`, v: l.w.agrVotos }, l.s2.nome, { f: `${D}!$J$${l.rr}`, v: l.s2.votos }, { f: `${D}!$F$${l.rr}`, v: l.dt.validos },
      { f: `E${r}-G${r}`, v: m }, { f: `IF(H${r}>0,I${r}/H${r}*100,0)`, v: l.dt.validos ? m / l.dt.validos * 100 : 0 }, m, smFConfere(`I${r}`, `K${r}`, m, m), l.pos === '2º' && l.exc ? 'sim' : '']);
  }
  if (!linhas.length) aba.add([`O ${partido} não é 1º nem 2º em nenhum distrito.`]);
  return aba;
}

/** Federação hipotética (resumo): os votos das duas agremiações somados por fórmula, e as cadeiras separados × federados. */
function smAbaFederacao(dados, ufs, res, votosLinha, est) {
  const { partido: a, parceiro: b, dados2, res2 } = est;
  const aba = smNovaAba(`Federação ${a}+${b}`.slice(0, 31), [5, 18, 12, 18, 12, 12, 12, 9]);
  const V = smAbaRef('Votos'), E = smAbaRef('Eleitos');
  aba.add([`Federação hipotética ${a} + ${b}: em cada estado, as duas agremiações numa só (votos, legenda e candidatos somados). As contas completas do cenário federado estão no memorial à parte (botão "Memorial do cenário federado", no bloco da federação).`]);
  aba.add(['UF', `Agremiação do ${a}`, 'Votos', `Agremiação do ${b}`, 'Votos', 'Soma (fórmula)', 'Federada (simulador)', 'Confere']);
  for (const uf of ufs) {
    const d = dados[uf], x = d.agrs.find(g => (g.siglas || []).includes(a)), y = d.agrs.find(g => (g.siglas || []).includes(b));
    if (!x || !y || x === y) continue;
    const j = dados2[uf].agrs.find(g => (g.siglas || []).includes(a)), r = aba.prox();
    const ref = g => { const vr = votosLinha[uf + '|' + g.id]; return vr ? { f: `${V}!$G$${vr}`, v: g.votos } : g.votos; };
    aba.add([uf.toUpperCase(), smSiglas(x), ref(x), smSiglas(y), ref(y), { f: `C${r}+E${r}`, v: x.votos + y.votos }, j ? j.votos : 0, smFConfere(`F${r}`, `G${r}`, x.votos + y.votos, j ? j.votos : 0)]);
  }
  aba.add([]);
  aba.add(['Cadeiras nos estados da comparação nacional: separados (contados na aba Eleitos) × federados (simulador, cenário federado).']);
  aba.add(['Sistema', `${a} separado`, `${b} separado`, 'Soma', `${a} federado`, `${b} federado`, 'Soma', 'Ganho da soma']);
  for (const s0 of res.sims) {
    const s1 = res2.sims.find(x => x.id === s0.id), r = aba.prox();
    const cnt = sg => ({ f: `COUNTIFS(${E}!A:A,${smTxt(s0.nome)},${E}!D:D,${smTxt(sg)},${E}!H:H,"sim")`, v: s0.porPartido[sg] || 0 });
    const x1 = (s1 && s1.porPartido[a]) || 0, y1 = (s1 && s1.porPartido[b]) || 0;
    aba.add([s0.nome, cnt(a), cnt(b), { f: `B${r}+C${r}`, v: (s0.porPartido[a] || 0) + (s0.porPartido[b] || 0) }, x1, y1, { f: `E${r}+F${r}`, v: x1 + y1 }, { f: `G${r}-D${r}`, v: x1 + y1 - (s0.porPartido[a] || 0) - (s0.porPartido[b] || 0) }]);
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
  let abaDist = null;
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
    else if (s.tipo === 'misto') abas.push(smAbaDistritaoMisto(sx, dados, ufs, s, votos.linhaDe));
    else if (s.tipo === 'distrital') { abaDist = smAbaDistrital(sx, dados, ufs, s, votos.linhaDe); abas.push(abaDist); abas.push(smAbaComposicao(sx, ufs)); }
  }
  abas.push(smAbaEleitos(res, ufs));
  const banc = smAbaBancadas(res, ordem);
  abas.push(banc.aba);
  abas.push(smAbaIndicadores(res, ind, ordem, banc));
  // estratégia do partido em foco (ent.estrategia = { partido, parceiro, dados2, res2 })
  const est = ent.estrategia;
  if (est && est.partido) {
    abas.push(smAbaProxima(dados, ufs, sistemas, votos.linhaDe, est.partido));
    if (abaDist) abas.push(smAbaAlcance(res, dados, ufs, abaDist, est.partido));
    if (est.parceiro && est.dados2 && est.res2) abas.push(smAbaFederacao(dados, ufs, res, votos.linhaDe, est));
  }
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
    'Distrital: o número de distritos de cada estado sai por fórmula (vagas × fração, arredondado ou só a parte inteira, conforme a regra). O tamanho de cada distrito é a soma das suas unidades na aba "Distritos (composição)". Os votos por distrito vêm dos votos por município e zona (e, onde afinado, por local de votação) do TSE. A tolerância de tamanho é conferida distrito a distrito (dentro, exceção, fora) e estado a estado.',
    ...(ent.estrategia && ent.estrategia.partido ? [
      `Estratégia (partido em foco: ${ent.estrategia.partido}): "Próxima cadeira" refaz por fórmula a cota do projeto e os votos que faltam e a folga; na regra atual traz a prova pelo simulador. "Distritos ao alcance" tira a diferença dos votos da aba do distrital.`
      + (ent.estrategia.parceiro ? ` A aba da federação soma os votos das duas agremiações e compara as cadeiras; as contas completas do cenário federado estão no memorial à parte.` : '')] : []),
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
