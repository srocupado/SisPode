// Parecer de Especialista — o formato de impressão, compartilhado entre a
// extensão (janela de impressão com paged.js) e a prova de conceito em Node.
//
// Primeira página: cabeçalho da casa, ficha do objeto (por JS, com a origem de
// cada campo), faixa de incompletude quando houver, notas dos gates. Corpo: as
// seções fixas e as lentes, com as tabelas do dossiê logo após "O que
// aconteceu". Fim: conferência (rubrica, tese, contraditório, números) e o
// anexo com a série completa e as fontes. Os marcadores [T3] viram
// sobrescritos pequenos — a rastreabilidade fica no papel.
//
// Script clássico (global na extensão) + module.exports para os testes.

const __mh = (typeof module !== 'undefined' && typeof require === 'function') ? { D: require('./dossie.js'), F: require('./ficha.js'), T: require('./tese.js') } : null;
// Ver nota em pipeline-parecer.js: `const` de script clássico não está em
// globalThis e a CSP proíbe eval — identificadores explícitos, resolvidos na chamada.
function _refsHtml() {
  if (__mh) return { TITULOS: __mh.T.TITULOS, tabelasDoDossie: __mh.D.tabelasDoDossie, CSS_TABELAS_DOSSIE: __mh.D.CSS_TABELAS_DOSSIE, fichaParaHtml: __mh.F.fichaParaHtml, CSS_FICHA: __mh.F.CSS_FICHA };
  /* eslint-disable no-undef */
  return { TITULOS, tabelasDoDossie, CSS_TABELAS_DOSSIE, fichaParaHtml, CSS_FICHA };
  /* eslint-enable no-undef */
}

