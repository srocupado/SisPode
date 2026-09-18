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
// Depende de aderencia.js (cvEsc), ia-comum.js (chamarIA) e resumos.js.

const DFS_POSICOES = {
  favoravel: 'favorável à matéria',
  contraria: 'contrária à matéria',
};

// O que conta como votação DO TEXTO da matéria — e não de um destaque, de um
// requerimento de adiamento ou de uma emenda avulsa. Só nesses itens o voto
// diz algo sobre a posição do deputado quanto ao projeto em si; num destaque
// para supressão, "Sim" quer dizer suprimir, não ser favorável ao projeto.
const DFS_RE_TEXTO = /reda[çc][ãa]o final|subemenda substitutiva global|substitutivo global|vota[çc][ãa]o do projeto\b|projeto de lei n[º°.]?\s*[\d.]+\s*,?\s*de\s*\d{4}\s*$/i;

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
    if (!DFS_RE_TEXTO.test(alvo)) continue;
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

function dfsPrompt({ posicao, dep, prop, materia, itens, registro, enfase }) {
  const linhas = itens.map(i => `- ${i.objeto}${i.voto ? ` — voto do deputado: ${i.voto}` : ''}${
    i.simples ? `\n  (o que fazia: ${i.simples})` : ''}`).join('\n');

  return `Você escreve a sustentação pública do posicionamento de um parlamentar brasileiro.

QUEM: Dep. ${dep.nome} (${dep.partido}-${dep.uf}).
MATÉRIA: ${prop ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}` : 'a matéria consultada'}.
POSIÇÃO A SUSTENTAR: ${DFS_POSICOES[posicao]}.
${enfase ? `PONTO A ENFATIZAR (pedido do analista): ${enfase}\n` : ''}
DO QUE TRATA A MATÉRIA:
${materia || '(não disponível)'}

O QUE FOI VOTADO, E COMO O DEPUTADO VOTOU:
${linhas || '(nenhum item com voto nominal registrado)'}

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
- Três a cinco parágrafos. Comece pelo argumento central, não por preâmbulo.

Responda SOMENTE com o texto da sustentação, em parágrafos separados por linha
em branco. Sem título, sem marcadores, sem cercas de código.`;
}

/**
 * Gera a sustentação. Devolve { ok, texto, modelo } ou { ok:false, motivo, ... }.
 * Nenhum caminho de falha devolve texto: defesa que não veio precisa aparecer
 * como defesa que não veio.
 */
async function dfsGerar({ posicao, dep, prop, resumos, linhas, objetos, enfase }) {
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

  const materia = resumos && resumos.materia
    ? [resumos.materia.simples, resumos.materia.ementa].filter(Boolean).join(' ')
    : (prop ? String(prop.ementa || '') : '');

  let resposta;
  try {
    resposta = await chamarIA({
      provedorId: cfg.provedor || 'gemini',
      apiKey: cfg.apiKey,
      modelo: cfg.modelo || RSM_MODELO_PADRAO,
      prompt: dfsPrompt({ posicao, dep, prop, materia, itens, registro, enfase }),
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
           modelo: cfg.modelo || RSM_MODELO_PADRAO, registro };
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
    }[d.motivo] || 'A sustentação não foi gerada.';
    return msg ? `<div class="dfs dfs-conflito"><div class="dfs-rot">Sustentação não gerada</div>${msg}</div>` : '';
  }
  // Campo EDITÁVEL, e não texto fixo: quem assina a sustentação é o analista,
  // não o provedor. O que sai no PDF é o que estiver aqui quando ele exportar.
  const linhas = Math.min(28, Math.max(10, d.texto.split('\n').length + Math.ceil(d.texto.length / 90)));
  return `<div class="dfs">
    <div class="dfs-rot">Sustentação — posição ${cvEsc(DFS_POSICOES[d.posicao])}</div>
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
    <div class="dfs-nota">Texto argumentativo, rascunhado por ${cvEsc(d.modelo)} a partir dos documentos e do voto
      registrado, para ser revisado. Não é registro de fato: o registro é a tabela acima.${
      d.registro && !d.registro.posicao
        ? ' As votações do texto principal foram simbólicas ou sem voto nominal do deputado, então o voto registrado não estabelece a posição — esta sustentação se apoia no argumento.'
        : ''}</div>
  </div>`;
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
