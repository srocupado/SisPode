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

// Tipos de proposição que reconhecemos no PDF
const TIPOS_PROPOSICAO = [
  { sigla: 'PL',  regex: /PROJETO DE LEI\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                                 prefixo: 'PROJETO DE LEI' },
  { sigla: 'PLP', regex: /PROJETO DE LEI COMPLEMENTAR\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                    prefixo: 'PROJETO DE LEI COMPLEMENTAR' },
  { sigla: 'PEC', regex: /PROPOSTA DE EMENDA (?:À|A) CONSTITUI[ÇC][ÃA]O\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,    prefixo: 'PROPOSTA DE EMENDA À CONSTITUIÇÃO' },
  { sigla: 'PDL', regex: /PROJETO DE DECRETO LEGISLATIVO\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                  prefixo: 'PROJETO DE DECRETO LEGISLATIVO' },
  { sigla: 'MPV', regex: /MEDIDA PROVIS[ÓO]RIA\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                            prefixo: 'MEDIDA PROVISÓRIA' },
  { sigla: 'PRC', regex: /PROJETO DE RESOLU[ÇC][ÃA]O\s+N[ºo]?\s*[\d.]+(?:-[A-Z]+)?,?\s*DE\s+\d{4}/i,                       prefixo: 'PROJETO DE RESOLUÇÃO' },
];

// pdf.js worker
if (typeof pdfjsLib !== 'undefined') {
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
  const temFormatoCompacto = /(?:^|\n)\s*\d{1,3}\s+(?:REQ|REC|PLP|PEC|PDL|MPV|PRC|PL)\s+[\d.]+\/\d{4}\b/.test(texto);
  if (temFormatoCompacto) return parsearPautaCompacto(texto);
  return parsearPautaExtenso(texto);
}

