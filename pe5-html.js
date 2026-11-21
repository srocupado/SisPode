// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Parecer de Especialista (refeito em 17/11/2026) — O DOCUMENTO.
//
// Recebe o parecer estruturado (pe5-pipeline.js) e devolve o HTML de impressão, no padrão institucional.
// O texto vem em blocos por seção, não em prosa corrida com marcadores: é isso que permite ao programa
// não imprimir seção vazia, montar as tabelas com os dados dele (tramitação, votações, lei vigente,
// fontes) e conferir cada bloco.
//
// Duas decisões de impressão, medidas nos pareceres anteriores:
//   - SEM HIFENIZAÇÃO. Com `hyphens:auto` o Paged.js perdia a linha inteira quando a palavra partida
//     caía na quebra de página (PL 4675/2025: sumiu "2025, culminou na designação do grupo…").
//   - DATA E MODELO no cabeçalho. O parecer anterior não dizia quando fora gerado.
//
// Script clássico (global na extensão) + module.exports para os testes.

'use strict';

const pe5Esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pe5DataHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

const CSS_PE5 = `
  p, li, td, th { hyphens:manual !important; -webkit-hyphens:manual !important; }
  p, li { text-align:justify; }
  .pe-frase, .pe-ponto, .pe-arg, .pe-fonte, .pe-indice a, table.pe td, table.pe th, .pe-emenda .red { text-align:left; }
  .pe-caixa p, .pe-caixa li { text-align:justify; }
  .pe-carimbo { text-align:center; font-size:8.5pt; color:#6b7280; margin:-6px 0 12px; }
  .pe-cola { break-inside:avoid; page-break-inside:avoid; }
  .pe-risco { border-left:3px solid #c8d0d8; padding:2px 0 2px 10px; margin:8px 0 12px; break-inside:avoid; page-break-inside:avoid; }
  .pe-risco h3 { margin:0 0 3px; font-size:11.5pt; color:#0a2f4f; }
  .pe-risco p { margin:2px 0; }
  .pe-frase { font-size:13.5pt; line-height:1.45; font-weight:600; color:#003c1f; margin:10px 0 12px; text-align:left; }
  .pe-caixa { border:1.5px solid #0a4a7a; background:#f4f8fc; border-radius:4px; padding:10px 14px; margin:10px 0; }
  .pe-caixa.junta { break-inside:avoid; page-break-inside:avoid; }
  .pe-caixa h3 { margin:0 0 4px; color:#0a4a7a; font-size:11pt; text-transform:uppercase; letter-spacing:.3px; }
  .pe-caixa p, .pe-caixa li { font-size:11.5pt; line-height:1.5; }
  .pe-ponto { margin:5px 0; font-size:11.5pt; line-height:1.45; }
  .pe-grav { display:inline-block; font-size:8pt; font-weight:700; padding:1px 7px; border-radius:999px; margin-right:6px; vertical-align:1px; text-transform:uppercase; }
  .pe-grav.alta { background:#fde2e1; color:#8a1c16; } .pe-grav.media { background:#fdf0cf; color:#7a5200; } .pe-grav.baixa { background:#e8ecef; color:#475057; }
  .pe-parte { font-size:15pt; font-weight:700; color:#fff; background:#003c1f; padding:7px 12px; margin:22px 0 8px; break-after:avoid; page-break-after:avoid; }
  .pe-nota { font-size:9.5pt; color:#555; background:#fafafa; border-left:3px solid #c9a227; padding:6px 10px; margin:6px 0 10px; line-height:1.45; }
  .pe-disp { font-size:9pt; color:#6b7280; font-weight:400; }
  table.pe { border-collapse:collapse; width:100%; margin:8px 0 12px; font-size:10pt; }
  table.pe th { background:#eef3f8; text-align:left; padding:6px 8px; border:1px solid #c8d0d8; font-size:9.5pt; }
  table.pe td { padding:6px 8px; border:1px solid #c8d0d8; vertical-align:top; line-height:1.45; }
  table.pe tr { break-inside:avoid; page-break-inside:avoid; }
  table.pe thead { display:table-header-group; }
  table.pe .novo { color:#8a1c16; font-style:italic; }
  table.pe small, .pe-fonte { color:#6b7280; font-size:8.5pt; }
  .pe-contro { border:1px solid #c8d0d8; border-radius:4px; margin:10px 0 14px; }
  .pe-contro > h3 { margin:0; padding:7px 10px; background:#eef3f8; color:#0a2f4f; font-size:11.5pt; border-bottom:1px solid #c8d0d8; }
  table.pe-lados { border-collapse:collapse; width:100%; table-layout:fixed; }
  table.pe-lados td { width:50%; padding:8px 10px; vertical-align:top; } table.pe-lados td + td { border-left:1px solid #c8d0d8; }
  .pe-lados h4 { margin:0 0 4px; font-size:9.5pt; text-transform:uppercase; letter-spacing:.3px; }
  .pe-lados .favor h4 { color:#155724; } .pe-lados .contra h4 { color:#8a1c16; }
  .pe-arg { font-size:10.5pt; line-height:1.45; margin:0 0 7px; }
  .pe-arg b { font-weight:600; } .pe-arg .ev { display:block; color:#555; font-size:9.5pt; margin-top:1px; }
  .pe-estado { padding:7px 10px; border-top:1px solid #c8d0d8; font-size:10.5pt; line-height:1.45; background:#fcfcfc; }
  .pe-vazio { color:#888; font-style:italic; font-size:10pt; }
  .pe-emenda { border-left:3px solid #00A859; padding:4px 0 4px 10px; margin:8px 0 12px; break-inside:avoid; }
  .pe-emenda .red { font-family:Georgia,'Times New Roman',serif; font-size:11pt; line-height:1.5; background:#f7faf7; padding:6px 9px; margin-top:4px; }
  .pe-indice { font-size:10.5pt; margin:4px 0 10px; }
  .pe-indice a { display:flex; align-items:baseline; text-decoration:none; color:#003c1f; margin:2px 0; break-inside:avoid; }
  .pe-indice a .ld { flex:1 1 auto; border-bottom:1px dotted #b9c2cc; margin:0 5px; position:relative; top:-3px; }
  .pe-indice a::after { content: target-counter(attr(href url), page); color:#444; }
  .pe-alerta { border:1.5px solid #8a1c16; background:#fdf3f2; color:#5c120e; border-radius:4px; padding:8px 12px; margin:8px 0; font-size:10.5pt; line-height:1.45; }
  .pe-ok { color:#155724; } .pe-atencao { color:#8a1c16; font-weight:600; }
  a.pe-link { color:#0a4a7a; text-decoration:none; }
`;

