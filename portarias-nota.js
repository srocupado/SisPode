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
function ptPromptRevisao({ nota, pedido, historico = [], tipo = 'informativa', cab = {}, comparativa = false, alterado = null } = {}) {
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
4. Inclua "resposta": uma frase dizendo o que foi alterado (ou por que não foi possível).${alterado ? `
5. A nota compara o ato com o que ele ALTERA (${alterado.identificacao || 'ato alterado'}), cujo texto vem depois do ato, como "ATO ALTERADO". Em "alteracoes", "trecho" é literal do ato e "trecho_antes" é literal do ATO ALTERADO; mantenha "dispositivos", "antes", "depois", "efeito", "impactados" e "base_legal".` : ''}

NOTA ATUAL (JSON):
${JSON.stringify(atual)}

Responda APENAS com o JSON completo da nota revisada, no mesmo formato, com o campo "resposta".`;
}

// ---------- várias portarias numa nota só ----------
// Cada ato tem a sua nota (ptPromptNota, conferida contra o texto DELE). Com
// mais de um, uma chamada a mais escreve a parte geral — assunto, resumo, o que
// liga os atos (ou que não há ligação), atenção e recomendações — usando só o
// que já foi conferido em cada nota.

function ptPromptNotaConjunta({ tipo = 'informativa', foco = '', atos = [] } = {}) {
  const tecnica = tipo === 'tecnica';
  const lista = (xs, f) => (xs || []).slice(0, 12).map(f).join('; ');
  return `Você redige a parte geral de uma ${tecnica ? 'NOTA TÉCNICA' : 'NOTA INFORMATIVA'} sobre ${atos.length} atos normativos, para a Liderança de um partido na Câmara.
Cada ato já foi lido e resumido abaixo (conteúdo conferido no texto). Use SOMENTE isso; não acrescente números, prazos ou valores que não estejam aqui.
${foco ? `Foco pedido pelo analista: ${foco}
` : ''}
${atos.map((a, i) => `ATO ${i + 1}: ${a.identificacao}${a.orgao ? ' — ' + a.orgao : ''}
  Assunto: ${a.assunto || ''}
  Resumo: ${a.resumo || ''}
  Disposições: ${lista(a.pontos, x => `${x.tema}: ${x.descricao}`)}
  Prazos: ${lista(a.prazos, x => `${x.prazo} — ${x.evento}`)}
  Valores: ${lista(a.valores, x => `${x.valor} — ${x.descricao}`)}
  Relações: ${(a.relacoes || []).join('; ') || 'nenhuma identificada'}`).join('\n\n')}

Os atos podem não ter relação entre si — nesse caso diga isso em "conexoes" em vez de forçar uma ligação.

Responda APENAS com JSON:
{ "assunto": "uma frase sobre o conjunto", "resumo": "um parágrafo sobre o conjunto",
  "conexoes": [ { "texto": "o que liga (ou distingue) os atos", "atos": [1, 2] } ],
  ${tecnica ? '"impactos": [ { "para": "quem", "descricao": "…", "atos": [1] } ], "atencao": [ { "descricao": "…", "atos": [2] } ], "recomendacoes": [ "ação recomendada ao gabinete" ],' : ''}
  "visuais": ${JSON.stringify(PT_VISUAIS_PADRAO)}, "extensao": "normal", "secoes": [] }`;
}

/** Parte geral normalizada (geração e revisão). Pura. n = número de atos. */
function ptNormalizarGeral(r, n) {
  r = r && typeof r === 'object' ? r : {};
  const idx = a => (Array.isArray(a) ? a : []).map(Number).filter(x => x >= 1 && x <= n);
  const lst = (x, k) => (Array.isArray(x) ? x : []).slice(0, k);
  return {
    assunto: String(r.assunto || '').trim(), resumo: String(r.resumo || '').trim(),
    conexoes: lst(r.conexoes, 10).filter(c => c && c.texto).map(c => ({ texto: String(c.texto), atos: idx(c.atos) })),
    impactos: lst(r.impactos, 10).filter(c => c && c.descricao).map(c => ({ para: String(c.para || ''), descricao: String(c.descricao), atos: idx(c.atos) })),
    atencao: lst(r.atencao, 10).map(c => typeof c === 'string' ? { descricao: c, atos: [] } : c && c.descricao ? { descricao: String(c.descricao), atos: idx(c.atos) } : null).filter(Boolean),
    recomendacoes: lst(r.recomendacoes, 10).map(String).filter(Boolean),
    secoes: lst(r.secoes, 8).filter(x => x && (x.titulo || x.texto)).map(x => ({ titulo: String(x.titulo || ''), texto: String(x.texto || '') })),
    visuais: Array.isArray(r.visuais) ? [...new Set(r.visuais.map(String).filter(v => PT_VISUAIS[v]))] : PT_VISUAIS_PADRAO.slice(),
    extensao: PT_EXTENSOES[r.extensao] ? r.extensao : 'normal',
    resposta: String(r.resposta || '').trim(),
  };
}

/**
 * Revisão da nota de várias portarias: devolve { geral, atos: [ … ] } na mesma
 * ordem. As notas de cada ato voltam a ser conferidas contra o texto do ato.
 */
function ptPromptRevisaoConjunto({ nota, pedido, historico = [], tipo = 'informativa', identificacoes = [] } = {}) {
  const limpa = it => it && typeof it === 'object' && !Array.isArray(it) ? (({ conferido, problemas, ...r }) => r)(it) : it;
  const semMarcas = n => { const o = {}; for (const k of Object.keys(n)) o[k] = Array.isArray(n[k]) ? n[k].map(limpa) : limpa(n[k]); return o; };
  const atual = { geral: (({ resposta, ...g }) => g)(nota.geral), atos: nota.atos.map((a, i) => Object.assign({ ato: identificacoes[i] || `ato ${i + 1}` }, semMarcas(a.nota))) };
  return `Você revisa uma ${(PT_NOTA_TIPOS[tipo] || PT_NOTA_TIPOS.informativa).rotulo.toUpperCase()} sobre ${nota.atos.length} atos normativos.
O analista pediu a seguinte alteração:
<<<${String(pedido || '').trim()}>>>
${historico.length ? `Pedidos anteriores, já atendidos (mantenha-os): ${historico.map(h => `«${h}»`).join('; ')}.\n` : ''}
REGRAS (obrigatórias):
1. Altere SOMENTE o que o pedido exige; o resto permanece igual.
2. Em "atos", mantenha a MESMA ordem e a mesma quantidade. Conteúdo novo de um ato só do texto DELE (abaixo), com "artigos" e "trecho" LITERAL (40 a 300 caracteres).
3. Parágrafo a mais sobre o conjunto: "geral.secoes"; sobre um ato: "secoes" daquele ato. Mais curto/longo: "geral.extensao" (${Object.keys(PT_EXTENSOES).join(' | ')}).
   Gráficos: "geral.visuais", entre ${Object.entries(PT_VISUAIS).map(([k, v]) => `${k} = ${v}`).join('; ')}.
4. Inclua "geral.resposta": uma frase dizendo o que foi alterado (ou por que não foi possível).

NOTA ATUAL (JSON):
${JSON.stringify(atual)}

Responda APENAS com o JSON completo revisado: { "geral": { … }, "atos": [ … ] }.`;
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
  if (nota.analise && nota.analise.length) { secao('Análise'); nota.analise.forEach((p, i) => { if (i) L.push(''); L.push(p); }); }
  if (nota.objeto && nota.objeto.texto) { secao('Objeto'); L.push(nota.objeto.texto + art(nota.objeto) + marca(nota.objeto)); }
  if (nota.alteracoes && nota.alteracoes.length) {
    secao('O que muda, ponto a ponto');
    const k = n;
    nota.alteracoes.forEach((a, i) => {
      L.push(''); L.push(`${k}.${i + 1}. ${a.tema} — ${(a.dispositivos || []).join(', ')}${a.natureza ? ` (${a.natureza})` : ''}${marca(a)}`);
      L.push(`Antes: ${a.antes}`); L.push(`Agora: ${a.depois}`); L.push(`Efeito: ${a.efeito}`);
      (a.impactados || []).forEach(x => L.push(`Impacto — ${x.quem}: ${x.como}`));
      if (a.base_legal) L.push(`Base legal: ${a.base_legal}`);
    });
  }
  if (nota.aplicacao_temporal && nota.aplicacao_temporal.texto) { secao('Aplicação no tempo'); L.push(nota.aplicacao_temporal.texto + art(nota.aplicacao_temporal) + marca(nota.aplicacao_temporal)); }
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

// =====================================================================
// NOTA TÉCNICA DE ATO QUE ALTERA OUTRO — o que muda, ponto a ponto
// =====================================================================
// A nota técnica de um ato que altera outro não é uma leitura dos artigos: diz
// o que cada dispositivo MUDA (antes × agora), o efeito jurídico e prático,
// quem é impactado e a base legal. Para isso:
//   1. o ato alterado é lido (do DOU, ou da lista de atos lançados);
//   2. a MÁQUINA levanta o inventário: cada dispositivo entre aspas do ato novo,
//      se já existia (nova redação, com o bloco anterior) ou é novo (com o
//      artigo-base antigo); o art. longo é desmembrado (incisos, cada §);
//   3. a IA analisa em lotes (o limite de saída é 16 mil tokens) e a máquina
//      confere a cobertura — o que faltar volta numa chamada de complemento;
//      item que junta mais de 3 dispositivos, intervalo ("40-A a 40-D") ou
//      artigos-base diferentes é descartado e refeito;
//   4. todo "antes" que nega regra anterior passa por segunda leitura; só é
//      trocado com o trecho antigo achado LITERALMENTE no ato alterado;
//   5. conferência: trecho literal do ato novo, do ato alterado, e norma citada
//      como base legal que o ato não menciona.
// Medido com a Portaria Conjunta MPO/MGI/SRI-PR nº 3/2026 (altera a nº 2/2026):
// 29 entradas no inventário, 33 de 33 afirmações conferidas, 9 "antes"
// corrigidos com prova pela segunda leitura (15/10/2026).

const ptIdArt = (n, s) => `Art. ${n}${+n < 10 ? 'º' : ''}${s || ''}`;

/** Artigos de um ato: { 'Art. 34': texto, 'Art. 34-A': … }. Pura. */
function ptArtigosTexto(t) {
  t = String(t || '');
  const pos = [...t.matchAll(/^Art\.\s*(\d+)º?(-[A-Z])?[.\s]/gm)].map(m => [m.index, ptIdArt(m[1], m[2])]);
  const o = {};
  pos.forEach(([p, k], i) => { o[k] = t.slice(p, i + 1 < pos.length ? pos[i + 1][0] : t.length).replace(/\n(CAPÍTULO|TÍTULO|Seção)[\s\S]*$/, '').trim(); });
  return o;
}

/** Incisos (rótulo → linha) e parágrafos (rótulo → texto) de um artigo. Pura. */
function ptPartesArtigo(txt) {
  const inc = {}, par = {};
  let atual = null;
  for (const l of String(txt || '').replace(/^"|"\s*\(NR\)\s*$/g, '').split('\n')) {
    const p = l.match(/^§\s*(\d+)º?|^Parágrafo único/);
    if (p) { atual = p[1] ? `§ ${p[1]}º` : 'Parágrafo único'; par[atual] = l; continue; }
    const r = l.match(/^([IVXL]+)\s*-\s/);
    if (r && !atual) { inc[r[1]] = l; continue; }
    if (atual) par[atual] += '\n' + l;
  }
  return { inc, par };
}

/**
 * Inventário das alterações (máquina): os dispositivos entre aspas do ato novo.
 * Nova redação → um item por bloco (incisos acrescidos; cada §), com o bloco
 * anterior; dispositivo novo → com o artigo-base antigo (34-A → art. 34).
 * Devolve [{ id, natureza, novo, antes, obs, base, artigoAntigo }]. Pura.
 */
function ptInventarioAlteracoes(novo, anterior) {
  const A = ptArtigosTexto(anterior || '');
  const blocos = [];
  let cur = null;
  for (const l of String(novo || '').split('\n')) {
    const m = l.match(/^"Art\.\s*(\d+)º?(-[A-Z])?/);
    if (m) { cur = { id: ptIdArt(m[1], m[2]), base: ptIdArt(m[1]), texto: l }; blocos.push(cur); continue; }
    if (/^Art\.\s*\d/.test(l) || /^"(TÍTULO|CAPÍTULO|Seção)/.test(l)) { cur = null; continue; }
    if (cur) cur.texto += '\n' + l;
  }
  const itens = [];
  for (const b of blocos) {
    if (!A[b.id]) { itens.push({ id: b.id, natureza: 'novo', novo: b.texto, base: A[b.base] ? { id: b.base, texto: A[b.base] } : null }); continue; }
    const pn = ptPartesArtigo(b.texto), pa = ptPartesArtigo(A[b.id]);
    const subs = [];
    const incNovos = Object.keys(pn.inc);
    if (incNovos.length) {
      const nome = l => l.replace(/^([IVXL]+)\s*-\s/, '').split(':')[0].trim().toLowerCase();
      const antigos = Object.entries(pa.inc).map(([k, l]) => [k, nome(l)]);
      const ja = [], novos = [];
      for (const k of incNovos) { const n = nome(pn.inc[k]); const a = antigos.find(([, m]) => m === n); a ? ja.push(`"${n}" (era o inciso ${a[0]}, agora ${k})`) : novos.push(`"${n}" (${k})`); }
      subs.push({ id: `${b.id}, incisos ${incNovos[0]} a ${incNovos[incNovos.length - 1]}`, novo: incNovos.map(k => pn.inc[k]).join('\n'),
        antes: incNovos.filter(k => pa.inc[k]).map(k => pa.inc[k]).join('\n'),
        obs: `comparação feita por máquina, pelo nome do conceito — conceitos que JÁ EXISTIAM: ${ja.join('; ') || 'nenhum'}; conceitos NOVOS: ${novos.join('; ') || 'nenhum'}. Para os que já existiam, compare também a definição` });
    }
    for (const [k, v] of Object.entries(pn.par)) {
      // parágrafo único que vira § 1º (técnica legislativa comum): o antigo parágrafo único é o "antes" do § 1º
      const renum = k === '§ 1º' && !pa.par['§ 1º'] && pa.par['Parágrafo único'];
      subs.push({ id: `${b.id}, ${k}`, novo: v, antes: pa.par[k] || (renum ? pa.par['Parágrafo único'] : ''),
        obs: pa.par[k] ? 'parágrafo já existia: nova redação' : renum ? 'o antigo PARÁGRAFO ÚNICO deste artigo passa a ser o § 1º, com nova redação — compare com ele'
          : `parágrafo novo${Object.keys(pa.par).length ? ` (o artigo antigo tinha: ${Object.keys(pa.par).join(', ')}) — veja se a matéria estava em algum deles` : ''}` });
    }
    if (!subs.length) subs.push({ id: b.id, novo: b.texto, antes: A[b.id], obs: 'nova redação do artigo' });
    subs.forEach(x => itens.push(Object.assign({ natureza: 'nova redação', artigoAntigo: A[b.id], base: { id: b.id, texto: A[b.id] } }, x)));
  }
  return itens;
}

/** Chave de cobertura de um dispositivo citado: "art2§1", "art2inc", "art34-A". null se não cita artigo. Pura. */
function ptChaveDispositivo(s) {
  s = String(s || '');
  const a = s.match(/Art\.?\s*(\d+)º?\s*(-\s*[A-Z])?/i);
  if (!a) return null;
  const art = 'art' + a[1] + (a[2] ? a[2].replace(/\s/g, '').toUpperCase() : '');
  const p = s.match(/§\s*(\d+)/), u = /par[áa]grafo\s+[úu]nico/i.test(s), inc = /incisos?\s+[IVXL]|,\s*[IVXL]{2,}\b/i.test(s);
  return art + (p ? '§' + p[1] : u ? '§u' : inc ? 'inc' : '');
}

/** Agrupamento aceito num item: até 3 dispositivos, sem intervalo ("40-A a 40-D"), todos do mesmo artigo-base. Pura. */
function ptAgrupamentoValido(a) {
  const ds = (a && Array.isArray(a.dispositivos)) ? a.dispositivos.map(String) : [];
  const ks = ds.map(ptChaveDispositivo);
  if (!ks.length || ks.includes(null) || ks.length > 3 || ds.some(d => /\d+º?\s*(-\s*[A-Z])?\s+a\s+(Art\.?\s*)?\d/i.test(d))) return false;
  return new Set(ks.map(k => k.match(/^art\d+/)[0])).size === 1;
}

/** Entradas do inventário que nenhum item cobre. Pura. */
function ptInventarioFaltando(inv, alteracoes) {
  const cob = new Set((alteracoes || []).flatMap(a => (a.dispositivos || []).map(ptChaveDispositivo)));
  return inv.filter(b => !cob.has(ptChaveDispositivo(b.id)));
}

/** Itens na ordem do inventário, sem duplicata (fica o 1º que cobre cada dispositivo). Pura. */
function ptOrdenarAlteracoes(inv, alteracoes) {
  const ordem = inv.map(b => ptChaveDispositivo(b.id));
  const pos = a => Math.min(...(a.dispositivos || []).map(d => { const i = ordem.indexOf(ptChaveDispositivo(d)); return i < 0 ? 999 : i; }));
  const vistos = new Set();
  return (alteracoes || []).slice().sort((a, b) => pos(a) - pos(b)).filter(a => {
    const ks = (a.dispositivos || []).map(ptChaveDispositivo);
    if (ks.every(k => vistos.has(k))) return false;
    ks.forEach(k => vistos.add(k));
    return true;
  });
}

function ptBlocoInventario(inv) {
  return inv.map((b, i) => `### ${i + 1}. ${b.id} — ${b.natureza === 'novo' ? 'DISPOSITIVO NOVO' : 'NOVA REDAÇÃO'}${b.obs ? ` (${b.obs})` : ''}
TEXTO NOVO:
${b.novo}
${b.natureza === 'novo'
  ? (b.base ? `ARTIGO-BASE NO ATO ALTERADO (${b.base.id}) — veja se a matéria já era tratada aqui:\n${b.base.texto}` : 'ARTIGO-BASE: não existe no ato alterado.')
  : `REDAÇÃO ANTERIOR DESTE BLOCO:\n${b.antes || '(não havia este bloco)'}${b.artigoAntigo && !b.antes ? `\nARTIGO ANTIGO INTEIRO (para comparar):\n${b.artigoAntigo}` : ''}`}`).join('\n\n');
}

const PT_PAPEL_TECNICA = 'Você é analista de orçamento e transferências da Liderança de um partido na Câmara dos Deputados, especialista em execução de emendas parlamentares (CF, arts. 165, 166 e 166-A; LC nº 210/2024; LDO; LOA).';

function ptRegrasAlteracoes(n) {
  return `COMO ANALISAR
1. Cada entrada do inventário (${n} neste pedido) tem de aparecer em "alteracoes", com o RÓTULO EXATO do inventário em "dispositivos" (ex.: "Art. 2º, § 2º"). Um item por entrada; só junte até 3 entradas num item quando forem a MESMA regra. Nunca junte modalidades diferentes de emenda (individual, bancada, comissão).
2. "antes" NUNCA fica vazio: diga o que o ato alterado dizia sobre aquilo, ou "não havia regra sobre isso no ato alterado" (só depois de procurar no artigo antigo e no artigo-base).
   NOVA REDAÇÃO: compare o TEXTO NOVO com a REDAÇÃO ANTERIOR e diga só a DIFERENÇA — o que entrou, o que saiu, o que mudou de sentido. Nunca transcreva o texto inteiro em "antes" ou "depois": no máximo 3 frases, com as palavras que mudaram entre aspas quando a mudança for de redação. Nos incisos, compare inciso a inciso pelo CONTEÚDO (o mesmo número pode ter outro conteúdo agora).
3. DISPOSITIVO NOVO (ou parágrafo novo): leia o ARTIGO-BASE INTEIRO, inciso por inciso e parágrafo por parágrafo (e o restante do ato alterado, se precisar): se algum deles já tratava do mesmo assunto, o "antes" tem de citá-lo pelo número e dizer o que ele já exigia. Se não tratava, diga que é regra nova.
4. EFEITO JURÍDICO (obrigação, condição, vedação, prazo, competência, hipótese de impedimento de ordem técnica; amplia ou restringe; transfere responsabilidade) e EFEITO PRÁTICO (rotina de quem indica, executa ou fiscaliza).
5. QUEM é impactado e COMO: parlamentar autor, bancada estadual, comissão, órgão setorial/unidade executora, ente beneficiário, entidade privada sem fins lucrativos, órgãos centrais, SRI.
6. BASE LEGAL: só o que o próprio ato invoca naquele dispositivo ou no preâmbulo; se não invoca, "o ato não indica fundamento específico". Diga se a regra reproduz, detalha ou vai além da lei. Não cite norma que o ato não cita.
7. O "tema" descreve o que AQUELE dispositivo trata.

REGRAS DE PROVA (obrigatórias)
a) "trecho": cópia LITERAL de 40 a 300 caracteres do TEXTO NOVO daquela entrada. "trecho_antes": cópia LITERAL de 40 a 300 caracteres do ato alterado SÓ quando "antes" afirma o que ele dizia; se não havia regra, "". NUNCA use "[...]", "…" ou "..." dentro do trecho: escolha um pedaço CONTÍNUO do texto. Sem corrigir grafia.
b) Não estenda uma regra a quem o texto não nomeia (regra de bancada não vale para emenda individual).
c) A análise é sua, mas decorre do texto; inferência vem marcada ("tende a", "pode"). Nada de números, prazos ou valores que o texto não traga.
d) Português formal e claro, sem opinião político-partidária.`;
}

/** Parte geral da nota técnica de ato que altera outro (sem a lista de alterações, que vem em lotes). */
function ptPromptTecnicaGeral({ cab = {}, rel = {}, inv = [], texto = '', alterado = {}, foco = '' } = {}) {
  return `${PT_PAPEL_TECNICA}
