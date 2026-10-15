// Orçamento · Notas de portarias — NOTA TÉCNICA DE ATO QUE ALTERA OUTRO.
//
// A nota técnica de uma portaria que altera outra lia os artigos ("o art. 2º-A
// define competências…") sem dizer o que mudava. Agora ela compara com o ato
// alterado (buscado no DOU) e diz, para cada dispositivo, antes × agora, efeito,
// quem é impactado e a base legal. Caso real: Portaria Conjunta MPO/MGI/SRI-PR
// nº 3/2026, que altera a nº 2/2026 (textos do DOU em testes/portarias/).
//
// O que este teste trava:
//  1. inventário por máquina: 29 entradas (art. 2º desmembrado; incisos
//     comparados pelo nome; parágrafo único → § 1º; artigo-base dos novos);
//  2. cobertura e agrupamento: chave de cada dispositivo; item com mais de 3
//     dispositivos, intervalo ou artigos-base diferentes é recusado;
//  3. segunda leitura do "antes": só troca com o trecho antigo LITERAL no ato
//     alterado; sem prova, marca; trecho com "[...]" vira o pedaço literal;
//  4. conferência: trecho no ato novo, trecho anterior no ato alterado, base
//     legal com norma que o ato não cita;
//  5. busca do DOU pelo nome do ato alterado;
//  6. tela (IA e DOU simulados): nota com "O que muda, ponto a ponto", item mal
//     agrupado refeito no complemento, "antes" corrigido com prova (inclusive na
//     segunda tentativa), PDF só com o conferido, rodapé, texto para o SEI;
//     sem o ato alterado, a nota técnica comum com aviso.
//
// Uso: node testes/portarias-nota-tecnica.test.js
process.env.TZ = 'America/Sao_Paulo';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const { DOMParser, parseHTML } = require(path.join(RAIZ, 'bot', 'node_modules', 'linkedom'));
const N = require(path.join(RAIZ, 'portarias-nota.js'));
const L = require(path.join(RAIZ, 'portarias-leitura.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const NOVO = fs.readFileSync(path.join(__dirname, 'portarias', 'portaria-conjunta-mpo-mgi-sri-pr-3-2026.txt'), 'utf8');
const ANT = fs.readFileSync(path.join(__dirname, 'portarias', 'portaria-conjunta-mpo-mgi-sri-pr-2-2026.txt'), 'utf8');
const BUSCA = fs.readFileSync(path.join(__dirname, 'portarias', 'busca-dou-portaria-conjunta-2-2026.html'), 'utf8');

console.log('1. Inventário das alterações (máquina)');
const inv = N.ptInventarioAlteracoes(NOVO, ANT);
ok(inv.length === 29, `29 entradas (${inv.length})`);
ok(inv.filter(b => b.natureza === 'novo').length === 19 && inv.filter(b => /^Art\. 2º, § [1-6]º$/.test(b.id)).length === 6, '19 dispositivos novos; o art. 2º desmembrado em §§ 1º a 6º');
const incisos = inv.find(b => /incisos XXI a XXX/.test(b.id));
ok(incisos && /"ciclo de execução" \(era o inciso XXIII, agora XXIV\)/.test(incisos.obs) && /"processos participativos" \(XXVIII\)/.test(incisos.obs), 'incisos comparados pelo nome: ciclo de execução mudou de número; processos participativos é novo');
const p1 = inv.find(b => b.id === 'Art. 2º, § 1º');
ok(/PARÁGRAFO ÚNICO/.test(p1.obs) && /^Parágrafo único: Para fins do disposto nos incisos XXI e XXII/.test(p1.antes), 'o antigo parágrafo único é o "antes" do novo § 1º');
const a34 = inv.find(b => b.id === 'Art. 34-A');
ok(a34.natureza === 'novo' && a34.base.id === 'Art. 34' && /individualização da emenda/.test(a34.base.texto), 'art. 34-A: novo, com o art. 34 antigo (que já falava da individualização) como base');
ok(inv.find(b => b.id === 'Art. 34, § 4º').natureza === 'nova redação' && /parágrafo novo/.test(inv.find(b => b.id === 'Art. 34, § 4º').obs), 'art. 34, § 4º: parágrafo novo de artigo que já existia');

console.log('2. Cobertura e agrupamento');
ok(N.ptChaveDispositivo('Art. 2º, § 1º') === 'art2§1' && N.ptChaveDispositivo('Art. 2º, incisos XXI a XXX') === 'art2inc' && N.ptChaveDispositivo('Art. 2º, XXI a XXX') === 'art2inc'
  && N.ptChaveDispositivo('Art. 34-A') === 'art34-A' && N.ptChaveDispositivo('Art. 34 - A') === 'art34-A' && N.ptChaveDispositivo('vigência') === null, 'chave de cada dispositivo citado');
ok(N.ptAgrupamentoValido({ dispositivos: ['Art. 34-B', 'Art. 34-C'] }) && N.ptAgrupamentoValido({ dispositivos: ['Art. 34, § 4º', 'Art. 34-A'] }), 'aceita até 3 do mesmo artigo-base');
ok(!N.ptAgrupamentoValido({ dispositivos: ['Art. 8º-A', 'Art. 34, § 4º'] }), 'recusa artigos-base diferentes (emenda individual × bancada)');
ok(!N.ptAgrupamentoValido({ dispositivos: ['Art. 40-A a 40-D'] }) && !N.ptAgrupamentoValido({ dispositivos: ['Art. 34-A', 'Art. 34-B', 'Art. 34-C', 'Art. 34-D'] }) && !N.ptAgrupamentoValido({ dispositivos: [] }),
  'recusa intervalo, mais de 3 e item sem dispositivo');
const falt = N.ptInventarioFaltando(inv, [{ dispositivos: ['Art. 1º'] }, { dispositivos: ['Art. 2º, XXI a XXX'] }]);
ok(falt.length === 27 && !falt.some(b => b.id === 'Art. 1º' || /incisos/.test(b.id)), 'o que falta: as 27 entradas não cobertas');
const ord = N.ptOrdenarAlteracoes(inv, [{ tema: 'b', dispositivos: ['Art. 34-A'] }, { tema: 'a', dispositivos: ['Art. 1º'] }, { tema: 'dup', dispositivos: ['Art. 34-A'] }]);
ok(ord.map(a => a.tema).join() === 'a,b', 'ordem do inventário, sem duplicata');

console.log('3. Segunda leitura do "antes"');
ok(N.ptNegaRegraAnterior('não havia regra sobre isso no ato alterado') && N.ptNegaRegraAnterior('O art. 34 apenas tratava do ofício') && N.ptNegaRegraAnterior('')
  && !N.ptNegaRegraAnterior('O art. 34, § 2º, I, já previa a avaliação da individualização.'), 'quais "antes" passam pela segunda leitura');
const itens = [{ dispositivos: ['Art. 34-A'], antes: 'O art. 34 apenas tratava do ofício.' }, { dispositivos: ['Art. 2º-B'], antes: 'não havia regra' }, { dispositivos: ['Art. 40-A'], antes: 'não havia regra' }];
const log = N.ptAplicarVerificacao(itens, { itens: [
  { n: 1, ja_tratava: true, onde: 'Art. 34, § 2º, I', trecho_antes: 'I - a individualização da emenda [...] seu caráter estruturante, conforme disposto na Lei Complementar nº 210', antes: 'O art. 34, § 2º, I, já mandava avaliar a individualização.', diferenca: 'Agora é vedada.' },
  { n: 2, ja_tratava: true, onde: 'Art. 34, § 2º, II', trecho_antes: 'o órgão deverá exigir o Obrasgov em todas as obras de bancada estadual', antes: 'já exigia' },
  { n: 3, ja_tratava: false, antes: 'não havia regra' }] }, ANT);
const cpt = t => t.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
ok(itens[0].verificado === 'corrigido' && itens[0].antes === 'O art. 34, § 2º, I, já mandava avaliar a individualização. Agora é vedada.' && cpt(ANT).includes(cpt(itens[0].trecho_antes)) && !/\[/.test(itens[0].trecho_antes),
  'com o trecho antigo literal (mesmo vindo com "[...]"): "antes" corrigido, e o trecho reduzido ao pedaço literal');
ok(itens[1].verificado === 'sem_prova' && itens[1].antes === 'não havia regra' && itens[1].antecedenteSugerido === 'Art. 34, § 2º, II', 'trecho que não existe no ato alterado: nada muda, fica marcado');
ok(itens[2].verificado === 'confirmado' && log.length === 1, 'confirmado quando não havia; registro só da correção');
ok(N.ptRepararTrecho('Art. 7º-A. A alocação de recursos de emendas individuais [...] deverá observar o rol de ações orçamentárias constante da portaria específica', cpt(NOVO))
  === 'deverá observar o rol de ações orçamentárias constante da portaria específica', 'trecho com "[...]": fica o maior pedaço que existe literalmente no ato');

console.log('4. Conferência');
const conf = N.ptConferirNotaTecnica({ assunto: 'x', resumo: 'y', analise: ['p1', 'p2'],
  alteracoes: [
    { tema: 'Bancada', dispositivos: ['Art. 34-A'], natureza: 'novo', antes: 'a', depois: 'b', efeito: 'c', impactados: [{ quem: 'Bancada', como: 'd' }], base_legal: 'CF, art. 166, § 12',
      trecho: 'vedada a individualização de ações e de projetos para atender a demandas ou a indicações de cada membro da bancada', trecho_antes: 'I - a individualização da emenda para não descaracterizar seu caráter estruturante' },
    { tema: 'Transparência', dispositivos: ['Art. 45-A'], antes: 'a', depois: 'b', efeito: 'c', base_legal: 'Lei de Acesso à Informação (Lei nº 12.527/2011)', trecho: 'Os Ministérios deverão informar em seus sítios eletrônicos oficiais' },
    { tema: 'Antes inventado', dispositivos: ['Art. 2º-B'], antes: 'a', depois: 'b', efeito: 'c', trecho: 'devem estar registrados no Cadastro Integrado de Projetos de Investimento - Obrasgov.br', trecho_antes: 'o órgão deverá exigir o Obrasgov em todas as obras de bancada estadual' }],
  prazos: [{ prazo: '30 de setembro', evento: 'portaria setorial', mudou: 'prazo novo', artigos: ['Art. 1º'], trecho: 'A publicação da portaria setorial deverá ser realizada até o dia 30 de setembro' }],
  aplicacao_temporal: { texto: '2027', artigos: ['Art. 2º'], trecho: 'relativas ao exercício orçamentário de 2027, não alcançando as emendas parlamentares aprovadas para os exercícios de 2026' } }, NOVO, ANT);
const [c1, c2, c3] = conf.nota.alteracoes;
ok(c1.conferido && c1.impactados.length === 1 && conf.nota.analise.length === 2, 'item com trecho novo e trecho anterior literais: conferido');
ok(!c2.conferido && c2.problemas.includes('base legal cita norma que o ato não menciona'), 'base legal com a Lei de Acesso à Informação, que o ato não cita: marcada');
ok(!c3.conferido && c3.problemas.includes('trecho anterior não localizado no ato alterado'), '"trecho_antes" que não está no ato alterado: marcado');
ok(conf.nota.prazos[0].conferido && conf.nota.aplicacao_temporal.conferido && conf.total === 5 && conf.conferidos === 3, `prazos e aplicação no tempo conferidos; contagem ${conf.conferidos}/${conf.total}`);
const txt = N.ptNotaTexto(conf.nota, { tipo: 'tecnica', identificacao: 'PORTARIA 3' });
ok(/ANÁLISE/.test(txt) && /O QUE MUDA, PONTO A PONTO/.test(txt) && /Antes: a/.test(txt) && /Impacto — Bancada: d/.test(txt) && /APLICAÇÃO NO TEMPO/.test(txt) && /\[conferir\]/.test(txt), 'texto para o SEI com análise, o que muda e aplicação no tempo');

console.log('5. Prompts');
const pg = N.ptPromptTecnicaGeral({ cab: { identificacao: 'PORTARIA 3' }, rel: { altera: [{ rotulo: 'Portaria 2' }] }, inv, texto: NOVO, alterado: { identificacao: 'PORTARIA 2' } });
ok(/PARTE GERAL/.test(pg) && /"analise"/.test(pg) && /"aplicacao_temporal"/.test(pg) && !/"alteracoes"/.test(pg) && /INVENTÁRIO DAS ALTERAÇÕES/.test(pg), 'parte geral: análise e aplicação no tempo, sem a lista de alterações');
const pl = N.ptPromptTecnicaAlteracoes({ cab: { identificacao: 'PORTARIA 3' }, lote: inv.slice(0, 7), alterado: { identificacao: 'PORTARIA 2', texto: ANT } });
ok(/\(7 neste pedido\)/.test(pl) && /RÓTULO EXATO/.test(pl) && /NUNCA use "\[\.\.\.\]"/.test(pl) && /ARTIGO-BASE INTEIRO/.test(pl) && pl.includes(ANT.slice(0, 200)) && /### 7\. /.test(pl) && !/### 8\. /.test(pl), 'lote: 7 entradas, regras, ato alterado na íntegra');
const pv = N.ptPromptVerificacaoAntes({ base: 'Art. 34', itens: [{ dispositivos: ['Art. 34-A'], tema: 't', antes: 'não havia' }], inv, alterado: { texto: ANT }, pista: 'Art. 34, § 2º, I' });
ok(/ja_tratava/.test(pv) && /possível antecedente: Art\. 34, § 2º, I/.test(pv) && /ARTIGO-BASE NO ATO ALTERADO \(Art\. 34\)/.test(pv) && /individualização da emenda/.test(pv), 'segunda leitura: artigo-base, pista e íntegra');

console.log('6. Busca do DOU');
const b = L.ptUrlBuscaDou('Portaria Conjunta MPO/MGI/SRI-PR nº 2, de 15 de janeiro de 2026');
ok(b && /q=%22PORTARIA\+CONJUNTA\+MPO%2FMGI%2FSRI-PR\+N%C2%BA\+2%22/.test(b.url) && /publishFrom=15-01-2026/.test(b.url) && /publishTo=04-02-2026/.test(b.url), 'endereço da busca: nome entre aspas e janela de 20 dias');
ok(L.ptUrlBuscaDou('a portaria anterior') === null, 'sem número e data: não busca');
const res = L.ptResultadosBuscaDou(BUSCA, DOMParser);
ok(res.length === 1 && res[0].titulo === 'PORTARIA CONJUNTA MPO/MGI/SRI-PR Nº 2, DE 15 DE JANEIRO DE 2026' && /681430207$/.test(res[0].url), 'resultado: título sem marcação e endereço da página do ato');

console.log('7. Tela (IA e DOU simulados)');
(async () => {
  const html = fs.readFileSync(path.join(RAIZ, 'portarias.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !s.startsWith('libs/'));
  const { document, window, Event } = parseHTML(html);
  let copiado = '', semBusca = false;
  const paginaDou = `<html><body><div class="texto-dou">${ANT.split('\n').map(l => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')}</div></body></html>`;
  const fetchs = [];
  const ctx = { document, window, DOMParser, Event, setTimeout, clearTimeout, TextDecoder, URLSearchParams, console, confirm: () => true,
    navigator: { clipboard: { writeText: t => { copiado = t; return Promise.resolve(); } } },
    fetch: async url => { fetchs.push(String(url));
      const corpo = /consulta\/-\/buscar\/dou/.test(url) ? (semBusca ? '<html></html>' : BUSCA) : /sri-pr-n-2-de-15-de-janeiro-de-2026/.test(url) ? paginaDou : null;
      return corpo == null ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => corpo }; },
    chrome: { runtime: { getURL: p => p }, storage: { local: { get: (k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'AIzaSyTESTE1234567890abc', modelo: 'gemini-2.5-flash' } }), set: (o, cb) => cb() } } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(scripts.map(s => fs.readFileSync(path.join(RAIZ, s), 'utf8')).join('\n;\n')).runInContext(ctx);
  // IA simulada: responde pelo tipo de pedido
  const prompts = [];
  let agrupouMal = false, tentativas2B = 0;
  const literal = id => { const e = inv.find(b => b.id === id); return e.novo.replace(/^"/, '').split('\n')[0].slice(0, 150); };
  ctx.chamarIAOrcamento = async ({ prompt }) => {
    prompts.push(prompt);
    let r;
    if (/PARTE GERAL/.test(prompt)) r = { assunto: 'Endurece a execução de emendas', resumo: 'Resumo da mudança.', analise: ['Análise 1.', 'Análise 2.'],
      aplicacao_temporal: { texto: 'Vale para 2027.', artigos: ['Art. 2º'], trecho: 'relativas ao exercício orçamentário de 2027, não alcançando as emendas parlamentares aprovadas para os exercícios de 2026' },
      prazos: [{ prazo: '30 de setembro', evento: 'portaria setorial', mudou: 'prazo novo', artigos: ['Art. 1º'], trecho: 'A publicação da portaria setorial deverá ser realizada até o dia 30 de setembro' }],
      atencao: [], recomendacoes: ['Acompanhar as portarias setoriais.'], vigencia: { texto: 'Na publicação.', artigos: ['Art. 3º'], trecho: 'Esta Portaria entra em vigor na data de sua publicação' } };
    else if (/Você confere a análise de uma alteração normativa/.test(prompt)) {
      const ids = [...prompt.matchAll(/^#(\d+) (.+?) — tema/gm)].map(m => [+m[1], m[2]]);
      r = { itens: ids.map(([n, id]) => id === 'Art. 34-A' ? { n, ja_tratava: true, onde: 'Art. 34, § 2º, I', trecho_antes: 'I - a individualização da emenda para não descaracterizar seu caráter estruturante', antes: 'O art. 34, § 2º, I, já mandava avaliar a individualização.', diferenca: 'Agora é vedada, com impedimento técnico.' }
        : id === 'Art. 2º-B' ? (++tentativas2B === 1 ? { n, ja_tratava: true, onde: 'Art. 34, § 2º, II', trecho_antes: 'o órgão exigia o Obrasgov para todas as obras', antes: 'x' }
          : { n, ja_tratava: true, onde: 'Art. 34, § 2º, II', trecho_antes: 'II - se existem os registros nos Obrasgov.br, nos termos da LDO', antes: 'O art. 34, § 2º, II, mandava avaliar o registro no Obrasgov (só bancada).', diferenca: 'Agora é condição de execução de qualquer obra.' })
        : { n, ja_tratava: false, antes: 'não havia regra' }) };
    } else {
      const ids = [...prompt.matchAll(/^### \d+\. (.+?) — (?:DISPOSITIVO NOVO|NOVA REDAÇÃO)/gm)].map(m => m[1]);
      r = { alteracoes: ids.flatMap(id => {
        if (id === 'Art. 41-A' && !agrupouMal) { agrupouMal = true; return [{ tema: 'Comissões', dispositivos: ['Art. 40-A a 40-D', 'Art. 41-A'], natureza: 'novo', antes: 'não havia regra', depois: 'd', efeito: 'e', trecho: literal('Art. 41-A') }]; }
        return [{ tema: 'Tema de ' + id, dispositivos: [id], natureza: /§|incisos|Art\. 1º$/.test(id) ? 'nova redação' : 'novo',
          antes: id === 'Art. 1º' ? 'Citava a LDO e a LOA pelo número.' : 'não havia regra sobre isso no ato alterado', depois: 'Agora ' + id, efeito: 'Efeito de ' + id,
          impactados: [{ quem: 'Parlamentar', como: 'como' }], base_legal: 'LC nº 210/2024',
          trecho: id === 'Art. 45-C' ? 'O MGI manterá portal único com todas as emendas e seus autores' : literal(id) }];
      }) };
    }
    return { text: '```json\n' + JSON.stringify(r) + '\n```', truncated: false };
  };
  vm.runInContext('chamarIAOrcamento = globalThis.chamarIAOrcamento', ctx);
  const $ = id => document.getElementById(id);
  const clica = el => el.dispatchEvent(new Event('click', { bubbles: true }));
  const espera = async (cond, n = 400) => { for (let i = 0; i < n && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
  clica(document.querySelector('[data-aba="nota"]'));
  $('pn-texto').value = NOVO;
  clica($('pn-usar-texto'));
  ok(/altera 2\/2026/.test($('pn-ato').textContent), 'ato lançado: a relação "altera 2/2026" vem por regra');
  document.querySelector('input[name="pn-tipo"][value="informativa"]').removeAttribute('checked');
  document.querySelector('input[name="pn-tipo"][value="tecnica"]').setAttribute('checked', '');
  clica($('pn-gerar'));
  await espera(() => $('pn-doc'));
  const doc = $('pn-doc');
  ok(doc && fetchs.some(u => /buscar\/dou/.test(u)) && fetchs.some(u => /sri-pr-n-2-de-15-de-janeiro-de-2026-681430207/.test(u)), 'busca a Portaria nº 2 no DOU e lê a página dela');
  const lotes = prompts.filter(p => /INVENTÁRIO \(as entradas deste pedido\)/.test(p));
  ok(prompts.filter(p => /PARTE GERAL/.test(p)).length === 1 && lotes.length === 6 && /ficaram de fora/.test(lotes[5]) && /### 1\. Art\. 41-A/.test(lotes[5]),
    `parte geral + 5 lotes de 7 + 1 complemento (o item mal agrupado do 41-A voltou sozinho) — ${lotes.length} lotes`);
  const subs = [...doc.querySelectorAll('.pn-sub-sec')];
  ok(/O que muda, ponto a ponto/i.test(doc.textContent) && subs.length === 29, `"O que muda, ponto a ponto" com as 29 entradas (${subs.length})`);
  const s34A = subs.find(x => /Art\. 34-A/.test(x.querySelector('h5').textContent));
  ok(/já mandava avaliar a individualização\. Agora é vedada/.test(s34A.textContent), 'art. 34-A: "antes" corrigido pela segunda leitura, com prova literal');
  const s2B = subs.find(x => /Art\. 2º-B/.test(x.querySelector('h5').textContent));
  ok(tentativas2B === 2 && /mandava avaliar o registro no Obrasgov/.test(s2B.textContent), 'art. 2º-B: sem prova na 1ª leitura, corrigido na 2ª tentativa (com a pista)');
  ok(/Análise 1\./.test(doc.textContent) && /Aplicação no tempo/i.test(doc.textContent) && /Vale para 2027/.test(doc.textContent), 'análise e aplicação no tempo na nota');
  ok(/29\s*alterações analisadas/.test(doc.querySelector('.pn-tiles').textContent), '"Em números": alterações analisadas');
  const s45C = subs.find(x => /Art\. 45-C/.test(x.querySelector('h5').textContent));
  ok(s45C && s45C.querySelector('.pn-conf'), 'item com trecho inventado (45-C): marcado ⚠ na tela');
  const rod = doc.querySelector('.pn-rodape').textContent;
  ok(/Comparada com o ato que ela altera: PORTARIA CONJUNTA MPO\/MGI\/SRI-PR Nº 2, DE 15 DE JANEIRO DE 2026 \(texto do DOU\)/.test(rod) && /2 corrigido\(s\)/.test(rod), 'rodapé: ato alterado lido e resultado da segunda leitura');
  const pdf = vm.runInContext('pnHtml({ pdf: true })', ctx);
  ok(!/Tema de Art\. 45-C/.test(pdf) && /Tema de Art\. 45-B/.test(pdf) && !/⚠/.test(pdf), 'PDF: só o conferido (o 45-C fica de fora), sem marcas');
  clica($('pn-copiar'));
  await espera(() => copiado);
  ok(/O QUE MUDA, PONTO A PONTO/.test(copiado) && /Antes: O art\. 34, § 2º, I, já mandava avaliar/.test(copiado), 'texto para o SEI com o que muda');
  // tirar um item da nota
  // (o "copiar" redesenha a nota: o botão é procurado de novo)
  clica([...$('pn-doc').querySelectorAll('.pn-sub-sec')].find(x => /Art\. 34-A/.test(x.querySelector('h5').textContent)).querySelector('.pn-tirar'));
  ok(![...$('pn-doc').querySelectorAll('.pn-sub-sec h5')].some(h => /Art\. 34-A/.test(h.textContent)), '"✕" tira uma alteração da nota');

  // sem o ato alterado no DOU: nota técnica comum, com aviso
  semBusca = true; prompts.length = 0;
  vm.runInContext('pn.docs = []; pn.nota = null;', ctx);
  $('pn-texto').value = NOVO.replace('PORTARIA CONJUNTA MPO/MGI/SRI-PR Nº 3', 'PORTARIA CONJUNTA MPO/MGI/SRI-PR Nº 4');
  clica($('pn-usar-texto'));
  ctx.chamarIAOrcamento = async ({ prompt }) => { prompts.push(prompt); return { text: JSON.stringify({ assunto: 'a', resumo: 'b', pontos: [] }), truncated: false }; };
  vm.runInContext('chamarIAOrcamento = globalThis.chamarIAOrcamento', ctx);
  clica($('pn-gerar'));
  await espera(() => vm.runInContext('!!pn.nota', ctx));
  ok(/não achei o ato alterado/.test($('pn-status').textContent) && prompts.length === 1 && /TEXTO EXTRAÍDO DO DOCUMENTO/.test(prompts[0]), 'sem o ato alterado: a nota técnica comum, com o aviso e o motivo');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.log('ERRO', e.stack); process.exit(1); });
