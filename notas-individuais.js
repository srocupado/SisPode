// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// NOTAS TÉCNICAS INDIVIDUAIS — notas de proposições fora da pauta (25/11/2026).
//
// Por que existe: a equipe recebe pedidos de análise de projetos que não estão em pauta e produzia o
// material por fora. Este módulo é uma TELA sobre o mesmo acervo do Plenário, não um gerador paralelo:
// a página é a do Plenário (analise.html?modo=notas) e a nota sai pelo mesmo caminho de um item de
// pauta — documentos, cenários, prompts, conferências, agente revisor, NTA, badges de autoria, apensados.
//
// Onde fica cada coisa:
//   · a nota: /analises_pauta/{chave}/{parecerKey}, como qualquer nota (é por proposição, não por pauta);
//   · o registro da nota individual: /analises_avulsas/{chave} — o mesmo nó do /avulsa do bot, que a
//     varredura de órfãs já respeita. Guarda quem é o responsável e de onde veio a matéria;
//   · a lista de servidores do módulo: /notas_individuais_servidores (própria: há quem use o módulo sem
//     ser da equipe de Plenário). O nome escolhido fica no navegador (config.nomeUsuario).
//
// Três entradas além do número da Câmara: consulta por palavras na base da Câmara, matéria que só existe
// no Senado (chave "SF-…": o mesmo número pode ser outra proposição na Câmara) e texto sem número
// (minuta, anteprojeto: "MINUTA n/ano", analisado sobre o documento que o servidor anexar).
//
// Script clássico (global na extensão) + module.exports para os testes. A parte de tela fica no fim.

'use strict';

const NI_SIGLAS = ['PL', 'PLP', 'PEC', 'PDL', 'MPV', 'PRC'];
const NI_SIGLA_TEXTO = 'MINUTA';
const NI_ROTULO_SENADO = 'Matéria do Senado Federal';

const niNorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Dois nomes são o mesmo servidor? Iguais sem acento e sem caixa, ou um é o começo do outro: o bot grava o
 * nome do Telegram ("Vinicius L") e a lista do módulo tem o nome completo ("Vinícius Lára"). O prefixo
 * precisa de ao menos 5 letras, para "Ana" não casar com "Ana Paula" e "Anabela".
 */
function niMesmoServidor(a, b) {
  a = niNorm(a); b = niNorm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const [curto, longo] = a.length < b.length ? [a, b] : [b, a];
  return curto.length >= 5 && longo.startsWith(curto);
}

/** Lista de servidores sem vazios nem repetidos (o mesmo nome com outra caixa ou acento conta como repetido). */
function niListaServidores(v) {
  const bruto = Array.isArray(v) ? v : Object.values(v || {});
  const out = [];
  for (const s of bruto) {
    const nome = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (nome && !out.some(x => niNorm(x) === niNorm(nome))) out.push(nome);
  }
  return out;
}

/**
 * Lê o que o servidor digitou: "PL 1234/2025", "plp nº 12, de 2024", "PEC 6 2019" ou o link da ficha na
 * Câmara. Devolve { sigla, numero, ano }, { idCamara } ou null.
 */
function niLerEntrada(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const link = /camara\.leg\.br\/[^\s]*?(?:idProposicao=|propostas-legislativas\/)(\d{4,9})/i.exec(t);
  if (link) return { idCamara: Number(link[1]) };
  const m = /\b(PLP|PL|PEC|PDL|MPV|MP|PRC)\s*(?:n[ºo°.]*\s*)?(\d[\d.]*)\s*(?:\/|,?\s*de\s+|\s+)(\d{4})\b/i.exec(t);
  if (!m) return null;
  const numero = String(parseInt(m[2].replace(/\./g, ''), 10));
  if (!/^\d+$/.test(numero) || numero === '0') return null;
  return { sigla: m[1].toUpperCase() === 'MP' ? 'MPV' : m[1].toUpperCase(), numero, ano: m[3] };
}

/** Chave do acervo. A da Câmara é a de sempre (a mesma do item de pauta); Senado e texto têm prefixo próprio. */
function niChave({ entrada = 'camara', sigla, numero, ano }) {
  const base = `${sigla}-${numero}-${ano}`;
  return entrada === 'senado' ? `SF-${base}` : base;
}

