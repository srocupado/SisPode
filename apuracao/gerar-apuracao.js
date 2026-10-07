// Gera apuracao/index.html — o painel de apuração num ARQUIVO ÚNICO:
// modelo (apuracao.base.html) + logo em base64 + mapa + leitura do TSE
// (labs-apuracao.js, o mesmo código da extensão) + tela do site (apuracao-site.js).
// Gera também apuracao/extensao.html — a MESMA tela para a aba Apuração do Labs:
// a extensão (MV3) não aceita script inline, então ali os scripts vão por arquivo.
// Uso: node apuracao/gerar-apuracao.js   (depois, publicar o index.html desta pasta)
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, 'icons', 'podemos-logo.png')).toString('base64');
// "</script" dentro de um script inline fecharia a tag antes da hora.
const inline = f => `<script>/* ${f} */\n${ler(f).replace(/<\/script/gi, '<\\/script')}\n</script>`;
const ARQUIVOS = ['labs-apuracao-mapa.js', 'labs-apuracao.js', 'zip-remoto.js', 'labs-mapa-nucleo.js', 'apuracao/apuracao-onde.js', 'apuracao/apuracao-site.js'];   // onde antes do site: o botão 📍 já sai na 1ª pintura
const modelo = ler('apuracao/apuracao.base.html');
function gravar(nome, logoSrc, scripts, css = '') {
  const html = modelo.split('{{LOGO}}').join(logoSrc).replace('{{SCRIPTS}}', () => scripts).replace('</style>', () => css + '</style>');
  const destino = path.join(__dirname, nome);
  fs.writeFileSync(destino, html);
  console.log(`gerado ${path.relative(RAIZ, destino)} (${Math.round(html.length / 1024)} KB)`);
}
gravar('index.html', logo, ARQUIVOS.map(inline).join('\n'));
gravar('extensao.html', '../icons/podemos-logo.png',
  '<!-- GERADO por apuracao/gerar-apuracao.js a partir de apuracao.base.html; não editar à mão -->\n'
  + ARQUIVOS.map(f => `<script src="${path.relative('apuracao', f)}"></script>`).join('\n'),
  // Na aba do Labs o painel ocupa a largura toda da janela.
  '  .topo, main, footer { max-width: none; }\n');
