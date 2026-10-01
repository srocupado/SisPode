'use strict';
// Labs · Simulador de Negociação.
//
// Ensaia uma rodada de negociação antes da mesa real: um agente de IA por
// bancada, cada um com um PERFIL TIRADO DAS VOTAÇÕES REAIS do partido no
// período (tamanho da bancada, quanto a maioria dos seus deputados votou como o
// Governo orientou, quanto a orientação do líder coincidiu com a do Governo,
// coesão, votações recentes em que a bancada votou contra o Governo).
// Cada agente responde em JSON: posição (apoia | condiciona | rejeita),
// objeções, a concessão que destravaria o apoio e o argumento que mais pesa.
// Uma última chamada sintetiza: mapa de objeções, concessões possíveis e onde
// o acordo quebra.
//
// O apoio estimado é soma de CADEIRAS pela posição declarada dos agentes — é
// uma leitura da simulação, não previsão, e a tela diz isso.
//
// O que o analista configura:
//  - quem está na mesa: Governo, qualquer partido (as maiores vêm listadas; as
//    demais entram por "Adicionar partido") e agentes PERSONALIZADOS — frente
//    parlamentar, relator ou outro —, descritos pela equipe (sem cadeiras:
//    sobrepõem os partidos);
//  - o CONTEXTO de cada agente: o que as votações não mostram (sinais do
//    líder, divisões internas). Entra no prompt junto do perfil;
//  - perfis salvos no banco compartilhado (/labs/simulador/perfis): contexto e
//    agentes personalizados voltam preenchidos para toda a equipe;
//  - RODADAS encadeadas: a proposta reformulada vai aos mesmos agentes, cada
//    um com o que disse antes; a tela mostra quem mudou de posição;
//  - modelos separados para os agentes (uma chamada cada — vale um mais
//    barato) e para a síntese (uma chamada — vale um mais forte), no mesmo
//    provedor e chave do ⚙ desta página (configuração do aplicativo).
//
// Depende de labs.js e ia-comum.js (chamarIA).

const SM_MAX_BANCADAS = 10;      // bancadas listadas (as maiores)
const SM_MARCADAS = 8;           // marcadas de saída
const SM_GOVERNO = '__governo';  // agente da liderança do Governo
const SM_POSICOES = ['apoia', 'condiciona', 'rejeita'];

const sm = { bancadas: [], todas: [], agentes: [], deputados: null, sessao: null };

function smEl(id) { return document.getElementById(id); }

/** Cadeiras por partido, das maiores para as menores. */
function smBancadasDe(deputados) {
  const n = new Map();
  for (const d of deputados || []) if (d.partido) n.set(d.partido, (n.get(d.partido) || 0) + 1);
  return [...n.entries()].map(([sigla, cadeiras]) => ({ sigla, cadeiras }))
    .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla));
}

/**
 * O perfil de cada partido, puro, a partir das votações do período. Em toda
 * conta com o Governo, só entram votações em que o Governo orientou Sim ou Não.
 *  - alinhamentoGoverno (principal): em quantas a MAIORIA DOS DEPUTADOS do
 *    partido votou como o Governo orientou (comparaveis = votações com ao menos
 *    2 deputados do partido votando Sim, Não ou Obstrução — ou 1, se a bancada
 *    só tem 1 — e maioria definida; empate não conta). Pelo voto, e não pela orientação, porque a Câmara só
 *    publica a orientação do LÍDER DO BLOCO — partidos do mesmo bloco sairiam
 *    todos com o mesmo número;
 *  - alinhamentoOrientacao: em quantas a orientação do partido (própria ou do
 *    bloco) foi igual à do Governo (comparaveisOrientacao). OBSTRUÇÃO contra
 *    Sim/Não do Governo conta como divergência; "Liberado" não entra;
 *  - orientou: votações em que o partido orientou Sim, Não ou Obstrução;
 *  - coesao: média, por votação, da fração dos deputados do partido (Sim/Não)
 *    que votou como a maioria do partido (partido do deputado NA votação);
 *  - divergencias: até 5 votações mais recentes em que a maioria do partido
 *    votou diferente do Governo — com a proposição votada.
 */
