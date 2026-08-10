'use strict';
// /materia — ficha de UMA proposição avulsa, no formato do resumo da Reunião
// de Líderes da extensão (lideres.js). Serve ao analista que, durante a
// reunião, precisa de algo que NÃO entrou na lista: o bot recebe só a
// referência ("PL 1234/2026"), nunca o PDF da lista — ele é complementar à
// extensão, não a substitui.
//
// PORTE DELIBERADAMENTE DUPLICADO de lideres.js (decisão do usuário em
// 11/08/2026, com a consequência assumida): cada módulo vive sozinho, sem
// núcleo comum. Quem corrigir uma regra aqui deve conferir se ela também
// existe lá — e vice-versa.
//
// A mesma divisão de trabalho de lá: o que é FATO vem da fonte por regra
// fixa (situação, relatoria, apensação, parecer, cenário — sai em segundos,
// sem chave de IA); só objetivo, justificativa e "o que mudou" passam pela
// IA, na chave do usuário, com o inteiro teor anexado. Por isso a resposta
// é em duas etapas: os fatos na hora, o resumo da IA em seguida.

require('dns').setDefaultResultOrder('ipv4first');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';
const ANTHROPIC_VER = '2023-06-01';
const MAX_OUT_TOKENS = 4096;
// Acima disto o inteiro teor vai como texto extraído: o corpo em base64
// cresce ~33% e estoura o limite dos provedores.
const MAX_PDF_BYTES  = 8 * 1024 * 1024;
const MAX_TEXTO_TEOR = 120000;

// ============================================================
//  REFERÊNCIA DA PROPOSIÇÃO
// ============================================================
const SIGLAS = 'PL|PLP|PEC|PDL|PDC|PDS|PRC|PLV|PLN|MPV|MSC|PDN|INC|SUG';

/** "PL 1234/2026", "plp230/25", "PL 1234 2026" → { sigla, numero, ano }. */
function parseReferencia(texto) {
  const m = String(texto || '').match(new RegExp(
    `\\b(${SIGLAS})\\s*\\.?\\s*n?[º°.]*\\s*(\\d{1,6})\\s*[\\/\\s]\\s*(\\d{2,4})\\b`, 'i'));
  if (!m) return null;
  let ano = parseInt(m[3], 10);
  if (m[3].length === 2) ano += ano < 50 ? 2000 : 1900;   // "…/25" digitado às pressas
  return { sigla: m[1].toUpperCase(), numero: parseInt(m[2], 10), ano,
           chave: `${m[1].toUpperCase()} ${parseInt(m[2], 10)}/${ano}` };
}

// ============================================================
//  CAMADA FACTUAL (regra fixa, sem IA) — porte de lideres.js
// ============================================================
async function buscarTramitacoes(idCamara) {
  try {
    // Este endpoint NÃO aceita ?ordem/?itens (devolve 400).
    const res = await fetch(`${API_BASE}/proposicoes/${idCamara}/tramitacoes`);
    if (!res.ok) return [];
    return (await res.json()).dados || [];
  } catch (_) { return []; }
}

