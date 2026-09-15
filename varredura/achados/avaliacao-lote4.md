# Lote 4 — avaliação (15/09/2026)

Áreas: `parecer-nucleo`, `parecer-dados`, `ia-comum`, `analise-parecer-tela`.
15 achados, conferidos no código e, onde deu, por execução. Seis confirmados,
oito refutados, um não avaliado a fundo.

## Confirmados

### 1. Item some da pauta quando o PDF perde o acento — CRÍTICO
`pauta-parser.js:289`

O regex que acha os cabeçalhos é montado com o prefixo CRU do tipo, enquanto
cada tipo tem, ao lado, um regex tolerante a acento e cedilha construído
justamente porque "a extração produz variações". O cabeçalho só é reconhecido
com a acentuação perfeita. Medido:

```
PROPOSTA DE EMENDA A CONSTITUICAO Nº 45, DE 2019   → item ignorado
PROPOSTA DE EMENDA À CONSTITUIÇÃO Nº 45, DE 2019   → PEC 45/2019
```

É o mesmo defeito que o comentário do tipo MSC descreve ter corrigido em
setembro: o item "sumia da análise em silêncio". A pauta é importada sem a
proposição, e ninguém vê falta.

Correção: montar o cabeçalho com a mesma tolerância de acento já usada no
regex por tipo.

### 2. Mensagem do Executivo não é reconhecida no formato compacto — ALTO
`pauta-parser.js:435`

A lista de siglas do dashboard compacto não inclui MSC, embora o tipo exista na
tabela de proposições desde a pauta de 01/09/2026. Uma mensagem listada nesse
formato é descartada sem aviso.

### 3. Tipo não reconhecido vira "PL" em silêncio — ALTO
`pauta-parser.js:198`

Quando o tipo por extenso não casa com nenhum da tabela, a sigla assumida é PL.
Combinado com o item 1, uma PEC mal acentuada que chegue a esse ponto entra na
pauta como projeto de lei — e toda a busca na API passa a ser feita sobre a
proposição errada.

### 4. Falha ao salvar o parecer é engolida, e o toast diz sucesso — ALTO
`analise.js:6626`

A gravação do parecer no Firebase termina em `.catch(console.warn)`. Falhando,
a mensagem de sucesso aparece igual e o documento fica só em memória. Um
parecer custa de 7 a 12 minutos e centenas de milhares de tokens; ao recarregar
a pauta, esse trabalho não está mais lá.

### 5. Mês sem deflator entra na média "real" sem deflacionar — MÉDIO
`dossie.js:360`

`deflator[m] || 1` trata fator ausente como 1, que é também o fator legítimo do
mês de referência. Série cujo mês final ainda não tem IPCA publicado produz uma
média "a preços de hoje" que mistura valores nominais e reais, sem ressalva.

### 6. Validação de URL aceita caractere inválido — BAIXO
`pipeline-parecer.js:222`

`^https?:\/\/\S+$` aceita aspas e sinais de maior/menor. A URL malformada vai
para a tabela de fontes (escapada no HTML, então não há injeção, mas o link
quebra).

## Refutados

- **`analise.js:3981` (meta em subcaminho inexistente)** — o banco em tempo real
  serve qualquer subcaminho de um objeto gravado; `/pareceres/<chave>/meta.json`
  existe porque `meta` é campo do parecer salvo.
- **`analise.js:6386` (chave com pauta sem id)** — toda pauta nasce com id, e o
  id é a própria chave sob a qual ela é gravada.
- **`gates.js:159` ("atingido" como substantivo)** — o risco existe, mas é
  trade-off consciente: rebaixar o veredito importa mais, e o plural "atingidos"
  já não casa. Mexer aqui traz mais regressão do que ganho.
- **`gates.js:139` (título não escapado no regex)** — o título é constante do
  código, sem metacaractere.
- **`tese.js:576` (catálogo nulo)** — o catálogo é sempre passado pelo pipeline.
- **`tese.js:563` ("não sustenta" como erro concreto)** — é motivo legítimo de
  remoção: a evidência não sustenta a afirmação.
- **`dossie.js:383` (repartição de números colados)** — funciona nos formatos
  que o comentário documenta; testei as quebras reais dos PDFs da Receita.
- **`pipeline-parecer.js:199` (só a primeira lei do dispositivo)** — impacto é
  buscar uma norma a menos no dossiê, não erro de conteúdo.

## Não avaliado

- **`dossie.js:430` (remoção de separadores em números muito grandes)** — exige
  amostra real de PDF para julgar; fica para quando o lote 3 rodar, que cobre a
  mesma família de defeito.
