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
const { montarPautaFirebase, gravarPauta } = require('./pauta');

const API = 'https://dadosabertos.camara.leg.br/api/v2';

const iso    = d => String(d || '').slice(0, 10);
const paraBR = i => (i ? i.split('-').reverse().join('/') : '');

/** Eventos deliberativos do Plenário (idOrgao=180) numa data ISO. */
async function eventosDeliberativos(dataISO) {
  const r = await fetch(`${API}/eventos?dataInicio=${dataISO}&dataFim=${dataISO}&idOrgao=180&itens=30`);
  if (!r.ok) return [];
  return ((await r.json()).dados || [])
    .filter(e => /deliberativa/i.test(e.descricaoTipo || '') && !/n[ãa]o\s+deliberativa/i.test(e.descricaoTipo || ''));
}

/** Item da API → item no formato do parser (mesma forma de parsearPauta). */
function itemDaApi(x) {
  const p = x.proposicao_ || {};
  const rel = x.proposicaoRelacionada_;
  const sigla  = (p.siglaTipo || '').toUpperCase();
  const numero = String(p.numero || '');
  const ano    = String(p.ano || '');
  const ehReq  = /^(REQ|REC)$/.test(sigla);
  const ehRF   = /reda[çc][ãa]o\s+final/i.test(`${x.topico || ''} ${x.regime || ''} ${x.titulo || ''}`);
  return {
    ordem:         x.ordem,
    tipoCategoria: ehReq ? 'requerimento' : (ehRF ? 'redacao_final' : 'projeto'),
    sigla, numero, ano,
    ementa:        p.ementa || '',
    autorTexto:    '',                 // a autoria é resolvida pela API (enriquecimento/perguntar)
    apensadosTexto: null,              // apensados são resolvidos pela cadeia da API
    relator:       x.relator?.nome || null,
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

/**
 * Monta o objeto de pauta da Ordem do Dia de um evento (sem gravar).
 * Retorna { dataISO, parsed } ou null se a pauta não tiver itens.
 */
async function buscarOrdemDoDia(eventoId, dataISO) {
  const r = await fetch(`${API}/eventos/${eventoId}/pauta`);
  if (!r.ok) throw new Error(`HTTP ${r.status} ao ler a pauta do evento ${eventoId}`);
  const itens = ((await r.json()).dados || [])
    .map(itemDaApi)
    .filter(it => it.sigla && it.numero && it.ano);
  if (!itens.length) return null;
  return {
    dataISO: iso(dataISO),
    parsed: { titulo: 'Ordem do Dia', periodo: paraBR(iso(dataISO)), tipoPauta: 'odd', itens },
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
};