// ---------- Situação (urgência) ----------
function situacaoDe(trams) {
  const rev = [...trams].reverse();
  const numReq = t => {
    const m = `${t.despacho || ''}`.match(/(?:requerimento|REQ)\.?\s*n?[º°.]*\s*(\d{1,5})\s*\/\s*(\d{4})/i);
    return m ? `${m[1]}/${m[2]}` : null;
  };
  for (const t of rev) {
    const desc = t.descricaoTramitacao || '';
    const desp = t.despacho || '';
    if (/aprova[çc][ãa]o de urg[êe]ncia/i.test(desc) ||
        /aprovad[oa]\s+o\s+requerimento[^.]{0,120}urg[êe]ncia/i.test(desp)) {
      const n = numReq(t);
      return n ? `Urgência aprovada (REQ. ${n})` : 'Urgência aprovada';
    }
  }
  for (const t of rev) {
    const m = (t.despacho || '').match(/Apresenta[çc][ãa]o do REQ n\.?\s*(\d{1,5})\s*\/\s*(\d{4})\s*\(Requerimento de Urg[êe]ncia/i);
    if (m) return `Requerimento de urgência apresentado (REQ n. ${m[1]}/${m[2]})`;
  }
  return 'Não há requerimento de urgência apresentado.';
}

// ---------- Relatoria de Plenário ----------
// Só conta designação feita NO PLENÁRIO: relator de comissão não é relator de
// Plenário, e o statusProposicao guarda o último relator seja de onde for.
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const mesmaPessoa = (a, b) => {
  const na = semAcento(a), nb = semAcento(b);
  return na === nb || na.includes(nb) || nb.includes(na);
};
const formatarPartido = sigla => {
  const s = String(sigla || '').trim();
  return s.length <= 5 ? s : s.charAt(0) + s.slice(1).toLowerCase();
};

async function relatoriaDe(trams, statusProp) {
  let designacao = null;
  for (const t of trams) {
    if (t.siglaOrgao !== 'PLEN') continue;
    if (!/designa[çc][ãa]o de relator/i.test(t.descricaoTramitacao || '')) continue;
    designacao = t;
  }
  if (!designacao) return 'Sem indicação';
  const desp = designacao.despacho || '';
  const m = desp.match(/Dep(?:utad[oa])?\.?\s*([^(,;]+?)\s*\(([^)]+)\)/i);
  const nomeDespacho = m ? m[1].trim() : '';
  const siglaDespacho = m ? m[2].trim().replace(/\s*\/\s*/, '-') : '';
  const uri = statusProp?.uriUltimoRelator;
  if (uri) {
    try {
      const r = await fetch(uri);
      if (r.ok) {
        const d = (await r.json()).dados;
        const nome = d?.ultimoStatus?.nome || d?.nomeCivil || '';
        if (nome && (!nomeDespacho || mesmaPessoa(nome, nomeDespacho))) {
          const partido = formatarPartido(d.ultimoStatus?.siglaPartido || '');
          const uf = d.ultimoStatus?.siglaUf || '';
          return `Dep. ${nome}${partido ? ` (${partido}${uf ? '-' + uf : ''})` : ''}`;
        }
      }
    } catch (_) { /* fica com o despacho */ }
  }
  if (nomeDespacho) return `Dep. ${nomeDespacho}${siglaDespacho ? ` (${siglaDespacho})` : ''}`;
  return desp.trim() || 'Sem indicação';
}

// ---------- Matéria-prima do campo "comissões" ----------
const ORGAOS_NAO_COMISSAO = new Set(['PLEN', 'MESA', 'SGM', 'PR', 'SPL', 'CCP', 'CORD', 'SECGER', 'SECLEG', 'DETAQ']);
function despachosDeComissao(trams, statusProp) {
  const distribuicao = [];
  for (const t of trams) {
    const d = (t.despacho || '').trim();
    if (!d) continue;
    if (/^\s*(À|As|Às)\s+Comiss|^\s*Apense-se|distribu[ií](?:ção|do|da)\s+.{0,40}Comiss/i.test(d)) {
      distribuicao.push(`${(t.dataHora || '').slice(0, 10)} — ${d}`);
    }
  }
  const porOrgao = new Map();
  for (const t of trams) {
    const sig = t.siglaOrgao;
    if (!sig || ORGAOS_NAO_COMISSAO.has(sig)) continue;
    porOrgao.set(sig, `${sig}: ${(t.dataHora || '').slice(0, 10)} — ${t.descricaoTramitacao || ''}${t.despacho ? ' · ' + t.despacho : ''}`);
  }
  return {
    distribuicao: distribuicao.slice(-6),
    comissoes:    [...porOrgao.values()],
    situacaoAtual: [statusProp?.siglaOrgao, statusProp?.descricaoSituacao, statusProp?.despacho]
      .filter(Boolean).join(' · '),
  };
}

// ---------- Principal × apensado, e de quem é a urgência ----------
async function papelDe(detalhe, trams) {
  if (detalhe.uriPropPrincipal) {
    let principal = null;
    try {
      const r = await fetch(detalhe.uriPropPrincipal);
      if (r.ok) {
        const d = (await r.json()).dados;
        principal = `${d.siglaTipo} ${d.numero}/${d.ano}`;
      }
    } catch (_) { /* fica sem o nome */ }
    return { apensada: true, principal };
  }
  const temApensados = trams.some(t =>
    /apensa[çc][ãa]o d/i.test(t.despacho || '') && /a esta proposi/i.test(t.despacho || ''));
  return { apensada: false, temApensados };
}

const NOMES_LONGOS = {
  'projeto de lei complementar': 'PLP', 'projeto de lei': 'PL',
  'proposta de emenda à constituição': 'PEC', 'projeto de decreto legislativo': 'PDL',
};
function propsCitadas(txt) {
  const out = [];
  let m;
  const re1 = /\b(PLP|PL|PEC|PDL|PDC|MPV|PDS|PRC)\s*n?[º°.]*\s*([\d.]{1,7})\s*(?:\/\s*|,?\s*de\s*)(\d{4})\b/gi;
  while ((m = re1.exec(txt))) out.push(`${m[1].toUpperCase()} ${parseInt(m[2].replace(/\./g, ''), 10)}/${m[3]}`);
  const re2 = /\b(Projeto de Lei Complementar|Projeto de Lei|Proposta de Emenda à Constituição|Projeto de Decreto Legislativo)\s*(?:n[º°.]*\s*)?([\d.]{1,7})\s*(?:\/\s*|,?\s*de\s*)(\d{4})\b/gi;
  while ((m = re2.exec(txt))) out.push(`${NOMES_LONGOS[m[1].toLowerCase()]} ${parseInt(m[2].replace(/\./g, ''), 10)}/${m[3]}`);
  return [...new Set(out)];
}

const reqDe = txt => {
  const m = String(txt || '').match(/REQ\.?\s*n?\.?\s*[º°]?\s*(\d{1,5})\s*\/\s*(\d{4})/i);
  return m ? { numero: +m[1], ano: +m[2], rotulo: `REQ ${+m[1]}/${m[2]}` } : null;
};

/** Sem a lista da reunião (que às vezes anota o alvo), a fonte é a ementa do
 *  próprio REQ nos Dados Abertos, que nomeia a proposição pedida. */
async function alvoDoREQ(it) {
  const req = reqDe(it.situacao);
  if (!req) return null;
  let alvos = [];
  try {
    const r = await fetch(`${API_BASE}/proposicoes?siglaTipo=REQ&numero=${req.numero}&ano=${req.ano}&itens=1`);
    if (r.ok) alvos = propsCitadas(((await r.json()).dados?.[0]?.ementa) || '');
  } catch (_) { /* fica sem alvo */ }
  return { ...req, alvos };
}

function frasePapel(it) {
  const p = it.papel;
  if (!p) return '';
  if (p.apensada) return `Apensado ao ${p.principal || 'principal não identificado'}.`;
  return p.temApensados ? 'Principal (com apensados).' : 'Sem apensação.';
}

function fraseUrgenciaREQ(it, req) {
  if (!req) return '';
  if (!req.alvos.length) return `${req.rotulo}: proposição a que se refere não identificada — conferir.`;
  const alvo = req.alvos[0];
  if (alvo === it.chave) return `${req.rotulo} refere-se a este projeto${it.papel?.apensada ? ' (o apensado)' : ''}.`;
  if (it.papel?.principal && alvo === it.papel.principal) return `${req.rotulo} refere-se ao principal (${alvo}).`;
  return `${req.rotulo} refere-se ao ${alvo}.`;
}

// ---------- Documentos relacionados e cenários ----------
// Mesma taxonomia do módulo de Plenário da extensão (analise.js) e da Reunião
// de Líderes: PPP/PRLP/PRLE/SBT/SBT-A/SSP/RDF/AA/EMS/PSS.
const TIPOS_RELACIONADOS = new Set(['PPP', 'PRLP', 'PRLE', 'PRL', 'SBT', 'SBT-A',
                                    'SSP', 'RDF', 'AA', 'EMS', 'PSS']);
const MAX_RELACIONADOS = 30;

async function buscarDocumentosRelacionados(idCamara, sigla) {
  let rel;
  try {
    const r = await fetch(`${API_BASE}/proposicoes/${idCamara}/relacionadas`);
    if (!r.ok) return [];
    rel = (await r.json()).dados || [];
  } catch (_) { return []; }
  // PRL só interessa em PEC (Comissão Especial) — fora daí seriam dezenas de
  // consultas de detalhe por nada.
  const interessa = x => TIPOS_RELACIONADOS.has(x.siglaTipo) && (x.siglaTipo !== 'PRL' || sigla === 'PEC');
  const docs = [];
  for (const d of rel.filter(interessa).slice(0, MAX_RELACIONADOS)) {
    try {
      const r = await fetch(`${API_BASE}/proposicoes/${d.id}`);
      if (!r.ok) continue;
      const det = (await r.json()).dados;
      docs.push({
        tipo:   d.siglaTipo,
        data:   (det.dataApresentacao || det.statusProposicao?.dataHora || '').slice(0, 10),
        orgao:  det.statusProposicao?.siglaOrgao || '',
        ementa: det.ementa || '',
        url:    det.urlInteiroTeor || null,
      });
    } catch (_) { /* um documento a menos */ }
  }
  return docs;
}

const maisNovo = lista => lista.slice().sort((a, b) => (a.data || '').localeCompare(b.data || '')).pop() || null;
const comUrl = lista => lista.filter(d => d.url);
const ehComissaoEspecial = d => /^[A-Z]{2,4}\d{3,}$/.test(d.orgao || '');

const dataBR = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '')
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '');

