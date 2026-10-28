'use strict';
// Cópia dos dados do IBGE no Firebase (malhas, municípios, população do Censo 2022).
//
// O servidor de dados do IBGE (servicodados) às vezes cai ou recusa conexões vindas
// de fora do Brasil. Os dados que a aba Sistemas eleitorais lê dele quase não mudam
// (o Censo 2022 é fixo; a malha muda no máximo uma vez por ano), então cada leitura
// bem-sucedida confere a cópia guardada — por um carimbo (hash) do conteúdo — e só
// regrava se mudou. Quando o IBGE não responde, a leitura usa a cópia e diz de quando
// ela é. Nó próprio no Firebase: /ibge_cache/<chave> = { h, d (JSON em texto), em, url }.
// O conteúdo vai em texto porque o Firebase descarta listas vazias e mexe em listas
// esparsas, o que estragaria uma malha TopoJSON.

const IC_FIREBASE = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const IC_RAIZ = '/ibge_cache';
// Depois de uma falha do IBGE, as leituras seguintes vão direto à cópia por um tempo: sem isso, cada arquivo
// esperaria as novas tentativas do IBGE (dezenas de segundos), e uma leitura do país levaria muito mais.
const IC_PAUSA_MS = 10 * 60 * 1000;
let icForaAte = 0;

/** Chave da cópia a partir do endereço do IBGE: o caminho e a consulta, sem caracteres proibidos no Firebase. */
function icChave(url) {
  const u = String(url).replace(/^https?:\/\/[^/]+\/api\//, '');
  return decodeURIComponent(u).replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 300);
}

/** Carimbo do conteúdo (FNV-1a de 32 bits sobre o JSON em texto) — basta para saber se mudou. */
function icHash(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + '-' + texto.length;
}

/**
 * JSON do IBGE com a cópia do Firebase por trás.
 * Devolve { dados, fonte: 'ibge' | 'copia', em (ms da gravação da cópia, se veio dela) }.
 * op: { ler (fetch do IBGE → objeto; padrão zrJson), fetch, base (Firebase) } — trocáveis nos testes.
 */
async function icJson(url, op = {}) {
  const ler = op.ler || (u => zrJson(u)), f = op.fetch || ((...a) => fetch(...a)), base = (op.base || IC_FIREBASE) + IC_RAIZ + '/' + icChave(url);
  let dados, erro;
  const agora = op.agora ? op.agora() : Date.now();
  if (agora < icForaAte) erro = new Error('o IBGE não respondeu há pouco');
  else try { dados = await ler(url); } catch (e) { erro = e; icForaAte = agora + IC_PAUSA_MS; }
  if (dados !== undefined && dados !== null) {
    const texto = JSON.stringify(dados), h = icHash(texto);
    // confere a cópia e regrava só se mudou (ou se não havia); falha aqui não atrapalha a leitura
    const conferir = (async () => {
      try {
        const r = await f(base + '/h.json');
        const atual = r.ok ? await r.json() : null;
        if (atual === h) return 'igual';
        const w = await f(base + '.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ h, d: texto, em: Date.now(), url }) });
        return w.ok ? 'gravada' : 'falhou';
      } catch (_) { return 'falhou'; }
    })();
    if (op.esperarCopia) await conferir;
    return { dados, fonte: 'ibge' };
  }
  try {
    const r = await f(base + '.json');
    const c = r.ok ? await r.json() : null;
    if (c && c.d) return { dados: JSON.parse(c.d), fonte: 'copia', em: c.em || null };
  } catch (_) { /* sem cópia */ }
  throw erro || new Error('o IBGE não respondeu e não há cópia guardada');
}

/** Esquece a falha recente do IBGE (testes; ou para tentar o IBGE de novo antes da pausa acabar). */
function icReiniciar() { icForaAte = 0; }

if (typeof module !== 'undefined' && module.exports) module.exports = { icChave, icHash, icJson, icReiniciar, IC_RAIZ, IC_PAUSA_MS };
