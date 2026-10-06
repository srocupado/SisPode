'use strict';
// Labs · Simulador de Negociação — RELATÓRIO EM PDF.
//
// O que está na tela vira um documento: os parâmetros da simulação, cada
// rodada inteira (proposta, cadeiras por posição, mapa por ponto, síntese e a
// reação de cada agente) e, com mais de uma rodada, a evolução. O que na tela
// fica no "passe o mouse" (nova redação, troca proposta) vai escrito por
// extenso, porque papel não tem mouse.
//
// Mesmo formato das notas da casa: aba própria com o botão "Salvar em PDF",
// cabeçalho com o logo do Podemos, cores mantidas na impressão. As cautelas da
// tela (não é previsão de placar; objeções sem base são hipótese do modelo) vão
// junto — o relatório circula sem a tela ao lado.

const SM_REL_COR = { apoia: '#0B8A4B', condiciona: '#C98A00', rejeita: '#C0392B', indefinida: '#9aa1a9', semResposta: '#d5d9de' };
const SM_REL_POS = { apoia: 'Apoia', condiciona: 'Condiciona', rejeita: 'Rejeita', indefinida: 'Indefinida' };

function smRelEsc(s) { return labsEsc(s); }

/** Barra empilhada das cadeiras por posição (HTML puro; cor + rótulo escrito). */
function smRelBarra(ap) {
  const partes = ['apoia', 'condiciona', 'rejeita', 'indefinida', 'semResposta'].filter(k => ap[k]);
  const total = partes.reduce((s, k) => s + ap[k], 0) || 1;
  const rot = { apoia: 'apoia', condiciona: 'condiciona', rejeita: 'rejeita', indefinida: 'indefinida', semResposta: 'sem resposta' };
  return `<div class="barra">${partes.map(k => `<i style="width:${(100 * ap[k] / total).toFixed(2)}%;background:${SM_REL_COR[k]}"></i>`).join('')}</div>
    <div class="legenda">${partes.map(k => `<span><i style="background:${SM_REL_COR[k]}"></i>${ap[k]} ${rot[k]}</span>`).join('')}</div>`;
}

function smRelNome(ag) { return ag.sigla === SM_GOVERNO ? 'Governo' : ag.nome; }

function smRelPerfil(x) {
  const ag = x.bancada, pf = x.perfil;
  if (pf && ag.tipo === 'partido') {
    return [`${ag.cadeiras} cadeiras`,
      pf.comparaveis ? `votou como o Governo orientou em ${smPct(pf.alinhamentoGoverno)} (${pf.comparaveis} votações)` : 'sem votações para medir o alinhamento',
      pf.porContexto && pf.porContexto.consenso.n ? `no consenso ${smPct(pf.porContexto.consenso.alinhamento)}` : '',
      pf.porContexto && pf.porContexto.conflito.n ? `no conflito ${smPct(pf.porContexto.conflito.alinhamento)}` : '',
      pf.coesao != null ? `coesão ${smPct(pf.coesao)}` : ''].filter(Boolean).join(' · ');
  }
  return ag.descricao ? `${SM_TIPOS[ag.tipo] || 'agente'}: ${ag.descricao}` : '';
}

