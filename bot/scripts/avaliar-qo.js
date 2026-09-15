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

// Camada 2: verbete extraído (tese, fundamento, razão, temas). Só entra na
// comparação quando cobrir o acervo — medir com extração parcial daria uma
// vantagem falsa aos registros extraídos, que é justamente o tipo de erro que
// este arquivo existe para impedir.
const ARQ_EXT = path.join(__dirname, '..', 'dados', 'qordem-extraido.json');
if (fs.existsSync(ARQ_EXT)) {
  const ext = JSON.parse(fs.readFileSync(ARQ_EXT, 'utf8')).itens || {};
  global.__coberturaExtracao = Object.keys(ext).length;
  const vDe = o => {
    const v = ext[o.numInternoQOrdem];
    if (!v) return '';
    return `${v.tese} ${v.tese} ${(v.fundamento || []).join(' ')} ${v.contexto} ` +
           `${v.resultado} ${v.decisao} ${v.razao} ${(v.temas || []).join(' ')}`;
  };
  global.__motorExtraido = (o, d) => `${motores.atual(o, d)} ${vDe(o)} ${vDe(o)}`;
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

// ---------------------------------------------------------------- semântica
// Camada 3: o léxico e o vetor erram por motivos diferentes — um perde quando
// muda o vocabulário, o outro perde número de artigo e nome próprio. A fusão
// RRF junta as duas listas sem precisar comparar escalas (uma é BM25, a outra
// cosseno), somando 1/(k+posição). Só entra na comparação quando os vetores
// existirem e cobrirem o acervo.
const ARQ_EMB = path.join(__dirname, '..', 'src', 'qoembeddings.js');
let VET = null;
if (fs.existsSync(ARQ_EMB)) {
  const e = require(ARQ_EMB);
  const buf = Buffer.from(e.vetores, 'base64');
  VET = { dim: e.dim, modelo: e.modelo, porId: new Map() };
  e.ids.forEach((id, i) => {
    const v = new Float32Array(e.dim);
    for (let k = 0; k < e.dim; k++) v[k] = buf[i * e.dim + k] > 127 ? (buf[i * e.dim + k] - 256) / 127 : buf[i * e.dim + k] / 127;
    VET.porId.set(id, v);
  });
}

async function vetorDaPergunta(texto) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave || !VET) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VET.modelo}:embedContent?key=${chave}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: `models/${VET.modelo}`, content: { parts: [{ text: texto }] },
        outputDimensionality: VET.dim, taskType: 'RETRIEVAL_QUERY' }) });
  if (!r.ok) return null;
  const v = (await r.json()).embedding.values;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

/** Fusão RRF de duas ordenações. k=60 é o valor usual da literatura. */
function fundir(listaA, listaB, k = 60) {
  const p = new Map();
  const somar = lista => lista.forEach((o, i) => {
    const id = o.numInternoQOrdem;
    p.set(id, (p.get(id) || 0) + 1 / (k + i + 1));
  });
  somar(listaA); somar(listaB);
  const porId = new Map([...listaA, ...listaB].map(o => [o.numInternoQOrdem, o]));
  return [...p.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => porId.get(id));
}

// ----------------------------------------------------------------- saída
const pct = (a, b) => b ? `${(100 * a / b).toFixed(0)}%` : '—';

