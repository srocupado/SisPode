'use strict';

// ── RELATÓRIO EM DOCUMENTO: LEGISLATURA OU PERÍODO, ANO A ANO ───────────────
// A mesma conta do relatório de aderência (aderCalcular) num documento: resumo,
// e para cada ano os membros da bancada e as votações, com gráficos. Dois usos:
//  - "Relatório da legislatura": cada ano da legislatura em curso;
//  - PDF/Word do relatório comum: o período pedido, partido por ano quando
//    atravessa anos (num ano só, sem o resumo repetido).
// Sai em PDF (janela de impressão, como o PDF do "Como votou") e em Word (docx).
// Identidade visual dos relatórios da extensão: logo, linha da Liderança, filete
// de quatro cores.
//
// Cores da conduta: as do CV_COR (validadas para daltonismo), na ordem
// Aderiu → Ausente → Divergiu — o âmbar entre o verde e o vermelho.

const btnLegislaturaEl = document.getElementById('btnLegislatura');
const LEG_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LEG_ORDEM = ['a', 'x', 'd'];   // aderiu, ausente, divergiu
const LEG_COR = { a: CV_COR.aderente, x: CV_COR.ausente, d: CV_COR.divergente };

const legEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const legFmt = n => n.toLocaleString('pt-BR');
const legPct = (n, c = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%';
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

const legDataVot = e => String(e.votacao.dataHoraRegistro || e.votacao.data || '').slice(0, 10);

/**
 * O resumo de um ano a partir do contexto de aderCalcular. `recortar`: o contexto
 * cobre mais que o período (relatório comum de vários anos) — fica só o que cai
 * nele, e os deputados se recontam pela bancada de cada votação (e.membros), a
 * mesma conta de aderCalcular.
 */
function aderResumoAno(periodo, ctx, recortar = false) {
  const qual = recortar ? ctx.qualifying.filter(e => legDataVot(e) >= periodo.ini && legDataVot(e) <= periodo.fim) : ctx.qualifying;
  const vot = qual.map(e => {
    const n = e.possiveis;
    const c = { a: e.adherentCount, d: e.divergentCount, x: e.ausenteCount };
    return {
      id: String(e.votacao.id), data: legDataVot(e),
      desc: legResumoDesc(e.votacao.descricao), objeto: e.votacao.proposicaoObjeto || '',
      gov: e.govOrient, c, n, pct: n ? 100 * c.a / n : 0,
    };
  }).sort((p, q) => p.data.localeCompare(q.data) || p.id.localeCompare(q.id));
  const atual = new Map(ctx.depMetrics.map(m => [m.dep.id, m.naBancadaAtual]));
  const porDep = new Map();
  for (const e of qual) for (const m of e.membros) {
    if (!porDep.has(m.id)) porDep.set(m.id, { id: m.id, nome: m.nome, uf: m.siglaUf, atual: !!atual.get(m.id), n: 0, a: 0, d: 0, x: 0 });
    const d = porDep.get(m.id);
    const s = classifyVote(m.tipoVoto, e.govOrient);
    d.n++;
    if (s === 'aderente') d.a++; else if (s === 'divergente') d.d++; else d.x++;
  }
  const deps = [...porDep.values()].map(d => Object.assign(d, { pct: 100 * d.a / d.n }))
    .sort((p, q) => q.pct - p.pct || q.n - p.n || String(p.nome).localeCompare(String(q.nome), 'pt-BR'));
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
  };
}

const legSomar = anos => anos.reduce((s, a) => ({ a: s.a + a.tot.a, d: s.d + a.tot.d, x: s.x + a.tot.x, n: s.n + a.tot.n, v: s.v + a.vot.length }),
  { a: 0, d: 0, x: 0, n: 0, v: 0 });

/** O documento do relatório comum (o período pedido), a partir do seu contexto. */
function legDoRelatorio(ctx) {
  const periodos = [];
  for (let a = +ctx.dataIni.slice(0, 4); a <= +ctx.dataFim.slice(0, 4); a++) {
    periodos.push({ ano: String(a), ini: a === +ctx.dataIni.slice(0, 4) ? ctx.dataIni : a + '-01-01',
      fim: a === +ctx.dataFim.slice(0, 4) ? ctx.dataFim : a + '-12-31' });
  }
  const anos = periodos.map(p => aderResumoAno(p, ctx, true)).filter(a => a.vot.length);
  return { modo: 'periodo', sigla: ctx.sigla, ini: ctx.dataIni, fim: ctx.dataFim, hoje: isoLocal(new Date()),
    leg: aderLegislaturaDaData(ctx.dataFim), anos, todos: legSomar(anos),
    desconsiderados: ctx.desconsiderados || [], falhasHistorico: ctx.falhasHistorico || 0 };
}

