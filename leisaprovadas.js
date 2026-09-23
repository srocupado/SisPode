'use strict';
// Aba "Leis aprovadas" do módulo Relatórios.
//
// Porte do app standalone (repo Relatorio, branch deputies-legislation-tracker):
// ranking de deputados por projetos de sua autoria (autor OU coautor — todos os
// signatários recebem crédito) transformados em norma jurídica, da 53ª à 57ª
// legislatura.
//
// A diferença para o app original é onde a coleta acontece. Lá o usuário
// baixava manualmente os arquivos em massa da Câmara (90–165 MB cada) porque um
// navegador não consegue buscá-los (sem CORS) e a API paginada não filtra por
// situação de tramitação. Aqui a coleta já rodou no bot/ (processo Node, sem
// essa barreira) e gravou só o AGREGADO em
// https://plenario-podemos-default-rtdb.firebaseio.com/leis_aprovadas/{legislatura} —
// esta aba só LÊ esse agregado. Sem download manual, sem processar nada pesado
// no navegador.
//
// Consequência direta: os TIPOS de proposição considerados (PL e PLP, por
// padrão) são decididos na coleta (bot/src/leisaprovadas.js), não aqui — esta
// tela filtra o que já foi agregado (nome, partido, UF, legislatura, condição),
// não decide o que entrou na contagem.
//
// Depende de aderencia.js (FIREBASE_URL, mapLimit, cvEsc, CSS_PDF_VOTOS) —
// carregado antes deste arquivo.

const LEA_ROOT = '/leis_aprovadas';
// Mesma tabela do coletor (bot/src/leisaprovadas.js) — só o rótulo e a ordem
// de exibição importam aqui; o agregado em si já vem rotulado do Firebase.
const LEA_LEGISLATURAS = ['57', '56', '55', '54', '53'];
const LEA_PADRAO = ['57', '56'];

const lea = { cache: {}, linhas: [], ordem: { coluna: 'total', asc: false } };

const leaEl = {
  legs:      () => document.querySelectorAll('.lea-leg'),
  nome:      () => document.getElementById('leaNome'),
  partido:   () => document.getElementById('leaPartido'),
  uf:        () => document.getElementById('leaUf'),
  condicao:  () => document.getElementById('leaCondicao'),
  soComLei:  () => document.getElementById('leaSoComLei'),
  buscar:    () => document.getElementById('leaBuscar'),
  status:    () => document.getElementById('leaStatus'),
  resultado: () => document.getElementById('leaResultado'),
};

