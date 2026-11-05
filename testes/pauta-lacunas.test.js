'use strict';
// Detector de lacunas da pauta + recuperação por IA (pauta-parser.js).
//
// O caso (03/11/2026): a pauta pulava do item 5 para o 8 — os itens 6 e 7 eram
// Recursos, que o parser não conhecia, e sumiam em silêncio. O detector lê a
// numeração do próprio texto; o que falta vai para a IA, que só vira item se o
// número estiver escrito no trecho e a Câmara confirmar.
//
// Corpus: testes/pautas/corpus — as 26 pautas de Plenário de 02/06 a 04/11/2026
// (PDF oficial, texto extraído como a extensão faz, cortado em "AVISOS").
const fs = require('fs');
const path = require('path');
const P = require('../pauta-parser.js');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const ler = f => fs.readFileSync(path.join(__dirname, 'pautas', f), 'utf8');

console.log('\n== sem falso alarme: corpus e acervo ==');
const arqs = [
  ...fs.readdirSync(path.join(__dirname, 'pautas', 'corpus')).filter(f => f.endsWith('.txt')).map(f => 'corpus/' + f),
  ...fs.readdirSync(path.join(__dirname, 'pautas')).filter(f => /-plenario\.txt$/.test(f)),
];
ok(arqs.length >= 28, `${arqs.length} pautas`);
for (const f of arqs) {
  const t = ler(f);
  const r = P.parsearPauta(t);
  const L = P.detectarLacunasPauta(t, r.itens);
  const nAnc = P.ancorasItensPauta(t).ancoras.length;
  ok(!L.faltando.length && nAnc === new Set(r.itens.map(i => i.ordem)).size,
    `${f}: ${r.itens.length} itens, ${nAnc} âncoras, nenhuma lacuna${L.faltando.length ? ' — FALTAM ' + L.faltando : ''}`);
}

console.log('\n== pega a quebra real: Recursos de 03/11 sem o parser conhecê-los ==');
const t311 = ler('2026-11-03-plenario.txt');
const sem = P.parsearPauta(t311); sem.itens = sem.itens.filter(i => i.sigla !== 'REC');
const lac = P.detectarLacunasPauta(t311, sem.itens);
ok(JSON.stringify(lac.faltando) === '[6,7]', `faltando ${JSON.stringify(lac.faltando)}`);
ok(/Recurso nº 68, de 2019/.test(lac.trechos[6]) && !/Recurso nº 19/.test(lac.trechos[6]), 'trecho do 6 = o Recurso 68/2019, sem o item seguinte');
ok(/Recurso nº 19, de 2022/.test(lac.trechos[7]), 'trecho do 7 = o Recurso 19/2022');

console.log('\n== pega item no fim da pauta e parser que não leu nada ==');
const ult = P.parsearPauta(t311); const maxO = Math.max(...ult.itens.map(i => i.ordem));
ok(P.detectarLacunasPauta(t311, ult.itens.filter(i => i.ordem !== maxO)).faltando.join() === String(maxO), `último item (${maxO}) faltando é detectado`);
ok(P.detectarLacunasPauta(t311, []).faltando.length === ult.itens.length, 'parser sem nenhum item → todos viram lacuna (a IA ainda pode ler)');

console.log('\n== diagnóstico: por que o leitor não leu (título publicado + desvio) ==');
const diag = (tx, n) => { const r = P.parsearPauta(tx); const L = P.detectarLacunasPauta(tx, r.itens); return { faltando: L.faltando, d: L.diagnosticos[n] || {} }; };
let dg = diag(t311.replace(/1\.\s+Reda[çc][ãa]o Final ao/, '1. Redações Finais ao'), 1);
ok(dg.faltando.join() === '1' && /plural/.test(dg.d.motivo) && /^1\. Redações Finais ao Projeto de Lei nº 2\.879/.test(dg.d.titulo), `"Redações Finais" → ${dg.d.motivo}`);
dg = diag(t311.replace(/3\s?\.\s+Requerimento nº ([\d.]+), de (\d{4})/, '3. Requerimento nº $1/$2'), 3);
ok(dg.faltando.join() === '3' && /"X\/AAAA"/.test(dg.d.motivo), `Requerimento nº X/AAAA → ${dg.d.motivo}`);
dg = diag(t311.replace(/3\s?\.\s+Requerimento nº/, '3. Indicação nº'), 3);
ok(/tipo de item não previsto/.test(dg.d.motivo) && /"Indicação"/.test(dg.d.motivo), `tipo novo na matéria sobre a mesa → ${dg.d.motivo}`);
dg = diag(t311.replace('\nPROJETO DE LEI Nº 79, DE 2020', '\nPROJETO DE LEI DA CÂMARA Nº 79, DE 2020'), 9);
ok(dg.faltando.join() === '9' && /tipo de proposição não previsto: "PROJETO DE LEI DA CÂMARA"/.test(dg.d.motivo), 'tipo novo na Ordem do Dia → tipo citado');
dg = diag(t311.replace('\nPROJETO DE LEI Nº 79, DE 2020', '\nPROJETO DE LEI Nº 79/2020'), 9);
ok(/"Nº X\/AAAA"/.test(dg.d.motivo) && dg.d.titulo === 'PROJETO DE LEI Nº 79/2020', `Ordem do Dia "Nº X/AAAA" → ${dg.d.motivo}`);

