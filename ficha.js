// Parecer de Especialista — a FICHA DO OBJETO.
//
// O parecer gerado na rodada real da MPV 1357/2026 nunca disse 20%, 60%,
// US$ 50 nem que revertia a Lei 14.902/2024: o leitor não ficava sabendo qual
// era o tributo. A ficha é o remédio estrutural: antes de qualquer redação, o
// programa monta "regra vigente → regra proposta → a partir de quando", com
// os valores em algarismos, e a síntese é obrigada a enunciá-los (gate G2).
// A ficha é impressa na primeira página, por JS, com a origem de cada campo.
//
// Fontes da regra vigente, em ordem: texto compilado (Planalto); texto
// publicado (Senado via LexML, não compilado); o que o próprio documento
// analisado transcreve (achado "regra_antes" com trecho conferido). A origem
// fica declarada — regra tirada do documento não é a mesma coisa que regra
// lida na lei.
//
// Script clássico (global na extensão) + module.exports para os testes.

const RE_VALOR_FICHA = /(?:US\$|R\$|€)\s?[\d.]+(?:,\d+)?|\d+(?:,\d+)?\s?%|\b\d+\s+(?:anos?|meses|dias)\b/g;

/** Normaliza token e texto para comparação: minúsculas, sem espaços, sem ",00", sem ponto de milhar. */
function normalizarValor(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/,00(?!\d)/g, '').replace(/\.(?=\d{3})/g, '').replace(/,0(?!\d)/g, '');
}

function valoresDoTexto(texto) {
  const vistos = new Set(), out = [];
  for (const m of String(texto || '').match(RE_VALOR_FICHA) || []) {
    const n = normalizarValor(m);
    if (!vistos.has(n)) { vistos.add(n); out.push({ token: m.trim(), norm: n }); }
  }
  return out;
}

/**
 * Monta a ficha a partir dos achados da apuração (lente X: dispositivo,
 * regra_antes, regra_depois), dos trechos de lei vigente do dossiê e do marco.
 */
// "[^.]" pararia em "3.000,00" e em "art. 1º": o ponto seguido de dígito ou de espaço curto não encerra a frase.
const ATE_FIM_DA_FRASE = '(?:[^.]|\\.(?=\\d)|\\.(?= ?(?:[a-z§]|\\d))){0,420}';
const PADROES_REGRA_ATUAL = [
  new RegExp(`(?:é|são) calculad[oa]s? (?:de acordo com|conforme) a seguinte tabela${ATE_FIM_DA_FRASE}`, 'i'),
  new RegExp(`tabela progressiva[:\\s]${ATE_FIM_DA_FRASE}`, 'i'),
  new RegExp(`(?:reda[çc][ãa]o|regra|texto|disciplina) (?:atual|vigente|em vigor)${ATE_FIM_DA_FRASE}`, 'i'),
  new RegExp(`atualmente,?${ATE_FIM_DA_FRASE}`, 'i'),
  new RegExp(`(?:hoje|na legisla[çc][ãa]o vigente),?${ATE_FIM_DA_FRASE}`, 'i'),
];
/** Recorta a transcrição logo após o último valor: o que vem depois já é outro assunto ("11 Ao atribuir competência…"). */
function recortarRegra(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  let fim = -1; const re = new RegExp(RE_VALOR_FICHA.source, 'g'); let m;
  while ((m = re.exec(t)) !== null) fim = m.index + m[0].length;
  return fim > 0 ? t.slice(0, Math.min(t.length, fim + 1)).replace(/[,;:\s]+$/, '') : t.slice(0, 700);
}

/** Transcrição da regra atual localizada no texto por padrão fixo — exige ao menos dois valores. */
function regraVigenteNoTexto(fonte) {
  const t = String(fonte || '').replace(/\s+/g, ' ');
  for (const re of PADROES_REGRA_ATUAL) {
    const m = re.exec(t);
    if (!m) continue;
    const texto = recortarRegra(m[0].slice(0, 700));
    if (valoresDoTexto(texto).length >= 2) return { texto };
  }
  return null;
}

/**
 * Cláusula de vigência do texto ("entra em vigor noventa dias após a data de sua
 * publicação"): para projeto ainda não aprovado, é a única "data de efeito" que
 * existe — condicional. A MP e a lei publicada têm data; o projeto tem cláusula.
 */
function clausulaDeVigencia(fonte) {
  const t = String(fonte || '').replace(/\s+/g, ' ');
  const m = /entra(?:r[áa])? em vigor (na data de sua publica[çc][ãa]o|(?:[a-zçãéí]+|\d+)\s*(?:\([^)]{1,30}\)\s*)?dias?,? (?:ap[óo]s|depois de|contados? d[ae])[^.;]{0,80}|em \d{1,2}[ºo°]? de [a-zçã]+ de \d{4}|no (?:primeiro|1º) dia[^.;]{0,60})/i.exec(t);
  return m ? { clausula: m[1].trim().replace(/\s+,/g, ','), trecho: m[0].trim() } : null;
}

