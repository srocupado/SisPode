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
// Ministério do Planejamento e Orçamento: onde o Executivo publica o texto do
// projeto, os volumes e os comparativos de cada exercício. É o lado da FONTE
// do orçamento; o Congresso publica o lado da TRAMITAÇÃO.
const MPO_BASE    = 'https://www.gov.br/planejamento/pt-br/assuntos/orcamento/orcamentos-anuais';
const SENADO_CMO  = 'https://legis.senado.leg.br/dadosabertos';

// Cada lei orçamentária tem sua trilha no portal e seu jeito de se identificar
// no `apelido` do Senado. PPA não é anual: entra pelo apelido, sem trilha por
// exercício (o portal não publica etapas dele por ano).
const LEIS_ORCAMENTARIAS = {
  loa: { rotulo: 'LOA', nome: 'Lei Orçamentária Anual',        trilha: 'orcamento-anual',          apelido: /^PLOA\b/i },
  ldo: { rotulo: 'LDO', nome: 'Lei de Diretrizes Orçamentárias', trilha: 'diretrizes-orcamentarias', apelido: /^PLDO\b/i },
  // O PPA é indexado por QUADRIÊNIO ("2024-2027"), não por exercício, e o
  // Senado apelida o projeto original de "PPPA" — com três Ps, de Projeto de
  // Plano Plurianual. A regex /^PPA\b/ que estava aqui não pegava nem isso nem
  // "Alteração do PPA 2024-2027", que é a forma das revisões.
  ppa: { rotulo: 'PPA', nome: 'Plano Plurianual',              trilha: 'plano-plurianual',          apelido: /^P?PPA\b/i, porPeriodo: true },
};

/**
 * URL de uma seção do acompanhamento. `secao` vazia = página do exercício.
 * `chave` é o ano (LOA/LDO) ou o quadriênio (PPA: "2024-2027").
 */
