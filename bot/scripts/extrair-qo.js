'use strict';
// CAMADA 2 — extração estruturada das questões de ordem.
//
// Transforma texto em PRECEDENTE. Para cada QO, uma passada de IA lê o inteiro
// teor (a tese, com o raciocínio do parlamentar) junto com os campos que a
// Câmara cataloga (a decisão, o tesauro) e devolve um registro analítico.
//
// A regra que governa o prompt vem de medição, não de gosto:
//   - a TESE está no inteiro teor em quase todos os registros;
//   - o RESULTADO está na ementa da decisão, em 86%;
//   - a RAZÃO da decisão nem sempre existe: onde não existir, o campo tem de
//     sair "não consta", jamais inferido. Precedente inventado é pior que
//     precedente não encontrado. MEDIDO em 157 registros: sai "não consta" em
//     31% deles, e das razões preenchidas 79% têm lastro léxico no original.
//
// Roda UMA vez e o resultado é distribuído com o bot (como src/ricd.js): nenhum
// usuário paga por consulta, todos veem o mesmo, e cada campo é conferível
// contra o original pelo link.
//
// Uso:
//   GEMINI_API_KEY=... node scripts/extrair-qo.js --n 200
//   GEMINI_API_KEY=... node scripts/extrair-qo.js            (acervo inteiro)
//   ... --modelo gemini-3.1-flash-lite --concorrencia 4
//
// Retoma de onde parou: o que já está em dados/qordem-extraido.json é pulado.

require('dns').setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');
const qo = require('../src/questaoordem');
const { normalizar } = require('../src/busca');

const DESTINO = path.join(__dirname, '..', 'dados', 'qordem-extraido.json');
const ARQ_TEOR = path.join(__dirname, '..', 'dados', 'qordem-teor.json');
const CACHE_DET = path.join(__dirname, '..', 'dados', 'qordem-detalhes.json');

const argv = process.argv.slice(2);
const opt = (n, p) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : p; };
const CHAVE = process.env.GEMINI_API_KEY || '';
const MODELO = opt('modelo', 'gemini-3.1-flash-lite');
const CONC = Number(opt('concorrencia', 4));
const LIMITE = Number(opt('n', 0)) || 0;
const MAX_TEOR = 14000;     // ~3,5 mil tokens; média medida é 6 mil caracteres

if (!CHAVE) { console.error('Defina GEMINI_API_KEY no ambiente.'); process.exit(1); }

const VOCAB = [
  'quórum', 'votação', 'verificação', 'obstrução', 'destaque', 'emenda',
  'prejudicialidade', 'preferência', 'adiamento', 'retirada de pauta', 'urgência',
  'discussão', 'encaminhamento', 'redação final', 'medida provisória', 'PEC',
  'comissão', 'composição de comissão', 'admissibilidade', 'apreciação conclusiva',
  'recurso', 'liderança', 'uso da palavra', 'ata', 'sessão', 'ordem do dia',
  'inconstitucionalidade', 'processo legislativo', 'mandato', 'decoro',
];

