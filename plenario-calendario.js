// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';

// ── CALENDÁRIO DO PLENÁRIO ───────────────────────────────────────────────────
// No padrão do calendário da CCJC: o mês com as sessões deliberativas do Plenário (órgão 180); escolhida a
// sessão, o programa baixa a PAUTA OFICIAL dela (o PDF do link "Pauta" da página da sessão, o mesmo que a equipe
// baixava e carregava à mão) e importa pelo mesmo caminho do "Carregar pauta (PDF)" — importarPautaPdf, em
// analise.js. Ler o mesmo PDF pelo mesmo leitor garante que a pauta sai igual à carregada à mão.
//
// MEDIDO em 24/11/2026: a página da sessão 85464 (Sessão Deliberativa Extraordinária, 13h55) traz o link
// prop_mostrarintegra?codteor=3203668, que devolve application/pdf; o leitor da pauta leu os 13 itens, com a data
// e o tipo de sessão. A lista "Sessões e reuniões" do site com idOrgaosSuperiores=180 traz as sessões do mês
// (23 em nov/2026), o plano B quando a API de Dados Abertos cai.
//
// Usa de ccjc-blocos.js: buscarEventosMesSite, linkPautaDoEvento. Na página, usa de analise.js:
// importarPautaPdf, mostrarToast. Exportado para os testes (Node).

const PLEN_ORGAO_ID = 180;
const PLEN_API = 'https://dadosabertos.camara.leg.br/api/v2';
const PLEN_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Sessão deliberativa? A API diz "Sessão Deliberativa"; o site, "Sessão para a votação de propostas
 *  legislativas" (tipo) e "Sessão Deliberativa Extraordinária…" (nome). Solene é "Sessão Não Deliberativa". */
function plenEhDeliberativa(texto) {
  const t = String(texto || '');
  return /deliberativa|vota[çc][ãa]o de propostas/i.test(t) && !/n[ãa]o\s+deliberativa/i.test(t);
}

const _plenDd = n => String(n).padStart(2, '0');

/** Sessões deliberativas do mês: { 'aaaa-mm-dd': [{ id, dataHoraInicio, descricao, situacao, local }], __fonte? }.
 *  API de Dados Abertos; se ela falhar, a lista "Sessões e reuniões" do site da Câmara. */
async function plenEventosMes(ano, mes, fetchFn = fetch) {
  const ini = `${ano}-${_plenDd(mes + 1)}-01`;
  const fim = `${ano}-${_plenDd(mes + 1)}-${_plenDd(new Date(ano, mes + 1, 0).getDate())}`;
  const url = `${PLEN_API}/eventos?idOrgao=${PLEN_ORGAO_ID}&dataInicio=${ini}&dataFim=${fim}&itens=100&ordem=ASC&ordenarPor=dataHoraInicio`;
  let json;
  try {
    const r = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    json = await r.json();
  } catch (e) {
    if (typeof buscarEventosMesSite !== 'function') throw e;
    const motivo = e.name === 'TimeoutError' ? 'tempo esgotado' : e.message;
    const mapa = await buscarEventosMesSite(ano, mes, fetchFn,
      { idOrgao: PLEN_ORGAO_ID, deliberativa: ev => plenEhDeliberativa(`${ev.tipo} ${ev.nome}`) });
    mapa.__fonte = `site da Câmara (API: ${motivo})`;
    return mapa;
  }
  const mapa = {};
  for (const ev of (json.dados || [])) {
    if (!plenEhDeliberativa(ev.descricaoTipo)) continue;
    const data = String(ev.dataHoraInicio || '').slice(0, 10);
    if (!data) continue;
    (mapa[data] = mapa[data] || []).push({
      id: ev.id,
      dataHoraInicio: ev.dataHoraInicio || '',
      descricao: String(ev.descricao || '').trim(),
      situacao: ev.situacao || '',
      local: ev.localCamara?.nome || '',
    });
  }
  return mapa;
}

/** PDF da pauta oficial da sessão: { url, buffer } ou null quando a página da sessão ainda não tem o link. */
async function plenPdfDaSessao(eventoId, fetchFn = fetch) {
  const pg = await fetchFn(`https://www.camara.leg.br/evento-legislativo/${eventoId}`);
  if (!pg.ok) throw new Error(`página da sessão: HTTP ${pg.status}`);
  const url = linkPautaDoEvento(await pg.text());
  if (!url) return null;
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`pauta oficial: HTTP ${r.status}`);
  const buffer = await r.arrayBuffer();
  // O link às vezes leva a uma página de erro em HTML com status 200: sem a assinatura %PDF, não é a pauta.
  if (String.fromCharCode(...new Uint8Array(buffer.slice(0, 5))) !== '%PDF-') {
    throw new Error('o link da pauta oficial não devolveu um PDF');
  }
  return { url, buffer };
}