Redija a PARTE GERAL de uma NOTA TÉCNICA sobre o ATO NOVO. A nota NÃO é uma leitura dos artigos: explica o que o ato MUDA no regime jurídico, o efeito disso e para quem.
(A análise de cada dispositivo é feita à parte; aqui, a visão de conjunto.)

Ato novo: ${cab.identificacao || '(identificação não reconhecida)'}${cab.orgao ? ` — ${cab.orgao}` : ''}
Ato alterado: ${alterado.identificacao || ((rel.altera || []).map(x => x.rotulo).join('; ')) || '(nenhum)'}
${foco ? `Foco pedido pelo analista: ${foco}\n` : ''}
REGRAS
- Use só o texto dos atos. Não invente números, prazos ou valores. Não cite norma que o ato não cita. Sem opinião político-partidária.
- "trecho": cópia LITERAL e CONTÍNUA de 40 a 300 caracteres do ATO NOVO (sem "[...]").
- Comece pelos efeitos de maior impacto para os mandatos.

Responda APENAS com JSON:
{
  "assunto": "uma frase: o que o ato muda",
  "resumo": "um parágrafo (4 a 6 frases): o sentido geral da mudança e o efeito para os mandatos",
  "analise": [ "3 a 5 parágrafos de análise de conjunto: o que consolida da lei, onde vai além dela, como redistribui responsabilidades, quais novas hipóteses de impedimento técnico cria, o que muda para os mandatos" ],
  "aplicacao_temporal": { "texto": "a partir de quando e a que exercício as mudanças se aplicam", "artigos": ["…"], "trecho": "…" },
  "prazos": [ { "prazo": "…", "evento": "…", "mudou": "o que era antes, ou 'prazo novo'", "artigos": ["…"], "trecho": "…" } ],
  "atencao": [ { "descricao": "risco concreto para o gabinete (impedimento técnico, prazo, exigência documental, ambiguidade)", "artigos": ["…"], "trecho": "…" } ],
  "recomendacoes": [ "ação prática para o gabinete, ligada a uma alteração" ],
  "vigencia": { "texto": "quando entra em vigor", "artigos": ["…"], "trecho": "…" }
}

