'use strict';
// AGENTE de conversa natural (F1) — substitui o roteador de tiro único.
//
// Laço ReAct sobre a MESMA estratégia "JSON tool choice" do router.js (um
// código só para os 3 provedores, sem function calling nativo): a IA recebe o
// catálogo + memória + observações e decide, em JSON, entre
//   {"acao":"consultar","ferramenta":X,...}  → ferramenta de DADO: o bot roda,
//       devolve o resultado como OBSERVAÇÃO e volta à IA (até MAX_CONSULTAS);
//   {"acao":"executar","ferramenta":X,...}   → AÇÃO do bot (importar, analisar,
//       exportar…): o index.js despacha o comando existente (com as confirmações
//       de sempre) e o laço encerra;
//   {"acao":"responder","texto":"…"}         → resposta final em linguagem natural.
//
// Decisões da Liderança (16/07/2026):
//   - roda na CHAVE DO PRÓPRIO USUÁRIO (sem chave compartilhada do bot);
//   - web SÓ em fontes oficiais (allow-list rígida NO CÓDIGO, não no prompt);
//   - no grupo, engaja por menção OU resposta a mensagem do bot (index.js).
//
// As ferramentas de DADO que dependem de helpers do index.js chegam injetadas
// (registry `dados`); as auto-contidas (web oficial, situação de proposição)
// vivem aqui.

const { chamarIAtexto, extrairJson } = require('./ia');

const MAX_CONSULTAS  = 3;          // teto de iterações de ferramenta por mensagem
const OBS_MAX        = 12000;      // teto de caracteres de cada observação
const MEMORIA_TTL    = 45 * 60e3;  // conversa é efêmera (como o /perguntar)
const MEMORIA_TROCAS = 8;          // últimas N trocas lembradas
const MEMORIA_CORTE  = 1200;       // teto de chars por troca lembrada

// ---------- Memória de conversa por usuário (F1c) ----------
const _memoria = new Map();   // userId → { trocas: [{de:'usuario'|'bot', texto}], ts }

function memoriaDe(userId) {
  const m = _memoria.get(String(userId));
  if (m && Date.now() - m.ts < MEMORIA_TTL) return m;
  _memoria.delete(String(userId));
  return null;
}

function lembrar(userId, de, texto) {
  const id = String(userId);
  const m = memoriaDe(id) || { trocas: [], ts: Date.now() };
  m.trocas.push({ de, texto: String(texto || '').slice(0, MEMORIA_CORTE) });
  if (m.trocas.length > MEMORIA_TROCAS) m.trocas = m.trocas.slice(-MEMORIA_TROCAS);
  m.ts = Date.now();
  _memoria.set(id, m);
}

function limparMemoria(userId) { _memoria.delete(String(userId)); }

// ---------- F1b: página oficial (allow-list RÍGIDA no código) ----------
// Domínios oficiais permitidos — decisão da Liderança: só fontes oficiais.
// A checagem vale para o host FINAL (pós-redirect), não só o pedido.
const DOMINIOS_OFICIAIS = ['camara.leg.br', 'senado.leg.br', 'planalto.gov.br', 'in.gov.br'];

function hostPermitido(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return DOMINIOS_OFICIAIS.some(d => h === d || h.endsWith('.' + d));
  } catch (_) { return false; }
}

function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function paginaOficial({ url }) {
  if (!url) return 'ERRO: informe a url.';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!hostPermitido(url)) {
    return `ERRO: domínio fora da lista oficial permitida (${DOMINIOS_OFICIAIS.join(', ')}).`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'SisPodeBot/1.0' } });
    // Redirect pode ter saído do domínio oficial — recusa também.
    if (r.url && !hostPermitido(r.url)) return 'ERRO: a página redirecionou para fora dos domínios oficiais.';
    if (!r.ok) return `ERRO: HTTP ${r.status} ao buscar a página.`;
    const tipo = r.headers.get('content-type') || '';
    if (/pdf|octet-stream|image|audio|video/i.test(tipo)) return 'ERRO: a URL não é uma página de texto (talvez um PDF — use /baixar para arquivos).';
    const texto = htmlParaTexto(await r.text());
    if (!texto) return 'ERRO: página sem texto legível.';
    return `[Fonte: ${r.url || url}]\n${texto.slice(0, OBS_MAX)}`;
  } catch (e) {
    return `ERRO: ${e.name === 'AbortError' ? 'tempo esgotado' : e.message}.`;
  } finally { clearTimeout(timer); }
}

