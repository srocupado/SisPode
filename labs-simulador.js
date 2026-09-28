'use strict';
// Labs · Simulador de Negociação.
//
// Ensaia uma rodada de negociação antes da mesa real: um agente de IA por
// bancada, cada um com um PERFIL TIRADO DAS VOTAÇÕES REAIS do partido no
// período (tamanho da bancada, quanto o partido orientou igual ao Governo,
// coesão dos seus deputados, votações recentes em que divergiu do Governo).
// Cada agente responde em JSON: posição (apoia | condiciona | rejeita),
// objeções, a concessão que destravaria o apoio e o argumento que mais pesa.
// Uma última chamada sintetiza: mapa de objeções, concessões possíveis e onde
// o acordo quebra.
//
// O apoio estimado é soma de CADEIRAS pela posição declarada dos agentes — é
// uma leitura da simulação, não previsão, e a tela diz isso.
//
// Depende de labs.js e ia-comum.js (chamarIA).

const SM_MAX_BANCADAS = 10;      // bancadas listadas (as maiores)
const SM_MARCADAS = 8;           // marcadas de saída
const SM_GOVERNO = '__governo';  // agente da liderança do Governo
const SM_POSICOES = ['apoia', 'condiciona', 'rejeita'];

const sm = { bancadas: [], deputados: null };

function smEl(id) { return document.getElementById(id); }

/** Cadeiras por partido, das maiores para as menores. */
function smBancadasDe(deputados) {
  const n = new Map();
  for (const d of deputados || []) if (d.partido) n.set(d.partido, (n.get(d.partido) || 0) + 1);
  return [...n.entries()].map(([sigla, cadeiras]) => ({ sigla, cadeiras }))
    .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla));
}

/**
 * O perfil de cada partido, puro, a partir das votações do período:
 *  - orientou: votações em que o partido orientou Sim/Não;
 *  - comGoverno: dessas, quantas com o Governo também orientando Sim/Não, e em
 *    quantas as duas orientações coincidiram;
 *  - coesao: média, por votação, da fração dos deputados do partido (Sim/Não)
 *    que votou como a maioria do partido;
 *  - divergencias: até 5 votações mais recentes em que partido e Governo
 *    orientaram diferente (descrição da votação).
 */
function smPerfis(itens, siglas) {
  const out = {};
  for (const s of siglas) out[s] = { sigla: s, orientou: 0, comparaveis: 0, coincidiu: 0, coesaoSoma: 0, coesaoN: 0, divergencias: [] };
  const ordenados = [...(itens || [])].sort((a, b) => String(b.votacao.dataHoraRegistro || b.votacao.data || '').localeCompare(String(a.votacao.dataHoraRegistro || a.votacao.data || '')));
  for (const it of ordenados) {
    const gov = labsOrientacao(it.orientacoes, 'Governo');
    const votosPorPartido = new Map();
    for (const v of it.votos) {
      const sn = labsSimNao(v.tipoVoto);
      const p = (v.deputado_ && v.deputado_.siglaPartido) || '';
      if (!sn || !out[p]) continue;
      const c = votosPorPartido.get(p) || { Sim: 0, 'Não': 0 };
      c[sn]++;
      votosPorPartido.set(p, c);
    }
    for (const s of siglas) {
      const pf = out[s];
      const ori = labsOrientacao(it.orientacoes, s);
      if (ori) {
        pf.orientou++;
        if (gov) {
          pf.comparaveis++;
          if (ori === gov) pf.coincidiu++;
          else if (pf.divergencias.length < 5) {
            const desc = String(it.votacao.descricao || it.votacao.proposicaoObjeto || '').replace(/\s+/g, ' ').trim().slice(0, 220);
            if (desc) pf.divergencias.push(`${desc} (partido: ${ori}; Governo: ${gov})`);
          }
        }
      }
      const c = votosPorPartido.get(s);
      if (c && (c.Sim + c['Não']) >= 2) {
        pf.coesaoSoma += Math.max(c.Sim, c['Não']) / (c.Sim + c['Não']);
        pf.coesaoN++;
      }
    }
  }
  for (const s of siglas) {
    const pf = out[s];
    pf.alinhamentoGoverno = pf.comparaveis ? pf.coincidiu / pf.comparaveis : null;
    pf.coesao = pf.coesaoN ? pf.coesaoSoma / pf.coesaoN : null;
  }
  return out;
}

function smPct(x) { return x == null ? 'sem dado' : Math.round(x * 100) + '%'; }

/** Texto da proposição (se informada) para os prompts. */
function smTextoProposicao(prop) {
  if (!prop) return '';
  const partes = [`${prop.sigla} ${prop.numero}/${prop.ano}`];
  if (prop.ementa) partes.push('Ementa: ' + prop.ementa);
  if (prop.keywords) partes.push('Palavras-chave: ' + prop.keywords);
  return partes.join('\n');
}

