'use strict';
// Apuração — a tela do painel, a mesma no site (apuracao/index.html, arquivo
// único) e na aba Apuração do Labs (apuracao/extensao.html, num iframe).
// Usa a leitura dos arquivos do TSE de labs-apuracao.js (apLerUFTodos,
// apCor, apUrl, apEleicaoDaConfig) e acrescenta:
//  - eleição e turno: as eleições gerais que o TSE publica (lidas da
//    configuração dele), inclusive o 2º turno assim que sai;
//  - cargo (Presidente, Governador, Senador, Deputado Federal, Deputado
//    Estadual/Distrital) e partido (Podemos, um partido qualquer ou todos);
//    só o cargo escolhido é lido a cada 30 s;
//  - filtros: vários estados (toque no mapa), visão "Eleitos", "só eleitos", busca;
//  - eleitos: o TSE só marca no fim; durante a apuração vale a PROJEÇÃO pelas
//    vagas que ele informa para cada partido/federação (majoritários: à frente);
//  - a última leitura gravada no navegador (localStorage), reexibida ao reabrir;
//  - no celular, a página suspensa lê de novo assim que volta à tela.
// Os dados vão do TSE direto para o navegador de quem vê; nada passa por servidor.

const SA_CHAVE = 'apuracao-v3';
const SA_CARGOS = {
  '1': { nome: 'Presidente', cargo: 1, nacional: true },
  '3': { nome: 'Governador', cargo: 3 },
  '5': { nome: 'Senador', cargo: 5 },
  '6': { nome: 'Deputado Federal', cargo: 6 },
  '7': { nome: 'Deputado Estadual / Distrital', cargo: 7, df: 8 },
};
const sa = { eleicoes: [apEleicaoReserva()], eleicaoId: '', cargo: '6', partido: '20', dados: {}, br: null, falhas: {}, sel: new Set(), visao: 'ufs', soEleitos: false, busca: '',
  pausado: false, timer: null, proxima: 0, lendo: false, ultima: null, salvoEm: null, doCache: false, siglas: {} };

function saEl(id) { return document.getElementById(id); }
function saEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function saNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function saHora(d) { return d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function saFmt(n) { return Math.round(n).toLocaleString('pt-BR'); }
function saPct(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: n > 0 && n < 100 ? 2 : 0, maximumFractionDigits: 2 }) + '%'; }
function saCargo() { return SA_CARGOS[sa.cargo]; }
function saOp() { return sa.eleicoes.find(o => o.id === sa.eleicaoId) || apEleicaoInicial(sa.eleicoes); }
function saNomeEleicao(o = saOp()) { return `${o.ano}${o.turno === 2 ? ' · 2º turno' : ''}`; }
// Cargos da eleição escolhida (o Distrital vem junto do Estadual, como no TSE).
function saCargosDaOp(o = saOp()) { return Object.keys(SA_CARGOS).filter(k => o.cargos[k] || (k === '7' && o.cargos[8])); }
// Mantém o cargo se a eleição o tiver; senão Dep. Federal, Presidente ou o primeiro que houver.
function saAjustarCargo() {
  const l = saCargosDaOp();
  if (!l.includes(sa.cargo)) sa.cargo = ['6', '1'].find(k => l.includes(k)) || l[0] || '6';
}
function saPartidoNome() { return sa.partido ? (sa.siglas[sa.partido] || (sa.partido === '20' ? 'PODE' : 'partido ' + sa.partido)) : 'todos os partidos'; }

