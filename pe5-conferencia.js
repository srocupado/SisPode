// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Parecer de Especialista (refeito em 17/11/2026) — A CONFERÊNCIA DO PROGRAMA.
//
// A conferência anterior media forma: seção presente, parágrafo com identificador, número "na base". Deu
// "aprovado, zero pontos" nos três pareceres medidos, inclusive no que tinha a tabela de legislação errada
// em 8 de 12 linhas, 76% das menções numéricas repetidas e uma seção de nove palavras. Estes testes olham
// o que se viu falhar:
//
//   citações      cada trecho que a leitura transcreve existe no documento que ela indica
//   evidências    cada bloco do parecer aponta para algo que existe na base
//   números       valor, percentual, prazo e data do texto existem na base, ou são soma/produto/conversão dela
//   dispositivos  cada "art. N" citado existe no texto analisado, na lei vigente ou na pesquisa
//   repetição     a mesma frase ou o mesmo número espalhado por várias seções
//   fontes        posição sem data ou sem fonte; pesquisa coletada e não usada; peso das fontes de imprensa
//   linguagem     jargão interno, juridiquês, recomendação de voto, "não consta" sem dizer onde se procurou
//   fase          opções incompatíveis com a fase (matéria já votada na Câmara tratada como pendente)
//   legislação    "o que vale hoje" começa pelo artigo certo e não se repete entre linhas
//   atualidade    situação registrada há muito tempo; fórmula de sanção para espécie que não vai a sanção
//
// Nada aqui reprova o parecer: cada teste vira uma linha do relatório de conferência, que sai em documento separado.
// Script clássico (global na extensão) + module.exports para os testes.

'use strict';

const pe5Norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const pe5Palavras = s => (String(s || '').toLowerCase().match(/[\p{L}\d]+/gu) || []);

// ---- números por extenso → algarismos ("duzentos e dez dias" → "210 dias") ----
const PE5_NUM = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 };
const pe5SemAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function pe5ExtensoParaDigitos(texto) {
  const partes = String(texto || '').split(/(\s+|[^\p{L}\d\s]+)/u);   // palavras, espaços e pontuação, na ordem
  const ehNum = w => Object.prototype.hasOwnProperty.call(PE5_NUM, pe5SemAcento(w).toLowerCase());
  const out = [];
  for (let i = 0; i < partes.length; i++) {
    if (!ehNum(partes[i])) { out.push(partes[i]); continue; }
    // "um", "uma" sozinhos são artigo com muito mais frequência que número
    let soma = PE5_NUM[pe5SemAcento(partes[i]).toLowerCase()], j = i, n = 1;
    while (j + 4 < partes.length + 4 && /^\s+$/.test(partes[j + 1] || '') && /^e$/i.test(partes[j + 2] || '') && /^\s+$/.test(partes[j + 3] || '') && ehNum(partes[j + 4] || '')) {
      soma += PE5_NUM[pe5SemAcento(partes[j + 4]).toLowerCase()]; j += 4; n++;
    }
    if (n === 1 && /^(um|uma)$/i.test(partes[i])) { out.push(partes[i]); continue; }
    out.push(String(soma)); i = j;
  }
  return out.join('');
}

// ---- extração de números com unidade ----
const PE5_MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const PE5_MULT = { mil: 1e3, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9, trilhao: 1e12, trilhoes: 1e12 };
const pe5NumBR = s => { const t = String(s).trim(); if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.')); return Number(t.replace(',', '.')); };
/** [{ tipo: 'moeda'|'pct'|'prazo'|'qtd'|'data', moeda?, valor, unidade?, literal }] */
function pe5Numeros(texto) {
  const t = pe5ExtensoParaDigitos(String(texto || '')).replace(/ /g, ' ');
  const out = [];
  const reMoeda = /(?<![A-Za-z0-9])(R\$|EUR|GBP|USD|US\$|JPY|€|£)\s?([\d.]+(?:,\d+)?)(?:\s*\([^)]{0,40}\))?\s*(mil(?![a-zà-ú])|milh[ãa]o|milh[õo]es|bilh[ãa]o|bilh[õo]es|trilh[ãa]o|trilh[õo]es)?/gi;
  let m;
  while ((m = reMoeda.exec(t)) !== null) {
    const moeda = { 'r$': 'BRL', 'eur': 'EUR', '€': 'EUR', 'gbp': 'GBP', '£': 'GBP', 'usd': 'USD', 'us$': 'USD', 'jpy': 'JPY' }[m[1].toLowerCase()];
    const mult = m[3] ? PE5_MULT[pe5SemAcento(m[3]).toLowerCase()] || 1 : 1;
    const v = pe5NumBR(m[2]) * mult; if (isFinite(v) && v > 0) out.push({ tipo: 'moeda', moeda, valor: v, literal: m[0].trim() });
  }
  const semMoeda = t.replace(reMoeda, ' ');
  const rePct = /(\d+(?:[.,]\d+)?)\s?%/g;
  while ((m = rePct.exec(semMoeda)) !== null) out.push({ tipo: 'pct', valor: pe5NumBR(m[1]), literal: m[0] });
  const rePrazo = /\b(\d+(?:[.,]\d+)?)\s+(dias?|anos?|meses|m[êe]s|horas?|vezes)\b/gi;
  while ((m = rePrazo.exec(semMoeda)) !== null) out.push({ tipo: 'prazo', valor: pe5NumBR(m[1]), unidade: pe5SemAcento(m[2]).toLowerCase().replace(/s$/, '').replace(/^mese$/, 'mes'), literal: m[0] });
  const reQtd = /\b(\d+(?:[.,]\d+)?)\s+(mil(?![a-zà-ú])|milh[ãa]o|milh[õo]es|bilh[ãa]o|bilh[õo]es)?\s*(?:de\s+)?(usu[áa]rios|grupos|contribui[çc][õo]es|participantes|deputados|pa[íi]ses|empregos|entidades|associadas|organiza[çc][õo]es)\b/gi;
  while ((m = reQtd.exec(semMoeda)) !== null) out.push({ tipo: 'qtd', valor: pe5NumBR(m[1]) * (m[2] ? PE5_MULT[pe5SemAcento(m[2]).toLowerCase()] || 1 : 1), unidade: pe5SemAcento(m[3]).toLowerCase().slice(0, 5), literal: m[0] });
  const reData = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = reData.exec(t)) !== null) out.push({ tipo: 'data', valor: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]), literal: m[0] });
  const reDataExt = /\b(\d{1,2})\s*[ºo°]?\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/gi;
  while ((m = reDataExt.exec(t)) !== null) out.push({ tipo: 'data', valor: Number(m[3]) * 10000 + (PE5_MESES.indexOf(pe5SemAcento(m[2]).toLowerCase()) + 1) * 100 + Number(m[1]), literal: m[0] });
  return out;
}

