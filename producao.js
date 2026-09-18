// Aba "Produção legislativa" do módulo Relatórios.
//
// Responde "o que o deputado produziu no mandato" — e o ponto do relatório é
// NÃO responder com um número só. Medido em 18/09/2026, um deputado da bancada
// tem 828 proposições de autoria, das quais 462 são REQ (requerimento de sessão
// solene, de audiência, de andamento) e 115 são DOC. Dizer "apresentou 828
// proposições" é a estatística que não sobrevive à primeira pergunta de um
// jornalista; o que sobrevive é a separação por natureza do instrumento, com o
// destino de cada matéria de mérito.
//
// Um achado da sondagem da API está no coração desta aba: PARECER É PROPOSIÇÃO.
// PRL (Parecer do Relator), PRLP, PPP e RDF aparecem em
// /proposicoes?idDeputadoAutor= e têm por ementa "Parecer do Relator, Dep.
// Fulano, pela aprovação". Ou seja: não existe rota por relator
// (?idDeputadoRelator= devolve 400), mas a relatoria é contável por aqui.
// A ressalva, medida e registrada: o parecer NÃO liga à matéria relatada —
// uriPropPrincipal vem vazio e /relacionadas devolve nada. Dá para dizer em que
// colegiado o parecer foi dado, não em qual projeto. O relatório diz isso.
//
// Depende de aderencia.js (fetchJson, mapLimit, formatarData, cvEsc,
// cvBuscarDeputados, API_PROP) — carregado antes deste arquivo.

// ---------- a taxonomia ----------
// Os nomes vêm de /referencias/proposicoes/siglaTipo, não de suposição.
// O agrupamento é editorial e está declarado aqui para poder ser discutido:
// é ele que transforma uma lista de siglas num retrato legível.
const PRD_GRUPOS = [
  { k: 'merito', rot: 'Proposições de mérito',
    desc: 'Projetos que, aprovados, viram norma.',
    tipos: ['PL', 'PLP', 'PEC', 'PDL', 'PDC', 'PLV', 'PRC', 'PRN'] },
  { k: 'fiscal', rot: 'Fiscalização e controle',
    desc: 'Instrumentos de controle sobre o Executivo e sobre a Administração.',
    tipos: ['RIC', 'RCP', 'PFC', 'SIT', 'INC', 'INA'] },
  { k: 'relatoria', rot: 'Relatoria',
    desc: 'Pareceres dados como relator.',
    tipos: ['PRL', 'PRLP', 'PPP', 'RDF', 'EMR'] },
  { k: 'texto', rot: 'Atuação sobre o texto',
    desc: 'Emendas, substitutivos e destaques — a disputa do conteúdo.',
    tipos: ['EMC', 'EMP', 'EMA', 'ERD', 'EMS', 'SBT', 'DTQ'] },
  { k: 'andamento', rot: 'Requerimentos de andamento',
    desc: 'Urgência, retirada de pauta, audiência, sessão solene, voto de pesar.',
    tipos: ['REQ', 'RPD', 'RQS'] },
  { k: 'outros', rot: 'Documentos e processo interno',
    desc: 'Ofícios e peças de processo, sem conteúdo legislativo próprio.',
    tipos: ['DOC', 'PROC'] },
];

/** Em que grupo cai uma sigla. O que não está na taxonomia cai em "outros". */
function prdGrupoDe(sigla) {
  for (const g of PRD_GRUPOS) if (g.tipos.includes(sigla)) return g.k;
  return 'outros';
}

// Quantas matérias de mérito recebem leitura individual (situação e temas).
// É uma chamada por matéria; acima disso o relatório demoraria mais do que
// alguém espera numa tela, e o ganho seria marginal.
const PRD_TETO_DETALHE = 150;

const prd = { deputado: null, ultimo: null };

const prdEl = {
  dep:      () => document.getElementById('prdDeputado'),
  escolha:  () => document.getElementById('prdEscolha'),
  ano:      () => document.getElementById('prdAno'),
  buscar:   () => document.getElementById('prdBuscar'),
  status:   () => document.getElementById('prdStatus'),
  resultado: () => document.getElementById('prdResultado'),
};