// ---------- F1b: situação de proposição (API de Dados Abertos) ----------
const API_CAMARA = 'https://dadosabertos.camara.leg.br/api/v2';

async function jsonCamara(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function situacaoProposicao({ sigla, numero, ano }) {
  sigla = String(sigla || '').toUpperCase().trim();
  numero = String(numero || '').replace(/\D/g, '');
  ano = String(ano || '').replace(/\D/g, '');
  if (!sigla || !numero || !ano) return 'ERRO: informe sigla, numero e ano (ex.: PL, 1234, 2026).';
  const busca = await jsonCamara(`${API_CAMARA}/proposicoes?siglaTipo=${sigla}&numero=${numero}&ano=${ano}&itens=1`);
  const p = (busca.dados || [])[0];
  if (!p) return `Nenhuma proposição ${sigla} ${numero}/${ano} encontrada na API da Câmara.`;
  const det = (await jsonCamara(`${API_CAMARA}/proposicoes/${p.id}`)).dados || {};
  const st = det.statusProposicao || {};
  const autores = await jsonCamara(`${API_CAMARA}/proposicoes/${p.id}/autores`).catch(() => ({ dados: [] }));
  const nomesAutores = (autores.dados || []).slice(0, 5).map(a => a.nome).join(', ');
  const linhas = [
    `${sigla} ${numero}/${ano} — id ${p.id}`,
    `Ementa: ${det.ementa || p.ementa || '(sem ementa)'}`,
    nomesAutores ? `Autoria: ${nomesAutores}${(autores.dados || []).length > 5 ? ' e outros' : ''}` : null,
    st.descricaoSituacao ? `Situação: ${st.descricaoSituacao}` : null,
    st.siglaOrgao ? `Onde está: ${st.siglaOrgao}` : null,
    st.descricaoTramitacao ? `Última tramitação: ${st.descricaoTramitacao}${st.dataHora ? ` (${String(st.dataHora).slice(0, 10)})` : ''}` : null,
    st.despacho ? `Despacho: ${String(st.despacho).slice(0, 500)}` : null,
    det.urlInteiroTeor ? `Inteiro teor: ${det.urlInteiroTeor}` : null,
  ].filter(Boolean);
  return linhas.join('\n').slice(0, OBS_MAX);
}

// ---------- Catálogo ----------
// DADO = o resultado volta para a IA como observação. AÇÃO = despacha o comando
// existente no index.js (com as confirmações de sempre) e encerra o laço.
const CATALOGO_DADOS = `
FERRAMENTAS DE CONSULTA (o resultado volta para você continuar raciocinando):
- "listar_itens" {}: itens da pauta em uso no SisPode (números, apelidos, relatores).
- "nota_tecnica" {"proposicao":"PL 1234/2026"}: texto da nota técnica salva no SisPode para um item da pauta.
- "quorum" {}: presença AO VIVO no Plenário e fase da Ordem do Dia (painel público).
- "pauta_comissao" {"comissoes":["CCJ"],"data":"hoje","partido":null,"deputado":null}: pauta oficial de comissão(ões) numa data.
- "comissoes_reuniao" {"data":"hoje"}: quais comissões têm reunião deliberativa na data.
- "questao_ordem" {"termo":"ata de comissão"}: busca QUESTÕES DE ORDEM do Plenário que mencionam um termo, no resumo de cada uma (histórico completo). Use para "houve questão de ordem sobre X?", "alguma QO sobre ata de comissão?", "questões de ordem do deputado Fulano".
- "faltam_votar" {}: numa votação NOMINAL em curso, quem da bancada do Podemos ainda NÃO votou — separando "presentes e não votaram" (acionável) de "fora da Casa". Só funciona com nominal aberta. Use para "quem do Podemos falta votar?", "a bancada já votou toda?".
- "oradores_sessao" {"data":"dd/mm/aaaa","filtro":""}: quem FALOU / foi chamado / aguarda para falar na sessão do Plenário, por lista (Breves Comunicações, Comunicações de Liderança, Discussão/Encaminhamento por matéria) — com partido e UF. Sem data = hoje; "filtro" restringe (ex.: "breves", "liderança", "PL 2581/2026"). Use para "quem já falou hoje?", "quem discutiu a MPV X?", "alguém do Podemos falou?".
- "situacao_proposicao" {"sigla":"PL","numero":"1234","ano":"2026"}: ementa, autoria, situação e última tramitação de QUALQUER proposição (API oficial da Câmara) — mesmo fora da pauta.
- "pagina_oficial" {"url":"https://www.camara.leg.br/..."}: lê uma página de site OFICIAL (só camara.leg.br, senado.leg.br, planalto.gov.br, in.gov.br). Use quando souber a URL exata; para proposições prefira situacao_proposicao.`;

const CATALOGO_ACOES = `
AÇÕES DO BOT (executam um fluxo pronto e encerram sua vez — use quando o usuário PEDIR a ação):
- "verificar_pauta" {}: buscar on-line se há Pauta da Semana nova / Ordem do Dia de hoje.
- "escolher_pauta" {}: listar as pautas guardadas para o usuário escolher qual usar.
- "importar_pauta" {}: importar a Pauta da Semana (pede confirmação).
- "ordem_do_dia" {}: importar a Ordem do Dia de hoje.
- "ver_nota" {"pergunta":"PL 1234/2026"}: exibir a nota técnica INTEGRAL (verbatim) para o usuário.
- "perguntar" {"pergunta":"..."}: análise PROFUNDA de conteúdo de um item da pauta (usa nota + documentos da matéria; conversa própria). Use para perguntas de mérito/impacto sobre item da pauta.
- "listar_documentos" {"pergunta":"PL 1234/2026"}: documentos da tramitação fora da nota.
- "baixar_documentos" {"pergunta":"PL 1234/2026"}: enviar os PDFs da matéria.
- "votacao" {"pergunta":"dd/mm/aaaa"}: votações nominais do Plenário + imagem do placar da bancada.
- "resumo" {"pergunta":"dd/mm/aaaa"}: resumo oficial da sessão do dia (matérias apreciadas).
- "varrer_comissoes" {"data":"hoje","partido":"Podemos","deputado":null}: varrer comissões atrás de projetos de um partido/deputado.
- "digest" {}: radar de imprensa (assinantes).
- "analisar" {}: gerar as notas técnicas da pauta (caro; pede confirmação).
- "exportar" {}: PDF institucional da pauta.
- "ajuda" {}: explicar o que o bot faz.`;

function dataBrasilia() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(new Date());
}