function smPerfis(itens, siglas) {
  const out = {};
  for (const s of siglas) out[s] = { sigla: s, orientou: 0, comparaveis: 0, coincidiu: 0, comparaveisOrientacao: 0, coincidiuOrientacao: 0, coesaoSoma: 0, coesaoN: 0, divergencias: [],
    porContexto: { consenso: { n: 0, c: 0 }, conflito: { n: 0, c: 0 }, semOposicao: { n: 0, c: 0 } } };
  const ordenados = [...(itens || [])].sort((a, b) => String(b.votacao.dataHoraRegistro || b.votacao.data || '').localeCompare(String(a.votacao.dataHoraRegistro || a.votacao.data || '')));
  // Bancada de 1 deputado (ex.: MISSÃO, DC) nunca teria "2 votos" numa votação:
  // aí o voto dele é o da bancada. Nas demais, exige 2 para ter maioria.
  const maxVotantes = {};
  for (const it of ordenados) {
    const n = {};
    for (const v of it.votos) { const p = (v.deputado_ && v.deputado_.siglaPartido) || ''; if (out[p]) n[p] = (n[p] || 0) + 1; }
    for (const [p, k] of Object.entries(n)) maxVotantes[p] = Math.max(maxVotantes[p] || 0, k);
  }
  for (const it of ordenados) {
    const og = labsOrientacao(it.orientacoes, 'Governo');
    const gov = og === 'Sim' || og === 'Não' ? og : null;
    const ctxVot = smContexto(gov, labsOrientacao(it.orientacoes, 'Oposição'));
    const votosPorPartido = new Map();
    for (const v of it.votos) {
      const t = labsSigla(v.tipoVoto);
      const tipo = t === 'sim' ? 'Sim' : t === 'nao' ? 'Não' : t.startsWith('obstru') ? 'Obstrução' : null;
      const p = (v.deputado_ && v.deputado_.siglaPartido) || '';
      if (!tipo || !out[p]) continue;
      const c = votosPorPartido.get(p) || { Sim: 0, 'Não': 0, 'Obstrução': 0 };
      c[tipo]++;
      votosPorPartido.set(p, c);
    }
    for (const s of siglas) {
      const pf = out[s];
      const ori = labsOrientacao(it.orientacoes, s);
      if (ori) {
        pf.orientou++;
        if (gov) { pf.comparaveisOrientacao++; if (ori === gov) pf.coincidiuOrientacao++; }
      }
      const c = votosPorPartido.get(s);
      if (!c) continue;
      if (c.Sim + c['Não'] >= 2) {
        pf.coesaoSoma += Math.max(c.Sim, c['Não']) / (c.Sim + c['Não']);
        pf.coesaoN++;
      }
      const n = c.Sim + c['Não'] + c['Obstrução'];
      if (!gov || n < Math.min(2, maxVotantes[s] || 0)) continue;
      const ordem = Object.entries(c).sort((a, b) => b[1] - a[1]);
      if (ordem[0][1] === ordem[1][1]) continue;          // empate: sem maioria
      const maioria = ordem[0][0];
      pf.comparaveis++;
      pf.porContexto[ctxVot].n++;
      if (maioria === gov) { pf.coincidiu++; pf.porContexto[ctxVot].c++; }
      else if (pf.divergencias.length < 5) {
        const obj = String(it.votacao.proposicaoObjeto || '').trim();
        const desc = String(it.votacao.descricao || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const dia = String(it.votacao.data || it.votacao.dataHoraRegistro || '').slice(0, 10);
        const txt = [obj, desc].filter(Boolean).join(' — ');
        if (txt) pf.divergencias.push(`${dia ? dia + ': ' : ''}${txt} (maioria da bancada: ${maioria}; Governo orientou: ${gov})`);
      }
    }
  }
  for (const s of siglas) {
    const pf = out[s];
    pf.alinhamentoGoverno = pf.comparaveis ? pf.coincidiu / pf.comparaveis : null;
    pf.alinhamentoOrientacao = pf.comparaveisOrientacao ? pf.coincidiuOrientacao / pf.comparaveisOrientacao : null;
    pf.coesao = pf.coesaoN ? pf.coesaoSoma / pf.coesaoN : null;
    for (const k of Object.keys(pf.porContexto)) { const x = pf.porContexto[k]; x.alinhamento = x.n ? x.c / x.n : null; }
  }
  return out;
}

/**
 * O contexto da votação pela orientação da Oposição, anunciada ANTES do voto:
 * "consenso" (Oposição orientou igual ao Governo), "conflito" (orientou
 * diferente — inclui obstrução) ou "semOposicao" (liberou ou não orientou).
 * Medido em 12 meses (169 votações): o PL acompanha o Governo em 100% dos
 * consensos e em 4% dos conflitos — o alinhamento geral (≈ 30%) esconde isso.
 */
function smContexto(gov, oposicao) {
  if (!oposicao) return 'semOposicao';
  return oposicao === gov ? 'consenso' : 'conflito';
}

const SM_ROT_CONTEXTO = {
  consenso: 'quando Governo e Oposição orientaram IGUAL (consenso)',
  conflito: 'quando a Oposição orientou DIFERENTE do Governo (conflito)',
  semOposicao: 'quando a Oposição liberou ou não orientou',
};

/** Linhas do perfil por contexto, para os prompts. Pura. */
function smLinhasContexto(perfil) {
  const pc = (perfil && perfil.porContexto) || {};
  return Object.keys(SM_ROT_CONTEXTO).filter(k => pc[k] && pc[k].n)
    .map(k => `- ${SM_ROT_CONTEXTO[k][0].toUpperCase() + SM_ROT_CONTEXTO[k].slice(1)}, a maioria da bancada votou com o Governo em ${smPct(pc[k].alinhamento)} de ${pc[k].n} votações.`);
}

function smPct(x) { return x == null ? 'sem dado' : Math.round(x * 100) + '%'; }

/** Texto da proposição (se informada) para os prompts. */
function smTextoProposicao(prop) {
  if (!prop) return '';
  const partes = [`${prop.sigla} ${prop.numero}/${prop.ano}`];
  if (prop.ementa) partes.push('Ementa: ' + prop.ementa);
  if (prop.keywords) partes.push('Palavras-chave: ' + prop.keywords);
  if (smJaEhLei(prop)) partes.push(`SITUAÇÃO: esta proposição JÁ FOI TRANSFORMADA EM LEI (${prop.situacao}). O texto dela está em vigor: trate a proposta abaixo como ALTERAÇÃO da lei vigente e não peça, como condição, o que a lei já contém.`);
  else if (prop.situacao) partes.push('Situação na Câmara: ' + prop.situacao);
  return partes.join('\n');
}

/** A proposição já virou lei? (situação "Transformado em Norma Jurídica" na Câmara) */
function smJaEhLei(prop) {
  return !!(prop && /transformad[oa] em (norma|lei)/i.test(String(prop.situacao || '')));
}

const SM_TIPOS = { governo: 'Governo', partido: 'partido', frente: 'frente parlamentar', relator: 'relator(a)', outro: 'agente' };

/** Quem o agente representa, em uma frase (para o prompt). */
function smQuem(ag) {
  if (ag.sigla === SM_GOVERNO || ag.tipo === 'governo') return 'a LIDERANÇA DO GOVERNO na Câmara dos Deputados';
  if (ag.tipo === 'frente') return `a ${ag.nome} (frente parlamentar) na Câmara dos Deputados`;
  if (ag.tipo === 'relator') return `${ag.nome}, relator(a) da matéria na Câmara dos Deputados`;
  if (ag.tipo === 'outro') return `${ag.nome}, na Câmara dos Deputados`;
  return `a bancada do ${ag.sigla} na Câmara dos Deputados (${ag.cadeiras} deputados em exercício)`;
}

/** Texto de uma objeção (objeto { texto, base } ou, no formato antigo, string). */
function smObjTexto(o) { return typeof o === 'string' ? o : String((o && o.texto) || ''); }

// De onde uma objeção pode vir. "nenhuma" = o agente admite que não tem base
// nos dados dados a ele — a tela marca, em vez de deixar passar como fato.
const SM_BASES = ['perfil', 'contexto', 'proposicao', 'proposta', 'governo', 'nenhuma'];

/** Resumo de uma resposta anterior, para o histórico das rodadas. */
function smResumoResposta(x) {
  if (!x) return 'sem resposta';
  return `${x.posicao}. Objeções: ${x.objecoes.map(smObjTexto).join('; ') || '—'}. Concessão pedida: ${x.concessao || '—'}. Risco: ${x.risco || '—'}.`;
}

/**
 * A proposta em PONTOS: linhas começando com número ("1.", "2)") ou marcador
 * ("-", "•", "*"). Com menos de 2 pontos, a proposta é um ponto só. Pura.
 * Cada agente reage a cada ponto — o mapa ponto × bancada mostra onde trava.
 */
function smPontos(texto) {
  const linhas = String(texto || '').split(/\r?\n/);
  const pontos = [];
  for (const l of linhas) {
    const m = l.match(/^\s*(?:\d+\s*[.)\-–]|[-•*])\s+(.+)$/);
    if (m) pontos.push(m[1].trim());
    else if (pontos.length && l.trim()) pontos[pontos.length - 1] += ' ' + l.trim();
  }
  return pontos.length >= 2 ? pontos : [String(texto || '').trim()].filter(Boolean);
}

/**
 * O prompt de um agente. Puro.
 * ag: { sigla, cadeiras, tipo?, nome?, descricao?, contexto? } — bancada, Governo ou personalizado.
 * historico: [{ proposta, resposta }] das rodadas anteriores deste agente (vazio na 1ª).
 */