function leaStatus(msg, tipo) {
  const el = leaEl.status();
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

/** Busca o agregado de uma legislatura no Firebase, com cache em memória da aba. */
async function leaCarregarLegislatura(leg) {
  if (lea.cache[leg] !== undefined) return lea.cache[leg];
  const res = await fetch(FIREBASE_URL + LEA_ROOT + '/' + leg + '.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const dados = await res.json();
  lea.cache[leg] = dados || null;
  return lea.cache[leg];
}

/** Achata o agregado de todas as legislaturas escolhidas numa lista de linhas. */
function leaAchatar(legsEscolhidas) {
  const linhas = [];
  for (const leg of legsEscolhidas) {
    const dados = lea.cache[leg];
    if (!dados) continue;
    for (const r of dados.ranking || []) {
      linhas.push({
        depId: r.depId, nome: r.nome, partido: r.partido, uf: r.uf,
        condicao: r.condicao || '—', legislatura: leg, rotulo: dados.rotulo,
        total: r.total, projetos: (dados.projetos || []).filter(p => (p.autores || []).includes(r.depId)),
      });
    }
  }
  return linhas;
}

function leaGrupoCondicao(cond) {
  if (cond === 'Titular' || cond === 'Efetivado') return 'titular';
  if (cond === 'Suplente') return 'suplente';
  return '';
}

function leaFiltradas() {
  const nome = (leaEl.nome().value || '').trim().toLowerCase();
  const partido = (leaEl.partido().value || '').trim().toUpperCase();
  const uf = (leaEl.uf().value || '').trim().toUpperCase();
  const condicao = leaEl.condicao().value;
  const soComLei = leaEl.soComLei().checked;

  let linhas = lea.linhas.filter(d => {
    if (nome && !d.nome.toLowerCase().includes(nome)) return false;
    if (partido && d.partido !== partido) return false;
    if (uf && d.uf !== uf) return false;
    if (condicao && leaGrupoCondicao(d.condicao) !== condicao) return false;
    if (soComLei && d.total === 0) return false;
    return true;
  });

  const { coluna, asc } = lea.ordem;
  linhas.sort((a, b) => {
    if (coluna === 'total') return asc ? a.total - b.total : b.total - a.total;
    const va = (a[coluna] || '').toLowerCase(), vb = (b[coluna] || '').toLowerCase();
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return b.total - a.total;
  });
  return linhas;
}

const FICHA_URL = (id) => `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${id}`;

function leaDetalheHtml(d) {
  if (!d.projetos.length) return '<div class="prd-dica" style="padding:10px 0">Nenhum projeto de autoria dele(a) virou lei nesta legislatura.</div>';
  const ordenados = d.projetos.slice().sort((a, b) => (b.dataApresentacao || '').localeCompare(a.dataApresentacao || ''));
  return '<ol class="projetos-list" style="padding:8px 0 4px;margin-left:18px">' + ordenados.map(p => `
    <li style="margin-bottom:8px;font-size:11.5px;color:var(--text-dim);line-height:1.5">
      <a href="${FICHA_URL(p.id)}" target="_blank" rel="noopener" style="color:var(--accent-light);font-weight:700">${cvEsc(p.tipo)} ${cvEsc(p.numero)}/${cvEsc(p.ano)}</a>
      <span> (apresentado em ${cvEsc((p.dataApresentacao || '').slice(0, 10))})</span>
      <div style="color:var(--text);margin-top:2px">${cvEsc(p.ementa)}</div>
    </li>`).join('') + '</ol>';
}

function leaRenderRanking() {
  const linhas = leaFiltradas();
  const listEl = document.getElementById('leaRankingList');
  if (!listEl) return;
  listEl.innerHTML = '';
  linhas.forEach((d, idx) => {
    const row = document.createElement('div');
    row.className = 'ranking-row';
    row.innerHTML = `
      <div class="ranking-summary">
        <div class="rank-num">${idx + 1}</div>
        <div class="rank-info">
          <div class="rank-name">${cvEsc(d.nome)}</div>
          <div class="rank-meta">${cvEsc(d.partido)}-${cvEsc(d.uf)} · ${cvEsc(d.rotulo)}${d.condicao !== '—' ? ' · ' + cvEsc(d.condicao) : ''}</div>
        </div>
        <div class="rank-pct-wrap" style="width:auto">
          <span class="rank-pct-num" style="color:${d.total ? 'var(--accent-light)' : 'var(--text-dim)'}">${d.total}</span>
        </div>
        <div class="rank-chevron">›</div>
      </div>
      <div class="rank-detail" id="lea-detalhe-${d.depId}-${d.legislatura}"></div>`;
    const summary = row.querySelector('.ranking-summary');
    summary.addEventListener('click', () => {
      const aberta = row.classList.contains('open');
      document.querySelectorAll('#leaRankingList .ranking-row.open').forEach(r => { if (r !== row) r.classList.remove('open'); });
      if (aberta) { row.classList.remove('open'); return; }
      row.classList.add('open');
      const det = row.querySelector('.rank-detail');
      if (!det.dataset.rendered) { det.innerHTML = leaDetalheHtml(d); det.dataset.rendered = '1'; }
    });
    listEl.appendChild(row);
  });

  const totalProjetos = linhas.reduce((s, d) => s + d.total, 0);
  const contagem = document.getElementById('leaContagem');
  if (contagem) contagem.textContent = `${linhas.length} registro(s) · ${totalProjetos} projeto(s) convertido(s) em lei`;
}

function leaAtualizadoEmTexto(legsEscolhidas) {
  const datas = legsEscolhidas.map(leg => lea.cache[leg] && lea.cache[leg].atualizadoEm).filter(Boolean);
  if (!datas.length) return '';
  const maisAntiga = datas.sort()[0];
  const d = new Date(maisAntiga);
  return `Dado agregado pelo bot em ${d.toLocaleDateString('pt-BR')} (a mais antiga das legislaturas escolhidas — ` +
    `${LEA_ROOT.replace('/', '')}, atualizado periodicamente pelo bot/, sem downloads manuais).`;
}

async function leaConsultar() {
  const legsEscolhidas = [...leaEl.legs()].filter(c => c.checked).map(c => c.value);
  if (!legsEscolhidas.length) return leaStatus('Escolha ao menos uma legislatura.', 'error');

  leaEl.buscar().disabled = true;
  leaEl.resultado().innerHTML = '';
  try {
    leaStatus('Buscando o agregado no Firebase…', 'loading');
    const faltando = legsEscolhidas.filter(leg => lea.cache[leg] === undefined);
    if (faltando.length) await mapLimit(faltando, 5, leaCarregarLegislatura);

    const semDado = legsEscolhidas.filter(leg => !lea.cache[leg]);
    lea.linhas = leaAchatar(legsEscolhidas);
    leaStatus('');

    if (!lea.linhas.length) {
      leaEl.resultado().innerHTML = `<div class="cv-aviso">Nenhum dado agregado ainda para ${legsEscolhidas.join(', ')}ª.
        A coleta roda no bot/ (comando /leisaprovadas, admin) — ainda não foi feita para ${
          semDado.length ? semDado.join(', ') : 'esta(s) legislatura(s)'}ª.</div>`;
      return;
    }

    leaEl.resultado().innerHTML = `
      ${semDado.length ? `<div class="cv-aviso">⚠ Sem dado agregado ainda para ${semDado.join(', ')}ª — não entram no ranking abaixo.</div>` : ''}
      <div class="prd-dica" style="margin-bottom:10px">${leaAtualizadoEmTexto(legsEscolhidas)}</div>
      <div class="ranking-card">
        <div class="ranking-title-bar">
          <span>Deputados com projetos convertidos em lei</span>
          <div class="ranking-sort-bar">
            <button class="sort-btn active" data-sort="total">Mais leis ↓</button>
            <button class="sort-btn" data-sort="nome">Nome A-Z</button>
            <button class="sort-btn" data-sort="partido">Partido</button>
          </div>
        </div>
        <div style="padding:8px 14px;font-size:11px;color:var(--text-dim)" id="leaContagem"></div>
        <div id="leaRankingList"></div>
      </div>
      <button class="btn-gerar" id="leaExportar" style="margin-top:12px">Exportar Excel</button>`;

    document.querySelectorAll('#leaResultado .sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#leaResultado .sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        lea.ordem = { coluna: btn.dataset.sort, asc: btn.dataset.sort === 'nome' || btn.dataset.sort === 'partido' };
        leaRenderRanking();
      });
    });
    document.getElementById('leaExportar').addEventListener('click', leaExportar);

    lea.ordem = { coluna: 'total', asc: false };
    leaRenderRanking();
  } catch (e) {
    leaStatus('Erro ao buscar o agregado: ' + e.message, 'error');
    console.error(e);
  } finally {
    leaEl.buscar().disabled = false;
  }
}

