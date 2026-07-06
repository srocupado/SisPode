# SisPode — Sistemas Legislativos do Podemos

Extensão do Chrome para a equipe da **Liderança do Podemos** na Câmara dos Deputados. Reúne sete ferramentas integradas para acompanhamento de sessões, votações, aderência ao governo, gestão de comissões, análise técnica da pauta semanal por IA, produção de pautas da Comissão de Constituição e Justiça (CCJC) e acompanhamento dos vetos em tramitação no Congresso Nacional.

---

## Funcionalidades

### 1. Destaques Legislativos

Analise e oriente a votação de destaques de projetos de lei nas sessões do Plenário.

**Carregamento da pauta**
- Carregue o PDF da pauta comentada da sessão para extrair automaticamente as proposições
- Consulta os destaques de cada proposição em tempo real via API de Dados Abertos da Câmara
- Mantém histórico de sessões anteriores com busca por proposição
- Sincroniza sessões entre dispositivos via **Firebase Realtime Database** (atualização automática a cada 20 s)

**Navegação e edição**
- Filtra destaques por **ativos** ou **todos** com contador por categoria
- Busca por texto na lista de proposições
- Campos editáveis por destaque: **Voto Sim**, **Voto Não**, **Explicação** e **Orientação** — com salvamento automático
- Link direto para a ficha da proposição na Câmara dos Deputados (abre no navegador)

**Análise por IA (Gemini, OpenAI ou Anthropic)**

O usuário escolhe um dos três provedores (Google Gemini, OpenAI ChatGPT ou Anthropic Claude) e fornece a chave de API correspondente. O sistema classifica automaticamente cada destaque e busca o documento-fonte correto para envio ao modelo, evitando alucinações:

| Tipo de destaque | Documento buscado |
|---|---|
| Substitutivo/emenda adotado por comissão (CASO 0) | Inteiro teor do substitutivo adotado, via histórico de pareceres |
| DVS de substitutivo do relator de plenário (CASO 1a) | Substitutivo do relator (arquivo PRLP/SBT) na página de pareceres |
| DVS de subemenda substitutiva de plenário — SSP (CASO 1b) | Arquivo SSP na página de emendas; fallback para página de pareceres |
| DVS de emenda específica numerada (CASO 2) | Texto da emenda via página de emendas da proposição |
| DVS de dispositivo do PL original (CASO 3) | PDF do próprio destaque ou inteiro teor via API |
| Destaque de Preferência (CASO 4) | Upload manual de 2 PDFs pelo usuário |
| **DVS de Subemenda Substitutiva (CASO 5)** | **PRLE (Parecer Preliminar às Emendas) mais recente, via histórico de pareceres** |

- Todos os documentos são enviados ao modelo como **PDF nativo** (no formato específico de cada provedor: `inline_data` no Gemini, `input_file` na Responses API da OpenAI, `document` block no Anthropic), preservando a formatação e evitando truncamento de texto
- O prompt instrui a IA a localizar o dispositivo exato (artigo, inciso, parágrafo) e descrever seu conteúdo com verbos normativos — sem inventar, sem usar conhecimento externo
- **Destaque de Preferência**: o modal exibe automaticamente 2 inputs rotulados ("PDF que recebe preferência" / "PDF a ser comparado"); a IA compara as duas redações e aponta as diferenças
- Suporte a inserção manual de texto ou PDF para substituir a busca automática quando necessário
- Três profundidades de análise configuráveis: **Resumo** (máx. 2 frases), **Completo** (máx. 3 frases) e **Com argumentos** — todas focadas em leitura rápida pelo deputado

**Exportação**
- Exporta cada destaque para **Word (.docx)** com layout formatado
- Formata o conteúdo para envio direto no **WhatsApp** (copia para área de transferência)

---

### 2. Painel de Votação

Acompanhe os votos da bancada em votações nominais do Plenário.

