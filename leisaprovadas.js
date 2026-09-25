'use strict';
// Aba "Leis aprovadas" do módulo Relatórios.
//
// Porte do app standalone (repo Relatorio, branch deputies-legislation-tracker):
// ranking de deputados por projetos de sua autoria (autor OU coautor — todos os
// signatários recebem crédito) transformados em norma jurídica, da 53ª à 57ª
// legislatura — da 53ª até a corrente, que é CALCULADA pela data (58ª a partir
// de fev/2027, 59ª em fev/2031…), sem lista fixa para editar na virada.
//
// O caminho PRINCIPAL desta aba é ler o AGREGADO que o bot/ já coletou em
// https://plenario-podemos-default-rtdb.firebaseio.com/leis_aprovadas/{legislatura} —
// sem download manual, sem processar nada pesado no navegador (funções
// leaConsultar/leaCarregarLegislatura/leaAchatar, mais abaixo).
//
// Se o bot parar, a extensão cobre a coleta sozinha: os arquivos oficiais em
// massa (`proposicoes-AAAA.json`, 50–165 MB cada) não mandam cabeçalho CORS,
// mas esta é uma PÁGINA DA EXTENSÃO e dadosabertos.camara.leg.br está em
// host_permissions no manifest.json — então o fetch direto funciona aqui
// (num site comum, não). É o botão "Coletar agora" (leaColetarDaCamara), que a
// tela oferece quando o dado da legislatura corrente está velho. Continua
// existindo o caminho com arquivos já baixados (leaProcessarLocal). Nos dois,
// só se o analista clicar "Gravar no banco de dados" o AGREGADO (nunca o
// arquivo bruto) vai para o mesmo /leis_aprovadas/{legislatura} que o bot usa,
// e só depois das travas de leaMotivosParaNaoGravar.
// A API de deputados/autores/histórico tem CORS liberado (só os arquivos em
// massa não têm), então esse caminho manual busca autores e condição do jeito
// normal, direto da API.
//
// A conta da legislatura (leaCfg/leaLegislaturaAtual) e o filtro (tipo +
// idSituacao) são DUPLICADOS de bot/src/leisaprovadas.js de propósito —
// scripts clássicos da extensão não importam módulos do bot/. Mudar um sem o
// outro desalinha a coleta pela extensão da coleta do bot.
//
// Depende de aderencia.js (FIREBASE_URL, mapLimit, fetchJson, cvEsc) —
// carregado antes deste arquivo.

const LEA_ROOT = '/leis_aprovadas';
const LEA_PRIMEIRA = 53;       // primeira legislatura coberta (2007)
const LEA_DIAS_VELHO = 3;      // dado da corrente com mais que isso → aviso + "Coletar agora"

// ---------- legislaturas: mesma conta de bot/src/leisaprovadas.js ----------
function leaHojeISO(hoje) { return (hoje || new Date()).toISOString().slice(0, 10); }

/** Posse em 1º/fev de 2023, 2027, 2031… → 57ª, 58ª, 59ª… */
function leaLegislaturaAtual(hoje) {
  const [ano, mes] = leaHojeISO(hoje).split('-').map(Number);
  return String(Math.floor(((mes >= 2 ? ano : ano - 1) - 1795) / 4));
}

/** Rótulo, faixa de apresentação e anos de arquivo (inclui o ano final: janeiro ainda é da legislatura). */
function leaCfg(leg) {
  const n = Number(leg);
  if (!Number.isInteger(n) || n < LEA_PRIMEIRA) return null;
  const a0 = 1795 + 4 * n, a1 = a0 + 4;
  const anos = [];
  for (let a = a0; a <= a1; a++) anos.push(a);
  return { rotulo: `${n}ª (${a0}–${a1})`, inicio: `${a0}-02-01`, fim: `${a1}-01-31`, anos };
}

/** Da corrente até a 53ª. */
function leaListarLegislaturas(hoje) {
  const out = [];
  for (let n = Number(leaLegislaturaAtual(hoje)); n >= LEA_PRIMEIRA; n--) out.push(String(n));
  return out;
}

/** Anos de arquivo que já existem (o de um ano futuro a Câmara ainda não publicou). */
function leaAnosParaColetar(leg, hoje) {
  const anoHoje = Number(leaHojeISO(hoje).slice(0, 4));
  return (leaCfg(leg) || { anos: [] }).anos.filter(a => a <= anoHoje);
}

