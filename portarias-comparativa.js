'use strict';
// Orçamento · Comparador de Portarias — TELA da nota comparativa (etapa 2).
// O motor (pares, prompts, conferência) está em portarias-comparacao.js; aqui
// ficam a execução passo a passo (com progresso, cancelamento e reaproveitamento
// do que já foi lido), o desenho da nota e a caixa "Pedir alterações".

const pc = { temas: null, chaveTemas: '', regras: {}, comparacoes: [], nota: null, versoes: [], pedidos: [],
  ocupado: '', cancelar: false, passos: [], aviso: '', chamadas: 0, tipo: 'informativa' };

/** A lista mudou (ato incluído, removido, par trocado): a nota deixa de valer; as leituras por ato continuam. */
function pcInvalidar() {
  if (pc.ocupado) return;
  if (pc.nota) pc.aviso = '<div class="on-pend">A sequência mudou depois da nota — gere de novo (as leituras de cada ato já feitas são reaproveitadas).</div>';
  pc.comparacoes = []; pc.nota = null; pc.versoes = []; pc.pedidos = [];
  pcRender();
}

function pcIdent(d) { return d.identificacao || `ato ${d.id}`; }
/** "PORTARIA CONJUNTA MGI/MF/CGU Nº 33, DE…" → "Portaria Conjunta MGI/MF/CGU nº 33/2023". */
function pcCurto(d) {
  const m = (d.identificacao || '').match(/^(.*?)\s*N[ºo°]\.?\s*([\d.]+)/i);
  if (!m) return pcIdent(d);
  const tipo = m[1].split(/\s+/).map(w => /\//.test(w) || /^[A-Z]{2,5}$/.test(w) && !/^(DE|DA|DO)$/.test(w) && w.length <= 4 ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  return `${tipo} nº ${m[2]}${d.data ? '/' + d.data.slice(0, 4) : ''}`;
}

function pcPasso(rotulo) { const p = { rotulo, estado: 'rodando', obs: '' }; pc.passos.push(p); pcRender(); return p; }

/** Uma chamada com uma nova tentativa; cancela entre chamadas. */
async function pcChamar(prompt) {
  if (pc.cancelar) throw new Error('cancelado');
  pc.chamadas++;
  try { return await ptChamarIAJson(prompt); }
  catch (e) {
    if (pc.cancelar || /configure/.test(e.message)) throw e;
    pc.chamadas++;
    return ptChamarIAJson(prompt);
  }
}

async function pcGerar() {
  if (pc.ocupado || pt.docs.length < 2) return;
  if (!ptIAConfigurada()) { ptAbrirConfig(); return; }
  pc.tipo = (document.querySelector('input[name="pc-tipo"]:checked') || {}).value || 'informativa';
  const docs = pt.docs.slice();
  const seq = ptSequencia(docs);
  const pares = pcPares(docs, seq);
  const partes = docs.map(d => pc.regras[d.id] && pc.regras[d.id].tam === d.texto.length && pc.chaveTemas ? 0 : pcPartes(d.texto).length).reduce((a, b) => a + b, 0);
  const estimativa = 1 + partes + pares.filter(p => p.modo !== 'inicial').length * 2 + 1;
  if (!confirm(`A nota comparativa lê todos os ${docs.length} atos por inteiro e compara cada mudança.\nSerão cerca de ${estimativa} chamadas à IA (pode levar alguns minutos). Continuar?`)) return;

  pc.ocupado = 'gerar'; pc.cancelar = false; pc.passos = []; pc.aviso = ''; pc.chamadas = 0;
  pc.comparacoes = []; pc.nota = null; pc.versoes = []; pc.pedidos = [];
  try {
    // 1. temas, a partir da estrutura de todos os atos
    const chaveTemas = docs.map(d => d.id + ':' + d.texto.length).join(',');
    if (!pc.temas || pc.chaveTemas !== chaveTemas) {
      const p = pcPasso('Temas: estrutura de todos os atos');
      const atos = docs.map(d => ({ identificacao: pcIdent(d), estrutura: pcEstrutura(d.texto), ementa: d.texto.slice(0, 400) }));
      const r = await pcChamar(pcPromptTemas(atos));
      let temas = (Array.isArray(r.temas) ? r.temas : []).filter(t => t && t.nome).map(t => ({ nome: String(t.nome).trim(), descricao: String(t.descricao || '') }));
      if (!temas.some(t => /^outros$/i.test(t.nome))) temas.push({ nome: 'Outros', descricao: 'demais assuntos' });
      if (temas.length < 3) throw new Error('a IA não devolveu a lista de temas');
      pc.temas = temas; pc.chaveTemas = chaveTemas; pc.regras = {};
      p.estado = 'ok'; p.obs = `${temas.length} temas`;
    }
    const nomes = pc.temas.map(t => t.nome);

    // 2. extração de todas as regras de cada ato
    for (const d of docs) {
      if (pc.regras[d.id] && pc.regras[d.id].tam === d.texto.length) continue;
      const par = pares.find(x => x.id === d.id);
      const partesD = pcPartes(d.texto);
      const p = pcPasso(`Leitura: ${pcCurto(d)} (${partesD.length} parte${partesD.length > 1 ? 's' : ''})`);
      const regras = [], falhas = [];
      for (let i = 0; i < partesD.length; i++) {
        p.obs = `parte ${i + 1}/${partesD.length}`; pcRender();
        try {
          const r = await pcChamar(pcPromptExtracao({ identificacao: pcIdent(d), temas: pc.temas, parte: partesD[i], i: i + 1, n: partesD.length, modo: par && par.modo }));
          regras.push(...pcConfereRegras(r.regras, d.texto, pc.temas));
        } catch (e) { if (pc.cancelar) throw e; falhas.push(i + 1); }
      }
      const conf = regras.filter(r => r.conferido);
      pc.regras[d.id] = { tam: d.texto.length, regras: conf, descartadas: regras.length - conf.length, falhas };
      p.estado = falhas.length ? 'aviso' : 'ok';
      p.obs = `${conf.length} regras conferidas${regras.length - conf.length ? `, ${regras.length - conf.length} descartadas (trecho não localizado)` : ''}${falhas.length ? ` · parte(s) ${falhas.join(', ')} não lida(s)` : ''}`;
    }

    // 3. comparação de cada par, tema a tema
    for (const par of pares) {
      if (par.modo === 'inicial') continue;
      const d = docs.find(x => x.id === par.id), b = par.baseId ? docs.find(x => x.id === par.baseId) : null;
      const rotulo = b ? `${pcCurto(d)} ${par.modo === 'alteracao' ? 'altera' : 'substitui'} ${pcCurto(b)}` : `${pcCurto(d)} — ${par.modo === 'alteracao' ? 'altera ato que não está na lista' : 'instrumento novo'}`;
      const p = pcPasso(`Comparação: ${rotulo}`);
      const regrasD = pc.regras[d.id].regras;
      const regrasB = b ? pc.regras[b.id].regras : [];
      const temasDoPar = par.modo === 'alteracao' ? nomes.filter(t => regrasD.some(r => r.tema === t)) : nomes;
      const lotes = pcLotes(temasDoPar, b ? regrasB : [], regrasD);
      const c = { parId: par.id, antesId: b ? b.id : null, depoisId: d.id, modo: par.modo, rotulo, mudancas: [], mantidas: [], falhas: 0, descartadas: 0 };
      for (let i = 0; i < lotes.length; i++) {
        p.obs = `${i + 1}/${lotes.length} grupo(s) de temas`; pcRender();
        const l = lotes[i];
        try {
          const prompt = b ? pcPromptComparar({ antes: { identificacao: pcIdent(b), regras: l.antes }, depois: { identificacao: pcIdent(d), regras: l.depois }, temas: l.temas, modo: par.modo })
            : pcPromptNovo({ ato: { identificacao: pcIdent(d) }, regras: l.depois, temas: l.temas });
          const r = pcConfereMudancas(await pcChamar(prompt), b ? b.texto : '', d.texto, pc.temas);
          c.mudancas.push(...r.mudancas.filter(m => m.conferido));
          c.descartadas += r.mudancas.filter(m => !m.conferido).length;
          c.mantidas.push(...r.mantidas);
        } catch (e) { if (pc.cancelar) throw e; c.falhas++; }
      }
      pc.comparacoes.push(c);
      const n = t => c.mudancas.filter(m => m.tipo === t).length;
      p.estado = c.falhas ? 'aviso' : 'ok';
      p.obs = `${n('nova')} nova(s), ${n('alterada')} alterada(s), ${n('suprimida')} suprimida(s), ${c.mantidas.length} mantida(s)${c.descartadas ? ` · ${c.descartadas} descartada(s) na conferência` : ''}${c.falhas ? ` · ${c.falhas} grupo(s) falharam` : ''}`;
    }

    // 4. síntese
    const p = pcPasso('Síntese da nota');
    pc.nota = pcNormalizarSintese(await pcChamar(pcPromptSintese({ atos: docs.map(d => ({ identificacao: pcIdent(d) })), pares: pc.comparacoes,
      resumoPorTema: pcResumoPorTema(), destaquesCandidatos: pcCandidatos(), tipo: pc.tipo })));
    p.estado = 'ok'; p.obs = `${pc.chamadas} chamadas à IA no total`;
  } catch (e) {
    const ult = pc.passos[pc.passos.length - 1];
    if (ult && ult.estado === 'rodando') { ult.estado = 'erro'; ult.obs = e.message; }
    pc.aviso = pc.cancelar ? '<div class="on-pend">Geração cancelada. As leituras já feitas ficam guardadas e são reaproveitadas na próxima vez.</div>'
      : `<div class="on-falha">A geração parou: ${ptEsc(e.message)}. As leituras já feitas ficam guardadas.</div>`;
    pc.nota = null;
  }
  pc.ocupado = ''; pc.cancelar = false;
  pcRender();
}

function pcResumoPorTema() {
  return pc.comparacoes.map(c => {
    const t = {};
    c.mudancas.forEach(m => { t[m.tema] = t[m.tema] || { nova: 0, alterada: 0, suprimida: 0 }; t[m.tema][m.tipo]++; });
    return `${c.rotulo}: ` + (Object.entries(t).map(([k, v]) => `${k} (${v.nova}/${v.alterada}/${v.suprimida})`).join('; ') || 'sem mudanças conferidas');
  }).join('\n');
}

function pcCandidatos(max = 70) {
  const peso = { suprimida: 0, alterada: 1, nova: 2 };
  const todas = [];
  pc.comparacoes.forEach(c => c.mudancas.forEach(m => todas.push(Object.assign({ par: c.rotulo }, m))));
  return todas.sort((a, b) => peso[a.tipo] - peso[b.tipo]).slice(0, max)
    .map(m => `[${m.par} · ${m.tema} · ${m.tipo}] ${m.aspecto}: ${m.antes ? 'antes: ' + m.antes + ' → ' : ''}${m.depois}${m.efeito ? ' (efeito: ' + m.efeito + ')' : ''}`).join('\n');
}

async function pcRevisar(pedido) {
  if (!pc.nota || pc.ocupado) return;
  pc.ocupado = 'revisar'; pc.aviso = ''; pcRender();
  try {
    const temas = [...new Set(pc.comparacoes.flatMap(c => c.mudancas.map(m => m.tema)))];
    const r = pcNormalizarSintese(await ptChamarIAJson(pcPromptRevisao({ nota: pc.nota, pedido, historico: pc.pedidos, temas, resumoPorTema: pcResumoPorTema() })));
    pc.versoes.push({ nota: pc.nota, pedidos: pc.pedidos.slice() });
    pc.nota = r; pc.pedidos = pc.pedidos.concat(pedido);
  } catch (e) { pc.aviso = `<div class="on-falha">A alteração falhou: ${ptEsc(e.message)}. A nota anterior foi mantida.</div>`; }
  pc.ocupado = ''; pcRender();
}

function pcDesfazer() {
  const v = pc.versoes.pop();
  if (!v) return;
  pc.nota = v.nota; pc.pedidos = v.pedidos; pc.aviso = '';
  pcRender();
}

// ---------- desenho ----------

const PC_COR = { nova: '#00a859', alterada: '#d68a00', suprimida: '#c0392b' };

function pcVisuais(nota) {
  const v = new Set(nota.visuais), out = [];
  const docs = pt.docs, seq = ptSequencia(docs);
  if (v.has('linha')) {
    out.push(`<div class="pn-vis"><h5>Linha do tempo</h5><div class="pc-linha">${docs.map(d => {
      const a = seq.atos.find(x => x.id === d.id) || { revoga: [], altera: [] };
      const rel = [...a.revoga.filter(x => x.presente).map(x => `<span class="pn-seta revoga">revoga ${ptEsc(x.chave)}</span>`),
        ...a.altera.map(x => `<span class="pn-seta altera">altera ${ptEsc(x.chave)}${x.presente ? '' : ' (fora)'}</span>`)].join('<br>');
      return `<div class="pc-no"><div class="ano">${ptEsc(d.data ? d.data.slice(0, 4) : '—')}</div><i></i><div class="nome">${ptEsc(pcCurto(d))}</div><div class="rel">${rel}</div></div>`;
    }).join('')}</div></div>`);
  }
  if (v.has('placar') && pc.comparacoes.length) {
    const max = Math.max(1, ...pc.comparacoes.map(c => c.mudancas.length));
    out.push(`<div class="pn-vis"><h5>Placar de mudanças</h5>${pc.comparacoes.map(c => {
      const n = t => c.mudancas.filter(m => m.tipo === t).length;
      return `<div class="pn-barra"><span class="r">${ptEsc(c.rotulo)}</span><span class="b pc-pilha">${['nova', 'alterada', 'suprimida'].map(t =>
        `<i style="width:${(100 * n(t) / max).toFixed(1)}%;background:${PC_COR[t]}" title="${PC_TIPOS[t]}: ${n(t)}"></i>`).join('')}</span><span class="n">${c.mudancas.length}${c.mantidas.length ? ` · ${c.mantidas.length} mantidas` : ''}</span></div>`;
    }).join('')}<div class="pc-legenda">${['nova', 'alterada', 'suprimida'].map(t => `<span><i style="background:${PC_COR[t]}"></i>${PC_TIPOS[t]}</span>`).join('')}</div></div>`);
  }
  if (v.has('calor') && pc.comparacoes.length) {
    const mz = pcMatriz(pc.comparacoes);
    const max = Math.max(1, ...mz.temas.flatMap(t => pc.comparacoes.map(c => mz.celula(t, c.parId).total)));
    out.push(`<div class="pn-vis"><h5>Mapa de calor: onde a regra mudou</h5><table class="pc-calor"><tr><th></th>${pc.comparacoes.map(c => `<th>${ptEsc(pcCurto(pt.docs.find(d => d.id === c.depoisId) || {}))}</th>`).join('')}</tr>${
      mz.temas.map(t => `<tr><td class="t">${ptEsc(t)}</td>${pc.comparacoes.map(c => { const x = mz.celula(t, c.parId);
        return `<td style="background:rgba(214,138,0,${x.total ? (0.12 + 0.75 * x.total / max).toFixed(2) : 0})" title="${x.nova} nova(s), ${x.alterada} alterada(s), ${x.suprimida} suprimida(s)">${x.total || ''}</td>`; }).join('')}</tr>`).join('')}</table></div>`);
  }
  if (v.has('consolidacao')) {
    const linhas = seq.atos.map(a => [pcCurto(docs.find(d => d.id === a.id)), a.marcadores.reduce((s, m) => s + m.total, 0)]).filter(x => x[1]);
    const max = Math.max(1, ...linhas.map(x => x[1]));
    if (linhas.length) out.push(`<div class="pn-vis"><h5>Dispositivos mudados depois da publicação (versões consolidadas)</h5>${linhas.map(([r, n]) =>
      `<div class="pn-barra"><span class="r">${ptEsc(r)}</span><span class="b"><i style="width:${(100 * n / max).toFixed(1)}%"></i></span><span class="n">${n}</span></div>`).join('')}</div>`);
  }
  if (v.has('tamanho')) {
    const linhas = docs.map(d => [pcCurto(d), ptArtigosProprios(d.texto).size]);
    const max = Math.max(1, ...linhas.map(x => x[1]));
    out.push(`<div class="pn-vis"><h5>Tamanho dos atos (artigos)</h5>${linhas.map(([r, n]) =>
      `<div class="pn-barra"><span class="r">${ptEsc(r)}</span><span class="b"><i style="width:${(100 * n / max).toFixed(1)}%"></i></span><span class="n">${n}</span></div>`).join('')}</div>`);
  }
  return out.join('');
}

function pcQuadro(nota) {
  const ocultos = new Set(nota.temasOcultos || []);
  const curta = nota.extensao === 'curta', detalhada = nota.extensao === 'detalhada';
  const arts = l => l.length ? `<span class="pn-art">${ptEsc(l.join('; '))}</span>` : '';
  return pc.comparacoes.map(c => {
    const porTema = {};
    c.mudancas.filter(m => !ocultos.has(m.tema)).forEach(m => (porTema[m.tema] = porTema[m.tema] || []).push(m));
    const temas = Object.keys(porTema);
    const avisoBase = c.modo === 'alteracao' ? '<div class="pn-mini">Ato alterador: "como era" vem do ato alterado; em versão consolidada, a redação anterior pode não constar do conjunto.</div>' : '';
    return `<section><h4>${ptEsc(c.rotulo)}</h4>${avisoBase}${!temas.length ? '<p class="pn-mini">Nenhuma mudança conferida nesta comparação.</p>' : temas.map(t => {
      const xs = curta ? porTema[t].filter(m => m.tipo !== 'nova').slice(0, 3).concat(porTema[t].filter(m => m.tipo === 'nova').slice(0, 1)) : porTema[t];
      return `<div class="pc-tema"><div class="pc-tema-t">${ptEsc(t)} <span class="on-vazio">· ${porTema[t].length} mudança(s)</span></div>
        <table class="pc-quadro"><tr><th style="width:22%">Aspecto</th><th>Como era</th><th>Como ficou</th>${detalhada ? '<th style="width:20%">Efeito</th>' : ''}</tr>${xs.map(m => `<tr>
          <td><span class="pc-tipo" style="background:${PC_COR[m.tipo]}">${PC_TIPOS[m.tipo]}</span> ${ptEsc(m.aspecto)}</td>
          <td>${m.antes ? ptEsc(m.antes) + ' ' + arts(m.artigos_antes) : '<span class="on-vazio">—</span>'}${detalhada && m.trecho_antes ? `<div class="pn-trecho">“${ptEsc(m.trecho_antes)}”</div>` : ''}</td>
          <td>${m.depois ? ptEsc(m.depois) + ' ' + arts(m.artigos_depois) : '<span class="on-vazio">suprimido</span>'}${detalhada && m.trecho_depois ? `<div class="pn-trecho">“${ptEsc(m.trecho_depois)}”</div>` : ''}</td>
          ${detalhada ? `<td>${ptEsc(m.efeito)}</td>` : ''}</tr>`).join('')}</table></div>`;
    }).join('')}</section>`;
  }).join('');
}

function pcNotaHtml(nota) {
  const docs = pt.docs;
  const total = pc.comparacoes.reduce((s, c) => s + c.mudancas.length, 0);
  const descartadas = pc.comparacoes.reduce((s, c) => s + c.descartadas, 0) + Object.values(pc.regras).reduce((s, r) => s + (r.descartadas || 0), 0);
  const falhas = pc.comparacoes.reduce((s, c) => s + c.falhas, 0) + Object.values(pc.regras).reduce((s, r) => s + ((r.falhas || []).length), 0);
  const tipo = pc.tipo === 'tecnica' ? 'Nota técnica comparativa' : 'Nota informativa comparativa';
  let n = 0;
  const sec = (t, corpo) => `<section><h4>${++n}. ${ptEsc(t)}</h4>${corpo}</section>`;
  return `<div id="pc-doc" class="pn-doc">
    ${ptCabecalhoNota({ tipo, titulo: `Como eram e como ficaram os procedimentos: ${pcCurto(docs[0])} → ${pcCurto(docs[docs.length - 1])}`, sub: `${docs.length} atos · ${pc.comparacoes.length} comparações · ${total} mudanças conferidas no texto` })}
    ${pcVisuais(nota)}
    ${nota.resumo ? sec('Resumo', nota.resumo.split(/\n+/).map(p => `<p>${ptEsc(p)}</p>`).join('')) : ''}
    ${nota.destaques.length ? sec('Principais mudanças', `<ul>${nota.destaques.map(d => `<li><b>${ptEsc(d.titulo)}:</b> ${ptEsc(d.texto)}${d.tema ? ` <span class="pn-art">${ptEsc(d.tema)}</span>` : ''}</li>`).join('')}</ul>`) : ''}
    ${nota.visuais.includes('quadro') ? `<section><h4>${++n}. Como era × como ficou, tema a tema</h4></section>${pcQuadro(nota)}` : ''}
    ${nota.secoes.map(s => sec(s.titulo || 'Complemento', `<p>${ptEsc(s.texto)}</p>`)).join('')}
    ${nota.atencao.length ? sec('Pontos de atenção', `<ul>${nota.atencao.map(x => `<li>${ptEsc(x)}</li>`).join('')}</ul>`) : ''}
    ${nota.recomendacoes.length ? sec('Recomendações da assessoria', `<ul>${nota.recomendacoes.map(x => `<li>${ptEsc(x)}</li>`).join('')}</ul>`) : ''}
    <div class="pn-rodape">Liderança do Podemos · Método: os temas saem da estrutura dos próprios atos; cada ato foi lido por inteiro e cada regra e cada mudança
      só entrou com o trecho literal localizado no texto do ato (${descartadas} item(ns) descartado(s) na conferência${falhas ? `; ${falhas} parte(s) não lida(s) por falha da IA` : ''}).
      Versões consolidadas trazem a redação vigente: quando a redação anterior de um dispositivo não está no conjunto, o "como era" fica em branco.</div>
  </div>`;
}

function pcRender() {
  const el = ptEl('pc-painel');
  if (!el) return;
  const n = pt.docs.length;
  ptEl('pc-gerar').disabled = n < 2 || !!pc.ocupado;
  ptEl('pc-gerar').innerHTML = pc.ocupado === 'gerar' ? '<span class="on-spinner"></span> Gerando…' : (pc.nota ? 'Gerar de novo' : 'Gerar nota comparativa');
  ptEl('pc-cancelar').style.display = pc.ocupado === 'gerar' ? '' : 'none';
  if (!pc.ocupado) ptEl('pc-cancelar').disabled = false;
  ptEl('pc-requisito').textContent = n < 2 ? 'Inclua pelo menos dois atos na sequência.' : !ptIAConfigurada() ? 'Configure o provedor de IA no botão "IA", no topo.' : '';
  const icone = { rodando: '<span class="on-spinner"></span>', ok: '✓', aviso: '⚠', erro: '✗' };
  ptEl('pc-progresso').innerHTML = pc.passos.length ? `<ol class="pc-passos">${pc.passos.map(p => `<li class="${p.estado}">${icone[p.estado]} ${ptEsc(p.rotulo)}${p.obs ? ` <span class="on-vazio">— ${ptEsc(p.obs)}</span>` : ''}</li>`).join('')}</ol>` : '';
  ptEl('pc-status').innerHTML = pc.aviso;
  ptEl('pc-resultado').innerHTML = pc.nota ? pcNotaHtml(pc.nota) : '';
  ptEl('pc-acoes').style.display = pc.nota ? 'flex' : 'none';
  ptEl('pc-revisao').innerHTML = ptRevisaoHtml({ prefixo: 'pc', habilitado: !!pc.nota, motivo: 'Gere a nota comparativa; depois peça aqui as alterações.',
    ocupado: pc.ocupado === 'revisar', pedidos: pc.pedidos, podeDesfazer: pc.versoes.length > 0, resposta: pc.nota && pc.nota.resposta });
}

function pcCopiar() {
  const t = pcNotaTexto(pc.nota, pc.comparacoes, { tipo: pc.tipo, atos: pt.docs.map(pcCurto) });
  navigator.clipboard.writeText(t).then(() => { pc.aviso = '<div class="on-ok">Texto da nota copiado.</div>'; pcRender(); },
    () => { pc.aviso = '<div class="on-falha">Não foi possível copiar.</div>'; pcRender(); });
}

if (ptEl('pc-painel')) {
  ptEl('pc-gerar').addEventListener('click', pcGerar);
  ptEl('pc-cancelar').addEventListener('click', () => { pc.cancelar = true; ptEl('pc-cancelar').disabled = true; });
  ptEl('pc-copiar').addEventListener('click', pcCopiar);
  ptEl('pc-pdf').addEventListener('click', () => ptImprimir(ptEl('pc-doc')));
  ptLigarRevisao(ptEl('pc-revisao'), 'pc', pcRevisar, pcDesfazer);
  // a lista de atos re-renderiza: o botão de gerar acompanha
  const renderAntigo = ptRender;
  ptRender = function () { renderAntigo(); pcRender(); };
  pcRender();
}
