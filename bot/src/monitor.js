'use strict';
// Monitor de Sessão ao Vivo do Plenário.
//   OCIOSO  → poll /eventos (60 s, janela útil) → sessão deliberativa Em Andamento
//   SESSÃO  → poll do painel (20 s): Ordem do Dia, abertura de nominais,
//             encerramento (votos individuais publicados) → imagem + mensagem
//   FIM ODD → resumo das votações via worker (tentativas 0/+5/+10 min;
//             reforço no fim da sessão se a ODD encerrar sem gatilho)
// Mensagens vão ao GRUPO (produção) ou só ao admin (MONITOR_ENSAIO=1).
// Idempotência entre reinícios: /bot/monitor_sessao/{eventoId} no Firebase.
const { fbGet, fbPatch } = require('./firebase');
const { paginaSessao, parseItens, parsePlacarPortal, identificarItem } = require('./portal');
const { statusPlenario, sessaoAtual } = require('./plenariocosev');
const { imagemVotacao } = require('./imagem');
const { resumoSessao } = require('./worker');
const { pautaAtualImportada } = require('./pauta');
const { carregarAnaliseMaisRecente } = require('./perguntar');
const { buscarDestaquePreparado } = require('./destaques');
const { InlineKeyboard } = require('grammy');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const POLL_EVENTOS_MS = 30e3;   // detecção de início/fim de sessão
const POLL_PAINEL_MS  = 10e3;   // itens/aberturas/encerramentos (portal é a fonte rápida)
// Tentativas do RESUMO após o encerramento: os Dados Abertos levam ~5 min
// para publicar as matérias apreciadas — por isso minutos, não segundos.
// (Falha de ENVIO tem retry próprio de 5s/10s dentro de tentarResumo.)
const RESUMO_TENTATIVAS_MIN = [0, 5, 10];

let _cfg = null;      // { api, destino(), admin, ensaio() , ligado }
let _sessao = null;   // { id, dataISO, estado, falhasPainel, avisoFalhaDado, tickando }
let _timerEv = null, _timerPainel = null, _timerAbertura = null;
const _encerradas = new Set();   // ids de sessões já encerradas neste processo (não reativar)

const agoraSP = () => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false,
}).formatToParts(new Date());
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Seg–sex 08h–23h59 + madrugada até 02h (sessões que viram o dia)
function janelaAtiva() {
  const p = agoraSP();
  const dia  = p.find(x => x.type === 'weekday').value;
  const hora = parseInt(p.find(x => x.type === 'hour').value, 10) % 24;
  if (dia === 'Sun') return false;
  if (dia === 'Sat') return hora < 2;
  return hora >= 8 || hora < 2;
}

// Fatia mensagens acima do limite de 4096 do Telegram (mesma regra do index.js).
// O resumo de sessão cheia passa fácil de 4096 — sem fatiar, o sendMessage
// falha e o catch silencioso engolia a mensagem.
function fatiar(texto, tam = 3900) {
  const partes = [];
  let resto = String(texto || '');
  while (resto.length > tam) {
    let corte = resto.lastIndexOf('\n', tam);
    if (corte < tam * 0.5) corte = tam;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\n+/, '');
  }
  if (resto) partes.push(resto);
  return partes;
}

async function enviar(texto, { md = false } = {}) {
  const destino = _cfg.destino();
  if (!destino) { console.warn('[monitor] sem destino configurado — mensagem descartada'); return; }
  for (const parte of fatiar(texto)) {
    if (md) {
      // Negrito Telegram (*texto*); se algum rótulo quebrar o parse, cai p/ texto puro
      try { await _cfg.api.sendMessage(destino, parte, { parse_mode: 'Markdown' }); continue; }
      catch (_) { /* fallback abaixo */ }
    }
    await _cfg.api.sendMessage(destino, parte).catch(e => console.warn('[monitor] envio falhou:', e.message));
  }
}

/** Envio ESTRITO: fatia e NÃO engole erro — usado onde a falha precisa acionar retry. */
async function enviarOuFalhar(texto) {
  const destino = _cfg.destino();
  if (!destino) throw new Error('sem destino configurado (GRUPO_CHAT_ID/MONITOR_ENSAIO)');
  for (const parte of fatiar(texto)) await _cfg.api.sendMessage(destino, parte);
}
// Grupo (ou destino de ensaio) + cópia ao admin, sem duplicar quando o
// destino já É o admin (modo ensaio).
async function enviarComCopiaAdmin(texto) {
  const destinos = new Set([_cfg.destino(), _cfg.admin].filter(Boolean));
  for (const d of destinos) {
    try { await _cfg.api.sendMessage(d, texto, { parse_mode: 'Markdown' }); }
    catch (_) { await _cfg.api.sendMessage(d, texto).catch(e => console.warn('[monitor] envio destaque falhou:', e.message)); }
  }
}

async function enviarFoto(foto, caption) {
  const destino = _cfg.destino();
  if (!destino) return;
  const { InputFile } = require('grammy');
  const opts = caption ? { caption } : undefined;
  return _cfg.api.sendPhoto(destino, new InputFile(foto, 'votacao.png'), opts)
    .catch(e => console.warn('[monitor] envio de foto falhou:', e.message));
}

// ---------- Coesão/dissidência da bancada (legenda da imagem de votação) ----------
// Referência = a POSIÇÃO MAJORITÁRIA da própria bancada (nunca a orientação,
// que é decisão manual da Liderança e não entra em mensagem do bot).
// Coesão = maioria ÷ votantes efetivos (Sim/Não/Abstenção/Obstrução; Art. 17 e
// ausentes ficam fora da conta e são reportados à parte).
const ROTULO_VOTO = { sim: 'Sim', nao: 'Não', abstencao: 'Abstenção', obstrucao: 'Obstrução', art17: 'Art. 17' };

