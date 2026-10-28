'use strict';

// ── PRINTS DA SESSÃO ─────────────────────────────────────────────────────────
// Os prints de votação nominal que o bot manda no grupo, aqui no Painel de
// Votação. O bot grava o placar de cada print em
// /bot/monitor_sessao/{evento}/prints/{item} (monitor.js) e esta aba desenha o
// MESMO print com o mesmo código (bot/src/imagem-svg.js → canvas → PNG).
// Na sessão de hoje, a aba consulta o Firebase a cada PRINTS_POLL_MS: o print
// aparece aqui na mesma hora em que vai ao grupo, e a aba avisa quantos novos
// chegaram enquanto você estava em outra.

const PRINTS_FB = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const PRINTS_POLL_MS = 15000;
const PRINTS_SESSOES_MS = 120000;   // sessão nova no dia (a 2ª sessão começa depois)

const prints = { data: '', sessoes: [], sessoesEm: 0, vistos: new Set(), novos: 0, timer: null, seq: 0, ocupado: false };

async function printsFb(caminho, query = '') {
  const r = await fetch(`${PRINTS_FB}${caminho}.json${query}`);
  if (!r.ok) throw new Error('Firebase HTTP ' + r.status);
  return r.json();
}

function printsHoje() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Sessões do dia que o bot acompanhou. As chaves de /bot/monitor_sessao são os
 * ids dos eventos da Câmara, que crescem com o tempo: lê das mais novas para
 * trás, em lotes, até passar da data.
 */
async function printsSessoesDoDia(dataISO) {
  const chaves = Object.keys(await printsFb('/bot/monitor_sessao', '?shallow=true') || {})
    .filter(k => /^\d+$/.test(k)).sort((a, b) => b - a);
  const achadas = [];
  for (let i = 0; i < chaves.length; i += 8) {
    const lote = chaves.slice(i, i + 8);
    const datas = await Promise.all(lote.map(k => printsFb(`/bot/monitor_sessao/${k}/dataISO`).catch(() => null)));
    lote.forEach((k, j) => { if (datas[j] === dataISO) achadas.push(k); });
    if (datas.every(d => d && d < dataISO)) break;
  }
  return achadas;
}

/** Placar como o desenho espera (o Firebase não guarda lista vazia). */
function printsNormalizar(pl) {
  const zeros = { sim: 0, nao: 0, abstencao: 0, art17: 0, obstrucao: 0 };
  return Object.assign({}, pl, {
    global: Object.assign({}, zeros, pl.global),
    parcial: Object.assign({ ausente: 0 }, zeros, pl.parcial),
    bancada: Array.isArray(pl.bancada) ? pl.bancada : Object.values(pl.bancada || {}),
  });
}

