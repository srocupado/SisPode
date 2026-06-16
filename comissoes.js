/* ============================================================
   CONTROLE DE COMISSÕES – PODEMOS
   Liderança do Podemos – Câmara dos Deputados
   ============================================================ */

'use strict';

// ---------- DADOS FIXOS ----------

const COMISSOES_PERMANENTES = [
  { sigla: 'CASP',    nome: 'Administração e Serviço Público' },
  { sigla: 'CAPADR',  nome: 'Agricultura, Pecuária, Abastecimento e Desenvolvimento Rural' },
  { sigla: 'CPOVOS',  nome: 'Amazônia e dos Povos Originários e Tradicionais' },
  { sigla: 'CCTI',    nome: 'Ciência, Tecnologia e Inovação' },
  { sigla: 'CCOM',    nome: 'Comunicação' },
  { sigla: 'CCJC',    nome: 'Constituição e Justiça e de Cidadania' },
  { sigla: 'CCULT',   nome: 'Cultura' },
  { sigla: 'CDC',     nome: 'Defesa do Consumidor' },
  { sigla: 'CMULHER', nome: 'Defesa dos Direitos da Mulher' },
  { sigla: 'CIDOSO',  nome: 'Defesa dos Direitos da Pessoa Idosa' },
  { sigla: 'CPD',     nome: 'Defesa dos Direitos das Pessoas com Deficiência' },
  { sigla: 'CDE',     nome: 'Desenvolvimento Econômico' },
  { sigla: 'CDU',     nome: 'Desenvolvimento Urbano' },
  { sigla: 'CDHMIR',  nome: 'Direitos Humanos, Minorias e Igualdade Racial' },
  { sigla: 'CE',      nome: 'Educação' },
  { sigla: 'CESPO',   nome: 'Esporte' },
  { sigla: 'CFT',     nome: 'Finanças e Tributação' },
  { sigla: 'CFFC',    nome: 'Fiscalização Financeira e Controle' },
  { sigla: 'CICS',    nome: 'Indústria, Comércio e Serviços' },
  { sigla: 'CINDRE',  nome: 'Integração Nacional e Desenvolvimento Regional' },
  { sigla: 'CLP',     nome: 'Legislação Participativa' },
  { sigla: 'CMADS',   nome: 'Meio Ambiente e Desenvolvimento Sustentável' },
  { sigla: 'CME',     nome: 'Minas e Energia' },
  { sigla: 'CPASF',   nome: 'Previdência, Assistência Social, Infância, Adolescência e Família' },
  { sigla: 'CREDN',   nome: 'Relações Exteriores e de Defesa Nacional' },
  { sigla: 'CSAUDE',  nome: 'Saúde' },
  { sigla: 'CSPCCO',  nome: 'Segurança Pública e Combate ao Crime Organizado' },
  { sigla: 'CTRAB',   nome: 'Trabalho' },
  { sigla: 'CTUR',    nome: 'Turismo' },
  { sigla: 'CVT',     nome: 'Viação e Transportes' },
];

// Comissões mutuamente exclusivas como titular.
const GRUPOS_INCOMPATIVEIS = [
  [
    'CCJC',   // Constituição e Justiça e de Cidadania
    'CFT',    // Finanças e Tributação
    'CFFC',   // Fiscalização Financeira e Controle
    'CE',     // Educação
    'CSAUDE', // Saúde
    'CTRAB',  // Trabalho
    'CPASF',  // Previdência, Assistência Social, Infância, Adolescência e Família
    'CAPADR', // Agricultura, Pecuária, Abastecimento e Desenvolvimento Rural
    'CME',    // Minas e Energia
    'CVT',    // Viação e Transportes
    'CDU',    // Desenvolvimento Urbano
    'CCTI',   // Ciência, Tecnologia e Inovação
    'CICS',   // Indústria, Comércio e Serviços
    'CDC',    // Defesa do Consumidor
  ],
];

// ---------- SENADO / SINCRONIZAÇÃO DE MPVs ----------

// Comissões mistas de MPV são colegiados do Congresso Nacional; o Senado é a
// fonte autoritativa da existência e da situação delas. A página de pesquisa
// de comissões traz a coluna de situação (a API de dados abertos não a expõe
// de forma confiável — o histórico de eventos fica defasado).
const SENADO_BASE = 'https://legis.senado.leg.br';
const SENADO_PESQUISA_URL = `${SENADO_BASE}/atividade/comissoes/pesquisar/`;
// Cache considerado "velho" após 12h → dispara auto-sync silencioso.
const MPV_SYNC_TTL_MS = 12 * 60 * 60 * 1000;

const MPV_SIT_FUNCIONAMENTO = 'Em funcionamento';
const MPV_SIT_AGUARDANDO     = 'Aguardando instalação';

// ---------- FIREBASE ----------

const FB_BASE = 'https://plenario-podemos-default-rtdb.firebaseio.com/comissoes-podemos';

async function fbGet(path) {
  const r = await fetch(`${FB_BASE}${path}.json`);
  if (!r.ok) throw new Error('Firebase GET ' + r.status);
  return r.json();
}

async function fbPut(path, data) {
  const r = await fetch(`${FB_BASE}${path}.json`, {
    method: 'PUT',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error('Firebase PUT ' + r.status);
  return r.json();
}

async function fbDelete(path) {
  const r = await fetch(`${FB_BASE}${path}.json`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Firebase DELETE ' + r.status);
}

// ---------- ESTADO ----------

const state = {
  view:          'comissao',  // 'comissao' | 'deputado' | 'alertas'
  comTab:        'permanente',// sub-aba de "Por Comissão": 'permanente' | 'mista'
  comissaoSel:   null,        // sigla da comissão selecionada
  deputados:     {},          // { id: { nome, uf } }
  membros:       {},          // { sigla: { titulares: [id,...], suplentes: [id,...] } }
  config:        {},          // { sigla: { titular: n, suplente: n } }
  transferencias:{},          // { sigla: { cedidas: {id: entry}, recebidas: {id: entry} } }
  pedidos:       {},          // { sigla: { id: { depId, obs, data } } }
  mistas:        {},          // { sigla: { sigla, nome, mpvId, numero, ano, situacao, origem } } — sincronizadas/criadas
  mistasOcultas: {},          // { sigla: true } — mistas apagadas manualmente (sync não readiciona)
  mistasSyncAt:  null,        // ISO da última sincronização das mistas
  sincronizando: false,
  busca:         '',
};

// Contexto do modal de transferência em andamento
let _transfCtx = null; // { sigla, tipo, direcao }
// Contexto do modal de deputado de acordo
let _depAcordoCtx = null; // { sigla, transfId }

// ---------- INICIALIZAÇÃO ----------

document.addEventListener('DOMContentLoaded', async () => {
  registrarEventos();
  await carregarDados();
  renderSidebar();
  renderPainel();
  // Auto-sync silencioso se o cache de comissões mistas estiver velho (>12h).
  if (mistasDesatualizadas()) sincronizarMistasUI({ silencioso: true });
});

function registrarEventos() {
  // Tabs de view
  document.querySelectorAll('.com-tab').forEach(tab => {
    tab.addEventListener('click', () => mudarView(tab.dataset.view));
  });

  // Sub-abas de "Por Comissão" (Permanentes / Mistas)
  document.querySelectorAll('.com-subtab').forEach(tab => {
    tab.addEventListener('click', () => mudarComTab(tab.dataset.comtab));
  });

  // Busca
  document.getElementById('com-busca').addEventListener('input', e => {
    state.busca = e.target.value.trim().toLowerCase();
    renderSidebar();
  });

  // Voltar à tela inicial
  document.getElementById('btn-voltar-home')
    .addEventListener('click', () => window.close());

  // Gerir deputados
  document.getElementById('btn-gerir-deputados')
    .addEventListener('click', () => abrirModalDeputados());

  // Configurar vagas
  document.getElementById('btn-config-vagas')
    .addEventListener('click', abrirModalConfigVagas);

  // Salvar config de vagas
  document.getElementById('btn-salvar-vagas')
    .addEventListener('click', salvarConfigVagas);

  // Confirmar transferência
  document.getElementById('btn-confirmar-transf')
    .addEventListener('click', confirmarTransferencia);

  // Exportar Excel
  document.getElementById('btn-exportar-excel')
    .addEventListener('click', exportarExcel);

  // Fechar modais
  document.querySelectorAll('[data-fecha]').forEach(btn => {
    btn.addEventListener('click', () => fecharModal(btn.dataset.fecha));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) fecharModal(overlay.id);
    });
  });

  // Adicionar deputado
  document.getElementById('btn-add-deputado')
    .addEventListener('click', adicionarDeputado);
  document.getElementById('dep-nome-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter') adicionarDeputado(); });

  // Importar bancada da API da Câmara
  document.getElementById('btn-importar-camara')
    .addEventListener('click', importarDeputadosDaCamara);

  // Salvar deputado de acordo em vaga cedida
  document.getElementById('btn-salvar-dep-acordo')
    .addEventListener('click', salvarDepAcordo);

  // Sincronizar comissões mistas de MPV (manual)
  document.getElementById('btn-sync-mpv')
    .addEventListener('click', () => sincronizarMistasUI({ silencioso: false }));

  // Criar comissão mista manualmente
  document.getElementById('btn-criar-mista')
    .addEventListener('click', criarMista);
  document.getElementById('nova-mista-numero')
    .addEventListener('keydown', e => { if (e.key === 'Enter') criarMista(); });
}