ATO NOVO (íntegra):
"""
${texto}
"""

INVENTÁRIO DAS ALTERAÇÕES (levantado por máquina):
${ptBlocoInventario(inv)}`;
}

const PT_ITEM_ALTERACAO = `{ "tema": "…", "dispositivos": ["rótulo exato do inventário"], "natureza": "novo | nova redação", "antes": "…", "depois": "…", "efeito": "…", "impactados": [ { "quem": "…", "como": "…" } ], "base_legal": "…", "trecho": "…", "trecho_antes": "…" }`;

/** Análise de um LOTE de entradas do inventário (o limite de saída não comporta todas de uma vez). */
function ptPromptTecnicaAlteracoes({ cab = {}, rel = {}, lote = [], alterado = {}, complemento = false } = {}) {
  return `${PT_PAPEL_TECNICA}
Você analisa, para uma NOTA TÉCNICA, o que o ATO NOVO muda em cada dispositivo do ATO ALTERADO — não é leitura dos artigos: é antes × agora, efeito e para quem.
${complemento ? 'Estas entradas ficaram de fora de uma análise anterior: produza um item para cada uma.\n' : ''}
Ato novo: ${cab.identificacao || ''}${cab.orgao ? ` — ${cab.orgao}` : ''}
Ato alterado: ${alterado.identificacao || ((rel.altera || []).map(x => x.rotulo).join('; ')) || ''}