const PROMPT = (q) => `Você é analista de plenário da Câmara dos Deputados. Leia o registro de uma QUESTÃO DE ORDEM e extraia dele um verbete de precedente.

REGRA ABSOLUTA: só afirme o que está no texto. Onde o texto não disser, escreva exatamente "não consta". Nunca deduza a decisão a partir da pergunta, nem a razão a partir da decisão. Um verbete com "não consta" é útil; um verbete inventado destrói a confiança em todos os outros.

REGISTRO
--------
Questão de ordem nº ${q.num} — sessão de ${q.data}
Autor: ${q.autor || 'não consta'}
Dispositivos catalogados: ${q.disp || 'não consta'}

Ementa da questão (catalogada):
${q.ementa || 'não consta'}

Ementa da decisão (catalogada):
${q.decisao || 'não consta'}

${q.contradita ? `Contradita (catalogada):\n${q.contradita}\n` : ''}${q.recurso ? `Recurso (catalogado):\n${q.recurso}\n` : ''}
Notas taquigráficas (inteiro teor, pode estar truncado):
${q.teor || 'não consta'}
--------

Responda SÓ com um objeto JSON, sem cercas de código, neste formato:

{
  "tese": "em uma ou duas frases, O QUE SE SUSTENTOU e com que raciocínio — a proposição jurídica em disputa, não o resumo do episódio. Escreva de forma que sirva para reconhecer o mesmo problema em outro caso.",
  "fundamento": ["artigos do Regimento ou da Constituição invocados, ex.: 'RICD art. 117, VI'"],
  "contexto": "matéria e fase em que ocorreu, ex.: 'votação da MPV 713/2016, em Plenário'",
  "resultado": "um de: deferida | indeferida | parcialmente deferida | prejudicada | retirada | sem decisão registrada",
  "decisao": "o que a Presidência decidiu, na forma como está registrado — ou 'não consta'",
  "razao": "o FUNDAMENTO que a Presidência deu para decidir assim. Se as notas não trouxerem a justificativa, escreva 'não consta'.",
  "desdobramento": "houve contradita, recurso ou reforma posterior, conforme o registro — ou 'não consta'",
  "temas": ["2 a 5 termos desta lista: ${VOCAB.join(', ')}"]
}`;

