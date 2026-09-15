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
| `/baixar PL 1234/2026` | Envia os **PDFs para você baixar**: 📄 os usados na nota + 📎 os adicionais da tramitação. Toque em cada um, ou em "📥 Baixar todos" |
| `/agregar 1,3` | Inclui na conversa os documentos listados (pelos números) — a IA passa a considerá-los nas próximas respostas |
| `/limpar` | Zera a conversa atual com a IA (histórico e documentos agregados) |
| `/digest` | 📺 **Radar de Imprensa** (assinantes autorizados pelo admin): resume os temas do Fantástico, Jornal Nacional, Profissão Repórter, Globo Rural e Agência Brasil, avalia a **relevância legislativa** de cada um e sugere ações (PL, requerimentos, CPI, audiência…). Marca 👤 os deputados com **temas de interesse** aderentes (mesma configuração do painel Análise de Pauta). Botão **📝 Minuta N** gera a minuta da proposição em **PDF** (rascunho de IA — revisar com a Consultoria antes de protocolar). Envio automático toda **segunda, 7h** |
| `/comissao CCJ hoje` | **Pauta de uma comissão** da Câmara numa data — projetos, autor+partido, relator e voto do relator (dado oficial da API, verbatim). A frase serve para nome **e** data |
| `/comissoeshoje [data]` | Lista **quais comissões** têm reunião deliberativa na data (nomes e horários) |
| `/varrercomissoes [data]` | **Varre todas** as comissões com reunião deliberativa e mostra onde há projeto de **autoria ou relatoria do Podemos** (leva alguns segundos) |
| `/colegio PL 1234/2026` | **Ficha de uma proposição avulsa** no formato do resumo da Reunião de Líderes — para o que não entrou na lista. Os fatos (situação da urgência, apensação, relatoria, parecer, retorno do Senado, marcações do Podemos) saem **na hora**; o resumo por IA vem em seguida |
| `/ata` | **Modo de anotação da Reunião de Líderes** — você vai escrevendo (ou ditando) o que for definido e, ao final, o bot monta a **mensagem pronta para o WhatsApp** da bancada. Ver a seção abaixo |
| `/ajuda` | Lista os comandos |

> As três também funcionam em **linguagem natural**: *"tem projeto do Podemos na pauta da CCJ amanhã?"*, *"quais comissões se reúnem hoje?"*, *"quais comissões com reunião hoje têm algo do PT?"*. Tudo é dado oficial da API de Dados Abertos — o bot **não inventa**: sem reunião, diz que não há; comissão ambígua, pergunta qual.

Depois da primeira pergunta sobre um item, você pode continuar perguntando
sem repetir a sigla — o bot lembra o item ativo por até 1 hora.

## Anotar a Reunião de Líderes (`/ata`)

Serve para o analista que acompanha o Colégio de Líderes e precisa, ao final,
repassar as definições aos deputados da bancada.

1. **`/ata`** no privado abre a ata do dia.
2. **Vá anotando.** Com a ata aberta, tudo o que você escrever aqui vira
   anotação — uma ideia por mensagem. **Áudio também** 🎤: o bot transcreve e
   anota (a transcrição aparece para você conferir). Cada anotação recebe um
   número (`📝 7`).
3. **`/ata fim`** (ou o botão **✅ Gerar mensagem**) devolve o texto pronto,
   sozinho numa mensagem, para você copiar e colar no WhatsApp.

| Durante a ata | |
|---|---|
| `/ata ver` | Lista as anotações numeradas, com a hora |
| `/ata apagar 3` | Apaga a anotação 3 (útil quando o áudio saiu torto) |
| `?tem parecer no PL 1234/2026?` | Mensagem começada com **`?`** vai para a IA em vez da ata |
| `/colegio PL 1234/2026`, `/pauta`… | Comandos continuam funcionando normalmente |
| `/ata descartar` | Joga a ata fora (pede confirmação) |
| `/ata ultima` | Reenvia a mensagem da última ata fechada, sem gerar de novo |

A mensagem sai no padrão fixado pela Liderança — *Amigos,* / *Nesta semana:* /
*Próxima semana:* / *⚠️ Atenção:*. **O formato é montado pelo sistema**, não
pela IA: bloco sobre o qual você não anotou nada é **omitido**, não preenchido.
Depois da mensagem o bot manda, em separado, **o que ficou de fora** e os
avisos de conferência — inclusive se algum projeto citado no texto **não
aparece nas suas anotações**, ou se um projeto que você anotou **ficou fora**
da mensagem. Quem decide o que vai para os deputados é você.

As anotações ficam **na máquina do bot**, não no Firebase, e sobrevivem a
reinício — a ata continua aberta até você fechar ou descartar.

## Linguagem natural e voz

Com a chave configurada, você não precisa decorar comandos:

- **No privado**: escreva normalmente — "tem pauta nova?", "importa a pauta",
  "o que o PL 1234 muda no ECA?" — ou **mande um áudio** 🎤.
  (Com uma **ata aberta** (`/ata`), texto e áudio viram **anotação**; para
  perguntar sem fechar a ata, comece a mensagem com `?`.)
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
