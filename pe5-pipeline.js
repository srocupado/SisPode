// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
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
  C: require('./pe5-coleta.js'), P: require('./pe5-prompts.js'), K: require('./pe5-conferencia.js'), E: require('./especialistas.js'), D: require('./dossie.js'), N: require('./noticias-agencias.js'),
} : null;
// No navegador os módulos são scripts clássicos no mesmo escopo (ver a nota em pipeline-parecer.js):
// identificadores resolvidos só na chamada, nunca por eval.
function _pe5Refs() {
  if (__pe5m) return { ...__pe5m.C, ...__pe5m.P, ...__pe5m.K, ...__pe5m.N, ESPECIALISTAS: __pe5m.E.ESPECIALISTAS, sugerirEspecialistas: __pe5m.E.sugerirEspecialistas, buscarTextoNorma: __pe5m.D.buscarTextoNorma };
  /* eslint-disable no-undef */
  return { pe5ColetarTramitacao, pe5MapaVotos, pe5ColetarPartido, pe5ArtigoVigente, pe5ArtigosAlterados, pe5CabecalhosDeArtigo, pe5Inventario, pe5DataBR,
    pe5PromptLeitura, pe5PromptDebate, pe5PromptInternacional, pe5PromptContexto, pe5PromptCongresso, pe5PromptComplementar, pe5PromptRedacao1, pe5PromptRedacao2, pe5PromptRevisao,
    PE5_GRUPOS_DEBATE, pe5Conferir, pe5Norm, ESPECIALISTAS, sugerirEspecialistas, buscarTextoNorma, agenciasBuscarNoticias };
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
/**
 * Por que a resposta veio cortada. O raciocínio do modelo sai do mesmo limite da resposta: quando ele consome
 * a maior parte, o problema não é o tamanho dos documentos (era o que a mensagem antiga dizia).
 */
function pe5MotivoTruncada(r) {
  const u = (r && r.usage) || {}, saida = u.saida || 0, txt = Math.round(String((r && r.text) || '').length / 3.2);
  const rac = u.raciocinio || (saida > txt * 1.6 ? saida - txt : 0);
  return rac && rac > txt
    ? `o raciocínio do modelo consumiu a maior parte do limite de saída (cerca de ${Math.round(rac / 1000)} mil tokens de raciocínio para ${Math.round(txt / 1000)} mil de resposta). Tente de novo ou use outro modelo.`
    : 'a resposta não coube no limite de saída do modelo. Tente com menos documentos.';
}

// Testes da conferência que o revisor consegue consertar no texto. Ficam de fora os que só informam (peso das
// fontes oficiais, atualidade da tramitação, trecho recusado na leitura).
const PE5_RE_APONTAMENTO_CORRIGIVEL = /Valores, percentuais|não se repete|Afirmações de ausência|foi usado no texto|Sem jargão|Linguagem direta|Sem recomendação|Cada entidade da pesquisa|Cada bloco da NTA|Cada artigo citado|decreta inconstitucionalidade|Abertura completa|Cada posição e cada decisão|Quórum da matéria/;

/** Junta as duas leituras: a do texto em votação manda; a dos documentos de apoio acrescenta os seus grupos. */
function pe5JuntarLeituras(texto, apoio) {
  const out = { ...texto }, lista = (o, g) => (Array.isArray(o && o[g]) ? o[g].filter(x => x && typeof x === 'object') : []);
  for (const g of ['emendas', 'justificativa', 'estimativas', 'referencias']) out[g] = lista(apoio, g).length ? lista(apoio, g) : lista(texto, g);
  for (const [g, pref] of [['controversias', 'C'], ['achados', 'T'], ['ausencias', 'X']]) {
    const a = lista(texto, g), usados = new Set(a.map(x => String(x.id)));
    let n = 100;
    const b = lista(apoio, g).map(x => { let id = String(x.id || ''); while (!id || usados.has(id)) id = `${pref}${++n}`; usados.add(id); return { ...x, id }; });
    out[g] = [...a, ...b];
  }
  return out;
}

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
/**
 * Junta as duas buscas do debate. Ator repetido (mesmo nome, sem porta-voz) fica uma vez, com os argumentos
 * das duas; os identificadores são refeitos (Q1…, D1…) e as controvérsias de pergunta parecida viram uma só.
 */
function pe5JuntarDebates(...listas) {
  const chave = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(senador|senadora|deputado|deputada|ministro|ministra|presidente|governo|federal|do|da|de|dos|das|e|o|a)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const atores = [], porChave = new Map();
  const mapa2 = listas.map(() => new Map());
  listas.forEach((p, k) => { for (const x of (p && Array.isArray(p.atores) ? p.atores : [])) {
    if (!x || !x.ator) continue;
    if (p.grupo && !x.grupo) x.grupo = p.grupo;
    const ch = chave(x.ator), antigo = String(x.id || '');
    let alvo = ch && porChave.get(ch);
    if (alvo) { alvo.argumentos = [...(alvo.argumentos || []), ...((x.argumentos || []).filter(g => !(alvo.argumentos || []).some(h => String(h.tese).slice(0, 60) === String(g.tese).slice(0, 60))))]; }
    else { alvo = { ...x }; atores.push(alvo); if (ch) porChave.set(ch, alvo); }
    if (antigo) mapa2[k].set(antigo, alvo);
  } });
  const mapa = mapa2;
  atores.forEach((x, i) => { x.id = `Q${i + 1}`; });
  const pal = t => new Set((String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]{5,}/g) || []));
  const contr = [];
  listas.forEach((p, k) => { for (const c of (p && Array.isArray(p.controversias) ? p.controversias : [])) {
    if (!c || !c.questao) continue;
    const ids = l => [...new Set((Array.isArray(l) ? l : []).map(id => mapa[k].get(String(id))).filter(Boolean).map(x => x.id))];
    const nova = { questao: c.questao, favor: ids(c.favor), contra: ids(c.contra) }, pn = pal(c.questao);
    const igual = contr.find(o => { const po = pal(o.questao); let n = 0; for (const w of pn) if (po.has(w)) n++; return pn.size >= 3 && n / Math.min(pn.size, po.size) >= 0.6; });
    if (igual) { igual.favor = [...new Set([...igual.favor, ...nova.favor])]; igual.contra = [...new Set([...igual.contra, ...nova.contra])]; }
    else contr.push(nova);
  } });
  contr.forEach((c, i) => { c.id = `D${i + 1}`; });
  return { atores, controversias: contr, avisos: listas.flatMap(p => (p && Array.isArray(p.avisos) ? p.avisos : [])) };
}