function smRelAgente(x) {
  const nome = smRelNome(x.bancada);
  const perfil = smRelPerfil(x);
  const cab = (pos, rot) => `<div class="ag-cab"><b>${smRelEsc(nome)}</b><span class="pos" style="background:${SM_REL_COR[pos] || SM_REL_COR.indefinida}">${smRelEsc(rot)}</span></div>`;
  const linhas = [];
  if (perfil) linhas.push(`<div class="ag-l ag-perfil">${smRelEsc(perfil)}</div>`);
  if (x.bancada.contexto) linhas.push(`<div class="ag-l"><b>Contexto da equipe:</b> ${smRelEsc(x.bancada.contexto)}</div>`);
  if (!x.resposta) return `<div class="ag">${cab('indefinida', 'sem resposta')}${linhas.join('')}<div class="ag-l nd">${smRelEsc(x.erro || 'o agente não respondeu')}</div></div>`;
  const a = x.resposta;
  if (a.objecoes.length) {
    linhas.push(`<div class="ag-l"><b>Objeções:</b><ul>${a.objecoes.map(o => `<li>${smRelEsc(smObjTexto(o))} ${o.base === 'nenhuma'
      ? `<span class="tag semBase">sem base nos dados${o.baseDeclarada ? ' (citou ' + smRelEsc((SM_ROT_BASE[o.baseDeclarada] || o.baseDeclarada).replace(/^base: /, '')) + ', que não recebeu)' : ''}</span>`
      : `<span class="tag">${smRelEsc(SM_ROT_BASE[o.base] || o.base)}</span>`}</li>`).join('')}</ul></div>`);
  }
  if (a.concessao) linhas.push(`<div class="ag-l"><b>Destravaria:</b> ${smRelEsc(a.concessao)}</div>`);
  if (a.argumento) linhas.push(`<div class="ag-l"><b>Argumento que pesa:</b> ${smRelEsc(a.argumento)}</div>`);
  if (a.risco) linhas.push(`<div class="ag-l"><b>Risco de ruptura:</b> ${smRelEsc(a.risco)}</div>`);
  return `<div class="ag">${cab(a.posicao, SM_REL_POS[a.posicao] || a.posicao)}${linhas.join('')}</div>`;
}

/** Mapa ponto × agente, com nova redação e troca escritas (no papel não há "passe o mouse"). */
function smRelPontos(rodada) {
  const m = smMapaPontos(rodada);
  if (!m) return '';
  // Cabeçalho estreito com muitos agentes: nome longo abreviado ("REPUBLICANOS" → "REPUBL."), o completo no title.
  const curto = n => n.length > 9 ? n.slice(0, 6) + '.' : n;
  const cab = rodada.resultados.map(x => `<th title="${smRelEsc(smRelNome(x.bancada))}">${smRelEsc(curto(smRelNome(x.bancada)))}</th>`).join('');
  const notas = [];
  const corpo = m.linhas.map((l, i) => `<tr><td class="pt"><b>${i + 1}.</b> ${smRelEsc(l.ponto)}<div class="nd">cadeiras: ${l.cadeirasApoio} apoiam · ${l.cadeirasRejeicao} rejeitam</div></td>${l.celulas.map(c => {
    if (!c.acao) return '<td class="nd">—</td>';
    if (c.redacao || c.troca) notas.push(`<li><b>Ponto ${i + 1} · ${smRelEsc(smRelNome(c.agente))}:</b> ${[c.redacao && 'nova redação: ' + c.redacao, c.troca && 'troca: ' + c.troca].filter(Boolean).map(smRelEsc).join(' | ')}</li>`);
    return `<td class="acao acao-${c.acao}${c.importancia === 5 ? ' vermelha' : ''}">${smRelEsc((SM_ROT_ACAO[c.acao] || '?'))}${c.importancia ? ` <span class="nd">${c.importancia}/5</span>` : ''}${c.redacao || c.troca ? ' *' : ''}</td>`;
  }).join('')}</tr>`).join('');
  return `<h3>Mapa por ponto</h3>
    <table class="mapa"><tr><th>Ponto</th>${cab}</tr>${corpo}</table>
    <div class="fonte">Importância 5/5 = linha vermelha (destacada). * = o agente propôs nova redação ou troca, abaixo.</div>
    ${notas.length ? `<ul class="notas">${notas.join('')}</ul>` : ''}`;
}

function smRelRodada(r, i, s) {
  const ap = smApoioEstimado(r.resultados);
  return `<section class="rodada">
    <h2>Rodada ${i + 1}</h2>
    <div class="proposta"><b>Proposta em negociação:</b><br>${smRelEsc(r.proposta).replace(/\n/g, '<br>')}</div>
    <h3>Cadeiras pela posição declarada</h3>
    ${smRelBarra(ap)}
    <div class="fonte">Soma das cadeiras das bancadas partidárias simuladas (${ap.total}) pela posição que o agente declarou. Governo e agentes personalizados não somam.</div>
    ${smRelPontos(r)}
    ${r.sintese ? `<h3>Síntese da rodada</h3><div class="sintese">${renderMarkdown(r.sintese)}</div>` : ''}
    <h3>Reação por agente</h3>
    <div class="agentes">${r.resultados.map(smRelAgente).join('')}</div>
  </section>`;
}

