export const meta = {
  name: 'varredura-sispode-lote',
  description: 'Varre um lote de áreas do SisPode em busca de defeitos que produzam informação errada, perda de dado ou vazamento de chave',
  phases: [{ title: 'Varredura', detail: 'um finder por área do lote' }],
}

// Varredura por LOTES, retomável. As áreas ficam aqui dentro (o script não tem
// acesso a disco); o lote é escolhido por `args`, uma lista de chaves — ex.:
// Workflow({scriptPath: 'varredura/workflow-varredura.js', args: ['lideres','congresso']}).
// O estado (o que já foi varrido, com os achados) vive em varredura/estado.json
// e varredura/achados/<chave>.json, versionados no branch varredura-bugs: se o
// contêiner for reciclado, basta clonar o branch e continuar de onde parou.
//
// Divisão de trabalho decidida em 14/09/2026: os finders rodam em modelo
// econômico (varredura mecânica, barata) e a AVALIAÇÃO de cada achado é feita
// depois pelo modelo da sessão, lendo o código. Por isso não há etapa de
// cético aqui — ela sairia cara e é justamente a parte que exige julgamento.

const RAIZ = '/home/user/SisPode'

const CONTEXTO = `PROJETO: SisPode — ferramentas da Liderança do Podemos na Câmara dos Deputados (Brasil).
Repositório em ${RAIZ}. Duas frentes: uma extensão Chrome MV3 (arquivos .js na raiz, scripts CLÁSSICOS
carregados por <script> em páginas da extensão, todos no MESMO escopo global; CSP proíbe eval; acesso a
domínios externos depende de host_permissions no manifest.json) e um bot Node.js em bot/ (grammY, Telegram).
Persistência comum: Firebase Realtime Database com REGRAS ABERTAS (qualquer aba lê e apaga) e
chrome.storage.local (chaves de API do analista). Código e comentários em português.

QUEM USA: assessoria legislativa. O produto do sistema é INFORMAÇÃO que vai à mão de deputados — nota
técnica, parecer, placar de votação, lista do Colégio de Líderes, valores de emendas parlamentares.

O QUE CONTA COMO BUG CRÍTICO AQUI (em ordem de gravidade):
1. INFORMAÇÃO ERRADA APRESENTADA COMO CERTA: documento errado enviado ao modelo, número/valor trocado,
   parser que casa o item errado, data/prazo calculado errado, deputado ou partido atribuído errado,
   voto/orientação trocado, conferência anti-alucinação que deixa passar o que deveria barrar.
2. PERDA OU CORRUPÇÃO DE DADOS: escrita que sobrescreve trabalho da equipe no Firebase, chave de nó
   inválida ou colidente, apagamento em cascata indevido, autosave que grava estado parcial, cache que
   serve dado de outro exercício/pauta/proposição.
3. VAZAMENTO DE SEGREDO: chave de API gravada no Firebase, em PDF, em log, em arquivo do repositório.
4. QUEBRA SILENCIOSA: falha engolida por catch vazio que faz a tela mostrar "vazio" ou "zero" como se
   fosse resposta legítima da fonte; promessa não aguardada; erro que interrompe um lote inteiro.
5. TRAVAMENTO DO FLUXO: laço infinito, await que nunca resolve, botão presto em "carregando" para
   sempre, recursão sem corte.

O QUE NÃO INTERESSA (não reporte): estilo, nomes, sintaxe, refatoração, duplicação, performance sem
impacto prático, "falta try/catch" genérico, sugestão de teste, TODO existente, tipagem, falta de JSDoc.
Não reporte comportamento que o código DECLARA em comentário como decisão consciente (este projeto
documenta muitas decisões deliberadas) — a menos que o código não faça o que o comentário diz.

REGRAS DE TRABALHO: leia o código de verdade (Read/Grep/Bash); não especule pelo nome do arquivo. Pode
rodar Node para testar hipóteses. NÃO altere NENHUM arquivo do repositório e não rode git add/commit/
push/checkout.`