- **Aba Dados Abertos**: busca votações por data via API da Câmara (histórico)
- **Aba Link Portal**: acompanha sessões em andamento pelo portal da Câmara (tempo real)
- Exibe placar detalhado com votos individuais de cada deputado: Sim, Não, Abstenção, Art. 17, Obstrução, Ausente
- Filtra resultados pelo partido informado, com deduplicação robusta de deputados (normalização de nomes entre fontes diferentes) e **complementa a bancada** com os deputados ausentes da votação consultando a API
- Mostra a orientação da bancada para cada votação
- Gera **imagem da votação** em alta resolução para compartilhamento (via html2canvas)
- **Fallback de código-fonte**: se o proxy CORS falhar ao ler a sessão ao vivo, permite colar o HTML da página manualmente

---

### 3. Aderência ao Governo

Calcule o índice de aderência do partido às orientações do governo em qualquer período.

- Selecione intervalo de datas e a sigla do partido
- Exibe o percentual geral de aderência, com contagem de votações aderentes, divergentes e ausências
- **Ranking individual** de deputados ordenável por aderência, divergência ou ausência
- Permite filtrar e detalhar o histórico de votos de um deputado específico, com **gráfico circular (donut)** de aderência por votação no detalhe expandido
- Gráfico temporal da evolução da aderência no período
- **Cache** das votações (Firebase) para reabertura rápida sem reconsultar a API
- Exporta o relatório completo em **Excel (.xlsx)**

---

### 4. Controle de Comissões

Gerencie a participação dos deputados do partido em **comissões permanentes, mistas (MPV) e temporárias**, controlando vagas, acordos e pedidos de designação. O menu superior separa as visões: **Permanentes · Temporárias · MPV · Deputados · Alertas**.

**Comissões Permanentes**
- Lista as 30 comissões permanentes da Câmara
- Configuração do número de vagas (titulares/suplentes) por comissão
- Designação de titulares e suplentes, com marcação de **vaga de acordo** e badge correspondente

**Comissões Mistas de MPV**
- Sincronização automática pela **API da Câmara**: lista as Medidas Provisórias em fase de comissão, descartando as que já viraram lei, perderam eficácia ou avançaram ao plenário (status real da MP), e as orçamentárias (que tramitam na CMO)
- Situação real da comissão — **Em funcionamento** ou **Aguardando instalação** — derivada do evento de instalação, com badge e ordenação (em funcionamento primeiro)
- Exibe o **tema (ementa)** da MP na tela de designação
- Vagas fixas (1 titular + 1 suplente), criação manual de comissão (`+ Nova`), exclusão e **recarregar** (apaga tudo e puxa da Câmara)

**Comissões Temporárias** (sub-abas **CPI / Especiais / Externas**)
- Sincronização pela API da Câmara, listando apenas as **em funcionamento** (instaladas e dentro do prazo; comissões de teste do sistema são descartadas)
- Número de vagas **configurável por comissão** (titulares/suplentes, com opção de manter iguais), já que comissões temporárias têm composição variável

**Recursos comuns a todas**
- **Ceder e receber vagas** por acordo entre partidos, com registro opcional do deputado externo que ocupa a vaga cedida
- **Pedidos de designação**: registre o interesse de um deputado em uma vaga e depois nomeie-o ou rejeite o pedido
- Visão **Por Deputado** com as comissões de cada parlamentar e **Alertas** de acúmulo (comissões mutuamente exclusivas como titular)
- **Impressão da lista de membros em PDF**, com seleção dos grupos a incluir (Permanentes, Mistas, CPI, Especiais, Externas) — cada grupo em nova página
- Exportação completa para **Excel (.xlsx)** (membros, vagas cedidas e pedidos, com o tipo de cada comissão)
- Dados sincronizados entre a equipe via **Firebase**, com cache e atualização automática (auto-sync quando o cache passa de 12 h)

---

### 5. Análise de Pauta de Plenário

Importe a Pauta da Semana e gere análise técnica por IA dos projetos, requerimentos de urgência e redações finais, identificando autoria do Podemos e apensados do partido.