function relatorDaEmenta(pareceres) {
  for (const p of pareceres) {
    const m = (p.ementa || '').match(/Relator(?:a)?,?\s*Dep\.?\s*([^(,;]+?)\s*\(([^)]+)\)/i);
    if (m) return `Dep. ${m[1].trim()} (${m[2].trim()})`;
  }
  return '';
}

function parecerPlenarioDe(docs) {
  const doPlenario = docs.filter(d => ['PPP', 'PRLP', 'PRLE', 'SBT'].includes(d.tipo) && d.orgao === 'PLEN');
  const pareceres0 = doPlenario.filter(d => d.tipo === 'PPP' || d.tipo === 'PRLP');
  if (!pareceres0.length) return null;
  // Só a leva mais recente: o parecer vem repartido em um documento por
  // comissão, todos do mesmo dia; rodada anterior não descreve o texto de agora.
  const data = maisNovo(pareceres0).data;
  const leva = doPlenario.filter(d => d.data === data);
  const pareceres = leva.filter(d => d.tipo === 'PPP' || d.tipo === 'PRLP');
  return {
    data,
    pareceres,
    proferido: pareceres.some(p => p.tipo === 'PPP'),
    substitutivo: leva.find(d => d.tipo === 'SBT' && d.url) || null,
    relator: relatorDaEmenta(pareceres),
    relatorRotulo: pareceres.some(p => /\bRelatora\b/i.test(p.ementa || '')) ? 'relatora' : 'relator',
    merito: pareceres.find(p => /na forma do substitutivo|pela aprova/i.test(p.ementa) && p.url)
            || comUrl(pareceres).pop() || null,
  };
}

