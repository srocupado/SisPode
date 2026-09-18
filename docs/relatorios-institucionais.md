# Relatórios possíveis com os dados abertos da Câmara

Levantamento do que a API de Dados Abertos entrega **de fato** — cada rota abaixo
foi chamada em 18/09/2026, e o que não respondeu está marcado como não respondeu —
e proposta de relatórios que sustentem o trabalho institucional do parlamentar:
subsidiar a atuação, responder a questionamento de imprensa e a pedido de órgão de
controle com documento verificável.

O critério que organiza tudo: **um relatório de defesa só vale se cada número
puder ser reconstruído por quem duvida dele.** Por isso toda proposta abaixo diz
de onde o dado sai, e toda ressalva de método fica no material de trabalho.

---

## Parte 1 — O que a API entrega

### 1.1 Produção legislativa (autoria)

| Rota | Entrega |
|---|---|
| `/proposicoes?idDeputadoAutor={id}` | tudo que o deputado assinou, de PL a destaque |
| `/proposicoes/{id}/autores` | `ordemAssinatura` e `proponente` — separa **autor** de **coassinatura** |
| `/proposicoes/{id}/temas` | tema com `relevancia`, da taxonomia da própria Câmara |
| `/proposicoes/{id}` → `statusProposicao` | órgão atual, situação, despacho, regime, **`uriUltimoRelator`** |
| `/proposicoes/{id}/relacionadas` | apensados e correlatas |
| `/proposicoes/{id}/tramitacoes` | a narrativa completa, em ordem |
| `/referencias/proposicoes/codTema`, `/referencias/situacoesProposicao` | as tabelas de domínio, para não inventar rótulo |

Medido num deputado da bancada (100 proposições, teto de uma página):
`DOC 31 · REQ 29 · PL 14 · RPD 8 · RDF 3 · PEC 2 · DTQ 2 · EMP 2 · …`

Esse recorte por tipo é o achado mais útil da sondagem: **"produção legislativa"
não é uma coisa só.** PL, PLP e PEC são proposição de mérito; REQ, RIC, RDF, INA
são instrumentos de atuação e fiscalização; DTQ e EMP são atuação em Plenário.
Somar tudo num número só ("apresentou 100 proposições") é o tipo de estatística
que não sobrevive à primeira pergunta de um jornalista.

### 1.2 Atuação em colegiado

| Rota | Entrega |
|---|---|
| `/deputados/{id}/orgaos` | cada vínculo com **título** (Titular, Suplente, Presidente) e datas |
| `/orgaos/{id}/membros` | a composição, com cargo |
| `/orgaos/{id}/eventos?dataInicio&dataFim` | as reuniões do colegiado |
| `/eventos/{id}/pauta` | **ordem, tópico, regime, relator, `textoParecer`, `situacaoItem`, `uriVotacao`** |
| `/eventos/{id}/deputados` | quem esteve na reunião |
| `/orgaos/{id}/votacoes` | as votações do colegiado |

O item de pauta é o registro mais denso da base. Exemplo real colhido na CCJC:
relator `Ana Paula Lima (PT-SC)`, regime `Urgência (Art. 155, RICD)`, parecer
`"pela constitucionalidade, juridicidade e técnica legislativa deste, …"`.

### 1.3 Plenário e coalizão

| Rota | Entrega |
|---|---|
| `/votacoes?dataInicio&dataFim` / `/proposicoes/{id}/votacoes` | as votações |
| `/votacoes/{id}/votos` | voto nominal de cada deputado |
| `/votacoes/{id}/orientacoes` | **a orientação de TODAS as lideranças**, não só a do Governo |
| `/votacoes/{id}` | `objetosPossiveis`, `ultimaApresentacaoProposicao`, `efeitosRegistrados` |

Numa única votação do PL 3.626/2023, dez lideranças orientaram:
`Governo=Sim · Oposição=Não · Minoria=Não · Maioria=Liberado · PL=Não · NOVO=Sim ·
Bl MdbPsdRepPode=Liberado · Bl UniPpFdrPsdbCid=Não · Fdr PT-PCdoB-PV=Sim · Fdr PSOL-REDE=Sim`

**Isto é o achado mais importante do levantamento para o seu objetivo.** O módulo
de Aderência compara o voto do deputado com a orientação do **Governo** — que é
uma leitura política legítima, mas é a leitura de quem quer medir governismo.
Quando a pergunta vem de fora ("por que o deputado votou assim?"), a referência
institucionalmente pertinente é **a orientação do próprio partido e do próprio
bloco**. Esse dado está na mesma rota, já é baixado, e hoje é descartado.

### 1.4 Estruturas e contexto