function montarFicha({ achados = [], leiVigente = [], marco = null, identificacao = '', fonte = '', sigla = '' } = {}) {
  const x = p => achados.find(a => String(a.lente) === 'X' && a.pergunta === p) || null;
  const aDisp = x('dispositivo'), aAntes = x('regra_antes'), aDepois = x('regra_depois');
  const ficha = { identificacao, dispositivo: aDisp ? aDisp.achado : null, regraVigente: null, regraProposta: null, dataEfeito: null, valores: [], quantitativa: false, faltas: [], completa: false,
    leiTentada: leiVigente.map(l => ({ norma: l.norma, compilado: !!l.compilado, desatualizado: !!l.desatualizado })) };

  // Regra vigente: lei lida > documento.
  const numArt = (s) => (/\bart\.?\s*(\d+)/i.exec(String(s || '')) || [])[1];
  // Artigos citados no dispositivo E na descrição da regra atual ("as alíneas d e e
  // do art. 240 da Lei 8.112"): qualquer um deles casa com o trecho da lei lida.
  const artsCitados = new Set([ficha.dispositivo, aDisp?.trecho, aAntes?.achado, aAntes?.trecho].filter(Boolean).flatMap(s => [...String(s).matchAll(/\barts?\.?\s*(\d+)/gi)].map(m => m[1])));
  const valoresAntes = aAntes ? valoresDoTexto(`${aAntes.achado} ${aAntes.trecho || ''}`).map(v => v.norm) : [];
  let trechoLei = null, leiOrigem = null;
  for (const l of leiVigente) {
    if (l.desatualizado) continue;                       // texto original de norma antiga não é regra vigente
    for (const t of l.trechos || []) {
      const casaArtigo = artsCitados.size && artsCitados.has(numArt(t.artigo));
      const casaValor = valoresAntes.length && valoresAntes.some(v => normalizarValor(t.texto).includes(v));
      if (casaArtigo || casaValor) { trechoLei = { norma: l.norma, artigo: t.artigo, texto: t.texto }; leiOrigem = l; break; }
    }
    if (trechoLei) break;
  }
  if (trechoLei) {
    const origem = leiOrigem.origem === 'camara' ? 'camara' : leiOrigem.compilado ? 'planalto' : 'senado';
    const rotuloFonte = { camara: 'texto atualizado, Portal da Legislação da Câmara', planalto: 'texto compilado, Planalto', senado: 'texto publicado, Senado via LexML' }[origem];
    ficha.regraVigente = { texto: trechoLei.texto.slice(0, 1400), origem, fonte: `${trechoLei.norma}, ${trechoLei.artigo} (${rotuloFonte})`, url: leiOrigem.url,
      // A lei diz o texto; o documento diz a situação ("não há marco legal…"). Os dois vão à ficha.
      noDocumento: aAntes ? aAntes.achado : null };
  } else if (aAntes) {
    ficha.regraVigente = { texto: aAntes.achado, trecho: aAntes.trecho || null, origem: 'documento', fonte: 'transcrição no documento analisado (trecho conferido)', url: null };
  } else if (fonte) {
    // O modelo não devolveu "regra_antes" (rodada 4 real, mesmo com a EMI
    // transcrevendo a tabela). Última rede: o programa procura no texto a
    // transcrição da regra atual por padrões fixos, e declara a origem.
    const r = regraVigenteNoTexto(fonte);
    if (r) ficha.regraVigente = { texto: r.texto, trecho: r.texto, origem: 'documento', fonte: 'transcrição no documento analisado, localizada por programa', url: null };
  }
  if (aDepois) ficha.regraProposta = { texto: aDepois.achado, trecho: aDepois.trecho || null, dispositivo: aDepois.dispositivo || null, fonte: 'texto analisado' };

  // Data de efeito. Norma em vigor (MP, lei): a data do marco. Projeto: a data
  // do fecho ("Brasília, 11 de agosto de 2026" no parecer) NÃO é vigência de
  // nada — vale a cláusula do texto, condicionada à aprovação.
  const sg = String(sigla || (String(identificacao).match(/^([A-Z]{2,4})\b/) || [])[1] || '').toUpperCase();
  const projeto = /^(PL|PLP|PEC|PDL|PDC|PRC|PLV|PLN|SUB|SBT)$/.test(sg);
  const marcoDeFecho = !!(marco && /entra em vigor na data de sua publica[çc][ãa]o —/i.test(marco.trecho || ''));
  const clausula = clausulaDeVigencia(fonte);
  const marcoVale = marco && marco.data && !(projeto && (marcoDeFecho || (clausula && marco.aproximado)));
  if (marcoVale) ficha.dataEfeito = { data: marco.data, trecho: marco.trecho, aproximado: !!marco.aproximado };
  else if (clausula) ficha.dataEfeito = { data: null, clausula: clausula.clausula, trecho: clausula.trecho, condicional: projeto };

  const base = [ficha.regraVigente?.texto, ficha.regraVigente?.trecho, ficha.regraProposta?.texto, ficha.regraProposta?.trecho].filter(Boolean).join(' ');
  ficha.valores = valoresDoTexto(base).slice(0, 12);
  // Regra quantitativa (alíquota, prazo, pena, valor): a síntese tem de enunciar os números.
  // Regra qualitativa (competência, direito, vedação, procedimento): não há número a exigir.
  ficha.quantitativa = ficha.valores.length > 0 || valoresDoTexto(`${aAntes?.achado || ''} ${aDepois?.achado || ''}`).length > 0;

  if (!ficha.regraVigente) ficha.faltas.push('regra vigente');
  if (!ficha.regraProposta) ficha.faltas.push('regra proposta');
  if (ficha.quantitativa && ficha.valores.length < 2) ficha.faltas.push('valores da regra');
  if (!ficha.dataEfeito) ficha.faltas.push('data de efeito');
  ficha.completa = ficha.faltas.length === 0;
  return ficha;
}

