'use strict';
// ORADORES da sessão do Plenário — quem falou / foi chamado / aguarda, por
// lista (Breves Comunicações, Comunicações de Liderança, Discussão e
// Encaminhamento por matéria).
//
// Fonte: página PÚBLICA e server-rendered do portal (sem XHR, sem navegador):
//   /evento-legislativo/{idEvento}/oradores-inscritos                 → catálogo de listas
//   /evento-legislativo/{idEvento}/oradores-inscritos?idLista=&tipo=  → tabela da lista
// Tabela: Posição · Orador (link /deputados/{id}) · Partido · UF · Situação
// ("falou", "chamado", vazio = inscrito aguardando). Validado ao vivo na
// sessão 145 de 15/07/2026 (evento 82790).

const BASE = 'https://www.camara.leg.br/evento-legislativo';

const CACHE_MS = 60e3;                 // um /oradores no grupo + agente logo atrás = 1 varredura só
const _cache = new Map();              // eventoId → { ts, resumoTexto }

async function fetchTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SisPodeBot/1.0' } }); }
  finally { clearTimeout(timer); }
}

function limpar(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

/** Catálogo de listas de oradores da sessão (do <select> server-rendered). */
async function listasDeOradores(eventoId) {
  const r = await fetchTimeout(`${BASE}/${eventoId}/oradores-inscritos`);
  if (!r.ok) throw new Error(`HTTP ${r.status} na página de oradores`);
  const html = await r.text();
  const listas = [];
  for (const m of html.matchAll(/<option[^>]*value="([^"]+)"[^>]*>/g)) {
    // value = "Rótulo da lista;idLista;Tipo"
    const partes = m[1].split(';');
    if (partes.length < 3) continue;
    const idLista = partes[partes.length - 2].trim();
    const tipo = partes[partes.length - 1].trim();
    if (!/^\d+$/.test(idLista)) continue;
    listas.push({ rotulo: limpar(partes.slice(0, -2).join(';')), idLista, tipo });
  }
  // Nome da sessão (título da própria página, para o cabeçalho do resumo)
  const t = html.match(/(?:Breves Comunicações|Comunicações de Liderança) da\s+(Sessão[^;<"]+)/i);
  return { listas, sessaoNome: t ? limpar(t[1]) : '' };
}

/** Oradores de UMA lista. Situação: 'falou' | 'chamado' | '' (aguarda). */
async function oradoresDaLista(eventoId, { idLista, tipo }) {
  const url = `${BASE}/${eventoId}/oradores-inscritos?idLista=${idLista}&tipo=${encodeURIComponent(tipo)}`;
  const r = await fetchTimeout(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} na lista ${idLista}`);
  const html = await r.text();
  const oradores = [];
  for (const tr of html.matchAll(/<tr class="g-table__row">([\s\S]*?)<\/tr>/g)) {
    const linha = tr[1];
    const celula = th => {
      const m = linha.match(new RegExp(`data-th="${th}[^"]*"[^>]*>([\\s\\S]*?)</td>`));
      return m ? limpar(m[1].replace(/<[^>]+>/g, ' ')) : '';
    };
    const idDep = (linha.match(/href="\/deputados\/(\d+)"/) || [])[1] || null;
    const nome = celula('Orador').replace(/^Dep\.?\s*/i, '');
    if (!nome) continue;
    oradores.push({
      posicao: Number(celula('Posição')) || oradores.length + 1,
      nome, idDep,
      partido: celula('Partido'),
      uf: celula('UF'),
      situacao: celula('Situação').toLowerCase(),
    });
  }
  return oradores;
}

// Concorrência limitada (a sessão cheia tem ~30 listas; 5 por vez ≈ poucos s).
async function mapLimit(itens, limite, fn) {
  const res = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; res[k] = await fn(itens[k], k); }
  }));
  return res;
}

const rotuloCurto = l => l.rotulo
  .replace(/\s+da\s+Sessão[\s\S]*$/i, '')          // "Breves Comunicações da Sessão…" → "Breves Comunicações"
  .replace(/\s*·\s*$/, '');

function nomeCurto(o) { return `${o.nome} (${o.partido}${o.uf ? `-${o.uf}` : ''})`; }

