// Repercussão pública da matéria, para a aba "Como votou o deputado".
//
// Quarta camada do documento, e a única cujo material não está sob controle da
// Câmara. As outras três têm origem conferível:
//
//   resumos.js  transcreve o documento oficial            → é o que está escrito
//   resumos.js  reescreve a transcrição em linguagem comum → sai só da transcrição
//   defesa.js   argumenta a favor de uma posição           → é opinião, e se anuncia
//   imprensa.js relata o que se diz na web sobre a matéria → é de terceiro
//
// Esta camada existe porque o analista precisa saber o que já foi dito lá fora
// antes de escrever qualquer defesa: qual é o apelido pelo qual a matéria virou
// conhecida, o que a cobertura destaca e, sobretudo, o que está contestado. Uma
// sustentação escrita sem isso responde a perguntas que ninguém fez e deixa de
// responder a que vai ser feita.
//
// Duas regras duras, que é o que separa isto de um boato com aparência de dado:
//
// 1. AFIRMAÇÃO SEM FONTE NÃO ENTRA. O modelo tem de dizer, para cada ponto, de
//    que veículos ele saiu; o ponto cujos veículos não aparecem nas fontes que o
//    provedor efetivamente consultou é descartado, e a tela diz quantos caíram.
//    Sem isso, o campo mais perigoso do documento seria também o único sem
//    procedência.
//
// 2. ISTO NÃO DESCREVE A MATÉRIA. O que a matéria faz sai do documento oficial,
//    e só de lá. Aqui só se registra o que se diz sobre ela. Se manchete virasse
//    descrição de matéria, o relatório deixaria de ser peça de conferência.
//
// O apelido é a única coisa daqui que sobe para o cabeçalho, e sobe declarado
// como apelido público — nunca no lugar da ementa.
//
// Depende de aderencia.js (cvEsc), ia-comum.js (chamarIA) e resumos.js (rsmConfigIA).

const IMP_MODELO_PADRAO = 'gemini-2.5-flash';
const IMP_TETO_PONTOS = 6;          // por lista; mais que isso ninguém confere

function impPrompt({ prop, ementa, simples }) {
  const id = prop ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}` : 'a matéria';
  return `Você pesquisa na web a repercussão pública de uma proposição do Congresso Nacional
brasileiro e devolve um levantamento, para um analista da Câmara dos Deputados.

MATÉRIA: ${id}.
EMENTA OFICIAL: ${ementa || '(não disponível)'}
${simples ? `DO QUE TRATA, EM LINGUAGEM COMUM: ${simples}\n` : ''}
BUSQUE OS DOIS LADOS. Faça consultas tanto com termos de crítica quanto com
termos de defesa da matéria — "críticas", "problemas", "polêmica", e também
"benefícios", "avanços", "defesa". Quem escolhe só um lado da busca recebe de
volta só aquele lado, e o levantamento fica inútil para quem vai ter de
responder ao outro.

