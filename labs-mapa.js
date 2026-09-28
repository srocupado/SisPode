'use strict';
// Labs · Mapa Territorial de Entregas.
//
// Onde cada deputado da bancada teve votos (eleição de 2022, por município) e
// onde as emendas pagas chegaram. O mapa pinta cada município pela FATIA dos
// votos de deputado federal daquele município que foram do deputado (e não
// pelo número absoluto, que só repetiria o mapa da população); os círculos
// são as emendas pagas com município identificado.
//
// Os dados eleitorais vêm processados no banco (/labs/mapa/{ano}), gravados
// pelo bot (/labsmapa) ou por esta tela, à mão, a partir dos CSV do TSE — o
// processamento roda no navegador e só o agregado vai para o banco.
// As emendas vêm do Portal da Transparência, pela chave do analista (a mesma
// do módulo Orçamento → Emendas), e ficam em cache no banco por ano.
// Contornos dos municípios: malhas do IBGE.
//
// Depende de labs.js e labs-mapa-nucleo.js.

const MP_ANO_ELEICAO = '2022';
const MP_BASE = '/labs/mapa';
const MP_TRANSP = 'https://api.portaldatransparencia.gov.br/api-de-dados';
const MP_IBGE = 'https://servicodados.ibge.gov.br/api';
const MP_CORES = ['#17363c', '#1f5a5f', '#23807f', '#2fa89a', '#58d0b0', '#a6f0cf'];

const mp = { dados: null, malhas: {}, ibgeUf: {}, processado: null };

