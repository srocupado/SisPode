// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Matéria que está na pauta da Câmara e que a Câmara ainda não registrou: o que o Senado sabe dela.
//
// Nasceu em 17/11/2026, com o PLP 299/2026. A matéria entrou na pauta do Plenário da Câmara antes de o
// Senado terminar de votá-la; a API da Câmara não a devolvia, o leitor da pauta a recusava ("a Câmara não
// confirmou a proposição lida") e, quando ela entrava, o card ficava com "documento não disponível".
//
// Desde 2019 a numeração de PL, PLP, PEC e PDL é única para as duas Casas: o PLP 299/2026 do Senado é o
// PLP 299/2026 que chegará à Câmara. Por isso dá para consultar o Senado pela mesma sigla, número e ano e
// trazer ementa, autor, situação e os documentos (parecer do relator e texto inicial) — o bastante para o
// item entrar na pauta preenchido e para a IA analisar, com o aviso de que o texto ainda pode mudar.
//
// A conferência da ementa (senadoMesmaMateria) existe porque o número igual não é garantia absoluta:
// se a ementa lida na pauta não tiver nada a ver com a do Senado, o item avisa em vez de afirmar.
//
// Serviço usado: /dadosabertos/processo (o atual). O serviço antigo (/dadosabertos/materia) responde com
// aviso de descontinuação desde 2025.
//
// Só a parte sem tela. Script clássico (global na extensão) + module.exports para os testes e o bot.

'use strict';

const SENADO_API = 'https://legis.senado.leg.br/dadosabertos';
/** Siglas com numeração única entre as Casas. PRC (resolução da Câmara), MSC, REQ e REC não existem no Senado com o mesmo número. */
const SENADO_SIGLAS = ['PL', 'PLP', 'PEC', 'PDL', 'MPV'];
const SENADO_CENARIO = 'Documentos do Senado (matéria ainda sem registro na Câmara)';
const PROVISORIO_ROTULO = 'Aguardando registro na Câmara';

