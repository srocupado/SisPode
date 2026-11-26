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
// Quantos trabalhos estão com o painel aberto agora. O navegador é UM só, e cada trabalho fechava-o ao terminar:
// o resumo da sessão (que o monitor chama sem a trava do /analisar) derrubava a rotina do /auto no meio, e
// vice-versa — e os dois costumam coincidir, porque a convocação da sessão seguinte sai no fim da sessão, que é
// quando o resumo roda (varredura de 26/11/2026). Agora cada trabalho fecha só a sua página; o navegador fecha
// quando o último termina.
let _emUso = 0;

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

/** Fim de um trabalho: fecha a página dele e, se nenhum outro está com o painel aberto, o navegador. */
async function soltarPainel(page) {
  if (page) await page.close().catch(() => {});
  _emUso = Math.max(0, _emUso - 1);
  if (_emUso === 0) await fecharNavegador();
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
  _emUso++;   // antes de qualquer espera: quem estiver terminando agora já vê que há outro trabalho e não fecha o navegador
  let page = null;
  try {
    let browser = await abrirNavegador();
    let extId;
    try {
      extId = await acharExtensionId(browser);
    } catch (e) {
      // Navegador reaproveitado com o service worker MV3 adormecido: o alvo
      // chrome-extension:// some e o waitForTarget estoura. Recicla o Chromium
      // uma vez (subida nova recarrega a extensão) antes de desistir — desde que
      // nenhum outro trabalho esteja usando este navegador.
      if (_emUso > 1) throw e;
      console.warn('[worker] extensão não visível — reciclando o Chromium e tentando de novo:', e.message);
      await fecharNavegador();
      browser = await abrirNavegador();
      extId = await acharExtensionId(browser);
    }
    page = await browser.newPage();
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
  } catch (e) {
    await soltarPainel(page);   // não chegou a entregar o painel: devolve a vez
    throw e;
  }
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

    return await gerarEAguardar(page, { onProgress, timeoutMin });
  } finally {
    await soltarPainel(page);
  }
}

/** Dispara o "Gerar todas" da pauta aberta no painel e acompanha até o lote terminar. Devolve o retrato final. */
async function gerarEAguardar(page, { onProgress, timeoutMin = 45 } = {}) {
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
}


/**
 * ROTINA AUTOMÁTICA (/auto, 26/11/2026): a pauta de uma sessão convocada, do site da Câmara ao material pronto —
 * tudo com o código do painel, como se um analista fizesse à mão.
 *   1. Pauta: se a equipe já importou a desta sessão, é ela que vale (nada é sobrescrito). Senão, baixa a pauta
 *      oficial (o PDF do link "Pauta" da página da sessão) e importa pelo caminho do calendário do Plenário, em
 *      modo automático: responsável mantido para a matéria que volta, sorteio para as demais.
 *   2. Notas: "Gerar todas" na chave de `perfil` — só as matérias sem nota são geradas. Sem chave, a etapa é pulada.
 *   3. Material: o PDF institucional, a mensagem dos apelidos e os itens do Podemos na pauta.
 * `sessao`: { id, data: 'AAAA-MM-DD', hora: 'HH:MM' }. onProgress({ fase, ...retrato }) — fase 'pauta' | 'notas' | 'material'.
 * Devolve { semPdf: true } quando a página da sessão ainda não tem o PDF da pauta; senão
 * { pautaId, titulo, numItens, existente, responsaveis, notas, semChave, apelidos, podemos: { texto, total }, incertos, pdf }.
 */