${ptRegrasAlteracoes(lote.length)}

Responda APENAS com JSON: { "alteracoes": [ ${PT_ITEM_ALTERACAO} ] }

INVENTÁRIO (as entradas deste pedido):
${ptBlocoInventario(lote)}

ATO ALTERADO (íntegra, para localizar onde a matéria era tratada):
"""
${alterado.texto || ''}
"""`;
}

/** O "antes" nega regra anterior ("não havia", "apenas"…)? Esses passam pela segunda leitura. Pura. */
function ptNegaRegraAnterior(antes) {
  return !String(antes || '').trim() || /n[ãa]o\s+(havia|existia|tratava|previa|definia|trazia|exigia|vedava|fixava|regulava|disciplinava|mencionava|estabelecia)|sem\s+(previs|regra|disciplina|men[çc])|inexist|apenas|somente|s[óo]\s+(tratava|previa|exigia)|gen[ée]ric|impl[íi]cit/i.test(antes);
}

/** Artigo-base de um dispositivo citado: "Art. 34-A" → "Art. 34". Pura. */
function ptArtigoBase(d) { const m = String(d || '').match(/Art\.?\s*(\d+)/i); return m ? ptIdArt(m[1]) : null; }

/** Segunda leitura: o ato alterado já tratava do assunto que a nota disse ser novo? */
function ptPromptVerificacaoAntes({ base, itens = [], inv = [], alterado = {}, pista = '' } = {}) {
  const A = ptArtigosTexto(alterado.texto || '');
  return `Você confere a análise de uma alteração normativa. Para cada dispositivo NOVO abaixo, a nota afirmou o que o ATO ALTERADO dizia antes ("antes").