function legendaBancada(placar) {
  const bancada = placar.bancada || [];
  if (!bancada.length) return undefined;
  const efetivas = ['sim', 'nao', 'abstencao', 'obstrucao'];
  const votantes = bancada.filter(d => efetivas.includes(d.classe));
  const ausentes = bancada.filter(d => d.classe === 'ausente');
  const art17    = bancada.filter(d => d.classe === 'art17');

  // Contagem por classe, só entre as efetivas
  const cont = {};
  for (const d of votantes) cont[d.classe] = (cont[d.classe] || 0) + 1;
  const ordem = Object.entries(cont).sort((a, b) => b[1] - a[1]);

  const partes = [];
  const resumo = ordem.map(([c, n]) => `${n} ${ROTULO_VOTO[c]}`).join(' · ');
  partes.push(`👥 Bancada: ${resumo || 'sem votos'}` +
    (art17.length ? ` · ${art17.length} Art. 17` : '') +
    (ausentes.length ? ` · ${ausentes.length} ausente(s)` : ''));

  if (votantes.length >= 2 && ordem.length) {
    const [classeMaioria, nMaioria] = ordem[0];
    const empate = ordem.length > 1 && ordem[1][1] === nMaioria;
    if (empate) {
      partes.push('⚖️ Bancada dividida (empate entre posições).');
    } else {
      const coesao = Math.round((nMaioria / votantes.length) * 100);
      const dissidentes = votantes.filter(d => d.classe !== classeMaioria)
        .map(d => `${d.nome} (${ROTULO_VOTO[d.classe]})`);
      partes.push(`🤝 Coesão: ${coesao}%` +
        (dissidentes.length ? ` — divergiu: ${dissidentes.join(', ')}` : ' — bancada unida'));
    }
  }
  if (ausentes.length && ausentes.length <= 4) {
    partes.push(`🚶 Ausentes: ${ausentes.map(d => d.nome).join(', ')}`);
  }
  return partes.join('\n').slice(0, 1024);   // limite de caption do Telegram
}

// ---------- Descrição curta da matéria ----------
// Prioridade: APELIDO do SisPode (o nome que a equipe dá ao projeto) — da
// análise mais recente ou do item na pauta em uso. Só sem apelido nenhum cai
// na ementa da API, cortada em fronteira de palavra.
const _descrCache = new Map();

function cortarNaPalavra(s, n = 120) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const c = s.slice(0, n);
  const i = c.lastIndexOf(' ');
  return (i > n - 25 ? c.slice(0, i) : c) + '…';
}

async function descricaoCurta(ref) {
  if (!ref) return '';
  const k = `${ref.sigla}-${ref.numero}-${ref.ano}`;
  if (_descrCache.has(k)) return _descrCache.get(k);
  let out = '';
  // 1) apelido da análise mais recente no SisPode
  try {
    const a = await carregarAnaliseMaisRecente(k);
    if (a?.apelido) out = a.apelido;
  } catch (_) {}
  // 2) apelido gravado no item da pauta em uso (existe mesmo sem análise)
  if (!out) {
    try {
      const p = await pautaAtualImportada();
      const it = (p?.itens || []).find(x => x.chave === k);
      if (it?.apelido) out = it.apelido;
    } catch (_) {}
  }
  // 3) fallback: ementa da API, encurtada com corte limpo
  if (!out) {
    try {
      const r = await fetchTimeout(`${API}/proposicoes?siglaTipo=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}`, 8000);
      out = cortarNaPalavra((await r.json()).dados?.[0]?.ementa || '');
    } catch (_) {}
  }
  _descrCache.set(k, out);
  return out;
}

// ---------- Matéria EM DISCUSSÃO (página do evento) ----------
// O portal de votação só lista o item quando o presidente ABRE a votação; a
// fase de DISCUSSÃO aparece antes, no bloco "Propostas em análise" da página
// do evento — renderizado no servidor (validado ao vivo em 15/07, PL
// 3839/2024). Poll suave (30s), embutido no tick do painel.
const DISCUSSAO_MS = 30e3;
let _ultimaDiscussao = 0;

function materiasEmAnalise(html) {
  // ESCOPO obrigatório: a página usa a MESMA classe CSS nos itens da pauta
  // completa, mais abaixo — sem recortar a seção, anunciaríamos os ~20 itens
  // da pauta como "em discussão". O bloco vai do título até o próximo <h2>.
  const ini = String(html || '').search(/Propostas em an[áa]lise/i);
  if (ini === -1) return [];
  const resto = html.slice(ini);
  const fim = resto.slice(20).search(/<h2/i);
  const bloco = fim === -1 ? resto : resto.slice(0, 20 + fim);
  const out = [];
  const re = /item-pauta__proposicao">\s*([A-Z]{2,4})\s+([\d.]+)\/(\d{4})\s*<\/a>\s*(?:-\s*([^<]*))?/gi;
  let m;
  while ((m = re.exec(bloco)) !== null) {
    out.push({ sigla: m[1].toUpperCase(), numero: m[2].replace(/\./g, ''), ano: m[3], ementa: (m[4] || '').trim() });
  }
  return out;
}

async function checarDiscussao() {
  const s = _sessao;
  if (!s || Date.now() - _ultimaDiscussao < DISCUSSAO_MS) return;
  _ultimaDiscussao = Date.now();
  let html;
  try {
    const r = await fetchTimeout(`https://www.camara.leg.br/evento-legislativo/${s.id}`, 15000);
    if (!r.ok) return;
    html = await r.text();
  } catch (_) { return; }
  for (const mat of materiasEmAnalise(html)) {
    const chave = `${mat.sigla}-${mat.numero}-${mat.ano}`;
    if (s.estado.discutidos[chave]) continue;
    s.estado.discutidos[chave] = true;
    marcar(s.id, { [`discutidos/${chave}`]: true });
    const desc = (await descricaoCurta(mat)) || cortarNaPalavra(mat.ementa);
    await enviar(`Em discussão: *${mat.sigla} ${mat.numero}/${mat.ano}*${desc ? ` (${desc})` : ''}`, { md: true });
    console.log(`[monitor] discussão anunciada: ${chave}`);
  }
}

// ---------- Destaques: reconhecimento e formatação ----------
const REGEX_DESTAQUE = /DESTAQUE|\bDVS\b|\bDTQ\b|\bDVT\b/i;