O QUE DEVOLVER:
- apelido: o nome pelo qual a matéria ficou conhecida publicamente ("PL das
  Fake News", "marco temporal"), se houver um de uso corrente. Se não houver,
  null. Não invente apelido nem use o número da matéria como apelido.
- focos: o que a cobertura destaca da matéria — o ENQUADRAMENTO público, não o
  conteúdo da lei. "A cobertura tratou sobretudo da tributação das empresas" é
  foco; "o projeto institui normas de autorização e fiscalização" NÃO é, é
  descrição da matéria, e essa já está na ementa acima.
- contencioso: os pontos efetivamente contestados, criticados ou disputados, e
  por quem. É a parte mais importante: se há crítica pública, ela tem de
  aparecer aqui mesmo que seja desfavorável ao Parlamento.

REGRAS, todas obrigatórias:
- Para CADA ponto, liste em "veiculos" os domínios das páginas de onde ele saiu
  (por exemplo "g1.globo.com"). Ponto sem veículo será descartado.
- Nunca use como veículo o domínio do buscador ou do redirecionador
  ("vertexaisearch.cloud.google.com", "cloud.google.com", "google.com"): eles não
  publicaram nada. Use o domínio de quem publicou a página.
- NÃO descreva o que a matéria faz: isso já vem do documento oficial. Aqui só o
  que se DIZ sobre ela.
- NÃO invente número, percentual, pesquisa, valor ou citação. Se um número
  aparecer numa fonte, pode citá-lo dizendo de onde veio; se não aparecer, não
  existe.
- Não opine sobre a matéria e não recomende posição. Você está relatando o
  debate, não participando dele.
- Se a busca não encontrar repercussão relevante, devolva as listas vazias e
  "semCobertura": true. Matéria sem repercussão é um achado útil, não uma falha.
- Uma frase por ponto, no máximo duas. Português comum.

Responda SOMENTE com JSON válido, sem cercas de código:
{"apelido":"<texto ou null>","semCobertura":false,
 "focos":[{"ponto":"<uma frase>","veiculos":["dominio.com"]}],
 "contencioso":[{"ponto":"<uma frase>","veiculos":["dominio.com"]}]}`;
}

/**
 * Só as letras e números, sem acento, para comparar "G1" com "g1.globo.com".
 * O acento tem de cair: o modelo escreve "Estadão" e o domínio é
 * "estadao.com.br". Sem tirar o acento, esse ponto seria descartado por falta
 * de fonte tendo fonte — o pior erro possível aqui, porque é silencioso e
 * derruba justamente a crítica que o analista precisava ver.
 */
function impNormalizar(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Pedaços de domínio que não identificam ninguém. Sem esta lista, um ponto que
// citasse "Brasil" casaria com qualquer ".br".
const IMP_GENERICO = new Set(['com', 'br', 'net', 'org', 'gov', 'edu', 'leg', 'jus', 'mil', 'www', 'co', 'uk', 'us']);

/**
 * O veículo que o modelo citou casa com alguma fonte que o provedor consultou?
 *
 * A comparação é tolerante de propósito, porque os dois lados escrevem
 * diferente: o modelo diz "Estadão" e "Folha de S.Paulo", a fonte diz
 * "estadao.com.br" e "folha.uol.com.br". Exigir igualdade literal descartaria
 * ponto bom por diferença de grafia — e descarte silencioso de ponto bom é o
 * pior defeito possível aqui, porque derruba justamente a crítica que o analista
 * precisava ver.
 *
 * A tolerância tem dois graus, e a diferença importa. Nome curto ("G1", "UOL")
 * só casa por IGUALDADE com um pedaço do domínio: aceitar "g1" por continência
 * casaria com qualquer domínio que tivesse "g1" no meio. Nome de quatro letras
 * ou mais casa também por continência, que é o que resolve "Estadão" contra
 * "estadao.com.br" e "Folha de S.Paulo" contra "folha.uol.com.br".
 *
 * Devolve a fonte encontrada, ou null.
 */
function impCasarVeiculo(nome, fontes) {
  const n = impNormalizar(nome);
  if (n.length < 2) return null;
  for (const f of fontes) {
    for (const bruto of [f.veiculo, f.titulo]) {
      if (!bruto) continue;
      const cheio = impNormalizar(bruto);
      if (!cheio) continue;
      if (n.length >= 4 && (cheio.includes(n) || n.includes(cheio))) return f;
      for (const parte of String(bruto).split(/[^A-Za-z0-9À-ɏ]+/)) {
        const p = impNormalizar(parte);
        if (!p || IMP_GENERICO.has(p)) continue;
        if (p === n) return f;
        if (p.length >= 4 && n.includes(p)) return f;
      }
    }
  }
  return null;
}

/**
 * Limpa o que o modelo põe por conta própria: negrito de markdown, que sairia
 * literal como "**Crítica:**" no documento, e o rótulo redundante no começo da
 * frase — a lista já se chama "o que está contestado".
 */
function impLimparTexto(v) {
  return String(v == null ? '' : v)
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/[*_`]/g, '')
    .replace(/^\s*(crítica|critica|contestação|contestacao|foco|ponto|polêmica|polemica)\s*:\s*/i, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Valida os pontos contra as fontes que o provedor realmente consultou.
 *
 * Devolve { pontos, descartados, cortados }, e os dois contadores são separados
 * de propósito. "Descartado" é ponto que não indicou fonte conferível, e é
 * ALARME: é o caso em que o modelo inventou repercussão. "Cortado" é ponto bom
 * que passou do teto da lista, e não é alarme nenhum. Somar os dois num número
 * só faria a tela gritar quando não há nada errado — e, pior, a deixaria calada
 * na proporção errada quando há.
 */
function impValidarPontos(lista, fontes) {
  const pontos = [];
  let descartados = 0, cortados = 0;
  for (const item of (Array.isArray(lista) ? lista : [])) {
    const texto = impLimparTexto(item && item.ponto);
    if (!texto) continue;
    const nomes = Array.isArray(item.veiculos) ? item.veiculos : [item.veiculos];
    const achadas = [];
    for (const nome of nomes) {
      const f = impCasarVeiculo(nome, fontes);
      if (f && !achadas.includes(f)) achadas.push(f);
    }
    if (!achadas.length) { descartados++; continue; }
    if (pontos.length >= IMP_TETO_PONTOS) { cortados++; continue; }
    // `usar` nasce verdadeiro: o ponto passou pela conferência de fonte. O
    // analista desmarca o que não se sustenta na leitura dele.
    pontos.push({ texto, fontes: achadas, usar: true });
  }
  return { pontos, descartados, cortados };
}

/**
 * Levanta a repercussão. Devolve { ok, ... } ou { ok:false, motivo }.
 * Nenhum caminho de falha devolve conteúdo pela metade.
 */
async function impLevantar({ prop, resumos, aoAndar }) {
  const cfg = await rsmConfigIA();
  if (!cfg.apiKey) return { ok: false, motivo: 'sem-chave' };
  if (!prop) return { ok: false, motivo: 'sem-materia' };

  const ementa = String((prop && prop.ementa) || '').slice(0, 1200);
  const simples = resumos && resumos.materia && resumos.materia.simples ? resumos.materia.simples : '';

  // Medido em 21/09/2026, três matérias reais: em cerca de um terço das
  // chamadas o Gemini falha de um dos dois jeitos abaixo — responde sem ter
  // buscado nada, ou devolve texto que não é JSON. As duas falhas são de
  // amostragem, não de configuração: a chamada seguinte, com o mesmo prompt,
  // costuma sair certa. Uma segunda tentativa leva o insucesso de um terço para
  // cerca de um nono, e é o que separa um recurso que o analista usa de um que
  // ele desiste de marcar.
  //
  // Só se repete o que é falha de sorteio. Erro de rede, chave inválida e
  // recusa do provedor não se repetem: repetir não muda o resultado e faz o
  // analista esperar duas vezes por um "não".
  const RETENTAVEIS = new Set(['resposta-ilegivel', 'sem-busca']);
  let ultima = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    if (aoAndar) aoAndar(tentativa === 1
      ? 'Consultando a repercussão pública da matéria…'
      : 'A primeira consulta não trouxe busca utilizável — tentando outra vez…');
    const r = await impTentar({ prop, ementa, simples, cfg });
    if (r.ok) return Object.assign(r, { tentativas: tentativa });
    ultima = Object.assign(r, { tentativas: tentativa });
    if (!RETENTAVEIS.has(r.motivo)) break;
  }
  return ultima;
}

