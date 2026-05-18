# SisPode — Sistemas Legislativos do Podemos

Extensão do Chrome para a equipe da **Liderança do Podemos** na Câmara dos Deputados. Reúne seis ferramentas integradas para acompanhamento de sessões, votações, aderência ao governo, gestão de comissões, análise técnica da pauta semanal por IA e produção de pautas da Comissão de Constituição e Justiça (CCJC).

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
| DVS de subemenda substitutiva de plenário — SSP (CASO 1b) | Arquivo SSP na página de emendas |
| DVS de emenda específica numerada (CASO 2) | Texto da emenda via página de emendas da proposição |
| DVS de dispositivo do PL original (CASO 3) | PDF do próprio destaque ou inteiro teor via API |
| **Destaque de Preferência (CASO 4)** | **Upload manual de 2 PDFs pelo usuário** |

- Todos os documentos são enviados ao modelo como **PDF nativo** (no formato específico de cada provedor: `inline_data` no Gemini, `input_file` na Responses API da OpenAI, `document` block no Anthropic), preservando a formatação e evitando truncamento de texto
- O prompt instrui a IA a localizar o dispositivo exato (artigo, inciso, parágrafo) e descrever seu conteúdo com verbos normativos — sem inventar, sem usar conhecimento externo
- **Destaque de Preferência**: o modal exibe automaticamente 2 inputs rotulados ("PDF que recebe preferência" / "PDF a ser comparado"); a IA compara as duas redações e aponta as diferenças
- Suporte a inserção manual de texto ou PDF para substituir a busca automática quando necessário
- Três profundidades de análise configuráveis: **Resumo**, **Completo** e **Com argumentos**

**Exportação**
- Exporta cada destaque para **Word (.docx)** com layout formatado
- Formata o conteúdo para envio direto no **WhatsApp** (copia para área de transferência)

---

### 2. Painel de Votação

Acompanhe os votos da bancada em votações nominais do Plenário.

- **Aba Dados Abertos**: busca votações por data via API da Câmara (histórico)
- **Aba Link Portal**: acompanha sessões em andamento pelo portal da Câmara (tempo real)
- Exibe placar detalhado com votos individuais de cada deputado: Sim, Não, Abstenção, Art. 17, Obstrução, Ausente
- Filtra resultados pelo partido informado, com deduplicação robusta de deputados (normalização de nomes entre fontes diferentes)
- Mostra a orientação da bancada para cada votação
- Gera **imagem da votação** em alta resolução para compartilhamento (via html2canvas)

---

### 3. Aderência ao Governo

Calcule o índice de aderência do partido às orientações do governo em qualquer período.

- Selecione intervalo de datas e a sigla do partido
- Exibe o percentual geral de aderência, com contagem de votações aderentes, divergentes e ausências
- **Ranking individual** de deputados ordenável por aderência, divergência ou ausência
- Permite filtrar e detalhar o histórico de votos de um deputado específico
- Gráfico temporal da evolução da aderência no período
- Exporta o relatório completo em **Excel (.xlsx)**

---

### 4. Controle de Comissões

Gerencie a participação de deputados do partido em comissões permanentes.

- Importa a composição atualizada de comissões via API da Câmara
- Marca **acordos** (titular/suplente) e exibe badge correspondente
- Filtros por comissão, por deputado e por status do acordo
- Exporta o controle completo para **Excel (.xlsx)**

---

### 5. Análise de Pauta de Plenário

Importe a Pauta da Semana e gere análise técnica por IA dos projetos e requerimentos, identificando autoria do Podemos e apensados do partido.

**Importação e enriquecimento**
- Carregue o PDF da Pauta da Semana — o parser extrai PLs, PLPs, MPVs, PECs, REQs e demais proposições com número/ano/ordem
- Enriquecimento automático via API da Câmara: autoria, relator, apensados e classificação de **autoria Podemos** / **apensados Podemos** (badge no card)
- Busca os pareceres de plenário **PRLP/PRLE** mais recentes via scraping da página "Histórico de Pareceres" do portal
- Adição/remoção manual de itens da pauta com link direto para a ficha da proposição