const substitutivoComissaoDe = docs => maisNovo(comUrl(docs.filter(d => d.tipo === 'SBT-A')));
const subemendaDe            = docs => maisNovo(comUrl(docs.filter(d => d.tipo === 'SSP')));

function emendaSenadoDe(docs) {
  const ems = maisNovo(comUrl(docs.filter(d => d.tipo === 'EMS')));
  if (!ems) return null;
  const antes = t => maisNovo(comUrl(docs.filter(d => d.tipo === t && (d.data || '') <= (ems.data || ''))));
  const parecerPos = maisNovo(comUrl(docs.filter(d =>
    (d.tipo === 'PSS' || d.tipo === 'PRLP') && (d.data || '') > (ems.data || ''))));
  return {
    ems,
    autografo: antes('AA'),
    rdf: antes('RDF'),
    parecerPos,
    jaDeliberada: docs.some(d => d.tipo === 'RDF' && (d.data || '') > (ems.data || '')),
  };
}

function textoQueSaiuDaCamara(es) {
  if (es.autografo) return { doc: es.autografo, rotulo: `AUTÓGRAFO — texto aprovado pela Câmara em ${dataBR(es.autografo.data)} e enviado ao Senado` };
  if (es.rdf)       return { doc: es.rdf,       rotulo: `REDAÇÃO FINAL aprovada pela Câmara em ${dataBR(es.rdf.data)} — foi este o texto enviado ao Senado` };
  return null;
}

function fraseDoParecer(pp) {
  if (!pp) return 'Sem parecer proferido em Plenário.';
  const partes = [`Parecer proferido em Plenário em ${dataBR(pp.data)}`];
  if (pp.relator) partes.push(`${pp.relatorRotulo === 'relatora' ? 'pela relatora' : 'pelo relator'} ${pp.relator}`);
  partes.push(pp.substitutivo ? 'com substitutivo adotado' : 'sem substitutivo');
  return partes.join(', ') + '.';
}

function fraseDaEmendaSenado(es) {
  if (!es) return 'Não há emenda do Senado.';
  const saiu = textoQueSaiuDaCamara(es);
  const partes = [`Emenda/Substitutivo do Senado recebido em ${dataBR(es.ems.data)}`];
  partes.push(saiu
    ? `texto que saiu da Câmara: ${es.autografo ? 'autógrafo' : 'redação final'} de ${dataBR(saiu.doc.data)}`
    : 'texto aprovado pela Câmara não localizado — o confronto usa o inteiro teor original');
  if (es.parecerPos) partes.push(`parecer da Câmara à emenda em ${dataBR(es.parecerPos.data)}`);
  if (es.jaDeliberada) partes.push('há redação final POSTERIOR à emenda — conferir se a matéria já foi deliberada');
  return partes.join('; ') + '.';
}

function cenarioDe(it, docs) {
  const tem = t => docs.some(d => d.tipo === t && d.url);
  const especial = comUrl(docs.filter(d => ehComissaoEspecial(d) && (d.tipo === 'PRL' || d.tipo === 'SBT-A' || d.tipo === 'SBT')));
  if (it.sigla === 'PEC' && especial.length) return 9;
  if (it.sigla === 'PDL' || it.sigla === 'PDC') return 10;
  if (tem('EMS')) return emendaSenadoDe(docs)?.parecerPos ? 7 : 6;
  if (tem('SSP')) return 5;
  const sbtUtil = docs.some(d => (d.tipo === 'SBT-A' || (d.tipo === 'SBT' && d.orgao === 'PLEN')) && d.url);
  if ((tem('PRLP') || tem('PPP')) && sbtUtil) return 4;
  if (tem('SBT-A')) return 2;
  if (tem('PRLP') || tem('PRLE') || tem('PPP')) return 3;
  return 1;
}

const NOME_CENARIO = {
  1:  'Cenário 1 — inteiro teor (sem parecer)',
  2:  'Cenário 2 — substitutivo de comissão (SBT-A)',
  3:  'Cenário 3 — parecer de plenário',
  4:  'Cenário 4 — parecer de plenário na forma do substitutivo',
  5:  'Cenário 5 — subemenda substitutiva (SSP)',
  6:  'Cenário 6 — retorno do Senado (EMS)',
  7:  'Cenário 7 — retorno do Senado com parecer da Câmara',
  9:  'Cenário 9 — PEC (parecer da Comissão Especial)',
  10: 'Cenário 10 — PDL (decreto legislativo)',
};

