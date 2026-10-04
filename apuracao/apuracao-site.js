'use strict';
// Apuração 2026 — versão SITE (arquivo único, sem extensão).
// Reaproveita a leitura dos arquivos do TSE de labs-apuracao.js (apLerUFTodos,
// apCor, apUrl, apEleicaoDaConfig) e acrescenta o que o site precisa:
//  - cargo (Presidente, Governador, Senador, Deputado Federal, Deputado
//    Estadual/Distrital) e partido (Podemos, um partido qualquer ou todos);
//    só o cargo escolhido é lido a cada 30 s;
//  - filtros: vários estados (toque no mapa), visão "Eleitos", "só eleitos", busca;
//  - eleitos: o TSE só marca no fim; durante a apuração vale a PROJEÇÃO pelas
//    vagas que ele informa para cada partido/federação (majoritários: à frente);
//  - a última leitura gravada no navegador (localStorage), reexibida ao reabrir;
//  - no celular, a página suspensa lê de novo assim que volta à tela.
// Os dados vão do TSE direto para o navegador de quem vê; nada passa por servidor.

const SA_CHAVE = 'apuracao2026-v2';
const SA_CARGOS = {
  '1': { nome: 'Presidente', cargo: 1, eleicao: '6257', nacional: true },
  '3': { nome: 'Governador', cargo: 3, eleicao: '6259' },
  '5': { nome: 'Senador', cargo: 5, eleicao: '6259' },
  '6': { nome: 'Deputado Federal', cargo: 6, eleicao: '6259' },
  '7': { nome: 'Deputado Estadual / Distrital', cargo: 7, eleicao: '6259', df: 8 },
};
const sa = { cargo: '6', partido: '20', dados: {}, br: null, falhas: {}, sel: new Set(), visao: 'ufs', soEleitos: false, busca: '',
  pausado: false, timer: null, proxima: 0, lendo: false, ultima: null, salvoEm: null, doCache: false, siglas: {} };

function saEl(id) { return document.getElementById(id); }
function saEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function saNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function saHora(d) { return d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function saFmt(n) { return Math.round(n).toLocaleString('pt-BR'); }
function saPct(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: n > 0 && n < 100 ? 2 : 0, maximumFractionDigits: 2 }) + '%'; }
function saCargo() { return SA_CARGOS[sa.cargo]; }
function saPartidoNome() { return sa.partido ? (sa.siglas[sa.partido] || 'partido ' + sa.partido) : 'todos os partidos'; }

// ---------- navegador: última leitura ----------
function saGravar() {
  try { localStorage.setItem(SA_CHAVE, JSON.stringify({ v: 2, salvoEm: Date.now(), cargo: sa.cargo, partido: sa.partido, dados: sa.dados, br: sa.br })); }
  catch (_) { /* sem armazenamento ou cheio: segue sem gravar */ }
}
function saRecuperar() {
  try {
    const x = JSON.parse(localStorage.getItem(SA_CHAVE) || 'null');
    if (x && x.v === 2 && SA_CARGOS[x.cargo] && x.dados && Object.keys(x.dados).length) {
      Object.assign(sa, { cargo: x.cargo, partido: x.partido == null ? '20' : x.partido, dados: x.dados, br: x.br || null, salvoEm: x.salvoEm, doCache: true });
      return true;
    }
  } catch (_) {}
  return false;
}

// ---------- leitura ----------
async function saDescobrirEleicoes() {
  try {
    const r = await fetch(`${AP_BASE}/comum/config/ele-c.json`, { cache: 'no-cache' });
    if (!r.ok) return;
    const cfg = await r.json();
    for (const c of Object.values(SA_CARGOS)) { const e = apEleicaoDaConfig(cfg, c.cargo); if (e) c.eleicao = e; }
  } catch (_) {}
}

function saArquivos() {
  const c = saCargo();
  const l = Object.keys(AP_UFS).map(uf => ({ uf, cargo: uf === 'df' && c.df ? c.df : c.cargo }));
  if (c.nacional) l.push({ uf: 'br', cargo: c.cargo });
  return l;
}

