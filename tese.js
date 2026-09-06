// Parecer de Especialista — TESE, CONTRADITÓRIO e REDAÇÃO por afirmações.
//
// A lição das três rodadas rejeitadas: "o JS pega número inventado; não pega
// raciocínio inventado". Uma chamada que redige o juízo direto a partir de um
// resumo conclui além da evidência (deu "atingido" com três meses de série) e
// a conferência numérica aprova, porque os números eram verdadeiros.
//
// Aqui o juízo deixa de ser texto e vira DADO:
//   1. catálogo de evidências numeradas (A-n achados, D-n dossiê, LV-n lei,
//      F1 ficha), cada uma com texto, números e nível;
//   2. TESE: o modelo devolve JSON com afirmações {id, seção, tipo, texto,
//      evidências}; o JS remove a afirmação que cita evidência inexistente,
//      que traz número fora das evidências citadas, ou cujo veredito excede o
//      nível de evidência;
//   3. CONTRADITÓRIO: segunda chamada tenta refutar cada afirmação; fato ou
//      cálculo refutado sai, juízo refutado vira "não verificável";
//   4. REDAÇÃO: o texto só pode usar o que sobreviveu, com o identificador
//      entre colchetes; parágrafo de juízo sem identificador reprova.
//
// Script clássico (global na extensão) + module.exports para os testes.

const __dossie = (typeof module !== 'undefined' && typeof require === 'function') ? require('./dossie.js') : null;
const _numerosDoTexto = __dossie ? __dossie.numerosDoTexto : (typeof numerosDoTexto === 'function' ? numerosDoTexto : null);
const _itensDoDossie = __dossie ? __dossie.itensDoDossie : (typeof itensDoDossie === 'function' ? itensDoDossie : null);
const __ficha = (typeof module !== 'undefined' && typeof require === 'function') ? require('./ficha.js') : null;
const _fichaParaTexto = __ficha ? __ficha.fichaParaTexto : (typeof fichaParaTexto === 'function' ? fichaParaTexto : null);

const SECOES_TESE = ['sintese', 'contexto', 'lei', 'previu', 'aconteceu', 'comparada', 'avaliacao', 'lados', 'opcoes'];
const TITULOS = { sintese: 'Síntese', contexto: 'Contexto e processo', lei: 'Lei vigente e datas de efeito', previu: 'O que se previu', aconteceu: 'O que aconteceu', comparada: 'Experiência de outros países e entes', avaliacao: 'Avaliação da política', lados: 'Os dois lados', opcoes: 'Opções e consequências', lentes: 'Respostas por lente' };
const ORDEM_NIVEL = { A: 3, B: 2, C: 1 };
const VEREDITOS = {
  A: ['atingido', 'não atingido', 'não verificável'],
  B: ['indícios de atingimento', 'indícios de não atingimento', 'não verificável'],
  C: ['não verificável'],
  // Proposição ainda não em vigor: não há "realizado"; o que se julga é se o
  // TEXTO prevê meios para o objetivo declarado.
  PROJETO: ['o texto prevê meios', 'o texto prevê meios em parte', 'o texto não prevê meios', 'não verificável'],
};

// Inteiros pequenos (artigo, inciso, contagem) e anos não são cifra.
const numeroRelevante = v => !(Number.isInteger(v) && (v <= 31 || (v >= 1900 && v <= 2100)));
const numsRelevantes = s => (_numerosDoTexto(s) || []).filter(numeroRelevante);
// Nem número de norma ou de artigo: "art. 62 da CF" numa opção foi removido
// como "número fora das evidências" na rodada real. A pista é a palavra anterior.
const REF_ANTES = /\b(lei|leis|decreto|decreto-lei|LC|EC|ADCT|s[úu]mula|vinculante|tema|ADI|ADC|ADPF|ADO|RE|ARE|AI|HC|MS|MI|REsp|resolu[çc][ãa]o|portaria|instru[çc][ãa]o normativa|IN|medida provis[óo]ria|MP|MPV|PL|PLP|PEC|PLN|PLV|PDL|PRLP|PRLE|EMP|EMS|EMC|SBT-?A?|SSP|conven[çc][ãa]o|recomenda[çc][ãa]o|emenda|subemenda|substitutivo|parecer|item|art|artigo|arts|inciso|par[áa]grafo|al[íi]nea|n[.º°]?|§)\s*(n?[.º°]?\s*)?$/i;
/** Trecho em volta do número, para o motivo da remoção dizer ONDE ele estava. */
function contextoDoNumero(texto, n) {
  const t = String(texto || ''); const re = /\d[\d.]*(?:,\d+)?/g; let m;
  while ((m = re.exec(t)) !== null) { if (Math.abs(Number(m[0].replace(/\./g, '').replace(',', '.'))) === n) return t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 25).replace(/\s+/g, ' ').trim(); }
  return '';
}
function numerosCifra(texto) {
  const t = String(texto || ''); const out = []; const re = /\d[\d.]*(?:,\d+)?/g; let m;
  while ((m = re.exec(t)) !== null) {
    const v = Number(m[0].replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(v) || !numeroRelevante(v)) continue;
    if (REF_ANTES.test(t.slice(Math.max(0, m.index - 34), m.index))) continue;
    out.push(Math.abs(v));
  }
  return out;
}

// ============================================================
//  CATÁLOGO DE EVIDÊNCIAS
// ============================================================

