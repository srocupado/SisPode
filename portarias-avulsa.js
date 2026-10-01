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

const pn = { doc: null, tipo: 'informativa', nota: null, conf: null, versoes: [], pedidos: [], ocupado: '', config: null, aviso: '' };

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
  const legislatura = 57 + Math.floor((agora.getFullYear() - 2023) / 4);
  return `<div class="pn-cab">
      <img src="${ptEsc(logo)}" alt="Podemos">
      <div class="pn-cab-tit"><div class="pn-tipo">${ptEsc(tipo)} · ${legislatura}ª Legislatura</div>
        <div class="pn-tit">${ptEsc(titulo)}</div>${sub ? `<div class="pn-sub">${ptEsc(sub)}</div>` : ''}</div>
      <div class="pn-cab-meta">Coordenação de Orçamento<br>Liderança do Podemos<br>Gerada em ${carimbo}</div>
    </div><div class="pn-filete"></div>`;
}

function pnNotaHtml(nota, meta) {
  const curta = nota.extensao === 'curta';
  const secoes = [];
  let n = 0;
  const sec = (t, corpo) => secoes.push(`<section><h4>${++n}. ${ptEsc(t)}</h4>${corpo}</section>`);
  if (nota.resumo) sec('Resumo', `<p>${ptEsc(nota.resumo)}</p>`);
  if (nota.objeto && nota.objeto.texto) sec('Objeto', `<p>${ptEsc(nota.objeto.texto)}</p>${pnArts(nota.objeto)}`);
  for (const [k, [rot, campos]] of Object.entries(PT_NOTA_LISTAS)) {
    const itens = curta ? nota[k].slice(0, 5) : nota[k];
    if (!itens.length) continue;
    sec(rot, `<ul>${itens.map(it => `<li>${campos.map((c, i) => it[c] ? (i === 0 && campos.length > 1 ? `<b>${ptEsc(it[c])}:</b> ` : ptEsc(it[c])) : '').join('')}<div class="pn-fonte">${pnArts(it)}</div></li>`).join('')}</ul>`);
  }
  for (const x of nota.secoes) sec(x.titulo || 'Complemento', `<p>${ptEsc(x.texto || '')}</p><div class="pn-fonte">${pnArts(x)}</div>`);
  if (nota.vigencia && nota.vigencia.texto) sec('Vigência', `<p>${ptEsc(nota.vigencia.texto)}</p><div class="pn-fonte">${pnArts(nota.vigencia)}</div>`);
  if (nota.recomendacoes.length) sec('Recomendações da assessoria', `<ul>${nota.recomendacoes.map(r => `<li>${ptEsc(r)}</li>`).join('')}</ul>`);
  const tipo = (PT_NOTA_TIPOS[meta.tipo] || PT_NOTA_TIPOS.informativa).rotulo;
  return `<div id="pn-doc" class="pn-doc">
    ${ptCabecalhoNota({ tipo, titulo: meta.identificacao || 'Ato normativo', sub: [meta.orgao, nota.assunto].filter(Boolean).join(' · ') })}
    ${pnVisuais(nota, meta)}
    ${secoes.join('')}
    <div class="pn-rodape">Liderança do Podemos · ${ptEsc(tipo)} redigida com apoio de IA a partir do texto do ato.
      ${meta.conferidos} de ${meta.total} afirmações conferidas literalmente no texto${meta.total - meta.conferidos ? ' — as marcadas com ⚠ precisam de conferência antes do uso' : ''}.
      ${meta.cortado ? 'Atenção: o ato é longo e só a parte inicial foi lida pela IA.' : ''}</div>
  </div>`;
}

// ---------- tela ----------

function pnMeta() {
  const d = pn.doc;
  return { tipo: pn.tipo, identificacao: d.identificacao, orgao: d.orgao, rel: d.rel, nArtigos: d.nArtigos,
    total: pn.conf ? pn.conf.total : 0, conferidos: pn.conf ? pn.conf.conferidos : 0, cortado: d.texto.length > LIMITE_TEXTO_PROMPT };
}

