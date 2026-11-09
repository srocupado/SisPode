'use strict';

// ── RESUMO EXECUTIVO DA PAUTA (Pautas CCJC) ─────────────────────────────────
// Leitura rápida da pauta para a liderança: visão geral, tabela dos itens
// comentados (tema, relator, parecer na CCJC, potencial de debate), um bloco
// por item (o que faz, tramitação, parecer na CCJC, pontos de atenção) e a
// leitura geral. Modelo: o resumo que um usuário montou para a pauta de
// 03/11/2026 (122 itens, 7 comentados, 115 PDLs de rádio e TV).
//
// O que é contagem (itens, PDLs de radiodifusão, relatoria e autoria do
// Podemos) sai dos dados da pauta. O texto de cada item sai da IA, a partir da
// nota JÁ GERADA (resumo do original, análise por comissão, argumentos) —
// nenhum documento novo é lido. O resultado fica na pauta (resumoExecutivo) e
// só é refeito quando alguma análise muda (assinatura = chave + data da análise).
// A posição do governo (ccjc-governo.js), quando importada, entra na tabela, no
// bloco de cada item e no destaque dos itens do Podemos — direto do PDF, sem IA.
// Usa de ccjc-governo.js: govPosicao, govBadge, GOV_CSS.
// Usa de ccjc.js: app, aiCall, mapLimit, carregarLogoCCJC, salvarPauta,
// coletarEdicoesAtivas, mostrarToast, escHtml, NOME_PROVEDOR, _provedorEfetivo, _modeloAtualLabel.

// PDL de outorga ou renovação de rádio e TV: matéria de rotina, fora do resumo.
// MEDIDO na pauta de 03/11/2026: as 115 ementas de PDL casam.
const RESUMO_ROTINA = /radiodifus|r[aá]dio|televis|sons e imagens|retransmiss/i;
const RESUMO_DEBATE = ['Baixo', 'Médio', 'Alto'];

const resumoEhRotina = p => /^(PDL|PDC)$/.test(p.sigla || '') && RESUMO_ROTINA.test(p.ementa || '');
// O mesmo critério do PDF da pauta (gerarHTMLImpressao): "com análise".
const resumoComAnalise = p => !!(p.resumoOriginal || p.statusAnalise === 'concluido');
const resumoAssinatura = itens => itens.map(p => `${p.chave}@${p.analiseEm || ''}`).join('|');

