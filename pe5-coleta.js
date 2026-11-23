// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Parecer de Especialista (refeito em 17/11/2026) — A COLETA DO PROGRAMA.
//
// Tudo o que é dado estruturado vem daqui, nunca do modelo: regime de tramitação, urgência, votações
// nominais e voto da bancada, fase (em que Casa está e se já foi votada), artigos da lei vigente e o
// inventário do que foi lido. O parecer anterior deixava isso por conta do modelo — o do PL 4675/2025
// afirmou que "não há registro da urgência" quando a API a mostrava aprovada por 276 a 186 — ou não
// trazia. O modelo recebe estes dados prontos e só os interpreta.
//
// Script clássico (global na extensão) + module.exports para os testes. Sem dependência de tela.

'use strict';

const PE5_API = 'https://dadosabertos.camara.leg.br/api/v2';
const PE5_PARTIDO = 'PODE';

const pe5DataBR = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const pe5Limpo = s => String(s || '').replace(/\s+/g, ' ').trim();
/** Corta no fim de uma palavra e marca o corte (o texto da Câmara repete a ementa inteira em cada andamento). */
const pe5Corta = (s, n) => { const t = pe5Limpo(s); if (t.length <= n) return t; const c = t.slice(0, n); return c.slice(0, Math.max(c.lastIndexOf(' '), n - 40)).replace(/[\s,;:("“-]+$/, '') + '…'; };

async function pe5Json(url, fetchFn, { tentativas = 2, esperaMs = 1500 } = {}) {
  let ultimo = '';
  for (let i = 0; i < tentativas; i++) {
    if (i) await new Promise(r => setTimeout(r, esperaMs));
    try {
      const r = await fetchFn(url, { headers: { Accept: 'application/json' } });
      if (r.ok) return await r.json();
      ultimo = `HTTP ${r.status}`;
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) { ultimo = e.message; }
  }
  throw new Error(`${url.replace(PE5_API, '')}: ${ultimo}`);
}

// ---------------------------------------------------------------------------------------------
// FASE: em que Casa a matéria está e se a Câmara já a votou. O parecer do PDL 557/2026 foi gerado
// cinco dias depois da remessa ao Senado e ainda abria com "decide-se sobre a aprovação".
// ---------------------------------------------------------------------------------------------
const PE5_RE_REMESSA_SENADO = /remessa ao senado|aguardando aprecia[çc][ãa]o pelo senado|encaminhad[oa] ao senado/i;
const PE5_RE_SANCAO = /remessa [àa] san[çc][ãa]o|aguardando san[çc][ãa]o|transformad[oa] n[ao] (lei|emenda|decreto|resolu)|transformad[oa] em (lei|norma)|promulgad[oa]/i;
const PE5_RE_ARQUIVO = /arquivad[oa]|prejudicad[oa]|retirad[oa] pelo autor|devolvid[oa] ao autor/i;
const PE5_RE_APROVADA_PLEN = /aprovad[oa] (?:o|a|em)?\s*(?:o\s+)?(?:substitutivo|projeto|proposta|reda[çc][ãa]o final|texto|medida provis[óo]ria|emendas? do senado|parecer.*plen[áa]rio)|aprova[çc][ãa]o de proposi[çc][ãa]o \(plen[áa]rio\)/i;
const PE5_RE_VOLTA_SENADO = /emendas? do senado|substitutivo do senado|recebimento d[oa]s? (?:emendas?|substitutivo) do senado/i;

function pe5Fase(status = {}, tramitacoes = [], { origemSenado = false } = {}) {
  const txt = t => pe5Limpo(`${t.descricaoTramitacao || ''} ${t.descricaoSituacao || ''} ${t.despacho || ''}`);
  const ordenadas = [...tramitacoes].sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)) || (a.sequencia || 0) - (b.sequencia || 0));
  const atual = txt(status);
  const ultima = re => { for (let i = ordenadas.length - 1; i >= 0; i--) if (re.test(txt(ordenadas[i]))) return ordenadas[i]; return null; };
  const fase = { codigo: 'camara_em_tramitacao', casa: 'Câmara dos Deputados', descricao: '', jaVotadaNaCamara: false, dataVotacao: '', revisao: false };

  const sancao = PE5_RE_SANCAO.test(atual) ? status : ultima(PE5_RE_SANCAO);
  const arquivo = PE5_RE_ARQUIVO.test(atual);
  const remessa = PE5_RE_REMESSA_SENADO.test(atual) ? status : ultima(PE5_RE_REMESSA_SENADO);
  const volta = ultima(PE5_RE_VOLTA_SENADO);
  const aprovPlen = ordenadas.filter(t => /PLEN/i.test(t.siglaOrgao || '') && PE5_RE_APROVADA_PLEN.test(txt(t))).pop() || null;

  if (arquivo) return { ...fase, codigo: 'encerrada', casa: '', descricao: `A matéria está encerrada na Câmara (${pe5Limpo(status.descricaoSituacao || status.descricaoTramitacao)}).` };
  if (sancao) return { ...fase, codigo: 'concluida', casa: '', jaVotadaNaCamara: true, dataVotacao: pe5DataBR(aprovPlen?.dataHora),
    descricao: `A tramitação no Congresso foi concluída (${pe5Limpo(sancao.descricaoTramitacao || sancao.descricaoSituacao)}${sancao.dataHora ? `, ${pe5DataBR(sancao.dataHora)}` : ''}).` };
  // voltou do Senado DEPOIS da remessa: a Câmara delibera só sobre o que o Senado mudou
  if (volta && (!remessa || String(volta.dataHora) > String(remessa.dataHora || ''))) {
    return { ...fase, codigo: 'camara_revisao_do_senado', revisao: true,
      descricao: 'A matéria voltou do Senado: a Câmara delibera apenas sobre as alterações feitas pelos senadores (aceita ou rejeita cada uma), sem reabrir o restante do texto.' };
  }
  if (remessa) return { ...fase, codigo: 'senado', casa: 'Senado Federal', jaVotadaNaCamara: true, dataVotacao: pe5DataBR(aprovPlen?.dataHora) || '',
    descricao: `A Câmara já concluiu a votação e enviou a matéria ao Senado${remessa.dataHora ? ` em ${pe5DataBR(remessa.dataHora)}` : ''}. A decisão agora é dos senadores; a Câmara só volta a deliberar se o Senado alterar o texto.` };
  const emPlenario = /PLEN/i.test(status.siglaOrgao || '') || /pronta para pauta|plen[áa]rio/i.test(atual) || /urg[êe]ncia/i.test(status.regime || '');
  // Relator e parecer DE PLENÁRIO e urgência só requerida. A NTA do PLP 299/2026 (21/11/2026) saiu com "em fase
  // de comissões" quando a matéria tinha vindo do Senado, tinha relator de Plenário e parecer apresentado.
  const relT = ordenadas.filter(t => /PLEN/i.test(t.siglaOrgao || '') && /designa[çc][ãa]o de relator|designad[oa] relator/i.test(txt(t))).pop() || null;
  const prlpT = ordenadas.filter(t => /parecer preliminar de plen[áa]rio|\bPRLP\b|parecer (?:do|da) relator.*plen[áa]rio/i.test(txt(t))).pop() || null;
  const urgAprov = ordenadas.some(t => /aprova[çc][ãa]o de urg[êe]ncia|aprovado o requerimento.*urg[êe]ncia/i.test(txt(t)));
  const urgReq = urgAprov || /urg[êe]ncia/i.test(status.regime || '') ? null : (ordenadas.filter(t => /requerimento de urg[êe]ncia/i.test(txt(t))).pop() || null);
  const nomeRel = relT ? (pe5Limpo(relT.despacho).match(/Relator(?:a)?,?\s+(?:Dep\.|Deputad[oa])\s+([^.;]+?\([^)]*\))/i) || [])[1] || '' : '';
  const rumoPlenario = emPlenario || !!relT || !!prlpT;
  const partes = [];
  if (origemSenado) partes.push('A matéria veio do Senado e está na Câmara, que atua como Casa revisora: aprovado sem mudança de mérito, o texto vai à sanção; se a Câmara o alterar, as mudanças voltam ao Senado.');
  else partes.push(emPlenario ? 'A matéria está na Câmara, em condições de ser votada no Plenário.' : rumoPlenario ? 'A matéria está na Câmara, com relator de Plenário designado.' : 'A matéria está na Câmara, em fase de comissões.');
  if (relT) partes.push(`Relator de Plenário designado em ${pe5DataBR(relT.dataHora)}${nomeRel ? `: ${nomeRel}` : ''}.`);
  if (prlpT) partes.push(`Parecer de Plenário apresentado em ${pe5DataBR(prlpT.dataHora)}.`);
  if (urgReq) partes.push(`Requerimento de urgência apresentado em ${pe5DataBR(urgReq.dataHora)} e ainda não votado; sem a urgência, a matéria segue o rito das comissões.`);
  return { ...fase, codigo: rumoPlenario ? 'camara_plenario' : 'camara_comissoes', descricao: partes.join(' '),
    ...(origemSenado ? { casaRevisora: true } : {}),
    ...(relT ? { relatorPlenario: { nome: nomeRel, data: pe5DataBR(relT.dataHora) } } : {}),
    ...(prlpT ? { parecerPlenario: { data: pe5DataBR(prlpT.dataHora) } } : {}),
    ...(urgReq ? { urgenciaPendente: { data: pe5DataBR(urgReq.dataHora) } } : {}) };
}

