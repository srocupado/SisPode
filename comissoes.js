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

// ---------- CÂMARA / SINCRONIZAÇÃO DE MPVs ----------

// As comissões mistas de MPV são derivadas das Medidas Provisórias na API de
// dados abertos da Câmara, que entrega: a ementa (tema), o status real da MP
// (para descartar as já convertidas em lei / que perderam eficácia) e o evento
// de instalação da comissão (Em funcionamento × Aguardando instalação). MPVs de
// crédito extraordinário tramitam na CMO (orçamento) e não geram comissão mista
// própria — por isso são descartadas.
const CAMARA_API = 'https://dadosabertos.camara.leg.br/api/v2';
// Janela de busca: 8 meses cobre toda MP fora de estado terminal (uma MPV perde
// eficácia em até ~120 dias se não for apreciada).
const MPV_JANELA_MESES = 8;
// Cache considerado "velho" após 12h → dispara auto-sync silencioso.
const MPV_SYNC_TTL_MS = 12 * 60 * 60 * 1000;

const MPV_SIT_FUNCIONAMENTO = 'Em funcionamento';
const MPV_SIT_AGUARDANDO    = 'Aguardando instalação';
// Situações que indicam que a MP já saiu da fase de comissão mista — seja por
// conclusão (virou lei, perdeu eficácia, rejeitada…) ou por ter avançado ao
// plenário/sanção (aguardando apreciação, pronta para pauta, aguardando sanção).
// Enquanto está na comissão, a MP não tem situação preenchida na Câmara.
const MPV_STATUS_FORA_COMISSAO = /transformad|norma jur|perdeu a efic|rejeitad|arquivad|retirad|vetad|devolvid|san[çc]|aguardando aprecia|aguardando promulga|aguardando delibera|pronta para pauta|remetid/i;

// ---------- CÂMARA / COMISSÕES TEMPORÁRIAS ----------

// Comissões temporárias por tipo de órgão na API da Câmara.
const CAMARA_TIPOS_TEMP = [
  { cod: 4, tipo: 'CPI' },
  { cod: 3, tipo: 'Especial' },
  { cod: 5, tipo: 'Externa' },
];
const TEMP_TIPOS = ['CPI', 'Especial', 'Externa'];
const TEMP_TIPO_ROTULO = { CPI: 'CPI', Especial: 'Especiais', Externa: 'Externas' };

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
  view:          'permanente',// 'permanente' | 'mpv' | 'temporaria' | 'deputado' | 'alertas'
  tempTab:       'Especial',  // sub-aba de "Temporárias": 'CPI' | 'Especial' | 'Externa'
  comissaoSel:   null,        // sigla da comissão selecionada
  deputados:     {},          // { id: { nome, uf } }
  membros:       {},          // { sigla: { titulares: [id,...], suplentes: [id,...] } }
  config:        {},          // { sigla: { titular: n, suplente: n } }
  transferencias:{},          // { sigla: { cedidas: {id: entry}, recebidas: {id: entry} } }
  pedidos:       {},          // { sigla: { id: { depId, obs, data } } }
  mistas:        {},          // { sigla: { sigla, nome, mpvId, numero, ano, situacao, origem } } — sincronizadas/criadas
  mistasOcultas: {},          // { sigla: true } — mistas apagadas manualmente (sync não readiciona)
  mistasSyncAt:  null,        // ISO da última sincronização das mistas
  temporarias:   {},          // { sigla: { sigla, nome, tipo, id, situacao, ... } } — sincronizadas da Câmara
  temporariasSyncAt: null,    // ISO da última sincronização das temporárias
  sincronizando: false,       // sincronização de mistas em andamento
  sincronizandoTemp: false,   // sincronização de temporárias em andamento
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
  renderSubtabs();
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

  // (sub-abas são renderizadas e ligadas dinamicamente em renderSubtabs)

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

  // Imprimir lista de membros (grupos selecionáveis)
  document.getElementById('btn-imprimir')
    .addEventListener('click', () => { document.getElementById('modal-imprimir').style.display = 'flex'; });
  document.getElementById('btn-imprimir-gerar')
    .addEventListener('click', () => {
      const grupos = [...document.querySelectorAll('.print-grp:checked')].map(c => c.value);
      if (!grupos.length) { mostrarToast('Selecione ao menos um grupo.', 'erro'); return; }
      fecharModal('modal-imprimir');
      imprimirMembros(grupos);
    });

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

  // Configurar vagas de uma comissão (temporárias)
  document.getElementById('btn-salvar-vagas-com')
    .addEventListener('click', salvarVagasComissao);
  const vT = document.getElementById('vagas-com-titular');
  const vS = document.getElementById('vagas-com-suplente');
  const igual = document.getElementById('vagas-com-igual');
  vT.addEventListener('input', () => { if (igual.checked) vS.value = vT.value; });
  vS.addEventListener('input', () => { if (igual.checked) vT.value = vS.value; });
  igual.addEventListener('change', () => { if (igual.checked) vS.value = vT.value; });
}

