// Parecer de Especialista — o PIPELINE, independente da tela.
//
// Recebe o contexto da proposição e as funções de acesso (modelo, rede,
// leitor de PDF, leitor de planilha) e devolve o parecer pronto para imprimir.
// A mesma função roda na extensão (com chamarIA e fetch do Chrome) e em Node
// (com Gemini por chave de ambiente e pdf.js), e é isso que permite a prova
// de conceito antes de tocar na tela.
//
// Passos (cinco chamadas de modelo, quatro obrigatórias e uma condicional):
//   1 leitura      JS      textos dos PDFs, normas citadas
//   2 apuração     MODELO  achados por lente + ficha (dispositivo, regra antes/depois, objetivo, estimativa), com trecho
//   3 conferência  JS      trecho localizado no documento, ou o achado sai
//   4 dossiê       JS      estimativas, marco, lei vigente (Planalto → LexML/Senado), séries, janelas, tabelas
//   5 ficha        JS      regra vigente → regra proposta → data de efeito, com origem
//   6 tese         MODELO  afirmações com evidências (JSON) → validação por máquina
//   7 contraditório MODELO refutações → aplicadas por máquina
//   8 redação      MODELO  texto com marcadores → conferência; reprovada, refaz UMA vez (5ª chamada)
//   9 gates+rubrica JS     faixas, notas, reprovações; M1–M11
//
// Script clássico (global na extensão) + module.exports para os testes.

const __mods = (typeof module !== 'undefined' && typeof require === 'function') ? {
  D: require('./dossie.js'), F: require('./ficha.js'), T: require('./tese.js'), G: require('./gates.js'), P: require('./parecer.js'), E: require('./especialistas.js'),
} : null;
// No navegador os módulos são scripts clássicos no mesmo escopo: `const` do
// topo de um script (ESPECIALISTAS…) é visível pelo nome, mas NÃO é
// propriedade de globalThis, e a CSP da extensão proíbe eval. Por isso as
// referências são identificadores explícitos, resolvidos só na chamada (depois
// de todos os scripts carregados) e nunca avaliados em Node.
function _refs() {
  if (__mods) {
    const { D, F, T, G, P, E } = __mods;
    return { ESPECIALISTAS: E.ESPECIALISTAS, sugerirEspecialistas: E.sugerirEspecialistas, ressalvasDeValidade: E.ressalvasDeValidade, promptApuracao: P.promptApuracao,
      montarDossie: D.montarDossie, resumoDoDossie: D.resumoDoDossie, montarFicha: F.montarFicha, catalogoDeEvidencias: T.catalogoDeEvidencias, promptTese: T.promptTese,
      validarTese: T.validarTese, promptContraditorio: T.promptContraditorio, aplicarContraditorio: T.aplicarContraditorio, promptRedacao: T.promptRedacao,
      conferirRedacao: T.conferirRedacao, limparMarcadores: T.limparMarcadores, aplicarGates: G.aplicarGates, rubricaMaquina: G.rubricaMaquina };
  }
  /* eslint-disable no-undef */
  return { ESPECIALISTAS, sugerirEspecialistas, ressalvasDeValidade, promptApuracao, montarDossie, resumoDoDossie, montarFicha, catalogoDeEvidencias, promptTese,
    validarTese, promptContraditorio, aplicarContraditorio, promptRedacao, conferirRedacao, limparMarcadores, aplicarGates, rubricaMaquina };
  /* eslint-enable no-undef */
}

