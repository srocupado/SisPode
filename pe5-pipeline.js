// Parecer de Especialista (refeito em 17/11/2026) — O ENCADEAMENTO.
//
//   programa   lê os PDFs (texto), coleta tramitação/votações/bancada/fase na API da Câmara, câmbio no BC
//   IA 1       leitura dos documentos → JSON com trecho literal de cada item
//   programa   confere cada trecho no documento (o que não for achado sai); lê os artigos da lei vigente
//   IA 2-4     pesquisas na internet, em paralelo: debate, experiência internacional, contexto
//   programa   descarta item sem fonte, troca link temporário pelo endereço final
//   IA 5-6     redação em duas metades (a segunda recebe a primeira, para não repetir)
//   IA 7       revisão adversarial → correções pontuais, aplicadas pelo programa
//   programa   conferência (pe5-conferencia.js) e registro de tempo e de tokens reais por chamada
//
// Diferenças de custo em relação ao pipeline anterior: os documentos vão como TEXTO e uma única vez (antes
// os PDFs eram reenviados a cada chamada); o raciocínio alto fica só na leitura e na redação; e o que cada
// chamada consumiu fica gravado — o aviso antigo prometia 250 a 350 mil tokens e 7 a 12 minutos, e os
// pareceres medidos levaram de 15 a 33 minutos.
//
// A mesma função roda na extensão e em Node (testes, com o modelo trocado por respostas gravadas).
// Script clássico (global na extensão) + module.exports para os testes.

'use strict';

const __pe5m = (typeof module !== 'undefined' && typeof require === 'function') ? {
  C: require('./pe5-coleta.js'), P: require('./pe5-prompts.js'), K: require('./pe5-conferencia.js'), E: require('./especialistas.js'), D: require('./dossie.js'),
} : null;
// No navegador os módulos são scripts clássicos no mesmo escopo (ver a nota em pipeline-parecer.js):
// identificadores resolvidos só na chamada, nunca por eval.
function _pe5Refs() {
  if (__pe5m) return { ...__pe5m.C, ...__pe5m.P, ...__pe5m.K, ESPECIALISTAS: __pe5m.E.ESPECIALISTAS, sugerirEspecialistas: __pe5m.E.sugerirEspecialistas, buscarTextoNorma: __pe5m.D.buscarTextoNorma };
  /* eslint-disable no-undef */
  return { pe5ColetarTramitacao, pe5MapaVotos, pe5ColetarPartido, pe5ArtigoVigente, pe5ArtigosAlterados, pe5CabecalhosDeArtigo, pe5Inventario, pe5DataBR,
    pe5PromptLeitura, pe5PromptDebate, pe5PromptInternacional, pe5PromptContexto, pe5PromptCongresso, pe5PromptRedacao1, pe5PromptRedacao2, pe5PromptRevisao,
    pe5Conferir, pe5Norm, ESPECIALISTAS, sugerirEspecialistas, buscarTextoNorma };
  /* eslint-enable no-undef */
}

/** JSON da resposta do modelo: tolera cerca de código e texto em volta. */
function pe5ExtrairJson(texto) {
  let t = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const tenta = s => { try { return JSON.parse(s); } catch (_) { return undefined; } };
  let j = tenta(t); if (j !== undefined) return j;
  const iObj = t.indexOf('{'), fObj = t.lastIndexOf('}');
  if (iObj >= 0 && fObj > iObj) { j = tenta(t.slice(iObj, fObj + 1)); if (j !== undefined) return j; }
  return null;
}

/**
 * Confere cada trecho que a leitura transcreve. O que não for localizado SAI — é a mesma trava do
 * pipeline anterior (achado sem trecho não entra), agora também para versões, justificativa e blocos.
 * Devolve { leitura, conferidos, recusados: [{ id, motivo }] }.
 */
