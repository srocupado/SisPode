/* ============================================================
   PAUTA-PARSER — extração e parsing da Pauta da Semana
   Módulo compartilhado entre os painéis Análise de Pauta (analise.js)
   e Destaques Legislativos (panel.js). Lê os dois formatos de pauta
   (dashboard compacto da Liderança e pauta extensa oficial da Câmara)
   e devolve a lista de itens com sigla, número, ano, categoria e chave.

   Exposto no escopo global da página (scripts clássicos compartilham o
   mesmo lexical scope): parsearPauta, extrairTextoPdf, TIPOS_PROPOSICAO.
   ============================================================ */

'use strict';

// "Nº" como sai da extração do PDF: ordinal (º), sinal de grau (°) ou "No",
// com ou sem ponto. MEDIDO nas pautas de 12 e 13/08/2026 — as três formas
// aparecem, e exigir só o ordinal fazia o item sumir da análise.
// O espaço entre o "N" e o "º" é real: MEDIDO na pauta de 13/08/2026, o item 7
// saiu "PROJETO DE LEI N º 5.229 - A, DE 2025" (o kerning do PDF separa os
// caracteres) e o item sumia em silêncio.
const NUM_ORD = 'N\\s*[º°o]?\\.?';
// Sufixo de tramitação depois do número — "241-A", "241 - A", "241–B": marca
// de substitutivo/redação da Câmara, NÃO faz parte do número da proposição
// (PL 241-A/2023 é o PL 241/2023). O hífen pode vir com espaços ou como
// travessão, conforme a extração do PDF.
const SUF_LETRA = '(?:\\s*[-–—]\\s*[A-Z]{1,3})?';

// Tipos de proposição que reconhecemos no PDF
const TIPOS_PROPOSICAO = [
  { sigla: 'PL',  prefixo: 'PROJETO DE LEI' },
  { sigla: 'PLP', prefixo: 'PROJETO DE LEI COMPLEMENTAR' },
  { sigla: 'PEC', prefixo: 'PROPOSTA DE EMENDA À CONSTITUIÇÃO' },
  { sigla: 'PDL', prefixo: 'PROJETO DE DECRETO LEGISLATIVO' },
  { sigla: 'MPV', prefixo: 'MEDIDA PROVISÓRIA' },
  { sigla: 'PRC', prefixo: 'PROJETO DE RESOLUÇÃO' },
  // Mensagem do Poder Executivo (ex.: acordos e convenções internacionais que
  // o Plenário discute antes de virarem PDL). MEDIDO na pauta de 01/09/2026:
  // os itens 5 e 6 eram "MENSAGEM Nº 85, DE 2023" e "MENSAGEM Nº 86, DE 2023"
  // e sumiam da análise em silêncio — o tipo não existia nesta tabela. Na API
  // da Câmara a sigla é MSC (conferido: MSC 85/2023 e MSC 86/2023 existem,
  // com as mesmas ementas das convenções da OIT).
  { sigla: 'MSC', prefixo: 'MENSAGEM' },
].map(t => ({
  ...t,
  // O prefixo aceita as variações de acento/cedilha que a extração produz.
  padrao: prefixoTolerante(t.prefixo),
  regex: new RegExp(
    prefixoTolerante(t.prefixo) + `\\s+${NUM_ORD}\\s*[\\d.]+${SUF_LETRA}\\s*,?\\s*DE\\s+\\d{4}`, 'i'),
}));

/**
 * Prefixo do tipo aceitando o que a extração de PDF faz com os acentos. A fonte
 * embutida nem sempre traz os caracteres compostos, e "PROPOSTA DE EMENDA A
 * CONSTITUICAO" aparece no lugar de "À CONSTITUIÇÃO" — com o prefixo cru, o
 * cabeçalho não casava e a PEC sumia da pauta importada, em silêncio
 * (varredura de 15/09/2026; antes disso o mesmo defeito engoliu as mensagens
 * do Executivo da pauta de 01/09/2026).
 */
/** Texto sem acento, para comparar tipo extraído do PDF com a tabela. */
function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function prefixoTolerante(prefixo) {
  return prefixo
    .replace(/À/g, '(?:À|A)').replace(/Á/g, '(?:Á|A)').replace(/Â/g, '(?:Â|A)')
    .replace(/Ã/g, '(?:Ã|A)').replace(/É/g, '(?:É|E)').replace(/Ê/g, '(?:Ê|E)')
    .replace(/Í/g, '(?:Í|I)').replace(/Ó/g, '(?:Ó|O)').replace(/Ô/g, '(?:Ô|O)')
    .replace(/Õ/g, '(?:Õ|O)').replace(/Ú/g, '(?:Ú|U)').replace(/Ç/g, '[ÇC]');
}

// pdf.js worker (só na extensão; no Node o bot fornece pdfjsLib sem chrome)
if (typeof pdfjsLib !== 'undefined' && typeof chrome !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
}

async function extrairTextoPdf(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const linhas = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page    = await doc.getPage(p);
    const content = await page.getTextContent();

    // Agrupa por linha usando coordenada y, com tolerância de 2 unidades.
    // Trechos com sub/sobrescrito ou kerning podem cair em y ligeiramente
    // diferentes; sem tolerância, isso quebra "(DO SR. LUIZ ...)" em pedaços.
    const itensOrdenados = content.items.slice().sort((a, b) => b.transform[5] - a.transform[5]);
    const grupos = []; // [{ y, itens: [] }]
    for (const it of itensOrdenados) {
      const y = it.transform[5];
      let alvo = grupos.find(g => Math.abs(g.y - y) <= 2);
      if (!alvo) { alvo = { y, itens: [] }; grupos.push(alvo); }
      alvo.itens.push(it);
    }
    for (const g of grupos) {
      g.itens.sort((a, b) => a.transform[4] - b.transform[4]);
      const linha = g.itens.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (linha) linhas.push(linha);
    }
  }
  return linhas.join('\n');
}

// ============================================================
//  PARSER DA PAUTA
// ============================================================
function parsearPauta(texto) {
  // Detecta o formato do PDF:
  //  - "compacto": dashboard da Liderança — "1 REQ 1180/2026", "9 PL 1625/2026"
  //  - "extenso": pauta oficial da Câmara — "PROJETO DE LEI Nº X, DE AAAA"
  // O padrão compacto é mais específico, então testamos primeiro.
  const temFormatoCompacto = /(?:^|\n)\s*\d{1,3}\s+(?:REQ|REC|PLP|PEC|PDL|MPV|PRC|PL|MSC)\s+[\d.]+\/\d{4}\b/.test(texto);
  if (temFormatoCompacto) return parsearPautaCompacto(texto);
  return parsearPautaExtenso(texto);
}

/**
 * Identidade da SESSÃO no cabeçalho da pauta — o que distingue duas pautas do
 * MESMO dia. MEDIDO em 02/09/2026, quando houve duas:
 *
 *   "SESSÃO DELIBERATIVA / (EXTRAORDINÁRIA) / ( 1 1 h )"        → 1 item
 *   "2ª SESSÃO DELIBERATIVA / (EXTRAORDINÁRIA) /
 *    ( Após Sessão Deliberativa d as 11h )"                     → 7 itens
 *
 * O ordinal só aparece a partir da 2ª sessão do dia; a primeira vem sem ele.
 * É por isso que ele — e não a hora — entra no id da pauta: assim as pautas já
 * salvas (todas primeiras sessões) mantêm o id que sempre tiveram.
 *
 * Devolve { ordinal, tipo, extraordinaria, hora, rotulo }; campos vazios quando
 * o cabeçalho não traz a informação (pauta antiga, formato diferente).
 */
function extrairSessao(texto) {
  // O cabeçalho está sempre nas primeiras linhas. Fora daí só há risco de
  // pescar "sessão" citada em ementa de proposição.
  const cab = String(texto || '').slice(0, 800);
  const semEspaco = s => String(s || '').replace(/\s+/g, '');
  const out = { ordinal: null, tipo: '', extraordinaria: false, hora: '', rotulo: '' };

  const mOrd = cab.match(/(\d)\s*[ªa°º]\s*SESS[ÃA]O/i);
  if (mOrd) out.ordinal = parseInt(mOrd[1], 10);

  const mTipo = cab.match(/SESS[ÃA]O\s+(DELIBERATIVA|SOLENE|PREPARAT[ÓO]RIA|N[ÃA]O\s*DELIBERATIVA)/i);
  if (mTipo) out.tipo = mTipo[1].replace(/\s+/g, ' ').toLowerCase();

  out.extraordinaria = /\(\s*EXTRAORDIN[ÁA]RIA\s*\)/i.test(cab);

  // "( 1 1 h )" e "( 14h30 )" — o kerning separa os dígitos. Exige o parêntese
  // colado ao número para não confundir com "( Após Sessão ... das 11h )", que
  // é referência a OUTRA sessão, não ao horário desta.
  const mHora = cab.match(/\(\s*(\d(?:\s*\d)?)\s*h\s*(\d(?:\s*\d)?)?\s*\)/i);
  if (mHora) out.hora = `${semEspaco(mHora[1])}h${mHora[2] ? semEspaco(mHora[2]) : ''}`;

  const partes = [];
  if (out.ordinal) partes.push(`${out.ordinal}ª sessão`);
  else if (out.tipo || out.hora) partes.push('sessão');
  if (out.tipo) partes[0] = `${partes[0]} ${out.tipo}`;
  if (out.extraordinaria) partes.push('(extraordinária)');
  if (out.hora) partes.push(`— ${out.hora}`);
  out.rotulo = partes.join(' ').trim();
  return out;
}

