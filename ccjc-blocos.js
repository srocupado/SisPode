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
      const pg = await fetch(`https://www.camara.leg.br/evento-legislativo/${ev}`);
      const html = pg.ok ? await pg.text() : '';
      const m = /href="([^"]+)"\s+class="[^"]*links-adicionais__link-pauta/.exec(html);
      if (m) {
        const url = m[1].replace(/&#x3D;/g, '=').replace(/&amp;/g, '&').replace(/^http:/, 'https:');
        const r = await fetch(url);
        if (r.ok) {
          const doc = new TextDecoder('windows-1252').decode(await r.arrayBuffer());
          const lido = pautaBlocosDoTexto(pautaTextoDoHtml(doc));
          if (lido.blocos.length && lido.itens.length && pautaBlocosAplicar(pauta, lido, 'oficial')) {
            pauta.blocosUrl = url;
            try { salvarPauta(); } catch (_) {}
            return pauta.blocos;
          }
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
  module.exports = { pautaBlocosDoTexto, pautaBlocosAplicar, pautaBlocosDaApi, faixasItens, pautaVisaoGeral, blocoDe, blocoRotulo, ehBlocoRF, numeroItem };
}