async function chamar(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${CHAVE}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2000, responseMimeType: 'application/json' },
  };
  const atrasos = [0, 4000, 12000, 30000];
  let ultimo = null;
  for (const ms of atrasos) {
    if (ms) await new Promise(r => setTimeout(r, ms));
    // TIMEOUT OBRIGATÓRIO: sem ele uma conexão pendurada trava o worker para
    // sempre. Aconteceu — o processo ficou 20 min vivo, com 9 s de CPU, sem
    // gravar nada, porque os três workers estavam parados num fetch que nunca
    // respondeu nem falhou.
    let res;
    const ctrl = new AbortController();
    const alarme = setTimeout(() => ctrl.abort(), 120000);
    try {
      res = await fetch(url, { method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { ultimo = e; continue; }
    finally { clearTimeout(alarme); }
    if (res.ok) {
      const j = await res.json();
      const t = (j.candidates?.[0]?.content?.parts || [])
        .filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
      return t;
    }
    if (res.status === 429 || res.status >= 500) { ultimo = new Error(`HTTP ${res.status}`); continue; }
    const det = await res.json().catch(() => null);
    throw new Error(det?.error?.message || `HTTP ${res.status}`);
  }
  throw ultimo || new Error('falhou após as tentativas');
}

const CAMPOS = ['tese', 'fundamento', 'contexto', 'resultado', 'decisao', 'razao',
                'desdobramento', 'temas'];
const RESULTADOS = ['deferida', 'indeferida', 'parcialmente deferida', 'prejudicada',
                    'retirada', 'sem decisão registrada'];

// LASTRO: quanto do que a IA escreveu como RAZÃO da decisão reaparece no texto
// de origem. Substitui o campo de autoavaliação que eu tinha pedido ao modelo —
// medido em 157 registros, ele respondia "alta" em 156, ou seja, não
// discriminava nada. Isto aqui é conferível: lastro baixo é aviso de paráfrase
// solta, e a resposta ao usuário pode marcar o verbete.
const naoConsta = v => /^n[aã]o consta$/i.test(String(v || '').trim());
function lastroDe(razao, fonte) {
  if (naoConsta(razao) || !String(razao || '').trim()) return null;
  const alvo = normalizar(fonte);
  const palavras = normalizar(razao).split(/\W+/).filter(w => w.length > 5);
  if (!palavras.length) return 0;
  return Number((palavras.filter(w => alvo.includes(w)).length / palavras.length).toFixed(2));
}

/** Aceita só o que tem a forma certa — verbete torto é pior que verbete ausente. */
function validar(txt) {
  let o;
  try { o = JSON.parse(String(txt).replace(/^```(json)?|```$/g, '').trim()); }
  catch (_) { return { erro: 'JSON inválido' }; }
  for (const c of CAMPOS) if (o[c] === undefined) return { erro: `sem campo ${c}` };
  if (!String(o.tese || '').trim()) return { erro: 'tese vazia' };
  if (!RESULTADOS.includes(String(o.resultado).trim())) return { erro: `resultado "${o.resultado}"` };
  o.fundamento = Array.isArray(o.fundamento) ? o.fundamento : [];
  o.temas = Array.isArray(o.temas) ? o.temas : [];
  return { ok: o };
}

(async () => {
  const t0 = Date.now();
  const teor = JSON.parse(fs.readFileSync(ARQ_TEOR, 'utf8')).itens || {};
  const det = JSON.parse(fs.readFileSync(CACHE_DET, 'utf8')).itens || {};
  const corpus = await qo.garantirCorpus();

  let feito = {};
  try { feito = JSON.parse(fs.readFileSync(DESTINO, 'utf8')).itens || {}; } catch (_) {}

  let alvos = corpus.filter(o => !feito[o.numInternoQOrdem]);
  if (LIMITE) {                                   // amostra ESPALHADA, não os 200 mais novos
    const passo = Math.max(1, Math.floor(alvos.length / LIMITE));
    alvos = alvos.filter((_, i) => i % passo === 0).slice(0, LIMITE);
  }
  console.log(`acervo ${corpus.length} · já extraído ${Object.keys(feito).length} · a extrair ${alvos.length}`);
  console.log(`modelo ${MODELO} · concorrência ${CONC}\n`);

  const fila = [...alvos];
  let ok = 0, ruim = 0, entrada = 0;
  const erros = {};
  await Promise.all(Array.from({ length: CONC }, async () => {
    let o;
    while ((o = fila.pop())) {
      const d = det[o.numInternoQOrdem] || {};
      const q = {
        num: o.numQOrdemComAno, data: o.datSessaoQOrdem, autor: o.txtNomeAutorQOrdem,
        disp: (d.d || '').replace(/art(\d+)/g, 'art. $1'),
        ementa: d.e, decisao: d.dec, contradita: d.cd, recurso: d.rec,
        teor: String(teor[o.numInternoQOrdem] || '').slice(0, MAX_TEOR),
      };
      const p = PROMPT(q);
      entrada += p.length;
      let txt;
      try { txt = await chamar(p); }
      catch (e) { ruim++; erros[e.message] = (erros[e.message] || 0) + 1; continue; }
      const v = validar(txt);
      if (v.erro) { ruim++; erros[v.erro] = (erros[v.erro] || 0) + 1; continue; }
      feito[o.numInternoQOrdem] = { num: q.num, ...v.ok,
        lastro: lastroDe(v.ok.razao, `${q.decisao || ''} ${q.teor || ''}`) };
      ok++;
      if ((ok + ruim) % 25 === 0) {
        console.log(`  ${ok + ruim}/${alvos.length} · ok ${ok} · falhas ${ruim}`);
        fs.writeFileSync(DESTINO, JSON.stringify({ modelo: MODELO, gerado: new Date().toISOString().slice(0, 10), itens: feito }));
      }
    }
  }));

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, JSON.stringify({ modelo: MODELO, gerado: new Date().toISOString().slice(0, 10), itens: feito }));

  const min = (Date.now() - t0) / 60000;
  console.log(`\n${ok} extraídas · ${ruim} falhas · ${min.toFixed(1)} min`);
  if (Object.keys(erros).length) console.log('falhas:', JSON.stringify(erros));
  console.log(`entrada ≈ ${(entrada / 4 / 1e6).toFixed(2)}M tokens` +
    ` · projeção para as ${corpus.length}: ${(entrada / 4 / Math.max(1, ok) * corpus.length / 1e6).toFixed(1)}M tokens` +
    ` e ~${(min / Math.max(1, ok) * corpus.length).toFixed(0)} min`);
  console.log(`gravado em ${DESTINO}`);
})().catch(e => { console.error('falhou:', e); process.exit(1); });
