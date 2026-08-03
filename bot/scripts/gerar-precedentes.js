'use strict';
// Empacota dados/qordem-extraido.json em src/qoprecedentes.js.
//
// Precisa ser .js dentro de src/ porque é assim que o /update leva o arquivo
// para a máquina de quem roda o bot (o autoupdate baixa index.js, package.json
// e src/*.js). Mesmo caminho do src/ricd.js.
//
// O verbete é gerado UMA vez, aqui, e distribuído pronto: ninguém paga IA por
// consulta, todo mundo vê exatamente o mesmo precedente, e o resultado é
// auditável — cada verbete carrega o número da QO para conferência no acervo.
//
// Uso: node scripts/gerar-precedentes.js

const fs = require('fs');
const path = require('path');

const ORIGEM = path.join(__dirname, '..', 'dados', 'qordem-extraido.json');
const DESTINO = path.join(__dirname, '..', 'src', 'qoprecedentes.js');
const MIN_ACEITAVEL = 3000;   // guarda: não sobrescreve o módulo com meia extração

const j = JSON.parse(fs.readFileSync(ORIGEM, 'utf8'));
const itens = j.itens || {};
const n = Object.keys(itens).length;

if (n < MIN_ACEITAVEL) {
  console.error(`Só ${n} verbetes em ${path.basename(ORIGEM)} — abaixo do mínimo de ${MIN_ACEITAVEL}.`);
  console.error('Rode a extração até o fim antes de empacotar (ela retoma de onde parou).');
  process.exit(1);
}

// Enxuga: fora do bot, campos vazios e "não consta" só ocupam espaço. O
// consumidor trata ausência como "não consta" — que é a mesma informação.
const naoConsta = v => /^n[aã]o consta$/i.test(String(v || '').trim());
const enxuto = {};
let semRazao = 0, semDecisao = 0;
for (const [id, v] of Object.entries(itens)) {
  const o = { n: v.num, t: v.tese, c: v.contexto, r: v.resultado };
  if ((v.fundamento || []).length && !naoConsta(v.fundamento[0])) o.f = v.fundamento;
  if (v.decisao && !naoConsta(v.decisao)) o.d = v.decisao; else semDecisao++;
  if (v.razao && !naoConsta(v.razao)) { o.z = v.razao; o.l = v.lastro; } else semRazao++;
  if (v.desdobramento && !naoConsta(v.desdobramento)) o.x = v.desdobramento;
  if ((v.temas || []).length) o.m = v.temas;
  enxuto[id] = o;
}

const cab = `'use strict';
// VERBETES DE PRECEDENTE das questões de ordem — GERADO, não editar à mão.
// Refazer com: node scripts/extrair-qo.js && node scripts/gerar-precedentes.js
//
// Campos: n número · t tese · f fundamento · c contexto · r resultado
//         d decisão · z razão · l lastro da razão · x desdobramento · m temas
// Campo ausente = "não consta" no registro original. Razão sem lastro alto
// deve ser mostrada com ressalva: ela é paráfrase, e o original manda.
//
// Modelo: ${j.modelo || '?'} · gerado em ${j.gerado || '?'} · ${n} verbetes
`;

fs.writeFileSync(DESTINO, cab + 'module.exports = ' +
  JSON.stringify({ gerado: j.gerado, modelo: j.modelo, itens: enxuto }) + ';\n');

const kb = fs.statSync(DESTINO).size / 1024;
console.log(`${n} verbetes → ${DESTINO}`);
console.log(`  ${kb.toFixed(0)} KB · sem razão registrada ${semRazao} (${(100 * semRazao / n).toFixed(0)}%)` +
  ` · sem decisão registrada ${semDecisao} (${(100 * semDecisao / n).toFixed(0)}%)`);
