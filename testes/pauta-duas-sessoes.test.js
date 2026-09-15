// Duas pautas no MESMO dia — a segunda importação não pode apagar a primeira.
//
// Relato de 02/09/2026: a Câmara pautou duas sessões deliberativas no mesmo
// dia. Ao importar a segunda, o módulo de Plenário fez a primeira sumir. Causa
// medida: o id da pauta saía SÓ do período ("02/09/2026" → "02-09-2026"), então
// os dois PDFs caíam no mesmo nó do Firebase e o PUT sobrescrevia.
//
// Os dois PDFs daquele dia, medidos:
//   inteiroTeor3176813.pdf → "SESSÃO DELIBERATIVA / (EXTRAORDINÁRIA) / ( 1 1 h )"
//                            1 item  (PDL 995/2026)
//   pauta_1.pdf            → "2ª SESSÃO DELIBERATIVA / (EXTRAORDINÁRIA) /
//                             ( Após Sessão Deliberativa d as 11h )"
//                            7 itens (REQ 4140, MPV 1357, MPV 1360, PL 3904,
//                                     PL 1893, PLP 73, PLP 74)
// O cabeçalho distingue as duas: o ORDINAL só aparece a partir da 2ª sessão.
// Por isso ele — e não a hora — entra no id: as pautas já salvas (todas
// primeiras sessões) mantêm o id que sempre tiveram.
//
// Uso: node testes/pauta-duas-sessoes.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const P = require(path.join(RAIZ, 'pauta-parser.js'));
const src = fs.readFileSync(path.join(RAIZ, 'analise.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado em analise.js: ' + re); return m[0]; };

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Estado do Firebase de mentira + registro do que foi perguntado ao analista.
const BANCO = {};
const perguntas = [];
let respostaModal = null;      // 'separada' | 'substituir' | null
let respostaConfirm = true;

const A = new Function('fetch', 'confirm', 'FIREBASE_URL', 'perguntarColisaoPauta', 'normalizarItem', `
  ${trecho(/async function resolverIdImportacao\([\s\S]*?\n}/)}
  ${trecho(/async function proximoIdLivre\([\s\S]*?\n}/)}
  ${trecho(/function gerarIdPauta\([\s\S]*?\n}/)}
  return { resolverIdImportacao, proximoIdLivre, gerarIdPauta };
`)(
  async (url) => {
    const m = String(url).match(/\/pautas\/([^.?]+)\.json/);
    const id = decodeURIComponent(m[1]);
    return { ok: true, json: async () => BANCO[id] || null };
  },
  msg => { perguntas.push('confirm: ' + msg.slice(0, 60)); return respostaConfirm; },
  'https://fake.firebaseio.com',
  async (existente, parsed) => { perguntas.push(`modal: ${(existente.itens || []).length} × ${parsed.itens.length}`); return respostaModal; },
  it => ({ ...it, chave: it.chave || `${it.sigla}-${it.numero}-${it.ano}` }),
);

const PDF_11H  = '/root/.claude/uploads/bead633e-8e77-5cf1-aa8d-f92576cd2d84/cb1abd6d-inteiroTeor3176813.pdf';
const PDF_2A   = '/root/.claude/uploads/bead633e-8e77-5cf1-aa8d-f92576cd2d84/51eea278-pauta_1.pdf';
const itens = (...refs) => refs.map(r => { const [s, n, a] = r.split(/[ /]/); return { sigla: s, numero: n, ano: a }; });