function smPromptAgente(ag, perfil, prop, proposta, meses, historico, extra) {
  const ex = extra || {};
  const personalizado = ['frente', 'relator', 'outro'].includes(ag.tipo);
  const linhas = [
    `Você representa ${smQuem(ag)} numa simulação de negociação preparatória, feita por assessoria parlamentar.`,
    'Responda como o negociador desse ator responderia, de forma realista e sem caricatura, com base APENAS nas informações abaixo e no conteúdo da proposta.',
    'TOME POSIÇÃO: "apoia" ou "rejeita" sempre que der. Use "condiciona" SÓ com uma condição concreta e verificável — o que exatamente precisa mudar no texto (ex.: "prazo de 360 dias em vez de 180"); pedido genérico ("precisa de estudos", "falta detalhamento técnico", "insegurança jurídica") não é condição. Se de fato não houver como decidir, use "indefinida" e diga em "concessao" que informação faltou.',
    'O perfil de votações serve para CALIBRAR a posição deste ator — não é argumento: não cite percentuais de alinhamento, coesão ou histórico de votações como razão da posição; argumente pelo conteúdo da proposta e pelos interesses do ator.',
    '',
  ];
  if (personalizado && ag.descricao) linhas.push('QUEM É E O QUE DEFENDE (descrito pela equipe):', ag.descricao, '');
  if (!personalizado && ag.sigla !== SM_GOVERNO && perfil) {
    linhas.push(`PERFIL (votações nominais do Plenário nos últimos ${meses} meses):`);
    linhas.push(perfil.comparaveis
      ? `- A maioria dos deputados da bancada votou como o Governo orientou em ${smPct(perfil.alinhamentoGoverno)} das ${perfil.comparaveis} votações em que o Governo orientou Sim ou Não.`
      : '- Sem votações suficientes para medir o alinhamento da bancada com o Governo.');
    linhas.push(...smLinhasContexto(perfil));
    if (perfil.comparaveisOrientacao) linhas.push(`- A orientação do líder (do partido ou do bloco) foi igual à do Governo em ${smPct(perfil.alinhamentoOrientacao)} de ${perfil.comparaveisOrientacao} votações (obstrução conta como divergência).`);
    if (perfil.coesao != null) linhas.push(`- Coesão (deputados votando com a maioria da bancada): ${smPct(perfil.coesao)}.`);
    if (perfil.divergencias.length) {
      linhas.push('- Votações recentes em que a maioria da bancada votou contra a orientação do Governo:');
      for (const d of perfil.divergencias) linhas.push('  • ' + d);
    }
    linhas.push('');
  }
  if (ag.contexto) {
    linhas.push('CONTEXTO DADO PELA EQUIPE DA LIDERANÇA (informação recente que as votações não mostram — considere com peso, junto do perfil):', ag.contexto, '');
  }
  const tp = smTextoProposicao(prop);
  if (tp) linhas.push('PROPOSIÇÃO EM PAUTA:', tp, '');
  if (ex.oposicao && ag.sigla !== SM_GOVERNO) {
    linhas.push(`EXPECTATIVA DA EQUIPE: a liderança da OPOSIÇÃO deve orientar ${ex.oposicao === 'Sim' ? 'a FAVOR da proposta' : ex.oposicao === 'Não' ? 'CONTRA a proposta' : 'OBSTRUÇÃO'}. Leve em conta como a bancada se comporta nesse contexto (perfil acima).`, '');
  }
  if (ex.governo && ag.sigla !== SM_GOVERNO) {
    const g = ex.governo;
    linhas.push('POSIÇÃO JÁ DECLARADA PELA LIDERANÇA DO GOVERNO NESTA RODADA:',
      `${g.posicao}. Objeções: ${g.objecoes.map(smObjTexto).join('; ') || '—'}. Concessão que pede: ${g.concessao || '—'}.`, '');
  }
  const hist = historico || [];
  const pontos = smPontos(proposta);
  const listaPontos = pontos.length > 1 ? pontos.map((p, i) => `${i + 1}. ${p}`).join('\n') : proposta;
  if (hist.length) {
    linhas.push('RODADAS ANTERIORES DESTA NEGOCIAÇÃO:');
    hist.forEach((h, i) => linhas.push(`- Rodada ${i + 1}. Proposta: ${h.proposta}`, `  Sua resposta: ${smResumoResposta(h.resposta)}`));
    const notas = hist[hist.length - 1].resposta && hist[hist.length - 1].resposta.notas;
    if (notas) linhas.push('', 'SUAS PRÓPRIAS NOTAS DA RODADA ANTERIOR (você as escreveu para si):', notas);
    linhas.push('', `PROPOSTA REFORMULADA (rodada ${hist.length + 1}) APRESENTADA PELA LIDERANÇA DO PODEMOS:`, listaPontos, '');
    linhas.push('Seja coerente com o que você já disse: mude de posição só se a reformulação atender, de fato, às suas objeções ou à concessão que pediu; diga o que ainda falta.', '');
  } else {
    linhas.push('PROPOSTA DE ACORDO APRESENTADA PELA LIDERANÇA DO PODEMOS:', listaPontos, '');
  }
  linhas.push('Defenda os interesses desse ator com firmeza: não ceda só para agradar; ceda quando a proposta de fato atender ao que ele pede.');
  linhas.push(`Em cada objeção, diga em que ela se apoia — "base": "perfil" (dados de votação acima), "contexto" (informação da equipe), "proposicao" (ementa), "proposta" (texto em negociação)${ex.governo ? ', "governo" (posição do Governo acima)' : ''} ou "nenhuma" (sem apoio nos dados — prefira isso a inventar).`);
  if (pontos.length > 1) {
    linhas.push(`Para CADA um dos ${pontos.length} pontos, diga a ação: "apoia", "rejeita", "reformula" (com a nova redação) ou "troca" (aceita o ponto em troca de outro — diga qual e como), e a importância do ponto para esse ator de 1 (indiferente) a 5 (linha vermelha).`);
  }
  linhas.push('Em "notas", escreva para VOCÊ MESMO, em até 5 linhas, o estado da negociação: o que pediu, o que obteve, o que falta e sua linha vermelha — você as receberá na próxima rodada.');
  linhas.push('Responda SOMENTE com um objeto JSON, sem texto fora dele, neste formato:');
  const fmtPontos = pontos.length > 1 ? ',"pontos":[{"n":1,"acao":"apoia|rejeita|reformula|troca","importancia":3,"redacao":"nova redação, se reformula","troca":"o que pede em troca, se troca"}]' : '';
  linhas.push(`{"posicao":"apoia|condiciona|rejeita|indefinida","objecoes":[{"texto":"objeção concreta","base":"perfil|contexto|proposicao|proposta${ex.governo ? '|governo' : ''}|nenhuma"}],"concessao":"o que destravaria o apoio (ou vazio se já apoia)","argumento":"o argumento que mais pesaria para esse ator","risco":"o que faria esse ator abandonar o acordo"${fmtPontos},"notas":"suas notas para a próxima rodada"}`);
  return linhas.join('\n');
}

/**
 * A posição declarada, tolerante à redação do modelo: "Apoia", "apoio" →
 * apoia; "condicionado", "apoia parcialmente", "com ressalvas" → condiciona;
 * "rejeita", "contrário" → rejeita. O resto é "indefinida" (o agente declarou
 * que falta informação para decidir, ou a posição veio ilegível) — diferente
 * de "sem resposta" (a chamada falhou).
 */
function smPosicao(txt) {
  const t = labsSigla(txt);
  if (/condic|ressalva|parcial/.test(t)) return 'condiciona';
  if (/^apoi|^favor/.test(t)) return 'apoia';
  if (/^rejeit|^contra|^recus/.test(t)) return 'rejeita';
  return 'indefinida';
}

/**
 * Confere a base que o agente DECLAROU contra o que ele de fato RECEBEU. Pura.
 * Ex.: "base: contexto da equipe" sem contexto preenchido é base inexistente —
 * a objeção vira "nenhuma" e guarda o que foi declarado (baseDeclarada), para
 * a tela dizer o que houve. `recebido`: { perfil, contexto, proposicao, governo } (booleanos).
 */
function smValidarBases(resposta, recebido) {
  if (!resposta) return resposta;
  const ok = b => b === 'proposta' || b === 'nenhuma' || !!recebido[b];
  for (const o of resposta.objecoes || []) {
    if (!ok(o.base)) { o.baseDeclarada = o.base; o.base = 'nenhuma'; }
  }
  return resposta;
}

/** O que um agente recebeu no prompt, para conferir as bases declaradas. */
function smRecebido(ag, perfil, prop, extra) {
  const partido = ag.tipo === 'partido' || (!ag.tipo && ag.sigla !== SM_GOVERNO);
  return {
    perfil: !!(partido && perfil && (perfil.comparaveis || perfil.comparaveisOrientacao)),
    contexto: !!(String(ag.contexto || '').trim() || String(ag.descricao || '').trim()),
    proposicao: !!prop,
    governo: !!(extra && extra.governo),
  };
}

