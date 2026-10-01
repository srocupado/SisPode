'use strict';
// Orçamento · Comparador de Portarias — NOTA DE UMA PORTARIA (avulsa).
//
// O analista lança um ato novo e recebe a nota informativa (o que é, a quem se
// aplica, o que exige, prazos, vigência) ou a nota técnica (isso + impactos,
// pontos de atenção e recomendações da assessoria).
//
// Mesma regra da camada de IA do Orçamento (orcamento-ia.js): a IA lê e redige,
// o JS confere. Cada afirmação vem com o ARTIGO e o TRECHO LITERAL do ato; o JS
// procura o trecho no texto e o artigo no ato. O que não se acha não some — vai
// para a nota MARCADO, para o analista conferir antes de assinar.
// Identificação, órgão, data e relações (revoga/altera) não passam pela IA:
// vêm por regra (portarias-leitura.js e portarias-sequencia.js).

const PT_NOTA_TIPOS = {
  informativa: { rotulo: 'Nota informativa', desc: 'descreve o ato: o que é, a quem se aplica, o que exige, prazos e vigência — sem juízo de valor' },
  tecnica: { rotulo: 'Nota técnica', desc: 'a informativa + impactos, pontos de atenção e recomendações da assessoria' },
};

// Listas da nota: chave → [rótulo, campos de texto do item]
const PT_NOTA_LISTAS = {
  pontos: ['Principais disposições', ['tema', 'descricao']],
  aplicacao: ['A quem se aplica e quem faz o quê', ['quem', 'como']],
  prazos: ['Prazos', ['prazo', 'evento']],
  valores: ['Valores e limites', ['valor', 'descricao']],
  impactos: ['Impactos', ['para', 'descricao']],
  atencao: ['Pontos de atenção', ['descricao']],
};

// Gráficos/quadros que a tela sabe desenhar (sempre a partir de dados já
// conferidos). A IA só ESCOLHE quais entram — e o analista pode pedir mais ou menos.
const PT_VISUAIS = {
  numeros: 'Em números (quadro de totais)',
  relacoes: 'Diagrama de relações (revoga / altera)',
  prazos: 'Régua de prazos',
  valores: 'Barras de valores',
  aplicacao: 'Quadro "quem faz o quê"',
  temas: 'Gráfico da composição da nota (itens por seção)',
};
const PT_VISUAIS_PADRAO = ['numeros', 'relacoes', 'prazos', 'valores'];

const PT_EXTENSOES = { curta: 'curta (resumo de 2 frases, até 5 itens por lista)', normal: 'normal', detalhada: 'detalhada (resumo de 2 parágrafos, todos os itens relevantes)' };

