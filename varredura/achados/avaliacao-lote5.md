# Lote 5 — avaliação (15/09/2026)

Áreas: `bot-nucleo`, `bot-monitor`, `bot-conteudo`, `bot-infra`.
10 achados; 5 confirmados (2 críticos), 3 refutados, 2 de baixo impacto.

O achado mais grave é o MESMO defeito corrigido na Reunião de Líderes no lote 1,
agora no bot — e aqui é pior, porque a frase entregue ao analista usa a palavra
"VERIFICADA".

## Confirmados

### 1. Bot afirma "AUTORIA VERIFICADA: nenhum do Podemos" quando a consulta falhou — CRÍTICO
`bot/src/perguntar.js:178` e `:122`

`siglaPartidoDep` engole qualquer falha, devolve nulo **e guarda o nulo em
cache**. Sem partido, o autor é marcado como não sendo do Podemos, e o texto
que vai ao analista afirma, categórico:

> AUTORIA VERIFICADA (API da Câmara): nenhum(a) autor(a)/coautor(a) filiado(a)
> ao Podemos hoje.

O próprio arquivo documenta, na descrição da estrutura de autoria, que o valor
nulo significa "não foi possível verificar (não afirma)". Este caminho viola a
regra que o arquivo declara. Como o cache vive enquanto o processo do bot roda —
dias —, uma oscilação de segundos contamina todas as respostas seguintes sobre
aquele deputado.

Correção: distinguir "consultei e não é do Podemos" de "não consegui consultar",
não cachear a falha, e dizer ao analista que a autoria não pôde ser verificada.

### 2. `/colegio` dá "não há requerimento de urgência" quando a API cai — CRÍTICO
`bot/src/materia.js:49`

É a mesma função de `lideres.js`, com o comentário "porte de lideres.js": devolve
lista vazia em qualquer falha, e a lista vazia vira "não há requerimento de
urgência apresentado" na ficha. O `/colegio` é usado DURANTE a reunião, para
matéria que não entrou na lista — o momento em que um fato errado custa mais.

### 3. Apensada do Podemos some quando a consulta falha — ALTO
`bot/src/perguntar.js:127`

`catch(() => ({ ehPode: false }))` transforma falha em "não é do Podemos". Aqui o
efeito é omissão (a apensada não é listada), não afirmação contrária, mas o
analista não sabe que faltou verificar.

### 4. Registro das mensagens do grupo falha em silêncio — MÉDIO
`bot/index.js:44` e `bot/src/monitor.js:123`

A gravação do registro de mensagens revisáveis termina em `catch(() => {})`. O
`/revisar_msg` passa a ter lacunas sem avisar: o analista procura a mensagem que
o bot mandou e ela não está na lista.

### 5. Ferramenta do agente sem tempo limite — MÉDIO
`bot/src/agente.js:271`

O laço do agente aguarda a ferramenta sem prazo. Uma conexão pendurada trava a
conversa inteira, e o usuário fica vendo "digitando" indefinidamente.

## Refutados

- **`bot/src/ia.js:105` ("formato de requisição OpenAI completamente
  incorreto")** — o corpo está certo para a Responses API (`input` com
  `input_text`), idêntico ao da extensão, que funciona em produção.
- **`bot/src/portal.js:128` (tipo de voto vazio contado como voto)** — o finder
  afirmou que string vazia é verdadeira em JavaScript; é falsa, então o filtro
  já a descarta.
- **`bot/src/portal.js:124` (voto vazio vira ausente)** — a classificação testa
  antes a classe do elemento (`sim`/`nao`); só cai em ausente quando não há nem
  classe nem texto, situação em que não há voto a afirmar.

## Baixo impacto, registrados sem correção

- **`bot/src/materia.js:297`** — documentos relacionados devolvem lista vazia
  quando a consulta falha. O cenário monta com menos peças, mas o módulo
  distingue ausência declarada em outros pontos; vale rever junto do item 2.
- **`bot/src/pauta.js:65`** — período com dias invertidos ("17 a 13 de julho")
  produz intervalo invertido. Depende de erro de digitação na fonte.