function catalogoDeEvidencias({ achados = [], dossie = null, ficha = null, situacao = null, processo = null, comparada = [] } = {}) {
  const itens = [];
  // A situação da tramitação vem do sistema (API da Câmara), não do documento;
  // sem entrar no catálogo, o contraditório refutava a data de perda de
  // vigência "por falta de evidência".
  const sis = (id, texto) => itens.push({ id, tipo: 'situacao', texto, numeros: _numerosDoTexto(texto), nivel: 'A', fonte: 'sistema / módulo de Plenário' });
  if (situacao) sis('S1', `Situação da tramitação (informada pelo sistema): ${situacao}`);
  // O que o módulo de Plenário sabe: cenário, relator, documentos, emendas, comissões.
  if (processo) {
    if (processo.cenario) sis('S2', `Cenário de tramitação (sistema): ${processo.cenario}.${processo.textoEmVotacao ? ` Texto em votação: ${processo.textoEmVotacao}.` : ''}`);
    if (processo.relator?.nome) sis('S3', `Relator(a) (sistema): ${processo.relator.nome}${processo.relator.partido ? ` (${processo.relator.partido}${processo.relator.uf ? '-' + processo.relator.uf : ''})` : ''}${processo.relator.data ? `, designado(a) em ${processo.relator.data}` : ''}.`);
    if (processo.documentos?.length) sis('S4', `Documentos anexados ao parecer (sistema): ${processo.documentos.map((d, i) => `${i + 1}. ${d.rotulo}`).join('; ')}.`);
    if (processo.emendas?.length) sis('S5', `Emendas e substitutivos apresentados à matéria (sistema): ${processo.emendas.map(e => e.rotulo).join('; ')}.`);
    if (processo.comissoes?.length) sis('S6', `Pareceres de comissões (sistema): ${processo.comissoes.map(c => `${c.comissao}${c.dataBR ? ` (${c.dataBR})` : ''}${c.relator ? `, relator(a) ${c.relator}` : ''}${c.posicao ? `: ${c.posicao}` : ''}`).join('; ')}.`);
    if (processo.apensados?.length) sis('S7', `Apensados de autoria do Podemos (sistema): ${processo.apensados.join('; ')}.`);
  }
  achados.forEach((a, i) => {
    const texto = `[lente ${a.lente} · ${a.pergunta}] ${a.achado}${a.dispositivo ? ` (${a.dispositivo})` : ''}${a.trecho ? ` — trecho: "${String(a.trecho).slice(0, 400)}"` : ''}`;
    itens.push({ id: `A${i + 1}`, tipo: 'achado', texto, numeros: _numerosDoTexto(texto), nivel: 'A', fonte: 'documento analisado', lente: String(a.lente), pergunta: a.pergunta });
  });
  if (dossie && _itensDoDossie) for (const it of _itensDoDossie(dossie)) itens.push(it);
  // Experiência comparada: o modelo buscou na web; a fonte fica nomeada e o
  // programa NÃO a conferiu. Só entra com fonte (nome e endereço).
  (comparada || []).forEach((c, i) => {
    const texto = `Experiência comparada (busca na web feita pelo modelo; fonte não conferida pelo programa): ${c.lugar}${c.quando ? `, ${c.quando}` : ''} — ${c.medida}. O que se mediu: ${c.o_que_se_mediu || 'não informado'}. Resultado: ${c.resultado}. Fonte: ${c.fonte_nome} (${c.fonte_url}).`;
    itens.push({ id: `W${i + 1}`, tipo: 'externa', texto, numeros: _numerosDoTexto(texto), nivel: 'externa', fonte: `${c.fonte_nome} — ${c.fonte_url}`, url: c.fonte_url });
  });
  if (ficha) {
    const texto = _fichaParaTexto ? _fichaParaTexto(ficha) : JSON.stringify(ficha);
    itens.push({ id: 'F1', tipo: 'ficha', texto, numeros: _numerosDoTexto(texto), nivel: 'A', fonte: 'ficha do objeto' });
  }
  const porId = new Map(itens.map(i => [i.id, i]));
  const textoCatalogo = itens.filter(i => !i.fonteApenas).map(i => `${i.id} [${i.tipo}${i.nivel ? ' · nível ' + i.nivel : ''}] ${i.texto}`).join('\n');
  return { itens, porId, texto: textoCatalogo };
}

// ============================================================
//  PASSAGEM 2 — TESE
// ============================================================

