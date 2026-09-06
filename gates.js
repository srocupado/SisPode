// Parecer de Especialista — GATES e RUBRICA DE MÁQUINA.
//
// Cada gate nasceu de um defeito visto numa rodada real:
//   G1  lei vigente não obtida → o parecer da MPV 1357/2026 perdeu o objeto.
//   G2  síntese sem os valores da regra → "20%", "60%", "US$ 50" nunca apareceram.
//   G3  veredito acima do nível de evidência → "atingido" com 3 meses de série.
//   G4  janela curta ou mês parcial → maio/2026 entrou inteiro na janela.
//   G5  cifra por extenso → "três bilhões e quinhentos milhões" burlou a conferência.
//   G6  estimativa de outra parte do processo → os R$ 3,5 bi do Mover viraram previsão da taxa.
//   G7  série que termina antes do marco → aparecia como se fosse comparável.
// A rubrica M1–M11 é a parte mecânica do teste de aceitação; qualquer item
// reprovado impede o PDF de abrir.
//
// Script clássico (global na extensão) + module.exports para os testes.

const __fichaMod = (typeof module !== 'undefined' && typeof require === 'function') ? require('./ficha.js') : null;
const _objetoEnunciado = __fichaMod ? __fichaMod.objetoEnunciado : (typeof objetoEnunciado === 'function' ? objetoEnunciado : null);
const __teseMod = (typeof module !== 'undefined' && typeof require === 'function') ? require('./tese.js') : null;
const _secoesDoTexto = __teseMod ? __teseMod.secoesDoTexto : (typeof secoesDoTexto === 'function' ? secoesDoTexto : null);
const _TITULOS = __teseMod ? __teseMod.TITULOS : (typeof TITULOS !== 'undefined' ? TITULOS : null);
const _secoesAtivas = __teseMod ? __teseMod.secoesAtivas : (typeof secoesAtivas === 'function' ? secoesAtivas : null);
const __dossieMod = (typeof module !== 'undefined' && typeof require === 'function') ? require('./dossie.js') : null;
const _NIVEL_EVIDENCIA = __dossieMod ? __dossieMod.NIVEL_EVIDENCIA : (typeof NIVEL_EVIDENCIA !== 'undefined' ? NIVEL_EVIDENCIA : null);