/** Próximo número de minuta no ano: o maior já usado no registro, mais um. */
function niProximaMinuta(registros, ano) {
  let max = 0;
  for (const ch of Object.keys(registros || {})) {
    const m = new RegExp(`^${NI_SIGLA_TEXTO}-(\\d+)-${ano}$`).exec(ch);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Registro gravado em /analises_avulsas/{chave}. pedidoEm e pedidoPor são os campos que o bot já usa. */
function niRegistro({ entrada = 'camara', sigla, numero, ano, idCamara = null, ementa = '', titulo = '', responsavel = '' }, quem, agora = new Date()) {
  const limpo = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const r = { sigla, numero: String(numero), ano: String(ano), entrada, origem: 'painel',
    responsavel: limpo(responsavel || quem, 60), pedidoPor: limpo(quem, 60), pedidoEm: agora.toISOString() };
  if (idCamara) r.idCamara = Number(idCamara);
  if (ementa) r.ementa = limpo(ementa, 1200);
  if (titulo) r.titulo = limpo(titulo, 160);
  return r;
}

/** De quem é a nota: o responsável; sem ele, quem pediu (os registros do bot só têm pedidoPor). */
function niResponsavel(reg) { return String((reg && (reg.responsavel || reg.pedidoPor)) || '').trim(); }
function niDoServidor(reg, nome) { return niMesmoServidor(niResponsavel(reg), nome); }
function niEntrada(reg, chave = '') { return (reg && reg.entrada) || (/^SF-/.test(chave) ? 'senado' : new RegExp(`^${NI_SIGLA_TEXTO}-`).test(chave) ? 'texto' : 'camara'); }

function niRotulo(reg, chave = '') {
  const e = niEntrada(reg, chave);
  if (e === 'texto') return `Minuta ${reg.numero}/${reg.ano}`;
  return `${reg.sigla} ${reg.numero}/${reg.ano}${e === 'senado' ? ' (Senado)' : ''}`;
}

/** O item que o painel desenha (o mesmo formato de um item de pauta). */
function niItem(reg, chave) {
  const e = niEntrada(reg, chave);
  return {
    ordem: 1, tipoCategoria: /^(REQ|REC)$/.test(reg.sigla) ? 'requerimento' : 'projeto', sigla: reg.sigla, numero: String(reg.numero), ano: String(reg.ano), chave,
    ementa: reg.ementa || reg.titulo || '', autorTexto: '', apensadosTexto: [], relator: null, temUrgencia: false,
    adicionadoManualmente: true, analista: niResponsavel(reg),
    ...(e === 'senado' ? { fonteSenado: true } : {}),
    ...(e === 'texto' ? { textoProprio: { titulo: reg.titulo || reg.ementa || '' } } : {}),
  };
}

/** A nota mais recente entre as salvas para a proposição (uma por parecer). Devolve null se não há. */
function niNotaMaisRecente(porParecer) {
  const notas = Object.values(porParecer || {}).filter(a => a && typeof a === 'object' && (a.markdown || a.html));
  if (!notas.length) return null;
  const quando = a => String(a.editadoEm || a.geradoEm || '');
  return notas.sort((a, b) => quando(a).localeCompare(quando(b))).pop();
}

/** Linha da lista: o registro, mais o que a nota salva informa. `nota` é a mais recente (ou null). */
function niLinha(chave, reg, nota, temNTA = false) {
  return {
    chave, rotulo: niRotulo(reg, chave), entrada: niEntrada(reg, chave),
    descricao: (nota && nota.apelido) || reg.titulo || reg.ementa || '',
    responsavel: niResponsavel(reg) || (nota && nota.analista) || '',
    temNota: !!nota, temNTA: !!temNTA,
    revisada: !!(nota && nota.revisado), revisadaPor: (nota && nota.revisado && nota.revisado.por) || '',
    verificada: !!(nota && nota.verificacaoIA),
    atualizadaEm: (nota && (nota.editadoEm || nota.geradoEm)) || '', pedidaEm: reg.pedidoEm || '',
  };
}

/** Registro mínimo de uma nota que só existe no acervo das pautas (a chave é "PL-123-2025"). Devolve null para chave fora do padrão. */
function niRegistroDaChave(chave) {
  const m = /^(SF-)?([A-Z]+)-(\d+)-(\d{4})$/.exec(String(chave || ''));
  if (!m) return null;
  return { sigla: m[2], numero: m[3], ano: m[4], entrada: m[1] ? 'senado' : (m[2] === NI_SIGLA_TEXTO ? 'texto' : 'camara') };
}

/** Filtra as linhas pelo que foi digitado na busca (número, apelido, ementa, responsável). */
function niFiltrar(linhas, termo) {
  const t = niNorm(termo);
  if (!t) return linhas;
  return linhas.filter(l => niNorm(`${l.rotulo} ${l.descricao} ${l.responsavel} ${l.chave}`).includes(t));
}

/** Texto do aviso, no Plenário, de que a proposição já tem nota no acervo (feita para outro parecer ou fora da pauta). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NI_SIGLAS, NI_SIGLA_TEXTO, NI_ROTULO_SENADO, niNorm, niMesmoServidor, niListaServidores, niLerEntrada, niChave, niProximaMinuta,
    niRegistro, niResponsavel, niDoServidor, niEntrada, niRotulo, niItem, niNotaMaisRecente, niLinha, niRegistroDaChave, niFiltrar };
}

// ============================================================
//  TELA (só no navegador, dentro de analise.html)
// ============================================================
const NI_CAMINHO_REG = 'analises_avulsas';
const NI_CAMINHO_SERV = 'notas_individuais_servidores';
const ni = { eu: '', servidores: [], registros: {}, notas: {}, ntas: {}, visao: 'minhas', termo: '', aberta: null, equipe: null };

function niModoAtivo() {
  try { return new URLSearchParams(location.search).get('modo') === 'notas'; } catch (_) { return false; }
}
const niUrl = caminho => `${FIREBASE_URL}/${caminho}.json`;
const niDataBR = iso => { const d = new Date(iso || ''); return isNaN(d) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
async function niGet(caminho) { const r = await fetch(niUrl(caminho)); if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`); return r.json(); }
async function niPut(caminho, corpo) {
  const r = await fetch(niUrl(caminho), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
}

/** Ponto de entrada, chamado pelo analise.js no lugar de "listar pautas e abrir a última". */
async function niIniciar() {
  niMontarCasca();
  state.pauta = niPautaVazia();
  await niCarregarServidores();
  niMontarConfig();
  ni.eu = String(state.config?.nomeUsuario || '').trim();
  if (!ni.eu) await niEscolherServidor(true);
  await niRecarregar();
}

function niPautaVazia() {
  return { id: 'notas-individuais', titulo: 'Notas Técnicas Individuais', periodo: '', uploadedAt: new Date().toISOString(), uploadedBy: ni.eu, origem: 'avulsa', notaIndividual: true, itens: [] };
}

/** Troca o que é da pauta pelo que é do módulo: título, barra lateral, botões. */
function niMontarCasca() {
  document.title = 'Notas Técnicas Individuais — SisPode';
  document.body.classList.add('ni-modo');
  const t = document.querySelector('.header-main'); if (t) t.textContent = 'Notas Técnicas Individuais';
  document.getElementById('pauta-titulo').textContent = 'Notas Técnicas Individuais';
  document.getElementById('pauta-meta').textContent = '';
  const sb = document.getElementById('sidebar-pautas'); if (sb) sb.innerHTML = '';
  const st = document.querySelector('.an-sidebar-titulo'); if (st) st.textContent = 'Notas individuais';
  // O que só faz sentido com uma pauta carregada fica fora da tela (os botões continuam existindo: o analise.js os procura).
  ['btn-pauta-manual', 'btn-calendario-plen', 'btn-adicionar-item', 'btn-recategorizar', 'btn-gerar-todas', 'btn-prop-partido',
    'btn-resumo-sessao', 'btn-apelidos', 'btn-salvar-firebase', 'btn-renomear-pauta', 'busca-itens', 'btn-verificar-atualizacoes', 'btn-reverificar-falhas']
    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('ni-fora'); });
  const lab = document.querySelector('label[for="input-pauta-pdf"]'); if (lab) lab.classList.add('ni-fora');
  const acoes = document.querySelector('.an-topbar-actions');
  if (acoes && !document.getElementById('ni-busca')) {
    acoes.insertAdjacentHTML('afterbegin', `
      <input type="search" id="ni-busca" class="form-input" placeholder="Buscar por número, apelido, ementa ou responsável" style="min-width:320px;height:32px;font-size:12.5px">
      <button id="ni-nova" class="btn btn-primary btn-sm" title="Criar a nota de uma proposição, de uma matéria do Senado ou de um texto sem número">＋ Nova nota</button>
      <button id="ni-usar-pauta" class="btn btn-outline btn-sm" style="display:none" title="Incluir esta proposição em uma pauta do Plenário; a nota vai junto">📅 Usar em pauta</button>`);
    document.getElementById('ni-busca').addEventListener('input', e => { ni.termo = e.target.value; niDesenharLista(); });
    document.getElementById('ni-nova').addEventListener('click', () => niAbrirNovaNota());
    document.getElementById('ni-usar-pauta').addEventListener('click', ev => niMenuUsarEmPauta(ev.currentTarget));
  }
  const lista = document.getElementById('lista-itens');
  if (lista && !document.getElementById('ni-lista')) lista.insertAdjacentHTML('beforebegin', '<div id="ni-volta" class="ni-volta" style="display:none">← Voltar para a lista</div><div id="ni-lista"></div>');
  document.getElementById('ni-volta').addEventListener('click', () => niFecharNota());
}

