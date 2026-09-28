// Sustentação do posicionamento, para a aba "Como votou o deputado".
//
// Arquivo separado de resumos.js de propósito. Os dois chamam o mesmo provedor
// de IA e leem o mesmo material, mas fazem coisas de naturezas diferentes:
// resumos.js DESCREVE o que se votou, e este ARGUMENTA a favor de uma posição.
// Misturar os dois num arquivo só embaralharia, no código, exatamente a linha
// que o documento precisa manter nítida — e é essa linha que faz o relatório
// continuar servindo como peça de conferência depois de ganhar uma defesa.
//
// A regra dura desta tela: a defesa é RECUSADA quando a posição declarada
// contraria o voto registrado. Um documento que sustenta "o deputado é
// favorável" enquanto a ata da Câmara mostra voto contra o texto não protege
// ninguém: é munição pronta para quem for questionar. Quando o registro não
// resolve — porque a votação do texto principal foi simbólica, o que é comum —,
// a defesa sai, e o documento diz que o voto registrado não estabelece a
// posição, para que ninguém leia sustentação onde há só argumento.
//
// A sustentação NÃO busca na web por conta própria, embora o pipeline consulte a
// internet antes dela. Quem busca é imprensa.js, que valida ponto por ponto
// contra as fontes que o provedor consultou e passa pela marcação do analista; o
// que chega aqui é esse levantamento já conferido. Deixar a sustentação buscar
// sozinha não daria a mesma garantia com outro nome: o texto dela é prosa
// corrida, e não há como conferir depois, frase a frase, o que veio de fonte e o
// que o modelo completou. Uma etapa que valida e outra que redige protege mais
// do que uma etapa que faz as duas coisas.
//
// Depende de aderencia.js (cvEsc), ia-comum.js (chamarIA), resumos.js e
// imprensa.js (impSelecionados).

const DFS_POSICOES = {
  favoravel: 'favorável à matéria',
  contraria: 'contrária à matéria',
};

// O que conta como votação DO TEXTO da matéria — e não de um destaque, de um
// requerimento de adiamento ou de uma emenda avulsa. Só nesses itens o voto
// diz algo sobre a posição do deputado quanto ao projeto em si; num destaque
// para supressão, "Sim" quer dizer suprimir, não ser favorável ao projeto.
//
// Deixar de reconhecer uma votação de texto principal NÃO é erro inofensivo. É
// o pior erro desta tela: sem reconhecê-la, o registro passa por mudo, o
// conflito não é detectado e a extensão gera alegremente uma sustentação
// contrária ao voto que consta da ata — que é exatamente o documento que esta
// camada existe para impedir. Por isso a lista cobre as formas como a API
// efetivamente descreve o resultado, e não só a forma da tramitação.
const DFS_RE_TEXTO = new RegExp([
  'reda[çc][ãa]o final',
  'emenda substitutiva global',        // pega também "subemenda substitutiva global"
  'substitutivo global',
  'substitutivo d[oa] senado',         // "Aprovado o Substitutivo do Senado Federal ao PL…"
  'texto[-\\s]?base',                  // "Aprovado o texto-base"
  'projeto de lei de convers[ãa]o',    // medida provisória
  'vota[çc][ãa]o do projeto\\b',
  'projeto de lei n[º°.]?\\s*[\\d.-]+\\s*,?\\s*de\\s*\\d{4}\\s*\\.?\\s*$',
].join('|'), 'i');

// O que, mesmo citando o texto principal, é item acessório: o voto ali é sobre
// o requerimento ou o destaque, não sobre a matéria. "Aprovado o Requerimento de
// destaque do Substitutivo do Senado" cita o substitutivo e não é votação dele.
const DFS_RE_ACESSORIO = /destaque|requerimento|\bDTQ\b|\bDVS\b|adiamento|retirada de pauta|urg[êe]ncia/i;

/**
 * Tira a ressalva antes de classificar o objeto.
 *
 * "Aprovado o Projeto de Lei nº 3.626, de 2023, ressalvados os destaques" é
 * votação DO TEXTO, e das formas mais comuns na Câmara: a menção a destaque ali
 * diz o que ficou de fora da votação, não o que se votou. Sem tirá-la, ela
 * atrapalha das duas maneiras — faz o item parecer acessório, e ainda
 * desancora o final da frase, que é por onde se reconhece a matéria.
 */
