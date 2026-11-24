// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Bot: resposta do /faltamvotar (bot/src/faltamvotar.js).
//
// Pedido de 24/11/2026: a resposta lista numa só seção "🔴 Não votaram (N)" quem da bancada ainda não votou —
// antes saía "✅ Todos os presentes da bancada já votaram." seguido de "⚫ Fora da Casa (N)" com esses nomes.
// O motivo: no painel (infoleg ws-plenario/votacao/{id}), o deputado só aparece como presente (indPresente)
// DEPOIS de votar — medido em 23/11/2026, na votação 14017, de 12 em 12 segundos, nenhum "presente sem voto" —,
// então quem faltava ia para "Fora da Casa" e o resumo dizia que os presentes já tinham votado.
//
// Fixture: testes/fixtures/faltamvotar/painel-14017-2257.json — o painel real às 22:57:47 (bancada do Podemos,
// 15 de 27 votos; os 12 que faltavam são os do print do bot naquele instante), com 6 deputados de outros partidos.
// Uso: node testes/bot-faltamvotar.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const { faltamVotar, formatarFaltantes } = require(path.join(RAIZ, 'bot', 'src', 'faltamvotar.js'));
const PAINEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faltamvotar', 'painel-14017-2257.json'), 'utf8'));
const SESSAO = { sessaoAtual: { numSessao: 184, nomSessao: 'EXTRAORDINÁRIA Nº 184 - 23/11/2026' },
  votacaoAtual: { tipo: 'Votacao', idVotacao: 14017, tituloVotacao: 'PLP  Nº 299/2026 - DTQ 1 - FDR PSOL-REDE', tipoVotacao: 'E' } };
const resp = corpo => ({ ok: true, status: 200, text: async () => JSON.stringify(corpo) });

(async () => {
  console.log('== 1. o painel real das 22:57:47 ==');
  global.fetch = async u => (/sessao-atual/.test(u) ? resp(SESSAO) : /ws-plenario\/votacao\/14017$/.test(u) ? resp(PAINEL) : { ok: false, status: 404, text: async () => '' });
  const r = await faltamVotar('PODE');
  const txt = formatarFaltantes(r);
  const esperado = ['Bruno Ganem (SP)', 'Cristiane Lopes (RO)', 'David Soares (SP)', 'Delegado Bruno Lima (SP)', 'Dra. Alessandra Haber (PA)',
    'Felipe Francischini (PR)', 'Fábio Macedo (MA)', 'Gilson Daniel (ES)', 'Luiz Carlos Hauly (PR)', 'Rafael Fera (RO)', 'Sargento Portugal (RJ)', 'Tiago Dimas (TO)'];
  ok(r.aberta && r.total === 27 && r.votaram === 15, 'bancada de 27, 15 já votaram (só a bancada do Podemos, os outros partidos ficam de fora)');
  ok(JSON.stringify(r.naoVotaram) === JSON.stringify(esperado), 'os 12 que não votaram, em ordem alfabética — os mesmos do print do bot');
  ok(txt === `🗳 *PLP Nº 299/2026* — bancada PODE (15/27 já votaram)\n\n🔴 Não votaram (12):\n${esperado.map(n => `• ${n}`).join('\n')}`,
    'resposta no formato pedido: cabeçalho e "🔴 Não votaram (12):" com um nome por linha');
  ok(!/Fora da Casa|presentes/i.test(txt), 'sem "Fora da Casa" e sem "Todos os presentes já votaram"');

  console.log('\n== 2. o exemplo do pedido e a bancada completa ==');
  const ex = { aberta: true, prop: 'PLP Nº 299/2026', total: 27, votaram: 25, naoVotaram: ['Felipe Becari (SP)', 'Marangoni (SP)'], presentesNaoVotaram: [], foraDaCasa: ['Felipe Becari (SP)', 'Marangoni (SP)'] };
  ok(formatarFaltantes(ex) === '🗳 *PLP Nº 299/2026* — bancada PODE (25/27 já votaram)\n\n🔴 Não votaram (2):\n• Felipe Becari (SP)\n• Marangoni (SP)', 'exemplo do pedido (25/27, Felipe Becari e Marangoni): sai exatamente como pedido');
  ok(formatarFaltantes({ ...ex, votaram: 27, naoVotaram: [] }) === '🗳 *PLP Nº 299/2026* — bancada PODE (27/27 já votaram)\n\n✅ Toda a bancada já votou.', 'todos votaram: "✅ Toda a bancada já votou."');
  ok(formatarFaltantes({ aberta: false, motivo: 'não há votação em curso' }) === 'Sem lista de faltantes agora — não há votação em curso.', 'sem votação nominal: a mensagem de antes, sem mudança');

  console.log('\n== 3. pergunta em texto livre: a mesma mensagem do /faltamvotar (24/11/2026, PL 1969/2022) ==');
  // Pelo agente, a lista ia para o modelo, que reescrevia ("Atualmente, 25 parlamentares… ainda não registraram")
  // e cortava o "(2/27 já votaram)": a lista de 25 parecia a bancada inteira. Fixture: painel real da votação 14025,
  // com a bancada no instante da pergunta (só Delegado Palumbo e Dra. Alessandra Haber tinham voto, às 17:30).
  const P2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faltamvotar', 'painel-14025-reconstruido.json'), 'utf8'));
  const S2 = { sessaoAtual: { numSessao: 187, nomSessao: 'EXTRAORDINÁRIA Nº 187 - 24/11/2026' },
    votacaoAtual: { tipo: 'Votacao', idVotacao: 14025, tituloVotacao: 'PL   Nº 1969/2022 - SUBSTITUTIVO OFERECIDO PELO RELATOR', tipoVotacao: 'E' } };
  global.fetch = async u => (/sessao-atual/.test(u) ? resp(S2) : /ws-plenario\/votacao\/14025$/.test(u) ? resp(P2) : { ok: false, status: 404, text: async () => '' });
  const r2 = await faltamVotar('PODE');
  const t2 = formatarFaltantes(r2);
  ok(r2.total === 27 && r2.votaram === 2 && r2.naoVotaram.length === 25, 'bancada de 27: 2 votaram, 25 faltam');
  ok(t2.startsWith('🗳 *PL Nº 1969/2022* — bancada PODE (2/27 já votaram)\n\n🔴 Não votaram (25):\n• Antonio Carlos Rodrigues (SP)'), 'mensagem: "(2/27 já votaram)" no cabeçalho e "🔴 Não votaram (25)"');
  ok(!/Delegado Palumbo|Alessandra Haber/.test(t2), 'quem já votou não está na lista');
  const AG = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'agente.js'), 'utf8'), IX = fs.readFileSync(path.join(RAIZ, 'bot', 'index.js'), 'utf8');
  const acoes = AG.slice(AG.indexOf('const CATALOGO_ACOES'), AG.indexOf('`;', AG.indexOf('const CATALOGO_ACOES')));
  ok(/- "faltam_votar" \{\}:/.test(acoes) && /const ACOES = \[[^\]]*'faltam_votar'/.test(AG), 'agente: "faltam_votar" é AÇÃO (envia a lista pronta), não consulta que o modelo reescreve');
  ok((AG.match(/- "faltam_votar"/g) || []).length === 1 && !/faltam_votar: async/.test(IX), 'saiu das ferramentas de consulta');
  ok(/case 'faltam_votar':\s+return responderFaltantes\(ctx\);/.test(IX) && /async function cmdFaltamVotar[\s\S]*?return responderFaltantes\(ctx\);/.test(IX),
    'a ação e o /faltamvotar mandam a mesma mensagem (responderFaltantes)');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