function textoEmVotacao(it) {
  if (!it) return null;
  const pp = it.parecerPlen, es = it.emendaSenado;
  const peca = (doc, rotulo, nome) => doc && doc.url
    ? { doc, rotulo: rotulo(dataBR(doc.data)), nome } : null;
  switch (it.cenario) {
    case 6: case 7:
      return peca(es?.ems, d => `EMENDA/SUBSTITUTIVO DO SENADO recebido em ${d} — é o que voltou e será deliberado`,
                  'Substitutivo do Senado');
    case 5:
      return peca(it.subemenda, d => `SUBEMENDA SUBSTITUTIVA DE PLENÁRIO de ${d} — é ESTE o texto que vai a voto`,
                  'Subemenda substitutiva de Plenário');
    case 4:
      return peca(pp?.substitutivo, () => `SUBSTITUTIVO adotado em Plenário em ${dataBR(pp?.data)} — é ESTE o texto que vai a voto`,
                  'Substitutivo de Plenário')
          || peca(it.sbtComissao, d => `SUBSTITUTIVO adotado por comissão em ${d} — é ESTE o texto que vai a voto`,
                  'Substitutivo de comissão');
    case 2:
      return peca(it.sbtComissao, d => `SUBSTITUTIVO adotado por comissão em ${d} — é ESTE o texto que vai a voto`,
                  'Substitutivo de comissão');
    case 9:
      return peca((it.especial || []).find(d => d.tipo !== 'PRL'),
                  d => `SUBSTITUTIVO adotado pela Comissão Especial em ${d} — é ESTE o texto que vai a voto`,
                  'Substitutivo da Comissão Especial');
    default: return null;
  }
}

// ============================================================
//  A FICHA FACTUAL (etapa 1 — sem IA, sem chave)
// ============================================================
async function montarFicha(referencia) {
  const ref = parseReferencia(referencia);
  if (!ref) throw new Error('Não entendi a proposição. Use, por exemplo: /materia PL 1234/2026');

  const res = await fetch(`${API_BASE}/proposicoes?siglaTipo=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}&itens=1`);
  if (!res.ok) throw new Error(`Dados Abertos indisponíveis (HTTP ${res.status}).`);
  const item = (await res.json()).dados?.[0];
  if (!item) throw new Error(`${ref.chave} não localizada nos Dados Abertos da Câmara.`);

  const it = { ...ref, idCamara: item.id };
  let detalhe = item;
  try {
    const rd = await fetch(`${API_BASE}/proposicoes/${item.id}`);
    if (rd.ok) detalhe = (await rd.json()).dados || item;
  } catch (_) {}
  it.ementa         = detalhe.ementa || item.ementa || '';
  it.descricaoTipo  = detalhe.descricaoTipo || '';
  it.urlInteiroTeor = detalhe.urlInteiroTeor || null;

  try {
    const ra = await fetch(`${API_BASE}/proposicoes/${item.id}/autores`);
    if (ra.ok) it.autores = ((await ra.json()).dados || []).map(a => a.nome).filter(Boolean).slice(0, 6);
  } catch (_) { it.autores = []; }

  const trams = await buscarTramitacoes(item.id);
  it.situacao  = situacaoDe(trams);
  it.relatoria = await relatoriaDe(trams, detalhe.statusProposicao);
  it.despachos = despachosDeComissao(trams, detalhe.statusProposicao);
  it.papel     = await papelDe(detalhe, trams);
  it.apensacao = [frasePapel(it), fraseUrgenciaREQ(it, await alvoDoREQ(it))].filter(Boolean).join('\n');

  const relacionados = await buscarDocumentosRelacionados(item.id, it.sigla);
  it.parecerPlen  = parecerPlenarioDe(relacionados);
  it.emendaSenado = emendaSenadoDe(relacionados);
  it.sbtComissao  = substitutivoComissaoDe(relacionados);
  it.subemenda    = subemendaDe(relacionados);
  it.especial     = it.sigla === 'PEC'
    ? comUrl(relacionados.filter(d => ehComissaoEspecial(d) && ['PRL', 'SBT-A', 'SBT'].includes(d.tipo))) : [];
  it.cenario      = cenarioDe(it, relacionados);
  it.cenarioNome  = NOME_CENARIO[it.cenario] || '';
  it.parecer      = fraseDoParecer(it.parecerPlen);
  it.senado       = fraseDaEmendaSenado(it.emendaSenado);
  if (it.relatoria === 'Sem indicação' && it.parecerPlen?.relator) {
    it.relatoria = `${it.parecerPlen.relator} (parecer de ${dataBR(it.parecerPlen.data)})`;
  }
  return it;
}

// Rótulo em negrito (Markdown do Telegram) e linha em branco entre os tópicos
// — em reunião a ficha é lida em diagonal, não de ponta a ponta.
function formatarFatos(it) {
  const linhas = [
    `📋 *${it.chave}*${it.descricaoTipo ? ` — ${it.descricaoTipo}` : ''}`,
    '',
    `*Autoria:* ${(it.autores || []).join(', ') || 'não informada'}`,
    '',
    `*Ementa:* ${it.ementa || '(sem ementa)'}`,
    '',
    `*Situação:* ${it.situacao}`,
    '',
    `*Apensação:* ${it.apensacao.replace(/\n/g, ' ')}`,
    '',
    `*Relatoria de Plenário:* ${it.relatoria}`,
    '',
    `*Parecer de Plenário:* ${it.parecer}`,
  ];
  if (it.emendaSenado) linhas.push('', `*Emendas do Senado:* ${it.senado}`);
  linhas.push('', `*Ficha na Câmara:* https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${it.idCamara}`);
  return linhas.join('\n');
}

