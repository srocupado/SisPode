// Reaproveitamento da análise entre o requerimento de urgência e o projeto.
//
// A pauta traz, com frequência, o requerimento de urgência de um projeto e o
// próprio projeto. O requerimento não tem texto próprio a analisar — o módulo
// já o analisa sobre o INTEIRO TEOR DO PROJETO-ALVO. Quando o projeto está em
// Cenário 1 (sem parecer de plenário, sem substitutivo adotado, sem emendas do
// Senado), as duas análises leem exatamente os mesmos PDFs, e a segunda
// chamada à IA paga por um texto que já existe.
//
// O QUE ESTE TESTE PROTEGE. A tentação é reaproveitar por identidade: "é o
// mesmo projeto, então serve". Não serve. Se o projeto tiver parecer, ele é
// votado NA FORMA DO SUBSTITUTIVO, enquanto a análise do requerimento foi
// feita sobre o texto original — a nota descreveria um texto que não é o que
// está em votação. É o mesmo erro que desatualizacaoOperativa existe para
// pegar, e seria introduzido de propósito.
//
// Por isso a condição é a IGUALDADE DOS DOCUMENTOS (comparados pela URL), não
// o parentesco entre os itens.
//
// Uso: node testes/analise-reaproveitamento.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const estado = { pauta: null };
const toasts = [];
const salvos = [];
const renderizados = [];

const A = new Function('state', 'mostrarToast', 'renderAnaliseCard', 'fbSalvarAnalise', 'classificarCenario', 'parecerKey', 'tipoLabel', 'console', `
  ${trecho(/function mesmaProposicao\([\s\S]*?\n}/)}
  ${trecho(/function chaveDocumentos\([\s\S]*?\n}/)}
  ${trecho(/function analiseIrmaAproveitavel\([\s\S]*?\n}/)}
  ${trecho(/function aproveitarAnalise\([\s\S]*?\n}/)}
  return { mesmaProposicao, chaveDocumentos, analiseIrmaAproveitavel, aproveitarAnalise };
`)(
  estado,
  (msg, tipo) => toasts.push(`${tipo}: ${msg}`),
  it => renderizados.push(it.chave),
  async it => { salvos.push(it.chave); },
  docs => docs.some(d => d.tipo === 'PRLP') ? 'Cenário 3 — parecer de plenário (PRLP)' : 'Cenário 1 — inteiro teor (sem parecer)',
  it => it.tipoCategoria === 'requerimento' ? 'inteiro-teor' : (it.relator?.data ? 'parecer-x' : 'inteiro-teor'),
  s => s,
  { warn() {}, log() {} },
);

// ---------- itens de mentira, no formato do painel ----------
const TEOR = 'https://www.camara.leg.br/prop_mostrarintegra?codteor=111';
const PARECER = 'https://www.camara.leg.br/prop_mostrarintegra?codteor=222';
const docsTeor    = [{ tipo: 'INTEIRO_TEOR', rotulo: 'Inteiro teor da proposição', url: TEOR }];
const docsParecer = [{ tipo: 'PRLP', rotulo: 'PRLP nº 1', url: PARECER },
                     { tipo: 'REDACAO_ORIGINAL', rotulo: 'Redação original', url: TEOR }];

const req = (extra = {}) => ({
  ordem: 1, tipoCategoria: 'requerimento', sigla: 'REQ', numero: '4140', ano: '2026', chave: 'REQ-4140-2026',
  projetoUrgenciado: { sigla: 'PL', numero: '1893', ano: '2026' }, ...extra,
});
const projeto = (extra = {}) => ({
  ordem: 5, tipoCategoria: 'projeto', sigla: 'PL', numero: '1893', ano: '2026', chave: 'PL-1893-2026', ...extra,
});
const comAnalise = (it, docs, extra = {}) => ({
  ...it,
  analiseStatus: 'ok',
  analise: { markdown: '## Objetivo\nTexto da nota.', provedor: 'gemini', modelo: 'x',
             documentos: docs.map(d => ({ ...d })), geradoEm: '2026-09-03T10:00:00.000Z', ...extra },
});

