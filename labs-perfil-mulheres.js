'use strict';
// Labs · Perfil da Bancada — RELATÓRIO "Mulheres no partido" (PDF).
//
// O recorte de gênero contado como relatório: cartões, resumo e alertas em
// texto (montados pelos números, nos dois sentidos — cresce ou cai), gráficos
// de mulheres entre eleitos e candidaturas (com a cota mínima de 30% das
// proporcionais), tabela por cargo, as eleitas da eleição atual com a
// trajetória e as eleitas da anterior com o caminho delas na atual.
// Só afirma o que os dados das duas eleições mostram (nada de "primeira vez").
//
// Depende de labs-perfil-nucleo.js e labs-perfil.js (lpEsc, lpNum, lpPct, lpVar).

const LPM_CARGOS = ['fed', 'est', 'sen'];

/** Números de gênero de um grupo numa eleição. */
function lpmGenero(dados, grupo) {
  const l = lpnDoGrupo(dados, grupo), F = l.filter(r => r.g === 'FEMININO'), el = l.filter(r => lpnEleito(r.s));
  const elF = el.filter(r => r.g === 'FEMININO');
  const v = x => x.reduce((s, r) => s + (r.v || 0), 0);
  return { cand: l.length, candF: F.length, el: el.length, elF: elF.length, votos: v(l), votosF: v(F), eleitas: elF };
}