/** O print em PNG: o SVG do bot desenhado num canvas em 2× (o bot rasteriza a 144 dpi). */
async function printsPng(pl) {
  const { svg, largura, altura } = ImagemVotacao.svgVotacao(printsNormalizar(pl));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = largura * 2; c.height = altura * 2;
    const g = c.getContext('2d');
    g.scale(2, 2);
    g.drawImage(img, 0, 0, largura, altura);
    return await new Promise((ok, erro) => c.toBlob(b => (b ? ok(b) : erro(new Error('canvas vazio'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function printsEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function printsAviso(msg, tipo) {
  const el = document.getElementById('printsStatus');
  el.className = 'status' + (tipo ? ' ' + tipo : '');
  el.innerHTML = msg;
}

function printsMarcarNovos(n) {
  prints.novos = n;
  const el = document.getElementById('printsNovos');
  el.hidden = !n;
  el.textContent = n ? String(n) : '';
  document.title = (n ? `(${n}) ` : '') + 'Plenário — Votação · Podemos';
}

/** Um card por print: título, imagem, legenda do bot e as ações. */
async function printsCard(chave, p) {
  const pl = p.placar || {};
  const titulo = pl.proposicao || pl.descricao || 'Votação';
  const card = document.createElement('div');
  card.className = 'print-card';
  card.dataset.chave = chave;
  card.dataset.ts = p.ts || 0;
  card.innerHTML =
    `<div class="print-cab"><b>${printsEsc(titulo)}</b><span>${printsEsc(pl.hora || '')}</span></div>` +
    '<img class="print-img" alt="Print da votação">' +
    (p.legenda ? `<div class="print-legenda">${printsEsc(p.legenda)}</div>` : '') +
    '<div class="print-acoes">' +
      '<button class="btn btn-sm" data-acao="copiar">Copiar imagem</button>' +
      '<button class="btn btn-sm btn-sec" data-acao="baixar">Baixar</button>' +
      (p.legenda ? '<button class="btn btn-sm btn-sec" data-acao="legenda">Copiar legenda</button>' : '') +
    '</div>';
  let blob;
  try { blob = await printsPng(pl); }
  catch (e) {
    card.querySelector('.print-img').replaceWith(Object.assign(document.createElement('p'),
      { className: 'help-text', textContent: 'Não consegui desenhar este print: ' + e.message }));
    return card;
  }
  const url = URL.createObjectURL(blob);
  const img = card.querySelector('.print-img');
  img.src = url;
  img.addEventListener('click', () => window.open(url, '_blank'));
  const arquivo = `votacao-${String(pl.sigla || 'pode').toLowerCase()}-${pl.data || ''}-${String(pl.hora || '').replace(':', 'h')}.png`;
  card.querySelector('.print-acoes').addEventListener('click', async ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    const rotulo = b.textContent;
    const feito = txt => { b.textContent = txt; setTimeout(() => { b.textContent = rotulo; }, 1800); };
    try {
      if (b.dataset.acao === 'copiar') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        feito('Copiada ✓');
      } else if (b.dataset.acao === 'legenda') {
        await navigator.clipboard.writeText(p.legenda);
        feito('Copiada ✓');
      } else if (b.dataset.acao === 'baixar') {
        const a = document.createElement('a');
        a.href = url; a.download = arquivo; a.click();
      }
    } catch (e) { feito('Não deu: ' + e.message); }
  });
  return card;
}

/**
 * Lê os prints da data e põe na lista os que ainda não estão (mais novo em
 * cima). `primeira`: a carga ao abrir ou trocar a data — o que vem nela não
 * conta como novo.
 */
async function printsAtualizar(primeira) {
  const seq = prints.seq;
  const dataISO = prints.data;
  if (primeira || !prints.sessoes.length || (dataISO === printsHoje() && Date.now() - prints.sessoesEm > PRINTS_SESSOES_MS)) {
    prints.sessoes = await printsSessoesDoDia(dataISO);
    prints.sessoesEm = Date.now();
  }
  const lidos = [];
  for (const s of prints.sessoes) {
    const ps = await printsFb(`/bot/monitor_sessao/${s}/prints`).catch(() => null);
    for (const [item, p] of Object.entries(ps || {})) if (p && p.placar) lidos.push([s + '/' + item, p]);
  }
  if (seq !== prints.seq) return;   // a data mudou no meio da leitura
  const lista = document.getElementById('printsLista');
  const novos = lidos.filter(([k]) => !prints.vistos.has(k)).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  for (const [k, p] of novos) {
    prints.vistos.add(k);
    const card = await printsCard(k, p);
    if (seq !== prints.seq) return;
    if (!primeira) card.classList.add('novo');
    lista.prepend(card);
  }
  if (!primeira && novos.length && !document.getElementById('tabPrints').classList.contains('active')) {
    printsMarcarNovos(prints.novos + novos.length);
  }
  const hoje = dataISO === printsHoje();
  if (!prints.vistos.size) {
    printsAviso(!prints.sessoes.length
      ? (hoje ? 'O bot ainda não acompanhou sessão hoje. Os prints aparecem aqui quando ele mandar no grupo.' : 'O bot não acompanhou sessão nesta data.')
      : (hoje ? 'Nenhuma votação nominal encerrada ainda. Os prints aparecem aqui quando o bot mandar no grupo.' : 'Nenhum print nesta data.'), 'info');
  } else {
    printsAviso(`${prints.vistos.size} print${prints.vistos.size > 1 ? 's' : ''}` + (hoje ? ' · atualiza sozinho' : ''), 'info');
  }
}

function printsTrocarData(dataISO) {
  prints.data = dataISO;
  prints.seq++;
  prints.sessoes = [];
  prints.vistos = new Set();
  printsMarcarNovos(0);
  document.getElementById('printsLista').innerHTML = '';
  printsAviso('<div class="spinner"></div><br>Buscando os prints…');
  clearInterval(prints.timer);
  prints.ocupado = true;
  printsAtualizar(true).catch(e => printsAviso('Erro ao ler os prints: ' + printsEsc(e.message), 'error'))
    .finally(() => { prints.ocupado = false; });
  if (dataISO === printsHoje()) {
    // uma leitura por vez: a anterior pode estar desenhando quando o relógio bate
    prints.timer = setInterval(() => {
      if (prints.ocupado) return;
      prints.ocupado = true;
      printsAtualizar(false).catch(() => {}).finally(() => { prints.ocupado = false; });
    }, PRINTS_POLL_MS);
  }
}

(function iniciarPrints() {
  const dataEl = document.getElementById('printsData');
  dataEl.value = printsHoje();
  dataEl.addEventListener('change', () => { if (dataEl.value) printsTrocarData(dataEl.value); });
  document.getElementById('tabPrints').addEventListener('click', () => {
    printsMarcarNovos(0);
    setTimeout(() => document.querySelectorAll('.print-card.novo').forEach(c => c.classList.remove('novo')), 4000);
  });
  printsTrocarData(dataEl.value);
})();