function leaExportar() {
  if (!lea.linhas.length) return;
  const wb = XLSX.utils.book_new();

  const ranking = lea.linhas.map(d => ({
    Deputado: d.nome, Partido: d.partido, UF: d.uf, Condição: d.condicao,
    Legislatura: d.rotulo, 'Projetos convertidos em lei': d.total, idDeputado: d.depId,
  }));
  const ws1 = XLSX.utils.json_to_sheet(ranking);
  ws1['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Ranking');

  const projetos = [];
  for (const d of lea.linhas) for (const p of d.projetos) {
    projetos.push({
      Deputado: d.nome, Partido: d.partido, UF: d.uf, Legislatura: d.rotulo,
      Tipo: p.tipo, Numero: p.numero, Ano: p.ano,
      'Data apresentacao': (p.dataApresentacao || '').slice(0, 10),
      Ementa: p.ementa, Link: FICHA_URL(p.id), idProposicao: p.id, idDeputado: d.depId,
    });
  }
  const ws2 = XLSX.utils.json_to_sheet(projetos);
  ws2['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 7 }, { wch: 8 }, { wch: 6 }, { wch: 14 }, { wch: 90 }, { wch: 62 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Projetos');

  XLSX.writeFile(wb, `leis-aprovadas-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- ligação ----------
if (leaEl.buscar()) {
  leaEl.buscar().addEventListener('click', leaConsultar);
  document.querySelectorAll('.lea-leg').forEach(c => { if (LEA_PADRAO.includes(c.value)) c.checked = true; });
  ['leaNome', 'leaPartido', 'leaUf', 'leaCondicao', 'leaSoComLei'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { if (lea.linhas.length) leaRenderRanking(); });
    el.addEventListener('change', () => { if (lea.linhas.length) leaRenderRanking(); });
  });
}