**Importação e enriquecimento**
- Aceita os dois formatos de pauta: **dashboard compacto** da Liderança e **pauta extensa** oficial da Câmara
- O parser identifica **PL, PLP, PEC, PDL/PDC, MPV, PRC, REQ e Redações Finais** (categoria própria, RICD art. 83, I), captando ordem, número, ano e ementa
- Suporte a requerimentos de urgência **sem número de protocolo** ("Requerimento s/nº") — a identidade do item vem do projeto cuja urgência é solicitada
- Enriquecimento automático via API da Câmara: autoria, relator, apensados e classificação de **autoria Podemos** / **apensados Podemos** (badge no card). Decretos legislativos antigos usam fallback **PDL ↔ PDC** quando a sigla atual não retorna na API
- Busca os pareceres de plenário **PRLP/PRLE** mais recentes via scraping da página "Histórico de Pareceres" do portal
- Para Redações Finais, localiza o documento próprio na caixa "Documentos Anexos e Referenciados" da ficha de tramitação
- Adição/remoção manual de itens da pauta com link direto para a ficha da proposição
- Campo **"Responsável"** em cada card (ao lado de "Ver no portal"): texto livre com o nome do(a) analista, salvo junto da análise (e no item da pauta). Aparece na **meta do card** e, no **PDF** exportado, como linha própria **"Responsável: \<nome\>"** logo após os badges de autoria/apensado

**Geração de análise por IA (Gemini, OpenAI ou Anthropic)**

O sistema identifica automaticamente o **cenário de tramitação** da proposição e anexa o(s) documento(s) operativo(s) ao modelo como **PDF nativo** (sem conversão de texto), preservando formatação e evitando truncamento. Os documentos (PRLP/PRLE, SBT-A, SSP e EMS) são raspados das páginas "Histórico de Pareceres" e "Emendas" do portal:

| Cenário | Documento(s) enviado(s) à IA |
|---|---|
| 1 — sem parecer de comissão e sem PRLP | Inteiro teor da proposição |
| 2 — substitutivo adotado por comissão (SBT-A), sem PRLP | **SBT-A** + redação original |
| 3 — PRLP com substitutivo de plenário | **PRLP (+ PRLE)** + redação original |
| 4 — PRLP na forma do substitutivo adotado (SBT-A) | **PRLP + SBT-A** + redação original |
| 5 — PRLP + subemenda substitutiva de plenário (SSP) | **PRLP/PRLE + SSP** + redação original |
| 6 — retorno do Senado com emendas (EMS) | **EMS** + texto aprovado pela Câmara |
| 7 — EMS + parecer de comissão/plenário | **EMS + PRLP/PRLE** + texto aprovado pela Câmara |
| 8 — Medida Provisória (MPV) | **Nenhum** — edição de texto livre, escrita manualmente pelo analista (sem IA) |
| 9 — PEC (Proposta de Emenda à Constituição) | **PRL + substitutivo adotado pela Comissão Especial** (texto de mérito) + redação original; o parecer de admissibilidade da CCJC entra como parecer de comissão |
| 10 — PDL (Projeto de Decreto Legislativo) | **Inteiro teor do decreto** (texto + justificação) + parecer(es) de comissão — com nota técnica **moldada ao subtipo**: sustação de ato do Executivo, outorga de rádio/TV ou ato internacional |
| Requerimento de urgência | Inteiro teor da proposição cuja urgência é solicitada |
| Redação Final | **Documento da Redação Final** (raspado da ficha de tramitação) |