/** Lê o JSON devolvido pelo modelo (com ou sem cercas ```), normalizando campos. */
function smLerResposta(texto) {
  let t = String(texto || '').trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) t = cerca[1].trim();
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i < 0 || f <= i) throw new Error('resposta sem JSON');
  const j = JSON.parse(t.slice(i, f + 1));
  const base = b => { const t = labsSigla(b).replace(/[^a-z]/g, ''); return SM_BASES.includes(t) ? t : 'nenhuma'; };
  const acoes = ['apoia', 'rejeita', 'reformula', 'troca'];
  return {
    posicao: smPosicao(j.posicao),
    // Objeção sem "base" declarada conta como "nenhuma": a tela não a trata como fato.
    objecoes: (Array.isArray(j.objecoes) ? j.objecoes : []).map(x => (typeof x === 'string'
      ? { texto: x.trim(), base: 'nenhuma' }
      : { texto: String((x && x.texto) || '').trim(), base: base(x && x.base) })).filter(o => o.texto).slice(0, 5),
    concessao: String(j.concessao || '').trim(),
    argumento: String(j.argumento || '').trim(),
    risco: String(j.risco || '').trim(),
    pontos: (Array.isArray(j.pontos) ? j.pontos : []).map(p => {
      const a = labsSigla(p && p.acao);
      return {
        n: parseInt(p && p.n, 10) || 0,
        acao: acoes.find(x => a.startsWith(x.slice(0, 5))) || (a.startsWith('apoi') ? 'apoia' : a.startsWith('rejeit') ? 'rejeita' : 'indefinida'),
        importancia: Math.min(5, Math.max(1, parseInt(p && p.importancia, 10) || 0)) || null,
        redacao: String((p && p.redacao) || '').trim(),
        troca: String((p && p.troca) || '').trim(),
      };
    }).filter(p => p.n > 0),
    notas: String(j.notas || '').trim().slice(0, 800),
  };
}

/** Agente que soma cadeiras: só bancada partidária (Governo e personalizados não). */
function smSomaCadeiras(ag) { return ag.sigla !== SM_GOVERNO && (!ag.tipo || ag.tipo === 'partido'); }

/** Cadeiras por posição declarada (só bancadas partidárias). */
function smApoioEstimado(resultados) {
  const t = { apoia: 0, condiciona: 0, rejeita: 0, indefinida: 0, semResposta: 0, total: 0 };
  for (const r of resultados) {
    if (!smSomaCadeiras(r.bancada)) continue;
    const pos = r.resposta ? r.resposta.posicao : 'semResposta';
    t[pos] += r.bancada.cadeiras;
    t.total += r.bancada.cadeiras;
  }
  return t;
}

function smNomeAgente(ag) {
  if (ag.sigla === SM_GOVERNO) return 'Governo';
  if (smSomaCadeiras(ag)) return `${ag.sigla} (${ag.cadeiras} cadeiras)`;
  return `${ag.nome} (${SM_TIPOS[ag.tipo] || 'agente'})`;
}

/**
 * O prompt da síntese. Puro. `anteriores`: rodadas anteriores
 * [{ proposta, resultados }] — com elas, a síntese diz quem mudou e por quê.
 */
function smPromptSintese(resultados, prop, proposta, anteriores) {
  const ant = anteriores || [];
  const secoes = '"Mapa de objeções" (agrupe objeções parecidas e diga quem as levantou), "Concessões possíveis" (quais concessões atendem mais atores/cadeiras, e o custo de cada uma), "Onde o acordo quebra" (os atores e os pontos de ruptura)' +
    (ant.length ? ', "O que mudou nesta rodada" (quem mudou de posição, em que direção e por causa de qual mudança da proposta; quem não se mexeu e o que ainda pede)' : '') +
    ' e "Próximos passos" (3 a 5 ações concretas para a mesa real).';
  const linhas = [
    'Você é analista de articulação política da Liderança do Podemos na Câmara. Abaixo estão as reações SIMULADAS (por agentes de IA) de cada ator a uma proposta de acordo.',
    'Escreva uma síntese em Markdown, em português, com as seções: ' + secoes,
    'Seja direto. Não invente dados além dos fornecidos. Lembre que são simulações, não posições reais. Objeções marcadas [sem base nos dados] são hipóteses do modelo: não as trate como fato.',
    ...(smPontos(proposta).length > 1 ? ['A proposta tem pontos numerados: inclua a seção "Por ponto" (quais pontos passam, quais travam e quem os trava; trocas possíveis entre pontos; linhas vermelhas = importância 5).'] : []),
    '',
  ];
  const tp = smTextoProposicao(prop);
  if (tp) linhas.push('PROPOSIÇÃO:', tp, '');
  if (ant.length) {
    linhas.push('RODADAS ANTERIORES:');
    ant.forEach((r, i) => {
      linhas.push(`Rodada ${i + 1} — proposta: ${r.proposta}`);
      for (const x of r.resultados) linhas.push(`  - ${smNomeAgente(x.bancada)}: ${x.resposta ? x.resposta.posicao : 'sem resposta'}`);
    });
    linhas.push('', `RODADA ATUAL (${ant.length + 1}) — PROPOSTA:`, proposta, '', 'REAÇÕES NESTA RODADA:');
  } else {
    linhas.push('PROPOSTA:', proposta, '', 'REAÇÕES:');
  }
  for (const r of resultados) {
    const nome = smNomeAgente(r.bancada);
    if (!r.resposta) { linhas.push(`- ${nome}: sem resposta (${r.erro || 'erro'})`); continue; }
    const x = r.resposta;
    linhas.push(`- ${nome}: ${x.posicao}. Objeções: ${x.objecoes.map(o => smObjTexto(o) + (o.base === 'nenhuma' ? ' [sem base nos dados]' : '')).join('; ') || '—'}. Concessão: ${x.concessao || '—'}. Argumento: ${x.argumento || '—'}. Risco: ${x.risco || '—'}.`);
    if ((x.pontos || []).length) linhas.push('  Pontos: ' + x.pontos.map(p => `${p.n}: ${p.acao}${p.importancia ? ` (importância ${p.importancia}/5)` : ''}${p.redacao ? ` — nova redação: ${p.redacao}` : ''}${p.troca ? ` — troca: ${p.troca}` : ''}`).join('; '));
  }
  return linhas.join('\n');
}

// ---------- perfis salvos (banco compartilhado) ----------
// /labs/simulador/perfis/{chave}: { tipo, nome, sigla?, descricao?, contexto, quem, atualizadoEm }
// chave: sigla do partido, "__governo" ou "x-{slug}" para personalizados.
const SM_PERFIS = '/labs/simulador/perfis';

function smSlug(s) { return labsNorm(s).replace(/\s+/g, '-').slice(0, 60) || 'agente'; }

async function smLerPerfisSalvos() {
  try { return (await labsJson(`${LABS_FIREBASE}${SM_PERFIS}.json`)) || {}; }
  catch (e) { return {}; }
}

async function smGravarPerfil(chave, dado) {
  const r = await fetch(`${LABS_FIREBASE}${SM_PERFIS}/${labsSanitizar(chave)}.json`, {
    method: dado === null ? 'DELETE' : 'PUT', headers: { 'Content-Type': 'application/json' },
    body: dado === null ? undefined : JSON.stringify(dado),
  });
  if (!r.ok) throw new Error('banco de dados: HTTP ' + r.status);
}

/**
 * Monta a lista de agentes da tela. Pura.
 * bancadas: todas as bancadas por tamanho; salvos: perfis do banco.
 * Entram: Governo, as SM_MAX_BANCADAS maiores, partidos com perfil salvo e os
 * personalizados salvos. Marcados de saída: Governo e as SM_MARCADAS maiores.
 */