const _senSemAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const _senDataBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
/** O Senado publica o mesmo documento em legis.senado.gov.br e legis.senado.leg.br; a extensão tem permissão para os dois, mas um endereço só evita duplicata. */
const _senUrl = u => String(u || '').replace(/^http:\/\//i, 'https://').replace(/\/\/legis\.senado\.gov\.br\//i, '//legis.senado.leg.br/');

function senadoTemSigla(sigla) { return SENADO_SIGLAS.includes(String(sigla || '').toUpperCase()); }

/**
 * As duas ementas falam da mesma coisa? Compara as palavras de conteúdo (4 letras ou mais, sem acento).
 * Devolve { grau: 0..1, parecida, indefinido } — indefinido quando a pauta não trouxe ementa para comparar.
 */
function senadoMesmaMateria(ementaPauta, ementaSenado) {
  const palavras = t => new Set((_senSemAcento(t).toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !/^(para|pela|pelo|pelas|pelos|como|outras|outros|sobre|entre|desta|deste|dessa|desse|esta|este|essa|esse|providencias|altera|dispoe|institui|federal|nacional)$/.test(w)));
  const a = palavras(ementaPauta), b = palavras(ementaSenado);
  if (a.size < 3 || b.size < 3) return { grau: 0, parecida: false, indefinido: true };
  let comuns = 0; for (const w of a) if (b.has(w)) comuns++;
  const grau = comuns / Math.min(a.size, b.size);
  return { grau: Math.round(grau * 100) / 100, parecida: grau >= 0.3, indefinido: false };
}

/**
 * Dos documentos da matéria no Senado, os que servem à análise: o parecer mais recente (traz o
 * substitutivo, quando há) e o texto — o aprovado, se já existir, senão o inicial. Emendas avulsas e
 * requerimentos ficam de fora (o avulso de emendas do PLP 299/2026 tinha 210 páginas e 21 MB).
 */
function senadoEscolherDocumentos(lista = []) {
  const docs = (Array.isArray(lista) ? lista : []).filter(d => d && d.urlDocumento).map(d => ({
    sigla: String(d.siglaTipo || '').toUpperCase(), tipoTexto: String(d.descricaoTipo || ''), identificacao: String(d.identificacao || '').trim(),
    descricao: String(d.descricao || '').trim(), data: String(d.dataDocumento || d.dataRecebimento || '').slice(0, 10), autoria: String(d.autoria || '').trim(), url: _senUrl(d.urlDocumento),
  }));
  const maisRecente = arr => arr.slice().sort((x, y) => (y.data || '').localeCompare(x.data || ''))[0] || null;
  const out = [];
  const de = d => d.data ? `, de ${_senDataBR(d.data)}` : '';
  // texto já aprovado pelo Senado (redação final, autógrafo, texto final): é o que irá à Câmara
  const aprovado = maisRecente(docs.filter(d => /REDACAO_FINAL|AUTOGRAFO|TEXTO_FINAL|TEXTO_APROVADO/.test(d.sigla) || /reda[çc][ãa]o final|aut[óo]grafo|texto (?:final|aprovado)/i.test(d.tipoTexto)));
  if (aprovado) out.push({ tipo: 'INTEIRO_TEOR', rotulo: `Texto aprovado no Senado (${aprovado.tipoTexto || 'redação final'}${de(aprovado)})`, url: aprovado.url, data: aprovado.data, doSenado: true });
  // parecer do relator: o parecer aprovado; sem ele, o relatório legislativo mais recente
  const parecer = maisRecente(docs.filter(d => d.sigla === 'PARECER')) || maisRecente(docs.filter(d => d.sigla === 'RELATORIO'));
  if (parecer) out.push({ tipo: 'PRLP', rotulo: `Parecer do relator no Senado (${parecer.sigla === 'PARECER' ? (parecer.identificacao || 'Parecer') : 'Relatório Legislativo'}${parecer.autoria ? ', ' + parecer.autoria : ''}${de(parecer)})`, url: parecer.url, data: parecer.data, doSenado: true });
  // texto inicial: o próprio projeto; sem ele, o avulso inicial
  if (!aprovado) {
    const inicial = docs.find(d => /^(PROJETO_|PROPOSTA_|MEDIDA_PROVISORIA)/.test(d.sigla)) || docs.find(d => d.sigla === 'AVULSO_INICIAL');
    if (inicial) out.push({ tipo: 'INTEIRO_TEOR', rotulo: `Texto inicial no Senado (${inicial.autoria || 'autor não informado'}${de(inicial)})`, url: inicial.url, data: inicial.data, doSenado: true });
  }
  return out;
}

/**
 * Documentos do Senado que servem de APOIO à Nota Técnica Analítica (NTA) de matéria que passou por lá.
 *
 * Nasceu em 21/11/2026, com o PLP 299/2026: a Câmara só tinha o autógrafo e o parecer do relator de Plenário.
 * A comparação entre versões, as estimativas e o destino das emendas saíram de documentos do Senado que foram
 * juntados à mão. Aqui o programa os escolhe:
 *   - os pareceres do relator (até três, do mais recente para o mais antigo);
 *   - a PRIMEIRA versão do relatório, quando é anterior aos pareceres (traz o primeiro substitutivo);
 *   - o texto inicial (o projeto como foi apresentado);
 *   - as emendas do próprio relator (o substitutivo) e as que o registro de votação dá como aprovadas.
 * Ficam de fora os avulsos de emendas (dezenas de megabytes), os requerimentos, as listagens de votação (o
 * placar o programa já lê nos dados abertos) e o autógrafo (a Câmara o registra como o texto da matéria).
 * A nota de consultoria do Senado não aparece nesta lista: é publicada em outro endereço.
 * Devolve [{ tipo: 'APOIO_SENADO', rotulo, url, data, apoioSenado: true }], no máximo `max`.
 */
function senadoDocumentosDeApoio(lista = [], { max = 10 } = {}) {
  const docs = (Array.isArray(lista) ? lista : []).filter(d => d && d.urlDocumento).map(d => ({
    sigla: String(d.siglaTipo || '').toUpperCase(), identificacao: String(d.identificacao || '').replace(/\s+/g, ' ').trim(),
    descricao: String(d.descricao || '').replace(/\s+/g, ' ').trim(), data: String(d.dataDocumento || d.dataRecebimento || '').slice(0, 10), autoria: String(d.autoria || '').trim(), url: _senUrl(d.urlDocumento),
  }));
  const de = d => d.data ? `, de ${_senDataBR(d.data)}` : '';
  const porData = (x, y) => (x.data || '').localeCompare(y.data || '');
  const out = [], visto = new Set();
  const poe = (d, rotulo) => { if (d && !visto.has(d.url) && out.length < max) { visto.add(d.url); out.push({ tipo: 'APOIO_SENADO', rotulo, url: d.url, data: d.data, apoioSenado: true }); } };
  const pareceres = docs.filter(d => d.sigla === 'PARECER').sort((x, y) => porData(y, x)).slice(0, 3);
  for (const p of pareceres) poe(p, `Parecer no Senado (${p.identificacao || 'Parecer'}${p.autoria ? ', ' + p.autoria : ''}${de(p)})`);
  const relatorios = docs.filter(d => d.sigla === 'RELATORIO').sort(porData);
  const maisAntigoParecer = pareceres.length ? pareceres[pareceres.length - 1].data : '';
  if (relatorios.length && (!pareceres.length || (relatorios[0].data && relatorios[0].data < maisAntigoParecer)))
    poe(relatorios[0], `Relatório do relator no Senado${pareceres.length ? ', primeira versão' : ''} (${relatorios[0].autoria || 'relator'}${de(relatorios[0])})`);
  const inicial = docs.filter(d => /^(PROJETO_|PROPOSTA_|MEDIDA_PROVISORIA)/.test(d.sigla) && !/aut[óo]grafo|reda[çc][ãa]o final|texto final/i.test(d.identificacao)).sort(porData)[0];
  if (inicial) poe(inicial, `Texto inicial no Senado (${inicial.autoria || 'autor não informado'}${de(inicial)})`);
  // emendas: as do relator e as que a listagem de votação registra como aprovadas
  const numDe = d => (d.identificacao.match(/^EMENDA\s+(\d+)\b/i) || [])[1];
  const relatores = new Set(pareceres.concat(relatorios).map(d => d.autoria).filter(Boolean));
  const aprovadas = new Set();
  for (const l of docs.filter(d => d.sigla === 'LISTAGEM_RELATORIO' && /aprovad[ao]s?\b/i.test(d.descricao))) {
    const trecho = l.descricao.split(/rejeitad/i)[0];
    for (const m of trecho.matchAll(/Emendas?\s+n[ºo°]s?\.?\s*((?:\d+\s*(?:,|e|a)?\s*)+)/gi)) for (const n of m[1].match(/\d+/g) || []) aprovadas.add(n);
  }
  const emendas = docs.filter(d => d.sigla === 'EMENDA' && numDe(d));
  for (const e of emendas.filter(e => relatores.has(e.autoria)).sort((x, y) => Number(numDe(y)) - Number(numDe(x))).slice(0, 3))
    poe(e, `Emenda do relator no Senado (${e.descricao && !/^-$/.test(e.descricao) ? e.descricao : 'Emenda nº ' + numDe(e)}${de(e)})`);
  for (const e of emendas.filter(e => aprovadas.has(numDe(e)) && !relatores.has(e.autoria)).sort((x, y) => Number(numDe(x)) - Number(numDe(y))).slice(0, 6))
    poe(e, `Emenda nº ${numDe(e)} aprovada no Senado (${e.autoria || 'autor não informado'})`);
  return out;
}

/**
 * Consulta o Senado e devolve os documentos de apoio da matéria: { id, casaIniciadora, url, documentos } ou null
 * (sigla sem numeração única, matéria que o Senado não tem, ou ementa sem relação com a da Câmara).
 */
async function senadoApoioDaMateria({ sigla, numero, ano, ementa = '' } = {}, fetchJson) {
  const sg = String(sigla || '').toUpperCase();
  if (!senadoTemSigla(sg) || !/^\d+$/.test(String(numero || '')) || !/^\d{4}$/.test(String(ano || ''))) return null;
  const lista = await fetchJson(`${SENADO_API}/processo?sigla=${encodeURIComponent(sg)}&numero=${Number(numero)}&ano=${ano}`);
  const esperado = `${sg} ${Number(numero)}/${ano}`;
  const hits = (Array.isArray(lista) ? lista : []).filter(x => x && String(x.identificacao || '').replace(/\s+/g, ' ').trim().toUpperCase() === esperado);
  const h = hits.find(x => { const m = senadoMesmaMateria(ementa, x.ementa); return m.indefinido || m.parecida; });
  if (!h) return null;
  const docs = await fetchJson(`${SENADO_API}/processo/documento?idProcesso=${h.id}`);
  return { id: h.id, casaIniciadora: String(h.casaIdentificadora || '').trim(), url: h.codigoMateria ? `https://www25.senado.leg.br/web/atividade/materias/-/materia/${h.codigoMateria}` : '', documentos: senadoDocumentosDeApoio(docs) };
}

/** Último andamento registrado: { data: 'dd/mm/aaaa', texto }. */
function senadoUltimoAndamento(detalhe) {
  const informes = (detalhe?.autuacoes || []).flatMap(a => a.informesLegislativos || []).filter(i => i && i.descricao);
  if (!informes.length) return null;
  const u = informes.slice().sort((x, y) => String(y.data || '').localeCompare(String(x.data || '')))[0];
  return { data: _senDataBR(u.data), texto: String(u.descricao).replace(/\s+/g, ' ').trim().slice(0, 320) };
}

/**
 * Consulta o Senado. fetchJson(url) → objeto (lança em erro de rede).
 * Devolve null quando o Senado respondeu e não tem a matéria; lança quando não conseguiu consultar.
 * { id, codigoMateria, identificacao, ementa, autor, apelido, situacao, dataSituacao, tramitando, casaIniciadora,
 *   ultimoAndamento, documentos: [{ tipo, rotulo, url, data, doSenado }], url, consultadoEm, avisos: [] }
 */
async function senadoBuscar({ sigla, numero, ano } = {}, fetchJson) {
  const sg = String(sigla || '').toUpperCase();
  if (!senadoTemSigla(sg) || !/^\d+$/.test(String(numero || '')) || !/^\d{4}$/.test(String(ano || ''))) return null;
  const lista = await fetchJson(`${SENADO_API}/processo?sigla=${encodeURIComponent(sg)}&numero=${Number(numero)}&ano=${ano}`);
  const esperado = `${sg} ${Number(numero)}/${ano}`;
  const hits = (Array.isArray(lista) ? lista : []).filter(x => x && String(x.identificacao || '').replace(/\s+/g, ' ').trim().toUpperCase() === esperado);
  if (!hits.length) return null;
  const h = hits.find(x => /^sim$/i.test(x.tramitando || '')) || hits[0];
  const avisos = [];
  let detalhe = null, docs = [];
  try { detalhe = await fetchJson(`${SENADO_API}/processo/${h.id}`); } catch (e) { avisos.push(`andamento não lido no Senado (${e.message})`); }
  try { docs = await fetchJson(`${SENADO_API}/processo/documento?idProcesso=${h.id}`); } catch (e) { avisos.push(`documentos não lidos no Senado (${e.message})`); }
  const documentos = senadoEscolherDocumentos(docs);
  // sem a lista de documentos, sobra o texto inicial que vem na própria busca
  if (!documentos.length && h.urlDocumento) documentos.push({ tipo: 'INTEIRO_TEOR', rotulo: `Texto inicial no Senado (${h.autoria || 'autor não informado'}${h.dataApresentacao ? ', de ' + _senDataBR(h.dataApresentacao) : ''})`, url: _senUrl(h.urlDocumento), data: String(h.dataApresentacao || '').slice(0, 10), doSenado: true });
  return {
    id: h.id, codigoMateria: h.codigoMateria || detalhe?.codigoMateria || null, identificacao: esperado,
    ementa: String(h.ementa || detalhe?.conteudo?.ementa || '').replace(/\s+/g, ' ').trim(),
    autor: String(h.autoria || detalhe?.documento?.resumoAutoria || '').trim(), apelido: String(h.apelido || '').trim(),
    situacao: String(h.situacaoAtual || detalhe?.situacaoAtual || '').trim(), dataSituacao: _senDataBR(h.dataSituacaoAtual || detalhe?.dataSituacaoAtual),
    tramitando: /^sim$/i.test(h.tramitando || ''), casaIniciadora: String(detalhe?.siglaCasaIniciadora || h.casaIdentificadora || '').trim(),
    ultimoAndamento: senadoUltimoAndamento(detalhe), documentos,
    url: h.codigoMateria ? `https://www25.senado.leg.br/web/atividade/materias/-/materia/${h.codigoMateria}` : '',
    consultadoEm: new Date().toISOString(), avisos,
  };
}

/** Uma linha sobre a matéria no Senado, para o card e para o bot. */
function senadoResumo(sen) {
  if (!sen) return '';
  const sit = sen.situacao ? sen.situacao.charAt(0) + sen.situacao.slice(1).toLowerCase() : '';
  return [`No Senado${sen.autor ? `, de ${sen.autor}` : ''}`, sit ? `situação: ${sit}${sen.dataSituacao ? ` (${sen.dataSituacao})` : ''}` : '', sen.ultimoAndamento ? `último andamento, em ${sen.ultimoAndamento.data}: ${sen.ultimoAndamento.texto}` : ''].filter(Boolean).join(' · ');
}

/** Instrução que acompanha os documentos do Senado na análise. */
function senadoInstrucao(sen, identificacao) {
  if (!sen || !(sen.documentos || []).length) return '';
  return [
    'DOCUMENTOS DO SENADO FEDERAL.',
    `${identificacao || sen.identificacao} está na pauta do Plenário da Câmara, mas a Câmara ainda não tem registro da proposição: não há, lá, parecer, relator nem tramitação. Os documentos abaixo foram lidos no Senado Federal e são a fonte desta análise:\n${sen.documentos.map(d => `- ${d.rotulo}`).join('\n')}`,
    sen.situacao || sen.ultimoAndamento ? `Situação no Senado${sen.dataSituacao ? ` em ${sen.dataSituacao}` : ''}: ${sen.situacao || 'não informada'}.${sen.ultimoAndamento ? ` Último andamento (${sen.ultimoAndamento.data}): ${sen.ultimoAndamento.texto}` : ''}` : '',
    'No início da nota, em uma frase, diga que ela se baseia em documentos do Senado e que a matéria ainda não foi registrada na Câmara. Se o parecer trouxer substitutivo, é ele o texto a analisar. Se a votação no Senado não estiver concluída (destaques, turno suplementar, emendas pendentes), registre com destaque que o texto ainda pode mudar antes de chegar à Câmara.',
    'Não afirme fatos de tramitação na Câmara nem complete com informação de fora dos documentos o que eles não trazem.',
  ].filter(Boolean).join('\n');
}

/**
 * Texto do aviso do item provisório, conforme o que se sabe.
 * prov: { desde, motivo, senado?, senadoErro?, semSenado?, conferir? }
 */
function provisorioAviso(prov, identificacao) {
  if (!prov) return '';
  const id = identificacao || 'esta proposição';
  const sen = prov.senado;
  if (sen && (sen.documentos || []).length) return `A Câmara ainda não tem registro de ${id}. A matéria está no Senado; a análise usa os documentos de lá (${sen.documentos.length}) e avisa que o texto pode mudar. O vínculo com a Câmara é feito sozinho quando o registro aparecer.`;
  if (sen) return `A Câmara ainda não tem registro de ${id}. O Senado tem a matéria, mas sem documento que sirva à análise: anexe o documento em "Documento próprio" ou aguarde o registro.`;
  if (prov.senadoErro) return `A Câmara ainda não tem registro de ${id}, e a consulta ao Senado falhou (${prov.senadoErro}). Use "Verificar registro" para tentar de novo, ou anexe o documento em "Documento próprio".`;
  const manual = 'Edite os detalhes à mão e entregue o documento em "Documento próprio" para a análise, ou remova o item e inclua de novo quando a proposição for registrada. Se ficar na pauta, o vínculo é feito sozinho quando o registro aparecer.';
  // PRC, MSC, REQ e REC não tramitam no Senado com o mesmo número: não houve o que consultar lá
  if (prov.semSenado) return `A Câmara ainda não tem registro de ${id}, e este tipo de proposição não tramita no Senado. ${manual}`;
  return `A Câmara ainda não tem registro de ${id}, e o Senado também não. Edite os detalhes à mão e entregue o documento em "Documento próprio" para a análise, ou remova o item e inclua de novo quando a proposição for registrada. Se ficar na pauta, o vínculo é feito sozinho quando o registro aparecer.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SENADO_API, SENADO_SIGLAS, SENADO_CENARIO, PROVISORIO_ROTULO, senadoTemSigla, senadoMesmaMateria, senadoEscolherDocumentos, senadoDocumentosDeApoio, senadoApoioDaMateria, senadoUltimoAndamento, senadoBuscar, senadoResumo, senadoInstrucao, provisorioAviso };
}