// ---------- LOOKUP DE COMISSÕES (permanentes + mistas) ----------

// Comissão por sigla, em qualquer das duas camadas.
function getComissao(sigla) {
  return COMISSOES_PERMANENTES.find(c => c.sigla === sigla)
      || state.mistas[sigla]
      || null;
}

// 'permanente' | 'mista' | null
function tipoComissao(sigla) {
  if (COMISSOES_PERMANENTES.some(c => c.sigla === sigla)) return 'permanente';
  if (state.mistas[sigla]) return 'mista';
  return null;
}

// Mistas ordenadas da mais recente para a mais antiga.
function listaMistas() {
  // Em funcionamento primeiro; depois as demais. Dentro de cada grupo, da mais
  // recente para a mais antiga (por ano e número da MPV).
  const ordemSit = c => (c.situacao === MPV_SIT_FUNCIONAMENTO ? 0 : 1);
  return Object.values(state.mistas)
    .sort((a, b) =>
      (ordemSit(a) - ordemSit(b)) ||
      (b.ano - a.ano) ||
      (b.numero - a.numero));
}

// Todas as comissões com rótulo de tipo (para sidebar/exportação).
function todasComissoes() {
  return [
    ...COMISSOES_PERMANENTES.map(c => ({ ...c, tipo: 'Permanente' })),
    ...listaMistas().map(c => ({ ...c, tipo: 'Mista' })),
  ];
}

// Executa fn sobre items com no máximo `limit` promessas simultâneas.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- FIREBASE: CRUD ----------

async function carregarDados() {
  try {
    const [deps, membros, config, transf, pedidos, mistas] = await Promise.all([
      fbGet('/deputados'),
      fbGet('/membros'),
      fbGet('/config'),
      fbGet('/transferencias'),
      fbGet('/pedidos'),
      fbGet('/comissoes-mistas'),
    ]);
    state.deputados      = deps    || {};
    state.membros        = membros || {};
    state.config         = config  || {};
    state.transferencias = transf  || {};
    state.pedidos        = pedidos || {};
    state.mistas         = mistas?.comissoes || {};
    state.mistasOcultas  = mistas?.ocultas   || {};
    state.mistasSyncAt   = mistas?.syncAt    || null;
  } catch (e) {
    mostrarToast('Erro ao carregar dados do Firebase.', 'erro');
  }
}

// ---------- SINCRONIZAÇÃO DE COMISSÕES MISTAS (MPV) ----------

function mistasDesatualizadas() {
  if (!state.mistasSyncAt) return true;
  return (Date.now() - new Date(state.mistasSyncAt).getTime()) > MPV_SYNC_TTL_MS;
}

// Extrai as comissões mistas de MPV (e suas situações) da página de pesquisa de
// comissões do Senado. A página renderiza uma linha por comissão, iniciada por
// um link /atividade/comissoes/comissao/{codigo}; o corpo até o próximo link
// contém a sigla (CMMPV n/aaaa) e a célula de situação. Mantém só as ativas.
function parseMistasDoHtml(html) {
  const out = {};
  const blocos = html.split(/<a\s+href="\/atividade\/comissoes\/comissao\/(\d+)"/i);
  for (let i = 1; i < blocos.length; i += 2) {
    const codigoSenado = blocos[i];
    const corpo = blocos[i + 1] || '';
    const m = corpo.match(/CMMPV\s*(\d+)\s*\/\s*(\d{4})/i);
    if (!m) continue;
    const numero = parseInt(m[1], 10);
    const ano    = parseInt(m[2], 10);
    if (!numero || !ano) continue;

    const sm = corpo.match(/Aguardando\s+instala[çc][ãa]o|Em\s+funcionamento|Encerrada/i);
    if (!sm || /encerrada/i.test(sm[0])) continue; // só comissões ativas

    const sigla = `MPV${numero}${String(ano).slice(-2)}`;
    out[sigla] = {
      sigla, numero, ano,
      nome: `Comissão Mista da MPV ${numero}/${ano}`,
      situacao: /funcionamento/i.test(sm[0]) ? MPV_SIT_FUNCIONAMENTO : MPV_SIT_AGUARDANDO,
      codigoSenado,
      origem: 'api',
    };
  }
  return out;
}