function smMontarAgentes(bancadas, salvos) {
  const sv = salvos || {};
  const ctx = k => (sv[labsSanitizar(k)] || {});
  const lista = [{ chave: SM_GOVERNO, tipo: 'governo', sigla: SM_GOVERNO, nome: 'Governo', cadeiras: 0, marcado: true }];
  bancadas.forEach((b, i) => {
    if (i < SM_MAX_BANCADAS || sv[labsSanitizar(b.sigla)]) {
      lista.push({ chave: b.sigla, tipo: 'partido', sigla: b.sigla, nome: b.sigla, cadeiras: b.cadeiras, marcado: i < SM_MARCADAS });
    }
  });
  for (const [k, p] of Object.entries(sv)) {
    if (!p || !['frente', 'relator', 'outro'].includes(p.tipo)) continue;
    lista.push({ chave: k, tipo: p.tipo, sigla: k, nome: p.nome || k, cadeiras: 0, descricao: p.descricao || '', marcado: false });
  }
  for (const a of lista) {
    const p = ctx(a.chave);
    a.contexto = p.contexto || '';
    a.salvo = p.atualizadoEm ? { quem: p.quem || '', em: p.atualizadoEm } : null;
  }
  return lista;
}

// ---------- modelos ----------
function smLerModelosSalvos() {
  try { return JSON.parse(localStorage.getItem('labsSmModelos') || '{}') || {}; } catch (_) { return {}; }
}

async function smCarregarModelos() {
  const cfg = await labsConfigIA();
  const prov = cfg.provedor || 'gemini';
  const meta = (typeof PROVEDORES_META !== 'undefined' && PROVEDORES_META[prov]) || null;
  let lista = meta ? meta.modelosFallback.slice() : [];
  if (meta && cfg.apiKey) {
    try { const vivos = await meta.listar(cfg.apiKey); if (vivos && vivos.length) lista = vivos; } catch (_) {}
  }
  const ids = new Set();
  const opcoes = [];
  for (const m of lista) if (m && m.id && !ids.has(m.id)) { ids.add(m.id); opcoes.push(m); }
  const padrao = `<option value="">o configurado${cfg.modelo ? ' (' + labsEsc(cfg.modelo) + ')' : ''}</option>`;
  const html = padrao + opcoes.map(m => `<option value="${labsEsc(m.id)}">${labsEsc(m.displayName || m.id)}</option>`).join('');
  const salvos = smLerModelosSalvos();
  for (const [id, k] of [['smModeloAgentes', 'agentes'], ['smModeloSintese', 'sintese']]) {
    const el = smEl(id);
    el.innerHTML = html;
    if (salvos[k] && ids.has(salvos[k])) el.value = salvos[k];
  }
}

function smGuardarModelos() {
  try { localStorage.setItem('labsSmModelos', JSON.stringify({ agentes: smEl('smModeloAgentes').value, sintese: smEl('smModeloSintese').value })); } catch (_) {}
}

// ---------- tela: agentes ----------
async function smCarregarBancadas() {
  const caixa = smEl('smBancadas');
  try {
    const [deps, salvos] = await Promise.all([labsDeputadosAtuais(), smLerPerfisSalvos()]);
    sm.deputados = deps;
    sm.todas = smBancadasDe(deps);
    sm.bancadas = sm.todas;
    sm.agentes = smMontarAgentes(sm.todas, salvos);
    smRenderAgentes();
  } catch (e) {
    caixa.innerHTML = '<span class="prd-dica">Não foi possível carregar as bancadas (' + labsEsc(e.message) + '). Recarregue a página.</span>';
  }
}

function smRenderAgentes() {
  const fmt = iso => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return ''; } };
  smEl('smBancadas').innerHTML = sm.agentes.map((a, i) => {
    const tipo = a.tipo === 'partido' ? `<span class="prd-dica">${a.cadeiras} cadeiras</span>` : a.tipo === 'governo' ? '<span class="prd-dica">liderança</span>' : `<span class="tipo">${labsEsc(SM_TIPOS[a.tipo] || '')}</span>`;
    const removivel = a.tipo !== 'governo' && !(a.tipo === 'partido' && sm.todas.findIndex(b => b.sigla === a.sigla) < SM_MAX_BANCADAS);
    return `<div class="sm-ag${a.marcado ? '' : ' off'}">
      <label class="sm-ag-cab"><input type="checkbox" data-sm-marca="${i}"${a.marcado ? ' checked' : ''}> <b>${labsEsc(a.nome)}</b> ${tipo}</label>
      ${a.descricao ? `<div class="desc">${labsEsc(a.descricao)}</div>` : ''}
      <textarea data-sm-ctx="${i}" rows="1" maxlength="1500" placeholder="Contexto que as votações não mostram (opcional)">${labsEsc(a.contexto)}</textarea>
      <div class="sm-ag-acoes">
        <button class="sm-bt mini" data-sm-salvar="${i}">Salvar para a equipe</button>
        ${a.salvo ? `<span>salvo${a.salvo.quem ? ' por ' + labsEsc(a.salvo.quem) : ''} em ${labsEsc(fmt(a.salvo.em))}</span>` : ''}
        ${removivel ? `<button class="sm-bt mini" data-sm-remover="${i}">${a.salvo ? 'Excluir da equipe' : 'Tirar da lista'}</button>` : ''}
      </div></div>`;
  }).join('');
  const presentes = new Set(sm.agentes.map(a => a.sigla));
  smEl('smAddPartido').innerHTML = '<option value="">—</option>' +
    sm.todas.filter(b => !presentes.has(b.sigla)).map(b => `<option value="${labsEsc(b.sigla)}">${labsEsc(b.sigla)} (${b.cadeiras})</option>`).join('');
  const cx = smEl('smBancadas');
  cx.querySelectorAll('[data-sm-marca]').forEach(c => c.addEventListener('change', () => {
    sm.agentes[+c.dataset.smMarca].marcado = c.checked;
    c.closest('.sm-ag').classList.toggle('off', !c.checked);
  }));
  cx.querySelectorAll('[data-sm-ctx]').forEach(t => t.addEventListener('input', () => { sm.agentes[+t.dataset.smCtx].contexto = t.value; }));
  cx.querySelectorAll('[data-sm-salvar]').forEach(b => b.addEventListener('click', () => smSalvarAgente(+b.dataset.smSalvar)));
  cx.querySelectorAll('[data-sm-remover]').forEach(b => b.addEventListener('click', () => smRemoverAgente(+b.dataset.smRemover)));
  if (typeof smBtAtualizarCusto === 'function') smBtAtualizarCusto();   // custo do teste depende das bancadas marcadas
}

function smQuemSalva() {
  const q = String(smEl('smQuem').value || '').trim();
  try { localStorage.setItem('labsPlQuem', q); } catch (_) {}
  return q;
}

async function smSalvarAgente(i) {
  const a = sm.agentes[i];
  const dado = { tipo: a.tipo, nome: a.nome, contexto: String(a.contexto || '').trim(), quem: smQuemSalva(), atualizadoEm: new Date().toISOString() };
  if (a.tipo === 'partido') dado.sigla = a.sigla;
  if (a.descricao) dado.descricao = a.descricao;
  try {
    await smGravarPerfil(a.chave, dado);
    a.salvo = { quem: dado.quem, em: dado.atualizadoEm };
    labsStatus('smStatus', `Perfil de ${a.nome} salvo para a equipe.`);
    smRenderAgentes();
  } catch (e) {
    labsStatus('smStatus', 'Não salvou: ' + e.message, 'error');
  }
}

async function smRemoverAgente(i) {
  const a = sm.agentes[i];
  if (a.salvo) {
    if (!confirm(`Excluir o perfil salvo de ${a.nome} para toda a equipe?`)) return;
    try { await smGravarPerfil(a.chave, null); }
    catch (e) { labsStatus('smStatus', 'Não excluiu: ' + e.message, 'error'); return; }
  }
  sm.agentes.splice(i, 1);
  smRenderAgentes();
}