${pista ? `Uma leitura anterior indicou como possível antecedente: ${pista} — mas citou um trecho que NÃO existe literalmente no ato. Copie o trecho caractere por caractere, ou responda false se não houver.\n` : ''}Sua tarefa: verificar se o ato alterado JÁ TRATAVA do mesmo assunto — leia o ARTIGO-BASE (${base} do ato alterado) inciso por inciso e parágrafo por parágrafo, e depois o restante do ato alterado.
"Mesmo assunto" = o mesmo objeto da regra, ainda que com outra força (avaliação × vedação; faculdade × obrigação) ou em outro lugar do texto.

Para cada item responda:
- "ja_tratava": true | false
- "onde": dispositivo do ato alterado (ex.: "Art. 34, § 2º, I"), se true
- "trecho_antes": cópia LITERAL e CONTÍNUA de 40 a 300 caracteres do ato alterado que prova isso (sem "[...]", sem corrigir grafia), se true
- "antes": se true, reescreva o "antes" em até 2 frases: o que o ato alterado já previa e onde; se false, repita o "antes" atual
- "diferenca": se true, uma frase: o que o dispositivo novo muda em relação ao que já havia

ITENS:
${itens.map((a, i) => {
    const ks = (a.dispositivos || []).map(ptChaveDispositivo);
    const novo = inv.filter(b => ks.includes(ptChaveDispositivo(b.id))).map(b => b.novo).join('\n');
    return `#${i + 1} ${(a.dispositivos || []).join(', ')} — tema: ${a.tema || ''}\nTEXTO NOVO:\n${novo}\n"antes" afirmado pela nota: ${a.antes || '(vazio)'}`;
  }).join('\n\n')}

