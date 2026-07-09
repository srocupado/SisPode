# Push do Plenário em tempo real — spike de validação (Chromium headless)

O app Infoleg (e o site `camara.leg.br/plenario`) avisam "no mesmo instante"
porque a Câmara **dispara notificações push** (via OneSignal) no exato momento
em que o operador do painel avança a fase da sessão — abertura, início da Ordem
do Dia, votações, **encerramento da Ordem do Dia**, encerramento da sessão. As
mensagens são explícitas ("Encerrada a Ordem do Dia", "Encerrada a sessão").

Isso é **broadcast**, não consulta. Por isso o Dados Abertos (marcador da pauta,
~10 min de atraso na fonte) e as notas taquigráficas (~30 min) chegam sempre
depois. Assinando o push, o bot recebe o sinal **na hora, latência zero**,
inclusive no caso "todos os itens votados".

## Por que Chromium (e não Node puro)

Tentamos primeiro receber o push direto no Node (biblioteca FCM). O Google
**bloqueia** esse registro Web Push do lado servidor: o endpoint
`fcmregistrations.googleapis.com` responde **401 (exige OAuth/navegador)** e o
registro GCM falha com `PHONE_REGISTRATION_ERROR`. Não dá para contornar sem
navegador.

A solução robusta usa um **Chromium real** (o mesmo puppeteer que o worker já
usa). Ele abre `camara.leg.br/plenario`, se inscreve no OneSignal EXATAMENTE como
o site (respeitando o `restrict_origin`) e recebe os pushes. Zero das travas
acima. Captura o push por dois caminhos redundantes: o evento oficial
`OneSignal.on('notificationDisplay')` na página **e** um listener injetado no
service worker.

## Requisitos

- **Só o Chromium do puppeteer** (já instalado com o bot). **Não** precisa mais
  de Firebase nem das variáveis `FIREBASE_*` — pode removê-las do `.env`.
- Mantém um Chromium headless vivo enquanto roda (um processo a mais).

## Rodar o spike

```
cd bot
npm install            # garante o puppeteer
node spike-push.js     # headless
```

Para diagnóstico com **janela visível** (ver a página, a inscrição, etc.):

```
set BOT_PUSH_VISIVEL=1
node spike-push.js
```

(No PowerShell: `$env:BOT_PUSH_VISIVEL=1; node spike-push.js`.)

O que observar no log:
- `[push] abrindo camara.leg.br/plenario…`
- `[push] inscrito no OneSignal (tags pauta/votacao/extrapauta) ✓`
- `[push] hook do service worker instalado ✓`
- `[push] ativo — ouvindo notificações do Plenário em tempo real`

Deixe rodando durante uma **sessão do Plenário** e me mande as frases exatas dos
pushes de:
- início da sessão
- início da Ordem do Dia
- abertura/encerramento de cada votação
- **encerramento da Ordem do Dia**
- encerramento da sessão

Com esse texto real confirmado, integramos ao `monitor.js`: cada push vira a
mensagem correspondente no grupo, com latência zero; o Dados Abertos/notas viram
só reforço/fallback.

## Arquivos

- `src/pushplenario.js` — módulo do receptor (Chromium + inscrição + captura).
- `spike-push.js` — runner de validação (só loga).
- `dados/push-chrome/` — perfil do Chromium (persiste a inscrição; gitignored).

## Observações

- É um canal **público e opt-in** — assinar equivale a um usuário clicar
  "Aceitar" no site. Tags: `pauta`, `votacao`, `extrapauta` (as mesmas do site).
- Se o `notificationDisplay` não disparar em background, o hook do service worker
  cobre; se um push chegar com o SW "frio", ele é reinjetado a cada 20 s e a
  página é mantida aquecida. Validado o encanamento SW→página→Node localmente; a
  inscrição real do OneSignal só dá para confirmar rodando aí.
- A dependência `@eneris/push-receiver` do teste anterior não é mais usada (pode
  ficar; não atrapalha).
