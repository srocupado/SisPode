// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';

// ── RELATÓRIO EM DOCUMENTO: LEGISLATURA OU PERÍODO, ANO A ANO ───────────────
// A mesma conta do relatório de aderência (aderCalcular) num documento: resumo,
// e para cada ano os membros da bancada e as votações, com gráficos. Dois usos:
//  - "Relatório da legislatura": cada ano da legislatura em curso;
//  - PDF/Word do relatório comum: o período pedido, partido por ano quando
//    atravessa anos (num ano só, sem o resumo repetido).
// Sai em PDF (janela de impressão, como o PDF do "Como votou") e em Word (docx).
// Identidade visual: a do PDF "Como votou" (CSS_PDF_VOTOS) — título centrado com a
// logo, filete verde, caixas, tabelas e selos de voto.
//
// Aderência sobre os votos Sim e Não (aderPct, aderencia.js): ausência,
// abstenção, obstrução e Art. 17 ficam fora da conta. Desde 24/11/2026 os
// documentos mostram essas contagens (decisão da Liderança), sem mudar a conta.
// Layout: o do relatório do PLP 299/2026 (ver "LAYOUT DOS DOCUMENTOS").

const btnLegislaturaEl = document.getElementById('btnLegislatura');
const LEG_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LEG_COR = { a: CV_COR.aderente, d: CV_COR.divergente };
const legDeputados = L => new Set(L.anos.flatMap(a => a.deps.map(d => d.id))).size;

const legEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const legFmt = n => n.toLocaleString('pt-BR');
const legPct = (n, c = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%';
const legPctOu = (n, c = 1) => n == null ? '—' : legPct(n, c);   // sem voto Sim ou Não
// parte ÷ total em %, ou "—" quando o total é 0 (ano ou período só de ausências): 0 ÷ 0 saía "NaN%" nos documentos
const legTaxa = (parte, total, c = 1) => total > 0 ? legPct(100 * parte / total, c) : '—';
const legDataBR = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const legNomePartido = sigla => sigla === 'PODE' ? 'Podemos' : sigla;

/**
 * Os anos da legislatura de `hojeIso`, cada um com seu período: o primeiro
 * começa na posse (1º/fev), o último termina em 31/jan do ano seguinte ao 4º, e
 * nada passa de hoje.
 */
function aderAnosDaLegislatura(hojeIso) {
  const leg = aderLegislaturaDaData(hojeIso);
  const a0 = 1795 + 4 * leg;
  const anos = [];
  for (let a = a0; a <= a0 + 4; a++) {
    const ini = a === a0 ? a + '-02-01' : a + '-01-01';
    let fim = a === a0 + 4 ? a + '-01-31' : a + '-12-31';
    if (ini > hojeIso) break;
    if (fim > hojeIso) fim = hojeIso;
    anos.push({ ano: String(a), ini, fim });
  }
  return { leg, anos };
}

/** Descrição da votação sem o placar ("Sim: 300; Não: 100…"), que a barra já mostra. */
function legResumoDesc(s) {
  return String(s || '').replace(/\s*Sim:\s*\d.*$/i, '').trim();
}

/** Classe do voto para as contagens do documento: sim, nao, out (abstenção, obstrução, Art. 17) ou aus. */
function legClasseVoto(tipo) {
  const t = votoClass(tipo);
  return t === 'sim' ? 'sim' : t === 'nao' ? 'nao' : t === 'ausente' ? 'aus' : 'out';
}
/** Rótulo curto do voto no quadro deputado × votação. */
function legRotuloVoto(tipo) {
  const t = votoClass(tipo);
  return { sim: 'Sim', nao: 'Não', abstencao: 'Abst.', obstrucao: 'Obstr.', art17: 'Art. 17' }[t] || '';
}

// O dia da votação é o campo `data` — o MESMO pelo qual fetchVotacoesRange escolheu o período. O registro
// (dataHoraRegistro) pode cair no dia seguinte (sessão que passa da meia-noite): recortar por ele tirava do
// documento votações que a tela tinha contado, e os totais não batiam nas bordas (revisão de 11/11/2026).
const legDataVot = e => String(e.votacao.data || e.votacao.dataHoraRegistro || '').slice(0, 10);

/**
 * O resumo de um ano a partir do contexto de aderCalcular. `recortar`: o contexto
 * cobre mais que o período (relatório comum de vários anos) — fica só o que cai
 * nele, e os deputados se recontam pela bancada de cada votação (e.membros), a
 * mesma conta de aderCalcular.
 */
function aderResumoAno(periodo, ctx, recortar = false) {
  const qual = recortar ? ctx.qualifying.filter(e => legDataVot(e) >= periodo.ini && legDataVot(e) <= periodo.fim) : ctx.qualifying;
  const vot = qual.map(e => {
    const c = { a: e.adherentCount, d: e.divergentCount, x: e.ausenteCount };
    const n = c.a + c.d;   // votos Sim e Não da bancada
    // Os votos da bancada, contados e por deputado — o documento mostra Sim, Não, abstenção/obstrução/Art. 17 e
    // ausência (decisão de 24/11/2026); a aderência continua só sobre o Sim e o Não.
    const cont = { sim: 0, nao: 0, out: 0, aus: 0 };
    const votos = {};
    for (const m of e.membros || []) {
      const k = legClasseVoto(m.tipoVoto);
      cont[k]++;
      votos[m.id] = k === 'aus' ? '' : legRotuloVoto(m.tipoVoto);
    }
    return {
      id: String(e.votacao.id), data: legDataVot(e), hora: String(e.votacao.dataHoraRegistro || '').slice(11, 16),
      registro: String(e.votacao.dataHoraRegistro || ''),
      desc: legResumoDesc(e.votacao.descricao), resultado: String(e.votacao.descricao || '').trim(), objeto: e.votacao.proposicaoObjeto || '',
      gov: e.govOrient, c, n, pct: aderPct(c.a, c.d), cont, votos,
    };
  }).sort((p, q) => p.data.localeCompare(q.data) || p.registro.localeCompare(q.registro) || p.id.localeCompare(q.id));
  const atual = new Map(ctx.depMetrics.map(m => [m.dep.id, m.naBancadaAtual]));
  const porDep = new Map();
  for (const e of qual) for (const m of e.membros) {
    if (!porDep.has(m.id)) porDep.set(m.id, { id: m.id, nome: m.nome, uf: m.siglaUf, atual: !!atual.get(m.id), n: 0, a: 0, d: 0, x: 0, out: 0, aus: 0 });
    const d = porDep.get(m.id);
    const s = classifyVote(m.tipoVoto, e.govOrient);
    d.n++;
    if (s === 'aderente') d.a++; else if (s === 'divergente') d.d++; else d.x++;
    const k = legClasseVoto(m.tipoVoto);
    if (k === 'out') d.out++; else if (k === 'aus') d.aus++;
  }
  const deps = [...porDep.values()].map(d => Object.assign(d, { pct: aderPct(d.a, d.d) }))
    .sort((p, q) => (q.pct == null ? -1 : q.pct) - (p.pct == null ? -1 : p.pct) || q.n - p.n || String(p.nome).localeCompare(String(q.nome), 'pt-BR'));
  const tot = vot.reduce((t, v) => ({ a: t.a + v.c.a, d: t.d + v.c.d, x: t.x + v.c.x, n: t.n + v.n }), { a: 0, d: 0, x: 0, n: 0 });
  const meses = {};
  for (const v of vot) {
    const k = v.data.slice(0, 7);
    const m = meses[k] = meses[k] || { k, a: 0, n: 0 };
    m.a += v.c.a; m.n += v.n;
  }
  return {
    ano: periodo.ano, ini: periodo.ini, fim: periodo.fim, vot, deps, tot,
    meses: Object.values(meses).sort((p, q) => p.k.localeCompare(q.k)),
    desconsiderados: ctx.desconsiderados || [], falhasHistorico: ctx.falhasHistorico || 0,
    falhasVotacoes: ctx.falhasVotacoes || 0,
  };
}

const legSomar = anos => anos.reduce((s, a) => ({ a: s.a + a.tot.a, d: s.d + a.tot.d, x: s.x + a.tot.x, n: s.n + a.tot.n, v: s.v + a.vot.length }),
  { a: 0, d: 0, x: 0, n: 0, v: 0 });

/**
 * O contexto só com as votações marcadas na lista (checkbox de cada votação, 24/11/2026). Sem nenhuma marcada, o
 * próprio contexto. aderResumoAno recorta pelo período e reconta os deputados pela bancada de cada votação
 * (e.membros), então consolidado, deputados e contagens saem sobre as marcadas.
 */
function aderRecorteSelecao(ctx) {
  const sel = ctx.selecionadas;
  if (!sel || !sel.size) return ctx;
  const qualifying = ctx.qualifying.filter(e => sel.has(String(e.votacao.id)));
  return Object.assign({}, ctx, { qualifying, selecao: { n: qualifying.length, total: ctx.qualifying.length } });
}

/** O documento do relatório comum (o período pedido), a partir do seu contexto. */
function legDoRelatorio(ctx) {
  const periodos = [];
  for (let a = +ctx.dataIni.slice(0, 4); a <= +ctx.dataFim.slice(0, 4); a++) {
    periodos.push({ ano: String(a), ini: a === +ctx.dataIni.slice(0, 4) ? ctx.dataIni : a + '-01-01',
      fim: a === +ctx.dataFim.slice(0, 4) ? ctx.dataFim : a + '-12-31' });
  }
  const anos = periodos.map(p => aderResumoAno(p, ctx, true)).filter(a => a.vot.length);
  return { modo: 'periodo', sigla: ctx.sigla, ini: ctx.dataIni, fim: ctx.dataFim, hoje: isoLocal(new Date()), selecao: ctx.selecao || null,
    leg: aderLegislaturaDaData(ctx.dataFim), anos, todos: legSomar(anos),
    desconsiderados: ctx.desconsiderados || [], falhasHistorico: ctx.falhasHistorico || 0, falhasVotacoes: ctx.falhasVotacoes || 0 };
}

/** Os textos que mudam entre o documento da legislatura e o de um período. */
function legRotulos(L) {
  // sem nenhum ano com votação (período em que nada se qualificou): vale o período pedido
  const ini = L.anos.length ? L.anos[0].ini : L.ini, fim = L.anos.length ? L.anos[L.anos.length - 1].fim : L.fim;
  if (L.modo === 'periodo') {
    const per = `${legDataBR(L.ini)} a ${legDataBR(L.fim)}`;
    const sel = L.selecao ? ` · ${L.selecao.n} de ${L.selecao.total} votações do período, escolhidas para este relatório` : '';
    return { escopo: per, sub: `Período de ${per}${L.anos.length > 1 ? ', ano a ano' : ''}${sel}`, resumo: 'Resumo do período',
      kpiTotal: 'Aderência no período', linhaTotal: 'Período', periodoTotal: per, arquivo: `${L.ini}-a-${L.fim}` };
  }
  return { escopo: `${L.leg}ª legislatura`, sub: `${L.leg}ª legislatura, ano a ano (${legDataBR(ini)} a ${legDataBR(fim)})`,
    resumo: 'Resumo da legislatura', kpiTotal: 'Aderência na legislatura', linhaTotal: 'Legislatura',
    periodoTotal: `${LEG_MESES[+ini.slice(5, 7) - 1]}/${ini.slice(0, 4)} a ${LEG_MESES[+fim.slice(5, 7) - 1]}/${fim.slice(0, 4)}`,
    arquivo: `${L.leg}a-legislatura-por-ano-${L.hoje}` };
}

/** As proposições só são buscadas quando o documento é pedido (e uma vez). */
async function legGarantirProposicoes(L, aoAndar) {
  if (L.comProposicoes) return;
  await legBuscarProposicoes(L.anos, aoAndar);
  L.comProposicoes = true;
}

/**
 * Sigla, número, ano e ementa da proposição de cada votação. O id da votação
 * começa pelo id da proposição votada ("2345678-90"). Guardado no navegador:
 * a proposição não muda.
 */
async function legBuscarProposicoes(anos, aoAndar) {
  const CHAVE = 'aderLegProp:';
  const ids = [...new Set(anos.flatMap(a => a.vot.map(v => v.id.split('-')[0])).filter(id => /^\d+$/.test(id)))];
  const props = {};
  const faltam = [];
  for (const id of ids) {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(CHAVE + id) || 'null'); } catch (_) {}
    if (p) props[id] = p; else faltam.push(id);
  }
  await mapLimit(faltam, 8, async id => {
    const d = (await fetchJsonRetry(API_PROP + '/' + id)).dados;
    if (!d) return;
    props[id] = { sigla: d.siglaTipo, numero: d.numero, ano: d.ano, ementa: d.ementa || '' };
    try { localStorage.setItem(CHAVE + id, JSON.stringify(props[id])); } catch (_) {}
  }, aoAndar);
  for (const a of anos) for (const v of a.vot) {
    const p = props[v.id.split('-')[0]];
    v.rotulo = p && p.sigla ? `${p.sigla} ${p.numero}/${p.ano}` : (v.objeto || '—');
    const em = p ? String(p.ementa || '').trim() : '';
    v.ementa = em.length > 150 ? em.slice(0, 148).replace(/\s+\S*$/, '') + '…' : em;
  }
}

/** Quem a regra do registro transitório tirou da bancada, somando os anos. */
function legJuntarDesconsiderados(anos) {
  const m = new Map();
  for (const a of anos) for (const d of a.desconsiderados) {
    const k = d.id + '|' + d.de;
    if (!m.has(k)) m.set(k, Object.assign({}, d, { votacoes: 0 }));
    m.get(k).votacoes += d.votacoes;
  }
  return [...m.values()].sort((p, q) => p.de.localeCompare(q.de));
}

