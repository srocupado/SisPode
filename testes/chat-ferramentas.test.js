// Ferramentas do módulo Chat — rodam contra as fontes REAIS (Firebase do
// SisPode e API de Dados Abertos da Câmara).
//
// O que este teste existe para impedir:
//   a) O ZERO SILENCIOSO. Em 20/08/2026, filtrar autoria por
//      `siglaPartido === 'PODE'` em /proposicoes/{id}/autores devolveu 0
//      projetos do Podemos votados em 30 dias — porque esse campo NÃO EXISTE
//      naquele endpoint. HTTP 200 em tudo, lista vazia, resposta errada e
//      confiante. O caso está travado abaixo.
//   b) Falha virando fato. Fonte fora do ar tem de produzir observação que
//      COMEÇA com "ERRO:" — é isso que faz o prompt mandar a IA declarar a
//      falha em vez de completar o buraco.
//   c) Vazamento de domínio na leitura de página oficial.
//
// Uso: node testes/chat-ferramentas.test.js
//      node testes/chat-ferramentas.test.js --rapido   (pula a rede lenta)

const fs = require('fs');
const path = require('path');

const RAPIDO = process.argv.includes('--rapido');

// chat.js é <script> de página; para o Node, carrega e usa o module.exports
// do rodapé — sem DOM, porque nada de UI roda na importação.
global.document = { addEventListener() {} };
global.chrome = { storage: { local: { get(_, cb) { cb({}); } } } };
const chat = require(path.join(__dirname, '..', 'chat.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== normalização de nome (casa FNS × Câmara × Senado) ==');
  {
    ok(chat.chaveNome('Renata Abreu') === 'RENATA ABREU', 'Title Case → caixa alta');
    ok(chat.chaveNome('FÁBIO MACEDO') === 'FABIO MACEDO', 'acento removido — "FÁBIO" e "FABIO" batem');
    ok(chat.chaveNome('  José   da  Silva ') === 'JOSE DA SILVA', 'espaços colapsados');
    // A consulta ao Transparência é sensível a caixa E acento: "Renata Abreu"
    // devolvia 0 e "RENATA ABREU" devolvia 13. Por isso a chave existe.
    ok(chat.chaveNome('Renata Abreu') === chat.chaveNome('RENATA ABREU'),
       'as duas grafias colapsam na MESMA chave');
  }

  console.log('\n== allow-list de domínio (verificada no host) ==');
  {
    ok(chat.hostPermitido('https://www.camara.leg.br/x') === true, 'camara.leg.br permitido');
    ok(chat.hostPermitido('https://legis.senado.leg.br/y') === true, 'subdomínio do senado permitido');
    ok(chat.hostPermitido('https://www.planalto.gov.br/z') === true, 'planalto permitido');
    ok(chat.hostPermitido('https://camara.leg.br.evil.com/') === false,
       'domínio que só TERMINA parecido é recusado');
    ok(chat.hostPermitido('https://consultafns.saude.gov.br/') === false,
       'fonte de dados do módulo Orçamento não é fonte de leitura livre');
    ok(chat.hostPermitido('não é url') === false, 'lixo não vira permissão');
  }

  console.log('\n== extração do JSON da resposta da IA ==');
  {
    ok(chat.extrairJson('{"acao":"responder","texto":"oi"}').acao === 'responder', 'JSON puro');
    ok(chat.extrairJson('```json\n{"acao":"consultar","ferramenta":"x"}\n```').ferramenta === 'x',
       'cercas de código toleradas');
    ok(chat.extrairJson('Claro!\n{"acao":"responder","texto":"a"}').acao === 'responder',
       'prosa antes do JSON tolerada');
    // Chave dentro de string quebrava o parser ingênuo por contagem de "{".
    ok(chat.extrairJson('{"acao":"responder","texto":"use { assim }"}').texto === 'use { assim }',
       'chave dentro de string não encerra o objeto');
    ok(Object.keys(chat.extrairJson('sem json aqui')).length === 0, 'sem JSON devolve vazio');
  }

  if (RAPIDO) {
    console.log('\n(--rapido: testes de rede pulados)');
    console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
    process.exit(falhas ? 1 : 0);
  }

  console.log('\n== bancada do Podemos (API da Câmara) ==');
  {
    const r = await chat.FERRAMENTAS.bancada_podemos({});
    ok(!r.startsWith('ERRO:'), 'consulta respondeu');
    ok(/BANCADA DO PODEMOS/.test(r), 'cabeçalho presente');
    const n = (r.match(/^• /gm) || []).length;
    ok(n >= 15 && n <= 60, `bancada com tamanho plausível: ${n} deputados`);
    // Licenciados PRECISAM aparecer: usar ?siglaPartido=PODE sem legislatura
    // omite quem está em licença — a presidente do partido sumia da bancada.
    ok(/Licen|Exerc/.test(r), 'situação (Exercício/Licença) declarada por deputado');
  }

  console.log('\n== votações: 75% das votações eram DESCARTADAS ==');
  {
    // A versão anterior filtrava por `v.proposicaoObjeto`, que vem NULO na
    // maioria: em 10–14/08/2026 foram 486 votações e só 120 tinham o campo.
    // As 366 restantes sumiam sem aviso — inclusive as duas do PL 4578/2025
    // (futebol feminino), aprovado no Plenário em 13/08. A pergunta sobre ele
    // recebeu "não houve" com o dado na base. Este é o caso travado.
    const plen = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', orgao: 'PLEN',
    });
    ok(!plen.startsWith('ERRO:'), 'consulta ao Plenário respondeu');
    ok(/JANELA CONSULTADA: 2026-08-10 a 2026-08-14/.test(plen), 'janela declarada');
    ok(/PL 4578\/2025/.test(plen),
       'PL 4578/2025 (futebol feminino) aparece entre as votadas no Plenário');
    const m = /→ (\d+) proposições distintas/.exec(plen);
    ok(m && Number(m[1]) >= 35,
       `proposições no Plenário na semana: ${m ? m[1] : '?'} (eram 29 quando 75% era descartado)`);

    // Busca temática — o modo em que a pergunta foi feita.
    const tema = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', orgao: 'PLEN', termo: 'futebol feminino',
    });
    ok(/PL 4578\/2025/.test(tema), 'filtro por tema encontra a matéria');
    ok(/Redação Final|Substitutivo/.test(tema),
       'a descrição da votação vem junto — é ela que diz se foi aprovado');
    ok(/de \d+ proposições votadas/.test(tema),
       'declara o universo em que procurou, para "não achei" não virar "não existe"');

    // Tema inexistente responde "não há" DIZENDO onde procurou.
    const nada = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', orgao: 'PLEN', termo: 'colonizacao de marte',
    });
    ok(/Nenhuma das \d+ proposições votadas casa/.test(nada),
       'tema sem resultado declara o universo procurado');

    // Autoria continua funcionando (o caso do siglaPartido inexistente).
    // Precisa de detalhar:true — a votação do PL 3659/2026 tem prefixo de um
    // REQUERIMENTO (2639270-5, "Aprovado o Requerimento"), e o PL só aparece
    // como matéria AFETADA. É a diferença entre os dois sentidos de "votado".
    const pode = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-07-21', dataFim: '2026-08-20', orgao: 'CPASF',
      apenasPodemos: true, detalhar: true,
    });
    ok(/PL 3659\/2026/.test(pode) && /Bruno Ganem/.test(pode),
       'autoria da bancada cruzada por id (PL 3659/2026, Bruno Ganem)');
    const semDetalhe = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-07-21', dataFim: '2026-08-20', orgao: 'CPASF', apenasPodemos: true,
    });
    ok(!/PL 3659\/2026/.test(semDetalhe) && /detalhar:true/.test(semDetalhe),
       'sem detalhar, a matéria afetada não aparece — e a observação DIZ que falta detalhar');
  }

  console.log('\n== lista que não cabe é DECLARADA, não decepada ==');
  {
    // `texto.slice(0, OBS_MAX)` decepava no meio: das 40 proposições votadas
    // no Plenário, 30 entravam e 10 sumiam — entre elas o PL 4578/2025, que
    // era o que a pergunta procurava. A IA recebia lista aparentemente
    // completa e respondia "não há".
    const plen = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', orgao: 'PLEN',
    });
    const n = (plen.match(/^• /gm) || []).length;
    const tot = /→ (\d+) proposições distintas/.exec(plen);
    ok(tot && n === Number(tot[1]), `as ${tot ? tot[1] : '?'} do Plenário cabem inteiras (listou ${n})`);
    ok(!/NÃO couberam/.test(plen), 'nada foi cortado nesse recorte');

    // A CCJC tem 104 matérias na semana — com o encolhimento, cabem todas.
    // (Antes do encolhimento este caso cortava 31 delas.)
    const ccjc = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', orgao: 'CCJC',
    });
    const vistos = (ccjc.match(/^• /gm) || []).length;
    const tab = chat.ultimaTabela();
    ok(tab && vistos === tab.linhas.length,
       `as ${tab ? tab.linhas.length : '?'} da CCJC couberam encolhendo o texto de cada uma`);

    // Mas o aviso continua existindo para quando NÃO couber mesmo: o
    // mecanismo é testado direto, sem depender de a Câmara votar muito.
    const gigantes = Array.from({ length: 200 }, (_, i) => `• item ${i} ${'x'.repeat(300)}`);
    const o = chat.montarObservacao(['CABEÇALHO'], gigantes);
    ok(/NÃO couberam/.test(o), 'lista impossível de caber declara quantos ficaram de fora');
    ok(/⚠ \d+ de 200 itens/.test(o), 'o aviso diz o número exato, não "alguns"');
    ok(/NÃO conclua que algo não existe/.test(o),
       'e proíbe explicitamente concluir inexistência a partir da lista cortada');
    ok(o.length <= 12000, `a observação respeita o teto (${o.length} chars)`);
  }

  console.log('\n== recorte largo demais PEDE recorte, não devolve lista cortada ==');
  {
    const r = await chat.FERRAMENTAS.votacoes_periodo({ dataInicio: '2026-08-10', dataFim: '2026-08-14' });
    ok(/RESTRINJA e consulte de novo/.test(r),
       '446 proposições numa semana → pede restrição em vez de truncar');
    ok(/Votações por órgão no período/.test(r),
       'diz por quais órgãos restringir, em vez de só reclamar');
  }

  console.log('\n== /autores NÃO tem siglaPartido (a causa raiz, travada) ==');
  {
    const res = await fetch('https://dadosabertos.camara.leg.br/api/v2/proposicoes/2642391/autores',
      { headers: { Accept: 'application/json' } });
    const d = await res.json();
    const campos = Object.keys(d.dados[0]);
    ok(!campos.includes('siglaPartido'),
       `o endpoint continua sem siglaPartido (campos: ${campos.join(', ')})`);
    ok(campos.includes('uri'),
       'a uri — de onde o id do deputado é extraído — continua existindo');
    // Se um dia a Câmara ADICIONAR siglaPartido, este teste falha e alguém
    // decide conscientemente se passa a usá-lo. Melhor do que descobrir por
    // acidente num número errado publicado.
  }

  console.log('\n== ex-membros NÃO contam como bancada ==');
  {
    // 26/08/2026: a lista de proposições da bancada trouxe Dr. Victor Linhalis
    // (hoje PSB) e Mauricio Marcon (hoje PL) como se fossem do Podemos. A
    // lista da legislatura inclui quem saiu e REPETE o mesmo id com partidos
    // diferentes; sem conferir a filiação de hoje, ex-membro entra na conta.
    const r = await chat.FERRAMENTAS.bancada_podemos({});
    ok(!/• Dr\. Victor Linhalis/.test(r), 'Dr. Victor Linhalis (PSB) fora da bancada');
    ok(!/• Mauricio Marcon/.test(r), 'Mauricio Marcon (PL) fora da bancada');
    ok(/outro partido/.test(r), 'os que saíram são declarados, não apagados');
    // Licenciado PRECISA ficar: filtrar por situação em vez de partido tirava
    // a presidente do partido da própria bancada.
    ok(/Licen[çc]a|Exerc[íi]cio/.test(r), 'situação preservada (licenciado continua na bancada)');
  }

  console.log('\n== "projeto" não é sinônimo de "proposição" ==');
  {
    // Na semana de 10 a 14/08/2026 a bancada figurou em ~39 proposições de 12
    // tipos. Só 11 eram projeto. A resposta original listou tudo junto como
    // se fossem projetos — REQ, RIC, INC, PRL e SBT incluídos.
    const tudo = await chat.FERRAMENTAS.proposicoes_bancada({
      dataInicio: '2026-08-10', dataFim: '2026-08-14',
    });
    ok(/JANELA CONSULTADA: 2026-08-10 a 2026-08-14/.test(tudo),
       'a janela consultada é declarada no topo da observação');
    ok(/PROJETOS/.test(tudo) && /REQUERIMENTOS|RELATORIA/.test(tudo),
       'a saída vem separada por classe, não numa lista única');

    const proj = await chat.FERRAMENTAS.proposicoes_bancada({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', classe: 'projeto',
    });
    const itens = (proj.match(/^• /gm) || []).length;
    ok(itens >= 8 && itens <= 20, `classe "projeto" devolve só projetos: ${itens} itens`);
    ok(!/• (REQ|RIC|INC|REC|PRL|SBT|EMP) /m.test(proj),
       'nenhum requerimento, parecer ou emenda na lista de projetos');
    ok(/de \d+ proposições do período/.test(proj),
       'declara quantas do total foram filtradas — o resto não some em silêncio');
    ok(/LISTA ABAIXO ESTÁ COMPLETA/.test(proj),
       'marca a lista como completa, para a IA não resumir');
  }

  console.log('\n== janela: só dataInicio NÃO vira semana fechada ==');
  {
    // O pedido era 10 a 14/08; a IA mandou só dataInicio e a janela foi até
    // hoje (26/08). O cabeçalho tem de deixar isso impossível de disfarçar.
    const r = await chat.FERRAMENTAS.proposicoes_bancada({ dataInicio: '2026-08-10', classe: 'projeto' });
    const m = /JANELA CONSULTADA: (\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2})/.exec(r);
    ok(m, 'janela sempre declarada');
    ok(m && m[2] !== '2026-08-14',
       `sem dataFim a janela vai até hoje (${m ? m[2] : '?'}) — e isso fica escrito`);

    const invertida = await chat.FERRAMENTAS.proposicoes_bancada({
      dataInicio: '2026-08-14', dataFim: '2026-08-10',
    });
    ok(invertida.startsWith('ERRO:'), 'data final antes da inicial é recusada');
  }

  console.log('\n== apensados (uriPropPrincipal) ==');
  {
    // Confirmado em 26/08/2026: 9 de 25 PLs do Podemos de fev-abr têm
    // uriPropPrincipal preenchido (ex.: PL 54/2026 → apensado a PL 1191/2011).
    const r = await chat.FERRAMENTAS.proposicoes_bancada({
      dataInicio: '2026-02-01', dataFim: '2026-02-28', classe: 'projeto', apensados: true,
    });
    ok(/Apensamento conferido: \d+ de \d+/.test(r), 'o apensamento é conferido e contado');
    ok(/\[apensado a [A-Z]+ \d+\/\d{4}\]/.test(r),
       'projetos apensados trazem a proposição principal');
  }

  console.log('\n== o laço obedece à FERRAMENTA, não ao rótulo de ação ==');
  {
    // 26/08/2026: a IA mandou {"acao":"consultar","ferramenta":"exportar_grafico"}
    // — rótulo errado, intenção clara. O laço exigia acao:"exportar", não achou
    // a ferramenta entre as de consulta, devolveu ERRO, e o pedido acabou
    // VAZANDO como JSON cru na tela do usuário.
    ok(chat.rotaDe({ acao: 'consultar', ferramenta: 'exportar_grafico' }) === 'exportar',
       'exportar_grafico rotulado como "consultar" ainda vai para a exportação');
    ok(chat.rotaDe({ acao: 'exportar', ferramenta: 'votacoes_periodo' }) === 'consultar',
       'ferramenta de dado rotulada como "exportar" ainda vai para a consulta');
    ok(chat.rotaDe({ acao: 'consultar', ferramenta: 'votacoes_periodo' }) === 'consultar',
       'caminho normal de consulta preservado');
    ok(chat.rotaDe({ acao: 'responder', texto: 'oi' }) === 'responder', 'resposta final preservada');
    ok(chat.rotaDe({ acao: 'consultar', ferramenta: 'nao_existe' }) === 'desconhecida',
       'ferramenta inexistente é recusada, não confundida com resposta');

    // E se mesmo assim a chamada aparecer dentro do texto, ela não chega à tela.
    const sujo = 'Segue o gráfico.\n\n{"acao":"consultar","ferramenta":"exportar_grafico","argumentos":{"tipo":"barra"}}';
    const limpo = chat.limparChamadas(sujo);
    ok(!/"acao"/.test(limpo), 'chamada de ferramenta escrita no texto é removida');
    ok(/Segue o gráfico\./.test(limpo), 'o texto de verdade sobrevive à limpeza');
  }

  console.log('\n== encolher antes de cortar ==');
  {
    // Perder uma matéria inteira por cem caracteres de ementa é troca ruim:
    // no relato, 1 de 62 proposições de julho ficou de fora por pouco.
    const r = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-07-01', dataFim: '2026-07-31', orgao: 'PLEN',
    });
    const n = (r.match(/^• /gm) || []).length;
    const tot = /→ (\d+) proposições distintas/.exec(r);
    ok(tot && n === Number(tot[1]),
       `as ${tot ? tot[1] : '?'} de julho couberam inteiras (listou ${n})`);
    ok(!/NÃO couberam/.test(r), 'nenhum item perdido por margem apertada');
  }

  console.log('\n== gráficos: números vêm da TABELA, nunca do modelo ==');
  {
    await chat.FERRAMENTAS.orcamento_panorama({ ano: '2026' });
    const t = chat.ultimaTabela();

    for (const tipo of ['barra', 'pizza', 'empilhada']) {
      const g = chat.graficoDaTabela(t, { tipo, colunaValor: 'Pago' });
      ok(!g.erro && /^<svg /.test(g.svg), `${tipo}: desenhou (${g.larg}×${g.alt})`);
      ok(g.svg.includes(chat.VIZ.fundo),
         `${tipo}: superfície é a do placar de votação (${chat.VIZ.fundo})`);
    }

    // O maior valor da tabela tem de aparecer no desenho — se o gráfico
    // inventasse escala, o rótulo não bateria com o dado.
    const maior = Math.max(...t.linhas.map(l => Number(l[3]) || 0));
    const g = chat.graficoDaTabela(t, { tipo: 'barra', colunaValor: 'Pago' });
    const esperado = maior >= 1e6 ? (maior / 1e6).toFixed(1).replace('.', ',') : null;
    ok(!esperado || g.svg.includes(esperado),
       `o maior valor da tabela (${esperado} mi) está rotulado no gráfico`);

    // Tabela textual: RECUSA em vez de barra de zeros — e ensina a saída.
    await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', orgao: 'CCJC',
    });
    const tv = chat.ultimaTabela();
    const rec = chat.graficoDaTabela(tv, { tipo: 'barra' });
    ok(rec.erro && /textual/.test(rec.erro), 'tabela sem número é recusada, não vira gráfico de zeros');
    ok(rec.erro && /contagem/.test(rec.erro), 'a recusa indica agregacao:"contagem" como saída');

    const cont = chat.graficoDaTabela(tv, { tipo: 'barra', agregacao: 'contagem', colunaRotulo: 'Data' });
    ok(!cont.erro && cont.itens >= 1, `contagem por categoria funciona (${cont.itens} categorias)`);

    // A contagem tem de bater com a fonte. No relato de 26/08 o modelo contou
    // os itens a olho e errou 3 dos 6 dias (07/07 disse 7 e eram 9; 08/07
    // disse 5 e eram 6; 15/07 disse 37 e eram 34) — com o total certo ao lado.
    await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-07-01', dataFim: '2026-07-31', orgao: 'PLEN',
    });
    const tj = chat.ultimaTabela();
    const gj = chat.graficoDaTabela(tj, { tipo: 'barra', agregacao: 'contagem', colunaRotulo: 'Data' });
    const porDia = { '2026-07-01': 9, '2026-07-02': 1, '2026-07-07': 9, '2026-07-08': 6, '2026-07-14': 3, '2026-07-15': 34 };
    const lido = {};
    for (const l of tj.linhas) for (const d of String(l[1]).split(/\s*,\s*/)) lido[d] = (lido[d] || 0) + 1;
    const bate = Object.entries(porDia).every(([d, n]) => lido[d] === n);
    ok(bate, `quebra por dia bate com a API: ${JSON.stringify(lido)}`);
    ok(gj.itens === Object.keys(porDia).length,
       `o gráfico conta os mesmos ${Object.keys(porDia).length} dias`);
  }

  console.log('\n== gráfico: as regras que viraram código ==');
  {
    // "1.000 mil" — 999.930 arredondava para 1.000 na casa dos milhares.
    const t = { titulo: 'x', fonte: 'y', colunas: ['A', 'V'],
      linhas: [['a', 999930], ['b', 817000], ['c', 1200000]] };
    const g = chat.graficoDaTabela(t, { tipo: 'barra' });
    ok(!/1\.000 mil/.test(g.svg), '999.930 não vira "1.000 mil"');
    ok(/999,9 mil/.test(g.svg), 'vira "999,9 mil" — não muda de unidade para um valor que não é milhão');
    ok(/1,2 mi/.test(g.svg), '1.200.000 vira "1,2 mi"');

    // Sobra de parte-do-todo é cinza, nunca a 7ª cor (que repetia a 1ª).
    const muitos = { titulo: 'x', fonte: 'y', colunas: ['A', 'V'],
      linhas: Array.from({ length: 12 }, (_, i) => [`cat${i}`, 100 - i * 5]) };
    const pz = chat.graficoDaTabela(muitos, { tipo: 'pizza' });
    ok(pz.itens === 7, 'pizza limita a 6 fatias + "outros"');
    ok(pz.svg.includes(chat.VIZ.apagado), 'a sobra usa o cinza de apagamento');
    const azuis = (pz.svg.match(new RegExp(chat.VIZ.categorica[0], 'g')) || []).length;
    ok(azuis <= 2, `a 1ª cor não é reaproveitada na sobra (aparições: ${azuis})`);

    // Escala do eixo em números redondos.
    ok(JSON.stringify(chat.marcasEixo(383300000).marcas) === JSON.stringify([0, 100000000, 200000000, 300000000, 400000000]),
       'eixo em marcas redondas (0, 100 mi, 200 mi, 300 mi, 400 mi)');

    // Parser de célula: os dois formatos que as tabelas produzem.
    ok(chat.numeroDe('R$ 1.234.567,89') === 1234567.89, 'texto "R$ 1.234.567,89" vira número');
    ok(chat.numeroDe(199873) === 199873, 'número cru passa');
    ok(chat.numeroDe('PL 4578/2025') === null, 'texto não-numérico devolve null, não NaN nem zero');
    ok(chat.numeroDe('') === null, 'vazio devolve null (não vira zero silencioso)');
  }

  console.log('\n== base do Orçamento (Firebase) ==');
  {
    const cob = await chat.FERRAMENTAS.orcamento_cobertura({});
    ok(!cob.startsWith('ERRO:'), 'cobertura respondeu');
    ok(/anos coletados/.test(cob), 'declara os anos coletados');
    // Coleta incompleta tem de ser DECLARADA, não silenciada.
    const ufs = /(\d+) UF/.exec(cob);
    if (ufs && Number(ufs[1]) < 27) {
      ok(/ATENÇÃO: faltam/.test(cob), 'UF faltando é declarada como coleta parcial');
    } else {
      ok(true, `cobertura completa (${ufs ? ufs[1] : '?'} UF)`);
    }

    const pan = await chat.FERRAMENTAS.orcamento_panorama({ ano: '2026' });
    ok(!pan.startsWith('ERRO:'), 'panorama 2026 respondeu');
    ok(/Empenhado R\$/.test(pan) && /Pago R\$/.test(pan), 'traz empenhado e pago em reais');
    ok(/Por função/.test(pan), 'quebra por função presente');

    const dep = await chat.FERRAMENTAS.orcamento_parlamentar({ nome: 'Renata Abreu', ano: '2026' });
    ok(!dep.startsWith('ERRO:'), 'consulta por parlamentar respondeu');
    ok(/RENATA ABREU/i.test(dep), 'encontrou a parlamentar pela chave normalizada');

    // Nome inexistente: a resposta certa é "não há" COM a lista do que há —
    // nunca uma tabela vazia que a IA leia como zero.
    const nada = await chat.FERRAMENTAS.orcamento_parlamentar({ nome: 'Fulano Inexistente', ano: '2026' });
    ok(/Nenhuma emenda/.test(nada) && /Parlamentares com emenda/.test(nada),
       'nome inexistente devolve "não há" e lista quem há');
  }

  console.log('\n== saúde/FNS por UF ==');
  {
    const sp = await chat.FERRAMENTAS.orcamento_saude_uf({ uf: 'SP', ano: '2026' });
    ok(!sp.startsWith('ERRO:'), 'SP respondeu');
    ok(/propostas do Podemos/.test(sp), 'conta as propostas');
    ok(/Por situação/.test(sp), 'quebra por situação presente');

    const zz = await chat.FERRAMENTAS.orcamento_saude_uf({ uf: 'ZZ', ano: '2026' });
    ok(/Nenhuma coleta/.test(zz), 'UF sem coleta é declarada, não devolve vazio mudo');
  }

  console.log('\n== falha de fonte é DECLARADA com "ERRO:" ==');
  {
    // O prompt manda a IA declarar a falha quando a observação começa com
    // "ERRO:". Se a ferramenta engolir o erro e devolver texto normal, a IA
    // completa o buraco com invenção — é o modo de falha mais caro.
    const fora = await chat.FERRAMENTAS.pagina_oficial({ url: 'https://exemplo-nao-oficial.com/x' });
    ok(fora.startsWith('ERRO:'), `domínio fora da lista → ${fora.slice(0, 60)}`);

    const semArg = await chat.FERRAMENTAS.situacao_proposicao({ sigla: 'PL' });
    ok(semArg.startsWith('ERRO:'), 'argumento faltando → ERRO explícito');

    const semUf = await chat.FERRAMENTAS.orcamento_saude_uf({ ano: '2026' });
    ok(semUf.startsWith('ERRO:'), 'UF faltando → ERRO explícito');
  }

  console.log('\n== situação de proposição, com autoria da bancada ==');
  {
    const r = await chat.FERRAMENTAS.situacao_proposicao({ sigla: 'PL', numero: '3659', ano: '2026' });
    ok(!r.startsWith('ERRO:'), 'consulta respondeu');
    ok(/Ementa:/.test(r), 'ementa presente');
    ok(/Do Podemos: .*Bruno Ganem/.test(r),
       'autoria da bancada identificada pelo id (não pelo campo inexistente)');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
