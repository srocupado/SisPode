// Acervo de regressão das pautas de Plenário: o texto REAL de cada pauta que
// já deu problema, como a extensão o extrai do PDF, com o resultado esperado.
//
// O vínculo requerimento → projeto da urgência quebrou cinco vezes em dois
// meses (12/08, 13/08, 01/09, 15/09 e 13/10/2026), cada vez por uma grafia
// nova da Câmara. Cada incidente entra aqui como um par de arquivos em
// testes/pautas/: o texto (.txt) e o esperado (.json) — e passa a ser
// conferido para sempre. Para acrescentar uma pauta: extraia o texto com
// extrairTextoPdf (pauta-parser.js), salve como AAAA-MM-DD-plenario.txt e
// escreva o .json com os itens, os vínculos e (se houver) as ementas dos REQs.
//
// Confere também a segunda fonte do vínculo: o projeto tirado da ementa do
// próprio requerimento nos Dados Abertos (detectarProjetoUrgenciado), e a
// regra que decide entre as fontes (decidirVinculo).
//
// Uso: node testes/pautas-acervo.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const P = require(path.join(RAIZ, 'pauta-parser.js'));
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const A = new Function('TIPOS_PROPOSICAO', 'limpaNumero', `
  ${trecho(/function detectarProjetoUrgenciado\([\s\S]*?\n}/)}
  ${trecho(/const mesmoAlvo = [\s\S]*?;\n/)}
  ${trecho(/function decidirVinculo\([\s\S]*?\n}/)}
  return { detectarProjetoUrgenciado, decidirVinculo, mesmoAlvo };
`)(P.TIPOS_PROPOSICAO, P.limpaNumero);

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const chave = a => (a ? `${a.sigla}-${a.numero}-${a.ano}` : '(nenhum)');

const DIR = path.join(__dirname, 'pautas');
const casos = fs.readdirSync(DIR).filter(f => f.endsWith('.txt')).sort();
ok(casos.length > 0, `acervo com ${casos.length} pauta(s)`);

for (const arq of casos) {
  const esp = JSON.parse(fs.readFileSync(path.join(DIR, arq.replace(/\.txt$/, '.json')), 'utf8'));
  console.log(`\n== ${arq} ==`);
  const r = P.parsearPauta(fs.readFileSync(path.join(DIR, arq), 'utf8'));
  ok(r.itens.length === esp.itens, `${esp.itens} itens (obtidos: ${r.itens.length})`);
  const reqs = r.itens.filter(i => i.tipoCategoria === 'requerimento');
  for (const [req, alvo] of Object.entries(esp.vinculos || {})) {
    const it = reqs.find(i => `${i.sigla}-${i.numero}-${i.ano}` === req);
    ok(it && chave(it.projetoUrgenciado) === alvo, `PDF: ${req} → ${alvo} (obtido: ${it ? chave(it.projetoUrgenciado) : 'REQ não encontrado'})`);
  }
  const projs = r.itens.filter(i => i.tipoCategoria !== 'requerimento').map(i => `${i.sigla}-${i.numero}-${i.ano}`);
  for (const p of esp.projetos || []) ok(projs.includes(p), `projeto ${p} na pauta`);
  // 2ª fonte: a ementa do requerimento nos Dados Abertos nomeia o projeto.
  for (const [req, ementa] of Object.entries(esp.ementasReq || {})) {
    const a = A.detectarProjetoUrgenciado(ementa);
    ok(chave(a) === esp.vinculos[req], `ficha do ${req}: ementa → ${esp.vinculos[req]} (obtido: ${chave(a)})`);
  }
}

console.log('\n== decidirVinculo: prioridade e divergência ==');
const pl = (n, a = '2026') => ({ sigla: 'PL', numero: String(n), ano: a });
let d = A.decidirVinculo({ evento: null, ficha: pl(1381), pdf: null });
ok(d.fonte === 'ficha' && A.mesmoAlvo(d.alvo, pl(1381)) && !d.divergencia.length, 'PDF sem vínculo (o caso de 13/10): a ficha do REQ resolve, sem alarme');
d = A.decidirVinculo({ evento: pl(5538), ficha: pl(5538), pdf: pl(5538, '2019') });
ok(d.fonte === 'evento' && d.divergencia.length === 1 && d.divergencia[0].fonte === 'pdf', 'PDF lendo outro ano: prevalece a pauta da sessão e o PDF vira divergência visível');
d = A.decidirVinculo({ manual: pl(1), evento: pl(2), ficha: pl(2), pdf: null });
ok(d.fonte === 'manual' && A.mesmoAlvo(d.alvo, pl(1)) && d.divergencia.length === 2, 'vínculo manual vale sobre as fontes, e a discordância delas fica registrada');
d = A.decidirVinculo({ evento: null, ficha: null, pdf: null });
ok(d.alvo === null && d.fonte === null, 'nenhuma fonte → sem vínculo (vira aviso na tela, não silêncio)');
d = A.decidirVinculo({ evento: null, ficha: { sigla: 'PL', numero: 888, ano: 2025 }, pdf: pl(888, '2025') });
ok(!d.divergencia.length, 'número como número ou texto não conta como divergência');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
