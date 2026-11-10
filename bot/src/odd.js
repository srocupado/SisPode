'use strict';
// Ordem do Dia (pauta DIÁRIA da sessão) via API de Dados Abertos.
//
// Fonte: /eventos/{id}/pauta — estruturada e rica (ementa + alvo da urgência
// em proposicaoRelacionada_), e canônica: é exatamente o `urlDocumentoPauta`
// do evento. Dispensa descobrir o codteor do PDF ou raspar página.
//
// A ODD vira uma pauta PRÓPRIA no Firebase (id 'odd-YYYY-MM-DD'), coexistindo
// com a semanal. Como é a mais recente por uploadedAt, passa a ser a pauta de
// referência do dia (decisão "diária tem prioridade"). As análises são
// indexadas por chave (SIGLA-NUMERO-ANO), então a ODD reaproveita as notas já
// geradas para os mesmos projetos — sem duplicar trabalho.
//
// CONTINGÊNCIA (10/11/2026: API em 503/504 o dia todo e o bot não puxou a
// pauta): a API tem prazo e novas tentativas; se ainda assim falhar, a sessão
// vem da AGENDA do Plenário no portal e os itens da PÁGINA DA SESSÃO
// (camara.leg.br/evento-legislativo/{id}), que lista a pauta com a ementa, o
// autor e o relator — o mesmo caminho do monitor e da convocação. Falha das
// duas fontes vira ERRO dito como tal (antes virava "não há sessão hoje").
const { montarPautaFirebase, gravarPauta } = require('./pauta');
const PORTAL = require('./comissoes-portal');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const TIMEOUT_API_MS = 20000;
const TENTATIVAS_API = 3;

/** GET na API com prazo e novas tentativas em 429/5xx/tempo esgotado; 4xx não repete. */
async function apiJson(url) {
  let erro = null;
  for (let t = 0; t < TENTATIVAS_API; t++) {
    if (t) await new Promise(r => setTimeout(r, 1000 * t));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_API_MS) });
      if (r.ok) return await r.json();
      erro = new Error(`HTTP ${r.status}`);
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) { erro = e.name === 'TimeoutError' || e.name === 'AbortError' ? new Error(`tempo esgotado (${TIMEOUT_API_MS / 1000}s)`) : e; }
  }
  throw new Error(`API da Câmara: ${erro ? erro.message : 'falhou'}`);
}
const ehDeliberativa = txt => /deliberativa/i.test(txt || '') && !/n[ãa]o\s+deliberativa/i.test(txt || '');

const iso    = d => String(d || '').slice(0, 10);
const paraBR = i => (i ? i.split('-').reverse().join('/') : '');

/** Eventos deliberativos do Plenário (idOrgao=180) numa data ISO. API; se ela falhar, a agenda do portal.
 *  [] = não há sessão; as duas fontes fora = ERRO (não "sem sessão"). */
async function eventosDeliberativos(dataISO) {
  try {
    const j = await apiJson(`${API}/eventos?dataInicio=${dataISO}&dataFim=${dataISO}&idOrgao=180&itens=30`);
    return (j.dados || []).filter(e => ehDeliberativa(e.descricaoTipo));
  } catch (eApi) {
    try {
      const br = encodeURIComponent(dataISO.split('-').reverse().join('/'));
      const html = await PORTAL.baixar(`https://www.camara.leg.br/agenda?dataInicial__proxy=${br}&dataInicial=${br}&dataFinal__proxy=${br}&dataFinal=${br}&categorias=Plen%C3%A1rio`, { fresco: true });
      return PORTAL.parseAgendaPortal(html)
        .filter(e => /plen[áa]rio/i.test(e.orgao) && ehDeliberativa(`${e.tema} ${e.tipo}`))
        .map(e => ({ id: e.id, dataHoraInicio: `${e.data || dataISO}T${e.hora || '00:00'}`, descricaoTipo: e.tipo, descricao: e.tema, situacao: e.situacao, fonte: 'portal' }));
    } catch (ePortal) {
      throw new Error(`${eApi.message}; portal da Câmara: ${ePortal.message.replace(/^portal da Câmara:\s*/, '')}`);
    }
  }
}

/** Item da API → item no formato do parser (mesma forma de parsearPauta). */
function itemDaApi(x) {
  const p = x.proposicao_ || {};
  const rel = x.proposicaoRelacionada_;
  const sigla  = (p.siglaTipo || '').toUpperCase();
  const numero = String(p.numero || '');
  const ano    = String(p.ano || '');
  const ehReq  = /^(REQ|REC)$/.test(sigla);
  // A API usa o plural no tópico: "Redações Finais (RICD, art. 83, I)".
  const ehRF   = /reda[çc](?:[ãa]o|[õo]es)\s+fina(?:l|is)/i.test(`${x.topico || ''} ${x.regime || ''} ${x.titulo || ''}`);
  return {
    ordem:         x.ordem,
    tipoCategoria: ehReq ? 'requerimento' : (ehRF ? 'redacao_final' : 'projeto'),
    sigla, numero, ano,
    ementa:        p.ementa || '',
    autorTexto:    '',                 // a autoria é resolvida pela API (enriquecimento/perguntar)
    apensadosTexto: null,              // apensados são resolvidos pela cadeia da API
    // Mesmo formato do parser da extensão ({ nome, partido, uf, data }): só o
    // nome, como texto, saía na pauta como "Dep. (undefined-undefined)".
    relator:       x.relator?.nome ? { nome: x.relator.nome, partido: x.relator.siglaPartido || '', uf: x.relator.siglaUf || '', data: '' } : null,
    temUrgencia:   !ehReq && /urg[êe]ncia/i.test(x.regime || ''),
    projetoUrgenciado: (ehReq && rel) ? {
      sigla:  (rel.siglaTipo || '').toUpperCase(),
      numero: String(rel.numero || ''),
      ano:    String(rel.ano || ''),
      ementa: rel.ementa || '',
    } : null,
    pareceresComissao: [],
    chave: `${sigla}-${numero}-${ano}`,
  };
}

