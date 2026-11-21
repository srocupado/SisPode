// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
'use strict';
// Worker de painel — o bot sobe um Chromium invisível COM A EXTENSÃO SisPode
// carregada e comanda o módulo "Análise de Pauta" por dentro (page.evaluate),
// executando o MESMO código do painel: gerar análises, montar o HTML de
// impressão etc. Zero alteração na extensão; zero divergência de resultado.
//
// ⚠ API implícita: este worker chama funções internas do analise.js pelo nome
//   (carregarPautaPorId, gerarTodasAsAnalises, _htmlImpressaoPautaPlenario,
//   prepararApelidos, carregarLogoDataUrl, carregarConfig, state,
//   _gerarTodasState). validarApiPainel() confere todas ao abrir e falha com
//   mensagem clara se a extensão tiver mudado.
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

// Pasta da EXTENSÃO SisPode (manifest.json, analise.html…). Padrão: a pasta-mãe
// da pasta do bot (raiz do repo). Se o bot estiver instalado separado da
// extensão, aponte BOT_EXT_DIR no .env para a pasta onde a extensão está.
const EXT_DIR  = path.resolve(process.env.BOT_EXT_DIR || path.join(__dirname, '..', '..'));
const PAGED_JS = path.join(EXT_DIR, 'libs', 'paged.polyfill.js');  // paginador do PDF

const FUNCOES_PAINEL = [
  'carregarPautaPorId', 'gerarTodasAsAnalises', '_htmlImpressaoPautaPlenario',
  'prepararApelidos', 'carregarLogoDataUrl', 'carregarConfig',
  'abrirItemAvulso', 'gerarAnaliseItem', 'tituloComApelido',   // nota avulsa (/avulsa)
  'verificarAtualizacaoItem', '_resumoNovos',
];

let _browser = null;

async function abrirNavegador() {
  if (_browser && _browser.connected) return _browser;
  // Confere ANTES de subir: sem manifest.json, o Chromium abriria sem a
  // extensão e o erro ("extensão não subiu") esconderia a causa real.
  if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json'))) {
    throw new Error(
      `Extensão SisPode não encontrada em "${EXT_DIR}" (sem manifest.json). ` +
      'Coloque os arquivos da extensão na pasta-mãe da pasta do bot, ou aponte ' +
      'BOT_EXT_DIR no .env para a pasta da extensão.');
  }
  const args = [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
  ];
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-setuid-sandbox');
  // Ambientes atrás de proxy corporativo: repassa o proxy do processo ao
  // Chromium (o Node usa HTTPS_PROXY automaticamente; o Chrome não).
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`);
  if (process.env.BOT_WORKER_IGNORAR_CERT === '1') args.push('--ignore-certificate-errors');
  _browser = await puppeteer.launch({
    // BOT_WORKER_VISIVEL=1 → janela visível (diagnóstico, ou se o headless da
    // versão de Chromium instalada não aceitar extensões)
    headless: process.env.BOT_WORKER_VISIVEL === '1' ? false : true,
    args,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 300000,
  });
  return _browser;
}

async function fecharNavegador() {
  const b = _browser;
  _browser = null;
  if (b) await b.close().catch(() => {});
}

// O id da extensão descarregada muda por instalação — descobre pelo alvo
// chrome-extension:// (service worker do MV3 sobe junto com o navegador).
async function acharExtensionId(browser) {
  const alvo = await browser
    .waitForTarget(t => t.url().startsWith('chrome-extension://'), { timeout: 20000 })
    .catch(() => null);
  if (!alvo) {
    throw new Error(
      'A extensão não subiu no Chromium do worker. Se o headless desta versão ' +
      'não aceitar extensões, rode com BOT_WORKER_VISIVEL=1 no .env.');
  }
  return new URL(alvo.url()).host;
}

/** Abre o painel Análise no worker, valida a API interna e injeta a config. */
async function abrirPainel({ perfil } = {}) {
  let browser = await abrirNavegador();
  let extId;
  try {
    extId = await acharExtensionId(browser);
  } catch (e) {
    // Navegador reaproveitado com o service worker MV3 adormecido: o alvo
    // chrome-extension:// some e o waitForTarget estoura. Recicla o Chromium
    // uma vez (subida nova recarrega a extensão) antes de desistir.
    console.warn('[worker] extensão não visível — reciclando o Chromium e tentando de novo:', e.message);
    await fecharNavegador();
    browser = await abrirNavegador();
    extId = await acharExtensionId(browser);
  }
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/analise.html`, { waitUntil: 'domcontentloaded' });

  const faltando = await page.evaluate(nomes =>
    nomes.filter(n => typeof globalThis[n] !== 'function'), FUNCOES_PAINEL);
  if (faltando.length) {
    throw new Error(`A extensão mudou — funções não encontradas no painel: ${faltando.join(', ')}. Atualize o bot.`);
  }

  if (perfil?.apiKey) {
    // Mesmo shape do ⚙ Configurações do painel; a geração roda na conta do solicitante.
    await page.evaluate(cfg => new Promise(r => chrome.storage.local.set({ config: cfg }, r)), {
      provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
      nomeUsuario: `${perfil.nome || 'analista'} (via bot)`,
    });
  }
  return { browser, page, extId };
}