- O prompt-base de projetos/requerimentos produz uma **nota técnica** com as seções **Objetivo · Justificativa · Pareceres e substitutivos · Principais Disposições do último substitutivo apresentado · Argumentos favoráveis e contrários**, sob princípios de clareza, objetividade, imparcialidade e fundamentação
- A seção "Pareceres e substitutivos" é **moldada ao cenário detectado**: a extensão diz à IA qual é o texto operativo (substitutivo de plenário, SBT-A de comissão, subemenda ou emendas do Senado) a ser descrito
- **Cenário 8 — Medidas Provisórias (MPV)**: ao detectar uma MPV, o card **não aciona a IA**. O botão passa a ser **"Escrever análise"**, que abre um **editor de texto livre** em branco para o analista redigir a nota manualmente (sem estrutura de seções imposta), com o mesmo autosave/Firebase das demais. As MPVs ficam **fora do "Gerar todas"** e não exibem os botões de IA (Reanalisar/Regerar) nem o alerta de desatualização
- **Cenário 9 — PEC (Proposta de Emenda à Constituição)**: a PEC tem rito próprio (CCJC para admissibilidade, Comissão Especial para o mérito). A extensão localiza o **último PRL (parecer do relator) e o substitutivo adotado pela Comissão Especial** — o texto de mérito que vai a Plenário — e os envia como documento operativo, com a redação original para o cotejo; o parecer da CCJC entra como parecer de comissão (admissibilidade)
- **Cenário 10 — PDL (Projeto de Decreto Legislativo)**: o texto votado é o próprio decreto (inteiro teor + justificação) e a comissão dá a recomendação. A nota técnica é **moldada ao subtipo** detectado pela ementa: **sustação** de ato do Executivo (art. 49 — foca no ato barrado e no efeito), **outorga** de rádio/TV (nota enxuta: entidade, objeto, município/UF, prazo) ou **ato internacional** (objeto do acordo)
- **Comissão Especial**: identificada pela sigla-dona da própria proposição (`PEC00619`, `PL629902`, `PL233823`…). Em **PECs** é o documento operativo (Cenário 9); em **PLs/PLPs** que passam por comissão especial, seu parecer é capturado e anexado como **"Parecer da Comissão Especial"**, ao lado das comissões permanentes
- Quando há **projeto(s) apensado(s) de autoria de deputado(a) do Podemos**, a extensão baixa o **inteiro teor** de cada um e a nota ganha uma seção **"Projetos apensados de autoria do Podemos"** (antes de "Argumentos favoráveis e contrários") com **um tópico por apensado** (sigla/nº, autor e breve resumo) — independentemente de haver substitutivo. Os apensados são **resolvidos sob demanda na geração** (não dependem do enriquecimento assíncrono ter concluído), e quando o **inteiro teor** não está disponível na API o resumo é feito pela **ementa**, de modo que um apensado identificado nunca fique sem resumo. Havendo **substitutivo/subemenda/redação final** em votação, cada tópico ganha uma **linha própria de avaliação de incorporação**, com um selo de status — **(Acolhido)**, **(Acolhido parcialmente)** ou **(Não acolhido)** — e o chip "Apensado Podemos" do card recebe esse mesmo status entre parênteses. ⚠ Esse status é **sensível**: aparece apenas na tela (card e nota), **nunca no PDF** distribuível, de onde a linha do marcador é removida na exportação
- A detecção de apensados não depende do campo de relação do endpoint `/relacionadas` (que costuma vir vazio): segue a **cadeia de `uriPropPrincipal`** de cada proposição relacionada e considera apensadas as que compartilham a mesma raiz da matéria (cobrindo apensamento em cadeia)
- Quando a **matéria é de autoria do Podemos**, o nome do(a) parlamentar aparece em **negrito + sublinhado** na linha de autoria da nota
- No **índice do PDF**, cada item recebe os sufixos **A** (autoria Podemos) e/ou **AP** (apensado de autoria Podemos) após o apelido — ex.: `PL 1234/2056 (apelido) — A, AP`. Logo abaixo do título "Índice", uma **legenda** explica as marcas (`A = Autoria do Podemos · AP = Autoria do Podemos em apensado`), exibida apenas quando há ao menos um item com A ou AP
- **Detecção de nota desatualizada** (sob demanda): marca com o badge **"⚠ Pode estar desatualizada"** as análises cujo **texto operativo** (PRLP/PRLE, SBT-A, SSP ou EMS) foi superado por um documento mais recente — comparando o que embasou a nota salva com a tramitação atual (por URL **e** data, para não dar falso positivo, ex.: PRLP anterior ao retorno do Senado). Pode ser disparada **por item** (botão "Verificar atualização" no card) ou para a pauta inteira (botão "Verificar atualizações" na barra). A checagem inclui EMS/SSP (cenários 5/6/7). O tooltip do badge indica qual documento novo apareceu; regerar a nota limpa o alerta

- **Geração em lote** ("Gerar todas") com throttle de 1,5 s entre itens, contador de progresso e tratamento isolado de falhas por item
- **Detecção de truncamento** por provedor (`finishReason=MAX_TOKENS` no Gemini, `status=incomplete` na OpenAI, `stop_reason=max_tokens` no Anthropic) com auto-continuação automática que costura a resposta sem duplicar overlap
- Botão **Completar** (amarelo) aparece quando uma análise ainda fica truncada após a auto-continuação — clique para emendar mais um pedaço
- **Retry com backoff exponencial** (5 s / 15 s / 30 s) em respostas 429 (rate limit) e 5xx
- Botão **Parar tudo** (vermelho) aparece quando há qualquer chamada de IA em voo (lote, individual ou Completar) — usa `AbortController` global para abortar fetches em andamento, sleeps de throttle e timers de retry

