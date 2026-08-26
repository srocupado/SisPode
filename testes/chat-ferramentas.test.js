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

    // Recorte grande de verdade: corta, mas AVISA e diz o que fazer.
    const ccjc = await chat.FERRAMENTAS.votacoes_periodo({
      dataInicio: '2026-08-10', dataFim: '2026-08-14', orgao: 'CCJC',
    });
    ok(/NÃO couberam/.test(ccjc), 'lista grande demais declara quantos ficaram de fora');
    ok(/NÃO conclua que algo não existe/.test(ccjc),
       'e proíbe explicitamente concluir inexistência a partir da lista cortada');
    // O que a observação corta, a planilha continua tendo — é o que torna o
    // aviso "peça a planilha" verdadeiro em vez de consolo.
    const tab = chat.ultimaTabela();
    const vistos = (ccjc.match(/^• /gm) || []).length;
    ok(tab && tab.linhas.length > vistos,
       `planilha com ${tab ? tab.linhas.length : 0} linhas contra ${vistos} visíveis na observação`);
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