(async () => {
  console.log('== cabeçalho: identidade da sessão ==');
  {
    const s = t => P.extrairSessao(t);
    // Exatamente como o pdf.js entrega (kerning incluído).
    const cab2a = 'CÂMARA DOS DEPUTADOS\nEm 02 de setembro de 2026\n( Quarta - feira)\n2ª SESSÃO DELIBERATIVA\n(EXTRAORDINÁRIA)\n( Semip resencia l )\n( Após Sessão Deliberativa d as 11h )\nBREVES COMUNICAÇÕES\n';
    const cab11 = 'CÂMARA DOS DEPUTADOS\nEm 02 de setembro de 2026\n( Quarta - feira)\nSESSÃO DELIBERATIVA\n(EXTRAORDINÁRIA)\n( Semip resencia l )\n( 1 1 h )\nBREVES COMUNICAÇÕES\n';

    ok(s(cab2a).ordinal === 2, `"2ª SESSÃO" → ordinal ${s(cab2a).ordinal}`);
    ok(s(cab11).ordinal === null, 'a 1ª sessão do dia não traz ordinal → null (e o id fica o de sempre)');
    ok(s(cab11).hora === '11h', `"( 1 1 h )" com kerning → ${s(cab11).hora}`);
    ok(s(cab2a).hora === '', 'o "das 11h" de "Após Sessão Deliberativa das 11h" NÃO vira a hora desta sessão');
    ok(s(cab2a).tipo === 'deliberativa' && s(cab2a).extraordinaria, `tipo="${s(cab2a).tipo}" extraordinária=${s(cab2a).extraordinaria}`);
    ok(s(cab2a).rotulo === '2ª sessão deliberativa (extraordinária)', `rótulo: "${s(cab2a).rotulo}"`);
    ok(s(cab11).rotulo === 'sessão deliberativa (extraordinária) — 11h', `rótulo: "${s(cab11).rotulo}"`);
    ok(s(cab2a).rotulo !== s(cab11).rotulo, 'os rótulos diferem — a lista lateral deixa de mostrar dois nomes iguais');

    // "2 ª SESSÃO" (kerning separando o ordinal) e cabeçalho sem sessão nenhuma.
    ok(s('Em 02 de setembro\n2 ª SESSÃO DELIBERATIVA\n').ordinal === 2, 'ordinal tolera espaço antes do "ª"');
    const vazio = s('CÂMARA DOS DEPUTADOS\nPAUTA PREVISTA PARA A SEMANA\n');
    ok(vazio.ordinal === null && vazio.rotulo === '', 'cabeçalho sem sessão → tudo vazio, sem inventar');
    // Nada fora do cabeçalho pode virar sessão (ementas citam "sessão").
    const longe = 'CÂMARA DOS DEPUTADOS\n' + 'x'.repeat(900) + '\n3ª SESSÃO DELIBERATIVA\n';
    ok(s(longe).ordinal === null, 'só o cabeçalho conta — "3ª SESSÃO" no meio do documento é ignorada');
  }

  console.log('\n== id da pauta ==');
  {
    const g = A.gerarIdPauta;
    ok(g('02/09/2026', 'x.pdf', null) === '02-09-2026', 'sem sessão: id inalterado (pautas já salvas continuam válidas)');
    ok(g('02/09/2026', 'x.pdf', { ordinal: null }) === '02-09-2026', '1ª sessão (sem ordinal): id inalterado');
    ok(g('02/09/2026', 'x.pdf', { ordinal: 1 }) === '02-09-2026', 'ordinal 1 também não muda o id');
    ok(g('02/09/2026', 'x.pdf', { ordinal: 2 }) === '02-09-2026-2a-sessao', `2ª sessão → ${g('02/09/2026', 'x.pdf', { ordinal: 2 })}`);
    ok(g('02/09/2026', 'x.pdf', { ordinal: 3 }) === '02-09-2026-3a-sessao', '3ª sessão idem');
    ok(g('02/09/2026', 'x.pdf', { ordinal: 2 }) !== g('02/09/2026', 'x.pdf', null),
       'É ESTE O DEFEITO DE 02/09/2026: os dois ids agora diferem');
  }

  console.log('\n== os dois PDFs reais de 02/09/2026 ==');
  {
    const ler = async f => {
      const pdfjs = require(path.join(RAIZ, 'bot', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));
      globalThis.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: pdfjs.getDocument };
      return P.parsearPauta(await P.extrairTextoPdf(new Uint8Array(fs.readFileSync(f))));
    };
    if (!fs.existsSync(PDF_11H) || !fs.existsSync(PDF_2A)) {
      console.log('  (PDFs de 02/09/2026 não estão nesta máquina — bloco pulado)');
    } else {
      const p11 = await ler(PDF_11H), p2a = await ler(PDF_2A);
      ok(p11.periodo === '02/09/2026' && p2a.periodo === '02/09/2026', 'mesmo período nos dois — é o que colidia');
      const id11 = A.gerarIdPauta(p11.periodo, 'a.pdf', p11.sessao);
      const id2a = A.gerarIdPauta(p2a.periodo, 'b.pdf', p2a.sessao);
      ok(id11 === '02-09-2026' && id2a === '02-09-2026-2a-sessao', `ids: "${id11}" e "${id2a}"`);
      ok(p11.itens.length === 1 && p2a.itens.length === 7, `${p11.itens.length} item e ${p2a.itens.length} itens`);
      ok(p11.titulo !== p2a.titulo, `títulos distintos: "${p11.titulo}" × "${p2a.titulo}"`);
      ok(p2a.itens.some(i => i.sigla === 'MPV' && i.numero === '1357'), 'a 2ª sessão traz a MPV 1357/2026');
      ok(p11.itens[0].sigla === 'PDL' && p11.itens[0].numero === '995', 'a das 11h traz o PDL 995/2026');
    }
  }

  console.log('\n== colisão remanescente (cabeçalho sem ordinal) ==');
  {
    BANCO['02-09-2026'] = { id: '02-09-2026', titulo: 'Pauta — 02/09/2026', itens: itens('PDL 995 2026').map(i => ({ ...i, chave: `${i.sigla}-${i.numero}-${i.ano}` })) };

    // Id livre: grava direto, sem perguntar nada.
    perguntas.length = 0;
    ok(await A.resolverIdImportacao('05-09-2026', { itens: itens('PL 1 2026') }) === '05-09-2026', 'id livre → segue sem perguntar');
    ok(perguntas.length === 0, 'e nenhuma pergunta ao analista');

    // Mesmos itens = reimportação da mesma pauta (fluxo de corrigir o parser).
    perguntas.length = 0; respostaConfirm = true;
    ok(await A.resolverIdImportacao('02-09-2026', { itens: itens('PDL 995 2026') }) === '02-09-2026',
       'itens iguais → confirma substituição (reimportar a mesma pauta)');
    ok(perguntas.some(p => /^confirm:/.test(p)) && !perguntas.some(p => /^modal:/.test(p)),
       'usa o confirm simples, não o diálogo de duas pautas');
    respostaConfirm = false;
    ok(await A.resolverIdImportacao('02-09-2026', { itens: itens('PDL 995 2026') }) === null, 'e recusar cancela a importação');

    // Itens diferentes = provavelmente outra sessão → escolha explícita.
    perguntas.length = 0; respostaModal = 'separada';
    const novo = await A.resolverIdImportacao('02-09-2026', { itens: itens('PL 3904 2023', 'PLP 73 2025') });
    ok(novo === '02-09-2026-2', `"salvar como separada" → id novo "${novo}"`);
    ok(BANCO['02-09-2026'].itens.length === 1, 'e a pauta existente continua intacta no banco');
    ok(perguntas.some(p => p === 'modal: 1 × 2'), 'o diálogo recebeu as duas pautas para comparar');

    respostaModal = 'substituir';
    ok(await A.resolverIdImportacao('02-09-2026', { itens: itens('PL 3904 2023') }) === '02-09-2026',
       '"substituir" devolve o id original (a escolha é do analista)');
    respostaModal = null;
    ok(await A.resolverIdImportacao('02-09-2026', { itens: itens('PL 3904 2023') }) === null, 'cancelar não grava nada');

    // Sufixos encadeiam quando já há uma separada.
    BANCO['02-09-2026-2'] = { id: '02-09-2026-2', itens: [] };
    respostaModal = 'separada';
    ok(await A.resolverIdImportacao('02-09-2026', { itens: itens('PL 9 2026') }) === '02-09-2026-3',
       'com -2 ocupado, o próximo livre é -3');
  }

  console.log('\n== monitor do bot: a 2ª sessão do dia é pauta NOVA ==');
  {
    // O monitor comparava só o período: as duas sessões de 02/09/2026 têm o
    // MESMO período, então a segunda caía em "sem_mudanca" e o bot ficava
    // calado sobre uma pauta inteira — mesma falha da importação, noutro fluxo.
    // bot/src/pauta.js exige o .env do bot ao ser carregado (config valida o
    // BOT_TOKEN), então extraímos as duas funções puras do arquivo — mesmo
    // recurso das outras suítes do bot.
    const srcBot = fs.readFileSync(path.join(RAIZ, 'bot', 'src', 'pauta.js'), 'utf8');
    const pega = re => { const m = srcBot.match(re); if (!m) throw new Error('trecho não encontrado em bot/src/pauta.js: ' + re); return m[0]; };
    const { chaveMonitor, rotuloPauta } = new Function(`
      ${pega(/function chaveMonitor\([\s\S]*?\n}/)}
      ${pega(/function rotuloPauta\([\s\S]*?\n}/)}
      return { chaveMonitor, rotuloPauta };
    `)();
    const s11 = { ordinal: null, hora: '11h', rotulo: 'sessão deliberativa (extraordinária) — 11h' };
    const s2a = { ordinal: 2, hora: '', rotulo: '2ª sessão deliberativa (extraordinária)' };
    const p11 = { periodo: '02/09/2026', sessao: s11, hash: 'aaa' };
    const p2a = { periodo: '02/09/2026', sessao: s2a, hash: 'bbb' };

    ok(chaveMonitor(p11) !== chaveMonitor(p2a),
       `chaves distintas: "${chaveMonitor(p11)}" × "${chaveMonitor(p2a)}"`);
    // Republicação do MESMO PDF (hash muda, cabeçalho não) não pode re-anunciar:
    // é a decisão de projeto de ignorar atualização intra-semana.
    ok(chaveMonitor(p2a) === chaveMonitor({ ...p2a, hash: 'zzz', titulo: 'outro' }),
       'mesma sessão republicada → mesma chave (não re-anuncia)');
    ok(chaveMonitor({ periodo: '03/09/2026', sessao: s2a }) !== chaveMonitor(p2a), 'dia diferente → chave diferente');
    // Pauta antiga (gravada antes desta correção) não tem `sessao`: a chave cai
    // no período, exatamente como era — nada re-anuncia por causa do deploy.
    ok(chaveMonitor({ periodo: '02/09/2026' }) === '02/09/2026', 'sem sessão → chave é o período (compatível com o já gravado)');
    ok(chaveMonitor({ hash: 'ccc' }) === 'ccc', 'sem período → hash, a identidade de reserva de sempre');
    ok(chaveMonitor(null) === null, 'sem pauta anterior → null');

    // O rótulo precisa separar as duas na conversa do Telegram.
    const r11 = rotuloPauta({ ...p11, uploadedAt: '2026-09-02T12:00:00Z' });
    const r2a = rotuloPauta({ ...p2a, uploadedAt: '2026-09-02T18:00:00Z' });
    ok(r11 !== r2a, `rótulos distintos:\n      "${r11}"\n      "${r2a}"`);
    ok(/2ª sessão/.test(r2a) && /11h/.test(r11), 'cada rótulo nomeia a sua sessão');
    ok(/^Pauta da Semana — 02\/09\/2026 · importada em/.test(rotuloPauta({ periodo: '02/09/2026', uploadedAt: '2026-09-02T12:00:00Z' })),
       'pauta sem sessão mantém o rótulo de antes');
  }

  console.log('\n== Firebase fora do ar não pode travar a importação ==');
  {
    const B = new Function('fetch', 'confirm', 'FIREBASE_URL', 'perguntarColisaoPauta', 'normalizarItem', `
      ${trecho(/async function resolverIdImportacao\([\s\S]*?\n}/)}
      ${trecho(/async function proximoIdLivre\([\s\S]*?\n}/)}
      return { resolverIdImportacao };
    `)(async () => { throw new Error('offline'); }, () => false, 'https://fake', async () => null, it => it);
    ok(await B.resolverIdImportacao('02-09-2026', { itens: [] }) === '02-09-2026',
       'sem conseguir checar, importa com o id calculado (não bloqueia o trabalho)');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
