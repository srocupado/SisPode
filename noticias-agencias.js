// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Notícias da Agência Senado e da Agência Câmara sobre a matéria — para "Quem se posicionou e como" da NTA.
//
// Nasceu em 22/11/2026. Na NTA do PLP 299/2026, as falas de 18 senadores sobre o projeto estavam em 20 matérias
// da Agência Senado; a busca na internet do modelo gastava tentativas para achar o que o próprio Congresso já
// publica. O programa passa a ler essas notícias e entregá-las à pesquisa do debate como fontes já coletadas.
//   Senado:  página de busca em HTML — https://www12.senado.leg.br/noticias/busca?SearchableText=PLP+299%2F2026
//   Câmara:  a busca do portal é feita em JavaScript; os dados vêm de
//            https://www.camara.leg.br/busca-api/api/v1/busca/noticias/_search?q=...  (sintaxe Lucene: "/" quebra
//            a consulta, por isso a busca é pela sigla e o número entre aspas, e pelo id da proposição).
// Cada notícia só fica se o TEXTO dela citar a matéria (consultoriaCitaMateria): "PLP 299" casa notícia de 2014.
//
// Só a parte sem tela. Script clássico (global na extensão) + module.exports para os testes.

'use strict';

const _naLimpo = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

/** Texto corrido de uma página de notícia: os parágrafos do corpo, sem menu nem rodapé. */
function agenciaTextoDaPagina(html) {
  const h = String(html || '');
  const corpo = (h.match(/<div[^>]+id="textoMateria"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer|<aside)/i)
    || h.match(/<div[^>]+class="[^"]*(?:js-article-read-more|g-artigo__texto|materia-texto|texto-materia)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer|<aside)/i) || [])[1] || h;
  return [...corpo.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => _naLimpo(m[1]))
    .filter(p => p.length > 30 && !/navegador defasado|Reprodução autorizada|Agência Senado \(|Comentário$/i.test(p)).join('\n');
}

/** Links de matérias da Agência Senado numa página de busca: [{ url, titulo, data }] (data dd/mm/aaaa, do endereço). */
function agenciaSenadoLinks(html) {
  const out = [], vistos = new Set();
  for (const m of String(html || '').matchAll(/<a[^>]+href="(https:\/\/www12\.senado\.leg\.br\/noticias\/materias\/(\d{4})\/(\d{2})\/(\d{2})\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1].replace(/\/$/, ''); if (vistos.has(url) || /\.(jpe?g|png|gif)|@@images/i.test(url)) continue;
    const titulo = _naLimpo(m[5]); if (titulo.length < 12) continue;
    vistos.add(url); out.push({ url, titulo, data: `${m[4]}/${m[3]}/${m[2]}` });
  }
  return out;
}

/** Notícias da busca da Câmara (JSON do portal): [{ url, titulo, data, idsProposicao }]. */
function agenciaCamaraLinks(json) {
  const hits = (json && json.hits && Array.isArray(json.hits.hits)) ? json.hits.hits : [];
  return hits.map(x => x && x._source).filter(s => s && s.titulo && s.url).map(s => {
    const d = String(s.data || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return { url: /^https?:/.test(s.url) ? s.url : `https://${String(s.url).replace(/^\/+/, '')}`, titulo: _naLimpo(s.titulo), data: d ? `${d[3]}/${d[2]}/${d[1]}` : '', idsProposicao: String(s.proposicoes || '').split(/[,\s]+/).filter(Boolean) };
  });
}

const _naData = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`) : null; };

/**
 * Notícias das duas Agências que citam a matéria. fetchTexto(url) → texto da resposta (lança em erro de rede).
 * materia: { sigla, numero, ano, idCamara }. desde: Date — notícia anterior fica de fora (padrão: 1º de janeiro do ano).
 * Devolve [{ casa, veiculo, titulo, data, url, texto }], da mais recente para a mais antiga, no máximo `max`.
 */
async function agenciasBuscarNoticias(materia = {}, fetchTextoBruto, { max = 24, desde = null, maxCaracteres = 3500, esperaMs = 12000, lote = 6 } = {}) {
  const N = (typeof consultoriaCitaMateria === 'function') ? consultoriaCitaMateria : require('./notas-consultoria.js').consultoriaCitaMateria;
  const { sigla, numero, ano, idCamara } = materia;
  if (!sigla || !numero || !ano || typeof fetchTextoBruto !== 'function') return [];
  // Cada página tem limite de tempo: uma que não responda não pode travar a nota antes da pesquisa.
  const fetchTexto = url => { let t; return Promise.race([Promise.resolve().then(() => fetchTextoBruto(url)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('tempo esgotado')), esperaMs); })]).finally(() => clearTimeout(t)); };
  const ini = desde || new Date(`${ano}-01-01T00:00:00Z`);
  const candidatos = [];
  // Senado: duas páginas da busca (20 resultados cada)
  const q = encodeURIComponent(`${sigla} ${numero}/${ano}`).replace(/%20/g, '+');
  for (const pagina of [0, 20]) {
    try { for (const l of agenciaSenadoLinks(await fetchTexto(`https://www12.senado.leg.br/noticias/busca?SearchableText=${q}${pagina ? `&b_start:int=${pagina}` : ''}`))) candidatos.push({ ...l, casa: 'Senado', veiculo: 'Agência Senado' }); }
    catch (_) { /* busca fora do ar: segue */ }
  }
  // Câmara: pela sigla e número entre aspas e pelo id da proposição
  const consultas = [`"${sigla} ${Number(numero)}"`, ...(idCamara ? [`proposicoes:${idCamara}`] : [])];
  for (const c of consultas) {
    try { const j = JSON.parse(await fetchTexto(`https://www.camara.leg.br/busca-api/api/v1/busca/noticias/_search?q=${encodeURIComponent(c)}&pagina=1&ordenacao=data`)); for (const l of agenciaCamaraLinks(j)) candidatos.push({ ...l, casa: 'Câmara', veiculo: 'Agência Câmara de Notícias' }); }
    catch (_) { /* busca fora do ar: segue */ }
  }
  const vistos = new Set(), out = [];
  const ordem = candidatos.filter(c => { const d = _naData(c.data); return !d || d >= ini; })
    .filter(c => (vistos.has(c.url) ? false : vistos.add(c.url)))
    .sort((a, b) => (_naData(b.data) || 0) - (_naData(a.data) || 0));
  // As páginas são lidas em lotes, em paralelo (uma a uma, eram dezenas de esperas em série), na ordem das datas.
  for (let i = 0; i < ordem.length && out.length < max; i += lote) {
    const grupo = ordem.slice(i, i + lote);
    const textos = await Promise.all(grupo.map(c => fetchTexto(c.url).then(agenciaTextoDaPagina).catch(() => null)));
    grupo.forEach((c, k) => {
      const texto = textos[k]; if (texto == null || out.length >= max) return;
      if (!N(`${c.titulo}\n${texto}`, { sigla, numero, ano }) && !(idCamara && (c.idsProposicao || []).includes(String(idCamara)) && texto.length > 200)) return;
      out.push({ casa: c.casa, veiculo: c.veiculo, titulo: c.titulo, data: c.data, url: c.url, texto: texto.slice(0, maxCaracteres) });
    });
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { agenciaTextoDaPagina, agenciaSenadoLinks, agenciaCamaraLinks, agenciasBuscarNoticias };
}