**Biblioteca de prompts personalizados (Reanalisar com IA)**
- Botão **Reanalisar com IA** em cada card abre o diálogo de prompts: escolha um prompt salvo na biblioteca ou escreva instruções avulsas
- Os prompts ficam em `/prompts_analise/{id}` no Firebase e são **compartilhados com toda a equipe** — criar, atualizar e excluir disponíveis no próprio diálogo
- Marque um prompt como **padrão da equipe** (`/prompts_analise_padrao`) — passa a ser aplicado automaticamente na geração inicial e no "Gerar todas"
- As instruções personalizadas **complementam** o prompt base — moldam ênfase, profundidade e recortes temáticos —, mas **não substituem** a estrutura de seções nem as regras rígidas (sem bullets, sem recomendação de voto, sem informação inventada)
- Para projetos com substitutivo + redação original anexada, o prompt base exige **cotejo dispositivo a dispositivo** (artigos, parágrafos, incisos), apontando o que foi incluído, alterado e suprimido
- Para Redações Finais, o prompt base é mais enxuto (Resumo da Redação Final + Pontos de atenção para o Podemos)

**Edição manual com autosave**
- Editor inline de cada análise em Markdown com **autosave** debounceado em 1,5 s
- Indicador de status: "editando… / salvando… / ✓ salvo às HH:MM:SS / ⚠ erro — tentando de novo"
- Botão **Salvar** faz flush imediato + fecha o editor; **Cancelar** reverte para o snapshot inicial e re-grava no Firebase
- Aviso `beforeunload` se o usuário tentar fechar a aba com save pendente

**Persistência e organização**
- Cada análise é salva no Firebase em `/analises_pauta/{chave}/{parecerKey}`, vinculada à versão exata do parecer (ou ao documento da Redação Final, para itens dessa categoria)
- Biblioteca de prompts em `/prompts_analise/{id}` e prompt padrão da equipe em `/prompts_analise_padrao` — ambos compartilhados entre todos os membros
- **Sidebar de pautas** com alternância entre pautas salvas e exclusão (que limpa também as análises órfãs)
- Garbage collection de análises órfãs no painel de Configurações

**Exportação em PDF institucional**
- Cabeçalho com **logo Podemos** à direita e texto "Liderança do Podemos na Câmara dos Deputados" centralizado
- **Texto justificado** nos parágrafos das análises
- **Seletor de itens para o PDF**: checkbox por card + barra "Selecionar todos / Limpar seleção" com contador, e o botão "Exportar PDF" mostra a quantidade marcada. **Nada selecionado = exporta todos** (comportamento padrão); o índice e a legenda do PDF refletem só os itens escolhidos, na ordem original da pauta
- Itens sem análise mostram placeholder ("Análise não gerada", "Falha ao gerar análise" ou "Análise em processamento") preservando o cabeçalho do item, autor, relator e badges
- Quebras de página respeitam o cabeçalho do item (título + autor + badges seguem junto da primeira linha de análise) mas o corpo flui naturalmente entre páginas, sem espaços em branco

---

### 6. Pautas CCJC

Gere resumos e análises dos projetos de lei da **Comissão de Constituição e Justiça e de Cidadania**, revise os textos e exporte a pauta consolidada em PDF.

**Importação da pauta**
- **Via PDF**: carregue o PDF da pauta da CCJC — o parser identifica automaticamente os projetos listados
- **Via Calendário**: selecione a reunião da CCJC diretamente do calendário institucional

