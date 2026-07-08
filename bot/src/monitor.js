'use strict';
// Monitor de Sessão ao Vivo do Plenário.
//   OCIOSO  → poll /eventos (60 s, janela útil) → sessão deliberativa Em Andamento
//   SESSÃO  → poll do painel (20 s): Ordem do Dia, abertura de nominais,
//             encerramento (votos individuais publicados) → imagem + mensagem
//   FIM     → resumo da sessão via worker (tentativas 0/+30/+60 min)
// Mensagens vão ao GRUPO (produção) ou só ao admin (MONITOR_ENSAIO=1).
// Idempotência entre reinícios: /bot/monitor_sessao/{eventoId} no Firebase.
const { fbGet, fbPatch } = require('./firebase');
const { paginaSessao, parseItens, parsePlacarPortal, identificarItem } = require('./portal');
const { imagemVotacao } = require('./imagem');
const { resumoSessao } = require('./worker');
const { pautaAtualImportada } = require('./pauta');
const { carregarAnaliseMaisRecente } = require('./perguntar');
const { buscarDestaquePreparado, mensagemDestaque } = require('./destaques');
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
let _timerEv = null, _timerPainel = null;

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

// ---------- Descrição curta da matéria (apelido da análise → ementa da API) ----------
const _descrCache = new Map();
async function descricaoCurta(ref) {
  if (!ref) return '';
  const k = `${ref.sigla}-${ref.numero}-${ref.ano}`;
  if (_descrCache.has(k)) return _descrCache.get(k);
  let out = '';
  try {
    const a = await carregarAnaliseMaisRecente(k);
    if (a?.apelido) out = a.apelido;
  } catch (_) {}
  if (!out) {
    try {
      const r = await fetchTimeout(`${API}/proposicoes?siglaTipo=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}`, 8000);
      const em = (await r.json()).dados?.[0]?.ementa || '';
      out = em.replace(/\s+/g, ' ').slice(0, 140);
    } catch (_) {}
  }
  _descrCache.set(k, out);
  return out;
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
    inicioAnunciado: !!e.inicioAnunciado,
    oddAnunciado:    !!e.oddAnunciado,
    oddOferecida:    !!e.oddOferecida,
    oddImportada:    !!e.oddImportada,
    fimAnunciado:    !!e.fimAnunciado,
    resumoEnviado:   !!e.resumoEnviado,
    itens:           e.itens || {},
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
      if (meu && /encerrad|cancelad/i.test(meu.situacao || '')) return encerrarSessao();
    }
    // Nova sessão em andamento? (valor exato de `situacao` ao vivo: calibrar no ensaio)
    if (!_sessao) {
      const ativa = eventos.find(e => /andamento|iniciad/i.test(e.situacao || ''));
      if (ativa) await ativarSessao(ativa);
    }
  } catch (e) {
    console.warn('[monitor] tick eventos falhou:', e.message);
  }
}

async function ativarSessao(ev) {
  const estado = await carregarEstado(ev.id);
  _sessao = {
    id: ev.id, dataISO: String(ev.dataHoraInicio || hojeSP()).slice(0, 10),
    estado, falhasPainel: 0, avisoFalhaDado: false, tickando: false,
  };
  console.log(`[monitor] sessão ${ev.id} ativa (${ev.descricaoTipo})`);
  if (!estado.inicioAnunciado) {
    // Ordinária/Extraordinária vem no `descricao` (o descricaoTipo é só
    // "Sessão Deliberativa"); cai para "DELIBERATIVA" se não especificar.
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
    const html = await paginaSessao(_sessao.id);
    _sessao.falhasPainel = 0;
    const itens = parseItens(html);
    const est = _sessao.estado;

    if (itens.length && !est.oddAnunciado) {
      await enviar('*INICIADA A ORDEM DO DIA*', { md: true });
      est.oddAnunciado = true;
      marcar(_sessao.id, { oddAnunciado: true });
    }

    for (const item of itens) {
      try {
      // Destaques/DVS (nominais ou simbólicos): o bot NÃO entra na votação
      // (sem mensagem de abertura P1, sem imagem). Exceção controlada: se a
      // equipe PREPAROU material no módulo de Destaques (explicação/voto
      // sim/voto não), publica a ficha — sem orientação — no grupo + admin.
      if (/DESTAQUE|\bDVS\b/i.test(item.rotulo)) {
        const reg = est.itens[item.id] || (est.itens[item.id] = {});
        if (!reg.destaqueVisto) {
          reg.destaqueVisto = true;
          marcar(_sessao.id, { [`itens/${item.id}/destaqueVisto`]: true, [`itens/${item.id}/rotulo`]: item.rotulo });
          try {
            const ficha = await buscarDestaquePreparado({ rotulo: item.rotulo, dataISO: _sessao.dataISO });
            if (ficha?.temMaterial) {
              await enviarComCopiaAdmin(mensagemDestaque(ficha));
            } else {
              console.log(`[monitor] destaque sem material preparado (silêncio): ${item.rotulo}`);
            }
          } catch (e) {
            console.warn('[monitor] consulta ao módulo de Destaques falhou:', e.message);
          }
        }
        continue;
      }
      if (!item.nominal) continue;                       // D3: simbólicas em silêncio
      const reg = est.itens[item.id] || (est.itens[item.id] = {});
      const ident = identificarItem(item.rotulo);

      // Abertura (D2 + formato P1, SEM orientação — decisão da Liderança é manual)
      if (!reg.abertura) {
        const desc = await descricaoCurta(ident.ref);
        await enviar(`*VOTAÇÃO NOMINAL*\n\n${ident.texto}${desc ? ` (${desc})` : ''}`, { md: true });
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
          // SÓ a imagem — ela já traz todos os dados da votação (título,
          // placar global, bancada e parlamentares); sem legenda escrita.
          await enviarFoto(png);
          reg.encerramento = true;
          marcar(_sessao.id, { [`itens/${item.id}/encerramento`]: true });
        }
      }
      } catch (eItem) {
        // Um item com problema não pode calar os demais nem os próximos ticks.
        console.warn(`[monitor] item ${item.id} falhou neste tick:`, eItem.message);
      }
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
  clearInterval(_timerPainel);
  _timerPainel = null;
  console.log(`[monitor] sessão ${s.id} encerrada — agendando resumo`);
  // Mensagem 1 — o encerramento em si, NA HORA (o resumo vem em seguida,
  // quando os Dados Abertos publicarem). Idempotente entre reinícios.
  if (!s.estado.fimAnunciado) {
    await enviar('🔴 *ENCERRADA A SESSÃO*', { md: true });
    s.estado.fimAnunciado = true;
    marcar(s.id, { fimAnunciado: true });
  }
  // Mensagem 2 — o resumo das votações
  if (s.estado.resumoEnviado) return;
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