const PE5_GRAV = { alta: 'alta', media: 'média', baixa: 'baixa' };

/** Texto vigente encurtado para caber na célula da tabela, sem cortar no meio da palavra. */
function pe5Encurta(t, max = 420) { const s = String(t || '').trim(); return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, '') + ' […]'; }

function pe5QuadroPolitico(G, esc) {
  // Matéria que a Câmara ainda não registrou (parecer feito sobre documento entregue pelo analista):
  // dizer isso, em vez de imprimir "Fase." e "Regime." vazios.
  if (!G || (!G.proposicao && !G.status && !(G.votacoes || []).length)) return '<p>A Câmara dos Deputados não tinha registro de tramitação desta matéria na data desta nota. Regime, votações e voto da bancada não puderam ser levantados.</p>';
  const L = [];
  const u = G.urgencia || {};
  L.push(`<p><b>Fase.</b> ${esc(G.fase?.descricao || '')}${G.status?.situacao ? ` Situação registrada em ${esc(G.status.data)}: ${esc(G.status.situacao)}${G.status.orgao ? ` (${esc(G.status.orgao)})` : ''}.` : ''}</p>`);
  L.push(`<p><b>Regime.</b> ${u.tem ? `${esc(u.tipo.charAt(0).toUpperCase() + u.tipo.slice(1))}${u.aprovadaEm ? `, aprovada em ${esc(u.aprovadaEm)}` : ''}.` : `Sem urgência aprovada (${esc(u.regime || 'regime não informado')}).${u.pedidaEm ? ` Requerimento de urgência apresentado em ${esc(u.pedidaEm)}, ainda não votado.` : ''}`}</p>`);
  if (G.pauta?.titulo) L.push(`<p><b>Pauta.</b> Consta da pauta de Plenário de ${esc(G.pauta.data || '')}.</p>`);
  const nominais = (G.votacoes || []).filter(v => v.nominal);
  for (const v of nominais) {
    const b = v.bancada || {}, nomes = k => (b[k] || []).join(', ');
    const votoPode = b.total ? `<b>Podemos:</b> ${b.sim.length} sim, ${b.nao.length} não${b.abstencao.length + b.obstrucao.length + b.outros.length ? `, ${b.abstencao.length + b.obstrucao.length + b.outros.length} outros` : ''}.${b.nao.length && b.sim.length ? ` Votaram ${b.nao.length <= b.sim.length ? `não: ${esc(nomes('nao'))}` : `sim: ${esc(nomes('sim'))}`}.` : ''}` : '<b>Podemos:</b> sem voto registrado.';
    L.push(`<p><b>Votação nominal de ${esc(v.data)}.</b> ${esc(v.descricao.replace(/\s*Sim:.*$/, ''))} Placar: <b>${v.sim} a ${v.nao}</b>. ${votoPode}</p>`);
  }
  const S = G.senado;
  if (!nominais.length) L.push(`<p><b>Votações${S ? ' na Câmara' : ''}.</b> Não há votação nominal de Plenário registrada para esta matéria.</p>`);
  // O que a outra Casa decidiu: relator, deliberação e o placar de cada votação nominal (dados abertos do Senado).
  if (S) {
    const rel = (S.relatores || []).map(r => `${r.nome} (${r.partido}-${r.uf})`).join('; ');
    L.push(`<p><b>No Senado.</b> ${S.deliberacao ? `${esc(S.deliberacao.tipo)} em ${esc(S.deliberacao.data)}${S.deliberacao.destino ? ` (${esc(S.deliberacao.destino.replace(/^[ÀA]\s+/i, 'à ').replace(/^à\s/, 'destino: ').replace(/\.$/, ''))})` : ''}.` : `${esc(S.situacao ? S.situacao.charAt(0) + S.situacao.slice(1).toLowerCase() : 'Situação não informada')}${S.dataSituacao ? ` (${esc(S.dataSituacao)})` : ''}.`}${rel ? ` Relator: ${esc(rel)}.` : ''}</p>`);
    if ((S.votacoes || []).length) L.push(`<table class="pe"><thead><tr><th style="width:74px">Data</th><th>Votação nominal no Senado</th><th style="width:78px">Resultado</th><th style="width:64px">Placar</th></tr></thead><tbody>${S.votacoes.map(v => `<tr><td>${esc(v.data)}</td><td>${esc(v.descricao.replace(/^Votação nominal d[aeo]s?\s+/i, '').replace(/^./, c => c.toUpperCase()))}</td><td>${esc(v.resultado)}</td><td><b>${v.sim} a ${v.nao}</b></td></tr>`).join('')}</tbody></table>`);
  }
  return L.join('');
}

function pe5Linha(marcos, esc) {
  if (!marcos || !marcos.length) return '';
  return `<table class="pe"><thead><tr><th style="width:74px">Data</th><th style="width:58px">Órgão</th><th>Andamento</th></tr></thead><tbody>${marcos.map(m => `<tr><td>${esc(m.data)}</td><td>${esc(m.orgao)}</td><td>${esc(m.fato)}</td></tr>`).join('')}</tbody></table>`;
}

function pe5Alteracoes(alts, esc) {
  if (!alts || !alts.length) return '';
  return `<table class="pe"><thead><tr><th style="width:21%">Dispositivo</th><th style="width:42%">O que vale hoje</th><th>O que o texto faz</th></tr></thead><tbody>${alts.map(a => `<tr>
    <td><b>${esc(a.dispositivo)}</b></td>
    <td>${a.vigente ? `${esc(pe5Encurta(a.vigente))}${a.fonteLei ? `<br><small>${esc(a.fonteLei)}</small>` : ''}` : a.novo ? '<span class="novo">Não existe hoje: dispositivo novo.</span>' : '<span class="novo">Texto vigente não obtido.</span>'}</td>
    <td>${esc(a.muda)}</td></tr>`).join('')}</tbody></table>`;
}

function pe5Atores(atores, esc) {
  if (!atores || !atores.length) return '';
  const ordem = { 'favorável': 0, 'favorável com ressalvas': 1, 'neutro': 2, 'contrário com ressalvas': 3, 'contrário': 4 };
  const L = [...atores].sort((a, b) => (ordem[a.posicao] ?? 2) - (ordem[b.posicao] ?? 2));
  return `<table class="pe"><thead><tr><th style="width:27%">Quem</th><th style="width:25%">O que representa</th><th style="width:13%">Posição</th><th style="width:11%">Data</th><th>Sobre qual texto · fonte</th></tr></thead><tbody>${L.map(a => `<tr>
    <td><b>${esc(a.ator)}</b></td><td>${esc(a.quem_e || '')}</td><td>${esc(a.posicao || '')}</td><td>${esc(a.data || 'sem data')}</td>
    <td>${esc(a.versao === 'original' ? 'projeto original' : a.versao === 'substitutivo' ? 'texto em votação' : 'não especificado')} · <a class="pe-link" href="${esc(a.fonte_url)}">${esc(a.fonte_nome)}</a></td></tr>`).join('')}</tbody></table>`;
}

