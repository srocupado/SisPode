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

const RE_EXTENSO = /\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|mil|quinhentos)\s+(?:e\s+\w+\s+)?(bilh|milh)/gi;
// "A data de efeito da medida é 12/05/2026" não é causa; "o efeito da medida foi a queda" é.
const RE_CAUSAL = /\b(a (lei|medida|norma|MP|MPV) (provocou|causou|gerou|levou a|reduziu|aumentou|elevou|derrubou)|resultou em|gra[çc]as [àa] (lei|medida)|em decorr[êe]ncia da (lei|medida)|por causa da (lei|medida)|(?<!data de )(efeito|impacto) da (lei|medida) (foi|é) (de |o |a |uma |um )?(aument|redu|qued|alta|elev|cresc|fort|expressiv|negativ|positiv))/i;
const RE_VOTO = /\b(recomend\w+ (o |a )?(voto|aprova|rejei)|somos pel|opina-se pel|voto pel|orienta(?:mos|-se)? (?:pel|a favor|contra))/i;
const RE_CITACAO = /\b(ADI|ADC|ADPF|ADO|RE|ARE|AI|HC|MS|MI|RHC|REsp|AgR|Tema|S[úu]mula(\s+Vinculante)?)\s*n?[.º°]?\s*\d/i;
const RE_ASSERCAO = /inconstitucional|v[íi]cio\s+de\s+(iniciativa|compet[êe]ncia|forma)|usurpa[çc][ãa]o\s+de\s+compet[êe]ncia/i;
const RE_NEGACAO = /n[ãa]o\s+(se\s+)?(identifi|verifi|vislumbr|constat|h[áa]\b|se\s+afigura|parece)/i;

const RE_ATRIBUICAO = /(quem (apoia|se op[õo]e|defende|critica)|argumenta|sustenta|alega|afirma|defende|aponta|segundo (o|a|os|as) )[^.]{0,120}$/i;
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
function aplicarGates({ ficha, dossie, tese, texto, nivel = 'C', validacao = null, contraditorio = null } = {}) {
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
function rubricaMaquina({ texto, ficha, tese, dossie, nivel = 'C', conferencia = null, gates = null, temSerie = false } = {}) {
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
  const ordem = Object.entries(_TITULOS || {}).filter(([k]) => k !== 'aconteceu' || temSerie).map(([, v]) => v);
  const posicoes = ordem.map(s => t.search(new RegExp(`(^|\\n)\\s*${s}\\s*:?\\s*(\\n|$)`, 'i')));
  const faltantes = ordem.filter((s, i) => posicoes[i] < 0);
  const emOrdem = posicoes.filter(p => p >= 0).every((p, i, a) => i === 0 || p > a[i - 1]);
  add(!faltantes.length && emOrdem, 'M5 Seções fixas presentes e na ordem', faltantes.length ? `faltam: ${faltantes.join('; ')}` : 'fora de ordem');
  add(!temSerie || !!(dossie?.prc?.janelas?.antes || Object.values(dossie?.janelas || {}).some(j => j.antes && j.depois)), 'M6 Tabelas de dados presentes quando há série');
  const paragrafos = t.split(/\n{2,}/);
  const semCit = paragrafos.filter(p => RE_ASSERCAO.test(p) && !RE_NEGACAO.test(p) && !RE_CITACAO.test(p));
  add(!semCit.length, 'M7 Nenhuma afirmação de inconstitucionalidade sem precedente citado', semCit.length ? `"${semCit[0].slice(0, 100)}…"` : null);
  add(!(t.match(RE_EXTENSO) || []).length, 'M8 Nenhuma cifra por extenso');
  add(!ficha || !ficha.faltas.includes('regra vigente') || (gates?.faixas || []).some(f => /INCOMPLETO/.test(f)), 'M9 Faixa de incompletude impressa quando falta insumo essencial');
  add(new RegExp(`n[íi]vel de evid[êe]ncia\\s*:?\\s*${nivel}\\b`, 'i').test(t), `M10 Solidez da comparação (nível ${nivel}) declarada no texto`);
  // Causalidade ATRIBUÍDA A UM LADO ("quem apoia argumenta que a medida
  // aumentou…") é relato da posição alheia, não afirmação do parecer.
  const causaisProprias = causaisNaoAtribuidas(t);
  add(!causaisProprias.length && !RE_VOTO.test(t), 'M11 Sem atribuição causal própria e sem recomendação de voto', causaisProprias.length ? `verbo causal: "${causaisProprias[0]}"` : RE_VOTO.test(t) ? 'recomendação de voto' : null);
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
  module.exports = { aplicarGates, rubricaMaquina, causaisNaoAtribuidas, RUBRICA_HUMANA, RE_EXTENSO, RE_CAUSAL, RE_VOTO, RE_CITACAO, RE_ASSERCAO, RE_NEGACAO };
}
