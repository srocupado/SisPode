// O texto do destaque sobrevive à votação.
//
// O defeito: no instante em que a Câmara registrava "Aprovado", o destaque
// saía da aba de ativos (SITUACOES_INATIVAS) e o card ganhava a classe
// `inativo`. O delegador de clique de lista-destaques abria o modal só para
// cards SEM essa classe — então o voto SIM, o voto NÃO, a explicação e a
// orientação que a assessoria tinha escrito ficavam inalcançáveis: estavam
// salvos na sessão e no Firebase, e não havia mais tela que os mostrasse.
//
// Mesma coisa para o destaque `naoLocalizado` (sumiu da página da Câmara mas
// tem anotação preservada): o motivo de preservá-lo é poder lê-lo.
//
// O que se trava aqui:
//   · o card inativo ABRE, e abre com o texto que a assessoria escreveu;
//   · abre em CONSULTA — campos readonly, sem Salvar, sem Gerar Análise, sem
//     autosave (anotação de destaque votado é registro, não rascunho);
//   · a faixa do modo consulta diz POR QUE está fechado (situação, ou "não
//     apareceu na última atualização");
//   · o destaque ativo continua editável e continua salvando;
//   · o CSS não volta a fazer o card inativo parecer morto.
//
// Uso: node testes/destaque-consulta.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const HTML = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8');
const FONTE = ['pauta-parser.js', 'mpv.js', 'panel.js']
  .map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');

function montarPainel() {
  const { document, window, Event } = parseHTML(HTML);
  const erros = [];
  const gravacoes = [];
  const ctx = {
    document, window, DOMParser, Event, erros, gravacoes,
    console: { log: () => {}, warn: () => {}, debug: () => {}, error: (...a) => erros.push(a.map(String).join(' ')) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async (url, opt) => { gravacoes.push({ url: String(url), metodo: opt?.method || 'GET' });
                                 return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; },
    URL, TextDecoder, AbortController, DOMException,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    chrome: {
      storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } },
      runtime: { getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '4.0.0' }), reload: () => {} },
      tabs: { create: () => {} },
    },
    pdfjsLib: { GlobalWorkerOptions: {} },
    alert: () => {}, confirm: () => false, prompt: () => null, docx: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx, { filename: 'painel.js' });
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const av = e => vm.runInContext(e, ctx);
  return { document, ctx, erros, gravacoes, av,
           clicar: sel => { const el = document.querySelector(sel); if (!el) return false;
                            el.dispatchEvent(new Event('click', { bubbles: true })); return true; } };
}

// Uma proposição com três destaques: um pendente, um APROVADO e um que sumiu
// da página da Câmara — os dois últimos com texto escrito pela assessoria.
const DESTAQUES = `[
  { "numero": "DVS 1/2026", "autoria": "PT",     "descricao": "Supressão do art. 5º",
    "ativo": true,  "situacao": "",
    "votoSim": "mantém o dispositivo", "votoNao": "suprime", "explicacao": "", "orientacao": "" },
  { "numero": "DVS 2/2026", "autoria": "PODEMOS", "descricao": "Supressão do art. 12",
    "ativo": false, "situacao": "Aprovado",
    "votoSim": "SIM mantém o art. 12 no texto",
    "votoNao": "NÃO suprime o art. 12",
    "explicacao": "O art. 12 fixa o prazo de 180 dias para a regulamentação. Sem ele, a lei passa a valer sem prazo definido.",
    "orientacao": "FAVORÁVEL" },
  { "numero": "DVS 9/2026", "autoria": "NOVO",   "descricao": "Emenda 44",
    "ativo": false, "naoLocalizado": true, "situacao": "",
    "votoSim": "texto da emenda 44", "votoNao": "texto do relator",
    "explicacao": "Anotação que não pode ser perdida.", "orientacao": "LIBERADO" }
]`;

function comDestaques(p) {
  p.av(`app.sessaoAtual = { id: 's1', nome: 'Sessão de teste', proposicoes: [] };
        app.proposicaoAtiva = { chave: 'PL 1/2026', ementa: 'Ementa de teste', idCamara: 111,
                                destaques: ${DESTAQUES} };
        app.sessaoAtual.proposicoes.push(app.proposicaoAtiva);
        app.filtroAtual = 'todos';
        renderizarDestaques();`);
}