// Busca as comissões mistas de MPV ativas no Senado (com a situação real) e
// persiste no Firebase, preservando as criadas manualmente e as apagadas.
async function sincronizarMistas() {
  const r = await fetch(SENADO_PESQUISA_URL, { headers: { Accept: 'text/html' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const html = await r.text();
  const daApi = parseMistasDoHtml(html);
  if (!Object.keys(daApi).length) throw new Error('nenhuma comissão lida da página do Senado');

  // 3. Mescla: API (exceto apagadas manualmente) + criadas manualmente (têm prioridade).
  const ocultas   = state.mistasOcultas || {};
  const comissoes = {};
  for (const [sigla, c] of Object.entries(daApi)) {
    if (!ocultas[sigla]) comissoes[sigla] = c;
  }
  for (const [sigla, c] of Object.entries(state.mistas)) {
    if (c.origem === 'manual') comissoes[sigla] = c;
  }

  const payload = { syncAt: new Date().toISOString(), comissoes, ocultas };
  await fbPut('/comissoes-mistas', payload);
  state.mistas       = comissoes;
  state.mistasSyncAt = payload.syncAt;
  return Object.keys(comissoes).length;
}

// Persiste o documento de mistas (comissões + ocultas) mantendo o syncAt atual.
async function persistirMistas() {
  await fbPut('/comissoes-mistas', {
    syncAt:    state.mistasSyncAt,
    comissoes: state.mistas,
    ocultas:   state.mistasOcultas,
  });
}

// ---------- CRIAR / APAGAR COMISSÃO MISTA (MANUAL) ----------

function abrirModalNovaMista() {
  document.getElementById('nova-mista-numero').value = '';
  document.getElementById('nova-mista-ano').value    = new Date().getFullYear();
  document.getElementById('nova-mista-nome').value   = '';
  document.getElementById('modal-nova-mista').style.display = 'flex';
  setTimeout(() => document.getElementById('nova-mista-numero').focus(), 50);
}

async function criarMista() {
  const numero = parseInt(document.getElementById('nova-mista-numero').value, 10);
  const ano    = parseInt(document.getElementById('nova-mista-ano').value, 10);
  const nomeIn = document.getElementById('nova-mista-nome').value.trim();

  if (!numero || numero <= 0) { mostrarToast('Informe o número da MPV.', 'erro'); return; }
  if (!ano || ano < 2000 || ano > 2100) { mostrarToast('Informe um ano válido.', 'erro'); return; }

  const sigla = `MPV${numero}${String(ano).slice(-2)}`;
  if (getComissao(sigla)) { mostrarToast(`${sigla} já existe.`, 'erro'); return; }

  state.mistas[sigla] = {
    sigla, numero, ano,
    nome: nomeIn || `Comissão Mista da MPV ${numero}/${ano}`,
    situacao: '', origem: 'manual',
  };
  delete state.mistasOcultas[sigla]; // se havia sido apagada, volta a existir

  try {
    await persistirMistas();
    fecharModal('modal-nova-mista');
    state.comTab = 'mista';
    renderSidebarComissoes();
    selecionarComissao(sigla);
    mostrarToast(`Comissão ${sigla} criada.`);
  } catch (e) {
    delete state.mistas[sigla];
    mostrarToast('Erro ao criar comissão.', 'erro');
  }
}

async function apagarMista(sigla) {
  const com = state.mistas[sigla];
  if (!com) return;

  const m        = state.membros[sigla] || {};
  const nMembros = (m.titulares || []).length + (m.suplentes || []).length;
  const nPedidos = Object.keys(state.pedidos[sigla] || {}).length;
  const extra    = (nMembros || nPedidos)
    ? `\n\nSerão removidos também ${nMembros} membro(s) e ${nPedidos} pedido(s)/transferências vinculados.`
    : '';
  if (!confirm(`Apagar a comissão ${com.sigla} — ${com.nome}?${extra}`)) return;

  delete state.mistas[sigla];
  state.mistasOcultas[sigla] = true; // sync não readiciona uma comissão apagada
  delete state.membros[sigla];
  delete state.transferencias[sigla];
  delete state.pedidos[sigla];
  delete state.config[sigla];
  if (state.comissaoSel === sigla) state.comissaoSel = null;

  try {
    await Promise.all([
      persistirMistas(),
      fbDelete(`/membros/${sigla}`),
      fbDelete(`/transferencias/${sigla}`),
      fbDelete(`/pedidos/${sigla}`),
      fbDelete(`/config/${sigla}`),
    ]);
    renderSidebar();
    renderPainel();
    mostrarToast(`Comissão ${sigla} apagada.`);
  } catch (e) {
    mostrarToast('Erro ao apagar comissão.', 'erro');
  }
}

// Wrapper de UI: feedback no botão + toasts (silencioso no auto-sync).
async function sincronizarMistasUI({ silencioso = false } = {}) {
  if (state.sincronizando) return;
  state.sincronizando = true;
  const btn = document.getElementById('btn-sync-mpv');
  const htmlOrig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Sincronizando…'; }
  if (!silencioso) mostrarToast('Sincronizando comissões mistas de MPV…');

  try {
    const n = await sincronizarMistas();
    if (state.view === 'comissao') renderSidebarComissoes();
    if (!silencioso) mostrarToast(`${n} comissão(ões) mista(s) de MPV ativa(s) no Senado.`);
  } catch (e) {
    if (!silencioso) mostrarToast('Falha ao sincronizar MPVs: ' + e.message, 'erro');
    else console.warn('Auto-sync de MPVs falhou:', e.message);
  } finally {
    state.sincronizando = false;
    if (btn) { btn.disabled = false; btn.innerHTML = htmlOrig; }
  }
}

async function salvarDeputado(id, dep) {
  await fbPut(`/deputados/${id}`, dep);
  state.deputados[id] = dep;
}

async function removerDeputadoDB(id) {
  await fbDelete(`/deputados/${id}`);
  delete state.deputados[id];

  const siglas = Object.keys(state.membros);
  for (const sigla of siglas) {
    const c = state.membros[sigla];
    const tIdx = (c.titulares || []).indexOf(id);
    const sIdx = (c.suplentes || []).indexOf(id);
    if (tIdx >= 0) c.titulares.splice(tIdx, 1);
    if (sIdx >= 0) c.suplentes.splice(sIdx, 1);
    if (tIdx >= 0 || sIdx >= 0) await fbPut(`/membros/${sigla}`, c);
  }

  // Remove pedidos deste deputado em todas as comissões
  for (const sigla of Object.keys(state.pedidos)) {
    const p = state.pedidos[sigla] || {};
    for (const [pid, entry] of Object.entries(p)) {
      if (entry.depId === id) {
        delete state.pedidos[sigla][pid];
        await fbDelete(`/pedidos/${sigla}/${pid}`);
      }
    }
  }
}

// Retorna true se o membro foi adicionado, false se bloqueado.
async function adicionarMembro(sigla, depId, tipo, isAcordo = false) {
  if (!state.membros[sigla]) state.membros[sigla] = { titulares: [], suplentes: [] };
  const c = state.membros[sigla];
  if (!c.titulares) c.titulares = [];
  if (!c.suplentes) c.suplentes = [];

  // Validação de vagas
  const disponiveis = vagasDisponiveis(sigla, tipo);
  if (disponiveis <= 0) {
    const ef  = vagasEfetivas(sigla, tipo);
    mostrarToast(ef <= 0
      ? `Sem vagas de ${tipo} configuradas para ${sigla}.`
      : `Vagas de ${tipo} esgotadas em ${sigla}.`,
      'erro');
    return false;
  }

  if (tipo === 'titular') {
    const bloqueio = comissaoConflitante(depId, sigla);
    if (bloqueio) {
      const dep = state.deputados[depId];
      mostrarToast(
        `${dep ? dep.nome : 'Deputado'} já é titular em ${bloqueio}, comissão inacumulável com ${sigla}.`,
        'erro'
      );
      return false;
    }
  }

  const lista = tipo === 'titular' ? c.titulares : c.suplentes;
  if (lista.includes(depId)) return false;
  lista.push(depId);

  if (isAcordo) {
    const acordoKey = tipo === 'titular' ? 'titulares_acordo' : 'suplentes_acordo';
    if (!c[acordoKey]) c[acordoKey] = {};
    c[acordoKey][depId] = true;
  }

  await fbPut(`/membros/${sigla}`, c);
  return true;
}

async function removerMembro(sigla, depId) {
  const c = state.membros[sigla];
  if (!c) return;
  c.titulares = (c.titulares || []).filter(id => id !== depId);
  c.suplentes = (c.suplentes || []).filter(id => id !== depId);
  if (c.titulares_acordo) delete c.titulares_acordo[depId];
  if (c.suplentes_acordo) delete c.suplentes_acordo[depId];
  await fbPut(`/membros/${sigla}`, c);
}

// ---------- PEDIDOS ----------

async function adicionarPedido(sigla, depId, obs) {
  const id    = `p_${Date.now()}`;
  const entry = { depId, obs, data: new Date().toISOString() };

  if (!state.pedidos[sigla]) state.pedidos[sigla] = {};
  state.pedidos[sigla][id] = entry;
  await fbPut(`/pedidos/${sigla}/${id}`, entry);
  return id;
}

async function removerPedido(sigla, id) {
  if (state.pedidos[sigla]) delete state.pedidos[sigla][id];
  await fbDelete(`/pedidos/${sigla}/${id}`);
}

async function nomearDePedido(sigla, pedidoId, depId, tipo) {
  const ok = await adicionarMembro(sigla, depId, tipo);
  if (ok) {
    await removerPedido(sigla, pedidoId);
    renderPainelComissao(sigla);
    renderSidebarComissoes();
    mostrarToast(`Deputado nomeado ${tipo} e pedido removido.`);
  }
}

// ---------- LÓGICA DE VAGAS ----------

function vagasEfetivas(sigla, tipo) {
  // Comissões mistas de MPV: 1 vaga de titular e 1 de suplente fixas (não
  // configuráveis); ainda assim respeitam ceder/receber por acordo.
  const base = tipoComissao(sigla) === 'mista'
    ? 1
    : (() => {
        const cfg = state.config[sigla] || { titular: 0, suplente: 0 };
        return tipo === 'titular' ? (cfg.titular || 0) : (cfg.suplente || 0);
      })();
  const t    = state.transferencias[sigla] || {};
  const cedidas   = Object.values(t.cedidas   || {}).filter(x => x.tipo === tipo).length;
  const recebidas = Object.values(t.recebidas || {}).filter(x => x.tipo === tipo).length;
  return base - cedidas + recebidas;
}

function vagasDisponiveis(sigla, tipo) {
  const m      = state.membros[sigla] || {};
  const lista  = tipo === 'titular' ? (m.titulares || []) : (m.suplentes || []);
  return vagasEfetivas(sigla, tipo) - lista.length;
}

// ---------- LÓGICA DE CONFLITO ----------

function comissoesDeDeputado(depId) {
  const titulares = [];
  const suplentes = [];
  for (const sigla of Object.keys(state.membros)) {
    const c = state.membros[sigla];
    if ((c.titulares || []).includes(depId)) titulares.push(sigla);
    if ((c.suplentes || []).includes(depId)) suplentes.push(sigla);
  }
  return { titulares, suplentes };
}

function verificarConflitosDeputado(depId) {
  const { titulares } = comissoesDeDeputado(depId);
  const conflitos = [];
  for (const grupo of GRUPOS_INCOMPATIVEIS) {
    const emGrupo = titulares.filter(s => grupo.includes(s));
    if (emGrupo.length > 1) conflitos.push(...emGrupo);
  }
  return [...new Set(conflitos)];
}

function deputadosComConflito() {
  return Object.keys(state.deputados)
    .map(id => ({ id, dep: state.deputados[id], conflitos: verificarConflitosDeputado(id) }))
    .filter(x => x.conflitos.length > 0);
}

// Retorna a sigla da comissão já ocupada que torna siglaAlvo inacumulável, ou null.
function comissaoConflitante(depId, siglaAlvo) {
  const { titulares } = comissoesDeDeputado(depId);
  for (const grupo of GRUPOS_INCOMPATIVEIS) {
    if (!grupo.includes(siglaAlvo)) continue;
    const bloqueio = titulares.find(s => s !== siglaAlvo && grupo.includes(s));
    if (bloqueio) return bloqueio;
  }
  return null;
}

// ---------- RENDER: SIDEBAR ----------

function mudarView(view) {
  state.view = view;
  state.comissaoSel = null;
  state.busca = '';
  document.getElementById('com-busca').value = '';
  document.querySelectorAll('.com-tab').forEach(t => {
    t.classList.toggle('ativo', t.dataset.view === view);
  });
  document.getElementById('com-subtabs').style.display =
    view === 'comissao' ? '' : 'none';
  document.getElementById('busca-wrap').style.display =
    view === 'alertas' ? 'none' : '';
  renderSidebar();
  renderPainel();
}

function mudarComTab(tab) {
  state.comTab = tab;
  state.busca = '';
  document.getElementById('com-busca').value = '';
  renderSidebarComissoes();
}

function renderSidebar() {
  if (state.view === 'alertas') { renderSidebarAlertas(); return; }
  if (state.view === 'deputado') { renderSidebarDeputados(); return; }
  renderSidebarComissoes();
}

function renderSidebarComissoes() {
  const lista = document.getElementById('com-lista');
  const matchBusca = c =>
    c.sigla.toLowerCase().includes(state.busca) ||
    c.nome.toLowerCase().includes(state.busca);

  const permanentes = COMISSOES_PERMANENTES.filter(matchBusca);
  const mistas      = listaMistas().filter(matchBusca);

  const itemHtml = c => {
    const m        = state.membros[c.sigla] || {};
    const total    = (m.titulares || []).length + (m.suplentes || []).length;
    const nPedidos = Object.keys(state.pedidos[c.sigla] || {}).length;

    const efT = vagasEfetivas(c.sigla, 'titular');
    const efS = vagasEfetivas(c.sigla, 'suplente');
    const semVagas = efT <= 0 && efS <= 0;
    const dT = vagasDisponiveis(c.sigla, 'titular');
    const dS = vagasDisponiveis(c.sigla, 'suplente');
    const cheias = !semVagas && dT <= 0 && dS <= 0;

    const linhas = [];

    // Linha 1 (só mistas): situação no Senado.
    if (tipoComissao(c.sigla) === 'mista') {
      const sit = badgeSituacaoMista(c);
      if (sit) linhas.push(sit);
    }

    // Linha 2: estado das vagas e pedidos.
    const extras = [];
    if (semVagas) extras.push('<span class="badge-sem-vagas">sem vagas</span>');
    else if (cheias) extras.push('<span class="badge-sem-vagas" style="background:rgba(240,84,84,.15);color:var(--vermelho)">cheias</span>');
    if (nPedidos > 0) extras.push(`<span class="badge-pedidos">${nPedidos} pedido${nPedidos > 1 ? 's' : ''}</span>`);
    if (extras.length) linhas.push(extras.join(' '));

    return `
      <div class="com-item${state.comissaoSel === c.sigla ? ' ativo' : ''}" data-sigla="${c.sigla}">
        <span class="com-item-sigla">${c.sigla}</span>
        <span class="com-item-nome">${c.nome}${linhas.map(l => '<br>' + l).join('')}</span>
        <span class="com-item-badge${total > 0 ? ' tem-membro' : ''}">${total > 0 ? total : ''}</span>
      </div>`;
  };

  const vazio = msg => `<div class="com-empty" style="padding:18px 14px;font-size:12px">${msg}</div>`;

  // Contadores totais (independentes da busca) e estado ativo das sub-abas.
  const totPerm  = COMISSOES_PERMANENTES.length;
  const totMista = Object.keys(state.mistas).length;
  const cPerm  = document.getElementById('subtab-count-perm');
  const cMista = document.getElementById('subtab-count-mista');
  if (cPerm)  cPerm.textContent  = totPerm  ? `(${totPerm})`  : '';
  if (cMista) cMista.textContent = totMista ? `(${totMista})` : '';
  document.querySelectorAll('.com-subtab').forEach(t =>
    t.classList.toggle('ativo', t.dataset.comtab === state.comTab));

  let html = '';
  if (state.comTab === 'mista') {
    html += `<div class="com-mistas-toolbar">`
          + syncInfoHtml()
          + `<button class="btn-nova-mista" id="btn-nova-mista" title="Criar comissão mista de MPV manualmente">+ Nova</button>`
          + `</div>`;
    html += mistas.length
      ? mistas.map(itemHtml).join('')
      : vazio(state.busca
          ? 'Nenhuma corresponde à busca.'
          : 'Nenhuma comissão mista. Use “Sincronizar MPVs” no topo ou “+ Nova”.');
  } else {
    html += permanentes.length
      ? permanentes.map(itemHtml).join('')
      : vazio(state.busca ? 'Nenhuma corresponde à busca.' : 'Nenhuma.');
  }

  lista.innerHTML = html;

  lista.querySelector('#btn-nova-mista')?.addEventListener('click', abrirModalNovaMista);
  lista.querySelectorAll('.com-item').forEach(el => {
    el.addEventListener('click', () => selecionarComissao(el.dataset.sigla));
  });
}

// Badge de situação (Senado) para uma comissão mista. Retorna '' quando não há
// situação conhecida (ex.: comissão criada manualmente).
function badgeSituacaoMista(c) {
  if (c.situacao === MPV_SIT_FUNCIONAMENTO)
    return '<span class="badge-situacao func">● Em funcionamento</span>';
  if (c.situacao === MPV_SIT_AGUARDANDO)
    return '<span class="badge-situacao aguard">● Aguardando instalação</span>';
  if (c.origem === 'manual')
    return '<span class="badge-situacao manual">criada manualmente</span>';
  return '';
}

function syncInfoHtml() {
  if (state.sincronizando) return `<div class="com-sync-info">Sincronizando…</div>`;
  if (!state.mistasSyncAt)  return `<div class="com-sync-info sync-velho">Nunca sincronizado.</div>`;
  const velho = mistasDesatualizadas();
  return `<div class="com-sync-info${velho ? ' sync-velho' : ''}">`
       + `Atualizado ${fmtSyncAgo(state.mistasSyncAt)}${velho ? ' · desatualizado' : ''}</div>`;
}

function fmtSyncAgo(iso) {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1)  return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function renderSidebarDeputados() {
  const lista = document.getElementById('com-lista');
  const deps = Object.entries(state.deputados)
    .filter(([, d]) =>
      !state.busca ||
      d.nome.toLowerCase().includes(state.busca) ||
      d.uf.toLowerCase().includes(state.busca)
    )
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  if (!deps.length) {
    lista.innerHTML = `<div class="com-empty" style="padding:24px">Nenhum deputado cadastrado.</div>`;
    return;
  }

  lista.innerHTML = deps.map(([id, d]) => {
    const conflitos = verificarConflitosDeputado(id);
    const sub = [d.partido, d.uf].filter(Boolean).join(' · ');
    return `
      <div class="com-item${state.comissaoSel === id ? ' ativo' : ''}" data-sigla="${id}">
        <span class="com-item-nome">${d.nome}<br><small style="color:var(--text-dim)">${sub}</small></span>
        ${conflitos.length ? '<span class="com-item-badge" style="color:#f0c040">⚠</span>' : ''}
      </div>`;
  }).join('');

  lista.querySelectorAll('.com-item').forEach(el => {
    el.addEventListener('click', () => selecionarDeputado(el.dataset.sigla));
  });
}

function renderSidebarAlertas() {
  const lista = document.getElementById('com-lista');
  const conflitantes = deputadosComConflito();
  lista.innerHTML = conflitantes.length
    ? `<div class="com-item" style="cursor:default"><span class="com-item-nome" style="color:#f0c040">⚠ ${conflitantes.length} conflito(s) detectado(s)</span></div>`
    : `<div class="com-item" style="cursor:default"><span class="com-item-nome" style="color:var(--accent-light)">✓ Nenhum conflito</span></div>`;
}

// ---------- RENDER: PAINEL ----------

function renderPainel() {
  if (state.view === 'comissao' && state.comissaoSel) {
    renderPainelComissao(state.comissaoSel);
  } else if (state.view === 'deputado' && state.comissaoSel) {
    renderPainelDeputado(state.comissaoSel);
  } else if (state.view === 'alertas') {
    renderPainelAlertas();
  } else {
    const dica = state.view === 'deputado'
      ? 'Selecione um deputado para ver suas comissões'
      : 'Selecione uma comissão para ver os membros';
    document.getElementById('com-painel-conteudo').innerHTML = `
      <div class="com-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <span>${dica}</span>
      </div>`;
  }
}

function renderPainelComissao(sigla) {
  const com = getComissao(sigla);
  if (!com) {
    state.comissaoSel = null;
    renderPainel();
    return;
  }
  const m   = state.membros[sigla] || { titulares: [], suplentes: [] };
  const titulares = m.titulares || [];
  const suplentes = m.suplentes || [];

  const efT   = vagasEfetivas(sigla, 'titular');
  const efS   = vagasEfetivas(sigla, 'suplente');
  const dispT = vagasDisponiveis(sigla, 'titular');
  const dispS = vagasDisponiveis(sigla, 'suplente');

  const vagasBadge = (siglaC, tipoC, ef, disp) => {
    if (ef <= 0) return `<span class="vagas-counter vagas-zero">sem vagas</span>`;
    const t2 = state.transferencias[siglaC] || {};
    const nAcordo = Object.values(t2.recebidas || {}).filter(x => x.tipo === tipoC).length;
    const cls = disp <= 0 ? 'vagas-cheias' : 'vagas-ok';
    const ocupadas = ef - disp;
    return `<span class="vagas-counter ${cls}">${ocupadas}/${ef} vagas${nAcordo > 0 ? ` <span class="badge-acordo-mini">${nAcordo} acordo</span>` : ''}</span>`;
  };

  const renderLinha = (depId, tipo) => {
    const dep = state.deputados[depId];
    if (!dep) return '';
    const conflito  = tipo === 'titular' && verificarConflitosDeputado(depId).includes(sigla);
    const sub       = [dep.partido, dep.uf].filter(Boolean).join(' · ');
    const acordoKey = tipo === 'titular' ? 'titulares_acordo' : 'suplentes_acordo';
    const isAcordo  = !!(state.membros[sigla]?.[acordoKey]?.[depId]);

    return `
      <div class="com-membro-row${isAcordo ? ' com-membro-acordo' : ''}">
        <span class="com-membro-nome">${dep.nome}</span>
        <span class="com-membro-uf">${sub}</span>
        ${isAcordo ? '<span class="badge-acordo">Vaga de Acordo</span>' : ''}
        ${conflito ? '<span class="com-membro-alerta">⚠ Acúmulo</span>' : ''}
        <button class="btn-remover-membro" data-dep="${depId}" data-tipo="${tipo}" data-sigla="${sigla}">Remover</button>
      </div>`;
  };

  const renderLinhaAcordo = (transfId, e) => `
    <div class="com-membro-row com-membro-acordo">
      <span class="com-membro-nome">${e.depNome}</span>
      <span class="com-membro-uf">${[e.depPartido || e.partido, e.depUf].filter(Boolean).join(' · ')}</span>
      <span class="badge-acordo">Vaga de Acordo</span>
      <button class="btn-dep-acordo" data-sigla="${sigla}" data-id="${transfId}" title="Editar deputado">✎</button>
    </div>`;

  const renderSecaoPedidos = () => {
    const p        = state.pedidos[sigla] || {};
    const entries  = Object.entries(p);

    const fmt = iso => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    };

    const rows = entries.map(([pid, e]) => {
      const dep = state.deputados[e.depId];
      if (!dep) return '';
      const conflT = comissaoConflitante(e.depId, sigla);
      const jaT    = (titulares).includes(e.depId);
      const jaS    = (suplentes).includes(e.depId);
      const podeT  = !jaT && !conflT && dispT > 0;
      const podeS  = !jaS && dispS > 0;
      return `
        <div class="pedido-row">
          <div class="pedido-info">
            <span class="pedido-nome">${dep.nome}</span>
            <span class="com-membro-uf">${dep.uf}</span>
            ${e.obs ? `<span class="pedido-obs">${e.obs}</span>` : ''}
            <span class="pedido-data">${fmt(e.data)}</span>
          </div>
          <div class="pedido-acoes">
            <button class="btn-nomear${podeT ? '' : ' btn-nomear-bloq'}"
                    data-sigla="${sigla}" data-pid="${pid}" data-dep="${e.depId}" data-tipo="titular"
                    ${podeT ? '' : 'disabled'}
                    title="${jaT ? 'Já é titular' : conflT ? 'Inacumulável' : !podeT && efT > 0 ? 'Vagas de titular esgotadas' : 'Sem vagas de titular'}">
              Nomear Titular
            </button>
            <button class="btn-nomear${podeS ? '' : ' btn-nomear-bloq'}"
                    data-sigla="${sigla}" data-pid="${pid}" data-dep="${e.depId}" data-tipo="suplente"
                    ${podeS ? '' : 'disabled'}
                    title="${jaS ? 'Já é suplente' : !podeS && efS > 0 ? 'Vagas de suplente esgotadas' : 'Sem vagas de suplente'}">
              Nomear Suplente
            </button>
            <button class="btn-rejeitar-pedido" data-sigla="${sigla}" data-pid="${pid}">Rejeitar</button>
          </div>
        </div>`;
    }).filter(Boolean);

    return `
      <div class="com-grupo pedidos-secao">
        <div class="com-grupo-titulo">
          Pedidos
          <span class="badge-count" style="${entries.length > 0 ? 'background:rgba(245,158,11,.2);color:#f5a623' : ''}">${entries.length}</span>
        </div>
        ${rows.length ? rows.join('') : '<p style="font-size:12px;color:var(--text-dim)">Nenhum pedido registrado.</p>'}
        <button class="btn-adicionar-membro" data-sigla="${sigla}" id="btn-add-pedido-painel" style="margin-top:8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Registrar pedido
        </button>
      </div>`;
  };

  const renderTransferencias = () => {
    const t       = state.transferencias[sigla] || {};
    const cedidas   = Object.entries(t.cedidas   || {});
    const recebidas = Object.entries(t.recebidas || {});
    if (!cedidas.length && !recebidas.length) return '';

    const fmt = iso => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    };

    const rows = [
      ...cedidas.map(([id, e]) => `
        <div class="transf-item">
          <span class="transf-icone">↗</span>
          <div class="transf-texto">
            <div>Cedida <strong>${e.tipo}</strong> → ${e.partido}${e.obs ? ` · <em>${e.obs}</em>` : ''}
              <span class="badge-acordo" style="margin-left:6px">Vaga de Acordo</span>
            </div>
            ${e.depNome ? `<div style="margin-top:4px;font-size:11px;color:var(--text-dim)">
              Ocupante: <strong style="color:var(--text)">${e.depNome}</strong>${e.depPartido ? ` · ${e.depPartido}` : ''}${e.depUf ? ` · ${e.depUf}` : ''}
            </div>` : ''}
          </div>
          <span class="transf-data">${fmt(e.data)}</span>
          <div class="transf-acoes">
            <button class="btn-dep-acordo" data-sigla="${sigla}" data-id="${id}">${e.depNome ? '✎ Dep.' : '+ Dep.'}</button>
            <button class="btn-desfazer" data-sigla="${sigla}" data-direcao="cedidas" data-id="${id}">✕</button>
          </div>
        </div>`),
      ...recebidas.map(([id, e]) => `
        <div class="transf-item">
          <span class="transf-icone">↙</span>
          <span class="transf-texto">
            Recebida <strong>${e.tipo}</strong> ← ${e.partido}
            ${e.obs ? `· <em>${e.obs}</em>` : ''}
            <span class="badge-acordo" style="margin-left:6px">Vaga de Acordo</span>
          </span>
          <span class="transf-data">${fmt(e.data)}</span>
          <div class="transf-acoes">
            <button class="btn-desfazer" data-sigla="${sigla}" data-direcao="recebidas" data-id="${id}">✕ Desfazer</button>
          </div>
        </div>`),
    ];

    return `
      <div class="transf-secao">
        <div class="com-grupo-titulo" style="margin-bottom:10px">Transferências</div>
        ${rows.join('')}
      </div>`;
  };

  const ehMista = tipoComissao(sigla) === 'mista';
  document.getElementById('com-painel-conteudo').innerHTML = `
    <div style="margin-bottom:18px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div class="com-painel-titulo">${com.nome}${ehMista ? ' <span class="tag-mista">Mista</span>' : ''}</div>
        <div class="com-painel-sigla">${com.sigla}${ehMista ? ` &nbsp;${badgeSituacaoMista(com)}` : ''}</div>
      </div>
      ${ehMista ? `<button class="btn-apagar-mista" id="btn-apagar-mista" data-sigla="${sigla}" title="Apagar esta comissão mista">🗑 Apagar</button>` : ''}
    </div>

    <div class="com-grupo">
      <div class="com-grupo-acoes">
        <div class="com-grupo-titulo" style="margin-bottom:0">
          Titulares
          <span class="badge-count">${titulares.length}</span>
          ${vagasBadge(sigla, 'titular', efT, dispT)}
        </div>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="titular" data-direcao="ceder">↗ Ceder vaga</button>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="titular" data-direcao="receber">↙ Receber vaga</button>
      </div>
      ${titulares.map(id => renderLinha(id, 'titular')).join('') || '<p style="font-size:12px;color:var(--text-dim)">Nenhum titular.</p>'}
      ${Object.entries((state.transferencias[sigla] || {}).cedidas || {})
          .filter(([, e]) => e.tipo === 'titular' && e.depNome)
          .map(([tid, e]) => renderLinhaAcordo(tid, e)).join('')}
      <button class="btn-adicionar-membro${efT <= 0 ? ' btn-add-bloqueado' : ''}"
              data-tipo="titular" data-sigla="${sigla}" style="margin-top:8px"
              ${efT <= 0 ? 'disabled title="Configure as vagas de titular para esta comissão"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar titular
      </button>
    </div>

    <div class="com-grupo">
      <div class="com-grupo-acoes">
        <div class="com-grupo-titulo" style="margin-bottom:0">
          Suplentes
          <span class="badge-count">${suplentes.length}</span>
          ${vagasBadge(sigla, 'suplente', efS, dispS)}
        </div>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="suplente" data-direcao="ceder">↗ Ceder vaga</button>
        <button class="btn-transferencia" data-sigla="${sigla}" data-tipo="suplente" data-direcao="receber">↙ Receber vaga</button>
      </div>
      ${suplentes.map(id => renderLinha(id, 'suplente')).join('') || '<p style="font-size:12px;color:var(--text-dim)">Nenhum suplente.</p>'}
      ${Object.entries((state.transferencias[sigla] || {}).cedidas || {})
          .filter(([, e]) => e.tipo === 'suplente' && e.depNome)
          .map(([tid, e]) => renderLinhaAcordo(tid, e)).join('')}
      <button class="btn-adicionar-membro${efS <= 0 ? ' btn-add-bloqueado' : ''}"
              data-tipo="suplente" data-sigla="${sigla}" style="margin-top:8px"
              ${efS <= 0 ? 'disabled title="Configure as vagas de suplente para esta comissão"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar suplente
      </button>
    </div>

    ${renderSecaoPedidos()}
    ${renderTransferencias()}`;

  // Delegação de eventos
  const painel = document.getElementById('com-painel-conteudo');

  painel.querySelector('#btn-apagar-mista')
    ?.addEventListener('click', () => apagarMista(sigla));

  painel.querySelectorAll('.btn-remover-membro').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerMembro(btn.dataset.sigla, btn.dataset.dep);
      renderPainelComissao(sigla);
      renderSidebar();
      mostrarToast('Membro removido.');
    });
  });
  painel.querySelectorAll('.btn-adicionar-membro:not([disabled])').forEach(btn => {
    if (btn.id === 'btn-add-pedido-painel') return; // tratado abaixo
    btn.addEventListener('click', () =>
      abrirModalAddMembro(btn.dataset.sigla, btn.dataset.tipo));
  });
  painel.querySelectorAll('.btn-transferencia').forEach(btn => {
    btn.addEventListener('click', () =>
      abrirModalTransferencia(btn.dataset.sigla, btn.dataset.tipo, btn.dataset.direcao));
  });
  painel.querySelectorAll('.btn-desfazer').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerTransferencia(btn.dataset.sigla, btn.dataset.direcao, btn.dataset.id);
      renderPainelComissao(sigla);
      renderSidebarComissoes();
      mostrarToast('Transferência desfeita.');
    });
  });
  painel.querySelectorAll('.btn-dep-acordo').forEach(btn => {
    btn.addEventListener('click', () =>
      abrirModalDepAcordo(btn.dataset.sigla, btn.dataset.id));
  });
  painel.querySelectorAll('.btn-nomear:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () =>
      nomearDePedido(btn.dataset.sigla, btn.dataset.pid, btn.dataset.dep, btn.dataset.tipo));
  });
  painel.querySelectorAll('.btn-rejeitar-pedido').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerPedido(btn.dataset.sigla, btn.dataset.pid);
      renderPainelComissao(sigla);
      renderSidebarComissoes();
      mostrarToast('Pedido removido.');
    });
  });
  const btnAddPedido = painel.querySelector('#btn-add-pedido-painel');
  if (btnAddPedido) {
    btnAddPedido.addEventListener('click', () =>
      abrirModalAddPedido(btnAddPedido.dataset.sigla));
  }
}

