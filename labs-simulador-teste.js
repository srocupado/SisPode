'use strict';
// Labs · Simulador de Negociação — TESTE CONTRA O PASSADO (validação).
//
// A pergunta que nenhum dos estudos de simulação com agentes de IA responde
// por nós: no NOSSO caso, os agentes acertam? Aqui se mede. Pega as últimas N
// votações nominais do Plenário em que o Governo orientou Sim ou Não e, para
// cada bancada marcada, compara três previsões com o que a MAIORIA da bancada
// de fato votou (Sim, Não ou Obstrução):
//   1. Estatística — sem IA: se a bancada votou com o Governo em ≥ 50% das
//      votações ANTERIORES do mesmo contexto (consenso ou conflito entre
//      Governo e Oposição — ver smContexto), prevê o voto do Governo; senão,
//      o contrário;
//   2. IA ingênua — uma pergunta só por votação, para todas as bancadas, sem
//      perfil (o que o modelo "acha");
//   3. Agentes do Simulador — um agente por bancada, com o perfil calculado
//      SÓ com votações anteriores à testada.
// Lição dos estudos (Moghimifar et al. 2024; Andric 2026): a estrutura
// sofisticada mal superou uma pergunta simples. Se os agentes não superarem a
// estatística, servem para gerar argumentos, não para estimar posição.
//
// Cuidados que o teste toma: a descrição da votação vem SEM o resultado
// ("Aprovado…", "Sim: 333; Não: 91") — senão a resposta iria junto da
// pergunta; o perfil usa só votações anteriores; o contexto da equipe (que é
// de hoje) não entra. O que ele não controla: o modelo pode ter "lido" na
// internet o resultado de votações anteriores à data de corte dele — a tela
// avisa; votações recentes são o teste mais limpo.
//
// Depende de labs.js, ia-comum.js e labs-simulador.js.

const SM_BT_HIST = '/labs/simulador/validacoes';
const SM_BT_VOTOS = ['Sim', 'Não', 'Obstrução'];
const SM_BT_MAX_SAIDA = 8000;

/**
 * Votação cujo conteúdo a Câmara não informa: a descrição, sem o resultado,
 * fica só "Requerimento." ou "Resultado." (ex.: "Rejeitado o Requerimento.").
 * Medido em 05/2026: requerimentos de procedimento em que o Centrão foi com a
 * Oposição contra o Governo — nenhum método acerta sem saber o que se pedia, e
 * a API não diz. Entram no teste, mas o resultado também sai SEM elas.
 */
function smBtConteudoDesconhecido(descricao) {
  const o = labsSigla(smBtObjeto(descricao)).replace(/[^a-z ]/g, '').trim();
  return !o || ['requerimento', 'resultado'].includes(o);
}

/** Voto normalizado: 'Sim' | 'Não' | 'Obstrução' | null. */
function smBtVoto(t) {
  const s = labsSigla(t);
  return s.startsWith('sim') ? 'Sim' : (s.startsWith('nao') || s === 'n') ? 'Não' : s.startsWith('obstru') ? 'Obstrução' : null;
}

/** A data (AAAA-MM-DD…) de uma votação, para ordenar. */
function smBtData(it) { return String(it.votacao.dataHoraRegistro || it.votacao.data || ''); }

/**
 * Separa teste e treino. Pura. Teste: as `n` votações MAIS RECENTES em que o
 * Governo orientou Sim/Não. Treino: só votações ANTERIORES à primeira testada
 * (o perfil não pode ver o futuro).
 */
function smBtSelecionar(itens, n) {
  const ord = [...(itens || [])].sort((a, b) => smBtData(a).localeCompare(smBtData(b)));
  const comGov = ord.filter(it => {
    const g = labsOrientacao(it.orientacoes, 'Governo');
    return (g === 'Sim' || g === 'Não') && it.votos.some(v => smBtVoto(v.tipoVoto));   // voto secreto não mede nada
  });
  const teste = comGov.slice(-n);
  if (!teste.length) return { teste: [], treino: [] };
  const corte = smBtData(teste[0]);
  return { teste, treino: ord.filter(it => smBtData(it) < corte) };
}

/**
 * O que a MAIORIA da bancada votou (Sim/Não/Obstrução), ou null (sem votos
 * suficientes ou empate). `minimo`: 2, ou 1 para bancada de um deputado.
 */