/** JSON da resposta do modelo, tolerando cerca de código e prosa em volta. */
function extrairJSONParecer(texto) {
  const s = String(texto || '').replace(/```(?:json)?/gi, '');
  const i = s.search(/[[{]/);
  if (i < 0) return null;
  const abre = s[i], fecha = abre === '[' ? ']' : '}';
  let n = 0, str = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { str = !str; continue; }
    if (str) continue;
    if (c === abre) n++;
    else if (c === fecha && --n === 0) { try { return JSON.parse(s.slice(i, k + 1)); } catch (_) { return null; } }
  }
  return null;
}

/** Cada achado tem de ter o trecho no documento; sem isso, não entra. */
function conferirAchados(achados, fonte) {
  const compacto = s => String(s ?? '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
  const f = compacto(fonte);
  const aprovados = [], recusados = [], semQuestao = [];
  const podeConferir = fonte && fonte.length > 500;
  for (const a of achados || []) {
    if (a?.semQuestao) { semQuestao.push({ lente: a.lente, pergunta: a.pergunta }); continue; }
    if (!a?.achado) continue;
    const t = compacto(a.trecho);
    if (podeConferir && (t.length < 25 || !f.includes(t))) {
      recusados.push({ lente: a.lente, pergunta: a.pergunta, motivo: t.length < 25 ? 'trecho ausente ou curto demais para conferir' : 'trecho citado não localizado no documento analisado' });
      continue;
    }
    aprovados.push({ lente: a.lente, pergunta: a.pergunta, achado: String(a.achado), dispositivo: a.dispositivo || null, trecho: a.trecho || null, conferido: podeConferir });
  }
  return { aprovados, recusados, semQuestao, conferivel: podeConferir };
}

/** Palavras que identificam o objeto, para o vínculo das estimativas (G6). */
function palavrasDoObjeto(ficha, ementa) {
  const p = new Set();
  const fontes = [ficha?.dispositivo, ficha?.regraProposta?.texto, ementa].filter(Boolean).join(' ');
  for (const m of fontes.match(/\b(?:remessa|importa[çc][ãa]o|exporta[çc][ãa]o|IPI|IRPJ|IRPF|CSLL|Cofins|PIS|ICMS|ISS|IOF|contribui[çc][ãa]o|al[íi]quota|pena|isen[çc][ãa]o|benef[íi]cio|aposentadoria|sal[áa]rio|licen[çc]a)\w*/gi) || []) p.add(m.toLowerCase());
  for (const m of fontes.match(/\b\d{1,2}\.\d{3}\b/g) || []) p.add(m);           // número de norma ("1.804")
  return [...p].slice(0, 12);
}

/**
 * Gera o parecer. `ctx`: identificacao, sigla, numero, ano, ementa, autoria,
 * relator, situacao, temas, docs [{rotulo, buffer}], textoEmendas, hoje.
 * `io`: chamarModelo({prompt, pdfBuffers}) → {text, truncated}; fetchFn;
 * lerPdf(buffer) → texto; abrirXlsx(buffer) → workbook; onPasso(texto).
 */
async function gerarParecer(ctx, io) {
  const passo = t => { try { io.onPasso && io.onPasso(t); } catch (_) {} };
  const R = _refs();
  const ESPEC = R.ESPECIALISTAS, sugerir = R.sugerirEspecialistas, ressalvas = R.ressalvasDeValidade;
  const promptApuracao = R.promptApuracao;
  const montarDossie = R.montarDossie, resumoDoDossie = R.resumoDoDossie;
  const montarFicha = R.montarFicha;
  const T = { catalogo: R.catalogoDeEvidencias, promptTese: R.promptTese, validar: R.validarTese, promptContra: R.promptContraditorio, aplicarContra: R.aplicarContraditorio, promptRedacao: R.promptRedacao, conferir: R.conferirRedacao, limpar: R.limparMarcadores };
  const aplicarGates = R.aplicarGates, rubricaMaquina = R.rubricaMaquina;
  const chamadas = [];
  const chamar = async (nome, prompt, pdfBuffers) => { const r = await io.chamarModelo({ prompt, pdfBuffers: pdfBuffers || [] }); chamadas.push({ nome, prompt: prompt.length, resposta: (r.text || '').length, truncada: !!r.truncated }); return r; };

  // 1. leitura
  passo('lendo os documentos…');
  const documentos = [];
  let fonte = '';
  for (const d of ctx.docs || []) {
    try { const tx = await io.lerPdf(d.buffer); documentos.push({ rotulo: d.rotulo, texto: tx }); fonte += '\n' + tx; } catch (e) { documentos.push({ rotulo: d.rotulo, texto: '', erro: e.message }); }
  }
  if (fonte.trim().length < 500) return { erro: 'Nenhum documento legível: o parecer não é gerado sem texto.' };
  const textoAnalisado = (ctx.docs?.[0]?.rotulo) || 'documento analisado';

  // lentes
  const todas = sugerir({ temas: ctx.temas || [], ementa: `${ctx.ementa || ''} ${ctx.titulo || ''}`, textoEmendas: ctx.textoEmendas || (ctx.docs || []).map(d => d.rotulo).join(' ') });
  const lentes = todas.filter(l => l.confianca !== 'baixa');
  const descartadas = todas.filter(l => l.confianca === 'baixa');

  // 2–3. apuração e conferência
  passo(`apurando (${lentes.length} lentes)…`);
  const r1 = await chamar('apuracao', promptApuracao({ identificacao: ctx.identificacao, ementa: ctx.ementa, autoria: ctx.autoria, relator: ctx.relator, textoAnalisado }, lentes, ESPEC), (ctx.docs || []).map(d => d.buffer));
  const bruto = extrairJSONParecer(r1.text);
  if (!Array.isArray(bruto)) return { erro: r1.truncated ? 'A apuração veio truncada — documento grande demais para uma leitura só.' : 'Não consegui interpretar a apuração do modelo.', chamadas };
  const conf = conferirAchados(bruto, fonte);
  const objetivos = conf.aprovados.filter(a => String(a.lente) === 'X' && a.pergunta === 'objetivo');

  // 4. dossiê (com as palavras do objeto vindas da apuração)
  passo('montando o dossiê de dados…');
  const fichaPrevia = montarFicha({ achados: conf.aprovados, leiVigente: [], marco: null, identificacao: ctx.identificacao });
  let dossie = null;
  try {
    dossie = await montarDossie({ fonte, documentos, rotulos: documentos.map(d => d.rotulo), ementa: ctx.ementa || '', hoje: ctx.hoje || new Date(),
      fetchFn: io.fetchFn || null, lerPdf: io.lerPdf, abrirXlsx: io.abrirXlsx || null, palavrasDoObjeto: palavrasDoObjeto(fichaPrevia, ctx.ementa) });
  } catch (e) { dossie = { nivel: 'C', avisos: [`Dossiê não montado: ${e.message}`], estimativas: [], negacoes: [], leiVigente: [], janelas: {}, fontes: [], texto: '', numeros: [], marco: null }; }
  const nivel = dossie.nivel || 'C';
  const temSerie = !!(Object.values(dossie.janelas || {}).some(j => j.antes && j.depois) || dossie.prc?.janelas?.antes);

  // 5. ficha
  const ficha = montarFicha({ achados: conf.aprovados, leiVigente: dossie.leiVigente || [], marco: dossie.marco, identificacao: ctx.identificacao, fonte });

  // 6. tese
  passo('formulando a tese…');
  const catalogo = T.catalogo({ achados: conf.aprovados, dossie, ficha, situacao: ctx.situacao || null });
  const semQuestaoTxt = conf.semQuestao.map(s => { const e = ESPEC.find(x => x.ordem === String(s.lente)); const idx = Number(String(s.pergunta).split('.').pop()) - 1; const p = e?.perguntas?.[idx]; return p ? `  [lente ${s.lente} · ${s.pergunta}] ${p.replace(/\([^)]*\)/g, '').split(/\?|\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/)[0].trim().slice(0, 90)}` : ''; }).filter(Boolean).join('\n');
  catalogo.semQuestao = semQuestaoTxt;
  const r2 = await chamar('tese', T.promptTese({ identificacao: ctx.identificacao, textoAnalisado, situacao: ctx.situacao, ficha, catalogo, nivel, lentes, objetivos }));
  const teseBruta = extrairJSONParecer(r2.text);
  if (!teseBruta || typeof teseBruta !== 'object') return { erro: 'Não consegui interpretar a tese do modelo.', chamadas };
  const validacao = T.validar(teseBruta, catalogo, { nivel });
  if (!validacao.tese.afirmacoes.length) return { erro: `Nenhuma afirmação da tese sobreviveu à validação (${validacao.removidas.length} removidas). O parecer não é gerado.`, validacao, chamadas };

  // 7. contraditório
  passo('contraditório…');
  const r3 = await chamar('contraditorio', T.promptContra({ identificacao: ctx.identificacao, tese: validacao.tese, catalogo, nivel }));
  const vereditos = extrairJSONParecer(r3.text);
  const contraditorio = T.aplicarContra(validacao.tese, Array.isArray(vereditos) ? vereditos : []);
  if (!contraditorio.tese.afirmacoes.length) return { erro: `Nenhuma afirmação sobreviveu ao contraditório (${contraditorio.refutadas.length} refutadas). O parecer não é gerado.`, validacao, contraditorio, chamadas };
  const tese = contraditorio.tese;

  // 8. redação (+ uma refeita)
  passo('redigindo…');
  const redigir = async correcoes => chamar(correcoes ? 'redacao-refeita' : 'redacao', T.promptRedacao({ identificacao: ctx.identificacao, textoAnalisado, situacao: ctx.situacao, ficha, tese, catalogo, lentes, catalogoLentes: ESPEC, nivel, temSerie, correcoes }));
  let r4 = await redigir(null);
  let texto = (r4.text || '').trim();
  let conferencia = T.conferir(texto, { tese, catalogo, ficha });
  let g = aplicarGates({ ficha, dossie, tese, texto, nivel, validacao, contraditorio });
  let refeita = false;
  if (!conferencia.ok || g.reprovacoes.length) {
    const motivos = [
      ...conferencia.semEvidencia.map(s => `parágrafo sem identificador de evidência em "${s.secao}": "${s.trecho}…"`),
      ...conferencia.idsInexistentes.map(id => `identificador inexistente: ${id}`),
      ...conferencia.numerosSuspeitos.map(n => `número fora da base: ${n.numero} (${n.contexto})`),
      ...conferencia.cifrasPorExtenso.map(c => `cifra por extenso: "${c}"`),
      ...g.reprovacoes.map(r => `${r.gate}: ${r.detalhe}`),
    ].join('\n');
    passo('redação reprovada; refazendo…');
    r4 = await redigir(motivos);
    texto = (r4.text || '').trim() || texto;
    conferencia = T.conferir(texto, { tese, catalogo, ficha });
    g = aplicarGates({ ficha, dossie, tese, texto, nivel, validacao, contraditorio });
    refeita = true;
  }
  texto = g.texto;

  // 9. rubrica
  const rubrica = rubricaMaquina({ texto, ficha, tese, dossie, nivel, conferencia, gates: g, temSerie });
  const ressalvasValidade = ressalvas(lentes.map(l => l.chave));

  return {
    texto, textoLimpo: T.limpar(texto), textoAnalisado, situacao: ctx.situacao || null,
    ficha, tese, nivel, temSerie,
    dossie: resumoDoDossie(dossie),
    catalogo: { itens: catalogo.itens.length },
    lentes: lentes.map(l => ({ ordem: l.ordem, rotulo: l.rotulo, motivo: l.motivo, chave: l.chave })),
    descartadas: descartadas.map(l => ({ rotulo: l.rotulo, ressalva: l.ressalva })),
    apuracao: { aprovados: conf.aprovados.length, recusados: conf.recusados, semQuestao: conf.semQuestao.length },
    validacao: { resumo: validacao.resumo, removidas: validacao.removidas, rebaixadas: validacao.rebaixadas },
    contraditorio: { resumo: contraditorio.resumo, refutadas: contraditorio.refutadas, contestadas: contraditorio.contestadas },
    conferencia, gates: { faixas: g.faixas, notas: g.notas, reprovacoes: g.reprovacoes, rebaixamentos: g.rebaixamentos },
    rubrica, ressalvasValidade, refeita, truncado: !!r4.truncated, chamadas,
    aprovado: rubrica.aprovado && !g.reprovacoes.length,
    geradoEm: (ctx.hoje || new Date()).toISOString(),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gerarParecer, extrairJSONParecer, conferirAchados, palavrasDoObjeto };
}