// ---------- quem está usando ----------
async function niCarregarServidores() {
  let lista = [];
  // Falha de leitura NÃO é "lista vazia": sem a marca, a lista do Plenário aparecia como se fosse a do módulo e,
  // salva nas Configurações, apagava a lista gravada (varredura de 26/11/2026).
  try { lista = niListaServidores(await niGet(NI_CAMINHO_SERV)); ni.servidoresIlegivel = false; }
  catch (_) { ni.servidoresIlegivel = true; if ((ni.servidores || []).length) return ni.servidores; }   // fica com a última lista lida
  // Primeira vez: começa pela lista do Plenário, só como sugestão — ela passa a ser do módulo ao ser gravada.
  if (!lista.length) { try { lista = niListaServidores(await carregarServidores()); } catch (_) {} }
  ni.servidores = lista;
  return lista;
}
async function niSalvarServidores(lista) {
  // Não grava por cima de uma lista que não conseguiu ler: tenta ler de novo antes.
  if (ni.servidoresIlegivel) { await niCarregarServidores(); if (ni.servidoresIlegivel) throw new Error('não consegui ler a lista gravada no banco; para não gravar por cima dela às cegas, tente de novo em instantes'); }
  ni.servidores = niListaServidores(lista); await niPut(NI_CAMINHO_SERV, ni.servidores);
}

async function niGravarNome(nome) {
  ni.eu = nome;
  const cfg = await new Promise(r => chrome.storage.local.get('config', d => r(d.config || {})));
  cfg.nomeUsuario = nome;
  await new Promise(r => chrome.storage.local.set({ config: cfg }, r));
  state.config = { ...(state.config || {}), nomeUsuario: nome };
}

/**
 * Diálogo "Quem está usando?": só a escolha do nome. A lista é mantida em Configurações → "Servidores das notas
 * individuais" (niMontarConfig). Com `obrigatorio`, só fecha com um nome escolhido.
 */
function niEscolherServidor(obrigatorio = false) {
  return new Promise(resolve => {
    document.getElementById('ni-modal-servidor')?.remove();
    const o = document.createElement('div');
    o.id = 'ni-modal-servidor'; o.className = 'modal-overlay'; o.style.display = 'flex';
    o.innerHTML = `<div class="modal" style="max-width:460px;width:460px">
      <div class="modal-header"><h3>Quem está usando o módulo?</h3>${obrigatorio ? '' : '<button class="modal-close" data-ni="fechar">✕</button>'}</div>
      <div class="modal-body">
        <p class="config-desc">Escolha o seu nome: a tela abre nas suas notas, e as que você criar ficam no seu nome. O nome fica guardado neste navegador. Não é senha: serve para organizar, e qualquer servidor pode trocar de nome.</p>
        <div class="ni-serv-lista">${ni.servidores.length ? ni.servidores.map((n, i) => `
          <button class="btn btn-outline btn-sm ni-serv-nome ${niMesmoServidor(n, ni.eu) ? 'ativo' : ''}" data-ni="escolher" data-i="${i}">${escapeHtml(n)}</button>`).join('') : '<div class="ni-vazio">A lista de servidores do módulo está vazia.</div>'}</div>
        <p class="ni-dim" style="margin-top:14px">Seu nome não está na lista? Ela é mantida em <a href="#" data-ni="config">Configurações → Servidores das notas individuais</a>.</p>
      </div></div>`;
    const fechar = () => { o.remove(); resolve(ni.eu); };
    o.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-ni]'); if (!b) return;
      ev.preventDefault();
      if (b.dataset.ni === 'fechar') return fechar();
      if (b.dataset.ni === 'escolher') { await niGravarNome(ni.servidores[Number(b.dataset.i)]); return fechar(); }
      if (b.dataset.ni === 'config') {
        // As Configurações abrem no lugar deste diálogo; ao fechá-las, ele volta com a lista atualizada.
        o.remove();
        document.getElementById('btn-configuracoes').click(); selecionarAbaConfig('notas-servidores');
        const modal = document.getElementById('modal-configuracoes');
        const t = setInterval(() => { if (modal.style.display === 'none') { clearInterval(t); niEscolherServidor(obrigatorio).then(resolve); } }, 300);
      }
    });
    document.body.appendChild(o);
  });
}

/**
 * Configurações, no modo de notas: a aba "Servidores responsáveis" do Plenário (a que distribui os itens da pauta)
 * dá lugar à lista PRÓPRIA do módulo — há quem use as notas individuais sem ser da equipe de Plenário.
 */