function smBtMaioria(it, sigla, minimo = 2) {
  const c = { Sim: 0, 'Não': 0, 'Obstrução': 0 };
  for (const v of it.votos) {
    if (((v.deputado_ && v.deputado_.siglaPartido) || '') !== sigla) continue;
    const t = smBtVoto(v.tipoVoto);
    if (t) c[t]++;
  }
  const n = c.Sim + c['Não'] + c['Obstrução'];
  if (n < minimo) return null;
  const o = Object.entries(c).sort((a, b) => b[1] - a[1]);
  return o[0][1] === o[1][1] ? null : o[0][0];
}

/**
 * Previsão estatística: o voto do Governo se a bancada costuma segui-lo NO
 * MESMO CONTEXTO (consenso, conflito ou Oposição sem orientação — ver
 * smContexto); senão o oposto. Contexto com menos de 3 votações no histórico
 * cai no alinhamento geral. Sem a Oposição (oposicao undefined), vale o geral.
 */
function smBtEstatistica(perfil, gov, oposicao) {
  if (!perfil || perfil.alinhamentoGoverno == null) return null;
  let al = perfil.alinhamentoGoverno;
  if (oposicao !== undefined && perfil.porContexto) {
    const x = perfil.porContexto[smContexto(gov, oposicao)];
    if (x && x.n >= 3) al = x.alinhamento;
  }
  return al >= 0.5 ? gov : (gov === 'Sim' ? 'Não' : 'Sim');
}

/** Como a Oposição orientou, em texto para os prompts. */
function smBtTextoOposicao(op) {
  return op ? `A Oposição orientou: ${op}.` : 'A Oposição liberou a bancada ou não orientou Sim/Não.';
}

/**
 * O objeto da votação SEM o resultado: tira "Aprovado/Rejeitado/Mantido…" do
 * começo e o placar ("Sim: 333; Não: 91; Total: 424.") do fim.
 */
function smBtObjeto(descricao) {
  return String(descricao || '')
    .replace(/\s*(?:Sim|Não|Nao)\s*:\s*\d+[\s\S]*$/i, '')
    .replace(/^\s*(?:Aprovad|Rejeitad|Mantid|Derrubad|Prejudicad|Retirad)[a-z]*\s+(?:(?:o|a|os|as)\s+)?/i, '')
    .replace(/\s+/g, ' ').trim();
}

/** Texto da votação para os prompts (data, objeto sem resultado, proposição e ementa). */
function smBtTextoVotacao(it, det) {
  const v = it.votacao;
  const p = det && det.proposicao;
  return [
    `Data: ${String(v.data || v.dataHoraRegistro || '').slice(0, 10)}`,
    `Em votação: ${smBtObjeto(v.descricao) || '(sem descrição)'}`,
    p ? `Proposição: ${p.siglaTipo} ${p.numero}/${p.ano} — ${p.ementa || ''}` : (v.proposicaoObjeto ? `Proposição: ${v.proposicaoObjeto}` : ''),
  ].filter(Boolean).join('\n');
}

/** Prompt do agente no teste: perfil (só do treino) + votação + orientação do Governo. Puro. */
function smBtPromptAgente(sigla, cadeiras, perfil, it, det, gov, op) {
  const linhas = [
    `Você representa a bancada do ${sigla} na Câmara dos Deputados (${cadeiras} deputados em exercício).`,
    'Com base APENAS no perfil abaixo e no conteúdo da votação, diga como a MAIORIA da bancada votou.',
    '',
  ];
  if (perfil && perfil.comparaveis) {
    linhas.push('PERFIL (votações nominais do Plenário ANTERIORES a esta):');
    linhas.push(`- A maioria da bancada votou como o Governo orientou em ${smPct(perfil.alinhamentoGoverno)} das ${perfil.comparaveis} votações.`);
    linhas.push(...smLinhasContexto(perfil));
    if (perfil.comparaveisOrientacao) linhas.push(`- A orientação do líder foi igual à do Governo em ${smPct(perfil.alinhamentoOrientacao)} de ${perfil.comparaveisOrientacao}.`);
    if (perfil.coesao != null) linhas.push(`- Coesão: ${smPct(perfil.coesao)}.`);
    if (perfil.divergencias.length) {
      linhas.push('- Votações recentes em que a bancada votou contra o Governo:');
      for (const d of perfil.divergencias) linhas.push('  • ' + d);
    }
  } else {
    linhas.push('PERFIL: sem votações anteriores suficientes.');
  }
  linhas.push('', 'VOTAÇÃO:', smBtTextoVotacao(it, det), `O Governo orientou: ${gov}.`, smBtTextoOposicao(op), '');
  linhas.push('Responda SOMENTE com um objeto JSON: {"voto":"Sim|Não|Obstrução","confianca":1}  (confiança de 1 a 5)');
  return linhas.join('\n');
}

