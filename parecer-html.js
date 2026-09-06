// Parecer de Especialista — o formato de impressão, compartilhado entre a
// extensão (janela de impressão com paged.js) e a prova de conceito em Node.
//
// Duas camadas, para dois leitores:
//   · o deputado lê a primeira página (ficha do objeto), as seções fixas, as
//     lentes e "Limites deste parecer" — em palavras comuns, sem
//     identificadores de evidência, sem rótulos do método;
//   · a assessoria que confere lê o "Anexo técnico" no fim, em letra menor:
//     rubrica, tese com identificadores e evidências, contraditório, achados
//     descartados, lentes e gatilhos. A rastreabilidade fica no papel, mas
//     no lugar de quem a usa.
//
// Script clássico (global na extensão) + module.exports para os testes.

const __mh = (typeof module !== 'undefined' && typeof require === 'function') ? { D: require('./dossie.js'), F: require('./ficha.js'), T: require('./tese.js') } : null;
// `const` de script clássico não está em globalThis e a CSP proíbe eval — identificadores explícitos, resolvidos na chamada.
function _refsHtml() {
  if (__mh) return { TITULOS: __mh.T.TITULOS, tabelasDoDossie: __mh.D.tabelasDoDossie, CSS_TABELAS_DOSSIE: __mh.D.CSS_TABELAS_DOSSIE, fichaParaHtml: __mh.F.fichaParaHtml, alteracoesParaHtml: __mh.F.alteracoesParaHtml, CSS_FICHA: __mh.F.CSS_FICHA, NIVEL_EVIDENCIA: __mh.D.NIVEL_EVIDENCIA, unidadesDaTese: __mh.T.unidadesDaTese };
  /* eslint-disable no-undef */
  return { TITULOS, tabelasDoDossie, CSS_TABELAS_DOSSIE, fichaParaHtml, alteracoesParaHtml, CSS_FICHA, NIVEL_EVIDENCIA, unidadesDaTese };
  /* eslint-enable no-undef */
}