function niMontarConfig() {
  const abaPlen = document.querySelector('.config-tab-btn[data-config-tab="servidores"]');
  if (!abaPlen || document.getElementById('ni-config-servidores')) return;
  abaPlen.style.display = 'none';
  abaPlen.insertAdjacentHTML('afterend', '<button type="button" class="config-tab-btn" data-config-tab="notas-servidores">Servidores das notas individuais</button>');
  document.querySelector('[data-config-panel="servidores"]').insertAdjacentHTML('afterend', `<div data-config-panel="notas-servidores" style="display:none">
    <div class="config-section">
      <div class="config-section-title">Servidores das notas individuais</div>
      <p class="config-desc">Quem usa o módulo de Notas Técnicas Individuais. É desta lista que cada servidor escolhe o nome ao abrir o módulo e o responsável ao criar uma nota. Um nome por linha. A lista é própria do módulo (não é a dos servidores do Plenário) e vale para toda a equipe. Tirar um nome não apaga as notas dele.</p>
      <textarea id="ni-config-servidores" class="form-input" rows="8" style="font-family:inherit;resize:vertical" placeholder="Um nome por linha"></textarea>
      <button id="ni-config-salvar" class="btn btn-outline" style="margin-top:10px">Salvar servidores</button>
      <div id="ni-config-st" style="font-size:11px;color:var(--text-dim);margin-top:6px;min-height:14px"></div>
    </div></div>`);
  document.querySelector('.config-tab-btn[data-config-tab="notas-servidores"]').addEventListener('click', () => selecionarAbaConfig('notas-servidores'));
  const preencher = () => {
    document.getElementById('ni-config-servidores').value = ni.servidores.join('\n');
    document.getElementById('ni-config-st').textContent = ni.servidoresIlegivel ? '⚠ Não consegui ler a lista gravada no banco: os nomes acima podem não ser os da equipe. Não será possível salvar até a leitura voltar.' : '';
  };
  // a cada abertura das Configurações, a lista mais recente (outro servidor pode ter mudado)
  document.getElementById('btn-configuracoes').addEventListener('click', () => { preencher(); niCarregarServidores().then(preencher).catch(() => {}); });
  document.getElementById('ni-config-salvar').addEventListener('click', async () => {
    const st = document.getElementById('ni-config-st');
    const lista = niListaServidores(document.getElementById('ni-config-servidores').value.split('\n'));
    if (!lista.length) { st.textContent = 'Informe ao menos um nome.'; return; }
    st.textContent = 'Salvando…';
    try { await niSalvarServidores(lista); preencher(); st.textContent = `✓ ${lista.length} servidor(es) salvos para a equipe.`; }
    catch (e) { st.textContent = 'Não foi possível salvar: ' + e.message; }
  });
  preencher();
}

// ---------- acervo ----------
/** Lê o registro das notas individuais e, de cada uma, a nota mais recente e se há NTA. */
async function niRecarregar() {
  const st = document.getElementById('ni-lista');
  if (st && !ni.aberta) st.innerHTML = '<div class="ni-vazio">Carregando as notas…</div>';
  try {
    ni.registros = (await niGet(NI_CAMINHO_REG)) || {};
    let ntas = {};
    try { ntas = (await fetch(`${FIREBASE_URL}/pareceres.json?shallow=true`).then(r => (r.ok ? r.json() : {}))) || {}; } catch (_) {}
    // /pareceres/{pauta}__{chave}: a NTA é por pauta. Para a lista basta saber se a proposição tem alguma; ao abrir,
    // vale a feita nas notas individuais e, sem ela, a de uma pauta.
    ni.ntas = {};
    for (const k of Object.keys(ntas)) { const ch = k.split('__')[1]; if (ch && (!ni.ntas[ch] || k === chaveParecerIndividual(ch))) ni.ntas[ch] = k; }
    await Promise.all(Object.keys(ni.registros).map(async ch => {
      try { ni.notas[ch] = niNotaMaisRecente(await niGet(`analises_pauta/${encodeURIComponent(ch)}`)); } catch (_) { /* a linha aparece sem os dados da nota */ }
    }));
  } catch (e) {
    if (st) st.innerHTML = `<div class="ni-vazio">Não consegui ler o acervo: ${escapeHtml(e.message)}. <a href="#" id="ni-tentar">Tentar de novo</a></div>`;
    document.getElementById('ni-tentar')?.addEventListener('click', ev => { ev.preventDefault(); niRecarregar(); });
    niDesenharLateral();
    return;
  }
  niDesenharLateral();
  if (!ni.aberta) niDesenharLista();
}

function niLinhasDaVisao() {
  if (ni.visao === 'equipe') {
    const acervo = ni.equipe || {};
    return Object.keys(acervo).filter(ch => !ni.registros[ch]).map(ch => { const reg = niRegistroDaChave(ch); return reg ? niLinha(ch, reg, niNotaMaisRecente(acervo[ch]), !!ni.ntas[ch]) : null; }).filter(Boolean);
  }
  return Object.entries(ni.registros)
    .filter(([, reg]) => reg && reg.sigla && (ni.visao === 'individuais' || niDoServidor(reg, ni.eu)))
    .map(([ch, reg]) => niLinha(ch, reg, ni.notas[ch] || null, !!ni.ntas[ch]));
}

function niDesenharLateral() {
  const side = document.querySelector('.an-sidebar'); if (!side) return;
  const regs = Object.values(ni.registros).filter(r => r && r.sigla);
  const minhas = regs.filter(r => niDoServidor(r, ni.eu)).length;
  const f = (id, rot, n) => `<div class="ni-filtro ${ni.visao === id ? 'ativo' : ''}" data-visao="${id}">${rot}${n == null ? '' : `<span>${n}</span>`}</div>`;
  side.innerHTML = `<div class="an-sidebar-head"><div class="an-sidebar-titulo">Notas individuais</div></div>
    <div class="an-sidebar-lista">
      <div class="ni-quem">👤 <b>${escapeHtml(ni.eu || 'sem nome')}</b> <a href="#" id="ni-trocar">trocar</a></div>
      ${f('minhas', 'Minhas notas', minhas)}${f('individuais', 'Todas as individuais', regs.length)}
      <div class="ni-grupo">Acervo da equipe</div>
      ${f('equipe', 'Notas das pautas do Plenário', ni.equipe ? Object.keys(ni.equipe).filter(ch => !ni.registros[ch]).length : null)}
      <div class="ni-nota-lateral">A nota é guardada por proposição: se ela entrar em uma pauta do Plenário, o item avisa que já existe nota no acervo.</div>
    </div>`;
  side.querySelector('#ni-trocar').addEventListener('click', async ev => { ev.preventDefault(); await niEscolherServidor(false); niDesenharLateral(); if (!ni.aberta) niDesenharLista(); });
  side.querySelectorAll('[data-visao]').forEach(el => el.addEventListener('click', () => niMudarVisao(el.dataset.visao)));
}

async function niMudarVisao(visao) {
  ni.visao = visao;
  if (ni.aberta) niFecharNota(false);
  if (visao === 'equipe' && !ni.equipe) {
    document.getElementById('ni-lista').innerHTML = '<div class="ni-vazio">Carregando as notas das pautas…</div>';
    // É o acervo inteiro (todas as notas da equipe): só é baixado quando alguém pede esta visão.
    try { ni.equipe = (await niGet('analises_pauta')) || {}; } catch (e) { ni.equipe = null; mostrarToast(`Não consegui ler o acervo da equipe: ${e.message}`, 'erro'); }
  }
  niDesenharLateral(); niDesenharLista();
}

