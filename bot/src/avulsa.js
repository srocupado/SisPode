'use strict';
// /avulsa — NOTA TÉCNICA de uma proposição FORA da pauta, pedida por um servidor para produzir conteúdo
// técnico avulso para o parlamentar (pedido de 16/11/2026). A nota sai pelo MESMO caminho de um item de
// pauta (o worker abre o painel da extensão e roda o código dele — ver worker.notaAvulsa) e o PDF é o
// institucional, sem índice.
//
// Este módulo só faz a parte do bot: reconhecer o que o servidor mandou — o número ("PL 1234/2025"), o
// link da Câmara ou o PDF da proposição — e resolver na API da Câmara (id, sigla, número, ano, ementa).
// O servidor confirma o que foi identificado antes de gastar a chave dele.

const API = 'https://dadosabertos.camara.leg.br/api/v2';

// Matérias com nota técnica no painel (mérito + MPV). REQ/REC/INC não: a nota avulsa é de proposição.
const SIGLAS_AVULSA = ['PL', 'PLP', 'PEC', 'PDL', 'PRC', 'MPV'];

const NOMES_TIPO = [
  [/PROJETO\s+DE\s+LEI\s+COMPLEMENTAR/i, 'PLP'],
  [/PROPOSTA\s+DE\s+EMENDA\s+[ÀA]\s+CONSTITUI[ÇC][ÃA]O/i, 'PEC'],
  [/PROJETO\s+DE\s+DECRETO\s+LEGISLATIVO/i, 'PDL'],
  [/PROJETO\s+DE\s+RESOLU[ÇC][ÃA]O/i, 'PRC'],
  [/MEDIDA\s+PROVIS[ÓO]RIA/i, 'MPV'],
  [/PROJETO\s+DE\s+LEI/i, 'PL'],
];

/** "PL 1234/2025", "plp 230/25", "PEC nº 45, de 2019" → { sigla, numero, ano }. */
function refDoTexto(texto) {
  const t = String(texto || '');
  const m = t.match(/\b(PLP|PEC|PDL|PRC|MPV|PL)\s*\.?\s*n?[º°.o]*\s*([\d.]{1,7})\s*(?:\/|,?\s*de\s+)\s*(\d{4}|\d{2})\b/i);
  if (!m) return null;
  let ano = parseInt(m[3], 10);
  if (m[3].length === 2) ano += ano < 50 ? 2000 : 1900;
  return { sigla: m[1].toUpperCase(), numero: parseInt(m[2].replace(/\./g, ''), 10), ano };
}

/**
 * O que o servidor escreveu depois do /avulsa: link da Câmara (id da proposição) ou referência.
 * Devolve { id } | { sigla, numero, ano } | null.
 */
function entradaDoTexto(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const id = t.match(/camara\.leg\.br\/(?:proposicoesWeb\/fichadetramitacao\?(?:[^#\s]*&)?idProposicao=|propostas-legislativas\/)(\d{4,9})/i)
          || t.match(/dadosabertos\.camara\.leg\.br\/api\/v2\/proposicoes\/(\d{4,9})/i);
  if (id) return { id: Number(id[1]) };
  if (/^https?:\/\//i.test(t)) return { linkDesconhecido: true };
  return refDoTexto(t);
}

/**
 * A proposição a partir do texto do PDF. Lê só o começo (o cabeçalho): mais adiante, o projeto cita outras
 * leis e proposições. PDF do SENADO não é resolvido pela numeração — o PL do Senado tem número próprio e
 * colidiria com outro PL da Câmara; o bot pede o número na Câmara.
 * Devolve { sigla, numero, ano } | { senado: true } | null.
 */
function refDoPdf(texto) {
  const ini = String(texto || '').replace(/\s+/g, ' ').slice(0, 4000);
  const cab = ini.slice(0, 700);
  if (/SENADO\s+FEDERAL/i.test(cab) && !/C[ÂA]MARA\s+DOS\s+DEPUTADOS/i.test(cab)) return { senado: true };
  const m = ini.match(/(PROJETO\s+DE\s+LEI\s+COMPLEMENTAR|PROPOSTA\s+DE\s+EMENDA\s+[ÀA]\s+CONSTITUI[ÇC][ÃA]O|PROJETO\s+DE\s+DECRETO\s+LEGISLATIVO|PROJETO\s+DE\s+RESOLU[ÇC][ÃA]O|MEDIDA\s+PROVIS[ÓO]RIA|PROJETO\s+DE\s+LEI)\s*N\s*[º°o.]*\s*([\d.]{1,7})(?:\s*-\s*[A-Z])?\s*,?\s*(?:DE\s+\d{1,2}[º°]?\s+DE\s+[A-ZÇ]+\s+)?(?:DE|\/)\s*(\d{4})/i);
  if (m) {
    const sigla = NOMES_TIPO.find(([re]) => re.test(m[1]))[1];
    return { sigla, numero: parseInt(m[2].replace(/\./g, ''), 10), ano: parseInt(m[3], 10) };
  }
  return refDoTexto(ini);
}

async function getJson(url, fetchFn) {
  const r = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Câmara respondeu HTTP ${r.status}`);
  return r.json();
}

/**
 * Resolve na API da Câmara. Devolve { id, sigla, numero, ano, ementa } ou lança erro com mensagem
 * para o servidor (não localizada, tipo sem nota técnica).
 */
async function resolverProposicao(entrada, fetchFn = fetch) {
  let d;
  if (entrada.id) {
    d = (await getJson(`${API}/proposicoes/${entrada.id}`, fetchFn)).dados;
    if (!d) throw new Error('não encontrei essa proposição na Câmara.');
  } else {
    const q = `${API}/proposicoes?siglaTipo=${entrada.sigla}&numero=${entrada.numero}&ano=${entrada.ano}&itens=5`;
    const lista = (await getJson(q, fetchFn)).dados || [];
    if (!lista.length) throw new Error(`não encontrei ${entrada.sigla} ${entrada.numero}/${entrada.ano} na Câmara.`);
    d = (await getJson(`${API}/proposicoes/${lista[0].id}`, fetchFn)).dados || lista[0];
  }
  const sigla = String(d.siglaTipo || '').toUpperCase();
  if (!SIGLAS_AVULSA.includes(sigla)) {
    throw new Error(`${sigla} ${d.numero}/${d.ano} não é um tipo com nota técnica (${SIGLAS_AVULSA.join(', ')}).`);
  }
  return { id: d.id, sigla, numero: Number(d.numero), ano: Number(d.ano), ementa: String(d.ementa || '').replace(/\s+/g, ' ').trim() };
}

const rotuloProp = p => `${p.sigla} ${p.numero}/${p.ano}`;
const chaveProp = p => `${p.sigla}-${p.numero}-${p.ano}`;

module.exports = { SIGLAS_AVULSA, refDoTexto, entradaDoTexto, refDoPdf, resolverProposicao, rotuloProp, chaveProp };