const RE_EXTENSO = /\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|mil|quinhentos)\s+(?:e\s+\w+\s+)?(bilh|milh)/gi;
// "A data de efeito da medida é 12/05/2026" não é causa; "o efeito da medida foi a queda" é.
// "resultou em" solto é narrativa ("o cenário normativo resultou em lacuna");
// só vira atribuição de causa quando o sujeito é a própria matéria analisada.
const RE_CAUSAL = /\b(a (lei|medida|norma|MP|MPV) (provocou|causou|gerou|levou a|reduziu|aumentou|elevou|derrubou)|(a (lei|medida|norma|MP|MPV|proposi[çc][ãa]o)|o (projeto|texto|substitutivo|dispositivo))[^.]{0,40}resultou em|gra[çc]as [àa] (lei|medida)|em decorr[êe]ncia da (lei|medida)|por causa da (lei|medida)|(?<!data de )(efeito|impacto) da (lei|medida) (foi|é) (de |o |a |uma |um )?(aument|redu|qued|alta|elev|cresc|fort|expressiv|negativ|positiv))/i;
const RE_VOTO = /\b(recomend\w+(?:-se)? (?:o |a )?(voto|aprova|rejei)|sugere-se (?:a )?(aprova|rejei)|(?:deve|merece) ser (?:aprovad|rejeitad)|merece (?:aprova|rejei)|somos pel|opina-se pel|voto pel|orienta(?:mos|-se)? (?:pel|a favor|contra))/i;
const RE_CITACAO = /\b(ADI|ADC|ADPF|ADO|RE|ARE|AI|HC|MS|MI|RHC|REsp|AgR|Tema|S[úu]mula(\s+Vinculante)?|A[çc][ãa]o Direta de (?:In)?constitucionalidade|Argui[çc][ãa]o de Descumprimento[^\d]{0,40}|Mandado de Injun[çc][ãa]o)\s*n?[.º°]?\s*\d/i;
// O parecer AFIRMANDO o vício ("é inconstitucional", "incorre em vício de
// iniciativa") — e não a referência a inconstitucionalidade já declarada
// ("o vácuo gerado pela inconstitucionalidade das alíneas"), que é relato.
const RE_ASSERCAO = new RegExp([
  // \b não vale antes de "é" (não é [A-Za-z0-9_] em JS): a fronteira vai explícita.
  '(?:^|[\\s,;(])(?:é|são|seria|seriam|resta|restam|mostra-se|revela-se|afigura-se|reputa-se|tem-se por)\\s+(?:material|formal|manifesta|clara|patente|flagrante)?(?:mente)?\\s*inconstitucion(?:al|ais)',
  '\\b(?:incorre|padece|enseja|configura|acarreta|apresenta|contém|encerra|h[áa]|existe|verifica-se|constata-se)\\b[^.]{0,45}?(?:inconstitucionalidade|v[íi]cio\\s+de\\s+(?:iniciativa|compet[êe]ncia|forma))',
  'v[íi]cio\\s+(?:formal|material)\\s+insan[áa]vel',
  'usurpa[çc][ãa]o\\s+de\\s+compet[êe]ncia',
].join('|'), 'i');
// "declarou a inconstitucionalidade", "declaradas inconstitucionais pelo STF", "julgada inconstitucional na ADI":
// relato de decisão já tomada, não afirmação do parecer. Sai do parágrafo antes do teste do M7.
const RE_INCONST_RELATADA = /(?:declara(?:r|ção|ções|ram|ou|d[ao]s?)|julg(?:ar|ou|ad[ao]s?)|reconhec(?:er|eu|id[ao]s?)|pronunci(?:ar|ou|ad[ao]s?))\s+(?:formalmente\s+|expressamente\s+)?(?:a\s+|d[ae]\s+)?inconstitucional(?:idade)?|inconstitucional(?:idade)?\s+(?:das?|dos?|de)\s+[^.]{0,80}?(?:pelo|no)\s+(?:STF|Supremo)|(?:STF|Supremo Tribunal Federal|Supremo)[^.]{0,80}?inconstitucional(?:idade)?|A[çc][ãa]o Direta de Inconstitucionalidade/gi;
const RE_NEGACAO = /n[ãa]o\s+(se\s+)?(identifi|verifi|vislumbr|constat|h[áa]\b|se\s+afigura|parece)/i;

const RE_ATRIBUICAO = /(quem (apoia|se op[õo]e|defende|critica)|argumenta|sustenta|alega|afirma|defende|aponta|segundo (o|a|os|as) )[^.]{0,120}$/i;
// "o relator recomendou a aprovação", "o parecer opina pela rejeição": relato, não voto do parecer.
const RE_QUEM_VOTA = /\b(relator[a]?|parecer|comiss[ãa]o|manifesta[çc][ãa]o|CASP|CCJ|CFT|governo|autor[a]?|senador[a]?|deputad[oa]|l[íi]der|bancada|sindicato|entidade|confedera[çc][ãa]o|quem (apoia|se op[õo]e|defende|critica)|segundo)\b[^.]{0,160}$/i;
/**
 * Recomendações de voto que o PARECER faz fora da conclusão. Relato da posição
 * de outrem não conta; a seção "Conclusão e posicionamento sugerido" é o lugar
 * onde a assessoria recomenda, e por isso sai da varredura.
 */
