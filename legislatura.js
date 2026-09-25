'use strict';
// Legislaturas da Câmara calculadas pela DATA — nada de "57" fixo no código.
//
// Desde 1826 cada legislatura dura 4 anos. A 57ª começou em 1º/fev/2023, então
// a legislatura N começa em 1º/fev de 2023 + 4·(N − 57) e termina em 31/jan
// de 4 anos depois. Janeiro do ano de transição ainda pertence à legislatura
// que está saindo (jan/2027 é 57ª; fev/2027 já é 58ª).
//
// ESTE ARQUIVO EXISTE EM DOIS LUGARES, IDÊNTICOS: na raiz (script clássico da
// extensão — as funções viram globais) e em bot/src/legislatura.js (módulo
// CommonJS do bot — o /update do bot só baixa bot/src/*.js, então não dá para
// o bot ler o da raiz). testes/legislatura.test.js falha se os dois divergirem.

const LEG_REF_NUMERO = 57;
const LEG_REF_ANO = 2023;
// Primeira legislatura com arquivos em massa de proposições utilizáveis
// (proposicoes-2007.json) — piso dos relatórios que dependem deles.
const LEG_PRIMEIRA_COM_ARQUIVOS = 53;

/** 'AAAA-MM-DD…' ou Date → { ano, mes } (mês 1–12). String é lida literal, sem fuso. */
function legDecompor(data) {
  if (typeof data === 'string') {
    const m = data.match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    return { ano: +m[1], mes: +m[2] };
  }
  const d = data instanceof Date ? data : new Date();
  if (isNaN(d.getTime())) return null;
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

/** Número da legislatura em curso numa data (default: agora). null se a data for inválida. */
function legislaturaEm(data) {
  const p = legDecompor(data === undefined ? new Date() : data);
  if (!p) return null;
  const anoEfetivo = p.mes < 2 ? p.ano - 1 : p.ano; // janeiro ainda é da legislatura anterior
  return LEG_REF_NUMERO + Math.floor((anoEfetivo - LEG_REF_ANO) / 4);
}

/**
 * Dados de uma legislatura: faixa de datas, rótulo e os anos cujos arquivos em
 * massa podem conter proposições dela — INCLUI o ano de término (jan/2027 é
 * 57ª, e está em proposicoes-2027.json).
 */
function legislaturaInfo(numero) {
  const n = parseInt(numero, 10);
  const inicio = LEG_REF_ANO + 4 * (n - LEG_REF_NUMERO);
  return {
    id: String(n),
    numero: n,
    rotulo: `${n}ª (${inicio}–${inicio + 4})`,
    inicio: `${inicio}-02-01`,
    fim: `${inicio + 4}-01-31`,
    anos: [inicio, inicio + 1, inicio + 2, inicio + 3, inicio + 4],
  };
}

/** Chaves ('53', …, atual) da mais recente para a mais antiga. */
function legislaturasDesde(primeira, data) {
  const atual = legislaturaEm(data);
  const out = [];
  for (let n = atual; n >= primeira; n--) out.push(String(n));
  return out;
}

/** Legislatura (chave string) de uma data de apresentação 'AAAA-MM-DD…', ou null. */
function legislaturaDaData(dataIso) {
  if (!dataIso) return null;
  const n = legislaturaEm(String(dataIso).slice(0, 10));
  return n == null ? null : String(n);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEG_PRIMEIRA_COM_ARQUIVOS, legislaturaEm, legislaturaInfo, legislaturasDesde, legislaturaDaData,
  };
}
