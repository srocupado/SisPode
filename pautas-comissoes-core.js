// Pautas de Comissões — o NÚCLEO, sem tela: o que se lê da API da Câmara
// (comissões permanentes, reuniões deliberativas, itens de pauta), como um
// item vira documentos e prompt, e a fila que limita as chamadas ao provedor
// de IA quando se gera a semana inteira.
//
// Diferença para o Plenário: aqui não há cenários. Cada item de pauta de
// comissão tem UM parecer (PRL) do relator daquela comissão sobre UMA
// matéria; o que se analisa é o parecer, com o inteiro teor da matéria como
// referência. A pauta vem da API (/eventos/{id}/pauta), não de PDF.
//
// Script clássico (global na extensão) + module.exports para os testes.

const API_CAMARA_PC = 'https://dadosabertos.camara.leg.br/api/v2';

// As 30 permanentes, como a API as devolve (codTipoOrgao=2, set/2026). É o
// fallback: a tela atualiza a lista pela API e guarda em cache por um dia.
const COMISSOES_PERMANENTES = [
  { id: 2001, sigla: 'CAPADR', nome: 'Comissão de Agricultura, Pecuária, Abastecimento e Desenvolvimento Rural' },
  { id: 539388, sigla: 'CASP', nome: 'Comissão de Administração e Serviço Público' },
  { id: 2003, sigla: 'CCJC', nome: 'Comissão de Constituição e Justiça e de Cidadania' },
  { id: 539385, sigla: 'CCOM', nome: 'Comissão de Comunicação' },
  { id: 2002, sigla: 'CCTI', nome: 'Comissão de Ciência, Tecnologia e Inovação' },
  { id: 536996, sigla: 'CCULT', nome: 'Comissão de Cultura' },
  { id: 2004, sigla: 'CDC', nome: 'Comissão de Defesa do Consumidor' },
  { id: 2008, sigla: 'CDE', nome: 'Comissão de Desenvolvimento Econômico' },
  { id: 2007, sigla: 'CDHMIR', nome: 'Comissão de Direitos Humanos, Minorias e Igualdade Racial' },
  { id: 2006, sigla: 'CDU', nome: 'Comissão de Desenvolvimento Urbano' },
  { id: 2009, sigla: 'CE', nome: 'Comissão de Educação' },
  { id: 537236, sigla: 'CESPO', nome: 'Comissão do Esporte' },
  { id: 2011, sigla: 'CFFC', nome: 'Comissão de Fiscalização Financeira e Controle' },
  { id: 2010, sigla: 'CFT', nome: 'Comissão de Finanças e Tributação' },
  { id: 539386, sigla: 'CICS', nome: 'Comissão de Indústria, Comércio e Serviços' },
  { id: 537871, sigla: 'CIDOSO', nome: 'Comissão de Defesa dos Direitos da Pessoa Idosa' },
  { id: 2017, sigla: 'CINDRE', nome: 'Comissão de Integração Nacional e Desenvolvimento Regional' },
  { id: 5438, sigla: 'CLP', nome: 'Comissão de Legislação Participativa' },
  { id: 6174, sigla: 'CMADS', nome: 'Comissão de Meio Ambiente e Desenvolvimento Sustentável' },
  { id: 2012, sigla: 'CME', nome: 'Comissão de Minas e Energia' },
  { id: 537870, sigla: 'CMULHER', nome: 'Comissão de Defesa dos Direitos da Mulher' },
  { id: 539387, sigla: 'CPASF', nome: 'Comissão de Previdência, Assistência Social, Infância, Adolescência e Família' },
  { id: 537480, sigla: 'CPD', nome: 'Comissão de Defesa dos Direitos das Pessoas com Deficiência' },
  { id: 539384, sigla: 'CPOVOS', nome: 'Comissão da Amazônia e dos Povos Originários e Tradicionais' },
  { id: 2018, sigla: 'CREDN', nome: 'Comissão de Relações Exteriores e de Defesa Nacional' },
  { id: 2014, sigla: 'CSAUDE', nome: 'Comissão de Saúde' },
  { id: 5503, sigla: 'CSPCCO', nome: 'Comissão de Segurança Pública e Combate ao Crime Organizado' },
  { id: 2015, sigla: 'CTRAB', nome: 'Comissão de Trabalho' },
  { id: 6066, sigla: 'CTUR', nome: 'Comissão de Turismo' },
  { id: 2016, sigla: 'CVT', nome: 'Comissão de Viação e Transportes' },
];

