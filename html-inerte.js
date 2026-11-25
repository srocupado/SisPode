// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// HTML de terceiros lido pelo DOMParser, sem os atributos de evento (onclick="", onload="" …).
//
// As páginas da Câmara, do Senado e do Congresso trazem atributos de evento nas tags. O programa só LÊ essas
// páginas (new DOMParser().parseFromString(html, 'text/html')) — nada delas é executado —, mas o Chrome confere
// cada atributo contra a política de segurança da extensão e registra "Executing inline event handler violates
// the following Content Security Policy directive 'script-src 'self''" em chrome://extensions, uma linha por
// atributo. Em 28/10/2026 isso foi resolvido num caminho só (analise.js, semEventosInline, na página de pareceres);
// em 25/11/2026 o mesmo ruído apareceu no módulo do Congresso (congresso.js, parseDetalheHtml), que nunca tinha
// passado pelo filtro. Em vez de repetir a chamada em cada uma das dezenas de leituras, este arquivo — o primeiro
// script de cada página — faz o DOMParser receber o HTML já sem esses atributos.
//
// Script clássico (global na extensão) + module.exports para os testes.

'use strict';

/**
 * Tira os atributos de evento das tags. Só dentro das tags, atributo por atributo: um valor entre aspas é lido
 * inteiro, então "… onda=1" dentro de um title não vira atributo, e ">" dentro de um valor não corta a tag.
 * (A mesma regra de semEventosInline, em analise.js.)
 */
function htmlInerte(html) {
  return String(html).replace(/<[a-zA-Z](?:"[^"]*"|'[^']*'|[^'">])*>/g, tag =>
    tag.replace(/(\s+)([^\s=>"'\/]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?/g, (m, _esp, nome) => (/^on/i.test(nome) ? '' : m)));
}

// No navegador: toda leitura de HTML pelo DOMParser passa pelo filtro. XML (text/xml, application/xml) segue intacto.
if (typeof DOMParser !== 'undefined' && !DOMParser.prototype.__spInerte) {
  const original = DOMParser.prototype.parseFromString;
  DOMParser.prototype.parseFromString = function (texto, tipo) {
    return original.call(this, tipo === 'text/html' ? htmlInerte(texto) : texto, tipo);
  };
  DOMParser.prototype.__spInerte = true;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { htmlInerte };