**Geração por IA (Gemini, OpenAI ou Anthropic)**
- O usuário escolhe **um** provedor ativo por vez (chave configurada, compartilhando a mesma configuração do módulo de Plenário); a lista de modelos pode ser carregada ao vivo da API de cada um
- Para cada projeto: envia o inteiro teor ao modelo e gera resumo + análise técnica
- **Análise por comissão**: para projetos com pareceres de mais de uma comissão, considera **apenas os documentos vigentes** (a versão mais recente de cada tipo — PRL, SBT etc. — por comissão), descartando versões superadas
- **Perfis de prompt** (em ⚙ Configurações): biblioteca de instruções complementares compartilhada via Firebase (`/ccjc_prompts`), com um perfil marcado como **padrão da equipe** (`/ccjc_prompt_padrao`) aplicado automaticamente
- Botão **Analisar selecionados**: gera análises apenas dos projetos marcados na sidebar (checkbox por item), além de "Analisar todos"
- **Conferência automática de referências** (anti-alucinação): sinaliza Leis/Decretos/Emendas citados pela IA que não aparecem no documento-fonte
- Suporte a **PDF nativo** (sem conversão de texto) preservando formatação
- Status visual por item: aguardando · processando · pronto · falha, com **badge "Redação Final"** nos itens desse bloco

**Revisão e edição**
- Editor inline de cada análise, com gravação ao trocar de projeto ou ao salvar a pauta (Firebase + cache local)
- Possibilidade de revisar e reescrever trechos antes da exportação
- Histórico de pautas anteriores na sidebar

**Exportação**
- Gera **PDF institucional** da pauta consolidada, com cabeçalho da Liderança e todos os itens revisados

---

### 7. Pauta do Congresso Nacional

Acompanhe os vetos presidenciais em tramitação e as **pautas de Sessão Conjunta** (vetos, PLNs e MPVs de crédito), com resumo e análise técnica por IA para a equipe.

**Pautas de Sessão Conjunta (importação)**
- Na sidebar, **importe a pauta** de uma Sessão Conjunta: escolha entre as **sessões recentes** (lidas da agenda oficial, filtrando as deliberativas) ou **cole a URL/ID** da pauta (fallback robusto)
- O parser extrai os itens deliberativos da Ordem do Dia: **Vetos** (reaproveitam todo o fluxo de dispositivos/razões/resumos) e **PLNs / MPVs de crédito**
- Para cada **PLN/MPV**, a extensão lê a página da matéria (ementa, autor) e localiza o **Parecer de Plenário** (PDF); a IA gera uma **análise técnica curta** (1–2 parágrafos) lendo o parecer como **PDF nativo**. A análise é **editável** (autosave) e pode ser escrita manualmente. Para créditos e leis orçamentárias (LOA/LDO/PPA), um **resumo sintético** da ementa (sem IA) é usado no índice e no cabeçalho do export
- O **export para Word** inclui os PLNs/MPVs da pauta (identificação, autor, ementa e análise), além dos vetos
- As pautas são **compartilhadas com a equipe** via Firebase (`/congresso_pautas`); a lista viva "Vetos em tramitação" continua como visão padrão (botão "Voltar aos vetos ao vivo")

**Listagem oficial (vetos em tramitação)**
- Carrega o **Relatório Resumo de Vetos** oficial (`pdfVetosEmTramitacao` do SISCON/Senado) e reproduz suas colunas: nº do veto, matéria vetada, assunto, *sobrestando a pauta?* (Sim/Não) com a data de início, e a quantidade de dispositivos (ou *Veto Total*)
- **Reproduz fielmente as cores verde/azul** das linhas do relatório, lidas diretamente do PDF (renderização + amostragem de cor), além do tipo (Parcial/Total) e do status de sobrestamento em badges
- Cache local da lista para abertura instantânea; botão **Atualizar lista** rebaixa o relatório do site oficial

**Detalhamento e resumo por IA (Gemini, OpenAI ou Anthropic)**
- Ao **abrir** um veto, a extensão busca a página oficial de detalhe e extrai cada dispositivo vetado (código `NN.AA.NNN`, descrição normativa, texto vetado integral e situação)
- A IA gera automaticamente um **resumo curto (1–2 frases) de cada dispositivo**, explicando em linguagem clara o que ele estabelecia — ou seja, o que deixa de valer com o veto — sem recomendação de voto e sem inventar
- Abaixo da ementa, a IA também gera um **"Resumo do Projeto"** bem sintético (1–2 linhas; 3–4 linhas para Veto Total), explicando o objetivo geral da proposição
- **Razões do Veto**: a extensão localiza o PDF da Mensagem de veto (documento da Presidência da República na aba Documentos), lê o texto e a IA resume os motivos do veto — **agrupando os dispositivos que compartilham a mesma justificativa** (1–2 linhas por grupo, exibidas no primeiro dispositivo do grupo). Em **Veto Total**, gera um resumo único (3–4 linhas) das razões do projeto. Tudo na mesma operação de geração dos resumos
- Botão para **ver o texto integral** de cada dispositivo vetado e link para a página oficial
- Os resumos são **compartilhados com toda a equipe via Firebase** (`/vetos_resumos/{veto}`) e cacheados localmente, evitando reprocessamento e gasto de API