function niDesenharLista() {
  const cont = document.getElementById('ni-lista'); if (!cont) return;
  document.getElementById('lista-itens').style.display = 'none';
  document.getElementById('ni-volta').style.display = 'none';
  document.getElementById('ni-usar-pauta').style.display = 'none';
  document.getElementById('ni-busca').style.display = '';
  cont.style.display = '';
  const todas = niLinhasDaVisao().sort((a, b) => String(b.atualizadaEm || b.pedidaEm).localeCompare(String(a.atualizadaEm || a.pedidaEm)));
  const linhas = niFiltrar(todas, ni.termo);
  const titulos = { minhas: `Minhas notas — ${ni.eu || 'sem nome'}`, individuais: 'Todas as notas individuais', equipe: 'Notas das pautas do Plenário' };
  document.getElementById('pauta-titulo').textContent = titulos[ni.visao];
  document.getElementById('pauta-meta').textContent = `${linhas.length} nota(s)${ni.termo && linhas.length !== todas.length ? ` de ${todas.length}` : ''}`;
  if (!linhas.length) {
    cont.innerHTML = `<div class="ni-vazio">${ni.termo ? 'Nenhuma nota com esse termo.' : ni.visao === 'minhas' ? 'Você ainda não tem notas individuais. Use <b>＋ Nova nota</b> para criar a primeira.' : 'Nenhuma nota aqui.'}</div>`;
    return;
  }
  const prod = (ok, rot) => `<span class="ni-prod ${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${rot}</span>`;
  cont.innerHTML = `<table class="ni-tab"><thead><tr><th>Proposição</th><th>Produtos</th><th>Responsável</th><th>Atualizada</th></tr></thead><tbody>${
    linhas.map(l => `<tr data-chave="${escapeHtml(l.chave)}" title="Abrir a nota">
      <td><div class="ni-prop">${escapeHtml(l.rotulo)}</div><div class="ni-desc">${escapeHtml(l.descricao || (l.temNota ? '' : 'nota ainda não gerada'))}</div></td>
      <td style="width:250px">${prod(l.temNota, 'Nota técnica')}${prod(l.temNTA, 'NTA')}${l.verificada ? '<span class="ni-prod rev">✔ Agente revisor</span>' : ''}${l.revisada ? `<span class="ni-prod rev">✓ Revisada${l.revisadaPor ? ' · ' + escapeHtml(l.revisadaPor) : ''}</span>` : ''}</td>
      <td style="width:160px">${escapeHtml(l.responsavel || '—')}</td>
      <td style="width:100px">${l.temNota ? niDataBR(l.atualizadaEm) : '—'}</td></tr>`).join('')}</tbody></table>`;
  cont.querySelectorAll('tr[data-chave]').forEach(tr => tr.addEventListener('click', () => niAbrirNota(tr.dataset.chave)));
}

