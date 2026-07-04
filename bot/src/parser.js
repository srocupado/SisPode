'use strict';
// Reusa o parser da EXTENSÃO (raiz do repositório) — fonte única de verdade:
// se a Câmara mudar o formato da pauta, corrige-se num lugar só.
//
// O parser espera `pdfjsLib` no escopo global (como no navegador). Aqui o
// pdfjs-dist (build legacy, CommonJS) assume esse papel. Em Node o pdf.js
// usa o "fake worker" — o aviso no console na primeira extração é esperado.
globalThis.pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const { parsearPauta, extrairTextoPdf } = require('../../pauta-parser.js');

module.exports = { parsearPauta, extrairTextoPdf };
