// Parecer de Especialista REFEITO (17/11/2026) — pe5-coleta, pe5-prompts, pe5-pipeline, pe5-conferencia, pe5-html.
//
// Por que foi refeito: três pareceres do formato anterior, medidos com a mesma régua (PDL 557/2026,
// PL 2475/2025, PL 4675/2025), saíram com conferência "aprovado, zero pontos" — inclusive o que tinha a
// tabela de legislação errada em 8 de 12 linhas —, repetiam os mesmos números de seção em seção, perdiam
// linhas na quebra de página e ignoravam a urgência, a votação nominal e o voto da bancada.
//
// O que este teste trava:
//   1. a coleta do programa: fase da tramitação, urgência, voto da bancada, artigo da lei pelo cabeçalho;
//   2. o pipeline inteiro, SEM API, com as respostas do caso de referência (PL 4675/2025) no lugar do modelo;
//   3. as travas do pipeline: trecho inventado sai, pesquisa sem fonte sai, revisão é aplicada;
//   4. a conferência nova APONTA cada defeito visto nos pareceres antigos (defeitos injetados de propósito);
//   5. o documento: seções só com conteúdo, "não existe hoje", sem hifenização, data, quadro político;
//   6. a ligação com a tela.
// Uso: node testes/pe5.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const C = require(path.join(RAIZ, 'pe5-coleta.js')), K = require(path.join(RAIZ, 'pe5-conferencia.js')), H = require(path.join(RAIZ, 'pe5-html.js'));
const PL = require(path.join(RAIZ, 'pe5-pipeline.js')), PR = require(path.join(RAIZ, 'pe5-prompts.js')), D = require(path.join(RAIZ, 'dossie.js'));
const { gerarReferencia, FX } = require('./pe5-referencia.js');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const clone = o => JSON.parse(JSON.stringify(o));
const item = (conf, re) => conf.itens.find(i => re.test(i.teste));