**Busca geral**
- Campo de busca que pesquisa em **todo o conteúdo** — nº, assunto, matéria, lei, códigos, textos dos dispositivos e resumos da IA —, com destaque das ocorrências e expansão automática dos vetos correspondentes
- Botão **Baixar detalhes** (com barra de progresso) que baixa o detalhamento de todos os vetos em segundo plano para habilitar a busca completa no texto

**Geração em lote, parcelamento e retomada**
- Botão **Resumir todos** gera os resumos de todos os vetos pendentes, com barra de progresso; **Parar** cancela qualquer operação de IA/download em andamento
- Vetos grandes (ex.: 340 dispositivos) são processados em **lotes de 15 dispositivos por chamada**, com **persistência incremental** a cada lote — uma falha ou interrupção não perde o que já foi feito
- Em caso de falha parcial, o card mostra **"Continuar (N restantes)"** para **retomar de onde parou** (só os dispositivos ainda sem resumo)

**Edição, perfis de prompt, sessões e exportação**
- Cada resumo é **editável inline** (✎) com autosave (Firebase + cache) e indicador de status; marcador de **sincronização com o Firebase** registra o horário do último salvamento
- **Perfis de prompt** (em ⚙ Configurações): biblioteca de instruções que complementam o prompt base, com um perfil marcado como **padrão da equipe** aplicado automaticamente — compartilhados via Firebase
- **Sessões salvas** (sidebar à esquerda): salve o estado atual da lista (com resumos) como um snapshot nomeado e alterne entre versões; compartilhadas com a equipe
- **Edição inline** também do Resumo do Projeto e das Razões do Veto (além dos resumos dos dispositivos), com autosave
- **Deputados interessados**: em cada veto (lista ao vivo e pauta de sessão) e em cada PLN/MPV, uma faixa permite **marcar os deputados do partido com interesse** no item, com chips dos marcados e um seletor com a bancada. Nos **vetos**, cada deputado marcado pode ainda ter a **posição registrada** — **Derrubar** ou **Manter** o veto — indicada no seletor (botões por deputado) e destacada por cor no chip (vermelho = derrubar, verde = manter); a posição é opcional e clicar na já ativa a remove. A lista de deputados é **híbrida** — lê o cadastro compartilhado `/deputados` (o mesmo das Comissões, populado da API da Câmara) e, se vazio, busca a bancada do PODE direto da API (link "↻ bancada"). A marcação feita nos vetos ao vivo é **compartilhada pela equipe** (`/vetos_resumos`) e **herdada pela pauta** na importação; editável nos dois contextos
- **Seleção de vetos** (checkbox por veto + "selecionar/desmarcar todos") para escolher o que entra na exportação
- **Exportação para Word (.docx) e PDF** dos vetos selecionados (ou de todos os visíveis), com o mesmo conteúdo e formatação: **cabeçalho institucional** ("Pauta do Congresso Nacional" / "Liderança do Podemos na Câmara dos Deputados" centralizados, logo do Podemos à direita e régua verde), **índice na 1ª página** com a página de cada item (links internos clicáveis e **coloridos por casa iniciadora** — verde para Câmara, azul para Senado, com legenda), e, por veto, o Resumo do Projeto, os dispositivos (`código — Resumo: <análise>`) e as **razões agrupadas** (uma por grupo, exibida no primeiro dispositivo do grupo, com "aplica-se a art. X, art. Y…"); inclui também a seção de PLNs/MPVs
  - O **Word** numera o índice via campos (o Word preenche ao abrir); o **PDF** é gerado por impressão paginada com **Paged.js** (numeração de índice via `target-counter`), com "Salvar como PDF"

---

## Instalação