function pe5Controversia(c, esc) {
  const lado = (lista, vazio) => (lista && lista.length) ? lista.map(a => `<p class="pe-arg">${esc(a.argumento)}<span class="ev"><b>Quem sustenta:</b> ${esc(a.quem || 'não identificado')}.${a.evidencia && !/^n[ãa]o apresentada/i.test(a.evidencia) ? ` <b>Evidência citada:</b> ${esc(a.evidencia)}` : ' Sem evidência apresentada na fonte.'}</span></p>`).join('') : `<p class="pe-vazio">${vazio}</p>`;
  return `<div class="pe-contro"><h3>${esc(c.questao)}${c.dispositivos && c.dispositivos !== '—' ? ` <span class="pe-disp">· ${esc(c.dispositivos)}</span>` : ''}</h3>
    <table class="pe-lados"><tr><td class="favor"><h4>A favor do texto</h4>${lado(c.favor, 'Nenhum argumento localizado nas fontes lidas.')}</td><td class="contra"><h4>Contra o texto</h4>${lado(c.contra, 'Nenhum argumento localizado nas fontes lidas.')}</td></tr></table>
    ${c.estado ? `<div class="pe-estado"><b>Como está no texto em votação:</b> ${esc(c.estado)}</div>` : ''}</div>`;
}

function pe5Fontes(p, esc) {
  const linhas = [];
  const add = (tema, o) => { if (o && o.fonte_url) linhas.push({ tema, nome: o.fonte_nome || '', url: o.fonte_url, urlFinal: o.fonte_url_final || '', tipo: o.fonte_tipo || '', data: o.data || '' }); };
  const pq = p.pesquisa || {};
  for (const a of pq.debate?.atores || []) add(`Posição: ${a.ator}`, a);
  for (const j of pq.internacional?.jurisdicoes || []) { add(`${j.lugar}: ${j.norma}`, j); for (const c of j.criticas || []) add(`${j.lugar}: crítica de ${c.quem}`, c); }
  for (const j of pq.contexto?.jurisprudencia || []) add(`${j.tribunal}, ${j.processo}`, j);
  for (const j of pq.contexto?.normas || []) add(j.norma, j);
  for (const j of pq.contexto?.dados || []) add(j.dado, j);
  for (const j of pq.contexto?.correlatas || []) add(j.proposicao, j);
  for (const j of pq.contexto?.documentos_base || []) add(j.documento, j);
  for (const j of pq.contexto?.alcance || []) add(`Receita: ${j.grupo}`, j);
  for (const j of pq.congresso?.historico || []) add(`Histórico: ${j.proposicao}`, j);
  for (const j of pq.congresso?.judicializacao || []) add(`Judicialização: ${j.alvo || j.sinal || ''}`, j);
  if (!linhas.length) return '';
  const vistos = new Set();
  const unicas = linhas.filter(l => { const k = l.tema + '|' + l.url; if (vistos.has(k)) return false; vistos.add(k); return true; });
  return `<table class="pe"><thead><tr><th style="width:36%">Assunto</th><th style="width:12%">Data</th><th style="width:12%">Tipo</th><th>Fonte</th></tr></thead><tbody>${unicas.map(l => `<tr><td>${esc(l.tema)}</td><td>${esc(l.data || '—')}</td><td>${esc(l.tipo || '—')}</td><td><a class="pe-link" href="${esc(l.urlFinal || l.url)}">${esc(l.nome)}</a></td></tr>`).join('')}</tbody></table>`;
}