// ============================================================
//  RESUMO POR IA (etapa 2 — na chave do usuário, com as peças anexadas)
// ============================================================
async function baixarPdfCamara(url) {
  try {
    // No servidor não há CORS: o fetch é direto, sem os proxies da extensão.
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const h = new Uint8Array(buf.slice(0, 5));
    if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return buf;
  } catch (_) {}
  return null;
}

async function textoDoPdf(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), verbosity: 0 }).promise;
  let t = '';
  for (let i = 1; i <= doc.numPages && t.length < MAX_TEXTO_TEOR; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    t += c.items.map(x => x.str).join(' ') + '\n';
  }
  return t.slice(0, MAX_TEXTO_TEOR);
}

async function documentoDeUrl(url, rotulo) {
  if (!url) return { doc: null, texto: '' };
  const buf = await baixarPdfCamara(url);
  if (!buf) return { doc: null, texto: '' };
  let texto = '';
  try { texto = await textoDoPdf(buf); } catch (_) { /* PDF só de imagem */ }
  if (buf.byteLength > MAX_PDF_BYTES) {
    return texto ? { doc: { kind: 'text', texto, rotulo }, texto } : { doc: null, texto: '' };
  }
  return { doc: { kind: 'pdf', b64: Buffer.from(buf).toString('base64'), rotulo }, texto };
}

async function reunirDocumentos(it) {
  const docs = [];
  let fonte = '';
  const juntar = ({ doc, texto }) => { if (doc) docs.push(doc); fonte += '\n' + texto; };
  const pp = it.parecerPlen, es = it.emendaSenado;

  const saiu = es && textoQueSaiuDaCamara(es);
  if (saiu) juntar(await documentoDeUrl(saiu.doc.url, `Peça A: ${saiu.rotulo}.`));
  juntar(await documentoDeUrl(it.urlInteiroTeor,
    `Peça ${saiu ? 'A2' : 'A'}: inteiro teor do ${it.chave}, como APRESENTADO pelo autor (traz a justificativa).`));
  const temOriginal = docs.length > 0;

  if (it.cenario === 6 || it.cenario === 7) {
    juntar(await documentoDeUrl(es.ems.url, `Peça B: ${textoEmVotacao(it).rotulo}.`));
    if (es.parecerPos) {
      juntar(await documentoDeUrl(es.parecerPos.url,
        `Peça C: parecer da Câmara às emendas do Senado, de ${dataBR(es.parecerPos.data)} — diz o que o relator ACATA e o que REJEITA.`));
    }
  } else {
    if (pp?.merito) {
      juntar(await documentoDeUrl(pp.merito.url,
        `Peça B: parecer de Plenário de ${dataBR(pp.data)}${pp.relator ? ` ${pp.relatorRotulo === 'relatora' ? 'pela relatora' : 'pelo relator'} ${pp.relator}` : ''}.`));
    }
    const votacao = textoEmVotacao(it);
    if (votacao?.doc) juntar(await documentoDeUrl(votacao.doc.url, `Peça C: ${votacao.rotulo}.`));
    if (it.cenario === 9) {
      for (const d of it.especial.filter(x => x.tipo === 'PRL').slice(-1)) {
        juntar(await documentoDeUrl(d.url, `Peça B: parecer do relator da Comissão Especial, de ${dataBR(d.data)}.`));
      }
    }
  }
  return { docs, fonte: fonte.trim(), temOriginal };
}

const ARTIGO_FEMININO = new Set(['PEC', 'MPV', 'MSC', 'SUG', 'INC', 'PDN']);
const artigoDe = sigla => ARTIGO_FEMININO.has(sigla) ? 'A' : 'O';

const REGRAS_RIGIDAS = `
REGRAS RÍGIDAS (cumprimento obrigatório):
- Baseie-se EXCLUSIVAMENTE nas peças anexadas e nos dados factuais deste prompt. Não recorra a conhecimento prévio.
- Não invente números de lei, artigos, decretos, datas, valores, nomes ou citações. Só mencione um dispositivo se ele aparecer literalmente no material.
- Se o material não trouxer a justificativa do autor, escreva exatamente "Justificativa não consta do inteiro teor disponível." — nunca preencha a lacuna com suposição.
- Não inclua recomendação de voto, juízo de mérito, elogio ou crítica à proposição.
- Responda APENAS com o objeto JSON pedido, sem texto antes ou depois e sem cercas de código.`;

