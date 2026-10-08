'use strict';
// Relatórios · Sistemas eleitorais — a tela (só na extensão). Lê os votos
// oficiais do TSE — servidor de resultados na eleição corrente; dados abertos
// nos anos que ele já não guarda — roda os sistemas do núcleo
// (../sistemas-nucleo.js) e mostra a comparação: hemiciclos, bancadas por
// partido, o Podemos, estado a estado. PDF pela impressão (#siImpressao).
// Usa de ../labs-apuracao.js: AP_BASE, AP_UFS, apUrl, apEleicoesGerais, apEleicaoReserva;
// de ../zip-remoto.js: zrJson, zrIndice, zrFaixa, zrUfDaEntrada, zrLerEntradaRemota.

const SI_PARTIDO = 'PODE';
const SI_COR_PODE = '#00a859', SI_COR_OUTROS = '#5b6b7b';
// Paleta neutra por tamanho de bancada (sem cor "ideológica"); o Podemos fica no verde da marca.
// Sem verdes: o verde é do Podemos.
const SI_PALETA = ['#3b82f6', '#ef4444', '#f59e0b', '#a855f7', '#22d3ee', '#ec4899', '#b45309', '#fda4af', '#6366f1', '#fde047', '#93c5fd', '#d8b4fe'];
const SI_NOMES = { proporcional: 'Proporcional', distritao: 'Distritão', misto: 'Distritão misto' };
const SI_CURTOS = { proporcional: 'Prop.', distritao: 'Distritão', misto: 'Misto' };
const SI_GRANDE = 150 * 1024 * 1024;   // acima disto, a leitura dos dados abertos pede confirmação

