// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';

// ── BLOCOS E NÚMEROS DOS ITENS DA PAUTA DA CCJC ─────────────────────────────
// A pauta oficial (link "Pauta" da página da reunião: prop_mostrarintegra?codteor=…)
// organiza os itens em blocos com letra e nome — "A - Redações Finais:",
// "B - Proposições Sujeitas à Apreciação Conclusiva pelas Comissões:" —, às vezes
// com subtítulos de regime ("PRIORIDADE", "TRAMITAÇÃO ORDINÁRIA", "PRAZO
// CONSTITUCIONAL"), e numera os itens ("1 -" e, na linha seguinte, "PROJETO DE LEI
// Nº 396/2007"). A API traz o número (ordem) de cada item, mas o seu "tópico"
// agrupa por regime ("Redações Finais", "Prazo Constitucional", "Tramitação
// Ordinária") e não coincide com os blocos: a pauta oficial é a fonte dos blocos.
// MEDIDO nas pautas de 03/11/2026 (122 itens, blocos A e B) e 04/11/2026 (82
// itens): os números da pauta oficial são os mesmos da ordem da API.
//
// Usa de ccjc.js (na página): escHtml, salvarPauta. Exportado para os testes (Node).

const BLOCO_TIPOS = [
  [/^PROJETO DE LEI COMPLEMENTAR\b/, 'PLP'], [/^PROJETO DE LEI DO CONGRESSO NACIONAL\b/, 'PLN'], [/^PROJETO DE LEI DE CONVERS[ÃA]O\b/, 'PLV'],
  [/^PROJETO DE LEI\b/, 'PL'], [/^PROJETO DE DECRETO LEGISLATIVO\b/, 'PDL'], [/^PROJETO DE RESOLU[ÇC][ÃA]O\b/, 'PRC'],
  [/^PROPOSTA DE EMENDA [ÀA] CONSTITUI[ÇC][ÃA]O\b/, 'PEC'], [/^MEDIDA PROVIS[ÓO]RIA\b/, 'MPV'], [/^REQUERIMENTO\b/, 'REQ'],
  [/^PROPOSTA DE FISCALIZA[ÇC][ÃA]O E CONTROLE\b/, 'PFC'], [/^INDICA[ÇC][ÃA]O\b/, 'INC'], [/^MENSAGEM\b/, 'MSC'],
];
// Subtítulo de regime dentro de um bloco: linha só em maiúsculas, curta, sem "Nº".
const BLOCO_REGIME = /^(PRIORIDADE|URG[ÊE]NCIA|TRAMITA[ÇC][ÃA]O ORDIN[ÁA]RIA|PRAZO CONSTITUCIONAL|REGIME ESPECIAL)$/;

/**
 * Lê os blocos e os itens do texto da pauta oficial (uma linha por elemento do HTML).
 * Devolve { blocos: [{ letra, nome }], itens: [{ n, letra, regime, sigla, numero, ano, chave }] }.
 */
function pautaBlocosDoTexto(texto) {
  const L = String(texto || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const blocos = [], itens = [];
  let bloco = null, regime = '';
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    // "A -" (o nome na linha seguinte) ou "A - Redações Finais:"
    const mb = /^([A-Z])\s*[-–]\s*(.*)$/.exec(l);
    if (mb && (!mb[2] || /:$/.test(mb[2]))) {
      const nome = (mb[2] || L[i + 1] || '').replace(/:$/, '').trim();
      if (nome && !/^\d/.test(nome)) {
        bloco = { letra: mb[1], nome };
        blocos.push(bloco); regime = '';
        if (!mb[2]) i++;
        continue;
      }
    }
    if (BLOCO_REGIME.test(l.toUpperCase()) && l === l.toUpperCase()) { regime = l; continue; }
    // "12 -" e a proposição na linha seguinte (ou na mesma)
    const mi = /^(\d{1,3})\s*[-–]\s*(.*)$/.exec(l);
    if (mi) {
      // o número pode quebrar de linha: "PROJETO DE DECRETO LEGISLATIVO Nº" / "85/2024"
      const prop = (mi[2] ? `${mi[2]} ${L[i + 1] || ''}` : `${L[i + 1] || ''} ${L[i + 2] || ''}`).toUpperCase();
      const tipo = BLOCO_TIPOS.find(([re]) => re.test(prop));
      const mn = /N[ºO°.]*\s*([\d.]+)\s*\/\s*(\d{4})/.exec(prop);
      if (tipo && mn) {
        const numero = parseInt(mn[1].replace(/\./g, ''), 10), ano = parseInt(mn[2], 10);
        itens.push({ n: parseInt(mi[1], 10), letra: bloco ? bloco.letra : '', regime, sigla: tipo[1], numero, ano, chave: `${tipo[1]} ${numero}/${ano}` });
        if (!mi[2]) i++;
      }
    }
  }
  return { blocos, itens };
}