(async () => {
  console.log('== 1. coleta do programa ==');
  const t = (data, orgao, desc, despacho = '') => ({ dataHora: data + 'T10:00', siglaOrgao: orgao, descricaoTramitacao: desc, despacho });
  const fSenado = C.pe5Fase({ dataHora: '2026-11-12T10:00', siglaOrgao: 'MESA', descricaoSituacao: 'Aguardando Apreciação pelo Senado Federal', descricaoTramitacao: 'Expedição de Documento', despacho: 'Remessa ao Senado Federal por meio do Of. nº 256/2026/SGM-P.' },
    [t('2026-11-11', 'PLEN', 'Aprovação de Proposição (Plenário)', 'Aprovado o Projeto.'), t('2026-11-12', 'MESA', 'Expedição de Documento', 'Remessa ao Senado Federal por meio do Of. nº 256/2026/SGM-P.')]);
  ok(fSenado.codigo === 'senado' && fSenado.jaVotadaNaCamara && /12\/11\/2026/.test(fSenado.descricao), 'matéria remetida ao Senado: fase "senado", já votada na Câmara (o parecer do PDL 557/2026 tratava como pendente)');
  ok(C.pe5Fase({ siglaOrgao: 'CDE', descricaoSituacao: 'Pronta para Pauta', regime: 'Urgência (Art. 155, RICD)' }, []).codigo === 'camara_plenario', 'urgência e pronta para pauta: Plenário da Câmara');
  ok(C.pe5Fase({ siglaOrgao: 'CCJC', descricaoSituacao: 'Aguardando Parecer', regime: 'Ordinária' }, []).codigo === 'camara_comissoes', 'tramitação ordinária em comissão');
  const fVolta = C.pe5Fase({ siglaOrgao: 'PLEN', descricaoSituacao: 'Pronta para Pauta' }, [t('2025-05-01', 'MESA', 'Remessa ao Senado Federal'), t('2026-03-01', 'MESA', 'Recebimento das Emendas do Senado Federal')]);
  ok(fVolta.codigo === 'camara_revisao_do_senado' && fVolta.revisao, 'voltou do Senado: a Câmara só delibera sobre o que mudou');
  ok(C.pe5Fase({ descricaoSituacao: 'Transformado em Norma Jurídica' }, []).codigo === 'concluida' && C.pe5Fase({ descricaoSituacao: 'Arquivada' }, []).codigo === 'encerrada', 'concluída e arquivada');
  const G = JSON.parse(fs.readFileSync(path.join(FX, 'coleta.json'), 'utf8'));
  ok(G.urgencia.tem && G.urgencia.aprovadaEm === '18/03/2026' && /art\. 155/.test(C.pe5Urgencia({ regime: 'Urgência (Art. 155, RICD)' }, []).tipo), 'urgência: tipo e data da aprovação vêm do registro (o parecer antigo dizia não haver registro)');
  const v = G.votacoes.find(x => x.nominal);
  ok(v.sim === 276 && v.nao === 186 && v.bancada.sim.length === 14 && v.bancada.nao.length === 2 && v.bancada.nao.includes('Rafael Fera'), 'votação nominal: placar 276 a 186 e Podemos 14 sim, 2 não, com os nomes');
  const rv = C.pe5ResumoVotos([{ tipoVoto: 'Sim', deputado_: { nome: 'A', siglaPartido: 'PODE' } }, { tipoVoto: 'Não', deputado_: { nome: 'B', siglaPartido: 'PL' } }, { tipoVoto: 'Obstrução', deputado_: { nome: 'C', siglaPartido: 'PODE' } }]);
  ok(rv.sim === 1 && rv.nao === 1 && rv.outros === 1 && rv.bancada.sim[0] === 'A' && rv.bancada.obstrucao[0] === 'C', 'resumo de votos: placar, partidos e bancada');

  const lei = fs.readFileSync(path.join(FX, 'lei-12529.txt'), 'utf8');
  const cab = C.pe5CabecalhosDeArtigo(lei).map(c => c.chave);
  ok(cab.length === 128 && new Set(cab).size === 128, 'a lei tem 128 artigos e os 128 cabeçalhos são achados, sem repetição');
  ok(/^Art\. 9° Compete ao Plenário do Tribunal/.test(C.pe5ArtigoVigente(lei, '9').texto) && /^art\. 9° desta Lei/.test(String(D.extrairArtigo(lei, '9'))), 'art. 9º: o cabeçalho, e não a primeira menção (a função antiga devolvia "art. 9° desta Lei, considerar-se-ão…")');
  ok(C.pe5ArtigoVigente(lei, '18-A') === null && C.pe5ArtigoVigente(lei, '87-A') === null && C.pe5ArtigoVigente(lei, '47-B') === null, 'artigo novo (18-A, 47-B, 87-A): não existe na lei — o parecer antigo imprimia o artigo vizinho');
  ok(/^Art\. 43\. A enganosidade/.test(C.pe5ArtigoVigente(lei, '43').texto) && /^Art\. 7° A perda de mandato/.test(C.pe5ArtigoVigente(lei, '7').texto), 'artigo cujo texto começa com "A": é cabeçalho, não remissão');
  ok(!/Seção II/.test(C.pe5ArtigoVigente(lei, '5').texto) && C.pe5ArtigoVigente(lei, '112').revogado, 'o título da seção seguinte não vem colado; artigo vetado é identificado');
  const alvos = C.pe5ArtigosAlterados([{ id: 'A1', dispositivo: 'arts. 18-A e 18-B da Lei nº 12.529, de 30 de novembro de 2011' }, { id: 'A2', dispositivo: 'art. 1º, parágrafo único, IX, da Lei nº 8.072/1990' }, { id: 'A3', dispositivo: 'art. 20 da Lei Complementar nº 101/2000' }]);
  ok(alvos[0].artigos.join() === '18-A,18-B' && alvos[0].numero === '12529' && alvos[1].artigos.join() === '1' && alvos[2].tipo === 'lcp', 'norma e artigos lidos do dispositivo (lei, lei complementar, sufixo de letra)');

  console.log('\n== 2. o pipeline inteiro, sem API (caso de referência) ==');
  const chamadas = [];
  const { p, prompts } = await gerarReferencia({ onChamada: c => chamadas.push(c) });
  ok(!p.erro && p.versao === 5, p.erro ? 'erro: ' + p.erro : 'o parecer é gerado');
  ok(chamadas.map(c => c.etapa).sort().join() === ['leitura', 'pesquisa-contexto', 'pesquisa-debate', 'pesquisa-internacional', 'redacao-1', 'redacao-2', 'revisao'].join(), 'sete chamadas: leitura, três pesquisas, duas de redação e a revisão');
  const ch = n => chamadas.find(c => c.etapa === n);
  ok(ch('leitura').pensar === 'alto' && ch('redacao-1').pensar === 'alto' && ch('redacao-2').pensar === 'alto' && ch('pesquisa-debate').pensar === 'medio' && ch('revisao').pensar === 'medio', 'raciocínio alto só na leitura e na redação; médio nas pesquisas e na revisão');
  ok(ch('pesquisa-debate').web && ch('pesquisa-internacional').web && ch('pesquisa-contexto').web && !ch('leitura').web && !ch('redacao-1').web, 'busca na internet só nas três pesquisas');
  ok(/<<<DOCUMENTO 1: PRLP nº 1 de 08\/07\/2026>>>/.test(prompts.leitura) && /Art\. 47-C\. Observado o disposto no art\. 47-B/.test(prompts.leitura) && /Placar 276 a 186/.test(prompts.leitura), 'a leitura recebe os documentos como TEXTO e os dados de tramitação do programa');
  ok(/LENTE "0"/.test(prompts.leitura) && /LENTE "1"/.test(prompts.leitura) && /Armadilhas do campo/.test(prompts.leitura), 'a leitura usa os roteiros de especialista da casa (perguntas e armadilhas)');
  ok(!/Art\. 47-C\. Observado o disposto/.test(prompts['redacao-1']) && !/<<<DOCUMENTO/.test(prompts['redacao-2']), 'os documentos NÃO são reenviados à redação (o pipeline antigo reenviava os PDFs a cada chamada)');
  ok(/PRIMEIRA METADE, JÁ ESCRITA/.test(prompts['redacao-2']) && /Um poder novo para o Cade/.test(prompts['redacao-2']), 'a segunda metade da redação recebe a primeira, para não repetir');
  ok(/LEI EM VIGOR, TEXTO INTEGRAL/.test(prompts['redacao-2']) && /instaurando- ?se desde logo o inquérito/.test(prompts['redacao-2']) && !/LEI EM VIGOR, TEXTO INTEGRAL/.test(prompts['redacao-1']), 'a lei em vigor vai inteira à análise (é o que sustenta "a lei atual já tem regra parecida")');
  ok(/EUR 6\.3102/.test(prompts['redacao-1']) && p.cambio.taxas.GBP === 7.5599, 'o câmbio do Banco Central vai à redação');
  ok(p.trechos.conferidos === 52 && !p.trechos.recusados.length, `os 52 trechos da leitura foram localizados nos documentos (${p.trechos.conferidos})`);
  const a9 = p.alteracoes.find(a => /art\. 9º/.test(a.dispositivo)), a18 = p.alteracoes.find(a => /18-A/.test(a.dispositivo));
  ok(/^Art\. 9° Compete ao Plenário/.test(a9.vigente) && !a9.novo && a18.novo && a18.vigente === null, 'tabela "o que muda": art. 9º com o texto dele; arts. 18-A e 18-B marcados como novos');
  ok(p.alteracoes.filter(a => a.novo).length === 5 && /texto compilado, Planalto/.test(a9.fonteLei), 'cinco linhas de dispositivo novo; a fonte da lei é dita');
  ok(p.base === undefined && p.consumo.chamadas === 7 && p.consumo.total > 0 && p.chamadas.every(c => c.tokens && c.ms >= 0), 'o consumo real de cada chamada fica gravado; a base inteira não vai para o Firebase');
  ok(p.conferencia.itens.length >= 20 && p.conferencia.criticos === 0, `conferência do caso de referência: ${p.conferencia.resumo}`);
  ok(!item(p.conferencia, /Peso das fontes oficiais/).ok && !item(p.conferencia, /Atualidade/).ok, 'a conferência aponta o que é fato: debate apoiado em imprensa e último andamento de 97 dias');
  ok(p.conferencia.itens.filter(i => !i.ok).length === 2, 'e só isso: os demais testes passam no texto de referência');

  console.log('\n== 3. travas do pipeline ==');
  const Lruim = clone(JSON.parse(fs.readFileSync(path.join(FX, 'resposta-leitura.json'), 'utf8')));
  Lruim.achados.push({ id: 'T99', lente: '1', questao: 'Achado inventado', dispositivo: 'art. 99', porque: 'x', documento: 'PRLP nº 1 de 08/07/2026', trecho: 'o agente econômico pagará contribuição anual de dois por cento do faturamento', gravidade: 'alta' });
  Lruim.versoes[0].trecho_antes = 'as características serão consideradas de modo sempre cumulativo e exaustivo';
  const r3 = await gerarReferencia({ respostas: { leitura: JSON.stringify(Lruim) } });
  ok(!r3.p.leitura.achados.some(a => a.id === 'T99') && r3.p.trechos.recusados.some(r => r.id === 'T99') && r3.p.trechos.recusados.some(r => r.id === 'V1'), 'achado e versão com trecho que não está no documento SAEM, e ficam registrados');
  ok(!item(r3.p.conferencia, /Citações dos documentos/).ok, 'e a conferência avisa');
  const deb = clone(JSON.parse(fs.readFileSync(path.join(FX, 'resposta-pesquisa-debate.json'), 'utf8')));
  deb.atores.push({ id: 'Q90', ator: 'Entidade sem fonte', posicao: 'contrário', argumentos: [{ tese: 'x' }], fonte_nome: '', fonte_url: '' });
  deb.atores[0].fonte_url = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC';
  const r4 = await gerarReferencia({ respostas: { 'pesquisa-debate': JSON.stringify(deb) }, io: { fetchFn: async u => /vertexaisearch/.test(u) ? { ok: true, url: 'https://www.mobiletime.com.br/noticias/11/08/2026/pl-4675-aliel/' } : { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) } } });
  ok(!r4.p.pesquisa.debate.atores.some(a => a.id === 'Q90') && r4.p.pesquisa.debate.avisos.some(a => /descartados por não trazerem fonte/.test(a)), 'posição sem fonte é descartada, com aviso');
  ok(r4.p.pesquisa.debate.atores[0].fonte_url_final === 'https://www.mobiletime.com.br/noticias/11/08/2026/pl-4675-aliel/', 'link temporário de redirecionamento ganha o endereço final');
  const r5 = await gerarReferencia({ respostas: { revisao: JSON.stringify({ correcoes: [{ trecho: 'tem mandato de dois anos com uma recondução e dedicação exclusiva', novo: 'tem mandato de dois anos, com uma recondução, e dedicação exclusiva', motivo: 'pontuação' }, { trecho: 'trecho que não existe no parecer de jeito nenhum', novo: 'x', motivo: 'y' }], observacoes: ['Falta a posição do Senado.'] }) } });
  ok(r5.p.revisao.aplicadas.length === 1 && r5.p.revisao.ignoradas.length === 1 && /com uma recondução, e dedicação exclusiva/.test(JSON.stringify(r5.p.doc.materia.faz)), 'revisão: a correção localizada uma única vez é aplicada; a que não se localiza fica registrada');
  ok(r5.p.conferencia.itens.some(i => /Observação da revisão/.test(i.teste) && /Senado/.test(i.detalhe)), 'observação do revisor vira linha da conferência');
  const r6 = await gerarReferencia({ respostas: { leitura: 'desculpe, não consegui' } });
  ok(/Não consegui interpretar a leitura/.test(r6.p.erro || ''), 'leitura sem JSON: erro claro, sem parecer');
  ok(PL.pe5ExtrairJson('```json\n{"a":1}\n```').a === 1 && PL.pe5ExtrairJson('Segue: {"b":[2]} fim').b[0] === 2 && PL.pe5ExtrairJson('nada') === null, 'JSON com cerca de código ou texto em volta é lido');
  const r7 = await gerarReferencia({ io: { semWeb: true } });
  ok(!r7.p.erro && r7.p.chamadas.length === 4 && !r7.p.pesquisa.debate.atores.length, 'sem busca (provedor que não a tem): o parecer sai sem as partes de pesquisa');

  console.log('\n== 4. a conferência aponta os defeitos dos pareceres antigos ==');
  const base = await gerarReferencia();
  const comBase = () => { const q = clone(base.p); q.base = { documentos: fs.readFileSync(path.join(FX, 'doc-prlp.txt'), 'utf8') + fs.readFileSync(path.join(FX, 'doc-original.txt'), 'utf8'), lei }; q.trechos = base.p.trechos; return q; };
  const conf = mut => { const q = comBase(); mut(q); return K.pe5Conferir(q, { hoje: new Date('2026-11-17T15:00:00Z') }); };
  ok(K.pe5Conferir(comBase(), { hoje: new Date('2026-11-17T15:00:00Z') }).itens.filter(i => !i.ok).length === 2, 'ponto de partida: os mesmos dois pontos de atenção');
  ok(K.pe5ExtensoParaDigitos('duzentos e dez dias, sessenta dias e até seis anos') === '210 dias, 60 dias e até 6 anos' && K.pe5ExtensoParaDigitos('um mercado e uma lei') === 'um mercado e uma lei', 'número por extenso vira algarismo ("um" e "uma" soltos ficam)');
  const nn = K.pe5Numeros('R$ 50.000.000.000,00 (cinquenta bilhões de reais), EUR 7,5 bilhões, 45 milhões de usuários, 10%, em 08/07/2026');
  ok(nn.find(x => x.moeda === 'BRL').valor === 5e10 && nn.find(x => x.moeda === 'EUR').valor === 7.5e9 && nn.find(x => x.tipo === 'qtd').valor === 45e6 && nn.find(x => x.tipo === 'pct').valor === 10 && nn.find(x => x.tipo === 'data').valor === 20260708, 'números com unidade: reais, euros, usuários, percentual e data');
  let c = conf(q => { q.doc.materia.faz[0].texto += ' A multa pode chegar a R$ 900 milhões, ou 12% do faturamento, alcança 37 milhões de usuários em 77 dias, e a regra vale desde 03/02/2021.'; });
  ok(!item(c, /Valores, percentuais/).ok && item(c, /Valores, percentuais/).critico && /R\$ 900 milhões/.test(item(c, /Valores, percentuais/).detalhe), 'números que não estão na base: apontados, crítico quando são vários');
  c = conf(q => { q.doc.analise.lentes[0].pontos[0].exame += ' Ver também o art. 133-B.'; });
  ok(!item(c, /Cada artigo citado/).ok && /133-B/.test(item(c, /Cada artigo citado/).detalhe), 'artigo que não existe em lugar nenhum: apontado');
  c = conf(q => { q.doc.abertura.alcancados = q.doc.abertura.alcancados.filter(x => !/Magazine|iFood/.test(x.grupo)); });
  ok(!item(c, /Quem é alcançado/).ok && /Magazine Luiza; iFood/.test(item(c, /Quem é alcançado/).detalhe), 'a pesquisa nomeou quem passa do piso e a abertura não listou: apontado, com os nomes');
  c = conf(q => { q.doc.abertura.alcancados = []; q.pesquisa.contexto.alcance = []; q.doc.abertura.alcance = 'O piso nacional alcança também grupos brasileiros.'; });
  ok(!item(c, /Quem é alcançado/).ok && /não diz quais/.test(item(c, /Quem é alcançado/).detalhe), '"alcança também grupos" sem dizer quais: apontado');
  c = conf(q => { q.doc.materia.documentos = q.doc.materia.documentos.filter(d => !/Relatório/.test(d.documento)); });
  ok(!item(c, /Documentos que embasam/).ok && /Plataformas Digitais/.test(item(c, /Documentos que embasam/).detalhe), 'estudo que embasa a proposição fora da relação de documentos: apontado pelo título');
  c = conf(q => { q.doc.debate.posicoes = q.doc.debate.posicoes.filter(x => !/Apple, dona/.test(x.texto)); q.doc.debate.lados.opoe.evidencia = ''; });
  ok(!item(c, /Cada entidade da pesquisa/).ok && /Apple/.test(item(c, /Cada entidade da pesquisa/).detalhe) && /de quem se opõe/.test(item(c, /Cada entidade da pesquisa/).detalhe), 'entidade da pesquisa sem parágrafo e lado sem a avaliação dos argumentos: apontados');
  c = conf(q => { q.doc.abertura.decide = 'O Plenário vota o projeto que cria regras para plataformas digitais.'; });
  ok(!item(c, /Abertura completa/).ok && /genérico/.test(item(c, /Abertura completa/).detalhe), '"o que se decide" genérico: apontado');
  ok(K.pe5Numeros('em 26 de junho de 2025 e em 1º de março de 2026').map(x => x.valor).join() === '20250626,20260301', 'data por extenso é lida como data');
  c = conf(q => { q.doc.materia.faz[0].ev = ['B77']; });
  ok(!item(c, /Cada bloco do parecer aponta/).ok && item(c, /Cada bloco do parecer aponta/).critico, 'bloco apoiado em referência inexistente: crítico');
  c = conf(q => { const f = 'O primeiro filtro é o faturamento do grupo: mais de R$ 50 bilhões por ano no mundo ou mais de R$ 5 bilhões por ano no Brasil.'; q.doc.analise.impacto.economico[0].texto += ' ' + f; q.doc.caminhos.opcoes[0].consequencias += ' ' + f; });
  ok(!item(c, /não se repete/).ok && /quase igual/.test(item(c, /não se repete/).detalhe), 'a mesma frase em seções diferentes: apontada (o PL 4675 repetia os mesmos números em oito seções)');
  c = conf(q => { q.doc.materia.origem[0].texto += ' A matéria tramita sob o Cenário 3 e a comparação é impossível com o que existe.'; });
  ok(!item(c, /jargão interno/).ok, 'jargão interno ("Cenário 3", frase-modelo): apontado');
  c = conf(q => { q.doc.materia.contexto[0].texto += ' O plenário soberano, destarte, ostenta a novel competência.'; });
  ok(!item(c, /juridiquês/).ok, 'juridiquês ("plenário soberano", "destarte", "novel"): apontado');
  c = conf(q => { q.doc.caminhos.opcoes[0].consequencias += ' Recomenda-se a aprovação do substitutivo.'; });
  ok(!item(c, /recomendação de voto/).ok && item(c, /recomendação de voto/).critico, 'recomendação de voto: crítica');
  c = conf(q => { q.coleta.fase = { codigo: 'senado', casa: 'Senado Federal', jaVotadaNaCamara: true, descricao: 'A Câmara já concluiu a votação e enviou a matéria ao Senado em 12/11/2026.' }; });
  ok(!item(c, /compatíveis com a fase/).ok && item(c, /compatíveis com a fase/).critico, 'matéria já votada na Câmara com opções de "aprovar/rejeitar": crítica (caso do PDL 557/2026)');
  c = conf(q => { q.alteracoes[1].vigente = 'art. 9° desta Lei, considerar-se-ão automaticamente suspensos os prazos previstos nesta Lei'; q.alteracoes[2].vigente = q.alteracoes[0].vigente; q.alteracoes[2].novo = false; });
  ok(!item(c, /o texto vigente é o do artigo certo/).ok && item(c, /o texto vigente é o do artigo certo/).critico && /não começa pelo art\. 9/.test(item(c, /o texto vigente é o do artigo certo/).detalhe), 'tabela de legislação com o artigo errado ou repetido: crítica (8 de 12 linhas no PL 4675)');
  c = conf(q => { q.pesquisa.debate.atores[2].data = ''; q.pesquisa.contexto.jurisprudencia[0].fonte_url = ''; });
  ok(!item(c, /têm data e fonte/).ok, 'posição sem data ou decisão sem fonte: apontada');
  c = conf(q => { q.doc.analise.jurisprudencia = q.doc.analise.jurisprudencia.slice(1); q.doc.analise.lentes.forEach(l => l.pontos.forEach(pt => { pt.ev = pt.ev.filter(e => e !== 'R1'); })); });
  ok(!item(c, /foi usado no texto/).ok && /R1/.test(item(c, /foi usado no texto/).detalhe), 'pesquisa coletada e não usada: apontada (o RE 1.083.955 ficou órfão no PL 4675)');
  c = conf(q => { q.doc.analise.jurisprudencia[0].limite = ''; });
  ok(!item(c, /onde a analogia para/).ok, 'decisão judicial sem o limite da analogia: apontada');
  c = conf(q => { q.coleta.proposicao.sigla = 'PDL'; q.doc.materia.faz[0].texto += ' A regra vale a partir da publicação, se o texto for aprovado e sancionado.'; });
  ok(!item(c, /Atualidade/).ok && /PDL não vai a sanção/.test(item(c, /Atualidade/).detalhe), '"sancionado" para decreto legislativo: apontado');
  c = conf(q => { q.doc.abertura.frase = ''; q.doc.abertura.falta = []; });
  ok(!item(c, /Abertura completa/).ok && item(c, /Abertura completa/).critico, 'abertura incompleta: crítica');

  console.log('\n== 5. o documento ==');
  const pr = clone(base.p); pr.modelo = 'modelo-de-teste';
  const html = H.htmlParecerPE5(pr, { materia: 'PL 4675/2025', css: '' });
  ok(/<td style="width:21%"><b>arts?\. /.test(html) && H.pe5LargurasFixas('<table class="pe"><thead><tr><th style="width:30%">A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>') === '<table class="pe"><thead><tr><th style="width:30%">A</th><th>B</th></tr></thead><tbody><tr><td style="width:30%">1</td><td>2</td></tr><tr><td style="width:30%">3</td><td>4</td></tr></tbody></table>', 'a largura das colunas vai em todas as linhas (a continuação da tabela na página seguinte não leva o cabeçalho)');
  ok(/<div class="pe-cola"><h2 class="item-h" id="s_atores">Quem se posicionou e como<\/h2><p>O Poder Executivo, autor do projeto, é favorável/.test(html) && /<div class="pe-cola"><h2 class="item-h" id="s_origem">Origem e tramitação<\/h2><p>/.test(html), 'título de seção anda junto com o primeiro bloco (não fica sozinho no pé da página)');
  ok(C.pe5Corta('Apresentação do projeto que altera a Lei de Defesa da Concorrência e dá outras providências', 60) === 'Apresentação do projeto que altera a Lei de Defesa da…' && C.pe5Corta('curto', 60) === 'curto', 'andamento longo é cortado no fim da palavra, com reticências');
  ok(/hyphens:manual !important/.test(html) && !/hyphens:\s*auto/.test(H.CSS_PE5), 'sem hifenização (com ela o Paged.js perdia a linha inteira na quebra de página)');
  ok(!/modelo modelo-de-teste/.test(html) && !/7 chamadas/.test(html) && !/mil tokens/.test(html) && !/pe-carimbo">/.test(html), 'modelo, número de chamadas e tokens NÃO saem no parecer (vão para o relatório de conferência)');
  ok(/p, li \{ text-align:justify; \}/.test(H.CSS_PE5), 'texto justificado');
  ok(/Placar: <b>276 a 186<\/b>/.test(html) && /<b>Podemos:<\/b> 14 sim, 2 não/.test(html) && /Votaram não: Rafael Fera, Sargento Portugal/.test(html) && /Urgência regimental \(art\. 155 do Regimento Interno da Câmara\), aprovada em 18\/03\/2026/.test(html), 'quadro político na abertura: regime, placar e voto da bancada com os nomes');
  ok(/Não existe hoje: dispositivo novo\./.test(html) && /Art\. 9° Compete ao Plenário do Tribunal/.test(html), 'tabela "o que muda": texto do artigo certo e "não existe hoje" para artigo novo');
  for (const s of ['Parte I — A matéria', 'Parte II — O debate', 'Parte III — Experiência internacional', 'Parte IV — Análise técnica', 'Parte V — Caminhos', 'Mapa de argumentos', 'Quem se posicionou e como', 'Os dois lados', 'Documentos que embasam a proposição', 'Quadro comparativo com o texto brasileiro', 'Emendas possíveis, com redação', 'Argumentos que ninguém levantou'])
    ok(html.includes(s), `tem "${s}"`);
  ok(/A favor do texto/.test(html) && /Contra o texto/.test(html) && /Quem sustenta:/.test(html) && /Evidência citada:/.test(html) && /Sem evidência apresentada na fonte\./.test(html), 'mapa de argumentos: os dois lados, quem sustenta e a evidência (ou a falta dela)');
  const posic = html.slice(html.indexOf('id="s_atores"'), html.indexOf('id="s_lados"')), lados = html.slice(html.indexOf('id="s_lados"'), html.indexOf('id="s_contro"'));
  ok((posic.match(/<p>/g) || []).length === 16 && !/<table|<ul|pe-aval|pe-ator/.test(posic), '"Quem se posicionou e como" é texto corrido, um parágrafo por entidade, como no parecer original (sem tabela nem cartões)');
  ok(/<p>A Associação Latino-Americana de Internet \(ALAI\), que reúne Google, Meta, X, Discord, Amazon e outras plataformas, é contrária ao texto em votação\. Em manifestação de 03\/11\/2026, noticiada pelo Mercado &amp; Consumo, sustenta que/.test(posic), 'cada parágrafo: quem é a entidade, o que representa, a posição, sobre qual texto, quando, por que meio e o que defende');
  ok(/não foram localizadas, nas fontes pesquisadas, manifestações individuais de Google, Meta, Amazon ou Mercado Livre/.test(posic), 'a seção fecha dizendo quem, entre os afetados, não se manifestou');
  ok((lados.match(/<p>/g) || []).length === 4 && /<p>Os defensores do projeto/.test(lados) && /<p>Sobre os argumentos de quem apoia, o texto e os documentos mostram/.test(lados) && /<p>Os críticos/.test(lados) && /<p>Sobre as objeções de quem se opõe/.test(lados), '"Os dois lados": dois parágrafos por lado — o argumento e o que a evidência diz sobre ele');
  ok(/Não procede que o texto copie a lei europeia/.test(lados) && /Confirma-se só em parte a afirmação do relator/.test(lados) && /art\. 47-E, § 1º, IV/.test(lados), 'a avaliação diz o que procede, o que procede em parte e o que não procede, com o artigo');
  ok(html.indexOf('id="s_atores"') < html.indexOf('id="s_lados"') && html.indexOf('id="s_lados"') < html.indexOf('id="s_contro"'), 'ordem da Parte II como no original: quem se posicionou, os dois lados, depois as disputas');
  ok(/Tomada de Subsídios SRE\/MF nº 1\/2024/.test(html) && /Plataformas Digitais: aspectos econômicos e concorrenciais e recomendações para aprimoramentos regulatórios no Brasil/.test(html) && /Exposição de Motivos Interministerial nº 00099\/2025/.test(html) && /301 contribuições de 72 participantes/.test(html), 'documentos que embasam a proposição citados pelo nome completo (consulta, estudo, exposição de motivos)');
  const ab = html.slice(0, html.indexOf('Parte I — A matéria'));
  ok(/Superintendência Especial de Relevância Sistêmica, Livre Concorrência e Defesa do Consumidor em Mercados Digitais/.test(ab) && /substitutivo apresentado pelo relator/.test(ab), 'abertura detalhada: o órgão novo pelo nome e o que o substitutivo mudou');
  ok(/<th style="width:34%">Grupo<\/th>/.test(ab) && ['Amazon', 'Alphabet', 'Meta', 'Mercado Livre', 'Magazine Luiza', 'iFood'].every(g => ab.includes(g)) && /R\$ 38,7 bilhões/.test(ab), '"quem é alcançado" lista os grupos pelo nome, com o piso e o dado público');
  ok(!/pesquisa na internet feita pelo modelo de IA/.test(html) && !/class="pe-nota"/.test(html) && !/Fontes e limites/.test(html) && !/O que foi lido/.test(html) && !/Conferência automática/.test(html), 'avisos de pesquisa, fontes e limites e a conferência NÃO saem no parecer');
  ok(!/\b[BQWRTVJMFK]\d{1,2}\b(?![^<]*<\/a>)/.test(html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\b(?:R|B|K)\$|\bF\d\b/g, '')), 'nenhum identificador interno (B2, Q7, W1…) impresso');
  const vazio = clone(pr); vazio.doc.internacional = { jurisdicoes: [], licoes: [], limites: [] }; vazio.doc.caminhos.emendas = []; vazio.doc.debate.da_analise = [];
  const hv = H.htmlParecerPE5(vazio, {});
  ok(!/Parte III — Experiência internacional/.test(hv) && !/Emendas possíveis/.test(hv) && !/Argumentos que ninguém levantou/.test(hv) && /Parte IV — Análise técnica/.test(hv), 'seção e parte sem conteúdo NÃO são impressas (o PL 2475 saiu com seção de nove palavras)');
  const crit = clone(pr); crit.conferencia.itens.push({ teste: 'Sem recomendação de voto', ok: false, detalhe: 'O texto recomenda voto.', critico: true });
  ok(!/O texto recomenda voto\./.test(H.htmlParecerPE5(crit, {})) && /O texto recomenda voto\./.test(H.htmlConferenciaPE5(crit, {})), 'item crítico da conferência fica no relatório de conferência, fora do parecer');
  const hc = H.htmlConferenciaPE5(pr, { materia: 'PL 4675/2025' });
  ok(/Conferência do Parecer/.test(hc) && /Testes do programa/.test(hc) && /52 trecho\(s\)/.test(hc) && /Tempo e consumo/.test(hc) && /Leitura dos documentos/.test(hc) && /Roteiros de especialista usados/.test(hc), 'relatório de conferência: testes, citações, revisão, roteiros, tempo e consumo por etapa');
  ok(/Gerado em 17\/11\/2026/.test(hc) && /modelo modelo-de-teste/.test(hc) && /7 chamadas/.test(hc) && /pesquisa na internet feita pelo modelo de IA/.test(hc) && /o programa não leu as páginas/.test(hc) && /câmbio de venda do Banco Central em 16\/11\/2026/.test(hc), 'o relatório de conferência recebe o carimbo (data, modelo, chamadas, tokens), o aviso das pesquisas e o câmbio');
  ok(/O que foi lido/.test(hc) && /Limites e avisos da pesquisa/.test(hc) && /Fontes da internet/.test(hc) && /class="pe-fontes"|<a class="pe-link" href="https:\/\//.test(hc), 'e também o que foi lido, os limites e a lista de fontes (a antiga Parte VI)');

  console.log('\n== 6. prompts e ligação com a tela ==');
  ok(/Nunca recomende voto/.test(PR.PE5_ESTILO) && /Cada informação é EXPLICADA uma vez/.test(PR.PE5_ESTILO) && /O documento é DETALHADO/.test(PR.PE5_ESTILO) && /diga ONDE procurou/.test(PR.PE5_ESTILO) && /Proibido juridiquês/.test(PR.PE5_ESTILO), 'regras de estilo: detalhado, sem voto, sem repetição, ausência com escopo, sem juridiquês');
  ok(/"referencias"/.test(prompts.leitura) && /Copie o nome e o número exatamente/.test(prompts.leitura) && /"documentos_base"/.test(prompts['pesquisa-contexto']) && /Tomada de Subsídios SRE\/MF nº 1\/2024/.test(prompts['pesquisa-contexto']) && /"documentos"/.test(prompts['redacao-1']), 'documentos-base: a leitura registra o que a proposição cita, a pesquisa localiza e a redação relaciona');
  ok(/"alcance"/.test(prompts['pesquisa-contexto']) && /QUEM, PELO NOME/.test(prompts['pesquisa-contexto']) && /"alcancados"/.test(prompts['redacao-2']) && /Nunca escreva que o texto "alcança também" alguém sem dizer quem/.test(prompts['redacao-2']), 'quem é alcançado: a pesquisa procura os nomes com o dado público e a abertura os lista');
  ok(/TEXTO CORRIDO, um parágrafo por ator/.test(prompts['redacao-1']) && /não use tabela, lista nem tópicos/.test(prompts['redacao-1']) && /NÃO teve manifestação localizada/.test(prompts['redacao-1']) && /dois parágrafos por lado/.test(prompts['redacao-1']) && /Avalia-se o ARGUMENTO, não a proposição/.test(prompts['redacao-1']), 'debate no formato do parecer original: prosa por entidade e "os dois lados" com o que a evidência diz, sem recomendar voto');
  ok(/de 900 a 1\.600 caracteres/.test(prompts['redacao-2']) && /NOME COMPLETO/.test(prompts['redacao-2']) && /ENUMERADA por inteiro/.test(prompts['redacao-2']) && /o que ele mudou/.test(prompts['redacao-2']), 'abertura detalhada: nome completo do órgão, critérios enumerados, o que o substitutivo mudou');
  ok(/QUEM SUSTENTA|quem sustenta/.test(prompts['redacao-1']) && /EVIDÊNCIA|evidencia/.test(prompts['redacao-1']) && /NENHUM ator levantou/.test(prompts['redacao-1']), 'redação do debate: quem sustenta, que evidência, e os argumentos que ninguém levantou');
  ok(/DESISTIRAM, adiaram ou revogaram/.test(prompts['pesquisa-internacional']) && /O QUE ACONTECEU/.test(prompts['pesquisa-internacional']) && /moeda original/.test(prompts['pesquisa-internacional']), 'pesquisa internacional: o que aconteceu, críticas e países que recuaram');
  ok(/Procure os DOIS lados/.test(prompts['pesquisa-debate']) && /que interesse representa/.test(prompts['pesquisa-debate']) && /registre a divergência em "avisos"/.test(prompts['pesquisa-debate']), 'pesquisa do debate: dois lados, interesse representado, divergência entre fonte e texto');
  ok(/ONDE A ANALOGIA PARA/.test(prompts['pesquisa-contexto']) && /Não atribua à decisão conclusão que ela não tomou/.test(prompts['pesquisa-contexto']), 'pesquisa de contexto: o limite de cada decisão');
  const faseVotada = PR.pe5PromptRedacao2({ identificacao: 'PDL 557/2026', hoje: '17/11/2026', coleta: { fase: { descricao: 'A Câmara já concluiu a votação.', jaVotadaNaCamara: true } }, leitura: {}, pesquisa: {}, alteracoes: [] });
  ok(/a Câmara JÁ VOTOU/.test(faseVotada), 'redação: a fase vem do programa e, se a Câmara já votou, o modelo é avisado');
  const pagina = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8'), tela = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8'), ia = fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8');
  const ordem = ['especialistas.js', 'dossie.js', 'pe5-coleta.js', 'pe5-prompts.js', 'pe5-conferencia.js', 'pe5-pipeline.js', 'pe5-html.js', 'analise.js'].map(s => pagina.indexOf(`<script src="${s}">`));
  ok(ordem.every(i => i > 0) && ordem.every((x, i) => i === 0 || x > ordem[i - 1]), 'analise.html carrega os cinco arquivos novos, antes do analise.js');
  ok(/const p = await gerarParecerPE5\(ctx, io\);/.test(tela) && /opcoes: \{ maxSaida: 32000, pensar: pensar \|\| 'medio', stream: true \}/.test(tela), 'o botão gera pelo pipeline novo, com o nível de raciocínio de cada etapa');
  ok(/const novoFormato = p\.versao === 5;/.test(tela) && /htmlConferenciaPE5\(p, opts\) : htmlParecerPE5\(p, opts\)/.test(tela) && /htmlConferencia\(p, opts\) : htmlParecer\(p, opts\)/.test(tela), 'parecer novo abre no formato novo; os já salvos continuam abrindo pelo código antigo');
  ok(/de 10 a 30 minutos/.test(tela) && /consumo real desta geração fica registrado/.test(tela) && !/250 a 350 mil tokens' \}/.test(tela), 'o aviso do diálogo não promete mais "7 a 12 minutos" nem "250 a 350 mil tokens"');
  ok(/const nivelPensar = \['alto', 'medio', 'baixo'\]/.test(ia) && /usage: usoGemini\(uso\)/.test(ia) && /usage: usoOpenAI\(json\.usage\)/.test(ia) && /usage: usoAnthropic\(json\.usage\)/.test(ia), 'a chamada de IA aceita níveis de raciocínio e devolve o consumo real, nos três provedores');
  // a página inteira avalia num escopo só, sem colisão de nomes com os módulos antigos
  const vm = require('vm');
  const scripts = [...pagina.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => /^(especialistas|dossie|ficha-objeto|tese|gates|parecer|pipeline-parecer|parecer-html|pe5-[a-z]+)\.js$/.test(s));
  let erroEscopo = null;
  try { vm.runInNewContext(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n') + '\n;globalThis.__ok = typeof gerarParecerPE5 === "function" && typeof htmlParecerPE5 === "function" && typeof gerarParecer === "function" && typeof htmlParecer === "function";', { console }); } catch (e) { erroEscopo = e; }
  ok(!erroEscopo, erroEscopo ? `colisão no escopo da página: ${erroEscopo.message}` : `os ${scripts.length} arquivos do parecer (antigos e novos) avaliam no mesmo escopo, sem colisão de nomes`);

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