function escapeHtmlParecer(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const RE_MARC_HTML = /\s*\[(?:T|O|L|P|A|D|LV|F|S)\d+\](?:\[(?:T|O|L|P|A|D|LV|F|S)\d+\])*/g;

/** Texto do parecer → blocos com âncora (seções fixas e lentes), sem marcadores, com o rótulo do método traduzido. */
function blocosDoParecer(p, esc) {
  const { TITULOS, NIVEL_EVIDENCIA } = _refsHtml();
  const fixas = Object.values(TITULOS).map(s => ({ ordem: '', rotulo: s }));
  const limparMd = s => String(s).replace(/^\s*#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2').trim();
  const paras = String(p.texto || '').split(/\n{2,}/).map(limparMd).filter(Boolean);
  const acha = par => {
    const l1 = par.split('\n')[0].trim().replace(/[:.]$/, '');
    const f = fixas.find(x => l1.toLowerCase() === x.rotulo.toLowerCase());
    if (f) return f;
    return (p.lentes || []).find(x => new RegExp(`^\\s*(${String(x.ordem).replace('.', '\\.')}\\.?\\s*)?${x.rotulo.split(/[ ,]/)[0]}`, 'i').test(l1));
  };
  const secoes = [];
  let atual = { chave: 'abertura', rotulo: 'Abertura', paras: [] };
  for (const par of paras) {
    const l = acha(par);
    if (l && atual.chave !== l.rotulo) { if (atual.paras.length) secoes.push(atual); atual = { chave: l.rotulo, rotulo: l.ordem ? `${l.ordem}. ${l.rotulo}` : l.rotulo, paras: [] }; }
    if (l) { const corpo = par.replace(new RegExp(`^\\s*(${String(l.ordem || '').replace('.', '\\.')}\\.?\\s*)?${l.rotulo}\\s*:?\\s*\\n?`, 'i'), '').trim(); if (corpo) atual.paras.push(corpo); }
    else atual.paras.push(par);
  }
  if (atual.paras.length) secoes.push(atual);
  // "nível de evidência B" fica no texto salvo (a rubrica a exige); impresso,
  // a primeira ocorrência vem traduzida e as seguintes viram a palavra.
  let vezes = 0;
  const traduzir = s => String(s)
    .replace(/n[íi]vel de evid[êe]ncia\s*:?\s*([ABC])\b/gi, (m, n) => { vezes++; const x = NIVEL_EVIDENCIA[n.toUpperCase()]; return vezes === 1 ? `${m} (${x ? x.curta : ''})` : (x ? x.curta : m); })
    .replace(/\b(?:de )?n[íi]vel ([ABC])\b/g, (m, n) => { const x = NIVEL_EVIDENCIA[n]; return x ? `${/^de /.test(m) ? 'de ' : ''}solidez ${x.rotulo} (${n})` : m; });
  const corpoLimpo = s => traduzir(esc(String(s).replace(RE_MARC_HTML, '')));
  return { secoes, corpoLimpo, traduzir };
}

/** O parecer em HTML de impressão. `css` é o CSS da nota (CSS_IMPRESSAO_PLENARIO) — injetado, não importado. */
/**
 * O Firebase não guarda array nem objeto vazio: um parecer salvo e reaberto
 * volta sem `estimativas`, `refutadas`, `faixas`… e as tabelas quebravam
 * ("Cannot read properties of undefined (reading 'map')"). Repõe os vazios.
 */
function normalizarParecer(p) {
  if (!p || typeof p !== 'object') return p;
  const arr = (o, k) => { if (o && !Array.isArray(o[k])) o[k] = []; };
  const obj = (o, k) => { if (o && (o[k] == null || typeof o[k] !== 'object')) o[k] = {}; };
  for (const k of ['lentes', 'descartadas', 'chamadas', 'ressalvasValidade']) arr(p, k);
  if (p.dossie) { for (const k of ['fontes', 'avisos', 'estimativas', 'negacoes', 'leiVigente']) arr(p.dossie, k); obj(p.dossie, 'series'); obj(p.dossie, 'janelas');
    for (const l of p.dossie.leiVigente) arr(l, 'trechos'); if (p.dossie.prc) arr(p.dossie.prc, 'serie'); }
  if (p.tese) { for (const k of ['afirmacoes', 'objetivos', 'opcoes', 'fatores_concorrentes']) arr(p.tese, k); obj(p.tese, 'lados'); }
  if (p.ficha) { arr(p.ficha, 'valores'); arr(p.ficha, 'faltas'); }
  if (p.apuracao) arr(p.apuracao, 'recusados');
  if (p.validacao) { arr(p.validacao, 'removidas'); arr(p.validacao, 'rebaixadas'); }
  if (p.contraditorio) for (const k of ['refutadas', 'contestadas', 'ressalvas']) arr(p.contraditorio, k);
  if (p.conferencia) for (const k of ['semEvidencia', 'numerosSuspeitos', 'idsInexistentes']) arr(p.conferencia, k);
  if (p.gates) for (const k of ['faixas', 'notas', 'reprovacoes', 'rebaixamentos']) arr(p.gates, k);
  if (p.rubrica) { arr(p.rubrica, 'itens'); arr(p.rubrica, 'pendentes'); }
  if (p.carimbo) arr(p.carimbo, 'lentes');
  arr(p, 'alteracoes');
  if (p.processo) for (const k of ['documentos', 'emendas', 'comissoes', 'apensados']) arr(p.processo, k);
  return p;
}

/** Bloco "Tramitação" da primeira página: o que o módulo de Plenário sabe, impresso por programa. */
function tramitacaoParaHtml(pr, esc) {
  if (!pr) return '';
  const linha = (rot, val) => val ? `<tr><th>${esc(rot)}</th><td>${val}</td></tr>` : '';
  const ol = xs => xs && xs.length ? `<ol class="tram-lista">${xs.map(x => `<li>${x}</li>`).join('')}</ol>` : '';
  return `<table class="ficha tramitacao">
    ${linha('O que se vota', pr.cenario ? esc(pr.cenario) + (pr.textoEmVotacao ? `<div class="ficha-fonte">Texto em votação: ${esc(pr.textoEmVotacao)}</div>` : '') : '')}
    ${linha('Relator(a)', pr.relator?.nome ? esc(`${pr.relator.nome}${pr.relator.partido ? ` (${pr.relator.partido}${pr.relator.uf ? '-' + pr.relator.uf : ''})` : ''}${pr.relator.data ? `, designado(a) em ${pr.relator.data}` : ''}`) : '')}
    ${linha('Documentos analisados', ol((pr.documentos || []).map(d => esc(d.rotulo))))}
    ${linha('Emendas e substitutivos', ol((pr.emendas || []).map(e => esc(e.rotulo))))}
    ${linha('Comissões', ol((pr.comissoes || []).map(c => esc(`${c.comissao}${c.dataBR ? ` (${c.dataBR})` : ''}${c.relator ? `, relator(a) ${c.relator}` : ''}${c.posicao ? `: ${c.posicao}` : ''}`))))}
    ${linha('Apensados do Podemos', ol((pr.apensados || []).map(a => esc(a))))}
  </table>`;
}

function htmlParecer(p, { materia = '', logoDataUrl = null, css = '' } = {}) {
  p = normalizarParecer(p);
  const esc = escapeHtmlParecer;
  const bm = ch => 'l_' + String(ch).replace(/[^\w]/g, '_');
  const { secoes, corpoLimpo, traduzir } = blocosDoParecer(p, esc);
  const { tabelasDoDossie, CSS_TABELAS_DOSSIE: CSS_TAB, fichaParaHtml, alteracoesParaHtml, CSS_FICHA, NIVEL_EVIDENCIA, unidadesDaTese } = _refsHtml();
  const tabelas = p.dossie ? tabelasDoDossie(p.dossie, esc) : { corpo: '', anexo: '' };
  const onde = secoes.find(s => /^O que aconteceu/i.test(s.chave)) || secoes.find(s => /^O que se previu/i.test(s.chave)) || null;
  const lista = (cls, titulo, linhas) => linhas && linhas.length ? `<div class="${cls}"><b>${esc(titulo)}</b><ul>${linhas.map(l => `<li>${traduzir(esc(l))}</li>`).join('')}</ul></div>` : '';
  const NE = NIVEL_EVIDENCIA[p.nivel] || {};
  const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

  // ---- primeira página --------------------------------------------------
  const explicaNivel = `Solidez da comparação antes × depois: <b>${esc(NE.rotulo || p.nivel)}</b> — ${esc(NE.explicacao || '')}.`;
  const produto = p.gates?.faixas?.length ? 'Parecer jurídico-processual: a avaliação da política não é verificável com o que se obteve.' : p.temSerie ? `Parecer completo, com o que se previu e o que aconteceu. ${explicaNivel}` : `Parecer sem série oficial: a avaliação fica limitada ao que o processo traz. ${explicaNivel}`;

  // ---- "Limites deste parecer": o que o leitor precisa saber, em palavras ----
  const limites = [];
  for (const f of p.gates?.faixas || []) limites.push(f);
  if (p.temSerie) limites.push(`A comparação entre antes e depois da mudança é ${NE.rotulo || p.nivel}: ${NE.explicacao || ''}. O parecer mostra o que a série registra; não afirma que a medida causou a variação, porque outros fatores agem ao mesmo tempo.`);
  else limites.push('Não há série oficial que permita comparar antes e depois: o efeito da medida não é verificável com o que existe.');
  for (const a of p.dossie?.avisos || []) limites.push(a);
  const nRemov = (p.validacao?.removidas || []).length + (p.contraditorio?.refutadas || []).length;
  const nContest = (p.contraditorio?.contestadas || []).length;
  if (nRemov || nContest) limites.push(`Antes da redação, ${nRemov ? `${nRemov} afirmação(ões) do rascunho foram retiradas por não se sustentarem nas fontes` : ''}${nRemov && nContest ? ' e ' : ''}${nContest ? `${nContest} conclusão(ões) foram rebaixadas a "não verificável" após contestação` : ''}. O detalhe está no anexo técnico.`);
  limites.push('Este parecer não recomenda voto: apresenta as opções e suas consequências; a decisão é da Liderança.');
  if (p.carimbo?.linha) limites.push(p.carimbo.linha + (p.carimbo.ressalva ? ' ' + p.carimbo.ressalva : ''));

  // ---- índice e corpo ------------------------------------------------------
  const indice = `<section class="indice"><h2>Índice</h2><ul>
      <li><a href="#${bm('ficha')}">Ficha do objeto<span class="ld"></span></a></li>
      ${p.processo ? `<li><a href="#${bm('tramitacao')}">Tramitação<span class="ld"></span></a></li>` : ''}
      ${(p.alteracoes || []).length ? `<li><a href="#${bm('alteracoes')}">O que muda na legislação<span class="ld"></span></a></li>` : ''}
      ${secoes.filter(s => s.chave !== 'abertura').map(s => `<li><a href="#${bm(s.chave)}">${esc(s.rotulo)}<span class="ld"></span></a></li>`).join('')}
      <li><a href="#${bm('limites')}">Limites deste parecer<span class="ld"></span></a></li>
      ${p.dossie ? `<li><a href="#${bm('dossie')}">Anexo — Dossiê de dados<span class="ld"></span></a></li>` : ''}
      <li><a href="#${bm('tecnico')}">Anexo técnico — conferência<span class="ld"></span></a></li></ul></section>`;

  const blocoLimites = `<div class="bloco" id="${bm('limites')}">
      <h3 class="item-h">Limites deste parecer</h3>
      <ul class="limites">${limites.map(l => `<li>${traduzir(esc(l))}</li>`).join('')}</ul>
    </div>`;
  const corpo = secoes.map(s => `<div class="bloco" id="${bm(s.chave)}">
      ${s.chave === 'abertura' ? '' : `<h3 class="item-h">${esc(s.rotulo)}</h3>`}
      ${s.paras.map(x => `<p>${corpoLimpo(x)}</p>`).join('\n')}
      ${s === onde ? tabelas.corpo : ''}
    </div>${/^Opções e consequências/i.test(s.chave) ? blocoLimites : ''}`).join('');
  const temLimitesNoCorpo = secoes.some(s => /^Opções e consequências/i.test(s.chave));

  // ---- anexo técnico -------------------------------------------------------
  const rub = p.rubrica || { itens: [], aprovado: false, resumo: '' };
  const unidades = (p.tese && unidadesDaTese) ? unidadesDaTese(p.tese) : [];
  const tabelaTese = unidades.length ? `<table class="dt"><thead><tr><th>Id</th><th>Tipo · seção</th><th>Afirmação</th><th>Evidências</th></tr></thead><tbody>${unidades.map(u => `<tr><td>${esc(u.id)}</td><td>${esc(u.tipo)} · ${esc(u.secao)}</td><td>${esc(u.texto)}</td><td>${esc((u.evidencias || []).join(', '))}</td></tr>`).join('')}</tbody></table>` : '';
  const anexoTecnico = `<div class="bloco tecnico" id="${bm('tecnico')}">
      <h3 class="item-h">Anexo técnico — conferência</h3>
      <p class="tec-nota">Para quem confere o documento antes de circular. O texto do parecer só pode afirmar o que consta da tese abaixo; cada unidade da tese aponta para evidências (A achados no documento, D dados do dossiê, LV lei, S situação da tramitação, F ficha).</p>
      <div class="${rub.aprovado ? 'conf-ok' : 'conf-erro'}"><b>${esc(rub.resumo)}</b><ul>${(rub.itens || []).map(i => `<li>${i.ok ? '✓' : '✗'} ${esc(i.item)}${i.detalhe ? ` — ${esc(i.detalhe)}` : ''}</li>`).join('')}</ul></div>
      ${lista('conf-ok', `Lentes aplicadas (${(p.lentes || []).length})`, (p.lentes || []).map(l => `${l.ordem}. ${l.rotulo} — acionada por ${l.motivo}`))}
      ${lista('conf-pend', 'Lentes sugeridas e NÃO aplicadas', (p.descartadas || []).map(l => `${l.rotulo}: ${l.ressalva}`))}
      <div class="conf-ok">Apuração: ${p.apuracao?.aprovados ?? 0} achado(s) com trecho localizado no documento; ${(p.apuracao?.recusados || []).length} descartado(s); ${p.apuracao?.semQuestao ?? 0} linha(s) sem questão. Tese: ${esc(p.validacao?.resumo || '')}. Contraditório: ${esc(p.contraditorio?.resumo || '')}.${p.refeita ? ' A redação foi refeita uma vez após reprovação.' : ''} Chamadas ao modelo: ${(p.chamadas || []).map(c => c.nome).join(', ') || '—'}.</div>
      ${lista('conf-pend', 'Achados descartados na apuração (trecho não localizado)', (p.apuracao?.recusados || []).map(r => `${r.lente} · ${r.pergunta}: ${r.motivo}${r.trecho ? ` — "${r.trecho}…"` : ''}`))}
      ${lista('conf-pend', 'Afirmações removidas na validação', (p.validacao?.removidas || []).map(r => `${r.id} (${r.motivo}): ${String(r.texto || '').slice(0, 160)}`))}
      ${lista('conf-pend', 'Refutadas no contraditório', (p.contraditorio?.refutadas || []).map(r => `${r.id} (${r.motivo}): ${String(r.texto || '').slice(0, 160)}`))}
      ${lista('conf-pend', 'Juízos contestados e rebaixados a "não verificável"', (p.contraditorio?.contestadas || []).map(r => `${r.id}: ${r.motivo}`))}
      ${lista('conf-pend', 'Ressalvas do contraditório a dados mantidos', (p.contraditorio?.ressalvas || []).map(r => `${r.id}: ${r.motivo}`))}
      ${lista('conf-pend', 'Rebaixamentos aplicados no texto', (p.gates?.rebaixamentos || []).map(r => `${r.gate}: ${r.detalhe}`))}
      ${p.conferencia ? `<div class="${p.conferencia.ok ? 'conf-ok' : 'conf-erro'}">Redação: ${p.conferencia.ok ? 'todos os parágrafos de juízo citam evidência existente e todos os números constam da base.' : `${p.conferencia.semEvidencia.length} parágrafo(s) sem evidência; ${p.conferencia.numerosSuspeitos.length} número(s) fora da base; ${p.conferencia.idsInexistentes.length} identificador(es) inexistente(s).`}</div>` : ''}
      ${lista('conf-pend', 'Ressalvas de validade dos roteiros', (p.ressalvasValidade || []).map(r => `${r.lente}: ${r.texto}`))}
      ${p.truncado ? '<div class="conf-pend">A redação foi interrompida no limite de tokens do modelo — o final pode estar incompleto.</div>' : ''}
      <h4 class="dt-h">Tese aprovada, com evidências</h4>
      ${tabelaTese || '<p class="tec-nota">Sem tese registrada.</p>'}
      ${p.carimbo ? `<div class="carimbo">${esc(p.carimbo.linha)}${p.carimbo.ressalva ? ` ${esc(p.carimbo.ressalva)}` : ''} Gerado em ${esc(dataBR(p.geradoEm))}.</div>` : ''}
    </div>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Parecer — ${esc(materia)}</title>
  <style>
${css}
    .conf-ok   { background:#f2f8f2; border-left:3px solid #2f7a3a; padding:6px 10px; margin:6px 0; font-size:9pt; }
    .conf-pend { background:#fffaf0; border-left:3px solid #d68a00; padding:6px 10px; margin:6px 0; font-size:9pt; }
    .conf-erro { background:#fdf3f3; border-left:3px solid #b03030; padding:6px 10px; margin:6px 0; font-size:9pt; }
    .faixa     { background:#b03030; color:#fff; padding:8px 12px; margin:10px 0; font-weight:600; font-size:10.5pt; }
    .produto   { font-size:10pt; color:#333; margin:6px 0 2px; }
    .limites   { margin:4px 0 6px 18px; padding:0; font-size:10.5pt; } .limites li { margin:3px 0; line-height:1.4; }
    .tecnico   { page-break-before:always; font-size:9pt; } .tecnico ul { margin:2px 0 4px 16px; } .tecnico li { font-size:8.8pt; margin:1px 0; }
    .tec-nota  { font-size:9pt; color:#555; }
    .carimbo   { margin-top:10px; font-size:8.8pt; color:#666; font-style:italic; }
    .tram-lista { margin:0 0 0 16px; padding:0; } .tram-lista li { margin:1px 0; }
${CSS_FICHA || ''}
${CSS_TAB || ''}
  </style></head><body>
    <div class="cab">
      <div class="sp"></div>
      <div class="tit"><h1>Parecer de Especialista</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
    </div>
    <div class="rule"></div>
    <div class="meta">${esc(materia)} · texto analisado: ${esc(p.textoAnalisado)}${p.situacao ? ` · situação: ${esc(p.situacao)}` : ''}</div>
    <div class="produto">${produto}</div>
    ${(p.gates?.faixas || []).map(f => `<div class="faixa">${esc(f)}</div>`).join('')}
    <div class="bloco" id="${bm('ficha')}">
      <h3 class="item-h">Ficha do objeto</h3>
      ${fichaParaHtml(p.ficha, esc)}
      ${lista('conf-pend', 'Observações', p.gates?.notas || [])}
    </div>
    ${p.processo ? `<div class="bloco" id="${bm('tramitacao')}">
      <h3 class="item-h">Tramitação</h3>
      ${tramitacaoParaHtml(p.processo, esc)}
    </div>` : ''}
    ${(p.alteracoes || []).length ? `<div class="bloco" id="${bm('alteracoes')}">
      <h3 class="item-h">O que muda na legislação</h3>
      ${alteracoesParaHtml(p.alteracoes, esc)}
      <p class="tec-nota">"O que vale hoje" é o texto lido na fonte indicada; "o que a proposição faz" é o achado da apuração, conferido no documento pelo trecho.</p>
    </div>` : ''}
    ${indice}
    ${corpo}
    ${temLimitesNoCorpo ? '' : blocoLimites}
    ${p.dossie ? `<div class="bloco" id="${bm('dossie')}">
      <h3 class="item-h">Anexo — Dossiê de dados</h3>
      <p style="font-size:9.5pt;color:#555">Base numérica do parecer, apurada pelo programa nas fontes oficiais antes da redação. Solidez da comparação antes × depois: ${esc(NE.rotulo || p.nivel)}.</p>
      ${tabelas.anexo || '<p style="font-size:9.5pt;color:#555">Nenhuma série obtida.</p>'}
    </div>` : ''}
    ${anexoTecnico}
    <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
  </body></html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { htmlParecer, blocosDoParecer, escapeHtmlParecer, normalizarParecer, tramitacaoParaHtml };
}
