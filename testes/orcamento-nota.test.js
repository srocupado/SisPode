// A nota técnica que o módulo produz (orcamento-notas.js), montada sobre o
// quadro REAL da matéria lida pelo cmo.js.
//
// O que se trava aqui é a regra que nasceu do protótipo de 02/09/2026 com o
// PLOA 2027 (PLN 24/2026, apresentado em 31/08 e ainda "AGUARDANDO DESPACHO"):
// a nota tem de ser útil no PRIMEIRO dia da tramitação, e para isso precisa
// DIZER o que ainda não existe. Naquele estágio não há cronograma, nem
// Relator-Geral, nem Manual de Emendas, nem cotas — e a nota valiosa é a que
// registra isso, não a que repete os números do exercício anterior.
//
// A armadilha que este teste existe para impedir: uma nota que, faltando o
// cronograma, simplesmente OMITA a linha do prazo de emendas. O gabinete leria
// a nota inteira sem perceber que o prazo não foi informado.
//
// Uso: node testes/orcamento-nota.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const { DOMParser } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
globalThis.DOMParser = DOMParser;
const C = require(path.join(RAIZ, 'cmo.js'));
const N = require(path.join(RAIZ, 'normas.js'));

const src = fs.readFileSync(path.join(RAIZ, 'orcamento-notas.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };

// Só as funções puras da tela (sem DOM): montagem da nota e utilitários.
const M = new Function('resumoConferencia', `
  ${trecho(/const esc = [^\n]+/)}
  ${trecho(/const dataBR = [^\n]+/)}
  ${trecho(/function dataDe\([\s\S]*?\n}/)}
  ${trecho(/function diasAte\([\s\S]*?\n}/)}
  ${trecho(/function anosDisponiveis\([\s\S]*?\n}/)}
  ${trecho(/function legislaturaDe\([\s\S]*?\n}/)}
  ${trecho(/function montarTextoNota\([\s\S]*?\n}/)}
  ${trecho(/function htmlNota\([\s\S]*?\n^}/m)}
  return { esc, dataBR, diasAte, anosDisponiveis, legislaturaDe, montarTextoNota, htmlNota };
`)(N.resumoConferencia);

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const semTags = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  console.log('== utilitários de data e legislatura ==');
  {
    ok(M.legislaturaDe(2026) === 57 && M.legislaturaDe(2023) === 57, '2023-2026 → 57ª Legislatura');
    ok(M.legislaturaDe(2027) === 58, '2027 → 58ª (a legislatura vira no ano da posse)');
    ok(M.dataBR('2026-08-31') === '31/08/2026', 'ISO → dd/mm/aaaa');
    // Date com string ISO puxa fuso e adianta/atrasa o dia; dataDe monta local.
    const d = M.diasAte('31/12/2099');
    ok(d > 20000, `data futura devolve dias positivos (${d})`);
    ok(M.diasAte('') === null, 'data vazia → null, sem NaN circulando pela tela');
    const anos = M.anosDisponiveis();
    ok(anos[0] === new Date().getFullYear() + 1, `o exercício seguinte vem primeiro (${anos[0]})`);
  }

  console.log('\n== nota do PLOA 2027 no estágio de hoje (fonte real) ==');
  {
    const q = await C.carregarExercicio('loa', 2027);
    ok(q.materia.disponivel, `quadro carregado: ${q.materia.identificacao} — ${q.materia.apelido}`);

    const html = M.htmlNota(q, null);
    const txt = semTags(html);

    ok(/NOTA TÉCNICA/.test(txt) && /Legislatura/.test(txt), 'cabeçalho no formato da casa');
    ok(/Coordenação de Orçamento da Liderança do Podemos/.test(txt), 'rodapé institucional');
    ok(txt.includes(q.materia.identificacao), `identifica a matéria (${q.materia.identificacao})`);
    ok(/Identificação da matéria/.test(txt), 'seção de identificação');

    // A REGRA CENTRAL: a linha do prazo de emendas existe SEMPRE. Havendo
    // cronograma, com as datas; não havendo, dizendo que não há.
    ok(/Prazo de emendas/.test(txt), 'a seção de prazo de emendas está presente');
    if (q.cronograma.disponivel && q.cronograma.prazoEmendas) {
      ok(txt.includes(q.cronograma.prazoEmendas.inicio), `com as datas reais (${q.cronograma.prazoEmendas.inicio} a ${q.cronograma.prazoEmendas.fim})`);
    } else {
      ok(/ainda não publicou o cronograma/i.test(txt), 'sem cronograma, a nota DIZ que não há prazo fixado');
      ok(/não se deduz do exercício anterior/i.test(txt),
         'e avisa que não se deduz do ano anterior — que é o erro que a nota de 2022 induziria');
    }

    // Pendências vêm do estado REAL das fontes, não de lista fixa.
    if (!q.relatores.relatorGeral) {
      ok(/Relator-Geral/.test(txt) && /Ainda não designado/i.test(txt), 'Relator-Geral não designado aparece como tal');
      ok(/O que ainda não está definido/i.test(txt), 'e há a seção de pendências');
    }
    if (!q.emendas.manual) {
      ok(/Manual de Emendas do exercício/i.test(txt), 'a falta do Manual de Emendas é registrada entre as pendências');
      ok(/cotas, quantidades, sequenciais de cancelamento e pisos de repasse/i.test(txt),
         'nomeando exatamente o que depende dele');
    }
    // O que NÃO pode acontecer: número de cota inventado ou herdado.
    ok(!/40\.252\.007|19\.704\.897|250\.000,00/.test(txt),
       'nenhuma cota ou piso de exercício anterior vaza para a nota');

    ok(/Estágio da tramitação/.test(txt) && q.acompanhamento.etapas.every(e => txt.includes(e.nome)),
       `as ${q.acompanhamento.etapas.length} etapas entram com o estado de cada uma`);
  }

  console.log('\n== nota de exercício encerrado (LOA 2026) ==');
  {
    const q = await C.carregarExercicio('loa', 2026);
    const txt = semTags(M.htmlNota(q, null));
    ok(/24\/10\/2025/.test(txt) && /14\/11\/2025/.test(txt), 'traz o prazo de emendas real do exercício');
    ok(!/ainda não publicou o cronograma/i.test(txt), 'e não fala em cronograma ausente');
    ok(/Manual de Emendas/i.test(txt), 'aponta o Manual de Emendas como base normativa');
    if (q.materia.normaGerada) ok(txt.includes(q.materia.normaGerada), `registra a norma gerada (${q.materia.normaGerada})`);
  }

  console.log('\n== a conferência normativa entra na nota ==');
  {
    const q = await C.carregarExercicio('loa', 2026);
    const manual = fs.readFileSync(path.join(__dirname, 'fixtures', 'manual-emendas-loa2026-trechos.txt'), 'utf8');
    const notaAntiga = 'valor de repasse inferior a R$ 250.000,00 para obras, pela Portaria Interministerial nº 424 de 2016';
    const resultado = N.conferirContraFonte(notaAntiga, manual, { rotuloFonte: 'Manual de Emendas da LOA 2026' });
    const txt = semTags(M.htmlNota(q, { rotuloFonte: 'Manual de Emendas da LOA 2026', resultado }));
    ok(/Conferência automática contra o Manual/.test(txt), 'o bloco de conferência entra na nota');
    ok(/250\.000,00/.test(txt) && /Confirme antes de divulgar/.test(txt),
       'com o alerta do valor que não consta mais do Manual');
    ok(/constar não significa que o dispositivo siga aplicável/i.test(txt),
       'e com a ressalva do que a conferência NÃO prova');
  }

  console.log('\n== nota da LDO: relatoria que o portal não publica ==');
  {
    // A LDO não tem página de relatores. A primeira versão de htmlNota lia
    // r.setoriais.length sem guarda e QUEBRAVA ao gerar a nota do PLDO 2027.
    // Pior que quebrar seria o que vinha antes na lógica: tratar a ausência da
    // página como "relatoria não designada", inventando um atraso da CMO.
    const q = await C.carregarExercicio('ldo', 2027);
    const html = M.htmlNota(q, null);
    const txt = semTags(html);
    ok(txt.length > 500, `a nota da LDO é gerada sem quebrar (${txt.length} chars)`);
    ok(txt.includes(q.materia.identificacao) && /PLDO 2027/.test(txt), `identifica ${q.materia.identificacao} — PLDO 2027`);
    if (!q.relatores.disponivel) {
      ok(/não publica página de relatores/i.test(txt), 'diz que o portal não publica a relatoria desta lei');
      ok(!/designação do Relator-Geral/i.test(txt),
         'e NÃO lista "designação do Relator-Geral" como pendência da CMO — o atraso não existe');
    }
    ok(/Prazo de emendas/.test(txt), 'a seção de prazo continua presente');
    ok(q.acompanhamento.etapas.every(e => txt.includes(e.nome)),
       `as ${q.acompanhamento.etapas.length} etapas próprias da LDO entram na nota`);
  }

  console.log('\n== texto corrido usado pela conferência ==');
  {
    const q = await C.carregarExercicio('loa', 2027);
    const t = M.montarTextoNota(q);
    ok(t.includes(q.materia.apelido), 'traz o apelido da matéria');
    ok(/Prazo de apresentação de emendas/i.test(t), 'e sempre menciona o prazo (existindo ou não)');
    ok(t.length > 120, `texto com substância (${t.length} chars)`);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
