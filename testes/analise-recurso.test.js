// Recurso contra apreciação conclusiva: o voto do último parecer aprovado da
// CCJC decide o documento da nota (analise.js, apurarRecurso/votoCCJC).
// Conclusões reais da pauta de 03/11/2026 e variações frequentes da CCJC.
// Uso: node testes/analise-recurso.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = (re, txt = src) => { const m = txt.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
// semAcento é global na página (pauta-parser.js), não exportada
const semAcento = new Function(`${trecho(/function semAcento\([\s\S]*?\n}/, fs.readFileSync(path.join(RAIZ, 'pauta-parser.js'), 'utf8'))}; return semAcento;`)();
const F = new Function('semAcento', `
  ${trecho(/function conclusaoParecerComissao\([\s\S]*?\n}/)}
  ${trecho(/function votoCCJC\([\s\S]*?\n}/)}
  ${trecho(/function rotuloVotoCCJC\([\s\S]*?\n}/)}
  return { conclusaoParecerComissao, votoCCJC, rotuloVotoCCJC };
`)(semAcento);

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const COM = [
  { sigla: 'CCJC', nome: 'Comissão de Constituição e Justiça e de Cidadania' },
  { sigla: 'CTASP', nome: 'Comissão de Trabalho, de Administração e Serviço Público' },
  { sigla: 'CDEICS', nome: 'Comissão de Desenvolvimento Econômico, Indústria, Comércio e Serviços' },
];
const PAR = c => `III - PARECER DA COMISSÃO A Comissão de Constituição e Justiça e de Cidadania, em reunião ordinária realizada hoje, ${c}, nos termos do Parecer do Relator, Deputado Fulano. Estiveram presentes os Senhores Deputados: …`;

console.log('== pautas reais de 03/11/2026 ==');
// REC 68/2019 → PL 2.334/2019: PAR 1 CCJC (26/11/2019), em HTML
let v = F.votoCCJC(`PROJETO DE LEI Nº 2.334, DE 2019 III - PARECER DA COMISSÃO A Comissão de Constituição e Justiça e de Cidadania, em reunião ordinária realizada hoje, opinou pela constitucionalidade, juridicidade e técnica legislativa do Projeto de Lei nº 2.334/2019, nos termos do Parecer do Relator, Deputado Felipe Francischini. Estiveram presentes os Senhores Deputados: Felipe Francischini - Presidente`, COM);
ok(v.tipo === 'cjtl' && /^opinou pela constitucionalidade/.test(v.conclusao) && !/Estiveram/.test(v.conclusao), 'PL 2.334/2019: só constitucionalidade, juridicidade e técnica legislativa → inteiro teor');
// REC 19/2022 → PL 3.083/2019: PAR 1 CCJC (12/07/2022), PDF (quebras de linha da extração)
v = F.votoCCJC(`III - PARECER DA COMISSÃO\n\nA Comissão de Constituição e Justiça e de Cidadania, em reunião\nextraordinária realizada hoje, mediante votação ocorrida por processo simbólico,\nconcluiu pela constitucionalidade, juridicidade, técnica legislativa e, no mérito, pela\naprovação do Projeto de Lei nº 3.083/2019, na forma do Substitutivo da Comissão de\nTrabalho, de Administração e Serviço Público, nos termos do Parecer do Relator,\nDeputado Luizão Goulart.`, COM);
ok(v.tipo === 'substitutivo' && v.comissao === 'CTASP', `PL 3.083/2019: mérito na forma do Substitutivo da CTASP → SBT-A da CTASP (obtido: ${v.tipo} ${v.comissao})`);
ok(F.rotuloVotoCCJC({ voto: v }) === 'na forma do Substitutivo da CTASP', 'rótulo do card');

console.log('\n== variações ==');
v = F.votoCCJC(PAR('opinou pela constitucionalidade, juridicidade e técnica legislativa do Projeto de Lei nº 1/2020 e do Substitutivo da Comissão de Desenvolvimento Econômico, Indústria, Comércio e Serviços'), COM);
ok(v.tipo === 'substitutivo' && v.comissao === 'CDEICS', 'só CJTL, mas "do PL e do Substitutivo da Comissão X" → o substitutivo de X (decisão de 03/11/2026)');
v = F.votoCCJC(PAR('opinou pela constitucionalidade, juridicidade e técnica legislativa e, no mérito, pela aprovação do Projeto de Lei nº 1/2020, com Substitutivo'), COM);
ok(v.tipo === 'substitutivo' && v.comissao === 'CCJC', 'substitutivo da própria CCJC (sem comissão citada) → SBT-A da CCJC');
v = F.votoCCJC(PAR('opinou pela constitucionalidade, juridicidade e técnica legislativa do Projeto de Lei nº 1/2020 e das Emendas da CDEICS'), COM);
ok(v.tipo === 'emendas' && v.comissao === 'CDEICS', 'emendas de outra comissão, pela sigla → o parecer dela');
v = F.votoCCJC(PAR('opinou pela constitucionalidade, juridicidade e técnica legislativa, com emenda, do Projeto de Lei nº 1/2020'), COM);
ok(v.tipo === 'emendas' && v.comissao === 'CCJC', 'emenda da própria CCJC → o parecer da CCJC (que já vai junto)');
v = F.votoCCJC(PAR('opinou unanimemente pela inconstitucionalidade e injuridicidade do Projeto de Lei nº 1/2020'), COM);
ok(v.tipo === 'contrario', 'inconstitucionalidade → contrário (inteiro teor + aviso)');
v = F.votoCCJC(PAR('opinou pela constitucionalidade, juridicidade e técnica legislativa e, no mérito, pela rejeição do Projeto de Lei nº 1/2020'), COM);
ok(v.tipo === 'contrario', 'mérito pela rejeição → contrário');
v = F.votoCCJC('Parecer de Comissão ao Projeto de Lei nº 3.083/2019.', COM);
ok(v.tipo === 'indefinido' && v.conclusao === '', 'texto sem a conclusão → indefinido (inteiro teor + aviso)');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
