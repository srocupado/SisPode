// Escolha do provedor e do modelo de IA para os relatórios, dentro do módulo.
//
// Existe por um caso concreto: o analista tinha gemini-3.1-flash-lite nas
// Configurações gerais e a repercussão voltava vazia numa matéria de farta
// cobertura, enquanto o Parecer de Especialista, com a MESMA chave, funcionava.
//
// A causa raiz ERA OUTRA, e está corrigida em imprensa.js: o pedido de
// levantamento exigia JSON e vinha cheio de regras, e as duas coisas desligam a
// ferramenta de busca. Medido em 22/09/2026, no próprio gemini-3.1-flash-lite:
// pedido curto em prosa busca 4/4; o mesmo pedindo JSON, 0/3; longo e cheio de
// regras, 0/4. O modelo do analista nunca foi o problema.
//
// Este campo continua fazendo falta por outra razão, mais simples: a escolha
// nas Configurações gerais é feita para outro uso, e quem trabalha aqui precisa
// poder trocar sem sair daqui — inclusive para comparar resultado entre modelos,
// que é coisa que só se faz vendo. O parecer resolveu isso escolhendo sozinho
// ("o modo profundo não deve depender de o analista lembrar de trocar"); aqui a
// escolha automática é o padrão, mas fica à vista e pode ser trocada.
//
// O botão de testar a busca continua valendo, e não como remendo: é a única
// forma de saber, sem adivinhar, se uma combinação de modelo e pedido está
// realmente acionando a ferramenta. Ranking por nome não responde isso —
// gemini-3.1-pro-preview é caro, recente e não busca com o pedido errado.
//
// A chave continua vindo das Configurações gerais: chave é credencial, e
// credencial mora num lugar só.
//
// Depende de ia-comum.js (PROVEDORES_META, chamarIA), parecer.js
// (ranquearModelos, escolherModelo) e aderencia.js (cvEsc).

const MDL_CHAVE_TESTE = 'buscaWeb';   // onde o resultado dos testes fica guardado

const mdl = { cfg: null, modelos: [], carregando: false };

const mdlEl = {};

function mdlPegarEl() {
  for (const id of ['cvIaProvedor', 'cvIaModelo', 'cvIaTestar', 'cvIaEstado', 'cvIaCampo']) {
    mdlEl[id] = document.getElementById(id);
  }
  return !!mdlEl.cvIaModelo;
}

function mdlLerConfig() {
  return new Promise(r => {
    try { chrome.storage.local.get('config', d => r(d.config || {})); } catch (e) { r({}); }
  });
}

function mdlGravarConfig(mudancas) {
  return new Promise(r => {
    try {
      chrome.storage.local.get('config', d => {
        const c = Object.assign({}, d.config || {}, mudancas);
        chrome.storage.local.set({ config: c }, () => { mdl.cfg = c; r(c); });
      });
    } catch (e) { r(null); }
  });
}

/** A chave do provedor, com a mesma regra do resto do aplicativo. */
function mdlChaveDe(pid, cfg) {
  const c = cfg || mdl.cfg || {};
  return (c.chaves && c.chaves[pid]) || (c.provedor === pid ? c.apiKey : '') || '';
}

/** O provedor que vale para os relatórios: o do módulo, ou o geral. */
function mdlProvedorAtual(cfg) {
  const c = cfg || mdl.cfg || {};
  return c.provedorRelatorios || c.provedor || 'gemini';
}

/** O modelo FIXADO pelo analista, ou '' quando ele deixou no automático. */
function mdlModeloAtual(cfg) {
  return String((cfg || mdl.cfg || {}).modeloRelatorios || '');
}

/** O modelo que de fato vai ser usado: o fixado, ou o do automático. */
function mdlModeloEfetivo(cfg) {
  const c = cfg || mdl.cfg || {};
  return c.modeloRelatorios || c.modeloRelatoriosAuto || '';
}

