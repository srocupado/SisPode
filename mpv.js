/* ============================================================
   MPV — documentos de Medida Provisória no Senado/Congresso e na Câmara
   Compartilhado entre Destaques (panel.js) e Análise de Pauta (analise.js).

   MPV tramita na Comissão Mista, e o acervo dela é do Senado/Congresso
   Nacional: emendas, relatório da relatoria e o PLV (Projeto de Lei de
   Conversão) ficam lá — NÃO na página prop_emendas/pareceres da Câmara.
   A Câmara passa a ter o parecer (PAR) e o PLV como proposições próprias
   quando a Comissão Mista conclui. Este arquivo sabe ONDE cada coisa está
   e declara quando não acha; quem chama decide o que fazer.

   MEDIDO em 01/09/2026:
     MPV 1357/2026 (174123) — Câmara: 0 emendas, relacionadas só DTQ/REQ/RPD;
                              Senado: 112 emendas (nº 1..112), sem PLV ainda.
     MPV 1366/2026 (174622) — Câmara: PAR 1/2026 (55 págs: relatório +
                              conclusão "Emendas nºs 3, 5, 8, 9, 13 e 14
                              acolhidas… rejeição das 1, 2, 4, 6, 7, 10, 11 e
                              12" + PLV anexo) e PLV 10/2026 (11 págs);
                              Senado: "Relatório Legislativo" (39 págs) e
                              "Texto final da Comissão - PLV 10/2026".
     O corpo do PLV NÃO traz a lista de acolhidas: ela está no parecer.

   Exposto no escopo global da página (scripts clássicos): senadoJson,
   senadoAchar, senadoCodigoMateria, senadoEmendas, resolverDocumentosMPV.
   ============================================================ */

'use strict';

const SENADO_DADOS = 'https://legis.senado.leg.br/dadosabertos';
const MPV_API_CAMARA = 'https://dadosabertos.camara.leg.br/api/v2';

async function senadoJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Procura uma chave em qualquer profundidade do JSON do Senado (que aninha muito). */
function senadoAchar(obj, chave) {
  if (obj && typeof obj === 'object') {
    if (chave in obj) return obj[chave];
    for (const v of Object.values(obj)) { const r = senadoAchar(v, chave); if (r !== undefined) return r; }
  }
  return undefined;
}