function pe5ConferirTrechos(L, documentos, norm) {
  const docs = (documentos || []).map(d => ({ rotulo: d.rotulo, n: norm(d.texto) }));
  const onde = (rotulo, trecho) => {
    const t = norm(trecho); if (t.length < 20) return null;                 // trecho curto demais não prova nada
    const pref = docs.find(d => d.rotulo === rotulo);
    if (pref && pref.n.includes(t)) return pref.rotulo;
    const outro = docs.find(d => d.n.includes(t));
    return outro ? outro.rotulo : null;
  };
  const out = { ...L }, recusados = []; let conferidos = 0;
  for (const g of ['blocos', 'alteracoes', 'emendas', 'justificativa', 'estimativas', 'controversias', 'achados', 'referencias']) {
    out[g] = (Array.isArray(L?.[g]) ? L[g] : []).filter(x => {
      if (!x || !x.id) return false;
      const d = onde(x.documento, x.trecho);
      if (!d) { recusados.push({ id: x.id, motivo: 'trecho não localizado nos documentos', trecho: String(x.trecho || '').slice(0, 90) }); return false; }
      x.documento = d; conferidos++; return true;
    });
  }
  out.versoes = (Array.isArray(L?.versoes) ? L.versoes : []).filter(v => {
    if (!v || !v.id) return false;
    const dd = onde(v.documento_depois, v.trecho_depois);
    const da = v.trecho_antes ? onde(v.documento_antes, v.trecho_antes) : '—';
    if (!dd || !da) { recusados.push({ id: v.id, motivo: `trecho ${!dd ? 'do texto em votação' : 'do texto anterior'} não localizado`, trecho: String(!dd ? v.trecho_depois : v.trecho_antes || '').slice(0, 90) }); return false; }
    v.documento_depois = dd; if (da !== '—') v.documento_antes = da; conferidos += v.trecho_antes ? 2 : 1; return true;
  });
  out.ausencias = (Array.isArray(L?.ausencias) ? L.ausencias : []).filter(x => x && x.id && x.o_que);
  if (L?.vigencia?.trecho) { const d = onde(L.vigencia.documento, L.vigencia.trecho); if (d) { conferidos++; out.vigencia = { ...L.vigencia, documento: d }; } else { recusados.push({ id: 'vigencia', motivo: 'trecho não localizado' }); out.vigencia = null; } }
  return { leitura: out, conferidos, recusados };
}

