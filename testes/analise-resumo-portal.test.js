'use strict';
// Resumo da Sessão (WhatsApp) pelo portal da Câmara, quando a API cai.
//
// O caso (05/11/2026): API de Dados Abertos e SitCamaraWS em 504; o resumo
// dependia só da API (eventos do dia → votações → proposições → tramitações).
// O portal continuava no ar: a agenda dá as sessões do dia e a página da sessão
// traz as "Propostas analisadas", o resultado e o passo a passo com o
// roteamento ("A matéria vai ao Senado Federal"). Fixtures: agenda e sessão
// de 04/11/2026 (evento 83159), só a seção usada.
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('../bot/node_modules/linkedom');

const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', 'plenario', f), 'utf8');
const fn = nome => src.match(new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`))[0];

const paginas = {
  agenda: fx('agenda-2026-11-04.html'),
  evento: fx('evento-83159.html'),
};
const fetchHtmlCamara = async url => /\/agenda\?/.test(url) ? paginas.agenda : /evento-legislativo\/83159/.test(url) ? paginas.evento : null;
const encurtarProposicoes = t => t;   // a ementa do REQ já vem curta ("PL 2167/2026")
const resolveProposicaoBusca = async () => ({ ementa: 'ementa do projeto da urgência' });
const ctx = new Function('DOMParser', 'fetchHtmlCamara', 'encurtarProposicoes', 'resolveProposicaoBusca', `
  ${fn('siglaComissao')}
  ${fn('destinoDeConclusao')}
  ${fn('extrairRefProposicao')}
  ${fn('acharSessoesPortal')}
  ${fn('materiasAnalisadasPortal')}
  ${fn('coletarResumoSessaoPortal')}
  return { acharSessoesPortal, materiasAnalisadasPortal, coletarResumoSessaoPortal };
`)(DOMParser, fetchHtmlCamara, encurtarProposicoes, resolveProposicaoBusca);

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('\n== agenda do portal: só as sessões deliberativas ==');
  const sess = await ctx.acharSessoesPortal('2026-11-04');
  ok(sess.length === 1 && sess[0].id === '83159', `1 sessão deliberativa (83159); as 2 homenagens ficam de fora → ${JSON.stringify(sess.map(s => s.id))}`);

  console.log('\n== página da sessão: propostas analisadas ==');
  const mats = await ctx.materiasAnalisadasPortal('83159');
  ok(mats.length === 5, `5 matérias analisadas → ${mats.map(m => `${m.sigla} ${m.numero}/${m.ano}`).join(', ')}`);
  const req = mats.find(m => m.sigla === 'REQ');
  ok(req && req.numero === '4375' && /urgência.*PL 2167\/2026/.test(req.ementa) && /^Aprovad/.test(req.resultado), 'REQ 4375/2026: ementa da urgência e resultado "Aprovada"');
  const pl = mats.find(m => m.sigla === 'PL' && m.numero === '3220' && m.ano === '2019');
  ok(pl && pl.id && pl.passos.some(p => /A matéria retorna ao Senado Federal/.test(p)), 'PL 3220/2019: id e o passo "A matéria retorna ao Senado Federal"');

  console.log('\n== resumo no formato do resumo pela API ==');
  const r = await ctx.coletarResumoSessaoPortal('2026-11-04');
  ok(r.encontrouSessao && r.fonte === 'portal', 'encontrou a sessão, fonte portal');
  ok(r.urgencias.length === 1 && r.urgencias[0].sigla === 'PL' && r.urgencias[0].numero === '2167' && r.urgencias[0].resolvido, 'urgência → projeto-alvo PL 2167/2026');
  const dest = Object.fromEntries(r.concluidos.map(c => [`${c.sigla} ${c.numero}/${c.ano}`, c.destino]));
  ok(r.concluidos.length === 4, `4 matérias concluídas → ${JSON.stringify(dest)}`);
  ok(dest['PL 3220/2019'] === 'Retorna ao Senado' && dest['PL 5902/2023'] === 'Vai ao Senado', 'destinos pelo passo a passo: Retorna ao Senado / Vai ao Senado');
  ok(!r.concluidos.some(c => c.sigla === 'REQ'), 'requerimento não entra entre as concluídas');

  console.log('\n== coletarResumoSessao: API primeiro, portal se a API falhar ==');
  const orq = fn('coletarResumoSessao');
  ok(/coletarResumoSessaoApi\(dataISO\)/.test(orq) && /coletarResumoSessaoPortal\(dataISO\)/.test(orq), 'tenta a API e cai no portal');

  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log('\nTudo passou.');
})();
