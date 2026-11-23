// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Forma da nota técnica, qualquer que seja o modelo (19/11/2026).
//
// CASO REAL: com o MESMO prompt, o gemini-3.1-flash-lite começava a nota em "## Objetivo", sem listas
// (mediana de 4,5 mil caracteres em 59 notas); o claude-opus-5-5 abria com "# Nota Técnica: PL …" (8 de 11
// notas), usava lista dentro de lista e escrevia o dobro. A equipe viu as notas "fora do padrão".
//
// O que este teste trava:
//   1. padronizarNota: tira o título solto antes da primeira seção, a cerca de código, as linhas divisórias
//      e o segundo nível das listas — e não tira conteúdo;
//   2. os prompts do Plenário (projeto e PDL) e o das pautas de comissão trazem o formato obrigatório;
//   3. a saída do modelo passa pelo padrão antes de ser gravada (Plenário, continuação e comissões).
// Uso: node testes/nota-formato-padrao.test.js
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const ia = ler('ia-comum.js'), an = ler('analise.js'), pc = ler('pautas-comissoes.js');
const C = require(path.join(RAIZ, 'pautas-comissoes-core.js'));
let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const padronizarNota = new Function(`${ia.match(/function padronizarNota\([\s\S]*?\n}/)[0]}\nreturn padronizarNota;`)();

console.log('== 1. padronizarNota ==');
const corpo = '## Objetivo\n\nO projeto altera a Lei nº 8.212, de 1991.\n\n## Justificativa\n\nO autor cita o art. 5º.';
ok(padronizarNota('# Nota Técnica – Projeto de Lei nº 294, de 2015\n\n' + corpo) === corpo, 'título "# Nota Técnica – …" antes da primeira seção: sai');
ok(padronizarNota('# Nota Técnica: PL 1969/2022\n\n---\n\n**PL 1969/2022**\n\n' + corpo) === corpo, 'título, linha divisória e rótulo em negrito antes da primeira seção: saem');
ok(padronizarNota(corpo) === corpo, 'nota que já começa em "## Objetivo": intacta');
ok(padronizarNota('Trata-se de projeto relevante.\n\n' + corpo).startsWith('Trata-se de projeto relevante.'), 'parágrafo de texto antes da primeira seção é conteúdo: fica');
ok(padronizarNota('```markdown\n' + corpo + '\n```') === corpo, 'cerca de código em volta: sai');
const lista = '## Pareceres das comissões\n\n- Na CPASF, a relatora apresentou parecer:\n  - substitui "segurado individual";\n    - identifica as leis.\n\n---\n\n## Argumentos favoráveis e contrários\n\n**Argumentos favoráveis:** texto.';
const lp = padronizarNota(lista);
ok(lp.includes('\n- substitui "segurado individual";\n- identifica as leis.') && !/^[ \t]+-/m.test(lp), 'lista dentro de lista passa ao primeiro nível, sem perder os itens');
ok(!/^---$/m.test(lp) && lp.includes('**Argumentos favoráveis:** texto.'), 'linha divisória sai; o negrito dos rótulos de argumentos fica');
// o que a equipe viu na nota do PL 1969/2022 feita pelo claude-opus-5-5: linha do tempo em lista, com datas em negrito, dentro da Justificativa
const opus = '# Nota Técnica: PL 1969/2022\n\n## Objetivo\n\nO projeto reconhece a responsabilidade do Estado.\n\n## Justificativa\n\nO parecer da CDHMIR acrescenta uma linha do tempo:\n\n- **Maio de 2021:** relatório da CIDH (Relatório n. 100/2021).\n- **Junho de 2022:** Lei estadual nº 9.753, do Rio de Janeiro.\n\nPara o relator, as medidas não se sobrepõem.\n\n## Pareceres das comissões\n\n- **Comissão de Direitos Humanos (CDHMIR):** o relator apresentou parecer. O substitutivo:\n  - reformula o art. 2º;\n  - suprime o art. 4º original.\n\n## Argumentos favoráveis e contrários\n\n**Argumentos favoráveis:** texto a favor.\n\n**Argumentos contrários:** texto contra.';
const po = padronizarNota(opus);
ok(po.startsWith('## Objetivo'), 'nota do Opus: começa em "## Objetivo"');
ok(po.includes('O parecer da CDHMIR acrescenta uma linha do tempo:\n\nMaio de 2021: relatório da CIDH (Relatório n. 100/2021). Junho de 2022: Lei estadual nº 9.753, do Rio de Janeiro.\n\nPara o relator'), 'Justificativa: a lista vira um parágrafo corrido, com todo o texto e sem negrito de rótulo');
ok(po.includes('- Comissão de Direitos Humanos (CDHMIR): o relator apresentou parecer. O substitutivo:\n- reformula o art. 2º;\n- suprime o art. 4º original.'), 'Pareceres das comissões: a lista fica (é a seção que admite tópicos), em um nível e sem negrito no rótulo');
ok(po.includes('**Argumentos favoráveis:** texto a favor.') && po.includes('**Argumentos contrários:** texto contra.'), 'os rótulos de argumentos continuam em negrito');
ok(padronizarNota('## Objetivo\n\n* primeiro ponto.\n\n* segundo ponto.') === '## Objetivo\n\nprimeiro ponto. segundo ponto.', 'Objetivo com lista de asteriscos e linhas em branco: um parágrafo');
ok(padronizarNota('A Câmara deve receber do Senado o projeto.\n\nSegundo parágrafo.') === 'A Câmara deve receber do Senado o projeto.\n\nSegundo parágrafo.', 'texto sem seção "## " (documento do analista) não é mexido');
ok(padronizarNota('') === '' && padronizarNota(null) === '', 'vazio continua vazio (a barreira de nota vazia vem depois)');

