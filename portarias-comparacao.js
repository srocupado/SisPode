'use strict';
// Orçamento · Comparador de Portarias — NOTA COMPARATIVA (etapa 2).
//
// "Se é um sistema comparativo, ele precisa avaliar todos os prismas
// alterados." Por isso não há lista fixa de temas: os temas saem dos próprios
// atos (títulos, capítulos e seções), unificados numa só lista, com "Outros"
// para o que não couber. E cada ato é lido INTEIRO, em partes.
//
// O caminho, todo conferido contra o texto:
//  1. pares — cada ato é comparado com o que ele muda: se REVOGA um ato da
//     lista, é substituição (o regulamento inteiro, tema a tema); se ALTERA,
//     é alteração (cada dispositivo mudado); sem relação, é instrumento novo.
//     O analista pode trocar o par na lista ("Comparar com").
//  2. temas — a IA unifica os títulos/capítulos/seções de todos os atos.
//  3. extração — cada parte de cada ato vira uma lista de regras, cada uma com
//     tema, artigo e trecho literal (conferido).
//  4. comparação — por par e por grupo de temas: nova / alterada / suprimida
//     (e as mantidas, contadas), com o trecho de ANTES conferido no ato
//     anterior e o de DEPOIS no posterior.
//  5. síntese — resumo e destaques, escritos SÓ sobre as mudanças já conferidas.
// Versões consolidadas (com "Redação dada pela…") já trazem o texto novo: a
// redação anterior de um dispositivo alterado pode não estar no conjunto, e a
// nota diz isso em vez de supor.

const PC_PARTE = 45000;          // caracteres por parte na extração (~12 mil tokens)
const PC_LOTE_COMPARACAO = 50000; // regras de antes+depois por chamada de comparação
const PC_TIPOS = { nova: 'Nova', alterada: 'Alterada', suprimida: 'Suprimida', mantida: 'Mantida' };