/** Lista sempre como array (o Senado devolve objeto solto quando há um só). */
function senadoLista(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

/** Código da matéria no Senado (ex.: MPV 1357/2026 → 174123). */
async function senadoCodigoMateria(sigla, numero, ano) {
  const d = await senadoJson(`${SENADO_DADOS}/materia/pesquisa/lista?sigla=${encodeURIComponent(sigla)}&numero=${numero}&ano=${ano}`);
  const ms = senadoLista(senadoAchar(d, 'Materia'));
  const alvo = ms.find(m => String(m.Sigla || '').toUpperCase() === String(sigla).toUpperCase()
    && parseInt(m.Numero, 10) === parseInt(numero, 10) && String(m.Ano) === String(ano));
  return alvo ? String(alvo.Codigo) : null;
}

/**
 * Emendas da matéria no Senado, normalizadas: { numero, autor, partido, url }.
 * `url` já vem em https (o Senado responde http:// e a extensão só fala https).
 */
async function senadoEmendas(codigoMateria) {
  const d = await senadoJson(`${SENADO_DADOS}/materia/emendas/${codigoMateria}`);
  return senadoLista(senadoAchar(d, 'Emenda')).map(e => {
    const autores = senadoLista(senadoAchar(e.AutoriaEmenda || {}, 'Autor'));
    const principal = autores.find(a => a.IndicadorAutorPrincipal === 'Sim') || autores[0] || {};
    const textos = senadoLista(senadoAchar(e.TextosEmenda || {}, 'TextoEmenda'));
    const texto = textos.find(t => /emenda/i.test(t.DescricaoTipoTexto || t.TipoDocumento || '')) || textos[0] || {};
    return {
      numero:  parseInt(e.NumeroEmenda, 10),
      autor:   principal.NomeAutor || senadoAchar(principal, 'NomeParlamentar') || '',
      partido: senadoAchar(principal, 'SiglaPartidoParlamentar') || '',
      url:     String(texto.UrlTexto || '').replace(/^http:\/\//i, 'https://'),
    };
  }).filter(e => Number.isFinite(e.numero));
}

/** Textos (documentos) da matéria no Senado, normalizados. */
async function senadoTextos(codigoMateria) {
  const d = await senadoJson(`${SENADO_DADOS}/materia/textos/${codigoMateria}`);
  return senadoLista(senadoAchar(d, 'Texto')).map(t => ({
    data:      String(t.DataTexto || '').slice(0, 10),
    descricao: t.DescricaoTexto || '',
    tipo:      t.TipoDocumento || '',
    autoria:   t.AutoriaTexto || '',
    url:       String(t.UrlTexto || '').replace(/^http:\/\//i, 'https://'),
  }));
}

/**
 * Onde estão os documentos da MPV — parecer da Comissão Mista, PLV e texto
 * original. Devolve sempre um objeto; cada peça é null quando não existe.
 *
 * O relato do que aconteceu vem em DUAS listas, e a distinção importa:
 *   · `avisos` — algo deu errado e o resultado pode estar incompleto: fonte
 *     fora do ar, matéria não localizada, documento autuado sem inteiro teor.
 *     É isto que merece console.warn (e, na extensão, a página de Erros).
 *   · `notas`  — estado NORMAL da tramitação, relatado para diagnóstico: a
 *     Comissão Mista ainda não concluiu, então não há PAR/PLV em lugar nenhum.
 *     A maioria das MPVs em pauta está assim (Cenário 8a); tratar isso como
 *     erro enchia a página de Erros da extensão com 4 linhas por MPV.
 * Fonte fora do ar ≠ documento inexistente: só a primeira lista é problema.
 *
 *   {
 *     par:              { rotulo:'PAR 1/2026', url, data, fonte:'Câmara' }     // relatório + conclusão + PLV anexo
 *     plv:              { rotulo:'PLV 10/2026', url, data, fonte }             // Câmara; senão Senado (texto final)
 *     relatorioSenado:  { rotulo:'Relatório Legislativo', url, data, fonte }   // fallback do parecer
 *     original:         { rotulo:'MPV 1366/2026', url, fonte:'Câmara' }        // texto do Executivo
 *     temPLV:           boolean
 *     avisos:           [string]   // problemas
 *     notas:            [string]   // ausências normais
 *   }
 */
async function resolverDocumentosMPV({ idCamara, sigla = 'MPV', numero, ano, chave }) {
  const out = { par: null, plv: null, relatorioSenado: null, original: null, temPLV: false, avisos: [], notas: [] };
  const rot = chave || `${sigla} ${numero}/${ano}`;

  // ---- Câmara: relacionadas → PAR e PLV; detalhe → inteiro teor ----
  if (idCamara) {
    try {
      const det = await fetch(`${MPV_API_CAMARA}/proposicoes/${idCamara}`);
      if (det.ok) {
        const d = (await det.json()).dados || {};
        if (d.urlInteiroTeor) out.original = { rotulo: rot, url: d.urlInteiroTeor, fonte: 'Câmara' };
      }
      const r = await fetch(`${MPV_API_CAMARA}/proposicoes/${idCamara}/relacionadas`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rel = (await r.json()).dados || [];
      const maisRecente = tipo => rel.filter(x => x.siglaTipo === tipo).sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
      const faltando = [];
      for (const [campo, tipo] of [['par', 'PAR'], ['plv', 'PLV']]) {
        const p = maisRecente(tipo);
        if (!p) { faltando.push(tipo); continue; }
        const dp = await fetch(`${MPV_API_CAMARA}/proposicoes/${p.id}`);
        const dd = dp.ok ? (await dp.json()).dados || {} : {};
        if (dd.urlInteiroTeor) {
          out[campo] = { rotulo: `${tipo} ${p.numero}/${p.ano}`, url: dd.urlInteiroTeor,
            data: String(dd.dataApresentacao || '').slice(0, 10), fonte: 'Câmara', id: p.id };
        } else {
          // Autuado mas sem PDF: isso é defeito da fonte, não ausência.
          out.avisos.push(`${tipo} ${p.numero}/${p.ano} consta na Câmara mas sem inteiro teor.`);
        }
      }
      if (faltando.length) out.notas.push(`Sem ${faltando.join(' nem ')} entre as ${rel.length} relacionadas na Câmara — procurado no Senado.`);
    } catch (e) { out.avisos.push(`Câmara indisponível ao procurar PAR/PLV (${e.message}).`); }
  } else {
    out.avisos.push('Sem id da MPV na Câmara — PAR/PLV não procurados lá.');
  }

  // ---- Senado: fallback do PLV (texto final) e do parecer (relatório) ----
  if (!out.plv || !out.par) {
    try {
      const codigo = await senadoCodigoMateria(sigla, numero, ano);
      if (!codigo) {
        out.avisos.push(`${rot} não localizada no Senado.`);
      } else {
        const textos = await senadoTextos(codigo);
        const porData = (a, b) => b.data.localeCompare(a.data);
        if (!out.plv) {
          const tf = textos.filter(t => /\bPLV\b/i.test(t.descricao) && /texto\s+final/i.test(t.descricao)).sort(porData)[0];
          if (tf) {
            const m = /PLV\s+(\d+)\/(\d{4})/i.exec(tf.descricao);
            out.plv = { rotulo: m ? `PLV ${m[1]}/${m[2]}` : 'PLV', url: tf.url, data: tf.data, fonte: 'Senado/Congresso (texto final da Comissão Mista)' };
          } else {
            out.notas.push(`Senado não tem "Texto final da Comissão - PLV" para a matéria ${codigo} (${textos.length} documentos lidos).`);
          }
        }
        if (!out.par) {
          const rl = textos.filter(t => /relat[óo]rio\s+legislativo/i.test(t.descricao)).sort(porData)[0];
          if (rl) out.relatorioSenado = { rotulo: 'Relatório Legislativo da Comissão Mista', url: rl.url, data: rl.data, fonte: 'Senado/Congresso', autoria: rl.autoria };
          else out.notas.push(`Senado não tem "Relatório Legislativo" para a matéria ${codigo}.`);
        }
        if (!out.original) {
          const mp = textos.find(t => new RegExp(`^${sigla}\\s+${numero}/${ano}$`, 'i').test(t.descricao.trim()));
          if (mp) out.original = { rotulo: rot, url: mp.url, fonte: 'Senado/Congresso' };
        }
      }
    } catch (e) { out.avisos.push(`Senado indisponível (${e.message}).`); }
  }

  // temPLV = PLV autuado/aprovado em mãos. O relatório do relator NÃO conta:
  // ele traz o PLV apenas como PROPOSTA, anexa ao final e sem número
  // ("PROJETO DE LEI DE CONVERSÃO Nº , DE 2026" — medido na p.21 do relatório
  // da MPV 1357/2026), porque a numeração só vem com a aprovação na Comissão.
  out.temPLV = !!(out.plv || out.par);
  // Estados normais da tramitação, não defeitos.
  if (!out.temPLV) {
    out.notas.push(out.relatorioSenado
      ? 'Nenhum PLV autuado (Câmara e Senado): há relatório do(a) relator(a), mas a Comissão Mista ainda não concluiu — o PLV proposto, se houver, está dentro do próprio relatório.'
      : 'Nenhum PLV localizado (Câmara e Senado): a MPV está sem parecer da Comissão Mista.');
  }
  return out;
}

// Exportado para os testes em Node (na extensão é <script> de página).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { senadoJson, senadoAchar, senadoLista, senadoCodigoMateria, senadoEmendas, senadoTextos, resolverDocumentosMPV, SENADO_DADOS };
}
