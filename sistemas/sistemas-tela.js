'use strict';
// Relatórios · Sistemas eleitorais — a tela (só na extensão). Lê os votos
// oficiais do TSE — servidor de resultados na eleição corrente; dados abertos
// nos anos que ele já não guarda — roda os sistemas do núcleo
// (../sistemas-nucleo.js) e mostra a comparação: hemiciclos, bancadas por
// partido, o Podemos, estado a estado. PDF pela impressão (#siImpressao).
// O distrital misto lê mais: os votos por município e zona, o eleitorado e as
// coordenadas dos locais de votação (dados abertos do TSE) e a malha dos
// municípios (IBGE); desenha os distritos (../sistemas-distrital.js) e mostra o
// mapa e a tabela dos distritos no detalhe do estado.
// Usa de ../labs-apuracao.js: AP_BASE, AP_UFS, apUrl, apEleicoesGerais, apEleicaoReserva;
// de ../zip-remoto.js: zrJson, zrIndice, zrFaixa, zrUfDaEntrada, zrLerEntradaRemota;
// de ../labs-mapa-nucleo.js: lmnResolvedor (nome do município no TSE → código do IBGE).

const SI_PARTIDO = 'PODE';
const SI_COR_PODE = '#00a859', SI_COR_OUTROS = '#5b6b7b';
// Paleta neutra por tamanho de bancada (sem cor "ideológica"); o Podemos fica no verde da marca.
// Sem verdes: o verde é do Podemos.
const SI_PALETA = ['#3b82f6', '#ef4444', '#f59e0b', '#a855f7', '#22d3ee', '#ec4899', '#b45309', '#fda4af', '#6366f1', '#fde047', '#93c5fd', '#d8b4fe'];
const SI_NOMES = { proporcional: 'Proporcional', distritao: 'Distritão', misto: 'Distritão misto', distrital: 'Distrital misto' };
const SI_CURTOS = { proporcional: 'Prop.', distritao: 'Distritão', misto: 'D. misto', distrital: 'Distrital' };
const SI_IBGE = 'https://servicodados.ibge.gov.br/api';
// Cores dos distritos no mapa (vizinhos nunca com a mesma).
const SI_CORES_DIST = ['#3b82f6', '#f59e0b', '#a855f7', '#22d3ee', '#ef4444', '#84cc16', '#ec4899', '#f97316', '#14b8a6', '#eab308', '#6366f1', '#fb7185'];
// Município com mais eleitores que esta fração de um distrito entra dividido nas zonas eleitorais.
const SI_FRACAO_DIVIDE = 0.6;
const SI_GRANDE = 150 * 1024 * 1024;   // acima disto, a leitura dos dados abertos pede confirmação

const si = { eleicoes: [], cargo: '6', op: null, dados: null, conjunto: null, res: null, sistemas: null, ufSel: '', lendo: false, tempo: null,
  geo: {}, desenhos: {}, pop: {}, locais: {}, calc: 0, mapaModo: 'distrito' };
const $ = id => document.getElementById(id);
const siEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siFmt = n => Number(n || 0).toLocaleString('pt-BR');
const siPct = x => (Math.round(x * 1000) / 10).toLocaleString('pt-BR') + '%';
const siMb = b => (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' MB';
const siUfNome = uf => AP_UFS[uf] || uf.toUpperCase();
const siCargoNome = () => si.cargo === '6' ? 'Deputado federal' : 'Deputado estadual e distrital';

// ------------------------------------------------------------ parâmetros
function siNumero(id, padrao) {
  const v = parseFloat(String($(id).value).replace(',', '.'));
  return isNaN(v) ? padrao : Math.min(100, Math.max(0, v));
}
function siSistemas() {
  const modelo = ($('mModelo').querySelector('.ativo') || {}).dataset || {};
  return [
    { id: 'proporcional', nome: SI_NOMES.proporcional, tipo: 'proporcional', op: {
      pctQP: siNumero('pQP', 10) / 100, pctPartido: siNumero('pPart', 80) / 100, pctCandidato: siNumero('pCand', 20) / 100,
      terceiraFaseAberta: $('pTerc').checked, federacoes: $('pFed').checked } },
    { id: 'distritao', nome: SI_NOMES.distritao, tipo: 'distritao', op: {} },
    { id: 'misto', nome: SI_NOMES.misto, tipo: 'misto', op: {
      pctMaisVotados: siNumero('mPct', 50) / 100, modelo: modelo.m || 'paralelo', limiar: siNumero('mLim', 0) / 100 } },
    { id: 'distrital', nome: SI_NOMES.distrital, tipo: 'distrital', op: {
      pctDistrital: siNumero('dPct', 50) / 100, regra: ($('dRegra').querySelector('.ativo') || {}).dataset.r || 'partido',
      modelo: ($('dModelo').querySelector('.ativo') || {}).dataset.m || 'paralelo', limiar: siNumero('dLim', 0) / 100,
      base: ($('dBase').querySelector('.ativo') || {}).dataset.b || 'eleitorado',
      arred: ($('dArr').querySelector('.ativo') || {}).dataset.a || 'proximo' } },
  ];
}
function siAlterado(s) {
  const o = s.op;
  if (s.tipo === 'proporcional') return o.pctQP !== 0.1 || o.pctPartido !== 0.8 || o.pctCandidato !== 0.2 || !o.terceiraFaseAberta || !o.federacoes;
  if (s.tipo === 'misto') return o.pctMaisVotados !== 0.5 || o.modelo !== 'paralelo' || o.limiar !== 0;
  if (s.tipo === 'distrital') return o.pctDistrital !== 0.5 || o.regra !== 'partido' || o.modelo !== 'paralelo' || o.limiar !== 0 || o.base !== 'eleitorado' || o.arred !== 'proximo';
  return false;
}
/** Distrital misto com as regras do PL 9.212/2017 (PLS 86 e 345/2017, aprovados pelo Senado). */
function siEhSenado(o) {
  return o.pctDistrital === 0.5 && o.regra === 'partido' && o.modelo === 'compensatorio' && o.limiar === 0 && o.base === 'populacao' && o.arred === 'baixo';
}
function siDescricao(s, curta) {
  const o = s.op;
  if (s.tipo === 'proporcional') {
    if (curta) return siAlterado(s) ? 'parâmetros alterados' : 'regra vigente';
    return siAlterado(s) ? `QP com candidato de ${siPct(o.pctQP)} do QE; sobras com agremiação de ${siPct(o.pctPartido)} e candidato de ${siPct(o.pctCandidato)}; `
      + `3ª fase ${o.terceiraFaseAberta ? 'aberta a todas' : 'só com as de ' + siPct(o.pctPartido)}; ${o.federacoes ? 'com' : 'sem'} federações` : 'regra vigente (10% · 80/20 · 3ª fase aberta · federações)';
  }
  if (s.tipo === 'misto') {
    return `${siPct(o.pctMaisVotados)} mais votados · ${siPct(1 - o.pctMaisVotados)} lista, ${o.modelo === 'compensatorio' ? 'compensatório' : 'paralelo'}`
      + (o.limiar ? ` · cláusula de ${siPct(o.limiar)}${curta ? '' : ' para a lista'}` : '');
  }
  if (s.tipo === 'distrital') {
    if (siEhSenado(o)) return curta ? 'como no PL 9.212/2017 (Senado)'
      : 'como no PL 9.212/2017 (Senado): metade das vagas em distritos (parte inteira), por população (Censo 2022); a agremiação mais votada leva o distrito; compensatório, sem cláusula';
    return `${siPct(o.pctDistrital)} em distritos (${o.regra === 'candidato' ? 'o candidato' : 'o partido'} mais votado leva) · ${siPct(1 - o.pctDistrital)} lista, `
      + `${o.modelo === 'compensatorio' ? 'compensatório' : 'paralelo'}` + (o.limiar ? ` · cláusula de ${siPct(o.limiar)}${curta ? '' : ' para a lista'}` : '')
      + (o.base === 'populacao' ? (curta ? ' · por população' : ' · distritos de população parecida (Censo 2022)') : (curta ? '' : ' · distritos de eleitorado parecido'))
      + (o.arred === 'baixo' ? (curta ? ' · parte inteira' : ' · nº de distritos pela parte inteira') : '');
  }
  return 'os mais votados de cada estado';
}
function siMarcarAlterados() {
  const ss = siSistemas();
  $('siAltP').hidden = !siAlterado(ss[0]);
  $('siAltM').hidden = !siAlterado(ss[2]);
  $('mPctV').textContent = siPct(ss[2].op.pctMaisVotados);
  $('mPctL').textContent = siPct(1 - ss[2].op.pctMaisVotados);
  $('siAltD').hidden = !siAlterado(ss[3]);
  $('dPctV').textContent = siPct(ss[3].op.pctDistrital);
  $('dPctL').textContent = siPct(1 - ss[3].op.pctDistrital);
  $('dSenadoOk').hidden = !siEhSenado(ss[3].op);
}
function siRegraVigente() {
  $('pQP').value = 10; $('pPart').value = 80; $('pCand').value = 20; $('pTerc').checked = true; $('pFed').checked = true;
  $('mPct').value = 50; $('mLim').value = 0; $('dPct').value = 50; $('dLim').value = 0;
  for (const id of ['mModelo', 'dModelo']) for (const b of $(id).querySelectorAll('button')) b.classList.toggle('ativo', b.dataset.m === 'paralelo');
  for (const b of $('dRegra').querySelectorAll('button')) b.classList.toggle('ativo', b.dataset.r === 'partido');
  for (const b of $('dBase').querySelectorAll('button')) b.classList.toggle('ativo', b.dataset.b === 'eleitorado');
  for (const b of $('dArr').querySelectorAll('button')) b.classList.toggle('ativo', b.dataset.a === 'proximo');
  siParametrosMudaram();
}
/** Distrital misto como no PL 9.212/2017; os outros sistemas ficam como estão. */
function siRegraSenado() {
  $('dPct').value = 50; $('dLim').value = 0;
  const marca = (id, attr, v) => { for (const b of $(id).querySelectorAll('button')) b.classList.toggle('ativo', b.dataset[attr] === v); };
  marca('dRegra', 'r', 'partido'); marca('dModelo', 'm', 'compensatorio'); marca('dBase', 'b', 'populacao'); marca('dArr', 'a', 'baixo');
  siParametrosMudaram();
}
function siParametrosMudaram() {
  siMarcarAlterados();
  clearTimeout(si.tempo);
  si.tempo = setTimeout(siSimular, 120);
}

// ------------------------------------------------------------ leitura do TSE
function siStatus(html) { $('siStatus').innerHTML = html; }
function siProgresso(txt, f) {
  siStatus(`${siEsc(txt)}<div class="barra"><i style="width:${Math.max(0, Math.min(100, Math.round(f * 100)))}%"></i></div>`);
}

/** Eleição corrente: um JSON por estado, do servidor oficial de resultados. */
async function siLerResultados(op, cargo, ufs) {
  const out = {};
  let feitos = 0, i = 0;
  siProgresso('Lendo o servidor de resultados do TSE…', 0);
  const trabalhador = async () => {
    while (i < ufs.length) {
      const uf = ufs[i++];
      const cg = cargo === '6' ? 6 : uf === 'df' ? 8 : 7;
      out[uf] = snLerUF(await zrJson(apUrl(uf, op.eleicao[cg], cg, op.ciclo)), uf);
      siProgresso(`Lendo o servidor de resultados do TSE: ${++feitos} de ${ufs.length} ${ufs.length === 1 ? 'estado' : 'estados'}`, feitos / ufs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ufs.length) }, trabalhador));
  return out;
}

