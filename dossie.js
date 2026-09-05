// Parecer de Especialista — camada de dados ("dossiê").
//
// O parecer que só respondia ao checklist saiu fraco na primeira rodada real
// (PL 5261/2026): correto e inútil. O que faltava não era prosa, era o que a
// prosa deveria sustentar — e isso a IA não tem como trazer, porque não pode
// inventar número. Este módulo traz, por JS, o que se consegue verificar:
//
//   fase 3  o que a proposição PREVIU — estimativas oficiais no próprio
//           processo (parecer, EMI), ou a declaração de que não há;
//   fase 4  a LEI VIGENTE lida do Planalto (texto, não memória) e as séries
//           públicas (BCB/SGS; planilha de arrecadação da RFB);
//   fase 5  PREVISTO × REALIZADO em janelas de 12 meses em torno do marco,
//           deflacionado pelo IPCA, com nível de evidência declarado;
//   fase 6  adaptadores setoriais (hoje: Relatórios do Programa Remessa
//           Conforme, da RFB), acionados por gatilho no texto.
//
// Regra do módulo: tudo que sai daqui tem fonte, URL e data; o que não se
// conseguiu obter é declarado em `avisos`, nunca preenchido. A IA recebe o
// dossiê pronto e não pode escrever número que não esteja nele ou nos achados.
//
// Script clássico (escopo global na extensão) + module.exports para os testes.

const SECOES_PARECER = [
  'Síntese',
  'Contexto e processo',
  'Lei vigente e datas de efeito',
  'O que se previu',
  'O que aconteceu',
  'Avaliação da política',
  'Os dois lados',
  'Opções e consequências',
  'Respostas por lente',
];

const URL_BCB = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.';
const URL_RFB_PLANILHA = 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos/receitadata/arrecadacao/serie-historica/arrecadacao-das-receitas-federais-1994-a-2025.xlsx/@@download/file';
const URL_RFB_PRC = 'https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/relatorios/remessas-internacionais';
const SERIE_CAMBIO = 3698;   // dólar venda, média mensal
const SERIE_IPCA = 433;      // IPCA, variação mensal (%)

// ============================================================
//  FASE 3 — estimativas oficiais no processo
// ============================================================

const RE_VALOR = /R\$\s?([\d.]+(?:,\d+)?)\s*(bilh(?:ão|ões)|milh(?:ão|ões)|mil(?![a-zç]))?/gi;
const RE_CONTEXTO_IMPACTO = /impacto|ren[úu]ncia|arrecada|estimativ|compensa|receita|perda de receita|custo fiscal/i;
const RE_NEGACAO_IMPACTO = /n[ãa]o\s+(ocasiona|acarreta|gera|implica|h[áa]|haver[áa]|resulta em)\s+(ren[úu]ncia|impacto|aumento de despesa|perda de receita)[^.]{0,120}\./gi;

/** Frases do processo com cifra em reais perto de vocabulário de impacto. */
function localizarEstimativas(texto, rotulo = 'documento') {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const achados = [];
  let m;
  RE_VALOR.lastIndex = 0;
  while ((m = RE_VALOR.exec(t)) !== null) {
    const ini = Math.max(0, m.index - 220), fim = Math.min(t.length, m.index + m[0].length + 160);
    const frase = t.slice(ini, fim);
    if (!RE_CONTEXTO_IMPACTO.test(frase)) continue;
    const num = Number(m[1].replace(/\./g, '').replace(',', '.'));
    const esc = (m[2] || '').toLowerCase();
    const valor = esc.startsWith('bilh') ? num * 1e9 : esc.startsWith('milh') ? num * 1e6 : esc === 'mil' ? num * 1e3 : num;
    achados.push({ valor, literal: m[0].trim(), trecho: frase.trim(), rotulo });
  }
  const negacoes = [];
  RE_NEGACAO_IMPACTO.lastIndex = 0;
  while ((m = RE_NEGACAO_IMPACTO.exec(t)) !== null) negacoes.push({ trecho: m[0].trim(), rotulo });
  return { estimativas: achados, negacoes };
}

// ============================================================
//  FASE 4 — marco, normas alteradas, lei vigente, rubricas
// ============================================================

const MESES_PT = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