/** Todos os textos de um objeto, concatenados (para montar a base). */
function pe5Textos(o, acc = []) {
  if (o == null) return acc;
  if (typeof o === 'string') { acc.push(o); return acc; }
  if (typeof o === 'number') { acc.push(String(o)); return acc; }
  if (Array.isArray(o)) { for (const x of o) pe5Textos(x, acc); return acc; }
  if (typeof o === 'object') for (const v of Object.values(o)) pe5Textos(v, acc);
  return acc;
}

/** Blocos do documento, com seção, texto e evidências: é sobre eles que os testes correm. */
function pe5Blocos(doc = {}) {
  const B = [];
  const add = (secao, o, campos, exigeEv = true) => { if (!o) return; const texto = campos.map(c => o[c]).filter(x => typeof x === 'string' && x.trim()).join(' '); if (texto.trim()) B.push({ secao, texto, ev: Array.isArray(o.ev) ? o.ev : [], exigeEv }); };
  const A = doc.abertura || {};
  add('abertura', { texto: [A.frase, A.decide, A.alcance, ...(A.muda || []), ...(A.falta || []), ...((A.pontos || []).map(p => `${p.titulo}. ${p.texto}`))].filter(Boolean).join(' ') }, ['texto'], false);
  for (const x of A.alcancados || []) add('abertura', x, ['grupo', 'piso', 'dado']);
  for (const x of doc.materia?.faz || []) add('faz', x, ['texto', 'dispositivos']);
  for (const x of doc.materia?.documentos || []) add('documentos', x, ['documento', 'o_que_e']);
  for (const x of doc.materia?.origem || []) add('origem', x, ['texto']);
  for (const x of doc.materia?.versoes || []) add('versoes', x, ['original', 'atual', 'efeito']);
  for (const x of doc.materia?.contexto || []) add('contexto', x, ['texto']);
  for (const x of doc.materia?.historico || []) add('historico', x, ['proposicao', 'o_que_propunha', 'desfecho', 'por_que']);
  for (const c of doc.debate?.controversias || []) {
    add('debate', { texto: [c.questao, c.dispositivos, c.estado, ...(c.favor || []).flatMap(a => [a.argumento, a.evidencia]), ...(c.contra || []).flatMap(a => [a.argumento, a.evidencia])].filter(Boolean).join(' '), ev: c.ev }, ['texto']);
  }
  // "Quem se posicionou" e "Os dois lados" retomam, de propósito, os argumentos das controvérsias: mesma seção para o teste de repetição.
  for (const x of doc.debate?.posicoes || []) add('debate', x, ['texto']);
  if (doc.debate?.sintese) add('debate', doc.debate.sintese, ['texto']);
  for (const k of ['apoia', 'opoe']) add('debate', doc.debate?.lados?.[k], ['argumento', 'evidencia']);
  for (const x of doc.debate?.da_analise || []) add('debate-analise', x, ['argumento']);
  for (const x of doc.internacional?.jurisdicoes || []) add('internacional', x, ['regra', 'aconteceu', 'criticas']);
  if (doc.internacional?.comparativo) add('comparativo', { texto: (doc.internacional.comparativo.linhas || []).flatMap(l => l.valores || []).join(' ') }, ['texto'], false);
  for (const x of doc.internacional?.licoes || []) add('licoes', x, ['texto']);
  for (const x of doc.internacional?.limites || []) add('licoes', { texto: x }, ['texto'], false);
  for (const l of doc.analise?.lentes || []) for (const x of l.pontos || []) add('analise', x, ['questao', 'dispositivo', 'exame', 'objecao', 'saida']);
  for (const x of doc.analise?.jurisprudencia || []) add('jurisprudencia', x, ['processo', 'decidiu', 'pertinencia', 'limite']);
  for (const x of doc.analise?.judicializacao || []) add('judicializacao', x, ['alvo', 'quem', 'fundamento', 'sinal', 'reduz']);
  for (const k of ['fiscal', 'economico', 'implementacao']) for (const x of doc.analise?.impacto?.[k] || []) add('impacto', x, ['texto']);
  for (const x of doc.caminhos?.opcoes || []) add('opcoes', x, ['opcao', 'consequencias']);
  for (const x of doc.caminhos?.emendas || []) add('emendas', x, ['dispositivo', 'problema', 'redacao']);
  for (const x of doc.caminhos?.perguntas || []) add('perguntas', { texto: `${x.pergunta} ${x.por_que}` }, ['texto'], false);
  for (const x of doc.caminhos?.acompanhar || []) add('acompanhar', { texto: x }, ['texto'], false);
  for (const x of doc.caminhos?.partido?.texto || []) add('partido', x, ['texto']);
  return B;
}

