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
const { importarOrdemDoDia } = require('./odd');

const API = 'https://dadosabertos.camara.leg.br/api/v2';
const POLL_EVENTOS_MS = 60e3;
const POLL_PAINEL_MS  = 20e3;
const RESUMO_TENTATIVAS_MIN = [0, 30, 60];

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

async function enviar(texto, { md = false } = {}) {
  const destino = _cfg.destino();
  if (!destino) { console.warn('[monitor] sem destino configurado — mensagem descartada'); return; }
  if (md) {
    // Negrito Telegram (*texto*); se algum rótulo quebrar o parse, cai p/ texto puro
    try { return await _cfg.api.sendMessage(destino, texto, { parse_mode: 'Markdown' }); }
    catch (_) { /* fallback abaixo */ }
  }
  return _cfg.api.sendMessage(destino, texto).catch(e => console.warn('[monitor] envio falhou:', e.message));
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
  return _cfg.api.sendPhoto(destino, new InputFile(foto, 'votacao.png'), { caption })
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
      const r = await fetch(`${API}/proposicoes?siglaTipo=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}`);
      const em = (await r.json()).dados?.[0]?.ementa || '';
      out = em.replace(/\s+/g, ' ').slice(0, 140);
    } catch (_) {}
  }
  _descrCache.set(k, out);
  return out;
}

// ---------- Estado persistido por sessão ----------
async function carregarEstado(eventoId) {
  let e = null;
  try { e = await fbGet(`/bot/monitor_sessao/${eventoId}`); } catch (_) {}
  return e || { inicioAnunciado: false, oddAnunciado: false, itens: {}, resumoEnviado: false };
}
function marcar(eventoId, patch) {
  fbPatch(`/bot/monitor_sessao/${eventoId}`, patch).catch(() => {});
}

// ---------- Poll de eventos (sessão começou/terminou) ----------
async function tickEventos() {
  if (!_cfg.ligado || !janelaAtiva()) return;
  try {
    const hoje = hojeSP();
    const r = await fetch(`${API}/eventos?dataInicio=${hoje}&dataFim=${hoje}&idOrgao=180&itens=30`);
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
    const hora = String(ev.dataHoraInicio || '').slice(11, 16);
    await enviar(`🟢 *${ev.descricaoTipo || 'Sessão Deliberativa'}* iniciada no Plenário${hora ? ` às ${hora}` : ''}.`, { md: true });
    estado.inicioAnunciado = true;
    marcar(ev.id, { inicioAnunciado: true, dataISO: _sessao.dataISO, tipo: ev.descricaoTipo || '' });
  }

  // Importa a Ordem do Dia do evento (pauta DIÁRIA) — passa a ser a pauta de
  // referência do dia no SisPode. Idempotente por sessão; grava um nó próprio
  // ('odd-YYYY-MM-DD'), sem tocar na pauta semanal.
  if (!estado.oddImportada) {
    try {
      const doc = await importarOrdemDoDia({ eventoId: ev.id, dataISO: _sessao.dataISO, uploadedBy: 'bot-monitor' });
      if (doc) {
        estado.oddImportada = true;
        marcar(ev.id, { oddImportada: true });
        await enviar(
          `📋 *Ordem do Dia importada* (${(doc.itens || []).length} itens) — ` +
          'agora é a pauta de referência do dia no SisPode (/perguntar, /listar, /analisar, /exportar).',
          { md: true });
      }
    } catch (e) {
      console.warn('[monitor] falha ao importar a Ordem do Dia:', e.message);
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
      await enviar('📋 *Ordem do Dia iniciada* — acompanhando as votações.', { md: true });
      est.oddAnunciado = true;
      marcar(_sessao.id, { oddAnunciado: true });
    }

    for (const item of itens) {
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
          const p = placar.parcial, g = placar.global;
          await enviarFoto(png,
            `✅ Votado — ${ident.texto.replace(/\*/g, '')}\n` +
            `Sim ${g.sim} · Não ${g.nao}${g.abstencao ? ` · Abst. ${g.abstencao}` : ''} (quórum ${placar.quorum})\n` +
            `Bancada PODE: ${p.sim} Sim / ${p.nao} Não` +
            `${p.abstencao ? ` / ${p.abstencao} Abst.` : ''}${p.ausente ? ` / ${p.ausente} Aus.` : ''}`);
          reg.encerramento = true;
          marcar(_sessao.id, { [`itens/${item.id}/encerramento`]: true });
        }
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
        await enviar(`ℹ️ Sessão encerrada — a Câmara ainda não registrou matérias apreciadas em ${s.dataISO.split('-').reverse().join('/')}. Gere depois pelo painel (botão "Resultado da Sessão").`);
      }
      return;
    }
    s.estado.resumoEnviado = true;
    marcar(s.id, { resumoEnviado: true });
    // Texto idêntico ao do painel (negrito estilo WhatsApp) — sem parse_mode,
    // para a equipe copiar/encaminhar ao WhatsApp sem retoque.
    await enviar(r.texto);
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

module.exports = { iniciarMonitor, setMonitorLigado, statusMonitor };
