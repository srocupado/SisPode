/* ============================================================
   NOTAS TÉCNICAS ORÇAMENTÁRIAS — LOA, LDO e PPA

   Sub-painel do módulo Orçamento. O outro sub-painel (acompanhamento de
   emendas, no FNS e no Portal da Transparência) segue em emendas.html.

   O QUE ESTA TELA FAZ, e por que nesta ordem:

   1) ACOMPANHAMENTO — o quadro da matéria no Congresso: identificação, as 10
      etapas da tramitação com o estado de cada uma, o cronograma (de onde sai
      o prazo de emendas), os relatores e os documentos. Tudo estruturado, sem
      IA. É o que responde "onde estamos" sem abrir o site da CMO.

   2) NOTA TÉCNICA — monta a nota com o que existe HOJE e DECLARA o que ainda
      não existe. Foi a lição do protótipo de 02/09/2026 com o PLOA 2027
      (PLN 24/2026): recém-chegado, ele não tinha cronograma, relator-geral,
      Manual de Emendas nem cotas — e a nota útil naquele estágio é a que diz
      isso com todas as letras, em vez de repetir os números do ano anterior.

   3) CONFERÊNCIA NORMATIVA — compara o que a nota afirma com o Manual de
      Emendas do exercício (normas.js). Sem ela, uma nota reaproveitada
      envelhece em silêncio: a de 2022 dizia "R$ 250.000,00 para obras, pela
      Portaria Interministerial 424/2016" e o Manual da LOA 2026 traz
      R$ 200.000,00, com o fundamento migrado para a LDO de cada exercício.

   Fontes e leitura: cmo.js. Conferência: normas.js.
   ============================================================ */

'use strict';

const FIREBASE_URL_ON = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const SIGLA_PODE = /^PODE(MOS)?$/i;

const estado = {
  tipo: 'loa', ano: null, quadro: null, conferencia: null, carregando: false,
  ficha: null, serie: null, variacao: null,
  config: null,          // provedor/chave/modelo de IA, de chrome.storage
  ia: null,              // { acoes: {url:{...}}, sintese, atualizadoEm } — compartilhado no Firebase
  propostas: null,       // propostas de ficha aguardando aceite do analista
  ocupado: null,         // rótulo da operação de IA em curso (bloqueia disparo duplo)
  lote: false,           // leitura em lote das cartilhas em andamento
};

// ---------- utilidades ----------
const $ = id => document.getElementById(id);

/**
 * Aviso curto. Esta tela não carrega panel.js nem analise.js, onde vivem as
 * outras implementações — chamá-las daqui quebrava com ReferenceError na
 * primeira falha de gravação da ficha, justamente quando o aviso importa.
 */
function mostrarToast(msg, tipo = 'info') {
  const cores = { sucesso: '#00a859', erro: '#ff6b6b', aviso: '#d68a00', info: '#0a6cf0' };
  let el = $('on-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'on-toast';
    el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;max-width:380px;padding:11px 15px;'
      + 'border-radius:8px;font-size:12.5px;line-height:1.5;color:#fff;box-shadow:0 6px 22px rgba(0,0,0,.35);'
      + 'transition:opacity .25s';
    document.body.appendChild(el);
  }
  el.style.background = cores[tipo] || cores.info;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, tipo === 'erro' ? 8000 : 4500);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = iso => /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? iso.slice(0, 10).split('-').reverse().join('/') : (iso || '');

/** dd/mm/aaaa → Date local (o construtor com string ISO puxa fuso e erra o dia). */
function dataDe(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br || ''));
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
function diasAte(br) {
  const d = dataDe(br);
  if (!d) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.round((d - hoje) / 86400000);
}

/** Anos oferecidos: do exercício seguinte ao corrente para trás. */
function anosDisponiveis() {
  const atual = new Date().getFullYear();
  const anos = [];
  for (let a = atual + 1; a >= atual - 6; a--) anos.push(a);
  return anos;
}

/**
 * O PPA não é anual: vale por QUADRIÊNIO, e os do portal começam em 1991,
 * 1996, 2000 e daí de quatro em quatro. Oferecer "2027" para o PPA levaria a
 * uma URL que não existe.
 */
function periodosPPA() {
  const atual = new Date().getFullYear();
  const inicio = 2024 + Math.floor((atual - 2024) / 4) * 4;
  const ps = [];
  for (let a = inicio; a >= 2000; a -= 4) ps.push(`${a}-${a + 3}`);
  return ps;
}

/** As opções do seletor conforme a lei escolhida. */
function chavesDe(tipo) {
  return tipo === 'ppa' ? periodosPPA() : anosDisponiveis().map(String);
}

// ============================================================
//  CARGA
// ============================================================
async function carregar() {
  if (estado.carregando) return;
  estado.carregando = true;
  estado.conferencia = null;
  $('btn-nota').disabled = true;
  $('btn-conferir').disabled = true;
  $('on-status').innerHTML = '<span class="on-spinner"></span> consultando Senado e Congresso…';
  $('on-corpo').innerHTML = '<div class="on-carregando"><span class="on-spinner"></span> Carregando o quadro da matéria…</div>';

  try {
    estado.quadro = await carregarExercicio(estado.tipo, estado.ano);
    estado.ficha = await carregarFicha(estado.tipo, estado.ano);
    estado.serie = await carregarSerie(estado.tipo, estado.ano);
    // O trabalho da IA é caro e é o MESMO para a equipe toda: fica no Firebase,
    // por exercício, para não se pagar duas vezes pela leitura da mesma cartilha.
    estado.ia = await carregarIA(estado.tipo, estado.ano);
    estado.propostas = null;
    render();
  } catch (e) {
    console.error(e);
    $('on-corpo').innerHTML = `<div class="on-card largo"><div class="on-falha">Não foi possível carregar: ${esc(e.message)}</div></div>`;
  } finally {
    estado.carregando = false;
    $('on-status').textContent = '';
  }
}

// ============================================================
//  RENDER
// ============================================================
function render() {
  const q = estado.quadro;
  if (!q) return;
  const partes = [];

  partes.push(cardIdentificacao(q));
  partes.push(cardEtapas(q));
  partes.push(cardPrazo(q));
  partes.push(cardRelatores(q));
  partes.push(cardEmendas(q));
  partes.push(cardNotasTecnicas(q));
  partes.push(cardDocumentos(q));
  partes.push(cardSintese());
  partes.push(cardSerie());
  partes.push(cardVariacao());
  partes.push(cardGuia(q));
  partes.push(cardAcoes());
  partes.push(cardExecutivo(q));
  partes.push(cardPropostas());
  partes.push(cardFicha(q));
  if (q.alteracoes) partes.push(cardAlteracoesPPA(q));
  if (estado.conferencia) partes.push(cardConferencia());

  $('on-corpo').innerHTML = partes.filter(Boolean).join('');
  $('btn-nota').disabled = !q.materia.disponivel;
  // Conferir normas só faz sentido havendo Manual de Emendas do exercício.
  // Nem todo exercício publica "Manual de Emendas": a LOA 2025 orientou por
  // "Instruções para elaboração de emendas no LEXOR". A conferência roda contra
  // a âncora normativa que existir naquele ano.
  $('btn-conferir').disabled = !(q.emendas.disponivel && q.emendas.ancoraNormativa);
  $('btn-conferir').title = q.emendas.ancoraNormativa
    ? `Confere a nota contra o "${q.emendas.ancoraNormativa.rotulo}"`
    : 'A orientação normativa deste exercício ainda não foi publicada — não há contra o que conferir.';

  if (q.fontesIndisponiveis.length) {
    $('on-status').innerHTML = `<span style="color:#ff8e8e">⚠ ${q.fontesIndisponiveis.length} fonte(s) fora do ar — o quadro pode estar incompleto.</span>`;
  }
}

function cardIdentificacao(q) {
  const m = q.materia;
  if (!m.disponivel) {
    return `<div class="on-card largo"><h3>Matéria</h3><div class="on-pend">${esc(m.motivo)}</div></div>`;
  }
  const l = (r, v) => `<div class="on-linha"><span class="r">${r}</span><span class="v">${v}</span></div>`;
  return `<div class="on-card largo">
    <h3>${esc(m.apelido)} — ${esc(m.identificacao)}</h3>
    ${l('Ementa', esc(m.ementa))}
    ${l('Autoria', esc(m.autoria || '—'))}
    ${l('Apresentação', dataBR(m.dataApresentacao))}
    ${l('Situação', `<strong>${esc(m.situacaoAtual || '—')}</strong>${m.dataSituacaoAtual ? ` <span style="color:var(--text-dim)">desde ${dataBR(m.dataSituacaoAtual)}</span>` : ''}`)}
    ${m.normaGerada ? l('Norma gerada', `<strong>${esc(m.normaGerada)}</strong>`) : ''}
    ${m.urlDocumento ? l('Documento', `<a class="on-lista" style="color:#0a6cf0" href="${esc(m.urlDocumento)}" target="_blank" rel="noopener">texto do projeto</a>`) : ''}
  </div>`;
}

function cardEtapas(q) {
  const a = q.acompanhamento;
  if (!a.disponivel) return `<div class="on-card"><h3>Tramitação</h3><div class="on-pend">${esc(a.motivo)}</div></div>`;
  const selo = e => {
    const t = (e.estado || '').toLowerCase();
    if (/andamento/.test(t)) return '<span class="on-selo selo-andamento">Em andamento</span>';
    if (/conclu|encerr|realiz/.test(t)) return `<span class="on-selo selo-conc">${esc(e.estado)}</span>`;
    return `<span class="on-selo selo-naoini">${esc(e.estado || '—')}</span>`;
  };
  return `<div class="on-card"><h3>Etapas da tramitação</h3>
    ${a.etapas.map((e, i) => `<div class="on-etapa"><span class="n">${i + 1}</span><span class="nome">${esc(e.nome)}</span>${selo(e)}</div>`).join('')}
    ${a.ultimoEstado ? `<div style="margin-top:8px;font-size:12px;color:var(--text-dim)">Último estado: ${esc(a.ultimoEstado.data)} — ${esc(a.ultimoEstado.descricao)}</div>` : ''}
  </div>`;
}

/**
 * O prazo de emendas é o dado mais consultado da nota. Quando o cronograma
 * ainda não saiu, a tela DIZ isso — nunca estima pelo ano anterior, porque a
 * data muda a cada exercício e um palpite aqui faz o gabinete perder o prazo.
 */
function cardPrazo(q) {
  const c = q.cronograma;
  if (!c.disponivel) {
    return `<div class="on-card"><h3>Prazo de emendas</h3><div class="on-pend">${esc(c.motivo)}<br>
      <span style="color:var(--text-dim)">Sem cronograma aprovado não há prazo — e ele não se deduz do exercício anterior.</span></div></div>`;
  }
  const p = c.prazoEmendas;
  let destaque = '<div class="on-vazio">O cronograma foi publicado, mas não traz um item de apresentação de emendas ao projeto.</div>';
  if (p) {
    const faltaFim = diasAte(p.fim), faltaIni = diasAte(p.inicio);
    let situacao, classe = 'on-prazo';
    if (faltaIni > 0)       situacao = `abre em ${faltaIni} dia(s)`;
    else if (faltaFim >= 0) situacao = faltaFim === 0 ? '<strong style="color:#ff8e8e">ENCERRA HOJE</strong>' : `faltam ${faltaFim} dia(s)`;
    else { situacao = 'encerrado'; classe += ' fechado'; }
    destaque = `<div class="${classe}">${esc(p.inicio)} a ${esc(p.fim)}</div>
      <div style="font-size:12.5px;color:var(--text-dim);margin-top:2px">${situacao}</div>`;
  }
  return `<div class="on-card"><h3>Prazo de emendas${c.publicadoEm ? ` · cronograma de ${esc(c.publicadoEm)}` : ''}</h3>
    ${destaque}
    <table class="on-tab" style="margin-top:10px">
      ${c.itens.map(i => `<tr><td class="a">${i.ordem}. ${esc(i.descricao)}</td><td>${esc(i.inicio)} a ${esc(i.fim)}${i.observacao ? ` <span style="color:var(--text-dim)">(${esc(i.observacao)})</span>` : ''}</td></tr>`).join('')}
    </table>
  </div>`;
}

