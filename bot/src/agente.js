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
- "varrer_comissoes" {"data":"hoje","partido":"Podemos","deputado":null}: varre TODAS as comissões com reunião deliberativa na data e devolve os projetos (autoria E relatoria) do partido/deputado, comissão por comissão. É UMA consulta só — a varredura é paralela por dentro.
  USE ESTA quando a pergunta for sobre o conjunto do dia: "temos projetos nas comissões amanhã?", "o que a bancada tem em comissão hoje?". NÃO liste as comissões e depois consulte uma a uma: são 11 comissões numa terça comum e você estoura o limite de consultas antes da terceira.
- "pauta_comissao" {"comissoes":["CCJ"],"data":"hoje","partido":null,"deputado":null}: pauta oficial de comissão(ões) ESPECÍFICA(S) numa data. Use quando o usuário nomear a comissão. Para o conjunto do dia, use "varrer_comissoes".
- "comissoes_reuniao" {"data":"hoje"}: só a LISTA de quais comissões têm reunião deliberativa na data, sem as pautas. Use quando bastar saber quem se reúne — se a pergunta é sobre matérias da bancada, vá direto em "varrer_comissoes".
- "regimento" {"consulta":"verificação de votação"}: texto VIGENTE do Regimento Interno da Câmara (RICD). Aceita o número do artigo ("95") ou a dúvida em palavras ("quantas assinaturas para CPI", "prazo de interstício"). Devolve os artigos pertinentes na íntegra. Use SEMPRE que a pergunta for de rito/procedimento no Plenário ou nas comissões.
- "questao_ordem" {"termo":"ata de comissão"} ou {"termo":"prejudicialidade","fase":"recurso"}: busca no acervo COMPLETO de questões de ordem do Plenário (1953 até hoje). Cada QO é indexada em todas as suas fases: a questão levantada, a CONTRADITA, a DECISÃO da Presidência e o RECURSO contra ela, mais os artigos do Regimento invocados. O "termo" aceita TEMA ("avocação de decisão"), NÚMERO EXATO ("8/2023" — mande só o número, sem mais palavras) e ARTIGO ("art. 52", traz as QOs que invocaram aquele dispositivo). É o PRECEDENTE — como a Presidência já decidiu na prática. Numa dúvida regimental relevante, vale consultar "regimento" (a norma) E "questao_ordem" (o precedente). A observação traz a decisão junto (linha ⚖️): REPRODUZA-A, é ela que responde "e no que deu?".
  O parâmetro "fase" ("recurso", "decisao" ou "contradita") RESTRINGE a busca ao texto daquela peça DENTRO da questão de ordem. Use quando a pergunta for sobre uma peça específica — "houve CONTRADITA sobre Y?", "como a Presidência DECIDIU sobre Z?". Sem "fase" a busca casa em qualquer parte da QO.
  Se a observação disser que NENHUMA peça daquela fase menciona o termo, essa É a resposta: diga que não há, e diga em quantas peças foi procurado. NÃO substitua por questões de ordem de outra fase apresentando-as como se fossem a peça pedida.
- "recurso" {"termo":"prejudicialidade de adiamento de discussão"}: busca os RECURSOS PROTOCOLADOS — proposições do tipo REC, com número próprio ("REC 260/2013"). São 2.493 desde 1990, em 27 subtipos regimentais (recurso contra apreciação conclusiva de comissão, contra apensação, contra declaração de prejudicialidade, contra decisão do Presidente em questão de ordem, contra indeferimento de RIC…). Busca na ementa, no subtipo, no autor, nos despachos que decidem E NO INTEIRO TEOR da petição.
  ATENÇÃO — "recurso" tem dois sentidos e são bases DIFERENTES. Quando alguém pergunta "tem algum recurso sobre X?", quase sempre quer ESTA ferramenta (a peça protocolada, com número). A fase "recurso" de "questao_ordem" é outra coisa: o recurso anotado dentro do registro de uma questão de ordem. Na dúvida, consulte as duas e diga de qual base veio cada achado.
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
- Em dúvida REGIMENTAL (rito, prazo, quórum, assinaturas, destaque, verificação): consulte "regimento" e responda CITANDO o artigo ("conforme o art. 185 do RICD…"), reproduzindo o que o artigo diz. NUNCA responda de memória sobre Regimento — seu conhecimento pode estar desatualizado ou errado, e a resposta precisa ser reproduzível.
- Ao consultar "regimento", use TERMOS-CHAVE, não a pergunta inteira: "emendas em comissão" acha melhor que "qual o prazo regimental para apresentação de emendas a projetos de lei em comissões permanentes". Se os artigos vierem fora do assunto, CONSULTE DE NOVO com menos palavras e mais específicas (você tem até 3 consultas).
- Se a observação do "regimento" começar com ERRO_REGIMENTO, ou se após reformular os artigos ainda não responderem: diga que não conseguiu consultar / que não localizou o dispositivo. NÃO complete a lacuna com conhecimento próprio, NÃO cite artigo que não veio na observação e NÃO invente outra norma (RIC, resoluções) para preencher o vazio. Resposta sem lastro é pior que resposta ausente.
- Prefira responder você mesmo (com as observações) a despachar ação; use AÇÃO só quando o usuário pediu a ação em si.
- Ao usar pagina_oficial ou situacao_proposicao, cite a fonte na resposta (ex.: "segundo a Câmara").
- Resposta final: objetiva, sem markdown pesado (Telegram), no máximo ~2500 caracteres.
- Ao listar PESSOAS ou ITENS (oradores, deputados, matérias), coloque UM POR LINHA (com "• "), nunca corrido na frase — facilita a leitura no celular.
- Quando uma OBSERVAÇÃO já vier FORMATADA como lista (itens com "•", identificador em *negrito*, linhas "🔗 Íntegra: https://…"), ENTREGUE-A COMO ESTÁ: mantenha o *negrito* do identificador, os LINKS exatos e UMA LINHA EM BRANCO entre os itens. NÃO compacte em uma linha por item, NÃO resuma as ementas, NÃO troque link por "consulte no portal" nem invente URL. No máximo acrescente UMA frase curta de introdução antes da lista.
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
  // `varrer_comissoes` saiu daqui e virou ferramenta de DADO (26/08/2026):
  // como AÇÃO ela encerrava a vez do agente, e a regra "prefira responder você
  // mesmo a despachar ação" empurrava o modelo para o caminho longo — listar as
  // comissões e consultar uma a uma. Numa terça com 11 comissões isso estoura
  // MAX_CONSULTAS antes da terceira, e o usuário recebe "atingi o limite de
  // consultas" com 9 comissões por olhar. Como DADO, resolve em UMA consulta e
  // ainda sobra volta para o agente ler o resultado.
  const ACOES = ['verificar_pauta', 'escolher_pauta', 'importar_pauta', 'ordem_do_dia', 'ver_nota',
    'perguntar', 'listar_documentos', 'baixar_documentos', 'votacao', 'resumo',
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