function dataPorExtenso(s) {
  const m = /(\d{1,2})[ºo°]?\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i.exec(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  if (!m) return null;
  const mes = MESES_PT[m[2]];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Data de produção de efeitos declarada no texto (não a de publicação). */
function identificarMarco(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const padroes = [
    /(?:a partir de|com vig[êe]ncia (?:a partir )?de|produzir[áa] efeitos (?:a partir de|em)|entra(?:r[áa])? em vigor em)\s*(\d{1,2}[ºo°]?\s+de\s+[a-zçã]+\s+de\s+\d{4})/i,
    /(\d{1,2}[ºo°]?\s+de\s+[a-zçã]+\s+de\s+\d{4})[^.]{0,40}(?:in[íi]cio da cobran[çc]a|passa(?:m)? a ser tributad)/i,
  ];
  for (const re of padroes) {
    const m = re.exec(t);
    if (m) { const d = dataPorExtenso(m[1]); if (d) return { data: d, trecho: m[0].trim() }; }
  }
  // Data numérica ("a partir de 1º/8/2024", "vigência a partir de 1/8/2024").
  const n = /(?:a partir de|com vig[êe]ncia (?:a partir )?de|produzir[áa] efeitos (?:a partir de|em))\s*(\d{1,2})[ºo°]?\/(\d{1,2})\/(\d{4})/i.exec(t);
  if (n) return { data: `${n[3]}-${n[2].padStart(2, '0')}-${n[1].padStart(2, '0')}`, trecho: n[0].trim() };
  // "Entra em vigor na data de sua publicação" + a data do fecho ("Brasília,
  // 12 de maio de 2026"): é a vigência de MP e de lei sem vacatio.
  if (/entra(?:r[áa])? em vigor na data de sua publica[çc][ãa]o/i.test(t)) {
    const f = /Bras[íi]lia,?\s*(?:em\s*)?(\d{1,2}[ºo°]?\s+de\s+[a-zçã]+\s+de\s+\d{4})/i.exec(t);
    const d = f && dataPorExtenso(f[1]);
    if (d) return { data: d, trecho: `entra em vigor na data de sua publicação — ${f[0].trim()}` };
  }
  return null;
}

/**
 * Sem data de efeitos no texto, o marco cai para a data da norma MAIS RECENTE
 * citada (publicação) — declarado como aproximação, porque o método pede a
 * vigência efetiva, não a publicação. A mais citada costuma ser a norma
 * ALTERADA (um decreto-lei de 1980 no caso das remessas), que não é marco de
 * nada; por isso a escolha é pela data, e só nos últimos dez anos.
 */
function marcoPelaNorma(normas, hoje = new Date()) {
  const cand = (normas || []).filter(x => x.tipo !== 'mpv' && x.literal && x.ano >= hoje.getFullYear() - 10)
    .map(x => ({ ...x, data: dataPorExtenso(x.literal) })).filter(x => x.data).sort((a, b) => b.data.localeCompare(a.data));
  const n = cand[0];
  return n ? { data: n.data, trecho: n.literal, aproximado: true } : null;
}

// "Projeto de Lei nº 914, de 2024" não é lei; sem a guarda, virava "Lei 914/2024".
const RE_NORMA = /(?<!Projetos? de |Proposta de )\b(Lei Complementar|Decreto-Lei|Medida Provis[óo]ria|Lei)\s+n?[ºo°.]?\s*([\d.]+)\s*,?\s*de\s+(\d{1,2}[ºo°]?\s+de\s+[a-zçã]+\s+de\s+)?(\d{4})/gi;

/** Normas citadas com número e ano, para buscar o texto vigente. */
function normasCitadas(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const vistas = new Map();
  let m;
  RE_NORMA.lastIndex = 0;
  while ((m = RE_NORMA.exec(t)) !== null) {
    const tipoBruto = m[1].toLowerCase();
    const tipo = tipoBruto.startsWith('lei complementar') ? 'lcp' : tipoBruto.startsWith('decreto-lei') ? 'del' : tipoBruto.startsWith('medida') ? 'mpv' : 'lei';
    const numero = m[2].replace(/\./g, '');
    const chave = `${tipo}-${numero}`;
    if (!vistas.has(chave)) vistas.set(chave, { tipo, numero, ano: Number(m[4]), literal: m[0], vezes: 0 });
    vistas.get(chave).vezes++;
  }
  return [...vistas.values()].sort((a, b) => b.vezes - a.vezes);
}

/** URL do texto compilado no Planalto, pela convenção de pastas do portal. */
function urlPlanalto({ tipo, numero, ano }) {
  const base = 'https://www.planalto.gov.br/ccivil_03';
  const n = String(numero).replace(/\./g, '');
  const faixa = a => a >= 2023 ? '2023-2026' : a >= 2019 ? '2019-2022' : a >= 2015 ? '2015-2018' : a >= 2011 ? '2011-2014' : a >= 2007 ? '2007-2010' : a >= 2004 ? '2004-2006' : null;
  if (tipo === 'del') return `${base}/decreto-lei/${Number(n) < 2000 ? '' : ''}Del${n}.htm`;
  if (tipo === 'lcp') return `${base}/leis/lcp/Lcp${n}.htm`;
  const f = faixa(ano);
  if (tipo === 'mpv') return f ? `${base}/_ato${f}/${ano}/Mpv/mpv${n}.htm` : null;
  if (f) return `${base}/_ato${f}/${ano}/lei/L${n}.htm`;
  if (ano >= 2000) return `${base}/leis/${ano}/L${n}.htm`;
  return `${base}/leis/L${n}.htm`;
}

/**
 * Texto de uma norma, em cascata: Planalto (compilado; instável, devolve 503 ou
 * resposta vazia), depois LexML → página de publicação do Senado (texto como
 * publicado, NÃO compilado — o dossiê diz isso). A falha de cada fonte fica
 * registrada para o aviso; foi a ausência silenciosa disto que tirou o
 * objeto do parecer na rodada real da MPV 1357/2026.
 */
const URN_TIPO = { lei: 'lei', lcp: 'lei.complementar', del: 'decreto.lei', mpv: 'medida.provisoria' };
async function buscarTextoNorma(n, fetchFn) {
  const tentativas = [];
  const lerHtml = async (url, latin1) => {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    let html;
    if (latin1) { try { html = new TextDecoder('iso-8859-1').decode(buf); } catch (_) { html = new TextDecoder().decode(buf); } }
    else html = new TextDecoder().decode(buf);
    const texto = textoDoHtml(html);
    if (texto.length < 500) throw new Error('página sem texto');
    return { html, texto };
  };
  // 1. Planalto, duas tentativas
  const urlP = urlPlanalto(n);
  if (urlP) {
    for (let i = 0; i < 2; i++) {
      try { const { texto } = await lerHtml(urlP, true); return { texto, url: urlP, origem: 'planalto', compilado: true, tentativas }; }
      catch (e) { tentativas.push(`Planalto ${i + 1}ª tentativa: ${e.message}`); }
    }
  }
  // 2. LexML (URN sem data) → link "publicacao" do Senado
  const urn = URN_TIPO[n.tipo];
  if (urn) {
    const urlL = `https://www.lexml.gov.br/urn/urn:lex:br:federal:${urn}:${n.ano};${String(n.numero).replace(/\./g, '')}`;
    try {
      const { html } = await lerHtml(urlL, false);
      const m = /href="(https?:\/\/legis\.senado\.leg\.br\/norma\/\d+\/publicacao\/\d+)"/.exec(html);
      if (!m) throw new Error('LexML sem link de publicação');
      const urlS = m[1].replace(/^http:/, 'https:');
      const { texto } = await lerHtml(urlS, false);
      return { texto, url: urlS, origem: 'senado', compilado: false, tentativas };
    } catch (e) { tentativas.push(`LexML/Senado: ${e.message}`); }
  }
  return { texto: null, url: null, origem: null, compilado: false, tentativas };
}

/** HTML do Planalto (ISO-8859-1) → texto corrido. */
function textoDoHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Recorta um artigo do texto de lei ("Art. 1º" até o próximo "Art."). */
function extrairArtigo(textoLei, artigo) {
  const t = String(textoLei || '').replace(/\s+/g, ' ');
  const num = String(artigo).replace(/^art\.?\s*/i, '').replace(/[ºo°]/g, '').replace(/\.$/, '');
  const re = new RegExp(`Art\\.?\\s*${num}[ºo°]?[\\s.]`, 'i');
  const m = re.exec(t);
  if (!m) return null;
  const resto = t.slice(m.index);
  // O artigo termina no próximo "Art. N" de número MAIOR: o "Art. 1º" citado
  // dentro de um art. 32 que altera outra lei não encerra o art. 32.
  const atual = parseInt(num, 10);
  const re2 = /\sArt\.?\s*(\d+)[ºo°]?[\s.]/g;
  let p, corte = Math.min(resto.length, 8000);
  while ((p = re2.exec(resto.slice(6))) !== null) { if (parseInt(p[1], 10) > atual) { corte = p.index + 6; break; } }
  return resto.slice(0, corte).trim();
}

/** Rubricas da planilha de arrecadação da RFB, pelo tributo citado no texto. */
const RUBRICAS_RFB = [
  { chave: 'II', gatilho: /imposto (?:sobre|de) importa[çc][ãa]o|\bII\b/i, linha: /^IMPOSTO SOBRE IMPORTA/i, rotulo: 'Imposto sobre Importação' },
  { chave: 'IE', gatilho: /imposto (?:sobre|de) exporta[çc][ãa]o/i, linha: /^IMPOSTO SOBRE EXPORTA/i, rotulo: 'Imposto sobre Exportação' },
  { chave: 'IPI', gatilho: /\bIPI\b|produtos industrializados/i, linha: /^I\.?P\.?I\b.*(TOTAL)?/i, rotulo: 'IPI' },
  { chave: 'IR', gatilho: /imposto (?:sobre a |de )renda|\bIRPJ\b|\bIRPF\b|\bIRRF\b/i, linha: /^IMPOSTO SOBRE A RENDA\s*-?\s*TOTAL/i, rotulo: 'Imposto sobre a Renda (total)' },
  { chave: 'IOF', gatilho: /\bIOF\b|opera[çc][õo]es financeiras/i, linha: /^IOF\b/i, rotulo: 'IOF' },
  { chave: 'COFINS', gatilho: /\bCofins\b/i, linha: /^COFINS\b/i, rotulo: 'Cofins' },
  { chave: 'PIS', gatilho: /PIS\/?Pasep|\bPIS\b/i, linha: /PIS\/PASEP/i, rotulo: 'PIS/Pasep' },
  { chave: 'CSLL', gatilho: /\bCSLL\b|lucro l[íi]quido/i, linha: /^CSLL\b/i, rotulo: 'CSLL' },
  { chave: 'CIDE', gatilho: /\bCIDE\b/i, linha: /^CIDE/i, rotulo: 'Cide-Combustíveis' },
  { chave: 'PREV', gatilho: /contribui[çc][ãa]o previdenci[áa]ria|receita previdenci[áa]ria|\bRGPS\b/i, linha: /^RECEITA PREVIDENCI/i, rotulo: 'Receita previdenciária' },
];

/** Rubricas citadas, da mais mencionada para a menos — a primeira é a da matéria. */
function identificarRubricas(texto) {
  const t = String(texto || '');
  return RUBRICAS_RFB.map(r => ({ ...r, vezes: (t.match(new RegExp(r.gatilho.source, 'gi')) || []).length }))
    .filter(r => r.vezes > 0).sort((a, b) => b.vezes - a.vezes);
}

/** Planilha da RFB já aberta (objeto do SheetJS) → série mensal da rubrica, em R$ milhões. */
function serieDaPlanilhaRFB(workbook, linhaRegex) {
  const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const serie = [];
  for (const nome of workbook.SheetNames) {
    if (!/^\d{4}$/.test(nome)) continue;
    const ws = workbook.Sheets[nome];
    const linhas = XLSX_utils().sheet_to_json(ws, { header: 1, raw: true });
    const cab = linhas.find(l => l.some(c => c === 'JAN'));
    if (!cab) continue;
    const colMes = {};
    cab.forEach((c, i) => { if (typeof c === 'string' && MESES.includes(c)) colMes[i] = c; });
    const alvo = linhas.find(l => l.some(c => typeof c === 'string' && linhaRegex.test(c.trim())));
    if (!alvo) continue;
    for (const [i, mes] of Object.entries(colMes)) {
      const v = alvo[Number(i)];
      if (typeof v === 'number' && Number.isFinite(v)) serie.push({ mes: `${nome}-${String(MESES.indexOf(mes) + 1).padStart(2, '0')}`, valor: v });
    }
  }
  return serie.sort((a, b) => a.mes.localeCompare(b.mes));
}
function XLSX_utils() {
  if (typeof XLSX !== 'undefined' && XLSX.utils) return XLSX.utils;
  throw new Error('SheetJS (libs/xlsx.full.min.js) não carregado');
}

// ============================================================
//  BCB/SGS — câmbio e deflator
// ============================================================

/** Série do SGS entre duas datas (dd/mm/aaaa). Retorna [{mes:'AAAA-MM', valor}]. */
async function serieBCB(codigo, de, ate, fetchFn = (typeof fetch === 'function' ? fetch : null)) {
  if (!fetchFn) throw new Error('fetch indisponível');
  const url = `${URL_BCB}${codigo}/dados?formato=json&dataInicial=${de}&dataFinal=${ate}`;
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`BCB/SGS ${codigo}: HTTP ${r.status}`);
  const j = await r.json();
  return j.map(p => { const [, m, a] = p.data.split('/'); return { mes: `${a}-${m}`, valor: Number(p.valor) }; });
}

/** Índice acumulado a partir da variação mensal (%), base = último mês. */
function indiceAcumulado(serieVar) {
  const idx = {}; let acc = 1;
  for (const p of serieVar) { acc *= 1 + p.valor / 100; idx[p.mes] = acc; }
  return idx;
}

/** Fator que leva o valor nominal do mês a preços do mês de referência. */
function fatorDeflator(indice, mes, ref) {
  if (!indice[mes] || !indice[ref]) return null;
  return indice[ref] / indice[mes];
}

// ============================================================
//  FASE 5 — janelas previsto × realizado
// ============================================================

function listaMeses(de, ate) {
  const out = []; let [a, m] = de.split('-').map(Number); const [a2, m2] = ate.split('-').map(Number);
  while (a < a2 || (a === a2 && m <= m2)) { out.push(`${a}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; a++; } }
  return out;
}
function somaMeses(mes, n) {
  let [a, m] = mes.split('-').map(Number); m += n;
  while (m > 12) { m -= 12; a++; } while (m < 1) { m += 12; a--; }
  return `${a}-${String(m).padStart(2, '0')}`;
}

/**
 * Compara a média mensal dos 12 meses anteriores ao marco com a dos 12
 * posteriores. `deflator` (opcional) é {mes: fator} para trazer a preços de
 * uma referência. Nível: A com 12+12 meses; B com janela curta; C sem série.
 */
function janelas(serie, marcoISO, { meses = 12, deflator = null } = {}) {
  if (!Array.isArray(serie) || !serie.length || !marcoISO) return { nivel: 'C', motivo: 'sem série comparável ou sem marco' };
  const porMes = Object.fromEntries(serie.map(p => [p.mes, p.valor]));
  const marco = marcoISO.slice(0, 7);
  const antesDe = somaMeses(marco, -meses), antesAte = somaMeses(marco, -1);
  const depoisDe = marco, depoisAte = somaMeses(marco, meses - 1);
  const agrega = (de, ate) => {
    const ms = listaMeses(de, ate).filter(m => porMes[m] != null);
    if (!ms.length) return null;
    const soma = ms.reduce((s, m) => s + porMes[m], 0);
    const real = deflator ? ms.reduce((s, m) => s + porMes[m] * (deflator[m] || 1), 0) : null;
    return { de: ms[0], ate: ms[ms.length - 1], meses: ms.length, soma, media: soma / ms.length, mediaReal: real == null ? null : real / ms.length };
  };
  const antes = agrega(antesDe, antesAte), depois = agrega(depoisDe, depoisAte);
  if (!antes || !depois) return { nivel: 'C', motivo: 'série não cobre o marco', antes, depois };
  const nivel = antes.meses >= meses && depois.meses >= meses ? 'A' : 'B';
  return {
    nivel, marco: marcoISO, antes, depois,
    variacao: antes.media ? (depois.media - antes.media) / antes.media : null,
    variacaoReal: antes.mediaReal && depois.mediaReal != null ? (depois.mediaReal - antes.mediaReal) / antes.mediaReal : null,
  };
}

// ============================================================
//  FASE 6 — adaptador setorial: Relatórios do Programa Remessa Conforme (RFB)
// ============================================================

const GATILHO_PRC = /remessa conforme|remessas? (postais?|internacionais?|expressas?)|decreto-lei n[ºo°.]?\s*1\.?804/i;
const MESES_ARQ = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

// Os PDFs da RFB quebram os números com espaços ("27.077 . 987", "2 6.234.413").
// Apagam-se os espaços e reparte-se pela regra do formato pt-BR: após um
// separador vêm exatamente três dígitos; um quarto dígito começa outro número.
function repartirColados(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && /\d/.test(s[j])) j++;
    let num = s.slice(i, j);
    while (j < s.length && /[.,]/.test(s[j])) {
      const g = s.slice(j + 1, j + 4);
      if (!/^\d{3}$/.test(g)) break;
      num += g; j += 4;
      if (/\d/.test(s[j] || '')) break;
    }
    if (num) out.push(Number(num));
    if (j === i) j++;
    i = j;
  }
  return out;
}
function numerosDaLinha(linha, rotulo) {
  const resto = linha.slice(linha.toLowerCase().indexOf(rotulo.toLowerCase()) + rotulo.length).replace(/,\d{2}(?!\d)/g, '');
  return repartirColados(resto.replace(/[^\d.,]/g, ''));
}

/** Um relatório do PRC (texto extraído do PDF) → registro do período. */
function lerRelatorioPRC(texto, nomeArquivo) {
  const m = /(\d{4})-(\d{2})(?:-(\d{4}))?-?(\d{2})?-relatorio-prc-(.+?)(?:\.pdf|\.txt)?$/i.exec(String(nomeArquivo || '').split('/').pop());
  if (!m) return null;
  const nomes = m[5].split('-e-');
  const ano1 = Number(m[1]), mes1 = Number(m[2]);
  let ano2 = ano1, mes2 = mes1;
  if (nomes.length === 2) { mes2 = MESES_ARQ[nomes[1]] || mes1; ano2 = m[3] ? Number(m[3]) : ano1; }
  const periodo = { de: `${ano1}-${String(mes1).padStart(2, '0')}`, ate: `${ano2}-${String(mes2).padStart(2, '0')}`, meses: nomes.length };
  const linhas = String(texto || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  const acha = re => linhas.find(l => re.test(l));
  const pega = (l, rot) => { if (!l) return null; const n = numerosDaLinha(l, rot); return { qtd: n[0], usd: n[1], brl: n[2], ii: n[3] }; };
  const item = { arquivo: nomeArquivo, periodo, dir: pega(acha(/^DIR Registradas\s+[\d.]/), 'DIR Registradas'),
    prc: pega(acha(/^DIR Registradas?\s*-\s*PRC\s+[\d.]/), 'PRC'), naoPrc: pega(acha(/^DIR Registradas?\s*-\s*n[ãa]o PRC\s+[\d.]/), 'não PRC') };
  const lRec = acha(/^Brasil\s+[\d.]/) || acha(/Remessas Recebidas no Brasil\s+[\d.]/);
  if (lRec) item.remessasRecebidas = numerosDaLinha(lRec, lRec.startsWith('Brasil') ? 'Brasil' : 'Remessas Recebidas no Brasil')[0];
  else {
    const k = linhas.findIndex(l => /^Remessas Recebidas no/.test(l));
    const prox = k >= 0 ? linhas.slice(k + 1, k + 3).find(l => /^[\d. ]+$/.test(l)) : null;
    if (prox) item.remessasRecebidas = repartirColados(prox.replace(/[^\d.]/g, ''))[0];
  }
  if (!item.dir) {
    const plano = String(texto || '').replace(/\s+/g, ' ');
    const q = /total de remessas.{0,140}?foi de\s*([\d. ]+?)\s*(?:\(.*?\))?\s*,?\s*sendo que,?\s*(?:destas,\s*)?([\d. ]+?)\s*(?:\(|tiveram|foram)/i.exec(plano);
    if (q) { item.remessasRecebidas = Number(q[1].replace(/[^\d]/g, '')); item.dir = { qtd: Number(q[2].replace(/[^\d]/g, '')) }; }
  }
  // Conferência interna: PRC + não PRC = total, quando os três existem. A RFB
  // arredonda cada linha em separado; um real de diferença é da fonte.
  if (item.dir?.ii != null && item.prc?.ii != null && item.naoPrc?.ii != null) item.confere = Math.abs(item.prc.ii + item.naoPrc.ii - item.dir.ii) <= 2;
  // "U S$ 50,00" com espaço dentro — o PDF quebra até a sigla.
  const plano = String(texto || '').replace(/\s+/g, ' ').replace(/U\s?S\s?\$\s?/g, 'US$ ');
  item.notaII = /acima e abaixo de US\$ 50/i.test(plano) ? 'II do PRC sobre remessas acima e abaixo de US$ 50' : (/acima de US\$ 50/i.test(plano) ? 'II do PRC somente sobre remessas acima de US$ 50' : '');
  // O próprio relatório declara o marco da alteração legislativa ("com vigência a partir de 1/8/2024").
  const v = /vig[êe]ncia a partir de\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/i.exec(plano);
  if (v) item.vigenciaDeclarada = `${v[3]}-${v[2].padStart(2, '0')}-${v[1].padStart(2, '0')}`;
  return item;
}

/** Links dos relatórios na página-índice da RFB (com paginação do portal). */
function linksRelatoriosPRC(html) {
  const s = new Set();
  const re = /href="([^"]*remessas-internacionais\/[^"]+\.pdf)(?:\/view)?"/g;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) s.add(m[1]);
  return [...s].sort();
}

/** Média mensal de um conjunto de relatórios dentro de uma janela (limites nos bimestres). */
function agregarPRC(serie, de, ate) {
  const itens = (serie || []).filter(it => it.periodo.de >= de && it.periodo.ate <= ate && it.dir && it.dir.ii != null);
  const meses = itens.reduce((s, it) => s + it.periodo.meses, 0);
  if (!meses) return null;
  const soma = k => itens.reduce((s, it) => s + (k(it) || 0), 0);
  // de/ate são os meses realmente cobertos, não os pedidos: "2026-05 a 2027-04
  // (3 meses)" na rodada real era a janela pedida, não a série disponível.
  const r = { de: itens[0].periodo.de, ate: itens[itens.length - 1].periodo.ate, meses, relatorios: itens.length, remessas: soma(i => i.remessasRecebidas), dir: soma(i => i.dir.qtd), usd: soma(i => i.dir.usd), brl: soma(i => i.dir.brl), ii: soma(i => i.dir.ii), iiPrc: soma(i => i.prc?.ii), iiNaoPrc: soma(i => i.naoPrc?.ii), qtdPrc: soma(i => i.prc?.qtd) };
  r.porMes = { remessas: r.remessas / meses, dir: r.dir / meses, usd: r.usd / meses, brl: r.brl / meses, ii: r.ii / meses, iiPrc: r.iiPrc / meses, iiNaoPrc: r.iiNaoPrc / meses };
  r.aliquotaEfetiva = r.brl ? r.ii / r.brl : null;
  r.ticketUsd = r.dir ? r.usd / r.dir : null;
  r.participacaoPrc = r.dir ? r.qtdPrc / r.dir : null;
  return r;
}

// ============================================================
//  ORQUESTRAÇÃO
// ============================================================

const fmt = {
  n0: v => v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('pt-BR'),
  n1: v => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  n2: v => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: v => v == null || !Number.isFinite(v) ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%',
  mi: v => v == null || !Number.isFinite(v) ? '—' : (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  bi: v => v == null || !Number.isFinite(v) ? '—' : (v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  // Com sinal: o incremento pode ser negativo (rodada real da MPV 1357/2026
  // saiu "R$ -2.161.675.802" porque o limiar comparava o valor com sinal).
  brExt: v => v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '−' : '') + (Math.abs(v) >= 1e9 ? `R$ ${fmt.bi(Math.abs(v))} bi` : Math.abs(v) >= 1e6 ? `R$ ${fmt.mi(Math.abs(v))} mi` : `R$ ${fmt.n0(Math.abs(v))}`),
};

/**
 * Monta o dossiê. Recebe o texto dos documentos do processo (já extraído),
 * seus rótulos, e as funções de acesso — injetadas, para os testes rodarem sem
 * rede e a extensão usar o fetch e o pdf.js que já tem.
 *
 * Tudo que falhar vira aviso, e o parecer sai com o que houver.
 */
async function montarDossie({ fonte = '', rotulos = [], documentos = null, ementa = '', hoje = new Date(), fetchFn = null, lerPdf = null, abrirXlsx = null, comSeries = true, palavrasDoObjeto = null } = {}) {
  const d = { geradoEm: hoje.toISOString(), fontes: [], avisos: [], estimativas: [], negacoes: [], marco: null, normas: [], leiVigente: [], rubricas: [], series: {}, janelas: {}, prc: null, nivel: 'C' };
  const dataBR = iso => iso ? iso.split('-').reverse().join('/') : '';
  const acesso = `acesso em ${dataBR(hoje.toISOString().slice(0, 10))}`;

  // ---- fase 3 -------------------------------------------------------------
  // Documento a documento, para a estimativa sair com o rótulo do documento
  // em que está — e não com a lista inteira de rótulos colada.
  const docsLidos = (documentos && documentos.length) ? documentos : [{ rotulo: rotulos.join(' / ') || 'documentos do processo', texto: fonte }];
  if (!fonte && documentos) fonte = documentos.map(x => x.texto || '').join('\n');
  const est = { estimativas: [], negacoes: [] };
  for (const doc of docsLidos) { const r = localizarEstimativas(doc.texto, doc.rotulo); est.estimativas.push(...r.estimativas); est.negacoes.push(...r.negacoes); }
  d.estimativas = est.estimativas.slice(0, 12);
  d.negacoes = est.negacoes.slice(0, 6);
  // G6 — a estimativa é DESTA medida ou de outra parte do mesmo processo? Na
  // rodada real, os R$ 3,5 bi do Mover entraram como previsão da taxa das
  // remessas. O vínculo é decidido por palavras do objeto no trecho; sem
  // palavras informadas, fica indeterminado (null) e a redação é avisada.
  if (palavrasDoObjeto && palavrasDoObjeto.length) {
    const re = new RegExp(palavrasDoObjeto.map(p => String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
    for (const e of d.estimativas) e.vinculo = re.test(e.trecho);
  }
  if (!d.estimativas.length) d.avisos.push('Nenhuma estimativa oficial de impacto (valor em R$) localizada nos documentos do processo.');

  // ---- fase 4: marco e normas -------------------------------------------
  d.marco = identificarMarco(fonte);
  d.normas = normasCitadas(fonte).slice(0, 4);
  if (!d.marco) {
    d.marco = marcoPelaNorma(d.normas);
    if (d.marco) d.avisos.push(`Marco de vigência não declarado no texto: usada a data da norma mais citada (${d.marco.trecho}) como aproximação. Confirmar a data de produção de efeitos.`);
  }
  if (fetchFn) {
    for (const n of d.normas.filter(x => x.tipo !== 'mpv').slice(0, 3)) {
      const r = await buscarTextoNorma(n, fetchFn);
      if (!r.texto) { d.avisos.push(`Texto de ${n.literal} não obtido: ${r.tentativas.join('; ')}.`); continue; }
      const artigos = [...String(fonte).matchAll(new RegExp(`art\\.?\\s*(\\d+[ºo°]?)[^.]{0,80}${n.literal.split(',')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'))]
        .map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
      const trechos = artigos.map(a => ({ artigo: `Art. ${a}`, texto: extrairArtigo(r.texto, a) })).filter(x => x.texto);
      // Texto publicado (não compilado) de norma antiga NÃO é regra vigente:
      // na rodada real, o DL 1.804 de 1980 entrou como "vigente" com uma isenção
      // revogada em 2024. Fica no dossiê como contexto, marcado.
      const anoRef = Number((d.marco?.data || hoje.toISOString()).slice(0, 4));
      const desatualizado = !r.compilado && Number(n.ano) < anoRef - 1;
      d.leiVigente.push({ norma: n.literal, url: r.url, origem: r.origem, compilado: r.compilado, desatualizado, acesso, caracteres: r.texto.length,
        trechos: trechos.length ? trechos : [{ artigo: 'início', texto: r.texto.slice(0, 1500) }] });
      d.fontes.push({ nome: `${n.literal} — ${r.compilado ? 'texto compilado (Planalto)' : `texto publicado (Senado, via LexML), NÃO compilado${desatualizado ? ': norma de ' + n.ano + ', pode ter dispositivos alterados ou revogados' : ''}`}`, url: r.url, nivel: 'A' });
      if (desatualizado) d.avisos.push(`${n.literal}: só o texto original (${n.ano}) foi obtido; o texto compilado do Planalto não respondeu. Não usado como regra vigente.`);
    }
  }

  // ---- fase 4/5: séries ----------------------------------------------------
  d.rubricas = identificarRubricas(`${ementa} ${fonte.slice(0, 200000)}`);
  if (comSeries && fetchFn) {
    const de = '01/01/2019', ate = dataBR(hoje.toISOString().slice(0, 10));
    let deflator = null;
    try {
      const ipca = await serieBCB(SERIE_IPCA, de, ate, fetchFn);
      const idx = indiceAcumulado(ipca);
      const ref = ipca[ipca.length - 1].mes;
      deflator = Object.fromEntries(Object.keys(idx).map(m => [m, fatorDeflator(idx, m, ref)]));
      d.series.ipca = { ref, pontos: ipca.length };
      d.fontes.push({ nome: `IPCA mensal — BCB/SGS ${SERIE_IPCA} (deflator, preços de ${ref})`, url: `${URL_BCB}${SERIE_IPCA}/dados?formato=json`, nivel: 'A' });
    } catch (e) { d.avisos.push(`IPCA (BCB/SGS ${SERIE_IPCA}) não obtido: ${e.message}. Séries apresentadas em valores nominais.`); }
    try {
      const cambio = await serieBCB(SERIE_CAMBIO, de, ate, fetchFn);
      d.series.cambio = cambio;
      d.fontes.push({ nome: `Câmbio médio mensal (venda) — BCB/SGS ${SERIE_CAMBIO}`, url: `${URL_BCB}${SERIE_CAMBIO}/dados?formato=json`, nivel: 'A' });
      if (d.marco) d.janelas.cambio = janelas(cambio, d.marco.data);
    } catch (e) { d.avisos.push(`Câmbio (BCB/SGS ${SERIE_CAMBIO}) não obtido: ${e.message}.`); }

    if (d.rubricas.length && abrirXlsx) {
      try {
        const r = await fetchFn(URL_RFB_PLANILHA);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const wb = abrirXlsx(await r.arrayBuffer());
        for (const rub of d.rubricas.slice(0, 3)) {
          const s = serieDaPlanilhaRFB(wb, rub.linha);
          if (!s.length) { d.avisos.push(`Rubrica "${rub.rotulo}" não localizada na planilha da RFB.`); continue; }
          d.series[rub.chave] = { rotulo: rub.rotulo, unidade: 'R$ milhões', pontos: s.length, ultimo: s[s.length - 1] };
          if (d.marco) d.janelas[rub.chave] = { rotulo: rub.rotulo, ...janelas(s, d.marco.data, { deflator }) };
        }
        d.fontes.push({ nome: 'Arrecadação das receitas federais 1994 a 2025 — planilha RFB', url: URL_RFB_PLANILHA, nivel: 'A' });
      } catch (e) { d.avisos.push(`Planilha de arrecadação da RFB não obtida: ${e.message}.`); }
    } else if (d.rubricas.length) {
      d.avisos.push('Leitor de planilha indisponível: série de arrecadação da RFB não consultada.');
    }

    // ---- fase 6: adaptador PRC ----------------------------------------
    if (GATILHO_PRC.test(`${ementa} ${fonte}`) && lerPdf) {
      try {
        let html = '';
        for (const ini of [0, 20, 40]) {
          const r = await fetchFn(`${URL_RFB_PRC}?b_start:int=${ini}`);
          if (!r.ok) break;
          const h = await r.text();
          html += h;
          if (!/b_start:int=/.test(h) || linksRelatoriosPRC(h).length < 20) break;
        }
        const links = linksRelatoriosPRC(html);
        if (!links.length) throw new Error('nenhum relatório listado');
        const serie = [];
        for (const url of links) {
          try {
            const r = await fetchFn(url);
            if (!r.ok) continue;
            const item = lerRelatorioPRC(await lerPdf(await r.arrayBuffer()), url);
            if (item) serie.push(item);
          } catch (_) { /* relatório ilegível: segue */ }
        }
        serie.sort((a, b) => a.periodo.de.localeCompare(b.periodo.de));
        // Sem marco no texto (ou só aproximado), vale o que os relatórios da
        // RFB declaram como vigência da alteração legislativa.
        const declarada = serie.map(s => s.vigenciaDeclarada).filter(Boolean).sort()[0];
        if (declarada && (!d.marco || d.marco.aproximado)) {
          d.marco = { data: declarada, trecho: `vigência declarada nos Relatórios do Programa Remessa Conforme (RFB): a partir de ${declarada.split('-').reverse().join('/')}` };
          d.avisos = d.avisos.filter(a => !/^Marco de vigência não declarado/.test(a));
        }
        const marco = d.marco?.data?.slice(0, 7);
        const prc = { relatorios: serie.length, primeiro: serie[0]?.periodo.de, ultimo: serie[serie.length - 1]?.periodo.ate, serie, janelas: null };
        if (marco) {
          // Os bimestres da RFB pedem limites que coincidam com eles.
          const antes = agregarPRC(serie, somaMeses(marco, -12), somaMeses(marco, -1));
          const depois = agregarPRC(serie, marco, somaMeses(marco, 11));
          const depois2 = agregarPRC(serie, somaMeses(marco, 12), somaMeses(marco, 23));
          prc.janelas = { antes, depois, depois2, nivel: antes && depois ? (antes.meses >= 12 && depois.meses >= 12 ? 'A' : 'B') : 'C' };
        }
        d.prc = prc;
        d.fontes.push({ nome: `Relatórios de Resultados do Programa Remessa Conforme — RFB (${serie.length} relatórios, ${prc.primeiro} a ${prc.ultimo})`, url: URL_RFB_PRC, nivel: 'A' });
      } catch (e) { d.avisos.push(`Relatórios do Remessa Conforme (RFB) não obtidos: ${e.message}.`); }
    }
  } else if (comSeries) {
    d.avisos.push('Sem acesso à rede: séries do BCB e da RFB não consultadas.');
  }

  // ---- nível geral ---------------------------------------------------------
  const niveis = [...Object.values(d.janelas).map(j => j.nivel), d.prc?.janelas?.nivel].filter(Boolean);
  d.nivel = niveis.includes('A') ? 'A' : niveis.includes('B') ? 'B' : 'C';
  if (!d.marco) d.avisos.push('Marco de vigência não identificado no texto: previsto × realizado não calculado.');
  d.texto = textoDoDossie(d);
  d.numeros = numerosDoDossie(d.texto);
  return d;
}

/** O dossiê como o modelo o recebe: tabelas em texto, com fonte e nível. */
function textoDoDossie(d) {
  const L = [];
  L.push(`NÍVEL DE EVIDÊNCIA DO PREVISTO × REALIZADO: ${d.nivel} (A = estimativa ou série oficial com 12 meses antes e depois do marco; B = janela curta; C = sem série comparável).`);
  L.push('');
  L.push('ESTIMATIVAS OFICIAIS LOCALIZADAS NOS DOCUMENTOS DO PROCESSO (fase 3) — cifras em reais perto de vocabulário de impacto; LEIA O TRECHO: a cifra pode se referir a outra parte do mesmo processo, e não à medida analisada:');
  if (d.estimativas.length) d.estimativas.forEach(e => L.push(`  · ${e.literal} — "${e.trecho.slice(0, 260)}" [${e.rotulo}]`));
  else L.push('  · Nenhuma. O processo não traz estimativa de impacto em reais.');
  d.negacoes.forEach(n => L.push(`  · Declaração de ausência de impacto: "${n.trecho}" [${n.rotulo}]`));
  L.push('');
  L.push(`MARCO DE VIGÊNCIA: ${d.marco ? `${d.marco.data.split('-').reverse().join('/')} — "${d.marco.trecho}"${d.marco.aproximado ? ' (APROXIMAÇÃO: data da norma, não da produção de efeitos)' : ''}` : 'não identificado no texto'}`);
  if (d.marco && !/-01$/.test(d.marco.data)) L.push(`  · O marco não cai no dia 1º: o mês ${d.marco.data.slice(0, 7)} é PARCIAL e entra na janela "depois" misturando os dois regimes. Dizer isso ao usar a janela.`);
  if (d.leiVigente.length) {
    L.push('');
    L.push('LEI VIGENTE (texto lido no Planalto, não memória):');
    d.leiVigente.forEach(l => { L.push(`  · ${l.norma} (${l.url}, ${l.acesso})`); l.trechos.forEach(t => L.push(`    ${t.artigo}: ${t.texto.slice(0, 900)}`)); });
  }
  for (const [k, j] of Object.entries(d.janelas)) {
    const rot = j.rotulo || (k === 'cambio' ? 'Câmbio médio (R$/US$)' : k);
    const un = k === 'cambio' ? '' : ' (R$ milhões/mês)';
    if (!j.antes || !j.depois) {
      L.push('');
      L.push(`SÉRIE ${rot}${un} — nível C: ${j.antes ? `a série disponível termina em ${j.antes.ate} e não cobre o período posterior ao marco; média mensal dos ${j.antes.meses} meses anteriores: ${fmt.n1(j.antes.media)}` : (j.motivo || 'não comparável')}. Não usar como "depois".`);
      continue;
    }
    L.push('');
    L.push(`SÉRIE ${rot}${un} — nível ${j.nivel}:`);
    L.push(`  · antes: ${j.antes.de} a ${j.antes.ate} (${j.antes.meses} meses), média mensal ${fmt.n1(j.antes.media)}${j.antes.mediaReal != null ? `, a preços de ${d.series.ipca?.ref}: ${fmt.n1(j.antes.mediaReal)}` : ''}`);
    L.push(`  · depois: ${j.depois.de} a ${j.depois.ate} (${j.depois.meses} meses), média mensal ${fmt.n1(j.depois.media)}${j.depois.mediaReal != null ? `, a preços de ${d.series.ipca?.ref}: ${fmt.n1(j.depois.mediaReal)}` : ''}`);
    L.push(`  · variação da média mensal: ${fmt.pct(j.variacao)} nominal${j.variacaoReal != null ? `, ${fmt.pct(j.variacaoReal)} real` : ''}`);
  }
  if (d.prc?.janelas?.antes && d.prc.janelas.depois) {
    const { antes: a, depois: b, depois2: c } = d.prc.janelas;
    const lin = (rot, f) => L.push(`  · ${rot}: antes ${f(a)} | ano 1 ${f(b)}${c ? ` | ano 2 ${f(c)}` : ''}`);
    L.push('');
    L.push(`SÉRIE SETORIAL — Relatórios do Programa Remessa Conforme (RFB), médias mensais, nível ${d.prc.janelas.nivel}. Janelas: antes ${a.de} a ${a.ate} (${a.meses} meses); ano 1 ${b.de} a ${b.ate} (${b.meses} meses)${c ? `; ano 2 ${c.de} a ${c.ate} (${c.meses} meses)` : ''}. "II devido" é o imposto apurado nas declarações, não o caixa.`);
    lin('Remessas recebidas (milhões/mês)', x => fmt.mi(x.porMes.remessas));
    lin('Valor aduaneiro (US$ milhões/mês)', x => fmt.mi(x.porMes.usd));
    lin('Ticket médio por declaração (US$)', x => fmt.n2(x.ticketUsd));
    lin('II devido total (R$ milhões/mês)', x => fmt.mi(x.porMes.ii));
    lin('II devido no PRC (R$ milhões/mês)', x => fmt.mi(x.porMes.iiPrc));
    lin('II devido fora do PRC (R$ milhões/mês)', x => fmt.mi(x.porMes.iiNaoPrc));
    lin('Alíquota efetiva (II / valor aduaneiro em R$)', x => fmt.pct(x.aliquotaEfetiva));
    lin('Participação do PRC nas declarações', x => fmt.pct(x.participacaoPrc));
    L.push(`  · variação de remessas/mês antes → ano 1: ${fmt.pct((b.porMes.remessas - a.porMes.remessas) / a.porMes.remessas)}; II devido total: ${fmt.pct((b.porMes.ii - a.porMes.ii) / a.porMes.ii)}; incremento anualizado do II no PRC: ${fmt.brExt((b.porMes.iiPrc - a.porMes.iiPrc) * 12)}`);
  } else if (d.prc) {
    L.push('');
    L.push(`SÉRIE SETORIAL — Relatórios do Programa Remessa Conforme (RFB): ${d.prc.relatorios} relatórios lidos (${d.prc.primeiro} a ${d.prc.ultimo}); sem marco, janelas não calculadas.`);
  }
  if (d.fontes.length) { L.push(''); L.push('FONTES DO DOSSIÊ:'); d.fontes.forEach(f => L.push(`  · [${f.nivel}] ${f.nome} — ${f.url}`)); }
  if (d.avisos.length) { L.push(''); L.push('NÃO OBTIDO / NÃO VERIFICADO:'); d.avisos.forEach(a => L.push(`  · ${a}`)); }
  return L.join('\n');
}

/** O que do dossiê se guarda com o parecer e se imprime — sem a série bruta inteira. */
function resumoDoDossie(d) {
  if (!d) return null;
  return {
    nivel: d.nivel, geradoEm: d.geradoEm, texto: d.texto, fontes: d.fontes, avisos: d.avisos, marco: d.marco,
    estimativas: d.estimativas.map(e => ({ literal: e.literal, trecho: e.trecho.slice(0, 320), rotulo: e.rotulo })),
    negacoes: d.negacoes, series: d.series.ipca ? { ipca: d.series.ipca } : {},
    leiVigente: d.leiVigente.map(l => ({ norma: l.norma, url: l.url, acesso: l.acesso, trechos: l.trechos.map(t => ({ artigo: t.artigo, texto: t.texto.slice(0, 700) })) })),
    janelas: d.janelas,
    prc: d.prc ? { relatorios: d.prc.relatorios, primeiro: d.prc.primeiro, ultimo: d.prc.ultimo, janelas: d.prc.janelas,
      serie: (d.prc.serie || []).map(s => ({ de: s.periodo.de, ate: s.periodo.ate, meses: s.periodo.meses, remessas: s.remessasRecebidas ?? null, dir: s.dir?.qtd ?? null, usd: s.dir?.usd ?? null, brl: s.dir?.brl ?? null, ii: s.dir?.ii ?? null, iiPrc: s.prc?.ii ?? null, iiNaoPrc: s.naoPrc?.ii ?? null })) } : null,
  };
}

/**
 * As TABELAS do dossiê, em HTML, para o PDF do parecer. O texto corrido é
 * para o modelo ler; o leitor do parecer quer a tabela — foi a primeira
 * coisa que a Liderança cobrou quando o anexo saiu como texto despejado.
 */
function tabelasDoDossie(r, esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))) {
  if (!r) return { corpo: '', anexo: '' };
  const t = (cab, linhas, alinhar = []) => linhas.length ? `<table class="dt"><thead><tr>${cab.map((c, i) => `<th class="${alinhar[i] || ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map((c, i) => `<td class="${alinhar[i] || ''}">${c == null ? '—' : c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
  const leg = s => `<p class="dt-leg">${s}</p>`;
  const H = [];

  // Tabela 1 — o que se previu
  const est = r.estimativas.map(e => [`<b>${esc(e.literal)}</b>`, esc(e.trecho), esc(e.rotulo)]);
  r.negacoes.forEach(n => est.push(['<b>sem impacto (declaração)</b>', esc(n.trecho), esc(n.rotulo)]));
  H.push(`<h4 class="dt-h">Tabela 1 — Estimativas oficiais e declarações de impacto no processo</h4>`);
  H.push(est.length ? t(['Cifra', 'Trecho literal', 'Documento'], est) : leg('Nenhuma estimativa oficial de impacto em reais localizada nos documentos do processo.'));

  // Tabela 2 — marco e lei vigente
  const lv = [];
  if (r.marco) lv.push(['Marco de vigência', esc(r.marco.data.split('-').reverse().join('/')) + (r.marco.aproximado ? ' (aproximação: data da norma)' : ''), esc(r.marco.trecho)]);
  r.leiVigente.forEach(l => l.trechos.forEach(x => lv.push([esc(l.norma), esc(x.artigo), esc(x.texto)])));
  if (lv.length) { H.push(`<h4 class="dt-h">Tabela 2 — Marco e lei vigente (texto lido, não memória)</h4>`); H.push(t(['Item', 'Data / artigo', 'Conteúdo'], lv)); }

  // Tabela 3 — séries oficiais em janelas
  const jan = [];
  for (const [k, j] of Object.entries(r.janelas || {})) {
    const rot = j.rotulo || (k === 'cambio' ? 'Câmbio médio (R$/US$)' : k);
    const un = k === 'cambio' ? '' : ', R$ milhões/mês';
    if (j.antes && j.depois) jan.push([esc(rot + un), `${j.antes.de} a ${j.antes.ate} (${j.antes.meses}m)`, fmt.n2(j.antes.media), `${j.depois.de} a ${j.depois.ate} (${j.depois.meses}m)`, fmt.n2(j.depois.media), fmt.pct(j.variacao) + (j.variacaoReal != null ? ` (real ${fmt.pct(j.variacaoReal)})` : ''), j.nivel]);
    else if (j.antes) jan.push([esc(rot + un), `${j.antes.de} a ${j.antes.ate} (${j.antes.meses}m)`, fmt.n2(j.antes.media), 'série termina antes do marco', '—', '—', 'C']);
  }
  if (jan.length) { H.push(`<h4 class="dt-h">Tabela 3 — Séries oficiais: 12 meses antes e depois do marco (médias mensais)</h4>`); H.push(t(['Série', 'Antes', 'Média', 'Depois', 'Média', 'Variação', 'Nível'], jan, ['', '', 'num', '', 'num', 'num', ''])); }

  // Tabela 4 — Remessa Conforme
  const pj = r.prc?.janelas;
  if (pj?.antes && pj?.depois) {
    const a = pj.antes, b = pj.depois, c = pj.depois2;
    const cab = ['Indicador (média mensal)', `Antes ${a.de} a ${a.ate} (${a.meses}m)`, `Depois ${b.de} a ${b.ate} (${b.meses}m)`, 'Var.'].concat(c ? [`Ano 2 ${c.de} a ${c.ate} (${c.meses}m)`] : []);
    const lin = (rot, f, v) => [esc(rot), f(a), f(b), v ? fmt.pct((v(b) - v(a)) / v(a)) : ''].concat(c ? [f(c)] : []);
    H.push(`<h4 class="dt-h">Tabela 4 — Relatórios do Programa Remessa Conforme (RFB): antes × depois do marco (nível ${esc(pj.nivel)})</h4>`);
    H.push(t(cab, [
      lin('Remessas recebidas (milhões)', x => fmt.mi(x.porMes.remessas), x => x.porMes.remessas),
      lin('Declarações registradas (milhões)', x => fmt.mi(x.porMes.dir), x => x.porMes.dir),
      lin('Valor aduaneiro (US$ milhões)', x => fmt.mi(x.porMes.usd), x => x.porMes.usd),
      lin('Valor aduaneiro (R$ milhões)', x => fmt.mi(x.porMes.brl), x => x.porMes.brl),
      lin('Ticket médio por declaração (US$)', x => fmt.n2(x.ticketUsd), x => x.ticketUsd),
      lin('II devido total (R$ milhões)', x => fmt.mi(x.porMes.ii), x => x.porMes.ii),
      lin('II devido no PRC (R$ milhões)', x => fmt.mi(x.porMes.iiPrc), x => x.porMes.iiPrc),
      lin('II devido fora do PRC (R$ milhões)', x => fmt.mi(x.porMes.iiNaoPrc), x => x.porMes.iiNaoPrc),
      lin('Alíquota efetiva (II / valor aduaneiro R$)', x => fmt.pct(x.aliquotaEfetiva), null),
      lin('Participação do PRC nas declarações', x => fmt.pct(x.participacaoPrc), null),
    ], ['', 'num', 'num', 'num', 'num']));
    H.push(leg(`"II devido" é o imposto apurado nas declarações registradas, não o caixa. Incremento anualizado do II devido no PRC (depois × antes): ${esc(fmt.brExt((b.porMes.iiPrc - a.porMes.iiPrc) * 12))}. Comparação de médias; o parecer não atribui a diferença à medida.`));
  }
  const corpo = H.join('\n');

  // Anexo — série completa e fontes
  const A = [];
  if (r.prc?.serie?.length) {
    A.push(`<h4 class="dt-h">Tabela 5 — Série completa dos Relatórios do Programa Remessa Conforme (${r.prc.relatorios} relatórios, ${esc(r.prc.primeiro)} a ${esc(r.prc.ultimo)})</h4>`);
    A.push(t(['Período', 'Meses', 'Remessas', 'Declarações', 'Valor aduaneiro US$', 'Valor aduaneiro R$', 'II devido R$', 'II no PRC', 'II fora do PRC'],
      r.prc.serie.map(s => [s.meses === 2 ? `${s.de} a ${s.ate}` : s.de, s.meses, fmt.n0(s.remessas), fmt.n0(s.dir), fmt.n0(s.usd), fmt.n0(s.brl), fmt.n0(s.ii), fmt.n0(s.iiPrc), fmt.n0(s.iiNaoPrc)]),
      ['', 'num', 'num', 'num', 'num', 'num', 'num', 'num', 'num']));
  }
  if (r.fontes?.length) { A.push(`<h4 class="dt-h">Fontes do dossiê</h4>`); A.push(t(['Nível', 'Fonte', 'URL'], r.fontes.map(f => [esc(f.nivel), esc(f.nome), `<a href="${esc(f.url)}">${esc(f.url)}</a>`]))); }
  if (r.avisos?.length) { A.push(`<h4 class="dt-h">Não obtido ou não verificado</h4><ul class="dt-ul">${r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`); }
  return { corpo, anexo: A.join('\n') };
}

