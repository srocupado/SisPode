// Análise de Pauta: nota salva com o apelido em branco ganha o apelido depois
// (completarApelidoFaltante, analise.js). Caso real: REQ 3.721/2026, nota de
// 03/11/2026 gravada com apelido "" — a chamada do apelido falhou e o erro era engolido.
// Uso: node testes/analise-apelido.test.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const ctx = { chamadas: 0, patches: [], resposta: 'Artesanato do Maranhão como cultura nacional', erro: null, avisos: [] };
const montar = () => new Function('state', 'carregarConfig', 'gerarApelidoIA', 'caminhoAnalise', 'fetch', 'document', 'isAbortError', 'console', `
  ${trecho(/const _apelidoTentado = new Set\(\);[\s\S]*?\nfunction completarApelidoFaltante\(it\) \{[\s\S]*?\n}\n/)}
  return { completar: completarApelidoFaltante, fila: () => _filaApelido };
`)({ config: { apiKey: 'k', provedor: 'gemini', modelo: 'm' } }, async () => {},
  async () => { ctx.chamadas++; if (ctx.erro) throw new Error(ctx.erro); return ctx.resposta; },
  it => `https://fb/analises_pauta/${it.chave}/inteiro-teor.json`,
  async (url, o) => { ctx.patches.push({ url, metodo: o.method, corpo: JSON.parse(o.body) }); return { ok: true }; },
  { querySelector: () => null, activeElement: null }, () => false, { warn: (...a) => ctx.avisos.push(a.join(' ')) });

(async () => {
  let F = montar();
  const req = { chave: 'REQ-3721-2026', analise: { markdown: 'nota', apelido: '' } };
  F.completar(req); await F.fila();
  ok(ctx.chamadas === 1 && req.apelido === ctx.resposta && req.analise.apelido === ctx.resposta, 'nota com apelido "" ganha o apelido');
  ok(ctx.patches.length === 1 && ctx.patches[0].metodo === 'PATCH' && JSON.stringify(ctx.patches[0].corpo) === JSON.stringify({ apelido: ctx.resposta })
     && /REQ-3721-2026\/inteiro-teor\.json$/.test(ctx.patches[0].url), 'grava só o campo apelido da nota (PATCH), não a nota inteira');
  req.apelido = ''; req.analise.apelido = '';
  F.completar(req); await F.fila();
  ok(ctx.chamadas === 1, 'uma tentativa por item por sessão');

  const antiga = { chave: 'PL-1-2020', analise: { markdown: 'nota de antes do apelido' } };
  const pronta = { chave: 'PL-2-2020', analise: { markdown: 'n', apelido: 'Já tem' } };
  const editado = { chave: 'PL-3-2020', apelido: 'digitado', analise: { markdown: 'n', apelido: '' } };
  F.completar(antiga); F.completar(pronta); F.completar(editado); await F.fila();
  ok(ctx.chamadas === 1 && ctx.patches.length === 1, 'nota antiga (sem o campo), nota com apelido e apelido já digitado: nenhuma chamada');

  F = montar(); ctx.erro = 'HTTP 429';
  const outro = { chave: 'REQ-9-2026', analise: { markdown: 'n', apelido: '' } };
  F.completar(outro); await F.fila();
  ok(!outro.apelido && ctx.patches.length === 1 && ctx.avisos.some(a => /REQ-9-2026.*HTTP 429/.test(a)), 'falha da IA: nada gravado e o motivo vai para o console');

  ok(/catch \(e\) \{ if \(isAbortError\(e\)\) throw e; console\.warn\(`Apelido não gerado para \$\{it\.chave\}:`/.test(src), 'ao gerar a nota, a falha do apelido também vai para o console');
  ok((src.match(/completarApelidoFaltante\(it\)/g) || []).length >= 4, 'chamada nos três caminhos que carregam a nota salva e depois de gerar');
  ok(/data-role="btn-regerar-apelido"/.test(src) && /inpApelido\.dispatchEvent\(new Event\('change'\)\)/.test(src), 'botão ↻ Regerar no card: o apelido novo é salvo pelo caminho da edição manual');
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
