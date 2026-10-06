'use strict';
// Orçamento · Comparador de Portarias — TELA da nota de UMA portaria (avulsa),
// a caixa "Pedir alterações" (comum às duas notas) e a configuração de IA.
//
// Fluxo: lança o ato (arquivo, texto ou DOU) → identificação e relações por
// regra → escolhe nota informativa ou técnica (e um foco, opcional) → a IA
// redige com artigo + trecho literal → o JS confere → a nota aparece com os
// quadros e gráficos escolhidos. O analista pede ajustes em texto livre ("mais
// curta", "um parágrafo sobre contrapartida", "mais gráficos"); cada pedido
// gera uma nova versão, que passa de novo pela conferência — e dá para desfazer.
// O PDF sai pela impressão do navegador, só com a nota.

// nota = { geral: null (um ato) | parte geral (vários), atos: [{ docId, nota, total, conferidos }] }
const pn = { docs: [], seq: 0, tipo: 'informativa', nota: null, versoes: [], pedidos: [], ocupado: '', config: null, aviso: '', progresso: '' };

// ---------- IA: configuração (mesmo nó `config` do chrome.storage dos demais painéis) ----------

async function ptCarregarConfigIA() {
  pn.config = await new Promise(r => {
    try { chrome.storage.local.get('config', d => r((d && d.config) || {})); } catch (_) { r({}); }
  });
  ptSeloIA();
}

function ptIAConfigurada() {
  const c = pn.config || {};
  if (!c.apiKey) return null;
  return { provedorId: c.provedor || 'gemini', apiKey: c.apiKey, modelo: c.modelo };
}

function ptSeloIA() {
  const rot = ptEl('btn-config-rotulo');
  if (!rot) return;
  const c = pn.config || {};
  const p = PROVEDORES_ORCAMENTO[c.provedor || 'gemini'];
  rot.textContent = c.apiKey ? (c.modelo || p.label) : 'IA — configurar';
  ptEl('btn-config').style.borderColor = c.apiKey ? '' : '#d68a00';
}

function ptAbrirConfig() {
  const c = pn.config || {};
  ptEl('config-provedor').value = c.provedor || 'gemini';
  ptEl('config-api-key').value = c.apiKey || '';
  ptTrocarProvedor();
  ptEl('config-status-ia').style.display = 'none';
  ptEl('modelos-status').style.display = 'none';
  ptEl('modal-configuracoes').style.display = 'flex';
}

function ptTrocarProvedor() {
  const p = PROVEDORES_ORCAMENTO[ptEl('config-provedor').value];
  ptEl('config-api-key').placeholder = p.placeholderChave;
  ptEl('config-hint-chave').textContent = p.hintChave;
  ptPopularModelos();
}

function ptPopularModelos(lista) {
  const pid = ptEl('config-provedor').value;
  const modelos = lista || PROVEDORES_ORCAMENTO[pid].modelosFallback;
  ptEl('config-modelo').innerHTML = modelos.map(m => `<option value="${ptEsc(m.id)}">${ptEsc(m.displayName)}</option>`).join('');
  const salvo = pn.config && pn.config.provedor === pid ? pn.config.modelo : null;
  if (salvo && modelos.some(m => m.id === salvo)) ptEl('config-modelo').value = salvo;
}

async function ptCarregarModelos() {
  const pid = ptEl('config-provedor').value, key = ptEl('config-api-key').value.trim(), st = ptEl('modelos-status');
  st.style.display = 'block';
  if (!key) { st.textContent = 'Informe a chave primeiro.'; return; }
  st.textContent = 'consultando o provedor…';
  try { const l = await PROVEDORES_ORCAMENTO[pid].listar(key); ptPopularModelos(l); st.textContent = `✓ ${l.length} modelo(s).`; }
  catch (e) { st.textContent = 'Erro: ' + e.message; }
}

async function ptTestarConexao() {
  const pid = ptEl('config-provedor').value, key = ptEl('config-api-key').value.trim(), st = ptEl('config-status-ia');
  st.style.display = 'block'; st.className = 'config-status teste'; st.textContent = 'Testando…';
  try {
    const r = await chamarIAOrcamento({ provedorId: pid, apiKey: key, modelo: ptEl('config-modelo').value, prompt: 'Responda apenas com a palavra OK.' });
    st.className = 'config-status ok'; st.textContent = r.text ? '✓ Conexão OK.' : '✓ Conectado, mas a resposta veio vazia.';
  } catch (e) { st.className = 'config-status erro'; st.textContent = 'Falha: ' + e.message; }
}

async function ptSalvarConfig() {
  const pid = ptEl('config-provedor').value, key = ptEl('config-api-key').value.trim();
  if (!key || !PROVEDORES_ORCAMENTO[pid].regexChave.test(key)) { ptEl('config-status-ia').style.display = 'block'; ptEl('config-status-ia').className = 'config-status erro'; ptEl('config-status-ia').textContent = 'Chave ausente ou em formato inválido.'; return; }
  // Mescla: o mesmo nó guarda configurações de outros painéis.
  pn.config = Object.assign({}, pn.config || {}, { provedor: pid, apiKey: key, modelo: ptEl('config-modelo').value });
  await new Promise(r => { try { chrome.storage.local.set({ config: pn.config }, r); } catch (_) { r(); } });
  ptEl('modal-configuracoes').style.display = 'none';
  ptSeloIA();
  pnRender();
  if (typeof pcRender === 'function') pcRender();
}

/** Uma chamada de IA que devolve JSON. Erros com mensagem clara. */
async function ptChamarIAJson(prompt) {
  const cfg = ptIAConfigurada();
  if (!cfg) { ptAbrirConfig(); throw new Error('configure o provedor de IA (botão "IA" no topo)'); }
  const r = await chamarIAOrcamento(Object.assign({}, cfg, { prompt }));
  if (r.truncated) throw new Error('a resposta da IA veio cortada (limite de tamanho) — tente pedir uma versão mais curta');
  const j = extrairJSON(r.text);
  if (!j) throw new Error('a resposta da IA não veio no formato esperado — tente de novo');
  return j;
}

// ---------- caixa "Pedir alterações" (comum às duas notas) ----------