function blocoDaLista(lista, oradores) {
  if (!oradores.length) return null;
  const falaram  = oradores.filter(o => o.situacao === 'falou');
  const chamados = oradores.filter(o => o.situacao === 'chamado');
  const aguardam = oradores.filter(o => o.situacao !== 'falou' && o.situacao !== 'chamado');
  // Um orador POR LINHA (pedido da Liderança: facilita a leitura no celular).
  const bloco = (titulo, lst) => `${titulo}\n${lst.map(o => `• ${nomeCurto(o)}`).join('\n')}`;
  const linhas = [`*${rotuloCurto(lista)}* — ${oradores.length} inscrito(s)`];
  if (falaram.length)  linhas.push(bloco(`✅ Falaram (${falaram.length}):`, falaram));
  if (chamados.length) linhas.push(bloco(`🎤 Chamado(s) (${chamados.length}):`, chamados));
  if (aguardam.length) linhas.push(bloco(`⏳ Aguardam (${aguardam.length}):`, aguardam));
  return linhas.join('\n');
}

/**
 * Resumão dos oradores da sessão, por lista. `filtro` (opcional) restringe às
 * listas cujo rótulo case (ex.: "breves", "liderança", "PL 2581/2026").
 * Retorna STRING pronta (também é a observação da ferramenta do agente).
 */
async function resumoOradores(eventoId, filtro = '') {
  filtro = limpar(filtro).toLowerCase();
  const chaveCache = `${eventoId}|${filtro}`;
  const c = _cache.get(chaveCache);
  if (c && Date.now() - c.ts < CACHE_MS) return c.texto;

  const { listas, sessaoNome } = await listasDeOradores(eventoId);
  if (!listas.length) return 'A sessão ainda não tem listas de oradores publicadas.';

  const alvo = filtro
    ? listas.filter(l => `${l.rotulo} ${l.tipo}`.toLowerCase().includes(filtro))
    : listas;
  if (!alvo.length) {
    return `Nenhuma lista de oradores casa com "${filtro}". Listas da sessão:\n` +
      [...new Set(listas.map(rotuloCurto))].map(r => `• ${r}`).join('\n');
  }

  const blocos = (await mapLimit(alvo, 5, async l => {
    try { return blocoDaLista(l, await oradoresDaLista(eventoId, l)); }
    catch (e) { return `*${rotuloCurto(l)}* — erro ao ler (${e.message})`; }
  })).filter(Boolean);

  const texto = blocos.length
    ? `🎤 Oradores — ${sessaoNome || `evento ${eventoId}`}\n\n${blocos.join('\n\n')}`
    : `Nenhum orador inscrito${filtro ? ` em "${filtro}"` : ''} até agora — ${sessaoNome || `evento ${eventoId}`}.`;
  _cache.set(chaveCache, { ts: Date.now(), texto });
  return texto;
}

// ---------- Sessão do Plenário por DATA ----------
// Resolve o evento deliberativo do Plenário (órgão 180) numa data — permite
// "/oradores 15/07/2026" para sessões passadas. Havendo mais de uma sessão no
// dia, devolve todas (o chamador junta os resumos).
async function eventosPlenarioDaData(dataISO) {
  const r = await fetchTimeout(`https://dadosabertos.camara.leg.br/api/v2/eventos?dataInicio=${dataISO}&dataFim=${dataISO}&idOrgao=180&itens=30`);
  if (!r.ok) throw new Error(`HTTP ${r.status} na API de eventos`);
  return (((await r.json()).dados) || [])
    .filter(e => /deliberativa/i.test(e.descricaoTipo || '') && !/n[ãa]o\s+deliberativa/i.test(e.descricaoTipo || ''))
    .map(e => ({ id: e.id, inicio: e.dataHoraInicio, situacao: e.situacao }));
}

/**
 * Resumão por DATA (aceita mais de uma sessão deliberativa no dia).
 * dataISO = 'aaaa-mm-dd'.
 */
async function resumoOradoresDaData(dataISO, filtro = '') {
  const eventos = await eventosPlenarioDaData(dataISO);
  if (!eventos.length) {
    return `Não há sessão deliberativa do Plenário em ${dataISO.split('-').reverse().join('/')}.`;
  }
  const partes = await mapLimit(eventos, 2, ev =>
    resumoOradores(ev.id, filtro).catch(e => `Evento ${ev.id}: erro ao ler oradores (${e.message}).`));
  return partes.join('\n\n————————\n\n');
}

module.exports = { resumoOradores, resumoOradoresDaData, eventosPlenarioDaData, listasDeOradores, oradoresDaLista };