/** Checkboxes das legislaturas (consulta e upload), gerados da conta — a nova aparece sozinha na virada. */
function leaRenderLegislaturas() {
  const legs = leaListarLegislaturas();
  const html = (classe) => legs.map(leg =>
    `<label class="rdr-check" style="padding-bottom:0;flex:0 0 auto"><input type="checkbox" class="${classe}" value="${leg}"> ${leaCfg(leg).rotulo}</label>`).join('');
  const consulta = document.getElementById('leaLegs');
  if (consulta) consulta.innerHTML = html('lea-leg');
  const upload = document.getElementById('leaUpLegs');
  if (upload) upload.innerHTML = html('lea-up-leg');
  const desc = document.getElementById('leaFaixa');
  if (desc) desc.textContent = `da ${LEA_PRIMEIRA}ª à ${legs[0]}ª legislatura`;
  return legs.slice(0, 2); // padrão: as duas mais recentes
}

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

function leaFmtDataHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

function leaAtualizadoEmTexto(legsEscolhidas) {
  const salvas = legsEscolhidas.map(leg => lea.cache[leg]).filter(d => d && d.atualizadoEm);
  if (!salvas.length) return '';
  const maisAntiga = salvas.slice().sort((a, b) => a.atualizadoEm.localeCompare(b.atualizadoEm))[0];
  const arqs = Object.values(maisAntiga.dataArquivos || {}).sort();
  return `Dado agregado em ${leaFmtDataHora(maisAntiga.atualizadoEm)} (horário de Brasília), por ${maisAntiga.origem || 'bot'}` +
    (arqs.length ? `, a partir dos arquivos da Câmara de ${leaFmtDataHora(arqs[0])}` : '') +
    (salvas.length > 1 ? ' — a mais antiga das legislaturas escolhidas.' : '.');
}

/**
 * Aviso de dado VELHO da legislatura corrente (> LEA_DIAS_VELHO dias sem
 * coleta) — é assim que uma parada do bot aparece para quem usa a tela, já
 * com o botão para qualquer analista coletar pela extensão. Vazio se em dia.
 */
function leaAvisoDadoVelho(hoje) {
  const atual = leaLegislaturaAtual(hoje);
  const dados = lea.cache[atual];
  const quando = dados && dados.atualizadoEm;
  const dias = quando ? ((hoje || new Date()) - new Date(quando)) / 86400000 : Infinity;
  if (dias <= LEA_DIAS_VELHO) return '';
  const texto = quando
    ? `⚠ O dado da ${atual}ª não é atualizado desde ${leaFmtDataHora(quando)} — a coleta automática do bot pode ter parado.`
    : `⚠ Ainda não há dado coletado da ${atual}ª.`;
  return `<div class="cv-aviso">${texto}
    <button class="btn-gerar lea-coletar" style="margin-top:8px">Coletar agora pela extensão</button></div>`;
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
  if (!confirm(`Apagar o agregado de ${legsEscolhidas.join('ª, ')}ª no banco de dados?\n\n` +
    'Isso remove o dado para TODA a equipe — não é só a sua tela. A próxima coleta ' +
    '(bot ou upload manual) precisa rodar de novo para repopular. Esta ação não tem desfazer.')) return;

  leaEl.limpar().disabled = true;
  try {
    leaStatus('Apagando…', 'loading');
    await mapLimit(legsEscolhidas, 5, leaLimparFirebaseLeg);
    leaStatus(`Apagado no banco de dados: ${legsEscolhidas.join(', ')}ª. Clique em "Buscar" para conferir.`);
    lea.linhas = [];
    leaEl.resultado().innerHTML = '';
  } catch (e) {
    leaStatus('Erro ao apagar: ' + e.message, 'error');
    console.error(e);
  } finally {
    leaEl.limpar().disabled = false;
  }
}

function leaLigarColetar() {
  document.querySelectorAll('#leaResultado .lea-coletar').forEach(b => b.addEventListener('click', () => leaColetarAgoraClick()));
}

