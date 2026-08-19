'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function obrigatoria(nome) {
  const v = (process.env[nome] || '').trim();
  if (!v) {
    console.error(`Variável ${nome} ausente no bot/.env — copie o .env.example e preencha.`);
    process.exit(1);
  }
  return v;
}

module.exports = {
  BOT_TOKEN: obrigatoria('BOT_TOKEN'),

  FIREBASE_URL: (process.env.FIREBASE_URL ||
    'https://plenario-podemos-default-rtdb.firebaseio.com').replace(/\/+$/, ''),

  GRUPO_CHAT_ID: (process.env.GRUPO_CHAT_ID || '').trim(),

  ADMIN_USER_ID: (process.env.ADMIN_USER_ID || '').trim(),

  ALLOWED_USER_IDS: (process.env.ALLOWED_USER_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Palavra-chave de acesso: quem acertá-la no privado entra sozinho na
  // allowlist (sem precisar cadastrar o ID no .env). Vazio = desligado
  // (fica só a aprovação manual pelo administrador).
  SENHA_ACESSO: (process.env.SENHA_ACESSO || '').trim(),

  CRON_MINUTOS: Math.max(5, parseInt(process.env.CRON_MINUTOS, 10) || 30),

  TRANSCRIBE_GEMINI_KEY: (process.env.TRANSCRIBE_GEMINI_KEY || '').trim(),

  // Monitor de sessão ao vivo: MONITOR_ATIVO=0 desliga de vez;
  // MONITOR_ENSAIO=1 (padrão) manda as mensagens SÓ para o admin — troque
  // para 0 depois de calibrar numa sessão real para publicar no grupo.
  MONITOR_ATIVO:  (process.env.MONITOR_ATIVO || '1').trim() !== '0',
  MONITOR_ENSAIO: (process.env.MONITOR_ENSAIO || '1').trim() !== '0',

  // PDF oficial da Pauta da Semana (a Câmara sobrescreve o mesmo arquivo)
  PAUTA_URL: 'https://www.camara.leg.br/internet/plenario/pautadasemana/pauta_s.pdf',

  // Diretório de dados locais (perfis/allowlist) — NUNCA vai ao git
  DADOS_DIR: path.join(__dirname, '..', 'dados'),
};
