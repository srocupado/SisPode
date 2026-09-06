/* ============================================================
   NORMAS — vigência da base normativa de uma nota orçamentária

   POR QUE ISTO EXISTE (caso real, medido em 02/09/2026):

   A nota técnica da Coordenação sobre o PLOA 2023 (PL 32/2022) dizia:
     "É vedada a celebração de instrumentos com valor de repasse inferior a
      R$ 100.000,00 … e … inferior a R$ 250.000,00 para execução de obras e
      serviços de engenharia, com redação dada pelo Art. 9º, incisos IV e V,
      da Portaria Interministerial nº 424 de 2016."

   Quatro anos depois, o Manual de Emendas da LOA 2026 (CMO, 07/11/2025, p.18)
   diz outra coisa:
     "No caso de transferências, observar valores mínimos estabelecidos pela
      LDO e por ato do Executivo. O Substitutivo do PLDO/2026 prevê, para
      convênios e contratos de repasse, R$ 200.000,00 para obras e
      R$ 100.000,00 para demais objetos. Observar art. 10 da LC nº 210/2024."

   Mudaram DUAS coisas: o valor das obras (250 mil → 200 mil) e a própria
   FONTE da regra (a Portaria deixou de ser o fundamento; passou a ser a LDO
   de cada exercício). A Portaria 424/2016 continua existindo — o Manual 2026
   ainda a cita, mas para transferências a entidades privadas sem fins
   lucrativos (p.112). Ou seja: repetir a nota antiga erraria no número E no
   fundamento, e "a portaria foi revogada?" era a pergunta errada.

   Uma nota orçamentária vale para um EXERCÍCIO. Este módulo compara o que a
   nota afirma com o que o documento oficial daquele exercício diz, e acusa a
   diferença — em vez de deixar a regra envelhecer em silêncio dentro de um
   modelo reaproveitado.

   COMO (mesma divisão de trabalho do módulo de Plenário, por decisão de
   projeto): a IA LÊ os documentos e redige; o JS não extrai listas — ele só
   CONFERE o que a nota afirma contra o texto-fonte. Regex que "não pega"
   viraria omissão silenciosa; regex que confere só produz alarme visível.
   ============================================================ */

'use strict';

// Tipos de norma que uma nota orçamentária cita. A ordem importa: "Lei
// Complementar" tem de ser testada antes de "Lei", senão a LC 210/2024 é lida
// como Lei 210/2024 — norma diferente, e a conferência acusaria falso.
const TIPOS_NORMA = [
  { chave: 'LC',        re: 'Lei\\s+Complementar',                                rotulo: 'Lei Complementar' },
  { chave: 'EC',        re: 'Emenda\\s+Constitucional',                           rotulo: 'Emenda Constitucional' },
  { chave: 'PORTARIA',  re: 'Portaria(?:\\s+(?:Interministerial|Conjunta))?(?:\\s+[A-Z/]{2,20})?', rotulo: 'Portaria' },
  { chave: 'IN',        re: 'Instru[çc][ãa]o\\s+Normativa',                       rotulo: 'Instrução Normativa' },
  { chave: 'RESOLUCAO', re: 'Resolu[çc][ãa]o(?:\\s+do\\s+Congresso\\s+Nacional)?', rotulo: 'Resolução' },
  { chave: 'DECRETO',   re: 'Decreto(?:-Lei)?',                                   rotulo: 'Decreto' },
  { chave: 'LEI',       re: 'Lei',                                                rotulo: 'Lei' },
];

/**
 * Normas citadas num texto, normalizadas: { tipo, numero, ano, rotulo, trecho }.
 * Aceita as grafias que aparecem de fato: "LC nº 210/2024", "Lei Complementar
 * nº 210, de 2024", "Portaria Interministerial MP/MF/CGU nº 424, de 30/12/2016",
 * "Decreto nº 11.531, de 16/05/2023".
 */
