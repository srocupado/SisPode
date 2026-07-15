# Integração com a Liderança Digital — mapeamento técnico

> Relatório de viabilidade: enviar os dados das pastas geradas pelos módulos de
> **Plenário** (Análise de Pauta / Destaques) e **CCJC** do SisPode para o editor
> em `liderancadigital.camara.leg.br`.
>
> **Conclusão:** é viável. O site expõe uma API REST própria e o "editor" grava
> por ela. O trabalho concentra-se em **autenticação (Keycloak)** e em mapear o
> **payload exato** da nota técnica.

---

## 1. O que é o `liderancadigital.camara.leg.br`

- SPA em **Vue.js**, construído pela **DITEC** da Câmara.
- Bundles: `/js/app.*.js` + `/js/chunk-vendors.*.js` (o editor é **Quill**, rich-text → HTML).
- Backend próprio: **`https://liderancadigital.camara.leg.br/api`** — API REST com ~277 rotas.
- O "editor" que a equipe usa é o editor de **Nota Técnica**, vinculado a uma
  **proposição** (fluxo de Plenário/Pauta) ou a uma **reunião** (fluxo de comissão, ex. CCJC).

### Estado atual do SisPode
- **Nenhuma** integração hoje (`grep -ri liderancadigital` no repo = 0 ocorrências).
- `analise.js` (Plenário) e `ccjc.js` exportam via `window.print()` → PDF e persistem no Firebase.
- As análises geradas por IA são exatamente o **conteúdo** que viraria a nota técnica lá.

---

## 2. Autenticação (o principal obstáculo)

| Item | Valor |
|---|---|
| Provedor | **Keycloak** (`https://auth.camara.leg.br/auth`) |
| Realm | **`redecamara`** |
| Client | **`lideranca-digital-frontend`** (client público do front) |
| Token endpoint | `https://auth.camara.leg.br/auth/realms/redecamara/protocol/openid-connect/token` |
| Auth endpoint | `https://auth.camara.leg.br/auth/realms/redecamara/protocol/openid-connect/auth` |
| Grants suportados | `authorization_code`, `implicit`, `refresh_token`, **`password`**, `client_credentials`, `device_code`, `ciba` |
| Envio nas chamadas | Header `Authorization: Bearer <access_token>` (axios default) |

**Verificado:** todos os endpoints de dados retornam **HTTP 401** sem token
(`salvarNotaTecnica`, `listarNotasTecnicasProposicao`, `pautaDaSemana` testados).

**Implicações para a extensão:**
- Não é uma API-key simples — é OAuth/OIDC com login institucional.
- O realm anuncia o grant **`password`** (ROPC). *Se* o client `lideranca-digital-frontend`
  permitir ROPC, dá para trocar usuário+senha por token direto do background da extensão.
  **Precisa ser confirmado** — clients de front costumam usar `authorization_code`+PKCE.
- Alternativa mais robusta: fluxo **authorization_code + PKCE** abrindo a tela de login
  da Câmara (`chrome.identity.launchWebAuthFlow`), guardando `access_token`+`refresh_token`
  e renovando via `refresh_token`.
- Alternativa pragmática: reaproveitar a sessão de uma aba já logada em
  `liderancadigital.camara.leg.br` (ler o token do storage/contexto da página via content script).

---

## 3. Endpoints do "editor" (o que recebe os dados)

Todos **POST** com corpo **JSON** (axios `post(url, payload)`), autenticados por Bearer.

### 3.1 Fluxo Plenário / Análise de Pauta → **nota por proposição**

| Método | Endpoint | Uso |
|---|---|---|
| POST | `/api/lideranca/notaTecnica/salvarNotaTecnica` | Cria/atualiza a nota técnica |
| GET  | `/api/lideranca/notaTecnica/listarNotasTecnicasProposicao` | Lista notas de uma proposição |
| GET  | `/api/lideranca/notaTecnica/listarNotasTecnicasProposicaoPauta` | Notas no contexto de pauta |
| POST | `/api/lideranca/notaTecnica/salvarImagem` | Sobe imagem embutida (Quill) |
| GET  | `/api/lideranca/notaTecnica/imagensNotaTecnica` | Recupera imagens |
| POST | `/api/lideranca/notaTecnica/setIndExibirNotaTecnicaNaPauta` | Marca a nota p/ aparecer na pauta |
| GET  | `/api/lideranca/notaTecnica/arquivoNotaTecnica` | Baixa o arquivo da nota |
| POST | `/api/lideranca/docToPDFNotaProposicao` | Gera PDF da nota |
| GET  | `/api/lideranca/proposicoes/listarProposicoesAutoComplete` | Resolve `codProposicao`/`ideProposicaoLideranca` |

Campos observados no payload (nomes-chave): `codProposicao`, `ideProposicaoLideranca`,
`ideNotaTecnica`, `titulo`, `indExibirNaPauta`, + **conteúdo HTML do Quill**
(nome do campo confirmar via captura — ver §5).

### 3.2 Fluxo CCJC / comissão → **nota por reunião**

| Método | Endpoint | Uso |
|---|---|---|
| POST | `/api/lideranca/pautas/salvarNotaTecnicaReuniao` | Cria/atualiza nota da reunião |
| GET  | `/api/lideranca/pautas/notasTecnicasReuniao` | Lista notas da reunião |
| GET  | `/api/lideranca/pautas/buscarNotaReuniao` | Busca uma nota |
| POST | `/api/lideranca/pautas/salvarImagem` | Imagem embutida |
| GET  | `/api/lideranca/pautas/imagensNotaTecnicaReuniao` | Imagens da nota da reunião |
| POST | `/api/lideranca/docToPDFNotaReuniao` | PDF da nota |
| GET  | `/api/lideranca/pautas/downloadNotasTecnicasItensPautaByCodReuniao` | Baixa notas dos itens |