async function carregarPauta(page, pautaId) {
  await page.evaluate(id => carregarPautaPorId(id), pautaId);
  const okPauta = await page.evaluate(() => !!(state.pauta && state.pauta.itens && state.pauta.itens.length));
  if (!okPauta) throw new Error(`O painel não conseguiu carregar a pauta "${pautaId}".`);
}

function progressoSnapshot(page) {
  return page.evaluate(() => {
    // MPV entra na contagem: desde 02/09/2026 ela é gerada por IA como os
    // demais projetos (cenários 8a/8b), não mais só edição livre.
    const alvo = state.pauta?.itens || [];
    return {
      total:   alvo.length,
      ok:      alvo.filter(it => it.analiseStatus === 'ok').length,
      erro:    alvo.filter(it => it.analiseStatus === 'erro').length,
      gerando: alvo.filter(it => it.analiseStatus === 'gerando').length,
      rodando: typeof _gerarTodasState === 'object' && !!_gerarTodasState.rodando,
    };
  });
}

/**
 * Gera as análises da pauta no worker, com o MESMO fluxo do botão "Gerar
 * todas" do painel (pula itens com análise já salva).
 * onProgress(p) é chamado a cada ~5 s. Retorna o snapshot final.
 */
async function analisarPauta({ perfil, pautaId, onProgress, timeoutMin = 45 }) {
  const { page } = await abrirPainel({ perfil });
  try {
    await carregarPauta(page, pautaId);

    // Dispara sem aguardar (a geração leva minutos); o progresso é observado por polling.
    await page.evaluate(() => { gerarTodasAsAnalises(); });

    const limite = Date.now() + timeoutMin * 60e3;
    let comecou = false, ultimo = null;
    while (Date.now() < limite) {
      await new Promise(r => setTimeout(r, 5000));
      const p = await progressoSnapshot(page);
      if (p.rodando) comecou = true;
      if (onProgress && JSON.stringify(p) !== JSON.stringify(ultimo)) { ultimo = p; await onProgress(p); }
      // Termina quando o lote parou depois de ter começado (ou nunca começou
      // porque não havia pendências) e nada mais está gerando.
      if (!p.rodando && !p.gerando && (comecou || p.ok + p.erro >= p.total)) return p;
    }
    throw new Error(`Tempo esgotado (${timeoutMin} min) — o que já foi gerado está salvo no Firebase.`);
  } finally {
    await fecharNavegador();
  }
}

/**
 * Gera o PDF institucional da pauta — o MESMO documento do "Exportar PDF" do
 * painel: apelidos (IA se houver chave; senão fallback), logo, índice com
 * páginas via Paged.js. Retorna { pdf: Buffer, numItens, titulo }.
 */
async function exportarPdfPauta({ perfil, pautaId }) {
  const { browser, page } = await abrirPainel({ perfil });
  try {
    await carregarPauta(page, pautaId);

    // Espera o enriquecimento (autoria → selos A/AP do índice) e a carga das
    // análises salvas, com teto de tempo — itens sem análise saem com placeholder.
    await page.waitForFunction(() => {
      const itens = state.pauta?.itens || [];
      return itens.every(it => ['ok', 'erro'].includes(it.enriquecimento?.status));
    }, { timeout: 240000 }).catch(() => { /* segue com o que houver */ });
    await new Promise(r => setTimeout(r, 5000));  // folga p/ fbCarregarAnalise assíncrono

    const html = await page.evaluate(async () => {
      try { await carregarConfig(); } catch (_) {}
      try { await prepararApelidos(state.pauta.itens); } catch (_) {}
      const logo = await carregarLogoDataUrl();
      return _htmlImpressaoPautaPlenario(state.pauta, logo, false);
    });

    const meta = await page.evaluate(() => ({
      numItens: state.pauta.itens.length,
      titulo:   state.pauta.nome || state.pauta.titulo || state.pauta.id,
    }));

    return { pdf: await imprimirHtml(browser, html), ...meta };
  } finally {
    await fecharNavegador();
  }
}