function montarPrompt(it) {
  const d = it.despachos || {};
  const pp = it.parecerPlen;
  const es = it.emendaSenado;
  const votacao = textoEmVotacao(it);
  const autoria = (it.autores || []).join(', ') || 'não informada';

  const blocoParecer = pp ? `

PARECER DE PLENÁRIO — ${dataBR(pp.data)}${pp.relator ? ` · relator ${pp.relator}` : ''}${pp.substitutivo ? ' · COM SUBSTITUTIVO ADOTADO' : ''}
${pp.pareceres.map(p => `· ${p.ementa}`).join('\n')}` : '';

  const blocoSenado = es ? `

RETORNO DO SENADO — ${it.cenarioNome}
${it.senado}
· ${es.ems.ementa}` : '';

  const chaveComparativo = votacao ? `,
  "comparativo": "MUITO BREVE — no máximo 4 itens, cada um com no máximo 20 palavras, separados por ponto e vírgula, tudo numa linha só. Comece por \\"${votacao.nome}: \\" e liste apenas o que esse texto ALTERA, INCLUI ou SUPRIME em relação ao inteiro teor apresentado, usando esses verbos e citando o dispositivo quando couber. Não descreva o que ficou igual e não repita o objetivo. Só afirme mudança que você verifique confrontando as peças anexadas; se o confronto não for possível, escreva exatamente \\"Não foi possível cotejar as peças.\\"${es?.parecerPos ? ' Ao final, acrescente \\" | Parecer da Câmara: \\" e, em até 20 palavras, o que o relator ACATA e o que REJEITA.' : ''}"` : '';

  const chaveParecer = (pp && !es) ? `,
  "parecer": "Uma frase completando o registro do parecer de Plenário: por quais comissões o relator opinou e a conclusão de cada uma. Não repita a data nem o nome do relator, que já constam. Baseie-se apenas nos pareceres acima e nas peças anexadas."` : '';

  return `Você prepara o resumo de uma proposição para a assessoria da Liderança durante a Reunião de Líderes da Câmara dos Deputados.

PROPOSIÇÃO: ${it.chave}
AUTORIA (Dados Abertos): ${autoria}
EMENTA: ${it.ementa || 'não informada'}
SITUAÇÃO ATUAL: ${d.situacaoAtual || 'não informada'}

DESPACHOS DE DISTRIBUIÇÃO REGISTRADOS:
${(d.distribuicao || []).join('\n') || '(nenhum despacho de distribuição a comissões registrado)'}

ANDAMENTO POR COLEGIADO:
${(d.comissoes || []).join('\n') || '(nenhum registro em comissão)'}${blocoParecer}${blocoSenado}

As peças estão anexadas, cada uma precedida de um rótulo que diz o que ela é.

Devolva um JSON com exatamente estas chaves:

{
  "objetivo": "Uma frase única, começando por \\"${artigoDe(it.sigla)} ${it.chave}, de autoria de ${autoria}, tem como objetivo …\\", descrevendo o que a proposição faz NO TEXTO APRESENTADO pelo autor — ignore aqui substitutivos e emendas, que vão em campo separado. Ajuste APENAS as preposições da autoria (de/do/da/dos/das) para a concordância correta, mantendo os nomes exatamente como estão. Cite as leis alteradas pelo nome usual quando houver (ex.: Lei de Responsabilidade Fiscal).",
  "justificativa": "Um parágrafo curto começando por \\"Segundo a justificativa apresentada pelo autor, …\\", resumindo os motivos que o AUTOR da proposição apresenta no inteiro teor original — não os do relator. Se o inteiro teor não contiver justificativa, use a frase de abstenção prevista nas regras.",
  "comissoes": "Uma frase sobre as comissões competentes, indicando quais estão pendentes de parecer, com base APENAS nos despachos e no andamento acima. Se não houver despacho de distribuição registrado, escreva exatamente \\"Aguardando despacho do presidente.\\""${chaveComparativo}${chaveParecer}
}
${REGRAS_RIGIDAS}`;
}

function extrairJSON(texto) {
  const t = String(texto || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch (_) {}
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i >= 0 && f > i) {
    try { return JSON.parse(t.slice(i, f + 1)); } catch (_) {}
  }
  const amostra = t.slice(0, 120).replace(/\s+/g, ' ');
  throw new Error(`resposta da IA não veio em JSON${amostra ? ` — recebido: "${amostra}…"` : ' — resposta vazia'}`);
}

// Conferência de citações (anti-alucinação): lei citada por número no texto
// gerado tem de existir na peça original. Não corrige — marca para revisão.
function validarReferencias(textoGerado, textoFonte) {
  if (!textoFonte || textoFonte.length < 100) return [];
  const numerosFonte = new Set((textoFonte.match(/\d[\d.]*\d|\d/g) || []).map(s => s.replace(/\./g, '')));
  const re = /\b(Lei(?:\s+Complementar|\s+Delegada)?|Decreto(?:-Lei)?|Emenda\s+Constitucional|Medida\s+Provis[óo]ria)\s*(?:n?[º°o]?\.?\s*)?(\d[\d.]+\d|\d{3,})/gi;
  const suspeitas = [];
  const vistos = new Set();
  let m;
  while ((m = re.exec(textoGerado)) !== null) {
    const num = m[2].replace(/\./g, '');
    if (num.length < 4 || vistos.has(num)) continue;
    vistos.add(num);
    if (!numerosFonte.has(num)) suspeitas.push(`${m[1].replace(/\s+/g, ' ')} nº ${m[2].trim()}`);
  }
  return suspeitas;
}

