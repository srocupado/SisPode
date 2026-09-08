// Parecer de Especialista — o formato de impressão, compartilhado entre a
// extensão (janela de impressão com paged.js) e a prova de conceito em Node.
//
// Dois documentos, para dois leitores (decisão da Liderança, 08/09/2026):
//   · htmlParecer — o que circula: primeira página (ficha do objeto, o que
//     está em jogo, tramitação, o que muda na lei), as seções, "Limites deste
//     parecer" e a lista de fontes consultadas na internet — em palavras
//     comuns, sem identificadores de evidência, sem rótulos do método, sem
//     nada da conferência;
//   · htmlConferencia — uso interno da assessoria que confere antes de
//     circular: rubrica, tese com identificadores e evidências, contraditório,
//     achados descartados, lentes, chamadas ao modelo e consumo. A
//     rastreabilidade fica no papel, mas em papel separado.
//
// Script clássico (global na extensão) + module.exports para os testes.

const __mh = (typeof module !== 'undefined' && typeof require === 'function') ? { D: require('./dossie.js'), F: require('./ficha-objeto.js'), T: require('./tese.js') } : null;
// `const` de script clássico não está em globalThis e a CSP proíbe eval — identificadores explícitos, resolvidos na chamada.
function _refsHtml() {
  if (__mh) return { TITULOS: __mh.T.TITULOS, tabelasDoDossie: __mh.D.tabelasDoDossie, CSS_TABELAS_DOSSIE: __mh.D.CSS_TABELAS_DOSSIE, fichaParaHtml: __mh.F.fichaParaHtml, alteracoesParaHtml: __mh.F.alteracoesParaHtml, CSS_FICHA: __mh.F.CSS_FICHA, NIVEL_EVIDENCIA: __mh.D.NIVEL_EVIDENCIA, unidadesDaTese: __mh.T.unidadesDaTese, limparMarcadores: __mh.T.limparMarcadores };
  /* eslint-disable no-undef */
  return { TITULOS, tabelasDoDossie, CSS_TABELAS_DOSSIE, fichaParaHtml, alteracoesParaHtml, CSS_FICHA, NIVEL_EVIDENCIA, unidadesDaTese, limparMarcadores };
  /* eslint-enable no-undef */
}