const si = { eleicoes: [], cargo: '6', op: null, dados: null, conjunto: null, res: null, sistemas: null, ufSel: '', lendo: false, tempo: null };
const $ = id => document.getElementById(id);
const siEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siFmt = n => Number(n || 0).toLocaleString('pt-BR');
const siPct = x => (Math.round(x * 1000) / 10).toLocaleString('pt-BR') + '%';
const siMb = b => (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' MB';
const siUfNome = uf => AP_UFS[uf] || uf.toUpperCase();
const siCargoNome = () => si.cargo === '6' ? 'Deputado federal' : 'Deputado estadual e distrital';

// ------------------------------------------------------------ parâmetros
function siNumero(id, padrao) {
  const v = parseFloat(String($(id).value).replace(',', '.'));
  return isNaN(v) ? padrao : Math.min(100, Math.max(0, v));
}
function siSistemas() {
  const modelo = ($('mModelo').querySelector('.ativo') || {}).dataset || {};
  return [
    { id: 'proporcional', nome: SI_NOMES.proporcional, tipo: 'proporcional', op: {
      pctQP: siNumero('pQP', 10) / 100, pctPartido: siNumero('pPart', 80) / 100, pctCandidato: siNumero('pCand', 20) / 100,
      terceiraFaseAberta: $('pTerc').checked, federacoes: $('pFed').checked } },
    { id: 'distritao', nome: SI_NOMES.distritao, tipo: 'distritao', op: {} },
    { id: 'misto', nome: SI_NOMES.misto, tipo: 'misto', op: {
      pctMaisVotados: siNumero('mPct', 50) / 100, modelo: modelo.m || 'paralelo', limiar: siNumero('mLim', 0) / 100 } },
  ];
}
function siAlterado(s) {
  const o = s.op;
  if (s.tipo === 'proporcional') return o.pctQP !== 0.1 || o.pctPartido !== 0.8 || o.pctCandidato !== 0.2 || !o.terceiraFaseAberta || !o.federacoes;
  if (s.tipo === 'misto') return o.pctMaisVotados !== 0.5 || o.modelo !== 'paralelo' || o.limiar !== 0;
  return false;
}
function siDescricao(s, curta) {
  const o = s.op;
  if (s.tipo === 'proporcional') {
    if (curta) return siAlterado(s) ? 'parâmetros alterados' : 'regra vigente';
    return siAlterado(s) ? `QP com candidato de ${siPct(o.pctQP)} do QE; sobras com agremiação de ${siPct(o.pctPartido)} e candidato de ${siPct(o.pctCandidato)}; `
      + `3ª fase ${o.terceiraFaseAberta ? 'aberta a todas' : 'só com as de ' + siPct(o.pctPartido)}; ${o.federacoes ? 'com' : 'sem'} federações` : 'regra vigente (10% · 80/20 · 3ª fase aberta · federações)';
  }
  if (s.tipo === 'misto') {
    return `${siPct(o.pctMaisVotados)} mais votados · ${siPct(1 - o.pctMaisVotados)} lista, ${o.modelo === 'compensatorio' ? 'compensatório' : 'paralelo'}`
      + (o.limiar ? ` · cláusula de ${siPct(o.limiar)}${curta ? '' : ' para a lista'}` : '');
  }
  return 'os mais votados de cada estado';
}
function siMarcarAlterados() {
  const ss = siSistemas();
  $('siAltP').hidden = !siAlterado(ss[0]);
  $('siAltM').hidden = !siAlterado(ss[2]);
  $('mPctV').textContent = siPct(ss[2].op.pctMaisVotados);
  $('mPctL').textContent = siPct(1 - ss[2].op.pctMaisVotados);
}
function siRegraVigente() {
  $('pQP').value = 10; $('pPart').value = 80; $('pCand').value = 20; $('pTerc').checked = true; $('pFed').checked = true;
  $('mPct').value = 50; $('mLim').value = 0;
  for (const b of $('mModelo').querySelectorAll('button')) b.classList.toggle('ativo', b.dataset.m === 'paralelo');
  siParametrosMudaram();
}
function siParametrosMudaram() {
  siMarcarAlterados();
  clearTimeout(si.tempo);
  si.tempo = setTimeout(siSimular, 120);
}

// ------------------------------------------------------------ leitura do TSE
function siStatus(html) { $('siStatus').innerHTML = html; }
function siProgresso(txt, f) {
  siStatus(`${siEsc(txt)}<div class="barra"><i style="width:${Math.max(0, Math.min(100, Math.round(f * 100)))}%"></i></div>`);
}

/** Eleição corrente: um JSON por estado, do servidor oficial de resultados. */
async function siLerResultados(op, cargo, ufs) {
  const out = {};
  let feitos = 0, i = 0;
  siProgresso('Lendo o servidor de resultados do TSE…', 0);
  const trabalhador = async () => {
    while (i < ufs.length) {
      const uf = ufs[i++];
      const cg = cargo === '6' ? 6 : uf === 'df' ? 8 : 7;
      out[uf] = snLerUF(await zrJson(apUrl(uf, op.eleicao[cg], cg, op.ciclo)), uf);
      siProgresso(`Lendo o servidor de resultados do TSE: ${++feitos} de ${ufs.length} ${ufs.length === 1 ? 'estado' : 'estados'}`, feitos / ufs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ufs.length) }, trabalhador));
  return out;
}