// ── GERAR ─────────────────────────────────────────────────────────────────────
async function aderGerarLegislatura() {
  const sigla = partidoEl.value.trim().toUpperCase();
  if (!sigla) { showStatus('Informe a sigla do partido.', 'error'); return; }
  const hoje = isoLocal(new Date());
  const { leg, anos: periodos } = aderAnosDaLegislatura(hoje);

  resultadoEl.innerHTML = '';
  btnGerar.disabled = btnLegislaturaEl.disabled = true;
  try {
    const anos = [];
    let falhasVotacoes = 0;   // inclusive as de um ano que ficou sem nenhuma votação qualificada
    for (const [i, p] of periodos.entries()) {
      const etapa = p.ano + ' (' + (i + 1) + ' de ' + periodos.length + ') · ';
      const ctx = await aderCalcular(p.ini, p.fim, sigla, (msg, tipo, pc) => showStatus(etapa + msg, tipo, pc));
      falhasVotacoes += ctx.falhasVotacoes || 0;
      if (!ctx.vazio) anos.push(aderResumoAno(p, ctx));
    }
    if (!anos.length) {
      clearStatus();
      resultadoEl.innerHTML = aderAvisoFalhasVotacoes(falhasVotacoes) + '<div class="status">Nenhuma votação qualificada na legislatura.</div>';
      return;
    }
    await legBuscarProposicoes(anos, (f, t) => showStatus('Buscando as proposições votadas (' + f + '/' + t + ')...', 'loading', (f / t) * 100));
    clearStatus();
    const L = { modo: 'legislatura', sigla, leg, hoje, anos, todos: legSomar(anos), desconsiderados: legJuntarDesconsiderados(anos),
      falhasHistorico: anos.reduce((s, a) => s + a.falhasHistorico, 0), falhasVotacoes, comProposicoes: true };
    window._legislaturaCtx = L;
    legRenderTela(L);
  } catch (e) {
    showStatus('Erro: ' + e.message, 'error');
    console.error(e);
  } finally {
    btnGerar.disabled = btnLegislaturaEl.disabled = false;
  }
}

function legPeriodoTxt(a, L) {
  if (L.modo === 'periodo') return legDataBR(a.ini).slice(0, 5) + ' a ' + legDataBR(a.fim).slice(0, 5);
  const ultimo = a === L.anos[L.anos.length - 1];
  return LEG_MESES[+a.ini.slice(5, 7) - 1] + ' a ' + LEG_MESES[+a.fim.slice(5, 7) - 1] +
    (ultimo && a.fim === L.hoje ? ' (até ' + legDataBR(a.fim).slice(0, 5) + ')' : '');
}