function escapeHtmlParecer(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** Texto do parecer → blocos com âncora (seções fixas e lentes), sem marcadores, com o rótulo do método traduzido. */
function blocosDoParecer(p, esc) {
  const { TITULOS, NIVEL_EVIDENCIA, limparMarcadores } = _refsHtml();
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
  // Os marcadores saem por limparMarcadores (tese.js), que conhece TODOS os
  // prefixos: uma lista própria aqui deixou "[AT8]" e "[R2]" no PDF quando
  // entraram as seções de atores, implementação, redacional e viabilidade.
  const corpoLimpo = s => traduzir(esc(limparMarcadores(String(s))));
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
  arr(p, 'alteracoes'); for (const k of ['comparada', 'jurisprudencia', 'infralegal', 'posicoes', 'secoes']) arr(p, k);
  if (p.tese) { for (const k of ['atores', 'embates', 'emendas_sem_conflito', 'implementacao', 'aprimoramentos', 'viabilidade']) arr(p.tese, k); for (const e of p.tese.embates) { arr(e, 'lados'); arr(e, 'evidencias'); for (const l of e.lados) arr(l, 'evidencias'); } }
  if (p.processo) for (const k of ['documentos', 'emendas', 'comissoes', 'apensados']) arr(p.processo, k);
  return p;
}

/**
 * Fontes consultadas na internet (experiência comparada, jurisprudência,
 * normas infralegais, posições públicas), para o leitor conferir. O nome da
 * fonte é o link: o endereço que a busca do modelo devolve é um
 * redirecionamento opaco de 200 caracteres, ilegível impresso e sem valor
 * para quem lê — o clique continua funcionando no PDF. O programa não
 * conferiu o conteúdo: a nota diz isso.
 */
function externasHtml(p, esc) {
  const grupos = [
    ['Outros países e entes', p.comparada, c => [`${c.lugar}${c.quando ? ` (${c.quando})` : ''}`, c.medida]],
    ['Jurisprudência', p.jurisprudencia, c => [`${c.tribunal} — ${c.processo}`, `${c.norma_examinada || ''} ${c.decisao || ''}`.trim()]],
    ['Normas infralegais', p.infralegal, c => [`${c.norma}${c.orgao ? ` (${c.orgao})` : ''}`, c.o_que_disciplina]],
    ['Posições públicas', p.posicoes, c => [`${c.ator}${c.tipo ? ` (${c.tipo})` : ''}`, `${c.posicao ? `posição ${c.posicao}: ` : ''}${c.o_que_defende || ''}`]],
  ].filter(([, lista]) => (lista || []).length);
  if (!grupos.length) return '';
  let n = 0;
  const linhas = grupos.flatMap(([rot, lista, campos]) => lista.map(c => {
    const [a, b] = campos(c); n++;
    const fonte = c.fonte_url ? `<a href="${esc(c.fonte_url)}">${esc(c.fonte_nome || c.fonte_url)} ↗</a>` : esc(c.fonte_nome || '');
    return `<tr><td>${n}</td><td>${esc(rot)}</td><td><b>${esc(a)}</b><br>${esc(b)}</td><td>${fonte}</td></tr>`;
  }));
  return `<p class="tec-nota">Referências localizadas pelo modelo em busca na internet e usadas nas seções de experiência de outros países, jurisprudência, normas infralegais e posições públicas. O programa NÃO conferiu o conteúdo de cada endereço: a lista existe para o leitor verificar por conta própria. Clique no nome da fonte para abrir.</p>
    <table class="dt fontes"><thead><tr><th>#</th><th>Tema</th><th>Item e conteúdo</th><th>Fonte</th></tr></thead><tbody>${linhas.join('')}</tbody></table>`;
}

/** CSS comum aos dois documentos (parecer e conferência). */
const CSS_PARECER_EXTRA = `
    .conf-ok   { background:#f2f8f2; border-left:3px solid #2f7a3a; padding:6px 10px; margin:6px 0; font-size:9pt; }
    .conf-pend { background:#fffaf0; border-left:3px solid #d68a00; padding:6px 10px; margin:6px 0; font-size:9pt; }
    .conf-erro { background:#fdf3f3; border-left:3px solid #b03030; padding:6px 10px; margin:6px 0; font-size:9pt; }
    .faixa     { background:#b03030; color:#fff; padding:8px 12px; margin:10px 0; font-weight:600; font-size:10.5pt; }
    .produto   { font-size:10pt; color:#333; margin:6px 0 2px; }
    .limites   { margin:4px 0 6px 18px; padding:0; font-size:10.5pt; } .limites li { margin:3px 0; line-height:1.4; }
    .tecnico   { font-size:9pt; } .tecnico ul { margin:2px 0 4px 16px; } .tecnico li { font-size:8.8pt; margin:1px 0; }
    .tec-nota  { font-size:9pt; color:#555; }
    .tram-lista { margin:0 0 0 16px; padding:0; } .tram-lista li { margin:1px 0; }
    .posicao   { border:1.5px solid #1a4f7a; background:#f4f8fb; padding:8px 12px; font-size:10.5pt; }
    .posicao p { margin:3px 0; } .posicao-p { font-weight:600; font-size:11.5pt; }
    .posicao-aviso { font-size:9pt; color:#555; border-top:1px dotted #9bb4c8; padding-top:4px; margin-top:6px !important; }
    .fontes td:nth-child(2) { white-space:nowrap; } .fontes td:nth-child(4) { min-width:32mm; } .fontes a { color:#1a4f7a; }
    .embates { margin:4px 0 10px; } .embates td:nth-child(4) { white-space:nowrap; } .emb-lado { margin:2px 0; }
    .consumo th { width:28mm; }`;

/**
 * Quadro "Quem disputa o quê": um embate por linha — objeto, dispositivo, os
 * lados com o que cada um quer, o que a tramitação fez com a disputa e o
 * estado. Lado sem evidência sai como "não se manifestou nas fontes": o
 * parecer não supõe a posição de ninguém.
 */
function embatesParaHtml(embates, esc, emendasSemConflito = []) {
  if (!(embates || []).length && !(emendasSemConflito || []).length) return '';
  const linhas = (embates || []).map(e => `<tr>
      <td><b>${esc(e.objeto)}</b>${e.dispositivo ? `<div class="ficha-fonte">${esc(e.dispositivo)}</div>` : ''}</td>
      <td>${(e.lados || []).map(l => `<div class="emb-lado"><b>${esc(l.quem)}</b>: ${l.ausente ? '<i>não se manifestou nas fontes</i>' : esc(l.quer)}</div>`).join('')}</td>
      <td>${[['Texto original', e.texto_original], ['Substitutivo', e.substitutivo], ['Emendas', e.emendas]].filter(([, v]) => v).map(([r, v]) => `<div><b>${r}:</b> ${esc(v)}</div>`).join('') || '—'}</td>
      <td>${esc(e.estado || 'aberto')}</td></tr>`);
  const semConflito = (emendasSemConflito || []).length ? `<p class="tec-nota">Sem disputa identificada: ${emendasSemConflito.map(x => `${esc(x.emenda)}${x.por_que ? ` (${esc(x.por_que)})` : ''}`).join('; ')}.</p>` : '';
  return `${linhas.length ? `<table class="dt embates"><thead><tr><th>O que está em disputa</th><th>Quem quer o quê</th><th>O que a tramitação fez</th><th>Estado</th></tr></thead><tbody>${linhas.join('')}</tbody></table>` : ''}${semConflito}`;
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
  const emVigor = p.emVigor !== false;
  const fraseNivel = p.nivel === 'A' ? 'Há dados oficiais com pelo menos 12 meses antes e 12 meses depois da mudança: a comparação entre antes e depois é sólida, embora não prove que a medida causou a variação.'
    : p.nivel === 'B' ? 'Há dados oficiais, mas com poucos meses depois da mudança ou com um mês incompleto: os números indicam uma direção, mas não permitem concluir.'
    : emVigor ? 'Não há dados oficiais que permitam comparar o antes e o depois da mudança: o efeito da medida não é verificável com o que existe.'
    : 'Como a proposição ainda não está em vigor, não há resultados a comparar: este parecer descreve o que o texto prevê e o que só poderá ser medido depois.';
  const produto = p.gates?.faixas?.length ? 'Parecer jurídico-processual: a avaliação da política não é verificável com o que se obteve.' : p.temSerie ? `Parecer completo, com o que se previu e o que aconteceu. ${esc(fraseNivel)}` : emVigor ? `Parecer sem dados oficiais de antes e depois: a avaliação fica limitada ao que o processo traz. ${esc(fraseNivel)}` : `Parecer sobre proposição ainda não em vigor. ${esc(fraseNivel)}`;

  // ---- "Limites deste parecer": o que o leitor precisa saber, em palavras ----
  const limites = [];
  for (const f of p.gates?.faixas || []) limites.push(f);
  limites.push(p.temSerie ? `${fraseNivel} O parecer mostra o que a série registra; não afirma que a medida causou a variação, porque outros fatores agem ao mesmo tempo.` : fraseNivel);
  const nExt = (p.comparada || []).length + (p.jurisprudencia || []).length + (p.infralegal || []).length + (p.posicoes || []).length;
  if (nExt) limites.push(`As seções que trazem experiência de outros países, jurisprudência, normas infralegais e posições públicas vêm de busca na internet feita pelo modelo: ${nExt} fonte(s), nomeadas no texto e listadas ao fim deste parecer, NÃO conferidas pelo programa. Use-as como pista, não como prova.`);
  limites.push('Este parecer não recomenda voto nem defende posição: apresenta as opções, as consequências de cada uma e o que falta saber para decidir. A decisão é da Liderança.');
  for (const a of p.dossie?.avisos || []) limites.push(a);
  const nRemov = (p.validacao?.removidas || []).length + (p.contraditorio?.refutadas || []).length;
  const nContest = (p.contraditorio?.contestadas || []).length;
  if (nRemov || nContest) limites.push(`Antes da redação, ${nRemov ? `${nRemov} afirmação(ões) do rascunho foram retiradas por não se sustentarem nas fontes` : ''}${nRemov && nContest ? ' e ' : ''}${nContest ? `${nContest} conclusão(ões) foram rebaixadas a "não verificável" após contestação` : ''}. O relatório de conferência, disponível à parte, mostra item por item.`);

  // ---- índice e corpo ------------------------------------------------------
  // "Limites" fecha o corpo, depois da conclusão: ficava entre "Opções" e as
  // seções seguintes, e o índice o listava fora de ordem.
  const fontes = externasHtml(p, esc);
  const indice = `<section class="indice"><h2>Índice</h2><ul>
      <li><a href="#${bm('ficha')}">Ficha do objeto<span class="ld"></span></a></li>
      ${p.tese?.conclusao ? `<li><a href="#${bm('posicao')}">O que está em jogo na decisão<span class="ld"></span></a></li>` : ''}
      ${p.processo ? `<li><a href="#${bm('tramitacao')}">Tramitação<span class="ld"></span></a></li>` : ''}
      ${(p.alteracoes || []).length ? `<li><a href="#${bm('alteracoes')}">O que muda na legislação<span class="ld"></span></a></li>` : ''}
      ${secoes.filter(s => s.chave !== 'abertura').map(s => `<li><a href="#${bm(s.chave)}">${esc(s.rotulo)}<span class="ld"></span></a></li>`).join('')}
      <li><a href="#${bm('limites')}">Limites deste parecer<span class="ld"></span></a></li>
      ${p.dossie ? `<li><a href="#${bm('dossie')}">Anexo — Dossiê de dados<span class="ld"></span></a></li>` : ''}
      ${fontes ? `<li><a href="#${bm('fontes')}">Fontes consultadas na internet<span class="ld"></span></a></li>` : ''}</ul></section>`;

  const blocoLimites = `<div class="bloco" id="${bm('limites')}">
      <h3 class="item-h">Limites deste parecer</h3>
      <ul class="limites">${limites.map(l => `<li>${traduzir(esc(l))}</li>`).join('')}</ul>
    </div>`;
  const { TITULOS } = _refsHtml();
  const quadroEmbates = embatesParaHtml(p.tese?.embates, esc, p.tese?.emendas_sem_conflito);
  const corpo = secoes.map(s => `<div class="bloco" id="${bm(s.chave)}">
      ${s.chave === 'abertura' ? '' : `<h3 class="item-h">${esc(s.rotulo)}</h3>`}
      ${s.chave === TITULOS.embates ? quadroEmbates : ''}
      ${s.paras.map(x => `<p>${corpoLimpo(x)}</p>`).join('\n')}
      ${s === onde ? tabelas.corpo : ''}
    </div>`).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Parecer — ${esc(materia)}</title>
  <style>
${css}
${CSS_PARECER_EXTRA}
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
    </div>
    ${p.tese?.conclusao ? `<div class="bloco" id="${bm('posicao')}">
      <h3 class="item-h">O que está em jogo na decisão</h3>
      <div class="posicao">
        <p class="posicao-p">${esc(p.tese.conclusao.ponto_de_decisao || '')}</p>
        ${p.tese.conclusao.estabelecido ? `<p><b>Estabelecido:</b> ${esc(p.tese.conclusao.estabelecido)}</p>` : ''}
        ${p.tese.conclusao.aberto ? `<p><b>Em aberto:</b> ${esc(p.tese.conclusao.aberto)}</p>` : ''}
        <p><b>Falta para decidir:</b> ${esc(p.tese.conclusao.falta_para_decidir || '—')}</p>
        ${p.tese.conclusao.contestada ? `<p><b>Ressalva da conferência:</b> ${esc(p.tese.conclusao.contestada)}</p>` : ''}
        <p class="posicao-aviso">Este parecer não recomenda voto nem defende posição: apresenta as opções, as consequências de cada uma e o que falta saber. A decisão é da Liderança.</p>
      </div>
    </div>` : ''}
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
    ${blocoLimites}
    ${p.dossie ? `<div class="bloco" id="${bm('dossie')}">
      <h3 class="item-h">Anexo — Dossiê de dados</h3>
      <p style="font-size:9.5pt;color:#555">Base numérica do parecer, apurada pelo programa nas fontes oficiais antes da redação. Solidez da comparação antes × depois: ${esc(NE.rotulo || p.nivel)}.</p>
      ${tabelas.anexo || '<p style="font-size:9.5pt;color:#555">Nenhuma série obtida.</p>'}
    </div>` : ''}
    ${fontes ? `<div class="bloco" id="${bm('fontes')}">
      <h3 class="item-h">Fontes consultadas na internet</h3>
      ${fontes}
    </div>` : ''}
    <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
  </body></html>`;
}

/** Duração em palavras: 581000 → "9 min 41 s". */
function duracaoEmPalavras(ms) {
  if (!ms || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/**
 * O relatório de conferência, documento à parte para uso interno: veredito
 * da rubrica, modelo e consumo, o que foi descartado em cada etapa e a tese
 * com identificadores e evidências. Nada disto vai ao parecer que circula.
 */
function htmlConferencia(p, { materia = '', logoDataUrl = null, css = '' } = {}) {
  p = normalizarParecer(p);
  const esc = escapeHtmlParecer;
  const { traduzir } = blocosDoParecer(p, esc);
  const { CSS_TABELAS_DOSSIE: CSS_TAB, CSS_FICHA, unidadesDaTese } = _refsHtml();
  const lista = (cls, titulo, linhas) => linhas && linhas.length ? `<div class="${cls}"><b>${esc(titulo)}</b><ul>${linhas.map(l => `<li>${traduzir(esc(l))}</li>`).join('')}</ul></div>` : '';
  const rub = p.rubrica || { itens: [], aprovado: false, resumo: '' };
  const aprovado = p.aprovado ?? (rub.aprovado && !(p.gates?.reprovacoes || []).length);
  const ch = p.chamadas || [];
  const mil = n => `${Math.round((n || 0) / 1000)} mil`;
  const entrada = ch.reduce((s, c) => s + (c.prompt || 0), 0), saida = ch.reduce((s, c) => s + (c.resposta || 0), 0);
  const quando = p.meta?.em || p.geradoEm;
  const dataBR = iso => iso ? `${String(iso).slice(0, 10).split('-').reverse().join('/')}${String(iso).length > 10 ? ` ${String(iso).slice(11, 16)}` : ''}` : '';
  const unidades = (p.tese && unidadesDaTese) ? unidadesDaTese(p.tese) : [];
  const tabelaTese = unidades.length ? `<table class="dt"><thead><tr><th>Id</th><th>Tipo · seção</th><th>Afirmação</th><th>Evidências</th></tr></thead><tbody>${unidades.map(u => `<tr><td>${esc(u.id)}</td><td>${esc(u.tipo)} · ${esc(u.secao)}</td><td>${esc(u.texto)}</td><td>${esc((u.evidencias || []).join(', '))}</td></tr>`).join('')}</tbody></table>` : '';
  const linha = (rot, val) => val ? `<tr><th>${esc(rot)}</th><td>${val}</td></tr>` : '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Conferência — ${esc(materia)}</title>
  <style>
${css}
${CSS_PARECER_EXTRA}
${CSS_FICHA || ''}
${CSS_TAB || ''}
  </style></head><body>
    <div class="cab">
      <div class="sp"></div>
      <div class="tit"><h1>Conferência do Parecer</h1><p>Liderança do Podemos na Câmara dos Deputados · uso interno</p></div>
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
    </div>
    <div class="rule"></div>
    <div class="meta">${esc(materia)} · texto analisado: ${esc(p.textoAnalisado)}${quando ? ` · gerado em ${esc(dataBR(quando))}` : ''}${p.geradoPor || p.meta?.por ? ` por ${esc(p.geradoPor || p.meta.por)}` : ''}</div>
    <div class="produto">Relatório de conferência do Parecer de Especialista. Para a assessoria que confere o documento antes de circular; não é o parecer e não se destina ao leitor final.</div>
    <div class="bloco tecnico">
      <h3 class="item-h">Resultado da conferência automática</h3>
      <div class="${aprovado ? 'conf-ok' : 'conf-erro'}" style="font-size:10.5pt"><b>${aprovado ? 'APROVADO' : 'REPROVADO'}</b>${rub.resumo ? ` — ${esc(rub.resumo)}` : ''}${(p.gates?.reprovacoes || []).length ? ` Portões reprovados: ${esc(p.gates.reprovacoes.map(r => `${r.gate} (${r.detalhe || r.motivo || ''})`).join('; '))}.` : ''}</div>
      ${(p.gates?.faixas || []).map(f => `<div class="faixa">${esc(f)}</div>`).join('')}
      <table class="ficha consumo"><tbody>
        ${linha('Modelo', p.carimbo?.linha ? esc(p.carimbo.linha.replace(/^Parecer produzido com apoio de inteligência artificial em [^.]*\. /, '')) : esc(p.meta?.modelo || ''))}
        ${linha('Ressalva', p.carimbo?.ressalva ? esc(p.carimbo.ressalva) : '')}
        ${linha('Chamadas', ch.length ? esc(`${ch.length} chamada(s)${ch.some(c => c.web) ? `, ${ch.filter(c => c.web).length} com busca na internet` : ''}: ${ch.map(c => `${c.nome} (${mil((c.prompt || 0) + (c.resposta || 0))}${c.truncada ? ', truncada' : ''})`).join(', ')}`) : '')}
        ${linha('Tokens', ch.length ? esc(`${mil(entrada + saida)} no total: ${mil(entrada)} de entrada, ${mil(saida)} de saída (raciocínio incluído)`) : '')}
        ${linha('Duração', esc(duracaoEmPalavras(p.duracaoMs)))}
      </tbody></table>
      ${lista('conf-pend', 'Observações dos portões', p.gates?.notas || [])}
      <p class="tec-nota">O texto do parecer só pode afirmar o que consta da tese abaixo; cada unidade da tese aponta para evidências (A achados no documento, D dados do dossiê, LV lei, S situação da tramitação, F ficha, W/J/N/Q fontes da internet).</p>
      <div class="${rub.aprovado ? 'conf-ok' : 'conf-erro'}"><b>Rubrica automática</b><ul>${(rub.itens || []).map(i => `<li>${i.ok ? '✓' : '✗'} ${esc(i.item)}${i.detalhe ? ` — ${esc(i.detalhe)}` : ''}</li>`).join('')}</ul></div>
      ${lista('conf-ok', `Lentes aplicadas (${(p.lentes || []).length})`, (p.lentes || []).map(l => `${l.ordem}. ${l.rotulo} — acionada por ${l.motivo}`))}
      ${lista('conf-pend', 'Lentes sugeridas e NÃO aplicadas', (p.descartadas || []).map(l => `${l.rotulo}: ${l.ressalva}`))}
      <div class="conf-ok">Apuração: ${p.apuracao?.aprovados ?? 0} achado(s) com trecho localizado no documento; ${(p.apuracao?.recusados || []).length} descartado(s); ${p.apuracao?.semQuestao ?? 0} linha(s) sem questão. Tese: ${esc(p.validacao?.resumo || '')}. Contraditório: ${esc(p.contraditorio?.resumo || '')}.${p.refeita ? ' A redação foi refeita uma vez após reprovação.' : ''}</div>
      ${lista('conf-pend', 'Achados descartados na apuração (trecho não localizado)', (p.apuracao?.recusados || []).map(r => `${r.lente} · ${r.pergunta}: ${r.motivo}${r.trecho ? ` — "${r.trecho}…"` : ''}`))}
      ${lista('conf-pend', 'Afirmações removidas na validação', (p.validacao?.removidas || []).map(r => `${r.id} (${r.motivo}): ${String(r.texto || '').slice(0, 160)}`))}
      ${lista('conf-pend', 'Refutadas no contraditório', (p.contraditorio?.refutadas || []).map(r => `${r.id} (${r.motivo}): ${String(r.texto || '').slice(0, 160)}`))}
      ${lista('conf-pend', 'Juízos contestados e rebaixados a "não verificável"', (p.contraditorio?.contestadas || []).map(r => `${r.id}: ${r.motivo}`))}
      ${lista('conf-pend', 'Ressalvas do contraditório a dados mantidos', (p.contraditorio?.ressalvas || []).map(r => `${r.id}: ${r.motivo}`))}
      ${lista('conf-pend', 'Rebaixamentos aplicados no texto', (p.gates?.rebaixamentos || []).map(r => `${r.gate}: ${r.detalhe}`))}
      ${p.conferencia ? `<div class="${p.conferencia.ok ? 'conf-ok' : 'conf-erro'}">Redação: ${p.conferencia.ok ? 'todos os parágrafos de juízo citam evidência existente e todos os números constam da base.' : `${(p.conferencia.semEvidencia || []).length} parágrafo(s) sem evidência; ${(p.conferencia.numerosSuspeitos || []).length} número(s) fora da base; ${(p.conferencia.idsInexistentes || []).length} identificador(es) inexistente(s).`}</div>` : ''}
      ${lista('conf-pend', 'Ressalvas de validade dos roteiros', (p.ressalvasValidade || []).map(r => `${r.lente}: ${r.texto}`))}
      ${p.truncado ? '<div class="conf-pend">A redação foi interrompida no limite de tokens do modelo — o final pode estar incompleto.</div>' : ''}
      <h4 class="dt-h">Tese aprovada, com evidências</h4>
      ${tabelaTese || '<p class="tec-nota">Sem tese registrada.</p>'}
    </div>
    <div class="ft">Relatório de conferência produzido pelo programa. Uso interno da Assessoria Técnica da Liderança do Podemos.</div>
  </body></html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { htmlParecer, htmlConferencia, blocosDoParecer, escapeHtmlParecer, normalizarParecer, tramitacaoParaHtml, externasHtml, embatesParaHtml, duracaoEmPalavras };
}
