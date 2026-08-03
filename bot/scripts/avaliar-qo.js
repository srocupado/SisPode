'use strict';
// MEDIDOR da busca de questões de ordem. Toda mudança na busca passa por aqui
// antes de ir para o main — foi a falta disto que deixou passar as regressões
// dos últimos dias ("melhorou" era opinião, não medida).
//
// Duas medidas, por motivos diferentes:
//
// 1. CASOS CURADOS (avaliacao/casos.json) — perguntas como a rotina faz, com a
//    QO que a resposta precisa trazer. Poucos, mas é o que realmente importa.
//    Depende de alguém escrever o gabarito.
//
// 2. RECUPERAÇÃO POR ITEM CONHECIDO — automática, sem gabarito humano e em
//    escala. Ideia: quem interpôs o RECURSO descreveu o MESMO caso com OUTRAS
//    palavras. Então usamos o texto do recurso como pergunta e conferimos se a
//    QO de onde ele saiu volta no topo. Para não ser circular, o índice usado
//    nesta medida é construído SEM o campo do recurso.
//    São ~680 casos reais de paráfrase, de graça.
//
// Uso:
//   node scripts/avaliar-qo.js                 mede o motor atual
//   node scripts/avaliar-qo.js --casos         só os casos curados, detalhado
//   node scripts/avaliar-qo.js --n 200         limita a amostra da medida 2

require('dns').setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');
const { normalizar, termosDe, construirIndice, ranquear,
        expandirArtigos, bigramasDe, adjacencia } = require('../src/busca');
const qo = require('../src/questaoordem');

const ARQ_CASOS = path.join(__dirname, '..', 'avaliacao', 'casos.json');
const CACHE_DET = path.join(__dirname, '..', 'dados', 'qordem-detalhes.json');
const argv = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? (argv[i + 1] || true) : padrao;
};

// ---------------------------------------------------------------- motores
// Um MOTOR diz como cada QO vira texto indexável. Trocar de arquitetura é
// acrescentar um motor aqui e comparar a coluna, não confiar na impressão.
const motores = {
  // O que está no main hoje: campos curados, sem inteiro teor.
  atual: (o, d) => expandirArtigos(
    `${o.txtQOrdemReduzido || ''} ${o.txtNomeAutorQOrdem || ''} ${o.numQOrdemComAno || ''} ` +
    `${d.e} ${d.e} ${d.i} ${d.i} ${d.dec} ${d.rec} ${d.cd} ${d.obs} ${d.d}`),

  // Só a listagem — como era antes do cache de detalhes. Serve de piso.
  listagem: o => expandirArtigos(
    `${o.txtQOrdemReduzido || ''} ${o.txtNomeAutorQOrdem || ''} ${o.numQOrdemComAno || ''}`),
};
// Camadas seguintes acrescentam motores aqui (inteiro teor, extração
// estruturada, semântica) e a comparação sai na mesma tabela.
const ARQ_TEOR = path.join(__dirname, '..', 'dados', 'qordem-teor.json');
let _teor = null;
if (fs.existsSync(ARQ_TEOR)) {
  _teor = JSON.parse(fs.readFileSync(ARQ_TEOR, 'utf8')).itens || {};
  const teorDe = o => _teor[o.numInternoQOrdem] || '';
  motores.com_teor = (o, d) => `${motores.atual(o, d)} ${teorDe(o)}`;
  // O inteiro teor é ~8x maior que os campos curados: sem pesar, ele afoga a
  // ementa. Aqui a curadoria conta 3x, para medir se o problema é ele existir
  // ou ele dominar.
  motores.teor_leve = (o, d) => `${motores.atual(o, d)} ${motores.atual(o, d)} ${teorDe(o)}`;
}

// ------------------------------------------------------------------ busca
/** Ranqueia o corpus para uma consulta. Devolve os itens, do mais relevante. */
function ranquearPara(consulta, corpus, idx, textoDe) {
  const termos = termosDe(expandirArtigos(consulta));
  if (!termos.length) return [];
  const rank = ranquear(corpus, idx, termos);
  if (!rank.length) return [];
  let max = 0;
  for (const r of rank) {
    r._cob = termos.reduce((s, t) => s + (idx.docs[r.indice].tf.has(t) ? 1 : 0), 0);
    if (r._cob > max) max = r._cob;
  }
  let piso = max;
  const noNivel = p => rank.filter(r => r._cob >= p);
  if (noNivel(piso).length < 8 && piso > 1) piso--;
  const sel = noNivel(piso);
  const pares = bigramasDe(consulta);
  if (pares.length) for (const r of sel.slice(0, 400)) r._adj = adjacencia(textoDe(r.item), pares);
  return sel.sort((a, b) => (b._adj || 0) - (a._adj || 0) || b.score - a.score).map(r => r.item);
}

