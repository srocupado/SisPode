# Push do Plenário em tempo real — spike de validação

Descobrimos que o app Infoleg (e o site `camara.leg.br/plenario`) avisam "no
mesmo instante" porque a Câmara **dispara notificações push** (via OneSignal) no
exato momento em que o operador do painel avança a fase da sessão — abertura,
início da Ordem do Dia, votações, **encerramento da Ordem do Dia**, encerramento
da sessão. As mensagens são explícitas ("Encerrada a Ordem do Dia", "Encerrada a
sessão").

Isso é **broadcast**, não um endpoint de consulta. É por isso que o Dados Abertos
(marcador da pauta) e as notas taquigráficas chegam atrasados: são derivados
desse mesmo evento. Assinando o push, o bot recebe o sinal **na hora, latência
zero**, inclusive no caso "todos os itens votados".

Este spike **não** mexe no bot nem no monitor. Ele só assina o canal e imprime
cada push recebido, para confirmarmos o formato antes de integrar.

## O que é preciso (uma vez)

1. **Um projeto Firebase gratuito** — usado apenas como veículo da registração
   FCM/Web-Push (não guarda nada da Câmara; é a forma como bibliotecas de Node
   recebem push do Google). Passos:
   - Acesse <https://console.firebase.google.com> → **Adicionar projeto** (nome
     livre, pode desativar Analytics).
   - Dentro do projeto: **⚙ Configurações do projeto** → aba **Geral** → em
     "Seus apps", clique no ícone **Web (</>)** e registre um app web (apelido
     livre).
   - O console mostra um bloco `firebaseConfig` com: `apiKey`, `appId`,
     `projectId`, `messagingSenderId`. São esses quatro valores.

2. **Saída TCP para `mtalk.google.com:5228`** (protocolo MCS do Google). A
   maioria dos servidores tem; alguns proxies corporativos bloqueiam. Se
   bloquear, o spike conecta e fica sem receber — nesse caso use a alternativa
   por navegador headless (me avise).

## Configurar

No `bot/.env`, acrescente:

```
FIREBASE_API_KEY=AIza...           # apiKey do firebaseConfig
FIREBASE_APP_ID=1:123...:web:abc   # appId
FIREBASE_PROJECT_ID=seu-projeto    # projectId
FIREBASE_SENDER_ID=123456789       # messagingSenderId
```

## Rodar

```
cd bot
npm install          # instala @eneris/push-receiver (já adicionado ao package.json)
node spike-push.js
```

- Na **primeira** execução, o OneSignal costuma mandar uma notificação de
  boas-vindas ("Inscrição feita com sucesso!"). Se ela aparecer no log, o
  recebimento **funciona de ponta a ponta** — mesmo fora de sessão.
- Deixe rodando durante uma **sessão do Plenário** e observe os eventos. Anote
  (ou me mande) as frases exatas dos pushes de:
  - início da sessão
  - início da Ordem do Dia
  - abertura/encerramento de cada votação
  - **encerramento da Ordem do Dia**
  - encerramento da sessão

Com esse texto real confirmado, aí sim integramos ao `monitor.js`: cada push
vira a mensagem correspondente no grupo, com latência zero, e o Dados Abertos /
notas passam a ser só reforço/fallback.

## Arquivos

- `src/pushplenario.js` — módulo do receptor (registração + assinatura + escuta).
- `spike-push.js` — runner de validação (só loga).
- `dados/push-plenario.json` — credenciais FCM persistidas (gitignored).
- `dados/push-plenario-player.json` — id da assinatura OneSignal (gitignored).

## Observações

- É um canal **público e opt-in** — assinar equivale a um usuário clicar
  "Aceitar" no site. As tags usadas são `pauta`, `votacao`, `extrapauta` (as
  mesmas do site).
- Se a Câmara trocar a chave VAPID do app, o módulo busca a atual em
  `onesignal.com/api/v1/sync/<appId>/web` a cada início (com fallback embutido).
