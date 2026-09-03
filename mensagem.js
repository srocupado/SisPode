/* ============================================================
   MENSAGEM PRESIDENCIAL — o conteúdo do orçamento em números

   A Mensagem não é publicada como arquivo próprio: vem DENTRO do PDF do
   projeto de lei. No PLN 24/2026 (PLOA 2027) ela ocupa da p.15 à ~250 das
   3.235 — e é lá que estão os parâmetros macroeconômicos (p.34), o salário
   mínimo projetado (p.128), a Reserva para Emendas (p.137) e as tabelas
   comparativas entre exercícios (p.100-120).

   POR QUE ISTO EXISTE: o módulo sabia dizer ONDE o processo está, e não o que
   muda para o gabinete. "O que subiu e o que caiu" é a informação que a nota
   precisa entregar, e ela está nestas tabelas.

   COMO SE PROTEGE DA EXTRAÇÃO SILENCIOSAMENTE INCOMPLETA — que é a objeção
   certa a qualquer regex sobre PDF: as tabelas trazem o PRÓPRIO TOTAL. O
   extrator soma as linhas que conseguiu ler e compara com o total impresso no
   documento. Batendo, a leitura está completa; não batendo, ele DIZ que está
   incompleta e de quanto é a diferença. Nunca devolve uma tabela achando que
   leu tudo — e é essa autoconferência, não a confiança na regex, que torna o
   número publicável.

   Duas formas de tabela, MEDIDAS no PLOA 2027:

   1) POR ÓRGÃO (p.71) — código de cinco dígitos, nome e valor:
        24000 - Ministério da Ciência, Tecnologia e Inovação 323,8
        ...
        Total 24.402,4

   2) COMPARATIVA ENTRE EXERCÍCIOS (p.114-116) — o cabeçalho nomeia as colunas
      e cada linha traz um par (R$ milhões, % PIB) por exercício:
        Realizado 2025 | LOA 2026 | Reprogramação 2026 | PLOA 2027
        R$ milhões % PIB (×4)
        XV.1. Juros e Encargos 363.469,3 2,9 643.939,8 4,7 643.939,8 4,7 826.175,4 5,6
      O rótulo QUEBRA em várias linhas ("XIV.2. Emissão de" / "Títulos"), e é
      preciso remontá-lo — senão metade das linhas sai sem nome.

   Exposto no escopo global da página (scripts clássicos).
   ============================================================ */

'use strict';

