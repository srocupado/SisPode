/* ============================================================
   CMO — leis orçamentárias (LOA, LDO, PPA) no Congresso Nacional

   Fonte única das notas técnicas orçamentárias. As leis orçamentárias não
   tramitam na Câmara nem no Senado isoladamente: são PLN (Projeto de Lei do
   Congresso Nacional), apreciados pela Comissão Mista de Planos, Orçamentos
   Públicos e Fiscalização (CMO). O acervo é do Congresso.

   MEDIDO em 02/09/2026:

   1) Senado, Dados Abertos — identificação da matéria (JSON):
        /dadosabertos/processo?sigla=PLN&ano=AAAA
      devolve os PLN do ano com `apelido` já pronto ("PLOA 2027", "PLDO 2027"),
      ementa, autoria, situacaoAtual, urlDocumento. É por aqui que o módulo
      DESCOBRE a matéria do exercício — nada de número fixo no código.
      (O antigo /materia/... está depreciado desde 18/03/2025; não usar.)

   2) Congresso Nacional — acompanhamento (HTML servido no servidor):
        /web/orcamento/acompanhe/orcamento-anual/-/loa/AAAA/...
        /web/orcamento/acompanhe/diretrizes-orcamentarias/-/ldo/AAAA/...
      com as seções: (raiz) etapas e situação; informacoes/cronograma;
      relatores; etapas/apresentacao-emendas; informacoes/notas-tecnicas.

   O QUE ESTA CAMADA PRECISA ACERTAR — os campos aparecem PROGRESSIVAMENTE,
   conforme a CMO avança. Em 02/09/2026, com o PLOA 2027 recém-chegado
   (PLN 24/2026, 31/08, "AGUARDANDO DESPACHO"), a página de relatores traz o
   presidente da CMO mas "-" no Relator-Geral, e cronograma, emendas, notas
   técnicas e audiências respondem "Conteúdo não disponível". Isso NÃO é erro:
   é o estado da tramitação, e a nota técnica tem de dizê-lo com todas as
   letras. Por isso cada leitura devolve `disponivel: false` + `motivo` em vez
   de vazio mudo, e distingue "ainda não publicado" de "não consegui ler".

   Exposto no escopo global da página (scripts clássicos).
   ============================================================ */

'use strict';

const CN_BASE     = 'https://www.congressonacional.leg.br';
const SENADO_CMO  = 'https://legis.senado.leg.br/dadosabertos';

// Cada lei orçamentária tem sua trilha no portal e seu jeito de se identificar
// no `apelido` do Senado. PPA não é anual: entra pelo apelido, sem trilha por
// exercício (o portal não publica etapas dele por ano).
const LEIS_ORCAMENTARIAS = {
  loa: { rotulo: 'LOA', nome: 'Lei Orçamentária Anual',        trilha: 'orcamento-anual',          apelido: /^PLOA\b/i },
  ldo: { rotulo: 'LDO', nome: 'Lei de Diretrizes Orçamentárias', trilha: 'diretrizes-orcamentarias', apelido: /^PLDO\b/i },
  ppa: { rotulo: 'PPA', nome: 'Plano Plurianual',              trilha: null,                        apelido: /^PPA\b/i },
};

/** URL de uma seção do acompanhamento. `secao` vazia = página do exercício. */
function urlCMO(tipo, ano, secao = '') {
  const t = LEIS_ORCAMENTARIAS[tipo];
  if (!t || !t.trilha) return null;
  const base = `${CN_BASE}/web/orcamento/acompanhe/${t.trilha}/-/${tipo}/${ano}`;
  return secao ? `${base}/${secao}` : base;
}