function parsearPautaExtenso(texto) {
  const resultado = { titulo: '', periodo: '', sessao: null, itens: [] };

  // Período
  const periodoMatch = texto.match(/PAUTA\s+PREVISTA\s+PARA\s+([\s\S]{5,80}?)(?:\(|\n)/i);
  if (periodoMatch) {
    resultado.periodo = periodoMatch[1].trim().replace(/\s+/g, ' ');
  } else {
    // Cabeçalho da pauta extensa: "Em 2 de junho de 2026 (Terça-feira)".
    // A data da sessão vem por extenso — convertê-la para dd/mm/aaaa. (A 1ª
    // ocorrência é a do cabeçalho; datas posteriores são de tramitação.)
    const MESES = { janeiro:1, fevereiro:2, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
    // O kerning do PDF separa caracteres DENTRO das palavras e dos números:
    // MEDIDO na pauta de 13/08/2026, o cabeçalho saiu "Em 1 3 de agost o de
    // 2026". Por isso cada grupo tolera espaços internos e é compactado
    // depois — sem isso a pauta ficava sem data e caía no nome do arquivo.
    //
    // O dia 1 vem ORDINAL: "Em 1º de setembro de 2026" (pauta de 01/09/2026).
    // Sem tolerar o º, o cabeçalho não casava e a PRIMEIRA data por extenso do
    // documento inteiro virava o período — naquela pauta, "em 23 de junho de
    // 1981", a assinatura de uma convenção da OIT citada na ementa do item 5.
    // Data errada exibida com confiança é pior que data ausente; por isso,
    // além do º, a busca fica restrita ao COMEÇO do documento (o cabeçalho é
    // sempre das primeiras linhas): se ele não casar, melhor cair no nome do
    // arquivo do que pescar 1981 numa ementa.
    const dataExt = texto.slice(0, 600).match(/\bEm\s+(\d(?:\s*\d)?)\s*[º°]?\s*de\s+([A-Za-zçÇãÃéÉêÊíÍóÓúÚ][A-Za-zçÇãÃéÉêÊíÍóÓúÚ\s]{2,12}?)\s+de\s+(\d(?:\s*\d){3})/i);
    if (dataExt) {
      const semEspaco = s => s.replace(/\s+/g, '');
      const mesNome = semEspaco(dataExt[2]).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const mesNum  = MESES[mesNome];
      if (mesNum) resultado.periodo = `${semEspaco(dataExt[1]).padStart(2, '0')}/${String(mesNum).padStart(2, '0')}/${semEspaco(dataExt[3])}`;
    }
  }
  // A sessão entra no título para que duas pautas do mesmo dia não apareçam
  // com o mesmo nome na lista lateral.
  resultado.sessao = extrairSessao(texto);
  const base = resultado.periodo ? `Pauta — ${resultado.periodo}` : 'Pauta da Semana';
  resultado.titulo = resultado.sessao.rotulo ? `${base} · ${resultado.sessao.rotulo}` : base;

  // === REDAÇÕES FINAIS (RICD, art. 83, I) ===
  // Padrão: "1. Redação Final ao Projeto de Lei nº 3.801, de 2004, do Sr. X,
  // que institui ...". O tipo vem por extenso; mapeamos para a sigla.
  // Mesmo kerning do "1 ." dos requerimentos (medido em 01/09/2026): o ponto
  // da ordem tolera UM espaço antes — [ \t]?, nunca \s*.
  // SEM a flag i — ver a nota do reqRegex, abaixo: com ela, os marcadores de
  // fim de bloco (título "URGÊNCIA", linha toda em maiúsculas) casavam com
  // linhas comuns do texto. As grafias do cabeçalho vão escritas por extenso.
  const rfRegex = /(\d{1,2})[ \t]?\.\s+(?:Reda[çc][ãa]o\s+[Ff]inal|REDA[ÇC][ÃA]O\s+FINAL)\s+(?:a[oa]|A[OA])\s+(.+?)\s+[nN]\s*[º°oO]?\.?\s*([\d.]+)(?:\s*[-–—]\s*[A-Z]{1,3})?\s*,?\s*(?:de|DE)\s+(\d{4})([\s\S]{0,800}?)(?=\n\d{1,2}[ \t]?\.\s|\nURG[ÊE]NCIA|\n[A-ZÀ-Ú][A-ZÀ-Ú\s]{8,}\n|$)/g;
  let rf;
  while ((rf = rfRegex.exec(texto)) !== null) {
    const ordem  = parseInt(rf[1], 10);
    const tipoExt = rf[2].replace(/\s+/g, ' ').trim().toUpperCase();
    const numero = limpaNumero(rf[3]);
    const ano    = rf[4];
    const bloco  = rf[5] || '';

    // Mapeia o tipo por extenso → sigla (ex.: "PROJETO DE LEI" → PL). A
    // comparação ignora acento: a extração do PDF entrega "PROPOSTA DE EMENDA A
    // CONSTITUICAO" tanto quanto a forma acentuada, e casar só a forma perfeita
    // fazia a PEC entrar como PL (varredura de 15/09/2026).
    const extNorm = semAcento(tipoExt);
    const tipo = TIPOS_PROPOSICAO.find(t => semAcento(t.prefixo) === extNorm)
              || TIPOS_PROPOSICAO.find(t => extNorm.startsWith(semAcento(t.prefixo)));
    const sigla = tipo ? tipo.sigla : 'PL';

    const autorMatch = bloco.match(/d[oa]s?\s+(?:Sr\.|Sra\.|Senhora?|Deputad[oa])[^,.]{0,80}/i);
    // Ementa: prefere o trecho após ", que ..."; corta ruído procedural.
    const emMatch = bloco.match(/,\s*que\s+([\s\S]+)/i);
    const ementa = (emMatch ? emMatch[1] : bloco)
      .replace(/\s+/g, ' ')
      .split(/\(\*\)|In[íi]cio do recebimento|Republicad[ao]/i)[0]
      .replace(/^[\s,]+/, '')
      .trim()
      .slice(0, 600);

    resultado.itens.push({
      ordem,
      tipoCategoria: 'redacao_final',
      sigla,
      numero,
      ano,
      ementa,
      autorTexto: (autorMatch?.[0] || '').trim(),
      apensadosTexto: [],
      relator: null,
    });
  }

  // === REQUERIMENTOS DE URGÊNCIA ===
  // Padrão: "1. Requerimento nº 1.180, de 2026, dos Srs. Líderes, ... apreciação do Projeto de Lei nº 5.900, de 2025, do Sr. X..."
  // O número antes do ponto (1, 2...) é o número de ordem na pauta.
  // O requerimento em si pode estar SEM número de protocolo ("Requerimento
  // s/nº, de 2026") — comum em requerimentos de urgência dos Líderes ainda não
  // autuados; nesse caso o grupo do número fica indefinido.
  // O "nº" é OPCIONAL: a pauta da Câmara às vezes sai sem ele — MEDIDO na
  // pauta de 12/08/2026, cujo item 7 veio "Requerimento 4.027, de 2026"
  // enquanto os outros 26 traziam "Requerimento nº". Com o "nº" obrigatório o
  // item sumia da pauta em silêncio (26 de 27 identificados), sem erro nenhum.
  // O ponto da ordem pode vir DESCOLADO do número: MEDIDO na pauta de
  // 01/09/2026, os itens 1 e 2 saíram "1 . Requerimento" e "2 . Requerimento"
  // (kerning do PDF) e sumiam em silêncio. O espaço tolerado é [ \t]? — nunca
  // \s*, que atravessaria quebra de linha e deixaria "…2026\n. Requerimento"
  // capturar dígitos do ano como ordem.
  // SEM a flag i. Os marcadores de fim do bloco são o título "URGÊNCIA" e uma
  // linha toda em MAIÚSCULAS (título de seção); com a flag i eles casavam com
  // qualquer linha que começasse por "urgência" ou que só tivesse letras. MEDIDO
  // na pauta de 13/10/2026: a quebra de linha caiu antes de "urgência para
  // apreciação do Projeto de Lei nº 1.381…", o bloco de cada requerimento era
  // cortado ali e os 8 requerimentos ficaram sem o projeto da urgência. As
  // grafias do cabeçalho ("Requerimento"/"REQUERIMENTO", "nº"/"Nº", "de"/"DE")
  // vão escritas por extenso no lugar da flag.
  const reqRegex = /(\d{1,2})[ \t]?\.\s+(?:Requerimento|REQUERIMENTO)\s+(?:[nN]\s*[º°oO]\.?\s*)?(?:([\d.]+)|[sS]\/\s*[nN]\s*[º°oO]?)\s*,\s*(?:de|DE)\s*(\d{4})([\s\S]{0,1500}?)(?=\n\d{1,2}[ \t]?\.\s+(?:Requerimento|REQUERIMENTO|Recurso|RECURSO)|\nURG[ÊE]NCIA|\n[A-ZÀ-Ú][A-ZÀ-Ú\s]{8,}\n|$)/g;
  let m;
  while ((m = reqRegex.exec(texto)) !== null) {
    const ordem   = parseInt(m[1], 10);
    const temNum  = m[2] != null;
    const numero  = temNum ? limpaNumero(m[2]) : 's/nº';
    const ano     = m[3];
    const bloco   = m[4];

    // Tenta identificar o projeto cujo regime de urgência está sendo pedido
    const projInternoSigla = TIPOS_PROPOSICAO.find(t => bloco.match(new RegExp(t.prefixo + `\\s+${NUM_ORD}`, 'i')));
    let proj = null;
    if (projInternoSigla) {
      const m2 = bloco.match(new RegExp(projInternoSigla.prefixo + `\\s+${NUM_ORD}\\s*([\\d.]+)${SUF_LETRA}\\s*,?\\s*de\\s*(\\d{4})`, 'i'));
      if (m2) proj = { sigla: projInternoSigla.sigla, numero: limpaNumero(m2[1]), ano: m2[2] };
    }
    const autorMatch = bloco.match(/d[oa]s?\s+(Sr\.|Sra\.|Senhor|Senhora|Srs?\.?\s+L[íi]deres)[^,.]{0,80}/i);

    // Sem número de protocolo, a identidade do requerimento vem do projeto que
    // ele urgencia (ou, em último caso, da ordem). Gera uma chave estável e
    // sem caracteres problemáticos (a "/" de "s/nº" não pode entrar na chave,
    // que vai para seletores de DOM e caminhos do Firebase).
    const chave = temNum
      ? undefined
      : `REQ-sn-${proj ? proj.sigla + proj.numero + '-' + proj.ano : 'ordem' + ordem}-${ano}`;

    resultado.itens.push({
      ordem,
      tipoCategoria: 'requerimento',
      sigla:    'REQ',
      numero,
      ano,
      chave,
      ementa:   bloco.replace(/\s+/g, ' ').replace(/^[\s,;.]+/, '').trim().slice(0, 600),
      autorTexto: (autorMatch?.[0] || '').trim(),
      projetoUrgenciado: proj,
      apensadosTexto: [],
      relator: null,
    });
  }

  // === RECURSOS (contra apreciação conclusiva de comissão) ===
  // "6. Recurso nº 68, de 2019, do Sr. Alexandre Padilha, que recorre contra
  // apreciação conclusiva de comissão ao Projeto de Lei nº 2.334, de 2019…".
  // MEDIDO na pauta de 03/11/2026: os itens 6 e 7 eram Recursos, que o parser
  // não conhecia — a pauta pulava do 5 para o 8, em silêncio, e a ementa do
  // requerimento 5 engolia o texto deles. Entram como 'requerimento' de sigla
  // REC, a convenção do parser compacto e da adição manual; o projeto de que se
  // recorre NÃO é "projeto da urgência", então não vai em projetoUrgenciado.
  const recRegex = /(\d{1,2})[ \t]?\.\s+(?:Recurso|RECURSO)\s+(?:[nN]\s*[º°oO]\.?\s*)?([\d.]+)\s*,\s*(?:de|DE)\s*(\d{4})([\s\S]{0,1500}?)(?=\n\d{1,2}[ \t]?\.\s+(?:Requerimento|REQUERIMENTO|Recurso|RECURSO)|\nURG[ÊE]NCIA|\n[A-ZÀ-Ú][A-ZÀ-Ú\s]{8,}\n|$)/g;
  while ((m = recRegex.exec(texto)) !== null) {
    const bloco = m[4];
    const autorMatch = bloco.match(/d[oa]s?\s+(Sr\.|Sra\.|Senhor|Senhora)[^,.]{0,80}/i);
    resultado.itens.push({
      ordem:    parseInt(m[1], 10),
      tipoCategoria: 'requerimento',
      sigla:    'REC',
      numero:   limpaNumero(m[2]),
      ano:      m[3],
      ementa:   bloco.replace(/\s+/g, ' ').replace(/^[\s,;.]+/, '').trim().slice(0, 600),
      autorTexto: (autorMatch?.[0] || '').trim(),
      apensadosTexto: [],
      relator: null,
    });
  }

  // === PROJETOS / OUTRAS PROPOSIÇÕES ===
  // Estratégia: localizar TODOS os cabeçalhos "TIPO Nº N, DE AAAA" e fatiar o
  // texto entre cabeçalhos consecutivos. Mais robusto que uma única regex com
  // lookahead complexo (que truncava blocos em sinais ambíguos).
  // Importante: tipos mais longos primeiro (PROJETO DE LEI COMPLEMENTAR antes
  // de PROJETO DE LEI) para o split por prefixo identificar a sigla correta.
  const tiposOrdenados = TIPOS_PROPOSICAO.slice().sort((a, b) => b.prefixo.length - a.prefixo.length);
  // Cabeçalhos no PDF da pauta são SEMPRE em maiúsculas. Usar match case-
  // sensitive e ancorado ao início da linha evita falsos positivos quando o
  // mesmo nome aparece em title case dentro da ementa.
  const headerRegex = new RegExp(
    `(?:^|\\n)\\s*(${tiposOrdenados.map(t => t.padrao).join('|')})\\s+${NUM_ORD}\\s*([\\d.]+)${SUF_LETRA}\\s*,?\\s*DE\\s+(\\d{4})`,
    'g'
  );
  const headers = [];
  while ((m = headerRegex.exec(texto)) !== null) {
    // Posição do prefixo (não do início da linha capturado por `(?:^|\\n)\\s*`)
    const prefixoIdx = m.index + m[0].indexOf(m[1]);
    headers.push({
      idx:     prefixoIdx,
      end:     m.index + m[0].length,
      prefixo: m[1],
      numero:  limpaNumero(m[2]),
      ano:     m[3],
    });
  }

  // Cabeçalho DENTRO do título de outro item não é item: "(DA COMISSÃO
  // ESPECIAL DESTINADA A PROFERIR PARECER À\nMENSAGEM Nº 696, DE 2010, …)" no
  // PDL 405/2022 (pautas de 02 e 03/06/2026) virava um item fantasma, sem nº de
  // ordem. Sinal: parêntese aberto e não fechado na linha anterior E nenhum
  // número de ordem antes. Sai antes do fatiamento, para o bloco do item
  // verdadeiro não ser cortado no fantasma.
  for (let i = headers.length - 1; i >= 0; i--) {
    const h = headers[i];
    const linhaAnt = (texto.slice(Math.max(0, h.idx - 300), h.idx).match(/([^\n]*)\n[ \t]*$/) || [])[1] || '';
    const abertos = (linhaAnt.match(/\(/g) || []).length - (linhaAnt.match(/\)/g) || []).length;
    const temOrdem = /(?:^|\n)[ \t]*\d(?:[ \t]*\d){0,2}[ \t]*\n[^\n]*$/.test(texto.slice(Math.max(0, h.idx - 60), h.idx));
    if (abertos > 0 && !temOrdem) headers.splice(i, 1);
  }

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    // Compara sem acento: o cabeçalho casado pode ter vindo do PDF sem crase,
    // til ou cedilha, e exigir igualdade exata aqui anulava a tolerância do
    // regex — o item era achado e logo descartado (varredura de 15/09/2026).
    const prefNorm = semAcento(h.prefixo);
    const tipo = tiposOrdenados.find(t => semAcento(t.prefixo) === prefNorm);
    if (!tipo) continue;

    const fim = i + 1 < headers.length ? headers[i + 1].idx : texto.length;
    const bloco = texto.slice(h.end, fim);

    // Ordem: número(s) isolado(s) antes do cabeçalho (na mesma linha ou linha acima)
    const antes = texto.slice(Math.max(0, h.idx - 60), h.idx);
    // A extração do PDF separa os dígitos do número de ordem a partir do 10º
    // item ("1 1", "1 2", "1 3" na pauta de 13/08/2026) — sem juntar, os itens
    // 11 em diante ficavam sem ordem e iam para o fim da lista.
    const ordemMatch = antes.match(/(?:^|\n)[ \t]*(\d(?:[ \t]*\d){0,2})[ \t]*\n[^\n]*$/);
    const ordemRaw = ordemMatch ? parseInt(ordemMatch[1].replace(/[ \t]/g, ''), 10) : null;

    const chave = `${tipo.sigla}-${h.numero}-${h.ano}`;
    if (resultado.itens.some(it => it.tipoCategoria === 'projeto' && `${it.sigla}-${it.numero}-${it.ano}` === chave)) {
      continue; // duplicata
    }

    // Autor: linha "(DO SR. X)" / "(DA SRA. X)" / "(DO SENADO FEDERAL)".
    // Permite quebras de linha entre nome e fechamento de parêntese.
    const autorMatch = bloco.match(/\(\s*(D[OA](?:S)?\s+[^()]{2,180}?)\s*\)/);
    const autorTexto = autorMatch ? autorMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Ementa: prefere o trecho "Discussão, em turno único..." até a próxima
    // seção (Pendente/Tendo/APROVADO/RELATOR). Fallback: texto inteiro do
    // bloco até essas mesmas marcações.
    let ementa = '';
    const ementaMatch = bloco.match(/Discuss[ãa]o,\s*em\s*turno[\s\S]*?(?=Pendente|Tendo\s+apens|APROVADO|RELATOR|$)/i);
    if (ementaMatch) {
      ementa = ementaMatch[0];
    } else {
      // Remove o "(autor)" do início e usa o restante
      ementa = bloco.replace(/^[\s\n]*\([^)]*\)[\s\n]*/, '').split(/Pendente|Tendo\s+apens|APROVADO|RELATOR/i)[0] || bloco;
    }
    ementa = ementa.replace(/\s+/g, ' ').trim().slice(0, 1200);

    // Apensados
    const apensadosTexto = [];
    const apensM = bloco.match(/Tendo\s+apensad[oa]s?\s*(?:\(\d+\)\s*)?(?:os?\s+)?([\s\S]*?)(?:\.\s|\n\s*APROVADO|\n\s*RELATOR|\n\s*Pendente|\n\s*$)/i);
    if (apensM) {
      const lista = apensM[1];
      // A sigla pode vir uma única vez no plural cobrindo vários números
      // ("os PLs 2.714/23 e 582/24"); por isso é OPCIONAL e, quando ausente,
      // o número herda a última sigla vista. (PLP antes de PL no alternation.)
      const reAp = /(PLPs?|PLs?|PECs?|PDLs?|MPVs?|PRCs?)?\s*([\d.]+)\s*\/\s*(\d{2,4})/gi;
      let am, ultSigla = null;
      while ((am = reAp.exec(lista)) !== null) {
        if (am[1]) ultSigla = am[1].toUpperCase().replace(/S$/, '');
        if (!ultSigla) continue;
        const ano2dig = am[3];
        const anoF = ano2dig.length === 2 ? (parseInt(ano2dig, 10) > 50 ? '19' + ano2dig : '20' + ano2dig) : ano2dig;
        apensadosTexto.push({ sigla: ultSigla, numero: limpaNumero(am[2]), ano: anoF });
      }
    }

    // Relator: pega a ÚLTIMA ocorrência (mais recente)
    // O PDF escreve o partido/UF com espaços em volta do traço ("(PSB - PE)",
    // MEDIDO na pauta de 13/08/2026) — sem tolerância, o relator sumia de
    // TODOS os itens dessa pauta.
    const relRegex = /RELATOR(?:A)?:\s*DEP\.\s*([^()\n]+?)\s*\(\s*([A-ZÁÀÂÃÄÉÊÍÓÔÕÚÇ.]+)\s*[-–—]\s*([A-Z]{2})\s*\)\s*,?\s*EM\s*(\d{2}\/\d{2}\/\d{4})/gi;
    let relator = null, rm;
    while ((rm = relRegex.exec(bloco)) !== null) {
      relator = { nome: rm[1].trim(), partido: rm[2].trim(), uf: rm[3].trim(), data: rm[4] };
    }

    // "SE APROVADO O REQUERIMENTO DE URGÊNCIA nº X" é CONDICIONAL — a urgência
    // ainda depende da aprovação daquele requerimento (MEDIDO na pauta de
    // 13/08/2026, item 9, que pende do REQ 4.045 do item 1). Tratar isso como
    // urgência aprovada seria afirmar um fato que ainda não ocorreu.
    const temUrgencia = /(?<!\bSE\s{0,3})APROVADO\s+O\s+REQUERIMENTO\s+DE\s+URG[ÊE]NCIA/i.test(bloco);
    const urgenciaCondicional = !temUrgencia
      && /\bSE\s+APROVADO\s+O\s+REQUERIMENTO\s+DE\s+URG[ÊE]NCIA/i.test(bloco);

    // Pareceres de comissão constantes na pauta.
    // Padrões reconhecidos no PDF:
    //   "tendo parecer da Comissão de X, pelo Y (Relator: Dep. Z)"
    //   "tendo pareceres da Comissão de X..., pelo Y (Relator: Dep. Z); da Comissão de W..."
    //   "tendo pareceres proferidos em plenário: da Comissão de X..."
    const pareceresComissao = extrairPareceresComissao(bloco);

    resultado.itens.push({
      ordem: ordemRaw,
      tipoCategoria: 'projeto',
      sigla:  tipo.sigla,
      numero: h.numero,
      ano:    h.ano,
      ementa,
      autorTexto,
      apensadosTexto,
      relator,
      temUrgencia,
      urgenciaCondicional,
      pareceresComissao,
    });
  }

  // Ordena: requerimentos antes (por ordem), depois projetos (por ordem)
  resultado.itens.sort((a, b) => {
    if (a.tipoCategoria !== b.tipoCategoria) return prioridadeCat(a.tipoCategoria) - prioridadeCat(b.tipoCategoria);
    return (a.ordem || 999) - (b.ordem || 999);
  });

  return resultado;
}