function promptTese({ identificacao, textoAnalisado, situacao, ficha, catalogo, nivel, lentes = [], objetivos = [], emVigor = true, temComparada = false }) {
  return `Você é o especialista que formula a TESE de um parecer da Liderança do Podemos na Câmara dos Deputados sobre
${identificacao} (texto analisado: ${textoAnalisado}). O parecer vai formar o convencimento de um deputado que pode não
conhecer o tema. Nesta etapa você NÃO redige: você lista AFIRMAÇÕES, cada uma apoiada em evidências do catálogo abaixo.
${situacao ? `\nSITUAÇÃO DA TRAMITAÇÃO: ${situacao}\n` : ''}
${_fichaParaTexto ? _fichaParaTexto(ficha) : ''}

NÍVEL DE EVIDÊNCIA DO PREVISTO × REALIZADO: ${nivel} (A = estimativa ou série oficial com 12 meses antes e depois do marco;
B = janela curta ou mês parcial; C = sem série comparável).

OBJETIVOS DECLARADOS DA PROPOSIÇÃO (apurados no documento):
${objetivos.map(o => `  · ${o.achado}${o.trecho ? ` — "${String(o.trecho).slice(0, 200)}"` : ''}`).join('\n') || '  · nenhum localizado'}

CATÁLOGO DE EVIDÊNCIAS (só isto existe; cite pelos identificadores):
${catalogo.texto}

Responda SOMENTE com JSON neste formato:
{
  "afirmacoes": [
    { "id": "T1", "secao": "sintese", "tipo": "fato|calculo|juizo", "texto": "uma a três frases, com cifras em algarismos",
      "evidencias": ["A3", "D2"] }
  ],
  "objetivos": [
    { "id": "O1", "objetivo": "o objetivo declarado", "veredito": "um dos vereditos permitidos", "justificativa": "uma a duas frases", "evidencias": ["D5"] }
  ],
  "lados": {
    "apoia": { "id": "L1", "argumento": "o melhor argumento de quem apoia", "o_que_a_evidencia_diz": "…", "evidencias": ["D4"] },
    "opoe":  { "id": "L2", "argumento": "o melhor argumento de quem se opõe", "o_que_a_evidencia_diz": "…", "evidencias": ["D6"] }
  },
  "opcoes": [
    { "id": "P1", "opcao": "aprovar / alterar / rejeitar / condicionar — o que exatamente", "fiscal": "…", "juridica": "…", "politica": "…", "evidencias": ["F1", "D7"] }
  ],
  "fatores_concorrentes": [ { "fator": "câmbio, outra norma, sazonalidade…", "evidencias": ["D9"] } ]
}

SEÇÕES (campo "secao"): ${SECOES_TESE.join(', ')} — e "lente:N" para respostas técnicas de cada lente acionada
(lentes: ${lentes.map(l => `${l.ordem} ${l.rotulo}`).join('; ') || 'nenhuma'}).

REGRAS QUE O PROGRAMA VAI CONFERIR (o que violar é removido):
- Toda afirmação cita ao menos uma evidência que EXISTE no catálogo. "fato" cita A, LV, F, S ou item documental do dossiê;
  "calculo" cita D; "juizo" cita qualquer uma, mas sempre alguma.
- LV marcado "TEXTO ORIGINAL, NÃO COMPILADO" não é regra vigente: dispositivos dele podem estar revogados. A regra vigente é
  a da ficha (F1).
- Não repita a mesma afirmação em duas unidades; uma unidade por ideia.
- Todo número da afirmação consta das evidências citadas. Não some, não derive, não arredonde de forma diferente.
- Na seção "sintese", a primeira afirmação enuncia a regra que muda em algarismos: de quanto para quanto, sobre o quê, a
  partir de quando (use F1 e LV).
${emVigor ? `- Vereditos dos objetivos, pelo nível de evidência das evidências citadas: nível A permite ${VEREDITOS.A.join(', ')};
  nível B permite ${VEREDITOS.B.join(', ')}; nível C permite só "não verificável". Sem série, o veredito é "não verificável".`
: `- A PROPOSIÇÃO AINDA NÃO ESTÁ EM VIGOR: não existe "realizado" a comparar, e "não verificável" NÃO é resposta para
  objetivo que o próprio texto realiza. Para cada objetivo declarado, o veredito é um destes, literalmente:
  ${VEREDITOS.PROJETO.slice(0, 3).map(v => `"${v}"`).join(', ')} — e a "justificativa" aponta os dispositivos (achados "altera",
  "regra_depois", A) que o realizam ou a lacuna. Objetivo do tipo "regulamentar / instituir / criar X" É o objeto da
  proposição: diga o que o texto regula e com quais dispositivos ("o texto prevê meios"). Efeito futuro (preço, arrecadação,
  adesão, conflitos) só poderá ser medido depois da vigência: diga isso em uma frase da justificativa, sem veredito de resultado.`}
${temComparada ? `- EXPERIÊNCIA COMPARADA (W): uma afirmação por experiência, na seção "comparada", com o lugar, o que se fez, o que se
  mediu e o resultado, citando o W. Ela NÃO prova que "funcionará aqui": diga o que é e o que não é comparável. Fato que cite
  só W fica restrito à seção "comparada".` : ''}
- Estimativa marcada "NÃO vinculada ao objeto" nunca é "o previsto" desta medida; ela só pode aparecer como contexto, nomeada.
- Nada de atribuição causal ("a medida provocou"): a série mostra; o parecer compara.
- Nada de recomendação de voto: as opções têm consequências, a decisão é da Liderança.
- OPÇÕES (P): a consequência FISCAL descreve o que a série mostra, com a janela e o nível, sem extrapolar ("mantém o cenário
  observado na série: II devido de X para Y por mês, nível B"); a consequência JURÍDICA decorre da ficha, dos achados sobre o
  regime da MP (art. 62 da CF: perda de eficácia, decreto legislativo) ou da lei citada — cite-os; a consequência POLÍTICA é
  juízo da assessoria, declarado como tal. Opção sem evidência para o fiscal e o jurídico é removida.
- LADOS (L): "argumento" é a posição do lado e pode ser causal ("a medida aumentou…"); "o_que_a_evidencia_diz" é do parecer
  e NÃO pode ser causal: só o que a série ou o documento mostram.
- EXTENSÃO: o parecer tem de ser DETALHADO. Entre 20 e 45 afirmações, cada uma de uma a quatro frases; 3 a 4 opções.
  Mínimos por seção, quando as evidências permitirem: sintese 4; contexto: o cenário e o texto em votação (S2), o(a)
  relator(a) NOMEADO(A) e o que propôs (S3 e achados "documento"), UMA afirmação por documento anexado (achados "documento"),
  UMA por emenda ou substitutivo — autor, teor e destino (achados "emenda" e S5), as comissões (S6), com datas; lei: 2 e
  UMA afirmação por dispositivo alterado (achados "altera": o que vale hoje e o que muda); previu 2; aconteceu 5 (um por indicador, com o número); avaliacao: todos os objetivos declarados;
  lados: argumento e "o que a evidência diz" com duas a quatro frases cada; cada lente acionada 3. O mínimo NÃO autoriza
  inventar: sem evidência para uma afirmação, ela não existe e o mínimo não vale.`;
}