function pe5AplicarRevisao(doc, correcoes, acrescimos) {
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
  // Acréscimos: frase nova logo depois de um trecho existente, no mesmo bloco, com as referências somadas ao "ev".
  for (const c of Array.isArray(acrescimos) ? acrescimos : []) {
    const alvo = String(c?.depois_de || '').trim(), texto = String(c?.texto || '').replace(/\s+/g, ' ').trim();
    if (alvo.length < 12 || texto.length < 12) { ignoradas.push({ ...c, razao: 'acréscimo sem trecho de apoio ou sem texto' }); continue; }
    let n = 0; visita(doc, s => { n += s.split(alvo).length - 1; return s; });
    if (n !== 1) { ignoradas.push({ ...c, razao: n ? 'trecho de apoio aparece mais de uma vez' : 'trecho de apoio não localizado' }); continue; }
    const achar = (o, bloco) => {
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { if (typeof o[i] === 'string') { if (o[i].includes(alvo)) return { obj: o, k: i, bloco }; } else { const r = achar(o[i], bloco); if (r) return r; } } return null; }
      if (o && typeof o === 'object') { const b = Array.isArray(o.ev) ? o : bloco; for (const k of Object.keys(o)) { if (k === 'ev') continue; if (typeof o[k] === 'string') { if (o[k].includes(alvo)) return { obj: o, k, bloco: b }; } else { const r = achar(o[k], b); if (r) return r; } } }
      return null;
    };
    const onde = achar(doc, null);
    if (!onde) { ignoradas.push({ ...c, razao: 'trecho de apoio não localizado' }); continue; }
    const s0 = onde.obj[onde.k], fim = s0.indexOf(alvo) + alvo.length;
    let antes = s0.slice(0, fim), resto = s0.slice(fim);
    // o trecho de apoio parou no meio da frase: o acréscimo entra depois do ponto final dela
    if (!/[.!?…"”)]$/.test(antes.trim())) { const m = resto.match(/^[^.!?]*[.!?]/); if (m) { antes += m[0]; resto = resto.slice(m[0].length); } else { antes = `${antes.trim()}.`; } }
    onde.obj[onde.k] = `${antes.trim()} ${texto}${resto.trim() ? ` ${resto.trim()}` : ''}`;
    if (onde.bloco) for (const e of (Array.isArray(c.ev) ? c.ev : [])) if (/^(G|[A-Z]{1,2}\d{1,3})$/.test(String(e)) && !onde.bloco.ev.includes(e)) onde.bloco.ev.push(e);
    aplicadas.push({ trecho: `(acréscimo depois de) ${alvo.slice(0, 90)}`, novo: texto.slice(0, 200), motivo: String(c.motivo || '') });
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
    const r = await io.chamarModelo({ prompt, pdfBuffers: extra.pdfBuffers || [], web: !!extra.web, etapa: nome, pensar: extra.pensar || 'medio', buscas: extra.buscas || 0 });
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
  // Com mais de um documento a leitura vai em DUAS chamadas, em paralelo: o texto em votação (o que faz, o que
  // muda, os achados) e os documentos de apoio (argumentos, estimativas, emendas, o que ficou sem resposta).
  // Numa chamada só, com nove documentos, a resposta saía resumida demais (ver pe5-prompts.js).
  const baseLeitura = { identificacao: ctx.identificacao, ementa: ctx.ementa, documentos: legiveis, coleta, lentes, catalogo: R.ESPECIALISTAS, textoEmVotacao };
  const duas = legiveis.length >= 2 && ctx.leituraUnica !== true;
  const avisosLeitura = [];
  let r1, Lbruta;
  if (duas) {
    let r1b = null;
    [r1, r1b] = await Promise.all([
      chamar('leitura', R.pe5PromptLeitura({ ...baseLeitura, parte: 'texto' }), { pensar: 'alto', pdfBuffers: ilegiveis }),
      chamar('leitura-apoio', R.pe5PromptLeitura({ ...baseLeitura, parte: 'apoio' }), { pensar: 'alto', pdfBuffers: ilegiveis }).catch(e => ({ text: '', erro: e.message })),
    ]);
    Lbruta = pe5ExtrairJson(r1.text);
    const Lb = r1b && r1b.text ? pe5ExtrairJson(r1b.text) : null;
    if (Lbruta && typeof Lbruta === 'object') {
      if (Lb && typeof Lb === 'object') Lbruta = pe5JuntarLeituras(Lbruta, Lb);
      else avisosLeitura.push(`A leitura dos documentos de apoio (argumentos, estimativas e emendas) ${r1b && r1b.erro ? `falhou: ${r1b.erro}` : r1b && r1b.truncated ? pe5MotivoTruncada(r1b) : 'não devolveu resultado utilizável'}. A nota foi feita só com a leitura do texto em votação.`);
    }
  } else {
    r1 = await chamar('leitura', R.pe5PromptLeitura(baseLeitura), { pensar: 'alto', pdfBuffers: ilegiveis });
    Lbruta = pe5ExtrairJson(r1.text);
  }
  if (!Lbruta || typeof Lbruta !== 'object') return { erro: r1.truncated ? `A leitura veio truncada: ${pe5MotivoTruncada(r1)}` : 'Não consegui interpretar a leitura do modelo.', chamadas };
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
    // Notícias das agências do Congresso: lidas pelo programa e entregues à busca do debate como fonte já coletada.
    let noticias = [];
    if (io.fetchFn && ctx.sigla && ctx.numero && ctx.ano && typeof R.agenciasBuscarNoticias === 'function') {
      passo('lendo as notícias da Agência Senado e da Agência Câmara sobre a matéria…');
      const fetchTexto = async u => { const r = await io.fetchFn(u); if (!r || !r.ok) throw new Error(`HTTP ${r && r.status}`); return typeof r.text === 'function' ? r.text() : Buffer.from(await r.arrayBuffer()).toString('utf8'); };
      try { noticias = await R.agenciasBuscarNoticias({ sigla: ctx.sigla, numero: ctx.numero, ano: ctx.ano, idCamara: ctx.idProposicao || coleta?.proposicao?.id }, fetchTexto); } catch (_) { noticias = []; }
    }
    passo('pesquisando o debate, a experiência de outros países, o contexto jurídico e o histórico no Congresso…');
    const base = { identificacao: ctx.identificacao, ementa: ctx.ementa, leitura, coleta, hoje: hojeBR, noticias };
    const uma = async (nome, prompt, grupos) => {
      try { const r = await chamar(nome, prompt, { web: true, pensar: 'medio', buscas: 5 }); const j = pe5ExtrairJson(r.text); if (!j) return { avisos: [`A pesquisa (${nome}) não devolveu resultado utilizável.`] }; return await pe5LimparPesquisa(j, grupos, io.fetchFn || null); }
      catch (e) { return { avisos: [`A pesquisa (${nome}) falhou: ${e.message}`] }; }
    };
    // O debate vai em QUATRO buscas, uma por grupo de atores, cada uma com os dois lados (ver PE5_GRUPOS_DEBATE).
    // Numa busca só, o modelo voltava com 11 atores onde havia mais de 20; em duas (apoio e crítica), entidades,
    // entes e sociedade civil ficavam com dois ou três nomes (NTA do PLP 299/2026, 21 e 22/11/2026).
    const grupos = Object.keys(R.PE5_GRUPOS_DEBATE || { politica: 1, economia: 1, federacao: 1, sociedade: 1 });
    const nomeDebate = g => (g === 'politica' ? 'pesquisa-debate' : `pesquisa-debate-${g}`);
    const [debates, intl, cx, cg] = await Promise.all([
      Promise.all(grupos.map(g => uma(nomeDebate(g), R.pe5PromptDebate({ ...base, foco: g }), { atores: 'Q' }).then(r => ({ ...r, grupo: (R.PE5_GRUPOS_DEBATE?.[g]?.rotulo) || g })))),
      uma('pesquisa-internacional', R.pe5PromptInternacional(base), { jurisdicoes: 'W' }),
      uma('pesquisa-contexto', R.pe5PromptContexto(base), { jurisprudencia: 'R', normas: 'M', dados: 'F', correlatas: 'K', documentos_base: 'Y', alcance: 'Z' }),
      uma('pesquisa-congresso', R.pe5PromptCongresso(base), { historico: 'H', judicializacao: 'L' }),
    ]);
    const deb = pe5JuntarDebates(...debates);
    // Mínimos (cinco países, quatro decisões): abaixo deles, UMA chamada complementar pede só o que falta.
    const PE5_MIN_PAISES = 5, PE5_MIN_DECISOES = 4;
    const nP = (intl.jurisdicoes || []).length, nD = (cx.jurisprudencia || []).length;
    if (nP < PE5_MIN_PAISES || nD < PE5_MIN_DECISOES) {
      passo('completando a pesquisa (países ou decisões abaixo do mínimo)…');
      const eixos = Array.isArray(intl.eixos) ? intl.eixos : [];
      const comp = await uma('pesquisa-complementar', R.pe5PromptComplementar({ ...base, faltaPaises: Math.max(0, PE5_MIN_PAISES - nP), faltaDecisoes: Math.max(0, PE5_MIN_DECISOES - nD),
        jaPaises: (intl.jurisdicoes || []).map(j => j.lugar), jaDecisoes: (cx.jurisprudencia || []).map(j => `${j.tribunal || ''} ${j.processo || ''}`.trim()), eixosSemPais: eixos.filter(e => !(intl.jurisdicoes || []).some(j => String(j.eixo || '') === e)) }), { jurisdicoes: 'W', jurisprudencia: 'R' });
      const soma = (lista, novos, pref) => { const n0 = lista.length; return [...lista, ...(novos || []).map((x, i) => ({ ...x, id: `${pref}${n0 + i + 1}` }))]; };
      intl.jurisdicoes = soma(intl.jurisdicoes || [], comp.jurisdicoes, 'W');
      cx.jurisprudencia = soma(cx.jurisprudencia || [], comp.jurisprudencia, 'R');
      intl.avisos = [...(intl.avisos || []), ...(comp.avisos || [])];
    }
    pesquisa = { debate: { atores: [], controversias: [], ...deb }, internacional: { jurisdicoes: [], ...intl }, contexto: { jurisprudencia: [], normas: [], dados: [], correlatas: [], ...cx }, congresso: { historico: [], judicializacao: [], ...cg } };
    if (!Array.isArray(pesquisa.debate.controversias)) pesquisa.debate.controversias = [];
    pesquisa.debate.controversias.forEach((c, i) => { if (c && !c.id) c.id = `D${i + 1}`; });
    pesquisa.noticias = noticias.map(n => ({ casa: n.casa, veiculo: n.veiculo, titulo: n.titulo, data: n.data, url: n.url }));
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
  // Quatro chamadas, cada uma com as seções dela (ver pe5-prompts.js): a matéria e o debate em paralelo; depois
  // a análise, que lê a primeira metade; por último os caminhos e a abertura, que leem tudo.
  passo('redigindo a matéria, o debate e a experiência internacional…');
  const obj = r => { const j = pe5ExtrairJson(r.text); return j && typeof j === 'object' ? j : null; };
  const falhou = (r, oQue) => ({ erro: r.truncated ? `${oQue} veio truncada: ${pe5MotivoTruncada(r)}` : `Não consegui interpretar ${oQue.charAt(0).toLowerCase() + oQue.slice(1)}.`, chamadas });
  // "Quem se posicionou e como" tem chamada própria (redacao-1c), sem teto total: o tamanho é o número de atores.
  const [r5, r5b, r5c] = await Promise.all([
    chamar('redacao-1', R.pe5PromptRedacao1({ ...baseRed, parte: 'materia' }), { pensar: 'alto' }),
    chamar('redacao-1b', R.pe5PromptRedacao1({ ...baseRed, parte: 'debate' }), { pensar: 'alto' }),
    chamar('redacao-1c', R.pe5PromptRedacao1({ ...baseRed, parte: 'quem' }), { pensar: 'alto' }),
  ]);
  const j5 = obj(r5), j5b = obj(r5b), j5c = obj(r5c);
  if (!j5) return falhou(r5, 'A redação da matéria');
  if (!j5b) return falhou(r5b, 'A redação do debate');
  if (!j5c) return falhou(r5c, 'A redação de "Quem se posicionou e como"');
  const quem = j5c.quem || {};
  const parte1 = { materia: j5.materia || {}, debate: { ...(j5b.debate || {}), posicoes: Array.isArray(quem.posicoes) ? quem.posicoes : (j5c.debate?.posicoes || j5b.debate?.posicoes || []), sintese: quem.sintese || null }, internacional: j5b.internacional || {} };
  passo('redigindo a análise técnica…');
  // A lei em vigor vai inteira à análise e à revisão: é o que permite ao modelo dizer "a lei atual já tem regra
  // parecida" a partir do texto, e não de memória. Entrada é a parte barata da chamada.
  const leiIntegral = (lv.integrais || []).map(x => `<<<${x.norma} — ${x.origem}>>>\n${String(x.texto).slice(0, 160000)}`).join('\n\n').slice(0, 320000);
  const r6 = await chamar('redacao-2', R.pe5PromptRedacao2({ ...baseRed, parte1, leiIntegral, parte: 'analise' }), { pensar: 'alto' });
  const j6 = obj(r6);
  if (!j6) return falhou(r6, 'A redação da análise');
  passo('redigindo os caminhos e a abertura…');
  const r6b = await chamar('redacao-2b', R.pe5PromptRedacao2({ ...baseRed, parte1, analise: j6.analise || {}, parte: 'caminhos' }), { pensar: 'alto' });
  const j6b = obj(r6b);
  if (!j6b) return falhou(r6b, 'A redação dos caminhos e da abertura');
  const parte2 = { analise: j6.analise || {}, caminhos: j6b.caminhos || {}, abertura: j6b.abertura || {} };
  const doc = { materia: parte1.materia || {}, debate: parte1.debate || {}, internacional: parte1.internacional || {}, analise: parte2.analise || {}, caminhos: parte2.caminhos || {}, abertura: parte2.abertura || {} };

  // --- IA 8: revisão ---
  // A conferência do programa corre ANTES da revisão, e o que ela aponta vai ao revisor para ser corrigido na
  // mesma chamada (número sem base, ausência sem escopo, repetição, item lido e não usado). Antes, a conferência
  // só avisava: a NTA do PLP 299/2026 saiu com quatro ressalvas que ninguém consertou.
  const montar = () => ({
    versao: 5, materia: ctx.identificacao, sigla: ctx.sigla || '', ementa: ctx.ementa || coleta?.proposicao?.ementa || '', textoAnalisado: textoEmVotacao,
    geradoEm: hoje.toISOString(), geradoPor: ctx.geradoPor || '',
    coleta, cambio, inventario, leitura, pesquisa, doc, alteracoes: lv.alteracoes, avisosLei: lv.avisos, revisao: { aplicadas: [], ignoradas: [], observacoes: [] },
    trechos: { conferidos: tr.conferidos, recusados: tr.recusados },
    base: { documentos: legiveis.map(d => d.texto).join('\n'), lei: (lv.integrais || []).map(x => x.texto).join('\n') || lv.textoBase },
  });
  let revisao = { aplicadas: [], ignoradas: [], observacoes: [] };
  if (io.semRevisao !== true) {
    passo('revisão: conferindo o texto e corrigindo o que o programa apontou…');
    try {
      let apontamentos = [];
      try { apontamentos = (R.pe5Conferir(montar(), { hoje }).itens || []).filter(i => !i.ok && i.detalhe && PE5_RE_APONTAMENTO_CORRIGIVEL.test(i.teste)).map(i => `${i.teste}: ${i.detalhe}`.slice(0, 900)); } catch (_) { /* a revisão segue sem os apontamentos */ }
      const r7 = await chamar('revisao', R.pe5PromptRevisao({ ...baseRed, doc, leiIntegral, apontamentos }), { pensar: 'medio' });
      const j = pe5ExtrairJson(r7.text) || {};
      revisao = { ...pe5AplicarRevisao(doc, j.correcoes, j.acrescimos), apontamentos: apontamentos.length, observacoes: (Array.isArray(j.observacoes) ? j.observacoes : []).filter(x => typeof x === 'string').slice(0, 12) };
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
  for (const a of avisosLeitura) p.conferencia.itens.push({ teste: 'Leitura dos documentos de apoio', ok: false, detalhe: a, critico: false });
  for (const a of lv.avisos) p.conferencia.itens.push({ teste: 'Leitura da lei em vigor', ok: false, detalhe: a, critico: false });
  for (const o of revisao.observacoes) p.conferencia.itens.push({ teste: 'Observação da revisão', ok: false, detalhe: o, critico: false });
  const tok = chamadas.reduce((s, c) => ({ entrada: s.entrada + (c.tokens?.entrada || 0), saida: s.saida + (c.tokens?.saida || 0), raciocinio: s.raciocinio + (c.tokens?.raciocinio || 0), total: s.total + (c.tokens?.total || 0) }), { entrada: 0, saida: 0, raciocinio: 0, total: 0 });
  p.consumo = { ...tok, chamadas: chamadas.length, minutos: Math.round((Date.now() - t0) / 6000) / 10 };
  // A base inteira (dezenas de milhares de caracteres) serviu à conferência; não vai para o Firebase.
  delete p.base;
  return p;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gerarParecerPE5, pe5ExtrairJson, pe5ConferirTrechos, pe5JuntarLeituras, pe5JuntarDebates, pe5MotivoTruncada, pe5Cambio, pe5LeiVigente, pe5LimparPesquisa, pe5AplicarRevisao };
}
