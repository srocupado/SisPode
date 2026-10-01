'use strict';
// Orçamento · Comparador de Portarias — TELA (etapa 1: montar a sequência).
//
// O analista reúne os atos que regulam um procedimento (de um ou mais órgãos),
// por arquivo (PDF com texto, .docx), texto colado ou link do DOU. Cada ato tem
// o cabeçalho reconhecido por regra (portarias-leitura.js) e entra na sequência
// em ordem cronológica; tudo é editável, porque a ordem é a espinha da nota
// ("como era → como ficou" a cada novo ato).
//
// A etapa 2 (leitura estruturada, comparação, gráficos e nota) usa esta lista.

const pt = { docs: [], seq: 0 };

// Abaixo disto, o "PDF" provavelmente é imagem escaneada (sem texto extraível).
const PT_MIN_TEXTO = 200;

function ptEl(id) { return document.getElementById(id); }
function ptEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ptStatus(msg, tipo) {
  const el = ptEl('pt-status');
  if (!msg) { el.innerHTML = ''; return; }
  const cls = tipo === 'erro' ? 'on-falha' : tipo === 'ok' ? 'on-ok' : 'on-pend';
  el.innerHTML = `<div class="${cls}">${tipo === 'carregando' ? '<span class="on-spinner"></span> ' : ''}${msg}</div>`;
}

/** Inclui um ato na sequência (com o cabeçalho reconhecido) e reordena por data. */
function ptIncluir(texto, origem, extra) {
  const t = String(texto || '').trim();
  const cab = ptCabecalho(t);
  const doc = Object.assign({
    id: ++pt.seq, texto: t, origem,
    tipo: cab.tipo, sigla: cab.sigla, numero: cab.numero, data: cab.data, orgao: cab.orgao,
    identificacao: cab.identificacao,
    avisos: [],
  }, extra || {});
  if (extra && extra.orgao && !cab.orgao) doc.orgao = extra.orgao;
  if (t.length < PT_MIN_TEXTO) doc.avisos.push('pouco texto — se for PDF escaneado (imagem), cole o texto ou use o link do DOU');
  if (!cab.identificacao) doc.avisos.push('cabeçalho não reconhecido — preencha identificação e data');
  // Ato repetido (mesma identificação) é avisado, não descartado: pode ser retificação.
  if (doc.identificacao && pt.docs.some(d => d.identificacao && ptNorm(d.identificacao) === ptNorm(doc.identificacao))) {
    doc.avisos.push('mesma identificação de outro ato da lista — confira se não é duplicado');
  }
  pt.docs.push(doc);
  pt.docs = ptOrdenar(pt.docs);
  ptRender();
  return doc;
}

async function ptArquivosChange() {
  const arqs = [...(ptEl('pt-arquivos').files || [])];
  if (!arqs.length) return;
  let ok = 0;
  const erros = [];
  for (let i = 0; i < arqs.length; i++) {
    const a = arqs[i];
    ptStatus(`Lendo ${ptEsc(a.name)} (${i + 1}/${arqs.length})…`, 'carregando');
    try {
      const buf = await a.arrayBuffer();
      const nome = a.name.toLowerCase();
      const texto = nome.endsWith('.docx') ? await ptLerDocx(buf)
        : nome.endsWith('.pdf') ? await ptLerPdf(buf)
        : (() => { throw new Error('formato não suportado (use PDF ou .docx)'); })();
      ptIncluir(texto, { tipo: nome.endsWith('.docx') ? 'Word' : 'PDF', nome: a.name });
      ok++;
    } catch (e) { erros.push(`${a.name}: ${e.message}`); }
  }
  ptEl('pt-arquivos').value = '';
  ptStatus(erros.length ? `${ok} lido(s); não foi possível ler: ${ptEsc(erros.join('; '))}` : `${ok} arquivo(s) incluído(s).`, erros.length ? 'erro' : 'ok');
}

function ptAddTextoClick() {
  const t = ptEl('pt-texto').value.trim();
  if (t.length < 40) { ptStatus('Cole o texto completo do ato.', 'erro'); return; }
  ptIncluir(t, { tipo: 'texto colado' });
  ptEl('pt-texto').value = '';
  ptStatus('Texto incluído.', 'ok');
}

async function ptAddLinkClick() {
  const url = ptEl('pt-link').value.trim();
  if (!ptEhLinkDou(url)) { ptStatus('Informe um endereço do DOU (https://www.in.gov.br/…).', 'erro'); return; }
  ptStatus('Buscando no DOU…', 'carregando');
  try {
    const { texto, orgao } = await ptLerDou(url);
    ptIncluir(texto, { tipo: 'DOU', url }, { orgao });
    ptEl('pt-link').value = '';
    ptStatus('Ato do DOU incluído.', 'ok');
  } catch (e) {
    ptStatus('Não foi possível buscar: ' + ptEsc(e.message), 'erro');
  }
}