> A extensão não está publicada na Chrome Web Store. Para usar, faça a instalação manual em modo desenvolvedor.

1. Faça o download ou clone este repositório:
   ```bash
   git clone https://github.com/srocupado/sispode.git
   ```
2. Abra o Chrome e acesse `chrome://extensions`
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e selecione a pasta do repositório

---

## Configuração

### Provedor de IA (para análise automática de destaques)

O usuário pode escolher entre três provedores. Apenas um fica ativo por vez — ao trocar, é necessário colar a chave do novo provedor.

| Provedor | Onde obter a chave | Formato da chave |
|---|---|---|
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) → Get API key | `AIzaSy...` ou `AQ....` |
| OpenAI (ChatGPT) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `sk-...` |
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com) → Settings → API Keys | `sk-ant-...` |

Na extensão:

1. Abra **⚙ Configurações** → selecione o provedor no campo **Provedor de IA**
2. Cole a chave de API no campo abaixo
3. Clique em **Carregar disponíveis** para listar os modelos suportados (estática para Anthropic; dinâmica para Gemini e OpenAI)
4. Escolha a profundidade da análise: **Resumo**, **Completo** ou **Com argumentos**
5. Use **Testar conexão** para verificar se a chave está funcionando

### Firebase (para sincronização entre dispositivos)

A sincronização usa o Firebase Realtime Database já configurado no projeto. Nenhuma configuração adicional é necessária para uso interno da equipe.

---

## Estrutura de arquivos

```
sispode/
├── manifest.json               # Manifesto da extensão (MV3)
├── panel.html / panel.js       # Módulo: Destaques Legislativos
├── panel.css                   # Estilos do painel principal
├── votacao.html / votacao.js      # Módulo: Painel de Votação
├── aderencia.html / aderencia.js  # Módulo: Aderência ao Governo
├── comissoes.html / comissoes.js  # Módulo: Controle de Comissões
├── analise.html / analise.js      # Módulo: Análise de Pauta de Plenário
├── ccjc.html / ccjc.js            # Módulo: Pautas CCJC
├── congresso.html / congresso.js  # Módulo: Pauta do Congresso Nacional (vetos + PLNs)
├── background.js                  # Service worker da extensão
├── icons/                         # Ícones da extensão + logo Podemos para o PDF
└── libs/
    ├── pdf.min.js / pdf.worker.min.js   # PDF.js — leitura de PDFs
    ├── html2canvas.min.js               # Geração de imagens
    ├── xlsx.full.min.js                 # Exportação para Excel
    ├── docx.iife.js / docx.umd.js      # Exportação para Word
    └── paged.polyfill.js               # Paginação do PDF (índice com nº de página)
```

---

## APIs e serviços externos

| Serviço | Uso |
|---|---|
| [Dados Abertos da Câmara](https://dadosabertos.camara.leg.br) | Proposições, destaques, votações, deputados |
| [Portal da Câmara](https://www.camara.leg.br) | Sessões em andamento e documentos legislativos |
| [SISCON – Senado Federal](https://legis.senado.leg.br) | Relatório Resumo de Vetos em tramitação (PDF) |
| [Portal do Congresso Nacional](https://www.congressonacional.leg.br) | Páginas de detalhe dos vetos e dispositivos vetados |
| [Firebase Realtime Database](https://firebase.google.com) | Sincronização de sessões entre dispositivos |
| [Google Gemini](https://aistudio.google.com) | Provedor de IA para análise de destaques |
| [OpenAI](https://platform.openai.com) | Provedor de IA para análise de destaques |
| [Anthropic](https://console.anthropic.com) | Provedor de IA para análise de destaques |
| [Codetabs Proxy](https://codetabs.com) | Proxy CORS para acesso a páginas do portal da Câmara |

---

## Permissões da extensão

- `storage` — salva configurações e cache de sessões localmente
- `tabs` — detecta abas abertas do portal da Câmara (sessão em andamento)
- `host_permissions` — acesso às APIs e serviços listados acima

---

## Requisitos

- Google Chrome (versão compatível com Manifest V3)
- Conexão com internet para consultar as APIs da Câmara
- Chave de API de um dos provedores suportados (Google Gemini, OpenAI ou Anthropic) — necessária para geração de análises por IA