/** Chamada de IA com peças anexadas, nos três provedores, com timeout — uma
 *  conexão pendurada não pode travar a resposta durante a reunião. */
async function chamarIAdocs({ provedor, apiKey, modelo, prompt, docs }) {
  const tentativas = [0, 5000, 15000];
  let ultimo = null;
  for (const espera of tentativas) {
    if (espera) await new Promise(r => setTimeout(r, espera));
    const ctrl = new AbortController();
    const alarme = setTimeout(() => ctrl.abort(), 120000);
    try {
      return await _chamarUmaVez({ provedor, apiKey, modelo, prompt, docs, signal: ctrl.signal });
    } catch (e) {
      ultimo = e;
      if (!/HTTP (429|5\d\d)|abort/i.test(e.message || e.name || '')) throw e;
    } finally { clearTimeout(alarme); }
  }
  throw ultimo || new Error('falhou após as tentativas');
}

async function _chamarUmaVez({ provedor, apiKey, modelo, prompt, docs, signal }) {
  const pedir = async (url, init) => {
    const res = await fetch(url, { ...init, signal });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    return j;
  };

  if (provedor === 'gemini') {
    const parts = [];
    docs.forEach((d, i) => {
      parts.push({ text: `\n\n--- ${d.rotulo || `Documento ${i + 1}`} ---` });
      if (d.kind === 'pdf') parts.push({ inline_data: { mime_type: 'application/pdf', data: d.b64 } });
      else parts.push({ text: d.texto });
    });
    parts.push({ text: prompt });
    const j = await pedir(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUT_TOKENS, responseMimeType: 'application/json' },
      }),
    });
    const cand = j.candidates?.[0];
    if (cand?.finishReason === 'MAX_TOKENS') throw new Error('resposta cortada pelo limite de tokens do modelo');
    return (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  }

  if (provedor === 'anthropic') {
    const content = [];
    docs.forEach((d, i) => {
      content.push({ type: 'text', text: `--- ${d.rotulo || `Documento ${i + 1}`} ---` });
      if (d.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.b64 } });
      else content.push({ type: 'text', text: d.texto });
    });
    content.push({ type: 'text', text: prompt });
    const j = await pedir('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VER },
      body: JSON.stringify({ model: modelo, max_tokens: MAX_OUT_TOKENS, temperature: 0.2, messages: [{ role: 'user', content }] }),
    });
    return (j.content || []).map(c => c.text || '').join('').trim();
  }

  const content = [];
  docs.forEach((d, i) => {
    content.push({ type: 'input_text', text: `--- ${d.rotulo || `Documento ${i + 1}`} ---` });
    if (d.kind === 'pdf') content.push({ type: 'input_file', filename: `documento_${i + 1}.pdf`, file_data: `data:application/pdf;base64,${d.b64}` });
    else content.push({ type: 'input_text', text: d.texto });
  });
  content.push({ type: 'input_text', text: prompt });
  const j = await pedir('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo, input: [{ role: 'user', content }], temperature: 0.2,
      max_output_tokens: MAX_OUT_TOKENS, text: { format: { type: 'json_object' } },
    }),
  });
  if (j.output_text) return j.output_text.trim();
  for (const it of (j.output || [])) for (const c of (it.content || [])) if (c.type === 'output_text' && c.text) return c.text.trim();
  return '';
}

async function resumirFicha(it, perfil) {
  const { docs, fonte, temOriginal } = await reunirDocumentos(it);
  const resposta = await chamarIAdocs({
    provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
    prompt: montarPrompt(it), docs,
  });
  const j = extrairJSON(resposta);

  const objetivo      = String(j.objetivo || '').trim();
  let   justificativa = String(j.justificativa || '').trim();
  const comissoes     = String(j.comissoes || '').trim();
  const comparativo   = String(j.comparativo || '').trim();
  const parecerExtra  = String(j.parecer || '').trim();

  const avisos = [];
  if (!temOriginal) {
    justificativa = 'Justificativa não consta do inteiro teor disponível.';
    avisos.push('Inteiro teor indisponível — resumo feito só com ementa e tramitação.');
  }
  const suspeitas = validarReferencias(`${objetivo} ${justificativa} ${comparativo}`, fonte);
  if (suspeitas.length) avisos.push(`Conferir no original: ${suspeitas.join('; ')}`);

  const linhas = [`🧠 *Resumo — ${it.chave}* (IA na sua chave · ${perfil.provedor}/${perfil.modelo})`,
    '', `*Objetivo:* ${objetivo}`, '', `*Justificativa:* ${justificativa}`];
  if (comparativo) linhas.push('', `*O que mudou:* ${comparativo}`);
  linhas.push('', `*Comissões:* ${comissoes}`);
  if (parecerExtra) linhas.push('', `*Parecer de Plenário:* ${it.parecer} ${parecerExtra}`);
  if (avisos.length) linhas.push('', `⚠ ${avisos.join(' · ')}`);
  return linhas.join('\n');
}

module.exports = { parseReferencia, montarFicha, formatarFatos, resumirFicha };
