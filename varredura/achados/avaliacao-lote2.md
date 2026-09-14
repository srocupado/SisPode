# Lote 2 — avaliação (14/09/2026)

Áreas: `ccjc`, `comissoes-gestao`, `pautas-comissoes`, `votacao-aderencia`.
15 achados do finder econômico, conferidos no código. Sete confirmados, oito
refutados. `pautas-comissoes` não rendeu achado nenhum.

## Confirmados

### 1. Deputados diferentes tratados como o mesmo no placar — CRÍTICO
`votacao.js:1003`

`mesmoDeputado` considera iguais dois nomes quando o menor (normalizado, só
letras) tem 6 caracteres ou mais e o maior começa por ele. Medido:

| par | resultado |
|---|---|
| Luiz Carlos × Luiz Carlos Motta | tratados como o mesmo |
| Ana Paula × Ana Paula Lima | tratados como o mesmo |
| Marcos Pereira × Marcos Pereira de Souza | tratados como o mesmo |

A função existe para casar "Dep. João da Silva" (portal) com "João da Silva"
(API), e nisso acerta. Mas a Câmara tem pares reais de nomes em que um é
prefixo do outro: ao complementar a bancada com os ausentes, o segundo
deputado é descartado como duplicata e SOME do placar que a Liderança publica.

Correção: comparar por identificador quando houver, e exigir igualdade do
nome inteiro (ou confirmação por partido e UF) quando só houver nome.

### 2. Conferência anti-alucinação desligada em silêncio — ALTO
`ccjc.js:1300-1306`

A leitura do texto-fonte vai num try/catch que engole tudo. PDF que não baixa
(proxy fora, servidor lento) faz a conferência de referências não rodar, e o
projeto é salvo com a lista de suspeitas vazia — indistinguível de "conferi e
nada é suspeito". É o mesmo defeito que o módulo de orçamento evita por
princípio declarado: fonte ilegível não vira aprovação.

### 3. Argumentos contrários rotulados como favoráveis — MÉDIO
`ccjc.js:1180`

Sem os cabeçalhos esperados no texto do modelo, `splitArgumentos` devolve o
texto inteiro como "favoráveis" e deixa "contrários" vazio. O leitor recebe
como argumento a favor o que pode ser contra.

Correção: não separar quando não há cabeçalho; exibir sob rótulo neutro.

### 4. "Pauta salva localmente" quando o que falhou foi justamente o local — MÉDIO
`ccjc.js:1619-1626`

Os dois saves estão no mesmo try. Falhando o local, o Firebase nunca é
tentado, e a mensagem diz "Firebase indisponível. Pauta salva localmente."

### 5. Contagens do placar viram zero quando o portal muda — MÉDIO
`votacao.js:963`

`getQtd` devolve 0 quando o seletor não casa. Mudança de HTML no portal
produz um placar inteiro zerado, apresentado como resultado.

### 6. Estado local alterado antes da gravação — MÉDIO
`comissoes.js:741`, `759`, `1902`

Designar, remover ou registrar deputado de acordo altera o objeto em memória e
só depois grava. Falhando a gravação, a tela mostra a designação que o Firebase
não tem, até alguém recarregar.

### 7. Gravação do objeto inteiro da comissão — MÉDIO
`comissoes.js:694`, `749`, `759`

Cada mudança grava `/membros/<sigla>` inteiro a partir do estado local. Dois
analistas mexendo na mesma comissão ao mesmo tempo: o último a salvar apaga a
designação do outro.

## Refutados

- **`ccjc.js:420` (fallback usa PAR)** — é rede de segurança declarada em
  comentário, e o cenário alegado é impossível: havendo um substitutivo, ele
  entra na seleção por família e o fallback nem roda.
- **`ccjc.js:534` (tipo PRL no fallback)** — a página antiga não informa a
  espécie documental; o comentário diz exatamente por que o tipo é atribuído.
- **`ccjc.js:1072` (ignora números de até 3 dígitos)** — decisão declarada,
  contra falso positivo. Ressalva: leis complementares de número curto (LC 95,
  LC 210) ficam fora da conferência; vale reavaliar o limiar por tipo de norma.
- **`comissoes.js:1562` (partido não verificado)** — a consulta já é
  `?siglaPartido=PODE`; o partido vem da própria API.
- **`comissoes.js:444` (sincronização apaga as manuais)** — o código preserva
  explicitamente as comissões de origem manual, do remoto e do local.
- **`comissoes.js:421` (falha pontual de MPV ignorada)** — declarado, e há
  guarda: nenhuma MPV retornada lança erro.
- **`comissoes.js:1903` (sem tratamento de erro)** — o await propaga o erro ao
  chamador; o que procede desse trecho já está no item 6.
- **`votacao.js:1150` (badge sem validar origem)** — o badge pertence ao fluxo
  do portal; não há o que validar.
