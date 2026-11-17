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

function pe5Fase(status = {}, tramitacoes = []) {
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
  return { ...fase, codigo: emPlenario ? 'camara_plenario' : 'camara_comissoes',
    descricao: emPlenario ? 'A matéria está na Câmara, em condições de ser votada no Plenário.' : 'A matéria está na Câmara, em fase de comissões.' };
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
function pe5Urgencia(status = {}, tramitacoes = []) {
  const reg = pe5Limpo(status.regime);
  const aprov = tramitacoes.filter(t => /aprova[çc][ãa]o de urg[êe]ncia|aprovado o requerimento.*urg[êe]ncia/i.test(`${t.descricaoTramitacao} ${t.despacho}`))
    .sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)))[0] || null;
  const apres = tramitacoes.filter(t => /requerimento de urg[êe]ncia/i.test(`${t.descricaoTramitacao} ${t.despacho}`))
    .sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)))[0] || null;
  const constitucional = /64/.test(reg) || /urg[êe]ncia constitucional/i.test(reg);
  if (!/urg[êe]ncia/i.test(reg) && !aprov) return { tem: false, regime: reg || 'não informado' };
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

/** Tudo o que a API da Câmara diz da tramitação. Falha parcial não derruba: vai em `avisos`. */
async function pe5ColetarTramitacao(idProp, fetchFn, { hoje = new Date() } = {}) {
  const avisos = [];
  const tenta = async (rotulo, fn, padrao) => { try { return await fn(); } catch (e) { avisos.push(`${rotulo}: ${e.message}`); return padrao; } };
  const prop = await tenta('proposição', async () => (await pe5Json(`${PE5_API}/proposicoes/${idProp}`, fetchFn)).dados || {}, {});
  const tram = await tenta('tramitações', async () => (await pe5Json(`${PE5_API}/proposicoes/${idProp}/tramitacoes`, fetchFn)).dados || [], []);
  const autores = await tenta('autores', async () => ((await pe5Json(`${PE5_API}/proposicoes/${idProp}/autores`, fetchFn)).dados || []), []);
  const relacionadas = await tenta('relacionadas', async () => ((await pe5Json(`${PE5_API}/proposicoes/${idProp}/relacionadas`, fetchFn)).dados || []), []);
  const votacoes = await tenta('votações', () => pe5Votacoes(idProp, fetchFn), []);
  const status = prop.statusProposicao || {};
  const ordAut = [...autores].sort((a, b) => (a.ordemAssinatura || 99) - (b.ordemAssinatura || 99));
  return {
    proposicao: { id: prop.id || idProp, sigla: prop.siglaTipo || '', numero: prop.numero || '', ano: prop.ano || '', ementa: pe5Limpo(prop.ementa),
      apresentacao: pe5DataBR(prop.dataApresentacao), autores: ordAut.slice(0, 6).map(a => pe5Limpo(a.nome)), totalAutores: ordAut.length },
    status: { data: pe5DataBR(status.dataHora), iso: String(status.dataHora || '').slice(0, 10), orgao: status.siglaOrgao || '', regime: pe5Limpo(status.regime),
      situacao: pe5Limpo(status.descricaoSituacao), andamento: pe5Limpo(status.descricaoTramitacao), despacho: pe5Corta(status.despacho, 400) },
    fase: pe5Fase(status, tram), urgencia: pe5Urgencia(status, tram), marcos: pe5Marcos(tram), votacoes,
    relacionadas: relacionadas.filter(r => r && r.siglaTipo && !/^(REQ|EMP|EMC|PRLP|PRLE|SBT|PAR|DTQ|MSC|OF|RDF|EMR|ESB|SSP|EMS|REL|VTS|DVT|PPP|PRL|EMA|EMD|ERD|RPD)$/i.test(r.siglaTipo))
      .slice(0, 20).map(r => ({ rotulo: `${r.siglaTipo} ${r.numero}/${r.ano}`, ementa: pe5Corta(r.ementa, 220) })),
    coletadoEm: hoje.toISOString(), avisos,
  };
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
    const norma = d.match(/(Lei Complementar|Decreto-Lei|Lei)\s+n?[ºo°.]?\s*([\d.]+)\s*(?:\/|,?\s*de\s+(?:\d{1,2}[ºo°]?\s+de\s+[a-zçãé]+\s+de\s+)?)(\d{4})/i);
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
  module.exports = { PE5_API, pe5DataBR, pe5Limpo, pe5Corta, pe5Fase, pe5Marcos, pe5Urgencia, pe5ResumoVotos, pe5Votacoes, pe5ColetarTramitacao,
    pe5NumArtigo, pe5CabecalhosDeArtigo, pe5ArtigoVigente, pe5ArtigosAlterados, pe5Inventario };
}
