'use strict';
// Labs · Apuração 2026 — deputados federais do Podemos, ao vivo.
//
// Fonte: divulgação oficial do TSE (resultados.tse.jus.br), arquivos públicos
// por UF, atualizados durante a apuração. A cada 30 s o painel relê os 27
// arquivos de Deputado Federal (com cache: 'no-cache' o navegador revalida e só
// baixa de novo o que mudou) e mostra:
//  - o mapa do Brasil, cada UF colorida pelo percentual de seções apuradas;
//  - por UF: percentual apurado, votos do partido, vagas e a lista dos
//    candidatos em ordem de votos, com a situação que o TSE informar.
// A eleição e o cargo são lidos da configuração do TSE (com os códigos de
// 2026 conferidos em 03/10 como reserva): se o TSE trocar o código, o painel
// acompanha.

const AP_BASE = 'https://resultados.tse.jus.br/oficial';
const AP_CICLO = 'ele2026';
const AP_ELEICAO_PADRAO = '6259';   // Eleição Ordinária Estadual 2026, 1º turno (conferido em 03/10/2026)
const AP_CARGO = 6;                 // Deputado Federal
const AP_PARTIDO = '20';            // Podemos
const AP_INTERVALO = 30000;
const AP_UFS = { ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo',
  go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco',
  pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul',
  sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins' };

const ap = { eleicao: AP_ELEICAO_PADRAO, dados: {}, falhas: {}, selecionada: '', filtro: '', pausado: false, timer: null, proxima: 0, lendo: false, ultimaLeitura: null, iniciado: false };

function apEl(id) { return document.getElementById(id); }
function apNum(s) { const n = parseFloat(String(s == null ? '' : s).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
function apFmt(n) { return Math.round(n).toLocaleString('pt-BR'); }
function apPct(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: n > 0 && n < 100 ? 2 : 0, maximumFractionDigits: 2 }) + '%'; }

/** Código da eleição de Deputado Federal no ciclo, pela configuração do TSE. Pura. */
function apEleicaoDaConfig(cfg) {
  const pl = ((cfg && cfg.pl) || []).find(p => p.c === AP_CICLO);
  if (!pl) return null;
  const e = (pl.e || []).find(x => (x.abr || []).some(a => (a.cp || []).some(c => +c.cd === AP_CARGO)) && String(x.t) === '1');
  return e ? String(e.cd) : null;
}

function apUrl(uf, eleicao = ap.eleicao) {
  const c = String(AP_CARGO).padStart(4, '0'), e = String(eleicao).padStart(6, '0');
  return `${AP_BASE}/${AP_CICLO}/${eleicao}/dados/${uf}/${uf}-c${c}-e${e}-u.json`;
}

/** Candidato eleito? O TSE marca "e":"s" e/ou descreve na situação ("Eleito por QP", "Eleito por média"…). */
function apEleito(c) {
  return c.e === 's' || (/eleit/i.test(c.st || '') && !/n[ãa]o eleit/i.test(c.st || ''));
}

/**
 * Lê o arquivo de uma UF. Pura. Devolve o percentual de seções apuradas, a hora
 * da divulgação e o partido (votos, vagas e candidatos em ordem de votos).
 */
function apLerUF(j, uf, partido = AP_PARTIDO) {
  const s = j.s || {};
  const cargo = (j.carg || [])[0] || {};
  let agr = null, par = null;
  for (const a of cargo.agr || []) {
    const p = (a.par || []).find(x => String(x.n) === String(partido));
    if (p) { agr = a; par = p; break; }
  }
  const candidatos = (par && par.cand || []).map(c => ({
    numero: c.n, nome: c.nmu || c.nm, nomeCompleto: c.nm, votos: apNum(c.vap), pct: apNum(c.pvap),
    eleito: apEleito(c), situacao: c.st || '' })).sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome));
  const nominais = par ? apNum(par.tvtn) : 0, legenda = par ? apNum(par.tvtl) : 0;
  return {
    uf, nome: AP_UFS[uf] || uf.toUpperCase(),
    secoes: apNum(s.ts), apuradas: apNum(s.st), pct: apNum(s.pst),
    atualizado: [j.dg, j.hg].filter(Boolean).join(' '), final: j.tf === 's',
    vagasUF: apNum(cargo.nv), quociente: apNum(cargo.qe),
    partido: par ? { sigla: par.sg, nominais, legenda, total: nominais + legenda,
      vagas: agr ? apNum(agr.vag) : 0, federacao: agr && agr.tp !== 'i' ? agr.nm : '' } : null,
    candidatos,
  };
}