/** "1.697,0" → 1697.0 ; "24.402,4" → 24402.4. Devolve null se não for número. */
function numeroBR(s) {
  const t = String(s ?? '').trim();
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Formata para leitura em pt-BR, com o mesmo número de casas do documento. */
function formatarBR(n, casas = 1) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/**
 * Tabela POR ÓRGÃO. Devolve sempre o resultado da autoconferência.
 *
 *   { linhas: [{ codigo, orgao, valor }], total, soma, confere, diferenca, motivo }
 *
 * `confere:false` não invalida as linhas lidas — significa que a leitura está
 * incompleta, e quem exibe precisa dizer isso ao lado do número.
 */
function tabelaPorOrgao(texto) {
  const linhas = [];
  const re = /^(\d{5})\s*[-–]\s*(.+?)\s+(-?[\d.]+,\d+)\s*$/;
  let total = null;
  for (const bruta of String(texto || '').split('\n')) {
    const l = bruta.replace(/\s+/g, ' ').trim();
    const m = re.exec(l);
    if (m) {
      const valor = numeroBR(m[3]);
      if (valor !== null) linhas.push({ codigo: m[1], orgao: m[2].trim(), valor });
      continue;
    }
    const t = /^Total\s+(-?[\d.]+,\d+)\s*$/i.exec(l);
    if (t) total = numeroBR(t[1]);
  }
  if (!linhas.length) return { linhas: [], total, soma: 0, confere: false, motivo: 'Nenhuma linha por órgão localizada.' };

  const soma = linhas.reduce((s, l) => s + l.valor, 0);
  if (total === null) {
    return { linhas, total: null, soma, confere: false,
             motivo: 'A tabela não traz total impresso — não foi possível conferir se a leitura está completa.' };
  }
  // Tolerância de arredondamento: o documento publica uma casa decimal por
  // linha, então a soma pode divergir alguns décimos legitimamente.
  const diferenca = soma - total;
  const confere = Math.abs(diferenca) <= Math.max(1, linhas.length * 0.05);
  return {
    linhas, total, soma, diferenca, confere,
    motivo: confere ? null
      : `A soma das ${linhas.length} linhas lidas (${formatarBR(soma)}) não fecha com o total impresso (${formatarBR(total)}): diferença de ${formatarBR(diferenca)}. A leitura está incompleta.`,
  };
}

/**
 * Tabela COMPARATIVA entre exercícios. O cabeçalho nomeia as colunas; cada
 * linha de dados traz 2 números por coluna (valor e % do PIB).
 *
 *   { exercicios: ['Realizado 2025', …], linhas: [{ rotulo, valores: [{exercicio, valor, pctPIB}] }] }
 */
function tabelaComparativa(texto) {
  const brutas = String(texto || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // O cabeçalho é reconhecido pela linha que repete "R$ milhões % PIB" uma vez
  // por exercício; os nomes das colunas estão logo acima dela.
  let iUnidades = -1, pares = 0;
  for (let i = 0; i < brutas.length; i++) {
    const n = (brutas[i].match(/R\$\s*milh[õo]es\s*%\s*PIB/gi) || []).length;
    if (n >= 2) { iUnidades = i; pares = n; break; }
  }
  if (iUnidades < 0) return { exercicios: [], linhas: [], motivo: 'Cabeçalho de exercícios não identificado nesta página.' };

  let exercicios = [];
  for (let i = iUnidades - 1; i >= 0 && i >= iUnidades - 3; i--) {
    const achados = brutas[i].match(/[A-Za-zçãéóí]+(?:\s+[A-Za-zçãéóí]+)?\s+\d{4}/g);
    if (achados && achados.length >= pares) { exercicios = achados.slice(0, pares); break; }
  }
  if (exercicios.length < 2) return { exercicios: [], linhas: [], motivo: 'Nomes das colunas não identificados.' };

  // A partir daqui, só o corpo da tabela. Tudo acima é cabeçalho de página.
  const corpo = brutas.slice(iUnidades + 1);

  const NUM = '-?[\\d.]+,\\d+';
  const reNumeros = new RegExp(`((?:\\s*${NUM}){${exercicios.length * 2}})\\s*$`);
  // O rótulo de cada linha QUEBRA em várias linhas do PDF, e os pedaços caem
  // antes e depois dos números ("XIV.4. Remuneração" / "das Disponibilidades
  // <números>" / "do Tesouro"). O que delimita uma linha nova é o índice em
  // algarismo romano com que o documento numera as rubricas; sem esse âncora,
  // os pedaços de um rótulo migravam para o vizinho.
  const reInicio = /^[IVXLC]+(?:\.\d+)*\.?\s/;
  const blocos = [];
  for (const l of corpo) {
    if (/^Fonte|^\(\d\)|^Nota/i.test(l)) break;          // rodapé da tabela
    if (reInicio.test(l) || !blocos.length) blocos.push([l]);
    else blocos[blocos.length - 1].push(l);
  }

  const linhas = [];
  for (const bloco of blocos) {
    const comNumeros = bloco.find(l => reNumeros.test(l));
    if (!comNumeros) continue;
    const numeros = reNumeros.exec(comNumeros)[1].trim().split(/\s+/).map(numeroBR);
    if (numeros.some(n => n === null)) continue;
    // O rótulo é tudo o que sobra no bloco, na ordem em que o documento traz.
    const rotulo = bloco
      .map(l => (l === comNumeros ? l.replace(reNumeros, '') : l))
      .join(' ').replace(/\s+/g, ' ').trim();
    if (!rotulo || !reInicio.test(rotulo)) continue;      // sem rubrica identificada, não entra
    linhas.push({
      rotulo,
      valores: exercicios.map((ex, i) => ({ exercicio: ex, valor: numeros[i * 2], pctPIB: numeros[i * 2 + 1] })),
    });
  }
  return { exercicios, linhas, motivo: linhas.length ? null : 'Nenhuma linha de dados localizada.' };
}

/**
 * Variação entre duas colunas da tabela comparativa — é o "o que subiu e o que
 * caiu" que a nota precisa. `de` e `para` casam pelo começo do nome da coluna
 * ("LOA 2026", "PLOA 2027").
 */
function variacaoEntre(tabela, de, para) {
  const idx = alvo => tabela.exercicios.findIndex(e => e.toLowerCase().startsWith(String(alvo).toLowerCase()));
  const i = idx(de), j = idx(para);
  if (i < 0 || j < 0) {
    return { comparado: false, motivo: `Colunas não encontradas (${de} → ${para}). Disponíveis: ${tabela.exercicios.join('; ')}.` };
  }
  const itens = tabela.linhas.map(l => {
    const a = l.valores[i]?.valor, b = l.valores[j]?.valor;
    if (a === null || b === null || a === undefined || b === undefined) return null;
    // Variação percentual não existe quando a base é zero — declara em vez de
    // devolver Infinity, que apareceria na nota como número.
    const pct = a === 0 ? null : ((b - a) / Math.abs(a)) * 100;
    return { rotulo: l.rotulo, de: a, para: b, diferenca: b - a, pct };
  }).filter(Boolean);
  return {
    comparado: true, de: tabela.exercicios[i], para: tabela.exercicios[j],
    itens,
    // Ordenados pelo tamanho da mudança: é o que interessa a quem vai à tribuna.
    maioresAltas:  itens.filter(x => x.pct !== null && x.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 10),
    maioresQuedas: itens.filter(x => x.pct !== null && x.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 10),
  };
}

/** Rótulo pronto para a nota: "R$ 826.175,4 milhões (+28,3%)". */
function rotuloVariacao(item) {
  const sinal = item.diferenca >= 0 ? '+' : '−';
  const pct = item.pct === null ? 'base zero' : `${sinal}${formatarBR(Math.abs(item.pct))}%`;
  return `${formatarBR(item.para)} (${pct})`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { numeroBR, formatarBR, tabelaPorOrgao, tabelaComparativa, variacaoEntre, rotuloVariacao };
}