function dfsSemRessalva(alvo) {
  return String(alvo == null ? '' : alvo).replace(/,?\s*ressalvad[oa]s?\s+[^.;]*/ig, '').trim();
}

/** O objeto da votação é o TEXTO da matéria? */
function dfsEhTextoPrincipal(alvo) {
  const t = dfsSemRessalva(alvo);
  return DFS_RE_TEXTO.test(t) && !DFS_RE_ACESSORIO.test(t);
}

/**
 * O que o voto registrado diz sobre a posição do deputado na matéria.
 * Devolve { posicao, evidencia[] } — `posicao` é null quando o registro não
 * resolve, que NÃO é o mesmo que posição neutra.
 */
function dfsPosicaoRegistrada(linhas, objetos) {
  const evidencia = [];
  for (const { it, s } of linhas) {
    const v = it.votacao;
    const alvo = String(objetos[v.id] || v.descricao || '');
    if (!dfsEhTextoPrincipal(alvo)) continue;
    if (!s.voto) continue;                       // simbólica ou ausência não dizem nada
    const voto = String(s.voto).trim().toLowerCase();
    if (voto !== 'sim' && voto !== 'não' && voto !== 'nao') continue;
    evidencia.push({ id: v.id, data: v.data, objeto: alvo, voto: s.voto,
                     posicao: voto === 'sim' ? 'favoravel' : 'contraria' });
  }
  if (!evidencia.length) return { posicao: null, evidencia: [] };
  const fav = evidencia.filter(x => x.posicao === 'favoravel').length;
  const con = evidencia.length - fav;
  // Votos divididos sobre o texto não estabelecem posição: o documento não pode
  // escolher um lado por maioria simples de itens.
  if (fav && con) return { posicao: null, evidencia, dividido: true };
  return { posicao: fav ? 'favoravel' : 'contraria', evidencia };
}

/** O conflito, quando existe. null quando a defesa pode seguir. */
function dfsConflito(declarada, registro) {
  if (!declarada || !registro || !registro.posicao) return null;
  if (registro.posicao === declarada) return null;
  return {
    declarada, registrada: registro.posicao,
    itens: registro.evidencia.filter(x => x.posicao === registro.posicao),
  };
}

// ---------------------------------------------------------------------------
//  Sentido do voto num item — calculado pelo CÓDIGO, nunca pela IA
// ---------------------------------------------------------------------------
// Num destaque, "Sim" e "Não" mudam de sentido conforme o tipo: na emenda
// destacada, "Sim" aprova a emenda; no DVS, "Sim" costuma ser MANTER o texto.
// Se o modelo decifrasse isso sozinho e errasse, sairia a justificativa do voto
// CONTRÁRIO com o nome do deputado. Por isso o sentido sai do resultado
// registrado: "Rejeitada a Emenda de Plenário nº 26. Sim: 82; não: 342" diz que
// o lado "Não" venceu e que vencer foi rejeitar — quem votou Não votou pela
// rejeição; quem votou Sim, pela aprovação. Sem placar, ou com resultado de
// forma desconhecida, o sentido fica NÃO DETERMINADO e o prompt é instruído a
// não afirmar o que o voto significou.

const DFS_RESULTADOS = [
  { re: /^aprovad[oa]s?\b/i,  feito: 'aprovação',  contrario: 'rejeição' },
  { re: /^rejeitad[oa]s?\b/i, feito: 'rejeição',   contrario: 'aprovação' },
  { re: /^mantid[oa]s?\b/i,   feito: 'manutenção', contrario: 'supressão' },
  { re: /^suprimid[oa]s?\b/i, feito: 'supressão',  contrario: 'manutenção' },
];

/** "a Emenda nº 26" → "da Emenda nº 26" (contração com a preposição "de"). */
function dfsComDe(obj) {
  const t = String(obj || '').trim();
  const m = t.match(/^(os|as|o|a)\s+/i);
  if (!m) return 'de ' + t;
  return ({ o: 'do', a: 'da', os: 'dos', as: 'das' })[m[1].toLowerCase()] + ' ' + t.slice(m[0].length);
}

/**
 * Sentido do voto do deputado num item, a partir do resultado registrado.
 * Devolve { texto, venceu } — ex.: { texto: 'pela rejeição da Emenda de
 * Plenário nº 26', venceu: true } — ou null quando não dá para determinar.
 */