const num = o => o.numQOrdemComAno || String(o.numQOrdem);

// ----------------------------------------------------------------- saída
const pct = (a, b) => b ? `${(100 * a / b).toFixed(0)}%` : '—';

(async () => {
  const corpus = await qo.garantirCorpus();
  qo.carregarCacheDetalhes();
  const det = JSON.parse(fs.readFileSync(CACHE_DET, 'utf8')).itens;
  const dDe = o => det[o.numInternoQOrdem] ||
    { e: '', i: '', dec: '', rec: '', cd: '', obs: '', d: '', it: '' };
  console.log(`acervo: ${corpus.length} QOs · detalhes: ${Object.keys(det).length}\n`);

  const nomes = Object.keys(motores);
  const preparado = {};
  for (const nome of nomes) {
    const texto = o => motores[nome](o, dDe(o));
    preparado[nome] = { texto, idx: construirIndice(corpus, texto) };
  }

  // ---------- 1. casos curados ----------
  const casos = JSON.parse(fs.readFileSync(ARQ_CASOS, 'utf8')).casos || [];
  console.log(`=== 1. CASOS CURADOS (${casos.length}) ===`);
  const placar = {};
  for (const nome of nomes) placar[nome] = { topo: 0, lista: 0, total: 0 };

  for (const c of casos) {
    const linha = [];
    for (const nome of nomes) {
      const { idx, texto } = preparado[nome];
      const res = ranquearPara(c.pergunta, corpus, idx, texto).map(num);
      const posicoes = c.esperadas.map(e => res.indexOf(e) + 1);   // 0 = ausente
      const pior = Math.min(...posicoes.map(p => p || 1e9));
      const todas = posicoes.every(p => p > 0);
      const okTopo = todas && Math.max(...posicoes) <= 3;
      const okLista = todas;
      placar[nome].total++;
      if (okTopo) placar[nome].topo++;
      if (okLista) placar[nome].lista++;
      const alvo = c.onde === 'topo' ? okTopo : okLista;
      linha.push(`${nome}:${alvo ? '✅' : '⚠️ '}${posicoes.map(p => p || '—').join('/')}`);
    }
    console.log(`  ${argv.includes('--casos') ? '\n  ' : ''}"${c.pergunta.slice(0, 62)}"`);
    console.log(`     esperadas ${c.esperadas.join(', ')} → ${linha.join('   ')}`);
  }
  console.log('');
  for (const nome of nomes) {
    const p = placar[nome];
    console.log(`  ${nome.padEnd(10)} nas 3 primeiras ${p.topo}/${p.total}  ·  na lista ${p.lista}/${p.total}`);
  }
  if (argv.includes('--casos')) return;

  // ---------- 2. recuperação por item conhecido ----------
  // Pergunta = texto do RECURSO (outra pessoa descrevendo o mesmo caso).
  // Índice SEM o campo do recurso, senão a medida seria circular.
  const N = Number(opt('n', 0)) || 0;
  let alvos = corpus.filter(o => (dDe(o).rec || '').length >= 200);
  if (N) alvos = alvos.filter((_, i) => i % Math.ceil(alvos.length / N) === 0);
  console.log(`\n=== 2. RECUPERAÇÃO POR ITEM CONHECIDO (${alvos.length} casos) ===`);
  console.log('    pergunta = texto do recurso · índice construído SEM esse campo\n');

  for (const nome of nomes) {
    const texto = o => motores[nome](o, { ...dDe(o), rec: '' });   // tira o recurso
    const idx = construirIndice(corpus, texto);
    let em1 = 0, em5 = 0, em20 = 0, somaRR = 0, achou = 0;
    for (const alvo of alvos) {
      const res = ranquearPara(dDe(alvo).rec, corpus, idx, texto);
      const pos = res.findIndex(x => x.numInternoQOrdem === alvo.numInternoQOrdem) + 1;
      if (pos) { achou++; somaRR += 1 / pos; }
      if (pos === 1) em1++;
      if (pos && pos <= 5) em5++;
      if (pos && pos <= 20) em20++;
    }
    const n = alvos.length;
    console.log(`  ${nome.padEnd(10)} @1 ${pct(em1, n).padStart(4)}  @5 ${pct(em5, n).padStart(4)}` +
      `  @20 ${pct(em20, n).padStart(4)}  ·  MRR ${(somaRR / n).toFixed(3)}  ·  achou ${pct(achou, n)}`);
  }
  console.log('\n(@k = a QO certa voltou entre as k primeiras · MRR = 1/posição, média)');
})().catch(e => { console.error('falhou:', e); process.exit(1); });