// Siglas partidárias ficam como são (com a grafia consagrada do PCdoB);
// demais palavras da bancada ganham só a inicial maiúscula ("FDR" → "Fdr").
const _PARTIDOS = new Set(['PT', 'PL', 'PP', 'PV', 'MDB', 'PSD', 'PSB', 'PDT', 'PSDB', 'PSOL', 'PCDOB', 'PODE', 'NOVO', 'REDE', 'UNIÃO', 'UNIAO', 'PRD', 'AVANTE', 'CIDADANIA', 'SOLIDARIEDADE', 'REPUBLICANOS', 'PSC', 'PMB', 'DC', 'PRTB']);
function suavizarBancada(txt) {
  return String(txt || '').split(/(\s+|-)/).map(tok => {
    const up = tok.toUpperCase();
    if (up === 'PCDOB') return 'PCdoB';
    if (_PARTIDOS.has(up) || /^[\s-]*$/.test(tok)) return up.trim() ? up : tok;
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }).join('');
}
// "EMENDA DE PLENÁRIO N. 2" → "Emenda de Plenário n. 2"
function suavizarObjeto(txt) {
  const menores = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'ao', 'à', 'n.', 'nº', 'no']);
  return String(txt || '').toLowerCase().split(/\s+/).map((w, i) => {
    if (menores.has(w)) return w;
    if (/^\d/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}
const _ARTIGO_OBJ = { EMENDA: 'da', SUBEMENDA: 'da', EXPRESSÃO: 'da', PARTE: 'da', ALÍNEA: 'da', ARTIGO: 'do', PARÁGRAFO: 'do', INCISO: 'do', DISPOSITIVO: 'do', TEXTO: 'do' };

// "PL Nº 3085/2026 - DTQ 2 - FDR PT-PCDOB-PV - EMENDA DE PLENÁRIO N. 2 (Nominal)"
//   → "DTQ 2 - Fdr PT-PCdoB-PV - Destaque da Emenda de Plenário n. 2."
function linhaDoDestaque(rotulo) {
  let t = String(rotulo || '').replace(/\s*\((Nominal|Simb[óo]lica)\)\s*$/i, '').trim();
  const m = t.match(/\b(DTQ|DVS|DVT|DESTAQUE)\b/i);
  if (m) t = t.slice(t.search(/\b(DTQ|DVS|DVT|DESTAQUE)\b/i));   // corta a matéria-mãe
  const partes = t.split(/\s+-\s+/);
  if (partes.length >= 2) {
    const objBruto = partes[partes.length - 1].trim();
    const primeira = (objBruto.split(/\s+/)[0] || '').toUpperCase();
    const artigo = _ARTIGO_OBJ[primeira] || 'de';
    partes[partes.length - 1] = `Destaque ${artigo} ${suavizarObjeto(objBruto)}`;
    for (let i = 1; i < partes.length - 1; i++) partes[i] = suavizarBancada(partes[i]);
  }
  return partes.join(' - ').replace(/\.?$/, '.');
}

// ---------- Resultado de votação SIMBÓLICA (via Dados Abertos) ----------
// Padrão de rótulo de urgência no portal: "REQ Nº 3828/2026 - URGÊNCIA PARA
// APRECIAÇÃO DO PL 3085/2026 (Simbólica)".
const REGEX_URGENCIA = /URG[ÊE]NCIA\s+PARA\s+APRECIA[ÇC][ÃA]O\s+D[OA]\s+([A-Z]{2,4})\s*(?:Nº?\s*)?([\d.]+)\s*\/\s*(\d{4})/i;

// Primeira referência "SIGLA Nº NUM/ANO" do rótulo = a proposição VOTADA
// (na urgência é o REQ, não o PL alvo).
function refDoRotulo(rotulo) {
  const m = String(rotulo || '').match(/([A-Z]{2,4})\s*Nº?\s*([\d.]+)\s*\/\s*(\d{4})/i);
  return m ? { sigla: m[1].toUpperCase(), numero: m[2].replace(/\./g, ''), ano: m[3] } : null;
}

const _idPropCache = new Map();
async function idProposicao(ref) {
  const k = `${ref.sigla}-${ref.numero}-${ref.ano}`;
  if (_idPropCache.has(k)) return _idPropCache.get(k);
  let id = null;
  try {
    const r = await fetchTimeout(`${API}/proposicoes?siglaTipo=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}`, 8000);
    id = (await r.json()).dados?.[0]?.id || null;
  } catch (_) {}
  if (id) _idPropCache.set(k, id);   // não cacheia falha (API pode estar lenta)
  return id;
}

// O id da votação nos Dados Abertos é "{idProposicao}-{seq}" (validado ao vivo:
// REQ 3828/2026 id=2638803 → votação "2638803-7", aprovacao=1). ATENÇÃO: mérito,
// emendas e redação final da MESMA matéria compartilham o prefixo (id do PL) —
// a desambiguação é pela descrição oficial da votação.
function escolherVotacao(vs, idProp, rotulo) {
  const cands = (vs || []).filter(x => String(x.id || '').startsWith(`${idProp}-`));
  if (cands.length <= 1) return cands[0] || null;
  const r = String(rotulo || '');
  const quer =
    /EMENDAS?/i.test(r) ? /emendas?/i :
    /REDA[ÇC][ÃA]O\s+FINAL/i.test(r) ? /reda[çc][ãa]o\s+final/i :
    /URG[ÊE]NCIA/i.test(r) ? /urg[êe]ncia/i :
    /projeto|proposta|medida|decreto|resolu/i;   // mérito da matéria
  const pool = cands.filter(x => quer.test(x.descricao || ''));
  const lista = pool.length ? pool : cands;
  lista.sort((a, b) => String(b.dataHoraRegistro || '').localeCompare(String(a.dataHoraRegistro || '')));
  return lista[0];
}

async function checarResultadoSimbolico(s, itemId) {
  const reg = s?.estado?.itens?.[itemId];
  if (!reg || reg.resultadoAnunciado) return;
  const ref = refDoRotulo(reg.rotulo);
  if (!ref) return;
  const idProp = await idProposicao(ref);
  if (!idProp) return;
  const r = await fetchTimeout(`${API}/votacoes?idEvento=${s.id}&itens=100`, 10000);
  if (!r.ok) return;
  const v = escolherVotacao((await r.json()).dados, idProp, reg.rotulo);
  if (!v || v.aprovacao == null) return;   // resultado ainda não publicado — próxima tentativa
  reg.resultadoAnunciado = true;
  marcar(s.id, { [`itens/${itemId}/resultadoAnunciado`]: true });
  const aprovada = Number(v.aprovacao) === 1;
  // Ressalva oficial ("ressalvado o destaque", "ressalvados os destaques"),
  // copiada da descrição da votação — nunca inventada.
  const rm = String(v.descricao || '').match(/ressalvad[^.;]*/i);
  const ressalva = rm ? `, ${rm[0].trim()}` : '';
  const rot = String(reg.rotulo || '');
  const urg = rot.match(REGEX_URGENCIA);
  const mer = !urg && rot.match(/VOTA[ÇC][ÃA]O\s+D[OA]\s+([A-Z]{2,4})\s*(?:Nº?\s*)?([\d.]+)\s*\/\s*(\d{4})/i);
  if (urg) {
    const alvo = { sigla: urg[1].toUpperCase(), numero: urg[2].replace(/\./g, ''), ano: urg[3] };
    const desc = await descricaoCurta(alvo);
    await enviar(`${aprovada ? 'Aprovada' : 'Rejeitada'}, simbolicamente, a *urgência ao ${alvo.sigla} ${alvo.numero}/${alvo.ano}*${desc ? ` (${desc})` : ''}`, { md: true });
  } else if (mer) {
    // Mérito da matéria: "Aprovado, simbolicamente, o mérito *PL X/AAAA*
    // (apelido), ressalvado o destaque"
    const alvo = { sigla: mer[1].toUpperCase(), numero: mer[2].replace(/\./g, ''), ano: mer[3] };
    const desc = await descricaoCurta(alvo);
    await enviar(`${aprovada ? 'Aprovado' : 'Rejeitado'}, simbolicamente, o mérito *${alvo.sigla} ${alvo.numero}/${alvo.ano}*${desc ? ` (${desc})` : ''}${ressalva}`, { md: true });
  } else {
    // Demais itens: repassa a DESCRIÇÃO OFICIAL (gênero/plural sempre certos:
    // "Rejeitadas as Emendas de Plenário.").
    const oficial = String(v.descricao || '').trim().replace(/\.$/, '');
    await enviar(`Votação simbólica — *${oficial || (aprovada ? 'Aprovado' : 'Rejeitado')}*`, { md: true });
  }
}

// ---------- Estado persistido por sessão ----------
// ATENÇÃO: o RTDB não armazena objetos vazios — um estado salvo sem itens volta
// SEM a chave `itens`. Normalizar aqui é obrigatório: sem isso, após um reinício
// do bot, `est.itens[...]` explode em TypeError e o tick do painel morre em
// silêncio (foi exatamente o que engoliu a votação nominal de 07/07 às 20h27).
async function carregarEstado(eventoId) {
  let e = null;
  try { e = await fbGet(`/bot/monitor_sessao/${eventoId}`); } catch (_) {}
  e = e || {};
  return {
    inicioAnunciado:  !!e.inicioAnunciado,
    oddAnunciado:     !!e.oddAnunciado,
    oddOferecida:     !!e.oddOferecida,
    oddImportada:     !!e.oddImportada,
    oddFimAnunciado:  !!e.oddFimAnunciado,
    fimAnunciado:     !!e.fimAnunciado,
    resumoEnviado:    !!e.resumoEnviado,
    itens:            e.itens || {},
    discutidos:       e.discutidos || {},
  };
}
function marcar(eventoId, patch) {
  fbPatch(`/bot/monitor_sessao/${eventoId}`, patch).catch(() => {});
}
// Chamado pelo callback de confirmação (index.js) após importar a ODD, para
// o estado persistido refletir a importação (idempotência entre reinícios).
function marcarOddImportada(eventoId) { marcar(eventoId, { oddImportada: true }); }

// fetch com timeout (o fetch do Node não tem timeout padrão; sem isto um GET
// travado do Dados Abertos estanca o poll).
async function fetchTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// ---------- Poll de eventos (sessão começou/terminou) ----------
async function tickEventos() {
  if (!_cfg.ligado || !janelaAtiva()) return;
  try {
    const hoje = hojeSP();
    const r = await fetchTimeout(`${API}/eventos?dataInicio=${hoje}&dataFim=${hoje}&idOrgao=180&itens=30`);
    if (!r.ok) return;
    const eventos = ((await r.json()).dados || [])
      .filter(e => /deliberativa/i.test(e.descricaoTipo || '') && !/não\s+deliberativa/i.test(e.descricaoTipo || ''));

    // Sessão ativa terminou?
    if (_sessao) {
      const meu = eventos.find(e => String(e.id) === String(_sessao.id));
      // (O fim da ORDEM DO DIA é checado no laço rápido do painel, tickPainel.)
      if (meu && /encerrad|cancelad/i.test(meu.situacao || '')) return encerrarSessao();
    }
    // Nova sessão em andamento? (valor exato de `situacao` ao vivo: calibrar no ensaio)
    // Não reativa uma sessão que o cosev já encerrou (os Dados Abertos podem
    // seguir marcando "andamento" por lag depois do encerramento real).
    if (!_sessao) {
      const ativa = eventos.find(e => /andamento|iniciad/i.test(e.situacao || '') && !_encerradas.has(e.id));
      if (ativa) await ativarSessao(ativa);
    }
  } catch (e) {
    console.warn('[monitor] tick eventos falhou:', e.message);
  }
}

// Detecta o ENCERRAMENTO DA ORDEM DO DIA. Roda no laço RÁPIDO do painel (10s),
// então o aviso sai em segundos assim que o sinal surge na fonte — sem janela
// artificial. Dois sinais oficiais; o que vier primeiro dispara:
//
//  1) MARCADOR NA PAUTA (/eventos/{id}/pauta): quando sobra item não apreciado,
//     ele ganha "não apreciada em face do encerramento da Ordem do Dia". É o
//     sinal RÁPIDO (Dados Abertos atualiza em ~min) e cobre o caso comum. Por
//     isso é checado a CADA tick de 10s. Some apenas no caso "tudo votado".
//  2) NOTAS TAQUIGRÁFICAS (Escriba): a declaração do presidente "Declaro
//     encerrada a Ordem do Dia" (escriba-servicosweb/json/{id}). É o único que
//     cobre o caso "tudo votado", MAS o trecho só é transcrito ~30-40 min
//     depois de falado — a latência é da FONTE, não do bot; checar mais vezes
//     não adianta. Por isso um intervalo maior aqui só limita banda (~300 KB),
//     sem atrasar o aviso além do que a própria Câmara demora a publicar.
const ESCRIBA = 'https://escriba.camara.leg.br/escriba-servicosweb/json';
const CHECAR_NOTAS_MS = 60e3;  // Escriba é pesado; poll leve (latência é da fonte)

async function checarFimDaOdd() {
  const s = _sessao;
  if (!s) return;
  // PRIMÁRIO: o painel de presença público do app Infoleg expõe o booleano
  // indOrdemDoDiaEncerrada — instantâneo e confiável (inclusive no caso "tudo
  // votado"). Resolve o que antes dependia de heurística. Marcador da pauta e
  // notas taquigráficas ficam como fallback se o cosev estiver fora do ar.
  if (await oddEncerradaNoCosev() || await oddEncerradaNaPauta(s) || await oddEncerradaNasNotas(s)) {
    s.estado.oddFimAnunciado = true;
    marcar(s.id, { oddFimAnunciado: true });
    await enviar('*ENCERRADA A ORDEM DO DIA*', { md: true });
    // As votações terminam AQUI — o resumo já pode sair, sem esperar o fim da
    // sessão (que pode se arrastar em Breves Comunicações por muito tempo).
    agendarResumo(s, 'fim da ODD');
  }
}

// Sinal PRIMÁRIO do fim da ODD: booleano do painel público (app Infoleg).
async function oddEncerradaNoCosev() {
  try { const st = await statusPlenario(); return !!(st && st.oddEncerrada); }
  catch (_) { return false; }
}

// ---------- Abertura de sessão (cosev) → aviso de presença/inscrições ----------
// O painel público do app Infoleg expõe a sessão assim que ela abre (bem antes
// de a API de Dados Abertos marcar "Em Andamento"). Na abertura, presença e
// inscrições de oradores/breves comunicações passam a valer pelo Infoleg — é o
// que este aviso comunica ao grupo. Poll leve e dedicado (não depende do
// _sessao dos Dados Abertos, que é mais lento).
const COSEV_ABERTURA_MS = 12e3;
const QUORUM_MIN = 257;       // maioria absoluta (257 de 513) — quórum de deliberação
let _presencaSessao = null;   // numSessao com aviso de presença já enviado
let _quorumSessao = null;     // numSessao com aviso de quórum já enviado (ambos persistidos)

function marcarCosev(patch) { fbPatch('/bot/monitor_cosev', patch).catch(() => {}); }

// "EXTRAORDINÁRIA Nº 143 - 14/07/2026" → "EXTRAORDINÁRIA"
function tipoDoNomeSessao(nome) {
  const m = String(nome || '').match(/^\s*([A-Za-zÀ-ÿ ]+?)\s*N[ºo°]/);
  return (m ? m[1] : '').trim().toUpperCase();
}

// Ao subir, carrega a última sessão já anunciada; se JÁ houver sessão aberta
// neste momento (bot reiniciado no meio dela), registra sem anunciar — evita
// um aviso de presença atrasado. Só uma sessão que ABRE com o bot no ar dispara.
async function primingAbertura() {
  try { const v = await fbGet('/bot/monitor_cosev/presencaSessao'); if (v != null) _presencaSessao = v; } catch (_) {}
  try { const q = await fbGet('/bot/monitor_cosev/quorumSessao'); if (q != null) _quorumSessao = q; } catch (_) {}
  try {
    const sess = await sessaoAtual().catch(() => null);
    // Presença é evento PONTUAL: se a sessão já estava aberta quando o bot
    // subiu, registra sem anunciar (não faz sentido "abriu a presença" atrasado).
    if (sess && sess.aberta && sess.numSessao != null && sess.numSessao !== _presencaSessao) {
      _presencaSessao = sess.numSessao;
      marcarCosev({ presencaSessao: sess.numSessao });
    }
    // Quórum NÃO é priming-suprimido: é um ESTADO (a maioria está presente).
    // Se o bot subir com o quórum já batido e ainda não anunciado, o tickAbertura
    // deve avisar. A idempotência fica só no marcador persistido (quorumSessao),
    // gravado quando de fato anunciamos — evita repetir a cada reinício.
  } catch (_) {}
}

async function tickAbertura() {
  if (!_cfg.ligado || !janelaAtiva()) return;
  const [sess, st] = await Promise.all([sessaoAtual().catch(() => null), statusPlenario().catch(() => null)]);
  if (!sess || !sess.aberta || !sess.deliberativa) return;
  const num = sess.numSessao;
  if (num == null) return;

  // Abertura da sessão + aviso de presença/inscrições — uma vez por sessão.
  // São eventos distintos: a SESSÃO abre (segue em Breves Comunicações até a
  // ODD) e, com ela, abrem o registro de presença e as inscrições no Infoleg.
  if (num !== _presencaSessao) {
    _presencaSessao = num;
    marcarCosev({ presencaSessao: num });
    const tipo = tipoDoNomeSessao(sess.nome) || 'DELIBERATIVA';
    // Abertura do registro de presença e das inscrições (pelo Infoleg) — é o
    // que acontece PRIMEIRO na casa. Este é o gatilho certo (cosev vê a sessão
    // / presença começa a encher).
    await enviar(
      `📝 *ABERTO O REGISTRO DE PRESENÇA NA SESSÃO ${tipo}*\n\n` +
      `O registro de presença deve ser feito pelo INFOLEG APP\n\n` +
      `📝 *ABERTA AS INSCRIÇÕES DE ORADORES e para BREVES COMUNICAÇÕES*\n\n` +
      `As inscrições de oradores para os itens da pauta de hoje e para as breves comunicações devem ser feitas pelo INFOLEG APP`,
      { md: true });
    // A "ABERTA A SESSÃO" NÃO sai aqui: a abertura formal da sessão é um evento
    // POSTERIOR à abertura da presença, com gatilho próprio a ser calibrado ao
    // vivo (ver qual sinal do cosev/Dados Abertos marca o momento real).
    console.log(`[monitor] aviso de presença/inscrições enviado (sessão ${num}, ${tipo}).`);
  }

  // Aviso de QUÓRUM — uma vez por sessão, quando a presença atinge a maioria
  // absoluta (257). Mostra o número REAL do momento (a presença sobe em saltos).
  if (num !== _quorumSessao && st && st.presentes >= QUORUM_MIN) {
    _quorumSessao = num;
    marcarCosev({ quorumSessao: num });
    await enviar(`*Quórum: ${st.presentes} deputado(s) presente(s) na casa!*`, { md: true });
    console.log(`[monitor] aviso de quórum enviado (sessão ${num}, ${st.presentes} presentes).`);
  }
}

// Sinal RÁPIDO: itens não apreciados carimbados no fim da ODD (checado a cada tick).
async function oddEncerradaNaPauta(s) {
  try {
    const r = await fetchTimeout(`${API}/eventos/${s.id}/pauta`);
    if (!r.ok) return false;
    const dados = (await r.json()).dados || [];
    return dados.some(it =>
      /encerramento da ordem do dia/i.test(it.situacaoItem || it.situacao || ''));
  } catch (_) { return false; }
}

// Sinal ROBUSTO (caso "tudo votado"): o presidente declara "encerrada a Ordem
// do Dia" nas notas. Poll leve — a latência é da fonte (~30-40 min), não do bot.
async function oddEncerradaNasNotas(s) {
  const agora = Date.now();
  if (s._ultNota && agora - s._ultNota < CHECAR_NOTAS_MS) return false;
  s._ultNota = agora;
  try {
    const r = await fetchTimeout(`${ESCRIBA}/${s.id}`, 20000);
    if (!r.ok) return false;
    const dados = await r.json();
    const texto = (dados.quartos || []).map(q => q.texto || '').join(' ');
    // "encerrada a Ordem do Dia" é específico o bastante (a regex evita casar
    // com "encerramento da Copa..." e afins que aparecem em discursos).
    return /encerrad[ao]\s+a\s+ordem\s+do\s+dia/i.test(texto);
  } catch (_) { return false; }
}

async function ativarSessao(ev) {
  const estado = await carregarEstado(ev.id);
  // Já encerrada (sinal do cosev neste processo, ou fim persistido de um
  // reinício)? Não reabre — evita o loop de reativação por lag dos Dados Abertos.
  if (_encerradas.has(ev.id) || estado.fimAnunciado) { _encerradas.add(ev.id); return; }
  _sessao = {
    id: ev.id, dataISO: String(ev.dataHoraInicio || hojeSP()).slice(0, 10),
    estado, falhasPainel: 0, avisoFalhaDado: false, tickando: false,
  };
  console.log(`[monitor] sessão ${ev.id} ativa (${ev.descricaoTipo})`);
  // ABERTURA FORMAL da sessão (o "martelo"). Calibrado ao vivo em 14/07: o
  // push do Infoleg "Início de Sessão Deliberativa às 15:55" bateu com o
  // evento dos Dados Abertos virando "Em Andamento" (15:55) — enquanto o
  // cosev NÃO mudou nada (segue a mesma sessão do painel desde a manhã).
  // Logo: presença/inscrições = cosev (tickAbertura); ABERTA A SESSÃO = aqui.
  if (!estado.inicioAnunciado) {
    const desc = `${ev.descricao || ''} ${ev.descricaoTipo || ''}`;
    const tipoSessao = /extraordin/i.test(desc) ? 'EXTRAORDINÁRIA'
      : /\bordin[áa]ri/i.test(desc) ? 'ORDINÁRIA' : 'DELIBERATIVA';
    await enviar(
      `*ABERTA A SESSÃO ${tipoSessao}*\n\n` +
      'A sessão seguirá com as Breves Comunicações até o início da Ordem do Dia.',
      { md: true });
    estado.inicioAnunciado = true;
    marcar(ev.id, { inicioAnunciado: true, dataISO: _sessao.dataISO, tipo: ev.descricaoTipo || '' });
  }

  // OFERECE importar a Ordem do Dia do evento (pauta DIÁRIA). O write fica
  // GATED por confirmação (botão); ao importar, vira a pauta de referência do
  // dia — nó próprio 'odd-YYYY-MM-DD', sem tocar na semanal. Oferta única/sessão.
  if (!estado.oddImportada && !estado.oddOferecida) {
    estado.oddOferecida = true;
    marcar(ev.id, { oddOferecida: true });
    const destino = _cfg.destino();
    if (destino) {
      const kb = new InlineKeyboard().text('📥 Importar Ordem do Dia', `oddimp:${ev.id}:${_sessao.dataISO}`);
      _cfg.api.sendMessage(destino,
        '📋 Importar a *Ordem do Dia de hoje* como pauta de referência no SisPode? ' +
        'É a pauta do dia (mais precisa que a semanal) e reaproveita as análises já feitas.',
        { parse_mode: 'Markdown', reply_markup: kb })
        .catch(e => console.warn('[monitor] oferta de ODD falhou:', e.message));
    }
  }

  clearInterval(_timerPainel);
  _timerPainel = setInterval(tickPainel, POLL_PAINEL_MS);
  tickPainel();
}

// ---------- Poll do painel (itens, aberturas, encerramentos) ----------
async function tickPainel() {
  if (!_sessao || _sessao.tickando || !_cfg.ligado) return;
  _sessao.tickando = true;
  try {
    // FIM DA SESSÃO — PRIMÁRIO pelo cosev: quando o painel público deixa de
    // reportar sessão aberta, a sessão encerrou. Mais rápido que os Dados
    // Abertos (fallback em tickEventos). Só age no sinal EXPLÍCITO (aberta:
    // false); null = cosev indisponível, não conclui nada. Duas leituras
    // seguidas evitam encerrar por um blip momentâneo.
    const sc = await sessaoAtual().catch(() => null);
    if (sc && sc.aberta === false) {
      _sessao._fimSeguidos = (_sessao._fimSeguidos || 0) + 1;
      if (_sessao._fimSeguidos >= 2) { _sessao.tickando = false; return encerrarSessao(); }
    } else if (sc && sc.aberta === true) {
      _sessao._fimSeguidos = 0;
    }

    const html = await paginaSessao(_sessao.id);
    _sessao.falhasPainel = 0;
    const itens = parseItens(html);
    const est = _sessao.estado;

    // Início da ODD: PRIMÁRIO é o booleano indOrdemDoDiaIniciada do painel
    // público (app Infoleg) — mais confiável que "apareceram itens no portal",
    // que fica como fallback.
    if (!est.oddAnunciado) {
      const st = await statusPlenario().catch(() => null);
      if ((st && st.oddIniciada) || itens.length) {
        await enviar('*INICIADA A ORDEM DO DIA*', { md: true });
        est.oddAnunciado = true;
        marcar(_sessao.id, { oddAnunciado: true });
      }
    }

    for (const item of itens) {
      try {
      // DESTAQUE (DTQ/DVS/DVT)? Entra nos fluxos normais (anúncio + placar da
      // nominal), com formatação própria e a EXPLICAÇÃO do módulo de Destaques
      // embutida quando a equipe preparou material (sem voto sim/não, sem
      // orientação). O rótulo real do portal usa "DTQ" — o filtro antigo só
      // conhecia "DESTAQUE/DVS" e deixava o destaque cair no fluxo genérico.
      const ehDestaque = REGEX_DESTAQUE.test(item.rotulo);
      let explicDestaque = '';
      if (ehDestaque) {
        const reg0 = est.itens[item.id] || (est.itens[item.id] = {});
        if (reg0._explic === undefined) {
          try {
            const ficha = await buscarDestaquePreparado({ rotulo: item.rotulo, dataISO: _sessao.dataISO });
            reg0._explic = (ficha?.explicacao || '').trim();
          } catch (e) { reg0._explic = ''; console.warn('[monitor] módulo de Destaques falhou:', e.message); }
        }
        explicDestaque = reg0._explic ? `\n\n${reg0._explic}` : '';
      }

      // Simbólicas: sem placar (não há voto individual), mas ANUNCIA uma vez
      // cada item que entra em apreciação. Urgência e destaque têm formato próprio.
      if (!item.nominal) {
        const reg = est.itens[item.id] || (est.itens[item.id] = {});
        if (!reg.anunciado) {
          reg.anunciado = true;
          reg.simbolico = true;
          marcar(_sessao.id, { [`itens/${item.id}/anunciado`]: true, [`itens/${item.id}/simbolico`]: true, [`itens/${item.id}/rotulo`]: item.rotulo });
          const urg = item.rotulo.match(REGEX_URGENCIA);
          if (ehDestaque) {
            await enviar(`*VOTAÇÃO SIMBÓLICA:*\n${linhaDoDestaque(item.rotulo)}${explicDestaque}`, { md: true });
          } else if (urg) {
            const ref = { sigla: urg[1].toUpperCase(), numero: urg[2].replace(/\./g, ''), ano: urg[3] };
            const desc = await descricaoCurta(ref);
            await enviar(`Anunciada a *urgência ao ${ref.sigla} ${ref.numero}/${ref.ano}*${desc ? ` (${desc})` : ''}`, { md: true });
          } else {
            const ident = identificarItem(item.rotulo);
            const desc = await descricaoCurta(ident.ref);
            await enviar(`Anunciado o item: ${ident.texto}${desc ? ` (${desc})` : ''}`, { md: true });
          }
        }
        continue;
      }
      const reg = est.itens[item.id] || (est.itens[item.id] = {});
      const ident = identificarItem(item.rotulo);

      // Abertura (D2 + formato P1, SEM orientação — decisão da Liderança é manual)
      if (!reg.abertura) {
        if (ehDestaque) {
          await enviar(`*VOTAÇÃO NOMINAL:*\n${linhaDoDestaque(item.rotulo)}${explicDestaque}`, { md: true });
        } else {
          const desc = await descricaoCurta(ident.ref);
          await enviar(`*VOTAÇÃO NOMINAL*\n\n${ident.texto}${desc ? ` (${desc})` : ''}`, { md: true });
        }
        reg.abertura = true;
        marcar(_sessao.id, { [`itens/${item.id}/abertura`]: true, [`itens/${item.id}/rotulo`]: item.rotulo });
      }

      // Encerramento: votos individuais publicados no painel
      if (reg.abertura && !reg.encerramento) {
        const htmlItem = await paginaSessao(_sessao.id, item.id);
        const doItem = parseItens(htmlItem);
        const sel = doItem.find(i => i.selecionado);
        if (sel && sel.id !== item.id) {
          // A página ignorou o parâmetro itemVotacao — ponto de calibração do ensaio
          console.warn(`[monitor] painel renderizou item ${sel.id} em vez de ${item.id} — pulando este tick`);
          continue;
        }
        const placar = await parsePlacarPortal(htmlItem, {
          descricao: ident.texto.replace(/\*/g, ''),
        });
        if (placar.temVotos) {
          const png = await imagemVotacao(placar);
          // A imagem traz os dados brutos (título, placar global, bancada);
          // a legenda acrescenta a LEITURA POLÍTICA: coesão da bancada e quem
          // divergiu da posição majoritária (sem falar em orientação — a
          // referência é a própria maioria da bancada).
          await enviarFoto(png, legendaBancada(placar));
          reg.encerramento = true;
          marcar(_sessao.id, { [`itens/${item.id}/encerramento`]: true });
        }
      }
      } catch (eItem) {
        // Um item com problema não pode calar os demais nem os próximos ticks.
        console.warn(`[monitor] item ${item.id} falhou neste tick:`, eItem.message);
      }
    }

    // Matéria em DISCUSSÃO (fase anterior à abertura da votação no portal) —
    // anunciada a partir da página do evento, com throttle próprio de 30s.
    await checarDiscussao().catch(e => console.warn('[monitor] discussão falhou:', e.message));

    // RESULTADO das simbólicas: quando um item simbólico anunciado SOME do
    // portal, a apreciação terminou — o resultado (campo `aprovacao`) sai nos
    // Dados Abertos minutos depois. Agenda checagens escalonadas.
    const idsNoPortal = new Set(itens.map(i => String(i.id)));
    for (const [itemId, reg] of Object.entries(est.itens)) {
      if (reg.simbolico && reg.anunciado && !reg.resultadoAnunciado
          && !idsNoPortal.has(String(itemId)) && !reg._resAgendado) {
        reg._resAgendado = true;
        const s = _sessao;
        for (const ms of [15e3, 60e3, 180e3, 420e3]) {
          setTimeout(() => checarResultadoSimbolico(s, itemId).catch(e =>
            console.warn('[monitor] resultado simbólico falhou:', e.message)), ms);
        }
      }
    }

    // Fim da ORDEM DO DIA — no laço RÁPIDO (10s), sem janela: assim o aviso sai
    // em segundos assim que o sinal aparece na fonte, não em minutos.
    if (est.oddAnunciado && !est.oddFimAnunciado) {
      await checarFimDaOdd().catch(() => {});
    }
  } catch (e) {
    _sessao.falhasPainel++;
    console.warn(`[monitor] tick painel falhou (${_sessao.falhasPainel}x):`, e.message);
    if (_sessao.falhasPainel >= 5 && !_sessao.avisoFalhaDado && _cfg.admin) {
      _sessao.avisoFalhaDado = true;
      _cfg.api.sendMessage(_cfg.admin,
        `⚠️ Monitor: não consigo ler o painel da sessão ${_sessao.id} há ${_sessao.falhasPainel} tentativas (${e.message}). Sigo tentando.`)
        .catch(() => {});
    }
  } finally {
    if (_sessao) _sessao.tickando = false;
  }
}

// ---------- Fim de sessão → resumo (mesma mensagem do botão do painel) ----------
async function encerrarSessao() {
  const s = _sessao;
  _sessao = null;
  _encerradas.add(s.id);          // trava contra reativação por lag dos Dados Abertos
  clearInterval(_timerPainel);
  _timerPainel = null;
  console.log(`[monitor] sessão ${s.id} encerrada — agendando resumo`);
  // Backstop do fim da ORDEM DO DIA: o sinal oficial e tempestivo é o marcador
  // "não apreciada em face do encerramento da Ordem do Dia" nos itens não
  // votados (checarFimDaOdd, no tick). Mas se TODOS os itens foram votados,
  // nenhum item recebe o marcador e a ODD encerra sem gatilho. Nesse caso raro,
  // a ODD terminou de fato — anunciamos aqui, junto do fim da sessão, para o
  // aviso nunca se perder em silêncio. NÃO é usar o fim da sessão como fim da
  // ODD (a sessão pode seguir em Breves Comunicações): é só a rede de segurança
  // do caso "tudo votado", quando as duas coisas de fato coincidem.
  if (s.estado.oddAnunciado && !s.estado.oddFimAnunciado) {
    await enviar('*ENCERRADA A ORDEM DO DIA*', { md: true });
    s.estado.oddFimAnunciado = true;
    marcar(s.id, { oddFimAnunciado: true });
  }
  // Mensagem 1 — o encerramento em si, NA HORA (o resumo vem em seguida,
  // quando os Dados Abertos publicarem). Idempotente entre reinícios.
  if (!s.estado.fimAnunciado) {
    await enviar('*ENCERRADA A SESSÃO*', { md: true });
    s.estado.fimAnunciado = true;
    marcar(s.id, { fimAnunciado: true });
  }
  // Mensagem 2 — o resumo das votações. Normalmente já foi agendado no FIM DA
  // ODD; aqui é a rede de segurança (ODD encerrada sem gatilho, reinício do
  // bot entre a ODD e o fim da sessão…). agendarResumo não duplica.
  agendarResumo(s, 'fim da sessão');
}

// Agenda as tentativas do resumo (0/5/10 min — os Dados Abertos levam alguns
// minutos para consolidar os placares). Disparado no FIM DA ODD (quando as
// votações de fato terminam) e reforçado no fim da sessão. A trava em memória
// evita agendar duas vezes no mesmo processo; resumoEnviado (persistido)
// evita reenvio entre reinícios.
function agendarResumo(s, origem) {
  if (s.estado.resumoEnviado || s._resumoAgendado) return;
  s._resumoAgendado = true;
  console.log(`[monitor] resumo agendado (${origem}) — tentativas em ${RESUMO_TENTATIVAS_MIN.join('/')} min`);
  for (let i = 0; i < RESUMO_TENTATIVAS_MIN.length; i++) {
    setTimeout(() => tentarResumo(s, i), RESUMO_TENTATIVAS_MIN[i] * 60e3);
  }
}

async function tentarResumo(s, tentativa) {
  if (s.estado.resumoEnviado) return;
  try {
    const pauta = await pautaAtualImportada().catch(() => null);
    const r = await resumoSessao({ pautaId: pauta?.id || null, dataISO: s.dataISO });
    if (r.vazio) {
      if (tentativa === RESUMO_TENTATIVAS_MIN.length - 1) {
        await enviar(`ℹ️ A Câmara ainda não registrou as matérias apreciadas de ${s.dataISO.split('-').reverse().join('/')}. Peça depois com /resumo ${s.dataISO.split('-').reverse().join('/')} (ou pelo painel, botão "Resultado da Sessão").`);
      }
      return;
    }
    // ENVIA PRIMEIRO (com retry rápido de 5s/10s), marca depois: se todo o
    // envio falhar, o erro cai no catch e as tentativas de dados (+5/+10 min)
    // continuam valendo. Marcar antes queimava as tentativas com a flag no
    // Firebase e o resumo se perdia em silêncio (sessão de 07/07).
    // Texto idêntico ao do painel (negrito estilo WhatsApp) — sem parse_mode,
    // para a equipe copiar/encaminhar ao WhatsApp sem retoque.
    let enviado = false, ultErr = null;
    for (const espera of [0, 5000, 10000]) {
      if (espera) await new Promise(res => setTimeout(res, espera));
      try { await enviarOuFalhar(r.texto); enviado = true; break; }
      catch (e) { ultErr = e; console.warn('[monitor] envio do resumo falhou (retry):', e.message); }
    }
    if (!enviado) throw ultErr;
    s.estado.resumoEnviado = true;
    marcar(s.id, { resumoEnviado: true });
  } catch (e) {
    console.warn(`[monitor] resumo (tentativa ${tentativa + 1}) falhou:`, e.message);
    if (tentativa === RESUMO_TENTATIVAS_MIN.length - 1 && _cfg.admin) {
      _cfg.api.sendMessage(_cfg.admin, `⚠️ Monitor: o resumo da sessão de ${s.dataISO} falhou nas ${RESUMO_TENTATIVAS_MIN.length} tentativas (${e.message}).`).catch(() => {});
    }
  }
}

// ---------- API do módulo ----------
function iniciarMonitor(cfg) {
  _cfg = { ...cfg, ligado: cfg.ligadoInicial !== false };
  clearInterval(_timerEv);
  _timerEv = setInterval(tickEventos, POLL_EVENTOS_MS);
  tickEventos();
  // Aviso de presença/inscrições pela abertura da sessão no cosev (poll próprio).
  clearInterval(_timerAbertura);
  primingAbertura().finally(() => {
    _timerAbertura = setInterval(tickAbertura, COSEV_ABERTURA_MS);
  });
  console.log(`[monitor] ligado (${_cfg.ensaio() ? 'MODO ENSAIO — mensagens só para o admin' : 'produção — grupo'})`);
}

function setMonitorLigado(v) {
  _cfg.ligado = !!v;
  if (!v && _sessao) { clearInterval(_timerPainel); _timerPainel = null; _sessao = null; }
}

function statusMonitor() {
  return {
    ligado: !!_cfg?.ligado,
    ensaio: !!_cfg?.ensaio(),
    janelaAtiva: janelaAtiva(),
    sessao: _sessao ? {
      id: _sessao.id, dataISO: _sessao.dataISO,
      itens: Object.keys(_sessao.estado.itens).length,
      encerrados: Object.values(_sessao.estado.itens).filter(i => i.encerramento).length,
    } : null,
  };
}

module.exports = { iniciarMonitor, setMonitorLigado, statusMonitor, marcarOddImportada };