function smAddPartidoClick() {
  const sigla = smEl('smAddPartido').value;
  const b = sm.todas.find(x => x.sigla === sigla);
  if (!b || sm.agentes.some(a => a.sigla === sigla)) return;
  sm.agentes.push({ chave: b.sigla, tipo: 'partido', sigla: b.sigla, nome: b.sigla, cadeiras: b.cadeiras, marcado: true, contexto: '', salvo: null });
  smRenderAgentes();
}

function smNovoAgenteClick() {
  const nome = String(smEl('smNovoNome').value || '').trim();
  const descricao = String(smEl('smNovoDesc').value || '').trim();
  const tipo = smEl('smNovoTipo').value || 'outro';
  if (nome.length < 3 || descricao.length < 10) { labsStatus('smStatus', 'Dê nome e uma descrição (quem é e o que defende) ao agente.', 'error'); return; }
  const chave = 'x-' + smSlug(nome);
  if (sm.agentes.some(a => a.chave === chave)) { labsStatus('smStatus', 'Já existe um agente com esse nome.', 'error'); return; }
  sm.agentes.push({ chave, tipo, sigla: chave, nome, descricao, cadeiras: 0, marcado: true, contexto: '', salvo: null });
  smEl('smNovoNome').value = ''; smEl('smNovoDesc').value = '';
  labsStatus('smStatus', `${nome} adicionado. Use "Salvar para a equipe" para guardá-lo.`);
  smRenderAgentes();
}

// ---------- proposição ----------
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
  return { id: p.id, sigla, numero, ano, ementa: d.ementa || p.ementa || '', keywords: d.keywords || '',
    situacao: ((d.statusProposicao || {}).descricaoSituacao) || '' };
}

// ---------- rodadas ----------
/**
 * Roda uma rodada sobre a sessão: um agente por participante (com o histórico
 * dele nas rodadas anteriores) e a síntese. Acrescenta a rodada à sessão.
 */
async function smRodar(sessao, proposta) {
  const { cfg, modelos } = sessao;
  // Custo: chamadas CONCLUÍDAS por modelo; as que falharam contam à parte
  // (o provedor pode ou não cobrá-las — a tela diz as duas).
  const chamar = async (modelo, prompt) => {
    const m = modelo || cfg.modelo || '';
    const k = m || '(padrão do provedor)';
    try {
      // 8.000: o raciocínio dos modelos mais fortes conta dentro do limite; com
      // proposta em pontos, 4.000 podia cortar o JSON. Só se paga o gerado.
      const r = await chamarIA({ provedorId: cfg.provedor || 'gemini', apiKey: cfg.apiKey, modelo: m || undefined, prompt, opcoes: { maxSaida: 8000 } });
      sessao.custo[k] = (sessao.custo[k] || 0) + 1;
      return r;
    } catch (e) {
      sessao.falhasIA = (sessao.falhasIA || 0) + 1;
      throw e;
    }
  };
  // o contexto vale o que está na tela AGORA (a equipe pode ter atualizado entre rodadas)
  for (const ag of sessao.agentes) {
    const atual = (sm.agentes || []).find(a => a.chave === ag.chave);
    if (atual) ag.contexto = atual.contexto;
  }
  let feitas = 0;
  const rodar = async (ag, extra) => {
    const historico = sessao.rodadas.map(r => ({ proposta: r.proposta, resposta: (r.resultados.find(x => x.bancada.chave === ag.chave) || {}).resposta || null }));
    try {
      const r = await chamar(modelos.agentes, smPromptAgente(ag, sessao.perfis[ag.sigla], sessao.prop, proposta, sessao.meses, historico, extra));
      let resposta;
      try { resposta = smLerResposta(r.text); }
      catch (e) { throw new Error(r.truncated ? 'resposta cortada pelo limite de tamanho do modelo' : e.message); }
      smValidarBases(resposta, smRecebido(ag, sessao.perfis[ag.sigla], sessao.prop, extra));
      return { bancada: ag, perfil: sessao.perfis[ag.sigla], resposta };
    } catch (e) {
      return { bancada: ag, perfil: sessao.perfis[ag.sigla], resposta: null, erro: e.message };
    } finally {
      feitas++;
      labsStatus('smStatus', `Rodada ${sessao.rodadas.length + 1}: agentes respondendo… ${feitas}/${sessao.agentes.length}`, 'loading');
    }
  };
  // "Governo responde primeiro" (opcional): a liderança do Governo declara a
  // posição e as bancadas respondem SABENDO dela — como líder e liderados no
  // Political Actor Agent (AAAI 2025). Desligado (padrão), todos respondem
  // independentes: agentes de IA tendem a seguir a posição dominante, e a
  // ordem pode amplificar isso.
  const gov = sessao.govPrimeiro ? sessao.agentes.find(a => a.sigla === SM_GOVERNO) : null;
  const base = sessao.oposicao ? { oposicao: sessao.oposicao } : {};
  let resultados;
  if (gov) {
    const rg = await rodar(gov, base);
    const extra = Object.assign({}, base, rg.resposta ? { governo: rg.resposta } : {});
    const outros = await labsMapLimit(sessao.agentes.filter(a => a !== gov), 3, ag => rodar(ag, extra));
    let k = 0;
    resultados = sessao.agentes.map(a => a === gov ? rg : outros[k++]);
  } else {
    resultados = await labsMapLimit(sessao.agentes, 3, ag => rodar(ag, base));
  }
  labsStatus('smStatus', 'Sintetizando a rodada…', 'loading');
  let sintese = '';
  if (resultados.some(r => r.resposta)) {
    try { sintese = (await chamar(modelos.sintese, smPromptSintese(resultados, sessao.prop, proposta, sessao.rodadas))).text; }
    catch (e) { sintese = '_A síntese falhou: ' + e.message + '_'; }
  }
  sessao.rodadas.push({ proposta, resultados, sintese });
}

async function smSimularClick() {
  const bt = smEl('smSimular');
  const res = smEl('smResultado');
  const proposta = String(smEl('smProposta').value || '').trim();
  if (proposta.length < 15) { labsStatus('smStatus', 'Descreva a proposta em negociação (ao menos uma frase).', 'error'); return; }
  const agentes = (sm.agentes || []).filter(a => a.marcado).map(a => Object.assign({}, a));
  if (!agentes.length) { labsStatus('smStatus', 'Marque ao menos um agente.', 'error'); return; }
  const cfg = await labsConfigIA();
  if (!cfg.apiKey) { labsStatus('smStatus', 'Nenhuma chave de IA configurada. Clique no ⚙ no alto da página, cadastre o provedor e a chave e tente de novo.', 'error'); return; }
  const meses = parseInt(smEl('smMeses').value, 10) || 6;
  smGuardarModelos();
  bt.disabled = true; res.innerHTML = '';
  try {
    labsStatus('smStatus', 'Buscando a proposição…', 'loading');
    const prop = await smBuscarProposicao();
    const partidos = agentes.filter(a => a.tipo === 'partido').map(a => a.sigla);
    let itens = [], falhas = 0, blocosFalhou = false;
    if (partidos.length) {
      labsStatus('smStatus', 'Montando os perfis pelas votações reais…', 'loading');
      ({ itens, falhas, blocosFalhou } = await labsVotacoesPlenario(meses, m => labsStatus('smStatus', m, 'loading')));
    }
    sm.sessao = {
      cfg, prop, meses, falhas, blocosFalhou, votacoes: itens.length, agentes,
      perfis: smPerfis(itens, partidos),
      modelos: { agentes: smEl('smModeloAgentes').value, sintese: smEl('smModeloSintese').value },
      govPrimeiro: !!(smEl('smGovPrimeiro') && smEl('smGovPrimeiro').checked),
      oposicao: (smEl('smOposicao') && (smEl('smOposicao').value || (smEl('smOposicao').querySelector('option[selected]') || {}).value)) || '',
      rodadas: [], custo: {},
    };
    await smRodar(sm.sessao, proposta);
    labsStatus('smStatus', '');
    smRender(sm.sessao);
  } catch (e) {
    labsStatus('smStatus', 'Erro: ' + e.message, 'error');
  } finally {
    bt.disabled = false;
  }
}

