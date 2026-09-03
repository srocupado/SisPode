// Leitura das fontes das leis orçamentárias (cmo.js) — Senado + portal do
// Congresso Nacional.
//
// Roda contra as fontes REAIS, e por isso as asserções são por REGRA, não por
// instantâneo: a LOA 2027 avança de etapa a cada semana e a suíte não pode
// quebrar por isso. O que se trava aqui é o COMPORTAMENTO:
//
//   a) a matéria do exercício é DESCOBERTA pelo apelido ("PLOA 2027"), nunca
//      por número fixo — o ano do arquivo não é o ano do orçamento (o PLOA 2027
//      é o PLN 24/2026, apresentado em 31/08/2026);
//   b) etapa não iniciada é DECLARADA ("a CMO ainda não publicou o cronograma"),
//      não devolvida como lista vazia muda — a nota técnica precisa dizer ao
//      analista que o prazo de emendas não existe, e não omitir a linha;
//   c) "ainda não publicado" (o portal responde 200 com "Conteúdo não
//      disponível") é diferente de "não consegui ler" (fonte fora do ar). Só o
//      segundo entra em fontesIndisponiveis e pede nova tentativa.
//
// MEDIDO em 02/09/2026: LOA 2027 com 10 etapas, 1 em andamento, cronograma e
// emendas ainda fechados, presidente da CMO designado e Relator-Geral não;
// LOA 2026 encerrada, com 16 itens de cronograma (emendas de 24/10 a
// 14/11/2025), 16 relatores setoriais e o Manual de Emendas publicado.
//
// Uso: node testes/orcamento-cmo.test.js
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const { DOMParser } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
globalThis.DOMParser = DOMParser;          // o módulo é de página; no Node, linkedom faz o papel
const C = require(path.join(RAIZ, 'cmo.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== URLs por exercício ==');
  {
    ok(C.urlCMO('loa', 2027) === 'https://www.congressonacional.leg.br/web/orcamento/acompanhe/orcamento-anual/-/loa/2027',
       'LOA usa a trilha orcamento-anual');
    ok(/diretrizes-orcamentarias\/-\/ldo\/2027\/informacoes\/cronograma$/.test(C.urlCMO('ldo', 2027, 'informacoes/cronograma')),
       'LDO usa a trilha diretrizes-orcamentarias');
    // O PPA é indexado por QUADRIÊNIO, não por exercício.
    ok(C.urlCMO('ppa', '2024-2027') === 'https://www.congressonacional.leg.br/web/orcamento/acompanhe/plano-plurianual/-/ppa/2024-2027',
       'PPA usa a trilha plano-plurianual, com o quadriênio na chave');
  }

  console.log('\n== descoberta da matéria pelo apelido ==');
  {
    const m = await C.buscarMateriaOrcamentaria('loa', 2027);
    ok(m.disponivel, `LOA 2027 localizada: ${m.identificacao} — ${m.apelido}`);
    ok(/^PLN\s*\d+\/2026$/.test(m.identificacao || ''),
       `o PLOA 2027 é um PLN de 2026 (${m.identificacao}) — o ano do arquivo não é o do orçamento`);
    ok(/exerc[íi]cio financeiro de 2027/i.test(m.ementa || ''), 'a ementa confirma o exercício');
    ok(/sdleg-getter/.test(m.urlDocumento || ''), 'traz a URL do documento');

    const ldo = await C.buscarMateriaOrcamentaria('ldo', 2027);
    ok(ldo.disponivel && /PLDO\s*2027/i.test(ldo.apelido), `LDO 2027: ${ldo.identificacao} — ${ldo.apelido}`);

    const inexistente = await C.buscarMateriaOrcamentaria('loa', 2035);
    ok(!inexistente.disponivel && /ainda não localizad/i.test(inexistente.motivo),
       `exercício futuro não inventa matéria: "${inexistente.motivo}"`);
  }

  console.log('\n== acompanhamento: as 10 etapas ==');
  {
    const a = await C.lerAcompanhamento('loa', 2027);
    ok(a.disponivel && a.etapas.length === 10, `${a.etapas.length} etapas lidas`);
    ok(a.etapas.some(e => /apresenta[çc][ãa]o de emendas/i.test(e.nome)), 'a etapa de emendas está entre elas');
    ok(a.etapas.every(e => e.estado && e.estado.length < 40),
       `cada etapa tem estado curto (ex.: "${a.etapas[0]?.nome}" → "${a.etapas[0]?.estado}")`);
    ok(a.ultimoEstado && /^\d{2}\/\d{2}\/\d{4}$/.test(a.ultimoEstado.data),
       `último estado: ${a.ultimoEstado?.data} — ${a.ultimoEstado?.descricao}`);
    // Sem cortar em 2+ espaços, a situação vinha grudada no bloco seguinte.
    ok(!/comunicad/i.test(a.ultimoEstado?.descricao || ''), 'a situação não arrasta o bloco de Comunicados');
    ok(a.documentos.length >= 1 && a.documentos.every(d => /^https:/.test(d.url)),
       `${a.documentos.length} documento(s), todos em https`);
  }

  console.log('\n== cronograma: publicado × não publicado ==');
  {
    const c26 = await C.lerCronograma('loa', 2026);
    ok(c26.disponivel && c26.itens.length >= 14, `LOA 2026: ${c26.itens.length} itens (medido 16)`);
    ok(c26.itens.every(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.inicio) && /^\d{2}\/\d{2}\/\d{4}$/.test(i.fim)),
       'todo item tem faixa de datas completa');
    const ordens = c26.itens.map(i => i.ordem);
    ok(new Set(ordens).size === ordens.length, 'sem item repetido (o tempered greedy não engole o vizinho)');
    ok(c26.prazoEmendas && c26.prazoEmendas.inicio === '24/10/2025' && c26.prazoEmendas.fim === '14/11/2025',
       `prazo de emendas isolado: ${c26.prazoEmendas?.inicio} a ${c26.prazoEmendas?.fim}`);
    ok(!/relat[óo]rio/i.test(c26.prazoEmendas?.descricao || ''),
       'e é o das emendas ao PROJETO, não o das emendas ao relatório preliminar');

    const c27 = await C.lerCronograma('loa', 2027);
    if (c27.disponivel) {
      console.log('    (a CMO publicou o cronograma da LOA 2027 — o prazo já existe)');
      ok(c27.itens.length > 0 && c27.prazoEmendas !== undefined, `${c27.itens.length} itens`);
    } else {
      ok(/ainda não publicou/i.test(c27.motivo), `não publicado, e DECLARADO: "${c27.motivo}"`);
      ok(!c27.falha, 'e isso não é falha de fonte — é o estado da tramitação');
    }
  }

  console.log('\n== relatores: designados × pendentes ==');
  {
    const r26 = await C.lerRelatores('loa', 2026);
    ok(r26.presidenteCMO && r26.presidenteCMO.nome,
       `presidente da CMO em 2026: ${r26.presidenteCMO?.nome} (${r26.presidenteCMO?.partido}/${r26.presidenteCMO?.uf})`);
    ok(r26.relatorGeral && r26.relatorGeral.casa, `relator-geral: ${r26.relatorGeral?.nome} — ${r26.relatorGeral?.casa}`);
    ok(r26.setoriais.length === 16, `16 áreas temáticas (obtidas: ${r26.setoriais.length})`);
    const areas = r26.setoriais.map(s => s.area);
    ok(new Set(areas).size === areas.length, 'sem área repetida (a tabela aparece duas vezes na página)');
    ok(r26.setoriais.every(s => s.nome && s.partido && s.uf), 'todo setorial tem nome, partido e UF');
    ok(!r26.pendencias.length, 'exercício com relatoria completa não tem pendência');

    const r27 = await C.lerRelatores('loa', 2027);
    ok(r27.presidenteCMO && r27.presidenteCMO.nome,
       `presidente da CMO em 2027: ${r27.presidenteCMO?.nome} (${r27.presidenteCMO?.partido}/${r27.presidenteCMO?.uf})`);
    if (!r27.relatorGeral) {
      ok(r27.pendencias.some(p => /Relator-Geral ainda não designado/.test(p)),
         `o "-" do portal vira pendência declarada: "${r27.pendencias[0]}"`);
      ok(r27.relatorGeral === null, 'e o campo é null, não a string "-"');
    } else {
      console.log(`    (a CMO já designou o Relator-Geral da LOA 2027: ${r27.relatorGeral.nome})`);
      ok(true, 'relatoria designada');
    }
  }

  console.log('\n== documentos de emendas e notas técnicas ==');
  {
    const e26 = await C.lerDocumentosEmendas('loa', 2026);
    ok(e26.disponivel && e26.manual, `Manual de Emendas da LOA 2026: "${e26.manual?.rotulo}"`);
    ok(/\.pdf/i.test(e26.manual?.url || '') || /documents\//.test(e26.manual?.url || ''), 'com URL de documento');
    ok(e26.documentos.some(d => d.classe === 'instrucao_normativa'), 'e a Instrução Normativa da CMO está classificada');

    const n26 = await C.lerNotasTecnicas('loa', 2026);
    ok(n26.disponivel && n26.notas.length >= 5, `${n26.notas.length} notas/estudos das consultorias`);
    ok(n26.notas.every(n => /^\d{2}\/\d{2}\/\d{4}$/.test(n.data)), 'todas com data');

    const e27 = await C.lerDocumentosEmendas('loa', 2027);
    if (!e27.disponivel) ok(/ainda não começou/i.test(e27.motivo), `LOA 2027 sem etapa de emendas: "${e27.motivo}"`);
    else ok(true, `(a etapa de emendas da LOA 2027 abriu: ${e27.documentos.length} documentos)`);
  }

  console.log('\n== o exercício muda de formato de um ano para o outro ==');
  {
    // Comparação LOA 2025 × 2026 × 2027, feita para decidir o que dá para
    // reaproveitar na ficha de parâmetros. Ela expôs dois casos de perda muda.

    // (a) A LOA 2025 escreve a data inicial SEM O ANO em três itens: "de 06/12
    //     (10h02) a 06/12/2024". Exigir dd/mm/aaaa nas duas pontas descartava
    //     os itens 5, 6 e 7 — e o 6 é "Apresentação de emendas ao relatório
    //     preliminar", um PRAZO que sumia da nota sem deixar rastro.
    const c25 = await C.lerCronograma('loa', 2025);
    ok(c25.disponivel && c25.itens.length === 13, `LOA 2025: ${c25.itens.length} itens (eram 10 antes da correção)`);
    const ordens = c25.itens.map(i => i.ordem);
    ok(JSON.stringify(ordens) === JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12,13]),
       `numeração sem buracos: ${ordens.join(',')}`);
    const item6 = c25.itens.find(i => i.ordem === 6);
    ok(item6 && /emendas ao relatório preliminar/i.test(item6.descricao),
       `o item 6 voltou: "${item6?.descricao}"`);
    ok(item6 && /^\d{2}\/\d{2}\/\d{4}$/.test(item6.inicio) && item6.inicio.endsWith('/2024'),
       `e o ano que faltava foi herdado da outra ponta: ${item6?.inicio} a ${item6?.fim}`);

    // (b) A LOA 2025 NÃO publicou "Manual de Emendas" — a orientação veio em
    //     "Instruções para elaboração de emendas no LEXOR". Sem reconhecer a
    //     variação, o exercício ficava sem âncora e a conferência normativa não
    //     tinha contra o que rodar.
    const e25 = await C.lerDocumentosEmendas('loa', 2025);
    ok(!e25.manual, 'a LOA 2025 realmente não tem "Manual de Emendas"');
    ok(e25.ancoraNormativa && /instru[çc][õo]es/i.test(e25.ancoraNormativa.rotulo),
       `mas tem âncora: "${e25.ancoraNormativa?.rotulo}"`);
    const e26 = await C.lerDocumentosEmendas('loa', 2026);
    ok(e26.ancoraNormativa === e26.manual, 'havendo Manual, é ele a âncora preferida');

    // (c) O que É estável entre exercícios: as 10 etapas. É o esqueleto que a
    //     ficha de parâmetros pode reaproveitar — nunca os valores.
    const nomes = a => a.etapas.map(e => e.nome).join('§');
    const [a25, a26, a27] = await Promise.all([2025, 2026, 2027].map(x => C.lerAcompanhamento('loa', x)));
    ok(nomes(a25) === nomes(a26) && nomes(a26) === nomes(a27),
       'as 10 etapas são idênticas em 2025, 2026 e 2027');
    // O cronograma, ao contrário, MUDA: 13 itens em 2025, 16 em 2026.
    const c26 = await C.lerCronograma('loa', 2026);
    ok(c25.itens.length !== c26.itens.length,
       `o cronograma NÃO é estável (${c25.itens.length} itens em 2025 × ${c26.itens.length} em 2026) — não se copia do ano anterior`);
  }

  console.log('\n== LDO: mesma leitura, formato diferente ==');
  {
    // A LDO tem trilha, pipeline e grafias próprios. MEDIDO em 03/09/2026:
    // 6 etapas (a LOA tem 10); cronograma com 7 itens; NÃO tem página de
    // relatores; e as notas das consultorias são listadas SEM data.
    const a = await C.lerAcompanhamento('ldo', 2026);
    ok(a.disponivel && a.etapas.length === 6, `LDO 2026: ${a.etapas.length} etapas (a LOA tem 10)`);
    ok(a.etapas.some(e => /diretrizes or[çc]ament/i.test(e.nome)), 'com a etapa própria da LDO');

    const c = await C.lerCronograma('ldo', 2026);
    ok(c.disponivel && c.prazoEmendas, `prazo de emendas da LDO 2026: ${c.prazoEmendas?.inicio} a ${c.prazoEmendas?.fim}`);

    // Página inexistente NÃO pode virar "ninguém designado": a LDO 2026 está
    // encerrada e teve relator. Afirmar o contrário seria informação falsa.
    const r = await C.lerRelatores('ldo', 2026);
    ok(!r.disponivel && /não publica página de relatores/i.test(r.motivo),
       `relatoria da LDO: "${r.motivo}"`);
    ok(!r.falha, 'e isso não é falha de fonte');

    // As notas da LDO vêm sem data — exigi-la descartava as três em silêncio.
    const n = await C.lerNotasTecnicas('ldo', 2026);
    ok(n.disponivel && n.notas.length >= 3, `${n.notas.length} notas das consultorias na LDO 2026`);
    ok(n.notas.some(x => x.data === null), 'e ao menos uma sem data, como o portal publica');
    ok(n.notas.every(x => /\/documents\/|\.pdf|sdleg-getter/i.test(x.url)),
       'toda nota aponta para um documento — "Estudos orçamentários" do menu não entra na lista');
    ok(!n.notas.some(x => /^Estudos or[çc]ament[áa]rios$/i.test(x.titulo)), 'e o item de menu não vaza');

    const m = await C.buscarMateriaOrcamentaria('ldo', 2026);
    ok(m.disponivel && /^PLN\s*\d+\/2025$/.test(m.identificacao), `PLDO 2026 é ${m.identificacao} (apresentado no ano anterior)`);
  }

  console.log('\n== PPA: quadriênio, e a parte viva são as alterações ==');
  {
    // O PPA não é anual: vale por quadriênio e é aprovado uma vez. O que
    // interessa à bancada durante os quatro anos são os projetos de ALTERAÇÃO
    // que o Executivo manda — MEDIDO em 03/09/2026: o PLN 28/2024 já virou a
    // Lei 15.060/2024 e o PLN 19/2025 segue EM TRAMITAÇÃO.
    const m = await C.buscarMateriaOrcamentaria('ppa', '2024-2027');
    ok(m.disponivel && m.identificacao === 'PLN 28/2023', `plano original: ${m.identificacao} — ${m.apelido}`);
    // O Senado apelida "PPPA", com três Ps (Projeto de Plano Plurianual). A
    // regex /^PPA\b/ que havia aqui não pegava isso e o PPA nunca era achado.
    ok(/^PPPA/i.test(m.apelido), `o apelido do Senado é "${m.apelido}", não "PPA"`);
    ok(m.normaGerada && /14\.802/.test(m.normaGerada), `virou norma: ${m.normaGerada}`);

    const c = await C.lerCronograma('ppa', '2024-2027');
    ok(c.disponivel && c.itens.length >= 8, `cronograma com ${c.itens.length} itens`);
    // O PPA escreve a hora depois de CADA data ("de 07/11/2023 (13h) a
    // 07/11/2023 (18h)"); a LOA só no fim. Sem aceitar as duas formas, os
    // itens do PPA eram descartados em silêncio.
    ok(c.itens[0] && c.itens[0].inicio === '07/11/2023' && c.itens[0].fim === '07/11/2023',
       `datas com hora em ambas as pontas: ${c.itens[0]?.inicio} a ${c.itens[0]?.fim} (${c.itens[0]?.observacao})`);

    const alt = await C.lerAlteracoesPPA('2024-2027');
    ok(alt.disponivel && alt.alteracoes.length >= 2, `${alt.alteracoes.length} alterações listadas`);
    ok(/14802/.test(alt.leiDoPlano || ''), `lei do plano em vigor: ${alt.leiDoPlano}`);
    ok(alt.alteracoes.every(a => /^PLN\s*\d+\/\d{4}$/.test(a.projeto)), 'toda alteração é um PLN identificado');
    const aprovada = alt.alteracoes.find(a => /aprovad/i.test(a.situacao || ''));
    ok(aprovada && aprovada.normaGerada, `a aprovada traz a norma gerada: ${aprovada?.projeto} → ${aprovada?.normaGerada}`);
    ok(Array.isArray(alt.emTramitacao), 'a lista do que está em tramitação existe');
    if (alt.emTramitacao.length) {
      ok(alt.emTramitacao.every(a => !a.normaGerada), 'e o que está em tramitação ainda não tem norma');
    }

    // O PPA também não tem página de relatores.
    const r = await C.lerRelatores('ppa', '2024-2027');
    ok(!r.disponivel, `relatoria do PPA: "${r.motivo}"`);
  }

  console.log('\n== materiais do Executivo (gov.br) ==');
  {
    // O portal do Congresso conta a TRAMITAÇÃO; o CONTEÚDO do orçamento está do
    // lado do Executivo. Sem ele, a nota fica em "onde o processo está" e nunca
    // chega a "o que muda para o gabinete".
    const e = await C.lerMateriaisExecutivo('loa', 2027);
    ok(e.disponivel && e.documentos.length >= 8, `PLOA 2027: ${e.documentos.length} documentos no gov.br`);
    ok(e.textoLei && /orcamentos-anuais/.test(e.textoLei.url), `texto do projeto: "${e.textoLei?.rotulo}"`);
    ok(e.comparativo, `comparativo com a lei vigente: "${e.comparativo?.rotulo}"`);
    ok(e.volumes.length >= 6, `${e.volumes.length} volumes (alocação por órgão)`);
    ok(e.documentos.every(d => d.url.startsWith('https://www.gov.br/')), 'todo link absoluto e em https');
    // Os slugs mudam a cada ano ("volume1finalrev1ploa2027_momento5…"): o
    // caminho é lido do índice, nunca montado por adivinhação.
    ok(!e.documentos.some(d => /undefined|\[object/.test(d.url)), 'nenhuma URL montada às cegas');

    const ldo = await C.lerMateriaisExecutivo('ldo', 2027);
    ok(ldo.disponivel && ldo.documentos.some(d => d.classe === 'comparativo'),
       `a LDO traz comparativos próprios: "${ldo.documentos.find(d => d.classe === 'comparativo')?.rotulo}"`);

    // Exercício futuro ainda sem página: declara, não inventa.
    const futuro = await C.lerMateriaisExecutivo('loa', 2035);
    ok(!futuro.disponivel && /ainda não publicou|indispon/i.test(futuro.motivo),
       `exercício sem página: "${futuro.motivo}"`);

    // O PPA não tem página por exercício no MPO.
    const ppa = await C.lerMateriaisExecutivo('ppa', '2024-2027');
    ok(!ppa.disponivel, `PPA: "${ppa.motivo}"`);
  }

  console.log('\n== quadro completo do exercício ==');
  {
    const e = await C.carregarExercicio('loa', 2027);
    ok(e.materia.disponivel && e.acompanhamento.disponivel, 'identificação e acompanhamento carregam juntos');
    ok(Array.isArray(e.fontesIndisponiveis), 'a lista de fontes com falha existe');
    ok(e.fontesIndisponiveis.length === 0,
       `nenhuma fonte fora do ar — etapa não iniciada NÃO entra aqui (${JSON.stringify(e.fontesIndisponiveis)})`);
    ok(typeof e.lidoEm === 'string' && e.lidoEm.length > 10, 'o quadro carimba quando foi lido');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
