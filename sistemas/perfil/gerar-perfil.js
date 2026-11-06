#!/usr/bin/env node
'use strict';
// Gera o PERFIL de cada local de votação para o distrital misto do simulador:
//  · TSE — perfil do eleitorado por seção (escolaridade, faixa etária,
//    deficiência), somado por local de votação. Sem sexo (54% de mulheres em
//    toda parte: não distingue distritos) e sem estado civil; raça/cor e
//    identidade de gênero do cadastro vêm 83% "não informado" e ficam de fora.
//  · IBGE — Censo 2022 por setor censitário (população, área, situação
//    urbana/rural, cor ou raça, alfabetização, saneamento), atribuído ao local de
//    votação mais próximo DO MESMO MUNICÍPIO (pelo centro do setor). O total de
//    cada município é exato; dentro do município, a divisão entre locais é uma
//    aproximação (o TSE não publica o contorno das zonas) — medida no relatório.
//
// Uso (offline, uma vez por eleição):
//   node sistemas/perfil/gerar-perfil.js --cache <pasta> [--ufs DF,RR] [--saida sistemas/perfil]
// A pasta de cache recebe os downloads (≈ 4 GB no total; os arquivos por estado
// são apagados depois de usados). Saída: perfil-2026-<UF>.json, um por estado,
// e relatorio-2026.json (validação).

const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process'), readline = require('readline');

const ANO = 2026;
const TSE = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const IBGE_SETOR = 'https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/Agregados_por_Setor_csv';
const IBGE_MALHA = 'https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/gpkg/UF';
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

// Campos de cada local, na ordem do arquivo de saída.
const CAMPOS_TSE = ['eleitores',
  'escAnalfabeto', 'escLeEscreve', 'escFundInc', 'escFundComp', 'escMedioInc', 'escMedioComp', 'escSupInc', 'escSupComp', 'escNaoInf',
  'id16a24', 'id25a34', 'id35a44', 'id45a59', 'id60a69', 'id70mais', 'idNaoInf', 'deficiencia'];
const CAMPOS_CENSO = ['pop', 'areaKm2x1000', 'popRural', 'branca', 'preta', 'amarela', 'parda', 'indigena',
  'alfab15', 'naoAlfab15', 'dom', 'aguaRede', 'esgotoRede', 'lixoColetado', 'semBanheiro'];

// Variáveis do Censo (dicionário oficial, dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx).
const CENSO_ARQS = [
  { zip: 'Agregados_por_setores_basico_BR_20260520.zip', csv: 'Agregados_por_setores_basico_BR.csv',
    v: { pop: ['v0001'], areaKm2x1000: ['AREA_KM2'], situacao: ['SITUACAO'] } },
  { zip: 'Agregados_por_setores_cor_ou_raca_BR.zip', csv: 'Agregados_por_setores_cor_ou_raca_BR.csv',
    v: { branca: ['V01317'], preta: ['V01318'], amarela: ['V01319'], parda: ['V01320'], indigena: ['V01321'] } },
  { zip: 'Agregados_por_setores_alfabetizacao_BR.zip', csv: 'Agregados_por_setores_alfabetizacao_BR.csv',
    v: { alfab15: ['V00900'], naoAlfab15: ['V00901'] } },   // 15 anos ou mais: sabe / não sabe ler e escrever
  { zip: 'Agregados_por_setores_caracteristicas_domicilio1_BR_20261021.zip', csv: 'Agregados_por_setores_caracteristicas_domicilio1_BR_20261021.csv',
    v: { dom: ['V00001'] } },                                // domicílios particulares permanentes ocupados
  { zip: 'Agregados_por_setores_caracteristicas_domicilio2_BR_20250417.zip', csv: 'Agregados_por_setores_caracteristicas_domicilio2_BR_20250417.csv',
    v: { aguaRede: ['V00111'], esgotoRede: ['V00309', 'V00310'], lixoColetado: ['V00397', 'V00398'], semBanheiro: ['V00495'] } },
];

