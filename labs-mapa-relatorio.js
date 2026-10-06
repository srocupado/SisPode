'use strict';
// Labs · Mapa Territorial — RELATÓRIO em PDF de um deputado.
//
// Abre em aba própria, em tema claro, com a logo, e o botão "Salvar em PDF"
// (impressão do navegador, cores preservadas): cartões (votos, eleição
// anterior, municípios, emendas), o mapa pela fatia dos votos e, havendo a
// eleição anterior, o mapa de ganho/perda; onde teve mais votos, onde mais
// ganhou e perdeu, e as emendas pagas. As cores do mapa são as de papel (as da
// tela são para fundo escuro).
//
// Depende de labs-mapa.js (projeção, quebras, variação) e labs-mapa-nucleo.js.

const MPR_FATIA = ['#eef2f1', '#d3ece2', '#a6d9c4', '#6cbf9f', '#2f9a77', '#0b6e4f'];
const MPR_VAR = { perda: ['#b03a2e', '#e07a6a', '#f4c1b8'], ganho: ['#0b6e4f', '#3fa36f', '#b7e6c9'], zero: '#eef2f1' };

function mprEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** SVG do estado: `cor(k)` pinta cada município; círculos opcionais nas emendas. */
function mprSvg(geo, cor, circulos = {}) {
  const { p, larg, alt } = mpProjetar(geo, 700);
  const maxC = Math.max(0, ...Object.values(circulos));
  let paths = '', circ = '';
  for (const f of geo.features || []) {
    const k = 'm' + (f.properties && f.properties.codarea);
    paths += `<path d="${mpCaminho(f.geometry, p)}" fill="${cor(k)}"></path>`;
    if (circulos[k] && maxC) {
      const c = mpCentro(f.geometry, p);
      if (c) circ += `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${(3 + 11 * Math.sqrt(circulos[k] / maxC)).toFixed(1)}"></circle>`;
    }
  }
  return `<svg viewBox="0 0 ${larg} ${alt}" preserveAspectRatio="xMidYMid meet">${paths}${circ}</svg>`;
}

/**
 * HTML do relatório. u = { dep, geo, totais, emendas, ano (das emendas) },
 * op = { logo, agora, anoEleicao }.
 */
