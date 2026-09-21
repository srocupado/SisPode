// Sustentação do posicionamento, na aba "Como votou o deputado".
//
// A regra que este teste existe para guardar: a defesa é RECUSADA quando a
// posição escolhida contraria o voto registrado. Um documento que sustenta "o
// deputado é favorável" enquanto a ata da Câmara mostra voto contra o texto não
// protege ninguém — é munição pronta para quem for questionar.
//
// E a segunda regra: gerar não é incluir. O rascunho existe na tela para ser
// lido e corrigido, e só entra no PDF quando o analista MARCA. Um texto
// argumentativo que escorrega para dentro de um documento de conferência sem
// alguém decidir é o pior caminho possível.
//
// E a distinção que vem logo atrás: "o registro não estabelece a posição" NÃO é
// o mesmo que "o registro concorda". Votação do texto principal costuma ser
// simbólica, e aí não há voto nominal nenhum a comparar. Nesse caso a defesa
// sai, e o documento diz que se apoia no argumento, não no voto.
//
// Uso: node testes/defesa.test.js
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
  pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error('sem pdf')) }) },
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

const DEP = { id: 7, nome: 'Fulana de Tal', partido: 'PODE', uf: 'SP' };
const PROP = { siglaTipo: 'PL', numero: 3626, ano: 2023, ementa: 'Dispõe sobre apostas de quota fixa.' };

// Um item da lista: objeto da tramitação + situação do deputado.
const item = (id, objeto, voto, situacao) => ({
  it: { votacao: { id, data: '2023-09-13', descricao: objeto } },
  s: { voto: voto || null, situacao: situacao || (voto ? 'aderente' : 'simbolica') },
});
const objetosDe = linhas => Object.fromEntries(linhas.map(l => [l.it.votacao.id, l.it.votacao.descricao]));

