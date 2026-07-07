'use strict';
// Painel ao vivo do Plenário (votacao-portal) — fonte primária do monitor de
// sessão. Porte da camada de dados do processPortalDoc (votacao.js da
// extensão): itens da sessão, placar global, votos individuais e orientações.
// Regra de ouro observada em plenário: os votos individuais SÓ aparecem na
// página depois que a votação nominal encerra — é o sinal de encerramento.
const { DOMParser } = require('linkedom');

const PORTAL_BASE = 'https://www.camara.leg.br/presenca-comissoes/votacao-portal';
const API = 'https://dadosabertos.camara.leg.br/api/v2';

async function paginaSessao(reuniaoId, itemId) {
  const url = `${PORTAL_BASE}?reuniao=${reuniaoId}${itemId ? `&itemVotacao=${itemId}` : ''}`;
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`painel HTTP ${r.status}`);
  const html = await r.text();
  if (html.length < 5000) throw new Error('painel retornou página vazia');
  return html;
}

/** Itens de votação da sessão: [{ id, rotulo, nominal, selecionado }]. */
function parseItens(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sel = doc.querySelector('#dropDownReunioes') || doc.querySelector('select[name="itemVotacao"]');
  const out = [];
  for (const opt of (sel ? sel.querySelectorAll('option') : [])) {
    const id = opt.getAttribute('value');
    if (!id || !/^\d+$/.test(id)) continue;
    const rotulo = (opt.textContent || '').replace(/\s+/g, ' ').trim();
    out.push({
      id,
      rotulo,
      nominal: /\(nominal/i.test(rotulo),
      selecionado: opt.hasAttribute('selected'),
    });
  }
  return out;
}

function normNome(nome) {
  return String(nome || '').toUpperCase()
    .replace(/\b(DR\.?|DRA\.?|DEL\.?|DELEGAD[OA]\.?|PROF\.?|PROFESSORA?\.?|DEP\.?)\b\.?\s*/g, '')
    .replace(/\b[A-Z]\.\s*/g, '')
    .replace(/[^A-ZÁÉÍÓÚÀÃÕÇÂÊÎ]/g, '');
}
function mesmoDeputado(a, b) {
  if (a === b) return true;
  const curto = a.length <= b.length ? a : b;
  const longo = a.length <= b.length ? b : a;
  return curto.length >= 6 && longo.startsWith(curto);
}

function classeVoto(voto, el) {
  const t = String(voto || '').toLowerCase();
  if (el?.classList?.contains('sim')) return 'sim';
  if (el?.classList?.contains('nao')) return 'nao';
  if (/art/i.test(t))   return 'art17';
  if (/abst/i.test(t))  return 'abstencao';
  if (/obstr/i.test(t)) return 'obstrucao';
  if (t === 'sim') return 'sim';
  if (t === 'não' || t === 'nao') return 'nao';
  return 'ausente';
}

/**
 * Placar completo do item exibido na página — mesmo shape do placarVotacao
 * (votacao.js do bot), para reusar a imagemVotacao sem mudanças.
 * `descricao` vem do chamador (rótulo do item); os votos individuais só
 * existem após o encerramento (temVotos=false ⇒ votação em curso).
 */
async function parsePlacarPortal(html, { sigla = 'PODE', descricao = '' } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const getQtd = cls => {
    const el = doc.querySelector(`li.${cls} .qtd`);
    return el ? (parseInt(el.textContent.trim(), 10) || 0) : 0;
  };
  const global = {
    sim: getQtd('sim'), nao: getQtd('nao'), abstencao: getQtd('abstencao'),
    art17: (() => { const el = doc.querySelector('li.votoPresidente .qtd'); return el ? (parseInt(el.textContent.trim(), 10) || 0) : 0; })(),
    obstrucao: getQtd('obstrucao'),
  };
  const quorum = getQtd('quorum') || getQtd('totalVotantes');

  // Data da sessão (dd/mm/aaaa → ISO)
  let dataISO = '';
  const ri = doc.querySelector('.reuniaoDataLocal');
  const dm = ri && ri.textContent.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dm) dataISO = `${dm[3]}-${dm[2]}-${dm[1]}`;

  // Orientações registradas (para a IMAGEM — registro oficial; o bot não orienta)
  let orientPartido = '', orientGoverno = '';
  for (const el of doc.querySelectorAll('.lideranca')) {
    const nome = (el.textContent || '').trim().toUpperCase();
    const li = el.closest('li');
    const voto = li?.querySelector('.voto')?.textContent?.trim() || '';
    if (!orientPartido && (nome.includes('PODEMOS') || /\bPODE\b/.test(nome))) orientPartido = voto;
    if (!orientGoverno && nome === 'GOVERNO') orientGoverno = voto;
  }

  // Votos individuais (só existem após o encerramento)
  const votados = [];
  for (const li of doc.querySelectorAll('li')) {
    const nEl = li.querySelector('span.nome');
    const pEl = li.querySelector('span.nomePartido');
    if (!nEl || !pEl) continue;
    const pFull = (pEl.textContent || '').trim();
    const spM = pFull.match(/\(([^-)]+)/);
    const ufM = pFull.match(/-([A-Z]{2})\)/);
    const vs = li.querySelector('span.votou span.voto');
    votados.push({
      nome: (nEl.textContent || '').trim(),
      siglaPartido: spM ? spM[1].trim() : '',
      siglaUf: ufM ? ufM[1] : '',
      tipoVoto: vs ? (vs.textContent || '').trim() : null,
      _el: vs,
    });
  }
  const temVotos = votados.filter(v => v.tipoVoto).length >= 10;

  // Bancada do partido: votos do painel + roster da API para marcar ausentes
  const S = sigla.toUpperCase();
  const daBancada = votados.filter(v => {
    const sp = v.siglaPartido.toUpperCase();
    return sp === S || sp === 'PODEMOS';
  });
  let roster = [];
  try {
    const rr = await fetch(`${API}/deputados?siglaPartido=${S}&itens=100&ordem=ASC&ordenarPor=nome`);
    if (rr.ok) roster = ((await rr.json()).dados) || [];
  } catch (_) { /* segue só com o painel */ }

  const bancada = daBancada.map(v => ({
    nome: v.nome, siglaPartido: S, siglaUf: v.siglaUf,
    tipoVoto: v.tipoVoto, classe: classeVoto(v.tipoVoto, v._el),
  }));
  const chaves = bancada.map(d => normNome(d.nome));
  for (const dep of roster) {
    const ch = normNome(dep.nome);
    if (chaves.some(c => mesmoDeputado(c, ch))) continue;
    bancada.push({ nome: dep.nome, siglaPartido: dep.siglaPartido, siglaUf: dep.siglaUf, tipoVoto: null, classe: 'ausente' });
  }
  bancada.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  const parcial = { sim: 0, nao: 0, abstencao: 0, art17: 0, obstrucao: 0, ausente: 0 };
  for (const d of bancada) parcial[d.classe]++;

  const horaBR = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date());

  return {
    sigla: S, descricao, data: dataISO, hora: horaBR, orgao: 'PLEN',
    quorum, global, bancada, parcial, orientPartido, orientGoverno,
    temVotos,
  };
}