/** O prompt de um agente de bancada. Puro. */
function smPromptAgente(bancada, perfil, prop, proposta, meses) {
  const ehGoverno = bancada.sigla === SM_GOVERNO;
  const quem = ehGoverno
    ? 'a LIDERANÇA DO GOVERNO na Câmara dos Deputados'
    : `a bancada do ${bancada.sigla} na Câmara dos Deputados (${bancada.cadeiras} deputados em exercício)`;
  const linhas = [
    `Você representa ${quem} numa simulação de negociação preparatória, feita por assessoria parlamentar.`,
    'Responda como o negociador dessa bancada responderia, de forma realista e sem caricatura, com base APENAS no perfil abaixo e no conteúdo da proposta. Se o perfil não dá base para uma posição, diga "condiciona" e explique o que falta.',
    '',
  ];
  if (!ehGoverno && perfil) {
    linhas.push(`PERFIL (votações nominais do Plenário nos últimos ${meses} meses):`);
    linhas.push(`- Orientou Sim/Não em ${perfil.orientou} votações.`);
    linhas.push(`- Orientou igual ao Governo em ${smPct(perfil.alinhamentoGoverno)} das ${perfil.comparaveis} votações em que ambos orientaram.`);
    linhas.push(`- Coesão (deputados votando com a maioria da bancada): ${smPct(perfil.coesao)}.`);
    if (perfil.divergencias.length) {
      linhas.push('- Votações recentes em que divergiu do Governo:');
      for (const d of perfil.divergencias) linhas.push('  • ' + d);
    }
    linhas.push('');
  }
  const tp = smTextoProposicao(prop);
  if (tp) linhas.push('PROPOSIÇÃO EM PAUTA:', tp, '');
  linhas.push('PROPOSTA DE ACORDO APRESENTADA PELA LIDERANÇA DO PODEMOS:', proposta, '');
  linhas.push('Responda SOMENTE com um objeto JSON, sem texto fora dele, neste formato:');
  linhas.push('{"posicao":"apoia|condiciona|rejeita","objecoes":["até 3 objeções concretas"],"concessao":"o que destravaria o apoio (ou vazio se já apoia)","argumento":"o argumento que mais pesaria para essa bancada","risco":"o que faria a bancada abandonar o acordo"}');
  return linhas.join('\n');
}

/** Lê o JSON devolvido pelo modelo (com ou sem cercas ```), normalizando campos. */
function smLerResposta(texto) {
  let t = String(texto || '').trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) t = cerca[1].trim();
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i < 0 || f <= i) throw new Error('resposta sem JSON');
  const j = JSON.parse(t.slice(i, f + 1));
  const pos = String(j.posicao || '').toLowerCase().trim();
  return {
    posicao: SM_POSICOES.includes(pos) ? pos : 'indefinida',
    objecoes: (Array.isArray(j.objecoes) ? j.objecoes : []).map(x => String(x).trim()).filter(Boolean).slice(0, 5),
    concessao: String(j.concessao || '').trim(),
    argumento: String(j.argumento || '').trim(),
    risco: String(j.risco || '').trim(),
  };
}

/** Cadeiras por posição declarada (só bancadas partidárias; o Governo não tem cadeiras). */
function smApoioEstimado(resultados) {
  const t = { apoia: 0, condiciona: 0, rejeita: 0, indefinida: 0, total: 0 };
  for (const r of resultados) {
    if (r.bancada.sigla === SM_GOVERNO) continue;
    const pos = r.resposta ? r.resposta.posicao : 'indefinida';
    t[pos] += r.bancada.cadeiras;
    t.total += r.bancada.cadeiras;
  }
  return t;
}

/** O prompt da síntese. Puro. */
function smPromptSintese(resultados, prop, proposta) {
  const linhas = [
    'Você é analista de articulação política da Liderança do Podemos na Câmara. Abaixo estão as reações SIMULADAS (por agentes de IA) de cada bancada a uma proposta de acordo.',
    'Escreva uma síntese em Markdown, em português, com as seções: "Mapa de objeções" (agrupe objeções parecidas e diga quais bancadas as levantaram), "Concessões possíveis" (quais concessões atendem mais bancadas/cadeiras, e o custo de cada uma), "Onde o acordo quebra" (as bancadas e os pontos de ruptura) e "Próximos passos" (3 a 5 ações concretas para a mesa real).',
    'Seja direto. Não invente dados além dos fornecidos. Lembre que são simulações, não posições reais.',
    '',
  ];
  const tp = smTextoProposicao(prop);
  if (tp) linhas.push('PROPOSIÇÃO:', tp, '');
  linhas.push('PROPOSTA:', proposta, '', 'REAÇÕES:');
  for (const r of resultados) {
    const nome = r.bancada.sigla === SM_GOVERNO ? 'Governo' : `${r.bancada.sigla} (${r.bancada.cadeiras} cadeiras)`;
    if (!r.resposta) { linhas.push(`- ${nome}: sem resposta (${r.erro || 'erro'})`); continue; }
    const x = r.resposta;
    linhas.push(`- ${nome}: ${x.posicao}. Objeções: ${x.objecoes.join('; ') || '—'}. Concessão: ${x.concessao || '—'}. Argumento: ${x.argumento || '—'}. Risco: ${x.risco || '—'}.`);
  }
  return linhas.join('\n');
}

