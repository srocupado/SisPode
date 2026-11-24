// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';

// ── COMISSÕES · PEDIDOS DE VAGAS ─────────────────────────────────────────────
// Registro de quais deputados pediram vaga em quais Comissões Permanentes (pedido de 24/11/2026): tipo de vaga
// (titular ou suplente), ordem de preferência do deputado e situação (pendente, atendido, negado), com histórico.
// Lista própria no Firebase (/comissoes-podemos/pedidos-vagas), separada dos "Pedidos" do painel de cada comissão.
// Além das Permanentes, a CMO e o Parlasul (comissões mistas do Congresso; PV_COMISSOES_MISTAS) — 24/11/2026.
//
// INACUMULABILIDADE NO REGISTRO (RICD, art. 26, § 2º): "Nenhum Deputado poderá fazer parte, como membro titular,
// de mais de uma Comissão Permanente, ressalvadas" as quinze que o parágrafo enumera. As que NÃO estão ressalvadas
// são as de GRUPOS_INCOMPATIVEIS (comissoes.js) — a mesma regra que já barra a nomeação de titular. O pedido de
// titular numa delas, quando o deputado já é titular em outra (pela composição registrada no módulo ou por pedido de
// titular já atendido), é um CONFLITO. Desde 24/11/2026 (pedido da Liderança) o conflito NÃO impede o registro: quem
// cadastra é alertado (aviso no formulário e confirmação ao registrar) e a lista mostra, ao lado do nome do deputado,
// com qual colegiado é o conflito — o deputado pode estar deixando a outra comissão, e o pedido precisa ficar anotado.
// O conflito da lista é calculado na hora (some quando a outra titularidade deixa de existir); o registro guarda
// também os colegiados em conflito no momento do cadastro (conflitoRegistro). Vários pedidos pendentes de titular em
// inacumuláveis não são conflito: são opções do deputado, em ordem de preferência, e só uma pode ser atendida.
//
// LEGISLATURA E DEPUTADO DIGITADO (24/11/2026): chegam pedidos para a PRÓXIMA legislatura, de deputados que ainda não
// estão no cadastro do módulo. O pedido guarda a legislatura; o deputado pode ser digitado (nome e UF) — vira um id
// "m_<nome>", e o mesmo nome digitado de novo é o mesmo deputado (o nome de um deputado cadastrado aponta para ele).
// Na legislatura ATUAL, a titularidade vem da composição registrada no módulo e dos pedidos atendidos; na PRÓXIMA,
// só dos pedidos de titular atendidos para ela — a composição de hoje não vale para a legislatura que vem (o reeleito
// titular na CCJC agora pode pedir a CFT para a próxima). Pedido sem legislatura (gravado antes) é da atual.
//
// ATENDIDO NOMEIA (24/11/2026): marcar um pedido como "Atendido" já nomeia o deputado na composição da comissão
// (titular ou suplente; o suplente que passa a titular sai da suplência da mesma comissão), numa gravação só. Não
// nomeia — e pergunta se marca atendido assim mesmo — quando não há vaga do partido ou quando a titularidade esbarra
// na inacumulabilidade (a composição continua barrando, como sempre). Pedido da próxima legislatura e deputado
// digitado (fora do cadastro) são só marcados: não há composição a lançar. O pedido guarda a nomeação
// (`nomeacao`), e reabrir ou negar um atendido que nomeou pergunta se tira o deputado da composição.
//
// RELATÓRIO (24/11/2026): PDF dos pedidos do filtro da tela (situação), por legislatura, com uma parte POR COMISSÃO
// (pedidos de cada colegiado, vagas do partido na legislatura atual, conflitos) e outra POR DEPUTADO (comissões
// pedidas em ordem de preferência). pvHtmlRelatorio é pura (testada em Node).
//
// Usa de comissoes.js (na página): state, COMISSOES_PERMANENTES, GRUPOS_INCOMPATIVEIS, comissoesDeDeputado,
// fbPut, fbDelete, mostrarToast, gravarMembros, removerMembro,
// vagasDisponiveis, vagasEfetivas, comissaoConflitante. As regras (pvValidar…) são puras e exportadas para os testes (Node).

const PV_SITUACOES = { pendente: 'Pendente', atendido: 'Atendido', negado: 'Negado' };
const PV_TIPOS = { titular: 'Titular', suplente: 'Suplente' };
const PV_MAX_PREFERENCIA = 10;
// Comissões mistas do Congresso em que a Liderança também recebe pedidos de vaga (24/11/2026). Não estão sujeitas ao
// art. 26, § 2º, do RICD (que trata das Permanentes da Câmara) e não têm composição registrada neste módulo: o pedido
// atendido é só marcado, sem nomeação, e o relatório não mostra vagas livres para elas.
const PV_COMISSOES_MISTAS = [
  { sigla: 'CMO',      nome: 'Comissão Mista de Planos, Orçamentos Públicos e Fiscalização', mista: true },
  { sigla: 'PARLASUL', nome: 'Representação Brasileira no Parlamento do Mercosul', mista: true },
];
const pvEhMista = sigla => PV_COMISSOES_MISTAS.some(c => c.sigla === sigla);