const PT_SUGESTOES = ['Deixe mais curta', 'Deixe mais detalhada', 'Inclua mais gráficos', 'Acrescente um parágrafo sobre ', 'Linguagem mais simples', 'Destaque os prazos'];

/**
 * Desenha a caixa no elemento `el`. op: { habilitado, motivo, ocupado, pedidos[], podeDesfazer, resposta, prefixo }.
 * Os ids levam o prefixo, para as duas notas terem cada uma a sua caixa.
 */
function ptRevisaoHtml(op) {
  const p = op.prefixo;
  if (!op.habilitado) return `<div class="pt-rev desab"><h4>Pedir alterações na nota</h4><div class="on-vazio">${ptEsc(op.motivo || '')}</div></div>`;
  return `<div class="pt-rev">
    <h4>Pedir alterações na nota</h4>
    <div class="dica">Escreva o que quer mudar — um parágrafo a mais, texto mais resumido, mais gráficos, outro enfoque. A nota é refeita com o pedido e conferida de novo contra o texto do ato.</div>
    <div class="pt-sugestoes">${PT_SUGESTOES.map(s => `<button class="pt-chip pt-sug" data-sug="${ptEsc(s)}">${ptEsc(s.trim())}${s.endsWith(' ') ? '…' : ''}</button>`).join('')}</div>
    <textarea id="${p}-pedido" class="pt-campo" placeholder="Ex.: acrescente um parágrafo sobre a contrapartida dos municípios e inclua o gráfico de prazos" ${op.ocupado ? 'disabled' : ''}></textarea>
    <div style="display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap">
      <button id="${p}-pedir" class="btn btn-primary btn-sm" ${op.ocupado ? 'disabled' : ''}>${op.ocupado ? '<span class="on-spinner"></span> Refazendo…' : 'Aplicar alteração'}</button>
      <button id="${p}-desfazer" class="btn btn-outline btn-sm" ${op.podeDesfazer && !op.ocupado ? '' : 'disabled'}>↶ Desfazer última</button>
    </div>
    ${op.resposta ? `<div class="on-ok">${ptEsc(op.resposta)}</div>` : ''}
    ${op.pedidos.length ? `<div class="pt-hist"><b>Pedidos aplicados:</b><ol>${op.pedidos.map(x => `<li>${ptEsc(x)}</li>`).join('')}</ol></div>` : ''}
  </div>`;
}

/** Liga os eventos da caixa: sugestão preenche o campo; "Aplicar" chama aoPedir(texto). */
function ptLigarRevisao(el, prefixo, aoPedir, aoDesfazer) {
  el.addEventListener('click', ev => {
    const sug = ev.target.closest('.pt-sug');
    if (sug) { const c = ptEl(prefixo + '-pedido'); c.value = (c.value ? c.value.trim() + '. ' : '') + sug.dataset.sug; c.focus(); return; }
    if (ev.target.closest('#' + prefixo + '-pedir')) { const t = ptEl(prefixo + '-pedido').value.trim(); if (t.length >= 4) aoPedir(t); }
    if (ev.target.closest('#' + prefixo + '-desfazer')) aoDesfazer();
  });
}

// ---------- nota: desenho ----------

function pnValorNum(v) {
  const m = String(v || '').match(/R\$\s*([\d.]+(?:,\d+)?)/);
  return m ? +m[1].replace(/\./g, '').replace(',', '.') : null;
}

/** Botão "✕" para tirar um item da nota (só na tela). chave = "ato|lista|índice". */
function pnTirar(chave) { return chave ? `<button class="pn-tirar" data-tirar="${ptEsc(chave)}" title="Tirar este item da nota">✕</button>` : ''; }

/** Cópia da nota só com o que foi conferido (para o PDF). Devolve { nota, omitidos }. */
function pnSoConferidos(nota) {
  let omitidos = 0;
  const ok = it => { if (it && it.conferido === false) { omitidos++; return false; } return true; };
  const c = Object.assign({}, nota);
  for (const k of Object.keys(PT_NOTA_LISTAS)) c[k] = (nota[k] || []).filter(ok);
  c.secoes = (nota.secoes || []).filter(ok);
  c.objeto = nota.objeto && ok(nota.objeto) ? nota.objeto : null;
  c.vigencia = nota.vigencia && ok(nota.vigencia) ? nota.vigencia : null;
  return { nota: c, omitidos };
}

/** Recontagem depois de tirar item: { total, conferidos }. */
function pnRecontar(nota) {
  const itens = [...Object.keys(PT_NOTA_LISTAS).flatMap(k => nota[k] || []), ...(nota.secoes || []), nota.objeto, nota.vigencia].filter(it => it && 'conferido' in it);
  return { total: itens.length, conferidos: itens.filter(it => it.conferido).length };
}

function pnArts(it) {
  if (!it) return '';
  const a = (it.artigos || []).map(x => `<span class="pn-art">${ptEsc(x)}</span>`).join('');
  const aviso = it.conferido === false ? `<span class="pn-conf" title="${ptEsc(it.problemas.join('; '))}">⚠ conferir: ${ptEsc(it.problemas.join('; '))}</span>` : '';
  const trecho = it.trecho ? `<div class="pn-trecho">“${ptEsc(it.trecho)}”</div>` : '';
  return `${a}${aviso}${trecho}`;
}

