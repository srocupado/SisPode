'use strict';
// Labs · Placar Preditivo e mapa de votos.
//
// A pergunta: antes da votação, quem tende a seguir uma orientação (a do
// Governo, a do PODE, a de outro partido)? E, sobretudo, quem está no meio —
// os indecisos, de quem o resultado depende?
//
// A conta é ABERTA, sem IA, e cada linha diz de onde saiu:
//   p_geral = (vezes que seguiu + 1) / (votações comparáveis + 2)
// — a correção "+1/+2" (Laplace) impede que 1 de 1 vire 100% de certeza. Com
// tema escolhido, mistura-se o histórico no tema, com peso que cresce com o
// número de votações do tema:  p = w·p_tema + (1−w)·p_geral,  w = n_tema/(n_tema+5).
// "Votação comparável" = nominal do Plenário, em que a referência orientou Sim
// ou Não e o deputado votou Sim ou Não. Abstenção, obstrução e ausência não
// entram — presença não é modelada, e a tela diz isso.
//
// A campanha de votos (opcional) registra quem foi procurado, por quem e com
// que resposta, no banco compartilhado — é o "mapa de votos" da equipe.
//
// Depende de labs.js.

const PL_FAIXAS = [
  { k: 'f3', rot: 'Indecisos',              min: 0.35, max: 0.65 },
  { k: 'f4', rot: 'Tendem a seguir',        min: 0.65, max: 0.85 },
  { k: 'f2', rot: 'Tendem a não seguir',    min: 0.15, max: 0.35 },
  { k: 'f5', rot: 'Seguem quase sempre',    min: 0.85, max: 1.01 },
  { k: 'f1', rot: 'Quase nunca seguem',     min: -1,   max: 0.15 },
];
const PL_MIN_HISTORICO = 3;         // abaixo disso, "sem histórico suficiente"
const PL_PESO_TEMA = 5;             // n_tema para o tema pesar metade
const PL_CAMPANHAS = '/labs/placar/campanhas';
const PL_STATUS = {
  '':        'não contatado',
  vai:       'vai seguir',
  contra:    'não vai seguir',
  indeciso:  'indeciso',
  ausente:   'estará ausente',
  retorno:   'aguardando retorno',
};

const pl = { cacheVot: {}, temasProp: new Map(), resultado: null, campanha: null };

/** A faixa de uma probabilidade. */
function plFaixa(p) { return PL_FAIXAS.find(f => p >= f.min && p < f.max) || PL_FAIXAS[0]; }

/**
 * O cálculo, puro: dados (votações com votos e orientações), referência, tema
 * opcional (Set de ids de votação do tema) e deputados. Devolve uma linha por
 * deputado, com a base da conta.
 */
function plCalcular(itens, ref, deputados, idsDoTema) {
  const conta = new Map();   // depId → { n, s, nt, st }
  let comparaveis = 0;
  for (const it of itens) {
    const ori = labsOrientacao(it.orientacoes, ref);
    if (!ori) continue;
    comparaveis++;
    const doTema = idsDoTema ? idsDoTema.has(it.votacao.id) : false;
    for (const v of it.votos) {
      const voto = labsSimNao(v.tipoVoto);
      const id = v.deputado_ && v.deputado_.id;
      if (!voto || id == null) continue;
      const c = conta.get(id) || { n: 0, s: 0, nt: 0, st: 0 };
      c.n++; if (voto === ori) c.s++;
      if (doTema) { c.nt++; if (voto === ori) c.st++; }
      conta.set(id, c);
    }
  }
  const linhas = deputados.map(d => {
    const c = conta.get(d.id) || { n: 0, s: 0, nt: 0, st: 0 };
    if (c.n < PL_MIN_HISTORICO) return { ...d, ...c, p: null, faixa: 'f0' };
    const pg = (c.s + 1) / (c.n + 2);
    let p = pg;
    if (idsDoTema && c.nt) {
      const pt = (c.st + 1) / (c.nt + 2);
      const w = c.nt / (c.nt + PL_PESO_TEMA);
      p = w * pt + (1 - w) * pg;
    }
    return { ...d, ...c, p, faixa: plFaixa(p).k };
  });
  return { linhas, comparaveis };
}

/** A base da conta, em texto, para cada linha. */
function plBase(l, comTema) {
  if (l.p == null) return `só ${l.n} votação(ões) comparável(is) no período — histórico insuficiente`;
  const pct = x => Math.round(x * 100) + '%';
  let t = `seguiu ${l.s} de ${l.n} (${pct(l.s / l.n)})`;
  if (comTema) t += l.nt ? ` · no tema: ${l.st} de ${l.nt}` : ' · sem votação no tema';
  return t;
}

