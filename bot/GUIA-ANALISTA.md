# SisPode Bot — guia do analista

O bot da Liderança no Telegram avisa quando sai **Pauta da Semana** nova,
importa a pauta para o SisPode e responde perguntas sobre as matérias usando
as notas técnicas e os documentos oficiais.

## Primeiros passos (5 minutos)

1. **Encontre o bot** no Telegram (o administrador informa o @username).
2. Envie **/start**. O bot pede a **palavra-chave de acesso** — peça-a ao
   administrador, envie no privado e pronto: você entra na hora (a mensagem
   com a palavra é apagada automaticamente). Se o bot em vez disso mostrar o
   seu ID, é porque a equipe usa aprovação manual — aguarde a liberação.
3. **Configure sua chave de IA** (necessária só para perguntas/voz/linguagem
   natural — os comandos básicos funcionam sem ela):
   - No **privado** do bot, envie **/config**;
   - Escolha seu provedor (Gemini, OpenAI ou Anthropic — o mesmo que você usa
     na extensão SisPode) e cole a sua chave;
   - O bot valida a chave e **apaga a mensagem** que a continha.

> A chave fica guardada apenas na máquina do bot, nunca no Firebase nem no
> grupo. `/minhachave` mostra qual está ativa (mascarada); `/removerchave`
> apaga.

## O que o bot faz

| Você envia | O bot faz |
|---|---|
| `/pauta` | Lista as pautas guardadas no **SisPode** (com nº de itens e análises prontas) para você **escolher qual usar** — a escolhida vale para `/listar`, `/perguntar`, `/analisar` e `/exportar` (por ~12h ou até trocar). O botão **🔎 Buscar on-line** consulta o site da Câmara (Pauta da Semana + Ordem do Dia de hoje) |
| `/importar` | Importa a Pauta da Semana do site para o SisPode (pede confirmação; avisa se for sobrescrever uma pauta editada pela equipe) |
| `/ordemdodia` | Importa a **Ordem do Dia** (pauta *diária*) da sessão de hoje, direto da API da Câmara. Mais precisa que a semanal — é o que será votado no dia. Quando a sessão começa, o monitor oferece um botão para importar |
| *(enviar um PDF de pauta no privado)* | O bot identifica os itens e oferece a importação — serve para a pauta do dashboard, que não fica em URL pública |
| `/analisar` | Gera as notas técnicas da pauta importada — mesmo fluxo do "Gerar todas" do painel, rodando na **sua** chave (pede confirmação e mostra o progresso) |
| `/exportar` | Gera e envia o **PDF institucional** da pauta com as análises (idêntico ao do painel) |
| `/nota PL 1234/2026` | Mostra a **nota técnica como está salva** no painel — texto integral, **sem a IA reprocessar**. Use quando quer LER a nota (não perguntar sobre ela) |
| `/perguntar PL 1234/2026 qual o impacto no SUS?` | A IA **responde** com base na nota técnica e nos documentos (texto elaborado, não a nota literal — para o texto integral use `/nota`) |
| `/perguntar algum item é de autoria do Podemos?` | Pergunta sobre a **pauta em geral**. Autoria do Podemos é sempre **verificada na API da Câmara**, não inferida pela IA |
| `/documentos PL 1234/2026` | Lista os documentos da tramitação (pareceres, emendas, textos) que **não** foram considerados na nota técnica |
| `/agregar 1,3` | Inclui na conversa os documentos listados (pelos números) — a IA passa a considerá-los nas próximas respostas |
| `/limpar` | Zera a conversa atual com a IA (histórico e documentos agregados) |
| `/ajuda` | Lista os comandos |

Depois da primeira pergunta sobre um item, você pode continuar perguntando
sem repetir a sigla — o bot lembra o item ativo por até 1 hora.

## Linguagem natural e voz

Com a chave configurada, você não precisa decorar comandos:

- **No privado**: escreva normalmente — "tem pauta nova?", "importa a pauta",
  "o que o PL 1234 muda no ECA?" — ou **mande um áudio** 🎤.
- **No grupo**: mencione o bot (`@nome_do_bot tem pauta nova?`).

Ações que gravam no sistema (como importar) **sempre** pedem confirmação por
botão, mesmo em linguagem natural.

> A interpretação roda na **sua** chave de IA (custo de centavos por
> mensagem). Comandos com `/` são gratuitos e instantâneos.

## Avisos automáticos

O bot monitora o site da Câmara em horário útil (seg–sex) e, quando sai
pauta de semana nova, avisa **no privado de cada analista autorizado** —
com o botão "📥 Importar para o SisPode" pronto. (Basta estar autorizado;
não precisa ativar nada.)

## Dicas e limites

- Perguntas sobre um item só funcionam se a **análise já foi gerada** no
  painel "Análise de Pauta" (é ela que aponta os documentos oficiais).
  Sem análise, o bot avisa.
- Se a resposta não estiver nos documentos, o bot diz "não consta nos
  documentos" — ele é instruído a **não inventar** leis, números ou datas.
- Voz: quem usa chave **Anthropic** depende do transcritor padrão do bot
  (o administrador configura); Gemini e OpenAI transcrevem na própria conta.