/** Quadros e gráficos — só os que a nota pediu e que têm dados. */
function pnVisuais(nota, meta) {
  const v = new Set(nota.visuais || []);
  const out = [];
  if (v.has('numeros')) {
    const tiles = [['artigos no ato', meta.nArtigos], ['disposições', nota.pontos.length], ['prazos', nota.prazos.length], ['valores', nota.valores.length],
      ['afirmações conferidas', `${meta.conferidos}/${meta.total}`]];
    out.push(`<div class="pn-vis"><h5>Em números</h5><div class="pn-tiles">${tiles.filter(([, n]) => n !== 0).map(([r, n]) => `<div class="pn-tile"><b>${ptEsc(n)}</b><span>${ptEsc(r)}</span></div>`).join('')}</div></div>`);
  }
  if (v.has('relacoes') && meta.rel && (meta.rel.revoga.length || meta.rel.altera.length || meta.rel.revogadoPor)) {
    const alvo = (x, tipo) => `<div class="pn-rel-l"><span class="pn-seta ${tipo}">${tipo} →</span><span class="pn-caixa">${ptEsc(x.rotulo)}</span></div>`;
    out.push(`<div class="pn-vis"><h5>Relações com outros atos</h5><div class="pn-rel"><div class="pn-caixa este">${ptEsc(meta.identificacao || 'Este ato')}</div><div>${
      meta.rel.revoga.map(x => alvo(x, 'revoga')).join('') + meta.rel.altera.map(x => alvo(x, 'altera')).join('') +
      (meta.rel.revogadoPor ? alvo(meta.rel.revogadoPor, 'revogado por') : '')}</div></div></div>`);
  }
  if (v.has('prazos') && nota.prazos.length) {
    const ps = nota.prazos.map(p => Object.assign({ dias: ptPrazoDias(p.prazo) }, p));
    const comDias = ps.filter(p => p.dias != null).sort((a, b) => a.dias - b.dias);
    const max = Math.max(1, ...comDias.map(p => p.dias));
    // Escala logarítmica (7 dias e 2 anos cabem na mesma régua), entre 12% e 88%
    // para o rótulo não sair da caixa; um prazo só fica no meio.
    const pos = d => comDias.length === 1 ? 50 : 12 + 76 * Math.log(1 + d) / Math.log(1 + max);
    out.push(`<div class="pn-vis"><h5>Régua de prazos</h5>${comDias.length ? `<div class="pn-regua"><div class="linha"></div>${comDias.map((p, i) =>
      `<div class="marco ${i % 2 ? 'baixo' : ''}" style="left:${pos(p.dias).toFixed(1)}%"><i></i><span><b>${ptEsc(p.prazo)}</b> ${ptEsc(p.evento || '')}</span></div>`).join('')}</div>` : ''}${
      ps.filter(p => p.dias == null).map(p => `<div class="pn-mini">• <b>${ptEsc(p.prazo)}</b> — ${ptEsc(p.evento || '')}</div>`).join('')}</div>`);
  }
  if (v.has('valores')) {
    const vs = nota.valores.map(x => Object.assign({ n: pnValorNum(x.valor) }, x)).filter(x => x.n);
    if (vs.length) {
      const max = Math.max(...vs.map(x => x.n));
      out.push(`<div class="pn-vis"><h5>Valores</h5>${vs.sort((a, b) => b.n - a.n).map(x =>
        `<div class="pn-barra"><span class="r">${ptEsc(x.descricao || '')}</span><span class="b"><i style="width:${(100 * x.n / max).toFixed(1)}%"></i></span><span class="n">${ptEsc(x.valor)}</span></div>`).join('')}</div>`);
    }
  }
  if (v.has('aplicacao') && nota.aplicacao.length) {
    out.push(`<div class="pn-vis"><h5>Quem faz o quê</h5><table class="pn-tab">${nota.aplicacao.map(a =>
      `<tr><td class="q">${ptEsc(a.quem)}</td><td>${ptEsc(a.como)}</td><td class="a">${ptEsc((a.artigos || []).join('; '))}</td></tr>`).join('')}</table></div>`);
  }
  if (v.has('temas')) {
    const sec = Object.entries(PT_NOTA_LISTAS).map(([k, [r]]) => [r, nota[k].length]).filter(x => x[1]);
    const max = Math.max(1, ...sec.map(x => x[1]));
    if (sec.length) out.push(`<div class="pn-vis"><h5>Composição da nota</h5>${sec.map(([r, n]) =>
      `<div class="pn-barra"><span class="r">${ptEsc(r)}</span><span class="b"><i style="width:${(100 * n / max).toFixed(1)}%"></i></span><span class="n">${n}</span></div>`).join('')}</div>`);
  }
  return out.join('');
}

/**
 * Cabeçalho das notas, no padrão das notas do Orçamento: logo do Podemos,
 * tipo + legislatura, título, carimbo da Coordenação e o filete colorido.
 */
function ptCabecalhoNota({ tipo, titulo, sub }) {
  const logo = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('icons/podemos-logo.png') : 'icons/podemos-logo.png';
  const agora = new Date();
  const dd = n => String(n).padStart(2, '0');
  const carimbo = `${dd(agora.getDate())}/${dd(agora.getMonth() + 1)}/${agora.getFullYear()} ${dd(agora.getHours())}:${dd(agora.getMinutes())}`;
  // Posse em 1º/fev (2023: 57ª, 2027: 58ª…): em janeiro ainda vale a anterior.
  const legislatura = Math.floor(((agora.getMonth() >= 1 ? agora.getFullYear() : agora.getFullYear() - 1) - 1795) / 4);
  return `<div class="pn-cab">
      <img src="${ptEsc(logo)}" alt="Podemos">
      <div class="pn-cab-tit"><div class="pn-tipo">${ptEsc(tipo)} · ${legislatura}ª Legislatura</div>
        <div class="pn-tit">${ptEsc(titulo)}</div>${sub ? `<div class="pn-sub">${ptEsc(sub)}</div>` : ''}</div>
      <div class="pn-cab-meta">Coordenação de Orçamento<br>Liderança do Podemos<br>Gerada em ${carimbo}</div>
    </div><div class="pn-filete"></div>`;
}

/** Seções da nota de UM ato (resumo, objeto, listas, extras, vigência). sec(titulo, corpo) acumula. */
function pnSecoesAto(nota, sec, op = {}) {
  const curta = nota.extensao === 'curta';
  const ch = (k, i) => op.pdf || op.ato == null ? '' : pnTirar(`${op.ato}|${k}|${i}`);
  if (nota.resumo) sec('Resumo', `<p>${ptEsc(nota.resumo)}</p>`);
  if (nota.objeto && nota.objeto.texto) sec('Objeto', `<p>${ptEsc(nota.objeto.texto)}${ch('objeto', -1)}</p>${pnArts(nota.objeto)}`);
  for (const [k, [rot, campos]] of Object.entries(PT_NOTA_LISTAS)) {
    const itens = curta ? nota[k].slice(0, 5) : nota[k];
    if (!itens.length) continue;
    sec(rot, `<ul>${itens.map((it, j) => `<li>${campos.map((c, i) => it[c] ? (i === 0 && campos.length > 1 ? `<b>${ptEsc(it[c])}:</b> ` : ptEsc(it[c])) : '').join('')}${ch(k, j)}<div class="pn-fonte">${pnArts(it)}</div></li>`).join('')}</ul>`);
  }
  (nota.secoes || []).forEach((x, j) => sec(x.titulo || 'Complemento', `<p>${ptEsc(x.texto || '')}${ch('secoes', j)}</p><div class="pn-fonte">${pnArts(x)}</div>`));
  if (nota.vigencia && nota.vigencia.texto) sec('Vigência', `<p>${ptEsc(nota.vigencia.texto)}${ch('vigencia', -1)}</p><div class="pn-fonte">${pnArts(nota.vigencia)}</div>`);
}

