// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
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

  ok(C.pe5Quorum('PEC').minimo === 308 && C.pe5Quorum('PLP').minimo === 257 && C.pe5Quorum('PL').minimo === null && C.pe5Quorum('PL').presenca === 257, 'quórum pela espécie: PEC 308 em dois turnos, PLP 257, projeto de lei por maioria simples com 257 presentes');
  const oris = [{ quem: 'PL', orientacao: 'Não' }, { quem: 'Fdr PT-PCdoB-PV', orientacao: 'Sim' }, { quem: 'Bl UniPpPsd...', orientacao: 'Liberado' }, { quem: 'Governo', orientacao: 'Sim' }, { quem: 'Maioria', orientacao: '' }];
  ok(C.pe5OrientacaoDe('PL', oris).orientacao === 'Não' && C.pe5OrientacaoDe('PCdoB', oris).orientacao === 'Sim' && C.pe5OrientacaoDe('UNIÃO', oris).de === 'Bl UniPpPsd...' && C.pe5OrientacaoDe('PSD', oris).orientacao === 'Liberado' && C.pe5OrientacaoDe('PSDB', oris).orientacao === '' && C.pe5OrientacaoDe('PODE', oris).orientacao === '', 'orientação de cada partido: a própria, a da federação ou a do bloco; sem inventar para quem não aparece (PSDB não é PSD)');
  const mapa = C.pe5MapaVotos(G);
  ok(mapa.votacao.sim === 276 && !mapa.votacao.ehMerito && mapa.ausentes === 50 && mapa.linhas.find(l => l.partido === 'UNIÃO').situacao === 'dividido' && mapa.linhas.find(l => l.partido === 'PT').situacao === 'a favor' && mapa.linhas.find(l => l.partido === 'PL').contraOrientacao === 3, 'mapa de votos: situação de cada partido (a favor, contra, dividido) e votos contra a orientação');
  ok(mapa.divididos.some(d => d.partido === 'PSD' && d.sim === 22 && d.nao === 21) && mapa.podemos.sim === 14 && mapa.podemos.nao === 2 && mapa.podemos.orientacao === '', 'mapa de votos: partidos divididos e a bancada do Podemos, sem orientação inventada');
  const semVoto = C.pe5MapaVotos({ proposicao: { sigla: 'PEC' }, votacoes: [] });
  ok(semVoto.votacao === null && semVoto.quorum.minimo === 308, 'sem votação nominal: só o quórum');
  // o partido e a matéria, com a API trocada por respostas gravadas à mão
  const API = C.PE5_API, falso = {
    [`${API}/deputados?siglaPartido=PODE&itens=100&ordem=ASC&ordenarPor=nome`]: [{ id: 11, nome: 'Fulana de Tal' }, { id: 12, nome: 'Beltrano' }],
    [`${API}/proposicoes/900/autores`]: [{ uri: `${API}/deputados/99`, nome: 'Poder Executivo' }],
    [`${API}/proposicoes/901/autores`]: [{ uri: `${API}/deputados/11`, nome: 'Fulana de Tal' }, { uri: `${API}/deputados/77`, nome: 'Outro' }],
    [`${API}/proposicoes/902/autores`]: [{ uri: `${API}/deputados/77`, nome: 'Outro' }],
    [`${API}/proposicoes?siglaPartidoAutor=PODE&keywords=concorr%C3%AAncia&siglaTipo=PL,PLP,PEC&ordem=DESC&ordenarPor=id&itens=20`]: [{ id: 950, siglaTipo: 'PL', numero: 10, ano: 2026, ementa: 'Dispõe sobre concorrência em plataformas.' }, { id: 900, siglaTipo: 'PL', numero: 1, ano: 2025, ementa: 'a própria' }],
    [`${API}/proposicoes/950`]: { dataApresentacao: '2026-02-03T10:00', statusProposicao: { descricaoSituacao: 'Aguardando Parecer' } },
    [`${API}/proposicoes/950/autores`]: [{ uri: `${API}/deputados/12`, nome: 'Beltrano' }],
    [`${API}/proposicoes?siglaTipo=PL&numero=2768&ano=2022`]: [{ id: 960, ementa: 'Plataformas digitais.' }],
    [`${API}/proposicoes/960/votacoes?ordem=ASC&ordenarPor=dataHoraRegistro`]: [{ id: 'v1', data: '2023-04-25', siglaOrgao: 'PLEN', descricao: 'Aprovado o Requerimento. Sim: 2; Não: 1.', aprovacao: 1 }],
    [`${API}/votacoes/v1/votos`]: [{ tipoVoto: 'Sim', deputado_: { nome: 'X', siglaPartido: 'PT' } }, { tipoVoto: 'Sim', deputado_: { nome: 'Y', siglaPartido: 'PT' } }, { tipoVoto: 'Não', deputado_: { nome: 'Beltrano', siglaPartido: 'PODE' } }],
    [`${API}/votacoes/v1/orientacoes`]: [{ siglaPartidoBloco: 'Bl MdbPodePsc', orientacaoVoto: 'Sim' }],
  };
  const pedidos = [];
  const fetchFalso = async url => { pedidos.push(String(url)); const d = falso[String(url)]; return d === undefined ? { ok: false, status: 504, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ dados: d }) }; };
  const Pd = await C.pe5ColetarPartido({ proposicao: { id: 900, sigla: 'PL', numero: 1, ano: 2025 }, acessorias: [{ id: 901, rotulo: 'REQ 5/2026', ementa: 'Requer audiência.' }, { id: 902, rotulo: 'EMP 1', ementa: 'Emenda.' }, { id: 903, rotulo: 'DTQ 1', ementa: 'Destaque.' }] },
    { palavras: ['concorrência', 'de', 'concorrência digital'], correlatas: ['PL 2768/2022', 'o PL nº 2.768/2022 de novo', 'PL 1/2025', 'sem número'] }, fetchFalso);
  ok(Pd.deputados === 2 && Pd.autoresDaMateria.length === 0 && Pd.acessorias.length === 1 && Pd.acessorias[0].rotulo === 'REQ 5/2026' && Pd.acessorias[0].autores.join() === 'Fulana de Tal', 'partido na matéria: só as proposições acessórias de deputado da bancada, com o nome');
  ok(Pd.termos.join() === 'concorrência' && Pd.projetos.length === 1 && Pd.projetos[0].rotulo === 'PL 10/2026' && Pd.projetos[0].autores[0] === 'Beltrano' && Pd.projetos[0].situacao === 'Aguardando Parecer' && Pd.projetos[0].apresentacao === '03/02/2026', 'projetos da bancada por palavra-chave: uma palavra por termo, sem a própria matéria, com autor, data e situação');
  const vc = Pd.votacoesCorrelatas;
  ok(vc.length === 1 && vc[0].rotulo === 'PL 2768/2022' && vc[0].nominais[0].podemosNao === 1 && vc[0].nominais[0].orientacao === 'Sim' && vc[0].nominais[0].orientadoPor === 'Bl MdbPodePsc', 'voto da bancada em proposição correlata: sem repetir, sem a própria matéria, com a orientação do bloco de que o partido fazia parte');
  ok(Pd.avisos.some(a => /acessórias/.test(a)) && !pedidos.some(u => !u.startsWith(API)), 'falha da API em um item vira aviso, sem derrubar o resto; só a API da Câmara é consultada');
  // reserva: a API não entrega as votações e os arquivos diários da Câmara respondem
  const ARQ = 'https://dadosabertos.camara.leg.br/arquivos', arq = (c, ano) => `${ARQ}/${c}/json/${c}-${ano}.json`;
  const diario = {
    [arq('votacoesProposicoes', 2025)]: [{ idVotacao: 'zz-1', proposicao_: { id: 1 } }],
    [arq('votacoesProposicoes', 2026)]: [{ idVotacao: 'a-1', proposicao_: { id: 900 } }, { idVotacao: 'a-2', proposicao_: { id: 900 } }, { idVotacao: 'b-9', proposicao_: { id: 5 } }],
    [arq('votacoes', 2026)]: [{ id: 'a-1', data: '2026-03-18', siglaOrgao: 'PLEN', aprovacao: 1, votosSim: 2, votosNao: 1, descricao: 'Aprovado o Requerimento de Urgência. Sim: 2; Não: 1.' }, { id: 'a-2', data: '2026-08-12', siglaOrgao: 'CDE', aprovacao: 1, votosSim: 0, votosNao: 0, descricao: 'Aprovado o Requerimento.' }, { id: 'b-9', data: '2026-01-01', siglaOrgao: 'PLEN', votosSim: 9, votosNao: 9, descricao: 'outra' }],
    [arq('votacoesVotos', 2026)]: [{ idVotacao: 'a-1', voto: 'Sim', deputado_: { nome: 'Fulana', siglaPartido: 'PODE' } }, { idVotacao: 'a-1', voto: 'Sim', deputado_: { nome: 'X', siglaPartido: 'PT' } }, { idVotacao: 'a-1', voto: 'Não', deputado_: { nome: 'Y', siglaPartido: 'PL' } }, { idVotacao: 'b-9', voto: 'Sim', deputado_: { nome: 'Z', siglaPartido: 'PODE' } }],
    [arq('votacoesOrientacoes', 2026)]: [{ idVotacao: 'a-1', siglaBancada: 'PL', orientacao: 'Não' }, { idVotacao: 'b-9', siglaBancada: 'PT', orientacao: 'Sim' }],
  };
  const lidos = [];
  const fetchReserva = apiVotos => async url => { const u = String(url);
    if (u.startsWith(ARQ)) { lidos.push(u.split('/').pop()); return diario[u] ? { ok: true, status: 200, json: async () => ({ dados: diario[u] }), headers: { get: k => /last-modified/i.test(k) ? 'Tue, 17 Nov 2026 06:56:25 GMT' : '' } } : { ok: false, status: 404, json: async () => ({}) }; }
    if (u === `${API}/proposicoes/900`) return { ok: true, status: 200, json: async () => ({ dados: { id: 900, siglaTipo: 'PL', numero: 1, ano: 2025, ementa: 'x', statusProposicao: {} } }) };
    if (/\/proposicoes\/900\/(tramitacoes|autores|relacionadas)/.test(u)) return { ok: true, status: 200, json: async () => ({ dados: [] }) };
    if (apiVotos && u.startsWith(`${API}/proposicoes/900/votacoes`)) return { ok: true, status: 200, json: async () => ({ dados: [] }) };
    return { ok: false, status: 504, json: async () => ({}) }; };
  const Gr = await C.pe5ColetarTramitacao(900, fetchReserva(false), { hoje: new Date('2026-11-17T15:00:00Z') });
  const vr = Gr.votacoes.find(x => x.nominal);
  ok(Gr.reservaVotacoes && Gr.reservaVotacoes.atualizadoEm === '17/11/2026' && Gr.reservaVotacoes.anos.join() === '2025,2026' && !Gr.avisos.some(a => /votações/.test(a)), 'API sem as votações: a coleta lê os arquivos diários da Câmara e registra de onde veio e de quando é');
  ok(Gr.votacoes.length === 2 && vr.sim === 2 && vr.nao === 1 && vr.bancada.sim.join() === 'Fulana' && vr.orientacoes.length === 1 && vr.orientacoes[0].quem === 'PL' && !Gr.votacoes.find(x => x.orgao === 'CDE').nominal, 'reserva: mesmas votações, placar, voto da bancada e orientações, só da proposição pedida');
  ok(lidos.join() === 'votacoesProposicoes-2025.json,votacoesProposicoes-2026.json,votacoes-2026.json,votacoesVotos-2026.json,votacoesOrientacoes-2026.json', 'reserva: só baixa os arquivos de voto do ano em que a matéria foi votada');
  lidos.length = 0;
  const Gn = await C.pe5ColetarTramitacao(900, fetchReserva(true), { hoje: new Date('2026-11-17T15:00:00Z') });
  ok(!Gn.reservaVotacoes && !lidos.length, 'API funcionando: os arquivos diários não são baixados');
  const confR = K.pe5Conferir({ coleta: { ...Gr, status: {} }, doc: {}, leitura: {}, pesquisa: {} }, { hoje: new Date('2026-11-17T15:00:00Z') });
  ok(/lidas dos arquivos diários da Câmara, atualizados em 17\/11\/2026/.test(item(confR, /Atualidade/).detalhe), 'a conferência avisa que as votações vieram do arquivo diário e de que data');
  console.log('\n== 2. o pipeline inteiro, sem API (caso de referência) ==');
  const chamadas = [];
  const { p, prompts } = await gerarReferencia({ onChamada: c => chamadas.push(c) });
  ok(!p.erro && p.versao === 5, p.erro ? 'erro: ' + p.erro : 'o parecer é gerado');
  ok(chamadas.map(c => c.etapa).sort().join() === ['leitura', 'leitura-apoio', 'pesquisa-complementar', 'pesquisa-congresso', 'pesquisa-contexto', 'pesquisa-debate', 'pesquisa-debate-economia', 'pesquisa-debate-federacao', 'pesquisa-debate-sociedade', 'pesquisa-internacional', 'pesquisa-pistas', 'redacao-1', 'redacao-1b', 'redacao-1c', 'redacao-2', 'redacao-2b', 'revisao'].join(), 'dezessete chamadas: duas de leitura, as pistas, sete pesquisas (o debate em quatro grupos de atores e a complementar, que roda uma vez só porque não traz nada novo), cinco de redação e a revisão');
  const ch = n => chamadas.find(c => c.etapa === n);
  ok(ch('leitura').pensar === 'alto' && ch('redacao-1').pensar === 'alto' && ch('redacao-2').pensar === 'alto' && ch('pesquisa-debate').pensar === 'medio' && ch('revisao').pensar === 'medio', 'raciocínio alto só na leitura e na redação; médio nas pesquisas e na revisão');
  ok(ch('pesquisa-debate').web && ch('pesquisa-internacional').web && ch('pesquisa-contexto').web && ch('pesquisa-congresso').web && !ch('leitura').web && !ch('redacao-1').web && !ch('pesquisa-pistas').web, 'busca na internet só nas pesquisas; as pistas são escritas sem busca');
  ok(['pesquisa-debate', 'pesquisa-debate-economia', 'pesquisa-internacional', 'pesquisa-contexto', 'pesquisa-congresso', 'pesquisa-complementar'].every(n => ch(n).ler === true && ch(n).buscas === 12) && !ch('pesquisa-pistas').ler && !ch('leitura').ler && !ch('redacao-1').ler, 'as pesquisas pedem leitura de páginas e doze buscas por chamada; as demais etapas, não');
  ok(/"historico"/.test(prompts['pesquisa-congresso']) && /POR QUE não avançou/.test(prompts['pesquisa-congresso']) && !/outra_casa/.test(prompts['pesquisa-congresso']) && /"judicializacao"/.test(prompts['pesquisa-congresso']) && /NÃO conclua que o texto é inconstitucional/.test(prompts['pesquisa-congresso']), 'pesquisa do Congresso: histórico do tema e por que não avançou, e sinais de judicialização');
  ok(/O PODEMOS E A MATÉRIA/.test(prompts['redacao-2']) && /PL 4411\/2026 — Duda Ramos/.test(prompts['redacao-2']) && /PL 2630\/2020, 25\/04\/2023:.*Podemos: 1 sim, 9 não; orientação Sim \(dada pelo Bl MdbPsdRepPodePsc/.test(prompts['redacao-2']) && /Partidos divididos na votação nominal de 18\/03\/2026/.test(prompts['redacao-2']), 'a redação recebe os dados do programa sobre o partido: projetos da bancada, voto em correlatas e partidos divididos');
  ok(p.coleta.mapa.votacao.sim === 276 && p.coleta.partido.projetos.length === 18 && p.pesquisa.congresso.historico.length === 3 && p.pesquisa.congresso.judicializacao[0].id === 'L1', 'mapa de votos, dados do partido e pesquisa do Congresso ficam gravados no parecer');
  ok(!/LENTE "1B"/.test(prompts.leitura) && p.lentes.every(l => l.chave !== 'federativo'), 'lente federativa não é acionada quando o texto só menciona Estados e Municípios de passagem');
  const fed = await gerarReferencia({ io: { lerPdf: async b => fs.readFileSync(path.join(FX, String(b)), 'utf8') + (String(b) === 'doc-prlp.txt' ? ('\nArt. 99. Os Estados, o Distrito Federal e os Municípios adaptarão suas normas no prazo desta Lei.' + ' Parágrafo de enchimento sem relação com o assunto.'.repeat(8)).repeat(3) : '') } });
  ok(/LENTE "1B" — Federativa/.test(fed.prompts.leitura) && /art\. 167, § 7º \(EC 128\/2022\)/.test(fed.prompts.leitura) && fed.p.lentes.some(l => l.chave === 'federativo' && /passagens do texto em votação tratam de Estados/.test(l.motivo)), 'lente federativa entra quando o texto em votação trata de Estados e Municípios, mesmo sem a palavra na ementa');
  const E = require(path.join(RAIZ, 'especialistas.js'));
  ok(E.ESPECIALISTAS.length === 15 && E.sugerirEspecialistas({ temas: [56], ementa: 'Institui piso salarial nacional para agentes de saúde dos Municípios' }).some(l => l.chave === 'federativo') && !E.sugerirEspecialistas({ temas: [40], ementa: 'Altera a Lei do Cade' }).some(l => l.chave === 'federativo'), '15 roteiros de especialista; o federativo é acionado por tema (saúde, educação) ou por termo da ementa');
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
  ok(p.base === undefined && p.consumo.chamadas === 17 && p.consumo.total > 0 && p.chamadas.every(c => c.tokens && c.ms >= 0), 'o consumo real de cada chamada fica gravado; a base inteira não vai para o Firebase');
  ok(p.conferencia.itens.length >= 20 && p.conferencia.criticos === 0, `conferência do caso de referência: ${p.conferencia.resumo}`);
  ok(!item(p.conferencia, /Peso das fontes oficiais/).ok && !item(p.conferencia, /Atualidade/).ok, 'a conferência aponta o que é fato: debate apoiado em imprensa e último andamento de 97 dias');
  ok(p.conferencia.itens.filter(i => !i.ok).length === 7 && !item(p.conferencia, /Decisões judiciais: ao menos seis/).ok && !item(p.conferencia, /ao menos seis países/).ok && !item(p.conferencia, /ao menos vinte atores/).ok && item(p.conferencia, /cinco atores de cada lado/).ok && !item(p.conferencia, /modelo oposto/).ok && /Sem a origem na pesquisa: Lei nº 12\.529\/2011/.test(item(p.conferencia, /projeto de origem/).detalhe), 'e só isso, mais os mínimos que o caso de referência (anterior a eles) não cumpre: seis países (tem cinco na nota), seis decisões (tem três), vinte atores (tem quinze), um país de modelo oposto e a origem da Lei nº 12.529/2011; os demais testes passam no texto de referência');
  ok(/LEIS QUE O TEXTO ALTERA[\s\S]*Lei nº 12\.529\/2011 — \d+ alteração\(ões\)[^\n]*obrigatória/.test(prompts['pesquisa-congresso']) && /"origem da lei alterada"/.test(prompts['pesquisa-congresso']) && /"tema delegado"/.test(prompts['pesquisa-congresso']) && /MODELO OPOSTO/.test(prompts['pesquisa-internacional']) && /"contraste"/.test(prompts['pesquisa-internacional']), 'o histórico pede a origem de cada lei alterada (a lista vem do programa) e os projetos sobre temas delegados; a pesquisa internacional pede um país de modelo oposto');
  ok(/o projeto que deu origem a cada uma destas leis, que o texto altera: Lei nº 12\.529\/2011/.test(prompts['pesquisa-complementar']) && /MODELO OPOSTO/.test(prompts['pesquisa-complementar']), 'faltando a origem e o país oposto, a chamada complementar pede os dois');

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
  ok(!r7.p.erro && r7.p.chamadas.length === 8 && !r7.p.pesquisa.debate.atores.length, 'sem busca (provedor que não a tem): o parecer sai sem as partes de pesquisa');

  console.log('\n== 4. a conferência aponta os defeitos dos pareceres antigos ==');
  const base = await gerarReferencia();
  const comBase = () => { const q = clone(base.p); q.base = { documentos: fs.readFileSync(path.join(FX, 'doc-prlp.txt'), 'utf8') + fs.readFileSync(path.join(FX, 'doc-original.txt'), 'utf8'), lei }; q.trechos = base.p.trechos; return q; };
  const conf = mut => { const q = comBase(); mut(q); return K.pe5Conferir(q, { hoje: new Date('2026-11-17T15:00:00Z') }); };
  ok(K.pe5Conferir(comBase(), { hoje: new Date('2026-11-17T15:00:00Z') }).itens.filter(i => !i.ok).length === 7, 'ponto de partida: os mesmos sete pontos de atenção');
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
  c = conf(q => { q.doc.analise.judicializacao[0].fundamento += ' Nesse ponto o dispositivo é claramente inconstitucional.'; });
  ok(!item(c, /não decreta inconstitucionalidade/).ok && item(c, /não decreta inconstitucionalidade/).critico, 'parecer que decreta inconstitucionalidade por conta própria: crítico');
  c = conf(q => { q.doc.analise.judicializacao[0].sinal += ' O STF declarou que é inconstitucional lei parecida, e a entidade sustenta que a regra viola a Constituição.'; });
  ok(item(c, /não decreta inconstitucionalidade/).ok, 'relatar decisão do STF ou alegação de alguém não é decretar');
  c = conf(q => { q.doc.analise.judicializacao = q.doc.analise.judicializacao.filter(j => !(j.ev || []).includes('L2')); q.doc.materia.historico[0].ev = ['H1', 'G']; });
  ok(!item(c, /Risco de judicialização/).ok && /regime como um todo/.test(item(c, /Risco de judicialização/).detalhe), 'sinal de judicialização que a pesquisa trouxe e a análise não examinou: apontado');
  c = conf(q => { q.doc.caminhos.partido.projetos.push('PL 9999/2026'); q.doc.caminhos.partido.texto[2].texto += ' Há ainda o PL 8888/2024.'; });
  ok(!item(c, /O Podemos e a matéria/).ok && item(c, /O Podemos e a matéria/).critico && /PL 9999\/2026/.test(item(c, /O Podemos e a matéria/).detalhe) && /PL 8888\/2024/.test(item(c, /O Podemos e a matéria/).detalhe), 'projeto atribuído à bancada que não está nos dados da Câmara: crítico');
  c = conf(q => { q.doc.abertura.decide = 'O Plenário vota o projeto que cria regras para plataformas digitais.'; });
  ok(!item(c, /Abertura completa/).ok && /genérico/.test(item(c, /Abertura completa/).detalhe), '"o que se decide" genérico: apontado');
  ok(K.pe5Numeros('em 26 de junho de 2025 e em 1º de março de 2026').map(x => x.valor).join() === '20250626,20260301', 'data por extenso é lida como data');
  c = conf(q => { q.doc.materia.faz[0].ev = ['B77']; });
  ok(!item(c, /Cada bloco da NTA aponta/).ok && item(c, /Cada bloco da NTA aponta/).critico, 'bloco apoiado em referência inexistente: crítico');
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
  ok(!/modelo modelo-de-teste/.test(html) && !/8 chamadas/.test(html) && !/mil tokens/.test(html) && !/pe-carimbo">/.test(html), 'modelo, número de chamadas e tokens NÃO saem no parecer (vão para o relatório de conferência)');
  ok(/p, li \{ text-align:justify; \}/.test(H.CSS_PE5), 'texto justificado');
  ok(/Placar: <b>276 a 186<\/b>/.test(html) && /<b>Podemos:<\/b> 14 sim, 2 não/.test(html) && /Votaram não: Rafael Fera, Sargento Portugal/.test(html) && /Urgência regimental \(art\. 155 do Regimento Interno da Câmara\), aprovada em 18\/03\/2026/.test(html), 'quadro político na abertura: regime, placar e voto da bancada com os nomes');
  ok(/Não existe hoje: dispositivo novo\./.test(html) && /Art\. 9° Compete ao Plenário do Tribunal/.test(html), 'tabela "o que muda": texto do artigo certo e "não existe hoje" para artigo novo');
  for (const s of ['Parte I — A matéria', 'Parte II — O debate', 'Parte III — Experiência internacional', 'Parte IV — Análise técnica', 'Parte V — Caminhos', 'Mapa de argumentos', 'Quem se posicionou e como', 'Os dois lados', 'Documentos que embasam a proposição', 'Histórico do tema no Congresso', 'Risco de judicialização', 'Mapa de votos', 'O Podemos e a matéria', 'Quadro comparativo com o texto brasileiro', 'Emendas possíveis, com redação', 'Argumentos que ninguém levantou'])
    ok(html.includes(s), `tem "${s}"`);
  ok(/A favor do texto/.test(html) && /Contra o texto/.test(html) && /Quem sustenta:/.test(html) && /Evidência citada:/.test(html) && /Sem evidência apresentada na fonte\./.test(html), 'mapa de argumentos: os dois lados, quem sustenta e a evidência (ou a falta dela)');
  const secPos = html.slice(html.indexOf('id="s_atores"'), html.indexOf('id="s_lados"')), posic = secPos.split('<table')[0], lados = html.slice(html.indexOf('id="s_lados"'), html.indexOf('id="s_contro"'));
  ok((posic.match(/<p>/g) || []).length === 16 && !/<ul|pe-aval|pe-ator/.test(posic), '"Quem se posicionou e como" é texto corrido, um parágrafo por entidade, como no parecer original (sem lista nem cartões)');
  ok(/<th>Favoráveis<\/th><th>Favoráveis com ressalvas<\/th><th>Contrários com ressalvas<\/th><th>Contrários<\/th>/.test(secPos) && /<b>Total<\/b>/.test(secPos) && /Não pesa os atores nem projeta voto/.test(secPos), 'depois dos parágrafos, o quadro de tendência do programa: atores por grupo e posição, com total, sem projetar voto');
  ok(/<p>A Associação Latino-Americana de Internet \(ALAI\), que reúne Google, Meta, X, Discord, Amazon e outras plataformas, é contrária ao texto em votação\. Em manifestação de 03\/11\/2026, noticiada pelo Mercado &amp; Consumo, sustenta que/.test(posic), 'cada parágrafo: quem é a entidade, o que representa, a posição, sobre qual texto, quando, por que meio e o que defende');
  ok(/não foram localizadas, nas fontes pesquisadas, manifestações individuais de Google, Meta, Amazon ou Mercado Livre/.test(posic), 'a seção fecha dizendo quem, entre os afetados, não se manifestou');
  ok((lados.match(/<p>/g) || []).length === 4 && /<p>Os defensores do projeto/.test(lados) && /<p>Sobre os argumentos de quem apoia, o texto e os documentos mostram/.test(lados) && /<p>Os críticos/.test(lados) && /<p>Sobre as objeções de quem se opõe/.test(lados), '"Os dois lados": dois parágrafos por lado — o argumento e o que a evidência diz sobre ele');
  ok(/Não procede que o texto copie a lei europeia/.test(lados) && /Confirma-se só em parte a afirmação do relator/.test(lados) && /art\. 47-E, § 1º, IV/.test(lados), 'a avaliação diz o que procede, o que procede em parte e o que não procede, com o artigo');
  ok(html.indexOf('id="s_atores"') < html.indexOf('id="s_lados"') && html.indexOf('id="s_lados"') < html.indexOf('id="s_contro"'), 'ordem da Parte II como no original: quem se posicionou, os dois lados, depois as disputas');
  ok(/Tomada de Subsídios SRE\/MF nº 1\/2024/.test(html) && /Plataformas Digitais: aspectos econômicos e concorrenciais e recomendações para aprimoramentos regulatórios no Brasil/.test(html) && /Exposição de Motivos Interministerial nº 00099\/2025/.test(html) && /301 contribuições de 72 participantes/.test(html), 'documentos que embasam a proposição citados pelo nome completo (consulta, estudo, exposição de motivos)');
  const ab = html.slice(0, html.indexOf('Parte I — A matéria'));
  ok(/Superintendência Especial de Relevância Sistêmica, Livre Concorrência e Defesa do Consumidor em Mercados Digitais/.test(ab) && /substitutivo apresentado pelo relator/.test(ab), 'abertura detalhada: o órgão novo pelo nome e o que o substitutivo mudou');
  ok(/<th style="width:34%">Grupo<\/th>/.test(ab) && ['Amazon', 'Alphabet', 'Meta', 'Mercado Livre', 'Magazine Luiza', 'iFood'].every(g => ab.includes(g)) && /R\$ 38,7 bilhões/.test(ab), '"quem é alcançado" lista os grupos pelo nome, com o piso e o dado público');
  const sc = (a, b) => html.slice(html.indexOf(`id="s_${a}"`), html.indexOf(`id="s_${b}"`));
  const votos = sc('votos', 'partido'), part = sc('partido', 'opcoes');
  ok(/Maioria simples, presente a maioria absoluta dos deputados \(art\. 47 da Constituição\)/.test(votos) && /Placar: 276 a 186/.test(votos) && /Não foi a votação do mérito/.test(votos) && /50 deputados não registraram voto/.test(votos), 'mapa de votos: quórum do mérito, a votação nominal mais recente e o aviso de que não foi a do mérito');
  ok(/<td style="width:24%"><b>UNIÃO<\/b><\/td><td style="width:9%">23<\/td><td style="width:9%">24<\/td>/.test(votos) && /<b>dividido<\/b>/.test(votos) && /Partidos divididos<\/b>[^<]*UNIÃO, 23 a 24; REPUBLICANOS, 30 a 12; PSD, 22 a 21/.test(votos) && /3 contra a orientação/.test(votos) && /não é previsão de voto/.test(votos), 'mapa de votos: tabela por partido com orientação, quem se dividiu e quantos votaram contra a orientação; sem projetar voto');
  ok(!/<th>UNIÃO<\/th>/.test(html.slice(0, html.indexOf('Parte I — A matéria'))), 'a tabela por partido saiu da abertura (fica uma vez, no mapa de votos)');
  ok(['PL 4411/2026', 'PL 4555/2026', 'PL 4371/2026'].every(r => part.includes(`<b>${r}</b>`)) && !/<b>PL 4625\/2026<\/b>/.test(part) && /Duda Ramos/.test(part), 'o Podemos e a matéria: só os projetos da bancada que o texto apontou como do mesmo assunto, com autor e situação vindos da Câmara');
  ok(/<b>PL 2630\/2020<\/b>/.test(part) && /1 sim, 9 não<br><small>orientação: Sim \(Bl MdbPsdRepPodePsc\)/.test(part) && /Sem votação nominal em Plenário registrada: PL 2768\/2022/.test(part), 'voto da bancada em proposição correlata, com a orientação do bloco; correlata sem voto nominal é dita');
  const jud = sc('judic', 'impacto'), hist = sc('historico', 'versoes') || '';
  ok(/não afirma que o texto seja inconstitucional/.test(jud) && /Quem pode questionar/.test(jud) && /art\. 87-H, § 2º/.test(jud) && /Instituto dos Advogados Brasileiros<\/a>/.test(jud) && /Agência Pública<\/a>/.test(jud), 'risco de judicialização: ponto, legitimado, fundamento, o que há de concreto (com a fonte) e o que reduz o risco');
  ok(/PL 2630\/2020 \(Senado\)/.test(html) && /PL 2768\/2022 \(Câmara\)/.test(html) && /por falta de consenso/.test(html) && /troca a Anatel pelo Cade/.test(html), 'histórico do tema: cada tentativa anterior, o desfecho e por que não avançou');
  ok(!/O que espera a matéria no Senado/.test(html) && !/id="s_proxima"/.test(html), 'a seção sobre a próxima Casa foi retirada do parecer');
  ok(!/pesquisa na internet feita pelo modelo de IA/.test(html) && !/class="pe-nota"/.test(html) && !/Fontes e limites/.test(html) && !/O que foi lido/.test(html) && !/Conferência automática/.test(html), 'avisos de pesquisa, fontes e limites e a conferência NÃO saem no parecer');
  ok(!/\b[BQWRTVJMFK]\d{1,2}\b(?![^<]*<\/a>)/.test(html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\b(?:R|B|K)\$|\bF\d\b/g, '')), 'nenhum identificador interno (B2, Q7, W1…) impresso');
  const vazio = clone(pr); vazio.doc.internacional = { jurisdicoes: [], licoes: [], limites: [] }; vazio.doc.caminhos.emendas = []; vazio.doc.debate.da_analise = [];
  const hv = H.htmlParecerPE5(vazio, {});
  ok(!/Parte III — Experiência internacional/.test(hv) && !/Emendas possíveis/.test(hv) && !/Argumentos que ninguém levantou/.test(hv) && /Parte IV — Análise técnica/.test(hv), 'seção e parte sem conteúdo NÃO são impressas (o PL 2475 saiu com seção de nove palavras)');
  const crit = clone(pr); crit.conferencia.itens.push({ teste: 'Sem recomendação de voto', ok: false, detalhe: 'O texto recomenda voto.', critico: true });
  ok(!/O texto recomenda voto\./.test(H.htmlParecerPE5(crit, {})) && /O texto recomenda voto\./.test(H.htmlConferenciaPE5(crit, {})), 'item crítico da conferência fica no relatório de conferência, fora do parecer');
  const hc = H.htmlConferenciaPE5(pr, { materia: 'PL 4675/2025' });
  ok(/Conferência da NTA/.test(hc) && /Testes do programa/.test(hc) && /52 trecho\(s\)/.test(hc) && /Tempo e consumo/.test(hc) && /Leitura dos documentos/.test(hc) && /Roteiros de especialista usados/.test(hc), 'relatório de conferência: testes, citações, revisão, roteiros, tempo e consumo por etapa');
  ok(/Gerado em 17\/11\/2026/.test(hc) && /modelo modelo-de-teste/.test(hc) && /17 chamadas/.test(hc) && /pesquisa na internet feita pelo modelo de IA/.test(hc) && /o programa não leu as páginas/.test(hc) && /câmbio de venda do Banco Central em 16\/11\/2026/.test(hc), 'o relatório de conferência recebe o carimbo (data, modelo, chamadas, tokens), o aviso das pesquisas e o câmbio');
  ok(/O risco de judicialização é exame de risco/.test(hc) && /Quais projetos tratam do mesmo assunto foi escolha do modelo/.test(hc) && /Histórico: PL 2630\/2020/.test(hc) && /Judicialização: /.test(hc) && /Pesquisa do histórico do tema e da judicialização/.test(hc), 'conferência: avisos, fontes e consumo das seções novas');
  ok(/O que foi lido/.test(hc) && /Limites e avisos da pesquisa/.test(hc) && /Fontes da internet/.test(hc) && /class="pe-fontes"|<a class="pe-link" href="https:\/\//.test(hc), 'e também o que foi lido, os limites e a lista de fontes (a antiga Parte VI)');

  console.log('\n== 6. prompts e ligação com a tela ==');
  // a redação vai em quatro chamadas: cada metade é a soma das duas partes dela
  const red1 = prompts['redacao-1'] + prompts['redacao-1b'] + prompts['redacao-1c'], red2 = prompts['redacao-2'] + prompts['redacao-2b'];
  ok(/Nunca recomende voto/.test(PR.PE5_ESTILO) && /Cada informação é EXPLICADA uma vez/.test(PR.PE5_ESTILO) && /O documento é DETALHADO/.test(PR.PE5_ESTILO) && /diga ONDE procurou/.test(PR.PE5_ESTILO) && /Proibido juridiquês/.test(PR.PE5_ESTILO), 'regras de estilo: detalhado, sem voto, sem repetição, ausência com escopo, sem juridiquês');
  ok(/"referencias"/.test(prompts['leitura-apoio']) && !/"referencias"/.test(prompts.leitura) && /Copie o nome e o número exatamente/.test(prompts['leitura-apoio']) && /"documentos_base"/.test(prompts['pesquisa-contexto']) && /Tomada de Subsídios SRE\/MF nº 1\/2024/.test(prompts['pesquisa-contexto']) && /"documentos"/.test(red1), 'documentos-base: a leitura registra o que a proposição cita, a pesquisa localiza e a redação relaciona');
  ok(/"alcance"/.test(prompts['pesquisa-contexto']) && /QUEM, PELO NOME/.test(prompts['pesquisa-contexto']) && /"alcancados"/.test(red2) && /Nunca escreva que o texto "alcança também" alguém sem dizer quem/.test(red2), 'quem é alcançado: a pesquisa procura os nomes com o dado público e a abertura os lista');
  ok(/TEXTO CORRIDO, UM PARÁGRAFO POR ATOR que tenha argumento próprio/.test(red1) && /Só divide parágrafo quem apenas REPETE o argumento de outro/.test(red1) && /não use tabela, lista nem tópicos/.test(red1) && /NÃO teve manifestação localizada/.test(red1) && /dois parágrafos por lado/.test(red1) && /Avalia-se o ARGUMENTO, não a proposição/.test(red1), 'debate no formato do parecer original: prosa por entidade e "os dois lados" com o que a evidência diz, sem recomendar voto');
  ok(/NUNCA escreva que o dispositivo "é inconstitucional"/.test(red2) && /É exame de RISCO, não de mérito/.test(red2) && /não diga como a bancada deve votar/.test(red2) && /cite e inclua em "projetos" SÓ os que tratam do mesmo assunto/.test(red2), 'redação: judicialização como risco e coerência do partido sem orientar voto');
  ok(/"historico": \[ \{ "proposicao"/.test(red1) && /"termos_de_busca"/.test(prompts.leitura), 'redação 1 monta o histórico; a leitura devolve os termos de busca que o programa usa na Câmara');
  ok(/de 900 a 1\.600 caracteres/.test(red2) && /NOME COMPLETO/.test(red2) && /ENUMERADA por inteiro/.test(red2) && /o que ele mudou/.test(red2), 'abertura detalhada: nome completo do órgão, critérios enumerados, o que o substitutivo mudou');
  ok(/QUEM SUSTENTA|quem sustenta/.test(red1) && /EVIDÊNCIA|evidencia/.test(red1) && /NENHUM ator levantou/.test(red1), 'redação do debate: quem sustenta, que evidência, e os argumentos que ninguém levantou');
  ok(/DESISTIRAM, adiaram ou revogaram/.test(prompts['pesquisa-internacional']) && /O QUE ACONTECEU/.test(prompts['pesquisa-internacional']) && /moeda original/.test(prompts['pesquisa-internacional']), 'pesquisa internacional: o que aconteceu, críticas e países que recuaram');
  ok(/Procure os DOIS lados/.test(prompts['pesquisa-debate']) && /que interesse representa/.test(prompts['pesquisa-debate']) && /registre a divergência em "avisos"/.test(prompts['pesquisa-debate']), 'pesquisa do debate: dois lados, interesse representado, divergência entre fonte e texto');
  ok(/ONDE A ANALOGIA PARA/.test(prompts['pesquisa-contexto']) && /Não atribua à decisão conclusão que ela não tomou/.test(prompts['pesquisa-contexto']), 'pesquisa de contexto: o limite de cada decisão');
  const faseVotada = PR.pe5PromptRedacao2({ identificacao: 'PDL 557/2026', hoje: '17/11/2026', coleta: { fase: { descricao: 'A Câmara já concluiu a votação.', jaVotadaNaCamara: true } }, leitura: {}, pesquisa: {}, alteracoes: [] });
  ok(/a Câmara JÁ VOTOU/.test(faseVotada), 'redação: a fase vem do programa e, se a Câmara já votou, o modelo é avisado');
  const pagina = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8'), tela = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8'), ia = fs.readFileSync(path.join(RAIZ, 'ia-comum.js'), 'utf8');
  const ordem = ['especialistas.js', 'dossie.js', 'pe5-coleta.js', 'pe5-prompts.js', 'pe5-conferencia.js', 'pe5-pipeline.js', 'pe5-html.js', 'analise.js'].map(s => pagina.indexOf(`<script src="${s}">`));
  ok(ordem.every(i => i > 0) && ordem.every((x, i) => i === 0 || x > ordem[i - 1]), 'analise.html carrega os cinco arquivos novos, antes do analise.js');
  ok(/const p = await gerarParecerPE5\(ctx, io\);/.test(tela) && /opcoes: \{ maxSaida: 32000, pensar: pensar \|\| 'medio', stream: true, \.\.\.\(buscas \? \{ maxBuscas: buscas \} : \{\}\), \.\.\.\(ler \? \{ lerPaginas: true \} : \{\}\) \}/.test(tela), 'o botão gera pelo pipeline novo, com o nível de raciocínio de cada etapa');
  ok(/const novoFormato = p\.versao === 5;/.test(tela) && /htmlConferenciaPE5\(p, opts\) : htmlParecerPE5\(p, opts\)/.test(tela) && /htmlConferencia\(p, opts\) : htmlParecer\(p, opts\)/.test(tela), 'parecer novo abre no formato novo; os já salvos continuam abrindo pelo código antigo');
  ok(/a partir de 30 minutos; pode passar de uma hora/.test(tela) && /consumo real desta geração fica registrado/.test(tela) && !/250 a 350 mil tokens' \}/.test(tela), 'o aviso do diálogo não promete mais "7 a 12 minutos" nem "250 a 350 mil tokens"');
  ok(/const nivelPensar = \['alto', 'medio', 'baixo'\]/.test(ia) && /usage: usoGemini\(uso\)/.test(ia) && /usage: usoOpenAI\(json\.usage\)/.test(ia) && /usoAnthropic\(uso\) : null/.test(ia), 'a chamada de IA aceita níveis de raciocínio e devolve o consumo real, nos três provedores');
  // a página inteira avalia num escopo só, sem colisão de nomes com os módulos antigos
  const vm = require('vm');
  const scripts = [...pagina.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => /^(especialistas|dossie|ficha-objeto|tese|gates|parecer|pipeline-parecer|parecer-html|pe5-[a-z]+)\.js$/.test(s));
  let erroEscopo = null;
  try { vm.runInNewContext(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n') + '\n;globalThis.__ok = typeof gerarParecerPE5 === "function" && typeof htmlParecerPE5 === "function" && typeof gerarParecer === "function" && typeof htmlParecer === "function";', { console }); } catch (e) { erroEscopo = e; }
  ok(!erroEscopo, erroEscopo ? `colisão no escopo da página: ${erroEscopo.message}` : `os ${scripts.length} arquivos do parecer (antigos e novos) avaliam no mesmo escopo, sem colisão de nomes`);

  console.log('\n== 7. o que a simulação com modelos de verdade mostrou (PLP 299/2026, 21/11/2026) ==');
  // fase: matéria vinda do Senado, com relator e parecer de Plenário e urgência só requerida
  const trS = [t('2026-11-19', 'MESA', 'Apresentação de Proposição', 'Apresentação do PLP n. 299/2026, pelo Senado Federal.'),
    t('2026-11-19', 'PLEN', 'Designação de Relator(a)', 'Designado Relator, Dep. Mauro Benevides Filho (UNIÃO-CE).'),
    { ...t('2026-11-19', 'MESA', 'Recebimento - Relator(a)', 'Apresentação do PRLP n. 1 PLEN (Parecer Preliminar de Plenário), pelo Deputado Mauro Benevides Filho (UNIÃO/CE).'), sequencia: 3 },
    { ...t('2026-11-19', 'MESA', 'Apresentação de Requerimento', 'Apresentação do REQ n. 4504/2026 (Requerimento de Urgência (Art. 155 do RICD)), pelos Deputado Paulo Pimenta e outros.'), sequencia: 4 }];
  const stS = { dataHora: '2026-11-19T18:47', siglaOrgao: 'MESA', regime: '.', descricaoSituacao: 'Aguardando Despacho do Presidente da Câmara dos Deputados (Chancela)' };
  const fRev = C.pe5Fase(stS, trS, { origemSenado: true });
  ok(fRev.codigo === 'camara_plenario' && fRev.casaRevisora && /veio do Senado/.test(fRev.descricao) && /Casa revisora/.test(fRev.descricao) && /vai à sanção/.test(fRev.descricao) && !/fase de comissões/.test(fRev.descricao), 'fase: matéria vinda do Senado é Casa revisora (não "em fase de comissões")');
  ok(fRev.relatorPlenario.nome === 'Mauro Benevides Filho (UNIÃO-CE)' && fRev.parecerPlenario.data === '19/11/2026' && fRev.urgenciaPendente.data === '19/11/2026' && /ainda não votado/.test(fRev.descricao), 'fase: relator de Plenário, parecer apresentado e requerimento de urgência pendente');
  ok(C.pe5Fase(stS, [trS[0]]).codigo === 'camara_comissoes' && /fase de comissões/.test(C.pe5Fase(stS, [trS[0]]).descricao), 'fase: sem relator de Plenário e sem origem no Senado, continua "em fase de comissões"');
  const uS = C.pe5Urgencia(stS, trS);
  ok(C.pe5Regime('.') === '' && C.pe5Regime(' - ') === '' && C.pe5Regime('Urgência (Art. 155, RICD)') === 'Urgência (Art. 155, RICD)' && !uS.tem && uS.pedidaEm === '19/11/2026' && uS.regime === 'regime ainda não definido', 'regime: o "." da Câmara vira vazio; urgência só requerida sai como pedida, não como aprovada');
  // Senado: relator, deliberação e placar contado nos votos
  const voto = (n, v) => Array.from({ length: n }, () => ({ siglaVotoParlamentar: v }));
  const senFetch = async url => {
    const u = String(url), j = o => ({ ok: true, status: 200, json: async () => o });
    if (/\/processo\?sigla=PLP&numero=299&ano=2026/.test(u)) return j([{ id: 9127383, codigoMateria: 176328, identificacao: 'PLP 299/2026', ementa: 'Altera a Lei Complementar nº 200, de 2023, para conferir ao Poder Executivo federal novos instrumentos de gestão.', autoria: 'Senador Jaques Wagner (PT/BA)', situacaoAtual: 'REMETIDA À CÂMARA DOS DEPUTADOS', dataSituacaoAtual: '2026-11-19' }]);
    if (/\/processo\/relatoria\?idProcesso=9127383/.test(u)) return j([{ formaTratamentoParlamentar: 'Senador', nomeParlamentar: 'Eduardo Braga', siglaPartidoParlamentar: 'MDB', ufParlamentar: 'AM', nomeColegiado: 'Plenário do Senado Federal', dataDesignacao: '2026-11-11 18:48:00' }]);
    if (/\/votacao\?idProcesso=9127383/.test(u)) return j([
      { dataSessao: '2026-11-18', sequencialSessao: 3, descricaoVotacao: 'Votação nominal do Art. 6º-F, destacado.', resultadoVotacao: 'A', votacaoSecreta: 'N', votos: [...voto(49, 'Sim'), ...voto(31, 'Não'), ...voto(1, 'Presidente (art. 51 RISF)')] },
      { dataSessao: '2026-11-12', sequencialSessao: 2, descricaoVotacao: 'Votação nominal da Emenda nº 75 (Substitutivo).', resultadoVotacao: 'A', votacaoSecreta: 'N', votos: [...voto(45, 'Sim'), ...voto(31, 'Não'), ...voto(3, 'MIS')] },
      { dataSessao: '2026-11-18', sequencialSessao: 1, descricaoVotacao: 'Votação nominal da Emenda nº 40, destacada.', resultadoVotacao: 'R', votacaoSecreta: 'N', votos: [...voto(30, 'Sim'), ...voto(47, 'Não'), ...voto(1, 'Abstenção')] }]);
    if (/\/processo\/9127383$/.test(u)) return j({ siglaCasaIniciadora: 'SF', deliberacao: { data: '2026-11-18', tipoDeliberacao: 'Aprovada pelo Plenário', destino: 'À Câmara dos Deputados' }, autuacoes: [{ informesLegislativos: [
      { data: '2026-11-17 10:00:00', descricao: 'Recebida a Emenda nº 79, da Senadora Fulana, para o turno suplementar.' },
      { data: '2026-11-18 20:11:02', colegiado: { sigla: 'PLEN' }, descricao: '(Sessão Deliberativa Ordinária) Emenda nº 40, destacada, rejeitada. Aprovado o substitutivo em turno suplementar.' }] }] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const sen = await C.pe5ColetarSenado({ sigla: 'PLP', numero: '299', ano: '2026', ementa: 'Altera a Lei Complementar nº 200, de 30 de agosto de 2023, para conferir ao Poder Executivo federal novos instrumentos de gestão' }, senFetch);
  ok(sen && sen.casaIniciadora === 'Senado Federal' && sen.relatores[0].nome === 'Senador Eduardo Braga' && sen.relatores[0].designadoEm === '11/11/2026' && sen.deliberacao.data === '18/11/2026' && /materia\/176328$/.test(sen.url), 'Senado: relator, deliberação e endereço da matéria');
  ok(sen.votacoes.length === 3 && sen.votacoes[0].data === '12/11/2026' && sen.votacoes[0].sim === 45 && sen.votacoes[0].nao === 31 && sen.votacoes[1].resultado === 'rejeitado' && sen.votacoes[1].nao === 47 && sen.votacoes[1].abstencao === 1 && sen.votacoes[2].sim === 49, 'Senado: votações nominais em ordem, com o placar contado nos votos (a API não traz o total)');
  ok(sen.andamentos.length === 1 && /turno suplementar/.test(sen.andamentos[0].texto), 'Senado: o resumo da sessão entra; o recebimento de cada emenda fica de fora');
  ok(await C.pe5ColetarSenado({ sigla: 'PLP', numero: '299', ano: '2026', ementa: 'Institui o Dia Nacional do Ciclista e dispõe sobre campanhas educativas nas escolas' }, senFetch) === null && await C.pe5ColetarSenado({ sigla: 'REQ', numero: '1', ano: '2026' }, senFetch) === null, 'Senado: ementa sem relação com a da Câmara, ou sigla que não tem numeração única, não é usada');
  const Gs = { proposicao: { sigla: 'PLP', numero: 299, ano: 2026, autores: ['Senado Federal - Jaques Wagner'] }, status: { data: '19/11/2026', situacao: 'Aguardando Despacho', orgao: 'MESA' }, fase: fRev, urgencia: uS, votacoes: [], senado: sen, mapa: { quorum: { regra: 'maioria absoluta', base: 'art. 69', minimo: 257 } } };
  const resumoS = PR.pe5ResumoColeta(Gs);
  ok(/NO SENADO FEDERAL/.test(resumoS) && /Placar: 45 sim, 31 não/.test(resumoS) && /Resultado: rejeitado\. Placar: 30 sim, 47 não, 1 abstenção/.test(resumoS) && /Requerimento de urgência apresentado em 19\/11\/2026 e ainda não votado/.test(resumoS) && !/Regime: \.\./.test(resumoS), 'o modelo recebe o histórico do Senado, com cada placar, e a urgência pendente');
  const hS = H.htmlParecerPE5({ ...clone(p), coleta: Gs }, { materia: 'PLP 299/2026', css: '' });
  ok(/<b>No Senado\.<\/b> Aprovada pelo Plenário em 18\/11\/2026/.test(hS) && /Votação nominal no Senado/.test(hS) && /<b>45 a 31<\/b>/.test(hS) && /<b>30 a 47<\/b>/.test(hS) && /Votações na Câmara\./.test(hS) && /ainda não votado/.test(hS) && /No Senado, a votação nominal mais recente foi em 18\/11\/2026 \(49 a 31\)/.test(hS), 'PDF: quadro político com a deliberação e os placares do Senado, e a urgência pendente');
  const abrev = C.pe5ArtigosAlterados([{ id: 'A1', dispositivo: 'art. 14, caput, inciso III e §§ 1º a 3º, da LC nº 235/2026' }, { id: 'A2', dispositivo: 'art. 4º da LCP 224/2025' }, { id: 'A3', dispositivo: 'art. 8º-C da Lei nº 9.796/1999' }]);
  ok(abrev.length === 3 && abrev[0].tipo === 'lcp' && abrev[0].numero === '235' && abrev[0].ano === '2026' && abrev[0].artigos[0] === '14' && abrev[0].rotuloNorma === 'Lei Complementar nº 235/2026' && abrev[1].tipo === 'lcp' && abrev[2].tipo === 'lei' && abrev[2].artigos[0] === '8-C', 'lei vigente: "LC nº 235/2026" e "LCP 224/2025" são lidas como lei complementar');
  // leitura em duas chamadas
  const pt = PR.pe5PromptLeitura({ identificacao: 'X', documentos: [{ rotulo: 'D1', texto: 'abc' }], lentes: [{ ordem: '3', rotulo: 'Orçamentário', chave: 'orcamento' }], catalogo: [{ chave: 'orcamento', perguntas: ['Há estimativa?'], armadilhas: [] }], parte: 'texto' });
  const pa = PR.pe5PromptLeitura({ identificacao: 'X', documentos: [{ rotulo: 'D1', texto: 'abc' }], lentes: [{ ordem: '3', rotulo: 'Orçamentário', chave: 'orcamento' }], catalogo: [{ chave: 'orcamento', perguntas: ['Há estimativa?'], armadilhas: [] }], parte: 'apoio' });
  ok(/"blocos"/.test(pt) && /"versoes"/.test(pt) && !/"estimativas"/.test(pt) && !/"emendas"/.test(pt) && /de 6 a 16 blocos/.test(pt) && /o que fica fora da lei/.test(pt) && /o valor é corrigido \(por qual índice\)/.test(pt) && /vale para o valor ADIADO/.test(pt) && /um por um, responda às quatro perguntas/.test(pt) && /Há estimativa\?/.test(pt), 'leitura do texto: blocos, versões e achados, com as perguntas sobre delegação, limite e correção');
  ok(/"estimativas"/.test(pa) && /"refeita"/.test(pa) && /"depende_de"/.test(pa) && /"responde_a"/.test(pa) && !/"blocos"/.test(pa) && /T101/.test(pa) && /parecer MAIS RECENTE não responde/.test(pa) && !/Há estimativa\?/.test(pa) && /LENTE "3" — Orçamentário/.test(pa), 'leitura dos documentos de apoio: argumentos por documento, estimativa por versão, o que o parecer mais recente não responde');
  const jl = PL.pe5JuntarLeituras({ resumo: 'r', blocos: [{ id: 'B1' }], achados: [{ id: 'T1' }], controversias: [], ausencias: [{ id: 'X1' }], justificativa: [{ id: 'J9' }] }, { justificativa: [{ id: 'J1' }], estimativas: [{ id: 'S1' }], achados: [{ id: 'T1' }, { id: 'T102' }], ausencias: [{ id: 'X101' }] });
  ok(jl.resumo === 'r' && jl.blocos.length === 1 && jl.justificativa[0].id === 'J1' && jl.estimativas.length === 1 && jl.achados.map(x => x.id).join() === 'T1,T101,T102' && jl.ausencias.map(x => x.id).join() === 'X1,X101', 'as duas leituras se juntam; identificador repetido é refeito');
  ok(/raciocínio do modelo consumiu a maior parte/.test(PL.pe5MotivoTruncada({ text: 'x'.repeat(16000), usage: { saida: 48000 } })) && /não coube no limite/.test(PL.pe5MotivoTruncada({ text: 'x'.repeat(150000), usage: { saida: 48000 } })), 'resposta cortada: a mensagem diz se foi o raciocínio que consumiu o limite');
  const sApoio = await gerarReferencia({ respostas: { 'leitura-apoio': 'isto não é JSON' } });
  ok(!sApoio.p.erro && item(sApoio.p.conferencia, /Leitura dos documentos de apoio/) && !item(sApoio.p.conferencia, /Leitura dos documentos de apoio/).ok, 'leitura de apoio que falha não derruba a nota: ela sai com o aviso');
  // debate em duas buscas
  const jd = PL.pe5JuntarDebates({ atores: [{ id: 'Q1', ator: 'Ministério da Fazenda (ministro Fulano)', argumentos: [{ tese: 'a' }] }, { id: 'Q2', ator: 'Senador Eduardo Braga' }], controversias: [{ id: 'D1', questao: 'O Executivo pode restringir a compensação de tributos por ato próprio?', favor: ['Q1'], contra: [] }] },
    { atores: [{ id: 'Q1', ator: 'Confederação Nacional da Indústria' }, { id: 'Q2', ator: 'Ministério da Fazenda', argumentos: [{ tese: 'b' }] }], controversias: [{ id: 'D1', questao: 'Pode o Executivo restringir por ato próprio a compensação de tributos?', favor: ['Q2'], contra: ['Q1'] }], avisos: ['x'] });
  ok(jd.atores.length === 3 && jd.atores[0].argumentos.length === 2 && jd.atores[2].id === 'Q3' && jd.controversias.length === 1 && jd.controversias[0].favor.join() === 'Q1' && jd.controversias[0].contra.join() === 'Q3' && jd.avisos.length === 1, 'as duas buscas do debate se juntam: ator repetido uma vez, com os argumentos das duas; controvérsia igual vira uma só');
  ok(/FOCO DESTA BUSCA: GOVERNO E CONGRESSO/.test(prompts['pesquisa-debate']) && /FOCO DESTA BUSCA: SETORES ECONÔMICOS/.test(prompts['pesquisa-debate-economia']) && /FOCO DESTA BUSCA: ESTADOS, MUNICÍPIOS E ÓRGÃOS PÚBLICOS/.test(prompts['pesquisa-debate-federacao']) && /FOCO DESTA BUSCA: SOCIEDADE CIVIL/.test(prompts['pesquisa-debate-sociedade']) && /O MAIOR NÚMERO POSSÍVEL de atores/.test(prompts['pesquisa-debate-economia']) && /Uma busca só não basta/.test(prompts['pesquisa-contexto']) && /PONTOS SENSÍVEIS DO TEXTO/.test(prompts['pesquisa-congresso']), 'pesquisa: um grupo de atores por busca, com os dois lados, várias consultas e os pontos sensíveis da leitura como roteiro');
  ok(/const nBuscas = Math\.min\(opcoes\.maxBuscas \? IA_MAX_BUSCAS : 20, Math\.max\(1, opcoes\.maxBuscas \|\| 5\)\)/.test(ia) && chamadas.length === 17, 'o limite de buscas por chamada passa a vir de quem chama');
  // redação em quatro chamadas
  const r1m = prompts['redacao-1'], r1d = prompts['redacao-1b'], r1q = prompts['redacao-1c'], r2a = prompts['redacao-2'], r2c = prompts['redacao-2b'];
  ok(/NESTA CHAMADA escreva SÓ A MATÉRIA/.test(r1m) && /\n "materia": \{/.test(r1m) && !/\n "debate": \{/.test(r1m) && /^- "faz"/m.test(r1m) && !/^- "posicoes"/m.test(r1m) && /\n "debate": \{/.test(r1d) && /\n "internacional": \{/.test(r1d) && !/\n "materia": \{/.test(r1d) && !/^- "posicoes"/m.test(r1d) && /NESTA CHAMADA escreva SÓ QUEM SE POSICIONOU E COMO/.test(r1q) && /\n "quem": \{/.test(r1q) && !/\n "debate": \{/.test(r1q) && /^- "posicoes"/m.test(r1q) && /^- "sintese"/m.test(r1q) && /não tem teto total/.test(r1q) && !/^- "faz"/m.test(r1d) && /^- Seção sem conteúdo/m.test(r1d), 'redação da matéria e do debate em chamadas separadas, cada uma com o formato e as orientações dela');
  ok(/\n "analise": \{/.test(r2a) && !/\n "caminhos": \{/.test(r2a) && /^- "lentes"/m.test(r2a) && !/^- "opcoes"/m.test(r2a) && /\n "caminhos": \{/.test(r2c) && /\n "abertura": \{/.test(r2c) && !/\n "analise": \{/.test(r2c) && /ANÁLISE TÉCNICA, JÁ ESCRITA/.test(r2c) && /^- "pontos"/m.test(r2c) && /PRIMEIRA METADE, JÁ ESCRITA/.test(r2a), 'a análise lê a primeira metade; os caminhos e a abertura leem também a análise');
  // cobertura e revisão
  ok(/COBERTURA OBRIGATÓRIA/.test(prompts['redacao-1']) && /COBERTURA OBRIGATÓRIA/.test(prompts['redacao-2']) && !/COBERTURA OBRIGATÓRIA/.test(prompts['redacao-1b']) && /Sigla só depois do nome por extenso/.test(PR.PE5_ESTILO) && /NO SENADO/.test(prompts['redacao-1']), 'redação: lista do que não pode ficar de fora, sigla com o nome por extenso, parágrafo do Senado');
  const semV = conf(q => { for (const b of q.doc.materia.versoes) b.ev = b.ev.filter(e => e !== 'V6'); });
  ok(!item(semV, /O que a leitura apontou de relevante/).ok && /V6/.test(item(semV, /O que a leitura apontou de relevante/).detalhe), 'conferência: item da leitura que a nota não usou é apontado pelo identificador');
  const docR = { a: [{ texto: 'O teto vale até 2030. Depois volta ao normal.', ev: ['B1'] }, { texto: 'A regra muda o prazo de 120 para 60 dias e fixa limite.', ev: [] }] };
  const rr = PL.pe5AplicarRevisao(docR, [], [{ depois_de: 'O teto vale até 2030.', texto: 'O valor adiado não é corrigido.', ev: ['T9', 'invalido'] }, { depois_de: 'muda o prazo de 120 para 60 dias', texto: 'Não há consequência prevista.', ev: ['X1'] }, { depois_de: 'trecho que não existe no texto', texto: 'Frase qualquer aqui.' }]);
  ok(docR.a[0].texto === 'O teto vale até 2030. O valor adiado não é corrigido. Depois volta ao normal.' && docR.a[0].ev.join() === 'B1,T9' && docR.a[1].texto === 'A regra muda o prazo de 120 para 60 dias e fixa limite. Não há consequência prevista.' && rr.aplicadas.length === 2 && rr.ignoradas.length === 1, 'revisão: acréscimo entra depois da frase, soma a referência ao bloco e é ignorado se o trecho de apoio não existe');
  const comAp = await gerarReferencia({ respostas: { 'redacao-2': JSON.stringify((() => { const d = JSON.parse(fs.readFileSync(path.join(FX, 'resposta-redacao-2.json'), 'utf8')); const alvo = (function achar(o) { if (Array.isArray(o)) { for (const x of o) { const r = achar(x); if (r) return r; } } else if (o && typeof o === 'object') { if (typeof o.texto === 'string' && Array.isArray(o.ev)) return o; for (const k of Object.keys(o)) { const r = achar(o[k]); if (r) return r; } } return null; })(d.analise); alvo.texto += ' O custo chega a R$ 987,6 milhões.'; return d; })()) } });
  ok(/O PROGRAMA JÁ CONFERIU O TEXTO E APONTOU/.test(comAp.prompts.revisao) && /- Valores, percentuais, prazos e datas[^\n]*987,6/.test(comAp.prompts.revisao) && !/- Peso das fontes oficiais/.test(comAp.prompts.revisao) && /"acrescimos"/.test(comAp.prompts.revisao) && !/O PROGRAMA JÁ CONFERIU/.test(prompts.revisao), 'o revisor recebe o que a conferência do programa apontou e ele pode consertar (número sem base), não o que só informa');

  console.log('\n== 8. pesquisa em profundidade: pistas, mínimos e insistência (25/11/2026) ==');
  {
    const M = PR.PE5_MIN_PESQUISA;
    ok(M.paises === 6 && M.decisoes === 6 && M.atores === 20 && M.porLado === 5 && M.rodadas === 3, 'mínimos: seis países, seis decisões, vinte atores com cinco de cada lado; até três rodadas');
    ok(PR.pe5LadoAtor('Favorável com ressalvas') === 'favor' && PR.pe5LadoAtor('contrário com ressalvas') === 'contra' && PR.pe5LadoAtor('neutro') === 'neutro' && PR.pe5LadoAtor('') === 'neutro', '"com ressalvas" conta do lado a que pertence; o resto é neutro');
    const at = (n, pos) => Array.from({ length: n }, (_, i) => ({ ator: `${pos} ${i}`, posicao: pos }));
    const f0 = PR.pe5FaltasPesquisa({ paises: 2, decisoes: 0, atores: [...at(12, 'favorável'), ...at(3, 'contrário')], semContraste: true, faltaOrigens: ['Lei X'] });
    ok(f0.paises === 4 && f0.decisoes === 6 && f0.atores === 5 && f0.favor === 0 && f0.contra === 2 && f0.contraste && f0.origens.join() === 'Lei X' && f0.alguma, 'o que falta: quatro países, seis decisões, cinco atores e dois contrários (o caso da nota do Sonnet)');
    const f1 = PR.pe5FaltasPesquisa({ paises: 6, decisoes: 7, atores: [...at(11, 'favorável com ressalvas'), ...at(9, 'contrário')] });
    ok(!f1.alguma && !PR.pe5FaltasPesquisa({ paises: 6, decisoes: 6, atores: [...at(16, 'favorável'), ...at(4, 'contrário')] }).atores && PR.pe5FaltasPesquisa({ paises: 6, decisoes: 6, atores: [...at(16, 'favorável'), ...at(4, 'contrário')] }).contra === 1, 'mínimos cumpridos: nada a completar; vinte atores com quatro contrários ainda pedem um');

    // as pistas: escritas sem busca, entram como roteiro em cada pesquisa e nunca como fato
    const pp = prompts['pesquisa-pistas'];
    ok(/lista de ONDE PROCURAR/.test(pp) && /Nada do que você escrever aqui entra na nota técnica sem ser confirmado/.test(pp) && /"paises": de 8 a 12/.test(pp) && /MODELO OPOSTO/.test(pp) && /"atores": de 8 a 12 por grupo, dos DOIS lados/.test(pp) && !/REGRAS DA PESQUISA/.test(pp), 'pistas: o modelo lista países, decisões e atores a conferir, dos dois lados, sem buscar');
    const bloco = t => (t.match(/\nPISTAS \(onde procurar[\s\S]*?\nO QUE (?:PROCURAR|FALTA)/) || [''])[0];
    ok(/Digital Markets Act/.test(bloco(prompts['pesquisa-internacional'])) && /Estados Unidos: American Innovation and Choice Online Act \[modelo oposto\]/.test(bloco(prompts['pesquisa-internacional'])) && !/Brasscom|ADI sobre poder normativo/.test(bloco(prompts['pesquisa-internacional'])), 'internacional recebe só as pistas de países, com o modelo oposto marcado');
    ok(/STF ADI sobre poder normativo de agência — delegação ao Cade \(incerto\)/.test(bloco(prompts['pesquisa-contexto'])) && !/Digital Markets Act|Brasscom/.test(bloco(prompts['pesquisa-contexto'])), 'contexto recebe só as pistas de decisões, com a incerteza dita');
    ok(/Quem procurar — Governo e Congresso:\n- Ministério da Fazenda \(favorável\)/.test(bloco(prompts['pesquisa-debate'])) && !/Brasscom|Idec/.test(bloco(prompts['pesquisa-debate'])) && /Brasscom \(contrário\)/.test(bloco(prompts['pesquisa-debate-economia'])) && /Idec/.test(bloco(prompts['pesquisa-debate-sociedade'])) && !/Quem procurar/.test(prompts['pesquisa-debate-federacao']), 'cada busca do debate recebe os atores do grupo dela; grupo sem pista fica sem a lista');
    ok(/Termos de busca: mercados digitais; DMA brasileiro\./.test(bloco(prompts['pesquisa-debate-economia'])) && /Digital Markets Act/.test(bloco(prompts['pesquisa-complementar'])) && /Brasscom/.test(bloco(prompts['pesquisa-complementar'])), 'os termos de busca vão com as pistas; a complementar recebe todas');
    ok(/ABRA E LEIA as páginas/.test(prompts['pesquisa-contexto']) && /Pista não é fato/.test(prompts['pesquisa-debate']) && /Pista que a busca não confirmou vai em "avisos"/.test(prompts['pesquisa-internacional']), 'regra das pesquisas: abrir e ler a página; pista só entra se a página confirmar');
    ok(PR.pe5PistasVazias(PR.pe5PistasLimpar(null)) && PR.pe5PistasTexto(PR.pe5PistasLimpar({ paises: [{ norma: 'sem lugar' }], atores: 'x' }), 'tudo') === '' && !/\nPISTAS \(/.test(PR.pe5PromptInternacional({ identificacao: 'PL 1/2026', leitura: {}, hoje: '25/11/2026' })), 'pistas vazias ou malformadas: nenhum bloco no pedido');
    const semPistas = await gerarReferencia({ respostas: { 'pesquisa-pistas': 'isto não é JSON' } });
    ok(!semPistas.p.erro && !/\nPISTAS \(/.test(semPistas.prompts['pesquisa-internacional']) && semPistas.p.pesquisa.internacional.jurisdicoes.length === 6, 'se as pistas falham, a pesquisa segue sem elas');

    // insistência: até três rodadas, cada uma pedindo só o que ainda falta
    const novoAtor = (nome, pos, grupo) => ({ id: 'Q1', grupo, ator: nome, quem_e: 'entidade', posicao: pos, data: '01/11/2026', argumentos: [{ tese: `tese de ${nome}` }], fonte_nome: 'Site', fonte_url: `https://exemplo.org/${encodeURIComponent(nome)}`, fonte_tipo: 'primária' });
    const etapas = [];
    const rod = await gerarReferencia({ onChamada: c => etapas.push(c.etapa), respostas: {
      'pesquisa-complementar': JSON.stringify({
        jurisdicoes: [{ lugar: 'Estados Unidos', norma: 'American Innovation and Choice Online Act', contraste: true, como_funciona: 'projeto arquivado', fonte_nome: 'Congress.gov', fonte_url: 'https://www.congress.gov/bill/x' },
          { lugar: 'União Europeia', norma: 'Regulamento (UE) 2022/1925 — Lei dos Mercados Digitais (DMA)', fonte_nome: 'EUR-Lex', fonte_url: 'https://eur-lex.europa.eu/x' }],
        jurisprudencia: [{ tribunal: 'STF, Plenário', processo: 'ADI 4.874', decidiu: 'repetida', fonte_nome: 'STF', fonte_url: 'https://portal.stf.jus.br/x' }, { tribunal: 'STF, Plenário', processo: 'ADI 5.501', decidiu: 'd', limite: 'l', pertinencia: 'p', data: '01/01/2020', fonte_nome: 'STF', fonte_url: 'https://portal.stf.jus.br/y' }],
        atores: [novoAtor('Brasscom', 'contrário', 'Setores econômicos e trabalhadores'), novoAtor('Apple', 'contrário', 'Setores econômicos e trabalhadores'), novoAtor('Idec', 'favorável com ressalvas', 'grupo que não existe'), { ator: 'Sem fonte', posicao: 'favorável' }], avisos: [] }),
      'pesquisa-complementar-2': JSON.stringify({ jurisdicoes: [], jurisprudencia: [], atores: [novoAtor('Proteste', 'favorável', 'Sociedade civil e análise')], avisos: ['STJ: procurado e não localizado'] }),
    } });
    const pq = rod.p.pesquisa;
    ok(etapas.filter(e => /^pesquisa-complementar/.test(e)).join() === 'pesquisa-complementar,pesquisa-complementar-2,pesquisa-complementar-3', 'faltando o mínimo, a pesquisa complementar roda de novo — até três vezes, e para aí');
    ok(pq.internacional.jurisdicoes.length === 7 && pq.internacional.jurisdicoes[6].id === 'W7' && pq.internacional.jurisdicoes[6].lugar === 'Estados Unidos' && pq.contexto.jurisprudencia.length === 4 && pq.contexto.jurisprudencia[3].processo === 'ADI 5.501', 'país e decisão que já estavam na pesquisa não entram de novo; os novos seguem a numeração');
    const nomes = pq.debate.atores.map(a => a.ator);
    ok(pq.debate.atores.length === 18 && nomes.filter(n => /Apple/.test(n)).length === 1 && nomes.includes('Brasscom') && nomes.includes('Proteste') && !nomes.includes('Sem fonte') && pq.debate.atores.every((a, i) => a.id === `Q${i + 1}`), 'atores novos entram uma vez só, com fonte e numeração seguida; o que já estava (Apple) e o sem fonte ficam de fora');
    ok(pq.debate.atores.find(a => a.ator === 'Brasscom').grupo === 'Setores econômicos e trabalhadores' && pq.debate.atores.find(a => a.ator === 'Idec').grupo === 'Outros' && pq.debate.atores.find(a => a.ator === 'Proteste').grupo === 'Sociedade civil e análise', 'o ator novo leva o grupo informado; grupo desconhecido vira "Outros"');
    const c1 = rod.prompts['pesquisa-complementar'], c2 = rod.prompts['pesquisa-complementar-2'], c3 = rod.prompts['pesquisa-complementar-3'];
    ok(/mais 5 ator\(es\) com manifestação localizada/.test(c1) && !/ao menos \d+ CONTRÁRIO/.test(c1) && /mais 3 decisão/.test(c1) && !/"jurisdicoes": mais \d+ país/.test(c1) && /Já registrados \(NÃO repita\): Relator, dep\. Aliel Machado/.test(c1) && /"grupo", um destes: "Governo e Congresso", "Setores econômicos e trabalhadores"/.test(c1), '1ª rodada: pede os cinco atores e as três decisões que faltam, diz quem já está e os grupos; países (seis) não são pedidos');
    ok(/Esta é a 2ª tentativa/.test(c2) && /Mude os termos de busca/.test(c2) && /mais 3 ator\(es\)/.test(c2) && /mais 2 decisão/.test(c2) && /Brasscom; Idec/.test(c2) && !/MODELO OPOSTO/.test(c2) && /Esta é a 3ª tentativa/.test(c3) && /mais 2 ator\(es\)/.test(c3) && /Proteste/.test(c3), '2ª e 3ª rodadas: só o que ainda falta, com o que as anteriores acharam; o país oposto, já achado, não é pedido de novo');
    ok(/nem mude a posição de ninguém para fechar a conta/.test(c1) && /Só entra a decisão cuja página você abriu e leu/.test(c1), 'a complementar não pede para fechar a conta à força: sem manifestação localizada, vai para os avisos');
    ok(!item(rod.p.conferencia, /ao menos vinte atores/).ok && /18 ator\(es\) na pesquisa; o mínimo é vinte/.test(item(rod.p.conferencia, /ao menos vinte atores/).detalhe) && item(rod.p.conferencia, /modelo oposto/) && pq.internacional.avisos.includes('STJ: procurado e não localizado'), 'depois de três rodadas, o que ainda falta sai como aviso na conferência da nota');
    const poucos = K.pe5Conferir({ doc: {}, leitura: {}, coleta: {}, pesquisa: { debate: { atores: [...at(18, 'favorável'), ...at(2, 'contrário com ressalvas')] }, internacional: { jurisdicoes: [] }, contexto: { jurisprudencia: [] } } }, { hoje: new Date('2026-11-25T15:00:00Z') });
    ok(item(poucos, /ao menos vinte atores/).ok && !item(poucos, /cinco atores de cada lado/).ok && /18 favorável\(is\) e 2 contrário\(s\).*o lado contrário está abaixo dele/.test(item(poucos, /cinco atores de cada lado/).detalhe), 'vinte atores com dois contrários: o aviso diz que lado está abaixo do mínimo');
    // o relatório de conferência diz quanto o modelo buscou e leu
    const hw = H.pe5ResumoLeituraWeb([{ web: true, buscas: 12, paginas: 7 }, { web: true, buscas: 3, paginas: 1 }, { web: false, buscas: 9 }]);
    ok(/15 buscas e 8 páginas abertas nas pesquisas/.test(hw) && H.pe5ResumoLeituraWeb([{ web: true }]) === '' && /o provedor recusou a leitura de páginas/.test(H.pe5ResumoLeituraWeb([{ web: true, buscas: 1, paginas: 0, avisos: ['O provedor recusou a leitura de páginas (x); a pesquisa foi feita só com a busca.'] }])), 'a conferência informa buscas e páginas abertas pelo modelo, e se a leitura de páginas foi recusada');
  }

  console.log('\n== 9. varredura de 26/11/2026: atores com a mesma sigla, rodada que falha, numeração ==');
  {
    const J = (...listas) => PL.pe5JuntarDebates(...listas.map(l => ({ atores: l.map(([ator, posicao], i) => ({ id: `Q${i + 1}`, ator, posicao })) })));
    const nomes = r => r.atores.map(a => `${a.ator} [${a.posicao}]`).join(' | ');
    // (A2) a sigla do partido ou da UF ao lado de um nome não diz QUEM é
    const dois = J([['Deputado João Silva (PT)', 'favorável']], [['Deputada Maria Souza (PT)', 'contrário']]);
    ok(nomes(dois) === 'Deputado João Silva (PT) [favorável] | Deputada Maria Souza (PT) [contrário]' && !dois.avisos.length, 'dois deputados do mesmo partido são DOIS atores, cada um com a sua posição (antes: um só, "Maria Souza, favorável")');
    ok(J([['João Silva (PT)', 'favorável']], [['Maria Souza (PT)', 'contrário'], ['PT', 'contrário']]).atores.length === 3, 'sem o cargo no nome também: a sigla do partido não funde as pessoas nem as junta ao próprio partido');
    ok(J([['Governo de Minas Gerais (MG)', 'favorável']], [['Assembleia Legislativa (MG)', 'contrário']]).atores.length === 2 && J([['Governador Fulano (SP)', 'favorável']], [['Prefeita Beltrana (SP)', 'contrário']]).atores.length === 2, 'a UF entre parênteses também não: dois órgãos do mesmo estado são dois atores');
    ok(J([['Confederação Nacional da Indústria (CNI), presidente Ricardo Alban', 'contrário']], [['CNI', 'contrário'], ['Confederação Nacional da Indústria (CNI)', 'contrário']]).atores.length === 1 && J([['Instituto de Defesa de Consumidores (Idec)', 'favorável']], [['Idec', 'favorável']]).atores.length === 1,
      'a sigla da ENTIDADE continua juntando: "Confederação Nacional da Indústria (CNI)", "CNI" e a mesma com o presidente são um ator só');
    ok(J([['Senador Eduardo Braga (MDB-AM), relator no Senado', 'favorável']], [['Eduardo Braga', 'favorável']]).atores.length === 1 && J([['Senador Rogerio Marinho', 'contrário']], [['Rogerio Marinho', 'contrário']]).atores.length === 1, 'a mesma pessoa com e sem cargo, partido e aposto continua sendo uma');
    ok(J([['Partido dos Trabalhadores (PT)', 'favorável']], [['PT', 'favorável'], ['Bancada do PT (PT)', 'favorável']]).atores.length === 1, 'quando o ator É o partido, a sigla vale: "Partido dos Trabalhadores (PT)", "PT" e "Bancada do PT (PT)" são um só');
    // (M8) número novo depois do MAIOR já usado
    const som = PL.pe5SomarPesquisa([{ id: 'W1', l: 'a' }, { id: 'W2', l: 'b' }, { id: 'W4', l: 'd' }, { id: 'W5', l: 'e' }], [{ l: 'f' }, { l: 'a' }, { l: 'g' }], 'W', x => x.l);
    ok(som.map(x => x.id).join() === 'W1,W2,W4,W5,W6,W7' && new Set(som.map(x => x.id)).size === som.length, 'lista com um número faltando (item sem fonte descartado): os novos seguem o maior número, sem repetir "W5"; o repetido não entra');
    ok(PL.pe5SomarPesquisa(undefined, [{ l: 'c' }], 'H', x => x.l)[0].id === 'H1' && PL.pe5SomarPesquisa([{ l: 'a' }, { l: 'b' }], [{ l: 'c' }], 'R', x => x.l)[2].id === 'R3', 'lista vazia começa em 1; lista sem números segue a contagem');
    // (M7) rodada complementar que FALHA não é "procurou e não achou"
    const etapas = [];
    const falha = await gerarReferencia({ onChamada: c => etapas.push(c.etapa), respostas: { 'pesquisa-complementar': 'isto não é JSON' } });
    ok(!falha.p.erro && etapas.filter(e => /^pesquisa-complementar/.test(e)).join() === 'pesquisa-complementar,pesquisa-complementar-2', 'a 1ª rodada falha (resposta que não se lê): a 2ª roda assim mesmo — e, como procurou e não trouxe nada novo, a 3ª não');
    ok(/Esta é a 2ª tentativa/.test(falha.prompts['pesquisa-complementar-2']) && falha.p.pesquisa.internacional.avisos.some(a => /pesquisa-complementar\) não devolveu resultado utilizável/.test(a)), 'e a falha fica registrada nos avisos da pesquisa');
    const etapas3 = [];
    await gerarReferencia({ onChamada: c => etapas3.push(c.etapa), respostas: { 'pesquisa-complementar': 'x', 'pesquisa-complementar-2': 'y', 'pesquisa-complementar-3': 'z' } });
    ok(etapas3.filter(e => /^pesquisa-complementar/.test(e)).length === 3, 'três rodadas que falham: para na terceira (o teto continua valendo)');
  }

  console.log('\n== 10. varredura de 26/11/2026: os pequenos da NTA ==');
  {
    ok(/TODOS, no mínimo seis quando a pesquisa os trouxer/.test(prompts['redacao-1b']) && !/no mínimo cinco/.test(Object.values(prompts).join('\n')), 'a redação pede os mesmos seis países que a conferência cobra (dizia "no mínimo cinco")');
    // "a busca foi refeita" só quando foi
    const at = n => Array.from({ length: n }, (_, i) => ({ ator: `Ator ${i}`, posicao: i % 2 ? 'favorável' : 'contrário' }));
    const base8 = { doc: {}, leitura: {}, coleta: {}, pesquisa: { debate: { atores: at(12) }, internacional: { jurisdicoes: [] }, contexto: { jurisprudencia: [] } } };
    const semRodada = item(K.pe5Conferir(base8, { hoje: new Date('2026-11-26T15:00:00Z') }), /ao menos vinte atores/).detalhe;
    const comRodada = item(K.pe5Conferir({ ...base8, chamadas: [{ nome: 'leitura' }, { nome: 'pesquisa-complementar' }] }, { hoje: new Date('2026-11-26T15:00:00Z') }), /ao menos vinte atores/).detalhe;
    ok(semRodada === '12 ator(es) na pesquisa; o mínimo é vinte. O mapa do debate pode estar incompleto.' && /A busca foi refeita e não localizou mais manifestações: o mapa do debate pode estar incompleto\.$/.test(comRodada),
      'nota sem rodada complementar (as antigas, ou quando as rodadas falharam) não diz que "a busca foi refeita"; com rodada, diz');
    // "ADI 4.874" e "ADI 4874" são a mesma decisão
    const dec = await gerarReferencia({ respostas: { 'pesquisa-complementar': JSON.stringify({ jurisdicoes: [], atores: [], avisos: [],
      jurisprudencia: [{ tribunal: 'STF', processo: 'ADI 4874', decidiu: 'a mesma, sem o ponto', fonte_nome: 'STF', fonte_url: 'https://portal.stf.jus.br/a' }, { tribunal: 'STF', processo: 'RE 1083955 AgR', decidiu: 'idem', fonte_nome: 'STF', fonte_url: 'https://portal.stf.jus.br/b' },
        { tribunal: 'STF', processo: 'ADI 5.501', decidiu: 'd', limite: 'l', pertinencia: 'p', data: '01/01/2020', fonte_nome: 'STF', fonte_url: 'https://portal.stf.jus.br/c' }] }) } });
    const procs = dec.p.pesquisa.contexto.jurisprudencia.map(j => j.processo);
    ok(procs.length === 4 && procs.filter(x => /4\.?874/.test(x)).length === 1 && procs.filter(x => /1\.?083\.?955/.test(x)).length === 1 && procs.at(-1) === 'ADI 5.501', 'a decisão que volta escrita sem o ponto de milhar ("ADI 4874", "RE 1083955 AgR") é reconhecida como a que já estava; só a nova entra');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
