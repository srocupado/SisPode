// Exporta, por UF, os dados do simulador na regra da Minuta (deputado federal e estadual):
// si.dados[uf], o op do distrital e porUf[uf] (desenho, base, votos), afinado pelos locais de votação.
// Uso: node exportar.js <perfil-dir> <saida-dir> UF[,UF...]
const fs = require('fs');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const [perfilDir, saida, lista] = process.argv.slice(2);
  const ext = '/home/user/SisPode';
  const ctx = await chromium.launchPersistentContext(perfilDir, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--ignore-certificate-errors', '--js-flags=--max-old-space-size=6144'], proxy: { server: process.env.HTTPS_PROXY }, ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } });
  await ctx.route(/firebaseio\.com/, r => r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 200, body: 'null' }));
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const p = await ctx.newPage();
  const erros = []; p.on('pageerror', e => erros.push(e.message)); p.on('dialog', d => d.accept());
  await p.exposeFunction('gravar', (nome, txt) => { fs.writeFileSync(saida + '/' + nome, txt); return txt.length; });
  await p.goto(`chrome-extension://${sw.url().split('/')[2]}/sistemas/sistemas.html`);
  await p.waitForFunction(() => document.querySelector('#siUf option[value="SP"], #siUf option[value="sp"]'), null, { timeout: 180000 });
  await p.evaluate(() => { window.siConfirmar = async () => true; });
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  for (const UF of lista.split(',')) {
    for (const cargo of ['6', '7']) {
      const arq = `${cargo === '6' ? 'federal' : 'estadual'}-${UF}.json`;
      if (fs.existsSync(saida + '/' + arq)) { log(arq, 'já existe'); continue; }
      const t0 = Date.now();
      try {
        const v = await p.evaluate(uf => [...document.querySelectorAll('#siUf option')].find(o => o.value.toUpperCase() === uf).value, UF);
        await p.selectOption('#siUf', v);
        if (await p.evaluate(() => si.cargo) !== cargo) await p.click(`#siCargo button[data-c="${cargo}"]`);
        await p.waitForFunction(([c, uf]) => si.cargo === c && si.res && !si.lendo && Object.keys(si.dados).length === 1 && Object.keys(si.dados)[0].toUpperCase() === uf, [cargo, UF], { timeout: 1800000, polling: 2000 });
        // votos por município e zona + malha
        if (await p.$('#siLerGeo')) await p.click('#siLerGeo');
        await p.waitForFunction(() => !si.lendo && (document.getElementById('siSim') || (si.sistemas || []).some(s => s.tipo === 'distrital' && s.op.porUf && Object.keys(s.op.porUf).length)), null, { timeout: 3600000, polling: 3000 });
        if (await p.$('#siSim')) await p.evaluate(() => document.getElementById('siSim').click());
        // regra da Minuta
        await p.evaluate(() => document.getElementById('dMinuta').click());
        await p.waitForFunction(() => { const s = si.sistemas.find(s => s.tipo === 'distrital'); return !si.lendo && s && siEhMinuta(s.op) && s.op.porUf && Object.keys(s.op.porUf).length && si.res && si.res.sims.some(x => x.tipo === 'distrital' && Object.keys(x.porUf || {}).length); }, null, { timeout: 3600000, polling: 3000 });
        await p.waitForTimeout(1500);
        // locais de votação onde o desenho passa da tolerância
        const fora = await p.evaluate(() => siForaDaTolerancia());
        if (fora.length) {
          log(UF, cargo, 'afinando com locais', fora.join(','));
          await p.evaluate(ufs => siLerLocais(ufs), fora);
          await p.waitForFunction(() => !si.lendo && !siForaDaTolerancia().length, null, { timeout: 3600000, polling: 3000 });
          await p.waitForFunction(() => { const s = si.sistemas.find(s => s.tipo === 'distrital'); const x = Object.values(s.op.porUf || {})[0]; return x && x.desenho && (x.desenho.locais || !sdTolerancia(x.desenho.distritos, s.op.tol).ok) ; }, null, { timeout: 600000, polling: 3000 });
          await p.waitForTimeout(3000);
        }
        const tam = await p.evaluate(async nome => {
          const s = si.sistemas.find(s => s.tipo === 'distrital');
          const uf = Object.keys(si.dados)[0];
          const rep = (k, v) => v instanceof Set ? [...v] : v instanceof Map ? Object.fromEntries(v) : v;
          const { porUf, ...op } = s.op;
          const x = porUf[uf];
          const sim = si.res.sims.find(z => z.tipo === 'distrital').porUf[uf];
          const doc = { uf, cargo: si.cargo, ano: si.op.ano, fonte: si.op.fonte, minuta: siEhMinuta(s.op), descricao: siDescricao(s), op, d: si.dados[uf], porUf: x,
            tolerancia: sdTolerancia(x.desenho.distritos, s.op.tol), simMinuta: { eleitos: sim.eleitos.map(e => ({ sq: e.sq, agr: e.agr, fase: e.fase })), extra: sim.extra, excedentes: sim.excedentes, descobertos: sim.descobertos } };
          return gravar(nome, JSON.stringify(doc, rep));
        }, arq);
        log(arq, Math.round(tam / 1e6) + ' MB', Math.round((Date.now() - t0) / 1000) + ' s', erros.length ? 'erros: ' + erros.join(' | ') : '');
      } catch (e) { log(arq, 'FALHOU', e.message.slice(0, 300)); }
    }
  }
  await ctx.close();
})();