ARTIGO-BASE NO ATO ALTERADO (${base}):
"""
${A[base] || '(não existe)'}
"""

ATO ALTERADO (íntegra):
"""
${alterado.texto || ''}
"""

Responda APENAS com JSON: { "itens": [ { "n": 1, "ja_tratava": false, "onde": "", "trecho_antes": "", "antes": "", "diferenca": "" } ] }`;
}

/** Trecho com reticências ("[...]", "…", "...") não é literal: fica o maior pedaço contínuo que existe na fonte (já compactada). Pura. */
function ptRepararTrecho(trecho, fonteCompacta) {
  const t = String(trecho || '');
  if (!t || fonteCompacta.includes(ptCompacto(t))) return t;
  const pedacos = t.split(/\s*(?:\[\s*(?:\.\.\.|…)\s*\]|…|\.\.\.)\s*/).map(x => x.trim()).filter(x => ptCompacto(x).length >= 25 && fonteCompacta.includes(ptCompacto(x)));
  return pedacos.sort((a, b) => b.length - a.length)[0] || t;
}

/**
 * Aplica a resposta da segunda leitura aos itens (muta e devolve o registro).
 * Só troca o "antes" com o trecho antigo achado LITERALMENTE no ato alterado;
 * sem prova, marca 'sem_prova' (e guarda o antecedente sugerido). Pura sobre os dados.
 */
function ptAplicarVerificacao(itens, resposta, alteradoTexto) {
  const A = ptCompacto(alteradoTexto);
  const log = [];
  for (const v of (resposta && Array.isArray(resposta.itens)) ? resposta.itens : []) {
    const a = itens[(Number(v && v.n) || 0) - 1];
    if (!a || !v) continue;
    const tr = ptRepararTrecho(String(v.trecho_antes || ''), A);
    if (v.ja_tratava && ptCompacto(tr).length >= 25 && A.includes(ptCompacto(tr))) {
      log.push({ dispositivos: a.dispositivos, de: a.antes, para: v.antes, onde: v.onde || '' });
      a.antes = [String(v.antes || '').trim(), String(v.diferenca || '').trim()].filter(Boolean).join(' ');
      a.trecho_antes = tr; a.verificado = 'corrigido';
    } else if (v.ja_tratava) {
      a.verificado = 'sem_prova'; a.antecedenteSugerido = String(v.onde || '').trim();
    } else a.verificado = 'confirmado';
  }
  return log;
}

/**
 * Conferência da nota técnica de ato que altera outro. Pura.
 * Cada item ganha { conferido, problemas[] }: trecho literal no ato novo; trecho
 * anterior (se houver) no ato alterado; artigos citados existem; norma citada
 * como base legal aparece no ato. Devolve o mesmo formato de ptConferirNota.
 */
function ptConferirNotaTecnica(resp, texto, alteradoTexto) {
  const r = resp && typeof resp === 'object' ? resp : {};
  const N = ptCompacto(texto), A = ptCompacto(alteradoTexto);
  const arts = ptArtigosDoTexto(texto);
  let total = 0, conferidos = 0;
  const confere = (item, op = {}) => {
    if (!item || typeof item !== 'object') return null;
    const problemas = [];
    const dispositivos = (Array.isArray(item.dispositivos) ? item.dispositivos : []).map(String).filter(Boolean);
    const artigos = (Array.isArray(item.artigos) ? item.artigos : item.artigos ? [item.artigos] : dispositivos).map(String).filter(Boolean);
    const trecho = ptRepararTrecho(String(item.trecho || '').trim(), N);
    const t = ptCompacto(trecho);
    if (t.length < 25) problemas.push('sem trecho literal do ato');
    else if (!N.includes(t)) problemas.push('trecho não localizado no ato');
    const trechoAntes = item.trecho_antes ? ptRepararTrecho(String(item.trecho_antes).trim(), A) : '';
    if (trechoAntes && ptCompacto(trechoAntes).length >= 25 && !A.includes(ptCompacto(trechoAntes))) problemas.push('trecho anterior não localizado no ato alterado');
    if (!op.dispositivo) {
      const inexist = artigos.filter(a => { const n = ptNumArtigo(a); return n && !arts.has(n); });
      if (inexist.length) problemas.push(`artigo inexistente no ato: ${inexist.join(', ')}`);
    }
    if (op.base && item.base_legal) {
      const leis = [...String(item.base_legal).matchAll(/(?:Lei(?: Complementar)?|Decreto)\s*(?:n[ºo.]*\s*)?([\d.]+)/gi)].map(m => m[1].replace(/\./g, '')).filter(n => n.length >= 3 && !N.includes(n));
      if (leis.length || (/acesso\s+[àa]\s+informa/i.test(item.base_legal) && !/acesso\s+[àa]\s+informa/i.test(texto))) problemas.push('base legal cita norma que o ato não menciona');
    }
    total++;
    if (!problemas.length) conferidos++;
    return Object.assign({}, item, { artigos, dispositivos, trecho, trecho_antes: trechoAntes, conferido: !problemas.length, problemas });
  };
  const lista = (k, op) => (Array.isArray(r[k]) ? r[k] : []).map(x => confere(x, op)).filter(Boolean);
  const nota = {
    assunto: String(r.assunto || '').trim(),
    resumo: String(r.resumo || '').trim(),
    analise: (Array.isArray(r.analise) ? r.analise : r.analise ? [r.analise] : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 6),
    objeto: null,
    alteracoes: lista('alteracoes', { dispositivo: true, base: true }).map(a => Object.assign(a, {
      tema: String(a.tema || ''), natureza: String(a.natureza || ''), antes: String(a.antes || ''), depois: String(a.depois || ''), efeito: String(a.efeito || ''),
      impactados: (Array.isArray(a.impactados) ? a.impactados : []).filter(x => x && (x.quem || x.como)).map(x => ({ quem: String(x.quem || ''), como: String(x.como || '') })),
      base_legal: String(a.base_legal || '') })),
    aplicacao_temporal: confere(r.aplicacao_temporal),
    pontos: [], aplicacao: [], valores: [], impactos: [],
    prazos: lista('prazos').map(p => Object.assign(p, { evento: p.mudou && !/prazo novo/i.test(p.mudou) && !String(p.evento || '').includes(p.mudou) ? `${p.evento || ''} (antes: ${p.mudou})` : p.evento })),
    atencao: lista('atencao'),
    vigencia: confere(r.vigencia),
    recomendacoes: (Array.isArray(r.recomendacoes) ? r.recomendacoes : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 8),
    secoes: (Array.isArray(r.secoes) ? r.secoes : []).slice(0, 8).map(x => confere(x)).filter(x => x && (x.titulo || x.texto)),
    visuais: Array.isArray(r.visuais) ? [...new Set(r.visuais.map(String).filter(v => PT_VISUAIS[v]))] : ['numeros', 'relacoes', 'prazos'],
    extensao: PT_EXTENSOES[r.extensao] ? r.extensao : 'normal',
    resposta: String(r.resposta || '').trim(),
    atoAlterado: r.atoAlterado || null,
    verificacao: r.verificacao || null,
  };
  return { nota, total, conferidos, problemas: total - conferidos };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PT_NOTA_TIPOS, PT_NOTA_LISTAS, PT_VISUAIS, PT_VISUAIS_PADRAO, PT_EXTENSOES, ptPromptNota, ptPromptRevisao, ptPromptNotaConjunta, ptNormalizarGeral, ptPromptRevisaoConjunto, ptArtigosDoTexto, ptArtigosProprios, ptNumArtigo, ptConferirNota, ptPrazoDias, ptNotaTexto,
    ptArtigosTexto, ptInventarioAlteracoes, ptChaveDispositivo, ptAgrupamentoValido, ptInventarioFaltando, ptOrdenarAlteracoes, ptPromptTecnicaGeral, ptPromptTecnicaAlteracoes,
    ptNegaRegraAnterior, ptArtigoBase, ptPromptVerificacaoAntes, ptAplicarVerificacao, ptRepararTrecho, ptConferirNotaTecnica };
}