function dfsSentidoDoVoto(voto, descricao) {
  const v = String(voto || '').trim().toLowerCase();
  if (v !== 'sim' && v !== 'não' && v !== 'nao') return null;
  const d = String(descricao || '').replace(/\s+/g, ' ').trim();
  const sim = d.match(/\bSim:\s*(\d+)/i), nao = d.match(/\bN[ãa]o:\s*(\d+)/i);
  if (!sim || !nao) return null;
  const nSim = Number(sim[1]), nNao = Number(nao[1]);
  if (nSim === nNao) return null;
  const tipo = DFS_RESULTADOS.find(r => r.re.test(d));
  if (!tipo) return null;
  // O objeto: o que vem depois do verbo, até o fim da frase (sem a ressalva).
  const obj = dfsSemRessalva(d.replace(tipo.re, '').split(/\.\s|\.$/)[0]).trim();
  if (!obj) return null;
  const venceu = (nSim > nNao) === (v === 'sim');
  return { texto: `pela ${venceu ? tipo.feito : tipo.contrario} ${dfsComDe(obj)}`, venceu };
}

/**
 * O que o levantamento de repercussão acrescenta ao pedido, já filtrado pelo que
 * o analista deixou marcado. Vazio quando não houve levantamento.
 *
 * Entra como PERGUNTA A RESPONDER, e não como fato a afirmar. A diferença é toda
 * a segurança do bloco: a sustentação é prosa livre, que nenhuma conferência
 * posterior consegue destrinchar afirmação por afirmação. Se a crítica da
 * imprensa entrasse aqui como material a repetir, uma manchete errada viraria
 * fato dentro de um documento com o nome do deputado. Entrando como pergunta, o
 * pior caso é a sustentação responder a algo que não se sustenta — e isso o
 * analista lê e corta.
 */
function dfsImprensaPrompt(imp) {
  if (!imp || !imp.ok) return '';
  const sel = impSelecionados(imp);
  if (!sel.total) return '';
  const lista = ps => ps.map(p => `- ${p.texto} (fonte: ${p.fontes.map(f => f.veiculo || 'origem não identificada').join(', ')})`).join('\n');
  const p = [];
  if (imp.apelido) p.push(`A matéria é conhecida publicamente como "${imp.apelido}".`);
  if (sel.focos.length) p.push(`O que a cobertura pública destaca:\n${lista(sel.focos)}`);
  if (sel.contencioso.length) p.push(`O QUE ESTÁ CONTESTADO publicamente — é a isto que a sustentação precisa dar resposta:\n${lista(sel.contencioso)}`);
  return `\nREPERCUSSÃO PÚBLICA JÁ LEVANTADA (conferida pelo analista):
${p.join('\n\n')}

Como usar esta parte: ela diz o que já foi dito lá fora, para a sustentação não
deixar sem resposta a crítica que vai aparecer. NÃO repita como verdade o que
está aí, não cite veículo, não diga "a imprensa afirma que". Trate cada ponto
contestado como a objeção a enfrentar com argumento próprio.

Em especial, NÃO reaproveite número, percentual, valor em reais, prazo nem nome
de órgão que apareça acima. Eles vieram de terceiros e não foram conferidos no
texto da matéria; repetidos numa sustentação assinada, um número errado deixa de
ser erro de jornal e passa a ser erro do deputado. Responda à objeção pelo
argumento, sem citar a cifra de que ela se vale.
`;
}

function dfsPrompt({ posicao, dep, prop, materia, itens, registro, enfase, imprensa, foco }) {
  const linhas = itens.map(i => `- ${i.objeto}${i.voto ? ` — voto do deputado: ${i.voto}` : ''}${
    i.simples ? `\n  (o que fazia: ${i.simples})` : ''}`).join('\n');
  if (foco && foco.length) return dfsPromptFoco({ posicao, dep, prop, materia, registro, enfase, imprensa, foco });

  return `Você escreve a sustentação pública do posicionamento de um parlamentar brasileiro.

QUEM: Dep. ${dep.nome} (${dep.partido}-${dep.uf}).
MATÉRIA: ${prop ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}` : 'a matéria consultada'}.
POSIÇÃO A SUSTENTAR: ${DFS_POSICOES[posicao]}.
${enfase ? `PONTO A ENFATIZAR (pedido do analista): ${enfase}\n` : ''}
DO QUE TRATA A MATÉRIA:
${materia || '(não disponível)'}