function pnNotaHtml(nota, meta, op = {}) {
  let omitidos = 0;
  // PDF: só o que foi conferido no texto; o ⚠ fica na tela, para o analista decidir.
  if (op.pdf) { const f = pnSoConferidos(nota); nota = f.nota; omitidos = f.omitidos; meta = Object.assign({}, meta, { total: meta.conferidos }); }
  const secoes = [];
  let n = 0;
  const sec = (t, corpo) => secoes.push(`<section><h4>${++n}. ${ptEsc(t)}</h4>${corpo}</section>`);
  pnSecoesAto(nota, sec, { pdf: op.pdf, ato: 0 });
  if (nota.recomendacoes.length) sec('Recomendações da assessoria', `<ul>${nota.recomendacoes.map(r => `<li>${ptEsc(r)}</li>`).join('')}</ul>`);
  const tipo = (PT_NOTA_TIPOS[meta.tipo] || PT_NOTA_TIPOS.informativa).rotulo;
  return `<div id="pn-doc" class="pn-doc">
    ${ptCabecalhoNota({ tipo, titulo: meta.identificacao || 'Ato normativo', sub: [meta.orgao, nota.assunto].filter(Boolean).join(' · ') })}
    ${pnVisuais(nota, meta)}
    ${secoes.join('')}
    <div class="pn-rodape">Liderança do Podemos · ${ptEsc(tipo)} redigida com apoio de IA a partir do texto do ato.
      ${pnRodapeConferencia(meta.conferidos, meta.total, omitidos, op)}
      ${meta.cortado ? 'Atenção: o ato é longo e só a parte inicial foi lida pela IA.' : ''}</div>
  </div>`;
}

function pnRodapeConferencia(conferidos, total, omitidos, op) {
  if (op.pdf) return `Todas as ${conferidos} afirmações desta nota foram conferidas literalmente no texto${omitidos ? `; ${omitidos} item(ns) cujo trecho não foi localizado ficaram fora deste PDF` : ''}.`;
  return `${conferidos} de ${total} afirmações conferidas literalmente no texto${total - conferidos ? ' — as marcadas com ⚠ aparecem só na tela e ficam fora do PDF' : ''}.`;
}

function pnCurto(d) { return typeof pcCurto === 'function' ? pcCurto(d) : (d.identificacao || 'ato'); }

/** Nota de VÁRIOS atos: parte geral, quadros do conjunto e uma seção por ato. */
function pnNotaConjuntaHtml(nota, docs, tipoId, op = {}) {
  let omitidos = 0;
  if (op.pdf) {
    nota = Object.assign({}, nota, { atos: nota.atos.map(a => { const f = pnSoConferidos(a.nota); omitidos += f.omitidos; return Object.assign({}, a, { nota: f.nota, total: a.conferidos }); }) });
  }
  const g = nota.geral;
  const tipo = (PT_NOTA_TIPOS[tipoId] || PT_NOTA_TIPOS.informativa).rotulo;
  const total = nota.atos.reduce((s, a) => s + a.total, 0), conferidos = nota.atos.reduce((s, a) => s + a.conferidos, 0);
  const rot = i => pnCurto(docs[i - 1] || {});
  const refs = l => (l || []).length ? ` <span class="pn-art">${l.map(i => ptEsc(rot(i))).join(' · ')}</span>` : '';
  // quadros do conjunto: as listas de todos os atos, com o ato no rótulo
  const junta = k => nota.atos.flatMap((a, i) => a.nota[k].map(x => Object.assign({}, x, k === 'prazos' ? { evento: `${x.evento || ''} (${rot(i + 1)})` }
    : k === 'valores' ? { descricao: `${x.descricao || ''} (${rot(i + 1)})` } : k === 'aplicacao' ? { como: `${x.como || ''} (${rot(i + 1)})` } : {})));
  const mesclada = { visuais: g.visuais.filter(v => v !== 'relacoes' && v !== 'temas'), pontos: junta('pontos'), prazos: junta('prazos'), valores: junta('valores'), aplicacao: junta('aplicacao') };
  const nArt = docs.reduce((s, d) => s + d.nArtigos, 0);
  let vis = pnVisuais(mesclada, { nArtigos: nArt, total, conferidos }).replace('<h5>Em números</h5>', `<h5>Em números · ${docs.length} atos</h5>`).replace('artigos no ato', 'artigos nos atos');
  if (g.visuais.includes('relacoes')) {
    const linhas = docs.map(d => {
      const r = [...d.rel.revoga.map(x => `<span class="pn-seta revoga">revoga</span> ${ptEsc(x.rotulo)}`), ...d.rel.altera.map(x => `<span class="pn-seta altera">altera</span> ${ptEsc(x.rotulo)}`)];
      return `<tr><td class="q">${ptEsc(pnCurto(d))}</td><td>${r.join('<br>') || '<span class="on-vazio">sem relação com outros atos</span>'}</td></tr>`;
    }).join('');
    vis = `<div class="pn-vis"><h5>Relações de cada ato</h5><table class="pn-tab">${linhas}</table></div>` + vis;
  }
  if (g.visuais.includes('temas')) {
    const max = Math.max(1, ...nota.atos.map(a => a.total));
    vis += `<div class="pn-vis"><h5>Conteúdo por ato (itens da nota)</h5>${nota.atos.map((a, i) =>
      `<div class="pn-barra"><span class="r">${ptEsc(rot(i + 1))}</span><span class="b"><i style="width:${(100 * a.total / max).toFixed(1)}%"></i></span><span class="n">${a.total}</span></div>`).join('')}</div>`;
  }
  const secoes = [];
  let n = 0;
  const sec = (t, corpo) => secoes.push(`<section><h4>${++n}. ${ptEsc(t)}</h4>${corpo}</section>`);
  if (g.resumo) sec('Resumo do conjunto', `<p>${ptEsc(g.resumo)}</p>`);
  if (g.conexoes.length) sec('Como os atos se relacionam', `<ul>${g.conexoes.map(c => `<li>${ptEsc(c.texto)}${refs(c.atos)}</li>`).join('')}</ul>`);
  for (const x of g.secoes) sec(x.titulo || 'Complemento', `<p>${ptEsc(x.texto)}</p>`);
  nota.atos.forEach((a, i) => {
    const d = docs[i];
    const sub = [];
    let m = 0;
    pnSecoesAto(Object.assign({}, a.nota, { extensao: g.extensao === 'curta' ? 'curta' : a.nota.extensao }), (t, corpo) => sub.push(`<div class="pn-sub-sec"><h5>${n + 1}.${++m} ${ptEsc(t)}</h5>${corpo}</div>`), { pdf: op.pdf, ato: i });
    secoes.push(`<section class="pn-ato"><h4>${++n}. ${ptEsc(d.identificacao || 'Ato ' + (i + 1))}</h4>
      <div class="pn-sub">${[d.orgao, a.nota.assunto].filter(Boolean).map(ptEsc).join(' · ')}</div>${sub.join('')}</section>`);
  });
  if (g.impactos.length) sec('Impactos', `<ul>${g.impactos.map(x => `<li><b>${ptEsc(x.para)}:</b> ${ptEsc(x.descricao)}${refs(x.atos)}</li>`).join('')}</ul>`);
  if (g.atencao.length) sec('Pontos de atenção', `<ul>${g.atencao.map(x => `<li>${ptEsc(x.descricao)}${refs(x.atos)}</li>`).join('')}</ul>`);
  if (g.recomendacoes.length) sec('Recomendações da assessoria', `<ul>${g.recomendacoes.map(r => `<li>${ptEsc(r)}</li>`).join('')}</ul>`);
  const cortados = docs.filter(d => d.texto.length > LIMITE_TEXTO_PROMPT).map(pnCurto);
  return `<div id="pn-doc" class="pn-doc">
    ${ptCabecalhoNota({ tipo, titulo: `Notas de portarias: ${docs.length} atos`, sub: g.assunto || docs.map(pnCurto).join(' · ') })}
    ${vis}
    ${secoes.join('')}
    <div class="pn-rodape">Liderança do Podemos · ${ptEsc(tipo)} redigida com apoio de IA a partir do texto dos atos: ${docs.map(d => ptEsc(pnCurto(d))).join('; ')}.
      ${pnRodapeConferencia(conferidos, total, omitidos, op)}
      A parte geral foi escrita só a partir das notas de cada ato.${cortados.length ? ` Atos longos lidos só na parte inicial: ${cortados.map(ptEsc).join('; ')}.` : ''}</div>
  </div>`;
}

