# Lote 7 — avaliação (15/09/2026)

Frentes transversais: `x-segredos` e `x-firebase`. 8 achados; nenhum é defeito
ativo. Dois viram recomendação de postura; seis são refutados. É o primeiro lote
sem correção a fazer — e, nas duas frentes, o motivo é que a defesa já existe.

## O que foi verificado e está limpo

- **Nenhum segredo versionado.** Varredura da árvore rastreada por padrões de
  chave do Google, Anthropic, OpenAI, token do Telegram e a chave do Portal da
  Transparência: nada. As chaves conhecidas desta sessão também não aparecem.
- **Chave nunca vai ao Firebase.** As chaves ficam em `chrome.storage.local`
  (extensão) e em disco na máquina do bot. O banco tem regras abertas, e é
  justamente por isso que a regra "chave não entra no Firebase" está declarada
  em três arquivos.
- **Chave não aparece em PDF exportado nem em log copiável.**
- **A URL com chave não chega a mensagem de erro.** Os dois ajudantes que
  colocam a URL no texto do erro (`fetchJson` e `fetchJsonCamara`) são usados
  só com a API da Câmara. Nenhuma chamada a provedor de IA passa por eles.

## Recomendações (não são defeito)

### 1. Chave do Gemini na query string — 26 pontos, 14 arquivos
A chave vai como `?key=…`. Não vaza por erro (acima), mas aparece na aba de
rede do navegador, em proxy corporativo e em qualquer log intermediário que
registre URL. O Google aceita o cabeçalho `x-goog-api-key` para a mesma
chamada. A troca é mecânica, porém toca 26 pontos em 14 arquivos: vale fazer
num passo próprio, com a suíte inteira rodando depois, e não junto de correções
de conteúdo.

### 2. Fallback do salvamento de destaque
`panel.js:2917` — quando `indexOf` não encontra a proposição ou o destaque por
referência, cai num PUT da sessão inteira, que é o last-write-wins que o
comentário logo acima diz querer evitar. O caminho é raro (o sync automático é
adiado enquanto há operação em voo e enquanto o modal está aberto), mas seria
melhor localizar por chave antes de desistir do PATCH granular.

## Refutados

- **`bot/index.js:2136`, `bot/index.js:1913`, `bot/src/ia.js:82`,
  `panel.js:51`, `analise.js:1554` (chave no stack trace)** — o cenário exige
  que a URL esteja na exceção, e os erros de rede do `fetch` não a trazem; os
  pontos do código que citam URL em mensagem de erro não recebem URL com chave.
  O que sobra é a recomendação 1.
- **`panel.js:2902`, `2914`, `2917` (gravação no Firebase)** — o módulo já faz
  PATCH granular exatamente para não sobrescrever a edição de outro analista, e
  o comentário declara isso. O sync automático tem três guardas contra trocar os
  objetos sob os pés de uma operação em voo. O resíduo legítimo está na
  recomendação 2.