O QUE FOI VOTADO, E COMO O DEPUTADO VOTOU:
${linhas || '(nenhum item com voto nominal registrado)'}
${dfsImprensaPrompt(imprensa)}
REGISTRO DE VOTO SOBRE O TEXTO: ${registro && registro.posicao
  ? `o deputado votou de forma ${DFS_POSICOES[registro.posicao]} no texto.`
  : 'as votações do texto principal foram simbólicas ou não houve voto nominal dele, então o registro não estabelece a posição.'}

REGRAS, todas obrigatórias:
- Escreva em português claro, para imprensa e para órgão de controle. Sem jargão
  regimental: nada de "art. 161", "DVS", "destaque nos termos de".
- Pode usar argumento de princípio, de contexto e de consequência. NÃO invente
  número, percentual, estudo, pesquisa, valor financeiro, data ou citação de
  terceiro que não esteja acima. Se quiser falar de efeito, fale
  qualitativamente.
- Não ataque adversários, não atribua má-fé a ninguém, não fale de outros
  parlamentares nominalmente.
- Não afirme que o deputado votou de um jeito que não esteja na lista acima.
- Se o registro não estabelece a posição, sustente pelo argumento e não afirme
  que o voto dele comprova a posição.
- A POSIÇÃO É UMA SÓ, E É SOBRE A MATÉRIA INTEIRA. O deputado não tem uma
  posição para cada destaque, emenda ou requerimento votado: tem a posição
  declarada acima, sobre o projeto. Nunca escreva que ele "é favorável à emenda
  X" ou "é contrário ao destaque Y" como se fossem posições dele à parte.
${itens.some(i => i.voto) ? `- DENTRO DISSO, DIGA POR QUE CADA VOTO IMPORTOU. Para os itens em que consta
  voto do deputado, explique o que aquele ponto decidia e COMO aquela escolha
  serviu à posição sobre o projeto — o que ela preservou do texto, o que
  impediu, o que manteve em pauta. O voto num item é instrumento da posição
  sobre a matéria, e é assim que ele tem de aparecer: nunca como uma posição
  nova, nem como opinião do deputado sobre aquele dispositivo.
- Ao fazer isso, não invente a motivação dele ("votou assim porque acreditava
  que…") nem credite a um voto isolado o resultado da votação. O que se explica
  é o que aquele ponto decidia — não o que se passava na cabeça de alguém, nem
  o que teria acontecido se o voto fosse outro.
` : ''}- Três a cinco parágrafos. Comece pelo argumento central, não por preâmbulo.

Responda SOMENTE com o texto da sustentação, em parágrafos separados por linha
em branco. Sem título, sem marcadores, sem cercas de código.`;
}

/**
 * A sustentação FOCADA nos itens que o analista selecionou. A matéria entra
 * como contexto; o que se sustenta é o voto em cada item, com o SENTIDO já
 * determinado pelo código (dfsSentidoDoVoto) — o modelo não reinterpreta Sim/Não.
 */
function dfsPromptFoco({ posicao, dep, prop, materia, registro, enfase, imprensa, foco }) {
  const itens = foco.map(i => `- ${i.objeto}
  Voto do deputado: ${i.voto}.
  ${i.sentido ? `SENTIDO DO VOTO (já determinado — use exatamente): ${i.sentido.texto}${i.sentido.venceu ? ' — foi o lado vencedor' : ' — foi o lado vencido'}.`
              : 'SENTIDO DO VOTO: NÃO DETERMINADO — não afirme o que este voto aprovou, rejeitou, manteve ou suprimiu.'}
  ${i.simples ? `O que o item fazia: ${i.simples}` : 'O conteúdo do item não foi transcrito: argumente só com o que está acima, sem supor o que ele fazia.'}${
  i.literal ? `\n  Texto do documento: ${i.literal}` : ''}`).join('\n\n');

  return `Você escreve a sustentação pública do VOTO de um parlamentar brasileiro em itens específicos de uma votação.

