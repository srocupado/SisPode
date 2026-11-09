#!/usr/bin/env node
'use strict';
// Perfil dos CANDIDATOS a deputado (federal, estadual, distrital) para o
// distrital misto do simulador: o vencedor simulado de um distrito pode ser
// qualquer candidato, não só quem se elegeu de fato. Do cadastro de
// candidaturas do TSE (consulta_cand_<ano>_BRASIL) guarda só gênero, cor/raça,
// idade na data da eleição e escolaridade — nada de CPF, e-mail ou título.
//
// Uso: node sistemas/perfil/gerar-candidatos.js --cache <pasta> [--saida sistemas/perfil]
// Saída: candidatos-<ano>.json → { campos, cand: { SQ_CANDIDATO: [gênero, cor/raça, idade, escolaridade] } }.

const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process'), readline = require('readline');

const ANO = 2026;
const arg = (n, padrao) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : padrao; };
// Escolaridade: mesma escala do perfil do eleitorado (gerar-perfil.js), 0 = analfabeto … 7 = superior completo.
const ESC = [[/ANALFABETO/, 0], [/L[ÊE] E ESCREVE/, 1], [/FUNDAMENTAL INCOMPLETO/, 2], [/FUNDAMENTAL COMPLETO/, 3],
  [/M[ÉE]DIO INCOMPLETO/, 4], [/M[ÉE]DIO COMPLETO/, 5], [/SUPERIOR INCOMPLETO/, 6], [/SUPERIOR COMPLETO/, 7]];
const RACA = { BRANCA: 'branca', PRETA: 'preta', PARDA: 'parda', AMARELA: 'amarela', 'INDÍGENA': 'indigena', INDIGENA: 'indigena' };

function idade(nasc, eleicao) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(nasc || ''), e = /(\d{2})\/(\d{2})\/(\d{4})/.exec(eleicao || '');
  if (!m || !e) return null;
  let a = +e[3] - +m[3];
  if (+e[2] < +m[2] || (+e[2] === +m[2] && +e[1] < +m[1])) a--;
  return a > 0 && a < 120 ? a : null;
}

(async () => {
  const cache = arg('cache');
  if (!cache) { console.error('uso: node gerar-candidatos.js --cache <pasta> [--saida pasta]'); process.exit(1); }
  const saida = arg('saida', __dirname);
  const zip = path.join(cache, `consulta_cand_${ANO}.zip`);
  if (!fs.existsSync(zip)) execFileSync('curl', ['-s', '-f', '--retry', '3', '-o', zip, `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ANO}.zip`]);
  const p = spawn('unzip', ['-p', zip, `consulta_cand_${ANO}_BRASIL.csv`]);
  const r = readline.createInterface({ input: p.stdout.setEncoding('latin1'), crlfDelay: Infinity });
  let h = null;
  const cand = {}, conta = { total: 0, semGenero: 0, semRaca: 0, semIdade: 0, semEsc: 0 };
  for await (const l of r) {
    const v = l.split(';').map(t => t.replace(/^"|"$/g, ''));
    if (!h) { h = Object.fromEntries(v.map((c, i) => [c, i])); continue; }
    if (!['6', '7', '8'].includes(v[h.CD_CARGO]) || v[h.NR_TURNO] !== '1') continue;
    const sq = v[h.SQ_CANDIDATO];
    if (cand[sq]) continue;
    const g = /FEMININO/i.test(v[h.DS_GENERO]) ? 'F' : /MASCULINO/i.test(v[h.DS_GENERO]) ? 'M' : '';
    const ra = RACA[String(v[h.DS_COR_RACA] || '').toUpperCase()] || '';
    const id = idade(v[h.DT_NASCIMENTO], v[h.DT_ELEICAO]);
    const ds = String(v[h.DS_GRAU_INSTRUCAO] || '').toUpperCase(), e = ESC.find(([re]) => re.test(ds));
    cand[sq] = [g, ra, id, e ? e[1] : null];
    conta.total++; if (!g) conta.semGenero++; if (!ra) conta.semRaca++; if (id == null) conta.semIdade++; if (!e) conta.semEsc++;
  }
  const doc = { versao: 1, ano: ANO, gerado: new Date().toISOString(), fonte: `consulta_cand_${ANO}_BRASIL (dados abertos do TSE), deputado federal, estadual e distrital`,
    campos: ['genero', 'raca', 'idade', 'escolaridade'], escolaridade: ['analfabeto', 'lê e escreve', 'fundamental incompleto', 'fundamental completo', 'médio incompleto', 'médio completo', 'superior incompleto', 'superior completo'],
    contagem: conta, cand };
  fs.writeFileSync(path.join(saida, `candidatos-${ANO}.json`), JSON.stringify(doc));
  console.log(JSON.stringify(conta));
})().catch(e => { console.error(e); process.exit(1); });
