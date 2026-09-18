// Aba "Radar temático" do módulo Relatórios.
//
// Duas medições da API em 18/09/2026 desenharam esta tela, e as duas estão
// travadas aqui:
//
//  1. `codTema` NÃO compõe com `dataApresentacaoInicio/Fim` — a combinação
//     devolve HTTP 400. Compõe com `ano`. Se alguém "melhorar" a tela trocando
//     o recorte por intervalo de datas, a busca passa a falhar sempre.
//  2. Marcar a autoria da bancada NÃO precisa de uma chamada por proposição:
//     a mesma busca restrita a `siglaPartidoAutor` devolve o subconjunto do
//     partido, e cruzar os ids resolve em duas chamadas por ano. Numa busca de
//     717 proposições — medido, tema Direito Penal, PL, 2026 — isso é a
//     diferença entre 2 chamadas e 717.
//
// Uso: node testes/radar.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const html = fs.readFileSync(path.join(RAIZ, 'aderencia.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
const { document, window, Event } = parseHTML(html);

// ---------- API de mentira, com o comportamento MEDIDO ----------
const api = { props: [], temas: [], chamadas: [] };
const resp = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
const erro = (s, txt) => ({ ok: false, status: s, json: async () => ({}), text: async () => txt || '' });

const ctx = {
  document, window, DOMParser, Event, setTimeout, clearTimeout, URL, TextDecoder,
  // aderencia.html passou a carregar ia-comum.js, que declara um
  // AbortController no topo do arquivo. Sem ele no contexto, NENHUM script
  // da página chega a ser avaliado.
  AbortController, TextEncoder, Blob, Response, Headers, Request, btoa,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  requestAnimationFrame: () => 0,
  XLSX: { utils: { book_new: () => ({ abas: {} }), aoa_to_sheet: r => ({ _r: r }),
                   book_append_sheet: (wb, ws, nome) => { wb.abas[nome] = ws; } },
          writeFile: (wb, nome) => { api.planilha = { wb, nome }; } },
  fetch: async (url) => {
    const u = String(url);
    api.chamadas.push(u);
    if (/\/referencias\/proposicoes\/codTema/.test(u)) return resp({ dados: api.temas });
    if (/\/proposicoes\?/.test(u)) {
      // A armadilha, reproduzida: tema com intervalo de datas é HTTP 400.
      if (/codTema=/.test(u) && /dataApresentacao(Inicio|Fim)=/.test(u)) {
        return erro(400, '{"status":400,"detail":"Parâmetro(s) inválido(s)."}');
      }
      const q = new URL(u).searchParams;
      const tema = q.get('codTema'), ano = q.get('ano'), tipo = q.get('siglaTipo');
      const partido = q.get('siglaPartidoAutor'), kw = q.get('keywords');
      const pag = Number(q.get('pagina') || 1);
      let lista = api.props.filter(p =>
        (!tema || String(p.tema) === tema) &&
        (!ano || String(p.ano) === ano) &&
        (!tipo || p.siglaTipo === tipo) &&
        (!partido || p.partido === partido) &&
        (!kw || new RegExp(kw, 'i').test(p.ementa)));
      const fatia = lista.slice((pag - 1) * 100, pag * 100);
      const temMais = lista.length > pag * 100;
      const base = u.replace(/[?&]pagina=\d+/, '');
      return resp({ dados: fatia, links: temMais ? [{ rel: 'next', href: base + '&pagina=' + (pag + 1) }] : [] });
    }
    if (/\/deputados\?nome=/.test(u)) return resp({ dados: [] });
    return erro(599);
  },
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: () => {} } }, runtime: { getURL: p => p } },
  alert: () => {}, confirm: () => false,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

// ---------- material ----------
api.temas = [{ cod: 43, nome: 'Direito Penal e Processual Penal' }, { cod: 46, nome: 'Educação' }];
let id = 5000;
const nova = (tema, ano, partido, siglaTipo, ementa) => {
  api.props.push({ id: ++id, siglaTipo: siglaTipo || 'PL', numero: id, ano, tema,
                   partido, ementa: ementa || `Altera a lei sobre o assunto ${id}.`,
                   dataApresentacao: `${ano}-05-10T10:00` });
};
// Tema 43 em 2026: 8 proposições, 3 do PODE. E um PL de outro tipo e outro ano.
for (let i = 0; i < 5; i++) nova(43, 2026, 'PT');
for (let i = 0; i < 3; i++) nova(43, 2026, 'PODE');
nova(43, 2026, 'PT', 'PEC');
nova(43, 2025, 'PODE');
nova(46, 2026, 'PODE', 'PL', 'Trata de saneamento nas escolas.');