function extrairNormasCitadas(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const achadas = [];
  const vistas = new Set();

  const abreviadas = { 'LC': 'LC', 'EC': 'EC', 'IN': 'IN' };
  const padroes = [
    // Forma por extenso: "Lei Complementar nº 210, de 2024" / "… 210/2024"
    ...TIPOS_NORMA.map(t0 => ({
      chave: t0.chave, rotulo: t0.rotulo,
      re: new RegExp(`\\b(${t0.re})\\s*(?:n?[º°o]?\\.?\\s*)?(\\d[\\d.]*)\\s*(?:,?\\s*de\\s*)?(?:\\d{2}\\/\\d{2}\\/)?(\\d{4})?`, 'gi'),
    })),
    // Forma abreviada: "LC nº 210/2024", "EC 105/2019", "IN 1/2025"
    ...Object.keys(abreviadas).map(sig => ({
      chave: abreviadas[sig], rotulo: TIPOS_NORMA.find(x => x.chave === abreviadas[sig]).rotulo,
      re: new RegExp(`\\b(${sig})\\s*(?:n?[º°o]?\\.?\\s*)?(\\d[\\d.]*)\\s*[\\/,]?\\s*(?:de\\s*)?(\\d{4})?`, 'g'),
    })),
  ];

  for (const p of padroes) {
    let m;
    while ((m = p.re.exec(t)) !== null) {
      const numero = m[2].replace(/\.$/, '');
      const ano = m[3] || null;
      // "Lei" casa dentro de "Lei Complementar": descarta o que já foi tomado
      // por um tipo mais específico na MESMA posição.
      const anterior = t.slice(Math.max(0, m.index - 22), m.index);
      if (p.chave === 'LEI' && /complementar\s*$/i.test(anterior)) continue;
      if (p.chave === 'LEI' && /(?:decreto|projeto\s+de)\s*$/i.test(anterior)) continue;
      const id = `${p.chave}:${numero.replace(/\./g, '')}:${ano || ''}`;
      if (vistas.has(id)) continue;
      vistas.add(id);
      achadas.push({
        tipo: p.chave,
        rotulo: `${p.rotulo} nº ${numero}${ano ? '/' + ano : ''}`,
        numero, ano, id,
        trecho: t.slice(Math.max(0, m.index - 90), m.index + 130).trim(),
      });
    }
  }
  return achadas;
}

/** Valores em reais citados no texto, normalizados para número. */
function extrairValores(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const out = [];
  const vistos = new Set();
  const re = /R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const bruto = m[1];
    const n = Number(bruto.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 1000) continue;   // centavos e números curtos: ruído
    if (vistos.has(bruto)) continue;
    vistos.add(bruto);
    out.push({ bruto, valor: n, texto: `R$ ${bruto}`, trecho: t.slice(Math.max(0, m.index - 110), m.index + 120).trim() });
  }
  return out;
}

/**
 * Confere a nota contra o documento normativo DO EXERCÍCIO (tipicamente o
 * Manual de Emendas da CMO daquele ano). Devolve o que a nota afirma e a fonte
 * NÃO confirma — sem nunca "corrigir" sozinha: a decisão é do analista.
 *
 *   { normas:  { confirmadas: [...], naoConfirmadas: [...] },
 *     valores: { confirmados: [...], naoConfirmados: [...] },
 *     alertas: ['⚠ …'] }
 *
 * Fonte curta ou ilegível não gera alarme: não se acusa divergência sem ter
 * conseguido ler a fonte (mesma regra de validarReferencias no módulo de Plenário).
 */
