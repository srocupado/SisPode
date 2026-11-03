// Bot · /update da extensão (bot/src/autoupdate.js), de ponta a ponta numa
// pasta temporária: uma "máquina do bot" com a extensão desatualizada, a API do
// GitHub simulada servindo o commit atual deste repositório. Nada é gravado
// fora da pasta temporária.
// Uso: node testes/bot-autoupdate-extensao.test.js
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const git = (...a) => execFileSync('git', a, { cwd: RAIZ, maxBuffer: 64 << 20 });

// o commit atual (HEAD) como o GitHub o serviria
const SHA = git('rev-parse', 'HEAD').toString().trim();
const TREE = git('rev-parse', 'HEAD^{tree}').toString().trim();
const arvore = git('ls-tree', '-r', 'HEAD').toString().trim().split('\n').map(l => { const [meta, p] = l.split('\t'); const [, type, sha] = meta.split(' '); return { path: p, type, sha }; });
const blob = sha => git('cat-file', 'blob', sha);
const porCaminho = Object.fromEntries(arvore.map(e => [e.path, e]));
const pedidos = [];
global.fetch = async url => {
  const u = new URL(url); pedidos.push(u.pathname);
  const resp = (obj, raw) => ({ ok: true, status: 200, json: async () => obj, text: async () => raw });
  let m;
  if (/\/commits\/main$/.test(u.pathname)) return resp({ sha: SHA, commit: { message: 'teste', tree: { sha: TREE } } });
  if (/\/contents\/bot\/src$/.test(u.pathname)) return resp(arvore.filter(e => /^bot\/src\/[^/]+$/.test(e.path)).map(e => ({ type: 'file', name: path.basename(e.path) })));
  if ((m = u.pathname.match(/\/contents\/(.+)$/))) return resp(null, blob(porCaminho[decodeURIComponent(m[1])].sha).toString('utf8'));
  if (/\/git\/trees\//.test(u.pathname)) return resp({ sha: TREE, truncated: false, tree: arvore });
  if ((m = u.pathname.match(/\/git\/blobs\/([0-9a-f]+)$/))) return resp({ content: blob(m[1]).toString('base64'), encoding: 'base64' });
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};

(async () => {
  // a máquina do bot: <tmp>/bot/src/autoupdate.js (o código em teste) e a extensão em <tmp>
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sispode-update-'));
  fs.mkdirSync(path.join(tmp, 'bot', 'src'), { recursive: true });
  fs.copyFileSync(path.join(RAIZ, 'bot', 'src', 'autoupdate.js'), path.join(tmp, 'bot', 'src', 'autoupdate.js'));
  fs.writeFileSync(path.join(tmp, 'manifest.json'), '{"version":"4.1.8.1"}');                  // velho
  fs.writeFileSync(path.join(tmp, 'analise.js'), '// analise.js antigo\n');
  fs.writeFileSync(path.join(tmp, 'panel.js'), blob(porCaminho['panel.js'].sha));                       // já em dia
  fs.writeFileSync(path.join(tmp, 'meu-arquivo.txt'), 'coisa da máquina');                           // não é do repo
  process.env.GH_TOKEN = 'x'; delete process.env.BOT_EXT_DIR;
  const U = require(path.join(tmp, 'bot', 'src', 'autoupdate.js'));

  console.log('== regras ==');
  ok(U.blobSha(blob(porCaminho['panel.js'].sha)) === porCaminho['panel.js'].sha, 'blob sha igual ao do git');
  ok(['bot/index.js', 'testes/x.test.js', 'varredura/estado.json', 'docs/a.md', 'README.md', '.gitignore'].every(p => U.FORA_DA_EXTENSAO.test(p))
     && !['analise.js', 'libs/pdf.min.js', 'icons/podemos-logo.png', 'apuracao/index.html', 'manifest.json'].some(p => U.FORA_DA_EXTENSAO.test(p)), 'o que é e o que não é extensão');

  console.log('\n== 1º /update ==');
  const r = await U.aplicarUpdate();
  ok(r.ok && !r.jaAtualizado, `aplicado (${r.erro || 'ok'})`);
  const doCommit = p => blob(porCaminho[p].sha);   // o que o GitHub serve (o commit), não a cópia de trabalho
  ok(fs.readFileSync(path.join(tmp, 'analise.js')).equals(doCommit('analise.js')), 'analise.js da extensão atualizado');
  ok(fs.readFileSync(path.join(tmp, 'manifest.json')).equals(doCommit('manifest.json')), 'manifest.json atualizado');
  ok(fs.readFileSync(path.join(tmp, 'icons', 'podemos-logo.png')).equals(doCommit('icons/podemos-logo.png')), 'binário (PNG) chega íntegro, pelo blob em base64');
  ok(fs.existsSync(path.join(tmp, 'apuracao', 'index.html')) && fs.existsSync(path.join(tmp, 'libs', 'pdf.worker.min.js')), 'subpastas criadas (apuracao/, libs/)');
  ok(!r.extensao.gravados.includes('panel.js') && !r.extensao.gravados.some(p => U.FORA_DA_EXTENSAO.test(p)), 'o que já estava em dia e o que não é extensão não são baixados');
  ok(fs.readFileSync(path.join(tmp, 'meu-arquivo.txt'), 'utf8') === 'coisa da máquina', 'arquivo da máquina que não está no repo fica intacto');
  ok(fs.readFileSync(path.join(tmp, 'pauta-parser.js')).equals(doCommit('pauta-parser.js')) && fs.existsSync(path.join(tmp, 'bot', 'src', 'parser.js')), 'bot: src/*.js e o pauta-parser da raiz');
  const v = JSON.parse(fs.readFileSync(path.join(tmp, 'bot', 'dados', 'versao-bot.json'), 'utf8'));
  ok(v.sha === SHA && v.extensao && v.extensao.gravados === r.extensao.gravados.length, 'versão gravada com a lista e a extensão');

  console.log('\n== 2º /update (mesmo commit) ==');
  const n = pedidos.filter(p => /git\/blobs/.test(p)).length;
  const r2 = await U.aplicarUpdate();
  ok(r2.ok && r2.jaAtualizado && pedidos.filter(p => /git\/blobs/.test(p)).length === n, '"já atualizado", sem baixar nada');

  console.log('\n== pasta sem a extensão ==');
  fs.writeFileSync(path.join(tmp, 'bot', 'dados', 'versao-bot.json'), '{}');
  fs.renameSync(path.join(tmp, 'manifest.json'), path.join(tmp, 'manifest.bak'));
  fs.writeFileSync(path.join(tmp, 'analise.js'), '// mexido\n');
  const r3 = await U.aplicarUpdate();
  ok(r3.ok && r3.extensao.ausente && fs.readFileSync(path.join(tmp, 'analise.js'), 'utf8') === '// mexido\n', 'sem manifest.json a extensão não está ali: nada dela é gravado');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