/** Os textos que mudam entre o documento da legislatura e o de um período. */
function legRotulos(L) {
  const ini = L.anos[0].ini, fim = L.anos[L.anos.length - 1].fim;
  if (L.modo === 'periodo') {
    const per = `${legDataBR(L.ini)} a ${legDataBR(L.fim)}`;
    return { escopo: per, sub: `Período de ${per}${L.anos.length > 1 ? ', ano a ano' : ''}`, resumo: 'Resumo do período',
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
    const d = (await fetchJson(API_PROP + '/' + id)).dados;
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
    for (const [i, p] of periodos.entries()) {
      const etapa = p.ano + ' (' + (i + 1) + ' de ' + periodos.length + ') · ';
      const ctx = await aderCalcular(p.ini, p.fim, sigla, (msg, tipo, pc) => showStatus(etapa + msg, tipo, pc));
      if (!ctx.vazio) anos.push(aderResumoAno(p, ctx));
    }
    if (!anos.length) {
      clearStatus();
      resultadoEl.innerHTML = '<div class="status">Nenhuma votação qualificada na legislatura.</div>';
      return;
    }
    await legBuscarProposicoes(anos, (f, t) => showStatus('Buscando as proposições votadas (' + f + '/' + t + ')...', 'loading', (f / t) * 100));
    clearStatus();
    const L = { modo: 'legislatura', sigla, leg, hoje, anos, todos: legSomar(anos), desconsiderados: legJuntarDesconsiderados(anos),
      falhasHistorico: anos.reduce((s, a) => s + a.falhasHistorico, 0), comProposicoes: true };
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
    (L.falhasHistorico
      ? '<div class="cv-aviso">⚠ O histórico de alguns deputados não pôde ser lido agora (' + L.falhasHistorico + ' leitura(s)). ' +
        'Nas votações em que eles não votaram, foram considerados pela bancada de hoje. Refaça a busca para tentar de novo.</div>'
      : '') +
    aderAvisoDesconsiderados(L.desconsiderados, L.sigla) +
    '<div class="result-card">' +
      '<div class="result-title-bar">' + L.leg + 'ª legislatura, ano a ano · ' + legEsc(L.sigla) + '</div>' +
      '<div class="result-body">' +
        '<div class="big-pct">' + (100 * T.a / T.n).toFixed(1) + '<span class="sign">%</span></div>' +
        '<div class="big-label">de aderência na legislatura · ' + T.v + ' votações</div>' +
        '<table class="leg-tabela"><thead><tr><th>Ano</th><th>Período</th><th>Votações</th><th>Deputados</th><th>Aderência</th><th>Divergência</th><th>Ausência</th></tr></thead><tbody>' +
        L.anos.map(a => '<tr><td><b>' + a.ano + '</b></td><td>' + legPeriodoTxt(a, L) + '</td><td>' + a.vot.length + '</td><td>' + a.deps.length +
          '</td><td><b>' + legPct(100 * a.tot.a / a.tot.n) + '</b></td><td>' + legPct(100 * a.tot.d / a.tot.n) + '</td><td>' + legPct(100 * a.tot.x / a.tot.n) + '</td></tr>').join('') +
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
/** Barra empilhada da conduta (SVG), com 1px de vão entre os segmentos. */
function legSvgBarra(c, n, w = 118, h = 9) {
  if (!n) return '';
  let x = 0, s = '';
  for (const k of LEG_ORDEM) {
    const ww = w * c[k] / n;
    if (ww > 0) s += `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(0, ww - (x + ww < w - 0.01 ? 1 : 0)).toFixed(2)}" height="${h}" rx="1.5" fill="${LEG_COR[k]}"/>`;
    x += ww;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="aderiu ${c.a}, ausente ${c.x}, divergiu ${c.d}">${s}</svg>`;
}

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
    ['Aderência: ', 'votos da bancada iguais à orientação do Governo ÷ votos possíveis da bancada (um por deputado da bancada em cada votação). Divergência: voto contrário à orientação. Ausência: não votou, absteve-se, obstruiu ou registrou "Art. 17".'],
    ['Bancada de cada votação: ', `quem era do ${P} naquele dia — para quem votou, a sigla registrada no voto; para quem não votou, o histórico de partido e situação (em exercício) na Câmara. Quem entrou ou saiu no meio do ano é medido só no período em que esteve no partido.`],
  ];
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

function legHtmlPDF(L, logo) {
  const P = legNomePartido(L.sigla), T = L.todos, RT = legRotulos(L);
  const unico = L.anos.length === 1;   // um ano só: sem o resumo, que repetiria a seção do ano
  const hojeBR = legDataBR(L.hoje);
  const legenda = `<div class="leg">${[['a', 'Aderiu (votou como o Governo orientou)'], ['x', 'Ausente, abstenção ou obstrução'], ['d', 'Divergiu']]
    .map(([k, t]) => `<span><i style="background:${LEG_COR[k]}"></i>${t}</span>`).join('')}</div>`;
  const kpi = (t, n, s) => `<div class="kpi"><div class="t">${t}</div><div class="n">${n}</div><div class="s">${s}</div></div>`;
  let h = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Aderência ${legEsc(L.sigla)} — ${legEsc(RT.escopo)}</title><style>
  @page { size: A4; margin: 13mm 12mm 15mm;
    @bottom-left { content: "Liderança do Podemos na Câmara dos Deputados · Aderência às orientações do Governo, ${RT.escopo}"; font-size: 7pt; color: #5b6b7b; font-family: Arial, sans-serif; }
    @bottom-right { content: counter(page) " / " counter(pages); font-size: 7pt; color: #5b6b7b; font-family: Arial, sans-serif; } }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1b2430; margin: 0; font-size: 9pt; background: #fff; }
  .cab { display: flex; align-items: center; gap: 12px; } .cab img { height: 44px; }
  .org { font-size: 9pt; font-weight: 700; color: #0b8a4b; text-transform: uppercase; letter-spacing: .4px; }
  h1 { font-size: 15pt; margin: 2px 0; } .sub { font-size: 8.5pt; color: #5b6b7b; }
  .filete { height: 4px; margin: 8px 0 10px; background: linear-gradient(90deg, #0B8A4B 0 40%, #7C9A2F 40% 62%, #1F5FA8 62% 82%, #D9531E 82% 100%); }
  h2 { font-size: 13pt; color: #0b5e3a; margin: 4px 0 6px; } h3 { font-size: 10.5pt; color: #0b5e3a; margin: 12px 0 5px; break-after: avoid; }
  h2 small, h3 small { font-weight: 400; color: #5b6b7b; font-size: 8.5pt; }
  .quebra { break-before: page; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin: 4px 0 8px; }
  .kpi { border: 1px solid #cfd8e1; border-radius: 8px; padding: 6px 9px; } .kpi .n { font-size: 16pt; font-weight: 700; color: #0b5e3a; }
  .kpi .t { font-size: 7.5pt; color: #5b6b7b; text-transform: uppercase; letter-spacing: .3px; } .kpi .s { font-size: 7.5pt; color: #5b6b7b; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 7pt; color: #5b6b7b; text-transform: uppercase; letter-spacing: .3px; text-align: left; padding: 4px 5px; border-bottom: 2px solid #0b8a4b; }
  td { padding: 3px 5px; border-bottom: 1px solid #e4e9ee; vertical-align: middle; }
  tr { break-inside: avoid; } tr:nth-child(even) td { background: #f6f9fb; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } th.n { text-align: right; }
  .dep td { font-size: 8.5pt; } .vot td { font-size: 7.4pt; line-height: 1.25; }
  .vot .p { font-weight: 700; white-space: nowrap; } .vot .e { color: #5b6b7b; }
  .vot td:nth-child(2) { width: 58%; } .vot th { white-space: nowrap; }
  .cel-barra { white-space: nowrap; } .cel-barra span { font-size: 7pt; color: #5b6b7b; margin-left: 4px; }
  .fora { color: #5b6b7b; font-size: 7.5pt; }
  .leg { display: flex; gap: 14px; flex-wrap: wrap; font-size: 7.5pt; color: #33414f; margin: 4px 0 6px; }
  .leg i { display: inline-block; width: 10px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .caixa { border: 1px solid #cfd8e1; border-radius: 8px; padding: 8px 10px; margin: 6px 0; break-inside: avoid; }
  .nota { font-size: 8pt; color: #33414f; line-height: 1.45; } .nota li { margin-bottom: 3px; }
  .aviso { border: 1px solid #e0a030; background: #fff8e6; border-radius: 8px; padding: 7px 10px; font-size: 8pt; margin: 6px 0; }
</style></head><body>
<div class="cab">${logo ? `<img src="${logo}" alt="Podemos">` : ''}<div><div class="org">Liderança do Podemos na Câmara dos Deputados</div>
  <h1>Aderência da bancada do ${legEsc(P)} às orientações do Governo</h1>
  <div class="sub">${RT.sub} · votações nominais do Plenário com orientação Sim ou Não do Governo · fonte: Câmara dos Deputados (dados abertos) · gerado em ${hojeBR}</div></div></div>
<div class="filete"></div>
${unico ? '' : `<h2>${RT.resumo}</h2>
<div class="kpis">${kpi(RT.kpiTotal, legPct(100 * T.a / T.n), 'dos votos possíveis da bancada')}${kpi('Votações analisadas', legFmt(T.v), 'nominais, com orientação do Governo')}${kpi('Divergência', legPct(100 * T.d / T.n), 'votou contra a orientação')}${kpi('Ausência', legPct(100 * T.x / T.n), 'inclui abstenção e obstrução')}</div>
<table><thead><tr><th>Ano</th><th>Período</th><th class="n">Votações</th><th class="n">Deputados*</th><th>Composição dos votos</th><th class="n">Aderência</th><th class="n">Divergência</th><th class="n">Ausência</th></tr></thead><tbody>
${L.anos.map(a => `<tr><td><b>${a.ano}</b></td><td style="white-space:nowrap">${legPeriodoTxt(a, L)}</td><td class="n">${a.vot.length}</td><td class="n">${a.deps.length}</td><td class="cel-barra">${legSvgBarra(a.tot, a.tot.n, 120, 10)}</td><td class="n"><b>${legPct(100 * a.tot.a / a.tot.n)}</b></td><td class="n">${legPct(100 * a.tot.d / a.tot.n)}</td><td class="n">${legPct(100 * a.tot.x / a.tot.n)}</td></tr>`).join('')}
<tr><td><b>${RT.linhaTotal}</b></td><td style="white-space:nowrap">${RT.periodoTotal}</td><td class="n"><b>${T.v}</b></td><td class="n"></td><td class="cel-barra">${legSvgBarra(T, T.n, 120, 10)}</td><td class="n"><b>${legPct(100 * T.a / T.n)}</b></td><td class="n">${legPct(100 * T.d / T.n)}</td><td class="n">${legPct(100 * T.x / T.n)}</td></tr>
</tbody></table>
${legenda}
<div class="nota">* Deputados que fizeram parte da bancada em ao menos uma votação do ano (a bancada é a de cada votação: quem era do ${legEsc(P)} e estava em exercício naquele dia).</div>
<h3>Aderência mês a mês <small>votos que seguiram o Governo ÷ votos possíveis da bancada no mês</small></h3>
<div class="caixa">${legSvgMeses(L.anos.flatMap(a => a.meses), 690, 160, true)}</div>`}
${L.desconsiderados.length ? `<div class="aviso"><b>Fora da bancada, embora a Câmara registre os votos como ${legEsc(L.sigla)}.</b> ${legEsc(legTextoDesconsiderados(L))}. Ver "Registro transitório" na nota de método.</div>` : ''}
${L.falhasHistorico ? `<div class="aviso">O histórico de alguns deputados não pôde ser lido (${L.falhasHistorico} leitura(s)); nas votações em que eles não votaram, valeu a bancada de hoje.</div>` : ''}
`;
  for (const a of L.anos) {
    h += `${unico ? '' : '<div class="quebra"></div>'}<h2>${a.ano} <small>${legDataBR(a.ini)} a ${legDataBR(a.fim)}</small></h2>
<div class="kpis">${kpi('Aderência', legPct(100 * a.tot.a / a.tot.n), `${legFmt(a.tot.a)} de ${legFmt(a.tot.n)} votos possíveis`)}${kpi('Votações', a.vot.length, `Governo orientou Sim em ${a.vot.filter(v => v.gov === 'Sim').length}`)}${kpi('Divergência', legPct(100 * a.tot.d / a.tot.n), `${legFmt(a.tot.d)} votos`)}${kpi('Deputados na bancada', a.deps.length, 'em ao menos uma votação')}</div>
<h3>Aderência mês a mês</h3><div class="caixa">${legSvgMeses(a.meses, 690, 130)}</div>
<h3>Membros da bancada <small>cada deputado medido só nas votações em que era do ${legEsc(P)}</small></h3>
<table class="dep"><thead><tr><th>#</th><th>Deputado</th><th>UF</th><th class="n">Votações</th><th class="n">Aderiu</th><th class="n">Divergiu</th><th class="n">Ausente</th><th>Composição</th><th class="n">Aderência</th></tr></thead><tbody>
${a.deps.map((d, i) => `<tr><td>${i + 1}</td><td><b>${legEsc(d.nome)}</b>${d.atual ? '' : ' <span class="fora">· fora da bancada hoje</span>'}</td><td>${legEsc(d.uf)}</td><td class="n">${d.n}</td><td class="n">${d.a}</td><td class="n">${d.d}</td><td class="n">${d.x}</td><td class="cel-barra">${legSvgBarra(d, d.n, 110, 9)}</td><td class="n"><b>${legPct(d.pct)}</b></td></tr>`).join('')}
</tbody></table>${legenda}
<h3>Votações <small>${a.vot.length} · a barra mostra os votos da bancada do ${legEsc(P)} naquela votação</small></h3>
<table class="vot"><thead><tr><th>Data</th><th>Proposição e votação</th><th>Gov.</th><th>Bancada <small>(ader. · aus. · div.)</small></th><th class="n">Aderência</th></tr></thead><tbody>
${a.vot.map(v => `<tr><td class="n">${legDataBR(v.data)}</td><td><span class="p">${legEsc(v.rotulo)}</span> — ${legEsc(v.desc)}${v.ementa ? `<br><span class="e">${legEsc(v.ementa)}</span>` : ''}</td><td>${legEsc(v.gov)}</td><td class="cel-barra">${legSvgBarra(v.c, v.n, 96, 9)}<span>${v.c.a} · ${v.c.x} · ${v.c.d}</span></td><td class="n"><b>${legPct(v.pct, 0)}</b></td></tr>`).join('')}
</tbody></table>`;
  }
  h += `<div class="quebra"></div><h2>Nota de método</h2><div class="nota"><ul>${legNotaMetodo(L).map(([b, t]) => `<li><b>${legEsc(b)}</b>${legEsc(t)}</li>`).join('')}</ul></div>`;
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

function legPngBarra(c, n, w = 480, h = 36) {
  const cv = legCanvas(w, h), g = cv.getContext('2d');
  let x = 0;
  for (const k of LEG_ORDEM) {
    const ww = n ? w * c[k] / n : 0;
    const fim = x + ww - (x + ww < w - 0.5 ? 4 : 0);
    if (ww > 0 && fim > x) { g.fillStyle = LEG_COR[k]; legRetRedondo(g, x, 0, fim - x, h, 6); }
    x += ww;
  }
  return legPng(cv);
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

function legPngFilete() {
  const cv = legCanvas(1400, 8), g = cv.getContext('2d');
  [['#0B8A4B', 0, 0.40], ['#7C9A2F', 0.40, 0.62], ['#1F5FA8', 0.62, 0.82], ['#D9531E', 0.82, 1]]
    .forEach(([cor, a, b]) => { g.fillStyle = cor; g.fillRect(a * 1400, 0, (b - a) * 1400, 8); });
  return legPng(cv);
}

function legPngQuadrado(cor) {
  const cv = legCanvas(30, 24), g = cv.getContext('2d');
  g.fillStyle = cor; g.fillRect(0, 0, 30, 24);
  return legPng(cv);
}

async function legDocx(L) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
    AlignmentType, HeadingLevel, Footer, PageNumber, VerticalAlign, TableLayoutType, LevelFormat } = docx;
  const P = legNomePartido(L.sigla), T = L.todos, RT = legRotulos(L);
  const unico = L.anos.length === 1;   // um ano só: sem o resumo, que repetiria a seção do ano
  const VERDE = '0B8A4B', VERDE2 = '0B5E3A', CINZA = '5B6B7B', TEXTO = '1B2430', LINHA = 'E4E9EE', FUNDO = 'F6F9FB', BORDA = 'CFD8E1', FONTE = 'Arial';
  const LARG = 10546;   // A4 menos as margens de 680
  const t = (text, o = {}) => new TextRun(Object.assign({ text: String(text), font: FONTE, size: 17, color: TEXTO }, o));
  const par = (runs, o = {}) => new Paragraph(Object.assign({ children: Array.isArray(runs) ? runs : [runs], spacing: { after: 60 } }, o));
  const img = (data, w, h) => new ImageRun({ type: 'png', data, transformation: { width: w, height: h } });
  const nada = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const semBorda = { top: nada, bottom: nada, left: nada, right: nada };
  const bordaLinha = { top: nada, left: nada, right: nada, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINHA } };
  const bordaCab = Object.assign({}, bordaLinha, { bottom: { style: BorderStyle.SINGLE, size: 12, color: VERDE } });
  const caixa = (cor, sz) => { const b = { style: BorderStyle.SINGLE, size: sz, color: cor }; return { top: b, bottom: b, left: b, right: b }; };
  const cel = (filhos, w, o = {}) => new TableCell(Object.assign({ children: filhos, width: { size: w, type: WidthType.DXA }, borders: bordaLinha,
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 70, right: 70 } }, o));
  const R = AlignmentType.RIGHT, E = AlignmentType.LEFT;
  function tabela(cab, linhas, larguras, alinh = []) {
    const rCab = new TableRow({ tableHeader: true, children: cab.map((c, i) => cel([par(t(c.toUpperCase(), { size: 13, color: CINZA, bold: true }), { alignment: alinh[i] || E, spacing: { after: 0 } })], larguras[i], { borders: bordaCab })) });
    const rs = linhas.map((l, k) => new TableRow({ cantSplit: true, children: l.map((c, i) => cel(Array.isArray(c) ? c : [par(c, { alignment: alinh[i] || E, spacing: { after: 0 } })], larguras[i],
      k % 2 ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: FUNDO } } : {})) }));
    return new Table({ width: { size: larguras.reduce((s, x) => s + x, 0), type: WidthType.DXA }, columnWidths: larguras, layout: TableLayoutType.FIXED, rows: [rCab, ...rs] });
  }
  function kpis(itens) {
    const w = Math.floor(LARG / itens.length);
    return new Table({ width: { size: w * itens.length, type: WidthType.DXA }, columnWidths: itens.map(() => w), layout: TableLayoutType.FIXED, rows: [new TableRow({ children: itens.map(([tit, num, sub]) =>
      cel([par(t(tit.toUpperCase(), { size: 13, color: CINZA }), { spacing: { after: 0 } }), par(t(num, { size: 32, bold: true, color: VERDE2 }), { alignment: R, spacing: { after: 0 } }),
        par(t(sub, { size: 14, color: CINZA }), { spacing: { after: 0 } })], w, { borders: caixa(BORDA, 4), margins: { top: 80, bottom: 80, left: 120, right: 120 } })) })] });
  }
  const titulo = (txt, sub, quebra) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: !!quebra, spacing: { before: 0, after: 100 },
    children: [t(txt, { size: 26, bold: true, color: VERDE2 }), ...(sub ? [t('  ' + sub, { size: 17, color: CINZA })] : [])] });
  const subtit = (txt, sub) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 200, after: 80 },
    children: [t(txt, { size: 21, bold: true, color: VERDE2 }), ...(sub ? [t('  ' + sub, { size: 16, color: CINZA })] : [])] });
  const quad = { a: legPngQuadrado(LEG_COR.a), x: legPngQuadrado(LEG_COR.x), d: legPngQuadrado(LEG_COR.d) };
  const legenda = () => par([img(quad.a, 10, 8), t('  Aderiu (votou como o Governo orientou)     ', { size: 14, color: '33414F' }),
    img(quad.x, 10, 8), t('  Ausente, abstenção ou obstrução     ', { size: 14, color: '33414F' }),
    img(quad.d, 10, 8), t('  Divergiu', { size: 14, color: '33414F' })], { spacing: { before: 60, after: 80 } });
  const aviso = txt => new Table({ width: { size: LARG, type: WidthType.DXA }, columnWidths: [LARG], rows: [new TableRow({ children: [cel([par(txt, { spacing: { after: 0 } })], LARG,
    { borders: caixa('E0A030', 6), shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF8E6' }, margins: { top: 100, bottom: 100, left: 140, right: 140 } })] })] });

  let logo = null;
  try { const r = await fetch(chrome.runtime.getURL('icons/podemos-logo.png')); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()); } catch (_) {}

  const filhos = [];
  filhos.push(new Table({ width: { size: LARG, type: WidthType.DXA }, columnWidths: [1650, LARG - 1650], layout: TableLayoutType.FIXED, rows: [new TableRow({ children: [
    cel([par(logo ? img(logo, 96, 44) : t(''), { spacing: { after: 0 } })], 1650, { borders: semBorda }),
    cel([par(t('LIDERANÇA DO PODEMOS NA CÂMARA DOS DEPUTADOS', { size: 17, bold: true, color: VERDE }), { spacing: { after: 20 } }),
      par(t(`Aderência da bancada do ${P} às orientações do Governo`, { size: 29, bold: true }), { spacing: { after: 20 } }),
      par(t(`${RT.sub} · votações nominais do Plenário com orientação Sim ou Não do Governo · fonte: Câmara dos Deputados (dados abertos) · gerado em ${legDataBR(L.hoje)}`, { size: 16, color: CINZA }), { spacing: { after: 0 } })],
    LARG - 1650, { borders: semBorda })] })] }));
  filhos.push(par(img(legPngFilete(), 700, 4), { spacing: { before: 100, after: 160 } }));
  if (!unico) {
    filhos.push(titulo(RT.resumo));
    filhos.push(kpis([[RT.kpiTotal, legPct(100 * T.a / T.n), 'dos votos possíveis da bancada'], ['Votações analisadas', legFmt(T.v), 'nominais, com orientação do Governo'],
      ['Divergência', legPct(100 * T.d / T.n), 'votou contra a orientação'], ['Ausência', legPct(100 * T.x / T.n), 'inclui abstenção e obstrução']]));
    filhos.push(par(t(''), { spacing: { after: 60 } }));
    filhos.push(tabela(['Ano', 'Período', 'Votações', 'Deputados*', 'Composição dos votos', 'Aderência', 'Divergência', 'Ausência'],
      [...L.anos.map(a => [t(a.ano, { bold: true }), t(legPeriodoTxt(a, L)), t(a.vot.length), t(a.deps.length), [par(img(legPngBarra(a.tot, a.tot.n), 150, 11), { spacing: { after: 0 } })],
        t(legPct(100 * a.tot.a / a.tot.n), { bold: true }), t(legPct(100 * a.tot.d / a.tot.n)), t(legPct(100 * a.tot.x / a.tot.n))]),
       [t(RT.linhaTotal, { bold: true }), t(RT.periodoTotal), t(T.v, { bold: true }), t(''),
        [par(img(legPngBarra(T, T.n), 150, 11), { spacing: { after: 0 } })], t(legPct(100 * T.a / T.n), { bold: true }), t(legPct(100 * T.d / T.n)), t(legPct(100 * T.x / T.n))]],
      [1250, 1650, 1000, 1150, 2350, 1050, 1050, 1046], [E, E, R, R, E, R, R, R]));
    filhos.push(legenda());
    filhos.push(par(t(`* Deputados que fizeram parte da bancada em ao menos uma votação do ano (a bancada é a de cada votação: quem era do ${P} e estava em exercício naquele dia).`, { size: 15, color: '33414F' })));
    filhos.push(subtit('Aderência mês a mês', 'votos que seguiram o Governo ÷ votos possíveis da bancada no mês'));
    filhos.push(par(img(legPngMeses(L.anos.flatMap(a => a.meses), true), 690, 160), { spacing: { after: 120 } }));
  }
  if (L.desconsiderados.length) {
    filhos.push(aviso([t(`Fora da bancada, embora a Câmara registre os votos como ${L.sigla}. `, { bold: true, size: 16 }),
      t(legTextoDesconsiderados(L) + '. Ver "Registro transitório" na nota de método.', { size: 16 })]));
  }
  if (L.falhasHistorico) {
    filhos.push(aviso([t(`O histórico de alguns deputados não pôde ser lido (${L.falhasHistorico} leitura(s)); nas votações em que eles não votaram, valeu a bancada de hoje.`, { size: 16 })]));
  }

  for (const a of L.anos) {
    filhos.push(titulo(a.ano, `${legDataBR(a.ini)} a ${legDataBR(a.fim)}`, !unico));
    filhos.push(kpis([['Aderência', legPct(100 * a.tot.a / a.tot.n), `${legFmt(a.tot.a)} de ${legFmt(a.tot.n)} votos possíveis`],
      ['Votações', String(a.vot.length), `Governo orientou Sim em ${a.vot.filter(v => v.gov === 'Sim').length}`],
      ['Divergência', legPct(100 * a.tot.d / a.tot.n), `${legFmt(a.tot.d)} votos`], ['Deputados na bancada', String(a.deps.length), 'em ao menos uma votação']]));
    filhos.push(subtit('Aderência mês a mês'));
    filhos.push(par(img(legPngMeses(a.meses, false, 2070, 400), 690, 133), { spacing: { after: 80 } }));
    filhos.push(subtit('Membros da bancada', `cada deputado medido só nas votações em que era do ${P}`));
    filhos.push(tabela(['#', 'Deputado', 'UF', 'Votações', 'Aderiu', 'Divergiu', 'Ausente', 'Composição', 'Aderência'],
      a.deps.map((d, i) => [t(i + 1), [par([t(d.nome, { bold: true }), ...(d.atual ? [] : [t(' · fora da bancada hoje', { size: 14, color: CINZA })])], { spacing: { after: 0 } })],
        t(d.uf), t(d.n), t(d.a), t(d.d), t(d.x), [par(img(legPngBarra(d, d.n), 110, 8), { spacing: { after: 0 } })], t(legPct(d.pct), { bold: true })]),
      [450, 3300, 550, 1000, 850, 900, 900, 1600, 996], [E, E, E, R, R, R, R, E, R]));
    filhos.push(legenda());
    filhos.push(subtit('Votações', `${a.vot.length} · a barra mostra os votos da bancada do ${P} naquela votação`));
    filhos.push(tabela(['Data', 'Proposição e votação', 'Gov.', 'Bancada (aderiu · ausente · divergiu)', 'Aderência'],
      a.vot.map(v => [t(legDataBR(v.data), { size: 15 }),
        [par([t(v.rotulo, { bold: true, size: 15 }), t(' — ' + v.desc, { size: 15 })], { spacing: { after: 0 } }), ...(v.ementa ? [par(t(v.ementa, { size: 14, color: CINZA }), { spacing: { after: 0 } })] : [])],
        t(v.gov, { size: 15 }), [par([img(legPngBarra(v.c, v.n), 96, 7), t(`  ${v.c.a} · ${v.c.x} · ${v.c.d}`, { size: 13, color: CINZA })], { spacing: { after: 0 } })],
        t(legPct(v.pct, 0), { bold: true, size: 15 })]),
      [1050, 5646, 550, 2200, 1100], [E, E, E, E, R]));
  }
  filhos.push(titulo('Nota de método', null, true));
  for (const [b, txt] of legNotaMetodo(L)) {
    filhos.push(new Paragraph({ numbering: { reference: 'marcas', level: 0 }, spacing: { after: 80 }, children: [t(b, { bold: true, size: 16 }), t(txt, { size: 16, color: '33414F' })] }));
  }

  const rodape = (txt) => t(txt, { size: 13, color: CINZA });
  return Packer.toBlob(new Document({
    creator: 'Liderança do Podemos na Câmara dos Deputados',
    title: `Aderência da bancada do ${P} às orientações do Governo — ${RT.escopo}`,
    styles: { default: { document: { run: { font: FONTE, size: 17, color: TEXTO } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTE, size: 26, bold: true, color: VERDE2 }, paragraph: { outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTE, size: 21, bold: true, color: VERDE2 }, paragraph: { outlineLevel: 1 } }] },
    numbering: { config: [{ reference: 'marcas', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 740, bottom: 800, left: 680, right: 680, footer: 360 } } },
      footers: { default: new Footer({ children: [par([rodape(`Liderança do Podemos na Câmara dos Deputados · Aderência às orientações do Governo, ${RT.escopo} · página `),
        new TextRun({ children: [PageNumber.CURRENT], font: FONTE, size: 13, color: CINZA }), rodape(' de '),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONTE, size: 13, color: CINZA })], { alignment: R })] }) },
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