const CSS_TABELAS_DOSSIE = `
    .dt { border-collapse:collapse; width:100%; margin:6px 0 10px; font-size:8.6pt; page-break-inside:auto; }
    .dt th, .dt td { border:1px solid #bfc7cf; padding:3px 5px; vertical-align:top; text-align:left; }
    .dt th { background:#eef2f5; font-weight:600; }
    .dt td.num, .dt th.num { text-align:right; white-space:nowrap; }
    .dt tr { page-break-inside:avoid; }
    .dt-h { font-size:10pt; margin:10px 0 2px; color:#1d3d2a; page-break-after:avoid; }
    .dt-leg { font-size:8.8pt; color:#555; margin:0 0 8px; }
    .dt-ul { font-size:9pt; margin:2px 0 8px 16px; padding:0; }
    .dt-ul li { font-size:9pt; margin:1px 0; }`;

/** Números de um texto, no formato pt-BR ("1.234,5" → 1234.5). */
function numerosDoTexto(texto) {
  const nums = new Set();
  for (const n of String(texto || '').match(/\d[\d.]*(?:,\d+)?/g) || []) {
    const v = Number(n.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(v)) nums.add(Math.abs(v));
  }
  return [...nums];
}
/** Números presentes no texto do dossiê — a lista branca extra da conferência. */
function numerosDoDossie(texto) { return numerosDoTexto(texto); }