function renderPainelDeputado(depId) {
  const dep = state.deputados[depId];
  if (!dep) return;
  const { titulares, suplentes } = comissoesDeDeputado(depId);
  const conflitos = verificarConflitosDeputado(depId);

  // Comissões com pedido pendente deste deputado
  const pedidosEm = Object.entries(state.pedidos)
    .filter(([, p]) => Object.values(p).some(e => e.depId === depId))
    .map(([sigla]) => sigla);

  const tagsCom = (siglas, tipo) => siglas.map(s => {
    const com = getComissao(s);
    const isConflito = tipo === 'titular' && conflitos.includes(s);
    return `<span class="dep-tag ${isConflito ? 'conflito' : tipo}" title="${com ? com.nome : s}">${s}${isConflito ? ' ⚠' : ''}</span>`;
  }).join('');

  document.getElementById('com-painel-conteudo').innerHTML = `
    <div style="margin-bottom:20px">
      <div class="com-painel-titulo">${dep.nome}</div>
      <div class="com-painel-sigla">${dep.uf}</div>
    </div>

    <div class="com-grupo">
      <div class="com-grupo-titulo">Titular em <span class="badge-count">${titulares.length}</span></div>
      ${titulares.length
        ? `<div class="dep-row-tags" style="margin-bottom:12px">${tagsCom(titulares, 'titular')}</div>`
        : '<p style="font-size:12px;color:var(--text-dim)">Nenhuma titularidade.</p>'}
    </div>

    <div class="com-grupo">
      <div class="com-grupo-titulo">Suplente em <span class="badge-count">${suplentes.length}</span></div>
      ${suplentes.length
        ? `<div class="dep-row-tags">${tagsCom(suplentes, 'suplente')}</div>`
        : '<p style="font-size:12px;color:var(--text-dim)">Nenhuma suplência.</p>'}
    </div>

    ${pedidosEm.length ? `
    <div class="com-grupo">
      <div class="com-grupo-titulo" style="color:#f5a623">Pedidos pendentes <span class="badge-count" style="background:rgba(245,158,11,.2);color:#f5a623">${pedidosEm.length}</span></div>
      <div class="dep-row-tags">${pedidosEm.map(s => {
        const com = getComissao(s);
        return `<span class="dep-tag" style="background:rgba(245,158,11,.15);color:#f5a623" title="${com ? com.nome : s}">${s}</span>`;
      }).join('')}</div>
    </div>` : ''}

    ${conflitos.length ? `
    <div class="com-grupo">
      <div class="com-grupo-titulo" style="color:#f0c040">⚠ Conflito de Acúmulo</div>
      <p style="font-size:12px;color:#f0c040;line-height:1.6">
        Titular em <strong>${conflitos.join(', ')}</strong> — comissões mutuamente exclusivas.
        Remova a titularidade em pelo menos uma delas.
      </p>
    </div>` : ''}`;
}