// ---------- tela ----------
async function smCarregarBancadas() {
  const caixa = smEl('smBancadas');
  try {
    sm.deputados = await labsDeputadosAtuais();
    sm.bancadas = smBancadasDe(sm.deputados).slice(0, SM_MAX_BANCADAS);
    const itens = [`<label><input type="checkbox" value="${SM_GOVERNO}" checked> <b>Governo</b> <span class="prd-dica">(liderança)</span></label>`]
      .concat(sm.bancadas.map((b, i) => `<label><input type="checkbox" value="${labsEsc(b.sigla)}"${i < SM_MARCADAS ? ' checked' : ''}> ${labsEsc(b.sigla)} <span class="prd-dica">${b.cadeiras}</span></label>`));
    caixa.innerHTML = itens.join('');
  } catch (e) {
    caixa.innerHTML = '<span class="prd-dica">Não foi possível carregar as bancadas (' + labsEsc(e.message) + '). Recarregue a página.</span>';
  }
}

async function smBuscarProposicao() {
  const sigla = String(smEl('smSigla').value || '').trim().toUpperCase();
  const numero = String(smEl('smNumero').value || '').trim();
  const ano = String(smEl('smAno').value || '').trim();
  if (!numero && !ano) return null;
  if (!sigla || !/^\d+$/.test(numero) || !/^\d{4}$/.test(ano)) throw new Error('Informe sigla, número e ano da proposição — ou deixe número e ano em branco.');
  const j = await labsJson(`${LABS_API}/proposicoes?siglaTipo=${encodeURIComponent(sigla)}&numero=${numero}&ano=${ano}&itens=1`);
  const p = (j.dados || [])[0];
  if (!p) throw new Error(`${sigla} ${numero}/${ano} não encontrada na Câmara.`);
  const d = (await labsJson(`${LABS_API}/proposicoes/${p.id}`)).dados || {};
  return { id: p.id, sigla, numero, ano, ementa: d.ementa || p.ementa || '', keywords: d.keywords || '' };
}