// ---------------------------------------------------------------------------------------------
// MARCOS da tramitação: o que o analista precisa ver na linha do tempo, sem o ruído dos despachos.
// ---------------------------------------------------------------------------------------------
const PE5_MARCOS = [
  [/apresenta[çc][ãa]o d[oa] (projeto|proposta|medida|mensagem)|^apresenta[çc][ãa]o de proposi[çc][ãa]o/i, 'apresentação'],
  [/designa[çc][ãa]o de relator|designad[oa] relator/i, 'relator'],
  [/requerimento de urg[êe]ncia|urg[êe]ncia \(|aprova[çc][ãa]o de urg[êe]ncia/i, 'urgência'],
  [/comiss[ãa]o especial/i, 'comissão especial'],
  [/parecer preliminar de plen[áa]rio|PRLP|parecer (do|da) relator|apresenta[çc][ãa]o do parecer/i, 'parecer'],
  [/aprovad[oa] o parecer|aprova[çc][ãa]o do parecer/i, 'comissão'],
  [/audi[êe]ncia p[úu]blica/i, 'audiência pública'],
  [/emenda de plen[áa]rio|apresenta[çc][ãa]o d[ae] emenda/i, 'emenda'],
  [/retirad[oa] de pauta|adiad[oa] a (discuss[ãa]o|vota[çc][ãa]o)/i, 'pauta'],
  [PE5_RE_APROVADA_PLEN, 'votação'],
  [/rejeitad[oa]/i, 'votação'],
  [PE5_RE_REMESSA_SENADO, 'Senado'],
  [PE5_RE_VOLTA_SENADO, 'Senado'],
  [PE5_RE_SANCAO, 'conclusão'],
  [/apensa[çc][ãa]o|apense-se/i, 'apensação'],
];
function pe5Marcos(tramitacoes = [], max = 40) {
  const out = [], vistos = new Set();
  for (const t of [...tramitacoes].sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)) || (a.sequencia || 0) - (b.sequencia || 0))) {
    const texto = pe5Limpo(`${t.descricaoTramitacao || ''} — ${t.despacho || ''}`);
    const m = PE5_MARCOS.find(([re]) => re.test(texto));
    if (!m) continue;
    const fato = pe5Corta(t.despacho || t.descricaoTramitacao, 320);
    const k = `${String(t.dataHora).slice(0, 10)}|${fato.slice(0, 80)}`;
    if (vistos.has(k)) continue; vistos.add(k);
    out.push({ data: pe5DataBR(t.dataHora), iso: String(t.dataHora || '').slice(0, 10), orgao: t.siglaOrgao || '', tipo: m[1], fato });
  }
  return out.slice(-max);
}