function cardRelatores(q) {
  const r = q.relatores;
  if (!r.disponivel) return `<div class="on-card"><h3>Relatoria</h3><div class="on-pend">${esc(r.motivo)}</div></div>`;
  const nome = p => p ? `${p.casa === 'Senado' ? 'Sen.' : 'Dep.'} ${esc(p.nome)} (${esc(p.partido)}/${esc(p.uf)})${SIGLA_PODE.test(p.partido) ? '<span class="on-pode">PODEMOS</span>' : ''}` : '<span class="on-vazio">não designado</span>';
  const l = (rot, p) => `<div class="on-linha"><span class="r">${rot}</span><span class="v">${nome(p)}</span></div>`;
  const doPode = r.setoriais.filter(s => SIGLA_PODE.test(s.partido));
  return `<div class="on-card"><h3>Relatoria na CMO</h3>
    ${l('Presidente', r.presidenteCMO)}
    ${l('Relator-Geral', r.relatorGeral)}
    ${l('Receita', r.relatorReceita)}
    ${r.setoriais.length
      ? `<div style="margin-top:10px"><div class="on-rotulo" style="margin-bottom:4px">Setoriais (${r.setoriais.length})</div>
         <table class="on-tab">${r.setoriais.map(s => `<tr><td class="a">${esc(s.area)}</td><td>${nome(s)}</td></tr>`).join('')}</table></div>`
      : '<div class="on-pend">Relatores setoriais ainda não designados.</div>'}
    ${doPode.length ? `<div class="on-ok">A bancada relata ${doPode.length} área(s) temática(s): ${doPode.map(s => esc(s.area)).join('; ')}.</div>` : ''}
  </div>`;
}

function cardEmendas(q) {
  const e = q.emendas;
  if (!e.disponivel) return `<div class="on-card"><h3>Emendas — documentos</h3><div class="on-pend">${esc(e.motivo)}</div></div>`;
  const grupo = (rot, classe) => {
    const ds = e.documentos.filter(d => d.classe === classe);
    if (!ds.length) return '';
    return `<div style="margin-top:8px"><div class="on-rotulo">${rot}</div>
      <ul class="on-lista">${ds.map(d => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.rotulo)}</a></li>`).join('')}</ul></div>`;
  };
  return `<div class="on-card"><h3>Emendas — documentos oficiais</h3>
    ${e.ancoraNormativa ? `<div class="on-ok">Âncora normativa do exercício: <a style="color:#0a6cf0" href="${esc(e.ancoraNormativa.url)}" target="_blank" rel="noopener">${esc(e.ancoraNormativa.rotulo)}</a></div>` : '<div class="on-pend">A orientação normativa deste exercício ainda não foi publicada.</div>'}
    ${grupo('Orientações', 'orientacao')}
    ${grupo('Instruções normativas', 'instrucao_normativa')}
    ${grupo('Portarias', 'portaria')}
    ${grupo('Cartilhas por área temática', 'cartilha')}
  </div>`;
}

function cardNotasTecnicas(q) {
  const n = q.notas;
  if (!n.disponivel) return `<div class="on-card"><h3>Notas técnicas das consultorias</h3><div class="on-pend">${esc(n.motivo)}</div></div>`;
  return `<div class="on-card"><h3>Notas técnicas e estudos (CONOF/CD e CONORF/SF)</h3>
    <!-- a LOA lista com data ("19/02/2026 - Raio-X…"), a LDO só com o título -->
    <ul class="on-lista">${n.notas.map(x => `<li>${x.data ? esc(x.data) + ' — ' : ''}<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.titulo)}</a></li>`).join('')}</ul>
  </div>`;
}

function cardDocumentos(q) {
  const a = q.acompanhamento;
  if (!a.disponivel || !a.documentos.length) return '';
  return `<div class="on-card largo"><h3>Documentos da tramitação${a.documentosOmitidos ? ` · mostrando ${a.documentos.length} de ${a.documentos.length + a.documentosOmitidos}` : ''}</h3>
    <ul class="on-lista" style="column-count:2;column-gap:24px">
      ${a.documentos.map(d => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.rotulo)}</a></li>`).join('')}
    </ul>
  </div>`;
}

/**
 * Alterações ao texto do PPA. Durante os quatro anos do plano, é AQUI que está
 * a matéria viva: o plano original já é lei, e o que tramita são os projetos
 * que o alteram.
 */
function cardAlteracoesPPA(q) {
  const a = q.alteracoes;
  if (!a.disponivel) return `<div class="on-card largo"><h3>Alterações ao PPA</h3><div class="on-pend">${esc(a.motivo)}</div></div>`;
  const linha = x => `<tr>
    <td class="a"><strong>${esc(x.projeto)}</strong>${x.situacao ? ` <span class="on-selo ${x.emTramitacao ? 'selo-andamento' : 'selo-conc'}">${esc(x.situacao)}</span>` : ''}<br>
      <span style="color:var(--text-dim)">${esc(x.ementa || '')}</span></td>
    <td>${x.normaGerada ? `<a style="color:#0a6cf0" href="${esc(x.normaUrl || '#')}" target="_blank" rel="noopener">${esc(x.normaGerada)}</a>` : '<span class="on-vazio">sem norma gerada</span>'}</td>
  </tr>`;
  return `<div class="on-card largo"><h3>Alterações ao texto do PPA${a.leiDoPlano ? ` · plano em vigor: ${esc(a.leiDoPlano)}` : ''}</h3>
    <table class="on-tab">${a.alteracoes.map(linha).join('')}</table>
    ${a.emTramitacao.length
      ? `<div class="on-ok">Em tramitação agora: <strong>${a.emTramitacao.map(x => esc(x.projeto)).join(', ')}</strong> — é sobre esta matéria que a nota técnica deve versar, não sobre o plano original, que já é lei.</div>`
      : '<div style="font-size:12px;color:var(--text-dim);margin-top:8px">Nenhuma alteração em tramitação no momento.</div>'}
  </div>`;
}

function cardConferencia() {
  const c = estado.conferencia;
  const linhas = resumoConferencia(c.resultado);
  const classe = !c.resultado.conferido ? 'on-pend' : (c.resultado.alertas.length ? 'on-pend' : 'on-ok');
  return `<div class="on-card largo"><h3>Conferência da base normativa · ${esc(c.rotuloFonte)}</h3>
    <div class="${classe}">${linhas.map(esc).join('<br>')}</div>
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">
      A conferência diz apenas se a norma ou o valor citado CONSTA do documento do exercício.
      Constar não significa que o dispositivo continue aplicável ao mesmo caso — confirme na fonte.
    </div>
  </div>`;
}

/**
 * Materiais do Executivo — o CONTEÚDO do orçamento, ao lado da tramitação.
 *
 * É o que permite a nota sair de "onde o processo está" para "o que muda para
 * o gabinete": os volumes trazem a alocação por órgão, o comparativo mostra o
 * que o projeto altera na lei vigente, e a Mensagem Presidencial — que vem
 * DENTRO do PDF do PLN, não como arquivo próprio — traz os parâmetros macro,
 * o salário mínimo, a reserva para emendas e a justificativa do Governo.
 */