// ---------- tela ----------

function pnMeta(d, a) {
  return { tipo: pn.tipo, identificacao: d.identificacao, orgao: d.orgao, rel: d.rel, nArtigos: d.nArtigos,
    total: a ? a.total : 0, conferidos: a ? a.conferidos : 0, cortado: d.texto.length > LIMITE_TEXTO_PROMPT };
}

function pnRender() {
  const lista = ptEl('pn-ato');
  if (!lista) return;
  const docs = pn.docs;
  ptEl('pn-contagem').textContent = docs.length ? `— ${docs.length} ato(s)` : '';
  lista.innerHTML = !docs.length ? '<div class="on-vazio">Nenhum ato lançado. Inclua uma ou mais portarias — relacionadas ou não.</div>' : docs.map((d, i) => `
    <div class="pt-doc" data-pn="${d.id}">
      <div class="ord">${i + 1}</div>
      <div>
        <div class="campos">
          <input class="pt-campo" data-pn-campo="identificacao" value="${ptEsc(d.identificacao)}" placeholder="Identificação do ato">
          <input class="pt-campo" data-pn-campo="orgao" value="${ptEsc(d.orgao)}" placeholder="Órgão">
          <input class="pt-campo" type="date" data-pn-campo="data" value="${ptEsc(d.data || '')}">
        </div>
        ${ptRelHtml({ revoga: d.rel.revoga.map(x => Object.assign({ presente: true }, x)), altera: d.rel.altera.map(x => Object.assign({ presente: true }, x)),
          revogadoPor: d.rel.revogadoPor ? Object.assign({ presente: true }, d.rel.revogadoPor) : null, marcadores: d.marcadores })}
        <div class="meta">${ptEsc(d.origem)} · ${d.texto.length.toLocaleString('pt-BR')} caracteres · ${d.nArtigos} artigo(s)${ptLimpezaTxt(d.limpeza)}${
          d.texto.length > LIMITE_TEXTO_PROMPT ? ' · <span style="color:#d68a00">ato longo: a IA lê só os primeiros ' + LIMITE_TEXTO_PROMPT.toLocaleString('pt-BR') + ' caracteres</span>' : ''}${
          d.texto.length < PT_MIN_TEXTO ? ' · <span style="color:#d68a00">pouco texto — PDF escaneado? cole o texto</span>' : ''}</div>
        <details><summary>ver texto</summary><pre>${ptEsc(d.texto.slice(0, 20000))}</pre></details>
      </div>
      <div class="acoes"><button class="pt-btn-mini" data-pn-acao="remover" title="Tirar da nota">✕</button></div>
    </div>`).join('');
  const semIA = !ptIAConfigurada();
  ptEl('pn-gerar').disabled = !docs.length || !!pn.ocupado;
  ptEl('pn-gerar').innerHTML = pn.ocupado === 'gerar' ? `<span class="on-spinner"></span> ${ptEsc(pn.progresso || 'Redigindo e conferindo…')}`
    : (pn.nota ? 'Gerar de novo' : docs.length > 1 ? `Gerar nota dos ${docs.length} atos` : 'Gerar nota');
  ptEl('pn-ia-aviso').innerHTML = semIA ? '<div class="on-pend">Configure o provedor de IA no botão <b>IA</b>, no topo. A chave fica no seu navegador.</div>' : '';
  ptEl('pn-status').innerHTML = pn.aviso;
  ptEl('pn-resultado').innerHTML = pn.nota ? pnHtml() : '';
  ptEl('pn-acoes').style.display = pn.nota ? 'flex' : 'none';
  const resposta = pn.nota && (pn.nota.geral ? pn.nota.geral.resposta : pn.nota.atos[0].nota.resposta);
  ptEl('pn-revisao').innerHTML = ptRevisaoHtml({ prefixo: 'pn', habilitado: !!pn.nota, motivo: 'Gere a nota primeiro; depois peça aqui as alterações.',
    ocupado: pn.ocupado === 'revisar', pedidos: pn.pedidos, podeDesfazer: pn.versoes.length > 0, resposta });
}