async function smNovaRodadaClick() {
  const s = sm.sessao;
  if (!s) return;
  const proposta = String(smEl('smPropostaNova').value || '').trim();
  const anterior = s.rodadas[s.rodadas.length - 1].proposta;
  if (proposta.length < 15) { labsStatus('smStatus', 'Escreva a proposta reformulada.', 'error'); return; }
  if (proposta === anterior && !confirm('A proposta é igual à da rodada anterior. Rodar assim mesmo (para ver só o efeito do contexto atualizado)?')) return;
  const bt = smEl('smNovaRodada');
  bt.disabled = true;
  try {
    await smRodar(s, proposta);
    labsStatus('smStatus', '');
    smRender(s);
  } catch (e) {
    labsStatus('smStatus', 'Erro: ' + e.message, 'error');
    bt.disabled = false;
  }
}

/** Posição de cada agente em cada rodada: [{ nome, posicoes: ['rejeita','condiciona'], mudou }]. Pura. */
function smEvolucao(rodadas) {
  if (!rodadas.length) return [];
  return rodadas[0].resultados.map(x => {
    const posicoes = rodadas.map(r => { const y = r.resultados.find(z => z.bancada.chave === x.bancada.chave); return y && y.resposta ? y.resposta.posicao : 'sem resposta'; });
    return { nome: smNomeAgente(x.bancada), posicoes, mudou: new Set(posicoes).size > 1 };
  });
}

const SM_ROT_BASE = { perfil: 'base: votações', contexto: 'base: contexto da equipe', proposicao: 'base: ementa', proposta: 'base: proposta', governo: 'base: posição do Governo' };
const SM_ROT_ACAO = { apoia: '✓ apoia', rejeita: '✗ rejeita', reformula: '✎ reformula', troca: '⇄ troca', indefinida: '?' };

/**
 * Mapa ponto × agente de uma rodada (só quando a proposta tem 2+ pontos).
 * Pura no cálculo: { pontos, linhas: [{ ponto, celulas: [{agente, acao, importancia, redacao, troca}], cadeirasApoio, cadeirasRejeicao }] }.
 */
function smMapaPontos(rodada) {
  const pontos = smPontos(rodada.proposta);
  if (pontos.length < 2) return null;
  const linhas = pontos.map((ponto, i) => {
    const celulas = [];
    let cadeirasApoio = 0, cadeirasRejeicao = 0;
    for (const x of rodada.resultados) {
      const p = x.resposta && (x.resposta.pontos || []).find(q => q.n === i + 1);
      celulas.push({ agente: x.bancada, acao: p ? p.acao : null, importancia: p ? p.importancia : null, redacao: p ? p.redacao : '', troca: p ? p.troca : '' });
      if (p && smSomaCadeiras(x.bancada)) {
        if (p.acao === 'apoia') cadeirasApoio += x.bancada.cadeiras;
        if (p.acao === 'rejeita') cadeirasRejeicao += x.bancada.cadeiras;
      }
    }
    return { ponto, celulas, cadeirasApoio, cadeirasRejeicao };
  });
  return { pontos, linhas };
}