const AREAS = [
  { key: 'analise-cenarios', arquivos: 'analise.js (linhas 1 a 2900)', foco: 'Cenário de tramitação e escolha dos documentos enviados ao modelo: MPV (8a/8b), PEC (9), PDL (10), retorno do Senado (6/7), SBT-A, SSP, PRLP/PRLE, requerimentos, redações finais, apensados, enriquecimento pela API da Câmara.' },
  { key: 'analise-geracao', arquivos: 'analise.js (linhas 2900 a 5300)', foco: 'Geração por IA: prompt, truncamento e auto-continuação, lote, retry, aborto, edição com autosave, alerta de nota desatualizada, exportação em PDF.' },
  { key: 'analise-parecer-tela', arquivos: 'analise.js (linhas 5300 ao fim) e parecer.js', foco: 'Parecer de Especialista na tela: diálogo de modelo e chave por provedor, escolha de modelo, gravação e releitura no Firebase, meta do card, abertura dos dois documentos.' },
  { key: 'panel-destaques', arquivos: 'panel.js', foco: 'Destaques: classificação do destaque em CASOS (0, 1a, 1b, 1-MPV, 2, 3, 4, 5) e busca do documento correspondente; scraping de pareceres e emendas; painel inicial e navegação.' },
  { key: 'lideres', arquivos: 'lideres.js', foco: 'Reunião de Líderes: parser do PDF da lista (grade de colunas, quebra de página, cabeçalho repetido), camada factual sem IA (urgência, apensação, a qual proposição o REQ se refere, relatoria, autoria), demandas, e-mail.' },
  { key: 'congresso', arquivos: 'congresso.js', foco: 'Vetos e Sessão Conjunta: leitura do relatório em PDF, parser da pauta, dispositivos vetados, agrupamento de razões, lotes com persistência incremental e retomada, deputados interessados, exportação.' },
  { key: 'ccjc', arquivos: 'ccjc.js', foco: 'Pautas CCJC: importação por PDF e calendário, documentos vigentes por comissão, perfis de prompt, conferência de referências, lote, edição, exportação.' },
  { key: 'comissoes-gestao', arquivos: 'comissoes.js', foco: 'Gestão de comissões: sincronização com a API (permanentes, mistas de MPV, temporárias), status real, vagas, cessão, pedidos, alertas de acúmulo, cache.' },
  { key: 'pautas-comissoes', arquivos: 'pautas-comissoes.js e pautas-comissoes-core.js', foco: 'Pautas de Comissões: calendário, itens e chaves, papel da comissão, fila, provedor por comissão, lote da semana, apagar pauta (cascata no Firebase), cache.' },
  { key: 'orcamento-notas', arquivos: 'orcamento-notas.js', foco: 'Notas técnicas orçamentárias: leituras da CMO, ficha do exercício, montagem e impressão da nota, gravação no Firebase, modo de leitura de documento grande, avisos de pendência.' },
  { key: 'orcamento-conferencia', arquivos: 'orcamento-ia.js, normas.js, ficha.js, serie.js, mensagem.js, guia-emendas.js e cmo.js', foco: 'A camada que CONFERE a resposta do modelo: trecho literal, cifras, tolerância de arredondamento, lista branca de números, normas citadas, soma das tabelas contra o total impresso, série com lacunas.' },
  { key: 'emendas', arquivos: 'emendas.js', foco: 'Emendas: coleta por UF no FNS, Portal da Transparência, bancada (Câmara e Senado), casamento pelo código da emenda, etapas, detecção de mudanças, XLSX, avisos de incoerência.' },
  { key: 'votacao-aderencia', arquivos: 'votacao.js e aderencia.js', foco: 'Votação e aderência: sessão ao vivo e histórico, deduplicação de nomes entre fontes, complemento da bancada, orientação, cálculo do índice e do ranking, cache, imagem.' },
  { key: 'parecer-nucleo', arquivos: 'pipeline-parecer.js, tese.js e gates.js', foco: 'Núcleo do parecer: etapas, conferência de trechos, catálogo de evidências, validação da tese, contraditório, conferência da redação, portões e rubrica. Procure falsos positivos/negativos nas expressões regulares.' },
  { key: 'parecer-dados', arquivos: 'dossie.js, ficha-objeto.js, parecer-html.js e especialistas.js', foco: 'Dados do parecer: cascata da lei vigente, séries, estimativas, janelas, ficha do objeto, montagem dos dois HTML (escape, seções, índice, parecer antigo reaberto), acionamento das lentes.' },
  { key: 'ia-comum', arquivos: 'ia-comum.js, mpv.js e pauta-parser.js', foco: 'Cliente de IA (três provedores, streaming, PDF, aborto), acervo da MPV, parser das pautas do Plenário.' },
  { key: 'bot-nucleo', arquivos: 'bot/index.js e bot/src/agente.js', foco: 'Roteamento de comandos, allowlist, laço do agente e ferramentas, allow-list de domínios, memória de conversa, envio.' },
  { key: 'bot-monitor', arquivos: 'bot/src/monitor.js, bot/src/plenariocosev.js, bot/src/oradores.js, bot/src/faltamvotar.js e bot/src/sessao.js', foco: 'Monitor ao vivo: quórum, ordem do dia, votações simbólicas e nominais com autocorreção, quem não votou, duas sessões no mesmo dia, estado entre reinícios, anúncio duplicado ou perdido.' },
  { key: 'bot-conteudo', arquivos: 'bot/src/materia.js, bot/src/perguntar.js, bot/src/pauta.js, bot/src/odd.js, bot/src/parser.js, bot/src/documentos.js, bot/src/comissoes.js e bot/src/ata.js', foco: 'Ficha factual de proposição, respostas a partir da nota, pauta e ordem do dia, varredura de comissões, modo ata (anotações em disco, montagem da mensagem, conferência nas duas direções).' },
  { key: 'bot-infra', arquivos: 'bot/src/store.js, bot/src/firebase.js, bot/src/config.js, bot/src/backup.js, bot/src/ia.js, bot/src/worker.js, bot/src/autoupdate.js, bot/src/reenvio.js e bot/src/portal.js', foco: 'Persistência em disco e Firebase, chave por usuário, backup e restauração não destrutiva, worker, autoatualização, reenvio, portal.' },
  { key: 'x-segredos', arquivos: 'todo o repositório', foco: 'SEGREDOS: qualquer caminho pelo qual chave de API, token do Telegram ou chave do Portal da Transparência saia do navegador/máquina — gravação no Firebase, dentro de objeto salvo, em PDF, em log copiável, em mensagem ao grupo, em arquivo versionado. Verifique também se há segredo real commitado hoje (git grep na árvore inteira).' },
  { key: 'x-firebase', arquivos: 'todos os módulos que escrevem no Firebase', foco: 'PERSISTÊNCIA COMPARTILHADA: PUT que substitui nó inteiro e apaga trabalho alheio; chave com caractere proibido pelo RTDB (. / : # $ [ ]) ou derivada de dado do usuário; colisão de chave entre itens distintos; apagamento em cascata que leva dado ainda referenciado; autosave gravando estado parcial; leitura que assume campo ausente em registro antigo.' },
  { key: 'x-concorrencia', arquivos: 'os módulos de tela da extensão', foco: 'CONCORRÊNCIA: resposta de requisição antiga escrevendo na tela nova (trocar de pauta/comissão/exercício no meio do enriquecimento); estado global mutado por dois fluxos; timer não limpo; AbortController que não cobre todos os caminhos; promessa sem await; botão preso em carregando no caminho de erro.' },
  { key: 'x-datas-numeros', arquivos: 'todo o código que formata ou calcula data, prazo e valor', foco: 'DATAS E NÚMEROS: fuso e conversão ISO/BR que muda o dia; comparação de data como texto; prazo que ignora o publicado; número em formato brasileiro convertido errado; arredondamento que muda o valor exibido; divisão por zero; soma de moeda em ponto flutuante apresentada como oficial; ano de dois dígitos; ordenação lexicográfica de número.' },
  { key: 'x-testes', arquivos: 'testes/', foco: 'SAÚDE DA SUÍTE: rode cada arquivo de testes/ com node e reporte APENAS falha real de produto (o código está errado). Para cada uma, leia teste e código e diga qual é o defeito. Falha por falta de rede, dependência ausente ou fixture velha NÃO é achado: mencione no resumo. Reporte também teste que passa por engano (asserção que não verifica o que promete).' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critica', 'alta', 'media'] },
          title: { type: 'string' },
          summary: { type: 'string', description: 'o que o código faz de errado, em 1 a 3 frases' },
          failure_scenario: { type: 'string', description: 'entrada ou estado concreto e qual é o resultado errado' },
          evidence: { type: 'string', description: 'trecho de código citado literalmente' },
        },
        required: ['file', 'line', 'severity', 'title', 'summary', 'failure_scenario', 'evidence'],
      },
    },
    cobertura: { type: 'string', description: 'o que leu e o que não conseguiu cobrir' },
  },
  required: ['findings', 'cobertura'],
}

