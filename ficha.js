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

function montarFicha({ achados = [], leiVigente = [], marco = null, identificacao = '', fonte = '' } = {}) {
  const x = p => achados.find(a => String(a.lente) === 'X' && a.pergunta === p) || null;
  const aDisp = x('dispositivo'), aAntes = x('regra_antes'), aDepois = x('regra_depois');
  const ficha = { identificacao, dispositivo: aDisp ? aDisp.achado : null, regraVigente: null, regraProposta: null, dataEfeito: null, valores: [], faltas: [], completa: false };

  // Regra vigente: lei lida > documento.
  const numArt = (s) => (/\bart\.?\s*(\d+)/i.exec(String(s || '')) || [])[1];
  const artDisp = numArt(ficha.dispositivo);
  const valoresAntes = aAntes ? valoresDoTexto(`${aAntes.achado} ${aAntes.trecho || ''}`).map(v => v.norm) : [];
  let trechoLei = null, leiOrigem = null;
  for (const l of leiVigente) {
    if (l.desatualizado) continue;                       // texto original de norma antiga não é regra vigente
    for (const t of l.trechos || []) {
      const casaArtigo = artDisp && numArt(t.artigo) === artDisp;
      const casaValor = valoresAntes.length && valoresAntes.some(v => normalizarValor(t.texto).includes(v));
      if (casaArtigo || casaValor) { trechoLei = { norma: l.norma, artigo: t.artigo, texto: t.texto }; leiOrigem = l; break; }
    }
    if (trechoLei) break;
  }
  if (trechoLei) {
    ficha.regraVigente = { texto: trechoLei.texto.slice(0, 1400), origem: leiOrigem.compilado ? 'planalto' : 'senado', fonte: `${trechoLei.norma}, ${trechoLei.artigo} (${leiOrigem.compilado ? 'texto compilado, Planalto' : 'texto publicado, Senado via LexML'})`, url: leiOrigem.url };
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
  if (marco && marco.data) ficha.dataEfeito = { data: marco.data, trecho: marco.trecho, aproximado: !!marco.aproximado };

  const base = [ficha.regraVigente?.texto, ficha.regraVigente?.trecho, ficha.regraProposta?.texto, ficha.regraProposta?.trecho].filter(Boolean).join(' ');
  ficha.valores = valoresDoTexto(base).slice(0, 12);

  if (!ficha.regraVigente) ficha.faltas.push('regra vigente');
  if (!ficha.regraProposta) ficha.faltas.push('regra proposta');
  if (ficha.valores.length < 2) ficha.faltas.push('valores da regra');
  if (!ficha.dataEfeito) ficha.faltas.push('data de efeito');
  ficha.completa = ficha.faltas.length === 0;
  return ficha;
}

/** G2 — a síntese enuncia o objeto? Conta os valores da ficha presentes no texto. */
function objetoEnunciado(texto, ficha, minimo = 2) {
  const t = normalizarValor(texto);
  const presentes = [], faltantes = [];
  for (const v of ficha.valores || []) (t.includes(v.norm) ? presentes : faltantes).push(v.token);
  const exigidos = Math.min(minimo, (ficha.valores || []).length);
  return { presentes, faltantes, exigidos, ok: presentes.length >= exigidos };
}

function fichaParaTexto(f) {
  const d = f.dataEfeito ? f.dataEfeito.data.split('-').reverse().join('/') + (f.dataEfeito.aproximado ? ' (aproximação: data da norma)' : '') : 'não identificada';
  return [
    `FICHA DO OBJETO — ${f.identificacao}`,
    `Dispositivo: ${f.dispositivo || 'não identificado'}`,
    `Regra vigente (${f.regraVigente ? f.regraVigente.fonte : 'NÃO OBTIDA'}): ${f.regraVigente ? f.regraVigente.texto : '—'}`,
    `Regra proposta (${f.regraProposta ? f.regraProposta.fonte : 'NÃO IDENTIFICADA'}): ${f.regraProposta ? f.regraProposta.texto : '—'}`,
    `Data de efeito: ${d}`,
    `Valores da regra (a síntese TEM de enunciar ao menos dois, em algarismos): ${f.valores.map(v => v.token).join('; ') || 'nenhum'}`,
    f.faltas.length ? `FALTAS: ${f.faltas.join(', ')}` : 'Ficha completa.',
  ].join('\n');
}

function fichaParaHtml(f, esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))) {
  const d = f.dataEfeito ? f.dataEfeito.data.split('-').reverse().join('/') + (f.dataEfeito.aproximado ? ' (aproximação: data da norma)' : '') : 'não identificada';
  const linha = (rot, val, fonte) => `<tr><th>${esc(rot)}</th><td>${val}${fonte ? `<div class="ficha-fonte">${esc(fonte)}</div>` : ''}</td></tr>`;
  return `<table class="ficha">
    ${linha('Dispositivo', esc(f.dispositivo || 'não identificado'))}
    ${linha('Regra vigente', f.regraVigente ? esc(f.regraVigente.texto) : '<b class="ficha-falta">não obtida</b>', f.regraVigente ? f.regraVigente.fonte : null)}
    ${linha('Regra proposta', f.regraProposta ? esc(f.regraProposta.texto) : '<b class="ficha-falta">não identificada</b>', f.regraProposta ? f.regraProposta.fonte : null)}
    ${linha('A partir de', esc(d), f.dataEfeito ? f.dataEfeito.trecho : null)}
  </table>`;
}

const CSS_FICHA = `
    .ficha { border-collapse:collapse; width:100%; margin:8px 0 10px; font-size:9.5pt; }
    .ficha th { width:22%; text-align:left; vertical-align:top; background:#eef2f5; border:1px solid #bfc7cf; padding:4px 6px; }
    .ficha td { border:1px solid #bfc7cf; padding:4px 6px; vertical-align:top; }
    .ficha-fonte { font-size:8.3pt; color:#666; margin-top:2px; }
    .ficha-falta { color:#b03030; }`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RE_VALOR_FICHA, normalizarValor, valoresDoTexto, montarFicha, regraVigenteNoTexto, recortarRegra, objetoEnunciado, fichaParaTexto, fichaParaHtml, CSS_FICHA };
}
