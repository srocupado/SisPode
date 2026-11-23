// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Notas das consultorias de orçamento da Câmara e do Senado sobre a matéria — para a Nota Técnica Analítica (NTA).
//
// Nasceu em 21/11/2026, com o PLP 299/2026. A crítica mais útil ao texto (estimativas não refeitas, simulação do
// contingenciamento, contas da Lei Kandir) estava numa Nota Informativa da Consultoria de Orçamentos do Senado,
// que não aparece na lista de documentos da matéria: é publicada na página de estudos da consultoria. O mesmo
// vale para as notas de adequação orçamentária que a consultoria da Câmara faz para cada medida provisória.
//
// As duas consultorias mantêm uma LISTAGEM pública, em HTML, em que cada nota é um link cujo texto cita a
// proposição ("Nota Informativa - Substitutivo ao PLP nº 299/2026", "MP 1361 - Subsídios acerca da adequação…").
// O programa lê a listagem e fica com os links que citam a matéria — no texto, no título ou no endereço.
//   Senado:  https://www12.senado.leg.br/orcamento/documentos/estudos/tipos-de-estudos/notas-tecnicas-e-informativos
//   Câmara:  https://www2.camara.leg.br/orcamento-da-uniao/estudos/<ano>
// O que NÃO cobre: as consultorias legislativas (de mérito) das duas Casas, que não têm listagem por proposição.
//
// Só a parte sem tela. Script clássico (global na extensão) + module.exports para os testes.

'use strict';

const CONSULTORIAS_ORCAMENTO = [
  { casa: 'Senado', orgao: 'Consultoria de Orçamentos, Fiscalização e Controle do Senado', paginas: () => ['https://www12.senado.leg.br/orcamento/documentos/estudos/tipos-de-estudos/notas-tecnicas-e-informativos'] },
  { casa: 'Câmara', orgao: 'Consultoria de Orçamento e Fiscalização Financeira da Câmara', paginas: anos => anos.map(a => `https://www2.camara.leg.br/orcamento-da-uniao/estudos/${a}`) },
];

const _ncLimpo = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

/**
 * O texto cita esta proposição? Aceita "PLP 299/2026", "PLP nº 299/2026", "Projeto de Lei Complementar nº 299, de
 * 2026" e, no endereço, "plp_299_2026". Para medida provisória, a consultoria da Câmara escreve só "MP 1361":
 * o número de MP não se repete entre os anos. "PL 299/2026" não casa com "PLP 299/2026" nem com "PL nº 4/2019-CN".
 */
function consultoriaCitaMateria(texto, { sigla, numero, ano } = {}) {
  const sg = String(sigla || '').toUpperCase(), n = String(Number(numero) || ''), a = String(ano || '');
  if (!sg || !n || !/^\d{4}$/.test(a)) return false;
  const t = String(texto || '');
  const num = n.length > 3 ? `${n.slice(0, -3)}\\.?${n.slice(-3)}` : n;                    // 1361 ou 1.361
  const nomes = { PL: 'Projeto de Lei', PLP: 'Projeto de Lei Complementar', PEC: 'Proposta de Emenda (?:à|a) Constitui[çc][ãa]o', PDL: 'Projeto de Decreto Legislativo', MPV: 'Medida Provis[óo]ria', PLN: 'Projeto de Lei do Congresso Nacional' };
  const siglas = sg === 'MPV' ? 'MPV?' : sg;
  const anoRe = sg === 'MPV' ? `(?:\\s*(?:\\/|,?\\s*de)\\s*${a})?` : `\\s*(?:\\/|,?\\s*de)\\s*${a}`;
  const fimCN = sg === 'PL' ? '(?!\\s*-?\\s*CN)' : '';
  const reSigla = new RegExp(`(^|[^A-Za-zÀ-ú])${siglas}\\s*(?:n[ºo°.]*\\s*)?${num}(?![\\d.])${anoRe}(?!\\d)${fimCN}`, 'i');
  const reNome = nomes[sg] ? new RegExp(`${nomes[sg]}\\s*(?:\\(${siglas}\\)\\s*)?(?:n[ºo°.]*\\s*)?${num}(?![\\d.])${anoRe}(?!\\d)`, 'i') : null;
  const reUrl = new RegExp(`(^|[^a-z])${sg === 'MPV' ? 'mpv?' : sg.toLowerCase()}[-_ ]?(?:n[-_ ]?o?[-_ ]?)?0*${n}[-_]${a}(?!\\d)`, 'i');
  return reSigla.test(t) || (reNome ? reNome.test(t) : false) || reUrl.test(t);
}

/** Links de uma listagem que citam a matéria: [{ titulo, url }]. `base` resolve endereço relativo. */
function consultoriaNotasDaPagina(html, base, materia) {
  const out = [], vistos = new Set();
  for (const m of String(html || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (m[1].match(/href\s*=\s*"([^"]+)"/i) || [])[1]; if (!href || /^(#|javascript:|mailto:)/i.test(href)) continue;
    const titulo = _ncLimpo(m[2]), dica = _ncLimpo((m[1].match(/title\s*=\s*"([^"]*)"/i) || [])[1]);
    if (!consultoriaCitaMateria(`${titulo} | ${dica}`, materia) && !consultoriaCitaMateria(decodeURIComponent(href.split('/').pop() || ''), materia)) continue;
    let url; try { url = new URL(href, base).href; } catch (_) { continue; }
    url = url.replace(/\/view\/?$/, '');                                  // página de visualização do arquivo → o arquivo
    if (vistos.has(url)) continue; vistos.add(url);
    out.push({ titulo: (titulo.length >= 12 ? titulo : dica || titulo).slice(0, 200), url });
  }
  return out;
}

/**
 * Procura, nas duas consultorias de orçamento, as notas que citam a matéria.
 * fetchTexto(url) → HTML da página (lança em erro de rede). Falha de uma Casa não derruba a outra.
 * Devolve [{ tipo: 'NOTA_CONSULTORIA', rotulo, url, casa, apoioConsultoria: true }], no máximo `max`.
 */
async function consultoriasBuscarNotas({ sigla, numero, ano } = {}, fetchTexto, { hoje = new Date(), max = 4 } = {}) {
  const materia = { sigla, numero, ano };
  if (!consultoriaCitaMateria(`${sigla} ${numero}/${ano}`, materia)) return [];
  const anos = [...new Set([String(ano), String(hoje.getFullYear())])].sort();
  const porCasa = await Promise.all(CONSULTORIAS_ORCAMENTO.map(async c => {
    const achados = [];
    for (const pagina of c.paginas(anos)) {
      try { for (const n of consultoriaNotasDaPagina(await fetchTexto(pagina), pagina, materia)) achados.push(n); }
      catch (_) { /* listagem fora do ar: segue sem ela */ }
    }
    return achados.map(n => ({ tipo: 'NOTA_CONSULTORIA', rotulo: `Nota da ${c.orgao}: ${n.titulo}`, url: n.url, casa: c.casa, apoioConsultoria: true }));
  }));
  const out = [], vistos = new Set();
  for (const d of porCasa.flat()) { if (!vistos.has(d.url) && out.length < max) { vistos.add(d.url); out.push(d); } }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONSULTORIAS_ORCAMENTO, consultoriaCitaMateria, consultoriaNotasDaPagina, consultoriasBuscarNotas };
}