/** Lista de permanentes vinda da API (/orgaos?codTipoOrgao=2), normalizada e ordenada por sigla. */
function normalizarOrgaos(dados) {
  return (Array.isArray(dados) ? dados : [])
    .filter(o => o && o.id && o.sigla && (o.codTipoOrgao == null || Number(o.codTipoOrgao) === 2))
    .map(o => ({ id: Number(o.id), sigla: String(o.sigla).toUpperCase(), nome: String(o.nome || o.sigla) }))
    .sort((a, b) => a.sigla.localeCompare(b.sigla));
}

// O papel da comissão muda a pergunta que o parecer responde. A CCJC e a CFT
// têm papel formal (admissibilidade; adequação financeira) além do mérito
// quando o parecer o diz; as demais deliberam sobre o mérito.
const PAPEL_COMISSAO = {
  CCJC: { tipo: 'admissibilidade', descricao: 'constitucionalidade, juridicidade e técnica legislativa (art. 54, I, do RICD); só examina o mérito quando o parecer o indicar expressamente' },
  CFT: { tipo: 'adequacao', descricao: 'adequação financeira e orçamentária (art. 54, II, do RICD) e, quando for comissão de mérito da matéria, o mérito' },
};
function papelDaComissao(sigla, textoParecer = '') {
  const base = PAPEL_COMISSAO[String(sigla || '').toUpperCase()] || { tipo: 'merito', descricao: 'o mérito da matéria, na sua área temática' };
  const comMerito = /no m[ée]rito/i.test(textoParecer || '');
  if (base.tipo !== 'merito' && comMerito) return { tipo: 'misto', descricao: `${base.descricao}; neste item o parecer também se manifesta sobre o mérito` };
  return base;
}

// ---------- reuniões ----------

/** Só reuniões deliberativas de comissão permanente; normaliza o que a tela usa. */
function eventosDeliberativos(dados, { orgaoId = null } = {}) {
  const out = [];
  for (const ev of (Array.isArray(dados) ? dados : [])) {
    if (!ev || !/deliberativ/i.test(ev.descricaoTipo || '')) continue;
    const orgs = Array.isArray(ev.orgaos) ? ev.orgaos : [];
    const perm = orgs.filter(o => Number(o.codTipoOrgao) === 2);
    if (orgs.length && !perm.length) continue;
    const org = perm.find(o => orgaoId == null || Number(o.id) === Number(orgaoId)) || perm[0] || null;
    if (orgaoId != null && !org) continue;
    if (orgaoId != null && Number(org.id) !== Number(orgaoId)) continue;
    const ini = String(ev.dataHoraInicio || '');
    if (!ini) continue;
    out.push({
      id: Number(ev.id), orgaoId: org ? Number(org.id) : (orgaoId != null ? Number(orgaoId) : null),
      sigla: org ? String(org.sigla) : '', nomeOrgao: org ? String(org.nome || '') : '',
      data: ini.slice(0, 10), hora: ini.slice(11, 16), horaFim: String(ev.dataHoraFim || '').slice(11, 16),
      tipo: String(ev.descricaoTipo || ''), descricao: String(ev.descricao || '').replace(/\s+/g, ' ').trim(),
      situacao: String(ev.situacao || ''), local: ev.localCamara?.nome || ev.localExterno || '',
      urlRegistro: ev.urlRegistro || null,
      conjunta: perm.length > 1 ? perm.map(o => o.sigla) : null,
    });
  }
  out.sort((a, b) => (a.data + a.hora + a.sigla).localeCompare(b.data + b.hora + b.sigla));
  return out;
}

function agruparPorData(eventos) {
  const m = {};
  for (const ev of eventos || []) (m[ev.data] = m[ev.data] || []).push(ev);
  return m;
}