| Rota | Entrega |
|---|---|
| `/deputados/{id}/frentes` | frentes parlamentares do deputado |
| `/frentes/{id}/membros` | composição **com cargo** — separa Coordenador de Membro |
| `/legislaturas/{id}/lideres`, `/mesa` | quem lidera o quê, com `dataInicio`/`dataFim` |
| `/partidos/{id}` | `totalMembros`, `totalPosse`, líder atual |
| `/blocos` | composição dos blocos, com federação |
| `/deputados/{id}/historico` | mudanças de partido, situação e nome eleitoral, datadas |
| `/deputados/{id}/discursos?idLegislatura=` | `sumario`, `transcricao`, `keywords`, vídeo e áudio |

Ressalva medida: o mesmo deputado aparece em **160 frentes parlamentares**.
Pertencer a uma frente, isoladamente, não diz quase nada — assinar frente é
barato. O que diz algo é **coordenar** uma (o campo `titulo` separa os dois casos).

### 1.5 Armadilhas confirmadas na sondagem

Registradas porque cada uma produziria um relatório **errado com cara de certo** —
lista vazia que passa por ausência de fato:

1. `/deputados/{id}/despesas?ano=2025` → **lista vazia**. Com `&idLegislatura=57`
   → 15 registros. O parâmetro é obrigatório na prática e sua falta não dá erro.
2. `/deputados/{id}/discursos` sem `idLegislatura` **nem** janela de datas → vazio.
   Com qualquer um dos dois → dados.
3. `/deputados/{id}/eventos` sem janela de datas → vazio. Com janela → dados.
4. `/votacoes?idProposicao={id}` → **vazio**. O caminho que funciona é
   `/proposicoes/{id}/votacoes`.
5. `/proposicoes/{id}/votacoes?itens=N` → **vazio** (já documentado no módulo).
6. `/votacoes/{id}/votos?itens=N` → **HTTP 400** (já documentado no módulo).
7. `/votacoes?dataInicio&dataFim` perde as votações do **último dia** (já corrigido
   na aba de consulta, ainda não na aba de Aderência).
8. `/proposicoes?siglaOrgao=CCJC` → **HTTP 400**; não há filtro por órgão de
   tramitação nessa rota.
9. **Não existe rota por relator.** `?idDeputadoRelator=` devolve 400. A relatoria
   só aparece em `statusProposicao.uriUltimoRelator` (uma proposição por vez) e em
   `/eventos/{id}/pauta.relator`. Qualquer relatório de relatoria é varredura.
   **Correção, apurada depois:** há um caminho melhor — o **parecer é proposição**.
   PRL, PRLP, PPP e RDF aparecem em `?idDeputadoAutor=` com a ementa "Parecer do
   Relator, Dep. Fulano, pela aprovação", então a relatoria é contável numa só
   consulta. O que ela não dá é o vínculo com a matéria relatada:
   `uriPropPrincipal` vem vazio e `/relacionadas` não devolve nada.
10. **`codTema` não compõe com `dataApresentacaoInicio/Fim`** — a combinação devolve
    HTTP 400. Compõe com `ano`.
11. Paginação: 100 itens por página é o teto; `links.next` precisa ser seguido.
    Um corte mudo aqui vira "o deputado apresentou 100 proposições".

E um atalho, não uma armadilha: **marcar autoria de partido num conjunto grande
não precisa de uma chamada por proposição.** A mesma busca repetida com
`siglaPartidoAutor` devolve o subconjunto, e cruzar os ids resolve. Numa busca de
717 proposições, são 2 chamadas em vez de 717.

---

## Parte 2 — Relatórios propostos

Quatro são de **defesa** (respondem a quem pergunta de fora) e três são de
**subsídio** (municiam a atuação). Em ordem de proveito sobre custo.

### A. Ficha de conduta em votação — *defesa*

**A pergunta que responde:** "Por que o deputado votou assim neste projeto?"

Uma página por votação, com: o objeto real (lido da tramitação), o voto, **a
orientação do partido, do bloco e do Governo lado a lado**, o resultado, e o link
para a ficha e para a sessão.

O que a torna defensável é a coluna do meio. Hoje o relatório diz "divergiu" com
referência ao Governo. Um deputado de oposição "diverge" em 90% das votações — e
esse número, isolado, é uma manchete. A mesma votação lida contra a orientação do
**próprio bloco** normalmente mostra o oposto: alinhamento.

- **Dados:** `/votacoes/{id}/votos` + `/votacoes/{id}/orientacoes` + tramitação.
- **Custo:** baixo. As orientações de todas as lideranças **já são baixadas** hoje
  e descartadas — só a linha do Governo é lida.
- **Ressalva obrigatória no documento:** votação simbólica não tem voto individual,
  e liderança "Liberado" não é divergência. Sem isso o relatório inventa conduta.

### B. Retrato da produção legislativa — *defesa e subsídio* — **FEITO**

> Implementado como a aba **Produção legislativa** do módulo Relatórios.


**A pergunta:** "O que o deputado produziu no mandato?"

