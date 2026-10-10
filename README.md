# SisPode — Sistemas Legislativos do Podemos

Ferramentas para a equipe da **Liderança do Podemos** na Câmara dos Deputados, em duas frentes:

- **Extensão do Chrome** (MV3) — nove módulos integrados para acompanhamento de sessões, votações, relatórios (aderência ao governo, produção legislativa e apuração eleitoral ao vivo, entre outros), comissões (gestão de vagas e pautas dos colegiados), análise técnica da pauta semanal por IA, produção de pautas da Comissão de Constituição e Justiça (CCJC), acompanhamento dos vetos em tramitação no Congresso Nacional, preparação da lista do Colégio de Líderes e orçamento (emendas da bancada, notas técnicas das leis orçamentárias e comparador de portarias) — além do **Labs**, a área de protótipos.
- **Bot do Telegram** (`bot/`, Node.js) — leva a pauta, as análises e o acompanhamento **ao vivo** do Plenário para o grupo da equipe, com conversa em linguagem natural. Compartilha a mesma base no Firebase da extensão. Ver a [seção do bot](#10-bot-do-telegram-sispode-bot).

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
| DVS de substitutivo em **Medida Provisória** (CASO 1-MPV) | **Projeto de Lei de Conversão (PLV)** adotado pela Comissão Mista, localizado na Câmara ou no Senado |

- Todos os documentos são enviados ao modelo como **PDF nativo** (no formato específico de cada provedor: `inline_data` no Gemini, `input_file` na Responses API da OpenAI, `document` block no Anthropic), preservando a formatação e evitando truncamento de texto
- O prompt instrui a IA a localizar o dispositivo exato (artigo, inciso, parágrafo) e descrever seu conteúdo com verbos normativos — sem inventar, sem usar conhecimento externo
- **Destaque de Preferência**: o modal exibe automaticamente 2 inputs rotulados ("PDF que recebe preferência" / "PDF a ser comparado"); a IA compara as duas redações e aponta as diferenças
- Em Medida Provisória, o "substitutivo" é o **PLV**, que não está na página de pareceres da Câmara: o sistema o busca no acervo do Senado/Comissão Mista e, **não o encontrando, não analisa nada** — cair no texto original da MP seria analisar o documento errado
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

### 3. Relatórios

Sete relatórios em abas — sobre votações nominais, produção legislativa, tramitação por tema, leis aprovadas, a apuração eleitoral do TSE e a simulação de sistemas eleitorais —, cada aba com uma linha de descrição do que produz logo abaixo da barra de abas.

#### 3.1 Aderência

Índice de aderência do partido às orientações do governo em qualquer período.

- Selecione intervalo de datas e a sigla do partido
- Exibe o percentual geral de aderência, com contagem de votações aderentes, divergentes e ausências
- A bancada é a de **cada votação**: quem era do partido e estava em exercício naquele dia (pelo registro do voto e, para quem não votou, pelo histórico do deputado) — não a bancada de hoje. Quem saiu do partido conta nas votações em que estava; quem entrou depois não é cobrado antes de entrar
- O período inclui o último dia: a API perde quase todo o dia final do intervalo, então pede-se um dia a mais e descarta-se o excedente
- **Ranking individual** de deputados ordenável por aderência, divergência ou ausência
- Permite filtrar e detalhar o histórico de votos de um deputado específico, com **gráfico circular (donut)** de aderência por votação no detalhe expandido
- Gráfico temporal da evolução da aderência no período
- **Cache** das votações (Firebase) para reabertura rápida sem reconsultar a API
- Exporta o relatório completo em **Excel (.xlsx)**

#### 3.2 Como votou o deputado

Como um deputado — de **qualquer partido** — votou numa proposição ou num intervalo de datas.

- Busca o parlamentar pelo nome; havendo homônimos, a escolha é do analista, com partido e UF à vista
- **Por proposição** (sigla/número/ano): traz todas as votações da matéria, cada uma com o **objeto lido da tramitação** ("DTQ 1: Bloco UNIÃO (PSB): DVS do §10 do art. 23…"), que não existe em campo estruturado da API
- **Por período**: todas as votações do Plenário no intervalo, também com o objeto lido da tramitação
- Votação cujo objeto a tramitação não identifica **fica fora do relatório** — uma linha que só diz o resultado ("Rejeitado o Requerimento.") não diz o que foi rejeitado. O documento informa quantas saíram e por quê
- Distingue quatro situações — aderiu, divergiu, ausente, e **votação simbólica**, que não tem registro individual de voto e por isso não é ausência do deputado; votação sem orientação do governo fica fora do cálculo, com o voto à vista
- Corrige a perda das votações do último dia do intervalo (a API da Câmara as omite; a consulta pede `dataFim + 1` e descarta o excedente)
- **Resumo de cada item** (opcional, na consulta por proposição), em duas camadas:
  - **transcrição literal** do inteiro teor — o que o destaque pedia, a justificação da emenda destacada, a indexação da Câmara e a justificação do autor do projeto —, com link para a fonte. Documento sem justificação sai sem transcrição, em vez de ganhar uma inventada
  - **explicação em linguagem comum**, escrita pelo provedor de IA configurado **a partir dessa transcrição e de mais nada**: "a emenda queria impedir que pessoas endividadas apostassem", em vez de "destaque nos termos do art. 161, II". O modelo é instruído a não citar dispositivo regimental, a não avaliar mérito e a dizer que o documento não detalha quando for o caso. O relatório marca o que é transcrito e o que é gerado, e nomeia o modelo. Sem chave de IA configurada, fica só a transcrição
- **Sustentação do posicionamento** (opcional): um campo pergunta se a matéria exige defesa — **favorável** ou **contrária** — e um campo livre recebe o ponto a enfatizar. O provedor de IA rascunha a argumentação a partir dos documentos e do voto registrado, em **campo editável**: o analista revisa, e o que sai no PDF é o texto dele. A seção **só entra no PDF quando o analista marca** — gerar e incluir são atos diferentes, e a marcação nasce desmarcada. A seção é própria, depois do registro de votos, e o documento declara que é texto argumentativo e se houve revisão humana
  - **A defesa é recusada** quando a posição escolhida contraria o voto registrado no texto da matéria. O relatório diz qual votação contraria e com que voto. Quando as votações do texto foram simbólicas — o caso comum —, a sustentação sai e o documento registra que o voto não estabelece a posição, para que ninguém leia prova onde há só argumento
  - **Defesa focada em itens**: cada item em que o deputado votou Sim ou Não tem o botão **"+ Usar na defesa"**. Com itens marcados, a sustentação trata **só deles** (a explicação da matéria continua como contexto), gerada pelo painel depois da lista, sem refazer a consulta. O **sentido de cada voto** ("pela rejeição da Emenda de Plenário nº 26") é **calculado pelo código** a partir do resultado registrado — lado vencedor ou vencido, aprovação, rejeição, manutenção ou supressão —, nunca pela IA; sem placar, fica "não determinado" e o texto não afirma o que o voto significou. A trava de conflito com o voto no texto principal continua valendo, e item fora do recorte de datas não entra
- **Recorte do relatório**: como a consulta traz a tramitação inteira, uma faixa de datas delimita o que sai no documento — sem consultar a API de novo. Consolidado, gráfico, destaques retirados e exports seguem o recorte, e tanto o PDF quanto a planilha **declaram** que são recorte, dizendo quantas votações ficaram de fora e qual é a extensão completa da matéria
- Exporta em **PDF** (documento de conferência, com índice por sessão, links e o gráfico da distribuição) e em **Excel (.xlsx)**, com o objeto e a situação em colunas próprias

---

#### 3.3 Produção legislativa

O que um deputado — de **qualquer partido** — produziu, sem responder com um número só.

- Traz **todas** as proposições de autoria, seguindo a paginação da API (o teto é 100 por página e a API não avisa que cortou; um mandato inteiro passa de 800 registros)
- Separa **por natureza do instrumento**: mérito (PL, PLP, PEC), fiscalização e controle (RIC, RCP, PFC), relatoria, atuação sobre o texto (emendas, substitutivos, destaques), requerimentos de andamento e peças de processo. O total bruto soma projeto de lei com requerimento de sessão solene — o relatório diz isso em vez de esconder
- Para as **matérias de mérito**, lê a situação de cada uma: quantas viraram norma, quantas aguardam relator, quantas foram arquivadas. É o destino que separa o relatório de um release
- **Relatoria**: a base registra o parecer (PRL, PRLP, PPP, RDF) como proposição do relator, e é assim que a relatoria é contada — não existe rota por relator na API. Ressalva declarada no documento: o parecer não traz vínculo com a matéria relatada
- Filtro opcional por ano · exporta em **PDF** e em **Excel** (resumo, mérito e a lista completa)

#### 3.4 Radar temático

O que está andando na Casa sobre um tema, marcando o que é da bancada.

- Tema escolhido na lista da própria Câmara (`/referencias/proposicoes/codTema`), com palavra-chave e tipo opcionais
- O recorte é pela **data de apresentação, um trimestre por consulta**: a API recusa intervalo de datas maior que 3 meses (HTTP 400). Não se usa o filtro `ano=`, que perde pareceres, emendas e substitutivos (a API os registra com ano 0). Até 8 anos por consulta
- A marca **Bancada** sai de uma segunda consulta com o mesmo filtro restrita ao partido, cruzada por identificador — autoria registrada na base, não inferência pelo nome do autor. Custa duas chamadas por trimestre, não uma por proposição
- Filtro "só da bancada" na tela, sem reconsultar · exporta em **PDF** e em **Excel**

#### 3.5 Leis aprovadas

Ranking de deputados por projetos de sua autoria — inclusive coautoria: todo signatário recebe crédito — transformados em norma jurídica, da **53ª à legislatura corrente**. PL e PLP por padrão.

- A API paginada da Câmara não filtra por situação de tramitação, e os arquivos oficiais em massa (`proposicoes-AAAA.json`, 50–165 MB, um por ano) não têm cabeçalho CORS — um navegador não consegue baixá-los sozinho. A coleta roda no **bot** (processo Node, sem essa barreira): baixa os arquivos, filtra os PL/PLP com situação "Transformado em Norma Jurídica" e grava **só o agregado** (ranking + lista de projetos) em `/leis_aprovadas/{legislatura}` no Firebase — nunca o arquivo bruto. A legislatura corrente é **calculada pela data** (58ª a partir de 1º/fev/2027, 59ª em 2031 — sem constante para trocar) e conferida com a API `/legislaturas` da Câmara (divergência avisa o admin). A corrente tem refresh diário automático; a anterior, refresh semanal por 12 meses depois do fim (projetos dela ainda viram lei após a virada); as demais encerradas são coletadas uma vez. **Travas**: coleta com ano de arquivo faltando, autor não apurado ou menos projetos que o salvo não é gravada
- **Coletar pela extensão** (se o bot parar): a aba é página da extensão, e `dadosabertos.camara.leg.br` está em `host_permissions` — então ela baixa os arquivos em massa direto, sem a barreira de CORS de um site comum. Quando o dado da corrente passa de 3 dias sem atualização, a tela avisa e oferece **Coletar agora**; a seção de coleta também tem um seletor para coletar **qualquer legislatura** (da 53ª à corrente); a gravação passa pelas mesmas travas do bot e registra a origem e a data dos arquivos da Câmara. A tela mostra data **e hora** (Brasília) da última coleta
- **Caminho manual**: quando o analista já tem os arquivos baixados, dá para processá-los direto no navegador (mesma lógica de filtro/agregação do coletor) sem esperar o bot — os arquivos não saem da máquina, e o resultado só vai para o Firebase compartilhado se o analista clicar em **Gravar no banco de dados**
- **Limpar no banco de dados**: apaga o agregado de legislaturas marcadas, para reprocessar do zero — pede confirmação, porque é destrutivo e visível para toda a equipe
- Campo **Nome** com sugestões de deputados (como no "Como votou o deputado"), tiradas do próprio agregado das legislaturas marcadas — inclui quem já saiu da Câmara, ignora acento e não repete quem está em mais de uma legislatura; escolher uma sugestão filtra por aquele deputado
- Filtros locais (nome, partido, UF, condição titular/suplente, só com ≥ 1 projeto) e ranking expansível com a lista de projetos de cada deputado · exporta em **Excel** (ranking e projetos)

#### 3.6 Apuração eleitoral

Painel ao vivo da divulgação oficial do **TSE** (`resultados.tse.jus.br`), relido a cada 30 segundos. Os dados vão do TSE direto para o navegador — nada passa por servidor.

- **Eleição e turno** escolhidos da lista que o próprio TSE publica (`ele-c.json`): só as eleições gerais ordinárias (sem municipais, suplementares e consultas). O **2º turno** entra como "aguardando o TSE" pelo código que o TSE já reserva no 1º e, publicado, vira o padrão — lendo só as UFs que têm 2º turno. Eleições futuras entram sozinhas, se o formato se mantiver; anteriores a 2024 não estão mais no servidor de resultados
- **Todos os cargos** (Presidente, Governador, Senador, Deputado Federal, Deputado Estadual/Distrital) e **todos os partidos**, ou um só (Podemos por padrão; no 2º turno, todos)
- **Mapa do Brasil** (malha do IBGE embutida) colorido pelo percentual de seções apuradas, com o número de eleitos do partido em cada UF; tocar nos estados filtra a lista (vários de uma vez)
- Visões **Por estado** (candidatos em ordem de votos, com a situação do TSE), **Eleitos** (Brasil ou estados escolhidos) e **Cláusula de barreira**
- **Eleito (projeção)**: o TSE só marca eleitos na totalização. Antes disso, são os mais votados de cada partido/federação dentro das vagas que o TSE informa na parcial (nos majoritários, "à frente"). A marcação oficial sempre prevalece, e a tela avisa onde a totalização ainda está pendente
- **Cláusula de barreira** (Deputado Federal) pela regra do ano da eleição — EC 97/2017 (2018: 1,5%/1%/9; 2022: 2%/1%/11; 2026: 2,5%/1,5%/13; de 2030 em diante: 3%/2%/15) —, com federação contando como um partido só. Mostra, por partido, o % no país, os estados com o mínimo e os eleitos (em quantos estados), aponta o estado que faltou a quem passou do % nacional e lista os deputados eleitos por quem não atingiu. **Exporta em PDF** (A4, tema claro, logo do Podemos)
- **Retotalização**: quando o TSE reabre a totalização de um estado (100% apurado, não finalizado, vagas zeradas e nenhum eleito marcado — PE em 06/10/2026), a tela avisa no topo, marca o estado na lista e no mapa (↻), diz no cartão de eleitos que o estado está fora da contagem e ajusta o aviso da cláusula de barreira. Vale para qualquer estado e cargo; some sozinho quando o TSE concluir
- **De onde vieram os votos** (botão 📍 na linha de cada candidato a deputado federal, estadual ou distrital, de qualquer partido): mapa e tabelas por **município** e **zona eleitoral**, com a fatia do candidato nos votos nominais do cargo em cada município, e — no DF automaticamente, nos outros estados sob pedido, com o tamanho do download avisado — por **local de votação** (escolas no mapa pelas coordenadas do TSE, detalhe do bairro mais forte, tabela por bairro e os 20 locais com mais votos). Lê os arquivos de dados abertos do TSE por partes (só o estado; SP por município ≈ 42 MB, DF por local ≈ 32 MB), direto no navegador. **Salvar em PDF** como o da cláusula. **No site** (que não pode ler os zips: o servidor de arquivos do TSE envia o cabeçalho CORS duplicado `*, *` e o navegador recusa) o relatório vem do servidor de **resultados** do TSE, o mesmo do painel, sem intermediário: um arquivo por município (~50 KB; SP inteiro em ~30 s) ou, no DF, por zona eleitoral; o detalhe por local de votação e por zona nos demais estados fica na extensão — ou no site publicado no **Netlify com o `apuracao/_redirects`** (ou `netlify.toml`), que repassa `/tse-dados/*` ao servidor de arquivos do TSE pelo próprio endereço: aí o site faz a leitura completa, igual à extensão, com os dados do TSE lidos na hora (a página detecta o repasse sozinha)
- A última leitura fica guardada no navegador e volta ao reabrir
- A mesma tela existe como **site em arquivo único** (`apuracao/index.html`), para hospedagem estática (Netlify e afins). As duas versões saem do mesmo modelo (`apuracao/apuracao.base.html` + `apuracao/apuracao-site.js`) pelo gerador `node apuracao/gerar-apuracao.js`, que grava o `index.html` (scripts e logo embutidos) e o `extensao.html` (scripts por arquivo, como a extensão exige)

#### 3.7 Sistemas eleitorais

A eleição de deputados **simulada em outros sistemas**, com os votos oficiais do **TSE** lidos na hora — nenhum voto vem embutido na extensão. Só na extensão (página `sistemas/sistemas.html`, em iframe, como a apuração).

- **Eleição**: a corrente pelo servidor oficial de resultados (um arquivo por estado; 2026 inteiro em segundos), e os anos gerais desde 2022 que o servidor já não guarda pelos **dados abertos** (`votacao_candidato_munzona` + `votacao_partido_munzona`), lidos por partes direto no navegador — só as entradas dos estados pedidos, os dois cargos numa leitura. O Brasil inteiro de 2022 são ~290 MB (a tela avisa e pede confirmação; SP sozinho ~90 MB, em ~25 s; o resto do país ~85 s); a leitura fica guardada no navegador (IndexedDB) **só enquanto o arquivo do TSE for o mesmo** (ETag/data/tamanho conferidos a cada leitura)
- **Cargo**: deputado federal, ou estadual e distrital; **abrangência**: Brasil ou um estado
- **Proporcional (atual)** — Código Eleitoral, arts. 106 a 111, com a Lei 14.211/2021 e a decisão do STF (ADIs 7228/7263/7325): quociente eleitoral (fração acima de meio arredonda), QP com candidato de 10% do QE, sobras pelas maiores médias entre agremiações com 80% do QE e candidatos com 20%, 3ª fase aberta a todas, art. 111 se ninguém alcança o QE; federação conta como uma agremiação. **Com a regra vigente reproduz o resultado oficial**: 2026 em 54 de 54 (27 UFs × Câmara e Assembleia) e 2022 em 27 de 27 nos dois cargos. Parâmetros ajustáveis: os três percentuais, a 3ª fase (aberta ou só com 80%) e as federações (desligadas: cada partido sozinho, com os seus votos nominais e de legenda)
- **Distritão**: os mais votados de cada estado; voto de legenda não elege. Mostra o "corte" (votos do último eleito) em cada estado
- **Distritão misto**: parte das vagas aos mais votados, parte à votação da agremiação (nominal + legenda) pelas maiores médias; **% mais votados × lista** ajustável, modelo **paralelo** (a lista divide só a sua parte) ou **compensatório** (a proporção vale para o total e a lista completa quem ficou abaixo), e cláusula de desempenho para a lista. A lista é preenchida pelos candidatos da agremiação ainda não eleitos, na ordem de votos; os dados têm um voto por eleitor, então o "segundo voto" (na lista) segue o primeiro
- **Distrital misto**: parte das vagas (ajustável, 50% por padrão) em distritos de um eleito, o resto pela lista, **paralela** ou **compensatória**, com cláusula opcional para a lista. Quem leva o distrito: a **agremiação mais votada** ali, com o seu candidato mais votado no distrito (padrão), ou o **candidato mais votado**; um candidato ganha um distrito só. Os distritos não existem no Brasil — são **desenhados na hora**, só com dados públicos:
  - **unidades**: os municípios (malha do IBGE em TopoJSON: contorno e vizinhança exata pelas divisas comuns); o município com mais eleitores que 60% de um distrito entra **dividido nas zonas eleitorais** (posição = média das coordenadas dos locais de votação pesada pelos eleitores; vizinhança = zonas mais próximas e as da divisa); ilhas ganham uma "ponte" para a unidade mais próxima
  - **município criado depois do Censo 2022** (Boa Esperança do Norte, MT, saído de Sorriso): sem população no censo, entra pelos eleitores × a razão população/eleitores do estado, e essa estimativa sai da população do município de origem, que o censo contou com o território dele (sem contar duas vezes)
  - **tamanho**: eleitores aptos (TSE, `detalhe_votacao_munzona`) ou, à escolha, a **população residente do Censo 2022** (IBGE, agregado 4709, lida na hora; num município dividido, a população se reparte entre as zonas na proporção dos eleitores, porque o censo não tem recorte por zona; SP: 35 distritos de ~1,27 milhão de habitantes, desvio máximo 4,2%); votos por candidato e legenda por município e zona (`votacao_candidato_munzona`, `votacao_partido_munzona`); coordenadas (`eleitorado_local_votacao`) — lidos por partes, só os estados pedidos (SP ≈ 80 MB; o país em 2026 ≈ 270 MB, em ~2 min, com confirmação), guardados no navegador enquanto os arquivos do TSE forem os mesmos
  - **desenho**: bisseção recursiva (cada pedaço cresce de uma ponta, ao longo de um eixo, até a proporção de eleitores dos distritos que lhe cabem; vários eixos e pesos testados, fica o melhor) e trocas na fronteira que reduzem o desvio sem romper a contiguidade (levando junto pedaços que ficariam soltos). Conferido com os dados de 2026: SP federal em 35 distritos com desvio máximo de 5% (médio 1,3%), MG 2,3%, ES 1,1%, DF 2,5%, RJ estadual 10,5% — todos contíguos; SP em ~0,5 s
  - **métricas** na tela: desvio máximo e médio do eleitorado (aviso acima de ±15%, a referência alemã), compacidade média, municípios divididos, contiguidade, unidades usadas. Com muitos distritos (ex.: 100% distrital), a zona eleitoral é a menor peça e o desvio sobe (SP: 17%)
  - **número de distritos**: vagas × fração **arredondado** (padrão; 9 vagas → 5) ou só a **parte inteira** (9 → 4), como no PL 9.212/2017
  - **segundo voto (cenário)**, com chaves liga/desliga — os dados do TSE têm um voto só; com dois, parte do eleitor vota no distrito diferente da lista. Só o voto do distrito muda; a lista segue a votação de cada agremiação: **voto útil no distrito** (a fração escolhida dos votos de quem não está entre os dois primeiros de cada distrito passa para eles — meio a meio, a hipótese neutra, ou toda para o aliado, se um dos dois é aliado; repartir pela força dos dois nunca mudaria quem ganha) e **alianças no distrito** (pares de partidos, encadeáveis; em cada distrito, dos aliados só o mais votado ali lança candidato, com os votos dos outros). O cenário aparece na faixa, no relatório e no memorial. Em 2026, no cenário do Senado: voto útil de 20% a 40% muda 2 a 5 distritos e quase nada nas bancadas; aliança do Podemos com PSD ou MDB leva o Podemos de 4 para 8 a 10 distritos e de 21 para 23 cadeiras
  - **Regras de um projeto** (três botões; o que está em vigor fica marcado com ✓). Textos conferidos na Câmara (out/2026: PL 9.212/2017 na CCJ, relator Domingos Neto, PSD-CE, aguardando parecer):
    - **PL 9.212 (Senado)** — PLS 86/2017 (José Serra), aprovado em 21/11/2017: metade das vagas em distritos (parte inteira), distritos por **população** com ±5% (±10% em 1 distrito ou 10% deles), a agremiação mais votada leva o distrito, **compensatório** (maiores médias sobre todas as vagas, art. 105-B; quem ganha mais distritos do que isso fica com eles e as vagas saem das últimas posições da lista, art. 105-C, sem aumentar a Casa), sem quociente nem cláusula
    - **Substitutivo da CCJ (2021)** — parecer de Samuel Moreira (2019, reapresentado em 02/03/2021, não votado): o mesmo cálculo, mas distritos por **eleitores** com ±10%; lista preordenada com alternância de sexo
    - **PL 9.213 (apensado)** — PLS 345/2017 (Eunício Oliveira), aprovado no mesmo dia: por eleitores com ±10%, e o excedente **aumenta a Câmara** (art. 105-B, § 2º)
    - Premissas (no relatório, em *Método e fontes*): os projetos têm dois votos e lista preordenada; os dados do TSE têm um voto, que vale para as duas partes, e a lista vai na ordem de votos — muda os nomes, não as cadeiras de cada partido
  - **Tolerância de tamanho** (botão ✎, caixa de diálogo): o desvio admitido em todos os distritos, a exceção (até ±X% em até N distritos ou Y% deles, o que for maior) e atalhos (PL 9.212: ±5% e ±10% em 1 ou 10%; PL 9.213 e substitutivo: ±10%; Alemanha: ±15%). **Só conferir** (padrão: o desenho busca o menor desvio e a tolerância diz quais estados cabem — os de fora podem ser afinados pelos locais de votação) ou **desenhar até a tolerância** (as trocas na fronteira param quando todos cabem e, entre as tentativas que cabem, fica a mais compacta: com tolerância maior, distritos mais compactos e outro resultado). Em 2026: Senado ±5%, 25 de 27 estados dentro; desenhando até a tolerância, compacidade 0,73 → 0,77 e o Podemos 21 → 23 — o próprio mapa mexe em 2 cadeiras
  - **Excedente e divisor** (botão ✎, caixa de diálogo; no compensatório): **corta das listas** (PL 9.212, a Casa fixa), **a Câmara cresce** (PL 9.213: cada distrito além da cota vira cadeira a mais), **compensação total** (Alemanha 2013–2023: a Casa cresce até a cota de todos cobrir os distritos) ou **excedente não leva** (Alemanha desde 2023: o distrito além da cota não dá cadeira — sai o vencedor de menor votação relativa, que segue na disputa da lista; o mapa o deixa sem cor), com **teto** opcional de cadeiras a mais por estado (o que passar, corta) e o divisor **D'Hondt** ou **Sainte-Laguë**. Com a Casa maior, os hemiciclos e os números grandes mostram o tamanho e a fatia do Podemos; o resumo diz quantos distritos passaram da cota, de quais partidos, e de quem saíram as vagas (ou quantas cadeiras a mais); o memorial refaz cada regra por fórmula
  - **afinação pelos locais de votação** (a pedido, botão *Afinar com os locais de votação* nos estados fora da tolerância escolhida): lê a **votação por seção** do TSE (`votacao_secao_{ano}_{UF}`, um arquivo por estado; RR ≈ 5 MB, RJ ≈ 290 MB) e o cadastro dos locais (`eleitorado_local_votacao`: eleitores e posição de cada local; o local que mudou de número depois da eleição vai pelo `NR_LOCAL_VOTACAO_ORIGINAL`); as zonas na fronteira entre distritos — e, se ainda preciso, os municípios da fronteira — se dividem nos seus locais (cada um com a sua fatia do peso da zona, pelos eleitores), e as trocas na fronteira continuam com essas peças, pesando também a compacidade, até ±1% do alvo. Os votos de cada local repartem o total da zona (só os válidos, inteiros, maiores restos) na proporção dos votos do local na votação por seção — os totais da zona ficam iguais. Guardado só na memória da página. Conferido em 2026: RR por população, de 37,1% para 1,6% de desvio máximo, contíguos
  - **mapa** dos distritos no detalhe do estado (cor por distrito, vizinhos sempre de cores diferentes, ou pelo partido eleito), recorte da capital por zona eleitoral e a **tabela dos distritos**: eleitores, desvio, municípios e zonas, eleito, votos no distrito, fatia da agremiação e a 2ª colocada
- **Layout da tela**: os sistemas numa **faixa** logo abaixo da seleção (cada um com o resumo dos parâmetros em vigor e a marca "alterado"; **Ajustar ▾** abre os controles daquele sistema embaixo, em largura toda), a leitura dos votos por município e "Voltar à regra vigente" na linha seguinte; o resultado em seções arejadas: a frase com a faixa de cadeiras do Podemos e os **números grandes** de cada sistema → **a Câmara em cada sistema** (hemiciclos) → blocos **recolhíveis**: resumo em texto, indicadores, quem entra e quem sai, estado a estado (com o detalhe do estado clicado), distritos por estado, método e fontes — cada bloco lembra se estava aberto → **o mapa dos distritos** (num estado só, o detalhe dele) → **bancadas por partido** (os 10 maiores; "ver todos" abre o resto). O relatório em PDF segue completo, na ordem de sempre
- **Resultado**: bancada do Podemos em cada sistema (com a diferença para o oficial e quantas cadeiras mudam de mãos), **hemiciclos** lado a lado com a mesma ordem de partidos, **bancadas por partido** com Δ, **quem entra e quem sai** do Podemos em cada sistema, e a tabela **estado a estado** (vagas, QE, corte, Podemos por sistema, trocas) — clicar num estado abre o detalhe dele (partidos e quem entra/sai, de todos os partidos)
- Os parâmetros recalculam na hora, sem reler o TSE; **Voltar à regra vigente** desfaz tudo
- Estado em **retotalização** ou com apuração em andamento: a tela avisa e o deixa fora da comparação nacional
- **Resumo** escrito a partir dos números (bancada do Podemos em cada sistema, o mais e o menos favorável, faixa de proporcionalidade e de fragmentação, quem mais ganha e perde, distritos ganhos) e **indicadores** por sistema: partidos com cadeira, **número efetivo de partidos** (Laakso-Taagepera), **índice de desproporcionalidade de Gallagher** (votos nominais e de legenda de cada partido × cadeiras), maior bancada, cadeiras que mudam de mãos, quem mais ganha e quem mais perde
- **Relatório em PDF** (A4), o comparativo completo: parâmetros, resumo, indicadores, bancada do Podemos, hemiciclos, bancadas por partido, quem entra e quem sai, estado a estado, distritos por estado (qualidade do desenho em cada UF), o detalhe do estado aberto com o mapa e a tabela dos distritos, e **método e fontes**
- **Mapa dos distritos do Brasil** (com o país lido): todos os distritos desenhados num mapa só, pintados **por distrito** (vizinhos no mesmo estado com cores diferentes) ou **pelo partido eleito** (com a contagem de distritos por partido), com o contorno dos estados (malha de UFs do IBGE, lida na hora); município dividido entre distritos fica com a cor do distrito de maior peso. Na tela, nas cores da interface; **passando o mouse** sobre um distrito (no mapa do Brasil e no de cada estado), ele fica em destaque e uma dica mostra o estado e o número, o município sob o cursor, o tamanho e o desvio, os municípios, o eleito (votos e fatia) e as duas primeiras agremiações. **Zoom** nos mapas (Brasil e estados): botões + / − / ⟲, Ctrl + roda do mouse (ou a pinça do trackpad), duplo clique aproxima (Shift + duplo clique afasta), arrastar move; até 40×; no Brasil, ampliando, aparecem as zonas e os locais de votação das capitais em pontos; o zoom de cada mapa se mantém quando se troca a cor ou um parâmetro; os números dos distritos ficam do mesmo tamanho na tela em qualquer zoom. Botões **Baixar imagem (PNG)** (alta resolução, fundo branco, com título, parâmetros, legenda e fontes) e **SVG** (vetorial); o detalhe de cada estado tem os mesmos botões, com os municípios divididos em cinza e as zonas e os locais de votação em pontos. Entra também no relatório em PDF
- **Memorial de cálculo** (planilha Excel, botão ao lado do PDF): cada conta refeita por **fórmula**, a partir dos votos de cada candidato — aba *Candidatos* (os votos do TSE) → *Votos* (nominais válidos por SOMASES + legenda) → *Estados* (válidos contra a soma das agremiações; QE do art. 106 por fórmula, contra o QE do arquivo do TSE) → uma aba por sistema: **proporcional** (QP = INT(votos ÷ QE), eleitos no QP = mín(QP; candidatos com 10% do QE), as **sobras rodada a rodada** com a média de cada agremiação que pode disputar e a maior média por ÍNDICE/CORRESP), **distritão** (ranking e linha de corte), **distritão misto** e **distrital misto** (a tabela de quocientes votos ÷ 1, 2, 3… e as cadeiras = quocientes entre os N maiores, por CONT.SE com MAIOR; no compensatório, o alvo, a lista = mín(candidatos que restam; máx(0; alvo − 1ª parte)) e os **cortes do excedente** passo a passo pela menor média; no distrital, o tamanho de cada distrito somado na aba *Distritos (composição)* — municípios, zonas e locais de votação — e quem leva cada distrito) → *Eleitos* → *Bancadas* (CONT.SES) → *Indicadores* (nº efetivo de partidos e Gallagher por fórmula). Cada conta tem a coluna **Confere** (CONFERE/DIVERGE) contra o simulador; o *Leia-me* soma as divergências de cada aba. A planilha leva também os valores calculados; o Excel ou o LibreOffice recalculam ao abrir. Conferido em 2026 recalculando no LibreOffice
- Os núcleos (`sistemas-nucleo.js`, `sistemas-distrital.js`, `sistemas-memorial.js`) são puros e testados (`testes/sistemas.test.js`, `testes/sistemas-distrital.test.js`, `testes/sistemas-memorial.test.js`)

---

### 4. Comissões

O card **Comissões** abre dois painéis, escolhidos num menu: **Gestão** (vagas da bancada) e **Pautas de Comissões** (reuniões e pareceres em votação em cada colegiado).

#### 4.1 Gestão

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
- **Cadastro de deputados** (compartilhado com a Pauta do Congresso): **Atualizar da Câmara** puxa a bancada em exercício da API, acrescenta quem chegou e **retira quem saiu** (fim de mandato na posse da nova legislatura, troca de partido, licença). Não saem: quem ainda ocupa vaga em comissão (o aviso lista para retirar da comissão antes), os incluídos à mão e as exceções fixas de licenciados acompanhados; com resposta da API incompleta, ninguém sai

#### 4.2 Pautas de Comissões

Uma aba por colegiado e uma aba **Semana**: calendário das reuniões deliberativas, pauta importada da Câmara e nota por IA sobre **o parecer em votação** em cada item. É o módulo de Plenário aplicado às comissões — sem cenários de tramitação, porque na comissão há sempre um parecer único a analisar.

- **Abas**: as **30 comissões permanentes** da Câmara, cada uma com seu calendário. A CCJC tem módulo próprio (item 6) e também aparece aqui
- **Semana**: todas as reuniões deliberativas da semana, agrupadas por dia, com navegação entre semanas e badge de quantas reuniões cada comissão tem. Permite **gerar as análises de todas as pautas de todas as comissões** de uma vez, com limite de chamadas paralelas e intervalo entre elas (configurável), para não saturar o provedor
- **Calendário por comissão**: os dias com reunião deliberativa são marcados; ao escolher o dia (e a reunião, quando há mais de uma), aparece a prévia dos itens antes de importar
- **Importação da pauta**: lê os itens da reunião pela API da Câmara (`/eventos/{id}/pauta`), com relator, parecer (PRL), ementa e situação do item. O parecer e o inteiro teor da proposição são anexados ao modelo como **PDF nativo**
- **Nota por item**: **Objetivo · O que a comissão vota · Principais disposições do texto em votação · Emendas na comissão · Papel da comissão neste item · Pontos de atenção para a bancada · Argumentos favoráveis e contrários**. O papel é derivado do colegiado — **admissibilidade** na CCJC, **adequação financeira e orçamentária** na CFT, **mérito** nas demais, e "misto" quando o próprio parecer também examina o mérito. Requerimentos têm formato próprio
- **Provedor e prompt por comissão** (submenu em cada colegiado): o analista pode fixar um provedor/modelo diferente do global e escrever um **prompt extra** só daquela comissão — instruções permanentes que complementam o prompt base sem substituir a estrutura de seções. Sem configuração própria, vale o provedor global (o mesmo do Plenário)
- **Edição inline** de cada nota (Quill, com autosave), **exportação em PDF institucional** da reunião e **apagar pauta importada** (botão na reunião e ✕ na lateral), que remove reunião, análises e índice
- Reuniões, análises e configurações por comissão ficam no Firebase em `pautas-comissoes/` — **compartilhadas com a equipe**; o calendário e a lista de órgãos têm cache local

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
- Adição/remoção manual de itens da pauta com link direto para a ficha da proposição. Aceita **projetos e requerimentos** (REQ/REC); no requerimento, o **projeto cuja urgência é pedida** pode ser informado ou é **lido da ementa** da API — é ele que a análise vai ler. O campo **"Nº na pauta"** insere o item **na posição certa** (útil para completar um item que faltou, sem reimportar o PDF e descartar as análises já geradas); número já ocupado é avisado, e nada é renumerado por conta própria
- **Pauta Manual** (botão no cabeçalho): cria a pauta **sem PDF** — para quando a Câmara não divulga o documento. Dá nome à pauta e cola as proposições (várias de uma vez, em qualquer grafia: "pl4822/25"); cada referência é **validada na API** antes de entrar, e referência não localizada **bloqueia a criação** (nada é descartado em silêncio). A pauta criada é indistinguível de uma importada: análises, exportações, bot e histórico funcionam igual
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
| 8a — MPV sem parecer da Comissão Mista | **Texto original da Medida Provisória** (inteiro teor editado pelo Executivo) |
| 8b — MPV com PLV (Comissão Mista) | **Parecer da Comissão Mista** (relatório + conclusão + PLV anexo) ou **Relatório Legislativo do Senado + PLV**, mais o texto original para o cotejo |
| 9 — PEC (Proposta de Emenda à Constituição) | **PRL + substitutivo adotado pela Comissão Especial** (texto de mérito) + redação original; o parecer de admissibilidade da CCJC entra como parecer de comissão |
| 10 — PDL (Projeto de Decreto Legislativo) | **Inteiro teor do decreto** (texto + justificação) + parecer(es) de comissão — com nota técnica **moldada ao subtipo**: sustação de ato do Executivo, outorga de rádio/TV ou ato internacional |
| Requerimento de urgência | Inteiro teor da proposição cuja urgência é solicitada |
| Redação Final | **Documento da Redação Final** (raspado da ficha de tramitação) |

- O prompt-base de projetos/requerimentos produz uma **nota técnica** com as seções **Objetivo · Justificativa · Pareceres e substitutivos · Principais Disposições do último substitutivo apresentado · Argumentos favoráveis e contrários**, sob princípios de clareza, objetividade, imparcialidade e fundamentação
- A seção "Pareceres e substitutivos" é **moldada ao cenário detectado**: a extensão diz à IA qual é o texto operativo (substitutivo de plenário, SBT-A de comissão, subemenda ou emendas do Senado) a ser descrito
- **Cenário 8 — Medidas Provisórias (MPV)**: o acervo da MPV (emendas, relatório, PLV) é da **Comissão Mista**, no Senado/Congresso, não da Câmara. A extensão o localiza e escolhe o subcenário: **8a**, quando ainda não há parecer — a nota descreve o texto original do Executivo; **8b**, quando há **Projeto de Lei de Conversão**, e a nota relata as emendas acolhidas e compara o PLV com o texto original. Quando o PLV é **proposta do relator** e a Comissão Mista ainda não concluiu, a nota diz isso explicitamente e **nunca apresenta o PLV como texto aprovado**. Não se localizando nenhum documento, o card abre a **edição livre**, um editor em branco para o analista redigir a nota à mão, com o mesmo autosave das demais
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

**Parecer de Especialista** (documento longo, por item)

Além da nota técnica, cada card pode gerar um **parecer de especialista**: um documento longo, com evidência rastreada, para subsidiar o analista em matéria que a bancada vai discutir a fundo. É um pipeline de **6 a 9 chamadas** ao modelo (7 a 12 minutos, 250 a 350 mil tokens) — o diálogo de geração avisa o custo antes de começar.

- **Etapas**: apuração (achados com o trecho exato do documento) → conferência de cada trecho no PDF, descartando o que não se localiza → dossiê (lei vigente, séries e estimativas oficiais) → ficha do objeto (regra vigente → regra proposta → data de efeito) → tese em JSON com identificadores de evidência → **contraditório** (revisor adversarial que refuta unidades da tese) → redação → portões e rubrica mecânica
- **Lei vigente por cascata declarada**: Portal da Legislação da Câmara (LEGIN, texto atualizado) → Planalto (texto compilado) → LexML/Senado (texto publicado) → transcrição no próprio documento analisado. A **origem de cada texto vai impressa na ficha**, e texto original de norma já alterada não vale como regra vigente
- **Seções do documento**: Síntese · Contexto e processo · Lei vigente e datas de efeito · Jurisprudência sobre normas análogas · O que se previu · O que aconteceu · Experiência de outros países e entes · Avaliação da política · Quem se posicionou e como · Implementação e custo de conformidade · Os dois lados · Quem disputa o quê · Opções e consequências · Aprimoramentos e sugestões de emenda · Prioridade e viabilidade · Respostas por lente · Conclusão. As condicionais só entram quando a tese as alimenta
- **14 lentes** temáticas (processo legislativo, constitucional, tributário, orçamentário, administrativo, previdência, regulação, consumidor, penal, ambiental, saúde, educação, trabalho, digital) são acionadas pela ementa e pelos temas oficiais da matéria; as aplicadas e as descartadas ficam registradas
- **Busca na internet** (quando o provedor oferece): experiência comparada de outros países e entes, jurisprudência de normas análogas, normas infralegais e posições públicas de atores. As fontes vão **nomeadas no texto e listadas ao fim do parecer**, com a ressalva de que não são conferidas pelo programa
- **"Quem disputa o quê"**: a seção captura os **embates** — duas ou mais partes identificáveis querendo coisas incompatíveis do mesmo dispositivo — com o que cada lado quer, o que a tramitação fez com a disputa e seu estado (resolvido pelo substitutivo, aberto, deslocado para emenda, sem contraparte documentada). Cada emenda da tramitação tem de aparecer num embate ou ser declarada sem conflito
- **O parecer nunca recomenda voto nem defende posição** e não atribui causalidade à medida: apresenta as opções, as consequências de cada uma e o que falta saber. Posição de terceiros entra como relato, sempre atribuída a quem a defendeu
- **Dois documentos, dois leitores**: o **parecer** que circula (ficha do objeto, o que está em jogo, tramitação, o que muda na lei, as seções, limites e fontes — sem identificadores, sem jargão do método) e o **relatório de conferência**, de uso interno, aberto por botão próprio no card (rubrica M1–M14, tese com evidências, achados descartados, refutações do contraditório, lentes, chamadas, tokens e duração)
- **Pontos de atenção**: os portões mecânicos que se resolvem sozinhos são aplicados ao texto, e a redação é refeita **uma vez** com as correções. O que persistir **não reprova o parecer** — vira ponto de atenção no relatório de conferência ("SEM RESSALVAS" / "COM RESSALVAS"), dizendo ao analista onde olhar. O parecer sai sempre
- **Modelo**: exige ao menos a **faixa intermediária** do provedor — a faixa econômica tende a completar lacuna com o plausível, que num parecer técnico é o erro de maior consequência. A escolha (e qualquer ressalva sobre ela) fica registrada no relatório
- Pareceres salvos no Firebase em `/pareceres/{chave}`, com a meta lida à parte para não baixar o documento inteiro ao abrir a pauta

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
- **Sidebar de pautas** com alternância entre pautas salvas e exclusão (que limpa também as análises órfãs). Duas pautas do **mesmo dia** (sessões distintas) convivem sem se sobrescrever
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

### 8. Reunião de Líderes

Módulo com **três sistemas internos**, navegados por abas no topo: **1 · Análise da Lista** (o PDF do Colégio de Líderes vira planilha de resumo), **2 · Demandas de Deputados** (registro dos interesses que os deputados manifestam sobre matérias) e **3 · E-mail de Demandas** (seleção das demandas registradas e formatação do texto de envio). Trocar de aba não descarta nada — cada sistema fica como estava.

A divisão de trabalho é deliberada e vale para os três: **o que é fato vem da fonte, o que é redação vem da IA**. Situação da urgência, apensação, relatoria de Plenário, parecer, cenário e as marcações do Podemos são **derivados por regra fixa** dos Dados Abertos — sem IA, em segundos, porque nesses campos um erro de leitura vira informação errada na mão do líder. Só objetivo, justificativa e o comparativo passam pelo modelo, sempre com o inteiro teor anexado.

**Leitura da lista (PDF)**
- A lista é uma tabela cujas colunas se separam por **posição horizontal**, com a descrição quebrando em várias linhas e o número do item aparecendo no meio do bloco. O parser recorta por coluna e agrupa os blocos entre os números, tratando quebra de página e cabeçalho repetido (que reaparece no meio das páginas) como fronteira de linha
- A **grade de colunas é detectada no próprio documento** — ela muda de uma reunião para outra, e uma grade fixa faz o regime vazar silenciosamente para dentro da descrição
- Itens com mais de uma proposição (apensado + principal) rendem **uma linha por proposição**; marcadores da célula (como `- EMS`) viram etiqueta ao lado do número

**Etapa de documentos (a mesma taxonomia do módulo de Plenário)**
- Cenários 1 a 10 com a mesma numeração e prioridade do `analise.js`: inteiro teor, substitutivo de comissão, parecer de Plenário, subemenda, **retorno do Senado (EMS)**, PEC e PDL. A fonte aqui é `/proposicoes/{id}/relacionadas`, que expõe os mesmos tipos (`PRLP`, `SBT-A`, `PPP`, `RDF`, `AA`, `EMS`, `PSS`…)
- Havendo texto posterior ao apresentado, a coluna **"O que mudou"** lista em poucos itens o que ele altera, inclui ou suprime — e as duas peças vão anexadas à IA, cada uma com rótulo
- No retorno do Senado, o texto que saiu da Câmara é o **autógrafo** (ou a redação final), e o parecer da Câmara às emendas só conta se for **posterior** a elas

**Fatos que a reunião exige**
- **Situação**: "Urgência aprovada (REQ. n/aaaa)", "Requerimento de urgência apresentado" ou "Não há requerimento" — e, quando a lista e os Dados Abertos divergem, a **contradição é declarada**, não resolvida por chute
- **Apensação e urgência**: se a proposição é principal ou apensada, e **a qual delas o requerimento de urgência se refere** (o REQ pode pedir urgência para o apensado, não para o principal)
- **Autoria, coautoria, relatoria e apensados do Podemos**, com o nome do(a) deputado(a) — o pertencimento ao partido vem **sempre da ficha do deputado nos Dados Abertos**, nunca de lista fixa no código

**Produtos**
- **PDF** no padrão do módulo de Plenário (cabeçalho institucional, logo, filete verde), em A4 paisagem, com as linhas do Podemos **tarjadas de amarelo** e selo nomeando quem dá o atributo
- **Planilha (.xlsx)** com as mesmas colunas mais colunas de conferência (alertas, ementa, célula original do PDF, cenário, links)
- **Mensagem de WhatsApp** "Projetos do Podemos" — um bloco por item de autoria, apensado ou relatoria do partido
- Tabela **editável** na tela (todos os campos), reuniões **compartilhadas via Firebase**, e reunião salva antes de um campo existir **se atualiza sozinha** ao ser reaberta

**Anti-alucinação**
- Situação, relatoria, apensação e cenário não passam pela IA
- Toda **lei citada por número** no texto gerado é conferida contra a peça original; o que não bate sai marcado na coluna Alertas
- Sem inteiro teor disponível, a justificativa vira frase de abstenção explícita — o modelo não preenche a lacuna

**Sistema 2 — Demandas de Deputados**
- O analista digita **só quatro campos**: tratamento (Deputado/Deputada), quem demanda, a proposição e a natureza da demanda (ex.: "Solicitar relatoria"). **Autoria, ementa e situação vêm da API da Câmara** pelas mesmas regras fixas do sistema 1 — o botão "Registrar" só habilita depois de "Buscar na Câmara" dar certo, o que impede registro de campo digitado à mão
- Autoria no padrão de registro da Liderança ("Bacelar PV/BA"), com partido e UF da **ficha do deputado** nos Dados Abertos
- Demandas agrupadas por deputado, com a natureza editável no cartão; quando a **situação de hoje difere da do dia do registro**, o cartão ganha a marca "situação mudou desde o registro" (e ↻ reconsulta na hora)
- Cada cartão traz o histórico **"Listas do Colégio"**: em quais listas do sistema 1 a proposição apareceu (com o número do item) — calculado na hora, nunca gravado
- **Atendimento**: a demanda pode ser marcada como **atendida**, dizendo **em qual Reunião de Líderes** (a reunião em que a proposição apareceu em lista vem sugerida) ou **fora de lista** com observação livre (ex.: despacho do Presidente). A marcação é manual — entrar em lista nem sempre é o atendimento — e reversível (↩ reabre)
- **Filtros "Só não atendidas" e "Só atendidas"** na barra lateral (começam sempre desligados; marcar um desmarca o outro): escondem o outro grupo, tiram da lateral o deputado sem demanda no recorte e avisam no topo da lista quantas estão ocultas, com "Mostrar todas". A lateral mostra, por deputado, **em aberto / total**. O **Relatório (PDF) segue o filtro**: com um deles marcado, só aquele grupo entra, e o título e a linha de totais dizem que é recorte
- **Relatório (PDF)** no padrão institucional: seções **"Em aberto"** (primeiro — é o que cobra ação) e **"Atendidas"**, cada demanda com demandante, natureza, autoria, situação, histórico de listas e, nas atendidas, a reunião/forma do atendimento
- Registros no Firebase (`lideres-demandas`), **compartilhados com a equipe** como as reuniões

**Sistema 3 — E-mail de Demandas**
- Marca-se na barra lateral quais demandas entram; o e-mail sai **montado por código** no modelo da Liderança ("Senhor Presidente, … lista de proposições prioritárias para a bancada do PODEMOS" + um bloco por proposição com autoria, ementa e situação) — sem IA na formatação
- **Quem demandou e a natureza da demanda não entram no e-mail** — são registro interno da bancada; a autoria vai só com o nome ("Bacelar", não "Bacelar PV/BA")
- Ao copiar, a **situação de cada demanda selecionada é reconsultada na Câmara** antes de montar o texto — entre o registro e o envio a urgência pode ter sido aprovada — e o que mudou sai avisado
- A assinatura ("Deputado Fulano / Líder do PODEMOS") vem **da API da Câmara** (`/partidos/{id}` → `status.lider`), com o tratamento derivado do campo sexo da ficha — nunca nome fixo no código; se a API falhar, fica o marcador `<Líder do PODEMOS>` para o analista preencher, nunca um nome silenciosamente errado
- **"Abrir no Outlook"** abre o cliente de e-mail padrão da máquina com assunto e corpo prontos (`mailto:`). Enviar sozinho exigiria Microsoft Graph com autorização da TI — a extensão deliberadamente não faz isso. Corpo acima do limite do `mailto:` (~2 mil caracteres de URL) vai pela área de transferência e o Outlook abre só com o assunto — **nunca truncado em silêncio**

---

### 9. Orçamento

O card **Orçamento** abre três painéis: **Emendas** (o dinheiro da bancada, do proposto ao pago), **Notas Técnicas Orçamentárias** (LOA, LDO e PPA na Comissão Mista de Orçamento) e **Comparador de Portarias** (como eram e como ficaram os procedimentos regulados por portarias). Cada um abre em aba própria.

#### 9.1 Notas Técnicas Orçamentárias

Acompanhe a tramitação da lei orçamentária na **CMO** e produza a nota técnica do exercício, com prazo de emendas, relatores, parâmetros macroeconômicos e os números do projeto — cada um conferido contra o documento de origem.

**O que a tela lê, e de onde**
- A matéria é achada pelo **apelido** no Dados Abertos do Senado (`PLOA 2027`), nunca por número fixo — o PLOA 2027 é o PLN 24/**2026**, então a busca varre o ano do orçamento e o anterior
- Do portal do **Congresso Nacional** (`/web/orcamento/acompanhe/...`): as **10 etapas** da tramitação com o último estado, o **cronograma** (de onde sai o prazo de emendas), os **relatores** (presidente da CMO, relator-geral, da receita e os setoriais), os **documentos da fase de emendas** (Manual, instrução normativa, portarias e cartilhas) e as **notas técnicas das Consultorias** (CONOF/CD e CONORF/SF)
- Do **Ministério do Planejamento e Orçamento** (gov.br): texto da lei, volumes do projeto, comparativo e Orçamento Cidadão, cada um descrito pelo que contém
- Em PPA, também os projetos que alteram o plano no quadriênio
- Campo que a CMO ainda não publicou aparece como **"ainda não publicado"**, distinto de **"não consegui ler"** — e o prazo de emendas nunca é estimado pelo ano anterior: enquanto a CMO não aprova o cronograma, o prazo simplesmente não existe

**IA com conferência obrigatória** — a regra do módulo é **"a IA lê e redige; o JavaScript confere; nada passa sem conferência"**
- **Cartilhas**: o modelo lista, por ação orçamentária, o que ela permite e o que não permite custear, sempre com **trecho literal** e página. O programa exige que o trecho exista no texto do PDF, que o código da ação apareça no documento e que **toda cifra citada** conste dele
- **Ficha do exercício**: 20 campos operacionais (cota individual e de bancada, pisos de saúde, limites, prazos) extraídos do Manual de Emendas, cada um com cinco estados — aguardando, pendente, preenchido, conferido, divergente. **Valor sem documento de origem não entra**, e há barreira específica contra o número herdado de outro exercício
- **Números do exercício**: catálogo de 27 indicadores lidos da Mensagem Presidencial e dos volumes, com trecho e valor conferidos
- **Síntese analítica**: aqui o risco é invertido — os números vão **prontos** no prompt e a IA só redige; qualquer cifra que ela introduza é conferida contra a lista da base
- A conferência usa o texto extraído pelo **pdf.js**, e não o que o modelo diz ter lido: se a conferência usasse a leitura do próprio modelo, não seria conferência
- Fonte ilegível (menos de 500 caracteres extraídos) **não vira aprovação** — nada é dado por conferido. O que é recusado volta com o motivo, nunca some
- Documento que não cabe no limite do provedor é enviado como **texto extraído** em vez de PDF nativo, e a tela **declara** essa diferença

**Conferência por regra fixa (sem IA)**
- **Normas e valores citados** na nota são comparados com o documento do exercício e devolvidos como confirmados, não confirmados e alertas — o programa **nunca corrige sozinho**. "Lei Complementar" é testada antes de "Lei", senão a LC 210/2024 viraria Lei 210/2024
- **Comparação entre exercícios**: o que saiu, o que entrou e o que permaneceu de um ano para o outro
- **Parâmetros macroeconômicos** (PIB, IPCA, Selic, câmbio, salário mínimo) e as tabelas por órgão saem da própria Mensagem Presidencial; o extrator **soma as linhas e compara com o total impresso** e, não batendo, declara a leitura incompleta e o tamanho da diferença
- **Série histórica** das cotas monta-se das fichas salvas: exercício sem ficha aparece como **lacuna nomeada**, nunca interpolado nem estimado
- **Guia de emendas**: casa as cartilhas da CMO com as 16 áreas temáticas do Anexo I da IN nº 01/2023 e com o relator setorial de cada área, marcando quando o relator é da bancada

**Produto**
- **Nota técnica** aberta em aba nova, em formato A4 com cartões e gráficos, e botão **"Salvar em PDF"**: identificação, estágio da tramitação, cronograma, ficha de parâmetros, série histórica, variação entre exercícios, números apurados, achados, síntese, ações das cartilhas, documentos do Executivo e alterações do PPA
- A nota imprime a **ressalva de conferência** com os números não conferidos ("confirme na fonte antes de divulgar") e lembra que constar do documento não significa que a ação se aplique ao caso concreto — a adequação da emenda continua sendo análise do gabinete
- Cada lote de IA pede **confirmação de custo** antes de começar
- Nota e ficha ficam no Firebase (`/orcamento_ia/{lei}-{ano}` e `/orcamento_ficha/{lei}-{ano}`), compartilhadas com a equipe

#### 9.2 Emendas da bancada

Acompanhe as emendas dos parlamentares do Podemos — proposto, empenhado e pago — em duas fontes que não se consultam do mesmo jeito, com abas **Panorama por pasta · Propostas · saúde · Por parlamentar**.

- **Fundo Nacional de Saúde**: a coleta baixa **uma planilha por UF** (27 requisições) em vez de abrir o detalhe de cada uma das dezenas de milhares de propostas do ano; o detalhe de uma proposta é buscado sob demanda. Os tempos (duas UFs simultâneas, intervalo entre elas, timeout de 4 minutos) foram medidos contra o portal — paralelismo alto não acelera nada ali
- **Portal da Transparência**: emendas por parlamentar, com o empenhado e o pago. A consulta é **por nome e sensível a caixa** ("Renata Abreu" devolve zero; "RENATA ABREU" devolve treze), e exige **chave gratuita** do analista, cadastrada no portal e guardada só no navegador
- **Quem é da bancada nunca é escrito à mão**: deputados vêm da API da Câmara e senadores do Dados Abertos do Senado, com o partido de hoje. Não conseguindo ler nenhuma das duas, o vínculo fica "não identificado" — afirmar "fora da bancada" seria inventar
- As duas fontes se cruzam pelo **código da emenda** (ano + código do autor + número), que casa com o código político do FNS
- **Coleta incremental por estado**, já que o FNS não oferece "o que mudou desde ontem", com **log copiável** da coleta: tempos, bytes e tentativas por UF e uma seção "mudanças desde a busca anterior" (pagou agora, pagamento novo, emenda nova)
- **Exportação em Excel (.xlsx)** das propostas do FNS (com linha de total) e do panorama por pasta
- Defeitos da fonte são **marcados, não consertados**: quando o Portal informa **pago maior que empenhado**, o item recebe o alerta "⚠ conferir" em vez de um teto de 100% que esconderia o problema. A coluna de partido da planilha do FNS é o **partido da época da emenda**, por isso o vínculo de hoje vai ao lado. **Transferência especial** não gera proposta no FNS, e a tela diz isso em vez de parecer defeito
- Dados no Firebase em `/emendas-fns/{ano}/{uf}` (só o recorte do partido) e `/orcamento-transparencia/{ano}`; as chaves de API ficam no `chrome.storage` do analista, **nunca no Firebase nem no repositório**

#### 9.3 Comparador de Portarias

Notas técnicas sobre os atos que regulam procedimentos orçamentários (portarias, instruções normativas), de um ou mais órgãos, em duas abas.

- **Entrada**: PDF com texto, Word (.docx, lido sem biblioteca extra), texto colado ou **link do DOU** (in.gov.br). O **cabeçalho** de cada ato (tipo, órgão, número, data) é reconhecido por regra, sem IA, e o analista corrige o que vier errado
- **Comparar sequência de portarias**: os atos entram em ordem cronológica e a nota comparativa mostra, tema a tema, **como era → como ficou** a cada novo ato. Avalia **todas** as mudanças (substituição, alteração por dispositivo, revogação, conteúdo novo), não só as principais; cancelável, e as leituras de cada ato já feitas são reaproveitadas
- **Notas de portarias**: nota informativa ou técnica de um ou **vários atos**, relacionados ou não, com foco opcional. O **✕** ao lado de um ato ou de um item o tira da nota (tela e PDF), com desfazer, sem depender da IA
- **IA com conferência**: a IA redige citando artigo e **trecho literal**; o JavaScript confere se o trecho existe no texto do ato. O que não for conferido aparece na tela com ⚠, mas **não vai para o PDF**
- **Pedir alterações** (nas duas notas): ajustes em texto livre ("mais curta", "tire o item sobre…"); cada pedido gera nova versão, conferida de novo, e dá para desfazer. Pedido que não muda nada é avisado, em vez de dar por feito
- **PDF** pela impressão do navegador, só com a nota: cabeçalho com a logo do Podemos, legislatura e data, e as cores preservadas na impressão

---

### 10. Bot do Telegram (SisPode Bot)

Bot em **Node.js** (grammY) que roda numa máquina da equipe e leva a pauta, as análises e o **acompanhamento ao vivo do Plenário** para o grupo do Telegram. Usa o **mesmo Firebase** da extensão (as análises geradas no painel aparecem no bot) e roda a IA **na chave de cada usuário** (`/config`). Código em `bot/` — instalação em [`bot/INSTALACAO.md`](bot/INSTALACAO.md), guia de uso em [`bot/GUIA-ANALISTA.md`](bot/GUIA-ANALISTA.md).

**Conversa em linguagem natural (agente)**
- Além dos comandos, o bot **conversa**: um agente (laço ReAct sobre os 3 provedores de IA) que consulta ferramentas, lê os resultados e responde — com memória de conversa. No privado (texto ou **voz**), ou no grupo **mencionando** o bot ou **respondendo** a uma mensagem dele
- Ferramentas de consulta: itens da pauta, nota técnica salva, quórum ao vivo, pauta de comissão, situação de qualquer proposição, oradores da sessão, faltantes de votação, e **páginas de sites oficiais** (allow-list rígida no código: `camara.leg.br`, `senado.leg.br`, `planalto.gov.br`, `in.gov.br`)
- Ações (com as confirmações de sempre): importar pauta, gerar análises, exportar PDF, etc.

**Pauta e análise (porte da extensão)**
- `/pauta` (escolhe/busca on-line), `/importar` (Pauta da Semana), `/ordemdodia` (Ordem do Dia do dia), `/listar`, também aceita **PDF da pauta** enviado no chat
- `/analisar` gera as notas técnicas da pauta (via *worker* Puppeteer, na chave do solicitante); `/exportar` gera o **PDF institucional**
- `/perguntar` (responde a partir da nota + documentos), `/nota` (texto integral verbatim), `/documentos` e `/baixar` (PDFs da tramitação), `/agregar`, `/limpar`
- `/comissao`, `/comissoeshoje`, `/varrercomissoes` (projetos do Podemos nas comissões do dia)
- `/colegio PL 1234/2026` — **ficha de uma proposição avulsa no formato da Reunião de Líderes**, para o analista que precisa, durante a reunião, de algo que não entrou na lista. Responde em duas etapas: os **fatos na hora** (situação, apensação e de quem é o REQ, relatoria, parecer, retorno do Senado, marcações do Podemos — regra fixa, sem chave de IA) e o **resumo por IA em seguida**, com o inteiro teor e as peças do cenário anexados
- `/ata` — **modo de anotação da Reunião de Líderes**. Com a ata aberta, todo texto (e todo áudio, transcrito) que o analista mandar no privado vira anotação numerada; ao final, `/ata fim` devolve a **mensagem pronta para o WhatsApp da bancada**, no padrão da Liderança (*Amigos,* / *Nesta semana:* / *Próxima semana:* / *⚠️ Atenção:*). A IA escreve a **prosa**; o **formato é montado por código**, e bloco sem anotação correspondente é omitido em vez de preenchido. Junto vão o que ficou de fora e a conferência das proposições citadas — nas duas direções: número que aparece na mensagem e **não** está nas anotações, e número anotado que **ficou fora** da mensagem. As anotações ficam **em disco na máquina do bot**, nunca no Firebase (deliberação interna, mesmo critério das chaves de API), e sobrevivem a reinício. `/ata ver`, `/ata apagar 3`, `/ata descartar`, `/ata ultima`; durante a ata, `?pergunta` fala com a IA sem fechá-la

**Regimento e precedentes**
- `/questaoordem` (`/qo`) — busca no acervo de **questões de ordem** da Câmara por termo, com ranqueamento BM25 e radicalização em português; aceita filtro por fase (`recurso:`, `decisão:`, `contradita:`) e busca por número
- `/recurso` — base das proposições de recurso, com o inteiro teor extraído dos PDFs
- `/regimento` — consulta ao RICD com resposta fundamentada nos artigos

**Sessão e utilitários**
- `/votacao` — votações do Plenário com imagem do placar da bancada
- `/resumo [dd/mm/aaaa]` — resumo das matérias apreciadas na sessão (o monitor manda sozinho no fim; o comando cobre recuperação e dias anteriores)
- `/ajuda` — lista os comandos disponíveis para o usuário
- `/update` (admin) — autoatualização: baixa `index.js`, `package.json` e `src/*.js` do `main`, valida com `node --check` antes de escrever

**Monitor de sessão ao vivo (Plenário)**
Fonte primária: as **APIs públicas do app Infoleg** (cosev / ws-plenario), descobertas por engenharia reversa do APK — sem navegador, sem autenticação. Dados Abertos ficam só onde a latência não importa. Durante a sessão o bot anuncia no grupo:
- Abertura do registro de presença/inscrições, **quórum** (ao atingir 257), abertura e **encerramento da Ordem do Dia**, encerramento da sessão
- **Votações simbólicas**: anúncio e resultado a partir do sinal do cosev (~12 s), com **autocorreção** — o resultado assumido ("Aprovado") é editado na própria mensagem se o carimbo oficial da página do evento divergir
- **Votações nominais**: anúncio + **imagem do placar** da bancada (com coesão/dissidência), destaques (DTQ) com a explicação do módulo de Destaques
- **Resumo da sessão** ao fim da Ordem do Dia (mesmo gerador do botão "Resultado da Sessão" do painel) + encaminhamentos das matérias
- **"Na tribuna"**: aviso quando um deputado do Podemos é chamado a discursar
- Comandos ao vivo: `/quorum` (presença no painel), `/oradores [data] [filtro]` (quem falou/aguarda, por lista), `/faltamvotar` (na nominal aberta, quem do Podemos ainda não votou — presentes × fora da Casa, com rede de segurança automática)

**Imprensa e produção**
- `/digest` — radar de imprensa (Fantástico, JN, Profissão Repórter, Globo Rural, Agência Brasil): temas + relevância legislativa + minuta em PDF (assinantes; automático às segundas)
- `/rodaviva` — resumo da entrevista do Roda Viva (convidado + principais pontos), automático no grupo às terças; transcrição via YouTube com cascata de fallbacks

**Administração**
- Acesso por allowlist (`/usuarios`, `/revogar`; entrada por palavra-chave ou aprovação do admin); menu de comandos por escopo (autorizados e admin veem comandos extras)
- `/revisar_msg` — usuários autorizados corrigem, no privado, uma das últimas 5 mensagens que o bot enviou ao grupo (editado in-place; o admin recebe o antes/depois)
- `/backup`/`/backups` — **rede de segurança do Firebase**, cujas regras são abertas (qualquer aba pode apagar). O bot tira snapshots **em disco na máquina dele** (fora do banco) ao subir e a cada 6h, cobrindo **todos os nós de trabalho** — pautas, análises, prompts, CCJC, Congresso/vetos, Reunião de Líderes (reuniões e demandas), cadastros e estado do bot; ficam de fora só o cache de aderência (regenerável) e a versão da extensão. `/backups` lista os snapshots como botões e **restaurar é não-destrutivo**: repõe apenas o que está faltando, nunca sobrescreve o que existe. Se o banco vier vazio, o snapshot é **descartado** (não grava por cima do bom) e o admin é avisado
- `/monitor` (liga/desliga o monitor), `/config`/`/minhachave`/`/modelo`/`/removerchave` (chave de IA por usuário — `/modelo listar` busca ao vivo os modelos disponíveis na API do provedor configurado, marcando o atual), `/digestadd`/`/digestrem`/`/digestlista` (assinantes do radar de imprensa)
- `/leisaprovadas [legislaturas] [--forcar]` — coleta o relatório de **Leis aprovadas** (item 3.5): baixa os arquivos oficiais em massa da Câmara e grava o agregado no Firebase. Sem coletar de novo o que já está na versão pedida — o refresh diário automático cobre a legislatura corrente (e a anterior, semanalmente, nos 12 meses de carência); as encerradas são coleta manual, uma vez. `--forcar` também libera gravar coleta com menos projetos que o salvo. `/leisaprovadas status` mostra data/hora da última coleta de cada legislatura, a origem (bot, script, extensão) e a data dos arquivos da Câmara
- `/labsmapa [ano]` — **Labs · Mapa Territorial** (roda em segundo plano, sem travar o bot; uma coleta por vez; respeita o limite de 90 req/min do Portal): baixa o arquivo de votação por município do TSE (padrão 2026: os eleitos do PODE no arquivo, com a comparação com 2022; em 2022, a bancada de hoje), agrega os votos por município e, com `TRANSPARENCIA_CHAVE` no `.env`, as emendas pagas (ano anterior e atual); grava em `/labs/mapa`
- **Reenvio automático** quando a falha do Telegram é de **rede** (DNS, TLS, conexão cortada), 429 ou 5xx — a recusa definitiva (bot bloqueado, chat inexistente) não é repetida. Sem isso, um soluço de meio minuto custava o digest inteiro da semana

### 11. Labs

**Área de desenvolvimento de novas soluções.** Dentro dela desenvolvemos e testamos funcionalidades; quando homologadas, elas saem para integrar novos módulos ou módulos já existentes. Cada protótipo depende só de `labs.js` (e de `ia-comum.js`, quando usa IA), para poder ser levado a outro módulo sem arrastar o resto. Tudo aqui é **experimental**.
- **⚙ na barra do topo**: provedor, chave e modelo de IA — o mesmo modal de Relatórios (`modelo-ia.js`), gravando a configuração do aplicativo

**Simulador de Negociação**
- Agentes de IA na mesa, configuráveis: o **Governo**, **qualquer partido** (as 10 maiores vêm listadas; as demais entram por "Adicionar partido") e **agentes personalizados** — frente parlamentar, relator ou outro —, descritos pela equipe (não somam cadeiras, porque sobrepõem os partidos)
- Cada bancada tem perfil tirado das votações reais: cadeiras; **% em que a maioria dos deputados do partido votou como o Governo orientou** (pelo voto, porque a Câmara só publica a orientação do líder do bloco — partidos do mesmo bloco sairiam iguais); % em que a orientação do líder coincidiu com a do Governo (**obstrução conta como divergência**); coesão; e as votações recentes em que a bancada votou contra o Governo, com a proposição. A orientação de partido em bloco usa todos os blocos da legislatura (inclusive os extintos) e as abreviações do rótulo ("Avan" → AVANTE, "Rep" → REPUBLICANOS) O **contexto do analista** (o que as votações não mostram: sinais do líder, divisões internas) entra junto, com peso
- **Perfis salvos para a equipe** em `/labs/simulador/perfis`: contexto e agentes personalizados voltam preenchidos nas próximas simulações, com quem salvou e quando
- Cada agente responde posição (apoia / condiciona / rejeita), objeções, a concessão que destravaria o apoio, o argumento que pesa e o risco de ruptura; uma síntese agrupa objeções, concessões e onde o acordo quebra
- **Rodadas encadeadas**: a proposta reformulada vai aos mesmos agentes, cada um com o que disse antes; a tela mostra a evolução (quem mudou de posição e as cadeiras que apoiam em cada rodada) e a síntese explica o que mudou
- **Proposta em pontos**: um ponto por linha ("1. …", "- …"); cada agente diz, em cada ponto, se apoia, rejeita, reformula (com nova redação) ou troca (aceita em troca de outro), e a importância de 1 a 5 (5 = linha vermelha). Mapa ponto × bancada com as cadeiras que apoiam e rejeitam cada ponto
- **Notas próprias**: cada agente escreve notas para si mesmo sobre o estado da negociação e as recebe na rodada seguinte (agentes sem memória estruturada quase nunca chegam a acordo — Andric, 2026)
- **Ancoragem**: cada objeção declara em que se apoia (votações, contexto da equipe, ementa, proposta, posição do Governo) ou "nenhuma"; as sem base são marcadas como hipótese do modelo (Van Mulders et al., 2026)
- **Governo responde primeiro** (opcional, desligado por padrão): a liderança do Governo declara a posição e as bancadas respondem sabendo dela (como líderes e liderados no Political Actor Agent, AAAI 2025). Desligado, todos respondem independentes — agentes de IA tendem a seguir a posição dominante
- **Consenso × conflito**: o perfil separa o comportamento da bancada quando a Oposição orienta igual ao Governo (consenso), diferente (conflito) ou não orienta — medido em 12 meses, o PL acompanha o Governo em 100% dos consensos e em 3–4% dos conflitos. No Simulador, o campo "A Oposição deve orientar" leva a expectativa da equipe aos agentes
- **Teste contra o passado**: nas últimas N votações em que o Governo orientou, compara o voto real da maioria de cada bancada com três previsões — estatística sem IA (por contexto: consenso ou conflito com a Oposição), uma pergunta simples à IA e os agentes (perfil só com votações anteriores; a votação vai sem o resultado). Mostra acerto, F1 macro e cobertura, por método, por contexto e por bancada, e o **detalhe por votação** (bancada a bancada). O veredito conta VOTAÇÕES (teste do sinal), não bancadas: as bancadas votam em bloco e não são casos independentes. Votações de conteúdo desconhecido (a Câmara descreve só "Requerimento." ou "Resultado.") ficam marcadas e o resultado também sai sem elas; respostas cortadas pelo limite de saída são contadas à parte Guarda em `/labs/simulador/validacoes`
- **Relatório em PDF** da negociação: cada rodada (proposta, cadeiras por posição, mapa por ponto, síntese), a evolução entre rodadas, o resultado da última e os parâmetros da simulação, com a logo do Podemos — abre em aba própria, com botão "Salvar em PDF"
- **Modelos separados** para os agentes (uma chamada cada — vale um mais barato) e para a síntese (uma chamada — vale um mais forte), no provedor e chave do ⚙ da página; o custo acumulado aparece por modelo. Serve para preparar argumentos — **não é previsão**

**Mapa Territorial de Entregas**
- Mapa do estado (malhas do IBGE) pintado pela **fatia** dos votos nominais válidos para deputado federal de cada município que foi do deputado (dados do TSE; sem os votos só de legenda) e círculos nas emendas pagas com município identificado (Portal da Transparência, chave do analista); lista dos municípios com mais votos, das emendas em outros estados e das sem município ("MÚLTIPLO")
- **Eleição de 2026 ou 2022**. Em **2026** a bancada são os **eleitos do partido no próprio arquivo do TSE** (situação "eleito por QP/média") — os novos só entram na API da Câmara na posse; em 2022, os deputados de hoje na Câmara
- **Comparação com 2022** (em 2026): a mesma pessoa no arquivo de 2022 pelo nome civil, mesmo que tenha concorrido por outro partido ou com outro nome de urna. Cartão com os votos de 2022 e a variação, lista de **onde mais ganhou e mais perdeu votos**, e o mapa no modo **ganho/perda** (verde/vermelho). Quem não concorreu a deputado federal na mesma UF em 2022 aparece como tal
- **Download com um clique** ("Baixar do TSE e processar"): a extensão lê o **índice** do zip do TSE (centenas de MB) e baixa **só os arquivos dos estados da bancada**, por pedidos parciais (HTTP Range), descompactando em fluxo no navegador. Os estados com eleitos vêm do painel de resultados do TSE (poucos KB por estado). Pede confirmação com o tamanho do download; nada é gravado antes de **Gravar no banco de dados**
- **Dica ao passar o mouse** em cada município: votos na eleição e fatia do município; com a comparação, os votos da anterior e a diferença em votos e em %
- **Relatório em PDF** do deputado (botão "Relatório em PDF"): cartões, o mapa da fatia e o de ganho/perda (cores de papel), onde teve mais votos (com a variação), onde mais ganhou e perdeu, e as emendas — com a logo do Podemos, em aba própria com "Salvar em PDF"
- **Emendas "MÚLTIPLO" localizadas pelo favorecido**: a API do Portal devolve a maior parte das emendas sem município ("MÚLTIPLO" ou só a UF). Com um clique ("📍 Localizar os municípios pelo favorecido", no quadro de emendas), a extensão lê do arquivo de dados abertos do Portal (`EmendasParlamentares.zip`, ~28 MB lidos por Range) quem recebeu cada pagamento (prefeitura, fundo municipal, entidade) e o município dele, para toda a bancada e os anos de emendas de uma vez; grava em `/labs/mapa/favorecidos` (~50 KB). O valor vira círculo no mapa e entra na lista, na dica e no PDF. O arquivo sai uma vez por mês e a API é diária: os valores do favorecido são ajustados à soma sem município da API — o que o arquivo ainda não cobre continua "MÚLTIPLO". Pagamento a pessoa física aparece como "favorecido sem município"
- **Três números das emendas** de cada ano, na tela e no PDF: **empenhado** das emendas do ano, **pago** das emendas do ano e **tudo o que foi pago dentro do ano**, com restos de emendas de anos anteriores (este último pelo arquivo de dados abertos do Portal, mensal — vem com o mesmo clique do favorecido)
- Emendas de um ano = **pago no ano + restos a pagar pagos depois** (só o pago no ano subestimava os anos anteriores); cache de 24 h no ano corrente e 7 dias nos anteriores
- Outros caminhos: **pelo bot** (`/labsmapa [2026|2022]`, ou `node bot/scripts/labs-mapa-territorial.js`), que também busca as emendas pagas, ou **à mão** na própria tela, com os CSV já baixados (sem a comparação); só o agregado é gravado, depois de confirmação
- Código do município no TSE ≠ código IBGE: a ponte é pelo nome dentro da UF (com tolerância a grafias como "Moji"/"Mogi"); o que não casar é listado
- **Emendas × votos** (botão ao lado de "Mostrar no mapa", painel em grade): o que foi pago ao deputado na legislatura (do início do mandato ao mês da eleição, por município do favorecido) contra a variação da **fatia** dele nos votos válidos de cada município entre 2022 e 2026, em pontos percentuais — neutraliza o comparecimento e a base pequena. Quatro gráficos: variação por faixa de emenda (com a **mediana** e o número de municípios de cada faixa e a **variação do deputado no estado** como régua), cada município (emenda × variação), os 15 que mais receberam (com **↔ +N** onde outros eleitos do partido ganharam votos no mesmo município) e o mapa. As notas dizem o limite da leitura: associação, não efeito. Pagamentos a favorecidos fora do estado (bancos intermediários incluídos) aparecem à parte
- **Bancada no estado**: os eleitos do partido na UF juntos — onde cada um é forte (seis mapas na mesma escala), quem levou cada parte dos 15 municípios com mais votos do partido, a **sobreposição** (pares de eleitos que disputam o mesmo eleitorado) e a força somada com os **vazios** (menos de 2%) e as emendas da bancada
- **PDF** das duas análises (botão "⬇ PDF" no título do painel): o mesmo painel em grade, em **A4 deitado**, nas cores de papel, com a logo e as notas de leitura
- As duas análises usam os totais por município da eleição anterior (gravados no processamento com comparação — reprocesse uma vez) e o mesmo clique do favorecido
- Dados em `/labs/mapa/{ano}` (deputados, totais por município, situação) e `/labs/mapa/emendas/{ano}/{deputado}` (cache das emendas) e `/labs/mapa/favorecidos` (destino das emendas sem município, por autor e ano)

**Perfil da Bancada**
- Quem o partido lançou e quem elegeu em **2022 e 2026**, por cargo (deputado federal, estadual e distrital, senador), com os recortes: **gênero**, **cor/raça** (e pessoas negras = pretas + pardas), **faixa etária** (idade na data da eleição), **escolaridade**, **região**, **ocupação declarada** e a **trajetória dos eleitos de 2026** (reeleitos pelo partido, com mandato por outro partido, vindos de outro cargo eletivo, que concorreram em 2022 sem se eleger, estreantes)
- Cada recorte mostra eleitos, candidaturas e — se processados — votos, com a fatia de cada categoria; cartões de capa e a lista dos eleitos com o perfil de cada um
- **Um clique** baixa do TSE o cadastro de candidaturas (~4 MB) e, opcionalmente, os votos por município de todos os estados (por Range), processa no navegador e grava em `/labs/perfil/{ano}` só ao confirmar. **CPF, e-mail e título de eleitor do cadastro não são lidos nem gravados**; o nome civil serve só para casar a trajetória e não é gravado
- **Relatório em PDF** por cargo, com a logo do Podemos e as notas de método
- **Mulheres no partido (PDF)**: candidaturas, eleitas e votos de mulheres em 2022 e 2026 por cargo, gráficos com a linha da cota de 30% (Lei 9.504/1997, art. 10, § 3º), resumo e alertas escritos a partir dos números, as eleitas de 2026 com a trajetória e as eleitas de 2022 com o que fizeram em 2026

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

### Provedor de IA

Todos os módulos que usam IA compartilham a mesma configuração. O usuário escolhe entre três provedores; apenas um fica ativo por vez — ao trocar, é necessário colar a chave do novo provedor (as chaves já usadas ficam guardadas por provedor). As **Pautas de Comissões** admitem provedor e modelo próprios por colegiado, e o **Parecer de Especialista** pede o modelo no momento da geração.

| Provedor | Onde obter a chave | Formato da chave |
|---|---|---|
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) → Get API key | `AIzaSy...` ou `AQ....` |
| OpenAI (ChatGPT) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `sk-...` |
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com) → Settings → API Keys | `sk-ant-...` |

Na extensão:

1. Abra **⚙ Configurações** → selecione o provedor no campo **Provedor de IA**
2. Cole a chave de API no campo abaixo
3. Clique em **Carregar disponíveis** para listar os modelos da própria chave, consultando a API de cada provedor (há uma lista de reserva quando a consulta falha)
4. Escolha a profundidade da análise: **Resumo**, **Completo** ou **Com argumentos**
5. Use **Testar conexão** para verificar se a chave está funcionando

### Chave do Portal da Transparência (para o painel de emendas)

O acompanhamento das emendas no Portal da Transparência exige uma chave gratuita, pedida no próprio painel de Emendas e obtida em [portaldatransparencia.gov.br/api-de-dados/cadastrar-email](https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email). Como as chaves de IA, ela fica **apenas no navegador do analista** — nunca no Firebase (hoje com regras abertas) nem no repositório.

### Firebase (para sincronização entre dispositivos)

A sincronização usa o Firebase Realtime Database já configurado no projeto. Nenhuma configuração adicional é necessária para uso interno da equipe.

---

## Estrutura de arquivos

```
sispode/
├── manifest.json               # Manifesto da extensão (MV3)
├── panel.html / panel.js       # Painel inicial + módulo: Destaques Legislativos
├── panel.css                   # Estilos do painel principal
├── votacao.html / votacao.js      # Módulo: Painel de Votação
├── aderencia.html / aderencia.js  # Módulo: Relatórios — abas, aderência e "como votou o deputado"
├── producao.js                    # Relatórios · Produção legislativa
├── radar.js                       # Relatórios · Radar temático
├── leisaprovadas.js               # Relatórios · Leis aprovadas (lê o agregado do bot; upload manual como caminho alternativo)
├── labs-apuracao.js               # Relatórios · Apuração eleitoral: leitura do TSE, projeção, cláusula de barreira (funções puras)
├── sistemas-nucleo.js             # Relatórios · Sistemas eleitorais: proporcional, distritão, distritão misto, comparação (funções puras)
├── sistemas-distrital.js          # Relatórios · Sistemas eleitorais: distrital misto — distritos desenhados (malha IBGE + TSE) e eleição (funções puras)
├── sistemas-memorial.js           # Relatórios · Sistemas eleitorais: memorial de cálculo — planilha com as contas por fórmula e a coluna Confere (funções puras)
├── sistemas/                      # Relatórios · Sistemas eleitorais: a tela (sistemas.html + sistemas-tela.js; PDF)
├── zip-remoto.js                  # Leitura de zip remoto por partes (HTTP Range), compartilhada pelo Labs e pela Apuração
├── labs-apuracao-mapa.js          # Malha simplificada das 27 UFs (IBGE) para o mapa da apuração
├── apuracao/                      # Apuração eleitoral: tela comum à extensão e ao site
│   ├── apuracao.base.html         #   modelo da página
│   ├── apuracao-site.js           #   tela (filtros, visões, cláusula, PDF)
│   ├── apuracao-onde.js           #   📍 de onde vieram os votos (município, zona, local de votação; PDF)
│   ├── gerar-apuracao.js          #   gera os dois HTML abaixo (node apuracao/gerar-apuracao.js)
│   ├── extensao.html              #   aba da extensão (gerado; scripts por arquivo)
│   └── index.html                 #   site em arquivo único para hospedar (gerado)
├── labs.html / labs.js            # Módulo: Labs — abas e utilidades comuns dos protótipos
├── labs-simulador.js              # Labs · Simulador de Negociação (agentes de IA por bancada)
├── labs-simulador-teste.js        # Labs · Simulador: teste contra o passado (validação dos agentes)
├── labs-simulador-relatorio.js    # Labs · Simulador: relatório da negociação em PDF
├── labs-mapa.js                   # Labs · Mapa Territorial de Entregas (mapa, processamento manual)
├── labs-mapa-nucleo.js            # Núcleo puro do Mapa Territorial (extensão + bot)
├── labs-mapa-relatorio.js         # Labs · Mapa Territorial: relatório do deputado em PDF
├── labs-mapa-analises.js          # Labs · Mapa Territorial: Emendas × votos e Bancada no estado (painéis)
├── labs-perfil-nucleo.js          # Labs · Perfil da Bancada: leitura do cadastro do TSE, recortes e trajetória (puro)
├── labs-perfil.js                 # Labs · Perfil da Bancada: tela, download com um clique e relatório em PDF
├── labs-perfil-mulheres.js        # Labs · Perfil da Bancada: relatório "Mulheres no partido" em PDF
├── comissoes.html / comissoes.js  # Comissões · Gestão (vagas da bancada)
├── pautas-comissoes.html / .js    # Comissões · Pautas (calendário, pauta e nota por item)
├── pautas-comissoes-core.js       # Regras puras das pautas de comissões (testável em Node)
├── analise.html / analise.js      # Módulo: Análise de Pauta de Plenário
├── analise.css                    # Estilos dos cards de análise (usados também nas pautas de comissões)
├── ia-comum.js                    # Cliente de IA compartilhado (3 provedores, SSE, PDF, utilidades)
├── ccjc.html / ccjc.js            # Módulo: Pautas CCJC
├── congresso.html / congresso.js  # Módulo: Pauta do Congresso Nacional (vetos + PLNs)
├── lideres.html / lideres.js      # Módulo: Reunião de Líderes (análise da lista + demandas + e-mail)
├── emendas.html / emendas.js      # Orçamento · Emendas da bancada (FNS + Transparência)
├── orcamento-notas.html / .js     # Orçamento · Notas técnicas das leis orçamentárias
├── portarias.html / portarias.js  # Orçamento · Comparador de Portarias: tela e sequência dos atos
├── portarias-leitura.js           # Leitura dos atos (PDF, .docx, DOU) e cabeçalho por regra
├── portarias-sequencia.js         # Temas e pares de atos (inicial, substituição, alteração, novo)
├── portarias-comparacao.js        # Motor da nota comparativa: prompts e conferência dos trechos
├── portarias-comparativa.js       # Tela da nota comparativa (progresso, versões, pedir alterações)
├── portarias-nota.js / portarias-avulsa.js   # Notas de portarias (um ou vários atos) e pedir alterações
├── cmo.js                         # Leitura da tramitação na CMO (etapas, cronograma, relatores, documentos)
├── orcamento-ia.js                # Camada de IA do orçamento: prompts e conferência de cada resposta
├── ficha.js / serie.js            # Ficha de parâmetros do exercício e série histórica das cotas
├── mensagem.js / normas.js        # Tabelas e parâmetros da Mensagem; conferência de normas e valores
├── guia-emendas.js                # Cartilhas × áreas temáticas × relator setorial
├── parecer.js / pipeline-parecer.js   # Parecer de Especialista: modelo e orquestração das etapas
├── especialistas.js               # As 14 lentes temáticas e seus roteiros
├── dossie.js / ficha-objeto.js    # Lei vigente, séries e estimativas; ficha do objeto
├── tese.js / gates.js             # Tese com evidências, contraditório, portões e rubrica M1–M14
├── parecer-html.js                # Os dois documentos: parecer que circula e relatório de conferência
├── mpv.js                         # Acervo da Medida Provisória (PLV, relatório da Comissão Mista)
├── pauta-parser.js                # Parser das pautas do Plenário
├── background.js                  # Service worker da extensão
├── icons/                         # Ícones da extensão + logo Podemos para o PDF
├── libs/
│   ├── pdf.min.js / pdf.worker.min.js   # PDF.js — leitura de PDFs
│   ├── html2canvas.min.js               # Geração de imagens
│   ├── xlsx.full.min.js                 # Exportação para Excel
│   ├── docx.iife.js / docx.umd.js      # Exportação para Word
│   └── paged.polyfill.js               # Paginação do PDF (índice com nº de página)
├── testes/                         # Testes (Node; parte contra a API real da Câmara, parte com fixtures)
│   ├── lideres*.test.js            # Parser do PDF, cenários, situação/relatoria, demandas, cura
│   ├── materia.test.js             # /colegio: camada factual e resumo por IA
│   ├── ata.test.js                 # /ata: formato da mensagem, ciclo de vida, conferência
│   ├── backup.test.js              # backup/restauração: ida e volta com Firebase falso
│   ├── parecer-v3.test.js          # Parecer de Especialista: pipeline, tese, portões, rubrica
│   ├── parecer-tela.test.js        # Parecer no escopo real da página (vm + linkedom)
│   ├── parecer-modelo.test.js      # Escolha de modelo por faixa e recusa da faixa econômica
│   ├── pautas-comissoes*.test.js   # Regras e tela das pautas de comissões (fixtures da Câmara)
│   ├── orcamento-*.test.js         # Orçamento: CMO, ficha, séries, normas, números, telas
│   ├── emendas-*.test.js           # Emendas: coleta, log e planilha
│   ├── leis-aprovadas.test.js      # Relatórios · Leis aprovadas: tela, filtros, upload manual, exportação
│   ├── labs-apuracao.test.js       # Apuração: eleições do TSE, projeção de eleitos, cláusula por ano
│   ├── sistemas.test.js            # Sistemas eleitorais: regras do proporcional, distritão, distritão misto, dados abertos, hemiciclo
│   ├── sistemas-distrital.test.js  # Distrital misto: malha TopoJSON, leitura por zona, unidades, desenho dos distritos, eleição, regras do PL 9.212, locais de votação
│   ├── sistemas-memorial.test.js   # Memorial de cálculo: abas, fórmulas (QE, QP, sobras, listas, excedente, distritos, bancadas, indicadores), conferências, xlsx
│   ├── comissoes-cadastro.test.js  # Comissões: cadastro acompanha a bancada em exercício
│   ├── portarias*.test.js          # Comparador de Portarias: leitura, sequência, comparação, notas
│   └── bot-leis-aprovadas.test.js  # Coletor do bot: filtro por legislatura, crédito a coautores, tolerância a falha
└── bot/                            # Bot do Telegram (Node.js — ver bot/INSTALACAO.md)
    ├── index.js                    # Núcleo: comandos, agente, menu, wiring do monitor
    └── src/
        ├── agente.js               # Conversa natural (laço ReAct) + web oficial
        ├── monitor.js              # Monitor de sessão ao vivo (Plenário)
        ├── plenariocosev.js        # APIs públicas cosev/ws-plenario (app Infoleg)
        ├── oradores.js             # Oradores inscritos da sessão
        ├── faltamvotar.js          # Quem da bancada não votou na nominal aberta
        ├── votacao.js / portal.js / imagem.js   # Placar da bancada (imagem)
        ├── worker.js               # Puppeteer: /analisar e /exportar (PDF)
        ├── pauta.js / odd.js / parser.js / sessao.js   # Pauta e Ordem do Dia
        ├── perguntar.js / documentos.js / interesse.js # Notas, documentos, contexto
        ├── comissoes.js / digest.js / rodaviva.js       # Comissões, imprensa, Roda Viva
        ├── materia.js              # /colegio — ficha de proposição avulsa
        ├── ata.js                  # /ata — anotação da reunião → mensagem da bancada
        ├── reenvio.js              # Repete o envio quando a falha do Telegram é de rede
        ├── questaoordem.js / recursos.js / busca.js   # Questões de ordem, recursos, ranking BM25
        ├── qoprecedentes.js / qoembeddings.js         # Verbetes e vetores dos precedentes (gerados)
        ├── regimento.js / ricd.js  # Consulta ao Regimento Interno
        ├── destaques.js            # Destaques (DTQ) para o monitor
        ├── autoupdate.js           # /update: baixa e valida os arquivos do main
        ├── leisaprovadas.js        # /leisaprovadas: coleta o relatório de Leis aprovadas (item 3.5)
        ├── labsmapa.js             # /labsmapa: Labs · Mapa Territorial (zip do TSE, IBGE, emendas)
        ├── ia.js                   # Matriz dos 3 provedores de IA (chave do usuário)
        ├── store.js / firebase.js / config.js / backup.js   # Persistência e config
        └── cosevespiao.js          # Espião de calibração ao vivo (privado do admin)
```

---

## Testes

Cada arquivo de `testes/` roda sozinho, sem framework e sem instalação na raiz:

```bash
node testes/parecer-v3.test.js       # um teste
for t in testes/*.test.js; do node "$t"; done   # todos
```

Cada teste imprime linha a linha o que verificou e termina em "Tudo certo" / "Tudo passou" ou no número de falhas (código de saída ≠ 0). Parte deles consulta a **API real da Câmara** (precisa de rede); os demais usam fixtures gravadas em `testes/fixtures/`. Os testes de tela carregam o script da página num contexto `vm` com **linkedom**, e as dependências de Node (linkedom, puppeteer, pdfjs) vêm de `bot/node_modules`.

---

## APIs e serviços externos

| Serviço | Uso |
|---|---|
| [Dados Abertos da Câmara](https://dadosabertos.camara.leg.br) | Proposições, destaques, votações, deputados |
| [Portal da Câmara](https://www.camara.leg.br) | Sessões em andamento, oradores, presença e documentos legislativos |
| APIs públicas do app Infoleg (cosev / ws-plenario) | **Bot**: acompanhamento ao vivo do Plenário (presença, ODD, votações) — endpoints de leitura públicos |
| [API do Telegram](https://core.telegram.org/bots/api) (via grammY) | **Bot**: mensageria no grupo e no privado |
| [SISCON – Senado Federal](https://legis.senado.leg.br) | Relatório Resumo de Vetos em tramitação (PDF); Dados Abertos do Senado (matéria orçamentária, senadores) |
| [Portal do Congresso — Acompanhe o Orçamento](https://www.congressonacional.leg.br) | **Orçamento**: etapas, cronograma, relatores, cartilhas e notas técnicas da CMO |
| [Ministério do Planejamento e Orçamento](https://www.gov.br/planejamento) | **Orçamento**: texto da lei, volumes do projeto, comparativo e Orçamento Cidadão |
| [Fundo Nacional de Saúde](https://consultafns.saude.gov.br) | **Emendas**: propostas por UF (planilha) e detalhe da proposta |
| [API do Portal da Transparência](https://api.portaldatransparencia.gov.br) | **Emendas**: empenhado e pago por parlamentar (exige chave gratuita do analista) |
| [Portal do Congresso Nacional](https://www.congressonacional.leg.br) | Páginas de detalhe dos vetos e dispositivos vetados |
| [Dados abertos do Portal da Transparência](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares) (`dadosabertos-download.cgu.gov.br`) | **Labs**: emendas por favorecido, para localizar o município das emendas "MÚLTIPLO" no Mapa Territorial |
| [IBGE — API de serviços de dados](https://servicodados.ibge.gov.br) | **Labs**: malhas (contornos) e lista de municípios para o Mapa Territorial |
| [Dados abertos do TSE](https://dadosabertos.tse.jus.br) (`cdn.tse.jus.br`) | **Labs**: votação por município e zona (Mapa Territorial) — pela extensão (só os estados, por Range), pelo bot ou baixado à mão |
| [Divulgação de resultados do TSE](https://resultados.tse.jus.br) | **Relatórios · Apuração eleitoral**: resultados ao vivo por UF e cargo, lista de eleições e turnos |
| [Diário Oficial da União](https://www.in.gov.br) | **Orçamento · Comparador de Portarias**: texto dos atos pelo link do DOU |
| [Portal da Legislação da Câmara (LEGIN)](https://www2.camara.leg.br/legin) | Texto **atualizado** da lei alterada — primeira fonte da cascata da lei vigente |
| [Planalto](https://www.planalto.gov.br) e [LexML/Senado](https://www.lexml.gov.br) | Texto compilado e texto publicado das normas — as duas fontes seguintes da cascata |
| [API do Banco Central (SGS)](https://api.bcb.gov.br) e [Receita Federal](https://www.gov.br/receitafederal) | Séries de câmbio, IPCA e arrecadação para o dossiê do Parecer de Especialista |
| [Firebase Realtime Database](https://firebase.google.com) | Sincronização de sessões entre dispositivos |
| [Google Gemini](https://aistudio.google.com) | Provedor de IA (chave do usuário) — todos os módulos com análise |
| [OpenAI](https://platform.openai.com) | Provedor de IA (chave do usuário) — todos os módulos com análise |
| [Anthropic](https://console.anthropic.com) | Provedor de IA (chave do usuário) — todos os módulos com análise |
| [Codetabs Proxy](https://codetabs.com) | Proxy CORS para acesso a páginas do portal da Câmara |

---

## Permissões da extensão

- `storage` — salva configurações e cache de sessões localmente
- `tabs` — detecta abas abertas do portal da Câmara (sessão em andamento)
- `host_permissions` — acesso às APIs e serviços listados acima

---

## Requisitos

**Extensão**
- Google Chrome (versão compatível com Manifest V3)
- Conexão com internet para consultar as APIs da Câmara
- Chave de API de um dos provedores suportados (Google Gemini, OpenAI ou Anthropic) — necessária para geração de análises por IA. O **Parecer de Especialista** exige modelo de faixa intermediária ou superior
- Chave gratuita do Portal da Transparência — apenas para o painel de Emendas

**Bot** (opcional — ver [`bot/INSTALACAO.md`](bot/INSTALACAO.md))
- Node.js LTS
- Token de bot do Telegram (BotFather) e o ID do grupo da equipe
- Chave de IA por usuário (`/config`) para conversa natural e geração de notas
