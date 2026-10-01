'use strict';
// Labs · Simulador de Negociação — TESTE CONTRA O PASSADO (validação).
//
// A pergunta que nenhum dos estudos de simulação com agentes de IA responde
// por nós: no NOSSO caso, os agentes acertam? Aqui se mede. Pega as últimas N
// votações nominais do Plenário em que o Governo orientou Sim ou Não e, para
// cada bancada marcada, compara três previsões com o que a MAIORIA da bancada
// de fato votou (Sim, Não ou Obstrução):
//   1. Estatística — sem IA: se a bancada votou com o Governo em ≥ 50% das
//      votações ANTERIORES, prevê o voto do Governo; senão, o contrário;
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

/** Previsão estatística: o voto do Governo se a bancada costuma segui-lo; senão o oposto. */
function smBtEstatistica(perfil, gov) {
  if (!perfil || perfil.alinhamentoGoverno == null) return null;
  return perfil.alinhamentoGoverno >= 0.5 ? gov : (gov === 'Sim' ? 'Não' : 'Sim');
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
function smBtPromptAgente(sigla, cadeiras, perfil, it, det, gov) {
  const linhas = [
    `Você representa a bancada do ${sigla} na Câmara dos Deputados (${cadeiras} deputados em exercício).`,
    'Com base APENAS no perfil abaixo e no conteúdo da votação, diga como a MAIORIA da bancada votou.',
    '',
  ];
  if (perfil && perfil.comparaveis) {
    linhas.push('PERFIL (votações nominais do Plenário ANTERIORES a esta):');
    linhas.push(`- A maioria da bancada votou como o Governo orientou em ${smPct(perfil.alinhamentoGoverno)} das ${perfil.comparaveis} votações.`);
    if (perfil.comparaveisOrientacao) linhas.push(`- A orientação do líder foi igual à do Governo em ${smPct(perfil.alinhamentoOrientacao)} de ${perfil.comparaveisOrientacao}.`);
    if (perfil.coesao != null) linhas.push(`- Coesão: ${smPct(perfil.coesao)}.`);
    if (perfil.divergencias.length) {
      linhas.push('- Votações recentes em que a bancada votou contra o Governo:');
      for (const d of perfil.divergencias) linhas.push('  • ' + d);
    }
  } else {
    linhas.push('PERFIL: sem votações anteriores suficientes.');
  }
  linhas.push('', 'VOTAÇÃO:', smBtTextoVotacao(it, det), `O Governo orientou: ${gov}.`, '');
  linhas.push('Responda SOMENTE com um objeto JSON: {"voto":"Sim|Não|Obstrução","confianca":1}  (confiança de 1 a 5)');
  return linhas.join('\n');
}

/** Prompt da IA ingênua: uma pergunta por votação, todas as bancadas, sem perfil. Puro. */
function smBtPromptIngenuo(siglas, it, det, gov) {
  return [
    'Votação nominal no Plenário da Câmara dos Deputados:',
    smBtTextoVotacao(it, det),
    `O Governo orientou: ${gov}.`,
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
  const custo = { ok: 0, erro: 0 };
  const ia = async prompt => {
    try {
      const r = await chamarIA({ provedorId: cfg.provedor || 'gemini', apiKey: cfg.apiKey, modelo: modelo || undefined, prompt, opcoes: { maxSaida: 1500 } });
      custo.ok++;
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
      const det = await smBtDetalhe(it);
      let ing = {};
      try { ing = smBtLerIngenuo(await ia(smBtPromptIngenuo(siglas, it, det, gov)), siglas); } catch (_) {}
      const ags = await labsMapLimit(partidos, 3, async p => {
        try { return smBtLerAgente(await ia(smBtPromptAgente(p.sigla, p.cadeiras, perfis[p.sigla], it, det, gov))); }
        catch (_) { return null; }
      });
      partidos.forEach((p, k) => linhas.push({
        votacao: it.votacao, sigla: p.sigla,
        verdade: smBtMaioria(it, p.sigla, Math.min(2, maxVot[p.sigla] || 0)),
        est: smBtEstatistica(perfis[p.sigla], gov), ing: ing[p.sigla] || null, ag: ags[k],
      }));
      feitas++;
      labsStatus('smTesteStatus', `Testando… ${feitas}/${teste.length} votações (${custo.ok} chamadas)`, 'loading');
    });
    const met = k => smBtMetricas(linhas.map(l => ({ verdade: l.verdade, previsto: l[k] })));
    const res = {
      em: new Date().toISOString(), quem: (smEl('smQuem') && smEl('smQuem').value.trim()) || '',
      provedor: cfg.provedor || 'gemini', modelo: modelo || '(padrão)', meses, votacoes: teste.length,
      periodoTeste: [smBtData(teste[0]).slice(0, 10), smBtData(teste[teste.length - 1]).slice(0, 10)],
      partidos: siglas, chamadas: custo.ok, falhasIA: custo.erro,
      metricas: { estatistica: met('est'), ingenua: met('ing'), agentes: met('ag') },
      comparacao: { agentesVsEstatistica: smBtComparar(linhas, 'ag', 'est'), agentesVsIngenua: smBtComparar(linhas, 'ag', 'ing') },
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

function smBtPct(x) { return x == null ? '—' : (x * 100).toFixed(0) + '%'; }

function smBtRender(r) {
  const M = r.metricas;
  const linha = (rot, m, desc) => `<tr><td><b>${rot}</b><div class="base">${desc}</div></td><td style="text-align:right">${smBtPct(m.acuracia)}</td><td style="text-align:right">${smBtPct(m.macroF1)}</td><td style="text-align:right">${smBtPct(m.cobertura)}</td></tr>`;
  const melhorAg = M.agentes.acuracia != null && M.estatistica.acuracia != null ? M.agentes.acuracia - M.estatistica.acuracia : null;
  const cmp = (r.comparacao || {}).agentesVsEstatistica;
  const disc = cmp ? ` (pares em que só um acertou: agentes ${cmp.b} × estatística ${cmp.c})` : '';
  const pontos = melhorAg == null ? '' : `${Math.abs(melhorAg * 100).toFixed(0)} pontos ${melhorAg >= 0 ? 'a mais' : 'a menos'}`;
  const veredito = melhorAg == null ? ''
    : cmp && !cmp.significativo
      ? `<b>Empate técnico:</b> os agentes acertaram ${pontos} que a estatística, mas a diferença cabe no acaso${disc}. Rode com mais votações (20 ou 30) para separar um do outro.`
      : melhorAg > 0
        ? `Os agentes acertaram <b>${pontos}</b> que a estatística, e a diferença não parece acaso${disc}.`
        : `Os agentes acertaram <b>${pontos}</b> que a estatística, e a diferença não parece acaso${disc}: para estimar posição, a estatística é melhor — use o Simulador para preparar argumentos.`;
  const partidos = Object.values(r.porPartido || {}).sort((a, b) => a.sigla.localeCompare(b.sigla));
  smEl('smTesteResultado').innerHTML = `
    <div class="sub" style="margin-top:8px">${r.votacoes} votações de ${labsEsc(r.periodoTeste[0])} a ${labsEsc(r.periodoTeste[1])} ·
      ${r.partidos.length} bancadas · ${r.chamadas} chamadas (${labsEsc(r.provedor)} · ${labsEsc(r.modelo)})${r.falhasIA ? ` · ${r.falhasIA} falharam` : ''}.
      Acerto = previsão igual ao voto da MAIORIA da bancada.</div>
    <table class="labs-tab" style="margin-top:6px"><tr><th>Método</th><th style="text-align:right">Acerto</th><th style="text-align:right">F1 macro</th><th style="text-align:right">Cobertura</th></tr>
      ${linha('Estatística (sem IA)', M.estatistica, 'segue o Governo se a bancada o seguiu em ≥ 50% das votações anteriores')}
      ${linha('IA ingênua', M.ingenua, 'uma pergunta por votação, sem perfil')}
      ${linha('Agentes do Simulador', M.agentes, 'um agente por bancada, com o perfil das votações anteriores')}
    </table>
    ${veredito ? `<div class="labs-aviso" style="margin-top:8px">${veredito}</div>` : ''}
    <table class="labs-tab" style="margin-top:8px"><tr><th>Bancada</th><th style="text-align:right">Estatística</th><th style="text-align:right">IA ingênua</th><th style="text-align:right">Agentes</th><th style="text-align:right">Votações</th></tr>
      ${partidos.map(p => `<tr><td>${labsEsc(p.sigla)}</td><td style="text-align:right">${smBtPct(p.estatistica)}</td><td style="text-align:right">${smBtPct(p.ingenua)}</td><td style="text-align:right">${smBtPct(p.agentes)}</td><td style="text-align:right">${p.n}</td></tr>`).join('')}
    </table>
    <div class="labs-custo">Cuidados: amostra pequena (poucas votações oscilam muito o resultado); o modelo pode ter visto na internet o
      resultado de votações anteriores à data de corte dele — votações recentes são o teste mais limpo; F1 macro pesa igualmente Sim, Não e
      Obstrução (acertar só a classe mais comum não basta). O contexto da equipe não entra no teste (é informação de hoje).</div>`;
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
        <td style="text-align:right">${smBtPct(x.metricas.estatistica.acuracia)} / ${smBtPct(x.metricas.ingenua.acuracia)} / <b>${smBtPct(x.metricas.agentes.acuracia)}</b></td></tr>`).join('')}</table>` : '';
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