/**
 * Itens de texto do pdf.js → texto com UMA LINHA por linha da página (o que pautaBlocosDoTexto lê). Antes, o
 * módulo juntava a página inteira numa linha só, e na pauta de 24/11/2026 achou 18 "projetos" — os apensados
 * citados no meio das ementas, escritos com sigla — dos 77 itens. A linha muda quando o pdf.js marca fim de
 * linha (hasEOL) ou quando a altura (y) do item muda.
 */
function textoComLinhas(itens) {
  let out = '', y = null;
  for (const it of itens || []) {
    const yi = it && it.transform ? it.transform[5] : null;
    if (y !== null && yi !== null && Math.abs(yi - y) > 2 && !out.endsWith('\n')) out += '\n';
    out += (it && it.str) || '';
    if (it && it.hasEOL) out += '\n'; else if (it && it.str && !/\s$/.test(it.str)) out += ' ';
    if (yi !== null) y = yi;
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

/**
 * Projetos da pauta oficial (PDF ou página): um por item numerado, com o número do item, o bloco e o regime.
 * Apensado citado na ementa não é item. O requerimento da própria comissão (sigla REQ) não vai à análise: a
 * busca na API por "REQ nº/ano" traria outro requerimento. Devolve a lista de refs, com .lido (a leitura
 * inteira, para pautaBlocosAplicar) e .requerimentos (os itens deixados de fora).
 */
function pautaRefsDoTexto(texto) {
  const lido = pautaBlocosDoTexto(texto);
  const nomeBloco = l => (lido.blocos.find(b => b.letra === l) || {}).nome || '';
  const refs = [], requerimentos = [], vistos = new Set();
  for (const it of lido.itens) {
    if (it.sigla === 'REQ') { requerimentos.push(it); continue; }
    if (vistos.has(it.chave)) continue; vistos.add(it.chave);
    refs.push({ sigla: it.sigla, numero: it.numero, ano: it.ano, chave: it.chave, redacaoFinal: /reda[çc][õo]es?\s+fina/i.test(nomeBloco(it.letra)), item: it.n, bloco: it.letra, ...(it.regime ? { regimeBloco: it.regime } : {}) });
  }
  refs.lido = lido; refs.requerimentos = requerimentos;
  return refs;
}

// ── PLANO B: O SITE DA CÂMARA QUANDO A API FALHA ────────────────────────────
// MEDIDO em 23/11/2026: a API de Dados Abertos devolvia 504 em qualquer endpoint (inclusive /orgaos/2003) e o
// calendário ficava vazio. O site continua no ar e traz o mesmo: a lista "Sessões e reuniões" filtrada pela CCJC
// (gerada no servidor, 20 eventos por página, ?pagina=N) e, na página de cada evento, o link da pauta oficial.

const _desent = s => String(s || '').replace(/&#x3D;/gi, '=').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&nbsp;/g, ' ');
const _limpo = s => _desent(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Endereço da lista "Sessões e reuniões" da CCJC entre duas datas (dd/mm/aaaa). */
function agendaCcjcUrl(inicio, fim, pagina = 1, idOrgao = 2003) {
  return `https://www.camara.leg.br/sessoesereunioes?idOrgaosSuperiores=${idOrgao}&dataInicial=${encodeURIComponent(inicio)}&dataFinal=${encodeURIComponent(fim)}${pagina > 1 ? `&pagina=${pagina}` : ''}`;
}

/** Eventos da lista "Sessões e reuniões": { total, eventos: [{ id, data (aaaa-mm-dd), hora (hh:mm), nome, tipo, situacao, local }] }. */
function agendaCcjcDoHtml(html) {
  const h = String(html || '');
  const total = Number((/Exibindo\s+\d+\s+a\s+\d+\s+de\s+(\d+)/i.exec(h) || [])[1] || 0);
  const eventos = [];
  for (const m of h.matchAll(/<li class="g-agenda__evento">([\s\S]*?)<\/li>/g)) {
    const li = m[1];
    const campo = c => _limpo((new RegExp(`class="g-agenda__${c}"[^>]*>([\\s\\S]*?)</(?:span|a)>`).exec(li) || [])[1]);
    const id = Number((/evento-legislativo\/(\d+)/.exec(li) || [])[1] || 0);
    const d = /(\d{2})\/(\d{2})\/(\d{4})/.exec(campo('data'));
    if (!id || !d) continue;
    const hm = /(\d{1,2})h(\d{2})?/.exec(campo('hora'));
    eventos.push({ id, data: `${d[3]}-${d[2]}-${d[1]}`, hora: hm ? `${hm[1].padStart(2, '0')}:${hm[2] || '00'}` : '', nome: campo('nome'), tipo: campo('tipo'), situacao: campo('situacao'), local: campo('local') });
  }
  return { total, eventos };
}

/** Link da pauta oficial (prop_mostrarintegra?codteor=…) na página do evento; '' se não houver. */
function linkPautaDoEvento(html) {
  const m = /href="([^"]+)"\s+class="[^"]*links-adicionais__link-pauta/.exec(String(html || ''))
    || /<a[^>]+href="([^"]*prop_mostrarintegra\?codteor[^"]*)"[^>]*>\s*Pauta\s*</i.exec(String(html || ''));
  return m ? _desent(m[1]).replace(/^http:/, 'https:') : '';
}

/** Reuniões do mês pelo site (todas as páginas), no formato do calendário: { 'aaaa-mm-dd': [evento] }.
 *  `opcoes` serve ao calendário do Plenário: { idOrgao: 180, deliberativa: ev => … } (padrão: CCJC, "Reunião Deliberativa"). */
async function buscarEventosMesSite(ano, mes, fetchFn = fetch, opcoes = {}) {
  const { idOrgao = 2003, deliberativa = ev => /reuni[ãa]o deliberativa/i.test(ev.tipo) } = opcoes;
  const dd = n => String(n).padStart(2, '0');
  const ini = `01/${dd(mes + 1)}/${ano}`, fim = `${new Date(ano, mes + 1, 0).getDate()}/${dd(mes + 1)}/${ano}`;
  const todos = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await fetchFn(agendaCcjcUrl(ini, fim, pagina, idOrgao));
    if (!r.ok) throw new Error(`site da Câmara: HTTP ${r.status}`);
    const { total, eventos } = agendaCcjcDoHtml(await r.text());
    todos.push(...eventos);
    if (!eventos.length || todos.length >= total) break;
  }
  const mapa = {};
  for (const ev of todos) {
    if (!deliberativa(ev)) continue;
    (mapa[ev.data] = mapa[ev.data] || []).push({ id: ev.id, dataHoraInicio: ev.hora ? `${ev.data}T${ev.hora}` : ev.data, dataHoraFim: '', descricao: ev.nome, situacao: ev.situacao, local: ev.local, fonte: 'site' });
  }
  return mapa;
}

/** Pauta oficial do evento pelo site: { url, lido } (lido de pautaBlocosDoTexto) ou null. */
async function pautaOficialDoEvento(eventoId, fetchFn = fetch) {
  const pg = await fetchFn(`https://www.camara.leg.br/evento-legislativo/${eventoId}`);
  if (!pg.ok) throw new Error(`página do evento: HTTP ${pg.status}`);
  const url = linkPautaDoEvento(await pg.text());
  if (!url) return null;
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`pauta oficial: HTTP ${r.status}`);
  const doc = new TextDecoder('windows-1252').decode(await r.arrayBuffer());
  return { url, texto: pautaTextoDoHtml(doc) };
}

/** HTML da pauta oficial → texto com uma linha por elemento (o que pautaBlocosDoTexto lê). */
function pautaTextoDoHtml(html) {
  const semScripts = String(html || '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  const comQuebras = semScripts.replace(/<[^>]+>/g, '\n');
  // entidades (&ccedil;, &ordm;…) pelo próprio navegador
  const doc = new DOMParser().parseFromString(`<!doctype html><body><pre>${comQuebras.replace(/</g, '&lt;')}</pre>`, 'text/html');
  return doc.body.textContent;
}

/**
 * Aplica os blocos lidos à pauta: cada projeto ganha item (nº oficial), bloco (letra)
 * e regime; a pauta guarda os blocos. Casamento pela sigla/número/ano; sem casamento,
 * o número que a API já deu (ordem) fica. Devolve quantos projetos casaram.
 */
function pautaBlocosAplicar(pauta, lido, fonte) {
  const porChave = new Map(lido.itens.map(it => [it.chave, it]));
  const porNumero = new Map(lido.itens.map(it => [it.n, it]));
  let casados = 0;
  for (const p of pauta.projetos || []) {
    const it = porChave.get(`${p.sigla} ${p.numero}/${p.ano}`) || (p.item && porNumero.get(p.item)?.chave === `${p.sigla} ${p.numero}/${p.ano}` ? porNumero.get(p.item) : null);
    if (!it) continue;
    p.item = it.n; p.bloco = it.letra; if (it.regime) p.regimeBloco = it.regime;
    casados++;
  }
  pauta.blocos = lido.blocos;
  pauta.blocosFonte = fonte;
  return casados;
}

/** Sem a pauta oficial: blocos pelos tópicos da API (sem letra), na ordem em que aparecem. */
function pautaBlocosDaApi(pauta) {
  const projs = pauta.projetos || [];
  if (!projs.some(p => p.topico)) return false;
  const nomes = [];
  for (const p of projs) if (p.topico && !nomes.includes(p.topico)) nomes.push(p.topico);
  pauta.blocos = nomes.map(nome => ({ letra: '', nome }));
  for (const p of projs) p.bloco = p.topico || '';
  pauta.blocosFonte = 'api';
  return true;
}

/**
 * Garante os blocos da pauta: lê a pauta oficial da reunião (pauta do calendário) e,
 * se ela não vier, usa os tópicos da API. Só busca uma vez por pauta.
 */
async function garantirBlocosPauta(pauta) {
  if (!pauta || pauta.blocosFonte === 'oficial') return pauta?.blocos || null;
  const ev = pauta.origem?.eventoId;
  if (ev) {
    try {
      const of = await pautaOficialDoEvento(ev);
      if (of) {
        const lido = pautaBlocosDoTexto(of.texto);
        if (lido.blocos.length && lido.itens.length && pautaBlocosAplicar(pauta, lido, 'oficial')) {
          pauta.blocosUrl = of.url;
          try { salvarPauta(); } catch (_) {}
          return pauta.blocos;
        }
      }
    } catch (e) { console.warn('[CCJC] pauta oficial (blocos):', e.message); }
  }
  if (pauta.blocosFonte !== 'api' && pautaBlocosDaApi(pauta)) { try { salvarPauta(); } catch (_) {} }
  return pauta.blocos || null;
}

// ── texto da visão geral ────────────────────────────────────────────────────
/** ["a", "b", "c"] → "a, b e c" (sem mexer nas vírgulas de dentro de cada parte). */
const juntar = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0] || '');
/** [1,2,3,5,7,8] → "1 a 3, 5 e 7 a 8" (com "item"/"itens" na frente quando pedido). */
function faixasItens(nums, comPalavra = true) {
  const v = [...new Set(nums.filter(n => Number.isFinite(n)))].sort((a, b) => a - b);
  if (!v.length) return '';
  const fx = [];
  for (const n of v) { const u = fx[fx.length - 1]; if (u && n === u[1] + 1) u[1] = n; else fx.push([n, n]); }
  // dois seguidos não viram faixa: "1 e 2", não "1 a 2"
  const partes = fx.flatMap(([a, b]) => (a === b ? [`${a}`] : b === a + 1 ? [`${a}`, `${b}`] : [`${a} a ${b}`]));
  const txt = juntar(partes);
  return comPalavra ? `${v.length === 1 ? 'item' : 'itens'} ${txt}` : txt;
}
const blocoDe = (pauta, p) => (pauta.blocos || []).find(b => (b.letra || b.nome) === p.bloco) || null;
const blocoRotulo = b => (b ? (b.letra ? `${b.letra} – ${b.nome}` : b.nome) : '');
const ehBlocoRF = b => !!b && /reda[çc][õo]es?\s+finais?|reda[çc][ãa]o\s+final/i.test(b.nome);
const numerosItens = ps => ps.map(p => p.item).filter(Number.isFinite);
const numeroItem = (p, idx) => (Number.isFinite(p.item) ? p.item : idx + 1);

