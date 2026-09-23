'use strict';
// Aba "Leis aprovadas" do módulo Relatórios.
//
// Porte do app standalone (repo Relatorio, branch deputies-legislation-tracker):
// ranking de deputados por projetos de sua autoria (autor OU coautor — todos os
// signatários recebem crédito) transformados em norma jurídica, da 53ª à 57ª
// legislatura.
//
// O caminho PRINCIPAL desta aba é ler o AGREGADO que o bot/ já coletou em
// https://plenario-podemos-default-rtdb.firebaseio.com/leis_aprovadas/{legislatura} —
// sem download manual, sem processar nada pesado no navegador (funções
// leaConsultar/leaCarregarLegislatura/leaAchatar, mais abaixo).
//
// Mas os arquivos oficiais em massa (`proposicoes-AAAA.json`, 50–165 MB cada,
// sem CORS — só dá pra baixar clicando, não por fetch) às vezes já estão na
// máquina do analista, baixados de uma coleta anterior ou de outra ferramenta.
// Para esse caso existe um segundo caminho, MANUAL: leaProcessarLocal e a
// seção "processar arquivos baixados manualmente" da tela leem e filtram esses
// arquivos aqui mesmo, no navegador — os arquivos não saem da máquina — e só
// depois, se o analista clicar "Gravar no Firebase", o AGREGADO (nunca o
// arquivo bruto) vai para o mesmo /leis_aprovadas/{legislatura} que o bot usa.
// A API de deputados/autores/histórico tem CORS liberado (só os arquivos em
// massa não têm), então esse caminho manual busca autores e condição do jeito
// normal, direto da API.
//
// A tabela de legislaturas (LEA_CFG) e o filtro (tipo + idSituacao) são
// DUPLICADOS de bot/src/leisaprovadas.js de propósito — scripts clássicos da
// extensão não importam módulos do bot/. Mudar um sem o outro só desalinha o
// caminho MANUAL; o agregado que já está no Firebase não é afetado.
//
// Depende de aderencia.js (FIREBASE_URL, mapLimit, fetchJson, cvEsc) —
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
  limpar:    () => document.getElementById('leaLimpar'),
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