// Guarda da leitura dos dados abertos (IndexedDB), por ano e UF, valendo só para
// a mesma versão dos dois arquivos do TSE (ETag/Last-Modified/tamanho): se o TSE
// regravar o arquivo, a leitura é refeita.
function siBanco() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('sispode-sistemas', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('abertos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}
async function siGuardadoLer(chave) {
  try {
    const db = await siBanco();
    return await new Promise(ok => { const q = db.transaction('abertos').objectStore('abertos').get(chave); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); });
  } catch (_) { return null; }
}
async function siGuardadoGravar(chave, valor) {
  try {
    const db = await siBanco();
    await new Promise(ok => { const t = db.transaction('abertos', 'readwrite'); t.objectStore('abertos').put(valor, chave); t.oncomplete = ok; t.onerror = ok; t.onabort = ok; });
  } catch (_) { /* sem guarda: a próxima abertura lê de novo */ }
}
async function siVersao(url) {
  const r = await zrFaixa(url, 0, 0);
  return [r.headers.get('etag'), r.headers.get('last-modified'), r.headers.get('content-range')].filter(Boolean).join(' ') || '?';
}
function siConfirmar(ano, total) {
  return new Promise(ok => {
    siStatus('');
    $('siAvisos').innerHTML = `<div class="aviso"><b>Leitura grande.</b> Os votos de ${ano} vêm dos arquivos de dados abertos do TSE (votação por candidato e por partido, por município e zona):
      cerca de <b>${siMb(total)}</b> a baixar, uma vez — a leitura fica guardada neste navegador enquanto o arquivo do TSE for o mesmo. Um estado só é bem menos.
      <div style="margin-top:6px"><button class="pri" id="siSim">Ler agora</button> <button id="siNao">Cancelar</button></div></div>`;
    $('siSim').onclick = () => { $('siAvisos').innerHTML = ''; ok(true); };
    $('siNao').onclick = () => { $('siAvisos').innerHTML = ''; ok(false); };
  });
}

/** Anos fora do servidor de resultados: os dois zips de dados abertos, só as entradas das UFs pedidas, numa leitura para os dois cargos. */
async function siLerAbertos(ano, cargo, ufs) {
  const urls = snUrlsAbertos(ano);
  siProgresso(`Abrindo os arquivos de dados abertos do TSE de ${ano}…`, 0);
  const [vc, vp] = await Promise.all([siVersao(urls.candidato), siVersao(urls.partido)]);
  const versao = vc + ' | ' + vp;
  const out = {}, faltam = [];
  for (const uf of ufs) {
    const g = await siGuardadoLer(`${ano}|${uf}`);
    if (g && g.versao === versao && g.dados && g.dados.federal && g.dados.estadual) out[uf] = g.dados; else faltam.push(uf);
  }
  if (faltam.length) {
    const [ic, ip] = await Promise.all([zrIndice(urls.candidato), zrIndice(urls.partido)]);
    const entrada = (idx, uf) => idx.entradas.find(e => (zrUfDaEntrada(e.nome) || '').toLowerCase() === uf);
    const tarefas = faltam.map(uf => ({ uf, c: entrada(ic, uf), p: entrada(ip, uf) }));
    const sem = tarefas.filter(t => !t.c || !t.p).map(t => t.uf.toUpperCase());
    if (sem.length) throw new Error(`os arquivos de ${ano} do TSE não trazem ${sem.join(', ')}`);
    const total = tarefas.reduce((s, t) => s + t.c.comprimido + t.p.comprimido, 0);
    if (total > SI_GRANDE && !(await siConfirmar(ano, total))) return null;
    let base = 0;
    for (const t of tarefas) {
      const L = snLeitorDadosAbertos(['6', '7', '8']);
      const andar = n => siProgresso(`Lendo os dados abertos do TSE de ${ano}: ${siUfNome(t.uf)} — ${siMb(base + n)} de ${siMb(total)}`, (base + n) / total);
      await zrLerEntradaRemota(urls.candidato, t.c, L.candidato.linha, andar);
      base += t.c.comprimido;
      await zrLerEntradaRemota(urls.partido, t.p, L.partido.linha, andar);
      base += t.p.comprimido;
      const dados = { federal: L.resultado({}, '6')[t.uf], estadual: L.resultado({}, t.uf === 'df' ? '8' : '7')[t.uf] };
      if (!dados.federal || !dados.estadual) throw new Error(`o arquivo do TSE de ${ano} veio sem os deputados de ${t.uf.toUpperCase()}`);
      out[t.uf] = dados;
      await siGuardadoGravar(`${ano}|${t.uf}`, { versao, dados, lidoEm: Date.now() });
    }
  }
  return Object.fromEntries(ufs.map(uf => [uf, cargo === '6' ? out[uf].federal : out[uf].estadual]));
}

async function siLer(forcar) {
  if (si.lendo) return;
  const op = si.eleicoes.find(o => o.id === $('siEleicao').value);
  if (!op) return;
  const ufSel = $('siUf').value;
  const ufs = ufSel ? [ufSel] : Object.keys(AP_UFS);
  // Mesmo conjunto já lido (só mudou a abrangência para uma UF dele): recorta, sem ler de novo.
  if (!forcar && si.dados && si.conjunto && si.conjunto.op === op.id && si.conjunto.cargo === si.cargo && ufs.every(uf => si.conjunto.dados[uf])) {
    si.dados = Object.fromEntries(ufs.map(uf => [uf, si.conjunto.dados[uf]]));
    si.ufSel = ufSel;
    siSimular();
    return;
  }
  siTravar(true);
  $('siPdf').disabled = true; $('siAvisos').innerHTML = '';
  try {
    const dados = op.fonte === 'resultados' ? await siLerResultados(op, si.cargo, ufs) : await siLerAbertos(op.ano, si.cargo, ufs);
    if (!dados) { siStatus(si.res ? siResumoStatus() : ''); return; }
    si.op = op; si.dados = dados; si.ufSel = ufSel;
    si.conjunto = { op: op.id, cargo: si.cargo, dados };
    siSimular();
  } catch (e) {
    siStatus('');
    $('siAvisos').innerHTML = `<div class="aviso erro"><b>Não foi possível ler o TSE.</b> ${siEsc(e && e.message || e)} — tente de novo em instantes (o servidor do TSE recusa pedidos de vez em quando).</div>`;
  } finally {
    siTravar(false);
  }
}

/** Durante a leitura, a escolha (eleição, cargo, abrangência) fica parada: a tela mostra o que foi pedido. */
function siTravar(sim) {
  si.lendo = sim;
  for (const el of [$('siLer'), $('siEleicao'), $('siUf'), ...$('siCargo').querySelectorAll('button')]) el.disabled = sim;
}

// ------------------------------------------------------------ simulação e tela
function siSimular() {
  if (!si.dados) return;
  si.sistemas = siSistemas();
  si.res = snSimular(si.dados, si.sistemas);
  si.res.vagas = si.res.comparadas.reduce((s, uf) => s + si.dados[uf].vagas, 0);
  if (si.ufSel && !si.dados[si.ufSel]) si.ufSel = '';
  siStatus(siResumoStatus());
  $('siAvisos').innerHTML = siAvisosHtml();
  $('siResultado').innerHTML = siRelatorioHtml(false);
  $('siPdf').disabled = false;
}

function siResumoStatus() {
  const ufs = Object.keys(si.dados || {});
  const atual = ufs.map(uf => si.dados[uf].atualizado).filter(Boolean).sort((a, b) => siData(b) - siData(a))[0];
  return `<b>${si.op.ano}</b> · ${siCargoNome()} · ${ufs.length === 1 ? siUfNome(ufs[0]) : ufs.length + ' estados'} · ${siFmt(si.res.vagas)} vagas · `
    + (si.op.fonte === 'resultados' ? `servidor de resultados do TSE${atual ? ' (divulgação de ' + siEsc(atual) + ')' : ''}` : 'dados abertos do TSE');
}
function siData(s) { const m = /(\d+)\/(\d+)\/(\d+)\s*(\d+)?:?(\d+)?:?(\d+)?/.exec(s || ''); return m ? new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() : 0; }

function siAvisosHtml() {
  const ufs = Object.keys(si.dados);
  const ret = ufs.filter(uf => snSituacao(si.dados[uf]) === 'retotalizando'), par = ufs.filter(uf => snSituacao(si.dados[uf]) === 'parcial' && !ret.includes(uf));
  const sem = si.res.real.semReal.filter(uf => !ret.includes(uf) && !par.includes(uf));
  const lista = l => l.map(uf => uf.toUpperCase()).join(', ');
  let h = '';
  if (ret.length) h += `<div class="aviso"><b>Em retotalização: ${lista(ret)}.</b> O TSE reabriu a totalização e ainda não marcou os eleitos; `
    + `a simulação usa os votos publicados, mas ${ret.length === 1 ? 'o estado fica' : 'os estados ficam'} fora da comparação nacional até a conclusão.</div>`;
  if (par.length) h += `<div class="aviso"><b>Apuração em andamento: ${lista(par)}.</b> Os votos ainda vão mudar; ${si.res.real.semReal.length === ufs.length ? 'sem eleitos marcados, a comparação com o oficial fica para o fim da apuração' : 'sem o resultado final, a comparação é parcial'}.</div>`;
  if (sem.length) h += `<div class="aviso"><b>Sem eleitos marcados pelo TSE: ${lista(sem)}.</b> Fora da comparação nacional.</div>`;
  return h;
}

/** Cores dos partidos: Podemos no verde; os demais pela ordem da bancada, até a paleta acabar. */
function siCores(ordem) {
  const cores = {};
  let i = 0;
  for (const sg of ordem) cores[sg] = sg === SI_PARTIDO ? SI_COR_PODE : (SI_PALETA[i++] || SI_COR_OUTROS);
  return cores;
}

function siHemicicloSvg(porPartido, ordem, cores, vagas) {
  const h = snHemiciclo(vagas);
  const R = 96, cx = 100, cy = 101;
  const pts = h.pontos, raio = (h.r * R).toFixed(2);
  let i = 0, out = '';
  const bola = (p, cor, titulo, cls) => `<circle${cls ? ` class="${cls}"` : ''} cx="${(cx + p.x * R).toFixed(1)}" cy="${(cy - p.y * R).toFixed(1)}" r="${raio}" fill="${cor}"><title>${siEsc(titulo)}</title></circle>`;
  for (const sg of ordem) for (let k = 0; k < (porPartido[sg] || 0) && i < pts.length; k++) out += bola(pts[i++], cores[sg], `${sg}: ${porPartido[sg]}`);
  while (i < pts.length) out += bola(pts[i++], '#2a3a4a', 'vaga sem eleito marcado', 'vazio');
  return `<svg viewBox="0 0 200 104" role="img">${out}</svg>`;
}

function siDelta(n, ref) {
  const d = n - ref;
  return d > 0 ? `<span class="mais">+${d}</span>` : d < 0 ? `<span class="menos">−${-d}</span>` : '<span class="igual">=</span>';
}
function siTrocas(sim, ufs) { return ufs.reduce((s, uf) => s + ((sim.porUf[uf] || {}).entram || []).length, 0); }

function siRelatorioHtml(impressao) {
  const res = si.res, ordem = snOrdemPartidos(res), cores = siCores(ordem), comp = res.comparadas;
  const temReal = res.real.total > 0;
  const real = res.real.porPartido, pode = x => (x.porPartido[SI_PARTIDO] || 0);
  const umaUf = Object.keys(si.dados).length === 1;
  let h = '';
  // Podemos em cada sistema
  h += `<h2>Bancada do Podemos <small>${umaUf ? siUfNome(Object.keys(si.dados)[0]) : 'no país'}${comp.length < Object.keys(si.dados).length ? ' · ' + comp.length + ' estados comparáveis' : ''}</small></h2><div class="cards">`;
  h += `<div class="card"><div class="t">Resultado oficial</div><div class="v">${temReal ? pode(res.real) : '—'}</div><div class="l">${temReal ? 'eleitos marcados pelo TSE' : 'sem eleitos marcados ainda'}</div></div>`;
  for (const s of res.sims) {
    h += `<div class="card"><div class="t">${siEsc(s.nome)}</div><div class="v">${pode(s)}</div><div class="d">${temReal ? siDelta(pode(s), pode(res.real)) + ' <span class="igual">vs. oficial</span>' : '&nbsp;'}</div>`
      + `<div class="l">${temReal ? siFmt(siTrocas(s, comp)) + ' cadeira' + (siTrocas(s, comp) === 1 ? '' : 's') + ' mudam de mãos' : ''}</div></div>`;
  }
  h += '</div>';
  // Hemiciclos
  const vagas = res.vagas;
  h += `<h2>Composição em cada sistema <small>${siFmt(vagas)} cadeiras · mesma ordem de partidos em todos</small></h2><div class="hemis">`;
  h += `<div class="hemi"><div class="t">Resultado oficial (TSE)</div><div class="s">${temReal ? 'como o TSE totalizou' : 'aguardando a totalização'}</div>${siHemicicloSvg(real, ordem, cores, vagas)}<div class="pode">Podemos: <b>${temReal ? pode(res.real) : '—'}</b></div></div>`;
  for (const s of res.sims) {
    const igual = temReal && !siTrocas(s, comp);
    h += `<div class="hemi"><div class="t">${siEsc(s.nome)}</div><div class="s">${siEsc(siDescricao(si.sistemas.find(x => x.id === s.id), true))}</div>${siHemicicloSvg(s.porPartido, ordem, cores, vagas)}`
      + `<div class="pode">Podemos: <b>${pode(s)}</b>${igual ? ' · <span class="mais">idêntico ao oficial</span>' : ''}</div></div>`;
  }
  h += '</div><div class="legenda">' + ordem.filter(sg => cores[sg] !== SI_COR_OUTROS).map(sg => `<span><i style="background:${cores[sg]}"></i>${siEsc(sg)}</span>`).join('')
    + (ordem.some(sg => cores[sg] === SI_COR_OUTROS) ? `<span><i style="background:${SI_COR_OUTROS}"></i>demais partidos</span>` : '') + '</div>';
  // Tabela por partido
  h += `<h2>Bancadas por partido <small>Δ = diferença para o resultado oficial</small></h2><div class="tab-rolagem"><table class="compacta"><thead><tr><th>Partido</th><th class="n">Oficial</th>`
    + res.sims.map(s => `<th class="n">${siEsc(s.nome)}</th><th class="n">Δ</th>`).join('') + '</tr></thead><tbody>';
  for (const sg of ordem) {
    h += `<tr${sg === SI_PARTIDO ? ' class="pode"' : ''}><td><span class="sw" style="background:${cores[sg]}"></span>${siEsc(sg)}</td><td class="n">${temReal ? real[sg] || 0 : '—'}</td>`
      + res.sims.map(s => `<td class="n">${s.porPartido[sg] || 0}</td><td class="d">${temReal ? siDelta(s.porPartido[sg] || 0, real[sg] || 0) : ''}</td>`).join('') + '</tr>';
  }
  h += `<tr><td><b>Total</b></td><td class="n"><b>${temReal ? res.real.total : '—'}</b></td>` + res.sims.map(s => `<td class="n"><b>${s.total}</b></td><td></td>`).join('') + '</tr></tbody></table></div>';
  // Quem entra e quem sai no Podemos
  if (temReal) {
    h += `<h2>Podemos: quem entra e quem sai <small>em relação aos eleitos oficiais</small></h2><div class="duas">`;
    for (const s of res.sims) {
      const ent = comp.flatMap(uf => s.porUf[uf].entram.filter(x => x.cand.partido === SI_PARTIDO).map(x => ({ uf, x })));
      const sai = comp.flatMap(uf => s.porUf[uf].saem.filter(x => x.cand.partido === SI_PARTIDO).map(x => ({ uf, x })));
      h += `<div class="bloco"><h3>${siEsc(s.nome)}</h3>` + (ent.length || sai.length ? '<table><tbody>'
        + ent.sort((a, b) => b.x.cand.votos - a.x.cand.votos).map(({ uf, x }) => `<tr><td class="ent">entra</td><td>${siEsc(x.cand.nome)}</td><td>${uf.toUpperCase()}</td><td class="n">${siFmt(x.cand.votos)}</td></tr>`).join('')
        + sai.sort((a, b) => b.x.cand.votos - a.x.cand.votos).map(({ uf, x }) => `<tr><td class="sai">sai</td><td>${siEsc(x.cand.nome)}</td><td>${uf.toUpperCase()}</td><td class="n">${siFmt(x.cand.votos)}</td></tr>`).join('')
        + '</tbody></table>' : '<div class="vazio">Ninguém entra nem sai: a mesma bancada.</div>') + '</div>';
    }
    h += '</div>';
  }
  // Estado a estado
  if (!umaUf) {
    const curtos = res.sims.map(s => `<th class="n">${siEsc(SI_CURTOS[s.tipo] || s.nome)}</th>`).join('');
    h += `<h2${impressao ? ' class="imp-quebra"' : ''}>Estado a estado <small>${impressao ? '' : 'clique num estado para ver quem entra e quem sai'}</small></h2><div class="tab-rolagem"><table class="compacta"><thead>`
      + `<tr><th rowspan="2">UF</th><th rowspan="2" class="n">Vagas</th><th rowspan="2" class="n">QE</th><th rowspan="2" class="n">Corte do<br>distritão</th>`
      + `<th colspan="${res.sims.length + 1}" class="grupo">Podemos</th><th colspan="${res.sims.length}" class="grupo">Cadeiras que mudam de mãos</th></tr>`
      + `<tr><th class="n">Oficial</th>${curtos}${curtos}</tr></thead><tbody>`;
    for (const uf of res.ufs) {
      const d = si.dados[uf], r = res.real.porUf[uf], p = res.sims[0].porUf[uf], dz = res.sims[1].porUf[uf];
      const podeUf = eleitos => eleitos.filter(x => x.cand.partido === SI_PARTIDO).length;
      h += `<tr class="clic${uf === si.ufSel ? ' sel' : ''}" data-uf="${uf}"><td>${uf.toUpperCase()}</td><td class="n">${d.vagas}</td><td class="n">${siFmt(p.qe)}</td><td class="n">${siFmt(dz.corte)}</td>`
        + `<td class="n">${r ? podeUf(r.eleitos) : '—'}</td>` + res.sims.map(s => `<td class="n">${podeUf(s.porUf[uf].eleitos)}</td>`).join('')
        + res.sims.map(s => `<td class="n">${r ? s.porUf[uf].entram.length : '—'}</td>`).join('') + '</tr>';
    }
    h += '</tbody></table></div>';
  }
  const ufDet = umaUf ? Object.keys(si.dados)[0] : si.ufSel;
  if (ufDet) h += siDetalheUfHtml(ufDet, impressao);
  return h;
}

function siDetalheUfHtml(uf, impressao) {
  const res = si.res, d = si.dados[uf], r = res.real.porUf[uf];
  const ordem = snOrdemPartidos(res), cores = siCores(ordem);
  const conta = eleitos => { const o = {}; for (const x of eleitos) o[x.cand.partido] = (o[x.cand.partido] || 0) + 1; return o; };
  const real = r ? conta(r.eleitos) : {};
  const sims = res.sims.map(s => conta(s.porUf[uf].eleitos));
  const partidos = ordem.filter(sg => real[sg] || sims.some(o => o[sg]));
  const p = res.sims[0].porUf[uf], dz = res.sims[1].porUf[uf], m = res.sims[2].porUf[uf];
  let h = `<h2 id="siDetalhe"${impressao && Object.keys(si.dados).length > 1 ? ' class="imp-quebra"' : ''}>${siEsc(siUfNome(uf))} <small>${d.vagas} vagas · ${siFmt(d.validos)} votos válidos · QE ${siFmt(p.qe)}`
    + ` · corte do distritão ${siFmt(dz.corte)} votos · misto: ${m.nMais} mais votados + ${m.nLista} lista</small></h2>`;
  h += `<div class="tab-rolagem"><table class="compacta"><thead><tr><th>Partido</th><th class="n">Oficial</th>` + res.sims.map(s => `<th class="n">${siEsc(s.nome)}</th><th class="n">Δ</th>`).join('') + '</tr></thead><tbody>';
  for (const sg of partidos) {
    h += `<tr${sg === SI_PARTIDO ? ' class="pode"' : ''}><td><span class="sw" style="background:${cores[sg]}"></span>${siEsc(sg)}</td><td class="n">${r ? real[sg] || 0 : '—'}</td>`
      + sims.map(o => `<td class="n">${o[sg] || 0}</td><td class="d">${r ? siDelta(o[sg] || 0, real[sg] || 0) : ''}</td>`).join('') + '</tr>';
  }
  h += '</tbody></table></div>';
  if (!r) return h + '<div class="dica">Sem eleitos marcados pelo TSE neste estado: não há com quem comparar quem entra e quem sai.</div>';
  h += '<div class="duas" style="margin-top:10px">';
  for (const s of res.sims) {
    const u = s.porUf[uf];
    const linha = (x, cls, txt) => `<tr${x.cand.partido === SI_PARTIDO ? ' class="pode"' : ''}><td class="${cls}">${txt}</td><td>${siEsc(x.cand.nome)}</td><td>${siEsc(x.cand.partido)}</td><td class="n">${siFmt(x.cand.votos)}</td></tr>`;
    h += `<div class="bloco"><h3>${siEsc(s.nome)} <small class="igual">${u.entram.length} troca${u.entram.length === 1 ? '' : 's'}</small></h3>`
      + (u.entram.length || u.saem.length ? '<table><tbody>' + u.entram.map(x => linha(x, 'ent', 'entra')).join('') + u.saem.map(x => linha(x, 'sai', 'sai')).join('') + '</tbody></table>'
        : '<div class="vazio">Os mesmos eleitos do resultado oficial.</div>') + '</div>';
  }
  return h + '</div>';
}

// ------------------------------------------------------------ PDF
async function siPdf() {
  if (!si.res) return;
  const logo = (document.querySelector('.topo img') || {}).src || '';
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const ufs = Object.keys(si.dados);
  const alvo = ufs.length === 1 ? siUfNome(ufs[0]) : 'Brasil';
  const el = $('siImpressao');
  el.innerHTML = `<div class="imp-cab">${logo ? `<img src="${logo}" alt="Podemos">` : ''}<div><div class="imp-org">Liderança do Podemos na Câmara dos Deputados</div>
      <h1>Sistemas eleitorais — ${siEsc(siCargoNome())}, ${si.op.ano} (${siEsc(alvo)})</h1>
      <div class="imp-sub">Os votos oficiais da eleição redistribuídos por sistema · fonte: TSE (${si.op.fonte === 'resultados' ? 'servidor oficial de resultados' : 'dados abertos'}) · gerado em ${siEsc(agora)}</div></div></div>
    <div class="imp-filete"></div>
    ${si.sistemas.map(s => `<div class="imp-param"><b>${siEsc(s.nome)}:</b> ${siEsc(siDescricao(s))}</div>`).join('')}
    ${$('siAvisos').innerHTML}
    ${siRelatorioHtml(true)}
    <div class="imp-rodape">As simulações mantêm os votos como foram dados — noutro sistema, eleitores e partidos se comportariam de outro jeito. O proporcional com a regra vigente
      reproduz o resultado oficial do TSE. Painel desenvolvido pela Liderança do Podemos na Câmara dos Deputados.</div>`;
  const titulo = document.title;
  document.title = `Sistemas eleitorais - ${si.cargo === '6' ? 'federal' : 'estadual'} ${si.op.ano} - ${alvo}`;
  const volta = () => { document.title = titulo; window.removeEventListener('afterprint', volta); };
  window.addEventListener('afterprint', volta);
  await Promise.all([...el.querySelectorAll('img')].map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => {})));
  window.print();
}