/** Prompt da IA ingênua: uma pergunta por votação, todas as bancadas, sem perfil. Puro. */
function smBtPromptIngenuo(siglas, it, det, gov, op) {
  return [
    'Votação nominal no Plenário da Câmara dos Deputados:',
    smBtTextoVotacao(it, det),
    `O Governo orientou: ${gov}.`,
    smBtTextoOposicao(op),
    '',
    'Para cada partido abaixo, diga como a MAIORIA da bancada votou.',
    `Partidos: ${siglas.join(', ')}`,
    `Responda SOMENTE com um objeto JSON, uma chave por partido: {${siglas.map(s => `"${s}":"Sim|Não|Obstrução"`).join(',')}}`,
  ].join('\n');
}

function smBtJson(texto) {
  let t = String(texto || '').trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) t = cerca[1].trim();
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i < 0 || f <= i) throw new Error('resposta sem JSON');
  return JSON.parse(t.slice(i, f + 1));
}

function smBtLerAgente(texto) { return smBtVoto(smBtJson(texto).voto); }

function smBtLerIngenuo(texto, siglas) {
  const j = smBtJson(texto);
  const porSigla = {};
  for (const [k, v] of Object.entries(j)) porSigla[labsSigla(k)] = smBtVoto(v);
  const out = {};
  for (const s of siglas) out[s] = porSigla[labsSigla(s)] || null;
  return out;
}

/**
 * Métricas de [{ verdade, previsto }]. Pura. Previsão ausente (null) conta como
 * erro. F1 macro sobre as classes que aparecem na verdade.
 */
function smBtMetricas(pares) {
  const ps = (pares || []).filter(p => p.verdade);
  const n = ps.length;
  const acertos = ps.filter(p => p.previsto === p.verdade).length;
  const classes = SM_BT_VOTOS.filter(c => ps.some(p => p.verdade === c));
  const f1s = classes.map(c => {
    const tp = ps.filter(p => p.previsto === c && p.verdade === c).length;
    const fp = ps.filter(p => p.previsto === c && p.verdade !== c).length;
    const fn = ps.filter(p => p.verdade === c && p.previsto !== c).length;
    return tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
  });
  return {
    n, acertos,
    acuracia: n ? acertos / n : null,
    macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    cobertura: n ? ps.filter(p => p.previsto).length / n : null,
  };
}

// ---------- tela ----------
function smBtPartidos() {
  return (sm.agentes || []).filter(a => a.marcado && a.tipo === 'partido');
}

function smBtAtualizarCusto() {
  const el = smEl('smTesteCusto');
  if (!el) return;
  const n = parseInt(smEl('smTesteN').value, 10) || 10;
  const p = smBtPartidos().length;
  el.textContent = p
    ? `Custo estimado: ${n * p + n} chamadas de IA (${n} votações × ${p} bancadas marcadas, mais ${n} da IA ingênua), no modelo dos agentes.`
    : 'Marque ao menos uma bancada partidária na lista de agentes acima.';
}

/** Detalhe da votação (proposição e ementa) — sem ele, o teste segue só com a descrição. */
async function smBtDetalhe(it) {
  try {
    const d = (await labsJson(`${LABS_API}/votacoes/${encodeURIComponent(it.votacao.id)}`)).dados || {};
    const p = (d.proposicoesAfetadas || [])[0] || null;
    return { proposicao: p };
  } catch (e) { return { proposicao: null }; }
}