function semAConclusao(texto) {
  const titulo = (_TITULOS && _TITULOS.conclusao) || 'Conclusão e posicionamento sugerido';
  const re = new RegExp(`(^|\\n)\\s*${titulo}\\s*:?\\s*(\\n|$)`, 'i');
  const m = re.exec(String(texto || ''));
  return m ? String(texto).slice(0, m.index) : String(texto || '');
}
function votosNaoAtribuidos(texto) {
  const t = semAConclusao(texto); const out = []; const re = new RegExp(RE_VOTO.source, 'gi'); let m;
  while ((m = re.exec(t)) !== null) { const antes = t.slice(Math.max(0, m.index - 160), m.index); if (!RE_QUEM_VOTA.test(antes) && !RE_ATRIBUICAO.test(antes)) out.push(t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 30).replace(/\s+/g, ' ')); }
  return out;
}
/** Parágrafos em que o PARECER afirma inconstitucionalidade (não relata decisão) sem citar precedente. */
function assercoesSemPrecedente(texto) {
  return String(texto || '').split(/\n{2,}/).filter(p => { const proprio = p.replace(RE_INCONST_RELATADA, ''); return RE_ASSERCAO.test(proprio) && !RE_NEGACAO.test(proprio) && !RE_CITACAO.test(p); });
}
/** Frases causais que o PARECER assume — exclui as relatadas como posição de um lado. */
function causaisNaoAtribuidas(texto) {
  const t = String(texto || ''); const out = []; const re = new RegExp(RE_CAUSAL.source, 'gi'); let m;
  while ((m = re.exec(t)) !== null) { if (!RE_ATRIBUICAO.test(t.slice(Math.max(0, m.index - 140), m.index))) out.push(t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 30).replace(/\s+/g, ' ')); }
  return out;
}

/**
 * Aplica os gates ao parecer montado. Devolve faixas (impressas na primeira
 * página), notas, reprovações (impedem abrir) e o texto com os rebaixamentos
 * do G3 aplicados.
 */
/**
 * A solidez da comparação, em PALAVRAS, para o leitor final. "Nível de
 * evidência C" não diz nada a deputado nem a analista; a frase abaixo diz.
 */
function fraseDoNivel(nivel, emVigor = true) {
  if (nivel === 'A') return 'Há dados oficiais com pelo menos 12 meses antes e 12 meses depois da mudança: a comparação entre antes e depois é sólida, embora não prove que a medida causou a variação.';
  if (nivel === 'B') return 'Há dados oficiais, mas com poucos meses depois da mudança ou com um mês incompleto: os números indicam uma direção, mas não permitem concluir.';
  return emVigor
    ? 'Não há dados oficiais que permitam comparar o antes e o depois da mudança: o efeito da medida não é verificável com o que existe.'
    : 'Como a proposição ainda não está em vigor, não há resultados a comparar: este parecer descreve o que o texto prevê e o que só poderá ser medido depois.';
}
const RE_NIVEL_EM_PALAVRAS = {
  A: /compara[çc][ãa]o[^.]{0,80}s[óo]lida|12 meses antes/i,
  B: /indicam uma dire[çc][ãa]o|n[ãa]o permitem concluir/i,
  C: /n[ãa]o h[áa] (?:dados|s[ée]rie)[^.]{0,120}(?:antes e (?:o )?depois|comparar)|ainda n[ãa]o est[áa] em vigor[^.]{0,80}n[ãa]o h[áa] resultados|n[ãa]o h[áa] resultados a comparar/i,
};
const RE_ROTULO_NIVEL = /\(?\bn[íi]vel de evid[êe]ncia\s*:?\s*\(?([ABC])\)?(?:\s*\([^)]{0,60}\))?\)?/gi;
const NIVEL_CURTO = { A: 'comparação sólida', B: 'comparação indicativa, não conclusiva', C: 'sem base para comparar' };

