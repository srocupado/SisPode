// Vigência da base normativa de uma nota orçamentária (normas.js) e leitura
// das fontes da CMO (cmo.js).
//
// O CASO QUE ORIGINOU ISTO, medido em 02/09/2026. A nota da Coordenação sobre
// o PLOA 2023 (PL 32/2022) afirmava:
//
//   "É vedada a celebração de instrumentos com valor de repasse inferior a
//    R$ 100.000,00 … e … inferior a R$ 250.000,00 para execução de obras e
//    serviços de engenharia, com redação dada pelo Art. 9º, incisos IV e V, da
//    Portaria Interministerial nº 424 de 2016."
//
// O Manual de Emendas da LOA 2026 (CMO, 07/11/2025, p.18) diz outra coisa:
// os mínimos passaram a vir "da LDO e de ato do Executivo", com R$ 200.000,00
// para obras — não mais R$ 250.000,00 — e manda observar o art. 10 da
// LC nº 210/2024, que sequer existia em 2022. A Portaria 424/2016 continua
// citada no Manual (p.112), mas para transferências a entidades privadas sem
// fins lucrativos: mudou o número E mudou o fundamento.
//
// Reaproveitar a nota antiga, portanto, erraria duas vezes em silêncio. É esse
// silêncio que a conferência quebra.
//
// A fixture traz as páginas 8, 17-19 e 112-113 do Manual real (extraídas do PDF
// de 14 MB publicado pela CMO), para o teste rodar em milissegundos sem baixar
// o documento inteiro a cada execução.
//
// Uso: node testes/orcamento-normas.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const N = require(path.join(RAIZ, 'normas.js'));
const MANUAL_2026 = fs.readFileSync(path.join(__dirname, 'fixtures', 'manual-emendas-loa2026-trechos.txt'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// O parágrafo real da nota de 2022, verbatim.
const NOTA_2022 = `É vedada a celebração de instrumentos com valor de repasse inferior a
R$ 100.000,00 (cem mil reais) para a execução de despesas de custeio ou para aquisição
de equipamentos. E bem como, também é vedada a celebração de instrumentos com valor
de repasse inferior a R$ 250.000,00 (duzentos e cinquenta mil reais) para execução
de obras e serviços de engenharia, com redação dada pelo Art. 9º, incisos IV e V, da
Portaria Interministerial nº 424 de 2016. Em conformidade ao Art. 166, § 16º da CF/1988,
não será verificado o adimplemento dos entes federados beneficiários. O limite do
relator-geral observa o Art. 53, inciso IV, da Resolução 01/2006.`;

(async () => {
  console.log('== normas citadas num texto ==');
  {
    const n = N.extrairNormasCitadas('Observar art. 10 da LC nº 210/2024 e o Decreto nº 11.531, de 16/05/2023.');
    const r = n.map(x => x.rotulo).sort();
    ok(r.includes('Lei Complementar nº 210/2024'), `LC nº 210/2024 reconhecida (${r.join('; ')})`);
    ok(r.includes('Decreto nº 11.531/2023'), 'Decreto nº 11.531/2023 reconhecido');
    // O caso que estraga tudo: "Lei Complementar" contém "Lei".
    ok(!n.some(x => x.tipo === 'LEI' && x.numero === '210'),
       'LC 210/2024 NÃO é lida também como Lei 210/2024 (norma diferente)');

    const p = N.extrairNormasCitadas('Portaria Interministerial MP/MF/CGU nº 424, de 30/12/2016');
    ok(p.some(x => x.tipo === 'PORTARIA' && x.numero === '424' && x.ano === '2016'),
       `portaria com órgãos no meio do nome: ${p.find(x => x.tipo === 'PORTARIA')?.rotulo}`);

    const ec = N.extrairNormasCitadas('Incluído pela Emenda Constitucional nº 105, de 2019');
    ok(ec.some(x => x.tipo === 'EC' && x.numero === '105'), 'Emenda Constitucional nº 105');
    // "Projeto de Lei nº 32" não é citação de lei vigente — o mesmo cuidado do
    // validarReferencias do módulo de Plenário.
    ok(!N.extrairNormasCitadas('o Projeto de Lei nº 32/2022').some(x => x.tipo === 'LEI'),
       '"Projeto de Lei nº 32" não vira citação da Lei 32');
  }

  console.log('\n== valores monetários ==');
  {
    const v = N.extrairValores('mínimo de R$ 250.000,00 para obras e R$ 100.000,00 para custeio; R$ 5,12/US$');
    const brutos = v.map(x => x.bruto);
    ok(brutos.includes('250.000,00') && brutos.includes('100.000,00'), `valores: ${brutos.join(' | ')}`);
    ok(!brutos.includes('5,12'), 'cotação de câmbio (R$ 5,12) não entra como valor de repasse');
  }

  console.log('\n== A CONFERÊNCIA: nota de 2022 contra o Manual de 2026 ==');
  {
    const r = N.conferirContraFonte(NOTA_2022, MANUAL_2026, { rotuloFonte: 'Manual de Emendas da LOA 2026' });
    ok(r.conferido, 'a fonte foi lida (conferência realizada)');

    const naoConf = r.valores.naoConfirmados.map(v => v.bruto);
    ok(naoConf.includes('250.000,00'),
       `R$ 250.000,00 (obras) É ACUSADO: o Manual 2026 traz R$ 200.000,00 — ${naoConf.join(' | ') || 'nenhum'}`);
    ok(r.valores.confirmados.some(v => v.bruto === '100.000,00'),
       'R$ 100.000,00 (demais objetos) permanece e é confirmado');

    // A Portaria continua no Manual (p.112) — acusá-la seria falso positivo.
    // O que mudou foi o PAPEL dela, não a existência; por isso a conferência
    // de norma não pode prometer mais do que "consta / não consta".
    ok(r.normas.confirmadas.some(n => n.tipo === 'PORTARIA' && n.numero === '424'),
       'Portaria 424/2016 é confirmada — ela SEGUE citada no Manual 2026');
    ok(r.normas.naoConfirmadas.some(n => n.numero === '01' || n.numero === '1'),
       `Resolução 01/2006 é acusada (não consta nos trechos do Manual 2026): ${r.normas.naoConfirmadas.map(n => n.rotulo).join(' | ')}`);

    const resumo = N.resumoConferencia(r);
    ok(resumo.some(l => /250\.000,00/.test(l) && /Confirme/.test(l)),
       `o alerta é acionável: "${resumo.find(l => /250\.000/.test(l))}"`);
  }

  console.log('\n== o que a conferência NÃO pode fazer ==');
  {
    const semFonte = N.conferirContraFonte(NOTA_2022, '');
    ok(!semFonte.conferido && !semFonte.alertas.length,
       'fonte ausente → NÃO acusa divergência (não se declara erro sem ter lido a fonte)');
    ok(/indispon[íi]vel|ileg[íi]vel/i.test(N.resumoConferencia(semFonte)[0]),
       `e diz que não conferiu: "${N.resumoConferencia(semFonte)[0]}"`);

    const igual = N.conferirContraFonte('Observar o art. 10 da LC nº 210/2024.', MANUAL_2026, { rotuloFonte: 'Manual de Emendas da LOA 2026' });
    ok(igual.conferido && !igual.alertas.length, 'nota alinhada ao Manual não gera alerta nenhum');
    ok(/✓/.test(N.resumoConferencia(igual)[0]), `e o resumo confirma: "${N.resumoConferencia(igual)[0]}"`);
  }

  console.log('\n== comparação entre exercícios ==');
  {
    const c = N.compararExercicios(NOTA_2022 + ' '.repeat(500), MANUAL_2026, { rotuloAnterior: 'nota do PLOA 2023', rotuloAtual: 'Manual da LOA 2026' });
    ok(c.comparado, 'comparação realizada');
    ok(c.entraram.some(n => n.tipo === 'LC' && n.numero === '210'),
       `LC 210/2024 aparece como NOVA em relação a 2022: ${c.entraram.slice(0, 4).map(n => n.rotulo).join(' | ')}`);
    ok(c.permaneceram.some(n => n.numero === '424'), 'Portaria 424/2016 permanece nos dois');
    const curto = N.compararExercicios('x', MANUAL_2026);
    ok(!curto.comparado && /não pôde ser lido/.test(curto.motivo), 'documento ilegível → comparação declarada como não realizada');
  }

  console.log('\n== fixture: o Manual real diz o que o teste afirma ==');
  {
    ok(/R\$\s*200\.000,00/.test(MANUAL_2026), 'o Manual 2026 traz R$ 200.000,00 para obras');
    ok(!/R\$\s*250\.000,00/.test(MANUAL_2026), 'e NÃO traz mais os R$ 250.000,00 da nota de 2022');
    ok(/LC\s*n[º°o]?\s*210\/2024/i.test(MANUAL_2026), 'e manda observar a LC 210/2024');
    ok(/Portaria Interministerial/i.test(MANUAL_2026), 'a Portaria Interministerial segue citada (outro contexto)');
    ok(/Deputados:\s*R\$\s*40\.252\.007,00/.test(MANUAL_2026.replace(/\s+/g, ' ')),
       'e a cota individual da LOA 2026 está lá (Deputados: R$ 40.252.007,00)');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
