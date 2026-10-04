'use strict';
// Apuração 2026 — versão SITE (arquivo único, sem extensão).
// Reaproveita a leitura dos arquivos do TSE de labs-apuracao.js (apLerUF,
// apResumo, apCor, apUrl, apEleicaoDaConfig) e acrescenta o que o site precisa:
//  - filtros: vários estados (toque no mapa), "Eleitos do Podemos" no Brasil
//    todo ou nos estados marcados, "só eleitos" e busca;
//  - a última leitura gravada no navegador (localStorage): ao reabrir, a tela
//    aparece na hora com o dado salvo, enquanto a leitura nova chega;
//  - no celular, a página suspensa lê de novo assim que volta à tela.
// Os dados vão do TSE direto para o navegador de quem vê; nada passa por servidor.

const SA_CHAVE = 'apuracao2026-podemos';
const sa = { eleicao: AP_ELEICAO_PADRAO, dados: {}, falhas: {}, sel: new Set(), visao: 'ufs', soEleitos: false, busca: '',
  pausado: false, timer: null, proxima: 0, lendo: false, ultima: null, salvoEm: null, doCache: false };

function saEl(id) { return document.getElementById(id); }
function saEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function saNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function saHora(d) { return d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function saFmt(n) { return Math.round(n).toLocaleString('pt-BR'); }
function saPct(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: n > 0 && n < 100 ? 2 : 0, maximumFractionDigits: 2 }) + '%'; }

// ---------- navegador: última leitura ----------
function saGravar() {
  try { localStorage.setItem(SA_CHAVE, JSON.stringify({ v: 1, salvoEm: Date.now(), eleicao: sa.eleicao, dados: sa.dados })); } catch (_) { /* sem armazenamento: segue sem gravar */ }
}
function saRecuperar() {
  try {
    const x = JSON.parse(localStorage.getItem(SA_CHAVE) || 'null');
    if (x && x.v === 1 && x.dados && Object.keys(x.dados).length) {
      sa.dados = x.dados; sa.eleicao = x.eleicao || sa.eleicao; sa.salvoEm = x.salvoEm; sa.doCache = true;
      return true;
    }
  } catch (_) {}
  return false;
}

// ---------- leitura ----------
async function saDescobrirEleicao() {
  try {
    const r = await fetch(`${AP_BASE}/comum/config/ele-c.json`, { cache: 'no-cache' });
    if (r.ok) { const e = apEleicaoDaConfig(await r.json()); if (e) sa.eleicao = e; }
  } catch (_) {}
}