// ============================================================
//  PARSER DA PAUTA — FORMATO COMPACTO (dashboard da Liderança)
//  Reconhece itens no estilo "1 REQ 1180/2026", "9 PL 1625/2026",
//  "16 PLP 114/2026" etc., com sumário + blocos detalhados contendo
//  AUTOR / EMENTA / SITUAÇÃO / RELATOR.
// ============================================================
function parsearPautaCompacto(texto) {
  const resultado = { titulo: '', periodo: '', itens: [] };

  // Data da sessão (ex.: "19/05/2026")
  const dataMatch = texto.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  if (dataMatch) {
    resultado.periodo = dataMatch[1];
    resultado.titulo  = `Pauta — ${dataMatch[1]}`;
  } else {
    resultado.titulo = 'Pauta da Semana';
  }

  // Cabeçalhos de bloco detalhado: "[N] SIGLA NNN/AAAA [cód] STATUS"
  // PDC (Projeto de Decreto Legislativo, nomenclatura antiga) aparece no
  // dashboard ao lado de PDL — sem ele, esses decretos somem da importação.
  // MSC (Mensagem do Poder Executivo) entrou na tabela de tipos em 09/2026 para
  // o formato extenso, mas faltava aqui: no dashboard, a mensagem era descartada
  // sem aviso (varredura de 15/09/2026).
  const SIGLAS = ['REQ', 'REC', 'PLP', 'PEC', 'PDL', 'PDC', 'MPV', 'MSC', 'PRC', 'PL'];
  const siglasAlt = SIGLAS.slice().sort((a, b) => b.length - a.length).join('|');

  // Região "REDAÇÕES FINAIS" (RICD, art. 83, I): os itens listados sob essa
  // seção são apreciação de texto final, não vão à análise de IA. Marca a faixa
  // entre o título (ocorrência do bloco detalhado, a última no texto) e o
  // próximo cabeçalho de seção ("B - Turno único", "DISCUSSÃO", etc.).
  const rfMarks = [...texto.matchAll(/REDA[ÇC][ÕO]ES?\s+FINA(?:L|IS)/gi)];
  let rfIni = -1, rfFim = -1;
  if (rfMarks.length) {
    const ult = rfMarks[rfMarks.length - 1];
    rfIni = ult.index;
    const desde = ult.index + ult[0].length;
    const prox = texto.slice(desde).search(/(?:^|\n)[ \t]*(?:[A-Z]\s+-\s+\S|DISCUSS[ÃA]O|VOTA[ÇC][ÃA]O|EM\s+TURNO)/);
    rfFim = prox >= 0 ? desde + prox : texto.length;
  }
  const ehRedacaoFinal = (idx) => rfIni >= 0 && idx >= rfIni && idx < rfFim;

  // Mapa de ordem a partir do SUMÁRIO ("N - SIGLA NUM/AAAA"), que é o índice
  // confiável da pauta. O pdf.js às vezes joga o número de ordem do cabeçalho
  // detalhado para uma linha separada; o sumário permite recuperá-lo.
  const ordemPorChave = {};
  const sumarioRegex = new RegExp(`(\\d{1,3})\\s*-\\s*(${siglasAlt})\\s+([\\d.]+)\\/(\\d{4})`, 'g');
  let sm;
  while ((sm = sumarioRegex.exec(texto)) !== null) {
    const k = `${sm[2]}-${sm[3].replace(/\./g, '')}-${sm[4]}`;
    if (!(k in ordemPorChave)) ordemPorChave[k] = parseInt(sm[1], 10);
  }

  // O número de ordem do cabeçalho detalhado é OPCIONAL: quando o pdf.js o
  // separa para outra linha, o cabeçalho aparece sem ele. Nesse caso exigimos
  // um marcador de STATUS (em maiúsculas) na mesma linha, para distinguir um
  // cabeçalho real de referências em apensados, "Notas técnicas:" ou na ementa.
  // O separador número→sigla é só espaço/tab (nunca \n), para o número jamais
  // ser "puxado" de uma linha vizinha (ex.: o número órfão do item seguinte).
  const STATUS_RE = /N[ÃA]O APRECIAD[OA]|APRECIAD[OA]|RETIRAD[OA]|PREJUDICAD[OA]|APROVAD[OA]|REJEITAD[OA]|ADIAD[OA]|DEVOLVID[OA]|SOBRESTAD[OA]|VETAD[OA]/;
  const headerRegex = new RegExp(
    `(?:^|\\n)[ \\t]*(?:(\\d{1,3})[ \\t]+)?(${siglasAlt})\\s+([\\d.]+)\\/(\\d{4})\\b([^\\n]*)`,
    'g'
  );

  const headers = [];
  let m;
  while ((m = headerRegex.exec(texto)) !== null) {
    const temNumero = m[1] != null;
    const resto     = m[5] || '';
    if (!temNumero && !STATUS_RE.test(resto)) continue; // não é cabeçalho detalhado
    const numero = m[3].replace(/\./g, '');
    const chave  = `${m[2]}-${numero}-${m[4]}`;
    headers.push({
      idx:    m.index + m[0].indexOf(m[2]),
      end:    m.index + m[0].length,
      ordem:  temNumero ? parseInt(m[1], 10) : (ordemPorChave[chave] ?? null),
      sigla:  m[2],
      numero,
      ano:    m[4],
    });
  }

  // Refina o fim da região de "Redações Finais": ela nunca abrange os
  // requerimentos de urgência (que vêm logo depois). Quando o detector do fim
  // da seção falha e a região se estende demais, cortamos no 1º REQ/REC após o
  // início — assim requerimentos e os projetos seguintes não viram "redação final".
  if (rfIni >= 0) {
    const primeiroReq = headers
      .filter(h => (h.sigla === 'REQ' || h.sigla === 'REC') && h.idx >= rfIni)
      .reduce((min, h) => Math.min(min, h.idx), Infinity);
    if (primeiroReq < rfFim) rfFim = primeiroReq;
  }

  for (let i = 0; i < headers.length; i++) {
    const h     = headers[i];
    const fim   = i + 1 < headers.length ? headers[i + 1].idx : texto.length;
    const bloco = texto.slice(h.end, fim);

    // Evita registrar o mesmo item duas vezes (sumário + bloco detalhado)
    const chave = `${h.sigla}-${h.numero}-${h.ano}`;
    if (resultado.itens.some(it => `${it.sigla}-${it.numero}-${it.ano}` === chave)) continue;

    // AUTOR
    const autorMatch = bloco.match(/AUTOR:\s*([^\n]+)/i);
    const autorTexto = autorMatch ? autorMatch[1].replace(/\s+/g, ' ').trim() : '';

    // EMENTA — até a próxima seção em maiúsculas conhecida ou o fim do bloco
    const ementaMatch = bloco.match(
      /EMENTA:\s*([\s\S]*?)(?=\n\s*(?:SITUAÇÃO:|SITUACAO:|RELATOR:|PARECER:|Notas técnicas:|APENSADAS|OUTROS AUTORES:|Acessória|\d{1,3}\s+(?:REQ|REC|PLP|PEC|PDL|MPV|PRC|PL|MSC)\s+[\d.]+\/\d{4})|$)/i
    );
    let ementa = ementaMatch ? ementaMatch[1].replace(/\s+/g, ' ').trim() : '';
    if (!ementa) {
      // Fallback: usa o primeiro trecho do bloco
      ementa = bloco.replace(/\s+/g, ' ').trim().slice(0, 600);
    }
    ementa = ementa.slice(0, 1200);

    // RELATOR — ex.: "RELATOR: Merlong Solano (PT/PI)"
    const relatorMatch = bloco.match(/RELATOR(?:A)?:\s*([^\n(]+?)\s*\(([^/)]+)\/([A-Z]{2})\)/i);
    const relator = relatorMatch ? {
      nome:    relatorMatch[1].trim(),
      partido: relatorMatch[2].trim(),
      uf:      relatorMatch[3].trim(),
      data:    null,
    } : null;

    // Para requerimentos: "Acessória do PL 5900/2025" indica o projeto urgenciado.
    let projetoUrgenciado = null;
    const acessMatch = bloco.match(/Acess[óo]ria\s+do\s+(REQ|REC|PLP|PEC|PDL|MPV|PRC|PL|MSC)\s+([\d.]+)\/(\d{4})/i);
    if (acessMatch) {
      projetoUrgenciado = {
        sigla:  acessMatch[1].toUpperCase(),
        numero: acessMatch[2].replace(/\./g, ''),
        ano:    acessMatch[3],
      };
    }

    // Apensados — "APENSADAS SEM AUTORIA DA LIDERANÇA\n REC 6/2024" ou "PL 4371/2024"
    const apensadosTexto = [];
    const apensBloco = bloco.match(/APENSAD[AO]S?(?:\s+SEM\s+AUTORIA[^\n]*)?\s*\n([\s\S]*?)(?=\n\s*(?:RELATOR:|PARECER:|Notas técnicas:|EMENTA:|SITUAÇÃO:|$))/i);
    if (apensBloco) {
      const reAp = /(REQ|REC|PLP|PEC|PDL|MPV|PRC|PL|MSC)\s+([\d.]+)\/(\d{4})/gi;
      let am;
      while ((am = reAp.exec(apensBloco[1])) !== null) {
        apensadosTexto.push({
          sigla:  am[1].toUpperCase(),
          numero: am[2].replace(/\./g, ''),
          ano:    am[3],
        });
      }
    }

    // REQ/REC são sempre requerimentos — redação final é dos projetos, nunca de
    // requerimento (a checagem de REQ tem prioridade sobre a região de RF).
    const tipoCategoria = (h.sigla === 'REQ' || h.sigla === 'REC') ? 'requerimento'
      : ehRedacaoFinal(h.idx) ? 'redacao_final'
      : 'projeto';

    resultado.itens.push({
      ordem:             h.ordem,
      tipoCategoria,
      sigla:             h.sigla,
      numero:            h.numero,
      ano:               h.ano,
      ementa,
      autorTexto,
      apensadosTexto,
      relator,
      temUrgencia:       false,
      projetoUrgenciado,
      pareceresComissao: [],
    });
  }

  // Ordena: requerimentos antes (por ordem), depois projetos (por ordem)
  resultado.itens.sort((a, b) => {
    if (a.tipoCategoria !== b.tipoCategoria) return prioridadeCat(a.tipoCategoria) - prioridadeCat(b.tipoCategoria);
    return (a.ordem || 999) - (b.ordem || 999);
  });

  return resultado;
}

