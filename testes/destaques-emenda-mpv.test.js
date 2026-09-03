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
// O acesso ao Senado (senadoCodigoMateria, senadoEmendas, resolverDocumentosMPV)
// vive em mpv.js, compartilhado com a Análise de Pauta; panel.js só escolhe.
const srcMpv = fs.readFileSync(path.join(__dirname, '..', 'mpv.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };

// Só as funções puras/HTTP do bloco do Senado, com um buscarDocumento de
// mentira que devolve o que recebeu — assim o teste confere a ESCOLHA da
// emenda sem baixar 300 KB de PDF a cada caso.
const chamadas = [];
function montar(fetchImpl) {
  return new Function('fetch', 'console', 'buscarDocumento', 'API_BASE', `
    ${srcMpv}
    ${trecho(/async function buscarEmendaMPVnoSenado\([\s\S]*?\n}/)}
    ${trecho(/async function buscarPLVdaMPV\([\s\S]*?\n}/)}
    return { senadoCodigoMateria, senadoEmendas, buscarEmendaMPVnoSenado, buscarPLVdaMPV };
  `)(fetchImpl, { log: (...a) => chamadas.push(a.join(' ')), warn: (...a) => chamadas.push(a.join(' ')) },
     async (url, extra) => ({ pdfBuffer: 'stub', url, ...extra }),
     'https://dadosabertos.camara.leg.br/api/v2');
}
const M = montar(globalThis.fetch);

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
  ok(em.length >= 100, `${em.length} emendas (medido 112 em 01/09/2026, 113 em 02/09/2026)`);
  // Numeração contígua, tolerando REPETIÇÃO de número: em 02/09/2026 o
  // endpoint passou a devolver 113 documentos para 112 emendas, porque o
  // PLV 13/2026 entrou na coleção e colidiu com a Emenda nº 13. O acervo muda
  // durante a tramitação, então a asserção é sobre a COBERTURA (1..N), não
  // sobre a contagem.
  const nums = [...new Set(em.map(e => e.numero))].sort((a, b) => a - b);
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

  console.log('\n== PLV (o substitutivo da MPV) — DVS "no substitutivo" é sobre ele ==');
  {
    // MPV 1366/2026: a Comissão Mista adotou o PLV 10/2026. Medido em
    // 01/09/2026: a Câmara relaciona o PLV e tem o inteiro teor (PDF, 11 págs).
    const mpv1366 = { sigla: 'MPV', numero: 1366, ano: 2026, chave: 'MPV 1366/2026', idCamara: 2632300 };
    chamadas.length = 0;
    const plv = await M.buscarPLVdaMPV(mpv1366);
    ok(plv && plv.rotulo === 'PLV 10/2026', `MPV 1366/2026 → ${plv?.rotulo} (esperado PLV 10/2026)`);
    ok(plv && /camara\.leg\.br\/proposicoesWeb\/prop_mostrarintegra\?codteor=\d+/.test(plv.url),
       `inteiro teor da Câmara: …${(plv?.url || '').slice(-28)}`);
    ok(plv && /Câmara/.test(plv.fonte), `fonte declarada: ${plv?.fonte}`);

    // Fallback: a Câmara ainda não autuou o PLV → o Senado tem o "Texto final
    // da Comissão - PLV 10/2026" (mesmo texto, 11 páginas). Simula a Câmara
    // sem PLV nas relacionadas e deixa o Senado REAL responder.
    const semPLVnaCamara = montar(async (url, init) => {
      if (/\/relacionadas$/.test(String(url))) return { ok: true, json: async () => ({ dados: [] }) };
      return globalThis.fetch(url, init);
    });
    chamadas.length = 0;
    const viaSenado = await semPLVnaCamara.buscarPLVdaMPV(mpv1366);
    ok(viaSenado && viaSenado.rotulo === 'PLV 10/2026', `sem PLV na Câmara, o Senado resolve: ${viaSenado?.rotulo}`);
    ok(viaSenado && /^https:\/\/legis\.senado\.leg\.br\/sdleg-getter\/documento\?dm=\d+$/.test(viaSenado.url),
       'PDF do Senado em https');
    ok(viaSenado && /Senado/.test(viaSenado.fonte), `fonte declarada: ${viaSenado?.fonte}`);
    ok(chamadas.some(c => /Sem PAR nem PLV entre as \d+ relacionadas na Câmara/.test(c)),
       'e o console conta que a Câmara não tinha e que foi ao Senado');

    // MPV 1357/2026: em 01/09/2026 não tinha PLV; em 02/09/2026 a Comissão
    // Mista concluiu e o Senado passou a ter o "Texto final - PLV 13/2026".
    // A asserção é por REGRA — o que se trava é que, HAVENDO PLV, ele vem do
    // texto final da Comissão; e NÃO havendo, devolve null com o motivo, nunca
    // o texto original da MPV, que seria o documento errado.
    const mpv1357 = { sigla: 'MPV', numero: 1357, ano: 2026, chave: 'MPV 1357/2026', idCamara: 2624161 };
    chamadas.length = 0;
    const r1357 = await M.buscarPLVdaMPV(mpv1357);
    if (r1357) {
      ok(/^PLV \d+\/\d{4}$/.test(r1357.rotulo), `a Comissão Mista concluiu: ${r1357.rotulo} (${r1357.fonte})`);
      ok(/sdleg-getter|prop_mostrarintegra/.test(r1357.url), 'com o documento do texto final');
    } else {
      ok(chamadas.some(c => /não tem "Texto final da Comissão - PLV"/.test(c)),
         `sem PLV, declara o motivo: "${chamadas.find(c => /Texto final/.test(c)) || ''}"`);
    }
  }

  console.log('\n== número de emenda repetido no Senado (medido em 02/09/2026) ==');
  {
    // A nº 13 da MPV 1357/2026 voltou duas vezes, e o primeiro documento NEM
    // É uma emenda: é o "PROJETO DE LEI DE CONVERSÃO Nº 13, DE 2026" (5 págs,
    // autoria "Comissão"), que colide com a Emenda nº 13 do Dep. Da Vitoria
    // porque as duas numerações são sequências independentes. `find` pegava o
    // PLV em silêncio — um destaque à emenda receberia o substitutivo inteiro.
    const em = await M.senadoEmendas('174123');
    const repetidos = [...new Set(em.map(e => e.numero))].filter(n => em.filter(e => e.numero === n).length > 1);
    if (!repetidos.length) {
      console.log('    (o Senado não tem mais número repetido nesta matéria — bloco pulado)');
    } else {
      const n = repetidos[0];
      const cands = em.filter(e => e.numero === n);
      chamadas.length = 0;
      const info = await M.buscarEmendaMPVnoSenado({ sigla: 'MPV', numero: 1357, ano: 2026, chave: 'MPV 1357/2026' }, n);
      const comPartido = cands.filter(c => c.partido);
      if (comPartido.length === 1) {
        ok(info && info.autorEmenda === comPartido[0].autor,
           `nº ${n} tem ${cands.length} documentos; escolhe o de autoria parlamentar (${info?.autorEmenda})`);
        ok(info && /documentos com o nº/.test(info.ambiguidade || ''),
           `e a escolha vai DECLARADA no rótulo: "${(info?.ambiguidade || '').slice(0, 80)}…"`);
        ok(chamadas.some(c => /documentos com o n/.test(c)), 'o console também registra');
      } else {
        ok(info === null, `nº ${n} ambíguo entre parlamentares → null, sem chute`);
        ok(chamadas.some(c => /AMB[ÍI]GUA/.test(c)), 'e o console diz que está ambígua');
      }
    }
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
