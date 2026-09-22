// Aba "Radar temático" do módulo Relatórios.
//
// Responde "o que está andando na Casa sobre o tema X" — e marca o que é da
// bancada, que é o que transforma uma lista de proposições em pauta de trabalho.
//
// Duas medições de 18/09/2026 desenharam esta tela:
//
//  1. `codTema` NÃO compõe com `dataApresentacaoInicio/Fim`: a combinação
//     devolve HTTP 400. Compõe com `ano`. Por isso o recorte aqui é por ano, e
//     um intervalo de anos vira uma consulta por ano — não é preguiça de
//     interface, é o que a API aceita.
//  2. Marcar a autoria da bancada NÃO precisa de uma chamada por proposição.
//     A mesma busca, repetida com `siglaPartidoAutor=PODE`, devolve o
//     subconjunto do partido; cruzar os ids resolve em UMA chamada a mais por
//     ano, em vez de uma por item. Numa busca de 400 proposições isso é a
//     diferença entre 2 chamadas e 400.
//
// Depende de aderencia.js (fetchJson, cvEsc, API_PROP) — carregado antes.

const RDR_PARTIDO = 'PODE';

// Teto de páginas por ano. A API devolve 100 por página e não avisa que cortou;
// 20 páginas são 2.000 proposições num ano num tema, o que já é mais do que
// alguém lê. Passando disso, a tela avisa em vez de mentir um total.
const RDR_TETO_PAGINAS = 20;

const rdr = { temas: null, ultimo: null };

const rdrEl = {
  tema:    () => document.getElementById('rdrTema'),
  palavra: () => document.getElementById('rdrPalavra'),
  anoIni:  () => document.getElementById('rdrAnoIni'),
  anoFim:  () => document.getElementById('rdrAnoFim'),
  tipo:    () => document.getElementById('rdrTipo'),
  soBancada: () => document.getElementById('rdrSoBancada'),
  buscar:  () => document.getElementById('rdrBuscar'),
  status:  () => document.getElementById('rdrStatus'),
  resultado: () => document.getElementById('rdrResultado'),
};