async function smSimularClick() {
  const bt = smEl('smSimular');
  const res = smEl('smResultado');
  const proposta = String(smEl('smProposta').value || '').trim();
  if (proposta.length < 15) { labsStatus('smStatus', 'Descreva a proposta em negociação (ao menos uma frase).', 'error'); return; }
  const marcadas = [...smEl('smBancadas').querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  if (!marcadas.length) { labsStatus('smStatus', 'Marque ao menos uma bancada.', 'error'); return; }
  const cfg = await labsConfigIA();
  if (!cfg.apiKey) { labsStatus('smStatus', 'Nenhuma chave de IA configurada. Configure no ⚙ do módulo Relatórios e tente de novo.', 'error'); return; }
  const meses = parseInt(smEl('smMeses').value, 10) || 6;
  bt.disabled = true; res.innerHTML = '';
  let chamadas = 0;
  try {
    labsStatus('smStatus', 'Buscando a proposição…', 'loading');
    const prop = await smBuscarProposicao();
    const partidos = marcadas.filter(s => s !== SM_GOVERNO);
    labsStatus('smStatus', 'Montando os perfis pelas votações reais…', 'loading');
    const { itens, falhas } = await labsVotacoesPlenario(meses, m => labsStatus('smStatus', m, 'loading'));
    const perfis = smPerfis(itens, partidos);
    const bancadas = marcadas.map(s => s === SM_GOVERNO ? { sigla: SM_GOVERNO, cadeiras: 0 } : sm.bancadas.find(b => b.sigla === s));
    const ia = p => { chamadas++; return chamarIA({ provedorId: cfg.provedor || 'gemini', apiKey: cfg.apiKey, modelo: cfg.modelo, prompt: p, opcoes: { maxSaida: 1500 } }); };
    let feitas = 0;
    const resultados = await labsMapLimit(bancadas, 3, async b => {
      try {
        const r = await ia(smPromptAgente(b, perfis[b.sigla], prop, proposta, meses));
        return { bancada: b, perfil: perfis[b.sigla], resposta: smLerResposta(r.text) };
      } catch (e) {
        return { bancada: b, perfil: perfis[b.sigla], resposta: null, erro: e.message };
      } finally {
        feitas++;
        labsStatus('smStatus', `Agentes respondendo… ${feitas}/${bancadas.length}`, 'loading');
      }
    });
    labsStatus('smStatus', 'Sintetizando a rodada…', 'loading');
    let sintese = '';
    if (resultados.some(r => r.resposta)) {
      try { sintese = (await ia(smPromptSintese(resultados, prop, proposta))).text; }
      catch (e) { sintese = '_A síntese falhou: ' + e.message + '_'; }
    }
    labsStatus('smStatus', '');
    smRender({ resultados, sintese, prop, meses, falhas, votacoes: itens.length, chamadas, modelo: cfg.modelo || '(padrão do provedor)', provedor: cfg.provedor || 'gemini' });
  } catch (e) {
    labsStatus('smStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

function smRender(r) {
  const ap = smApoioEstimado(r.resultados);
  const card = (k, n, rot) => `<div class="labs-card ${k}"><div class="v">${n}</div><div class="l">${rot}</div></div>`;
  const agentes = r.resultados.map(x => {
    const nome = x.bancada.sigla === SM_GOVERNO ? 'Governo' : x.bancada.sigla;
    const pf = x.perfil;
    const perfil = pf ? `<div class="t">Perfil: ${x.bancada.cadeiras} cadeiras · com o Governo em ${smPct(pf.alinhamentoGoverno)} (${pf.comparaveis} votações) · coesão ${smPct(pf.coesao)}</div>` : '';
    if (!x.resposta) {
      return `<div class="labs-agente"><div class="cab"><b>${labsEsc(nome)}</b><span class="labs-pos indefinida">sem resposta</span></div>${perfil}<div class="t">${labsEsc(x.erro || '')}</div></div>`;
    }
    const a = x.resposta;
    return `<div class="labs-agente"><div class="cab"><b>${labsEsc(nome)}</b><span class="labs-pos ${a.posicao}">${a.posicao}</span></div>${perfil}
      ${a.objecoes.length ? `<div class="t"><b>Objeções:</b> ${a.objecoes.map(labsEsc).join(' · ')}</div>` : ''}
      ${a.concessao ? `<div class="t"><b>Destravaria:</b> ${labsEsc(a.concessao)}</div>` : ''}
      ${a.argumento ? `<div class="t"><b>Argumento que pesa:</b> ${labsEsc(a.argumento)}</div>` : ''}
      ${a.risco ? `<div class="t"><b>Risco de ruptura:</b> ${labsEsc(a.risco)}</div>` : ''}</div>`;
  }).join('');
  const prop = r.prop ? `<div class="sub">${labsEsc(r.prop.sigla + ' ' + r.prop.numero + '/' + r.prop.ano)} — ${labsEsc(r.prop.ementa)}</div>` : '';
  smEl('smResultado').innerHTML = `
    ${prop}
    <div class="labs-cards">
      ${card('f5', ap.apoia, 'cadeiras: apoia')}
      ${card('f3', ap.condiciona, 'cadeiras: condiciona')}
      ${card('f1', ap.rejeita, 'cadeiras: rejeita')}
      ${ap.indefinida ? card('f0', ap.indefinida, 'cadeiras: sem resposta') : ''}
    </div>
    <div class="labs-aviso">Soma das cadeiras das bancadas simuladas (${ap.total}) pela posição que o <b>agente</b> declarou.
      Não é previsão de placar: a bancada real pode se dividir e os agentes tendem a concordar mais do que as bancadas.</div>
    ${r.sintese ? `<div class="labs-caixa"><h3>Síntese da rodada</h3><div class="labs-sintese">${renderMarkdown(r.sintese)}</div></div>` : ''}
    <h3 style="margin-top:14px">Reação por bancada</h3>
    ${agentes}
    <div class="labs-custo">Perfis de ${r.votacoes} votações nominais do Plenário (últimos ${r.meses} meses)${r.falhas ? `; ${r.falhas} votações não puderam ser lidas` : ''}.
      Custo: ${r.chamadas} chamadas de IA pela sua chave (${labsEsc(r.provedor)} · ${labsEsc(r.modelo)}).</div>`;
}

if (smEl('smSimular')) {
  smEl('smSimular').addEventListener('click', smSimularClick);
  let carregou = false;
  document.addEventListener('labs:aba', ev => {
    if (ev.detail === 'aba-simulador' && !carregou) { carregou = true; smCarregarBancadas(); }
  });
}