QUEM: Dep. ${dep.nome} (${dep.partido}-${dep.uf}).
MATÉRIA: ${prop ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}` : 'a matéria consultada'}.
POSIÇÃO DO DEPUTADO SOBRE A MATÉRIA (contexto): ${DFS_POSICOES[posicao]}.
${enfase ? `PONTO A ENFATIZAR (pedido do analista): ${enfase}\n` : ''}
DO QUE TRATA A MATÉRIA (contexto):
${materia || '(não disponível)'}

OS ITENS A SUSTENTAR — e SOMENTE estes:
${itens}
${dfsImprensaPrompt(imprensa)}
REGRAS, todas obrigatórias:
- Trate SOMENTE dos itens acima. Não comente os demais destaques, emendas ou
  requerimentos da votação, nem a votação do texto principal, a não ser como
  pano de fundo em uma frase.
- O SENTIDO DO VOTO de cada item está determinado acima. Use-o exatamente como
  está: nunca diga que o deputado aprovou o que rejeitou, ou o contrário. Onde
  o sentido estiver "não determinado", não afirme o que o voto significou.
- Explique o que o item decidia e por que o voto dado serve à posição do
  deputado sobre a matéria. A explicação da matéria é contexto, não o assunto.
- Escreva em português claro, para imprensa e para órgão de controle. Sem jargão
  regimental: nada de "art. 161", "DVS", "destaque nos termos de".
- NÃO invente número, percentual, estudo, valor, data ou citação que não esteja
  acima. Efeito, só qualitativamente.
- Não ataque adversários, não atribua má-fé, não fale de outros parlamentares
  nominalmente, não invente a motivação pessoal do deputado.
- ${foco.length === 1 ? 'Um a três parágrafos.' : 'Um parágrafo por item, no máximo dois; e um de abertura, se ajudar.'} Comece pelo argumento, sem preâmbulo.

Responda SOMENTE com o texto da sustentação, em parágrafos separados por linha
em branco. Sem título, sem marcadores, sem cercas de código.`;
}

/**
 * Os itens de foco no formato do prompt e do documento, a partir das linhas
 * selecionadas: objeto, voto, sentido calculado, resumo e texto literal.
 */
function dfsItensFoco(linhas, objetos, resumos) {
  return linhas.map(({ it, s }) => {
    const v = it.votacao;
    const r = resumos && resumos.itens && resumos.itens[v.id];
    const literal = [r && r.pedido && r.pedido.texto, r && r.justificacao && r.justificacao.texto].filter(Boolean).join(' ');
    return {
      id: v.id,
      objeto: String(objetos[v.id] || v.descricao || '').slice(0, 300),
      voto: s.voto,
      sentido: dfsSentidoDoVoto(s.voto, v.descricao),
      simples: r && r.simples ? r.simples : null,
      literal: literal ? literal.slice(0, 800) : null,
    };
  });
}

/**
 * Gera a sustentação. Devolve { ok, texto, modelo } ou { ok:false, motivo, ... }.
 * Nenhum caminho de falha devolve texto: defesa que não veio precisa aparecer
 * como defesa que não veio.
 */
async function dfsGerar({ posicao, dep, prop, resumos, linhas, objetos, enfase, imprensa, focoIds }) {
  if (!posicao || !DFS_POSICOES[posicao]) return { ok: false, motivo: 'sem-posicao' };
  const cfg = await rsmConfigIA();
  if (!cfg.apiKey) return { ok: false, motivo: 'sem-chave' };

  const registro = dfsPosicaoRegistrada(linhas, objetos);
  const conflito = dfsConflito(posicao, registro);
  if (conflito) return { ok: false, motivo: 'conflito', conflito, registro };

  const itens = linhas.map(({ it, s }) => {
    const r = resumos && resumos.itens[it.votacao.id];
    return {
      objeto: String(objetos[it.votacao.id] || it.votacao.descricao || '').slice(0, 300),
      voto: s.situacao === 'simbolica' ? null : (s.voto || null),
      simples: r && r.simples ? r.simples : null,
    };
  }).filter(i => i.objeto);

  // Foco: só as linhas selecionadas pelo analista que tenham voto Sim/Não. A
  // trava de conflito acima continua olhando TODAS as linhas — o voto no texto
  // principal é o que diz a posição, com ou sem foco.
  const idsFoco = new Set(focoIds || []);
  const linhasFoco = idsFoco.size
    ? linhas.filter(l => idsFoco.has(l.it.votacao.id) && /^(sim|n[ãa]o)$/i.test(String(l.s.voto || '').trim()))
    : [];
  if (idsFoco.size && !linhasFoco.length) return { ok: false, motivo: 'foco-vazio' };
  const foco = linhasFoco.length ? dfsItensFoco(linhasFoco, objetos, resumos) : null;

  const materia = resumos && resumos.materia
    ? [resumos.materia.simples, resumos.materia.ementa].filter(Boolean).join(' ')
    : (prop ? String(prop.ementa || '') : '');

  let resposta;
  try {
    resposta = await chamarIA({
      provedorId: cfg.provedor || 'gemini',
      apiKey: cfg.apiKey,
      modelo: cfg.modelo || RSM_MODELO_PADRAO,
      prompt: dfsPrompt({ posicao, dep, prop, materia, itens, registro, enfase, imprensa, foco }),
      opcoes: { maxSaida: 6000 },
    });
  } catch (e) {
    return { ok: false, motivo: 'erro', erro: e.message };
  }

  const texto = String((resposta && resposta.text) || '').trim()
    .replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  if (texto.length < 120) return { ok: false, motivo: 'resposta-curta' };

  // `original` guarda o que o provedor devolveu; `texto` é o que vai ao
  // documento e pode ser reescrito pelo analista. A diferença entre os dois é
  // o que permite ao PDF dizer se o texto foi revisado — e revisado por gente
  // é um texto de outra natureza.
  // `incluir` nasce FALSO. Gerar e incluir são atos diferentes: o rascunho
  // existe na tela para ser lido e corrigido, e só entra no documento quando o
  // analista marca. Um texto argumentativo que escorrega para dentro de um
  // documento de conferência sem alguém decidir é o pior caminho possível.
  return { ok: true, texto, original: texto, editado: false, incluir: false, posicao,
           modelo: cfg.modelo || RSM_MODELO_PADRAO, registro,
           usouImprensa: !!dfsImprensaPrompt(imprensa),
           foco: foco ? foco.map(f => ({ id: f.id, objeto: f.objeto, voto: f.voto, sentido: f.sentido })) : null };
}