(async () => {
  console.log('== a lista mostra o encerrado, e ele responde ao clique ==');
  const p = montarPainel();
  comDestaques(p);
  {
    const cards = p.document.querySelectorAll('.destaque-card');
    ok(cards.length === 3, `os três destaques aparecem na aba "todos" (${cards.length})`);
    ok(p.document.getElementById('badge-ativos').textContent === '1', 'só um conta como ativo');

    const inativos = p.document.querySelectorAll('.destaque-card.inativo');
    ok(inativos.length === 2, 'o aprovado e o não localizado vêm marcados como inativos');

    const modal = p.document.getElementById('modal-destaque');
    ok(modal.style.display === 'none', 'o modal começa fechado');

    // O card do APROVADO — o caso que o usuário relatou.
    ok(p.clicar('.destaque-card[data-index="1"]'), 'o card do destaque aprovado está na lista');
    ok(modal.style.display === 'flex', 'e clicar nele ABRE o modal (antes: nada acontecia)');

    const corpo = p.document.getElementById('modal-destaque-body').innerHTML;
    ok(/O art\. 12 fixa o prazo de 180 dias/.test(corpo), 'a explicação escrita pela assessoria está na tela');
    ok(/SIM mantém o art\. 12 no texto/.test(corpo), 'o voto SIM também');
    ok(/NÃO suprime o art\. 12/.test(corpo), 'o voto NÃO também');
    ok(p.document.getElementById('campo-orientacao').getAttribute('value') === 'FAVORÁVEL'
       || p.document.getElementById('campo-orientacao').value === 'FAVORÁVEL',
       'e a orientação registrada');
  }

  console.log('\n== mas abre em consulta, não em edição ==');
  {
    const corpo = p.document.getElementById('modal-destaque-body');
    ok(!!corpo.querySelector('.aviso-inativo'), 'a faixa de "somente consulta" está no topo');
    ok(/Aprovado/.test(corpo.querySelector('.aviso-inativo').textContent),
       'e diz a situação que fechou o destaque');

    for (const id of ['campo-voto-sim', 'campo-voto-nao', 'campo-explicacao', 'campo-orientacao']) {
      ok(p.document.getElementById(id).hasAttribute('readonly'), `${id} é somente leitura`);
    }
    ok(!p.document.getElementById('btn-salvar-destaque'), 'não há botão Salvar');
    ok(!p.document.getElementById('btn-gerar-ia'), 'não há Gerar Análise');
    ok(!p.document.getElementById('badge-salvo'), 'e nem a etiqueta "Salvo", que só faz sentido gravando');

    // Nada de autosave: um input no campo (teclado, colar, extensão) não pode
    // reescrever o registro de um destaque já votado.
    const antes = p.gravacoes.length;
    const campo = p.document.getElementById('campo-explicacao');
    campo.value = 'texto intruso';
    campo.dispatchEvent(new (p.ctx.Event)('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));
    ok(p.gravacoes.length === antes, 'digitar no modo consulta não dispara gravação');
    ok(p.av('app.proposicaoAtiva.destaques[1].explicacao').startsWith('O art. 12 fixa'),
       'e o texto original segue intacto no objeto');
  }

  console.log('\n== o destaque que sumiu da Câmara também se consulta ==');
  {
    ok(p.clicar('.destaque-card[data-index="2"]'), 'o card do não localizado abre');
    const aviso = p.document.getElementById('modal-destaque-body').querySelector('.aviso-inativo');
    ok(!!aviso && /última atualização/.test(aviso.textContent),
       'e a faixa explica que ele não apareceu na última atualização da página');
    ok(/Anotação que não pode ser perdida/.test(p.document.getElementById('modal-destaque-body').innerHTML),
       'com a anotação preservada à vista');
  }

  console.log('\n== o destaque pendente continua de edição ==');
  {
    ok(p.clicar('.destaque-card[data-index="0"]'), 'o card ativo abre');
    const corpo = p.document.getElementById('modal-destaque-body');
    ok(!corpo.querySelector('.aviso-inativo'), 'sem faixa de consulta');
    ok(!p.document.getElementById('campo-explicacao').hasAttribute('readonly'), 'a explicação é editável');
    ok(!!p.document.getElementById('btn-salvar-destaque'), 'o botão Salvar está lá');
    ok(!!p.document.getElementById('badge-salvo'), 'e a etiqueta de salvo também');

    const antes = p.gravacoes.length;
    const campo = p.document.getElementById('campo-explicacao');
    campo.value = 'análise em andamento';
    campo.dispatchEvent(new (p.ctx.Event)('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    ok(p.gravacoes.length > antes, 'e o autosave continua gravando');
    ok(p.av('app.proposicaoAtiva.destaques[0].explicacao') === 'análise em andamento',
       'com o texto no destaque certo');
  }

  console.log('\n== o CSS não desfaz o conserto ==');
  {
    const css = fs.readFileSync(path.join(RAIZ, 'panel.css'), 'utf8');
    const bloco = /\.destaque-card\.inativo\s*\{([^}]*)\}/.exec(css);
    ok(!!bloco && /cursor:\s*pointer/.test(bloco[1]),
       'o card inativo tem cursor de clique — ele é clicável agora');
    ok(!!bloco && !/cursor:\s*default/.test(bloco[1]), 'e não o cursor de "não faz nada"');
    ok(/\.campo-editavel\[readonly\]/.test(css), 'há estilo próprio para os campos em consulta');
    ok(/\.aviso-inativo\s*\{/.test(css), 'e para a faixa do modo consulta');
  }

  ok(!p.erros.length, p.erros.length ? `erro no console: ${p.erros[0]}` : 'nenhum erro no console');
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
