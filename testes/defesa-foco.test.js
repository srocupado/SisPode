// Defesa focada em itens, na aba "Como votou o deputado".
//
// O que este teste trava:
//  1. o SENTIDO do voto num item é calculado pelo código, a partir do resultado
//     registrado — lado vencedor/vencido, aprovação/rejeição/manutenção/supressão —
//     e fica "não determinado" quando o resultado não permite calcular;
//  2. só item com voto Sim/Não ganha o botão "+ Usar na defesa"; marcar mostra
//     o sentido no item e o painel passa a dizer que a defesa é focada;
//  3. com itens marcados, o prompt trata SOMENTE deles, com o sentido pronto, e
//     mantém a matéria como contexto; sem marcados, é a defesa de sempre;
//  4. a trava de conflito continua olhando o voto no texto principal;
//  5. item marcado fora do recorte de datas não entra;
//  6. o PDF diz, no título, que a sustentação é do voto nos itens selecionados.
//
// Uso: node testes/defesa-foco.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} },
  pdfjsLib: { GlobalWorkerOptions: {} },
  fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
  chrome: { storage: { local: {
              get: (_k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' } }),
              set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);
const chamar = (fn, ...args) => vm.runInContext(fn, ctx)(...args);

// Provedor de IA de mentira: guarda o prompt, devolve um texto aceitável.
ctx.__prompts = [];
av(`chamarIA = async (o) => { __prompts.push(o.prompt); return { text: 'O deputado votou pela rejeição da emenda porque ela resolvia um problema real pelo caminho errado. '.repeat(3) }; }`);

const DEP = { id: 7, nome: 'Fulana de Tal', partido: 'PODE', uf: 'SP' };
const PROP = { siglaTipo: 'PL', numero: 3626, ano: 2023, ementa: 'Dispõe sobre apostas de quota fixa.' };
const vot = (id, data, descricao, voto, gov) => ({
  votacao: { id, data, dataHoraRegistro: data + 'T19:57:00', descricao },
  votos: voto ? [{ deputado_: { id: 7 }, tipoVoto: voto }] : [],
  nominal: !!voto, falhou: false, govOrient: gov || 'Não',
});
const ITENS = [
  vot('v-texto', '2023-09-13', 'Aprovado o Substitutivo. Sim: 292; não: 114; total: 406.', 'Sim', 'Sim'),
  vot('v-dtq3', '2023-09-13', 'Rejeitada a Emenda de Plenário nº 26. Sim: 82; não: 342; abstenção: 8; total: 432.', 'Não'),
  vot('v-dtq5', '2023-09-14', 'Rejeitada a Emenda de Plenário nº 31. Sim: 120; não: 301; total: 421.', 'Sim'),
  vot('v-simb', '2023-09-13', 'Rejeitado o Requerimento.', null),
];
const OBJETOS = {
  'v-texto': 'Votação da Subemenda Substitutiva Global ao Projeto de Lei nº 3.626, de 2023, ressalvados os destaques.',
  'v-dtq3': 'Votação do DTQ 3: Bloco UNIÃO (SD): Emenda de Plenário nº 26 (art. 161, II).',
  'v-dtq5': 'Votação do DTQ 5: Bancada do NOVO: Emenda de Plenário nº 31.',
  'v-simb': 'Votação do Requerimento de retirada de pauta.',
};
const RESUMOS = { materia: { ementa: PROP.ementa, simples: 'Regulamenta as apostas de quota fixa.' },
  itens: { 'v-dtq3': { simples: 'A medida proibiria que pessoas endividadas ou beneficiárias do BPC apostassem.',
                       justificacao: { texto: 'Justificação literal da emenda 26.' } } } };

(async () => {
  console.log('== sentido do voto, calculado do resultado registrado ==');
  {
    const s = (v, d) => chamar('dfsSentidoDoVoto', v, d);
    const a = s('Não', ITENS[1].votacao.descricao);
    ok(a && a.texto === 'pela rejeição da Emenda de Plenário nº 26' && a.venceu === true, `Não, lado vencedor → ${a && a.texto}`);
    const b = s('Sim', ITENS[1].votacao.descricao);
    ok(b && b.texto === 'pela aprovação da Emenda de Plenário nº 26' && b.venceu === false, `Sim, lado vencido → ${b && b.texto}`);
    ok(s('Não', 'Mantido o texto. Sim: 300; não: 100.').texto === 'pela supressão do texto', 'DVS: Não no "Mantido o texto" é pela supressão');
    ok(s('Sim', 'Aprovado o Projeto de Lei nº 3.626, de 2023, ressalvados os destaques. Sim: 292; não: 114.').texto
       === 'pela aprovação do Projeto de Lei nº 3.626, de 2023', 'a ressalva sai, o ponto do milhar não corta o objeto');
    ok(s('Sim', 'Rejeitado o Requerimento.') === null, 'sem placar: não determinado');
    ok(s('Obstrução', 'Rejeitada a Emenda. Sim: 1; não: 2.') === null, 'obstrução não é Sim/Não: não determinado');
    ok(s('Sim', 'Resultado estranho. Sim: 1; não: 2.') === null, 'resultado de forma desconhecida: não determinado');
  }

  console.log('\n== a tela: botão, seleção e sentido ==');
  {
    av(`cv.deputado = ${JSON.stringify(DEP)}; cv.modo = 'proposicao'`);
    ctx.__dados = { itens: ITENS, objetos: OBJETOS, prop: PROP, propDetalhada: PROP, resumos: RESUMOS };
    av('cvRender(__dados)');
    const botoes = () => [...document.querySelectorAll('[data-sel-defesa]')].map(b => b.dataset.selDefesa);
    ok(botoes().sort().join(',') === 'v-dtq3,v-dtq5,v-texto', `só itens com voto Sim/Não têm o botão (${botoes().join(', ')})`);
    ok(/Nenhum item selecionado: a defesa trata da matéria inteira/.test(document.getElementById('cvResultado').textContent),
       'sem seleção, o painel diz que a defesa é da matéria inteira');

    document.querySelector('[data-sel-defesa="v-dtq3"]').dispatchEvent(new Event('click'));
    ok(av('cv.selDefesa.has("v-dtq3")'), 'clicar marca o item');
    const it = document.querySelector('[data-sel-defesa="v-dtq3"]').closest('.cv-item');
    ok(it.classList.contains('na-defesa') && /✓ Na defesa/.test(it.textContent), 'o item fica destacado, com "✓ Na defesa"');
    ok(/Sentido do voto: pela rejeição da Emenda de Plenário nº 26 \(lado vencedor\)/.test(it.textContent.replace(/\s+/g, ' ')),
       'e mostra o sentido do voto calculado');
    ok(/Defesa focada em 1 item/.test(document.getElementById('cvResultado').textContent), 'o painel passa a dizer que a defesa é focada');
    ok(/Gerar sustentação dos itens selecionados/.test(document.getElementById('cvDefGerar').textContent), 'e o botão muda');
  }

  console.log('\n== gerar: o prompt trata SOMENTE dos itens marcados ==');
  {
    document.querySelector('#cvDefPosicao option[value="favoravel"]').selected = true;
    Object.defineProperty(document.getElementById('cvDefPosicao'), 'value', { configurable: true, get: () => 'favoravel' });
    ctx.__prompts.length = 0;
    await av('cvGerarDefesaAgora()');
    const p = ctx.__prompts[0] || '';
    ok(/OS ITENS A SUSTENTAR — e SOMENTE estes/.test(p), 'o prompt é o da defesa focada');
    ok(/Emenda de Plenário nº 26/.test(p) && !/Emenda de Plenário nº 31/.test(p), 'traz o item marcado, e não os outros destaques');
    ok(/SENTIDO DO VOTO \(já determinado — use exatamente\): pela rejeição da Emenda de Plenário nº 26 — foi o lado vencedor/.test(p),
       'com o sentido pronto, calculado pelo código');
    ok(/Regulamenta as apostas de quota fixa/.test(p), 'a explicação da matéria continua como contexto');
    ok(/proibiria que pessoas endividadas/.test(p) && /Justificação literal da emenda 26/.test(p), 'e o que o item fazia, com o texto literal');
    const d = av('cv.completo.defesa');
    ok(d.ok && d.foco.length === 1 && d.foco[0].id === 'v-dtq3', 'a sustentação guarda o foco');
    ok(/Sustentação — voto no item selecionado/.test(document.getElementById('cvResultado').textContent), 'e o bloco na tela diz que é do item');
  }

  console.log('\n== a trava de conflito continua valendo ==');
  {
    // O deputado votou SIM no texto principal: posição contrária é recusada, mesmo com foco.
    Object.defineProperty(document.getElementById('cvDefPosicao'), 'value', { configurable: true, get: () => 'contraria' });
    ctx.__prompts.length = 0;
    await av('cvGerarDefesaAgora()');
    ok(ctx.__prompts.length === 0 && av('cv.completo.defesa.motivo') === 'conflito', 'posição contrária ao voto no texto: recusada, sem chamar a IA');
  }

  console.log('\n== fora do recorte não entra ==');
  {
    av(`cv.selDefesa = new Set(['v-dtq5']); cv.recorte = { ini: '2023-09-13', fim: '2023-09-13' }; cvDesenhar()`);
    ok(/fora do recorte de datas/.test(document.getElementById('cvResultado').textContent), 'o painel avisa que o item marcado está fora do recorte');
    Object.defineProperty(document.getElementById('cvDefPosicao'), 'value', { configurable: true, get: () => 'favoravel' });
    ctx.__prompts.length = 0;
    await av('cvGerarDefesaAgora()');
    ok(!/OS ITENS A SUSTENTAR/.test(ctx.__prompts[0] || ''), 'e a defesa volta a ser da matéria inteira');
  }

  console.log('\n== sem seleção, a defesa é a de sempre ==');
  {
    av(`cv.selDefesa = new Set(); cv.recorte = null; cvDesenhar()`);
    Object.defineProperty(document.getElementById('cvDefPosicao'), 'value', { configurable: true, get: () => 'favoravel' });
    ctx.__prompts.length = 0;
    await av('cvGerarDefesaAgora()');
    ok(/POSIÇÃO A SUSTENTAR: favorável à matéria/.test(ctx.__prompts[0] || ''), 'o prompt da matéria inteira');
    ok(!av('cv.completo.defesa.foco'), 'sem foco guardado');
  }

  console.log('\n== o PDF diz que é do voto no item ==');
  {
    av(`cv.selDefesa = new Set(['v-dtq3']); cvDesenhar()`);
    await av('cvGerarDefesaAgora()');
    av('cv.completo.defesa.incluir = true; cv.ultimo.defesa = cv.completo.defesa');
    const doc = av('cvHtmlPDF(null)');
    ok(/Sustentação do voto no item selecionado/.test(doc), 'título próprio no PDF');
    ok(/pela rejeição da Emenda de Plenário nº 26/.test(doc), 'com o item e o sentido do voto');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