function pnRender() {
  const atoEl = ptEl('pn-ato');
  if (!atoEl) return;
  const d = pn.doc;
  atoEl.innerHTML = !d ? '<div class="on-vazio">Nenhum ato lançado.</div>' : `
    <div class="pt-doc" style="grid-template-columns:1fr">
      <div>
        <div class="campos">
          <input class="pt-campo" id="pn-ident" value="${ptEsc(d.identificacao)}" placeholder="Identificação do ato">
          <input class="pt-campo" id="pn-orgao" value="${ptEsc(d.orgao)}" placeholder="Órgão">
          <input class="pt-campo" type="date" id="pn-data" value="${ptEsc(d.data || '')}">
        </div>
        ${ptRelHtml({ revoga: d.rel.revoga.map(x => Object.assign({ presente: true }, x)), altera: d.rel.altera.map(x => Object.assign({ presente: true }, x)),
          revogadoPor: d.rel.revogadoPor ? Object.assign({ presente: true }, d.rel.revogadoPor) : null, marcadores: d.marcadores })}
        <div class="meta">${ptEsc(d.origem)} · ${d.texto.length.toLocaleString('pt-BR')} caracteres · ${d.nArtigos} artigo(s)${ptLimpezaTxt(d.limpeza)}${
          d.texto.length > LIMITE_TEXTO_PROMPT ? ' · <span style="color:#d68a00">ato longo: a IA lê só os primeiros ' + LIMITE_TEXTO_PROMPT.toLocaleString('pt-BR') + ' caracteres</span>' : ''}${
          d.texto.length < PT_MIN_TEXTO ? ' · <span style="color:#d68a00">pouco texto — PDF escaneado? cole o texto</span>' : ''}</div>
        <details><summary>ver texto</summary><pre>${ptEsc(d.texto.slice(0, 20000))}</pre></details>
      </div>
    </div>`;
  const semIA = !ptIAConfigurada();
  ptEl('pn-gerar').disabled = !d || !!pn.ocupado;
  ptEl('pn-gerar').innerHTML = pn.ocupado === 'gerar' ? '<span class="on-spinner"></span> Redigindo e conferindo…' : (pn.nota ? 'Gerar de novo' : 'Gerar nota');
  ptEl('pn-ia-aviso').innerHTML = semIA ? '<div class="on-pend">Configure o provedor de IA no botão <b>IA</b>, no topo. A chave fica no seu navegador.</div>' : '';
  ptEl('pn-status').innerHTML = pn.aviso;
  ptEl('pn-resultado').innerHTML = pn.nota ? pnNotaHtml(pn.nota, pnMeta()) : '';
  ptEl('pn-acoes').style.display = pn.nota ? 'flex' : 'none';
  ptEl('pn-revisao').innerHTML = ptRevisaoHtml({ prefixo: 'pn', habilitado: !!pn.nota, motivo: 'Gere a nota primeiro; depois peça aqui as alterações.',
    ocupado: pn.ocupado === 'revisar', pedidos: pn.pedidos, podeDesfazer: pn.versoes.length > 0, resposta: pn.nota && pn.nota.resposta });
}

function pnLancar(texto, origem) {
  const limpo = ptLimpar(texto);
  const cab = ptCabecalho(limpo.texto);
  const chave = ptChaveAto(cab.numero, cab.data ? cab.data.slice(0, 4) : '');
  pn.doc = { texto: limpo.texto, origem, limpeza: limpo, identificacao: cab.identificacao, orgao: cab.orgao, data: cab.data,
    rel: ptRelacoes(limpo.texto, chave), marcadores: ptMarcadores(limpo.texto), nArtigos: ptArtigosProprios(limpo.texto).size };
  pn.nota = null; pn.conf = null; pn.versoes = []; pn.pedidos = []; pn.aviso = '';
  pnRender();
}

async function pnArquivoChange() {
  const a = (ptEl('pn-arquivo').files || [])[0];
  if (!a) return;
  pn.aviso = `<div class="on-pend"><span class="on-spinner"></span> Lendo ${ptEsc(a.name)}…</div>`; pnRender();
  try {
    const buf = await a.arrayBuffer(), nome = a.name.toLowerCase();
    const t = nome.endsWith('.docx') ? await ptLerDocx(buf) : nome.endsWith('.pdf') ? await ptLerPdf(buf) : (() => { throw new Error('use PDF ou .docx'); })();
    pnLancar(t, `${nome.endsWith('.docx') ? 'Word' : 'PDF'}: ${a.name}`);
  } catch (e) { pn.aviso = `<div class="on-falha">Não foi possível ler: ${ptEsc(e.message)}</div>`; pnRender(); }
  ptEl('pn-arquivo').value = '';
}

