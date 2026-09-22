// Resumos dos itens votados, para a aba "Como votou o deputado".
//
// A tramitação diz O QUE estava em votação ("DTQ 3: Bloco UNIÃO (SD): Emenda de
// Plenário nº 26"). Não diz o que a emenda 26 FAZIA. Este módulo vai buscar
// isso onde existe: no inteiro teor do próprio documento.
//
// A cadeia, apurada em 18/09/2026:
//   votação → objetosPossiveis (a lista de proposições do bloco)
//           → o DTQ nº N e/ou a EMP nº N citados no texto da tramitação
//           → urlInteiroTeor de cada um → PDF → texto
//   No DTQ o que interessa é o PEDIDO ("Requeiro … destaque para a Emenda de
//   Plenário nº 26"); na emenda, a JUSTIFICAÇÃO, que é a explicação do autor.
//
// DUAS CAMADAS, e a distinção entre elas é o que sustenta o documento:
//
//   TRANSCRIÇÃO — o trecho literal do documento, com link para a fonte. É o que
//   se confere. Quando o documento não traz justificação (o PL 3.626/2023 é
//   esse caso, 14 páginas sem uma), não se inventa: o item sai sem transcrição.
//
//   EXPLICAÇÃO — a mesma coisa em português comum, escrita pelo provedor de IA
//   a partir DA TRANSCRIÇÃO, e de mais nada. "Requeiro, nos termos do art. 161,
//   II, destaque para a Emenda de Plenário nº 26" não diz a ninguém o que
//   estava em jogo; é para isso que esta camada existe.
//
// O documento marca cada texto pelo que ele é, e a transcrição fica ao lado da
// explicação. Sem chave de IA configurada, só a transcrição aparece — pior de
// ler, e continua correta.
//
// Medição do acerto num lote real (PL 3.626/2023, 14 documentos):
// justificação em 8 de 8 emendas, pedido em 6 de 6 destaques, zero erros.
//
// Depende de aderencia.js (fetchJson, cvEsc) e de libs/pdf.min.js.

// Teto de páginas por documento. Emenda e destaque têm 1 ou 2; o inteiro teor
// de um projeto grande passa de 14, e varrer tudo não acrescenta — a
// justificação, quando existe, vem depois do texto e antes da assinatura.
const RSM_TETO_PAGINAS = 16;

// Quanto de justificação entra no documento. Acima disso a transcrição vira o
// documento inteiro; o corte é declarado com reticências.
const RSM_TETO_TEXTO = 700;

const _rsmCache = new Map();   // url → texto, para não baixar o mesmo PDF duas vezes