/** Segunda a sexta da semana que contém a data (ISO). */
function semanaDe(dataIso) {
  const d = new Date(`${String(dataIso).slice(0, 10)}T12:00:00Z`);
  const dow = d.getUTCDay();                       // 0 dom … 6 sáb
  const seg = new Date(d); seg.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  const dias = [];
  for (let i = 0; i < 5; i++) { const x = new Date(seg); x.setUTCDate(seg.getUTCDate() + i); dias.push(x.toISOString().slice(0, 10)); }
  return { inicio: dias[0], fim: dias[4], dias };
}

const MESES_PC = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_PC = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const diaSemana = iso => DIAS_PC[new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).getUTCDay()];
function rotuloSemana(sem) {
  const [a1, m1, d1] = sem.inicio.split('-'), [, m2, d2] = sem.fim.split('-');
  return m1 === m2 ? `Semana de ${+d1} a ${+d2} de ${MESES_PC[+m1 - 1]} de ${a1}` : `Semana de ${+d1} de ${MESES_PC[+m1 - 1]} a ${+d2} de ${MESES_PC[+m2 - 1]} de ${a1}`;
}
const tituloReuniao = ev => `${ev.tipo || 'Reunião'}${ev.descricao && !/discussão e votação de propostas legislativas/i.test(ev.descricao) ? ` — ${ev.descricao}` : ''} de ${dataBR(ev.data)}${ev.hora ? `, ${ev.hora}` : ''}`;
const chaveReuniao = ev => `${ev.orgaoId}_${ev.id}`;

// ---------- itens da pauta ----------