(async () => {
  console.log('== identidade da proposição tratada ==');
  {
    ok(A.mesmaProposicao(req(), projeto()), 'requerimento de urgência e o projeto que ele urgencia são a mesma matéria');
    ok(A.mesmaProposicao(projeto(), req()), 'e a relação é simétrica');
    ok(!A.mesmaProposicao(req(), projeto({ numero: '9999' })), 'projeto diferente, matéria diferente');
    // Requerimento s/nº: a chave é derivada, mas a identidade continua vindo
    // do projeto urgenciado.
    const semNumero = req({ numero: 's/nº', chave: 'REQ-sn-PL1893-2026-2026' });
    ok(A.mesmaProposicao(semNumero, projeto()), 'requerimento s/nº também casa pelo projeto urgenciado');
    // Requerimento que o parser não conseguiu vincular a projeto nenhum.
    ok(!A.mesmaProposicao(req({ projetoUrgenciado: null }), projeto()),
       'requerimento sem projeto identificado não casa com nada');
    ok(!A.mesmaProposicao(projeto(), projeto({ sigla: 'PLP' })), 'PL 1893 e PLP 1893 são proposições distintas');
  }

  console.log('== comparação dos documentos ==');
  {
    ok(A.chaveDocumentos(docsTeor) === A.chaveDocumentos([{ url: TEOR }]), 'a chave é o conjunto de URLs');
    ok(A.chaveDocumentos(docsParecer) === A.chaveDocumentos(docsParecer.slice().reverse()),
       'a ordem dos documentos não altera a chave');
    ok(A.chaveDocumentos(docsTeor) !== A.chaveDocumentos(docsParecer), 'roles diferentes, chaves diferentes');
    ok(A.chaveDocumentos([]) === '', 'sem documentos, chave vazia');
  }

  console.log('\n== O CASO QUE VALE: projeto sem parecer ==');
  {
    const r = comAnalise(req(), docsTeor);
    const p = projeto();
    estado.pauta = { itens: [r, p] };
    const irma = A.analiseIrmaAproveitavel(p, docsTeor);
    ok(irma === r, 'o projeto reaproveita a análise do requerimento (mesmos PDFs)');

    // E no sentido inverso, se o projeto for analisado primeiro.
    const p2 = comAnalise(projeto(), docsTeor);
    const r2 = req();
    estado.pauta = { itens: [p2, r2] };
    ok(A.analiseIrmaAproveitavel(r2, docsTeor) === p2, 'e o requerimento reaproveita a do projeto');
  }

  console.log('\n== O CASO QUE NÃO PODE: projeto com parecer ==');
  {
    // O requerimento foi analisado sobre o texto ORIGINAL; o projeto vai a voto
    // na forma do substitutivo. Reaproveitar descreveria o texto errado.
    const r = comAnalise(req(), docsTeor);
    const p = projeto({ relator: { data: '01/09/2026' } });
    estado.pauta = { itens: [r, p] };
    ok(A.analiseIrmaAproveitavel(p, docsParecer) === null,
       'projeto com parecer NÃO reaproveita a análise feita sobre o inteiro teor');

    // Nem o contrário: o requerimento não herda a nota do substitutivo.
    const p2 = comAnalise(projeto(), docsParecer);
    estado.pauta = { itens: [p2, req()] };
    ok(A.analiseIrmaAproveitavel(req(), docsTeor) === null,
       'e o requerimento não herda a análise feita sobre o substitutivo');
  }

  console.log('\n== outras recusas ==');
  {
    const r = comAnalise(req(), docsTeor);
    estado.pauta = { itens: [r, projeto({ numero: '9999' })] };
    ok(A.analiseIrmaAproveitavel(projeto({ numero: '9999' }), docsTeor) === null, 'outra proposição não serve de fonte');

    // Nota escrita à mão (MPV em edição livre, redação final antiga) é trabalho
    // do analista sobre AQUELE item; replicá-la seria assinar por ele noutro.
    const manual = comAnalise(req(), docsTeor, { manual: true, cenario: 'Cenário 8 — MPV (edição livre)' });
    estado.pauta = { itens: [manual, projeto()] };
    ok(A.analiseIrmaAproveitavel(projeto(), docsTeor) === null, 'análise manual não é replicada');

    const semAnalise = { ...req(), analiseStatus: 'sem_analise', analise: null };
    estado.pauta = { itens: [semAnalise, projeto()] };
    ok(A.analiseIrmaAproveitavel(projeto(), docsTeor) === null, 'irmão sem análise não serve');

    const gerando = comAnalise(req(), docsTeor);
    gerando.analiseStatus = 'gerando';
    estado.pauta = { itens: [gerando, projeto()] };
    ok(A.analiseIrmaAproveitavel(projeto(), docsTeor) === null, 'análise ainda em geração não é aproveitada');

    estado.pauta = { itens: [comAnalise(req(), docsTeor)] };
    ok(A.analiseIrmaAproveitavel(projeto(), []) === null, 'sem documentos a comparar, não reaproveita');

    const so = comAnalise(projeto(), docsTeor);
    estado.pauta = { itens: [so] };
    ok(A.analiseIrmaAproveitavel(so, docsTeor) === null, 'um item não reaproveita a si mesmo');

    estado.pauta = null;
    ok(A.analiseIrmaAproveitavel(projeto(), docsTeor) === null, 'sem pauta carregada, não quebra');
  }

  console.log('\n== a cópia registra a procedência ==');
  {
    toasts.length = 0; salvos.length = 0; renderizados.length = 0;
    const r = comAnalise(req(), docsTeor, { apelido: 'Marco do saneamento', editadoEm: '2026-09-03T11:00:00.000Z', editadoPor: 'fulano' });
    const p = projeto();
    estado.pauta = { itens: [r, p] };
    A.aproveitarAnalise(p, r, docsTeor);

    ok(p.analise.markdown === r.analise.markdown, 'o texto da nota é o mesmo');
    ok(p.analiseStatus === 'ok', 'o item passa a ter análise');
    ok(p.analise.reaproveitadaDe === 'REQ 4140/2026 (item 1)', `a procedência fica registrada: "${p.analise.reaproveitadaDe}"`);
    ok(typeof p.analise.reaproveitadaEm === 'string', 'com o momento do reaproveitamento');
    ok(p.analise.parecerKey === 'inteiro-teor', 'a chave do parecer é recalculada para o item de destino');
    ok(p.analise.cenario === 'Cenário 1 — inteiro teor (sem parecer)', `e o cenário também: ${p.analise.cenario}`);
    ok(p.analise.documentos.length === 1 && p.analise.documentos[0].url === TEOR, 'os documentos são os do item de destino');
    // Edição feita no irmão não pode viajar como se fosse deste item.
    ok(!p.analise.editadoEm && !p.analise.editadoPor, 'a marca de edição do irmão não é herdada');
    ok(p.apelido === 'Marco do saneamento', 'o apelido aproveita o já gerado (poupa outra chamada)');
    ok(p.desatualizacao === null, 'a nota nasce sem alerta de desatualização');
    ok(salvos.includes('PL-1893-2026') && renderizados.includes('PL-1893-2026'), 'salva no Firebase e redesenha o card');
    ok(toasts.some(t => /reaproveitada de REQ 4140\/2026/.test(t) && /sem nova chamada/.test(t)),
       `e avisa o analista: "${toasts[0]}"`);
  }

  console.log('\n== a fiação em gerarAnaliseItem ==');
  {
    const g = trecho(/async function gerarAnaliseItem\([\s\S]*?\n^}/m);
    ok(/if \(!forcar\) \{\s*\n\s*const irma = analiseIrmaAproveitavel\(it, docs\)/.test(g),
       'a busca acontece depois de escolherDocumentos e antes de baixar os PDFs');
    const antesDoDownload = g.indexOf('analiseIrmaAproveitavel') < g.indexOf('Promise.all(docs.map(d => baixarPdf');
    ok(antesDoDownload, 'nem os PDFs são baixados quando há reaproveitamento');
    // "Regerar" tem de forçar chamada nova, senão o analista não conseguiria
    // refazer uma nota de que discordou.
    ok(/if \(!forcar\)/.test(g.slice(g.indexOf('analiseIrmaAproveitavel') - 200, g.indexOf('analiseIrmaAproveitavel'))),
       'Regerar (forcar) ignora o reaproveitamento e chama a IA');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