/** Totais do Brasil a partir das UFs lidas. Pura. */
function apResumo(ufs) {
  const l = Object.values(ufs);
  const secoes = l.reduce((s, u) => s + u.secoes, 0), apuradas = l.reduce((s, u) => s + u.apuradas, 0);
  return {
    ufs: l.length, pct: secoes ? 100 * apuradas / secoes : 0,
    votos: l.reduce((s, u) => s + (u.partido ? u.partido.total : 0), 0),
    eleitos: l.reduce((s, u) => s + u.candidatos.filter(c => c.eleito).length, 0),
    vagas: l.reduce((s, u) => s + (u.partido ? u.partido.vagas : 0), 0),
    candidatos: l.reduce((s, u) => s + u.candidatos.length, 0),
    concluidas: l.filter(u => u.final || u.pct >= 100).length,
  };
}

/** Cor da UF pelo percentual apurado: cinza (0%) → verde do partido (100%). */
function apCor(pct) {
  if (!(pct > 0)) return '#2b3440';
  const t = Math.min(1, pct / 100), a = [0x3a, 0x4a, 0x3c], b = [0x00, 0xa8, 0x59];
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('');
}

// ---------- leitura periódica ----------

async function apDescobrirEleicao() {
  try {
    const r = await fetch(`${AP_BASE}/comum/config/ele-c.json`, { cache: 'no-cache' });
    if (r.ok) { const e = apEleicaoDaConfig(await r.json()); if (e) ap.eleicao = e; }
  } catch (_) { /* fica o código conferido */ }
}