/** Valida a tese contra o catálogo. Remove o que não se sustenta e rebaixa vereditos. */
function validarTese(tese, catalogo, { nivel = 'C', emVigor = true } = {}) {
  const removidas = [], rebaixadas = [];
  const existe = id => catalogo.porId.has(String(id));
  const numsDe = ids => { const s = new Set(); for (const id of ids) for (const n of (catalogo.porId.get(id)?.numeros || [])) s.add(n); return s; };
  const tipoDe = ids => ids.map(id => catalogo.porId.get(id)?.tipo);
  const nivelDe = ids => { const ns = ids.map(id => catalogo.porId.get(id)).filter(Boolean).filter(e => e.tipo === 'dossie' && !e.aviso && !e.fonteApenas).map(e => e.nivel).filter(Boolean); return ns.length ? ns.sort((a, b) => ORDEM_NIVEL[b] - ORDEM_NIVEL[a])[0] : 'C'; };
  const fichaNums = new Set(catalogo.porId.get('F1')?.numeros || []);

  const conferir = (obj, texto, rotulo) => {
    const ids = (obj.evidencias || []).map(String).filter(existe);
    const ausentes = (obj.evidencias || []).map(String).filter(id => !existe(id));
    if (!ids.length) return `sem evidência existente${ausentes.length ? ` (citou ${ausentes.join(', ')})` : ''}`;
    obj.evidencias = ids;
    const permitidos = numsDe(ids);
    for (const n of fichaNums) permitidos.add(n);
    let fora = numerosCifra(texto).filter(n => !permitidos.has(n));
    // Número que existe em OUTRO item do catálogo é subcitação, não invenção:
    // o programa acrescenta a evidência (e registra) em vez de remover a
    // unidade. Na rodada real, o objetivo caiu por citar a linha de remessas
    // sem citar a linha de variação, onde os 65,3% estavam.
    if (fora.length) {
      const acrescidas = [];
      for (const n of fora) { const item = catalogo.itens.find(i => !i.aviso && !i.fonteApenas && (i.numeros || []).includes(n)); if (item && !ids.includes(item.id)) { ids.push(item.id); acrescidas.push(item.id); } }
      if (acrescidas.length) { obj.evidencias = ids; obj.evidenciasAcrescidas = acrescidas; for (const id of acrescidas) for (const n of (catalogo.porId.get(id)?.numeros || [])) permitidos.add(n); }
      fora = fora.filter(n => !permitidos.has(n));
    }
    if (fora.length) return `número fora das evidências citadas: ${fora.map(n => `${n} («${contextoDoNumero(texto, n)}»)`).join(', ')}`;
    return null;
  };

  const afirmacoes = [];
  (tese.afirmacoes || []).forEach((a, i) => {
    a.id = a.id || `T${i + 1}`;
    a.tipo = ['fato', 'calculo', 'juizo'].includes(a.tipo) ? a.tipo : 'juizo';
    a.secao = String(a.secao || 'sintese');
    const erro = conferir(a, a.texto, a.id);
    if (erro) { removidas.push({ id: a.id, secao: a.secao, motivo: erro, texto: a.texto }); return; }
    const tipos = tipoDe(a.evidencias);
    // Fato precisa de evidência documental: achado, lei, ficha ou item do
    // dossiê que não seja aviso (estimativa no processo, marco, negação).
    if (a.tipo === 'fato' && !a.evidencias.some(id => { const e = catalogo.porId.get(id); return e && !e.aviso && !e.fonteApenas; })) { removidas.push({ id: a.id, secao: a.secao, motivo: 'fato sem evidência documental', texto: a.texto }); return; }
    // Experiência externa (W) só sustenta afirmação na seção própria: fora dela, não é evidência do caso.
    if (a.secao !== 'comparada' && a.evidencias.length && a.evidencias.every(id => catalogo.porId.get(id)?.tipo === 'externa')) { removidas.push({ id: a.id, secao: a.secao, motivo: 'apoiada só em experiência externa (W), fora da seção "Experiência de outros países e entes"', texto: a.texto }); return; }
    if (a.tipo === 'calculo' && !tipos.includes('dossie')) { removidas.push({ id: a.id, secao: a.secao, motivo: 'cálculo sem item do dossiê como evidência', texto: a.texto }); return; }
    // Atribuição causal POSITIVA. "O efeito da medida não é verificável" é o
    // contrário disso e não pode cair na mesma malha.
    if (/\b(a (lei|medida|norma|MP|MPV) (provocou|causou|gerou|levou a|reduziu|aumentou|elevou|derrubou)|resultou em|em decorr[êe]ncia da (lei|medida)|gra[çc]as [àa] (lei|medida)|por causa da (lei|medida)|(?<!data de )(efeito|impacto) da (lei|medida) (foi|é) (de |o |a |uma |um )?(aument|redu|qued|alta|elev|cresc|fort|expressiv|negativ|positiv))/i.test(a.texto)) { removidas.push({ id: a.id, secao: a.secao, motivo: 'atribuição causal', texto: a.texto }); return; }
    afirmacoes.push(a);
  });

  const objetivos = [];
  (tese.objetivos || []).forEach((o, i) => {
    o.id = o.id || `O${i + 1}`;
    const erro = conferir(o, `${o.objetivo} ${o.justificativa || ''}`, o.id);
    if (erro) { removidas.push({ id: o.id, secao: 'avaliacao', motivo: erro, texto: o.objetivo }); return; }
    const nv = nivelDe(o.evidencias);
    const ver = String(o.veredito || '').toLowerCase().trim();
    const permitidos = emVigor ? (VEREDITOS[nv] || VEREDITOS.C) : VEREDITOS.PROJETO;
    if (!permitidos.includes(ver)) {
      const novo = !emVigor ? (/prev[êe] meios em parte|parcial/.test(ver) ? 'o texto prevê meios em parte' : /n[ãa]o prev[êe]|sem meios/.test(ver) ? 'o texto não prevê meios' : /prev[êe] meios|atingido|regulament|institui/.test(ver) ? 'o texto prevê meios' : 'não verificável')
        : nv === 'B' && /^n[ãa]o atingido/.test(ver) ? 'indícios de não atingimento' : nv === 'B' && /^atingido/.test(ver) ? 'indícios de atingimento' : 'não verificável';
      rebaixadas.push({ id: o.id, de: o.veredito, para: novo, motivo: `veredito "${o.veredito}" não permitido com evidência de nível ${nv}` });
      o.veredito = novo;
    }
    o.nivel = nv;
    objetivos.push(o);
  });

  const lados = {};
  for (const k of ['apoia', 'opoe']) {
    const l = tese.lados?.[k];
    if (!l) continue;
    l.id = l.id || (k === 'apoia' ? 'L1' : 'L2');
    const erro = conferir(l, `${l.argumento} ${l.o_que_a_evidencia_diz || ''}`, l.id);
    if (erro) { removidas.push({ id: l.id, secao: 'lados', motivo: erro, texto: l.argumento }); continue; }
    lados[k] = l;
  }

  const opcoes = [];
  (tese.opcoes || []).forEach((p, i) => {
    p.id = p.id || `P${i + 1}`;
    if (!p.opcao || !(p.fiscal || p.juridica || p.politica)) { removidas.push({ id: p.id, secao: 'opcoes', motivo: 'opção sem consequência', texto: p.opcao }); return; }
    const erro = conferir(p, `${p.opcao} ${p.fiscal || ''} ${p.juridica || ''} ${p.politica || ''}`, p.id);
    if (erro) { removidas.push({ id: p.id, secao: 'opcoes', motivo: erro, texto: p.opcao }); return; }
    if (/\b(recomend|deve votar|orienta(?:mos|-se)? (?:pel|a favor|contra)|voto pel)/i.test(`${p.opcao} ${p.politica}`)) { removidas.push({ id: p.id, secao: 'opcoes', motivo: 'recomendação de voto', texto: p.opcao }); return; }
    opcoes.push(p);
  });

  const fatores = (tese.fatores_concorrentes || []).filter(f => f && f.fator && (f.evidencias || []).some(existe)).map(f => ({ ...f, evidencias: f.evidencias.filter(existe) }));

  const limpa = { afirmacoes, objetivos, lados, opcoes, fatores_concorrentes: fatores };
  return { tese: limpa, removidas, rebaixadas, resumo: `${afirmacoes.length} afirmações, ${objetivos.length} objetivos, ${opcoes.length} opções; ${removidas.length} removida(s), ${rebaixadas.length} veredito(s) rebaixado(s)` };
}