// ---------- LOOKUP DE COMISSÕES (permanentes + mistas + temporárias) ----------

// Comissão por sigla, em qualquer das camadas.
function getComissao(sigla) {
  return COMISSOES_PERMANENTES.find(c => c.sigla === sigla)
      || state.mistas[sigla]
      || state.temporarias[sigla]
      || null;
}

// 'permanente' | 'mista' | 'temporaria' | null
function tipoComissao(sigla) {
  if (COMISSOES_PERMANENTES.some(c => c.sigla === sigla)) return 'permanente';
  if (state.mistas[sigla]) return 'mista';
  if (state.temporarias[sigla]) return 'temporaria';
  return null;
}

// Temporárias (opcionalmente filtradas por tipo), ordenadas por nome.
function listaTemporarias(tipo) {
  let arr = Object.values(state.temporarias);
  if (tipo) arr = arr.filter(t => t.tipo === tipo);
  return arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt'));
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

// Todas as comissões com rótulo de tipo (para exportação).
function todasComissoes() {
  return [
    ...COMISSOES_PERMANENTES.map(c => ({ ...c, tipo: 'Permanente' })),
    ...listaMistas().map(c => ({ ...c, tipo: 'Mista (MPV)' })),
    ...listaTemporarias().map(c => ({ ...c, tipo: `Temporária (${c.tipo})` })),
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
    const [deps, membros, config, transf, pedidos, mistas, temp] = await Promise.all([
      fbGet('/deputados'),
      fbGet('/membros'),
      fbGet('/config'),
      fbGet('/transferencias'),
      fbGet('/pedidos'),
      fbGet('/comissoes-mistas'),
      fbGet('/comissoes-temporarias'),
    ]);
    state.deputados        = deps    || {};
    state.membros          = membros || {};
    state.config           = config  || {};
    state.transferencias   = transf  || {};
    state.pedidos          = pedidos || {};
    state.mistas           = mistas?.comissoes || {};
    state.mistasOcultas    = mistas?.ocultas   || {};
    state.mistasSyncAt     = mistas?.syncAt    || null;
    state.temporarias      = temp?.comissoes || {};
    state.temporariasSyncAt = temp?.syncAt   || null;
  } catch (e) {
    mostrarToast('Erro ao carregar dados do Firebase.', 'erro');
  }
}

// ---------- SINCRONIZAÇÃO DE COMISSÕES MISTAS (MPV) ----------

function mistasDesatualizadas() {
  if (!state.mistasSyncAt) return true;
  return (Date.now() - new Date(state.mistasSyncAt).getTime()) > MPV_SYNC_TTL_MS;
}

// Sincroniza as comissões mistas de MPV a partir da API da Câmara: lista as MPVs
// recentes, descarta as orçamentárias (CMO) e as já fora da fase de comissão, e
// classifica cada uma como Em funcionamento (instalada) ou Aguardando instalação.
// Persiste no Firebase, preservando as criadas manualmente e as apagadas.
async function sincronizarMistas({ reset = false } = {}) {
  // 1. MPVs apresentadas na janela (a resposta já traz a ementa/tema).
  const desde = new Date();
  desde.setMonth(desde.getMonth() - MPV_JANELA_MESES);
  const dataIni = desde.toISOString().slice(0, 10);

  const mpvs = [];
  let url = `${CAMARA_API}/proposicoes?siglaTipo=MPV&dataApresentacaoInicio=${dataIni}`
          + `&itens=100&ordem=DESC&ordenarPor=id`;
  while (url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    mpvs.push(...(j.dados || []));
    url = (j.links || []).find(l => l.rel === 'next')?.href || null;
  }

  // 2. A tramitação de cada MPV dá o status atual + a instalação da comissão.
  const daApi = {};
  await mapLimit(mpvs, 8, async (m) => {
    try {
      const r = await fetch(`${CAMARA_API}/proposicoes/${m.id}/tramitacoes`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const evs = (await r.json()).dados || [];

      // MPVs de crédito extraordinário tramitam na CMO (orçamento), sem CMMPV própria.
      if (evs.some(e => (e.siglaOrgao || '') === 'CMO')) return;

      // Status atual = última tramitação com situação preenchida.
      let status = '';
      for (let i = evs.length - 1; i >= 0; i--) {
        const s = (evs[i].descricaoSituacao || '').trim();
        if (s) { status = s; break; }
      }
      if (MPV_STATUS_FORA_COMISSAO.test(status)) return; // já saiu da fase de comissão

      const numero = parseInt(m.numero, 10);
      const ano    = parseInt(m.ano, 10);
      if (!numero || !ano) return;
      const sigla = `MPV${numero}${String(ano).slice(-2)}`;
      const instalada = evs.some(e => /instala[çc][ãa]o de comiss/i.test(e.descricaoTramitacao || ''));

      daApi[sigla] = {
        sigla, numero, ano,
        nome: `Comissão Mista da MPV ${numero}/${ano}`,
        situacao: instalada ? MPV_SIT_FUNCIONAMENTO : MPV_SIT_AGUARDANDO,
        ementa: (m.ementa || '').trim(),
        statusMp: status,
        mpvId: m.id,
        origem: 'api',
      };
    } catch (_) { /* ignora falha pontual */ }
  });

  if (!Object.keys(daApi).length) throw new Error('nenhuma MPV retornada pela API da Câmara');

  // 3. Mescla. Em reset, descarta tudo (manuais e apagadas) e usa só a API.
  //    Caso normal: API (exceto apagadas) + criadas manualmente (têm prioridade).
  const ocultas   = reset ? {} : (state.mistasOcultas || {});
  const comissoes = {};
  for (const [sigla, c] of Object.entries(daApi)) {
    if (!ocultas[sigla]) comissoes[sigla] = c;
  }
  if (!reset) {
    for (const [sigla, c] of Object.entries(state.mistas)) {
      if (c.origem === 'manual') comissoes[sigla] = c;
    }
  }

  const payload = { syncAt: new Date().toISOString(), comissoes, ocultas };
  await fbPut('/comissoes-mistas', payload);
  state.mistas        = comissoes;
  state.mistasOcultas = ocultas;
  state.mistasSyncAt  = payload.syncAt;
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
    mudarView('mpv');
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

// Wrapper de UI: feedback nos botões + toasts (silencioso no auto-sync).
async function sincronizarMistasUI({ silencioso = false, reset = false } = {}) {
  if (state.sincronizando) return;
  state.sincronizando = true;
  const botoes = ['btn-sync-mpv', 'btn-reset-mpv'].map(id => document.getElementById(id)).filter(Boolean);
  const orig = botoes.map(b => b.innerHTML);
  botoes.forEach(b => { b.disabled = true; });
  const btnSync = document.getElementById('btn-sync-mpv');
  if (btnSync) btnSync.innerHTML = 'Sincronizando…';
  if (!silencioso) mostrarToast(reset ? 'Recarregando comissões mistas de MPV…' : 'Sincronizando comissões mistas de MPV…');

  try {
    const n = await sincronizarMistas({ reset });
    if (state.comissaoSel && !getComissao(state.comissaoSel)) state.comissaoSel = null;
    if (state.view === 'mpv') { renderSidebar(); renderPainel(); }
    if (!silencioso) mostrarToast(`${n} comissão(ões) mista(s) de MPV em fase de comissão.`);
  } catch (e) {
    if (!silencioso) mostrarToast('Falha ao sincronizar MPVs: ' + e.message, 'erro');
    else console.warn('Auto-sync de MPVs falhou:', e.message);
  } finally {
    state.sincronizando = false;
    botoes.forEach((b, i) => { b.disabled = false; b.innerHTML = orig[i]; });
  }
}

// Apaga todas as comissões mistas de MPV e puxa os dados novos da Câmara.
function recarregarMistas() {
  if (state.sincronizando) return;
  const temManuais = Object.values(state.mistas).some(c => c.origem === 'manual');
  const aviso = temManuais ? '\n\nAtenção: as comissões criadas manualmente serão removidas.' : '';
  if (!confirm(`Apagar todas as comissões mistas de MPV e puxar os dados novos da Câmara?${aviso}`)) return;
  sincronizarMistasUI({ silencioso: false, reset: true });
}

// ---------- SINCRONIZAÇÃO DE COMISSÕES TEMPORÁRIAS ----------

function temporariasDesatualizadas() {
  if (!state.temporariasSyncAt) return true;
  return (Date.now() - new Date(state.temporariasSyncAt).getTime()) > MPV_SYNC_TTL_MS;
}

// Comissões de teste do sistema da Câmara (não devem ser listadas).
function ehComissaoTeste(o) {
  return /teste/i.test(o.sigla || '') || /realiza[çc][ãa]o de testes/i.test(o.nome || '');
}

// Em funcionamento = ativa (sem dataFim ou prazo futuro) e instalada. Quando a
// API ainda não registrou a data de instalação, considera-se instalada se já
// houver eventos (reuniões/audiências) — caso de comissões recém-instaladas.
async function temporariaEmFuncionamento(det, id) {
  if (!det) return false;
  if (det.dataFim && new Date(det.dataFim) < new Date()) return false; // encerrada
  if (det.dataInstalacao && new Date(det.dataInstalacao) <= new Date()) return true;
  try {
    const r = await fetch(`${CAMARA_API}/orgaos/${id}/eventos?itens=1`, { headers: { Accept: 'application/json' } });
    if (r.ok) return ((await r.json()).dados || []).length > 0;
  } catch (_) { /* ignora */ }
  return false;
}

// Lista as comissões temporárias (CPI, Especiais, Externas) em funcionamento na
// Câmara e persiste no Firebase. As designações de membros e a configuração de
// vagas ficam em /membros e /config (por sigla) — preservadas entre sincronizações.
async function sincronizarTemporarias() {
  const comissoes = {};
  for (const { cod, tipo } of CAMARA_TIPOS_TEMP) {
    const orgaos = [];
    let url = `${CAMARA_API}/orgaos?codTipoOrgao=${cod}&itens=100&ordem=DESC&ordenarPor=id`;
    while (url) {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      orgaos.push(...(j.dados || []));
      url = (j.links || []).find(l => l.rel === 'next')?.href || null;
    }

    await mapLimit(orgaos, 6, async (o) => {
      try {
        if (ehComissaoTeste(o)) return;
        const r = await fetch(`${CAMARA_API}/orgaos/${o.id}`, { headers: { Accept: 'application/json' } });
        if (!r.ok) return;
        const det = (await r.json()).dados;
        if (!(await temporariaEmFuncionamento(det, o.id))) return;
        const sigla = (o.sigla || `ORG${o.id}`).trim();
        comissoes[sigla] = {
          sigla, tipo,
          nome: o.nome || det.nome || sigla,
          apelido: o.apelido || o.nomeResumido || '',
          id: o.id,
          situacao: MPV_SIT_FUNCIONAMENTO,
          dataInstalacao: det.dataInstalacao || null,
          dataFim: det.dataFim || null,
        };
      } catch (_) { /* ignora falha pontual */ }
    });
  }

  if (!Object.keys(comissoes).length) throw new Error('nenhuma comissão temporária retornada pela Câmara');

  const payload = { syncAt: new Date().toISOString(), comissoes };
  await fbPut('/comissoes-temporarias', payload);
  state.temporarias       = comissoes;
  state.temporariasSyncAt = payload.syncAt;
  return Object.keys(comissoes).length;
}

async function sincronizarTemporariasUI({ silencioso = false } = {}) {
  if (state.sincronizandoTemp) return;
  state.sincronizandoTemp = true;
  const btn = document.getElementById('btn-sync-temp');
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Sincronizando…'; }
  if (!silencioso) mostrarToast('Sincronizando comissões temporárias…');

  try {
    const n = await sincronizarTemporarias();
    if (state.comissaoSel && !getComissao(state.comissaoSel)) state.comissaoSel = null;
    if (state.view === 'temporaria') { renderSubtabs(); renderSidebar(); renderPainel(); }
    if (!silencioso) mostrarToast(`${n} comissão(ões) temporária(s) em funcionamento.`);
  } catch (e) {
    if (!silencioso) mostrarToast('Falha ao sincronizar temporárias: ' + e.message, 'erro');
    else console.warn('Auto-sync de temporárias falhou:', e.message);
  } finally {
    state.sincronizandoTemp = false;
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
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
    renderSidebar();
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
  document.getElementById('busca-wrap').style.display =
    view === 'alertas' ? 'none' : '';
  renderSubtabs();
  renderSidebar();
  renderPainel();

  // Auto-sync ao abrir a aba Temporárias com cache velho.
  if (view === 'temporaria' && temporariasDesatualizadas()) {
    sincronizarTemporariasUI({ silencioso: true });
  }
}

// Sub-abas existem apenas dentro de "Temporárias" (CPI/Especiais/Externas).
function renderSubtabs() {
  const cont = document.getElementById('com-subtabs');
  if (state.view !== 'temporaria') {
    cont.style.display = 'none';
    cont.innerHTML = '';
    return;
  }
  cont.style.display = '';
  const n = t => listaTemporarias(t).length;
  cont.innerHTML = TEMP_TIPOS.map(t =>
    `<button class="com-subtab" data-val="${t}">${TEMP_TIPO_ROTULO[t]} <span class="subtab-count">(${n(t)})</span></button>`
  ).join('');
  cont.querySelectorAll('.com-subtab').forEach(b => {
    b.classList.toggle('ativo', state.tempTab === b.dataset.val);
    b.addEventListener('click', () => {
      state.tempTab = b.dataset.val;
      state.busca = '';
      document.getElementById('com-busca').value = '';
      renderSubtabs();
      renderSidebar();
    });
  });
}

function renderSidebar() {
  if (state.view === 'alertas')    { renderSidebarAlertas(); return; }
  if (state.view === 'deputado')   { renderSidebarDeputados(); return; }
  if (state.view === 'temporaria') { renderSidebarTemporarias(); return; }
  if (state.view === 'mpv')        { renderSidebarMistas(); return; }
  renderSidebarPermanentes();
}

// Item da sidebar compartilhado por comissões (permanentes/mistas/temporárias).
function comItemHtml(c) {
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
  if (tipoComissao(c.sigla) === 'mista') {
    const sit = badgeSituacaoMista(c);
    if (sit) linhas.push(sit);
  }
  const extras = [];
  if (semVagas) extras.push('<span class="badge-sem-vagas">sem vagas</span>');
  else if (cheias) extras.push('<span class="badge-sem-vagas" style="background:rgba(240,84,84,.15);color:var(--vermelho)">cheias</span>');
  if (nPedidos > 0) extras.push(`<span class="badge-pedidos">${nPedidos} pedido${nPedidos > 1 ? 's' : ''}</span>`);
  if (extras.length) linhas.push(extras.join(' '));

  return `
      <div class="com-item${state.comissaoSel === c.sigla ? ' ativo' : ''}" data-sigla="${c.sigla}">
        <span class="com-item-sigla">${comSiglaDisplay(c)}</span>
        <span class="com-item-nome">${c.nome}${linhas.map(l => '<br>' + l).join('')}</span>
        <span class="com-item-badge${total > 0 ? ' tem-membro' : ''}">${total > 0 ? total : ''}</span>
      </div>`;
}

// Sigla para exibição. Nas mistas de MPV, separa número e ano (MPV1343/26) para
// facilitar a leitura — a sigla interna (chave de armazenamento) continua MPV134326.
function comSiglaDisplay(c) {
  if (c && c.numero && c.ano && tipoComissao(c.sigla) === 'mista') {
    return `MPV${c.numero}/${String(c.ano).slice(-2)}`;
  }
  return c.sigla;
}

const _vazioSidebar = msg => `<div class="com-empty" style="padding:18px 14px;font-size:12px">${msg}</div>`;

function renderSidebarTemporarias() {
  const lista = document.getElementById('com-lista');
  const matchBusca = c =>
    (c.sigla || '').toLowerCase().includes(state.busca) ||
    (c.nome  || '').toLowerCase().includes(state.busca);
  const itens = listaTemporarias(state.tempTab).filter(matchBusca);

  let html = `<div class="com-mistas-toolbar">`
           + syncInfoTemporariasHtml()
           + `<span class="com-mistas-acoes">`
           + `<button class="btn-reset-mpv" id="btn-sync-temp" title="Sincronizar comissões temporárias com a API da Câmara">↻ Sincronizar</button>`
           + `</span></div>`;
  html += itens.length
    ? itens.map(comItemHtml).join('')
    : _vazioSidebar(state.busca
        ? 'Nenhuma corresponde à busca.'
        : `Nenhuma comissão ${TEMP_TIPO_ROTULO[state.tempTab]} em funcionamento.`);

  lista.innerHTML = html;
  lista.querySelector('#btn-sync-temp')?.addEventListener('click', () => sincronizarTemporariasUI({ silencioso: false }));
  lista.querySelectorAll('.com-item').forEach(el => {
    el.addEventListener('click', () => selecionarComissao(el.dataset.sigla));
  });
}

function syncInfoTemporariasHtml() {
  if (state.sincronizandoTemp) return `<div class="com-sync-info">Sincronizando…</div>`;
  if (!state.temporariasSyncAt) return `<div class="com-sync-info sync-velho">Nunca sincronizado.</div>`;
  const velho = temporariasDesatualizadas();
  return `<div class="com-sync-info${velho ? ' sync-velho' : ''}">`
       + `Atualizado ${fmtSyncAgo(state.temporariasSyncAt)}${velho ? ' · desatualizado' : ''}</div>`;
}

const _matchBusca = c =>
  (c.sigla || '').toLowerCase().includes(state.busca) ||
  (c.nome  || '').toLowerCase().includes(state.busca);

function renderSidebarPermanentes() {
  const lista = document.getElementById('com-lista');
  const permanentes = COMISSOES_PERMANENTES.filter(_matchBusca);
  lista.innerHTML = permanentes.length
    ? permanentes.map(comItemHtml).join('')
    : _vazioSidebar(state.busca ? 'Nenhuma corresponde à busca.' : 'Nenhuma.');
  lista.querySelectorAll('.com-item').forEach(el => {
    el.addEventListener('click', () => selecionarComissao(el.dataset.sigla));
  });
}

function renderSidebarMistas() {
  const lista = document.getElementById('com-lista');
  const mistas = listaMistas().filter(_matchBusca);
  let html = `<div class="com-mistas-toolbar">`
           + syncInfoHtml()
           + `<span class="com-mistas-acoes">`
           + `<button class="btn-reset-mpv" id="btn-reset-mpv" title="Apagar todas as comissões mistas e puxar os dados novos da Câmara">↻ Recarregar</button>`
           + `<button class="btn-nova-mista" id="btn-nova-mista" title="Criar comissão mista de MPV manualmente">+ Nova</button>`
           + `</span></div>`;
  html += mistas.length
    ? mistas.map(comItemHtml).join('')
    : _vazioSidebar(state.busca
        ? 'Nenhuma corresponde à busca.'
        : 'Nenhuma comissão mista. Use “Sincronizar MPVs” no topo ou “+ Nova”.');

  lista.innerHTML = html;
  lista.querySelector('#btn-nova-mista')?.addEventListener('click', abrirModalNovaMista);
  lista.querySelector('#btn-reset-mpv')?.addEventListener('click', recarregarMistas);
  lista.querySelectorAll('.com-item').forEach(el => {
    el.addEventListener('click', () => selecionarComissao(el.dataset.sigla));
  });
}

// Badge de situação para uma comissão mista. Retorna '' quando não há
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
  const ehComissao = ['permanente', 'mpv', 'temporaria'].includes(state.view);
  if (ehComissao && state.comissaoSel) {
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
  const ehTemp  = tipoComissao(sigla) === 'temporaria';
  const tagTipo = ehMista ? ' <span class="tag-mista">Mista</span>'
                : ehTemp  ? ` <span class="tag-mista tag-temp">${com.tipo}</span>` : '';
  document.getElementById('com-painel-conteudo').innerHTML = `
    <div style="margin-bottom:18px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div class="com-painel-titulo">${com.nome}${tagTipo}</div>
        <div class="com-painel-sigla">${comSiglaDisplay(com)}${ehMista ? ` &nbsp;${badgeSituacaoMista(com)}` : ''}</div>
        ${ehMista && com.ementa ? `<div class="com-painel-ementa"><strong>Tema:</strong> ${com.ementa}</div>` : ''}
      </div>
      ${ehMista ? `<button class="btn-apagar-mista" id="btn-apagar-mista" data-sigla="${sigla}" title="Apagar esta comissão mista">🗑 Apagar</button>` : ''}
      ${ehTemp ? `<button class="btn-config-vagas-com" id="btn-config-vagas-com" data-sigla="${sigla}" title="Definir o número de vagas desta comissão">⚙ Configurar vagas</button>` : ''}
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
  painel.querySelector('#btn-config-vagas-com')
    ?.addEventListener('click', () => abrirModalVagasComissao(sigla));

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
      renderSidebar();
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
      renderSidebar();
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
    const rotulo = com ? comSiglaDisplay(com) : s;
    return `<span class="dep-tag ${isConflito ? 'conflito' : tipo}" title="${com ? com.nome : s}">${rotulo}${isConflito ? ' ⚠' : ''}</span>`;
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
  renderSidebar();
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
  const ehMistaCom = tipoComissao(sigla) === 'mista';
  document.getElementById('add-membro-desc').innerHTML =
    `${com.nome} (${comSiglaDisplay(com)})`
    + (ehMistaCom && com.ementa
        ? `<br><span class="add-membro-tema"><strong>Tema:</strong> ${com.ementa}</span>`
        : '');

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
        renderSidebar();
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
      renderSidebar();
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
  const inputs = document.querySelectorAll('#config-vagas-lista .config-vaga-input');
  // Mescla sobre a config existente para não apagar a das temporárias.
  const novoConfig = { ...state.config };

  inputs.forEach(inp => {
    const { sigla, tipo } = inp.dataset;
    if (!novoConfig[sigla]) novoConfig[sigla] = { titular: 0, suplente: 0 };
    novoConfig[sigla] = { ...novoConfig[sigla], [tipo]: Math.max(0, parseInt(inp.value, 10) || 0) };
  });

  try {
    await fbPut('/config', novoConfig);
    state.config = novoConfig;
    fecharModal('modal-config-vagas');
    renderSidebar();
    if (state.comissaoSel) renderPainelComissao(state.comissaoSel);
    mostrarToast('Vagas salvas com sucesso.');
  } catch (e) {
    mostrarToast('Erro ao salvar vagas.', 'erro');
  }
}

// ---------- MODAL: VAGAS DE UMA COMISSÃO (temporárias) ----------

let _vagasComSigla = null;

function abrirModalVagasComissao(sigla) {
  _vagasComSigla = sigla;
  const com = getComissao(sigla);
  const cfg = state.config[sigla] || { titular: 0, suplente: 0 };
  document.getElementById('vagas-com-desc').textContent = `${com.nome} (${comSiglaDisplay(com)})`;
  document.getElementById('vagas-com-titular').value  = cfg.titular  || 0;
  document.getElementById('vagas-com-suplente').value = cfg.suplente || 0;
  document.getElementById('vagas-com-igual').checked  = (cfg.titular || 0) === (cfg.suplente || 0);
  document.getElementById('modal-vagas-comissao').style.display = 'flex';
  setTimeout(() => document.getElementById('vagas-com-titular').focus(), 50);
}

async function salvarVagasComissao() {
  const sigla = _vagasComSigla;
  if (!sigla) return;
  const t = Math.max(0, parseInt(document.getElementById('vagas-com-titular').value, 10) || 0);
  const s = Math.max(0, parseInt(document.getElementById('vagas-com-suplente').value, 10) || 0);

  state.config[sigla] = { ...(state.config[sigla] || {}), titular: t, suplente: s };
  try {
    await fbPut(`/config/${sigla}`, state.config[sigla]);
    fecharModal('modal-vagas-comissao');
    renderSidebar();
    if (state.comissaoSel === sigla) renderPainelComissao(sigla);
    mostrarToast('Vagas configuradas.');
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
  renderSidebar();
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

// ---------- IMPRIMIR MEMBROS (PDF via navegador) ----------

// Define os grupos imprimíveis (rótulo + conjunto de comissões).
function _grupoImprimivel(g) {
  if (g === 'permanente') return { titulo: 'Comissões Permanentes', itens: COMISSOES_PERMANENTES, tema: true };
  if (g === 'mista')      return { titulo: 'Comissões Mistas de MPV', itens: listaMistas(), tema: true };
  if (TEMP_TIPOS.includes(g)) return { titulo: `Comissões Temporárias — ${TEMP_TIPO_ROTULO[g]}`, itens: listaTemporarias(g), tema: false };
  return null;
}

// Imprime a lista de membros dos grupos selecionados em um único documento
// (cada grupo inicia em nova página).
function imprimirMembros(grupos) {
  if (!grupos || !grupos.length) { mostrarToast('Selecione ao menos um grupo.', 'erro'); return; }

  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const h   = new Date();
  const dataStr = `${String(h.getDate()).padStart(2, '0')}/${String(h.getMonth() + 1).padStart(2, '0')}/${h.getFullYear()}`;

  const linhaDep = (id, acordo) => {
    const d = state.deputados[id];
    if (!d) return '';
    const sub = [d.partido, d.uf].filter(Boolean).join(' · ');
    return `<tr><td>${esc(d.nome)}</td><td>${esc(sub)}</td><td>${acordo ? 'Vaga de acordo' : ''}</td></tr>`;
  };
  const secao = (rotulo, ids, acMap) => {
    const rows = ids.map(id => linhaDep(id, !!acMap[id])).filter(Boolean).join('');
    return `<h4>${rotulo} <span class="cont">(${ids.length})</span></h4>`
      + (rows
          ? `<table><thead><tr><th>Deputado</th><th>Partido · UF</th><th>Obs.</th></tr></thead><tbody>${rows}</tbody></table>`
          : `<p class="vazio">— nenhum designado —</p>`);
  };

  const secoes = grupos.map(_grupoImprimivel).filter(Boolean).map((grp, i) => {
    const blocos = grp.itens.map(c => {
      const m = state.membros[c.sigla] || {};
      const tema = (grp.tema && c.ementa) ? `<p class="tema"><strong>Tema:</strong> ${esc(c.ementa)}</p>` : '';
      const sit  = c.situacao ? `<span class="sit">— ${esc(c.situacao)}</span>` : '';
      return `
        <section class="com">
          <h3>${esc(comSiglaDisplay(c))} · ${esc(c.nome)} ${sit}</h3>
          ${tema}
          ${secao('Titulares', m.titulares || [], m.titulares_acordo || {})}
          ${secao('Suplentes', m.suplentes || [], m.suplentes_acordo || {})}
        </section>`;
    }).join('');
    return `<div class="grupo"${i > 0 ? ' style="page-break-before:always"' : ''}>
        <h2>${esc(grp.titulo)}</h2>
        ${blocos || '<p class="vazio">Nenhuma comissão neste grupo.</p>'}
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Lista de Membros — Comissões</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 28px; font-size: 12px; }
      .doc-head { border-bottom: 2px solid #00A859; padding-bottom: 10px; margin-bottom: 16px; }
      .doc-head h1 { font-size: 18px; margin: 0 0 2px; color: #00713c; }
      .doc-head .sub { font-size: 11px; color: #555; }
      .grupo > h2 { font-size: 15px; color: #00713c; margin: 0 0 12px; padding-bottom: 4px; border-bottom: 1px solid #cde7d6; }
      section.com { margin-bottom: 16px; page-break-inside: avoid; }
      section.com h3 { font-size: 13px; margin: 0 0 4px; padding: 5px 8px; background: #eef6f0; border-left: 3px solid #00A859; }
      .sit { font-size: 10px; font-weight: normal; color: #00713c; }
      .tema { margin: 3px 0 8px; color: #444; }
      h4 { font-size: 11px; margin: 8px 0 4px; color: #333; }
      h4 .cont { color: #888; font-weight: normal; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
      th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ddd; }
      th { background: #f5f5f5; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; color: #555; }
      td:nth-child(3) { color: #00713c; }
      .vazio { color: #999; font-style: italic; margin: 2px 0 6px 8px; }
      @media print { body { margin: 12mm; } }
    </style></head>
    <body>
      <div class="doc-head">
        <h1>Lista de Membros — Comissões</h1>
        <div class="sub">Liderança do Podemos · Câmara dos Deputados — gerado em ${dataStr}</div>
      </div>
      ${secoes || '<p>Nenhuma comissão para listar.</p>'}
    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) { mostrarToast('Permita pop-ups para imprimir.', 'erro'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch (_) {} }, 400);
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
