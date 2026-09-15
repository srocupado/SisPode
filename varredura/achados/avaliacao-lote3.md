# Avaliação do lote 3 — orçamento (notas, conferência), emendas, datas e números

Varredura de 15/09/2026, frentes `orcamento-notas`, `orcamento-conferencia`, `emendas`
e `x-datas-numeros`. 12 achados brutos; avaliados um a um no código.

**5 confirmados · 2 confirmados menores · 5 refutados.**

---

## Confirmados

### 1. `orcamento-notas.js:1045` — "Aceitar todas" declara sucesso por campos que não entraram

`aceitarProposta` (linha 1031) faz o certo: `if (!res.ok) { mostrarToast(res.erro, 'aviso'); return; }`.
`aceitarTodasPropostas` ignora o retorno de `preencherCampo`, esvazia
`estado.propostas.aceitas` e anuncia `✓ N campo(s) preenchido(s)` com o N de
**candidatos**, não de gravados. `preencherCampo` recusa quando falta valor ou
falta documento (`ficha.js:112-116`) — exatamente a recusa que existe para
impedir número sem procedência. Efeito: a proposta recusada desaparece da tela,
o analista lê "✓", e a ficha fica sem o campo.

**Gravidade: alta** (perda silenciosa de proposta + afirmação falsa).

### 2. `orcamento-notas.js:1478` — `salvarFicha` grava a ficha inteira (último a salvar apaga o outro)

`PUT` de `estado.ficha` no nó todo. A ficha é declaradamente compartilhada — o
próprio comentário da linha 570 diz "a ficha, que é compartilhada: a equipe
inteira fica sabendo". Duas abas abertas: A preenche `pib`, salva; B (cuja
cópia foi carregada antes) preenche `ipca`, salva → `pib` volta a vazio, sem
aviso nenhum. Mesma família já corrigida em `comissoes.js` (`gravarMembros`,
leitura-modificação-escrita).

**Gravidade: alta.**

### 3. `orcamento-notas.js:913` — leitura de cartilha: aviso antes de salvar, falha engolida

O toast sai nas linhas 906/910 e só depois vem
`await salvarIA().catch(e => console.warn('Firebase:', e.message))`. O
comentário da linha 901 explica o porquê de registrar até o erro: "sem isso a
cartilha voltaria à fila a cada abertura da tela, gastando uma chamada por
vez". É precisamente o que acontece, calado, quando o `salvarIA` falha — e no
caso de sucesso o analista acha que a leitura está registrada para a equipe.

### 4. `orcamento-notas.js:1616` — "Ficha conferida" sem ter salvado a conferência

`await salvarFicha().catch(e => console.warn(...))` e, na linha seguinte,
`mostrarToast('Ficha conferida: N localizado(s)…')`. A conferência de cada
número contra o Manual é trabalho que não se repete de graça: se o `PUT`
falhou, o próximo analista abre a ficha sem conferência alguma, sem saber.

### 5. `orcamento-notas.js:572` — "gravado(s) na ficha" sem confirmação de gravação

`estado.ficha.leituraMensagem` (marca da leitura para a equipe inteira) e os
parâmetros macro entram na ficha e o `salvarFicha` das linhas 574/585 tem a
falha engolida em `console.warn`. A linha 586 então afirma
`✓ N parâmetro(s) … lido(s) da Mensagem e gravado(s) na ficha, com página e
trecho`. O verbo "gravado" é uma afirmação de persistência que o código não
verificou.

---

## Confirmados menores

### 6. `emendas.js:184` — o grito de precisão fica só no console, e só para a primeira UF

`_avisouPrecisao` é módulo-global: se AC vem como texto e SP e TO vêm como
número, o aviso nomeia **só SP** e o analista não descobre que TO também está
com os últimos dígitos arredondados. E é `console.warn`: a tela mostra a lista
com o toast de sucesso. O caminho correto existe ao lado — `falhas`, que a
varredura já exibe no toast e no log da coleta.

### 7. `cmo.js:276` — data incompleta entra no cronograma quando as DUAS pontas vêm sem ano

`comAno` herda o ano da outra ponta; o comentário assume que uma delas sempre o
traz ("O ano que falta é herdado da outra ponta, que sempre o traz"). Quando
nenhuma traz, o fallback devolve o texto cru e o item entra com
`inicio: '06/12'`. O item aparece na nota com uma data sem ano em vez de ser
declarado ilegível. Baixa probabilidade, mas contraria a doutrina do projeto
(falha declarada, nunca meia-informação apresentada como informação).

---

## Refutados

### 8. `emendas.js:407` — decisão deliberada e comentada

O comentário três linhas acima é a própria decisão: "A tela passa a valer o que
FOI LIDO nesta rodada, não o que o banco devolve: assim uma UF que falhou ao
salvar continua visível (e declarada), em vez de desaparecer no
recarregamento". Não há perda: `state.meta[uf].salvo` guarda o resultado da
gravação por UF e o toast da linha 421 nomeia os estados com problema.

### 9. `emendas.js:805` — a falha do Firebase já é declarada

`fbSalvarPanorama(...).catch(e => { falhas.push('Firebase: ' + e.message); console.warn(...) })`
e, adiante, `mostrarToast('… N problema(s): ' + falhas[0], 'aviso')` + log
completo no console. O achado descreveu um `catch` vazio que não existe.

### 10. `mensagem.js:234` — `col` não pode ser -1

A linha de cabeçalho só é aceita (linha 231) se casar
`new RegExp('\\b' + ano + '\\b')`, e `anos` é justamente
`linhas[iCab].match(/\b20\d\d\b/g)`. Como `ano` vem de `estado.ano`, que é a
chave de exercício escolhida no seletor (`orcamento-notas.js:2184/2190`, sempre
`20\d\d`), o ano exigido no cabeçalho está necessariamente dentro de `anos`.

### 11. `orcamento-notas.js:1703` — caminho de rótulo de fallback

`rotuloValorNota` só é chamado quando o item não trouxe `texto` e o gráfico não
trouxe `rotuloValor` — e os três gráficos reais passam um dos dois
(`:2051`, `:2052`, `:2055`). A inconsistência apontada (`' bi'` acima de 1000 e
nada abaixo) fica num caminho cosmético que a nota não percorre.

### 12. `pauta-parser.js:388` — a dobra em 50 está certa para o acervo

Apensados de pauta são proposições de 1988 até hoje: `51`–`99` → 19xx e
`00`–`26` → 20xx é o que a dobra faz. Só um projeto dos anos 1950 (ano `50`,
1950 → 2050) sairia errado, e nenhum chega a apensado de pauta de comissão
hoje. Apertar a dobra no ano corrente é melhoria opcional, não defeito.