Não um número: uma tabela por **natureza do instrumento** — mérito (PL, PLP, PEC),
fiscalização (RIC, RCP, RDF), atuação em Plenário (DTQ, EMP, SBT), requerimentos
de andamento (REQ) — cada bloco com quantidade, temas predominantes e **destino**
(aprovada, arquivada, aguardando relator, transformada em norma).

O destino é o que separa este relatório de um release. Dizer "apresentou 14 PLs, 3
transformados em lei, 4 aguardando relator na CCJC há 400 dias" é verificável e
resiste a contestação; "apresentou 100 proposições" não.

- **Dados:** `/proposicoes?idDeputadoAutor=` (paginado) + `/proposicoes/{id}` +
  `/temas` + `/autores` para separar autoria de coassinatura.
- **Custo:** médio — uma chamada por proposição para o status.

### C. Dossiê de uma matéria — *defesa*

**A pergunta:** "Qual foi a participação do deputado neste projeto?"

A linha do tempo de uma proposição com o que o deputado fez nela: autoria ou
coassinatura, emendas, destaques, relatoria, discursos, e cada voto. Com os
apensados e o inteiro teor.

É o documento que se manda quando a pergunta é sobre **uma** matéria — o formato
mais frequente em questionamento de imprensa.

- **Dados:** `/proposicoes/{id}/tramitacoes` + `/relacionadas` + `/autores` +
  votações da matéria + `/discursos` filtrados por `keywords`.
- **Custo:** médio. Boa parte já existe nos módulos de Destaques e de Consulta.

### D. Presença e trabalho em colegiado — *defesa*

**A pergunta:** "O deputado trabalha?" — a mais comum, e a que hoje não temos como
responder com documento.

Por comissão em que tem assento: reuniões realizadas, presença dele, itens
relatados, pareceres apresentados e votações de que participou.

- **Dados:** `/deputados/{id}/orgaos` → `/orgaos/{id}/eventos` (com janela!) →
  `/eventos/{id}/deputados` e `/eventos/{id}/pauta`.
- **Custo:** médio-alto (uma chamada por reunião), mas é varredura de fim de semana,
  não de tela.
- **Ressalva séria:** `/eventos/{id}/deputados` numa Sessão Deliberativa do Plenário
  devolveu **465 nomes** — isso é registro de presença à sessão, não à votação, e os
  dois números não são intercambiáveis. Em reunião de comissão (106 numa reunião de
  instalação) a leitura é mais direta. **A diferença precisa ser dita no documento**,
  ou ele vira exatamente o tipo de número que se volta contra quem o publicou.

### E. Radar temático da bancada — *subsídio* — **FEITO**

> Implementado como a aba **Radar temático** do módulo Relatórios.


**A pergunta:** "O que está andando na Casa sobre o tema X?"

Varredura por `codTema` e por `keywords` das proposições que tramitam, cruzada com
as pautas da semana, marcando o que é de autoria ou relatoria da bancada.

- **Dados:** `/proposicoes?codTema=` e `?keywords=` + `/referencias/proposicoes/codTema`.
- **Custo:** baixo. Reaproveita a Análise de Pauta.

### F. Mapa de coautoria — *subsídio*

**A pergunta:** "Com quem o deputado constrói maioria?"

Quem assina com quem, a partir de `ordemAssinatura` e `proponente`. Serve para
articulação: mostra parcerias já existentes e aponta quem falta.

- **Dados:** `/proposicoes/{id}/autores` sobre a produção da bancada.
- **Custo:** médio, e é uma varredura só — o resultado envelhece devagar.

### G. Boletim de relatorias da bancada — *subsídio*

Toda matéria em que um deputado da bancada é relator, com prazo, situação e parecer.

- **Dados:** varredura de `/orgaos/{id}/eventos` → `/eventos/{id}/pauta.relator`,
  mais `statusProposicao.uriUltimoRelator` nas matérias acompanhadas.
- **Custo:** alto, **porque não existe rota por relator** (armadilha 9). É o item de
  maior valor por unidade de esforço de engenharia, e o de maior esforço.

---

## Parte 3 — Recomendação

**B e E estão feitos** (abas "Produção legislativa" e "Radar temático").
Dos que faltam, se for para fazer um só: **A (ficha de conduta em votação)**. O dado já está em
mãos e descartado, o módulo de consulta já monta o documento, e é o relatório que
responde à pergunta que mais chega de fora — hoje respondida com um número
(aderência ao Governo) que, sozinho, trabalha contra o parlamentar.

Depois: **D (colegiado)**, que cobre a única pergunta frequente para a qual não
temos documento nenhum; e **B (produção)**, que transforma um release em prova.

E uma regra que vale para os sete: **nenhum deles pode omitir o que não conseguiu
apurar.** Um relatório de defesa que arredonda uma lacuna para baixo é uma
vulnerabilidade, não uma proteção — a primeira conferência de fora encontra a
diferença, e aí o problema deixa de ser o dado e passa a ser o documento.