/** Repete em cada célula a largura declarada no cabeçalho: quando a tabela quebra de página, a continuação não leva o cabeçalho e perderia as colunas. */
function pe5LargurasFixas(html) {
  return String(html).replace(/<table class="pe">[\s\S]*?<\/table>/g, tab => {
    const ths = [...((tab.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0]).matchAll(/<th(?=[\s>])(?:\s+style="width:([^"]+)")?[^>]*>/g)].map(m => m[1] || '');
    if (!ths.some(Boolean)) return tab;
    return tab.replace(/<tbody>[\s\S]*<\/tbody>/, corpo => corpo.replace(/<tr>[\s\S]*?<\/tr>/g, linha => { let i = 0; return linha.replace(/<td>/g, m => { const w = ths[i++]; return w ? `<td style="width:${w}">` : m; }); }));
  });
}

/** Índice das referências da pesquisa por id (Q1, W2, R1, Y1, Z3…), para pôr a fonte junto do texto. */
function pe5IndicePesquisa(pq = {}) {
  const m = new Map();
  for (const x of [...(pq.debate?.atores || []), ...(pq.internacional?.jurisdicoes || []), ...(pq.contexto?.jurisprudencia || []), ...(pq.contexto?.normas || []), ...(pq.contexto?.dados || []), ...(pq.contexto?.correlatas || []), ...(pq.contexto?.documentos_base || []), ...(pq.contexto?.alcance || []), ...(pq.congresso?.historico || []), ...(pq.congresso?.judicializacao || [])]) if (x && x.id) m.set(x.id, x);
  return m;
}
function pe5LinkFonte(x, esc) { return x && x.fonte_url ? `<a class="pe-link" href="${esc(x.fonte_url_final || x.fonte_url)}">${esc(x.fonte_nome || 'fonte')}</a>` : ''; }
/** Mapa de votos (dado do programa): quórum, a votação nominal mais recente por partido, quem se dividiu. Não projeta voto. */
function pe5MapaHtml(G, esc) {
  const M = G && G.mapa; if (!M) return '';
  const q = M.quorum || {}, L = [];
  L.push(`<p><b>Quórum para aprovar o mérito.</b> ${esc(q.regra ? q.regra.charAt(0).toUpperCase() + q.regra.slice(1) : '')} (${esc(q.base || '')}).${q.minimo ? ` São necessários ao menos ${q.minimo} votos sim.` : q.presenca ? ` A votação só vale com ${q.presenca} deputados presentes; aprova-se com mais votos sim do que não.` : ''}</p>`);
  if (!M.votacao) {
    const vs = (G.senado && G.senado.votacoes) || [], u = vs[vs.length - 1];
    L.push(`<p>Não há votação nominal desta matéria registrada no Plenário da Câmara.${u ? ` No Senado, a votação nominal mais recente foi em ${esc(u.data)} (${u.sim} a ${u.nao}); os placares estão no quadro político.` : ''}</p>`);
    return L.join('');
  }
  const v = M.votacao;
  L.push(`<p><b>Votação nominal mais recente em Plenário, em ${esc(v.data)}.</b> ${esc(String(v.descricao || '').replace(/\s*Sim:.*$/, ''))} Placar: ${v.sim} a ${v.nao}${v.outros ? `, com ${v.outros} abstenção, obstrução ou voto de outra espécie` : ''}; ${M.ausentes} deputados não registraram voto.${v.ehMerito ? '' : ' Não foi a votação do mérito: mostra a força de cada lado naquela data.'}</p>`);
  if ((M.linhas || []).length) L.push(`<table class="pe"><thead><tr><th style="width:24%">Partido</th><th style="width:9%">Sim</th><th style="width:9%">Não</th><th style="width:10%">Outros</th><th style="width:26%">Orientação</th><th>Como votou</th></tr></thead><tbody>${M.linhas.map(l => `<tr><td><b>${esc(l.partido)}</b></td><td>${l.sim}</td><td>${l.nao}</td><td>${l.outros || 0}</td><td>${esc(l.orientacao)}${l.orientadoPor ? `<br><small>${esc(l.orientadoPor)}</small>` : ''}</td><td>${l.situacao === 'dividido' ? '<b>dividido</b>' : esc(l.situacao)}${l.contraOrientacao ? `<br><small>${l.contraOrientacao} contra a orientação</small>` : ''}</td></tr>`).join('')}</tbody></table>`);
  const div = (M.divididos || []).filter(d => d.sim + d.nao >= 10);
  if (div.length) L.push(`<p><b>Partidos divididos</b> (ao menos um quarto dos votos de cada lado, entre os que deram dez votos ou mais): ${div.map(d => `${esc(d.partido)}, ${d.sim} a ${d.nao}`).join('; ')}.</p>`);
  const P = M.podemos;
  if (P) L.push(`<p><b>Podemos.</b> ${P.orientacao ? `Orientação: ${esc(P.orientacao)}${P.orientadoPor ? ` (pelo ${esc(P.orientadoPor)})` : ''}.` : 'Sem orientação registrada para o partido naquela votação.'} A bancada deu ${P.sim} votos sim e ${P.nao} não.${(P.divergiram || []).length ? ` Votaram contra a orientação: ${esc(P.divergiram.join(', '))}.` : ''}</p>`);
  L.push(`<p class="pe-fonte">Votos e orientações são os registrados nos dados abertos da Câmara${G.reservaVotacoes ? ` (lidos dos ${esc(G.reservaVotacoes.origem)}${G.reservaVotacoes.atualizadoEm ? `, atualizados em ${esc(G.reservaVotacoes.atualizadoEm)}` : ''})` : ''}. O quadro mostra como cada partido votou naquela data; não é previsão de voto.</p>`);
  return L.join('');
}

/** O Podemos e a matéria: o texto do modelo e, do programa, quem atuou, os projetos da bancada e os votos em proposições correlatas. */
function pe5PartidoHtml(doc, G, esc) {
  const P = (G && G.partido) || {}, D = doc || {}, L = [];
  L.push(pe5Prosa(D.texto, esc));
  if ((P.acessorias || []).length) L.push(`<p><b>Iniciativas de deputados do Podemos nesta matéria</b></p><table class="pe"><thead><tr><th style="width:18%">Proposição</th><th style="width:26%">Autor</th><th>O que pede</th></tr></thead><tbody>${P.acessorias.map(a => `<tr><td><b>${esc(a.rotulo)}</b></td><td>${esc(a.autores.join(', '))}</td><td>${esc(a.ementa)}</td></tr>`).join('')}</tbody></table>`);
  const esc2 = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const escolhidos = new Set((Array.isArray(D.projetos) ? D.projetos : []).map(esc2));
  const proj = (P.projetos || []).filter(x => escolhidos.has(esc2(x.rotulo)));
  if (proj.length) L.push(`<p><b>Projetos de deputados do Podemos sobre o tema</b></p><table class="pe"><thead><tr><th style="width:16%">Projeto</th><th style="width:22%">Autor</th><th>Ementa</th><th style="width:22%">Situação</th></tr></thead><tbody>${proj.map(x => `<tr><td><b>${esc(x.rotulo)}</b>${x.apresentacao ? `<br><small>${esc(x.apresentacao)}</small>` : ''}</td><td>${esc((x.autores || []).join(', ') || '—')}</td><td>${esc(x.ementa)}</td><td>${esc(x.situacao || '—')}</td></tr>`).join('')}</tbody></table>`);
  const vc = (P.votacoesCorrelatas || []).filter(v => v.encontrada), comVoto = vc.filter(v => (v.nominais || []).length);
  if (comVoto.length) L.push(`<p><b>Como a bancada votou em proposições correlatas</b></p><table class="pe"><thead><tr><th style="width:16%">Proposição</th><th style="width:12%">Data</th><th>Votação</th><th style="width:22%">Podemos</th></tr></thead><tbody>${comVoto.flatMap(v => v.nominais.map(n => `<tr><td><b>${esc(v.rotulo)}</b></td><td>${esc(n.data)}</td><td>${esc(String(n.descricao || '').replace(/\s*Sim:.*$/, ''))} Placar: ${n.sim} a ${n.nao}.</td><td>${n.podemosSim} sim, ${n.podemosNao} não${n.orientacao ? `<br><small>orientação: ${esc(n.orientacao)}${n.orientadoPor ? ` (${esc(n.orientadoPor)})` : ''}</small>` : ''}</td></tr>`)).join('')}</tbody></table>`);
  const semVoto = vc.filter(v => !(v.nominais || []).length).map(v => v.rotulo);
  if (semVoto.length) L.push(`<p class="pe-fonte">Sem votação nominal em Plenário registrada: ${esc(semVoto.join(', '))}.</p>`);
  return L.join('');
}

/** Texto corrido, um parágrafo por item (é a forma do parecer original para "Quem se posicionou e como" e "Os dois lados"). */
function pe5Prosa(itens, esc) { return (itens || []).map(x => typeof x === 'string' ? x : x && x.texto).filter(t => t && String(t).trim()).map(t => `<p>${esc(t)}</p>`).join(''); }

/** O parecer, pronto para o Paged.js. */
function htmlParecerPE5(p, { materia = '', logoDataUrl = null, css = '' } = {}) {
  const esc = pe5Esc, D = p.doc || {}, G = p.coleta || {}, pq = p.pesquisa || {}, idx = pe5IndicePesquisa(pq);
  const fonteDe = evs => pe5LinkFonte((evs || []).map(e => idx.get(e)).find(x => x && x.fonte_url), esc);
  const secoes = [];   // { id, titulo, html } — só entra o que tem conteúdo
  const sec = (id, titulo, html) => { if (html && String(html).replace(/<[^>]+>/g, '').trim()) secoes.push({ id, titulo, html }); };
  const paras = lista => (lista || []).filter(x => x && x.texto).map(x => `${x.titulo ? `<h3>${esc(x.titulo)}${x.dispositivos ? ` <span class="pe-disp">· ${esc(x.dispositivos)}</span>` : ''}</h3>` : ''}<p>${esc(x.texto)}</p>`).join('');
  const lista = itens => (itens && itens.length) ? `<ul>${itens.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
  const partes = [];
  const parte = (num, titulo, nota) => partes.push({ num, titulo, nota, ini: secoes.length });

  // ---- I. A matéria ----
  parte('I', 'A matéria');
  sec('faz', 'O que a proposição faz', paras(D.materia?.faz));
  sec('muda', 'O que muda na legislação', pe5Alteracoes(p.alteracoes, esc)
    + (p.alteracoes?.length ? '<p class="pe-fonte">"O que vale hoje" é o artigo da lei em vigor, lido pelo programa na fonte indicada. "Não existe hoje" significa que o artigo é criado pelo texto.</p>' : ''));
  sec('origem', 'Origem e tramitação', paras(D.materia?.origem) + pe5Linha(G.marcos, esc));
  sec('docs', 'Documentos que embasam a proposição', (D.materia?.documentos || []).length
    ? `<table class="pe"><thead><tr><th style="width:34%">Documento</th><th>O que é</th><th style="width:22%">Onde encontrar</th></tr></thead><tbody>${D.materia.documentos.map(d => { const f = fonteDe(d.ev); return `<tr><td><b>${esc(d.documento)}</b></td><td>${esc(d.o_que_e)}</td><td>${esc(d.onde || '')}${f ? `<br>${f}` : ''}</td></tr>`; }).join('')}</tbody></table>` : '');
  sec('versoes', 'O que o texto em votação mudou em relação ao original', (D.materia?.versoes || []).length
    ? `<table class="pe"><thead><tr><th style="width:17%">Tema</th><th style="width:27%">Projeto original</th><th style="width:27%">Texto em votação</th><th>Efeito</th></tr></thead><tbody>${D.materia.versoes.map(v => `<tr><td><b>${esc(v.tema)}</b></td><td>${esc(v.original)}</td><td>${esc(v.atual)}</td><td>${esc(v.efeito)}</td></tr>`).join('')}</tbody></table>` : '');
  sec('contexto', 'Contexto', paras(D.materia?.contexto));
  sec('historico', 'Histórico do tema no Congresso', (D.materia?.historico || []).length
    ? `<table class="pe"><thead><tr><th style="width:17%">Proposição</th><th style="width:27%">O que propunha</th><th style="width:20%">Desfecho</th><th>Por que não avançou ou como terminou</th></tr></thead><tbody>${D.materia.historico.map(h => { const f = fonteDe(h.ev); return `<tr><td><b>${esc(h.proposicao)}</b>${h.ano ? `<br><small>${esc(h.ano)}</small>` : ''}</td><td>${esc(h.o_que_propunha)}</td><td>${esc(h.desfecho)}</td><td>${esc(h.por_que || '')}${f ? `<br><small>${f}</small>` : ''}</td></tr>`; }).join('')}</tbody></table>` : '');

  // ---- II. O debate ----
  parte('II', 'O debate');
  sec('atores', 'Quem se posicionou e como', pe5Prosa(D.debate?.posicoes, esc) || pe5Atores(pq.debate?.atores, esc));
  { const ld = D.debate?.lados || {}; sec('lados', 'Os dois lados', pe5Prosa([ld.apoia?.argumento, ld.apoia?.evidencia, ld.opoe?.argumento, ld.opoe?.evidencia], esc)); }
  sec('contro', 'Mapa de argumentos', (D.debate?.controversias || []).map(c => pe5Controversia(c, esc)).join(''));
  sec('analise-arg', 'Argumentos que ninguém levantou', (D.debate?.da_analise || []).length
    ? `<p class="pe-fonte">Argumentos da assessoria, formulados a partir do texto e da comparação internacional. Não foram localizados nas manifestações públicas.</p>${D.debate.da_analise.map(a => `<p class="pe-ponto"><span class="pe-grav ${a.lado === 'favorável' ? 'baixa' : 'media'}">${a.lado === 'favorável' ? 'a favor' : 'contra'}</span>${esc(a.argumento)}</p>`).join('')}` : '');

  // ---- III. Experiência internacional ----
  parte('III', 'Experiência internacional');
  sec('juris', 'O que cada país fez e o que aconteceu', (D.internacional?.jurisdicoes || []).map(j => `<h3>${esc(j.lugar)} <span class="pe-disp">· ${esc(j.norma)}</span></h3>
    <p><b>A regra.</b> ${esc(j.regra)}</p><p><b>O que aconteceu.</b> ${esc(j.aconteceu)}</p>${j.criticas ? `<p><b>Críticas.</b> ${esc(j.criticas)}</p>` : ''}${fonteDe(j.ev) ? `<p class="pe-fonte">Fonte: ${(j.ev || []).map(e => pe5LinkFonte(idx.get(e), esc)).filter(Boolean).join(' · ')}</p>` : ''}`).join(''));
  const cmp = D.internacional?.comparativo;
  sec('compara', 'Quadro comparativo com o texto brasileiro', cmp && (cmp.linhas || []).length
    ? `<table class="pe"><thead><tr><th style="width:14%"></th>${cmp.colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${cmp.linhas.map(l => `<tr><td><b>${esc(l.parametro)}</b></td>${l.valores.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '');
  sec('licoes', 'O que a comparação permite e não permite concluir', ((D.internacional?.licoes || []).length ? `<h3>O que se pode aproveitar</h3><ul>${D.internacional.licoes.map(l => `<li>${esc(l.texto)}</li>`).join('')}</ul>` : '')
    + ((D.internacional?.limites || []).length ? `<h3>Onde a comparação não vale</h3>${lista(D.internacional.limites)}` : ''));

  // ---- IV. Análise técnica ----
  parte('IV', 'Análise técnica');
  sec('pontos', 'Pontos que merecem exame', (D.analise?.lentes || []).filter(l => (l.pontos || []).length).map(l => `<h3>${esc(l.lente)}</h3>${l.pontos.map(pt => `<div class="pe-emenda" style="border-left-color:${pt.gravidade === 'alta' ? '#8a1c16' : pt.gravidade === 'media' ? '#c9a227' : '#9aa5ae'}">
      <p class="pe-ponto"><span class="pe-grav ${esc(pt.gravidade || 'baixa')}">${esc(PE5_GRAV[pt.gravidade] || 'baixa')}</span><b>${esc(pt.questao)}</b> <span class="pe-disp">· ${esc(pt.dispositivo || '')}</span></p>
      <p>${esc(pt.exame)}</p>${pt.objecao ? `<p><b>O outro lado.</b> ${esc(pt.objecao)}</p>` : ''}${pt.saida ? `<p><b>O que resolveria.</b> ${esc(pt.saida)}</p>` : ''}</div>`).join('')}`).join('')
    + ((D.analise?.sem_achado || []).length ? `<p class="pe-fonte">Lentes examinadas sem ponto a registrar: ${esc(D.analise.sem_achado.join('; '))}.</p>` : ''));
  sec('jurisp', 'Decisões judiciais relacionadas', (D.analise?.jurisprudencia || []).length
    ? `<table class="pe"><thead><tr><th style="width:24%">Decisão</th><th style="width:30%">O que decidiu</th><th style="width:22%">Por que interessa</th><th>Onde a analogia para</th></tr></thead><tbody>${D.analise.jurisprudencia.map(j => `<tr><td><b>${esc(j.processo)}</b>${fonteDe(j.ev) ? `<br><small>${fonteDe(j.ev)}</small>` : ''}</td><td>${esc(j.decidiu)}</td><td>${esc(j.pertinencia)}</td><td>${esc(j.limite)}</td></tr>`).join('')}</tbody></table>` : '');
  const imp = D.analise?.impacto || {};
  // Em blocos, e não em tabela: cinco colunas de texto ficam estreitas e o cabeçalho sobrava sozinho no pé da página.
  sec('judic', 'Risco de judicialização', (D.analise?.judicializacao || []).length
    ? `<p class="pe-fonte">Onde a lei pode ser questionada na Justiça depois de aprovada, por quem e com que argumento. É exame de risco: não afirma que o texto seja inconstitucional.</p>${D.analise.judicializacao.map(j => { const f = fonteDe((j.ev || []).filter(e => /^L/.test(e))); return `<div class="pe-risco"><h3>${esc(j.alvo)}</h3>${j.quem ? `<p><b>Quem pode questionar.</b> ${esc(j.quem)}</p>` : ''}${j.fundamento ? `<p><b>Com que fundamento.</b> ${esc(j.fundamento)}</p>` : ''}${j.sinal ? `<p><b>O que existe de concreto.</b> ${esc(j.sinal)}${f ? ` <span class="pe-fonte">Fonte: ${f}</span>` : ''}</p>` : ''}${j.reduz ? `<p><b>O que reduz o risco.</b> ${esc(j.reduz)}</p>` : ''}</div>`; }).join('')}` : '');
  sec('impacto', 'Impacto', [['Fiscal', imp.fiscal], ['Econômico', imp.economico], ['Implementação', imp.implementacao]].filter(([, l]) => (l || []).length)
    .map(([t, l]) => `<h3>${t}</h3>${l.map(x => `<p>${esc(x.texto)}</p>`).join('')}`).join(''));

  // ---- V. Caminhos ----
  parte('V', 'Caminhos');
  sec('votos', 'Mapa de votos', pe5MapaHtml(G, esc));
  sec('partido', 'O Podemos e a matéria', (D.caminhos?.partido?.texto || []).length || (G.partido?.acessorias || []).length ? pe5PartidoHtml(D.caminhos?.partido, G, esc) : '');
  sec('opcoes', 'Opções na fase atual', (D.caminhos?.opcoes || []).length
    ? `<table class="pe"><thead><tr><th style="width:28%">Opção</th><th>Consequências</th></tr></thead><tbody>${D.caminhos.opcoes.map(o => `<tr><td><b>${esc(o.opcao)}</b></td><td>${esc(o.consequencias)}</td></tr>`).join('')}</tbody></table>` : '');
  sec('emendas', 'Emendas possíveis, com redação', (D.caminhos?.emendas || []).map(e => `<div class="pe-emenda"><p class="pe-ponto"><b>${esc(e.dispositivo)}</b>: ${esc(e.problema)}</p><div class="red">${esc(e.redacao)}</div></div>`).join(''));
  sec('perguntas', 'Perguntas a fazer', (D.caminhos?.perguntas || []).length
    ? `<table class="pe"><thead><tr><th style="width:18%">A quem</th><th style="width:44%">Pergunta</th><th>Por que importa</th></tr></thead><tbody>${D.caminhos.perguntas.map(q => `<tr><td><b>${esc(q.a_quem)}</b></td><td>${esc(q.pergunta)}</td><td>${esc(q.por_que)}</td></tr>`).join('')}</tbody></table>` : '');
  sec('acompanhar', 'O que acompanhar', lista(D.caminhos?.acompanhar));

  // ---- abertura ----
  const A = D.abertura || {};
  const alc = (A.alcancados || []).filter(x => x && x.grupo);
  const abertura = `
    ${A.frase ? `<p class="pe-frase">${esc(A.frase)}</p>` : ''}
    ${A.decide ? `<div class="pe-caixa"><h3>O que se decide</h3><p>${esc(A.decide)}</p></div>` : ''}
    ${(A.muda || []).length ? `<div class="pe-caixa"><h3>O que muda</h3>${lista(A.muda)}</div>` : ''}
    ${A.alcance || alc.length ? `<div class="pe-caixa"><h3>Quem é alcançado</h3>${A.alcance ? `<p>${esc(A.alcance)}</p>` : ''}${alc.length ? `<table class="pe"><thead><tr><th style="width:34%">Grupo</th><th style="width:16%">Piso que supera</th><th>Dado público</th></tr></thead><tbody>${alc.map(x => `<tr><td><b>${esc(x.grupo)}</b></td><td>${esc(x.piso || '')}</td><td>${esc(x.dado || '')}${fonteDe(x.ev) ? ` <small>(${fonteDe(x.ev)})</small>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}</div>` : ''}
    <div class="pe-caixa"><h3>Quadro político</h3>${pe5QuadroPolitico(G, esc)}</div>
    ${(A.pontos || []).length ? `<div class="pe-caixa"><h3>Pontos de atenção</h3>${A.pontos.map(pt => `<p class="pe-ponto"><span class="pe-grav ${esc(pt.gravidade || 'baixa')}">${esc(PE5_GRAV[pt.gravidade] || 'baixa')}</span><b>${esc(pt.titulo)}.</b> ${esc(pt.texto)}</p>`).join('')}</div>` : ''}
    ${(A.falta || []).length ? `<div class="pe-caixa junta"><h3>O que falta saber</h3>${lista(A.falta)}</div>` : ''}`;

  // ---- corpo com as partes ----
  let corpo = '';
  partes.forEach((pt, i) => {
    const fim = i + 1 < partes.length ? partes[i + 1].ini : secoes.length;
    const dentro = secoes.slice(pt.ini, fim);
    if (!dentro.length) return;
    corpo += `<div class="pe-parte" id="parte_${pt.num}">Parte ${pt.num} — ${esc(pt.titulo)}</div>${pt.nota ? `<p class="pe-nota">${esc(pt.nota)}</p>` : ''}`;
    corpo += dentro.map(s => {
      const h = `<h2 class="item-h" id="s_${s.id}">${esc(s.titulo)}</h2>`, m = String(s.html).match(/^\s*(<!--cola-->[\s\S]*?<!--\/cola-->|<p[\s>][\s\S]*?<\/p>)/);
      return m ? `<div class="pe-cola">${h}${m[1]}</div>${String(s.html).slice(m[0].length)}` : h + s.html;
    }).join('');
  });
  const indice = `<div class="pe-indice">${partes.map((pt, i) => { const fim = i + 1 < partes.length ? partes[i + 1].ini : secoes.length; const dentro = secoes.slice(pt.ini, fim); return dentro.length ? `<a href="#parte_${pt.num}"><b>Parte ${pt.num} — ${esc(pt.titulo)}</b><span class="ld"></span></a>${dentro.map(s => `<a href="#s_${s.id}">${esc(s.titulo)}<span class="ld"></span></a>`).join('')}` : ''; }).join('')}</div>`;


  return pe5LargurasFixas(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Nota Técnica Analítica — ${esc(materia || p.materia || '')}</title>
<style>${css}${CSS_PE5}</style></head><body>
  <div class="cab">${logoDataUrl ? `<div class="sp"></div>` : ''}<div class="tit"><h1>Nota Técnica Analítica (NTA)</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}</div>
  <div class="rule"></div>
  <div class="meta">${esc(materia || p.materia || '')}${p.textoAnalisado ? ` · texto analisado: ${esc(p.textoAnalisado)}` : ''}${p.geradoEm ? ` · ${pe5DataHora(p.geradoEm)}` : ''}</div>
  ${p.ementa ? `<p class="pe-fonte" style="text-align:center;margin:-6px 0 10px">${esc(p.ementa)}</p>` : ''}
  ${abertura}
  <div style="break-inside:avoid;page-break-inside:avoid"><h2 class="item-h">Índice</h2>${indice}</div>
  ${corpo}
  <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
</body></html>`);
}

/** Relatório de conferência: o que o programa testou, o que saiu, o que a revisão mudou e quanto custou. */
function htmlConferenciaPE5(p, { materia = '', logoDataUrl = null, css = '' } = {}) {
  const esc = pe5Esc, conf = p.conferencia || { itens: [] }, tr = p.trechos || { conferidos: 0, recusados: [] }, rv = p.revisao || {};
  const tab = (cab, linhas) => linhas.length ? `<table class="pe"><thead><tr>${cab.map(c => `<th${c === 'Resultado' ? ' style="width:16%"' : c === 'Teste' ? ' style="width:44%"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="pe-vazio">Nada a registrar.</p>';
  const mil = n => n ? `${String(Math.round(n / 100) / 10).replace('.', ',')} mil` : '—';
  const c = p.consumo || {};
  const etapas = { leitura: 'Leitura dos documentos', 'pesquisa-debate': 'Pesquisa do debate', 'pesquisa-internacional': 'Pesquisa internacional', 'pesquisa-contexto': 'Pesquisa de contexto', 'pesquisa-congresso': 'Pesquisa do histórico do tema e da judicialização', 'redacao-1': 'Redação: matéria, debate e internacional', 'redacao-2': 'Redação: análise, caminhos e abertura', revisao: 'Revisão' };
  return pe5LargurasFixas(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conferência — ${esc(materia || p.materia || '')}</title>
<style>${css}${CSS_PE5}</style></head><body>
  <div class="cab">${logoDataUrl ? '<div class="sp"></div>' : ''}<div class="tit"><h1>Conferência da NTA</h1><p>Liderança do Podemos na Câmara dos Deputados</p></div>${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}</div>
  <div class="rule"></div>
  <div class="meta">${esc(materia || p.materia || '')}${p.textoAnalisado ? ` · texto analisado: ${esc(p.textoAnalisado)}` : ''}</div>
  <p class="pe-nota">Este relatório é para o analista. Mostra o que o programa testou na Nota Técnica Analítica (NTA), o que foi retirado ou corrigido antes de imprimir e o que cada etapa consumiu. ${esc(conf.resumo || '')}</p>
  ${p.escolha ? `<p class="pe-fonte">${esc(p.escolha.motivo || '')}${p.escolha.ressalva ? ' ' + esc(p.escolha.ressalva) : ''}</p>` : ''}
  <p class="pe-fonte" style="text-align:center">Gerado em ${pe5DataHora(p.geradoEm)}${p.modelo ? ` · modelo ${esc(p.modelo)}` : ''}${(p.chamadas || []).length ? ` · ${p.chamadas.length} chamadas` : ''}${c.total ? ` · ${mil(c.total)} tokens` : ''}${p.geradoPor ? ` · por ${esc(p.geradoPor)}` : ''}</p>
  <h2 class="item-h">Como a NTA foi produzida</h2>
  <ul>
    <li>A Parte II (o debate), a Parte III (experiência internacional), as decisões judiciais e a relação de quem passa dos pisos vêm de <b>pesquisa na internet feita pelo modelo de IA</b>, com preferência por fontes oficiais. Cada item traz data e fonte; <b>o programa não leu as páginas</b>. Use como mapa e confira a fonte antes de citar.</li>
    <li>Em "Os dois lados", o que se diz sobre cada argumento ("confirma-se", "procede", "não procede") é avaliação do modelo, feita contra o texto analisado e os dados da base.</li>
    <li>O histórico do tema no Congresso e os sinais de judicialização também vêm de pesquisa na internet feita pelo modelo. O risco de judicialização é exame de risco, não juízo sobre a constitucionalidade.</li>
    <li>O mapa de votos, as iniciativas e os projetos de deputados do Podemos e o voto da bancada em proposições correlatas foram lidos pelo programa nos dados abertos da Câmara. Quais projetos tratam do mesmo assunto foi escolha do modelo, a partir de uma busca por palavra-chave.</li>
    <li>Tramitação, votações, voto da bancada e o texto da lei em vigor foram lidos pelo programa nos dados abertos da Câmara e nas fontes oficiais de legislação.</li>
    <li>Os valores em moeda estrangeira foram convertidos pelo câmbio de venda do Banco Central${p.cambio ? ` em ${esc(p.cambio.data)}: ${Object.entries(p.cambio.taxas || {}).map(([m, v]) => `${m} ${String(v).replace('.', ',')}`).join('; ')}` : ''}.</li>
    <li>A NTA não recomenda voto: apresenta o texto, o debate, a experiência de outros países, os pontos técnicos e os caminhos. A decisão é da Liderança.</li>
  </ul>
  <h2 class="item-h">Testes do programa</h2>
  ${tab(['Teste', 'Resultado', 'Detalhe'], (conf.itens || []).map(i => [esc(i.teste), `<span class="${i.ok ? 'pe-ok' : 'pe-atencao'}">${i.ok ? 'sem ressalva' : i.critico ? 'atenção (crítico)' : 'atenção'}</span>`, esc(i.detalhe || '')]))}
  <h2 class="item-h">Citações dos documentos</h2>
  <p>${tr.conferidos} trecho(s) transcrito(s) pela leitura foram localizados no documento indicado.${(tr.recusados || []).length ? ` ${tr.recusados.length} item(ns) saíram da NTA porque o trecho não foi localizado:` : ' Nenhum item foi retirado.'}</p>
  ${(tr.recusados || []).length ? tab(['Item', 'Motivo', 'Trecho informado'], tr.recusados.map(r => [esc(r.id), esc(r.motivo), esc(r.trecho || '')])) : ''}
  <h2 class="item-h">Revisão</h2>
  <p>${(rv.aplicadas || []).length} correção(ões) aplicada(s); ${(rv.ignoradas || []).length} não aplicada(s) por não localizar o trecho de forma única.</p>
  ${(rv.aplicadas || []).length ? tab(['Trecho', 'Passou a ser', 'Motivo'], rv.aplicadas.map(x => [esc(x.trecho), esc(x.novo || '(removido)'), esc(x.motivo)])) : ''}
  ${(rv.ignoradas || []).length ? tab(['Trecho apontado', 'Sugestão', 'Motivo', 'Por que não entrou'], rv.ignoradas.map(x => [esc(String(x.trecho || '').slice(0, 160)), esc(String(x.novo || '').slice(0, 160)), esc(x.motivo || ''), esc(x.razao || '')])) : ''}
  <h2 class="item-h">O que foi lido</h2>
  <p>Documentos lidos na íntegra pelo modelo:</p><ul>${((p.inventario || {}).lidos || []).map(d => `<li>${esc(d.rotulo)}${d.caracteres ? ` — ${Math.round(d.caracteres / 1000)} mil caracteres` : ''}${d.legivel === false ? ' <span class="pe-atencao">(ilegível)</span>' : ''}</li>`).join('')}</ul>
  ${((p.inventario || {}).naoLidos || []).length ? `<p>Existem e <b>não</b> foram lidos:</p><ul>${p.inventario.naoLidos.map(d => `<li>${esc(d.rotulo)} — ${esc(d.motivo)}</li>`).join('')}</ul>` : ''}
  <p>Quando a NTA diz que algo "não consta", refere-se a esses documentos.</p>
  ${(p.leitura?.ausencias || []).length ? `<p>Não localizado nos documentos lidos:</p><ul>${p.leitura.ausencias.map(a => `<li>${esc(a.o_que)} <span class="pe-fonte">(procurado em: ${esc(a.onde_procurou)})</span></li>`).join('')}</ul>` : ''}
  <h2 class="item-h">Limites e avisos da pesquisa</h2>
  ${(() => { const av = [...(p.pesquisa?.debate?.avisos || []), ...(p.pesquisa?.internacional?.avisos || []), ...(p.pesquisa?.contexto?.avisos || []), ...(p.pesquisa?.congresso?.avisos || []), ...((p.coleta?.partido?.avisos || []).map(a => `Atuação da bancada: ${a}.`))]; return av.length ? `<ul>${av.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="pe-vazio">Nenhum aviso.</p>'; })()}
  <h2 class="item-h">Fontes da internet</h2>
  ${pe5Fontes(p, esc) || '<p class="pe-vazio">Nenhuma fonte.</p>'}
  <h2 class="item-h">Roteiros de especialista usados na leitura</h2>
  ${tab(['Roteiro', 'Por que foi acionado'], (p.lentes || []).map(l => [esc(`${l.ordem}. ${l.rotulo}`), esc(l.motivo || '')]))}
  <h2 class="item-h">Tempo e consumo</h2>
  <p>Duração total: <b>${c.minutos != null ? String(c.minutos).replace('.', ',') : '—'} minutos</b>. Consumo informado pelo provedor: <b>${mil(c.total)} tokens</b> (${mil(c.entrada)} de entrada, ${mil(c.saida)} de saída, ${mil(c.raciocinio)} de raciocínio).${c.total ? '' : ' O provedor não informou o consumo.'}</p>
  ${tab(['Etapa', 'Internet', 'Tempo', 'Entrada', 'Saída', 'Raciocínio'], (p.chamadas || []).map(x => [esc(etapas[x.nome] || x.nome), x.web ? 'sim' : 'não', `${Math.round((x.ms || 0) / 1000)} s`, mil(x.tokens?.entrada), mil(x.tokens?.saida), mil(x.tokens?.raciocinio)]))}
  <div class="ft">Documento produzido pela Assessoria Técnica da Liderança do Podemos na Câmara dos Deputados</div>
</body></html>`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { htmlParecerPE5, htmlConferenciaPE5, pe5Prosa, pe5MapaHtml, pe5PartidoHtml, pe5IndicePesquisa, pe5LargurasFixas, CSS_PE5, pe5Esc, pe5Encurta, pe5QuadroPolitico, pe5Alteracoes, pe5Atores, pe5Controversia, pe5Fontes };
}
