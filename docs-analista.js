// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Documentos fornecidos pelo(a) analista para a análise de um item da pauta.
//
// Nasceu em 17/11/2026, com o PLP 299/2026: a matéria estava na pauta da Câmara, mas ainda em
// votação no Senado, e a Câmara não tinha parecer nem inteiro teor. O item ficava com o erro
// "Documento não disponível na API" e sem saída. Agora o(a) analista pode (a) anexar o PDF ou
// colar o link do documento e gerar a nota ou o Parecer de Especialista sobre ele, ou (b) escrever
// a nota à mão.
//
// Este arquivo tem só a parte sem tela: tipos, validação, rótulos e a instrução que vai ao modelo.
// Os arquivos anexados NÃO são gravados no Firebase: ficam na memória da aba; a análise guarda o
// rótulo, o nome do arquivo e, quando houver, o link.
//
// Script clássico (global na extensão) + module.exports para os testes.

'use strict';

/** O que o(a) analista diz que o documento é → o tipo que o gerador de notas já conhece. */
const DOCAN_TIPOS = [
  { valor: 'texto',   rotulo: 'Texto em votação (inteiro teor, redação final, texto da outra Casa)', tipo: 'INTEIRO_TEOR', principal: true },
  { valor: 'parecer', rotulo: 'Parecer do relator (com ou sem substitutivo)',                        tipo: 'PRLP',         principal: true },
  { valor: 'apoio',   rotulo: 'Documento de apoio (emendas, nota, estudo, quadro comparativo)',      tipo: 'DOC_ANALISTA', principal: false },
];
const DOCAN_MAX_BYTES = 25 * 1024 * 1024;        // acima disso os provedores de IA recusam o anexo
const DOCAN_CENARIO = 'Documento fornecido pelo(a) analista';
const DOCAN_CENARIO_LIVRE = 'Edição livre (sem documento na Câmara)';

/** Os quatro primeiros bytes de um PDF são "%PDF". Página de erro em HTML e .docx não passam. */
function docanEhPdf(buffer) {
  try { const b = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)); return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; }
  catch (_) { return false; }
}
function docanLinkValido(url) { return /^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/i.test(String(url || '').trim()); }
function docanNomeDoLink(url) { try { const u = new URL(url); return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname).slice(0, 80); } catch (_) { return 'link'; } }

/**
 * Valida as entradas do diálogo e devolve os documentos prontos para o gerador.
 * entradas: [{ origem: 'arquivo' | 'link', nome, url?, buffer?, tipo: 'texto' | 'parecer' | 'apoio', descricao? }]
 * Devolve { docs, erros }. Cada doc: { tipo, rotulo, url, arquivo, buffer, doAnalista: true }.
 */
function docanMontar(entradas = []) {
  const erros = [], docs = [];
  if (!entradas.length) erros.push('Anexe ao menos um PDF ou informe um link.');
  for (const e of entradas) {
    const t = DOCAN_TIPOS.find(x => x.valor === e.tipo) || DOCAN_TIPOS[0];
    const nome = String(e.nome || '').trim() || (e.url ? docanNomeDoLink(e.url) : 'documento');
    if (e.origem === 'link' && !docanLinkValido(e.url)) { erros.push(`Link inválido: ${String(e.url || '').slice(0, 60)}. Use um endereço que comece por https://.`); continue; }
    if (e.origem === 'arquivo') {
      if (!e.buffer || !e.buffer.byteLength) { erros.push(`O arquivo ${nome} está vazio.`); continue; }
      if (!docanEhPdf(e.buffer)) { erros.push(`${nome} não é um PDF. Salve o documento em PDF e anexe de novo.`); continue; }
      if (e.buffer.byteLength > DOCAN_MAX_BYTES) { erros.push(`${nome} tem mais de 25 MB; os provedores de IA recusam arquivos desse tamanho.`); continue; }
    }
    const descricao = String(e.descricao || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const base = t.principal ? (t.valor === 'parecer' ? 'Parecer do relator' : 'Texto em votação') : 'Documento de apoio';
    docs.push({ tipo: t.tipo, rotulo: `${base} — ${descricao || nome} (fornecido pelo(a) analista)`, url: e.origem === 'link' ? String(e.url).trim() : '', arquivo: e.origem === 'arquivo' ? nome : '', buffer: e.buffer || null, doAnalista: true });
  }
  if (docs.length && !docs.some(d => d.tipo !== 'DOC_ANALISTA')) erros.push('Marque ao menos um documento como "Texto em votação" ou "Parecer do relator": é sobre ele que a análise é feita.');
  // o texto principal vai primeiro: é o que o gerador trata como "texto em votação"
  docs.sort((a, b) => (a.tipo === 'DOC_ANALISTA') - (b.tipo === 'DOC_ANALISTA'));
  return { docs: erros.length ? [] : docs, erros };
}

/** Junta os documentos do(a) analista com os da Câmara, sem repetir o papel de texto principal. */
function docanJuntar(doAnalista = [], daCamara = []) {
  const papeis = new Set(doAnalista.filter(d => d.tipo !== 'DOC_ANALISTA').map(d => d.tipo));
  return [...doAnalista, ...daCamara.filter(d => !papeis.has(d.tipo))];
}

/** O que fica gravado com a análise: nada de bytes. */
function docanMetadados(docs = []) { return docs.map(d => ({ tipo: d.tipo, rotulo: d.rotulo, url: d.url || '', ...(d.arquivo ? { arquivo: d.arquivo } : {}), ...(d.doAnalista ? { doAnalista: true } : {}) })); }

function docanCenario(docs = []) { return docs.some(d => !d.doAnalista) ? `${DOCAN_CENARIO} + documentos da Câmara` : DOCAN_CENARIO; }

/** Instrução que acompanha os documentos: de onde vêm, e o que a nota tem de declarar. */
function docanInstrucao(docs = [], { naCamara = true, identificacao = '' } = {}) {
  const meus = docs.filter(d => d.doAnalista);
  if (!meus.length) return '';
  return [
    'DOCUMENTOS FORNECIDOS PELO(A) ANALISTA.',
    `Os documentos abaixo não foram baixados do sistema da Câmara: foram entregues pelo(a) analista responsável e são a fonte desta análise:\n${meus.map(d => `- ${d.rotulo}`).join('\n')}`,
    naCamara ? '' : `${identificacao || 'A proposição'} ainda não consta do sistema da Câmara dos Deputados: não há, lá, parecer, relator nem tramitação registrados. Não afirme fatos de tramitação na Câmara.`,
    'No início da nota, em uma frase, diga em que documento ela se baseia. Se o próprio documento indicar que o texto ainda pode mudar (votação não concluída, turno suplementar, emendas pendentes), registre isso com destaque.',
    'Não complete com informação de fora dos documentos o que eles não trazem.',
  ].filter(Boolean).join('\n');
}

/** Os documentos de uma análise gravada podem ser baixados de novo? (só os que vieram por link) */
function docanSoLinks(documentos = []) { const meus = documentos.filter(d => d && d.doAnalista); return meus.length > 0 && meus.every(d => d.url); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DOCAN_TIPOS, DOCAN_MAX_BYTES, DOCAN_CENARIO, DOCAN_CENARIO_LIVRE, docanEhPdf, docanLinkValido, docanNomeDoLink, docanMontar, docanJuntar, docanMetadados, docanCenario, docanInstrucao, docanSoLinks };
}