function ptPromptNota({ tipo = 'informativa', foco = '', cab = {}, relacoes = null } = {}) {
  const tecnica = tipo === 'tecnica';
  const rel = relacoes ? [
    ...(relacoes.revoga || []).map(x => `revoga ${x.rotulo}`),
    ...(relacoes.altera || []).map(x => `altera ${x.rotulo}`),
  ] : [];
  return `Você é analista de orçamento e transferências da Liderança de um partido na Câmara dos Deputados.
Leia o ATO NORMATIVO abaixo e extraia o conteúdo para uma ${PT_NOTA_TIPOS[tecnica ? 'tecnica' : 'informativa'].rotulo.toUpperCase()}.

Ato: ${cab.identificacao || '(identificação não reconhecida)'}${cab.orgao ? ` — ${cab.orgao}` : ''}
${rel.length ? `Relações já identificadas no texto: ${rel.join('; ')}.\n` : ''}${foco ? `Foco pedido pelo analista: ${foco}\n` : ''}
REGRAS (obrigatórias):
1. Use SOMENTE o texto do ato. Não complete com conhecimento externo, não suponha o que não está escrito.
2. Todo item traz "artigos" (ex.: ["Art. 5º", "Art. 7º, § 2º"]) e "trecho": cópia LITERAL de 40 a 300 caracteres do ato
   que sustenta o item, sem reticências no meio, sem corrigir grafia. Sem trecho literal, não inclua o item.
3. Valores em reais, percentuais e prazos: escreva exatamente como no ato.
4. Português formal, frases curtas. Nada de opinião política.${tecnica ? `
5. Em "impactos", "atencao" e "recomendacoes" a análise é sua, mas cada impacto e ponto de atenção ainda precisa apontar
   o artigo e o trecho que o motivam. Recomendações são ações práticas para o gabinete (sem trecho).` : ''}

Responda APENAS com JSON, neste formato:
{
  "assunto": "uma frase: do que trata o ato",
  "resumo": "um parágrafo de 3 a 5 frases",
  "objeto": { "texto": "o que o ato regula", "artigos": ["Art. 1º"], "trecho": "..." },
  "pontos": [ { "tema": "título curto", "descricao": "o que o ato estabelece", "artigos": ["..."], "trecho": "..." } ],
  "aplicacao": [ { "quem": "órgão, ente ou agente", "como": "o que deve fazer ou como é afetado", "artigos": ["..."], "trecho": "..." } ],
  "prazos": [ { "prazo": "ex.: 30 dias", "evento": "para quê / a contar de quê", "artigos": ["..."], "trecho": "..." } ],
  "valores": [ { "valor": "ex.: R$ 200.000,00", "descricao": "o que o valor limita", "artigos": ["..."], "trecho": "..." } ],
  "vigencia": { "texto": "quando entra em vigor", "artigos": ["..."], "trecho": "..." },
  "secoes": [ { "titulo": "seção extra, só se pedida", "texto": "parágrafo", "artigos": ["..."], "trecho": "..." } ],
  "visuais": ${JSON.stringify(PT_VISUAIS_PADRAO)},
  "extensao": "normal"${tecnica ? `,
  "impactos": [ { "para": "quem é impactado", "descricao": "...", "artigos": ["..."], "trecho": "..." } ],
  "atencao": [ { "descricao": "risco, ambiguidade, prazo curto, exigência nova…", "artigos": ["..."], "trecho": "..." } ],
  "recomendacoes": [ "ação recomendada ao gabinete" ]` : ''}
}
Listas vazias são permitidas: melhor vazia do que inventada. No máximo 12 itens por lista.
"visuais": escolha entre ${Object.keys(PT_VISUAIS).join(', ')} (${Object.entries(PT_VISUAIS).map(([k, v]) => `${k} = ${v}`).join('; ')}).
"extensao": ${Object.keys(PT_EXTENSOES).join(' | ')}.`;
}

/**
 * Revisão pedida pelo analista ("mais um parágrafo sobre…", "mais curta",
 * "mais gráficos"). Serve às duas notas (avulsa e comparativa): recebe a nota
 * atual em JSON e o pedido, e devolve o mesmo formato — as regras de trecho
 * literal continuam valendo, e a conferência roda de novo sobre a resposta.
 */
function ptPromptRevisao({ nota, pedido, historico = [], tipo = 'informativa', cab = {}, comparativa = false } = {}) {
  const atual = Object.assign({}, nota);
  for (const k of Object.keys(atual)) {
    const limpa = it => it && typeof it === 'object' && !Array.isArray(it) ? (({ conferido, problemas, ...r }) => r)(it) : it;
    atual[k] = Array.isArray(atual[k]) ? atual[k].map(limpa) : limpa(atual[k]);
  }
  return `Você revisa uma ${comparativa ? 'NOTA TÉCNICA COMPARATIVA de atos normativos' : (PT_NOTA_TIPOS[tipo] || PT_NOTA_TIPOS.informativa).rotulo.toUpperCase()} já redigida${cab.identificacao ? ` sobre ${cab.identificacao}` : ''}.
O analista pediu a seguinte alteração:
<<<${String(pedido || '').trim()}>>>
${historico.length ? `Pedidos anteriores, já atendidos (mantenha-os): ${historico.map(h => `«${h}»`).join('; ')}.
` : ''}
REGRAS (obrigatórias):
1. Altere SOMENTE o que o pedido exige; o resto da nota permanece igual.
2. Conteúdo novo só do texto do ato abaixo, com "artigos" e "trecho" LITERAL (40 a 300 caracteres) — as mesmas regras da nota original.
   Se o pedido exigir algo que o ato não diz, não invente: explique em "resposta".
3. Pedido de parágrafo/seção a mais: use "secoes". Pedido de texto mais curto ou mais longo: ajuste "extensao" e o tamanho do texto.
   Pedido de gráficos: ajuste "visuais", escolhendo entre ${Object.keys(PT_VISUAIS).join(', ')} (${Object.entries(PT_VISUAIS).map(([k, v]) => `${k} = ${v}`).join('; ')}).
   Os gráficos são desenhados pela tela a partir dos itens da nota — para um gráfico ter conteúdo, a lista correspondente precisa ter itens.
4. Inclua "resposta": uma frase dizendo o que foi alterado (ou por que não foi possível).

NOTA ATUAL (JSON):
${JSON.stringify(atual)}

Responda APENAS com o JSON completo da nota revisada, no mesmo formato, com o campo "resposta".`;
}