function parsearPautaExtenso(texto) {
  const resultado = { titulo: '', periodo: '', itens: [] };

  // Período
  const periodoMatch = texto.match(/PAUTA\s+PREVISTA\s+PARA\s+([\s\S]{5,80}?)(?:\(|\n)/i);
  if (periodoMatch) {
    resultado.periodo = periodoMatch[1].trim().replace(/\s+/g, ' ');
  } else {
    // Cabeçalho da pauta extensa: "Em 2 de junho de 2026 (Terça-feira)".
    // A data da sessão vem por extenso — convertê-la para dd/mm/aaaa. (A 1ª
    // ocorrência é a do cabeçalho; datas posteriores são de tramitação.)
    const MESES = { janeiro:1, fevereiro:2, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
    const dataExt = texto.match(/\bEm\s+(\d{1,2})\s+de\s+([A-Za-zçÇãÃéÉ]+)\s+de\s+(\d{4})/i);
    if (dataExt) {
      const mesNome = dataExt[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const mesNum  = MESES[mesNome];
      if (mesNum) resultado.periodo = `${String(dataExt[1]).padStart(2, '0')}/${String(mesNum).padStart(2, '0')}/${dataExt[3]}`;
    }
  }
  resultado.titulo = resultado.periodo ? `Pauta — ${resultado.periodo}` : 'Pauta da Semana';

  // === REDAÇÕES FINAIS (RICD, art. 83, I) ===
  // Padrão: "1. Redação Final ao Projeto de Lei nº 3.801, de 2004, do Sr. X,
  // que institui ...". O tipo vem por extenso; mapeamos para a sigla.
  const rfRegex = /(\d{1,2})\.\s+Reda[çc][ãa]o\s+Final\s+a[oa]\s+(.+?)\s+n[ºo]\s*([\d.]+)(?:-[A-Z]+)?,?\s*de\s+(\d{4})([\s\S]{0,800}?)(?=\n\d{1,2}\.\s|\nURG[ÊE]NCIA|\n[A-Z][A-Z\s]{8,}\n|$)/gi;
  let rf;
  while ((rf = rfRegex.exec(texto)) !== null) {
    const ordem  = parseInt(rf[1], 10);
    const tipoExt = rf[2].replace(/\s+/g, ' ').trim().toUpperCase();
    const numero = limpaNumero(rf[3]);
    const ano    = rf[4];
    const bloco  = rf[5] || '';

    // Mapeia o tipo por extenso → sigla (ex.: "PROJETO DE LEI" → PL).
    const tipo = TIPOS_PROPOSICAO.find(t => t.prefixo === tipoExt)
              || TIPOS_PROPOSICAO.find(t => tipoExt.startsWith(t.prefixo));
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
  const reqRegex = /(\d{1,2})\.\s+Requerimento\s+(?:n[ºo]\s*([\d.]+)|s\/\s*n[ºo]?)\s*,\s*de\s*(\d{4})([\s\S]{0,1500}?)(?=\n\d{1,2}\.\s+Requerimento|\nURG[ÊE]NCIA|\n[A-Z][A-Z\s]{8,}\n|\Z)/gi;
  let m;
  while ((m = reqRegex.exec(texto)) !== null) {
    const ordem   = parseInt(m[1], 10);
    const temNum  = m[2] != null;
    const numero  = temNum ? limpaNumero(m[2]) : 's/nº';
    const ano     = m[3];
    const bloco   = m[4];

    // Tenta identificar o projeto cujo regime de urgência está sendo pedido
    const projInternoSigla = TIPOS_PROPOSICAO.find(t => bloco.match(new RegExp(t.prefixo + '\\s+n[ºo]', 'i')));
    let proj = null;
    if (projInternoSigla) {
      const m2 = bloco.match(new RegExp(projInternoSigla.prefixo + '\\s+n[ºo]\\s*([\\d.]+)(?:-[A-Z]+)?,?\\s*de\\s*(\\d{4})', 'i'));
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
    `(?:^|\\n)\\s*(${tiposOrdenados.map(t => t.prefixo).join('|')})\\s+N[º]\\s*([\\d.]+)(?:-[A-Z]+)?,?\\s*DE\\s+(\\d{4})`,
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

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const tipo = tiposOrdenados.find(t => t.prefixo === h.prefixo);
    if (!tipo) continue;

    const fim = i + 1 < headers.length ? headers[i + 1].idx : texto.length;
    const bloco = texto.slice(h.end, fim);

    // Ordem: número(s) isolado(s) antes do cabeçalho (na mesma linha ou linha acima)
    const antes = texto.slice(Math.max(0, h.idx - 60), h.idx);
    const ordemMatch = antes.match(/(?:^|\n)\s*(\d{1,3})\s*\n[^\n]*$/);
    const ordemRaw = ordemMatch ? parseInt(ordemMatch[1], 10) : null;

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
    const relRegex = /RELATOR(?:A)?:\s*DEP\.\s*([^()\n]+?)\s*\(([A-ZÁÀÂÃÄÉÊÍÓÔÕÚÇ]+)-([A-Z]{2})\)\s*,?\s*EM\s*(\d{2}\/\d{2}\/\d{4})/gi;
    let relator = null, rm;
    while ((rm = relRegex.exec(bloco)) !== null) {
      relator = { nome: rm[1].trim(), partido: rm[2].trim(), uf: rm[3].trim(), data: rm[4] };
    }

    const temUrgencia = /APROVADO\s+O\s+REQUERIMENTO\s+DE\s+URG[ÊE]NCIA/i.test(bloco);

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
  const SIGLAS = ['REQ', 'REC', 'PLP', 'PEC', 'PDL', 'PDC', 'MPV', 'PRC', 'PL'];
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
      /EMENTA:\s*([\s\S]*?)(?=\n\s*(?:SITUAÇÃO:|SITUACAO:|RELATOR:|PARECER:|Notas técnicas:|APENSADAS|OUTROS AUTORES:|Acessória|\d{1,3}\s+(?:REQ|REC|PLP|PEC|PDL|MPV|PRC|PL)\s+[\d.]+\/\d{4})|$)/i
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
    const acessMatch = bloco.match(/Acess[óo]ria\s+do\s+(REQ|REC|PLP|PEC|PDL|MPV|PRC|PL)\s+([\d.]+)\/(\d{4})/i);
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
      const reAp = /(REQ|REC|PLP|PEC|PDL|MPV|PRC|PL)\s+([\d.]+)\/(\d{4})/gi;
      let am;
      while ((am = reAp.exec(apensBloco[1])) !== null) {
        apensadosTexto.push({
          sigla:  am[1].toUpperCase(),
          numero: am[2].replace(/\./g, ''),
          ano:    am[3],
        });
      }
    }

    const tipoCategoria = ehRedacaoFinal(h.idx) ? 'redacao_final'
      : (h.sigla === 'REQ' || h.sigla === 'REC') ? 'requerimento'
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

    // Apelido entre parênteses serve de ementa provisória até a API responder.
    const apel = resto.match(/\(([^)]+)\)/);
    porOrdem.set(ordem, {
      sigla, numero, ano, tipoCategoria,
      ementa: apel ? apel[1].trim() : '',
      projetoUrgenciado,
      ordem,
    });
  }

  resultado.itens = [...porOrdem.values()].sort((a, b) => a.ordem - b.ordem);
  return resultado;
}