function escapeHtmlParecer(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** Texto do parecer → blocos com âncora (seções fixas e lentes), marcadores como sobrescrito. */
function blocosDoParecer(p, esc) {
  const { TITULOS } = _refsHtml();
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
  // A expressão "nível de evidência B" fica no texto (a rubrica a exige uma
  // vez), mas impressa com a tradução na primeira ocorrência e reduzida nas
  // seguintes — o leitor não é obrigado a saber o método.
  const NEs = typeof NIVEL_EVIDENCIA !== 'undefined' ? NIVEL_EVIDENCIA : (__mh ? __mh.D.NIVEL_EVIDENCIA : {});
  let vezes = 0;
  const traduzir = s => String(s)
    .replace(/n[íi]vel de evid[êe]ncia\s*:?\s*([ABC])\b/gi, (m, n) => { vezes++; const x = NEs[n.toUpperCase()]; return vezes === 1 ? `${m} (${x ? x.curta : ''})` : (x ? x.curta : m); })
    .replace(/\b(?:de )?n[íi]vel ([ABC])\b/g, (m, n) => { const x = NEs[n]; return x ? `${/^de /.test(m) ? 'de ' : ''}solidez ${x.rotulo} (${n})` : m; });
  const marc = s => traduzir(esc(s)).replace(/\[((?:T|O|L|P|A|D|LV|F)\d+)\]/g, '<sup class="ev">$1</sup>');
  return { secoes, marc, traduzir };
}

/** O parecer em HTML de impressão. `css` é o CSS da nota (CSS_IMPRESSAO_PLENARIO) — injetado, não importado. */
function htmlParecer(p, { materia = '', logoDataUrl = null, css = '' } = {}) {
  const esc = escapeHtmlParecer;
  const bm = ch => 'l_' + String(ch).replace(/[^\w]/g, '_');
  const { secoes, marc, traduzir } = blocosDoParecer(p, esc);
  const { tabelasDoDossie, CSS_TABELAS_DOSSIE: CSS_TAB, fichaParaHtml, CSS_FICHA } = _refsHtml();
  const tabelas = p.dossie ? tabelasDoDossie(p.dossie, esc) : { corpo: '', anexo: '' };
  const onde = secoes.find(s => /^O que aconteceu/i.test(s.chave)) || secoes.find(s => /^O que se previu/i.test(s.chave)) || null;
  const lista = (cls, titulo, linhas) => linhas && linhas.length ? `<div class="${cls}"><b>${esc(titulo)}</b><ul>${linhas.map(l => `<li>${traduzir(esc(l))}</li>`).join('')}</ul></div>` : '';

  // O "nível de evidência" explicado UMA vez, em palavras, onde o leitor começa.
  const NE = (typeof NIVEL_EVIDENCIA !== 'undefined' ? NIVEL_EVIDENCIA : (__mh ? __mh.D.NIVEL_EVIDENCIA : {}))[p.nivel] || {};
  const explicaNivel = `Solidez da comparação antes × depois: <b>${esc(NE.rotulo || p.nivel)}</b> — ${esc(NE.explicacao || '')}. No texto, isso aparece como "nível de evidência ${esc(p.nivel)}".`;
  const produto = p.gates?.faixas?.length ? 'Parecer jurídico-processual: a avaliação da política não é verificável com o que se obteve.' : p.temSerie ? `Parecer completo, com o que se previu e o que aconteceu. ${explicaNivel}` : `Parecer sem série oficial: a avaliação fica limitada ao que o processo traz. ${explicaNivel}`;
  const indice = `<section class="indice"><h2>Índice</h2><ul>
      <li><a href="#${bm('ficha')}">Ficha do objeto<span class="ld"></span></a></li>
      ${secoes.filter(s => s.chave !== 'abertura').map(s => `<li><a href="#${bm(s.chave)}">${esc(s.rotulo)}<span class="ld"></span></a></li>`).join('')}
      <li><a href="#${bm('conferencia')}">Conferência e ressalvas<span class="ld"></span></a></li>
      ${p.dossie ? `<li><a href="#${bm('dossie')}">Anexo — Dossiê de dados<span class="ld"></span></a></li>` : ''}</ul></section>`;

  const corpo = secoes.map(s => `<div class="bloco" id="${bm(s.chave)}">
      ${s.chave === 'abertura' ? '' : `<h3 class="item-h">${esc(s.rotulo)}</h3>`}
      ${s.paras.map(x => `<p>${marc(x)}</p>`).join('\n')}
      ${s === onde ? tabelas.corpo : ''}
    </div>`).join('');

  const rub = p.rubrica || { itens: [], aprovado: false, resumo: '' };
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Parecer — ${esc(materia)}</title>
  <style>
${css}
    .conf-ok   { background:#f2f8f2; border-left:3px solid #2f7a3a; padding:8px 11px; margin:8px 0; font-size:10.5pt; }
    .conf-pend { background:#fffaf0; border-left:3px solid #d68a00; padding:8px 11px; margin:8px 0; font-size:10.5pt; }
    .conf-erro { background:#fdf3f3; border-left:3px solid #b03030; padding:8px 11px; margin:8px 0; font-size:10.5pt; }
    .faixa     { background:#b03030; color:#fff; padding:8px 12px; margin:10px 0; font-weight:600; font-size:10.5pt; }
    .produto   { font-size:10pt; color:#333; margin:6px 0 2px; }
    .carimbo   { margin-top:14px; font-size:9pt; color:#666; font-style:italic; }
    sup.ev     { font-size:7pt; color:#666; margin-left:1px; }
${CSS_FICHA || ''}
${CSS_TAB || ''}
  </style></head><body>
    <div class="cab">
      <div class="sp"></div>
      <div class="tit"><h1>Parecer de Especialista</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
    </div>
    <div class="rule"></div>
    <div class="meta">${esc(materia)} · texto analisado: ${esc(p.textoAnalisado)} · ${(p.lentes || []).length} lente(s)${p.situacao ? ` · situação: ${esc(p.situacao)}` : ''}</div>
    <div class="produto">${produto}</div>
    ${(p.gates?.faixas || []).map(f => `<div class="faixa">${esc(f)}</div>`).join('')}
    <div class="bloco" id="${bm('ficha')}">
      <h3 class="item-h">Ficha do objeto</h3>
      ${fichaParaHtml(p.ficha, esc)}
      ${lista('conf-pend', 'Observações', p.gates?.notas || [])}
    </div>
    ${indice}
    ${corpo}
    <div class="bloco" id="${bm('conferencia')}">
      <h3 class="item-h">Conferência e ressalvas</h3>
      <div class="${rub.aprovado ? 'conf-ok' : 'conf-erro'}"><b>${esc(rub.resumo)}</b><ul>${(rub.itens || []).map(i => `<li>${i.ok ? '✓' : '✗'} ${traduzir(esc(i.item))}${i.detalhe ? ` — ${traduzir(esc(i.detalhe))}` : ''}</li>`).join('')}</ul></div>
      ${lista('conf-ok', `Lentes aplicadas (${(p.lentes || []).length})`, (p.lentes || []).map(l => `${l.ordem}. ${l.rotulo} — acionada por ${l.motivo}`))}
      ${lista('conf-pend', 'Lentes sugeridas e NÃO aplicadas', (p.descartadas || []).map(l => `${l.rotulo}: ${l.ressalva}`))}
      <div class="conf-ok">Apuração: ${p.apuracao?.aprovados ?? 0} achado(s) com trecho localizado no documento; ${(p.apuracao?.recusados || []).length} descartado(s); ${p.apuracao?.semQuestao ?? 0} linha(s) sem questão.</div>
      <div class="conf-ok">Tese: ${esc(p.validacao?.resumo || '')}. Contraditório: ${esc(p.contraditorio?.resumo || '')}.</div>
      ${lista('conf-pend', 'Afirmações removidas na validação', (p.validacao?.removidas || []).map(r => `${r.id} (${r.motivo}): ${String(r.texto || '').slice(0, 140)}`))}
      ${lista('conf-pend', 'Refutadas no contraditório', (p.contraditorio?.refutadas || []).map(r => `${r.id} (${r.motivo}): ${String(r.texto || '').slice(0, 140)}`))}
      ${lista('conf-pend', 'Juízos contestados e rebaixados a "não verificável"', (p.contraditorio?.contestadas || []).map(r => `${r.id}: ${r.motivo}`))}
      ${lista('conf-pend', 'Rebaixamentos aplicados no texto', (p.gates?.rebaixamentos || []).map(r => `${r.gate}: ${r.detalhe}`))}
      ${p.conferencia ? `<div class="${p.conferencia.ok ? 'conf-ok' : 'conf-erro'}">Redação: ${p.conferencia.ok ? 'todos os parágrafos de juízo citam evidência existente e todos os números constam da base.' : `${p.conferencia.semEvidencia.length} parágrafo(s) sem evidência; ${p.conferencia.numerosSuspeitos.length} número(s) fora da base; ${p.conferencia.idsInexistentes.length} identificador(es) inexistente(s).`}${p.refeita ? ' A redação foi refeita uma vez após reprovação.' : ''}</div>` : ''}
      ${lista('conf-pend', 'Ressalvas de validade dos roteiros', (p.ressalvasValidade || []).map(r => `${r.lente}: ${r.texto}`))}
      ${lista('conf-pend', 'Dossiê: não obtido ou não verificado', p.dossie?.avisos || [])}
      ${p.truncado ? '<div class="conf-pend">A redação foi interrompida no limite de tokens do modelo — o final pode estar incompleto.</div>' : ''}
      ${p.carimbo ? `<div class="carimbo">${esc(p.carimbo.linha)}${p.carimbo.ressalva ? ` ${esc(p.carimbo.ressalva)}` : ''}</div>` : ''}
    </div>
    ${p.dossie ? `<div class="bloco" id="${bm('dossie')}">
      <h3 class="item-h">Anexo — Dossiê de dados</h3>
      <p style="font-size:9.5pt;color:#555">Base numérica do parecer, apurada pelo programa nas fontes oficiais antes da redação. Solidez da comparação antes × depois: ${esc(NE.rotulo || p.nivel)}.</p>
      ${tabelas.anexo || '<p style="font-size:9.5pt;color:#555">Nenhuma série obtida.</p>'}
    </div>` : ''}
    <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
  </body></html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { htmlParecer, blocosDoParecer, escapeHtmlParecer };
}