// ---- vocabulário ----
const PE5_RE_JARGAO = /\bCen[áa]rio \d|\bn[íi]vel [ABC]\b|\bgates?\b|\brubrica\b|\blente \d|\bachado [A-Z]\d|\bevid[êe]ncia [A-Z]\d|\[(?:[A-Z]\d+)\]|a compara[çc][ãa]o [ée] imposs[íi]vel com o que existe/i;
const PE5_RE_JURIDIQUES = /\b(destarte|outrossim|novel\b|hodiern|mister se faz|faz-se mister|no bojo d|ex vi\b|in casu\b|data v[êe]nia|colend[oa]|egr[ée]gi[oa]|resta consubstanciad|consubstanci|pecha\b|h[íi]gid|higidez|ostenta\b|plen[áa]rio soberano|soberano plen[áa]rio|desiderato|[àa] guisa de|no que tange|no tocante a|em apre[çc]o|ensej(?:a|ando) a|supracitad|retromencionad|deveras|conspícu|extravagante)\b/i;
const PE5_RE_VOTO = /\b(recomenda-se|recomendamos|sugere-se|sugerimos|orienta-se|orientamos)\s+(?:o voto|votar|a aprova[çc][ãa]o|a rejei[çc][ãa]o|aprovar|rejeitar)|\b(?:deve|devem|deveria)\s+ser\s+(?:aprovad|rejeitad)[oa]s?\b|\bvoto (?:favor[áa]vel|contr[áa]rio) (?:[ée]|seria) (?:o|a) (?:mais )?(?:adequad|recomend)/i;
const PE5_RE_AUSENCIA = /\bn[ãa]o (?:h[áa]|existe|existem|consta|constam|foi apresentad[oa]|foram apresentad[oa]s|veio acompanhad[oa]|traz|trazem)\b/i;
const PE5_RE_ESCOPO = /documentos?\b|\bo texto\b|nas fontes|no arquivo|localizad|no texto|na fonte|nos autos|exposi[çc][ãa]o de motivos|substitutivo|registr|regra|lei atual|pesquis|public/i;
const PE5_PRIMARIA = /\.(jus|leg|gov|mp|def)\.br|europa\.eu|\.gov\.uk|\.go\.jp|\.gov\b|bundeskartellamt\.de|bundestag\.de|oecd\.org|un\.org|wto\.org|planalto|stf\.|stj\.|tcu\.|camara\.leg|senado\.leg/i;

/**
 * Corre os testes. `p` é o parecer montado (pe5-pipeline.js): doc, leitura, pesquisa, coleta, alteracoes,
 * cambio, base (textos dos documentos e da lei), trechos (resultado da conferência de citações).
 */
/** Itens da leitura que a nota não pode deixar de fora: [{ id, rotulo }]. */
function pe5CoberturaLeitura(L) {
  const curto = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  return [
    ...((L && L.achados) || []).filter(x => x && x.id && /alta|m[ée]dia/i.test(x.gravidade || '')).map(x => ({ id: x.id, rotulo: curto(x.questao) })),
    ...((L && L.estimativas) || []).filter(x => x && x.id).map(x => ({ id: x.id, rotulo: curto(`${x.o_que}: ${x.valor}`) })),
    ...((L && L.versoes) || []).filter(x => x && x.id).map(x => ({ id: x.id, rotulo: curto(x.tema) })),
    ...((L && L.justificativa) || []).filter(x => x && x.id).map(x => ({ id: x.id, rotulo: curto(x.objetivo) })),
  ];
}

