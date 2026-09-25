// bancada.js — cadastro de deputados reconciliado com a Câmara.
//
// O defeito: Comissões e Congresso só faziam "upsert" da lista em exercício
// da API. Quem saía do partido ficava no cadastro para sempre, com o partido
// antigo, nos seletores; a comparação de "mudou?" nem olhava o partido; e o
// Congresso mantinha uma lista FIXA no código para os licenciados.
//
// O que este teste trava:
//  1. entrou → 'exercicio' com `desde`; mudou nome/UF/PARTIDO → atualiza;
//  2. sumiu da lista e a Câmara diz licença no mesmo partido → 'licenciado';
//  3. sumiu por outro motivo → 'ex-membro' com `ate` — NUNCA apagado;
//  4. entrada manual (sem idCamara) não é tocada;
//  5. a gravação é PATCH só dos campos que mudaram, nunca PUT da entrada;
//  6. lista vazia da API é erro, não "todo mundo saiu";
//  7. a janela de 24h evita reconciliar a cada abertura de tela;
//  8. os módulos carregam bancada.js e usam o filtro nos seletores.
//
// Uso: node testes/bancada-cadastro.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const FB = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const chamadas = [];
let EM_EXERCICIO = [];
let STATUS = {};
let SYNC = null;
const jsonOk = b => ({ ok: true, status: 200, json: async () => b });

const ctx = {
  console, Date, Promise, Set, Map, Number, JSON, Object, encodeURIComponent,
  fetch: async (url, op) => {
    const u = String(url), metodo = (op && op.method) || 'GET';
    chamadas.push({ metodo, u, corpo: op && op.body ? JSON.parse(op.body) : undefined });
    let m;
    if (u.startsWith(`${API}/deputados?siglaPartido=`)) {
      return jsonOk({ dados: EM_EXERCICIO.map(d => ({ id: d.idCamara, nome: d.nome, siglaUf: d.uf, siglaPartido: 'PODE' })), links: [] });
    }
    if ((m = u.match(/\/api\/v2\/deputados\/(\d+)$/))) {
      const st = STATUS[m[1]];
      return st ? jsonOk({ dados: { ultimoStatus: st } }) : { ok: false, status: 500, json: async () => ({}) };
    }
    if (u.endsWith('_sync.json')) {
      if (metodo === 'PUT') { SYNC = JSON.parse(op.body); return jsonOk(SYNC); }
      return jsonOk(SYNC);
    }
    if (u.startsWith(FB)) return jsonOk(null);
    return { ok: false, status: 404, json: async () => ({}) };
  },
};
vm.createContext(ctx);
for (const f of ['legislatura.js', 'bancada.js']) new vm.Script(fs.readFileSync(path.join(RAIZ, f), 'utf8')).runInContext(ctx);
const av = e => vm.runInContext(e, ctx);

const CADASTRO = () => ({
  cam_1: { nome: 'Ana', uf: 'SP', partido: 'PODE', idCamara: 1 },                  // continua
  cam_2: { nome: 'Beto', uf: 'RJ', partido: 'PODE', idCamara: 2 },                 // mudou de UF na API
  cam_3: { nome: 'Carla', uf: 'MG', partido: 'PODE', idCamara: 3 },                // saiu para o PL
  cam_178989: { nome: 'Renata Abreu', uf: 'SP', partido: 'PODE', idCamara: 178989 }, // licença
  cam_5: { nome: 'Edu', uf: 'BA', partido: 'PODE', idCamara: 5 },                  // fim de mandato
  cam_6: { nome: 'Fábio', uf: 'PR', partido: 'PL', idCamara: 6, situacao: 'ex-membro', ate: '2025-01-01', desde: '2023-02-01' }, // voltou
  dep_manual: { nome: 'Antonio Carlos Rodrigues', uf: 'SP', partido: 'PODE' },      // sem idCamara
});