**Geração de análise por IA (Gemini, OpenAI ou Anthropic)**
- Para projetos: envia o **parecer de plenário (PRLP/PRLE)** ou, na ausência, o inteiro teor; para requerimentos: envia o próprio inteiro teor
- Documento entregue ao modelo como **PDF nativo** (sem conversão de texto), preservando formatação e evitando truncamento
- **Geração em lote** ("Gerar todas") com throttle de 1,5 s entre itens, contador de progresso e tratamento isolado de falhas por item
- **Detecção de truncamento** por provedor (`finishReason=MAX_TOKENS` no Gemini, `status=incomplete` na OpenAI, `stop_reason=max_tokens` no Anthropic) com auto-continuação automática que costura a resposta sem duplicar overlap
- Botão **Completar** (amarelo) aparece quando uma análise ainda fica truncada após a auto-continuação — clique para emendar mais um pedaço
- **Retry com backoff exponencial** (5 s / 15 s / 30 s) em respostas 429 (rate limit) e 5xx
- Botão **Parar tudo** (vermelho) aparece quando há qualquer chamada de IA em voo (lote, individual ou Completar) — usa `AbortController` global para abortar fetches em andamento, sleeps de throttle e timers de retry

**Edição manual com autosave**
- Editor inline de cada análise em Markdown com **autosave** debounceado em 1,5 s
- Indicador de status: "editando… / salvando… / ✓ salvo às HH:MM:SS / ⚠ erro — tentando de novo"
- Botão **Salvar** faz flush imediato + fecha o editor; **Cancelar** reverte para o snapshot inicial e re-grava no Firebase
- Aviso `beforeunload` se o usuário tentar fechar a aba com save pendente

**Persistência e organização**
- Cada análise é salva no Firebase em `/analises_pauta/{chave}/{parecerKey}`, vinculada à versão exata do parecer
- **Sidebar de pautas** com alternância entre pautas salvas e exclusão (que limpa também as análises órfãs)
- Garbage collection de análises órfãs no painel de Configurações

**Exportação em PDF institucional**
- Cabeçalho com **logo Podemos** à direita e texto "Liderança do Podemos na Câmara dos Deputados" centralizado
- **Texto justificado** nos parágrafos das análises
- **Todos os itens** da pauta aparecem no PDF — itens sem análise mostram placeholder ("Análise não gerada", "Falha ao gerar análise" ou "Análise em processamento") preservando o cabeçalho do item, autor, relator e badges
- Quebras de página respeitam o cabeçalho do item (título + autor + badges seguem junto da primeira linha de análise) mas o corpo flui naturalmente entre páginas, sem espaços em branco

---

### 6. Pautas CCJC

Gere resumos e análises dos projetos de lei da **Comissão de Constituição e Justiça e de Cidadania**, revise os textos e exporte a pauta consolidada em PDF.

**Importação da pauta**
- **Via PDF**: carregue o PDF da pauta da CCJC — o parser identifica automaticamente os projetos listados
- **Via Calendário**: selecione a reunião da CCJC diretamente do calendário institucional

**Geração por IA (Gemini ou Anthropic)**
- Para cada projeto: envia o inteiro teor ao modelo e gera resumo + análise técnica
- Suporte a **PDF nativo** (sem conversão de texto) preservando formatação
- Status visual por item: aguardando · processando · pronto · falha

**Revisão e edição**
- Editor inline de cada análise com salvamento automático
- Possibilidade de revisar e reescrever trechos antes da exportação
- Histórico de pautas anteriores na sidebar

**Exportação**
- Gera **PDF institucional** da pauta consolidada, com cabeçalho da Liderança e todos os itens revisados

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
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) → Get API key | `AIzaSy...` |
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
├── background.js                  # Service worker da extensão
├── icons/                         # Ícones da extensão + logo Podemos para o PDF
└── libs/
    ├── pdf.min.js / pdf.worker.min.js   # PDF.js — leitura de PDFs
    ├── html2canvas.min.js               # Geração de imagens
    ├── xlsx.full.min.js                 # Exportação para Excel
    └── docx.iife.js / docx.umd.js      # Exportação para Word
```

---

## APIs e serviços externos

| Serviço | Uso |
|---|---|
| [Dados Abertos da Câmara](https://dadosabertos.camara.leg.br) | Proposições, destaques, votações, deputados |
| [Portal da Câmara](https://www.camara.leg.br) | Sessões em andamento e documentos legislativos |
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