function smRenderPontos(rodada) {
  const m = smMapaPontos(rodada);
  if (!m) return '';
  const cab = rodada.resultados.map(x => `<th>${labsEsc(x.bancada.sigla === SM_GOVERNO ? 'Governo' : x.bancada.nome)}</th>`).join('');
  const corpo = m.linhas.map((l, i) => `<tr><td><b>${i + 1}.</b> ${labsEsc(l.ponto)}<div class="base">cadeiras: ${l.cadeirasApoio} apoiam · ${l.cadeirasRejeicao} rejeitam</div></td>${l.celulas.map(c => {
    if (!c.acao) return '<td class="base">—</td>';
    const det = [c.redacao && 'Nova redação: ' + c.redacao, c.troca && 'Troca: ' + c.troca].filter(Boolean).join(' | ');
    const linha = c.importancia === 5 ? ' sm-linha-vermelha' : '';
    return `<td class="sm-acao-${c.acao}${linha}" title="${labsEsc(det)}">${SM_ROT_ACAO[c.acao] || '?'}${c.importancia ? ` <span class="base">${c.importancia}/5</span>` : ''}${det ? ' *' : ''}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="labs-caixa"><h3>Mapa por ponto</h3>
    <div class="sub">Ação de cada agente em cada ponto e a importância que ele dá ao ponto (5/5 = linha vermelha, destacada). * = passe o mouse para ver a nova redação ou a troca proposta.</div>
    <div style="overflow-x:auto"><table class="labs-tab sm-mapa-pontos"><tr><th>Ponto</th>${cab}</tr>${corpo}</table></div></div>`;
}

function smRender(s) {
  const r = s.rodadas[s.rodadas.length - 1];
  const n = s.rodadas.length;
  const ap = smApoioEstimado(r.resultados);
  const card = (k, v, rot) => `<div class="labs-card ${k}"><div class="v">${v}</div><div class="l">${rot}</div></div>`;
  const agentes = r.resultados.map(x => {
    const ag = x.bancada;
    const nome = ag.sigla === SM_GOVERNO ? 'Governo' : ag.nome;
    const pf = x.perfil;
    const perfil = pf && ag.tipo === 'partido' ? `<div class="t">Perfil: ${ag.cadeiras} cadeiras · ${[
        pf.comparaveis ? `votou como o Governo orientou em ${smPct(pf.alinhamentoGoverno)} (${pf.comparaveis} votações)` : 'sem votações para medir o alinhamento com o Governo',
        pf.porContexto && pf.porContexto.consenso.n ? `no consenso ${smPct(pf.porContexto.consenso.alinhamento)} (${pf.porContexto.consenso.n})` : '',
        pf.porContexto && pf.porContexto.conflito.n ? `no conflito ${smPct(pf.porContexto.conflito.alinhamento)} (${pf.porContexto.conflito.n})` : '',
        pf.comparaveisOrientacao ? `orientação do líder igual à do Governo em ${smPct(pf.alinhamentoOrientacao)} (${pf.comparaveisOrientacao})` : '',
        pf.coesao != null ? `coesão ${smPct(pf.coesao)}` : ''].filter(Boolean).join(' · ')}</div>`
      : (ag.descricao ? `<div class="t">${labsEsc(SM_TIPOS[ag.tipo] || '')}: ${labsEsc(ag.descricao)}</div>` : '');
    const ctx = ag.contexto ? `<div class="t"><b>Contexto da equipe:</b> ${labsEsc(ag.contexto)}</div>` : '';
    if (!x.resposta) {
      return `<div class="labs-agente"><div class="cab"><b>${labsEsc(nome)}</b><span class="labs-pos indefinida">sem resposta</span></div>${perfil}${ctx}<div class="t">${labsEsc(x.erro || '')}</div></div>`;
    }
    const a = x.resposta;
    return `<div class="labs-agente"><div class="cab"><b>${labsEsc(nome)}</b><span class="labs-pos ${a.posicao}">${a.posicao === 'indefinida' ? 'indefinida' : a.posicao}</span></div>${perfil}${ctx}
      ${a.objecoes.length ? `<div class="t"><b>Objeções:</b> ${a.objecoes.map(o => labsEsc(smObjTexto(o)) + (o.base === 'nenhuma'
        ? (o.baseDeclarada
          ? ` <span class="sm-sembase" title="O agente citou uma fonte que não recebeu">sem base — citou ${labsEsc((SM_ROT_BASE[o.baseDeclarada] || o.baseDeclarada).replace(/^base: /, ''))}, que ele não recebeu</span>`
          : ' <span class="sm-sembase" title="O agente não apontou apoio nos dados que recebeu">sem base nos dados</span>')
        : ` <span class="sm-base">${labsEsc(SM_ROT_BASE[o.base] || o.base)}</span>`)).join(' · ')}</div>` : ''}
      ${a.concessao ? `<div class="t"><b>Destravaria:</b> ${labsEsc(a.concessao)}</div>` : ''}
      ${a.argumento ? `<div class="t"><b>Argumento que pesa:</b> ${labsEsc(a.argumento)}</div>` : ''}
      ${a.risco ? `<div class="t"><b>Risco de ruptura:</b> ${labsEsc(a.risco)}</div>` : ''}
      ${a.notas ? `<details class="t"><summary>Notas do agente para a próxima rodada</summary>${labsEsc(a.notas)}</details>` : ''}</div>`;
  }).join('');
  const matriz = smRenderPontos(r);
  const semBase = r.resultados.reduce((n, x) => n + (x.resposta ? x.resposta.objecoes.filter(o => o.base === 'nenhuma').length : 0), 0);
  const totalObj = r.resultados.reduce((n, x) => n + (x.resposta ? x.resposta.objecoes.length : 0), 0);
  let evolucao = '';
  if (n > 1) {
    const ev = smEvolucao(s.rodadas);
    const cad = s.rodadas.map(x => smApoioEstimado(x.resultados));
    evolucao = `<div class="labs-caixa"><h3>Evolução da negociação</h3>
      <table class="labs-tab sm-evol"><tr><th>Agente</th>${s.rodadas.map((_, i) => `<th>Rodada ${i + 1}</th>`).join('')}</tr>
      ${ev.map(e => `<tr><td>${labsEsc(e.nome)}</td>${e.posicoes.map((p, i) => `<td class="${i && p !== e.posicoes[i - 1] ? 'mudou' : ''}"><span class="labs-pos ${SM_POSICOES.includes(p) ? p : 'indefinida'}">${p}</span></td>`).join('')}</tr>`).join('')}
      <tr><td class="base">Cadeiras que apoiam</td>${cad.map(c => `<td class="base">${c.apoia} de ${c.total}</td>`).join('')}</tr></table>
      ${s.rodadas.map((x, i) => `<div class="sub" style="margin-top:4px"><b>Proposta da rodada ${i + 1}:</b> ${labsEsc(x.proposta)}</div>`).join('')}</div>`;
  }
  const prop = s.prop ? `<div class="sub">${labsEsc(s.prop.sigla + ' ' + s.prop.numero + '/' + s.prop.ano)} — ${labsEsc(s.prop.ementa)}</div>
    ${smJaEhLei(s.prop) ? `<div class="labs-aviso"><b>Esta proposição já virou lei</b> (situação na Câmara: ${labsEsc(s.prop.situacao)}). Os agentes foram instruídos
      a tratar a proposta como alteração da lei em vigor — mas, para simular uma negociação real, prefira indicar a proposição PENDENTE sobre o tema
      (ou deixe número e ano em branco e descreva a mudança na lei).</div>` : ''}` : '';
  const custo = Object.entries(s.custo).map(([m, c]) => `${c} com ${labsEsc(m)}`).join(', ');
  const total = Object.values(s.custo).reduce((a, b) => a + b, 0);
  const falhasIA = s.falhasIA ? `; mais ${s.falhasIA} que falharam` : '';
  smEl('smResultado').innerHTML = `
    ${prop}
    <h3 style="margin-top:10px">Rodada ${n}</h3>
    <div class="labs-cards">
      ${card('f5', ap.apoia, 'cadeiras: apoia')}
      ${card('f3', ap.condiciona, 'cadeiras: condiciona')}
      ${card('f1', ap.rejeita, 'cadeiras: rejeita')}
      ${ap.indefinida ? card('f0', ap.indefinida, 'cadeiras: indefinida') : ''}
      ${ap.semResposta ? card('f0', ap.semResposta, 'cadeiras: sem resposta (erro)') : ''}
    </div>
    ${s.blocosFalhou ? `<div class="labs-aviso"><b>Atenção:</b> a lista de blocos da Câmara não carregou. Partidos que só orientam pelo bloco
      podem ter ficado sem a medida de orientação — o alinhamento pelo voto da bancada não é afetado. Tente de novo em instantes.</div>` : ''}
    <div class="labs-aviso">Soma das cadeiras das bancadas partidárias simuladas (${ap.total}) pela posição que o <b>agente</b> declarou
      (Governo e agentes personalizados não somam). Não é previsão de placar: a bancada real pode se dividir e os agentes tendem a concordar mais do que as bancadas.</div>
    ${s.govPrimeiro ? '<div class="labs-aviso">Nesta simulação o <b>Governo respondeu primeiro</b> e as bancadas responderam conhecendo a posição dele.</div>' : ''}
    ${totalObj ? `<div class="labs-custo">${semBase} de ${totalObj} objeções sem base declarada nos dados (marcadas) — trate-as como hipótese do modelo, não como informação.</div>` : ''}
    ${matriz}
    ${evolucao}
    ${r.sintese ? `<div class="labs-caixa"><h3>Síntese da rodada ${n}</h3><div class="labs-sintese">${renderMarkdown(r.sintese)}</div></div>` : ''}
    <h3 style="margin-top:14px">Reação por agente</h3>
    ${agentes}
    <div class="labs-caixa"><h3>Nova rodada</h3>
      <div class="sub">Reformule a proposta a partir das objeções e rode de novo com os mesmos agentes: cada um recebe o que disse
        antes e diz se a mudança o atende. O contexto dos agentes vale como estiver na lista acima no momento da rodada.</div>
      <textarea id="smPropostaNova" class="field" rows="4" maxlength="2500" style="margin-top:6px">${labsEsc(r.proposta)}</textarea>
      <button id="smNovaRodada" class="btn-gerar" style="margin-top:6px">Rodar a rodada ${n + 1}</button></div>
    <div class="labs-custo">${s.agentes.some(a => a.tipo === 'partido') ? `Perfis de ${s.votacoes} votações nominais do Plenário (últimos ${s.meses} meses)${s.falhas ? `; ${s.falhas} votações não puderam ser lidas` : ''}. ` : ''}
      Custo até aqui: ${total} chamadas de IA concluídas pela sua chave (${labsEsc(s.cfg.provedor || 'gemini')}: ${custo || '—'})${falhasIA}.</div>`;
  smEl('smNovaRodada').addEventListener('click', smNovaRodadaClick);
}

if (smEl('smSimular')) {
  smEl('smSimular').addEventListener('click', smSimularClick);
  smEl('smAddPartidoBt').addEventListener('click', smAddPartidoClick);
  smEl('smNovoAdd').addEventListener('click', smNovoAgenteClick);
  smEl('smModeloAgentes').addEventListener('change', smGuardarModelos);
  smEl('smModeloSintese').addEventListener('change', smGuardarModelos);
  try { smEl('smQuem').value = localStorage.getItem('labsPlQuem') || ''; } catch (_) {}
  let carregou = false;
  document.addEventListener('labs:aba', ev => {
    if (ev.detail === 'aba-simulador' && !carregou) { carregou = true; smCarregarBancadas(); smCarregarModelos(); }
  });
  // Trocou provedor/chave/modelo no ⚙: as listas de modelo dos agentes e da síntese acompanham.
  try {
    chrome.storage.onChanged.addListener((mud, area) => {
      if (area === 'local' && mud.config && carregou) smCarregarModelos();
    });
  } catch (_) {}
}
