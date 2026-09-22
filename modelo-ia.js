// Configurações de IA do módulo de Relatórios: provedor, chave e modelo.
//
// Mesmo desenho das outras telas (pautas-comissoes, analise): engrenagem na
// barra do topo, modal com provedor, chave, modelo e botão de salvar. E, como
// lá, o que se grava aqui é a configuração DO APLICATIVO — mudar aqui muda no
// resto. Não é ajuste local deste módulo.
//
// A razão de existir é o caso de quem reinstala ou reseta e entra direto neste
// módulo: sem isto, ele não tem por onde cadastrar chave nenhuma sem sair daqui,
// e as três camadas de IA da aba "Como votou o deputado" simplesmente não
// funcionam, sem dizer por quê.
//
// A LISTA DE MODELOS NÃO É BUSCADA SOZINHA. Abre-se com a lista de reserva do
// programa, que é instantânea, e a lista viva do provedor vem só quando o
// analista clica em "Carregar disponíveis" — que é como as outras telas fazem.
// Buscar no carregamento deixaria o campo travado esperando rede para mostrar
// uma escolha que, na maioria das vezes, já estava feita.
//
// O botão de testar a busca é o acréscimo desta tela, e tem motivo medido: a
// repercussão depende de o modelo acionar a ferramenta de busca, e nem toda
// combinação de modelo e pedido aciona. Ranking por nome não responde isso;
// uma chamada de verdade responde. O resultado fica guardado por modelo.
//
// Depende de ia-comum.js (PROVEDORES_META, chamarIA) e aderencia.js (cvEsc).

const MDL_CHAVE_TESTE = 'buscaWeb';   // onde o resultado dos testes fica guardado

const mdl = { cfg: null, modelos: [], ocupado: false };
const mdlEl = {};

const MDL_IDS = ['cvIaProvedor', 'cvIaChave', 'cvIaChaveDica', 'cvIaModelo', 'cvIaListar',
                 'cvIaModeloEstado', 'cvIaTestar', 'cvIaEstado', 'cvIaCampo', 'cvIaSalvar',
                 'cvIaCancelar', 'btn-config-ia', 'modalIa', 'modalIaFechar'];

function mdlPegarEl() {
  for (const id of MDL_IDS) mdlEl[id] = document.getElementById(id);
  return !!mdlEl.cvIaModelo;
}

function mdlLerConfig() {
  return new Promise(r => {
    try { chrome.storage.local.get('config', d => r(d.config || {})); } catch (e) { r({}); }
  });
}

function mdlGravarConfig(cfg) {
  return new Promise(r => {
    try { chrome.storage.local.set({ config: cfg }, () => { mdl.cfg = cfg; r(cfg); }); }
    catch (e) { r(null); }
  });
}

/** A chave do provedor, com a mesma regra do resto do aplicativo. */
function mdlChaveDe(pid, cfg) {
  const c = cfg || mdl.cfg || {};
  return (c.chaves && c.chaves[pid]) || (c.provedor === pid ? c.apiKey : '') || '';
}

/** O que já se mediu sobre a busca de cada modelo: { "<pid>/<modelo>": {ok, em} } */
function mdlTestes(cfg) { return ((cfg || mdl.cfg || {})[MDL_CHAVE_TESTE]) || {}; }

function mdlSelo(pid, modelo, cfg) {
  const t = mdlTestes(cfg)[`${pid}/${modelo}`];
  return t ? { ok: t.ok, em: t.em } : null;
}

/** Marca uma opção sem usar `select.value`, que o ambiente de teste não implementa. */
function mdlMarcar(sel, valor) {
  if (!sel) return;
  const alvo = valor && sel.querySelector(`option[value="${String(valor).replace(/"/g, '\\"')}"]`);
  if (alvo) alvo.selected = true;
  else if (sel.options && sel.options.length) sel.options[0].selected = true;
}

function mdlValorSel(sel) {
  if (!sel) return '';
  if (sel.value) return sel.value;                       // navegador
  const o = sel.querySelector('option[selected]') || (sel.options && sel.options[0]);
  return o ? (o.getAttribute('value') || '') : '';       // linkedom
}