function aplicarGates({ ficha, dossie, tese, texto, nivel = 'C', validacao = null, contraditorio = null, emVigor = true } = {}) {
  const faixas = [], notas = [], reprovacoes = [], rebaixamentos = [];
  let t = String(texto || '');
  const secoes = _secoesDoTexto ? _secoesDoTexto(t) : {};

  // G1 — regra vigente
  if (ficha && ficha.faltas.includes('regra vigente')) {
    const lt = ficha.leiTentada || [];
    const desat = lt.filter(l => l.desatualizado).map(l => l.norma);
    const lidas = lt.filter(l => !l.desatualizado).map(l => l.norma);
    const causa = desat.length
      ? `o Planalto (texto compilado) não respondeu e o Senado/LexML só tem o texto original de ${desat.join(' e ')}, que não vale como regra vigente porque a norma foi alterada depois; e o documento analisado não descreve a regra atual`
      : lidas.length
        ? `o texto de ${lidas.join(' e ')} foi lido, mas nele não se localizou o dispositivo alterado; e o documento analisado não descreve a regra atual`
        : 'o Planalto e o LexML/Senado não devolveram o texto da norma alterada, e não se localizou transcrição dela no documento analisado';
    faixas.push(`PARECER INCOMPLETO — a regra vigente não foi obtida: ${causa}. As seções "Lei vigente" e "Avaliação da política" não são verificáveis.`);
  } else if (ficha && ficha.regraVigente && ficha.regraVigente.origem === 'documento') {
    notas.push('A regra vigente foi tomada da transcrição feita no próprio documento analisado (trecho conferido), porque o texto da norma não foi obtido no Planalto nem no Senado.');
  }
  if (ficha && ficha.faltas.length && !ficha.faltas.includes('regra vigente')) notas.push(`Ficha do objeto incompleta: falta ${ficha.faltas.join(', ')}.`);

  // G2 — objeto enunciado na síntese
  if (ficha && _objetoEnunciado) {
    const sint = (secoes['Síntese'] || []).join('\n');
    const r = _objetoEnunciado(sint, ficha, 2);
    if (!r.ok) reprovacoes.push({ gate: 'G2', detalhe: `A síntese não enuncia a regra em algarismos: exigidos ${r.exigidos} valores da ficha, presentes ${r.presentes.length} (${r.presentes.join(', ') || 'nenhum'}); faltam ${r.faltantes.join(', ')}.` });
  }

  // G8 — a solidez da comparação tem de estar no texto EM PALAVRAS. O rótulo
  // "nível de evidência C" sai do corpo (vira a expressão curta); se a frase
  // em palavras não estiver, o programa a insere na abertura de "Avaliação da
  // política" e registra.
  if (RE_ROTULO_NIVEL.test(t)) { t = t.replace(RE_ROTULO_NIVEL, (m, n) => NIVEL_CURTO[String(n).toUpperCase()] || m); rebaixamentos.push({ gate: 'G8', detalhe: 'Rótulo "nível de evidência" trocado pela expressão em palavras.' }); }
  if (!(RE_NIVEL_EM_PALAVRAS[nivel] || RE_NIVEL_EM_PALAVRAS.C).test(t)) {
    const frase = fraseDoNivel(nivel, emVigor);
    const tituloAval = (_TITULOS && _TITULOS.avaliacao) || 'Avaliação da política';
    const re = new RegExp(`((?:^|\\n)\\s*${tituloAval}\\s*:?\\s*\\n+)`, 'i');
    if (re.test(t)) { t = t.replace(re, `$1${frase}\n\n`); notas.push(`A frase sobre a solidez da comparação foi inserida pelo programa na abertura de "${tituloAval}": o modelo a omitiu na redação.`); rebaixamentos.push({ gate: 'G8', detalhe: 'Solidez da comparação declarada pelo programa, em palavras.' }); }
  }

  // G9 — inconstitucionalidade afirmada pelo parecer sem precedente: a redação
  // é refeita com a instrução (o modelo decreta "vulnerabilidade de
  // inconstitucionalidade material" onde o parecer só pode apontar o exame).
  for (const par of assercoesSemPrecedente(t).slice(0, 3)) {
    reprovacoes.push({ gate: 'G9', detalhe: `O parecer AFIRMA inconstitucionalidade sem precedente citado: "${par.replace(/\s+/g, ' ').slice(0, 160)}…". Reescreva o parágrafo sem decretar inconstitucionalidade ou vício: aponte o dispositivo constitucional e diga que o ponto "merece exame quanto à compatibilidade com o art. X"; só use "inconstitucional" citando precedente com classe e número (ADI, RE, Súmula) ou relatando decisão já tomada.` });
  }
  // G10 — recomendação de voto ou causa atribuída pelo próprio parecer: idem.
  for (const v of votosNaoAtribuidos(t).slice(0, 2)) reprovacoes.push({ gate: 'G10', detalhe: `Recomendação de voto do próprio parecer: "${v}". O parecer não recomenda voto: apresente a opção e as consequências; a decisão é da Liderança.` });
  for (const c of causaisNaoAtribuidas(t).slice(0, 2)) reprovacoes.push({ gate: 'G10', detalhe: `Causa atribuída pelo próprio parecer: "${c}". Não afirme que a medida causou o resultado: diga o que a série mostra e liste os fatores concorrentes; causa só como posição relatada de um lado.` });

  // G3 — veredito acima do nível (no texto final, por seção de avaliação)
  const aval = secoes['Avaliação da política'] || [];
  if (aval.length && nivel !== 'A') {
    const antes = aval.join('\n\n');
    let depois = antes;
    if (nivel === 'B') depois = depois.replace(/\bn[ãa]o atingido\b/gi, 'indícios de não atingimento').replace(/(?<!n[ãa]o )(?<!indícios de )\batingido\b/gi, 'indícios de atingimento');
    else depois = depois.replace(/\b(n[ãa]o )?atingido\b/gi, 'não verificável').replace(/\bind[íi]cios de (n[ãa]o )?atingimento\b/gi, 'não verificável');
    if (depois !== antes) { rebaixamentos.push({ gate: 'G3', detalhe: `Veredito acima do nível de evidência ${nivel} rebaixado no texto.` }); t = t.replace(antes, depois); }
  }

  // G4 — janela curta / mês parcial
  const jan = dossie?.prc?.janelas || null;
  const jd = jan?.depois || Object.values(dossie?.janelas || {}).map(j => j.depois).find(Boolean);
  if (jd && jd.meses < 12) notas.push(`Só há ${jd.meses} mês(es) de dados depois da mudança (${jd.de} a ${jd.ate}): a comparação indica uma direção, não permite concluir.`);
  if (dossie?.marco?.data && !/-01$/.test(dossie.marco.data)) notas.push(`A mudança começou em ${dossie.marco.data.split('-').reverse().join('/')}, no meio do mês: ${dossie.marco.data.slice(0, 7)} mistura os dois regimes.`);

  // G5 — cifra por extenso
  const ext = t.match(RE_EXTENSO) || [];
  if (ext.length) reprovacoes.push({ gate: 'G5', detalhe: `${ext.length} cifra(s) por extenso: "${ext[0]}…"` });

  // G6 — estimativa não vinculada usada como previsto
  const naoVinc = (dossie?.estimativas || []).filter(e => e.vinculo === false);
  if (naoVinc.length) notas.push(`Os valores ${[...new Set(naoVinc.map(e => e.literal))].join(', ')} que aparecem no processo referem-se a outra parte da matéria, não a esta medida.`);

  // G7 — série que termina antes do marco
  for (const [k, j] of Object.entries(dossie?.janelas || {})) if (j.antes && !j.depois) notas.push(`A série de ${j.rotulo || k} termina em ${j.antes.ate}, antes da mudança: não serve para comparar.`);

  // G9/G10 — as contagens da tese e do contraditório ficam na seção de
  // conferência, não na primeira página: são do método, não do leitor.

  return { faixas, notas, reprovacoes, rebaixamentos, texto: t };
}