/** A mensagem de recusa, que precisa dizer O QUE contraria o quê. */
function dfsTextoConflito(c) {
  const itens = c.itens.map(x =>
    `${String(x.data || '').split('-').reverse().join('/')} — ${x.objeto.slice(0, 120)} (voto: ${x.voto})`);
  return `A posição escolhida foi <b>${DFS_POSICOES[c.declarada]}</b>, mas o voto registrado do deputado no `
    + `texto da matéria foi <b>${DFS_POSICOES[c.registrada]}</b>. A sustentação não foi gerada: um documento `
    + `que defende posição contrária ao voto que consta da ata da Câmara é munição para quem for questionar, `
    + `não proteção.<br><br>O que consta:<br>${itens.map(i => '• ' + cvEsc(i)).join('<br>')}`;
}

/** O bloco da sustentação na tela. */
function dfsHtml(d) {
  if (!d) return '';
  if (!d.ok) {
    if (d.motivo === 'conflito') return `<div class="dfs dfs-conflito">
      <div class="dfs-rot">Sustentação não gerada</div>${dfsTextoConflito(d.conflito)}</div>`;
    const msg = {
      'sem-chave': 'Sem chave de IA configurada — a sustentação não pode ser gerada.',
      'erro': 'A geração falhou: ' + cvEsc(d.erro || '') + '. Tente de novo.',
      'resposta-curta': 'O provedor devolveu texto curto demais para servir. Tente de novo.',
      'sem-posicao': '',
      'foco-vazio': 'Nenhum dos itens selecionados tem voto Sim ou Não do deputado dentro do recorte — não há voto a sustentar.',
    }[d.motivo] || 'A sustentação não foi gerada.';
    return msg ? `<div class="dfs dfs-conflito"><div class="dfs-rot">Sustentação não gerada</div>${msg}</div>` : '';
  }
  // Campo EDITÁVEL, e não texto fixo: quem assina a sustentação é o analista,
  // não o provedor. O que sai no PDF é o que estiver aqui quando ele exportar.
  const linhas = Math.min(28, Math.max(10, d.texto.split('\n').length + Math.ceil(d.texto.length / 90)));
  return `<div class="dfs">
    <div class="dfs-rot">${d.foco && d.foco.length
      ? `Sustentação — voto ${d.foco.length === 1 ? 'no item selecionado' : `nos ${d.foco.length} itens selecionados`}`
      : `Sustentação — posição ${cvEsc(DFS_POSICOES[d.posicao])}`}</div>
    ${dfsChipsFoco(d.foco)}
    <textarea id="dfsTexto" class="dfs-edit" rows="${linhas}"
      spellcheck="true">${cvEsc(d.texto)}</textarea>
    <div class="dfs-barra">
      <span class="dfs-estado" id="dfsEstado">${d.editado ? 'revisado pelo analista' : 'como veio do provedor — revise antes de incluir'}</span>
      <button id="dfsRestaurar" class="dfs-bt"${d.editado ? '' : ' disabled'}>restaurar texto gerado</button>
    </div>
    <label class="dfs-incluir${d.incluir ? ' marcado' : ''}" id="dfsIncluirLinha">
      <input type="checkbox" id="dfsIncluir"${d.incluir ? ' checked' : ''}>
      <span><b>Incluir esta sustentação no PDF.</b> <span id="dfsIncluirEstado">${d.incluir
        ? 'Marcado: a seção sai no documento.'
        : 'Desmarcado: o documento sai só com o registro de votos.'}</span></span>
    </label>
    <div class="dfs-nota">Texto argumentativo${d.foco && d.foco.length ? ', sobre o voto nos itens selecionados,' : ''}
      rascunhado por ${cvEsc(d.modelo)} a partir dos documentos e do voto
      registrado${d.foco && d.foco.length ? ' (o sentido de cada voto foi calculado do resultado registrado, não pela IA)' : ''}${d.usouImprensa ? ', e orientado pelos pontos contestados que você marcou na repercussão' : ''},
      para ser revisado. Não é registro de fato: o registro é a tabela acima.${
      // Aviso dirigido, e não genérico: medido contra o provedor, a sustentação
      // gerada a partir da repercussão reaproveita número e valor dos pontos
      // contestados mesmo com o prompt proibindo. A instrução ao modelo reduz,
      // não elimina — quem elimina é o analista, e ele precisa saber ONDE olhar.
      d.usouImprensa
        ? ' <b>Confira os números:</b> a repercussão traz cifras de terceiros, e o texto pode ter reaproveitado'
          + ' alguma. Número que sai numa sustentação assinada deixa de ser erro de jornal e vira erro do deputado.'
        : ''}${
      d.registro && !d.registro.posicao
        ? ' As votações do texto principal foram simbólicas ou sem voto nominal do deputado, então o voto registrado não estabelece a posição — esta sustentação se apoia no argumento.'
        : ''}</div>
  </div>`;
}

