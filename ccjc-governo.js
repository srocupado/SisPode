'use strict';

// ── POSIÇÃO DO GOVERNO NA PAUTA (Pautas CCJC) ───────────────────────────────
// A Liderança do Governo na Câmara publica, às vezes, a pauta da reunião com a
// posição do governo em cada item ("Liderança Digital", PDF). O botão
// "Posição do governo" lê o SUMÁRIO desse PDF — uma linha por item,
// "2 - PL 1834/2023 Em Análise ( Aumento de pena … )", em duas colunas — e
// guarda a posição na pauta (pauta.governo). O resumo executivo mostra a
// posição numa coluna própria e destaca a dos itens do Podemos.
// Leitura sem IA. MEDIDO na pauta de 03/11/2026: 122 itens, 1 a 122, todos lidos
// (115 Voto Livre, 2 Sim, 2 Em Análise, 1 Não, 1 Favorável com ajustes, 1 Não
// afeta ao governo). O tema do item pode ter parênteses dentro ("(Lei das
// Drogas)"), por isso a posição é lida só até o "(" que abre o tema.
// Usa de ccjc.js: app, extrairTextoPDF, salvarPauta, mostrarToast, escHtml.

const GOV_SIGLAS = 'PLP|PL|PEC|PDL|PDC|PRC|MPV|MSC|REQ|REC';
// Marcas da legenda do PDF (A autor, R relator, AA autor da acessória, AP autor da apensada, I interesse)
const GOV_MARCA = '(?:AA|AP|A|R|I)';

/** Chave da proposição no formato das pautas da CCJC ("PL 1834/2023"). */
const govChave = (sigla, numero, ano) => `${String(sigla).toUpperCase()} ${parseInt(numero, 10)}/${ano}`;

/**
 * Lê o PDF do governo (texto já extraído). Devolve { governo, comissao, reuniao, itens }:
 * governo — o cabeçalho é da Liderança do Governo; reuniao — "dd/mm/aaaa" do cabeçalho;
 * itens — { 'PL 1834/2023': { item: 2, posicao: 'Em Análise', marcas: '' } }.
 */
function lerPosicoesGoverno(texto) {
  const t = String(texto || '');
  const re = new RegExp(`(?:^|[^\\d])(\\d{1,3})\\s+-\\s+(${GOV_SIGLAS})\\s+(\\d+)\\/(\\d{4})((?:\\s+${GOV_MARCA}(?:\\s*,\\s*${GOV_MARCA})*)?)\\s+([^()]{1,60}?)\\s*\\(`, 'g');
  const itens = {};
  let m;
  while ((m = re.exec(t))) {
    const chave = govChave(m[2], m[3], m[4]);
    if (!itens[chave]) itens[chave] = { item: parseInt(m[1], 10), posicao: m[6].replace(/\s+/g, ' ').trim(), marcas: m[5].replace(/\s+/g, '') };
  }
  const cab = t.slice(0, 1500);
  return {
    governo: /LIDERAN[ÇC]A\s+DO\s+GOVERNO/i.test(cab),
    comissao: (cab.match(/Comiss[ãa]o\s+de\s+[^\n]*?(?=\s{2,}|\s+\d{2}ª|\n|$)/i) || [''])[0].trim(),
    reuniao: (cab.match(/\b(\d{2}\/\d{2}\/\d{4})\s*-\s*\d{1,2}:\d{2}/) || [])[1] || null,
    itens,
  };
}

/** A posição do governo para um projeto da pauta (ou null). */
function govPosicao(pauta, p) {
  const itens = pauta && pauta.governo && pauta.governo.itens;
  if (!itens || !p) return null;
  const k = p.sigla && p.numero && p.ano ? govChave(p.sigla, p.numero, p.ano)
    : String(p.chave || '').replace(/^(\S+)\s+0*(\d+)\/(\d{4}).*$/, (_, s, n, a) => govChave(s, n, a));
  return itens[k] || null;
}