/** Urgência: tipo, data da aprovação e o requerimento — do registro da tramitação. */
/** Regime como a Câmara o registra; "." e traço (matéria sem despacho) viram vazio. */
const pe5Regime = r => { const t = pe5Limpo(r); return /^[.\-–—\s]*$/.test(t) ? '' : t; };
function pe5Urgencia(status = {}, tramitacoes = []) {
  const reg = pe5Regime(status.regime);
  const aprov = tramitacoes.filter(t => /aprova[çc][ãa]o de urg[êe]ncia|aprovado o requerimento.*urg[êe]ncia/i.test(`${t.descricaoTramitacao} ${t.despacho}`))
    .sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)))[0] || null;
  const apres = tramitacoes.filter(t => /requerimento de urg[êe]ncia/i.test(`${t.descricaoTramitacao} ${t.despacho}`))
    .sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)))[0] || null;
  const constitucional = /64/.test(reg) || /urg[êe]ncia constitucional/i.test(reg);
  if (!/urg[êe]ncia/i.test(reg) && !aprov) return { tem: false, regime: reg || 'regime ainda não definido', ...(apres ? { pedidaEm: pe5DataBR(apres.dataHora), requerimento: pe5Corta(apres.despacho, 260) } : {}) };
  return { tem: true, regime: reg, tipo: constitucional ? 'urgência constitucional (art. 64, § 1º, da Constituição)' : (reg.match(/art\.?\s*(15[1-5])/i) ? `urgência regimental (art. ${reg.match(/art\.?\s*(15[1-5])/i)[1]} do Regimento Interno da Câmara)` : 'urgência'),
    aprovadaEm: pe5DataBR(aprov?.dataHora), requerimento: pe5Corta((aprov || apres)?.despacho, 260), pedidaEm: pe5DataBR(apres?.dataHora) };
}

// ---------------------------------------------------------------------------------------------
// VOTAÇÕES: placar, voto por partido, orientações e a bancada do Podemos, deputado a deputado.
// ---------------------------------------------------------------------------------------------
function pe5ResumoVotos(votos = []) {
  const partidos = {}, bancada = { sim: [], nao: [], abstencao: [], obstrucao: [], outros: [] };
  const chave = v => /^sim$/i.test(v) ? 'sim' : /^n[ãa]o$/i.test(v) ? 'nao' : /absten/i.test(v) ? 'abstencao' : /obstru/i.test(v) ? 'obstrucao' : 'outros';
  let sim = 0, nao = 0, outros = 0;
  for (const v of votos) {
    const p = v.deputado_?.siglaPartido || '?', k = chave(v.tipoVoto || '');
    partidos[p] = partidos[p] || { partido: p, sim: 0, nao: 0, outros: 0 };
    if (k === 'sim') { partidos[p].sim++; sim++; } else if (k === 'nao') { partidos[p].nao++; nao++; } else { partidos[p].outros++; outros++; }
    if (p.toUpperCase() === PE5_PARTIDO) bancada[k].push(v.deputado_?.nome || '');
  }
  for (const k of Object.keys(bancada)) bancada[k].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { sim, nao, outros, total: votos.length,
    partidos: Object.values(partidos).sort((a, b) => (b.sim + b.nao + b.outros) - (a.sim + a.nao + a.outros)),
    bancada: { ...bancada, total: Object.values(bancada).reduce((s, l) => s + l.length, 0) } };
}

async function pe5Votacoes(idProp, fetchFn) {
  const lista = ((await pe5Json(`${PE5_API}/proposicoes/${idProp}/votacoes?ordem=ASC&ordenarPor=dataHoraRegistro`, fetchFn)).dados || []);
  const out = [];
  for (const v of lista) {
    const item = { id: v.id, data: pe5DataBR(v.data || v.dataHoraRegistro), iso: String(v.data || v.dataHoraRegistro || '').slice(0, 10), orgao: v.siglaOrgao || '',
      descricao: pe5Corta(v.descricao, 300), aprovada: v.aprovacao === 1 ? true : v.aprovacao === 0 ? false : null, nominal: false };
    // Só o Plenário tem voto nominal que interessa à bancada; comissão fica com a descrição.
    if (/PLEN/i.test(item.orgao)) {
      try {
        const votos = (await pe5Json(`${PE5_API}/votacoes/${v.id}/votos`, fetchFn)).dados || [];
        if (votos.length) {
          Object.assign(item, { nominal: true }, pe5ResumoVotos(votos));
          try { item.orientacoes = ((await pe5Json(`${PE5_API}/votacoes/${v.id}/orientacoes`, fetchFn)).dados || []).map(o => ({ quem: o.siglaPartidoBloco, orientacao: o.orientacaoVoto })).filter(o => o.quem); }
          catch (_) { item.orientacoes = []; }
        }
      } catch (e) { item.falha = e.message; }
    }
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// RESERVA: quando a API não entrega as votações, os mesmos dados estão nos arquivos que a Câmara
// publica todo dia, de madrugada, em outro serviço (dadosabertos.camara.leg.br/arquivos). São quatro
// arquivos por ano — ligação votação/proposição, votações, votos e orientações —, cerca de 3 MB
// compactados. Vão até o fechamento do dia anterior.
// ---------------------------------------------------------------------------------------------
const PE5_ARQUIVOS = 'https://dadosabertos.camara.leg.br/arquivos';
async function pe5Arquivo(conjunto, ano, fetchFn) {
  const r = await fetchFn(`${PE5_ARQUIVOS}/${conjunto}/json/${conjunto}-${ano}.json`);
  if (!r || !r.ok) throw new Error(`arquivo ${conjunto}-${ano} indisponível (HTTP ${r ? r.status : '?'})`);
  const j = await r.json();
  let mod = ''; try { mod = (r.headers && typeof r.headers.get === 'function' && r.headers.get('last-modified')) || ''; } catch (_) { /* sem cabeçalho */ }
  return { dados: Array.isArray(j?.dados) ? j.dados : [], modificado: mod };
}
/** As votações de uma proposição, no mesmo formato de pe5Votacoes, lidas dos arquivos diários. */
async function pe5VotacoesDoArquivo(idProp, anos, fetchFn) {
  const out = []; let modificado = '';
  for (const ano of anos) {
    const lig = await pe5Arquivo('votacoesProposicoes', ano, fetchFn);
    const ids = [...new Set(lig.dados.filter(x => String(x?.proposicao_?.id) === String(idProp)).map(x => String(x.idVotacao)))];
    if (!ids.length) continue;
    const quer = new Set(ids);
    const vots = (await pe5Arquivo('votacoes', ano, fetchFn)).dados.filter(v => quer.has(String(v.id)));
    const temPlenario = vots.some(v => /PLEN/i.test(v.siglaOrgao || '') && ((v.votosSim || 0) + (v.votosNao || 0)) > 0);
    let votos = [], oris = [];
    if (temPlenario) {
      const av = await pe5Arquivo('votacoesVotos', ano, fetchFn); modificado = av.modificado || modificado;
      votos = av.dados.filter(x => quer.has(String(x.idVotacao)));
      try { oris = (await pe5Arquivo('votacoesOrientacoes', ano, fetchFn)).dados.filter(x => quer.has(String(x.idVotacao))); } catch (_) { oris = []; }
    }
    for (const v of vots) {
      const item = { id: v.id, data: pe5DataBR(v.data || v.dataHoraRegistro), iso: String(v.data || v.dataHoraRegistro || '').slice(0, 10), orgao: v.siglaOrgao || '',
        descricao: pe5Corta(v.descricao, 300), aprovada: v.aprovacao === 1 ? true : v.aprovacao === 0 ? false : null, nominal: false };
      const meus = votos.filter(x => String(x.idVotacao) === String(v.id));
      if (/PLEN/i.test(item.orgao) && meus.length) {
        Object.assign(item, { nominal: true }, pe5ResumoVotos(meus.map(x => ({ tipoVoto: x.voto, deputado_: x.deputado_ }))));
        item.orientacoes = oris.filter(o => String(o.idVotacao) === String(v.id)).map(o => ({ quem: o.siglaBancada, orientacao: o.orientacao })).filter(o => o.quem);
      }
      out.push(item);
    }
  }
  out.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
  return { votacoes: out, modificado };
}

// ---------------------------------------------------------------------------------------------
// SENADO: o que a outra Casa fez com a matéria. A API da Câmara não traz relator, placar nem destaques do
// Senado; a NTA do PLP 299/2026 gerada pelo programa em 21/11/2026 saiu sem os destaques votados lá.
// Desde 2019 a numeração de PL, PLP, PEC e PDL é única nas duas Casas: consulta-se pela mesma sigla,
// número e ano, e a ementa é conferida (número igual não é garantia absoluta).
// ---------------------------------------------------------------------------------------------
const PE5_SENADO_API = 'https://legis.senado.leg.br/dadosabertos';
const PE5_RE_ANDAMENTO_SENADO = /aprovad|rejeitad|destaque|retirad|prejudicad|turno suplementar|urg[êe]ncia|reda[çc][ãa]o final|aut[óo]grafo|[àa] c[âa]mara|[àa] san[çc][ãa]o|parecer/i;
function pe5EmentaParecida(a, b) {
  const pal = t => new Set((String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]{5,}/g) || []));
  const x = pal(a), y = pal(b); if (x.size < 3 || y.size < 3) return true;   // sem ementa para comparar: não descarta
  let c = 0; for (const w of x) if (y.has(w)) c++;
  return c / Math.min(x.size, y.size) >= 0.3;
}
/**
 * Histórico da matéria no Senado: relator, deliberação, votações nominais (placar contado nos votos) e os
 * andamentos de Plenário. Devolve null quando o Senado não tem a matéria; falha de rede vira aviso em quem chama.
 */