/**
 * Extrai a lista de pareceres de comissão do bloco do item da pauta.
 * Cada parecer tem: comissao, posicao (texto da posição/conclusão) e relator (opcional).
 */
function extrairPareceresComissao(bloco) {
  const pareceres = [];
  // Recorta a partir de "tendo parecer(es)" até o próximo grande marcador
  // (Pendente, APROVADO, RELATOR:, fim do bloco).
  // Terminador "RELATOR:" exige newline antes e "DEP." depois, para não casar
  // o "(Relator: Dep. X)" inline que aparece dentro de cada parecer.
  const trechoMatch = bloco.match(/tendo\s+parecer[es]*[\s\S]*?(?=Pendente\s+de\s+parecer|APROVADO\s+O\s+REQUERIMENTO|(?:\n|^)\s*RELATOR(?:A)?:\s*DEP\.|\n\s*Tendo\s+apens|$)/i);
  if (!trechoMatch) return pareceres;

  let trecho = trechoMatch[0].replace(/\s+/g, ' ');
  // Remove o prefixo "tendo parecer(es) [da Comissão de | das Comissões de:]".
  trecho = trecho.replace(/^tendo\s+parecer(?:es)?\s+(?:proferidos?\s+em\s+plen[áa]rio:?\s*)?(?:d[ao]s?\s+)?Comiss(?:[ãa]o|[õo]es)\s+de:?\s*/i, '');
  // Cada comissão da lista é separada por ";". Isso cobre os DOIS formatos:
  //  (a) singular repetido — "da Comissão de X, pela ...; da Comissão de Y, ...";
  //  (b) lista plural — "Comissões de: X, ...; Y, ...; e Z, ..." (só a 1ª traz
  //      "Comissão de"; as demais vêm apenas com o nome).
  const segs = trecho.split(/;\s*/);
  for (let seg of segs) {
    // Limpa conectores/prefixos no início de cada segmento.
    seg = seg.trim()
      .replace(/^e\s+/i, '')
      .replace(/^d[ao]s?\s+(?=Comiss)/i, '')                  // artigo antes de "Comissão"
      .replace(/^Comiss(?:[ãa]o|[õo]es)\s+de:?\s+/i, '');     // "Comissão de" (mantém "Comissão Especial")
    if (!seg) continue;
    // Nome da comissão pode conter vírgulas (ex.: "Indústria, Comércio e
    // Serviços"). Consome o nome até a vírgula que antecede o conector de
    // posição ("pela", "pelo", "no mérito", "favorável", etc.).
    const m = seg.match(/^([^;:]{3,200}?),\s+(?=pel[oa]\b|no\s+m[ée]rito|sem\s+m[ée]rito|sem\s+manifesta|favor[áa]vel|contr[áa]rio|por\s+|que)([\s\S]+?)(?=\(Relator(?:a)?:|$)/i);
    if (!m) continue;
    const comissao = m[1].replace(/\s+/g, ' ').trim();
    let posicao = m[2].replace(/\s+/g, ' ').trim().replace(/[.,;()]+$/, '');
    const relMatch = seg.match(/\(\s*Relator(?:a)?:\s*([^)]+?)\s*\)/i);
    pareceres.push({
      comissao,
      posicao,
      relator: relMatch ? relMatch[1].replace(/\s+/g, ' ').trim() : null,
    });
  }
  return pareceres;
}