function mpRelatorioHtml(u, op = {}) {
  const { dep, geo, totais, emendas } = u;
  const anoEm = u.ano, ANO = op.anoEleicao || mpAno();
  const agora = op.agora || new Date();
  const dd = n => String(n).padStart(2, '0');
  const carimbo = `${dd(agora.getDate())}/${dd(agora.getMonth() + 1)}/${agora.getFullYear()} ${dd(agora.getHours())}:${dd(agora.getMinutes())}`;
  const votos = dep.municipios || {}, ant = dep.anterior || null, antMun = (ant && ant.municipios) || {};
  const fatia = k => { const t = (totais[k] || {}).t; return t ? (votos[k] || 0) / t : 0; };
  const nomeMun = k => (totais[k] || {}).n || (emendas && emendas.nomesMun || {})[k] || k;
  const chaves = (geo.features || []).map(f => 'm' + (f.properties && f.properties.codarea));
  const doEstado = new Set(chaves);
  const mun = {}, foraUf = {};
  for (const [k, v] of Object.entries((emendas && emendas.municipais) || {})) (doEstado.has(k) ? mun : foraUf)[k] = v;

  // Mapa 1: fatia dos votos.
  const quebras = mpQuebras(chaves.map(fatia));
  const corFatia = k => { const x = fatia(k); if (!(x > 0)) return MPR_FATIA[0]; let i = 0; while (i < quebras.length && x > quebras[i]) i++; return MPR_FATIA[i + 1]; };
  const legFatia = (quebras.length ? [...quebras.map((q, i) => [MPR_FATIA[i + 1], i === 0 ? 'até ' + mpPct(q) : mpPct(quebras[i - 1]) + '–' + mpPct(q)]),
    [MPR_FATIA[quebras.length + 1], '> ' + mpPct(quebras[quebras.length - 1])]] : [[MPR_FATIA[1], 'com voto']])
    .map(([c, r]) => `<span><i style="background:${c}"></i>${r}</span>`).join('');

  // Mapa 2: ganho/perda desde a eleição anterior.
  const variacao = ant ? lmnVariacao(votos, antMun) : [];
  const dVar = Object.fromEntries(variacao.map(x => [x.k, x.d]));
  const absVar = variacao.map(x => Math.abs(x.d)).sort((a, b) => a - b);
  const maxVar = absVar.length ? absVar[Math.min(absVar.length - 1, Math.floor(0.95 * absVar.length))] : 0;
  const corVar = k => { const d = dVar[k] || 0; if (!d || !maxVar) return MPR_VAR.zero; const f = Math.abs(d) / maxVar, i = f > 0.4 ? 0 : f > 0.12 ? 1 : 2; return (d > 0 ? MPR_VAR.ganho : MPR_VAR.perda)[i]; };

  const comVoto = Object.entries(votos).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const dTot = ant ? dep.total - ant.total : 0;
  const linhaTop = ([k, v], i) => `<tr><td class="n">${i + 1}</td><td>${mprEsc(nomeMun(k))}</td><td class="num">${mpNum(v)}</td><td class="num">${mpNum((totais[k] || {}).t || 0)}</td><td class="num">${mpPct(fatia(k))}</td>` +
    (ant ? `<td class="num">${mpNum(antMun[k] || 0)}</td><td class="num ${(votos[k] || 0) >= (antMun[k] || 0) ? 'sobe' : 'cai'}">${mpVarPct(antMun[k] || 0, v)}</td>` : '') + '</tr>';
  const cabVar = `<tr><th>Município</th><th class="num">${mprEsc(ant ? ant.ano : '')}</th><th class="num">${ANO}</th><th class="num">Diferença</th><th class="num">%</th></tr>`;
  const linhaVar = x => `<tr><td>${mprEsc(nomeMun(x.k))}</td><td class="num">${mpNum(x.antes)}</td><td class="num">${mpNum(x.agora)}</td>
    <td class="num ${x.d > 0 ? 'sobe' : 'cai'}">${x.d > 0 ? '+' : ''}${mpNum(x.d)}</td><td class="num ${x.d > 0 ? 'sobe' : 'cai'}">${mpVarPct(x.antes, x.agora)}</td></tr>`;
  const tab = (linhas, cab) => `<table>${cab}${linhas.join('')}</table>`;
  const listaEm = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${mprEsc((emendas.nomesMun || {})[k] || nomeMun(k))}</td><td class="num">${mpReais(v)}</td></tr>`);

  let blocoEm;
  if (!emendas || emendas.semChave) blocoEm = '<p class="nd">Emendas não consultadas: sem a chave do Portal da Transparência no navegador que gerou o relatório.</p>';
  else if (emendas.erro) blocoEm = `<p class="nd">Não foi possível buscar as emendas: ${mprEsc(emendas.erro)}</p>`;
  else {
    const outros = Object.entries(emendas.outros || {}).sort((a, b) => b[1] - a[1]).map(([r, v]) => `<tr><td>${mprEsc(r)}</td><td class="num">${mpReais(v)}</td></tr>`);
    blocoEm = `<p>Emendas do orçamento de ${mprEsc(anoEm)}, valor pago: <b>${mpReais(emendas.total)}</b>${emendas.restoPago != null ? ` (${mpReais(emendas.pagoNoAno)} pagos no ano + ${mpReais(emendas.restoPago)} de restos a pagar pagos depois)` : ''} · ${mpNum(emendas.n)} registro(s) no Portal.</p>
      ${Object.keys(mun).length ? `<h3>Com município identificado (círculos no mapa)</h3>${tab(listaEm(mun), '<tr><th>Município</th><th class="num">Pago</th></tr>')}` : ''}
      ${Object.keys(foraUf).length ? `<h3>Em municípios de outros estados</h3>${tab(listaEm(foraUf), '<tr><th>Município</th><th class="num">Pago</th></tr>')}` : ''}
      ${outros.length ? `<h3>Sem município${emendas.viaFavorecido != null ? '' : ' no Portal'}</h3>${tab(outros, '<tr><th>Localidade</th><th class="num">Pago</th></tr>')}` : ''}
      <p class="fonte">${emendas.viaFavorecido != null
        ? `A consulta do Portal devolve boa parte das emendas como “MÚLTIPLO”; o município delas (${mpReais(emendas.viaFavorecido)}) vem do favorecido de cada pagamento — prefeitura, fundo municipal, entidade — no arquivo de dados abertos do Portal da Transparência${emendas.favMeta ? ` de ${mprEsc(mpDataArquivo(emendas.favMeta))}` : ''}.`
        : 'O Portal registra boa parte das emendas como “MÚLTIPLO”, sem o município de destino.'}</p>`;
  }

  const cartao = (v, l, cor) => `<div class="cartao" style="border-top-color:${cor}"><b>${v}</b><span>${l}</span></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Mapa Territorial — ${mprEsc(dep.nome)} (${mprEsc(dep.uf)}) — ${ANO}</title><style>
  :root { --verde: #0B8A4B; --verde-esc: #0b5e3a; --tinta: #1d2733; --tinta2: #5b6b7b; --grade: #dfe5ea; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: var(--tinta); margin: 0; background: #fff; }
  .folha { max-width: 190mm; margin: 0 auto; padding: 0 0 20px; }
  .cab { display: flex; align-items: center; gap: 16px; padding: 6px 0 10px; }
  .cab img { height: 44px; } .cab .tit { flex: 1; }
  .cab .kicker { font-size: 8.5pt; letter-spacing: 1.5px; text-transform: uppercase; color: var(--tinta2); }
  .cab h1 { font-size: 20pt; margin: 0; line-height: 1.15; color: var(--verde-esc); }
  .cab .sub { font-size: 9.5pt; color: var(--tinta2); margin-top: 2px; }
  .cab .meta { text-align: right; font-size: 8.5pt; color: var(--tinta2); line-height: 1.4; }
  .filete { height: 5px; margin: 0 0 12px; border-radius: 3px; background: linear-gradient(90deg, #0B8A4B 0 40%, #7C9A2F 40% 62%, #1F5FA8 62% 82%, #D9531E 82% 100%); }
  h2 { font-size: 13pt; color: var(--verde-esc); margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 2px solid var(--verde); break-after: avoid; }
  h3 { font-size: 10pt; color: var(--verde-esc); margin: 10px 0 4px; break-after: avoid; }
  .cartoes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0; }
  .cartao { border: 1px solid var(--grade); border-top: 4px solid; border-radius: 8px; padding: 5px 10px; break-inside: avoid; }
  .cartao b { display: block; font-size: 15pt; } .cartao span { font-size: 8.5pt; color: var(--tinta2); }
  .mapa { border: 1px solid var(--grade); border-radius: 8px; padding: 6px; break-inside: avoid; }
  .mapa svg { width: 100%; max-height: 120mm; display: block; }
  .mapa path { stroke: #fff; stroke-width: 0.4; vector-effect: non-scaling-stroke; }
  .mapa circle { fill: rgba(232,160,0,0.45); stroke: #c98a00; stroke-width: 1; vector-effect: non-scaling-stroke; }
  .legenda { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 8.5pt; color: var(--tinta2); margin-top: 4px; }
  .legenda i { display: inline-block; width: 14px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; border: 1px solid #d5dbe0; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  td, th { border-bottom: 1px solid var(--grade); padding: 3px 6px; text-align: left; font-size: 9pt; }
  th { background: #f2f6f3; color: var(--verde-esc); font-size: 8.5pt; }
  tr { break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; } td.n { color: var(--tinta2); width: 24px; }
  .sobe { color: #0b6e4f; font-weight: 600; } .cai { color: #b03a2e; font-weight: 600; }
  .duas { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .nd, .fonte { font-size: 8.5pt; color: var(--tinta2); } .fonte { font-style: italic; }
  .quebra { break-before: page; }
  .anexo td, .anexo th { font-size: 7.5pt; padding: 1px 4px; }
  .rodape { margin-top: 18px; border-top: 1px solid var(--grade); padding-top: 6px; font-size: 8pt; color: var(--tinta2); }
  .barra-ferramentas { background: #eef3fb; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; display: flex; align-items: center; gap: 10px; border-radius: 6px; }
  .barra-ferramentas button { background: var(--verde); color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  @media print { .noprint { display: none !important; } .folha { max-width: none; } }
</style></head><body><div class="folha">
<div class="barra-ferramentas noprint">
  <button id="btn-pdf" type="button">⬇ Salvar em PDF</button>
  <span>No diálogo, escolha o destino <strong>Salvar como PDF</strong>. As cores vão junto.</span>
</div>
<div class="cab">
  ${op.logo ? `<img src="${mprEsc(op.logo)}" alt="Podemos">` : ''}
  <div class="tit">
    <div class="kicker">Mapa Territorial · votação por município · eleição de ${ANO}</div>
    <h1>${mprEsc(dep.nome)} (${mprEsc(dep.uf)})</h1>
    <div class="sub">Eleito(a) em ${ANO} pelo ${mprEsc(dep.partidoEleicao || '?')} como “${mprEsc(dep.nomeUrna || dep.nome)}”${dep.situacao ? ` — ${mprEsc(dep.situacao.toLowerCase())}` : ''}</div>
  </div>
  <div class="meta">Liderança do Podemos<br>Câmara dos Deputados<br>Gerado em ${carimbo}</div>
</div>
<div class="filete"></div>

<div class="cartoes">
  ${cartao(mpNum(dep.total), `votos em ${ANO}`, '#0B8A4B')}
  ${ant ? cartao(`${mpNum(ant.total)} <small class="${dTot >= 0 ? 'sobe' : 'cai'}" style="font-size:10pt">${mpVarPct(ant.total, dep.total)}</small>`, `votos em ${mprEsc(ant.ano)} (${mprEsc(ant.partido || '?')})`, '#1F5FA8')
        : cartao('—', LMN_ANTERIOR[ANO] ? `não concorreu em ${LMN_ANTERIOR[ANO]} (dep. federal, ${mprEsc(dep.uf)})` : 'eleição anterior', '#9aa7b3')}
  ${cartao(mpNum(comVoto.length), 'municípios com voto', '#7C9A2F')}
  ${cartao(emendas && emendas.total != null ? mpReais(emendas.total) : '—', `emendas pagas de ${mprEsc(anoEm)}`, '#D9531E')}
</div>

<h2>Fatia dos votos por município — ${ANO}</h2>
<div class="mapa">${mprSvg(geo, corFatia, mun)}
  <div class="legenda"><span><i style="background:${MPR_FATIA[0]}"></i>sem voto</span>${legFatia}${Object.keys(mun).length ? '<span><i style="background:rgba(232,160,0,0.6)"></i>emenda paga</span>' : ''}</div>
  <div class="fonte">Fatia = votos do deputado ÷ total de votos nominais válidos para deputado federal no município (todos os candidatos; sem os votos só na legenda).</div>
</div>

<h2>Onde teve mais votos</h2>
${tab(comVoto.slice(0, 20).map(linhaTop), `<tr><th></th><th>Município</th><th class="num">Votos ${ANO}</th><th class="num">Total do município</th><th class="num">Fatia</th>${ant ? `<th class="num">Votos ${mprEsc(ant.ano)}</th><th class="num">Variação</th>` : ''}</tr>`)}

${ant ? `<h2 class="quebra">Ganho e perda de votos desde ${mprEsc(ant.ano)}</h2>
<p>Em ${mprEsc(ant.ano)}: <b>${mpNum(ant.total)}</b> votos pelo ${mprEsc(ant.partido || '?')}${ant.situacao ? ` (${mprEsc(ant.situacao.toLowerCase())})` : ''}; em ${ANO}: <b>${mpNum(dep.total)}</b>
  — <span class="${dTot >= 0 ? 'sobe' : 'cai'}">${dTot >= 0 ? '+' : ''}${mpNum(dTot)} votos (${mpVarPct(ant.total, dep.total)})</span>.</p>
<div class="mapa">${mprSvg(geo, corVar)}
  <div class="legenda"><span><i style="background:${MPR_VAR.perda[0]}"></i><i style="background:${MPR_VAR.perda[1]}"></i><i style="background:${MPR_VAR.perda[2]}"></i>perdeu votos</span>
    <span><i style="background:${MPR_VAR.zero}"></i>igual</span>
    <span><i style="background:${MPR_VAR.ganho[2]}"></i><i style="background:${MPR_VAR.ganho[1]}"></i><i style="background:${MPR_VAR.ganho[0]}"></i>ganhou votos (tons mais fortes: maior variação)</span></div>
</div>
<div class="duas">
  <div><h3>Onde mais ganhou votos</h3>${tab(variacao.filter(x => x.d > 0).slice(0, 12).map(linhaVar), cabVar)}</div>
  <div><h3>Onde mais perdeu votos</h3>${tab(variacao.filter(x => x.d < 0).slice(-12).reverse().map(linhaVar), cabVar)}</div>
</div>` : ''}

<h2${ant ? '' : ' class="quebra"'}>Emendas</h2>
${blocoEm}

${comVoto.length > 20 ? `<h2 class="quebra">Anexo — todos os ${mpNum(comVoto.length)} municípios com voto</h2>
<div class="anexo">${tab(comVoto.map((x, i) => linhaTop(x, i)), `<tr><th></th><th>Município</th><th class="num">${ANO}</th><th class="num">Total mun.</th><th class="num">Fatia</th>${ant ? `<th class="num">${mprEsc(ant.ano)}</th><th class="num">Var.</th>` : ''}</tr>`)}</div>` : ''}

<div class="rodape">Liderança do Podemos · Labs — Mapa Territorial. Fontes: TSE (votação por município e zona, dados abertos), IBGE (malhas municipais),
  Portal da Transparência (emendas). Votos nominais válidos (sem os votos só na legenda); a comparação com a eleição anterior casa o candidato pelo nome civil na mesma UF.</div>
</div></body></html>`;
}

/** Abre o relatório do deputado mostrado na tela em aba própria; o botão dela abre o diálogo de PDF. */
async function mpExportarRelatorio() {
  const u = mp.ultimo;
  if (!u) return;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para gerar o relatório.'); return; }
  const logo = typeof carregarLogoDataUrl === 'function' ? await carregarLogoDataUrl() : null;
  w.document.write(mpRelatorioHtml(u, { logo }));
  w.document.close();
  // A aba herda a CSP da extensão (script-src 'self'): o botão é ligado daqui.
  const ligar = () => { const b = w.document.getElementById('btn-pdf'); if (b) b.addEventListener('click', () => w.print()); };
  if (w.document.readyState === 'complete') ligar(); else w.addEventListener('load', ligar);
}