/** Uma tentativa de levantamento. Toda a decisão de repetir fica em impLevantar. */
async function impTentar({ prop, ementa, simples, cfg }) {
  let resposta;
  try {
    resposta = await chamarIA({
      provedorId: cfg.provedor || 'gemini',
      apiKey: cfg.apiKey,
      modelo: cfg.modelo || IMP_MODELO_PADRAO,
      prompt: impPrompt({ prop, ementa, simples }),
      web: true,                       // é o ponto do módulo: sem web não há o que levantar
      // Teto alto porque a resposta traz doze pontos com listas de veículos, e
      // no Gemini o raciocínio conta dentro do mesmo teto: apertado, o JSON vem
      // cortado no meio e a falha aparece como "ilegível", que aponta para o
      // lado errado do problema.
      opcoes: { maxSaida: 12000 },
    });
  } catch (e) {
    return { ok: false, motivo: 'erro', erro: e.message };
  }

  const j = rsmJson(resposta && resposta.text);
  if (!j) return { ok: false, motivo: resposta && resposta.truncated ? 'resposta-cortada' : 'resposta-ilegivel' };

  const fontes = (resposta && resposta.fontes) || [];
  const buscas = (resposta && resposta.buscas) || [];
  // Provedor que não buscou não tem o que relatar. Acontece quando a chave não
  // tem a ferramenta habilitada, e o modelo responde de memória — que é
  // exatamente o que este módulo não pode aceitar.
  if (!fontes.length) return { ok: false, motivo: 'sem-busca', buscas };

  const f = impValidarPontos(j.focos, fontes);
  const c = impValidarPontos(j.contencioso, fontes);

  // O apelido também é afirmação sobre o mundo: só vale se veio de uma busca que
  // trouxe fonte, e nunca quando é o próprio número da matéria.
  let apelido = String(j.apelido == null ? '' : j.apelido).replace(/\s+/g, ' ').trim();
  if (apelido.length < 3 || apelido.length > 120) apelido = '';
  if (prop && apelido && impNormalizar(apelido).includes(impNormalizar(`${prop.siglaTipo}${prop.numero}`))) apelido = '';

  return {
    ok: true,
    apelido: apelido || null,
    usarApelido: !!apelido,
    focos: f.pontos,
    contencioso: c.pontos,
    descartados: f.descartados + c.descartados,
    cortados: f.cortados + c.cortados,
    semCobertura: !!j.semCobertura && !f.pontos.length && !c.pontos.length,
    fontes, buscas,
    incluir: false,       // como a sustentação: gerar e publicar são atos distintos
    modelo: cfg.modelo || IMP_MODELO_PADRAO,
  };
}

