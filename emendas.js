/* ============================================================
   EMENDAS DO FUNDO NACIONAL DE SAÚDE
   Monitora as propostas de emenda parlamentar à saúde (individuais, de
   bancada e de comissão) da bancada do Podemos: quanto foi proposto,
   empenhado e efetivamente PAGO, por deputado, estado e município.

   FONTE — a planilha oficial do portal do FNS:
     POST /recursos/proposta/planilha   {sgUf, ano}  → XLSX
   MEDIDO em 19/08/2026: a planilha traz PARTIDO e APELIDO do parlamentar
   em cada linha, além de valores e situação. É isso que torna o módulo
   viável no navegador: UMA requisição por UF (27 no total, ~8 a 35s cada)
   no lugar de abrir o detalhe de cada uma das ~40 mil propostas do ano.
   Sem o tpEmenda no corpo, a planilha vem com TODOS os tipos de emenda.

   O detalhe fino de uma proposta (as 12 etapas do fluxo e os pagamentos
   com nº da ordem bancária) continua vindo por chamada sob demanda,
   quando o analista abre a linha:
     GET /recursos/proposta/obter-proposta?nuProposta=
     GET /recursos/proposta/obter-proposta-etapa?nuProposta=

   O que vai para o Firebase é SÓ o recorte do partido (poucos KB por UF),
   nunca a base inteira do FNS.
   ============================================================ */
'use strict';

const FNS_BASE     = 'https://consultafns.saude.gov.br';
const FIREBASE_URL = 'https://plenario-podemos-default-rtdb.firebaseio.com';
const SIGLA_PODEMOS = 'PODE';

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
             'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

// A planilha do FNS é pesada e o servidor oscila: SP levou 34s e o Acre 8s
// na medição de 19/08/2026. Teto generoso e repetição — um timeout isolado
// não é a fonte fora do ar (lição da janela de 504 da Câmara).
// MEDIDO em 19/08/2026, 13h: com o portal degradado, um pedido SOZINHO para
// Goiás não devolveu byte nenhum em 200s (de manhã, o mesmo tipo de pedido
// levava de 8s a 34s). Teto alto o bastante para o dia ruim, com POUCAS
// tentativas na passagem principal — a repescagem no fim, sem concorrência,
// é a chance boa; insistir 3x no meio da varredura só empilha espera.
const TIMEOUT_PLANILHA_MS = 240000;
const TENTATIVAS_PLANILHA = 2;
const TIMEOUT_DETALHE_MS  = 30000;
const BACKOFF_MS = [0, 2000, 6000];
// MEDIDO em 19/08/2026: um pedido sozinho levou de 8s (AC) a 34s (SP), mas
// TRÊS ao mesmo tempo não terminaram em 120s — o portal não ganha nada com
// paralelismo alto e parece enfileirar. Dois é o meio-termo: aproveita a
// espera de rede sem empurrar o servidor para o atraso.
const SIMULTANEAS = 2;
const GAP_MS = 400;         // respiro entre requisições

const state = {
  ano: String(new Date().getFullYear()),
  itens: [],              // linhas do Podemos do exercício carregado
  meta: {},               // { uf: { em, n } }
  aba: 'propostas',
  log: null,              // relatório da última coleta desta sessão
  emVoo: new Map(),       // uf → instante em que a requisição saiu (para o painel vivo)
  emendas: [],            // panorama (Portal da Transparência), do exercício carregado
  bancada: [],            // quem foi consultado, com situação e casa
  metaTr: null,           // { em, parlamentares, falhas } da última consulta do panorama
  ordem: { col: 'pago', desc: true },
  varredura: null,        // AbortController enquanto busca
};

// ============================================================
//  REDE
// ============================================================
async function fetchComTimeout(url, init = {}, ms = TIMEOUT_DETALHE_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const externo = init.sinalExtra;
  const cascata = () => ctrl.abort();
  if (externo) {
    if (externo.aborted) { clearTimeout(timer); throw new DOMException('Aborted', 'AbortError'); }
    externo.addEventListener('abort', cascata, { once: true });
  }
  const { sinalExtra, ...resto } = init;
  try {
    return await fetch(url, { ...resto, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError' && !externo?.aborted) {
      throw new Error(`o portal do FNS não respondeu em ${Math.round(ms / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externo) externo.removeEventListener('abort', cascata);
  }
}

let _proximoGet = 0;
async function respiro() {
  const agora = Date.now();
  const quando = Math.max(agora, _proximoGet);
  _proximoGet = quando + GAP_MS;
  if (quando > agora) await new Promise(r => setTimeout(r, quando - agora));
}

/** Baixa a planilha oficial de uma UF. Repete em falha de rede e 5xx.
 *  Devolve { buffer, tentativas, status, ms } — as métricas alimentam o log
 *  da coleta, que é o que permite diagnosticar do navegador do analista. */
async function baixarPlanilhaUf(uf, ano, sinal) {
  let erro = null;
  const t0 = Date.now();
  for (let i = 0; i < TENTATIVAS_PLANILHA; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
    if (sinal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await respiro();
    let res;
    try {
      res = await fetchComTimeout(`${FNS_BASE}/recursos/proposta/planilha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sgUf: uf, ano: String(ano) }),
        sinalExtra: sinal,
      }, TIMEOUT_PLANILHA_MS);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      erro = e; continue;
    }
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      return { buffer, tentativas: i + 1, status: res.status, ms: Date.now() - t0 };
    }
    if (res.status === 429 || res.status >= 500) {
      erro = new Error(`o FNS respondeu HTTP ${res.status} para ${uf}`);
      erro.status = res.status;
      continue;
    }
    const eFatal = new Error(`HTTP ${res.status} ao pedir a planilha de ${uf}`);
    eFatal.status = res.status;
    eFatal.tentativas = i + 1;
    eFatal.ms = Date.now() - t0;
    throw eFatal;
  }
  const eFim = erro || new Error(`falha ao baixar a planilha de ${uf}`);
  eFim.tentativas = TENTATIVAS_PLANILHA;
  eFim.ms = Date.now() - t0;
  throw eFim;
}

// ============================================================
//  PLANILHA → LINHAS
// ============================================================
// Cabeçalhos da planilha do FNS (medidos em 19/08/2026). O casamento é por
// texto NORMALIZADO (sem acento, sem pontuação) porque a origem escreve
// "Nº Proposta", "MUNICÍPIO", "SITUAÇÃO PROPOSTA" com acentuação variável.
const COLUNAS = {
  'no proposta': 'nuProposta', 'uf': 'uf', 'municipio': 'municipio',
  'entidade': 'entidade', 'cnpj': 'cnpj', 'no processo': 'processo',
  'ano': 'ano', 'no portaria': 'portaria', 'data portaria': 'dataPortaria',
  'tipo': 'tipo', 'valor proposta': 'proposto', 'valor empenho': 'empenhado',
  'valor pago': 'pago', 'localizacao': 'localizacao', 'tipo recurso': 'tipoRecurso',
  'no processo pagamento': 'processoPagamento', 'situacao interna': 'situacaoInterna',
  'localizacao pagamento': 'localizacaoPagamento', 'partido': 'partido',
  'apelido': 'apelido', 'valor ind objeto': 'valorObjeto', 'situacao proposta': 'situacao',
};

function normalizarCabecalho(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/º|°/g, 'o').replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** "R$ 339.502,00" | 339502 | "" → número. */
function dinheiro(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[R$\s.]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// O nº da proposta tem 17 dígitos e ESTOURA a precisão de número inteiro do
// JavaScript (2^53 ≈ 9,007 quatrilhões — 16 dígitos). Hoje o FNS grava a
// coluna como TEXTO (verificado nas planilhas de AC, SP e TO em 19/08/2026),
// então o valor chega inteiro; se um dia vier como número, os últimos dígitos
// já teriam sido arredondados ANTES de chegar aqui — não dá para recuperar,
// mas dá para gritar em vez de exibir um número silenciosamente errado.
let _avisouPrecisao = false;
function numeroDaProposta(v, uf) {
  if (typeof v === 'number') {
    if (!_avisouPrecisao) {
      _avisouPrecisao = true;
      console.warn(`[emendas] ATENÇÃO: a planilha de ${uf} trouxe o nº da proposta como NÚMERO, ` +
        'não como texto. Acima de 16 dígitos o JavaScript arredonda, então os números podem estar ' +
        'errados nos últimos dígitos. Confira uma proposta no site do FNS antes de usar a lista.');
    }
    return v.toFixed(0);
  }
  return String(v ?? '').trim();
}

/** Lê o XLSX e devolve SÓ as linhas do Podemos, já normalizadas. */
function lerPlanilhaPodemos(buffer, uf, ano) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const aba = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(aba, { header: 1, defval: '' });
  if (!linhas.length) return [];

  const cab = linhas[0].map(h => COLUNAS[normalizarCabecalho(h)] || null);
  // A coluna do partido é o que dá sentido ao módulo: sem ela, a planilha
  // mudou de formato e é melhor gritar do que devolver lista vazia em silêncio.
  if (!cab.includes('partido')) {
    throw new Error(`a planilha de ${uf} veio sem a coluna PARTIDO — o formato do FNS mudou`);
  }

  const out = [];
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const obj = {};
    for (let c = 0; c < cab.length; c++) if (cab[c]) obj[cab[c]] = linha[c];
    if (String(obj.partido || '').trim().toUpperCase() !== SIGLA_PODEMOS) continue;

    out.push({
      nuProposta: numeroDaProposta(obj.nuProposta, uf),
      uf: String(obj.uf || uf).trim(),
      municipio: String(obj.municipio || '').trim(),
      entidade: String(obj.entidade || '').trim(),
      cnpj: String(obj.cnpj || '').trim(),
      ano: String(obj.ano || ano).trim(),
      portaria: String(obj.portaria || '').trim(),
      dataPortaria: String(obj.dataPortaria || '').trim(),
      tipo: String(obj.tipo || '').trim(),
      tipoRecurso: String(obj.tipoRecurso || '').trim(),
      deputado: String(obj.apelido || '').trim(),
      proposto: dinheiro(obj.proposto),
      empenhado: dinheiro(obj.empenhado),
      pago: dinheiro(obj.pago),
      valorObjeto: dinheiro(obj.valorObjeto),
      situacao: String(obj.situacao || '').trim(),
      localizacaoPagamento: String(obj.localizacaoPagamento || '').trim(),
    });
  }
  return out;
}