/** Nome do arquivo da pauta baixada (aparece como pdfNome, igual ao nome do PDF escolhido à mão). */
function plenNomeArquivo(dataISO, ev) {
  const [a, m, d] = String(dataISO).split('-');
  const hora = String(ev?.dataHoraInicio || '').slice(11, 16).replace(':', 'h');
  return `pauta-plenario-${d}-${m}-${a}${hora ? `-${hora}` : ''}.pdf`;
}

// ── TELA ─────────────────────────────────────────────────────────────────────
const plenCal = { ano: new Date().getFullYear(), mes: new Date().getMonth(), eventos: {}, cache: {}, fonte: '',
  dia: null, sessao: null, carregando: false };

function _plenEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plenCalIniciar() {
  const $ = id => document.getElementById(id);
  if (!$('modal-calendario-plen')) return;
  $('btn-calendario-plen').addEventListener('click', plenCalAbrir);
  $('plcal-prev').addEventListener('click', () => plenCalNavegar(-1));
  $('plcal-next').addEventListener('click', () => plenCalNavegar(1));
  $('plcal-carregar').addEventListener('click', plenCalCarregarPauta);
}

async function plenCalAbrir() {
  document.getElementById('modal-calendario-plen').style.display = 'flex';
  plenCalRenderizar();
  await plenCalAtualizar();
}

async function plenCalNavegar(delta) {
  plenCal.mes += delta;
  if (plenCal.mes < 0) { plenCal.mes = 11; plenCal.ano--; }
  if (plenCal.mes > 11) { plenCal.mes = 0; plenCal.ano++; }
  plenCal.dia = null; plenCal.sessao = null;
  document.getElementById('plcal-card').style.display = 'none';
  await plenCalAtualizar();
}

async function plenCalAtualizar() {
  const status = document.getElementById('plcal-status');
  const chave = `${plenCal.ano}-${plenCal.mes}`;
  // Cache da tela por 10 min: reabrir o calendário não consulta a Câmara de novo; a pauta de amanhã pode
  // aparecer ao longo do dia, então não fica mais do que isso.
  const c = plenCal.cache[chave];
  if (c && Date.now() - c.em < 600000) {
    plenCal.eventos = c.eventos; plenCal.fonte = c.fonte;
    plenCalRenderizar(); plenCalStatusContagem(); return;
  }
  plenCal.eventos = {}; plenCal.carregando = true;
  status.textContent = 'Buscando as sessões deliberativas do Plenário…';
  plenCalRenderizar();
  try {
    const mapa = await plenEventosMes(plenCal.ano, plenCal.mes);
    plenCal.fonte = mapa.__fonte || ''; delete mapa.__fonte;
    plenCal.eventos = mapa;
    plenCal.cache[chave] = { eventos: mapa, fonte: plenCal.fonte, em: Date.now() };
    plenCalStatusContagem();
  } catch (e) {
    status.textContent = `Não consegui buscar as sessões (${e.message}). Tente de novo ou carregue a pauta pelo PDF.`;
  } finally {
    plenCal.carregando = false;
    plenCalRenderizar();
  }
}

function plenCalStatusContagem() {
  const n = Object.values(plenCal.eventos).reduce((s, a) => s + a.length, 0);
  document.getElementById('plcal-status').textContent =
    (n ? `${n} ${n > 1 ? 'sessões deliberativas' : 'sessão deliberativa'} neste mês` : 'Nenhuma sessão deliberativa neste mês') +
    (plenCal.fonte ? ` — pelo ${plenCal.fonte}` : '');
}

function plenCalRenderizar() {
  const { ano, mes, eventos, dia } = plenCal;
  document.getElementById('plcal-titulo').textContent = `${PLEN_MESES[mes]} ${ano}`;
  const hoje = new Date();
  const hojeStr = `${hoje.getFullYear()}-${_plenDd(hoje.getMonth() + 1)}-${_plenDd(hoje.getDate())}`;
  let html = '';
  for (let i = 0; i < new Date(ano, mes, 1).getDay(); i++) html += '<div class="cal-dia vazio"></div>';
  for (let d = 1; d <= new Date(ano, mes + 1, 0).getDate(); d++) {
    const ds = `${ano}-${_plenDd(mes + 1)}-${_plenDd(d)}`;
    const cls = ['cal-dia', eventos[ds] ? 'tem-reuniao' : '', ds === hojeStr ? 'hoje' : '', ds === dia ? 'selecionado' : '']
      .filter(Boolean).join(' ');
    html += `<div class="${cls}" data-data="${ds}">${d}${eventos[ds] ? '<span class="cal-dot"></span>' : ''}</div>`;
  }
  const grade = document.getElementById('plcal-grade');
  grade.innerHTML = html;
  grade.querySelectorAll('.cal-dia.tem-reuniao').forEach(el =>
    el.addEventListener('click', () => plenCalSelecionarDia(el.dataset.data)));
}

