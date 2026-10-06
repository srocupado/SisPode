'use strict';
// Labs · Mapa Territorial de Entregas.
//
// Onde cada deputado da bancada teve votos (eleição de 2026 ou 2022, por município) e
// onde as emendas pagas chegaram. O mapa pinta cada município pela FATIA dos
// votos de deputado federal daquele município que foram do deputado (e não
// pelo número absoluto, que só repetiria o mapa da população); os círculos
// são as emendas pagas com município identificado.
//
// Os dados eleitorais vêm processados no banco (/labs/mapa/{ano}), gravados
// pelo bot (/labsmapa), por esta tela com UM CLIQUE — a extensão lê o índice do
// zip do TSE e baixa só os arquivos dos estados da bancada (pedidos HTTP com
// Range; o zip inteiro tem centenas de MB) — ou à mão, a partir dos CSV. O
// processamento roda no navegador e só o agregado vai para o banco.
// Em 2026 a bancada são os eleitos do partido no próprio arquivo, e a eleição
// anterior (2022) entra como comparação: ganho e perda de votos por município.
// As emendas vêm do Portal da Transparência, pela chave do analista (a mesma
// do módulo Orçamento → Emendas), e ficam em cache no banco por ano. As
// emendas que a API devolve como "MÚLTIPLO" (sem município) são localizadas
// pelo favorecido de cada pagamento, no arquivo de dados abertos do Portal
// (um zip de ~32 MB, lido uma vez para toda a bancada: /labs/mapa/favorecidos).
// Contornos dos municípios: malhas do IBGE.
//
// Depende de labs.js e labs-mapa-nucleo.js.

const MP_TSE_ZIP = ano => `https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`;
const MP_PARTIDO = { sigla: 'PODE', numero: '20' };
const MP_CORES_VAR = { perda: ['#7a2a2a', '#b5483f', '#e07a6a'], ganho: ['#2b6e4f', '#3fa36f', '#7fdca4'] };
const MP_BASE = '/labs/mapa';
const MP_TRANSP = 'https://api.portaldatransparencia.gov.br/api-de-dados';
const MP_EMENDAS_ZIP = 'https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/emendas-parlamentares/EmendasParlamentares.zip';
const MP_IBGE = 'https://servicodados.ibge.gov.br/api';
const MP_CORES = ['#17363c', '#1f5a5f', '#23807f', '#2fa89a', '#58d0b0', '#a6f0cf'];

const mp = { dados: null, malhas: {}, ibgeUf: {}, processado: null, modo: 'fatia', ultimo: null };

/** Eleição escolhida na tela (padrão: a mais recente). */
function mpAno() { const el = mpEl('mpEleicao'); return (el && el.value) || LMN_ANOS[0]; }