async function pe5ColetarSenado({ sigla, numero, ano, ementa = '' } = {}, fetchFn) {
  const sg = String(sigla || '').toUpperCase();
  if (!/^(PL|PLP|PEC|PDL|MPV)$/.test(sg) || !/^\d+$/.test(String(numero || '')) || !/^\d{4}$/.test(String(ano || ''))) return null;
  const json = u => pe5Json(u, fetchFn);
  const lista = await json(`${PE5_SENADO_API}/processo?sigla=${sg}&numero=${Number(numero)}&ano=${ano}`);
  const esperado = `${sg} ${Number(numero)}/${ano}`;
  const hits = (Array.isArray(lista) ? lista : []).filter(x => x && pe5Limpo(x.identificacao).toUpperCase() === esperado);
  if (!hits.length) return null;
  const h = hits.find(x => pe5EmentaParecida(ementa, x.ementa)) || null;
  if (!h) return null;
  const avisos = [], tenta = async (rot, fn, pad) => { try { return await fn(); } catch (e) { avisos.push(`Senado, ${rot}: ${e.message}`); return pad; } };
  const det = await tenta('andamento', () => json(`${PE5_SENADO_API}/processo/${h.id}`), null);
  const rel = await tenta('relatoria', () => json(`${PE5_SENADO_API}/processo/relatoria?idProcesso=${h.id}`), []);
  const vot = await tenta('votações', () => json(`${PE5_SENADO_API}/votacao?idProcesso=${h.id}`), []);
  const conta = (votos, re) => (votos || []).filter(v => re.test(String(v.siglaVotoParlamentar || ''))).length;
  const votacoes = (Array.isArray(vot) ? vot : []).filter(v => v && Array.isArray(v.votos) && v.votos.length && !/^s$/i.test(v.votacaoSecreta || ''))
    .sort((a, b) => String(a.dataSessao).localeCompare(String(b.dataSessao)) || (a.sequencialSessao || 0) - (b.sequencialSessao || 0))
    .map(v => ({ data: pe5DataBR(v.dataSessao), iso: String(v.dataSessao || '').slice(0, 10), descricao: pe5Corta(v.descricaoVotacao, 260),
      resultado: /^a/i.test(v.resultadoVotacao || '') ? 'aprovado' : /^r/i.test(v.resultadoVotacao || '') ? 'rejeitado' : pe5Limpo(v.resultadoVotacao),
      sim: conta(v.votos, /^sim$/i), nao: conta(v.votos, /^n[ãa]o$/i), abstencao: conta(v.votos, /^absten/i) }));
  const informes = ((det && det.autuacoes) || []).flatMap(a => a.informesLegislativos || []).filter(i => i && i.descricao)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  // O resumo da sessão de votação traz o resultado de cada destaque e vai quase inteiro; o recebimento de
  // cada emenda e de cada requerimento de destaque (dezenas de linhas) fica de fora.
  const andamentos = informes.filter(i => PE5_RE_ANDAMENTO_SENADO.test(i.descricao) && !/^\s*recebid[ao]s?\b/i.test(i.descricao)).slice(-12)
    .map(i => ({ data: pe5DataBR(i.data), orgao: (i.colegiado && i.colegiado.sigla) || i.siglaColegiado || '', texto: pe5Corta(i.descricao, /^\s*\(sess[ãa]o/i.test(i.descricao) ? 2600 : 420) }));
  const dl = (det && det.deliberacao) || null;
  return {
    id: h.id, codigoMateria: h.codigoMateria || (det && det.codigoMateria) || null, identificacao: esperado,
    autor: pe5Limpo(h.autoria || (det && det.documento && det.documento.resumoAutoria)),
    casaIniciadora: pe5Limpo((det && det.siglaCasaIniciadora) || h.casaIdentificadora) === 'SF' ? 'Senado Federal' : pe5Limpo((det && det.siglaCasaIniciadora) || '') === 'CD' ? 'Câmara dos Deputados' : '',
    situacao: pe5Limpo(h.situacaoAtual || (det && det.situacaoAtual)), dataSituacao: pe5DataBR(h.dataSituacaoAtual || (det && det.dataSituacaoAtual)),
    deliberacao: dl ? { data: pe5DataBR(dl.data), tipo: pe5Limpo(dl.tipoDeliberacao), destino: pe5Limpo(dl.destino) } : null,
    relatores: (Array.isArray(rel) ? rel : []).map(r => ({ nome: pe5Limpo(`${r.formaTratamentoParlamentar || ''} ${r.nomeParlamentar || ''}`), partido: r.siglaPartidoParlamentar || '', uf: r.ufParlamentar || '',
      colegiado: r.nomeColegiado || r.siglaColegiado || '', designadoEm: pe5DataBR(r.dataDesignacao) })).filter(r => r.nome),
    votacoes, andamentos,
    url: h.codigoMateria ? `https://www25.senado.leg.br/web/atividade/materias/-/materia/${h.codigoMateria}` : '',
    avisos,
  };
}

/** Tudo o que a API da Câmara diz da tramitação. Falha parcial não derruba: vai em `avisos`. */
async function pe5ColetarTramitacao(idProp, fetchFn, { hoje = new Date(), ano = null } = {}) {
  const avisos = [];
  const tenta = async (rotulo, fn, padrao) => { try { return await fn(); } catch (e) { avisos.push(`${rotulo}: ${e.message}`); return padrao; } };
  const prop = await tenta('proposição', async () => (await pe5Json(`${PE5_API}/proposicoes/${idProp}`, fetchFn)).dados || {}, {});
  const tram = await tenta('tramitações', async () => (await pe5Json(`${PE5_API}/proposicoes/${idProp}/tramitacoes`, fetchFn)).dados || [], []);
  const autores = await tenta('autores', async () => ((await pe5Json(`${PE5_API}/proposicoes/${idProp}/autores`, fetchFn)).dados || []), []);
  const relacionadas = await tenta('relacionadas', async () => ((await pe5Json(`${PE5_API}/proposicoes/${idProp}/relacionadas`, fetchFn)).dados || []), []);
  let votacoes = await tenta('votações', () => pe5Votacoes(idProp, fetchFn), null);
  let reserva = null;
  // A API falhou na lista ou nos votos de alguma votação do Plenário: tenta os arquivos diários.
  if (votacoes === null || votacoes.some(v => v.falha)) {
    const atual = hoje.getFullYear(), ini = Math.max(Number(prop.ano || ano) || atual, atual - 2);
    const anos = []; for (let a = ini; a <= atual; a++) anos.push(a);
    try {
      const r = await pe5VotacoesDoArquivo(idProp, anos, fetchFn);
      votacoes = r.votacoes;
      reserva = { origem: 'arquivos diários da Câmara', anos, atualizadoEm: r.modificado ? pe5DataBR(new Date(r.modificado).toISOString()) : '' };
      const i = avisos.findIndex(a => /^votações:/.test(a)); if (i >= 0) avisos.splice(i, 1);
    } catch (e) { if (votacoes === null) votacoes = []; avisos.push(`votações (arquivo diário): ${e.message}`); }
  }
  const status = prop.statusProposicao || {};
  const ordAut = [...autores].sort((a, b) => (a.ordemAssinatura || 99) - (b.ordemAssinatura || 99));
  // Veio do Senado (a Câmara registra o autor como "Senado Federal - Fulano") ou já passou por lá: busca o histórico.
  const origemSenado = ordAut.some(a => /^senado federal\b/i.test(pe5Limpo(a.nome)));
  const fase = pe5Fase(status, tram, { origemSenado });
  let senado = null;
  if (origemSenado || fase.codigo === 'senado' || fase.codigo === 'camara_revisao_do_senado') {
    senado = await tenta('Senado', () => pe5ColetarSenado({ sigla: prop.siglaTipo, numero: prop.numero, ano: prop.ano, ementa: prop.ementa }, fetchFn), null);
    if (senado) { avisos.push(...(senado.avisos || [])); delete senado.avisos; }
  }
  return {
    proposicao: { id: prop.id || idProp, sigla: prop.siglaTipo || '', numero: prop.numero || '', ano: prop.ano || '', ementa: pe5Limpo(prop.ementa),
      apresentacao: pe5DataBR(prop.dataApresentacao), autores: ordAut.slice(0, 6).map(a => pe5Limpo(a.nome)), totalAutores: ordAut.length },
    status: { data: pe5DataBR(status.dataHora), iso: String(status.dataHora || '').slice(0, 10), orgao: status.siglaOrgao || '', regime: pe5Regime(status.regime),
      situacao: pe5Limpo(status.descricaoSituacao), andamento: pe5Limpo(status.descricaoTramitacao), despacho: pe5Corta(status.despacho, 400) },
    fase, urgencia: pe5Urgencia(status, tram), marcos: pe5Marcos(tram), votacoes,
    ...(senado ? { senado } : {}),
    relacionadas: relacionadas.filter(r => r && r.siglaTipo && !/^(REQ|EMP|EMC|PRLP|PRLE|SBT|PAR|DTQ|MSC|OF|RDF|EMR|ESB|SSP|EMS|REL|VTS|DVT|PPP|PRL|EMA|EMD|ERD|RPD)$/i.test(r.siglaTipo))
      .slice(0, 20).map(r => ({ rotulo: `${r.siglaTipo} ${r.numero}/${r.ano}`, ementa: pe5Corta(r.ementa, 220) })),
    acessorias: relacionadas.filter(r => r && r.id && r.siglaTipo && !/^Vota[çc][ãa]o Nominal/i.test(r.ementa || ''))
      .slice(0, 40).map(r => ({ id: r.id, rotulo: `${r.siglaTipo} ${r.numero}${Number(r.ano) ? '/' + r.ano : ''}`, ementa: pe5Corta(r.ementa, 200) })),
    ...(reserva ? { reservaVotacoes: reserva } : {}),
    coletadoEm: hoje.toISOString(), avisos,
  };
}

// ---------------------------------------------------------------------------------------------
// MAPA DE VOTOS: quórum da espécie, voto e orientação de cada partido, quem se dividiu.
// ---------------------------------------------------------------------------------------------
const PE5_DEPUTADOS = 513;
/** Quórum para aprovar o mérito, pela espécie da proposição. */
function pe5Quorum(sigla) {
  const s = String(sigla || '').toUpperCase();
  if (s === 'PEC') return { regra: 'três quintos dos deputados, em dois turnos', minimo: 308, base: 'art. 60, § 2º, da Constituição' };
  if (s === 'PLP') return { regra: 'maioria absoluta dos deputados', minimo: 257, base: 'art. 69 da Constituição' };
  return { regra: 'maioria simples, presente a maioria absoluta dos deputados', minimo: null, presenca: 257, base: 'art. 47 da Constituição' };
}
const pe5Sigla = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Orientação que vale para um partido: a dele; se não houver, a do bloco ou da federação em que aparece. */
function pe5OrientacaoDe(partido, orientacoes = []) {
  const alvo = pe5Sigla(partido);
  const validas = orientacoes.filter(o => o && o.quem && String(o.orientacao || '').trim());
  const propria = validas.find(o => pe5Sigla(o.quem) === alvo);
  if (propria) return { orientacao: propria.orientacao, de: propria.quem };
  for (const o of validas) {
    if (!/^(Bl|Fdr)\b/i.test(o.quem)) continue;
    // "Fdr PT-PCdoB-PV" vem separado por hífen; "Bl UniPpPsd..." vem colado, com inicial maiúscula e cortado
    const nome = String(o.quem).replace(/^(Bl|Fdr)\s+/i, '').replace(/\.+$/, '');
    const partes = nome.includes('-') ? nome.split('-') : (nome.match(/[A-ZÀ-Ú][a-zà-ú0-9]*/g) || []);
    if (partes.map(pe5Sigla).some(t => t && (t === alvo || (t.length >= 3 && alvo.startsWith(t) && alvo.length - t.length >= 2)))) return { orientacao: o.orientacao, de: o.quem };
  }
  return { orientacao: '', de: '' };
}
/** Mapa da votação nominal mais recente em Plenário. Não projeta voto: mostra como cada partido votou e orientou. */
function pe5MapaVotos(G) {
  const nominais = (G?.votacoes || []).filter(v => v.nominal && (v.sim + v.nao) > 0);
  const quorum = pe5Quorum(G?.proposicao?.sigla);
  if (!nominais.length) return { quorum, votacao: null, linhas: [], divididos: [], podemos: null };
  const v = [...nominais].sort((a, b) => String(a.iso).localeCompare(String(b.iso))).pop();
  const linhas = (v.partidos || []).map(p => {
    const o = pe5OrientacaoDe(p.partido, v.orientacoes), val = p.sim + p.nao, menor = Math.min(p.sim, p.nao);
    const situacao = !val ? 'sem voto' : menor / val >= 0.25 ? 'dividido' : p.sim > p.nao ? 'a favor' : 'contra';
    const ori = /^sim$/i.test(o.orientacao) ? 'sim' : /^n[ãa]o$/i.test(o.orientacao) ? 'nao' : '';
    return { partido: p.partido, sim: p.sim, nao: p.nao, outros: p.outros || 0, orientacao: o.orientacao || '—', orientadoPor: o.de && pe5Sigla(o.de) !== pe5Sigla(p.partido) ? o.de : '', situacao,
      contraOrientacao: ori === 'sim' ? p.nao : ori === 'nao' ? p.sim : 0 };
  });
  const b = v.bancada || {}, oriP = pe5OrientacaoDe(PE5_PARTIDO, v.orientacoes);
  const divergiram = /^sim$/i.test(oriP.orientacao) ? (b.nao || []) : /^n[ãa]o$/i.test(oriP.orientacao) ? (b.sim || []) : [];
  return { quorum,
    votacao: { data: v.data, descricao: v.descricao, sim: v.sim, nao: v.nao, outros: v.outros || 0, total: v.total, ehMerito: !/requerimento|urg[êe]ncia|retirada|adiamento|destaque/i.test(v.descricao || '') },
    linhas, divididos: linhas.filter(l => l.situacao === 'dividido').map(l => ({ partido: l.partido, sim: l.sim, nao: l.nao })),
    ausentes: Math.max(0, PE5_DEPUTADOS - (v.total || 0)),
    podemos: { orientacao: oriP.orientacao || '', orientadoPor: oriP.de || '', sim: (b.sim || []).length, nao: (b.nao || []).length, divergiram } };
}

// ---------------------------------------------------------------------------------------------
// O PARTIDO E A MATÉRIA: quem da bancada atuou nela, projetos da bancada sobre o tema e como a
// bancada votou em proposições correlatas. Tudo da API da Câmara; falha parcial vira aviso.
// ---------------------------------------------------------------------------------------------
async function pe5Lote(itens, n, fn) {
  const out = new Array(itens.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; try { out[k] = await fn(itens[k], k); } catch (e) { out[k] = { erro: e.message }; } } }));
  return out;
}
const pe5IdDeUri = u => (String(u || '').match(/\/deputados\/(\d+)/) || [])[1] || '';
const pe5Rotulo = s => { const m = String(s || '').match(/\b(PL|PLP|PEC|MPV|PDL|PRC|PLN|PLV)\s*(?:n[ºo.]*\s*)?(\d{1,5})\s*\/\s*(\d{4})\b/i); return m ? { sigla: m[1].toUpperCase(), numero: Number(m[2]), ano: Number(m[3]), rotulo: `${m[1].toUpperCase()} ${Number(m[2])}/${m[3]}` } : null; };