function limpaNumero(s) {
  return (s || '').replace(/[^\d]/g, '');
}

// Ordem de exibição/agrupamento das categorias na pauta: redações finais
// (matéria sobre a mesa) primeiro, depois requerimentos de urgência, e por fim
// os projetos em discussão.
function prioridadeCat(cat) {
  return cat === 'redacao_final' ? 0 : cat === 'requerimento' ? 1 : 2;
}

// ============================================================
//  PARSER DO PDF EXPORTADO PELO MÓDULO DE PLENÁRIO
//  O módulo de Análise de Plenário gera um PDF próprio (capa, índice clicável
//  e notas técnicas) em que as proposições aparecem na forma curta —
//  "PL 1234/2024", "Urgência ao PL 1234/2024", "Redação Final do PL 999/2020".
//  Aqui extraímos a lista de itens a partir do índice/cabeçalhos desse PDF,
//  para que o módulo de Destaques também possa importá-lo como arquivo.
// ============================================================
function ehPdfPlenarioExportado(texto) {
  return /Pauta\s+de\s+Plen[áa]rio/i.test(texto || '') &&
         /Lideran[çc]a\s+do\s+Podemos/i.test(texto || '');
}

function parsearPautaPlenarioExportada(texto) {
  const resultado = { titulo: 'Pauta de Plenário', periodo: '', itens: [] };
  if (!ehPdfPlenarioExportado(texto)) return resultado;

  const linhas = texto.split('\n');

  // Linha meta logo após o cabeçalho: "<nome da pauta> · N item(ns)".
  // Dá o nome sugerido da sessão e a contagem (limita falsos positivos vindos
  // do corpo das notas, que podem ter listas numeradas).
  let total = null;
  for (const ln of linhas) {
    const m = ln.match(/^(.+?)\s+·\s+(\d+)\s+item/i);
    if (m) { resultado.titulo = m[1].trim(); total = parseInt(m[2], 10); break; }
  }

  const SIG        = '(PL|PLP|PEC|PDL|MPV|PRC)';
  const reEntrada  = /^\s*(\d{1,3})\.\s+(.+)$/;                                  // "N. <título>"
  const reRedacao  = new RegExp('Reda[çc][ãa]o\\s+Final\\s+d[oe]\\s+' + SIG + '\\s+([\\d.]+)\\/(\\d{4})', 'i');
  const reUrgencia = new RegExp('Urg[êe]ncia\\s+a[oa]\\s+' + SIG + '\\s+([\\d.]+)\\/(\\d{4})', 'i');
  const rePlano    = new RegExp('\\b' + SIG + '\\s+([\\d.]+)\\/(\\d{4})', 'i');

  // Cada item aparece no índice e como cabeçalho; o índice vem antes das notas,
  // então a 1ª ocorrência por nº de ordem prevalece (o índice é a fonte limpa).
  const porOrdem = new Map();
  for (const ln of linhas) {
    const mm = reEntrada.exec(ln);
    if (!mm) continue;
    const ordem = parseInt(mm[1], 10);
    if (total != null && (ordem < 1 || ordem > total)) continue;
    if (porOrdem.has(ordem)) continue;
    const resto = mm[2];

    let m, tipoCategoria, sigla, numero, ano, projetoUrgenciado = null;
    if ((m = reRedacao.exec(resto))) {
      tipoCategoria = 'redacao_final'; sigla = m[1].toUpperCase(); numero = limpaNumero(m[2]); ano = m[3];
    } else if ((m = reUrgencia.exec(resto))) {
      tipoCategoria = 'requerimento';  sigla = m[1].toUpperCase(); numero = limpaNumero(m[2]); ano = m[3];
      projetoUrgenciado = { sigla, numero, ano };
    } else if ((m = rePlano.exec(resto))) {
      tipoCategoria = 'projeto';       sigla = m[1].toUpperCase(); numero = limpaNumero(m[2]); ano = m[3];
    } else {
      continue;   // linha "N. …" sem proposição reconhecível (não é entrada de pauta)
    }

    // Não importa o apelido entre parênteses: nos Destaques a ementa vem da API.
    porOrdem.set(ordem, {
      sigla, numero, ano, tipoCategoria,
      ementa: '',
      projetoUrgenciado,
      ordem,
    });
  }

  resultado.itens = [...porOrdem.values()].sort((a, b) => a.ordem - b.ordem);
  return resultado;
}