// ---------- navegador: última leitura ----------
function saGravar() {
  try { localStorage.setItem(SA_CHAVE, JSON.stringify({ v: 3, salvoEm: Date.now(), eleicao: saOp(), cargo: sa.cargo, partido: sa.partido, dados: sa.dados, br: sa.br })); }
  catch (_) { /* sem armazenamento ou cheio: segue sem gravar */ }
}
function saRecuperar() {
  try {
    const x = JSON.parse(localStorage.getItem(SA_CHAVE) || 'null');
    if (x && x.v === 3 && x.eleicao && SA_CARGOS[x.cargo] && x.dados && Object.keys(x.dados).length) {
      if (!sa.eleicoes.some(o => o.id === x.eleicao.id)) sa.eleicoes.push(x.eleicao);
      Object.assign(sa, { eleicaoId: x.eleicao.id, cargo: x.cargo, partido: x.partido == null ? '20' : x.partido, dados: x.dados, br: x.br || null, salvoEm: x.salvoEm, doCache: true });
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
    const ops = apEleicoesGerais(await r.json());
    if (!ops.length) return;
    sa.eleicoes = ops;
    if (!ops.some(o => o.id === sa.eleicaoId)) {      // a gravada saiu da lista (ou 1ª visita)
      sa.eleicaoId = apEleicaoInicial(ops).id; sa.dados = {}; sa.br = null; sa.doCache = false;
      if (saOp().turno === 2) sa.partido = '';
    }
  } catch (_) { /* fica a reserva (2026, 1º turno) */ }
  saAjustarCargo();
}

// Arquivos a ler: um por UF (só as UFs da eleição, quando o TSE as lista) e o
// do Brasil nos cargos nacionais. No DF, o Estadual é o Distrital (cargo 8).
function saArquivos() {
  const o = saOp(), c = saCargo();
  const doCargo = cd => o.cargos[cd] ? Object.assign({ cargo: cd }, o.cargos[cd]) : null;
  const l = [];
  for (const uf of Object.keys(AP_UFS)) {
    const a = (uf === 'df' && c.df && doCargo(c.df)) || doCargo(c.cargo);
    if (a && (!a.ufs || a.ufs.includes(uf))) l.push({ uf, cargo: a.cargo, eleicao: a.eleicao, ciclo: o.ciclo });
  }
  if (c.nacional && doCargo(c.cargo)) l.push({ uf: 'br', cargo: c.cargo, eleicao: o.cargos[c.cargo].eleicao, ciclo: o.ciclo });
  return l;
}

async function saLerTudo() {
  if (sa.lendo) return;
  sa.lendo = true; saStatus();
  const lido = () => sa.eleicaoId + '|' + sa.cargo, chave = lido();
  let ok = 0;
  const arqs = saArquivos();
  sa.naoPublicados = 0;
  await Promise.all(arqs.map(async a => {
    try {
      const r = await fetch(apUrl(a.uf, a.eleicao, a.cargo, a.ciclo), { cache: 'no-cache' });
      // 404/403: o TSE ainda não publicou (eleição prevista) ou a UF não tem esse turno.
      if (r.status === 404 || r.status === 403) { if (lido() === chave) { sa.naoPublicados++; delete sa.falhas[a.uf]; } return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = apLerUFTodos(await r.json(), a.uf);
      if (lido() !== chave) return;                  // trocou de eleição ou cargo no meio da leitura
      for (const p of d.partidos) sa.siglas[p.numero] = p.sigla;
      if (a.uf === 'br') sa.br = d; else sa.dados[a.uf] = d;
      delete sa.falhas[a.uf]; ok++;
    } catch (e) { sa.falhas[a.uf] = e.message; }
  }));
  sa.lendo = false; sa.ultima = Date.now();
  sa.totalArquivos = arqs.length;
  if (ok && lido() === chave) { sa.doCache = false; saGravar(); }
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
    return `<path d="${m.uf[uf]}" fill="${apCor(d ? d.pct : 0)}" data-uf="${uf}" class="${sa.sel.has(uf) ? 'sel' : ''}"><title>${saEsc(AP_UFS[uf])}: ${d ? saPct(d.pct) + ' apurado' + (d.retotalizando ? ' · em retotalização no TSE' : '') : 'sem dados'}</title></path>`;
  }).join('');
  const rot = Object.keys(m.centro).map(uf => {
    const d = sa.dados[uf], [x, y] = m.centro[uf];
    const el = d && !saCargo().nacional ? d.candidatos.filter(c => saDoPartido(c) && saEleitoOuProj(c)).length : 0;
    const peq = ['df', 'se', 'al', 'rn', 'pb', 'es', 'rj'].includes(uf);
    return `<g class="rot${peq ? ' peq' : ''}"><text x="${x}" y="${y - 2}">${uf.toUpperCase()}</text><text x="${x}" y="${y + 9}" class="pct">${d ? (d.retotalizando ? '↻' : Math.floor(d.pct) + '%') : '–'}</text>`
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
  const bt = typeof aoBotao === 'function' ? aoBotao : () => '';
  return cands.map((c, i) => `<tr class="${c.eleito ? 'el' : c.projetado ? 'pj' : ''}"><td class="pos">${inicio + i + 1}º</td><td><b>${saEsc(c.nome)}</b> <span class="num">${saEsc(c.numero)}</span>${bt(c, d ? d.uf : c.uf)}</td>`
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
  return `<div class="uf${sa.sel.has(d.uf) ? ' sel' : ''}${d.retotalizando ? ' retot-uf' : ''}">
    <div class="uf-cab"><b>${saEsc(d.nome)}</b> <span class="sigla">${d.uf === 'br' ? '' : d.uf.toUpperCase()}</span><span class="uf-pct">${saPct(d.pct)} das seções apuradas${d.final ? ' · <b>final</b>' : ''}</span>
      ${sa.falhas[d.uf] ? '<span class="aviso">sem resposta na última leitura</span>' : ''}
      ${d.retotalizando ? '<span class="aviso">⚠ em retotalização no TSE — eleitos ainda não marcados</span>' : ''}</div>
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

// Cláusula de barreira: sempre o Brasil todo (é nacional), com todos os partidos.
function saClausulaDados() {
  const ufs = Object.keys(AP_UFS).map(uf => sa.dados[uf]).filter(Boolean);
  const regra = apClausulaRegra(saOp().ano);
  const l = ufs.length && regra ? apClausula(ufs, regra) : [];
  return { ufs, l, regra, fora: l.filter(x => !x.atinge), pend: ufs.filter(d => !d.final && !d.retotalizando).map(d => d.uf.toUpperCase()),
    retot: ufs.filter(d => d.retotalizando).map(d => d.uf.toUpperCase()) };
}
function saPctF(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function saClNome(x) { return `<b>${saEsc(x.nome)}</b>${x.federacao ? ` <span class="num">(${saEsc(x.siglas.join(', '))})</span>` : ''}`; }
function saPctR(n) { return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
function saClRegra(R) {
  return `${saEsc(R.base)} — regra de ${R.ano}. Atinge quem tiver <b>${saPctR(R.pctBR)} dos votos válidos do país, com pelo menos ${saPctR(R.pctUF)} em ${R.ufs} estados</b>,
    ou quem eleger <b>${R.eleitos} deputados federais em pelo menos ${R.ufs} estados</b>.${R.ano >= 2022 ? ' Federação conta como um partido só (Lei 14.208/2021).' : ''}`;
}
function saClAviso(cd) {
  return (cd.ufs.length < 27 ? `Só ${cd.ufs.length} de 27 estados lidos — resultado parcial. ` : '')
    + (cd.pend.length ? `Totalização do TSE pendente em ${saEsc(cd.pend.join(', '))}: os eleitos dali entram por projeção (mais votados dentro das vagas do partido/federação). ` : '')
    + (cd.retot.length ? `Em retotalização no TSE: ${saEsc(cd.retot.join(', '))} — sem vagas nem eleitos marcados até o TSE concluir, os eleitos dali não entram na contagem de eleitos (os votos entram).` : '');
}
// Os três números da cláusula, cada um com o mínimo exigido.
function saClNumeros(x, R) {
  const n = (v, rot, min, ok) => `<div class="cl-num ${ok ? 'ok' : 'nao'}"><div class="v">${v}</div><div class="l">${rot}</div><div class="m">${min}</div></div>`;
  return `<div class="cl-nums">${n(saPctF(x.pct), 'dos votos válidos no país', `mínimo ${saPctR(R.pctBR)}`, x.pct >= R.pctBR)}`
    + n(x.ufsMin, `estados com ${saPctR(R.pctUF)} ou mais`, `mínimo ${R.ufs}`, x.ufsMin >= R.ufs)
    + n(`${x.eleitos.length} <small>em ${x.ufsEleitos} UF${x.ufsEleitos === 1 ? '' : 's'}</small>`, 'deputados eleitos', `mínimo ${R.eleitos} em ${R.ufs} estados`, x.atingeB) + '</div>'
    + (x.proxima ? `<div class="cl-quase">Faltou ${saPctR(R.pctUF)} em mais ${R.ufs - x.ufsMin} estado — o mais perto: ${x.proxima.uf.toUpperCase()} com ${saPctF(x.proxima.pct)}.</div>` : '');
}
function saClTabela(cd) {
  const linha = x => `<tr class="${x.atinge ? '' : 'cl-fora'}"><td>${x.atinge ? '<span class="cl-ok">✓ atinge</span>' : '<span class="cl-nao">✗ não atinge</span>'}</td>
    <td>${saClNome(x)}${x.proxima ? `<div class="cl-quase">faltou ${saPctR(cd.regra.pctUF)} em mais ${cd.regra.ufs - x.ufsMin} UF — a mais perto: ${x.proxima.uf.toUpperCase()} com ${saPctF(x.proxima.pct)}</div>` : ''}</td>
    <td class="r">${saFmt(x.votos)}</td><td class="r">${saPctF(x.pct)}</td><td class="r">${x.ufsMin}</td><td class="r">${x.eleitos.length}${x.projetados ? ` <span class="num">(${x.projetados} proj.)</span>` : ''}</td><td class="r">${x.ufsEleitos}</td>
    <td>${[x.atingeA ? 'votos' : '', x.atingeB ? 'eleitos' : ''].filter(Boolean).join(' e ') || '—'}</td></tr>`;
  return `<div class="tab-rolagem"><table><tr><th></th><th>Partido / federação</th><th class="r">Votos</th><th class="r">% no país</th><th class="r">Estados ≥ ${saPctR(cd.regra.pctUF)}</th><th class="r">Eleitos</th><th class="r">Estados c/ eleito</th><th>Atinge por</th></tr>${cd.l.map(linha).join('')}</table></div>`;
}
function saClDeputados(x) {
  return `<div class="tab-rolagem"><table><tr><th></th><th>Deputado(a)</th><th>Partido</th><th>UF</th><th class="r">Votos</th><th>Situação</th></tr>
    ${x.eleitos.map((c, i) => `<tr class="${c.eleito ? 'el' : 'pj'}"><td class="pos">${i + 1}º</td><td><b>${saEsc(c.nome)}</b> <span class="num">${saEsc(c.numero)}</span></td><td class="pt">${saEsc(c.partido)}</td><td>${c.uf.toUpperCase()}</td><td class="r">${saFmt(c.votos)}</td><td>${saSit(c, false)}</td></tr>`).join('')}</table></div>`;
}
function saClBlocos(cd) {
  return cd.fora.filter(x => x.eleitos.length).map(x => `<div class="uf cl-bloco"><div class="uf-cab">${saClNome(x)}<span class="uf-pct cl-nao">não atinge a cláusula</span></div>
    ${saClNumeros(x, cd.regra)}${saClDeputados(x)}</div>`).join('');
}
function saClausulaHtml() {
  const cd = saClausulaDados();
  if (!cd.ufs.length) return '<div class="vazio grande">Lendo os resultados do TSE…</div>';
  const comEleitos = cd.fora.filter(x => x.eleitos.length), aviso = saClAviso(cd);
  return `<div class="uf"><div class="uf-cab"><b>Cláusula de barreira ${cd.regra.ano} — Câmara dos Deputados</b><span class="uf-pct">${cd.l.length - cd.fora.length} atingem · <span class="cl-nao">${cd.fora.length} não</span></span>
      <button id="saClPdf" class="cl-pdf">⬇ Gerar PDF</button></div>
    <div class="cl-regra">${saClRegra(cd.regra)} ${aviso ? `<span class="aviso">${aviso}</span>` : ''}</div>${saClTabela(cd)}</div>
    ${comEleitos.length ? `<div class="uf-cab" style="margin:14px 2px 8px"><b>Eleitos por partidos/federações que não atingiram a cláusula</b><span class="uf-pct cl-nao">${comEleitos.reduce((s, x) => s + x.eleitos.length, 0)} deputados</span></div>${saClBlocos(cd)}` : ''}`;
}

// PDF: o relatório vai para #saImpressao (tema claro, com a logo) e o navegador
// imprime só ele — "Salvar como PDF" no computador, no Android e no iPhone.
async function saClausulaPdf() {
  const cd = saClausulaDados();
  if (!cd.ufs.length) return;
  const comEleitos = cd.fora.filter(x => x.eleitos.length), aviso = saClAviso(cd);
  const logo = (document.querySelector('.topo img') || {}).src || '';
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const datas = [...new Set(cd.ufs.map(d => d.atualizado).filter(Boolean))].sort((a, b) => {
    const t = s => s.replace(/(\d+)\/(\d+)\/(\d+) (.*)/, '$3$2$1 $4'); return t(a) < t(b) ? -1 : 1; });
  let el = saEl('saImpressao');
  if (!el) { el = document.createElement('div'); el.id = 'saImpressao'; document.body.appendChild(el); }
  el.innerHTML = `<div class="imp-cab">${logo ? `<img src="${logo}" alt="Podemos">` : ''}<div><div class="imp-org">Liderança do Podemos na Câmara dos Deputados</div>
      <h1>Cláusula de barreira ${cd.regra.ano} — Câmara dos Deputados</h1>
      <div class="imp-sub">Resultado das eleições de ${saEsc(saOp().data || saOp().ano)} · fonte: TSE (divulgação oficial) · dados até ${saEsc(datas[datas.length - 1] || '—')} · gerado em ${saEsc(agora)}</div></div></div>
    <div class="imp-filete"></div>
    <p class="cl-regra">${saClRegra(cd.regra)}</p>
    ${aviso ? `<p class="imp-aviso">${aviso}</p>` : ''}
    <div class="imp-resumo"><b>${cd.l.length - cd.fora.length}</b> partidos/federações atingem a cláusula · <b>${cd.fora.length}</b> não atingem
      · <b>${comEleitos.reduce((s, x) => s + x.eleitos.length, 0)}</b> deputados eleitos por quem não atingiu.</div>
    <h2>Partidos e federações</h2>${saClTabela(cd)}
    ${comEleitos.length ? `<h2 class="imp-quebra">Eleitos por partidos/federações que não atingiram a cláusula</h2>${saClBlocos(cd)}` : ''}
    <div class="imp-rodape">Painel desenvolvido pela Liderança do Podemos na Câmara dos Deputados. "Eleito (projeção)": mais votados do partido/federação dentro das vagas
      que o TSE informa enquanto a totalização não termina; a marcação oficial do TSE prevalece.</div>`;
  const titulo = document.title;
  document.title = `Clausula de barreira ${cd.regra.ano} - ` + new Date().toISOString().slice(0, 10);
  const volta = () => { document.title = titulo; window.removeEventListener('afterprint', volta); };
  window.addEventListener('afterprint', volta);
  // A logo acabou de entrar na página: imprime só depois de ela carregar.
  await Promise.all([...el.querySelectorAll('img')].map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => {})));
  window.print();
}

// Seletores de eleição e de cargo, conforme as eleições que o TSE publica.
function saOpcoesEleicao() {
  const se = saEl('saEleicao'), sc = saEl('saCargo');
  const rot = o => `${o.ano} · ${o.turno}º turno${o.data ? ' (' + o.data + ')' : ''}${o.previsto ? ' — aguardando o TSE' : ''}`;
  const chaveE = sa.eleicoes.map(o => o.id).join(',');
  if (se.dataset.chave !== chaveE) { se.innerHTML = sa.eleicoes.map(o => `<option value="${saEsc(o.id)}">${saEsc(rot(o))}</option>`).join(''); se.dataset.chave = chaveE; }
  se.value = saOp().id;
  const cargos = saCargosDaOp(), chaveC = cargos.join(',');
  if (sc.dataset.chave !== chaveC) { sc.innerHTML = cargos.map(k => `<option value="${k}">${saEsc(SA_CARGOS[k].nome)}</option>`).join(''); sc.dataset.chave = chaveC; }
  sc.value = sa.cargo;
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
  const retot = c.nacional ? [] : escopo.filter(d => d.retotalizando);
  saRetotAviso(retot);
  saEl('saCards').innerHTML = card(saPct(secoes ? 100 * apuradas / secoes : 0), `seções apuradas — ${saEsc(onde)}`, 'ama')
    + card(saFmt(votos), `votos nominais — ${saEsc(saPartidoNome())}`, 'ver')
    + card(eleitos, (c.nacional || c.cargo === 3 || c.cargo === 5 ? 'à frente / eleitos' : 'eleitos + projetados')
      + (retot.length ? ` <span class="aviso">— sem ${saEsc(retot.map(d => d.uf.toUpperCase()).join(', '))} (retotalização)</span>` : ''), 'ver')
    + card(`${escopo.filter(d => d.final || d.pct >= 100).length}/${escopo.length || (sa.sel.size || 27)}`, 'estados com 100% apurado');
  saEl('saMapa').innerHTML = saMapa();
  saEl('saSel').innerHTML = sa.sel.size
    ? [...sa.sel].map(u => `<button class="chip" data-tira="${u}" title="Tirar do filtro">${u.toUpperCase()} ✕</button>`).join('') + '<button class="chip limpar" data-tira="*">Brasil todo</button>'
    : '<span class="chip neutro">Brasil todo</span>';
  saOpcoesEleicao();
  saOpcoesPartido();
  const temClausula = sa.cargo === '6' && !!apClausulaRegra(saOp().ano);
  if (sa.visao === 'clausula' && !temClausula) sa.visao = 'ufs';
  saEl('saVisaoClausula').style.display = temClausula ? '' : 'none';
  document.querySelectorAll('[data-visao]').forEach(b => b.classList.toggle('ativo', b.dataset.visao === sa.visao));
  saEl('saSoEleitosCx').style.display = sa.visao === 'ufs' ? '' : 'none';
  saEl('saMapa').parentNode.classList.toggle('so-lista', sa.visao === 'clausula');   // tabela larga: sem o mapa
  saEl('saTitulo').textContent = `Apuração ${saNomeEleicao()} · ${c.nome}${sa.partido ? ' · ' + saPartidoNome() : ''}`;
  document.title = `Apuração ${saNomeEleicao()} · Liderança do Podemos`;
  if (!escopo.length && !sa.br) {
    const nada = sa.totalArquivos && sa.naoPublicados >= sa.totalArquivos;
    saEl('saLista').innerHTML = `<div class="vazio grande">${nada ? `O TSE ainda não publicou resultados de ${saEsc(c.nome.toLowerCase())} nesta eleição (${saEsc(saNomeEleicao())}). O painel continua verificando a cada 30 s.` : 'Lendo os resultados do TSE…'}</div>`;
    saStatus(); return;
  }
  if (sa.visao === 'clausula') saEl('saLista').innerHTML = saClausulaHtml();
  else if (sa.visao === 'eleitos') saEl('saLista').innerHTML = saEleitosHtml();
  else {
    const blocos = (usaBr ? [sa.br] : []).concat(escopo.sort((a, b) => a.nome.localeCompare(b.nome)));
    saEl('saLista').innerHTML = blocos.map(saBlocoUF).join('') || '<div class="vazio grande">Nenhum candidato com esse filtro.</div>';
  }
  saStatus();
}

/** Aviso no topo: estados em retotalização no TSE (qualquer UF, qualquer cargo). */
function saRetotAviso(retot) {
  const el = saEl('saRetot');
  if (!el) return;
  el.hidden = !retot.length;
  if (!retot.length) { el.innerHTML = ''; return; }
  const nomes = retot.map(d => `<b>${saEsc(d.nome)}</b> (desde ${saEsc(d.atualizado || '—')})`).join(', ');
  const um = retot.length === 1;
  const votos = sa.partido ? retot.map(d => {
    const p = d.partidos.find(x => x.numero === sa.partido);
    return p ? `${d.uf.toUpperCase()}: ${saFmt(p.total)} votos do ${saEsc(p.sigla)}` : '';
  }).filter(Boolean).join(' · ') : '';
  el.innerHTML = `<b class="t">⚠ ${um ? 'Estado' : 'Estados'} em retotalização no TSE:</b> ${nomes}. Enquanto retotaliza, o TSE publica ${um ? 'o estado' : 'os estados'}
    sem vagas e sem nenhum eleito marcado — por isso os eleitos dali não aparecem nas contagens desta tela (nem por projeção).
    Os números voltam sozinhos quando o TSE concluir; o resultado pode mudar.${votos ? ` <span class="num">${votos}</span>` : ''}`;
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
  const trocar = async () => {
    sa.dados = {}; sa.br = null; sa.falhas = {}; sa.doCache = false; sa.totalArquivos = 0; sa.naoPublicados = 0;
    saRender(); await saLerTudo(); saAgendar();
  };
  saEl('saCargo').addEventListener('change', ev => { sa.cargo = ev.target.value; trocar(); });
  saEl('saEleicao').addEventListener('change', ev => {
    sa.eleicaoId = ev.target.value; sa.sel.clear(); saAjustarCargo();
    sa.partido = saOp().turno === 2 ? '' : '20';      // 2º turno: são 2 candidatos por disputa, mostra todos
    trocar();
  });
  saEl('saPartido').addEventListener('change', ev => { sa.partido = ev.target.value; saGravar(); saRender(); });
  document.querySelectorAll('[data-visao]').forEach(b => b.addEventListener('click', () => { sa.visao = b.dataset.visao; saRender(); }));
  saEl('saSoEleitos').addEventListener('change', ev => { sa.soEleitos = ev.target.checked; saRender(); });
  saEl('saBusca').addEventListener('input', ev => { sa.busca = ev.target.value.trim(); saRender(); });
  saEl('saPausar').addEventListener('click', () => { sa.pausado = !sa.pausado; saAgendar(); });
  saEl('saLista').addEventListener('click', ev => {
    if (ev.target.closest('#saClPdf')) saClausulaPdf();
    else if (typeof aoClique === 'function') aoClique(ev);
  });
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
