'use strict';
// Orçamento · Comparador de Portarias — a SEQUÊNCIA, sem IA.
//
// Medido nos atos reais da equipe (convênios e contratos de repasse,
// 2011–2026, impressos do Transferegov/gov.br):
//  - o PDF traz a moldura da página: 311 linhas "Ir para o conteúdo…", 208
//    "Transferegov.br", setas de menu, "Publicado em…/Modificado há…" — e a
//    ligadura "fi" vem partida ("simpli fi cado", "o fi cial"). ptLimpar tira;
//  - os atos se relacionam: um REVOGA o anterior (507/2011 → 424/2016 →
//    33/2023), outros ALTERAM (29/2024 e 45/2026 alteram a 33/2023). ptRelacoes
//    lê isso do texto; a sequência avisa quando um ato alterado NÃO foi
//    incluído (ex.: a Portaria Conjunta MPO/MGI/SRI-PR nº 3/2026 altera a nº 2/2026);
//  - as versões são CONSOLIDADAS: cada dispositivo mudado traz "(Redação dada
//    pela…)", "(Incluído pela…)", "(Revogado pela…)". ptMarcadores conta isso
//    por ato — quem mudou o quê, e quando — sem depender de IA.

const PT_RE_REF = /(Portaria(?:\s+(?:Interministerial|Conjunta|Normativa))?|Instru[çc][ãa]o\s+Normativa(?:\s+(?:Interministerial|Conjunta))?|Decreto)\s*(?:[A-Z][A-Za-z]*(?:\s*[\/-]\s*[A-Z][A-Za-z]*)*\s*)?n[ºo°]\.?\s*([\d.]+)(?:\s*\/\s*[A-Z][A-Z\/-]*)?\s*,?\s*de\s+(?:\d{1,2}\s*º?\s*de\s+[A-Za-zçÇãÃ]+\s+de\s+)?(\d{4})/gi;