/** Todas as unidades da tese com identificador, para o contraditório e a redação. */
function unidadesDaTese(t) {
  const u = [];
  for (const a of t.afirmacoes || []) u.push({ id: a.id, tipo: a.tipo, secao: a.secao, texto: a.texto, evidencias: a.evidencias });
  for (const o of t.objetivos || []) u.push({ id: o.id, tipo: 'juizo', secao: 'avaliacao', texto: `Objetivo: ${o.objetivo} — veredito: ${o.veredito}. ${o.justificativa || ''}`, evidencias: o.evidencias });
  for (const k of ['apoia', 'opoe']) { const l = t.lados?.[k]; if (l) u.push({ id: l.id, tipo: 'juizo', secao: 'lados', texto: `${k === 'apoia' ? 'Quem apoia' : 'Quem se opõe'}: ${l.argumento} — o que a evidência diz: ${l.o_que_a_evidencia_diz || ''}`, evidencias: l.evidencias }); }
  for (const p of t.opcoes || []) u.push({ id: p.id, tipo: 'juizo', secao: 'opcoes', texto: `Opção: ${p.opcao}. Fiscal: ${p.fiscal || '—'}. Jurídica: ${p.juridica || '—'}. Política: ${p.politica || '—'}`, evidencias: p.evidencias });
  return u;
}

function textoDaTese(t) {
  return unidadesDaTese(t).map(u => `${u.id} [${u.tipo} · ${u.secao}] ${u.texto} {evidências: ${(u.evidencias || []).join(', ')}}`).join('\n');
}

// ============================================================
//  PASSAGEM 3 — CONTRADITÓRIO
// ============================================================

function promptContraditorio({ identificacao, tese, catalogo, nivel }) {
  return `Você é o revisor ADVERSARIAL de um parecer sobre ${identificacao}. Sua única função é tentar REFUTAR cada unidade
da tese abaixo usando apenas o catálogo de evidências. Refute quando: (a) a evidência citada não sustenta o que se afirma;
(b) a conclusão excede o nível de evidência (nível ${nivel}; janela curta, mês parcial, série que termina antes do marco);
(c) há evidência contrária no catálogo; (d) há atribuição causal disfarçada; (e) um número é lido errado (ex.: aumento de
volume de remessas descrito como "formalização"; estimativa de outra parte do processo tratada como previsão desta medida);
(f) a opção ou o lado descreve consequência FISCAL ou JURÍDICA que nenhuma evidência mostra.
O QUE NÃO SE REFUTA: (1) unidade do tipo "calculo" que apenas REPORTA a série ("caiu de X para Y") — reportar não excede o
nível; o que excede é CONCLUIR a partir dela ("funcionou", "formalizou", "o efeito foi"). NÃO refute por a unidade não
repetir a limitação da série (nível, janela curta, mês parcial): a limitação é declarada uma vez na seção e vale para todas
as unidades; omissão de ressalva NÃO é motivo de refutação; (2) a consequência POLÍTICA de uma opção, que é juízo da assessoria — refute-a só se contradisser evidência;
(3) fato apoiado em S1 (situação da tramitação informada pelo sistema) ou em F1 (ficha do objeto); (4) em L1/L2, o
"argumento" é a posição do lado e PODE ser causal — julgue só "o que a evidência diz"; (5) em P, a consequência jurídica
que decorre do regime constitucional da MP (art. 62 da CF: perda de eficácia, decreto legislativo) ou de achado citado, e a
consequência fiscal que reporta a série com o nível declarado, não se refutam por "falta de evidência"; refute P só se a
consequência fiscal contradiz a série ou inventa número.
Fato bem citado NÃO se refuta por desconforto: refutação exige motivo concreto ligado a uma evidência. Em dúvida sobre um
JUÍZO, refute; em dúvida sobre um FATO ou um CÁLCULO, mantenha.

TESE:
${textoDaTese(tese)}

CATÁLOGO DE EVIDÊNCIAS:
${catalogo.texto}

Responda SOMENTE com JSON: [ { "id": "T3", "refutada": true, "motivo": "uma ou duas frases", "evidencias_contrarias": ["D4"] } ]
Inclua TODAS as unidades (T, O, L, P), refutadas ou não. O "motivo" será IMPRESSO no parecer para um leitor leigo: escreva-o
em palavras comuns ("os dados cobrem só 3 meses depois da mudança, e maio é parcial"), sem "nível de evidência" nem jargão.`;
}

