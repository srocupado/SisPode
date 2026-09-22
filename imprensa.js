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

// Modelos de RESERVA, para o caso de o escolhido não buscar numa chamada. Não
// são escolha fixa: o analista continua mandando no modelo. A lista envelhece,
// e é por isso que ela é só rede — o que faz a busca acontecer é o formato
// pedido ao modelo, não o nome dele.
const IMP_MODELOS_BUSCA = ['gemini-3.8-flash', 'gemini-2.5-flash'];
const IMP_TETO_PONTOS = 6;          // por lista; mais que isso ninguém confere

// A BUSCA E A ESTRUTURA SÃO DUAS CHAMADAS, DE PROPÓSITO.
//
// Medido em 22/09/2026, e é o achado que explica tudo o que este módulo penou.
// O que decide se o modelo aciona a ferramenta de busca não é o modelo: é o
// PEDIDO. Mesma matéria, mesmo gemini-3.1-flash-lite —
//
//     pedido curto, resposta em prosa ............ buscou 4/4
//     o mesmo, pedindo JSON ...................... buscou 0/3
//     pedido longo e cheio de regras, em prosa ... buscou 0/4
//
// — ou seja, duas coisas desligam a busca: exigir JSON e encher o pedido de
// regras. Com as duas juntas, como estava, a busca nunca acontecia, e o sintoma
// aparecia como se fosse limitação do modelo. Não é: o mesmo modelo que
// "nunca buscava" busca sempre quando se pede pouco e em texto corrido.
//
// Daí a separação, e daí o tamanho de cada parte. A primeira chamada é CURTA e
// só pesquisa — é dela que saem as fontes e as consultas. A segunda recebe o
// texto da primeira e faz o trabalho de disciplina: recorta, descarta o que não
// tem domínio, e devolve em JSON. Buscar e obedecer a regras são coisas que o
// modelo não faz bem ao mesmo tempo, então não se pedem na mesma chamada.

function impPromptBusca({ prop, ementa, simples }) {
  const id = prop ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}` : 'a matéria';
  // Curto de propósito. Cada regra a mais aqui custa busca, e a busca é a única
  // coisa que só esta chamada pode fazer — o resto a seguinte faz igual.
  return `Pesquise na web a repercussão pública do ${id} no Brasil${ementa ? ` (${ementa})` : ''}.
Busque os dois lados: termos de crítica ("críticas", "polêmica", "problemas") e
de defesa ("benefícios", "avanços"). Relate:

1. APELIDO pelo qual a matéria ficou conhecida publicamente, se houver.
2. FOCOS: o que a cobertura destaca.
3. CONTESTADO: os pontos criticados ou disputados, e por quem.

Uma linha por ponto, e ao final de cada linha os domínios de onde ela saiu,
entre parênteses. Texto corrido.

