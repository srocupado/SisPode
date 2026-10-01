// Orçamento · Comparador de Portarias — etapa 1 (montar a sequência).
//
// O que este teste trava:
//  1. cabeçalho: tipo, sigla do órgão, número (com ponto), data ("1º de abril"),
//     órgão pelas linhas em caixa alta antes do cabeçalho — em formatos reais;
//  2. ordem cronológica (data; empate pelo número; sem data no fim);
//  3. leitura: linhas do PDF pela posição; Word (.docx de verdade, montado
//     aqui) com tabulação, quebra e entidades; página do DOU;
//  4. tela: inclusão fora de ordem sai ordenada; avisos (pouco texto =
//     possível PDF escaneado; cabeçalho não reconhecido; duplicado); mover,
//     remover e corrigir a data à mão;
//  5. registro: página e scripts no manifest; DOU liberado.
//
// Uso: node testes/portarias.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const L = require(path.join(RAIZ, 'portarias-leitura.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('1. Cabeçalho');
  const c1 = L.ptCabecalho('MINISTÉRIO DA FAZENDA\nSECRETARIA DE PRÊMIOS E APOSTAS\nPORTARIA SPA/MF Nº 615, DE 16 DE ABRIL DE 2024\nEstabelece…');
  ok(c1.tipo === 'PORTARIA' && c1.sigla === 'SPA/MF' && c1.numero === '615' && c1.data === '2024-04-16' && c1.orgao === 'MINISTÉRIO DA FAZENDA / SECRETARIA DE PRÊMIOS E APOSTAS',
    'portaria com sigla e órgão nas linhas de cima');
  const c2 = L.ptCabecalho('PORTARIA CONJUNTA MF/MPO/MGI/SRI-PR Nº 1, DE 1º DE ABRIL DE 2025');
  ok(c2.tipo === 'PORTARIA CONJUNTA' && c2.sigla === 'MF/MPO/MGI/SRI-PR' && c2.data === '2025-04-01' && c2.orgao === 'MF/MPO/MGI/SRI-PR', 'portaria conjunta, "1º de abril", órgão pela sigla');
  ok(L.ptCabecalho('PORTARIA GM/MS Nº 3.493, DE 10 DE ABRIL DE 2024').numero === '3.493', 'número com ponto de milhar');
  ok(L.ptCabecalho('INSTRUÇÃO NORMATIVA SEGES/ME Nº 65, DE 7 DE JULHO DE 2021').tipo === 'INSTRUÇÃO NORMATIVA', 'instrução normativa');
  ok(L.ptCabecalho('Portaria nº 424, de 30 de dezembro de 2016').data === '2016-12-30', 'minúsculas');
  ok(L.ptCabecalho('PORTARIA Nº 1.234/2023, DE 5 DE MAIO DE 2023').data === '2023-05-05', 'número com ano');
  ok(L.ptCabecalho('Texto qualquer sem cabeçalho de ato').identificacao === '' && L.ptCabecalho('x').data === null, 'sem cabeçalho: campos vazios (a tela pede para preencher)');

  console.log('2. Ordem cronológica');
  const ord = L.ptOrdenar([{ data: '2025-01-02', numero: '1' }, { data: null, numero: '9' }, { data: '2024-04-16', numero: '3.493' }, { data: '2024-04-16', numero: '615' }]);
  ok(ord.map(d => d.numero).join(',') === '615,3.493,1,9', 'data; empate pelo número (615 antes de 3.493); sem data no fim');

  console.log('3. Leitura');
  const linhas = L.ptLinhasDoPdf([
    { str: 'DE 10 DE MARÇO DE 2025', transform: [1, 0, 0, 1, 220, 700] }, { str: 'PORTARIA Nº 1,', transform: [1, 0, 0, 1, 100, 700] },
    { str: 'Art. 1º Fica…', transform: [1, 0, 0, 1, 100, 680] }, { str: 'MINISTÉRIO X', transform: [1, 0, 0, 1, 100, 720.6] }]);
  ok(linhas === 'MINISTÉRIO X\nPORTARIA Nº 1, DE 10 DE MARÇO DE 2025\nArt. 1º Fica…', 'PDF: pedaços recompostos em linhas, de cima para baixo e da esquerda para a direita');
  // .docx de verdade (ZIP com word/document.xml comprimido)
  const xml = '<?xml version="1.0"?><w:document><w:body>' +
    '<w:p><w:r><w:t>MINISTÉRIO DA SAÚDE</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">PORTARIA GM/MS Nº 7, </w:t></w:r><w:r><w:t>DE 3 DE FEVEREIRO DE 2025</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Art. 1º</w:t><w:tab/><w:t>Prazo &amp; regras &lt;novas&gt;</w:t><w:br/><w:t>segunda linha</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const zip = (() => {
    const entradas = [{ nome: '[Content_Types].xml', dado: Buffer.from('<Types/>'), m: 0 }, { nome: 'word/document.xml', dado: Buffer.from(xml), m: 8 }];
    const loc = [], cen = []; let off = 0;
    for (const e of entradas) {
      const comp = e.m === 8 ? zlib.deflateRawSync(e.dado) : e.dado, nome = Buffer.from(e.nome);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(e.m, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.dado.length, 22); lh.writeUInt16LE(nome.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.m, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.dado.length, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(off, 42);
      loc.push(lh, nome, comp); cen.push(ch, nome); off += 30 + nome.length + comp.length;
    }
    const cd = Buffer.concat(cen), eo = Buffer.alloc(22);
    eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entradas.length, 8); eo.writeUInt16LE(entradas.length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
    const b = Buffer.concat([...loc, cd, eo]);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  })();
  const tDocx = await L.ptLerDocx(zip);
  ok(tDocx === 'MINISTÉRIO DA SAÚDE\nPORTARIA GM/MS Nº 7, DE 3 DE FEVEREIRO DE 2025\nArt. 1º\tPrazo & regras <novas>\nsegunda linha', 'Word: parágrafos, tabulação, quebra e entidades');
  ok(L.ptCabecalho(tDocx).data === '2025-02-03' && L.ptCabecalho(tDocx).orgao === 'MINISTÉRIO DA SAÚDE', 'cabeçalho reconhecido no texto do Word');
  let erroDocx = ''; try { await L.ptLerDocx(new ArrayBuffer(40)); } catch (e) { erroDocx = e.message; }
  ok(/não é um \.docx válido/.test(erroDocx), 'arquivo que não é .docx: erro claro');
  const dou = L.ptTextoDouHtml('<html><body><span class="orgao-dou-data">Ministério da Fazenda/Secretaria Executiva</span><div class="texto-dou"><p class="identifica">PORTARIA SE/MF Nº 9, DE 4 DE MARÇO DE 2025</p><p>Art. 1º  Fica   alterado…</p></div></body></html>', DOMParser);
  ok(dou.texto === 'PORTARIA SE/MF Nº 9, DE 4 DE MARÇO DE 2025\nArt. 1º Fica alterado…' && dou.orgao === 'Ministério da Fazenda/Secretaria Executiva', 'DOU: texto do ato (.texto-dou) e órgão');
  ok(L.ptEhLinkDou('https://www.in.gov.br/web/dou/-/portaria-x') && !L.ptEhLinkDou('https://exemplo.com/x'), 'só aceita link do DOU');

  console.log('4. Tela');
  const html = fs.readFileSync(path.join(RAIZ, 'portarias.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window, Event } = parseHTML(html);
  const ctx = { document, window, DOMParser, Event, setTimeout, clearTimeout, TextDecoder, Blob, Response, console, confirm: () => true, chrome: { runtime: { getURL: p => p } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
  const av = e => vm.runInContext(e, ctx);
  const corpo = n => 'Art. 1º ' + 'Texto do procedimento. '.repeat(n);
  ctx.__t = [
    'MINISTÉRIO DA FAZENDA\nPORTARIA MF Nº 20, DE 5 DE JUNHO DE 2025\n' + corpo(20),
    'MINISTÉRIO DA SAÚDE\nPORTARIA GM/MS Nº 3, DE 2 DE JANEIRO DE 2024\n' + corpo(20),
    'Nota interna sem cabeçalho de ato',
  ];
  av(`__t.forEach((t, i) => ptIncluir(t, { tipo: 'texto colado' }))`);
  const ids = [...document.querySelectorAll('.pt-doc [data-campo="identificacao"]')].map(i => i.getAttribute('value'));
  ok(ids[0] === 'PORTARIA GM/MS Nº 3, DE 2 DE JANEIRO DE 2024' && ids[1] === 'PORTARIA MF Nº 20, DE 5 DE JUNHO DE 2025' && ids[2] === '', 'incluídos fora de ordem, saem em ordem cronológica (sem data no fim)');
  const meta = [...document.querySelectorAll('.pt-doc .meta')].map(m => m.textContent);
  ok(/pouco texto/.test(meta[2]) && /cabeçalho não reconhecido/.test(meta[2]) && !/pouco texto/.test(meta[0]), 'avisos: pouco texto (PDF escaneado?) e cabeçalho não reconhecido');
  av(`ptIncluir(__t[0], { tipo: 'texto colado' })`);
  ok(/duplicado/.test(document.querySelectorAll('.pt-doc .meta')[2].textContent), 'mesmo ato duas vezes: aviso de duplicado (não descarta)');
  ok(document.getElementById('pt-contagem').textContent === '— 4 ato(s)', 'contagem');
  // remover, mover e corrigir a data
  document.querySelectorAll('.pt-doc [data-acao="remover"]')[2].dispatchEvent(new Event('click', { bubbles: true }));
  ok(document.querySelectorAll('.pt-doc').length === 3, 'remover tira da sequência');
  document.querySelectorAll('.pt-doc [data-acao="descer"]')[0].dispatchEvent(new Event('click', { bubbles: true }));
  ok(document.querySelectorAll('.pt-doc [data-campo="identificacao"]')[0].getAttribute('value').startsWith('PORTARIA MF Nº 20'), 'mover para depois (ordem manual)');
  const semData = document.querySelectorAll('.pt-doc')[2];
  const campoData = semData.querySelector('[data-campo="data"]');
  campoData.value = '2023-12-01';
  campoData.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('pt-ordenar').dispatchEvent(new Event('click'));
  ok(av(`pt.docs[0].data`) === '2023-12-01', 'data corrigida à mão + "Reordenar por data"');

  console.log('5. Registro');
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
  const rec = man.web_accessible_resources[0].resources;
  ok(['portarias.html', 'portarias-leitura.js', 'portarias.js'].every(f => rec.includes(f)), 'página e scripts no manifest');
  ok(man.host_permissions.includes('https://www.in.gov.br/*'), 'DOU (in.gov.br) liberado');
  const panelHtml = fs.readFileSync(path.join(RAIZ, 'panel.html'), 'utf8');
  ok(/id="btn-sub-portarias"/.test(panelHtml) && /Comparador de portarias/.test(panelHtml), 'botão no modal do Orçamento');

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