console.log('\n== resposta da IA: travas ==');
const resp = arr => JSON.stringify(arr);
let r = P.itensDaRespostaLacunas('```json\n' + resp([
  { ordem: 6, categoria: 'recurso', sigla: 'REC', numero: '68', ano: '2019', alvo: { sigla: 'PL', numero: '2.334', ano: '2019' }, ementa: 'recorre', autor: 'do Sr. Alexandre Padilha' },
  { ordem: 7, categoria: 'recurso', sigla: 'REC', numero: '19', ano: '2022', alvo: null, ementa: 'recorre', autor: '' },
]) + '\n```', lac);
ok(r.candidatos.length === 2 && !r.pendentes.length, 'resposta certa (com cerca de código) → 2 candidatos');
ok(r.candidatos.every(i => i.tipoCategoria === 'requerimento' && i.sigla === 'REC' && i.origemIA && !('projetoUrgenciado' in i)),
  'recurso → requerimento/REC, origemIA, sem "projeto da urgência" (convenção do parser)');
r = P.itensDaRespostaLacunas(resp([{ ordem: 6, categoria: 'recurso', sigla: 'REC', numero: '68', ano: '2019' }, { ordem: 7, categoria: 'recurso', sigla: 'REC', numero: '91', ano: '2022' }]), lac);
ok(r.candidatos.length === 1 && r.pendentes[0]?.ordem === 7 && /não está no texto/.test(r.pendentes[0].motivo), 'número inventado (91 em vez de 19) → pendência, não item');
ok(P.itensDaRespostaLacunas('desculpe, não consegui', lac).pendentes.length === 2, 'resposta ilegível → tudo pendente');
ok(P.itensDaRespostaLacunas(resp([{ ordem: 6, sigla: null }, { ordem: 7, sigla: 'XYZ', numero: '19', ano: '2022' }]), lac).pendentes.length === 2, 'item não achado / tipo desconhecido → pendente');

console.log('\n== número escrito no texto (kerning do PDF) ==');
ok(P.numeroNoTrecho('Projeto de Lei nº 2.334, de 2019', '2334', '2019'), '"2.334" casa 2334');
ok(P.numeroNoTrecho('nº 2 .334, de 2 0 1 9', '2334', '2019'), 'dígitos separados pelo kerning');
ok(!P.numeroNoTrecho('nº 12.334, de 2019', '2334', '2019'), '"12.334" NÃO casa 2334');
ok(!P.numeroNoTrecho('nº 68, de 2018', '68', '2019'), 'ano diferente não casa');

console.log('\n== orquestração: confirmação na Câmara e IA fora ==');
(async () => {
  const ia = () => async () => resp([{ ordem: 6, categoria: 'recurso', sigla: 'REC', numero: '68', ano: '2019' }, { ordem: 7, categoria: 'recurso', sigla: 'REC', numero: '19', ano: '2022' }]);
  let o = await P.recuperarLacunasPauta(lac, { chamarIA: ia(), confirmar: async ref => ref.numero === '68' });
  ok(o.recuperados.map(i => i.ordem).join() === '6' && o.pendentes[0]?.ordem === 7 && o.pendentes[0].noTexto === true,
    'Câmara não confirma o 7 → pendente (com noTexto: a leitura bateu com o texto)');
  o = await P.recuperarLacunasPauta(lac, { chamarIA: async () => { throw new Error('HTTP 503'); }, confirmar: async () => true });
  ok(!o.recuperados.length && o.pendentes.length === 2 && /IA indisponível/.test(o.pendentes[0].motivo), 'IA fora do ar → pendências, nada some');
  o = await P.recuperarLacunasPauta({ faltando: [], trechos: {} }, { chamarIA: async () => { throw new Error('não deveria chamar'); }, confirmar: async () => true });
  ok(!o.recuperados.length && !o.pendentes.length, 'sem lacuna → nenhuma chamada de IA');

  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log('\nTudo passou.');
})();