function cardExecutivo(q) {
  const e = q.executivo;
  if (!e) return '';
  const m = q.materia;
  const mensagem = m?.disponivel && m.urlDocumento
    ? `<div class="on-ok">Mensagem Presidencial: vem <strong>dentro do PDF do projeto</strong>, nas páginas iniciais —
       <a style="color:#0a6cf0" href="${esc(m.urlDocumento)}" target="_blank" rel="noopener">abrir ${esc(m.identificacao)}</a>.
       É onde estão os parâmetros macroeconômicos, o salário mínimo projetado, a reserva para emendas e a
       justificativa do Governo.</div>`
    : '';
  if (!e.disponivel) {
    return `<div class="on-card largo"><h3>Materiais do Poder Executivo</h3>
      ${mensagem}<div class="on-pend">${esc(e.motivo)}</div></div>`;
  }
  const grupo = (rot, classe) => {
    const ds = e.documentos.filter(d => d.classe === classe);
    if (!ds.length) return '';
    return `<div style="margin-top:8px"><div class="on-rotulo">${rot}</div>
      <ul class="on-lista">${ds.map(d => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.rotulo)}</a></li>`).join('')}</ul></div>`;
  };
  return `<div class="on-card largo"><h3>Materiais do Poder Executivo · Ministério do Planejamento</h3>
    ${mensagem}
    ${grupo('Texto do projeto', 'texto_lei')}
    ${grupo('Comparativos com a lei vigente', 'comparativo')}
    ${grupo('Volumes (alocação por órgão e programa)', 'volume')}
    ${grupo('Apresentação', 'apresentacao')}
    ${grupo('Orçamento Cidadão', 'orcamento_cidadao')}
    ${!e.apresentacao ? '<div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">A Apresentação do Executivo não é publicada nesta página; quando circular, anexe-a manualmente à análise.</div>' : ''}
  </div>`;
}

// ============================================================
//  SÉRIE HISTÓRICA · VARIAÇÃO · GUIA DE APLICAÇÃO
// ============================================================
// Os três produtos que fazem a nota falar com o deputado, e não só com a
// coordenação: quanto ele tem e quanto era antes, o que subiu e o que caiu, e
// o que dá para fazer com o dinheiro.

/** Carrega as fichas dos exercícios anteriores para montar a série. */
async function carregarSerie(tipo, ano) {
  const base = Number(String(ano).slice(0, 4));
  if (!Number.isFinite(base)) return null;
  const anos = [];
  for (let a = base; a > base - 6; a--) anos.push(String(a));
  const fichas = await Promise.all(anos.map(a => carregarFicha(tipo, a)));
  return montarSerie(fichas.filter(Boolean));
}

function cardSerie() {
  const series = estado.serie ? seriesComDados(estado.serie) : [];
  if (!estado.serie) return '';
  if (!series.length) {
    return `<div class="on-card largo"><h3>Série histórica</h3>
      <div class="on-pend">Nenhum exercício tem ficha preenchida ainda. A série se monta sozinha conforme a
      equipe preenche a ficha de cada ano — e é ela que dá sentido ao número: "sua cota é de R$ 40 milhões"
      não diz nada a quem não sabe quanto era antes.</div></div>`;
  }
  const linha = s => {
    const pts = s.pontos.map(p => `<td style="text-align:right"><strong>${esc(p.texto)}</strong><br>
      <span style="font-size:10.5px;color:var(--text-dim)">${esc(p.ano)}</span></td>`).join('');
    const v = s.variacao;
    const tag = !v ? '<span class="on-vazio">um exercício</span>'
      : v.pct === null ? '<span class="on-vazio">base zero</span>'
      : `<span class="on-selo ${v.pct >= 0 ? 'selo-andamento' : 'selo-diverg'}">${v.pct >= 0 ? '+' : '−'}${Math.abs(v.pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>`;
    return `<tr><td class="a">${esc(s.rotulo)}${v && !v.contiguo ? `<br><span style="font-size:10.5px;color:#d68a00">série com lacuna: ${esc(s.lacunas.join(', '))}</span>` : ''}</td>
      ${pts}<td style="text-align:right">${tag}</td></tr>`;
  };
  return `<div class="on-card largo"><h3>Série histórica — o que mudou para o parlamentar</h3>
    <table class="on-tab">${series.map(linha).join('')}</table>
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">
      Cada ponto vem da ficha do respectivo exercício, com documento de origem. Exercício sem ficha aparece
      como lacuna — nunca é interpolado.
    </div>
  </div>`;
}

/**
 * Variação entre exercícios, lida das tabelas da Mensagem Presidencial. Só
 * aparece depois que o analista roda a leitura, porque envolve baixar o PDF do
 * projeto (27 MB no PLOA 2027) e extrair as páginas.
 */
function cardVariacao() {
  const v = estado.variacao;
  if (!v) {
    return `<div class="on-card largo"><h3>O que subiu e o que caiu</h3>
      <div style="font-size:12.5px;color:var(--text-dim);line-height:1.6">
        As tabelas comparativas entre exercícios estão na Mensagem Presidencial, dentro do PDF do projeto.
        <button class="btn btn-outline btn-sm" data-acao="ler-mensagem" style="margin-left:8px">Ler a Mensagem</button>
      </div></div>`;
  }
  if (v.erro) return `<div class="on-card largo"><h3>O que subiu e o que caiu</h3><div class="on-falha">${esc(v.erro)}</div></div>`;

  const bloco = (titulo, itens, classe) => itens.length ? `<div style="margin-top:8px"><div class="on-rotulo">${titulo}</div>
    <table class="on-tab">${itens.map(i => `<tr><td class="a">${esc(i.rotulo)}</td>
      <td style="text-align:right"><strong>${esc(formatarBR(i.para))}</strong>
      <span class="on-selo ${classe}">${i.pct >= 0 ? '+' : '−'}${Math.abs(i.pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></td></tr>`).join('')}</table></div>` : '';

  return `<div class="on-card largo"><h3>O que subiu e o que caiu · ${esc(v.de)} → ${esc(v.para)}</h3>
    <div style="font-size:11.5px;color:var(--text-dim)">Valores em R$ milhões, da ${esc(v.fonte)}.</div>
    ${bloco('Maiores altas', v.maioresAltas, 'selo-andamento')}
    ${bloco('Maiores quedas', v.maioresQuedas, 'selo-diverg')}
    ${v.porOrgao ? `<div style="margin-top:10px"><div class="on-rotulo">Por órgão — ${esc(v.porOrgao.titulo || 'distribuição')}</div>
      <table class="on-tab">${v.porOrgao.linhas.map(l => `<tr><td class="a">${esc(l.codigo)} — ${esc(l.orgao)}</td><td style="text-align:right"><strong>${esc(formatarBR(l.valor))}</strong></td></tr>`).join('')}</table>
      <div class="${v.porOrgao.confere ? 'on-ok' : 'on-falha'}">${v.porOrgao.confere
        ? `Leitura conferida: a soma das ${v.porOrgao.linhas.length} linhas fecha com o total impresso no documento (${esc(formatarBR(v.porOrgao.total))}).`
        : esc(v.porOrgao.motivo)}</div></div>` : ''}
  </div>`;
}

/** Lê a Mensagem (dentro do PDF do projeto) e extrai as tabelas. */
async function lerMensagem() {
  const q = estado.quadro;
  const url = q?.materia?.urlDocumento;
  if (!url) { mostrarToast('A matéria não tem documento publicado.', 'aviso'); return; }
  estado.variacao = { carregando: true };
  $('on-status').innerHTML = '<span class="on-spinner"></span> lendo a Mensagem Presidencial (PDF grande)…';
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = await pdfjsLib.getDocument({ data: await r.arrayBuffer() }).promise;
    // A Mensagem ocupa as páginas iniciais; varrer o documento inteiro (3.235
    // páginas no PLOA 2027) seria minutos de espera sem ganho.
    const limite = Math.min(doc.numPages, 300);
    let comparativa = null, porOrgao = null;
    for (let p = 20; p <= limite; p++) {
      const texto = await textoDaPagina(doc, p);
      if (!comparativa) {
        const t = tabelaComparativa(texto);
        if (t.linhas.length >= 4) comparativa = { ...t, pagina: p };
      }
      if (!porOrgao) {
        const o = tabelaPorOrgao(texto);
        if (o.linhas.length >= 5) porOrgao = { ...o, pagina: p, titulo: tituloDaTabela(texto) };
      }
      if (comparativa && porOrgao) break;
    }
    if (!comparativa) { estado.variacao = { erro: 'Não localizei tabela comparativa entre exercícios nas primeiras 300 páginas do projeto.' }; render(); return; }

    const exs = comparativa.exercicios;
    const v = variacaoEntre(comparativa, exs[exs.length - 2], exs[exs.length - 1]);
    estado.variacao = v.comparado
      ? { ...v, fonte: `Mensagem Presidencial, p. ${comparativa.pagina} do ${q.materia.identificacao}`, porOrgao }
      : { erro: v.motivo };
    render();
  } catch (e) {
    estado.variacao = { erro: `Não consegui ler a Mensagem (${e.message}).` };
    render();
  } finally { $('on-status').textContent = ''; }
}

/** Texto de uma página, agrupado por linha (mesmo critério do extrator). */
async function textoDaPagina(doc, p) {
  const c = await (await doc.getPage(p)).getTextContent();
  const its = c.items.slice().sort((a, b) => b.transform[5] - a.transform[5]);
  const g = [];
  for (const i of its) {
    const y = i.transform[5];
    let k = g.find(x => Math.abs(x.y - y) <= 2.5);
    if (!k) { k = { y, i: [] }; g.push(k); }
    k.i.push(i);
  }
  return g.map(k => k.i.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean).join('\n');
}

function tituloDaTabela(texto) {
  const m = /Tabela\s+\d+\s*[-–]\s*([^\n]{10,120})/i.exec(texto);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function cardGuia(q) {
  const g = montarGuia(q.emendas || {}, q.relatores || {});
  if (!g.disponivel) return `<div class="on-card largo"><h3>Guia de aplicação das emendas</h3>
    <div class="on-pend">${esc(g.motivo || g.ressalva)}</div></div>`;
  const area = a => `<tr>
    <td class="a"><strong>${esc(a.area)}</strong><br>
      <span style="font-size:11px;color:var(--text-dim)">${a.relator.casa === 'Senado' ? 'Sen.' : 'Dep.'} ${esc(a.relator.nome)} (${esc(a.relator.partido)}/${esc(a.relator.uf)})${a.relator.daBancada ? '<span class="on-pode">PODEMOS</span>' : ''}</span></td>
    <td>${a.cartilhas.length
      ? a.cartilhas.map(c => `<a style="color:#0a6cf0" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.rotulo)}</a>`).join('<br>')
      : '<span class="on-vazio">sem cartilha publicada</span>'}</td></tr>`;
  return `<div class="on-card largo"><h3>Guia de aplicação das emendas · por área temática</h3>
    ${g.areasDaBancada.length ? `<div class="on-ok">A bancada relata ${g.areasDaBancada.length} área(s): ${g.areasDaBancada.map(a => esc(a.nome)).join('; ')} — acesso direto ao relator setorial.</div>` : ''}
    <table class="on-tab">${g.areas.map(area).join('')}</table>
    ${g.semArea.length ? `<div style="margin-top:8px"><div class="on-rotulo">Cartilhas sem área identificada</div>
      <ul class="on-lista">${g.semArea.map(c => `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.rotulo)}</a></li>`).join('')}</ul></div>` : ''}
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">${esc(g.ressalva)}</div>
  </div>`;
}

// ============================================================
//  CAMADA DE IA
// ============================================================
// Três leituras que regex nenhuma faz: o que a cartilha permite custear, quais
// são os parâmetros escritos no Manual, e o texto que o deputado leva à
// tribuna. Em todas, a IA lê e o JS confere (orcamento-ia.js) — e o que não
// confere não entra na nota, mas também não some da tela: aparece recusado,
// com o motivo, porque saber que houve alucinação é informação para quem revisa.
//
// O resultado é COMPARTILHADO no Firebase por exercício. Ler uma cartilha de 60
// páginas custa uma chamada; não faz sentido cada assessor pagar a mesma.

const IA_PATH = chave => `${FIREBASE_URL_ON}/orcamento_ia/${encodeURIComponent(chave)}.json`;

/**
 * Chave de um documento dentro do nó do exercício.
 *
 * NÃO pode ser a URL: o Firebase RTDB recusa chaves com ".", "/", ":", "#",
 * "$", "[" e "]" — e uma URL tem quase todos. Usar a URL crua gravaria em
 * silêncio um nó aninhado por cada barra, ou falharia a gravação inteira.
 * Um hash FNV-1a resolve, e a URL de origem vai guardada no valor.
 */
function chaveDocumento(url) {
  const s = String(url || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'd' + h.toString(36);
}

async function carregarConfigIA() {
  estado.config = await new Promise(r => {
    try { chrome.storage.local.get('config', d => r(d.config || {})); }
    catch (_) { r({}); }
  });
}

async function carregarIA(tipo, ano) {
  const vazio = { acoes: {}, sintese: null };
  try {
    const r = await fetch(IA_PATH(`${tipo}-${ano}`));
    if (!r.ok) return vazio;
    const salvo = await r.json();
    return salvo ? { ...vazio, ...salvo, acoes: salvo.acoes || {} } : vazio;
  } catch (_) { return vazio; }
}

async function salvarIA() {
  const r = await fetch(IA_PATH(`${estado.tipo}-${estado.ano}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...estado.ia, atualizadoEm: new Date().toISOString(),
                           atualizadoPor: estado.config?.nomeUsuario || 'equipe' }),
  });
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
}

/**
 * A IA está configurada? Devolve { ok } ou { ok:false, motivo }.
 * A chave fica em chrome.storage, por analista — nunca no repositório.
 */
function iaConfigurada() {
  const c = estado.config || {};
  if (!c.apiKey) {
    return { ok: false, motivo: 'Nenhuma chave de IA configurada. Clique em "IA" no topo da tela para informar provedor, chave e modelo — a chave fica no seu navegador, nunca no servidor.' };
  }
  // Mesmo padrão dos demais módulos: sem provedor escolhido, gemini.
  return { ok: true, provedorId: c.provedor || 'gemini', apiKey: c.apiKey, modelo: c.modelo };
}

// ---------- modal de configurações ----------
// Cada painel autônomo carrega o seu (analise, congresso, lideres, ccjc já
// tinham; esta tela ficou sem, e sem ela não havia como informar a chave sem
// voltar ao painel principal). Os ids são os mesmos de propósito: é a MESMA
// configuração, num só lugar do chrome.storage.

function abrirConfiguracoes() {
  const c = estado.config || {};
  $('config-provedor').value = c.provedor || 'gemini';
  $('config-api-key').value = c.apiKey || '';
  aoTrocarProvedor();
  $('config-status-ia').style.display = 'none';
  $('modelos-status').style.display = 'none';
  $('modal-configuracoes').style.display = 'flex';
}

function aoTrocarProvedor() {
  const p = PROVEDORES_ORCAMENTO[$('config-provedor').value];
  if (!p) return;
  $('config-api-key').placeholder = p.placeholderChave;
  $('config-hint-chave').textContent = p.hintChave;
  popularModelos();
}

/** Lista de reserva: funciona sem chave, para a tela nunca abrir vazia. */
function popularModelos(lista) {
  const pid = $('config-provedor').value;
  const modelos = lista || PROVEDORES_ORCAMENTO[pid].modelosFallback;
  $('config-modelo').innerHTML = modelos.map(m => `<option value="${esc(m.id)}">${esc(m.displayName)}</option>`).join('');
  const salvo = estado.config?.provedor === pid ? estado.config?.modelo : null;
  if (salvo && modelos.some(m => m.id === salvo)) $('config-modelo').value = salvo;
}

