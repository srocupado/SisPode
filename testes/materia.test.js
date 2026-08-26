// Testes do /materia (bot) — a ficha avulsa no formato da Reunião de Líderes.
//
// PORTE AUTÔNOMO de lideres.js por decisão de projeto: os módulos não
// compartilham código, então cada um tem o próprio teste. A camada factual
// roda contra a API real; o resumo por IA só roda com GEMINI_API_KEY no
// ambiente.
//
// Uso: node testes/materia.test.js
const path = require("path");
const M = require(path.join(__dirname, '..', 'bot', 'src', 'materia.js'));
let falhas=0;
const ok=(c,m)=>{ if(!c){falhas++;console.log('  ✗ '+m);} else console.log('  ✓ '+m); };
(async()=>{
  console.log('== parseReferencia ==');
  ok(M.parseReferencia('PL 1234/2026').chave==='PL 1234/2026','forma canônica');
  ok(M.parseReferencia('plp230/25').chave==='PLP 230/2025','minúscula, sem espaço, ano curto');
  ok(M.parseReferencia('a PEC 231 2019 por favor').chave==='PEC 231/2019','no meio de frase, com espaço');
  ok(M.parseReferencia('bom dia')===null,'texto sem referência → null');

  console.log('\n== ficha factual (API real, sem chave de IA) ==');
  const t0=Date.now();
  const f1 = await M.montarFicha('PLP 230/2025');
  console.log(`  (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  ok(f1.situacao==='Urgência aprovada (REQ. 2708/2026)',`situação: ${f1.situacao}`);
  ok(f1.relatoria==='Dep. Maria Rosas (Republicanos-SP)',`relatoria: ${f1.relatoria}`);
  ok(/Sem apensação\./.test(f1.apensacao),`apensação: ${f1.apensacao.replace(/\n/g,' | ')}`);
  // Era um RETRATO: exigia cenário 3 ou 1. Em 12/08/2026 a relatora proferiu
  // parecer em Plenário NA FORMA DO SUBSTITUTIVO e a matéria virou cenário 4 —
  // leitura correta, teste quebrado sem uma linha de código mudar. Agora o que
  // se cobra é a REGRA: o cenário tem de ser conhecido e tem de CONFERIR com
  // os documentos que a própria ficha encontrou.
  ok(!!f1.cenarioNome, `cenário conhecido: ${f1.cenario} — ${f1.cenarioNome}`);
  const temParecerPlen = !!f1.parecerPlen;
  const comSubstitutivo = /substitutivo adotado/i.test(f1.parecer || '');
  const esperadoPeloDoc = !temParecerPlen ? null : (comSubstitutivo ? 4 : 3);
  ok(esperadoPeloDoc === null || f1.cenario === esperadoPeloDoc,
     `cenário confere com os documentos: parecer de plenário ${temParecerPlen ? 'sim' : 'não'}`
     + `, substitutivo ${comSubstitutivo ? 'sim' : 'não'} → esperado ${esperadoPeloDoc}, obtido ${f1.cenario}`);
  const fatos=M.formatarFatos(f1);
  ok(fatos.includes('📋 *PLP 230/2025*') && fatos.includes('fichadetramitacao'),'fatos formatados com link');
  ok(fatos.length<3800,`tamanho telegram ok (${fatos.length})`);

  const f2 = await M.montarFicha('PL 101/2026');
  ok(/Apensado ao PL 23\/2026/.test(f2.apensacao),`apensado: ${f2.apensacao.split('\n')[0]}`);
  ok(/REQ 1258\/2026 refere-se a este projeto \(o apensado\)/.test(f2.apensacao),
     `urgência do apensado: ${f2.apensacao.split('\n')[1]||''}`);

  const f3 = await M.montarFicha('PL 6003/2019');
  ok(f3.cenario===7,`PL 6003/2019 → cenário 7 (obtido: ${f3.cenario})`);
  ok(/Emenda\/Substitutivo do Senado recebido em 12\/11\/2019/.test(f3.senado),`senado: ${f3.senado.slice(0,60)}…`);

  console.log(falhas?`\n${falhas} FALHA(S)`:'\nFactual: tudo passou.');

  if(process.env.GEMINI_API_KEY){
    console.log('\n== resumo por IA (chave real) ==');
    const t1=Date.now();
    const r=await M.resumirFicha(f3,{provedor:'gemini',apiKey:process.env.GEMINI_API_KEY,modelo:'gemini-flash-latest'});
    console.log(`  (${((Date.now()-t1)/1000).toFixed(1)}s · ${r.length} chars)\n`);
    console.log(r);
  }
  process.exit(falhas?1:0);
})().catch(e=>{console.error('FALHOU:',e);process.exit(1)});
