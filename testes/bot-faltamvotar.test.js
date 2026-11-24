// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Bot: /faltamvotar e a ferramenta "faltam_votar" do agente (23/11/2026, nominal do PLP 299/2026).
//
// O bug: com a votação 14016 ABERTA e a bancada toda já tendo votado, a saída "(27/27 já votaram) ✅ Todos
// os presentes da bancada já votaram." virou, na resposta do agente, "A votação nominal foi encerrada".
// Junto: o cosev-api-prod respondeu 403 ao User-Agent padrão do Node no ambiente de desenvolvimento, e
// falha de consulta era dita "não há sessão aberta" — as duas coisas levariam ao mesmo erro.
//
// O que este teste trava:
//   1. toda consulta ao cosev e ao infoleg vai com User-Agent próprio (nunca o padrão "node");
//   2. falha na consulta ≠ "sem sessão": a resposta diz que falhou e que isso não significa votação fechada;
//   3. sem sessão de fato, continua "não há sessão aberta";
//   4. votação já fechada no painel (dataFimVotacao) é dita encerrada — não lista "já votaram" como em curso;
//   5. votação aberta: "EM CURSO", presentes que não votaram × fora da Casa.
// Uso: node testes/bot-faltamvotar.test.js
const path = require('path');
const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const { faltamVotar, formatarFaltantes } = require(path.join(RAIZ, 'bot', 'src', 'faltamvotar.js'));

const SESSAO = { sessaoAtual: { numSessao: 184, nomSessao: 'EXTRAORDINÁRIA Nº 184 - 23/11/2026' },
  votacaoAtual: { idVotacao: 14016, tipoVotacao: 'E', tituloVotacao: 'PLP Nº 299/2026 - EMENDAS COM PARECER PELA REJEIÇÃO' } };
const painel = fim => ({ dataFimVotacao: fim, nomeProposicao: 'PLP  Nº 299/2026', parlamentaresVotos: [
  { nomeParlamentar: 'Renata Abreu', uf: 'SP', siglaPartido: 'Podemos', dataRegistroVoto: '23/11/2026 22:36', indPresente: 1 },
  { nomeParlamentar: 'Duda Ramos', uf: 'RR', siglaPartido: 'Podemos', dataRegistroVoto: null, indPresente: 1 },
  { nomeParlamentar: 'Gilberto Nascimento', uf: 'SP', siglaPartido: 'Podemos   ', dataRegistroVoto: null, indPresente: 0 },
  { nomeParlamentar: 'Fulano', uf: 'RJ', siglaPartido: 'PL', dataRegistroVoto: '23/11/2026 22:35', indPresente: 1 },
] });
const resp = (status, corpo) => ({ ok: status === 200, status, text: async () => (corpo == null ? '' : JSON.stringify(corpo)) });

const uas = [];
async function rodar(rotas) {
  uas.length = 0;
  global.fetch = async (url, opt = {}) => {
    const ua = (opt.headers || {})['User-Agent'];
    uas.push(ua);
    // o WAF real da Câmara: "node" (padrão do Node) leva 403 no cosev
    if (/cosev-api-prod/.test(url) && (!ua || ua === 'node')) return resp(403, null);
    for (const [re, f] of rotas) if (re.test(url)) return f();
    return resp(404, null);
  };
  const r = await faltamVotar('PODE');
  return { r, txt: formatarFaltantes(r) };
}

(async () => {
  console.log('1–5. faltamVotar / formatarFaltantes');
  let { r, txt } = await rodar([[/sessao-atual/, () => resp(200, SESSAO)], [/ws-plenario\/votacao\/14016/, () => resp(200, painel(null))]]);
  ok(uas.length >= 2 && uas.every(u => u && u !== 'node'), 'User-Agent próprio em todas as consultas (' + [...new Set(uas)].join(', ') + ')');
  ok(r.aberta && /EM CURSO/.test(txt), 'votação aberta é dita "EM CURSO"');
  ok(r.total === 3 && r.votaram === 1, 'bancada com sigla "Podemos" (com espaços) contada: 1/3');
  ok(/NÃO votaram \(1\)[\s\S]*Duda Ramos/.test(txt) && /Fora da Casa \(1\)[\s\S]*Gilberto Nascimento/.test(txt), 'presentes × fora da Casa');
  ok(!/encerrad/i.test(txt), 'nada de "encerrada" numa votação aberta');

  ({ r, txt } = await rodar([[/sessao-atual/, () => resp(503, null)]]));
  ok(r.falha === true && /falha na consulta/.test(txt) && /NÃO quer dizer/.test(txt), 'falha no cosev: diz que falhou, não "sem sessão"');
  ok(!/não há sessão aberta/.test(txt), 'falha no cosev não vira "não há sessão aberta"');

  ({ r, txt } = await rodar([[/sessao-atual/, () => resp(200, SESSAO)], [/ws-plenario\/votacao/, () => resp(500, null)]]));
  ok(r.falha === true && /há votação nominal em curso/.test(txt), 'falha no painel de votos com nominal aberta: diz que há votação em curso');

  ({ r, txt } = await rodar([[/sessao-atual/, () => resp(200, { servico: 'sessao-atual' })]]));
  ok(!r.falha && /não há sessão aberta/.test(txt), 'sem sessão de fato: "não há sessão aberta"');

  ({ r, txt } = await rodar([[/sessao-atual/, () => resp(200, SESSAO)], [/ws-plenario\/votacao\/14016/, () => resp(200, painel('23/11/2026 22:50'))]]));
  ok(!r.aberta && /já foi encerrada/.test(txt) && !/EM CURSO/.test(txt), 'painel com dataFimVotacao: votação encerrada');

  ({ r, txt } = await rodar([[/sessao-atual/, () => resp(200, { ...SESSAO, votacaoAtual: { ...SESSAO.votacaoAtual, tipoVotacao: 'S' } })]]));
  ok(!r.aberta && /simbólica/.test(txt), 'simbólica: sem lista de faltantes');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