/**
 * Monta a lista de modelos. `lista` é a de reserva ou a viva; o modelo salvo
 * entra à força quando não aparece nela, para uma lista desatualizada não apagar
 * em silêncio a escolha que o analista já tinha feito.
 */
function mdlMontarModelos(pid, lista, escolher) {
  if (!mdlEl.cvIaModelo) return;
  const testes = mdlTestes();
  const ids = (lista || []).map(m => m.id);
  const salvo = escolher || ((mdl.cfg || {}).provedor === pid ? (mdl.cfg || {}).modelo : '') || '';
  const itens = (salvo && !ids.includes(salvo))
    ? [{ id: salvo, displayName: salvo + ' (salvo)' }].concat(lista || [])
    : (lista || []);
  mdlEl.cvIaModelo.innerHTML = itens.map(m => {
    const s = testes[`${pid}/${m.id}`];
    const marca = s ? (s.ok ? ' · busca ✓' : ' · não busca ✗') : '';
    return `<option value="${cvEsc(m.id)}">${cvEsc(m.displayName || m.id)}${marca}</option>`;
  }).join('') || '<option value="">nenhum modelo</option>';
  mdl.modelos = itens;
  mdlMarcar(mdlEl.cvIaModelo, salvo);
  mdlPintarTeste();
}

/** A frase sobre a busca do modelo selecionado. */
function mdlPintarTeste() {
  if (!mdlEl.cvIaEstado) return;
  const pid = mdlValorSel(mdlEl.cvIaProvedor);
  const modelo = mdlValorSel(mdlEl.cvIaModelo);
  const chave = mdlEl.cvIaChave ? String(mdlEl.cvIaChave.value || '').trim() : '';
  if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.disabled = !modelo || !chave || mdl.ocupado;

  const s = modelo ? mdlSelo(pid, modelo, mdl.cfg) : null;
  const quando = s && s.em ? ` (testado em ${cvEsc(new Date(s.em).toLocaleDateString('pt-BR'))})` : '';
  mdlEl.cvIaEstado.innerHTML = !modelo ? ''
    : !s ? 'Busca na web ainda não testada neste modelo. Nem todo pedido faz o modelo acionar a '
           + 'ferramenta, e isso não se sabe pelo nome — a repercussão depende disso.'
    : s.ok ? `<b class="bom">Fez a busca na web</b>${quando}.`
    : `<b class="ruim">NÃO fez a busca na web</b>${quando}. O resumo e a sustentação funcionam; `
      + 'a repercussão vai depender de um modelo de reserva.';

  const eng = mdlEl['btn-config-ia'];
  if (eng) {
    eng.title = modelo
      ? `Configurações de IA — ${pid}/${modelo}${s ? (s.ok ? ' (busca testada)' : ' (não faz busca na web)') : ''}`
      : 'Configurações de IA dos relatórios';
  }
}

/**
 * Troca de provedor: chave, dica e lista de RESERVA. Nada de rede aqui — a lista
 * viva só vem no clique, como nas outras telas.
 */
function mdlTrocarProvedor(pid) {
  const p = PROVEDORES_META[pid] || {};
  if (mdlEl.cvIaChave) {
    mdlEl.cvIaChave.placeholder = p.placeholderChave || '';
    mdlEl.cvIaChave.value = mdlChaveDe(pid);
  }
  if (mdlEl.cvIaChaveDica) mdlEl.cvIaChaveDica.textContent = p.hintChave || '';
  mdlMontarModelos(pid, p.modelosFallback || []);
  if (mdlEl.cvIaModeloEstado) {
    mdlEl.cvIaModeloEstado.className = 'ia-dica';
    mdlEl.cvIaModeloEstado.textContent = mdlChaveDe(pid)
      ? 'Lista de reserva do programa. Clique em "Carregar disponíveis" para ver os modelos que a sua chave oferece hoje.'
      : 'Nenhuma chave deste provedor. Cole a chave acima e clique em "Carregar disponíveis".';
  }
}

