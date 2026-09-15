// Pautas de Comissões — o núcleo, contra respostas reais da API da Câmara
// (fixtures de set/2026): reuniões deliberativas, itens de pauta, papel da
// comissão, prompt, fila com limite e saídas.
// Uso: node testes/pautas-comissoes.test.js
const path = require('path'), fs = require('fs');
const RAIZ = path.join(__dirname, '..');
const C = require(path.join(RAIZ, 'pautas-comissoes-core.js'));
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/comissoes', n), 'utf8'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== comissões permanentes ==');
  const orgaos = C.normalizarOrgaos(fx('orgaos-permanentes.json').dados);
  ok(orgaos.length === 30 && orgaos[0].sigla === 'CAPADR' && orgaos.find(o => o.sigla === 'CCJC').id === 2003, 'a API devolve 30 permanentes; normalizadas e ordenadas por sigla, CCJC = órgão 2003');
  ok(C.COMISSOES_PERMANENTES.length === 30 && C.COMISSOES_PERMANENTES.every(c => orgaos.some(o => o.id === c.id && o.sigla === c.sigla)), 'a lista fixa (fallback) bate com a API, id por id');
  ok(C.papelDaComissao('CCJC').tipo === 'admissibilidade' && C.papelDaComissao('CFT').tipo === 'adequacao' && C.papelDaComissao('CE').tipo === 'merito', 'papel: CCJC admissibilidade, CFT adequação, as demais mérito');
  ok(C.papelDaComissao('CCJC', 'pela constitucionalidade, juridicidade, técnica legislativa e, no mérito, pela aprovação').tipo === 'misto', 'CCJC com "no mérito" no parecer vira misto');

  console.log('\n== reuniões deliberativas ==');
  const evs = C.eventosDeliberativos(fx('eventos-2026-09-01a03.json').dados);
  ok(evs.length === 18 && evs.every(e => e.orgaoId && e.sigla && /^\d{4}-\d{2}-\d{2}$/.test(e.data) && /^\d{2}:\d{2}$/.test(e.hora)), `18 reuniões deliberativas de permanentes em 3 dias (de 34 eventos), todas com órgão, data e hora (${evs.length})`);
  ok(!evs.some(e => /Audiência|Seminário|Palestra/.test(e.tipo)), 'audiências, seminários e palestras ficam de fora');
  ok(evs.some(e => /cancelad/i.test(e.situacao)) && evs[0].data <= evs[evs.length - 1].data, 'a situação vem (há reunião cancelada) e a lista sai em ordem de data e hora');
  const todasCCJC = C.eventosDeliberativos(fx('eventos-2026-09-01a03.json').dados, { orgaoId: 2003 });
  ok(todasCCJC.length === 2 && todasCCJC.every(e => e.orgaoId === 2003 && e.sigla === 'CCJC') && todasCCJC.every(e => e.local === 'Anexo II, Plenário 01'), 'filtro por órgão: as duas reuniões da CCJC em 01/09, com o local da Câmara');
  const ccjc = [todasCCJC.find(e => e.id === 82841)];
  const porData = C.agruparPorData(evs);
  ok(Object.keys(porData).every(d => /^2026-09-0[1-3]$/.test(d)) && porData['2026-09-01'].length >= 3 && Object.values(porData).flat().length === 18, 'agrupamento por data');
  ok(C.semanaDe('2026-09-08').inicio === '2026-09-07' && C.semanaDe('2026-09-08').fim === '2026-09-11' && C.semanaDe('2026-09-13').inicio === '2026-09-07', 'semanaDe: segunda a sexta, inclusive a partir do domingo');
  ok(C.rotuloSemana(C.semanaDe('2026-09-08')) === 'Semana de 7 a 11 de setembro de 2026' && /de 28 de setembro a 2 de outubro/.test(C.rotuloSemana(C.semanaDe('2026-09-30'))), 'rótulo da semana, com virada de mês');
  ok(C.tituloReuniao(ccjc[0]) === 'Reunião Deliberativa de 01/09/2026, 16:18' && C.chaveReuniao(ccjc[0]) === '2003_82841', 'título e chave da reunião');

  console.log('\n== itens da pauta (CCJC, 01/09/2026) ==');
  const itens = C.itensDaPauta(fx('pauta-ccjc-82841.json').dados);
  ok(itens.length === 21 && itens[0].sigla === 'PL' && itens[0].numero === 4159 && itens[0].ano === 2025 && itens[0].idMateria === 2551091, `21 itens; o primeiro é a MATÉRIA do título (PL 4159/2025), não o parecer (${itens.length})`);
  ok(itens[0].parecer && itens[0].parecer.sigla === 'PRL' && itens[0].parecer.id === 2643817 && itens[0].relator.nome === 'Helder Salomão' && itens[0].relator.partido === 'PT' && itens[0].relator.uf === 'ES', 'o parecer (PRL, com id) e o relator (nome, partido, UF) vêm da pauta');
  ok(/pela constitucionalidade/.test(itens[0].textoParecer) && itens[0].topico === 'Urgente' && /Urgência/.test(itens[0].regime) && itens[0].situacaoItem === 'Aprovado o Parecer.', 'texto do parecer, tópico, regime e resultado do item');
  ok(itens[0].chave === 'PL-4159-2025' && !/[.#$\[\]\/ ]/.test(itens.map(i => i.chave).join('')), 'chave do item serve de chave no Firebase');
  ok(C.votoDoRelator(itens[3].textoParecer) === 'pela constitucionalidade, juridicidade, técnica legislativa e, no mérito, pela aprovação', 'voto do relator extraído do texto do parecer');
  // requerimento: a relacionada é o projeto apenas citado; a matéria é o próprio REQ do título
  const req = C.itensDaPauta([{ ordem: 9, topico: 'Requerimentos', titulo: 'REQ 512/2026', proposicao_: { id: 90, siglaTipo: 'REQ', numero: '512', ano: '2026', ementa: 'Requer audiência pública sobre o PL 1828/2023.' }, proposicaoRelacionada_: { id: 91, siglaTipo: 'PL', numero: '1828', ano: '2023', ementa: 'x' }, relator: null }]);
  ok(req.length === 1 && req[0].sigla === 'REQ' && req[0].idMateria === 90 && req[0].requerimento && !req[0].parecer && req[0].relator === null, 'requerimento: a matéria é o REQ do título, não o PL citado (regra do bot)');
  // a mesma matéria duas vezes (parecer e complementação de voto): fica uma linha
  const dup = C.itensDaPauta([fx('pauta-ccjc-82841.json').dados[0], { ...fx('pauta-ccjc-82841.json').dados[0], ordem: 22, proposicao_: { id: 999, siglaTipo: 'PRL', numero: 2, ano: 0, ementa: 'Complementação de voto' } }]);
  ok(dup.length === 1 && dup[0].parecer.id === 999 && dup[0].ordem === 1, 'matéria repetida na pauta vira uma linha, com o parecer mais recente e a ordem original');
  ok(C.itensDaPauta([{ titulo: 'PL 1/2026', proposicao_: { id: 5, siglaTipo: 'PRL', numero: 1, ano: 0, ementa: 'p' } }]).length === 0, 'item só com parecer e sem matéria identificável não entra');

  console.log('\n== documentos e prompt ==');
  const docs = C.documentosDoItem(itens[0], { parecer: { urlInteiroTeor: 'https://www.camara.leg.br/p.pdf' }, materia: { urlInteiroTeor: 'https://www.camara.leg.br/m.pdf' } });
  ok(docs.length === 2 && docs[0].tipo === 'PARECER' && /PRL 1 — parecer do\(a\) relator\(a\) Helder Salomão/.test(docs[0].rotulo) && docs[1].tipo === 'INTEIRO_TEOR' && /PL 4159\/2025/.test(docs[1].rotulo), 'dois documentos: o parecer (o que se vota) e o inteiro teor (referência), com rótulos');
  ok(C.documentosDoItem(itens[0], { materia: { urlInteiroTeor: 'https://x/m.pdf' } }).length === 1, 'sem URL do parecer, vai só o inteiro teor');
  const com = { sigla: 'CCJC', nome: 'Comissão de Constituição e Justiça e de Cidadania' };
  const p = C.promptComissao({ comissao: com, reuniao: ccjc[0], item: itens[3], docs });
  ok(/COMISSÃO: Comissão de Constituição e Justiça e de Cidadania \(CCJC\)/.test(p) && /Relator\(a\) na comissão: Laura Carneiro \(PSD-RJ\)/.test(p) && /Documento 1 — PRL 1/.test(p), 'o prompt nomeia a comissão, a reunião, o relator e os documentos');
  ok(/## Papel da comissão neste item/.test(p) && /## O que a comissão vota/.test(p) && /## Emendas na comissão/.test(p) && /## Pontos de atenção para a bancada/.test(p) && /## Argumentos favoráveis e contrários/.test(p), 'seções da nota: o que se vota, disposições, emendas, papel (misto na CCJC com mérito), atenção, dois lados');
  ok(/faça o cotejo entre o texto original e o texto que o parecer propõe/.test(p) && !/cenário/i.test(p), 'com os dois documentos pede o cotejo; nunca fala em cenário');
  ok(/NÃO inclua recomendação de voto/.test(p) && /forma curta da sigla/.test(p), 'regras rígidas: sem recomendação de voto, sigla curta');
  const pAdm = C.promptComissao({ comissao: com, reuniao: ccjc[0], item: itens[0], docs });
  ok(/## Admissibilidade/.test(pAdm) && /Não decrete inconstitucionalidade por conta própria/.test(pAdm), 'CCJC sem mérito: seção de admissibilidade, sem decretar inconstitucionalidade');
  const pCFT = C.promptComissao({ comissao: { sigla: 'CFT', nome: 'Comissão de Finanças e Tributação' }, reuniao: ccjc[0], item: itens[0], docs });
  ok(/## Adequação financeira e orçamentária/.test(pCFT), 'CFT: seção de adequação');
  const pReq = C.promptComissao({ comissao: com, reuniao: ccjc[0], item: req[0], docs: [] });
  ok(/## O que se decide/.test(pReq) && /Nenhum documento pôde ser anexado/.test(pReq) && !/## Emendas na comissão/.test(pReq), 'requerimento: prompt próprio, curto; sem documento, diz isso');
  const pExtra = C.promptComissao({ comissao: com, reuniao: ccjc[0], item: itens[0], docs, instrucoesExtra: 'aprofunde o impacto nos municípios' });
  ok(/INSTRUÇÕES ADICIONAIS/.test(pExtra) && /aprofunde o impacto nos municípios/.test(pExtra), 'instruções extras entram no prompt');


  console.log('\n== provedor e prompt por comissão ==');
  {
    ok(C.juntarInstrucoes('foque no impacto federativo', '') === 'foque no impacto federativo' && C.juntarInstrucoes('', 'compare com a Lei 8.112') === 'compare com a Lei 8.112', 'só um dos dois: entra como está');
    const j = C.juntarInstrucoes('foque no impacto federativo', 'compare com a Lei 8.112');
    ok(/^Orientações permanentes desta comissão:\nfoque no impacto federativo\n\nInstruções para esta análise:\ncompare com a Lei 8.112$/.test(j), 'os dois juntos, cada um nomeado');
    ok(/Orientações permanentes desta comissão:/.test(C.promptComissao({ comissao: com, reuniao: ccjc[0], item: itens[0], docs, instrucoesExtra: j })) , 'o prompt recebe o bloco combinado');
    const chaves = { gemini: 'g', anthropic: 'a' }, chaveDe = pid => chaves[pid] || '';
    const global = { provedor: 'gemini', modelo: 'gemini-3.8-flash' };
    const pad = C.provedorParaComissao({}, global, chaveDe);
    ok(pad.pid === 'gemini' && pad.apiKey === 'g' && pad.modelo === 'gemini-3.8-flash' && pad.origem === 'padrao' && !pad.aviso, 'sem configuração própria: provedor, chave e modelo das Configurações');
    const pro = C.provedorParaComissao({ provedor: 'anthropic', modelo: 'claude-opus-5' }, global, chaveDe);
    ok(pro.pid === 'anthropic' && pro.apiKey === 'a' && pro.modelo === 'claude-opus-5' && pro.origem === 'comissao', 'com provedor próprio e chave disponível: usa o da comissão');
    const semChave = C.provedorParaComissao({ provedor: 'openai', modelo: 'gpt-5' }, global, chaveDe);
    ok(semChave.pid === 'gemini' && semChave.origem === 'padrao' && /não há chave dele/.test(semChave.aviso), 'provedor próprio sem chave local: cai no padrão e avisa');
    ok(C.provedorParaComissao({ provedor: 'gemini' }, global, chaveDe).modelo === 'gemini-3.8-flash' && C.provedorParaComissao({ provedor: 'anthropic' }, global, chaveDe).modelo === '', 'modelo: o padrão só vale quando o provedor é o mesmo; noutro provedor, fica o padrão do provedor');
  }

  console.log('\n== fila com limite de requisições ==');
  {
    let t = 0; const esperas = [];
    const fila = C.criarFila({ paralelas: 2, intervaloMs: 1000, agora: () => t, dormir: async ms => { esperas.push(ms); t += ms; } });
    let emVooMax = 0, emVoo = 0;
    const job = id => fila.executar(async () => { emVoo++; emVooMax = Math.max(emVooMax, emVoo); await new Promise(r => setImmediate(r)); emVoo--; return id; });
    const r = await Promise.all([job(1), job(2), job(3), job(4)]);
    ok(r.join() === '1,2,3,4' && emVooMax <= 2, `no máximo 2 em paralelo; todas terminam (pico ${emVooMax})`);
    ok(esperas.length >= 2 && esperas.every(ms => ms > 0 && ms <= 1000), `respeita o intervalo mínimo entre inícios (${esperas.length} espera(s))`);
    ok(fila.estado().feitas === 4 && fila.estado().falhas === 0, 'contadores');
    const f2 = C.criarFila({ paralelas: 1, intervaloMs: 0 });
    let comecou = 0;
    const a = f2.executar(async () => { comecou++; await new Promise(r => setTimeout(r, 30)); return 'a'; });
    const b = f2.executar(async () => { comecou++; return 'b'; });
    f2.cancelar();
    const [ra, rb] = await Promise.allSettled([a, b]);
    ok(ra.status === 'fulfilled' && rb.status === 'rejected' && /cancelada/.test(rb.reason.message) && comecou === 1, 'cancelar: o que está em voo termina; o que espera é rejeitado');
    const f3 = C.criarFila({ paralelas: 1, intervaloMs: 0 });
    const rf = await Promise.allSettled([f3.executar(async () => { throw new Error('429'); }), f3.executar(async () => 'ok')]);
    ok(rf[0].status === 'rejected' && rf[1].value === 'ok' && f3.estado().falhas === 1, 'uma falha não derruba a fila');
    f3.paralelas = 4; f3.intervaloMs = 500;
    ok(f3.paralelas === 4 && f3.intervaloMs === 500, 'limites ajustáveis em voo (Configurações)');
  }

  console.log('\n== saídas ==');
  {
    const itensP = itens.slice(0, 3).map((it, i) => ({ ...it, autores: i === 1 ? [{ nome: 'Dep. Fulano', partido: 'PODE' }] : [], relator: i === 2 ? { ...it.relator, partido: 'PODE' } : it.relator }));
    const wa = C.textoPropPartido(com, ccjc[0], itensP);
    ok(/\*CCJC — Reunião Deliberativa de 01\/09\/2026, 16:18\*/.test(wa) && /PL 2829\/2024.*autoria: Dep\. Fulano/.test(wa) && /PL 3258\/2019.*relatoria: Laura Carneiro/.test(wa) && !/PL 4159\/2025/.test(wa), 'WhatsApp: só autoria e relatoria do Podemos');
    ok(/Nenhum item de autoria ou relatoria do Podemos/.test(C.textoPropPartido(com, ccjc[0], itens.slice(0, 2))), 'sem itens do partido, diz isso');
    const res = C.textoResumoReuniao(com, ccjc[0], itens.slice(0, 2));
    ok(/2 item\(ns\) na pauta/.test(res) && /1\. \*PL 4159\/2025\* · rel\. Helder Salomão \(PT\) — pela constitucionalidade/.test(res) && /\[Aprovado o Parecer\.\]/.test(res), 'resumo da reunião: item, relator, voto e resultado');
    const itensN = itens.slice(0, 2).map((it, i) => ({ ...it, analise: i === 0 ? { markdown: '## Objetivo\n\nx' } : null }));
    const html = C.htmlImpressaoReuniao({ comissao: com, reuniao: ccjc[0], itens: itensN, notaHtml: it => `<div class="nota"><p>${it.chave}</p></div>`, css: '@page{}' });
    ok(/Pauta de Comissão — CCJC/.test(html) && /2 item\(ns\) na pauta, 1 com nota/.test(html) && /<a href="#i_PL-4159-2025">/.test(html) && /<p>PL-4159-2025<\/p>/.test(html) && !/PL-2829-2024/.test(html) && /Relator\(a\): Helder Salomão \(PT-ES\)/.test(html), 'impressão: só os itens com nota, com índice, relator e a nota');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
