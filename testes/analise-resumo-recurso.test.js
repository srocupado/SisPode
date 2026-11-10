'use strict';
// Resumo da Sessão (WhatsApp) · RECURSO votado no Plenário.
//
// 10/11/2026: "Rejeitado, simbolicamente, o Recurso 20/2024 (PL 2168/2021)"
// não aparecia no resumo — só entravam urgências e matérias aprovadas, e REC era
// descartado. O recurso decide o destino do projeto: rejeitado, prevalece a
// decisão da comissão; aprovado, o projeto vai ao Plenário.
// Fixture: a página da sessão de 10/11/2026 (evento 83243), só a seção
// "Propostas analisadas" — com o REC 20/2024 "Rejeitada".
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('../bot/node_modules/linkedom');

const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const ia = fs.readFileSync(path.join(__dirname, '..', 'ia-comum.js'), 'utf8');
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', 'plenario', f), 'utf8');
const fn = (texto, nome) => texto.match(new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`))[0];
const cnst = nome => src.match(new RegExp(`const ${nome} = [^\\n]*`))[0];

const paginas = { agenda: fx('agenda-2026-11-10a20.html'), evento: fx('evento-83243-analisados.html') };
const fetchHtmlCamara = async url => /\/agenda\?/.test(url) ? paginas.agenda : /evento-legislativo\/83243/.test(url) ? paginas.evento : null;
const resolveProposicaoBusca = async (s, n, a) => ({ ementa: `ementa do ${s} ${n}/${a}` });
const apelidos = { 'PL-2168-2021': 'Obras de irrigação como utilidade pública' };
const ctx = new Function('DOMParser', 'fetchHtmlCamara', 'resolveProposicaoBusca', 'apelidos', `
  ${fn(ia, 'encurtarProposicoes')}
  ${fn(src, 'siglaComissao')}
  ${fn(src, 'destinoDeConclusao')}
  ${fn(src, 'extrairRefProposicao')}
  ${fn(src, 'acharSessoesPortal')}
  ${fn(src, 'materiasAnalisadasPortal')}
  ${fn(src, 'coletarResumoSessaoPortal')}
  ${cnst('tipoRecurso')}
  ${cnst('destinoDoRecurso')}
  ${fn(src, 'fraseResultadoRecurso')}
  ${fn(src, 'ementaTextoResumo')}
  const tipoLabel = s => s;
  const dataPautaCurta = () => '';
  const apelidoDaPautaPorRef = (s, n, a) => apelidos[[s, n, a].join('-')] || '';
  const apelidoDeAnalisePorRef = async () => '';
  ${fn(src, 'montarMensagemResumo')}
  return { coletarResumoSessaoPortal, montarMensagemResumo, fraseResultadoRecurso, tipoRecurso };
`)(DOMParser, fetchHtmlCamara, resolveProposicaoBusca, apelidos);

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('\n== portal: o recurso rejeitado da sessão de 10/11/2026 ==');
  const r = await ctx.coletarResumoSessaoPortal('2026-11-10');
  const rec = (r.recursos || [])[0];
  ok(r.recursos && r.recursos.length === 1, `1 recurso votado (o REC 1/2026, ainda não votado, fica de fora) → ${JSON.stringify((r.recursos || []).map(x => x.numero + '/' + x.ano))}`);
  ok(rec && rec.numero === '20' && rec.ano === '2024' && rec.aprovado === false && rec.tipo === 'conclusivo', 'REC 20/2024, rejeitado, contra a tramitação conclusiva');
  ok(rec && rec.destino === '', 'o passo "segue a tramitação inicialmente prevista" não vira destino genérico');
  ok(rec && rec.alvo && rec.alvo.sigla === 'PL' && rec.alvo.numero === '2168' && rec.alvo.ano === '2021', 'projeto alvo lido da ementa: PL 2168/2021');
  ok(!r.concluidos.some(c => c.sigla === 'REC') && r.urgencias.length === 4, 'recurso não vira matéria concluída; as 4 urgências seguem');

  console.log('\n== a mensagem ==');
  const msg = await ctx.montarMensagemResumo(r.urgencias, r.concluidos, '2026-11-10', r.recursos);
  ok(/▪️ \*Recurso 20\/2024 \(PL 2168\/2021\) rejeitado\* \(Obras de irrigação como utilidade pública\) ➡️ Prevalece a apreciação conclusiva das comissões/.test(msg),
     'linha do recurso: resultado, projeto com apelido e o que acontece com ele');
  const linhas = msg.split('\n');
  ok(linhas.findIndex(l => /Recurso 20/.test(l)) > linhas.findIndex(l => /Urgência ao/.test(l)) && linhas.findIndex(l => /Recurso 20/.test(l)) < linhas.findIndex(l => /MPV 1376/.test(l)), 'entre as urgências e as matérias concluídas');
  const ap = await ctx.montarMensagemResumo([], [], '2026-11-10', [{ numero: '5', ano: '2025', alvo: { sigla: 'PL', numero: '1', ano: '2024' }, ementa: 'x', aprovado: true, tipo: 'conclusivo', destino: '' }]);
  ok(/\*Recurso 5\/2025 \(PL 1\/2024\) aprovado\* \(x\) ➡️ O projeto vai à apreciação do Plenário/.test(ap), 'aprovado: o projeto vai ao Plenário');
  const dest = await ctx.montarMensagemResumo([], [], '2026-11-10', [{ ...rec, destino: 'Vai ao Senado' }]);
  ok(/rejeitado\* \(Obras de irrigação como utilidade pública\) ➡️ Vai ao Senado$/m.test(dest), 'com despacho de destino no dia, vale o despacho');
  ok(ctx.fraseResultadoRecurso(false, ctx.tipoRecurso('Recurso contra parecer terminativo ao Projeto de Lei nº 2812, de 2022')) === 'Prevalece o parecer terminativo da comissão', 'contra parecer terminativo, rejeitado: prevalece o parecer terminativo');
  ok(/\*Urgência ao PLP 226\/2025\*/.test(msg) && /\*MPV 1376\/2026\*.*➡️ Vai ao Senado/.test(msg), 'o resto do resumo segue igual');

  console.log('\n== API e bot ==');
  const api = fn(src, 'coletarResumoSessaoApi');
  ok(/REC\\s\+\(\[\\d\.\]\+\)/.test(api) && /aprovado: v\.aprovacao === 1/.test(api), 'pela API: votação do REC, aprovada ou rejeitada');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'bot', 'src', 'worker.js'), 'utf8');
  ok(/montarMensagemResumo\(res\.urgencias, res\.concluidos, data, res\.recursos \|\| \[\]\)/.test(worker), 'o resumo do bot leva os recursos');

  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log('\nTudo passou.');
})();