function pe5Conferir(p, { hoje = new Date() } = {}) {
  const itens = [];
  const add = (teste, ok, detalhe = '', critico = false) => itens.push({ teste, ok: !!ok, detalhe: ok ? (detalhe || '') : detalhe, critico: !ok && critico });
  const doc = p.doc || {}, L = p.leitura || {}, pq = p.pesquisa || {}, G = p.coleta || {};
  const blocos = pe5Blocos(doc);
  const corpo = blocos.filter(b => b.secao !== 'abertura');

  // --- citações ---
  const tr = p.trechos || { conferidos: 0, recusados: [] };
  add('Citações dos documentos localizadas no documento indicado', !(tr.recusados || []).length,
    (tr.recusados || []).length ? `${tr.recusados.length} item(ns) da leitura saíram da NTA porque o trecho citado não foi localizado: ${tr.recusados.slice(0, 4).map(r => r.id).join(', ')}.` : `${tr.conferidos} trecho(s) conferido(s).`);

  // --- evidências ---
  const ids = new Set(['G']);
  for (const k of ['blocos', 'alteracoes', 'versoes', 'emendas', 'justificativa', 'estimativas', 'controversias', 'achados', 'ausencias', 'referencias']) for (const x of L[k] || []) if (x && x.id) ids.add(x.id);
  for (const x of pq.debate?.atores || []) ids.add(x.id);
  for (const x of pq.debate?.controversias || []) ids.add(x.id);
  for (const x of pq.internacional?.jurisdicoes || []) ids.add(x.id);
  for (const k of ['jurisprudencia', 'normas', 'dados', 'correlatas', 'documentos_base', 'alcance']) for (const x of pq.contexto?.[k] || []) ids.add(x.id);
  for (const k of ['historico', 'judicializacao']) for (const x of pq.congresso?.[k] || []) ids.add(x.id);
  const semEv = blocos.filter(b => b.exigeEv && !b.ev.length);
  const evFalsa = [...new Set(blocos.flatMap(b => b.ev.filter(e => !ids.has(e))))];
  add('Cada bloco da NTA aponta para a base (documento, pesquisa ou dado do programa)', !semEv.length && !evFalsa.length,
    [semEv.length ? `${semEv.length} bloco(s) sem indicação de base, por exemplo em "${semEv[0].secao}": "${semEv[0].texto.slice(0, 80)}…".` : '', evFalsa.length ? `Referência(s) inexistente(s): ${evFalsa.slice(0, 6).join(', ')}.` : ''].filter(Boolean).join(' '), evFalsa.length > 0);

  // --- números ---
  const baseTexto = [p.base?.documentos || '', p.base?.lei || '', ...pe5Textos(L), ...pe5Textos(pq), ...pe5Textos(G), ...pe5Textos(p.alteracoes || [])].join('\n');
  const baseNum = pe5Numeros(baseTexto);
  const taxas = p.cambio?.taxas || {};
  const perto = (a, b, tol = 0.035) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
  const brl = baseNum.filter(n => n.tipo === 'moeda' && n.moeda === 'BRL').map(n => n.valor);
  const estr = baseNum.filter(n => n.tipo === 'moeda' && n.moeda !== 'BRL');
  const naBase = n => {
    const mesmos = baseNum.filter(b => b.tipo === n.tipo && (n.tipo !== 'moeda' || b.moeda === n.moeda) && (n.tipo !== 'prazo' && n.tipo !== 'qtd' || b.unidade === n.unidade));
    if (mesmos.some(b => n.tipo === 'data' ? b.valor === n.valor : perto(b.valor, n.valor, 0.001))) return true;
    if (n.tipo === 'data') return false;
    // conversão de moeda pelo câmbio do programa (com arredondamento)
    if (n.tipo === 'moeda' && n.moeda === 'BRL' && estr.some(e => taxas[e.moeda] && perto(e.valor * taxas[e.moeda], n.valor))) return true;
    // a própria taxa citada ("a R$ 6,4672 por euro")
    if (n.tipo === 'moeda' && n.moeda === 'BRL' && Object.values(taxas).some(t => perto(Number(t), n.valor, 0.001))) return true;
    if (n.tipo === 'moeda' && n.moeda !== 'BRL' && taxas[n.moeda] && brl.some(v => perto(v / taxas[n.moeda], n.valor))) return true;
    // soma ou produto de dois números da base (prazo + prazo; valor × multiplicador)
    // intervalo entre duas datas da base ("dezenove dias depois da apresentação")
    if (n.tipo === 'prazo' && n.unidade === 'dia') { const ds = [...new Set(baseNum.filter(b => b.tipo === 'data').map(b => b.valor))].slice(0, 300).map(v => Date.UTC(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100)); for (let i = 0; i < ds.length; i++) for (let k = i + 1; k < ds.length; k++) if (Math.abs(ds[i] - ds[k]) / 864e5 === n.valor) return true; }
    // razão entre dois valores da base, já convertidos ("quase quatro vezes menor")
    if (n.tipo === 'prazo' && n.unidade === 'veze') { const eq = [...new Set([...brl, ...estr.filter(e => taxas[e.moeda]).map(e => e.valor * taxas[e.moeda])])].slice(0, 300); for (const x of eq) for (const y of eq) if (y > 0 && x > y && perto(x / y, n.valor, 0.1)) return true; }
    const vals = [...new Set(mesmos.map(b => b.valor))].slice(0, 400);
    for (let i = 0; i < vals.length; i++) for (let k = i; k < vals.length; k++) if (perto(vals[i] + vals[k], n.valor, 0.001)) return true;
    if (n.tipo === 'moeda') { const mult = baseNum.filter(b => b.tipo === 'prazo' && b.unidade === 'veze').map(b => b.valor); for (const v of vals) for (const k of mult) if (perto(v * k, n.valor, 0.001)) return true; }
    return false;
  };
  const suspeitos = [];
  for (const b of blocos) for (const n of pe5Numeros(b.texto)) {
    if (n.tipo === 'prazo' && n.valor < 2) continue;
    if (n.tipo === 'qtd' && n.valor < 10) continue;          // contagem de itens enumerados no próprio texto
    if (!naBase(n)) suspeitos.push({ secao: b.secao, literal: n.literal });
  }
  const uniq = [...new Map(suspeitos.map(s => [s.literal, s])).values()];
  add('Valores, percentuais, prazos e datas do texto existem na base ou derivam dela', !uniq.length,
    uniq.length ? `Não localizados (confira; podem ser cálculo do modelo): ${uniq.slice(0, 8).map(s => `${s.literal} [${s.secao}]`).join('; ')}${uniq.length > 8 ? '…' : ''}.` : '', uniq.length > 3);

  // --- dispositivos ---
  const baseArt = pe5Norm(baseTexto);
  const arts = new Map();
  for (const b of blocos) for (const m of b.texto.matchAll(/\barts?\.?\s*((?:\d{1,4}\s*[ºo°]?(?:\s*-\s*[A-Z]{1,2}\b)?(?:\s*(?:,|e|a)\s*(?=\d))?)+)/g))
    for (const a of m[1].matchAll(/(\d{1,4})\s*[ºo°]?(?:\s*-\s*([A-Z]{1,2})\b)?/g)) arts.set(a[1] + (a[2] ? '-' + a[2] : ''), b.secao);
  const artFalta = [...arts.keys()].filter(a => { const [n, l] = a.split('-'); return !new RegExp(`arts?${n}[o]?${l ? l.toLowerCase() : ''}(?![0-9])`).test(baseArt) && !new RegExp(`art${n}[o]?${l ? l.toLowerCase() : ''}`).test(baseArt.replace(/artigo/g, 'art')); });
  add('Cada artigo citado existe no texto analisado, na lei vigente ou na pesquisa', !artFalta.length, artFalta.length ? `Não localizado(s): ${artFalta.slice(0, 8).map(a => `art. ${a}`).join(', ')}.` : `${arts.size} artigo(s) citado(s).`, artFalta.length > 2);

  // --- repetição ---
  const tri = t => { const w = pe5Palavras(t); const s = new Set(); for (let i = 0; i + 2 < w.length; i++) s.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]); return s; };
  const frases = corpo.flatMap(b => b.texto.split(/(?<=[.;:])\s+(?=[A-ZÀ-Ú"“])/).filter(f => pe5Palavras(f).length >= 10).map(f => ({ secao: b.secao, f, t: tri(f) })));
  const repetidas = [];
  for (let i = 1; i < frases.length; i++) for (let k = 0; k < i; k++) {
    if (frases[i].secao === frases[k].secao) continue;
    let inter = 0; for (const x of frases[i].t) if (frases[k].t.has(x)) inter++;
    if (inter / (frases[i].t.size + frases[k].t.size - inter || 1) >= 0.5) { repetidas.push(`"${frases[i].f.slice(0, 70)}…" [${frases[k].secao} e ${frases[i].secao}]`); break; }
  }
  const porNumero = new Map();
  for (const b of corpo) for (const n of pe5Numeros(b.texto)) { if (n.tipo === 'data' || (n.tipo === 'prazo' && n.valor < 10)) continue; const k = n.tipo + '|' + (n.moeda || n.unidade || '') + '|' + n.valor; if (!porNumero.has(k)) porNumero.set(k, { literal: n.literal, secoes: new Set() }); porNumero.get(k).secoes.add(b.secao); }
  const espalhados = [...porNumero.values()].filter(x => x.secoes.size > 4).map(x => `${x.literal} (${x.secoes.size} seções)`);
  add('O texto não se repete entre seções', !repetidas.length && !espalhados.length,
    [repetidas.length ? `Frase(s) quase igual(is) em seções diferentes: ${repetidas.slice(0, 3).join('; ')}.` : '', espalhados.length ? `Número(s) repetido(s) em mais de quatro seções: ${espalhados.slice(0, 5).join('; ')}.` : ''].filter(Boolean).join(' '));

  // --- estrutura da abertura ---
  const A = doc.abertura || {};
  const probA = [];
  if (!A.frase) probA.push('falta a frase de abertura'); else if (A.frase.length > 280) probA.push(`a frase de abertura tem ${A.frase.length} caracteres (limite 280)`);
  if (!A.decide) probA.push('falta "o que se decide"'); else if (A.decide.length < 500) probA.push(`"o que se decide" está genérico (${A.decide.length} caracteres; espera-se a descrição detalhada do que se vota)`); else if (A.decide.length > 2200) probA.push('"o que se decide" passa de 2.200 caracteres');
  if ((A.muda || []).length < 3) probA.push('falta detalhar "o que muda" (menos de três itens)');
  if ((L.versoes || []).length && A.decide && !/substitutiv|emenda|senado|vers[ãa]o|texto original|relator/i.test(A.decide)) probA.push('há mais de uma versão do texto e "o que se decide" não diz qual se vota nem o que ela mudou');
  if ((A.pontos || []).length > 6) probA.push('mais de seis pontos de atenção');
  if (!(A.falta || []).length) probA.push('falta "o que falta saber"');
  if (!(doc.materia?.faz || []).length) probA.push('falta a explicação do que a proposição faz');
  if (!(doc.caminhos?.opcoes || []).length) probA.push('faltam as opções');
  add('Abertura completa e detalhada', !probA.length, probA.join('; '), probA.some(x => /^falta/.test(x)));

  // --- quem é alcançado: se a pesquisa nomeou, a abertura lista ---
  const alcP = pq.contexto?.alcance || [], alcD = A.alcancados || [];
  const alcFalta = alcP.filter(z => !alcD.some(d => (d.ev || []).includes(z.id))).map(z => z.grupo);
  const alcVago = !alcD.length && /alcan[çc]a (?:tamb[ée]m )?(?:grupos|empresas|entidades|setores)\b/i.test(A.alcance || '');
  add('"Quem é alcançado" traz os nomes', !alcFalta.length && !alcVago,
    alcFalta.length ? `A pesquisa identificou e a abertura não lista: ${alcFalta.slice(0, 6).join('; ')}.` : alcVago ? 'A abertura diz que o texto alcança grupos e não diz quais.' : alcD.length ? `${alcD.length} nome(s), com o dado público de cada um.` : 'A pesquisa não identificou nomes; a abertura explica o critério.');

  // --- documentos que embasam a proposição ---
  const refs = [...(L.referencias || []), ...(pq.contexto?.documentos_base || [])], docsD = doc.materia?.documentos || [];
  const refsFora = refs.filter(r => !docsD.some(d => (d.ev || []).includes(r.id))).map(r => r.nome || r.documento);
  add('Documentos que embasam a proposição estão relacionados pelo nome', !refsFora.length && (docsD.length > 0 || !refs.length),
    refsFora.length ? `Identificado(s) na leitura ou na pesquisa e fora da relação: ${refsFora.slice(0, 5).join('; ')}.` : docsD.length ? `${docsD.length} documento(s) relacionado(s).` : 'Nenhum documento de base identificado na leitura nem na pesquisa.');

  // --- quem se posicionou (um parágrafo por ator) e os dois lados (o argumento e o que a evidência diz) ---
  const atP = pq.debate?.atores || [], posD = doc.debate?.posicoes || [], ld = doc.debate?.lados || {};
  const atFalta = atP.filter(q => !posD.some(d => (d.ev || []).includes(q.id))).map(q => q.ator);
  const ldFalta = ['apoia', 'opoe'].filter(k => atP.some(q => (k === 'apoia' ? /favor/ : /contr/).test(q.posicao || '')) && !(String(ld[k]?.argumento || '').trim() && String(ld[k]?.evidencia || '').trim()));
  add('Cada entidade da pesquisa tem seu parágrafo, e os dois lados trazem o argumento e o que a evidência diz', !atFalta.length && !ldFalta.length,
    [atFalta.length ? `Na pesquisa e fora de "Quem se posicionou e como": ${atFalta.slice(0, 5).join('; ')}.` : '', ldFalta.length ? `Em "Os dois lados", falta o argumento ou a avaliação de quem ${ldFalta.map(k => k === 'apoia' ? 'apoia' : 'se opõe').join(' e de quem ')}.` : ''].filter(Boolean).join(' ') || (atP.length ? `${atP.length} entidade(s) em ${posD.length} parágrafo(s).` : 'A pesquisa não localizou manifestações.'));

  // --- judicialização: risco, nunca veredicto ---
  const reDecreta = /(?:^|[^a-zà-ú])(?:[ée]|s[ãa]o|est[áa]|est[ãa]o|seria|mostra-se|revela-se|afigura-se|padece de)\s+(?:[a-zà-ú]+mente\s+)?(?:inconstitucion|v[íi]cio de inconstitucionalidade)|\b(?:viola|violam|ofende|ofendem|afronta|afrontam|fere|ferem)\s+(?:frontalmente\s+|diretamente\s+)?(?:a|o)\s+(?:Constitui[çc][ãa]o|art\.\s*\d+[ºo°]?\s*(?:,[^.]{0,30})?\s*da Constitui[çc][ãa]o)|\binconstitucionalidade\s+(?:flagrante|manifesta|evidente|patente)/i;
  const decreta = [];
  for (const b of blocos) for (const f of b.texto.split(/(?<=[.;])\s+/)) if (reDecreta.test(f) && !/\b(?:STF|Supremo|tribunal|decidiu|declarou|julgou|alega|alegam|sustenta|sustentam|afirma|afirmam|segundo|para (?:a|o|os|as)\b|tese|argument|pode(?:m|ria|riam)? ser|questiona)/i.test(f)) decreta.push(`"${f.slice(0, 90)}…" [${b.secao}]`);
  add('A NTA não decreta inconstitucionalidade (só relata decisão ou alegação de alguém)', !decreta.length, decreta.slice(0, 3).join('; '), true);
  const sinais = pq.congresso?.judicializacao || [], judD = doc.analise?.judicializacao || [];
  const sinFora = sinais.filter(l => !judD.some(j => (j.ev || []).includes(l.id))).map(l => l.alvo || l.sinal);
  const judInc = judD.filter(j => !String(j.alvo || '').trim() || !String(j.fundamento || '').trim() || !String(j.quem || '').trim()).length;
  add('Risco de judicialização: cada sinal da pesquisa foi examinado, com alvo, legitimado e fundamento', !sinFora.length && !judInc,
    [sinFora.length ? `Sinal(is) da pesquisa fora da seção: ${sinFora.slice(0, 4).join('; ')}.` : '', judInc ? `${judInc} item(ns) sem alvo, sem quem ou sem fundamento.` : ''].filter(Boolean).join(' ') || (judD.length ? `${judD.length} ponto(s) examinado(s); ${sinais.length} sinal(is) concreto(s) localizado(s) na pesquisa.` : 'Nenhum ponto com perfil de judicialização na análise nem na pesquisa.'));

  // --- o partido e a matéria: o que o texto cita tem de estar nos dados da Câmara ---
  const Pd = G.partido || {}, partD = doc.caminhos?.partido || {};
  const rot = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const projBase = new Set((Pd.projetos || []).map(x => rot(x.rotulo)));
  const projFalsos = (Array.isArray(partD.projetos) ? partD.projetos : []).filter(r => !projBase.has(rot(r)));
  const citados = [...new Set((partD.texto || []).flatMap(x => [...String(x.texto || '').matchAll(/\b(PL|PLP|PEC|MPV|PDL)\s*(?:n[ºo.]*\s*)?(\d{1,5})\/(\d{4})\b/g)].map(m => `${m[1]} ${Number(m[2])}/${m[3]}`)))];
  const conhecidos = new Set([...(Pd.projetos || []).map(x => rot(x.rotulo)), ...(Pd.votacoesCorrelatas || []).map(x => rot(x.rotulo)), ...(pq.contexto?.correlatas || []).map(x => rot(x.proposicao)), ...(pq.congresso?.historico || []).map(x => rot(String(x.proposicao || '').replace(/\s*\(.*$/, ''))), rot(`${G.proposicao?.sigla || ''} ${G.proposicao?.numero || ''}/${G.proposicao?.ano || ''}`)]);
  const citFalsos = citados.filter(r => !conhecidos.has(rot(r)));
  const nomesVoto = [...(G.mapa?.podemos?.divergiram || []), ...((G.votacoes || []).flatMap(v => [...(v.bancada?.sim || []), ...(v.bancada?.nao || [])]))];
  add('O Podemos e a matéria: projetos e votos citados existem nos dados da Câmara', !projFalsos.length && !citFalsos.length,
    [projFalsos.length ? `Projeto(s) indicado(s) e fora da busca do programa: ${projFalsos.slice(0, 5).join(', ')}.` : '', citFalsos.length ? `Proposição(ões) citada(s) no texto e ausente(s) da base: ${citFalsos.slice(0, 5).join(', ')}.` : ''].filter(Boolean).join(' ')
      || (G.partido ? `${(Pd.acessorias || []).length} iniciativa(s) de deputado do partido na matéria; ${(Pd.projetos || []).length} projeto(s) localizado(s) por palavra-chave, ${(Array.isArray(partD.projetos) ? partD.projetos : []).length} apontado(s) como do mesmo assunto; ${(Pd.votacoesCorrelatas || []).filter(v => (v.nominais || []).length).length} proposição(ões) correlata(s) com voto nominal.` : 'Dados da atuação da bancada não levantados.'), projFalsos.length + citFalsos.length > 0 && nomesVoto.length >= 0);

  // --- fontes ---
  const atores = pq.debate?.atores || [], juris = pq.contexto?.jurisprudencia || [], jur = pq.internacional?.jurisdicoes || [];
  const semData = atores.filter(a => !a.data).map(a => a.ator), semFonte = [...atores, ...juris, ...jur].filter(x => !/^https?:\/\//.test(x.fonte_url || '')).map(x => x.ator || x.processo || x.lugar);
  const usados = new Set(blocos.flatMap(b => b.ev));
  const naoUsados = [...juris, ...jur, ...(pq.contexto?.normas || []), ...(pq.contexto?.dados || []), ...(pq.contexto?.correlatas || []), ...(pq.contexto?.documentos_base || []), ...(pq.contexto?.alcance || []), ...(pq.congresso?.historico || []), ...(pq.congresso?.judicializacao || [])].filter(x => x.id && !usados.has(x.id)).map(x => x.id);
  const todas = [...atores, ...juris, ...jur].filter(x => x.fonte_url);
  const prim = todas.filter(x => PE5_PRIMARIA.test(x.fonte_url) || /prim[áa]ria/i.test(x.fonte_tipo || '')).length;
  const temporarios = todas.filter(x => /vertexaisearch|grounding-api-redirect|googleusercontent/.test(x.fonte_url) && !x.fonte_url_final).length;
  add('Cada posição e cada decisão têm data e fonte', !semData.length && !semFonte.length && !temporarios,
    [semData.length ? `Sem data: ${semData.slice(0, 4).join('; ')}.` : '', semFonte.length ? `Sem fonte: ${semFonte.slice(0, 4).join('; ')}.` : '', temporarios ? `${temporarios} link(s) de redirecionamento temporário, sem o endereço final.` : ''].filter(Boolean).join(' '));
  add('Tudo o que a pesquisa trouxe foi usado no texto', !naoUsados.length, naoUsados.length ? `Coletado e não usado: ${naoUsados.slice(0, 10).join(', ')}.` : '');
  // Tamanho: nota longa demais ninguém lê. O alvo é de até 20 mil palavras (perto de 60 páginas).
  const palavras = blocos.reduce((n, b) => n + (String(b.texto || '').match(/\S+/g) || []).length, 0);
  add('Tamanho da nota', palavras <= 24000, palavras > 24000 ? `A nota tem cerca de ${Math.round(palavras / 1000)} mil palavras; o alvo é de até 20 mil (perto de 60 páginas). Há repetição a cortar.` : `${Math.round(palavras / 100) / 10} mil palavras.`);
  // Cobertura da LEITURA: ponto grave, estimativa, diferença entre versões e argumento dos documentos que não
  // aparecem em bloco nenhum da nota. A NTA do PLP 299/2026 feita pelo programa em 21/11/2026 deixou de fora
  // um ponto que a leitura tinha (o adiamento da Lei Kandir sem correção do valor).
  const foraLeitura = pe5CoberturaLeitura(L).filter(x => !usados.has(x.id));
  add('O que a leitura apontou de relevante foi usado no texto', !foraLeitura.length, foraLeitura.length ? `Lido e não usado: ${foraLeitura.slice(0, 8).map(x => `${x.id} (${x.rotulo})`).join('; ')}${foraLeitura.length > 8 ? `; e mais ${foraLeitura.length - 8}` : ''}.` : '');
  if (todas.length) add('Peso das fontes oficiais na pesquisa', prim / todas.length >= 0.3, `${prim} de ${todas.length} fontes são oficiais; as demais são imprensa ou terceiros. ${prim / todas.length < 0.3 ? 'A maior parte do debate está apoiada em imprensa: confira antes de citar.' : ''}`.trim());
  const semLimite = (doc.analise?.jurisprudencia || []).filter(j => !j.limite || !j.decidiu).map(j => j.processo);
  add('Cada decisão judicial diz o que decidiu e onde a analogia para', !semLimite.length, semLimite.length ? `Incompleta(s): ${semLimite.join('; ')}.` : '');

  // --- mínimos da pesquisa (22/11/2026): cinco países, quatro decisões, um parágrafo por ator, o quórum ---
  // Os prompts já pediam de 3 a 6 países e de 2 a 6 decisões, e ninguém conferia: a NTA do PLP 299/2026 saiu
  // com dois países e uma decisão. Abaixo do mínimo, o pipeline faz uma chamada complementar; se ainda faltar,
  // o teste avisa.
  const jurD = doc.internacional?.jurisdicoes || [], decD = doc.analise?.jurisprudencia || [];
  if ((pq.debate || pq.internacional) && pq.semBusca !== true) {   // sem busca na internet não há o que cobrar
    add('Experiência internacional: ao menos cinco países ou blocos', jurD.length >= 5, `${jurD.length} na nota (${jur.length} na pesquisa)${jurD.length < 5 ? '; o mínimo é cinco' : ''}.`);
    add('Decisões judiciais: ao menos quatro', decD.length >= 4, `${decD.length} na nota (${juris.length} na pesquisa)${decD.length < 4 ? '; o mínimo é quatro' : ''}.`);
    // Um país de modelo oposto (o mecanismo é vedado, depende do Legislativo ou é mais estreito) e a origem das
    // leis que o texto altera (22/11/2026: a NTA do PLP 299/2026 ficou sem os EUA e sem o PLP 93/2023).
    const P = (typeof pe5LeisAlteradas === 'function') ? { pe5LeisAlteradas, pe5OrigensFaltantes, pe5EhContraste } : require('./pe5-prompts.js');   // eslint-disable-line no-undef
    const opostos = jur.filter(P.pe5EhContraste), opostosNaNota = opostos.filter(j => usados.has(j.id));
    add('Experiência internacional: ao menos um país com modelo oposto ao do texto', opostosNaNota.length > 0,
      opostos.length ? `${opostos.map(j => j.lugar).join('; ')}${opostosNaNota.length ? '' : ' — está na pesquisa, mas não na nota'}.` : 'A pesquisa não trouxe país em que o mecanismo seja vedado, dependa do Legislativo ou seja mais estreito.');
    const leis = P.pe5LeisAlteradas(L, { anoRef: hoje.getFullYear() }), obrig = leis.filter(l => l.obrigatoria);
    if (obrig.length) {
      const hist = pq.congresso?.historico || [];
      const falta = P.pe5OrigensFaltantes(leis, hist).map(l => l.lei);
      const naPesquisa = obrig.filter(l => !falta.includes(l.lei));
      const foraNota = naPesquisa.filter(l => P.pe5OrigensFaltantes([l], hist.filter(h => usados.has(h.id))).length).map(l => l.lei);
      add('Histórico: o projeto de origem de cada lei alterada', !falta.length && !foraNota.length,
        [`Leis: ${obrig.map(l => l.lei).join('; ')}.`, falta.length ? `Sem a origem na pesquisa: ${falta.join('; ')}.` : '', foraNota.length ? `Origem pesquisada e fora da nota: ${foraNota.join('; ')}.` : ''].filter(Boolean).join(' '));
    }
  }
  // "Quem se posicionou e como" dá a tendência da votação: um parágrafo por ator com argumento próprio. Só divide
  // parágrafo quem repete o argumento de outro; a regra antiga (juntar "atores do mesmo grupo") pôs oito senadores
  // com argumentos diferentes num parágrafo só.
  const comArg = atores.filter(a => (a.argumentos || []).length);
  if (comArg.length) {
    const minimo = Math.ceil(comArg.length * 0.75), nPos = (doc.debate?.posicoes || []).length;
    const porGrupo = [...comArg.reduce((m, a) => m.set(a.grupo || 'sem grupo', (m.get(a.grupo || 'sem grupo') || 0) + 1), new Map())].map(([g, n]) => `${g}: ${n}`).join('; ');
    add('Quem se posicionou e como: um parágrafo por ator com argumento próprio', nPos >= minimo, `${nPos} parágrafo(s) para ${comArg.length} ator(es) com argumento${nPos < minimo ? ` (mínimo de ${minimo}: só divide parágrafo quem repete o argumento de outro)` : ''}. Por grupo: ${porGrupo}.`);
  }
  const Q = G.mapa?.quorum;
  if (Q && Q.minimo) {
    const onde = [doc.abertura?.decide, doc.abertura?.frase, ...(doc.caminhos?.opcoes || []).map(o => `${o.opcao} ${o.consequencias}`), ...(doc.materia?.origem || []).map(o => o.texto)].join(' ');
    const cita = new RegExp(`\\b${Q.minimo}\\b`).test(onde);
    add('Quórum da matéria dito na nota', cita, cita ? `${Q.minimo} votos (${Q.regra}).` : `A matéria exige ${Q.minimo} votos (${Q.regra}, ${Q.base}) e a abertura, a origem e as opções não dizem.`);
  }

  // --- linguagem ---
  const achar = re => { const o = []; for (const b of blocos) { const m = b.texto.match(re); if (m) o.push(`"${m[0]}" [${b.secao}]`); } return o; };
  const jarg = achar(PE5_RE_JARGAO), jurid = achar(PE5_RE_JURIDIQUES), voto = achar(PE5_RE_VOTO);
  add('Sem jargão interno do programa', !jarg.length, jarg.slice(0, 5).join('; '));
  add('Linguagem direta, sem juridiquês', !jurid.length, jurid.slice(0, 6).join('; '));
  add('Sem recomendação de voto', !voto.length, voto.slice(0, 3).join('; '), true);
  const ausSolta = [];
  for (const b of blocos.filter(x => x.secao !== 'emendas')) for (const f of b.texto.split(/(?<=[.;])\s+/)) if (PE5_RE_AUSENCIA.test(f) && !PE5_RE_ESCOPO.test(f) && !PE5_RE_ESCOPO.test(b.texto.slice(Math.max(0, b.texto.indexOf(f) - 160), b.texto.indexOf(f)))) ausSolta.push(`"${f.slice(0, 80)}…" [${b.secao}]`);
  add('Afirmações de ausência dizem onde se procurou', ausSolta.length <= 1, ausSolta.slice(0, 4).join('; '));

  // --- fase ---
  const fase = G.fase || {};
  const txtOpcoes = (doc.caminhos?.opcoes || []).map(o => `${o.opcao} ${o.consequencias}`).join(' ') + ' ' + (A.decide || '');
  let okFase = true, detFase = fase.descricao || '';
  // Depois de votada na Câmara, "aprovar", "rejeitar" e "adiar" deixam de ser opções desta Casa.
  const opcaoDeVoto = (doc.caminhos?.opcoes || []).some(o => /^\s*(aprovar|rejeitar|adiar)\b/i.test(o.opcao || '') && !/senado/i.test(o.opcao || ''));
  if (fase.jaVotadaNaCamara && (opcaoDeVoto || /o plen[áa]rio (?:da c[âa]mara )?decide/i.test(A.decide || ''))) { okFase = false; detFase = `${fase.descricao} As opções da NTA ainda tratam a votação na Câmara como pendente.`; }
  if (fase.codigo === 'camara_revisao_do_senado' && !/senado/i.test(txtOpcoes)) { okFase = false; detFase = `${fase.descricao} As opções da NTA não tratam das alterações do Senado.`; }
  if (fase.codigo === 'concluida' || fase.codigo === 'encerrada') { okFase = !/\b(aprovar|rejeitar)\b/i.test(txtOpcoes); if (!okFase) detFase = `${fase.descricao} A NTA ainda lista opções de voto.`; }
  add('Opções compatíveis com a fase da tramitação', okFase, detFase, !okFase);

  // --- legislação ---
  const alts = p.alteracoes || [], probL = [], vistos = new Map();
  for (const a of alts) {
    if (!a.vigente) { if (!a.novo) probL.push(`${a.dispositivo}: texto vigente não obtido`); continue; }
    const n = (String(a.dispositivo).match(/arts?\.?\s*(\d{1,4})/i) || [])[1];
    if (n && !new RegExp(`^Art\\.?\\s*${n}\\b`).test(a.vigente.trim())) probL.push(`${a.dispositivo}: o texto vigente não começa pelo art. ${n}`);
    const k = a.vigente.slice(0, 160); if (vistos.has(k)) probL.push(`${a.dispositivo}: mesmo texto vigente de ${vistos.get(k)}`); else vistos.set(k, a.dispositivo);
  }
  add('Tabela "o que muda": o texto vigente é o do artigo certo', !probL.length, probL.slice(0, 5).join('; ') || `${alts.length} linha(s), ${alts.filter(a => a.novo).length} de dispositivo novo.`, probL.some(x => /não começa|mesmo texto/.test(x)));

  // --- atualidade ---
  const probT = [];
  if (G.status?.iso) { const dias = Math.round((hoje - new Date(G.status.iso + 'T12:00:00')) / 864e5); if (dias > 45) probT.push(`O último andamento registrado é de ${G.status.data}, há ${dias} dias: confirme se houve fato posterior (audiência, novo parecer, acordo de líderes).`); }
  const sigla = String(G.proposicao?.sigla || p.sigla || '').toUpperCase();
  if (/^(PDL|PRC|PEC|PDC)$/.test(sigla) && blocos.some(b => /\bsan[çc](?:[ãa]o|ionad[oa])\b/i.test(b.texto) && !/san[çc][õo]es|san[çc][ãa]o (?:pecuni|administrativ|por|de multa)/i.test(b.texto))) probT.push(`${sigla} não vai a sanção presidencial, e o texto fala em sanção.`);
  for (const a of G.avisos || []) probT.push(`Dado da Câmara não obtido (${a}).`);
  if (G.reservaVotacoes) probT.push(`A API da Câmara não entregou as votações; elas foram lidas dos ${G.reservaVotacoes.origem}${G.reservaVotacoes.atualizadoEm ? `, atualizados em ${G.reservaVotacoes.atualizadoEm}` : ''}. Votação posterior a essa data não aparece.`);
  add('Atualidade dos dados de tramitação', !probT.length, probT.join(' '));

  const atencao = itens.filter(i => !i.ok);
  return { itens, atencao: atencao.length, criticos: atencao.filter(i => i.critico).length,
    resumo: atencao.length ? `${atencao.length} ponto(s) de atenção em ${itens.length} testes${atencao.some(i => i.critico) ? ', com item crítico' : ''}.` : `${itens.length} testes sem ressalva.` };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pe5Conferir, pe5CoberturaLeitura, pe5Blocos, pe5Numeros, pe5ExtensoParaDigitos, pe5Norm, pe5Textos, PE5_RE_JARGAO, PE5_RE_JURIDIQUES, PE5_RE_VOTO };
}