/**
 * "O que muda na legislação": um achado "altera" por dispositivo, casado com
 * o texto vigente lido (LEGIN/Planalto) pelo número do artigo e da norma.
 * O leitor vê, lado a lado, o que vale hoje e o que a proposição faz.
 */
function tabelaAlteracoes({ achados = [], leiVigente = [] } = {}) {
  const linhas = [];
  for (const a of achados.filter(x => String(x.lente) === 'X' && x.pergunta === 'altera' && !x.semQuestao)) {
    const disp = String(a.dispositivo || a.achado || '');
    const art = (/\barts?\.?\s*(\d+)/i.exec(disp) || [])[1] || null;
    const norma = (/(\d{1,3}\.\d{3}|\d{2,5})\s*(?:\/\s*\d{4}|,?\s*de\s+(?:\d{1,2}\s+de\s+[a-zçã]+\s+de\s+)?\d{4})/i.exec(disp) || [])[1];
    let vigente = null, fonte = null;
    for (const l of leiVigente) {
      if (l.desatualizado) continue;
      if (norma && !String(l.norma).replace(/\./g, '').includes(norma.replace(/\./g, ''))) continue;
      const t = (l.trechos || []).find(x => art && (/\d+/.exec(String(x.artigo)) || [])[0] === art);
      if (t) { vigente = String(t.texto).slice(0, 900); fonte = `${l.norma} (${l.origem === 'camara' ? 'texto atualizado, Câmara' : l.compilado ? 'texto compilado, Planalto' : 'texto publicado, Senado'})`; break; }
    }
    linhas.push({ dispositivo: disp, artigo: art, norma: norma || null, vigente, fonte, proposta: a.achado, trecho: a.trecho || null, novo: !art || /acrescent|inclu|cria|institui|novo/i.test(a.achado || '') });
  }
  return linhas;
}