function renderPainelAlertas() {
  const conflitantes = deputadosComConflito();

  document.getElementById('com-painel-conteudo').innerHTML = conflitantes.length
    ? conflitantes.map(({ dep, conflitos }) => `
        <div class="alerta-card">
          <div class="alerta-nome">${dep.nome} — ${dep.uf}</div>
          <div class="alerta-desc">
            Titular em <strong>${conflitos.join(', ')}</strong> — comissões mutuamente exclusivas.<br>
            Remova a titularidade em pelo menos uma delas.
          </div>
        </div>`).join('')
    : `<div class="com-empty" style="padding-top:60px">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>Nenhum conflito de acúmulo detectado.</span>
      </div>`;
}

// ---------- SELEÇÃO ----------

function selecionarComissao(sigla) {
  state.comissaoSel = sigla;
  renderSidebarComissoes();
  renderPainelComissao(sigla);
}

function selecionarDeputado(depId) {
  state.comissaoSel = depId;
  renderSidebarDeputados();
  renderPainelDeputado(depId);
}

// ---------- MODAL: GESTÃO DE DEPUTADOS ----------

function abrirModalDeputados() {
  renderModalDeputadoLista();
  document.getElementById('dep-nome-input').value = '';
  document.getElementById('dep-uf-input').value   = '';
  document.getElementById('modal-deputados').style.display = 'flex';
  document.getElementById('dep-nome-input').focus();
}