// ------------------------------------------------------------ início
async function siIniciar() {
  for (const [uf, nome] of Object.entries(AP_UFS).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) {
    $('siUf').insertAdjacentHTML('beforeend', `<option value="${uf}">${siEsc(nome)}</option>`);
  }
  $('siEleicao').addEventListener('change', () => siLer());
  $('siUf').addEventListener('change', () => siLer());
  $('siLer').addEventListener('click', () => siLer(true));
  $('siPdf').addEventListener('click', siPdf);
  $('siRegra').addEventListener('click', siRegraVigente);
  $('siCargo').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-c]');
    if (!b || b.dataset.c === si.cargo) return;
    si.cargo = b.dataset.c;
    for (const x of $('siCargo').querySelectorAll('button')) x.classList.toggle('ativo', x === b);
    siLer();
  });
  $('mModelo').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-m]');
    if (!b) return;
    for (const x of $('mModelo').querySelectorAll('button')) x.classList.toggle('ativo', x === b);
    siParametrosMudaram();
  });
  for (const id of ['pQP', 'pPart', 'pCand', 'pTerc', 'pFed', 'mPct', 'mLim']) {
    $(id).addEventListener('input', siParametrosMudaram);
    $(id).addEventListener('change', siParametrosMudaram);
  }
  $('siResultado').addEventListener('click', ev => {
    const tr = ev.target.closest('tr[data-uf]');
    if (!tr) return;
    si.ufSel = si.ufSel === tr.dataset.uf ? '' : tr.dataset.uf;
    $('siResultado').innerHTML = siRelatorioHtml(false);
    const det = $('siDetalhe');
    if (det && si.ufSel) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  siMarcarAlterados();

  let ops;
  try { ops = apEleicoesGerais(await zrJson(`${AP_BASE}/comum/config/ele-c.json`)); }
  catch (_) { ops = [apEleicaoReserva()]; }
  si.eleicoes = snEleicoes(ops);
  $('siEleicao').innerHTML = si.eleicoes.map(o => `<option value="${siEsc(o.id)}">${o.ano} — ${o.fonte === 'resultados' ? 'divulgação oficial do TSE' : 'dados abertos do TSE'}</option>`).join('');
  // A eleição corrente (um JSON por estado) carrega sozinha; os dados abertos esperam o clique.
  if (si.eleicoes[0] && si.eleicoes[0].fonte === 'resultados') siLer();
  else siStatus('Escolha a eleição e clique em <b>Ler dados do TSE</b>.');
}

if (typeof document !== 'undefined' && document.getElementById('siSistemas')) siIniciar();