function ptRender() {
  const lista = ptEl('pt-lista');
  ptEl('pt-contagem').textContent = pt.docs.length ? `— ${pt.docs.length} ato(s)` : '';
  ptEl('pt-ordenar').disabled = pt.docs.length < 2;
  ptEl('pt-limpar').disabled = !pt.docs.length;
  if (!pt.docs.length) { lista.innerHTML = '<div class="on-vazio">Nenhum ato incluído ainda.</div>'; return; }
  const origem = o => o.tipo === 'DOU' ? `DOU` : o.nome ? `${o.tipo}: ${o.nome}` : o.tipo;
  lista.innerHTML = pt.docs.map((d, i) => `
    <div class="pt-doc" data-id="${d.id}">
      <div class="ord">${i + 1}</div>
      <div>
        <div class="campos">
          <input class="pt-campo" data-campo="identificacao" value="${ptEsc(d.identificacao)}" placeholder="Identificação (ex.: PORTARIA GM/MS Nº 1.234, DE 10 DE MARÇO DE 2025)">
          <input class="pt-campo" data-campo="orgao" value="${ptEsc(d.orgao)}" placeholder="Órgão">
          <input class="pt-campo" type="date" data-campo="data" value="${ptEsc(d.data || '')}" title="Data do ato">
        </div>
        <div class="meta">${ptEsc(origem(d.origem))} · ${d.texto.length.toLocaleString('pt-BR')} caracteres${d.avisos.length ? ' · <span style="color:#d68a00">' + d.avisos.map(ptEsc).join(' · ') + '</span>' : ''}</div>
        <details><summary>ver texto</summary><pre>${ptEsc(d.texto.slice(0, 20000))}${d.texto.length > 20000 ? '\n…' : ''}</pre></details>
      </div>
      <div class="acoes">
        <button class="pt-btn-mini" data-acao="subir" ${i === 0 ? 'disabled' : ''} title="Mover para antes">↑</button>
        <button class="pt-btn-mini" data-acao="descer" ${i === pt.docs.length - 1 ? 'disabled' : ''} title="Mover para depois">↓</button>
        <button class="pt-btn-mini" data-acao="remover" title="Tirar da sequência">✕</button>
      </div>
    </div>`).join('');
}

function ptListaClick(ev) {
  const bt = ev.target.closest('[data-acao]');
  if (!bt) return;
  const id = +bt.closest('.pt-doc').dataset.id;
  const i = pt.docs.findIndex(d => d.id === id);
  if (i < 0) return;
  const a = bt.dataset.acao;
  if (a === 'remover') pt.docs.splice(i, 1);
  else if (a === 'subir' && i > 0) [pt.docs[i - 1], pt.docs[i]] = [pt.docs[i], pt.docs[i - 1]];
  else if (a === 'descer' && i < pt.docs.length - 1) [pt.docs[i + 1], pt.docs[i]] = [pt.docs[i], pt.docs[i + 1]];
  ptRender();
}

function ptListaChange(ev) {
  const campo = ev.target.dataset && ev.target.dataset.campo;
  if (!campo) return;
  const d = pt.docs.find(x => x.id === +ev.target.closest('.pt-doc').dataset.id);
  if (!d) return;
  d[campo] = ev.target.value.trim() || (campo === 'data' ? null : '');
  if (campo === 'identificacao') {
    // Identificação corrigida à mão: relê número/data dela, sem apagar o que o analista pôs.
    const c = ptCabecalho(d.identificacao);
    if (c.numero) d.numero = c.numero;
    if (c.data && !d.data) d.data = c.data;
    d.avisos = d.avisos.filter(a => !/cabeçalho não reconhecido/.test(a));
  }
  if (campo === 'data' || campo === 'identificacao') ptRender();
}

if (ptEl('pt-lista')) {
  ptEl('pt-arquivos').addEventListener('change', ptArquivosChange);
  ptEl('pt-add-texto').addEventListener('click', ptAddTextoClick);
  ptEl('pt-add-link').addEventListener('click', ptAddLinkClick);
  ptEl('pt-lista').addEventListener('click', ptListaClick);
  ptEl('pt-lista').addEventListener('change', ptListaChange);
  ptEl('pt-ordenar').addEventListener('click', () => { pt.docs = ptOrdenar(pt.docs); ptRender(); });
  ptEl('pt-limpar').addEventListener('click', () => { if (confirm('Tirar todos os atos da sequência?')) { pt.docs = []; ptRender(); } });
  const voltar = ptEl('btn-voltar');
  if (voltar) voltar.addEventListener('click', () => window.close());
}
