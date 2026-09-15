# Lote 1 — avaliação (14/09/2026)

Áreas varridas: `lideres` e `congresso`. Finder econômico; cada achado abaixo foi
conferido no código pelo modelo da sessão, com execução quando possível.

## Confirmados

### 1. Falha na API vira "não há requerimento" e é gravada no Firebase — CRÍTICO
`lideres.js:836` + `lideres.js:2586`

`buscarTramitacoes` devolve lista vazia em QUALQUER falha (HTTP não-ok ou exceção),
e `situacaoDe([])` devolve `"Não há requerimento de urgência apresentado."` (medido).
Em `atualizarSituacaoDemanda` isso não é tratado como falha: `mudou` fica true, a
demanda é regravada no Firebase compartilhado e a tela diz "Situação de X atualizada".

Cenário: a demanda estava "Urgência aprovada (REQ. 123/2026)". A API da Câmara oscila.
O analista clica em ↻ (ou o e-mail reconsulta todas). A situação vira "não há
requerimento", some do registro a informação verdadeira, e o e-mail ao Presidente
sai com a lista errada — o próprio comentário do código chama isso de "o defeito
mais caro deste sistema".

Correção mínima: `buscarTramitacoes` distinguir "vazio" de "falhou" (devolver null ou
lançar), e `atualizarSituacaoDemanda` não gravar nem declarar mudança quando a
consulta falhou.

### 2. Apensado marcado como principal na lista do Colégio — ALTO
`lideres.js:347`

`ehPrincipal` testa se existe "(Principal" em qualquer ponto ANTES da proposição.
Medido em Node: `"(Principal: PL 23/2026) PL 1242/2026"` marca as duas como
principais. A que abre a célula depois do parêntese é a listada (apensada) e sai
com o selo "principal" na tela, no PDF e na planilha.

Correção mínima: considerar apenas o trecho entre o parêntese aberto e o fechado —
é principal quem está DENTRO de "(Principal: …)".

### 3. Parar no meio das razões do veto grava o parcial por cima do completo — ALTO
`congresso.js:800-810`

O laço por lotes faz `break` ao abortar e, fora dele, `veto.razoesGrupos = grupos` com
o que houver, seguido de `persistirResumo`. O contador de retomada ("Continuar (N
restantes)") é calculado sobre `dispositivos.filter(d => !d.resumo)` — só os resumos
dos dispositivos, não as razões. Então a interrupção substitui razões completas por
razões parciais, sem marca de incompletude e sem botão de continuar.

Correção mínima: ao abortar, não persistir razões parciais (ou marcá-las como
incompletas e oferecer a continuação, como já se faz com os dispositivos).

### 4. E-mail sai sem aviso quando a reconsulta falha — MÉDIO
`lideres.js:2932`

`prepararEmailFinal` envolve todas as reconsultas num try/catch que engole, e só
avisa quando `mudadas > 0`. Falhando tudo, o analista copia o texto sem saber que a
situação é a do dia do registro. Com o defeito 1 acima, é pior: a "reconsulta" que
falha reescreve as situações para "não há requerimento" e ainda anuncia que mudaram.

### 5. Metadados da pauta gravados sem await — MÉDIO
`congresso.js:1794`, `1808`, `1822`

O espelho de índice (`PAUTAS_META`) é best-effort por decisão declarada, e o dado
principal vai com await. O caso do DELETE, porém, tem efeito visível: falhando a
remoção do espelho, a pauta reaparece na sidebar sem conteúdo.

## Refutados

### detectarColunas cai na grade padrão sem avisar — `lideres.js:210`
É decisão documentada no próprio código ("Sem cinco colunas plausíveis o documento
não é a tabela esperada; a grade medida é melhor que uma detecção pela metade"), e
a grade real é detectada no documento justamente para cobrir a mudança entre
reuniões. Resíduo legítimo, não bug: valeria avisar na tela quando o padrão é usado.

### atualizarSituacaoDemanda com idCamara indefinido
O finder alegou erro engolido por catch e toast enganoso. O catch ali cobre só a
gravação no Firebase. O defeito real desse trecho é outro, e está no item 1.