/** A lista viva do provedor, só no clique. */
async function mdlListarModelos() {
  const pid = mdlValorSel(mdlEl.cvIaProvedor);
  const chave = mdlEl.cvIaChave ? String(mdlEl.cvIaChave.value || '').trim() : '';
  const est = mdlEl.cvIaModeloEstado;
  if (!chave) {
    if (est) { est.className = 'ia-dica ruim'; est.textContent = 'Cole a chave de API acima antes de listar.'; }
    return null;
  }
  if (est) { est.className = 'ia-dica'; est.textContent = 'Listando modelos…'; }
  mdl.ocupado = true;
  try {
    const lista = await PROVEDORES_META[pid].listar(chave);
    if (mdlValorSel(mdlEl.cvIaProvedor) !== pid) return null;   // trocou enquanto carregava
    mdlMontarModelos(pid, lista);
    if (est) { est.className = 'ia-dica bom'; est.textContent = `✓ ${lista.length} modelo(s) disponíveis nesta chave.`; }
    return lista;
  } catch (e) {
    // Lista que não veio não impede trabalhar: a de reserva continua servindo, e
    // o analista fica sabendo o que houve em vez de ficar com um campo vazio.
    if (est) {
      est.className = 'ia-dica ruim';
      est.textContent = `Não consegui listar (${e.message}). A lista continua sendo a de reserva do programa, que pode estar desatualizada.`;
    }
    return null;
  } finally {
    mdl.ocupado = false;
    mdlPintarTeste();
  }
}

/**
 * Faz UMA chamada de verdade e vê se o modelo acionou a busca.
 *
 * É medição, não dedução. A pergunta pede fato recente de propósito: um modelo
 * que ache que sabe a resposta não busca, e é esse comportamento que precisa
 * aparecer aqui, e não na hora em que o analista monta o documento.
 */
async function mdlTestarBusca() {
  const pid = mdlValorSel(mdlEl.cvIaProvedor);
  const modelo = mdlValorSel(mdlEl.cvIaModelo);
  const chave = mdlEl.cvIaChave ? String(mdlEl.cvIaChave.value || '').trim() : '';
  if (!modelo || !chave) return null;

  mdl.ocupado = true;
  if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.disabled = true;
  if (mdlEl.cvIaEstado) mdlEl.cvIaEstado.textContent = 'Testando a busca com uma chamada de verdade…';

  let ok = false, erro = null;
  try {
    const r = await chamarIA({
      provedorId: pid, apiKey: chave, modelo, web: true,
      prompt: 'Pesquise na web e responda em uma frase: qual foi a matéria mais recente '
            + 'aprovada pelo Plenário da Câmara dos Deputados? Cite a fonte.',
      opcoes: { maxSaida: 2000 },
    });
    ok = !!(r && r.fontes && r.fontes.length);
  } catch (e) { erro = e.message; }

  mdl.ocupado = false;
  if (erro) {
    if (mdlEl.cvIaEstado) mdlEl.cvIaEstado.innerHTML = `<b class="ruim">O teste falhou:</b> ${cvEsc(erro)}.`;
    if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.disabled = false;
    return { ok: false, erro };
  }

  const cfg = Object.assign({}, mdl.cfg || {});
  cfg[MDL_CHAVE_TESTE] = Object.assign({}, mdlTestes(), { [`${pid}/${modelo}`]: { ok, em: Date.now() } });
  await mdlGravarConfig(cfg);
  mdlMontarModelos(pid, mdl.modelos, modelo);   // reescreve o ✓/✗ na lista
  return { ok };
}

/**
 * Salva no mesmo lugar que as outras telas. A chave passa pelo formato do
 * provedor antes: chave colada errada só apareceria na primeira consulta, como
 * um erro do provedor que não diz o que houve.
 */