/** O texto de um PDF do portal. Erro sobe: falha de leitura não é ausência. */
async function rsmTexto(url) {
  if (_rsmCache.has(url)) return _rsmCache.get(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Nem todo urlInteiroTeor é PDF — há .doc e páginas de erro devolvidas com
  // status 200. Sem esta guarda o pdf.js estoura num erro que não diz nada.
  if (String.fromCharCode(...buf.slice(0, 4)) !== '%PDF') throw new Error('não é PDF');
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  let t = '';
  for (let p = 1; p <= Math.min(doc.numPages, RSM_TETO_PAGINAS); p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    t += c.items.map(i => i.str).join(' ') + '\n';
  }
  _rsmCache.set(url, t);
  return t;
}

// O rodapé de assinatura da Câmara, que aparece em todo documento e não é
// conteúdo: código de barras, "Assinado eletronicamente", link de verificação.
const RSM_RUIDO = [
  /\*CD[0-9A-Z]{8,}\*/g,
  /Assinado (eletronicamente|por chancela eletrônica) pelo\(a\)[\s\S]*$/i,
  /Para verificar a assinatura, acesse[\s\S]*$/i,
  /Fl\.\s*\d+\s*de\s*\d+/gi,
  /\bLexEdit\b/g,
  /https?:\/\/\S+/g,
];

function rsmLimpar(t) {
  let s = String(t || '');
  for (const re of RSM_RUIDO) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function rsmCortar(s) {
  // null devolve null, e não um objeto com texto nulo: um resumo que não existe
  // precisa ser indistinguível de resumo nenhum no estado, senão o código que
  // lê depois testa a chave e acha que achou.
  if (!s) return null;
  // A transcrição começa no meio de uma frase do documento ("nos termos do
  // art. 161..."); maiúscula inicial para que leia como frase.
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length <= RSM_TETO_TEXTO) return { texto: s, cortado: false };
  // Corta na fronteira de frase mais próxima, para não parar no meio de uma.
  const bruto = s.slice(0, RSM_TETO_TEXTO);
  const ponto = bruto.lastIndexOf('. ');
  return { texto: (ponto > RSM_TETO_TEXTO * 0.6 ? bruto.slice(0, ponto + 1) : bruto) + ' […]', cortado: true };
}

// "JUSTIFICAÇÃO" e "JUSTIFICATIVA", inclusive com as letras espaçadas, que é
// como alguns documentos da Casa formatam o título.
const RSM_RE_JUST = /J\s*U\s*S\s*T\s*I\s*F\s*I\s*C\s*A\s*(?:Ç\s*Ã\s*O|T\s*I\s*V\s*A)/i;

/** A justificação do autor. null quando o documento não traz nenhuma. */
function rsmJustificacao(t) {
  const s = String(t || '');
  const m = s.match(RSM_RE_JUST);
  if (!m) return null;
  let trecho = s.slice(m.index + m[0].length);
  const fim = trecho.search(/Sala das (Sessões|Comissões)|Sala da Comissão|Assinado eletronicamente|Assinado por chancela/i);
  if (fim > 40) trecho = trecho.slice(0, fim);
  const limpo = rsmLimpar(trecho);
  return limpo.length >= 40 ? limpo : null;
}

/** O que o destaque pede: o corpo do requerimento. */
function rsmPedido(t) {
  const s = rsmLimpar(t);
  const m = s.match(/Requei[a-zç]*\s+a\s+V\.?\s*Ex[a-z.ª]*\.?,?\s*([\s\S]*?)(?=Sala das Sessões|Sala da Sessão|Sala das Comissões|$)/i);
  if (!m) return null;
  const p = m[1].replace(/\s+/g, ' ').trim();
  return p.length >= 25 ? p : null;
}

/**
 * Acha, na lista de proposições do bloco, as que o texto do objeto cita.
 *
 * O texto vem da tramitação: "Votação do DTQ 3: Bloco UNIÃO (SD): Emenda de
 * Plenário nº 26 (art. 161, II)." Daí saem dois alvos: o destaque (DTQ 3) e a
 * emenda destacada (EMP 26).
 *
 * Emenda DO SENADO não entra: a Câmara registra todas num único documento
 * (EMS, com o número do projeto), então "Emenda do Senado nº 3" não tem
 * proposição própria a que apontar. Nesses casos o pedido do destaque, que
 * nomeia a emenda, é o que explica o item.
 */
function rsmAlvos(objetoTexto, objetosPossiveis) {
  const s = String(objetoTexto || '');
  const lista = objetosPossiveis || [];
  const achar = (sigla, numero) => lista.find(o =>
    o.siglaTipo === sigla && String(o.numero) === String(numero));
  const alvos = [];

  const dtq = s.match(/\bDTQ\s*n?[º°.]?\s*(\d+)/i);
  if (dtq) { const p = achar('DTQ', dtq[1]); if (p) alvos.push({ papel: 'destaque', prop: p }); }

  const emp = s.match(/Emenda\s+de\s+Plenário\s*n?[º°.]?\s*(\d+)/i);
  if (emp) { const p = achar('EMP', emp[1]); if (p) alvos.push({ papel: 'emenda', prop: p }); }

  return alvos;
}

/**
 * Resumo de um item: o pedido do destaque e/ou a justificação da emenda.
 * Devolve { pedido, justificacao, fontes[], falhou } — e `falhou` existe para
 * que uma leitura que não deu certo apareça como leitura que não deu certo,
 * nunca como documento sem justificação.
 */
async function rsmDoItem(objetoTexto, objetosPossiveis) {
  const alvos = rsmAlvos(objetoTexto, objetosPossiveis);
  if (!alvos.length) return null;
  const out = { pedido: null, justificacao: null, fontes: [], falhou: false };
  for (const { papel, prop } of alvos) {
    let url = prop.urlInteiroTeor;
    if (!url) {
      try {
        const d = await fetchJson('https://dadosabertos.camara.leg.br/api/v2/proposicoes/' + prop.id);
        url = (d.dados || {}).urlInteiroTeor;
      } catch (e) { out.falhou = true; continue; }
    }
    if (!url) continue;
    try {
      const t = await rsmTexto(url);
      if (papel === 'destaque' && !out.pedido) out.pedido = rsmCortar(rsmPedido(t));
      if (papel === 'emenda' && !out.justificacao) out.justificacao = rsmCortar(rsmJustificacao(t));
      out.fontes.push({ papel, rotulo: `${prop.siglaTipo} ${prop.numero}`, url });
    } catch (e) {
      out.falhou = true;
      console.warn('[resumos] inteiro teor de', prop.siglaTipo, prop.numero, 'não lido:', e.message);
    }
  }
  if (!out.pedido && !out.justificacao && !out.falhou) return null;
  return out;
}

/**
 * Resumo da matéria: as palavras-chave da indexação da Câmara e, quando o
 * inteiro teor traz, a justificação do autor.
 *
 * `ementaDetalhada` vem nula na prática (conferido no PL 3.626/2023 e no
 * PLP 74/2026), então não se conta com ela.
 */
async function rsmDaMateria(prop) {
  if (!prop) return null;
  const out = { ementa: String(prop.ementa || '').replace(/\s+/g, ' ').trim() || null,
                palavras: null, justificacao: null, url: null, falhou: false };
  const chaves = String(prop.keywords || '').replace(/\s+/g, ' ').trim();
  if (chaves) out.palavras = chaves;
  if (prop.urlInteiroTeor) {
    out.url = prop.urlInteiroTeor;
    try {
      out.justificacao = rsmCortar(rsmJustificacao(await rsmTexto(prop.urlInteiroTeor)));
    } catch (e) {
      out.falhou = true;
      console.warn('[resumos] inteiro teor da matéria não lido:', e.message);
    }
  }
  return (out.ementa || out.palavras || (out.justificacao && out.justificacao.texto) || out.falhou) ? out : null;
}

/**
 * Carrega os resumos de uma consulta inteira. Devolve { materia, itens }, com
 * `itens` indexado pelo id da votação.
 *
 * Sequencial de propósito: são PDFs de 100 a 600 KB no portal da Câmara, e uma
 * rajada paralela contra o portal legislativo é um mau vizinho. O cache por URL
 * evita o retrabalho — várias votações apontam para o mesmo documento.
 */
async function rsmCarregar(linhas, objetos, propDetalhada, objetosPossiveis, aoAndar) {
  const itens = {};
  let feitos = 0;
  for (const l of linhas) {
    const v = l.it.votacao;
    const obj = objetos[v.id];
    if (obj) {
      try {
        const r = await rsmDoItem(obj, objetosPossiveis);
        if (r) itens[v.id] = r;
      } catch (e) { console.warn('[resumos] item', v.id, e.message); }
    }
    if (aoAndar) aoAndar(++feitos, linhas.length);
  }
  const materia = await rsmDaMateria(propDetalhada);
  return { materia, itens };
}

/** O bloco de resumo de um item, na tela. */
function rsmHtmlItem(r) {
  if (!r) return '';
  const e = cvEsc;
  const p = [];
  // A explicação em linguagem comum vem primeiro porque é o que se quer ler; a
  // transcrição literal fica embaixo, recolhida, como a fonte que sustenta.
  if (r.simples) {
    p.push(`<div class="rsm-linha rsm-simples"><span class="rsm-rot">O que o destaque fazia</span> ${e(r.simples)}</div>`);
  }
  const lit = [];
  if (r.pedido && r.pedido.texto) lit.push(`<b>Requerimento:</b> ${e(r.pedido.texto)}`);
  if (r.justificacao && r.justificacao.texto) lit.push(`<b>Justificação:</b> ${e(r.justificacao.texto)}`);
  if (lit.length) {
    p.push(r.simples
      ? `<details class="rsm-literal"><summary>texto literal do documento</summary>${lit.join('<br>')}</details>`
      : `<div class="rsm-linha">${lit.join('<br>')}</div>`);
  }
  if (r.falhou && !p.length) {
    p.push(`<div class="rsm-linha rsm-falha">O inteiro teor não pôde ser lido agora — o que faltou é a consulta, não o documento.</div>`);
  }
  if (!p.length) return '';
  const fontes = (r.fontes || []).map(f =>
    `<a href="${f.url}" target="_blank" rel="noopener">${e(f.rotulo)} ↗</a>`).join('');
  return `<div class="rsm">${p.join('')}${fontes ? `<div class="rsm-fontes">Transcrito de ${fontes}</div>` : ''}</div>`;
}

// ---------------------------------------------------------------------------
//  Explicação em linguagem comum
// ---------------------------------------------------------------------------
// A transcrição acima é a fonte: literal, conferível, e ilegível para quem não
// milita no Regimento. "Requeiro, nos termos do art. 161, II, destaque para a
// Emenda de Plenário nº 26" não diz a ninguém o que estava em jogo.
//
// Então o texto do documento vai ao provedor de IA já configurado na extensão,
// que devolve uma frase em português comum. Três regras de desenho, porque isto
// é texto gerado dentro de um documento de conferência:
//
//  1. o modelo só REESCREVE o que recebe. Ele não busca nada, não completa com
//     o que "sabe" da matéria, e quando o trecho não diz o que mudava, a saída
//     tem de dizer isso em vez de preencher;
//  2. nada de mérito, de intenção ou de efeito político. O que o destaque fazia,
//     não se era bom nem por que alguém votou como votou;
//  3. o documento marca o texto como gerado e mantém o link da fonte ao lado.
//     Quem duvidar abre o documento original e confere.
//
// Sem chave configurada, nada disso roda e o relatório fica com a transcrição —
// que é pior de ler e continua correta.

const RSM_MODELO_PADRAO = 'gemini-2.5-flash';

/**
 * A configuração de IA, que é a do aplicativo inteiro.
 *
 * O módulo tem a sua própria engrenagem (modelo-ia.js), mas ela grava AQUI, no
 * mesmo lugar das outras telas — mudar num módulo muda em todos. A alternativa,
 * um modelo só deste módulo, criaria duas verdades sobre qual modelo está em
 * uso, e a primeira dúvida do analista seria sobre qual delas vale.
 */
async function rsmConfigIA() {
  return new Promise(r => {
    try { chrome.storage.local.get('config', d => r(d.config || {})); }
    catch (e) { r({}); }
  });
}

/** Recorta o que vai no prompt: só o que saiu dos documentos. */
function rsmFonteDoItem(objetoTexto, r) {
  const p = [];
  if (objetoTexto) p.push('Registro da tramitação: ' + objetoTexto);
  if (r && r.pedido && r.pedido.texto) p.push('Requerimento do destaque: ' + r.pedido.texto);
  if (r && r.justificacao && r.justificacao.texto) p.push('Justificação da emenda: ' + r.justificacao.texto);
  return p.join('\n');
}

function rsmPrompt(materia, itens) {
  const m = [];
  if (materia) {
    if (materia.ementa) m.push('Ementa: ' + materia.ementa);
    if (materia.palavras) m.push('Indexação da Câmara: ' + materia.palavras);
    if (materia.justificacao && materia.justificacao.texto) m.push('Justificação do autor: ' + materia.justificacao.texto);
  }
  return `Você recebe trechos LITERAIS de documentos legislativos da Câmara dos Deputados.
Sua tarefa é reescrever cada um em português comum, para uma pessoa que não conhece
o Regimento Interno nem vocabulário jurídico.

REGRAS, todas obrigatórias:
- Use SOMENTE o que está nos trechos abaixo. Não acrescente contexto, histórico,
  número de lei, efeito econômico ou qualquer informação que não esteja ali.
- NÃO cite dispositivo regimental (art. 161, DVS, "nos termos do"), nem número de
  emenda ou destaque. Diga o que a medida FAZIA, em termos concretos.
- NÃO avalie mérito, não diga se é bom ou ruim, não atribua intenção a ninguém e
  não explique por que alguém votou como votou.
- Se o trecho não disser o que a medida mudava, responda exatamente:
  "O documento não detalha o que a medida mudava."
- Uma ou duas frases por item. Direto, sem preâmbulo.

Responda SOMENTE com JSON válido, sem cercas de código, neste formato:
{"materia":"<uma ou duas frases>","itens":{"<id>":"<uma ou duas frases>"}}

=== MATÉRIA ===
${m.join('\n') || '(sem dados)'}

=== ITENS ===
${itens.map(i => `[id ${i.id}]\n${i.fonte}`).join('\n\n')}`;
}

/** Tira cerca de código e devolve o objeto, ou null. */
function rsmJson(texto) {
  let s = String(texto || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = s.indexOf('{'), f = s.lastIndexOf('}');
  if (i < 0 || f <= i) return null;
  const bruto = s.slice(i, f + 1);
  try { return JSON.parse(bruto); } catch (e) { /* segunda chance abaixo */ }
  // Vírgula sobrando antes de fechar é o defeito mais comum de JSON gerado por
  // modelo, e é o único que dá para consertar sem adivinhar conteúdo. Tudo mais
  // segue devolvendo null: JSON remendado às cegas viraria dado inventado.
  try { return JSON.parse(bruto.replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
}

/**
 * Gera as explicações e as costura no resultado. Devolve o que aconteceu, para
 * a tela poder dizer — uma explicação que não veio precisa aparecer como não
 * veio, e não como item sem explicação.
 */
async function rsmExplicar(resultado, objetos, aoAndar) {
  const cfg = await rsmConfigIA();
  if (!cfg.apiKey) return { feito: false, motivo: 'sem-chave' };

  const itens = [];
  for (const [id, r] of Object.entries(resultado.itens || {})) {
    const fonte = rsmFonteDoItem(objetos[id], r);
    if (fonte) itens.push({ id, fonte });
  }
  const temMateria = resultado.materia &&
    (resultado.materia.ementa || resultado.materia.palavras ||
     (resultado.materia.justificacao && resultado.materia.justificacao.texto));
  if (!itens.length && !temMateria) return { feito: false, motivo: 'sem-fonte' };

  if (aoAndar) aoAndar('Pedindo a explicação em linguagem comum…');
  let resposta;
  try {
    resposta = await chamarIA({
      provedorId: cfg.provedor || 'gemini',
      apiKey: cfg.apiKey,
      modelo: cfg.modelo || RSM_MODELO_PADRAO,
      prompt: rsmPrompt(resultado.materia, itens),
      opcoes: { maxSaida: 8000 },
    });
  } catch (e) {
    console.warn('[resumos] explicação não gerada:', e.message);
    return { feito: false, motivo: 'erro', erro: e.message };
  }

  const j = rsmJson(resposta && resposta.text);
  if (!j) return { feito: false, motivo: 'resposta-ilegivel' };

  // Só entra o que casa com um item que existe. Id inventado pelo modelo é
  // descartado em silêncio — colar texto no item errado seria pior que não ter.
  let aplicados = 0;
  const conhecidos = new Set(itens.map(i => i.id));
  for (const [id, txt] of Object.entries(j.itens || {})) {
    if (!conhecidos.has(id) || !txt || typeof txt !== 'string') continue;
    resultado.itens[id].simples = txt.trim();
    aplicados++;
  }
  if (j.materia && typeof j.materia === 'string' && resultado.materia) {
    resultado.materia.simples = j.materia.trim();
  }
  resultado.gerado = { modelo: cfg.modelo || RSM_MODELO_PADRAO, provedor: cfg.provedor || 'gemini' };
  return { feito: true, aplicados, total: itens.length };
}