async function apLerTudo() {
  if (ap.lendo) return;
  ap.lendo = true;
  apStatus();
  await Promise.all(Object.keys(AP_UFS).map(async uf => {
    try {
      const r = await fetch(apUrl(uf), { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      ap.dados[uf] = apLerUF(await r.json(), uf);
      delete ap.falhas[uf];
    } catch (e) { ap.falhas[uf] = e.message; }   // fica o último dado lido
  }));
  ap.lendo = false;
  ap.ultimaLeitura = new Date();
  apRender();
}

function apAgendar() {
  clearTimeout(ap.timer);
  if (ap.pausado) { apStatus(); return; }
  ap.proxima = Date.now() + AP_INTERVALO;
  ap.timer = setTimeout(async () => { await apLerTudo(); apAgendar(); }, AP_INTERVALO);
  apStatus();
}

async function apIniciar() {
  if (ap.iniciado) return;
  ap.iniciado = true;
  await apDescobrirEleicao();
  await apLerTudo();
  apAgendar();
  setInterval(apStatus, 1000);
}

// ---------- tela ----------

function apStatus() {
  const el = apEl('apStatus');
  if (!el) return;
  const hora = d => d ? d.toLocaleTimeString('pt-BR') : '—';
  const falhas = Object.keys(ap.falhas);
  const prox = ap.pausado ? 'pausado' : ap.lendo ? 'lendo agora…' : `próxima leitura em ${Math.max(0, Math.ceil((ap.proxima - Date.now()) / 1000))} s`;
  el.innerHTML = `<span class="ap-pulso${ap.lendo ? ' on' : ''}"></span> Atualiza a cada 30 s · ${prox} · última leitura ${hora(ap.ultimaLeitura)}`
    + (falhas.length ? ` · <span class="ap-falha" title="${labsEsc(falhas.map(u => u.toUpperCase() + ': ' + ap.falhas[u]).join('; '))}">${falhas.length} UF(s) sem resposta na última leitura (mantido o dado anterior)</span>` : '');
  apEl('apPausar').textContent = ap.pausado ? '▶ Retomar' : '⏸ Pausar';
}

function apMapaHtml() {
  const m = AP_MAPA;
  const pathes = Object.keys(m.uf).map(uf => {
    const d = ap.dados[uf];
    return `<path d="${m.uf[uf]}" fill="${apCor(d ? d.pct : 0)}" data-uf="${uf}" class="${ap.selecionada === uf ? 'sel' : ''}"><title>${labsEsc(AP_UFS[uf])}: ${d ? apPct(d.pct) + ' apurado' : 'sem dados'}</title></path>`;
  }).join('');
  const rotulos = Object.keys(m.centro).map(uf => {
    const d = ap.dados[uf], [x, y] = m.centro[uf];
    const el = d ? d.candidatos.filter(c => c.eleito).length : 0;
    const pequeno = ['df', 'se', 'al', 'rn', 'pb', 'es', 'rj'].includes(uf);
    return `<g class="ap-rot${pequeno ? ' peq' : ''}" data-uf="${uf}"><text x="${x}" y="${y - 2}">${uf.toUpperCase()}</text>`
      + `<text x="${x}" y="${y + 9}" class="pct">${d ? Math.floor(d.pct) + '%' : '–'}</text>`
      + (el ? `<circle cx="${x + 13}" cy="${y - 6}" r="6.5"></circle><text x="${x + 13}" y="${y - 3.2}" class="el">${el}</text>` : '') + '</g>';
  }).join('');
  return `<svg viewBox="0 0 ${m.w} ${m.h}" class="ap-svg" role="img" aria-label="Mapa do Brasil por percentual de urnas apuradas">${pathes}${rotulos}</svg>
    <div class="ap-legenda"><span>0%</span><i style="background:linear-gradient(90deg,${apCor(0.1)},${apCor(50)},${apCor(100)})"></i><span>100% das seções apuradas</span>
      <span class="ap-bola">n</span> eleitos do Podemos na UF</div>`;
}

function apUfHtml(d) {
  const p = d.partido;
  const situacao = c => c.eleito ? `<span class="ap-sit el">${labsEsc(c.situacao || 'Eleito')}</span>` : (c.situacao ? `<span class="ap-sit">${labsEsc(c.situacao)}</span>` : '');
  const linha = (c, i) => `<tr class="${c.eleito ? 'el' : ''}"><td class="pos">${i + 1}º</td><td><b>${labsEsc(c.nome)}</b> <span class="num">${labsEsc(c.numero)}</span></td>`
    + `<td class="r">${apFmt(c.votos)}</td><td class="r">${apPct(c.pct)}</td><td>${situacao(c)}</td></tr>`;
  const filtro = ap.filtro ? labsNorm(ap.filtro) : '';
  const cands = filtro ? d.candidatos.filter(c => labsNorm(c.nome + ' ' + c.nomeCompleto + ' ' + c.numero).includes(filtro)) : d.candidatos;
  const top = filtro ? cands : cands.slice(0, 10), resto = filtro ? [] : cands.slice(10);
  const falha = ap.falhas[d.uf] ? `<span class="ap-falha">sem resposta na última leitura</span>` : '';
  return `<div class="ap-uf${ap.selecionada === d.uf ? ' sel' : ''}" id="ap-uf-${d.uf}">
    <div class="ap-uf-cab"><b>${labsEsc(d.nome)}</b> <span class="ap-sigla">${d.uf.toUpperCase()}</span>
      <span class="ap-uf-pct">${apPct(d.pct)} das seções apuradas${d.final ? ' · <b>totalização final</b>' : ''}</span> ${falha}</div>
    <div class="ap-barra"><i style="width:${Math.min(100, d.pct)}%"></i></div>
    <div class="ap-uf-meta">${d.vagasUF} vagas na UF${d.quociente ? ` · quociente eleitoral ${apFmt(d.quociente)}` : ''}${p ? ` · Podemos: ${apFmt(p.total)} votos (${apFmt(p.nominais)} nominais + ${apFmt(p.legenda)} de legenda) · ${p.vagas} vaga(s)${p.federacao ? ' · federação ' + labsEsc(p.federacao) : ''}` : ''} · divulgação TSE ${labsEsc(d.atualizado || '—')}</div>
    ${!p ? '<div class="labs-custo">O Podemos não tem candidatos a deputado federal nesta UF.</div>'
      : !cands.length ? '<div class="labs-custo">Nenhum candidato com esse nome.</div>'
      : `<table class="labs-tab ap-tab"><tr><th></th><th>Candidato(a)</th><th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th></tr>${top.map(linha).join('')}</table>
        ${resto.length ? `<details class="ap-mais"><summary>ver os outros ${resto.length} candidatos</summary><table class="labs-tab ap-tab">${resto.map((c, i) => linha(c, i + 10)).join('')}</table></details>` : ''}`}
  </div>`;
}

function apRender() {
  const painel = apEl('apConteudo');
  if (!painel) return;
  const r = apResumo(ap.dados);
  const card = (k, v, rot) => `<div class="labs-card ${k}"><div class="v">${v}</div><div class="l">${rot}</div></div>`;
  apEl('apCards').innerHTML = card('f3', apPct(r.pct), 'seções apuradas no Brasil') + card('f5', apFmt(r.votos), 'votos do Podemos (dep. federal)')
    + card('f5', r.eleitos, 'eleitos até agora') + card('', `${r.concluidas}/27`, 'UFs com 100% apurado');
  apEl('apMapa').innerHTML = apMapaHtml();
  const ordem = Object.keys(AP_UFS).filter(uf => ap.dados[uf])
    .sort((a, b) => (b === ap.selecionada) - (a === ap.selecionada) || AP_UFS[a].localeCompare(AP_UFS[b]));
  const filtro = ap.filtro ? labsNorm(ap.filtro) : '';
  const visiveis = filtro ? ordem.filter(uf => ap.dados[uf].candidatos.some(c => labsNorm(c.nome + ' ' + c.nomeCompleto + ' ' + c.numero).includes(filtro))) : ordem;
  apEl('apLista').innerHTML = ordem.length ? (visiveis.map(uf => apUfHtml(ap.dados[uf])).join('') || '<div class="labs-custo">Nenhum candidato com esse nome.</div>')
    : '<div class="labs-custo">Lendo os resultados do TSE…</div>';
  apStatus();
}

function apSelecionar(uf) {
  ap.selecionada = ap.selecionada === uf ? '' : uf;
  apRender();
  const el = ap.selecionada && apEl('ap-uf-' + uf);
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (typeof document !== 'undefined' && apEl('apConteudo')) {
  apEl('apMapa').addEventListener('click', ev => { const t = ev.target.closest('[data-uf]'); if (t) apSelecionar(t.dataset.uf); });
  apEl('apPausar').addEventListener('click', () => { ap.pausado = !ap.pausado; apAgendar(); });
  apEl('apAgora').addEventListener('click', async () => { await apLerTudo(); apAgendar(); });
  apEl('apBusca').addEventListener('input', ev => { ap.filtro = ev.target.value.trim(); apRender(); });
  document.addEventListener('labs:aba', ev => { if (ev.detail === 'aba-apuracao') apIniciar(); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { apEleicaoDaConfig, apUrl, apLerUF, apResumo, apEleito, apCor, apNum };
}