// A situação vem como frase ("Proposta Empenhada aguardando Formalizacao").
// Classificamos em cinco estados para o badge e o filtro — a frase original
// continua visível no detalhe, então a classificação nunca esconde o texto.
function etapaDe(item) {
  const s = String(item.situacao || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // "Pagamento" CONTÉM "paga": a ordem aqui não é estética. Testar "paga"
  // primeiro classificava "Proposta em Pagamento" como já paga — dinheiro que
  // ainda não saiu apareceria como pago no painel da Liderança.
  if (/pagamento/.test(s))                  return { chave: 'empago',  rotulo: 'Em pagamento',  classe: 'em-badge--empago' };
  if (/\bpaga\b/.test(s))                  return { chave: 'pago',    rotulo: 'Paga',          classe: 'em-badge--pago' };
  if (/formaliza/.test(s))                  return { chave: 'formal',  rotulo: 'Formalização',  classe: 'em-badge--formal' };
  if (/empenh/.test(s))                     return { chave: 'empenho', rotulo: 'Empenho',       classe: 'em-badge--empenho' };
  return { chave: 'neutro', rotulo: item.situacao || 'Em análise', classe: 'em-badge--neutro' };
}

// ============================================================
//  VARREDURA (as 27 UFs)
// ============================================================
async function buscarNoFns(escopo = 'tudo') {
  if (state.varredura) return;
  const ano = state.ano;

  // ESCOPO da coleta. O FNS não tem consulta "o que mudou desde ontem": a
  // menor unidade que ele entrega é a planilha inteira de uma UF. Então o
  // incremental possível é por ESTADO — depois da primeira varredura sabemos
  // em quais UFs a bancada tem proposta, e atualizar só essas custa uma fração
  // do tempo. A varredura completa continua existindo para achar UF nova.
  const comBancada = Object.keys(state.meta).filter(uf => (state.meta[uf].n || 0) > 0);
  const faltantes = ufsFaltantes();
  const ufs = escopo === 'faltantes' ? (faltantes.length ? faltantes : UFS)
            : escopo === 'bancada'   ? (comBancada.length ? comBancada : UFS)
            : UFS;

  const ctrl = new AbortController();
  state.varredura = ctrl;
  document.getElementById('btn-buscar').disabled = true;
  document.getElementById('btn-atualizar').disabled = true;
  document.getElementById('btn-faltantes').disabled = true;
  document.getElementById('em-vazio').style.display = 'none';
  document.getElementById('em-progresso').style.display = '';
  // O log fica disponível JÁ, não só no fim: coleta que parece travada é
  // exatamente quando o analista precisa dele (13/08/2026 — o botão só
  // aparecia depois que a varredura terminava, quando já não servia).
  document.getElementById('btn-log').style.display = '';

  // Retrato do que havia ANTES, para dizer o que mudou (é disto que vive um
  // módulo de monitoramento: proposta que virou paga, valor que subiu).
  const antes = new Map(state.itens.map(i => [`${i.nuProposta}|${i.deputado}`, i]));

  state.log = {
    inicio: new Date().toISOString(),
    ano, escopo, ufs: ufs.length,
    versao: (chrome.runtime?.getManifest?.().version || '?'),
    linhas: [],
  };
  const encontrados = [];
  const falhas = [];
  let prontas = 0;

  let ultimoPronto = '';
  const pintar = (uf) => {
    if (uf) ultimoPronto = uf;
    const pct = Math.round((prontas / ufs.length) * 100);
    document.getElementById('em-barra-fill').style.width = pct + '%';
    document.getElementById('em-prog-txt').textContent =
      `Consultando o FNS — ${prontas} de ${ufs.length} estados (${pct}%)`;
    // A barra só anda quando um estado TERMINA, e um estado leva de 8 a 35s.
    // Sem mostrar quem está em voo e há quanto tempo, uma coleta lenta é
    // indistinguível de uma travada — foi o que aconteceu em 13/08/2026.
    const voando = [...state.emVoo.entries()]
      .map(([u, t]) => `${u} ${Math.round((Date.now() - t) / 1000)}s`).join(' · ');
    document.getElementById('em-prog-sub').textContent =
      (voando ? `Em andamento: ${voando}` : 'Aguardando…') +
      ` · ${encontrados.length} proposta(s) do Podemos${ultimoPronto ? ` · último pronto: ${ultimoPronto}` : ''}` +
      (falhas.length ? ` · ${falhas.length} com falha` : '');
  };
  pintar('');
  const relogio = setInterval(() => pintar(''), 1000);

  const rodarFila = async (lista, simultaneas) => {
    const fila = lista.slice();
    const trabalhador = async () => {
    while (fila.length) {
      if (ctrl.signal.aborted) return;
      const uf = fila.shift();
      const reg = { uf };
      const t0 = Date.now();
      state.emVoo.set(uf, t0);
      console.log(`[emendas] → ${uf} pedido enviado ao FNS`);
      try {
        const { buffer, tentativas, status, ms } = await baixarPlanilhaUf(uf, ano, ctrl.signal);
        Object.assign(reg, { status, tentativas, msDownload: ms, bytes: buffer.byteLength });
        const itens = lerPlanilhaPodemos(buffer, uf, ano);
        reg.podemos = itens.length;
        encontrados.push(...itens);
        // Grava por UF assim que fica pronta: uma busca interrompida no meio
        // não joga fora o que já foi lido. Falha de GRAVAÇÃO conta como falha
        // do estado — antes era engolida, e como a tela recarregava do banco,
        // a UF sumia da base sem ninguém saber.
        try {
          await fbSalvarUf(ano, uf, itens);
          reg.salvo = true;
        } catch (eSalvar) {
          reg.salvo = false;
          reg.erro = `lido do FNS, mas NÃO salvo no Firebase: ${eSalvar.message}`;
          falhas.push(`${uf}: ${reg.erro}`);
        }
      } catch (e) {
        if (e.name === 'AbortError') { reg.erro = 'cancelado'; state.log.linhas.push(reg); return; }
        // "Array buffer allocation failed" NÃO é falha da fonte: é a aba sem
        // memória para segurar duas planilhas grandes ao mesmo tempo (visto em
        // 19/08/2026 com AL). Dizer isso muda a conduta de quem lê o log.
        reg.erro = /allocation failed|out of memory/i.test(e.message)
          ? `sem memória na aba para abrir a planilha (${e.message}) — repita este estado sozinho`
          : e.message;
        reg.status = e.status;
        reg.tentativas = e.tentativas;
        reg.msDownload = e.ms;
        falhas.push(`${uf}: ${e.message}`);
      } finally {
        state.emVoo.delete(uf);
        reg.ms = Date.now() - t0;
        state.log.linhas.push(reg);
        console.log('[emendas] ' + linhaDoLog(reg));
        prontas++;
        pintar(uf);
      }
    }
    };
    await Promise.all(Array.from({ length: simultaneas }, trabalhador));
  };

  await rodarFila(ufs, SIMULTANEAS);

  // REPESCAGEM — as tentativas dentro do download (até 3, com espera) cobrem a
  // oscilação de segundos; não cobrem o portal ficando pesado durante a
  // varredura. Quem falhou volta para uma última rodada, agora UM DE CADA VEZ
  // e sem concorrência nenhuma, que é a condição em que o FNS responde melhor.
  const paraRepescar = state.log.linhas.filter(r => r.erro && r.erro !== 'cancelado').map(r => r.uf);
  if (paraRepescar.length && !ctrl.signal.aborted) {
    console.log(`[emendas] repescagem de ${paraRepescar.length} estado(s): ${paraRepescar.join(', ')}`);
    document.getElementById('em-prog-txt').textContent =
      `Tentando de novo ${paraRepescar.length} estado(s) que falharam: ${paraRepescar.join(', ')}`;
    state.log.repescagem = paraRepescar.slice();
    // Tira do log as linhas com erro: a repescagem escreve o desfecho final.
    state.log.linhas = state.log.linhas.filter(r => !paraRepescar.includes(r.uf));
    for (let i = falhas.length - 1; i >= 0; i--) {
      if (paraRepescar.includes(falhas[i].split(':')[0])) falhas.splice(i, 1);
    }
    prontas -= paraRepescar.length;
    await rodarFila(paraRepescar, 1);
  }

  clearInterval(relogio);
  state.emVoo.clear();
  state.varredura = null;
  state.log.fim = new Date().toISOString();
  state.log.falhas = falhas.length;
  state.log.propostas = encontrados.length;
  document.getElementById('btn-buscar').disabled = false;
  document.getElementById('btn-atualizar').disabled = false;
  document.getElementById('btn-faltantes').disabled = false;
  document.getElementById('em-progresso').style.display = 'none';
  document.getElementById('btn-log').style.display = '';

  // A tela passa a valer o que FOI LIDO nesta rodada, não o que o banco
  // devolve: assim uma UF que falhou ao salvar continua visível (e declarada),
  // em vez de desaparecer no recarregamento.
  const naoTocadas = state.itens.filter(i => !ufs.includes(i.uf));
  state.itens = naoTocadas.concat(encontrados);
  for (const reg of state.log.linhas) {
    if (reg.podemos !== undefined) state.meta[reg.uf] = { em: new Date().toISOString(), n: reg.podemos, salvo: reg.salvo };
  }
  const mudancas = compararComAnterior(antes, encontrados);
  state.log.mudancas = mudancas;
  renderTudo();

  if (ctrl.signal.aborted) {
    mostrarToast('Busca cancelada — o que já foi lido está salvo.', 'aviso');
  } else if (falhas.length) {
    // Falha DECLARADA: dizer quais estados ficaram de fora é melhor que
    // apresentar um total incompleto como se fosse a base inteira.
    mostrarToast(`${encontrados.length} propostas · ${falhas.length} estado(s) com problema: ${falhas.map(f => f.split(':')[0]).join(', ')} — veja o log da coleta`, 'aviso');
    console.warn('[emendas] estados com falha:\n' + falhas.join('\n'));
  } else {
    mostrarToast(`✓ ${encontrados.length} propostas em ${ufs.length} estado(s)${resumoMudancas(mudancas)}`, 'sucesso');
  }
}

/** O que mudou nesta coleta em relação ao retrato anterior. */
function compararComAnterior(antes, agora) {
  const novas = [], pagas = [], subiu = [];
  if (!antes.size) return { novas, pagas, subiu, primeira: true };
  for (const it of agora) {
    const ant = antes.get(`${it.nuProposta}|${it.deputado}`);
    if (!ant) { novas.push(it); continue; }
    if (etapaDe(ant).chave !== 'pago' && etapaDe(it).chave === 'pago') pagas.push(it);
    else if (it.pago > ant.pago) subiu.push({ ...it, antes: ant.pago });
  }
  return { novas, pagas, subiu, primeira: false };
}

function resumoMudancas(m) {
  if (!m || m.primeira) return '';
  const p = [];
  if (m.novas.length) p.push(`${m.novas.length} nova(s)`);
  if (m.pagas.length) p.push(`${m.pagas.length} passou(aram) a paga`);
  if (m.subiu.length) p.push(`${m.subiu.length} com pagamento novo`);
  return p.length ? ` · ${p.join(', ')}` : ' · nada mudou desde a última busca';
}

// ============================================================
//  PANORAMA POR PASTA — Portal da Transparência
//  A segunda fonte do módulo. Enquanto o FNS desce ao município e à ordem
//  bancária (só na saúde), a Transparência dá a LARGURA: todas as pastas
//  (funções orçamentárias), filtrando por AUTOR direto na consulta.
//
//  MEDIDO em 19/08/2026 com a chave da Liderança: cada parlamentar tem de 2 a
//  13 emendas no ano, tudo em UMA página — a bancada inteira sai em ~22
//  requisições, segundos. Renata Abreu, por exemplo: 13 emendas em 9 pastas.
//
//  O VÍNCULO entre as duas fontes é exato: codigoEmenda = ano + código do
//  autor + número (202637460001), e o FNS traz o mesmo par em
//  coEmendaPolitica ("37460001"). Dá para sair de uma emenda de saúde daqui
//  e cair nas propostas municipais dela.
//
//  Limites da fonte, que a tela precisa respeitar:
//   · localidadeDoGasto quase sempre vem "MÚLTIPLO" — município é assunto do FNS;
//   · Transferência Especial ("pix") NÃO gera proposta no FNS: não há para
//     onde descer, e isso é dito em vez de parecer defeito.
// ============================================================
const TRANSP_BASE = 'https://api.portaldatransparencia.gov.br/api-de-dados';
const TRANSP_PAGINA = 15;        // tamanho de página observado na fonte

/** A chave é de cada analista e mora só neste navegador (nunca no Firebase,
 *  que hoje é aberto). Mesmo padrão da chave de IA dos outros módulos. */
function chaveTransparencia() {
  return new Promise(r => chrome.storage.local.get(['transparenciaChave'], o => r(o.transparenciaChave || '')));
}
function salvarChaveTransparencia(chave) {
  return new Promise(r => chrome.storage.local.set({ transparenciaChave: chave }, r));
}

async function fetchTransparencia(caminho, params, chave, sinal) {
  const url = `${TRANSP_BASE}/${caminho}?` + new URLSearchParams(params);
  let erro = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500 * i));
    await respiro();
    let res;
    try {
      res = await fetchComTimeout(url, { headers: { 'chave-api-dados': chave, Accept: 'application/json' }, sinalExtra: sinal }, 30000);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      erro = e; continue;
    }
    if (res.ok) return await res.json();
    if (res.status === 401 || res.status === 403) {
      throw new Error('a chave do Portal da Transparência foi recusada (HTTP ' + res.status + ') — confira em “Chave”');
    }
    if (res.status === 429 || res.status >= 500) { erro = new Error(`Portal da Transparência respondeu HTTP ${res.status}`); continue; }
    throw new Error(`HTTP ${res.status} no Portal da Transparência`);
  }
  throw erro || new Error('falha ao consultar o Portal da Transparência');
}