/** Limpa o texto extraído: moldura do site, ligaduras partidas, espaços. Devolve { texto, removidas, ligaduras }. Pura. */
function ptLimpar(texto) {
  let removidas = 0, ligaduras = 0;
  // Migalha de navegação: "Transferegov.br" sozinho e a linha "〉 〉 PORTARIA…"
  // (o título repetido). Os ícones do site vêm como glifos da área de uso
  // privado (U+E000–F8FF) e setas "〉" de vários códigos — tirados antes.
  const seta = '[\u232a\u3009\u27e9\u203a\u00bb\u2304\u2335>]';
  const lixo = [/^Ir para o conte[úu]do\b.*$/i, /^Transferegov\.br\W{0,8}$/i, new RegExp('^' + seta + '[\\s' + seta.slice(1, -1) + ']*(?:$|PORTARIA|INSTRU|DECRETO|Portaria)', 'i'), /^Compartilhe\s*:?\s*$/i, /^Rede\s?fi\s?nir\s+Cookies\b/i, /^[^\p{L}\p{N}]{1,6}$/u];
  // Menu do gov.br impresso no alto da página — só nas primeiras linhas, onde
  // não há texto do ato (no corpo, "Legislação" sozinha numa linha seria do ato).
  const menu = /^(?:Institucional|Legisla[çc][ãa]o|Acessibilidade|Participe|Acesso [àa] Informa[çc][ãa]o|Atalhos gov\.br\b.*|.*[ÓO]rg[ãa]os do Governo|Gest[ãa]o e da… Acesso [àa] Informa[çc][ãa]o|Entrar com gov\.br)$/i;
  const linhas = String(texto || '').replace(/[\ue000-\uf8ff]/g, '').split('\n').filter((l, i) => {
    const t = l.replace(/[\u200b-\u200d\ufeff]/g, '').trim();
    if (t && (lixo.some(r => r.test(t)) || (i < 40 && menu.test(t)))) { removidas++; return false; }
    return true;
  });
  let t = linhas.join('\n')
    .replace(/Publicado em \d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2})?/g, '')
    .replace(/Modi\s?fi\s?cado (?:em \d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2})?|h[áa] [^\n]*?(?:anos?|m[eê]s(?:es)?|dias?|horas?|minutos?))/g, '')
    .replace(/Compartilhe\s*:/g, '');
  // Ligadura partida: o PDF solta "fi"/"fl" como palavra ("simpli fi cado",
  // "recursos fi nanceiros"). "fi"+resto sempre se junta; o pedaço de ANTES
  // só se junta quando não é palavra (não aparece sozinho em outro ponto do
  // texto: "simpli", "especí") ou, sendo palavra curta ("o fi cial", "de fi nição"),
  // quando o resto não começa palavra comum (fim, fins, financeiro, fiscal…).
  const RE_LIG = /(\p{L}+)?([ \n]+)(fi|fl) (\p{Ll}+)/gu;
  const antes = new Map(), total = new Map();
  for (const m of t.matchAll(RE_LIG)) if (m[1]) { const w = m[1].toLowerCase(); antes.set(w, (antes.get(w) || 0) + 1); }
  for (const m of t.matchAll(/\p{L}+/gu)) { const w = m[0].toLowerCase(); total.set(w, (total.get(w) || 0) + 1); }
  const ehPalavra = w => (total.get(w) || 0) > (antes.get(w) || 0);
  const INICIO = /^(?:nan[cç]|nal|nais|naliz|nalid|nd|sca[il]|ns?$|m$|rm|x|el$|éis$|qu|c(?:a|am|ar|ará|aria|ou|ando|asse|ou)$|gur|lantr|li[aá]|lh|ança|ador|ltr|cha|las?$|ux|ex|or|agr)/;
  const FORTE = /^(?:nan[cç]|nal|nais|sca[il]|lantr|ança|ns$|m$)/;
  t = t.replace(RE_LIG, (m, a, sep, l, b) => {
    ligaduras++;
    if (!a) return sep + l + b;
    // "aplicações fi nanceiras": a palavra de antes pode só aparecer ali — mas
    // "nanc", "scal", "nal" nunca continuam um pedaço de palavra.
    const junta = ehPalavra(a.toLowerCase()) ? a.length <= 3 && !INICIO.test(b)
      : !FORTE.test(b) && !(a.length >= 7 && INICIO.test(b));
    return junta ? a + l + b : a + sep + l + b;
  });
  t = t.replace(/(\p{Lu}\p{L}+) fi ?(?=[,.;)])/gu, (m, a) => { ligaduras++; return a + 'fi'; }); // "Sicon fi ,"
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { texto: t, removidas, ligaduras };
}

/** Chave de um ato: "33/2023" (número sem ponto / ano). */
function ptChaveAto(numero, ano) {
  const n = String(numero || '').replace(/\./g, '').replace(/^0+/, '');
  return n && ano ? `${n}/${ano}` : '';
}

/** Atos citados num trecho: [{ chave, rotulo }], sem repetir. Pura. */
function ptRefs(trecho) {
  const out = [], vistos = new Set();
  const re = new RegExp(PT_RE_REF.source, 'gi');
  let m;
  while ((m = re.exec(String(trecho || '').replace(/\s+/g, ' ')))) {
    const chave = ptChaveAto(m[2], m[3]);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ chave, rotulo: m[0].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/**
 * Relações do ato com outros. Pura.
 *  - altera: atos que este ALTERA (pela ementa, "Altera a Portaria…") ou de que
 *    revoga só dispositivos ("Ficam revogados os seguintes dispositivos da…");
 *  - revoga: atos que este revoga por inteiro ("Fica revogada a Portaria…");
 *  - revogadoPor: quando a versão traz "(Revogada pela Portaria…)" no alto.
 * `propria`: chave do próprio ato, para não se citar.
 */
function ptRelacoes(texto, propria) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const sem = r => r.filter(x => x.chave !== propria);
  const inicio = t.slice(0, 3000);
  const altera = [], revoga = [];
  const em = inicio.match(/\bAltera(?:m)?\s+(?:a|o|as|os)\s+(.{0,600}?)(?:\.\s|$)/);
  // Só os atos ALTERADOS: o que vem depois de ", que …" descreve o ato
  // alterado ("…que estabelece normas complementares ao Decreto nº 11.531") e não é alterado.
  if (em) altera.push(...sem(ptRefs(em[1].split(/,\s*que\s/i)[0])).slice(0, 4));
  const re = /\bFica(?:m)?\s+revogad[ao]s?\s*:?\s*(.{0,700})/gi;
  let m;
  while ((m = re.exec(t))) {
    const trecho = m[1];
    const parcial = /^(?:os\s+seguintes\s+dispositivos|o\s+art|os\s+arts|o\s+inciso|os\s+incisos|o\s+§|os\s+§|a\s+al[íi]nea|o\s+par[áa]grafo|o\s+cap[íi]tulo)/i.test(trecho);
    // O trecho para no próximo artigo, na marca de consolidação ("(Alterado pela
    // Portaria nº 101, de 2017)" colada ao artigo NÃO é ato revogado) e no fim
    // da frase antes da assinatura (nome em maiúsculas) — depois vem o anexo.
    const refs = sem(ptRefs(trecho.split(/\bArt\.\s*\d/)[0].split(/\(\s*(?:Reda|Inclu|Revog|Alter|Acresc)/i)[0]
      .split(/\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}\b)/)[0]));
    (parcial ? altera : revoga).push(...refs);
  }
  const rp = inicio.match(/\(\s*Revogad[ao]\s+pel[ao]\s+(.{0,200}?)\)/i);
  const unicos = l => l.filter((x, i) => l.findIndex(y => y.chave === x.chave) === i);
  return { altera: unicos(altera), revoga: unicos(revoga).filter(x => !altera.some(a => a.chave === x.chave)), revogadoPor: rp ? sem(ptRefs(rp[1]))[0] || null : null };
}

