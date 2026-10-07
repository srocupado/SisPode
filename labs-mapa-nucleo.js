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
// Eleições que o mapa mostra, da mais recente para a mais antiga. Em 2026 a
// bancada vem do PRÓPRIO arquivo (os eleitos do partido) — os novos só entram
// na API da Câmara depois da posse; em 2022, dos deputados de hoje na Câmara.
const LMN_ANOS = ['2026', '2022'];
// Eleição usada na comparação ("como foi na anterior") de cada eleição.
const LMN_ANTERIOR = { 2026: '2022' };
function lmnBancadaDoArquivo(ano) { return Number(ano) >= 2026; }

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
 * Com opcoes.eleitosDoPartido ('PODE'), os alvos saem do próprio arquivo: os
 * candidatos a deputado federal do partido com situação "ELEITO POR QP/MÉDIA"
 * (DS_SIT_TOT_TURNO) — id "tse<SQ_CANDIDATO>", nome = nome de urna.
 * alvos: [{ id, nome (parlamentar), nomeCivil, uf }].
 * Casamento, sempre dentro da UF e só no cargo Deputado Federal:
 *   1º NM_CANDIDATO = nome civil (normalizados);
 *   2º se nada casou pelo civil, NM_URNA_CANDIDATO = nome parlamentar — e só se
 *      um único candidato casar (nome de urna repetido não é aceito).
 * Uso: const ag = lmnAgregador(alvos); ag.linha(texto) para CADA linha
 * (a 1ª é o cabeçalho; cada arquivo novo recomeça com ag.novoArquivo()); ag.resultado().
 */