/** Os itens de foco como etiquetas: "DTQ 3: … — voto pela rejeição da …". */
function dfsRotuloFoco(f) {
  const obj = String(f.objeto || '').replace(/^Vota[çc][ãa]o d[oa]s?\s+/i, '').slice(0, 90);
  return `${obj} — voto ${f.sentido ? f.sentido.texto : `${String(f.voto || '').toUpperCase()} (sentido não determinado)`}`;
}
function dfsChipsFoco(foco) {
  if (!foco || !foco.length) return '';
  return `<div class="dfs-chips">${foco.map(f => `<span class="dfs-chip">${cvEsc(dfsRotuloFoco(f))}</span>`).join('')}</div>`;
}

/**
 * Liga o campo editável ao estado, depois de cada redesenho. O que o analista
 * escreve passa a ser o texto do documento na hora — sem botão de salvar, que
 * seria mais uma chance de exportar a versão errada.
 */
function dfsLigarEdicao(d, aoMudar) {
  const ta = document.getElementById('dfsTexto');
  if (!ta || !d || !d.ok) return;
  const estado = document.getElementById('dfsEstado');
  const bt = document.getElementById('dfsRestaurar');
  const sincronizar = () => {
    d.texto = ta.value;
    d.editado = ta.value.trim() !== String(d.original || '').trim();
    if (estado) estado.textContent = d.editado
      ? 'revisado pelo analista' : 'como veio do provedor — revise antes de incluir';
    if (bt) bt.disabled = !d.editado;
    if (aoMudar) aoMudar(d);
  };
  ta.addEventListener('input', sincronizar);
  if (bt) bt.addEventListener('click', () => { ta.value = d.original || ''; sincronizar(); });

  const cx = document.getElementById('dfsIncluir');
  if (cx) cx.addEventListener('change', () => {
    d.incluir = !!cx.checked;
    const linha = document.getElementById('dfsIncluirLinha');
    if (linha) linha.classList.toggle('marcado', d.incluir);
    const est = document.getElementById('dfsIncluirEstado');
    if (est) est.textContent = d.incluir
      ? 'Marcado: a seção sai no documento.'
      : 'Desmarcado: o documento sai só com o registro de votos.';
    if (aoMudar) aoMudar(d);
  });
}