(async () => {
  const corpus = await qo.garantirCorpus();
  qo.carregarCacheDetalhes();
  const det = JSON.parse(fs.readFileSync(CACHE_DET, 'utf8')).itens;
  const dDe = o => det[o.numInternoQOrdem] ||
    { e: '', i: '', dec: '', rec: '', cd: '', obs: '', d: '', it: '' };
  console.log(`acervo: ${corpus.length} QOs · detalhes: ${Object.keys(det).length}\n`);

  const cob = global.__coberturaExtracao || 0;
  if (global.__motorExtraido) {
    if (cob >= corpus.length * 0.95) motores.extraido = global.__motorExtraido;
    else console.log(`(extração cobre ${cob}/${corpus.length} — fora da comparação até cobrir o acervo)\n`);
  }
  const nomes = Object.keys(motores);
  const preparado = {};
  for (const nome of nomes) {
    const texto = o => motores[nome](o, dDe(o));
    preparado[nome] = { texto, idx: construirIndice(corpus, texto) };
  }

  // Motores VETORIAIS: ranqueiam por cosseno contra a tese extraída. Entram na
  // mesma tabela, mas a chamada é assíncrona (a pergunta precisa ser vetorizada).
  const temVetor = VET && VET.porId.size >= corpus.length * 0.95 && process.env.GEMINI_API_KEY;
  if (VET && !temVetor) {
    console.log(`(vetores cobrem ${VET.porId.size}/${corpus.length}` +
      `${process.env.GEMINI_API_KEY ? '' : ' e falta GEMINI_API_KEY'} — fora da comparação)\n`);
  }
  const comVetor = new Map(corpus.map(o => [o, VET && VET.porId.get(o.numInternoQOrdem)]).filter(p => p[1]));
  const porCosseno = q => {
    const out = [];
    for (const [o, v] of comVetor) {
      let s = 0;
      for (let i = 0; i < q.length; i++) s += q[i] * v[i];
      out.push([o, s]);
    }
    return out.sort((a, b) => b[1] - a[1]).slice(0, 200).map(p => p[0]);
  };
  /** Ranqueia com o motor `nome`; se for vetorial, vetoriza a pergunta antes. */
  async function ranquearMotor(nome, pergunta) {
    if (nome === 'semantico' || nome === 'hibrido') {
      const q = await vetorDaPergunta(pergunta);
      if (!q) return [];
      const vet = porCosseno(q);
      if (nome === 'semantico') return vet;
      const { idx, texto } = preparado.extraido || preparado.atual;
      return fundir(ranquearPara(pergunta, corpus, idx, texto).slice(0, 200), vet);
    }
    const { idx, texto } = preparado[nome];
    return ranquearPara(pergunta, corpus, idx, texto);
  }
  if (temVetor) { nomes.push('semantico', 'hibrido'); }

  // ---------- 1. casos curados ----------
  const casos = JSON.parse(fs.readFileSync(ARQ_CASOS, 'utf8')).casos || [];
  console.log(`=== 1. CASOS CURADOS (${casos.length}) ===`);
  const placar = {};
  for (const nome of nomes) placar[nome] = { topo: 0, lista: 0, total: 0 };

  for (const c of casos) {
    const linha = [];
    for (const nome of nomes) {
      const res = (await ranquearMotor(nome, c.pergunta)).map(num);
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
    const vetorial = nome === 'semantico' || nome === 'hibrido';
    // Nos motores léxicos o índice é refeito SEM o campo do recurso, senão a
    // medida seria circular. Nos vetoriais isso não se aplica: o vetor vem da
    // tese extraída, que não contém o texto do recurso.
    const texto = o => motores[nome === 'hibrido' ? (motores.extraido ? 'extraido' : 'atual') : nome]
      ? motores[nome === 'hibrido' ? (motores.extraido ? 'extraido' : 'atual') : nome](o, { ...dDe(o), rec: '' })
      : '';
    const idx = vetorial && nome === 'semantico' ? null : construirIndice(corpus, texto);
    let em1 = 0, em5 = 0, em20 = 0, somaRR = 0, achou = 0;
    for (const alvo of alvos) {
      const pergunta = dDe(alvo).rec;
      let res;
      if (nome === 'semantico') {
        const q = await vetorDaPergunta(pergunta);
        res = q ? porCosseno(q) : [];
      } else if (nome === 'hibrido') {
        const q = await vetorDaPergunta(pergunta);
        res = q ? fundir(ranquearPara(pergunta, corpus, idx, texto).slice(0, 200), porCosseno(q))
                : ranquearPara(pergunta, corpus, idx, texto);
      } else {
        res = ranquearPara(pergunta, corpus, idx, texto);
      }
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