/**
 * Marcadores de consolidação: quantos dispositivos cada ato deu nova redação,
 * incluiu ou revogou no texto consolidado. Pura.
 * Devolve [{ chave, rotulo, redacao, inclusao, revogacao, total }], do ato com mais marcas ao com menos.
 */
function ptMarcadores(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const re = /\(\s*(Reda[çc][ãa]o\s+dada|Inclu[íi]d[oa]|Acrescid[oa]|Revogad[oa]|Alterad[oa])\s+pel[ao]\s+([^()]{5,200}?)\)/gi;
  const por = new Map();
  let m;
  while ((m = re.exec(t))) {
    const ref = ptRefs(m[2])[0];
    if (!ref) continue;
    const tipo = /^inclu|^acresc/i.test(m[1]) ? 'inclusao' : /^revog/i.test(m[1]) ? 'revogacao' : 'redacao';
    const x = por.get(ref.chave) || { chave: ref.chave, rotulo: ref.rotulo, redacao: 0, inclusao: 0, revogacao: 0, total: 0 };
    x[tipo]++; x.total++;
    por.set(ref.chave, x);
  }
  return [...por.values()].sort((a, b) => b.total - a.total);
}

/**
 * A sequência como um todo. Pura. docs: [{ id, numero, data, texto, ... }].
 * Para cada ato: relações (com a marca "na sequência" ou não) e marcadores.
 * E a lista de atos citados como ALTERADOS que não foram incluídos — sem eles,
 * "como era" não tem com o que comparar.
 */
function ptSequencia(docs) {
  const chave = d => ptChaveAto(d.numero, d.data ? d.data.slice(0, 4) : '');
  const presentes = new Set((docs || []).map(chave).filter(Boolean));
  const atos = (docs || []).map(d => {
    const r = ptRelacoes(d.texto, chave(d));
    const marca = l => l.map(x => Object.assign({}, x, { presente: presentes.has(x.chave) }));
    return { id: d.id, chave: chave(d), altera: marca(r.altera), revoga: marca(r.revoga),
      revogadoPor: r.revogadoPor ? Object.assign({}, r.revogadoPor, { presente: presentes.has(r.revogadoPor.chave) }) : null,
      marcadores: ptMarcadores(d.texto).map(x => Object.assign(x, { presente: presentes.has(x.chave) })) };
  });
  const faltando = [];
  for (const a of atos) for (const x of a.altera) {
    if (!x.presente && !faltando.some(f => f.chave === x.chave)) faltando.push({ chave: x.chave, rotulo: x.rotulo, citadoPor: a.chave });
  }
  return { atos, faltando };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ptLimpar, ptChaveAto, ptRefs, ptRelacoes, ptMarcadores, ptSequencia };
}