async function mdlSalvar() {
  const pid = mdlValorSel(mdlEl.cvIaProvedor);
  const p = PROVEDORES_META[pid] || {};
  const chave = mdlEl.cvIaChave ? String(mdlEl.cvIaChave.value || '').trim() : '';
  const modelo = mdlValorSel(mdlEl.cvIaModelo);
  const est = mdlEl.cvIaModeloEstado;
  const recusar = msg => { if (est) { est.className = 'ia-dica ruim'; est.textContent = msg; } return null; };

  if (!chave) return recusar('Informe a chave de API.');
  if (p.regexChave && !p.regexChave.test(chave)) return recusar(`Chave com formato inválido para ${p.label}.`);

  const c = mdl.cfg || {};
  const chaves = Object.assign({}, c.chaves || {});
  // Preserva a chave do provedor anterior antes de trocar: quem experimenta
  // outro provedor e volta não deveria ter de colar a chave de novo.
  if (c.apiKey && c.provedor && !chaves[c.provedor]) chaves[c.provedor] = c.apiKey;
  chaves[pid] = chave;

  await mdlGravarConfig(Object.assign({}, c, { provedor: pid, apiKey: chave, modelo, chaves }));
  if (est) { est.className = 'ia-dica bom'; est.textContent = '✓ Configurações salvas.'; }
  mdlAbrir(false);
  return { pid, modelo };
}

function mdlAbrir(v) {
  if (mdlEl.modalIa) mdlEl.modalIa.hidden = !v;
}

/** Liga o bloco. Chamado uma vez, quando a tela monta. */
async function mdlIniciar() {
  if (!mdlPegarEl()) return;
  mdl.cfg = await mdlLerConfig();

  if (mdlEl.cvIaProvedor) {
    mdlEl.cvIaProvedor.innerHTML = Object.keys(PROVEDORES_META).map(p =>
      `<option value="${p}">${cvEsc(PROVEDORES_META[p].label)}${mdlChaveDe(p) ? '' : ' — sem chave'}</option>`).join('');
    mdlMarcar(mdlEl.cvIaProvedor, mdl.cfg.provedor || 'gemini');
    mdlEl.cvIaProvedor.addEventListener('change', () => mdlTrocarProvedor(mdlValorSel(mdlEl.cvIaProvedor)));
  }
  if (mdlEl.cvIaModelo) mdlEl.cvIaModelo.addEventListener('change', mdlPintarTeste);
  if (mdlEl.cvIaChave) mdlEl.cvIaChave.addEventListener('input', mdlPintarTeste);
  if (mdlEl.cvIaListar) mdlEl.cvIaListar.addEventListener('click', mdlListarModelos);
  if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.addEventListener('click', mdlTestarBusca);
  if (mdlEl.cvIaSalvar) mdlEl.cvIaSalvar.addEventListener('click', mdlSalvar);

  // A engrenagem abre e fecha. Fecha também pelo fundo e pelo Esc, que é o que
  // qualquer um tenta antes de procurar o ✕.
  const botao = mdlEl['btn-config-ia'], modal = mdlEl.modalIa;
  if (botao) botao.addEventListener('click', async () => {
    mdl.cfg = await mdlLerConfig();       // pode ter mudado noutra tela
    mdlTrocarProvedor(mdlValorSel(mdlEl.cvIaProvedor));
    mdlAbrir(true);
  });
  if (mdlEl.modalIaFechar) mdlEl.modalIaFechar.addEventListener('click', () => mdlAbrir(false));
  if (mdlEl.cvIaCancelar) mdlEl.cvIaCancelar.addEventListener('click', () => mdlAbrir(false));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) mdlAbrir(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !modal.hidden) mdlAbrir(false); });

  mdlTrocarProvedor(mdl.cfg.provedor || 'gemini');
}

// A tela monta o bloco sozinha ao carregar.
//
// Condicionado ao ciclo de vida do documento, e não só à presença do campo:
// num ambiente sem ciclo de vida de navegador (o harness de teste, que monta o
// DOM em memória) a partida automática atropelaria outro teste. Quem quiser a
// partida ali chama `mdlIniciar()` de propósito, que é como um teste deve pedir.
function mdlArrancar() {
  if (!document.getElementById('cvIaModelo')) return;   // página sem o campo
  Promise.resolve().then(mdlIniciar).catch(e => console.warn('[modelo-ia]', e && e.message));
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mdlArrancar);
  else if (document.readyState === 'interactive' || document.readyState === 'complete') mdlArrancar();
}