// ---------- uma nota aberta ----------
/** Abre a nota como um card do Plenário: uma "pauta" de um item só, em memória (não é gravada). */
async function niAbrirNota(chave, { anexar = false } = {}) {
  const reg = ni.registros[chave] || niRegistroDaChave(chave);
  if (!reg) return mostrarToast('Não consegui abrir esta nota: a chave não segue o padrão das proposições.', 'erro');
  ni.aberta = chave;
  const rot = niRotulo(reg, chave);
  state.pauta = { ...niPautaVazia(), id: `nota-${chave}`.toLowerCase(), titulo: `Nota técnica — ${rot}`, itens: [normalizarItem(niItem(reg, chave))] };
  renderizarPauta();
  document.getElementById('ni-lista').style.display = 'none';
  document.getElementById('lista-itens').style.display = '';
  document.getElementById('ni-volta').style.display = '';
  document.getElementById('ni-usar-pauta').style.display = '';
  document.getElementById('ni-busca').style.display = 'none';
  document.getElementById('btn-renomear-pauta').style.display = 'none';
  document.getElementById('pauta-titulo').textContent = rot;
  document.getElementById('pauta-meta').textContent = ni.registros[chave] ? `Nota individual · responsável: ${niResponsavel(reg) || 'não informado'}` : 'Nota de pauta do Plenário, aberta do acervo da equipe';
  ['btn-exportar-pdf', 'btn-exportar-docx'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
  const it = state.pauta.itens[0];
  try { await enriquecerItem(it); } catch (e) { if (itemAindaAtivo(it)) { it.enriquecimento = { ...(it.enriquecimento || {}), status: 'erro', erro: e.message }; atualizarBadgesCard(it); } }
  if (!itemAindaAtivo(it)) return;
  niMarcarUrgencia(it).catch(() => {});
  if (ni.ntas[chave] && ni.ntas[chave] !== chaveParecer(it)) it._chaveParecer = ni.ntas[chave];   // NTA feita numa pauta
  carregarMetaParecer(it).catch(() => {});
  // A nota do parecer atual; sem ela, a mais recente da proposição (a que o Plenário ou o bot fez para outro parecer).
  try {
    let a = await fbCarregarAnalise(it);
    if (!a) a = niNotaMaisRecente(await niGet(`analises_pauta/${encodeURIComponent(chave)}`));
    if (a && itemAindaAtivo(it) && !it.analise && !_autosaveState.has(it.chave)) { it.analise = a; it.analiseStatus = 'ok'; renderAnaliseCard(it); completarApelidoFaltante(it); }
  } catch (e) { console.warn('[notas individuais] falha ao ler a nota salva:', e.message); }
  if (anexar && itemAindaAtivo(it)) abrirDocAnalista(it);
}

function niFecharNota(redesenhar = true) {
  ni.aberta = null;
  state.pauta = niPautaVazia();
  renderizarPauta();
  if (redesenhar) niRecarregar();
}

/** Regime de tramitação na Câmara: com urgência, o card ganha o selo (no Plenário ele vem da pauta; aqui, da ficha). */
async function niMarcarUrgencia(it) {
  const id = it.enriquecimento?.idProposicao; if (!id) return;
  const det = await fetchJson(`${API_BASE}/proposicoes/${id}`);
  const regime = String(det?.dados?.statusProposicao?.regime || '');
  if (!/urg[êe]ncia/i.test(regime) || !itemAindaAtivo(it)) return;
  it.temUrgencia = true; it.regimeTramitacao = regime;
  const cont = document.querySelector(`.an-card[data-chave="${it.chave}"] [data-rolebadges]`);
  if (cont && !cont.querySelector('[data-role=ni-urg]')) cont.insertAdjacentHTML('afterbegin', `<span class="an-badge an-badge--urg" data-role="ni-urg" title="Regime de tramitação na Câmara">${escapeHtml(regime)}</span>`);
}

/** O card mudou o responsável: o registro da nota individual acompanha (é por ele que a nota entra em "Minhas notas"). */
function niAoMudarResponsavel(it) {
  const reg = ni.registros[it.chave]; if (!reg) return;
  reg.responsavel = it.analista || '';
  niPut(`${NI_CAMINHO_REG}/${encodeURIComponent(it.chave)}/responsavel`, reg.responsavel).catch(e => mostrarToast(`Não consegui gravar o responsável: ${e.message}`, 'erro'));
  const meta = document.getElementById('pauta-meta'); if (meta && ni.aberta === it.chave) meta.textContent = `Nota individual · responsável: ${reg.responsavel || 'não informado'}`;
}

/** "Remover" no card: tira a proposição das notas individuais. A nota em si não é apagada aqui (pode estar em uso numa pauta). */
async function niAoRemover(it) {
  const era = !!ni.registros[it.chave];
  if (era) {
    try { const r = await fetch(niUrl(`${NI_CAMINHO_REG}/${encodeURIComponent(it.chave)}`), { method: 'DELETE' }); if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`); delete ni.registros[it.chave]; }
    catch (e) { mostrarToast(`Não consegui tirar a nota da lista: ${e.message}`, 'erro'); }
  }
  mostrarToast(era ? 'Nota tirada das notas individuais.' : 'Nota fechada.', 'sucesso');
  niFecharNota();
}

// ---------- nova nota ----------
function niAbrirNovaNota() {
  document.getElementById('ni-modal-nova')?.remove();
  const o = document.createElement('div');
  o.id = 'ni-modal-nova'; o.className = 'modal-overlay'; o.style.display = 'flex';
  const opcoes = lista => lista.map(s => `<option value="${s}">${s}</option>`).join('');
  const resp = [...new Set([ni.eu, ...ni.servidores].filter(Boolean))];
  o.innerHTML = `<div class="modal" style="max-width:680px;width:680px">
    <div class="modal-header"><h3>Nova nota técnica individual</h3><button class="modal-close" data-ni="fechar">✕</button></div>
    <div class="modal-body">
      <div class="ni-abas">
        <span class="ni-aba ativa" data-aba="numero">Número ou link</span><span class="ni-aba" data-aba="busca">Consultar a Câmara</span>
        <span class="ni-aba" data-aba="senado">Matéria do Senado</span><span class="ni-aba" data-aba="texto">Texto sem número</span>
      </div>
      <div data-painel="numero">
        <div class="form-group"><label>Proposição da Câmara</label>
          <div style="display:flex;gap:8px"><input id="ni-n-texto" class="form-input" placeholder="PL 1234/2025, ou o link da ficha de tramitação"><button class="btn btn-outline btn-sm" data-ni="buscar-numero">Buscar</button></div></div>
      </div>
      <div data-painel="busca" style="display:none">
        <div class="form-group"><label>Palavras para procurar na base da Câmara (ementa, indexação, autor)</label>
          <div style="display:flex;gap:8px"><input id="ni-b-texto" class="form-input" placeholder="ex.: mercados digitais concorrência"><button class="btn btn-outline btn-sm" data-ni="buscar-palavras">Buscar</button></div></div>
        <div id="ni-b-result" class="ni-result"></div>
      </div>
      <div data-painel="senado" style="display:none">
        <p class="config-desc">Para matéria que tramita no Senado e ainda não chegou à Câmara. A nota usa os documentos do Senado e avisa que o texto pode mudar.</p>
        <div class="ni-linha3">
          <div class="form-group"><label>Tipo</label><select id="ni-s-sigla" class="form-input">${opcoes(SENADO_SIGLAS)}</select></div>
          <div class="form-group"><label>Número</label><input id="ni-s-numero" class="form-input" inputmode="numeric"></div>
          <div class="form-group"><label>Ano</label><input id="ni-s-ano" class="form-input" inputmode="numeric" value="${new Date().getFullYear()}"></div>
        </div>
        <button class="btn btn-outline btn-sm" data-ni="buscar-senado">Buscar no Senado</button>
      </div>
      <div data-painel="texto" style="display:none">
        <p class="config-desc">Para minuta, anteprojeto ou outro texto que ainda não tem número. A nota é feita sobre o PDF ou o link que você anexar em seguida.</p>
        <div class="form-group"><label>Título</label><input id="ni-t-titulo" class="form-input" maxlength="160" placeholder="ex.: Minuta de projeto sobre aviação agrícola"></div>
        <div class="form-group"><label>Do que trata (opcional)</label><input id="ni-t-ementa" class="form-input" maxlength="600"></div>
      </div>
      <div id="ni-achado" class="ni-achado" style="display:none"></div>
      <div class="form-group" style="margin-top:12px"><label>Responsável</label><select id="ni-resp" class="form-input">${resp.map(n => `<option ${niMesmoServidor(n, ni.eu) ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></div>
      <div id="ni-nova-st" class="ni-st"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost btn-sm" data-ni="fechar">Cancelar</button><button class="btn btn-primary btn-sm" data-ni="criar" disabled>Criar a nota</button></div>
  </div>`;
  let achado = null, aba = 'numero';
  const $ = s => o.querySelector(s);
  const st = t => { $('#ni-nova-st').textContent = t || ''; };
  const mostrarAchado = a => {
    achado = a;
    const el = $('#ni-achado');
    if (!a) { el.style.display = 'none'; $('[data-ni=criar]').disabled = !(aba === 'texto' && $('#ni-t-titulo').value.trim().length >= 5); return; }
    const ja = ni.registros[a.chave], nota = ni.notas[a.chave];
    el.innerHTML = `<b>✓ ${escapeHtml(a.rotulo)}</b>${a.ementa ? ' — ' + escapeHtml(a.ementa) : ''}${a.detalhe ? `<br><span class="ni-dim">${escapeHtml(a.detalhe)}</span>` : ''}
      <br><span class="ni-dim">${ja ? `Já está nas notas individuais, em nome de ${escapeHtml(niResponsavel(ja) || 'ninguém')}${nota ? `; a nota é de ${niDataBR(nota.editadoEm || nota.geradoEm)}` : '; ainda sem nota'}. Criar vai abrir a que existe.` : 'Ainda não está nas notas individuais.'}</span>`;
    el.style.display = '';
    $('[data-ni=criar]').disabled = false;
    $('[data-ni=criar]').textContent = ja ? 'Abrir a nota' : 'Criar a nota';
  };
  const trocarAba = nova => {
    aba = nova; mostrarAchado(null); st('');
    o.querySelectorAll('.ni-aba').forEach(x => x.classList.toggle('ativa', x.dataset.aba === nova));
    o.querySelectorAll('[data-painel]').forEach(x => { x.style.display = x.dataset.painel === nova ? '' : 'none'; });
    $('[data-ni=criar]').textContent = 'Criar a nota';
  };
  const daCamara = d => ({ entrada: 'camara', sigla: d.sigla, numero: String(d.numero), ano: String(d.ano), idCamara: d.id || null, ementa: d.ementa || '',
    chave: niChave({ sigla: d.sigla, numero: d.numero, ano: d.ano }), rotulo: `${d.sigla} ${d.numero}/${d.ano}`, detalhe: d.detalhe || '' });

  o.addEventListener('click', async ev => {
    const abaEl = ev.target.closest('.ni-aba'); if (abaEl) return trocarAba(abaEl.dataset.aba);
    const escolha = ev.target.closest('[data-hit]');
    if (escolha) { mostrarAchado(daCamara(JSON.parse(escolha.dataset.hit))); $('#ni-achado').scrollIntoView({ block: 'nearest' }); return; }
    const b = ev.target.closest('[data-ni]'); if (!b) return;
    if (b.dataset.ni === 'fechar') return o.remove();
    b.disabled = true;
    try {
      if (b.dataset.ni === 'buscar-numero') {
        const e = niLerEntrada($('#ni-n-texto').value);
        if (!e) { st('Não entendi. Escreva como "PL 1234/2025" ou cole o link da ficha de tramitação na Câmara.'); return; }
        st('Procurando na Câmara…'); mostrarAchado(null);
        let d;
        if (e.idCamara) {
          const det = (await fetchJson(`${API_BASE}/proposicoes/${e.idCamara}`)).dados || {};
          if (!det.siglaTipo) throw new Error('a Câmara não devolveu a proposição desse link');
          d = { sigla: det.siglaTipo, numero: det.numero, ano: det.ano, id: det.id, ementa: det.ementa || '' };
        } else {
          const p = await resolveProposicao(e.sigla, e.numero, e.ano);
          d = { ...e, id: p.id, ementa: p.ementa || '' };
        }
        if (!NI_SIGLAS.includes(d.sigla)) { st(`${d.sigla} não é um tipo de proposição que o módulo analisa (${NI_SIGLAS.join(', ')}).`); return; }
        st(''); mostrarAchado(daCamara(d));
      }
      if (b.dataset.ni === 'buscar-palavras') {
        const q = $('#ni-b-texto').value.replace(/\s+/g, ' ').trim();
        if (q.length < 3) { st('Escreva ao menos uma palavra.'); return; }
        st('Procurando na base da Câmara…'); mostrarAchado(null);
        const lido = niLerEntrada(q);
        const consulta = lido && lido.sigla ? `siglaProposicao:${lido.sigla} AND numero:${lido.numero} AND ano:${lido.ano}` : `(${q}) AND siglaProposicao:(${NI_SIGLAS.join(' OR ')})`;
        const hits = (await buscaPortalProposicoes(consulta)).filter(h => NI_SIGLAS.includes(String(h.siglaProposicao).toUpperCase())).slice(0, 12);
        st(hits.length ? '' : 'Nada encontrado com essas palavras.');
        $('#ni-b-result').innerHTML = hits.map(h => {
          const autores = (h.autores || []).filter(a => a.bolAutorExibir !== false).slice(0, 2).map(a => `${a.nome}${a.siglaPartido ? ` (${a.siglaPartido}${a.siglaUF ? '-' + a.siglaUF : ''})` : ''}`).join(', ');
          const d = { sigla: String(h.siglaProposicao).toUpperCase(), numero: h.numero, ano: h.ano, id: h.id, ementa: h.ementa || '', detalhe: [autores && `Autor: ${autores}${(h.qtdeDeAutores || 0) > 2 ? ' e outros' : ''}`, h.txtRegime && `Regime: ${h.txtRegime}`].filter(Boolean).join(' · ') };
          return `<div class="ni-hit" data-hit="${escapeHtml(JSON.stringify(d))}"><b>${d.sigla} ${d.numero}/${d.ano}</b> — ${escapeHtml(d.ementa.slice(0, 220))}<div class="ni-dim">${escapeHtml(d.detalhe)}</div></div>`;
        }).join('');
      }
      if (b.dataset.ni === 'buscar-senado') {
        const sigla = $('#ni-s-sigla').value, numero = String(parseInt($('#ni-s-numero').value, 10) || ''), ano = $('#ni-s-ano').value.trim();
        if (!numero || !/^\d{4}$/.test(ano)) { st('Informe número e ano (4 dígitos).'); return; }
        st('Procurando no Senado…'); mostrarAchado(null);
        const sen = await senadoBuscar({ sigla, numero, ano }, fetchJson);
        if (!sen) { st(`O Senado não tem ${sigla} ${numero}/${ano}.`); return; }
        st('');
        mostrarAchado({ entrada: 'senado', sigla, numero, ano, ementa: sen.ementa || '', chave: niChave({ entrada: 'senado', sigla, numero, ano }), rotulo: `${sigla} ${numero}/${ano} (Senado)`,
          detalhe: [sen.autor && `Autor: ${sen.autor}`, sen.situacao && `Situação: ${sen.situacao}`, `${(sen.documentos || []).length} documento(s) para a análise`].filter(Boolean).join(' · ') });
      }
      if (b.dataset.ni === 'criar') {
        let a = achado;
        if (aba === 'texto') {
          const titulo = $('#ni-t-titulo').value.replace(/\s+/g, ' ').trim();
          if (titulo.length < 5) { st('Dê um título ao texto.'); return; }
          // relê o registro na hora: o número da minuta sai do maior já usado, e outro servidor pode ter criado uma agora
          try { ni.registros = (await niGet(NI_CAMINHO_REG)) || ni.registros; } catch (_) {}
          const ano = String(new Date().getFullYear()), numero = String(niProximaMinuta(ni.registros, ano));
          a = { entrada: 'texto', sigla: NI_SIGLA_TEXTO, numero, ano, titulo, ementa: $('#ni-t-ementa').value.trim() || titulo, chave: niChave({ sigla: NI_SIGLA_TEXTO, numero, ano }) };
        }
        if (!a) return;
        if (!ni.registros[a.chave]) {
          st('Gravando…');
          // Confere NO BANCO, não só na lista carregada ao abrir a tela: outro servidor pode ter registrado esta
          // proposição nesse meio-tempo, e gravar por cima trocava o responsável dele pelo daqui, sem aviso.
          let jaLa = await niGet(`${NI_CAMINHO_REG}/${encodeURIComponent(a.chave)}`);
          for (let t = 0; jaLa && a.entrada === 'texto' && t < 3; t++) {   // minuta: o número foi tomado agora; pega o seguinte
            ni.registros[a.chave] = jaLa;
            const numero = String(niProximaMinuta(ni.registros, a.ano));
            a = { ...a, numero, chave: niChave({ sigla: NI_SIGLA_TEXTO, numero, ano: a.ano }) };
            jaLa = ni.registros[a.chave] || await niGet(`${NI_CAMINHO_REG}/${encodeURIComponent(a.chave)}`);
          }
          if (jaLa) {
            ni.registros[a.chave] = jaLa;
            if (a.entrada === 'texto') throw new Error('não consegui um número livre para a minuta; tente de novo');
            const resp = niResponsavel(jaLa);
            mostrarToast(`Esta proposição já tinha nota individual${resp ? `, com ${resp}` : ''}: abri a que existe, sem mudar o responsável.`, 'info');
          } else {
            const reg = niRegistro({ ...a, responsavel: $('#ni-resp').value }, ni.eu);
            await niPut(`${NI_CAMINHO_REG}/${encodeURIComponent(a.chave)}`, reg);
            ni.registros[a.chave] = reg;
          }
        }
        o.remove();
        niDesenharLateral();
        await niAbrirNota(a.chave, { anexar: a.entrada === 'texto' });
      }
    } catch (e) { st(`Não deu certo: ${e.message}`); }
    finally { b.disabled = b.dataset.ni === 'criar' ? !(achado || (aba === 'texto' && $('#ni-t-titulo').value.trim().length >= 5)) : false; }
  });
  o.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    const alvo = { 'ni-n-texto': 'buscar-numero', 'ni-b-texto': 'buscar-palavras', 'ni-s-numero': 'buscar-senado', 'ni-s-ano': 'buscar-senado' }[ev.target.id];
    if (alvo) $(`[data-ni=${alvo}]`).click();
  });
  o.addEventListener('input', ev => { if (ev.target.id === 'ni-t-titulo') $('[data-ni=criar]').disabled = ev.target.value.trim().length < 5; });
  document.body.appendChild(o);
  $('#ni-n-texto').focus();
}

// ---------- usar em pauta ----------
/** Lista as pautas salvas mais recentes e inclui a proposição na escolhida. */
async function niMenuUsarEmPauta(botao) {
  document.getElementById('ni-menu-pauta')?.remove();
  const chave = ni.aberta; if (!chave) return;
  let pautas = [];
  try {
    const d = (await niGet('pautas')) || {};
    pautas = Object.entries(d).map(([id, p]) => ({ id, ...p })).filter(p => Array.isArray(p.itens)).sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)).slice(0, 8);
  } catch (e) { return mostrarToast(`Não consegui ler as pautas: ${e.message}`, 'erro'); }
  if (!pautas.length) return mostrarToast('Não há pauta salva para receber a proposição.', 'aviso');
  const r = botao.getBoundingClientRect();
  const m = document.createElement('div');
  m.id = 'ni-menu-pauta'; m.className = 'ni-menu';
  m.style.top = `${r.bottom + 6 + window.scrollY}px`; m.style.left = `${Math.max(8, r.right - 340)}px`;
  m.innerHTML = '<div class="h">Incluir a proposição em uma pauta</div>' + pautas.map(p => {
    const ja = p.itens.some(i => i && i.chave === chave);
    return `<div class="op ${ja ? 'ja' : ''}" data-pid="${escapeHtml(p.id)}">${escapeHtml(p.nome || p.titulo || p.id)}<small>${p.itens.length} itens${ja ? ' · a proposição já está nesta pauta' : ''}</small></div>`;
  }).join('');
  document.body.appendChild(m);
  const fechar = ev => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', fechar); } };
  setTimeout(() => document.addEventListener('mousedown', fechar), 0);
  m.querySelectorAll('.op:not(.ja)').forEach(el => el.addEventListener('click', async () => {
    m.remove(); document.removeEventListener('mousedown', fechar);
    try { const nome = await niIncluirEmPauta(chave, el.dataset.pid); mostrarToast(`✓ Incluída em "${nome}". No Plenário, o item avisa que já existe nota no acervo.`, 'sucesso'); }
    catch (e) { mostrarToast(`Não consegui incluir na pauta: ${e.message}`, 'erro'); }
  }));
}

/** Acrescenta o item ao fim da pauta salva (lê a pauta na hora, para não gravar por cima de mudança de outro servidor). */
async function niIncluirEmPauta(chave, idPauta) {
  const reg = ni.registros[chave] || niRegistroDaChave(chave);
  const caminho = `pautas/${encodeURIComponent(idPauta)}`;
  const p = await niGet(caminho);
  if (!p || !Array.isArray(p.itens)) throw new Error('a pauta não existe mais');
  if (p.itens.some(i => i && i.chave === chave)) return p.nome || p.titulo || idPauta;
  const aberto = state.pauta?.itens?.find(i => i.chave === chave);
  const ordem = p.itens.reduce((mx, i) => Math.max(mx, Number(i?.ordem) || 0), 0) + 1;
  const item = { ...niItem(reg, chave), ordem, ementa: aberto?.ementa || reg.ementa || reg.titulo || '', autorTexto: aberto?.autorTexto || '', temUrgencia: !!aberto?.temUrgencia, provisorio: aberto?.provisorio || null };
  await niPut(`${caminho}/itens/${p.itens.length}`, item);
  return p.nome || p.titulo || idPauta;
}
