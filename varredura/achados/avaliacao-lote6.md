# Lote 6 — avaliação (15/09/2026)

Áreas: `panel-destaques`, `x-concorrencia`, `x-testes`.
8 achados; 7 confirmados (6 deles com a mesma causa e uma só correção),
1 refutado. A frente de testes não achou defeito de produto.

## Confirmados

### 1. Destaque já votado aparece como "Ativo" — CRÍTICO
`panel.js:15`

A lista de situações inativas tem retirado, prejudicado, rejeitado e as formas
de não admitido, mas não tem **aprovado** nem **mantido o texto**. A prova de
que são situações de conclusão está no próprio arquivo, duas linhas abaixo: o
mapa de cores reconhece as duas e lhes dá classe própria (`status-aprovado`,
`status-mantido`). Como a etiqueta exibida é "Ativo" sempre que o destaque é
considerado ativo, o painel mostra a cor de concluído com o texto "Ativo".

Cenário: o destaque foi votado e o texto mantido. Na aba de ativos ele continua
listado como pendente, e a assessoria prepara orientação para uma votação que
já aconteceu.

Correção: acrescentar as duas situações à lista de inativas.

### 2. Resultado de requisição antiga escreve no card da pauta nova — ALTO
`analise.js:1830`, `1968`, `2074`, `3977`, `3982`, `4213`

Seis pontos chamam `renderAnaliseCard(it)` ou `atualizarBotaoParecer(it)` depois
de operação longa (leitura no Firebase, geração por IA de vários minutos) sem
verificar se o item ainda pertence à pauta aberta. A função protege contra card
inexistente, mas não contra card **de outra pauta com a mesma chave** — e a
mesma proposição aparecer em duas pautas é rotina.

Cenário: gero a análise do PL 1234/2026 na pauta da semana passada, troco para a
pauta desta semana enquanto o modelo escreve, e a análise antiga aparece no card
da pauta nova.

Correção: uma guarda de item ativo dentro de `renderAnaliseCard` e de
`atualizarBotaoParecer` cobre os seis pontos de uma vez — o projeto já tem
`itemAindaAtivo`, usado no enriquecimento exatamente para isso.

## Refutado

### Botão preso em "Gerando…" após troca de pauta — `analise.js:1980`
Ao trocar de pauta, a lista é reconstruída do zero, e o botão do card novo nasce
habilitado. O `finally` mexe num botão órfão, sem efeito visível.

## Sobre a suíte de testes

A varredura rodou os 38 arquivos e não achou defeito de produto. A falha
antiga de `analise-mpv.test.js` é de teste vencido pela realidade, não de
código: o teste espera o diagnóstico de MPV **sem** Projeto de Lei de Conversão,
e a Comissão Mista concluiu — a MPV 1357/2026 passou a ter PLV. A própria saída
do teste anuncia isso ("a Comissão Mista concluiu: a MPV 1357/2026 agora tem
PLV") antes de falhar no item seguinte.

Vale desamarrar esse teste do estado vivo da proposição: ou fixar a resposta da
API numa fixture, ou tornar o item condicional ao cenário que ele quer provar.