function prdStatus(msg, tipo) {
  const el = prdEl.status();
  if (!el) return;
  if (!msg) { el.innerHTML = ''; el.className = 'status'; return; }
  if (tipo === 'loading') {
    el.className = 'status';
    el.innerHTML = '<div class="spinner"></div><div>' + msg + '</div>';
  } else {
    el.className = 'status' + (tipo === 'error' ? ' error' : '');
    el.textContent = msg;
  }
}

// ---------- coleta ----------
/**
 * TODAS as proposições de autoria do deputado, seguindo a paginação.
 *
 * O teto por página é 100 e a API não avisa que cortou: sem seguir `links.next`
 * o relatório diria "apresentou 100 proposições" para quem tem 828. É o mesmo
 * erro de leitura que a aba de consulta já trata, aqui com outra roupa.
 */
async function prdColetar(idDep, ano) {
  let url = API_PROP + '?idDeputadoAutor=' + idDep + '&ordem=DESC&ordenarPor=id&itens=100'
          + (ano ? '&ano=' + encodeURIComponent(ano) : '');
  const todas = [];
  let pag = 0;
  while (url && pag < 40) {
    const j = await fetchJson(url);
    todas.push(...(j.dados || []));
    const next = (j.links || []).find(l => l.rel === 'next');
    url = next ? next.href : null;
    pag++;
    prdStatus(`Buscando proposições… ${todas.length}`, 'loading');
  }
  return { todas, paginas: pag, truncado: !!url };
}

/**
 * Situação e temas de cada matéria de mérito. Falha de leitura NÃO derruba o
 * item: ele aparece com a situação em branco, que é honesto, em vez de sumir
 * ou de receber uma situação inventada.
 */
async function prdDetalhar(props) {
  return mapLimit(props, 5, async p => {
    let status = null, temas = [], falhou = false;
    try {
      const d = await fetchJson(API_PROP + '/' + p.id);
      status = (d.dados || {}).statusProposicao || null;
    } catch (e) { falhou = true; }
    try {
      const t = await fetchJson(API_PROP + '/' + p.id + '/temas');
      temas = (t.dados || []).map(x => x.tema).filter(Boolean);
    } catch (e) { /* tema é acessório: sem ele o item continua válido */ }
    return { ...p, status, temas, falhou };
  }, (f, t) => prdStatus(`Lendo a situação de cada matéria… ${f}/${t}`, 'loading'));
}