// Motivo que aponta erro CONCRETO num fato ou cálculo (número, conceito,
// inexistência) — diferente de "não repetiu a ressalva", que não derruba nada.
const RE_ERRO_CONCRETO = /confund|errad|incorret|inexist|n[ãa]o consta|n[ãa]o existe|invent|n[ãa]o (é|era|está) (o|a) (que|mesmo)|troca|diverg|contradi[çz]|l[êe] (errado|indevidamente)|leitura errada|n[ãa]o sustenta|n[ãa]o mostra|n[ãa]o cita|outra parte|refere-se a|diz respeito a|trata de outr|n[ãa]o (é|trata) dest/i;

/**
 * Aplica os vereditos do contraditório. Juízo refutado vira "não verificável"
 * ou sai. Fato ou cálculo refutado só sai se o motivo apontar erro concreto ou
 * citar evidência contrária existente; refutação por "não declarou a
 * limitação da série" vira ressalva impressa — a limitação é dita uma vez na
 * seção e vale para todas (na rodada real, seis linhas de dados caíram por isso).
 */
function aplicarContraditorio(t, vereditos = [], catalogo = null) {
  const v = new Map((Array.isArray(vereditos) ? vereditos : []).filter(x => x && x.id).map(x => [String(x.id), x]));
  const refutadas = [], contestadas = [], ressalvas = [];
  const ref = id => { const x = v.get(id); return x && x.refutada === true ? x : null; };
  const temContraria = r => (r.evidencias_contrarias || []).some(id => catalogo ? catalogo.porId.has(String(id)) : true) && (r.evidencias_contrarias || []).length > 0;
  const afirmacoes = [];
  for (const a of t.afirmacoes || []) {
    const r = ref(a.id);
    if (!r) { afirmacoes.push(a); continue; }
    if (a.tipo === 'juizo') { contestadas.push({ id: a.id, motivo: r.motivo, texto: a.texto }); continue; }
    if (RE_ERRO_CONCRETO.test(r.motivo || '') || temContraria(r)) refutadas.push({ id: a.id, tipo: a.tipo, motivo: r.motivo, texto: a.texto });
    else { ressalvas.push({ id: a.id, motivo: r.motivo }); afirmacoes.push(a); }
  }
  const objetivos = [];
  for (const o of t.objetivos || []) {
    const r = ref(o.id);
    if (r) { contestadas.push({ id: o.id, motivo: r.motivo, texto: o.objetivo }); o.veredito = 'não verificável'; o.justificativa = `Contestado no contraditório: ${r.motivo}`; o.contestado = true; }
    objetivos.push(o);
  }
  const lados = {};
  for (const k of ['apoia', 'opoe']) { const l = t.lados?.[k]; if (!l) continue; const r = ref(l.id); if (r) { contestadas.push({ id: l.id, motivo: r.motivo, texto: l.argumento }); l.contestado = r.motivo; } lados[k] = l; }
  const opcoes = [];
  for (const p of t.opcoes || []) { const r = ref(p.id); if (r) { refutadas.push({ id: p.id, tipo: 'opcao', motivo: r.motivo, texto: p.opcao }); continue; } opcoes.push(p); }
  return { tese: { afirmacoes, objetivos, lados, opcoes, fatores_concorrentes: t.fatores_concorrentes || [] }, refutadas, contestadas, ressalvas,
    resumo: `${refutadas.length} unidade(s) refutada(s) e removida(s); ${contestadas.length} juízo(s) contestado(s) e rebaixado(s)${ressalvas.length ? `; ${ressalvas.length} ressalva(s) mantida(s) com o dado` : ''}` };
}

// ============================================================
//  PASSAGEM 4 — REDAÇÃO
// ============================================================