/** Legislatura de uma data (a legislatura começa em 1º de fevereiro do ano seguinte à eleição: 57ª = 2023–2027). */
function pvLegislaturaDe(data = new Date()) {
  const ano = data.getMonth() >= 1 ? data.getFullYear() : data.getFullYear() - 1;
  return Math.floor((ano - 1795) / 4);
}
/** Legislatura que o formulário oferece primeiro: a próxima, de outubro do ano da eleição em diante; senão, a atual. */
function pvLegislaturaPadrao(data = new Date()) {
  const leg = pvLegislaturaDe(data);
  const anoEleicao = 1795 + 4 * leg + 3;   // 57ª → 2026
  return data.getFullYear() === anoEleicao && data.getMonth() >= 9 ? leg + 1 : leg;
}
const pvLegDe = (p, legAtual) => Number(p.legislatura) || legAtual;
/** Id do deputado digitado: o mesmo nome (sem acento e caixa) dá o mesmo id. */
function pvIdManual(nome) {
  return 'm_' + String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/** Deputado do pedido digitado: se o nome é o de um deputado cadastrado, é ele; senão, o id do nome. */
function pvResolverManual(nome, deputados) {
  const chave = pvIdManual(nome);
  const cad = Object.entries(deputados || {}).find(([, d]) => pvIdManual(d.nome) === chave);
  return cad ? { depId: cad[0], cadastrado: true } : { depId: chave, cadastrado: false };
}

/** Comissão Permanente sujeita à inacumulabilidade do art. 26, § 2º (não ressalvada). */
function pvInacumulavel(sigla, grupos) {
  return grupos.some(g => g.includes(sigla));
}

/**
 * Conflitos de inacumulabilidade de um pedido de titular: as OUTRAS inacumuláveis em que o deputado já é titular, na
 * legislatura do pedido — pela composição do módulo (só na atual) ou por pedido de titular atendido (exceto o próprio,
 * `p.id`). Devolve [{ sigla, origem: 'composicao' | 'atendido' }] (vazio = sem conflito).
 */
function pvConflitosInacumulaveis(p, ctx) {
  if (p.tipo !== 'titular' || !pvInacumulavel(p.sigla, ctx.grupos)) return [];
  const leg = pvLegDe(p, ctx.legAtual);
  const titulares = leg === ctx.legAtual && ctx.membrosDe ? (ctx.membrosDe(p.depId) || {}).titulares || [] : [];
  const atendidos = ctx.pedidos.filter(x => (p.id == null || x.id !== p.id) && x.depId === p.depId && x.tipo === 'titular' && x.situacao === 'atendido' && pvLegDe(x, ctx.legAtual) === leg).map(x => x.sigla);
  const out = [];
  for (const s of titulares) if (s !== p.sigla && pvInacumulavel(s, ctx.grupos) && !out.some(c => c.sigla === s)) out.push({ sigla: s, origem: 'composicao' });
  for (const s of atendidos) if (s !== p.sigla && pvInacumulavel(s, ctx.grupos) && !out.some(c => c.sigla === s)) out.push({ sigla: s, origem: 'atendido' });
  return out;
}

/** Texto do alerta de inacumulabilidade (formulário, confirmação e dica da lista). */
function pvTextoConflito(conflitos, sigla, leg) {
  if (!conflitos.length) return '';
  const onde = conflitos.map(c => c.origem === 'composicao' ? c.sigla : `${c.sigla} (pedido atendido, ${leg}ª legislatura)`).join(', ');
  return `Inacumulabilidade (RICD, art. 26, § 2º): o deputado já é titular em ${onde}, e ${sigla} também é comissão em que só se pode ser ` +
    `titular de uma. O pedido pode ser registrado, e fica marcado com o conflito; para ser atendido, ele precisa deixar a titularidade em ${conflitos.map(c => c.sigla).join(', ')}.`;
}

/**
 * Valida um pedido novo. `ctx`: { permanentes: [{sigla, nome}], grupos, membrosDe(depId) → {titulares, suplentes},
 * pedidos: [{depId, sigla, tipo, situacao, legislatura}], legAtual }. Devolve { ok: true, conflitos, alerta } ou
 * { ok: false, erro }. A inacumulabilidade não recusa: vem em `conflitos` (e no texto `alerta`) para avisar quem cadastra.
 */
function pvValidarPedido(p, ctx) {
  const com = ctx.permanentes.find(c => c.sigla === p.sigla);
  if (!p.depId) return { ok: false, erro: 'Escolha o deputado.' };
  if (!com) return { ok: false, erro: 'Escolha a comissão (Permanente da Câmara, CMO ou Parlasul).' };
  if (!PV_TIPOS[p.tipo]) return { ok: false, erro: 'Escolha o tipo de vaga (titular ou suplente).' };
  const ordem = Number(p.ordem);
  if (!Number.isInteger(ordem) || ordem < 1 || ordem > PV_MAX_PREFERENCIA) return { ok: false, erro: `A preferência vai de 1 a ${PV_MAX_PREFERENCIA}.` };

  const leg = pvLegDe(p, ctx.legAtual);
  if (leg < ctx.legAtual || leg > ctx.legAtual + 1) return { ok: false, erro: `Legislatura inválida: os pedidos são para a ${ctx.legAtual}ª (atual) ou a ${ctx.legAtual + 1}ª (próxima).` };
  if (p.depManual && String(p.depNome || '').trim().length < 3) return { ok: false, erro: 'Digite o nome do deputado.' };
  // só os pedidos da MESMA legislatura contam
  const mesmos = ctx.pedidos.filter(x => pvLegDe(x, ctx.legAtual) === leg);
  const dup = mesmos.find(x => x.depId === p.depId && x.sigla === p.sigla && x.tipo === p.tipo && x.situacao === 'pendente');
  if (dup) return { ok: false, erro: `Já há um pedido pendente de ${p.tipo} em ${p.sigla} para este deputado na ${leg}ª legislatura.` };

  // composição registrada no módulo: só na legislatura atual
  const { titulares, suplentes } = leg === ctx.legAtual ? ctx.membrosDe(p.depId) : { titulares: [], suplentes: [] };
  if (titulares.includes(p.sigla)) return { ok: false, erro: `O deputado já é titular em ${p.sigla}.` };
  if (p.tipo === 'suplente' && suplentes.includes(p.sigla)) return { ok: false, erro: `O deputado já é suplente em ${p.sigla}.` };

  // inacumulabilidade: alerta, não recusa (titularidade no módulo ou pedido de titular já atendido)
  const conflitos = pvConflitosInacumulaveis(p, ctx);
  return { ok: true, conflitos, alerta: pvTextoConflito(conflitos, p.sigla, leg) };
}

/** Próxima preferência livre do deputado (entre os pedidos pendentes). */
function pvProximaOrdem(depId, pedidos, leg = null, legAtual = null) {
  const usadas = new Set(pedidos.filter(x => x.depId === depId && x.situacao === 'pendente' && (leg == null || pvLegDe(x, legAtual) === leg)).map(x => Number(x.ordem)));
  for (let i = 1; i <= PV_MAX_PREFERENCIA; i++) if (!usadas.has(i)) return i;
  return PV_MAX_PREFERENCIA;
}

/** Registro novo, como vai para o Firebase. */
function pvNovoRegistro(p, agoraIso) {
  return { depId: p.depId, sigla: p.sigla, tipo: p.tipo, ordem: Number(p.ordem), legislatura: Number(p.legislatura), situacao: 'pendente', data: agoraIso,
    historico: [{ situacao: 'pendente', em: agoraIso }],
    ...(p.conflitos && p.conflitos.length ? { conflitoRegistro: p.conflitos.map(c => c.sigla) } : {}),
    ...(p.depManual ? { depNome: String(p.depNome).trim(), depUf: String(p.depUf || '').trim().toUpperCase() } : {}) };
}

/** Muda a situação, acrescentando ao histórico. */
function pvComSituacao(reg, situacao, agoraIso) {
  return Object.assign({}, reg, { situacao, historico: [...(reg.historico || []), { situacao, em: agoraIso }] });
}

/**
 * O que fazer ao marcar um pedido como atendido. `c`: { legAtual, cadastrado, membros: {titulares, suplentes} do
 * deputado, vagasLivres(sigla, tipo), conflito(depId, sigla) → sigla|null }. Devolve
 * { acao: 'nomear' | 'ja' | 'bloqueio' | 'so-marcar', motivo, sairDaSuplencia }.
 */
function pvPlanoAtendimento(reg, c) {
  const leg = pvLegDe(reg, c.legAtual);
  if (pvEhMista(reg.sigla)) return { acao: 'so-marcar', motivo: `${reg.sigla} é comissão mista do Congresso: a composição dela não é lançada neste módulo` };
  if (leg !== c.legAtual) return { acao: 'so-marcar', motivo: `pedido para a ${leg}ª legislatura: a composição dela ainda não existe` };
  if (!c.cadastrado) return { acao: 'so-marcar', motivo: 'deputado digitado, fora do cadastro do módulo: cadastre-o para nomear' };
  const { titulares = [], suplentes = [] } = c.membros || {};
  if (reg.tipo === 'titular' && titulares.includes(reg.sigla)) return { acao: 'ja', motivo: `já é titular em ${reg.sigla}` };
  if (reg.tipo === 'suplente' && suplentes.includes(reg.sigla)) return { acao: 'ja', motivo: `já é suplente em ${reg.sigla}` };
  if (reg.tipo === 'suplente' && titulares.includes(reg.sigla)) return { acao: 'bloqueio', motivo: `já é titular em ${reg.sigla}` };
  if (reg.tipo === 'titular') {
    const conf = c.conflito(reg.depId, reg.sigla);
    if (conf) return { acao: 'bloqueio', motivo: `já é titular em ${conf}, comissão inacumulável com ${reg.sigla} (RICD, art. 26, § 2º)` };
  }
  if (c.vagasLivres(reg.sigla, reg.tipo) <= 0) return { acao: 'bloqueio', motivo: `não há vaga de ${reg.tipo} do partido livre em ${reg.sigla}` };
  return { acao: 'nomear', sairDaSuplencia: reg.tipo === 'titular' && suplentes.includes(reg.sigla) };
}

const PV_CSS_PDF = `
  @page { size: A4; margin: 15mm 14mm; @bottom-center { content: counter(page); font-size: 8pt; color: #888; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #1a1a1a; background: #fff; }
  .cab { display: flex; align-items: center; gap: 14px; }
  .cab .tit { flex: 1; text-align: center; }
  .cab h1 { font-size: 15pt; color: #003c1f; }
  .cab .sub { font-size: 9.5pt; color: #003c1f; margin-top: 2px; }
  .cab img { height: 42px; } .cab .sp { width: 42px; }
  .rule { border-bottom: 2px solid #00A859; margin: 7px 0 10px; }
  .meta { text-align: center; font-style: italic; font-size: 8.5pt; color: #6b7280; margin-bottom: 14px; }
  .leg { font-size: 13pt; color: #003c1f; margin: 4px 0 8px; padding-bottom: 3px; border-bottom: 1px solid #c9ddd2; }
  .quebra { break-before: page; page-break-before: always; }
  h2 { font-size: 11.5pt; color: #003c1f; margin: 16px 0 6px; border-left: 3px solid #00A859; padding-left: 7px; break-after: avoid; page-break-after: avoid; }
  h3 { font-size: 10pt; color: #003c1f; margin: 12px 0 3px; break-after: avoid; page-break-after: avoid; }
  h3 .nm { font-weight: 400; color: #3c4a44; }
  .bloco { break-inside: avoid; page-break-inside: avoid; }
  .vg { font-size: 8.5pt; color: #4a5a6b; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th { background: #eef4f0; color: #003c1f; font-size: 8pt; text-transform: uppercase; letter-spacing: .3px; padding: 4px 6px; text-align: left; border-bottom: 1.5px solid #c9ddd2; }
  td { padding: 5px 6px; border-bottom: 1px solid #e6eae7; vertical-align: top; font-size: 9pt; }
  td.c, th.c { text-align: center; white-space: nowrap; }
  .nada { color: #9aa5a0; }
  .tag { display: inline-block; font-size: 7.5pt; font-weight: 700; padding: 0 6px; border-radius: 999px; border: 1px solid; white-space: nowrap; }
  .t-pendente { color: #8a6d00; border-color: #e8d28a; background: #fdf7e3; }
  .t-atendido { color: #006633; border-color: #9ed7b6; background: #eaf7f0; }
  .t-negado   { color: #6b7280; border-color: #d8dcda; background: #f4f5f4; }
  .t-conf     { color: #fff; border-color: #c0392b; background: #c0392b; }
  .t-inac     { color: #8a6d00; border-color: #e8d28a; background: #fff; font-weight: 400; }
  .resumo { display: flex; gap: 10px; margin: 4px 0 12px; }
  .bx { flex: 1; border: 1px solid #d8e3dc; border-radius: 6px; padding: 9px 5px; text-align: center; }
  .bx .v { font-size: 17pt; font-weight: 700; color: #003c1f; }
  .bx .l { font-size: 7pt; text-transform: uppercase; letter-spacing: .3px; color: #6b7280; margin-top: 2px; line-height: 1.25; }
  .nota { font-size: 8.5pt; color: #444; background: #f7f9f8; border-left: 3px solid #c9ddd2; padding: 8px 10px; margin: 8px 0; line-height: 1.5; }
  .nota b { color: #003c1f; }
`;

/**
 * HTML do relatório (PDF). `lista`: os pedidos do filtro; `c`: { todos (para os conflitos), permanentes, grupos,
 * membrosDe, legAtual, deputadoDe(x) → {nome, uf, manual}, vagas(sigla, tipo) → {livres, total}, filtroRotulo,
 * hojeBR, logo }.
 */
function pvHtmlRelatorio(lista, c) {
  const e = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const SIT = { pendente: 'Pendente', atendido: 'Atendido', negado: 'Negado' };
  const ctxConf = { permanentes: c.permanentes, grupos: c.grupos, membrosDe: c.membrosDe, pedidos: c.todos, legAtual: c.legAtual };
  const conflitos = x => (x.situacao === 'negado' ? [] : pvConflitosInacumulaveis(x, ctxConf));
  const selosConf = x => conflitos(x).map(k => ` <span class="tag t-conf">⚠ ${e(k.sigla)}</span>`).join('');
  const nomeCom = s => (c.permanentes.find(k => k.sigla === s) || {}).nome || s;
  const inac = s => (pvInacumulavel(s, c.grupos) ? ' <span class="tag t-inac">inacumulável</span>' : '');
  const sit = x => `<span class="tag t-${e(x.situacao)}">${e(SIT[x.situacao] || x.situacao)}</span>${x.nomeacao ? ' <span class="nada">· nomeado</span>' : ''}`;
  const dataBR = iso => (iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '');
  const depTxt = x => { const d = c.deputadoDe(x); return `${e(d.nome)}${d.uf ? ` <span class="nada">(${e(d.uf)})</span>` : ''}${d.manual ? ' <span class="nada">· digitado</span>' : ''}`; };
  const ordNome = (a, b) => c.deputadoDe(a).nome.localeCompare(c.deputadoDe(b).nome, 'pt-BR');

  const legs = [...new Set(lista.map(x => pvLegDe(x, c.legAtual)))].sort((a, b) => a - b);
  const partes = legs.map((leg, i) => {
    const doLeg = lista.filter(x => pvLegDe(x, c.legAtual) === leg);
    const atual = leg === c.legAtual;
    const deps = [...new Set(doLeg.map(x => x.depId))];
    const coms = c.permanentes.filter(k => doLeg.some(x => x.sigla === k.sigla));
    const nConf = doLeg.filter(x => conflitos(x).length).length;
    const caixas = [[doLeg.length, 'pedidos'], [deps.length, 'deputados'], [coms.length, 'comissões pedidas'], [nConf, 'pedidos com conflito de inacumulabilidade']];

    const porComissao = coms.map(k => {
      const ps = doLeg.filter(x => x.sigla === k.sigla).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'titular' ? -1 : 1) || a.ordem - b.ordem || ordNome(a, b));
      const nT = ps.filter(x => x.tipo === 'titular').length, nS = ps.length - nT;
      let vg = `${nT} pedido(s) de titular · ${nS} de suplente`;
      if (atual && c.vagas && !pvEhMista(k.sigla)) {
        const vt = c.vagas(k.sigla, 'titular'), vs = c.vagas(k.sigla, 'suplente');
        vg += ` — vagas do partido livres hoje: titular ${vt.livres} de ${vt.total}, suplente ${vs.livres} de ${vs.total}`;
      }
      return `<div class="bloco"><h3>${e(k.sigla)} <span class="nm">· ${e(k.nome)}</span>${inac(k.sigla)}</h3><div class="vg">${vg}</div>
<table><thead><tr><th>Deputado</th><th class="c">Vaga</th><th class="c">Pref.</th><th class="c">Situação</th><th class="c">Registrado</th></tr></thead><tbody>
${ps.map(x => `<tr><td>${depTxt(x)}${selosConf(x)}</td><td class="c">${x.tipo === 'titular' ? 'Titular' : 'Suplente'}</td><td class="c">${x.ordem}ª</td><td class="c">${sit(x)}</td><td class="c">${dataBR(x.data)}</td></tr>`).join('')}
</tbody></table></div>`;
    }).join('');

    const porDeputado = deps.map(id => doLeg.find(x => x.depId === id)).sort(ordNome).map(ref => {
      const ps = doLeg.filter(x => x.depId === ref.depId).sort((a, b) => a.ordem - b.ordem || String(a.data).localeCompare(String(b.data)));
      let hoje = '';
      if (atual && !c.deputadoDe(ref).manual) {
        const m = c.membrosDe(ref.depId) || {};
        hoje = `<div class="vg">Hoje: titular em ${(m.titulares || []).length ? m.titulares.map(e).join(', ') : 'nenhuma'} · suplente em ${(m.suplentes || []).length ? m.suplentes.map(e).join(', ') : 'nenhuma'}</div>`;
      }
      return `<div class="bloco"><h3>${depTxt(ref)}</h3>${hoje}
<table><thead><tr><th class="c">Pref.</th><th>Comissão</th><th class="c">Vaga</th><th class="c">Situação</th><th>Conflito</th></tr></thead><tbody>
${ps.map(x => `<tr><td class="c">${x.ordem}ª</td><td><b>${e(x.sigla)}</b> <span class="nada">${e(nomeCom(x.sigla))}</span>${inac(x.sigla)}</td><td class="c">${x.tipo === 'titular' ? 'Titular' : 'Suplente'}</td><td class="c">${sit(x)}</td><td>${selosConf(x).trim() || '<span class="nada">—</span>'}</td></tr>`).join('')}
</tbody></table></div>`;
    }).join('');

    return `${i ? '<div class="quebra"></div>' : ''}<div class="leg">${leg}ª legislatura${atual ? ' (atual)' : leg > c.legAtual ? ' (próxima)' : ''}</div>
<div class="resumo">${caixas.map(([v, l]) => `<div class="bx"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
<h2>Por comissão</h2>${porComissao}
<h2>Por deputado</h2>${porDeputado}`;
  }).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedidos de vagas — Comissões</title><style>${PV_CSS_PDF}</style></head><body>
<div class="cab">${c.logo ? `<img src="${c.logo}" alt="">` : '<div class="sp"></div>'}<div class="tit"><h1>Pedidos de vagas nas Comissões</h1>
<div class="sub">Permanentes da Câmara, CMO e Parlasul · Liderança do Podemos · Câmara dos Deputados</div></div><div class="sp"></div></div><div class="rule"></div>
<div class="meta">Pedidos ${e(c.filtroRotulo)} · ${lista.length} pedido(s) · gerado em ${e(c.hojeBR)}</div>
${lista.length ? partes : '<p class="nada">Nenhum pedido neste filtro.</p>'}
<h2>Nota</h2><div class="nota"><b>Inacumulabilidade (RICD, art. 26, § 2º):</b> o deputado só pode ser titular de uma das Comissões Permanentes não ressalvadas
(marcadas "inacumulável"). O selo vermelho <span class="tag t-conf">⚠ SIGLA</span> indica o colegiado em que ele já é titular — pela composição registrada
no módulo (legislatura atual) ou por pedido de titular já atendido na mesma legislatura. <b>Preferência</b>: a ordem dada pelo próprio deputado.
<b>Vagas do partido livres</b>: as vagas do Podemos configuradas no módulo, menos as já preenchidas (só na legislatura atual; a CMO e o Parlasul,
comissões mistas do Congresso, não têm composição no módulo nem limite de inacumulabilidade do RICD).</div>
<div class="meta" style="margin-top:14px">Gerado pelo SisPode · ${e(c.hojeBR)}</div></body></html>`;
}

// ── TELA ─────────────────────────────────────────────────────────────────────
const _pvEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _pvData = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
let pvFiltro = 'pendente';

function pvLista() {
  return Object.entries(state.pedidosVagas || {}).map(([id, r]) => Object.assign({ id }, r));
}

/** Nome e UF do deputado do pedido: o cadastro do módulo; para o digitado, o que foi gravado no pedido. */
function pvDeputado(x) {
  const d = state.deputados[x.depId];
  if (d) return { nome: d.nome, uf: d.uf || '', manual: false };
  if (x.depNome) return { nome: x.depNome, uf: x.depUf || '', manual: true };
  return { nome: 'Deputado removido', uf: '', manual: false };
}
/** Deputados digitados em pedidos anteriores (para escolher de novo sem redigitar). */
function pvDigitados() {
  const m = new Map();
  for (const x of pvLista()) if (!state.deputados[x.depId] && x.depNome && !m.has(x.depId)) m.set(x.depId, { nome: x.depNome, uf: x.depUf || '' });
  return [...m.entries()].sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function pvCtx() {
  return { permanentes: [...COMISSOES_PERMANENTES, ...PV_COMISSOES_MISTAS], grupos: GRUPOS_INCOMPATIVEIS, membrosDe: comissoesDeDeputado, pedidos: pvLista(), legAtual: pvLegislaturaDe() };
}

function renderSidebarPedidosVagas() {
  const lista = pvLista();
  const n = s => (s ? lista.filter(x => x.situacao === s).length : lista.length);
  const itens = [['pendente', 'Pendentes'], ['atendido', 'Atendidos'], ['negado', 'Negados'], ['', 'Todos']];
  const el = document.getElementById('com-lista');
  el.innerHTML = itens.map(([s, rot]) => `<div class="com-item${pvFiltro === s ? ' ativo' : ''}" data-pv-filtro="${s}">
      <span class="com-item-nome">${rot}</span><span class="com-item-badge">${n(s)}</span></div>`).join('');
  el.querySelectorAll('[data-pv-filtro]').forEach(it => it.addEventListener('click', () => {
    pvFiltro = it.dataset.pvFiltro;
    renderSidebarPedidosVagas();
    renderPainelPedidosVagas();
  }));
}

function _pvSituacaoDeputado(depId, leg) {
  if (!depId) return '';
  const atual = pvLegislaturaDe();
  if (depId === '__manual' || !state.deputados[depId]) {
    return leg > atual ? `Pedido para a ${leg}ª legislatura: vale o que já tiver sido atendido para ela.` : 'Deputado fora do cadastro do módulo: sem composição registrada.';
  }
  if (leg > atual) return `Pedido para a ${leg}ª legislatura: a composição de hoje (${atual}ª) não conta; vale o que já tiver sido atendido para a ${leg}ª.`;
  const { titulares, suplentes } = comissoesDeDeputado(depId);
  const marca = s => `${_pvEsc(s)}${pvInacumulavel(s, GRUPOS_INCOMPATIVEIS) ? ' <span class="pv-inac" title="Inacumulável (RICD, art. 26, § 2º)">inacumulável</span>' : ''}`;
  return `Hoje: titular em ${titulares.length ? titulares.map(marca).join(', ') : 'nenhuma'} · suplente em ${suplentes.length ? suplentes.map(_pvEsc).join(', ') : 'nenhuma'}`;
}

function renderPainelPedidosVagas() {
  const deps = Object.entries(state.deputados || {}).sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const dig = pvDigitados();
  const legAtual = pvLegislaturaDe(), legPadrao = pvLegislaturaPadrao();
  const lista = pvLista().filter(x => !pvFiltro || x.situacao === pvFiltro);
  // por legislatura, deputado (nome), preferência
  lista.sort((a, b) => pvLegDe(b, legAtual) - pvLegDe(a, legAtual) || pvDeputado(a).nome.localeCompare(pvDeputado(b).nome, 'pt-BR') || a.ordem - b.ordem || String(a.data).localeCompare(String(b.data)));
  const comNome = s => ([...COMISSOES_PERMANENTES, ...PV_COMISSOES_MISTAS].find(c => c.sigla === s) || {}).nome || s;
  const rotFiltro = pvFiltro ? PV_SITUACOES[pvFiltro].toLowerCase() + 's' : 'todos';

  const ctxLista = pvCtx();
  const linhas = lista.map(x => {
    const dep = pvDeputado(x);
    // conflito calculado na hora (pendentes e atendidos; no negado não importa)
    const conf = x.situacao === 'negado' ? [] : pvConflitosInacumulaveis(x, ctxLista);
    const reg = (x.conflitoRegistro || []).filter(s => !conf.some(c => c.sigla === s));
    // badge vermelho por colegiado em conflito (pedido de 24/11/2026), com a explicação na dica
    const dica = _pvEsc(pvTextoConflito(conf, x.sigla, pvLegDe(x, legAtual)));
    const selo = conf.length
      ? conf.map(c => ` <span class="pv-conflito" title="${dica}">⚠ ${_pvEsc(c.sigla)}</span>`).join('')
      : (reg.length && x.situacao !== 'negado' ? ` <span class="pv-dim" title="No registro, o deputado era titular em ${_pvEsc(reg.join(', '))}; hoje não há mais o conflito">· conflito no registro (${_pvEsc(reg.join(', '))}) resolvido</span>` : '');
    const acoes = x.situacao === 'pendente'
      ? `<button class="pv-btn pv-ok" data-pv-sit="atendido" data-pv-id="${x.id}">Atendido</button>
         <button class="pv-btn pv-nao" data-pv-sit="negado" data-pv-id="${x.id}">Negado</button>`
      : `<button class="pv-btn" data-pv-sit="pendente" data-pv-id="${x.id}">Reabrir</button>`;
    const hist = (x.historico || []).map(h => `${PV_SITUACOES[h.situacao] || h.situacao} em ${_pvData(h.em)}`).join(' → ');
    return `<tr>
      <td><b>${_pvEsc(dep.nome)}</b>${dep.uf ? ` <span class="pv-dim">(${_pvEsc(dep.uf)})</span>` : ''}${dep.manual ? ' <span class="pv-dim" title="Nome digitado: o deputado não está no cadastro do módulo">· digitado</span>' : ''}${selo}</td>
      <td class="pv-c">${pvLegDe(x, legAtual)}ª</td>
      <td class="pv-c">${x.ordem}ª</td>
      <td><b>${_pvEsc(x.sigla)}</b> <span class="pv-dim">${_pvEsc(comNome(x.sigla))}</span>${pvInacumulavel(x.sigla, GRUPOS_INCOMPATIVEIS) ? ' <span class="pv-inac">inacumulável</span>' : ''}</td>
      <td>${PV_TIPOS[x.tipo] || x.tipo}</td>
      <td><span class="pv-sit pv-sit-${x.situacao}" title="${_pvEsc(hist)}">${PV_SITUACOES[x.situacao] || x.situacao}</span></td>
      <td class="pv-dim">${_pvData(x.data)}</td>
      <td class="pv-acoes">${acoes}<button class="pv-btn pv-del" data-pv-del="${x.id}" title="Excluir o pedido">✕</button></td>
    </tr>`;
  }).join('');

  document.getElementById('com-painel-conteudo').innerHTML = `
    <div class="pv-wrap">
      <h2 class="pv-titulo">Pedidos de vagas <span class="pv-dim">· Comissões Permanentes, CMO e Parlasul</span>
        <button id="pv-relatorio" class="btn btn-outline btn-sm pv-rel" title="Relatório em PDF dos pedidos do filtro (${rotFiltro}), por comissão e por deputado">📄 Relatório (PDF)</button></h2>
      <div class="pv-form">
        <label>Legislatura<select id="pv-leg" class="form-input">
          <option value="${legAtual}"${legPadrao === legAtual ? ' selected' : ''}>${legAtual}ª (atual)</option>
          <option value="${legAtual + 1}"${legPadrao === legAtual + 1 ? ' selected' : ''}>${legAtual + 1}ª (próxima, a partir de 1º/2/${1795 + 4 * (legAtual + 1)})</option></select></label>
        <label>Deputado<select id="pv-dep" class="form-input"><option value="">Escolha…</option>
          <option value="__manual">✎ Digitar nome (não cadastrado)</option>
          <optgroup label="Cadastrados no módulo">${deps.map(([id, d]) => `<option value="${_pvEsc(id)}">${_pvEsc(d.nome)}${d.uf ? ` (${_pvEsc(d.uf)})` : ''}</option>`).join('')}</optgroup>
          ${dig.length ? `<optgroup label="Digitados em pedidos anteriores">${dig.map(([id, d]) => `<option value="${_pvEsc(id)}">${_pvEsc(d.nome)}${d.uf ? ` (${_pvEsc(d.uf)})` : ''}</option>`).join('')}</optgroup>` : ''}</select></label>
        <label id="pv-manual-nome" style="display:none">Nome do deputado<input id="pv-dep-nome" class="form-input" maxlength="80" placeholder="Nome parlamentar"></label>
        <label id="pv-manual-uf" style="display:none">UF<input id="pv-dep-uf" class="form-input" maxlength="2" placeholder="UF" style="width:64px;text-transform:uppercase"></label>
        <label>Comissão<select id="pv-com" class="form-input"><option value="">Escolha…</option>
          <optgroup label="Permanentes da Câmara">${COMISSOES_PERMANENTES.map(c => `<option value="${c.sigla}">${c.sigla} — ${_pvEsc(c.nome)}${pvInacumulavel(c.sigla, GRUPOS_INCOMPATIVEIS) ? ' (inacumulável)' : ''}</option>`).join('')}</optgroup>
          <optgroup label="Mistas do Congresso">${PV_COMISSOES_MISTAS.map(c => `<option value="${c.sigla}">${c.sigla} — ${_pvEsc(c.nome)}</option>`).join('')}</optgroup></select></label>
        <label>Vaga<select id="pv-tipo" class="form-input"><option value="titular">Titular</option><option value="suplente">Suplente</option></select></label>
        <label>Preferência<select id="pv-ordem" class="form-input">${Array.from({ length: PV_MAX_PREFERENCIA }, (_, i) => `<option value="${i + 1}">${i + 1}ª</option>`).join('')}</select></label>
        <button id="pv-registrar" class="btn btn-primary btn-sm">Registrar pedido</button>
      </div>
      <div id="pv-dep-situacao" class="pv-dim pv-situacao"></div>
      <div id="pv-alerta" class="pv-alerta" style="display:none"></div>
      <div id="pv-erro" class="pv-erro" style="display:none"></div>
      <div class="pv-nota">Inacumulabilidade (RICD, art. 26, § 2º): o deputado só pode ser <b>titular</b> de uma das comissões marcadas como inacumuláveis.
        O pedido de titular numa delas, quando ele já é titular em outra, <b>é registrado com alerta</b> e fica marcado na lista com o colegiado em conflito. Suplência e as comissões ressalvadas não têm esse limite.
        Na <b>legislatura atual</b>, conta a composição registrada no módulo e o que foi atendido; na <b>próxima</b>, só o que já foi atendido para ela.</div>
      <h3 class="pv-sub">Pedidos ${rotFiltro} <span class="pv-dim">(${lista.length})</span></h3>
      ${lista.length ? `<table class="pv-tabela"><thead><tr><th>Deputado</th><th class="pv-c">Leg.</th><th class="pv-c">Pref.</th><th>Comissão</th><th>Vaga</th><th>Situação</th><th>Registrado</th><th></th></tr></thead>
        <tbody>${linhas}</tbody></table>` : '<p class="pv-dim">Nenhum pedido aqui.</p>'}
    </div>`;

  const depSel = document.getElementById('pv-dep'), legSel = document.getElementById('pv-leg');
  const alertar = () => {
    const p = pvLerFormulario();
    const conf = p.depId && p.depId !== '__manual' && p.sigla ? pvConflitosInacumulaveis(p, pvCtx()) : [];
    const el = document.getElementById('pv-alerta');
    el.textContent = conf.length ? '⚠ ' + pvTextoConflito(conf, p.sigla, p.legislatura) : '';
    el.style.display = conf.length ? '' : 'none';
  };
  const atualizar = () => {
    const manual = depSel.value === '__manual', leg = Number(legSel.value);
    document.getElementById('pv-manual-nome').style.display = manual ? '' : 'none';
    document.getElementById('pv-manual-uf').style.display = manual ? '' : 'none';
    document.getElementById('pv-dep-situacao').innerHTML = _pvSituacaoDeputado(depSel.value, leg);
    const id = manual ? pvResolverManual(document.getElementById('pv-dep-nome').value, state.deputados).depId : depSel.value;
    document.getElementById('pv-ordem').value = String(pvProximaOrdem(id, pvLista(), leg, legAtual));
    document.getElementById('pv-erro').style.display = 'none';
    alertar();
  };
  depSel.addEventListener('change', atualizar);
  legSel.addEventListener('change', atualizar);
  document.getElementById('pv-dep-nome').addEventListener('change', atualizar);
  document.getElementById('pv-com').addEventListener('change', alertar);
  document.getElementById('pv-tipo').addEventListener('change', alertar);
  document.getElementById('pv-registrar').addEventListener('click', pvRegistrar);
  document.getElementById('pv-relatorio').addEventListener('click', pvRelatorioPDF);
  document.querySelectorAll('[data-pv-sit]').forEach(b => b.addEventListener('click', () => pvMudarSituacao(b.dataset.pvId, b.dataset.pvSit)));
  document.querySelectorAll('[data-pv-del]').forEach(b => b.addEventListener('click', () => pvExcluir(b.dataset.pvDel)));
}

/** Lê o formulário como um pedido (o deputado digitado vira o id "m_<nome>", ou o cadastrado de mesmo nome). */
function pvLerFormulario() {
  const sel = document.getElementById('pv-dep').value;
  const p = { depId: sel, sigla: document.getElementById('pv-com').value, tipo: document.getElementById('pv-tipo').value,
    ordem: Number(document.getElementById('pv-ordem').value), legislatura: Number(document.getElementById('pv-leg').value) };
  if (sel === '__manual') {
    const nomeDig = document.getElementById('pv-dep-nome').value.trim();
    const r = pvResolverManual(nomeDig, state.deputados);
    // o nome de um deputado cadastrado aponta para ele; o de um já digitado, para o mesmo id
    Object.assign(p, r.cadastrado ? { depId: r.depId } : { depId: r.depId, depManual: true, depNome: nomeDig, depUf: document.getElementById('pv-dep-uf').value });
    if (!nomeDig) Object.assign(p, { depId: '__manual', depManual: true, depNome: '' });
  } else if (sel && !state.deputados[sel]) {
    const d = pvDigitados().find(([id]) => id === sel);
    if (d) Object.assign(p, { depManual: true, depNome: d[1].nome, depUf: d[1].uf });
  }
  return p;
}

async function pvRegistrar() {
  const p = pvLerFormulario();
  const v = pvValidarPedido(p, pvCtx());
  const erroEl = document.getElementById('pv-erro');
  if (!v.ok) { erroEl.textContent = v.erro; erroEl.style.display = ''; return; }
  erroEl.style.display = 'none';
  // inacumulabilidade: alerta quem cadastra; registrado, o pedido leva o conflito
  if (v.conflitos.length && !confirm(`⚠ ${v.alerta}\n\nRegistrar o pedido mesmo assim?`)) return;
  p.conflitos = v.conflitos;
  const id = `pv_${Date.now()}`;
  const reg = pvNovoRegistro(p, new Date().toISOString());
  try {
    await fbPut(`/pedidos-vagas/${id}`, reg);
  } catch (e) { mostrarToast('Não foi possível gravar o pedido: ' + e.message, 'erro'); return; }
  state.pedidosVagas[id] = reg;
  mostrarToast(`Pedido registrado: ${pvDeputado(reg).nome} — ${p.tipo} em ${p.sigla} (${p.ordem}ª preferência, ${p.legislatura}ª legislatura)` +
    (v.conflitos.length ? `, com conflito de inacumulabilidade: titular em ${v.conflitos.map(c => c.sigla).join(', ')}.` : '.'), v.conflitos.length ? 'aviso' : undefined, v.conflitos.length ? 6000 : undefined);
  renderSidebarPedidosVagas();
  renderPainelPedidosVagas();
}

async function pvMudarSituacao(id, situacao) {
  const reg = state.pedidosVagas[id];
  if (!reg) return;
  // Reabrir não pode criar dois pedidos pendentes iguais; a inacumulabilidade continua só marcada na lista
  if (situacao === 'pendente') {
    const outros = pvLista().filter(x => x.id !== id);
    const ctxR = Object.assign(pvCtx(), { pedidos: outros });
    // a vaga que este próprio pedido preencheu (nomeação) não conta como "já está na comissão"
    if (reg.nomeacao) ctxR.membrosDe = d => { const m = comissoesDeDeputado(d); return d !== reg.depId ? m : { titulares: m.titulares.filter(x => x !== reg.nomeacao.sigla), suplentes: m.suplentes.filter(x => x !== reg.nomeacao.sigla) }; };
    const v = pvValidarPedido(reg, ctxR);
    if (!v.ok) { mostrarToast(v.erro, 'erro', 6000); return; }
  }
  const agora = new Date().toISOString();
  const nome = pvDeputado(reg).nome;
  let novo = pvComSituacao(reg, situacao, agora), aviso = '';
  // Atendido: nomeia na composição (pedido de 24/11/2026)
  if (situacao === 'atendido') {
    const plano = pvPlanoAtendimento(reg, { legAtual: pvLegislaturaDe(), cadastrado: !!state.deputados[reg.depId], membros: comissoesDeDeputado(reg.depId),
      vagasLivres: vagasDisponiveis, conflito: comissaoConflitante });
    if (plano.acao === 'bloqueio' && !confirm(`Não dá para nomear ${nome} ${reg.tipo} em ${reg.sigla}: ${plano.motivo}.\n\nMarcar o pedido como atendido mesmo assim, sem nomear?`)) return;
    if (plano.acao === 'nomear') {
      try {
        await gravarMembros(reg.sigla, atual => {
          const l = reg.tipo === 'titular' ? (atual.titulares = atual.titulares || []) : (atual.suplentes = atual.suplentes || []);
          if (!l.includes(reg.depId)) l.push(reg.depId);
          if (plano.sairDaSuplencia) {
            atual.suplentes = (atual.suplentes || []).filter(x => x !== reg.depId);
            if (atual.suplentes_acordo) delete atual.suplentes_acordo[reg.depId];
          }
        });
      } catch (e) { mostrarToast('Não foi possível nomear na composição: ' + e.message, 'erro', 6000); return; }
      novo = Object.assign(novo, { nomeacao: { sigla: reg.sigla, tipo: reg.tipo, em: agora } });
      aviso = `${nome} nomeado ${reg.tipo} em ${reg.sigla}${plano.sairDaSuplencia ? ' (saiu da suplência)' : ''}.`;
    } else {
      aviso = plano.acao === 'ja' ? `Atendido — ${nome} ${plano.motivo}.` : `Atendido, sem nomear: ${plano.motivo}.`;
    }
  }
  // Reabrir ou negar um atendido que nomeou: pergunta se tira da composição
  if (reg.situacao === 'atendido' && situacao !== 'atendido' && reg.nomeacao) {
    const m = state.membros[reg.nomeacao.sigla] || {};
    const ainda = (reg.nomeacao.tipo === 'titular' ? m.titulares : m.suplentes) || [];
    if (ainda.includes(reg.depId) && confirm(`${nome} foi nomeado ${reg.nomeacao.tipo} em ${reg.nomeacao.sigla} por este pedido.\n\nOK: tirar da composição · Cancelar: manter na composição`)) {
      try { await removerMembro(reg.nomeacao.sigla, reg.depId); aviso = `${nome} saiu da composição de ${reg.nomeacao.sigla}.`; }
      catch (e) { mostrarToast('Não foi possível tirar da composição: ' + e.message, 'erro', 6000); return; }
    }
    delete novo.nomeacao;
  }
  try { await fbPut(`/pedidos-vagas/${id}`, novo); }
  catch (e) { mostrarToast('Não foi possível gravar: ' + e.message, 'erro'); return; }
  state.pedidosVagas[id] = novo;
  if (aviso) mostrarToast(aviso, 'ok', 5000);
  renderSidebarPedidosVagas();
  renderPainelPedidosVagas();
}

/** Relatório em PDF dos pedidos do filtro da tela (janela de impressão, como os relatórios da Liderança). */
async function pvRelatorioPDF() {
  const win = window.open('', '_blank', 'width=960,height=720');   // no gesto do clique
  if (!win) { mostrarToast('Permita pop-ups para gerar o PDF.', 'erro'); return; }
  let logo = null;
  try {
    const r = await fetch(chrome.runtime.getURL('icons/podemos-logo.png'));
    if (r.ok) { const b = await r.blob(); logo = await new Promise(ok => { const fr = new FileReader(); fr.onloadend = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(b); }); }
  } catch (_) { /* sem logo */ }
  if (win.closed) return;
  const lista = pvLista().filter(x => !pvFiltro || x.situacao === pvFiltro);
  const vagas = (s, t) => ({ livres: Math.max(0, vagasDisponiveis(s, t)), total: vagasEfetivas(s, t) });
  win.document.open();
  win.document.write(pvHtmlRelatorio(lista, Object.assign(pvCtx(), { todos: pvLista(), deputadoDe: pvDeputado, vagas, logo,
    filtroRotulo: pvFiltro ? PV_SITUACOES[pvFiltro].toLowerCase() + 's' : 'de todas as situações', hojeBR: new Date().toLocaleDateString('pt-BR') })));
  win.document.close();
  let impresso = false;
  const imprimir = () => { if (impresso || win.closed) return; impresso = true; try { win.focus(); win.print(); } catch (_) {} };
  win.PagedConfig = { auto: true, after: imprimir };
  const sc = win.document.createElement('script');
  sc.src = chrome.runtime.getURL('libs/paged.polyfill.js');
  sc.onerror = imprimir;
  win.document.head.appendChild(sc);
  setTimeout(imprimir, 30000);
}

async function pvExcluir(id) {
  const reg = state.pedidosVagas[id];
  if (!reg || !confirm(`Excluir o pedido de ${pvDeputado(reg).nome} (${reg.tipo} em ${reg.sigla})?`)) return;
  try { await fbDelete(`/pedidos-vagas/${id}`); }
  catch (e) { mostrarToast('Não foi possível excluir: ' + e.message, 'erro'); return; }
  delete state.pedidosVagas[id];
  renderSidebarPedidosVagas();
  renderPainelPedidosVagas();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pvInacumulavel, pvValidarPedido, pvConflitosInacumulaveis, pvTextoConflito, pvPlanoAtendimento, pvHtmlRelatorio, pvProximaOrdem, pvNovoRegistro, pvComSituacao, pvLegislaturaDe, pvLegislaturaPadrao,
    pvIdManual, pvResolverManual, PV_MAX_PREFERENCIA, PV_COMISSOES_MISTAS };
}