// ---------- render ----------
function prdRender(dados) {
  const { todas, detalhes, dep, ano, truncado, teto } = dados;
  const e = cvEsc;

  const porGrupo = {};
  for (const g of PRD_GRUPOS) porGrupo[g.k] = [];
  const porTipo = {};
  for (const p of todas) {
    porGrupo[prdGrupoDe(p.siglaTipo)].push(p);
    porTipo[p.siglaTipo] = (porTipo[p.siglaTipo] || 0) + 1;
  }

  const merito = detalhes;
  const falhas = merito.filter(m => m.falhou).length;

  // O destino das matérias de mérito, que é o que separa este relatório de um
  // release: "apresentou 53 PLs" contra "53 PLs, 2 viraram lei, 31 aguardando
  // parecer do relator".
  const destino = {};
  for (const m of merito) {
    const s = m.status || {};
    const rot = s.descricaoSituacao || 'sem situação registrada';
    destino[rot] = (destino[rot] || 0) + 1;
  }
  const destinoOrd = Object.entries(destino).sort((a, b) => b[1] - a[1]);

  const temas = {};
  for (const m of merito) for (const t of m.temas) temas[t] = (temas[t] || 0) + 1;
  const temasOrd = Object.entries(temas).sort((a, b) => b[1] - a[1]);

  // Relatoria: por colegiado, porque o parecer não liga à matéria relatada.
  const relatorias = porGrupo.relatoria;
  const porOrgao = {};
  for (const r of relatorias) {
    const sig = String(r.siglaTipo);
    porOrgao[sig] = (porOrgao[sig] || 0) + 1;
  }

  const cartao = g => {
    const lista = porGrupo[g.k];
    if (!lista.length) return '';
    const tipos = {};
    for (const p of lista) tipos[p.siglaTipo] = (tipos[p.siglaTipo] || 0) + 1;
    const detalhe = Object.entries(tipos).sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<span class="prd-chip">${e(t)} <b>${n}</b></span>`).join('');
    return `<div class="prd-grupo">
      <div class="prd-grupo-cab">
        <div class="prd-grupo-n">${lista.length}</div>
        <div>
          <div class="prd-grupo-rot">${e(g.rot)}</div>
          <div class="prd-grupo-desc">${e(g.desc)}</div>
        </div>
      </div>
      <div class="prd-chips">${detalhe}</div>
    </div>`;
  };

  const html = `
    ${truncado ? `<div class="cv-aviso">⚠ A coleta parou no limite de páginas — o total abaixo está incompleto.
       Filtre por ano para ver tudo.</div>` : ''}
    ${falhas ? `<div class="cv-aviso">⚠ ${falhas} matéria(s) de mérito não puderam ter a situação lida agora.
       Aparecem sem situação — o que está faltando é a consulta, não o dado.</div>` : ''}

    <div class="cv-cab">
      <h3>${e(dep.nome)} <span style="font-weight:400;color:var(--text-dim)">(${e(dep.partido)}-${e(dep.uf)})</span></h3>
      <div class="sub">Produção legislativa${ano ? ` — proposições de ${e(ano)}` : ' — todo o período na base'}</div>

      <div class="cv-nums" style="margin-top:12px">
        <div class="cv-num"><div class="v">${todas.length}</div><div class="l">Assinaturas</div></div>
        <div class="cv-num ade"><div class="v">${porGrupo.merito.length}</div><div class="l">Mérito</div></div>
        <div class="cv-num"><div class="v">${porGrupo.relatoria.length}</div><div class="l">Pareceres</div></div>
        <div class="cv-num"><div class="v">${porGrupo.fiscal.length}</div><div class="l">Fiscalização</div></div>
        <div class="cv-num"><div class="v">${porGrupo.texto.length}</div><div class="l">Emendas</div></div>
      </div>

      <div class="sub" style="margin-top:9px">
        "Assinaturas" é o total bruto de registros em nome do deputado na base da Câmara — inclui
        requerimento de andamento e documento de processo. É o número que não deve ser usado sozinho:
        os blocos abaixo dizem do que ele se compõe.
      </div>

      <div class="cv-acoes">
        <button class="btn-gerar" id="prdExportarPdf" style="margin-top:0">Exportar PDF</button>
        <button class="btn-gerar" id="prdExportar" style="margin-top:0;background:rgba(255,255,255,0.06);color:var(--text-dim)">Excel</button>
      </div>
    </div>

    <div class="prd-grupos">${PRD_GRUPOS.map(cartao).join('')}</div>

    ${merito.length ? `<div class="cv-cab">
      <h3>Destino das ${merito.length} matéria(s) de mérito</h3>
      <div class="sub">${teto ? `Leitura individual limitada às ${PRD_TETO_DETALHE} mais recentes. ` : ''}A situação é a que a
        Câmara registra hoje na ficha de cada uma.</div>
      <table class="prd-tab">
        ${destinoOrd.map(([rot, n]) => `<tr><td class="n">${n}</td><td>${e(rot)}</td></tr>`).join('')}
      </table>
    </div>` : ''}

    ${temasOrd.length ? `<div class="cv-cab">
      <h3>Temas</h3>
      <div class="sub">Classificação da própria Câmara. Uma matéria pode ter mais de um tema.</div>
      <div class="prd-chips" style="margin-top:8px">
        ${temasOrd.map(([t, n]) => `<span class="prd-chip">${e(t)} <b>${n}</b></span>`).join('')}
      </div>
    </div>` : ''}

    ${merito.length ? `<div class="cv-lista" style="margin-top:12px">
      ${merito.map(m => `<div class="cv-item">
        <div class="prd-sig">${e(m.siglaTipo)} ${e(m.numero)}/${e(m.ano)}</div>
        <div class="cv-corpo">
          <div class="cv-obj">${e(String(m.ementa || '').replace(/\s+/g, ' ').slice(0, 260) || '(sem ementa)')}</div>
          <div class="cv-meta">${m.status && m.status.siglaOrgao ? e(m.status.siglaOrgao) + ' · ' : ''}${
            m.status && m.status.descricaoSituacao ? e(m.status.descricaoSituacao) : '<i>situação não lida</i>'}${
            m.temas.length ? ' · ' + e(m.temas.join(', ')) : ''}</div>
          <div class="cv-links"><a href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${m.id}"
             target="_blank" rel="noopener">Ficha de tramitação ↗</a></div>
        </div>
      </div>`).join('')}
    </div>` : ''}`;

  prdEl.resultado().innerHTML = html;
  prd.ultimo = { todas, merito, porGrupo, porTipo, destinoOrd, temasOrd, dep, ano, teto, porOrgao };
  const b1 = document.getElementById('prdExportar');
  if (b1) b1.addEventListener('click', prdExportar);
  const b2 = document.getElementById('prdExportarPdf');
  if (b2) b2.addEventListener('click', prdExportarPDF);
}

// ---------- fluxo ----------
async function prdConsultar() {
  if (!prd.deputado) { prdStatus('Escolha o(a) deputado(a) primeiro.', 'error'); return; }
  const ano = (prdEl.ano().value || '').trim();
  if (ano && !/^\d{4}$/.test(ano)) { prdStatus('O ano deve ter quatro dígitos.', 'error'); return; }
  prdEl.resultado().innerHTML = '';
  prdEl.buscar().disabled = true;
  try {
    prdStatus('Buscando proposições…', 'loading');
    const { todas, truncado } = await prdColetar(prd.deputado.id, ano);
    if (!todas.length) {
      prdStatus(ano ? `Nenhuma proposição de autoria em ${ano}.` : 'Nenhuma proposição de autoria na base.', 'error');
      return;
    }
    const merito = todas.filter(p => prdGrupoDe(p.siglaTipo) === 'merito');
    const teto = merito.length > PRD_TETO_DETALHE;
    const detalhes = await prdDetalhar(merito.slice(0, PRD_TETO_DETALHE));
    prdStatus('');
    prdRender({ todas, detalhes, dep: prd.deputado, ano, truncado, teto });
  } catch (e) {
    prdStatus('Erro: ' + e.message, 'error');
    console.error(e);
  } finally {
    prdEl.buscar().disabled = false;
  }
}

// ---------- exports ----------
function prdExportar() {
  if (!prd.ultimo) return;
  const { todas, merito, dep, ano } = prd.ultimo;
  const wb = XLSX.utils.book_new();

  const resumo = [['Grupo', 'Quantidade', 'Tipos']];
  const porGrupo = {};
  for (const g of PRD_GRUPOS) porGrupo[g.k] = [];
  for (const p of todas) porGrupo[prdGrupoDe(p.siglaTipo)].push(p);
  for (const g of PRD_GRUPOS) {
    const lista = porGrupo[g.k];
    const tipos = {};
    for (const p of lista) tipos[p.siglaTipo] = (tipos[p.siglaTipo] || 0) + 1;
    resumo.push([g.rot, lista.length, Object.entries(tipos).map(([t, n]) => `${t}: ${n}`).join(', ')]);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(resumo);
  ws1['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');

  const linhas = [['Tipo', 'Número', 'Ano', 'Ementa', 'Órgão atual', 'Situação', 'Temas', 'Ficha']];
  for (const m of merito) {
    linhas.push([m.siglaTipo, m.numero, m.ano,
      String(m.ementa || '').replace(/\s+/g, ' '),
      (m.status || {}).siglaOrgao || '', (m.status || {}).descricaoSituacao || '',
      m.temas.join(', '),
      'https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=' + m.id]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(linhas);
  ws2['!cols'] = [{ wch: 7 }, { wch: 8 }, { wch: 6 }, { wch: 90 }, { wch: 12 }, { wch: 40 }, { wch: 40 }, { wch: 62 }];
  ws2['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws2, 'Mérito');

  const todasL = [['Tipo', 'Número', 'Ano', 'Grupo', 'Ementa']];
  for (const p of todas) {
    todasL.push([p.siglaTipo, p.numero, p.ano,
      (PRD_GRUPOS.find(g => g.k === prdGrupoDe(p.siglaTipo)) || {}).rot || '',
      String(p.ementa || '').replace(/\s+/g, ' ').slice(0, 400)]);
  }
  const ws3 = XLSX.utils.aoa_to_sheet(todasL);
  ws3['!cols'] = [{ wch: 7 }, { wch: 8 }, { wch: 6 }, { wch: 30 }, { wch: 90 }];
  ws3['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws3, 'Tudo');

  XLSX.writeFile(wb, `producao_${dep.nome.replace(/\s+/g, '-')}${ano ? '_' + ano : ''}.xlsx`);
}

function prdHtmlPDF(logoDataUrl) {
  const u = prd.ultimo;
  const { todas, merito, porGrupo, destinoOrd, temasOrd, dep, ano, teto } = u;
  const e = cvEsc;

  const grupo = g => {
    const lista = porGrupo[g.k];
    if (!lista.length) return '';
    const tipos = {};
    for (const p of lista) tipos[p.siglaTipo] = (tipos[p.siglaTipo] || 0) + 1;
    return `<tr>
      <td class="c"><b>${lista.length}</b></td>
      <td><b>${e(g.rot)}</b><div class="res">${e(g.desc)}</div></td>
      <td class="tipos">${Object.entries(tipos).sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${e(t)} ${n}`).join(' · ')}</td>
    </tr>`;
  };

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>${e(dep.nome)} — produção legislativa${ano ? ' ' + e(ano) : ''}</title>
<style>${CSS_PDF_VOTOS}
  .tipos { font-size: 8pt; color: #555; }
  td.c { text-align: center; }
  .prdlista td { vertical-align: top; }
</style></head><body>
  <div class="cab">
    <div class="sp"></div>
    <div class="tit"><h1>Dep. ${e(dep.nome)} (${e(dep.partido)}-${e(dep.uf)})</h1>
      <div class="sub">Produção legislativa${ano ? ` · ${e(ano)}` : ''}</div></div>
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
  </div>
  <div class="rule"></div>
  <div class="meta">Documento de conferência · dados da API de Dados Abertos da Câmara dos Deputados,
    consultados em ${new Date().toLocaleDateString('pt-BR')}</div>

  <h2>Por natureza do instrumento</h2>
  <div class="nota" style="margin-top:0">
    <b>Como ler.</b> São <b>${todas.length}</b> registros em nome do deputado na base da Câmara. Esse
    número bruto não é medida de produção: ele soma projeto de lei com requerimento de sessão solene e
    com peça de processo interno. O que informa é a separação abaixo — e, para as matérias de mérito,
    o destino de cada uma.
  </div>
  <table>
    <tr><th style="width:44px">Qtd.</th><th>Natureza</th><th style="width:200px">Tipos</th></tr>
    ${PRD_GRUPOS.map(grupo).join('')}
  </table>

  ${merito.length ? `<h2>Destino das matérias de mérito</h2>
  <div class="nota">Situação registrada hoje na ficha de cada matéria.${teto
    ? ` Leitura individual limitada às ${PRD_TETO_DETALHE} mais recentes.` : ''}</div>
  <table>
    <tr><th style="width:44px">Qtd.</th><th>Situação</th></tr>
    ${destinoOrd.map(([rot, n]) => `<tr><td class="c"><b>${n}</b></td><td>${e(rot)}</td></tr>`).join('')}
  </table>` : ''}

  ${porGrupo.relatoria.length ? `<h2>Relatoria</h2>
  <div class="nota">
    <b>${porGrupo.relatoria.length}</b> parecer(es) em nome do deputado. A base da Câmara registra o
    parecer como proposição própria — é por isso que ele aparece aqui. <b>Ressalva:</b> o parecer não
    traz vínculo com a matéria relatada (<code>uriPropPrincipal</code> vem vazio e
    <code>/relacionadas</code> não devolve nada), então esta seção diz quantos e de que tipo, não em
    quais projetos. A ficha de cada parecer, no portal, mostra a matéria.
  </div>` : ''}

  ${temasOrd.length ? `<h2>Temas das matérias de mérito</h2>
  <div class="nota">Classificação da própria Câmara; uma matéria pode ter mais de um tema.</div>
  <table>
    <tr><th style="width:44px">Qtd.</th><th>Tema</th></tr>
    ${temasOrd.map(([t, n]) => `<tr><td class="c"><b>${n}</b></td><td>${e(t)}</td></tr>`).join('')}
  </table>` : ''}

  ${merito.length ? `<h2>Matérias de mérito, uma a uma</h2>
  <table class="prdlista">
    <tr><th style="width:92px">Matéria</th><th>Ementa</th><th style="width:150px">Situação</th></tr>
    ${merito.map(m => `<tr>
      <td><b><a href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${m.id}">${e(m.siglaTipo)} ${e(m.numero)}/${e(m.ano)}</a></b></td>
      <td>${e(String(m.ementa || '').replace(/\s+/g, ' ').slice(0, 300) || '—')}
        ${m.temas.length ? `<div class="res">${e(m.temas.join(' · '))}</div>` : ''}</td>
      <td>${(m.status || {}).siglaOrgao ? `<b>${e(m.status.siglaOrgao)}</b><br>` : ''}${
        (m.status || {}).descricaoSituacao ? e(m.status.descricaoSituacao) : '<span class="nada">não lida</span>'}</td>
    </tr>`).join('')}
  </table>` : ''}

  <div class="ft">Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
</body></html>`;
}

async function prdExportarPDF() {
  if (!prd.ultimo) return;
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) { prdStatus('Permita pop-ups para gerar o PDF.', 'error'); return; }
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando PDF…</title></head>'
    + '<body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:48px;font-size:14px">Montando o documento…</body></html>');
  win.document.close();

  let logo = null;
  try {
    const res = await fetch(chrome.runtime.getURL('icons/podemos-logo.png'));
    if (res.ok) {
      const blob = await res.blob();
      logo = await new Promise((ok, err) => {
        const fr = new FileReader();
        fr.onloadend = () => ok(fr.result);
        fr.onerror = () => err(fr.error);
        fr.readAsDataURL(blob);
      });
    }
  } catch (e) { console.warn('Logo não carregada:', e.message); }
  if (win.closed) return;

  win.document.open();
  win.document.write(prdHtmlPDF(logo));
  win.document.close();

  let impresso = false;
  const imprimir = () => { if (impresso || win.closed) return; impresso = true; try { win.focus(); win.print(); } catch (_) {} };
  win.PagedConfig = { auto: true, after: imprimir };
  const s = win.document.createElement('script');
  s.src = chrome.runtime.getURL('libs/paged.polyfill.js');
  s.onerror = imprimir;
  win.document.head.appendChild(s);
  setTimeout(imprimir, 30000);
}

// ---------- ligação ----------
if (prdEl.dep() && prdEl.buscar()) {
  prdEl.buscar().addEventListener('click', prdConsultar);

  let t = null;
  prdEl.dep().addEventListener('input', () => {
    prd.deputado = null;
    const nome = prdEl.dep().value.trim();
    clearTimeout(t);
    if (nome.length < 3) { prdEl.escolha().innerHTML = ''; return; }
    t = setTimeout(async () => {
      try {
        const lista = await cvBuscarDeputados(nome);
        if (!lista.length) {
          prdEl.escolha().innerHTML = '<div class="cv-escolha cv-escolha-tit">Nenhum deputado com esse nome na legislatura atual.</div>';
          return;
        }
        // Homônimo é resolvido pelo analista, nunca por adivinhação do código:
        // nome errado aqui contamina o relatório inteiro.
        prdEl.escolha().innerHTML = '<div class="cv-escolha"><div class="cv-escolha-tit">'
          + (lista.length === 1 ? 'Confirme:' : lista.length + ' deputados com esse nome — escolha:') + '</div>'
          + lista.map(d => `<button class="cv-op" data-dep="${d.id}">${cvEsc(d.nome)} <span class="p">(${cvEsc(d.partido)}-${cvEsc(d.uf)})</span></button>`).join('')
          + '</div>';
        prdEl.escolha().querySelectorAll('[data-dep]').forEach(b => {
          b.addEventListener('click', () => {
            prd.deputado = lista.find(x => String(x.id) === b.dataset.dep);
            prdEl.escolha().innerHTML = `<div class="cv-sel">✓ <b>${cvEsc(prd.deputado.nome)}</b> (${cvEsc(prd.deputado.partido)}-${cvEsc(prd.deputado.uf)})</div>`;
          });
        });
      } catch (e) {
        // Falha de consulta NÃO é "não existe deputado com esse nome".
        prdEl.escolha().innerHTML = '<div class="cv-escolha cv-escolha-tit">Não consegui consultar o cadastro da Câmara agora ('
          + cvEsc(e.message) + '). Tente de novo.</div>';
      }
    }, 400);
  });
}