/**
 * O modelo que o módulo escolhe sozinho, pela mesma regra do parecer: a versão
 * mais alta entre os não econômicos do provedor. Entre dois igualmente bem
 * ranqueados, prefere o que JÁ SE MEDIU buscando — o ranking fala de redigir,
 * o teste fala de buscar, e aqui é buscar que faz falta.
 */
function mdlAutomatico(lista, cfg) {
  const ids = (lista || mdl.modelos || []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
  if (!ids.length) return { modelo: '', motivo: 'a lista do provedor não veio' };
  const pid = mdlProvedorAtual(cfg);
  const testes = mdlTestes(cfg);
  if (typeof escolherModelo !== 'function') return { modelo: ids[0], motivo: 'primeiro da lista' };

  const rk = ranquearModelos(ids).filter(m => m.elegivel);
  const comprovado = rk.find(m => (testes[`${pid}/${m.id}`] || {}).ok === true);
  if (comprovado) {
    return { modelo: comprovado.id,
             motivo: `melhor modelo entre os que já se mediu buscando na web (${comprovado.id})` };
  }
  const e = escolherModelo(ids, {});
  return e.erro ? { modelo: '', motivo: e.erro } : { modelo: e.modelo, motivo: e.motivo };
}

/** O que já se mediu sobre a busca de cada modelo: { "<pid>/<modelo>": {ok, em} } */
function mdlTestes(cfg) { return ((cfg || mdl.cfg || {})[MDL_CHAVE_TESTE]) || {}; }

function mdlSelo(pid, modelo, cfg) {
  const t = mdlTestes(cfg)[`${pid}/${modelo}`];
  if (!t) return null;
  return { ok: t.ok, em: t.em };
}

/** A frase de estado, que é o que o analista lê para decidir. */
function mdlEstadoHtml(pid, modelo, cfg) {
  if (!mdlChaveDe(pid, cfg)) {
    return `<b class="ruim">Sem chave para ${cvEsc((PROVEDORES_META[pid] || {}).label || pid)}.</b>
            Cadastre em Configurações — a chave não se cadastra aqui.`;
  }
  if (!modelo) return 'Sem modelo definido: a lista do provedor não veio.';
  const s = mdlSelo(pid, modelo, cfg);
  if (!s) {
    return `Vai usar <b>${cvEsc(modelo)}</b>. A busca na web ainda não foi testada nele — e não dá para `
      + 'saber pelo nome: há modelos caros e recentes que nunca acionam a busca. Teste antes de contar '
      + 'com a repercussão.';
  }
  const quando = s.em ? new Date(s.em).toLocaleDateString('pt-BR') : '';
  return s.ok
    ? `<b class="bom">${cvEsc(modelo)} fez a busca na web</b>${quando ? ` (testado em ${cvEsc(quando)})` : ''}.`
    : `<b class="ruim">${cvEsc(modelo)} NÃO fez a busca na web</b>${quando ? ` (testado em ${cvEsc(quando)})` : ''}.
       O resumo e a sustentação funcionam nele; a repercussão vai cair num modelo de reserva.`;
}

function mdlPintarEstado() {
  if (!mdlEl.cvIaEstado) return;
  const pid = mdlEl.cvIaProvedor ? mdlEl.cvIaProvedor.value : mdlProvedorAtual();
  // Opção vazia = automático: o que o analista precisa ler é o modelo que VAI
  // ser usado, e não a palavra "automático".
  const modelo = (mdlEl.cvIaModelo && mdlEl.cvIaModelo.value) || mdlModeloEfetivo();
  mdlEl.cvIaEstado.innerHTML = mdlEstadoHtml(pid, modelo, mdl.cfg);
  if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.disabled = !modelo || !mdlChaveDe(pid, mdl.cfg) || mdl.carregando;
}

/** Marca uma opção, sem usar `select.value` — que o ambiente de teste não implementa. */
function mdlMarcar(sel, valor) {
  if (!sel) return;
  const alvo = sel.querySelector(`option[value="${String(valor).replace(/"/g, '\\"')}"]`);
  if (alvo) alvo.selected = true;
  else if (sel.options && sel.options.length) sel.options[0].selected = true;
}

async function mdlCarregarModelos(pid, escolher) {
  if (!mdlEl.cvIaModelo) return;
  const chave = mdlChaveDe(pid);
  if (!chave) {
    mdlEl.cvIaModelo.innerHTML = '<option value="">sem chave cadastrada</option>';
    mdlPintarEstado();
    return;
  }
  mdl.carregando = true;
  mdlEl.cvIaModelo.innerHTML = '<option value="">carregando a lista do provedor…</option>';
  mdlPintarEstado();
  let lista = [];
  try {
    lista = await PROVEDORES_META[pid].listar(chave);
  } catch (e) {
    // Lista que não veio não impede trabalhar: os modelos de reserva do
    // provedor continuam servindo, e o analista fica sabendo o que houve.
    lista = (PROVEDORES_META[pid] || {}).modelosFallback || [];
  }
  mdl.modelos = lista;
  const testes = mdlTestes();
  const rk = (typeof ranquearModelos === 'function') ? ranquearModelos(lista.map(m => m.id)) : lista.map(m => ({ id: m.id, elegivel: true }));
  const auto = mdlAutomatico(lista);
  // A primeira opção é o automático, e é o padrão. Mesma razão do parecer: o
  // módulo não deve depender de o analista lembrar de trocar de modelo — e aqui
  // a lembrança seria ainda mais improvável, porque o sintoma de esquecer é uma
  // seção que volta vazia, e não um erro.
  const opcoes = [`<option value="">automático — ${cvEsc(auto.modelo || 'sem modelo adequado')}</option>`];
  for (const m of rk) {
    const s = testes[`${pid}/${m.id}`];
    const marca = s ? (s.ok ? ' · busca na web ✓' : ' · não busca ✗') : '';
    const faixa = m.elegivel === false ? ' · faixa econômica' : '';
    opcoes.push(`<option value="${cvEsc(m.id)}">${cvEsc(m.id)}${faixa}${marca}</option>`);
  }
  mdlEl.cvIaModelo.innerHTML = opcoes.join('');
  mdlMarcar(mdlEl.cvIaModelo, escolher !== undefined ? escolher : mdlModeloAtual());
  // O automático fica GRAVADO, e não só calculado na tela: quem lê a
  // configuração na hora de chamar a IA é resumos.js, que não tem a lista do
  // provedor em mãos e não vai buscá-la a cada chamada.
  if (auto.modelo && auto.modelo !== (mdl.cfg || {}).modeloRelatoriosAuto) {
    await mdlGravarConfig({ modeloRelatoriosAuto: auto.modelo });
  }
  mdl.carregando = false;
  mdlPintarEstado();
}

/**
 * Faz UMA chamada de verdade e vê se o modelo acionou a busca.
 *
 * É medição, não dedução. A pergunta pede fato recente de propósito: um modelo
 * que ache que sabe a resposta não busca, e é exatamente esse comportamento que
 * precisa aparecer aqui, e não na hora em que o analista está montando o
 * documento.
 */
async function mdlTestarBusca() {
  const pid = mdlEl.cvIaProvedor ? mdlEl.cvIaProvedor.value : mdlProvedorAtual();
  const modelo = (mdlEl.cvIaModelo && mdlEl.cvIaModelo.value) || mdlModeloEfetivo();
  const chave = mdlChaveDe(pid);
  if (!modelo || !chave) return null;

  mdl.carregando = true;
  if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.disabled = true;
  if (mdlEl.cvIaEstado) mdlEl.cvIaEstado.innerHTML = 'Testando a busca com uma chamada de verdade…';

  let ok = false, erro = null;
  try {
    const r = await chamarIA({
      provedorId: pid, apiKey: chave, modelo, web: true,
      prompt: 'Pesquise na web e responda em uma frase: qual foi a matéria mais recente '
            + 'aprovada pelo Plenário da Câmara dos Deputados? Cite a fonte.',
      opcoes: { maxSaida: 2000 },
    });
    ok = !!(r && r.fontes && r.fontes.length);
  } catch (e) {
    erro = e.message;
  }

  mdl.carregando = false;
  if (erro) {
    if (mdlEl.cvIaEstado) {
      mdlEl.cvIaEstado.innerHTML = `<b class="ruim">O teste falhou:</b> ${cvEsc(erro)}.`;
    }
    if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.disabled = false;
    return { ok: false, erro };
  }

  const testes = Object.assign({}, mdlTestes());
  testes[`${pid}/${modelo}`] = { ok, em: Date.now() };
  await mdlGravarConfig({ [MDL_CHAVE_TESTE]: testes });
  // Reescreve o ✓/✗ na lista, preservando a escolha do analista: se ele estava
  // no automático, continua no automático — que agora pode ter mudado de
  // modelo, já que o automático prefere o que se mediu buscando.
  await mdlCarregarModelos(pid, mdlModeloAtual());
  return { ok };
}

/** Liga o bloco. Chamado uma vez, quando a tela monta. */
async function mdlIniciar() {
  if (!mdlPegarEl()) return;
  mdl.cfg = await mdlLerConfig();

  if (mdlEl.cvIaProvedor) {
    mdlEl.cvIaProvedor.innerHTML = Object.keys(PROVEDORES_META).map(p =>
      `<option value="${p}">${cvEsc(PROVEDORES_META[p].label)}${mdlChaveDe(p) ? '' : ' — sem chave'}</option>`).join('');
    mdlMarcar(mdlEl.cvIaProvedor, mdlProvedorAtual());
    mdlEl.cvIaProvedor.addEventListener('change', async () => {
      const pid = mdlEl.cvIaProvedor.value;
      await mdlGravarConfig({ provedorRelatorios: pid, modeloRelatorios: '' });
      await mdlCarregarModelos(pid);
      // Trocar de provedor sem escolher modelo deixaria o módulo sem modelo:
      // o primeiro da lista passa a valer, e fica gravado.
      if (mdlEl.cvIaModelo && mdlEl.cvIaModelo.value) {
        await mdlGravarConfig({ modeloRelatorios: mdlEl.cvIaModelo.value });
      }
      mdlPintarEstado();
    });
  }

  if (mdlEl.cvIaModelo) {
    mdlEl.cvIaModelo.addEventListener('change', async () => {
      await mdlGravarConfig({ modeloRelatorios: mdlEl.cvIaModelo.value });
      mdlPintarEstado();
    });
  }

  if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.addEventListener('click', mdlTestarBusca);

  await mdlCarregarModelos(mdlProvedorAtual());
}

// A tela monta o bloco sozinha ao carregar.
//
// A partida é condicionada ao ciclo de vida do documento, e não só à presença
// do campo. A razão é que `mdlIniciar` faz uma chamada de rede — a listagem de
// modelos do provedor —, e num ambiente sem ciclo de vida de navegador (o
// harness de teste, que monta o DOM em memória) essa chamada sai no meio de
// outro teste e consome a resposta que era de outro. Quem quiser a partida ali
// chama `mdlIniciar()` de propósito, que é como um teste deve pedir.
function mdlArrancar() {
  if (!document.getElementById('cvIaModelo')) return;   // página sem o campo
  Promise.resolve().then(mdlIniciar).catch(e => console.warn('[modelo-ia]', e && e.message));
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mdlArrancar);
  else if (document.readyState === 'interactive' || document.readyState === 'complete') mdlArrancar();
}
