// Gera apuracao/index.html — o painel de apuração num ARQUIVO ÚNICO:
// modelo (apuracao.base.html) + logo em base64 + mapa + leitura do TSE
// (labs-apuracao.js, o mesmo código da extensão) + tela do site (apuracao-site.js).
// Uso: node apuracao/gerar-apuracao.js   (depois, publicar o index.html desta pasta)
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, 'icons', 'podemos-logo.png')).toString('base64');
// "</script" dentro de um script inline fecharia a tag antes da hora.
const inline = f => `<script>/* ${f} */\n${ler(f).replace(/<\/script/gi, '<\\/script')}\n</script>`;
const scripts = ['labs-apuracao-mapa.js', 'labs-apuracao.js', 'apuracao/apuracao-site.js'].map(inline).join('\n');
const html = ler('apuracao/apuracao.base.html').split('{{LOGO}}').join(logo).replace('{{SCRIPTS}}', () => scripts);
const destino = path.join(__dirname, 'index.html');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, html);
console.log(`gerado ${path.relative(RAIZ, destino)} (${Math.round(html.length / 1024)} KB)`);