// Guarda da leitura dos dados abertos (IndexedDB), por ano e UF, valendo só para
// a mesma versão dos dois arquivos do TSE (ETag/Last-Modified/tamanho): se o TSE
// regravar o arquivo, a leitura é refeita.
function siBanco() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('sispode-sistemas', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('abertos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}
async function siGuardadoLer(chave) {
  try {
    const db = await siBanco();
    return await new Promise(ok => { const q = db.transaction('abertos').objectStore('abertos').get(chave); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); });
  } catch (_) { return null; }
}
async function siGuardadoGravar(chave, valor) {
  try {
    const db = await siBanco();
    await new Promise(ok => { const t = db.transaction('abertos', 'readwrite'); t.objectStore('abertos').put(valor, chave); t.oncomplete = ok; t.onerror = ok; t.onabort = ok; });
  } catch (_) { /* sem guarda: a próxima abertura lê de novo */ }
}
async function siVersao(url) {
  const r = await zrFaixa(url, 0, 0);
  return [r.headers.get('etag'), r.headers.get('last-modified'), r.headers.get('content-range')].filter(Boolean).join(' ') || '?';
}
function siConfirmar(ano, total, oque) {
  return new Promise(ok => {
    siStatus('');
    $('siAvisos').innerHTML = `<div class="aviso"><b>Leitura grande.</b> ${oque ? `O distrital misto precisa ${oque} de ${ano}, dos dados abertos do TSE` : `Os votos de ${ano} vêm dos arquivos de dados abertos do TSE (votação por candidato e por partido, por município e zona)`}:
      cerca de <b>${siMb(total)}</b> a baixar, uma vez — a leitura fica guardada neste navegador enquanto o arquivo do TSE for o mesmo. Um estado só é bem menos.
      <div style="margin-top:6px"><button class="pri" id="siSim">Ler agora</button> <button id="siNao">Cancelar</button></div></div>`;
    $('siSim').onclick = () => { $('siAvisos').innerHTML = ''; ok(true); };
    $('siNao').onclick = () => { $('siAvisos').innerHTML = ''; ok(false); };
  });
}

/** Anos fora do servidor de resultados: os dois zips de dados abertos, só as entradas das UFs pedidas, numa leitura para os dois cargos. */
async function siLerAbertos(ano, cargo, ufs) {
  const urls = snUrlsAbertos(ano);
  siProgresso(`Abrindo os arquivos de dados abertos do TSE de ${ano}…`, 0);
  const [vc, vp] = await Promise.all([siVersao(urls.candidato), siVersao(urls.partido)]);
  const versao = vc + ' | ' + vp;
  const out = {}, faltam = [];
  for (const uf of ufs) {
    const g = await siGuardadoLer(`${ano}|${uf}`);
    if (g && g.versao === versao && g.dados && g.dados.federal && g.dados.estadual) out[uf] = g.dados; else faltam.push(uf);
  }
  if (faltam.length) {
    const [ic, ip] = await Promise.all([zrIndice(urls.candidato), zrIndice(urls.partido)]);
    const entrada = (idx, uf) => idx.entradas.find(e => (zrUfDaEntrada(e.nome) || '').toLowerCase() === uf);
    const tarefas = faltam.map(uf => ({ uf, c: entrada(ic, uf), p: entrada(ip, uf) }));
    const sem = tarefas.filter(t => !t.c || !t.p).map(t => t.uf.toUpperCase());
    if (sem.length) throw new Error(`os arquivos de ${ano} do TSE não trazem ${sem.join(', ')}`);
    const total = tarefas.reduce((s, t) => s + t.c.comprimido + t.p.comprimido, 0);
    if (total > SI_GRANDE && !(await siConfirmar(ano, total))) return null;
    let base = 0;
    for (const t of tarefas) {
      const L = snLeitorDadosAbertos(['6', '7', '8']);
      const andar = n => siProgresso(`Lendo os dados abertos do TSE de ${ano}: ${siUfNome(t.uf)} — ${siMb(base + n)} de ${siMb(total)}`, (base + n) / total);
      await zrLerEntradaRemota(urls.candidato, t.c, L.candidato.linha, andar);
      base += t.c.comprimido;
      await zrLerEntradaRemota(urls.partido, t.p, L.partido.linha, andar);
      base += t.p.comprimido;
      const dados = { federal: L.resultado({}, '6')[t.uf], estadual: L.resultado({}, t.uf === 'df' ? '8' : '7')[t.uf] };
      if (!dados.federal || !dados.estadual) throw new Error(`o arquivo do TSE de ${ano} veio sem os deputados de ${t.uf.toUpperCase()}`);
      out[t.uf] = dados;
      await siGuardadoGravar(`${ano}|${t.uf}`, { versao, dados, lidoEm: Date.now() });
    }
  }
  return Object.fromEntries(ufs.map(uf => [uf, cargo === '6' ? out[uf].federal : out[uf].estadual]));
}

async function siLer(forcar) {
  if (si.lendo) return;
  const op = si.eleicoes.find(o => o.id === $('siEleicao').value);
  if (!op) return;
  const ufSel = $('siUf').value;
  const ufs = ufSel ? [ufSel] : Object.keys(AP_UFS);
  // Mesmo conjunto já lido (só mudou a abrangência para uma UF dele): recorta, sem ler de novo.
  if (!forcar && si.dados && si.conjunto && si.conjunto.op === op.id && si.conjunto.cargo === si.cargo && ufs.every(uf => si.conjunto.dados[uf])) {
    si.dados = Object.fromEntries(ufs.map(uf => [uf, si.conjunto.dados[uf]]));
    si.ufSel = ufSel;
    siSimular();
    return;
  }
  siTravar(true);
  $('siPdf').disabled = true; $('siAvisos').innerHTML = '';
  try {
    const dados = op.fonte === 'resultados' ? await siLerResultados(op, si.cargo, ufs) : await siLerAbertos(op.ano, si.cargo, ufs);
    if (!dados) { siStatus(si.res ? siResumoStatus() : ''); return; }
    si.op = op; si.dados = dados; si.ufSel = ufSel;
    si.conjunto = { op: op.id, cargo: si.cargo, dados };
    siGeoStatus();
    siSimular();
  } catch (e) {
    siStatus('');
    $('siAvisos').innerHTML = `<div class="aviso erro"><b>Não foi possível ler o TSE.</b> ${siEsc(e && e.message || e)} — tente de novo em instantes (o servidor do TSE recusa pedidos de vez em quando).</div>`;
  } finally {
    siTravar(false);
  }
}

/** Durante a leitura, a escolha (eleição, cargo, abrangência) fica parada: a tela mostra o que foi pedido. */
function siTravar(sim) {
  si.lendo = sim;
  for (const el of [$('siLer'), $('siEleicao'), $('siUf'), ...$('siCargo').querySelectorAll('button')]) el.disabled = sim;
}

// ------------------------------------------------------------ distrital misto: leitura e desenho
const siChaveGeo = uf => `${si.op.ano}|${uf}`;
const siGeoPronto = ufs => !!si.op && ufs.length > 0 && ufs.every(uf => si.geo[siChaveGeo(uf)]);
const siCargoArq = uf => (si.cargo === '6' ? '6' : uf === 'df' ? '8' : '7');

/** Situação do distrital no cartão: o botão de leitura ou o resumo do que está carregado. */
function siGeoStatus(txt) {
  const el = $('siGeo');
  if (!el) return;
  const ufs = Object.keys(si.dados || {});
  if (txt) { el.innerHTML = txt; return; }
  if (!ufs.length) { el.innerHTML = ''; return; }
  el.innerHTML = siGeoPronto(ufs)
    ? `<span class="ok">✓ votos por município e zona carregados (${ufs.length === 1 ? siUfNome(ufs[0]) : ufs.length + ' estados'})</span>`
    : `<button id="siLerGeo" class="pri">Ler votos por município</button>precisa dos votos por município e zona, do eleitorado e dos locais de votação (TSE) e da malha dos municípios (IBGE)`;
  const b = $('siLerGeo');
  if (b) b.onclick = () => siLerGeo();
}

/**
 * Lê, por estado, o que o distrital precisa e ainda não está na memória: os
 * quatro arquivos de dados abertos do TSE (só as entradas do estado; o cadastro
 * de locais de 2022 é um arquivo só, do país) e a malha do IBGE. A leitura do TSE
 * fica guardada no navegador enquanto os arquivos forem os mesmos.
 */
async function siLerGeo() {
  if (si.lendo || !si.op) return;
  const ano = si.op.ano, ufs = Object.keys(si.dados).filter(uf => !si.geo[siChaveGeo(uf)]);
  if (!ufs.length) return;
  siTravar(true);
  $('siAvisos').innerHTML = '';
  try {
    const urls = snUrlsAbertos(ano), arqs = ['candidato', 'partido', 'detalhe', 'locais'];
    siGeoStatus('Conferindo os arquivos do TSE…');
    const vers = await Promise.all(arqs.map(a => siVersao(urls[a])));
    const versao = vers.join(' | ');
    const lidos = {}, faltam = [];
    for (const uf of ufs) {
      const g = await siGuardadoLer(`${ano}|${uf}|geo`);
      if (g && g.versao === versao && g.mun && g.votos) lidos[uf] = g; else faltam.push(uf);
    }
    if (faltam.length) {
      const idx = {};
      for (const a of arqs) {
        try { idx[a] = await zrIndice(urls[a]); }
        catch (e) { throw new Error(`${urls[a].split('/').pop()}: ${e && e.message || e}`); }
      }
      const daUf = (a, uf) => idx[a].entradas.find(e => (zrUfDaEntrada(e.nome) || '').toLowerCase() === uf);
      // locais: por estado (2026) ou um arquivo só, do país (2022)
      const locaisPais = idx.locais.entradas.find(e => /\.csv$/i.test(e.nome) && !zrUfDaEntrada(e.nome) && !/BRASIL/i.test(e.nome));
      const tarefas = faltam.map(uf => ({ uf, c: daUf('candidato', uf), p: daUf('partido', uf), d: daUf('detalhe', uf), l: daUf('locais', uf) || null }));
      const sem = tarefas.filter(t => !t.c || !t.p || !t.d || (!t.l && !locaisPais)).map(t => t.uf.toUpperCase());
      if (sem.length) throw new Error(`os arquivos de ${ano} do TSE não trazem ${sem.join(', ')}`);
      const usaPais = tarefas.some(t => !t.l);
      const total = tarefas.reduce((s, t) => s + t.c.comprimido + t.p.comprimido + t.d.comprimido + (t.l ? t.l.comprimido : 0), 0) + (usaPais ? locaisPais.comprimido : 0);
      if (total > SI_GRANDE && !(await siConfirmar(ano, total, 'dos votos por município e zona, do eleitorado e das coordenadas dos locais de votação'))) return;
      let base = 0;
      const leitores = {};
      for (const t of tarefas) {
        const L = (leitores[t.uf] = sdLeitorGeo(t.uf, ['6', '7', '8']));
        for (const [a, e0, fn] of [['candidato', t.c, L.candidato.linha], ['partido', t.p, L.partido.linha], ['detalhe', t.d, L.detalhe.linha], ['locais', t.l, L.locais.linha]]) {
          if (!e0) continue;
          let e = e0;
          for (let tent = 0; ; tent++) {
            try {
              await zrLerEntradaRemota(urls[a], e, fn, n => siProgresso(`Votos por município de ${ano}: ${siUfNome(t.uf)} — ${siMb(base + n)} de ${siMb(total)}`, (base + n) / total));
              break;
            } catch (err) {
              // O TSE regrava estes arquivos de tempos em tempos (e o firewall às vezes
              // devolve outra coisa): com o cabeçalho da entrada fora do lugar, relê o
              // índice do arquivo e tenta de novo, uma vez. A linha já lida antes do
              // erro é só o cabeçalho (a falha vem no início da entrada).
              if (tent || !/cabeçalho inválido/.test(err && err.message)) throw err;
              idx[a] = await zrIndice(urls[a]);
              e = daUf(a, t.uf);
              if (!e) throw err;
            }
          }
          base += e0.comprimido;
        }
      }
      if (usaPais) {
        const doPais = tarefas.filter(t => !t.l).map(t => leitores[t.uf].locais.linha);
        await zrLerEntradaRemota(urls.locais, locaisPais, l => { for (const f of doPais) f(l); },
          n => siProgresso(`Locais de votação de ${ano} (arquivo do país) — ${siMb(base + n)} de ${siMb(total)}`, (base + n) / total));
      }
      for (const t of tarefas) {
        const g = leitores[t.uf].resultado();
        lidos[t.uf] = { versao, mun: g.mun, votos: g.votos };
        await siGuardadoGravar(`${ano}|${t.uf}|geo`, { versao, mun: g.mun, votos: g.votos, lidoEm: Date.now() });
      }
    }
    // malha dos municípios e nomes (IBGE)
    let feitos = 0;
    for (const uf of ufs) {
      siProgresso(`Malha dos municípios (IBGE): ${siUfNome(uf)}`, feitos++ / ufs.length);
      const U = uf.toUpperCase();
      const [topo, lista] = await Promise.all([
        zrJson(`${SI_IBGE}/v3/malhas/estados/${U}?formato=application/json&intrarregiao=municipio&qualidade=minima`),
        zrJson(`${SI_IBGE}/v1/localidades/estados/${U}/municipios`)]);
      const resolver = lmnResolvedor((lista || []).map(m => ({ id: m.id, nome: m.nome })), U);
      si.geo[siChaveGeo(uf)] = { mun: lidos[uf].mun, votos: lidos[uf].votos, malha: sdTopo(topo), resolver };
    }
  } catch (e) {
    $('siAvisos').innerHTML = `<div class="aviso erro"><b>Não foi possível ler os votos por município.</b> ${siEsc(e && e.message || e)} — tente de novo em instantes.</div>`;
  } finally {
    siTravar(false);
    siStatus(si.res ? siResumoStatus() : '');
    siGeoStatus();
  }
  if (siGeoPronto(Object.keys(si.dados))) siSimular();
}

/**
 * Desenha (ou pega da memória) os distritos de cada estado para o número de
 * distritos pedido. Devolve { uf: { desenho, base, votos } }, ou null se outro
 * cálculo começou no meio. Cede a vez à tela entre um estado e outro.
 */
async function siPrepararDistritos(op, calc) {
  const porUf = {};
  const ufs = Object.keys(si.dados);
  let i = 0;
  for (const uf of ufs) {
    const d = si.dados[uf], g = si.geo[siChaveGeo(uf)];
    const k = sdNumeroDistritos(d.vagas, op.pctDistrital, op.arred);
    const chave = `${si.op.ano}|${uf}|${siCargoArq(uf)}|${k}|${op.base}`;
    if (!si.desenhos[chave]) {
      siProgresso(`Desenhando os distritos: ${siUfNome(uf)} (${k})…`, i / ufs.length);
      await new Promise(r => setTimeout(r, 0));
      if (calc !== si.calc) return null;
      // Base do tamanho: eleitores aptos (TSE) ou população residente (Censo 2022, IBGE).
      let gp = g, semPopulacao = [], popErro = '';
      if (op.base === 'populacao' && k > 0) {
        try {
          const pop = await siPopulacao(uf, g);
          if (calc !== si.calc) return null;
          const r = sdPesoPopulacao(g, pop, (cd, nome) => g.resolver(nome));
          gp = r.geo; semPopulacao = r.semPopulacao;
        } catch (e) { popErro = (e && e.message) || String(e); }
      }
      const aptos = Object.values(gp.mun).reduce((s, m) => s + Object.values(m.zonas).reduce((a, z) => a + z.aptos, 0), 0);
      let base = { unidades: [], viz: {} }, desenho = { distritos: [], metricas: null };
      if (k > 0) {
        base = sdUnidades(gp, g.malha, (cd, nome) => g.resolver(nome), SI_FRACAO_DIVIDE * aptos / k);
        desenho = sdDistritar(base, Math.min(k, base.unidades.length));
        if (k > base.unidades.length) desenho.pedidos = k;
        desenho.base = op.base === 'populacao' && !popErro ? 'populacao' : 'eleitorado';
        desenho.semPopulacao = semPopulacao;
        desenho.popErro = popErro;
      }
      // sem a população (IBGE fora do ar), o desenho fica pelo eleitorado e não vai para a memória
      if (!popErro) si.desenhos[chave] = { desenho, base, k };
      else { porUf[uf] = { desenho, base, votos: g.votos[siCargoArq(uf)] || {} }; i++; continue; }
    }
    let x = si.desenhos[chave];
    // Afinação pelos locais de votação (lida a pedido): só onde o desenho passa da tolerância do PL 9.212.
    const lc = si.locais[siChaveLocais(uf)];
    if (lc && x.desenho.metricas && !sdToleranciaSenado(x.desenho.distritos).ok) {
      if (!si.desenhos[chave + '|loc']) {
        siProgresso(`Afinando os distritos com os locais de votação: ${siUfNome(uf)}…`, i / ufs.length);
        await new Promise(r => setTimeout(r, 0));
        if (calc !== si.calc) return null;
        si.desenhos[chave + '|loc'] = siAfinar(x, lc.locais);
      }
      x = si.desenhos[chave + '|loc'];
    }
    const vz = g.votos[siCargoArq(uf)] || {};
    porUf[uf] = { desenho: x.desenho, base: x.base, votos: x.desenho.locais && lc ? Object.assign({}, vz, lc.votos) : vz };
    i++;
  }
  return porUf;
}

/** Desenho afinado pelos locais: primeiro as zonas da fronteira; se ainda passa da tolerância, também os municípios da fronteira. Fica o melhor. */
function siAfinar(x, locais) {
  let r = sdRefinarLocais(x.base, x.desenho, locais);
  if (r && !sdToleranciaSenado(r.desenho.distritos).ok) {
    const r2 = sdRefinarLocais(r.base, r.desenho, locais, { municipios: true });
    if (r2 && r2.desenho.metricas.desvioMax < r.desenho.metricas.desvioMax) r = r2;
  }
  if (!r || r.desenho.metricas.desvioMax >= x.desenho.metricas.desvioMax || !r.desenho.metricas.contiguos) return x;
  return { desenho: r.desenho, base: r.base, k: x.k };
}

const siChaveLocais = uf => `${si.op.ano}|${uf}|${siCargoArq(uf)}`;
/** Estados cujo desenho passa da tolerância do PL 9.212 e ainda não têm os locais de votação lidos. */
function siForaDaTolerancia() {
  const s = si.sistemas && si.sistemas.find(x => x.tipo === 'distrital');
  if (!s || !s.op.porUf) return [];
  return Object.keys(s.op.porUf).filter(uf => { const d = s.op.porUf[uf].desenho; return d.metricas && !sdToleranciaSenado(d.distritos).ok && !si.locais[siChaveLocais(uf)]; }).sort();
}
function siBotaoLocais(ufs) {
  if (!ufs.length) return '';
  return `<div class="dica"><button data-locais="${ufs.join(',')}">Afinar com os locais de votação (${ufs.map(u => u.toUpperCase()).join(', ')})</button>
    As zonas eleitorais são a menor peça do desenho e, nestes estados, grandes demais para caber na tolerância. Com a votação por seção do TSE (um arquivo por estado, lido só desta vez e guardado só na memória da página),
    as zonas da fronteira entre distritos se dividem nos seus locais de votação.</div>`;
}

/**
 * Lê, para os estados pedidos, a votação por seção (TSE, um arquivo por estado) e o
 * cadastro dos locais de votação, e guarda na memória da página os locais (eleitores,
 * posição) e os votos de cada local já fechados com os totais da zona.
 */
async function siLerLocais(ufs) {
  if (si.lendo || !si.op || !ufs.length) return;
  const ano = si.op.ano, urls = snUrlsAbertos(ano);
  siTravar(true);
  $('siAvisos').innerHTML = '';
  try {
    siProgresso('Conferindo os arquivos do TSE…', 0);
    const il = await zrIndice(urls.locais);
    const locaisPais = il.entradas.find(e => /\.csv$/i.test(e.nome) && !zrUfDaEntrada(e.nome) && !/BRASIL/i.test(e.nome));
    const tarefas = [];
    for (const uf of ufs) {
      const us = sdUrlSecao(ano, uf), is = await zrIndice(us);
      const s = is.entradas.find(e => /\.csv$/i.test(e.nome));
      const l = il.entradas.find(e => (zrUfDaEntrada(e.nome) || '').toLowerCase() === uf) || locaisPais;
      if (!s || !l) throw new Error(`os arquivos de ${ano} do TSE não trazem ${uf.toUpperCase()}`);
      tarefas.push({ uf, us, s, l });
    }
    const total = tarefas.reduce((t, x) => t + x.s.comprimido + x.l.comprimido, 0);
    if (total > SI_GRANDE && !(await siConfirmar(ano, total, 'da votação por seção e do cadastro dos locais de votação'))) return;
    let base = 0;
    for (const t of tarefas) {
      const cargo = siCargoArq(t.uf), L = sdLeitorLocais(t.uf, cargo);
      for (const [url, e, fn, oque] of [[t.us, t.s, L.secao.linha, 'votação por seção'], [urls.locais, t.l, L.locais.linha, 'locais de votação']]) {
        await zrLerEntradaRemota(url, e, fn, n => siProgresso(`${oque[0].toUpperCase() + oque.slice(1)} de ${ano}: ${siUfNome(t.uf)} — ${siMb(base + n)} de ${siMb(total)}`, (base + n) / total));
        base += e.comprimido;
      }
      const lido = L.resultado(), d = si.dados[t.uf], sigla = {};
      for (const a of d.agrs) for (const c of a.cands) { const p = lido.prefixo[c.sq]; if (p && !sigla[p]) sigla[p] = c.partido; }
      const vz = si.geo[siChaveGeo(t.uf)].votos[cargo] || {};
      si.locais[siChaveLocais(t.uf)] = { locais: lido.locais, votos: sdVotosLocais(vz, lido, nr => sigla[nr] || null) };
    }
  } catch (e) {
    $('siAvisos').innerHTML = `<div class="aviso erro"><b>Não foi possível ler os locais de votação.</b> ${siEsc(e && e.message || e)} — tente de novo em instantes.</div>`;
  } finally {
    siTravar(false);
    siStatus(si.res ? siResumoStatus() : '');
  }
  siSimular();
}

/** População residente do Censo 2022 por município da UF (IBGE, lida na hora; guardada só na memória da página). */
function siPopulacao(uf, g) {
  if (!si.pop[uf]) {
    const ibgeUf = (Object.keys(g.malha.feicoes)[0] || '').slice(0, 2);
    si.pop[uf] = zrJson(sdUrlPopulacao(ibgeUf, SI_IBGE)).then(j => {
      const p = sdLerPopulacao(j);
      if (!Object.keys(p).length) throw new Error('o IBGE não devolveu a população dos municípios');
      return p;
    }).catch(e => { delete si.pop[uf]; throw e; });
  }
  return si.pop[uf];
}

// ------------------------------------------------------------ simulação e tela
async function siSimular() {
  if (!si.dados) return;
  const calc = ++si.calc;
  let sistemas = siSistemas();
  const dist = sistemas.find(x => x.tipo === 'distrital');
  if (siGeoPronto(Object.keys(si.dados))) {
    const porUf = await siPrepararDistritos(dist.op, calc);
    if (!porUf) return;
    dist.op.porUf = porUf;
  } else sistemas = sistemas.filter(x => x !== dist);
  if (calc !== si.calc) return;
  si.sistemas = sistemas;
  si.res = snSimular(si.dados, si.sistemas);
  siGeoStatus();
  si.res.vagas = si.res.comparadas.reduce((s, uf) => s + si.dados[uf].vagas, 0);
  if (si.ufSel && !si.dados[si.ufSel]) si.ufSel = '';
  siStatus(siResumoStatus());
  $('siAvisos').innerHTML = siAvisosHtml();
  $('siResultado').innerHTML = siRelatorioHtml(false);
  $('siPdf').disabled = false;
}

function siResumoStatus() {
  const ufs = Object.keys(si.dados || {});
  const atual = ufs.map(uf => si.dados[uf].atualizado).filter(Boolean).sort((a, b) => siData(b) - siData(a))[0];
  return `<b>${si.op.ano}</b> · ${siCargoNome()} · ${ufs.length === 1 ? siUfNome(ufs[0]) : ufs.length + ' estados'} · ${siFmt(si.res.vagas)} vagas · `
    + (si.op.fonte === 'resultados' ? `servidor de resultados do TSE${atual ? ' (divulgação de ' + siEsc(atual) + ')' : ''}` : 'dados abertos do TSE');
}
function siData(s) { const m = /(\d+)\/(\d+)\/(\d+)\s*(\d+)?:?(\d+)?:?(\d+)?/.exec(s || ''); return m ? new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() : 0; }

function siAvisosHtml() {
  const ufs = Object.keys(si.dados);
  const ret = ufs.filter(uf => snSituacao(si.dados[uf]) === 'retotalizando'), par = ufs.filter(uf => snSituacao(si.dados[uf]) === 'parcial' && !ret.includes(uf));
  const sem = si.res.real.semReal.filter(uf => !ret.includes(uf) && !par.includes(uf));
  const lista = l => l.map(uf => uf.toUpperCase()).join(', ');
  let h = '';
  if (ret.length) h += `<div class="aviso"><b>Em retotalização: ${lista(ret)}.</b> O TSE reabriu a totalização e ainda não marcou os eleitos; `
    + `a simulação usa os votos publicados, mas ${ret.length === 1 ? 'o estado fica' : 'os estados ficam'} fora da comparação nacional até a conclusão.</div>`;
  if (par.length) h += `<div class="aviso"><b>Apuração em andamento: ${lista(par)}.</b> Os votos ainda vão mudar; ${si.res.real.semReal.length === ufs.length ? 'sem eleitos marcados, a comparação com o oficial fica para o fim da apuração' : 'sem o resultado final, a comparação é parcial'}.</div>`;
  if (sem.length) h += `<div class="aviso"><b>Sem eleitos marcados pelo TSE: ${lista(sem)}.</b> Fora da comparação nacional.</div>`;
  return h;
}

/** Cores dos partidos: Podemos no verde; os demais pela ordem da bancada, até a paleta acabar. */
function siCores(ordem) {
  const cores = {};
  let i = 0;
  for (const sg of ordem) cores[sg] = sg === SI_PARTIDO ? SI_COR_PODE : (SI_PALETA[i++] || SI_COR_OUTROS);
  return cores;
}

function siHemicicloSvg(porPartido, ordem, cores, vagas) {
  const h = snHemiciclo(vagas);
  const R = 96, cx = 100, cy = 101;
  const pts = h.pontos, raio = (h.r * R).toFixed(2);
  let i = 0, out = '';
  const bola = (p, cor, titulo, cls) => `<circle${cls ? ` class="${cls}"` : ''} cx="${(cx + p.x * R).toFixed(1)}" cy="${(cy - p.y * R).toFixed(1)}" r="${raio}" fill="${cor}"><title>${siEsc(titulo)}</title></circle>`;
  for (const sg of ordem) for (let k = 0; k < (porPartido[sg] || 0) && i < pts.length; k++) out += bola(pts[i++], cores[sg], `${sg}: ${porPartido[sg]}`);
  while (i < pts.length) out += bola(pts[i++], '#2a3a4a', 'vaga sem eleito marcado', 'vazio');
  return `<svg viewBox="0 0 200 104" role="img">${out}</svg>`;
}

function siDelta(n, ref) {
  const d = n - ref;
  return d > 0 ? `<span class="mais">+${d}</span>` : d < 0 ? `<span class="menos">−${-d}</span>` : '<span class="igual">=</span>';
}
function siTrocas(sim, ufs) { return ufs.reduce((s, uf) => s + ((sim.porUf[uf] || {}).entram || []).length, 0); }

function siRelatorioHtml(impressao) {
  const res = si.res, ordem = snOrdemPartidos(res), cores = siCores(ordem), comp = res.comparadas;
  const temReal = res.real.total > 0;
  const real = res.real.porPartido, pode = x => (x.porPartido[SI_PARTIDO] || 0);
  const umaUf = Object.keys(si.dados).length === 1;
  let h = '';
  // Podemos em cada sistema
  const nCol = res.sims.length + 1;
  const porId = id => res.sims.find(x => x.id === id);
  h += `<h2>Bancada do Podemos <small>${umaUf ? siUfNome(Object.keys(si.dados)[0]) : 'no país'}${comp.length < Object.keys(si.dados).length ? ' · ' + comp.length + ' estados comparáveis' : ''}</small></h2><div class="cards" style="--n:${nCol}">`;
  h += `<div class="card"><div class="t">Resultado oficial</div><div class="v">${temReal ? pode(res.real) : '—'}</div><div class="l">${temReal ? 'eleitos marcados pelo TSE' : 'sem eleitos marcados ainda'}</div></div>`;
  for (const s of res.sims) {
    h += `<div class="card"><div class="t">${siEsc(s.nome)}</div><div class="v">${pode(s)}</div><div class="d">${temReal ? siDelta(pode(s), pode(res.real)) + ' <span class="igual">vs. oficial</span>' : '&nbsp;'}</div>`
      + `<div class="l">${temReal ? siFmt(siTrocas(s, comp)) + (siTrocas(s, comp) === 1 ? ' cadeira muda' : ' cadeiras mudam') + ' de mãos' : ''}</div></div>`;
  }
  h += '</div>';
  const ind = snIndicadores(res, si.dados);
  h = siResumoHtml(ind) + h;
  h += siIndicadoresHtml(ind);
  // Hemiciclos
  const vagas = res.vagas;
  h += `<h2>Composição em cada sistema <small>${siFmt(vagas)} cadeiras · mesma ordem de partidos em todos</small></h2><div class="hemis" style="--n:${nCol}">`;
  h += `<div class="hemi"><div class="t">Resultado oficial (TSE)</div><div class="s">${temReal ? 'como o TSE totalizou' : 'aguardando a totalização'}</div>${siHemicicloSvg(real, ordem, cores, vagas)}<div class="pode">Podemos: <b>${temReal ? pode(res.real) : '—'}</b></div></div>`;
  for (const s of res.sims) {
    const igual = temReal && !siTrocas(s, comp);
    h += `<div class="hemi"><div class="t">${siEsc(s.nome)}</div><div class="s">${siEsc(siDescricao(si.sistemas.find(x => x.id === s.id), true))}</div>${siHemicicloSvg(s.porPartido, ordem, cores, vagas)}`
      + `<div class="pode">Podemos: <b>${pode(s)}</b>${igual ? ' · <span class="mais">idêntico ao oficial</span>' : ''}</div></div>`;
  }
  h += '</div><div class="legenda">' + ordem.filter(sg => cores[sg] !== SI_COR_OUTROS).map(sg => `<span><i style="background:${cores[sg]}"></i>${siEsc(sg)}</span>`).join('')
    + (ordem.some(sg => cores[sg] === SI_COR_OUTROS) ? `<span><i style="background:${SI_COR_OUTROS}"></i>demais partidos</span>` : '') + '</div>';
  // Tabela por partido
  h += `<h2>Bancadas por partido <small>Δ = diferença para o resultado oficial</small></h2><div class="tab-rolagem"><table class="compacta"><thead><tr><th>Partido</th><th class="n">Oficial</th>`
    + res.sims.map(s => `<th class="n">${siEsc(s.nome)}</th><th class="n">Δ</th>`).join('') + '</tr></thead><tbody>';
  for (const sg of ordem) {
    h += `<tr${sg === SI_PARTIDO ? ' class="pode"' : ''}><td><span class="sw" style="background:${cores[sg]}"></span>${siEsc(sg)}</td><td class="n">${temReal ? real[sg] || 0 : '—'}</td>`
      + res.sims.map(s => `<td class="n">${s.porPartido[sg] || 0}</td><td class="d">${temReal ? siDelta(s.porPartido[sg] || 0, real[sg] || 0) : ''}</td>`).join('') + '</tr>';
  }
  h += `<tr><td><b>Total</b></td><td class="n"><b>${temReal ? res.real.total : '—'}</b></td>` + res.sims.map(s => `<td class="n"><b>${s.total}</b></td><td></td>`).join('') + '</tr></tbody></table></div>';
  // Quem entra e quem sai no Podemos
  if (temReal) {
    h += `<h2>Podemos: quem entra e quem sai <small>em relação aos eleitos oficiais</small></h2><div class="duas">`;
    for (const s of res.sims) {
      const ent = comp.flatMap(uf => s.porUf[uf].entram.filter(x => x.cand.partido === SI_PARTIDO).map(x => ({ uf, x })));
      const sai = comp.flatMap(uf => s.porUf[uf].saem.filter(x => x.cand.partido === SI_PARTIDO).map(x => ({ uf, x })));
      h += `<div class="bloco"><h3>${siEsc(s.nome)}</h3>` + (ent.length || sai.length ? '<table><tbody>'
        + ent.sort((a, b) => b.x.cand.votos - a.x.cand.votos).map(({ uf, x }) => `<tr><td class="ent">entra</td><td>${siEsc(x.cand.nome)}</td><td>${uf.toUpperCase()}</td><td class="n">${siFmt(x.cand.votos)}</td></tr>`).join('')
        + sai.sort((a, b) => b.x.cand.votos - a.x.cand.votos).map(({ uf, x }) => `<tr><td class="sai">sai</td><td>${siEsc(x.cand.nome)}</td><td>${uf.toUpperCase()}</td><td class="n">${siFmt(x.cand.votos)}</td></tr>`).join('')
        + '</tbody></table>' : '<div class="vazio">Ninguém entra nem sai: a mesma bancada.</div>') + '</div>';
    }
    h += '</div>';
  }
  // Estado a estado
  if (!umaUf) {
    const curtos = res.sims.map(s => `<th class="n">${siEsc(SI_CURTOS[s.tipo] || s.nome)}</th>`).join('');
    h += `<h2${impressao ? ' class="imp-quebra"' : ''}>Estado a estado <small>${impressao ? '' : 'clique num estado para ver quem entra e quem sai'}</small></h2><div class="tab-rolagem"><table class="compacta"><thead>`
      + `<tr><th rowspan="2">UF</th><th rowspan="2" class="n">Vagas</th><th rowspan="2" class="n">QE</th><th rowspan="2" class="n">Corte do<br>distritão</th>`
      + `<th colspan="${res.sims.length + 1}" class="grupo">Podemos</th><th colspan="${res.sims.length}" class="grupo">Cadeiras que mudam de mãos</th></tr>`
      + `<tr><th class="n">Oficial</th>${curtos}${curtos}</tr></thead><tbody>`;
    for (const uf of res.ufs) {
      const d = si.dados[uf], r = res.real.porUf[uf], p = porId('proporcional').porUf[uf], dz = porId('distritao').porUf[uf];
      const podeUf = eleitos => eleitos.filter(x => x.cand.partido === SI_PARTIDO).length;
      h += `<tr class="clic${uf === si.ufSel ? ' sel' : ''}" data-uf="${uf}"><td>${uf.toUpperCase()}</td><td class="n">${d.vagas}</td><td class="n">${siFmt(p.qe)}</td><td class="n">${siFmt(dz.corte)}</td>`
        + `<td class="n">${r ? podeUf(r.eleitos) : '—'}</td>` + res.sims.map(s => `<td class="n">${podeUf(s.porUf[uf].eleitos)}</td>`).join('')
        + res.sims.map(s => `<td class="n">${r ? s.porUf[uf].entram.length : '—'}</td>`).join('') + '</tr>';
    }
    h += '</tbody></table></div>';
  }
  h += siDistritosEstadosHtml();
  const ufDet = umaUf ? Object.keys(si.dados)[0] : si.ufSel;
  if (ufDet) h += siDetalheUfHtml(ufDet, impressao);
  return h;
}

function siDetalheUfHtml(uf, impressao) {
  const res = si.res, d = si.dados[uf], r = res.real.porUf[uf];
  const ordem = snOrdemPartidos(res), cores = siCores(ordem);
  const conta = eleitos => { const o = {}; for (const x of eleitos) o[x.cand.partido] = (o[x.cand.partido] || 0) + 1; return o; };
  const real = r ? conta(r.eleitos) : {};
  const sims = res.sims.map(s => conta(s.porUf[uf].eleitos));
  const partidos = ordem.filter(sg => real[sg] || sims.some(o => o[sg]));
  const pid = id => res.sims.find(x => x.id === id).porUf[uf];
  const p = pid('proporcional'), dz = pid('distritao'), m = pid('misto');
  let h = `<h2 id="siDetalhe"${impressao && Object.keys(si.dados).length > 1 ? ' class="imp-quebra"' : ''}>${siEsc(siUfNome(uf))} <small>${d.vagas} vagas · ${siFmt(d.validos)} votos válidos · QE ${siFmt(p.qe)}`
    + ` · corte do distritão ${siFmt(dz.corte)} votos · misto: ${m.nMais} mais votados + ${m.nLista} lista</small></h2>`;
  const umaUf = Object.keys(si.dados).length === 1;   // com um estado só, a tabela por partido já está acima
  if (!umaUf) h += `<div class="tab-rolagem"><table class="compacta"><thead><tr><th>Partido</th><th class="n">Oficial</th>` + res.sims.map(s => `<th class="n">${siEsc(s.nome)}</th><th class="n">Δ</th>`).join('') + '</tr></thead><tbody>';
  if (!umaUf) for (const sg of partidos) {
    h += `<tr${sg === SI_PARTIDO ? ' class="pode"' : ''}><td><span class="sw" style="background:${cores[sg]}"></span>${siEsc(sg)}</td><td class="n">${r ? real[sg] || 0 : '—'}</td>`
      + sims.map(o => `<td class="n">${o[sg] || 0}</td><td class="d">${r ? siDelta(o[sg] || 0, real[sg] || 0) : ''}</td>`).join('') + '</tr>';
  }
  if (!umaUf) h += '</tbody></table></div>';
  if (!r) return h + '<div class="dica">Sem eleitos marcados pelo TSE neste estado: não há com quem comparar quem entra e quem sai.</div>';
  h += '<div class="duas" style="margin-top:10px">';
  for (const s of res.sims) {
    const u = s.porUf[uf];
    const linha = (x, cls, txt) => `<tr${x.cand.partido === SI_PARTIDO ? ' class="pode"' : ''}><td class="${cls}">${txt}</td><td>${siEsc(x.cand.nome)}</td><td>${siEsc(x.cand.partido)}</td><td class="n">${siFmt(x.cand.votos)}</td></tr>`;
    h += `<div class="bloco"><h3>${siEsc(s.nome)} <small class="igual">${u.entram.length} troca${u.entram.length === 1 ? '' : 's'}</small></h3>`
      + (u.entram.length || u.saem.length ? '<table><tbody>' + u.entram.map(x => linha(x, 'ent', 'entra')).join('') + u.saem.map(x => linha(x, 'sai', 'sai')).join('') + '</tbody></table>'
        : '<div class="vazio">Os mesmos eleitos do resultado oficial.</div>') + '</div>';
  }
  h += '</div>';
  const sd = res.sims.find(x => x.tipo === 'distrital');
  if (sd) h += siDistritosHtml(uf, sd, impressao);
  return h;
}

// ------------------------------------------------------------ comparação: resumo, indicadores, método
const siDec = (x, n = 1) => Number(x).toLocaleString('pt-BR', { minimumFractionDigits: n, maximumFractionDigits: n });
const siSinal = d => (d > 0 ? '+' + d : d < 0 ? '−' + -d : '=');

/** Resumo em frases, escrito a partir dos números (nada de opinião: o que muda e quanto). */
function siResumoHtml(ind) {
  const res = si.res, temReal = res.real.total > 0, vagas = res.vagas;
  const totV = Object.values(ind.votos).reduce((s, v) => s + v, 0) || 1;
  const podeV = (ind.votos[SI_PARTIDO] || 0) / totV;
  const pode = x => x.porPartido[SI_PARTIDO] || 0;
  const itens = [];
  if (temReal) {
    const oficial = pode(res.real);
    const outros = res.sims.filter(s => !(s.tipo === 'proporcional' && !siTrocas(s, res.comparadas)));
    itens.push(`Com <b>${siPct(podeV)}</b> dos votos (nominais e de legenda), o Podemos fez <b>${oficial}</b> cadeira${oficial === 1 ? '' : 's'} no resultado oficial `
      + `(${siPct(oficial / (res.real.total || 1))} das ${siFmt(res.real.total)}). `
      + (outros.length ? 'Nos outros sistemas: ' + outros.map(s => `${siEsc(s.nome.toLowerCase())}, <b>${pode(s)}</b> (${siSinal(pode(s) - oficial)})`).join('; ') + '.' : ''));
    const melhor = res.sims.slice().sort((a, b) => pode(b) - pode(a))[0], pior = res.sims.slice().sort((a, b) => pode(a) - pode(b))[0];
    if (pode(melhor) !== pode(pior)) itens.push(`Para o Podemos, o sistema mais favorável é o <b>${siEsc(melhor.nome.toLowerCase())}</b> (${pode(melhor)}) e o menos, o <b>${siEsc(pior.nome.toLowerCase())}</b> (${pode(pior)}).`);
  } else {
    itens.push(`Com <b>${siPct(podeV)}</b> dos votos, o Podemos faria: ` + res.sims.map(s => `${siEsc(s.nome.toLowerCase())}, <b>${pode(s)}</b>`).join('; ') + '. (Sem eleitos marcados pelo TSE ainda, não há resultado oficial para comparar.)');
  }
  const todos = [...(ind.real ? [['resultado oficial', ind.real]] : []), ...res.sims.map(s => [s.nome.toLowerCase(), ind.sims[s.id]])];
  const porG = todos.slice().sort((a, b) => a[1].gallagher - b[1].gallagher);
  itens.push(`Proporcionalidade (índice de Gallagher, 0 = cadeiras exatamente na proporção dos votos): de <b>${siDec(porG[0][1].gallagher)}</b> (${siEsc(porG[0][0])}) a <b>${siDec(porG[porG.length - 1][1].gallagher)}</b> (${siEsc(porG[porG.length - 1][0])}).`);
  const porN = todos.slice().sort((a, b) => a[1].nep - b[1].nep);
  itens.push(`Fragmentação (número efetivo de partidos): de <b>${siDec(porN[0][1].nep)}</b> (${siEsc(porN[0][0])}) a <b>${siDec(porN[porN.length - 1][1].nep)}</b> (${siEsc(porN[porN.length - 1][0])}); `
    + `partidos com cadeira: de ${Math.min(...todos.map(t => t[1].partidos))} a ${Math.max(...todos.map(t => t[1].partidos))}.`);
  if (temReal) {
    const mud = res.sims.filter(s => siTrocas(s, res.comparadas));
    if (mud.length) itens.push('Quem mais ganha e quem mais perde: ' + mud.map(s => {
      const x = ind.sims[s.id];
      return `${siEsc(s.nome.toLowerCase())} — ${x.ganha ? `${siEsc(x.ganha.sg)} ${siSinal(x.ganha.d)}` : '—'}, ${x.perde ? `${siEsc(x.perde.sg)} ${siSinal(x.perde.d)}` : '—'} `
        + `(${siFmt(siTrocas(s, res.comparadas))} de ${siFmt(vagas)} cadeiras mudam de mãos)`;
    }).join('; ') + '.');
  }
  const sd = res.sims.find(s => s.tipo === 'distrital');
  if (sd) {
    const op = si.sistemas.find(s => s.tipo === 'distrital').op;
    const des = Object.entries(op.porUf).filter(([, x]) => x.desenho.metricas);
    if (des.length) {
      const pior = des.slice().sort((a, b) => b[1].desenho.metricas.desvioMax - a[1].desenho.metricas.desvioMax)[0];
      const nd = des.reduce((s, [, x]) => s + x.desenho.distritos.length, 0);
      const venc = {};
      for (const uf of res.comparadas) for (const d of (sd.porUf[uf].distritos || [])) if (d.vencedor) venc[d.vencedor.partido] = (venc[d.vencedor.partido] || 0) + 1;
      const top = Object.entries(venc).sort((a, b) => b[1] - a[1]).slice(0, 3);
      itens.push(`Distrital misto: <b>${siFmt(nd)}</b> distritos desenhados em ${des.length} estado${des.length === 1 ? '' : 's'}, por ${op.base === 'populacao' ? 'população (Censo 2022)' : 'eleitorado'}; `
        + `maior desvio de tamanho <b>${siPct(pior[1].desenho.metricas.desvioMax)}</b> (${pior[0].toUpperCase()}).`
        + (op.base === 'populacao' ? (dentro => ` Na tolerância de tamanho do PL 9.212/2017 (±5%): ${dentro.length === des.length ? `todos os ${des.length}` : `${dentro.length} de ${des.length}`} estados.`)(des.filter(([, x]) => sdToleranciaSenado(x.desenho.distritos).ok)) : '')
        + (top.length ? ` Mais distritos ganhos: ${top.map(([sg, n]) => `${siEsc(sg)} ${n}`).join(', ')}${venc[SI_PARTIDO] && !top.some(([sg]) => sg === SI_PARTIDO) ? `; Podemos ${venc[SI_PARTIDO]}` : ''}.` : ''));
    }
  }
  return `<h2>Resumo</h2><ul class="resumo">${itens.map(t => `<li>${t}</li>`).join('')}</ul>`;
}

function siIndicadoresHtml(ind) {
  const res = si.res, temReal = res.real.total > 0;
  const linhas = [...(ind.real ? [{ nome: 'Resultado oficial', x: ind.real, pode: res.real.porPartido[SI_PARTIDO] || 0, troca: null }] : []),
    ...res.sims.map(s => ({ nome: s.nome, x: ind.sims[s.id], pode: s.porPartido[SI_PARTIDO] || 0, troca: temReal ? siTrocas(s, res.comparadas) : null }))];
  let h = `<h2>Indicadores <small>sobre ${res.comparadas.length === 1 ? siUfNome(res.comparadas[0]) : res.comparadas.length + ' estados'}</small></h2><div class="tab-rolagem"><table class="compacta"><thead><tr><th>Sistema</th><th class="n">Podemos</th>`
    + '<th class="n">Partidos com cadeira</th><th class="n">Nº efetivo de partidos</th><th class="n">Gallagher</th><th>Maior bancada</th>'
    + (temReal ? '<th class="n">Mudam de mãos</th><th>Mais ganha</th><th>Mais perde</th>' : '') + '</tr></thead><tbody>';
  for (const l of linhas) {
    h += `<tr><td>${siEsc(l.nome)}</td><td class="n"><b>${l.pode}</b></td><td class="n">${l.x.partidos}</td><td class="n">${siDec(l.x.nep, 2)}</td><td class="n">${siDec(l.x.gallagher, 2)}</td>`
      + `<td>${l.x.maior ? `${siEsc(l.x.maior.sg)} ${l.x.maior.n} (${siPct(l.x.maior.pct)})` : '—'}</td>`
      + (temReal ? `<td class="n">${l.troca == null ? '—' : siFmt(l.troca)}</td><td>${l.x.ganha ? `${siEsc(l.x.ganha.sg)} <span class="mais">${siSinal(l.x.ganha.d)}</span>` : '—'}</td>`
        + `<td>${l.x.perde ? `${siEsc(l.x.perde.sg)} <span class="menos">${siSinal(l.x.perde.d)}</span>` : '—'}</td>` : '') + '</tr>';
  }
  return h + '</tbody></table></div><div class="dica">Nº efetivo de partidos (Laakso-Taagepera): 1 ÷ soma dos quadrados das fatias de cadeiras — quanto maior, mais fragmentada a Casa. '
    + 'Gallagher: desproporcionalidade entre votos e cadeiras, em pontos percentuais (0 = proporção perfeita); os votos são os nominais e de legenda de cada partido.</div>';
}

/** Tolerância de tamanho do PL 9.212/2017 num texto curto: "dentro" ou o que passa. */
function siToleranciaTxt(t) {
  if (t.ok) return t.entre5e10 ? `dentro (${t.entre5e10} entre 5% e 10%)` : 'dentro (todos até ±5%)';
  const p = [];
  if (t.entre5e10 > t.permitidos) p.push(`${t.entre5e10} entre 5% e 10% (cabem ${t.permitidos})`);
  if (t.acima10) p.push(`${t.acima10} acima de 10%`);
  return 'fora: ' + p.join(', ');
}

/** Distritos por estado (Brasil ou vários estados): quantos, tamanho, qualidade. */
function siDistritosEstadosHtml() {
  const s = si.sistemas.find(x => x.tipo === 'distrital');
  if (!s || Object.keys(s.op.porUf).length < 2) return '';
  const pop = s.op.base === 'populacao';
  let h = `<h2>Distritos por estado <small>distrital misto · tamanho por ${pop ? 'população (Censo 2022)' : 'eleitorado'}</small></h2><div class="tab-rolagem"><table class="compacta"><thead><tr><th>UF</th><th class="n">Distritos</th>`
    + `<th class="n">Alvo (${pop ? 'habitantes' : 'eleitores'})</th><th class="n">Desvio máx.</th><th class="n">Desvio médio</th><th class="n">Compacidade</th><th class="n">Municípios divididos</th><th class="n">Zonas usadas</th>${pop ? '<th>Tolerância do PL 9.212 (±5%)</th>' : ''}</tr></thead><tbody>`;
  for (const uf of Object.keys(s.op.porUf).sort()) {
    const d = s.op.porUf[uf].desenho, m = d.metricas;
    h += m ? `<tr><td>${uf.toUpperCase()}</td><td class="n">${d.distritos.length}</td><td class="n">${siFmt(Math.round(d.alvo))}</td><td class="n${m.desvioMax > 0.15 ? ' menos' : ''}">${siPct(m.desvioMax)}</td>`
      + `<td class="n">${siPct(m.desvioMedio)}</td><td class="n">${siDec(m.compacidadeMedia, 2)}</td><td class="n">${m.municipiosDivididos}</td><td class="n">${m.zonas}${m.locais ? ` + ${siFmt(m.locais)} locais` : ''}</td>`
      + (pop ? (t => `<td${t.ok ? '' : ' class="menos"'}>${siToleranciaTxt(t)}</td>`)(sdToleranciaSenado(d.distritos)) : '') + '</tr>'
      : `<tr><td>${uf.toUpperCase()}</td><td class="n">0</td><td colspan="${pop ? 7 : 6}">${siEsc(d.erro || 'todas as vagas pela lista')}</td></tr>`;
  }
  return h + '</tbody></table></div>' + (pop ? '<div class="dica">Tolerância do PL 9.212/2017 (aprovado pelo Senado): cada distrito até ±5% da população-alvo; até ±10% em 1 distrito ou em 10% deles, o que for maior. '
    + 'O desenho daqui busca o menor desvio, mas não é obrigado a caber nela: a menor peça é o município (ou a zona eleitoral, no município grande demais).</div>' : '')
    + siBotaoLocais(siForaDaTolerancia());
}

/** Método e fontes — vai no fim do relatório em PDF. */
function siMetodoHtml() {
  const d = s => siEsc(siDescricao(s));
  const sist = Object.fromEntries(si.sistemas.map(s => [s.tipo, s]));
  const li = [];
  li.push(`<b>Votos.</b> ${si.op.fonte === 'resultados' ? `Servidor oficial de resultados do TSE (divulgação da eleição de ${si.op.ano}), um arquivo por estado` : `Dados abertos do TSE de ${si.op.ano} (votação por candidato e por partido, por município e zona)`}, lidos na hora. `
    + 'Votos válidos de cada candidato e de legenda de cada partido; candidato com voto anulado (sub judice) fica fora. A simulação mantém os votos como foram dados — noutro sistema, partidos, candidatos e eleitores agiriam de outro jeito.');
  if (sist.proporcional) li.push(`<b>Proporcional (atual)</b> — ${d(sist.proporcional)}. Código Eleitoral, arts. 106 a 111, com a Lei 14.211/2021 e a decisão do STF nas ADIs 7228, 7263 e 7325: `
    + 'quociente eleitoral (fração acima de meio arredonda), quociente partidário com candidato de 10% do QE, sobras pelas maiores médias (agremiação com 80% do QE e candidato com 20%), 3ª fase aberta a todas, art. 111 se ninguém alcança o QE; federação conta como uma agremiação. Com a regra vigente reproduz o resultado oficial (conferido em 2026 e 2022, nas 27 UFs).');
  if (sist.distritao) li.push('<b>Distritão</b> — o estado inteiro é um distrito: elegem-se os mais votados, até o número de vagas; voto de legenda não elege.');
  if (sist.misto) li.push(`<b>Distritão misto</b> — ${d(sist.misto)}. A parte da lista vai pela votação da agremiação (nominal + legenda) pelas maiores médias (D'Hondt); paralelo: a lista divide só a sua parte; compensatório: a proporção vale para o total e a lista completa quem ficou abaixo (o total de vagas não muda). A lista é preenchida pelos candidatos ainda não eleitos, na ordem de votos.`);
  if (sist.distrital) li.push(`<b>Distrital misto</b> — ${d(sist.distrital)}. Distritos desenhados aqui (não existem no Brasil): unidades = municípios (malha do IBGE; vizinhança pelas divisas) e, no município grande demais para um distrito, as zonas eleitorais (posição pelos locais de votação); `
    + `tamanho por ${sist.distrital.op.base === 'populacao' ? 'população residente do Censo 2022 (IBGE), repartida entre as zonas pelos eleitores' : 'eleitores aptos (TSE)'}; bisseção recursiva em vários eixos e trocas na fronteira, distritos contíguos; fica o desenho de menor desvio. `
    + `Quem leva o distrito: ${sist.distrital.op.regra === 'candidato' ? 'o candidato mais votado nele' : 'a agremiação mais votada nele, com o seu candidato mais votado ali'}; um candidato ganha um distrito só. A lista segue a regra do distritão misto. É um desenho possível entre muitos: outro mapa daria outro resultado.`);
  if (sist.distrital && Object.values(sist.distrital.op.porUf || {}).some(x => x.desenho.locais)) li.push('<b>Locais de votação.</b> Onde as zonas eleitorais eram grandes demais para caber na tolerância do PL 9.212 ('
    + Object.entries(sist.distrital.op.porUf).filter(([, x]) => x.desenho.locais).map(([uf]) => uf.toUpperCase()).sort().join(', ')
    + '), as zonas na fronteira entre distritos (e, se preciso, os municípios) se dividiram nos seus locais de votação (cadastro de locais do TSE: eleitores e posição), e as trocas na fronteira continuaram com essas peças, pesando também a compacidade. '
    + 'Os votos de cada local vêm da votação por seção do TSE, repartindo o total da zona na proporção dos votos de cada local (o local que mudou de número depois da eleição vai com o número de hoje).');
  if (sist.distrital && siEhSenado(sist.distrital.op)) li.push('<b>Projeto do Senado.</b> O distrital misto segue o PL 9.212/2017 (PLS 86/2017 e 345/2017, aprovados pelo Senado em 21/11/2017, na Câmara desde então): '
    + 'distritos em número igual à parte inteira da metade das vagas, desenhados por habitantes (tolerância de ±5%, ou ±10% em 1 distrito ou em 10% deles), contíguos e compactos; o mais votado leva o distrito; '
    + 'as vagas de cada partido saem das maiores médias sobre todas as vagas do estado (art. 105-B), as dos distritos contam dentro delas e, se um partido ganha mais distritos do que isso, fica com eles e as vagas saem das últimas posições da lista (art. 105-C), sem aumentar a Casa; sem quociente eleitoral nem cláusula (arts. 106 a 111 revogados). '
    + 'Aproximações: o projeto tem dois votos (no candidato do distrito e no partido) e lista preordenada pelo partido; os dados do TSE têm um voto, que vale para as duas partes, e a lista é preenchida na ordem de votos. '
    + 'O projeto é anterior às federações; aqui a federação conta como uma agremiação.');
  li.push('<b>Indicadores.</b> Número efetivo de partidos (Laakso-Taagepera) e índice de desproporcionalidade de Gallagher, sobre os estados comparáveis.');
  li.push(`<b>Fontes.</b> Tribunal Superior Eleitoral (resultados, dados abertos: votação por candidato e por partido, detalhe da votação e locais de votação); IBGE (malha municipal${sist.distrital && sist.distrital.op.base === 'populacao' ? ' e Censo Demográfico 2022, tabela 4709' : ''}). Nenhum dado de voto vem embutido na extensão.`);
  return `<h2 class="imp-quebra">Método e fontes</h2><ul class="metodo">${li.map(t => `<li>${t}</li>`).join('')}</ul>`;
}

// ------------------------------------------------------------ distritos: mapa e tabela
/** Cor de cada distrito: vizinhos (pela vizinhança das unidades) nunca com a mesma. */
function siCoresDistritos(base, desenho) {
  const de = new Map();
  for (const d of desenho.distritos) for (const i of d.unidades) de.set(i, d.id);
  const viz = {};
  for (const [i, ws] of Object.entries(base.viz)) for (const w of ws) {
    const a = de.get(i), b = de.get(w);
    if (a && b && a !== b) (viz[a] = viz[a] || new Set()).add(b);
  }
  const cor = {};
  for (const d of desenho.distritos) {
    const usadas = new Set([...(viz[d.id] || [])].map(v => cor[v]).filter(Boolean));
    cor[d.id] = SI_CORES_DIST.find(c => !usadas.has(c)) || SI_CORES_DIST[d.id % SI_CORES_DIST.length];
  }
  return { cor, de };
}

/**
 * O mapa do estado com os distritos (cor por distrito ou pelo partido do eleito).
 * Municípios inteiros pintados; município dividido em zonas fica neutro, com uma
 * bolinha por zona (tamanho pelo eleitorado). caixa: recorte [x0, y0, x1, y1] em km (zoom).
 */
function siMapaSvg(uf, x, eleicao, modo, caixa, larg, semRotulo) {
  const g = si.geo[siChaveGeo(uf)], { base, desenho } = x, proj = base.proj;
  const { cor, de } = siCoresDistritos(base, desenho);
  const cores = siCores(snOrdemPartidos(si.res));
  const venc = {};
  for (const d of eleicao.distritos || []) venc[d.id] = d.vencedor;
  const corDe = id => modo === 'partido' ? (venc[id] ? cores[venc[id].partido] || SI_COR_OUTROS : '#2a3a4a') : cor[id];
  const porIbge = {};
  for (const u of base.unidades) if (u.ibge) (porIbge[u.ibge] = porIbge[u.ibge] || []).push(u);
  const aneis = {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of Object.values(g.malha.feicoes)) {
    aneis[f.id] = f.poligonos.flatMap(p => p.map(r => r.map(proj)));
    for (const r of aneis[f.id]) for (const [a, b] of r) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  }
  if (caixa) [x0, y0, x1, y1] = caixa;
  const W = larg || 640, esc = W / ((x1 - x0) || 1), H = Math.max(80, Math.round((y1 - y0) * esc));
  const sx = a => ((a - x0) * esc).toFixed(1), sy = b => ((y1 - b) * esc).toFixed(1);
  let h = '';
  for (const [id, rs] of Object.entries(aneis)) {
    const us = porIbge[id] || [];
    const dividido = us.some(u => u.id.startsWith('z:') || u.id.startsWith('l:'));
    const fill = !us.length ? '' : dividido ? '' : ` fill="${corDe(de.get(us[0].id))}"`;
    const cls = !us.length ? ' class="fora"' : dividido ? ' class="div"' : '';
    const d = rs.map(r => 'M' + r.map(([a, b]) => sx(a) + ',' + sy(b)).join('L') + 'Z').join('');
    h += `<path${cls}${fill} d="${d}"><title>${siEsc(us[0] ? (us[0].nome.split(' · ')[0] + (dividido ? ' (dividido em zonas)' : ' — distrito ' + de.get(us[0].id))) : '')}</title></path>`;
  }
  const zonas = base.unidades.filter(u => u.id.startsWith('z:'));
  const maxApt = Math.max(1, ...zonas.map(u => u.aptos));
  const rz = caixa || Object.keys(g.malha.feicoes).length <= 1 ? 10 : 4.5;   // DF: o estado é um município só
  for (const u of zonas) {
    h += `<circle class="z" cx="${sx(u.x)}" cy="${sy(u.y)}" r="${(rz * Math.sqrt(u.aptos / maxApt) + 1.5).toFixed(1)}" fill="${corDe(de.get(u.id))}"><title>${siEsc(u.nome)} — distrito ${de.get(u.id)}</title></circle>`;
  }
  // locais de votação (desenho afinado): pontos pequenos
  const rl = caixa || Object.keys(g.malha.feicoes).length <= 1 ? 2.6 : 1.6;
  for (const u of base.unidades) if (u.id.startsWith('l:')) {
    h += `<circle class="z" cx="${sx(u.x)}" cy="${sy(u.y)}" r="${rl}" fill="${corDe(de.get(u.id))}"><title>${siEsc(u.nome)} — distrito ${de.get(u.id)}</title></circle>`;
  }
  const fonte = caixa ? 11 : desenho.distritos.length > 30 ? 8 : 10;
  for (const d of desenho.distritos) {
    if (caixa && (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1)) continue;
    // no mapa do estado, os distritos da capital ficam numerados só no recorte ao lado
    if (semRotulo && d.x >= semRotulo[0] && d.x <= semRotulo[2] && d.y >= semRotulo[1] && d.y <= semRotulo[3]) continue;
    h += `<text x="${sx(d.x)}" y="${sy(d.y)}" font-size="${fonte}">${d.id}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${h}</svg>`;
}

/** Recorte do maior município dividido em zonas (a capital, quase sempre), com folga. */
function siCaixaCapital(uf, base) {
  const g = si.geo[siChaveGeo(uf)];
  const conta = {};
  for (const u of base.unidades) if ((u.id.startsWith('z:') || u.id.startsWith('l:')) && u.ibge) conta[u.ibge] = (conta[u.ibge] || 0) + u.aptos;
  const ibge = Object.keys(conta).sort((a, b) => conta[b] - conta[a])[0];
  if (!ibge || !g.malha.feicoes[ibge]) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of g.malha.feicoes[ibge].poligonos) for (const r of p) for (const pt of r) { const [a, b] = base.proj(pt); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  const m = Math.max(x1 - x0, y1 - y0) * 0.15;
  const nome = base.unidades.find(u => u.ibge === ibge).nome.split(' · ')[0];
  return { caixa: [x0 - m, y0 - m, x1 + m, y1 + m], nome };
}

function siDistritosHtml(uf, sd, impressao) {
  const x = si.sistemas.find(s => s.tipo === 'distrital').op.porUf[uf];
  const el = sd.porUf[uf] || {};
  const { desenho, base } = x;
  let h = `<h2${impressao ? ' class="imp-quebra"' : ''} id="siDistritos">Distritos de ${siEsc(siUfNome(uf))} <small>distrital misto · ${siEsc(siDescricao(si.sistemas.find(s => s.tipo === 'distrital'), true))}</small></h2>`;
  if (!desenho.distritos.length) return h + '<div class="dica">Nenhuma vaga em distritos: todas pela lista.</div>';
  if (desenho.erro) return h + `<div class="aviso">${siEsc(desenho.erro)}</div>`;
  const m = desenho.metricas, U = new Map(base.unidades.map(u => [u.id, u]));
  const pop = desenho.base === 'populacao';
  if (desenho.popErro) h += `<div class="aviso">A população do Censo 2022 não veio do IBGE (${siEsc(desenho.popErro)}): os distritos foram desenhados pelo eleitorado. Mude qualquer parâmetro para tentar de novo.</div>`;
  if (pop && desenho.semPopulacao && desenho.semPopulacao.length) h += `<div class="dica">Sem população no IBGE para ${siEsc(desenho.semPopulacao.join(', '))}: entram pelos eleitores, na razão população/eleitores do estado.</div>`;
  const ruim = m.desvioMax > 0.15;
  h += `<div class="metr"><span><b>${desenho.distritos.length}</b> distritos${desenho.pedidos ? ` (pedidos ${desenho.pedidos}: o estado não tem unidades para tantos)` : ''}</span>`
    + `<span>alvo <b>${siFmt(Math.round(desenho.alvo))}</b> ${pop ? 'habitantes (Censo 2022)' : 'eleitores'} por distrito</span>`
    + `<span${ruim ? ' class="ruim"' : ''}>desvio máximo <b>${siPct(m.desvioMax)}</b> (médio ${siPct(m.desvioMedio)})</span>`
    + `<span>compacidade média <b>${m.compacidadeMedia.toFixed(2).replace('.', ',')}</b> (1 = círculo)</span>`
    + `<span>municípios divididos <b>${m.municipiosDivididos}</b></span>`
    + `<span>${m.contiguos ? 'todos contíguos' : '<b>há distrito não contíguo</b>'}</span>`
    + `<span>unidades: ${m.unidades - m.zonas - (m.locais || 0)} municípios + ${m.zonas} zonas${m.locais ? ` + ${siFmt(m.locais)} locais de votação` : ''}</span>`
    + (pop ? (t => `<span${t.ok ? '' : ' class="ruim"'}>tolerância do PL 9.212 (±5%): <b>${siToleranciaTxt(t)}</b></span>`)(sdToleranciaSenado(desenho.distritos)) : '') + '</div>';
  if (desenho.locais) h += `<div class="dica">Afinado com os locais de votação: as zonas na fronteira entre distritos${m.municipiosDivididos ? ' (e, se preciso, os municípios)' : ''} se dividiram nos seus locais (pontos menores no mapa), cada um com os seus eleitores e os seus votos na votação por seção do TSE.</div>`;
  else if (!sdToleranciaSenado(desenho.distritos).ok) h += siBotaoLocais(si.locais[siChaveLocais(uf)] ? [] : [uf]);
  if (pop) h += `<div class="dica">Tamanho pela população residente do Censo 2022 (IBGE). Num município dividido em zonas, a população se reparte entre elas na proporção dos eleitores (o censo não tem recorte por zona eleitoral).</div>`;
  if (ruim) h += `<div class="dica">Desvio acima de 15% (a referência alemã: até ±15%, e redesenho obrigatório acima de ±25%): as zonas eleitorais são grandes para distritos deste tamanho — a menor peça do desenho é a zona.</div>`;
  const cap = Object.keys(si.geo[siChaveGeo(uf)].malha.feicoes).length > 1 ? siCaixaCapital(uf, base) : null;
  const modo = si.mapaModo;
  const botoes = impressao ? '' : `<div class="seg" id="siMapaModo" style="margin-bottom:6px"><button data-mm="distrito"${modo === 'distrito' ? ' class="ativo"' : ''}>Cor por distrito</button><button data-mm="partido"${modo === 'partido' ? ' class="ativo"' : ''}>Cor pelo partido eleito</button></div>`;
  h += botoes + `<div class="mapas-d"><div class="mapa-d"><div class="t"><b>${siEsc(siUfNome(uf))}</b> · número = distrito; bolinhas = zonas eleitorais de município dividido${cap ? ' (os distritos de ' + siEsc(cap.nome.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())) + ' estão numerados no recorte)' : ''}</div>${siMapaSvg(uf, x, el, modo, null, 640, cap && cap.caixa)}</div>`
    + (cap ? `<div class="mapa-d"><div class="t"><b>${siEsc(cap.nome)}</b> e arredores, por zona eleitoral</div>${siMapaSvg(uf, x, el, modo, cap.caixa, 420)}</div>` : '<div></div>') + '</div>';
  // tabela
  const nomes = d => {
    const porMun = {};
    for (const i of d.unidades) {
      const u = U.get(i), n = u.nome.split(' · ')[0];
      (porMun[n] = porMun[n] || { n, apt: 0, zonas: [] }).apt += u.aptos;
      const z = u.id.startsWith('z:') ? u.zonas[0] : u.id.startsWith('l:') ? u.zonas[0] + ' (parte)' : null;
      if (z && !porMun[n].zonas.includes(z)) porMun[n].zonas.push(z);
    }
    const l = Object.values(porMun).sort((a, b) => b.apt - a.apt);
    return l.slice(0, 4).map(o => siEsc(o.n) + (o.zonas.length ? ` <span class="igual">(zona${o.zonas.length > 1 ? 's' : ''} ${o.zonas.join(', ')})</span>` : '')).join(', ') + (l.length > 4 ? ` <span class="igual">+${l.length - 4}</span>` : '');
  };
  const venc = {};
  for (const d of el.distritos || []) venc[d.id] = d;
  h += `<div class="tab-rolagem" style="margin-top:10px"><table><thead><tr><th class="n">Distrito</th><th class="n">${pop ? 'Habitantes' : 'Eleitores'}</th><th class="n">Desvio</th><th>Municípios</th><th>Eleito</th><th>Partido</th><th class="n">Votos no distrito</th><th class="n">Agremiação</th><th>2ª agremiação</th></tr></thead><tbody>`;
  for (const d of desenho.distritos) {
    const v = venc[d.id] || {}, w = v.vencedor, s2 = v.segundo;
    h += `<tr${w && w.partido === SI_PARTIDO ? ' class="pode"' : ''}><td class="n">${d.id}</td><td class="n">${siFmt(Math.round(d.aptos))}</td><td class="n">${(d.desvio >= 0 ? '+' : '') + siPct(d.desvio)}</td>`
      + `<td style="white-space:normal">${nomes(d)}</td><td>${w ? siEsc(w.nome) : '—'}</td><td>${w ? siEsc(w.partido) : ''}</td>`
      + `<td class="n">${w ? siFmt(w.votos) + ' (' + siPct(w.pct) + ')' : ''}</td><td class="n">${w ? siPct(w.agrPct) : ''}</td>`
      + `<td>${s2 ? siEsc(s2.nome) + ' · ' + siPct(s2.pct) : ''}</td></tr>`;
  }
  h += '</tbody></table></div><div class="dica">"Agremiação": a fatia da agremiação do eleito nos votos válidos do distrito (nominais + legenda). '
    + 'Os votos são os do proporcional: num distrital, cada partido lançaria um candidato por distrito — por isso o eleito pode ter poucos votos pessoais ali.</div>';
  return h;
}

// ------------------------------------------------------------ PDF
async function siPdf() {
  if (!si.res) return;
  const logo = (document.querySelector('.topo img') || {}).src || '';
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const ufs = Object.keys(si.dados);
  const alvo = ufs.length === 1 ? siUfNome(ufs[0]) : 'Brasil';
  const el = $('siImpressao');
  el.innerHTML = `<div class="imp-cab">${logo ? `<img src="${logo}" alt="Podemos">` : ''}<div><div class="imp-org">Liderança do Podemos na Câmara dos Deputados</div>
      <h1>Sistemas eleitorais: relatório comparativo — ${siEsc(siCargoNome())}, ${si.op.ano} (${siEsc(alvo)})</h1>
      <div class="imp-sub">Os votos oficiais da eleição redistribuídos por sistema · fonte: TSE (${si.op.fonte === 'resultados' ? 'servidor oficial de resultados' : 'dados abertos'}) · gerado em ${siEsc(agora)}</div></div></div>
    <div class="imp-filete"></div>
    ${si.sistemas.map(s => `<div class="imp-param"><b>${siEsc(s.nome)}:</b> ${siEsc(siDescricao(s))}</div>`).join('')}
    ${$('siAvisos').innerHTML}
    ${siRelatorioHtml(true)}
    ${siMetodoHtml()}
    <div class="imp-rodape">As simulações mantêm os votos como foram dados — noutro sistema, eleitores e partidos se comportariam de outro jeito. O proporcional com a regra vigente
      reproduz o resultado oficial do TSE. Painel desenvolvido pela Liderança do Podemos na Câmara dos Deputados.</div>`;
  const titulo = document.title;
  document.title = `Sistemas eleitorais - ${si.cargo === '6' ? 'federal' : 'estadual'} ${si.op.ano} - ${alvo}`;
  const volta = () => { document.title = titulo; window.removeEventListener('afterprint', volta); };
  window.addEventListener('afterprint', volta);
  await Promise.all([...el.querySelectorAll('img')].map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => {})));
  window.print();
}

