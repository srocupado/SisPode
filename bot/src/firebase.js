'use strict';
const { FIREBASE_URL } = require('./config');

// Helpers REST mínimos — mesmo padrão dos módulos da extensão.

async function fbGet(path) {
  const r = await fetch(`${FIREBASE_URL}${path}.json`);
  if (!r.ok) throw new Error(`Firebase GET ${r.status}`);
  return r.json();
}

// GET com query string extra (ex.: '?shallow=true', '?orderBy="uploadedAt"&limitToLast=1')
async function fbQuery(path, query) {
  const r = await fetch(`${FIREBASE_URL}${path}.json${query || ''}`);
  if (!r.ok) throw new Error(`Firebase GET ${r.status}`);
  return r.json();
}

async function fbPut(path, data) {
  const r = await fetch(`${FIREBASE_URL}${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase PUT ${r.status}`);
  return r.json();
}

async function fbPatch(path, data) {
  const r = await fetch(`${FIREBASE_URL}${path}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase PATCH ${r.status}`);
  return r.json();
}

module.exports = { fbGet, fbQuery, fbPut, fbPatch };