function renderModalDeputadoLista() {
  const lista = document.getElementById('dep-modal-lista');
  const deps  = Object.entries(state.deputados)
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  lista.innerHTML = deps.length
    ? deps.map(([id, d]) => `
        <div class="dep-modal-item">
          <span class="dep-modal-nome">${d.nome}${d.idCamara ? '<span class="badge-api" title="Importado da API da Câmara">API</span>' : ''}</span>
          ${d.partido ? `<span class="dep-modal-uf">${d.partido}</span>` : ''}
          <span class="dep-modal-uf">${d.uf}</span>
          <button class="btn-remover-membro btn-rem-dep" data-id="${id}">Remover</button>
        </div>`).join('')
    : `<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px">Nenhum deputado cadastrado.</p>`;

  lista.querySelectorAll('.btn-rem-dep').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removerDeputadoDB(btn.dataset.id);
      renderModalDeputadoLista();
      renderSidebar();
      renderPainel();
      mostrarToast('Deputado removido.');
    });
  });
}

async function adicionarDeputado() {
  const nome    = document.getElementById('dep-nome-input').value.trim();
  const partido = document.getElementById('dep-partido-input').value.trim().toUpperCase();
  const uf      = document.getElementById('dep-uf-input').value;
  if (!nome) { mostrarToast('Informe o nome do deputado.', 'erro'); return; }
  if (!uf)   { mostrarToast('Selecione a UF.', 'erro'); return; }

  const id  = `dep_${Date.now()}`;
  const dep = { nome, uf, ...(partido && { partido }) };
  await salvarDeputado(id, dep);

  document.getElementById('dep-nome-input').value    = '';
  document.getElementById('dep-partido-input').value = '';
  document.getElementById('dep-uf-input').value      = '';
  document.getElementById('dep-nome-input').focus();
  renderModalDeputadoLista();
  renderSidebar();
  mostrarToast(`${nome} adicionado.`);
}