/** Renderiza o HTML de impressão do painel numa página branca + Paged.js (inlined do repositório) e imprime. */
async function imprimirHtml(browser, html) {
  const pagina = await browser.newPage();
  try {
    await pagina.setContent(html, { waitUntil: 'domcontentloaded' });
    await pagina.evaluate(() => { window.PagedConfig = { auto: true, after: () => { window.__pagedPronto = true; } }; });
    await pagina.addScriptTag({ path: PAGED_JS });
    await pagina.waitForFunction('window.__pagedPronto === true', { timeout: 90000 })
      .catch(() => { /* imprime sem numeração se o Paged travar */ });
    return Buffer.from(await pagina.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  } finally {
    await pagina.close().catch(() => {});
  }
}

/**
 * NOTA AVULSA (/avulsa): a nota técnica de UMA proposição fora da pauta, pelo MESMO caminho de um item de
 * pauta — o painel abre um item avulso (abrirItemAvulso), gera com gerarAnaliseItem (documentos, cenário,
 * prompt, conferências, verificação por IA) e imprime o PDF institucional SEM índice.
 * `forcar`: gera de novo mesmo havendo nota da equipe para o parecer atual (sem ele, a nota salva é usada).
 * onProgress(fase) recebe 'documentos' | 'gerando' | 'conferindo' | 'verificando' | 'pdf'.
 * Devolve { pdf, titulo, apelido, nova, regerada, inconclusa, refs, verificacao, documentos, cenario }:
 * `regerada` diz o documento novo que tornou superada a nota da equipe (e por isso ela foi refeita);
 * `inconclusa`, que a fonte não respondeu na conferência da nota aproveitada. Lança erro com a causa.
 */
async function notaAvulsa({ perfil, prop, forcar = false, solicitante = '', onProgress, timeoutMin = 20 }) {
  const { browser, page } = await abrirPainel({ perfil });
  const fase = async f => { if (onProgress) { try { await onProgress(f); } catch (_) {} } };
  try {
    // O painel carrega sozinho a última pauta da equipe ao abrir; o item avulso só entra depois disso,
    // senão a pauta carregada por último substituiria a avulsa no meio da geração.
    await page.waitForFunction(() => typeof state === 'object' && state.pauta, { timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate(({ prop, forcar, solicitante }) => {
      window.__av = { fim: false, t0: Date.now() };
      const it = abrirItemAvulso({ ...prop, solicitante });
      window.__avIt = it;
      gerarAnaliseItem(it, forcar).catch(e => { it.analiseErro = e.message; }).finally(() => { window.__av.fim = true; });
    }, { prop, forcar, solicitante });

    const estado = () => page.evaluate(() => {
      const it = window.__avIt;
      return {
        fim: window.__av.fim, status: it.analiseStatus, erro: it.analiseErro || '',
        enr: it.enriquecimento?.status, temNota: !!it.analise,
        nova: !!(it.analise && new Date(it.analise.geradoEm).getTime() >= window.__av.t0 - 2000),
        verif: !!it.analise?.verificacaoIA, verificando: !!it._verificando,
        avulsa: state.pauta?.origem === 'avulsa',
      };
    });
    const limite = Date.now() + timeoutMin * 60e3;
    let ultima = '', fimEm = 0, st, conferida = false, regerada = '', inconclusa = false;
    while (Date.now() < limite) {
      await new Promise(r => setTimeout(r, 3000));
      st = await estado();
      if (!st.avulsa) throw new Error('o painel trocou de pauta no meio da geração — tente de novo.');
      if (st.fim && (st.status !== 'ok' || !st.temNota)) throw new Error(st.erro || 'a nota não foi gerada.');
      const f = st.fim ? (st.nova && !st.verif ? 'verificando' : (!st.nova && !conferida ? 'conferindo' : 'pdf'))
        : (st.enr === 'ok' || st.enr === 'erro' ? 'gerando' : 'documentos');
      if (f !== ultima) { ultima = f; await fase(f); }
      if (!st.fim) continue;
      if (st.status !== 'ok' || !st.temNota) throw new Error(st.erro || 'a nota não foi gerada.');
      // Nota da equipe aproveitada: a chave dela é a do parecer que o item avulso conhece (sem o relator que
      // a pauta traria, cai em "inteiro-teor"), e ela pode ter sido feita sobre um parecer já superado —
      // CASO REAL no teste de 16/11/2026: PL 2475/2025, nota de 04/11 sobre o PRLP nº 1, com o PRLP nº 2 já
      // publicado. A mesma conferência do botão "Verificar atualização" (reconsulta a fonte): documento
      // operativo novo → gera de novo (é o que a confirmação promete: "nota para o parecer atual").
      if (!st.nova && !conferida) {
        conferida = true;
        const d = await page.evaluate(async () => {
          const r = await verificarAtualizacaoItem(window.__avIt);
          if (r && r.novos && r.novos.length) {
            const it = window.__avIt;
            window.__av = { fim: false, t0: Date.now() };
            gerarAnaliseItem(it, true).catch(e => { it.analiseErro = e.message; }).finally(() => { window.__av.fim = true; });
            return { regerada: _resumoNovos(r.novos) };
          }
          return { inconclusa: !!(r && r.inconclusa) };
        });
        if (d.regerada) { regerada = d.regerada; ultima = ''; continue; }
        inconclusa = d.inconclusa;
      }
      if (!fimEm) fimEm = Date.now();
      // nota nova: espera a verificação por IA (corre depois de salvar), até 4 min; nota reaproveitada não tem
      if (!st.nova || st.verif || Date.now() - fimEm > 240e3) break;
    }
    if (!st || !st.fim) throw new Error(`tempo esgotado (${timeoutMin} min) — se a nota tiver sido gerada, ela está salva no SisPode.`);

    const r = await page.evaluate(async (solicitante) => {
      const it = window.__avIt;
      try { await prepararApelidos(state.pauta.itens); } catch (_) {}
      const logo = await carregarLogoDataUrl();
      const quando = new Date().toLocaleDateString('pt-BR');
      const meta = `Proposição fora da pauta · ${quando}`;   // quem pediu sai como "Responsável" do item
      return {
        html: _htmlImpressaoPautaPlenario(state.pauta, logo, false, { avulsa: true, meta }),
        titulo: tituloComApelido(it),
        apelido: it.apelido || it.analise.apelido || '',
        refs: it.analise.refsSuspeitas || [],
        verificacao: it.analise.verificacaoIA || null,
        documentos: (it.analise.documentos || []).map(d => d.rotulo),
        cenario: it.analise.cenario || '',
      };
    }, solicitante);
    return { pdf: await imprimirHtml(browser, r.html), nova: st.nova, regerada, inconclusa, ...r, html: undefined };
  } finally {
    await fecharNavegador();
  }
}

/**
 * Resumo da sessão — executa no painel o MESMO código do botão "Resultado da
 * Sessão" (coletarResumoSessao + montarMensagemResumo). Carrega a pauta
 * importada (se houver) para usar os apelidos dos itens, como no painel.
 * Retorna { texto } ou { vazio: true } quando a Câmara ainda não registrou
 * as matérias/despachos do dia.
 */
async function resumoSessao({ pautaId, dataISO }) {
  const { page } = await abrirPainel({});
  try {
    if (pautaId) { try { await carregarPauta(page, pautaId); } catch (_) { /* segue sem apelidos */ } }
    return await page.evaluate(async (data) => {
      for (const fn of ['coletarResumoSessao', 'montarMensagemResumo']) {
        if (typeof globalThis[fn] !== 'function') throw new Error(`A extensão mudou — função ${fn} não encontrada.`);
      }
      const res = await coletarResumoSessao(data);
      if (!res.encontrouSessao || (!res.urgencias.length && !res.concluidos.length && !(res.recursos || []).length)) return { vazio: true };
      // Na rota do bot as análises dos itens ainda não carregaram — puxa antes,
      // para o apelido (usado nas descrições) existir em memória.
      try {
        await Promise.all((state.pauta?.itens || []).filter(it => !it.analise).map(it =>
          fbCarregarAnalise(it).then(a => { if (a) it.analise = a; }).catch(() => {})));
      } catch (_) {}
      try { await prepararApelidos(state.pauta?.itens || []); } catch (_) {}
      // `destinos` separado: o monitor usa para saber se os encaminhamentos
      // ("vai ao Senado", "vai à sanção") já estavam publicados — quando não,
      // agenda um complemento mais tarde.
      const destinos = (res.concluidos || []).filter(c => c.destino)
        .map(c => `${tipoLabel(c.sigla)} ${c.numero}/${c.ano} ➡️ ${c.destino}`);
      // `semDestino`: matérias concluídas cujo despacho de destino ainda não
      // saiu — o monitor segura o resumo um pouco à espera dele.
      const semDestino = (res.concluidos || []).filter(c => !c.destino).length;
      // `semProposicao`: votação aprovada cuja matéria os Dados Abertos ainda não
      // apontam — também segura o resumo (ela entraria depois, à parte).
      // recursos (REC) votados entram no texto (aprovados ou rejeitados) — 10/11/2026
      return { texto: await montarMensagemResumo(res.urgencias, res.concluidos, data, res.recursos || []), destinos, semDestino, semProposicao: res.semProposicao || 0 };
    }, dataISO);
  } finally {
    await fecharNavegador();
  }
}

module.exports = { analisarPauta, exportarPdfPauta, resumoSessao, notaAvulsa, fecharNavegador };