// ------------------------------------------------------------ início
async function siIniciar() {
  for (const [uf, nome] of Object.entries(AP_UFS).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) {
    $('siUf').insertAdjacentHTML('beforeend', `<option value="${uf}">${siEsc(nome)}</option>`);
  }
  $('siEleicao').addEventListener('change', () => siLer());
  $('siUf').addEventListener('change', () => siLer());
  $('siLer').addEventListener('click', () => siLer(true));
  $('siPdf').addEventListener('click', siPdf);
  $('siRegra').addEventListener('click', siRegraVigente);
  $('siCargo').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-c]');
    if (!b || b.dataset.c === si.cargo) return;
    si.cargo = b.dataset.c;
    for (const x of $('siCargo').querySelectorAll('button')) x.classList.toggle('ativo', x === b);
    siLer();
  });
  $('dSenado').addEventListener('click', siRegraSenado);
  for (const [id, attr] of [['mModelo', 'm'], ['dModelo', 'm'], ['dRegra', 'r'], ['dBase', 'b'], ['dArr', 'a']]) {
    $(id).addEventListener('click', ev => {
      const b = ev.target.closest(`button[data-${attr}]`);
      if (!b) return;
      for (const x of $(id).querySelectorAll('button')) x.classList.toggle('ativo', x === b);
      siParametrosMudaram();
    });
  }
  for (const id of ['pQP', 'pPart', 'pCand', 'pTerc', 'pFed', 'mPct', 'mLim', 'dPct', 'dLim']) {
    $(id).addEventListener('input', siParametrosMudaram);
    $(id).addEventListener('change', siParametrosMudaram);
  }
  $('siResultado').addEventListener('click', ev => {
    const bl = ev.target.closest('button[data-locais]');
    if (bl) { siLerLocais(bl.dataset.locais.split(',')); return; }
    const mm = ev.target.closest('button[data-mm]');
    if (mm) { si.mapaModo = mm.dataset.mm; $('siResultado').innerHTML = siRelatorioHtml(false); return; }
    const tr = ev.target.closest('tr[data-uf]');
    if (!tr) return;
    si.ufSel = si.ufSel === tr.dataset.uf ? '' : tr.dataset.uf;
    $('siResultado').innerHTML = siRelatorioHtml(false);
    const det = $('siDetalhe');
    if (det && si.ufSel) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  siMarcarAlterados();

  let ops;
  try { ops = apEleicoesGerais(await zrJson(`${AP_BASE}/comum/config/ele-c.json`)); }
  catch (_) { ops = [apEleicaoReserva()]; }
  si.eleicoes = snEleicoes(ops);
  $('siEleicao').innerHTML = si.eleicoes.map(o => `<option value="${siEsc(o.id)}">${o.ano} — ${o.fonte === 'resultados' ? 'divulgação oficial do TSE' : 'dados abertos do TSE'}</option>`).join('');
  // A eleição corrente (um JSON por estado) carrega sozinha; os dados abertos esperam o clique.
  if (si.eleicoes[0] && si.eleicoes[0].fonte === 'resultados') siLer();
  else siStatus('Escolha a eleição e clique em <b>Ler dados do TSE</b>.');
}

if (typeof document !== 'undefined' && document.getElementById('siSistemas')) siIniciar();
