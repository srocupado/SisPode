// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// PDL com substitutivo adotado por comissão (ou parecer de Plenário): a nota lê o texto em votação.
//
// CASO REAL (24/11/2026): a nota do PDL 366/2025 (tratado Brasil–Guiana de auxílio jurídico em matéria penal)
// foi regerada e o selo "Pode estar desatualizada" continuou. A proposição tem o SBT-A 1 da CCJC (17/11/2026);
// o cenário 10 (PDL) anexava só o inteiro teor e o parecer da comissão, mas a verificação de atualização trata
// o SBT-A como texto operativo — o selo voltava a cada verificação, com a nota sempre "sem" o substitutivo.
// Uso: node testes/pdl-substitutivo.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado em analise.js: ' + re); return m[0]; };
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const A = new Function('console', 'resolverMPVDeclarando', 'buscarEmendasSenadoESSP', 'resolverApensados', 'fetchJson', 'API_BASE', `
  ${trecho(/const REGRA_ARGUMENTOS = [^\n]+/)}
  ${trecho(/const FORMATO_PADRAO_NOTA = [^\n]+/)}
  ${trecho(/const TIPOS_OPERATIVOS = [^\n]+/)}
  ${trecho(/const CENARIO_MPV\s+= [^\n]+/)}
  ${trecho(/const CENARIO_MPV_8A = [^\n]+/)}
  ${trecho(/const CENARIO_MPV_8B = [^\n]+/)}
  ${trecho(/const CENARIO_MPV_8B_PROPOSTO = [^\n]+/)}
  ${trecho(/const TIPOS_MPV = [^\n]+/)}
  ${trecho(/function tipoLabel\([\s\S]*?\n}/)}
  ${trecho(/function ehMPV\([\s\S]*?\n}/)}
  ${trecho(/function ehPDL\([\s\S]*?\n}/)}
  ${trecho(/const RE_SUSTACAO = [^\n]+/)}
  ${trecho(/function subtipoPDL\([\s\S]*?\n}/)}
  ${trecho(/function ehUrgenciaComProjeto\([\s\S]*?\n}/)}
  ${trecho(/function itemComoProjeto\([\s\S]*?\n}/)}
  ${trecho(/function classificarCenario\([\s\S]*?\n}/)}
  ${trecho(/function operativosAtuais\([\s\S]*?\n}/)}
  ${trecho(/function desatualizacaoOperativa\([\s\S]*?\n}/)}
  ${trecho(/async function escolherDocumentos\([\s\S]*?\n}/)}
  ${trecho(/function promptPDL\([\s\S]*?\n}/)}
  return { classificarCenario, desatualizacaoOperativa, escolherDocumentos, promptPDL };
`)(
  { log() {}, warn() {} },
  async () => { throw new Error('não é MPV'); },
  async () => { throw new Error('PDL não busca emendas do Senado'); },
  async () => [],
  async () => ({ dados: {} }),
  'https://dadosabertos.camara.leg.br/api/v2',
);

// PDL 366/2025, como a página "Histórico de Pareceres" da Câmara o traz em 24/11/2026
const TEOR = 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=teor366';
const SBTA = { url: 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=sbta366', data: '2026-11-17', dataBR: '17/11/2026', sequencial: 1, comissao: 'CCJC' };
const item = (par) => ({
  tipoCategoria: 'projeto', sigla: 'PDL', numero: '366', ano: '2025', chave: 'PDL-366-2025',
  ementa: 'Aprova o texto do Tratado entre a República Federativa do Brasil e a República Cooperativa da Guiana sobre Auxílio Jurídico Mútuo em Matéria Penal, assinado em Georgetown, em 6 de maio de 2022.',
  enriquecimento: { idProposicao: 2532113, urlInteiroTeor: TEOR, apensadosPodemos: [],
    pareceresPlenario: Object.assign({ comissoes: [], prlp: null, prle: null, sbtA: null, autografo: null, prlEspecial: null, sbtAEspecial: null }, par) },
});

(async () => {
  console.log('== PDL com substitutivo adotado pela CCJC ==');
  const it = item({ sbtA: SBTA });
  const docs = await A.escolherDocumentos(it);
  const tipos = docs.map(d => d.tipo).join(',');
  ok(/^PDL_TEOR,SBT_A/.test(tipos), `a nota anexa o inteiro teor e o substitutivo adotado pela CCJC (${tipos})`);
  ok(docs.find(d => d.tipo === 'SBT_A').rotulo === 'Substitutivo adotado por comissão (SBT-A nº 1 — CCJC de 17/11/2026)', 'rótulo do substitutivo com número, comissão e data');
  ok(A.classificarCenario(docs) === 'Cenário 10 — PDL na forma do substitutivo/parecer de Plenário', 'cenário diz que o texto votado é o do substitutivo');

  // nota feita com os documentos atuais: em dia — o selo não volta depois de regerar
  it.analise = { documentos: docs.map(d => ({ tipo: d.tipo, rotulo: d.rotulo, url: d.url })) };
  ok(A.desatualizacaoOperativa(it).novos.length === 0, 'nota regerada (com o SBT-A): "Verificar atualização" responde em dia');

  // a nota antiga (só inteiro teor + parecer da comissão) segue marcada — era ela a desatualizada
  const antiga = item({ sbtA: SBTA });
  antiga.analise = { documentos: [{ tipo: 'PDL_TEOR', rotulo: 'Inteiro teor do Decreto Legislativo (texto e justificação)', url: TEOR },
    { tipo: 'PARECER_COMISSAO', rotulo: 'Parecer da Comissão CCJC de 17/11/2026', url: 'https://camara/par-ccjc' }] };
  const d = A.desatualizacaoOperativa(antiga);
  ok(d.novos.length === 1 && d.novos[0].tipo === 'SBT_A', 'nota antiga, sem o substitutivo: continua marcada (o selo era verdadeiro para ela)');

  const pr = A.promptPDL(it, docs);
  ok(/TEXTO EM VOTAÇÃO: a comissão adotou um substitutivo \(Documento 2, Substitutivo adotado por comissão/.test(pr) && /O Plenário vota o substitutivo, não o decreto original/.test(pr) && /## O que muda em relação ao texto original/.test(pr),
    'o prompt diz que o Plenário vota o substitutivo e pede a comparação com o texto original');

  console.log('\n== PDL sem substitutivo: nada muda ==');
  const sem = item({});
  const docsSem = await A.escolherDocumentos(sem);
  ok(docsSem.map(x => x.tipo).join(',') === 'PDL_TEOR', 'só o inteiro teor, como antes');
  ok(A.classificarCenario(docsSem) === 'Cenário 10 — PDL (decreto legislativo)' && !/TEXTO EM VOTAÇÃO/.test(A.promptPDL(sem, docsSem)), 'cenário e prompt de sempre');

  console.log('\n== PDL com parecer de Plenário (PRLP) ==');
  const comPrlp = item({ prlp: { url: 'https://camara/prlp', data: '2026-11-24', dataBR: '24/11/2026', sequencial: 1 } });
  const docsPrlp = await A.escolherDocumentos(comPrlp);
  ok(docsPrlp.some(x => x.tipo === 'PRLP') && /O Plenário vota o texto do parecer de Plenário/.test(A.promptPDL(comPrlp, docsPrlp)), 'o PRLP entra e o prompt diz que o Plenário vota o texto do parecer');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