function promptRedacao({ identificacao, textoAnalisado, situacao, ficha, tese, catalogo, lentes = [], catalogoLentes = [], nivel, temSerie, correcoes = null, emVigor = true, temComparada = false }) {
  const lentesTxt = lentes.map(l => { const e = catalogoLentes.find(x => x.chave === l.chave); return e ? `  ${e.ordem}. ${e.rotulo}` : ''; }).filter(Boolean).join('\n');
  const secoes = Object.entries(TITULOS).filter(([k]) => (k !== 'aconteceu' || temSerie) && (k !== 'comparada' || temComparada)).map(([, v]) => `  ${v}`).join('\n');
  const fraseNivel = nivel === 'A' ? 'há dados oficiais com pelo menos 12 meses antes e 12 meses depois da mudança: a comparação é sólida, embora não prove causa'
    : nivel === 'B' ? 'há dados oficiais, mas com poucos meses depois da mudança ou um mês incompleto: os números indicam uma direção, mas não permitem concluir'
    : emVigor ? 'não há dados oficiais que permitam comparar o antes e o depois da mudança: o efeito não é verificável com o que existe'
    : 'como a proposição ainda não está em vigor, não há resultados a comparar: o parecer descreve o que o texto prevê e o que só poderá ser medido depois';
  const achadosLentes = catalogo.itens.filter(i => i.tipo === 'achado' && i.lente !== 'X').map(i => `  ${i.id} ${i.texto.slice(0, 500)}`).join('\n');
  const semQuestao = catalogo.semQuestao || '';
  return `Você redige o CORPO de um PARECER DE ESPECIALISTA da Liderança do Podemos na Câmara dos Deputados sobre
${identificacao}. Texto analisado: ${textoAnalisado} — nomeie-o na primeira frase. O leitor é o deputado e sua assessoria;
o documento tem de formar convencimento de quem não conhece o tema.
${situacao ? `\nSITUAÇÃO DA TRAMITAÇÃO (use no Contexto): ${situacao}\n` : ''}
${correcoes ? `\nESTA É UMA SEGUNDA REDAÇÃO. A primeira foi reprovada pelos motivos abaixo; corrija TODOS:\n${correcoes}\n` : ''}
${_fichaParaTexto ? _fichaParaTexto(ficha) : ''}
A ficha acima será impressa pelo programa na primeira página; mesmo assim, a Síntese TEM de enunciar em algarismos a regra
que muda: de quanto para quanto, sobre o quê, a partir de quando.

SEÇÕES, nesta ordem, cada uma iniciada por UMA LINHA contendo apenas o título, sem negrito, cerquilha ou numeração:
${secoes}
Dentro de "Respostas por lente", uma subseção por lente, cada uma iniciada por uma linha só com o rótulo:
${lentesTxt || '  (nenhuma)'}

TESE APROVADA (é TUDO o que o parecer pode afirmar; cada unidade tem um identificador):
${textoDaTese(tese)}

ACHADOS DAS LENTES (para "Respostas por lente"; cite pelo identificador):
${achadosLentes || '  (nenhum)'}
${semQuestao ? `\nLINHAS SEM QUESTÃO (reúna numa frase por lente, resumindo o assunto em duas a cinco palavras A PARTIR do enunciado):\n${semQuestao}` : ''}

COMO ESCREVER
- Cada frase que afirme algo termina com o identificador da unidade da tese ou do achado entre colchetes: "... caiu 33,5%
  [T7]." Uma frase pode citar mais de um: [T2][D5]. Parágrafo de Síntese, Avaliação, Os dois lados ou Opções sem
  identificador é reprovado.
- Seção para a qual a tese não tem NENHUMA unidade (por exemplo, opções todas refutadas): escreva só a frase "Nenhuma
  unidade da tese sobreviveu à conferência nesta seção." — nada mais, nada inventado.
- Não repita em "Respostas por lente" o que já foi dito nas seções anteriores com outro identificador; cada ideia uma vez.
- Números SÓ os da tese, da ficha e dos achados; cifras em algarismos (R$ 3,50 bilhões; 20%), nunca por extenso.
- EXTENSÃO: documento DETALHADO, entre 2.500 e 4.500 palavras. Cada afirmação da tese vira um parágrafo desenvolvido:
  o fato ou o número, o que ele significa para o leitor e a que se liga. Não resuma a tese; desdobre-a.
- Síntese: quatro a seis parágrafos, cada um começando pela conclusão e desenvolvendo-a; o primeiro enuncia a regra que
  muda em algarismos.
- Contexto e processo: a história em ordem, quatro a oito parágrafos: primeiro o cenário (o que se vota e por quê);
  depois o(a) relator(a) pelo NOME e o que propôs; depois cada substitutivo, subemenda e emenda (autor, teor, destino dado
  pelo relator), um parágrafo por documento; depois as comissões e datas. Nomes, números e datas como estão na tese.
- Lei vigente e datas de efeito: além da regra da ficha, um parágrafo por dispositivo alterado (o que vale hoje, o que
  passa a valer), quando a tese o traz.
- O que aconteceu: um parágrafo por indicador, com o número e o que ele significa; depois os fatores concorrentes.
- Os dois lados: dois parágrafos por lado (o argumento no seu melhor; o que a evidência diz sobre ele).
- Opções: um parágrafo por opção, com as três consequências desenvolvidas.
- Respostas por lente: dois a quatro parágrafos por lente, prosa técnica com o dispositivo citado.
- SOLIDEZ DA COMPARAÇÃO, EM PALAVRAS: o leitor é deputado ou analista; NUNCA escreva "nível de evidência", "nível A/B/C"
  nem "evidência de nível". Diga, UMA vez, na abertura de "${temSerie ? 'O que aconteceu' : 'Avaliação da política'}", esta ideia com
  estas palavras: "${fraseNivel}". Nas demais seções, quando precisar, diga "a comparação é ${nivel === 'A' ? 'sólida' : nivel === 'B' ? 'indicativa, não conclusiva' : 'impossível com o que existe'}".
- O que aconteceu (quando existir): os números, o tamanho da janela e o mês parcial quando houver. Sem atribuir causa; liste
  os fatores concorrentes.
${temComparada ? `- Experiência de outros países e entes: um parágrafo por experiência (onde, quando, o que se fez, o que se mediu, o
  resultado), com a fonte NOMEADA no texto ("segundo o relatório X da OCDE"); feche com um parágrafo dizendo o que é e o que
  não é comparável ao caso brasileiro. Nada de "funcionará aqui".` : ''}
${emVigor ? `- Avaliação da política: um parágrafo por objetivo, em prosa, com o veredito EXATAMENTE como está na tese; se a tese
  disser "Contestado no contraditório: …", escreva "não verificável, porque …" com o motivo em prosa.`
: `- Avaliação da política (proposição ainda não em vigor): um parágrafo por objetivo declarado, em prosa: o que o texto prevê
  para alcançá-lo (dispositivos), o veredito EXATAMENTE como está na tese ("o texto prevê meios" / "em parte" / "não prevê
  meios") e, em uma frase, o que só poderá ser medido depois da vigência. Objetivo do tipo "regulamentar/instituir X" é o
  próprio objeto: descreva o que o texto regula; NÃO escreva "não verificável" para ele.`}
- Os dois lados: o argumento de cada lado pode ser relatado como posição dele ("quem apoia sustenta que…"); a frase "o que
  a evidência diz" nunca atribui causa.
- Os dois lados: o melhor de cada um e o que a evidência diz sobre cada um.
- Opções e consequências: uma por parágrafo, com as três consequências; sem recomendar voto.
- Respostas por lente: prosa técnica com o dispositivo citado; sem enumerar linha a linha.
- Português formal, parágrafos corridos, texto puro: sem negrito, itálico, listas, tabelas ou cercas de código. Não escreva
  cabeçalho, título, destinatário, data, ressalvas ou lista de fontes: o formato de impressão já traz.`;
}

const RE_MARCADOR = /\[(T|O|L|P|A|D|LV|F)\d+\](?:\[(?:T|O|L|P|A|D|LV|F)\d+\])*/g;
const RE_ID = /\b(T|O|L|P|A|D|LV|F)(\d+)\b/g;
const SECOES_COM_JUIZO = ['Síntese', 'Avaliação da política', 'Os dois lados', 'Opções e consequências'];
const REF_NORMATIVA_RE = /\b(lei|leis|decreto|decreto-lei|LC|EC|ADCT|s[úu]mula|vinculante|tema|ADI|ADC|ADPF|ADO|RE|ARE|AI|HC|MS|REsp|resolu[çc][ãa]o|portaria|instru[çc][ãa]o normativa|IN|medida provis[óo]ria|MP|MPV|PL|PLP|PEC|PLN|PLV|art|artigo|inciso|par[áa]grafo|al[íi]nea|n[.º°]?)\s*(n?[.º°]?\s*)?$/i;

/** Divide o texto nas seções fixas (título em linha própria). */
function secoesDoTexto(texto) {
  const titulos = Object.values(TITULOS);
  const out = {}; let atual = '_abertura';
  for (const par of String(texto || '').split(/\n{2,}|\n(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/)) {
    const linha1 = par.trim().split('\n')[0].trim().replace(/[:.]$/, '');
    const t = titulos.find(x => linha1.toLowerCase() === x.toLowerCase());
    if (t) { atual = t; const resto = par.trim().split('\n').slice(1).join('\n').trim(); out[t] = out[t] || []; if (resto) out[t].push(resto); continue; }
    (out[atual] = out[atual] || []).push(par.trim());
  }
  return out;
}

/** Confere a redação: marcadores existentes, parágrafos de juízo com marcador, números na base. */
function conferirRedacao(texto, { tese, catalogo, ficha }) {
  const t = String(texto || '');
  const idsTese = new Set(unidadesDaTese(tese).map(u => u.id));
  const idsExistentes = id => idsTese.has(id) || catalogo.porId.has(id);
  const idsInexistentes = [];
  for (const m of t.matchAll(RE_ID)) { const id = m[1] + m[2]; if (!idsExistentes(id)) idsInexistentes.push(id); }
  const secoes = secoesDoTexto(t);
  const semEvidencia = [];
  const RE_VAZIA = /nenhuma unidade da tese sobreviveu/i;
  for (const s of SECOES_COM_JUIZO) for (const p of secoes[s] || []) if (p.length > 40 && !RE_VAZIA.test(p) && !RE_MARCADOR.test(p)) { semEvidencia.push({ secao: s, trecho: p.slice(0, 120) }); RE_MARCADOR.lastIndex = 0; } else RE_MARCADOR.lastIndex = 0;
  const base = new Set();
  for (const u of unidadesDaTese(tese)) for (const n of _numerosDoTexto(u.texto)) base.add(n);
  for (const it of catalogo.itens) for (const n of it.numeros || []) base.add(n);
  for (const n of _numerosDoTexto(ficha ? (_fichaParaTexto ? _fichaParaTexto(ficha) : '') : '')) base.add(n);
  const numerosSuspeitos = [];
  const semMarcadores = t.replace(RE_MARCADOR, '');
  const re = /\d[\d.]*(?:,\d+)?/g; let m;
  while ((m = re.exec(semMarcadores)) !== null) {
    const bruto = m[0]; const v = Number(bruto.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(v) || !numeroRelevante(v)) continue;
    if (!bruto.includes(',') && v <= 300) continue;
    if (REF_NORMATIVA_RE.test(semMarcadores.slice(Math.max(0, m.index - 34), m.index))) continue;
    if (base.has(Math.abs(v))) continue;
    numerosSuspeitos.push({ numero: bruto, contexto: '…' + semMarcadores.slice(Math.max(0, m.index - 50), m.index + bruto.length + 50).replace(/\s+/g, ' ') + '…' });
  }
  const extenso = t.match(/\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|mil|quinhentos)\s+(?:e\s+\w+\s+)?(bilh|milh)/gi) || [];
  const ok = !idsInexistentes.length && !semEvidencia.length && !numerosSuspeitos.length && !extenso.length;
  return { ok, idsInexistentes: [...new Set(idsInexistentes)], semEvidencia, numerosSuspeitos, cifrasPorExtenso: extenso, secoes: Object.keys(secoes) };
}

function limparMarcadores(texto) { return String(texto || '').replace(/\s*\[(?:T|O|L|P|A|D|LV|F)\d+\]/g, ''); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SECOES_TESE, TITULOS, VEREDITOS, catalogoDeEvidencias, promptTese, validarTese, unidadesDaTese, textoDaTese,
    promptContraditorio, aplicarContraditorio, promptRedacao, secoesDoTexto, conferirRedacao, limparMarcadores, RE_MARCADOR, numsRelevantes };
}