function alteracoesParaHtml(linhas, esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))) {
  if (!linhas || !linhas.length) return '';
  return `<table class="ficha alteracoes"><thead><tr><th>Dispositivo</th><th>O que vale hoje</th><th>O que a proposição faz</th></tr></thead><tbody>${linhas.map(l => `<tr>
    <td>${esc(l.dispositivo)}</td>
    <td>${l.vigente ? esc(l.vigente) + `<div class="ficha-fonte">${esc(l.fonte)}</div>` : `<span class="ficha-falta">${l.novo ? 'não há dispositivo correspondente (texto novo)' : 'texto vigente não lido'}</span>`}</td>
    <td>${esc(l.proposta)}${l.trecho ? `<div class="ficha-fonte">Trecho: “${esc(String(l.trecho).slice(0, 220))}”</div>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

/** "A partir de", em palavras: data, ou cláusula condicionada à aprovação. */
function dataEfeitoTexto(f) {
  const d = f && f.dataEfeito;
  if (!d) return 'não identificada';
  if (d.data) return d.data.split('-').reverse().join('/') + (d.aproximado ? ' (aproximação: data da norma)' : '');
  return `${d.clausula}${d.condicional ? ' (se aprovado e sancionado)' : ''}`;
}

/**
 * G2 — a síntese enuncia o objeto? Regra numérica: conta os valores da ficha
 * presentes no texto. Regra sem números: a síntese tem de nomear a norma
 * alterada (o número da lei do dispositivo), quando houver uma.
 */
function objetoEnunciado(texto, ficha, minimo = 2) {
  const t = normalizarValor(texto);
  const presentes = [], faltantes = [];
  for (const v of ficha.valores || []) (t.includes(v.norm) ? presentes : faltantes).push(v.token);
  let exigidos = Math.min(minimo, (ficha.valores || []).length);
  if (!(ficha.valores || []).length) {
    const lei = /\b(\d{1,3}\.\d{3}|\d{2,5})(?=\s*\/\s*\d{4}|,?\s*de\s+(?:\d{1,2}\s+de\s+[a-zçã]+\s+de\s+)?\d{4})/i.exec(String(ficha.dispositivo || ''));
    if (lei) { exigidos = 1; (t.includes(normalizarValor(lei[1])) ? presentes : faltantes).push(lei[1]); }
  }
  return { presentes, faltantes, exigidos, ok: presentes.length >= exigidos };
}

function fichaParaTexto(f) {
  const d = dataEfeitoTexto(f);
  return [
    `FICHA DO OBJETO — ${f.identificacao}`,
    `Dispositivo: ${f.dispositivo || 'não identificado'}`,
    `Regra vigente (${f.regraVigente ? f.regraVigente.fonte : 'NÃO OBTIDA'}): ${f.regraVigente ? f.regraVigente.texto : '—'}${f.regraVigente?.noDocumento ? `\n  Como o documento analisado descreve a situação atual: ${f.regraVigente.noDocumento}` : ''}`,
    `Regra proposta (${f.regraProposta ? f.regraProposta.fonte : 'NÃO IDENTIFICADA'}): ${f.regraProposta ? f.regraProposta.texto : '—'}`,
    `Data de efeito: ${d}`,
    f.quantitativa ? `Valores da regra (a síntese TEM de enunciar ao menos dois, em algarismos): ${f.valores.map(v => v.token).join('; ') || 'nenhum'}`
      : 'Regra sem valores numéricos (matéria qualitativa): a síntese enuncia a regra vigente e a proposta em palavras e nomeia a norma alterada.',
    f.faltas.length ? `FALTAS: ${f.faltas.join(', ')}` : 'Ficha completa.',
  ].join('\n');
}

function fichaParaHtml(f, esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))) {
  const d = dataEfeitoTexto(f);
  const linha = (rot, val, fonte) => `<tr><th>${esc(rot)}</th><td>${val}${fonte ? `<div class="ficha-fonte">${esc(fonte)}</div>` : ''}</td></tr>`;
  return `<table class="ficha">
    ${linha('Dispositivo', esc(f.dispositivo || 'não identificado'))}
    ${linha('Regra vigente', f.regraVigente ? esc(f.regraVigente.texto) + (f.regraVigente.noDocumento ? `<div class="ficha-doc"><b>Como o documento analisado descreve a situação atual:</b> ${esc(f.regraVigente.noDocumento)}</div>` : '') : '<b class="ficha-falta">não obtida</b>', f.regraVigente ? f.regraVigente.fonte : null)}
    ${linha('Regra proposta', f.regraProposta ? esc(f.regraProposta.texto) : '<b class="ficha-falta">não identificada</b>', f.regraProposta ? f.regraProposta.fonte : null)}
    ${linha('A partir de', esc(d), f.dataEfeito ? f.dataEfeito.trecho : null)}
  </table>`;
}

const CSS_FICHA = `
    .ficha { border-collapse:collapse; width:100%; margin:8px 0 10px; font-size:9.5pt; }
    .ficha th { width:22%; text-align:left; vertical-align:top; background:#eef2f5; border:1px solid #bfc7cf; padding:4px 6px; }
    .ficha td { border:1px solid #bfc7cf; padding:4px 6px; vertical-align:top; }
    .ficha-fonte { font-size:8.3pt; color:#666; margin-top:2px; }
    .ficha-doc { font-size:9pt; color:#333; margin-top:4px; padding-top:3px; border-top:1px dotted #bfc7cf; }
    .alteracoes th { width:auto; background:#eef2f5; } .alteracoes td:first-child { width:20%; font-weight:600; } .alteracoes td { font-size:9pt; }
    .ficha-falta { color:#b03030; }`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RE_VALOR_FICHA, normalizarValor, valoresDoTexto, montarFicha, regraVigenteNoTexto, recortarRegra, clausulaDeVigencia, dataEfeitoTexto, objetoEnunciado, fichaParaTexto, fichaParaHtml, tabelaAlteracoes, alteracoesParaHtml, CSS_FICHA };
}