/** Classe de cor da posição (as cores do PDF do governo). */
function govClasse(posicao) {
  const s = String(posicao || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (/^nao afeta/.test(s)) return 'gv-naoafeta';
  if (/^(nao|contrari)/.test(s)) return 'gv-nao';
  if (/^sim$/.test(s)) return 'gv-sim';
  if (/^favoravel/.test(s)) return 'gv-fav';
  if (/^em analise/.test(s)) return 'gv-analise';
  if (/^(voto livre|liberad)/.test(s)) return 'gv-livre';
  return 'gv-outra';
}
const GOV_CSS = `.gv { display:inline-block; padding:2px 8px; border-radius:5px; font-size:8pt; font-weight:700; color:#fff; white-space:nowrap; }
  .gv-sim { background:#5cb85c; } .gv-fav { background:#1e5b0f; } .gv-nao { background:#d9534f; } .gv-analise { background:#8a8000; }
  .gv-naoafeta { background:#e8711a; } .gv-livre { background:#6b6b6b; } .gv-outra { background:#475569; }`;
const govBadge = posicao => posicao ? `<span class="gv ${govClasse(posicao)}">${escHtml(posicao)}</span>` : '—';

/** Botão "Posição do governo": mostra se a pauta já tem a posição importada. */
function govAtualizarBotao() {
  const b = document.getElementById('btn-posicao-governo');
  if (!b) return;
  const g = app.pautaAtual && app.pautaAtual.governo;
  b.querySelector('[data-role=rotulo]').textContent = g ? 'Posição do governo ✓' : 'Posição do governo';
  b.title = g
    ? `Importada de ${g.arquivo} em ${new Date(g.importadoEm).toLocaleString('pt-BR')} (${Object.keys(g.itens).length} itens). Clique para importar outra — substitui esta.`
    : 'Importar o PDF da pauta com a posição do governo (Liderança Digital, da Liderança do Governo na CD). A posição entra no resumo executivo.';
}

async function importarPosicaoGoverno(file) {
  const pauta = app.pautaAtual;
  if (!pauta || !file) return;
  let r;
  try { r = lerPosicoesGoverno(await extrairTextoPDF(file)); }
  catch (e) { mostrarToast('Não consegui ler o PDF: ' + e.message, 'erro'); return; }
  const lidos = Object.keys(r.itens).length;
  if (!lidos) { mostrarToast('Não achei posições do governo neste PDF (o sumário "N - PL 123/2026 Posição ( tema )").', 'erro'); return; }
  // Conferências: é da CCJC e da reunião desta pauta? (avisa, não impede)
  const dataPauta = (String(pauta.titulo || '').match(/\d{2}\/\d{2}\/\d{4}/) || [])[0];
  const avisos = [];
  if (!r.governo) avisos.push('o cabeçalho não diz "Liderança do Governo"');
  if (r.comissao && !/constitui[çc][ãa]o\s+e\s+justi[çc]a/i.test(r.comissao)) avisos.push(`o PDF é da ${r.comissao}`);
  if (r.reuniao && dataPauta && r.reuniao !== dataPauta) avisos.push(`o PDF é da reunião de ${r.reuniao} e a pauta é de ${dataPauta}`);
  if (avisos.length && !confirm(`Atenção: ${avisos.join('; ')}.\n\nImportar a posição do governo mesmo assim?`)) return;
  const casam = pauta.projetos.filter(p => govPosicao({ governo: r }, p)).length;
  pauta.governo = { arquivo: file.name, importadoEm: new Date().toISOString(), reuniao: r.reuniao, itens: r.itens };
  govAtualizarBotao();
  await salvarPauta();
  mostrarToast(`Posição do governo: ${casam} de ${pauta.projetos.length} itens da pauta (${lidos} lidos no PDF).`, casam === pauta.projetos.length ? 'sucesso' : 'aviso');
}

if (typeof document !== 'undefined' && document.getElementById('btn-posicao-governo')) {
  const inp = document.getElementById('inp-posicao-governo');
  document.getElementById('btn-posicao-governo').addEventListener('click', () => {
    if (!app.pautaAtual) { mostrarToast('Nenhuma pauta carregada.', 'aviso'); return; }
    inp.value = '';
    inp.click();
  });
  inp.addEventListener('change', () => importarPosicaoGoverno(inp.files[0]));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lerPosicoesGoverno, govChave, govPosicao, govClasse, govBadge, GOV_CSS };
}
