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
// A lista de modelos segue o desenho do Plenário, que é o padrão da casa, e
// cada peça dele resolve um problema concreto:
//
//   - cada opção DIZ A SUA FAIXA, e a lista vem ordenada por faixa. Sem isso o
//     analista escolhe por nome, e nome não diz se o modelo dá conta;
//   - o modelo SALVO entra sempre, marcado quando o provedor não o oferta mais.
//     Lista que mudou não apaga em silêncio a escolha de ninguém;
//   - abaixo do campo, um aviso do que aquela faixa significa na prática.
//
// Depende de ia-comum.js (PROVEDORES_META, chamarIA), parecer.js
// (faixaDoModelo, versaoDoModelo) e aderencia.js (cvEsc).

const MDL_CHAVE_TESTE = 'buscaWeb';   // onde o resultado dos testes fica guardado

const mdl = { cfg: null, modelos: [], ocupado: false, ligado: false };
const mdlEl = {};

const MDL_IDS = ['cvIaProvedor', 'cvIaChave', 'cvIaChaveDica', 'cvIaOlho', 'cvIaModelo', 'cvIaListar',
                 'cvIaModeloEstado', 'cvIaFaixa', 'cvIaTestar', 'cvIaEstado', 'cvIaCampo', 'cvIaSalvar',
                 'cvIaCancelar', 'btn-config-ia', 'modalIa', 'modalIaFechar'];

// Os mesmos rótulos e o mesmo texto do Plenário: a faixa quer dizer a mesma
// coisa nos dois lugares, e dizer diferente seria inventar um segundo critério.
const MDL_ROTULO_FAIXA = {
  superior: 'faixa superior', intermediaria: 'faixa intermediária',
  economica: 'faixa econômica', nao_identificada: 'faixa não identificada',
  outra_modalidade: 'outra modalidade — não redige texto',
};
const MDL_AVISO_FAIXA = {
  superior: ['bom', 'Faixa superior: adequada para análise densa.'],
  intermediaria: ['', 'Faixa intermediária: dá conta do resumo e da repercussão. Para a sustentação, a superior escreve melhor.'],
  economica: ['ruim', 'Faixa econômica: rápida e barata. Tende a completar lacuna com o plausível — o que num documento '
    + 'de conferência é o erro de maior consequência.'],
  nao_identificada: ['', 'Faixa não identificada pela convenção de nomes conhecida. O modelo funciona; só não dá para dizer se é adequado.'],
  outra_modalidade: ['ruim', 'Este é um modelo de imagem, voz, vídeo ou embedding: ele não redige texto. '
    + 'O resumo, a repercussão e a sustentação não funcionam com ele — troque por um modelo de texto.'],
};

// Faixa que o parecer.js conheça e esta tela não: em vez de quebrar a tela, cai
// no texto de "não identificada", que é justamente o caso de convenção nova.
function mdlRotulo(f) { return MDL_ROTULO_FAIXA[f] || MDL_ROTULO_FAIXA.nao_identificada; }
function mdlAviso(f) { return MDL_AVISO_FAIXA[f] || MDL_AVISO_FAIXA.nao_identificada; }

/** A faixa do modelo, do parecer.js. Sem ele, tudo vira "não identificada". */
function mdlFaixa(id) {
  return (typeof faixaDoModelo === 'function') ? faixaDoModelo(id) : 'nao_identificada';
}
function mdlVersao(id) {
  return (typeof versaoDoModelo === 'function') ? versaoDoModelo(id) : 0;
}

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
 * Monta a lista de modelos, no desenho do Plenário.
 *
 * `lista` é a viva quando ela veio, e a de reserva quando não veio. O modelo
 * salvo entra à força e se anuncia quando o provedor não o oferta mais — lista
 * que mudou não pode apagar em silêncio a escolha de ninguém. A ordem é por
 * faixa, e dentro da faixa o mais novo primeiro, porque é essa a ordem em que
 * se escolhe.
 */
function mdlMontarModelos(pid, lista, escolher) {
  if (!mdlEl.cvIaModelo) return 0;
  const testes = mdlTestes();
  const bruta = (lista && lista.length ? lista : (PROVEDORES_META[pid] || {}).modelosFallback || [])
    .map(m => ({ id: m.id, displayName: m.displayName || m.id }));
  // Modelo de imagem, voz, vídeo ou embedding fica fora da escolha, pela mesma
  // regra do parecer: ele não redige. A lista viva do Gemini traz vários deles
  // com generateContent, e oferecê-los é oferecer uma opção que quebra as três
  // camadas de IA sem dizer por quê.
  const base = bruta.filter(m => mdlFaixa(m.id) !== 'outra_modalidade');
  const salvo = escolher || ((mdl.cfg || {}).provedor === pid ? (mdl.cfg || {}).modelo : '') || '';
  // O modelo salvo entra sempre — inclusive se for de outra modalidade, e aí o
  // rótulo diz o que ele é. Sumir com a escolha de alguém em silêncio é pior.
  if (salvo && !base.some(m => m.id === salvo)) {
    base.push({ id: salvo, displayName: salvo, naoListado: !bruta.some(m => m.id === salvo) });
  }

  const peso = { superior: 3, nao_identificada: 2, intermediaria: 1, economica: 0, outra_modalidade: -1 };
  base.sort((a, b) => ((peso[mdlFaixa(b.id)] ?? 2) - (peso[mdlFaixa(a.id)] ?? 2)) || (mdlVersao(b.id) - mdlVersao(a.id)));

  mdlEl.cvIaModelo.innerHTML = base.map(m => {
    const s = testes[`${pid}/${m.id}`];
    // O que se mediu sobre a busca vale mais que qualquer rótulo, então vem junto.
    const marca = s ? (s.ok ? ', busca na web ✓' : ', não faz busca na web ✗') : '';
    const extra = m.naoListado ? ', salvo — não ofertado pelo provedor agora' : '';
    return `<option value="${cvEsc(m.id)}">${cvEsc(m.displayName)} — ${mdlRotulo(mdlFaixa(m.id))}${extra}${marca}</option>`;
  }).join('') || '<option value="">nenhum modelo</option>';
  mdl.modelos = base;
  mdlMarcar(mdlEl.cvIaModelo, salvo);
  mdlPintarFaixa();
  mdlPintarTeste();
  return base.length;
}