(async () => {
  console.log('== reconciliarCadastro (pura) ==');
  {
    ctx.__cad = CADASTRO();
    ctx.__api = [
      { idCamara: 1, nome: 'Ana', uf: 'SP', partido: 'PODE' },
      { idCamara: 2, nome: 'Beto', uf: 'ES', partido: 'PODE' },
      { idCamara: 6, nome: 'Fábio', uf: 'PR', partido: 'PODE' },
      { idCamara: 7, nome: 'Gil', uf: 'AM', partido: 'PODE' },
    ];
    ctx.__st = {
      3: { situacao: 'Exercício', partido: 'PL', idLegislatura: 57 },
      178989: { situacao: 'Licença', partido: 'PODE', idLegislatura: 57 },
      5: { situacao: 'Fim de Mandato', partido: 'PODE', idLegislatura: 57 },
    };
    const r = av(`reconciliarCadastro(__cad, __api, __st, '2026-09-25', { sigla: 'PODE', legislatura: 57 })`);
    const p = r.patches;
    ok(p.cam_7 && p.cam_7.situacao === 'exercicio' && p.cam_7.desde === '2026-09-25', 'quem entrou vira "exercicio", com desde');
    ok(p.cam_2 && p.cam_2.uf === 'ES' && p.cam_2.situacao === 'exercicio', 'mudança de UF é gravada');
    ok(p.cam_1 && Object.keys(p.cam_1).join() === 'situacao', 'entrada antiga sem situacao ganha só a situacao (1ª reconciliação)');
    ok(p.cam_3 && p.cam_3.situacao === 'ex-membro' && p.cam_3.ate === '2026-09-25' && p.cam_3.partido === 'PL',
       'quem trocou de partido vira ex-membro, com ate e o partido novo');
    ok(p.cam_178989 && p.cam_178989.situacao === 'licenciado', 'licença no mesmo partido vira "licenciado" (a antiga lista fixa)');
    ok(p.cam_5 && p.cam_5.situacao === 'ex-membro', 'fim de mandato NÃO é licença: ex-membro');
    ok(p.cam_6 && p.cam_6.partido === 'PODE' && p.cam_6.situacao === 'exercicio' && p.cam_6.ate === null && p.cam_6.desde === '2026-09-25',
       'ex-membro que voltou: exercicio de novo, ate apagado, desde renovado');
    ok(!p.dep_manual, 'entrada manual (sem idCamara) não é tocada');
    ok(Object.values(p).every(x => !('nome' in x) || x.nome), 'nenhum patch apaga o nome');
    ok(r.novos === 1 && r.saidas === 2 && r.licenciados === 1, `contagens: 1 novo, 2 saídas, 1 licença (${r.novos}/${r.saidas}/${r.licenciados})`);

    // Partido na comparação: antes só nome/UF/idCamara contavam como mudança.
    ctx.__cad2 = { cam_1: { nome: 'Ana', uf: 'SP', partido: 'PSDB', idCamara: 1, situacao: 'exercicio' } };
    ctx.__api2 = [{ idCamara: 1, nome: 'Ana', uf: 'SP', partido: 'PODE' }];
    const r2 = av(`reconciliarCadastro(__cad2, __api2, {}, '2026-09-25', {})`);
    ok(r2.patches.cam_1 && r2.patches.cam_1.partido === 'PODE', 'partido diferente conta como mudança');

    ctx.__st3 = { 178989: { situacao: 'Licença', partido: 'PODE', idLegislatura: 56 } };
    ctx.__cad3 = { cam_178989: { nome: 'R', uf: 'SP', partido: 'PODE', idCamara: 178989 } };
    const r3 = av(`reconciliarCadastro(__cad3, [{ idCamara: 9, nome: 'X', uf: 'SP', partido: 'PODE' }], __st3, '2027-03-01', { legislatura: 58 })`);
    ok(r3.patches.cam_178989.situacao === 'ex-membro', 'licença de uma legislatura que já acabou não conta como licença hoje');

    const r4 = av(`reconciliarCadastro(__cad, __api, {}, '2026-09-25', {})`);
    ok(!r4.patches.cam_3 && !r4.patches.cam_5, 'sem resposta da Câmara sobre quem sumiu, ninguém é marcado no escuro');
  }

  console.log('\n== sincronizarCadastroDeputados: grava com PATCH, respeita 24h ==');
  {
    EM_EXERCICIO = [{ idCamara: 1, nome: 'Ana', uf: 'SP' }, { idCamara: 7, nome: 'Gil', uf: 'AM' }];
    STATUS = { 3: { situacao: 'Exercício', siglaPartido: 'PL', idLegislatura: 57 } };
    ctx.__cad = { cam_1: { nome: 'Ana', uf: 'SP', partido: 'PODE', idCamara: 1, situacao: 'exercicio' },
                  cam_3: { nome: 'Carla', uf: 'MG', partido: 'PODE', idCamara: 3, situacao: 'exercicio' } };
    chamadas.length = 0; SYNC = null;
    const r = await av(`sincronizarCadastroDeputados('/comissoes-podemos/deputados', __cad, { agora: new Date('2026-09-25T12:00:00Z') })`);
    const escritas = chamadas.filter(c => c.metodo !== 'GET');
    const patch = escritas.find(c => c.metodo === 'PATCH');
    ok(!escritas.some(c => c.metodo === 'PUT' && /\/deputados\/|deputados\.json/.test(c.u)), 'nenhum PUT no cadastro');
    ok(patch && patch.u === `${FB}/comissoes-podemos/deputados.json`, 'um PATCH multi-caminho no cadastro do módulo');
    ok(patch && patch.corpo['cam_3/situacao'] === 'ex-membro' && patch.corpo['cam_7/nome'] === 'Gil', 'com só os campos que mudaram');
    ok(patch && !Object.keys(patch.corpo).some(k => k.startsWith('cam_1/')), 'quem não mudou não é regravado');
    ok(r.cadastro.cam_3.situacao === 'ex-membro' && r.cadastro.cam_3.nome === 'Carla', 'o cadastro devolvido já vem atualizado, sem perder campos');
    ok(SYNC && SYNC.em === '2026-09-25T12:00:00.000Z', 'marca a hora da reconciliação');

    chamadas.length = 0;
    const r2 = await av(`sincronizarCadastroDeputados('/comissoes-podemos/deputados', __cad, { agora: new Date('2026-09-26T06:00:00Z') })`);
    ok(r2 === null && !chamadas.some(c => c.u.includes('/api/v2/')), 'dentro de 24h, não consulta a Câmara de novo');
    const r3 = await av(`sincronizarCadastroDeputados('/comissoes-podemos/deputados', __cad, { agora: new Date('2026-09-26T13:00:00Z') })`);
    ok(r3 !== null, 'depois de 24h, reconcilia sozinho');

    EM_EXERCICIO = [];
    let erro = null;
    try { await av(`sincronizarCadastroDeputados('/deputados', __cad, { forcar: true })`); } catch (e) { erro = e; }
    ok(erro && /vazia/.test(erro.message), 'API devolvendo bancada vazia é erro — não marca todo mundo como ex-membro');

    ok(av(`depAtivoNaBancada({ situacao: 'licenciado' })`) && av(`depAtivoNaBancada({})`) && !av(`depAtivoNaBancada({ situacao: 'ex-membro' })`),
       'seletores: exercicio, licenciado e entrada antiga aparecem; ex-membro não');
  }

  console.log('\n== os módulos usam bancada.js ==');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    ok(manifest.web_accessible_resources.flatMap(w => w.resources).includes('bancada.js'), 'bancada.js no manifest');
    for (const [pagina, js] of [['comissoes.html', 'comissoes.js'], ['congresso.html', 'congresso.js']]) {
      const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
      const i = html.indexOf('src="legislatura.js"'), j = html.indexOf('src="bancada.js"'), k = html.indexOf(`src="${js}"`);
      ok(i > -1 && i < j && j < k, `${pagina}: legislatura.js → bancada.js → ${js}`);
    }
    const com = fs.readFileSync(path.join(RAIZ, 'comissoes.js'), 'utf8');
    const con = fs.readFileSync(path.join(RAIZ, 'congresso.js'), 'utf8');
    ok(!/DEPUTADOS_MANUAIS/.test(con), 'a lista fixa de deputados manuais saiu do congresso.js');
    ok((com.match(/depAtivoNaBancada/g) || []).length >= 2, 'Comissões filtra os dois seletores (membro e pedido)');
    ok(/depAtivoNaBancada\(d\) \|\| posPorId\.has/.test(con), 'Congresso filtra o seletor, mantendo quem já está marcado');
    ok(!/fetch\(`\$\{FIREBASE_URL\}\/deputados\/\$\{[^}]+\}\.json`, \{\s*method: 'PUT'/.test(con), 'Congresso não faz mais PUT de deputado');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
