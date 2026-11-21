// Notas das consultorias de orçamento da Câmara e do Senado, juntadas aos documentos da NTA (21/11/2026).
// Uso: node testes/notas-consultoria.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const N = require(path.join(RAIZ, 'notas-consultoria.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== a listagem cita a matéria? ==');
  const plp = { sigla: 'PLP', numero: 299, ano: 2026 }, pl = { sigla: 'PL', numero: 299, ano: 2026 }, mp = { sigla: 'MPV', numero: 1361, ano: 2026 };
  const c = N.consultoriaCitaMateria;
  ok(c('Nota Informativa - Substitutivo ao PLP nº 299/2026', plp) && c('Texto-base aprovado do PLP 299/2026', plp) && c('o Projeto de Lei Complementar nº 299, de 2026', plp) && c('ni_substitutivo_plp_299_2026.pdf', plp), 'PLP: sigla com e sem "nº", nome por extenso e nome do arquivo');
  ok(!c('PLP 2990/2026', plp) && !c('PLP 299/2025', plp) && !c('PLP 1299/2026', plp), 'número ou ano diferente não casa');
  ok(c('PL 299/2026', pl) && !c('PLP 299/2026', pl) && !c('PL nº 299/2026-CN', pl), '"PL" não casa com "PLP" nem com projeto do Congresso ("-CN")');
  ok(c('MP 1361 - Subsídios acerca da adequação orçamentária', mp) && c('MPV 1.361/2026', mp) && c('Medida Provisória nº 1.361, de 2026', mp) && c('mp-1361-2026-nota-tecnica-no-29-2026', mp) && !c('MP 13610', mp), 'medida provisória: "MP 1361" sem o ano, com ponto de milhar, por extenso e no endereço');
  ok(!c('PLP 299/2026', {}) && !c('', plp), 'sem matéria ou sem texto, não casa');

  console.log('== leitura da listagem ==');
  const senado = `<ul><li><a href="https://www12.senado.leg.br/orcamento/documentos/estudos/tipos-de-estudos/notas-tecnicas-e-informativos/ni_substitutivo_plp_299_2026.pdf/view" title="Em 11 de novembro de 2026, o Relator do PLP nº 299/2026"> <img src="/x.png" /> Nota Informativa - Substitutivo ao PLP nº 299/2026 </a></li>
    <li><a href="/orcamento/documentos/estudos/tipos-de-estudos/notas-tecnicas-e-informativos/nota_informativa_texto_aprovado_plp_299_2026.pdf/view">Nota Informativa - Texto-base aprovado do PLP 299/2026</a></li>
    <li><a href="/orcamento/x/ni_decisoes_stf_emendas.pdf/view">Decisões do STF sobre emendas parlamentares</a></li>
    <li><a href="#topo">PLP 299/2026</a></li></ul>`;
  const ns = N.consultoriaNotasDaPagina(senado, 'https://www12.senado.leg.br/orcamento/documentos/estudos/tipos-de-estudos/notas-tecnicas-e-informativos', plp);
  ok(ns.length === 2 && ns[0].titulo === 'Nota Informativa - Substitutivo ao PLP nº 299/2026' && /ni_substitutivo_plp_299_2026\.pdf$/.test(ns[0].url) && /^https:\/\/www12\.senado\.leg\.br\/orcamento\/.*texto_aprovado_plp_299_2026\.pdf$/.test(ns[1].url), 'Senado: as duas notas da matéria, com o endereço do arquivo (sem "/view") e o relativo resolvido');
  const camara = `<a href="https://www2.camara.leg.br/orcamento-da-uniao/estudos/2026/mp-1361-2026-nota-tecnica-no-29-2026-cd-otavio">MP 1361 - Subsídios acerca da adequação orçamentária e financeira da Medida Provisória nº 1.361</a>
    <a href="https://www2.camara.leg.br/orcamento-da-uniao/estudos/2026/mp-1360-2026-nota-tecnica-no-28-2026">MP 1360 - Subsídios</a>`;
  const nc = N.consultoriaNotasDaPagina(camara, 'https://www2.camara.leg.br/orcamento-da-uniao/estudos/2026', mp);
  ok(nc.length === 1 && /^MP 1361 - Subsídios/.test(nc[0].titulo), 'Câmara: só a nota da medida provisória pedida');

  console.log('== busca nas duas consultorias ==');
  const pedidos = [];
  const fetchTexto = async u => { pedidos.push(u); if (/www12\.senado/.test(u)) return senado; if (/estudos\/2026$/.test(u)) return camara; throw new Error('HTTP 404'); };
  const r1 = await N.consultoriasBuscarNotas(plp, fetchTexto, { hoje: new Date('2026-11-21T12:00:00Z') });
  ok(r1.length === 2 && r1.every(d => d.apoioConsultoria && d.tipo === 'NOTA_CONSULTORIA' && d.casa === 'Senado') && /^Nota da Consultoria de Orçamentos, Fiscalização e Controle do Senado: Nota Informativa - Substitutivo/.test(r1[0].rotulo) && pedidos.length === 2, 'PLP 299/2026: as duas notas do Senado, com o órgão no rótulo; uma página por Casa');
  const r2 = await N.consultoriasBuscarNotas(mp, fetchTexto, { hoje: new Date('2026-11-21T12:00:00Z') });
  ok(r2.length === 1 && r2[0].casa === 'Câmara' && /Consultoria de Orçamento e Fiscalização Financeira da Câmara/.test(r2[0].rotulo), 'MPV 1361/2026: a nota de adequação da consultoria da Câmara');
  const caiu = await N.consultoriasBuscarNotas(plp, async u => { if (/senado/.test(u)) throw new Error('fora do ar'); return camara; }, { hoje: new Date('2026-11-21T12:00:00Z') });
  ok(Array.isArray(caiu) && caiu.length === 0, 'listagem fora do ar: a busca devolve o que achou, sem erro');
  const anoAnt = []; await N.consultoriasBuscarNotas({ sigla: 'PL', numero: 10, ano: 2024 }, async u => { anoAnt.push(u); return ''; }, { hoje: new Date('2026-11-21T12:00:00Z') });
  ok(anoAnt.filter(u => /camara/.test(u)).map(u => u.slice(-4)).join() === '2024,2026', 'Câmara: procura no ano da proposição e no ano corrente');
  ok((await N.consultoriasBuscarNotas(plp, fetchTexto, { hoje: new Date('2026-11-21T12:00:00Z'), max: 1 })).length === 1, 'limite de notas respeitado');

  console.log('== ligação com a tela ==');
  const tela = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8'), pagina = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8'), man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  ok(/comPrazo\(consultoriasBuscarNotas\(mat, textoDe\)\)/.test(tela) && /apoioSenado = \[\.\.\.\(\(sen && sen\.documentos\) \|\| \[\]\), \.\.\.\(notas \|\| \[\]\)\];/.test(tela) && /Documentos de apoio \(lidos junto com os da Câmara\)/.test(tela), 'tela da NTA: as notas entram na mesma lista de documentos de apoio do diálogo');
  ok(pagina.indexOf('<script src="notas-consultoria.js">') > 0 && pagina.indexOf('<script src="notas-consultoria.js">') < pagina.indexOf('<script src="analise.js">') && man.host_permissions.includes('https://www12.senado.leg.br/*') && man.host_permissions.includes('https://www2.camara.leg.br/*'), 'a página carrega o módulo antes da tela, e a extensão tem permissão para os dois sites');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO', e.stack); process.exit(1); });