/** Emendas de um parlamentar num exercício (todas as páginas). */
async function emendasDoParlamentar(nome, ano, chave, sinal) {
  const out = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const lote = await fetchTransparencia('emendas', { ano, nomeAutor: nome, pagina }, chave, sinal);
    if (!Array.isArray(lote)) break;
    out.push(...lote.map(e => normalizarEmenda(e)));
    if (lote.length < TRANSP_PAGINA) break;
  }
  return out;
}

/** codigoEmenda "202637460001" → { ano, autor: '3746', numero: '0001' }.
 *  O par autor+numero é o que casa com coEmendaPolitica do FNS. */
function partesDoCodigo(codigo) {
  const c = String(codigo || '').trim();
  if (!/^\d{12}$/.test(c)) return null;
  return { ano: c.slice(0, 4), autor: c.slice(4, 8), numero: c.slice(8, 12) };
}

function normalizarEmenda(e) {
  const p = partesDoCodigo(e.codigoEmenda);
  return {
    codigo: String(e.codigoEmenda || '').trim(),
    codigoAutor: p?.autor || '',
    numero: String(e.numeroEmenda || '').trim(),
    ano: String(e.ano || '').trim(),
    parlamentar: String(e.nomeAutor || e.autor || '').trim(),
    tipo: String(e.tipoEmenda || '').trim(),
    funcao: String(e.funcao || '(sem função)').trim(),
    subfuncao: String(e.subfuncao || '').trim(),
    localidade: String(e.localidadeDoGasto || '').trim(),
    empenhado: dinheiro(e.valorEmpenhado),
    liquidado: dinheiro(e.valorLiquidado),
    pago: dinheiro(e.valorPago),
    restoInscrito: dinheiro(e.valorRestoInscrito),
    restoPago: dinheiro(e.valorRestoPago),
  };
}

// O Portal às vezes informa PAGO maior que o EMPENHADO — visto em 19/08/2026
// na emenda 202644370009 (Nely Aquino, desporto): empenhado 392.000,
// liquidado 391.984,80 e pago 783.969,60, exatamente o dobro do liquidado.
// Não cabe a nós "consertar" com um teto de 100%: isso esconderia um defeito
// da fonte e faria a Liderança apresentar número que a origem não sustenta.
// Marcamos e explicamos.
function pagoIncoerente(e) {
  return e.empenhado > 0 && e.pago > e.empenhado * 1.001;
}

// CONFERÊNCIA na própria fonte: para a emenda marcada, buscamos os documentos
// de pagamento e o valor de cada um. Foi assim que o caso da Nely Aquino se
// esclareceu em 19/08/2026: a ordem bancária 2026OB000014 vale R$ 391.984,80
// (o mesmo do liquidado), enquanto o endpoint de emendas informa o DOBRO —
// o defeito está na agregação do Portal, não na leitura daqui.
async function conferirEmendaNaFonte(codigo, chave, sinal) {
  const docs = await fetchTransparencia(`emendas/documentos/${encodeURIComponent(codigo)}`, { pagina: 1 }, chave, sinal);
  const pagamentos = (Array.isArray(docs) ? docs : []).filter(d => /pagamento/i.test(d.fase || ''));
  const detalhados = [];
  for (const d of pagamentos) {
    const cod = d.codigoDocumento || d.codigoDocumentoResumido;
    if (!cod) continue;
    const det = await fetchTransparencia(`despesas/documentos/${encodeURIComponent(cod)}`, {}, chave, sinal);
    detalhados.push({
      documento: det.documentoResumido || cod,
      data: det.data || d.data || '',
      favorecido: det.nomeFavorecido || '',
      valor: dinheiro(det.valor),
    });
  }
  return { pagamentos: detalhados, soma: detalhados.reduce((a, v) => a + v.valor, 0) };
}

/** Transferência especial vai direto ao município: não existe proposta no FNS. */
function temPropostaNoFns(emenda) {
  return /finalidade\s+definida/i.test(emenda.tipo) && /sa[úu]de/i.test(emenda.funcao);
}

const API_CAMARA = 'https://dadosabertos.camara.leg.br/api/v2';

/** Nome comparável: sem acento, sem espaço dobrado, em maiúsculas.
 *  O FNS escreve "FABIO MACEDO"; a Câmara, "Fábio Macedo". */
function chaveNome(n) {
  return String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

async function jsonCamara(caminho) {
  const r = await fetchComTimeout(`${API_CAMARA}/${caminho}`, {}, 20000);
  if (!r.ok) throw new Error(`API da Câmara HTTP ${r.status}`);
  return r.json();
}

async function mapLimite(itens, limite, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k]); }
  }));
  return out;
}

/** QUEM É A BANCADA — nunca escrita à mão, e a montagem tem três armadilhas
 *  que só apareceram medindo a API em 19/08/2026:
 *
 *  1. `/deputados?siglaPartido=PODE` devolve só quem está EM EXERCÍCIO: a
 *     presidente do partido, licenciada, ficava de fora da própria bancada.
 *     Por isso a consulta é pela LEGISLATURA (descoberta na API, não fixada
 *     aqui) — aí ela entra.
 *  2. A lista da legislatura traz quem passou pelo partido em algum momento
 *     e REPETE a pessoa em variações de nome ("Samuel Santos" e "Samuel dos
 *     Santos" são o mesmo id). Deduplicamos por id e confirmamos a filiação
 *     ATUAL no detalhe de cada um.
 *  3. Quem tem emenda no FNS mas não é deputado (senadores do partido, como
 *     Jorge Kajuru) continua entrando — a emenda existe —, mas identificado
 *     como tal, para ninguém contá-los como deputados.
 */
