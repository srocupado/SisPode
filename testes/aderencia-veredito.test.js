// O histórico individual do deputado (aderencia.js, buildDepDetailHTML).
//
// A etiqueta da direita de cada votação dizia SIM ou NÃO — o VOTO do deputado.
// Só que o julgamento que a tela inteira faz é outro: aderiu ou divergiu do
// governo. Quem lia a lista entendia a etiqueta como o veredito, e as duas
// coisas se separam justamente no caso mais comum da oposição: votar NÃO
// quando o governo orientou NÃO é ADERIR.
//
// Cada item passa a ter um lugar para cada coisa: à esquerda o VOTO (o fato),
// embaixo a ORIENTAÇÃO DO GOVERNO e a data (contra o que), à direita o
// VEREDITO. O ✓/✗ que ficava à esquerda saiu: era o mesmo veredito da direita,
// dito duas vezes, enquanto o voto — o único fato da linha — não tinha lugar.
//
// Na captura de 15/09/2026 (Antonio Carlos Rodrigues, PODE-SP, 75%) isso
// aparecia cru: o item "Rejeitada a Emenda de Plenário nº 1" trazia ✓ na
// esquerda, "GOV: NÃO" embaixo e a etiqueta "NÃO" na direita.
//
// E havia um terceiro defeito na mesma linha: o -webkit-line-clamp de 2 linhas
// valia para a caixa inteira, então a linha "Gov: … · data" era cortada junto
// sempre que a ementa ocupava as duas linhas. Na captura, de quatro itens, só
// o de ementa curta mostrava a orientação do governo.
//
// Uso: node testes/aderencia-veredito.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window } = parseHTML(html);
const ctx = {
  document, window, DOMParser, setTimeout, clearTimeout, URL, TextDecoder,
  // aderencia.html passou a carregar ia-comum.js, que declara um
  // AbortController no topo do arquivo. Sem ele no contexto, NENHUM script
  // da página chega a ser avaliado.
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }),
  requestAnimationFrame: () => 0,
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

const DEP = { id: 204321, nome: 'Antonio Carlos Rodrigues', siglaPartido: 'PODE', siglaUf: 'SP' };

/** Uma votação com a orientação do governo e o voto do deputado. */
const votacao = (id, descricao, gov, voto, quando) => ({
  votacao: { id, descricao, dataHoraRegistro: quando },
  govOrient: gov,
  votos: voto ? [{ deputado_: DEP, tipoVoto: voto }] : [],
});

// As quatro votações da captura: a primeira divergindo (votou SIM contra a
// orientação NÃO) e as outras três aderindo.
ctx.__ctx = {
  qualifying: [
    votacao('v1', 'Aprovado o Substitutivo ao Projeto de Lei Complementar nº 230, de 2025, adotado pela relatora da Comissão de Finanças e Tributação. Sim: 333; Não: 90; Total: 423.',
            'Não', 'Sim', '2026-08-13T18:00:00-03:00'),
    votacao('v2', 'Rejeitada a Emenda de Plenário nº 1. Sim: 105; Não: 233; Total: 338.',
            'Não', 'Não', '2026-08-12T17:00:00-03:00'),
    votacao('v3', 'Rejeitadas as Emendas de Plenário. Sim: 108; Não: 275; Abstenção: 1; Total: 384.',
            'Não', 'Não', '2026-08-12T16:00:00-03:00'),
    votacao('v4', 'Aprovado o Substitutivo Reformulado ao Projeto de Lei Complementar nº 114, de 2026, adotado pela relatora da Comissão de Minas e Energia, ressalvados os destaques.',
            'Sim', 'Sim', '2026-08-11T15:00:00-03:00'),
  ],
};
ctx.__m = { dep: DEP, pct: 75, aderiu: 3, divergiu: 1, ausente: 0 };

