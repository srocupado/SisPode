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
// TUDO É TRANSCRIÇÃO. Nada aqui é gerado nem resumido por modelo: o documento
// de conferência precisa que cada linha possa ser conferida na fonte, e um
// resumo escrito por máquina sobre o que um parlamentar votou é exatamente o
// tipo de texto que não se pode defender depois. Quando o documento não traz
// justificação — e há casos, o PL 3.626/2023 é um deles, 14 páginas sem uma —,
// o relatório NÃO inventa: o item simplesmente sai sem resumo.
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
  const out = { palavras: null, justificacao: null, url: null, falhou: false };
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
  return (out.palavras || (out.justificacao && out.justificacao.texto) || out.falhou) ? out : null;
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
  if (r.pedido && r.pedido.texto) {
    p.push(`<div class="rsm-linha"><span class="rsm-rot">O destaque pedia</span> ${e(r.pedido.texto)}</div>`);
  }
  if (r.justificacao && r.justificacao.texto) {
    p.push(`<div class="rsm-linha"><span class="rsm-rot">Justificação da emenda</span> ${e(r.justificacao.texto)}</div>`);
  }
  if (r.falhou && !p.length) {
    p.push(`<div class="rsm-linha rsm-falha">O inteiro teor não pôde ser lido agora — o que faltou é a consulta, não o documento.</div>`);
  }
  if (!p.length) return '';
  const fontes = (r.fontes || []).map(f =>
    `<a href="${f.url}" target="_blank" rel="noopener">${e(f.rotulo)} ↗</a>`).join('');
  return `<div class="rsm">${p.join('')}${fontes ? `<div class="rsm-fontes">Transcrito de ${fontes}</div>` : ''}</div>`;
}