function urlCMO(tipo, chave, secao = '') {
  const t = LEIS_ORCAMENTARIAS[tipo];
  if (!t || !t.trilha) return null;
  const base = `${CN_BASE}/web/orcamento/acompanhe/${t.trilha}/-/${tipo}/${chave}`;
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
 * URL de documento do Senado no domínio que a extensão pode buscar.
 *
 * MEDIDO em 03/09/2026: o Dados Abertos devolve `urlDocumento` em
 * https://legis.senado.gov.br/sdleg-getter/documento?dm=… — e o manifest só
 * autoriza legis.senado.LEG.br. Da página da extensão, um fetch a domínio sem
 * permissão morre em CORS com "Failed to fetch", que foi exatamente o erro ao
 * ler a Mensagem do PLOA 2027. O sdleg-getter responde igual nos dois
 * domínios (conferido byte a byte no dm=10308047), então a troca é segura.
 */
function urlSenado(url) {
  return String(url || '')
    .replace(/^http:\/\//i, 'https://')
    .replace(/^https:\/\/legis\.senado\.gov\.br\//i, 'https://legis.senado.leg.br/');
}

/**
 * Matérias orçamentárias de um exercício, pelo apelido que o Senado já publica
 * ("PLOA 2027", "PLDO 2027"). O ano do ARQUIVO não é o ano do ORÇAMENTO: o
 * PLOA 2027 é o PLN 24/2026, apresentado em 2026. Por isso a busca varre o ano
 * do orçamento e o anterior, e a filtragem é pelo apelido.
 */
async function buscarMateriaOrcamentaria(tipo, anoOrcamento) {
  const t = LEIS_ORCAMENTARIAS[tipo];
  if (!t) throw new Error(`tipo desconhecido: ${tipo}`);
  // "2024-2027" → o projeto foi apresentado em 2023 e apelidado "PPPA 2024-2027".
  const primeiroAno = Number(String(anoOrcamento).slice(0, 4));
  const alvo = t.porPeriodo
    ? new RegExp(`^P?PPA\\s*${String(anoOrcamento)}\\b`, 'i')
    : new RegExp(`^${t.rotulo === 'LOA' ? 'PLOA' : 'PLDO'}\\s*${anoOrcamento}\\b`, 'i');

  for (const anoBusca of [primeiroAno - 1, primeiroAno]) {
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
        urlDocumento:  urlSenado(m.urlDocumento),
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

  // Documentos anexados — links do sdleg-getter, em ordem cronológica inversa.
  // Um exercício encerrado acumula centenas (a LOA 2026 fechou com 210).
  //
  // Guardar "os 60 mais recentes" era o critério errado, e escondia o melhor
  // conteúdo que o portal oferece. Nesses 210 documentos estão o RELATÓRIO
  // GERAL da CMO (que traz os números finais), os 16 RELATÓRIOS SETORIAIS por
  // área temática e o RELATÓRIO DE DISTRIBUIÇÃO DOS RECURSOS POR BANCADA — que
  // é quanto cada bancada estadual efetivamente recebeu. Ficavam misturados a
  // dezenas de "Ofício" sem título, na mesma lista chapada, e nenhum deles
  // chegava à nota. Classificar é o que permite pôr o que decide na frente.
  const TETO_DOCS = 60;
  const brutos = [];
  const vistos = new Set();
  for (const a of doc.querySelectorAll('a[href*="sdleg-getter"]')) {
    const rotulo = txt(a);
    const href = (a.getAttribute('href') || '').replace(/&amp;/g, '&').replace(/^http:\/\//i, 'https://');
    if (!rotulo || rotulo === 'PDF' || vistos.has(href)) continue;
    vistos.add(href);
    brutos.push({ rotulo, url: href, ...classificarDocTramitacao(rotulo) });
  }
  // O teto agora nunca corta um documento decisivo: eles entram primeiro, e o
  // restante preenche o que sobra da cota.
  const decisivos = brutos.filter(d => d.decisivo);
  const demais = brutos.filter(d => !d.decisivo);
  const documentos = [...decisivos, ...demais.slice(0, Math.max(0, TETO_DOCS - decisivos.length))];

  return {
    disponivel: etapas.length > 0,
    motivo: etapas.length ? null : 'A página do exercício não trouxe as etapas da tramitação.',
    url,
    proposta: mProposta ? mProposta[1].replace(/\s+/g, ' ') : null,
    ultimoEstado: mEstado ? { data: mEstado[1], descricao: mEstado[2].trim() } : null,
    etapas,
    documentos,
    documentosOmitidos: Math.max(0, brutos.length - documentos.length),
    // Atalhos para a nota: é isto que um gabinete procura, e estava enterrado.
    relatorioGeral: decisivos.find(d => d.classe === 'relatorio_geral') || null,
    relatoriosSetoriais: decisivos.filter(d => d.classe === 'relatorio_setorial'),
    distribuicaoBancadas: decisivos.filter(d => d.classe === 'distribuicao'),
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
  // O PPA põe a hora DEPOIS de cada data — "de 07/11/2023 (13h) a 07/11/2023
  // (18h)" —, enquanto a LOA põe só no fim ("a 19/11/2025 (20h)"). Sem aceitar
  // o parêntese entre a primeira data e o "a", os itens do PPA eram descartados.
  // A data inicial às vezes vem SEM O ANO: o cronograma da LOA 2025 escreve
  // "5. Publicação do relatório preliminar de 06/12 (10h02) a 06/12/2024".
  // Exigir dd/mm/aaaa nas duas pontas descartava os itens 5, 6 e 7 daquele
  // exercício EM SILÊNCIO — e o 6 é "Apresentação de emendas ao relatório
  // preliminar", um prazo que sumiria da nota sem deixar rastro. O ano que
  // falta é herdado da outra ponta, que sempre o traz.
  const re = /(\d{1,2})\.\s*((?:(?!\d{2}\/\d{2}).){5,170}?)\s*(?:de\s+)?(\d{2}\/\d{2}(?:\/\d{4})?)\s*(?:\(([^)]{1,14})\))?\s*(?:a|até)\s*(?:de\s+)?(\d{2}\/\d{2}(?:\/\d{4})?)\s*(?:\(([^)]{1,14})\))?/g;
  const comAno = (data, referencia) => {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(data)) return data;
    const ano = String(referencia || '').slice(-4);
    return /^\d{4}$/.test(ano) ? `${data}/${ano}` : data;
  };
  let m;
  while ((m = re.exec(texto)) !== null) {
    const descricao = m[2].replace(/\s+/g, ' ').trim();
    if (!descricao || itens.some(i => i.ordem === parseInt(m[1], 10))) continue;
    itens.push({
      ordem: parseInt(m[1], 10),
      descricao,
      inicio: comAno(m[3], m[5]),
      fim: comAno(m[5], m[3]),
      observacao: [m[4], m[6]].filter(Boolean).map(x => x.trim()).join(' a ') || null,
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
/**
 * Classifica um documento da tramitação pelo rótulo com que o portal o publica.
 *
 * `decisivo` marca o que um gabinete efetivamente procura e o que a nota tem de
 * trazer; os rótulos abaixo são os REAIS, medidos na LOA 2026 em 03/09/2026.
 */
function classificarDocTramitacao(rotulo) {
  const r = String(rotulo || '');
  const setorial = /Relat[óo]rio\s+Setorial\s+d[aoe]s?\s+(.+?)\s*$/i.exec(r);
  if (setorial) {
    // O portal republica versões do mesmo setorial com sufixo ("- Complementação",
    // "- Retificação"). Sem tirá-lo, a mesma área aparece duas vezes na nota,
    // como se fossem duas áreas temáticas distintas.
    const area = setorial[1].replace(/\s*[-–]\s*(Complementa[çc][ãa]o|Retifica[çc][ãa]o|Errata|Anexos?)\s*$/i, '').trim();
    return { classe: 'relatorio_setorial', area, decisivo: true };
  }
  // "Relatório Geral" e "Relatório Geral - Complementação" (e o PAR que o veicula).
  if (/Relat[óo]rio\s+Geral/i.test(r))          return { classe: 'relatorio_geral', decisivo: true };
  if (/distribui[çc][ãa]o\s+dos?\s+recursos/i.test(r)) return { classe: 'distribuicao', decisivo: true };
  if (/Aut[óo]grafo/i.test(r))                  return { classe: 'autografo', decisivo: true };
  if (/Quadro\s+Comparativo/i.test(r))          return { classe: 'quadro_comparativo', decisivo: true };
  if (/^Nota\s+T[ée]cnica/i.test(r))            return { classe: 'nota_tecnica', decisivo: true };
  if (/Relat[óo]rio\s+Legislativo/i.test(r))    return { classe: 'relatorio_legislativo', decisivo: true };
  if (/^Parecer\b|^PAR\s+\d/i.test(r))          return { classe: 'parecer', decisivo: false };
  if (/^Of[íi]cio|^OF[CN.\s]|^Aviso\b|^Of\./i.test(r)) return { classe: 'oficio', decisivo: false };
  if (/^MPCN|^Mensagem/i.test(r))               return { classe: 'mensagem', decisivo: false };
  return { classe: 'outro', decisivo: false };
}

/**
 * A área temática de um link de cartilha: o <strong> do <li> que o envolve.
 *
 *   <li><strong>II - Saúde</strong>
 *     <ul><li><a href="FNS.pdf">Fundo Nacional de Saúde - FNS</a></li></ul></li>
 *
 * Devolve null quando o link não está sob uma área — e null é resposta certa:
 * a cartilha continua listada, só não é atribuída a uma área que não existe.
 */
function areaDoLink(a) {
  for (let el = a.parentElement, n = 0; el && n < 6; el = el.parentElement, n++) {
    if (el.tagName !== 'LI') continue;
    for (const s of el.querySelectorAll('strong, b')) {
      // O rótulo da área nem sempre é filho DIRETO do <li>: a LOA 2026 publica
      // "VII - Turismo" como <span><strong>VII -&nbsp;<strong>Turismo</strong>
      // </strong></span>, e exigir filho direto deixava justamente essa área
      // sem cartilha. Buscar em profundidade resolve, desde que não se atravesse
      // para dentro de um <li> aninhado — que já é outra área.
      let dono = s.parentElement;
      while (dono && dono !== el && dono.tagName !== 'LI') dono = dono.parentElement;
      if (dono !== el) continue;
      const t = txt(s);
      if (/^[IVXLC]+\s*[-–]/.test(t)) return t;
    }
  }
  return null;
}

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
  // A classificação NÃO pode sair só do rótulo do link. Medido em 03/09/2026 na
  // LOA 2026: as 22 cartilhas por área temática são publicadas com o nome do
  // ÓRGÃO ("Ministério de Portos e Aeroportos", "Fundo Nacional de Saúde -
  // FNS") e a palavra "cartilha" aparece uma única vez na página — no título da
  // seção que as agrupa. Classificando pelo rótulo, as 22 caíam em "outro" e o
  // guia de aplicação ficava permanentemente vazio, com as 16 áreas exibindo
  // "sem cartilha publicada" enquanto as cartilhas estavam ali.
  //
  // A ÁREA TEMÁTICA tem a mesma origem: ela é o <strong> do <li> que envolve o
  // link ("I - Infraestrutura, Minas e Energia"), e nunca esteve no rótulo.
  // Percorrer o documento em ordem, guardando o último título visto, é o que
  // dá acesso às duas coisas.
  let secao = '';
  for (const el of doc.querySelectorAll('h1, h2, h3, h4, a[href]')) {
    if (el.tagName !== 'A') { secao = txt(el); continue; }
    const a = el;
    const rotulo = txt(a);
    let href = a.getAttribute('href') || '';
    if (!rotulo || rotulo.length > 120) continue;
    if (!/\.pdf|documents\//i.test(href)) continue;
    if (href.startsWith('/')) href = CN_BASE + href;
    if (docs.some(d => d.url === href)) continue;
    const classe = /manual\s+de\s+emendas/i.test(rotulo) ? 'manual'
      : /instru[çc][ãa]o\s+normativa/i.test(rotulo)      ? 'instrucao_normativa'
      // A LOA 2025 NÃO publicou "Manual de Emendas": a orientação veio partida
      // em "Instruções para elaboração de emendas no LEXOR", formulários e
      // listas. Sem reconhecer essas formas, o exercício ficava sem âncora
      // normativa nenhuma e a conferência não teria contra o que rodar.
      : /instru[çc][õo]es|orienta[çc][õo]es|manual/i.test(rotulo) ? 'orientacao'
      : /portaria/i.test(rotulo)                          ? 'portaria'
      : /cartilha/i.test(rotulo) || /cartilha/i.test(secao) ? 'cartilha'
      : 'outro';
    docs.push({ rotulo, url: href, classe, secao: secao || null, area: areaDoLink(a) });
  }
  return {
    disponivel: docs.length > 0,
    motivo: docs.length ? null : 'A etapa está aberta, mas nenhum documento foi localizado.',
    url,
    // A âncora preferida é o Manual; na falta dele, a orientação publicada.
    manual: docs.find(d => d.classe === 'manual') || null,
    ancoraNormativa: docs.find(d => d.classe === 'manual')
      || docs.find(d => d.classe === 'orientacao')
      || docs.find(d => d.classe === 'instrucao_normativa')
      || null,
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
 * Alterações ao texto do PPA — só ele tem isto, e é a parte VIVA do plano.
 *
 * O PPA é aprovado uma vez por quadriênio, mas o Executivo manda projetos de
 * alteração ao longo dele. MEDIDO em 03/09/2026 no PPA 2024-2027: dois
 * projetos, o PLN 28/2024 já aprovado (Lei 15.060/2024) e o PLN 19/2025 EM
 * TRAMITAÇÃO. Para a bancada, é a alteração em curso que importa — o plano
 * original de 2023 já é norma.
 *
 * Devolve [{ projeto, situacao, ementa, url, normaGerada, normaUrl }].
 */
async function lerAlteracoesPPA(periodo) {
  const url = urlCMO('ppa', periodo);
  if (!url) return semConteudo('Período inválido para o PPA.');
  let doc;
  try { ({ doc } = await htmlCMO(url)); }
  catch (e) { return semConteudo(`Portal do Congresso indisponível (${e.message}).`, { falha: true }); }

  const caixa = doc.querySelector('#collapseAlteracoesLeiOrcamentaria');
  if (!caixa) return semConteudo('O portal não lista alterações ao texto deste PPA.', { url });

  const alteracoes = [];
  for (const tr of caixa.querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 1) continue;
    const linkProj = tds[0].querySelector('a[href]');
    const projeto = txt(linkProj);
    if (!/^PLN\s*\d+\/\d{4}$/i.test(projeto)) continue;
    const badge = txt(tds[0].querySelector('.badge'));
    const ementa = txt(tds[0].querySelector('span:not(.badge):not(.cn-orc-pre-badge)'))
      || txt(tds[0]).replace(projeto, '').replace(badge, '').trim();
    const linkNorma = tds[1] && tds[1].querySelector('a[href]');
    alteracoes.push({
      projeto,
      situacao: badge || null,
      ementa,
      url: linkProj ? linkProj.getAttribute('href') : null,
      normaGerada: linkNorma ? txt(linkNorma) : null,
      normaUrl: linkNorma ? linkNorma.getAttribute('href') : null,
      emTramitacao: /em\s*tramita/i.test(badge || ''),
    });
  }

  // A lei do plano em vigor aparece na mesma página.
  const corpo = (doc.body?.textContent || '').replace(/\u00a0/g, ' ');
  const mLei = /Lei do Plano Plurianual \(PPA\):\s*(LEI\s*[\d/]+)/i.exec(corpo);

  return {
    disponivel: alteracoes.length > 0,
    motivo: alteracoes.length ? null : 'Nenhuma alteração ao texto deste PPA foi listada.',
    url,
    leiDoPlano: mLei ? mLei[1].replace(/\s+/g, ' ').trim() : null,
    alteracoes,
    emTramitacao: alteracoes.filter(a => a.emTramitacao),
  };
}

/**
 * Materiais do Poder Executivo para o exercício (gov.br / MPO).
 *
 * POR QUE ISTO IMPORTA: o portal do Congresso conta a TRAMITAÇÃO; o conteúdo
 * do orçamento — quanto vai para cada órgão, que parâmetros o Governo adotou,
 * o que mudou em relação ao ano anterior — está do lado do Executivo. É esse
 * material que uma nota consegue transformar em informação útil ao gabinete,
 * em vez de relatório de andamento.
 *
 * MEDIDO em 03/09/2026 para o PLOA 2027: a página do exercício oferece Texto
 * da Lei, Volumes 1 a 6 e o Comparativo LOA 2026 × PLOA 2027. A APRESENTAÇÃO
 * e a MENSAGEM PRESIDENCIAL não são publicadas ali como itens próprios — a
 * Mensagem vem DENTRO do PDF do PLN (nas páginas iniciais; no PLN 24/2026 ela
 * ocupa da p.15 à ~250 de 3.235, com os parâmetros macro na p.34, o salário
 * mínimo na p.128 e a Reserva para Emendas na p.137).
 *
 * Os slugs mudam a cada ano ("ploa-2027", "volume1finalrev1ploa2027_momento5…"),
 * então nada é adivinhado: lê-se o índice do ano e seguem-se os links.
 */
async function lerMateriaisExecutivo(tipo, anoOrcamento) {
  const t = LEIS_ORCAMENTARIAS[tipo];
  if (!t || t.porPeriodo) return semConteudo('O Executivo não publica página por exercício para esta lei.');
  const alvo = t.rotulo === 'LOA' ? /projeto de lei or[çc]ament[áa]ria/i : /projeto de lei de diretrizes/i;
  const indice = `${MPO_BASE}/${anoOrcamento}`;

  let doc;
  try { ({ doc } = await htmlCMO(indice)); }
  catch (e) { return semConteudo(`Portal do Ministério do Planejamento indisponível (${e.message}).`, { falha: true }); }

  const linkExercicio = [...doc.querySelectorAll('a[href]')]
    .find(a => alvo.test(txt(a)) && /orcamentos-anuais/i.test(a.getAttribute('href') || ''));
  if (!linkExercicio) {
    return semConteudo(`O Executivo ainda não publicou a página do ${t.rotulo === 'LOA' ? 'PLOA' : 'PLDO'} ${anoOrcamento}.`, { url: indice });
  }
  let url = linkExercicio.getAttribute('href');
  if (url.startsWith('/')) url = 'https://www.gov.br' + url;

  let pagina;
  try { ({ doc: pagina } = await htmlCMO(url)); }
  catch (e) { return semConteudo(`Página do exercício indisponível (${e.message}).`, { falha: true, url }); }

  const documentos = [];
  for (const a of pagina.querySelectorAll('a[href]')) {
    const rotulo = txt(a);
    let href = a.getAttribute('href') || '';
    if (!rotulo || rotulo.length > 90 || !href) continue;
    if (!/orcamentos-anuais/i.test(href)) continue;      // corta o menu do portal
    if (href.startsWith('/')) href = 'https://www.gov.br' + href;
    if (documentos.some(d => d.url === href)) continue;
    const classe = /texto da lei|texto do/i.test(rotulo) ? 'texto_lei'
      : /^volume/i.test(rotulo)                           ? 'volume'
      : /comparativo/i.test(rotulo)                       ? 'comparativo'
      : /apresenta[çc][ãa]o/i.test(rotulo)                ? 'apresentacao'
      : /mensagem/i.test(rotulo)                          ? 'mensagem'
      : /cidad[ãa]o/i.test(rotulo)                        ? 'orcamento_cidadao'
      : 'outro';
    if (classe === 'outro') continue;
    documentos.push({ rotulo, url: href, classe });
  }

  return {
    disponivel: documentos.length > 0,
    motivo: documentos.length ? null : 'A página do exercício existe, mas nenhum documento foi localizado.',
    url,
    documentos,
    textoLei:    documentos.find(d => d.classe === 'texto_lei') || null,
    comparativo: documentos.find(d => d.classe === 'comparativo') || null,
    apresentacao: documentos.find(d => d.classe === 'apresentacao') || null,
    volumes: documentos.filter(d => d.classe === 'volume'),
  };
}


/**
 * O que cada documento do Executivo contém — lido das CAPAS dos volumes do
 * PLOA 2027 (03/09/2026) e da estrutura do art. 9º da LDO. A página do gov.br
 * só diz "Volume 1", "Volume 4 - 2": sem isto o gabinete abre sete PDFs de
 * mil páginas para achar o que procura. O Volume IV é o das emendas à
 * despesa; o Volume I, o dos totais e mínimos constitucionais.
 */
const DESCRICAO_DOCS_EXECUTIVO = [
  { re: /texto d[ao] (lei|projeto)/i,
    o: 'O texto do projeto de lei (os artigos), sem os anexos. É a parte que se altera por emenda de texto.' },
  { re: /comparativo/i,
    o: 'Comparativo, artigo por artigo, entre a lei orçamentária vigente e o projeto: mostra o que muda na redação.' },
  { re: /cidad[ãa]o/i,
    o: 'Orçamento Cidadão: a versão em linguagem simples, com os grandes números, os parâmetros e as prioridades.' },
  { re: /grade de par[âa]metros/i,
    o: 'Grade de parâmetros macroeconômicos usada nas estimativas (PIB, IPCA, Selic, câmbio, salário mínimo).' },
  { re: /cadastro de a[çc][õo]es/i,
    o: 'Cadastro de ações: a descrição de cada ação orçamentária e o que ela financia — é onde se confere a ação certa para a emenda.' },
  { re: /inciso/i,
    o: 'Informações complementares exigidas pela LDO (os incisos indicados), que acompanham o projeto sem integrar a lei.' },
  { re: /sum[áa]rio/i,
    o: 'Sumário das informações complementares.' },
  { re: /^volume\s*(1|i)\b/i,
    o: 'Anexos do projeto de lei, quadros orçamentários consolidados, detalhamento da receita e legislação da receita e da despesa: os totais por órgão, função e fonte, e os mínimos de saúde e educação.' },
  { re: /^volume\s*(2|ii)\b/i,
    o: 'Consolidação dos Programas de Governo: cada programa do PPA com suas ações e valores, sem separar por órgão.' },
  { re: /^volume\s*(3|iii)\b/i,
    o: 'Detalhamento das ações dos órgãos do Poder Legislativo, do TCU, do Poder Judiciário, da DPU e do MPU.' },
  { re: /^volume\s*(4|iv)\b/i,
    o: 'Detalhamento das ações dos órgãos do Poder Executivo — Presidência e Ministérios, exceto o MEC (em dois tomos). É o volume das emendas à despesa: programa, ação, localizador e valor.' },
  { re: /^volume\s*(5|v)\b/i,
    o: 'Detalhamento das ações do Ministério da Educação.' },
  { re: /^volume\s*(6|vi)\b/i,
    o: 'Orçamento de Investimento das empresas estatais: quadros consolidados e detalhamento por empresa.' },
  { re: /^volume/i,
    o: 'Volume do detalhamento do projeto (programação por órgão, programa e ação).' },
];
function descreverDocumentoExecutivo(rotulo) {
  const r = String(rotulo || '').trim();
  const hit = DESCRICAO_DOCS_EXECUTIVO.find(d => d.re.test(r));
  return hit ? hit.o : '';
}

/**
 * Quadro completo de um exercício: identificação + acompanhamento + cronograma
 * + relatores + documentos de emendas + notas técnicas. Cada peça declara-se
 * disponível ou não; nenhuma falha derruba as outras.
 */
async function carregarExercicio(tipo, anoOrcamento) {
  const [materia, acompanhamento, cronograma, relatores, emendas, notas, alteracoes, executivo] = await Promise.all([
    buscarMateriaOrcamentaria(tipo, anoOrcamento),
    lerAcompanhamento(tipo, anoOrcamento),
    lerCronograma(tipo, anoOrcamento),
    lerRelatores(tipo, anoOrcamento),
    lerDocumentosEmendas(tipo, anoOrcamento),
    lerNotasTecnicas(tipo, anoOrcamento),
    tipo === 'ppa' ? lerAlteracoesPPA(anoOrcamento) : Promise.resolve(null),
    lerMateriaisExecutivo(tipo, anoOrcamento),
  ]);
  const partes = { materia, acompanhamento, cronograma, relatores, emendas, notas, executivo,
                   ...(alteracoes ? { alteracoes } : {}) };
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
    LEIS_ORCAMENTARIAS, CN_BASE, SENADO_CMO, urlCMO, urlSenado, txt, SEM_CONTEUDO,
    buscarMateriaOrcamentaria, lerAcompanhamento, lerCronograma, lerRelatores,
    lerDocumentosEmendas, lerNotasTecnicas, lerAlteracoesPPA, lerMateriaisExecutivo, carregarExercicio,
    DESCRICAO_DOCS_EXECUTIVO, descreverDocumentoExecutivo,
  };
}
