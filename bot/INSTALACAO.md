# Instalação do SisPode Bot (máquina Windows) — guia do administrador

Tempo estimado: 30–45 minutos. Nenhum passo exige abrir porta ou configurar
roteador — o bot conecta para fora (long polling), como um navegador.

## 1. Criar o bot no Telegram

1. No Telegram, abra o **@BotFather** e envie `/newbot`.
2. Dê um nome (ex.: "SisPode – Liderança") e um username terminando em `bot`
   (ex.: `sispode_lideranca_bot`).
3. O BotFather responde com o **token** (formato `123456789:AA...`).
   **Guarde-o como uma senha** — quem tem o token controla o bot.
4. Ainda no BotFather: `/setjoingroups` → escolha o bot → `Enable`
   (permite adicioná-lo ao grupo da equipe).

## 2. Descobrir os IDs

- **Seu user_id** (administrador): envie qualquer mensagem ao **@userinfobot**
  — ele responde com seu ID. (Depois que o bot estiver no ar, cada analista
  descobre o próprio ID enviando `/start` ao bot.)
- **ID do grupo**: crie o grupo da equipe, adicione o bot, envie uma mensagem
  qualquer no grupo e abra no navegador (troque `<TOKEN>`):
  `https://api.telegram.org/bot<TOKEN>/getUpdates`
  Procure `"chat":{"id":-100...}` — esse número **negativo** é o `GRUPO_CHAT_ID`.

## 3. Instalar o Node.js

1. Baixe o instalador **LTS** em https://nodejs.org (Windows Installer `.msi`).
2. Instale com as opções padrão (next → next → finish).
3. Confirme num Prompt de Comando: `node --version` (deve mostrar v20 ou maior).

## 4. Obter o código e configurar

1. Clone/baixe o repositório do SisPode na máquina (ex.: `C:\sispode`).
2. No Prompt de Comando:
   ```
   cd C:\sispode\bot
   copy .env.example .env
   notepad .env
   ```
3. Preencha no `.env`:
   - `BOT_TOKEN` — o token do passo 1
   - `ADMIN_USER_ID` — o seu user_id
   - `SENHA_ACESSO` — palavra-chave que os analistas enviam para entrar
   - `GRUPO_CHAT_ID` — (opcional) o aviso de pauta nova vai ao privado de
     todos os autorizados; preencha só se quiser avisar TAMBÉM num grupo
   - `TRANSCRIBE_GEMINI_KEY` — (recomendado) chave Gemini do transcritor
     de voz padrão
4. Instale as dependências: `npm install`

## 5. Testar

```
node index.js
```

Deve aparecer `SisPode Bot online como @seu_bot`. No Telegram, teste:
`/start`, depois `/pauta`. Pare com `Ctrl+C`.

> **Se o bot não conectar:** redes corporativas às vezes bloqueiam
> `api.telegram.org`. Teste no navegador da máquina:
> `https://api.telegram.org` — se não abrir, será preciso liberar o acesso
> ou usar outra rede/máquina.

> **Erro 409 Conflict:** o mesmo token está rodando em outro lugar (outra
> máquina/janela). O Telegram só aceita **uma** instância por token.

## 6. Rodar como serviço (inicia sozinho, reinicia se cair)

1. Baixe o **NSSM** em https://nssm.cc/download e extraia (ex.: `C:\nssm`).
2. Num Prompt de Comando **como administrador**:
   ```
   C:\nssm\win64\nssm.exe install SisPodeBot
   ```
3. Na janela do NSSM:
   - **Path:** `C:\Program Files\nodejs\node.exe`
   - **Startup directory:** `C:\sispode\bot`
   - **Arguments:** `index.js`
   - Aba **I/O** (recomendado): aponte stdout/stderr para
     `C:\sispode\bot\bot.log`
   - Aba **Exit actions:** Restart application (padrão)
4. `Install service`, depois: `net start SisPodeBot`

## 7. Manter a máquina acordada

Painel de Controle → Opções de Energia → **Nunca suspender**
(o monitor pode desligar; a máquina não).

## 7b. O worker do /analisar e /exportar

O `npm install` baixa um **Chromium** (~170 MB) usado pelo bot como "worker":
ele abre a própria extensão SisPode invisível e executa o painel de Análise
por dentro (gerar análises, montar o PDF institucional). Nada precisa ficar
aberto na tela. Se a rede bloquear o download do Chromium no `npm install`,
aponte `PUPPETEER_EXECUTABLE_PATH` no `.env` para um Chrome já instalado.
Para diagnosticar o worker com janela visível: `BOT_WORKER_VISIVEL=1`.

## 8. Atualizar o bot

```
net stop SisPodeBot
cd C:\sispode && git pull
cd bot && npm install
net start SisPodeBot
```

## 9. Operação do dia a dia

- **Entrada de analistas:** com `SENHA_ACESSO` preenchida no `.env`, cada
  analista entra sozinho — envia `/start` ao bot, o bot pede a palavra-chave,
  a pessoa responde e pronto (a mensagem com a senha é apagada; 5 erros
  bloqueiam por 1 hora). Você recebe um aviso a cada entrada, com o comando
  de revogação pronto. Sem `SENHA_ACESSO`, vale o fluxo antigo: você aprova
  cada pedido pelo botão **✅ Autorizar**.
- **Gerenciar acessos:** `/usuarios` lista os autorizados;
  `/revogar <id>` remove (só o administrador pode usar esses comandos).
  Trocar a `SENHA_ACESSO` no `.env` (e reiniciar) NÃO desloga quem já entrou
  — para tirar alguém, use `/revogar`.
- **Chaves de IA:** cada analista configura a própria chave via `/config`
  no privado do bot. As chaves ficam APENAS no arquivo
  `C:\sispode\bot\dados\usuarios.json` desta máquina — proteja o acesso a ela.
- **Logs:** `C:\sispode\bot\bot.log` (se configurado no passo 6).
- **Backup:** o diretório `bot\dados\` guarda perfis e allowlist — inclua-o
  no backup da máquina (ele não vai ao git, de propósito).