// ============================================================
//  Identificação amigável do item ("Votação da Urgência do PL 849/2025")
// ============================================================

function refDoRotulo(texto) {
  const m = String(texto || '').toUpperCase()
    .match(/\b(PL|PLP|PEC|PDL|PDC|MPV|PRC|REQ|PLV)\s*N?[º°O]?\s*([\d.]+)\s*\/\s*(\d{4})\b/);
  return m ? { sigla: m[1], numero: m[2].replace(/\./g, ''), ano: m[3] } : null;
}

/**
 * Converte o rótulo do painel em identificação de mensagem.
 * Ex.: "REQ Nº 1233/2026 - URGÊNCIA PARA APRECIAÇÃO DO PL Nº 849/2025 (Nominal)"
 *      → { texto: "Votação da Urgência do *PL 849/2025*", ref: {PL 849 2025} }
 */
function identificarItem(rotulo) {
  const limpo = String(rotulo || '').replace(/\((?:Nominal|Simbólica)[^)]*\)\s*$/i, '').trim();
  const negrito = r => `*${r.sigla} ${r.numero}/${r.ano}*`;

  const urg = limpo.match(/URG[ÊE]NCIA\s+(?:PARA\s+APRECIA[ÇC][ÃA]O\s+)?D?[OA]?\s*(.+)$/i);
  if (urg) {
    const ref = refDoRotulo(urg[1]) || refDoRotulo(limpo);
    if (ref) return { texto: `Votação da Urgência do ${negrito(ref)}`, ref };
  }
  const ref = refDoRotulo(limpo);
  const depois = limpo.split('-').slice(1).join('-').trim();   // parte após "SIGLA Nº X/Y - "
  const tipos = [
    [/REDA[ÇC][ÃA]O\s+FINAL/i,        r => `Votação da Redação Final do ${negrito(r)}`],
    [/SUBEMENDA/i,                    r => `Votação da Subemenda ao ${negrito(r)}`],
    [/SUBSTITUTIVO/i,                 r => `Votação do Substitutivo do ${negrito(r)}`],
    [/DESTAQUE|DVS/i,                 r => `Votação de Destaque ao ${negrito(r)}`],
    [/EMENDA/i,                       r => `Votação de Emenda ao ${negrito(r)}`],
    [/PROJETO\s+DE\s+LEI\s+DE\s+CONVERS[ÃA]O|PLV/i, r => `Votação do PLV da ${negrito(r)}`],
    [/PARECER/i,                      r => `Votação do Parecer da ${negrito(r)}`],
  ];
  if (ref) {
    for (const [re, fmt] of tipos) if (re.test(depois)) return { texto: fmt(ref), ref };
    return { texto: `Votação do ${negrito(ref)}`, ref };
  }
  return { texto: `Votação: ${limpo}`, ref: null };   // fallback — calibrar no ensaio
}

