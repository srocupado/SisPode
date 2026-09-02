// Emendas de Medida Provisória no módulo Destaques — a fonte é o Senado.
//
// Relato de 01/09/2026 (MPV 1357/2026): o módulo buscava as emendas na página
// prop_emendas da Câmara, que para MPV vem VAZIA — a matéria tramita na
// Comissão Mista e as emendas ficam no acervo do Senado/Congresso Nacional.
// Medido: Câmara 0 emendas (API relaciona só DTQ/REQ/RPD); Senado 112 emendas,
// nº 1..112, cada uma com autor, partido e PDF.
//
// Roda contra a API REAL do Senado. Uso: node testes/destaques-emenda-mpv.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };

// Só as funções puras/HTTP do bloco do Senado, com um buscarDocumento de
// mentira que devolve o que recebeu — assim o teste confere a ESCOLHA da
// emenda sem baixar 300 KB de PDF a cada caso.
const chamadas = [];
const M = new Function('fetch', 'console', 'buscarDocumento', `
  ${trecho(/const SENADO_DADOS = [^\n]+/)}
  ${trecho(/async function senadoJson\([\s\S]*?\n}/)}
  ${trecho(/function senadoAchar\([\s\S]*?\n}/)}
  ${trecho(/async function senadoCodigoMateria\([\s\S]*?\n}/)}
  ${trecho(/async function senadoEmendas\([\s\S]*?\n}/)}
  ${trecho(/async function buscarEmendaMPVnoSenado\([\s\S]*?\n}/)}
  return { senadoCodigoMateria, senadoEmendas, buscarEmendaMPVnoSenado };
`)(globalThis.fetch, { log() {}, warn: (...a) => chamadas.push(a.join(' ')) },
   async (url, extra) => ({ pdfBuffer: 'stub', url, ...extra }));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== código da matéria no Senado ==');
  const cod = await M.senadoCodigoMateria('MPV', 1357, 2026);
  ok(cod === '174123', `MPV 1357/2026 → ${cod} (esperado 174123, o da URL do Congresso)`);
  ok((await M.senadoCodigoMateria('MPV', 999999, 2026)) === null,
     'MPV inexistente devolve null, não o primeiro resultado parecido');

  console.log('\n== emendas normalizadas ==');
  const em = await M.senadoEmendas('174123');
  ok(em.length >= 100, `${em.length} emendas (medido 112 em 01/09/2026)`);
  const nums = em.map(e => e.numero).sort((a, b) => a - b);
  ok(nums[0] === 1 && nums.every((n, i) => n === i + 1), `numeração contígua 1..${nums[nums.length - 1]}`);
  ok(em.every(e => /^https:\/\/legis\.senado\.leg\.br\/sdleg-getter\/documento\?dm=\d+$/.test(e.url)),
     'todo PDF em https no sdleg-getter (o Senado responde http:// e a extensão só fala https)');
  const e1 = em.find(e => e.numero === 1);
  ok(e1 && e1.autor === 'Aureo Ribeiro' && e1.partido === 'SOLIDARIEDADE',
     `emenda nº 1: ${e1?.autor} (${e1?.partido})`);
  ok(em.every(e => e.autor), 'toda emenda tem autor');

  console.log('\n== escolha da emenda pelo número do destaque ==');
  const prop = { sigla: 'MPV', numero: 1357, ano: 2026, chave: 'MPV 1357/2026' };
  const info = await M.buscarEmendaMPVnoSenado(prop, 2);
  ok(info && info.numeroEmenda === 2 && info.autorEmenda === 'Adriana Ventura',
     `nº 2 → ${info?.autorEmenda} (${info?.partidoEmenda}), fonte ${info?.fonte}`);
  ok(info && info.tipo === 'emenda' && info.url === em.find(e => e.numero === 2).url,
     'vai ao buscarDocumento com o PDF certo e tipo "emenda"');

  // Número que não existe: null DECLARADO, nunca "a mais parecida".
  chamadas.length = 0;
  const nada = await M.buscarEmendaMPVnoSenado(prop, 999);
  ok(nada === null, 'emenda nº 999 (inexistente) devolve null');
  ok(chamadas.some(c => /nº 999 não existe entre as \d+/.test(c)),
     `e o console declara o motivo: "${chamadas.find(c => /999/.test(c)) || ''}"`);

  chamadas.length = 0;
  const semNum = await M.buscarEmendaMPVnoSenado(prop, null);
  ok(semNum === null && chamadas.some(c => /sem número de emenda/.test(c)),
     'destaque sem número não escolhe emenda nenhuma — e diz isso');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
