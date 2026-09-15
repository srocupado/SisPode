/* ============================================================
   SÉRIE HISTÓRICA — a cota do parlamentar ao longo dos exercícios

   POR QUE ISTO É PRODUTO, E NÃO ENFEITE

   "Sua cota é de R$ 40,25 milhões" não informa nada a quem não sabe quanto era
   antes. As notas da Coordenação que funcionaram traziam a série: a nota
   005/2020 compara as emendas individuais e de bancada de 2016 a 2020 lado a
   lado, e é a série que mostra se o parlamento ganhou ou perdeu espaço.

   Medido em 03/09/2026, o salto é grande o bastante para mudar uma conversa:
   a cota individual por deputado era R$ 19.704.897,00 na LOA 2023 e
   R$ 40.252.007,00 na LOA 2026 — mais que o dobro em três exercícios.

   DE ONDE VÊM OS NÚMEROS: das FICHAS de cada exercício, salvas no Firebase
   pela equipe. Não há extração automática e não há semente com valor sem
   procedência. A série cresce conforme o módulo é usado; um exercício sem
   ficha aparece como lacuna nomeada, nunca interpolado nem estimado.

   A regra que sustenta tudo: um valor só entra na série se, na ficha de
   origem, ele carregar documento — e se o exercício carimbado for o mesmo da
   ficha. Valor herdado de outro ano fica de fora e é denunciado.
   ============================================================ */

'use strict';

/** Campos que fazem sentido acompanhar ao longo do tempo. */
const CAMPOS_SERIE = [
  { chave: 'cota_individual_deputado', rotulo: 'Cota individual — deputado', tipo: 'moeda' },
  { chave: 'cota_individual_senador',  rotulo: 'Cota individual — senador',  tipo: 'moeda' },
  { chave: 'cota_bancada',             rotulo: 'Cota por bancada estadual',  tipo: 'moeda' },
  { chave: 'qtd_emendas_individuais',  rotulo: 'Emendas individuais por parlamentar', tipo: 'inteiro' },
  { chave: 'limite_relator_geral',     rotulo: 'Limite do Relator-Geral (RP9)', tipo: 'moeda' },
  { chave: 'reserva_emendas_total',    rotulo: 'Reserva para emendas no projeto', tipo: 'moeda' },
  { chave: 'piso_obras',               rotulo: 'Piso de repasse — obras',     tipo: 'moeda' },
  { chave: 'salario_minimo',           rotulo: 'Salário mínimo projetado',    tipo: 'moeda' },
];

/** "R$ 40.252.007,00" → 40252007. Devolve null quando não há número. */
function valorNumerico(texto) {
  const m = String(texto ?? '').match(/-?\d[\d.]*(?:,\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Monta a série a partir das fichas de vários exercícios.
 *
 * `fichas` = [{ ano, valores }] — o que carregarFicha devolve, um por ano.
 * Devolve, por campo, os pontos com valor E procedência, mais as lacunas.
 *
 *   { campo, rotulo, pontos: [{ ano, valor, texto, documento, pagina }],
 *     lacunas: [ano], variacao: { primeiro, ultimo, pct } | null,
 *     descartados: [{ ano, motivo }] }
 */
function montarSerie(fichas = []) {
  const anos = [...new Set(fichas.map(f => String(f.ano)))].sort();
  return CAMPOS_SERIE.map(campo => {
    const pontos = [];
    const lacunas = [];
    const descartados = [];

    for (const ano of anos) {
      const f = fichas.find(x => String(x.ano) === ano);
      const v = f?.valores?.[campo.chave];
      if (!v) { lacunas.push(ano); continue; }
      // As duas recusas que impedem a série de virar ficção.
      if (!v.documento) { descartados.push({ ano, motivo: 'valor sem documento de origem' }); continue; }
      if (v.exercicio && String(v.exercicio) !== ano) {
        descartados.push({ ano, motivo: `valor carimbado com o exercício ${v.exercicio}` });
        continue;
      }
      const valor = valorNumerico(v.valor);
      if (valor === null) { descartados.push({ ano, motivo: 'valor não numérico' }); continue; }
      pontos.push({ ano, valor, texto: v.valor, documento: v.documento, pagina: v.pagina || null,
                    conferido: !!v.conferencia?.localizado });
    }

    // A lacuna é medida sobre o INTERVALO que a série cobre, não sobre as
    // fichas recebidas: passar só 2023 e 2026 não faz de 2024 e 2025 anos
    // inexistentes. Sem isso, um salto de três exercícios seria lido como
    // evolução ano a ano — e é justamente o intervalo em que a cota dobrou.
    if (pontos.length >= 2) {
      const ini = Number(pontos[0].ano), fim = Number(pontos[pontos.length - 1].ano);
      if (Number.isFinite(ini) && Number.isFinite(fim)) {
        const comPonto = new Set(pontos.map(p => p.ano));
        for (let a = ini; a <= fim; a++) {
          const chave = String(a);
          if (!comPonto.has(chave) && !lacunas.includes(chave)) lacunas.push(chave);
        }
        lacunas.sort();
      }
    }

    // Variação só entre pontos REAIS, nunca sobre lacuna interpolada.
    let variacao = null;
    if (pontos.length >= 2) {
      const a = pontos[0], b = pontos[pontos.length - 1];
      variacao = {
        primeiro: a, ultimo: b,
        pct: a.valor === 0 ? null : ((b.valor - a.valor) / Math.abs(a.valor)) * 100,
        exerciciosCobertos: pontos.length,
        contiguo: lacunas.length === 0,
      };
    }
    return { campo: campo.chave, rotulo: campo.rotulo, tipo: campo.tipo, pontos, lacunas, descartados, variacao };
  });
}

/** Só as séries que têm alguma coisa a mostrar. */
function seriesComDados(series) {
  return series.filter(s => s.pontos.length > 0);
}

/**
 * Frase pronta para a nota. Diz a cobertura junto com o número — uma série com
 * buraco no meio não pode ser lida como evolução contínua.
 */
function frasSerie(serie) {
  if (!serie.pontos.length) return `${serie.rotulo}: sem valor registrado em nenhum exercício.`;
  const p = serie.pontos;
  const fmt = x => x.texto;
  if (p.length === 1) return `${serie.rotulo}: ${fmt(p[0])} em ${p[0].ano} (único exercício registrado).`;
  const v = serie.variacao;
  const sinal = v.pct === null ? '' : (v.pct >= 0 ? 'alta de ' : 'queda de ');
  const pct = v.pct === null ? 'variação não calculável (base zero)'
    : `${sinal}${Math.abs(v.pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const ressalva = v.contiguo ? '' : ` (série com ${serie.lacunas.length} exercício(s) sem registro: ${serie.lacunas.join(', ')})`;
  return `${serie.rotulo}: de ${fmt(v.primeiro)} em ${v.primeiro.ano} para ${fmt(v.ultimo)} em ${v.ultimo.ano} — ${pct}${ressalva}.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CAMPOS_SERIE, valorNumerico, montarSerie, seriesComDados, frasSerie };
}