console.log('\n== 2. prompts ==');
const formato = an.match(/const FORMATO_PADRAO_NOTA = [^\n]+/)[0];
ok(/Não escreva título geral \(nenhuma linha com um só "#"/.test(formato) && /nunca lista dentro de lista/.test(formato) && /Nunca use tabelas/.test(formato), 'formato obrigatório: sem título geral, sem lista dentro de lista, sem tabelas');
ok(/de um a três parágrafos por seção/.test(formato) && /de 600 a 900 palavras/.test(formato) && /Negrito só onde este enunciado pede/.test(formato), 'formato obrigatório: parágrafos por seção, tamanho de referência e negrito só onde pedido');
ok((an.match(/\$\{FORMATO_PADRAO_NOTA\}/g) || []).length === 2, 'o formato entra no prompt do projeto e no do PDL');
const com = { sigla: 'CCJC', nome: 'Comissão de Constituição e Justiça e de Cidadania' };
const pCom = C.promptComissao({ comissao: com, reuniao: { data: '2026-11-19', hora: '10:00', titulo: 'Reunião' }, item: { sigla: 'PL', numero: '1', ano: '2026', ementa: 'x', titulo: 'PL 1/2026' }, docs: [{ tipo: 'PARECER', rotulo: 'PRL 1' }] });
ok(/A resposta começa diretamente na linha "## Objetivo": não escreva título geral/.test(pCom), 'pautas de comissão: o prompt também proíbe o título geral');

console.log('\n== 3. a saída passa pelo padrão ==');
ok(/markdown = padronizarNota\(markdown\);[^\n]*\n\s*\n\s*\/\/ Última barreira antes de gravar/.test(an), 'Plenário: a nota é padronizada antes da barreira de nota vazia, da conferência e da gravação');
ok(/const markdownCompleto = padronizarNota\(costurarContinuacao\(/.test(an), 'Plenário: a continuação da nota truncada também');
ok(/markdown: padronizarNota\(r\.text\)/.test(pc), 'pautas de comissão: idem');

console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo passou.');
process.exit(falhas ? 1 : 0);