/**
 * @param G          coleta da tramitação (usa proposicao.id e acessorias)
 * @param palavras   termos de busca de uma palavra, vindos da leitura
 * @param correlatas rótulos de proposições correlatas ("PL 2768/2022"), vindos da pesquisa
 */
async function pe5ColetarPartido(G, { palavras = [], correlatas = [] } = {}, fetchFn) {
  const avisos = [], idProp = G?.proposicao?.id;
  const tenta = async (rotulo, fn, padrao) => { try { return await fn(); } catch (e) { avisos.push(`${rotulo}: ${e.message}`); return padrao; } };
  const deps = await tenta('bancada', async () => ((await pe5Json(`${PE5_API}/deputados?siglaPartido=${PE5_PARTIDO}&itens=100&ordem=ASC&ordenarPor=nome`, fetchFn)).dados || []), []);
  const daBancada = new Map(deps.map(d => [String(d.id), d.nome]));
  const doPartido = autores => (autores || []).map(a => daBancada.get(pe5IdDeUri(a.uri))).filter(Boolean);

  // 1. Na própria matéria: autoria e proposições acessórias (requerimento, emenda, destaque) de deputado da bancada
  const autoresProp = idProp ? await tenta('autores', async () => ((await pe5Json(`${PE5_API}/proposicoes/${idProp}/autores`, fetchFn)).dados || []), []) : [];
  const acess = (G?.acessorias || []).slice(0, 30);
  const autAcess = daBancada.size ? await pe5Lote(acess, 4, a => pe5Json(`${PE5_API}/proposicoes/${a.id}/autores`, fetchFn, { tentativas: 1 }).then(j => j.dados || [])) : [];
  const acessorias = acess.map((a, i) => ({ rotulo: a.rotulo, ementa: a.ementa, autores: Array.isArray(autAcess[i]) ? doPartido(autAcess[i]) : [] })).filter(a => a.autores.length);
  if (autAcess.some(x => x && x.erro)) avisos.push('autoria de parte das proposições acessórias não obtida');

  // 2. Projetos de deputados da bancada indexados com os mesmos termos (o modelo escolhe os que tratam do assunto)
  const termos = [...new Set((palavras || []).map(t => String(t || '').trim().split(/\s+/)[0]).filter(t => t.length >= 4))].slice(0, 5);
  const achados = new Map();
  for (const t of termos) {
    const lista = await tenta(`busca "${t}"`, async () => ((await pe5Json(`${PE5_API}/proposicoes?siglaPartidoAutor=${PE5_PARTIDO}&keywords=${encodeURIComponent(t)}&siglaTipo=PL,PLP,PEC&ordem=DESC&ordenarPor=id&itens=20`, fetchFn)).dados || []), []);
    for (const x of lista) if (x && x.id && String(x.id) !== String(idProp) && !achados.has(x.id)) achados.set(x.id, { id: x.id, rotulo: `${x.siglaTipo} ${x.numero}/${x.ano}`, ementa: pe5Corta(x.ementa, 260), termo: t });
  }
  const projetos = [...achados.values()].slice(0, 24);
  const det = await pe5Lote(projetos, 4, async x => {
    const [pr, au] = await Promise.all([pe5Json(`${PE5_API}/proposicoes/${x.id}`, fetchFn), pe5Json(`${PE5_API}/proposicoes/${x.id}/autores`, fetchFn)]);
    return { situacao: pe5Limpo(pr.dados?.statusProposicao?.descricaoSituacao) || pe5Limpo(pr.dados?.statusProposicao?.descricaoTramitacao), apresentacao: pe5DataBR(pr.dados?.dataApresentacao), autores: doPartido(au.dados) };
  });
  projetos.forEach((x, i) => Object.assign(x, det[i] && !det[i].erro ? det[i] : { situacao: '', apresentacao: '', autores: [] }));

  // 3. Como a bancada votou, em Plenário, nas proposições correlatas que a pesquisa identificou
  const alvos = [...new Map((correlatas || []).map(pe5Rotulo).filter(Boolean).map(r => [r.rotulo, r])).values()].filter(r => !(G?.proposicao && r.sigla === G.proposicao.sigla && r.numero === Number(G.proposicao.numero) && r.ano === Number(G.proposicao.ano))).slice(0, 6);
  const votacoesCorrelatas = [];
  for (const r of alvos) {
    await tenta(`votações de ${r.rotulo}`, async () => {
      const lista = (await pe5Json(`${PE5_API}/proposicoes?siglaTipo=${r.sigla}&numero=${r.numero}&ano=${r.ano}`, fetchFn)).dados || [];
      if (!lista[0]) { votacoesCorrelatas.push({ rotulo: r.rotulo, encontrada: false }); return; }
      const vots = await pe5Votacoes(lista[0].id, fetchFn);
      const nominais = vots.filter(v => v.nominal && (v.sim + v.nao) > 0);
      votacoesCorrelatas.push({ rotulo: r.rotulo, encontrada: true, ementa: pe5Corta(lista[0].ementa, 200),
        nominais: nominais.slice(-3).map(v => ({ data: v.data, descricao: v.descricao, sim: v.sim, nao: v.nao, podemosSim: (v.bancada?.sim || []).length, podemosNao: (v.bancada?.nao || []).length, votaramNao: v.bancada?.nao || [], votaramSim: v.bancada?.sim || [], orientacao: pe5OrientacaoDe(PE5_PARTIDO, v.orientacoes).orientacao, orientadoPor: (o => o.de && pe5Sigla(o.de) !== pe5Sigla(PE5_PARTIDO) ? o.de : '')(pe5OrientacaoDe(PE5_PARTIDO, v.orientacoes)) })) });
    }, null);
  }
  return { partido: PE5_PARTIDO, deputados: daBancada.size, autoresDaMateria: doPartido(autoresProp), acessorias, termos, projetos, votacoesCorrelatas, avisos };
}