const marcarTema = cod => {
  const sel = document.getElementById('rdrTema');
  // linkedom não implementa select.value; marca-se a opção, como o navegador
  // faria ao escolher na lista.
  sel.innerHTML = api.temas.map(t => `<option value="${t.cod}">${t.nome}</option>`).join('')
    + '<option value="">— qualquer tema —</option>';
  sel.querySelector(`option[value="${cod}"]`).selected = true;
};

(async () => {
  console.log('== a aba existe e troca ==');
  {
    ok(!!document.getElementById('aba-radar'), 'a aba "Radar temático" está no HTML');
    ok(document.getElementById('painel-radar').hidden === true, 'e começa escondida');
    document.getElementById('aba-radar').dispatchEvent(new Event('click', { bubbles: true }));
    ok(document.getElementById('painel-radar').hidden === false, 'clicar abre o painel');
    ok(document.getElementById('painel-aderencia').hidden === true, 'e fecha os outros');
  }

  console.log('\n== os temas vêm da Câmara, não de lista chumbada ==');
  {
    const ts = await av('rdrCarregarTemas()');
    ok(ts.length === 2 && ts[0].nome === 'Direito Penal e Processual Penal',
       'a lista de temas é carregada da referência da própria Câmara');
    ok(api.chamadas.some(c => /referencias\/proposicoes\/codTema/.test(c)),
       'por /referencias/proposicoes/codTema');
  }

  console.log('\n== o recorte é por ANO, porque a API recusa datas com tema ==');
  {
    marcarTema(43);
    document.getElementById('rdrAnoIni').value = '2026';
    document.getElementById('rdrAnoFim').value = '2026';
    document.getElementById('rdrTipo').value = '';
    document.getElementById('rdrPalavra').value = '';
    api.chamadas.length = 0;
    await av('rdrConsultar()');

    ok(!api.chamadas.some(c => /dataApresentacao/.test(c)),
       'nenhuma chamada mistura tema com intervalo de datas — seria HTTP 400');
    ok(api.chamadas.every(c => !/proposicoes\?/.test(c) || /[?&]ano=\d{4}/.test(c)),
       'toda busca de proposição passa o ano');
    const u = av('rdr.ultimo');
    ok(u.itens.length === 9, `as 9 do tema 43 em 2026 entram (${u.itens.length})`);
  }

  console.log('\n== a bancada é marcada sem uma chamada por proposição ==');
  {
    const u = av('rdr.ultimo');
    ok(u.nBancada === 3, `3 são do PODE (${u.nBancada})`);
    const buscas = api.chamadas.filter(c => /proposicoes\?/.test(c)).length;
    ok(buscas === 2,
       `duas chamadas para nove proposições — a do conjunto e a do partido (${buscas})`);
    ok(api.chamadas.some(c => /siglaPartidoAutor=PODE/.test(c)),
       'a segunda é a mesma busca restrita ao partido');

    const marcadas = [...u.daBancada];
    ok(marcadas.length === 3 && marcadas.every(idp => {
      const p = api.props.find(x => x.id === idp);
      return p && p.partido === 'PODE';
    }), 'e as marcadas são exatamente as do partido — é autoria registrada, não inferência pelo nome');
  }

  console.log('\n== a tela marca, e o filtro "só da bancada" não reconsulta ==');
  {
    const bruto = document.getElementById('rdrResultado').innerHTML;
    ok((bruto.match(/rdr-bancada/g) || []).length === 3, 'as três linhas da bancada vêm marcadas');

    const antes = api.chamadas.length;
    document.getElementById('rdrSoBancada').checked = true;
    document.getElementById('rdrSoBancada').dispatchEvent(new Event('change', { bubbles: true }));
    ok(api.chamadas.length === antes, 'marcar "só da bancada" NÃO consulta a API de novo');
    ok(av('rdr.ultimo.lista.length') === 3, 'e a lista encolhe para as 3 da bancada');
    ok(av('rdr.ultimo.itens.length') === 9, 'o conjunto inteiro continua em mãos');
    document.getElementById('rdrSoBancada').checked = false;
    document.getElementById('rdrSoBancada').dispatchEvent(new Event('change', { bubbles: true }));
  }

  console.log('\n== vários anos, e nada em duplicidade ==');
  {
    document.getElementById('rdrAnoIni').value = '2025';
    document.getElementById('rdrAnoFim').value = '2026';
    api.chamadas.length = 0;
    await av('rdrConsultar()');
    const u = av('rdr.ultimo');
    ok(u.itens.length === 10, `os dois anos somam 10 (${u.itens.length})`);
    ok(new Set(u.itens.map(p => p.id)).size === u.itens.length, 'sem proposição repetida');
    const anos = [...new Set(api.chamadas.map(c => (c.match(/[?&]ano=(\d{4})/) || [])[1]).filter(Boolean))];
    ok(anos.sort().join(',') === '2025,2026', `uma consulta por ano (${anos.join(', ')})`);
  }

  console.log('\n== os filtros compõem ==');
  {
    document.getElementById('rdrAnoIni').value = '2026';
    document.getElementById('rdrAnoFim').value = '2026';
    document.getElementById('rdrTipo').value = 'pec';
    await av('rdrConsultar()');
    ok(av('rdr.ultimo').itens.length === 1, 'o tipo filtra, e em maiúsculas mesmo digitado minúsculo');

    document.getElementById('rdrTipo').value = '';
    marcarTema('');
    document.getElementById('rdrPalavra').value = 'saneamento';
    await av('rdrConsultar()');
    const u = av('rdr.ultimo');
    ok(u.itens.length === 1 && /saneamento/i.test(u.itens[0].ementa),
       'palavra-chave sozinha também busca, sem tema');
  }

  console.log('\n== o que a tela recusa antes de consultar ==');
  {
    marcarTema('');
    document.getElementById('rdrPalavra').value = '';
    await av('rdrConsultar()');
    ok(/Escolha um tema ou informe uma palavra-chave/.test(document.getElementById('rdrStatus').textContent),
       'sem tema e sem palavra, não consulta a Casa inteira');

    marcarTema(43);
    document.getElementById('rdrAnoIni').value = '2026';
    document.getElementById('rdrAnoFim').value = '2020';
    await av('rdrConsultar()');
    ok(/ano inicial é posterior/.test(document.getElementById('rdrStatus').textContent),
       'intervalo invertido é dito');

    document.getElementById('rdrAnoFim').value = '2050';
    await av('rdrConsultar()');
    ok(/8 anos/.test(document.getElementById('rdrStatus').textContent),
       'e o intervalo grande demais é recusado, em vez de rodar 25 anos de consulta');
  }

  console.log('\n== o documento ==');
  {
    document.getElementById('rdrAnoIni').value = '2026';
    document.getElementById('rdrAnoFim').value = '2026';
    await av('rdrConsultar()');
    const doc = av('rdrHtmlPDF(null)');
    const plano = doc.replace(/\s+/g, ' ');
    ok(/^<!DOCTYPE html>/.test(doc), 'é um documento completo');
    ok(/Direito Penal e Processual Penal/.test(doc), 'com o tema no cabeçalho');
    // <span class="marca"> aparece também na nota que explica a marca; só as
    // <div> são linhas da tabela.
    ok((doc.match(/<div class="marca">BANCADA<\/div>/g) || []).length === 3,
       'as três da bancada marcadas na tabela');
    ok(/é autoria registrada na base, não inferência a partir do nome/.test(plano),
       'e o documento diz de onde vem a marca — não é dedução pelo nome do autor');
    ok(/apresentadas<\/b> no período/.test(plano.replace(/<b>/g, '<b>')) || /apresentadas/.test(plano),
       'diz que a lista é de proposições apresentadas, não das que tramitam hoje');
    ok(/fichadetramitacao\?idProposicao=/.test(doc), 'cada linha leva o link da ficha');
  }

  console.log('\n== a planilha ==');
  {
    av('rdrExportar()');
    const linhas = api.planilha.wb.abas['Radar']._r;
    ok(linhas.length === 10, `nove proposições e o cabeçalho (${linhas.length - 1})`);
    ok(linhas[0].includes('Da bancada'), 'com coluna dizendo o que é da bancada');
    ok(linhas.filter(l => l[4] === 'sim').length === 3, 'e três linhas marcadas');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