async function bancadaDoPodemos() {
  const nomesFns = [...new Set(state.itens.map(i => i.deputado).filter(Boolean))];
  const out = [];
  const vistos = new Set();

  try {
    const leg = (await jsonCamara('legislaturas?ordem=DESC&ordenarPor=id&itens=1')).dados?.[0]?.id;
    const lista = (await jsonCamara(
      `deputados?siglaPartido=${SIGLA_PODEMOS}&idLegislatura=${leg}&ordem=ASC&ordenarPor=nome&itens=100`)).dados || [];
    const ids = [...new Set(lista.map(d => d.id))];

    const detalhes = await mapLimite(ids, 4, async id => {
      try { return (await jsonCamara(`deputados/${id}`)).dados?.ultimoStatus || null; }
      catch (e) { console.warn(`[orçamento] deputado ${id} não veio:`, e.message); return null; }
    });

    for (const u of detalhes) {
      // Só quem está NO PARTIDO hoje. "Vacância / Não Eleito" é quem não
      // assumiu — não é bancada, ainda que a lista da legislatura o traga.
      if (!u || u.siglaPartido !== SIGLA_PODEMOS) continue;
      if (/vac[âa]ncia/i.test(u.situacao || '')) continue;
      const chave = chaveNome(u.nome);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      out.push({ nome: u.nome, chave, situacao: u.situacao || '', casa: 'deputado' });
    }
  } catch (e) {
    console.warn('[orçamento] lista de deputados da Câmara não veio:', e.message);
  }

  // O que o FNS conhece e a Câmara não: senador do partido ou grafia diferente.
  for (const n of nomesFns) {
    const chave = chaveNome(n);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ nome: n, chave, situacao: '', casa: out.length ? 'fora da bancada de deputados' : 'não identificado' });
  }

  return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function buscarPanorama() {
  if (state.varredura) return;
  const chave = await chaveTransparencia();
  if (!chave) { abrirModalChave(); return; }

  const ano = state.ano;
  const ctrl = new AbortController();
  state.varredura = ctrl;
  document.getElementById('btn-panorama').disabled = true;
  document.getElementById('em-vazio').style.display = 'none';
  document.getElementById('em-progresso').style.display = '';

  const bancada = await bancadaDoPodemos();
  // MEDIDO em 19/08/2026: o filtro nomeAutor do Portal é sensível a caixa e a
  // acento — "Renata Abreu" devolve 0 e "RENATA ABREU" devolve 13; "FÁBIO
  // MACEDO" devolve 0 e "FABIO MACEDO" devolve 3. A fonte guarda tudo em
  // maiúsculas e sem acento, que é justamente a chave normalizada. Consultar
  // pelo nome como a Câmara escreve zerava TODOS os deputados em silêncio —
  // sobravam só os nomes vindos do FNS, que já vêm nessa forma.
  const nomes = bancada.map(p => p.chave);
  state.bancada = bancada;
  const achadas = [];
  const falhas = [];
  let prontos = 0;

  const pintar = (nome) => {
    const pct = Math.round((prontos / nomes.length) * 100);
    document.getElementById('em-barra-fill').style.width = pct + '%';
    document.getElementById('em-prog-txt').textContent =
      `Consultando o Portal da Transparência — ${prontos} de ${nomes.length} parlamentares (${pct}%)`;
    document.getElementById('em-prog-sub').textContent =
      `${achadas.length} emenda(s)${nome ? ` · último: ${nome}` : ''}` +
      (falhas.length ? ` · ${falhas.length} com falha` : '');
  };
  pintar('');

  for (const nome of nomes) {
    if (ctrl.signal.aborted) break;
    try {
      achadas.push(...await emendasDoParlamentar(nome, ano, chave, ctrl.signal));
    } catch (e) {
      if (e.name === 'AbortError') break;
      // "Failed to fetch" repetido 42 vezes não diz nada a quem lê. O navegador
      // devolve isso quando o domínio não está no manifest (visto em
      // 19/08/2026: preflight bloqueado por CORS antes de a extensão ser
      // atualizada) — e nesse caso insistir nos outros 41 é desperdício.
      const permissao = /failed to fetch|networkerror/i.test(e.message);
      const msg = permissao
        ? 'o Chrome bloqueou a consulta ao Portal da Transparência — recarregue a extensão em chrome://extensions ' +
          'para valer a permissão nova do domínio (o navegador só a concede ao recarregar)'
        : e.message;
      falhas.push(`${nome}: ${msg}`);
      console.warn(`[orçamento] ${nome} falhou:`, msg);
      if (permissao || /recusada/.test(e.message)) break;   // problema geral: não insiste 42 vezes
    } finally {
      prontos++;
      pintar(nome);
    }
  }

  state.varredura = null;
  document.getElementById('btn-panorama').disabled = false;
  document.getElementById('em-progresso').style.display = 'none';

  state.emendas = achadas;
  state.metaTr = { em: new Date().toISOString(), parlamentares: nomes.length, falhas: falhas.length };
  await fbSalvarPanorama(ano, achadas, state.metaTr).catch(e => {
    falhas.push('Firebase: ' + e.message);
    console.warn('[orçamento] panorama não salvo:', e.message);
  });
  renderTudo();

  // Zero emenda para TODOS os deputados, com resultado para os demais, é a
  // assinatura de nome consultado na forma errada — foi assim que a troca de
  // caixa passou despercebida. Nada falha, e é justamente o problema.
  const deputados = new Set(bancada.filter(p => p.casa === 'deputado').map(p => p.chave));
  const comEmenda = new Set(achadas.map(e => chaveNome(e.parlamentar)));
  const nenhumDeputado = deputados.size > 0 && ![...deputados].some(c => comEmenda.has(c));
  if (nenhumDeputado && achadas.length) {
    falhas.push('nenhum dos deputados retornou emenda, embora outros nomes tenham retornado — ' +
                'verifique a forma do nome consultado no Portal (maiúsculas, sem acento)');
    console.warn('[orçamento] suspeita: 0 emendas para os ' + deputados.size + ' deputados da bancada');
  }

  if (falhas.length) {
    mostrarToast(`${achadas.length} emendas · ${falhas.length} problema(s): ${falhas[0]}`, 'aviso');
    console.warn('[orçamento] falhas no panorama:\n' + falhas.join('\n'));
  } else {
    mostrarToast(`✓ ${achadas.length} emendas de ${nomes.length} parlamentares em ${new Set(achadas.map(e => e.funcao)).size} pastas.`, 'sucesso');
  }
}

/** "27 em exercício · 1 licenciado(a) · 4 suplentes · 8 fora da bancada". */
function composicaoDaBancada(bancada) {
  const conta = { exercicio: 0, licenca: 0, suplencia: 0, outros: 0, forade: 0 };
  for (const p of bancada) {
    if (p.casa !== 'deputado') conta.forade++;
    else if (/exerc/i.test(p.situacao)) conta.exercicio++;
    else if (/licen/i.test(p.situacao)) conta.licenca++;
    else if (/supl/i.test(p.situacao)) conta.suplencia++;
    else conta.outros++;
  }
  const p = [];
  if (conta.exercicio) p.push(`${conta.exercicio} deputado(s) em exercício`);
  if (conta.licenca) p.push(`${conta.licenca} licenciado(s)`);
  if (conta.suplencia) p.push(`${conta.suplencia} na suplência`);
  if (conta.outros) p.push(`${conta.outros} em outra situação`);
  if (conta.forade) p.push(`${conta.forade} fora da bancada de deputados (senadores ou grafia própria do FNS)`);
  return p.join(' · ');
}

async function fbSalvarPanorama(ano, emendas, meta) {
  const r = await fetchComTimeout(`${FIREBASE_URL}/orcamento-transparencia/${ano}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...meta, itens: emendas }),
  }, 25000);
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
}

async function carregarPanorama(ano) {
  try {
    const r = await fetchComTimeout(`${FIREBASE_URL}/orcamento-transparencia/${ano}.json`, {}, 20000);
    const d = r.ok ? await r.json() : null;
    state.emendas = (d && d.itens) || [];
    state.metaTr = d ? { em: d.em, parlamentares: d.parlamentares, falhas: d.falhas } : null;
  } catch (e) {
    console.warn('[orçamento] panorama salvo não pôde ser lido:', e.message);
    state.emendas = []; state.metaTr = null;
  }
}

// ---------- filtros e agregação do panorama ----------
function emendasFiltradas() {
  const parl = document.getElementById('p-parlamentar').value;
  const func = document.getElementById('p-funcao').value;
  const tipo = document.getElementById('p-tipo').value;
  return state.emendas.filter(e =>
    (!parl || e.parlamentar === parl) && (!func || e.funcao === func) && (!tipo || e.tipo === tipo));
}

function somarEmendas(lista) {
  const t = { empenhado: 0, liquidado: 0, pago: 0, restos: 0, n: lista.length };
  for (const e of lista) {
    t.empenhado += e.empenhado; t.liquidado += e.liquidado; t.pago += e.pago;
    t.restos += Math.max(0, e.restoInscrito - e.restoPago);
  }
  return t;
}

/** Matriz parlamentar × pasta. As colunas são as pastas com mais dinheiro
 *  empenhado; o resto some numa coluna "Outras" para a tabela caber. */
function matrizPorPasta(lista, maxColunas = 6) {
  const porFuncao = new Map();
  for (const e of lista) porFuncao.set(e.funcao, (porFuncao.get(e.funcao) || 0) + e.empenhado);
  const principais = [...porFuncao.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColunas).map(x => x[0]);
  const outras = [...porFuncao.keys()].filter(f => !principais.includes(f));

  const linhas = new Map();
  for (const e of lista) {
    if (!linhas.has(e.parlamentar)) linhas.set(e.parlamentar, { parlamentar: e.parlamentar, celulas: {}, total: { empenhado: 0, pago: 0 } });
    const l = linhas.get(e.parlamentar);
    const col = principais.includes(e.funcao) ? e.funcao : 'Outras';
    l.celulas[col] = l.celulas[col] || { empenhado: 0, pago: 0, n: 0 };
    l.celulas[col].empenhado += e.empenhado;
    l.celulas[col].pago += e.pago;
    l.celulas[col].n++;
    l.total.empenhado += e.empenhado;
    l.total.pago += e.pago;
  }
  const colunas = outras.length ? [...principais, 'Outras'] : principais;
  return { colunas, linhas: [...linhas.values()].sort((a, b) => b.total.pago - a.total.pago) };
}

/** Estados que ainda NÃO estão na base — nunca coletados ou que falharam. */
function ufsFaltantes() {
  return UFS.filter(uf => !state.meta[uf] || state.meta[uf].salvo === false);
}

// ============================================================
//  LOG DA COLETA — o relatório que o analista copia e manda
// ============================================================
function linhaDoLog(r) {
  const seg = ms => (ms / 1000).toFixed(1) + 's';
  const kb = b => Math.round(b / 1024) + ' KB';
  if (r.erro) {
    return `✗ ${String(r.uf).padEnd(3)} ${r.erro}` +
           (r.status ? ` · HTTP ${r.status}` : '') +
           (r.tentativas ? ` · ${r.tentativas} tentativa(s)` : '') +
           (r.ms ? ` · ${seg(r.ms)}` : '');
  }
  return `✓ ${String(r.uf).padEnd(3)} ${String(r.podemos).padStart(4)} do PODE · ${kb(r.bytes)} · ${seg(r.msDownload)}` +
         (r.tentativas > 1 ? ` · ${r.tentativas} tentativas` : '') +
         (r.salvo === false ? ' · NÃO SALVO' : '');
}

function relatorioDaColeta() {
  const l = state.log;
  if (!l) return 'Nenhuma coleta nesta sessão.';
  const dur = l.fim ? ((new Date(l.fim) - new Date(l.inicio)) / 1000).toFixed(0) + 's' : 'em andamento';
  const rep = l.repescagem?.length ? ` · repescagem: ${l.repescagem.join(', ')}` : '';
  const cab = [
    `SisPode ${l.versao} · log da coleta de emendas · ${new Date(l.inicio).toLocaleString('pt-BR')}`,
    `Exercício ${l.ano} · escopo: ${l.escopo === 'bancada' ? 'estados com propostas da bancada' : l.escopo === 'faltantes' ? 'estados que faltavam na base' : 'todos os estados'} (${l.ufs} UF) · duração ${dur}`,
    `Resultado: ${l.propostas ?? '—'} proposta(s) do Podemos · ${l.falhas ?? 0} estado(s) com problema${rep}`,
    '',
  ];
  const linhas = l.linhas.slice().sort((a, b) => String(a.uf).localeCompare(String(b.uf))).map(linhaDoLog);
  // Coleta ainda rodando: os estados em voo entram como tal, com o tempo já
  // decorrido — é o dado que diz se algo está pendurado.
  for (const [uf, t] of state.emVoo.entries()) {
    linhas.push(`… ${String(uf).padEnd(3)} em andamento há ${Math.round((Date.now() - t) / 1000)}s`);
  }
  if (state.emVoo.size) {
    linhas.push('', `(${l.linhas.length} de ${l.ufs} estados concluídos até agora)`);
  }
  const m = l.mudancas;
  const rodape = [];
  if (m && !m.primeira) {
    rodape.push('', 'MUDANÇAS DESDE A BUSCA ANTERIOR');
    if (!m.novas.length && !m.pagas.length && !m.subiu.length) rodape.push('  (nada mudou)');
    for (const it of m.pagas.slice(0, 40)) rodape.push(`  paga agora · ${it.deputado} · ${it.nuProposta} · ${it.municipio}/${it.uf} · ${fmtR$(it.pago)}`);
    for (const it of m.subiu.slice(0, 40)) rodape.push(`  pagamento novo · ${it.deputado} · ${it.nuProposta} · ${fmtR$(it.antes)} → ${fmtR$(it.pago)}`);
    for (const it of m.novas.slice(0, 40)) rodape.push(`  nova · ${it.deputado} · ${it.nuProposta} · ${it.municipio}/${it.uf} · ${fmtR$(it.proposto)}`);
  }
  return cab.concat(linhas, rodape).join('\n');
}

async function copiarLog() {
  const texto = relatorioDaColeta();
  console.log('[emendas] log da coleta\n' + texto);
  let ok = false;
  try { await navigator.clipboard.writeText(texto); ok = true; } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  mostrarToast(ok ? 'Log da coleta copiado — cole na conversa do suporte.'
                  : 'Log no console (F12) — não consegui copiar.', ok ? 'sucesso' : 'aviso');
}

// ============================================================
//  FIREBASE — só o recorte do partido
// ============================================================
async function fbSalvarUf(ano, uf, itens) {
  const corpo = { em: new Date().toISOString(), n: itens.length, itens };
  const r = await fetchComTimeout(`${FIREBASE_URL}/emendas-fns/${ano}/${uf}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  }, 20000);
  if (!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
}