function lmnAgregador(alvos, opcoes = {}) {
  const siglaEleitos = opcoes.eleitosDoPartido ? String(opcoes.eleitosDoPartido).toUpperCase() : '';
  const eleitos = new Map();   // sq → entrada (modo eleitosDoPartido)
  const porUf = new Map();
  for (const a of alvos || []) {
    const uf = String(a.uf || '').toUpperCase();
    if (!porUf.has(uf)) porUf.set(uf, []);
    porUf.get(uf).push({ alvo: a, civil: lmnNorm(a.nomeCivil), urna: lmnNorm(a.nome), bCivil: new Map(), bUrna: new Map() });
  }
  const municipios = {};   // codTse → { n, uf, t }
  const ufs = new Set();
  const ufsAnteriores = new Set();   // UFs já lidas em arquivos ANTERIORES (repetição = soma em dobro)
  const ufsDesteArquivo = new Set();
  let col = null, linhas = 0, arquivos = 0;

  const OBRIG = ['SG_UF', 'CD_MUNICIPIO', 'NM_MUNICIPIO', 'SQ_CANDIDATO', 'NM_CANDIDATO', 'NM_URNA_CANDIDATO'];

  function cabecalho(campos) {
    const idx = {};
    campos.forEach((c, i) => { idx[String(c).trim().toUpperCase()] = i; });
    const falta = OBRIG.filter(k => idx[k] == null);
    const votos = idx.QT_VOTOS_NOMINAIS_VALIDOS != null ? idx.QT_VOTOS_NOMINAIS_VALIDOS : idx.QT_VOTOS_NOMINAIS;
    if (votos == null) falta.push('QT_VOTOS_NOMINAIS');
    // Candidato "Anulado sub judice" na data do arquivo tem VALIDOS = 0, mas
    // os votos existem (quem tomou posse os teve validados): usa NOMINAIS.
    const nominais = idx.QT_VOTOS_NOMINAIS != null ? idx.QT_VOTOS_NOMINAIS : votos;
    const destinacao = idx.NM_TIPO_DESTINACAO_VOTOS != null ? idx.NM_TIPO_DESTINACAO_VOTOS : idx.DS_TIPO_DESTINACAO_VOTOS;
    if (idx.CD_CARGO == null && idx.DS_CARGO == null) falta.push('CD_CARGO');
    if (siglaEleitos) for (const k of ['SG_PARTIDO', 'DS_SIT_TOT_TURNO']) if (idx[k] == null) falta.push(k);
    if (falta.length) throw new Error('Arquivo fora do formato do TSE (votação por município e zona). Faltam as colunas: ' + falta.join(', '));
    col = { idx, votos, nominais, destinacao };
  }

  function add(b, sq, cod, v, campos) {
    let e = b.get(sq);
    if (!e) {
      const I = col.idx;
      e = { sq, nomeUrna: campos[I.NM_URNA_CANDIDATO], nomeCivil: campos[I.NM_CANDIDATO], partido: I.SG_PARTIDO != null ? campos[I.SG_PARTIDO] : '',
        numero: I.NR_CANDIDATO != null ? String(campos[I.NR_CANDIDATO]).trim() : '', situacao: I.DS_SIT_TOT_TURNO != null ? campos[I.DS_SIT_TOT_TURNO] : '', total: 0, mun: {} };
      b.set(sq, e);
    }
    e.total += v;
    if (v > 0) e.mun[cod] = (e.mun[cod] || 0) + v;   // município só entra com voto
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
    let v = parseInt(campos[col.votos], 10) || 0;
    const subJudice = col.destinacao != null && /^anulado sub judice/.test(lmnNorm(campos[col.destinacao]));
    if (subJudice) v = parseInt(campos[col.nominais], 10) || 0;
    if (!ufsDesteArquivo.has(uf)) {
      if (ufsAnteriores.has(uf)) throw new Error(`O estado ${uf} aparece em mais de um arquivo (ex.: o arquivo BRASIL junto com o do estado, ou o mesmo estado duas vezes) — os votos seriam somados em dobro. Escolha cada estado uma vez só.`);
      ufsDesteArquivo.add(uf);
    }
    ufs.add(uf);
    const m = municipios[cod] || (municipios[cod] = { n: campos[I.NM_MUNICIPIO], uf, t: 0 });
    m.t += v;
    const sq = String(campos[I.SQ_CANDIDATO] || '').trim();
    if (siglaEleitos) {
      // "NÃO ELEITO" normalizado é "nao eleito": não começa por "eleito".
      if (String(campos[I.SG_PARTIDO]).trim().toUpperCase() === siglaEleitos && /^eleito/.test(lmnNorm(campos[I.DS_SIT_TOT_TURNO]))) {
        if (!eleitos.has(sq)) eleitos.set(sq, { uf, b: new Map() });
        add(eleitos.get(sq).b, sq, cod, v, campos);
      }
      return;
    }
    const lista = porUf.get(uf);
    if (!lista) return;
    const nc = lmnNorm(campos[I.NM_CANDIDATO]);
    const nu = lmnNorm(campos[I.NM_URNA_CANDIDATO]);
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

  const ficha = (id, nome, uf, e) => ({ id, nome, uf, sq: e.sq, nomeUrna: e.nomeUrna, nomeCivil: e.nomeCivil, numero: e.numero,
    situacao: e.situacao, partidoEleicao: e.partido, total: e.total, municipios: e.mun });

  function resultado() {
    const deputados = {}, naoEncontrados = [];
    if (siglaEleitos) {
      for (const [sq, { uf, b }] of eleitos) { const e = b.get(sq); deputados['tse' + sq] = ficha('tse' + sq, lmnNomeProprio(e.nomeUrna), uf, e); }
      return { deputados, naoEncontrados, municipios, ufs: [...ufs].sort(), linhas, arquivos };
    }
    for (const [uf, lista] of porUf) {
      for (const x of lista) {
        const e = escolher(x);
        if (!e) {
          naoEncontrados.push({ id: x.alvo.id, nome: x.alvo.nome, uf,
            motivo: !ufs.has(uf) ? `arquivo de ${uf} não processado` : (x.bUrna.size > 1 ? 'nome de urna ambíguo' : 'nome não encontrado no arquivo') });
          continue;
        }
        deputados[x.alvo.id] = ficha(x.alvo.id, x.alvo.nome, uf, e);
      }
    }
    return { deputados, naoEncontrados, municipios, ufs: [...ufs].sort(), linhas, arquivos };
  }

  return {
    linha,
    novoArquivo() { col = null; arquivos++; for (const u of ufsDesteArquivo) ufsAnteriores.add(u); ufsDesteArquivo.clear(); },
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
// Municípios cujo nome no TSE não é o do IBGE (renomeados, grafia antiga) e
// que nenhuma regra de grafia resolve sozinha. Chave: "UF|nome TSE normalizado".
const LMN_APELIDOS = {
  'AP|agua branca do amapari': 'Pedra Branca do Amapari',
  'PB|santarem': 'Joca Claudino',
  'PB|sao domingos de pombal': 'São Domingos',
  'RN|ares': 'Arez',
  'RN|boa saude': 'Januário Cicco',
  'RR|sao luiz': 'São Luiz do Anauá',
  'TO|couto de magalhaes': 'Couto Magalhães',
  'TO|fortaleza do tabocao': 'Tabocão',
  'TO|sao valerio da natividade': 'São Valério',
  'SP|embu': 'Embu das Artes',
};

function lmnResolvedor(ibgeDaUf, uf) {
  const exato = new Map(), compacto = new Map();
  const lista = (ibgeDaUf || []).map(m => ({ id: String(m.id), n: lmnNorm(m.nome) }));
  for (const m of lista) { exato.set(m.n, m.id); compacto.set(m.n.replace(/ /g, ''), m.id); }
  const U = String(uf || '').toUpperCase();
  return nome => {
    let n = lmnNorm(nome);
    if (!n) return null;
    if (U && LMN_APELIDOS[U + '|' + n] && exato.has(lmnNorm(LMN_APELIDOS[U + '|' + n]))) n = lmnNorm(LMN_APELIDOS[U + '|' + n]);
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
    if (!resolv[uf]) resolv[uf] = lmnResolvedor(ibgePorUf[uf] || [], uf);
    const id = resolv[uf](m.n);
    if (!id) { semPar.push({ uf, n: m.n, t: m.t }); continue; }
    tseParaIbge[cod] = 'm' + id;
    if (!municipios[uf]) municipios[uf] = {};
    // Dois nomes do TSE no mesmo município do IBGE: os totais SOMAM (os votos
    // do deputado também somam, logo a fatia continua certa).
    const prev = municipios[uf]['m' + id];
    municipios[uf]['m' + id] = prev ? { n: prev.n, t: prev.t + m.t } : { n: m.n, t: m.t };
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
    for (const k of ['nomeCivil', 'numero', 'situacao']) if (d[k]) deputados[id][k] = d[k];
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
 * Agrega as emendas (registros crus do Portal, consultados com ?ano=X) por
 * destino. `resolverMun(nome, uf)` devolve o id IBGE ou null.
 * Valor = PAGO NO ANO (valorPago) + RESTOS A PAGAR PAGOS depois (valorRestoPago):
 * boa parte das emendas é paga como resto a pagar, e só o valorPago subestimava
 * os anos anteriores. `autor` (opcional): só entram registros desse autor — o
 * filtro nomeAutor do Portal não é conferido do lado de lá.
 * empenhado = valorEmpenhado (o que já foi empenhado das emendas do ano).
 * Devolve { total, pagoNoAno, restoPago, empenhado, municipais: { mID: valor },
 *   nomesMun: { mID: "NOME - UF" }, outros: { rotulo: valor }, n, deOutroAutor }.
 */
function lmnAgregarEmendas(registros, resolverMun, autor) {
  const out = { total: 0, pagoNoAno: 0, restoPago: 0, empenhado: 0, municipais: {}, nomesMun: {}, outros: {}, n: 0, deOutroAutor: 0 };
  const alvo = autor ? lmnNomeAutor(autor) : '';
  for (const e of registros || []) {
    if (alvo && e.nomeAutor && lmnNomeAutor(e.nomeAutor) !== alvo) { out.deOutroAutor++; continue; }
    const noAno = lmnDinheiro(e.valorPago);
    const resto = lmnDinheiro(e.valorRestoPago);
    const pago = noAno + resto;
    out.n++;
    out.empenhado += lmnDinheiro(e.valorEmpenhado);
    if (!pago) continue;
    out.total += pago; out.pagoNoAno += noAno; out.restoPago += resto;
    const loc = lmnLocalidade(e.localidadeDoGasto);
    const id = loc.tipo === 'municipio' ? resolverMun(loc.nome, loc.uf) : null;
    if (id) {
      out.municipais['m' + id] = (out.municipais['m' + id] || 0) + pago;
      out.nomesMun['m' + id] = `${loc.nome} - ${loc.uf}`;
    } else {
      const rot = lmnChave(loc.tipo === 'municipio' ? `${loc.nome} - ${loc.uf}` : loc.tipo === 'uf' ? `${loc.nome} (UF)` : loc.rotulo);
      out.outros[rot] = (out.outros[rot] || 0) + pago;
    }
  }
  return out;
}

/**
 * A gravação de uma eleição processada, numa ÚNICA atualização multi-caminho
 * (PATCH em /labs/mapa/{ano}): deputados, totais dos estados lidos e a
 * situação vão juntos ou não vão — antes eram gravações em sequência, e uma
 * falha no meio deixava votos novos ao lado de totais antigos.
 * Deputado/estado não lido fica como estava.
 */
function lmnAtualizacao(reg, res, metaAntiga, origem, agora = new Date()) {
  const upd = {};
  for (const [id, d] of Object.entries(reg.deputados)) upd['deputados/' + lmnChave(id)] = d;
  for (const [uf, m] of Object.entries(reg.municipios)) upd['municipios/' + uf] = m;
  for (const [uf, m] of Object.entries(reg.municipiosAnterior || {})) upd['anterior/municipios/' + uf] = m;
  const ufs = [...new Set([...((metaAntiga && metaAntiga.ufs) || []), ...res.ufs])].sort();
  upd.meta = { atualizadoEm: agora.toISOString(), origem, ufs, naoEncontrados: res.naoEncontrados.length, semPar: reg.semPar.length };
  return upd;
}

/**
 * "DELEGADO BRUNO LIMA" → "Delegado Bruno Lima" (de/da/do/dos/das/e em
 * minúsculas; siglas curtas sem vogal, como "MC", ficam). Para exibir o nome
 * de urna dos eleitos, que o TSE grava em maiúsculas.
 */
function lmnNomeProprio(s) {
  return String(s || '').toLowerCase().split(/(\s+)/).map((p, i) => {
    if (/^\s+$/.test(p) || !p) return p;
    if (i && /^(de|da|do|dos|das|e)$/.test(p)) return p;
    if (!/[aeiouáéíóúâêôãõ]/.test(p) && !/\./.test(p)) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join('');
}

/** Alvos para procurar os eleitos de uma eleição na ANTERIOR: mesmo nome civil (ou nome de urna único) na mesma UF, qualquer partido. */
function lmnAlvosAnterior(deputados) {
  return Object.entries(deputados || {}).map(([id, d]) => ({ id, nome: d.nomeUrna || d.nome, nomeCivil: d.nomeCivil || '', uf: d.uf }));
}

/**
 * Junta a eleição anterior (registro já no código IBGE, de lmnParaIbge) a cada
 * deputado da atual, em `anterior` — quem não concorreu a deputado federal na
 * mesma UF fica sem o campo. Muda `reg` e o devolve.
 */
function lmnAnexarAnterior(reg, regAnterior, ano) {
  for (const [id, d] of Object.entries(reg.deputados || {})) {
    const a = regAnterior && regAnterior.deputados && regAnterior.deputados[id];
    if (!a) continue;
    d.anterior = { ano: String(ano), total: a.total, partido: a.partidoEleicao || '', nomeUrna: a.nomeUrna || '', situacao: a.situacao || '', foraDoMapa: a.foraDoMapa || 0, municipios: a.municipios || {} };
  }
  // Totais de votos válidos por município na anterior: a fatia de cada deputado
  // nas duas eleições (Emendas × votos) mede a variação sem o efeito do comparecimento.
  if (regAnterior && regAnterior.municipios) reg.municipiosAnterior = regAnterior.municipios;
  return reg;
}

/**
 * Ganho/perda de votos por município entre a anterior e a atual:
 * [{ k, antes, agora, d }] com d = agora − antes, do maior ganho à maior perda.
 */
function lmnVariacao(atual, anterior) {
  const ks = new Set([...Object.keys(atual || {}), ...Object.keys(anterior || {})]);
  return [...ks].map(k => { const a = (anterior || {})[k] || 0, b = (atual || {})[k] || 0; return { k, antes: a, agora: b, d: b - a }; })
    .filter(x => x.d).sort((x, y) => y.d - x.d);
}

/** Nome como o Portal guarda (maiúsculas, sem acento) — o filtro nomeAutor exige. */
function lmnNomeAutor(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------
// Destino das emendas pelo FAVORECIDO.
// A API do Portal devolve a maior parte das emendas com a localidade
// "MÚLTIPLO" (ou só a UF): o município não vem. O arquivo de dados abertos
// "Emendas parlamentares" do Portal (um zip de ~32 MB) traz, em
// EmendasParlamentares_PorFavorecido.csv, cada pagamento com quem o recebeu
// (prefeitura, fundo municipal de saúde, entidade) e o município dele.
// ------------------------------------------------------------

/** Rótulo do município do favorecido: "NOME - UF" (pessoa física e afins vêm sem município). */
function lmnRotuloFavorecido(mun, uf) {
  const m = String(mun || '').trim(), u = String(uf || '').trim().toUpperCase();
  if (m && /^[A-Z]{2}$/.test(u)) return `${m} - ${u}`;
  return u && /^[A-Z]{2}$/.test(u) ? `FAVORECIDO SEM MUNICÍPIO (${u})` : 'FAVORECIDO SEM MUNICÍPIO';
}

/**
 * Leitor dos dois CSVs do zip do Portal, nesta ordem:
 *   emendas.linha(l)      ← EmendasParlamentares.csv (código → autor, ano, localidade)
 *   favorecidos.linha(l)  ← EmendasParlamentares_PorFavorecido.csv
 * Só entram as emendas SEM município (MÚLTIPLO, UF, nacional…) dos `autores`
 * pedidos (nome parlamentar, qualquer grafia), nos `anos` pedidos (ano da emenda).
 * resultado(): { [chaveAutor]: { [ano]: { total, n, mun: { [chave "NOME - UF"]: valor } } } }
 * — chaves já seguras para o banco (lmnChave).
 * pagamentos(): { [chaveAutor]: { [ano]: valor } } — TUDO o que o autor teve pago
 * DENTRO de cada ano (coluna Ano/Mês), de emendas de qualquer ano (restos incluídos).
 * legislaturas (opcional): { [eleição]: ['AAAAMM', 'AAAAMM'] } — período de pagamento
 * (inclusive) de cada eleição, p.ex. { 2026: ['202302', '202610'] }: do início do
 * mandato até o mês da eleição. legislatura(): { [eleição]: { [chaveAutor]:
 * { [chave "NOME - UF"]: valor } } } — tudo o que foi pago por município do
 * favorecido no período, de qualquer emenda do autor (com ou sem município na API).
 */
function lmnLeitorFavorecidos(autores, anos, legislaturas) {
  const quero = new Set((autores || []).map(lmnNomeAutor).filter(Boolean));
  const queroAno = new Set((anos || []).map(String));
  const cods = new Map();
  const out = {}, pg = {}, leg = {};
  const periodos = Object.entries(legislaturas || {});
  const leitor = (arquivo, exigidos, fn) => {
    let ix = null;
    return linha => {
      const c = lmnCampos(linha);
      if (!ix) {
        ix = {};
        c.forEach((h, i) => { ix[lmnNomeAutor(h.replace(/^﻿/, ''))] = i; });
        const falta = exigidos.filter(h => !(h in ix));
        if (falta.length) throw new Error(`Faltam colunas em ${arquivo}: ${falta.join(', ')}`);
        return;
      }
      fn(k => c[ix[k]] == null ? '' : c[ix[k]]);
    };
  };
  const emendas = leitor('EmendasParlamentares.csv', ['CODIGO DA EMENDA', 'ANO DA EMENDA', 'NOME DO AUTOR DA EMENDA', 'LOCALIDADE DE APLICACAO DO RECURSO'], v => {
    const ano = v('ANO DA EMENDA').trim(), autor = lmnNomeAutor(v('NOME DO AUTOR DA EMENDA')), cod = v('CODIGO DA EMENDA').trim();
    if (!queroAno.has(ano) || !quero.has(autor) || !/^\d+$/.test(cod)) return;
    if (lmnLocalidade(v('LOCALIDADE DE APLICACAO DO RECURSO')).tipo === 'municipio') return;
    cods.set(cod, { a: lmnChave(autor), ano });
  });
  const favorecidos = leitor('EmendasParlamentares_PorFavorecido.csv', ['CODIGO DA EMENDA', 'NOME DO AUTOR DA EMENDA', 'ANO/MES', 'UF FAVORECIDO', 'MUNICIPIO FAVORECIDO', 'VALOR RECEBIDO'], v => {
    const valor = lmnDinheiro(v('VALOR RECEBIDO'));
    if (!valor) return;
    const autor = lmnNomeAutor(v('NOME DO AUTOR DA EMENDA')), anoPg = v('ANO/MES').trim().slice(0, 4);
    if (quero.has(autor) && queroAno.has(anoPg)) {
      const a = lmnChave(autor);
      (pg[a] = pg[a] || {})[anoPg] = (pg[a][anoPg] || 0) + valor;
    }
    if (periodos.length && quero.has(autor)) {
      const am = v('ANO/MES').trim(), a = lmnChave(autor);
      for (const [el, [ini, fim]] of periodos) {
        if (am < ini || am > fim) continue;
        const g = ((leg[el] = leg[el] || {})[a] = leg[el][a] || {});
        const k = lmnChave(lmnRotuloFavorecido(v('MUNICIPIO FAVORECIDO'), v('UF FAVORECIDO')));
        g[k] = (g[k] || 0) + valor;
      }
    }
    const e = cods.get(v('CODIGO DA EMENDA').trim());
    if (!e) return;
    const g = ((out[e.a] = out[e.a] || {})[e.ano] = out[e.a][e.ano] || { total: 0, n: 0, mun: {} });
    const k = lmnChave(lmnRotuloFavorecido(v('MUNICIPIO FAVORECIDO'), v('UF FAVORECIDO')));
    g.mun[k] = (g.mun[k] || 0) + valor;
    g.total += valor; g.n++;
  });
  return { emendas: { linha: emendas }, favorecidos: { linha: favorecidos }, emendasSemMunicipio: () => cods.size, resultado: () => out, pagamentos: () => pg, legislatura: () => leg };
}

/**
 * Leva para os municípios, pelo favorecido, o valor que o agregado das emendas
 * (lmnAgregarEmendas) deixou "sem município". `fav` = { total, mun } do autor
 * no ano (lmnLeitorFavorecidos). O arquivo do Portal sai uma vez por mês e a
 * API é diária: os valores do favorecido são ajustados à soma "sem município"
 * do agregado (iguais quando as duas fontes estão em dia) — se o arquivo cobre
 * menos, o resto fica como estava.
 * Devolve um novo agregado com municipais/nomesMun/outros atualizados e
 * viaFavorecido (valor localizado), favMun ({ mID: valor } localizado assim).
 */
function lmnRedistribuir(ag, fav, resolverMun) {
  if (!ag || !fav || !(fav.total > 0) || !fav.mun) return ag;
  const sem = Object.values(ag.outros || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  if (!(sem > 0)) return ag;
  const usado = Math.min(sem, fav.total), k = usado / fav.total, resta = (sem - usado) / sem;
  const out = Object.assign({}, ag, { municipais: Object.assign({}, ag.municipais), nomesMun: Object.assign({}, ag.nomesMun), outros: {}, viaFavorecido: 0, favMun: {} });
  if (resta > 0) for (const [r, v] of Object.entries(ag.outros)) if (v * resta >= 0.01) out.outros[r] = v * resta;
  for (const [nome, v0] of Object.entries(fav.mun)) {
    const v = v0 * k;
    if (!(v > 0)) continue;
    const loc = lmnLocalidade(nome);
    const id = loc.tipo === 'municipio' ? resolverMun(loc.nome, loc.uf) : null;
    if (id) {
      const m = 'm' + id;
      out.municipais[m] = (out.municipais[m] || 0) + v;
      if (!out.nomesMun[m]) out.nomesMun[m] = nome;
      out.favMun[m] = (out.favMun[m] || 0) + v;
      out.viaFavorecido += v;
    } else {
      out.outros[nome] = (out.outros[nome] || 0) + v;
    }
  }
  return out;
}

// ============================================================
// Exportação para Node (bot). Na extensão, este bloco é inerte.
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LMN_ANOS, LMN_ANTERIOR, lmnBancadaDoArquivo, lmnNomeProprio, lmnAlvosAnterior, lmnAnexarAnterior, lmnVariacao, lmnNorm, lmnCampos, lmnLinhas, lmnAgregador, lmnResolvedor, lmnParaIbge, lmnLocalidade, lmnDinheiro, lmnChave, lmnAgregarEmendas, lmnNomeAutor, lmnDistancia, lmnAtualizacao, lmnRotuloFavorecido, lmnLeitorFavorecidos, lmnRedistribuir, LMN_APELIDOS };
}