// ------------------------------------------------------------ utilitários
const arg = (n, padrao) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : padrao; };
const cod = s => { const t = String(s == null ? '' : s).trim(), n = parseInt(t, 10); return isNaN(n) ? t : String(n); };
const num = s => { const t = String(s == null ? '' : s).trim(); if (!t || t === 'X' || t === '-' || t === '.') return 0; return Number(t.replace(/\./g, '').replace(',', '.')) || 0; };
const numDec = s => { const t = String(s == null ? '' : s).trim(); return Number(t.replace(',', '.')) || 0; };   // decimal com vírgula (área)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function baixar(url, destino) {
  if (fs.existsSync(destino) && fs.statSync(destino).size > 0) return;
  log('baixando', url);
  // A conexão com o TSE cai no meio de arquivos grandes (curl 56): retoma de onde parou (-C -).
  for (let t = 1; ; t++) {
    try { execFileSync('curl', ['-s', '-f', '-C', '-', '--retry', '3', '--max-time', '3600', '-o', destino + '.parcial', url], { stdio: 'inherit' }); break; }
    catch (e) { if (t >= 6) throw e; log(`download interrompido (tentativa ${t}): retomando`); }
  }
  fs.renameSync(destino + '.parcial', destino);
}

/** Lê um CSV (';', aspas, latin1) de dentro de um zip, linha a linha: cada(linha → objeto { coluna: valor }) só com as colunas pedidas. */
function lerCsvZip(zip, membro, colunas, cada, filtroPrefixo) {
  return new Promise((ok, erro) => {
    const p = spawn('unzip', ['-p', zip, membro]);
    const r = readline.createInterface({ input: p.stdout.setEncoding('latin1'), crlfDelay: Infinity });
    let idx = null;
    r.on('line', l => {
      // filtroPrefixo: Set de prefixos da 1ª coluna (ex.: código da UF no setor) — pula a linha sem dividir
      if (filtroPrefixo && idx && !filtroPrefixo.has(l.slice(0, 3).replace(/"/g, '').slice(0, 2))) return;
      const v = l.split(';').map(t => t.replace(/^"|"$/g, ''));
      if (!idx) { idx = colunas.map(c => v.findIndex(h => h.toUpperCase() === c.toUpperCase())); return; }
      const o = {};
      colunas.forEach((c, i) => { o[c] = idx[i] >= 0 ? v[idx[i]] : undefined; });
      o.__0 = v[0];
      cada(o);
    });
    r.on('close', ok);
    p.on('error', erro);
  });
}

// ------------------------------------------------------------ geometria (GeoPackage)
/** Centro (de área) do maior anel externo de um Polygon/MultiPolygon em WKB; [lon, lat]. */
function centroGpkg(blob) {
  const b = Buffer.from(blob);
  if (b[0] !== 0x47 || b[1] !== 0x50) return null;           // 'GP'
  const flags = b[3], envTipo = (flags >> 1) & 7;
  const envBytes = [0, 32, 48, 48, 64][envTipo] || 0;
  let o = 8 + envBytes;
  let melhor = null;
  const lerGeom = () => {
    const le = b[o] === 1; o += 1;
    const rd32 = () => { const x = le ? b.readUInt32LE(o) : b.readUInt32BE(o); o += 4; return x; };
    const rdD = () => { const x = le ? b.readDoubleLE(o) : b.readDoubleBE(o); o += 8; return x; };
    const tipo = rd32() % 1000;
    if (tipo === 6) { const n = rd32(); for (let i = 0; i < n; i++) lerGeom(); return; }
    if (tipo !== 3) throw new Error('geometria não suportada: ' + tipo);
    const nAneis = rd32();
    for (let k = 0; k < nAneis; k++) {
      const n = rd32();
      let a = 0, cx = 0, cy = 0, px = null, py = null, x0 = null, y0 = null;
      for (let i = 0; i < n; i++) {
        const x = rdD(), y = rdD();
        if (k > 0) continue;                                     // buracos: só o anel externo conta
        if (x0 === null) { x0 = x; y0 = y; }
        if (px !== null) { const c = (px - x0) * (y - y0) - (x - x0) * (py - y0); a += c; cx += (px - x0 + x - x0) * c; cy += (py - y0 + y - y0) * c; }
        px = x; py = y;
      }
      if (k === 0 && n) {
        const area = Math.abs(a / 2);
        const c = a ? [x0 + cx / (3 * a), y0 + cy / (3 * a)] : [x0, y0];
        if (!melhor || area > melhor.area) melhor = { area, c };
      }
    }
  };
  lerGeom();
  return melhor ? melhor.c : null;
}

function centrosSetores(gpkg) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(gpkg, { readOnly: true });
  const tab = db.prepare('select table_name, column_name from gpkg_geometry_columns').get();
  const out = new Map();
  for (const r of db.prepare(`select CD_SETOR, "${tab.column_name}" as g from "${tab.table_name}"`).iterate()) {
    const c = centroGpkg(r.g);
    if (c) out.set(String(r.CD_SETOR), c);
  }
  db.close();
  return out;
}

// ------------------------------------------------------------ etapas
async function lerMunicipios(cache) {
  const zip = path.join(cache, 'municipio_tse_ibge.zip');
  baixar(`${TSE}/municipio_tse_ibge/municipio_tse_ibge.zip`, zip);
  const ibgeParaTse = new Map();
  await lerCsvZip(zip, 'municipio_tse_ibge.csv', ['CD_MUNICIPIO_TSE', 'CD_MUNICIPIO_IBGE', 'SG_UF'], o => ibgeParaTse.set(String(o.CD_MUNICIPIO_IBGE), cod(o.CD_MUNICIPIO_TSE)));
  return ibgeParaTse;
}

/** Censo de TODOS os setores (uma passada por arquivo nacional): Map(setor → { campo: valor, cdMun }). */
const UF_IBGE = { AC: 12, AL: 27, AM: 13, AP: 16, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52, MA: 21, MG: 31, MS: 50, MT: 51, PA: 15, PB: 25, PE: 26, PI: 22, PR: 41, RJ: 33, RN: 24, RO: 11, RR: 14, RS: 43, SC: 42, SE: 28, SP: 35, TO: 17 };
async function lerCenso(cache, ufs) {
  const prefixos = new Set(ufs.map(u => String(UF_IBGE[u])));
  const setores = new Map(), sigilo = {};
  for (const a of CENSO_ARQS) {
    const zip = path.join(cache, a.zip);
    baixar(`${IBGE_SETOR}/${a.zip}`, zip);
    const cols = [...new Set(Object.values(a.v).flat())];
    if (a.zip.includes('basico')) cols.push('CD_MUN');
    log('censo:', a.csv);
    await lerCsvZip(zip, a.csv, cols, o => {
      const s = String(o.__0);
      if (!/^\d{15}$/.test(s)) return;
      const r = setores.get(s) || setores.set(s, {}).get(s);
      for (const [campo, vs] of Object.entries(a.v)) {
        if (campo === 'situacao') { r.rural = /rural/i.test(o[vs[0]] || '') ? 1 : 0; continue; }
        if (campo === 'areaKm2x1000') { r.areaKm2x1000 = Math.round(numDec(o[vs[0]]) * 1000); continue; }
        let t = 0;
        for (const v of vs) { if (o[v] === 'X') sigilo[campo] = (sigilo[campo] || 0) + 1; t += num(o[v]); }
        r[campo] = t;
      }
      if (o.CD_MUN) r.cdMun = String(o.CD_MUN);
    }, prefixos);
  }
  return { setores, sigilo };
}

/** Locais de votação da UF (1º turno): seção → local, posição e eleitores de cada local. */
async function lerLocais(cache, uf) {
  const zip = path.join(cache, `eleitorado_local_votacao_${ANO}.zip`);
  baixar(`${TSE}/eleitorado_locais_votacao/eleitorado_local_votacao_${ANO}.zip`, zip);
  const secao = new Map(), locais = new Map();
  await lerCsvZip(zip, `eleitorado_local_votacao_${ANO}_${uf}.csv`,
    ['NR_TURNO', 'SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'NR_LOCAL_VOTACAO', 'NR_LATITUDE', 'NR_LONGITUDE', 'QT_ELEITOR_SECAO'], o => {
      if (o.SG_UF !== uf || (o.NR_TURNO && o.NR_TURNO !== '1')) return;
      const mun = cod(o.CD_MUNICIPIO), z = cod(o.NR_ZONA), k = `${mun}|${z}|${cod(o.NR_LOCAL_VOTACAO)}`;
      secao.set(`${mun}|${z}|${cod(o.NR_SECAO)}`, k);
      const l = locais.get(k) || locais.set(k, { mun, aptos: 0, la: 0, lo: 0, qp: 0 }).get(k);
      const q = num(o.QT_ELEITOR_SECAO);
      l.aptos += q;
      const la = numDec(o.NR_LATITUDE), lo = numDec(o.NR_LONGITUDE);
      if (la && lo && la !== -1 && lo !== -1) { l.la += la * (q || 1); l.lo += lo * (q || 1); l.qp += (q || 1); }
    });
  for (const l of locais.values()) { if (l.qp) { l.la /= l.qp; l.lo /= l.qp; } else { l.la = l.lo = null; } }
  return { secao, locais };
}

const ESC = [[/ANALFABETO/, 'escAnalfabeto'], [/L[ÊE] E ESCREVE/, 'escLeEscreve'], [/FUNDAMENTAL INCOMPLETO/, 'escFundInc'], [/FUNDAMENTAL COMPLETO/, 'escFundComp'],
  [/M[ÉE]DIO INCOMPLETO/, 'escMedioInc'], [/M[ÉE]DIO COMPLETO/, 'escMedioComp'], [/SUPERIOR INCOMPLETO/, 'escSupInc'], [/SUPERIOR COMPLETO/, 'escSupComp']];
function campoIdade(ds) {
  const m = String(ds || '').match(/(\d+)/);
  if (!m) return 'idNaoInf';
  const a = Number(m[1]);
  return a < 16 || a > 120 ? 'idNaoInf' : a <= 24 ? 'id16a24' : a <= 34 ? 'id25a34' : a <= 44 ? 'id35a44' : a <= 59 ? 'id45a59' : a <= 69 ? 'id60a69' : 'id70mais';
}

async function lerPerfilTse(cache, uf, L) {
  const zip = path.join(cache, `perfil_eleitor_secao_${ANO}_${uf}.zip`);
  baixar(`${TSE}/perfil_eleitor_secao/perfil_eleitor_secao_${ANO}_${uf}.zip`, zip);
  const por = new Map(), iT = Object.fromEntries(CAMPOS_TSE.map((c, i) => [c, i]));
  let total = 0, semLocal = 0, porFallback = 0;
  await lerCsvZip(zip, `perfil_eleitor_secao_${ANO}_${uf}.csv`,
    ['SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'NR_LOCAL_VOTACAO', 'DS_FAIXA_ETARIA', 'DS_GRAU_ESCOLARIDADE', 'QT_ELEITORES', 'QT_ELEITORES_DEFICIENCIA'], o => {
      const q = num(o.QT_ELEITORES);
      if (!q) return;
      total += q;
      const mun = cod(o.CD_MUNICIPIO), z = cod(o.NR_ZONA);
      let k = L.secao.get(`${mun}|${z}|${cod(o.NR_SECAO)}`);
      if (!k) {   // seção que mudou desde o perfil (julho) até o cadastro final: o local que o próprio perfil aponta
        const k2 = `${mun}|${z}|${cod(o.NR_LOCAL_VOTACAO)}`;
        if (L.locais.has(k2)) { k = k2; porFallback += q; } else { semLocal += q; return; }
      }
      const v = por.get(k) || por.set(k, new Array(CAMPOS_TSE.length).fill(0)).get(k);
      v[iT.eleitores] += q;
      const ds = String(o.DS_GRAU_ESCOLARIDADE || '').toUpperCase();
      const e = ESC.find(([re]) => re.test(ds));
      v[iT[e ? e[1] : 'escNaoInf']] += q;
      v[iT[campoIdade(o.DS_FAIXA_ETARIA)]] += q;
      v[iT.deficiencia] += num(o.QT_ELEITORES_DEFICIENCIA);
    });
  try { fs.unlinkSync(zip); } catch (_) {}
  return { por, total, semLocal, porFallback };
}

/** Censo da UF → locais: cada setor vai ao local de votação mais próximo do mesmo município. */
async function atribuirCenso(cache, uf, L, censo, ibgeParaTse) {
  const gpkg = path.join(cache, `${uf}_setores_CD2022.gpkg`);
  baixar(`${IBGE_MALHA}/${uf}/${uf}_setores_CD2022.gpkg`, gpkg);
  const centros = centrosSetores(gpkg);
  try { fs.unlinkSync(gpkg); } catch (_) {}
  const porMun = new Map();
  for (const [k, l] of L.locais) (porMun.get(l.mun) || porMun.set(l.mun, []).get(l.mun)).push([k, l]);
  const por = new Map(), iC = Object.fromEntries(CAMPOS_CENSO.map((c, i) => [c, i]));
  const ufIbge = UF_IBGE[uf];
  let popUf = 0, popSemLocal = 0, setoresSemCentro = 0, setoresUf = 0;
  for (const [s, r] of censo.setores) {
    if (!s.startsWith(String(ufIbge))) continue;
    setoresUf++;
    popUf += r.pop || 0;
    const mun = ibgeParaTse.get(r.cdMun || s.slice(0, 7));
    const ls = mun && porMun.get(mun);
    if (!ls || !ls.length) { popSemLocal += r.pop || 0; continue; }
    const c = centros.get(s);
    let alvo = null;
    const comPos = ls.filter(([, l]) => l.la != null);
    if (c && comPos.length) {
      const cosLat = Math.cos(c[1] * Math.PI / 180);
      let d0 = Infinity;
      for (const [k, l] of comPos) { const dx = (l.lo - c[0]) * cosLat, dy = l.la - c[1], d = dx * dx + dy * dy; if (d < d0) { d0 = d; alvo = k; } }
    } else {
      if (!c) setoresSemCentro++;
      alvo = ls.reduce((m, x) => (!m || x[1].aptos > m[1].aptos ? x : m), null)[0];   // sem posição: o maior local do município
    }
    const v = por.get(alvo) || por.set(alvo, new Array(CAMPOS_CENSO.length).fill(0)).get(alvo);
    for (const c2 of CAMPOS_CENSO) {
      if (c2 === 'popRural') v[iC.popRural] += r.rural ? (r.pop || 0) : 0;
      else v[iC[c2]] += r[c2] || 0;
    }
  }
  return { por, popUf, popSemLocal, setoresSemCentro, setoresUf };
}

/** Qualidade da aproximação dentro dos municípios divididos: a fatia da população de cada zona ÷ a fatia dos eleitores. */
function validarZonas(L, porCenso, iPop) {
  const z = new Map();
  for (const [k, l] of L.locais) {
    const zk = k.split('|').slice(0, 2).join('|');
    const o = z.get(zk) || z.set(zk, { mun: l.mun, apt: 0, pop: 0 }).get(zk);
    o.apt += l.aptos; o.pop += (porCenso.get(k) || [])[iPop] || 0;
  }
  const mun = new Map();
  for (const o of z.values()) { const m = mun.get(o.mun) || mun.set(o.mun, { apt: 0, pop: 0, zonas: [] }).get(o.mun); m.apt += o.apt; m.pop += o.pop; m.zonas.push(o); }
  const razoes = [];
  for (const m of mun.values()) {
    if (m.zonas.length < 2 || !m.pop || !m.apt) continue;
    for (const o of m.zonas) if (o.apt) razoes.push((o.pop / m.pop) / (o.apt / m.apt));
  }
  razoes.sort((a, b) => a - b);
  const q = p => razoes.length ? Number(razoes[Math.min(razoes.length - 1, Math.floor(p * razoes.length))].toFixed(2)) : null;
  return { zonasEmMunicipiosDivididos: razoes.length, razaoPopEleitores: { p10: q(0.1), p25: q(0.25), mediana: q(0.5), p75: q(0.75), p90: q(0.9) } };
}

// ------------------------------------------------------------ principal
if (require.main !== module) {
  module.exports = { centroGpkg, campoIdade, ESC, CAMPOS_TSE, CAMPOS_CENSO, cod, num, numDec };
} else (async () => {
  const cache = arg('cache');
  if (!cache) { console.error('uso: node gerar-perfil.js --cache <pasta> [--ufs DF,RR] [--saida pasta]'); process.exit(1); }
  fs.mkdirSync(cache, { recursive: true });
  const saida = arg('saida', __dirname);
  const ufs = (arg('ufs') || UFS.join(',')).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const ibgeParaTse = await lerMunicipios(cache);
  const censo = await lerCenso(cache, ufs);
  log('censo:', censo.setores.size, 'setores; com sigilo (X):', JSON.stringify(censo.sigilo));
  const relPath = path.join(saida, `relatorio-${ANO}.json`);
  const relatorio = fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf8')) : {};
  for (const uf of ufs) {
    log('==', uf);
    const L = await lerLocais(cache, uf);
    const tse = await lerPerfilTse(cache, uf, L);
    const ce = await atribuirCenso(cache, uf, L, censo, ibgeParaTse);
    const loc = {};
    for (const k of new Set([...L.locais.keys()])) {
      const a = tse.por.get(k), b = ce.por.get(k);
      if (!a && !b) continue;
      loc[k] = [...(a || new Array(CAMPOS_TSE.length).fill(0)), ...(b || new Array(CAMPOS_CENSO.length).fill(0))];
    }
    const val = {
      eleitoresPerfil: tse.total, eleitoresSemLocal: tse.semLocal, eleitoresPeloLocalDoPerfil: tse.porFallback,
      popCensoUf: ce.popUf, popSemLocal: ce.popSemLocal, setores: ce.setoresUf, setoresSemCentro: ce.setoresSemCentro,
      locais: Object.keys(loc).length, ...validarZonas(L, ce.por, CAMPOS_CENSO.indexOf('pop')),
    };
    const doc = {
      versao: 1, ano: ANO, uf, gerado: new Date().toISOString(),
      fontes: {
        tse: `perfil_eleitor_secao_${ANO}_${uf} + eleitorado_local_votacao_${ANO} (dados abertos do TSE)`,
        censo: 'Censo 2022, agregados por setor censitário (IBGE): básico, cor ou raça, alfabetização, características do domicílio 1 e 2; malha de setores 2022',
        municipios: 'municipio_tse_ibge (TSE)',
      },
      campos: { tse: CAMPOS_TSE, censo: CAMPOS_CENSO },
      validacao: val,
      loc,
    };
    fs.writeFileSync(path.join(saida, `perfil-${ANO}-${uf}.json`), JSON.stringify(doc));
    relatorio[uf] = val;
    fs.writeFileSync(relPath, JSON.stringify(relatorio, null, 1));
    log(uf, JSON.stringify(val));
  }
})().catch(e => { console.error(e); process.exit(1); });