// ============================================================
//  DETECTOR DE LACUNAS
//  O parser reconhece cada item por regras de grafia; quando a Câmara muda a
//  grafia (plural, "nº", tipo novo como Recurso), o item SUMIA EM SILÊNCIO —
//  a pauta de 03/11/2026 pulava do 5 para o 8. Aqui a numeração é lida do
//  próprio texto, sem depender da grafia do item: na pauta extensa os itens
//  vêm como "N. Requerimento…" (matéria sobre a mesa) ou como o número sozinho
//  numa linha seguido do título em maiúsculas (Ordem do Dia); na compacta, como
//  "N SIGLA X/AAAA". Número que aparece no texto e não está entre os itens lidos
//  é lacuna — e o trecho do texto onde ele está segue para a IA.
// ============================================================
// Depois de "AVISOS" vêm outras listas numeradas (recursos, emendas) que não
// são itens da pauta.
const FIM_ITENS_PAUTA = /\n\s*(?:AVISOS|PROPOSI[ÇC][ÕO]ES\s+EM\s+FASE\s+DE\s+RECEBIMENTO)\b/;
const RE_ITEM_PONTO   = /^\s*(\d(?:\s?\d){0,2})[ \t]?\.\s+\S/;                 // "12. Requerimento…" / "1 2 . …"
const RE_ITEM_SOZINHO = /^\s*(\d(?:\s?\d){0,2})\s*$/;                           // "14" (Ordem do Dia)
const RE_ITEM_COMPACT = /^\s*(\d{1,3})\s+(?:REQ|REC|PLP|PEC|PDL|PDC|MPV|PRC|PLV|PL|MSC)\s+[\d.]+\/\d{4}\b/;
const ehTituloMaiusculo = l => {
  const letras = (l.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const maius  = (l.match(/[A-ZÀ-Ý]/g) || []).length;
  return letras >= 8 && maius / letras > 0.8 && !/^C[ÂA]MARA\s+DOS\s+DEPUTADOS/.test(l.trim());
};

/**
 * Âncoras de item no texto: [{ ordem, pos }] em ordem crescente de número.
 * A numeração é contínua (1..N): só aceita número MAIOR que o anterior e no
 * máximo 6 adiante — página, artigo ou alínea soltos não viram item.
 */
function ancorasItensPauta(texto) {
  const t = String(texto || '');
  const fim = t.search(FIM_ITENS_PAUTA);
  const corpo = fim > 0 ? t.slice(0, fim) : t;
  const linhas = corpo.split('\n');
  const out = [];
  let ultimo = 0, pos = 0;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    let m = RE_ITEM_COMPACT.exec(l) || RE_ITEM_PONTO.exec(l);
    if (!m) {
      const s = RE_ITEM_SOZINHO.exec(l);
      const prox = (linhas.slice(i + 1).find(x => x.trim()) || '');
      if (s && ehTituloMaiusculo(prox)) m = s;
    }
    if (m) {
      const n = parseInt(m[1].replace(/\s+/g, ''), 10);
      if (n > ultimo && n <= ultimo + 6) { out.push({ ordem: n, pos }); ultimo = n; }
    }
    pos += l.length + 1;
  }
  return { ancoras: out, fimItens: corpo.length };
}