function plenCalSelecionarDia(ds) {
  plenCal.dia = ds; plenCal.sessao = null;
  plenCalRenderizar();
  const evs = plenCal.eventos[ds] || [];
  if (evs.length === 1) plenCalMostrarSessao(ds, evs[0]);
  else plenCalEscolherSessao(ds, evs);
}

function _plenDataBr(ds) { const [a, m, d] = ds.split('-'); return `${d}/${m}/${a}`; }

function plenCalMostrarSessao(ds, ev) {
  plenCal.sessao = ev;
  const hora = String(ev.dataHoraInicio || '').slice(11, 16);
  document.getElementById('plcal-tipo').textContent = 'Sessão Deliberativa';
  document.getElementById('plcal-data').textContent = `${_plenDataBr(ds)}${hora ? ` · ${hora}` : ''}`;
  document.getElementById('plcal-info').textContent = ev.descricao || ev.local || '';
  document.getElementById('plcal-situacao').textContent = ev.situacao || '';
  document.getElementById('plcal-aviso').textContent = '';
  document.getElementById('plcal-carregar').style.display = '';
  document.getElementById('plcal-card').style.display = '';
}

function plenCalEscolherSessao(ds, evs) {
  document.getElementById('plcal-tipo').textContent = `${evs.length} sessões neste dia`;
  document.getElementById('plcal-data').textContent = `${_plenDataBr(ds)} — escolha uma:`;
  document.getElementById('plcal-info').textContent = '';
  document.getElementById('plcal-aviso').textContent = '';
  const sit = document.getElementById('plcal-situacao');
  sit.innerHTML = evs.map((ev, i) => `<button class="cal-reuniao-opcao btn btn-outline btn-sm" data-idx="${i}"
      style="display:block;width:100%;margin-bottom:6px;text-align:left">
      <strong>${_plenEsc(String(ev.dataHoraInicio || '').slice(11, 16) || '??:??')}</strong> · ${_plenEsc(ev.descricao || '')}<br>
      <span style="font-size:11px;opacity:.7">${_plenEsc(ev.situacao || '')}</span></button>`).join('');
  sit.querySelectorAll('.cal-reuniao-opcao').forEach(b =>
    b.addEventListener('click', () => plenCalMostrarSessao(ds, evs[+b.dataset.idx])));
  document.getElementById('plcal-carregar').style.display = 'none';
  document.getElementById('plcal-card').style.display = '';
}

async function plenCalCarregarPauta() {
  const ev = plenCal.sessao, ds = plenCal.dia;
  if (!ev || !ds) return;
  const btn = document.getElementById('plcal-carregar');
  const aviso = document.getElementById('plcal-aviso');
  btn.disabled = true; btn.textContent = '⏳ Baixando a pauta…'; aviso.textContent = '';
  try {
    const pdf = await plenPdfDaSessao(ev.id);
    if (!pdf) {
      aviso.textContent = 'A Câmara ainda não publicou a pauta desta sessão na página dela. Tente mais tarde ou carregue o PDF.';
      return;
    }
    document.getElementById('modal-calendario-plen').style.display = 'none';
    mostrarToast('Lendo a pauta da sessão…', 'info');
    await importarPautaPdf(pdf.buffer, plenNomeArquivo(ds, ev), { eventoId: String(ev.id), url: pdf.url, data: ds });
  } catch (e) {
    console.error(e);
    aviso.textContent = `Não consegui carregar a pauta: ${e.message}`;
    mostrarToast('Erro ao carregar a pauta da sessão: ' + e.message, 'erro');
  } finally {
    btn.disabled = false; btn.textContent = 'Carregar a pauta desta sessão';
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', plenCalIniciar);
  else plenCalIniciar();
}

if (typeof module !== 'undefined') {
  module.exports = { plenEhDeliberativa, plenEventosMes, plenPdfDaSessao, plenNomeArquivo, PLEN_ORGAO_ID };
}
