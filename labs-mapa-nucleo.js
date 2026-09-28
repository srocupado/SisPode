'use strict';
// Labs · Mapa Territorial — NÚCLEO compartilhado entre a extensão (labs-mapa.js,
// processamento manual no navegador) e o bot (bot/src/labsmapa.js, /labsmapa).
// Mesmo padrão de pauta-parser.js: na extensão as funções ficam no escopo
// global; no Node, o bloco do fim exporta.
//
// Tudo aqui é PURO (sem rede, sem disco): a leitura do CSV do TSE linha a
// linha, a agregação dos votos por município, a ponte entre o código de
// município do TSE e o do IBGE (são numerações DIFERENTES — a ponte é pelo nome
// dentro da UF) e a leitura da localidade das emendas.
//
// Arquivo do TSE: votacao_candidato_munzona_{ano}_{UF}.csv — latin1, ';',
// campos entre aspas, UMA linha por candidato × município × zona (a soma por
// município junta as zonas). As colunas são lidas pelo NOME do cabeçalho, não
// pela posição, para sobreviver a mudanças de layout entre eleições.
//
// No banco, chaves de município levam prefixo "m" (m3550308): chave só com
// dígitos faz o Firebase transformar o objeto em array.

const LMN_CARGO_DEPUTADO_FEDERAL = '6';

function lmnNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`´]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

/** Campos de uma linha CSV com ';' e aspas ("" dentro de aspas = aspa). */
function lmnCampos(linha) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (q) {
      if (c === '"') { if (linha[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur.replace(/\r$/, ''));
  return out;
}

/**
 * Separa um fluxo de texto em linhas, entregando cada linha completa a
 * `aoLer`. Devolve { empurrar(texto), fim() } — `fim` entrega a última linha.
 */
function lmnLinhas(aoLer) {
  let resto = '';
  return {
    empurrar(txt) {
      const partes = (resto + txt).split('\n');
      resto = partes.pop();
      for (const l of partes) if (l) aoLer(l);
    },
    fim() { if (resto) aoLer(resto); resto = ''; },
  };
}

/**
 * Agregador dos votos de uma lista de deputados-alvo.
 * alvos: [{ id, nome (parlamentar), nomeCivil, uf }].
 * Casamento, sempre dentro da UF e só no cargo Deputado Federal:
 *   1º NM_CANDIDATO = nome civil (normalizados);
 *   2º se nada casou pelo civil, NM_URNA_CANDIDATO = nome parlamentar — e só se
 *      um único candidato casar (nome de urna repetido não é aceito).
 * Uso: const ag = lmnAgregador(alvos); ag.linha(texto) para CADA linha
 * (a 1ª é o cabeçalho; cada arquivo novo recomeça com ag.novoArquivo()); ag.resultado().
 */
function lmnAgregador(alvos) {
  const porUf = new Map();
  for (const a of alvos || []) {
    const uf = String(a.uf || '').toUpperCase();
    if (!porUf.has(uf)) porUf.set(uf, []);
    porUf.get(uf).push({ alvo: a, civil: lmnNorm(a.nomeCivil), urna: lmnNorm(a.nome), bCivil: new Map(), bUrna: new Map() });
  }
  const municipios = {};   // codTse → { n, uf, t }
  const ufs = new Set();
  let col = null, linhas = 0, arquivos = 0;

  const OBRIG = ['SG_UF', 'CD_MUNICIPIO', 'NM_MUNICIPIO', 'SQ_CANDIDATO', 'NM_CANDIDATO', 'NM_URNA_CANDIDATO'];

  function cabecalho(campos) {
    const idx = {};
    campos.forEach((c, i) => { idx[String(c).trim().toUpperCase()] = i; });
    const falta = OBRIG.filter(k => idx[k] == null);
    const votos = idx.QT_VOTOS_NOMINAIS_VALIDOS != null ? idx.QT_VOTOS_NOMINAIS_VALIDOS : idx.QT_VOTOS_NOMINAIS;
    if (votos == null) falta.push('QT_VOTOS_NOMINAIS');
    if (idx.CD_CARGO == null && idx.DS_CARGO == null) falta.push('CD_CARGO');
    if (falta.length) throw new Error('Arquivo fora do formato do TSE (votação por município e zona). Faltam as colunas: ' + falta.join(', '));
    col = { idx, votos };
  }

  function add(b, sq, cod, v, campos) {
    let e = b.get(sq);
    if (!e) {
      e = { sq, nomeUrna: campos[col.idx.NM_URNA_CANDIDATO], partido: col.idx.SG_PARTIDO != null ? campos[col.idx.SG_PARTIDO] : '', total: 0, mun: {} };
      b.set(sq, e);
    }
    e.total += v;
    e.mun[cod] = (e.mun[cod] || 0) + v;
  }

  function linha(texto) {
    const campos = lmnCampos(texto);
    if (!col) { cabecalho(campos); return; }
    const I = col.idx;
    const cargoOk = I.CD_CARGO != null
      ? String(campos[I.CD_CARGO]).trim() === LMN_CARGO_DEPUTADO_FEDERAL
      : lmnNorm(campos[I.DS_CARGO]) === 'deputado federal';
    if (!cargoOk) return;
    linhas++;
    const uf = String(campos[I.SG_UF] || '').trim().toUpperCase();
    const cod = String(campos[I.CD_MUNICIPIO] || '').trim();
    const v = parseInt(campos[col.votos], 10) || 0;
    ufs.add(uf);
    const m = municipios[cod] || (municipios[cod] = { n: campos[I.NM_MUNICIPIO], uf, t: 0 });
    m.t += v;
    const lista = porUf.get(uf);
    if (!lista) return;
    const nc = lmnNorm(campos[I.NM_CANDIDATO]);
    const nu = lmnNorm(campos[I.NM_URNA_CANDIDATO]);
    const sq = String(campos[I.SQ_CANDIDATO] || '').trim();
    for (const x of lista) {
      if (x.civil && nc === x.civil) add(x.bCivil, sq, cod, v, campos);
      else if (x.urna && nu === x.urna) add(x.bUrna, sq, cod, v, campos);
    }
  }

  function escolher(x) {
    const maior = b => [...b.values()].sort((a, c) => c.total - a.total)[0];
    if (x.bCivil.size) return maior(x.bCivil);
    if (x.bUrna.size === 1) return maior(x.bUrna);
    return null;
  }

  function resultado() {
    const deputados = {}, naoEncontrados = [];
    for (const [uf, lista] of porUf) {
      for (const x of lista) {
        const e = escolher(x);
        if (!e) {
          naoEncontrados.push({ id: x.alvo.id, nome: x.alvo.nome, uf,
            motivo: !ufs.has(uf) ? `arquivo de ${uf} não processado` : (x.bUrna.size > 1 ? 'nome de urna ambíguo' : 'nome não encontrado no arquivo') });
          continue;
        }
        deputados[x.alvo.id] = { id: x.alvo.id, nome: x.alvo.nome, uf, sq: e.sq, nomeUrna: e.nomeUrna, partidoEleicao: e.partido, total: e.total, municipios: e.mun };
      }
    }
    return { deputados, naoEncontrados, municipios, ufs: [...ufs].sort(), linhas, arquivos };
  }

  return {
    linha,
    novoArquivo() { col = null; arquivos++; },
    resultado,
  };
}

function lmnDistancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * Resolve um nome de município (qualquer grafia) para o código IBGE, dentro da
 * UF. `ibgeDaUf`: [{ id, nome }] da API de localidades do IBGE. Ordem: nome
 * normalizado igual; sem espaços igual; e, por fim, UM único candidato a no
 * máximo 2 letras de distância ("Moji Mirim" → "Mogi Mirim"). Devolve o id ou null.
 */
function lmnResolvedor(ibgeDaUf) {
  const exato = new Map(), compacto = new Map();
  const lista = (ibgeDaUf || []).map(m => ({ id: String(m.id), n: lmnNorm(m.nome) }));
  for (const m of lista) { exato.set(m.n, m.id); compacto.set(m.n.replace(/ /g, ''), m.id); }
  return nome => {
    const n = lmnNorm(nome);
    if (!n) return null;
    if (exato.has(n)) return exato.get(n);
    const c = n.replace(/ /g, '');
    if (compacto.has(c)) return compacto.get(c);
    const perto = lista.filter(m => lmnDistancia(m.n, n) <= 2);
    return perto.length === 1 ? perto[0].id : null;
  };
}

/**
 * Converte o resultado do agregador (códigos TSE) para o registro do banco
 * (códigos IBGE com prefixo "m"). `ibgePorUf`: { UF: [{id, nome}] }.
 * Devolve { deputados, municipios: { UF: { mID: {n, t} } }, semPar: [{uf, n}] }.
 */
function lmnParaIbge(res, ibgePorUf) {
  const resolv = {};
  const tseParaIbge = {};
  const semPar = [];
  const municipios = {};
  for (const [cod, m] of Object.entries(res.municipios)) {
    const uf = m.uf;
    if (!resolv[uf]) resolv[uf] = lmnResolvedor(ibgePorUf[uf] || []);
    const id = resolv[uf](m.n);
    if (!id) { semPar.push({ uf, n: m.n, t: m.t }); continue; }
    tseParaIbge[cod] = 'm' + id;
    if (!municipios[uf]) municipios[uf] = {};
    municipios[uf]['m' + id] = { n: m.n, t: m.t };
  }
  const deputados = {};
  for (const [id, d] of Object.entries(res.deputados)) {
    const mun = {};
    let foraDoMapa = 0;
    for (const [cod, v] of Object.entries(d.municipios)) {
      const k = tseParaIbge[cod];
      if (k) mun[k] = (mun[k] || 0) + v; else foraDoMapa += v;
    }
    deputados[id] = { nome: d.nome, uf: d.uf, nomeUrna: d.nomeUrna, partidoEleicao: d.partidoEleicao, total: d.total, foraDoMapa, municipios: mun };
  }
  return { deputados, municipios, semPar };
}

/**
 * A localidade de uma emenda, como o Portal da Transparência escreve:
 *   "CAMPINAS - SP"            → { tipo: 'municipio', nome: 'CAMPINAS', uf: 'SP' }
 *   "SÃO PAULO (UF)"           → { tipo: 'uf', nome: 'SÃO PAULO' }
 *   "MÚLTIPLO", "NACIONAL"…    → { tipo: 'outro', rotulo }
 */
function lmnLocalidade(txt) {
  const s = String(txt || '').trim();
  let m = s.match(/^(.+?)\s+[-–]\s+([A-Za-z]{2})$/);
  if (m) return { tipo: 'municipio', nome: m[1].trim(), uf: m[2].toUpperCase() };
  m = s.match(/^(.+?)\s*\(UF\)$/i);
  if (m) return { tipo: 'uf', nome: m[1].trim() };
  return { tipo: 'outro', rotulo: s || 'SEM LOCALIDADE' };
}

function lmnDinheiro(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v == null ? '' : v).replace(/[R$\s.]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Chave segura para o Firebase (sem . # $ [ ] /). */
function lmnChave(s) { return String(s || '').replace(/[.#$\[\]\/]/g, ' ').trim() || '-'; }

/**
 * Agrega as emendas (registros crus do Portal) por destino. `resolverMun(nome,
 * uf)` devolve o id IBGE ou null. Só entra valor PAGO.
 * Devolve { total, municipais: { mID: pago }, outros: { rotulo: pago }, n }.
 */
function lmnAgregarEmendas(registros, resolverMun) {
  const out = { total: 0, municipais: {}, outros: {}, n: 0 };
  for (const e of registros || []) {
    const pago = lmnDinheiro(e.valorPago);
    out.n++;
    if (!pago) continue;
    out.total += pago;
    const loc = lmnLocalidade(e.localidadeDoGasto);
    const id = loc.tipo === 'municipio' ? resolverMun(loc.nome, loc.uf) : null;
    if (id) out.municipais['m' + id] = (out.municipais['m' + id] || 0) + pago;
    else {
      const rot = lmnChave(loc.tipo === 'municipio' ? `${loc.nome} - ${loc.uf}` : loc.tipo === 'uf' ? `${loc.nome} (UF)` : loc.rotulo);
      out.outros[rot] = (out.outros[rot] || 0) + pago;
    }
  }
  return out;
}

/** Nome como o Portal guarda (maiúsculas, sem acento) — o filtro nomeAutor exige. */
function lmnNomeAutor(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// ============================================================
// Exportação para Node (bot). Na extensão, este bloco é inerte.
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lmnNorm, lmnCampos, lmnLinhas, lmnAgregador, lmnResolvedor, lmnParaIbge, lmnLocalidade, lmnDinheiro, lmnChave, lmnAgregarEmendas, lmnNomeAutor, lmnDistancia };
}