async function pnLinkClick() {
  const url = ptEl('pn-link').value.trim();
  if (!ptEhLinkDou(url)) { pn.aviso = '<div class="on-falha">Informe um endereço do DOU (https://www.in.gov.br/…).</div>'; pnRender(); return; }
  pn.aviso = '<div class="on-pend"><span class="on-spinner"></span> Buscando no DOU…</div>'; pnRender();
  try { const r = await ptLerDou(url); pnLancar(r.texto, 'DOU'); if (r.orgao && !pn.doc.orgao) { pn.doc.orgao = r.orgao; pnRender(); } }
  catch (e) { pn.aviso = `<div class="on-falha">Não foi possível buscar: ${ptEsc(e.message)}</div>`; pnRender(); }
}

async function pnGerar() {
  if (!pn.doc || pn.ocupado) return;
  pn.tipo = (document.querySelector('input[name="pn-tipo"]:checked') || {}).value || 'informativa';
  pn.ocupado = 'gerar'; pn.aviso = ''; pnRender();
  try {
    const j = await ptChamarIAJson(comTextoDoDocumento(ptPromptNota({ tipo: pn.tipo, foco: ptEl('pn-foco').value.trim(), cab: pn.doc, relacoes: pn.doc.rel }), pn.doc.texto));
    pn.conf = ptConferirNota(j, pn.doc.texto);
    pn.nota = pn.conf.nota; pn.versoes = []; pn.pedidos = [];
  } catch (e) { pn.aviso = `<div class="on-falha">Falhou: ${ptEsc(e.message)}</div>`; console.error(e); }
  pn.ocupado = ''; pnRender();
}

async function pnRevisar(pedido) {
  if (!pn.nota || pn.ocupado) return;
  pn.ocupado = 'revisar'; pn.aviso = ''; pnRender();
  try {
    const j = await ptChamarIAJson(comTextoDoDocumento(ptPromptRevisao({ nota: pn.nota, pedido, historico: pn.pedidos, tipo: pn.tipo, cab: pn.doc }), pn.doc.texto));
    const conf = ptConferirNota(j, pn.doc.texto);
    pn.versoes.push({ nota: pn.nota, conf: pn.conf, pedidos: pn.pedidos.slice() });
    pn.conf = conf; pn.nota = conf.nota; pn.pedidos = pn.pedidos.concat(pedido);
  } catch (e) { pn.aviso = `<div class="on-falha">A alteração falhou: ${ptEsc(e.message)}. A nota anterior foi mantida.</div>`; }
  pn.ocupado = ''; pnRender();
}

function pnDesfazer() {
  const v = pn.versoes.pop();
  if (!v) return;
  pn.nota = v.nota; pn.conf = v.conf; pn.pedidos = v.pedidos; pn.aviso = '';
  pnRender();
}

function pnCopiar() {
  const t = ptNotaTexto(pn.nota, { tipo: pn.tipo, identificacao: pn.doc.identificacao, orgao: pn.doc.orgao,
    relacoes: [...pn.doc.rel.revoga.map(x => 'revoga ' + x.rotulo), ...pn.doc.rel.altera.map(x => 'altera ' + x.rotulo)] });
  navigator.clipboard.writeText(t).then(() => { pn.aviso = '<div class="on-ok">Texto da nota copiado.</div>'; pnRender(); },
    () => { pn.aviso = '<div class="on-falha">Não foi possível copiar.</div>'; pnRender(); });
}

/** PDF pela impressão do navegador: só a nota, num contêiner fora do layout da tela. */
function ptImprimir(el) {
  if (!el) return;
  let box = ptEl('pt-impressao');
  if (!box) { box = document.createElement('div'); box.id = 'pt-impressao'; document.body.appendChild(box); }
  box.innerHTML = el.outerHTML.replace(/id="p[nc]-doc"/, '');
  window.print();
}

/** Abas: "Comparar sequência" × "Nota de uma portaria". */
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
    pnLancar(t, 'texto colado'); ptEl('pn-texto').value = '';
  });
  ptEl('pn-buscar-link').addEventListener('click', pnLinkClick);
  ptEl('pn-gerar').addEventListener('click', pnGerar);
  ptEl('pn-copiar').addEventListener('click', pnCopiar);
  ptEl('pn-pdf').addEventListener('click', () => ptImprimir(ptEl('pn-doc')));
  ptEl('pn-ato').addEventListener('change', ev => {
    const c = { 'pn-ident': 'identificacao', 'pn-orgao': 'orgao', 'pn-data': 'data' }[ev.target.id];
    if (c && pn.doc) { pn.doc[c] = ev.target.value.trim(); if (pn.nota) pnRender(); }
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