/**
 * O dossiê como EVIDÊNCIAS numeradas (D-n para dados, LV-n para lei), cada
 * uma com texto, números e nível. É contra isto que a tese é validada: uma
 * afirmação só vale se citar identificadores que existem e se todo número
 * dela constar das evidências citadas.
 */
function itensDoDossie(d) {
  const itens = [];
  if (!d) return itens;
  let nd = 0, nl = 0;
  const add = (texto, nivel, fonte, extra = {}) => { const id = `D${++nd}`; itens.push({ id, tipo: 'dossie', texto, numeros: numerosDoTexto(texto), nivel, fonte, ...extra }); return id; };
  const dataBR = iso => iso ? String(iso).split('-').reverse().join('/') : '';
  for (const e of d.estimativas || []) {
    add(`Estimativa no processo: ${e.literal} — "${e.trecho.slice(0, 300)}" [${e.rotulo}]${e.vinculo === false ? ' (NÃO vinculada ao objeto analisado: trata de outra parte do processo)' : ''}`, 'A', e.rotulo, { vinculo: e.vinculo ?? null });
  }
  for (const n of d.negacoes || []) add(`Declaração de ausência de impacto: "${n.trecho}" [${n.rotulo}]`, 'A', n.rotulo);
  if (d.marco) add(`Marco de vigência: ${dataBR(d.marco.data)} — ${d.marco.trecho}${d.marco.aproximado ? ' (aproximação: data da norma, não da produção de efeitos)' : ''}${!/-01$/.test(d.marco.data) ? `; o mês ${d.marco.data.slice(0, 7)} é parcial` : ''}`, 'A', 'texto analisado');
  for (const l of d.leiVigente || []) for (const t of l.trechos || []) {
    const id = `LV${++nl}`;
    const texto = `${l.norma}, ${t.artigo} (${l.compilado ? 'texto compilado, Planalto' : l.desatualizado ? 'TEXTO ORIGINAL, NÃO COMPILADO — dispositivos podem ter sido alterados ou revogados; NÃO é a regra vigente, só contexto histórico' : 'texto publicado, Senado via LexML, não compilado'}): ${t.texto.slice(0, 1200)}`;
    itens.push({ id, tipo: 'lei', texto, numeros: numerosDoTexto(texto), nivel: l.desatualizado ? 'C' : 'A', fonte: l.url, desatualizado: !!l.desatualizado });
  }
  for (const [k, j] of Object.entries(d.janelas || {})) {
    const rot = j.rotulo || (k === 'cambio' ? 'Câmbio médio (R$/US$)' : k);
    const un = k === 'cambio' ? '' : ' (R$ milhões/mês)';
    if (j.antes && j.depois) add(`${rot}${un}: antes ${j.antes.de} a ${j.antes.ate} (${j.antes.meses} meses) média ${fmt.n1(j.antes.media)}; depois ${j.depois.de} a ${j.depois.ate} (${j.depois.meses} meses) média ${fmt.n1(j.depois.media)}; variação ${fmt.pct(j.variacao)} nominal${j.variacaoReal != null ? `, ${fmt.pct(j.variacaoReal)} real` : ''}. Nível ${j.nivel}.`, j.nivel, 'BCB/RFB');
    else if (j.antes) add(`${rot}${un}: série termina em ${j.antes.ate}, antes do marco; média dos ${j.antes.meses} meses anteriores ${fmt.n1(j.antes.media)}. Não comparável (nível C).`, 'C', 'RFB');
  }
  const pj = d.prc?.janelas;
  if (pj?.antes && pj?.depois) {
    const a = pj.antes, b = pj.depois, c = pj.depois2;
    const nivel = pj.nivel;
    const lin = (rot, f) => add(`Remessa Conforme (RFB), ${rot}: antes (${a.de} a ${a.ate}, ${a.meses} meses) ${f(a)}; depois (${b.de} a ${b.ate}, ${b.meses} meses) ${f(b)}${c ? `; ano 2 (${c.de} a ${c.ate}, ${c.meses} meses) ${f(c)}` : ''}. Nível ${nivel}.`, nivel, 'RFB');
    lin('remessas recebidas por mês (milhões)', x => fmt.mi(x.porMes.remessas));
    lin('valor aduaneiro por mês (US$ milhões)', x => fmt.mi(x.porMes.usd));
    lin('ticket médio por declaração (US$)', x => fmt.n2(x.ticketUsd));
    lin('II devido total por mês (R$ milhões)', x => fmt.mi(x.porMes.ii));
    lin('II devido no PRC por mês (R$ milhões)', x => fmt.mi(x.porMes.iiPrc));
    lin('II devido fora do PRC por mês (R$ milhões)', x => fmt.mi(x.porMes.iiNaoPrc));
    lin('alíquota efetiva (II / valor aduaneiro em R$)', x => fmt.pct(x.aliquotaEfetiva));
    lin('participação do PRC nas declarações', x => fmt.pct(x.participacaoPrc));
    add(`Remessa Conforme (RFB), variações antes → depois: remessas/mês ${fmt.pct((b.porMes.remessas - a.porMes.remessas) / a.porMes.remessas)}; II devido total ${fmt.pct((b.porMes.ii - a.porMes.ii) / a.porMes.ii)}; incremento anualizado do II devido no PRC ${fmt.brExt((b.porMes.iiPrc - a.porMes.iiPrc) * 12)}. Comparação de médias, sem atribuição causal. Nível ${nivel}.`, nivel, 'RFB');
  } else if (d.prc) add(`Remessa Conforme (RFB): ${d.prc.relatorios} relatórios lidos (${d.prc.primeiro} a ${d.prc.ultimo}); sem marco, janelas não calculadas.`, 'C', 'RFB');
  for (const f of d.fontes || []) add(`Fonte consultada [${f.nivel}]: ${f.nome} — ${f.url}`, f.nivel, f.url, { fonteApenas: true });
  for (const a of d.avisos || []) add(`NÃO OBTIDO: ${a}`, 'C', 'dossiê', { aviso: true });
  return itens;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SECOES_PARECER, localizarEstimativas, identificarMarco, marcoPelaNorma, normasCitadas, urlPlanalto, textoDoHtml, extrairArtigo,
    identificarRubricas, RUBRICAS_RFB, serieDaPlanilhaRFB, serieBCB, indiceAcumulado, fatorDeflator, janelas,
    lerRelatorioPRC, linksRelatoriosPRC, agregarPRC, GATILHO_PRC, montarDossie, textoDoDossie, numerosDoDossie,
    resumoDoDossie, tabelasDoDossie, CSS_TABELAS_DOSSIE, buscarTextoNorma, itensDoDossie, numerosDoTexto, fmt,
  };
}