function pnHtml(op = {}) {
  return pn.nota.geral ? pnNotaConjuntaHtml(pn.nota, pnDocsDaNota(), pn.tipo, op)
    : pnNotaHtml(pn.nota.atos[0].nota, pnMeta(pnDocsDaNota()[0], pn.nota.atos[0]), op);
}

/** Cópia da nota para guardar versão (desfazer), sem copiar o texto dos atos. */
function pnCopiaNota(n) { return Object.assign({}, n, { geral: n.geral && JSON.parse(JSON.stringify(n.geral)), atos: JSON.parse(JSON.stringify(n.atos)) }); }

/** "✕" num item: sai da nota (a tela e o PDF), com desfazer. Não depende da IA. */
function pnTirarItem(chave) {
  const [a, lista, i] = chave.split('|');
  const ato = pn.nota && pn.nota.atos[+a];
  if (!ato) return;
  pn.versoes.push({ nota: pnCopiaNota(pn.nota), pedidos: pn.pedidos.slice() });
  const n = ato.nota;
  if (lista === 'objeto' || lista === 'vigencia') n[lista] = null;
  else if (Array.isArray(n[lista])) n[lista].splice(+i, 1);
  Object.assign(ato, pnRecontar(n));
  pn.aviso = '<div class="on-ok">Item tirado da nota. Use "Desfazer" para voltar.</div>';
  pnRender();
}

/** Os atos da nota, na ordem da nota (um ato tirado da lista depois de gerar some da nota). */
function pnDocsDaNota() { return pn.nota.atos.map(a => pn.docs.find(d => d.id === a.docId)).map((d, i) => d || pn.nota.docs[i]); }

/** A lista mudou depois da nota: ela deixa de valer. */
const PN_AVISO_MUDOU = '<div class="on-pend">A lista de atos mudou depois da nota — gere de novo.</div>';
function pnInvalidar() {
  if (pn.nota) pn.aviso = PN_AVISO_MUDOU;
  pn.nota = null; pn.versoes = []; pn.pedidos = [];
}
/** Aviso ao terminar uma inclusão: o erro, se houve; senão, o "lista mudou" (se a inclusão derrubou uma nota). */
function pnAvisoFinal(erro, derrubouNota) { return erro ? `<div class="on-falha">${ptEsc(erro)}</div>` : derrubouNota ? PN_AVISO_MUDOU : ''; }

function pnLancar(texto, origem) {
  const limpo = ptLimpar(texto);
  const cab = ptCabecalho(limpo.texto);
  const chave = ptChaveAto(cab.numero, cab.data ? cab.data.slice(0, 4) : '');
  const d = { id: ++pn.seq, texto: limpo.texto, origem, limpeza: limpo, identificacao: cab.identificacao, orgao: cab.orgao, data: cab.data, numero: cab.numero,
    rel: ptRelacoes(limpo.texto, chave), marcadores: ptMarcadores(limpo.texto), nArtigos: ptArtigosProprios(limpo.texto).size };
  pn.docs.push(d);
  pn.docs = ptOrdenar(pn.docs);
  pnInvalidar();
  return d;
}

async function pnArquivoChange() {
  const arqs = [...(ptEl('pn-arquivo').files || [])];
  if (!arqs.length) return;
  const erros = [], tinhaNota = !!pn.nota;
  for (let i = 0; i < arqs.length; i++) {
    const a = arqs[i];
    pn.aviso = `<div class="on-pend"><span class="on-spinner"></span> Lendo ${ptEsc(a.name)} (${i + 1}/${arqs.length})…</div>`; pnRender();
    try {
      const buf = await a.arrayBuffer(), nome = a.name.toLowerCase();
      const t = nome.endsWith('.docx') ? await ptLerDocx(buf) : nome.endsWith('.pdf') ? await ptLerPdf(buf) : (() => { throw new Error('use PDF ou .docx'); })();
      pnLancar(t, `${nome.endsWith('.docx') ? 'Word' : 'PDF'}: ${a.name}`);
    } catch (e) { erros.push(`${a.name}: ${e.message}`); }
  }
  pn.aviso = pnAvisoFinal(erros.length ? 'Não foi possível ler: ' + erros.join('; ') : '', tinhaNota);
  ptEl('pn-arquivo').value = '';
  pnRender();
}

async function pnLinkClick() {
  const url = ptEl('pn-link').value.trim();
  if (!ptEhLinkDou(url)) { pn.aviso = '<div class="on-falha">Informe um endereço do DOU (https://www.in.gov.br/…).</div>'; pnRender(); return; }
  const tinhaNota = !!pn.nota;
  pn.aviso = '<div class="on-pend"><span class="on-spinner"></span> Buscando no DOU…</div>'; pnRender();
  try {
    const r = await ptLerDou(url);
    const d = pnLancar(r.texto, 'DOU');
    if (r.orgao && !d.orgao) d.orgao = r.orgao;
    ptEl('pn-link').value = ''; pn.aviso = pnAvisoFinal('', tinhaNota);
  } catch (e) { pn.aviso = pnAvisoFinal('Não foi possível buscar: ' + e.message, false); }
  pnRender();
}

function pnRelacoesTexto(d) { return [...d.rel.revoga.map(x => 'revoga ' + x.rotulo), ...d.rel.altera.map(x => 'altera ' + x.rotulo)]; }