/**
 * Os parágrafos de abertura da visão geral, quando a pauta tem blocos e números:
 *  · os blocos e as faixas de itens de cada um;
 *  · onde estão os itens comentados e o que são os sem análise (blocos de rotina);
 *  · os itens do Podemos, com número e bloco.
 * comAnalise(p) → o item tem análise; rotina(p) → PDL de rádio e TV. Devolve null sem blocos.
 */
function pautaVisaoGeral(pauta, { comAnalise, rotina, posGov = () => '', remissao = '' }) {
  const projs = pauta.projetos || [];
  const blocos = pauta.blocos || [];
  if (!blocos.length || !projs.some(p => Number.isFinite(p.item))) return null;
  const n = (k, um, varios) => `${k} ${k === 1 ? um : varios}`;
  const porBloco = blocos.map(b => ({ b, ps: projs.filter(p => p.bloco === (b.letra || b.nome)) })).filter(x => x.ps.length);
  const extenso = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis'];
  const qtd = k => extenso[k] || String(k);
  const nomeB = x => `<b>${escHtml(blocoRotulo(x.b))}</b> (${faixasItens(numerosItens(x.ps))})`;
  const p1 = porBloco.length === 1
    ? `A pauta tem ${n(projs.length, 'item', 'itens')}, todos no bloco ${nomeB(porBloco[0])}.`
    : `A pauta tem ${n(projs.length, 'item', 'itens')}, organizados em ${qtd(porBloco.length)} blocos: ${juntar(porBloco.map(nomeB))}.`;

  const com = projs.filter(comAnalise), sem = projs.filter(p => !comAnalise(p));
  const letra = x => x.b.letra || `“${x.b.nome}”`;
  const ondeCom = porBloco.map(x => ({ x, ps: x.ps.filter(comAnalise) })).filter(o => o.ps.length);
  const frases = [];
  if (com.length) {
    const lista = juntar(ondeCom.map(o => `${letra(o.x)} (${faixasItens(numerosItens(o.ps))})`));
    frases.push(com.length === 1
      ? `O <b>item comentado</b> está no bloco ${lista}.`
      : `Os <b>${com.length} itens comentados</b> estão ${ondeCom.length === 1 ? 'no bloco' : 'nos blocos'} ${lista}.`);
  }
  if (sem.length) {
    // grupos de rotina: redações finais e PDLs de rádio e TV; o resto, pelo nome
    const rf = sem.filter(p => ehBlocoRF(blocoDe(pauta, p)));
    const radio = sem.filter(p => !rf.includes(p) && rotina(p));
    const outros = sem.filter(p => !rf.includes(p) && !radio.includes(p));
    const prazo = radio.length && radio.every(p => /prazo constitucional|223/i.test(p.regimeBloco || p.regime || p.topico || ''));
    const grupos = [];
    if (rf.length) grupos.push(`${rf.length === 1 ? 'a <b>redação final</b>' : `as <b>${rf.length} redações finais</b>`} (${faixasItens(numerosItens(rf))})`);
    if (radio.length) grupos.push(`${radio.length === 1 ? 'o <b>PDL de radiodifusão' : `os <b>${radio.length} PDLs de radiodifusão`}${prazo ? ' com prazo constitucional' : ''}</b> (${faixasItens(numerosItens(radio))})`);
    const cab = sem.length === 1 ? 'O <b>item sem análise</b>' : `Os <b>${sem.length} itens sem análise</b>`;
    if (!outros.length && grupos.length === 2) frases.push(`${cab} ${sem.length === 1 ? 'pertence' : 'pertencem todos'} a um de dois blocos de rotina: ${grupos.join(' e ')}.`);
    else if (!outros.length && grupos.length === 1) frases.push(`${cab} ${sem.length === 1 ? 'é' : 'são'} ${grupos[0].replace(/^(as|os|a|o) /, '')}, matéria de rotina.`);
    else {
      // misto: "Dos 120 itens sem análise, 115 são PDLs de radiodifusão… (itens …) e 5 são outros itens (itens …)."
      const parte = (ps, um, varios) => ps.length ? `${ps.length} ${ps.length === 1 ? `é ${um}` : `são ${varios}`} (${faixasItens(numerosItens(ps))})` : '';
      const partes = [parte(rf, 'redação final', 'redações finais'),
        parte(radio, `PDL de radiodifusão${prazo ? ' com prazo constitucional' : ''}`, `PDLs de radiodifusão${prazo ? ' com prazo constitucional' : ''}`),
        parte(outros, rf.length || radio.length ? 'outro item' : 'item', rf.length || radio.length ? 'outros itens' : 'itens')].filter(Boolean);
      frases.push(`Dos ${n(sem.length, 'item', 'itens')} sem análise, ${juntar(partes)}.`);
    }
    if (remissao) frases.push(remissao);
  }
  const p2 = frases.join(' ');

  const rel = projs.filter(p => p.relatoria === 'pode'), aut = projs.filter(p => p.autoria?.podemos);
  const ondeBloco = p => { const b = blocoDe(pauta, p); return b ? (ehBlocoRF(b) ? ', no bloco de Redação Final' : `, no bloco ${escHtml(b.letra ? `${b.letra} (${b.nome})` : b.nome)}`) : ''; };
  const doPode = (ps, papel) => ps.length ? `${ps.length === 1 ? `Há um item sob ${papel} do Podemos` : `Há ${ps.length} itens sob ${papel} do Podemos`}: ${ps.map(p =>
    `<b>${Number.isFinite(p.item) ? `item ${p.item} – ` : ''}${escHtml(p.chave)}</b>${p.relator && papel === 'relatoria' ? ` (dep. ${escHtml(p.relator)})` : ''}${ondeBloco(p)}${posGov(p)}`).join('; ')}.` : '';
  const p3 = [doPode(rel, 'relatoria'), doPode(aut, 'autoria')].filter(Boolean).join(' ');
  return { p1, p2, p3 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { agendaCcjcUrl, agendaCcjcDoHtml, linkPautaDoEvento, buscarEventosMesSite, pautaOficialDoEvento, textoComLinhas, pautaRefsDoTexto, pautaBlocosDoTexto, pautaBlocosAplicar, pautaBlocosDaApi, faixasItens, pautaVisaoGeral, blocoDe, blocoRotulo, ehBlocoRF, numeroItem };
}