async function carregarDoFirebase(ano) {
  try {
    const r = await fetchComTimeout(`${FIREBASE_URL}/emendas-fns/${ano}.json`, {}, 25000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const dados = await r.json();
    state.itens = [];
    state.meta = {};
    for (const uf of Object.keys(dados || {})) {
      const bloco = dados[uf] || {};
      state.meta[uf] = { em: bloco.em, n: bloco.n || 0 };
      for (const it of (bloco.itens || [])) state.itens.push(it);
    }
    state.ano = String(ano);
    renderTudo();
  } catch (e) {
    console.warn('[emendas] não foi possível ler a base salva:', e.message);
    mostrarToast('Não foi possível ler a base salva no Firebase: ' + e.message, 'erro');
  }
}

// ============================================================
//  FILTROS E AGREGAÇÃO
// ============================================================
function filtros() {
  return {
    deputado: document.getElementById('f-deputado').value,
    uf: document.getElementById('f-uf').value,
    municipio: document.getElementById('f-municipio').value.trim().toLowerCase(),
    tipo: document.getElementById('f-tipo').value,
    etapa: document.getElementById('f-etapa').value,
  };
}

function itensFiltrados() {
  const f = filtros();
  return state.itens.filter(it => {
    if (f.deputado && it.deputado !== f.deputado) return false;
    if (f.uf && it.uf !== f.uf) return false;
    if (f.tipo && it.tipo !== f.tipo) return false;
    if (f.municipio && !String(it.municipio).toLowerCase().includes(f.municipio)) return false;
    if (f.etapa && etapaDe(it).chave !== f.etapa) return false;
    return true;
  });
}

function somar(itens) {
  const t = { proposto: 0, empenhado: 0, pago: 0, n: itens.length, nPagas: 0 };
  for (const it of itens) {
    t.proposto += it.proposto; t.empenhado += it.empenhado; t.pago += it.pago;
    if (etapaDe(it).chave === 'pago') t.nPagas++;
  }
  t.apagar = Math.max(0, t.proposto - t.pago);
  return t;
}

function porDeputado(itens) {
  const mapa = new Map();
  for (const it of itens) {
    const chave = it.deputado || '(sem parlamentar)';
    if (!mapa.has(chave)) mapa.set(chave, { deputado: chave, ufs: new Set(), n: 0, proposto: 0, empenhado: 0, pago: 0 });
    const d = mapa.get(chave);
    d.ufs.add(it.uf); d.n++; d.proposto += it.proposto; d.empenhado += it.empenhado; d.pago += it.pago;
  }
  return [...mapa.values()]
    .map(d => ({ ...d, uf: [...d.ufs].sort().join(', '), pct: d.proposto ? Math.round((d.pago / d.proposto) * 100) : 0 }))
    .sort((a, b) => b.pago - a.pago || b.proposto - a.proposto);
}

// ============================================================
//  RENDER
// ============================================================
const fmt = n => (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtR$ = n => 'R$ ' + fmt(n);

function renderTudo() {
  if (state.aba === 'panorama') return renderTudoPanorama();
  const temBase = state.itens.length > 0 || Object.keys(state.meta).length > 0;
  document.getElementById('em-vazio').style.display = temBase ? 'none' : '';
  document.getElementById('em-conteudo').style.display = temBase ? '' : 'none';
  document.getElementById('btn-exportar').disabled = !temBase;
  // A barra de contexto e o seletor de exercício são pintados SEMPRE: escolher
  // um ano ainda sem dados escondia o próprio seletor junto com o conteúdo, e
  // não havia como voltar para um ano com base sem fechar o módulo
  // (relatado em 19/08/2026). O cabeçalho também mostrava os números do ano
  // anterior, contradizendo o "nenhuma consulta feita" logo abaixo.
  document.getElementById('em-filtros-panorama').style.display = 'none';
  document.getElementById('em-filtros-fns').style.display = '';
  document.getElementById('btn-panorama').style.display = 'none';
  document.getElementById('btn-chave').style.display = 'none';
  document.getElementById('btn-atualizar').style.display = '';
  document.getElementById('btn-buscar').style.display = '';
  popularSelects();
  renderTopo();
  if (!temBase) {
    pintarVazio('fns');
    return;
  }

  renderKpis();
  if (state.aba === 'propostas') renderTabelaPropostas();
  else renderTabelaDeputados();
}

function popularSelects() {
  const encher = (id, valores, atual) => {
    const sel = document.getElementById(id);
    const escolhido = atual !== undefined ? atual : sel.value;
    const primeiro = sel.querySelector('option[value=""]');
    sel.innerHTML = '';
    if (primeiro) sel.appendChild(primeiro);
    for (const v of valores) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    }
    if (escolhido && valores.includes(escolhido)) sel.value = escolhido;
  };
  encher('f-deputado', [...new Set(state.itens.map(i => i.deputado).filter(Boolean))].sort());
  encher('f-uf',       [...new Set(state.itens.map(i => i.uf).filter(Boolean))].sort());
  encher('f-tipo',     [...new Set(state.itens.map(i => i.tipo).filter(Boolean))].sort());

  // O seletor de exercício NÃO depende de haver dados: ele é a porta para
  // trocar de ano, inclusive para sair de um ano vazio.
  const anos = document.getElementById('f-ano');
  if (!anos.options.length) {
    const atual = new Date().getFullYear();
    for (let a = atual; a >= atual - 3; a--) {
      const o = document.createElement('option');
      o.value = String(a); o.textContent = String(a);
      anos.appendChild(o);
    }
  }
  anos.value = state.ano;
}

function renderTudoPanorama() {
  const tem = state.emendas.length > 0;
  document.getElementById('em-filtros-panorama').style.display = tem ? '' : 'none';
  document.getElementById('em-filtros-fns').style.display = 'none';
  document.getElementById('em-vazio').style.display = tem ? 'none' : '';
  document.getElementById('em-conteudo').style.display = tem ? '' : 'none';
  document.getElementById('btn-panorama').style.display = '';
  document.getElementById('btn-chave').style.display = '';
  document.getElementById('btn-atualizar').style.display = 'none';
  document.getElementById('btn-buscar').style.display = 'none';
  document.getElementById('btn-faltantes').style.display = 'none';
  document.getElementById('btn-exportar').disabled = !tem;
  popularSelects();   // mantém o seletor de exercício vivo nas duas abas

  const m = state.metaTr;
  document.getElementById('em-titulo').textContent = tem
    ? `${fmt(state.emendas.length)} emendas · ${new Set(state.emendas.map(e => e.parlamentar)).size} parlamentar(es) · ` +
      `${new Set(state.emendas.map(e => e.funcao)).size} pastas · exercício ${state.ano}`
    : `Exercício ${state.ano} — panorama ainda não consultado`;
  document.getElementById('em-meta').textContent = tem
    ? (m?.em ? `Última consulta em ${new Date(m.em).toLocaleString('pt-BR')} · ` : '') +
      (m?.composicao ? `${m.composicao} · ` : '') +
      'fonte: Portal da Transparência (todas as pastas, por emenda)'
    : 'O panorama cobre TODAS as pastas — saúde, educação, urbanismo, segurança e as demais. Exige a chave gratuita do Portal da Transparência.';
  document.getElementById('em-selo').innerHTML = tem
    ? (m?.falhas ? `<span class="em-badge em-badge--empenho">${m.falhas} parlamentar(es) com falha</span>`
                 : '<span class="em-badge em-badge--pago">Panorama completo</span>')
    : '<span class="em-badge em-badge--neutro">Sem panorama</span>';
  if (!tem) pintarVazio('panorama');

  if (tem) renderPanorama();
}

// O estado vazio é o MESMO bloco nas duas abas — antes ele ficava com o texto
// e o botão do FNS mesmo no panorama, mandando "Buscar no FNS" para quem
// queria consultar as outras pastas (relatado em 19/08/2026).
const VAZIO = {
  fns: {
    titulo: ano => `Nenhuma proposta na base para o exercício ${ano}`,
    texto: 'Esta aba baixa a planilha oficial de cada unidade da federação no portal do Fundo Nacional de Saúde ' +
           '(consultafns.saude.gov.br) e guarda apenas as propostas do Podemos — com município, entidade, etapa e ' +
           'ordem bancária. A primeira busca leva alguns minutos; depois disso a base abre na hora.',
    botao: 'Buscar no FNS',
  },
  panorama: {
    titulo: ano => `Panorama de ${ano} ainda não consultado`,
    texto: 'Esta aba mostra as emendas da bancada em TODAS as pastas — saúde, educação, urbanismo, segurança e as ' +
           'demais — pelo Portal da Transparência, com empenhado, liquidado, pago e restos a pagar. ' +
           'A consulta leva segundos e exige a chave gratuita do Portal.',
    botao: 'Consultar o Portal da Transparência',
  },
};

function pintarVazio(qual) {
  const v = VAZIO[qual];
  document.getElementById('em-vazio-titulo').textContent = v.titulo(state.ano);
  document.getElementById('em-vazio-texto').textContent = v.texto;
  document.getElementById('btn-buscar-vazio').textContent = v.botao;
}

function renderTopo() {
  const ufs = Object.keys(state.meta);
  if (!ufs.length) {
    document.getElementById('em-titulo').textContent = `Exercício ${state.ano} — nada coletado ainda`;
    document.getElementById('em-meta').textContent =
      'Use “Varredura completa” para baixar as planilhas deste exercício, ou volte ao exercício anterior no seletor ao lado.';
    document.getElementById('em-selo').innerHTML =
      '<span class="em-badge em-badge--neutro">Base vazia</span>';
    document.getElementById('btn-faltantes').style.display = 'none';
    return;
  }
  const datas = ufs.map(u => state.meta[u].em).filter(Boolean).sort();
  const ultima = datas.length ? new Date(datas[datas.length - 1]) : null;
  const dep = [...new Set(state.itens.map(i => i.deputado).filter(Boolean))].length;
  document.getElementById('em-titulo').textContent =
    `${fmt(state.itens.length)} propostas da bancada · ${dep} deputado(s) · exercício ${state.ano}`;
  document.getElementById('em-meta').textContent =
    (ultima ? `Última busca em ${ultima.toLocaleString('pt-BR')} · ` : '') +
    `${ufs.length} de ${UFS.length} estados na base · fonte: portal do Fundo Nacional de Saúde`;
  const faltam = ufsFaltantes();
  document.getElementById('em-selo').innerHTML = faltam.length === 0
    ? '<span class="em-badge em-badge--pago">Base completa</span>'
    : `<span class="em-badge em-badge--empenho" title="Faltam: ${faltam.join(', ')}">Base parcial (${ufs.length}/${UFS.length})</span>`;
  // Botão dedicado: completar a base custa 3 downloads, não 27 — e a lista de
  // quem falta fica no próprio rótulo, sem o analista ter que deduzir.
  const btnF = document.getElementById('btn-faltantes');
  btnF.style.display = faltam.length ? '' : 'none';
  btnF.textContent = `Buscar os que faltam (${faltam.length}): ${faltam.join(', ')}`;
  btnF.title = `Reconsulta apenas ${faltam.join(', ')} — os estados que ainda não entraram na base`;
}

function renderKpis() {
  const t = somar(itensFiltrados());
  document.getElementById('kpi-proposto').textContent = fmtR$(t.proposto);
  document.getElementById('kpi-proposto-sub').textContent = `${fmt(t.n)} proposta(s)`;
  document.getElementById('kpi-empenhado').textContent = fmtR$(t.empenhado);
  document.getElementById('kpi-empenhado-sub').textContent = t.proposto
    ? `${Math.round((t.empenhado / t.proposto) * 100)}% do proposto` : '';
  document.getElementById('kpi-pago').textContent = fmtR$(t.pago);
  document.getElementById('kpi-pago-sub').textContent = t.proposto
    ? `${Math.round((t.pago / t.proposto) * 100)}% do proposto · ${fmt(t.nPagas)} paga(s)` : '';
  document.getElementById('kpi-apagar').textContent = fmtR$(t.apagar);
  document.getElementById('kpi-apagar-sub').textContent = `${fmt(t.n - t.nPagas)} em andamento`;
}

const COLS_PROPOSTAS = [
  { chave: 'deputado',  rotulo: 'Deputado', classe: 'forte' },
  { chave: 'nuProposta',rotulo: 'Proposta', classe: 'dim' },
  { chave: 'municipio', rotulo: 'Município' },
  { chave: 'entidade',  rotulo: 'Entidade', classe: 'dim' },
  { chave: 'tipo',      rotulo: 'Objeto' },
  { chave: 'proposto',  rotulo: 'Proposto',  num: true },
  { chave: 'empenhado', rotulo: 'Empenhado', num: true },
  { chave: 'pago',      rotulo: 'Pago',      num: true, classe: 'pago' },
  { chave: 'etapa',     rotulo: 'Etapa' },
];

function ordenar(itens, col, desc) {
  const val = it => col === 'etapa' ? etapaDe(it).rotulo : it[col];
  return itens.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    const cmp = (typeof va === 'number' && typeof vb === 'number')
      ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR');
    return desc ? -cmp : cmp;
  });
}

