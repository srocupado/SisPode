/* ============================================================
   CAMADA DE IA DO MÓDULO DE ORÇAMENTO

   O módulo já sabia ONDE o processo está e QUANTO cada parlamentar tem. O que
   faltava é o que o gabinete efetivamente pergunta: "o que eu faço com esse
   dinheiro?", "quais são os números deste exercício?" e "o que eu digo na
   tribuna?". Nenhuma dessas três respostas sai de regex — todas exigem LER
   documento. É isso que esta camada faz.

   A DIVISÃO DE TRABALHO, QUE É A REGRA DO PROJETO INTEIRO

     A IA lê e redige.  O JS confere.  Nada passa sem conferência.

   Não é desconfiança decorativa: é a única forma de publicar. Uma nota da
   Liderança que cite "piso de R$ 250.000,00" quando o exercício fixou
   R$ 200.000,00 não produz uma imprecisão — produz uma emenda inválida. Por
   isso, aqui, o modelo NUNCA entrega um número solto: entrega o número, a
   página e o TRECHO LITERAL de onde tirou. E o JS vai procurar esse trecho no
   texto extraído do PDF. Não achou, não entra.

   As três conferências, e o que cada uma pega:

     conferirAcoes        — o trecho citado existe no documento? o código da
                            ação existe? os valores citados existem? Pega a
                            ação inventada e a cartilha do ano errado.
     conferirPropostasFicha — o valor proposto está DENTRO do trecho citado, e
                            o trecho está no documento? Pega o número que o
                            modelo "lembrou" do exercício anterior.
     conferirSintese      — todo número escrito na prosa existe entre os
                            números já verificados? Pega a cifra inventada no
                            meio de um parágrafo bem escrito, que é o erro mais
                            difícil de enxergar lendo.

   A terceira é a mais importante e inverte o risco de propósito: os números da
   síntese NÃO são extraídos pela IA. Eles já foram extraídos e conferidos pelo
   JS (mensagem.js confere a soma contra o total impresso; ficha.js exige
   procedência). A IA só recebe essa lista pronta e escreve em cima dela. Se
   aparecer no texto um número que não está na lista, é invenção — e aparece
   marcado, não some.

   O que esta camada NÃO faz: decidir voto, recomendar posição, ou afirmar que
   um dispositivo se aplica a um caso. Localizar no documento não é interpretar.
   ============================================================ */

'use strict';

// ---------- normalização para conferência literal ----------
/**
 * Reduz um texto ao seu esqueleto alfanumérico minúsculo, sem acento.
 *
 * Por que tão agressivo: o texto que sai do pdf.js quebra palavra no meio,
 * troca espaço por tabulação, separa "R$" de "200.000,00" e às vezes hifeniza
 * na quebra de linha. Comparar string com string falharia por ruído de
 * extração, e a conferência viraria alarme falso permanente — que é pior que
 * não conferir, porque o analista aprende a ignorar.
 *
 * Continua sendo conferência literal: "R$ 200.000,00" vira "r20000000", que
 * NÃO casa com "r25000000". O que se perde é só a pontuação; o número, não.
 */