async function carregarModelos() {
  const pid = $('config-provedor').value;
  const key = $('config-api-key').value.trim();
  const st = $('modelos-status');
  st.style.display = 'block';
  if (!key) { st.textContent = 'Informe a chave primeiro.'; return; }
  st.innerHTML = '<span class="on-spinner"></span> consultando o provedor…';
  try {
    const lista = await PROVEDORES_ORCAMENTO[pid].listar(key);
    popularModelos(lista);
    st.textContent = `✓ ${lista.length} modelo(s) disponível(is).`;
  } catch (e) { st.textContent = 'Erro: ' + e.message; }
}

async function testarConexao() {
  const pid = $('config-provedor').value;
  const key = $('config-api-key').value.trim();
  const modelo = $('config-modelo').value;
  const p = PROVEDORES_ORCAMENTO[pid];
  const st = $('config-status-ia');
  st.style.display = 'block';
  st.className = 'config-status teste';
  if (!p.regexChave.test(key)) {
    st.className = 'config-status erro';
    st.textContent = `A chave não tem o formato de uma chave ${p.label} (${p.placeholderChave}).`;
    return;
  }
  st.textContent = 'Testando…';
  try {
    const r = await chamarIAOrcamento({ provedorId: pid, apiKey: key, modelo,
                                        prompt: 'Responda apenas com a palavra OK.' });
    st.className = 'config-status ok';
    st.textContent = r.text ? `✓ Conexão OK com ${p.label} (${modelo || 'modelo padrão'}).`
                            : '✓ Conectado, mas a resposta veio vazia.';
  } catch (e) { st.className = 'config-status erro'; st.textContent = 'Falha: ' + e.message; }
}

async function salvarConfig() {
  const pid = $('config-provedor').value;
  const key = $('config-api-key').value.trim();
  const p = PROVEDORES_ORCAMENTO[pid];
  if (!key) { mostrarToast('Informe a chave de API.', 'aviso'); return; }
  if (!p.regexChave.test(key)) { mostrarToast(`A chave não tem o formato de uma chave ${p.label}.`, 'aviso'); return; }
  // Mesclar, e não substituir: o mesmo nó `config` guarda nomeUsuario e a
  // chave do Portal da Transparência, que não são desta tela. Sobrescrever o
  // objeto inteiro apagaria em silêncio a configuração dos outros painéis.
  estado.config = { ...(estado.config || {}), provedor: pid, apiKey: key, modelo: $('config-modelo').value };
  await new Promise(r => chrome.storage.local.set({ config: estado.config }, r));
  $('modal-configuracoes').style.display = 'none';
  atualizarSeloConfig();
  render();
  mostrarToast('✓ Configurações salvas', 'sucesso');
}

/** O topo mostra o provedor em uso — ou avisa que não há nenhum. */
function atualizarSeloConfig() {
  const rot = $('btn-config-rotulo');
  if (!rot) return;
  const c = estado.config || {};
  const p = PROVEDORES_ORCAMENTO[c.provedor || 'gemini'];
  rot.textContent = c.apiKey ? (c.modelo || p.label) : 'IA — configurar';
  $('btn-config').style.borderColor = c.apiKey ? '' : '#d68a00';
  $('btn-config').title = c.apiKey
    ? `${p.label} · ${c.modelo || 'modelo padrão'} — clique para alterar`
    : 'Nenhuma chave de IA configurada: as leituras por IA deste módulo ficam indisponíveis.';
}

/**
 * Guarda para as ações de IA, chamada ANTES de qualquer confirm().
 * Sem isto, o analista era perguntado "ler 22 cartilhas?" ou "seguir sem dados
 * apurados?" para só então descobrir que não havia chave configurada.
 * Devolve a config ou null, já tendo aberto o lugar de resolver.
 */
function exigirIA() {
  const cfg = iaConfigurada();
  if (cfg.ok) return cfg;
  mostrarToast(cfg.motivo, 'aviso');
  abrirConfiguracoes();
  return null;
}

/** Uma chamada de IA com trava de concorrência e status na barra. */
async function comIA(rotulo, fn) {
  // A trava é o `ocupado`: uma chamada por vez. O `lote` desabilita os botões
  // entre uma cartilha e outra, quando `ocupado` está momentaneamente livre.
  if (estado.ocupado) { mostrarToast(`Aguarde: ${estado.ocupado} em andamento.`, 'aviso'); return null; }
  const cfg = exigirIA();     // última linha de defesa; as ações já checaram
  if (!cfg) return null;
  estado.ocupado = rotulo;
  $('on-status').innerHTML = `<span class="on-spinner"></span> ${esc(rotulo)}…`;
  render();
  try {
    return await fn(cfg);
  } catch (e) {
    console.error(e);
    mostrarToast(`Falhou: ${e.message}`, 'erro');
    return null;
  } finally {
    estado.ocupado = null;
    $('on-status').textContent = '';
    render();
  }
}