(async () => {
  console.log('== o campo existe na tela ==');
  {
    const sel = document.getElementById('cvDefesa');
    ok(!!sel, 'o campo "precisa de defesa" está no painel da consulta');
    const vals = [...sel.querySelectorAll('option')].map(o => o.getAttribute('value'));
    ok(vals.join(',') === ',favoravel,contraria',
       `três escolhas: nenhuma, favorável e contrária (${vals.join(', ')})`);
    ok(!!document.getElementById('cvDefesaEnfase'), 'e um campo livre para o ponto a enfatizar');
    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    ok(manifest.web_accessible_resources.flatMap(w => w.resources).includes('defesa.js'),
       'defesa.js está em web_accessible_resources');
  }

  console.log('\n== a sustentação é SÓ da aba "Como votou o deputado" ==');
  {
    // O campo mora no painel da consulta, e em nenhum outro.
    let el = document.getElementById('cvDefesa'), pais = [];
    while (el && el.parentNode) { el = el.parentNode; if (el.id) pais.push(el.id); }
    ok(pais.includes('painel-consulta'),
       'o campo de defesa vive dentro do painel "Como votou o deputado"');
    ok(!pais.includes('painel-producao') && !pais.includes('painel-radar') && !pais.includes('painel-aderencia'),
       'e em nenhum dos outros painéis');

    // As outras abas não conhecem a sustentação nem por acidente.
    for (const arq of ['producao.js', 'radar.js']) {
      const fonte = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
      ok(!/\bdfs[A-Z]|defesa/.test(fonte),
         `${arq} não toca na sustentação — os relatórios dele são só registro`);
    }
  }
  {
    // Dentro da aba, a defesa é do modo POR PROPOSIÇÃO: sustenta-se posição
    // favorável ou contrária a UMA matéria, e por período há dezenas.
    const campo = document.getElementById('cvDefesaCampo');
    ok(!!campo, 'o bloco da defesa tem identidade própria, para poder ser escondido');

    av("cvTrocarModo('proposicao')");
    ok(campo.hidden === false, 'no modo por proposição, o campo aparece');

    document.getElementById('cvDefesa').value = 'favoravel';
    document.getElementById('cvDefesaEnfase').value = 'algum ponto';
    av("cvTrocarModo('periodo')");
    ok(campo.hidden === true,
       'no modo por período, o campo SOME — antes ficava visível e o clique não fazia nada');
    // linkedom não implementa `select.value`; o que se observa é qual opção
    // está marcada, que é o mesmo invariante.
    ok(document.getElementById('cvDefesa').querySelector('option[value=""]').selected === true,
       'e a escolha é limpa, para não ficar pendurada uma posição que não vale mais');
    ok(document.getElementById('cvDefesaEnfase').value === '', 'a ênfase também');
    av("cvTrocarModo('proposicao')");
  }

  console.log('\n== o que o voto registrado diz sobre a posição ==');
  {
    const favoravel = [item('v1', 'Votação da Redação Final.', 'Sim')];
    ok(chamar('dfsPosicaoRegistrada', favoravel, objetosDe(favoravel)).posicao === 'favoravel',
       'Sim na Redação Final registra posição favorável');

    const contra = [item('v1', 'Votação da Subemenda Substitutiva Global ao Projeto de Lei.', 'Não')];
    ok(chamar('dfsPosicaoRegistrada', contra, objetosDe(contra)).posicao === 'contraria',
       'Não no substitutivo global registra posição contrária');

    // O ponto mais fácil de errar: num destaque para supressão, "Sim" quer
    // dizer suprimir — não quer dizer favorável ao projeto.
    const destaque = [item('v1', 'Votação do DTQ 1: Destaque para Votação em Separado do §10 do art. 23, para fins de supressão.', 'Sim')];
    ok(chamar('dfsPosicaoRegistrada', destaque, objetosDe(destaque)).posicao === null,
       'voto em destaque NÃO é lido como posição sobre a matéria');

    const requerimento = [item('v1', 'Votação do Requerimento de adiamento da votação por uma sessão.', 'Não')];
    ok(chamar('dfsPosicaoRegistrada', requerimento, objetosDe(requerimento)).posicao === null,
       'nem voto em requerimento de andamento');

    // Formas com que a API DESCREVE O RESULTADO — que não são as formas da
    // tramitação, e são as que chegam aqui na consulta por proposição. Deixar
    // de reconhecer uma delas é o pior erro desta tela: o registro passa por
    // mudo, o conflito não é detectado, e sai uma sustentação contrária ao voto
    // que consta da ata — o documento que esta camada existe para impedir.
    const TEXTO_PRINCIPAL = [
      'Aprovada a Redação Final assinada pelo Dep. Adolfo Viana (PSDB-BA).',
      'Aprovado o Substitutivo do Senado Federal ao Projeto de Lei nº 442-A, de 1991.',
      'Aprovado o texto-base do Projeto de Lei.',
      'Aprovado o Projeto de Lei de Conversão nº 4, de 2024.',
      'Aprovada a Emenda Substitutiva Global de Plenário nº 1.',
      // A ressalva diz o que ficou FORA da votação, não o que se votou. É das
      // formas mais comuns na Câmara, e atrapalha de dois jeitos: faz o item
      // parecer destaque e desancora o fim da frase.
      'Aprovado o Projeto de Lei nº 3.626, de 2023, ressalvados os destaques.',
    ];
    for (const obj of TEXTO_PRINCIPAL) {
      const l = [item('v1', obj, 'Não')];
      ok(chamar('dfsPosicaoRegistrada', l, objetosDe(l)).posicao === 'contraria',
         `é votação do texto: ${obj.slice(0, 58)}…`);
    }

    // E o que cita o texto principal sem ser votação dele.
    const ACESSORIO = [
      'Aprovado o Requerimento de destaque do Substitutivo do Senado Federal.',
      'Rejeitada a Emenda do Senado Federal nº 3. Sim: 120; não: 261; abstenção: 1.',
      'Aprovada a parte da Emenda.',
    ];
    for (const obj of ACESSORIO) {
      const l = [item('v1', obj, 'Não')];
      ok(chamar('dfsPosicaoRegistrada', l, objetosDe(l)).posicao === null,
         `NÃO é votação do texto: ${obj.slice(0, 55)}…`);
    }

    const simbolica = [item('v1', 'Votação da Redação Final.', null, 'simbolica')];
    ok(chamar('dfsPosicaoRegistrada', simbolica, objetosDe(simbolica)).posicao === null,
       'votação simbólica do texto não registra posição — não há voto individual');

    const ausente = [item('v1', 'Votação da Redação Final.', null, 'ausente')];
    ok(chamar('dfsPosicaoRegistrada', ausente, objetosDe(ausente)).posicao === null,
       'e ausência também não');

    const dividido = [item('v1', 'Votação da Redação Final.', 'Sim'),
                      item('v2', 'Votação da Subemenda Substitutiva Global.', 'Não')];
    const r = chamar('dfsPosicaoRegistrada', dividido, objetosDe(dividido));
    ok(r.posicao === null && r.dividido === true,
       'votos divididos sobre o texto não estabelecem posição — não se escolhe lado por maioria de itens');
  }

  console.log('\n== a recusa, que é o ponto da tela ==');
  {
    av(`chamarIA = async (args) => { globalThis.__ia = args; return { text: globalThis.__resposta }; }`);
    av(`globalThis.__resposta = ${JSON.stringify('A '.repeat(80))}`);

    const linhas = [item('v1', 'Votação da Redação Final.', 'Não')];
    const objetos = objetosDe(linhas);
    av('globalThis.__ia = null');
    const d = await chamar('dfsGerar', { posicao: 'favoravel', dep: DEP, prop: PROP,
                                         resumos: null, linhas, objetos, enfase: '' });
    ok(d.ok === false && d.motivo === 'conflito',
       'posição favorável com voto contra o texto: a sustentação é RECUSADA');
    ok(av('globalThis.__ia') === null, 'e o provedor nem chega a ser chamado');
    ok(d.conflito.registrada === 'contraria' && d.conflito.itens.length === 1,
       'a recusa carrega o que contraria');

    const h = chamar('dfsHtml', d);
    ok(/Sustentação não gerada/.test(h), 'a tela diz que não gerou');
    ok(/munição para quem for questionar/.test(h), 'e por que não gerou');
    ok(/Redação Final/.test(h) && /voto: Não/.test(h),
       'nomeando a votação e o voto que contrariam — para o analista ver se foi engano dele');
  }

  console.log('\n== quando o registro concorda, gera ==');
  {
    const linhas = [item('v1', 'Votação da Redação Final.', 'Sim')];
    const d = await chamar('dfsGerar', { posicao: 'favoravel', dep: DEP, prop: PROP,
                                         resumos: null, linhas, objetos: objetosDe(linhas), enfase: '' });
    ok(d.ok === true, 'posição favorável com voto Sim no texto: gera');
    ok(d.registro.posicao === 'favoravel', 'e o registro fica guardado com o resultado');
    ok(!/se apoia no argumento/.test(chamar('dfsHtml', d)),
       'sem a ressalva de "registro não estabelece" — aqui o voto sustenta');
  }

  console.log('\n== quando o registro é mudo, gera e DIZ que é mudo ==');
  {
    // O caso comum: a votação do texto foi simbólica. Não há o que contrariar,
    // e também não há voto que sustente.
    const linhas = [item('v1', 'Votação da Redação Final.', null, 'simbolica'),
                    item('v2', 'Votação do DTQ 3: Emenda de Plenário nº 26.', 'Não', 'aderente')];
    const d = await chamar('dfsGerar', { posicao: 'contraria', dep: DEP, prop: PROP,
                                         resumos: null, linhas, objetos: objetosDe(linhas), enfase: '' });
    ok(d.ok === true, 'sem voto nominal no texto, a sustentação sai');
    ok(d.registro.posicao === null, 'com o registro marcado como inconclusivo');
    const h = chamar('dfsHtml', d);
    ok(/não estabelece a posição/.test(h) && /se apoia no argumento/.test(h),
       'e o documento diz isso — "não estabelece" não pode passar por "concorda"');

    const prompt = av('globalThis.__ia.prompt');
    ok(/o registro não estabelece a posição/.test(prompt),
       'o modelo também é avisado, para não afirmar que o voto comprova a posição');
    ok(/Se o registro não estabelece a posição, sustente pelo argumento/.test(prompt),
       'com a ordem explícita de não usar o voto como prova');
  }

  console.log('\n== o que o prompt manda e proíbe ==');
  {
    const linhas = [item('v1', 'Votação da Redação Final.', 'Sim'),
                    item('v2', 'Votação do DTQ 3: Emenda de Plenário nº 26.', 'Não', 'divergente')];
    const resumos = { itens: { v2: { simples: 'A emenda queria impedir que endividados apostassem.' } },
                      materia: { simples: 'O projeto regulamenta apostas esportivas.', ementa: PROP.ementa } };
    await chamar('dfsGerar', { posicao: 'favoravel', dep: DEP, prop: PROP, resumos,
                               linhas, objetos: objetosDe(linhas), enfase: 'proteção de quem está endividado' });
    const p = av('globalThis.__ia.prompt');

    ok(/Fulana de Tal \(PODE-SP\)/.test(p), 'o prompt identifica o parlamentar');
    ok(/POSIÇÃO A SUSTENTAR: favorável à matéria/.test(p), 'e a posição a sustentar');
    ok(/proteção de quem está endividado/.test(p), 'o ponto pedido pelo analista chega ao modelo');
    ok(/A emenda queria impedir que endividados apostassem/.test(p),
       'e a explicação de cada item, que é a matéria-prima do argumento');
    ok(/voto do deputado: Não/.test(p), 'com o voto de cada item, para o texto não contradizer a ata');

    const pl = p.replace(/\s+/g, ' ');
    ok(/NÃO invente número, percentual, estudo, pesquisa, valor financeiro/.test(pl),
       'proibido inventar número, estudo ou valor — é o que derruba uma defesa em público');
    ok(/Sem jargão regimental/.test(pl),
       'proibido jargão regimental, que foi o motivo de esta camada existir');
    ok(/Não ataque adversários/.test(pl), 'proibido atacar adversários ou atribuir má-fé');
    ok(/Não afirme que o deputado votou de um jeito que não esteja na lista/.test(pl),
       'e proibido inventar voto');
  }

  console.log('\n== falhas não viram defesa ==');
  {
    const linhas = [item('v1', 'Votação da Redação Final.', 'Sim')];
    const args = { posicao: 'favoravel', dep: DEP, prop: PROP, resumos: null,
                   linhas, objetos: objetosDe(linhas), enfase: '' };

    av(`globalThis.__resposta = 'curto'`);
    const d1 = await chamar('dfsGerar', args);
    ok(d1.ok === false && d1.motivo === 'resposta-curta' && !d1.texto,
       'resposta curta demais é recusada, e não devolve texto');

    av(`chamarIA = async () => { throw new Error('rede caiu'); }`);
    const d2 = await chamar('dfsGerar', args);
    ok(d2.ok === false && d2.motivo === 'erro' && !d2.texto, 'falha de rede não vira defesa');
    ok(/A geração falhou/.test(chamar('dfsHtml', d2)), 'e a tela diz que falhou');

    av(`chrome.storage.local.get = (_k, cb) => cb({ config: {} })`);
    const d3 = await chamar('dfsGerar', args);
    ok(d3.ok === false && d3.motivo === 'sem-chave', 'sem chave de IA, não gera');
    av(`chrome.storage.local.get = (_k, cb) => cb({ config: { provedor: 'gemini', apiKey: 'chave-de-teste', modelo: 'modelo-de-teste' } })`);
    av(`chamarIA = async (args) => { globalThis.__ia = args; return { text: globalThis.__resposta }; }`);

    const d4 = await chamar('dfsGerar', { ...args, posicao: '' });
    ok(d4.ok === false && d4.motivo === 'sem-posicao', 'sem posição escolhida, não há o que sustentar');
  }

  console.log('\n== o campo é editável, e o documento sai com o que o analista escreveu ==');
  {
    av(`globalThis.__resposta = ${JSON.stringify(
      'Texto rascunhado pelo provedor, com tamanho suficiente para passar no piso de caracteres do módulo.'
      + '\n\n' + 'Segundo parágrafo do rascunho, para exercitar a quebra.')}`);
    const linhas = [item('v1', 'Votação da Redação Final.', 'Sim')];
    const d = await chamar('dfsGerar', { posicao: 'favoravel', dep: DEP, prop: PROP, resumos: null,
                                         linhas, objetos: objetosDe(linhas), enfase: '' });
    ok(d.original === d.texto && d.editado === false,
       'ao nascer, o texto é o do provedor e está marcado como não revisado');
    ok(d.incluir === false,
       'e NÃO entra no PDF: gerar e incluir são atos diferentes');

    // Monta a tela como cvDesenhar faz, e liga a edição.
    document.getElementById('cvResultado').innerHTML = chamar('dfsHtml', d);
    chamar('dfsLigarEdicao', d, () => {});
    const ta = document.getElementById('dfsTexto');
    ok(!!ta && ta.tagName === 'TEXTAREA', 'a sustentação aparece num campo editável, não como texto fixo');
    ok(ta.value.includes('Texto rascunhado pelo provedor'), 'já preenchido com o rascunho');
    ok(/revise antes de incluir/.test(document.getElementById('dfsEstado').textContent),
       'e a tela pede revisão antes de incluir');
    ok(document.getElementById('dfsRestaurar').hasAttribute('disabled'),
       'o botão de restaurar nasce desabilitado, porque não há o que restaurar');

    ta.value = 'Texto reescrito pelo analista, que é quem assina a sustentação e responde por ela perante quem perguntar.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ok(d.texto === ta.value, 'o que se digita vira o texto do documento na hora, sem botão de salvar');
    ok(d.editado === true, 'e o estado passa a "revisado"');
    ok(d.original.includes('Texto rascunhado pelo provedor'), 'o rascunho original continua guardado');
    ok(/revisado pelo analista/.test(document.getElementById('dfsEstado').textContent), 'a tela acompanha');
    ok(!document.getElementById('dfsRestaurar').hasAttribute('disabled'), 'e o restaurar se habilita');

    // Sem marcar, o PDF sai sem a seção — mesmo com o texto pronto e revisado.
    av(`cv.ultimo = { linhas: [], objetos: {}, prop: ${JSON.stringify(PROP)}, periodo: null,
        dep: ${JSON.stringify(DEP)}, retirados: [], cont: { aderente: 0, divergente: 0, ausente: 0, 'sem-gov': 0, simbolica: 0 },
        pct: null, resumos: null, defesa: ${JSON.stringify(d)} }`);
    ok(!/Sustentação do posicionamento/.test(av('cvHtmlPDF(null)')),
       'com o texto pronto e revisado, mas sem a marcação, a seção NÃO sai no PDF');

    // linkedom não reflete a propriedade `checked`; no HTML o que se vê é o
    // atributo, e é ele que diz como a caixa nasce. No navegador o .checked
    // funciona normalmente.
    const cx = document.getElementById('dfsIncluir');
    ok(!!cx && !cx.hasAttribute('checked'), 'a marcação existe na tela e nasce desmarcada');
    ok(/Desmarcado: o documento sai só com o registro de votos/.test(
       document.getElementById('dfsIncluirEstado').textContent),
       'e a tela diz o que acontece enquanto estiver desmarcada');

    cx.checked = true;
    cx.dispatchEvent(new Event('change', { bubbles: true }));
    ok(d.incluir === true, 'marcar liga a inclusão no estado');
    ok(/Marcado: a seção sai no documento/.test(document.getElementById('dfsIncluirEstado').textContent),
       'e a tela confirma');

    av(`cv.ultimo.defesa = ${JSON.stringify({ ...JSON.parse(JSON.stringify(d)), incluir: true })}`);
    const doc = av('cvHtmlPDF(null)');
    ok(/Sustentação do posicionamento/.test(doc), 'agora sim a seção sai');
    ok(/Texto reescrito pelo analista/.test(doc), 'o PDF leva o texto do analista');
    ok(!/Texto rascunhado pelo provedor/.test(doc), 'e não o rascunho que ele substituiu');
    // A nota de procedência saiu do PDF a pedido: o documento que circula leva
    // o texto, e o estado da revisão fica na TELA, que é onde o analista
    // trabalha e decide.
    ok(!/Texto <b>argumentativo<\/b>/.test(doc.replace(/\s+/g, ' ')),
       'o PDF não carrega o parágrafo de procedência');
    ok(/revisado pelo analista/.test(chamar('dfsHtml', d)),
       'mas a tela continua dizendo que houve revisão humana');

    // Restaurar devolve o rascunho.
    document.getElementById('dfsRestaurar').dispatchEvent(new Event('click', { bubbles: true }));
    ok(d.texto === d.original && d.editado === false, '"restaurar texto gerado" devolve o rascunho');
  }
  {
    // Exportar sem tocar no campo é possível, e o documento diz isso.
    const d = { ok: true, posicao: 'favoravel', texto: 'Um texto qualquer com tamanho.',
                original: 'Um texto qualquer com tamanho.', editado: false, incluir: true,
                modelo: 'm', registro: { posicao: 'favoravel' } };
    av(`cv.ultimo.defesa = ${JSON.stringify(d)}`);
    ok(!/exportado sem revisão/.test(av('cvHtmlPDF(null)')),
       'o PDF não traz mais o aviso de revisão — ele saiu do documento a pedido');
    ok(/revise antes de incluir/.test(chamar('dfsHtml', d)),
       'quem avisa é a tela, antes de o analista marcar a inclusão');
  }

  console.log('\n== no documento, argumentação não se confunde com registro ==');
  {
    // O piso de 120 caracteres existe para barrar resposta truncada; o texto
    // de teste precisa passar dele como um texto de verdade passaria.
    av(`globalThis.__resposta = ${JSON.stringify(
      'Primeiro parágrafo da sustentação, com tamanho suficiente para passar no piso de caracteres que o módulo exige.'
      + '\n\n'
      + 'Segundo parágrafo, também com tamanho, para que a quebra em parágrafos seja exercitada de verdade.')}`);
    const linhas = [item('v1', 'Votação da Redação Final.', 'Sim')];
    const d = await chamar('dfsGerar', { posicao: 'favoravel', dep: DEP, prop: PROP, resumos: null,
                                         linhas, objetos: objetosDe(linhas), enfase: '' });
    av(`cv.ultimo = { linhas: [], objetos: {}, prop: ${JSON.stringify(PROP)}, periodo: null,
        dep: ${JSON.stringify(DEP)}, retirados: [], cont: { aderente: 0, divergente: 0, ausente: 0, 'sem-gov': 0, simbolica: 0 },
        pct: null, resumos: null, defesa: ${JSON.stringify({ ...d, incluir: true })} }`);
    const doc = av('cvHtmlPDF(null)');
    const plano = doc.replace(/\s+/g, ' ');

    ok(/<h2 class="dfs-h">Sustentação do posicionamento<\/h2>/.test(doc),
       'a sustentação sai em seção própria, com título');
    ok(doc.indexOf('Sustentação do posicionamento') > doc.indexOf('<h2>Consolidado</h2>'),
       'depois do registro de votos, nunca antes');
    ok(/Primeiro parágrafo da sustentação/.test(doc) && /Segundo parágrafo/.test(doc),
       'com os parágrafos do texto');
    // O que separa argumentação de registro no documento, agora que a nota de
    // procedência saiu: a seção tem título próprio, rótulo de posição e
    // moldura — e vem depois de todas as tabelas.
    ok(/<div class="dfs-rot">Posição favorável à matéria<\/div>/.test(plano),
       'a posição sustentada vai no rótulo da seção');
    // A moldura e o título continuam sendo o que separa argumentação de
    // registro. A cor não separa nada: as duas seções novas usam o mesmo verde
    // do resto do documento, de propósito.
    ok(/class="dfs"/.test(doc) && /<h2 class="dfs-h">Sustentação do posicionamento<\/h2>/.test(doc),
       'com moldura e título próprios, que é o que separa argumentação de registro');
    ok(!/Texto <b>argumentativo<\/b>/.test(plano), 'e sem o parágrafo de procedência');

    // Sem defesa, nada disso aparece.
    av(`cv.ultimo.defesa = null`);
    ok(!/Sustentação do posicionamento/.test(av('cvHtmlPDF(null)')),
       'sem defesa pedida, a seção não existe');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