Não descreva o que a matéria faz — só o que se diz sobre ela. Não invente
número nem citação. Não opine.`;
}

/**
 * A segunda chamada: recebe o relato da primeira e faz a disciplina toda. Sem
 * web — não há o que buscar, só o que recortar. É aqui que moram as regras que
 * na chamada de busca custariam a própria busca.
 */
function impPromptEstruturar({ prop, relato }) {
  const id = prop ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}` : 'a matéria';
  return `Abaixo está um levantamento da repercussão pública de ${id}, feito por outro
assistente a partir de busca na web. Sua ÚNICA tarefa é reorganizá-lo em JSON.

REGRAS, todas obrigatórias:
- NÃO acrescente ponto, domínio, número ou apelido que não esteja no texto.
  Você não pesquisou nada: tudo o que você sabe está aí embaixo.
- Os domínios de cada ponto estão no texto, entre parênteses. Passe-os para
  "veiculos", um por um. Ponto sem domínio no texto vai com "veiculos" vazio.
- Nunca use como veículo o domínio de um buscador ou redirecionador
  ("vertexaisearch.cloud.google.com", "cloud.google.com", "google.com"): eles
  não publicaram nada.
- "apelido": só o nome pelo qual a matéria ficou conhecida, sem aspas e sem
  alternativas. Se o texto não trouxer um de uso corrente, ou trouxer apenas o
  número da matéria, devolva null.
- "focos" é o ENQUADRAMENTO público, não o conteúdo da lei. Se uma linha do
  texto descreve o que a matéria faz, em vez do que se diz sobre ela, deixe-a
  de fora.
- Se o texto disser que não há repercussão relevante, devolva as listas vazias
  e "semCobertura": true.
- Uma frase por ponto, no máximo duas. Português comum, sem marcação.

=== LEVANTAMENTO ===
${relato}

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

/** Palavras com peso, para comparar uma frase com outra. */
function impPalavras(v) {
  return new Set(String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
}

/**
 * De onde veio este ponto, segundo o PROVEDOR.
 *
 * O caminho bom é `trechos`: o Gemini devolve, em groundingSupports, qual fonte
 * sustenta qual pedaço do texto que ele escreveu. Como a etapa de estruturação
 * copia as frases quase literalmente, basta casar a frase do ponto com a do
 * trecho. Isso é atribuição do provedor, e não autodeclaração do modelo — que,
 * medido, o modelo não faz quando o pedido é curto, e o pedido precisa ser
 * curto para que ele busque.
 *
 * O caminho de reserva é o que o próprio texto declarou entre parênteses, que
 * às vezes vem. Nenhum dos dois inventa: ponto sem nenhum dos dois é descartado.
 */
function impFontesDoPonto(texto, trechos, fontes, declarados) {
  const achadas = [];
  const alvo = impPalavras(texto);
  for (const t of (trechos || [])) {
    const p = impPalavras(t.texto);
    if (p.size < 3) continue;
    let comuns = 0;
    for (const w of p) if (alvo.has(w)) comuns++;
    // Metade das palavras de conteúdo em comum: a frase estruturada é a mesma
    // frase do relato, com no máximo um corte.
    if (comuns / Math.min(p.size, alvo.size || 1) < 0.5) continue;
    for (const u of t.urls) {
      const f = (fontes || []).find(x => x.url === u);
      if (f && !achadas.includes(f)) achadas.push(f);
    }
  }
  if (achadas.length) return achadas;
  for (const nome of (declarados || [])) {
    const f = impCasarVeiculo(nome, fontes || []);
    if (f && !achadas.includes(f)) achadas.push(f);
  }
  return achadas;
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
function impValidarPontos(lista, fontes, trechos) {
  const pontos = [];
  let descartados = 0, cortados = 0, comDeclaracao = 0;
  for (const item of (Array.isArray(lista) ? lista : [])) {
    const texto = impLimparTexto(item && item.ponto);
    if (!texto) continue;
    const nomes = (Array.isArray(item.veiculos) ? item.veiculos : [item.veiculos]).filter(Boolean);
    if (nomes.length) comDeclaracao++;
    const achadas = impFontesDoPonto(texto, trechos, fontes, nomes);
    if (!achadas.length) { descartados++; continue; }
    if (pontos.length >= IMP_TETO_PONTOS) { cortados++; continue; }
    // `usar` nasce verdadeiro: o ponto passou pela conferência de fonte. O
    // analista desmarca o que não se sustenta na leitura dele.
    pontos.push({ texto, fontes: achadas, usar: true });
  }
  return { pontos, descartados, cortados, comDeclaracao };
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

  // A causa principal de "sem busca" era o formato pedido, e está resolvida na
  // separação em duas chamadas (ver o comentário em impPromptBusca). O que
  // sobra aqui é rede de segurança para o que ainda varia de chamada para
  // chamada: mesmo com o prompt certo, um modelo pode devolver prosa que não
  // se estrutura, ou deixar de buscar numa chamada e buscar na seguinte.
  //
  // "Ilegível" é sorteio: repetir no MESMO modelo costuma resolver.
  // "Sem busca" pode ser o modelo: passa-se ao PRÓXIMO, porque insistir num
  // modelo que não buscou é esperar duas vezes pelo mesmo "não". Como sem busca
  // este módulo não tem o que relatar, ele prefere um modelo que busque a não
  // entregar nada — e diz, na tela, qual usou.
  // "Sem atribuição" também se repete: numa segunda chamada o provedor costuma
  // devolver o mapa de trechos que faltou na primeira.
  const RETENTAVEIS = new Set(['resposta-ilegivel', 'sem-busca', 'sem-atribuicao']);
  const configurado = cfg.modelo || IMP_MODELO_PADRAO;
  const fila = [configurado];
  if ((cfg.provedor || 'gemini') === 'gemini') {
    for (const m of IMP_MODELOS_BUSCA) if (!fila.includes(m)) fila.push(m);
  }

  let ultima = null, i = 0, tentativa = 0;
  const tentados = [];
  while (i < fila.length && tentativa < 3) {
    tentativa++;
    const modelo = fila[i];
    if (!tentados.includes(modelo)) tentados.push(modelo);
    if (aoAndar) aoAndar(tentativa === 1
      ? 'Consultando a repercussão pública da matéria…'
      : (modelo === fila[0]
         ? 'A resposta veio ilegível — tentando outra vez…'
         : `O modelo ${configurado} respondeu sem buscar na web — tentando com ${modelo}…`));

    const r = await impTentar({ prop, ementa, simples, cfg, modelo });
    if (r.ok) return Object.assign(r, { tentativas: tentativa, modelo, modeloConfigurado: configurado });
    ultima = Object.assign(r, { tentativas: tentativa, tentados: tentados.slice(), modeloConfigurado: configurado });
    if (!RETENTAVEIS.has(r.motivo)) break;
    // Ilegível e sem atribuição são do sorteio: repete o mesmo modelo, que na
    // chamada seguinte costuma sair certo. Sem busca pode ser do modelo, então
    // passa para o próximo — insistir nele seria esperar duas vezes pelo mesmo
    // "não".
    if (r.motivo === 'sem-busca' || tentativa >= 2) i++;
  }
  return ultima;
}

/**
 * Uma tentativa de levantamento, em duas chamadas: a que BUSCA, em prosa, e a
 * que ESTRUTURA o resultado dela. Toda a decisão de repetir fica em impLevantar.
 */
async function impTentar({ prop, ementa, simples, cfg, modelo }) {
  const comum = {
    provedorId: cfg.provedor || 'gemini',
    apiKey: cfg.apiKey,
    modelo: modelo || cfg.modelo || IMP_MODELO_PADRAO,
  };

  // 1. BUSCA. Em prosa, porque pedir JSON aqui desligaria a ferramenta de busca
  //    — medido, e é a causa de todo o problema que este módulo teve.
  let busca;
  try {
    busca = await chamarIA(Object.assign({}, comum, {
      prompt: impPromptBusca({ prop, ementa, simples }),
      web: true,                       // é o ponto do módulo: sem web não há o que levantar
      opcoes: { maxSaida: 8000 },
    }));
  } catch (e) {
    return { ok: false, motivo: 'erro', erro: e.message };
  }

  const fontes = (busca && busca.fontes) || [];
  const buscas = (busca && busca.buscas) || [];
  const relato = String((busca && busca.text) || '').trim();
  // Provedor que não buscou não tem o que relatar. O que ele escreveria viria
  // da memória dele, e é exatamente o que este módulo não pode aceitar.
  if (!fontes.length) return { ok: false, motivo: 'sem-busca', buscas };
  if (!relato) return { ok: false, motivo: 'resposta-ilegivel' };

  // 2. ESTRUTURA. Sem web: não há nada a buscar, só a reorganizar. Aqui o JSON
  //    não custa nada, porque a busca já aconteceu.
  let estrutura;
  try {
    estrutura = await chamarIA(Object.assign({}, comum, {
      prompt: impPromptEstruturar({ prop, relato }),
      opcoes: { maxSaida: 8000 },
    }));
  } catch (e) {
    return { ok: false, motivo: 'erro', erro: e.message };
  }

  const j = rsmJson(estrutura && estrutura.text);
  if (!j) return { ok: false, motivo: estrutura && estrutura.truncated ? 'resposta-cortada' : 'resposta-ilegivel' };

  const trechos = (busca && busca.trechos) || [];
  const f = impValidarPontos(j.focos, fontes, trechos);
  const c = impValidarPontos(j.contencioso, fontes, trechos);

  // Distinção que a tela precisa fazer, porque as duas se parecem e acusam
  // coisas opostas. Caiu tudo porque o modelo inventou fonte? Ou porque o
  // provedor não informou QUAL fonte sustenta QUAL ponto? A segunda não é culpa
  // do modelo nem da matéria, e dizer "descartado por não indicar fonte" nesse
  // caso seria acusar o inocente.
  if (!f.pontos.length && !c.pontos.length
      && (f.descartados + c.descartados) > 0
      && !trechos.length && (f.comDeclaracao + c.comDeclaracao) === 0) {
    return { ok: false, motivo: 'sem-atribuicao', buscas, fontes };
  }

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
      'sem-atribuicao': 'A busca trouxe fontes, mas o provedor não informou qual delas sustenta cada '
        + 'ponto — e sem isso não dá para pôr no documento uma afirmação com a fonte certa ao lado. '
        + 'Tente de novo, ou troque de modelo no seletor acima.',
      'resposta-cortada': 'A resposta do provedor veio cortada no meio, por limite de tamanho. '
        + 'Tente de novo; se repetir, é a matéria que tem repercussão longa demais para uma volta só.',
      // A mensagem nomeia os modelos tentados porque a causa quase sempre é o
      // modelo, e não a chave: há modelos que nunca acionam a busca. Mandar
      // "verifique sua chave" quando a chave está boa manda o analista procurar
      // no lugar errado.
      'sem-busca': 'Nenhum dos modelos tentados consultou a web'
        + (imp.tentados && imp.tentados.length ? ' (' + cvEsc(imp.tentados.join(', ')) + ')' : '')
        + ' — então não há repercussão a relatar: o que eles escreveriam viria da memória, e isso não '
        + 'entra no documento. Tente de novo; se repetir, troque o modelo no seletor acima e use o '
        + 'botão de testar a busca para ver qual dos seus modelos está acionando a ferramenta.',
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
      web. Não descreve a matéria — o que ela faz está na ementa e nos documentos citados acima.${
      // Trocar de modelo por baixo do analista sem avisar seria decidir por ele.
      // "Previsto", e não "configurado": o modelo da primeira tentativa pode
      // ter sido escolhido pelo próprio módulo, e dizer que o analista o
      // configurou seria atribuir a ele uma escolha que não foi dele.
      imp.modeloConfigurado && imp.modelo !== imp.modeloConfigurado
        ? ` ${cvEsc(imp.modeloConfigurado)}, que era o previsto, respondeu sem consultar a web — então este
            levantamento saiu por ${cvEsc(imp.modelo)}. As outras seções seguem com o previsto.`
        : ''}</div>
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
  if (!sel.total) return '';
  // Cada ponto leva ao lado o veículo de onde saiu, e é só isso que vai ao
  // papel. A lista de fontes ao pé, a ressalva sobre o redirecionador e as
  // consultas feitas ficam na TELA, que é onde o analista confere — no
  // documento eram três blocos sobre o processo de apuração, e não sobre a
  // matéria, ocupando mais espaço do que o levantamento inteiro.
  const grupo = (rot, pontos) => pontos.length ? `<div class="imp-g"><div class="imp-r">${esc(rot)}</div>
    <ul>${pontos.map(p => `<li>${esc(p.texto)}
      <span class="imp-v">(${p.fontes.map(f => esc(f.veiculo || 'origem não identificada')).join(', ')})</span></li>`).join('')}</ul></div>` : '';
  return `<h2 class="imp-h">Repercussão pública da matéria</h2>
  <div class="imp-pdf">
    ${imp.apelido && imp.usarApelido ? `<div class="imp-ap">Conhecida publicamente como <b>${esc(imp.apelido)}</b>.</div>` : ''}
    ${grupo('O que a cobertura destaca', sel.focos)}
    ${grupo('O que está contestado', sel.contencioso)}
  </div>`;
}