const prompt = a => `${CONTEXTO}

SUA ÁREA: ${a.arquivos}

FOCO: ${a.foco}

Trabalhe assim:
1. Leia os arquivos da área (Read; arquivos grandes por partes, Grep para achar os pontos de decisão).
   Leia os comentários: eles explicam decisões deliberadas.
2. Para cada suspeita, VOLTE AO CÓDIGO e confirme lendo as funções chamadas; verifique se já não há
   guarda em outro ponto do fluxo. Se puder, rode Node para provar.
3. Reporte no máximo 6 achados, do mais grave ao menos grave. NÃO invente achados para preencher:
   lista curta ou vazia é resposta válida e preferível a ruído.
4. Cada achado precisa de arquivo, linha, cenário de falha CONCRETO e o trecho de código citado.`

const pedidas = Array.isArray(args) ? args : (args ? [args] : [])
const lote = AREAS.filter(a => pedidas.includes(a.key))
const desconhecidas = pedidas.filter(k => !AREAS.some(a => a.key === k))
if (desconhecidas.length) log('Chaves ignoradas (não existem): ' + desconhecidas.join(', '))
if (!lote.length) return { erro: 'Nenhuma área válida no lote. Chaves disponíveis: ' + AREAS.map(a => a.key).join(', ') }

log('Lote de ' + lote.length + ' área(s): ' + lote.map(a => a.key).join(', '))

const resultados = await parallel(lote.map(a => () =>
  agent(prompt(a), { label: 'varre:' + a.key, phase: 'Varredura', schema: FINDINGS_SCHEMA, model: 'haiku' })
    .then(r => ({ area: a.key, arquivos: a.arquivos, ...(r || { findings: [], cobertura: 'agente não devolveu resultado' }) }))))

const saida = resultados.filter(Boolean)
for (const r of saida) log(r.area + ': ' + (r.findings || []).length + ' achado(s)')
return { lote: lote.map(a => a.key), resultados: saida }