function legRenderTela(L) {
  const T = L.todos;
  resultadoEl.innerHTML =
    aderAvisoFalhasVotacoes(L.falhasVotacoes) +
    (L.falhasHistorico
      ? '<div class="cv-aviso">⚠ O histórico de alguns deputados não pôde ser lido agora (' + L.falhasHistorico + ' leitura(s)). ' +
        'Nas votações em que eles não votaram, foram considerados pela bancada de hoje. Refaça a busca para tentar de novo.</div>'
      : '') +
    aderAvisoDesconsiderados(L.desconsiderados, L.sigla) +
    '<div class="result-card">' +
      '<div class="result-title-bar">' + L.leg + 'ª legislatura, ano a ano · ' + legEsc(L.sigla) + '</div>' +
      '<div class="result-body">' +
        '<div class="big-pct">' + (T.n > 0 ? (100 * T.a / T.n).toFixed(1) + '<span class="sign">%</span>' : '—') + '</div>' +
        '<div class="big-label">de aderência na legislatura · ' + T.v + ' votações</div>' +
        '<table class="leg-tabela"><thead><tr><th>Ano</th><th>Período</th><th>Votações</th><th>Deputados</th><th>Aderência</th><th>Divergência</th></tr></thead><tbody>' +
        L.anos.map(a => '<tr><td><b>' + a.ano + '</b></td><td>' + legPeriodoTxt(a, L) + '</td><td>' + a.vot.length + '</td><td>' + a.deps.length +
          '</td><td><b>' + legTaxa(a.tot.a, a.tot.n) + '</b></td><td>' + legTaxa(a.tot.d, a.tot.n) + '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="leg-acoes">' +
          '<button id="btnLegPdf" class="export-btn" type="button"><span class="icon">⬇</span> PDF</button>' +
          '<button id="btnLegWord" class="export-btn" type="button"><span class="icon">⬇</span> Word</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.getElementById('btnLegPdf').addEventListener('click', () => legExportarPDF(L));
  document.getElementById('btnLegWord').addEventListener('click', ev => legExportarWord(L, ev.currentTarget));
}

// ── PDF ──────────────────────────────────────────────────────────────────────
/** Colunas da aderência mês a mês (SVG). `rotuloAno`: vários anos no mesmo eixo. */
function legSvgMeses(meses, larg = 690, alt = 150, rotuloAno = false) {
  const n = meses.length, pad = 26, base = alt - 22, topo = 10, w = (larg - pad - 4) / n;
  const y = p => base - (base - topo) * p / 100;
  let s = '';
  for (const g of [0, 25, 50, 75, 100]) {
    s += `<line x1="${pad}" x2="${larg - 2}" y1="${y(g)}" y2="${y(g)}" stroke="#e4e9ee" stroke-width="1"/>` +
      `<text x="${pad - 4}" y="${y(g) + 3}" text-anchor="end" font-size="7" fill="#5b6b7b">${g}%</text>`;
  }
  meses.forEach((m, i) => {
    const p = m.n ? 100 * m.a / m.n : 0, x = pad + i * w + w * 0.15, ww = w * 0.7;
    const mes = +m.k.slice(5, 7);
    // o ano vira no 1º mês com votação (janeiro é recesso e quase nunca aparece)
    const novoAno = i === 0 || m.k.slice(0, 4) !== meses[i - 1].k.slice(0, 4);
    s += `<rect x="${x.toFixed(1)}" y="${y(p).toFixed(1)}" width="${ww.toFixed(1)}" height="${(base - y(p)).toFixed(1)}" rx="2" fill="${LEG_COR.a}"><title>${LEG_MESES[mes - 1]}/${m.k.slice(0, 4)}: ${legPct(p)}</title></rect>`;
    if (n <= 14) s += `<text x="${(x + ww / 2).toFixed(1)}" y="${(y(p) - 3).toFixed(1)}" text-anchor="middle" font-size="7" fill="#1b2430">${Math.round(p)}%</text>`;
    if (!rotuloAno || n <= 14 || novoAno || (mes % 3 === 1 && i > 1)) {
      s += `<text x="${(x + ww / 2).toFixed(1)}" y="${base + 10}" text-anchor="middle" font-size="7" fill="#5b6b7b">${LEG_MESES[mes - 1]}${rotuloAno && novoAno ? '/' + m.k.slice(2, 4) : ''}</text>`;
    }
    if (rotuloAno && novoAno && i > 0) s += `<line x1="${(pad + i * w).toFixed(1)}" x2="${(pad + i * w).toFixed(1)}" y1="${topo}" y2="${base + 14}" stroke="#93a1b0" stroke-dasharray="2 2"/>`;
  });
  return `<svg width="${larg}" height="${alt}" viewBox="0 0 ${larg} ${alt}" role="img" aria-label="aderência por mês">${s}</svg>`;
}

/** Texto do ajuste automático (registro transitório), para o aviso e a nota de método. */
function legTextoDesconsiderados(L) {
  return L.desconsiderados.map(d => `${d.nome} (${d.siglaUf}): registrado como ${L.sigla} ao ser convocado, em ${legDataBR(d.de)}, ` +
    `e no ${d.para} em ${legDataBR(d.ate)} — ${d.votacoes} votaç${d.votacoes > 1 ? 'ões' : 'ão'} fora da conta`).join('; ');
}

/** Itens da nota de método: [negrito, texto]. */
function legNotaMetodo(L) {
  const P = legNomePartido(L.sigla);
  const itens = [
    ['Fonte: ', 'dados abertos da Câmara dos Deputados — votações, votos nominais, orientações e histórico de partido e situação de cada deputado —, a mesma conta do relatório de aderência da extensão' + (L.anos.length > 1 ? ', feita ano a ano.' : '.')],
    ['Votações: ', 'as do Plenário, nominais, com orientação Sim ou Não do Governo e ao menos um voto Sim ou Não. Liberações e votações simbólicas ficam fora.'],
    ['Aderência: ', 'votos Sim ou Não da bancada iguais à orientação do Governo ÷ votos Sim e Não da bancada. Divergência: votos contrários à orientação ÷ o mesmo total.'],
    ['Contagens: ', 'em cada votação, os votos da bancada aparecem como Sim, Não, abstenção/obstrução/Art. 17 e ausência; no quadro por deputado, o voto de cada um. Só o Sim e o Não entram na aderência.'],
    ['Bancada de cada votação: ', `quem era do ${P} naquele dia — para quem votou, a sigla registrada no voto; para quem não votou, o histórico de partido e situação (em exercício) na Câmara. Quem entrou ou saiu no meio do ano é medido só no período em que esteve no partido.`],
  ];
  if (L.selecao) itens.push(['Votações escolhidas: ', `este relatório traz ${L.selecao.n} das ${L.selecao.total} votações qualificadas do período, marcadas na lista do relatório; consolidado, deputados e contagens são calculados só sobre elas.`]);
  const ini = L.anos[0].ini, fim = L.anos[L.anos.length - 1].fim;
  if (L.sigla === 'PODE' && fim >= '2023-08-22' && ini <= '2027-01-31') {
    itens.push(['Ex-PSC: ', 'os deputados eleitos pelo PSC passam a contar a partir de 22/08/2023, data em que a Câmara registrou a incorporação do PSC ao Podemos.']);
  }
  itens.push(['Registro transitório: ', `suplente que a Câmara registra como ${L.sigla} ao convocá-lo (caso de partido incorporado) e que passa a outro partido em até ${ADER_TRANSITORIO_DIAS} dias não conta como bancada nesse intervalo, embora os votos desses dias saiam com a sigla ${L.sigla}. ` +
    (L.desconsiderados.length ? 'Neste relatório: ' + legTextoDesconsiderados(L) + '.' : 'Nenhum caso neste relatório.')]);
  const ult = L.anos[L.anos.length - 1];
  const fora = '"Fora da bancada hoje": deputado que fez parte da bancada no ano, mas não está nela na data deste relatório (saiu do partido, deixou o mandato ou era suplente).';
  itens.push(ult.fim === L.hoje ? [ult.ano + ': ', `até ${legDataBR(ult.fim)}. ` + fora] : ['', fora]);
  return itens;
}

// ── LAYOUT DOS DOCUMENTOS (PDF e Word) ──────────────────────────────────────
// O mesmo do relatório de aderência do PLP 299/2026 (24/11/2026), que a Liderança preferiu: a identidade do PDF
// "Como votou" (CSS_PDF_VOTOS, aderencia.js) — título centrado com a logo, consolidado em caixas, "Como se mede",
// votação a votação (proposição, ementa, resultado, orientação do Governo, os votos da bancada e a aderência) e
// deputado a deputado: o quadro com o voto de cada um em cada votação quando há até LEG_LIMITE_QUADRO votações;
// acima disso, uma tabela com os totais de cada deputado.
const LEG_LIMITE_QUADRO = 15;
/** Cor da aderência: verde a partir de 70%, amarelo a partir de 40%, vermelho abaixo. */
const legCorPct = p => (p == null ? '#8da3a8' : p >= 70 ? '#006633' : p >= 40 ? '#8a6d00' : '#b02a1f');
const legNomeOrdem = (p, q) => String(p.nome).localeCompare(String(q.nome), 'pt-BR');
/** Classe do selo do voto no quadro: comparado à orientação do Governo. '' = ausente; undefined = fora da bancada. */
function legClasseSelo(voto, gov) {
  if (voto === undefined) return null;
  if (voto === '') return 'aus';
  if (voto === 'Sim' || voto === 'Não') return voto === gov ? 'ade' : 'div';
  return 'voto';
}
const legContTxt = c => `${c.sim}/${c.nao}/${c.out}/${c.aus}`;

function legHtmlPDF(L, logo) {
  const P = legNomePartido(L.sigla), T = L.todos, RT = legRotulos(L);
  const unico = L.anos.length === 1;   // um ano só: o consolidado é o do ano, sem a seção por ano
  const hojeBR = legDataBR(L.hoje);
  const e = legEsc;
  const pctCel = p => `<td class="c" style="color:${legCorPct(p)};font-weight:700">${legPctOu(p)}</td>`;
  const caixas = itens => `<div class="resumo">${itens.map(([v, l, s, cor]) =>
    `<div class="bx"><div class="v"${cor ? ` style="color:${cor}"` : ''}>${v}</div><div class="l">${l}${s ? `<br>(${s})` : ''}</div></div>`).join('')}</div>`;
  const caixasDe = (nVot, nDep, a, n) => caixas([[legFmt(nVot), 'votações nominais'], [legFmt(nDep), `deputados do ${e(P)}`],
    [legTaxa(a, n), 'aderência ao Governo', `${legFmt(a)} de ${legFmt(n)} votos`, legCorPct(n ? 100 * a / n : null)]]);
  const comoMede = `<div class="nota"><b>Como se mede:</b> aderência = votos iguais à orientação do Governo ÷ votos Sim e Não da bancada.
    Abstenção, obstrução, Art. 17 e ausência aparecem nas contagens, mas ficam fora da conta. A bancada é a de cada votação:
    quem era do ${e(P)} naquele dia. Detalhes na nota de método, ao final.</div>`;
  const tag = (voto, gov) => {
    const k = legClasseSelo(voto, gov);
    if (!k) return '<span class="nada">—</span>';
    return `<span class="tag tag-${k}">${k === 'aus' ? 'ausente' : e(voto)}</span>`;
  };

  // A ementa sai só na primeira votação de cada proposição: num dia de destaques, a mesma ementa se repetia em
  // todas as linhas (PLP 299/2026, 23/11/2026: sete votações).
  const comEmenta = a => { const vistas = new Set(); return a.vot.map(v => { const k = v.rotulo || v.objeto; const nova = !vistas.has(k); vistas.add(k); return nova ? v.ementa : ''; }); };
  const secaoVotacoes = a => { const em = comEmenta(a); return `<h2>Votação a votação</h2>
<table class="vot"><thead><tr><th class="c">#</th><th>Data</th><th>Objeto</th><th class="c">Orient.<br>Governo</th>
<th class="c">${e(P)}<br>Sim/Não/<br>Abst.·Obstr./Aus.</th><th class="c">Ader.<br>Gov.</th></tr></thead><tbody>
${a.vot.map((v, i) => `<tr><td class="c">${i + 1}</td><td class="hora">${legDataBR(v.registro ? v.registro.slice(0, 10) : v.data).slice(0, 5)}${v.hora ? `<br><span class="nada">${v.hora}</span>` : ''}</td>
<td><b>${e(v.rotulo || v.objeto || '—')}</b>${em[i] ? `<div class="rsm">${e(em[i])}</div>` : ''}<div class="res">${e(v.resultado || v.desc)}</div></td>
<td class="c">${e(v.gov)}</td><td class="c">${legContTxt(v.cont)}</td>${pctCel(v.pct)}</tr>`).join('')}
</tbody></table>`; };

  const secaoDeputados = a => {
    const deps = a.deps.slice().sort(legNomeOrdem);
    const fora = d => (d.atual ? '' : ' <span class="fora">· fora da bancada hoje</span>');
    if (a.vot.length <= LEG_LIMITE_QUADRO) {
      return `<h2>Deputado a deputado</h2>
<div class="nota" style="margin-top:0">Cor do voto em relação à orientação do Governo: verde = acompanhou, vermelho = divergiu. Os números das colunas são os da tabela anterior; "—" = não era da bancada naquela votação.</div>
<table class="mx"><thead><tr><th>Deputado</th>${a.vot.map((_, i) => `<th class="c">${i + 1}</th>`).join('')}<th class="c">Ader.<br>Gov.</th></tr></thead><tbody>
${deps.map(d => `<tr><td>${e(d.nome)} <span class="nada">(${e(d.uf)})</span>${fora(d)}</td>${a.vot.map(v => `<td class="c">${tag(v.votos[d.id], v.gov)}</td>`).join('')}${pctCel(d.pct)}</tr>`).join('')}
</tbody></table>`;
    }
    return `<h2>Deputado a deputado</h2>
<div class="nota" style="margin-top:0">Cada deputado é medido só nas votações em que era do ${e(P)}. São ${a.vot.length} votações — acima de ${LEG_LIMITE_QUADRO}, os votos de cada deputado vêm somados.</div>
<table class="dep"><thead><tr><th>Deputado</th><th class="c">Votações</th><th class="c">Aderiu</th><th class="c">Divergiu</th><th class="c">Abst.·Obstr.</th><th class="c">Ausente</th><th class="c">Ader.<br>Gov.</th></tr></thead><tbody>
${deps.map(d => `<tr><td>${e(d.nome)} <span class="nada">(${e(d.uf)})</span>${fora(d)}</td><td class="c">${d.n}</td><td class="c">${d.a}</td><td class="c">${d.d}</td><td class="c">${d.out}</td><td class="c">${d.aus}</td>${pctCel(d.pct)}</tr>`).join('')}
</tbody></table>`;
  };

  const mesAMes = (meses, rotuloAno) => meses.length >= 2 ? `<h2>Aderência mês a mês</h2><div class="caixa">${legSvgMeses(meses, 680, rotuloAno ? 160 : 130, rotuloAno)}</div>` : '';
  const avisos = `${L.desconsiderados.length ? `<div class="aviso"><b>Fora da bancada, embora a Câmara registre os votos como ${e(L.sigla)}.</b> ${e(legTextoDesconsiderados(L))}. Ver "Registro transitório" na nota de método.</div>` : ''}
${L.falhasVotacoes ? `<div class="aviso">${e(aderTextoFalhasVotacoes(L.falhasVotacoes))}.</div>` : ''}
${L.falhasHistorico ? `<div class="aviso">O histórico de alguns deputados não pôde ser lido (${L.falhasHistorico} leitura(s)); nas votações em que eles não votaram, valeu a bancada de hoje.</div>` : ''}`;

  let h = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Aderência ${e(L.sigla)} — ${e(RT.escopo)}</title><style>${CSS_PDF_VOTOS}
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  td.c, th.c { text-align: center; }
  .vot td:nth-child(3) { width: 56%; }
  .mx td, .mx th { padding: 3px 3px; font-size: 7.5pt; } .mx .tag { font-size: 7pt; padding: 0 4px; }
  .dep td { padding: 3px 6px; font-size: 8.5pt; }
  .fora { color: #6b7280; font-size: 7.5pt; }
  .caixa { border: 1px solid #d8e3dc; border-radius: 6px; padding: 8px 10px; margin: 4px 0 10px; break-inside: avoid; }
  .aviso { font-size: 8.5pt; color: #5c4a00; background: #fdf7e3; border-left: 3px solid #e8d28a; padding: 8px 10px; margin: 8px 0; line-height: 1.5; }
  .ano-tit { font-size: 13pt; font-weight: 700; color: #fff; background: #003c1f; border-radius: 6px; padding: 6px 12px; margin: 0 0 10px; }
  .ano-tit small { font-weight: 400; font-size: 9pt; opacity: .85; margin-left: 6px; }
  .quebra { break-before: page; }
  .nota ul { margin: 4px 0 0 16px; } .nota li { margin-bottom: 4px; }
</style></head><body>
<div class="cab"><div class="sp"></div><div class="tit"><h1>Aderência da bancada do ${e(P)}</h1>
<div class="sub">às orientações do Governo · ${e(RT.sub)} · votações nominais do Plenário com orientação Sim ou Não do Governo</div></div>
${logo ? `<img src="${logo}" alt="Podemos">` : '<div class="sp"></div>'}</div><div class="rule"></div>
<div class="meta">Dados abertos da Câmara dos Deputados, consultados em ${hojeBR} · Liderança do Podemos na Câmara dos Deputados</div>
`;
  if (unico) {
    const a = L.anos[0];
    h += `<h2>Consolidado</h2>${caixasDe(a.vot.length, a.deps.length, a.tot.a, a.tot.n)}${comoMede}${avisos}${mesAMes(a.meses, false)}${secaoVotacoes(a)}${secaoDeputados(a)}`;
  } else {
    h += `<h2>Consolidado</h2>${caixasDe(T.v, legDeputados(L), T.a, T.n)}${comoMede}${avisos}
<h2>${RT.resumo}</h2>
<table><thead><tr><th>Ano</th><th>Período</th><th class="c">Votações</th><th class="c">Deputados*</th><th class="c">Aderiu</th><th class="c">Divergiu</th><th class="c">Ader.<br>Gov.</th></tr></thead><tbody>
${L.anos.map(a => `<tr><td><b>${a.ano}</b></td><td style="white-space:nowrap">${legPeriodoTxt(a, L)}</td><td class="c">${a.vot.length}</td><td class="c">${a.deps.length}</td><td class="c">${legFmt(a.tot.a)}</td><td class="c">${legFmt(a.tot.d)}</td>${pctCel(a.tot.n ? 100 * a.tot.a / a.tot.n : null)}</tr>`).join('')}
<tr><td><b>${RT.linhaTotal}</b></td><td style="white-space:nowrap">${RT.periodoTotal}</td><td class="c"><b>${T.v}</b></td><td class="c"></td><td class="c">${legFmt(T.a)}</td><td class="c">${legFmt(T.d)}</td>${pctCel(T.n ? 100 * T.a / T.n : null)}</tr>
</tbody></table>
<div class="nota">* Deputados que fizeram parte da bancada em ao menos uma votação do ano (a bancada é a de cada votação: quem era do ${e(P)} e estava em exercício naquele dia).</div>
${mesAMes(L.anos.flatMap(a => a.meses), true)}`;
    for (const a of L.anos) {
      h += `<div class="quebra"></div><div class="ano-tit">${a.ano}<small>${legDataBR(a.ini)} a ${legDataBR(a.fim)}</small></div>
${caixasDe(a.vot.length, a.deps.length, a.tot.a, a.tot.n)}${mesAMes(a.meses, false)}${secaoVotacoes(a)}${secaoDeputados(a)}`;
    }
  }
  h += `<div class="quebra"></div><h2>Nota de método</h2><div class="nota"><ul>${legNotaMetodo(L).map(([b, t]) => `<li><b>${e(b)}</b>${e(t)}</li>`).join('')}</ul></div>
<div class="meta" style="margin-top:14px">Gerado pelo SisPode · ${hojeBR}</div>`;
  return h + '</body></html>';
}

async function legLogoDataUrl() {
  try {
    const res = await fetch(chrome.runtime.getURL('icons/podemos-logo.png'));
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((ok, err) => {
      const fr = new FileReader();
      fr.onloadend = () => ok(fr.result);
      fr.onerror = () => err(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch (e) { console.warn('Logo não carregada:', e.message); return null; }
}

async function legExportarPDF(L) {
  // A janela abre no gesto do clique (pop-up aberto depois de um await é bloqueado).
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) { showStatus('Permita pop-ups para gerar o PDF.', 'error'); return; }
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando PDF…</title></head>'
    + '<body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Montando o documento…</body></html>');
  win.document.close();
  const aviso = win.document.body;
  await legGarantirProposicoes(L, (f, n) => { if (!win.closed) aviso.textContent = 'Buscando as proposições votadas (' + f + '/' + n + ')…'; });
  const logo = await legLogoDataUrl();
  if (win.closed) return;
  win.document.open();
  win.document.write(legHtmlPDF(L, logo));
  win.document.close();

  let impresso = false;
  const imprimir = () => { if (impresso || win.closed) return; impresso = true; try { win.focus(); win.print(); } catch (_) {} };
  win.PagedConfig = { auto: true, after: imprimir };
  const s = win.document.createElement('script');
  s.src = chrome.runtime.getURL('libs/paged.polyfill.js');
  s.onerror = imprimir;            // sem a lib, imprime sem numeração de página
  win.document.head.appendChild(s);
  setTimeout(imprimir, 60000);     // rede de segurança (documento longo)
}

// ── WORD ─────────────────────────────────────────────────────────────────────
// O Word não desenha SVG de forma confiável: os gráficos vão como PNG, feitos
// num canvas em resolução 3× para imprimir nítidos.
function legPng(canvas) {
  const b64 = canvas.toDataURL('image/png').split(',')[1];
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function legCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function legRetRedondo(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
}

function legPngMeses(meses, rotuloAno = false, larg = 2070, alt = 480) {
  const cv = legCanvas(larg, alt), g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, larg, alt);
  g.font = '21px Arial, sans-serif';
  const pad = 78, base = alt - 60, topo = 26, n = meses.length, w = (larg - pad - 10) / n;
  const y = p => base - (base - topo) * p / 100;
  for (const v of [0, 25, 50, 75, 100]) {
    g.strokeStyle = '#e4e9ee'; g.lineWidth = 2; g.beginPath(); g.moveTo(pad, y(v)); g.lineTo(larg - 6, y(v)); g.stroke();
    g.fillStyle = '#5b6b7b'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(v + '%', pad - 10, y(v));
  }
  meses.forEach((m, i) => {
    const p = m.n ? 100 * m.a / m.n : 0, x = pad + i * w + w * 0.15, ww = w * 0.7, mes = +m.k.slice(5, 7);
    const novoAno = i === 0 || m.k.slice(0, 4) !== meses[i - 1].k.slice(0, 4);
    g.fillStyle = LEG_COR.a; legRetRedondo(g, x, y(p), ww, base - y(p), 5);
    g.textAlign = 'center';
    if (n <= 14) { g.fillStyle = '#1b2430'; g.textBaseline = 'bottom'; g.fillText(Math.round(p) + '%', x + ww / 2, y(p) - 6); }
    if (!rotuloAno || n <= 14 || novoAno || (mes % 3 === 1 && i > 1)) {
      g.fillStyle = '#5b6b7b'; g.textBaseline = 'top';
      g.fillText(LEG_MESES[mes - 1] + (rotuloAno && novoAno ? '/' + m.k.slice(2, 4) : ''), x + ww / 2, base + 12);
    }
    if (rotuloAno && novoAno && i > 0) {
      const xx = pad + i * w;
      g.strokeStyle = '#93a1b0'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(xx, topo); g.lineTo(xx, base + 40); g.stroke(); g.setLineDash([]);
    }
  });
  return legPng(cv);
}

async function legDocx(L) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
    AlignmentType, HeadingLevel, Footer, PageNumber, VerticalAlign, TableLayoutType, LevelFormat } = docx;
  const P = legNomePartido(L.sigla), T = L.todos, RT = legRotulos(L);
  const unico = L.anos.length === 1;
  // As cores do CSS_PDF_VOTOS: o Word sai com a mesma cara do PDF.
  const ESCURO = '003C1F', VERDE = '00A859', CINZA = '6B7280', TEXTO = '1A1A1A', LINHA = 'E6EAE7', CAB = 'EEF4F0', BORDA = 'D8E3DC',
    NOTA = 'F7F9F8', NOTA_B = 'C9DDD2', RSM = 'F4F7F5', FONTE = 'Arial';
  const SELO = { ade: ['006633', 'EAF7F0'], div: ['B02A1F', 'FDEEEC'], aus: ['8A6D00', 'FDF7E3'], voto: ['1A1A1A', 'F4F5F4'] };
  const LARG = 10546;   // A4 menos as margens de 680
  const hex = c => c.replace('#', '').toUpperCase();
  const t = (text, o = {}) => new TextRun(Object.assign({ text: String(text), font: FONTE, size: 18, color: TEXTO }, o));
  const par = (runs, o = {}) => new Paragraph(Object.assign({ children: Array.isArray(runs) ? runs : [runs], spacing: { after: 60 } }, o));
  const img = (data, w, h) => new ImageRun({ type: 'png', data, transformation: { width: w, height: h } });
  const nada = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const semBorda = { top: nada, bottom: nada, left: nada, right: nada };
  const bordaLinha = { top: nada, left: nada, right: nada, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINHA } };
  const bordaCab = Object.assign({}, bordaLinha, { bottom: { style: BorderStyle.SINGLE, size: 10, color: NOTA_B } });
  const caixa = (cor, sz) => { const b = { style: BorderStyle.SINGLE, size: sz, color: cor }; return { top: b, bottom: b, left: b, right: b }; };
  const cel = (filhos, w, o = {}) => new TableCell(Object.assign({ children: filhos, width: { size: w, type: WidthType.DXA }, borders: bordaLinha,
    verticalAlign: VerticalAlign.CENTER, margins: { top: 50, bottom: 50, left: 70, right: 70 } }, o));
  const C = AlignmentType.CENTER, E = AlignmentType.LEFT;
  const pctRun = (p, o = {}) => t(legPctOu(p), Object.assign({ bold: true, color: hex(legCorPct(p)) }, o));
  function tabela(cab, linhas, larguras, alinh = []) {
    const rCab = new TableRow({ tableHeader: true, children: cab.map((c, i) => cel([par(t(c.toUpperCase(), { size: 14, color: ESCURO, bold: true }), { alignment: alinh[i] || E, spacing: { after: 0 } })],
      larguras[i], { borders: bordaCab, shading: { type: ShadingType.CLEAR, color: 'auto', fill: CAB } })) });
    const rs = linhas.map(l => new TableRow({ cantSplit: true, children: l.map((c, i) => cel(Array.isArray(c) ? c : [par(c, { alignment: alinh[i] || E, spacing: { after: 0 } })], larguras[i])) }));
    return new Table({ width: { size: larguras.reduce((s, x) => s + x, 0), type: WidthType.DXA }, columnWidths: larguras, layout: TableLayoutType.FIXED, rows: [rCab, ...rs] });
  }
  const caixas = itens => {
    const w = Math.floor((LARG - 200 * (itens.length - 1)) / itens.length), larguras = [];
    const cels = [];
    itens.forEach(([v, l, sub, cor], i) => {
      if (i) { larguras.push(200); cels.push(cel([par(t(''), { spacing: { after: 0 } })], 200, { borders: semBorda })); }
      larguras.push(w);
      cels.push(cel([par(t(v, { size: 34, bold: true, color: cor ? hex(cor) : ESCURO }), { alignment: C, spacing: { after: 20 } }),
        par(t(l.toUpperCase(), { size: 13, color: CINZA }), { alignment: C, spacing: { after: 0 } }),
        ...(sub ? [par(t(`(${sub})`, { size: 13, color: CINZA }), { alignment: C, spacing: { after: 0 } })] : [])], w,
        { borders: caixa(BORDA, 6), margins: { top: 140, bottom: 140, left: 80, right: 80 } }));
    });
    return new Table({ width: { size: larguras.reduce((s, x) => s + x, 0), type: WidthType.DXA }, columnWidths: larguras, layout: TableLayoutType.FIXED, rows: [new TableRow({ children: cels })] });
  };
  const caixasDe = (nVot, nDep, a, n) => caixas([[legFmt(nVot), 'votações nominais'], [legFmt(nDep), `deputados do ${P}`],
    [legTaxa(a, n), 'aderência ao Governo', `${legFmt(a)} de ${legFmt(n)} votos`, legCorPct(n ? 100 * a / n : null)]]);
  // Nota (fundo claro, filete à esquerda): o .nota do PDF
  const nota = (runs, fundo = NOTA, filete = NOTA_B) => par(runs, { shading: { type: ShadingType.CLEAR, color: 'auto', fill: fundo },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: filete, space: 6 } }, spacing: { before: 80, after: 120 }, indent: { left: 120, right: 60 } });
  const h2 = (txt, quebra) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, pageBreakBefore: !!quebra, spacing: { before: 240, after: 100 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: VERDE, space: 6 } }, indent: { left: 120 }, children: [t(txt, { size: 23, bold: true, color: ESCURO })] });
  const comoMede = () => nota([t('Como se mede: ', { bold: true, size: 17, color: ESCURO }),
    t(`aderência = votos iguais à orientação do Governo ÷ votos Sim e Não da bancada. Abstenção, obstrução, Art. 17 e ausência aparecem nas contagens, mas ficam fora da conta. A bancada é a de cada votação: quem era do ${P} naquele dia. Detalhes na nota de método, ao final.`, { size: 17, color: '444444' })]);
  const selo = (voto, gov) => {
    const k = legClasseSelo(voto, gov);
    if (!k) return t('—', { size: 14, color: '9AA5A0' });
    return t(` ${k === 'aus' ? 'ausente' : voto} `, { size: 14, bold: true, color: SELO[k][0], shading: { type: ShadingType.CLEAR, color: 'auto', fill: SELO[k][1] } });
  };

  const votacoes = a => {
    const vistas = new Set();
    return [h2('Votação a votação'), tabela(['#', 'Data', 'Objeto', 'Orient. Governo', `${P} Sim/Não/ Abst.·Obstr./Aus.`, 'Ader. Gov.'],
      a.vot.map((v, i) => {
        const k = v.rotulo || v.objeto; const em = vistas.has(k) ? '' : v.ementa; vistas.add(k);
        const dia = legDataBR(v.registro ? v.registro.slice(0, 10) : v.data).slice(0, 5);
        return [t(i + 1, { size: 16 }), [par(t(dia, { size: 16 }), { spacing: { after: 0 } }), ...(v.hora ? [par(t(v.hora, { size: 14, color: '9AA5A0' }), { spacing: { after: 0 } })] : [])],
          [par(t(k || '—', { bold: true, size: 17 }), { spacing: { after: 30 } }),
            ...(em ? [par(t(em, { size: 15, color: '3C4A44' }), { shading: { type: ShadingType.CLEAR, color: 'auto', fill: RSM }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: NOTA_B, space: 4 } }, indent: { left: 80 }, spacing: { after: 30 } })] : []),
            par(t(v.resultado || v.desc, { size: 15, italics: true, color: CINZA }), { spacing: { after: 0 } })],
          t(v.gov, { size: 16 }), t(legContTxt(v.cont), { size: 16 }), pctRun(v.pct, { size: 16 })];
      }),
      [450, 800, 6096, 900, 1300, 1000], [C, E, E, C, C, C])];
  };

  const deputados = a => {
    const deps = a.deps.slice().sort(legNomeOrdem);
    const nome = d => [par([t(d.nome, { size: 16 }), t(` (${d.uf})`, { size: 15, color: '9AA5A0' }), ...(d.atual ? [] : [t(' · fora da bancada hoje', { size: 13, color: CINZA })])], { spacing: { after: 0 } })];
    if (a.vot.length <= LEG_LIMITE_QUADRO) {
      const wNome = 3000, wPct = 900, wv = Math.floor((LARG - wNome - wPct) / a.vot.length);
      return [h2('Deputado a deputado'),
        nota(t('Cor do voto em relação à orientação do Governo: verde = acompanhou, vermelho = divergiu. Os números das colunas são os da tabela anterior; "—" = não era da bancada naquela votação.', { size: 16, color: '444444' })),
        tabela(['Deputado', ...a.vot.map((_, i) => String(i + 1)), 'Ader. Gov.'],
          deps.map(d => [nome(d), ...a.vot.map(v => [par(selo(v.votos[d.id], v.gov), { alignment: C, spacing: { after: 0 } })]), pctRun(d.pct, { size: 16 })]),
          [wNome, ...a.vot.map(() => wv), wPct], [E, ...a.vot.map(() => C), C])];
    }
    return [h2('Deputado a deputado'),
      nota(t(`Cada deputado é medido só nas votações em que era do ${P}. São ${a.vot.length} votações — acima de ${LEG_LIMITE_QUADRO}, os votos de cada deputado vêm somados.`, { size: 16, color: '444444' })),
      tabela(['Deputado', 'Votações', 'Aderiu', 'Divergiu', 'Abst.·Obstr.', 'Ausente', 'Ader. Gov.'],
        deps.map(d => [nome(d), t(d.n, { size: 16 }), t(d.a, { size: 16 }), t(d.d, { size: 16 }), t(d.out, { size: 16 }), t(d.aus, { size: 16 }), pctRun(d.pct, { size: 16 })]),
        [3946, 1000, 1000, 1000, 1200, 1000, 1400], [E, C, C, C, C, C, C])];
  };
  const mesAMes = (meses, rotuloAno) => meses.length >= 2
    ? [h2('Aderência mês a mês'), par(img(legPngMeses(meses, rotuloAno, 2070, rotuloAno ? 480 : 400), 680, rotuloAno ? 158 : 131), { spacing: { after: 100 } })] : [];
  const avisos = () => {
    const ps = [];
    const av = runs => nota(runs, 'FDF7E3', 'E8D28A');
    if (L.desconsiderados.length) ps.push(av([t(`Fora da bancada, embora a Câmara registre os votos como ${L.sigla}. `, { bold: true, size: 16 }), t(legTextoDesconsiderados(L) + '. Ver "Registro transitório" na nota de método.', { size: 16 })]));
    if (L.falhasVotacoes) ps.push(av(t(aderTextoFalhasVotacoes(L.falhasVotacoes) + '.', { size: 16 })));
    if (L.falhasHistorico) ps.push(av(t(`O histórico de alguns deputados não pôde ser lido (${L.falhasHistorico} leitura(s)); nas votações em que eles não votaram, valeu a bancada de hoje.`, { size: 16 })));
    return ps;
  };

  let logo = null;
  try { const r = await fetch(chrome.runtime.getURL('icons/podemos-logo.png')); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()); } catch (_) {}

  const filhos = [];
  const lados = 1500;
  filhos.push(new Table({ width: { size: LARG, type: WidthType.DXA }, columnWidths: [lados, LARG - 2 * lados, lados], layout: TableLayoutType.FIXED, rows: [new TableRow({ children: [
    cel([par(t(''), { spacing: { after: 0 } })], lados, { borders: semBorda }),
    cel([par(t(`Aderência da bancada do ${P}`, { size: 30, bold: true, color: ESCURO }), { alignment: C, spacing: { after: 30 } }),
      par(t(`às orientações do Governo · ${RT.sub} · votações nominais do Plenário com orientação Sim ou Não do Governo`, { size: 18, color: ESCURO }), { alignment: C, spacing: { after: 0 } })],
    LARG - 2 * lados, { borders: semBorda }),
    cel([par(logo ? img(logo, 96, 44) : t(''), { alignment: AlignmentType.RIGHT, spacing: { after: 0 } })], lados, { borders: semBorda })] })] }));
  filhos.push(par(t(''), { border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: VERDE, space: 1 } }, spacing: { after: 100 } }));
  filhos.push(par(t(`Dados abertos da Câmara dos Deputados, consultados em ${legDataBR(L.hoje)} · Liderança do Podemos na Câmara dos Deputados`, { size: 16, italics: true, color: CINZA }), { alignment: C, spacing: { after: 160 } }));

  filhos.push(h2('Consolidado'));
  if (unico) {
    const a = L.anos[0];
    filhos.push(caixasDe(a.vot.length, a.deps.length, a.tot.a, a.tot.n), comoMede(), ...avisos(), ...mesAMes(a.meses, false), ...votacoes(a), ...deputados(a));
  } else {
    filhos.push(caixasDe(T.v, legDeputados(L), T.a, T.n), comoMede(), ...avisos(), h2(RT.resumo),
      tabela(['Ano', 'Período', 'Votações', 'Deputados*', 'Aderiu', 'Divergiu', 'Ader. Gov.'],
        [...L.anos.map(a => [t(a.ano, { bold: true }), t(legPeriodoTxt(a, L)), t(a.vot.length), t(a.deps.length), t(legFmt(a.tot.a)), t(legFmt(a.tot.d)), pctRun(a.tot.n ? 100 * a.tot.a / a.tot.n : null)]),
         [t(RT.linhaTotal, { bold: true }), t(RT.periodoTotal), t(T.v, { bold: true }), t(''), t(legFmt(T.a)), t(legFmt(T.d)), pctRun(T.n ? 100 * T.a / T.n : null)]],
        [1200, 2300, 1300, 1400, 1400, 1400, 1546], [E, E, C, C, C, C, C]),
      nota(t(`* Deputados que fizeram parte da bancada em ao menos uma votação do ano (a bancada é a de cada votação: quem era do ${P} e estava em exercício naquele dia).`, { size: 15, color: '444444' })),
      ...mesAMes(L.anos.flatMap(a => a.meses), true));
    for (const a of L.anos) {
      filhos.push(par([t(a.ano, { size: 26, bold: true, color: 'FFFFFF' }), t(`   ${legDataBR(a.ini)} a ${legDataBR(a.fim)}`, { size: 18, color: 'FFFFFF' })],
        { pageBreakBefore: true, shading: { type: ShadingType.CLEAR, color: 'auto', fill: ESCURO }, spacing: { after: 160 }, indent: { left: 60 } }),
        caixasDe(a.vot.length, a.deps.length, a.tot.a, a.tot.n), ...mesAMes(a.meses, false), ...votacoes(a), ...deputados(a));
    }
  }
  filhos.push(h2('Nota de método', true));
  for (const [b, txt] of legNotaMetodo(L)) {
    filhos.push(new Paragraph({ numbering: { reference: 'marcas', level: 0 }, spacing: { after: 80 }, children: [t(b, { bold: true, size: 17, color: ESCURO }), t(txt, { size: 17, color: '444444' })] }));
  }
  filhos.push(par(t(`Gerado pelo SisPode · ${legDataBR(L.hoje)}`, { size: 16, italics: true, color: CINZA }), { alignment: C, spacing: { before: 240 } }));

  const rodape = txt => t(txt, { size: 15, color: '888888' });
  return Packer.toBlob(new Document({
    creator: 'Liderança do Podemos na Câmara dos Deputados',
    title: `Aderência da bancada do ${P} às orientações do Governo — ${RT.escopo}`,
    styles: { default: { document: { run: { font: FONTE, size: 18, color: TEXTO } } },
      paragraphStyles: [
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTE, size: 23, bold: true, color: ESCURO }, paragraph: { outlineLevel: 1 } }] },
    numbering: { config: [{ reference: 'marcas', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 680, right: 680, footer: 360 } } },
      footers: { default: new Footer({ children: [par([new TextRun({ children: [PageNumber.CURRENT], font: FONTE, size: 15, color: '888888' }), rodape(' / '),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONTE, size: 15, color: '888888' })], { alignment: C })] }) },
      children: filhos }] }));
}

function legNomeArquivo(L, ext) {
  return `Aderencia-${L.sigla}-${legRotulos(L).arquivo}.${ext}`;
}

async function legExportarWord(L, btn) {
  if (btn) btn.disabled = true;
  try {
    await legGarantirProposicoes(L, (f, n) => showStatus('Buscando as proposições votadas (' + f + '/' + n + ')...', 'loading', (f / n) * 100));
    showStatus('Montando o Word...', 'loading');
    const blob = await legDocx(L);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = legNomeArquivo(L, 'docx');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    clearStatus();
  } catch (e) {
    showStatus('Erro ao gerar o Word: ' + e.message, 'error');
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

btnLegislaturaEl.addEventListener('click', aderGerarLegislatura);