function smRelEvolucao(s) {
  if (s.rodadas.length < 2) return '';
  const ev = smEvolucao(s.rodadas);
  const cad = s.rodadas.map(x => smApoioEstimado(x.resultados));
  return `<section><h2>Evolução da negociação</h2>
    <div class="fonte" style="margin:0 0 4px">Célula com borda = o agente mudou de posição naquela rodada.</div>
    <table class="evol"><tr><th>Agente</th>${s.rodadas.map((_, i) => `<th>Rodada ${i + 1}</th>`).join('')}</tr>
    ${ev.map(e => `<tr><td>${smRelEsc(e.nome)}</td>${e.posicoes.map((p, i) => `<td${i && p !== e.posicoes[i - 1] ? ' class="mudou"' : ''}><span class="pos" style="background:${SM_REL_COR[p] || SM_REL_COR.indefinida}">${smRelEsc(SM_REL_POS[p] || p)}</span></td>`).join('')}</tr>`).join('')}
    <tr><td class="nd">Cadeiras que apoiam</td>${cad.map(c => `<td class="nd">${c.apoia} de ${c.total}</td>`).join('')}</tr></table></section>`;
}

/**
 * HTML do relatório. Pura (sem DOM): recebe a sessão e o carimbo.
 * op: { logo, agora (Date) }
 */