function mpEl(id) { return document.getElementById(id); }
function mpNum(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function mpReais(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function mpPct(x) { return (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }

async function mpFb(caminho) {
  const r = await fetch(LABS_FIREBASE + caminho + '.json');
  if (!r.ok) throw new Error('banco de dados: HTTP ' + r.status);
  return r.json();
}
async function mpFbEscrever(metodo, caminho, dado) {
  const r = await fetch(LABS_FIREBASE + caminho + '.json', { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dado) });
  if (!r.ok) throw new Error('banco de dados: HTTP ' + r.status);
}

function mpChaveTransparencia() {
  return new Promise(r => {
    try { chrome.storage.local.get(['transparenciaChave'], o => r((o && o.transparenciaChave) || '')); }
    catch (e) { r(''); }
  });
}

/** Municípios da UF segundo o IBGE: [{id, nome}]. */
async function mpIbgeUf(uf) {
  if (!mp.ibgeUf[uf]) {
    const j = await labsJson(`${MP_IBGE}/v1/localidades/estados/${uf}/municipios`);
    mp.ibgeUf[uf] = (j || []).map(m => ({ id: m.id, nome: m.nome }));
  }
  return mp.ibgeUf[uf];
}

async function mpMalha(uf) {
  if (!mp.malhas[uf]) {
    mp.malhas[uf] = await labsJson(`${MP_IBGE}/v3/malhas/estados/${uf}?formato=application/vnd.geo%2Bjson&intrarregiao=municipio&qualidade=minima`);
  }
  return mp.malhas[uf];
}

// ---------- situação e seleção ----------
async function mpCarregar() {
  try {
    const [meta, deps] = await Promise.all([
      mpFb(`${MP_BASE}/${MP_ANO_ELEICAO}/meta`),
      mpFb(`${MP_BASE}/${MP_ANO_ELEICAO}/deputados`),
    ]);
    mp.dados = deps || {};
    const lista = Object.entries(mp.dados).map(([id, d]) => ({ id, nome: d.nome, uf: d.uf })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    mpEl('mpDep').innerHTML = lista.length
      ? lista.map(d => `<option value="${labsEsc(d.id)}">${labsEsc(d.nome)} (${labsEsc(d.uf)})</option>`).join('')
      : '<option value="">— nada processado ainda —</option>';
    mpEl('mpMostrar').disabled = !lista.length;
    if (meta) {
      const em = meta.atualizadoEm ? new Date(meta.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '?';
      mpEl('mpSituacao').innerHTML = `Eleição de ${MP_ANO_ELEICAO}: processada em <b>${labsEsc(em)}</b> (${labsEsc(meta.origem || '?')}) —
        ${lista.length} deputado(s), estados ${labsEsc((meta.ufs || []).join(', ') || '—')}.`;
    } else {
      mpEl('mpSituacao').innerHTML = `<b>Nada processado ainda para ${MP_ANO_ELEICAO}.</b> Rode o comando do bot ou siga os passos abaixo.`;
    }
  } catch (e) {
    mpEl('mpSituacao').textContent = 'Não foi possível ler o banco: ' + e.message;
  }
}

function mpPreencherAnos() {
  const atual = new Date().getFullYear();
  const anos = [];
  for (let a = atual; a >= 2023; a--) anos.push(a);
  mpEl('mpAnoEmendas').innerHTML = anos.map(a => `<option value="${a}">${a}</option>`).join('');
}

// ---------- emendas ----------
/** Todas as emendas do autor no ano, paginando o Portal. */
async function mpBuscarEmendas(nome, ano, chave) {
  const out = [];
  for (let pagina = 1; pagina <= 60; pagina++) {
    const url = `${MP_TRANSP}/emendas?ano=${ano}&nomeAutor=${encodeURIComponent(lmnNomeAutor(nome))}&pagina=${pagina}`;
    const lote = await labsJson(url, { headers: { 'chave-api-dados': chave, Accept: 'application/json' } });
    if (!Array.isArray(lote) || !lote.length) break;
    out.push(...lote);
  }
  return out;
}

/** Emendas do deputado no ano: do cache do banco ou, se não houver, do Portal (e grava o cache). */
async function mpEmendas(depId, dep, ano) {
  const cam = `${MP_BASE}/emendas/${ano}/${labsSanitizar(depId)}`;
  const cache = await mpFb(cam).catch(() => null);
  const anoCorrente = String(ano) === String(new Date().getFullYear());
  const fresco = cache && (!anoCorrente || Date.now() - new Date(cache.atualizadoEm).getTime() < 24 * 3600e3);
  if (fresco) return cache;
  const chave = await mpChaveTransparencia();
  if (!chave) return cache ? Object.assign({ aviso: 'cache antigo (sem chave do Portal para atualizar)' }, cache) : { semChave: true };
  labsStatus('mpStatus', 'Buscando as emendas no Portal da Transparência…', 'loading');
  const brutas = await mpBuscarEmendas(dep.nome, ano, chave);
  const ufs = new Set();
  for (const e of brutas) { const l = lmnLocalidade(e.localidadeDoGasto); if (l.tipo === 'municipio') ufs.add(l.uf); }
  const resolv = {};
  for (const uf of ufs) { try { resolv[uf] = lmnResolvedor(await mpIbgeUf(uf)); } catch (_) {} }
  const ag = lmnAgregarEmendas(brutas, (n, uf) => resolv[uf] ? resolv[uf](n) : null);
  const reg = Object.assign({ atualizadoEm: new Date().toISOString(), origem: 'extensão' }, ag);
  mpFbEscrever('PUT', cam, reg).catch(() => {});
  return reg;
}

// ---------- mapa ----------
function mpAneis(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}

/** Projeção simples (equiretangular corrigida pela latitude média) da malha para um SVG de largura `larg`. */
function mpProjetar(geo, larg = 800) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of geo.features || []) for (const anel of mpAneis(f.geometry)) for (const [x, y] of anel) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
  const esc = larg / ((x1 - x0) * k || 1);
  const alt = Math.max(1, Math.round((y1 - y0) * esc));
  const p = ([x, y]) => [(x - x0) * k * esc, (y1 - y) * esc];
  return { p, larg, alt };
}

function mpCaminho(geom, p) {
  let d = '';
  for (const anel of mpAneis(geom)) {
    d += anel.map((c, i) => { const [x, y] = p(c); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('') + 'Z';
  }
  return d;
}

function mpCentro(geom, p) {
  let maior = null, area = -1;
  for (const anel of mpAneis(geom)) {
    let a = 0;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) a += (anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1]);
    if (Math.abs(a) > area) { area = Math.abs(a); maior = anel; }
  }
  if (!maior) return null;
  let sx = 0, sy = 0;
  for (const c of maior) { const [x, y] = p(c); sx += x; sy += y; }
  return [sx / maior.length, sy / maior.length];
}

/** Quebras por quantis das fatias positivas (5 classes). */
function mpQuebras(valores) {
  const v = valores.filter(x => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  return [0.2, 0.4, 0.6, 0.8].map(q => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
}
function mpCor(x, quebras) {
  if (!(x > 0)) return MP_CORES[0];
  let i = 0;
  while (i < quebras.length && x > quebras[i]) i++;
  return MP_CORES[i + 1];
}

async function mpMostrarClick() {
  const depId = mpEl('mpDep').value;
  const dep = mp.dados && mp.dados[depId];
  if (!dep) return;
  const ano = mpEl('mpAnoEmendas').value;
  const bt = mpEl('mpMostrar');
  bt.disabled = true;
  mpEl('mpResultado').innerHTML = '';
  try {
    labsStatus('mpStatus', 'Carregando o mapa do IBGE e os totais do estado…', 'loading');
    const [geo, totais] = await Promise.all([mpMalha(dep.uf), mpFb(`${MP_BASE}/${MP_ANO_ELEICAO}/municipios/${dep.uf}`)]);
    let emendas;
    try { emendas = await mpEmendas(depId, dep, ano); }
    catch (e) { emendas = { erro: e.message }; }
    labsStatus('mpStatus', '');
    mpRender(dep, geo, totais || {}, emendas, ano);
  } catch (e) {
    labsStatus('mpStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

function mpRender(dep, geo, totais, emendas, ano) {
  const { p, larg, alt } = mpProjetar(geo);
  const votos = dep.municipios || {};
  const fatia = k => { const t = (totais[k] || {}).t; return t ? (votos[k] || 0) / t : 0; };
  const chaves = (geo.features || []).map(f => 'm' + (f.properties && f.properties.codarea));
  const quebras = mpQuebras(chaves.map(fatia));
  const mun = emendas && emendas.municipais || {};
  const maxEm = Math.max(0, ...Object.values(mun));
  let paths = '', circulos = '';
  for (const f of geo.features || []) {
    const k = 'm' + (f.properties && f.properties.codarea);
    paths += `<path d="${mpCaminho(f.geometry, p)}" fill="${mpCor(fatia(k), quebras)}" data-k="${k}"></path>`;
    if (mun[k] && maxEm) {
      const c = mpCentro(f.geometry, p);
      if (c) circulos += `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${(3 + 13 * Math.sqrt(mun[k] / maxEm)).toFixed(1)}"></circle>`;
    }
  }
  const legenda = quebras.length
    ? MP_CORES.slice(1).map((c, i) => `<i style="background:${c}"></i>${i === 0 ? 'até ' + mpPct(quebras[0]) : i === 4 ? '> ' + mpPct(quebras[3]) : mpPct(quebras[i - 1]) + '–' + mpPct(quebras[i])}`).join(' ')
    : '';
  const top = Object.entries(votos).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const nomeMun = k => (totais[k] || {}).n || k;
  const comEmenda = Object.keys(mun);
  const votosOndeTemEmenda = comEmenda.reduce((s, k) => s + (votos[k] || 0), 0);
  const outros = Object.entries(emendas && emendas.outros || {}).sort((a, b) => b[1] - a[1]);

  let blocoEmendas;
  if (!emendas || emendas.semChave) {
    blocoEmendas = '<div class="sub">Sem a chave do Portal da Transparência neste navegador. Cadastre-a em <b>Orçamento → Emendas</b> para ver as emendas pagas.</div>';
  } else if (emendas.erro) {
    blocoEmendas = `<div class="sub">Não foi possível buscar as emendas: ${labsEsc(emendas.erro)}</div>`;
  } else {
    blocoEmendas = `<div class="sub">Pago em ${ano}: <b>${mpReais(emendas.total)}</b> (${mpNum(emendas.n)} registro(s) no Portal)${emendas.aviso ? ' — ' + labsEsc(emendas.aviso) : ''}.</div>
      ${comEmenda.length ? `<div class="sub" style="margin-top:6px"><b>Com município identificado</b> (círculos no mapa):</div>
        <table class="labs-tab">${comEmenda.sort((a, b) => mun[b] - mun[a]).map(k => `<tr><td>${labsEsc(nomeMun(k))}</td><td style="text-align:right">${mpReais(mun[k])}</td></tr>`).join('')}</table>
        <div class="sub" style="margin-top:4px">${mpPct(dep.total ? votosOndeTemEmenda / dep.total : 0)} dos votos do deputado vieram desses municípios.</div>` : ''}
      ${outros.length ? `<div class="sub" style="margin-top:6px"><b>Sem município no Portal</b>:</div>
        <table class="labs-tab">${outros.map(([r, v]) => `<tr><td>${labsEsc(r)}</td><td style="text-align:right">${mpReais(v)}</td></tr>`).join('')}</table>` : ''}
      <div class="sub" style="margin-top:6px">O Portal registra a maior parte das emendas como “MÚLTIPLO” — o município de destino
        não vem na fonte. Por isso muitas entregas não aparecem como círculo. Para saúde, o detalhe por município está no FNS (Orçamento → Emendas).</div>`;
  }

  mpEl('mpResultado').innerHTML = `
    <div class="labs-cards">
      <div class="labs-card"><div class="v">${mpNum(dep.total)}</div><div class="l">votos em ${MP_ANO_ELEICAO}</div></div>
      <div class="labs-card"><div class="v">${mpNum(Object.keys(votos).length)}</div><div class="l">municípios com voto</div></div>
      <div class="labs-card f3"><div class="v">${emendas && emendas.total != null ? mpReais(emendas.total) : '—'}</div><div class="l">emendas pagas em ${ano}</div></div>
    </div>
    <div class="labs-mapa-wrap">
      <div class="labs-mapa" id="mpMapa">
        <svg viewBox="0 0 ${larg} ${alt}" preserveAspectRatio="xMidYMid meet">${paths}${circulos}</svg>
        <div class="labs-dica-mapa" id="mpDica" hidden></div>
        <div class="labs-legenda">Fatia dos votos de deputado federal do município: <i style="background:${MP_CORES[0]}"></i>0 ${legenda}
          · <span style="color:#f0c040">●</span> emenda paga</div>
      </div>
      <div class="labs-lado">
        <div class="labs-caixa" style="margin-top:0"><h3>Onde teve mais votos</h3>
          <table class="labs-tab"><tr><th>Município</th><th style="text-align:right">Votos</th><th style="text-align:right">do município</th></tr>
          ${top.map(([k, v]) => `<tr><td>${labsEsc(nomeMun(k))}</td><td style="text-align:right">${mpNum(v)}</td><td style="text-align:right">${mpPct(fatia(k))}</td></tr>`).join('')}</table>
          ${dep.foraDoMapa ? `<div class="sub" style="margin-top:4px">${mpNum(dep.foraDoMapa)} voto(s) em municípios sem correspondência no IBGE.</div>` : ''}
        </div>
        <div class="labs-caixa"><h3>Emendas</h3>${blocoEmendas}</div>
      </div>
    </div>
    <div class="labs-custo">Eleito(a) em ${MP_ANO_ELEICAO} pelo ${labsEsc(dep.partidoEleicao || '?')} como “${labsEsc(dep.nomeUrna || dep.nome)}”. Fontes: TSE (votação por município), IBGE (malhas), Portal da Transparência (emendas).</div>`;

  const svg = mpEl('mpMapa').querySelector('svg');
  const dica = mpEl('mpDica');
  svg.addEventListener('mousemove', ev => {
    const k = ev.target && ev.target.dataset && ev.target.dataset.k;
    if (!k) { dica.hidden = true; return; }
    const caixa = mpEl('mpMapa').getBoundingClientRect();
    dica.innerHTML = `<b>${labsEsc(nomeMun(k))}</b><br>${mpNum(votos[k] || 0)} votos · ${mpPct(fatia(k))} do município` +
      (mun[k] ? `<br>Emendas pagas: ${mpReais(mun[k])}` : '');
    dica.style.left = (ev.clientX - caixa.left + 12) + 'px';
    dica.style.top = (ev.clientY - caixa.top + 12) + 'px';
    dica.hidden = false;
  });
  svg.addEventListener('mouseleave', () => { dica.hidden = true; });
}

// ---------- processamento manual dos CSV do TSE ----------
/** Deputados do PODE em exercício, com nome civil (para casar com o TSE). */
async function mpBancada() {
  const j = await labsJson(`${LABS_API}/deputados?siglaPartido=PODE&ordem=ASC&ordenarPor=nome&itens=100`);
  const lista = j.dados || [];
  const det = await labsMapLimit(lista, 4, async d => ((await labsJson(`${LABS_API}/deputados/${d.id}`)).dados || {}));
  return lista.map((d, i) => ({ id: String(d.id), nome: d.nome, uf: d.siglaUf, nomeCivil: (det[i] || {}).nomeCivil || '' }));
}

/** Lê um File como texto latin1, linha a linha, sem carregar tudo na memória. */
async function mpLerArquivo(arquivo, aoLer, aoAndar) {
  const dec = new TextDecoder('latin1');
  const lin = lmnLinhas(aoLer);
  const leitor = arquivo.stream().getReader();
  let lidos = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lidos += value.length;
    lin.empurrar(dec.decode(value, { stream: true }));
    if (aoAndar) aoAndar(lidos, arquivo.size);
  }
  lin.empurrar(dec.decode());
  lin.fim();
}

async function mpProcessarClick() {
  const arquivos = [...(mpEl('mpArquivos').files || [])];
  if (!arquivos.length) return;
  const bt = mpEl('mpProcessar');
  bt.disabled = true;
  mpEl('mpUpResultado').innerHTML = '';
  try {
    labsStatus('mpUpStatus', 'Buscando a bancada na Câmara…', 'loading');
    const alvos = await mpBancada();
    const ag = lmnAgregador(alvos);
    const anoArq = (arquivos.map(a => (a.name.match(/munzona_(\d{4})/) || [])[1]).find(Boolean)) || MP_ANO_ELEICAO;
    for (let i = 0; i < arquivos.length; i++) {
      const a = arquivos[i];
      ag.novoArquivo();
      await mpLerArquivo(a, l => ag.linha(l), (f, t) =>
        labsStatus('mpUpStatus', `Lendo ${labsEsc(a.name)} (${i + 1}/${arquivos.length})… ${Math.round(f / t * 100)}%`, 'loading'));
    }
    const res = ag.resultado();
    labsStatus('mpUpStatus', 'Casando os municípios do TSE com os do IBGE…', 'loading');
    const ibgePorUf = {};
    for (const uf of res.ufs) ibgePorUf[uf] = await mpIbgeUf(uf);
    const reg = lmnParaIbge(res, ibgePorUf);
    mp.processado = { ano: anoArq, reg, res };
    labsStatus('mpUpStatus', '');
    mpRenderProcessado();
  } catch (e) {
    labsStatus('mpUpStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

function mpRenderProcessado() {
  const { ano, reg, res } = mp.processado;
  const deps = Object.entries(reg.deputados).sort((a, b) => b[1].total - a[1].total);
  const nao = res.naoEncontrados;
  mpEl('mpUpResultado').innerHTML = `
    <div class="sub" style="margin-top:8px">Eleição de <b>${labsEsc(ano)}</b> · estados lidos: ${labsEsc(res.ufs.join(', ') || '—')} · ${mpNum(res.linhas)} linhas de deputado federal.</div>
    ${deps.length ? `<table class="labs-tab" style="margin-top:6px"><tr><th>Deputado(a)</th><th>UF</th><th style="text-align:right">Votos</th><th style="text-align:right">Municípios</th></tr>
      ${deps.map(([, d]) => `<tr><td>${labsEsc(d.nome)} <span class="base">(urna: ${labsEsc(d.nomeUrna)}, ${labsEsc(d.partidoEleicao)})</span></td><td>${labsEsc(d.uf)}</td><td style="text-align:right">${mpNum(d.total)}</td><td style="text-align:right">${mpNum(Object.keys(d.municipios).length)}</td></tr>`).join('')}</table>` : ''}
    ${nao.length ? `<div class="sub" style="margin-top:6px"><b>Não encontrados</b> (não serão gravados): ${nao.map(n => `${labsEsc(n.nome)} (${labsEsc(n.uf)}: ${labsEsc(n.motivo)})`).join('; ')}.</div>` : ''}
    ${reg.semPar.length ? `<div class="sub" style="margin-top:4px">${reg.semPar.length} município(s) do TSE sem correspondência no IBGE: ${reg.semPar.slice(0, 8).map(m => labsEsc(m.n + '/' + m.uf)).join(', ')}${reg.semPar.length > 8 ? '…' : ''}</div>` : ''}
    ${deps.length ? `<button id="mpGravar" class="btn-gerar" style="margin-top:8px">Gravar no banco de dados</button>` : ''}`;
  const g = mpEl('mpGravar');
  if (g) g.addEventListener('click', mpGravarClick);
}

async function mpGravarClick() {
  const { ano, reg, res } = mp.processado;
  const n = Object.keys(reg.deputados).length;
  if (!confirm(`Gravar no banco compartilhado os votos de ${ano} de ${n} deputado(s) (${res.ufs.join(', ')})? Substitui o que houver para esses deputados e estados.`)) return;
  const bt = mpEl('mpGravar');
  bt.disabled = true;
  try {
    labsStatus('mpUpStatus', 'Gravando…', 'loading');
    const base = `${MP_BASE}/${ano}`;
    const metaAntiga = await mpFb(`${base}/meta`).catch(() => null);
    await mpFbEscrever('PATCH', `${base}/deputados`, reg.deputados);
    for (const [uf, m] of Object.entries(reg.municipios)) await mpFbEscrever('PUT', `${base}/municipios/${uf}`, m);
    const ufs = [...new Set([...((metaAntiga && metaAntiga.ufs) || []), ...res.ufs])].sort();
    await mpFbEscrever('PUT', `${base}/meta`, { atualizadoEm: new Date().toISOString(), origem: 'extensão (manual)', ufs, naoEncontrados: res.naoEncontrados.length, semPar: reg.semPar.length });
    labsStatus('mpUpStatus', `Gravado: ${n} deputado(s).`);
    mp.processado = null;
    mpEl('mpUpResultado').innerHTML = '';
    await mpCarregar();
  } catch (e) {
    labsStatus('mpUpStatus', 'Não gravou: ' + e.message, 'error');
    bt.disabled = false;
  }
}

if (mpEl('mpMostrar')) {
  mpPreencherAnos();
  mpEl('mpMostrar').addEventListener('click', mpMostrarClick);
  mpEl('mpArquivos').addEventListener('change', () => { mpEl('mpProcessar').disabled = !mpEl('mpArquivos').files.length; });
  mpEl('mpProcessar').addEventListener('click', mpProcessarClick);
  let carregou = false;
  document.addEventListener('labs:aba', ev => {
    if (ev.detail === 'aba-mapa' && !carregou) { carregou = true; mpCarregar(); }
  });
}
