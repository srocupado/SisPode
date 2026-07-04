'use strict';
// Persistência LOCAL (bot/dados/, fora do git): perfis dos analistas — com as
// chaves de API de cada um — e a allowlist dinâmica. Chave de API é segredo:
// NUNCA vai ao Firebase (RTDB aberto) nem ao repositório.
const fs = require('fs');
const path = require('path');
const { DADOS_DIR, ADMIN_USER_ID, ALLOWED_USER_IDS } = require('./config');

function carregar(nome, padrao) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DADOS_DIR, nome), 'utf8'));
  } catch (_) {
    return padrao;
  }
}

function gravar(nome, obj) {
  fs.mkdirSync(DADOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DADOS_DIR, nome), JSON.stringify(obj, null, 2));
}

// ---------- Perfis: { userId: { nome, provedor, modelo, apiKey, configuradoEm } } ----------

function getPerfil(userId) {
  const todos = carregar('usuarios.json', {});
  return todos[String(userId)] || null;
}

function setPerfil(userId, perfil) {
  const todos = carregar('usuarios.json', {});
  todos[String(userId)] = { ...(todos[String(userId)] || {}), ...perfil };
  gravar('usuarios.json', todos);
  return todos[String(userId)];
}

function removerChave(userId) {
  const todos = carregar('usuarios.json', {});
  const p = todos[String(userId)];
  if (p) { delete p.apiKey; delete p.provedor; delete p.modelo; gravar('usuarios.json', todos); }
}

// ---------- Allowlist: semente do .env + aprovados dinamicamente ----------

function isAutorizado(userId) {
  const id = String(userId || '');
  if (!id) return false;
  if (id === ADMIN_USER_ID) return true;
  if (ALLOWED_USER_IDS.includes(id)) return true;
  const extra = carregar('allowlist.json', {});
  return !!extra[id];
}

function autorizar(userId, nome) {
  const extra = carregar('allowlist.json', {});
  extra[String(userId)] = { nome: nome || '', autorizadoEm: new Date().toISOString() };
  gravar('allowlist.json', extra);
}

module.exports = { getPerfil, setPerfil, removerChave, isAutorizado, autorizar };