/**
 * Por que o leitor não reconheceu o item n? Compara o título publicado com os
 * formatos que o parser conhece (os mesmos das regex de parsearPautaExtenso)
 * e devolve { titulo, motivo } — o título como saiu no PDF e o desvio
 * provável. Serve para reportar à Câmara a falta de padrão na pauta.
 */
function diagnosticarLacuna(trecho, n) {
  const linhas = String(trecho || '').split('\n').map(l => l.trim()).filter(Boolean);
  const reNum = new RegExp(`^${String(n).split('').join('\\s?')}\\s?\\.\\s+`);
  let titulo = '', formato = '';
  const iMesa = linhas.findIndex(l => reNum.test(l));
  const iSoz = linhas.findIndex((l, i) => new RegExp(`^${String(n).split('').join('\\s?')}$`).test(l) && linhas[i + 1]);
  if (iMesa >= 0 && (iSoz < 0 || iMesa <= iSoz)) { formato = 'mesa'; titulo = (linhas[iMesa] + ' ' + (linhas[iMesa + 1] || '')).trim(); }
  else if (iSoz >= 0) { formato = 'ordem'; titulo = linhas[iSoz + 1]; }
  else titulo = linhas[0] || '';
  titulo = titulo.replace(/\s+/g, ' ').slice(0, 180);
  const semAc = semAcento(titulo).toUpperCase();
  let motivo;

  if (formato === 'mesa') {
    const corpo = semAc.replace(/^\d(?:\s?\d)*\s?\.\s+/, '');
    const palavra = (titulo.replace(/^\d(?:\s?\d)*\s?\.\s+/, '').match(/^[^\s,]+/) || [''])[0];
    const temNum = /\bN\s*[º°O]?\.?\s*[\d.]+|\bS\s*\/\s*N/.test(corpo);
    const temAno = /,?\s*DE\s+\d{4}\b/.test(corpo);
    if (/^REDA[CÇ](?:OES|ÕES)\s+FINAIS/.test(corpo)) motivo = 'o tipo veio no plural ("Redações Finais") — o padrão é um item por redação: "N. Redação Final ao <Tipo> nº X, de AAAA"';
    else if (/^REDA\s*[CÇ]\s*A\s*O\s+FINAL/.test(corpo) && !/^REDACAO\s+FINAL/.test(corpo)) motivo = 'a palavra "Redação" veio quebrada pela geração do PDF';
    else if (/^REDACAO\s+FINAL/.test(corpo)) motivo = !/^REDACAO\s+FINAL\s+(?:A[OA]|A)\s/.test(corpo) ? 'falta o "ao/à" entre "Redação Final" e o tipo da proposição (padrão: "Redação Final ao Projeto de Lei nº X, de AAAA")'
      : !temNum ? 'o número da proposição não vem como "nº X"' : !temAno ? 'o ano não vem como ", de AAAA"' : 'o título está fora do padrão "N. Redação Final ao <Tipo> nº X, de AAAA"';
    else if (/^REQUERIMENTO/.test(corpo) || /^RECURSO/.test(corpo)) {
      const t = /^REQUERIMENTO/.test(corpo) ? 'Requerimento' : 'Recurso';
      motivo = /\d+\s*\/\s*\d{4}/.test(corpo) && !temAno ? `o número veio como "X/AAAA" — o padrão é "${t} nº X, de AAAA"`
        : !temNum ? `o número do ${t.toLowerCase()} não vem como "nº X"` : !temAno ? 'o ano não vem como ", de AAAA"'
        : `o título está fora do padrão "N. ${t} nº X, de AAAA, do(a) Sr(a). …"`;
    } else motivo = `tipo de item não previsto: o título começa com "${palavra}" — o leitor conhece Redação Final, Requerimento e Recurso na matéria sobre a mesa`;
  } else if (formato === 'ordem') {
    const m = semAc.match(/^(.+?)\s+N\s*[º°O]?\.?\s*[\d.]+/);
    const tipo = (m ? m[1] : semAc.split(/\s+N\s*[º°O]|,|\(/)[0]).trim();
    const conhecido = TIPOS_PROPOSICAO.some(t => semAcento(t.prefixo).toUpperCase() === tipo);
    motivo = !conhecido ? `tipo de proposição não previsto: "${titulo.split(/\s+N\s*[º°o]/i)[0].trim()}" — o leitor conhece ${TIPOS_PROPOSICAO.map(t => t.prefixo.toLowerCase()).join(', ')}`
      : !/N\s*[º°O]?\.?\s*[\d.]+/.test(semAc) ? 'o número da proposição não vem como "Nº X"'
      : /N\s*[º°O]?\.?\s*[\d.]+\s*\/\s*\d{4}/.test(semAc) && !/,?\s*DE\s+\d{4}/.test(semAc) ? 'o número veio como "Nº X/AAAA" — o padrão é "TIPO Nº X, DE AAAA"'
      : !/,?\s*DE\s+\d{4}/.test(semAc) ? 'o ano não vem como ", DE AAAA"'
      : 'o título está fora do padrão "TIPO Nº X, DE AAAA" (pode haver caractere quebrado pela geração do PDF)';
  } else {
    motivo = 'o número do item não aparece no formato dos demais ("N." ou o número sozinho antes do título)';
  }
  return { titulo, motivo };
}

/**
 * Números de item presentes no texto e ausentes da lista lida pelo parser.
 * Devolve { total, faltando: [n], trechos: { n: texto } } — o trecho vai do
 * item lido anterior ao seguinte (o pedaço onde o item perdido está), com teto
 * de tamanho para a chamada de IA.
 */
function detectarLacunasPauta(texto, itens) {
  const t = String(texto || '');
  const { ancoras, fimItens } = ancorasItensPauta(t);
  const lidos = new Set((itens || []).map(i => i.ordem).filter(n => Number.isFinite(n)));
  const total = Math.max(0, ...ancoras.map(a => a.ordem), ...lidos);
  const faltando = [];
  for (let n = 1; n <= total; n++) if (!lidos.has(n)) faltando.push(n);
  const posDe = new Map(ancoras.map(a => [a.ordem, a.pos]));
  const trechos = {};
  for (const n of faltando) {
    // início: a âncora do próprio item ou a do item anterior mais próximo
    let ini = posDe.get(n);
    if (ini == null) { for (let k = n - 1; k >= 1; k--) if (posDe.has(k)) { ini = posDe.get(k); break; } }
    if (ini == null) ini = 0;
    // fim: a próxima âncora depois do item (ou o fim da lista de itens)
    let fimT = fimItens;
    for (const a of ancoras) if (a.ordem > n && a.pos > ini) { fimT = a.pos; break; }
    trechos[n] = t.slice(ini, Math.min(fimT, ini + 8000));
  }
  const diagnosticos = {};
  for (const n of faltando) diagnosticos[n] = diagnosticarLacuna(trechos[n], n);
  return { total, faltando, trechos, diagnosticos };
}

// ============================================================
//  RECUPERAÇÃO DAS LACUNAS POR IA (extensão e bot)
//  Só o trecho de cada item perdido vai para a IA. A resposta passa por duas
//  travas antes de virar item: (1) o número e o ano lidos têm de estar escritos
//  no próprio trecho — a IA não pode inventar proposição; (2) quem chama
//  confirma a proposição na Câmara (confirmar). O que não passa vira pendência
//  visível, nunca item silencioso.
// ============================================================
const SIGLAS_LACUNA = ['PL', 'PLP', 'PEC', 'PDL', 'MPV', 'PRC', 'MSC', 'PLV', 'REQ', 'REC'];

function promptLacunasPauta(lac) {
  const blocos = lac.faltando.map(n => `### ITEM ${n}\n${lac.trechos[n] || ''}`).join('\n\n');
  return `Você lê a pauta do Plenário da Câmara dos Deputados. Abaixo estão trechos do texto da pauta; cada trecho contém o item indicado (pode conter também o fim do item anterior ou o começo do seguinte — ignore-os).

Para cada item pedido, extraia SOMENTE o que está escrito no trecho:
- "categoria": "redacao_final" (Redação Final), "requerimento" (requerimento, em geral de urgência), "recurso" (recurso contra apreciação conclusiva ou outro) ou "projeto" (proposição em discussão/votação: PL, PLP, PEC, PDL, MPV, PRC, MSC…).
- "sigla", "numero", "ano": a proposição DO ITEM. Para redação final, a do projeto a que ela se refere. Para requerimento, "REQ" e o número do requerimento ("s/nº" se não tiver número). Para recurso, "REC" e o número do recurso. Número sem pontos ("1.234" → "1234").
- "alvo": para requerimento de urgência, o projeto cuja urgência é pedida ({"sigla","numero","ano"}); para recurso, o projeto de que se recorre; senão null.
- "ementa": o objeto do item em até 300 caracteres, copiado do texto.
- "autor": o autor como escrito ("do Sr. Fulano"), ou "".
Se o trecho não tiver o item, devolva o item com "sigla": null. Não invente nada.

${blocos}

Responda APENAS com JSON, sem cercas de código:
[{"ordem": <número do item>, "categoria": "...", "sigla": "...", "numero": "...", "ano": "...", "alvo": null, "ementa": "...", "autor": "..."}]`;
}

/** Texto do trecho "compactado" para conferir números: o kerning do PDF separa dígitos ("2 0 2 6", "1 .234"). */
function _compactaDigitos(t) {
  return String(t || '').replace(/(\d)\s+(?=[\d.])/g, '$1').replace(/(\d)\.\s+(?=\d)/g, '$1.').replace(/\s+/g, ' ');
}

/** O número/ano da proposição aparece escrito no trecho? ("2.334" ou "2334"; "68"). */
function numeroNoTrecho(trecho, numero, ano) {
  const n = String(parseInt(String(numero).replace(/\D/g, ''), 10));
  if (!n || n === 'NaN' || !/^\d{4}$/.test(String(ano))) return false;
  const t = _compactaDigitos(trecho);
  const comPonto = n.replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/\./g, '\\.');
  const reNum = new RegExp(`(^|[^\\d.])(?:${n}|${comPonto})(?![\\d])`);
  return reNum.test(t) && new RegExp(`(^|\\D)${ano}(\\D|$)`).test(t);
}