function pcCompacto(s) { return String(s ?? '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function pcNumArt(a) { const m = String(a || '').match(/Art(?:igo)?\.?\s*(\d+)/i); return m ? String(+m[1]) : null; }
function pcArtigos(texto) { const s = new Set(); for (const m of String(texto || '').matchAll(/\bArt(?:igo)?\.?\s*(\d+)/gi)) s.add(String(+m[1])); return s; }

/** Títulos/capítulos/seções do ato, com o nome (que costuma vir na linha seguinte). Pura. */
function pcEstrutura(texto) {
  const linhas = String(texto || '').split('\n').map(l => l.trim());
  const out = [];
  const re = /^(T[ÍI]TULO|CAP[ÍI]TULO|Se[çc][ãa]o|SE[ÇC][ÃA]O|Subse[çc][ãa]o|SUBSE[ÇC][ÃA]O)\s+([IVXLC]+(?:-[A-Z])?|[ÚU]NIC[OA])\b\s*[-–—]?\s*(.*)$/;
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(re);
    if (!m) continue;
    let nome = m[3];
    if (!nome && linhas[i + 1] && !/^Art\./i.test(linhas[i + 1]) && !re.test(linhas[i + 1])) nome = linhas[i + 1];
    if (nome) out.push(`${m[1]} ${m[2]} — ${nome}`.replace(/\s+/g, ' ').slice(0, 140));
  }
  return [...new Set(out)];
}

/** Partes do texto, cortadas em início de artigo. Pura. */
function pcPartes(texto, max = PC_PARTE) {
  const t = String(texto || '');
  if (t.length <= max) return [t];
  const partes = [];
  let ini = 0;
  while (ini < t.length) {
    let fim = Math.min(t.length, ini + max);
    if (fim < t.length) {
      const janela = t.slice(ini + Math.floor(max * 0.6), fim);
      const ult = [...janela.matchAll(/\n\s*Art\.\s*\d/g)].pop();
      if (ult) fim = ini + Math.floor(max * 0.6) + ult.index + 1;
    }
    partes.push(t.slice(ini, fim));
    ini = fim;
  }
  return partes;
}

/**
 * Pares de comparação. Pura. docs na ordem cronológica; seq = ptSequencia(docs).
 * d.comparaCom: 'auto' (padrão) | id de outro ato | 'nenhum'.
 * Devolve [{ id, baseId|null, modo: 'inicial'|'substituicao'|'alteracao'|'novo', motivo }].
 */
function pcPares(docs, seq) {
  const chaveDe = d => (seq.atos.find(a => a.id === d.id) || {}).chave;
  const porChave = new Map(docs.map(d => [chaveDe(d), d]));
  return docs.map((d, i) => {
    const a = seq.atos.find(x => x.id === d.id) || { revoga: [], altera: [] };
    const manual = d.comparaCom && d.comparaCom !== 'auto';
    if (manual) {
      if (d.comparaCom === 'nenhum') return { id: d.id, baseId: null, modo: 'novo', motivo: 'definido pelo analista' };
      const b = docs.find(x => String(x.id) === String(d.comparaCom));
      if (b) {
        const altera = a.altera.some(x => x.chave === chaveDe(b));
        return { id: d.id, baseId: b.id, modo: altera ? 'alteracao' : 'substituicao', motivo: 'definido pelo analista' };
      }
    }
    const rev = a.revoga.find(x => porChave.has(x.chave));
    if (rev) return { id: d.id, baseId: porChave.get(rev.chave).id, modo: 'substituicao', motivo: `revoga ${rev.chave}` };
    const alt = a.altera.find(x => porChave.has(x.chave));
    if (alt) return { id: d.id, baseId: porChave.get(alt.chave).id, modo: 'alteracao', motivo: `altera ${alt.chave}` };
    const fora = a.altera[0] || a.revoga[0];
    // O primeiro ato da sequência, sem base, é o ponto de partida: é o "como era".
    if (i === 0 && !a.altera[0]) return { id: d.id, baseId: null, modo: 'inicial', motivo: 'ponto de partida da sequência' };
    return { id: d.id, baseId: null, modo: fora && a.altera[0] ? 'alteracao' : 'novo',
      motivo: fora ? `${a.altera[0] ? 'altera' : 'revoga'} ${fora.chave}, que não está na lista` : 'sem relação com os demais atos' };
  });
}

// ---------- prompts ----------

const PC_REGRAS_LITERAIS = `- "trecho": cópia LITERAL de 40 a 300 caracteres do texto, sem reticências no meio, sem corrigir grafia.
- "artigos": ex.: ["Art. 5º, § 2º"]. Sem artigo e trecho, não inclua o item.
- Use SOMENTE o texto fornecido. Não complete com conhecimento externo.`;

function pcPromptTemas(atos) {
  return `Você organiza a comparação de atos normativos sobre transferências da União (convênios, contratos de repasse e afins).
Abaixo, a estrutura (títulos, capítulos e seções) de cada ato da sequência.
Monte UMA lista de temas que cubra TODOS os assuntos de TODOS os atos, para comparar como cada assunto era e como ficou.
- Una os equivalentes (ex.: "Da Prestação de Contas" e "Prestação de contas final" são o mesmo tema).
- Entre 10 e 30 temas, nomes curtos e neutros, na ordem do ciclo do instrumento quando houver.
- Inclua por último o tema "Outros".

${atos.map(a => `ATO: ${a.identificacao}\n${a.estrutura.length ? a.estrutura.map(e => '- ' + e).join('\n') : '(sem divisão em capítulos; ementa: ' + (a.ementa || '') + ')'}`).join('\n\n')}

Responda APENAS com JSON: { "temas": [ { "nome": "…", "descricao": "o que entra neste tema" } ] }`;
}

function pcPromptExtracao({ identificacao, temas, parte, i, n, modo }) {
  return `Você extrai TODAS as regras de um ato normativo, para uma comparação "como era × como ficou".
Ato: ${identificacao} — parte ${i} de ${n}.${modo === 'alteracao' ? `
Este ato ALTERA outro: liste cada dispositivo que ele inclui, altera ou revoga no ato alterado ("passa a vigorar com…", "acrescido", "revogado"),
dizendo em "regra" qual dispositivo do ato alterado muda e o que passa a dizer.` : ''}
Temas (use exatamente um destes nomes em "tema"): ${temas.map(t => t.nome).join(' | ')}

Liste cada regra com conteúdo normativo (quem, o quê, prazo, valor, condição, vedação, procedimento). Agrupe incisos
de um mesmo artigo quando forem uma só regra. Não pule capítulos: o objetivo é cobrir o ato inteiro.
${PC_REGRAS_LITERAIS}

Responda APENAS com JSON: { "regras": [ { "tema": "…", "aspecto": "rótulo curto (ex.: prazo de análise da proposta)", "regra": "o que o ato estabelece, em uma frase", "artigos": ["…"], "trecho": "…" } ] }

TEXTO (parte ${i} de ${n}):
"""
${parte}
"""`;
}

function pcPromptComparar({ antes, depois, temas, modo }) {
  const fmt = rs => rs.map(r => `[${r.tema}] ${r.aspecto}: ${r.regra} (${(r.artigos || []).join('; ')}) «${r.trecho}»`).join('\n');
  return `Compare como as regras ERAM e como FICARAM, nos temas: ${temas.join(' | ')}.
ANTES: ${antes.identificacao}
DEPOIS: ${depois.identificacao} (${modo === 'alteracao' ? 'ato que ALTERA o anterior: as regras de DEPOIS são as mudanças que ele faz; o que ele não menciona continua como estava' : 'ato que SUBSTITUI o anterior'})
${modo === 'alteracao' ? 'Atenção: o ANTES pode ser versão consolidada e já trazer a redação nova; se a redação anterior não estiver no ANTES, deixe "antes" vazio e diga isso em "efeito".\n' : ''}
Para cada aspecto, classifique:
- "nova": existe só no DEPOIS;  - "suprimida": existia no ANTES e não existe mais (só em substituição);
- "alterada": existe nos dois, com mudança de conteúdo (prazo, valor, responsável, exigência, procedimento…);
- "mantida": igual em substância — só conte, em "mantidas".
Avalie TODOS os aspectos das duas listas nesses temas; não escolha só os principais.
Em "trecho_antes" e "trecho_depois" copie o trecho LITERAL que está nas listas abaixo (o que vem entre « »), sem alterar.

Responda APENAS com JSON:
{ "mudancas": [ { "tema": "…", "aspecto": "…", "tipo": "nova|alterada|suprimida", "antes": "como era (vazio se nova)", "depois": "como ficou (vazio se suprimida)",
    "artigos_antes": ["…"], "artigos_depois": ["…"], "trecho_antes": "…", "trecho_depois": "…", "efeito": "consequência prática, em uma frase" } ],
  "mantidas": [ { "tema": "…", "aspecto": "…" } ] }

REGRAS DO ANTES:
${fmt(antes.regras) || '(nenhuma neste tema)'}

REGRAS DO DEPOIS:
${fmt(depois.regras) || '(nenhuma neste tema)'}`;
}

function pcPromptNovo({ ato, regras, temas }) {
  return `O ato abaixo é um INSTRUMENTO NOVO na sequência (não substitui nem altera outro ato da lista).
Ato: ${ato.identificacao}
Para cada tema em que ele tem regras, resuma o que ele estabelece, usando só as regras listadas e copiando o trecho entre « ».
Temas: ${temas.join(' | ')}

Responda APENAS com JSON: { "mudancas": [ { "tema": "…", "aspecto": "…", "tipo": "nova", "antes": "", "depois": "o que estabelece", "artigos_antes": [], "artigos_depois": ["…"], "trecho_antes": "", "trecho_depois": "…", "efeito": "…" } ], "mantidas": [] }

REGRAS:
${regras.map(r => `[${r.tema}] ${r.aspecto}: ${r.regra} (${(r.artigos || []).join('; ')}) «${r.trecho}»`).join('\n')}`;
}

function pcPromptSintese({ atos, pares, resumoPorTema, destaquesCandidatos, tipo }) {
  return `Você redige a síntese de uma NOTA TÉCNICA COMPARATIVA sobre a evolução de atos normativos (convênios e transferências da União).
Use SOMENTE as mudanças listadas (já conferidas no texto dos atos). Não acrescente números, prazos ou valores que não estejam nelas.

Atos, em ordem: ${atos.map(a => a.identificacao).join(' → ')}
Comparações: ${pares.map(p => p.rotulo).join('; ')}

Mudanças por tema (novas/alteradas/suprimidas):
${resumoPorTema}

Mudanças (amostra das mais relevantes):
${destaquesCandidatos}

Responda APENAS com JSON:
{ "resumo": "2 parágrafos: o que mudou na regulação ao longo da sequência",
  "destaques": [ { "titulo": "curto", "texto": "o que mudou e o efeito prático", "tema": "…" } ],
  ${tipo === 'tecnica' ? '"atencao": [ "ponto de atenção para o gabinete" ], "recomendacoes": [ "ação recomendada" ],' : ''}
  "visuais": ${JSON.stringify(PC_VISUAIS_PADRAO)}, "extensao": "normal", "secoes": [] }
No máximo 8 destaques.`;
}

// ---------- conferência ----------

function pcConfereRegras(regras, texto, temas) {
  const fonte = pcCompacto(texto), arts = pcArtigos(texto);
  const nomes = new Set((temas || []).map(t => t.nome));
  return (Array.isArray(regras) ? regras : []).filter(r => r && typeof r === 'object').map(r => {
    const t = pcCompacto(r.trecho);
    const artigos = (Array.isArray(r.artigos) ? r.artigos : r.artigos ? [r.artigos] : []).map(String);
    const problemas = [];
    if (t.length < 25) problemas.push('sem trecho literal');
    else if (!fonte.includes(t)) problemas.push('trecho não localizado no ato');
    if (artigos.some(a => pcNumArt(a) && !arts.has(pcNumArt(a)))) problemas.push('artigo inexistente');
    return { tema: nomes.has(r.tema) ? r.tema : 'Outros', aspecto: String(r.aspecto || '').trim(), regra: String(r.regra || '').trim(),
      artigos, trecho: String(r.trecho || '').trim(), conferido: !problemas.length, problemas };
  });
}

/** Confere as mudanças: trecho de antes no ato anterior, de depois no posterior. Pura. */
function pcConfereMudancas(resp, textoAntes, textoDepois, temas) {
  const fa = pcCompacto(textoAntes), fd = pcCompacto(textoDepois);
  const nomes = new Set((temas || []).map(t => t.nome));
  const r = resp && typeof resp === 'object' ? resp : {};
  const ok = (fonte, trecho) => { const t = pcCompacto(trecho); return t.length >= 25 && fonte.includes(t); };
  const mudancas = (Array.isArray(r.mudancas) ? r.mudancas : []).filter(m => m && PC_TIPOS[m.tipo] && m.tipo !== 'mantida').map(m => {
    const problemas = [];
    if (m.tipo !== 'nova' && m.trecho_antes && !ok(fa, m.trecho_antes)) problemas.push('trecho de antes não localizado');
    if (m.tipo !== 'nova' && !m.trecho_antes && m.antes) problemas.push('sem trecho de antes');
    if (m.tipo !== 'suprimida' && !ok(fd, m.trecho_depois)) problemas.push('trecho de depois não localizado');
    return { tema: nomes.has(m.tema) ? m.tema : 'Outros', aspecto: String(m.aspecto || '').trim(), tipo: m.tipo,
      antes: String(m.antes || '').trim(), depois: String(m.depois || '').trim(),
      artigos_antes: [].concat(m.artigos_antes || []).map(String), artigos_depois: [].concat(m.artigos_depois || []).map(String),
      trecho_antes: String(m.trecho_antes || '').trim(), trecho_depois: String(m.trecho_depois || '').trim(),
      efeito: String(m.efeito || '').trim(), conferido: !problemas.length, problemas };
  });
  const mantidas = (Array.isArray(r.mantidas) ? r.mantidas : []).filter(Boolean).map(m => ({ tema: nomes.has(m.tema) ? m.tema : 'Outros', aspecto: String(m.aspecto || '') }));
  return { mudancas, mantidas };
}

/** Lotes de temas para comparação, cabendo em PC_LOTE_COMPARACAO caracteres. Pura. */
function pcLotes(temas, regrasAntes, regrasDepois, max = PC_LOTE_COMPARACAO) {
  const tam = r => (r.aspecto + r.regra + r.trecho).length + 40;
  const lotes = [];
  let atual = { temas: [], antes: [], depois: [], tam: 0 };
  for (const t of temas) {
    const a = regrasAntes.filter(r => r.tema === t), d = regrasDepois.filter(r => r.tema === t);
    if (!a.length && !d.length) continue;
    const s = [...a, ...d].reduce((x, r) => x + tam(r), 0);
    if (atual.temas.length && atual.tam + s > max) { lotes.push(atual); atual = { temas: [], antes: [], depois: [], tam: 0 }; }
    atual.temas.push(t); atual.antes.push(...a); atual.depois.push(...d); atual.tam += s;
  }
  if (atual.temas.length) lotes.push(atual);
  return lotes;
}

// ---------- visuais e nota ----------

const PC_VISUAIS = {
  linha: 'Linha do tempo dos atos (revoga / altera)',
  placar: 'Placar de mudanças por comparação',
  calor: 'Mapa de calor: temas × comparações',
  quadro: 'Quadro "como era × como ficou"',
  consolidacao: 'Alterações posteriores registradas em cada ato',
  tamanho: 'Tamanho dos atos (artigos)',
};
const PC_VISUAIS_PADRAO = ['linha', 'placar', 'calor', 'quadro'];

/** Matriz tema × par com contagem por tipo. Pura. */
function pcMatriz(comparacoes) {
  const temas = [], m = {};
  for (const c of comparacoes) for (const x of c.mudancas) {
    if (!temas.includes(x.tema)) temas.push(x.tema);
    const k = x.tema + '|' + c.parId;
    m[k] = m[k] || { nova: 0, alterada: 0, suprimida: 0, total: 0 };
    m[k][x.tipo]++; m[k].total++;
  }
  return { temas, celula: (tema, parId) => m[tema + '|' + parId] || { nova: 0, alterada: 0, suprimida: 0, total: 0 } };
}

/** Texto corrido da nota comparativa (copiar/colar). Pura. */
function pcNotaTexto(nota, comparacoes, meta = {}) {
  const L = [`NOTA ${meta.tipo === 'tecnica' ? 'TÉCNICA' : 'INFORMATIVA'} COMPARATIVA`];
  if (meta.atos) L.push('Atos: ' + meta.atos.join(' → '));
  let n = 0;
  const sec = t => { L.push(''); L.push(`${++n}. ${t.toUpperCase()}`); };
  if (nota.resumo) { sec('Resumo'); L.push(nota.resumo); }
  if ((nota.destaques || []).length) { sec('Principais mudanças'); nota.destaques.forEach(d => L.push(`- ${d.titulo}: ${d.texto}`)); }
  for (const c of comparacoes) {
    sec(c.rotulo);
    const porTema = {};
    c.mudancas.forEach(x => (porTema[x.tema] = porTema[x.tema] || []).push(x));
    for (const [t, xs] of Object.entries(porTema)) {
      L.push(`  ${t}`);
      xs.forEach(x => L.push(`  - [${PC_TIPOS[x.tipo]}] ${x.aspecto}: ${x.antes ? 'antes: ' + x.antes + ' ' : ''}${x.depois ? '→ depois: ' + x.depois : ''}${
        x.artigos_depois.length ? ` (${x.artigos_depois.join('; ')})` : x.artigos_antes.length ? ` (${x.artigos_antes.join('; ')})` : ''}${x.conferido ? '' : ' [conferir]'}`));
    }
  }
  for (const s of nota.secoes || []) { sec(s.titulo || 'Complemento'); L.push(s.texto || ''); }
  if ((nota.atencao || []).length) { sec('Pontos de atenção'); nota.atencao.forEach(x => L.push('- ' + x)); }
  if ((nota.recomendacoes || []).length) { sec('Recomendações'); nota.recomendacoes.forEach(x => L.push('- ' + x)); }
  return L.join('\n');
}

/** Normaliza a síntese (e a revisão dela). Pura. */
function pcNormalizarSintese(r) {
  r = r && typeof r === 'object' ? r : {};
  const lst = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
  return {
    resumo: String(r.resumo || '').trim(),
    destaques: lst(r.destaques, 12).filter(d => d && (d.titulo || d.texto)).map(d => ({ titulo: String(d.titulo || ''), texto: String(d.texto || ''), tema: String(d.tema || '') })),
    atencao: lst(r.atencao, 10).map(String), recomendacoes: lst(r.recomendacoes, 10).map(String),
    secoes: lst(r.secoes, 8).filter(s => s && (s.titulo || s.texto)).map(s => ({ titulo: String(s.titulo || ''), texto: String(s.texto || '') })),
    visuais: Array.isArray(r.visuais) ? [...new Set(r.visuais.map(String).filter(v => PC_VISUAIS[v]))] : PC_VISUAIS_PADRAO.slice(),
    extensao: ['curta', 'normal', 'detalhada'].includes(r.extensao) ? r.extensao : 'normal',
    temasOcultos: lst(r.temasOcultos, 40).map(String),
    resposta: String(r.resposta || '').trim(),
  };
}

/** Revisão da nota comparativa: só a camada redigida (síntese, seções, visuais, extensão, temas exibidos). */
function pcPromptRevisao({ nota, pedido, historico = [], temas = [], resumoPorTema = '' }) {
  const { resposta, ...atual } = nota;
  return `Você revisa a síntese de uma NOTA TÉCNICA COMPARATIVA de atos normativos.
O analista pediu: <<<${String(pedido || '').trim()}>>>
${historico.length ? `Pedidos anteriores, já atendidos (mantenha-os): ${historico.map(h => `«${h}»`).join('; ')}.\n` : ''}
O que você pode mudar: "resumo", "destaques", "atencao", "recomendacoes", "secoes" (parágrafos extras: {titulo, texto}),
"extensao" (curta | normal | detalhada), "visuais" (escolha entre ${Object.entries(PC_VISUAIS).map(([k, v]) => `${k} = ${v}`).join('; ')})
e "temasOcultos" (temas a não detalhar no quadro, se o analista pedir foco). Os quadros de mudanças tema a tema vêm da comparação conferida e não mudam aqui.
Use só as mudanças resumidas abaixo; não invente números, prazos ou valores. Altere só o que o pedido exige.
Inclua "resposta": uma frase sobre o que mudou (ou por que não foi possível).

Temas disponíveis: ${temas.join(' | ')}
Mudanças por tema: ${resumoPorTema}

SÍNTESE ATUAL (JSON): ${JSON.stringify(atual)}

Responda APENAS com o JSON completo revisado.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PC_PARTE, PC_TIPOS, PC_VISUAIS, PC_VISUAIS_PADRAO, pcEstrutura, pcPartes, pcPares, pcPromptTemas, pcPromptExtracao,
    pcPromptComparar, pcPromptNovo, pcPromptSintese, pcConfereRegras, pcConfereMudancas, pcLotes, pcMatriz, pcNotaTexto,
    pcNormalizarSintese, pcPromptRevisao };
}
