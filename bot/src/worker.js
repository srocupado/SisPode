'use strict';
// Worker de painel — o bot sobe um Chromium invisível COM A EXTENSÃO SisPode
// carregada e comanda o módulo "Análise de Pauta" por dentro (page.evaluate),
// executando o MESMO código do painel: gerar análises, montar o HTML de
// impressão etc. Zero alteração na extensão; zero divergência de resultado.
//
// ⚠ API implícita: este worker chama funções internas do analise.js pelo nome
//   (carregarPautaPorId, gerarTodasAsAnalises, _htmlImpressaoPautaPlenario,
//   prepararApelidos, carregarLogoDataUrl, carregarConfig, ehMPV, state,
//   _gerarTodasState). validarApiPainel() confere todas ao abrir e falha com
//   mensagem clara se a extensão tiver mudado.
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

// Pasta da EXTENSÃO SisPode (manifest.json, analise.html…). Padrão: a pasta-mãe
// da pasta do bot (raiz do repo). Se o bot estiver instalado separado da
// extensão, aponte BOT_EXT_DIR no .env para a pasta onde a extensão está.
const EXT_DIR  = process.env.BOT_EXT_DIR || path.join(__dirname, '..', '..');
const PAGED_JS = path.join(EXT_DIR, 'libs', 'paged.polyfill.js');  // paginador do PDF

const FUNCOES_PAINEL = [
  'carregarPautaPorId', 'gerarTodasAsAnalises', '_htmlImpressaoPautaPlenario',
  'prepararApelidos', 'carregarLogoDataUrl', 'carregarConfig', 'ehMPV',
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
    const itens = state.pauta?.itens || [];
    const alvo = itens.filter(it => !ehMPV(it));
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
 * todas" do painel (pula itens com análise já salva; MPVs ficam de fora).
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

    // Renderiza numa página branca + Paged.js (inlined do repositório) e imprime.
    const pagina = await browser.newPage();
    try {
      await pagina.setContent(html, { waitUntil: 'domcontentloaded' });
      await pagina.evaluate(() => { window.PagedConfig = { auto: true, after: () => { window.__pagedPronto = true; } }; });
      await pagina.addScriptTag({ path: PAGED_JS });
      await pagina.waitForFunction('window.__pagedPronto === true', { timeout: 90000 })
        .catch(() => { /* imprime sem numeração de índice se o Paged travar */ });
      const pdf = await pagina.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      return { pdf: Buffer.from(pdf), ...meta };
    } finally {
      await pagina.close().catch(() => {});
    }
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
      if (!res.encontrouSessao || (!res.urgencias.length && !res.concluidos.length)) return { vazio: true };
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
      return { texto: await montarMensagemResumo(res.urgencias, res.concluidos, data), destinos };
    }, dataISO);
  } finally {
    await fecharNavegador();
  }
}

module.exports = { analisarPauta, exportarPdfPauta, resumoSessao, fecharNavegador };