(async () => {
  const html4 = av('buildDepDetailHTML(__m, __ctx)');
  const doc = new DOMParser().parseFromString('<div>' + html4 + '</div>', 'text/html');
  const itens = [...doc.querySelectorAll('.dep-individual-list .item')];

  console.log('== a etiqueta da direita passa a ser o veredito ==');
  {
    ok(itens.length === 4, `as quatro votações aparecem (${itens.length})`);
    const etiquetas = itens.map(i => i.querySelector('.vote').textContent.trim());
    ok(etiquetas.join(',') === 'Divergiu,Aderiu,Aderiu,Aderiu',
       `e cada uma traz Aderiu/Divergiu, não SIM/NÃO (${etiquetas.join(', ')})`);
    ok(!etiquetas.some(t => /^(Sim|Não)$/i.test(t)), 'nenhuma etiqueta é o voto cru');

    // O caso que provava a confusão: votou NÃO, governo orientou NÃO → ADERIU.
    const i2 = itens[1];
    ok(i2.querySelector('.vote').textContent.trim() === 'Aderiu',
       'votar NÃO com o governo orientando NÃO aparece como Aderiu (antes: etiqueta "NÃO")');
    ok(i2.querySelector('.vote').className.includes('aderente'), 'com a cor de aderência, e não a do voto');
  }

  console.log('\n== o voto ocupa a esquerda, no lugar do ✓/✗ redundante ==');
  {
    const votos = itens.map(i => i.querySelector('.mark').textContent.replace(/\s+/g, ' ').trim());
    ok(votos.join(',') === 'Voto: Sim,Voto: Não,Voto: Não,Voto: Sim',
       `a esquerda traz o voto literal, rotulado (${votos.join(', ')})`);
    ok(itens.every(i => i.querySelector('.mark .rot').textContent.trim() === 'Voto:'),
       'e o rótulo "Voto:" se repete em cada pastilha — a lista rola, um cabeçalho de coluna sumiria');
    ok(!itens.some(i => /[✓✗]/.test(i.querySelector('.mark').textContent)),
       'e não o ✓/✗, que repetia o veredito da direita');
    ok(itens[1].querySelector('.mark').getAttribute('title') === 'Voto do deputado: Não',
       'a pastilha diz, ao passar o mouse, que aquilo é o voto');

    // A linha lê-se: votou NÃO · governo pediu NÃO → Aderiu.
    const meta = itens.map(i => i.querySelector('.gov').textContent.replace(/\s+/g, ' ').trim());
    ok(/^Governo: Não/.test(meta[1]), `embaixo fica a orientação enfrentada (${meta[1]})`);
    ok(meta.every(t => /· \d{2}\/\d{2}\/\d{2}$/.test(t)), 'com a data no fim da linha');
    ok(!meta.some(t => /Votou/.test(t)), 'sem repetir o voto, que já está à esquerda');
  }

  console.log('\n== a orientação do governo aparece em TODOS os itens ==');
  {
    // O defeito do clamp: a linha vivia dentro da caixa de 2 linhas da ementa.
    ok(itens.every(i => !!i.querySelector('.item-corpo > .desc') && !!i.querySelector('.item-corpo > .gov')),
       'descrição e linha do governo são irmãs, não mais aninhadas uma na outra');
    ok(itens.every(i => !i.querySelector('.desc .gov')),
       'nada de linha do governo dentro do bloco recortado em 2 linhas');

    const css = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
    const regra = /\.dep-individual-list \.desc \{([^}]*)\}/.exec(css);
    ok(!!regra && /line-clamp:\s*2/.test(regra[1]), 'o recorte de 2 linhas continua — só que na descrição');
    const regraGov = /\.dep-individual-list \.gov \{([^}]*)\}/.exec(css);
    ok(!!regraGov && !/line-clamp/.test(regraGov[1]), 'e a linha do governo não é recortada');
    ok(/\.dep-individual-list \.vote\.aderente/.test(css) && /\.dep-individual-list \.vote\.divergente/.test(css),
       'a etiqueta do veredito tem as cores do veredito');
    const regraMark = /\.dep-individual-list \.mark \{([^}]*)\}/.exec(css);
    ok(!!regraMark && /min-width/.test(regraMark[1]),
       'a pastilha do voto tem largura mínima — as descrições começam alinhadas');
    ok(!!regraMark && !/#3ad97d|#f05454/.test(regraMark[1]),
       'e é neutra: nesta lista a cor é do veredito, não do voto');
  }

  console.log('\n== ausência: nem voto nem falso veredito ==');
  {
    ctx.__ctx = { qualifying: [
      votacao('v5', 'Aprovada a Redação Final.', 'Sim', null, '2026-08-10T15:00:00-03:00'),
      votacao('v6', 'Aprovado o Projeto.', 'Sim', 'Obstrução', '2026-08-10T16:00:00-03:00'),
    ] };
    const d2 = new DOMParser().parseFromString('<div>' + av('buildDepDetailHTML(__m, __ctx)') + '</div>', 'text/html');
    const its = [...d2.querySelectorAll('.item')];
    const ausente = its.find(i => /Voto:\s*—/.test(i.querySelector('.mark').textContent.replace(/\s+/g, ' ')));
    ok(!!ausente, 'quem não registrou voto tem a pastilha com um traço, não um voto inventado');
    ok(ausente.querySelector('.mark').getAttribute('title') === 'Não registrou voto nesta votação',
       'e o traço se explica ao passar o mouse');
    ok(ausente.querySelector('.vote').textContent.trim() === 'Ausente', 'o veredito é Ausente');
    const obstr = its.find(i => /Obstru/.test(i.querySelector('.mark').textContent));
    ok(!!obstr, 'obstrução aparece literalmente na pastilha do voto');
    ok(obstr.querySelector('.vote').textContent.trim() === 'Ausente',
       'e conta como ausente no cálculo — o que foi feito em plenário não some, nem vira adesão');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