function montarPrompt({ mensagem, memoria, observacoes, forcarResposta }) {
  const hist = (memoria?.trocas || [])
    .map(t => `${t.de === 'usuario' ? 'USUÁRIO' : 'VOCÊ'}: ${t.texto}`).join('\n');
  const obs = observacoes
    .map((o, i) => `OBSERVAÇÃO ${i + 1} — ${o.ferramenta}(${JSON.stringify(o.argumentos)}):\n${o.resultado}`)
    .join('\n\n');
  return `Você é o assistente da Liderança do Podemos na Câmara dos Deputados (bot SisPode, no Telegram). Hoje é ${dataBrasilia()} (Brasília). Fale pt-BR, direto e preciso — é ambiente de trabalho parlamentar.

REGRAS:
- NUNCA invente número, placar, situação ou data: se precisar de um dado, CONSULTE uma ferramenta.
- Prefira responder você mesmo (com as observações) a despachar ação; use AÇÃO só quando o usuário pediu a ação em si.
- Ao usar pagina_oficial ou situacao_proposicao, cite a fonte na resposta (ex.: "segundo a Câmara").
- Resposta final: objetiva, sem markdown pesado (Telegram), no máximo ~2500 caracteres.
- Ao listar PESSOAS ou ITENS (oradores, deputados, matérias), coloque UM POR LINHA (com "• "), nunca corrido na frase — facilita a leitura no celular.
- Se uma OBSERVAÇÃO trouxer LINKS (URLs), REPRODUZA-OS na resposta EXATAMENTE como vieram (ex.: o "🔗 Íntegra: https://…" de cada questão de ordem). NUNCA troque um link por "consulte no portal" nem invente URLs — o usuário precisa do link exato.
${CATALOGO_DADOS}
${CATALOGO_ACOES}

${hist ? `CONVERSA RECENTE:\n${hist}\n\n` : ''}${obs ? `${obs}\n\n` : ''}MENSAGEM DO USUÁRIO: ${mensagem}

${forcarResposta
    ? 'Você atingiu o limite de consultas. Responda AGORA com o que tem: {"acao":"responder","texto":"..."}'
    : `Responda APENAS com um objeto JSON, sem cercas de código, em UMA das formas:
{"acao":"consultar","ferramenta":"<nome>","argumentos":{...}}
{"acao":"executar","ferramenta":"<nome>","argumentos":{...}}
{"acao":"responder","texto":"<sua resposta ao usuário>"}`}`;
}