/** Lista JSON da resposta da IA, tolerando cercas e texto em volta. */
function _jsonListaIA(txt) {
  let t = String(txt || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = t.indexOf('['), f = t.lastIndexOf(']');
  if (i >= 0 && f > i) t = t.slice(i, f + 1);
  try { const j = JSON.parse(t); return Array.isArray(j) ? j : []; }
  catch (_) {
    try { const j = JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); return Array.isArray(j) ? j : []; }
    catch (__) { return null; }
  }
}

/**
 * Resposta da IA → { candidatos: [item no formato do parser], pendentes: [{ ordem, motivo, lido }] }.
 * Só a trava (1), do texto; a confirmação na Câmara fica com recuperarLacunasPauta.
 */
function itensDaRespostaLacunas(resposta, lac) {
  const lista = _jsonListaIA(resposta);
  const candidatos = [], pendentes = [];
  if (!lista) {
    for (const n of lac.faltando) pendentes.push({ ordem: n, motivo: 'a IA não devolveu uma resposta legível', lido: null });
    return { candidatos, pendentes };
  }
  for (const n of lac.faltando) {
    const e = lista.find(x => Number(x && x.ordem) === n);
    const trecho = lac.trechos[n] || '';
    const sigla = String((e && e.sigla) || '').toUpperCase().replace(/[^A-Z]/g, '');
    const lido = e && sigla ? `${sigla} ${e.numero}/${e.ano}` : null;
    if (!e || !sigla) { pendentes.push({ ordem: n, motivo: 'a IA não encontrou o item no texto', lido: null }); continue; }
    if (!SIGLAS_LACUNA.includes(sigla)) { pendentes.push({ ordem: n, motivo: `tipo "${sigla}" não reconhecido`, lido }); continue; }
    const ano = String(e.ano || '').trim();
    const semNumero = sigla === 'REQ' && /s\s*\/?\s*n/i.test(String(e.numero || ''));
    const numero = semNumero ? 's/nº' : limpaNumero(String(e.numero || ''));
    if (!/^\d{4}$/.test(ano) || (!semNumero && !/^\d+$/.test(numero))) { pendentes.push({ ordem: n, motivo: 'número ou ano ilegível na resposta da IA', lido }); continue; }
    if (!semNumero && !numeroNoTrecho(trecho, numero, ano)) { pendentes.push({ ordem: n, motivo: 'o número lido pela IA não está no texto da pauta', lido }); continue; }

    const cat = String(e.categoria || '').toLowerCase();
    let alvo = null;
    if (e.alvo && e.alvo.sigla && e.alvo.numero && e.alvo.ano) {
      const a = { sigla: String(e.alvo.sigla).toUpperCase().replace(/[^A-Z]/g, ''), numero: limpaNumero(String(e.alvo.numero)), ano: String(e.alvo.ano) };
      if (SIGLAS_LACUNA.includes(a.sigla) && numeroNoTrecho(trecho, a.numero, a.ano)) alvo = a;
    }
    if (semNumero && !alvo) { pendentes.push({ ordem: n, motivo: 'requerimento sem número e sem projeto identificável', lido }); continue; }
    const item = {
      ordem: n,
      tipoCategoria: cat === 'redacao_final' ? 'redacao_final'
        : (sigla === 'REQ' || sigla === 'REC' || cat === 'requerimento' || cat === 'recurso') ? 'requerimento' : 'projeto',
      sigla, numero, ano,
      ementa: String(e.ementa || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      autorTexto: String(e.autor || '').trim(),
      apensadosTexto: [],
      relator: null,
      origemIA: true,
    };
    // Mesma convenção do parser: só o requerimento tem "projeto da urgência";
    // o recurso aponta o projeto de que se recorre, que não é urgência.
    if (sigla === 'REQ') item.projetoUrgenciado = alvo;
    if (semNumero) item.chave = `REQ-sn-${alvo.sigla}${alvo.numero}-${alvo.ano}-${ano}`;
    candidatos.push(item);
  }
  return { candidatos, pendentes };
}

/**
 * Orquestra a recuperação: { chamarIA(prompt) → texto, confirmar(item) → bool }
 * vêm de quem chama (extensão ou bot). Devolve { recuperados, pendentes }.
 */
async function recuperarLacunasPauta(lac, { chamarIA, confirmar }) {
  if (!lac || !lac.faltando.length) return { recuperados: [], pendentes: [] };
  let resposta;
  try { resposta = await chamarIA(promptLacunasPauta(lac)); }
  catch (e) {
    return { recuperados: [], pendentes: lac.faltando.map(n => ({ ordem: n, motivo: `IA indisponível (${e.message})`, lido: null })) };
  }
  const { candidatos, pendentes } = itensDaRespostaLacunas(resposta, lac);
  const recuperados = [];
  for (const it of candidatos) {
    // REQ sem número: confirma o projeto da urgência.
    const ref = it.numero === 's/nº' ? it.projetoUrgenciado : it;
    let ok = false;
    try { ok = await confirmar(ref); } catch (_) { ok = false; }
    if (ok) recuperados.push(it);
    else pendentes.push({ ordem: it.ordem, motivo: 'a Câmara não confirmou a proposição lida', lido: `${it.sigla} ${it.numero}/${it.ano}`, noTexto: true });
  }
  pendentes.sort((a, b) => a.ordem - b.ordem);
  return { recuperados, pendentes };
}

// ============================================================
//  Export para Node.js (bot/). No navegador `module` não existe e
//  este bloco é inerte — a extensão continua usando o escopo global.
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parsearPauta, extrairTextoPdf, extrairSessao, TIPOS_PROPOSICAO, limpaNumero, detectarLacunasPauta, ancorasItensPauta,
    promptLacunasPauta, itensDaRespostaLacunas, recuperarLacunasPauta, numeroNoTrecho, diagnosticarLacuna };
}