/** Texto limpo de um nó, com os espaços colapsados. */
function txt(no) {
  return (no?.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * O portal responde 200 com "Conteúdo não disponível" quando a etapa ainda não
 * começou. Tratar isso como página vazia esconderia do analista a diferença
 * entre "a CMO não publicou" e "o portal caiu" — e é justamente essa diferença
 * que a nota técnica precisa registrar.
 */
const SEM_CONTEUDO = /conte[úu]do\s+n[ãa]o\s+dispon[íi]vel/i;

async function htmlCMO(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  return { html, doc: new DOMParser().parseFromString(html, 'text/html') };
}

/** Envelope uniforme: ou tem conteúdo, ou diz por que não tem. */
function semConteudo(motivo, extra = {}) {
  return { disponivel: false, motivo, ...extra };
}

// ============================================================
//  1) Identificação da matéria — Senado, Dados Abertos
// ============================================================

/**
 * Matérias orçamentárias de um exercício, pelo apelido que o Senado já publica
 * ("PLOA 2027", "PLDO 2027"). O ano do ARQUIVO não é o ano do ORÇAMENTO: o
 * PLOA 2027 é o PLN 24/2026, apresentado em 2026. Por isso a busca varre o ano
 * do orçamento e o anterior, e a filtragem é pelo apelido.
 */
async function buscarMateriaOrcamentaria(tipo, anoOrcamento) {
  const t = LEIS_ORCAMENTARIAS[tipo];
  if (!t) throw new Error(`tipo desconhecido: ${tipo}`);
  const alvo = new RegExp(`^${t.rotulo === 'LOA' ? 'PLOA' : t.rotulo === 'LDO' ? 'PLDO' : 'PPA'}\\s*${anoOrcamento}\\b`, 'i');

  for (const anoBusca of [Number(anoOrcamento) - 1, Number(anoOrcamento)]) {
    let lista;
    try {
      const r = await fetch(`${SENADO_CMO}/processo?sigla=PLN&ano=${anoBusca}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      lista = await r.json();
    } catch (e) {
      return semConteudo(`Senado indisponível ao procurar o ${t.rotulo} ${anoOrcamento} (${e.message}).`, { falha: true });
    }
    const m = (Array.isArray(lista) ? lista : []).find(p => alvo.test(String(p.apelido || '')));
    if (m) {
      return {
        disponivel: true,
        tipo, anoOrcamento: String(anoOrcamento),
        apelido:       m.apelido,
        identificacao: m.identificacao,          // "PLN 24/2026"
        ementa:        String(m.ementa || '').trim(),
        autoria:       m.autoria,
        dataApresentacao: m.dataApresentacao,
        situacaoAtual: m.situacaoAtual,
        dataSituacaoAtual: m.dataSituacaoAtual,
        normaGerada:   m.normaGerada || null,    // preenchido quando vira lei
        tramitando:    m.tramitando === 'Sim',
        codigoMateria: m.codigoMateria,
        urlDocumento:  String(m.urlDocumento || '').replace(/^http:\/\//i, 'https://'),
      };
    }
  }
  return semConteudo(`${t.rotulo} ${anoOrcamento} ainda não localizado no Senado (procurado entre os PLN de ${Number(anoOrcamento) - 1} e ${anoOrcamento}).`);
}

// ============================================================
//  2) Acompanhamento — portal do Congresso Nacional
// ============================================================

/**
 * Etapas da tramitação com o estado de cada uma, mais o "último estado" e os
 * documentos anexados. É o campo "Situação" da nota técnica, só que estruturado.
 * As 10 etapas vêm como links para /etapas/<slug>, com o estado na linha seguinte.
 */
async function lerAcompanhamento(tipo, anoOrcamento) {
  const url = urlCMO(tipo, anoOrcamento);
  if (!url) return semConteudo('Este tipo não tem página de acompanhamento por exercício no portal.');
  let doc, html;
  try { ({ doc, html } = await htmlCMO(url)); }
  catch (e) { return semConteudo(`Portal do Congresso indisponível (${e.message}).`, { falha: true }); }

  // As etapas são os links cujo href contém /etapas/ ; o estado é o texto
  // imediatamente seguinte no mesmo bloco.
  const etapas = [];
  for (const a of doc.querySelectorAll('a[href*="/etapas/"]')) {
    const nome = txt(a);
    if (!nome || etapas.some(e => e.nome === nome)) continue;
    const bloco = a.closest('li, tr, div') || a.parentElement;
    let estado = txt(bloco).replace(nome, '').trim();
    if (!estado || estado.length > 40) {
      const irmao = a.parentElement?.nextElementSibling;
      estado = txt(irmao).slice(0, 40);
    }
    etapas.push({ nome, estado, slug: (a.getAttribute('href') || '').split('/etapas/')[1] || '', url: a.getAttribute('href') });
  }

  const corpo = (doc.body?.textContent || '').replace(/ /g, ' ');
  // O portal separa campos por corridas de espaço, não por pontuação: sem cortar
  // em 2+ espaços a situação saía como "AGUARDANDO DESPACHO   Comunicados".
  const mEstado = /Último estado:\s*([\d/]{10})\s*-\s*(.{3,90}?)(?:\s{2,}|$)/i.exec(corpo);
  const mProposta = /Proposta:\s*(PLN\s*\d+\/\d{4})/i.exec(corpo);

  // Documentos anexados (PLN, Quadro Comparativo, pareceres…) — links do
  // sdleg-getter, em ordem cronológica inversa. Um exercício encerrado acumula
  // centenas (a LOA 2026 fechou com ~200): guarda os mais recentes e CONTA o
  // resto, para não inflar o Firebase com a tramitação inteira nem fingir que
  // a lista está completa.
  const TETO_DOCS = 60;
  const documentos = [];
  let totalDocs = 0;
  for (const a of doc.querySelectorAll('a[href*="sdleg-getter"]')) {
    const rotulo = txt(a);
    const href = (a.getAttribute('href') || '').replace(/&amp;/g, '&').replace(/^http:\/\//i, 'https://');
    if (!rotulo || rotulo === 'PDF' || documentos.some(d => d.url === href)) continue;
    totalDocs++;
    if (documentos.length < TETO_DOCS) documentos.push({ rotulo, url: href });
  }

  return {
    disponivel: etapas.length > 0,
    motivo: etapas.length ? null : 'A página do exercício não trouxe as etapas da tramitação.',
    url,
    proposta: mProposta ? mProposta[1].replace(/\s+/g, ' ') : null,
    ultimoEstado: mEstado ? { data: mEstado[1], descricao: mEstado[2].trim() } : null,
    etapas,
    documentos,
    documentosOmitidos: Math.max(0, totalDocs - documentos.length),
    etapaAtual: etapas.find(e => /em andamento/i.test(e.estado)) || null,
  };
}

/**
 * Cronograma de tramitação — é daqui que sai o PRAZO DE EMENDAS, o dado mais
 * consultado da nota. Vem como itens numerados com faixa de datas.
 * Enquanto a CMO não aprova o cronograma, a página responde "Conteúdo não
 * disponível" e o prazo simplesmente NÃO EXISTE — nunca se estima pelo ano anterior.
 */
async function lerCronograma(tipo, anoOrcamento) {
  const url = urlCMO(tipo, anoOrcamento, 'informacoes/cronograma');
  if (!url) return semConteudo('Este tipo não tem cronograma por exercício no portal.');
  let doc;
  try { ({ doc } = await htmlCMO(url)); }
  catch (e) { return semConteudo(`Portal do Congresso indisponível (${e.message}).`, { falha: true }); }

  const corpo = (doc.body?.textContent || '').replace(/ /g, ' ');
  if (SEM_CONTEUDO.test(corpo)) {
    return semConteudo('A CMO ainda não publicou o cronograma de tramitação deste exercício.', { url });
  }

  // O portal entrega o cronograma inteiro numa ÚNICA linha:
  //   "1. Publicação em avulso eletrônico 16/10/2025 a 17/10/2025 2. Realização
  //    de Audiências Públicas 21/10/2025 a 21/10/2025 3. Apresentação de …"
  // Casar "número + descrição + faixa de datas" exige impedir que a descrição
  // atravesse a data do item seguinte — daí o tempered greedy. Com um `.*?`
  // simples, 16 itens viravam 8, cada um engolindo o vizinho.
  const texto = corpo.replace(/\s+/g, ' ');
  const itens = [];
  const re = /(\d{1,2})\.\s*((?:(?!\d{2}\/\d{2}\/\d{4}).){5,170}?)\s*(?:de\s+)?(\d{2}\/\d{2}\/\d{4})\s*(?:a|até)\s*(?:de\s+)?(\d{2}\/\d{2}\/\d{4})\s*(?:\(([^)]{1,14})\))?/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const descricao = m[2].replace(/\s+/g, ' ').trim();
    if (!descricao || itens.some(i => i.ordem === parseInt(m[1], 10))) continue;
    itens.push({
      ordem: parseInt(m[1], 10),
      descricao,
      inicio: m[3],
      fim: m[4],
      observacao: (m[5] || '').trim() || null,
    });
  }
  const mPub = /Cronograma\s*\(publicado em\s*(\d{2}\/\d{2}\/\d{4})\)/i.exec(texto);

  const prazoEmendas = itens.find(i => /apresenta[çc][ãa]o\s+de\s+emendas/i.test(i.descricao)
    && !/relat[óo]rio/i.test(i.descricao)) || null;

  return {
    disponivel: itens.length > 0,
    motivo: itens.length ? null : 'O cronograma foi publicado, mas não foi possível interpretar os itens.',
    url, itens, prazoEmendas,
    publicadoEm: mPub ? mPub[1] : null,
  };
}

/** Presidente da CMO, Relator-Geral, Relator da Receita e os setoriais. */
async function lerRelatores(tipo, anoOrcamento) {
  const url = urlCMO(tipo, anoOrcamento, 'relatores');
  if (!url) return semConteudo('Este tipo não tem página de relatores por exercício no portal.');
  let doc;
  try { ({ doc } = await htmlCMO(url)); }
  catch (e) { return semConteudo(`Portal do Congresso indisponível (${e.message}).`, { falha: true }); }

  const corpo = (doc.body?.textContent || '').replace(/ /g, ' ');
  if (SEM_CONTEUDO.test(corpo)) return semConteudo('A CMO ainda não publicou a página de relatores deste exercício.', { url });

  // "Dep. Fulano (PSD/CE)" / "Sen. Beltrana (UNIÃO/TO)". O traço solto ("-")
  // é como o portal marca "ainda não designado" — precisa virar null, não texto.
  const PARLAMENTAR = /(Dep|Sen)\.\s*([^()]{3,60}?)\s*\(([^)]{2,30})\)/;
  // Varre TODAS as ocorrências do rótulo: o menu do portal traz "Cúpula de
  // Presidentes dos Parlamentos do G20", que casava primeiro com "Presidente" e
  // fazia o presidente da CMO sair nulo. Vale o primeiro casamento que de fato
  // resolve um parlamentar.
  const acha = rotulo => {
    const re = new RegExp(rotulo + '\\s*:?\\s*(.{0,90})', 'gi');
    let m;
    while ((m = re.exec(corpo)) !== null) {
      const p = PARLAMENTAR.exec(m[1]);
      if (!p) continue;
      const [partido, uf] = p[3].split('/');
      return { casa: p[1] === 'Dep' ? 'Câmara' : 'Senado', nome: p[2].trim(), partido: (partido || '').trim(), uf: (uf || '').trim() };
    }
    return null;
  };

  const setoriais = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 2) continue;
    const area = txt(tds[0]);
    const p = PARLAMENTAR.exec(txt(tds[1]));
    if (!/^[IVX]+\s*-/.test(area) || !p) continue;
    if (setoriais.some(s => s.area === area)) continue;   // a tabela se repete na página
    const [partido, uf] = p[3].split('/');
    setoriais.push({ area, casa: p[1] === 'Dep' ? 'Câmara' : 'Senado', nome: p[2].trim(), partido: (partido || '').trim(), uf: (uf || '').trim() });
  }

  const presidente = acha('Presidente');
  const geral   = acha('Relator\\s+Geral');
  const receita = acha('Relator\\s+da\\s+Receita');

  // MEDIDO em 03/09/2026: a trilha da LDO NÃO tem página de relatores — o
  // portal devolve 200 com o layout genérico, sem bloco nenhum. Sem esta
  // guarda, a LDO 2026 (exercício ENCERRADO, que teve relator) saía como
  // "página lida, ninguém designado" — uma afirmação falsa sobre a relatoria.
  // "O bloco existe e está vazio" (LOA recém-chegada) é outra coisa, e é o
  // único caso em que cabe falar em pendência de designação.
  const temBloco = /Relatores?\s+d[oae]\s/i.test(corpo) || /Relator\s+Geral/i.test(corpo);
  if (!temBloco && !presidente && !geral && !receita && !setoriais.length) {
    return semConteudo('O portal não publica página de relatores para esta lei/exercício.', { url });
  }

  return {
    disponivel: true,
    url,
    presidenteCMO: presidente,
    relatorGeral:  geral,
    relatorReceita: receita,
    setoriais,
    // O portal escreve "Não há relatores setoriais designados." — dizer isso é
    // informação; devolver lista vazia sem explicar, não.
    pendencias: [
      !geral   ? 'Relator-Geral ainda não designado.' : null,
      !receita ? 'Relator da Receita ainda não designado.' : null,
      !setoriais.length ? 'Relatores setoriais ainda não designados.' : null,
    ].filter(Boolean),
  };
}

/**
 * Documentos da etapa de emendas: Manual de Emendas, Instrução Normativa,
 * portarias ministeriais e cartilhas. O Manual é a ÂNCORA NORMATIVA da nota —
 * é dele que saem cotas, prazos, pisos e a base legal vigente NAQUELE exercício.
 */
async function lerDocumentosEmendas(tipo, anoOrcamento) {
  const url = urlCMO(tipo, anoOrcamento, 'etapas/apresentacao-emendas');
  if (!url) return semConteudo('Este tipo não tem etapa de emendas por exercício no portal.');
  let doc;
  try { ({ doc } = await htmlCMO(url)); }
  catch (e) { return semConteudo(`Portal do Congresso indisponível (${e.message}).`, { falha: true }); }

  const corpo = (doc.body?.textContent || '').replace(/ /g, ' ');
  if (SEM_CONTEUDO.test(corpo)) {
    return semConteudo('A etapa de apresentação de emendas ainda não começou neste exercício.', { url });
  }

  const docs = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const rotulo = txt(a);
    let href = a.getAttribute('href') || '';
    if (!rotulo || rotulo.length > 120) continue;
    if (!/\.pdf|documents\//i.test(href)) continue;
    if (href.startsWith('/')) href = CN_BASE + href;
    if (docs.some(d => d.url === href)) continue;
    const classe = /manual\s+de\s+emendas/i.test(rotulo) ? 'manual'
      : /instru[çc][ãa]o\s+normativa/i.test(rotulo)      ? 'instrucao_normativa'
      : /portaria/i.test(rotulo)                          ? 'portaria'
      : /cartilha/i.test(rotulo)                          ? 'cartilha'
      : 'outro';
    docs.push({ rotulo, url: href, classe });
  }
  return {
    disponivel: docs.length > 0,
    motivo: docs.length ? null : 'A etapa está aberta, mas nenhum documento foi localizado.',
    url,
    manual: docs.find(d => d.classe === 'manual') || null,
    documentos: docs,
  };
}

/** Notas técnicas e estudos das consultorias (CONOF/CD e CONORF/SF). */
async function lerNotasTecnicas(tipo, anoOrcamento) {
  const url = urlCMO(tipo, anoOrcamento, 'informacoes/notas-tecnicas');
  if (!url) return semConteudo('Este tipo não tem página de notas técnicas por exercício no portal.');
  let doc;
  try { ({ doc } = await htmlCMO(url)); }
  catch (e) { return semConteudo(`Portal do Congresso indisponível (${e.message}).`, { falha: true }); }

  const corpo = (doc.body?.textContent || '').replace(/ /g, ' ');
  if (SEM_CONTEUDO.test(corpo)) {
    return semConteudo('As consultorias ainda não publicaram notas técnicas para este exercício.', { url });
  }
  // Duas grafias, MEDIDAS em 03/09/2026: a LOA lista "19/02/2026 - Raio-X da
  // LOA 2026" e a LDO lista só o título ("Nota Técnica Conjunta nº 4/2025 -
  // CONORF/SF - CONOF/CD - Subsídios…"). Exigir a data descartava as três
  // notas da LDO em silêncio, e a tela dizia que não havia nenhuma.
  const notas = [];
  const ASSUNTO = /nota\s+t[ée]cnica|informativo|raio[\s-]?x|estudo|subs[íi]dios|considera[çc][õo]es/i;
  for (const a of doc.querySelectorAll('a[href]')) {
    const rotulo = txt(a);
    if (!rotulo || rotulo.length < 18 || rotulo.length > 300) continue;
    let href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) continue;
    // Uma nota aponta para um DOCUMENTO (/documents/…, .pdf, sdleg-getter);
    // "Estudos orçamentários" no menu lateral aponta para /web/orcamento/… e
    // casava com a busca por assunto, entrando na lista como se fosse nota.
    if (!/\/documents\/|\.pdf|sdleg-getter/i.test(href)) continue;
    if (href.startsWith('/')) href = CN_BASE + href;
    if (notas.some(n => n.url === href)) continue;
    const m = /^(\d{2}\/\d{2}\/\d{4})\s*-\s*(.+)$/.exec(rotulo);
    if (m) notas.push({ data: m[1], titulo: m[2].trim(), url: href });
    else if (ASSUNTO.test(rotulo)) notas.push({ data: null, titulo: rotulo, url: href });
  }
  return {
    disponivel: notas.length > 0,
    motivo: notas.length ? null : 'A página existe mas nenhuma nota foi listada.',
    url, notas,
  };
}

/**
 * Quadro completo de um exercício: identificação + acompanhamento + cronograma
 * + relatores + documentos de emendas + notas técnicas. Cada peça declara-se
 * disponível ou não; nenhuma falha derruba as outras.
 */
async function carregarExercicio(tipo, anoOrcamento) {
  const [materia, acompanhamento, cronograma, relatores, emendas, notas] = await Promise.all([
    buscarMateriaOrcamentaria(tipo, anoOrcamento),
    lerAcompanhamento(tipo, anoOrcamento),
    lerCronograma(tipo, anoOrcamento),
    lerRelatores(tipo, anoOrcamento),
    lerDocumentosEmendas(tipo, anoOrcamento),
    lerNotasTecnicas(tipo, anoOrcamento),
  ]);
  const partes = { materia, acompanhamento, cronograma, relatores, emendas, notas };
  return {
    tipo, anoOrcamento: String(anoOrcamento), lidoEm: new Date().toISOString(),
    ...partes,
    // Falha de fonte ≠ etapa não iniciada. Só a primeira pede "tente de novo".
    fontesIndisponiveis: Object.entries(partes)
      .filter(([, v]) => v && v.falha)
      .map(([k, v]) => `${k}: ${v.motivo}`),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEIS_ORCAMENTARIAS, CN_BASE, SENADO_CMO, urlCMO, txt, SEM_CONTEUDO,
    buscarMateriaOrcamentaria, lerAcompanhamento, lerCronograma, lerRelatores,
    lerDocumentosEmendas, lerNotasTecnicas, carregarExercicio,
  };
}