/** O que a faixa do modelo escolhido significa na prática. */
function mdlPintarFaixa() {
  const el = mdlEl.cvIaFaixa;
  if (!el) return;
  const id = mdlValorSel(mdlEl.cvIaModelo);
  if (!id) { el.textContent = ''; el.className = 'ia-dica'; return; }
  const [classe, txt] = mdlAviso(mdlFaixa(id));
  el.className = 'ia-dica' + (classe ? ' ' + classe : '');
  el.textContent = txt;
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
    const n = mdlMontarModelos(pid, lista);
    // Conta o que entrou no campo, não o que veio do provedor: a lista viva do
    // Gemini mistura imagem, voz e embedding, e dizer "40 modelos" quando o
    // campo mostra 22 faz o analista procurar o que não está lá.
    const fora = lista.length - (lista.filter(m => mdlFaixa(m.id) !== 'outra_modalidade').length);
    if (est) {
      est.className = 'ia-dica bom';
      est.textContent = `✓ ${n} modelo(s) de texto nesta chave`
        + (fora > 0 ? ` (${fora} de imagem, voz ou embedding ficaram de fora — não redigem).` : '.');
    }
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

/**
 * Põe na tela o que está SALVO. Chamado ao abrir a engrenagem, e não só na
 * montagem: quem mexeu nos campos e cancelou tem de reencontrar a configuração
 * que vale, e não a edição que abandonou — inclusive o provedor, que é o campo
 * onde essa confusão custa mais caro.
 */
function mdlRefletirConfig() {
  const pid = (mdl.cfg || {}).provedor || 'gemini';
  mdlMarcar(mdlEl.cvIaProvedor, pid);
  mdlTrocarProvedor(pid);
}

/** Liga o bloco. Chamado uma vez, quando a tela monta. */
async function mdlIniciar() {
  if (!mdlPegarEl()) return;
  mdl.cfg = await mdlLerConfig();

  // Os ouvintes entram UMA vez. Chamar de novo relê a configuração e redesenha,
  // mas sem empilhar ouvinte: dois ouvintes no olho fazem a chave alternar duas
  // vezes por clique, isto é, não alternar.
  if (mdl.ligado) { mdlRefletirConfig(); return; }
  mdl.ligado = true;

  if (mdlEl.cvIaProvedor) {
    mdlEl.cvIaProvedor.innerHTML = Object.keys(PROVEDORES_META).map(p =>
      `<option value="${p}">${cvEsc(PROVEDORES_META[p].label)}${mdlChaveDe(p) ? '' : ' — sem chave'}</option>`).join('');
    mdlMarcar(mdlEl.cvIaProvedor, mdl.cfg.provedor || 'gemini');
    mdlEl.cvIaProvedor.addEventListener('change', () => mdlTrocarProvedor(mdlValorSel(mdlEl.cvIaProvedor)));
  }
  if (mdlEl.cvIaModelo) mdlEl.cvIaModelo.addEventListener('change', () => { mdlPintarFaixa(); mdlPintarTeste(); });
  if (mdlEl.cvIaOlho) mdlEl.cvIaOlho.addEventListener('click', () => {
    const c = mdlEl.cvIaChave;
    // setAttribute, e não `.type =`: a propriedade não existe em todo ambiente,
    // e o atributo é o que vale nos dois.
    if (c) c.setAttribute('type', (c.getAttribute('type') || 'password') === 'password' ? 'text' : 'password');
  });
  if (mdlEl.cvIaChave) mdlEl.cvIaChave.addEventListener('input', mdlPintarTeste);
  if (mdlEl.cvIaListar) mdlEl.cvIaListar.addEventListener('click', mdlListarModelos);
  if (mdlEl.cvIaTestar) mdlEl.cvIaTestar.addEventListener('click', mdlTestarBusca);
  if (mdlEl.cvIaSalvar) mdlEl.cvIaSalvar.addEventListener('click', mdlSalvar);

  // A engrenagem abre e fecha. Fecha também pelo fundo e pelo Esc, que é o que
  // qualquer um tenta antes de procurar o ✕.
  const botao = mdlEl['btn-config-ia'], modal = mdlEl.modalIa;
  if (botao) botao.addEventListener('click', async () => {
    mdl.cfg = await mdlLerConfig();       // pode ter mudado noutra tela
    mdlRefletirConfig();
    mdlAbrir(true);
  });
  if (mdlEl.modalIaFechar) mdlEl.modalIaFechar.addEventListener('click', () => mdlAbrir(false));
  if (mdlEl.cvIaCancelar) mdlEl.cvIaCancelar.addEventListener('click', () => mdlAbrir(false));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) mdlAbrir(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !modal.hidden) mdlAbrir(false); });

  mdlRefletirConfig();
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