async function pnGerar() {
  if (!pn.docs.length || pn.ocupado) return;
  pn.tipo = (document.querySelector('input[name="pn-tipo"]:checked') || {}).value || 'informativa';
  const foco = ptEl('pn-foco').value.trim();
  const docs = pn.docs.slice();
  pn.ocupado = 'gerar'; pn.aviso = ''; pnRender();
  try {
    // 1. a nota de cada ato, conferida contra o texto DELE
    const atos = [], falhas = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      pn.progresso = docs.length > 1 ? `Lendo ato ${i + 1} de ${docs.length}…` : 'Redigindo e conferindo…'; pnRender();
      try {
        const j = await ptChamarIAJson(comTextoDoDocumento(ptPromptNota({ tipo: pn.tipo, foco, cab: d, relacoes: d.rel }), d.texto));
        const c = ptConferirNota(j, d.texto);
        atos.push({ docId: d.id, nota: c.nota, total: c.total, conferidos: c.conferidos });
      } catch (e) { if (docs.length === 1) throw e; falhas.push(`${pnCurto(d)}: ${e.message}`); }
    }
    if (!atos.length) throw new Error('nenhum ato pôde ser lido');
    // 2. com mais de um ato, a parte geral — só sobre o que já foi conferido
    let geral = null;
    const lidos = docs.filter(d => atos.some(a => a.docId === d.id));
    if (atos.length > 1) {
      pn.progresso = 'Redigindo a parte geral…'; pnRender();
      geral = ptNormalizarGeral(await ptChamarIAJson(ptPromptNotaConjunta({ tipo: pn.tipo, foco,
        atos: atos.map((a, i) => Object.assign({ identificacao: lidos[i].identificacao, orgao: lidos[i].orgao, relacoes: pnRelacoesTexto(lidos[i]) }, a.nota)) })), atos.length);
    }
    pn.nota = { geral, atos, docs: lidos }; pn.versoes = []; pn.pedidos = [];
    if (falhas.length) pn.aviso = `<div class="on-falha">Ficaram de fora da nota (falha da IA): ${ptEsc(falhas.join('; '))}. Gere de novo para tentar outra vez.</div>`;
  } catch (e) { pn.aviso = `<div class="on-falha">Falhou: ${ptEsc(e.message)}</div>`; console.error(e); }
  pn.ocupado = ''; pn.progresso = ''; pnRender();
}

async function pnRevisar(pedido) {
  if (!pn.nota || pn.ocupado) return;
  pn.ocupado = 'revisar'; pn.aviso = ''; pnRender();
  try {
    const docs = pnDocsDaNota();
    let nova;
    if (!pn.nota.geral) {
      const d = docs[0];
      const j = await ptChamarIAJson(comTextoDoDocumento(ptPromptRevisao({ nota: pn.nota.atos[0].nota, pedido, historico: pn.pedidos, tipo: pn.tipo, cab: d }), d.texto));
      const c = ptConferirNota(j, d.texto);
      nova = { geral: null, docs: pn.nota.docs, atos: [{ docId: d.id, nota: c.nota, total: c.total, conferidos: c.conferidos }] };
    } else {
      const textos = docs.map((d, i) => `=== ATO ${i + 1}: ${d.identificacao || ''} ===\n${d.texto}`).join('\n\n');
      const j = await ptChamarIAJson(comTextoDoDocumento(ptPromptRevisaoConjunto({ nota: pn.nota, pedido, historico: pn.pedidos, tipo: pn.tipo,
        identificacoes: docs.map(d => d.identificacao) }), textos));
      // A resposta pode trazer só os atos que mudou (com "ato": número ou identificação).
      const lista = Array.isArray(j.atos) ? j.atos : [];
      const daResposta = i => {
        if (lista.length === pn.nota.atos.length && !lista.some(x => x && x.ato != null && pnIndiceAto(x.ato, docs) !== null && pnIndiceAto(x.ato, docs) !== i)) return lista[i];
        return lista.find(x => x && pnIndiceAto(x.ato, docs) === i) || null;
      };
      let ignorados = 0;
      nova = { docs: pn.nota.docs, geral: ptNormalizarGeral(j.geral || j, docs.length),
        atos: pn.nota.atos.map((a, i) => {
          const r = daResposta(i);
          if (!r || typeof r !== 'object' || !Object.keys(r).some(k => k !== 'ato')) { if (lista.length) ignorados++; return a; }
          const c = ptConferirNota(r, docs[i].texto); return { docId: a.docId, nota: c.nota, total: c.total, conferidos: c.conferidos };
        }) };
      if (ignorados) nova.geral.resposta = `${nova.geral.resposta ? nova.geral.resposta + ' ' : ''}(Atenção: a resposta da IA não trouxe ${ignorados} nota(s) de ato num formato utilizável; essas ficaram como estavam.)`;
    }
    // A IA às vezes diz que alterou e devolve a nota igual: isso não vira versão nova.
    if (pnMesmaNota(nova, pn.nota)) {
      pn.aviso = '<div class="on-falha">A IA respondeu, mas a nota voltou igual — nada foi alterado. Para tirar um item específico, use o ✕ ao lado dele; para outras mudanças, reformule o pedido.</div>';
      pn.ocupado = ''; pnRender(); return;
    }
    pn.versoes.push({ nota: pn.nota, pedidos: pn.pedidos.slice() });
    pn.nota = nova; pn.pedidos = pn.pedidos.concat(pedido);
  } catch (e) { pn.aviso = `<div class="on-falha">A alteração falhou: ${ptEsc(e.message)}. A nota anterior foi mantida.</div>`; }
  pn.ocupado = ''; pnRender();
}

/** Índice (0…) de um ato citado na resposta: número (1, 2…) ou identificação. */
function pnIndiceAto(x, docs) {
  if (x == null) return null;
  const n = Number(x);
  if (Number.isInteger(n) && n >= 1 && n <= docs.length) return n - 1;
  const t = ptNorm(String(x));
  const i = docs.findIndex(d => d.identificacao && (ptNorm(d.identificacao) === t || ptNorm(d.identificacao).startsWith(t) || t.startsWith(ptNorm(d.identificacao))));
  return i >= 0 ? i : null;
}

/** As duas notas têm o mesmo conteúdo (ignorando a frase de resposta da IA)? */
function pnMesmaNota(a, b) {
  const limpa = n => JSON.stringify({ g: n.geral ? Object.assign({}, n.geral, { resposta: '' }) : null, a: n.atos.map(x => Object.assign({}, x.nota, { resposta: '' })) });
  return limpa(a) === limpa(b);
}