// ---------- tela ----------
const plEl = id => document.getElementById(id);

function plRef() {
  const v = plEl('plRef').value;
  return v === '__outro' ? String(plEl('plRefOutro').value || '').trim().toUpperCase() : v;
}

async function plCarregarTemas() {
  try {
    const j = await labsJson(`${LABS_API}/referencias/proposicoes/codTema`);
    const ts = (j.dados || []).map(t => ({ cod: String(t.cod), nome: t.nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    plEl('plTema').innerHTML = '<option value="">— todos os temas —</option>' +
      ts.map(t => `<option value="${labsEsc(t.cod)}">${labsEsc(t.nome)}</option>`).join('');
  } catch (e) {
    plEl('plTema').innerHTML = '<option value="">(lista de temas não carregou — só todos os temas)</option>';
  }
}

/** Ids das votações cuja proposição tem o tema (uma chamada por proposição, com cache). */
async function plIdsDoTema(itens, codTema, aoAndar) {
  const porProp = new Map();
  for (const it of itens) {
    const idp = String(it.votacao.id).split('-')[0];
    if (!porProp.has(idp)) porProp.set(idp, []);
    porProp.get(idp).push(it.votacao.id);
  }
  const props = [...porProp.keys()];
  let falhas = 0;
  await labsMapLimit(props, 6, async idp => {
    if (pl.temasProp.has(idp)) return;
    try {
      const j = await labsJson(`${LABS_API}/proposicoes/${idp}/temas`);
      pl.temasProp.set(idp, (j.dados || []).map(t => String(t.codTema)));
    } catch (e) { falhas++; }
  }, (f, t) => aoAndar && aoAndar(`Lendo os temas das proposições votadas… ${f}/${t}`));
  const ids = new Set();
  for (const [idp, vs] of porProp) if ((pl.temasProp.get(idp) || []).includes(String(codTema))) vs.forEach(v => ids.add(v));
  return { ids, falhas };
}

function plSlug(nome) { return labsNorm(nome).replace(/\s+/g, '-').slice(0, 80) || 'campanha'; }

async function plCarregarCampanha(nome) {
  if (!nome) return null;
  const slug = plSlug(nome);
  try {
    const d = await labsJson(`${LABS_FIREBASE}${PL_CAMPANHAS}/${slug}.json`);
    return { slug, nome, contatos: (d && d.contatos) || {} };
  } catch (e) {
    return { slug, nome, contatos: {}, erro: e.message };
  }
}

async function plSalvarContato(depId, dados) {
  const c = pl.campanha;
  if (!c) return;
  const base = `${LABS_FIREBASE}${PL_CAMPANHAS}/${c.slug}`;
  const r1 = await fetch(`${base}.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: c.nome, ref: pl.resultado ? pl.resultado.ref : '', atualizadoEm: new Date().toISOString() }) });
  const r2 = await fetch(`${base}/contatos/${depId}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados) });
  if (!r1.ok || !r2.ok) throw new Error('HTTP ' + (r1.ok ? r2.status : r1.status));
  c.contatos[depId] = dados;
}

async function plCalcularClick() {
  const ref = plRef();
  if (!ref) return labsStatus('plStatus', 'Informe a sigla do partido de referência.', 'error');
  const meses = Number(plEl('plMeses').value) || 12;
  const codTema = plEl('plTema').value;
  const nomeTema = codTema ? plEl('plTema').selectedOptions[0].textContent : '';
  plEl('plCalcular').disabled = true;
  plEl('plResultado').innerHTML = '';
  const andar = m => labsStatus('plStatus', m, 'loading');
  try {
    if (!pl.cacheVot[meses]) pl.cacheVot[meses] = await labsVotacoesPlenario(meses, andar);
    const dados = pl.cacheVot[meses];
    andar('Buscando os deputados em exercício…');
    const deputados = await labsDeputadosAtuais();
    let tema = null;
    if (codTema) tema = await plIdsDoTema(dados.itens, codTema, andar);
    const { linhas, comparaveis } = plCalcular(dados.itens, ref, deputados, tema ? tema.ids : null);
    if (!comparaveis) {
      labsStatus('plStatus', `Nenhuma votação do período com orientação Sim/Não de "${ref}". Confira a sigla ou amplie o período.`, 'error');
      return;
    }
    pl.campanha = await plCarregarCampanha(String(plEl('plCampanha').value || '').trim());
    pl.resultado = { ref, meses, linhas, comparaveis, tema: codTema ? { cod: codTema, nome: nomeTema, n: tema.ids.size, falhas: tema.falhas } : null,
                     periodo: dados.periodo, falhas: dados.falhas, total: dados.itens.length };
    labsStatus('plStatus', '');
    plRender();
  } catch (e) {
    labsStatus('plStatus', 'Erro: ' + e.message, 'error');
  } finally {
    plEl('plCalcular').disabled = false;
  }
}

function plRender() {
  const r = pl.resultado;
  if (!r) return;
  const c = pl.campanha;
  const filtro = { nome: labsNorm((plEl('plFNome') || {}).value), partido: String((plEl('plFPartido') || {}).value || '').trim().toUpperCase(),
                   faixa: (plEl('plFFaixa') || {}).value || '' };
  const comHist = r.linhas.filter(l => l.p != null);
  const esperado = comHist.reduce((s, l) => s + l.p, 0);
  const cont = k => r.linhas.filter(l => l.faixa === k).length;
  // Com campanha, o contato registrado vence o histórico: "vai seguir" conta 1,
  // "não vai seguir" e "ausente" contam 0.
  const ajustado = c ? r.linhas.reduce((s, l) => {
    const st = (c.contatos[l.id] || {}).status;
    if (st === 'vai') return s + 1;
    if (st === 'contra' || st === 'ausente') return s;
    return s + (l.p == null ? 0 : l.p);
  }, 0) : null;

  const passa = l => (!filtro.nome || labsNorm(l.nome).includes(filtro.nome))
    && (!filtro.partido || l.partido === filtro.partido) && (!filtro.faixa || l.faixa === filtro.faixa);
  const ordem = [...PL_FAIXAS.map(f => f.k), 'f0'];
  const rotulo = k => (PL_FAIXAS.find(f => f.k === k) || { rot: 'Sem histórico suficiente' }).rot;
  const cor = p => p == null ? 'var(--absent)' : p >= .85 ? 'var(--sim)' : p >= .65 ? '#8fe0b0' : p >= .35 ? 'var(--abstencao)' : p >= .15 ? '#f59a8a' : 'var(--nao)';

  const linhaHtml = l => {
    const ct = c ? (c.contatos[l.id] || {}) : null;
    return `<tr>
      <td><b>${labsEsc(l.nome)}</b> <span class="base">${labsEsc(l.partido)}-${labsEsc(l.uf)}</span></td>
      <td style="width:140px">${l.p == null ? '<span class="base">—</span>'
        : `${Math.round(l.p * 100)}%<div class="labs-barra"><div style="width:${Math.round(l.p * 100)}%;background:${cor(l.p)}"></div></div>`}</td>
      <td class="base">${labsEsc(plBase(l, !!r.tema))}</td>
      ${c ? `<td style="width:170px"><select data-pl-status="${l.id}">${Object.entries(PL_STATUS).map(([k, v]) =>
              `<option value="${k}"${(ct.status || '') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
            <td style="width:220px"><input data-pl-nota="${l.id}" value="${labsEsc(ct.nota || '')}" placeholder="anotação" maxlength="140">
              ${ct.quem || ct.em ? `<div class="base">${labsEsc(ct.quem || '')}${ct.em ? ' · ' + labsEsc(new Date(ct.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })) : ''}</div>` : ''}</td>` : ''}
    </tr>`;
  };

  const grupos = ordem.map(k => {
    const ls = r.linhas.filter(l => l.faixa === k && passa(l)).sort((a, b) => (b.p ?? -1) - (a.p ?? -1));
    return ls.length ? `<tr class="grupo"><td colspan="${c ? 5 : 3}">${rotulo(k)} (${ls.length})</td></tr>${ls.map(linhaHtml).join('')}` : '';
  }).join('');

  plEl('plResultado').innerHTML = `
    <div class="cv-cab">
      <h3>Orientação de referência: ${labsEsc(r.ref)}${r.tema ? ` · tema ${labsEsc(r.tema.nome)}` : ''}</h3>
      <div class="sub">Período ${r.periodo.map(d => d.split('-').reverse().join('/')).join(' a ')} · ${r.comparaveis} votação(ões) nominais
        do Plenário com orientação Sim/Não de ${labsEsc(r.ref)}${r.tema ? ` · ${r.tema.n} delas do tema` : ''}.
        ${r.falhas ? `<br>⚠ ${r.falhas} votação(ões) não puderam ser lidas agora e ficaram fora da conta.` : ''}
        ${r.tema && r.tema.falhas ? `<br>⚠ O tema de ${r.tema.falhas} proposição(ões) não pôde ser lido.` : ''}</div>
      <div class="labs-cards">
        <div class="labs-card"><div class="v">${Math.round(esperado)}</div><div class="l">Seguem a orientação (esperado)</div></div>
        ${c ? `<div class="labs-card"><div class="v">${Math.round(ajustado)}</div><div class="l">Com os contatos registrados</div></div>` : ''}
        <div class="labs-card f5"><div class="v">${cont('f5')}</div><div class="l">Quase sempre</div></div>
        <div class="labs-card f4"><div class="v">${cont('f4')}</div><div class="l">Tendem a seguir</div></div>
        <div class="labs-card f3"><div class="v">${cont('f3')}</div><div class="l">Indecisos</div></div>
        <div class="labs-card f2"><div class="v">${cont('f2')}</div><div class="l">Tendem a não seguir</div></div>
        <div class="labs-card f1"><div class="v">${cont('f1')}</div><div class="l">Quase nunca</div></div>
        <div class="labs-card f0"><div class="v">${cont('f0')}</div><div class="l">Sem histórico</div></div>
      </div>
      <div class="sub">O "esperado" soma as probabilidades dos ${comHist.length} deputados com histórico, supondo presença de
        todos — presença não é modelada. Os indecisos vêm primeiro na lista: é neles que o trabalho de votos rende.</div>
      ${c ? `<div class="sub" style="margin-top:6px">Campanha <b>${labsEsc(c.nome)}</b> — os contatos ficam gravados no banco,
        visíveis para a equipe.${c.erro ? ` ⚠ Não consegui ler os contatos já gravados (${labsEsc(c.erro)}).` : ''}</div>` : ''}
    </div>
    <div class="labs-row" style="margin:10px 0">
      <div><input id="plFNome" class="field" placeholder="Filtrar por nome" value="${labsEsc((plEl('plFNome') || {}).value || '')}"></div>
      <div style="flex:0 0 130px"><input id="plFPartido" class="field" placeholder="Partido" value="${labsEsc(filtro.partido)}"></div>
      <div style="flex:0 0 200px"><select id="plFFaixa" class="field"><option value="">Todas as faixas</option>
        ${[...PL_FAIXAS, { k: 'f0', rot: 'Sem histórico suficiente' }].map(f => `<option value="${f.k}"${filtro.faixa === f.k ? ' selected' : ''}>${f.rot}</option>`).join('')}</select></div>
    </div>
    <div class="cv-lista" style="max-height:640px;overflow:auto">
      <table class="labs-tab"><thead><tr><th>Deputado</th><th>Chance de seguir</th><th>Base da conta</th>
        ${c ? '<th>Contato</th><th>Anotação</th>' : ''}</tr></thead><tbody>${grupos || '<tr><td colspan="5">Nenhum deputado no filtro.</td></tr>'}</tbody></table>
    </div>`;

  ['plFNome', 'plFPartido'].forEach(id => plEl(id).addEventListener('input', () => {
    const pos = plEl(id).selectionStart; plRender(); const el = plEl(id); el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {}
  }));
  plEl('plFFaixa').addEventListener('change', plRender);
  document.querySelectorAll('[data-pl-status]').forEach(s => s.addEventListener('change', () => plRegistrar(s.dataset.plStatus)));
  document.querySelectorAll('[data-pl-nota]').forEach(i => i.addEventListener('change', () => plRegistrar(i.dataset.plNota)));
}

async function plRegistrar(depId) {
  const status = (document.querySelector(`[data-pl-status="${depId}"]`) || {}).value || '';
  const nota = String((document.querySelector(`[data-pl-nota="${depId}"]`) || {}).value || '').trim();
  const quem = String(plEl('plQuem').value || '').trim();
  try { localStorage.setItem('labsPlQuem', quem); } catch (_) {}
  try {
    await plSalvarContato(depId, { status, nota, quem, em: new Date().toISOString() });
    labsStatus('plStatus', 'Contato registrado.');
    plRender();
  } catch (e) {
    labsStatus('plStatus', 'Não gravou o contato no banco: ' + e.message, 'error');
  }
}

if (plEl('plCalcular')) {
  plEl('plCalcular').addEventListener('click', plCalcularClick);
  plEl('plRef').addEventListener('change', () => { plEl('plRefOutro').hidden = plEl('plRef').value !== '__outro'; });
  try { plEl('plQuem').value = localStorage.getItem('labsPlQuem') || ''; } catch (_) {}
  plCarregarTemas();
}
