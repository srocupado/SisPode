/* ============================================================
   EMENDAS DO FUNDO NACIONAL DE SAÚDE
   Monitora as propostas de emenda parlamentar à saúde (individuais, de
   bancada e de comissão) da bancada do Podemos: quanto foi proposto,
   empenhado e efetivamente PAGO, por deputado, estado e município.

   FONTE — a planilha oficial do portal do FNS:
     POST /recursos/proposta/planilha   {sgUf, ano}  → XLSX
   MEDIDO em 19/08/2026: a planilha traz PARTIDO e APELIDO do parlamentar
   em cada linha, além de valores e situação. É isso que torna o módulo
   viável no navegador: UMA requisição por UF (27 no total, ~8 a 35s cada)
   no lugar de abrir o detalhe de cada uma das ~40 mil propostas do ano.
   Sem o tpEmenda no corpo, a planilha vem com TODOS os tipos de emenda.

   O detalhe fino de uma proposta (as 12 etapas do fluxo e os pagamentos
   com nº da ordem bancária) continua vindo por chamada sob demanda,
   quando o analista abre a linha:
     GET /recursos/proposta/obter-proposta?nuProposta=
     GET /recursos/proposta/obter-proposta-etapa?nuProposta=

   O que vai para o Firebase é SÓ o recorte do partido (poucos KB por UF),
   nunca a base inteira do FNS.
   ============================================================ */
'use strict';

const FNS_BASE     = 'https://consultafns.saude.gov.br';
const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const SIGLA_PODEMOS = 'PODE';

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
             'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

// A planilha do FNS é pesada e o servidor oscila: SP levou 34s e o Acre 8s
// na medição de 19/08/2026. Teto generoso e repetição — um timeout isolado
// não é a fonte fora do ar (lição da janela de 504 da Câmara).
const TIMEOUT_PLANILHA_MS = 180000;
const TIMEOUT_DETALHE_MS  = 30000;
const BACKOFF_MS = [0, 2000, 6000];
const SIMULTANEAS = 3;      // UFs em paralelo — o portal é lento, não abusamos
const GAP_MS = 400;         // respiro entre requisições

const state = {
  ano: String(new Date().getFullYear()),
  itens: [],              // linhas do Podemos do exercício carregado
  meta: {},               // { uf: { em, n } }
  aba: 'propostas',
  log: null,              // relatório da última coleta desta sessão
  ordem: { col: 'pago', desc: true },
  varredura: null,        // AbortController enquanto busca
};

// ============================================================
//  REDE
// ============================================================
async function fetchComTimeout(url, init = {}, ms = TIMEOUT_DETALHE_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const externo = init.sinalExtra;
  const cascata = () => ctrl.abort();
  if (externo) {
    if (externo.aborted) { clearTimeout(timer); throw new DOMException('Aborted', 'AbortError'); }
    externo.addEventListener('abort', cascata, { once: true });
  }
  const { sinalExtra, ...resto } = init;
  try {
    return await fetch(url, { ...resto, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError' && !externo?.aborted) {
      throw new Error(`o portal do FNS não respondeu em ${Math.round(ms / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externo) externo.removeEventListener('abort', cascata);
  }
}

let _proximoGet = 0;
async function respiro() {
  const agora = Date.now();
  const quando = Math.max(agora, _proximoGet);
  _proximoGet = quando + GAP_MS;
  if (quando > agora) await new Promise(r => setTimeout(r, quando - agora));
}

/** Baixa a planilha oficial de uma UF. Repete em falha de rede e 5xx.
 *  Devolve { buffer, tentativas, status, ms } — as métricas alimentam o log
 *  da coleta, que é o que permite diagnosticar do navegador do analista. */
async function baixarPlanilhaUf(uf, ano, sinal) {
  let erro = null;
  const t0 = Date.now();
  for (let i = 0; i < BACKOFF_MS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
    if (sinal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await respiro();
    let res;
    try {
      res = await fetchComTimeout(`${FNS_BASE}/recursos/proposta/planilha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sgUf: uf, ano: String(ano) }),
        sinalExtra: sinal,
      }, TIMEOUT_PLANILHA_MS);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      erro = e; continue;
    }
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      return { buffer, tentativas: i + 1, status: res.status, ms: Date.now() - t0 };
    }
    if (res.status === 429 || res.status >= 500) {
      erro = new Error(`o FNS respondeu HTTP ${res.status} para ${uf}`);
      erro.status = res.status;
      continue;
    }
    const eFatal = new Error(`HTTP ${res.status} ao pedir a planilha de ${uf}`);
    eFatal.status = res.status;
    eFatal.tentativas = i + 1;
    eFatal.ms = Date.now() - t0;
    throw eFatal;
  }
  const eFim = erro || new Error(`falha ao baixar a planilha de ${uf}`);
  eFim.tentativas = BACKOFF_MS.length;
  eFim.ms = Date.now() - t0;
  throw eFim;
}