/** Rubrica mecânica M1–M11. Qualquer item reprovado impede o PDF de abrir. */
/** Chave curta de uma emenda/substitutivo ("EMP 1", "SBT-A 2", "EMS") para procurar no texto. */
function chaveDaEmenda(rotulo) {
  const m = /\b(EMP|EMC|EMS|EMR|EMA|SBT-?A?|SSP|SBE|PRLP|PRLE|PLV|EMENDA(?:\s+DE\s+PLENÁRIO)?|SUBEMENDA|SUBSTITUTIVO)\s*(?:N[ºo.]?\s*)?(\d+)?/i.exec(String(rotulo || ''));
  if (!m) return null;
  return { sigla: m[1].toUpperCase().replace(/\s+/g, ' '), numero: m[2] || null };
}
function emendaCitada(texto, ch) {
  if (!ch) return true;
  const t = String(texto || '');
  const sigla = ch.sigla.replace(/-/g, '-?').replace(/\s+/g, '\\s+');
  return ch.numero ? new RegExp(`\\b${sigla}\\s*(?:n[ºo.]?\\s*)?${ch.numero}\\b|emenda[^.]{0,20}\\bn[ºo.]?\\s*${ch.numero}\\b`, 'i').test(t) : new RegExp(`\\b${sigla}\\b`, 'i').test(t);
}