/** O JSON da resposta da IA (com ou sem cerca de código). */
function resumoJSON(txt) {
  const t = String(txt || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('a IA não devolveu JSON');
  return JSON.parse(t.slice(i, j + 1));
}

function resumoPromptItem(p) {
  const ccjc = (p.comissoes || []).find(c => c.sigla === 'CCJC');
  const outras = (p.comissoes || []).filter(c => c.sigla !== 'CCJC' && c.resumo);
  const corta = (s, n) => String(s || '').slice(0, n);
  return `Você é assessor(a) da Liderança do Podemos na Câmara dos Deputados e prepara o RESUMO EXECUTIVO da pauta da CCJC: uma leitura de um minuto por item, para a liderança.

Item: ${p.chave}
Ementa: "${corta(p.ementa, 800)}"
${p.autores?.length ? `Autoria: ${p.autores.join(', ')}\n` : ''}Relator(a) na CCJC: ${p.relator || 'não consta'}

NOTA JÁ GERADA PELA ASSESSORIA (única fonte que você pode usar):

[Resumo do projeto original]
${corta(p.resumoOriginal, 4000) || 'não consta'}

[Parecer em votação na CCJC]
${corta(ccjc?.resumo, 5000) || 'não consta'}
${outras.length ? `\n[Passagem por outras comissões]\n${outras.map(c => `${c.nome || c.sigla} (${c.sigla}): ${corta(c.resumo, 1500)}`).join('\n\n')}\n` : ''}
[Argumentos favoráveis]
${corta(p.argumentosFavoraveis, 1500) || 'não consta'}

[Argumentos contrários]
${corta(p.argumentosContrarios || p.argumentosSemSeparacao, 1500) || 'não consta'}

Responda SOMENTE com um objeto JSON, sem texto antes ou depois, com estas chaves:
{
  "tema": "o assunto em até 6 palavras, para a tabela (ex.: \\"Busca de desaparecidos e Alerta Âmber\\")",
  "titulo": "título do item em até 10 palavras, em linguagem simples, sem a sigla",
  "oQueFaz": "o que o projeto faz, em até 4 frases curtas; se houver várias medidas, só a frase de abertura",
  "oQueFazItens": ["cada medida numa frase curta — de 0 a 6 itens, só quando o projeto tiver várias medidas"],
  "tramitacao": "até 2 frases sobre o que as OUTRAS comissões mudaram no texto; \\"\\" se não passou por outra comissão",
  "parecerCurto": "a conclusão do relator na CCJC em até 5 palavras, no padrão: Aprovação do texto original | Aprovação com emenda | Aprovação com emendas | Aprovação com substitutivo | Aprovação com subemenda | Rejeição | Inconstitucionalidade",
  "parecer": "1 a 2 frases: a conclusão do relator na CCJC e o que ela muda no texto",
  "pontosAtencao": "1 a 2 frases: possíveis focos de debate na votação",
  "focoDebate": "o que motiva o debate, em até 5 palavras (ex.: \\"política penal\\")",
  "debate": "Baixo | Médio | Alto — potencial de debate na votação"
}

Regras:
- Use apenas a nota acima. Não invente números, leis, artigos, datas ou nomes; o que não estiver na nota fica de fora.
- Português do Brasil, frases curtas e diretas, sem jargão desnecessário.
- Não recomende voto e não tome posição.`;
}

/** Um item do resumo: o texto da IA, conferido e com os campos que a tabela exige. */
async function resumoGerarItem(p) {
  const j = resumoJSON(await aiCall(resumoPromptItem(p)));
  const txt = v => String(v == null ? '' : v).trim();
  const debate = RESUMO_DEBATE.find(d => d.toLowerCase() === txt(j.debate).toLowerCase().replace('medio', 'médio')) || '';
  return {
    chave: p.chave,
    tema: txt(j.tema), titulo: txt(j.titulo), oQueFaz: txt(j.oQueFaz),
    oQueFazItens: Array.isArray(j.oQueFazItens) ? j.oQueFazItens.map(txt).filter(Boolean).slice(0, 8) : [],
    tramitacao: txt(j.tramitacao), parecerCurto: txt(j.parecerCurto), parecer: txt(j.parecer),
    pontosAtencao: txt(j.pontosAtencao), focoDebate: txt(j.focoDebate), debate,
  };
}

const porChaveDe = pauta => Object.fromEntries((pauta.projetos || []).map(p => [p.chave, p]));
const resumoDoPodemos = p => !!(p && (p.relatoria === 'pode' || p.autoria?.podemos));

/** Visão geral e leitura geral: contagens dos dados, sem IA. */
function resumoTextosGerais(pauta, dados) {
  const projs = pauta.projetos || [];
  const com = projs.filter(resumoComAnalise), sem = projs.filter(p => !resumoComAnalise(p));
  const rotina = sem.filter(resumoEhRotina), outrosSem = sem.filter(p => !resumoEhRotina(p));
  const n = (k, um, varios) => `${k} ${k === 1 ? um : varios}`;
  const lista = ps => ps.map(p => `<b>${escHtml(p.chave)}</b>`).join(', ').replace(/, ([^,]*)$/, ' e $1');
  const p1 = [`A pauta tem ${n(projs.length, 'item', 'itens')}, dos quais ${com.length === 1 ? '1 foi comentado' : `${com.length} foram comentados`}.`];
  if (rotina.length) {
    const quem = rotina.length === sem.length ? (sem.length === 1 ? 'O outro é um PDL' : `Os outros ${sem.length} são PDLs`)
      : `Dos ${sem.length} sem análise, ${rotina.length === 1 ? '1 é PDL' : `${rotina.length} são PDLs`}`;
    p1.push(`${quem} de renovação ou autorização de rádio e TV, matéria de rotina.`);
  }
  if (outrosSem.length) p1.push(`Ainda sem análise: ${lista(outrosSem)}.`);
  // Podemos na pauta inteira, comentado ou não
  const rel = projs.filter(p => p.relatoria === 'pode'), aut = projs.filter(p => p.autoria?.podemos);
  // Itens do Podemos: com a posição do governo, quando importada
  const posGov = p => { const g = govPosicao(pauta, p); return g ? ` — governo: ${govBadge(g.posicao)}` : ''; };
  const doPode = (ps, papel) => ps.length ? `${ps.length === 1 ? `Há um item sob ${papel} do Podemos` : `Há ${ps.length} itens sob ${papel} do Podemos`}: ${ps.map(p => `<b>${escHtml(p.chave)}</b>${p.relator && papel === 'relatoria' ? ` (dep. ${escHtml(p.relator)})` : ''}${resumoEhRotina(p) ? ', de rádio e TV' : ''}${posGov(p)}`).join('; ')}.` : '';
  const p1b = [doPode(rel, 'relatoria'), doPode(aut, 'autoria')].filter(Boolean).join(' ');

  const pela = dados.filter(d => /^aprova/i.test(d.parecerCurto));
  const p2 = dados.length
    ? (pela.length === dados.length
      ? `Em ${dados.length === 1 ? 'o item comentado' : `todos os ${dados.length} itens comentados`}, o parecer do relator na CCJC é favorável.`
      : `Em ${pela.length} dos ${dados.length} itens comentados, o parecer do relator na CCJC é favorável; ${lista(dados.filter(d => !pela.includes(d)))} ${dados.length - pela.length === 1 ? 'tem' : 'têm'} outra conclusão.`)
      + ' Os pontos de atenção são possíveis focos de debate, não argumentos registrados no parecer.'
    : '';

  // Posição do governo nos itens comentados (contagem por posição, na ordem em que aparece)
  let pGov = '';
  if (pauta.governo) {
    const conta = new Map();
    let sem = 0;
    for (const d of dados) {
      const g = govPosicao(pauta, porChaveDe(pauta)[d.chave] || { chave: d.chave });
      if (g) conta.set(g.posicao, (conta.get(g.posicao) || 0) + 1); else sem++;
    }
    pGov = conta.size ? `Posição do governo nos itens comentados: ${[...conta].map(([pos, k]) => `${escHtml(pos)} em ${k}`).join(', ').replace(/, ([^,]*)$/, ' e $1')}${sem ? `; ${sem} sem posição no documento do governo` : ''}.` : '';
  }

  const altos = dados.filter(d => d.debate === 'Alto');
  const leitura = altos.length
    ? `${altos.length === 1 ? 'O item com maior potencial de debate é' : 'Os itens com maior potencial de debate são'} ${altos.map(d => `o <b>${escHtml(d.chave)}</b>${d.focoDebate ? ` (${escHtml(d.focoDebate)})` : ''}`).join(', ').replace(/, ([^,]*)$/, ' e $1')}.${altos.length < dados.length ? ' Os demais tendem a ter tramitação tranquila.' : ''}`
    : dados.length ? 'Nenhum item comentado tem potencial alto de debate.' : '';
  // Com os blocos e os números dos itens da pauta oficial (ccjc-blocos.js): os blocos, onde
  // estão os comentados e os sem análise, e os itens do Podemos com número e bloco.
  const v = typeof pautaVisaoGeral === 'function' ? pautaVisaoGeral(pauta, { comAnalise: resumoComAnalise, rotina: resumoEhRotina, posGov,
    remissao: sem.length ? 'A relação completa está na seção “Itens sem análise”, ao final deste resumo.' : '' }) : null;
  const pParecer = [p2, pGov].filter(Boolean).join(' ');
  const abertura = v ? [v.p1, v.p2, v.p3, pParecer].filter(Boolean) : [p1.join(' ') + (p1b ? ' ' + p1b : ''), pParecer].filter(Boolean);
  return { p1: p1.join(' ') + (p1b ? ' ' + p1b : ''), p2: pParecer, abertura, comBlocos: !!v, leitura, com: com.length, sem: sem.length };
}

function resumoHTML(pauta, res, logo) {
  const dados = res.itens;
  const porChave = porChaveDe(pauta);
  const g = resumoTextosGerais(pauta, dados);
  const gov = !!pauta.governo;
  const posDe = d => (govPosicao(pauta, porChave[d.chave] || { chave: d.chave }) || {}).posicao || '';
  const cor = { Baixo: 'b', 'Médio': 'm', Alto: 'a' };
  const nItem = d => { const p = porChave[d.chave]; return p && Number.isFinite(p.item) ? p.item : null; };
  const tabela = dados.length ? `<table class="tab"><thead><tr><th>Projeto</th><th>Tema</th><th>Relator(a)</th><th>Parecer na CCJC</th><th class="c">Debate</th>${gov ? '<th class="c">Governo</th>' : ''}</tr></thead><tbody>${dados.map(d =>
    `<tr${resumoDoPodemos(porChave[d.chave]) ? ' class="tr-pode"' : ''}><td class="ch">${nItem(d) != null ? `<span class="ni">Item ${nItem(d)}</span><br>` : ''}${escHtml(d.chave)}${resumoDoPodemos(porChave[d.chave]) ? '<br><span class="pode">Podemos</span>' : ''}</td><td>${escHtml(d.tema)}</td><td>${escHtml(porChave[d.chave]?.relator || '')}</td><td>${escHtml(d.parecerCurto)}</td><td class="c">${d.debate ? `<span class="db db-${cor[d.debate]}">${d.debate}</span>` : '—'}</td>${gov ? `<td class="c">${govBadge(posDe(d))}</td>` : ''}</tr>`).join('')}</tbody></table>
    <p class="nota">Coluna "Debate": potencial de debate estimado pela IA a partir da nota da assessoria.${gov ? ' Coluna "Governo": posição da Liderança do Governo na CD, do documento importado.' : ''}</p>` : '';
  const itens = dados.map((d, i) => {
    const p = porChave[d.chave] || {};
    const marcas = [p.autoria?.podemos ? (p.autoria.principal ? 'Autoria do Podemos' : 'Coautoria do Podemos') : '', p.relatoria === 'pode' ? 'Relatoria do Podemos' : ''].filter(Boolean);
    return `<section class="item">
      <div class="it-cab"><h2>${nItem(d) != null ? `Item ${nItem(d)} – ` : `${i + 1}. `}${escHtml(d.chave)}${d.titulo ? ` – ${escHtml(d.titulo)}` : ''}</h2>
        <div class="it-meta">${p.autores?.length ? `Autoria: ${escHtml(p.autores.join(', '))}<br>` : ''}${p.relator ? `Relator(a): ${escHtml(p.relator)}` : ''}${marcas.map(m => `<br><span class="pode">${m}</span>`).join('')}</div></div>
      <h3>O que faz</h3><p>${escHtml(d.oQueFaz)}</p>${d.oQueFazItens.length ? `<ul>${d.oQueFazItens.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>` : ''}
      ${d.tramitacao ? `<h3>Tramitação</h3><p>${escHtml(d.tramitacao)}</p>` : ''}
      <h3>Parecer na CCJC</h3><div class="par">${escHtml(d.parecer || d.parecerCurto || 'não consta')}</div>
      ${gov ? `<h3>Posição do governo</h3><p>${govBadge(posDe(d))}${posDe(d) ? '' : ' <span class="nota">sem posição no documento do governo</span>'}</p>` : ''}
      ${d.pontosAtencao ? `<div class="aten"><b>Pontos de atenção</b><p>${escHtml(d.pontosAtencao)}</p></div>` : ''}
    </section>`;
  }).join('');
  // Itens sem análise: a relação completa, por bloco (é para onde a visão geral remete)
  const semAn = (pauta.projetos || []).filter(p => !resumoComAnalise(p));
  // na tabela, só a letra do bloco (os nomes vão na nota); bloco sem letra (tópico da API), pelo nome
  const blocoTxt = p => { const bl = typeof blocoDe === 'function' ? blocoDe(pauta, p) : null; return bl ? (bl.letra || bl.nome) : ''; };
  const legBlocos = (pauta.blocos || []).filter(x => x.letra).map(x => `${escHtml(x.letra)} – ${escHtml(x.nome)}`).join('; ');
  const corta = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
  const semHTML = semAn.length && g.comBlocos ? `<section class="item"><h2 class="sec" style="margin-top:0">Itens sem análise</h2>
    <p class="nota">${semAn.length} ${semAn.length === 1 ? 'item' : 'itens'} da pauta sem nota da assessoria, na ordem da pauta.${legBlocos ? ` Blocos: ${legBlocos}.` : ''}</p>
    <table class="tab sem"><thead><tr><th class="c">Item</th><th>Proposição</th><th class="c">Bloco</th><th>Relator(a)</th><th>Ementa</th></tr></thead><tbody>${semAn.map(p =>
      `<tr${resumoDoPodemos(p) ? ' class="tr-pode"' : ''}><td class="c">${Number.isFinite(p.item) ? p.item : ''}</td><td class="ch">${escHtml(p.chave)}${resumoDoPodemos(p) ? '<br><span class="pode">Podemos</span>' : ''}</td><td class="c">${escHtml(blocoTxt(p))}</td><td>${escHtml(p.relator || '')}</td><td>${escHtml(corta(p.ementa, 180))}</td></tr>`).join('')}</tbody></table></section>` : '';
  const falhas = res.falhas?.length ? `<p class="nota">Sem resumo (a IA falhou): ${res.falhas.map(escHtml).join(', ')} — gere de novo para tentar outra vez.</p>` : '';
  const geradoEm = res.geradoEm ? new Date(res.geradoEm).toLocaleString('pt-BR') : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escHtml(pauta.titulo)} · Resumo executivo</title><style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',Arial,sans-serif; font-size:10.5pt; color:#1f2937; background:#fff; padding:22px 30px; }
  .cab { display:flex; align-items:center; gap:16px; }
  .cab .tx { flex:1; }
  .cab img { height:46px; }
  .org { font-size:8.5pt; font-weight:700; letter-spacing:.06em; color:#0b8a4b; }
  h1 { font-size:18pt; color:#0b5e3a; margin:2px 0; }
  .sub { font-size:9.5pt; color:#5b6b7b; }
  .filete { height:4px; margin:10px 0 16px; background:linear-gradient(90deg,#0B8A4B 0 40%,#7C9A2F 40% 62%,#1F5FA8 62% 82%,#D9531E 82% 100%); }
  h2.sec { font-size:13pt; color:#0b5e3a; margin:16px 0 8px; }
  p { line-height:1.6; margin-bottom:7px; }
  .tab { width:100%; border-collapse:collapse; margin:10px 0 4px; font-size:9pt; }
  .tab th { background:#0b5e3a; color:#fff; text-align:left; padding:6px 8px; font-weight:600; }
  .tab td { padding:6px 8px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
  .tab tr:nth-child(even) td { background:#f6f8f7; }
  .tab .ch { font-weight:700; white-space:nowrap; } .tab .c { text-align:center; }
  .tab .ni { font-size:7.5pt; font-weight:600; color:#6b7280; }
  .tab.sem { font-size:8pt; } .tab.sem td { padding:4px 6px; } .tab.sem tr { break-inside:avoid; }
  .db { display:inline-block; padding:1px 8px; border-radius:999px; font-size:8pt; font-weight:700; }
  .db-b { background:#e7f6ec; color:#1b7a3d; } .db-m { background:#fff4dc; color:#a16207; } .db-a { background:#fde8e8; color:#b42318; }
  .nota { font-size:8.5pt; font-style:italic; color:#6b7280; }
  .item { break-inside:avoid; page-break-inside:avoid; border-top:1px solid #e5e7eb; padding-top:14px; margin-top:16px; }
  .it-cab { display:flex; gap:16px; align-items:flex-start; justify-content:space-between; }
  .it-cab h2 { font-size:12.5pt; color:#0b5e3a; line-height:1.35; }
  .it-meta { font-size:8.5pt; color:#6b7280; text-align:right; min-width:170px; }
  .pode { color:#0b8a4b; font-weight:700; } .tab .pode { font-size:7.5pt; }
  ${GOV_CSS}
  h3 { font-size:9.5pt; color:#1f2937; margin:10px 0 4px; border-left:3px solid #0b8a4b; padding-left:7px; }
  ul { margin:2px 0 8px 20px; } li { line-height:1.55; margin-bottom:2px; }
  .par { background:#f5f7fa; border-radius:6px; padding:8px 12px; line-height:1.55; }
  .aten { background:#fff8e8; border-left:3px solid #e0a800; border-radius:6px; padding:8px 12px; margin-top:10px; }
  .aten b { color:#a16207; font-size:9pt; } .aten p { margin:3px 0 0; }
  .leit { background:#eef8f1; border-left:3px solid #0b8a4b; border-radius:6px; padding:10px 14px; }
  .rod { margin-top:24px; padding-top:8px; border-top:1px solid #e5e7eb; font-size:8.5pt; color:#9ca3af; text-align:center; }
  @page { size:A4; margin:14mm; }
  @media print { body { padding:0; } .filete, .tab th, .tab td, .db, .par, .aten, .leit { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
  </style></head><body>
  <div class="cab"><div class="tx"><div class="org">LIDERANÇA DO PODEMOS NA CÂMARA DOS DEPUTADOS</div><h1>${escHtml(pauta.titulo)}</h1>
    <div class="sub">Resumo executivo · ${(pauta.projetos || []).length} projeto(s) em pauta · ${g.com} com análise · ${g.sem} sem análise${pauta.responsavel ? ` · Servidor responsável: ${escHtml(pauta.responsavel)}` : ''}</div></div>
    ${logo ? `<img src="${logo}" alt="Podemos">` : ''}</div>
  <div class="filete"></div>
  <h2 class="sec">Visão geral</h2>
  ${g.abertura.map(t => `<p>${t}</p>`).join('')}
  ${tabela}${falhas}
  ${itens}
  ${g.leitura ? `<section class="item"><h2 class="sec" style="margin-top:0">Leitura geral da pauta</h2><div class="leit">${g.leitura}</div></section>` : ''}
  ${semHTML}
  <p class="nota" style="margin-top:12px">Fonte: notas da pauta da CCJC de ${escHtml(pauta.titulo.replace(/^.*?–\s*/, ''))} no SisPode${geradoEm ? ` · resumo gerado em ${geradoEm}${res.modelo ? ` (${escHtml(res.modelo)})` : ''}` : ''}.${gov ? ` Posição do governo: Liderança do Governo na CD${pauta.governo.reuniao ? `, reunião de ${escHtml(pauta.governo.reuniao)}` : ''} (${escHtml(pauta.governo.arquivo || 'PDF')}, importado em ${new Date(pauta.governo.importadoEm).toLocaleString('pt-BR')}).` : ''}</p>
  <div class="rod">Resumo executivo elaborado a partir do SisPode · Liderança do Podemos · Câmara dos Deputados</div>
  </body></html>`;
}

/** Botão "Resumo executivo": gera (ou reaproveita) o resumo e abre para imprimir/salvar em PDF. */
async function gerarResumoExecutivo() {
  const pauta = app.pautaAtual;
  if (!pauta) { mostrarToast('Nenhuma pauta carregada.', 'aviso'); return; }
  coletarEdicoesAtivas();
  const itens = pauta.projetos.filter(resumoComAnalise);
  if (!itens.length) { mostrarToast('Nenhum item com análise: gere as análises antes do resumo.', 'aviso'); return; }

  // Janela aberta no gesto do clique (pop-up depois de await é bloqueado).
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) { mostrarToast('Permita pop-ups para gerar o resumo.', 'aviso'); return; }
  const aviso = t => { try { win.document.body.textContent = t; } catch (_) {} };
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Resumo executivo…</title></head><body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Preparando o resumo executivo…</body></html>');
  win.document.close();

  // blocos e números dos itens da pauta oficial (pautas salvas antes desta versão)
  if (typeof garantirBlocosPauta === 'function') { try { await garantirBlocosPauta(pauta); } catch (e) { console.warn('Blocos da pauta:', e.message); } }

  const assinatura = resumoAssinatura(itens);
  let res = pauta.resumoExecutivo;
  if (!res || res.assinatura !== assinatura || res.falhas?.length) {
    // Itens já resumidos com a mesma análise são reaproveitados; só o que mudou vai à IA.
    const antes = Object.fromEntries(((res && res.itens) || []).map(d => [d.chave, d]));
    const assAntes = new Set(String(res?.assinatura || '').split('|'));
    let feitos = 0;
    const falhas = [];
    const out = new Array(itens.length).fill(null);   // mapLimit (ccjc.js) não devolve os resultados
    await mapLimit(itens, 3, async (p, i) => {
      const ok = antes[p.chave] && assAntes.has(`${p.chave}@${p.analiseEm || ''}`) ? antes[p.chave] : null;
      try { out[i] = ok || await resumoGerarItem(p); }
      catch (e) { console.warn(`Resumo de ${p.chave}:`, e.message); falhas.push(p.chave); }
      finally { aviso(`Resumindo os itens comentados… ${++feitos}/${itens.length}`); }
    });
    if (win.closed) return;
    res = { assinatura, geradoEm: new Date().toISOString(), provedor: NOME_PROVEDOR[_provedorEfetivo()] || '', modelo: _modeloAtualLabel(),
      itens: out.filter(Boolean), falhas };
    if (res.itens.length) { pauta.resumoExecutivo = res; salvarPauta(); }
    if (!res.itens.length) { aviso('A IA não devolveu o resumo de nenhum item. Confira a chave em ⚙ Configurações e tente de novo.'); return; }
  }
  const logo = await carregarLogoCCJC();
  if (win.closed) return;
  win.document.open();
  win.document.write(resumoHTML(pauta, res, logo));
  win.document.close();
  const img = win.document.querySelector('img');
  try { if (img) await img.decode(); } catch (_) {}
  setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 300);
  mostrarToast(res.falhas?.length ? `Resumo gerado; ${res.falhas.length} item(ns) ficaram de fora (a IA falhou).` : 'Resumo executivo pronto — escolha "Salvar como PDF".', res.falhas?.length ? 'aviso' : 'info');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resumoEhRotina, resumoComAnalise, resumoAssinatura, resumoJSON, resumoPromptItem, resumoGerarItem, resumoTextosGerais, resumoHTML };
}