/** Baixa um documento como ArrayBuffer, para mandar ao modelo. */
async function bufferDe(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o documento`);
  return r.arrayBuffer();
}

/** Texto e número de páginas de um PDF já baixado. */
async function textoDoBuffer(buffer) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  let txt = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    txt += '\n' + c.items.map(i => i.str).join(' ');
  }
  return { texto: txt, paginas: doc.numPages };
}

/**
 * Baixa o documento e decide como ele vai ao modelo: como PDF (o preferido,
 * porque o modelo enxerga tabelas e quadros) ou como texto extraído, quando o
 * arquivo não cabe na requisição do provedor.
 *
 * A conferência SEMPRE roda contra o texto extraído aqui pelo pdf.js — e é
 * justamente por isso que o modo importa: no modo PDF os dois lados leem por
 * caminhos independentes; no modo texto, pela mesma extração. O resultado
 * guarda qual foi, e a tela mostra.
 */
async function prepararDocumento(url, cfg) {
  const buffer = await bufferDe(url);
  const { texto, paginas } = await textoDoBuffer(buffer.slice(0));
  const { modo, motivo } = modoDeLeitura({ bytes: buffer.byteLength, paginas, provedorId: cfg.provedorId });
  return {
    texto, paginas, modo, motivo,
    bytes: buffer.byteLength,
    pdfBuffers: modo === 'pdf' ? [buffer] : [],
    montarPrompt: p => (modo === 'pdf' ? p : comTextoDoDocumento(p, texto)),
  };
}

// ---------- produto 1: o que dá para fazer com o dinheiro ----------
/**
 * Lê UMA cartilha: manda o PDF ao modelo, confere a resposta contra o texto
 * extraído do mesmo PDF e guarda o resultado.
 *
 * O mesmo arquivo vai por dois caminhos de propósito: o modelo lê o PDF (com
 * layout, tabelas, quadros), e o pdf.js extrai o texto cru, que é contra o que
 * se confere. Se a conferência usasse o que o próprio modelo leu, não seria
 * conferência nenhuma.
 */
async function resumirCartilha(url, rotulo) {
  const chave = chaveDocumento(url);
  return comIA(`lendo "${(rotulo || '').slice(0, 40)}"`, async (cfg) => {
    const doc = await prepararDocumento(url, cfg);
    const resp = await chamarIAOrcamento({
      provedorId: cfg.provedorId, apiKey: cfg.apiKey, modelo: cfg.modelo,
      prompt: doc.montarPrompt(promptCartilha({ rotulo, exercicio: estado.ano })),
      pdfBuffers: doc.pdfBuffers,
    });
    const texto = doc.texto;
    const comum = { url, rotulo, lidoEm: new Date().toISOString(),
                    lidoPor: estado.config?.nomeUsuario || 'equipe',
                    modelo: `${cfg.provedorId}/${cfg.modelo || 'padrão'}`,
                    modoLeitura: doc.modo, motivoModo: doc.motivo, paginas: doc.paginas };
    const json = extrairJSON(resp.text);
    if (!Array.isArray(json)) {
      // Falha registrada, e não silenciosa: sem isso a cartilha voltaria à fila
      // a cada abertura da tela, gastando uma chamada por vez.
      estado.ia.acoes[chave] = { ...comum, erro: resp.truncated
        ? 'A resposta do modelo veio truncada (limite de tokens) — o documento é grande demais para uma leitura só.'
        : 'Não consegui interpretar a resposta do modelo como lista de ações.' };
      mostrarToast(`${rotulo}: ${estado.ia.acoes[chave].erro}`, 'aviso');
    } else {
      const conf = conferirAcoes(json, texto);
      estado.ia.acoes[chave] = { ...comum, ...conf };
      mostrarToast(conf.conferido ? `${rotulo}: ${conf.resumo}` : conf.motivo,
                   conf.conferido && conf.aprovadas.length ? 'sucesso' : 'aviso');
    }
    await salvarIA().catch(e => console.warn('Firebase:', e.message));
    return estado.ia.acoes[chave];
  });
}

/** Lê todas as cartilhas ainda não lidas, uma a uma. */
async function resumirTodasCartilhas() {
  if (estado.lote || estado.ocupado) { mostrarToast('Já há uma leitura em andamento.', 'aviso'); return; }
  if (!exigirIA()) return;
  const g = montarGuia(estado.quadro?.emendas || {}, estado.quadro?.relatores || {});
  const todas = [...g.areas.flatMap(a => a.cartilhas), ...g.semArea];
  const faltando = todas.filter(c => !estado.ia?.acoes?.[chaveDocumento(c.url)]);
  if (!faltando.length) { mostrarToast('Todas as cartilhas publicadas já foram lidas.', 'info'); return; }
  if (!confirm(`Ler ${faltando.length} cartilha(s) com IA? É uma chamada por documento, e o resultado fica salvo para a equipe toda.`)) return;
  estado.lote = true;
  try {
    for (let i = 0; i < faltando.length; i++) {
      const r = await resumirCartilha(faltando[i].url, faltando[i].rotulo);
      // Falha dura (chave inválida, provedor fora) não pode consumir as 22
      // chamadas seguintes só para falhar 22 vezes.
      if (r === null) {
        mostrarToast(`Leitura interrompida em ${i} de ${faltando.length} — resolva o erro acima e recomece.`, 'erro');
        break;
      }
    }
  } finally { estado.lote = false; render(); }
}

function cardAcoes() {
  const lidas = Object.entries(estado.ia?.acoes || {});
  const g = montarGuia(estado.quadro?.emendas || {}, estado.quadro?.relatores || {});
  const total = [...g.areas.flatMap(a => a.cartilhas), ...g.semArea].length;
  if (!total && !lidas.length) return '';

  const aprovadas = lidas.flatMap(([, v]) => (v.aprovadas || []).map(a => ({ ...a, fonte: v.rotulo })));
  const recusadas = lidas.flatMap(([, v]) => (v.recusadas || []).map(a => ({ ...a, fonte: v.rotulo })));
  const comErro = lidas.filter(([, v]) => v.erro);

  const acao = a => `<tr>
    <td class="a"><strong>${esc(a.codigo)}</strong> — ${esc(a.nome || '')}<br>
      <span style="font-size:11px;color:var(--text-dim)">${esc(a.orgao || a.fonte || '')}${a.pagina ? `, p. ${esc(a.pagina)}` : ''}</span></td>
    <td>${a.permite?.length ? `<div><strong style="color:#2fcf7a">Permite:</strong> ${esc(a.permite.join('; '))}</div>` : ''}
        ${a.naoPermite?.length ? `<div style="margin-top:3px"><strong style="color:#ff8e8e">Não permite:</strong> ${esc(a.naoPermite.join('; '))}</div>` : ''}
        ${a.observacoes ? `<div style="margin-top:3px;color:var(--text-dim)">${esc(a.observacoes)}</div>` : ''}</td></tr>`;

  return `<div class="on-card largo"><h3>O que dá para fazer com o dinheiro · ações orçamentárias</h3>
    <div style="font-size:12.5px;color:var(--text-dim);line-height:1.6">
      ${lidas.length} de ${total} cartilha(s) lida(s) pela IA · ${aprovadas.length} ação(ões) conferida(s) contra o texto do documento.
      <button class="btn btn-outline btn-sm" data-acao="ler-cartilhas" style="margin-left:8px" ${estado.ocupado || estado.lote ? 'disabled' : ''}>
        ${lidas.length ? 'Ler as que faltam' : 'Ler as cartilhas com IA'}</button>
    </div>
    ${aprovadas.length ? `<table class="on-tab" style="margin-top:8px">${aprovadas.map(acao).join('')}</table>` : ''}
    ${recusadas.length ? `<div class="on-falha"><strong>${recusadas.length} item(ns) descartado(s) na conferência</strong> — o modelo os produziu, mas eles
      não foram localizados no documento e por isso NÃO entram na nota:
      <ul class="on-lista" style="margin-top:5px">${recusadas.slice(0, 8).map(r => `<li>${esc(r.codigo || '(sem código)')} — ${esc(r.motivo)}</li>`).join('')}</ul></div>` : ''}
    ${comErro.length ? `<div class="on-pend">${comErro.map(([, v]) => `${esc(v.rotulo)}: ${esc(v.erro)}`).join('<br>')}</div>` : ''}
    ${avisoModoLeitura(lidas.map(([, v]) => v))}
    ${!lidas.length ? `<div class="on-pend">As cartilhas estão indexadas por área temática logo acima, mas o conteúdo — o que cada ação
      permite custear — só existe dentro dos PDFs. A leitura é feita por IA e conferida contra o texto do próprio documento.</div>` : ''}
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">
      Cada ação exibida traz um trecho literal que foi localizado no documento de origem. Localizar não é
      interpretar: a aplicabilidade ao caso concreto continua sendo do analista.
    </div>
  </div>`;
}

/**
 * Diz quais documentos precisaram ir como texto, e o que isso muda.
 * A força da conferência depende disso: no modo PDF, modelo e verificador leem
 * por caminhos independentes; no modo texto, pela mesma extração. Esconder a
 * diferença seria vender uma garantia mais forte do que a que existe.
 */
function avisoModoLeitura(leituras = []) {
  const porTexto = leituras.filter(v => v && v.modoLeitura === 'texto');
  if (!porTexto.length) return '';
  return `<div class="on-pend"><strong>${porTexto.length} documento(s) lido(s) como texto extraído, não como PDF:</strong>
    ${esc([...new Set(porTexto.map(v => `${v.rotulo} — ${v.motivoModo}`))].join(' · '))}
    Nesses casos a conferência continua pegando ação e valor que não constam do documento, mas o modelo e o
    verificador passam a ler a MESMA extração — a checagem deixa de ser por dois caminhos independentes.</div>`;
}

// ---------- produto 2: a ficha preenchida a partir da fonte ----------
/**
 * Lê a orientação normativa do exercício e PROPÕE valores para os campos
 * vazios. Proposta não é preenchimento: o analista aceita um a um, e só entra
 * o que o JS achou dentro do trecho citado.
 */
async function proporFicha() {
  const ancora = estado.quadro?.emendas?.ancoraNormativa;
  if (!ancora) { mostrarToast('Este exercício ainda não publicou orientação normativa — não há de onde extrair.', 'aviso'); return; }
  const vazios = CAMPOS_FICHA.filter(c => c.origem === 'ancora' && !estado.ficha?.valores?.[c.chave]);
  if (!vazios.length) { mostrarToast('Todos os campos de origem normativa já estão preenchidos.', 'info'); return; }
  if (!exigirIA()) return;

  return comIA(`lendo "${ancora.rotulo}"`, async (cfg) => {
    const doc = await prepararDocumento(ancora.url, cfg);
    const resp = await chamarIAOrcamento({
      provedorId: cfg.provedorId, apiKey: cfg.apiKey, modelo: cfg.modelo,
      prompt: doc.montarPrompt(promptFicha(vazios, { rotulo: ancora.rotulo, exercicio: estado.ano })),
      pdfBuffers: doc.pdfBuffers,
    });
    const texto = doc.texto;
    const json = extrairJSON(resp.text);
    if (!Array.isArray(json)) {
      mostrarToast(resp.truncated ? 'A resposta veio truncada — tente de novo ou use um modelo com saída maior.'
                                  : 'Não consegui interpretar a resposta do modelo.', 'aviso');
      return null;
    }
    const conf = conferirPropostasFicha(json, texto, CAMPOS_FICHA);
    estado.propostas = { ...conf, documento: ancora.rotulo, url: ancora.url,
                         modoLeitura: doc.modo, motivoModo: doc.motivo };
    mostrarToast(conf.conferido ? conf.resumo : conf.motivo,
                 conf.aceitas?.length ? 'sucesso' : 'aviso');
    return conf;
  });
}

/** Aceita uma proposta: vira preenchimento normal da ficha, com procedência. */
function aceitarProposta(chave) {
  const p = estado.propostas?.aceitas?.find(x => x.campo === chave);
  if (!p) return;
  const res = preencherCampo(estado.ficha, chave, {
    valor: p.valor, documento: estado.propostas.documento, pagina: p.pagina || '',
    trecho: p.trecho, preenchidoPor: `${estado.config?.nomeUsuario || 'equipe'} (proposta de IA conferida)`,
  });
  if (!res.ok) { mostrarToast(res.erro, 'aviso'); return; }
  estado.propostas.aceitas = estado.propostas.aceitas.filter(x => x.campo !== chave);
  render();
  salvarFicha().then(() => mostrarToast('✓ Campo preenchido', 'sucesso'))
               .catch(e => mostrarToast('Não consegui salvar: ' + e.message, 'erro'));
}

function aceitarTodasPropostas() {
  const chaves = (estado.propostas?.aceitas || []).map(p => p.campo);
  if (!chaves.length) return;
  for (const c of chaves) {
    const p = estado.propostas.aceitas.find(x => x.campo === c);
    if (p) preencherCampo(estado.ficha, c, { valor: p.valor, documento: estado.propostas.documento,
      pagina: p.pagina || '', trecho: p.trecho,
      preenchidoPor: `${estado.config?.nomeUsuario || 'equipe'} (proposta de IA conferida)` });
  }
  estado.propostas.aceitas = [];
  render();
  salvarFicha().then(() => mostrarToast(`✓ ${chaves.length} campo(s) preenchido(s)`, 'sucesso'))
               .catch(e => mostrarToast('Não consegui salvar: ' + e.message, 'erro'));
}

function cardPropostas() {
  const p = estado.propostas;
  if (!p) return '';
  if (!p.conferido) return `<div class="on-card largo"><h3>Propostas de preenchimento</h3><div class="on-falha">${esc(p.motivo)}</div></div>`;
  if (!p.aceitas.length && !p.recusadas.length) {
    return `<div class="on-card largo"><h3>Propostas de preenchimento</h3>
      <div class="on-pend">A IA leu "${esc(p.documento)}" e não localizou nenhum dos campos pedidos. Campo não encontrado
      é resposta legítima — o documento pode simplesmente não trazer aquele parâmetro.</div></div>`;
  }
  const linha = a => `<tr>
    <td class="a"><strong>${esc(a.rotulo)}</strong><br>
      <span style="font-size:11px;color:var(--text-dim)">“${esc(a.trecho.slice(0, 150))}${a.trecho.length > 150 ? '…' : ''}”${a.pagina ? ` — p. ${esc(a.pagina)}` : ''}</span></td>
    <td style="width:28%"><strong>${esc(a.valor)}</strong></td>
    <td style="width:14%;text-align:right"><a href="#" data-ia-aceitar="${esc(a.campo)}" style="color:#0a6cf0">aceitar</a></td></tr>`;

  return `<div class="on-card largo"><h3>Propostas de preenchimento · leitura de "${esc(p.documento)}"</h3>
    ${p.aceitas.length ? `<div class="on-ok">${p.aceitas.length} valor(es) localizado(s) no documento e conferido(s): o valor
      proposto foi encontrado <strong>dentro do trecho citado</strong>, e o trecho, dentro do PDF.
      <button class="btn btn-outline btn-sm" data-acao="aceitar-todas" style="margin-left:8px">Aceitar todas</button></div>
      <table class="on-tab" style="margin-top:8px">${p.aceitas.map(linha).join('')}</table>` : ''}
    ${p.recusadas.length ? `<div class="on-falha"><strong>${p.recusadas.length} proposta(s) descartada(s)</strong> — não são oferecidas para aceite:
      <ul class="on-lista" style="margin-top:5px">${p.recusadas.map(r => `<li>${esc(r.campo)}: ${esc(r.motivo)}</li>`).join('')}</ul></div>` : ''}
    ${avisoModoLeitura([{ rotulo: p.documento, modoLeitura: p.modoLeitura, motivoModo: p.motivoModo }])}
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">
      Aceitar grava o valor na ficha com o documento e a página — a mesma procedência exigida do preenchimento
      manual. A conferência contra a fonte continua valendo depois.
    </div>
  </div>`;
}

// ---------- produto 3: a síntese analítica ----------
/**
 * Redige o texto da nota a partir dos números JÁ conferidos, e depois confere
 * cada número escrito contra essa mesma base. O risco fica invertido: a IA não
 * extrai nada, só redige — e o que ela inventar aparece marcado.
 */
async function redigirSintese() {
  const q = estado.quadro;
  if (!q?.materia?.disponivel) return;
  if (!exigirIA()) return;
  const base = { variacao: estado.variacao, serie: estado.serie ? seriesComDados(estado.serie) : [],
                 ficha: estado.ficha, quadro: q };
  const temDado = (estado.variacao?.comparado) || base.serie.length || Object.keys(estado.ficha?.valores || {}).length;
  if (!temDado && !confirm('Nenhum número foi apurado ainda (nem variação, nem série, nem ficha). A síntese sairá só com o estágio da tramitação. Continuar?')) return;

  return comIA('redigindo a síntese', async (cfg) => {
    const resp = await chamarIAOrcamento({
      provedorId: cfg.provedorId, apiKey: cfg.apiKey, modelo: cfg.modelo,
      prompt: promptSintese({ ...base, materia: `${q.materia.identificacao} — ${q.materia.apelido}`,
                              pendencias: pendenciasDo(q) }),
    });
    const texto = (resp.text || '').trim();
    if (!texto) { mostrarToast('O modelo devolveu resposta vazia.', 'aviso'); return null; }
    const conferencia = conferirSintese(texto, numerosDaBase(base));
    estado.ia.sintese = {
      texto, conferencia, truncada: resp.truncated,
      redigidaEm: new Date().toISOString(), redigidaPor: estado.config?.nomeUsuario || 'equipe',
      modelo: `${cfg.provedorId}/${cfg.modelo || 'padrão'}`,
    };
    mostrarToast(conferencia.limpo
      ? `Síntese redigida: ${conferencia.conferidos} número(s) conferido(s) contra a base.`
      : conferencia.motivo, conferencia.limpo ? 'sucesso' : 'aviso');
    await salvarIA().catch(e => console.warn('Firebase:', e.message));
    return estado.ia.sintese;
  });
}

function cardSintese() {
  const s = estado.ia?.sintese;
  if (!s) {
    return `<div class="on-card largo"><h3>Síntese analítica</h3>
      <div style="font-size:12.5px;color:var(--text-dim);line-height:1.6">
        O texto que abre a nota — o que cresceu, o que encolheu e o que isso significa para o gabinete —
        escrito pela IA <strong>sobre os números já apurados</strong>. Ela não extrai cifra nenhuma: recebe a base
        conferida e redige em cima dela; depois, todo número do texto é procurado nessa base.
        <button class="btn btn-outline btn-sm" data-acao="redigir-sintese" style="margin-left:8px" ${estado.ocupado || estado.lote ? 'disabled' : ''}>Redigir síntese</button>
      </div></div>`;
  }
  const c = s.conferencia || { limpo: true, suspeitos: [] };
  return `<div class="on-card largo"><h3>Síntese analítica</h3>
    <div class="${c.limpo ? 'on-ok' : 'on-falha'}">${c.limpo
      ? `Conferida: os ${c.conferidos} número(s) do texto constam da base apurada.`
      : esc(c.motivo)}</div>
    ${s.truncada ? '<div class="on-pend">A resposta foi cortada no limite de tokens — o último parágrafo pode estar incompleto.</div>' : ''}
    <div style="font-size:13px;line-height:1.7;margin-top:10px;white-space:pre-wrap">${esc(s.texto)}</div>
    ${!c.limpo ? `<div class="on-pend" style="margin-top:8px"><strong>Onde estão os números não conferidos:</strong>
      <ul class="on-lista" style="margin-top:4px">${c.suspeitos.map(x => `<li><strong>${esc(x.numero)}</strong> — ${esc(x.contexto)}</li>`).join('')}</ul></div>` : ''}
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">
      ${esc(s.modelo || '')} · ${esc(dataBR(s.redigidaEm))} por ${esc(s.redigidaPor || 'equipe')} ·
      <a href="#" data-acao="redigir-sintese" style="color:#0a6cf0">refazer</a>
    </div>
  </div>`;
}

/** As pendências, extraídas para o prompt e para a nota usarem a MESMA lista. */
function pendenciasDo(q) {
  const p = [];
  if (!q.cronograma.disponivel) p.push('prazo de apresentação de emendas e demais datas do cronograma');
  if (q.relatores.disponivel && !q.relatores.relatorGeral) p.push('designação do Relator-Geral');
  if (q.relatores.disponivel && !q.relatores.setoriais.length) p.push('designação dos relatores setoriais');
  if (!q.emendas.disponivel || !q.emendas.ancoraNormativa) p.push('orientação normativa do exercício (Manual de Emendas ou equivalente), que fixa cotas, quantidades, sequenciais de cancelamento e pisos de repasse');
  if (!q.notas.disponivel) p.push('notas técnicas das consultorias (CONOF/CD e CONORF/SF)');
  return p;
}

// ============================================================
//  FICHA DE PARÂMETROS
// ============================================================
// Compartilhada com a equipe pelo Firebase, uma por exercício. O esquema vem
// de ficha.js; aqui ficam a persistência e a tela.
const FICHA_PATH = chave => `${FIREBASE_URL_ON}/orcamento_ficha/${encodeURIComponent(chave)}.json`;

async function carregarFicha(tipo, ano) {
  const vazia = fichaVazia(tipo, ano);
  try {
    const r = await fetch(FICHA_PATH(`${tipo}-${ano}`));
    if (!r.ok) return vazia;
    const salva = await r.json();
    return salva && salva.valores ? { ...vazia, ...salva, valores: salva.valores } : vazia;
  } catch (_) { return vazia; }   // Firebase fora do ar não impede trabalhar
}

async function salvarFicha() {
  const f = estado.ficha;
  const r = await fetch(FICHA_PATH(`${f.tipo}-${f.ano}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
  });
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
}