async function saLerTudo() {
  if (sa.lendo) return;
  sa.lendo = true; saStatus();
  let ok = 0;
  await Promise.all(Object.keys(AP_UFS).map(async uf => {
    try {
      const r = await fetch(apUrl(uf, sa.eleicao), { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      sa.dados[uf] = apLerUF(await r.json(), uf);
      delete sa.falhas[uf]; ok++;
    } catch (e) { sa.falhas[uf] = e.message; }
  }));
  sa.lendo = false; sa.ultima = Date.now();
  if (ok) { sa.doCache = false; saGravar(); }
  saRender();
}

function saAgendar() {
  clearTimeout(sa.timer);
  if (sa.pausado) { saStatus(); return; }
  sa.proxima = Date.now() + AP_INTERVALO;
  sa.timer = setTimeout(async () => { await saLerTudo(); saAgendar(); }, AP_INTERVALO);
  saStatus();
}

// ---------- tela ----------
function saStatus() {
  const el = saEl('saStatus');
  if (!el) return;
  const falhas = Object.keys(sa.falhas);
  const prox = sa.pausado ? 'pausado' : sa.lendo ? 'lendo agora…' : `próxima em ${Math.max(0, Math.ceil((sa.proxima - Date.now()) / 1000))} s`;
  el.innerHTML = `<span class="pulso${sa.lendo ? ' on' : ''}"></span> Atualiza a cada 30 s · ${prox} · última leitura ${saHora(sa.ultima)}`
    + (sa.doCache && sa.salvoEm ? ` · <span class="aviso">mostrando a leitura salva neste aparelho às ${saHora(sa.salvoEm)}</span>` : '')
    + (falhas.length ? ` · <span class="aviso" title="${saEsc(falhas.map(u => u.toUpperCase() + ': ' + sa.falhas[u]).join('; '))}">${falhas.length} estado(s) sem resposta — mantido o dado anterior</span>` : '');
  saEl('saPausar').textContent = sa.pausado ? '▶ Retomar' : '⏸ Pausar';
}

function saUfsEscopo() { return sa.sel.size ? [...sa.sel] : Object.keys(AP_UFS); }
function saBate(c) { if (!sa.busca) return true; const q = saNorm(sa.busca); return saNorm(c.nome + ' ' + c.nomeCompleto + ' ' + c.numero).includes(q); }

function saMapa() {
  const m = AP_MAPA;
  const paths = Object.keys(m.uf).map(uf => {
    const d = sa.dados[uf];
    return `<path d="${m.uf[uf]}" fill="${apCor(d ? d.pct : 0)}" data-uf="${uf}" class="${sa.sel.has(uf) ? 'sel' : ''}"><title>${saEsc(AP_UFS[uf])}: ${d ? saPct(d.pct) + ' apurado' : 'sem dados'}</title></path>`;
  }).join('');
  const rot = Object.keys(m.centro).map(uf => {
    const d = sa.dados[uf], [x, y] = m.centro[uf];
    const el = d ? d.candidatos.filter(c => c.eleito).length : 0;
    const peq = ['df', 'se', 'al', 'rn', 'pb', 'es', 'rj'].includes(uf);
    return `<g class="rot${peq ? ' peq' : ''}"><text x="${x}" y="${y - 2}">${uf.toUpperCase()}</text><text x="${x}" y="${y + 9}" class="pct">${d ? Math.floor(d.pct) + '%' : '–'}</text>`
      + (el ? `<circle cx="${x + 13}" cy="${y - 6}" r="6.5"></circle><text x="${x + 13}" y="${y - 3.2}" class="el">${el}</text>` : '') + '</g>';
  }).join('');
  return `<svg viewBox="0 0 ${m.w} ${m.h}" class="mapa-svg" role="img" aria-label="Mapa do Brasil por percentual apurado">${paths}${rot}</svg>
    <div class="legenda"><span>0%</span><i style="background:linear-gradient(90deg,${apCor(0.1)},${apCor(50)},${apCor(100)})"></i><span>100% apurado</span>
      <span class="bola">n</span> eleitos do Podemos</div>
    <div class="dica">Toque nos estados para filtrar (pode marcar vários).</div>`;
}

function saSit(c) { return c.eleito ? `<span class="sit el">${saEsc(c.situacao || 'Eleito')}</span>` : (c.situacao ? `<span class="sit">${saEsc(c.situacao)}</span>` : ''); }

function saBlocoUF(d) {
  const p = d.partido;
  let cands = d.candidatos.filter(saBate);
  if (sa.soEleitos) cands = cands.filter(c => c.eleito);
  if ((sa.busca || sa.soEleitos) && !cands.length) return '';
  const lin = (c, i) => `<tr class="${c.eleito ? 'el' : ''}"><td class="pos">${i + 1}º</td><td><b>${saEsc(c.nome)}</b> <span class="num">${saEsc(c.numero)}</span></td><td class="r">${saFmt(c.votos)}</td><td class="r">${saPct(c.pct)}</td><td>${saSit(c)}</td></tr>`;
  const cab = '<tr><th></th><th>Candidato(a)</th><th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th></tr>';
  const cheio = sa.busca || sa.soEleitos;
  const top = cheio ? cands : cands.slice(0, 10), resto = cheio ? [] : cands.slice(10);
  return `<div class="uf${sa.sel.has(d.uf) ? ' sel' : ''}">
    <div class="uf-cab"><b>${saEsc(d.nome)}</b> <span class="sigla">${d.uf.toUpperCase()}</span><span class="uf-pct">${saPct(d.pct)} das seções apuradas${d.final ? ' · <b>final</b>' : ''}</span>
      ${sa.falhas[d.uf] ? '<span class="aviso">sem resposta na última leitura</span>' : ''}</div>
    <div class="barra"><i style="width:${Math.min(100, d.pct)}%"></i></div>
    <div class="uf-meta">${d.vagasUF} vagas${d.quociente ? ` · quociente ${saFmt(d.quociente)}` : ''}${p ? ` · Podemos: ${saFmt(p.total)} votos (${saFmt(p.nominais)} nominais + ${saFmt(p.legenda)} legenda) · ${p.vagas} vaga(s)` : ''} · TSE ${saEsc(d.atualizado || '—')}</div>
    ${!p ? '<div class="vazio">O Podemos não tem candidatos a deputado federal nesta UF.</div>'
      : `<div class="tab-rolagem"><table>${cab}${top.map(lin).join('')}</table></div>${resto.length ? `<details><summary>ver os outros ${resto.length} candidatos</summary><div class="tab-rolagem"><table>${resto.map((c, i) => lin(c, i + 10)).join('')}</table></div></details>` : ''}`}
  </div>`;
}

function saEleitosHtml() {
  const ufs = saUfsEscopo();
  const lista = ufs.flatMap(uf => (sa.dados[uf] ? sa.dados[uf].candidatos.filter(c => c.eleito && saBate(c)).map(c => Object.assign({ uf }, c)) : []))
    .sort((a, b) => b.votos - a.votos);
  const onde = sa.sel.size ? [...sa.sel].map(u => u.toUpperCase()).join(', ') : 'Brasil todo';
  if (!lista.length) return `<div class="vazio grande">Ainda não há eleitos do Podemos definidos pelo TSE (${saEsc(onde)}). A situação de cada candidato aparece conforme a apuração avança.</div>`;
  return `<div class="uf"><div class="uf-cab"><b>Eleitos do Podemos — ${saEsc(onde)}</b><span class="uf-pct">${lista.length} eleito(s)</span></div>
    <div class="tab-rolagem"><table><tr><th></th><th>Candidato(a)</th><th>UF</th><th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th></tr>
    ${lista.map((c, i) => `<tr class="el"><td class="pos">${i + 1}º</td><td><b>${saEsc(c.nome)}</b> <span class="num">${saEsc(c.numero)}</span></td><td>${c.uf.toUpperCase()}</td><td class="r">${saFmt(c.votos)}</td><td class="r">${saPct(c.pct)}</td><td>${saSit(c)}</td></tr>`).join('')}</table></div></div>`;
}

function saRender() {
  const escopo = {};
  for (const uf of saUfsEscopo()) if (sa.dados[uf]) escopo[uf] = sa.dados[uf];
  const r = apResumo(escopo);
  const onde = sa.sel.size ? [...sa.sel].map(u => u.toUpperCase()).join(', ') : 'Brasil';
  const card = (v, l, cls) => `<div class="card ${cls || ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  saEl('saCards').innerHTML = card(saPct(r.pct), `seções apuradas — ${saEsc(onde)}`, 'ama') + card(saFmt(r.votos), 'votos do Podemos', 'ver')
    + card(r.eleitos, 'eleitos até agora', 'ver') + card(`${r.concluidas}/${r.ufs || (sa.sel.size || 27)}`, 'estados com 100% apurado');
  saEl('saMapa').innerHTML = saMapa();
  saEl('saSel').innerHTML = sa.sel.size
    ? [...sa.sel].map(u => `<button class="chip" data-tira="${u}" title="Tirar do filtro">${u.toUpperCase()} ✕</button>`).join('') + '<button class="chip limpar" data-tira="*">Brasil todo</button>'
    : '<span class="chip neutro">Brasil todo</span>';
  document.querySelectorAll('[data-visao]').forEach(b => b.classList.toggle('ativo', b.dataset.visao === sa.visao));
  saEl('saSoEleitosCx').style.display = sa.visao === 'ufs' ? '' : 'none';
  if (!Object.keys(sa.dados).length) { saEl('saLista').innerHTML = '<div class="vazio grande">Lendo os resultados do TSE…</div>'; saStatus(); return; }
  if (sa.visao === 'eleitos') saEl('saLista').innerHTML = saEleitosHtml();
  else {
    const ufs = saUfsEscopo().filter(uf => sa.dados[uf]).sort((a, b) => AP_UFS[a].localeCompare(AP_UFS[b]));
    const html = ufs.map(uf => saBlocoUF(sa.dados[uf])).join('');
    saEl('saLista').innerHTML = html || '<div class="vazio grande">Nenhum candidato com esse filtro.</div>';
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
  document.querySelectorAll('[data-visao]').forEach(b => b.addEventListener('click', () => { sa.visao = b.dataset.visao; saRender(); }));
  saEl('saSoEleitos').addEventListener('change', ev => { sa.soEleitos = ev.target.checked; saRender(); });
  saEl('saBusca').addEventListener('input', ev => { sa.busca = ev.target.value.trim(); saRender(); });
  saEl('saPausar').addEventListener('click', () => { sa.pausado = !sa.pausado; saAgendar(); });
  saEl('saAgora').addEventListener('click', async () => { await saLerTudo(); saAgendar(); });
  // Celular: a página suspensa (tela bloqueada, outro app) lê de novo ao voltar.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !sa.pausado && Date.now() - (sa.ultima || 0) > 5000) { await saLerTudo(); saAgendar(); }
  });
  if (saRecuperar()) saRender();
  else saRender();
  setInterval(saStatus, 1000);
  saDescobrirEleicao().then(saLerTudo).then(saAgendar);
}

if (typeof document !== 'undefined' && document.getElementById('saLista')) saIniciar();