async function leaConsultar() {
  const legsEscolhidas = [...leaEl.legs()].filter(c => c.checked).map(c => c.value);
  if (!legsEscolhidas.length) return leaStatus('Escolha ao menos uma legislatura.', 'error');

  leaEl.buscar().disabled = true;
  leaEl.resultado().innerHTML = '';
  try {
    leaStatus('Buscando o agregado no banco de dados…', 'loading');
    // A corrente entra sempre na busca — o aviso de dado velho depende dela.
    const faltando = [...new Set([...legsEscolhidas, leaLegislaturaAtual()])].filter(leg => lea.cache[leg] === undefined);
    if (faltando.length) await mapLimit(faltando, 5, leaCarregarLegislatura);

    const semDado = legsEscolhidas.filter(leg => !lea.cache[leg]);
    lea.linhas = leaAchatar(legsEscolhidas);
    leaStatus('');

    if (!lea.linhas.length) {
      leaEl.resultado().innerHTML = `<div class="cv-aviso">Nenhum dado agregado ainda para ${legsEscolhidas.join(', ')}ª.
        A coleta roda no bot/ (comando /leisaprovadas, admin) — ainda não foi feita para ${
          semDado.length ? semDado.join(', ') : 'esta(s) legislatura(s)'}ª.</div>${leaAvisoDadoVelho()}`;
      leaLigarColetar();
      return;
    }

    leaEl.resultado().innerHTML = `
      ${leaAvisoDadoVelho()}
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
    leaLigarColetar();

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
const LEA_ARQUIVOS_URL = 'https://dadosabertos.camara.leg.br/arquivos/proposicoes/json';

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

/** Data de apresentação → chave de legislatura ("53" até a corrente), ou null se fora das faixas conhecidas. */
function leaClassificarPorLegislatura(dataApresentacao) {
  if (!dataApresentacao) return null;
  const data = dataApresentacao.slice(0, 10);
  for (const leg of leaListarLegislaturas()) {
    const { inicio, fim } = leaCfg(leg);
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
 * Monta o agregado de UMA legislatura (roster + autores + condição) a partir
 * das leis já filtradas — o mesmo que o bot monta server-side. Falha parcial
 * (um autor, uma condição) não derruba a coleta, mas é CONTADA: falha de
 * autor impede a gravação (leaMotivosParaNaoGravar); de condição só vira "—".
 */
async function leaAgregar(leg, leis, { comCondicao = true, fase = () => {} } = {}) {
  const rotulo = leaCfg(leg).rotulo;
  fase(`${rotulo}: buscando o roster de deputados…`);
  const roster = await leaBuscarRoster(leg);
  if (!roster.length) throw new Error(`a Câmara ainda não publicou os deputados da ${leg}ª — tente de novo em alguns dias`);
  const infoDep = new Map(roster.map(d => [d.id, d]));

  fase(`${rotulo}: buscando autores de ${leis.length} projeto(s) convertido(s) em lei…`);
  let falhasAutores = 0;
  const autoresPorLei = await mapLimit(leis, 4, async (lei) => {
    try { return await leaBuscarAutores(lei.id); } catch (e) { falhasAutores++; return []; }
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
  return { rotulo, ranking, projetos, falhasAutores };
}

/**
 * Processa arquivos locais (já selecionados pelo usuário) para as legislaturas
 * escolhidas: lê e filtra cada arquivo, classifica cada lei pela DATA de
 * apresentação (não pelo ano do nome do arquivo — um arquivo de 2023 tem
 * proposições de janeiro/2023, que ainda são da legislatura anterior), e
 * depois monta o agregado. Anota quais anos da legislatura NÃO vieram entre
 * os arquivos (pelo nome proposicoes-AAAA.json) — a gravação é bloqueada se
 * faltar algum, porque cortaria um ano inteiro de leis.
 */
async function leaProcessarLocal(legsEscolhidas, arquivos, { tipos = LEA_TIPOS_PADRAO, comCondicao = true, onFase } = {}) {
  const fase = (f) => { if (onFase) onFase(f); };

  const leisPorLeg = {};
  const anosLidos = new Set();
  const dataArquivos = {};
  for (const leg of legsEscolhidas) leisPorLeg[leg] = new Map();
  for (let i = 0; i < arquivos.length; i++) {
    const file = arquivos[i];
    fase(`Lendo "${file.name}" (arquivo ${i + 1}/${arquivos.length})…`);
    const json = await leaLerArquivoLocal(file, (rec, tot) =>
      fase(`Lendo "${file.name}"… ${(rec / 1048576).toFixed(1)}/${(tot / 1048576).toFixed(1)} MB`));
    const m = String(file.name || '').match(/proposicoes-(\d{4})/);
    if (m) {
      anosLidos.add(Number(m[1]));
      // Arquivo local: a melhor data disponível é a do arquivo no disco (≈ quando foi baixado).
      if (file.lastModified) dataArquivos[m[1]] = new Date(file.lastModified).toISOString();
    }
    fase(`Filtrando "${file.name}"…`);
    for (const lei of leaFiltrarProjetosLei(json, tipos)) {
      const leg = leaClassificarPorLegislatura(lei.dataApresentacao);
      if (leg && leisPorLeg[leg] && !leisPorLeg[leg].has(lei.id)) leisPorLeg[leg].set(lei.id, lei);
    }
  }

  const resultado = {};
  for (const leg of legsEscolhidas) {
    const dados = await leaAgregar(leg, [...leisPorLeg[leg].values()], { comCondicao, fase });
    const anosFaltando = leaAnosParaColetar(leg).filter(a => !anosLidos.has(a));
    const datas = {};
    for (const a of leaAnosParaColetar(leg)) if (dataArquivos[a]) datas[a] = dataArquivos[a];
    resultado[leg] = { ...dados, anosFaltando, dataArquivos: datas, origem: 'extensão (arquivos locais)' };
  }
  return resultado;
}

/**
 * "Coletar agora": baixa os arquivos em massa direto da Câmara (funciona
 * porque esta é uma página da extensão com host_permissions — ver topo do
 * arquivo), um ano por vez para não segurar dois arquivos grandes na memória,
 * e monta o agregado. O Last-Modified de cada arquivo vira `dataArquivos` —
 * a data do DADO da Câmara, não a do clique.
 */
async function leaColetarDaCamara(leg, { tipos = LEA_TIPOS_PADRAO, comCondicao = true, onFase } = {}) {
  const fase = (f) => { if (onFase) onFase(f); };
  const leis = new Map();
  const anosFaltando = [];
  const dataArquivos = {};
  const anos = leaAnosParaColetar(leg);
  for (let i = 0; i < anos.length; i++) {
    const ano = anos[i];
    fase(`Baixando proposicoes-${ano}.json da Câmara (${i + 1}/${anos.length}) — arquivo grande, pode levar um minuto…`);
    try {
      const res = await fetch(`${LEA_ARQUIVOS_URL}/proposicoes-${ano}.json`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const lm = res.headers && res.headers.get ? res.headers.get('last-modified') : null;
      if (lm) dataArquivos[ano] = new Date(lm).toISOString();
      const json = await res.json();
      fase(`Filtrando proposicoes-${ano}.json…`);
      for (const lei of leaFiltrarProjetosLei(json, tipos)) {
        if (leaClassificarPorLegislatura(lei.dataApresentacao) === leg && !leis.has(lei.id)) leis.set(lei.id, lei);
      }
    } catch (e) {
      anosFaltando.push(ano);
      fase(`⚠ ${ano} não baixou (${e.message}) — seguindo com os outros anos`);
    }
  }
  const dados = await leaAgregar(leg, [...leis.values()], { comCondicao, fase });
  return { ...dados, anosFaltando, dataArquivos, origem: 'extensão' };
}

/**
 * Travas antes de gravar — o Firebase é da equipe toda, e o PUT substitui o
 * dado inteiro. Bloqueia (devolve motivos) se faltou ano de arquivo ou se
 * algum projeto ficou sem autores apurados. A comparação com o dado salvo
 * (menos projetos que antes) não bloqueia: vira confirmação extra no clique.
 */
function leaMotivosParaNaoGravar(dados) {
  const motivos = [];
  if (dados.anosFaltando && dados.anosFaltando.length) {
    motivos.push(`faltam os arquivos de ${dados.anosFaltando.join(', ')} — gravar assim cortaria esses anos inteiros`);
  }
  if (dados.falhasAutores) {
    motivos.push(`autores não apurados para ${dados.falhasAutores} projeto(s) — o crédito dos deputados sairia menor`);
  }
  return motivos;
}

/** Nº de projetos já salvos no Firebase para a legislatura (lido na hora, sem cache). */
async function leaProjetosSalvos(leg) {
  const res = await fetch(FIREBASE_URL + LEA_ROOT + '/' + leg + '/projetos.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const p = await res.json();
  return Array.isArray(p) ? p.length : (p ? Object.keys(p).length : 0);
}

/** Grava (PUT — substitui) o agregado de uma legislatura no Firebase compartilhado. */
async function leaGravarFirebase(leg, dados) {
  const body = {
    rotulo: dados.rotulo, ranking: dados.ranking, projetos: dados.projetos,
    atualizadoEm: new Date().toISOString(),
    origem: dados.origem || 'extensão',
    dataArquivos: dados.dataArquivos || {},
  };
  const res = await fetch(FIREBASE_URL + LEA_ROOT + '/' + leg + '.json', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  lea.cache[leg] = body;
  return body;
}

/** Clique em "Gravar": travas, depois comparação com o salvo, depois confirmação. */
async function leaGravarComTravas(leg, dados, status) {
  const motivos = leaMotivosParaNaoGravar(dados);
  if (motivos.length) return status(`${dados.rotulo}: NÃO gravado — ${motivos.join('; ')}.`, 'error');
  let antes = null;
  try { antes = await leaProjetosSalvos(leg); } catch (e) { /* sem comparação: segue para a confirmação normal */ }
  if (antes !== null && antes > dados.projetos.length) {
    if (!confirm(`Atenção: esta coleta tem ${dados.projetos.length} projeto(s) de ${dados.rotulo}, MENOS que os ${antes} já salvos.\n\n` +
      'Lei não deixa de ser lei — isso costuma indicar coleta incompleta. Gravar mesmo assim, substituindo o dado da equipe toda?')) {
      return status(`${dados.rotulo}: gravação cancelada (coleta com menos projetos que o dado salvo).`);
    }
  } else if (!confirm(`Gravar o agregado de ${dados.rotulo} no banco de dados? Isso SUBSTITUI o que já estiver lá para essa legislatura, para toda a equipe.`)) {
    return;
  }
  try {
    await leaGravarFirebase(leg, dados);
    status(`${dados.rotulo}: gravado no banco de dados.`);
  } catch (e) {
    status(`Erro ao gravar ${dados.rotulo}: ${e.message}`, 'error');
  }
}

function leaUpRenderResultado(resultado) {
  leaUpEl.resultado().innerHTML = Object.entries(resultado).map(([leg, d]) => {
    const comLei = d.ranking.filter(r => r.total > 0).length;
    const motivos = leaMotivosParaNaoGravar(d);
    return `<div class="cv-cab" data-leg="${leg}" style="margin-top:10px">
      <h3>${cvEsc(d.rotulo)}</h3>
      <div class="sub">${d.projetos.length} projeto(s) convertido(s) em lei · ${comLei} deputado(s) com ao menos 1</div>
      ${motivos.length ? `<div class="cv-aviso">⚠ Não pode ser gravado: ${cvEsc(motivos.join('; '))}.</div>` : ''}
      <div class="cv-acoes">
        <button class="btn-gerar lea-up-ver" data-leg="${leg}" style="margin-top:0">Ver no ranking acima</button>
        <button class="btn-gerar lea-up-salvar" data-leg="${leg}" style="margin-top:0;background:rgba(255,255,255,0.06);color:var(--text-dim)"${motivos.length ? ' disabled' : ''}>Gravar no banco de dados</button>
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
      btn.disabled = true;
      try { await leaGravarComTravas(btn.dataset.leg, resultado[btn.dataset.leg], leaUpStatus); }
      finally { btn.disabled = false; }
    });
  });
}