function rdrStatus(msg, tipo) {
  const el = rdrEl.status();
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

/**
 * A lista de temas vem da própria Câmara — 32 em 18/09/2026. Digitar o nome do
 * tema à mão seria inventar rótulo; aqui se escolhe de uma lista fechada.
 * Se a carga falhar, o campo fica vazio e diz por quê, em vez de oferecer uma
 * lista chumbada que pode ter envelhecido.
 */
async function rdrCarregarTemas() {
  if (rdr.temas) return rdr.temas;
  const j = await fetchJson('https://dadosabertos.camara.leg.br/api/v2/referencias/proposicoes/codTema');
  rdr.temas = (j.dados || []).map(t => ({ cod: String(t.cod), nome: t.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return rdr.temas;
}

/** Uma busca, paginada, para um ano. Devolve { itens, truncado }. */
async function rdrBuscarAno(base, ano) {
  let url = API_PROP + '?' + base + '&ano=' + ano + '&itens=100&ordem=DESC&ordenarPor=id';
  const itens = [];
  let p = 0;
  while (url && p < RDR_TETO_PAGINAS) {
    const j = await fetchJson(url);
    itens.push(...(j.dados || []));
    const next = (j.links || []).find(l => l.rel === 'next');
    url = next ? next.href : null;
    p++;
  }
  return { itens, truncado: !!url };
}

/**
 * A busca completa: por ano, e para cada ano uma segunda chamada restrita ao
 * partido, cujos ids marcam as linhas da bancada.
 */
async function rdrColetar({ tema, palavra, tipo, anoIni, anoFim }) {
  const partes = [];
  if (tema) partes.push('codTema=' + encodeURIComponent(tema));
  if (palavra) partes.push('keywords=' + encodeURIComponent(palavra));
  if (tipo) partes.push('siglaTipo=' + encodeURIComponent(tipo));
  const base = partes.join('&');

  const itens = [];
  const daBancada = new Set();
  let truncado = false;
  for (let ano = Number(anoIni); ano <= Number(anoFim); ano++) {
    rdrStatus(`Buscando ${ano}…`, 'loading');
    const r = await rdrBuscarAno(base, ano);
    itens.push(...r.itens);
    truncado = truncado || r.truncado;

    const b = await rdrBuscarAno(base + (base ? '&' : '') + 'siglaPartidoAutor=' + RDR_PARTIDO, ano);
    for (const x of b.itens) daBancada.add(x.id);
  }
  // A mesma proposição não pode entrar duas vezes se dois filtros a trouxerem.
  const vistos = new Set();
  const unicos = itens.filter(p => (vistos.has(p.id) ? false : (vistos.add(p.id), true)));
  return { itens: unicos, daBancada, truncado };
}

// ---------- render ----------
function rdrRender(dados) {
  const { itens, daBancada, truncado, filtro } = dados;
  const e = cvEsc;
  const soBancada = rdrEl.soBancada().checked;
  const lista = soBancada ? itens.filter(p => daBancada.has(p.id)) : itens;

  const porTipo = {};
  for (const p of lista) porTipo[p.siglaTipo] = (porTipo[p.siglaTipo] || 0) + 1;
  const tipoOrd = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);
  const nBancada = itens.filter(p => daBancada.has(p.id)).length;

  const html = `
    ${truncado ? `<div class="cv-aviso">⚠ A busca atingiu o limite de páginas em pelo menos um ano —
       há mais proposições do que as listadas. Estreite o recorte (tipo, palavra ou anos).</div>` : ''}

    <div class="cv-cab">
      <h3>${e(filtro.rotulo)}</h3>
      <div class="sub">${e(filtro.periodo)}</div>
      <div class="cv-nums" style="margin-top:12px">
        <div class="cv-num"><div class="v">${itens.length}</div><div class="l">Proposições</div></div>
        <div class="cv-num ade"><div class="v">${nBancada}</div><div class="l">Da bancada</div></div>
        <div class="cv-num"><div class="v">${tipoOrd.length}</div><div class="l">Tipos</div></div>
      </div>
      <div class="prd-chips" style="margin-top:10px">
        ${tipoOrd.map(([t, n]) => `<span class="prd-chip">${e(t)} <b>${n}</b></span>`).join('')}
      </div>
      <div class="cv-acoes">
        <button class="btn-gerar" id="rdrExportarPdf" style="margin-top:0">Exportar PDF</button>
        <button class="btn-gerar" id="rdrExportar" style="margin-top:0;background:rgba(255,255,255,0.06);color:var(--text-dim)">Excel</button>
      </div>
    </div>

    ${lista.length ? `<div class="cv-lista">
      ${lista.map(p => `<div class="cv-item${daBancada.has(p.id) ? ' rdr-bancada' : ''}">
        <div class="prd-sig">${e(p.siglaTipo)} ${e(p.numero)}/${e(p.ano)}</div>
        <div class="cv-corpo">
          <div class="cv-obj">${e(String(p.ementa || '').replace(/\s+/g, ' ').slice(0, 300) || '(sem ementa)')}</div>
          <div class="cv-meta">Apresentada em ${e(formatarData(String(p.dataApresentacao || '').slice(0, 10)))}</div>
          <div class="cv-links"><a href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${p.id}"
             target="_blank" rel="noopener">Ficha de tramitação ↗</a></div>
        </div>
        ${daBancada.has(p.id) ? '<span class="cv-ver aderente">Bancada</span>' : ''}
      </div>`).join('')}
    </div>` : `<div class="cv-aviso">Nenhuma proposição da bancada nesse recorte.
      Desmarque "só da bancada" para ver as ${itens.length} da Casa.</div>`}`;

  rdrEl.resultado().innerHTML = html;
  rdr.ultimo = { itens, daBancada, filtro, lista, tipoOrd, nBancada };
  const b1 = document.getElementById('rdrExportar');
  if (b1) b1.addEventListener('click', rdrExportar);
  const b2 = document.getElementById('rdrExportarPdf');
  if (b2) b2.addEventListener('click', rdrExportarPDF);
}

// ---------- fluxo ----------
async function rdrConsultar() {
  const tema = rdrEl.tema().value;
  const palavra = rdrEl.palavra().value.trim();
  const tipo = rdrEl.tipo().value.trim().toUpperCase();
  const anoIni = rdrEl.anoIni().value.trim();
  const anoFim = rdrEl.anoFim().value.trim();

  if (!tema && !palavra) { rdrStatus('Escolha um tema ou informe uma palavra-chave.', 'error'); return; }
  if (!/^\d{4}$/.test(anoIni) || !/^\d{4}$/.test(anoFim)) { rdrStatus('Informe os anos com quatro dígitos.', 'error'); return; }
  if (Number(anoIni) > Number(anoFim)) { rdrStatus('O ano inicial é posterior ao final.', 'error'); return; }
  if (Number(anoFim) - Number(anoIni) > 8) { rdrStatus('Limite de 8 anos por consulta.', 'error'); return; }

  rdrEl.resultado().innerHTML = '';
  rdrEl.buscar().disabled = true;
  try {
    const dados = await rdrColetar({ tema, palavra, tipo, anoIni, anoFim });
    if (!dados.itens.length) {
      rdrStatus('Nenhuma proposição nesse recorte.', 'error');
      return;
    }
    const nomeTema = tema && (rdr.temas || []).find(t => t.cod === tema);
    const rotulo = [nomeTema ? nomeTema.nome : null, palavra ? `"${palavra}"` : null, tipo || null]
      .filter(Boolean).join(' · ') || 'Busca';
    rdrStatus('');
    rdrRender({ ...dados, filtro: { rotulo, periodo: anoIni === anoFim ? `Ano de ${anoIni}` : `De ${anoIni} a ${anoFim}` } });
  } catch (e) {
    rdrStatus('Erro: ' + e.message, 'error');
    console.error(e);
  } finally {
    rdrEl.buscar().disabled = false;
  }
}

// ---------- exports ----------
function rdrExportar() {
  if (!rdr.ultimo) return;
  const { lista, daBancada, filtro } = rdr.ultimo;
  const rows = [['Tipo', 'Número', 'Ano', 'Apresentada', 'Da bancada', 'Ementa', 'Ficha']];
  for (const p of lista) {
    rows.push([p.siglaTipo, p.numero, p.ano,
      String(p.dataApresentacao || '').slice(0, 10).split('-').reverse().join('/'),
      daBancada.has(p.id) ? 'sim' : '',
      String(p.ementa || '').replace(/\s+/g, ' '),
      'https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=' + p.id]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 7 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 11 }, { wch: 100 }, { wch: 62 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, 'Radar');
  XLSX.writeFile(wb, `radar_${filtro.rotulo.replace(/[^\wÀ-ÿ]+/g, '-').slice(0, 40)}.xlsx`);
}

function rdrHtmlPDF(logoDataUrl) {
  const { lista, daBancada, filtro, tipoOrd, itens, nBancada } = rdr.ultimo;
  const e = cvEsc;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Radar temático — ${e(filtro.rotulo)}</title>
<style>${CSS_PDF_VOTOS}
  td.c { text-align: center; }
  tr.banc td { background: #f2f9f4; }
  .marca { font-size: 7.5pt; font-weight: 700; color: #006633; }
</style></head><body>
  <div class="cab">
    <div class="sp"></div>
    <div class="tit"><h1>Radar temático</h1>
      <div class="sub">${e(filtro.rotulo)} · ${e(filtro.periodo)}</div></div>
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}
  </div>
  <div class="rule"></div>
  <div class="meta">Documento de conferência · dados da API de Dados Abertos da Câmara dos Deputados,
    consultados em ${new Date().toLocaleDateString('pt-BR')}</div>

  <h2>Consolidado</h2>
  <div class="resumo">
    <div class="bx"><div class="v">${itens.length}</div><div class="l">Na Casa</div></div>
    <div class="bx"><div class="v">${nBancada}</div><div class="l">Da bancada</div></div>
    <div class="bx"><div class="v">${tipoOrd.length}</div><div class="l">Tipos</div></div>
  </div>
  <div class="nota">
    <b>Como ler.</b> A lista é de proposições <b>apresentadas</b> no período e classificadas no recorte —
    não de proposições em tramitação hoje. A marca <span class="marca">BANCADA</span> sai de uma segunda
    consulta com o mesmo filtro restrita ao partido, cruzada por identificador: é autoria registrada na
    base, não inferência a partir do nome.
  </div>

  <h2>Proposições</h2>
  <table>
    <tr><th style="width:92px">Matéria</th><th>Ementa</th><th style="width:70px">Apresentada</th></tr>
    ${lista.map(p => `<tr class="${daBancada.has(p.id) ? 'banc' : ''}">
      <td><b><a href="https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${p.id}">${e(p.siglaTipo)} ${e(p.numero)}/${e(p.ano)}</a></b>
        ${daBancada.has(p.id) ? '<div class="marca">BANCADA</div>' : ''}</td>
      <td>${e(String(p.ementa || '').replace(/\s+/g, ' ').slice(0, 320) || '—')}</td>
      <td class="c">${e(String(p.dataApresentacao || '').slice(0, 10).split('-').reverse().join('/'))}</td>
    </tr>`).join('')}
  </table>

  <div class="ft">Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
</body></html>`;
}

async function rdrExportarPDF() {
  if (!rdr.ultimo) return;
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) { rdrStatus('Permita pop-ups para gerar o PDF.', 'error'); return; }
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
  win.document.write(rdrHtmlPDF(logo));
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
if (rdrEl.tema() && rdrEl.buscar()) {
  rdrEl.buscar().addEventListener('click', rdrConsultar);
  rdrEl.soBancada().addEventListener('change', () => { if (rdr.ultimo) rdrRender(rdr.ultimo); });

  const hoje = new Date().getFullYear();
  rdrEl.anoIni().value = String(hoje);
  rdrEl.anoFim().value = String(hoje);

  rdrCarregarTemas().then(ts => {
    const sel = rdrEl.tema();
    sel.innerHTML = '<option value="">— qualquer tema —</option>'
      + ts.map(t => `<option value="${cvEsc(t.cod)}">${cvEsc(t.nome)}</option>`).join('');
  }).catch(e => {
    // Lista chumbada envelheceria em silêncio: melhor dizer que não carregou.
    rdrEl.tema().innerHTML = '<option value="">(lista de temas não carregou — use palavra-chave)</option>';
    console.warn('[radar] temas não carregados:', e.message);
  });
}