// ============================================================
//  PLANILHA → LINHAS
// ============================================================
// Cabeçalhos da planilha do FNS (medidos em 19/08/2026). O casamento é por
// texto NORMALIZADO (sem acento, sem pontuação) porque a origem escreve
// "Nº Proposta", "MUNICÍPIO", "SITUAÇÃO PROPOSTA" com acentuação variável.
const COLUNAS = {
  'no proposta': 'nuProposta', 'uf': 'uf', 'municipio': 'municipio',
  'entidade': 'entidade', 'cnpj': 'cnpj', 'no processo': 'processo',
  'ano': 'ano', 'no portaria': 'portaria', 'data portaria': 'dataPortaria',
  'tipo': 'tipo', 'valor proposta': 'proposto', 'valor empenho': 'empenhado',
  'valor pago': 'pago', 'localizacao': 'localizacao', 'tipo recurso': 'tipoRecurso',
  'no processo pagamento': 'processoPagamento', 'situacao interna': 'situacaoInterna',
  'localizacao pagamento': 'localizacaoPagamento', 'partido': 'partido',
  'apelido': 'apelido', 'valor ind objeto': 'valorObjeto', 'situacao proposta': 'situacao',
};

function normalizarCabecalho(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/º|°/g, 'o').replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** "R$ 339.502,00" | 339502 | "" → número. */
function dinheiro(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[R$\s.]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Lê o XLSX e devolve SÓ as linhas do Podemos, já normalizadas. */
function lerPlanilhaPodemos(buffer, uf, ano) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const aba = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(aba, { header: 1, defval: '' });
  if (!linhas.length) return [];

  const cab = linhas[0].map(h => COLUNAS[normalizarCabecalho(h)] || null);
  // A coluna do partido é o que dá sentido ao módulo: sem ela, a planilha
  // mudou de formato e é melhor gritar do que devolver lista vazia em silêncio.
  if (!cab.includes('partido')) {
    throw new Error(`a planilha de ${uf} veio sem a coluna PARTIDO — o formato do FNS mudou`);
  }

  const out = [];
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const obj = {};
    for (let c = 0; c < cab.length; c++) if (cab[c]) obj[cab[c]] = linha[c];
    if (String(obj.partido || '').trim().toUpperCase() !== SIGLA_PODEMOS) continue;

    out.push({
      nuProposta: String(obj.nuProposta || '').trim(),
      uf: String(obj.uf || uf).trim(),
      municipio: String(obj.municipio || '').trim(),
      entidade: String(obj.entidade || '').trim(),
      cnpj: String(obj.cnpj || '').trim(),
      ano: String(obj.ano || ano).trim(),
      portaria: String(obj.portaria || '').trim(),
      dataPortaria: String(obj.dataPortaria || '').trim(),
      tipo: String(obj.tipo || '').trim(),
      tipoRecurso: String(obj.tipoRecurso || '').trim(),
      deputado: String(obj.apelido || '').trim(),
      proposto: dinheiro(obj.proposto),
      empenhado: dinheiro(obj.empenhado),
      pago: dinheiro(obj.pago),
      valorObjeto: dinheiro(obj.valorObjeto),
      situacao: String(obj.situacao || '').trim(),
      localizacaoPagamento: String(obj.localizacaoPagamento || '').trim(),
    });
  }
  return out;
}