/** Os pontos que o analista deixou marcados — o que de fato vai ao documento. */
function impSelecionados(imp) {
  if (!imp || !imp.ok) return { focos: [], contencioso: [], total: 0 };
  const focos = imp.focos.filter(p => p.usar);
  const contencioso = imp.contencioso.filter(p => p.usar);
  return { focos, contencioso, total: focos.length + contencioso.length };
}

/** Só as fontes citadas pelos pontos marcados, na ordem em que aparecem. */
function impFontesUsadas(imp) {
  const sel = impSelecionados(imp);
  const out = [];
  for (const p of sel.focos.concat(sel.contencioso)) {
    for (const f of p.fontes) if (!out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * O endereço é de redirecionador de buscador, e não da página? O Gemini só
 * devolve desses (medido), e eles se comportam diferente no papel e na tela.
 */
function impRedirecionador(url) {
  return /grounding-api-redirect|vertexaisearch\.cloud\.google\.com/i.test(String(url || ''));
}

/**
 * Uma fonte em uma linha, na tela. O nome do veículo É o link.
 *
 * O endereço cru só aparece quando diz alguma coisa. Nos redirecionadores do
 * buscador ele é sempre o mesmo prefixo de cem caracteres seguido de um token,
 * e quatro fontes viram quatro linhas visualmente idênticas que escondem os
 * nomes que de fato distinguem uma da outra.
 */
function impFonteHtml(f, e) {
  const esc = e || cvEsc;
  const nome = esc(f.veiculo || 'origem não identificada');
  const cabeca = [`<a href="${esc(f.url)}" target="_blank" rel="noopener"><b>${nome}</b></a>`,
                  f.data ? esc(f.data) : null, f.titulo ? esc(f.titulo) : null].filter(Boolean).join(' — ');
  return cabeca + (impRedirecionador(f.url)
    ? ' <span class="imp-via">abre pelo redirecionador do buscador</span>'
    : `<br><span class="imp-via">${esc(f.url.slice(0, 110))}</span>`);
}

function impListaHtml(rot, pontos, idBase) {
  if (!pontos.length) return '';
  return `<div class="imp-grupo"><div class="imp-rot">${cvEsc(rot)}</div>
    ${pontos.map((p, i) => `<label class="imp-ponto${p.usar ? '' : ' fora'}" data-p="${idBase}:${i}">
      <input type="checkbox" class="imp-usar" data-p="${idBase}:${i}"${p.usar ? ' checked' : ''}>
      <span>${cvEsc(p.texto)}
        <span class="imp-vei">${p.fontes.map(f => cvEsc(f.veiculo || 'origem não identificada')).join(', ')}</span>
      </span></label>`).join('')}</div>`;
}

/** O bloco da repercussão na tela. */
function impHtml(imp) {
  if (!imp) return '';
  if (!imp.ok) {
    const msg = {
      'sem-chave': 'Sem chave de IA configurada — a repercussão não pode ser consultada.',
      'sem-materia': '',
      'erro': 'A consulta falhou: ' + cvEsc(imp.erro || '') + '. Tente de novo.',
      'resposta-ilegivel': 'O provedor respondeu, em duas tentativas, em formato que não deu para ler. '
        + 'Tente de novo — a falha é de sorteio e costuma passar.',
      'resposta-cortada': 'A resposta do provedor veio cortada no meio, por limite de tamanho. '
        + 'Tente de novo; se repetir, é a matéria que tem repercussão longa demais para uma volta só.',
      'sem-busca': 'O provedor respondeu, em duas tentativas, sem consultar a web — então não há '
        + 'repercussão a relatar: o que ele escreveria viria da memória dele, e isso não entra no '
        + 'documento. Verifique se a busca está habilitada para a sua chave.',
    }[imp.motivo] || 'A repercussão não foi levantada.';
    return msg ? `<div class="imp imp-falha"><div class="imp-tit">Repercussão pública não levantada</div>${msg}</div>` : '';
  }
  if (imp.semCobertura) {
    return `<div class="imp"><div class="imp-tit">Repercussão pública</div>
      <div class="imp-vazio">A busca não encontrou repercussão relevante sobre a matéria.
      ${imp.buscas.length ? 'Buscas feitas: ' + cvEsc(imp.buscas.join(' · ')) + '.' : ''}
      Matéria sem repercussão é um achado: não há cobertura a responder.</div></div>`;
  }
  const sel = impSelecionados(imp);
  return `<div class="imp">
    <div class="imp-tit">Repercussão pública</div>
    ${imp.apelido ? `<div class="imp-apelido">Conhecida publicamente como <b>${cvEsc(imp.apelido)}</b></div>` : ''}
    ${impListaHtml('O que a cobertura destaca', imp.focos, 'f')}
    ${impListaHtml('O que está contestado', imp.contencioso, 'c')}
    ${impFontesUsadas(imp).length ? `<div class="imp-grupo"><div class="imp-rot">Fontes consultadas</div>
      ${impFontesUsadas(imp).map(f => `<div class="imp-fonte">${impFonteHtml(f)}</div>`).join('')}</div>` : ''}
    ${imp.buscas.length ? `<div class="imp-buscas"><b>Buscas feitas:</b> ${cvEsc(imp.buscas.join(' · '))}.
      Quem escreve a consulta orienta a resposta, então elas ficam à vista.</div>` : ''}
    ${imp.descartados ? `<div class="imp-desc">${imp.descartados} ponto(s) descartado(s) por não indicar
      fonte que conste da busca.</div>` : ''}
    ${imp.cortados ? `<div class="imp-buscas">${imp.cortados} ponto(s) a mais vieram com fonte e ficaram de
      fora por passar do limite de ${IMP_TETO_PONTOS} por lista — não é problema de fonte.</div>` : ''}
    <label class="imp-incluir${imp.incluir ? ' marcado' : ''}" id="impIncluirLinha">
      <input type="checkbox" id="impIncluir"${imp.incluir ? ' checked' : ''}>
      <span><b>Incluir a repercussão no PDF.</b> <span id="impIncluirEstado">${imp.incluir
        ? `Marcado: ${sel.total} ponto(s) e as fontes saem no documento.`
        : 'Desmarcado: o levantamento fica só nesta tela, orientando a sustentação.'}</span></span>
    </label>
    <div class="imp-nota">Levantamento do que terceiros publicaram, feito por ${cvEsc(imp.modelo)} com busca na
      web. Não descreve a matéria — o que ela faz está na ementa e nos documentos citados acima.</div>
  </div>`;
}

/** Liga as marcações ao estado, depois de cada redesenho. */
function impLigar(imp, aoMudar) {
  if (!imp || !imp.ok) return;
  const marcar = () => {
    const linha = document.getElementById('impIncluirLinha');
    if (linha) linha.classList.toggle('marcado', imp.incluir);
    const est = document.getElementById('impIncluirEstado');
    const sel = impSelecionados(imp);
    if (est) est.textContent = imp.incluir
      ? `Marcado: ${sel.total} ponto(s) e as fontes saem no documento.`
      : 'Desmarcado: o levantamento fica só nesta tela, orientando a sustentação.';
    if (aoMudar) aoMudar(imp);
  };
  for (const cx of document.querySelectorAll('.imp-usar')) {
    cx.addEventListener('change', () => {
      const [g, i] = String(cx.getAttribute('data-p') || '').split(':');
      const lista = g === 'f' ? imp.focos : imp.contencioso;
      const p = lista[Number(i)];
      if (!p) return;
      p.usar = !!cx.checked;
      const rot = document.querySelector(`label.imp-ponto[data-p="${g}:${i}"]`);
      if (rot) rot.classList.toggle('fora', !p.usar);
      marcar();
    });
  }
  const inc = document.getElementById('impIncluir');
  if (inc) inc.addEventListener('change', () => { imp.incluir = !!inc.checked; marcar(); });
}

/** A seção no PDF. Só sai com o analista tendo marcado, e só com ponto marcado. */
function impHtmlPDF(imp, e) {
  const esc = e || cvEsc;
  if (!imp || !imp.ok || !imp.incluir) return '';
  const sel = impSelecionados(imp);
  const fontes = impFontesUsadas(imp);
  if (!sel.total) return '';
  const grupo = (rot, pontos) => pontos.length ? `<div class="imp-g"><div class="imp-r">${esc(rot)}</div>
    <ul>${pontos.map(p => `<li>${esc(p.texto)}
      <span class="imp-v">(${p.fontes.map(f => esc(f.veiculo || 'origem não identificada')).join(', ')})</span></li>`).join('')}</ul></div>` : '';
  return `<h2 class="imp-h">Repercussão pública da matéria</h2>
  <div class="imp-pdf">
    ${imp.apelido && imp.usarApelido ? `<div class="imp-ap">Conhecida publicamente como <b>${esc(imp.apelido)}</b>.</div>` : ''}
    ${grupo('O que a cobertura destaca', sel.focos)}
    ${grupo('O que está contestado', sel.contencioso)}
    ${fontes.length ? `<div class="imp-g"><div class="imp-r">Fontes</div>
      <ol class="imp-fs">${fontes.map(f => {
        const cabeca = [esc(f.veiculo || 'origem não identificada'),
                        f.data ? esc(f.data) : null, f.titulo ? esc(f.titulo) : null].filter(Boolean).join(' — ');
        // Endereço de redirecionador não vai ao papel. São 130 caracteres de
        // token opaco que ninguém digita, que não se distinguem uns dos outros
        // e que ainda por cima estampam o domínio do buscador no lugar do
        // veículo — parecendo dizer que a fonte é o Google. O que serve no
        // impresso é o veículo; o link clicável fica na tela.
        return `<li>${cabeca}${impRedirecionador(f.url) ? '' : `<br><span class="imp-u">${esc(f.url)}</span>`}</li>`;
      }).join('')}</ol>
      ${fontes.some(f => impRedirecionador(f.url)) ? `<div class="imp-bs">O provedor de busca não
        informa o endereço da página, apenas o veículo. Os links estão na tela da extensão.</div>` : ''}</div>` : ''}
    ${imp.buscas.length ? `<div class="imp-bs"><b>Buscas feitas:</b> ${esc(imp.buscas.join(' · '))}.</div>` : ''}
  </div>`;
}