// ---------- IMPORTAR DA API DA CÂMARA ----------

async function importarDeputadosDaCamara() {
  const btn = document.getElementById('btn-importar-camara');
  const textoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Importando...';

  try {
    let url = 'https://dadosabertos.camara.leg.br/api/v2/deputados?siglaPartido=PODE&itens=100&ordem=ASC&ordenarPor=nome';
    let importados = 0, atualizados = 0, inalterados = 0;

    while (url) {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();

      for (const d of data.dados || []) {
        const id  = `cam_${d.id}`;
        const dep = { nome: d.nome, uf: d.siglaUf, partido: d.siglaPartido, idCamara: d.id };
        const exist = state.deputados[id];

        if (!exist) {
          await salvarDeputado(id, dep);
          importados++;
        } else if (exist.nome !== dep.nome || exist.uf !== dep.uf || exist.idCamara !== dep.idCamara) {
          await salvarDeputado(id, dep);
          atualizados++;
        } else {
          inalterados++;
        }
      }

      const next = (data.links || []).find(l => l.rel === 'next');
      url = next ? next.href : null;
    }

    const partes = [];
    if (importados)  partes.push(`${importados} novo${importados > 1 ? 's' : ''}`);
    if (atualizados) partes.push(`${atualizados} atualizado${atualizados > 1 ? 's' : ''}`);
    if (inalterados) partes.push(`${inalterados} sem mudança`);
    mostrarToast(`Importação concluída: ${partes.join(', ') || 'nada a fazer'}.`);

    renderModalDeputadoLista();
    renderSidebar();
  } catch (e) {
    mostrarToast('Falha ao importar da Câmara: ' + e.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

// ---------- MODAL: ADICIONAR MEMBRO ----------

function abrirModalAddMembro(sigla, tipo) {
  const disp = vagasDisponiveis(sigla, tipo);
  if (disp <= 0) {
    const ef = vagasEfetivas(sigla, tipo);
    mostrarToast(ef <= 0
      ? `Sem vagas de ${tipo} configuradas para ${sigla}.`
      : `Vagas de ${tipo} esgotadas em ${sigla}.`,
      'erro');
    return;
  }

  const com  = getComissao(sigla);
  const m    = state.membros[sigla] || { titulares: [], suplentes: [] };
  const jaMembroIds = [...(m.titulares || []), ...(m.suplentes || [])];

  document.getElementById('add-membro-titulo').textContent =
    `Adicionar ${tipo === 'titular' ? 'Titular' : 'Suplente'}`;
  document.getElementById('add-membro-desc').textContent =
    `${com.nome} (${sigla})`;

  const deps = Object.entries(state.deputados)
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  const lista = document.getElementById('membro-select-lista');
  lista.innerHTML = deps.length
    ? deps.map(([id, d]) => {
        const jaMembro   = jaMembroIds.includes(id);
        const conflito   = tipo === 'titular' && !jaMembro ? comissaoConflitante(id, sigla) : null;
        const bloqueado  = jaMembro || !!conflito;
        let aviso = '';
        if (jaMembro)  aviso = '<span class="membro-select-conflito">já membro</span>';
        if (conflito)  aviso = `<span class="membro-select-conflito">⚠ já é titular em ${conflito} (inacumulável)</span>`;
        return `
          <div class="membro-select-item${bloqueado ? ' ja-membro' : ''}"
               data-dep="${id}" data-sigla="${sigla}" data-tipo="${tipo}">
            <span class="membro-select-nome">${d.nome}</span>
            <span class="membro-select-uf">${d.uf}</span>
            ${aviso}
          </div>`;
      }).join('')
    : `<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px">Nenhum deputado cadastrado.</p>`;

  document.getElementById('membro-acordo-check').checked = false;

  lista.querySelectorAll('.membro-select-item:not(.ja-membro)').forEach(el => {
    el.addEventListener('click', async () => {
      const isAcordo = document.getElementById('membro-acordo-check').checked;
      const ok = await adicionarMembro(el.dataset.sigla, el.dataset.dep, el.dataset.tipo, isAcordo);
      if (ok) {
        fecharModal('modal-add-membro');
        renderPainelComissao(el.dataset.sigla);
        renderSidebarComissoes();
        mostrarToast('Membro adicionado.');
      }
    });
  });

  document.getElementById('modal-add-membro').style.display = 'flex';
}

// ---------- MODAL: REGISTRAR PEDIDO ----------

function abrirModalAddPedido(sigla) {
  const com = getComissao(sigla);
  const p   = state.pedidos[sigla] || {};
  const m   = state.membros[sigla] || {};
  // Deputados que já têm pedido OU já são membros ficam bloqueados
  const jaMembroIds = [...(m.titulares || []), ...(m.suplentes || [])];
  const jaPedidoIds = Object.values(p).map(e => e.depId);
  const bloqueadoIds = new Set([...jaMembroIds, ...jaPedidoIds]);

  document.getElementById('add-pedido-titulo').textContent = `Registrar Pedido — ${sigla}`;
  document.getElementById('add-pedido-desc').textContent   = `${com.nome}`;
  document.getElementById('pedido-obs-input').value = '';

  const deps = Object.entries(state.deputados)
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome));

  const lista = document.getElementById('pedido-select-lista');
  lista.innerHTML = deps.length
    ? deps.map(([id, d]) => {
        const bloqueado = bloqueadoIds.has(id);
        const motivo = jaMembroIds.includes(id)
          ? '<span class="membro-select-conflito">já membro</span>'
          : jaPedidoIds.includes(id)
            ? '<span class="membro-select-conflito">pedido já registrado</span>'
            : '';
        return `
          <div class="membro-select-item${bloqueado ? ' ja-membro' : ''}"
               data-dep="${id}" data-sigla="${sigla}">
            <span class="membro-select-nome">${d.nome}</span>
            <span class="membro-select-uf">${d.uf}</span>
            ${motivo}
          </div>`;
      }).join('')
    : `<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px">Nenhum deputado cadastrado.</p>`;

  lista.querySelectorAll('.membro-select-item:not(.ja-membro)').forEach(el => {
    el.addEventListener('click', async () => {
      const obs = document.getElementById('pedido-obs-input').value.trim();
      await adicionarPedido(el.dataset.sigla, el.dataset.dep, obs);
      fecharModal('modal-add-pedido');
      renderPainelComissao(el.dataset.sigla);
      renderSidebarComissoes();
      const dep = state.deputados[el.dataset.dep];
      mostrarToast(`Pedido de ${dep ? dep.nome : 'deputado'} registrado.`);
    });
  });

  document.getElementById('modal-add-pedido').style.display = 'flex';
}

// ---------- MODAL: CONFIGURAR VAGAS ----------

function abrirModalConfigVagas() {
  const lista = document.getElementById('config-vagas-lista');
  lista.innerHTML = COMISSOES_PERMANENTES.map(c => {
    const cfg = state.config[c.sigla] || { titular: 0, suplente: 0 };
    return `
      <div class="config-vaga-row">
        <div class="config-vaga-nome">
          <span class="config-vaga-sigla">${c.sigla}</span>
          ${c.nome}
        </div>
        <input type="number" class="config-vaga-input" min="0" max="99"
               data-sigla="${c.sigla}" data-tipo="titular"
               value="${cfg.titular || 0}">
        <input type="number" class="config-vaga-input" min="0" max="99"
               data-sigla="${c.sigla}" data-tipo="suplente"
               value="${cfg.suplente || 0}">
      </div>`;
  }).join('');

  document.getElementById('modal-config-vagas').style.display = 'flex';
}

async function salvarConfigVagas() {
  const inputs    = document.querySelectorAll('#config-vagas-lista .config-vaga-input');
  const novoConfig = {};

  inputs.forEach(inp => {
    const { sigla, tipo } = inp.dataset;
    if (!novoConfig[sigla]) novoConfig[sigla] = { titular: 0, suplente: 0 };
    novoConfig[sigla][tipo] = Math.max(0, parseInt(inp.value, 10) || 0);
  });

  try {
    await fbPut('/config', novoConfig);
    state.config = novoConfig;
    fecharModal('modal-config-vagas');
    renderSidebarComissoes();
    if (state.comissaoSel && state.view === 'comissao') {
      renderPainelComissao(state.comissaoSel);
    }
    mostrarToast('Vagas salvas com sucesso.');
  } catch (e) {
    mostrarToast('Erro ao salvar vagas.', 'erro');
  }
}

// ---------- MODAL: TRANSFERÊNCIA DE VAGA ----------

function abrirModalTransferencia(sigla, tipo, direcao) {
  _transfCtx = { sigla, tipo, direcao };

  const acao = direcao === 'ceder' ? 'Ceder' : 'Receber';
  const prep = direcao === 'ceder' ? 'para' : 'de';
  document.getElementById('transf-titulo').textContent =
    `${acao} Vaga de ${tipo === 'titular' ? 'Titular' : 'Suplente'} — ${sigla}`;
  document.getElementById('transf-desc').textContent =
    `${acao} 1 vaga de ${tipo} ${prep} outro partido. Isso ajustará as vagas disponíveis.`;
  document.getElementById('transf-partido-label').textContent =
    direcao === 'ceder' ? 'Partido destinatário' : 'Partido de origem';
  document.getElementById('transf-partido').value = '';
  document.getElementById('transf-obs').value     = '';
  document.getElementById('modal-transferencia').style.display = 'flex';
  document.getElementById('transf-partido').focus();
}

async function confirmarTransferencia() {
  if (!_transfCtx) return;
  const { sigla, tipo, direcao } = _transfCtx;
  const partido = document.getElementById('transf-partido').value.trim().toUpperCase();
  const obs     = document.getElementById('transf-obs').value.trim();
  if (!partido) { mostrarToast('Informe o partido.', 'erro'); return; }

  await salvarTransferencia(sigla, tipo, direcao, partido, obs);
  _transfCtx = null;
  fecharModal('modal-transferencia');
  renderPainelComissao(sigla);
  renderSidebarComissoes();
  mostrarToast(direcao === 'ceder' ? 'Vaga cedida.' : 'Vaga recebida.');
}

async function salvarTransferencia(sigla, tipo, direcao, partido, obs) {
  const id      = `t_${Date.now()}`;
  const subPath = direcao === 'ceder' ? 'cedidas' : 'recebidas';
  const entry   = { tipo, partido, obs, data: new Date().toISOString() };

  if (!state.transferencias[sigla]) state.transferencias[sigla] = {};
  if (!state.transferencias[sigla][subPath]) state.transferencias[sigla][subPath] = {};
  state.transferencias[sigla][subPath][id] = entry;

  await fbPut(`/transferencias/${sigla}/${subPath}/${id}`, entry);
}

async function removerTransferencia(sigla, direcao, id) {
  if (state.transferencias[sigla]?.[direcao]) {
    delete state.transferencias[sigla][direcao][id];
  }
  await fbDelete(`/transferencias/${sigla}/${direcao}/${id}`);
}

// ---------- MODAL: DEPUTADO DE ACORDO ----------

function abrirModalDepAcordo(sigla, transfId) {
  const e = state.transferencias[sigla]?.cedidas?.[transfId];
  _depAcordoCtx = { sigla, transfId };

  const com = getComissao(sigla);
  document.getElementById('dep-acordo-titulo').textContent =
    `Deputado na Vaga Cedida — ${sigla}`;
  document.getElementById('dep-acordo-desc').textContent =
    `Vaga de ${e?.tipo || ''} cedida ao ${e?.partido || ''}${com ? ` · ${com.nome}` : ''}`;
  document.getElementById('dep-acordo-nome').value    = e?.depNome    || '';
  document.getElementById('dep-acordo-partido').value = e?.depPartido || '';
  document.getElementById('dep-acordo-uf').value      = e?.depUf      || '';
  document.getElementById('modal-dep-acordo').style.display = 'flex';
  document.getElementById('dep-acordo-nome').focus();
}

async function salvarDepAcordo() {
  if (!_depAcordoCtx) return;
  const { sigla, transfId } = _depAcordoCtx;
  const nome    = document.getElementById('dep-acordo-nome').value.trim();
  const partido = document.getElementById('dep-acordo-partido').value.trim().toUpperCase();
  const uf      = document.getElementById('dep-acordo-uf').value;

  if (!nome) { mostrarToast('Informe o nome do deputado.', 'erro'); return; }

  const entry   = state.transferencias[sigla]?.cedidas?.[transfId];
  if (!entry) return;

  const updated = { ...entry, depNome: nome, depPartido: partido, depUf: uf };
  state.transferencias[sigla].cedidas[transfId] = updated;
  await fbPut(`/transferencias/${sigla}/cedidas/${transfId}`, updated);

  _depAcordoCtx = null;
  fecharModal('modal-dep-acordo');
  renderPainelComissao(sigla);
  mostrarToast('Deputado de acordo registrado.');
}

// ---------- EXPORTAR EXCEL ----------

function exportarExcel() {
  if (typeof XLSX === 'undefined') {
    mostrarToast('Biblioteca Excel não carregada.', 'erro');
    return;
  }

  const fmt = iso => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };

  const comissoes = todasComissoes();

  // Aba 1: membros — com flag de acordo e origem
  const rowsMembros = [['Comissão', 'Sigla', 'Tipo de Comissão', 'Tipo', 'Deputado', 'UF', 'Partido', 'Vaga de Acordo', 'Origem da Vaga']];
  for (const com of comissoes) {
    const m  = state.membros[com.sigla] || {};
    const t  = state.transferencias[com.sigla] || {};

    // Partidos que cederam vagas para nós (recebidas), por tipo
    const origemAcordo = tipo => Object.values(t.recebidas || {})
      .filter(x => x.tipo === tipo)
      .map(r => r.partido).filter(Boolean).join(', ');

    for (const depId of (m.titulares || [])) {
      const dep = state.deputados[depId];
      if (!dep) continue;
      const isAcordo = !!(m.titulares_acordo?.[depId]);
      rowsMembros.push([com.nome, com.sigla, com.tipo, 'Titular', dep.nome, dep.uf, dep.partido || '',
        isAcordo ? 'Sim' : 'Não', isAcordo ? origemAcordo('titular') : '']);
    }
    for (const depId of (m.suplentes || [])) {
      const dep = state.deputados[depId];
      if (!dep) continue;
      const isAcordo = !!(m.suplentes_acordo?.[depId]);
      rowsMembros.push([com.nome, com.sigla, com.tipo, 'Suplente', dep.nome, dep.uf, dep.partido || '',
        isAcordo ? 'Sim' : 'Não', isAcordo ? origemAcordo('suplente') : '']);
    }
  }

  // Aba 2: vagas cedidas — com deputado externo se registrado
  const rowsCedidas = [['Comissão', 'Sigla', 'Tipo de Comissão', 'Tipo', 'Partido Destinatário', 'Deputado Externo', 'UF', 'Partido Dep.', 'Observação', 'Data']];
  for (const com of comissoes) {
    const t = state.transferencias[com.sigla] || {};
    for (const e of Object.values(t.cedidas || {})) {
      rowsCedidas.push([
        com.nome, com.sigla, com.tipo,
        e.tipo === 'titular' ? 'Titular' : 'Suplente',
        e.partido,
        e.depNome    || '',
        e.depUf      || '',
        e.depPartido || '',
        e.obs        || '',
        fmt(e.data),
      ]);
    }
  }

  // Aba 3: pedidos
  const rowsPedidos = [['Comissão', 'Sigla', 'Tipo de Comissão', 'Deputado', 'UF', 'Partido', 'Observação', 'Data']];
  for (const com of comissoes) {
    const p = state.pedidos[com.sigla] || {};
    for (const e of Object.values(p)) {
      const dep = state.deputados[e.depId];
      if (dep) rowsPedidos.push([com.nome, com.sigla, com.tipo, dep.nome, dep.uf, dep.partido || '', e.obs || '', fmt(e.data)]);
    }
  }

  const wb = XLSX.utils.book_new();

  if (rowsMembros.length > 1) {
    const ws1 = XLSX.utils.aoa_to_sheet(rowsMembros);
    ws1['!cols'] = [{ wch: 52 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 34 }, { wch: 5 }, { wch: 8 }, { wch: 16 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Membros');
  }

  if (rowsCedidas.length > 1) {
    const ws2 = XLSX.utils.aoa_to_sheet(rowsCedidas);
    ws2['!cols'] = [{ wch: 52 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 34 }, { wch: 5 }, { wch: 10 }, { wch: 28 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Vagas Cedidas');
  }

  if (rowsPedidos.length > 1) {
    const ws3 = XLSX.utils.aoa_to_sheet(rowsPedidos);
    ws3['!cols'] = [{ wch: 52 }, { wch: 10 }, { wch: 16 }, { wch: 34 }, { wch: 5 }, { wch: 8 }, { wch: 28 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Pedidos');
  }

  if (wb.SheetNames.length === 0) {
    mostrarToast('Nenhum dado para exportar.', 'erro');
    return;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `comissoes-podemos-${hoje}.xlsx`);
  mostrarToast('Excel exportado com sucesso.');
}

// ---------- UTILITÁRIOS ----------

function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

let _toastTimer = null;
function mostrarToast(msg, tipo = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast toast-${tipo}`;
  t.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}