// A situação vem como frase ("Proposta Empenhada aguardando Formalizacao").
// Classificamos em cinco estados para o badge e o filtro — a frase original
// continua visível no detalhe, então a classificação nunca esconde o texto.
function etapaDe(item) {
  const s = String(item.situacao || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // "Pagamento" CONTÉM "paga": a ordem aqui não é estética. Testar "paga"
  // primeiro classificava "Proposta em Pagamento" como já paga — dinheiro que
  // ainda não saiu apareceria como pago no painel da Liderança.
  if (/pagamento/.test(s))                  return { chave: 'empago',  rotulo: 'Em pagamento',  classe: 'em-badge--empago' };
  if (/\bpaga\b/.test(s))                  return { chave: 'pago',    rotulo: 'Paga',          classe: 'em-badge--pago' };
  if (/formaliza/.test(s))                  return { chave: 'formal',  rotulo: 'Formalização',  classe: 'em-badge--formal' };
  if (/empenh/.test(s))                     return { chave: 'empenho', rotulo: 'Empenho',       classe: 'em-badge--empenho' };
  return { chave: 'neutro', rotulo: item.situacao || 'Em análise', classe: 'em-badge--neutro' };
}

// ============================================================
//  VARREDURA (as 27 UFs)
// ============================================================
async function buscarNoFns(escopo = 'tudo') {
  if (state.varredura) return;
  const ano = state.ano;

  // ESCOPO da coleta. O FNS não tem consulta "o que mudou desde ontem": a
  // menor unidade que ele entrega é a planilha inteira de uma UF. Então o
  // incremental possível é por ESTADO — depois da primeira varredura sabemos
  // em quais UFs a bancada tem proposta, e atualizar só essas custa uma fração
  // do tempo. A varredura completa continua existindo para achar UF nova.
  const comBancada = Object.keys(state.meta).filter(uf => (state.meta[uf].n || 0) > 0);
  const ufs = (escopo === 'bancada' && comBancada.length) ? comBancada : UFS;

  const ctrl = new AbortController();
  state.varredura = ctrl;
  document.getElementById('btn-buscar').disabled = true;
  document.getElementById('btn-atualizar').disabled = true;
  document.getElementById('em-vazio').style.display = 'none';
  document.getElementById('em-progresso').style.display = '';

  // Retrato do que havia ANTES, para dizer o que mudou (é disto que vive um
  // módulo de monitoramento: proposta que virou paga, valor que subiu).
  const antes = new Map(state.itens.map(i => [`${i.nuProposta}|${i.deputado}`, i]));

  state.log = {
    inicio: new Date().toISOString(),
    ano, escopo, ufs: ufs.length,
    versao: (chrome.runtime?.getManifest?.().version || '?'),
    linhas: [],
  };
  const encontrados = [];
  const falhas = [];
  let prontas = 0;

  const pintar = (uf) => {
    const pct = Math.round((prontas / ufs.length) * 100);
    document.getElementById('em-barra-fill').style.width = pct + '%';
    document.getElementById('em-prog-txt').textContent =
      `Consultando o FNS — ${prontas} de ${ufs.length} estados (${pct}%)`;
    document.getElementById('em-prog-sub').textContent =
      `${encontrados.length} proposta(s) do Podemos até agora${uf ? ` · último: ${uf}` : ''}` +
      (falhas.length ? ` · ${falhas.length} estado(s) com falha` : '');
  };
  pintar('');

  const fila = ufs.slice();
  const trabalhador = async () => {
    while (fila.length) {
      if (ctrl.signal.aborted) return;
      const uf = fila.shift();
      const reg = { uf };
      const t0 = Date.now();
      try {
        const { buffer, tentativas, status, ms } = await baixarPlanilhaUf(uf, ano, ctrl.signal);
        Object.assign(reg, { status, tentativas, msDownload: ms, bytes: buffer.byteLength });
        const itens = lerPlanilhaPodemos(buffer, uf, ano);
        reg.podemos = itens.length;
        encontrados.push(...itens);
        // Grava por UF assim que fica pronta: uma busca interrompida no meio
        // não joga fora o que já foi lido. Falha de GRAVAÇÃO conta como falha
        // do estado — antes era engolida, e como a tela recarregava do banco,
        // a UF sumia da base sem ninguém saber.
        try {
          await fbSalvarUf(ano, uf, itens);
          reg.salvo = true;
        } catch (eSalvar) {
          reg.salvo = false;
          reg.erro = `lido do FNS, mas NÃO salvo no Firebase: ${eSalvar.message}`;
          falhas.push(`${uf}: ${reg.erro}`);
        }
      } catch (e) {
        if (e.name === 'AbortError') { reg.erro = 'cancelado'; state.log.linhas.push(reg); return; }
        reg.erro = e.message;
        reg.status = e.status;
        reg.tentativas = e.tentativas;
        reg.msDownload = e.ms;
        falhas.push(`${uf}: ${e.message}`);
      } finally {
        reg.ms = Date.now() - t0;
        state.log.linhas.push(reg);
        console.log('[emendas] ' + linhaDoLog(reg));
        prontas++;
        pintar(uf);
      }
    }
  };
  await Promise.all(Array.from({ length: SIMULTANEAS }, trabalhador));

  state.varredura = null;
  state.log.fim = new Date().toISOString();
  state.log.falhas = falhas.length;
  state.log.propostas = encontrados.length;
  document.getElementById('btn-buscar').disabled = false;
  document.getElementById('btn-atualizar').disabled = false;
  document.getElementById('em-progresso').style.display = 'none';
  document.getElementById('btn-log').style.display = '';

  // A tela passa a valer o que FOI LIDO nesta rodada, não o que o banco
  // devolve: assim uma UF que falhou ao salvar continua visível (e declarada),
  // em vez de desaparecer no recarregamento.
  const naoTocadas = state.itens.filter(i => !ufs.includes(i.uf));
  state.itens = naoTocadas.concat(encontrados);
  for (const reg of state.log.linhas) {
    if (reg.podemos !== undefined) state.meta[reg.uf] = { em: new Date().toISOString(), n: reg.podemos, salvo: reg.salvo };
  }
  const mudancas = compararComAnterior(antes, encontrados);
  state.log.mudancas = mudancas;
  renderTudo();

  if (ctrl.signal.aborted) {
    mostrarToast('Busca cancelada — o que já foi lido está salvo.', 'aviso');
  } else if (falhas.length) {
    // Falha DECLARADA: dizer quais estados ficaram de fora é melhor que
    // apresentar um total incompleto como se fosse a base inteira.
    mostrarToast(`${encontrados.length} propostas · ${falhas.length} estado(s) com problema: ${falhas.map(f => f.split(':')[0]).join(', ')} — veja o log da coleta`, 'aviso');
    console.warn('[emendas] estados com falha:\n' + falhas.join('\n'));
  } else {
    mostrarToast(`✓ ${encontrados.length} propostas em ${ufs.length} estado(s)${resumoMudancas(mudancas)}`, 'sucesso');
  }
}

/** O que mudou nesta coleta em relação ao retrato anterior. */
function compararComAnterior(antes, agora) {
  const novas = [], pagas = [], subiu = [];
  if (!antes.size) return { novas, pagas, subiu, primeira: true };
  for (const it of agora) {
    const ant = antes.get(`${it.nuProposta}|${it.deputado}`);
    if (!ant) { novas.push(it); continue; }
    if (etapaDe(ant).chave !== 'pago' && etapaDe(it).chave === 'pago') pagas.push(it);
    else if (it.pago > ant.pago) subiu.push({ ...it, antes: ant.pago });
  }
  return { novas, pagas, subiu, primeira: false };
}

function resumoMudancas(m) {
  if (!m || m.primeira) return '';
  const p = [];
  if (m.novas.length) p.push(`${m.novas.length} nova(s)`);
  if (m.pagas.length) p.push(`${m.pagas.length} passou(aram) a paga`);
  if (m.subiu.length) p.push(`${m.subiu.length} com pagamento novo`);
  return p.length ? ` · ${p.join(', ')}` : ' · nada mudou desde a última busca';
}

// ============================================================
//  LOG DA COLETA — o relatório que o analista copia e manda
// ============================================================
function linhaDoLog(r) {
  const seg = ms => (ms / 1000).toFixed(1) + 's';
  const kb = b => Math.round(b / 1024) + ' KB';
  if (r.erro) {
    return `✗ ${String(r.uf).padEnd(3)} ${r.erro}` +
           (r.status ? ` · HTTP ${r.status}` : '') +
           (r.tentativas ? ` · ${r.tentativas} tentativa(s)` : '') +
           (r.ms ? ` · ${seg(r.ms)}` : '');
  }
  return `✓ ${String(r.uf).padEnd(3)} ${String(r.podemos).padStart(4)} do PODE · ${kb(r.bytes)} · ${seg(r.msDownload)}` +
         (r.tentativas > 1 ? ` · ${r.tentativas} tentativas` : '') +
         (r.salvo === false ? ' · NÃO SALVO' : '');
}

function relatorioDaColeta() {
  const l = state.log;
  if (!l) return 'Nenhuma coleta nesta sessão.';
  const dur = l.fim ? ((new Date(l.fim) - new Date(l.inicio)) / 1000).toFixed(0) + 's' : 'em andamento';
  const cab = [
    `SisPode ${l.versao} · log da coleta de emendas · ${new Date(l.inicio).toLocaleString('pt-BR')}`,
    `Exercício ${l.ano} · escopo: ${l.escopo === 'bancada' ? 'estados com propostas da bancada' : 'todos os estados'} (${l.ufs} UF) · duração ${dur}`,
    `Resultado: ${l.propostas ?? '—'} proposta(s) do Podemos · ${l.falhas ?? 0} estado(s) com problema`,
    '',
  ];
  const linhas = l.linhas.slice().sort((a, b) => String(a.uf).localeCompare(String(b.uf))).map(linhaDoLog);
  const m = l.mudancas;
  const rodape = [];
  if (m && !m.primeira) {
    rodape.push('', 'MUDANÇAS DESDE A BUSCA ANTERIOR');
    if (!m.novas.length && !m.pagas.length && !m.subiu.length) rodape.push('  (nada mudou)');
    for (const it of m.pagas.slice(0, 40)) rodape.push(`  paga agora · ${it.deputado} · ${it.nuProposta} · ${it.municipio}/${it.uf} · ${fmtR$(it.pago)}`);
    for (const it of m.subiu.slice(0, 40)) rodape.push(`  pagamento novo · ${it.deputado} · ${it.nuProposta} · ${fmtR$(it.antes)} → ${fmtR$(it.pago)}`);
    for (const it of m.novas.slice(0, 40)) rodape.push(`  nova · ${it.deputado} · ${it.nuProposta} · ${it.municipio}/${it.uf} · ${fmtR$(it.proposto)}`);
  }
  return cab.concat(linhas, rodape).join('\n');
}

async function copiarLog() {
  const texto = relatorioDaColeta();
  console.log('[emendas] log da coleta\n' + texto);
  let ok = false;
  try { await navigator.clipboard.writeText(texto); ok = true; } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  mostrarToast(ok ? 'Log da coleta copiado — cole na conversa do suporte.'
                  : 'Log no console (F12) — não consegui copiar.', ok ? 'sucesso' : 'aviso');
}

// ============================================================
//  FIREBASE — só o recorte do partido
// ============================================================
async function fbSalvarUf(ano, uf, itens) {
  const corpo = { em: new Date().toISOString(), n: itens.length, itens };
  const r = await fetchComTimeout(`${FIREBASE_URL}/emendas-fns/${ano}/${uf}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  }, 20000);
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
}

async function carregarDoFirebase(ano) {
  try {
    const r = await fetchComTimeout(`${FIREBASE_URL}/emendas-fns/${ano}.json`, {}, 25000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const dados = await r.json();
    state.itens = [];
    state.meta = {};
    for (const uf of Object.keys(dados || {})) {
      const bloco = dados[uf] || {};
      state.meta[uf] = { em: bloco.em, n: bloco.n || 0 };
      for (const it of (bloco.itens || [])) state.itens.push(it);
    }
    state.ano = String(ano);
    renderTudo();
  } catch (e) {
    console.warn('[emendas] não foi possível ler a base salva:', e.message);
    mostrarToast('Não foi possível ler a base salva no Firebase: ' + e.message, 'erro');
  }
}

// ============================================================
//  FILTROS E AGREGAÇÃO
// ============================================================
function filtros() {
  return {
    deputado: document.getElementById('f-deputado').value,
    uf: document.getElementById('f-uf').value,
    municipio: document.getElementById('f-municipio').value.trim().toLowerCase(),
    tipo: document.getElementById('f-tipo').value,
    etapa: document.getElementById('f-etapa').value,
  };
}

function itensFiltrados() {
  const f = filtros();
  return state.itens.filter(it => {
    if (f.deputado && it.deputado !== f.deputado) return false;
    if (f.uf && it.uf !== f.uf) return false;
    if (f.tipo && it.tipo !== f.tipo) return false;
    if (f.municipio && !String(it.municipio).toLowerCase().includes(f.municipio)) return false;
    if (f.etapa && etapaDe(it).chave !== f.etapa) return false;
    return true;
  });
}

function somar(itens) {
  const t = { proposto: 0, empenhado: 0, pago: 0, n: itens.length, nPagas: 0 };
  for (const it of itens) {
    t.proposto += it.proposto; t.empenhado += it.empenhado; t.pago += it.pago;
    if (etapaDe(it).chave === 'pago') t.nPagas++;
  }
  t.apagar = Math.max(0, t.proposto - t.pago);
  return t;
}

function porDeputado(itens) {
  const mapa = new Map();
  for (const it of itens) {
    const chave = it.deputado || '(sem parlamentar)';
    if (!mapa.has(chave)) mapa.set(chave, { deputado: chave, ufs: new Set(), n: 0, proposto: 0, empenhado: 0, pago: 0 });
    const d = mapa.get(chave);
    d.ufs.add(it.uf); d.n++; d.proposto += it.proposto; d.empenhado += it.empenhado; d.pago += it.pago;
  }
  return [...mapa.values()]
    .map(d => ({ ...d, uf: [...d.ufs].sort().join(', '), pct: d.proposto ? Math.round((d.pago / d.proposto) * 100) : 0 }))
    .sort((a, b) => b.pago - a.pago || b.proposto - a.proposto);
}

// ============================================================
//  RENDER
// ============================================================
const fmt = n => (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtR$ = n => 'R$ ' + fmt(n);

function renderTudo() {
  const temBase = state.itens.length > 0 || Object.keys(state.meta).length > 0;
  document.getElementById('em-vazio').style.display = temBase ? 'none' : '';
  document.getElementById('em-conteudo').style.display = temBase ? '' : 'none';
  document.getElementById('btn-exportar').disabled = !temBase;
  if (!temBase) return;

  popularSelects();
  renderTopo();
  renderKpis();
  if (state.aba === 'propostas') renderTabelaPropostas();
  else renderTabelaDeputados();
}

function popularSelects() {
  const encher = (id, valores, atual) => {
    const sel = document.getElementById(id);
    const escolhido = atual !== undefined ? atual : sel.value;
    const primeiro = sel.querySelector('option[value=""]');
    sel.innerHTML = '';
    if (primeiro) sel.appendChild(primeiro);
    for (const v of valores) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    }
    if (escolhido && valores.includes(escolhido)) sel.value = escolhido;
  };
  encher('f-deputado', [...new Set(state.itens.map(i => i.deputado).filter(Boolean))].sort());
  encher('f-uf',       [...new Set(state.itens.map(i => i.uf).filter(Boolean))].sort());
  encher('f-tipo',     [...new Set(state.itens.map(i => i.tipo).filter(Boolean))].sort());

  const anos = document.getElementById('f-ano');
  if (!anos.options.length) {
    const atual = new Date().getFullYear();
    for (let a = atual; a >= atual - 3; a--) {
      const o = document.createElement('option');
      o.value = String(a); o.textContent = String(a);
      anos.appendChild(o);
    }
    anos.value = state.ano;
  }
}

function renderTopo() {
  const ufs = Object.keys(state.meta);
  const datas = ufs.map(u => state.meta[u].em).filter(Boolean).sort();
  const ultima = datas.length ? new Date(datas[datas.length - 1]) : null;
  const dep = [...new Set(state.itens.map(i => i.deputado).filter(Boolean))].length;
  document.getElementById('em-titulo').textContent =
    `${fmt(state.itens.length)} propostas da bancada · ${dep} deputado(s) · exercício ${state.ano}`;
  document.getElementById('em-meta').textContent =
    (ultima ? `Última busca em ${ultima.toLocaleString('pt-BR')} · ` : '') +
    `${ufs.length} de ${UFS.length} estados na base · fonte: portal do Fundo Nacional de Saúde`;
  document.getElementById('em-selo').innerHTML = ufs.length === UFS.length
    ? '<span class="em-badge em-badge--pago">Base completa</span>'
    : `<span class="em-badge em-badge--empenho">Base parcial (${ufs.length}/${UFS.length})</span>`;
}

function renderKpis() {
  const t = somar(itensFiltrados());
  document.getElementById('kpi-proposto').textContent = fmtR$(t.proposto);
  document.getElementById('kpi-proposto-sub').textContent = `${fmt(t.n)} proposta(s)`;
  document.getElementById('kpi-empenhado').textContent = fmtR$(t.empenhado);
  document.getElementById('kpi-empenhado-sub').textContent = t.proposto
    ? `${Math.round((t.empenhado / t.proposto) * 100)}% do proposto` : '';
  document.getElementById('kpi-pago').textContent = fmtR$(t.pago);
  document.getElementById('kpi-pago-sub').textContent = t.proposto
    ? `${Math.round((t.pago / t.proposto) * 100)}% do proposto · ${fmt(t.nPagas)} paga(s)` : '';
  document.getElementById('kpi-apagar').textContent = fmtR$(t.apagar);
  document.getElementById('kpi-apagar-sub').textContent = `${fmt(t.n - t.nPagas)} em andamento`;
}

const COLS_PROPOSTAS = [
  { chave: 'deputado',  rotulo: 'Deputado', classe: 'forte' },
  { chave: 'nuProposta',rotulo: 'Proposta', classe: 'dim' },
  { chave: 'municipio', rotulo: 'Município' },
  { chave: 'entidade',  rotulo: 'Entidade', classe: 'dim' },
  { chave: 'tipo',      rotulo: 'Objeto' },
  { chave: 'proposto',  rotulo: 'Proposto',  num: true },
  { chave: 'empenhado', rotulo: 'Empenhado', num: true },
  { chave: 'pago',      rotulo: 'Pago',      num: true, classe: 'pago' },
  { chave: 'etapa',     rotulo: 'Etapa' },
];

function ordenar(itens, col, desc) {
  const val = it => col === 'etapa' ? etapaDe(it).rotulo : it[col];
  return itens.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    const cmp = (typeof va === 'number' && typeof vb === 'number')
      ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR');
    return desc ? -cmp : cmp;
  });
}

function renderTabelaPropostas() {
  const thead = document.getElementById('em-thead');
  thead.innerHTML = '<tr>' + COLS_PROPOSTAS.map(c => {
    const seta = state.ordem.col === c.chave ? (state.ordem.desc ? ' ↓' : ' ↑') : '';
    return `<th data-col="${c.chave}"${c.num ? ' class="num"' : ''}>${c.rotulo}${seta}</th>`;
  }).join('') + '</tr>';
  thead.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.col;
    state.ordem = { col, desc: state.ordem.col === col ? !state.ordem.desc : true };
    renderTabelaPropostas();
  }));

  const itens = ordenar(itensFiltrados(), state.ordem.col, state.ordem.desc);
  const tbody = document.getElementById('em-tbody');
  tbody.innerHTML = itens.map(it => {
    const et = etapaDe(it);
    return `<tr data-proposta="${escapeHtml(it.nuProposta)}">
      <td class="forte">${escapeHtml(it.deputado)} <span class="dim" style="font-weight:400">${escapeHtml(it.uf)}</span></td>
      <td class="dim num" style="text-align:left">${escapeHtml(it.nuProposta)}</td>
      <td>${escapeHtml(it.municipio)}</td>
      <td class="dim">${escapeHtml(it.entidade)}</td>
      <td>${escapeHtml(it.tipo)}</td>
      <td class="num">${fmt(it.proposto)}</td>
      <td class="num">${fmt(it.empenhado)}</td>
      <td class="num ${it.pago ? 'pago' : 'dim'}">${fmt(it.pago)}</td>
      <td><span class="em-badge ${et.classe}">${escapeHtml(et.rotulo)}</span></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="padding:30px; text-align:center; color:var(--text-dim)">Nenhuma proposta com esses filtros.</td></tr>`;

  tbody.querySelectorAll('tr[data-proposta]').forEach(tr =>
    tr.addEventListener('click', () => abrirDetalhe(tr.dataset.proposta)));
}

function renderTabelaDeputados() {
  const linhas = porDeputado(itensFiltrados());
  document.getElementById('em-thead').innerHTML =
    '<tr><th>Deputado</th><th>UF</th><th class="num">Propostas</th><th class="num">Proposto</th>' +
    '<th class="num">Empenhado</th><th class="num">Pago</th><th style="width:200px">Execução</th></tr>';
  const total = somar(itensFiltrados());
  const barra = (pct) => {
    const cor = pct >= 50 ? 'var(--accent)' : pct >= 20 ? 'var(--amarelo)' : 'var(--vermelho)';
    return `<div class="em-exec"><div class="em-exec-barra"><div style="width:${Math.max(pct, 2)}%; background:${cor}"></div></div>
            <span class="em-exec-pct">${pct}%</span></div>`;
  };
  document.getElementById('em-tbody').innerHTML = linhas.map(d => `
    <tr>
      <td class="forte">${escapeHtml(d.deputado)}</td>
      <td class="dim">${escapeHtml(d.uf)}</td>
      <td class="num">${fmt(d.n)}</td>
      <td class="num">${fmt(d.proposto)}</td>
      <td class="num">${fmt(d.empenhado)}</td>
      <td class="num pago">${fmt(d.pago)}</td>
      <td>${barra(d.pct)}</td>
    </tr>`).join('') + (linhas.length ? `
    <tr style="background: rgba(31,165,165,0.06)">
      <td class="forte" style="color: var(--accent-light)">Bancada (total)</td>
      <td class="dim">—</td>
      <td class="num forte">${fmt(total.n)}</td>
      <td class="num forte">${fmt(total.proposto)}</td>
      <td class="num forte">${fmt(total.empenhado)}</td>
      <td class="num pago">${fmt(total.pago)}</td>
      <td>${barra(total.proposto ? Math.round((total.pago / total.proposto) * 100) : 0)}</td>
    </tr>` : `<tr><td colspan="7" style="padding:30px; text-align:center; color:var(--text-dim)">Nenhuma proposta com esses filtros.</td></tr>`);
}

// ============================================================
//  DETALHE DA PROPOSTA (sob demanda, direto no FNS)
// ============================================================
const ETAPAS_FNS = ['Cadastro', 'Análise de mérito', 'Análise econômica', 'Classificação orçamentária',
  'Aprovação secretaria finalística', 'Autorização secretaria executiva', 'Publicação', 'Autorização FNS',
  'Empenho', 'Formalização', 'Em pagamento', 'Pago'];

async function abrirDetalhe(nuProposta) {
  const base = state.itens.find(i => i.nuProposta === nuProposta);
  if (!base) return;
  const modal = document.getElementById('modal-detalhe');
  const et = etapaDe(base);
  document.getElementById('det-titulo').textContent = `Proposta ${nuProposta}`;
  document.getElementById('det-badge').innerHTML = `<span class="em-badge ${et.classe}">${escapeHtml(et.rotulo)}</span>`;
  document.getElementById('det-sub').textContent =
    `${base.deputado} (PODE-${base.uf}) · ${base.municipio} · exercício ${base.ano}`;
  document.getElementById('det-link').href = `${FNS_BASE}/#/proposta`;
  document.getElementById('det-fonte').textContent = 'Consultando o FNS…';
  document.getElementById('det-corpo').innerHTML =
    '<div style="padding:40px; text-align:center; color:var(--text-dim)">Buscando o detalhe no portal do FNS…</div>';
  modal.style.display = 'flex';

  let detalhe = null, etapas = null, erro = null;
  try {
    const [d, e] = await Promise.all([
      fetchComTimeout(`${FNS_BASE}/recursos/proposta/obter-proposta?nuProposta=${encodeURIComponent(nuProposta)}`).then(r => r.ok ? r.json() : null),
      fetchComTimeout(`${FNS_BASE}/recursos/proposta/obter-proposta-etapa?nuProposta=${encodeURIComponent(nuProposta)}`).then(r => r.ok ? r.json() : null),
    ]);
    detalhe = d?.resultado || null;
    etapas = e?.resultado || null;
  } catch (e) { erro = e.message; }

  document.getElementById('det-corpo').innerHTML = htmlDetalhe(base, detalhe, etapas, erro);
  document.getElementById('det-fonte').textContent = erro
    ? `Detalhe não consultado (${erro}) — os valores abaixo vêm da planilha baixada.`
    : `Consultado no FNS em ${new Date().toLocaleString('pt-BR')}`;
}

function htmlDetalhe(base, d, etapasApi, erro) {
  const ficha = [
    ['Município', `${base.municipio}/${base.uf}`],
    ['Entidade', d?.noEntidade || base.entidade],
    ['CNPJ', d?.cnpjFormatado || base.cnpj],
    ['Objeto', d?.coTipoProposta || base.tipo],
    ['Portaria', base.portaria ? `nº ${base.portaria}${base.dataPortaria ? `, de ${base.dataPortaria}` : ''}` : '—'],
    ['Processo', d?.nuProcesso && d.nuProcesso !== 'N/A' ? d.nuProcesso : (base.localizacaoPagamento || '—')],
  ];
  const proposto  = d ? (d.vlProposta ?? base.proposto)  : base.proposto;
  const empenhado = d ? (d.vlEmpenhado ?? base.empenhado) : base.empenhado;
  const pago      = d ? (d.vlPago ?? base.pago)           : base.pago;
  const valores = [
    ['Proposto', fmtR$(proposto), ''],
    ['Empenhado', fmtR$(empenhado), ''],
    ['Pago', fmtR$(pago), 'color:#2fcf7a'],
    ['A pagar', fmtR$(Math.max(0, proposto - pago)), 'color:var(--text-dim)'],
  ];

  // Etapas: a API manda a lista com a atual marcada. Sem ela (falha), a
  // situação da planilha ainda diz em que ponto a proposta está — mas isso
  // fica ESCRITO, para ninguém confundir estimativa com dado da fonte.
  const codigoAtual = etapasApi?.codigoAtual;
  const listaEtapas = etapasApi?.etapas?.length
    ? etapasApi.etapas.map(e => ({ nome: e.descricao, feita: e.codigo < codigoAtual, atual: !!e.atual }))
    : null;

  const etapasHtml = listaEtapas
    ? `<div class="em-etapas">${listaEtapas.map(e => `
        <div class="em-etapa ${e.atual ? 'atual' : ''}">
          <div class="em-etapa-bola ${e.atual ? 'atual' : e.feita ? 'feita' : ''}">
            ${e.feita || e.atual ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${e.atual ? '#0e1c1f' : '#2fcf7a'}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
          </div>
          <span class="em-etapa-nome">${escapeHtml(e.nome)}</span>
        </div>`).join('')}</div>`
    : `<div style="font-size:12.5px; color:var(--text-dim)">Não foi possível consultar as etapas no FNS agora.
        Pela planilha, a situação registrada é: <b style="color:var(--text)">${escapeHtml(base.situacao || '—')}</b>.</div>`;

  const pagamentos = d?.pagamentos || [];
  const dataBr = ms => ms ? new Date(ms).toLocaleDateString('pt-BR') : '—';
  const pagHtml = pagamentos.length ? `
    <table class="em-tabela" style="border:1px solid var(--border); border-radius:var(--radius); overflow:hidden">
      <thead><tr><th>Parcela</th><th>Data</th><th>Ordem bancária</th><th>Processo</th><th class="num">Valor</th><th class="num">Acumulado</th></tr></thead>
      <tbody>${pagamentos.map(p => `<tr>
        <td>${escapeHtml(p.nuParcela || '—')}</td>
        <td class="num" style="text-align:left">${dataBr(p.dtCriacaoSiafi)}</td>
        <td class="num" style="text-align:left">${escapeHtml(p.nuOb || '—')}</td>
        <td class="dim">${escapeHtml(p.nuProcesso || '—')}</td>
        <td class="num pago">${fmt(p.vlLiquido)}</td>
        <td class="num">${fmt(p.vlAcumulado)}</td>
      </tr>`).join('')}</tbody>
    </table>`
    : `<div style="font-size:12.5px; color:var(--text-dim)">${erro || !d ? 'Pagamentos não consultados.' : 'Nenhum pagamento registrado até agora.'}</div>`;

  return `
    <div class="em-ficha">
      ${ficha.map(([r, v]) => `<div class="em-ficha-item"><span class="em-rotulo">${r}</span><span>${escapeHtml(v || '—')}</span></div>`).join('')}
    </div>
    <div class="em-valores">
      ${valores.map(([r, v, st]) => `<div class="em-valor-card"><span class="em-rotulo">${r}</span><span class="v" style="${st}">${v}</span></div>`).join('')}
    </div>
    <div style="padding:18px 20px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:12px;">
      <span class="em-secao-rotulo">Etapas no Fundo Nacional de Saúde</span>
      ${etapasHtml}
    </div>
    <div style="padding:18px 20px; display:flex; flex-direction:column; gap:10px;">
      <span class="em-secao-rotulo">Pagamentos</span>
      ${pagHtml}
    </div>`;
}

// ============================================================
//  EXPORTAÇÃO
// ============================================================
function exportarXlsx() {
  const itens = ordenar(itensFiltrados(), state.ordem.col, state.ordem.desc);
  if (!itens.length) { mostrarToast('Nada para exportar com esses filtros.', 'aviso'); return; }

  const cab = ['Deputado', 'Partido', 'UF', 'Proposta', 'Município', 'Entidade', 'CNPJ',
               'Objeto', 'Tipo de recurso', 'Portaria', 'Data da portaria',
               'Proposto', 'Empenhado', 'Pago', 'A pagar', 'Situação', 'Etapa'];
  const linhas = itens.map(it => [
    it.deputado, SIGLA_PODEMOS, it.uf, it.nuProposta, it.municipio, it.entidade, it.cnpj,
    it.tipo, it.tipoRecurso, it.portaria, it.dataPortaria,
    it.proposto, it.empenhado, it.pago, Math.max(0, it.proposto - it.pago),
    it.situacao, etapaDe(it).rotulo,
  ]);
  const t = somar(itens);
  linhas.push([]);
  linhas.push(['TOTAL', '', '', `${t.n} propostas`, '', '', '', '', '', '', '',
               t.proposto, t.empenhado, t.pago, t.apagar, '', '']);

  const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
  ws['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 5 }, { wch: 20 }, { wch: 22 }, { wch: 34 }, { wch: 20 },
                 { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 12 },
                 { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 34 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Emendas ${state.ano}`);
  const f = filtros();
  const sufixo = [f.deputado, f.uf, f.etapa].filter(Boolean).join('-').replace(/\s+/g, '_');
  XLSX.writeFile(wb, `emendas-fns-${state.ano}${sufixo ? '-' + sufixo : ''}.xlsx`);
  mostrarToast(`✓ ${itens.length} proposta(s) exportadas.`, 'sucesso');
}

// ============================================================
//  UTILITÁRIOS E ARRANQUE
// ============================================================
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mostrarToast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${tipo}`;
  el.style.display = 'block';
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-voltar').addEventListener('click', () => window.close());
  document.getElementById('btn-buscar').addEventListener('click', () => buscarNoFns('tudo'));
  document.getElementById('btn-buscar-vazio').addEventListener('click', () => buscarNoFns('tudo'));
  document.getElementById('btn-atualizar').addEventListener('click', () => buscarNoFns('bancada'));
  document.getElementById('btn-log').addEventListener('click', copiarLog);
  document.getElementById('btn-exportar').addEventListener('click', exportarXlsx);
  document.getElementById('btn-cancelar').addEventListener('click', () => {
    if (state.varredura) state.varredura.abort();
  });
  document.getElementById('det-fechar').addEventListener('click', () => {
    document.getElementById('modal-detalhe').style.display = 'none';
  });
  document.getElementById('modal-detalhe').addEventListener('click', e => {
    if (e.target.id === 'modal-detalhe') e.currentTarget.style.display = 'none';
  });

  for (const id of ['f-deputado', 'f-uf', 'f-tipo', 'f-etapa']) {
    document.getElementById(id).addEventListener('change', () => { renderKpis(); renderTabela(); });
  }
  document.getElementById('f-municipio').addEventListener('input', () => { renderKpis(); renderTabela(); });
  document.getElementById('f-ano').addEventListener('change', e => {
    state.ano = e.target.value;
    carregarDoFirebase(state.ano);
  });

  document.querySelectorAll('.em-aba').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.em-aba').forEach(x => x.classList.toggle('on', x === b));
    state.aba = b.dataset.aba;
    renderTabela();
  }));

  popularSelects();
  carregarDoFirebase(state.ano);
});

function renderTabela() {
  if (state.aba === 'propostas') renderTabelaPropostas();
  else renderTabelaDeputados();
}
