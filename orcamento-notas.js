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
  if ($('btn-nota-pdf')) $('btn-nota-pdf').disabled = true;
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
  partes.push(cardNumeros());
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
  if ($('btn-nota-pdf')) $('btn-nota-pdf').disabled = !q.materia.disponivel;
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
  const vazio = { acoes: {}, sintese: null, numeros: {} };
  try {
    const r = await fetch(IA_PATH(`${tipo}-${ano}`));
    if (!r.ok) return vazio;
    const salvo = await r.json();
    return salvo ? { ...vazio, ...salvo, acoes: salvo.acoes || {}, numeros: salvo.numeros || {} } : vazio;
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
    valor: p.valor, documento: p.documento || estado.propostas.documento, pagina: p.pagina || '',
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
    if (p) preencherCampo(estado.ficha, c, { valor: p.valor, documento: p.documento || estado.propostas.documento,
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
      <span style="font-size:11px;color:var(--text-dim)">“${esc((a.trecho || '').slice(0, 150))}${(a.trecho || '').length > 150 ? '…' : ''}”${a.documento && a.documento !== p.documento ? ` — ${esc(a.documento)}` : ''}${a.pagina ? ` — p. ${esc(a.pagina)}` : ''}</span></td>
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

// ---------- produto 4: os números do exercício ----------
// A ressalva de b0b554d: a nota saía sem um número do orçamento porque todo
// número estava atrás de um portão manual. Aqui o portão vira um botão — e,
// no "Apurar tudo", um só. A IA lê as fontes que o módulo JÁ localiza
// (informativo e nota técnica das Consultorias, Raio-X, Relatório Geral, a
// Mensagem dentro do PDF do projeto) e devolve cada número com página e
// trecho; o JS confere (conferirNumeros) e só o conferido vai à nota e à
// lista branca da síntese.

/**
 * As fontes de números do exercício, na ordem em que valem a leitura: as
 * curtas e densas primeiro (o Informativo das Consultorias tem 12 páginas e a
 * tabela de variáveis na p.1), a Mensagem do projeto em seguida, as longas por
 * último. `mensagem: true` marca o PDF do projeto, que precisa de leitura por
 * páginas (3.235 páginas no PLN 24/2026).
 */
function fontesDeNumeros(q) {
  const f = [];
  const add = (d, classe, extra = {}) => {
    const url = d?.url, rotulo = d?.rotulo || d?.titulo;
    if (!url || !rotulo || f.some(x => x.url === url)) return;
    f.push({ rotulo, url, classe, ...extra });
  };
  const notas = q?.notas?.disponivel ? (q.notas.notas || []) : [];
  const com = re => notas.filter(n => re.test(n.titulo || ''));
  com(/informativo/i).forEach(n => add(n, 'informativo'));
  com(/raio[\s-]?x/i).forEach(n => add(n, 'raiox'));
  (q?.executivo?.documentos || []).filter(d => d.classe === 'orcamento_cidadao').forEach(d => add(d, 'orcamento_cidadao'));
  if (q?.materia?.disponivel && q.materia.urlDocumento) {
    add({ rotulo: `Mensagem Presidencial (${q.materia.identificacao})`, url: q.materia.urlDocumento }, 'mensagem', { mensagem: true });
  }
  com(/subs[íi]dios|nota\s+t[ée]cnica\s+conjunta/i).forEach(n => add(n, 'nota_tecnica'));
  if (q?.acompanhamento?.relatorioGeral) add(q.acompanhamento.relatorioGeral, 'relatorio_geral');
  notas.forEach(n => add(n, 'nota'));
  return f;
}

/**
 * A Mensagem Presidencial não é arquivo próprio: são as ~250 páginas iniciais
 * do PDF do projeto. Lê-se por página, escolhem-se as que trazem os termos da
 * nota (paginasRelevantes) e vai TEXTO — nunca o PDF de 27 MB. A conferência
 * roda contra esse mesmo texto, e isso fica dito no modo de leitura.
 */
async function prepararMensagem(url, cfg) {
  void cfg;
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o projeto`);
  const buffer = await r.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const ini = Math.min(10, doc.numPages), fim = Math.min(doc.numPages, 320);
  const paginas = [];
  for (let p = ini; p <= fim; p++) paginas.push({ numero: p, texto: await textoDaPagina(doc, p) });
  const escolhidas = paginasRelevantes(paginas, TERMOS_MENSAGEM, 45);
  const texto = escolhidas.map(p => `\n[página ${p.numero} do PDF]\n${p.texto}`).join('\n');
  const motivo = `a Mensagem está dentro do PDF do projeto (${doc.numPages} páginas); foram lidas as ${escolhidas.length} páginas mais relevantes entre a ${ini} e a ${fim}, como texto extraído.`;
  return { texto, paginas: doc.numPages, modo: 'texto', motivo, bytes: buffer.byteLength, pdfBuffers: [],
           montarPrompt: p => comTextoDoDocumento(p, texto) };
}

/** Lê UMA fonte de números e guarda o resultado conferido. */
async function lerFonteDeNumeros(f) {
  const chave = chaveDocumento(f.url);
  return comIA(`lendo números em "${(f.rotulo || '').slice(0, 40)}"`, async (cfg) => {
    const doc = f.mensagem ? await prepararMensagem(f.url, cfg) : await prepararDocumento(f.url, cfg);
    const q = estado.quadro;
    const resp = await chamarIAOrcamento({
      provedorId: cfg.provedorId, apiKey: cfg.apiKey, modelo: cfg.modelo,
      prompt: doc.montarPrompt(promptNumeros({ materia: q?.materia?.disponivel ? `${q.materia.identificacao} — ${q.materia.apelido}` : '',
                                                rotulo: f.rotulo, exercicio: estado.ano })),
      pdfBuffers: doc.pdfBuffers,
    });
    if (!estado.ia.numeros) estado.ia.numeros = {};
    const comum = { url: f.url, rotulo: f.rotulo, classe: f.classe, lidoEm: new Date().toISOString(),
                    lidoPor: estado.config?.nomeUsuario || 'equipe',
                    modelo: `${cfg.provedorId}/${cfg.modelo || 'padrão'}`,
                    modoLeitura: doc.modo, motivoModo: doc.motivo, paginas: doc.paginas };
    const json = extrairJSON(resp.text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      estado.ia.numeros[chave] = { ...comum, erro: resp.truncated
        ? 'A resposta do modelo veio truncada (limite de tokens).'
        : 'Não consegui interpretar a resposta do modelo como a lista de números.' };
      mostrarToast(`${f.rotulo}: ${estado.ia.numeros[chave].erro}`, 'aviso');
    } else {
      const conf = conferirNumeros(json, doc.texto);
      estado.ia.numeros[chave] = { ...comum, ...conf };
      mostrarToast(conf.conferido ? `${f.rotulo}: ${conf.resumo}` : conf.motivo,
                   conf.conferido && conf.apurados.length ? 'sucesso' : 'aviso');
    }
    await salvarIA().catch(e => console.warn('Firebase:', e.message));
    return estado.ia.numeros[chave];
  });
}

/**
 * Apura os números nas fontes ainda não lidas (até três por vez — uma chamada
 * por documento). Ao final, os indicadores que têm campo na ficha viram
 * propostas de preenchimento, com a mesma procedência exigida à mão.
 */
async function apurarNumeros({ silencioso = false } = {}) {
  const q = estado.quadro;
  if (!q?.materia?.disponivel) return null;
  if (estado.lote || estado.ocupado) { if (!silencioso) mostrarToast('Já há uma leitura em andamento.', 'aviso'); return null; }
  const fontes = fontesDeNumeros(q);
  if (!fontes.length) {
    if (!silencioso) mostrarToast('Nenhuma fonte com números foi publicada ainda — nem informativo ou nota técnica das Consultorias, nem o texto do projeto.', 'aviso');
    return null;
  }
  const lidas = estado.ia?.numeros || {};
  const faltando = fontes.filter(f => !lidas[chaveDocumento(f.url)]);
  if (!faltando.length) { if (!silencioso) mostrarToast('Todas as fontes de números já foram lidas.', 'info'); return lidas; }
  if (!exigirIA()) return null;
  const lote = faltando.slice(0, 3);
  if (!silencioso && !confirm(`Ler ${lote.length} documento(s) com IA?\n\n${lote.map(f => '· ' + f.rotulo).join('\n')}\n\nÉ uma chamada por documento; cada número volta com página e trecho, é conferido contra o texto, e o resultado fica salvo para a equipe toda.`)) return null;
  estado.lote = true;
  try {
    for (let i = 0; i < lote.length; i++) {
      const r = await lerFonteDeNumeros(lote[i]);
      if (r === null) { mostrarToast(`Leitura interrompida em ${i} de ${lote.length} — resolva o erro acima e recomece.`, 'erro'); break; }
    }
  } finally { estado.lote = false; }
  proporFichaDosNumeros();
  render();
  return estado.ia.numeros;
}

/**
 * Os números conferidos, de todas as fontes lidas, sem repetição: para cada
 * indicador vale a primeira fonte na ordem de fontesDeNumeros (a mais curta e
 * mais direta). "Outros" entram todos, deduplicados por rótulo e valor.
 */
function numerosApurados(ia, q) {
  const leituras = ia?.numeros || {};
  const ordem = fontesDeNumeros(q || {}).map(f => chaveDocumento(f.url));
  const chaves = [...ordem.filter(c => leituras[c]), ...Object.keys(leituras).filter(c => !ordem.includes(c))];
  const out = []; const vistos = new Set();
  for (const c of chaves) {
    const l = leituras[c];
    for (const a of (l.apurados || [])) {
      const id = a.chave ? `i:${a.chave}` : `o:${a.rotulo}|${a.valor}`;
      if (vistos.has(id)) continue;
      vistos.add(id);
      out.push({ ...a, fonte: l.rotulo, url: l.url, modoLeitura: l.modoLeitura });
    }
  }
  return out;
}
function achadosApurados(ia) {
  const leituras = ia?.numeros || {};
  const out = []; const vistos = new Set();
  for (const l of Object.values(leituras)) {
    for (const a of (l.achados || [])) {
      const id = compacto(a.afirmacao).slice(0, 60);
      if (vistos.has(id)) continue;
      vistos.add(id);
      out.push({ ...a, fonte: l.rotulo, url: l.url });
    }
  }
  return out;
}

/**
 * Indicador conferido que tem campo na ficha (PIB, IPCA, Selic, câmbio,
 * salário mínimo, reserva para emendas) vira PROPOSTA — o analista aceita, e
 * o valor entra com documento, página e trecho, como se digitado.
 */
function proporFichaDosNumeros() {
  if (!estado.ficha) return;
  const campos = new Map(CAMPOS_FICHA.map(c => [c.chave, c]));
  const novas = [];
  for (const a of numerosApurados(estado.ia, estado.quadro)) {
    if (!a.ficha || !campos.has(a.ficha)) continue;
    if (estado.ficha.valores?.[a.ficha]) continue;
    // Número carimbado com outro exercício não vira proposta: é o valor herdado
    // que a ficha inteira existe para barrar.
    if (a.exercicio && String(a.exercicio) !== String(estado.ano).slice(0, 4)) continue;
    if (estado.propostas?.aceitas?.some(p => p.campo === a.ficha)) continue;
    novas.push({ campo: a.ficha, rotulo: campos.get(a.ficha).rotulo, valor: a.valor, trecho: a.trecho,
                 pagina: a.pagina, documento: a.fonte });
  }
  if (!novas.length) return;
  if (!estado.propostas || !estado.propostas.conferido) {
    estado.propostas = { conferido: true, aceitas: [], recusadas: [], documento: novas[0].documento, url: null,
                         resumo: `${novas.length} campo(s) propostos a partir dos números apurados.` };
  }
  estado.propostas.aceitas.push(...novas);
}

/**
 * O caminho de um clique só: Mensagem → números → ficha → síntese. Cada passo
 * já sabe pular o que não se aplica (LDO sem tabela comparativa, exercício sem
 * orientação normativa, fonte já lida) e declarar o que falhou.
 */
async function apurarTudo() {
  const q = estado.quadro;
  if (!q?.materia?.disponivel) return;
  if (estado.lote || estado.ocupado) { mostrarToast('Já há uma leitura em andamento.', 'aviso'); return; }
  if (!exigirIA()) return;
  const passos = [];
  if (!estado.variacao && q.materia.urlDocumento && estado.tipo === 'loa') passos.push('ler as tabelas comparativas da Mensagem');
  const fontes = fontesDeNumeros(q);
  const faltando = fontes.filter(f => !estado.ia?.numeros?.[chaveDocumento(f.url)]).slice(0, 3);
  if (faltando.length) passos.push(`apurar os números em ${faltando.length} fonte(s)`);
  const pendentes = CAMPOS_FICHA.filter(c => c.origem === 'ancora' && !estado.ficha?.valores?.[c.chave]).length;
  if (q.emendas?.ancoraNormativa && pendentes && !estado.propostas) passos.push('extrair a ficha da orientação normativa');
  passos.push('redigir a síntese');
  if (!confirm(`Apurar tudo com IA — ${passos.join('; ')}. São até ${faltando.length + (passos.length - (faltando.length ? 1 : 0))} chamadas, e o resultado fica salvo para a equipe. Continuar?`)) return;

  if (!estado.variacao && q.materia.urlDocumento && estado.tipo === 'loa') await lerMensagem();
  if (faltando.length) await apurarNumeros({ silencioso: true });
  if (q.emendas?.ancoraNormativa && pendentes && !estado.propostas) await proporFicha();
  await redigirSintese({ silencioso: true });
  mostrarToast('Apuração concluída — revise os cards e gere a nota.', 'sucesso');
}

function cardNumeros() {
  const q = estado.quadro;
  if (!q?.materia?.disponivel) return '';
  const fontes = fontesDeNumeros(q);
  const leituras = Object.values(estado.ia?.numeros || {});
  const lidasUrl = new Set(leituras.map(l => l.url));
  const faltando = fontes.filter(f => !lidasUrl.has(f.url));
  const apurados = numerosApurados(estado.ia, q);
  const achados = achadosApurados(estado.ia);
  const recusados = leituras.flatMap(l => (l.recusados || []).map(r => ({ ...r, fonte: l.rotulo })));
  const comErro = leituras.filter(l => l.erro);
  const travado = estado.ocupado || estado.lote ? 'disabled' : '';

  if (!fontes.length && !leituras.length) {
    return `<div class="on-card largo"><h3>Números do exercício</h3>
      <div class="on-pend">Nenhuma fonte com números foi publicada ainda para este exercício — nem informativo ou nota
      técnica das Consultorias, nem o texto do projeto com a Mensagem Presidencial. Quando uma delas sair, a leitura
      aparece aqui.</div></div>`;
  }

  const grupos = [...new Set(apurados.map(a => a.grupo))];
  const linha = a => `<tr>
    <td class="a"><strong>${esc(a.rotulo)}</strong>${a.exercicio ? ` <span style="font-size:10.5px;color:var(--text-dim)">${esc(a.exercicio)}</span>` : ''}</td>
    <td style="width:26%"><strong>${esc(a.valor)}</strong></td>
    <td style="width:34%;font-size:11px;color:var(--text-dim)" title="${esc(a.trecho || '')}">${esc(a.fonte)}${a.pagina ? `, p. ${esc(a.pagina)}` : ''}</td></tr>`;
  const tabela = grupos.map(g => `<div style="margin-top:8px"><div class="on-rotulo">${esc(g)}</div>
    <table class="on-tab">${apurados.filter(a => a.grupo === g).map(linha).join('')}</table></div>`).join('');

  const botao = faltando.length
    ? `<button class="btn btn-outline btn-sm" data-acao="apurar-numeros" style="margin-left:8px" ${travado}>
         ${leituras.length ? `Ler as ${faltando.length} fonte(s) que faltam` : 'Apurar números com IA'}</button>`
    : '';
  const botaoTudo = !estado.ia?.sintese
    ? `<button class="btn btn-primary btn-sm" data-acao="apurar-tudo" style="margin-left:8px" ${travado}>Apurar tudo e redigir</button>`
    : '';

  return `<div class="on-card largo"><h3>Números do exercício · o que a nota cita</h3>
    <div style="font-size:12.5px;color:var(--text-dim);line-height:1.6">
      ${leituras.length} de ${fontes.length} fonte(s) lida(s) · ${apurados.length} número(s) e ${achados.length} achado(s) conferidos contra o texto dos documentos.
      ${botao}${botaoTudo}
    </div>
    ${apurados.length ? tabela : ''}
    ${achados.length ? `<div style="margin-top:10px"><div class="on-rotulo">Destaques apontados nas fontes</div>
      <ul class="on-lista">${achados.map(a => `<li>${a.tema ? `<strong>${esc(a.tema)}:</strong> ` : ''}${esc(a.afirmacao)}
        <span style="font-size:11px;color:var(--text-dim)" title="${esc(a.trecho || '')}">(${esc(a.fonte)}${a.pagina ? `, p. ${esc(a.pagina)}` : ''})</span></li>`).join('')}</ul></div>` : ''}
    ${recusados.length ? `<div class="on-falha"><strong>${recusados.length} item(ns) descartado(s) na conferência</strong> — o modelo os produziu, mas não foram
      localizados no documento e por isso NÃO entram na nota:
      <ul class="on-lista" style="margin-top:5px">${recusados.slice(0, 8).map(r => `<li>${esc(r.chave)}${r.valor ? ` (${esc(String(r.valor).slice(0, 60))})` : ''} — ${esc(r.motivo)}</li>`).join('')}</ul></div>` : ''}
    ${comErro.length ? `<div class="on-pend">${comErro.map(l => `${esc(l.rotulo)}: ${esc(l.erro)}`).join('<br>')}</div>` : ''}
    ${avisoModoLeitura(leituras)}
    ${!leituras.length ? `<div class="on-pend">As fontes já estão localizadas — ${fontes.map(f => esc(f.rotulo)).join('; ')} — mas os números só existem
      dentro dos PDFs. A leitura é feita por IA e cada número volta com página e trecho literal, conferidos contra o texto do próprio documento.</div>`
      : faltando.length ? `<div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">Ainda não lidas: ${faltando.map(f => esc(f.rotulo)).join('; ')}.</div>` : ''}
    <div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">
      Cada número exibido teve o trecho de origem localizado no documento e o valor localizado dentro do trecho.
      Localizar não é interpretar: a leitura do que o número significa continua sendo do analista.
    </div>
  </div>`;
}

/**
 * Os números na nota — a tabela que o gabinete lê antes de qualquer prosa, com
 * a fonte e a página ao lado de cada um; depois, os destaques que as fontes
 * registram. Só entra o conferido.
 */
function blocoNumerosNota(apurados = [], achados = []) {
  if (!apurados.length && !achados.length) return '';
  const grupos = [...new Set(apurados.map(a => a.grupo))];
  const linha = a => `<tr><td class="r">${esc(a.rotulo)}</td><td class="num" style="text-align:left"><strong>${esc(a.valor)}</strong>${a.exercicio ? ` <span style="font-size:9pt;color:#555">(${esc(a.exercicio)})</span>` : ''}</td>
    <td style="width:34%;font-size:9pt;color:#555">${esc(a.fonte)}${a.pagina ? `, p. ${esc(a.pagina)}` : ''}</td></tr>`;
  const fontes = [...new Set([...apurados, ...achados].map(a => a.fonte).filter(Boolean))];
  return `<h2>Números do exercício</h2>
${apurados.length ? grupos.map(g => `<p><strong>${esc(g)}</strong></p><table>${apurados.filter(a => a.grupo === g).map(linha).join('')}</table>`).join('\n') : ''}
${achados.length ? `<p><strong>Destaques registrados nas fontes</strong></p>
<ul>${achados.map(a => `<li>${a.tema ? `<strong>${esc(a.tema)}:</strong> ` : ''}${esc(a.afirmacao)} <span style="font-size:9pt;color:#555">(${esc(a.fonte)}${a.pagina ? `, p. ${esc(a.pagina)}` : ''})</span></li>`).join('')}</ul>` : ''}
<div class="fonte">Fontes: ${esc(fontes.join('; '))}. Cada número foi extraído com apoio de inteligência artificial e
teve o trecho de origem localizado no texto do próprio documento; o que não foi localizado não consta deste quadro.</div>`;
}

// ---------- produto 3: a síntese analítica ----------
/**
 * Redige o texto da nota a partir dos números JÁ conferidos, e depois confere
 * cada número escrito contra essa mesma base. O risco fica invertido: a IA não
 * extrai nada, só redige — e o que ela inventar aparece marcado.
 */
async function redigirSintese({ silencioso = false } = {}) {
  const q = estado.quadro;
  if (!q?.materia?.disponivel) return;
  if (!exigirIA()) return;
  const base = { variacao: estado.variacao, serie: estado.serie ? seriesComDados(estado.serie) : [],
                 ficha: estado.ficha, quadro: q, numeros: numerosApurados(estado.ia, q), achados: achadosApurados(estado.ia) };
  const temDado = (estado.variacao?.comparado) || base.serie.length || Object.keys(estado.ficha?.valores || {}).length
    || base.numeros.length || base.achados.length;
  if (!temDado && !silencioso && !confirm('Nenhum número foi apurado ainda (nem variação, nem série, nem ficha, nem os números das fontes). A síntese sairá só com o estágio da tramitação. Continuar?')) return;

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
        <button class="btn btn-primary btn-sm" data-acao="apurar-tudo" style="margin-left:4px" ${estado.ocupado || estado.lote ? 'disabled' : ''} title="Lê a Mensagem, apura os números nas fontes publicadas, propõe a ficha e redige a síntese — de uma vez">Apurar tudo e redigir</button>
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

/** Abre a nota em aba própria. `imprimir` já dispara o diálogo de PDF. */
function gerarNota({ imprimir = false } = {}) {
  const q = estado.quadro;
  if (!q?.materia?.disponivel) return;
  if (!numerosApurados(estado.ia, q).length && !estado.ia?.sintese && !estado.variacao?.comparado) {
    mostrarToast('A nota sai sem números apurados. Use "Apurar tudo e redigir" para preenchê-la com as fontes publicadas.', 'aviso');
  }
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a nova aba. Permita pop-ups para gerar a nota.'); return; }
  w.document.write(htmlNota(q, estado.conferencia, estado.ficha, estado.serie, estado.variacao, estado.ia));
  w.document.close();
  // A aba herda a CSP da extensão (script-src 'self'): script inline na nota
  // não roda. Os botões são ligados DAQUI, que é a mesma origem.
  const ligar = () => {
    w.document.getElementById('btn-pdf')?.addEventListener('click', () => w.print());
    if (imprimir) setTimeout(() => w.print(), 400);   // dá tempo de o logo carregar
  };
  if (w.document.readyState === 'complete') ligar(); else w.addEventListener('load', ligar);
}

// ============================================================
//  GRÁFICOS DA NOTA — SVG estático, sem biblioteca
// ============================================================
// A nota é documento impresso e vai por WhatsApp: gráfico aqui é SVG inline,
// que imprime e sobrevive ao "Salvar como PDF" sem depender de script (a aba
// da nota herda a CSP da extensão e não roda script inline). Regras que valem
// para todos: barra fina (≤ 20px) com a ponta arredondada e a base reta, valor
// escrito na ponta, texto sempre em tinta (nunca na cor da série), uma cor por
// gráfico — magnitude em verde; alta × queda em verde × laranja, cada uma no
// seu gráfico, com o título dizendo o que é.
const COR_NOTA = { verde: '#0B8A4B', laranja: '#D9531E', azul: '#1F5FA8', tinta: '#1b1b1b', tinta2: '#52514e', grade: '#e4e4e0', superficie: '#fcfcfb' };

/** "R$ 1.234,5 milhões" curto para a ponta da barra. */
function rotuloValorNota(n, unidade = '') {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const txt = abs >= 1000 ? Number(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi'
            : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + (unidade ? ' ' + unidade : '');
  return txt;
}

/**
 * Barras horizontais, uma série. `itens` = [{ rotulo, valor, texto? }].
 * Largura fixa em 640 (cabe na coluna A4); a barra mais longa ocupa a pista.
 */
function svgBarrasH(itens = [], { cor = COR_NOTA.verde, largura = 640, rotuloValor = null, maxItens = 10 } = {}) {
  const dados = itens.slice(0, maxItens).map(i => ({ ...i, v: Math.abs(Number(i.valor) || 0) }));
  if (!dados.length) return '';
  const alturaLinha = 26, colRotulo = 230, colValor = 84, esp = 20, r = 4;
  const max = Math.max(...dados.map(d => d.v)) || 1;
  const pista = largura - colRotulo - colValor - 12;
  const altura = dados.length * alturaLinha + 8;
  const corta = s => { const t = String(s || ''); return t.length > 38 ? t.slice(0, 36).replace(/\s+\S*$/, '') + '…' : t; };
  const linhas = dados.map((d, i) => {
    const y = 4 + i * alturaLinha, w = Math.max(2, Math.round(pista * d.v / max));
    const x0 = colRotulo, x1 = colRotulo + w, y0 = y + (alturaLinha - esp) / 2, y1 = y0 + esp;
    const rr = Math.min(r, w / 2);
    const barra = `M${x0} ${y0} H${x1 - rr} A${rr} ${rr} 0 0 1 ${x1} ${y0 + rr} V${y1 - rr} A${rr} ${rr} 0 0 1 ${x1 - rr} ${y1} H${x0} Z`;
    const valor = rotuloValor ? rotuloValor(d) : (d.texto || rotuloValorNota(d.valor));
    return `<title>${esc(d.rotulo)}: ${esc(valor)}</title>
      <text x="${colRotulo - 8}" y="${y + alturaLinha / 2 + 4}" text-anchor="end" font-size="11" fill="${COR_NOTA.tinta2}">${esc(corta(d.rotulo))}</text>
      <path d="${barra}" fill="${cor}"/>
      <text x="${x1 + 6}" y="${y + alturaLinha / 2 + 4}" font-size="11" font-weight="600" fill="${COR_NOTA.tinta}">${esc(valor)}</text>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${largura} ${altura}" width="100%" role="img" aria-label="gráfico de barras">
    <line x1="${colRotulo}" y1="2" x2="${colRotulo}" y2="${altura - 2}" stroke="${COR_NOTA.grade}" stroke-width="1"/>${linhas}</svg>`;
}

/**
 * Colunas por exercício, uma série — a série histórica de um parâmetro.
 * `pontos` = [{ ano, valor, texto }].
 */
function svgColunas(pontos = [], { cor = COR_NOTA.verde, largura = 300, altura = 130 } = {}) {
  const dados = pontos.filter(p => Number.isFinite(Number(p.valor)));
  if (dados.length < 2) return '';
  const max = Math.max(...dados.map(p => Number(p.valor))) || 1;
  const base = altura - 22, topo = 22, r = 4;
  const passo = largura / dados.length, esp = Math.min(24, passo * 0.5);
  const cols = dados.map((p, i) => {
    const h = Math.max(2, Math.round((base - topo) * Number(p.valor) / max));
    const x0 = Math.round(i * passo + (passo - esp) / 2), y0 = base - h, x1 = x0 + esp;
    const rr = Math.min(r, esp / 2, h / 2);
    const col = `M${x0} ${base} V${y0 + rr} A${rr} ${rr} 0 0 1 ${x0 + rr} ${y0} H${x1 - rr} A${rr} ${rr} 0 0 1 ${x1} ${y0 + rr} V${base} Z`;
    const valor = String(p.texto || p.valor).replace(/^R\$\s*/, '').replace(/,00$/, '');
    return `<title>${esc(p.ano)}: ${esc(p.texto || p.valor)}</title>
      <path d="${col}" fill="${cor}"/>
      <text x="${x0 + esp / 2}" y="${y0 - 5}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${COR_NOTA.tinta}">${esc(valor.length > 14 ? rotuloValorNota(Number(p.valor)) : valor)}</text>
      <text x="${x0 + esp / 2}" y="${base + 14}" text-anchor="middle" font-size="10" fill="${COR_NOTA.tinta2}">${esc(p.ano)}</text>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${largura} ${altura}" width="${largura}" role="img" aria-label="série histórica">
    <line x1="0" y1="${base}" x2="${largura}" y2="${base}" stroke="${COR_NOTA.grade}" stroke-width="1"/>${cols}</svg>`;
}

/**
 * Os destaques em cartões — o que a primeira dobra da nota mostra. Vêm dos
 * números apurados, na ordem em que um deputado pergunta: quanto gasta, quanto
 * arrecada, qual a meta, quanto há para emendas, quanto é o salário mínimo.
 */
const ORDEM_DESTAQUES = ['despesa_total', 'receita_total', 'resultado_primario', 'limite_despesa', 'reserva_emendas_total',
  'cota_individual', 'salario_minimo', 'despesas_discricionarias', 'investimentos', 'pib', 'ipca', 'minimo_saude', 'minimo_educacao'];
function cartoesDestaqueNota(apurados = [], q = {}, max = 7) {
  const porChave = new Map(apurados.filter(a => a.chave).map(a => [a.chave, a]));
  const escolhidos = ORDEM_DESTAQUES.map(c => porChave.get(c)).filter(Boolean).slice(0, max);
  const cartao = (rotulo, valor, fonte, classe = '') => `<div class="cartao ${classe}">
    <div class="cartao-rotulo">${esc(rotulo)}</div><div class="cartao-valor${String(valor).length > 22 ? ' longo' : ''}">${esc(valor)}</div>${fonte ? `<div class="cartao-fonte">${esc(fonte)}</div>` : ''}</div>`;
  const cartoes = escolhidos.map(a => cartao(a.rotulo.replace(/\s*\(.*\)$/, ''), a.valor, `${a.fonte || ''}${a.pagina ? `, p. ${a.pagina}` : ''}${a.exercicio ? ` · ${a.exercicio}` : ''}`));
  // O prazo de emendas é sempre um cartão: com a data, ou dizendo que não há.
  const p = q.cronograma?.disponivel ? q.cronograma.prazoEmendas : null;
  if (p) {
    const dias = diasAte(p.fim);
    const situacao = dias === null ? '' : dias < 0 ? 'encerrado' : dias === 0 ? 'encerra hoje' : `faltam ${dias} dia(s)`;
    cartoes.push(cartao('Prazo de emendas', `${p.inicio} a ${p.fim}`, situacao, dias !== null && dias >= 0 ? 'cartao--laranja' : 'cartao--cinza'));
  } else {
    cartoes.push(cartao('Prazo de emendas', 'não fixado', 'cronograma ainda não publicado', 'cartao--cinza'));
  }
  return `<div class="cartoes">${cartoes.join('')}</div>`;
}

/** As etapas da tramitação como passos, com o estado escrito ao lado da cor. */
function passosEtapasNota(etapas = []) {
  const classe = e => /andamento/i.test(e.estado || '') ? 'passo--andamento' : /conclu|encerr|realiz/i.test(e.estado || '') ? 'passo--feito' : 'passo--espera';
  return `<ol class="passos">${etapas.map((e, i) => `<li class="passo ${classe(e)}"><span class="passo-n">${i + 1}</span>
    <span class="passo-nome">${esc(e.nome)}</span><span class="passo-estado">${esc(e.estado || '—')}</span></li>`).join('')}</ol>`;
}

function htmlNota(q, conf, ficha, serie, variacao, ia) {
  const m = q.materia, r = q.relatores, c = q.cronograma, a = q.acompanhamento, e = q.emendas;
  const agora = new Date();
  const carimbo = `${String(agora.getDate()).padStart(2, '0')}/${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()} ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  const legislatura = legislaturaDe(agora.getFullYear());
  const nome = p => p ? `${p.casa === 'Senado' ? 'Sen.' : 'Dep.'} ${esc(p.nome)} (${esc(p.partido)}/${esc(p.uf)})` : '<span class="nd">Ainda não designado</span>';
  const logo = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ? chrome.runtime.getURL('icons/podemos-logo.png') : 'icons/podemos-logo.png';

  // As pendências são o miolo da nota enquanto a CMO não avança. Elas saem
  // do estado REAL de cada fonte, não de uma lista fixa.
  // Pendência é o que a CMO AINDA NÃO fez; fonte que o portal não publica é
  // outra coisa e não entra aqui. A LDO, por exemplo, não tem página de
  // relatores nenhuma — dizer "designação pendente" seria inventar um atraso
  // que não existe. A MESMA lista que vai no prompt da síntese (pendenciasDo).
  const pendencias = pendenciasDo(q);

  // Exercício concluído: a tramitação vira uma frase e o cronograma vencido sai
  // da nota. Enquanto ele corre, os dois são o que o gabinete acompanha.
  const concluida = a.disponivel && a.etapas.length > 0
    && a.etapas.every(et => /encerrad/i.test(et.estado || ''));

  const alertas = conf ? resumoConferencia(conf.resultado) : null;
  const apurados = numerosApurados(ia, q);
  const achados = achadosApurados(ia);

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Nota Técnica — ${esc(m.apelido)}</title>
<style>
  /* Paleta: verde da casa para magnitude, laranja para queda/alerta, azul para
     títulos. Validada para daltonismo (verde × laranja ΔE 6,8 protan, com
     rótulo escrito ao lado de cada barra — a cor nunca carrega sozinha). */
  :root { --verde:#0B8A4B; --verde-esc:#003c1f; --laranja:#D9531E; --azul:#1F5FA8; --tinta:#1b1b1b; --tinta2:#52514e;
          --grade:#e4e4e0; --sup:#fcfcfb; --sup2:#f2f6f3; --ambar-bg:#fff7ea; --ambar:#b45309; }
  @page { size: A4; margin: 16mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: var(--tinta); margin: 0; background: #fff; }
  .folha { max-width: 190mm; margin: 0 auto; padding: 0 0 20px; }
  .cab { display: flex; align-items: center; gap: 16px; padding: 6px 0 10px; }
  .cab img { height: 44px; }
  .cab .tit { flex: 1; }
  .cab .kicker { font-size: 9pt; letter-spacing: 2px; text-transform: uppercase; color: var(--tinta2); }
  .cab h1 { font-size: 26pt; font-weight: 700; margin: 0; line-height: 1.1; color: var(--verde-esc); }
  .cab .sub { font-size: 10pt; color: var(--tinta2); margin-top: 2px; }
  .cab .meta { text-align: right; font-size: 8.5pt; color: var(--tinta2); line-height: 1.4; }
  .filete { height: 5px; margin: 0 0 14px; border-radius: 3px;
    background: linear-gradient(90deg, var(--verde) 0 40%, #7C9A2F 40% 62%, var(--azul) 62% 82%, var(--laranja) 82% 100%); }
  h2 { font-size: 12.5pt; color: var(--verde-esc); margin: 20px 0 8px; padding: 0 0 4px; border-bottom: 2px solid var(--verde);
       display: flex; align-items: baseline; gap: 8px; page-break-after: avoid; break-after: avoid; }
  h2 .un { font-size: 8.5pt; font-weight: 400; color: var(--tinta2); }
  p { margin: 6px 0; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; page-break-inside: auto; }
  td, th { padding: 4px 7px; vertical-align: top; border-bottom: 1px solid var(--grade); font-size: 9.5pt; text-align: left; }
  tr:nth-child(even) td { background: #f7f8f6; }
  td.r { width: 28%; font-weight: 600; color: var(--verde-esc); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nd { color: var(--ambar); font-weight: 600; }
  .pend { background: var(--ambar-bg); border-left: 4px solid #e9a23b; padding: 8px 12px; margin: 8px 0; font-size: 9.5pt; border-radius: 0 6px 6px 0; }
  .conf { background: var(--sup2); border-left: 4px solid var(--verde); padding: 8px 12px; margin: 8px 0; font-size: 9.5pt; border-radius: 0 6px 6px 0; }
  ul { margin: 4px 0 0; padding-left: 18px; font-size: 9.5pt; } li { margin-bottom: 3px; }
  .fonte { font-size: 8pt; color: var(--tinta2); font-style: italic; margin-top: 4px; }
  .rodape { margin-top: 26px; border-top: 1px solid var(--grade); padding-top: 6px; text-align: center; font-size: 8pt; color: var(--tinta2); }
  /* cartões de destaque */
  .cartoes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0 4px; }
  .cartao { border: 1px solid var(--grade); border-top: 4px solid var(--verde); border-radius: 8px; padding: 8px 10px 7px; background: #fff; page-break-inside: avoid; break-inside: avoid; }
  .cartao--laranja { border-top-color: var(--laranja); }
  .cartao--cinza { border-top-color: #9aa1a9; }
  .cartao-rotulo { font-size: 8.5pt; color: var(--tinta2); line-height: 1.25; min-height: 22px; }
  .cartao-valor { font-size: 13.5pt; font-weight: 700; color: var(--tinta); margin-top: 2px; line-height: 1.15; word-break: break-word; }
  .cartao-valor.longo { font-size: 10.5pt; }
  .cartao-fonte { font-size: 7.5pt; color: var(--tinta2); margin-top: 3px; }
  /* gráficos */
  .grafico { display: block; margin: 4px 0 6px; font-family: inherit; }
  .duas { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .duas > div { min-width: 0; }
  .g-tit { font-size: 9.5pt; font-weight: 600; color: var(--tinta); margin: 8px 0 0; display: flex; align-items: center; gap: 6px; }
  .g-tit .sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .series { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 20px; }
  .serie { page-break-inside: avoid; break-inside: avoid; }
  .serie .g-tit { margin-top: 4px; }
  .serie .fonte { margin-top: 0; }
  /* passos da tramitação */
  .passos { list-style: none; margin: 4px 0; padding: 0; columns: 2; column-gap: 24px; font-size: 9.5pt; }
  .passo { display: flex; align-items: center; gap: 8px; padding: 3px 0; break-inside: avoid; }
  .passo-n { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 8pt; font-weight: 700; flex-shrink: 0;
             border: 2px solid #b8bec4; color: var(--tinta2); }
  .passo--feito .passo-n { background: var(--verde); border-color: var(--verde); color: #fff; }
  .passo--andamento .passo-n { background: var(--laranja); border-color: var(--laranja); color: #fff; }
  .passo-nome { flex: 1; }
  .passo-estado { font-size: 8pt; color: var(--tinta2); white-space: nowrap; }
  .passo--andamento .passo-estado { color: var(--laranja); font-weight: 600; }
  .sintese p { font-size: 10.5pt; }
  .barra-ferramentas { background: #eef3fb; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; display: flex; align-items: center; gap: 10px; border-radius: 6px; }
  .barra-ferramentas button { background: var(--verde); color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .barra-ferramentas button:hover { background: #086e3b; }
  @media print { .noprint { display: none !important; } .folha { max-width: none; } }
</style></head><body><div class="folha">
<div class="barra-ferramentas noprint">
  <button id="btn-pdf" type="button">⬇ Salvar em PDF</button>
  <span>No diálogo, escolha o destino <strong>Salvar como PDF</strong>. As cores e os gráficos vão junto.</span>
</div>

<div class="cab">
  <img src="${logo}" alt="">
  <div class="tit">
    <div class="kicker">NOTA TÉCNICA · ${legislatura}ª Legislatura</div>
    <h1>${esc(m.apelido)}</h1>
    <div class="sub">${esc(m.identificacao)}${m.dataApresentacao ? ` · apresentado em ${dataBR(m.dataApresentacao)}` : ''} · situação: <strong>${esc(m.situacaoAtual || '—')}</strong></div>
  </div>
  <div class="meta">Coordenação de Orçamento<br>Liderança do Podemos<br>Atualizada em ${carimbo}</div>
</div>
<div class="filete"></div>

${cartoesDestaqueNota(apurados, q)}

<p>A presente nota técnica trata do <strong>${esc(m.identificacao)} — ${esc(m.apelido)}</strong>${m.dataApresentacao ? `, apresentado ao Congresso Nacional em ${dataBR(m.dataApresentacao)}` : ''}.
Situação em ${carimbo.slice(0, 10)}: <strong>${esc(m.situacaoAtual || '—')}</strong>.
${pendencias.length ? 'A matéria ainda não percorreu todas as etapas na Comissão Mista, e por isso parte dos parâmetros operacionais não está definida — o que está e o que não está vem discriminado adiante.' : ''}</p>

${blocoSinteseNota(ia?.sintese)}
${blocoNumerosNota(apurados, achados)}

${/* A ORDEM É O CONTEÚDO: quem lê a primeira página sai sabendo quanto tem,
      até quando, o que mudou e onde está o documento que decide. Processo e
      anexos vão depois. */''}
${blocoVariacaoNota(variacao)}
${blocoFichaNota(q, ficha)}
${blocoSerieNota(serie)}

<h2>Prazo de emendas</h2>
${c.disponivel && c.prazoEmendas
  ? `<p>O cronograma aprovado pela Comissão Mista fixa a apresentação de emendas ao projeto entre
     <strong>${esc(c.prazoEmendas.inicio)}</strong> e <strong>${esc(c.prazoEmendas.fim)}</strong>${concluida ? ', prazo já encerrado' : ''}.</p>`
  : `<div class="pend">${esc(c.motivo || 'Cronograma não disponível.')} Sem cronograma aprovado não há prazo fixado, e ele não se deduz do exercício anterior.</div>`}

${blocoDecisivosNota(q)}
${blocoAcoesNota(ia)}

${pendencias.length ? `<h2>O que ainda não está definido</h2>
<div class="pend">Nesta data, os itens abaixo não foram publicados pela Comissão Mista. Nenhum deles pode ser
antecipado a partir de exercícios anteriores: são fixados a cada ano, e o regime de emendas muda entre eles.
<ul>${pendencias.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}

${e.disponivel && e.ancoraNormativa ? `<h2>Base normativa do exercício</h2>
<p>Os parâmetros operacionais das emendas deste exercício constam do
<strong>${esc(e.ancoraNormativa.rotulo)}</strong>, publicado pela Comissão Mista, que é a referência a ser consultada
para cotas, quantidades, sequenciais de cancelamento e pisos de repasse.</p>
${alertas ? `<div class="conf"><strong>Conferência automática contra o Manual:</strong><br>${alertas.map(esc).join('<br>')}
<br><span style="font-size:8.5pt">A conferência indica apenas se a norma ou o valor citado consta do documento do exercício; constar não significa que o dispositivo siga aplicável ao mesmo caso.</span></div>` : ''}` : ''}

<h2>Identificação da matéria</h2>
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

${a.disponivel ? `<h2>Estágio da tramitação</h2>
${/* Dez linhas de "Encerrada" não são informação. Num exercício concluído a
     tramitação cabe numa frase; enquanto ele corre, os passos mostram onde a
     matéria parou — com o estado escrito, não só na cor. */''}
${concluida
  ? `<p>As dez etapas da tramitação na Comissão Mista estão encerradas${a.ultimoEstado ? `; o último estado registrado é de ${esc(a.ultimoEstado.data)} — ${esc(a.ultimoEstado.descricao)}` : ''}.</p>`
  : `${passosEtapasNota(a.etapas)}
     ${a.ultimoEstado ? `<div class="fonte">Último estado: ${esc(a.ultimoEstado.data)} — ${esc(a.ultimoEstado.descricao)}.</div>` : ''}`}` : ''}

${c.disponivel && c.itens.length && !concluida ? `<h2>Cronograma da Comissão Mista</h2>
<table>${c.itens.map(i => { const ehPrazo = c.prazoEmendas && i.ordem === c.prazoEmendas.ordem; return `<tr${ehPrazo ? ' style="font-weight:600"' : ''}><td class="r" style="width:8%">${i.ordem}.</td><td>${esc(i.descricao)}${ehPrazo ? ' <span class="nd">◆ prazo de emendas</span>' : ''}</td><td class="num" style="width:30%">${esc(i.inicio)} a ${esc(i.fim)}${i.observacao ? ` (${esc(i.observacao)})` : ''}</td></tr>`; }).join('')}</table>` : ''}

${q.executivo && q.executivo.disponivel ? `<h2>Documentos do Poder Executivo</h2>
<p>O conteúdo do orçamento — alocação por órgão, parâmetros adotados e o que muda em relação à lei vigente —
está nos documentos publicados pelo Ministério do Planejamento${m.urlDocumento ? `, e a <strong>Mensagem Presidencial</strong> integra o PDF do próprio ${esc(m.identificacao)}, em suas páginas iniciais` : ''}.</p>
<table>${q.executivo.documentos.slice(0, 14).map(d => `<tr><td class="r">${esc(d.rotulo)}</td><td style="font-size:8.5pt;color:#555;word-break:break-all">${esc(d.url)}</td></tr>`).join('')}</table>` : ''}
${q.alteracoes && q.alteracoes.disponivel ? `<h2>Alterações ao texto do PPA</h2>
<p>O plano em vigor é a <strong>${esc(q.alteracoes.leiDoPlano || 'lei do PPA')}</strong>. Ao longo do quadriênio, o Poder
Executivo encaminha projetos que o alteram; são eles que tramitam, e não o plano original.</p>
<table>${q.alteracoes.alteracoes.map(x => `<tr><td class="r">${esc(x.projeto)}</td><td>${esc(x.ementa || '')}</td><td style="width:22%;text-align:right">${esc(x.situacao || '—')}${x.normaGerada ? `<br>${esc(x.normaGerada)}` : ''}</td></tr>`).join('')}</table>
${q.alteracoes.emTramitacao.length ? `<div class="pend">Em tramitação nesta data: <strong>${q.alteracoes.emTramitacao.map(x => esc(x.projeto)).join(', ')}</strong>.</div>` : ''}` : ''}

<div class="rodape">Coordenação de Orçamento da Liderança do Podemos na Câmara dos Deputados · nota gerada pelo SisPode em ${carimbo}</div>
</div></body></html>`;
}

/**
 * A ficha na nota. Mostra o que está preenchido COM a procedência, e nomeia o
 * que falta — a lacuna declarada vale mais que a linha omitida, porque o
 * gabinete precisa saber que aquele número ainda não existe.
 */
function blocoFichaNota(q, ficha) {
  if (!ficha) return '';
  const linhas = estadoDaFicha(ficha, fontesDoExercicio(q));
  const comValor = linhas.filter(l => l.valor);
  const semValor = linhas.filter(l => !l.valor);
  if (!comValor.length && !semValor.length) return '';

  const linhaHtml = l => `<tr>
    <td class="r">${esc(l.rotulo)}</td>
    <td><strong>${esc(l.valor)}</strong>${l.estado === 'divergente' ? ' <span class="nd">⚠ não localizado na fonte</span>' : ''}</td>
    <td style="width:32%;font-size:9pt;color:#555">${esc(l.documento || '')}${l.pagina ? `, p. ${esc(l.pagina)}` : ''}</td>
  </tr>`;

  const aguardando = semValor.filter(l => l.estado === 'aguardando');
  const aPreencher = semValor.filter(l => l.estado === 'pendente');

  return `<h2>Parâmetros do exercício</h2>
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
 * Cada série vira colunas por exercício, com o valor no topo e a frase embaixo.
 */
function blocoSerieNota(serie) {
  const comDados = serie ? seriesComDados(serie) : [];
  if (!comDados.length) return '';
  return `<h2>Evolução entre exercícios</h2>
<div class="series">${comDados.map(s => `<div class="serie">
  <div class="g-tit"><span class="sw" style="background:${COR_NOTA.verde}"></span>${esc(s.rotulo)}</div>
  ${svgColunas(s.pontos, { cor: COR_NOTA.verde })}
  <div class="fonte">${esc(frasSerie(s).replace(s.rotulo + ': ', ''))}</div></div>`).join('')}</div>
<div class="fonte">Cada ponto vem da ficha do respectivo exercício, com documento de origem registrado.
Exercícios sem ficha aparecem como lacuna — nenhum valor é interpolado.</div>`;
}

/** "O que subiu e o que caiu" — a parte que vai à tribuna, em barras. */
function blocoVariacaoNota(v) {
  if (!v || v.erro || !v.comparado) return '';
  const pct = i => `${i.pct >= 0 ? '+' : '−'}${Math.abs(i.pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  // O rótulo remontado das linhas da tabela pode arrastar o cabeçalho da página
  // seguinte ("Mensagem Presidencial | Projeto de Lei… Capítulo 3 …"): corta-se
  // ali, e o que sobra é a rubrica.
  const limpo = r => String(r || '').replace(/\s*\[\[PAGINA.*$/i, '').replace(/\s*Mensagem Presidencial\s*\|.*$/i, '').trim();
  const itensPct = lista => lista.slice(0, 8).map(i => ({ rotulo: limpo(i.rotulo).replace(/^[IVXLC]+(?:\.\d+)*\.?\s*/, ''), valor: i.pct, texto: `${pct(i)} · ${formatarBR(i.para)}` }));
  const linha = i => `<tr><td class="r">${esc(limpo(i.rotulo))}</td>
    <td class="num">${esc(formatarBR(i.de))} → <strong>${esc(formatarBR(i.para))}</strong></td>
    <td class="num" style="width:16%">${pct(i)}</td></tr>`;
  return `<h2>O que muda em relação ao exercício anterior <span class="un">R$ milhões</span></h2>
<p>Comparação entre <strong>${esc(v.de)}</strong> e <strong>${esc(v.para)}</strong>, extraída da ${esc(v.fonte)}. As barras mostram a variação percentual; o valor ao lado é o de ${esc(v.para)}.</p>
<div class="duas">
  ${v.maioresAltas.length ? `<div><div class="g-tit"><span class="sw" style="background:${COR_NOTA.verde}"></span>Maiores altas</div>${svgBarrasH(itensPct(v.maioresAltas), { cor: COR_NOTA.verde, largura: 420, rotuloValor: d => d.texto })}</div>` : ''}
  ${v.maioresQuedas.length ? `<div><div class="g-tit"><span class="sw" style="background:${COR_NOTA.laranja}"></span>Maiores quedas</div>${svgBarrasH(itensPct(v.maioresQuedas), { cor: COR_NOTA.laranja, largura: 420, rotuloValor: d => d.texto })}</div>` : ''}
</div>
${v.porOrgao ? `<div class="g-tit" style="margin-top:10px"><span class="sw" style="background:${COR_NOTA.verde}"></span>Por órgão — ${esc(v.porOrgao.titulo || 'distribuição')} <span class="un" style="font-weight:400;color:var(--tinta2)">R$ milhões · os ${Math.min(12, v.porOrgao.linhas.length)} maiores</span></div>
${svgBarrasH(v.porOrgao.linhas.slice().sort((x, y) => y.valor - x.valor).slice(0, 12).map(l => ({ rotulo: l.orgao, valor: l.valor, texto: formatarBR(l.valor) })), { cor: COR_NOTA.verde, maxItens: 12 })}
<table>${v.porOrgao.linhas.map(l => `<tr><td class="r">${esc(l.codigo)}</td><td>${esc(l.orgao)}</td><td class="num">${esc(formatarBR(l.valor))}</td></tr>`).join('')}</table>
<div class="fonte">${v.porOrgao.confere
  ? `Leitura conferida contra o total impresso no documento (${esc(formatarBR(v.porOrgao.total))}): a tabela está completa.`
  : esc(v.porOrgao.motivo)}</div>` : ''}
${(v.maioresAltas.length || v.maioresQuedas.length) ? `<table>${[...v.maioresAltas.slice(0, 8), ...v.maioresQuedas.slice(0, 8)].map(linha).join('')}</table>` : ''}`;
}

/**
 * OS DOCUMENTOS QUE DECIDEM.
 *
 * Esta seção nasceu de uma constatação simples: a nota da LOA 2026 — exercício
 * já encerrado, virou a Lei 15.346/2026 — saía com 6.900 caracteres em que o
 * único número substantivo era uma data de 2025. Enquanto isso, o módulo lia
 * 210 documentos da tramitação e não mostrava nenhum na nota, entre eles o
 * RELATÓRIO GERAL da CMO (onde estão os números finais), os 16 RELATÓRIOS
 * SETORIAIS por área temática e o RELATÓRIO DE DISTRIBUIÇÃO DOS RECURSOS POR
 * BANCADA — que é quanto cada bancada estadual recebeu.
 *
 * O gabinete não precisa que a nota repita o que está no Google. Precisa que
 * ela aponte, com nome e link, o documento que responde à pergunta dele.
 */
function blocoDecisivosNota(q) {
  const a = q.acompanhamento;
  if (!a?.disponivel) return '';
  const geral = a.relatorioGeral, dist = a.distribuicaoBancadas || [], set = a.relatoriosSetoriais || [];
  const outros = (a.documentos || []).filter(d =>
    ['autografo', 'quadro_comparativo', 'nota_tecnica', 'relatorio_legislativo'].includes(d.classe));
  if (!geral && !dist.length && !set.length && !outros.length) return '';

  // As áreas relatadas pela bancada primeiro: é onde o acesso existe.
  const daBancada = new Set((q.relatores?.setoriais || [])
    .filter(s => SIGLA_PODE.test(s.partido || ''))
    .map(s => partesDaArea(s.area).nome.toLowerCase()));
  const ehDaBancada = d => daBancada.has(String(d.area || '').toLowerCase());
  // O portal republica versões do mesmo setorial (complementação, retificação):
  // uma linha por ÁREA, com o documento mais recente, que é o primeiro da lista.
  const porArea = [];
  for (const d of set) if (!porArea.some(x => x.area === d.area)) porArea.push(d);
  porArea.sort((x, y) => (ehDaBancada(y) - ehDaBancada(x)) || String(x.area).localeCompare(String(y.area), 'pt-BR'));

  const linha = (rot, d, destaque) => `<tr><td class="r">${esc(rot)}</td>
    <td>${destaque ? '<strong>' : ''}${esc(d.rotulo)}${destaque ? '</strong>' : ''}
      <div style="font-size:8.5pt;color:#555;word-break:break-all">${esc(d.url)}</div></td></tr>`;

  return `<h2>Onde estão os números — documentos decisivos da tramitação</h2>
<p>Os valores finais do exercício não estão nesta nota: estão nos relatórios abaixo, publicados pela Comissão
Mista. Esta seção existe para levar o gabinete direto a eles, em vez de percorrer os
${a.documentos.length + (a.documentosOmitidos || 0)} documentos da tramitação.</p>
<table>
  ${geral ? linha('Relatório Geral', geral, true) : ''}
  ${dist.map(d => linha('Distribuição por bancada', d, true)).join('')}
  ${outros.map(d => linha(({ autografo: 'Autógrafo', quadro_comparativo: 'Quadro comparativo',
      nota_tecnica: 'Nota técnica da consultoria', relatorio_legislativo: 'Relatório legislativo' })[d.classe], d, false)).join('')}
</table>
${porArea.length ? `<p><strong>Relatórios setoriais por área temática</strong>${daBancada.size ? ' — as áreas relatadas pela bancada vêm primeiro' : ''}</p>
<table>${porArea.map(d => `<tr>
  <td class="r">${esc(d.area)}${ehDaBancada(d) ? ' <span style="color:#00794a">◆ bancada</span>' : ''}</td>
  <td>${esc(d.rotulo)}<div style="font-size:8.5pt;color:#555;word-break:break-all">${esc(d.url)}</div></td></tr>`).join('')}</table>` : ''}
${geral ? '' : '<div class="pend">O Relatório Geral ainda não foi publicado — é dele que saem os valores finais por órgão e o montante efetivamente destinado a emendas.</div>'}`;
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
  $('btn-nota').addEventListener('click', () => gerarNota());
  $('btn-nota-pdf')?.addEventListener('click', () => gerarNota({ imprimir: true }));
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
    'redigir-sintese': () => redigirSintese(),
    'apurar-numeros':  () => apurarNumeros(),
    'apurar-tudo':     apurarTudo,
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