function renderTabelaPropostas() {
  const thead = document.getElementById('em-thead');
  thead.innerHTML = '<tr>' + COLS_PROPOSTAS.map(c => {
    const seta = state.ordem.col === c.chave ? (state.ordem.desc ? ' ↓' : ' ↑') : '';
    return `<th data-col="${c.chave}"${c.num ? ' class="num"' : ''}>${c.rotulo}${seta}</th>`;
  }).join('') + '</tr>';
  thead.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.col;
    state.ordem = { col, desc: state.ordem.col === col ? !state.ordem.desc : true };
    renderTabelaPropostas();
  }));

  const itens = ordenar(itensFiltrados(), state.ordem.col, state.ordem.desc);
  const tbody = document.getElementById('em-tbody');
  tbody.innerHTML = itens.map(it => {
    const et = etapaDe(it);
    return `<tr data-proposta="${escapeHtml(it.nuProposta)}">
      <td class="forte">${escapeHtml(it.deputado)} <span class="dim" style="font-weight:400">${escapeHtml(it.uf)}</span></td>
      <td class="dim num" style="text-align:left">${escapeHtml(it.nuProposta)}</td>
      <td>${escapeHtml(it.municipio)}</td>
      <td class="dim">${escapeHtml(it.entidade)}</td>
      <td>${escapeHtml(it.tipo)}</td>
      <td class="num">${fmt(it.proposto)}</td>
      <td class="num">${fmt(it.empenhado)}</td>
      <td class="num ${it.pago ? 'pago' : 'dim'}">${fmt(it.pago)}</td>
      <td><span class="em-badge ${et.classe}">${escapeHtml(et.rotulo)}</span></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="padding:30px; text-align:center; color:var(--text-dim)">Nenhuma proposta com esses filtros.</td></tr>`;

  tbody.querySelectorAll('tr[data-proposta]').forEach(tr =>
    tr.addEventListener('click', () => abrirDetalhe(tr.dataset.proposta)));
}

function renderTabelaDeputados() {
  const linhas = porDeputado(itensFiltrados());
  document.getElementById('em-thead').innerHTML =
    '<tr><th>Deputado</th><th>UF</th><th class="num">Propostas</th><th class="num">Proposto</th>' +
    '<th class="num">Empenhado</th><th class="num">Pago</th><th style="width:200px">Execução</th></tr>';
  const total = somar(itensFiltrados());
  const barra = (pct) => {
    const cor = pct >= 50 ? 'var(--accent)' : pct >= 20 ? 'var(--amarelo)' : 'var(--vermelho)';
    return `<div class="em-exec"><div class="em-exec-barra"><div style="width:${Math.max(pct, 2)}%; background:${cor}"></div></div>
            <span class="em-exec-pct">${pct}%</span></div>`;
  };
  document.getElementById('em-tbody').innerHTML = linhas.map(d => `
    <tr>
      <td class="forte">${escapeHtml(d.deputado)}</td>
      <td class="dim">${escapeHtml(d.uf)}</td>
      <td class="num">${fmt(d.n)}</td>
      <td class="num">${fmt(d.proposto)}</td>
      <td class="num">${fmt(d.empenhado)}</td>
      <td class="num pago">${fmt(d.pago)}</td>
      <td>${barra(d.pct)}</td>
    </tr>`).join('') + (linhas.length ? `
    <tr style="background: rgba(31,165,165,0.06)">
      <td class="forte" style="color: var(--accent-light)">Bancada (total)</td>
      <td class="dim">—</td>
      <td class="num forte">${fmt(total.n)}</td>
      <td class="num forte">${fmt(total.proposto)}</td>
      <td class="num forte">${fmt(total.empenhado)}</td>
      <td class="num pago">${fmt(total.pago)}</td>
      <td>${barra(total.proposto ? Math.round((total.pago / total.proposto) * 100) : 0)}</td>
    </tr>` : `<tr><td colspan="7" style="padding:30px; text-align:center; color:var(--text-dim)">Nenhuma proposta com esses filtros.</td></tr>`);
}

// ============================================================
//  DETALHE DA PROPOSTA (sob demanda, direto no FNS)
// ============================================================
const ETAPAS_FNS = ['Cadastro', 'Análise de mérito', 'Análise econômica', 'Classificação orçamentária',
  'Aprovação secretaria finalística', 'Autorização secretaria executiva', 'Publicação', 'Autorização FNS',
  'Empenho', 'Formalização', 'Em pagamento', 'Pago'];

async function abrirDetalhe(nuProposta) {
  const base = state.itens.find(i => i.nuProposta === nuProposta);
  if (!base) return;
  const modal = document.getElementById('modal-detalhe');
  const et = etapaDe(base);
  document.getElementById('det-titulo').textContent = `Proposta ${nuProposta}`;
  document.getElementById('det-badge').innerHTML = `<span class="em-badge ${et.classe}">${escapeHtml(et.rotulo)}</span>`;
  document.getElementById('det-sub').textContent =
    `${base.deputado} (PODE-${base.uf}) · ${base.municipio} · exercício ${base.ano}`;
  document.getElementById('det-link').href = `${FNS_BASE}/#/proposta`;
  document.getElementById('det-fonte').textContent = 'Consultando o FNS…';
  document.getElementById('det-corpo').innerHTML =
    '<div style="padding:40px; text-align:center; color:var(--text-dim)">Buscando o detalhe no portal do FNS…</div>';
  modal.style.display = 'flex';

  let detalhe = null, etapas = null, erro = null;
  try {
    const [d, e] = await Promise.all([
      fetchComTimeout(`${FNS_BASE}/recursos/proposta/obter-proposta?nuProposta=${encodeURIComponent(nuProposta)}`).then(r => r.ok ? r.json() : null),
      fetchComTimeout(`${FNS_BASE}/recursos/proposta/obter-proposta-etapa?nuProposta=${encodeURIComponent(nuProposta)}`).then(r => r.ok ? r.json() : null),
    ]);
    detalhe = d?.resultado || null;
    etapas = e?.resultado || null;
  } catch (e) { erro = e.message; }

  document.getElementById('det-corpo').innerHTML = htmlDetalhe(base, detalhe, etapas, erro);
  document.getElementById('det-fonte').textContent = erro
    ? `Detalhe não consultado (${erro}) — os valores abaixo vêm da planilha baixada.`
    : `Consultado no FNS em ${new Date().toLocaleString('pt-BR')}`;
}

function htmlDetalhe(base, d, etapasApi, erro) {
  const ficha = [
    ['Município', `${base.municipio}/${base.uf}`],
    ['Entidade', d?.noEntidade || base.entidade],
    ['CNPJ', d?.cnpjFormatado || base.cnpj],
    ['Objeto', d?.coTipoProposta || base.tipo],
    ['Portaria', base.portaria ? `nº ${base.portaria}${base.dataPortaria ? `, de ${base.dataPortaria}` : ''}` : '—'],
    ['Processo', d?.nuProcesso && d.nuProcesso !== 'N/A' ? d.nuProcesso : (base.localizacaoPagamento || '—')],
  ];
  const proposto  = d ? (d.vlProposta ?? base.proposto)  : base.proposto;
  const empenhado = d ? (d.vlEmpenhado ?? base.empenhado) : base.empenhado;
  const pago      = d ? (d.vlPago ?? base.pago)           : base.pago;
  const valores = [
    ['Proposto', fmtR$(proposto), ''],
    ['Empenhado', fmtR$(empenhado), ''],
    ['Pago', fmtR$(pago), 'color:#2fcf7a'],
    ['A pagar', fmtR$(Math.max(0, proposto - pago)), 'color:var(--text-dim)'],
  ];

  // Etapas: a API manda a lista com a atual marcada. Sem ela (falha), a
  // situação da planilha ainda diz em que ponto a proposta está — mas isso
  // fica ESCRITO, para ninguém confundir estimativa com dado da fonte.
  const codigoAtual = etapasApi?.codigoAtual;
  const listaEtapas = etapasApi?.etapas?.length
    ? etapasApi.etapas.map(e => ({ nome: e.descricao, feita: e.codigo < codigoAtual, atual: !!e.atual }))
    : null;

  const etapasHtml = listaEtapas
    ? `<div class="em-etapas">${listaEtapas.map(e => `
        <div class="em-etapa ${e.atual ? 'atual' : ''}">
          <div class="em-etapa-bola ${e.atual ? 'atual' : e.feita ? 'feita' : ''}">
            ${e.feita || e.atual ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${e.atual ? '#0e1c1f' : '#2fcf7a'}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
          </div>
          <span class="em-etapa-nome">${escapeHtml(e.nome)}</span>
        </div>`).join('')}</div>`
    : `<div style="font-size:12.5px; color:var(--text-dim)">Não foi possível consultar as etapas no FNS agora.
        Pela planilha, a situação registrada é: <b style="color:var(--text)">${escapeHtml(base.situacao || '—')}</b>.</div>`;

  const pagamentos = d?.pagamentos || [];
  const dataBr = ms => ms ? new Date(ms).toLocaleDateString('pt-BR') : '—';
  const pagHtml = pagamentos.length ? `
    <table class="em-tabela" style="border:1px solid var(--border); border-radius:var(--radius); overflow:hidden">
      <thead><tr><th>Parcela</th><th>Data</th><th>Ordem bancária</th><th>Processo</th><th class="num">Valor</th><th class="num">Acumulado</th></tr></thead>
      <tbody>${pagamentos.map(p => `<tr>
        <td>${escapeHtml(p.nuParcela || '—')}</td>
        <td class="num" style="text-align:left">${dataBr(p.dtCriacaoSiafi)}</td>
        <td class="num" style="text-align:left">${escapeHtml(p.nuOb || '—')}</td>
        <td class="dim">${escapeHtml(p.nuProcesso || '—')}</td>
        <td class="num pago">${fmt(p.vlLiquido)}</td>
        <td class="num">${fmt(p.vlAcumulado)}</td>
      </tr>`).join('')}</tbody>
    </table>`
    : `<div style="font-size:12.5px; color:var(--text-dim)">${erro || !d ? 'Pagamentos não consultados.' : 'Nenhum pagamento registrado até agora.'}</div>`;

  return `
    <div class="em-ficha">
      ${ficha.map(([r, v]) => `<div class="em-ficha-item"><span class="em-rotulo">${r}</span><span>${escapeHtml(v || '—')}</span></div>`).join('')}
    </div>
    <div class="em-valores">
      ${valores.map(([r, v, st]) => `<div class="em-valor-card"><span class="em-rotulo">${r}</span><span class="v" style="${st}">${v}</span></div>`).join('')}
    </div>
    <div style="padding:18px 20px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:12px;">
      <span class="em-secao-rotulo">Etapas no Fundo Nacional de Saúde</span>
      ${etapasHtml}
    </div>
    <div style="padding:18px 20px; display:flex; flex-direction:column; gap:10px;">
      <span class="em-secao-rotulo">Pagamentos</span>
      ${pagHtml}
    </div>`;
}

// ============================================================
//  EXPORTAÇÃO
// ============================================================
function exportarXlsx() {
  if (state.aba === 'panorama') return exportarPanoramaXlsx();
  const itens = ordenar(itensFiltrados(), state.ordem.col, state.ordem.desc);
  if (!itens.length) { mostrarToast('Nada para exportar com esses filtros.', 'aviso'); return; }

  const cab = ['Deputado', 'Partido', 'UF', 'Proposta', 'Município', 'Entidade', 'CNPJ',
               'Objeto', 'Tipo de recurso', 'Portaria', 'Data da portaria',
               'Proposto', 'Empenhado', 'Pago', 'A pagar', 'Situação', 'Etapa'];
  const linhas = itens.map(it => [
    it.deputado, SIGLA_PODEMOS, it.uf, it.nuProposta, it.municipio, it.entidade, it.cnpj,
    it.tipo, it.tipoRecurso, it.portaria, it.dataPortaria,
    it.proposto, it.empenhado, it.pago, Math.max(0, it.proposto - it.pago),
    it.situacao, etapaDe(it).rotulo,
  ]);
  const t = somar(itens);
  linhas.push([]);
  linhas.push(['TOTAL', '', '', `${t.n} propostas`, '', '', '', '', '', '', '',
               t.proposto, t.empenhado, t.pago, t.apagar, '', '']);

  const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
  ws['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 5 }, { wch: 20 }, { wch: 22 }, { wch: 34 }, { wch: 20 },
                 { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 12 },
                 { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 34 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Emendas ${state.ano}`);
  const f = filtros();
  const sufixo = [f.deputado, f.uf, f.etapa].filter(Boolean).join('-').replace(/\s+/g, '_');
  XLSX.writeFile(wb, `emendas-fns-${state.ano}${sufixo ? '-' + sufixo : ''}.xlsx`);
  mostrarToast(`✓ ${itens.length} proposta(s) exportadas.`, 'sucesso');
}

function exportarPanoramaXlsx() {
  const lista = emendasFiltradas();
  if (!lista.length) { mostrarToast('Nada para exportar com esses filtros.', 'aviso'); return; }
  const cab = ['Parlamentar', 'Partido', 'Código da emenda', 'Nº', 'Tipo', 'Pasta (função)', 'Subfunção',
               'Localidade do gasto', 'Empenhado', 'Liquidado', 'Pago', 'Restos inscritos', 'Restos pagos'];
  const linhas = lista.map(e => [e.parlamentar, SIGLA_PODEMOS, e.codigo, e.numero, e.tipo, e.funcao, e.subfuncao,
                                 e.localidade, e.empenhado, e.liquidado, e.pago, e.restoInscrito, e.restoPago]);
  const t = somarEmendas(lista);
  linhas.push([], ['TOTAL', '', `${t.n} emendas`, '', '', '', '', '', t.empenhado, t.liquidado, t.pago, '', '']);

  const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
  ws['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 16 }, { wch: 6 }, { wch: 44 }, { wch: 22 }, { wch: 26 },
                 { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Panorama ${state.ano}`);
  XLSX.writeFile(wb, `orcamento-panorama-${state.ano}.xlsx`);
  mostrarToast(`✓ ${lista.length} emenda(s) exportadas.`, 'sucesso');
}

// ============================================================
//  UTILITÁRIOS E ARRANQUE
// ============================================================
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mostrarToast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${tipo}`;
  el.style.display = 'block';
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-voltar').addEventListener('click', () => window.close());
  document.getElementById('btn-buscar').addEventListener('click', () => buscarNoFns('tudo'));
  document.getElementById('btn-buscar-vazio').addEventListener('click', () =>
    state.aba === 'panorama' ? buscarPanorama() : buscarNoFns('tudo'));
  document.getElementById('btn-atualizar').addEventListener('click', () => buscarNoFns('bancada'));
  document.getElementById('btn-faltantes').addEventListener('click', () => buscarNoFns('faltantes'));
  document.getElementById('btn-log').addEventListener('click', copiarLog);
  document.getElementById('btn-exportar').addEventListener('click', exportarXlsx);
  document.getElementById('btn-cancelar').addEventListener('click', () => {
    if (state.varredura) state.varredura.abort();
  });
  document.getElementById('det-fechar').addEventListener('click', () => {
    document.getElementById('modal-detalhe').style.display = 'none';
  });
  document.getElementById('modal-detalhe').addEventListener('click', e => {
    if (e.target.id === 'modal-detalhe') e.currentTarget.style.display = 'none';
  });

  for (const id of ['f-deputado', 'f-uf', 'f-tipo', 'f-etapa']) {
    document.getElementById(id).addEventListener('change', () => { renderKpis(); renderTabela(); });
  }
  document.getElementById('f-municipio').addEventListener('input', () => { renderKpis(); renderTabela(); });
  document.getElementById('f-ano').addEventListener('change', e => carregarExercicio(e.target.value));

  document.querySelectorAll('.em-aba').forEach(b =>
    b.addEventListener('click', () => trocarAba(b.dataset.aba)));

  for (const id of ['p-parlamentar', 'p-funcao', 'p-tipo']) {
    document.getElementById(id).addEventListener('change', renderPanorama);
  }
  document.getElementById('btn-panorama').addEventListener('click', buscarPanorama);
  document.getElementById('btn-chave').addEventListener('click', abrirModalChave);
  document.getElementById('chave-cancelar').addEventListener('click', () => {
    document.getElementById('modal-chave').style.display = 'none';
  });
  document.getElementById('chave-salvar').addEventListener('click', async () => {
    const v = document.getElementById('input-chave').value.trim();
    if (!v) { document.getElementById('chave-status').textContent = 'Cole a chave para continuar.'; return; }
    await salvarChaveTransparencia(v);
    document.getElementById('modal-chave').style.display = 'none';
    buscarPanorama();
  });

  popularSelects();
  state.aba = 'panorama';
  carregarExercicio(state.ano);
});

/** Carrega as DUAS fontes do exercício — cada aba lê a sua. */
async function carregarExercicio(ano) {
  state.ano = String(ano);
  await Promise.all([carregarPanorama(ano), carregarDoFirebase(ano)]);
  renderTudo();
}

function trocarAba(aba) {
  document.querySelectorAll('.em-aba').forEach(x => x.classList.toggle('on', x.dataset.aba === aba));
  state.aba = aba;
  renderTudo();
}

async function abrirModalChave() {
  document.getElementById('input-chave').value = await chaveTransparencia();
  document.getElementById('chave-status').textContent = '';
  document.getElementById('modal-chave').style.display = 'flex';
}

function renderTabela() {
  if (state.aba === 'panorama') renderPanorama();
  else if (state.aba === 'propostas') renderTabelaPropostas();
  else renderTabelaDeputados();
}

// ============================================================
//  RENDER DO PANORAMA
// ============================================================
function renderPanorama() {
  popularSelectsPanorama();
  const lista = emendasFiltradas();
  const t = somarEmendas(lista);
  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

  document.getElementById('kpi-proposto').textContent = fmtR$(t.empenhado);
  document.getElementById('kpi-proposto-sub').textContent = `${fmt(t.n)} emenda(s)`;
  document.getElementById('kpi-empenhado').textContent = fmtR$(t.liquidado);
  document.getElementById('kpi-empenhado-sub').textContent = `${pct(t.liquidado, t.empenhado)}% do empenhado`;
  document.getElementById('kpi-pago').textContent = fmtR$(t.pago);
  document.getElementById('kpi-pago-sub').textContent = `${pct(t.pago, t.empenhado)}% do empenhado`;
  document.getElementById('kpi-apagar').textContent = fmtR$(t.restos);
  document.getElementById('kpi-apagar-sub').textContent = 'restos a pagar não quitados';
  // Os rótulos dos indicadores mudam de fonte para fonte: no panorama a régua
  // é o EMPENHO (o Portal não fala em "proposto"), na saúde é a proposta.
  const rotulos = document.querySelectorAll('.em-kpi .em-rotulo');
  ['Empenhado', 'Liquidado', 'Pago', 'Restos a pagar'].forEach((r, i) => { if (rotulos[i]) rotulos[i].textContent = r; });

  const { colunas, linhas } = matrizPorPasta(lista);
  const th = c => `<th class="num">${escapeHtml(c)}</th>`;
  document.getElementById('em-thead').innerHTML =
    '<tr><th>Parlamentar</th>' + colunas.map(th).join('') + '<th class="num">Total pago</th></tr>';

  const celula = (l, col) => {
    const c = l.celulas[col];
    if (!c) return '<td class="num dim">—</td>';
    const p = pct(c.pago, c.empenhado);
    if (p > 100) {
      // Contradição da fonte: mostrada como está, com aviso — nunca aparada.
      return `<td class="num" style="background:rgba(255,170,0,.10)" data-parl="${escapeHtml(l.parlamentar)}" data-func="${escapeHtml(col)}"` +
             ` title="O Portal da Transparência informa pago maior que o empenhado nesta pasta (${p}%). Número mantido como está na fonte — confira antes de usar.">` +
             `${fmt(c.pago)} <span style="color:#ffcc66">⚠ ${p}%</span></td>`;
    }
    // O fundo mais forte marca onde o dinheiro efetivamente saiu — a leitura
    // que a Liderança faz primeiro é "isso aqui foi pago ou não?".
    const fundo = p >= 70 ? 'rgba(0,168,89,.14)' : p >= 40 ? 'rgba(0,168,89,.08)' : 'transparent';
    return `<td class="num" style="background:${fundo}" data-parl="${escapeHtml(l.parlamentar)}" data-func="${escapeHtml(col)}">` +
           `${fmt(c.pago)} <span class="dim">${p}%</span></td>`;
  };

  document.getElementById('em-tbody').innerHTML = linhas.length ? linhas.map(l => `
    <tr>
      <td class="forte">${escapeHtml(l.parlamentar)}</td>
      ${colunas.map(c => celula(l, c)).join('')}
      <td class="num pago">${fmt(l.total.pago)}</td>
    </tr>`).join('') + `
    <tr style="background: rgba(31,165,165,0.06)">
      <td class="forte" style="color: var(--accent-light)">Bancada (${linhas.length})</td>
      ${colunas.map(c => {
        const soma = linhas.reduce((a, l) => a + (l.celulas[c]?.pago || 0), 0);
        return `<td class="num forte">${fmt(soma)}</td>`;
      }).join('')}
      <td class="num pago forte">${fmt(t.pago)}</td>
    </tr>`
    : `<tr><td colspan="${colunas.length + 2}" style="padding:30px; text-align:center; color:var(--text-dim)">Nenhuma emenda com esses filtros.</td></tr>`;

  document.querySelectorAll('#em-tbody td[data-parl]').forEach(td =>
    td.addEventListener('click', () => abrirPasta(td.dataset.parl, td.dataset.func)));
}

function popularSelectsPanorama() {
  const encher = (id, valores) => {
    const sel = document.getElementById(id);
    const escolhido = sel.value;
    const primeiro = sel.querySelector('option[value=""]');
    sel.innerHTML = '';
    if (primeiro) sel.appendChild(primeiro);
    for (const v of valores) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    }
    if (escolhido && valores.includes(escolhido)) sel.value = escolhido;
  };
  encher('p-parlamentar', [...new Set(state.emendas.map(e => e.parlamentar))].sort());
  encher('p-funcao', [...new Set(state.emendas.map(e => e.funcao))].sort());
  encher('p-tipo', [...new Set(state.emendas.map(e => e.tipo))].sort());
}

/** Detalhe: as emendas de um parlamentar numa pasta. */
function abrirPasta(parlamentar, funcao) {
  const daPasta = state.emendas.filter(e =>
    e.parlamentar === parlamentar && (funcao === 'Outras'
      ? !matrizPorPasta(emendasFiltradas()).colunas.includes(e.funcao)
      : e.funcao === funcao));
  if (!daPasta.length) return;
  const t = somarEmendas(daPasta);

  document.getElementById('det-titulo').textContent = `${parlamentar} · ${funcao}`;
  document.getElementById('det-badge').innerHTML =
    `<span class="em-badge em-badge--neutro">${daPasta.length} emenda(s)</span>`;
  document.getElementById('det-sub').textContent =
    `Exercício ${state.ano} · fonte: Portal da Transparência`;
  document.getElementById('det-fonte').textContent = state.metaTr?.em
    ? `Consultado em ${new Date(state.metaTr.em).toLocaleString('pt-BR')}` : '';
  document.getElementById('det-link').href = 'https://portaldatransparencia.gov.br/emendas';

  const linha = e => {
    // Transferência especial NÃO tem proposta no FNS — dizer isso evita que o
    // analista procure um detalhe que não existe.
    const acao = temPropostaNoFns(e)
      ? `<a href="#" data-fns="${escapeHtml(e.parlamentar)}">ver propostas no FNS →</a>`
      : `<span class="dim">${/especia/i.test(e.tipo) ? 'transferência especial — sem proposta no FNS' : 'sem detalhe fora da saúde'}</span>`;
    const aviso = pagoIncoerente(e)
      ? ` <button class="btn btn-outline btn-sm" data-conferir="${escapeHtml(e.codigo)}" style="padding:1px 6px; font-size:11px"
                 title="A fonte informa pago maior que o empenhado. Clique para somar os documentos de pagamento na própria fonte.">⚠ conferir</button>` : '';
    return `<tr>
      <td class="dim">${escapeHtml(e.codigo)}</td>
      <td>${escapeHtml(e.subfuncao || '—')}</td>
      <td>${escapeHtml(e.localidade || '—')}</td>
      <td class="num">${fmt(e.empenhado)}</td>
      <td class="num ${e.pago ? 'pago' : 'dim'}">${fmt(e.pago)}${aviso}</td>
      <td>${acao}</td>
    </tr>`;
  };

  document.getElementById('det-corpo').innerHTML = `
    <div class="em-valores">
      ${[['Empenhado', fmtR$(t.empenhado), ''], ['Liquidado', fmtR$(t.liquidado), ''],
         ['Pago', fmtR$(t.pago), 'color:#2fcf7a'], ['Restos a pagar', fmtR$(t.restos), 'color:var(--amarelo)']]
        .map(([r, v, st]) => `<div class="em-valor-card"><span class="em-rotulo">${r}</span><span class="v" style="${st}">${v}</span></div>`).join('')}
    </div>
    <div style="padding:18px 20px; display:flex; flex-direction:column; gap:10px;">
      <span class="em-secao-rotulo">Emendas nesta pasta</span>
      <div style="border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;">
        <table class="em-tabela">
          <thead><tr><th>Código</th><th>Subfunção</th><th>Localidade do gasto</th><th class="num">Empenhado</th><th class="num">Pago</th><th>Detalhe</th></tr></thead>
          <tbody>${daPasta.map(linha).join('')}</tbody>
        </table>
      </div>
      ${daPasta.some(pagoIncoerente) ? `<span style="font-size:11px; color:#ffcc66; line-height:1.6;">
        ⚠ Em ${daPasta.filter(pagoIncoerente).length} emenda(s) desta pasta o Portal informa <b>pago maior que o empenhado</b>.
        O número aparece como está na fonte, sem correção nossa — confira no Portal antes de usar em documento.</span>` : ''}
      <span style="font-size:11px; color:var(--text-dim); line-height:1.6;">
        A localidade quase sempre vem como “MÚLTIPLO” no Portal da Transparência — município, entidade e
        ordem bancária são detalhe do FNS, disponível na aba “Propostas · saúde”.
      </span>
    </div>`;

  document.querySelectorAll('#det-corpo button[data-conferir]').forEach(b => b.addEventListener('click', async () => {
    const codigo = b.dataset.conferir;
    const e = state.emendas.find(x => x.codigo === codigo);
    b.disabled = true; b.textContent = 'conferindo…';
    try {
      const chave = await chaveTransparencia();
      const { pagamentos, soma } = await conferirEmendaNaFonte(codigo, chave);
      const bate = Math.abs(soma - e.pago) < 0.01;
      // O veredito é dado com os dois números lado a lado: quem lê decide,
      // com a evidência à vista, em vez de confiar num ajuste silencioso.
      b.outerHTML = `<span style="font-size:11px; color:${bate ? 'var(--text-dim)' : '#ffcc66'}">` +
        (bate
          ? `documentos somam ${fmtR$(soma)} — confere`
          : `⚠ documentos de pagamento somam <b>${fmtR$(soma)}</b>, mas a API informa ${fmtR$(e.pago)}` +
            (pagamentos.length ? ` · ${pagamentos.map(p => `${p.documento} ${fmtR$(p.valor)}`).join(' · ')}` : '')) +
        `</span>`;
    } catch (err) {
      b.disabled = false; b.textContent = '⚠ conferir';
      mostrarToast('Não foi possível conferir na fonte: ' + err.message, 'erro');
    }
  }));

  document.querySelectorAll('#det-corpo a[data-fns]').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault();
    document.getElementById('modal-detalhe').style.display = 'none';
    trocarAba('propostas');
    const sel = document.getElementById('f-deputado');
    if ([...sel.options].some(o => o.value === a.dataset.fns)) sel.value = a.dataset.fns;
    renderKpis(); renderTabela();
  }));

  document.getElementById('modal-detalhe').style.display = 'flex';
}