async function saLerTudo() {
  if (sa.lendo) return;
  sa.lendo = true; saStatus();
  const cargoLido = sa.cargo, c = saCargo();
  let ok = 0;
  await Promise.all(saArquivos().map(async a => {
    try {
      const r = await fetch(apUrl(a.uf, c.eleicao, a.cargo), { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = apLerUFTodos(await r.json(), a.uf);
      if (sa.cargo !== cargoLido) return;            // trocou de cargo no meio da leitura
      for (const p of d.partidos) sa.siglas[p.numero] = p.sigla;
      if (a.uf === 'br') sa.br = d; else sa.dados[a.uf] = d;
      delete sa.falhas[a.uf]; ok++;
    } catch (e) { sa.falhas[a.uf] = e.message; }
  }));
  sa.lendo = false; sa.ultima = Date.now();
  if (ok && sa.cargo === cargoLido) { sa.doCache = false; saGravar(); }
  saRender();
}

function saAgendar() {
  clearTimeout(sa.timer);
  if (sa.pausado) { saStatus(); return; }
  sa.proxima = Date.now() + AP_INTERVALO;
  sa.timer = setTimeout(async () => { await saLerTudo(); saAgendar(); }, AP_INTERVALO);
  saStatus();
}

// ---------- filtros ----------
function saUfsEscopo() { return sa.sel.size ? [...sa.sel] : Object.keys(AP_UFS); }
function saDoPartido(c) { return !sa.partido || c.partidoNum === sa.partido; }
function saBate(c) { if (!sa.busca) return true; const q = saNorm(sa.busca); return saNorm(c.nome + ' ' + c.nomeCompleto + ' ' + c.numero + ' ' + c.partido).includes(q); }
function saEleitoOuProj(c) { return c.eleito || c.projetado; }

// ---------- tela ----------
function saStatus() {
  const el = saEl('saStatus');
  if (!el) return;
  const falhas = Object.keys(sa.falhas);
  const prox = sa.pausado ? 'pausado' : sa.lendo ? 'lendo agora…' : `próxima em ${Math.max(0, Math.ceil((sa.proxima - Date.now()) / 1000))} s`;
  el.innerHTML = `<span class="pulso${sa.lendo ? ' on' : ''}"></span> Atualiza a cada 30 s · ${prox} · última leitura ${saHora(sa.ultima)}`
    + (sa.doCache && sa.salvoEm ? ` · <span class="aviso">mostrando a leitura salva neste aparelho às ${saHora(sa.salvoEm)}</span>` : '')
    + (falhas.length ? ` · <span class="aviso" title="${saEsc(falhas.map(u => u.toUpperCase() + ': ' + sa.falhas[u]).join('; '))}">${falhas.length} arquivo(s) sem resposta — mantido o dado anterior</span>` : '');
  saEl('saPausar').textContent = sa.pausado ? '▶ Retomar' : '⏸ Pausar';
}

function saMapa() {
  const m = AP_MAPA;
  const paths = Object.keys(m.uf).map(uf => {
    const d = sa.dados[uf];
    return `<path d="${m.uf[uf]}" fill="${apCor(d ? d.pct : 0)}" data-uf="${uf}" class="${sa.sel.has(uf) ? 'sel' : ''}"><title>${saEsc(AP_UFS[uf])}: ${d ? saPct(d.pct) + ' apurado' : 'sem dados'}</title></path>`;
  }).join('');
  const rot = Object.keys(m.centro).map(uf => {
    const d = sa.dados[uf], [x, y] = m.centro[uf];
    const el = d && !saCargo().nacional ? d.candidatos.filter(c => saDoPartido(c) && saEleitoOuProj(c)).length : 0;
    const peq = ['df', 'se', 'al', 'rn', 'pb', 'es', 'rj'].includes(uf);
    return `<g class="rot${peq ? ' peq' : ''}"><text x="${x}" y="${y - 2}">${uf.toUpperCase()}</text><text x="${x}" y="${y + 9}" class="pct">${d ? Math.floor(d.pct) + '%' : '–'}</text>`
      + (el ? `<circle cx="${x + 13}" cy="${y - 6}" r="6.5"></circle><text x="${x + 13}" y="${y - 3.2}" class="el">${el}</text>` : '') + '</g>';
  }).join('');
  const leg = saCargo().nacional ? '' : `<span class="bola">n</span> eleitos/projetados (${saEsc(saPartidoNome())})`;
  return `<svg viewBox="0 0 ${m.w} ${m.h}" class="mapa-svg" role="img" aria-label="Mapa do Brasil por percentual apurado">${paths}${rot}</svg>
    <div class="legenda"><span>0%</span><i style="background:linear-gradient(90deg,${apCor(0.1)},${apCor(50)},${apCor(100)})"></i><span>100% apurado</span>${leg}</div>
    <div class="dica">Toque nos estados para filtrar (pode marcar vários).</div>`;
}

function saSit(c, maj) {
  if (c.eleito) return `<span class="sit el">${saEsc(c.situacao || 'Eleito')}</span>`;
  if (c.projetado) return `<span class="sit pj">${maj ? 'à frente' : 'eleito (projeção)'}</span>`;
  return c.situacao ? `<span class="sit">${saEsc(c.situacao)}</span>` : '';
}

function saLinhas(cands, d, inicio, comUF) {
  const todos = !sa.partido;
  return cands.map((c, i) => `<tr class="${c.eleito ? 'el' : c.projetado ? 'pj' : ''}"><td class="pos">${inicio + i + 1}º</td><td><b>${saEsc(c.nome)}</b> <span class="num">${saEsc(c.numero)}</span></td>`
    + (todos ? `<td class="pt">${saEsc(c.partido)}</td>` : '') + (comUF ? `<td>${saEsc((c.uf || '').toUpperCase())}</td>` : '')
    + `<td class="r">${saFmt(c.votos)}</td><td class="r">${saPct(c.pct)}</td><td>${saSit(c, d ? d.majoritario : c.majoritario)}</td></tr>`).join('');
}
function saCabTab(comUF) { return `<tr><th></th><th>Candidato(a)</th>${!sa.partido ? '<th>Partido</th>' : ''}${comUF ? '<th>UF</th>' : ''}<th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th></tr>`; }

function saBlocoUF(d) {
  let cands = d.candidatos.filter(c => saDoPartido(c) && saBate(c));
  if (sa.soEleitos) cands = cands.filter(saEleitoOuProj);
  const filtrado = sa.busca || sa.soEleitos;
  if (filtrado && !cands.length) return '';
  const p = sa.partido ? d.partidos.find(x => x.numero === sa.partido) : null;
  const max = d.majoritario ? 12 : 10;
  const top = filtrado ? cands : cands.slice(0, max), resto = filtrado ? [] : cands.slice(max);
  const meta = [d.majoritario ? '' : `${d.vagasUF} vagas`, d.quociente ? `quociente ${saFmt(d.quociente)}` : '', d.validos ? `${saFmt(d.validos)} votos válidos` : '',
    p && !d.majoritario ? `${saEsc(p.sigla)}: ${saFmt(p.total)} votos (${saFmt(p.nominais)} nominais + ${saFmt(p.legenda)} legenda) · ${p.vagas} vaga(s)${p.federacao ? ' na ' + saEsc(p.federacao) : ''}` : '',
    `TSE ${saEsc(d.atualizado || '—')}`].filter(Boolean).join(' · ');
  return `<div class="uf${sa.sel.has(d.uf) ? ' sel' : ''}">
    <div class="uf-cab"><b>${saEsc(d.nome)}</b> <span class="sigla">${d.uf === 'br' ? '' : d.uf.toUpperCase()}</span><span class="uf-pct">${saPct(d.pct)} das seções apuradas${d.final ? ' · <b>final</b>' : ''}</span>
      ${sa.falhas[d.uf] ? '<span class="aviso">sem resposta na última leitura</span>' : ''}</div>
    <div class="barra"><i style="width:${Math.min(100, d.pct)}%"></i></div>
    <div class="uf-meta">${meta}</div>
    ${!cands.length ? `<div class="vazio">${sa.partido ? saEsc(saPartidoNome()) + ' não tem candidato(a) a ' + saEsc(saCargo().nome.toLowerCase()) + ' aqui.' : 'Sem candidatos.'}</div>`
      : `<div class="tab-rolagem"><table>${saCabTab(false)}${saLinhas(top, d, 0, false)}</table></div>${resto.length ? `<details><summary>ver os outros ${resto.length} candidatos</summary><div class="tab-rolagem"><table>${saLinhas(resto, d, max, false)}</table></div></details>` : ''}`}
  </div>`;
}

function saEleitosHtml() {
  const c = saCargo();
  const fontes = c.nacional && !sa.sel.size && sa.br ? [sa.br] : saUfsEscopo().map(uf => sa.dados[uf]).filter(Boolean);
  const lista = fontes.flatMap(d => d.candidatos.filter(x => saDoPartido(x) && saEleitoOuProj(x) && saBate(x)).map(x => Object.assign({ uf: d.uf, majoritario: d.majoritario }, x)))
    .sort((a, b) => b.votos - a.votos);
  const onde = sa.sel.size ? [...sa.sel].map(u => u.toUpperCase()).join(', ') : 'Brasil todo';
  const rot = `${saCargo().nome} · ${saPartidoNome()} · ${onde}`;
  if (!lista.length) return `<div class="vazio grande">Nenhum eleito ou projetado (${saEsc(rot)}).</div>`;
  return `<div class="uf"><div class="uf-cab"><b>Eleitos e projetados — ${saEsc(rot)}</b><span class="uf-pct">${lista.length}</span></div>
    <div class="uf-meta">"Eleito (projeção)": entre os mais votados do partido/federação dentro das vagas que o TSE informa na parcial. Vale até a marcação oficial do TSE.</div>
    <div class="tab-rolagem"><table>${saCabTab(true)}${saLinhas(lista, null, 0, true)}</table></div></div>`;
}

function saOpcoesPartido() {
  const sel = saEl('saPartido');
  const nums = Object.keys(sa.siglas).sort((a, b) => sa.siglas[a].localeCompare(sa.siglas[b]));
  const atual = sel.dataset.chave || '';
  const chave = nums.join(',');
  if (chave === atual && sel.value === sa.partido) return;
  sel.innerHTML = '<option value="">Todos os partidos</option>' + (nums.includes('20') ? '' : '<option value="20">PODE (Podemos)</option>')
    + nums.map(n => `<option value="${n}">${saEsc(sa.siglas[n])} (${n})</option>`).join('');
  sel.dataset.chave = chave;
  sel.value = sa.partido;
}

function saRender() {
  const c = saCargo();
  const escopo = saUfsEscopo().map(uf => sa.dados[uf]).filter(Boolean);
  const usaBr = c.nacional && !sa.sel.size && sa.br;
  const secoes = usaBr ? sa.br.secoes : escopo.reduce((s, d) => s + d.secoes, 0);
  const apuradas = usaBr ? sa.br.apuradas : escopo.reduce((s, d) => s + d.apuradas, 0);
  const fontes = usaBr ? [sa.br] : escopo;
  const votos = fontes.reduce((s, d) => s + d.candidatos.filter(saDoPartido).reduce((t, x) => t + x.votos, 0), 0);
  const eleitos = fontes.reduce((s, d) => s + d.candidatos.filter(x => saDoPartido(x) && saEleitoOuProj(x)).length, 0);
  const onde = sa.sel.size ? [...sa.sel].map(u => u.toUpperCase()).join(', ') : 'Brasil';
  const card = (v, l, cls) => `<div class="card ${cls || ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  saEl('saCards').innerHTML = card(saPct(secoes ? 100 * apuradas / secoes : 0), `seções apuradas — ${saEsc(onde)}`, 'ama')
    + card(saFmt(votos), `votos nominais — ${saEsc(saPartidoNome())}`, 'ver')
    + card(eleitos, c.nacional || c.cargo === 3 || c.cargo === 5 ? 'à frente / eleitos' : 'eleitos + projetados', 'ver')
    + card(`${escopo.filter(d => d.final || d.pct >= 100).length}/${escopo.length || (sa.sel.size || 27)}`, 'estados com 100% apurado');
  saEl('saMapa').innerHTML = saMapa();
  saEl('saSel').innerHTML = sa.sel.size
    ? [...sa.sel].map(u => `<button class="chip" data-tira="${u}" title="Tirar do filtro">${u.toUpperCase()} ✕</button>`).join('') + '<button class="chip limpar" data-tira="*">Brasil todo</button>'
    : '<span class="chip neutro">Brasil todo</span>';
  saEl('saCargo').value = sa.cargo;
  saOpcoesPartido();
  document.querySelectorAll('[data-visao]').forEach(b => b.classList.toggle('ativo', b.dataset.visao === sa.visao));
  saEl('saSoEleitosCx').style.display = sa.visao === 'ufs' ? '' : 'none';
  saEl('saTitulo').textContent = `Apuração 2026 · ${c.nome}${sa.partido ? ' · ' + saPartidoNome() : ''}`;
  if (!escopo.length && !sa.br) { saEl('saLista').innerHTML = '<div class="vazio grande">Lendo os resultados do TSE…</div>'; saStatus(); return; }
  if (sa.visao === 'eleitos') saEl('saLista').innerHTML = saEleitosHtml();
  else {
    const blocos = (usaBr ? [sa.br] : []).concat(escopo.sort((a, b) => a.nome.localeCompare(b.nome)));
    saEl('saLista').innerHTML = blocos.map(saBlocoUF).join('') || '<div class="vazio grande">Nenhum candidato com esse filtro.</div>';
  }
  saStatus();
}

// ---------- início ----------
function saIniciar() {
  saEl('saMapa').addEventListener('click', ev => {
    const t = ev.target.closest('[data-uf]');
    if (!t) return;
    const uf = t.dataset.uf;
    if (sa.sel.has(uf)) sa.sel.delete(uf); else sa.sel.add(uf);
    saRender();
  });
  saEl('saSel').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tira]');
    if (!b) return;
    if (b.dataset.tira === '*') sa.sel.clear(); else sa.sel.delete(b.dataset.tira);
    saRender();
  });
  saEl('saCargo').addEventListener('change', async ev => {
    sa.cargo = ev.target.value; sa.dados = {}; sa.br = null; sa.falhas = {}; sa.doCache = false;
    saRender(); await saLerTudo(); saAgendar();
  });
  saEl('saPartido').addEventListener('change', ev => { sa.partido = ev.target.value; saGravar(); saRender(); });
  document.querySelectorAll('[data-visao]').forEach(b => b.addEventListener('click', () => { sa.visao = b.dataset.visao; saRender(); }));
  saEl('saSoEleitos').addEventListener('change', ev => { sa.soEleitos = ev.target.checked; saRender(); });
  saEl('saBusca').addEventListener('input', ev => { sa.busca = ev.target.value.trim(); saRender(); });
  saEl('saPausar').addEventListener('click', () => { sa.pausado = !sa.pausado; saAgendar(); });
  saEl('saAgora').addEventListener('click', async () => { await saLerTudo(); saAgendar(); });
  // Celular: a página suspensa (tela bloqueada, outro app) lê de novo ao voltar.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !sa.pausado && Date.now() - (sa.ultima || 0) > 5000) { await saLerTudo(); saAgendar(); }
  });
  saRecuperar();
  saRender();
  setInterval(saStatus, 1000);
  saDescobrirEleicoes().then(saLerTudo).then(saAgendar);
}

if (typeof document !== 'undefined' && document.getElementById('saLista')) saIniciar();
