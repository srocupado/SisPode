// Orçamento · Comparador de Portarias — a SEQUÊNCIA (limpeza e relações, sem IA).
//
// Amostras no formato dos atos reais da equipe (impressos do gov.br/Transferegov):
//  1. limpeza: moldura do site (ícones na área de uso privado, "Transferegov.br",
//     "〉 〉 PORTARIA…", "Publicado em…", cookies) sai; ligadura "fi" partida é
//     consertada SEM colar palavras ("recursos fi nanceiros", "a fi m de", "sem fi ns");
//  2. relações: revoga (por inteiro) × altera (ementa ou revogação de dispositivos);
//     ", que dispõe sobre o Decreto…" não é ato alterado; marca de consolidação e
//     assinatura/anexo depois do "Ficam revogadas" não viram ato revogado;
//  3. marcadores de consolidação por ato;
//  4. sequência: presença na lista e atos alterados que faltam;
//  5. tela: texto limpo na inclusão, chips de relação e aviso de ato faltando.
//
// Uso: node testes/portarias-sequencia.test.js
process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const S = require(path.join(RAIZ, 'portarias-sequencia.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

console.log('1. Limpeza');
const bruto = [
  'Ir para o conteúdo 1 Ir para a navegação 2 Ir para a busca 3 Ir para o rodapé  ',
  ' Transferegov.br',
  ' 〉  〉 PORTARIA CONJUNTA MGI/MF/CGU Nº 33, DE 30 DE AGOSTO DE 2023',
  'PORTARIA CONJUNTA MGI/MF/CGU Nº 33, DE 30 DE AGOSTO DE 2023',
  'Publicado em 31/08/2023 10:00 Modi fi cado há 2 anos',
  'Compartilhe:',
  'Art. 1º O regime simpli fi cado e a veri fi cação dos recursos fi nanceiros, a fi m de',
  'atender entidades sem fi ns lucrativos, no sítio o fi cial e de fi nição da instituição fi nanceira,',
  'de fi nanças e e fi scalização, consulta ao Sicon fi , beneficiários fi nais.',
  'Os recursos e as entidades e a instituição e o sítio e os beneficiários.',
  'Rede fi nir Cookies',
  '〉',
].join('\n');
const L = S.ptLimpar(bruto);
ok(L.texto.startsWith('PORTARIA CONJUNTA MGI/MF/CGU Nº 33'), 'moldura do site sai; o texto começa no título do ato');
ok(!/Transferegov|〉|[-]|Publicado|Modificado|Compartilhe|Cookies/.test(L.texto), 'sem ícones, migalha, datas de publicação nem cookies');
ok(/regime simplificado e a verificação dos recursos financeiros, a fim de/.test(L.texto), 'ligadura no meio da palavra junta; "recursos financeiros" e "a fim" separados');
ok(/sem fins lucrativos, no sítio oficial e definição da instituição financeira/.test(L.texto), '"sem fins", "oficial", "definição", "instituição financeira"');
ok(/de finanças e e fiscalização, consulta ao Siconfi, beneficiários finais\./.test(L.texto), '"de finanças", "e fiscalização", "Siconfi", "beneficiários finais"');
ok(L.removidas >= 6 && L.ligaduras >= 12, `contagens (${L.removidas} linhas, ${L.ligaduras} ligaduras)`);

console.log('2. Relações');
const r29 = S.ptRelacoes('PORTARIA CONJUNTA MGI/MF/CGU Nº 29, DE 22 DE MAIO DE 2024\nAltera a Portaria Conjunta MGI/MF/CGU nº 33, de 30 de agosto de 2023, que estabelece normas complementares ao Decreto nº 11.531, de 16 de maio de 2023. Art. 1º …', '29/2024');
ok(r29.altera.map(x => x.chave).join() === '33/2023' && !r29.revoga.length, 'ementa "Altera a…": só o ato alterado (o Decreto citado depois de ", que" fica de fora)');
const r424 = S.ptRelacoes('PORTARIA INTERMINISTERIAL Nº 424, DE 30 DE DEZEMBRO DE 2016\nEstabelece normas… Art. 5º O prazo é de 30 dias. (Alterado pela Portaria Interministerial nº 101, de 20 de abril de 2017) Art. 6º … Art. 113. Ficam revogadas a Portaria Interministerial MP/MF/CGU nº 507, de 24 de novembro de 2011, e a Instrução Normativa nº 01, de 15 de janeiro de 1997, da Secretaria do Tesouro Nacional. DYOGO HENRIQUE DE OLIVEIRA Ministro ANEXO conforme a Portaria nº 101, de 20 de abril de 2017', '424/2016');
ok(r424.revoga.map(x => x.chave).join() === '507/2011,1/1997', 'revoga por inteiro; marca de consolidação e anexo depois da assinatura não contam');
const rParcial = S.ptRelacoes('PORTARIA Nº 45, DE 10 DE JULHO DE 2026\nDispõe sobre… Art. 3º Ficam revogados os seguintes dispositivos da Portaria Conjunta MGI/MF/CGU nº 33, de 30 de agosto de 2023: I - o art. 5º;', '45/2026');
ok(rParcial.altera.map(x => x.chave).join() === '33/2023' && !rParcial.revoga.length, 'revogar dispositivos = alterar');
const r507 = S.ptRelacoes('Portaria Interministerial nº 507, de 24 de novembro de 2011 (Revogada pela Portaria Interministerial nº 424, de 30 de dezembro de 2016) Art. 1º …', '507/2011');
ok(r507.revogadoPor && r507.revogadoPor.chave === '424/2016', 'revogada pela… (versão do site)');

console.log('3. Marcadores de consolidação');
const mk = S.ptMarcadores('Art. 2º … (Redação dada pela Portaria Conjunta MGI/MF/CGU nº 29, de 22 de maio de 2024) Art. 3º … (Incluído pela Portaria Conjunta MGI/MF/CGU nº 29, de 22 de maio de 2024) Art. 4º (Revogado pela Portaria Conjunta MGI/MF/CGU nº 29, de 22 de maio de 2024) Art. 5º (Incluído pela Portaria Conjunta MGI/MF/CGU nº 45, de 10 de julho de 2026)');
ok(mk.length === 2 && mk[0].chave === '29/2024' && mk[0].redacao === 1 && mk[0].inclusao === 1 && mk[0].revogacao === 1 && mk[1].chave === '45/2026', 'conta redação/inclusão/revogação por ato, do maior ao menor');

console.log('4. Sequência');
const docs = [
  { id: 1, numero: '33', data: '2023-08-30', texto: 'Art. 1º … (Redação dada pela Portaria Conjunta MGI/MF/CGU nº 29, de 22 de maio de 2024)' },
  { id: 2, numero: '29', data: '2024-05-22', texto: 'Altera a Portaria Conjunta MGI/MF/CGU nº 33, de 30 de agosto de 2023. Art. 1º' },
  { id: 3, numero: '3', data: '2026-09-21', texto: 'Altera a Portaria Conjunta MPO/MGI/SRI-PR nº 2, de 15 de janeiro de 2026. Art. 1º' },
];
const seq = S.ptSequencia(docs);
ok(seq.atos[1].altera[0].presente === true && seq.atos[0].marcadores[0].presente === true, 'ato alterado/consolidador presente na lista: marcado');
ok(seq.faltando.length === 1 && seq.faltando[0].chave === '2/2026' && seq.faltando[0].citadoPor === '3/2026', 'ato alterado fora da lista: avisado');

console.log('5. Tela');
const html = fs.readFileSync(path.join(RAIZ, 'portarias.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
ok(scripts.indexOf('portarias-sequencia.js') > -1 && scripts.indexOf('portarias-sequencia.js') < scripts.indexOf('portarias.js'), 'script carregado antes da tela');
const { document, window, Event } = parseHTML(html);
const ctx = { document, window, DOMParser, Event, setTimeout, clearTimeout, TextDecoder, console, confirm: () => true, chrome: { runtime: { getURL: p => p } } };
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
const corpo = 'Art. 1º Texto do procedimento. '.repeat(10);
ctx.__t = [
  ' Transferegov.br\n〉 〉 PORTARIA CONJUNTA MGI/MF/CGU Nº 33, DE 30 DE AGOSTO DE 2023\nPORTARIA CONJUNTA MGI/MF/CGU Nº 33, DE 30 DE AGOSTO DE 2023\n' + corpo + 'Art. 9º Ficam revogadas a Portaria Interministerial nº 424, de 30 de dezembro de 2016. JOÃO DA SILVA',
  'PORTARIA CONJUNTA MPO/MGI/SRI-PR Nº 3, DE 21 DE SETEMBRO DE 2026\nAltera a Portaria Conjunta MPO/MGI/SRI-PR nº 2, de 15 de janeiro de 2026. ' + corpo,
];
vm.runInContext(`__t.forEach(t => ptIncluir(t, { tipo: 'PDF', nome: 'x.pdf' }))`, ctx);
const d0 = vm.runInContext('pt.docs[0]', ctx);
ok(d0.texto.startsWith('PORTARIA CONJUNTA MGI/MF/CGU Nº 33') && d0.identificacao.startsWith('PORTARIA CONJUNTA MGI/MF/CGU Nº 33'), 'texto limpo na inclusão; cabeçalho lido do texto limpo');
ok(/linha\(s\) de moldura/.test(document.querySelector('.pt-doc .meta').textContent), 'meta informa a limpeza');
const chips = [...document.querySelectorAll('.pt-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
ok(chips.includes('revoga 424/2016 (fora da lista)') && chips.includes('altera 2/2026 (fora da lista)'), 'chips de relação com "fora da lista"');
ok(/Portaria Conjunta MPO\/MGI\/SRI-PR nº 2, de 15 de janeiro de 2026/.test(document.getElementById('pt-faltando').textContent), 'aviso do ato alterado que falta');
vm.runInContext(`pt.docs = []; ptRender()`, ctx);
ok(document.getElementById('pt-faltando').textContent === '', 'lista vazia: sem aviso');

const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
ok(man.web_accessible_resources[0].resources.includes('portarias-sequencia.js'), 'script no manifest');

console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