/** Põe o resultado de uma coleta/processamento no cache local (sem gravar) e mostra os botões. */
function leaUpMostrar(resultado) {
  for (const [leg, d] of Object.entries(resultado)) {
    lea.cache[leg] = { rotulo: d.rotulo, ranking: d.ranking, projetos: d.projetos, atualizadoEm: null };
  }
  leaUpRenderResultado(resultado);
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
    leaUpMostrar(resultado);
  } catch (e) {
    leaUpProgresso(false);
    leaUpStatus('Erro ao processar: ' + e.message, 'error');
    console.error(e);
  } finally {
    leaUpEl.processar().disabled = false;
  }
}

/** "Coletar agora pela extensão" — legislatura corrente, direto da Câmara. */
async function leaColetarAgoraClick(leg) {
  leg = leg || leaLegislaturaAtual();
  const botoes = document.querySelectorAll('.lea-coletar');
  botoes.forEach(b => { b.disabled = true; });
  leaUpEl.resultado().innerHTML = '';
  try {
    const dados = await leaColetarDaCamara(leg, {
      comCondicao: leaUpEl.condicao() ? leaUpEl.condicao().checked : true,
      onFase: (f) => { leaUpStatus(f, 'loading'); },
    });
    leaUpStatus(`Coleta da ${leg}ª concluída — confira e grave abaixo.`);
    leaUpMostrar({ [leg]: dados });
    const alvo = document.getElementById('leaUpResultado');
    if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    leaUpStatus('Erro na coleta: ' + e.message, 'error');
    console.error(e);
  } finally {
    botoes.forEach(b => { b.disabled = false; });
  }
}

// ---------- ligação ----------
const LEA_PADRAO = leaRenderLegislaturas();
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
const leaBtnColetar = document.getElementById('leaColetar');
if (leaBtnColetar) {
  leaBtnColetar.textContent = `Coletar agora a ${leaLegislaturaAtual()}ª pela extensão`;
  leaBtnColetar.addEventListener('click', () => leaColetarAgoraClick());
}