/** O que o exercício já publicou, para separar "aguardando" de "pendente". */
function fontesDoExercicio(q) {
  return {
    ancora: !!(q.emendas?.disponivel && q.emendas.ancoraNormativa),
    ploa:   !!(q.materia?.disponivel && q.materia.urlDocumento),
    auto:   { prazo_emendas: q.cronograma?.prazoEmendas
      ? `${q.cronograma.prazoEmendas.inicio} a ${q.cronograma.prazoEmendas.fim}` : null },
  };
}

const SELO_FICHA = {
  aguardando: { txt: 'aguardando fonte', cor: 'selo-naoini' },
  pendente:   { txt: 'a preencher',      cor: 'selo-pend' },
  preenchido: { txt: 'preenchido',       cor: 'selo-conc' },
  conferido:  { txt: 'conferido',        cor: 'selo-andamento' },
  divergente: { txt: '⚠ não localizado', cor: 'selo-diverg' },
};

function cardFicha(q) {
  if (!estado.ficha) return '';
  const fontes = fontesDoExercicio(q);
  const linhas = estadoDaFicha(estado.ficha, fontes);
  const r = resumoDaFicha(estado.ficha, fontes);
  const herdados = valoresDeOutroExercicio(estado.ficha);

  const linhaHtml = l => {
    const selo = SELO_FICHA[l.estado];
    const proc = l.valor
      ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${esc(l.documento || '')}${l.pagina ? `, p. ${esc(l.pagina)}` : ''}${l.automatico ? '' : ` · <a href="#" data-ficha-editar="${l.chave}" style="color:#0a6cf0">editar</a>`}</div>`
      : `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${esc(l.ajuda || '')}${l.estado === 'pendente' ? ` · <a href="#" data-ficha-editar="${l.chave}" style="color:#0a6cf0">preencher</a>` : ''}</div>`;
    return `<tr>
      <td class="a"><strong>${esc(l.rotulo)}</strong>${proc}</td>
      <td style="width:34%">${l.valor ? `<strong>${esc(l.valor)}</strong>` : '<span class="on-vazio">—</span>'}</td>
      <td style="width:22%;text-align:right"><span class="on-selo ${selo.cor}">${esc(selo.txt)}</span></td>
    </tr>`;
  };

  const grupos = GRUPOS_FICHA.map(g => {
    const doGrupo = linhas.filter(l => l.grupo === g);
    if (!doGrupo.length) return '';
    return `<div style="margin-top:10px"><div class="on-rotulo">${esc(g)}</div>
      <table class="on-tab">${doGrupo.map(linhaHtml).join('')}</table></div>`;
  }).join('');

  const temAncora = fontes.ancora;
  return `<div class="on-card largo"><h3>Ficha de parâmetros do exercício</h3>
    <div style="font-size:12.5px;color:var(--text-dim);line-height:1.6">
      ${r.conferido + r.preenchido} de ${r.total} campos preenchidos ·
      ${r.pendente} a preencher · ${r.aguardando} aguardando a fonte
      ${r.divergente ? ` · <span style="color:#ff8e8e">${r.divergente} não localizado(s) na fonte</span>` : ''}
      ${temAncora && r.pendente ? `<button class="btn btn-outline btn-sm" data-acao="propor-ficha" style="margin-left:8px" ${estado.ocupado || estado.lote ? 'disabled' : ''}>
        Extrair da fonte com IA</button>` : ''}
    </div>
    ${!fontes.ancora ? `<div class="on-pend">A orientação normativa deste exercício ainda não foi publicada. Os campos que dependem dela ficam
      <strong>aguardando</strong> — e é isso que a nota deve dizer, em vez de repetir os números do ano anterior.
      Só para dar a medida: a cota individual por deputado era R$ 19.704.897,00 na LOA 2023 e R$ 40.252.007,00 na LOA 2026.</div>` : ''}
    ${herdados.length ? `<div class="on-falha">⚠ ${herdados.length} valor(es) carimbado(s) com outro exercício: ${herdados.map(h => esc(h.rotulo) + ' (' + esc(h.exercicio) + ')').join('; ')}. Confirme na fonte deste ano antes de usar.</div>` : ''}
    ${grupos}
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:10px">
      Nenhum campo aceita valor sem documento de origem. "Conferido" significa apenas que o valor foi
      localizado no texto da fonte — não que o dispositivo se aplique ao caso.
    </div>
  </div>`;
}

/** Diálogo de preenchimento: valor + documento + página + trecho. */
function abrirEdicaoCampo(chave) {
  const campo = CAMPOS_FICHA.find(c => c.chave === chave);
  if (!campo) return;
  const atual = estado.ficha.valores[chave] || {};
  const sugestao = estado.quadro?.emendas?.ancoraNormativa?.rotulo
    || estado.quadro?.materia?.apelido || '';
  const valor = prompt(`${campo.rotulo}\n${campo.ajuda || ''}\n\nValor:`, atual.valor || '');
  if (valor === null) return;
  const documento = prompt('Documento de origem (obrigatório — a ficha não aceita valor sem procedência):',
    atual.documento || sugestao);
  if (documento === null) return;
  const pagina = prompt('Página do documento (opcional, mas recomendável):', atual.pagina || '');
  if (pagina === null) return;
  const trecho = prompt('Trecho citado (opcional — ajuda a conferir depois):', atual.trecho || '');

  const res = preencherCampo(estado.ficha, chave, {
    valor, documento, pagina, trecho: trecho || '',
    preenchidoPor: estado.config?.nomeUsuario || 'equipe',
  });
  if (!res.ok) { mostrarToast(res.erro, 'aviso'); return; }
  render();
  salvarFicha()
    .then(() => mostrarToast('✓ Ficha atualizada', 'sucesso'))
    .catch(e => mostrarToast('Não consegui salvar no Firebase: ' + e.message, 'erro'));
}

// ============================================================
//  CONFERÊNCIA NORMATIVA
// ============================================================
/**
 * Lê o Manual de Emendas do exercício e confere contra ele a nota gerada.
 * O Manual é um PDF grande (o da LOA 2026 tem 259 páginas e 14 MB), então a
 * extração roda uma vez e fica em memória enquanto a tela não trocar de ano.
 */
async function conferirNormas() {
  const q = estado.quadro;
  const manual = q?.emendas?.ancoraNormativa;
  if (!manual) return;
  const btn = $('btn-conferir');
  const rot = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="on-spinner"></span> lendo a orientação…';
  try {
    const texto = await extrairTextoPdfUrl(manual.url);
    const nota = montarTextoNota(q);
    estado.conferencia = {
      rotuloFonte: manual.rotulo,
      resultado: conferirContraFonte(nota, texto, { rotuloFonte: manual.rotulo }),
    };
    // O mesmo texto serve para conferir os valores da ficha: cada número
    // preenchido é procurado na fonte do exercício.
    const rf = conferirFicha(estado.ficha, texto, manual.rotulo);
    if (rf.conferida) {
      await salvarFicha().catch(e => console.warn('Firebase:', e.message));
      mostrarToast(`Ficha conferida: ${rf.conferidos} localizado(s), ${rf.divergentes} não localizado(s).`,
                   rf.divergentes ? 'aviso' : 'sucesso');
    }
    render();
  } catch (e) {
    console.error(e);
    estado.conferencia = {
      rotuloFonte: manual.rotulo,
      resultado: { conferido: false, alertas: [], normas: { confirmadas: [], naoConfirmadas: [] }, valores: { confirmados: [], naoConfirmados: [] },
                   motivo: `Não consegui ler o Manual de Emendas (${e.message}) — nada foi conferido.` },
    };
    render();
  } finally {
    btn.disabled = false;
    btn.innerHTML = rot;
  }
}

/** Baixa um PDF e devolve o texto (pdf.js já vem carregado na página). */
async function extrairTextoPdfUrl(url) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const doc = await pdfjsLib.getDocument({ data: await r.arrayBuffer() }).promise;
  let txt = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    txt += '\n' + c.items.map(i => i.str).join(' ');
  }
  return txt;
}

// ============================================================
//  NOTA TÉCNICA
// ============================================================
/** Texto corrido da nota — é o que a conferência normativa analisa. */
function montarTextoNota(q) {
  const m = q.materia, r = q.relatores, c = q.cronograma;
  const p = [];
  if (m.disponivel) p.push(`${m.apelido} — ${m.identificacao}. ${m.ementa} Autoria: ${m.autoria}. Situação: ${m.situacaoAtual}.`);
  if (r.disponivel) {
    p.push(`Presidente da CMO: ${r.presidenteCMO ? r.presidenteCMO.nome : 'não designado'}. ` +
           `Relator-Geral: ${r.relatorGeral ? r.relatorGeral.nome : 'ainda não designado'}. ` +
           `Relator da Receita: ${r.relatorReceita ? r.relatorReceita.nome : 'ainda não designado'}.`);
  }
  if (c.disponivel && c.prazoEmendas) p.push(`Prazo de apresentação de emendas: de ${c.prazoEmendas.inicio} a ${c.prazoEmendas.fim}.`);
  else p.push('Prazo de apresentação de emendas ainda não publicado pela CMO.');
  return p.join('\n\n');
}

/** Abre a nota em aba própria, pronta para impressão/PDF pelo navegador. */
function gerarNota() {
  const q = estado.quadro;
  if (!q?.materia?.disponivel) return;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para gerar a nota.'); return; }
  w.document.write(htmlNota(q, estado.conferencia, estado.ficha, estado.serie, estado.variacao, estado.ia));
  w.document.close();
}

function htmlNota(q, conf, ficha, serie, variacao, ia) {
  const m = q.materia, r = q.relatores, c = q.cronograma, a = q.acompanhamento, e = q.emendas;
  const agora = new Date();
  const carimbo = `${String(agora.getDate()).padStart(2, '0')}/${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()} ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  const legislatura = legislaturaDe(agora.getFullYear());
  const nome = p => p ? `${p.casa === 'Senado' ? 'Sen.' : 'Dep.'} ${esc(p.nome)} (${esc(p.partido)}/${esc(p.uf)})` : '<span class="nd">Ainda não designado</span>';

  // As pendências são o miolo da nota enquanto a CMO não avança. Elas saem
  // do estado REAL de cada fonte, não de uma lista fixa.
  // Pendência é o que a CMO AINDA NÃO fez; fonte que o portal não publica é
  // outra coisa e não entra aqui. A LDO, por exemplo, não tem página de
  // relatores nenhuma — dizer "designação pendente" seria inventar um atraso
  // que não existe. Guardar por `disponivel` também evita ler .length de uma
  // leitura que não trouxe lista (o que quebrava a nota da LDO).
  // A MESMA lista que vai no prompt da síntese (pendenciasDo): se a nota e a IA
  // divergissem sobre o que falta, o texto redigido contradiria a seção 4 da
  // própria nota que o contém.
  const pendencias = pendenciasDo(q);

  const alertas = conf ? resumoConferencia(conf.resultado) : null;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Nota Técnica — ${esc(m.apelido)}</title>
<style>
  @page { size: A4; margin: 22mm 20mm 20mm 22mm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11.5pt; line-height: 1.5; color: #111; margin: 0; text-align: justify; }
  .cab { text-align: center; border-bottom: 2px solid #1a3a6b; padding-bottom: 6px; margin-bottom: 14px; }
  .cab h1 { font-size: 15pt; letter-spacing: 2px; margin: 0; color: #1a3a6b; }
  .cab .leg { font-size: 10pt; color: #444; } .cab .atu { font-size: 8.5pt; color: #666; font-style: italic; }
  h2 { font-size: 11.5pt; color: #1a3a6b; margin: 18px 0 7px; padding-bottom: 3px; border-bottom: 1px solid #c8d4e6; text-transform: uppercase; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 6px; vertical-align: top; border-bottom: 1px solid #e6e6e6; font-size: 10.5pt; }
  td.r { width: 26%; font-weight: bold; color: #1a3a6b; }
  .nd { color: #a35b00; font-weight: bold; }
  .pend { background: #fffaf0; border-left: 3px solid #d68a00; padding: 9px 12px; margin: 9px 0; font-size: 10.5pt; }
  .conf { background: #f2f8f2; border-left: 3px solid #2f7a3a; padding: 9px 12px; margin: 9px 0; font-size: 10pt; }
  ul { margin: 6px 0 0; padding-left: 18px; font-size: 10.5pt; } li { margin-bottom: 3px; }
  .fonte { font-size: 8.5pt; color: #666; font-style: italic; margin-top: 5px; }
  .rodape { margin-top: 26px; border-top: 1px solid #c8d4e6; padding-top: 5px; text-align: center; font-size: 8.5pt; color: #1a3a6b; }
  @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint" style="background:#eef3fb;padding:8px 12px;margin-bottom:12px;font-family:sans-serif;font-size:12px">
  Use <strong>Ctrl+P → Salvar como PDF</strong> para exportar.
</div>

<div class="cab">
  <h1>NOTA TÉCNICA</h1>
  <div class="leg">${legislatura}ª Legislatura</div>
  <div class="atu">Atualizada em ${carimbo}</div>
</div>

<p>A presente nota técnica trata do <strong>${esc(m.identificacao)} — ${esc(m.apelido)}</strong>${m.dataApresentacao ? `, apresentado ao Congresso Nacional em ${dataBR(m.dataApresentacao)}` : ''}.
Situação em ${carimbo.slice(0, 10)}: <strong>${esc(m.situacaoAtual || '—')}</strong>.
${pendencias.length ? 'A matéria ainda não percorreu todas as etapas na Comissão Mista, e por isso parte dos parâmetros operacionais não está definida — o que está e o que não está vem discriminado adiante.' : ''}</p>

${blocoSinteseNota(ia?.sintese)}

<h2>1. Identificação da matéria</h2>
<table>
  <tr><td class="r">Matéria</td><td>${esc(m.identificacao)} — ${esc(m.apelido)}</td></tr>
  <tr><td class="r">Ementa</td><td>${esc(m.ementa)}</td></tr>
  <tr><td class="r">Autoria</td><td>${esc(m.autoria || '—')}</td></tr>
  <tr><td class="r">Apresentação</td><td>${dataBR(m.dataApresentacao)}</td></tr>
  <tr><td class="r">Situação</td><td><strong>${esc(m.situacaoAtual || '—')}</strong>${m.dataSituacaoAtual ? ` (desde ${dataBR(m.dataSituacaoAtual)})` : ''}</td></tr>
  ${m.normaGerada ? `<tr><td class="r">Norma gerada</td><td><strong>${esc(m.normaGerada)}</strong></td></tr>` : ''}
  ${r.disponivel ? `
  <tr><td class="r">Presidente da CMO</td><td>${nome(r.presidenteCMO)}</td></tr>
  <tr><td class="r">Relator-Geral</td><td>${nome(r.relatorGeral)}</td></tr>
  <tr><td class="r">Relator da Receita</td><td>${nome(r.relatorReceita)}</td></tr>
  <tr><td class="r">Relatores setoriais</td><td>${r.setoriais.length ? `${r.setoriais.length} áreas temáticas designadas` : '<span class="nd">Ainda não designados</span>'}</td></tr>`
  // Sem página de relatores (caso da LDO), a nota diz que a informação não é
  // publicada ali — e não que a relatoria esteja vaga.
  : `<tr><td class="r">Relatoria</td><td><span class="nd">${esc(r.motivo || 'Informação não disponível.')}</span></td></tr>`}
</table>
<div class="fonte">Fonte: Senado Federal, Dados Abertos (processo ${esc(m.identificacao)}); Congresso Nacional, Orçamento da União ${esc(q.anoOrcamento)}. Consulta em ${carimbo}.</div>

${a.disponivel ? `<h2>2. Estágio da tramitação</h2>
<table>${a.etapas.map((et, i) => `<tr><td class="r" style="width:8%">${i + 1}.</td><td>${esc(et.nome)}</td><td style="width:28%;text-align:right">${esc(et.estado || '—')}</td></tr>`).join('')}</table>
${a.ultimoEstado ? `<div class="fonte">Último estado: ${esc(a.ultimoEstado.data)} — ${esc(a.ultimoEstado.descricao)}.</div>` : ''}` : ''}

<h2>3. Prazo de emendas</h2>
${c.disponivel && c.prazoEmendas
  ? `<p>O cronograma aprovado pela Comissão Mista fixa a apresentação de emendas ao projeto entre
     <strong>${esc(c.prazoEmendas.inicio)}</strong> e <strong>${esc(c.prazoEmendas.fim)}</strong>.</p>
     <table>${c.itens.map(i => `<tr><td class="r" style="width:8%">${i.ordem}.</td><td>${esc(i.descricao)}</td><td style="width:30%;text-align:right">${esc(i.inicio)} a ${esc(i.fim)}${i.observacao ? ` (${esc(i.observacao)})` : ''}</td></tr>`).join('')}</table>`
  : `<div class="pend">${esc(c.motivo || 'Cronograma não disponível.')} Sem cronograma aprovado não há prazo fixado, e ele não se deduz do exercício anterior.</div>`}

${pendencias.length ? `<h2>4. O que ainda não está definido</h2>
<div class="pend">Nesta data, os itens abaixo não foram publicados pela Comissão Mista. Nenhum deles pode ser
antecipado a partir de exercícios anteriores: são fixados a cada ano, e o regime de emendas muda entre eles.
<ul>${pendencias.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}

${e.disponivel && e.ancoraNormativa ? `<h2>${pendencias.length ? '5' : '4'}. Base normativa do exercício</h2>
<p>Os parâmetros operacionais das emendas deste exercício constam do
<strong>${esc(e.ancoraNormativa.rotulo)}</strong>, publicado pela Comissão Mista, que é a referência a ser consultada
para cotas, quantidades, sequenciais de cancelamento e pisos de repasse.</p>
${alertas ? `<div class="conf"><strong>Conferência automática contra o Manual:</strong><br>${alertas.map(esc).join('<br>')}
<br><span style="font-size:9pt">A conferência indica apenas se a norma ou o valor citado consta do documento do exercício; constar não significa que o dispositivo siga aplicável ao mesmo caso.</span></div>` : ''}` : ''}

${blocoFichaNota(q, ficha, pendencias.length)}
${blocoSerieNota(serie)}
${blocoVariacaoNota(variacao)}
${blocoAcoesNota(ia)}
${q.executivo && q.executivo.disponivel ? `<h2>Documentos do Poder Executivo</h2>
<p>O conteúdo do orçamento — alocação por órgão, parâmetros adotados e o que muda em relação à lei vigente —
está nos documentos publicados pelo Ministério do Planejamento${m.urlDocumento ? `, e a <strong>Mensagem Presidencial</strong> integra o PDF do próprio ${esc(m.identificacao)}, em suas páginas iniciais` : ''}.</p>
<table>${q.executivo.documentos.slice(0, 14).map(d => `<tr><td class="r">${esc(d.rotulo)}</td><td style="font-size:9pt;color:#555">${esc(d.url)}</td></tr>`).join('')}</table>` : ''}
${q.alteracoes && q.alteracoes.disponivel ? `<h2>Alterações ao texto do PPA</h2>
<p>O plano em vigor é a <strong>${esc(q.alteracoes.leiDoPlano || 'lei do PPA')}</strong>. Ao longo do quadriênio, o Poder
Executivo encaminha projetos que o alteram; são eles que tramitam, e não o plano original.</p>
<table>${q.alteracoes.alteracoes.map(x => `<tr><td class="r">${esc(x.projeto)}</td><td>${esc(x.ementa || '')}</td><td style="width:22%;text-align:right">${esc(x.situacao || '—')}${x.normaGerada ? `<br>${esc(x.normaGerada)}` : ''}</td></tr>`).join('')}</table>
${q.alteracoes.emTramitacao.length ? `<div class="pend">Em tramitação nesta data: <strong>${q.alteracoes.emTramitacao.map(x => esc(x.projeto)).join(', ')}</strong>.</div>` : ''}` : ''}

<div class="rodape">Coordenação de Orçamento da Liderança do Podemos na Câmara dos Deputados</div>
</body></html>`;
}

/**
 * A ficha na nota. Mostra o que está preenchido COM a procedência, e nomeia o
 * que falta — a lacuna declarada vale mais que a linha omitida, porque o
 * gabinete precisa saber que aquele número ainda não existe.
 */
function blocoFichaNota(q, ficha, temPendencias) {
  if (!ficha) return '';
  const linhas = estadoDaFicha(ficha, fontesDoExercicio(q));
  const comValor = linhas.filter(l => l.valor);
  const semValor = linhas.filter(l => !l.valor);
  if (!comValor.length && !semValor.length) return '';

  const n = temPendencias ? 6 : 5;
  const linhaHtml = l => `<tr>
    <td class="r">${esc(l.rotulo)}</td>
    <td><strong>${esc(l.valor)}</strong>${l.estado === 'divergente' ? ' <span class="nd">⚠ não localizado na fonte</span>' : ''}</td>
    <td style="width:32%;font-size:9pt;color:#555">${esc(l.documento || '')}${l.pagina ? `, p. ${esc(l.pagina)}` : ''}</td>
  </tr>`;

  const aguardando = semValor.filter(l => l.estado === 'aguardando');
  const aPreencher = semValor.filter(l => l.estado === 'pendente');

  return `<h2>${n}. Parâmetros do exercício</h2>
${comValor.length
  ? `<table>${comValor.map(linhaHtml).join('')}</table>
     <div class="fonte">Cada valor traz o documento de onde foi extraído. "Não localizado na fonte" significa que a
     conferência automática não encontrou o número no texto indicado — confirme antes de divulgar.</div>`
  : ''}
${aguardando.length ? `<div class="pend">Ainda sem fonte publicada para este exercício, e portanto <strong>sem valor definido</strong>:
  ${esc(aguardando.map(l => l.rotulo).join('; '))}. Estes números são fixados a cada ano e não se deduzem do exercício anterior.</div>` : ''}
${aPreencher.length ? `<div class="pend">A fonte já foi publicada, mas estes campos ainda não foram preenchidos pela Coordenação:
  ${esc(aPreencher.map(l => l.rotulo).join('; '))}.</div>` : ''}`;
}

/**
 * A série na nota. O número isolado não informa; a série informa. E a cobertura
 * vai junto: série com buraco no meio não pode ser lida como evolução anual.
 */
function blocoSerieNota(serie) {
  const comDados = serie ? seriesComDados(serie) : [];
  if (!comDados.length) return '';
  return `<h2>Evolução entre exercícios</h2>
<table>${comDados.map(s => `<tr><td class="r">${esc(s.rotulo)}</td><td>${esc(frasSerie(s).replace(s.rotulo + ': ', ''))}</td></tr>`).join('')}</table>
<div class="fonte">Cada ponto vem da ficha do respectivo exercício, com documento de origem registrado.
Exercícios sem ficha aparecem como lacuna — nenhum valor é interpolado.</div>`;
}

/** "O que subiu e o que caiu" — a parte que vai à tribuna. */
function blocoVariacaoNota(v) {
  if (!v || v.erro || !v.comparado) return '';
  const linha = i => `<tr><td class="r">${esc(i.rotulo)}</td>
    <td style="text-align:right">${esc(formatarBR(i.de))} → <strong>${esc(formatarBR(i.para))}</strong></td>
    <td style="width:16%;text-align:right">${i.pct >= 0 ? '+' : '−'}${Math.abs(i.pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</td></tr>`;
  return `<h2>O que muda em relação ao exercício anterior</h2>
<p>Comparação entre <strong>${esc(v.de)}</strong> e <strong>${esc(v.para)}</strong>, em R$ milhões, extraída da ${esc(v.fonte)}.</p>
${v.maioresAltas.length ? `<p><strong>Maiores altas</strong></p><table>${v.maioresAltas.slice(0, 8).map(linha).join('')}</table>` : ''}
${v.maioresQuedas.length ? `<p><strong>Maiores quedas</strong></p><table>${v.maioresQuedas.slice(0, 8).map(linha).join('')}</table>` : ''}
${v.porOrgao ? `<p><strong>Por órgão — ${esc(v.porOrgao.titulo || 'distribuição')}</strong></p>
<table>${v.porOrgao.linhas.map(l => `<tr><td class="r">${esc(l.codigo)}</td><td>${esc(l.orgao)}</td><td style="text-align:right">${esc(formatarBR(l.valor))}</td></tr>`).join('')}</table>
<div class="fonte">${v.porOrgao.confere
  ? `Leitura conferida contra o total impresso no documento (${esc(formatarBR(v.porOrgao.total))}): a tabela está completa.`
  : esc(v.porOrgao.motivo)}</div>` : ''}`;
}

/**
 * A síntese abre a nota — é o parágrafo que o deputado lê antes de qualquer
 * tabela. Vai com o carimbo de que foi redigida por IA sobre a base apurada, e
 * com os números não conferidos NOMEADOS dentro do próprio documento impresso.
 *
 * Publicar a nota com a ressalva impressa é o que impede a marcação de se
 * perder no caminho da tela para o PDF: quem recebe o arquivo por WhatsApp não
 * vê o card, vê a nota.
 */
function blocoSinteseNota(s) {
  if (!s?.texto) return '';
  const c = s.conferencia || { limpo: true, suspeitos: [] };
  const paragrafos = s.texto.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return `<h2>Síntese analítica</h2>
${paragrafos.map(p => `<p>${esc(p)}</p>`).join('\n')}
${c.limpo
  ? `<div class="fonte">Texto redigido com apoio de inteligência artificial sobre a base de dados apurada nesta nota.
     Os ${c.conferidos} valor(es) citados foram conferidos, um a um, contra os números extraídos dos documentos.</div>`
  : `<div class="pend"><strong>Ressalva de conferência:</strong> ${esc(c.suspeitos.length)} número(s) deste texto
     (${esc(c.suspeitos.map(x => x.numero).join(', '))}) não constam da base apurada e <strong>não foram conferidos</strong>
     contra os documentos. Confirme na fonte antes de divulgar.</div>`}
${s.truncada ? '<div class="pend">A redação foi interrompida no limite de tokens do modelo — o último parágrafo pode estar incompleto.</div>' : ''}`;
}

/**
 * As ações orçamentárias — a resposta a "o que eu faço com esse dinheiro".
 * Só as aprovadas na conferência entram; as descartadas ficam no painel, para
 * quem revisa, e não na nota, que é documento de circulação.
 */
function blocoAcoesNota(ia) {
  const lidas = Object.values(ia?.acoes || {});
  const acoes = lidas.flatMap(v => (v.aprovadas || []).map(a => ({ ...a, fonte: v.rotulo })));
  if (!acoes.length) return '';
  const linha = a => `<tr>
    <td class="r">${esc(a.codigo)}</td>
    <td>${esc(a.nome || '')}${a.orgao ? `<br><span style="font-size:9pt;color:#555">${esc(a.orgao)}</span>` : ''}
      ${a.permite?.length ? `<div style="font-size:9.5pt"><strong>Permite:</strong> ${esc(a.permite.join('; '))}</div>` : ''}
      ${a.naoPermite?.length ? `<div style="font-size:9.5pt"><strong>Não permite:</strong> ${esc(a.naoPermite.join('; '))}</div>` : ''}
      ${a.observacoes ? `<div style="font-size:9.5pt;color:#555">${esc(a.observacoes)}</div>` : ''}</td>
  </tr>`;
  return `<h2>Aplicação das emendas — o que cada ação permite custear</h2>
<p>O quadro abaixo reúne as ações orçamentárias descritas nas cartilhas publicadas para este exercício, com o
que cada uma admite e o que veda. A leitura dos documentos foi feita com apoio de inteligência artificial, e
cada ação listada teve o trecho de origem <strong>localizado no texto do próprio documento</strong>; o que não
foi localizado não consta deste quadro.</p>
<table>${acoes.map(linha).join('')}</table>
<div class="fonte">Fontes: ${esc([...new Set(lidas.map(v => v.rotulo).filter(Boolean))].join('; '))}.
Constar do documento não significa que a ação se aplique ao caso concreto — a adequação da emenda continua
sendo análise do gabinete.</div>`;
}

/** 57ª Legislatura: 2023-2027. Cada legislatura dura 4 anos desde 1826. */
function legislaturaDe(ano) {
  return 57 + Math.floor((ano - 2023) / 4);
}

// ============================================================
//  INÍCIO
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await carregarConfigIA();
  atualizarSeloConfig();
  const selAno = $('f-ano');

  const povoar = () => {
    const chaves = chavesDe(estado.tipo);
    selAno.innerHTML = chaves.map(a => `<option value="${a}">${a}</option>`).join('');
    estado.ano = chaves[0];
    selAno.value = estado.ano;
    // O rótulo do seletor acompanha a lei: o PPA é por período, não exercício.
    selAno.previousElementSibling.textContent = estado.tipo === 'ppa' ? 'Período' : 'Exercício';
  };
  $('f-tipo').addEventListener('change', ev => { estado.tipo = ev.target.value; povoar(); carregar(); });
  selAno.addEventListener('change', ev => { estado.ano = ev.target.value; carregar(); });
  $('btn-atualizar').addEventListener('click', carregar);
  $('btn-conferir').addEventListener('click', conferirNormas);
  $('btn-nota').addEventListener('click', gerarNota);
  $('btn-voltar').addEventListener('click', () => { window.location.href = 'panel.html'; });

  // Configurações de IA
  $('btn-config').addEventListener('click', abrirConfiguracoes);
  $('config-provedor').addEventListener('change', () => { $('config-api-key').value = ''; aoTrocarProvedor(); });
  $('btn-carregar-modelos').addEventListener('click', carregarModelos);
  $('btn-testar-conexao').addEventListener('click', testarConexao);
  $('btn-salvar-config').addEventListener('click', salvarConfig);
  $('btn-toggle-key').addEventListener('click', () => {
    const i = $('config-api-key');
    i.type = i.type === 'password' ? 'text' : 'password';
  });
  document.querySelectorAll('[data-fecha]').forEach(b => {
    b.addEventListener('click', () => { const el = $(b.dataset.fecha); if (el) el.style.display = 'none'; });
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.style.display = 'none'; });
  });
  // Os links da ficha nascem a cada render; a escuta fica no contêiner.
  const ACOES = {
    'ler-mensagem':    lerMensagem,
    'ler-cartilhas':   resumirTodasCartilhas,
    'propor-ficha':    proporFicha,
    'aceitar-todas':   aceitarTodasPropostas,
    'redigir-sintese': redigirSintese,
  };
  $('on-corpo').addEventListener('click', ev => {
    const botao = ev.target.closest('[data-acao]');
    if (botao && ACOES[botao.getAttribute('data-acao')]) {
      ev.preventDefault();
      ACOES[botao.getAttribute('data-acao')]();
      return;
    }
    const aceitar = ev.target.closest('[data-ia-aceitar]');
    if (aceitar) { ev.preventDefault(); aceitarProposta(aceitar.getAttribute('data-ia-aceitar')); return; }
    const a = ev.target.closest('[data-ficha-editar]');
    if (!a) return;
    ev.preventDefault();
    abrirEdicaoCampo(a.getAttribute('data-ficha-editar'));
  });

  // Exercício seguinte por padrão: é o que está em tramitação na CMO no
  // segundo semestre, que é quando a nota é pedida.
  povoar();
  carregar();
});