const SIGLAS_PARECER_PC = new Set(['PAR', 'PRL', 'VTS', 'VEN', 'VCM', 'CVR', 'PRLP']);
const limpaChave = s => String(s || '').replace(/[.#$\[\]\/\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/**
 * Itens da pauta como a tela os usa. A matéria em deliberação é a do TÍTULO
 * do item — não simplesmente a "relacionada": num requerimento a relacionada
 * é o projeto apenas citado (regra herdada do bot, bot/src/comissoes.js).
 */
function itensDaPauta(dados) {
  const out = [], vistos = new Map();
  for (const item of (Array.isArray(dados) ? dados : [])) {
    const prop = item.proposicao_ || {}, rel = item.proposicaoRelacionada_ || {};
    const t = String(item.titulo || '').toUpperCase().match(/^([A-Z]+)\s+([\d.]+)\/(\d{4})/);
    const bate = p => !!t && !!p && String(p.siglaTipo || '').toUpperCase() === t[1] && String(p.numero) === t[2].replace(/\./g, '') && String(p.ano) === t[3];
    const ehParecer = p => SIGLAS_PARECER_PC.has(String(p?.siglaTipo || '').toUpperCase());
    const materia = bate(rel) ? rel : bate(prop) ? prop : (rel.id ? rel : (ehParecer(prop) ? null : prop));
    const parecer = ehParecer(prop) ? prop : (ehParecer(rel) && !bate(rel) ? rel : null);
    if (!materia || !materia.id) continue;
    const sigla = String(materia.siglaTipo || t?.[1] || '').toUpperCase(), numero = parseInt(materia.numero, 10) || 0, ano = parseInt(materia.ano, 10) || 0;
    const rel_ = item.relator && typeof item.relator === 'object' ? item.relator : null;
    const chave = limpaChave(`${sigla}-${numero}-${ano}`);
    const it = {
      chave, ordem: Number(item.ordem) || out.length + 1, topico: String(item.topico || ''), regime: String(item.regime || ''),
      titulo: String(item.titulo || `${sigla} ${numero}/${ano}`), sigla, numero, ano, idMateria: Number(materia.id), ementa: String(materia.ementa || '').replace(/\s+/g, ' ').trim(),
      relator: rel_ ? { id: rel_.id || null, nome: rel_.nome || '', partido: rel_.siglaPartido || '', uf: rel_.siglaUf || '' } : (typeof item.relator === 'string' && item.relator ? { id: null, nome: item.relator, partido: '', uf: '' } : null),
      parecer: parecer ? { id: Number(parecer.id), sigla: String(parecer.siglaTipo || '').toUpperCase(), numero: parseInt(parecer.numero, 10) || null, ementa: String(parecer.ementa || '').replace(/\s+/g, ' ').trim() } : null,
      textoParecer: String(item.textoParecer || '').replace(/\s+/g, ' ').trim(),
      situacaoItem: String(item.situacaoItem || ''), uriVotacao: item.uriVotacao || null,
      requerimento: /^(REQ|RIC|RCP|INC)$/.test(sigla),
    };
    // A mesma matéria pode aparecer duas vezes (parecer e complementação de voto): fica a última.
    if (vistos.has(chave)) { out[vistos.get(chave)] = { ...out[vistos.get(chave)], ...it, ordem: out[vistos.get(chave)].ordem }; continue; }
    vistos.set(chave, out.length); out.push(it);
  }
  out.sort((a, b) => a.ordem - b.ordem);
  return out;
}

/** Voto do relator, curto, a partir do texto do parecer da pauta ("pela aprovação, com substitutivo"). */
function votoDoRelator(textoParecer) {
  const m = String(textoParecer || '').match(/\bpel[ao]\s+.+/i);
  return m ? m[0].replace(/[.\s]+$/, '').slice(0, 220) : '';
}

/**
 * Documentos que vão ao modelo: o parecer (o que a comissão vota) e o inteiro
 * teor da matéria (a referência). `detalhes` são os /proposicoes/{id} já
 * buscados: { parecer, materia }.
 */
function documentosDoItem(item, detalhes = {}) {
  const docs = [];
  const urlP = detalhes.parecer?.urlInteiroTeor, urlM = detalhes.materia?.urlInteiroTeor;
  if (item.parecer && urlP) docs.push({ tipo: 'PARECER', rotulo: `${item.parecer.sigla}${item.parecer.numero ? ' ' + item.parecer.numero : ''} — parecer do(a) relator(a)${item.relator?.nome ? ` ${item.relator.nome}` : ''}`, url: urlP });
  if (urlM) docs.push({ tipo: 'INTEIRO_TEOR', rotulo: `Inteiro teor do ${item.sigla} ${item.numero}/${item.ano}`, url: urlM });
  return docs;
}

// ---------- prompt ----------

const REGRAS_RIGIDAS_PC = `REGRAS RÍGIDAS:
- Use apenas informação contida nos documentos anexos. Não invente fatos.
- Se uma informação solicitada não constar nos documentos, escreva explicitamente "não consta nos documentos" em vez de supor ou recorrer a conhecimento externo.
- Não invente números de lei, artigos, decretos, datas, valores ou nomes. Só cite um dispositivo se ele aparecer literalmente nos documentos anexos.
- NÃO inclua recomendação de voto (favorável/contrário/abstenção) nem orientação de bancada.
- **NÃO use bullets, listas, "-", "*" ou numeração**, salvo onde a seção pedir tópicos. O resto é parágrafo corrido.
- Ao se referir à proposição, use SEMPRE a forma curta da sigla (ex.: **PL 1234/2010**, **PLP 41/2026**), nunca "Projeto de Lei nº 1234, de 2010".
- Responda em texto Markdown puro, sem cercas de código \`\`\`.`;

/** A nota da comissão: um parecer, uma matéria, o papel do colegiado. */
function promptComissao({ comissao, reuniao, item, docs = [], instrucoesExtra = '' }) {
  const papel = papelDaComissao(comissao.sigla, item.textoParecer);
  const rel = item.relator?.nome ? `${item.relator.nome}${item.relator.partido ? ` (${item.relator.partido}${item.relator.uf ? '-' + item.relator.uf : ''})` : ''}` : 'não informado na pauta';
  const docsLista = docs.map((d, i) => `Documento ${i + 1} — ${d.rotulo}`).join('\n');
  const temParecer = docs.some(d => d.tipo === 'PARECER'), temTeor = docs.some(d => d.tipo === 'INTEIRO_TEOR');
  const extra = instrucoesExtra && instrucoesExtra.trim() ? `\nINSTRUÇÕES ADICIONAIS DO(A) ASSESSOR(A) (têm prioridade quanto à ênfase, à profundidade e aos recortes temáticos, mas NÃO substituem a estrutura de seções nem as REGRAS RÍGIDAS):\n${instrucoesExtra.trim()}\n` : '';
  const cab = `Você é analista legislativo da Câmara dos Deputados, assessor(a) da Liderança do Podemos. Elabore uma nota técnica sucinta, clara e objetiva para informar Deputados Federais sobre um item da pauta de comissão.

COMISSÃO: ${comissao.nome} (${comissao.sigla}). Papel deste colegiado nesta deliberação: ${papel.descricao}.
REUNIÃO: ${tituloReuniao(reuniao)}${reuniao.local ? ` · ${reuniao.local}` : ''}.
ITEM ${item.ordem}${item.topico ? ` (${item.topico})` : ''}: **${item.sigla} ${item.numero}/${item.ano}**${item.regime ? ` · regime: ${item.regime}` : ''}.
Ementa (da pauta): "${(item.ementa || '').slice(0, 800)}"
Relator(a) na comissão: ${rel}.
${item.textoParecer ? `Conclusão do parecer, como consta da pauta: "${item.textoParecer.slice(0, 500)}"` : 'A pauta não traz o texto do parecer.'}
${docsLista ? `\nDocumentos anexados a esta análise:\n${docsLista}\n` : '\nNenhum documento pôde ser anexado: baseie-se apenas na ementa e na conclusão do parecer acima e diga isso na nota.\n'}`;

  if (item.requerimento) {
    return `${cab}
Produza a nota em **Português do Brasil**, formato **Markdown**, em **parágrafos corridos**, com as seções (títulos exatos com "##"):

## Objetivo
Parágrafo único: o que o requerimento pede (audiência pública, convite, informação, inclusão em pauta, apensação…), quem o assina e a quem se dirige.

## O que se decide
O que a aprovação ou a rejeição produzem na prática na comissão; quem é convidado ou afetado; prazos, se constarem.

## Pontos de atenção para a bancada
Relação com matérias em tramitação na comissão e com temas de interesse do Podemos que os documentos permitam identificar; o que a bancada precisa saber antes de votar, sem recomendar voto.
${extra}
${REGRAS_RIGIDAS_PC}`;
  }

  const cotejo = temTeor && temParecer ? ' O inteiro teor da matéria está anexado: **faça o cotejo entre o texto original e o texto que o parecer propõe (substitutivo ou emendas), dispositivo a dispositivo**, apontando o que foi INCLUÍDO, ALTERADO (antes e depois) e SUPRIMIDO. Se o parecer aprova a matéria sem alteração, diga isso e descreva o texto original.' : '';
  const secaoPapel = papel.tipo === 'admissibilidade'
    ? `## Admissibilidade
O que o parecer conclui sobre constitucionalidade, juridicidade e técnica legislativa, com os fundamentos que ele dá (dispositivos da Constituição e do Regimento citados no documento). Se o parecer também examina o mérito, diga-o em parágrafo próprio. Não decrete inconstitucionalidade por conta própria: relate o que o parecer afirma e, se houver ponto que mereça exame, escreva "o ponto merece exame quanto a…".`
    : papel.tipo === 'adequacao'
      ? `## Adequação financeira e orçamentária
O que o parecer conclui sobre compatibilidade com o PPA, a LDO e a LOA e sobre impacto orçamentário, com os fundamentos e as estimativas que constarem do documento. Se o parecer for terminativo quanto à adequação, diga o efeito disso na tramitação. Se também examinar o mérito, parágrafo próprio.`
      : papel.tipo === 'misto'
        ? `## Papel da comissão neste item
Primeiro o exame formal (${comissao.sigla}) que o parecer faz, com fundamentos; depois, em parágrafo próprio, a manifestação de mérito, com os argumentos do(a) relator(a).`
        : `## Mérito
Os argumentos de mérito do parecer: o problema que a matéria enfrenta, por que o(a) relator(a) conclui como conclui, e o que o parecer diz sobre impactos, custos e quem é afetado. Só o que consta do documento.`;

  return `${cab}
Produza a nota técnica em **Português do Brasil**, formato **Markdown**, em **parágrafos corridos** (sem bullets, salvo na seção de emendas), com as seguintes seções, nesta ordem e com estes títulos exatos ("##"):

## Objetivo
Parágrafo único, direto e em linguagem acessível: do que trata a matéria em deliberação.

## O que a comissão vota
O parecer do(a) relator(a): quem relata, a conclusão (aprovação, rejeição, com substitutivo, com emendas, pela admissibilidade…) e os fundamentos principais do voto, como constam do documento "parecer". Se houver apensados examinados no parecer, diga o que se conclui sobre cada um, em uma frase por apensado.

## Principais disposições do texto em votação
O que o texto que a comissão vota (o substitutivo ou as emendas do parecer, ou a matéria original quando o parecer não a altera) efetivamente cria, altera ou revoga, citando os dispositivos.${cotejo} Descreva o que muda na prática, sem frases genéricas.

## Emendas na comissão
Se o parecer se manifestar sobre emendas apresentadas na comissão, apresente **um tópico (item de lista com "-") por emenda**, no formato "Emenda nº N – <autor(a), se constar> – <acolhida | acolhida em parte | rejeitada> – <o que ela faz>", citando o número EXATAMENTE como no parecer. Se não houver emendas ou o parecer não as mencionar, escreva só: "O parecer não se manifesta sobre emendas na comissão."

${secaoPapel}

## Pontos de atenção para a bancada
O que a bancada precisa saber antes de votar: o que muda em relação ao que vale hoje (só se constar dos documentos), quem ganha e quem perde, controvérsias que o próprio parecer registra (votos em separado, emendas rejeitadas com argumento), e o que a matéria ainda depende para virar lei (próximas comissões ou Plenário, se o parecer o disser). Sem recomendar voto.

## Argumentos favoráveis e contrários
Dois parágrafos corridos. O primeiro **começa exatamente com **Argumentos favoráveis:**** e reúne os argumentos que sustentam a aprovação do parecer; o segundo **começa exatamente com **Argumentos contrários:**** e reúne os que sustentam a rejeição. **Apresente SEMPRE os dois lados**, ainda que os documentos tragam apenas um. **Nesta seção (e apenas nela) você pode recorrer a conhecimento geral** para construir contrapontos plausíveis, apresentados como ponderação, não como fato; sem inventar dados sobre o conteúdo dos documentos.
${extra}
PRINCÍPIOS: clareza (sem termo técnico sem explicação); objetividade; imparcialidade (fatos e impactos, sem posicionamento); fundamentação nos documentos.

${REGRAS_RIGIDAS_PC}`;
}

/**
 * O prompt extra de uma comissão (configurado pelo analista e guardado para a
 * equipe) e as instruções avulsas de uma reanálise entram juntos no mesmo
 * bloco de INSTRUÇÕES ADICIONAIS, cada um nomeado.
 */
function juntarInstrucoes(promptComissaoExtra = '', instrucoesItem = '') {
  const a = String(promptComissaoExtra || '').trim(), b = String(instrucoesItem || '').trim();
  if (a && b) return `Orientações permanentes desta comissão:\n${a}\n\nInstruções para esta análise:\n${b}`;
  return a || b;
}

/**
 * Qual provedor e modelo atendem uma comissão: o dela, quando configurado e
 * com chave disponível; senão o padrão das Configurações. `chaveDe(pid)`
 * devolve a chave local do provedor.
 */
function provedorParaComissao(cfgComissao = {}, cfgGlobal = {}, chaveDe = () => '') {
  const padrao = { pid: cfgGlobal.provedor || 'gemini', modelo: cfgGlobal.modelo || '', origem: 'padrao', aviso: null };
  padrao.apiKey = chaveDe(padrao.pid);
  const pid = cfgComissao.provedor;
  if (!pid) return { ...padrao, modelo: cfgComissao.modelo && !cfgComissao.provedor ? padrao.modelo : padrao.modelo };
  const apiKey = chaveDe(pid);
  if (!apiKey) return { ...padrao, aviso: `A comissão pede o provedor ${pid}, mas não há chave dele nas Configurações; usei o padrão.` };
  return { pid, apiKey, modelo: cfgComissao.modelo || (pid === padrao.pid ? padrao.modelo : ''), origem: 'comissao', aviso: null };
}

// ---------- fila de chamadas ----------

/**
 * Fila com limite de chamadas em paralelo e intervalo mínimo entre inícios:
 * "gerar todas as pautas da semana" pode enfileirar 200 análises, e o provedor
 * devolve 429 quando recebe tudo de uma vez. Cancelar rejeita o que ainda não
 * começou; o que está em voo termina.
 */
function criarFila({ paralelas = 2, intervaloMs = 3000, agora = () => Date.now(), dormir = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const espera = [];
  let emVoo = 0, ultimoInicio = 0, cancelada = false, feitas = 0, falhas = 0;
  const ouvintes = new Set();
  const avisar = () => { for (const f of ouvintes) { try { f(estado()); } catch (_) {} } };
  const estado = () => ({ pendentes: espera.length, emVoo, feitas, falhas, cancelada });
  async function puxar() {
    if (cancelada || emVoo >= Math.max(1, paralelas) || !espera.length) return;
    const gap = intervaloMs - (agora() - ultimoInicio);
    if (gap > 0) { await dormir(gap); return puxar(); }
    const job = espera.shift(); emVoo++; ultimoInicio = agora(); avisar();
    try { job.resolve(await job.fn()); feitas++; } catch (e) { falhas++; job.reject(e); }
    emVoo--; avisar(); puxar();
  }
  return {
    executar(fn) { return new Promise((resolve, reject) => { if (cancelada) return reject(new Error('fila cancelada')); espera.push({ fn, resolve, reject }); avisar(); puxar(); }); },
    cancelar() { cancelada = true; while (espera.length) espera.shift().reject(new Error('fila cancelada')); avisar(); },
    reiniciar() { cancelada = false; feitas = 0; falhas = 0; avisar(); },
    aoMudar(f) { ouvintes.add(f); return () => ouvintes.delete(f); },
    estado,
    get paralelas() { return paralelas; }, set paralelas(v) { paralelas = Math.max(1, Number(v) || 1); },
    get intervaloMs() { return intervaloMs; }, set intervaloMs(v) { intervaloMs = Math.max(0, Number(v) || 0); },
  };
}

// ---------- saídas ----------

/** Mensagem de WhatsApp com os itens do Podemos (autoria ou relatoria) numa reunião. */
function textoPropPartido(comissao, reuniao, itens) {
  const doPartido = (itens || []).filter(it => it.relator?.partido === 'PODE' || (it.autores || []).some(a => a.partido === 'PODE'));
  const linhas = [`*${comissao.sigla} — ${tituloReuniao(reuniao)}*`, ''];
  if (!doPartido.length) { linhas.push('Nenhum item de autoria ou relatoria do Podemos nesta pauta.'); return linhas.join('\n'); }
  for (const it of doPartido) {
    const papeis = [];
    if ((it.autores || []).some(a => a.partido === 'PODE')) papeis.push(`autoria: ${it.autores.filter(a => a.partido === 'PODE').map(a => a.nome).join(', ')}`);
    if (it.relator?.partido === 'PODE') papeis.push(`relatoria: ${it.relator.nome}`);
    linhas.push(`• *${it.sigla} ${it.numero}/${it.ano}* (item ${it.ordem}) — ${papeis.join(' · ')}`);
    linhas.push(`  ${(it.ementa || '').slice(0, 160)}`);
    const voto = votoDoRelator(it.textoParecer); if (voto) linhas.push(`  🗳️ ${voto}`);
  }
  return linhas.join('\n');
}

/** Resumo da reunião para WhatsApp: cada item com relator e conclusão do parecer. */
function textoResumoReuniao(comissao, reuniao, itens) {
  const linhas = [`*${comissao.sigla} — ${tituloReuniao(reuniao)}*${reuniao.local ? ` · ${reuniao.local}` : ''}`, `${(itens || []).length} item(ns) na pauta`, ''];
  for (const it of itens || []) {
    const rel = it.relator?.nome ? ` · rel. ${it.relator.nome}${it.relator.partido ? ` (${it.relator.partido})` : ''}` : '';
    const voto = votoDoRelator(it.textoParecer);
    linhas.push(`${it.ordem}. *${it.sigla} ${it.numero}/${it.ano}*${rel}${voto ? ` — ${voto}` : ''}${it.situacaoItem ? ` [${it.situacaoItem}]` : ''}`);
  }
  return linhas.join('\n');
}

const escPC = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * HTML de impressão da reunião: cabeçalho institucional, índice e um bloco
 * por item com a nota. `notaHtml(item)` devolve o HTML já sanitizado da nota.
 */
function htmlImpressaoReuniao({ comissao, reuniao, itens, notaHtml, logoDataUrl = null, css = '' }) {
  const comNota = (itens || []).filter(it => it.analise && (it.analise.html || it.analise.markdown));
  const bm = it => `i_${it.chave}`;
  const indice = comNota.map(it => `<li><a href="#${bm(it)}">${escPC(`${it.sigla} ${it.numero}/${it.ano}`)} — ${escPC((it.ementa || '').slice(0, 110))}<span class="ld"></span></a></li>`).join('');
  const blocos = comNota.map(it => {
    const rel = it.relator?.nome ? `Relator(a): ${escPC(it.relator.nome)}${it.relator.partido ? ` (${escPC(it.relator.partido)}${it.relator.uf ? '-' + escPC(it.relator.uf) : ''})` : ''}` : '';
    return `<div class="bloco" id="${bm(it)}">
      <h3 class="item-h">Item ${it.ordem} · ${escPC(`${it.sigla} ${it.numero}/${it.ano}`)}</h3>
      <p class="meta-item">${escPC(it.ementa || '')}</p>
      <p class="meta-item">${[rel, it.textoParecer ? `Parecer: ${escPC(it.textoParecer)}` : '', it.regime ? `Regime: ${escPC(it.regime)}` : ''].filter(Boolean).join(' · ')}</p>
      ${notaHtml(it)}
    </div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escPC(comissao.sigla)} — ${escPC(tituloReuniao(reuniao))}</title>
  <style>${css}
    .meta-item { font-size:10pt; color:#444; margin:2px 0 6px; }
    .bloco { page-break-inside:auto; margin-bottom:14px; }
    .nota h2 { font-size:12pt; margin:10px 0 4px; color:#1a4f7a; } .nota p { font-size:10.5pt; line-height:1.45; margin:0 0 6px; text-align:justify; }
  </style></head><body>
    <div class="cab"><div class="sp"></div><div class="tit"><h1>Pauta de Comissão — ${escPC(comissao.sigla)}</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<div class="sp"></div>'}</div>
    <div class="rule"></div>
    <div class="meta">${escPC(comissao.nome)} · ${escPC(tituloReuniao(reuniao))}${reuniao.local ? ` · ${escPC(reuniao.local)}` : ''} · ${(itens || []).length} item(ns) na pauta, ${comNota.length} com nota</div>
    <section class="indice"><h2>Índice</h2><ul>${indice}</ul></section>
    ${blocos || '<p>Nenhum item com nota gerada.</p>'}
    <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
  </body></html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { API_CAMARA_PC, COMISSOES_PERMANENTES, normalizarOrgaos, PAPEL_COMISSAO, papelDaComissao, eventosDeliberativos, agruparPorData, semanaDe, rotuloSemana, tituloReuniao, chaveReuniao, dataBR, diaSemana,
    itensDaPauta, votoDoRelator, documentosDoItem, promptComissao, juntarInstrucoes, provedorParaComissao, criarFila, textoPropPartido, textoResumoReuniao, htmlImpressaoReuniao, limpaChave };
}
