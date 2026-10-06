'use strict';
// Labs · Perfil da Bancada — TELA e RELATÓRIO em PDF.
//
// Compara as candidaturas e os eleitos do partido em 2022 e 2026, por cargo,
// nos recortes do núcleo (labs-perfil-nucleo.js): gênero, cor/raça, faixa
// etária, escolaridade, região, ocupação e a trajetória dos eleitos de 2026.
//
// Dados: o cadastro de candidaturas do TSE (consulta_cand, ~2 MB por eleição)
// e, opcionalmente, os votos do arquivo por município (centenas de MB) — os
// dois lidos do servidor de arquivos do TSE por pedidos parciais (as funções
// de zip remoto do Mapa Territorial, labs-mapa.js). Processado uma vez,
// gravado no banco em /labs/perfil/{ano}; a equipe só lê.
//
// Depende de labs.js, labs-mapa-nucleo.js, labs-mapa.js e labs-perfil-nucleo.js.

const LP_BASE = '/labs/perfil';
const LP_ZIP_CAD = ano => `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ano}.zip`;
const lp = { dados: {}, grupo: 'fed', processado: null };

function lpEl(id) { return document.getElementById(id); }
function lpNum(n) { return Math.round(n || 0).toLocaleString('pt-BR'); }
function lpPct(a, b) { return b ? (100 * a / b).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%' : '—'; }
function lpVar(a, b) { if (!a) return b ? 'novo' : '—'; const p = (b - a) / a * 100; return (p >= 0 ? '+' : '−') + Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%'; }
function lpEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ---------- conteúdo (o mesmo HTML na tela e no PDF; o CSS de cada um dá a cor) ----------
function lpTemVotos(porAno) { return LPN_ANOS.every(a => porAno[a] && porAno[a].meta && porAno[a].meta.votos); }

function lpCartoes(porAno, grupo) {
  const [a, b] = LPN_ANOS.map(x => lpnResumo(porAno[x], grupo));
  const c = (v, l, cor) => `<div class="lp-cartao" style="border-top-color:${cor}"><b>${v}</b><span>${l}</span></div>`;
  return `<div class="lp-cartoes">
    ${c(`${a.eleitos} → ${b.eleitos} <small>${lpVar(a.eleitos, b.eleitos)}</small>`, `eleitos (${LPN_ANOS.join(' → ')})`, '#0B8A4B')}
    ${c(`${a.mulheresEl} → ${b.mulheresEl} <small>${lpPct(a.mulheresEl, a.eleitos)} → ${lpPct(b.mulheresEl, b.eleitos)}</small>`, 'mulheres eleitas', '#C2185B')}
    ${c(`${a.negrosEl} → ${b.negrosEl} <small>${lpPct(a.negrosEl, a.eleitos)} → ${lpPct(b.negrosEl, b.eleitos)}</small>`, 'pessoas negras eleitas (pretas e pardas)', '#7C9A2F')}
    ${c(`${a.idadeMedia != null ? Math.round(a.idadeMedia) : '—'} → ${b.idadeMedia != null ? Math.round(b.idadeMedia) : '—'} anos`, 'idade média dos eleitos, na data da eleição', '#1F5FA8')}
    ${b.comTrajetoria ? c(`${b.estreantes} <small>de ${b.eleitos}</small>`, `estreantes entre os eleitos de ${LPN_ANOS[1]} (sem candidatura em ${LPN_ANOS[0]})`, '#D9531E') : ''}
    ${lpTemVotos(porAno) ? c(`${lpPct(a.votosMulheres, a.votos)} → ${lpPct(b.votosMulheres, b.votos)}`, 'dos votos do partido foram para mulheres', '#8E44AD') : ''}
  </div>`;
}

/** Tabela de um recorte: eleitos, candidaturas e (se houver) votos, com a fatia de cada categoria. */
function lpRecorteHtml(porAno, grupo, recorte, titulo) {
  const l = lpnTabela(porAno, grupo, recorte);
  const tot = k => LPN_ANOS.map((_, j) => l.reduce((s, x) => s + x[k][j], 0));
  const TE = tot('el'), TC = tot('cand'), TV = tot('votos'), votos = lpTemVotos(porAno);
  const cel = (x, k, T, j) => `<td class="num">${lpNum(x[k][j])} <span class="p">${lpPct(x[k][j], T[j])}</span></td>`;
  const barra = x => LPN_ANOS.map((a, j) => `<i class="lp-b${j}" style="width:${TE[j] ? 100 * x.el[j] / TE[j] : 0}%" title="${a}: ${lpPct(x.el[j], TE[j])} dos eleitos"></i>`).join('');
  return `<div class="lp-caixa"><h3>${lpEsc(titulo)}</h3><table class="lp-tab">
    <tr><th>Categoria</th><th class="num">Eleitos ${LPN_ANOS[0]}</th><th class="num">${LPN_ANOS[1]}</th><th class="barras">fatia dos eleitos</th>
      <th class="num">Candidaturas ${LPN_ANOS[0]}</th><th class="num">${LPN_ANOS[1]}</th>${votos ? `<th class="num">Votos ${LPN_ANOS[0]}</th><th class="num">${LPN_ANOS[1]}</th>` : ''}</tr>
    ${l.map(x => `<tr><td>${lpEsc(x.cat)}</td>${cel(x, 'el', TE, 0)}${cel(x, 'el', TE, 1)}<td class="barras"><div class="lp-barras">${barra(x)}</div></td>
      ${cel(x, 'cand', TC, 0)}${cel(x, 'cand', TC, 1)}${votos ? cel(x, 'votos', TV, 0) + cel(x, 'votos', TV, 1) : ''}</tr>`).join('')}
    <tr class="tot"><td>Total</td><td class="num">${lpNum(TE[0])}</td><td class="num">${lpNum(TE[1])}</td><td></td><td class="num">${lpNum(TC[0])}</td><td class="num">${lpNum(TC[1])}</td>${votos ? `<td class="num">${lpNum(TV[0])}</td><td class="num">${lpNum(TV[1])}</td>` : ''}</tr>
  </table></div>`;
}

function lpTrajetoriaHtml(porAno, grupo) {
  const atual = LPN_ANOS[1], dados = porAno[atual];
  const el = lpnDoGrupo(dados, grupo).filter(r => lpnEleito(r.s));
  if (!el.length || !el.some(r => r.t)) return '';
  const l = lpnTabela({ [atual]: dados }, grupo, 'trajetoria', [atual]).filter(x => x.el[0]);
  return `<div class="lp-caixa"><h3>De onde vieram os eleitos de ${atual}</h3><table class="lp-tab">
    <tr><th>Trajetória (pela eleição de ${LPN_ANOS[0]})</th><th class="num">Eleitos</th><th class="barras"></th></tr>
    ${l.map(x => `<tr><td>${lpEsc(x.cat)}</td><td class="num">${x.el[0]} <span class="p">${lpPct(x.el[0], el.length)}</span></td><td class="barras"><div class="lp-barras"><i class="lp-b1" style="width:${100 * x.el[0] / el.length}%"></i></div></td></tr>`).join('')}
  </table><p class="p">"Estreante" = sem candidatura em ${LPN_ANOS[0]} (pode ter tido mandato municipal ou eleição anterior a ${LPN_ANOS[0]}).</p></div>`;
}

function lpListaHtml(porAno, grupo) {
  const atual = LPN_ANOS[1];
  const el = lpnDoGrupo(porAno[atual], grupo).filter(r => lpnEleito(r.s)).sort((a, b) => (b.v || 0) - (a.v || 0) || a.u.localeCompare(b.u));
  if (!el.length) return '';
  const votos = lpTemVotos(porAno);
  return `<div class="lp-caixa lp-lista"><h3>Eleitos de ${atual} — ${lpEsc(LPN_GRUPOS[grupo].nome.toLowerCase())} (${el.length})</h3><table class="lp-tab">
    <tr><th>Nome</th><th>UF</th><th>Gênero</th><th>Cor/raça</th><th class="num">Idade</th><th>Escolaridade</th><th>Ocupação</th>${votos ? '<th class="num">Votos</th>' : ''}<th>Em ${LPN_ANOS[0]}</th></tr>
    ${el.map(r => `<tr><td><b>${lpEsc(lmnNomeProprio(r.n))}</b></td><td>${lpEsc(r.u)}</td><td>${lpEsc(lpnCategoria(r, 'genero').replace('Mulheres', 'Mulher').replace('Homens', 'Homem'))}</td>
      <td>${lpEsc(lpnCategoria(r, 'raca'))}</td><td class="num">${r.i != null ? r.i : '—'}</td><td>${lpEsc(lpnCategoria(r, 'escolaridade'))}</td><td>${lpEsc(lpnCategoria(r, 'ocupacao'))}</td>
      ${votos ? `<td class="num">${lpNum(r.v)}</td>` : ''}<td>${lpEsc(r.ant || (r.t === 'Estreante' ? 'Estreante' : '—'))}</td></tr>`).join('')}
  </table></div>`;
}

function lpConteudoHtml(porAno, grupo) {
  return lpCartoes(porAno, grupo)
    + `<div class="lp-grade">${LPN_RECORTES.map(([k, t]) => lpRecorteHtml(porAno, grupo, k, t)).join('')}${lpTrajetoriaHtml(porAno, grupo)}</div>`
    + lpListaHtml(porAno, grupo);
}

// ---------- tela ----------
async function lpCarregar() {
  const st = lpEl('lpSituacao');
  try {
    const lidos = await Promise.all(LPN_ANOS.map(a => mpFb(`${LP_BASE}/${a}`)));
    LPN_ANOS.forEach((a, i) => { lp.dados[a] = lidos[i] && lidos[i].c ? lidos[i] : null; });
    const metas = LPN_ANOS.map(a => lp.dados[a] && lp.dados[a].meta);
    st.innerHTML = metas.every(Boolean)
      ? `Processado em <b>${lpEsc(new Date(metas[1].atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</b> (${lpEsc(metas[1].origem || '?')})${metas.every(m => m.votos) ? ', com os votos' : ', sem os votos'}. Arquivos do TSE gerados em ${lpEsc(metas.map(m => m.geradoTse || '?').join(' e '))}.`
      : '<b>Ainda não processado.</b> Use <b>Baixar do TSE e processar</b> abaixo.';
  } catch (e) { st.textContent = 'Não foi possível ler o banco: ' + e.message; }
  lpRender();
}

function lpRender() {
  const ok = LPN_ANOS.every(a => lp.dados[a]);
  lpEl('lpPdf').disabled = !ok;
  if (lpEl('lpMulheres')) lpEl('lpMulheres').disabled = !ok;
  lpEl('lpResultado').innerHTML = ok ? lpConteudoHtml(lp.dados, lp.grupo) : '<p class="sub">Sem dados processados ainda.</p>';
}

// ---------- download do TSE com um clique ----------
async function lpIndice(url, filtro) {
  const total = await mpTamanhoRemoto(url);
  const todas = await mpEntradasZip(total, async (ini, n) => new Uint8Array(await (await mpFaixa(url, ini, ini + n - 1)).arrayBuffer()));
  return { url, entradas: todas.filter(filtro) };
}

async function lpProcessarClick() {
  const bt = lpEl('lpBaixar'), comVotos = lpEl('lpComVotos').checked;
  bt.disabled = true;
  lpEl('lpUpResultado').innerHTML = '';
  const st = m => labsStatus('lpUpStatus', m, 'loading');
  try {
    st('Lendo o índice dos arquivos do TSE…');
    const cad = {}, vot = {};
    for (const a of LPN_ANOS) {
      cad[a] = await lpIndice(LP_ZIP_CAD(a), e => /_BRASIL\.csv$/i.test(e.nome));
      if (!cad[a].entradas.length) throw new Error(`o cadastro de ${a} no TSE não tem o arquivo do Brasil`);
      if (comVotos) vot[a] = await lpIndice(MP_TSE_ZIP(a), e => !!mpUfDaEntrada(e.nome));
    }
    const ixs = Object.values(cad).concat(Object.values(vot));
    // O cadastro do ano atual é lido duas vezes (a segunda para o destino dos eleitos anteriores).
    const mb = [cad[LPN_ANOS[1]]].concat(ixs).reduce((s, ix) => s + ix.entradas.reduce((t, e) => t + e.comprimido, 0), 0) / 1e6;
    labsStatus('lpUpStatus', '');
    if (!confirm(`Baixar ${mb.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MB do TSE — cadastro de candidaturas de ${LPN_ANOS.join(' e ')}${comVotos ? ' e os votos por município de todos os estados' : ''}?\n\nO processamento roda aqui; nada é gravado antes da sua confirmação. CPF, e-mail e título de eleitor do cadastro não são lidos.`)) return;
    let feito = 0;
    const ler = async (ix, rotulo, fn) => {
      for (const e of ix.entradas) {
        await mpLerEntradaRemota(ix.url, e, fn, n => st(`${rotulo} ${mpUfDaEntrada(e.nome) || ''} — ${((feito + n) / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} de ${mb.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MB`));
        feito += e.comprimido;
      }
    };
    const [a0, a1] = LPN_ANOS;
    const l1 = lpnLeitorCadastro(a1);
    await ler(cad[a1], `Cadastro de ${a1}`, l => l1.linha(l));
    const c1 = l1.resultado();
    const l0 = lpnLeitorCadastro(a0, LPN_PARTIDO, lpnProcurados(c1));
    await ler(cad[a0], `Cadastro de ${a0}`, l => l0.linha(l));
    const c0 = l0.resultado();
    lpnTrajetorias(c1, c0.achados);
    // E o caminho dos eleitos de a0 em a1 (o cadastro de a1 de novo, agora procurando por eles; ~1,5 MB).
    const l1b = lpnLeitorCadastro(a1, LPN_PARTIDO, lpnProcurados(c0));
    await ler(cad[a1], `Cadastro de ${a1} (trajetórias)`, l => l1b.linha(l));
    lpnDestinos(c0, l1b.resultado().achados, a1);
    if (comVotos) for (const [a, c] of [[a0, c0], [a1, c1]]) {
      const s = lpnSomadorVotos(c);
      for (const e of vot[a].entradas) {
        s.novoArquivo();
        await mpLerEntradaRemota(vot[a].url, e, l => s.linha(l), n => st(`Votos de ${a} · ${mpUfDaEntrada(e.nome)} — ${((feito + n) / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} de ${mb.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MB`));
        feito += e.comprimido;
      }
    }
    const meta = { atualizadoEm: new Date().toISOString(), origem: 'extensão (TSE, 1 clique)', votos: comVotos };
    lp.processado = { [a0]: lpnParaBanco(c0, Object.assign({ geradoTse: c0.gerado }, meta)), [a1]: lpnParaBanco(c1, Object.assign({ geradoTse: c1.gerado }, meta)) };
    labsStatus('lpUpStatus', '');
    const r = LPN_ANOS.map(a => lpnResumo(lp.processado[a], 'fed'));
    lpEl('lpUpResultado').innerHTML = `<div class="sub" style="margin-top:8px">Deputado(a) federal: ${r[0].cand} → ${r[1].cand} candidaturas, ${r[0].eleitos} → ${r[1].eleitos} eleitos
      (${r[0].mulheresEl} → ${r[1].mulheresEl} mulheres). ${LPN_ANOS.map(a => `${a}: ${Object.keys(lp.processado[a].c).length} candidaturas do partido`).join(' · ')}.</div>
      <button id="lpGravar" class="btn-gerar" style="margin-top:8px">Gravar no banco de dados</button>`;
    lpEl('lpGravar').addEventListener('click', lpGravarClick);
    lp.dados = lp.processado;   // prévia na tela antes de gravar
    lpRender();
  } catch (e) {
    labsStatus('lpUpStatus', 'Erro: ' + e.message, 'error');
  } finally { bt.disabled = false; }
}

async function lpGravarClick() {
  if (!lp.processado || !confirm('Gravar o perfil de 2022 e 2026 no banco compartilhado? Substitui o que houver.')) return;
  const bt = lpEl('lpGravar'); bt.disabled = true;
  try {
    for (const a of LPN_ANOS) await mpFbEscrever('PUT', `${LP_BASE}/${a}`, lp.processado[a]);
    labsStatus('lpUpStatus', 'Gravado.');
    lp.processado = null; lpEl('lpUpResultado').innerHTML = '';
    await lpCarregar();
  } catch (e) { labsStatus('lpUpStatus', 'Não gravou: ' + e.message, 'error'); bt.disabled = false; }
}

// ---------- relatório em PDF ----------
function lpRelatorioHtml(porAno, grupo, op = {}) {
  const agora = op.agora || new Date(), dd = n => String(n).padStart(2, '0');
  const carimbo = `${dd(agora.getDate())}/${dd(agora.getMonth() + 1)}/${agora.getFullYear()} ${dd(agora.getHours())}:${dd(agora.getMinutes())}`;
  const metas = LPN_ANOS.map(a => (porAno[a] && porAno[a].meta) || {});
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Perfil da bancada — ${lpEsc(LPN_GRUPOS[grupo].nome)} — ${LPN_ANOS.join(' e ')}</title><style>
  :root { --verde: #0B8A4B; --verde-esc: #0b5e3a; --tinta: #1d2733; --tinta2: #5b6b7b; --grade: #dfe5ea; }
  @page { size: A4; margin: 12mm 11mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 9.5pt; line-height: 1.4; color: var(--tinta); margin: 0; background: #fff; }
  .folha { max-width: 190mm; margin: 0 auto; }
  .cab { display: flex; align-items: center; gap: 16px; padding: 6px 0 8px; } .cab img { height: 44px; } .cab .tit { flex: 1; }
  .kicker { font-size: 8.5pt; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tinta2); }
  h1 { font-size: 19pt; margin: 0; line-height: 1.15; color: var(--verde-esc); } .sub { font-size: 9pt; color: var(--tinta2); }
  .meta { text-align: right; font-size: 8.5pt; color: var(--tinta2); }
  .filete { height: 5px; margin: 0 0 10px; border-radius: 3px; background: linear-gradient(90deg, #0B8A4B 0 40%, #7C9A2F 40% 62%, #1F5FA8 62% 82%, #D9531E 82% 100%); }
  .lp-cartoes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin: 4px 0 8px; }
  .lp-cartao { border: 1px solid var(--grade); border-top: 4px solid; border-radius: 8px; padding: 5px 9px; break-inside: avoid; }
  .lp-cartao b { display: block; font-size: 14pt; } .lp-cartao b small { font-size: 9pt; color: var(--tinta2); font-weight: 600; } .lp-cartao span { font-size: 8pt; color: var(--tinta2); }
  .lp-caixa { break-inside: avoid; margin: 0 0 8px; } .lp-caixa h3 { font-size: 11pt; color: var(--verde-esc); margin: 10px 0 4px; padding-bottom: 2px; border-bottom: 2px solid var(--verde); }
  .lp-tab { width: 100%; border-collapse: collapse; } .lp-tab td, .lp-tab th { border-bottom: 1px solid var(--grade); padding: 2.5px 5px; text-align: left; font-size: 8.5pt; }
  .lp-tab th { background: #f2f6f3; color: var(--verde-esc); font-size: 7.8pt; } .lp-tab tr { break-inside: avoid; } .lp-tab tr.tot td { font-weight: 700; border-top: 1px solid #b8c4cc; }
  .lp-tab .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } .p { color: var(--tinta2); font-size: 7.5pt; }
  .barras { width: 22%; } .lp-barras i { display: block; height: 5px; border-radius: 2px; margin: 1px 0; } .lp-b0 { background: #9fc6e0; } .lp-b1 { background: #0B8A4B; }
  .legenda { font-size: 8pt; color: var(--tinta2); margin: 2px 0 6px; } .legenda i { display: inline-block; width: 12px; height: 6px; border-radius: 2px; margin: 0 3px 0 8px; }
  .lp-lista { break-before: page; } .lp-lista td { font-size: 8pt; }
  .notas { font-size: 8pt; color: var(--tinta2); margin-top: 10px; border-top: 1px solid var(--grade); padding-top: 6px; } .notas li { margin: 2px 0; }
  .barra-ferramentas { background: #eef3fb; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; display: flex; align-items: center; gap: 10px; border-radius: 6px; }
  .barra-ferramentas button { background: var(--verde); color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  @media print { .noprint { display: none !important; } .folha { max-width: none; } }
</style></head><body><div class="folha">
<div class="barra-ferramentas noprint"><button id="btn-pdf" type="button">⬇ Salvar em PDF</button><span>No diálogo, escolha <strong>Salvar como PDF</strong>. As cores vão junto.</span></div>
<div class="cab">${op.logo ? `<img src="${lpEsc(op.logo)}" alt="Podemos">` : ''}<div class="tit">
  <div class="kicker">Perfil da bancada · ${lpEsc(LPN_PARTIDO)} · eleições de ${LPN_ANOS.join(' e ')}</div>
  <h1>${lpEsc(LPN_GRUPOS[grupo].nome)}</h1>
  <div class="sub">Candidaturas e eleitos por gênero, cor/raça, idade, escolaridade, região, ocupação e trajetória</div></div>
  <div class="meta">Liderança do Podemos<br>Câmara dos Deputados<br>Gerado em ${carimbo}</div></div>
<div class="filete"></div>
<div class="legenda">Barras: fatia dos eleitos em <i class="lp-b0"></i>${LPN_ANOS[0]} <i class="lp-b1"></i>${LPN_ANOS[1]}. Percentuais em cinza: fatia da categoria no total da coluna.</div>
${lpConteudoHtml(porAno, grupo)}
<ul class="notas">
  <li><b>Fonte:</b> TSE, dados abertos — cadastro de candidaturas (consulta_cand, gerado em ${lpEsc(metas.map(m => m.geradoTse || '?').join(' e '))})${metas.every(m => m.votos) ? ' e votação por município e zona (votos nominais válidos no 1º turno)' : ''}. Gênero e cor/raça são os autodeclarados no registro da candidatura.</li>
  <li><b>Eleitos:</b> situação "eleito por QP", "eleito por média" ou "eleito". Os resultados de ${LPN_ANOS[1]} podem mudar até a diplomação.</li>
  <li><b>Idade</b> na data da eleição. <b>Pessoas negras</b> = pretas + pardas (critério do IBGE).</li>
  <li><b>Trajetória</b> dos eleitos de ${LPN_ANOS[1]}: a mesma pessoa na eleição de ${LPN_ANOS[0]} (qualquer partido e cargo), pelo nome civil na mesma UF; na falta, pelo nome de urna, se único. Mandatos municipais (2024) não entram.</li>
</ul></div></body></html>`;
}

async function lpExportarRelatorio() {
  if (!LPN_ANOS.every(a => lp.dados[a])) return;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para gerar o relatório.'); return; }
  const logo = typeof carregarLogoDataUrl === 'function' ? await carregarLogoDataUrl() : null;
  w.document.write(lpRelatorioHtml(lp.dados, lp.grupo, { logo }));
  w.document.close();
  const ligar = () => { const b = w.document.getElementById('btn-pdf'); if (b) b.addEventListener('click', () => w.print()); };
  if (w.document.readyState === 'complete') ligar(); else w.addEventListener('load', ligar);
}

if (lpEl('lpResultado')) {
  lpEl('lpGrupo').innerHTML = Object.entries(LPN_GRUPOS).map(([k, g]) => `<option value="${k}">${lpEsc(g.nome)}</option>`).join('');
  lpEl('lpGrupo').addEventListener('change', ev => { lp.grupo = ev.target.value; lpRender(); });
  lpEl('lpPdf').addEventListener('click', lpExportarRelatorio);
  lpEl('lpBaixar').addEventListener('click', lpProcessarClick);
  let carregou = false;
  document.addEventListener('labs:aba', ev => { if (ev.detail === 'aba-perfil' && !carregou) { carregou = true; lpCarregar(); } });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lpRelatorioHtml, lpConteudoHtml };