/** Artigos existentes no ato: Set de números ("5", "12"). Pura. */
function ptArtigosDoTexto(texto) {
  const s = new Set();
  for (const m of String(texto || '').matchAll(/\bArt(?:igo)?\.?\s*(\d+)/gi)) s.add(String(+m[1]));
  return s;
}

/**
 * Artigos do PRÓPRIO ato: os que abrem linha fora de aspas. "Art. 6º ……" entre
 * aspas é dispositivo do ato alterado, reescrito — não conta. Pura.
 */
function ptArtigosProprios(texto) {
  const s = new Set();
  for (const m of String(texto || '').matchAll(/^\s*Art(?:igo)?\.?\s*(\d+)/gim)) s.add(String(+m[1]));
  return s;
}

/** Número do artigo citado: "Art. 7º, § 2º" → "7"; sem número → null. */
function ptNumArtigo(a) {
  const m = String(a || '').match(/Art(?:igo)?\.?\s*(\d+)/i);
  return m ? String(+m[1]) : null;
}

function ptCompacto(s) {
  return String(s ?? '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Confere a resposta do modelo contra o texto do ato. Pura.
 * Cada item ganha { conferido, problemas[] }:
 *  - trecho literal localizado no ato (mesma normalização de orcamento-ia.js);
 *  - artigos citados existem no ato;
 *  - em "valores", o valor aparece no trecho.
 * Devolve { nota, total, conferidos, problemas } — os itens não conferidos
 * continuam na nota, marcados.
 */
function ptConferirNota(resp, texto) {
  const fonte = ptCompacto(texto);
  const arts = ptArtigosDoTexto(texto);
  const r = resp && typeof resp === 'object' ? resp : {};
  let total = 0, conferidos = 0;
  const confere = (item, chaveValor) => {
    if (!item || typeof item !== 'object') return null;
    const problemas = [];
    const artigos = (Array.isArray(item.artigos) ? item.artigos : item.artigos ? [item.artigos] : []).map(String).filter(Boolean);
    const trecho = String(item.trecho || '').trim();
    const t = ptCompacto(trecho);
    if (t.length < 25) problemas.push('sem trecho literal do ato');
    else if (!fonte.includes(t)) problemas.push('trecho não localizado no ato');
    const inexist = artigos.filter(a => { const n = ptNumArtigo(a); return n && !arts.has(n); });
    if (inexist.length) problemas.push(`artigo inexistente no ato: ${inexist.join(', ')}`);
    if (!artigos.length) problemas.push('sem artigo');
    if (chaveValor && item[chaveValor] && t && !t.includes(ptCompacto(item[chaveValor]))) problemas.push('valor não está no trecho citado');
    total++;
    if (!problemas.length) conferidos++;
    return Object.assign({}, item, { artigos, trecho, conferido: !problemas.length, problemas });
  };
  const lista = (k, kv) => (Array.isArray(r[k]) ? r[k] : []).slice(0, 12).map(x => confere(x, kv)).filter(Boolean);
  const nota = {
    assunto: String(r.assunto || '').trim(),
    resumo: String(r.resumo || '').trim(),
    objeto: confere(r.objeto),
    pontos: lista('pontos'),
    aplicacao: lista('aplicacao'),
    prazos: lista('prazos'),
    valores: lista('valores', 'valor'),
    vigencia: confere(r.vigencia),
    impactos: lista('impactos'),
    atencao: lista('atencao'),
    recomendacoes: (Array.isArray(r.recomendacoes) ? r.recomendacoes : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 8),
    secoes: (Array.isArray(r.secoes) ? r.secoes : []).slice(0, 8).map(x => confere(x)).filter(x => x && (x.titulo || x.texto)),
    visuais: Array.isArray(r.visuais) ? [...new Set(r.visuais.map(String).filter(v => PT_VISUAIS[v]))] : PT_VISUAIS_PADRAO.slice(),
    extensao: PT_EXTENSOES[r.extensao] ? r.extensao : 'normal',
    resposta: String(r.resposta || '').trim(),
  };
  return { nota, total, conferidos, problemas: total - conferidos };
}

/** Prazo em dias, para ordenar a régua: "30 (trinta) dias" → 30; "6 meses" → 180; "1 ano" → 365. */
function ptPrazoDias(prazo) {
  const m = String(prazo || '').match(/(\d+)\s*(?:\([^)]*\)\s*)?(dias?|m[eê]s(?:es)?|anos?)/i);
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  return u.startsWith('d') ? n : u.startsWith('m') ? n * 30 : n * 365;
}

/** Texto corrido da nota, para copiar e colar no SEI/Word. Pura. */
function ptNotaTexto(nota, meta = {}) {
  const L = [];
  const art = it => it && it.artigos && it.artigos.length ? ` (${it.artigos.join('; ')})` : '';
  const marca = it => it && !it.conferido ? ' [conferir]' : '';
  L.push(`${(PT_NOTA_TIPOS[meta.tipo] || PT_NOTA_TIPOS.informativa).rotulo.toUpperCase()}`);
  if (meta.identificacao) L.push(`Assunto: ${meta.identificacao}${nota.assunto ? ' — ' + nota.assunto : ''}`);
  if (meta.orgao) L.push(`Órgão: ${meta.orgao}`);
  if (meta.relacoes && meta.relacoes.length) L.push(`Relações: ${meta.relacoes.join('; ')}`);
  L.push('');
  let n = 0;
  const secao = t => { L.push(''); L.push(`${++n}. ${t.toUpperCase()}`); };
  if (nota.resumo) { secao('Resumo'); L.push(nota.resumo); }
  if (nota.objeto && nota.objeto.texto) { secao('Objeto'); L.push(nota.objeto.texto + art(nota.objeto) + marca(nota.objeto)); }
  for (const [k, [rot, campos]] of Object.entries(PT_NOTA_LISTAS)) {
    if (!nota[k] || !nota[k].length) continue;
    secao(rot);
    for (const it of nota[k]) L.push(`- ${campos.map(c => it[c]).filter(Boolean).join(': ')}${art(it)}${marca(it)}`);
  }
  for (const x of nota.secoes || []) { secao(x.titulo || 'Complemento'); L.push((x.texto || '') + art(x) + marca(x)); }
  if (nota.vigencia && nota.vigencia.texto) { secao('Vigência'); L.push(nota.vigencia.texto + art(nota.vigencia) + marca(nota.vigencia)); }
  if (nota.recomendacoes.length) { secao('Recomendações'); nota.recomendacoes.forEach(r => L.push(`- ${r}`)); }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PT_NOTA_TIPOS, PT_NOTA_LISTAS, PT_VISUAIS, PT_VISUAIS_PADRAO, PT_EXTENSOES, ptPromptNota, ptPromptRevisao, ptArtigosDoTexto, ptArtigosProprios, ptNumArtigo, ptConferirNota, ptPrazoDias, ptNotaTexto };
}
