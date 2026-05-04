# Sistemas Legislativos – Podemos

Extensão do Chrome para a equipe de plenário da **Liderança do Podemos** na Câmara dos Deputados. Reúne três ferramentas integradas para acompanhamento de sessões, votações e análise de aderência ao governo.

---

## Funcionalidades

### 1. Destaques Legislativos
Analise e oriente a votação de destaques de projetos de lei nas sessões do Plenário.

- Carregue o PDF da pauta comentada da sessão para extrair automaticamente as proposições
- Consulta os destaques de cada proposição em tempo real via API de Dados Abertos da Câmara
- Gera explicações automáticas de cada destaque usando **Google Gemini** (IA generativa)
- Sincroniza sessões entre dispositivos via **Firebase Realtime Database**
- Exporta o conteúdo de cada destaque para **Word (.docx)** ou formata para envio no **WhatsApp**
- Mantém histórico de sessões anteriores com busca por proposição

### 2. Painel de Votação
Acompanhe os votos da bancada em votações nominais do Plenário.

- **Aba Dados Abertos**: busca votações por data via API da Câmara (histórico)
- **Aba Link Portal**: acompanha sessões em andamento pelo portal da Câmara (tempo real)
- Exibe placar detalhado com votos individuais de cada deputado (Sim, Não, Abstenção, Art. 17, Obstrução, Ausente)
- Mostra a orientação da bancada para cada votação
- Gera **imagem da votação** para compartilhamento usando html2canvas

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

### Google Gemini (opcional, para explicações automáticas de destaques)

1. Acesse [aistudio.google.com](https://aistudio.google.com) → **Get API key** → **Create API key**
2. Na extensão, abra **Configurações** → cole a chave no campo **Chave de API do Gemini**
3. Clique em **Carregar disponíveis** para selecionar o modelo
4. Escolha a profundidade da explicação: resumo, completo ou com argumentos

---

## Estrutura de arquivos

```
sispode/
├── manifest.json          # Manifesto da extensão (MV3)
├── panel.html / panel.js  # Módulo: Destaques Legislativos
├── panel.css              # Estilos do painel principal
├── votacao.html / votacao.js   # Módulo: Painel de Votação
├── aderencia.html / aderencia.js  # Módulo: Aderência ao Governo
├── background.js          # Service worker da extensão
├── icons/                 # Ícones da extensão (16, 48, 128 px)
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
| [Dados Abertos da Câmara](https://dadosabertos.camara.leg.br) | Votações, destaques, deputados |
| [Portal da Câmara](https://www.camara.leg.br) | Sessões em andamento |
| [Firebase Realtime Database](https://firebase.google.com) | Sincronização de sessões |
| [Google Gemini](https://aistudio.google.com) | Explicações automáticas de destaques |

---

## Permissões da extensão

- `storage` — salva configurações e cache de sessões localmente
- `tabs` — detecta abas abertas do portal da Câmara (sessão em andamento)
- `host_permissions` — acesso às APIs listadas acima

---

## Requisitos

- Google Chrome (versão compatível com Manifest V3)
- Conexão com internet para consultar as APIs da Câmara
- Chave de API do Google Gemini (opcional, para geração de explicações por IA)