function lpmGrafico(porAno, campo, titulo, cota) {
  const [a0, a1] = LPN_ANOS, W = 640, x0 = 170, larg = W - x0 - 60, linha = 54, H = 34 + LPM_CARGOS.length * linha;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="graf"><text x="0" y="14" class="gt">${lpEsc(titulo)}</text>`;
  LPM_CARGOS.forEach((g, i) => {
    const y = 30 + i * linha;
    s += `<text x="0" y="${y + 21}" class="gl">${lpEsc(LPN_GRUPOS[g].nome.replace(' e distrital', '/distrital'))}</text>`;
    [a0, a1].forEach((a, j) => {
      const n = lpmGenero(porAno[a], g), f = campo === 'el' ? n.elF : n.candF, t = campo === 'el' ? n.el : n.cand, p = t ? f / t : 0, yy = y + j * 20;
      s += `<rect x="${x0}" y="${yy}" width="${larg}" height="15" fill="#eef2f1" rx="3"/><rect x="${x0}" y="${yy}" width="${Math.max(2, larg * p)}" height="15" fill="${j ? '#0B8A4B' : '#9fc6e0'}" rx="3"/>`;
      s += `<text x="${x0 - 6}" y="${yy + 11.5}" class="ga">${a}</text><text x="${x0 + larg + 6}" y="${yy + 11.5}" class="gv">${t ? lpPct(f, t) : '—'}</text>`;
      s += `<text x="${x0 + Math.max(2, larg * p) + 4}" y="${yy + 11.5}" class="gn">${f} de ${t}</text>`;
    });
  });
  if (cota) { const xc = x0 + larg * cota; s += `<line x1="${xc}" x2="${xc}" y1="26" y2="${H - 8}" class="cota"/><text x="${xc + 3}" y="${H - 1}" class="gc">cota mínima de 30% (proporcionais)</text>`; }
  return s + '</svg>';
}

/** Frases do resumo e alertas, pelos números. */
function lpmTextos(porAno) {
  const [a0, a1] = LPN_ANOS, resumo = [], alertas = [];
  const n = g => [lpmGenero(porAno[a0], g), lpmGenero(porAno[a1], g)];
  const [f0, f1] = n('fed');
  if (f0.el || f1.el) {
    const cresceu = f1.elF > f0.elF;
    resumo.push(`Na <b>Câmara dos Deputados</b>, as deputadas eleitas pelo partido ${f1.elF === f0.elF ? 'continuaram' : cresceu ? 'passaram' : 'caíram'} de <b>${f0.elF} para ${f1.elF}</b> — de ${lpPct(f0.elF, f0.el)} para ${lpPct(f1.elF, f1.el)} da bancada eleita (${f0.el} → ${f1.el}).`
      + (f0.elF && f1.el !== f0.el ? ` As mulheres ${(f1.elF / f0.elF) > (f1.el / f0.el) ? 'cresceram mais' : 'cresceram menos'} que a bancada: <b>${lpVar(f0.elF, f1.elF)}</b> contra ${lpVar(f0.el, f1.el)}.` : ''));
  }
  if (lpTemVotos(porAno) && f0.votos && f1.votos) {
    resumo.push(`Os votos em candidatas a deputada federal foram de ${lpNum(f0.votosF)} para <b>${lpNum(f1.votosF)}</b> (${lpVar(f0.votosF, f1.votosF)}); a fatia delas nos votos nominais do partido foi de ${lpPct(f0.votosF, f0.votos)} para ${lpPct(f1.votosF, f1.votos)}.`);
  }
  const [s0, s1] = n('sen');
  if (s1.elF) resumo.push(`No <b>Senado</b>, o partido elegeu ${s1.elF === 1 ? 'uma senadora' : s1.elF + ' senadoras'} em ${a1} (${s1.eleitas.map(r => lpEsc(lmnNomeProprio(r.n)) + ', ' + r.u).join('; ')})${s0.el ? `; em ${a0}, elegeu ${s0.el} ao Senado, ${s0.elF} mulher(es)` : `; em ${a0} não elegeu ninguém ao Senado`}.`);
  // De onde vieram as deputadas federais eleitas.
  const ef = f1.eleitas, cat = t => ef.filter(r => r.t === t).length;
  if (ef.length && ef.some(r => r.t)) {
    const partes = [['Reeleito(a) pelo partido', 'reeleitas pelo partido'], ['Veio de outro cargo eletivo', 'vindas de outro cargo eletivo'], ['Tinha mandato por outro partido', 'que tinham mandato por outro partido'],
      ['Concorreu na eleição anterior sem se eleger', `que concorreram em ${a0} sem se eleger`], ['Estreante', `sem candidatura em ${a0}`]]
      .map(([t, txt]) => [cat(t), txt]).filter(([q]) => q).map(([q, txt]) => `<b>${q}</b> ${txt}`);
    resumo.push(`Das ${ef.length} deputadas federais eleitas em ${a1}: ${partes.join('; ')}.`);
  }
  for (const g of LPM_CARGOS) {
    const [x0, x1] = n(g);
    if (!x0.el || !x1.el) continue;
    const p0 = x0.elF / x0.el, p1 = x1.elF / x1.el;
    if (p1 < p0 - 0.005) alertas.push(`<b>${lpEsc(LPN_GRUPOS[g].nome)}:</b> eleitas ${x0.elF} → ${x1.elF} com a bancada indo de ${x0.el} para ${x1.el} — a participação feminina <b>caiu de ${lpPct(x0.elF, x0.el)} para ${lpPct(x1.elF, x1.el)}</b>.`);
    for (const [x, a] of [[x0, a0], [x1, a1]]) if (x.cand && x.candF / x.cand < 0.3 && g !== 'sen') alertas.push(`<b>${lpEsc(LPN_GRUPOS[g].nome)} em ${a}:</b> ${lpPct(x.candF, x.cand)} de candidaturas femininas — abaixo da cota mínima de 30% (Lei 9.504/1997, art. 10, § 3º).`);
  }
  return { resumo, alertas };
}

function lpRelatorioMulheresHtml(porAno, op = {}) {
  const [a0, a1] = LPN_ANOS;
  const agora = op.agora || new Date(), dd = n => String(n).padStart(2, '0');
  const carimbo = `${dd(agora.getDate())}/${dd(agora.getMonth() + 1)}/${agora.getFullYear()} ${dd(agora.getHours())}:${dd(agora.getMinutes())}`;
  const votos = lpTemVotos(porAno), metas = LPN_ANOS.map(a => (porAno[a] && porAno[a].meta) || {});
  const [f0, f1] = [lpmGenero(porAno[a0], 'fed'), lpmGenero(porAno[a1], 'fed')], [s0, s1] = [lpmGenero(porAno[a0], 'sen'), lpmGenero(porAno[a1], 'sen')];
  const { resumo, alertas } = lpmTextos(porAno);
  const cartao = (v, l, cor) => `<div class="cartao" style="border-top-color:${cor}"><b>${v}</b><span>${l}</span></div>`;
  const celula = (f, t) => `${f} de ${t} <span class="p">(${lpPct(f, t)})</span>`;
  const linhasCargo = LPM_CARGOS.map(g => { const [x, y] = [lpmGenero(porAno[a0], g), lpmGenero(porAno[a1], g)];
    return `<tr><td class="r">${lpEsc(LPN_GRUPOS[g].nome)}</td><td>${celula(x.candF, x.cand)}</td><td>${celula(y.candF, y.cand)}</td><td>${celula(x.elF, x.el)}</td><td><b>${celula(y.elF, y.el)}</b></td>`
      + (votos ? `<td class="num">${lpNum(x.votosF)} <span class="p">(${lpPct(x.votosF, x.votos)})</span></td><td class="num">${lpNum(y.votosF)} <span class="p">(${lpPct(y.votosF, y.votos)})</span></td>` : '') + '</tr>'; }).join('');
  const ordem = { sen: 0, fed: 1, est: 2 };
  const eleitas = a => LPM_CARGOS.flatMap(g => lpmGenero(porAno[a], g).eleitas.map(r => Object.assign({ g }, r)))
    .sort((x, y) => ordem[x.g] - ordem[y.g] || (y.v || 0) - (x.v || 0));
  const cargoF = g => ({ fed: 'Deputada federal', est: 'Deputada estadual/distrital', sen: 'Senadora' }[g]);
  const fem = t => String(t || '').replace(/^Deputado/, 'Deputada').replace(/^Senador /, 'Candidata a senadora ').replace(/Eleito/g, 'eleita').replace(/Não eleito/i, 'não eleita').replace(/Suplente/, 'suplente');
  const tab1 = eleitas(a1).map(r => `<tr><td><b>${lpEsc(lmnNomeProprio(r.n))}</b></td><td>${lpEsc(r.u)}</td><td>${cargoF(r.g)}</td>${votos ? `<td class="num">${lpNum(r.v)}</td>` : ''}
    <td>${r.t === 'Estreante' ? `<span class="novo">Sem candidatura em ${a0}</span>` : lpEsc(fem(r.ant) || '—')}</td></tr>`).join('');
  const tab0 = eleitas(a0).map(r => `<tr><td><b>${lpEsc(lmnNomeProprio(r.n))}</b></td><td>${lpEsc(r.u)}</td><td>${cargoF(r.g)}</td>${votos ? `<td class="num">${lpNum(r.v)}</td>` : ''}<td>${lpEsc(fem(r.dest) || '—')}</td></tr>`).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Mulheres no ${lpEsc(LPN_PARTIDO)} — eleições ${a0} e ${a1}</title><style>
  :root { --verde: #0B8A4B; --verde-esc: #0b5e3a; --tinta: #1d2733; --tinta2: #5b6b7b; --grade: #dfe5ea; }
  @page { size: A4; margin: 13mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: var(--tinta); margin: 0; background: #fff; }
  .folha { max-width: 190mm; margin: 0 auto; }
  .cab { display: flex; align-items: center; gap: 16px; padding-bottom: 8px; } .cab img { height: 46px; } .cab .tit { flex: 1; }
  .kicker { font-size: 8.5pt; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tinta2); }
  h1 { font-size: 20pt; margin: 0; line-height: 1.15; color: var(--verde-esc); } .sub { font-size: 9.5pt; color: var(--tinta2); margin-top: 2px; }
  .meta { text-align: right; font-size: 8.5pt; color: var(--tinta2); line-height: 1.4; }
  .filete { height: 5px; margin: 0 0 12px; border-radius: 3px; background: linear-gradient(90deg, #0B8A4B 0 40%, #7C9A2F 40% 62%, #1F5FA8 62% 82%, #D9531E 82% 100%); }
  h2 { font-size: 13pt; color: var(--verde-esc); margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 2px solid var(--verde); break-after: avoid; }
  .cartoes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0 4px; }
  .cartao { border: 1px solid var(--grade); border-top: 4px solid; border-radius: 8px; padding: 6px 10px; break-inside: avoid; }
  .cartao b { display: block; font-size: 16pt; line-height: 1.2; } .cartao b small { font-size: 10pt; color: var(--tinta2); font-weight: 600; } .cartao span { font-size: 8.5pt; color: var(--tinta2); display: block; }
  .resumo { background: #f3f8f5; border-left: 4px solid var(--verde); padding: 8px 12px; border-radius: 0 6px 6px 0; margin: 8px 0; } .resumo li { margin: 2px 0; }
  .alerta { background: #fff6e6; border-left: 4px solid #e9a23b; padding: 8px 12px; border-radius: 0 6px 6px 0; margin: 8px 0; } .alerta li { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; } td, th { border-bottom: 1px solid var(--grade); padding: 4px 6px; text-align: left; font-size: 9pt; vertical-align: top; }
  th { background: #f2f6f3; color: var(--verde-esc); font-size: 8.5pt; } tr { break-inside: avoid; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; } td.r { font-weight: 600; color: var(--verde-esc); }
  .p { color: var(--tinta2); font-size: 8.5pt; } .novo { color: #1F5FA8; font-weight: 600; }
  .graf { width: 100%; max-width: 165mm; display: block; margin: 4px auto 10px; break-inside: avoid; }
  .gt { font-size: 11px; font-weight: 700; fill: #0b5e3a; } .gl { font-size: 10px; fill: #1d2733; font-weight: 600; } .ga { font-size: 9px; fill: #5b6b7b; text-anchor: end; }
  .gv { font-size: 10px; font-weight: 700; fill: #1d2733; } .gn { font-size: 8.5px; fill: #1d2733; } .cota { stroke: #D9531E; stroke-dasharray: 4 3; stroke-width: 1.2; } .gc { font-size: 8.5px; fill: #D9531E; }
  .quebra { break-before: page; } .notas { font-size: 8.5pt; color: var(--tinta2); padding-left: 18px; } .notas li { margin: 2px 0; }
  .rodape { margin-top: 14px; border-top: 1px solid var(--grade); padding-top: 6px; font-size: 8pt; color: var(--tinta2); }
  .barra-ferramentas { background: #eef3fb; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; display: flex; align-items: center; gap: 10px; border-radius: 6px; }
  .barra-ferramentas button { background: var(--verde); color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  @media print { .noprint { display: none !important; } .folha { max-width: none; } }
</style></head><body><div class="folha">
<div class="barra-ferramentas noprint"><button id="btn-pdf" type="button">⬇ Salvar em PDF</button><span>No diálogo, escolha <strong>Salvar como PDF</strong>. As cores vão junto.</span></div>
<div class="cab">${op.logo ? `<img src="${lpEsc(op.logo)}" alt="Podemos">` : ''}<div class="tit">
  <div class="kicker">Relatório · Liderança do Podemos na Câmara dos Deputados</div>
  <h1>Mulheres no Podemos: eleições de ${a0} e ${a1}</h1>
  <div class="sub">Candidaturas, eleitas e votos do partido por cargo — Câmara dos Deputados, Assembleias Legislativas e Senado</div></div>
  <div class="meta">Fonte: TSE (dados abertos)<br>Gerado em ${carimbo}</div></div>
<div class="filete"></div>
<div class="cartoes">
  ${cartao(`${f0.elF} → ${f1.elF} <small>${lpVar(f0.elF, f1.elF)}</small>`, 'deputadas federais eleitas', '#0B8A4B')}
  ${cartao(`${lpPct(f0.elF, f0.el)} → ${lpPct(f1.elF, f1.el)}`, `mulheres na bancada federal eleita (${f0.el} → ${f1.el} deputados)`, '#7C9A2F')}
  ${votos ? cartao(`${lpNum(f1.votosF / 1000)} mil <small>${lpVar(f0.votosF, f1.votosF)}</small>`, `votos em candidatas a dep. federal (${lpNum(f0.votosF / 1000)} mil em ${a0}) — ${lpPct(f0.votosF, f0.votos)} → ${lpPct(f1.votosF, f1.votos)} dos votos do partido`, '#1F5FA8')
          : cartao(`${lpPct(f0.candF, f0.cand)} → ${lpPct(f1.candF, f1.cand)}`, 'candidaturas femininas a dep. federal', '#1F5FA8')}
  ${cartao(`${s0.elF} → ${s1.elF}`, `senadoras eleitas (de ${s0.el} → ${s1.el} eleitos ao Senado)`, '#D9531E')}
</div>
${resumo.length ? `<div class="resumo"><b>Em resumo</b><ul style="margin:4px 0 0;padding-left:18px">${resumo.map(t => `<li>${t}</li>`).join('')}</ul></div>` : ''}
${alertas.length ? `<div class="alerta"><b>Pontos de atenção</b><ul style="margin:4px 0 0;padding-left:18px">${alertas.map(t => `<li>${t}</li>`).join('')}</ul></div>` : ''}
<h2>Mulheres entre os eleitos e entre as candidaturas</h2>
${lpmGrafico(porAno, 'el', `Mulheres entre os eleitos do ${LPN_PARTIDO}`)}
${lpmGrafico(porAno, 'cand', `Mulheres entre as candidaturas do ${LPN_PARTIDO}`, 0.30)}
<table><tr><th>Cargo</th><th>Candidaturas femininas ${a0}</th><th>${a1}</th><th>Eleitas ${a0}</th><th>${a1}</th>${votos ? `<th class="num">Votos em mulheres ${a0}</th><th class="num">${a1}</th>` : ''}</tr>${linhasCargo}</table>
${votos ? `<p class="p">Votos: votos nominais válidos no 1º turno dados a candidatas do partido; entre parênteses, a fatia sobre os votos nominais de todos os candidatos do partido ao cargo.</p>` : ''}
<h2 class="quebra">As mulheres eleitas pelo ${LPN_PARTIDO} em ${a1}</h2>
<table><tr><th>Eleita</th><th>UF</th><th>Cargo</th>${votos ? '<th class="num">Votos</th>' : ''}<th>Em ${a0}</th></tr>${tab1 || `<tr><td colspan="5">Nenhuma.</td></tr>`}</table>
<h2>As eleitas pelo ${LPN_PARTIDO} em ${a0} — e em ${a1}</h2>
<table><tr><th>Eleita em ${a0}</th><th>UF</th><th>Cargo</th>${votos ? `<th class="num">Votos em ${a0}</th>` : ''}<th>Em ${a1}</th></tr>${tab0 || `<tr><td colspan="5">Nenhuma.</td></tr>`}</table>
<h2>Notas de método</h2>
<ul class="notas">
  <li><b>Fontes:</b> TSE, dados abertos — cadastro de candidaturas (gênero autodeclarado; arquivos gerados em ${lpEsc(metas.map(m => m.geradoTse || '?').join(' e '))})${votos ? ' e votação por município e zona' : ''}.</li>
  <li><b>Eleitas:</b> situação "eleito por QP", "eleito por média" ou "eleito". Suplentes de senador não entram. Os resultados de ${a1} podem mudar até a diplomação.</li>
  <li><b>Trajetória:</b> a mesma pessoa nas duas eleições pelo nome civil na mesma UF; na falta, pelo nome de urna, se único. O relatório compara só ${a0} e ${a1}: mandatos municipais e eleições anteriores não entram.</li>
  <li><b>Cota:</b> no mínimo 30% de candidaturas de cada sexo nas eleições proporcionais (Lei 9.504/1997, art. 10, § 3º).</li>
</ul>
<div class="rodape">Liderança do Podemos na Câmara dos Deputados · relatório gerado pelo SisPode (Labs · Perfil da Bancada) com os dados abertos do TSE.</div>
</div></body></html>`;
}

async function lpExportarMulheres() {
  if (!LPN_ANOS.every(a => lp.dados[a])) return;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para gerar o relatório.'); return; }
  const logo = typeof carregarLogoDataUrl === 'function' ? await carregarLogoDataUrl() : null;
  w.document.write(lpRelatorioMulheresHtml(lp.dados, { logo }));
  w.document.close();
  const ligar = () => { const b = w.document.getElementById('btn-pdf'); if (b) b.addEventListener('click', () => w.print()); };
  if (w.document.readyState === 'complete') ligar(); else w.addEventListener('load', ligar);
}

if (typeof document !== 'undefined' && document.getElementById('lpMulheres')) document.getElementById('lpMulheres').addEventListener('click', lpExportarMulheres);
if (typeof module !== 'undefined' && module.exports) module.exports = { lpRelatorioMulheresHtml, lpmTextos, lpmGenero };
