// Aviso de tribuna FORA DE CONTEXTO (13/08/2026): a varredura de oradores
// atrasou e o aviso "🎙 Na tribuna: ... — Discussão PL 1842/2025" caiu no meio
// da apreciação do PL 5415/2005. Quem lê o grupo associa o orador ao item
// errado — pior que não avisar.
//
// Regra: aviso de lista ligada a uma matéria só sai enquanto ESSA matéria
// estiver em apreciação; o atrasado é descartado (e registrado, para não
// ressurgir). Listas gerais (Breves, Liderança) não têm matéria e seguem.
//
// Uso: node testes/oradores-contexto.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'src', 'monitor.js'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// materiaDaLista isolada do monitor (sem subir o bot inteiro).
const materiaDaLista = new Function(
  src.match(/function materiaDaLista[\s\S]*?\n}/)[0] + '; return materiaDaLista;')();

// A régua aplicada pelo checarOradores, extraída para teste direto.
// 'avisa' | 'descarta' (não volta) | 'adia' (tenta de novo no próximo tick)
const decidir = (rotulo, emAnalise) => {
  const da = materiaDaLista(rotulo);
  if (da && emAnalise?.size && !emAnalise.has(da)) return 'descarta';
  if (da && emAnalise && !emAnalise.size) return 'adia';
  return 'avisa';
};
const deveAvisar = (r, e) => decidir(r, e) === 'avisa';

(async () => {
  console.log('== matéria da lista ==');
  ok(materiaDaLista('Discussão PL 1842/2025') === 'PL-1842-2025', 'lê a matéria do rótulo');
  ok(materiaDaLista('Encaminhamento PLP 230/2025 · ') === 'PLP-230-2025', 'aceita outros tipos e sufixos');
  ok(materiaDaLista('Discussão PL 5.415/2005') === 'PL-5415-2005', 'tira o separador de milhar');
  ok(materiaDaLista('Breves Comunicações da Sessão 150') === null, 'lista geral não tem matéria');
  ok(materiaDaLista('Comunicações de Liderança') === null, 'liderança não tem matéria');

  console.log('\n== o caso real de 13/08/2026 ==');
  {
    const emAnalise = new Set(['PL-5415-2005']);          // o que estava em apreciação
    ok(deveAvisar('Discussão PL 5415/2005', emAnalise), 'orador do item da vez é avisado');
    ok(!deveAvisar('Discussão PL 1842/2025', emAnalise),
       'aviso atrasado de OUTRO projeto é descartado (o bug relatado)');
    ok(deveAvisar('Breves Comunicações da Sessão 150', emAnalise),
       'lista geral não é calada pela régua');
  }

  console.log('\n== sem saber o que está em apreciação, não cala ==');
  {
    ok(deveAvisar('Discussão PL 1842/2025', null),
       'página do evento ainda não lida → avisa (não inventa silêncio)');
    ok(decidir('Discussão PL 1842/2025', new Set()) === 'adia',
       'nada em análise → ADIA (não cala para sempre um orador do item que vai abrir)');
    ok(decidir('Discussão PL 1842/2025', new Set(['PL-5415-2005'])) === 'descarta',
       'outro item em apreciação → DESCARTA de vez');
  }

  console.log('\n== mais de uma matéria em análise ==');
  {
    const emAnalise = new Set(['PL-5415-2005', 'PL-1842-2025']);
    ok(deveAvisar('Discussão PL 1842/2025', emAnalise), 'qualquer uma das que estão em análise passa');
    ok(!deveAvisar('Discussão PL 241/2023', emAnalise), 'a que não está, não passa');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