// Proposição citada na ementa (o alvo da urgência ou do recurso): "Projeto de Lei nº 2.167, de 2026",
// "PL nº 5072 de 2026", "PLP nº 226/2025".
const SIGLAS = { 'projeto de lei complementar': 'PLP', 'projeto de lei': 'PL', 'proposta de emenda à constituição': 'PEC', 'projeto de decreto legislativo': 'PDL', 'medida provisória': 'MPV' };
function alvoDaEmenta(ementa) {
  const t = String(ementa || '').replace(/Projeto de Lei Complementar|Projeto de Lei|Proposta de Emenda [àa] Constitui[çc][ãa]o|Projeto de Decreto Legislativo|Medida Provis[óo]ria/gi,
    m => SIGLAS[m.toLowerCase().replace('a constituicao', 'à constituição').replace('constituicao', 'constituição')] || SIGLAS[m.toLowerCase()] || m);
  const m = /\b(PLP|PEC|PDL|MPV|PRC|PL)\s*n?[º°o.]*\s*([\d.]+)\s*(?:\/|,?\s*de\s+)(\d{4})/i.exec(t);
  return m ? { sigla: m[1].toUpperCase(), numero: m[2].replace(/\./g, ''), ano: m[3], ementa: '' } : null;
}

/** Item da página da sessão (portal) → mesmo formato de itemDaApi. */
function itemDoPortal(i, k) {
  const sigla = i.sigla, ehReq = /^(REQ|REC)$/.test(sigla);
  return {
    ordem:         k + 1,
    tipoCategoria: ehReq ? 'requerimento' : 'projeto',
    sigla, numero: String(i.numero), ano: String(i.ano),
    ementa:        i.ementa || '',
    autorTexto:    (i.autores || []).map(([n, p]) => (p ? `${n} (${p})` : n)).join(', '),
    apensadosTexto: null,
    relator:       i.relator ? { nome: i.relator, partido: i.relPartido || '', uf: '', data: '' } : null,
    temUrgencia:   false,
    projetoUrgenciado: ehReq ? alvoDaEmenta(i.ementa) : null,
    pareceresComissao: [],
    chave: `${sigla}-${i.numero}-${i.ano}`,
  };
}

/** Itens da pauta: API; se ela falhar, a página da sessão no portal. */
async function itensDaPauta(eventoId) {
  try {
    const j = await apiJson(`${API}/eventos/${eventoId}/pauta`);
    return { itens: (j.dados || []).map(itemDaApi).filter(it => it.sigla && it.numero && it.ano), fonte: 'api' };
  } catch (eApi) {
    try {
      const ev = await PORTAL.pautaEventoPortal(eventoId, { fresco: true });
      return { itens: ev.itens.filter(i => i.sigla && i.numero && i.ano).map(itemDoPortal), fonte: 'portal' };
    } catch (ePortal) {
      throw new Error(`não consegui ler a pauta do evento ${eventoId} — ${eApi.message}; portal da Câmara: ${ePortal.message.replace(/^portal da Câmara:\s*/, '')}`);
    }
  }
}

/**
 * Monta o objeto de pauta da Ordem do Dia de um evento (sem gravar).
 * Retorna { dataISO, parsed, fonte } ou null se a pauta não tiver itens.
 */
async function buscarOrdemDoDia(eventoId, dataISO) {
  const { itens, fonte } = await itensDaPauta(eventoId);
  if (!itens.length) return null;
  return {
    dataISO: iso(dataISO),
    parsed: { titulo: 'Ordem do Dia', periodo: paraBR(iso(dataISO)), tipoPauta: 'odd', itens },
    fonte,
  };
}

/**
 * Importa a Ordem do Dia como pauta 'odd-YYYY-MM-DD' e devolve o doc gravado
 * (ou null se não houver pauta). Namespacing por data mantém a semanal intacta.
 */
async function importarOrdemDoDia({ eventoId, dataISO, uploadedBy }) {
  const odd = await buscarOrdemDoDia(eventoId, dataISO);
  if (!odd) return null;
  const doc = montarPautaFirebase(odd.parsed, uploadedBy || 'bot-monitor', `ordem-do-dia-${odd.dataISO}.pdf`);
  doc.id        = `odd-${odd.dataISO}`;
  doc.tipoPauta = 'odd';
  doc.eventoId  = String(eventoId);
  if (odd.fonte === 'portal') doc.fonte = 'portal';   // API fora: itens lidos da página da sessão
  await gravarPauta(doc);
  return doc;
}

/**
 * Localiza o evento deliberativo do dia e importa sua Ordem do Dia.
 * Retorna { doc } | { vazio:true } | { semSessao:true }.
 */
async function importarOrdemDoDiaDeHoje(dataISO, uploadedBy) {
  const eventos = await eventosDeliberativos(dataISO);
  if (!eventos.length) return { semSessao: true };
  eventos.sort((a, b) => String(b.dataHoraInicio || '').localeCompare(String(a.dataHoraInicio || '')));
  const doc = await importarOrdemDoDia({ eventoId: eventos[0].id, dataISO, uploadedBy });
  return doc ? { doc } : { vazio: true };
}

module.exports = {
  eventosDeliberativos, buscarOrdemDoDia, importarOrdemDoDia, importarOrdemDoDiaDeHoje,
  itemDoPortal, alvoDaEmenta,   // exportados p/ teste
};