function conferirContraFonte(textoNota, textoFonte, opcoes = {}) {
  const rotuloFonte = opcoes.rotuloFonte || 'documento do exercício';
  const vazio = { normas: { confirmadas: [], naoConfirmadas: [] }, valores: { confirmados: [], naoConfirmados: [] }, alertas: [], conferido: false };
  if (!textoFonte || textoFonte.length < 500) {
    return { ...vazio, motivo: `Fonte indisponível ou ilegível (${rotuloFonte}) — nada foi conferido.` };
  }

  const fonte = String(textoFonte).replace(/\s+/g, ' ');
  const normasFonte = new Set(extrairNormasCitadas(fonte).map(n => `${n.tipo}:${n.numero.replace(/\./g, '')}`));
  const valoresFonte = new Set(extrairValores(fonte).map(v => v.bruto.replace(/\./g, '')));

  const normas = { confirmadas: [], naoConfirmadas: [] };
  for (const n of extrairNormasCitadas(textoNota)) {
    (normasFonte.has(`${n.tipo}:${n.numero.replace(/\./g, '')}`) ? normas.confirmadas : normas.naoConfirmadas).push(n);
  }

  const valores = { confirmados: [], naoConfirmados: [] };
  for (const v of extrairValores(textoNota)) {
    (valoresFonte.has(v.bruto.replace(/\./g, '')) ? valores.confirmados : valores.naoConfirmados).push(v);
  }

  const alertas = [
    ...normas.naoConfirmadas.map(n => `⚠ ${n.rotulo} — citada na nota, não localizada no ${rotuloFonte}. Confirme se ainda é o fundamento vigente.`),
    ...valores.naoConfirmados.map(v => `⚠ ${v.texto} — valor citado na nota, não localizado no ${rotuloFonte}. Confirme antes de divulgar.`),
  ];
  return { normas, valores, alertas, conferido: true, rotuloFonte };
}

/**
 * Compara as âncoras normativas de DOIS exercícios — é o que responde
 * "o que mudou desde a nota do ano passado?". Trabalha sobre os documentos
 * (Manual de Emendas de cada ano), não sobre as notas.
 *
 * Devolve o que saiu, o que entrou e o que permaneceu, para que a nota nova
 * nunca herde regra do exercício anterior sem que alguém tenha olhado.
 */
function compararExercicios(textoAnterior, textoAtual, opcoes = {}) {
  const rotuloAnterior = opcoes.rotuloAnterior || 'exercício anterior';
  const rotuloAtual    = opcoes.rotuloAtual    || 'exercício atual';
  if (!textoAnterior || !textoAtual || textoAnterior.length < 500 || textoAtual.length < 500) {
    return { comparado: false, motivo: 'Um dos documentos não pôde ser lido — comparação não realizada.', saíram: [], entraram: [], permaneceram: [] };
  }
  const antes = extrairNormasCitadas(textoAnterior);
  const agora = extrairNormasCitadas(textoAtual);
  const chave = n => `${n.tipo}:${n.numero.replace(/\./g, '')}`;
  const setAntes = new Set(antes.map(chave));
  const setAgora = new Set(agora.map(chave));

  return {
    comparado: true, rotuloAnterior, rotuloAtual,
    saíram:      antes.filter(n => !setAgora.has(chave(n))),
    entraram:    agora.filter(n => !setAntes.has(chave(n))),
    permaneceram: agora.filter(n => setAntes.has(chave(n))),
  };
}

/**
 * Resumo pronto para a nota: uma frase por achado, na ordem de gravidade.
 * Vazio significa "conferido e sem divergência" — diferente de "não conferido",
 * que precisa aparecer com todas as letras.
 */
function resumoConferencia(res) {
  if (!res || !res.conferido) return [res?.motivo || 'Conferência normativa não realizada.'];
  if (!res.alertas.length) {
    const n = res.normas.confirmadas.length, v = res.valores.confirmados.length;
    return [`✓ Conferência normativa: ${n} norma(s) e ${v} valor(es) citados foram localizados no ${res.rotuloFonte}.`];
  }
  return res.alertas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TIPOS_NORMA, extrairNormasCitadas, extrairValores,
    conferirContraFonte, compararExercicios, resumoConferencia,
  };
}
