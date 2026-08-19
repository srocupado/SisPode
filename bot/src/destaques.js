'use strict';
// Consulta ao módulo "Destaques Legislativos" (Firebase /sessoes) — usado pelo
// monitor quando um DESTAQUE entra em votação no Plenário: se a equipe
// preparou material no painel (explicação / voto sim / voto não), o bot
// publica a ficha SEM a orientação (decisão política é manual da Liderança).
const { fbGet } = require('./firebase');

// "PL Nº 3.278/2021 - DVS Nº 5 ..." → { ref: {sigla,numero,ano}, num: 'DVS 5' }
function parseRotuloDestaque(rotulo) {
  const up = String(rotulo || '').toUpperCase();
  const refM = up.match(/\b(PL|PLP|PEC|PDL|PDC|MPV|PRC)\s*N?[º°O]?\s*([\d.]+)\s*\/\s*(\d{4})\b/);
  const numM = up.match(/\b(DVS|DTQ|DVT|EMC)\s*N?[º°O]?\s*(\d+)\b/);
  return {
    ref: refM ? { sigla: refM[1], numero: refM[2].replace(/\./g, ''), ano: refM[3] } : null,
    num: numM ? `${numM[1]} ${numM[2]}` : null,
  };
}

/**
 * Localiza o destaque no módulo (sessão do dia em /sessoes) e devolve a ficha
 * preparada, ou null se não encontrado / sem material da equipe.
 * `temMaterial` = há explicação OU voto sim OU voto não (condição de postagem).
 */
async function buscarDestaquePreparado({ rotulo, dataISO }) {
  const { ref, num } = parseRotuloDestaque(rotulo);
  if (!ref || !num) {
    console.warn('[destaques] rótulo não parseável (calibrar no ensaio):', rotulo);
    return null;
  }

  let sessoes = null;
  try { sessoes = await fbGet('/sessoes'); } catch (_) { return null; }
  if (!sessoes) return null;

  // Sessões do dia primeiro; sem data casada, tenta a mais recente.
  const lista = Object.values(sessoes).filter(s => s && Array.isArray(s.proposicoes));
  lista.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  const candidatas = [
    ...lista.filter(s => String(s.data || '').slice(0, 10) === dataISO),
    ...lista.slice(0, 1),
  ];

  // As chaves no módulo têm dois formatos ("PL 1234/2025" manual;
  // "MPV-1345-2026" importada da pauta) — normaliza ambos para comparar.
  const norm = s => String(s || '').toUpperCase().replace(/[\s/]+/g, '-').replace(/\.(?=\d)/g, '');
  const chaveAlvo = norm(`${ref.sigla}-${ref.numero}-${ref.ano}`);
  const chaveProp = `${ref.sigla} ${ref.numero}/${ref.ano}`;
  for (const sessao of candidatas) {
    const prop = (sessao.proposicoes || []).find(p => p && norm(p.chave) === chaveAlvo);
    if (!prop) continue;
    const dest = (prop.destaques || []).find(d =>
      d && String(d.numero || '').toUpperCase().replace(/\s+/g, ' ').trim() === num);
    if (!dest) continue;

    const explicacao = (dest.explicacao || '').trim();
    const votoSim    = (dest.votoSim || '').trim();
    const votoNao    = (dest.votoNao || '').trim();
    return {
      chaveProp, num,
      descricao: (dest.descricao || '').trim(),
      tipo: (dest.tipo || '').trim(),
      autoria: (dest.autoria || '').trim(),
      explicacao, votoSim, votoNao,
      temMaterial: !!(explicacao || votoSim || votoNao),
      sessaoTitulo: sessao.titulo || '',
    };
  }
  return null;
}

/** Mensagem opção B: descrição oficial + material preparado, SEM orientação. */
function mensagemDestaque(f) {
  const linhas = [
    '📌 *DESTAQUE EM VOTAÇÃO*',
    '',
    `${f.num} — *${f.chaveProp}*${f.autoria ? ` (${f.autoria})` : ''}`,
  ];
  if (f.descricao) linhas.push(f.descricao);
  if (f.explicacao) linhas.push('', `*Explicação:* ${f.explicacao}`);
  if (f.votoSim)    linhas.push('', `*Voto SIM:* ${f.votoSim}`);
  if (f.votoNao)    linhas.push('', `*Voto NÃO:* ${f.votoNao}`);
  return linhas.join('\n');
}

module.exports = { buscarDestaquePreparado, mensagemDestaque, parseRotuloDestaque };