function smRelatorioHtml(s, op = {}) {
  const agora = op.agora || new Date();
  const dd = n => String(n).padStart(2, '0');
  const carimbo = `${dd(agora.getDate())}/${dd(agora.getMonth() + 1)}/${agora.getFullYear()} ${dd(agora.getHours())}:${dd(agora.getMinutes())}`;
  // Posse em 1º/fev (2023: 57ª, 2027: 58ª…): em janeiro ainda vale a anterior.
  const legislatura = Math.floor(((agora.getMonth() >= 1 ? agora.getFullYear() : agora.getFullYear() - 1) - 1795) / 4);
  const titulo = s.prop ? `${s.prop.sigla} ${s.prop.numero}/${s.prop.ano}` : 'Proposta em negociação';
  const ultima = s.rodadas[s.rodadas.length - 1];
  const ap = smApoioEstimado(ultima.resultados);
  const custo = Object.entries(s.custo || {}).map(([m, c]) => `${c} com ${m}`).join(', ');
  const totalChamadas = Object.values(s.custo || {}).reduce((a, b) => a + b, 0);
  const semBase = s.rodadas.reduce((n, r) => n + r.resultados.reduce((k, x) => k + (x.resposta ? x.resposta.objecoes.filter(o => o.base === 'nenhuma').length : 0), 0), 0);
  const totalObj = s.rodadas.reduce((n, r) => n + r.resultados.reduce((k, x) => k + (x.resposta ? x.resposta.objecoes.length : 0), 0), 0);
  const oposicao = { Sim: 'a favor da proposta', 'Não': 'contra a proposta', 'Obstrução': 'obstrução' }[s.oposicao] || 'não informada';
  const param = [
    ['Proposição', s.prop ? `${titulo} — ${s.prop.ementa}${s.prop.situacao ? ` (situação: ${s.prop.situacao})` : ''}` : 'não indicada (negociação descrita só pela proposta)'],
    ['Agentes', s.agentes.map(smRelNome).join(', ')],
    ['Perfis das bancadas', s.agentes.some(a => a.tipo === 'partido') ? `${s.votacoes} votações nominais do Plenário nos últimos ${s.meses} meses${s.falhas ? ` (${s.falhas} não puderam ser lidas)` : ''}` : '—'],
    ['Governo responde primeiro', s.govPrimeiro ? 'sim — as bancadas responderam conhecendo a posição do Governo' : 'não — todos responderam de forma independente'],
    ['Posição da oposição', oposicao],
    ['Modelos', `agentes: ${s.modelos && s.modelos.agentes || 'o configurado'} · síntese: ${s.modelos && s.modelos.sintese || 'o configurado'} (${s.cfg && s.cfg.provedor || 'gemini'})`],
    ['Chamadas de IA', `${totalChamadas} concluídas${custo ? ` (${custo})` : ''}${s.falhasIA ? `; mais ${s.falhasIA} que falharam` : ''}`],
  ];
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Simulação de negociação — ${smRelEsc(titulo)}</title>
<style>
  :root { --verde:#0B8A4B; --verde-esc:#003c1f; --tinta:#1b1b1b; --tinta2:#52514e; --grade:#e4e4e0; --ambar-bg:#fff7ea; }
  @page { size: A4; margin: 15mm; }
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
  .experimental { background: var(--ambar-bg); border-left: 4px solid #e9a23b; padding: 7px 12px; font-size: 9pt; border-radius: 0 6px 6px 0; margin: 0 0 10px; }
  h2 { font-size: 13pt; color: var(--verde-esc); margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 2px solid var(--verde); break-after: avoid; }
  h3 { font-size: 10.5pt; color: var(--verde-esc); margin: 12px 0 4px; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  td, th { border-bottom: 1px solid var(--grade); padding: 4px 6px; text-align: left; vertical-align: top; font-size: 9pt; }
  th { background: #f2f6f3; color: var(--verde-esc); font-size: 8.5pt; }
  tr { break-inside: avoid; }
  td.r { width: 26%; font-weight: 600; color: var(--verde-esc); }
  .cartoes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0; }
  .cartao { border: 1px solid var(--grade); border-top: 4px solid; border-radius: 8px; padding: 6px 10px; break-inside: avoid; }
  .cartao b { display: block; font-size: 16pt; } .cartao span { font-size: 8.5pt; color: var(--tinta2); }
  .barra { display: flex; height: 16px; border-radius: 4px; overflow: hidden; background: #eef1f4; margin: 4px 0; }
  .barra i { display: block; height: 100%; }
  .legenda { display: flex; flex-wrap: wrap; gap: 12px; font-size: 8.5pt; color: var(--tinta2); }
  .legenda i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .fonte { font-size: 8pt; color: var(--tinta2); font-style: italic; margin-top: 3px; }
  .nd { color: var(--tinta2); font-size: 8.5pt; }
  .proposta { background: #f7f8f6; border-left: 4px solid var(--verde); padding: 7px 12px; border-radius: 0 6px 6px 0; font-size: 9.5pt; }
  /* Muitos agentes: colunas de largura fixa, o texto do ponto com ~30% da linha. */
  .mapa { table-layout: fixed; }
  .mapa th:first-child, .mapa td.pt { width: 30%; }
  .mapa th { font-size: 7.5pt; overflow-wrap: normal; word-break: normal; }
  .mapa td.acao { text-align: center; font-weight: 600; font-size: 8pt; padding: 4px 2px; }
  .acao-apoia { background: #e3f4ea; color: #0B6E3C; } .acao-rejeita { background: #fbe6e3; color: #A93226; }
  .acao-reformula { background: #fff3d6; color: #8a5a00; } .acao-troca { background: #e6eefb; color: #1F5FA8; }
  .vermelha { outline: 2px solid #C0392B; outline-offset: -2px; }
  .notas { font-size: 8.5pt; margin: 4px 0 0; padding-left: 18px; }
  .sintese { font-size: 9.5pt; } .sintese p { margin: 4px 0; } .sintese h2, .sintese h3 { border: 0; font-size: 10pt; margin: 8px 0 2px; }
  .agentes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ag { border: 1px solid var(--grade); border-radius: 8px; padding: 7px 10px; break-inside: avoid; font-size: 9pt; }
  .ag-cab { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
  .ag-l { margin-top: 3px; } .ag-l ul { margin: 2px 0 0; padding-left: 16px; } .ag-perfil { color: var(--tinta2); font-size: 8.5pt; }
  .pos { color: #fff; font-size: 8pt; font-weight: 700; border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
  .tag { font-size: 7.5pt; background: #eef3f6; color: #3b5568; border-radius: 3px; padding: 0 4px; }
  .tag.semBase { background: #fff1d6; color: #8a5a00; }
  .evol td.mudou { outline: 2px solid #1F5FA8; outline-offset: -2px; }
  /* Primeira página: resultado, parâmetros e evolução cabem juntos, mesmo com 10+ agentes. */
  .evol td, .evol th, .param td { padding: 2px 6px; }
  .evol .pos { font-size: 7.5pt; padding: 0 7px; }
  .cartao { padding: 4px 10px; } .cartao b { font-size: 14pt; }
  .rodada { break-before: page; }
  .rodape { margin-top: 22px; border-top: 1px solid var(--grade); padding-top: 6px; font-size: 8pt; color: var(--tinta2); }
  .barra-ferramentas { background: #eef3fb; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; display: flex; align-items: center; gap: 10px; border-radius: 6px; }
  .barra-ferramentas button { background: var(--verde); color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  @media print { .noprint { display: none !important; } .folha { max-width: none; } }
</style></head><body><div class="folha">
<div class="barra-ferramentas noprint">
  <button id="btn-pdf" type="button">⬇ Salvar em PDF</button>
  <span>No diálogo, escolha o destino <strong>Salvar como PDF</strong>. As cores vão junto.</span>
</div>
<div class="cab">
  ${op.logo ? `<img src="${smRelEsc(op.logo)}" alt="Podemos">` : ''}
  <div class="tit">
    <div class="kicker">Relatório de simulação de negociação · Labs · ${legislatura}ª Legislatura</div>
    <h1>${smRelEsc(titulo)}</h1>
    <div class="sub">${s.rodadas.length} rodada(s) · ${s.agentes.length} agente(s)${s.prop && s.prop.ementa ? ' · ' + smRelEsc(s.prop.ementa.slice(0, 160)) + (s.prop.ementa.length > 160 ? '…' : '') : ''}</div>
  </div>
  <div class="meta">Labs — área de desenvolvimento<br>Liderança do Podemos<br>Gerado em ${carimbo}</div>
</div>
<div class="filete"></div>
<div class="experimental"><b>Experimental.</b> Simulação com agentes de IA a partir das votações reais das bancadas e do contexto informado pela equipe.
  Não é previsão de placar: a bancada real pode se dividir, e agentes de IA tendem a concordar mais do que as bancadas.</div>

<h2>Resultado da última rodada</h2>
<div class="cartoes">
  <div class="cartao" style="border-top-color:${SM_REL_COR.apoia}"><b>${ap.apoia}</b><span>cadeiras apoiam</span></div>
  <div class="cartao" style="border-top-color:${SM_REL_COR.condiciona}"><b>${ap.condiciona}</b><span>cadeiras condicionam</span></div>
  <div class="cartao" style="border-top-color:${SM_REL_COR.rejeita}"><b>${ap.rejeita}</b><span>cadeiras rejeitam</span></div>
  <div class="cartao" style="border-top-color:${SM_REL_COR.indefinida}"><b>${ap.indefinida + ap.semResposta}</b><span>indefinidas ou sem resposta</span></div>
</div>
${smRelBarra(ap)}

<h2>Parâmetros da simulação</h2>
<table class="param">${param.map(([r, v]) => `<tr><td class="r">${smRelEsc(r)}</td><td>${smRelEsc(v)}</td></tr>`).join('')}</table>

${smRelEvolucao(s)}
${s.rodadas.map((r, i) => smRelRodada(r, i, s)).join('')}

<div class="rodape">Liderança do Podemos · Labs — Simulador de Negociação. Cada agente recebeu o perfil de votação da bancada, o contexto da equipe, a ementa e a proposta,
  e indicou em que dado apoiou cada objeção${totalObj ? `: ${semBase} de ${totalObj} objeções vieram sem base nos dados recebidos (marcadas) — trate-as como hipótese do modelo, não como informação` : ''}.
  Os perfis vêm das votações nominais do Plenário da Câmara (Dados Abertos).</div>
</div></body></html>`;
}

/** Abre o relatório em aba própria; o botão dela abre o diálogo de PDF. */
async function smExportarRelatorio() {
  const s = sm.sessao;
  if (!s || !s.rodadas.length) return;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para gerar o relatório.'); return; }
  const logo = typeof carregarLogoDataUrl === 'function' ? await carregarLogoDataUrl() : null;
  w.document.write(smRelatorioHtml(s, { logo }));
  w.document.close();
  // A aba herda a CSP da extensão (script-src 'self'): o botão é ligado daqui.
  const ligar = () => { const b = w.document.getElementById('btn-pdf'); if (b) b.addEventListener('click', () => w.print()); };
  if (w.document.readyState === 'complete') ligar(); else w.addEventListener('load', ligar);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { smRelatorioHtml };
