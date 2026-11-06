// Reduz os arquivos do TSE a JSON compactos por município (código TSE).
//  partidos-<ano>.json: deputado federal (6) e estadual/distrital (7/8): { mun: { uf, nome, f: {SG: votos}, e: {SG: votos} } }
//  municipais-<ano>.json: prefeito (11) e vereador (13): { mun: { uf, nome, pref: [{sg, votos, turno, eleito}], ver: {SG: {eleitos, votosEleitos, top3}} } }
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), readline = require('readline');
const T = process.argv[2];
function linhas(zip, entrada, fn) {
  return new Promise((ok, erro) => {
    const p = spawn('unzip', ['-p', zip, entrada]);
    const r = readline.createInterface({ input: p.stdout.setEncoding('latin1'), crlfDelay: Infinity });
    let h = null;
    r.on('line', l => { const v = l.split(';').map(t => t.replace(/^"|"$/g, '')); if (!h) { h = Object.fromEntries(v.map((c, i) => [c, i])); return; } fn(v, h); });
    r.on('close', ok); p.on('error', erro);
  });
}
const entradas = zip => require('child_process').execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter(n => /_[A-Z]{2}\.csv$/.test(n) && !/BRASIL/.test(n));
(async () => {
  for (const ano of [2018, 2022, 2026]) {
    const zip = path.join(T, `votacao_partido_munzona_${ano}.zip`), out = {};
    for (const e of entradas(zip)) await linhas(zip, e, (v, h) => {
      const c = v[h.CD_CARGO]; if (!['6', '7', '8'].includes(c) || v[h.NR_TURNO] !== '1') return;
      const m = v[h.CD_MUNICIPIO], o = out[m] || (out[m] = { uf: v[h.SG_UF], nome: v[h.NM_MUNICIPIO], f: {}, e: {} });
      const n = (+v[h.QT_VOTOS_NOMINAIS_VALIDOS] || 0) + (+v[h.QT_TOTAL_VOTOS_LEG_VALIDOS] || 0);
      const alvo = c === '6' ? o.f : o.e, sg = v[h.SG_PARTIDO];
      alvo[sg] = (alvo[sg] || 0) + n;
    });
    fs.writeFileSync(path.join(T, `partidos-${ano}.json`), JSON.stringify(out));
    console.log(ano, Object.keys(out).length, 'municípios');
  }
  for (const ano of [2020, 2024]) {
    const zip = path.join(T, `votacao_candidato_munzona_${ano}.zip`), out = {}, cand = {};
    for (const e of entradas(zip)) await linhas(zip, e, (v, h) => {
      if (v[h.CD_TIPO_ELEICAO] !== '2') return;   // só a eleição ordinária
      const c = v[h.CD_CARGO]; if (c !== '11' && c !== '13') return;
      const m = v[h.CD_MUNICIPIO], k = m + '|' + c + '|' + v[h.NR_TURNO] + '|' + v[h.SQ_CANDIDATO];
      const x = cand[k] || (cand[k] = { m, uf: v[h.SG_UF], nome: v[h.NM_MUNICIPIO], c, turno: +v[h.NR_TURNO], sg: v[h.SG_PARTIDO], votos: 0, sit: v[h.DS_SIT_TOT_TURNO] });
      x.votos += +v[h.QT_VOTOS_NOMINAIS_VALIDOS] || 0;
    });
    for (const x of Object.values(cand)) {
      const o = out[x.m] || (out[x.m] = { uf: x.uf, nome: x.nome, pref: [], verTodos: [] });
      if (x.c === '11') o.pref.push({ sg: x.sg, votos: x.votos, turno: x.turno, eleito: /^ELEITO/.test(x.sit) });
      else o.verTodos.push({ sg: x.sg, votos: x.votos, eleito: /^ELEITO/.test(x.sit) });
    }
    for (const o of Object.values(out)) {
      const el = o.verTodos.filter(x => x.eleito).sort((a, b) => b.votos - a.votos);
      o.ver = {};
      el.forEach((x, i) => { const g = o.ver[x.sg] || (o.ver[x.sg] = { eleitos: 0, top3: 0, votosEleitos: 0 }); g.eleitos++; g.votosEleitos += x.votos; if (i < 3) g.top3++; });
      o.verVotos = {}; for (const x of o.verTodos) o.verVotos[x.sg] = (o.verVotos[x.sg] || 0) + x.votos;
      delete o.verTodos;
    }
    fs.writeFileSync(path.join(T, `municipais-${ano}.json`), JSON.stringify(out));
    console.log(ano, Object.keys(out).length, 'municípios');
  }
})();
