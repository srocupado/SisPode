# SisPode — Sistemas Legislativos do Podemos

Extensão do Chrome para a equipe de plenário da **Liderança do Podemos** na Câmara dos Deputados. Reúne três ferramentas integradas para acompanhamento de sessões, votações e análise de aderência ao governo.

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

**Análise por IA (Google Gemini)**

O sistema classifica automaticamente cada destaque e busca o documento-fonte correto para envio ao Gemini, evitando alucinações:

| Tipo de destaque | Documento buscado |
|---|---|
| Substitutivo/emenda adotado por comissão (CASO 0) | Inteiro teor do substitutivo adotado, via histórico de pareceres |
| DVS de substitutivo do relator de plenário (CASO 1a) | Substitutivo do relator (arquivo PRLP/SBT) na página de pareceres |
| DVS de subemenda substitutiva de plenário — SSP (CASO 1b) | Arquivo SSP na página de emendas |
| DVS de emenda específica numerada (CASO 2) | Texto da emenda via página de emendas da proposição |
| DVS de dispositivo do PL original (CASO 3) | PDF do próprio destaque ou inteiro teor via API |
| **Destaque de Preferência (CASO 4)** | **Upload manual de 2 PDFs pelo usuário** |

- Todos os documentos são enviados ao Gemini como **PDF nativo** (`inline_data`), preservando a formatação e evitando truncamento de texto
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

### Google Gemini (para análise automática de destaques)

1. Acesse [aistudio.google.com](https://aistudio.google.com) → **Get API key** → **Create API key**
2. Na extensão, abra **⚙ Configurações** → cole a chave no campo **Chave de API do Gemini**
3. Clique em **Carregar disponíveis** para listar os modelos disponíveis e selecionar o desejado
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
├── votacao.html / votacao.js   # Módulo: Painel de Votação
├── aderencia.html / aderencia.js  # Módulo: Aderência ao Governo
├── background.js               # Service worker da extensão
├── icons/                      # Ícones da extensão (16, 48, 128 px)
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
| [Google Gemini](https://aistudio.google.com) | Análise automática de destaques por IA |
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
- Chave de API do Google Gemini (necessária para geração de análises por IA)