/** Câmbio de venda mais recente do Banco Central (reais por unidade). */
async function pe5Cambio(fetchFn) {
  const series = { USD: 1, EUR: 21619, GBP: 21623, JPY: 21621 };
  const taxas = {}; let data = '';
  for (const [moeda, cod] of Object.entries(series)) {
    try {
      const r = await fetchFn(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cod}/dados/ultimos/1?formato=json`);
      if (!r.ok) continue;
      const j = await r.json(); const v = Number(String(j?.[0]?.valor || '').replace(',', '.'));
      if (isFinite(v) && v > 0) { taxas[moeda] = Math.round(v * 10000) / 10000; data = j[0].data || data; }
    } catch (_) { /* sem câmbio, o modelo é instruído a não converter */ }
  }
  return Object.keys(taxas).length ? { data, taxas } : null;
}

const PE5_ORIGEM_LEI = { camara: 'texto atualizado, Portal da Legislação da Câmara', planalto: 'texto compilado, Planalto', senado: 'publicação original, Senado Federal — pode não trazer alterações posteriores' };

/** Tabela "o que muda na legislação": o artigo vigente de cada dispositivo alterado, lido pelo programa. */
async function pe5LeiVigente(alteracoesLidas, fetchFn, R) {
  const linhas = [], avisos = [], cache = new Map(), integrais = []; let textoBase = '';
  const alvos = R.pe5ArtigosAlterados(alteracoesLidas || []);
  for (const a of alteracoesLidas || []) {
    const alvo = alvos.find(x => x.id === a.id);
    const linha = { id: a.id, dispositivo: a.dispositivo, muda: a.muda, tipo: a.tipo || '', novo: false, vigente: null, fonteLei: '' };
    if (alvo && alvo.artigos.length && fetchFn) {
      const k = `${alvo.tipo}|${alvo.numero}|${alvo.ano}`;
      if (!cache.has(k)) {
        let lei = null;
        try { lei = await R.buscarTextoNorma({ tipo: alvo.tipo, numero: alvo.numero, ano: alvo.ano }, fetchFn); } catch (e) { avisos.push(`${alvo.rotuloNorma}: ${e.message}`); }
        // Página que não é a lei (o Planalto devolve a página inicial quando recusa a conexão) tem texto, mas não tem artigos.
        if (lei && lei.texto && R.pe5CabecalhosDeArtigo(lei.texto).length < 3) { avisos.push(`${alvo.rotuloNorma}: a fonte respondeu com uma página que não é o texto da lei.`); lei = null; }
        if (lei && !lei.texto) { avisos.push(`${alvo.rotuloNorma}: texto não obtido (${(lei.tentativas || []).join('; ')}).`); lei = null; }
        cache.set(k, lei);
        if (lei) integrais.push({ norma: alvo.rotuloNorma, origem: PE5_ORIGEM_LEI[lei.origem] || lei.origem || '', texto: lei.texto });
      }
      const lei = cache.get(k);
      if (lei) {
        const achados = alvo.artigos.map(n => R.pe5ArtigoVigente(lei.texto, n)).filter(Boolean);
        linha.novo = !achados.length;
        linha.vigente = achados.map(x => x.texto).join(' ') || null;
        linha.fonteLei = achados.length ? `${alvo.rotuloNorma} (${PE5_ORIGEM_LEI[lei.origem] || lei.origem || 'fonte oficial'})` : '';
        linha.urlLei = lei.url || '';
        textoBase += '\n' + achados.map(x => x.texto).join('\n');
      }
    } else if (/acrescenta/i.test(a.tipo || '') && !alvo) linha.novo = true;
    linhas.push(linha);
  }
  return { alteracoes: linhas, avisos, textoBase, integrais };
}

/** Pesquisa: só fica o que tem fonte; link de redirecionamento temporário ganha o endereço final. */
async function pe5LimparPesquisa(obj, grupos, fetchFn) {
  const out = { ...(obj && typeof obj === 'object' ? obj : {}) }; let descartados = 0;
  const temFonte = x => x && /^https?:\/\/[^\s"'<>]+$/i.test(String(x.fonte_url || '')) && String(x.fonte_nome || '').trim();
  for (const [g, prefixo] of Object.entries(grupos)) {
    const lista = Array.isArray(out[g]) ? out[g] : [];
    out[g] = lista.filter(x => { if (temFonte(x)) return true; descartados++; return false; });
    out[g].forEach((x, i) => { if (!x.id) x.id = `${prefixo}${i + 1}`; });
    for (const x of out[g]) {
      if (fetchFn && /vertexaisearch\.cloud\.google\.com|grounding-api-redirect/.test(x.fonte_url)) {
        try { const r = await fetchFn(x.fonte_url, { method: 'GET', redirect: 'follow' }); if (r && r.url && !/vertexaisearch/.test(r.url)) x.fonte_url_final = r.url; } catch (_) { /* fica o temporário; a conferência avisa */ }
      }
    }
  }
  out.avisos = Array.isArray(out.avisos) ? out.avisos.filter(a => typeof a === 'string' && a.trim()) : [];
  if (descartados) out.avisos.push(`${descartados} item(ns) da pesquisa foram descartados por não trazerem fonte.`);
  return out;
}

/** Aplica as correções do revisor: troca de trecho que aparece UMA vez no documento. */
function pe5AplicarRevisao(doc, correcoes) {
  const aplicadas = [], ignoradas = [];
  const visita = (o, fn) => { if (Array.isArray(o)) o.forEach((v, i) => { if (typeof v === 'string') o[i] = fn(v); else visita(v, fn); }); else if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'ev') continue; if (typeof o[k] === 'string') o[k] = fn(o[k]); else visita(o[k], fn); } };
  for (const c of Array.isArray(correcoes) ? correcoes : []) {
    const alvo = String(c?.trecho || '').trim();
    if (alvo.length < 12) { ignoradas.push({ ...c, razao: 'trecho curto demais' }); continue; }
    let n = 0; visita(doc, s => { n += s.split(alvo).length - 1; return s; });
    if (n !== 1) { ignoradas.push({ ...c, razao: n ? 'trecho aparece mais de uma vez' : 'trecho não localizado' }); continue; }
    visita(doc, s => s.includes(alvo) ? s.replace(alvo, String(c.novo || '')).replace(/\s{2,}/g, ' ').trim() : s);
    aplicadas.push({ trecho: alvo.slice(0, 120), novo: String(c.novo || '').slice(0, 200), motivo: String(c.motivo || '') });
  }
  return { aplicadas, ignoradas };
}

/**
 * ctx: { identificacao, sigla, numero, ano, ementa, idProposicao, docs: [{ rotulo, url, buffer }], disponiveis, temas, hoje, geradoPor, textoEmVotacao }
 *        (coletaPronta: tramitação já coletada — usada nos testes)
 * io:  { chamarModelo({ prompt, pdfBuffers, web, etapa, pensar }) → { text, truncated, usage }, fetchFn, lerPdf(buffer) → texto, onPasso, semWeb }
 */
async function gerarParecerPE5(ctx, io) {
  const R = _pe5Refs();
  const passo = t => { try { io.onPasso && io.onPasso(t); } catch (_) {} };
  const t0 = Date.now(), chamadas = [], hoje = ctx.hoje || new Date();
  const hojeBR = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  const chamar = async (nome, prompt, extra = {}) => {
    const ini = Date.now();
    const r = await io.chamarModelo({ prompt, pdfBuffers: extra.pdfBuffers || [], web: !!extra.web, etapa: nome, pensar: extra.pensar || 'medio' });
    chamadas.push({ nome, prompt: prompt.length, resposta: (r.text || '').length, truncada: !!r.truncated, web: !!extra.web, ms: Date.now() - ini, tokens: r.usage || null });
    return r;
  };

  // --- programa: documentos ---
  passo('lendo os documentos…');
  const documentos = [];
  for (const d of ctx.docs || []) {
    try { documentos.push({ rotulo: d.rotulo, url: d.url || '', texto: String(await io.lerPdf(d.buffer) || ''), buffer: d.buffer }); }
    catch (e) { documentos.push({ rotulo: d.rotulo, url: d.url || '', texto: '', erro: e.message, buffer: d.buffer }); }
  }
  const legiveis = documentos.filter(d => d.texto.trim().length >= 400);
  if (!legiveis.length) return { erro: 'Nenhum documento legível: o parecer não é gerado sem texto.', chamadas };
  const inventario = R.pe5Inventario(documentos, ctx.disponiveis || []);
  const textoEmVotacao = ctx.textoEmVotacao || documentos[0].rotulo;

  // --- programa: tramitação e câmbio ---
  passo('levantando tramitação, votações e bancada…');
  let coleta = ctx.coletaPronta || null;   // os testes entregam a coleta gravada
  if (!coleta && ctx.idProposicao && io.fetchFn) { try { coleta = await R.pe5ColetarTramitacao(ctx.idProposicao, io.fetchFn, { hoje, ano: ctx.ano }); } catch (e) { coleta = null; } }
  if (coleta && ctx.pauta) coleta.pauta = ctx.pauta;       // a pauta do SisPode em que a matéria está
  if (coleta && !coleta.mapa) { try { coleta.mapa = R.pe5MapaVotos(coleta); } catch (_) { /* sem mapa */ } }
  const cambio = io.fetchFn ? await pe5Cambio(io.fetchFn) : null;

  // --- IA 1: leitura ---
  const todas = R.sugerirEspecialistas({ temas: ctx.temas || [], ementa: `${ctx.ementa || ''}`, textoEmendas: documentos.map(d => d.rotulo).join(' ') });
  const lentes = todas.filter(l => l.confianca !== 'baixa');
  // Lente federativa: a ementa raramente fala em Estados e Municípios; o texto em votação, sim.
  if (!lentes.some(l => l.chave === 'federativo')) {
    // conta PASSAGENS (menções a mais de 300 caracteres uma da outra): "Estados, Distrito Federal e Municípios" numa frase é uma só
    let n = 0, ultima = -1000;
    for (const m of String(legiveis[0]?.texto || '').matchAll(/(?:Estados?|Munic[íi]pios?|Distrito Federal|entes? federa(?:dos?|tivos?))(?![a-zà-ú])/g)) if (m.index - ultima > 300) { n++; ultima = m.index; }
    const e = (R.ESPECIALISTAS || []).find(x => x.chave === 'federativo');
    if (e && n >= 3) lentes.splice(Math.min(2, lentes.length), 0, { chave: e.chave, ordem: e.ordem, rotulo: e.rotulo, transversal: false, confianca: 'alta', gatilhos: [], motivo: `${n} passagens do texto em votação tratam de Estados, Distrito Federal ou Municípios`, perguntas: e.perguntas.length });
  }
  passo(`lendo o texto com ${lentes.length} roteiros de especialista…`);
  const ilegiveis = documentos.filter(d => d.texto.trim().length < 400 && d.buffer).map(d => d.buffer);   // PDF de imagem vai anexado
  const r1 = await chamar('leitura', R.pe5PromptLeitura({ identificacao: ctx.identificacao, ementa: ctx.ementa, documentos: legiveis, coleta, lentes, catalogo: R.ESPECIALISTAS, textoEmVotacao }), { pensar: 'alto', pdfBuffers: ilegiveis });
  const Lbruta = pe5ExtrairJson(r1.text);
  if (!Lbruta || typeof Lbruta !== 'object') return { erro: r1.truncated ? 'A leitura veio truncada: os documentos são grandes demais para uma chamada.' : 'Não consegui interpretar a leitura do modelo.', chamadas };
  const tr = pe5ConferirTrechos(Lbruta, legiveis, R.pe5Norm);
  const leitura = tr.leitura;
  if (!(leitura.blocos || []).length) return { erro: `A leitura não trouxe nenhum bloco com trecho localizado nos documentos (${tr.recusados.length} recusados). O parecer não é gerado.`, chamadas, trechos: tr };

  // --- programa: lei vigente ---
  passo('lendo a lei em vigor…');
  let lv = { alteracoes: [], avisos: [], textoBase: '', integrais: [] };
  try { lv = await pe5LeiVigente(leitura.alteracoes, io.fetchFn || null, R); } catch (e) { lv.avisos.push(`Lei vigente não lida: ${e.message}`); }

  // --- IA 2-5: pesquisas ---
  let pesquisa = { debate: { atores: [], controversias: [], avisos: [] }, internacional: { jurisdicoes: [], avisos: [] }, contexto: { jurisprudencia: [], normas: [], dados: [], correlatas: [], avisos: [] }, congresso: { historico: [], judicializacao: [], avisos: [] } };
  if (io.semWeb !== true) {
    passo('pesquisando o debate, a experiência de outros países, o contexto jurídico e o histórico no Congresso…');
    const base = { identificacao: ctx.identificacao, ementa: ctx.ementa, leitura, coleta, hoje: hojeBR };
    const uma = async (nome, prompt, grupos) => {
      try { const r = await chamar(nome, prompt, { web: true, pensar: 'medio' }); const j = pe5ExtrairJson(r.text); if (!j) return { avisos: [`A pesquisa (${nome}) não devolveu resultado utilizável.`] }; return await pe5LimparPesquisa(j, grupos, io.fetchFn || null); }
      catch (e) { return { avisos: [`A pesquisa (${nome}) falhou: ${e.message}`] }; }
    };
    const [deb, intl, cx, cg] = await Promise.all([
      uma('pesquisa-debate', R.pe5PromptDebate(base), { atores: 'Q' }),
      uma('pesquisa-internacional', R.pe5PromptInternacional(base), { jurisdicoes: 'W' }),
      uma('pesquisa-contexto', R.pe5PromptContexto(base), { jurisprudencia: 'R', normas: 'M', dados: 'F', correlatas: 'K', documentos_base: 'Y', alcance: 'Z' }),
      uma('pesquisa-congresso', R.pe5PromptCongresso(base), { historico: 'H', judicializacao: 'L' }),
    ]);
    pesquisa = { debate: { atores: [], controversias: [], ...deb }, internacional: { jurisdicoes: [], ...intl }, contexto: { jurisprudencia: [], normas: [], dados: [], correlatas: [], ...cx }, congresso: { historico: [], judicializacao: [], ...cg } };
    if (!Array.isArray(pesquisa.debate.controversias)) pesquisa.debate.controversias = [];
    pesquisa.debate.controversias.forEach((c, i) => { if (c && !c.id) c.id = `D${i + 1}`; });
  }

  // --- programa: o partido e a matéria (depois da pesquisa, que diz quais são as proposições correlatas) ---
  if (coleta && !coleta.partido && io.fetchFn && coleta.proposicao?.id) {
    passo('levantando a atuação da bancada na matéria e em proposições correlatas…');
    const correlatas = [...(pesquisa.contexto.correlatas || []).map(k => k.proposicao), ...(pesquisa.congresso.historico || []).filter(h => !/senado/i.test(h.casa || '')).map(h => h.proposicao)];
    try { coleta.partido = await R.pe5ColetarPartido(coleta, { palavras: Array.isArray(leitura.termos_de_busca) ? leitura.termos_de_busca : [], correlatas }, io.fetchFn); }
    catch (e) { coleta.partido = { avisos: [`atuação da bancada não levantada: ${e.message}`], projetos: [], acessorias: [], votacoesCorrelatas: [], autoresDaMateria: [] }; }
  }

  // --- IA 6-7: redação ---
  const baseRed = { identificacao: ctx.identificacao, hoje: hojeBR, leitura, pesquisa, coleta, alteracoes: lv.alteracoes, cambio };
  passo('redigindo a matéria, o debate e a experiência internacional…');
  const r5 = await chamar('redacao-1', R.pe5PromptRedacao1(baseRed), { pensar: 'alto' });
  const parte1 = pe5ExtrairJson(r5.text);
  if (!parte1 || typeof parte1 !== 'object') return { erro: r5.truncated ? 'A primeira metade da redação veio truncada.' : 'Não consegui interpretar a primeira metade da redação.', chamadas };
  passo('redigindo a análise, os caminhos e a abertura…');
  // A lei em vigor vai inteira à análise e à revisão: é o que permite ao modelo dizer "a lei atual já tem regra
  // parecida" a partir do texto, e não de memória. Entrada é a parte barata da chamada.
  const leiIntegral = (lv.integrais || []).map(x => `<<<${x.norma} — ${x.origem}>>>\n${String(x.texto).slice(0, 160000)}`).join('\n\n').slice(0, 320000);
  const r6 = await chamar('redacao-2', R.pe5PromptRedacao2({ ...baseRed, parte1, leiIntegral }), { pensar: 'alto' });
  const parte2 = pe5ExtrairJson(r6.text);
  if (!parte2 || typeof parte2 !== 'object') return { erro: r6.truncated ? 'A segunda metade da redação veio truncada.' : 'Não consegui interpretar a segunda metade da redação.', chamadas };
  const doc = { materia: parte1.materia || {}, debate: parte1.debate || {}, internacional: parte1.internacional || {}, analise: parte2.analise || {}, caminhos: parte2.caminhos || {}, abertura: parte2.abertura || {} };

  // --- IA 8: revisão ---
  let revisao = { aplicadas: [], ignoradas: [], observacoes: [] };
  if (io.semRevisao !== true) {
    passo('revisão: procurando erros no texto…');
    try {
      const r7 = await chamar('revisao', R.pe5PromptRevisao({ ...baseRed, doc, leiIntegral }), { pensar: 'medio' });
      const j = pe5ExtrairJson(r7.text) || {};
      revisao = { ...pe5AplicarRevisao(doc, j.correcoes), observacoes: (Array.isArray(j.observacoes) ? j.observacoes : []).filter(x => typeof x === 'string').slice(0, 12) };
    } catch (e) { revisao.observacoes.push(`A revisão não rodou: ${e.message}`); }
  }

  // --- programa: conferência ---
  passo('conferindo…');
  const p = {
    versao: 5, materia: ctx.identificacao, sigla: ctx.sigla || '', ementa: ctx.ementa || coleta?.proposicao?.ementa || '', textoAnalisado: textoEmVotacao,
    geradoEm: hoje.toISOString(), geradoPor: ctx.geradoPor || '',
    coleta, cambio, inventario, leitura, pesquisa, doc, alteracoes: lv.alteracoes, avisosLei: lv.avisos, revisao,
    lentes: lentes.map(l => ({ ordem: l.ordem, rotulo: l.rotulo, motivo: l.motivo, chave: l.chave })),
    trechos: { conferidos: tr.conferidos, recusados: tr.recusados },
    base: { documentos: legiveis.map(d => d.texto).join('\n'), lei: (lv.integrais || []).map(x => x.texto).join('\n') || lv.textoBase },
    chamadas, duracaoMs: Date.now() - t0,
  };
  p.conferencia = R.pe5Conferir(p, { hoje });
  for (const a of lv.avisos) p.conferencia.itens.push({ teste: 'Leitura da lei em vigor', ok: false, detalhe: a, critico: false });
  for (const o of revisao.observacoes) p.conferencia.itens.push({ teste: 'Observação da revisão', ok: false, detalhe: o, critico: false });
  const tok = chamadas.reduce((s, c) => ({ entrada: s.entrada + (c.tokens?.entrada || 0), saida: s.saida + (c.tokens?.saida || 0), raciocinio: s.raciocinio + (c.tokens?.raciocinio || 0), total: s.total + (c.tokens?.total || 0) }), { entrada: 0, saida: 0, raciocinio: 0, total: 0 });
  p.consumo = { ...tok, chamadas: chamadas.length, minutos: Math.round((Date.now() - t0) / 6000) / 10 };
  // A base inteira (dezenas de milhares de caracteres) serviu à conferência; não vai para o Firebase.
  delete p.base;
  return p;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gerarParecerPE5, pe5ExtrairJson, pe5ConferirTrechos, pe5Cambio, pe5LeiVigente, pe5LimparPesquisa, pe5AplicarRevisao };
}