Campos-chave: `codReuniao` / `CodReuniaoCD` / `CodReuniaoCN`, `ideNotaTecnicaReuniao`, `titulo`, conteúdo HTML.

### 3.3 Complementares (úteis para outros módulos)

| Método | Endpoint | Uso |
|---|---|---|
| POST | `/api/tarefas/salvarNotaTecnica` | Nota via fluxo de "tarefa de elaboração" |
| POST | `/api/lideranca/pautas/salvarAvaliacaoItemPauta` | Avaliação/orientação de item de pauta (casa com o módulo de **Destaques**) |
| GET  | `/api/lideranca/pautas/buscarAvaliacaoItemPauta` | Lê avaliação do item |
| GET  | `/api/lideranca/pautas/pautaDaSemana` | Pauta da semana (para casar itens SisPode ↔ Liderança) |
| GET  | `/api/lideranca/pautas` / `/v2` | Pautas/reuniões disponíveis |

### 3.4 Panorama da API (agrupamento por serviço)

`lideranca` (122) · `vagaMembroComissao` (26) · `tarefas` (21) · `exportacao` (19) ·
`integracao` (16) · `notificacao` (13) · `liderancas` (11) · `indicacao` (11) ·
`pleitoVagaComissao` (8) · `vagaInteressado` (7) · `idean` (7) · `relatorios` (5) ·
`configuracao*` (9) · `ld-websocket` (1) — total ~277 rotas.

---

## 4. Mapeamento SisPode → Liderança Digital

| Módulo SisPode | Dado gerado | Destino na Liderança Digital |
|---|---|---|
| **Análise de Pauta (Plenário)** — `analise.js` | Nota técnica por proposição (Markdown/HTML) | `salvarNotaTecnica` (por `codProposicao`), depois `setIndExibirNotaTecnicaNaPauta` |
| **CCJC** — `ccjc.js` | Resumo + análise por projeto da reunião | `salvarNotaTecnicaReuniao` (por `codReuniao`) **ou** `salvarNotaTecnica` por proposição |
| **Destaques** — `panel.js` | Orientação/explicação por destaque | `salvarAvaliacaoItemPauta` |

**Conversão de conteúdo:** o SisPode guarda análise em **Markdown**; o editor da
Liderança usa **HTML (Quill)**. Precisa de um passo Markdown→HTML no envio
(imagens embutidas vão por `salvarImagem`, não inline base64).

---

## 5. O que falta travar antes de codar (requer credenciais)

1. **Fluxo de auth**: confirmar se `lideranca-digital-frontend` aceita ROPC (`password`)
   ou se exige `authorization_code`+PKCE. Define como a extensão obtém o token.
2. **Payload exato do `salvarNotaTecnica`**: o nome do campo de conteúdo HTML e os
   IDs (`ideProposicaoLideranca`, `codReuniao`) estão num chunk lazy-loaded / vêm da
   própria API. **Melhor caminho:** logar na conta, abrir DevTools → Network, salvar
   **uma** nota de teste e capturar a requisição real — isso trava o schema de primeira.
3. **CORS / manifest**: adicionar ao `host_permissions` do `manifest.json`:
   - `https://liderancadigital.camara.leg.br/*`
   - `https://auth.camara.leg.br/*`
   E verificar se a API responde a chamadas cross-origin da extensão (Origin da extensão).
4. **Resolução de IDs**: casar a proposição do SisPode (sigla/número/ano) com o
   `codProposicao`/`ideProposicaoLideranca` da Liderança via
   `listarProposicoesAutoComplete` ou `pautaDaSemana`.

---

## 6. Esboço de plano de integração (quando for implementar)

1. **Auth module** (`background.js`): obter/renovar token Keycloak (`redecamara`),
   guardar em `chrome.storage`, injetar `Authorization: Bearer` nas chamadas.
2. **Client da API** (`lideranca-digital.js`): wrappers para `salvarNotaTecnica`,
   `salvarNotaTecnicaReuniao`, `salvarImagem`, `setIndExibirNotaTecnicaNaPauta`,
   `listarProposicoesAutoComplete`.
3. **Conversor** Markdown→HTML (Quill-friendly) reutilizável nos dois módulos.
4. **UI**: botão **"Enviar para Liderança Digital"** em cada card de `analise.js` e
   `ccjc.js` (individual) + ação em lote ("Enviar todas"), com status/erro por item.
5. **Reconciliação de IDs**: resolver proposição→`codProposicao` e reunião→`codReuniao`
   antes do POST; cachear o mapeamento.
6. `manifest.json`: novas `host_permissions`.

---

### Fontes verificadas
- `GET https://liderancadigital.camara.leg.br/` (shell Vue) → bundles `app.*.js`, `chunk-vendors.*.js`
- `GET /js/app.72222358.js` → lista de endpoints, `clientId`, `realm`, editor Quill
- `GET https://auth.camara.leg.br/auth/realms/redecamara/.well-known/openid-configuration` → grants/token endpoint
- Probes: `salvarNotaTecnica`, `listarNotasTecnicasProposicao`, `pautaDaSemana` → **401** (exigem Bearer)
