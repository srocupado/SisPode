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

const estado = { tipo: 'loa', ano: null, quadro: null, conferencia: null, carregando: false };

// ---------- utilidades ----------
const $ = id => document.getElementById(id);
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
  if (q.alteracoes) partes.push(cardAlteracoesPPA(q));
  if (estado.conferencia) partes.push(cardConferencia());

  $('on-corpo').innerHTML = partes.filter(Boolean).join('');
  $('btn-nota').disabled = !q.materia.disponivel;
  // Conferir normas só faz sentido havendo Manual de Emendas do exercício.
  $('btn-conferir').disabled = !(q.emendas.disponivel && q.emendas.manual);
  $('btn-conferir').title = q.emendas.manual
    ? `Confere a nota contra o "${q.emendas.manual.rotulo}"`
    : 'O Manual de Emendas deste exercício ainda não foi publicado — não há contra o que conferir.';

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
    ${e.manual ? `<div class="on-ok">Âncora normativa do exercício: <a style="color:#0a6cf0" href="${esc(e.manual.url)}" target="_blank" rel="noopener">${esc(e.manual.rotulo)}</a></div>` : '<div class="on-pend">O Manual de Emendas deste exercício ainda não foi publicado.</div>'}
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
  const manual = q?.emendas?.manual;
  if (!manual) return;
  const btn = $('btn-conferir');
  const rot = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="on-spinner"></span> lendo o Manual…';
  try {
    const texto = await extrairTextoPdfUrl(manual.url);
    const nota = montarTextoNota(q);
    estado.conferencia = {
      rotuloFonte: manual.rotulo,
      resultado: conferirContraFonte(nota, texto, { rotuloFonte: manual.rotulo }),
    };
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
  w.document.write(htmlNota(q, estado.conferencia));
  w.document.close();
}

function htmlNota(q, conf) {
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
  const pendencias = [];
  if (!c.disponivel) pendencias.push('prazo de apresentação de emendas e demais datas do cronograma');
  if (r.disponivel && !r.relatorGeral) pendencias.push('designação do Relator-Geral');
  if (r.disponivel && !r.setoriais.length) pendencias.push('designação dos relatores setoriais');
  if (!e.disponivel || !e.manual) pendencias.push('Manual de Emendas do exercício, que fixa cotas, quantidades, sequenciais de cancelamento e pisos de repasse');
  if (!q.notas.disponivel) pendencias.push('notas técnicas das consultorias (CONOF/CD e CONORF/SF)');

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

${e.disponivel && e.manual ? `<h2>${pendencias.length ? '5' : '4'}. Base normativa do exercício</h2>
<p>Os parâmetros operacionais das emendas deste exercício constam do
<strong>${esc(e.manual.rotulo)}</strong>, publicado pela Comissão Mista, que é a referência a ser consultada
para cotas, quantidades, sequenciais de cancelamento e pisos de repasse.</p>
${alertas ? `<div class="conf"><strong>Conferência automática contra o Manual:</strong><br>${alertas.map(esc).join('<br>')}
<br><span style="font-size:9pt">A conferência indica apenas se a norma ou o valor citado consta do documento do exercício; constar não significa que o dispositivo siga aplicável ao mesmo caso.</span></div>` : ''}` : ''}

${q.alteracoes && q.alteracoes.disponivel ? `<h2>Alterações ao texto do PPA</h2>
<p>O plano em vigor é a <strong>${esc(q.alteracoes.leiDoPlano || 'lei do PPA')}</strong>. Ao longo do quadriênio, o Poder
Executivo encaminha projetos que o alteram; são eles que tramitam, e não o plano original.</p>
<table>${q.alteracoes.alteracoes.map(x => `<tr><td class="r">${esc(x.projeto)}</td><td>${esc(x.ementa || '')}</td><td style="width:22%;text-align:right">${esc(x.situacao || '—')}${x.normaGerada ? `<br>${esc(x.normaGerada)}` : ''}</td></tr>`).join('')}</table>
${q.alteracoes.emTramitacao.length ? `<div class="pend">Em tramitação nesta data: <strong>${q.alteracoes.emTramitacao.map(x => esc(x.projeto)).join(', ')}</strong>.</div>` : ''}` : ''}

<div class="rodape">Coordenação de Orçamento da Liderança do Podemos na Câmara dos Deputados</div>
</body></html>`;
}

/** 57ª Legislatura: 2023-2027. Cada legislatura dura 4 anos desde 1826. */
function legislaturaDe(ano) {
  return 57 + Math.floor((ano - 2023) / 4);
}

// ============================================================
//  INÍCIO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
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

  // Exercício seguinte por padrão: é o que está em tramitação na CMO no
  // segundo semestre, que é quando a nota é pedida.
  povoar();
  carregar();
});