/** Apaga (DELETE) o agregado de uma legislatura no Firebase compartilhado. */
async function leaLimparFirebaseLeg(leg) {
  const res = await fetch(FIREBASE_URL + LEA_ROOT + '/' + leg + '.json', { method: 'DELETE' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  lea.cache[leg] = null;
}

/**
 * Apaga no Firebase o agregado das legislaturas marcadas nos checkboxes do
 * topo — para quando um reprocessamento precisa partir do zero (mudou o
 * critério de coleta, um dado ficou errado, etc.). É destrutivo e afeta a
 * equipe toda, por isso pede confirmação explícita antes de apagar qualquer
 * coisa; a próxima coleta (bot ou upload manual) repopula normalmente.
 */
async function leaLimparClick() {
  const legsEscolhidas = [...leaEl.legs()].filter(c => c.checked).map(c => c.value);
  if (!legsEscolhidas.length) return leaStatus('Marque ao menos uma legislatura para limpar.', 'error');
  if (!confirm(`Apagar o agregado de ${legsEscolhidas.join('ª, ')}ª no Firebase?\n\n` +
    'Isso remove o dado para TODA a equipe — não é só a sua tela. A próxima coleta ' +
    '(bot ou upload manual) precisa rodar de novo para repopular. Esta ação não tem desfazer.')) return;

  leaEl.limpar().disabled = true;
  try {
    leaStatus('Apagando…', 'loading');
    await mapLimit(legsEscolhidas, 5, leaLimparFirebaseLeg);
    leaStatus(`Apagado no Firebase: ${legsEscolhidas.join(', ')}ª. Clique em "Buscar" para conferir.`);
    lea.linhas = [];
    leaEl.resultado().innerHTML = '';
  } catch (e) {
    leaStatus('Erro ao apagar: ' + e.message, 'error');
    console.error(e);
  } finally {
    leaEl.limpar().disabled = false;
  }
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

// ---------- processamento MANUAL de arquivos locais ----------
const LEA_API = 'https://dadosabertos.camara.leg.br/api/v2';
const LEA_ID_SITUACAO_LEI = '1140'; // "Transformado em Norma Jurídica", no ultimoStatus do arquivo em massa
const LEA_TIPOS_PADRAO = ['PL', 'PLP'];
// Mesma tabela do coletor do bot (bot/src/leisaprovadas.js) — ver nota no topo do arquivo.
const LEA_CFG = {
  '57': { rotulo: '57ª (2023–2027)', inicio: '2023-02-01', fim: '2027-01-31' },
  '56': { rotulo: '56ª (2019–2023)', inicio: '2019-02-01', fim: '2023-01-31' },
  '55': { rotulo: '55ª (2015–2019)', inicio: '2015-02-01', fim: '2019-01-31' },
  '54': { rotulo: '54ª (2011–2015)', inicio: '2011-02-01', fim: '2015-01-31' },
  '53': { rotulo: '53ª (2007–2011)', inicio: '2007-02-01', fim: '2011-01-31' },
};

const leaUpEl = {
  legs:      () => document.querySelectorAll('.lea-up-leg'),
  arquivos:  () => document.getElementById('leaUpArquivos'),
  condicao:  () => document.getElementById('leaUpCondicao'),
  processar: () => document.getElementById('leaUpProcessar'),
  status:    () => document.getElementById('leaUpStatus'),
  resultado: () => document.getElementById('leaUpResultado'),
};

function leaUpStatus(msg, tipo) {
  const el = leaUpEl.status();
  if (!el) return;
  el.className = 'status' + (tipo === 'error' ? ' error' : '');
  el.textContent = msg || '';
}

function leaUpProgresso(mostrar, pct) {
  const wrap = document.getElementById('leaUpProgressWrap');
  const fill = document.getElementById('leaUpProgressFill');
  if (!wrap || !fill) return;
  wrap.hidden = !mostrar;
  if (typeof pct === 'number') fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

/** Data de apresentação → chave de legislatura ("53".."57"), ou null se fora das faixas conhecidas. */
function leaClassificarPorLegislatura(dataApresentacao) {
  if (!dataApresentacao) return null;
  const data = dataApresentacao.slice(0, 10);
  for (const leg of Object.keys(LEA_CFG)) {
    const { inicio, fim } = LEA_CFG[leg];
    if (data >= inicio && data <= fim) return leg;
  }
  return null;
}

/** Filtra um arquivo em massa (já lido/parseado) para só os tipos pedidos transformados em lei. */
function leaFiltrarProjetosLei(arquivoJson, tipos) {
  const arr = Array.isArray(arquivoJson) ? arquivoJson : (arquivoJson && arquivoJson.dados) || [];
  const leis = [];
  for (const p of arr) {
    if (!tipos.includes(p.siglaTipo)) continue;
    const st = p.ultimoStatus || {};
    if (String(st.idSituacao) !== LEA_ID_SITUACAO_LEI) continue;
    leis.push({
      id: p.id, tipo: p.siglaTipo, numero: p.numero, ano: p.ano,
      ementa: p.ementa || '', dataApresentacao: p.dataApresentacao || '',
    });
  }
  return leis;
}

/** Lê um arquivo local (File) como texto, com progresso, e faz JSON.parse. */
function leaLerArquivoLocal(file, onBytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => { if (onBytes && e.lengthComputable) onBytes(e.loaded, e.total); };
    reader.onload = () => {
      if (onBytes) onBytes(file.size, file.size);
      try { resolve(JSON.parse(reader.result)); }
      catch (err) { reject(new Error(`"${file.name}" não é um JSON válido: ${err.message}`)); }
    };
    reader.onerror = () => reject(new Error(`Falha ao ler o arquivo "${file.name}".`));
    reader.readAsText(file, 'utf-8');
  });
}

async function leaBuscarRoster(idLegislatura) {
  const j = await fetchJson(`${LEA_API}/deputados?idLegislatura=${idLegislatura}&ordem=ASC&ordenarPor=nome&itens=1000`);
  return (j.dados || []).map(d => ({ id: d.id, nome: d.nome, partido: d.siglaPartido || '', uf: d.siglaUf || '' }));
}

async function leaBuscarAutores(idProposicao) {
  const j = await fetchJson(`${LEA_API}/proposicoes/${idProposicao}/autores`);
  const autores = [];
  for (const a of j.dados || []) {
    if (a.codTipo !== 10000) continue; // 10000 = Deputado(a)
    const m = (a.uri || '').match(/\/deputados\/(\d+)/);
    if (m) autores.push(parseInt(m[1], 10));
  }
  return autores;
}

async function leaBuscarHistorico(idDeputado) {
  const j = await fetchJson(`${LEA_API}/deputados/${idDeputado}/historico`);
  return j.dados || [];
}

function leaCondicaoDaLegislatura(historico, leg) {
  const conds = new Set();
  for (const h of historico) {
    if (String(h.idLegislatura) === String(leg) && h.condicaoEleitoral) conds.add(h.condicaoEleitoral);
  }
  if (conds.has('Titular')) return 'Titular';
  if (conds.has('Efetivado')) return 'Efetivado';
  if (conds.has('Suplente')) return 'Suplente';
  return '—';
}

/**
 * Processa arquivos locais (já selecionados pelo usuário) para as legislaturas
 * escolhidas: lê e filtra cada arquivo, classifica cada lei pela DATA de
 * apresentação (não pelo ano do nome do arquivo — um arquivo de 2023 tem
 * proposições de janeiro/2023, que ainda são da legislatura anterior), e
 * depois monta o mesmo agregado (roster + autores + condição) que o bot monta
 * server-side. Falha parcial (um autor, uma condição) não derruba a coleta.
 */
async function leaProcessarLocal(legsEscolhidas, arquivos, { tipos = LEA_TIPOS_PADRAO, comCondicao = true, onFase } = {}) {
  const fase = (f) => { if (onFase) onFase(f); };

  const leisPorLeg = {};
  for (const leg of legsEscolhidas) leisPorLeg[leg] = new Map();
  for (let i = 0; i < arquivos.length; i++) {
    const file = arquivos[i];
    fase(`Lendo "${file.name}" (arquivo ${i + 1}/${arquivos.length})…`);
    const json = await leaLerArquivoLocal(file, (rec, tot) =>
      fase(`Lendo "${file.name}"… ${(rec / 1048576).toFixed(1)}/${(tot / 1048576).toFixed(1)} MB`));
    fase(`Filtrando "${file.name}"…`);
    for (const lei of leaFiltrarProjetosLei(json, tipos)) {
      const leg = leaClassificarPorLegislatura(lei.dataApresentacao);
      if (leg && leisPorLeg[leg] && !leisPorLeg[leg].has(lei.id)) leisPorLeg[leg].set(lei.id, lei);
    }
  }

  const resultado = {};
  for (const leg of legsEscolhidas) {
    const rotulo = LEA_CFG[leg].rotulo;
    fase(`${rotulo}: buscando o roster de deputados…`);
    const roster = await leaBuscarRoster(leg);
    const infoDep = new Map(roster.map(d => [d.id, d]));

    const leis = [...leisPorLeg[leg].values()];
    fase(`${rotulo}: buscando autores de ${leis.length} projeto(s) convertido(s) em lei…`);
    const autoresPorLei = await mapLimit(leis, 4, async (lei) => {
      try { return await leaBuscarAutores(lei.id); } catch (e) { return []; }
    });
    const projetos = leis.map((lei, i) => ({ ...lei, autores: autoresPorLei[i] || [] }));

    const totalPorDep = new Map();
    for (const p of projetos) for (const depId of p.autores) {
      totalPorDep.set(depId, (totalPorDep.get(depId) || 0) + 1);
      if (!infoDep.has(depId)) infoDep.set(depId, { id: depId, nome: `Deputado ${depId}`, partido: '', uf: '' });
    }

    let condicaoPorDep = new Map();
    if (comCondicao) {
      fase(`${rotulo}: buscando condição titular/suplente de ${infoDep.size} deputado(s)…`);
      const ids = [...infoDep.keys()];
      const condicoes = await mapLimit(ids, 8, async (id) => {
        try { return leaCondicaoDaLegislatura(await leaBuscarHistorico(id), leg); } catch (e) { return '—'; }
      });
      ids.forEach((id, i) => condicaoPorDep.set(id, condicoes[i]));
    }

    const ranking = [...infoDep.values()].map(d => ({
      depId: d.id, nome: d.nome, partido: d.partido, uf: d.uf,
      condicao: comCondicao ? (condicaoPorDep.get(d.id) || '—') : '—',
      total: totalPorDep.get(d.id) || 0,
    }));

    resultado[leg] = { rotulo, ranking, projetos };
  }
  return resultado;
}

/** Grava (PUT — substitui) o agregado de uma legislatura no Firebase compartilhado. */
async function leaGravarFirebase(leg, dados) {
  const body = { rotulo: dados.rotulo, ranking: dados.ranking, projetos: dados.projetos, atualizadoEm: new Date().toISOString() };
  const res = await fetch(FIREBASE_URL + LEA_ROOT + '/' + leg + '.json', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  lea.cache[leg] = body;
  return body;
}

function leaUpRenderResultado(resultado) {
  leaUpEl.resultado().innerHTML = Object.entries(resultado).map(([leg, d]) => {
    const comLei = d.ranking.filter(r => r.total > 0).length;
    return `<div class="cv-cab" data-leg="${leg}" style="margin-top:10px">
      <h3>${cvEsc(d.rotulo)}</h3>
      <div class="sub">${d.projetos.length} projeto(s) convertido(s) em lei · ${comLei} deputado(s) com ao menos 1</div>
      <div class="cv-acoes">
        <button class="btn-gerar lea-up-ver" data-leg="${leg}" style="margin-top:0">Ver no ranking acima</button>
        <button class="btn-gerar lea-up-salvar" data-leg="${leg}" style="margin-top:0;background:rgba(255,255,255,0.06);color:var(--text-dim)">Gravar no Firebase</button>
      </div>
    </div>`;
  }).join('');

  document.querySelectorAll('#leaUpResultado .lea-up-ver').forEach(btn => {
    btn.addEventListener('click', () => {
      const leg = btn.dataset.leg;
      const chk = document.querySelector(`.lea-leg[value="${leg}"]`);
      if (chk) chk.checked = true;
      leaConsultar();
    });
  });
  document.querySelectorAll('#leaUpResultado .lea-up-salvar').forEach(btn => {
    btn.addEventListener('click', async () => {
      const leg = btn.dataset.leg;
      if (!confirm(`Gravar o agregado de ${resultado[leg].rotulo} no Firebase? Isso SUBSTITUI o que já estiver lá para essa legislatura, para toda a equipe.`)) return;
      btn.disabled = true;
      try {
        await leaGravarFirebase(leg, resultado[leg]);
        leaUpStatus(`${resultado[leg].rotulo}: gravado no Firebase.`);
      } catch (e) {
        leaUpStatus(`Erro ao gravar ${resultado[leg].rotulo}: ${e.message}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function leaUpProcessarClick() {
  const legs = [...leaUpEl.legs()].filter(c => c.checked).map(c => c.value);
  const arquivos = [...(leaUpEl.arquivos().files || [])];
  if (!legs.length) return leaUpStatus('Escolha ao menos uma legislatura coberta pelos arquivos.', 'error');
  if (!arquivos.length) return leaUpStatus('Selecione ao menos um arquivo proposicoes-AAAA.json.', 'error');

  const comCondicao = leaUpEl.condicao().checked;
  leaUpEl.processar().disabled = true;
  leaUpEl.resultado().innerHTML = '';
  leaUpProgresso(true, 0);
  try {
    const resultado = await leaProcessarLocal(legs, arquivos, {
      comCondicao,
      onFase: (f) => { leaUpStatus(f, 'loading'); },
    });
    leaUpProgresso(false);
    leaUpStatus('Processamento concluído.');
    for (const [leg, d] of Object.entries(resultado)) {
      lea.cache[leg] = { rotulo: d.rotulo, ranking: d.ranking, projetos: d.projetos, atualizadoEm: null };
    }
    leaUpRenderResultado(resultado);
  } catch (e) {
    leaUpProgresso(false);
    leaUpStatus('Erro ao processar: ' + e.message, 'error');
    console.error(e);
  } finally {
    leaUpEl.processar().disabled = false;
  }
}

// ---------- ligação ----------
if (leaEl.buscar()) {
  leaEl.buscar().addEventListener('click', leaConsultar);
  if (leaEl.limpar()) leaEl.limpar().addEventListener('click', leaLimparClick);
  document.querySelectorAll('.lea-leg').forEach(c => { if (LEA_PADRAO.includes(c.value)) c.checked = true; });
  ['leaNome', 'leaPartido', 'leaUf', 'leaCondicao', 'leaSoComLei'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { if (lea.linhas.length) leaRenderRanking(); });
    el.addEventListener('change', () => { if (lea.linhas.length) leaRenderRanking(); });
  });
}

if (leaUpEl.processar()) {
  leaUpEl.arquivos().addEventListener('change', () => {
    leaUpEl.processar().disabled = !(leaUpEl.arquivos().files || []).length;
  });
  leaUpEl.processar().addEventListener('click', leaUpProcessarClick);
}