function rubricaMaquina({ texto, ficha, tese, dossie, nivel = 'C', conferencia = null, gates = null, temSerie = false, processo = null, temComparada = false } = {}) {
  const t = String(texto || '');
  const secoes = _secoesDoTexto ? _secoesDoTexto(t) : {};
  const itens = [];
  const add = (ok, item, detalhe) => itens.push({ ok: !!ok, item, detalhe: ok ? null : (detalhe || null) });

  add(ficha && ficha.regraVigente && ficha.regraProposta && ficha.dataEfeito && (!ficha.quantitativa || ficha.valores.length >= 2), 'M1 Ficha do objeto com regra vigente, regra proposta e data de efeito (e dois valores quando a regra é numérica)', ficha ? `falta ${ficha.faltas.join(', ') || '—'}` : 'sem ficha');
  add(!(conferencia?.numerosSuspeitos?.length), 'M2 Nenhum número fora da base (achados, dossiê, lei, ficha)', conferencia?.numerosSuspeitos?.length ? conferencia.numerosSuspeitos.map(s => s.numero).join(', ') : null);
  add(!(conferencia?.semEvidencia?.length) && !(conferencia?.idsInexistentes?.length), 'M3 Todo parágrafo de síntese, avaliação, dois lados e opções cita evidência existente', [conferencia?.semEvidencia?.length ? `${conferencia.semEvidencia.length} parágrafo(s) sem evidência` : '', conferencia?.idsInexistentes?.length ? `identificadores inexistentes: ${conferencia.idsInexistentes.join(', ')}` : ''].filter(Boolean).join('; '));
  const aval = (secoes['Avaliação da política'] || []).join(' ');
  const proibidos = nivel === 'A' ? [] : nivel === 'B' ? [/(?<!n[ãa]o )(?<!indícios de )\batingido\b/i, /\bn[ãa]o atingido\b/i] : [/\batingido\b/i, /\bind[íi]cios de/i];
  add(!proibidos.some(re => re.test(aval)), `M4 Vereditos compatíveis com a solidez da comparação (nível ${nivel})`);
  const chaves = _secoesAtivas ? _secoesAtivas(tese || {}, { temSerie }) : Object.keys(_TITULOS || {});
  const ordem = chaves.map(k => (_TITULOS || {})[k]).filter(Boolean);
  const posicoes = ordem.map(s => t.search(new RegExp(`(^|\\n)\\s*${s}\\s*:?\\s*(\\n|$)`, 'i')));
  const faltantes = ordem.filter((s, i) => posicoes[i] < 0);
  const emOrdem = posicoes.filter(p => p >= 0).every((p, i, a) => i === 0 || p > a[i - 1]);
  add(!faltantes.length && emOrdem, 'M5 Seções fixas presentes e na ordem', faltantes.length ? `faltam: ${faltantes.join('; ')}` : 'fora de ordem');
  add(!temSerie || !!(dossie?.prc?.janelas?.antes || Object.values(dossie?.janelas || {}).some(j => j.antes && j.depois)), 'M6 Tabelas de dados presentes quando há série');
  const paragrafos = t.split(/\n{2,}/);
  const semCit = assercoesSemPrecedente(t);
  add(!semCit.length, 'M7 Nenhuma afirmação de inconstitucionalidade sem precedente citado', semCit.length ? `"${semCit[0].slice(0, 100)}…"` : null);
  add(!(t.match(RE_EXTENSO) || []).length, 'M8 Nenhuma cifra por extenso');
  add(!ficha || !ficha.faltas.includes('regra vigente') || (gates?.faixas || []).some(f => /INCOMPLETO/.test(f)), 'M9 Faixa de incompletude impressa quando falta insumo essencial');
  add((RE_NIVEL_EM_PALAVRAS[nivel] || RE_NIVEL_EM_PALAVRAS.C).test(t) && !RE_ROTULO_NIVEL.test(t), `M10 Solidez da comparação dita em palavras no texto, sem o rótulo "nível ${nivel}"`);
  // Causalidade ATRIBUÍDA A UM LADO ("quem apoia argumenta que a medida
  // aumentou…") é relato da posição alheia, não afirmação do parecer.
  const causaisProprias = causaisNaoAtribuidas(t);
  const votosProprios = votosNaoAtribuidos(t);
  add(!causaisProprias.length && !votosProprios.length, 'M11 Sem atribuição causal própria; recomendação de voto só na conclusão', causaisProprias.length ? `verbo causal: "${causaisProprias[0]}"` : votosProprios.length ? `recomendação fora da conclusão: "${votosProprios[0]}"` : null);
  // M13 — a conclusão da tese chegou ao texto, com posição e com o que a mudaria.
  if (tese && tese.conclusao) {
    const c = tese.conclusao;
    const secConc = (secoes[(_TITULOS || {}).conclusao] || []).join(' ');
    add(secConc.length > 80 && (c.contestada || /mudar|rever|alterar|deixar de|passar a/i.test(secConc)), 'M13 Conclusão escrita, com a posição e o que a mudaria',
      secConc.length <= 80 ? 'seção de conclusão vazia ou curta demais' : 'a conclusão não diz o que faria a assessoria mudar de posição');
  }
  // M12 — o que o módulo de Plenário sabe tem de estar no texto: relator pelo nome, cada emenda/substitutivo.
  if (processo && (processo.relator?.nome || (processo.emendas || []).length)) {
    const faltam = [];
    if (processo.relator?.nome) {
      const partes = String(processo.relator.nome).replace(/\(.*?\)/g, '').split(/\s+/).filter(x => x.length >= 4 && !/^(dep|deputad[oa]|sen|senador[a]?)\.?$/i.test(x));
      const sobrenome = partes[partes.length - 1];
      if (sobrenome && !new RegExp(sobrenome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t)) faltam.push(`relator(a) ${processo.relator.nome}`);
    }
    for (const e of processo.emendas || []) { const ch = chaveDaEmenda(e.rotulo); if (ch && !emendaCitada(t, ch)) faltam.push(e.rotulo); }
    add(!faltam.length, 'M12 Contexto nomeia o(a) relator(a) e cada emenda ou substitutivo da tramitação', faltam.length ? `não citados: ${faltam.slice(0, 6).join('; ')}` : null);
  }
  const pendentes = itens.filter(i => !i.ok);
  return { itens, pendentes, aprovado: !pendentes.length, resumo: pendentes.length ? `${pendentes.length} de ${itens.length} itens da rubrica reprovados.` : `Os ${itens.length} itens mecânicos da rubrica foram satisfeitos.` };
}

const RUBRICA_HUMANA = [
  'H1 A síntese responde o que a proposição quer, se tem como conseguir, o que custa, quem ganha e quem perde, e o que a Liderança decide.',
  'H2 O contexto histórico está correto: quem propôs, quem relatou, quem votou o quê, quando.',
  'H3 Os dois lados aparecem no melhor de cada um, e o texto diz o que a evidência sustenta de cada lado.',
  'H4 As opções têm consequências específicas do caso, não genéricas.',
  'H5 Um leitor sem conhecimento do tema entende o objeto em cinco minutos.',
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { aplicarGates, rubricaMaquina, causaisNaoAtribuidas, votosNaoAtribuidos, assercoesSemPrecedente, chaveDaEmenda, emendaCitada, fraseDoNivel, RUBRICA_HUMANA, RE_EXTENSO, RE_CAUSAL, RE_VOTO, RE_CITACAO, RE_ASSERCAO, RE_NEGACAO };
}