function mpEl(id) { return document.getElementById(id); }
function mpNum(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function mpReais(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
// Abaixo de 1%, 2 algarismos significativos: "0,031%" em vez de um "0%" que
// esconde a diferença entre as faixas da legenda.
function mpPct(x) {
  const v = x * 100;
  const o = v > 0 && v < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 };
  return v.toLocaleString('pt-BR', o) + '%';
}

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
      mpFb(`${MP_BASE}/${mpAno()}/meta`),
      mpFb(`${MP_BASE}/${mpAno()}/deputados`),
    ]);
    // Registro torto no banco (regras abertas, gravação pela metade) não pode
    // travar a tela: entra só quem é objeto com nome e UF.
    mp.dados = {};
    for (const [id, d] of Object.entries(deps || {})) if (d && typeof d === 'object' && d.nome && d.uf) mp.dados[id] = d;
    const lista = Object.entries(mp.dados).map(([id, d]) => ({ id, nome: String(d.nome), uf: String(d.uf) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    mpEl('mpDep').innerHTML = lista.length
      ? lista.map(d => `<option value="${labsEsc(d.id)}">${labsEsc(d.nome)} (${labsEsc(d.uf)})</option>`).join('')
      : '<option value="">— nada processado ainda —</option>';
    mpEl('mpMostrar').disabled = !lista.length;
    if (meta) {
      const em = meta.atualizadoEm ? new Date(meta.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '?';
      mpEl('mpSituacao').innerHTML = `Eleição de ${mpAno()}: processada em <b>${labsEsc(em)}</b> (${labsEsc(meta.origem || '?')}) —
        ${lista.length} deputado(s), estados ${labsEsc((meta.ufs || []).join(', ') || '—')}.`;
    } else {
      mpEl('mpSituacao').innerHTML = `<b>Nada processado ainda para ${mpAno()}.</b> Use <b>Baixar do TSE e processar</b> abaixo.`;
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

function mpDia(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (_) { return '?'; } }

/**
 * O cache de emendas ainda vale? Ano corrente: 24 h. Ano passado: 7 dias —
 * restos a pagar das emendas daquele ano continuam sendo pagos nos anos
 * seguintes, e cache gravado DURANTE o ano ficaria congelado para sempre.
 * Cache sem o campo restoPago é do formato antigo (só pago no ano): refaz.
 */
function mpCacheFresco(cache, ano, agora = Date.now()) {
  if (!cache || !cache.atualizadoEm || cache.restoPago == null) return false;
  const idade = agora - new Date(cache.atualizadoEm).getTime();
  const anoCorrente = String(ano) === String(new Date(agora).getFullYear());
  return idade >= 0 && idade < (anoCorrente ? 24 : 7 * 24) * 3600e3;
}

/** Emendas do deputado no ano: do cache do banco ou, se não houver, do Portal (e grava o cache). */
async function mpEmendas(depId, dep, ano) {
  const cam = `${MP_BASE}/emendas/${ano}/${labsSanitizar(depId)}`;
  const cache = await mpFb(cam).catch(() => null);
  if (cache && mpCacheFresco(cache, ano)) return cache;
  const chave = await mpChaveTransparencia();
  if (!chave) return cache ? Object.assign({ aviso: 'dado de ' + mpDia(cache.atualizadoEm) + ' (sem chave do Portal para atualizar)' }, cache) : { semChave: true };
  labsStatus('mpStatus', 'Buscando as emendas no Portal da Transparência…', 'loading');
  let brutas;
  try { brutas = await mpBuscarEmendas(dep.nome, ano, chave); }
  catch (e) {
    // Portal fora do ar: melhor o dado anterior, dito como tal, do que nada.
    if (cache) return Object.assign({ aviso: `Portal indisponível (${e.message}); mostrando o dado de ${mpDia(cache.atualizadoEm)}` }, cache);
    throw e;
  }
  const ufs = new Set();
  for (const e of brutas) { const l = lmnLocalidade(e.localidadeDoGasto); if (l.tipo === 'municipio') ufs.add(l.uf); }
  const resolv = {};
  for (const uf of ufs) { try { resolv[uf] = lmnResolvedor(await mpIbgeUf(uf), uf); } catch (_) {} }
  const ag = lmnAgregarEmendas(brutas, (n, uf) => resolv[uf] ? resolv[uf](n) : null, dep.nome);
  const reg = Object.assign({ atualizadoEm: new Date().toISOString(), origem: 'extensão' }, ag);
  mpFbEscrever('PUT', cam, reg).catch(() => {});
  return reg;
}

// ---------- destino das emendas "MÚLTIPLO" pelo favorecido ----------
async function mpFavMeta() {
  if (mp.favMeta === undefined) mp.favMeta = await mpFb(`${MP_BASE}/favorecidos/meta`).catch(() => null);
  return mp.favMeta;
}

/** O agregado do deputado com o valor "sem município" levado aos municípios pelo favorecido (se já processado). */
async function mpComFavorecidos(emendas, dep, ano) {
  if (!emendas || emendas.erro || emendas.semChave || !Object.keys(emendas.outros || {}).length) return emendas;
  const meta = await mpFavMeta();
  const fav = meta ? await mpFb(`${MP_BASE}/favorecidos/autores/${lmnChave(lmnNomeAutor(dep.nome))}/${ano}`).catch(() => null) : null;
  if (!fav) return Object.assign({}, emendas, { favMeta: meta, favPendente: true });
  const ufs = new Set();
  for (const n of Object.keys(fav.mun || {})) { const l = lmnLocalidade(n); if (l.tipo === 'municipio') ufs.add(l.uf); }
  const resolv = {};
  for (const uf of ufs) { try { resolv[uf] = lmnResolvedor(await mpIbgeUf(uf), uf); } catch (_) {} }
  return Object.assign(lmnRedistribuir(emendas, fav, (n, uf) => resolv[uf] ? resolv[uf](n) : null), { favMeta: meta });
}

function mpDataArquivo(meta) {
  const d = new Date((meta && (meta.arquivo || meta.atualizadoEm)) || '');
  return isNaN(d) ? '?' : d.toLocaleDateString('pt-BR');
}

/**
 * Um clique: lê do zip de emendas do Portal (pedidos com Range, só os dois CSVs
 * que interessam) as emendas sem município dos deputados das eleições
 * processadas e para onde foi cada pagamento; grava em /labs/mapa/favorecidos.
 */
async function mpFavProcessarClick() {
  const bt = mpEl('mpFavBaixar');
  if (bt) bt.disabled = true;
  const st = m => labsStatus('mpStatus', m, 'loading');
  const fmt = x => x.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  try {
    st('Lendo o índice do arquivo de emendas do Portal da Transparência…');
    const url = MP_EMENDAS_ZIP;
    const r0 = await mpFaixa(url, 0, 0);
    const total = Number(String(r0.headers.get('content-range') || '').split('/')[1]);
    const arquivo = r0.headers.get('last-modified') || '';
    try { await r0.arrayBuffer(); } catch (_) {}
    if (!(total > 0)) throw new Error('o Portal não informou o tamanho do arquivo');
    const ents = await mpEntradasZip(total, async (ini, n) => new Uint8Array(await (await mpFaixa(url, ini, ini + n - 1)).arrayBuffer()));
    const eE = ents.find(e => /^EmendasParlamentares\.csv$/i.test(e.nome)), eF = ents.find(e => /PorFavorecido\.csv$/i.test(e.nome));
    if (!eE || !eF) throw new Error('o arquivo do Portal mudou de formato (faltam os CSVs de emendas e de pagamentos por favorecido)');
    const nomes = new Set();
    for (const a of LMN_ANOS) {
      const d = a === mpAno() && mp.dados ? mp.dados : await mpFb(`${MP_BASE}/${a}/deputados`).catch(() => null);
      for (const x of Object.values(d || {})) if (x && x.nome) nomes.add(String(x.nome));
    }
    if (!nomes.size) throw new Error('nenhuma eleição processada: processe a bancada antes');
    const anos = [...mpEl('mpAnoEmendas').options].map(o => o.value);
    const mb = (eE.comprimido + eF.comprimido) / 1e6;
    labsStatus('mpStatus', '');
    if (!confirm(`Baixar ${fmt(mb)} MB do Portal da Transparência (arquivo de emendas por favorecido, de ${mpDataArquivo({ arquivo })}) e localizar o município das emendas sem município de ${nomes.size} deputado(s), anos ${anos.join(', ')}?\n\nÉ uma vez para toda a bancada; o resultado fica no banco.`)) { if (bt) bt.disabled = false; return; }
    const L = lmnLeitorFavorecidos([...nomes], anos);
    let feito = 0;
    for (const [e, leitor, rot] of [[eE, L.emendas, 'Emendas'], [eF, L.favorecidos, 'Pagamentos por favorecido']]) {
      await mpLerEntradaRemota(url, e, l => leitor.linha(l), n => st(`${rot} — ${fmt((feito + n) / 1e6)} de ${fmt(mb)} MB`));
      feito += e.comprimido;
    }
    const meta = { atualizadoEm: new Date().toISOString(), arquivo, anos, autores: nomes.size, emendas: L.emendasSemMunicipio(), origem: 'extensão (Portal, 1 clique)' };
    st('Gravando no banco…');
    await mpFbEscrever('PUT', `${MP_BASE}/favorecidos`, { meta, autores: L.resultado() });
    mp.favMeta = meta;
    labsStatus('mpStatus', '');
    await mpMostrarClick();
  } catch (e) {
    labsStatus('mpStatus', 'Erro: ' + e.message, 'error');
    if (bt) bt.disabled = false;
  }
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

/** O ponto (x,y) está dentro do anel (lista de [x,y] já projetados)? */
function mpDentro(pt, anel) {
  let d = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i], [xj, yj] = anel[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d;
  }
  return d;
}

/**
 * Ponto para o círculo da emenda, DENTRO do município: centroide de área do
 * maior anel; se ele cair fora (município côncavo — Diadema, Santarém…), o
 * meio do trecho mais largo da linha horizontal que passa por ele.
 */
function mpCentro(geom, p) {
  let maior = null, area = -1;
  for (const anel of mpAneis(geom)) {
    const q = anel.map(p);
    let a = 0;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) a += (q[j][0] * q[i][1] - q[i][0] * q[j][1]);
    if (Math.abs(a) > area) { area = Math.abs(a); maior = q; }
  }
  if (!maior) return null;
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = maior.length - 1; i < maior.length; j = i++) {
    const f = maior[j][0] * maior[i][1] - maior[i][0] * maior[j][1];
    a2 += f; cx += (maior[j][0] + maior[i][0]) * f; cy += (maior[j][1] + maior[i][1]) * f;
  }
  let c = a2 ? [cx / (3 * a2), cy / (3 * a2)] : maior[0];
  if (mpDentro(c, maior)) return c;
  const xs = [];
  for (let i = 0, j = maior.length - 1; i < maior.length; j = i++) {
    const [xi, yi] = maior[i], [xj, yj] = maior[j];
    if ((yi > c[1]) !== (yj > c[1])) xs.push(xi + (c[1] - yi) * (xj - xi) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let melhor = null;
  for (let k = 0; k + 1 < xs.length; k += 2) if (!melhor || xs[k + 1] - xs[k] > melhor[1] - melhor[0]) melhor = [xs[k], xs[k + 1]];
  return melhor ? [(melhor[0] + melhor[1]) / 2, c[1]] : c;
}

/**
 * Quebras por quantis das fatias positivas (até 5 classes), SEM repetição:
 * com muitos municípios na mesma fatia, quantis repetidos criavam classes
 * vazias e legenda "0%–0%".
 */
function mpQuebras(valores) {
  const v = valores.filter(x => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const q = [0.2, 0.4, 0.6, 0.8].map(k => v[Math.min(v.length - 1, Math.floor(k * v.length))]);
  return [...new Set(q)].filter(x => x < v[v.length - 1]);
}

/** Rótulos da legenda, um por classe de cor (MP_CORES[1..]). */
function mpLegenda(quebras) {
  if (!quebras.length) return [['' + MP_CORES[1], 'com voto']];
  return [...quebras.map((q, i) => [MP_CORES[i + 1], i === 0 ? 'até ' + mpPct(q) : mpPct(quebras[i - 1]) + '–' + mpPct(q)]),
    [MP_CORES[quebras.length + 1], '> ' + mpPct(quebras[quebras.length - 1])]];
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
    const [geo, totais] = await Promise.all([mpMalha(dep.uf), mpFb(`${MP_BASE}/${mpAno()}/municipios/${dep.uf}`)]);
    let emendas;
    try { emendas = await mpComFavorecidos(await mpEmendas(depId, dep, ano), dep, ano); }
    catch (e) { emendas = { erro: e.message }; }
    labsStatus('mpStatus', '');
    mp.modo = 'fatia';
    mpRender(dep, geo, totais || {}, emendas, ano);
  } catch (e) {
    labsStatus('mpStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

/** "+25%", "−40%", ou "novo" quando não houve voto na eleição anterior. */
function mpVarPct(antes, agora) {
  if (!antes) return agora ? 'novo' : '—';
  const p = (agora - antes) / antes;
  return (p > 0 ? '+' : p < 0 ? '−' : '') + mpPct(Math.abs(p));
}

/** Cor do ganho/perda de votos: vermelhos para perda, verdes para ganho, em 3 faixas pelo tamanho relativo. */
function mpCorVar(d, max) {
  if (!d || !max) return MP_CORES[0];
  const f = Math.abs(d) / max, i = f > 0.4 ? 0 : f > 0.12 ? 1 : 2;
  return (d > 0 ? MP_CORES_VAR.ganho : MP_CORES_VAR.perda)[i];
}

function mpRender(dep, geo, totais, emendas, ano) {
  mp.ultimo = { dep, geo, totais, emendas, ano };
  const ANO = mpAno();
  const ant = dep.anterior || null;
  const antMun = (ant && ant.municipios) || {};
  const modoVar = mp.modo === 'variacao' && !!ant;
  const { p, larg, alt } = mpProjetar(geo);
  const votos = dep.municipios || {};
  const fatia = k => { const t = (totais[k] || {}).t; return t ? (votos[k] || 0) / t : 0; };
  const chaves = (geo.features || []).map(f => 'm' + (f.properties && f.properties.codarea));
  const quebras = mpQuebras(chaves.map(fatia));
  const variacao = ant ? lmnVariacao(votos, ant.municipios) : [];
  const dVar = Object.fromEntries(variacao.map(x => [x.k, x.d]));
  // Escala do ganho/perda pelo 95º percentil do |d|: São Paulo sozinha não achata o resto do estado.
  const absVar = variacao.map(x => Math.abs(x.d)).sort((x, y) => x - y);
  const maxVar = absVar.length ? absVar[Math.min(absVar.length - 1, Math.floor(0.95 * absVar.length))] : 0;
  const doEstado = new Set(chaves);
  // Emendas com município: as do estado viram círculo; as de outro estado
  // (o deputado pode destinar para fora) vão para uma lista à parte e não
  // entram na escala dos círculos.
  const munTodos = emendas && emendas.municipais || {};
  const mun = {}, foraUf = {};
  for (const [k, v] of Object.entries(munTodos)) (doEstado.has(k) ? mun : foraUf)[k] = v;
  const nomesEm = emendas && emendas.nomesMun || {};
  const maxEm = Math.max(0, ...Object.values(mun));
  let paths = '', circulos = '';
  for (const f of geo.features || []) {
    const k = 'm' + (f.properties && f.properties.codarea);
    const cor = modoVar ? mpCorVar(dVar[k] || 0, maxVar) : mpCor(fatia(k), quebras);
    paths += `<path d="${mpCaminho(f.geometry, p)}" fill="${cor}" data-k="${k}"></path>`;
    if (mun[k] && maxEm) {
      const c = mpCentro(f.geometry, p);
      if (c) circulos += `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${(3 + 13 * Math.sqrt(mun[k] / maxEm)).toFixed(1)}"></circle>`;
    }
  }
  const legenda = modoVar
    ? `Ganho/perda de votos desde ${labsEsc(ant.ano)}: ${MP_CORES_VAR.perda.map(c => `<i style="background:${c}"></i>`).join('')} perdeu
       <i style="background:${MP_CORES[0]}"></i> igual ${MP_CORES_VAR.ganho.slice().reverse().map(c => `<i style="background:${c}"></i>`).join('')} ganhou
       (tons mais fortes: maior variação)`
    : `Fatia dos votos nominais válidos para deputado federal no município: <i style="background:${MP_CORES[0]}"></i>0 ${mpLegenda(quebras).map(([c, rot]) => `<i style="background:${c}"></i>${rot}`).join(' ')}`;
  const comVoto = Object.entries(votos).filter(([, v]) => v > 0);
  comVoto.sort((a, b) => b[1] - a[1]);
  const nomeMun = k => (totais[k] || {}).n || nomesEm[k] || k;
  const comEmenda = Object.keys(mun);
  const votosOndeTemEmenda = comEmenda.reduce((s, k) => s + (votos[k] || 0), 0);
  const outros = Object.entries(emendas && emendas.outros || {}).sort((a, b) => b[1] - a[1]);

  let blocoEmendas;
  if (!emendas || emendas.semChave) {
    blocoEmendas = '<div class="sub">Sem a chave do Portal da Transparência neste navegador. Cadastre-a em <b>Orçamento → Emendas</b> para ver as emendas pagas.</div>';
  } else if (emendas.erro) {
    blocoEmendas = `<div class="sub">Não foi possível buscar as emendas: ${labsEsc(emendas.erro)}</div>`;
  } else {
    const partes = emendas.restoPago != null ? ` = ${mpReais(emendas.pagoNoAno)} pagos em ${ano} + ${mpReais(emendas.restoPago)} de restos a pagar pagos depois` : '';
    const foraLista = Object.entries(foraUf).sort((a, b) => b[1] - a[1]);
    blocoEmendas = `<div class="sub">Emendas do orçamento de ${ano}, valor pago: <b>${mpReais(emendas.total)}</b>${partes}
      (${mpNum(emendas.n)} registro(s) no Portal)${emendas.aviso ? ' — ' + labsEsc(emendas.aviso) : ''}.</div>
      ${!emendas.n && lmnBancadaDoArquivo(ANO) && !(ant && /^eleito/i.test(ant.situacao || '')) ? `<div class="sub">Sem emendas: se o mandato começa em ${Number(ANO) + 1}, ainda não há emendas deste autor.</div>` : ''}
      ${emendas.deOutroAutor ? `<div class="sub">${mpNum(emendas.deOutroAutor)} registro(s) de outro autor devolvidos pelo Portal foram descartados.</div>` : ''}
      ${comEmenda.length ? `<div class="sub" style="margin-top:6px"><b>Com município identificado</b> (círculos no mapa${emendas.viaFavorecido ? `; ${mpReais(emendas.viaFavorecido)} localizados pelo favorecido` : ''}):</div>
        <div style="max-height:320px;overflow-y:auto"><table class="labs-tab">${comEmenda.sort((a, b) => mun[b] - mun[a]).map(k => `<tr><td>${labsEsc(nomeMun(k))}</td><td style="text-align:right">${mpReais(mun[k])}</td></tr>`).join('')}</table></div>
        ${comEmenda.length > 12 ? `<div class="sub">${mpNum(comEmenda.length)} municípios — role a lista.</div>` : ''}
        <div class="sub" style="margin-top:4px">${mpPct(dep.total ? votosOndeTemEmenda / dep.total : 0)} dos votos do deputado vieram desses municípios.</div>` : ''}
      ${foraLista.length ? `<div class="sub" style="margin-top:6px"><b>Em municípios de outros estados</b> (fora do mapa):</div>
        <table class="labs-tab">${foraLista.map(([k, v]) => `<tr><td>${labsEsc(nomesEm[k] || k)}</td><td style="text-align:right">${mpReais(v)}</td></tr>`).join('')}</table>` : ''}
      ${outros.length ? `<div class="sub" style="margin-top:6px"><b>Sem município${emendas.viaFavorecido != null ? '' : ' no Portal'}</b>:</div>
        <table class="labs-tab">${outros.map(([r, v]) => `<tr><td>${labsEsc(r)}</td><td style="text-align:right">${mpReais(v)}</td></tr>`).join('')}</table>` : ''}
      ${emendas.viaFavorecido != null
        ? `<div class="sub" style="margin-top:6px">A consulta do Portal devolve a maior parte das emendas como “MÚLTIPLO”. O município delas vem do
            <b>favorecido</b> de cada pagamento (prefeitura, fundo municipal, entidade) no arquivo de dados abertos do Portal de ${mpDataArquivo(emendas.favMeta)}.
            <button id="mpFavBaixar" class="btn-mini" title="Baixa de novo o arquivo do Portal (sai uma vez por mês)">atualizar</button></div>`
        : emendas.favPendente
          ? `<div class="sub" style="margin-top:6px">A consulta do Portal devolve a maior parte das emendas como “MÚLTIPLO”, sem o município. O arquivo de dados abertos do
              Portal traz o <b>favorecido</b> de cada pagamento, com o município dele.</div>
              <button id="mpFavBaixar" class="btn-gerar" style="margin-top:6px">📍 Localizar os municípios pelo favorecido</button>
              ${emendas.favMeta ? `<div class="sub">O arquivo processado em ${mpDataArquivo(emendas.favMeta)} não tem este autor neste ano — atualize.</div>` : ''}`
          : ''}`;
  }

  // Comparação com a eleição anterior (só quando ela existe para o deputado).
  const nAnt = LMN_ANTERIOR[ANO];
  let cardAnt = '', blocoVar = '', seletor = '';
  if (ant) {
    const dTot = dep.total - ant.total, pTot = ant.total ? dTot / ant.total : 0;
    cardAnt = `<div class="labs-card"><div class="v">${mpNum(ant.total)}</div><div class="l">votos em ${labsEsc(ant.ano)} (${labsEsc(ant.partido || '?')}) ·
      <b style="color:${dTot >= 0 ? '#7fdca4' : '#e07a6a'}">${dTot >= 0 ? '+' : ''}${mpPct(pTot)}</b></div></div>`;
    const ganhos = variacao.filter(x => x.d > 0).slice(0, 6), perdas = variacao.filter(x => x.d < 0).slice(-6).reverse();
    const linha = x => `<tr><td>${labsEsc(nomeMun(x.k))}</td><td style="text-align:right">${mpNum(x.antes)}</td><td style="text-align:right">${mpNum(x.agora)}</td>
      <td style="text-align:right;color:${x.d > 0 ? '#7fdca4' : '#e07a6a'}">${x.d > 0 ? '+' : ''}${mpNum(x.d)}</td>
      <td style="text-align:right;color:${x.d > 0 ? '#7fdca4' : '#e07a6a'}">${mpVarPct(x.antes, x.agora)}</td></tr>`;
    const cab = `<tr><th>Município</th><th style="text-align:right">${labsEsc(ant.ano)}</th><th style="text-align:right">${ANO}</th><th style="text-align:right">Dif.</th><th style="text-align:right">%</th></tr>`;
    blocoVar = `<div class="labs-caixa"><h3>Desde ${labsEsc(ant.ano)}</h3>
      <div class="sub">Em ${labsEsc(ant.ano)}: ${mpNum(ant.total)} votos pelo ${labsEsc(ant.partido || '?')}${ant.situacao ? ` (${labsEsc(ant.situacao.toLowerCase())})` : ''}.</div>
      <div class="labs-var">
        ${ganhos.length ? `<div><div class="sub" style="margin-top:6px"><b>Onde mais ganhou votos</b></div><table class="labs-tab">${cab}${ganhos.map(linha).join('')}</table></div>` : ''}
        ${perdas.length ? `<div><div class="sub" style="margin-top:6px"><b>Onde mais perdeu votos</b></div><table class="labs-tab">${cab}${perdas.map(linha).join('')}</table></div>` : ''}
      </div></div>`;
    seletor = `Cor do mapa:
      <button class="sm-bt${modoVar ? '' : ' ativo'}" data-mp-modo="fatia">fatia dos votos em ${ANO}</button>
      <button class="sm-bt${modoVar ? ' ativo' : ''}" data-mp-modo="variacao">ganho/perda desde ${labsEsc(ant.ano)}</button>`;
  } else if (nAnt) {
    blocoVar = `<div class="labs-caixa"><h3>Desde ${nAnt}</h3><div class="sub">Não concorreu a deputado federal por ${labsEsc(dep.uf)} em ${nAnt}
      (ou o nome não bate com o arquivo daquela eleição) — sem comparação.</div></div>`;
  }

  mpEl('mpResultado').innerHTML = `
    <div class="labs-cards">
      <div class="labs-card"><div class="v">${mpNum(dep.total)}</div><div class="l">votos em ${ANO}</div></div>
      ${cardAnt}
      <div class="labs-card"><div class="v">${mpNum(comVoto.length)}</div><div class="l">municípios com voto</div></div>
      <div class="labs-card f3"><div class="v">${emendas && emendas.total != null ? mpReais(emendas.total) : '—'}</div><div class="l">emendas de ${ano}: pago (no ano + restos)</div></div>
    </div>
    <div class="labs-mapa-modo">${seletor}
      <button class="sm-bt" id="mpRelatorio" style="margin-left:auto" title="Abre o relatório deste deputado em uma aba; lá, &quot;Salvar em PDF&quot;">⬇ Relatório em PDF</button></div>
    <div class="labs-mapa-wrap">
      <div class="labs-mapa" id="mpMapa">
        <svg viewBox="0 0 ${larg} ${alt}" preserveAspectRatio="xMidYMid meet">${paths}${circulos}</svg>
        <div class="labs-dica-mapa" id="mpDica" hidden></div>
        <div class="labs-legenda">${legenda} · <span style="color:#f0c040">●</span> emenda paga</div>
        ${modoVar ? '' : '<div class="labs-legenda">A fatia é sobre os votos NOMINAIS (sem os votos só na legenda) — sai alguns pontos acima da fatia sobre todos os votos válidos.</div>'}
        ${blocoVar}
      </div>
      <div class="labs-lado">
        <div class="labs-caixa" style="margin-top:0"><h3>Votos por município <span class="base">(${mpNum(comVoto.length)})</span></h3>
          <input type="search" id="mpFiltroMun" class="field" placeholder="Filtrar município" style="margin:4px 0 6px">
          <div class="labs-rolagem"><table class="labs-tab" id="mpTabMun"><thead><tr><th></th><th>Município</th><th style="text-align:right">${ANO}</th><th style="text-align:right" title="Total de votos nominais válidos para deputado federal no município">Total</th><th style="text-align:right" title="Votos do deputado ÷ total do município">Fatia</th>${ant ? `<th style="text-align:right">${labsEsc(ant.ano)}</th><th style="text-align:right">Var.</th>` : ''}</tr></thead><tbody>
          ${comVoto.map(([k, v], i) => `<tr data-k="${k}" data-busca="${labsEsc(lmnNorm(nomeMun(k)))}"><td class="base">${i + 1}</td><td>${labsEsc(nomeMun(k))}</td><td style="text-align:right">${mpNum(v)}</td><td style="text-align:right" class="base">${mpNum((totais[k] || {}).t || 0)}</td><td style="text-align:right">${mpPct(fatia(k))}</td>` +
            (ant ? `<td style="text-align:right">${mpNum(antMun[k] || 0)}</td><td style="text-align:right;color:${v >= (antMun[k] || 0) ? '#7fdca4' : '#e07a6a'}">${mpVarPct(antMun[k] || 0, v)}</td>` : '') + '</tr>').join('')}</tbody></table></div>
          ${dep.foraDoMapa ? `<div class="sub" style="margin-top:4px">${mpNum(dep.foraDoMapa)} voto(s) em municípios sem correspondência no IBGE.</div>` : ''}
        </div>
        <div class="labs-caixa"><h3>Emendas</h3>${blocoEmendas}</div>
      </div>
    </div>
    <div class="labs-custo">Eleito(a) em ${ANO} pelo ${labsEsc(dep.partidoEleicao || '?')} como “${labsEsc(dep.nomeUrna || dep.nome)}”${dep.situacao ? ` (${labsEsc(dep.situacao.toLowerCase())})` : ''}.
      Fontes: TSE (votação por município), IBGE (malhas), Portal da Transparência (emendas).</div>`;

  const tabMun = mpEl('mpTabMun');
  mpEl('mpFiltroMun').addEventListener('input', ev => {
    const q = lmnNorm(ev.target.value);
    for (const tr of tabMun.querySelectorAll('tbody tr')) tr.hidden = !!q && !tr.dataset.busca.includes(q);
  });
  // Passar o mouse numa linha destaca o município no mapa.
  tabMun.addEventListener('mouseover', ev => {
    const tr = ev.target.closest('tr[data-k]');
    for (const x of mpEl('mpMapa').querySelectorAll('path.destaque')) x.classList.remove('destaque');
    const pth = tr && mpEl('mpMapa').querySelector(`path[data-k="${tr.dataset.k}"]`);
    if (pth) { pth.classList.add('destaque'); pth.parentNode.appendChild(pth); }
  });
  tabMun.addEventListener('mouseleave', () => { for (const x of mpEl('mpMapa').querySelectorAll('path.destaque')) x.classList.remove('destaque'); });
  if (typeof mpExportarRelatorio === 'function') mpEl('mpRelatorio').addEventListener('click', mpExportarRelatorio);
  if (mpEl('mpFavBaixar')) mpEl('mpFavBaixar').addEventListener('click', mpFavProcessarClick);
  for (const b of mpEl('mpResultado').querySelectorAll('[data-mp-modo]')) {
    b.addEventListener('click', () => { mp.modo = b.dataset.mpModo; const u = mp.ultimo; mpRender(u.dep, u.geo, u.totais, u.emendas, u.ano); });
  }
  const svg = mpEl('mpMapa').querySelector('svg');
  const dica = mpEl('mpDica');
  svg.addEventListener('mousemove', ev => {
    const k = ev.target && ev.target.dataset && ev.target.dataset.k;
    if (!k) { dica.hidden = true; return; }
    const caixa = mpEl('mpMapa').getBoundingClientRect();
    const d = dVar[k] || 0, cor = d > 0 ? '#7fdca4' : d < 0 ? '#e07a6a' : '#ccc';
    dica.innerHTML = `<b>${labsEsc(nomeMun(k))}</b><br>${ANO}: ${mpNum(votos[k] || 0)} de ${mpNum((totais[k] || {}).t || 0)} votos do município (${mpPct(fatia(k))})` +
      (ant ? `<br>${labsEsc(ant.ano)}: ${mpNum(antMun[k] || 0)} votos<br><b style="color:${cor}">${d > 0 ? '+' : ''}${mpNum(d)} votos (${mpVarPct(antMun[k] || 0, votos[k] || 0)})</b>` : '') +
      (mun[k] ? `<br>Emendas pagas: ${mpReais(mun[k])}` : '');
    dica.style.left = (ev.clientX - caixa.left + 12) + 'px';
    dica.style.top = (ev.clientY - caixa.top + 12) + 'px';
    dica.hidden = false;
  });
  svg.addEventListener('mouseleave', () => { dica.hidden = true; });
}

// ---------- download do TSE com um clique (só os estados da bancada) ----------
// O zip do TSE tem centenas de MB, mas é um arquivo por estado lá dentro. O
// servidor (cdn.tse.jus.br) atende pedidos com Range: lê-se o índice no fim do
// zip (diretório central), e de cada estado só os bytes dele, descompactados
// em fluxo (DecompressionStream 'deflate-raw') e lidos linha a linha.

async function mpFaixa(url, ini, fim) {
  let ultimo;
  for (let t = 0; t < 3; t++) {
    if (t) await labsDormir(1500 * t);
    let r;
    try { r = await fetch(url, { headers: { Range: `bytes=${ini}-${fim}` } }); }
    catch (e) { ultimo = e; continue; }                               // queda de rede: tenta de novo
    if (r.status === 206) return r;
    ultimo = new Error(`o servidor de dados não atendeu o pedido parcial (HTTP ${r.status})`);
    if (r.status < 500 && r.status !== 429) break;                    // 200 (sem Range), 404…: não adianta repetir
  }
  throw ultimo;
}

/** Tamanho total do arquivo remoto, pelo Content-Range de um pedido de 1 byte. */
async function mpTamanhoRemoto(url) {
  const r = await mpFaixa(url, 0, 0);
  const t = Number(String(r.headers.get('content-range') || '').split('/')[1]);
  try { await r.arrayBuffer(); } catch (_) {}
  if (!(t > 0)) throw new Error('o TSE não informou o tamanho do arquivo');
  return t;
}

/**
 * Entradas de um zip: [{ nome, metodo, comprimido, tamanho, offsetLocal }],
 * lendo só o fim do arquivo. `ler(ini, n)` devolve Uint8Array. Suporta ZIP64
 * (o CSV do Brasil inteiro passa de 4 GB). Pura (a leitura vem de fora).
 */
async function mpEntradasZip(total, ler) {
  const nCauda = Math.min(total, 65557);
  const cauda = await ler(total - nCauda, nCauda);
  const dv = new DataView(cauda.buffer, cauda.byteOffset, cauda.byteLength);
  let eocd = -1;
  for (let i = cauda.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('arquivo do TSE não é um zip válido');
  let n = dv.getUint16(eocd + 10, true), tamCd = dv.getUint32(eocd + 12, true), offCd = dv.getUint32(eocd + 16, true);
  if (offCd === 0xffffffff || tamCd === 0xffffffff || n === 0xffff) {
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw new Error('zip64 sem localizador');
    const e64 = await ler(Number(dv.getBigUint64(loc + 8, true)), 56);
    const d64 = new DataView(e64.buffer, e64.byteOffset, e64.byteLength);
    if (d64.getUint32(0, true) !== 0x06064b50) throw new Error('zip64: registro de fim inválido');
    n = Number(d64.getBigUint64(32, true)); tamCd = Number(d64.getBigUint64(40, true)); offCd = Number(d64.getBigUint64(48, true));
  }
  const cd = offCd >= total - nCauda ? cauda.subarray(offCd - (total - nCauda), offCd - (total - nCauda) + tamCd) : await ler(offCd, tamCd);
  const c = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const out = [];
  let p = 0;
  for (let k = 0; k < n && p + 46 <= cd.length; k++) {
    if (c.getUint32(p, true) !== 0x02014b50) throw new Error('índice do zip corrompido');
    const metodo = c.getUint16(p + 10, true);
    let comprimido = c.getUint32(p + 20, true), tamanho = c.getUint32(p + 24, true), offsetLocal = c.getUint32(p + 42, true);
    const nLen = c.getUint16(p + 28, true), xLen = c.getUint16(p + 30, true), cLen = c.getUint16(p + 32, true);
    const nome = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nLen));
    for (let x = p + 46 + nLen, fimX = x + xLen; x + 4 <= fimX;) {
      const id = c.getUint16(x, true), len = c.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (tamanho === 0xffffffff) { tamanho = Number(c.getBigUint64(q, true)); q += 8; }
        if (comprimido === 0xffffffff) { comprimido = Number(c.getBigUint64(q, true)); q += 8; }
        if (offsetLocal === 0xffffffff) { offsetLocal = Number(c.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + len;
    }
    out.push({ nome, metodo, comprimido, tamanho, offsetLocal });
    p += 46 + nLen + xLen + cLen;
  }
  return out;
}

/** UF da entrada "…_munzona_2026_SP.csv" (null para BRASIL, BR, leia-me). */
function mpUfDaEntrada(nome) {
  const m = String(nome).match(/_([A-Z]{2})\.(csv|txt)$/i);
  return m && m[1].toUpperCase() !== 'BR' ? m[1].toUpperCase() : null;
}

// Blocos do download: 8 MB, cada um com até 3 tentativas — numa queda de rede
// perde-se um bloco, não os ~100 MB de um estado grande.
const MP_BLOCO = 8 * 1024 * 1024;

/** Os bytes [ini, fim] do arquivo remoto como fluxo, pedidos em blocos com nova tentativa. */
function mpFluxoRemoto(url, ini, fim, aoReceber) {
  let pos = ini;
  return new ReadableStream({
    async pull(c) {
      if (pos > fim) { c.close(); return; }
      const ate = Math.min(fim, pos + MP_BLOCO - 1);
      let erro = null;
      for (let t = 0; t < 3; t++) {
        if (t) await labsDormir(1500 * t);
        try {
          const b = new Uint8Array(await (await mpFaixa(url, pos, ate)).arrayBuffer());
          if (b.length !== ate - pos + 1) throw new Error('bloco incompleto');
          pos = ate + 1;
          if (aoReceber) aoReceber(b.length);
          c.enqueue(b);
          return;
        } catch (e) { erro = e; }
      }
      c.error(new Error('download do TSE interrompido: ' + erro.message));
    },
  });
}

/** Lê uma entrada do zip remoto linha a linha. aoAndar(bytesComprimidosLidos). */
async function mpLerEntradaRemota(url, e, aoLer, aoAndar) {
  const cab = new Uint8Array(await (await mpFaixa(url, e.offsetLocal, e.offsetLocal + 29)).arrayBuffer());
  const dv = new DataView(cab.buffer);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error(`cabeçalho inválido em ${e.nome}`);
  if (!e.comprimido) return;
  const ini = e.offsetLocal + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  let lidos = 0;
  let fluxo = mpFluxoRemoto(url, ini, ini + e.comprimido - 1, n => { lidos += n; if (aoAndar) aoAndar(lidos); });
  if (e.metodo === 8) fluxo = fluxo.pipeThrough(new DecompressionStream('deflate-raw'));
  else if (e.metodo !== 0) throw new Error(`compressão ${e.metodo} não suportada em ${e.nome}`);
  const dec = new TextDecoder('latin1');
  const lin = lmnLinhas(aoLer);
  const leitor = fluxo.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lin.empurrar(dec.decode(value, { stream: true }));
  }
  lin.empurrar(dec.decode());
  lin.fim();
}

/** Índice do zip do TSE de uma eleição, só com as entradas dos estados pedidos. */
async function mpIndiceTse(ano, ufs) {
  const url = MP_TSE_ZIP(ano);
  const total = await mpTamanhoRemoto(url);
  const todas = await mpEntradasZip(total, async (ini, n) => new Uint8Array(await (await mpFaixa(url, ini, ini + n - 1)).arrayBuffer()));
  const quero = new Set(ufs);
  return { url, ano, entradas: todas.filter(e => quero.has(mpUfDaEntrada(e.nome))) };
}

/**
 * Estados com eleito do partido na eleição, pelo painel de resultados do TSE
 * (resultados.tse.jus.br — poucos KB por estado, o mesmo da aba Apuração).
 * Serve para baixar só esses estados do zip; quem é eleito sai do próprio zip.
 */
async function mpUfsComEleitos(ano) {
  const ops = apEleicoesGerais(await labsJson(`${AP_BASE}/comum/config/ele-c.json`));
  const op = ops.find(o => String(o.ano) === String(ano) && o.turno === 1 && o.cargos[6]);
  if (!op) throw new Error(`o TSE não lista a eleição de ${ano} na divulgação de resultados`);
  const ufs = Object.keys(AP_UFS);
  const lidos = await labsMapLimit(ufs, 6, async uf => apLerUFTodos(await labsJson(apUrl(uf, op.cargos[6].eleicao, 6, op.ciclo)), uf));
  // Estado que não respondeu entra por precaução: quem é eleito sai do zip, então
  // o resultado não muda — só baixa um estado a mais. Nenhum respondeu: erro.
  if (lidos.every(d => !d)) throw new Error('o painel de resultados do TSE não respondeu — tente de novo em instantes');
  // Também entra a UF com a totalização reaberta (o TSE zera as vagas e as
  // marcações enquanto retotaliza — PE em 06/10/2026) se o partido tem candidato.
  const doPartido = c => c.partido === MP_PARTIDO.sigla;
  return ufs.filter((uf, i) => !lidos[i] || lidos[i].candidatos.some(c => doPartido(c) && (c.eleito || c.projetado))
    || (!lidos[i].final && lidos[i].candidatos.some(doPartido))).map(u => u.toUpperCase());
}

async function mpBaixarTseClick() {
  const bt = mpEl('mpBaixarTse');
  const ano = mpAno();
  const anoAnt = mpEl('mpComparar') && mpEl('mpComparar').checked ? LMN_ANTERIOR[ano] : null;
  bt.disabled = true;
  mpEl('mpUpResultado').innerHTML = '';
  const st = m => labsStatus('mpUpStatus', m, 'loading');
  try {
    let alvos = [], ufs;
    if (lmnBancadaDoArquivo(ano)) {
      st(`Conferindo no TSE os estados com eleitos do ${MP_PARTIDO.sigla} em ${ano}…`);
      ufs = await mpUfsComEleitos(ano);
    } else {
      st('Buscando a bancada na Câmara…');
      alvos = await mpBancada();
      ufs = [...new Set(alvos.map(a => a.uf))];
    }
    if (!ufs.length) throw new Error('nenhum estado a processar');
    st('Lendo o índice dos arquivos do TSE…');
    const indices = [await mpIndiceTse(ano, ufs)];
    if (anoAnt) indices.push(await mpIndiceTse(anoAnt, ufs));
    const mb = indices.reduce((s, ix) => s + ix.entradas.reduce((t, e) => t + e.comprimido, 0), 0) / 1e6;
    const falta = ufs.filter(u => !indices[0].entradas.some(e => mpUfDaEntrada(e.nome) === u));
    if (falta.length) throw new Error(`o arquivo do TSE de ${ano} não tem os estados ${falta.join(', ')}`);
    labsStatus('mpUpStatus', '');
    if (!confirm(`Baixar ${mb.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MB do TSE — votação de ${ano}${anoAnt ? ` e de ${anoAnt} (comparação)` : ''}, só dos estados ${ufs.sort().join(', ')}?\n\nO processamento roda aqui; nada é gravado antes da sua confirmação.`)) return;

    let feitoMb = 0;
    const ler = async (ix, ag) => {
      for (let i = 0; i < ix.entradas.length; i++) {
        const e = ix.entradas[i];
        ag.novoArquivo();
        await mpLerEntradaRemota(ix.url, e, l => ag.linha(l), lidos =>
          st(`Baixando e lendo ${ix.ano} · ${labsEsc(mpUfDaEntrada(e.nome))} (${i + 1}/${ix.entradas.length}) — ${(feitoMb + lidos / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} de ${mb.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MB`));
        feitoMb += e.comprimido / 1e6;
      }
      return ag.resultado();
    };
    const res = await ler(indices[0], lmnAgregador(alvos, lmnBancadaDoArquivo(ano) ? { eleitosDoPartido: MP_PARTIDO.sigla } : {}));
    st('Casando os municípios do TSE com os do IBGE…');
    const reg = await mpParaIbge(res);
    let anterior = null;
    if (anoAnt) {
      const resA = await ler(indices[1], lmnAgregador(lmnAlvosAnterior(res.deputados)));
      lmnAnexarAnterior(reg, await mpParaIbge(resA), anoAnt);
      anterior = { ano: anoAnt, naoEncontrados: resA.naoEncontrados };
    }
    mp.processado = { ano, reg, res, anterior, origem: 'extensão (TSE, 1 clique)' };
    labsStatus('mpUpStatus', '');
    mpRenderProcessado();
  } catch (e) {
    labsStatus('mpUpStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

async function mpParaIbge(res) {
  const ibgePorUf = {};
  for (const uf of res.ufs) ibgePorUf[uf] = await mpIbgeUf(uf);
  return lmnParaIbge(res, ibgePorUf);
}

// ---------- processamento manual dos CSV do TSE ----------
/** Deputados do PODE em exercício, com nome civil (para casar com o TSE). */
async function mpBancada() {
  const j = await labsJson(`${LABS_API}/deputados?siglaPartido=${MP_PARTIDO.sigla}&ordem=ASC&ordenarPor=nome&itens=100`);
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
    // Um arquivo por eleição: arquivos de anos diferentes seriam SOMADOS. E só
    // a eleição escolhida na tela — outra iria para um lugar que ninguém lê.
    const ano = mpAno();
    const anos = [...new Set(arquivos.map(a => (a.name.match(/munzona_(\d{4})/) || [])[1]).filter(Boolean))];
    if (anos.length > 1) throw new Error(`Os arquivos são de eleições diferentes (${anos.join(', ')}). Escolha só os de ${ano}.`);
    if (anos.length && anos[0] !== ano) throw new Error(`Arquivo da eleição de ${anos[0]}; a tela está na de ${ano}. Troque a eleição acima ou baixe o arquivo de ${ano}.`);
    let alvos = [];
    if (!lmnBancadaDoArquivo(ano)) {
      labsStatus('mpUpStatus', 'Buscando a bancada na Câmara…', 'loading');
      alvos = await mpBancada();
    }
    const ag = lmnAgregador(alvos, lmnBancadaDoArquivo(ano) ? { eleitosDoPartido: MP_PARTIDO.sigla } : {});
    for (let i = 0; i < arquivos.length; i++) {
      const a = arquivos[i];
      ag.novoArquivo();
      await mpLerArquivo(a, l => ag.linha(l), (f, t) =>
        labsStatus('mpUpStatus', `Lendo ${labsEsc(a.name)} (${i + 1}/${arquivos.length})… ${Math.round(f / t * 100)}%`, 'loading'));
    }
    const res = ag.resultado();
    labsStatus('mpUpStatus', 'Casando os municípios do TSE com os do IBGE…', 'loading');
    const reg = await mpParaIbge(res);
    mp.processado = { ano, reg, res, anterior: null, origem: 'extensão (manual)' };
    labsStatus('mpUpStatus', '');
    mpRenderProcessado();
  } catch (e) {
    labsStatus('mpUpStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

function mpRenderProcessado() {
  const { ano, reg, res, anterior } = mp.processado;
  const deps = Object.entries(reg.deputados).sort((a, b) => b[1].total - a[1].total);
  const nao = res.naoEncontrados;
  const colAnt = anterior ? `<th style="text-align:right">${labsEsc(anterior.ano)}</th>` : '';
  const celAnt = d => anterior ? `<td style="text-align:right">${d.anterior ? `${mpNum(d.anterior.total)} <span class="base">(${labsEsc(d.anterior.partido)})</span>` : '<span class="base">não concorreu</span>'}</td>` : '';
  mpEl('mpUpResultado').innerHTML = `
    <div class="sub" style="margin-top:8px">Eleição de <b>${labsEsc(ano)}</b> · estados lidos: ${labsEsc(res.ufs.join(', ') || '—')} · ${mpNum(res.linhas)} linhas de deputado federal
      · <b>${deps.length}</b> deputado(s)${lmnBancadaDoArquivo(ano) ? ` eleito(s) pelo ${MP_PARTIDO.sigla}` : ''}${anterior ? ` · ${deps.filter(([, d]) => d.anterior).length} com votação em ${labsEsc(anterior.ano)}` : ''}.</div>
    ${deps.length ? `<table class="labs-tab" style="margin-top:6px"><tr><th>Deputado(a)</th><th>UF</th><th style="text-align:right">Votos</th><th style="text-align:right">Municípios</th>${colAnt}</tr>
      ${deps.map(([, d]) => `<tr><td>${labsEsc(d.nome)} <span class="base">(urna: ${labsEsc(d.nomeUrna)}, ${labsEsc(d.partidoEleicao)}${d.situacao ? ', ' + labsEsc(d.situacao.toLowerCase()) : ''})</span></td><td>${labsEsc(d.uf)}</td><td style="text-align:right">${mpNum(d.total)}</td><td style="text-align:right">${mpNum(Object.keys(d.municipios).length)}</td>${celAnt(d)}</tr>`).join('')}</table>` : ''}
    ${nao.length ? `<div class="sub" style="margin-top:6px"><b>Não encontrados</b> (não serão gravados): ${nao.map(n => `${labsEsc(n.nome)} (${labsEsc(n.uf)}: ${labsEsc(n.motivo)})`).join('; ')}.</div>` : ''}
    ${reg.semPar.length ? `<div class="sub" style="margin-top:4px">${reg.semPar.length} município(s) do TSE sem correspondência no IBGE: ${reg.semPar.slice(0, 8).map(m => labsEsc(m.n + '/' + m.uf)).join(', ')}${reg.semPar.length > 8 ? '…' : ''}</div>` : ''}
    ${deps.length ? `<button id="mpGravar" class="btn-gerar" style="margin-top:8px">Gravar no banco de dados</button>` : ''}`;
  const g = mpEl('mpGravar');
  if (g) g.addEventListener('click', mpGravarClick);
}

async function mpGravarClick() {
  const { ano, reg, res, origem } = mp.processado;
  const n = Object.keys(reg.deputados).length;
  if (!confirm(`Gravar no banco compartilhado os votos de ${ano} de ${n} deputado(s) (${res.ufs.join(', ')})? Substitui o que houver para esses deputados e estados.`)) return;
  const bt = mpEl('mpGravar');
  bt.disabled = true;
  try {
    labsStatus('mpUpStatus', 'Gravando…', 'loading');
    const base = `${MP_BASE}/${ano}`;
    const metaAntiga = await mpFb(`${base}/meta`);   // falha aqui aborta: sem ela, a lista de estados seria perdida
    await mpFbEscrever('PATCH', base, lmnAtualizacao(reg, res, metaAntiga, origem || 'extensão (manual)'));
    labsStatus('mpUpStatus', `Gravado: ${n} deputado(s).`);
    mp.processado = null;
    mpEl('mpUpResultado').innerHTML = '';
    await mpCarregar();
  } catch (e) {
    labsStatus('mpUpStatus', 'Não gravou: ' + e.message, 'error');
    bt.disabled = false;
  }
}

/** Eleição escolhida: atualiza o link do arquivo, a opção de comparação e recarrega a lista. */
function mpTrocarEleicao() {
  const ano = mpAno();
  const link = mpEl('mpLinkZip');
  if (link) { link.href = MP_TSE_ZIP(ano); link.textContent = `votacao_candidato_munzona_${ano}.zip`; }
  for (const el of document.querySelectorAll('[data-mp-ano]')) el.textContent = ano;
  const cmp = mpEl('mpCompararLinha');
  if (cmp) { cmp.hidden = !LMN_ANTERIOR[ano]; const t = mpEl('mpCompararAno'); if (t) t.textContent = LMN_ANTERIOR[ano] || ''; }
  mpEl('mpResultado').innerHTML = '';
  mp.processado = null;
  mpEl('mpUpResultado').innerHTML = '';
  mpCarregar();
}

if (mpEl('mpMostrar')) {
  mpPreencherAnos();
  const selE = mpEl('mpEleicao');
  if (selE) {
    selE.innerHTML = LMN_ANOS.map(a => `<option value="${a}">${a}</option>`).join('');
    selE.addEventListener('change', mpTrocarEleicao);
  }
  mpEl('mpMostrar').addEventListener('click', mpMostrarClick);
  mpEl('mpArquivos').addEventListener('change', () => { mpEl('mpProcessar').disabled = !mpEl('mpArquivos').files.length; });
  mpEl('mpProcessar').addEventListener('click', mpProcessarClick);
  if (mpEl('mpBaixarTse')) mpEl('mpBaixarTse').addEventListener('click', mpBaixarTseClick);
  let carregou = false;
  document.addEventListener('labs:aba', ev => {
    if (ev.detail === 'aba-mapa' && !carregou) { carregou = true; mpTrocarEleicao(); }
  });
}