function pnDesfazer() {
  const v = pn.versoes.pop();
  if (!v) return;
  pn.nota = v.nota; pn.pedidos = v.pedidos; pn.aviso = '';
  pnRender();
}

function pnCopiar() {
  const docs = pnDocsDaNota();
  const corpo = pn.nota.atos.map((a, i) => ptNotaTexto(a.nota, { tipo: pn.tipo, identificacao: docs[i].identificacao, orgao: docs[i].orgao, relacoes: pnRelacoesTexto(docs[i]) }));
  let t = corpo[0];
  if (pn.nota.geral) {
    const g = pn.nota.geral;
    const cab = [`${(PT_NOTA_TIPOS[pn.tipo] || PT_NOTA_TIPOS.informativa).rotulo.toUpperCase()} — ${docs.length} ATOS`, g.assunto, '', g.resumo,
      ...g.conexoes.map(c => '- ' + c.texto), ...g.secoes.map(x => `\n${x.titulo.toUpperCase()}\n${x.texto}`)].filter(x => x !== undefined).join('\n');
    const fim = [g.impactos.length ? 'IMPACTOS\n' + g.impactos.map(x => `- ${x.para}: ${x.descricao}`).join('\n') : '',
      g.atencao.length ? 'PONTOS DE ATENÇÃO\n' + g.atencao.map(x => '- ' + x.descricao).join('\n') : '',
      g.recomendacoes.length ? 'RECOMENDAÇÕES\n' + g.recomendacoes.map(x => '- ' + x).join('\n') : ''].filter(Boolean).join('\n\n');
    t = [cab, ...corpo.map((c, i) => `\n===== ATO ${i + 1} =====\n` + c.split('\n').slice(1).join('\n')), fim].join('\n\n');
  }
  navigator.clipboard.writeText(t).then(() => { pn.aviso = '<div class="on-ok">Texto da nota copiado.</div>'; pnRender(); },
    () => { pn.aviso = '<div class="on-falha">Não foi possível copiar.</div>'; pnRender(); });
}

/** PDF pela impressão do navegador: só a nota, num contêiner fora do layout da tela. */
function ptImprimirHtml(html) {
  let box = ptEl('pt-impressao');
  if (!box) { box = document.createElement('div'); box.id = 'pt-impressao'; document.body.appendChild(box); }
  box.innerHTML = html.replace(/id="p[nc]-doc"/, '');
  window.print();
}
function ptImprimir(el) { if (el) ptImprimirHtml(el.outerHTML); }

/** Abas: "Comparar sequência" × "Notas de portarias". */
function ptAba(qual) {
  document.querySelectorAll('.pt-aba[data-aba]').forEach(b => b.dataset.aba === qual ? b.classList.add('ativa') : b.classList.remove('ativa'));
  ptEl('pt-aba-seq').style.display = qual === 'seq' ? 'contents' : 'none';
  ptEl('pt-aba-nota').style.display = qual === 'nota' ? 'contents' : 'none';
  document.body.dataset.ptAba = qual;
}

if (ptEl('pn-ato')) {
  document.querySelectorAll('.pt-aba[data-aba]').forEach(b => b.addEventListener('click', () => ptAba(b.dataset.aba)));
  ptEl('pn-arquivo').addEventListener('change', pnArquivoChange);
  ptEl('pn-usar-texto').addEventListener('click', () => {
    const t = ptEl('pn-texto').value.trim();
    if (t.length < 40) { pn.aviso = '<div class="on-falha">Cole o texto completo do ato.</div>'; pnRender(); return; }
    const tinhaNota = !!pn.nota;
    pnLancar(t, 'texto colado'); ptEl('pn-texto').value = ''; pn.aviso = pnAvisoFinal('', tinhaNota); pnRender();
  });
  ptEl('pn-buscar-link').addEventListener('click', pnLinkClick);
  ptEl('pn-gerar').addEventListener('click', pnGerar);
  ptEl('pn-copiar').addEventListener('click', pnCopiar);
  ptEl('pn-pdf').addEventListener('click', () => ptImprimirHtml(pnHtml({ pdf: true })));
  ptEl('pn-resultado').addEventListener('click', ev => { const b = ev.target.closest('[data-tirar]'); if (b) pnTirarItem(b.dataset.tirar); });
  ptEl('pn-ato').addEventListener('change', ev => {
    const c = ev.target.dataset && ev.target.dataset.pnCampo;
    const d = c && pn.docs.find(x => x.id === +ev.target.closest('[data-pn]').dataset.pn);
    if (!d) return;
    d[c] = ev.target.value.trim() || (c === 'data' ? null : '');
    if (c === 'data') pn.docs = ptOrdenar(pn.docs);
    pnRender();
  });
  ptEl('pn-ato').addEventListener('click', ev => {
    const b = ev.target.closest('[data-pn-acao="remover"]');
    if (!b) return;
    pn.docs = pn.docs.filter(x => x.id !== +b.closest('[data-pn]').dataset.pn);
    pnInvalidar(); pnRender();
  });
  ptLigarRevisao(ptEl('pn-revisao'), 'pn', pnRevisar, pnDesfazer);
  // Configuração de IA
  ptEl('btn-config').addEventListener('click', ptAbrirConfig);
  ptEl('config-provedor').addEventListener('change', ptTrocarProvedor);
  ptEl('btn-carregar-modelos').addEventListener('click', ptCarregarModelos);
  ptEl('btn-testar-conexao').addEventListener('click', ptTestarConexao);
  ptEl('btn-salvar-config').addEventListener('click', ptSalvarConfig);
  ptEl('btn-toggle-key').addEventListener('click', () => { const i = ptEl('config-api-key'); i.type = i.type === 'password' ? 'text' : 'password'; });
  document.querySelectorAll('[data-fecha]').forEach(b => b.addEventListener('click', () => { ptEl(b.dataset.fecha).style.display = 'none'; }));
  ptAba('seq');
  // A nota comparativa (script seguinte) também depende da chave: re-renderiza quando ela chega.
  ptCarregarConfigIA().then(() => { pnRender(); if (typeof pcRender === 'function') pcRender(); });
  pnRender();
}