/**
 * Conversa com laço ReAct. `dados` = registry injetado pelo index.js
 * (funções async que recebem argumentos e devolvem STRING).
 * Retorna { tipo:'texto', texto } ou { tipo:'acao', ferramenta, argumentos }.
 */
async function conversar({ userId, perfil, texto, dados = {} }) {
  const ACOES = ['verificar_pauta', 'escolher_pauta', 'importar_pauta', 'ordem_do_dia', 'ver_nota',
    'perguntar', 'listar_documentos', 'baixar_documentos', 'votacao', 'resumo', 'varrer_comissoes',
    'digest', 'analisar', 'exportar', 'ajuda'];
  const DADOS = { ...dados, situacao_proposicao: situacaoProposicao, pagina_oficial: paginaOficial };

  const memoria = memoriaDe(userId);
  const observacoes = [];

  for (let volta = 0; volta <= MAX_CONSULTAS; volta++) {
    const forcarResposta = volta === MAX_CONSULTAS;
    const bruto = await chamarIAtexto({
      provedor: perfil.provedor, apiKey: perfil.apiKey, modelo: perfil.modelo,
      prompt: montarPrompt({ mensagem: texto, memoria, observacoes, forcarResposta }),
      maxTokens: 2000,
    });
    const j = extrairJson(bruto);

    // A IA respondeu em prosa (sem JSON)? Aceita como resposta final — melhor
    // entregar do que falhar por formalidade.
    if (!j.acao) {
      const prosa = String(bruto || '').replace(/```[a-z]*\n?/gi, '').trim();
      if (prosa) return finalizar(userId, texto, { tipo: 'texto', texto: prosa });
      return finalizar(userId, texto, { tipo: 'texto', texto: 'Não consegui elaborar uma resposta — tente reformular ou use um comando (/ajuda).' });
    }

    if (j.acao === 'responder') {
      return finalizar(userId, texto, { tipo: 'texto', texto: String(j.texto || '').trim() || 'Certo!' });
    }

    if (j.acao === 'executar') {
      if (!ACOES.includes(j.ferramenta)) {
        observacoes.push({ ferramenta: j.ferramenta, argumentos: j.argumentos || {}, resultado: 'ERRO: ação inexistente. Escolha uma do catálogo.' });
        continue;
      }
      lembrar(userId, 'usuario', texto);
      lembrar(userId, 'bot', `[executei a ação ${j.ferramenta}]`);
      return { tipo: 'acao', ferramenta: j.ferramenta, argumentos: j.argumentos || {} };
    }

    // consultar
    const fn = DADOS[j.ferramenta];
    if (typeof fn !== 'function') {
      observacoes.push({ ferramenta: j.ferramenta, argumentos: j.argumentos || {}, resultado: 'ERRO: ferramenta de consulta inexistente. Escolha uma do catálogo.' });
      continue;
    }
    let resultado;
    try { resultado = String(await fn(j.argumentos || {}) || '(vazio)').slice(0, OBS_MAX); }
    catch (e) { resultado = `ERRO: ${e.message}`; }
    observacoes.push({ ferramenta: j.ferramenta, argumentos: j.argumentos || {}, resultado });
  }
  // (não alcança — a volta final força resposta; por segurança:)
  return finalizar(userId, texto, { tipo: 'texto', texto: 'Não consegui concluir — tente um comando (/ajuda).' });
}

function finalizar(userId, pergunta, saida) {
  lembrar(userId, 'usuario', pergunta);
  if (saida.tipo === 'texto') lembrar(userId, 'bot', saida.texto);
  return saida;
}

module.exports = { conversar, limparMemoria, hostPermitido, htmlParaTexto, situacaoProposicao, paginaOficial, DOMINIOS_OFICIAIS };
