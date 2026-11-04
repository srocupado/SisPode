'use strict';
// Ordem do Dia (bot/src/odd.js): a API de Dados Abertos marca as redações
// finais no tópico, no plural — "Redações Finais (RICD, art. 83, I)" (evento
// 83159, 04/11/2026). O teste só aceitava o singular e os itens 1 e 2 entravam
// como projeto.
const fs = require('fs');
const path = require('path');
const odd = fs.readFileSync(path.join(__dirname, '..', 'bot', 'src', 'odd.js'), 'utf8');
const itemDaApi = new Function(odd.match(/function itemDaApi\([\s\S]*?\n}/)[0] + '; return itemDaApi;')();

let falhas = 0;
const ok = (c, msg) => { if (c) console.log('  ok  ' + msg); else { falhas++; console.log('  FALHOU  ' + msg); } };
const prop = (siglaTipo, numero, ano) => ({ siglaTipo, numero, ano, ementa: 'x' });

ok(itemDaApi({ ordem: 1, topico: 'Redações Finais (RICD, art. 83, I)', regime: 'Ordinário (Art. 151, III, RICD)', titulo: 'PL 2879/2011', proposicao_: prop('PL', 2879, 2011) }).tipoCategoria === 'redacao_final', 'tópico "Redações Finais" (plural) → redacao_final');
ok(itemDaApi({ ordem: 2, topico: 'Redação Final', proposicao_: prop('PL', 1932, 2021) }).tipoCategoria === 'redacao_final', 'singular continua → redacao_final');
ok(itemDaApi({ ordem: 5, topico: 'Discussão', regime: 'Urgência (Art. 155, RICD)', titulo: 'PL 3099/2019', proposicao_: prop('PL', 3099, 2019) }).tipoCategoria === 'projeto', '"Discussão" → projeto');
ok(itemDaApi({ ordem: 3, topico: 'Requerimentos de Urgência Art. 155', titulo: 'REQ 4057/2026', proposicao_: prop('REQ', 4057, 2026) }).tipoCategoria === 'requerimento', 'REQ → requerimento');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nOK');
