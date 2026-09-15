/* ============================================================
   GUIA DE APLICAÇÃO DAS EMENDAS — o que dá para fazer com o dinheiro

   O documento mais consultado por um gabinete na hora de redigir a emenda não
   é o cronograma nem o parecer: é a lista do que cada ação orçamentária
   permite custear. A nota "O QUE PODE SER FEITO COM OS RECURSOS DE EMENDAS
   PARLAMENTARES" da Coordenação é exatamente isso — Ação 2E90 do MAC para
   custeio de média e alta complexidade, 20ZV do MAPA para fomento
   agropecuário, 20JP para esporte e lazer, com o que pode e o que não pode.

   O que este arquivo faz: organiza os documentos que a CMO publica por ÁREA
   TEMÁTICA, casando cada área com o relator setorial designado — inclusive
   marcando quando o relator é da bancada, que é informação de acesso.

   O QUE ELE NÃO FAZ, e é preciso dizer: não resume o conteúdo das cartilhas.
   Resumir "o que pode ser comprado com a ação 2E90" exige ler os documentos, e
   isso é trabalho da camada de IA — que neste módulo ainda não existe. Até lá,
   o guia entrega o índice organizado e diz que o resumo não foi feito, em vez
   de fingir que a lista de links é a informação.

   As 16 áreas temáticas são as do Anexo I da Instrução Normativa nº 01/2023 da
   CMO, e vêm da própria página de relatores — não são fixadas aqui.
   ============================================================ */

'use strict';

const SIGLA_PODEMOS_GUIA = /^PODE(MOS)?$/i;

/** Normaliza "I - Infraestrutura, Minas e Energia" → { numero:'I', nome:'Infraestrutura…' }. */
function partesDaArea(area) {
  const m = /^([IVXLC]+)\s*[-–]\s*(.+)$/.exec(String(area || '').trim());
  return m ? { numero: m[1], nome: m[2].trim() } : { numero: null, nome: String(area || '').trim() };
}

/**
 * Casa cada cartilha com a área temática e o relator setorial.
 *
 * `emendas`   — o que lerDocumentosEmendas devolveu (documentos classificados)
 * `relatores` — o que lerRelatores devolveu (setoriais por área)
 *
 * Devolve uma entrada por ÁREA (todas as que a CMO designou), com as cartilhas
 * que casaram e as que não casaram em `semArea` — porque cartilha perdida é
 * documento que o gabinete não encontra.
 */
function montarGuia(emendas = {}, relatores = {}) {
  const cartilhas = (emendas.documentos || []).filter(d => d.classe === 'cartilha');
  const setoriais = relatores.setoriais || [];

  const usadas = new Set();
  const areas = setoriais.map(s => {
    const { numero, nome } = partesDaArea(s.area);
    // A cartilha é publicada sob o nome do ÓRGÃO ("Ministério de Portos e
    // Aeroportos"), nunca da área — a área é o <strong> que a agrupa no HTML da
    // CMO, e o cmo.js a carrega em `c.area`. Casar pelo número romano do rótulo
    // era buscar no lugar errado: nenhuma das 22 cartilhas da LOA 2026 traz
    // numeral no nome, e todas ficavam órfãs.
    const daArea = cartilhas.filter(c => {
      const bate = (c.area && partesDaArea(c.area).numero === numero)
        || (numero && new RegExp(`(^|\\s)${numero}\\s*[-–]`).test(c.rotulo));
      if (bate) usadas.add(c.url);
      return bate;
    });
    return {
      area: s.area, numero, nome,
      relator: { casa: s.casa, nome: s.nome, partido: s.partido, uf: s.uf,
                 daBancada: SIGLA_PODEMOS_GUIA.test(s.partido) },
      cartilhas: daArea,
    };
  });

  const semArea = cartilhas.filter(c => !usadas.has(c.url));
  return {
    disponivel: areas.length > 0 || cartilhas.length > 0,
    areas,
    semArea,
    totalCartilhas: cartilhas.length,
    areasDaBancada: areas.filter(a => a.relator.daBancada),
    // A ressalva que impede o índice de passar por conteúdo.
    ressalva: cartilhas.length
      ? 'O conteúdo das cartilhas (o que cada ação orçamentária permite custear) não foi resumido: os documentos estão indexados para consulta.'
      : 'A CMO ainda não publicou cartilhas por área temática neste exercício.',
    motivo: areas.length ? null : 'Os relatores setoriais ainda não foram designados — sem eles não há áreas temáticas a organizar.',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { partesDaArea, montarGuia };
}