// ---------------------------------------------------------------------------------------------
// LEI VIGENTE: o artigo pelo CABEÇALHO, nunca pela primeira menção.
//
// A função anterior (dossie.js, extrairArtigo) casava "art. 9º desta Lei" dentro de outro artigo e
// seguia até um artigo de número maior; para artigo novo (87-A) devolvia o vizinho (87). No parecer
// do PL 4675/2025, 8 das 12 linhas de "o que vale hoje" estavam erradas, sob o rótulo "texto lido na
// fonte". Aqui: cabeçalho é "Art. N" com maiúscula, em começo de linha ou depois de fim de frase; o
// artigo termina no próximo cabeçalho; sufixo de letra ("18-A") faz parte do número; e se o artigo não
// existe na lei, a resposta é NULL — "não existe hoje".
// ---------------------------------------------------------------------------------------------
function pe5NumArtigo(s) {
  const m = String(s || '').match(/(\d{1,4})\s*[ºo°]?\s*(?:-\s*([A-Z]{1,2})\b)?/);
  return m ? { n: Number(m[1]), letra: m[2] || '', chave: m[1] + (m[2] ? '-' + m[2] : '') } : null;
}
const PE5_RE_CABECALHO = /(^|\n|[.;:”"»)]\s+|\(NR\)\s*|\(AC\)\s*|[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ]{3,}\s+)(Art\.\s*(\d{1,4})\s*[ºo°]?\.?(?:\s*-\s*([A-Z]{1,2})\b)?)/g;

/** Lista os cabeçalhos de artigo do texto: [{ chave, pos }]. */
function pe5CabecalhosDeArtigo(textoLei) {
  const t = String(textoLei || ''); const out = [];
  let m; PE5_RE_CABECALHO.lastIndex = 0;
  while ((m = PE5_RE_CABECALHO.exec(t)) !== null) {
    const pos = m.index + m[1].length, depois = t.slice(pos + m[2].length, pos + m[2].length + 12);
    // "Art. 9º desta Lei", "Art. 5º da Lei nº…", "Art. 47 e seguintes": remissão em começo de frase, não cabeçalho
    // (só minúsculas: o texto do artigo começa com maiúscula — "Art. 7º A perda de mandato…")
    if (/^\s*(?:dest[ae]|d[aeo]s?|e|ou|a|ao|at[ée])\s|^\s*,/.test(depois)) continue;
    out.push({ chave: m[3] + (m[4] ? '-' + m[4] : ''), pos });
  }
  return out;
}

/**
 * Texto vigente de um artigo. Devolve { texto, completo } ou null (o artigo não existe na lei).
 * Em texto compilado o mesmo cabeçalho aparece mais de uma vez (redação antiga riscada e a nova):
 * fica a ÚLTIMA ocorrência com conteúdo.
 */
function pe5ArtigoVigente(textoLei, artigo, { max = 1800 } = {}) {
  const alvo = pe5NumArtigo(artigo); if (!alvo) return null;
  const t = String(textoLei || '');
  const cab = pe5CabecalhosDeArtigo(t);
  const idx = cab.map((c, i) => (c.chave === alvo.chave ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return null;
  let melhor = null;
  for (const i of idx) {
    const fim = i + 1 < cab.length ? cab[i + 1].pos : t.length;
    // sem o título da divisão seguinte, que vem colado ao fim do artigo ("… Seção II Do Tribunal Administrativo")
    const bruto = pe5Limpo(t.slice(cab[i].pos, fim)).replace(/\s+(?:T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|Se[çc][ãa]o|SUBSE[ÇC][ÃA]O|Subse[çc][ãa]o|LIVRO)\s+[IVXLCDM]+(?:-[A-Z])?\b[^.;:]{0,160}$/, '');
    if (/^Art\.\s*\d+\s*[ºo°]?\.?(?:\s*-\s*[A-Z]+)?\.?\s*\(?(revogad|vetad)/i.test(bruto)) { melhor = melhor || { texto: bruto.slice(0, 200), completo: true, revogado: true }; continue; }
    if (bruto.length < 25) continue;                      // cabeçalho solto (índice, remissão)
    melhor = { texto: bruto.length > max ? bruto.slice(0, max).replace(/\s+\S*$/, '') + ' […]' : bruto, completo: bruto.length <= max };
  }
  return melhor;
}

/** Normas (lei, LC, decreto-lei) e artigos que o texto analisado altera, a partir das alterações apuradas. */
function pe5ArtigosAlterados(alteracoes = []) {
  const out = [];
  for (const a of alteracoes) {
    const d = String(a.dispositivo || '');
    // "LC nº 235/2026" e "LCP 235/2026" valem como "Lei Complementar": na NTA do PLP 299/2026 de 21/11/2026 a
    // leitura abreviou o nome da lei e seis linhas da tabela "o que muda" ficaram sem o texto vigente.
    const bruto = d.match(/(Lei Complementar|LCP?|Decreto-Lei|Lei)\s+n?[ºo°.]?\s*([\d.]+)\s*(?:\/|,?\s*de\s+(?:\d{1,2}[ºo°]?\s+de\s+[a-zçãé]+\s+de\s+)?)(\d{4})/i);
    const norma = bruto && /^LCP?$/i.test(bruto[1]) ? [bruto[0], 'Lei Complementar', bruto[2], bruto[3]] : bruto;
    const arts = d.match(/\barts?\.?\s*([^,;]*?(?:\d{1,4}\s*[ºo°]?(?:\s*-\s*[A-Z]{1,2})?(?:\s*(?:,|e|a)\s*)?)+)/i);
    if (!norma) continue;
    const tipo = /complementar/i.test(norma[1]) ? 'lcp' : /decreto/i.test(norma[1]) ? 'del' : 'lei';
    const numeros = arts ? [...arts[1].matchAll(/(\d{1,4})\s*[ºo°]?(?:\s*-\s*([A-Z]{1,2})\b)?/g)].map(m => m[1] + (m[2] ? '-' + m[2] : '')) : [];
    out.push({ id: a.id, tipo, numero: norma[2].replace(/\./g, ''), ano: norma[3], artigos: [...new Set(numeros)].slice(0, 6), rotuloNorma: `${norma[1]} nº ${norma[2]}/${norma[3]}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// INVENTÁRIO: o que foi lido e o que existe e não foi lido. "Não consta" só vale para o que se leu.
// ---------------------------------------------------------------------------------------------
function pe5Inventario(documentos = [], disponiveis = []) {
  const lidos = documentos.map(d => ({ rotulo: d.rotulo, url: d.url || '', caracteres: (d.texto || '').length, paginas: d.paginas || null,
    legivel: (d.texto || '').trim().length >= 400, erro: d.erro || '' }));
  const urls = new Set(lidos.map(d => d.url).filter(Boolean)), rot = new Set(lidos.map(d => d.rotulo));
  const naoLidos = (disponiveis || []).filter(d => d && !urls.has(d.url) && !rot.has(d.rotulo)).map(d => ({ rotulo: d.rotulo, url: d.url || '', motivo: d.motivo || 'não incluído na leitura' }));
  return { lidos, naoLidos, ilegiveis: lidos.filter(d => !d.legivel).map(d => d.rotulo) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PE5_API, pe5DataBR, pe5Limpo, pe5Corta, pe5Fase, pe5Marcos, pe5Urgencia, pe5ResumoVotos, pe5Votacoes, pe5VotacoesDoArquivo, pe5ColetarTramitacao, pe5ColetarSenado, pe5Regime, pe5Quorum, pe5OrientacaoDe, pe5MapaVotos, pe5ColetarPartido, pe5Rotulo,
    pe5NumArtigo, pe5CabecalhosDeArtigo, pe5ArtigoVigente, pe5ArtigosAlterados, pe5Inventario };
}