async function rotinaPautaDaSessao({ perfil, sessao, onProgress, timeoutMin = 60 }) {
  const { browser, page } = await abrirPainel({ perfil });
  const fase = async (f, extra = {}) => { if (onProgress) { try { await onProgress({ fase: f, ...extra }); } catch (_) {} } };
  try {
    // Ninguém responde a diálogos aqui: confirm()/alert() do painel são recusados em vez de travar a página.
    page.on('dialog', d => { d.dismiss().catch(() => {}); });
    // Funções do painel que só esta rotina usa. Conferidas pelo nome, sem eval (a página da extensão o proíbe);
    // `enriquecimentoFalhou` é const, não está em globalThis.
    /* eslint-disable no-undef */
    const faltando = await page.evaluate(() => [
      ['importarPautaPdf', () => importarPautaPdf], ['plenPdfDaSessao', () => plenPdfDaSessao], ['plenNomeArquivo', () => plenNomeArquivo],
      ['montarMensagemApelidos', () => montarMensagemApelidos], ['montarMensagemPropPartido', () => montarMensagemPropPartido],
      ['enriquecerItem', () => enriquecerItem], ['enriquecimentoFalhou', () => enriquecimentoFalhou],
    ].filter(([, pega]) => { try { return typeof pega() !== 'function'; } catch (_) { return true; } }).map(([n]) => n));
    /* eslint-enable no-undef */
    if (faltando.length) throw new Error(`A extensão mudou — funções não encontradas no painel: ${faltando.join(', ')}. Atualize o bot.`);
    // O painel abre sozinho a última pauta da equipe; a desta sessão só entra depois disso.
    await page.waitForFunction(() => typeof state === 'object' && state.pauta, { timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    await fase('pauta');
    const pauta = await page.evaluate(async ev => {
      try { await carregarConfig(); } catch (_) {}
      const retrato = existente => ({
        pautaId: state.pauta.id, titulo: state.pauta.nome || state.pauta.titulo || state.pauta.id, numItens: state.pauta.itens.length, existente,
        responsaveis: state.pauta.itens.map(it => ({ item: `${tipoLabel(it.sigla)} ${it.numero}/${it.ano}`, analista: it.analista || '' })),
      });
      // a equipe (ou uma rodada anterior) já importou a pauta desta sessão?
      let todas = null;
      try { const r = await fetch(`${FIREBASE_URL}/pautas.json`); if (r.ok) todas = await r.json(); } catch (_) {}
      const ja = Object.entries(todas || {}).filter(([, p]) => p && String(p.sessaoOficial?.eventoId || '') === String(ev.id))
        .sort((a, b) => String(b[1].uploadedAt || '').localeCompare(String(a[1].uploadedAt || '')))[0];
      if (ja) {
        await carregarPautaPorId(ja[0]);
        if (!state.pauta || state.pauta.id !== ja[0]) return { erro: `o painel não conseguiu abrir a pauta "${ja[0]}"` };
        return retrato(true);
      }
      const pdf = await plenPdfDaSessao(ev.id);
      if (!pdf) return { semPdf: true };
      const r = await importarPautaPdf(pdf.buffer, plenNomeArquivo(ev.data, { dataHoraInicio: `${ev.data}T${ev.hora || ''}` }),
        { eventoId: String(ev.id), url: pdf.url, data: ev.data }, { automatico: true });
      if (!r || !state.pauta || !(state.pauta.itens || []).length) return { erro: 'a pauta oficial foi baixada, mas o leitor não identificou itens nela' };
      // A importação dispara a gravação sem esperar por ela. Aqui o navegador fecha ao fim do trabalho: sem a
      // gravação confirmada, a pauta podia não chegar ao Firebase e o grupo receber o PDF de uma pauta que não existe.
      if (r !== 'existente') { try { await fbSalvarPauta(state.pauta); } catch (e) { return { erro: `a pauta foi lida, mas não consegui gravá-la no banco (${e.message})` }; } }
      return retrato(r === 'existente');
    }, sessao);
    if (pauta.semPdf) return { semPdf: true };
    if (pauta.erro) throw new Error(pauta.erro);

    let notas = null;
    if (perfil?.apiKey) {
      await fase('notas', pauta);
      notas = await gerarEAguardar(page, { timeoutMin, onProgress: p => fase('notas', { ...pauta, ...p }) });
    }

    await fase('material', pauta);
    // Autoria e apensados resolvidos (com teto de tempo): deles saem os itens do Podemos e os selos do índice.
    await page.waitForFunction(() => (state.pauta?.itens || []).every(it => ['ok', 'erro'].includes(it.enriquecimento?.status)), { timeout: 240000 }).catch(() => { /* segue com o que houver */ });
    await new Promise(r => setTimeout(r, 3000));
    const material = await page.evaluate(async () => {
      const itens = state.pauta.itens;
      const pend = itens.filter(it => !['ok', 'erro'].includes(it.enriquecimento?.status));
      await Promise.all(pend.map(it => enriquecerItem(it).catch(() => {})));
      // Pauta recém-importada não traz as notas que a equipe já tem (o painel só as busca ao abrir uma pauta salva
      // ou ao gerar): sem isto, o PDF de uma importação sem geração sairia vazio.
      await Promise.all(itens.filter(it => !it.analise).map(it => fbCarregarAnalise(it).then(a => { if (a) { it.analise = a; it.analiseStatus = 'ok'; } }).catch(() => {})));
      try { await prepararApelidos(itens); } catch (_) {}
      const logo = await carregarLogoDataUrl();
      return {
        apelidos: montarMensagemApelidos().texto,
        podemos: montarMensagemPropPartido(),
        incertos: itens.filter(enriquecimentoFalhou).map(it => `${tipoLabel(it.sigla)} ${it.numero}/${it.ano}`),
        comNota: itens.filter(it => it.analise).length,
        html: _htmlImpressaoPautaPlenario(state.pauta, logo, false),
      };
    });
    const pdf = await imprimirHtml(browser, material.html);
    delete material.html;
    return { ...pauta, notas, semChave: !perfil?.apiKey, ...material, pdf };
  } finally {
    await soltarPainel(page);
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
    await soltarPainel(page);
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
    await soltarPainel(page);
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
    await soltarPainel(page);
  }
}

module.exports = { analisarPauta, exportarPdfPauta, resumoSessao, notaAvulsa, rotinaPautaDaSessao, fecharNavegador, _teste: { abrirPainel, soltarPainel, emUso: () => _emUso } };
