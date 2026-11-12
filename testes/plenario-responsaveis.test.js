// Plenário: responsáveis sorteados na importação da pauta e a caixa "Revisada" (12/11/2026).
//
// O que este teste trava:
//   1. distribuirResponsaveis: aleatório (sorteios diferentes dão distribuições diferentes), em partes
//      iguais (diferença máxima de 1 item), só nos itens sem responsável, sem nomes repetidos;
//   2. a lista de servidores vem do Firebase (compartilhada); sem lista, os três nomes padrão;
//      salvar grava a lista limpa (sem linha vazia nem repetição);
//   3. a importação do PDF sorteia ANTES de desenhar e salvar a pauta (o nome vai com os itens);
//   4. "Revisada": só com nota, marcada à mão pelo servidor; grava quem e quando na nota; desmarcar apaga;
//      nota completada volta a "não revisada" (nota regerada já nasce sem a marca).
// Uso: node testes/plenario-responsaveis.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const { parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const html = fs.readFileSync(path.join(RAIZ, 'analise.html'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const fn = nome => trecho(new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n}`));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// gerador pseudoaleatório com semente (reprodutível)
const semente = s => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };

(async () => {
  let firebase = null, put = null;
  const state = { servidores: null, config: { nomeUsuario: 'Pedro Ribeiro' } };
  const doc = parseHTML(`<html><body>${html.match(/<div data-config-panel="servidores"[\s\S]*?<\/div>\s*<\/div>/)[0]}<span id="x"></span></body></html>`).document;
  const F = new Function('state', 'FIREBASE_URL', 'fetch', 'document', 'formatDataHora', `
    ${trecho(/const SERVIDORES_PADRAO = [^\n]+/)}
    ${trecho(/const SERVIDORES_PATH = [^\n]+/)}
    ${fn('carregarServidores')}
    ${fn('distribuirResponsaveis')}
    ${fn('salvarServidores')}
    ${fn('atualizarRevisado')}
    return { carregarServidores, distribuirResponsaveis, salvarServidores, atualizarRevisado, SERVIDORES_PADRAO };
  `)(state, 'https://fb', async (url, init = {}) => {
    if ((init.method || 'GET') === 'PUT') { put = { url, corpo: JSON.parse(init.body) }; return { ok: true, json: async () => null }; }
    return { ok: true, json: async () => firebase };
  }, doc, iso => `dd/mm ${iso.slice(11, 16)}`);

  console.log('== 1. sorteio dos responsáveis ==');
  const itens = n => Array.from({ length: n }, (_, i) => ({ chave: 'PL-' + i }));
  const a = itens(10);
  ok(F.distribuirResponsaveis(a, F.SERVIDORES_PADRAO, semente(7)) === 10 && a.every(it => F.SERVIDORES_PADRAO.includes(it.analista)), 'todos os itens recebem um dos servidores');
  const carga = arr => Object.values(arr.reduce((m, it) => ((m[it.analista] = (m[it.analista] || 0) + 1), m), {})).sort();
  ok(JSON.stringify(carga(a)) === '[3,3,4]', `partes iguais: 10 itens → 4/3/3 (${carga(a)})`);
  const b = itens(10); F.distribuirResponsaveis(b, F.SERVIDORES_PADRAO, semente(99));
  ok(a.some((it, i) => it.analista !== b[i].analista), 'aleatório: outro sorteio, outra distribuição');
  const c = itens(9); c[0].analista = 'Fulana Manual';
  ok(F.distribuirResponsaveis(c, F.SERVIDORES_PADRAO, semente(3)) === 8 && c[0].analista === 'Fulana Manual', 'quem já tem responsável fica como está');
  const d = itens(4);
  F.distribuirResponsaveis(d, ['Ana', ' Ana ', '', 'Bia'], semente(1));
  ok(JSON.stringify(carga(d)) === '[2,2]', 'nomes repetidos e linha vazia não contam');
  ok(F.distribuirResponsaveis(itens(3), [], semente(1)) === 0, 'sem servidores, nada é sorteado');
  // muitos sorteios: cada servidor recebe o item "a mais" em algum deles (a ordem dos servidores também é sorteada)
  const quemTem4 = new Set();
  for (let s = 1; s < 40; s++) { const x = itens(10); F.distribuirResponsaveis(x, F.SERVIDORES_PADRAO, semente(s)); const m = {}; x.forEach(it => { m[it.analista] = (m[it.analista] || 0) + 1; }); Object.entries(m).forEach(([k, v]) => { if (v === 4) quemTem4.add(k); }); }
  ok(quemTem4.size === 3, 'o item a mais não cai sempre no mesmo servidor');

  console.log('\n== 2. lista de servidores ==');
  firebase = null;
  ok(JSON.stringify(await F.carregarServidores()) === JSON.stringify(['Pedro Ribeiro', 'Daniel Roriz', 'Suellen Ali']), 'sem lista no Firebase: Pedro Ribeiro, Daniel Roriz e Suellen Ali');
  firebase = ['Pedro Ribeiro', 'Daniel Roriz', 'Suellen Ali', 'Nova Servidora'];
  ok((await F.carregarServidores()).length === 4 && state.servidores[3] === 'Nova Servidora', 'com lista gravada: a da equipe');
  doc.getElementById('config-servidores').value = 'Pedro Ribeiro\n\nDaniel Roriz\n Suellen Ali \nPedro Ribeiro\nCarlos Novo';
  await F.salvarServidores();
  ok(put && put.url === 'https://fb/plenario_servidores.json' && JSON.stringify(put.corpo) === JSON.stringify(['Pedro Ribeiro', 'Daniel Roriz', 'Suellen Ali', 'Carlos Novo']), 'salvar grava a lista limpa, para a equipe');
  ok(/aba|Servidores responsáveis por análises/.test(html) && /data-config-tab="servidores"/.test(html), 'aba "Servidores responsáveis" nas Configurações');

  console.log('\n== 3. importação do PDF ==');
  const imp = fn('onPdfSelecionado');
  const iDist = imp.indexOf('distribuirResponsaveis(state.pauta.itens'), iRender = imp.indexOf('renderizarPauta()'), iSalvar = imp.indexOf('fbSalvarPauta(state.pauta)');
  ok(iDist > 0 && iDist < iRender && iRender < iSalvar, 'sorteia antes de desenhar e de salvar: o nome vai gravado com os itens da pauta');
  const salvar = src.slice(src.indexOf('async function fbSalvarPauta('), src.indexOf('function marcarSujo()'));
  ok(/analista: it\.analista \|\| null/.test(salvar), 'o item salvo na pauta leva o responsável');

  console.log('\n== 4. caixa "Revisada" ==');
  const cardDoc = parseHTML(`<div class="an-card">${src.match(/<label class="an-revisado"[\s\S]*?<\/label>/)[0]}</div>`).document;
  const card = cardDoc.querySelector('.an-card');
  const chk = card.querySelector('[data-role=chk-revisado]');
  const it = { analista: 'Daniel Roriz', analise: null };
  F.atualizarRevisado(it, card);
  ok(chk.disabled && !chk.checked && /Gere a nota/.test(card.querySelector('label').getAttribute('title')), 'sem nota: desativada');
  it.analise = { markdown: 'x' };
  F.atualizarRevisado(it, card);
  ok(!chk.disabled && !chk.checked, 'com nota: ativa, desmarcada (nada marca sozinho)');
  it.analise.revisado = { por: 'Daniel Roriz', em: '2026-11-12T15:40:00.000Z' };
  F.atualizarRevisado(it, card);
  ok(chk.checked && /Revisada por Daniel Roriz em dd\/mm 15:40/.test(card.querySelector('label').getAttribute('title')) && card.querySelector('label').classList.contains('feito'), 'marcada: mostra quem e quando');
  const wire = src.slice(src.indexOf("const chkRevisado = card.querySelector('[data-role=chk-revisado]');"), src.indexOf('// Apelido da matéria (gerado por IA'));
  ok(/it\.analise\.revisado = \{ por: state\.config\?\.nomeUsuario \|\| it\.analista \|\| '', em: new Date\(\)\.toISOString\(\) \}/.test(wire) && /else delete it\.analise\.revisado/.test(wire) && /fbSalvarAnalise\(it\)/.test(wire),
    'clicar grava na nota quem marcou e quando (desmarcar apaga) e salva no Firebase');
  ok(/okRevisado\.classList\.add\('show'\)/.test(wire) && /if \(antes\) it\.analise\.revisado = antes; else delete it\.analise\.revisado;/.test(wire) && /a marcação foi desfeita/.test(wire),
    'salva no clique: ✓ próprio ao gravar; se falhar, a caixa volta ao estado anterior e avisa');
  ok(/delete it\.analise\.revisado;\s+\/\/ texto novo/.test(fn('completarAnalise')), 'nota completada volta a "não revisada"');
  ok(!/revisado/.test(trecho(/it\.analise = \{\n\s+markdown,[\s\S]*?\n {4}\};/)), 'nota (re)gerada nasce sem a marca');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO FATAL:', e); process.exit(1); });
