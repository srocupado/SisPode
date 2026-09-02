// Medida Provisória na Análise de Pauta — Cenários 8a e 8b.
//
// Até 02/09/2026 a MPV era "Cenário 8 — edição livre": o analista escrevia a
// nota à mão. Agora ela é gerada por IA como os demais projetos:
//   8a — sem parecer da Comissão Mista (sem PLV): a nota se baseia no texto
//        original editado pelo Executivo;
//   8b — com PLV: a nota relata as emendas ACOLHIDAS (lidas do parecer, que é
//        onde a lista está — o corpo do PLV não a traz) e compara o PLV com o
//        texto original.
// O acervo da MPV é do Senado/Congresso (Comissão Mista); a Câmara passa a ter
// o PAR (relatório + conclusão + PLV anexo) quando a Comissão conclui. A
// resolução (mpv.js) é compartilhada com o módulo Destaques.
//
// Decisão de projeto travada aqui: o JS NÃO extrai a lista de acolhidas (o
// formato da conclusão varia; uma regex que "não pega" viraria omissão
// silenciosa). A IA lista, e o JS só CONFERE que cada emenda citada na seção
// "Emendas acolhidas" aparece como emenda no texto do parecer.
//
// Parte roda contra as APIs REAIS (Câmara e Senado) e baixa o PAR 1/2026 da
// MPV 1366/2026 (55 págs) para conferir a verificação contra texto de verdade.
// pdfjs-dist vem de bot/node_modules.
// Uso: node testes/analise-mpv.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado em analise.js: ' + re); return m[0]; };
const mpv = require(path.join(RAIZ, 'mpv.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Funções puras de analise.js, avaliadas em escopo próprio com os
// colaboradores mínimos (stubs onde há rede/DOM).
const chamadasEMS = [];
const A = new Function('console', 'resolverMPVDeclarando', 'buscarEmendasSenadoESSP', 'resolverApensados', 'fetchJson', 'API_BASE', `
  ${trecho(/const CENARIO_MPV\s+= [^\n]+/)}
  ${trecho(/const CENARIO_MPV_8A = [^\n]+/)}
  ${trecho(/const CENARIO_MPV_8B = [^\n]+/)}
  ${trecho(/const TIPOS_MPV = [^\n]+/)}
  ${trecho(/const TIPOS_OPERATIVOS = [^\n]+/)}
  ${trecho(/function tipoLabel\([\s\S]*?\n}/)}
  ${trecho(/function ehMPV\([\s\S]*?\n}/)}
  ${trecho(/function ehPDL\([\s\S]*?\n}/)}
  ${trecho(/function classificarCenario\([\s\S]*?\n}/)}
  ${trecho(/function operativosAtuais\([\s\S]*?\n}/)}
  ${trecho(/function desatualizacaoOperativa\([\s\S]*?\n}/)}
  ${trecho(/async function escolherDocumentos\([\s\S]*?\n}/)}
  ${trecho(/function montarPrompt\([\s\S]*?\n}/)}
  ${trecho(/function extrairNumerosEmendas\([\s\S]*?\n}/)}
  ${trecho(/function validarEmendasCitadas\([\s\S]*?\n}/)}
  function promptPDL() { throw new Error('promptPDL não deveria ser chamado para MPV'); }
  return { CENARIO_MPV_8A, CENARIO_MPV_8B, TIPOS_OPERATIVOS, classificarCenario, operativosAtuais,
           desatualizacaoOperativa, escolherDocumentos, montarPrompt, extrairNumerosEmendas, validarEmendasCitadas };
`)(
  { log() {}, warn() {} },
  async () => { throw new Error('resolverMPVDeclarando não deveria ser chamado: enr.mpv já está preenchido'); },
  async id => { chamadasEMS.push(id); return { ems: null, ssp: null }; },
  async () => [],
  async () => ({ dados: {} }),
  'https://dadosabertos.camara.leg.br/api/v2',
);

const PAR  = { rotulo: 'PAR 1/2026',  url: 'https://camara/par',  data: '2026-08-28', fonte: 'Câmara', id: 2644834 };
const PLV  = { rotulo: 'PLV 10/2026', url: 'https://camara/plv',  data: '2026-08-28', fonte: 'Câmara', id: 2644835 };
const REL  = { rotulo: 'Relatório Legislativo da Comissão Mista', url: 'https://senado/rel', data: '2026-08-27', fonte: 'Senado/Congresso' };
const ORIG = { rotulo: 'MPV 1366/2026', url: 'https://camara/mpv', fonte: 'Câmara' };
const semPar = { comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null, prlEspecial: null, sbtAEspecial: null };
const itemMPV = (mpvRes, extra = {}) => ({
  tipoCategoria: 'projeto', sigla: 'MPV', numero: 1366, ano: 2026, chave: 'MPV 1366/2026', ementa: 'Dispõe sobre…',
  enriquecimento: { idProposicao: 2632300, urlInteiroTeor: ORIG.url, pareceresPlenario: semPar, apensadosPodemos: [], mpv: mpvRes, ...extra },
});

(async () => {
  console.log('== escolha de documentos (sem rede: enr.mpv já resolvido) ==');
  {
    const tipos = docs => docs.map(d => d.tipo).join(',');
    // 8b pela Câmara: o PAR já traz o PLV anexo — o PLV avulso NÃO se repete.
    const d1 = await A.escolherDocumentos(itemMPV({ par: PAR, plv: PLV, relatorioSenado: null, original: ORIG, temPLV: true, avisos: [] }));
    ok(tipos(d1) === 'PAR_CMMPV,MPV_TEOR', `PAR na Câmara → ${tipos(d1)} (PLV avulso não repete: já está no PAR)`);
    ok(/PAR 1\/2026 de 28\/08\/2026/.test(d1[0].rotulo), `rótulo do PAR traz número e data: "${d1[0].rotulo}"`);
    // 8b pelo Senado: relatório + texto final, na falta do PAR autuado.
    const d2 = await A.escolherDocumentos(itemMPV({ par: null, plv: { ...PLV, fonte: 'Senado/Congresso (texto final da Comissão Mista)' }, relatorioSenado: REL, original: ORIG, temPLV: true, avisos: [] }));
    ok(tipos(d2) === 'RELATORIO_CMMPV,PLV,MPV_TEOR', `sem PAR: ${tipos(d2)}`);
    // 8a: só o texto do Executivo.
    const d3 = await A.escolherDocumentos(itemMPV({ par: null, plv: null, relatorioSenado: null, original: ORIG, temPLV: false, avisos: ['Nenhum PLV localizado'] }));
    ok(tipos(d3) === 'MPV_TEOR', `sem parecer nem PLV: ${tipos(d3)}`);
    // Parecer proferido em Plenário (sem precedente; entra se existir).
    const d4 = await A.escolherDocumentos(itemMPV({ par: PAR, plv: PLV, relatorioSenado: null, original: ORIG, temPLV: true, avisos: [] },
      { pareceresPlenario: { ...semPar, prlp: { url: 'https://camara/prlp', sequencial: 1, dataBR: '01/09/2026', data: '2026-09-01' } } }));
    ok(tipos(d4) === 'PAR_CMMPV,PRLP,MPV_TEOR', `com parecer de Plenário: ${tipos(d4)}`);
    // Nada em lugar nenhum (fontes fora do ar): lista vazia, sem inventar.
    const d5 = await A.escolherDocumentos(itemMPV({ par: null, plv: null, relatorioSenado: null, original: null, temPLV: false, falha: true, avisos: ['Câmara indisponível'] }, { urlInteiroTeor: null }));
    ok(d5.length === 0, 'fontes fora do ar → nenhum documento (quem chama abre a edição livre e declara)');
    ok(chamadasEMS.length === 0, 'MPV não vai à página de emendas da Câmara (EMS/SSP não se aplicam)');
  }

  console.log('\n== cenário pelo conjunto de documentos ==');
  {
    const c = tipos => A.classificarCenario(tipos.map(tipo => ({ tipo })));
    ok(c(['MPV_TEOR']) === A.CENARIO_MPV_8A, `só o texto do Executivo → ${c(['MPV_TEOR'])}`);
    ok(c(['PAR_CMMPV', 'MPV_TEOR']) === A.CENARIO_MPV_8B, `PAR + original → ${c(['PAR_CMMPV', 'MPV_TEOR'])}`);
    ok(c(['RELATORIO_CMMPV', 'PLV', 'MPV_TEOR']) === A.CENARIO_MPV_8B, 'relatório do Senado + PLV → 8b');
    ok(c(['PRLP', 'MPV_TEOR']) === A.CENARIO_MPV_8B, 'parecer proferido em Plenário + original → 8b');
    ok(/Cenário 3/.test(c(['PRLP', 'REDACAO_ORIGINAL'])), 'PL com PRLP continua Cenário 3 (MPV não vaza para os outros)');
    ok(/Cenário 1/.test(c(['INTEIRO_TEOR'])), 'inteiro teor continua Cenário 1');
  }

  console.log('\n== prompt: seções próprias de 8b, ausentes em 8a ==');
  {
    const it8b = itemMPV({ par: PAR, plv: PLV, relatorioSenado: null, original: ORIG, temPLV: true, avisos: [] });
    const p8b = A.montarPrompt(it8b, await A.escolherDocumentos(it8b), '');
    ok(/## Emendas acolhidas/.test(p8b), '8b pede a seção "Emendas acolhidas"');
    ok(/## O que mudou em relação ao texto original da MPV/.test(p8b), '8b pede a comparação PLV × texto original');
    ok(/Principais Disposições do Projeto de Lei de Conversão \(PLV\)/.test(p8b), '8b: disposições são as do PLV');
    ok(/NÃO deduza acolhimento comparando textos: só o que o parecer declarar/.test(p8b), 'a lista de acolhidas vem do parecer, não do cotejo');
    ok(/um tópico \(item de lista com "-"\) por emenda/.test(p8b) && /"Emenda nº N/.test(p8b), 'uma emenda por tópico, no formato "Emenda nº N" (é o que a conferência lê)');
    ok(/\(d\) nas emendas acolhidas/.test(p8b), 'a regra de "sem listas" abre exceção para as acolhidas');
    ok(/Pareceres e substitutivos \(Parecer da Comissão Mista \(PAR 1\/2026 de 28\/08\/2026\)/.test(p8b), 'o título da seção de parecer carrega o rótulo do PAR');

    const it8a = itemMPV({ par: null, plv: null, relatorioSenado: null, original: ORIG, temPLV: false, avisos: [] });
    const p8a = A.montarPrompt(it8a, await A.escolherDocumentos(it8a), '');
    ok(!/## Emendas acolhidas/.test(p8a) && !/## O que mudou/.test(p8a), '8a não pede emendas nem comparação (não há PLV)');
    ok(/AINDA SEM parecer da Comissão Mista/.test(p8a), '8a diz à IA que não há parecer nem PLV');
    ok(/Principais Disposições da Medida Provisória/.test(p8a), '8a: disposições são as da MPV');
    ok(/Não presuma emendas nem alterações/.test(p8a), '8a proíbe presumir emendas');
  }

  console.log('\n== "Verificar atualização": o PLV que surge desatualiza a nota 8a ==');
  {
    const it = itemMPV({ par: PAR, plv: PLV, relatorioSenado: null, original: ORIG, temPLV: true, avisos: [] });
    it.analise = { documentos: [{ tipo: 'MPV_TEOR', rotulo: 'Texto original da Medida Provisória (inteiro teor)', url: ORIG.url }] };
    const d = A.desatualizacaoOperativa(it);
    ok(d && d.novos.length === 1 && d.novos[0].tipo === 'PAR_CMMPV', `nota 8a + PAR novo → desatualizada por ${d?.novos.map(n => n.tipo).join(',')}`);
    ok(d.novos[0].data === '2026-08-28' && /PAR 1\/2026/.test(d.novos[0].rotulo), `com data e rótulo: ${d.novos[0].rotulo} (${d.novos[0].data})`);
    // Nota 8b gerada sobre o PAR: em dia — e o PLV avulso (que existe no
    // enriquecimento) não vira falso "documento novo".
    it.analise = { documentos: [{ tipo: 'PAR_CMMPV', rotulo: 'Parecer da Comissão Mista (PAR 1/2026 de 28/08/2026) — relatório, conclusão e PLV anexo', url: PAR.url }, { tipo: 'MPV_TEOR', rotulo: 'x', url: ORIG.url }] };
    const d2 = A.desatualizacaoOperativa(it);
    ok(d2 && d2.novos.length === 0, 'nota 8b sobre o PAR: em dia (PLV anexo ao PAR não conta como novo)');
    // Sem PAR autuado, o relatório do Senado e o PLV são os operativos.
    const it2 = itemMPV({ par: null, plv: PLV, relatorioSenado: REL, original: ORIG, temPLV: true, avisos: [] });
    it2.analise = { documentos: [{ tipo: 'MPV_TEOR', rotulo: 'x', url: ORIG.url }] };
    const d3 = A.desatualizacaoOperativa(it2);
    ok(d3.novos.map(n => n.tipo).sort().join(',') === 'PLV,RELATORIO_CMMPV', `sem PAR: ${d3.novos.map(n => n.tipo).join(',')} contam`);
    ok(['PAR_CMMPV', 'PLV', 'RELATORIO_CMMPV'].every(t => A.TIPOS_OPERATIVOS.includes(t)), 'os três tipos são operativos');
  }

  console.log('\n== números de emenda citados num texto ==');
  {
    const s = t => [...A.extrairNumerosEmendas(t)].sort((a, b) => a - b).join(',');
    ok(s('Emendas nºs 3, 5, 8, 9, 13 e 14 acolhidas, e pela rejeição das Emendas nºs 1, 2, 4, 6, 7, 10, 11 e 12.') === '1,2,3,4,5,6,7,8,9,10,11,12,13,14',
       'lista com vírgulas e "e" (formato da conclusão do PAR 1/2026)');
    ok(s('Emendas de nºs 1 a 12') === '1,2,3,4,5,6,7,8,9,10,11,12', 'faixa "1 a 12"');
    ok(s('EMENDAS Nos 3, 5 e 14') === '3,5,14', '"Nos" (º vira "o" na extração do PDF) e maiúsculas');
    ok(s('Emenda nº 3, de autoria da Deputada X, e a Lei nº 14.133, de 2021, em 2026') === '3', 'não pega lei, ano nem o "de 2021"');
    ok(s('Emenda nº 14 acolhida') === '14', 'o "a" de "acolhida" não vira faixa');
    ok(s('foram apresentadas 112 emendas à MPV') === '', 'número ANTES de "emendas" não é número de emenda');
    ok(s('Emenda 7 e Emenda 9') === '7,9', 'sem "nº" também');
  }

  console.log('\n== conferência: só o que a nota cita e o parecer não tem ==');
  {
    const parecer = 'Voto pela aprovação da MPV na forma do PLV, com o acolhimento das Emendas nºs 3, 5, 8, 9, 13 e 14 e pela rejeição das Emendas nºs 1, 2, 4, 6, 7, 10, 11 e 12. '.repeat(3);
    const nota = `## Objetivo\nx\n\n## Emendas acolhidas\n- Emenda nº 3 – Dep. A – amplia o prazo.\n- Emenda nº 5 – Dep. B – cria exceção.\n- Emenda nº 99 – Dep. C – inventada.\n\nForam rejeitadas as Emendas nºs 1, 2 e 4.\n\n## O que mudou\nEmenda nº 77 aqui fora da seção não conta.\n`;
    const r = A.validarEmendasCitadas(nota, parecer);
    ok(r.length === 1 && /Emenda nº 99/.test(r[0]), `só a nº 99 é sinalizada: ${JSON.stringify(r)}`);
    ok(!r.some(x => /77/.test(x)), 'citação fora da seção "Emendas acolhidas" não é conferida');
    ok(A.validarEmendasCitadas(nota, '').length === 0, 'parecer ilegível → não sinaliza (não há contra o que conferir)');
    ok(A.validarEmendasCitadas('## Objetivo\nsem seção de emendas', parecer).length === 0, 'nota sem a seção → nada a conferir');
    ok(A.validarEmendasCitadas(nota.replace(/nº 99/, 'nº 14'), parecer).length === 0, 'todas presentes → lista vazia');
  }

  console.log('\n== resolução REAL (Câmara + Senado) ==');
  let par1366 = null;
  {
    const r = await mpv.resolverDocumentosMPV({ idCamara: 2632300, sigla: 'MPV', numero: 1366, ano: 2026, chave: 'MPV 1366/2026' });
    par1366 = r.par;
    ok(r.temPLV, 'MPV 1366/2026 tem PLV');
    ok(r.par && r.par.rotulo === 'PAR 1/2026' && /codteor=\d+/.test(r.par.url), `PAR: ${r.par?.rotulo} (${r.par?.fonte}, ${r.par?.data})`);
    ok(r.plv && r.plv.rotulo === 'PLV 10/2026', `PLV: ${r.plv?.rotulo} (${r.plv?.fonte})`);
    ok(r.original && /codteor=\d+/.test(r.original.url), `texto original: ${r.original?.url}`);
    ok(!r.avisos.some(a => /indispon/.test(a)), `sem fonte indisponível: ${JSON.stringify(r.avisos)}`);

    const s = await mpv.resolverDocumentosMPV({ idCamara: 2624161, sigla: 'MPV', numero: 1357, ano: 2026, chave: 'MPV 1357/2026' });
    ok(!s.par && !s.plv, `MPV 1357/2026 (sem parecer até 01/09/2026): par=${!!s.par} plv=${!!s.plv}`);
    ok(s.temPLV === false && s.avisos.some(a => /Nenhum PLV localizado/.test(a)), `temPLV=false, declarado: "${s.avisos.find(a => /Nenhum PLV/.test(a))}"`);
    ok(s.original && /codteor=/.test(s.original.url), `mas o texto original está lá (8a): ${s.original?.url}`);
    ok(s.avisos.some(a => /Texto final da Comissão - PLV/.test(a)), 'o Senado também foi consultado e disse que não tem texto final');
  }

  console.log('\n== conferência contra o PAR 1/2026 REAL (PDF da Câmara, 55 págs) ==');
  {
    let texto = '';
    try {
      const pdfjs = require(path.join(RAIZ, 'bot', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));
      const resp = await fetch(par1366.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = new Uint8Array(await resp.arrayBuffer());
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      for (let p = 1; p <= doc.numPages; p++) {
        const c = await (await doc.getPage(p)).getTextContent();
        texto += '\n' + c.items.map(i => i.str).join(' ');
      }
      ok(doc.numPages >= 40, `${doc.numPages} páginas lidas`);
    } catch (e) {
      ok(false, `não consegui ler o PAR (${e.message}) — o bloco abaixo fica sem base`);
    }
    if (texto) {
      const nums = A.extrairNumerosEmendas(texto);
      ok([3, 5, 8, 9, 13, 14].every(n => nums.has(n)), `as acolhidas 3, 5, 8, 9, 13 e 14 aparecem como emendas no parecer (${[...nums].sort((a, b) => a - b).join(',')})`);
      const nota = '## Emendas acolhidas\n- Emenda nº 3 – x\n- Emenda nº 13 – y\n- Emenda nº 14 – z\n- Emenda nº 41 – não existe na MPV 1366\n\n## Fim\n';
      const r = A.validarEmendasCitadas(nota, texto);
      ok(r.length === 1 && /nº 41/.test(r[0]), `contra o PDF real, só a nº 41 é sinalizada: ${JSON.stringify(r)}`);
    }
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
