'use strict';
// Imagem do resultado de votação — equivalente server-side do generateImage
// da extensão. O desenho (SVG) está em imagem-svg.js, compartilhado com a
// extensão (Painel de Votação, "Prints da sessão"); aqui só vira PNG pelo sharp.
const sharp = require('sharp');
const { svgVotacao } = require('./imagem-svg');

/** Gera o PNG do placar (Buffer). Recebe o objeto de placarVotacao(). */
async function imagemVotacao(pl) {
  return sharp(Buffer.from(svgVotacao(pl).svg), { density: 144 }).png().toBuffer();
}

module.exports = { imagemVotacao };