// ============================================================
//  Descoberta da sessão do dia no painel ao vivo (para o /votacao de HOJE
//  não depender de Dados Abertos, que tem ~5min de atraso). O id do evento
//  em Dados Abertos é o mesmo `reuniao` do portal — daí a ponte.
// ============================================================

async function eventosDeliberativosDia(dataISO) {
  const r = await fetch(`${API}/eventos?dataInicio=${dataISO}&dataFim=${dataISO}&idOrgao=180&itens=30`);
  if (!r.ok) return [];
  return ((await r.json()).dados || [])
    .filter(e => /deliberativa/i.test(e.descricaoTipo || '') && !/n[ãa]o\s+deliberativa/i.test(e.descricaoTipo || ''));
}

/**
 * Descobre a sessão do dia no painel e seus itens NOMINAIS.
 * Retorna { reuniaoId, itens:[{id,rotulo,nominal,selecionado}] } ou null se
 * não houver sessão com painel disponível (aí o chamador cai para Dados Abertos).
 */
async function descobrirSessaoPortal(dataISO) {
  const eventos = await eventosDeliberativosDia(dataISO);
  eventos.sort((a, b) => String(b.dataHoraInicio || '').localeCompare(String(a.dataHoraInicio || '')));
  for (const ev of eventos) {
    try {
      const html = await paginaSessao(ev.id);
      const itens = parseItens(html).filter(i => i.nominal);
      if (itens.length) return { reuniaoId: ev.id, itens };
    } catch (_) { /* tenta o próximo evento */ }
  }
  return null;
}

module.exports = {
  paginaSessao, parseItens, parsePlacarPortal, identificarItem,
  descobrirSessaoPortal,
};
