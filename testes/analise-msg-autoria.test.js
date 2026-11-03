// Análise de Pauta · mensagem "Itens do Podemos na Pauta" (WhatsApp): o
// deputado do Podemos é AUTOR só quando é o 1º signatário; do 2º em diante,
// COAUTOR — o mesmo critério do badge. Caso real: PL 2475/2025 em 03/11/2026.
// Uso: node testes/analise-msg-autoria.test.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const F = new Function(`
  ${trecho(/function autoresPodemosPorPapel\([\s\S]*?\n}/)}
  ${trecho(/function linhasAutoriaPodemos\([\s\S]*?\n}/)}
  ${trecho(/function autoriaMsg\([\s\S]*?\n}/)}
  ${trecho(/function autoriaApensadoMsg\([\s\S]*?\n}/)}
  return { autoriaMsg, autoriaApensadoMsg };
`)();
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const aut = (nome, ordem, pode) => ({ nome, ordem, isPodemos: !!pode });

// PL 2475/2025 — autores e ordem de assinatura na API da Câmara (03/11/2026)
const pl2475 = [aut('Célio Studart', 1), aut('Delegado Bruno Lima', 6, 1), aut('Dr. Ismael Alexandrino', 2), aut('Felipe Becari', 4, 1), aut('Laura Carneiro', 3), aut('Marcelo Queiroz', 5)];
let l = F.autoriaMsg({ enriquecimento: { autoriaPodemos: true, autores: pl2475 } });
ok(l.join(' | ') === 'Coautoria: Felipe Becari, Delegado Bruno Lima', `PL 2475/2025: os dois são coautores, na ordem de assinatura (obtido: ${l.join(' | ')})`);
l = F.autoriaMsg({ enriquecimento: { autoriaPodemos: true, autores: [aut('Fulano', 1, 1), aut('Outro', 2), aut('Beltrano', 3, 1)] } });
ok(l.join(' | ') === 'Autoria: Fulano | Coautoria: Beltrano', '1º signatário do Podemos é autor; os outros do Podemos, coautores');
l = F.autoriaMsg({ enriquecimento: { autoriaPodemos: true, autores: [aut('Fulano', undefined, 1), aut('Beltrano', undefined, 1)] } });
ok(l.join(' | ') === 'Autoria: Fulano, Beltrano', 'dados antigos sem a ordem: todos como autor (como o badge)');
l = F.autoriaMsg({ autorTexto: 'Sr. Ciclano (PL-SP)', enriquecimento: { autoriaPodemos: false, autores: [aut('Ciclano', 1)] } });
ok(l.join(' | ') === 'Autoria: Sr. Ciclano (PL-SP)', 'item do Podemos por relatoria: a autoria da pauta, como antes');
l = F.autoriaApensadoMsg({ autores: [aut('Autor de fora', 1), aut('Fulana', 2, 1)] });
ok(l.join(' | ') === 'Coautoria: Fulana', 'apensado: a mesma regra');
ok(/for \(const l of autoriaMsg\(it\)\) linhas\.push\(b\(l\)\);/.test(src), 'a mensagem usa as linhas de autoria (sem "Autoria:" fixo)');
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