function compacto(s) {
  // NFD separa a letra do acento; o filtro final descarta o acento junto com a
  // pontuação, sem precisar enumerar diacríticos.
  return String(s ?? '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** O trecho citado existe mesmo no documento? */
function contemTrecho(fonte, trecho) {
  const t = compacto(trecho);
  if (t.length < 25) return false;      // trecho curto casa com qualquer coisa
  return compacto(fonte).includes(t);
}

/** Fonte pequena demais não confere nada — e dizer isso é melhor que reprovar tudo. */
const FONTE_MINIMA = 500;

// ---------- leitura da resposta do modelo ----------
/**
 * Extrai o JSON da resposta, tolerando cerca de código e prosa em volta.
 * Modelos costumam responder "Aqui está o JSON: ```json {...} ```" mesmo quando
 * instruídos a não fazê-lo; recusar isso seria perder a resposta por formatação.
 */
function extrairJSON(texto) {
  const s = String(texto || '');
  const semCerca = s.replace(/```(?:json)?/gi, '');
  const inicio = semCerca.search(/[[{]/);
  if (inicio < 0) return null;
  const abre = semCerca[inicio];
  const fecha = abre === '[' ? ']' : '}';
  let nivel = 0, emString = false, escapa = false;
  for (let i = inicio; i < semCerca.length; i++) {
    const c = semCerca[i];
    if (escapa) { escapa = false; continue; }
    if (c === '\\') { escapa = true; continue; }
    if (c === '"') { emString = !emString; continue; }
    if (emString) continue;
    if (c === abre) nivel++;
    else if (c === fecha && --nivel === 0) {
      try { return JSON.parse(semCerca.slice(inicio, i + 1)); } catch (_) { return null; }
    }
  }
  return null;
}

// ============================================================
//  PRODUTO 1 — O QUE DÁ PARA FAZER COM O DINHEIRO
// ============================================================
// A lacuna que guia-emendas.js declarava abertamente: ele indexa as cartilhas
// por área temática, mas não diz o que a Ação 2E90 permite custear. Indexar não
// é informar, e o gabinete precisa do conteúdo.

const PROMPT_CARTILHA = `Você lê CARTILHAS DE EMENDAS PARLAMENTARES publicadas pela Comissão Mista de
Orçamento e por órgãos do Poder Executivo. O leitor é a assessoria de um gabinete que vai redigir a emenda
e precisa saber, com precisão, o que cada ação orçamentária permite custear.

Liste as AÇÕES ORÇAMENTÁRIAS descritas no documento. Para cada uma, responda somente com o que está escrito.

Responda APENAS com um array JSON, sem texto em volta, no formato:
[
  {
    "codigo": "2E90",
    "nome": "Atenção à Saúde da População para Procedimentos de Média e Alta Complexidade",
    "orgao": "Ministério da Saúde / Fundo Nacional de Saúde",
    "permite": ["custeio de procedimentos de média e alta complexidade", "..."],
    "naoPermite": ["aquisição de equipamentos", "..."],
    "observacoes": "piso, exigência de habilitação ou condição que o documento imponha",
    "pagina": "12",
    "trecho": "transcrição LITERAL de 30 a 300 caracteres do documento onde a ação é descrita"
  }
]

REGRAS QUE NÃO PODEM SER QUEBRADAS:
- O campo "trecho" é uma CÓPIA EXATA de um trecho do documento, palavra por palavra. Ele será procurado no
  texto do PDF; se não for encontrado, a ação inteira é descartada. Não parafraseie, não corrija, não resuma.
- Não inclua ação que não esteja no documento. Não complete com conhecimento próprio sobre exercícios
  anteriores: cotas, pisos e regras mudam a cada ano.
- Se o documento não for uma cartilha de ações orçamentárias, responda [].
- "permite" e "naoPermite" só recebem itens explicitamente escritos no documento. Se o documento não diz o
  que é vedado, deixe "naoPermite" vazio em vez de deduzir.`;

/** Prompt da cartilha, com o rótulo do documento para o modelo se situar. */
function promptCartilha(meta = {}) {
  const cab = meta.rotulo
    ? `Documento: ${meta.rotulo}${meta.exercicio ? ` — exercício ${meta.exercicio}` : ''}.\n\n`
    : '';
  return cab + PROMPT_CARTILHA;
}

/** Números com cara de dinheiro ou percentual dentro de um texto. */
function cifrasDe(texto) {
  return (String(texto || '').match(/\d[\d.]*,\d+|\d{4,}/g) || []);
}

/**
 * Confere cada ação contra o texto do PDF.
 *
 * Devolve { conferido, motivo, aprovadas, recusadas } — recusada NUNCA some:
 * ela aparece com o motivo, porque saber que o modelo alucinou aquela ação é
 * informação para quem revisa.
 */
function conferirAcoes(acoes = [], textoFonte = '') {
  if (!textoFonte || textoFonte.length < FONTE_MINIMA) {
    return { conferido: false, aprovadas: [], recusadas: [],
             motivo: 'O texto do documento não pôde ser extraído (ou veio vazio) — nada foi conferido, e por isso nada é publicável.' };
  }
  const fonte = compacto(textoFonte);
  const aprovadas = [], recusadas = [];

  for (const a of (acoes || [])) {
    const codigo = String(a?.codigo || '').trim();
    const recusa = motivo => recusadas.push({ ...a, motivo });

    if (!codigo) { recusa('a ação veio sem código orçamentário'); continue; }
    if (!contemTrecho(textoFonte, a?.trecho)) {
      recusa(String(a?.trecho || '').trim()
        ? 'o trecho citado não foi localizado no texto do documento'
        : 'a ação veio sem trecho literal, e sem ele não há o que conferir');
      continue;
    }
    if (!fonte.includes(compacto(codigo))) {
      recusa(`o código "${codigo}" não aparece no documento`);
      continue;
    }
    // Valor citado na descrição também tem de estar no documento: é aí que
    // entra o piso do ano passado, que o modelo conhece de cor.
    const citados = [...(a.permite || []), ...(a.naoPermite || []), a.observacoes || '']
      .flatMap(t => cifrasDe(t));
    const inventados = citados.filter(n => !fonte.includes(compacto(n)));
    if (inventados.length) {
      recusa(`valor(es) citado(s) que não constam do documento: ${inventados.join(', ')}`);
      continue;
    }
    aprovadas.push({
      codigo,
      nome: String(a.nome || '').trim(),
      orgao: String(a.orgao || '').trim(),
      permite: (a.permite || []).map(String),
      naoPermite: (a.naoPermite || []).map(String),
      observacoes: String(a.observacoes || '').trim(),
      pagina: a.pagina ? String(a.pagina) : null,
      trecho: String(a.trecho || '').trim(),
    });
  }
  return {
    conferido: true, aprovadas, recusadas, motivo: null,
    resumo: `${aprovadas.length} ação(ões) conferida(s) contra o texto do documento`
      + (recusadas.length ? `; ${recusadas.length} descartada(s) por não conferir.` : '.'),
  };
}

// ============================================================
//  PRODUTO 2 — A FICHA PREENCHIDA A PARTIR DA FONTE
// ============================================================
// Vinte campos digitados à mão, um a um, com documento e página. A IA lê o
// Manual de Emendas e PROPÕE; a proposta só vira preenchimento depois de o JS
// achar o valor dentro do trecho e o trecho dentro do documento. O analista
// aceita — a ficha continua sendo dele.

/** Prompt da ficha: pede exatamente os campos vazios, um por um. */
function promptFicha(campos = [], contexto = {}) {
  const lista = campos.map(c => `- "${c.chave}" — ${c.rotulo}${c.ajuda ? `: ${c.ajuda}` : ''}`).join('\n');
  return `Você lê a ORIENTAÇÃO NORMATIVA de um exercício orçamentário${contexto.rotulo ? ` (${contexto.rotulo})` : ''}${contexto.exercicio ? `, exercício ${contexto.exercicio}` : ''} e extrai os parâmetros operacionais das emendas parlamentares.

Encontre no documento, e SOMENTE no documento, os seguintes campos:
${lista}

Responda APENAS com um array JSON, sem texto em volta:
[
  { "campo": "cota_individual_deputado", "valor": "R$ 40.252.007,00", "pagina": "18",
    "trecho": "transcrição LITERAL de 30 a 300 caracteres onde esse valor aparece" }
]

REGRAS QUE NÃO PODEM SER QUEBRADAS:
- O "trecho" é CÓPIA EXATA do documento e precisa CONTER o "valor" que você informou. Ambos serão
  procurados no texto do PDF; se o valor não estiver dentro do trecho, ou o trecho não estiver no
  documento, a proposta é descartada.
- Omita o campo que não encontrar. Campo omitido é resposta correta; campo preenchido "por coerência" é erro.
- NÃO use conhecimento de exercícios anteriores. Estes valores mudam todo ano — a cota individual por
  deputado passou de R$ 19.704.897,00 (LOA 2023) para R$ 40.252.007,00 (LOA 2026). Um valor lembrado de
  outro ano é exatamente o erro que este módulo existe para impedir.
- Reproduza o valor como está escrito no documento, com a mesma pontuação.`;
}

/**
 * Confere as propostas: o valor tem de estar DENTRO do trecho, e o trecho
 * dentro do documento. As duas condições juntas — só a segunda deixaria passar
 * um trecho verdadeiro com um número trocado.
 */
function conferirPropostasFicha(propostas = [], textoFonte = '', campos = []) {
  if (!textoFonte || textoFonte.length < FONTE_MINIMA) {
    return { conferido: false, aceitas: [], recusadas: [],
             motivo: 'O texto da orientação normativa não pôde ser extraído — nenhuma proposta foi conferida.' };
  }
  const validos = new Map((campos || []).map(c => [c.chave, c]));
  const aceitas = [], recusadas = [];

  for (const p of (propostas || [])) {
    const chave = String(p?.campo || '').trim();
    const valor = String(p?.valor ?? '').trim();
    const trecho = String(p?.trecho || '').trim();
    const recusa = motivo => recusadas.push({ campo: chave, valor, trecho, motivo });

    if (!validos.has(chave)) { recusa(`campo desconhecido na ficha: "${chave}"`); continue; }
    if (!valor) { recusa('proposta sem valor'); continue; }
    if (!contemTrecho(textoFonte, trecho)) {
      recusa(trecho ? 'o trecho citado não foi localizado no documento' : 'proposta sem trecho literal');
      continue;
    }
    if (!compacto(trecho).includes(compacto(valor))) {
      recusa(`o valor "${valor}" não aparece dentro do trecho citado`);
      continue;
    }
    aceitas.push({ campo: chave, rotulo: validos.get(chave).rotulo, valor, trecho,
                   pagina: p.pagina ? String(p.pagina) : null });
  }
  return {
    conferido: true, aceitas, recusadas, motivo: null,
    resumo: `${aceitas.length} campo(s) localizado(s) e conferido(s) no documento`
      + (recusadas.length ? `; ${recusadas.length} proposta(s) descartada(s).` : '.'),
  };
}

// ============================================================
//  PRODUTO 3 — A SÍNTESE, COM OS NÚMEROS AMARRADOS
// ============================================================
// Aqui o risco está invertido de propósito: a IA NÃO extrai número nenhum. Ela
// recebe os números que o JS já extraiu e conferiu (mensagem.js contra o total
// impresso; ficha.js contra o documento) e escreve o texto em cima deles.
// Depois, todo número que ela escreveu é procurado nessa mesma lista.

/**
 * Colhe da base tudo que a síntese pode legitimamente citar.
 * Devolve um Set de números — é a lista branca da conferência.
 */
function numerosDaBase({ variacao = null, serie = null, ficha = null, quadro = null } = {}) {
  const nums = new Set();
  const add = n => { if (Number.isFinite(n)) nums.add(Math.abs(n)); };
  const doTexto = t => { for (const n of (String(t ?? '').match(/-?\d[\d.]*(?:,\d+)?/g) || [])) {
    const v = Number(n.replace(/\./g, '').replace(',', '.'));
    add(v);
  } };

  if (variacao && variacao.comparado) {
    for (const i of [...(variacao.itens || [])]) { add(i.de); add(i.para); add(i.pct); }
    if (variacao.porOrgao) {
      for (const l of (variacao.porOrgao.linhas || [])) { add(l.valor); doTexto(l.codigo); }
      add(variacao.porOrgao.total);
      add(variacao.porOrgao.soma);
    }
  }
  for (const s of (serie || [])) {
    for (const p of (s.pontos || [])) { add(p.valor); doTexto(p.ano); }
    if (s.variacao) add(s.variacao.pct);
  }
  for (const v of Object.values(ficha?.valores || {})) doTexto(v?.valor);
  if (quadro) {
    doTexto(quadro.anoOrcamento);
    doTexto(quadro.materia?.identificacao);
    if (quadro.cronograma?.prazoEmendas) {
      doTexto(quadro.cronograma.prazoEmendas.inicio);
      doTexto(quadro.cronograma.prazoEmendas.fim);
    }
  }
  return nums;
}

/** Casas decimais escritas — define a tolerância de arredondamento aceitável. */
function casasDecimais(txt) {
  const m = /,(\d+)/.exec(txt);
  return m ? m[1].length : 0;
}

/**
 * Um número escrito pela IA confere com a base?
 *
 * Aceita o valor exato e o arredondamento na precisão em que foi escrito
 * ("826.175,4 milhões" escrito como "826,2 bilhões" é o mesmo número), porque
 * exigir a cifra cheia produziria alarme em texto bem redigido. Não aceita
 * nada além disso: 826,2 não casa com 830.
 */
function numeroConfere(txt, permitidos) {
  const n = Number(String(txt).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return true;
  const alvo = Math.abs(n);
  const tol = Math.max(0.5 * Math.pow(10, -casasDecimais(txt)), 1e-9);
  for (const p of permitidos) {
    if (Math.abs(alvo - p) <= tol) return true;
    if (Math.abs(alvo - p / 1000) <= tol) return true;      // milhões → bilhões
    if (Math.abs(alvo - p * 1000) <= tol) return true;      // bilhões → milhões
    if (Math.abs(alvo - p / 1e6) <= tol) return true;       // reais → milhões
  }
  return false;
}

/**
 * Confere a prosa da IA contra a base numérica.
 *
 * Não flagra ano (1900-2100), nem inteiro pequeno (≤ 31: dia, ordinal, contagem
 * de itens) — esses são identificáveis e de risco baixo, e flagrá-los encheria
 * a tela de ruído. O que este filtro persegue é dinheiro e percentual, que é
 * onde a invenção causa dano.
 */
function conferirSintese(texto, permitidos) {
  const set = permitidos instanceof Set ? permitidos : new Set(permitidos || []);
  const suspeitos = [];
  let total = 0;
  const re = /\d[\d.]*(?:,\d+)?/g;
  let m;
  while ((m = re.exec(String(texto || ''))) !== null) {
    const bruto = m[0];
    const n = Number(bruto.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    const inteiro = !bruto.includes(',');
    if (inteiro && ((n >= 1900 && n <= 2100) || n <= 31)) continue;   // ano, dia, contagem
    total++;
    if (numeroConfere(bruto, set)) continue;
    const ini = Math.max(0, m.index - 45), fim = Math.min(texto.length, m.index + bruto.length + 45);
    suspeitos.push({ numero: bruto, contexto: '…' + texto.slice(ini, fim).replace(/\s+/g, ' ').trim() + '…' });
  }
  return {
    total, conferidos: total - suspeitos.length, suspeitos,
    limpo: suspeitos.length === 0,
    motivo: suspeitos.length
      ? `${suspeitos.length} de ${total} número(s) do texto não constam da base conferida: ${suspeitos.map(s => s.numero).join(', ')}. Confirme na fonte antes de divulgar.`
      : null,
  };
}

/** O prompt da síntese: os números vão PRONTOS, a IA só redige. */
function promptSintese(dados = {}) {
  const linhas = [];
  const v = dados.variacao;
  if (v && v.comparado) {
    linhas.push(`Comparação ${v.de} → ${v.para} (valores em R$ milhões, extraídos da Mensagem Presidencial e conferidos contra o total impresso no documento):`);
    for (const i of (v.itens || [])) {
      linhas.push(`  · ${i.rotulo}: ${i.de} → ${i.para}` + (i.pct === null ? ' (variação não calculável, base zero)' : ` (${i.pct >= 0 ? '+' : ''}${i.pct.toFixed(1)}%)`));
    }
    if (v.porOrgao) {
      linhas.push(`Distribuição por órgão${v.porOrgao.titulo ? ` — ${v.porOrgao.titulo}` : ''} (R$ milhões):`);
      for (const l of v.porOrgao.linhas) linhas.push(`  · ${l.codigo} ${l.orgao}: ${l.valor}`);
    }
  }
  for (const s of (dados.serie || [])) {
    if (!s.pontos?.length) continue;
    linhas.push(`${s.rotulo}: ` + s.pontos.map(p => `${p.texto} em ${p.ano}`).join('; ')
      + (s.lacunas?.length ? ` (sem registro em ${s.lacunas.join(', ')})` : ''));
  }
  for (const [k, val] of Object.entries(dados.ficha?.valores || {})) {
    if (val?.valor) linhas.push(`Parâmetro ${k}: ${val.valor} (fonte: ${val.documento || 'não informada'})`);
  }
  const pend = (dados.pendencias || []).map(p => `  · ${p}`).join('\n');

  return `Você redige a SÍNTESE ANALÍTICA de uma nota técnica orçamentária da Liderança do Podemos na Câmara dos
Deputados. O leitor é o deputado e sua assessoria: ele precisa entender, em poucos parágrafos, o que muda
para ele neste projeto${dados.materia ? ` (${dados.materia})` : ''}.

DADOS APURADOS — estes números já foram extraídos dos documentos e conferidos. Use SOMENTE eles:
${linhas.join('\n') || '  (nenhum dado numérico apurado até o momento)'}
${pend ? `\nO QUE AINDA NÃO FOI PUBLICADO pela Comissão Mista nesta data:\n${pend}` : ''}

Escreva de três a cinco parágrafos corridos, em português formal de nota técnica, cobrindo:
1. o que o projeto representa em relação ao exercício anterior — o que cresceu, o que encolheu e o que isso
   significa em termos de espaço orçamentário;
2. o efeito sobre a atuação parlamentar: cota, prazo e o que está definido ou não;
3. o que ainda não está publicado, dito com todas as letras, e por que isso impede conclusões.

REGRAS QUE NÃO PODEM SER QUEBRADAS:
- NÃO escreva nenhum número que não esteja na lista de DADOS APURADOS acima. Cada número do seu texto será
  procurado nessa lista; o que não constar será marcado como não conferido na nota.
- NÃO recomende voto, posição ou encaminhamento. A orientação é decisão da Liderança, não da análise.
- NÃO complete lacuna com o exercício anterior. Se um parâmetro não foi publicado, o correto é dizer que
  não foi publicado.
- Sem listas, sem bullets, sem títulos: parágrafos corridos. Markdown puro, sem cercas de código.`;
}

// ============================================================
//  DOCUMENTO GRANDE DEMAIS PARA IR COMO PDF
// ============================================================
// Medido em 03/09/2026 nas cartilhas da LOA 2026: a do Fundo Nacional de Saúde
// tem 22 MB, a do Ministério da Justiça 8,4 MB, e o Manual de Emendas 2026 tem
// 259 páginas. Em base64 o PDF cresce um terço, e aí ele estoura o limite de
// requisição dos provedores (a OpenAI ainda recusa PDF com mais de 100 páginas).
//
// Mandar o PDF é o melhor caminho — o modelo vê tabelas e quadros, e a
// conferência roda contra um texto extraído por outro caminho, o que dá dois
// canais independentes. Quando não cabe, manda-se o texto extraído, e a
// diferença é REGISTRADA: no modo texto a conferência ainda pega ação e valor
// inventados (o trecho não estará lá), mas os dois lados passam a ler a mesma
// extração, e isso precisa estar dito em vez de suposto.

const LIMITE_PDF_BYTES = 12 * 1024 * 1024;   // ~16 MB depois do base64
const LIMITE_PAGINAS_OPENAI = 100;
const LIMITE_TEXTO_PROMPT = 180000;          // ~45 mil tokens

/**
 * Decide como o documento vai ao modelo. Recebe o que já foi baixado e
 * extraído — não busca nada — para ser testável sem rede.
 */
function modoDeLeitura({ bytes = 0, paginas = 0, provedorId = '' } = {}) {
  const motivos = [];
  if (bytes > LIMITE_PDF_BYTES) {
    motivos.push(`o PDF tem ${(bytes / 1048576).toFixed(1).replace('.', ',')} MB, acima do limite de envio`);
  }
  if (provedorId === 'openai' && paginas > LIMITE_PAGINAS_OPENAI) {
    motivos.push(`o documento tem ${paginas} páginas e este provedor aceita no máximo ${LIMITE_PAGINAS_OPENAI}`);
  }
  return motivos.length
    ? { modo: 'texto', motivo: motivos.join('; ') + ' — enviado o texto extraído, não o arquivo.' }
    : { modo: 'pdf', motivo: null };
}

/** Anexa o texto do documento ao prompt, avisando quando precisou cortar. */
function comTextoDoDocumento(prompt, texto) {
  const t = String(texto || '');
  const cortado = t.length > LIMITE_TEXTO_PROMPT;
  return `${prompt}

TEXTO EXTRAÍDO DO DOCUMENTO${cortado ? ' (truncado — leia apenas o que está abaixo e não complete o que falta)' : ''}:
"""
${t.slice(0, LIMITE_TEXTO_PROMPT)}
"""`;
}

// ============================================================
//  PROVEDORES
// ============================================================
// Os mesmos três dos demais painéis, com a mesma chave em chrome.storage. A
// chave de API fica NO NAVEGADOR do analista — nunca no Firebase, nunca no
// repositório —, e é por isso que cada tela precisa saber ler e gravar esta
// configuração: não há um servidor guardando isso por ninguém.

const PROVEDORES_ORCAMENTO = {
  gemini: {
    label: 'Google Gemini',
    placeholderChave: 'AIzaSy... ou AQ....',
    hintChave: 'Obtenha em aistudio.google.com → Get API key',
    regexChave: /^[\w.-]{20,}$/,
    modelosFallback: [
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro',   displayName: 'Gemini 2.5 Pro' },
    ],
    async listar(key) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=50`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      return (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && (m.name || '').includes('gemini'))
        .map(m => ({ id: (m.name || '').replace(/^models\//, ''), displayName: m.displayName || m.name }));
    },
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    placeholderChave: 'sk-...',
    hintChave: 'Obtenha em platform.openai.com/api-keys',
    regexChave: /^sk-[\w-]{20,}$/,
    modelosFallback: [
      { id: 'gpt-5',   displayName: 'GPT-5' },
      { id: 'gpt-4.1', displayName: 'GPT-4.1' },
      { id: 'gpt-4o',  displayName: 'GPT-4o' },
    ],
    async listar(key) {
      const res = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      const prefs = ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4'];
      const ids = (j.data || []).map(m => m.id).filter(id => prefs.some(p => id.startsWith(p)));
      return ids.length ? ids.map(id => ({ id, displayName: id })) : this.modelosFallback;
    },
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    placeholderChave: 'sk-ant-...',
    hintChave: 'Obtenha em console.anthropic.com → Settings → API Keys',
    regexChave: /^sk-ant-[\w-]{20,}$/,
    modelosFallback: [
      { id: 'claude-opus-4-8',           displayName: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    ],
    async listar(key) {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      const lista = (j.data || []).map(m => ({ id: m.id, displayName: m.display_name || m.id }));
      return lista.length ? lista : this.modelosFallback;
    },
  },
};

// ============================================================
//  CHAMADA AOS PROVEDORES
// ============================================================
// Mesmos três provedores dos demais módulos, mesma chave em chrome.storage.
// Fica aqui, e não em analise.js, porque esta tela não carrega aquele arquivo —
// e duplicar 40 linhas é melhor que carregar 6.000.

function abParaBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  const partes = [];
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    partes.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(partes.join(''));
}

/** fetch com retry em 429/5xx — o mesmo escalonamento dos outros módulos. */
async function fetchIAOrcamento(url, init, signal) {
  const esperas = [0, 5000, 15000, 30000];
  let ultimo = null;
  for (let i = 0; i < esperas.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (esperas[i]) await new Promise(r => setTimeout(r, esperas[i]));
    let res;
    try { res = await fetch(url, { ...init, signal }); }
    catch (e) { if (e?.name === 'AbortError') throw e; ultimo = e; continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      ultimo = new Error(`HTTP ${res.status}`);
      continue;
    }
    let det = null;
    try { det = await res.json(); } catch (_) {}
    throw new Error(det?.error?.message || `HTTP ${res.status}`);
  }
  throw ultimo || new Error('Falha após as tentativas.');
}

/**
 * Uma chamada, com PDF opcional. Devolve { text, truncated }.
 * `truncated` importa: resposta cortada no meio produz JSON inválido, e é
 * melhor dizer "a resposta veio truncada" que "não entendi a resposta".
 */
async function chamarIAOrcamento({ provedorId, apiKey, modelo, prompt, pdfBuffers = [], signal }) {
  const pdfs = pdfBuffers.map(b => abParaBase64(b));

  if (provedorId === 'gemini') {
    const m = modelo || 'gemini-2.5-flash';
    const parts = pdfs.map(d => ({ inline_data: { mime_type: 'application/pdf', data: d } }));
    parts.push({ text: prompt });
    const json = await fetchIAOrcamento(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 16000 } }) },
      signal);
    const cand = json.candidates?.[0];
    return { text: (cand?.content?.parts || []).map(p => p.text || '').join('').trim(),
             truncated: (cand?.finishReason || '').toUpperCase() === 'MAX_TOKENS' };
  }

  if (provedorId === 'openai') {
    const content = pdfs.map((d, i) => ({ type: 'input_file', filename: `doc_${i + 1}.pdf`,
                                          file_data: `data:application/pdf;base64,${d}` }));
    content.push({ type: 'input_text', text: prompt });
    const json = await fetchIAOrcamento('https://api.openai.com/v1/responses',
      { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo || 'gpt-4o', input: [{ role: 'user', content }],
                               temperature: 0.1, max_output_tokens: 16000 }) },
      signal);
    let texto = '';
    for (const item of (json.output || [])) {
      for (const c of (item.content || [])) if (c.type === 'output_text' && c.text) texto += (texto ? '\n' : '') + c.text;
    }
    return { text: (texto || json.output_text || '').trim(),
             truncated: json.status === 'incomplete' || json.incomplete_details?.reason === 'max_output_tokens' };
  }

  if (provedorId === 'anthropic') {
    const content = pdfs.map(d => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d } }));
    content.push({ type: 'text', text: prompt });
    const json = await fetchIAOrcamento('https://api.anthropic.com/v1/messages',
      { method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
                   'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo || 'claude-sonnet-4-6', max_tokens: 16000,
                               messages: [{ role: 'user', content }] }) },
      signal);
    let texto = '';
    for (const item of (json.content || [])) if (item.type === 'text' && item.text) texto += (texto ? '\n' : '') + item.text;
    return { text: texto.trim(), truncated: json.stop_reason === 'max_tokens' };
  }

  throw new Error(`Provedor de IA não configurado: ${provedorId || '(nenhum)'}`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    compacto, contemTrecho, extrairJSON, cifrasDe,
    promptCartilha, conferirAcoes,
    promptFicha, conferirPropostasFicha,
    promptSintese, numerosDaBase, numeroConfere, conferirSintese,
    modoDeLeitura, comTextoDoDocumento, PROVEDORES_ORCAMENTO,
    LIMITE_PDF_BYTES, LIMITE_PAGINAS_OPENAI, LIMITE_TEXTO_PROMPT,
  };
}