async function smTestarClick() {
  const bt = smEl('smTestar');
  const partidos = smBtPartidos();
  if (!partidos.length) { labsStatus('smTesteStatus', 'Marque ao menos uma bancada partidária na lista de agentes.', 'error'); return; }
  const cfg = await labsConfigIA();
  if (!cfg.apiKey) { labsStatus('smTesteStatus', 'Nenhuma chave de IA configurada. Clique no ⚙ no alto da página.', 'error'); return; }
  const n = parseInt(smEl('smTesteN').value, 10) || 10;
  const meses = parseInt(smEl('smMeses').value, 10) || 6;
  const chamadas = n * partidos.length + n;
  if (!confirm(`O teste faz cerca de ${chamadas} chamadas de IA pela sua chave. Continuar?`)) return;
  const modelo = (smEl('smModeloAgentes') && smEl('smModeloAgentes').value) || cfg.modelo || '';
  const custo = { ok: 0, erro: 0, cortadas: 0 };
  const ia = async prompt => {
    try {
      // Limite folgado: nos modelos que "pensam" (Gemini 2.5+/3, raciocínio da
      // OpenAI/Anthropic), o raciocínio conta dentro do limite de saída — com
      // 1.500 a resposta de um modelo mais forte era cortada e virava "sem
      // previsão", punindo-o pelo limite e não pela qualidade. Só se paga o
      // que é gerado; a resposta útil tem poucas dezenas de tokens.
      const r = await chamarIA({ provedorId: cfg.provedor || 'gemini', apiKey: cfg.apiKey, modelo: modelo || undefined, prompt, opcoes: { maxSaida: SM_BT_MAX_SAIDA } });
      custo.ok++;
      if (r.truncated) custo.cortadas++;
      return r.text;
    } catch (e) { custo.erro++; throw e; }
  };
  bt.disabled = true;
  smEl('smTesteResultado').innerHTML = '';
  try {
    labsStatus('smTesteStatus', 'Buscando as votações…', 'loading');
    // Período do perfil + folga para as votações testadas.
    const { itens } = await labsVotacoesPlenario(meses + 2, m => labsStatus('smTesteStatus', m, 'loading'));
    const { teste, treino } = smBtSelecionar(itens, n);
    if (teste.length < 3 || !treino.length) throw new Error('votações insuficientes no período para separar teste e histórico — aumente o período do perfil.');
    const siglas = partidos.map(p => p.sigla);
    const perfis = smPerfis(treino, siglas);
    const maxVot = {};
    for (const it of itens) {
      const c = {};
      for (const v of it.votos) { const p = (v.deputado_ && v.deputado_.siglaPartido) || ''; c[p] = (c[p] || 0) + 1; }
      for (const s of siglas) maxVot[s] = Math.max(maxVot[s] || 0, c[s] || 0);
    }
    const linhas = [];   // { votacao, sigla, verdade, est, ing, ag }
    let feitas = 0;
    await labsMapLimit(teste, 2, async it => {
      const gov = labsOrientacao(it.orientacoes, 'Governo');
      const op = labsOrientacao(it.orientacoes, 'Oposição');   // anunciada antes do voto: informação legítima
      const det = await smBtDetalhe(it);
      let ing = {};
      try { ing = smBtLerIngenuo(await ia(smBtPromptIngenuo(siglas, it, det, gov, op)), siglas); } catch (_) {}
      const ags = await labsMapLimit(partidos, 3, async p => {
        try { return smBtLerAgente(await ia(smBtPromptAgente(p.sigla, p.cadeiras, perfis[p.sigla], it, det, gov, op))); }
        catch (_) { return null; }
      });
      const propRot = det.proposicao ? `${det.proposicao.siglaTipo} ${det.proposicao.numero}/${det.proposicao.ano}` : String(it.votacao.proposicaoObjeto || '');
      partidos.forEach((p, k) => linhas.push({
        votacao: it.votacao, sigla: p.sigla, gov, op, prop: propRot, desconhecido: smBtConteudoDesconhecido(it.votacao.descricao),
        verdade: smBtMaioria(it, p.sigla, Math.min(2, maxVot[p.sigla] || 0)),
        est: smBtEstatistica(perfis[p.sigla], gov, op), ing: ing[p.sigla] || null, ag: ags[k], contexto: smContexto(gov, op),
      }));
      feitas++;
      labsStatus('smTesteStatus', `Testando… ${feitas}/${teste.length} votações (${custo.ok} chamadas)`, 'loading');
    });
    const met = k => smBtMetricas(linhas.map(l => ({ verdade: l.verdade, previsto: l[k] })));
    const res = {
      em: new Date().toISOString(), quem: (smEl('smQuem') && smEl('smQuem').value.trim()) || '',
      provedor: cfg.provedor || 'gemini', modelo: modelo || '(padrão)', meses, votacoes: teste.length,
      periodoTeste: [smBtData(teste[0]).slice(0, 10), smBtData(teste[teste.length - 1]).slice(0, 10)],
      partidos: siglas, chamadas: custo.ok, falhasIA: custo.erro, cortadas: custo.cortadas, maxSaida: SM_BT_MAX_SAIDA,
      metricas: { estatistica: met('est'), ingenua: met('ing'), agentes: met('ag') },
      comparacao: { agentesVsEstatistica: smBtComparar(linhas, 'ag', 'est'), agentesVsIngenua: smBtComparar(linhas, 'ag', 'ing') },
      porContexto: Object.fromEntries(['consenso', 'conflito', 'semOposicao'].map(c => {
        const ls = linhas.filter(l => l.contexto === c);
        const m = k => smBtMetricas(ls.map(l => ({ verdade: l.verdade, previsto: l[k] })));
        return [c, { estatistica: m('est').acuracia, ingenua: m('ing').acuracia, agentes: m('ag').acuracia, n: m('est').n }];
      })),
      porVotacao: smBtPorVotacao(linhas),
      semDesconhecido: (() => {
        const ls = linhas.filter(l => !l.desconhecido);
        const m = k => smBtMetricas(ls.map(l => ({ verdade: l.verdade, previsto: l[k] })));
        return { votacoes: new Set(ls.map(l => String(l.votacao.id))).size, estatistica: m('est'), ingenua: m('ing'), agentes: m('ag') };
      })(),
      porPartido: Object.fromEntries(siglas.map(s => {
        const ls = linhas.filter(l => l.sigla === s);
        const m = k => smBtMetricas(ls.map(l => ({ verdade: l.verdade, previsto: l[k] })));
        return [labsSanitizar(s), { sigla: s, estatistica: m('est').acuracia, ingenua: m('ing').acuracia, agentes: m('ag').acuracia, n: m('est').n }];
      })),
    };
    labsStatus('smTesteStatus', '');
    smBtRender(res);
    try {
      await fetch(`${LABS_FIREBASE}${SM_BT_HIST}/${Date.now()}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res) });
      smBtCarregarHistorico();
    } catch (_) {}
  } catch (e) {
    labsStatus('smTesteStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

/**
 * A diferença entre dois métodos é real ou acaso? Pura. Olha só os pares em
 * que UM acertou e o OUTRO errou (b = A acertou e B errou; c = o contrário) —
 * teste de McNemar, com aproximação normal: significativo se |b − c| > 1,96·√(b + c)
 * e houver ao menos 6 pares discordantes. Com 5 votações, quase nunca é.
 */
function smBtComparar(linhas, kA, kB) {
  let b = 0, c = 0;
  for (const l of linhas) {
    if (!l.verdade) continue;
    const a = l[kA] === l.verdade, bb = l[kB] === l.verdade;
    if (a && !bb) b++; else if (!a && bb) c++;
  }
  const significativo = b + c >= 6 && Math.abs(b - c) > 1.96 * Math.sqrt(b + c);
  return { b, c, significativo };
}

/**
 * O teste visto POR VOTAÇÃO. Pura. As bancadas votam em bloco: acertar uma
 * votação de conflito costuma acertar 4 ou 5 bancadas de uma vez, e contar
 * cada bancada como caso independente exagera a confiança. Aqui cada votação
 * é um caso: quantas bancadas cada método acertou nela.
 * Devolve [{ id, data, objeto, prop, gov, op, contexto, n, acertos: {est, ing, ag},
 *   partidos: { SIGLA: { v, est, ing, ag } } }], em ordem de data.
 */
function smBtPorVotacao(linhas) {
  const porId = new Map();
  for (const l of linhas || []) {
    const id = String(l.votacao.id);
    if (!porId.has(id)) porId.set(id, {
      id, data: String(l.votacao.data || l.votacao.dataHoraRegistro || '').slice(0, 10),
      objeto: smBtObjeto(l.votacao.descricao).slice(0, 160), prop: l.prop || '', gov: l.gov || '', op: l.op || '',
      contexto: l.contexto || '', desconhecido: !!l.desconhecido, n: 0, acertos: { est: 0, ing: 0, ag: 0 }, partidos: {},
    });
    const v = porId.get(id);
    v.partidos[labsSanitizar(l.sigla)] = { v: l.verdade || '', est: l.est || '', ing: l.ing || '', ag: l.ag || '' };
    if (!l.verdade) continue;
    v.n++;
    for (const k of ['est', 'ing', 'ag']) if (l[k] === l.verdade) v.acertos[k]++;
  }
  return [...porId.values()].sort((a, b) => a.data.localeCompare(b.data));
}

/** P-valor bilateral exato do teste do sinal (binomial, p = 1/2). */
function smBtBinomial(k, n) {
  if (!n) return 1;
  const m = Math.min(k, n - k);
  let soma = 0, c = 1;                        // C(n, 0)
  for (let i = 0; i <= m; i++) { soma += c; c = c * (n - i) / (i + 1); }
  return Math.min(1, 2 * soma / Math.pow(2, n));
}

/**
 * Veredito por votação (teste do sinal): em quantas votações A acertou MAIS
 * bancadas que B, em quantas menos, em quantas empatou. Empates ficam de fora;
 * significativo se p < 0,05 (exige ao menos 6 votações com diferença).
 */
function smBtSinal(porVotacao, kA, kB) {
  let melhor = 0, pior = 0, empate = 0;
  for (const v of porVotacao || []) {
    if (!v.n) continue;
    const d = v.acertos[kA] - v.acertos[kB];
    if (d > 0) melhor++; else if (d < 0) pior++; else empate++;
  }
  const p = smBtBinomial(melhor, melhor + pior);
  return { melhor, pior, empate, p, significativo: melhor + pior >= 6 && p < 0.05 };
}

function smBtPct(x) { return x == null ? '—' : (x * 100).toFixed(0) + '%'; }

function smBtRender(r) {
  const M = r.metricas;
  const linha = (rot, m, desc) => `<tr><td><b>${rot}</b><div class="base">${desc}</div></td><td style="text-align:right">${smBtPct(m.acuracia)}</td><td style="text-align:right">${smBtPct(m.macroF1)}</td><td style="text-align:right">${smBtPct(m.cobertura)}</td></tr>`;
  const melhorAg = M.agentes.acuracia != null && M.estatistica.acuracia != null ? M.agentes.acuracia - M.estatistica.acuracia : null;
  const pontos = melhorAg == null ? '' : `${Math.abs(melhorAg * 100).toFixed(0)} pontos ${melhorAg >= 0 ? 'a mais' : 'a menos'}`;
  const cmp = (r.comparacao || {}).agentesVsEstatistica;
  const pares = cmp ? ` Por bancada: ${cmp.b} acertos só dos agentes × ${cmp.c} só da estatística.` : '';
  const sv = r.porVotacao && r.porVotacao.length ? smBtSinal(r.porVotacao, 'ag', 'est') : null;
  const pTxt = sv ? (sv.p < 0.001 ? 'p < 0,001' : 'p = ' + sv.p.toFixed(3).replace('.', ',')) : '';
  const contagem = sv ? `os agentes acertaram mais bancadas que a estatística em <b>${sv.melhor}</b> votação(ões), menos em <b>${sv.pior}</b> e empataram em ${sv.empate} (${pTxt})` : '';
  // O veredito conta VOTAÇÕES (bancadas votam em bloco e não são casos independentes);
  // sem o detalhe por votação (testes antigos), cai na contagem por bancada.
  const veredito = melhorAg == null ? ''
    : sv
      ? (!sv.significativo
          ? `<b>Empate técnico:</b> no total, os agentes acertaram ${pontos} que a estatística, mas, contando por votação, ${contagem} — a diferença cabe no acaso. Rode com mais votações ou em outro período.${pares}`
          : sv.melhor > sv.pior
            ? `<b>Agentes melhores:</b> ${pontos} no total e, contando por votação, ${contagem} — a diferença não parece acaso.${pares}`
            : `<b>Estatística melhor:</b> ${pontos} para os agentes no total e, contando por votação, ${contagem}. Para estimar posição, use a estatística; o Simulador, para preparar argumentos.${pares}`)
      : (cmp && !cmp.significativo
          ? `<b>Empate técnico:</b> os agentes acertaram ${pontos} que a estatística, mas a diferença cabe no acaso.${pares}`
          : `Os agentes acertaram <b>${pontos}</b> que a estatística (contagem por bancada).${pares}`);
  const partidos = Object.values(r.porPartido || {}).sort((a, b) => a.sigla.localeCompare(b.sigla));
  smEl('smTesteResultado').innerHTML = `
    <div class="sub" style="margin-top:8px">${r.votacoes} votações de ${labsEsc(r.periodoTeste[0])} a ${labsEsc(r.periodoTeste[1])} ·
      ${r.partidos.length} bancadas · ${r.chamadas} chamadas (${labsEsc(r.provedor)} · ${labsEsc(r.modelo)})${r.falhasIA ? ` · ${r.falhasIA} falharam` : ''}${r.cortadas ? ` · <b>${r.cortadas} respostas cortadas pelo limite</b> (contam como sem previsão)` : ''}.
      Acerto = previsão igual ao voto da MAIORIA da bancada.</div>
    <table class="labs-tab" style="margin-top:6px"><tr><th>Método</th><th style="text-align:right">Acerto</th><th style="text-align:right">F1 macro</th><th style="text-align:right">Cobertura</th></tr>
      ${linha('Estatística (sem IA)', M.estatistica, 'segue o Governo se a bancada o seguiu em ≥ 50% das votações anteriores do mesmo contexto (consenso ou conflito com a Oposição)')}
      ${linha('IA ingênua', M.ingenua, 'uma pergunta por votação, sem perfil')}
      ${linha('Agentes do Simulador', M.agentes, 'um agente por bancada, com o perfil das votações anteriores')}
    </table>
    ${veredito ? `<div class="labs-aviso" style="margin-top:8px">${veredito}</div>` : ''}
    ${smBtRenderSemDesconhecido(r)}
    ${r.porContexto ? `<table class="labs-tab" style="margin-top:8px"><tr><th>Contexto da votação</th><th style="text-align:right">Estatística</th><th style="text-align:right">IA ingênua</th><th style="text-align:right">Agentes</th><th style="text-align:right">Pares</th></tr>
      ${['consenso', 'conflito', 'semOposicao'].filter(c => r.porContexto[c] && r.porContexto[c].n).map(c => { const x = r.porContexto[c];
        return `<tr><td>${labsEsc(SM_ROT_CONTEXTO[c])}</td><td style="text-align:right">${smBtPct(x.estatistica)}</td><td style="text-align:right">${smBtPct(x.ingenua)}</td><td style="text-align:right">${smBtPct(x.agentes)}</td><td style="text-align:right">${x.n}</td></tr>`; }).join('')}
    </table>` : ''}
    <table class="labs-tab" style="margin-top:8px"><tr><th>Bancada</th><th style="text-align:right">Estatística</th><th style="text-align:right">IA ingênua</th><th style="text-align:right">Agentes</th><th style="text-align:right">Votações</th></tr>
      ${partidos.map(p => `<tr><td>${labsEsc(p.sigla)}</td><td style="text-align:right">${smBtPct(p.estatistica)}</td><td style="text-align:right">${smBtPct(p.ingenua)}</td><td style="text-align:right">${smBtPct(p.agentes)}</td><td style="text-align:right">${p.n}</td></tr>`).join('')}
    </table>
    ${smBtRenderVotacoes(r)}
    <div class="labs-custo">Cuidados: amostra pequena (poucas votações oscilam muito o resultado); o modelo pode ter visto na internet o
      resultado de votações anteriores à data de corte dele — votações recentes são o teste mais limpo; F1 macro pesa igualmente Sim, Não e
      Obstrução (acertar só a classe mais comum não basta). O contexto da equipe não entra no teste (é informação de hoje).</div>`;
}

/** Linha "sem as votações de conteúdo desconhecido" (só quando houver alguma). */
function smBtRenderSemDesconhecido(r) {
  const sd = r.semDesconhecido;
  const nDesc = (r.porVotacao || []).filter(v => v.desconhecido).length;
  if (!sd || !nDesc) return '';
  const sv = smBtSinal((r.porVotacao || []).filter(v => !v.desconhecido), 'ag', 'est');
  const p = sv.p < 0.001 ? 'p < 0,001' : 'p = ' + sv.p.toFixed(3).replace('.', ',');
  return `<div class="labs-custo" style="margin-top:6px"><b>Sem as ${nDesc} votação(ões) de conteúdo desconhecido</b> (a Câmara descreve só
    "Requerimento." ou "Resultado.", sem dizer o que se votava — marcadas na tabela por votação), sobre ${sd.votacoes} votações:
    estatística ${smBtPct(sd.estatistica.acuracia)} · IA ingênua ${smBtPct(sd.ingenua.acuracia)} · <b>agentes ${smBtPct(sd.agentes.acuracia)}</b>;
    por votação, agentes melhores em ${sv.melhor}, piores em ${sv.pior}, empate em ${sv.empate} (${p}${sv.significativo ? '' : ' — empate técnico'}).</div>`;
}

const SM_BT_CTX_CURTO = { consenso: 'consenso', conflito: 'conflito', semOposicao: 'Oposição liberou' };

/** Tabela por votação, com o detalhe por bancada recolhido. */
function smBtRenderVotacoes(r) {
  const vs = r.porVotacao || [];
  if (!vs.length) return '';
  const marca = (prev, v) => !prev ? '<span class="base">—</span>' : prev === v ? `<span class="sm-acao-apoia">${labsEsc(prev)} ✓</span>` : `<span class="sm-acao-rejeita">${labsEsc(prev)} ✗</span>`;
  const cel = (v, k) => {
    const x = v.acertos[k], melhor = Math.max(v.acertos.est, v.acertos.ing, v.acertos.ag);
    return `<td style="text-align:right">${x === melhor && v.n ? '<b>' : ''}${x}/${v.n}${x === melhor && v.n ? '</b>' : ''}</td>`;
  };
  return `<div class="sub" style="margin-top:10px"><b>Por votação</b> — bancadas que cada método acertou; clique na votação para ver bancada a bancada.</div>
    <div style="overflow-x:auto"><table class="labs-tab" style="margin-top:4px"><tr><th>Data</th><th>Votação</th><th>Contexto</th><th style="text-align:right">Estatística</th><th style="text-align:right">IA ingênua</th><th style="text-align:right">Agentes</th></tr>
    ${vs.map(v => `<tr><td>${labsEsc(v.data)}</td><td><details><summary>${labsEsc(v.prop ? v.prop + ' — ' : '')}${labsEsc(v.objeto || v.id)}${v.desconhecido ? ' <span class="sm-sembase" title="A Câmara não informa o que se votava">conteúdo desconhecido</span>' : ''}</summary>
        <div class="base">Governo: ${labsEsc(v.gov || '—')} · Oposição: ${labsEsc(v.op || 'liberou/não orientou')}</div>
        <table class="labs-tab"><tr><th>Bancada</th><th>Votou</th><th>Estatística</th><th>IA ingênua</th><th>Agentes</th></tr>
        ${Object.entries(v.partidos).sort((a, b) => a[0].localeCompare(b[0])).map(([sg, x]) => `<tr><td>${labsEsc(sg)}</td><td>${labsEsc(x.v || '—')}</td><td>${x.v ? marca(x.est, x.v) : '—'}</td><td>${x.v ? marca(x.ing, x.v) : '—'}</td><td>${x.v ? marca(x.ag, x.v) : '—'}</td></tr>`).join('')}
        </table></details></td>
      <td>${labsEsc(SM_BT_CTX_CURTO[v.contexto] || v.contexto)}</td>${cel(v, 'est')}${cel(v, 'ing')}${cel(v, 'ag')}</tr>`).join('')}
    </table></div>`;
}

async function smBtCarregarHistorico() {
  const el = smEl('smTesteHistorico');
  if (!el) return;
  try {
    const h = (await labsJson(`${LABS_FIREBASE}${SM_BT_HIST}.json?orderBy=%22$key%22&limitToLast=8`)) || {};
    const itens = Object.values(h).filter(x => x && x.metricas).sort((a, b) => String(b.em).localeCompare(String(a.em)));
    el.innerHTML = itens.length ? `<div class="sub" style="margin-top:8px"><b>Testes anteriores</b> (acerto: estatística / IA ingênua / agentes)</div>
      <table class="labs-tab">${itens.map(x => `<tr><td>${labsEsc(new Date(x.em).toLocaleDateString('pt-BR'))}${x.quem ? ' · ' + labsEsc(x.quem) : ''}</td>
        <td>${labsEsc(x.modelo)} · ${x.votacoes} votações · ${(x.partidos || []).length} bancadas</td>
        <td style="text-align:right">${smBtPct(x.metricas.estatistica.acuracia)} / ${smBtPct(x.metricas.ingenua.acuracia)} / <b>${smBtPct(x.metricas.agentes.acuracia)}</b></td>
        <td class="base">${(() => { if (!x.porVotacao) return 'sem detalhe por votação'; const v = smBtSinal(x.porVotacao, 'ag', 'est');
          return `por votação: agentes melhores em ${v.melhor}, piores em ${v.pior}${v.significativo ? '' : ' (empate técnico)'}`; })()}</td></tr>`).join('')}</table>` : '';
  } catch (_) { el.innerHTML = ''; }
}

if (smEl('smTestar')) {
  smEl('smTestar').addEventListener('click', smTestarClick);
  smEl('smTesteN').addEventListener('change', smBtAtualizarCusto);
  smEl('smBancadas').addEventListener('change', smBtAtualizarCusto);
  let carregou = false;
  document.addEventListener('labs:aba', ev => {
    if (ev.detail === 'aba-simulador' && !carregou) { carregou = true; smBtCarregarHistorico(); }
  });
}
