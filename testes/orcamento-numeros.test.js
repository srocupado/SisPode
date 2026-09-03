// Produto 4 do módulo de orçamento — os NÚMEROS do exercício.
//
// A ressalva registrada em b0b554d era que a nota saía sem um número do
// orçamento: todo número estava atrás de um portão manual e o estado padrão
// era vazio. Este produto lê as fontes que o módulo já localiza (informativo
// e nota técnica das Consultorias, Raio-X, a Mensagem dentro do PDF do
// projeto) e devolve cada indicador com página e trecho literal; o JS
// confere. Estes testes rodam sobre TEXTO REAL (fixtures/mensagem-ploa2027-
// numeros.txt: Mensagem do PLOA 2027 e Informativo Conjunto do PLOA 2026) e
// verificam a única coisa sob nosso controle: se a conferência PEGA quando o
// modelo responde mal.
//
//   1. valor que não está dentro do trecho citado (o salário mínimo de 2026
//      colado num trecho que fala do de 2027);
//   2. trecho que não existe no documento (parafraseado);
//   3. indicador fora do catálogo, e achado com cifra inventada;
//   4. a escolha de páginas da Mensagem, que tem de achar o capítulo fiscal
//      e não "as primeiras 40";
//   5. a ordem das fontes, a fusão sem repetição, o que vira proposta de
//      ficha e o bloco da nota.
//
// Uso: node testes/orcamento-numeros.test.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const IA = require(path.join(RAIZ, 'orcamento-ia.js'));
const F = require(path.join(RAIZ, 'ficha.js'));
const FONTE = fs.readFileSync(path.join(__dirname, 'fixtures', 'mensagem-ploa2027-numeros.txt'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// As funções da tela que não dependem do DOM, no mesmo esquema dos demais testes.
const src = fs.readFileSync(path.join(RAIZ, 'orcamento-notas.js'), 'utf8');
const trecho = re => { const m = src.match(re); if (!m) throw new Error('trecho não encontrado: ' + re); return m[0]; };
const M = new Function('compacto', 'CAMPOS_FICHA', `
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const estado = { ano: '2027', ficha: { valores: {} }, propostas: null, ia: null, quadro: null };
  ${trecho(/function chaveDocumento\([\s\S]*?\n^}/m)}
  ${trecho(/function fontesDeNumeros\([\s\S]*?\n^}/m)}
  ${trecho(/function numerosApurados\([\s\S]*?\n^}/m)}
  ${trecho(/function achadosApurados\([\s\S]*?\n^}/m)}
  ${trecho(/function proporFichaDosNumeros\([\s\S]*?\n^}/m)}
  ${trecho(/function blocoNumerosNota\([\s\S]*?\n^}/m)}
  return { estado, chaveDocumento, fontesDeNumeros, numerosApurados, achadosApurados, proporFichaDosNumeros, blocoNumerosNota };
`)(IA.compacto, F.CAMPOS_FICHA);

// Trechos LITERAIS da fixture (com as quebras de linha do PDF).
const T_SALARIO = 'rio mínimo, que, para o PLOA 2027, está estimado em R$ 1.741,00, refletindo \n7,40% de aumento frente ao valor vigente em 2026, de R$ 1.621,00.';
const T_BOLSA = 'Bolsa Família  157.062,2 \nSaúde  190.753,9';
const T_TOTAL12 = 'Demais  12.011,3 \nTotal  396.273,5';
const T_PIB = 'Crescimento real do PIB (%) 2,54 2,19 2,44 1,87';
const T_RESERVA = 'O art. 13, § 5º, do PLDO 2027 prevê que o Projeto de Lei Orçamentária \nAnual de 2027 deve conter reservas específicas destinadas ao atendi-\nmento de emendas individuais e de bancada estadual';

(async () => {
  console.log('== o prompt dos números ==');
  {
    const p = IA.promptNumeros({ materia: 'PLN 24/2026 — PLOA 2027', rotulo: 'Mensagem Presidencial', exercicio: '2027' });
    ok(/"salario_minimo"/.test(p) && /"reserva_emendas_total"/.test(p) && /"resultado_primario"/.test(p), 'o catálogo inteiro vai no prompt');
    ok(/CÓPIA EXATA/.test(p) && /CONTER o "valor"/.test(p), 'exige trecho literal que contenha o valor');
    ok(/NÃO use conhecimento de outros exercícios/.test(p), 'e proíbe o número lembrado de outro ano');
    ok(/"achados"/.test(p) && /"outros"/.test(p), 'pede também os achados e os números fora do catálogo');
    ok(IA.INDICADORES_EXERCICIO.some(i => i.chave === 'pib' && i.ficha === 'pib')
       && IA.INDICADORES_EXERCICIO.every(i => !i.ficha || F.CAMPOS_FICHA.some(c => c.chave === i.ficha)),
       'todo indicador ligado à ficha aponta para um campo que existe nela');
  }

  console.log('\n== a conferência aprova o que está no documento ==');
  {
    const resp = {
      indicadores: [
        { chave: 'salario_minimo', valor: 'R$ 1.741,00', exercicio: '2027', pagina: '128', trecho: T_SALARIO },
        { chave: 'pib', valor: '2,44', exercicio: '2026', pagina: '1', trecho: T_PIB },
      ],
      outros: [{ rotulo: 'Bolsa Família (despesa obrigatória com controle de fluxo)', valor: '157.062,2', pagina: '129', trecho: T_BOLSA }],
      achados: [{ tema: 'Salário mínimo', afirmacao: 'O PLOA 2027 estima o salário mínimo em R$ 1.741,00, alta de 7,40% sobre os R$ 1.621,00 de 2026.', pagina: '128', trecho: T_SALARIO }],
    };
    const c = IA.conferirNumeros(resp, FONTE);
    ok(c.conferido && c.apurados.length === 3 && c.recusados.length === 0, `3 números aprovados, nenhum recusado (${c.resumo})`);
    const sm = c.apurados.find(a => a.chave === 'salario_minimo');
    ok(sm && sm.rotulo === 'Salário mínimo' && sm.grupo === 'Parâmetros macroeconômicos' && sm.ficha === 'salario_minimo' && sm.pagina === '128',
       'o indicador sai com rótulo, grupo, campo da ficha e página');
    const outro = c.apurados.find(a => !a.chave);
    ok(outro && outro.grupo === 'Outros números' && outro.rotulo.startsWith('Bolsa Família'), '"outros" entra com o rótulo do modelo, no grupo próprio');
    ok(c.achados.length === 1 && c.achados[0].tema === 'Salário mínimo', 'o achado com cifras do documento é aprovado');
  }

  console.log('\n== e recusa o que o modelo inventou ==');
  {
    const resp = {
      indicadores: [
        // 1) o número do ano passado colado num trecho verdadeiro
        { chave: 'salario_minimo', valor: 'R$ 1.631,00', pagina: '128', trecho: T_SALARIO },
        // 2) trecho parafraseado — não existe assim no documento
        { chave: 'despesas_obrigatorias', valor: '396.273,5', pagina: '129', trecho: 'O total das despesas obrigatórias com controle de fluxo é de 396.273,5 milhões no PLOA 2027.' },
        // 3) indicador fora do catálogo
        { chave: 'deficit_nominal_ajustado', valor: '1,0%', pagina: '5', trecho: T_TOTAL12 },
        // 4) sem trecho
        { chave: 'ipca', valor: '3,60' },
        // 5) valor certo, trecho certo — passa
        { chave: 'ipca', valor: '3,60', pagina: '1', trecho: 'IPCA acumulado (%) 4,94 4,85 3,60 4,31' },
      ],
      outros: [{ valor: '10', trecho: T_TOTAL12 }],
      achados: [
        // cifra que não está no documento
        { tema: 'Reserva', afirmacao: 'A reserva para emendas é de R$ 55 bilhões.', pagina: '129', trecho: T_RESERVA },
        // trecho inventado
        { tema: 'Emendas', afirmacao: 'O projeto reserva valores para emendas individuais e de bancada.', pagina: '129', trecho: 'O projeto reserva valores para emendas individuais e de bancada estadual conforme o PLDO.' },
        // ok
        { tema: 'Emendas', afirmacao: 'O PLDO 2027 exige que o PLOA contenha reservas específicas para emendas individuais e de bancada estadual.', pagina: '129', trecho: T_RESERVA },
      ],
    };
    const c = IA.conferirNumeros(resp, FONTE);
    const motivo = chave => c.recusados.find(r => r.chave === chave)?.motivo || '';
    ok(c.apurados.length === 1 && c.apurados[0].chave === 'ipca', `só o IPCA passa (${c.apurados.map(a => a.chave).join(', ')})`);
    ok(/não aparece dentro do trecho/.test(motivo('salario_minimo')), `o salário mínimo de 2026 num trecho de 2027 é recusado: "${motivo('salario_minimo')}"`);
    ok(/não foi localizado no documento/.test(motivo('despesas_obrigatorias')), 'o trecho parafraseado é recusado');
    ok(/desconhecido no catálogo/.test(motivo('deficit_nominal_ajustado')), 'indicador fora do catálogo é recusado');
    ok(c.recusados.some(r => r.chave === 'ipca' && /sem trecho/.test(r.motivo)), 'o item sem trecho é recusado, e o mesmo indicador com trecho passa');
    ok(c.recusados.some(r => r.tipo === 'outro' && /sem rótulo/.test(r.motivo)), '"outros" sem rótulo é recusado');
    ok(c.achados.length === 1 && /reservas específicas/.test(c.achados[0].afirmacao), 'dos três achados, só o sustentado pelo documento passa');
    ok(c.recusados.some(r => r.tipo === 'achado' && /cifra\(s\) da afirmação/.test(r.motivo) && /55/.test(r.motivo)),
       'a cifra inventada na afirmação é nomeada no motivo');
    ok(c.recusados.length === 7, `7 recusas, cada uma com motivo (${c.recusados.length})`);
    ok(IA.cifrasDeAfirmacao('A reserva é de R$ 55 bilhões, ou 12% do total, e 8 mil obras; PIB de 2,44%.').sort().join('|') === '12|2,44|55|8',
       'as cifras curtas da prosa ("R$ 55 bilhões", "12%", "8 mil") são capturadas junto com as decimais');
    ok(IA.cifraNoDocumento('valor de R$ 1.741,00 e 7,40% de aumento', IA.compacto('valor de R$ 1.741,00 e 7,40% de aumento'), '7,40')
       && !IA.cifraNoDocumento('valor de R$ 1.741,00 e 7,40% de aumento', IA.compacto('valor de R$ 1.741,00 e 7,40% de aumento'), '55'),
       'número curto precisa aparecer inteiro no documento: "7,40" sim, "55" (que está dentro de outros dígitos) não');
    const curto = IA.conferirNumeros(resp, 'texto curto');
    ok(!curto.conferido && /não pôde ser extraído/.test(curto.motivo), 'fonte ilegível não aprova nem reprova: diz que nada foi conferido');
    ok(IA.conferirNumeros(null, FONTE).conferido && IA.conferirNumeros('x', FONTE).apurados.length === 0, 'resposta vazia ou estranha não quebra');
  }

  console.log('\n== as páginas da Mensagem que valem a leitura ==');
  {
    const paginas = [];
    for (let n = 1; n <= 300; n++) paginas.push({ numero: n, texto: `Mensagem Presidencial página ${n}. Texto genérico do capítulo.` });
    paginas[112].texto += ' I. RECEITA TOTAL 3.459.274,4 Resultado Primário';
    paginas[127].texto += ' salário mínimo estimado em R$ 1.741,00 Despesas Obrigatórias';
    paginas[128].texto += ' Reserva para Emendas emendas individuais emendas de bancada Despesas Discricionárias';
    paginas[134].texto += ' Parâmetros Macroeconômicos IPCA Selic câmbio PIB';
    paginas[20].texto += ' Resultado Primário';
    const sel = IA.paginasRelevantes(paginas, IA.TERMOS_MENSAGEM, 4);
    ok(sel.map(p => p.numero).join(',') === '113,129,135,128'.split(',').sort((a, b) => a - b).join(','),
       `as 4 páginas mais relevantes, na ordem do documento: ${sel.map(p => p.numero).join(', ')}`);
    ok(!sel.some(p => p.numero === 21), 'a página com um termo só fica de fora quando há melhores');
    ok(IA.paginasRelevantes(paginas.slice(0, 10), IA.TERMOS_MENSAGEM, 40).length === 0, 'páginas sem nenhum termo não entram — nunca se manda "as primeiras N" por inércia');
    ok(IA.paginasRelevantes([], IA.TERMOS_MENSAGEM).length === 0, 'lista vazia → vazia');
  }

  console.log('\n== as fontes, na ordem em que valem a leitura ==');
  {
    const q = {
      materia: { disponivel: true, identificacao: 'PLN 15/2025', apelido: 'PLOA 2026', urlDocumento: 'https://legis/pln15' },
      notas: { disponivel: true, notas: [
        { data: '19/02/2026', titulo: 'Raio-X da LOA 2026 Pós Vetos', url: 'https://cn/raiox-pos' },
        { data: '01/10/2025', titulo: 'Nota Técnica Conjunta nº 5, de 2025 - CONORF/SF - CONOF/CD - Subsídios à Apreciação do Projeto de Lei Orçamentária', url: 'https://cn/ntc' },
        { data: '19/09/2025', titulo: 'Raio X do Orçamento 2026 (PLOA)', url: 'https://cn/raiox' },
        { data: '16/09/2025', titulo: 'Informativo Conjunto LOA 2026 - Projeto de Lei Orçamentária para 2026 - PLN 15/2025', url: 'https://cn/informativo' },
        { data: '07/10/2025', titulo: 'Nota Técnica Conjunta nº 6, de 2025 - Subsídios ao Trabalho do Comitê de Avaliação das Informações sobre Obras', url: 'https://cn/ntc6' },
      ] },
      executivo: { disponivel: true, documentos: [{ rotulo: 'Orçamento Cidadão', url: 'https://gov/cidadao', classe: 'orcamento_cidadao' }, { rotulo: 'Volume I', url: 'https://gov/v1', classe: 'volume' }] },
      acompanhamento: { disponivel: true, relatorioGeral: { rotulo: 'Relatório Geral - PAR 62/2025', url: 'https://cn/rg', classe: 'relatorio_geral' } },
    };
    const f = M.fontesDeNumeros(q);
    ok(f.map(x => x.classe).join(',') === 'informativo,raiox,raiox,orcamento_cidadao,mensagem,nota_tecnica,nota_tecnica,relatorio_geral',
       `ordem: ${f.map(x => x.classe).join(' → ')}`);
    ok(f[0].url === 'https://cn/informativo' && f.find(x => x.mensagem).url === 'https://legis/pln15', 'o Informativo vem primeiro; a Mensagem é o PDF do projeto');
    ok(!f.some(x => x.url === 'https://gov/v1'), 'os volumes de alocação não entram (são milhares de páginas de tabela)');
    ok(new Set(f.map(x => x.url)).size === f.length, 'nenhuma URL repetida');
    ok(M.fontesDeNumeros({ materia: { disponivel: false }, notas: { disponivel: false } }).length === 0, 'sem matéria e sem notas, nenhuma fonte');
    ok(M.fontesDeNumeros({ materia: { disponivel: true, identificacao: 'PLN 24/2026', urlDocumento: 'https://legis/pln24' }, notas: { disponivel: false, motivo: 'ainda não' } })
         .map(x => x.classe).join() === 'mensagem', 'PLOA recém-chegado: só a Mensagem, que é o que existe');
  }

  console.log('\n== fusão das leituras, propostas de ficha e o bloco da nota ==');
  {
    const q = {
      materia: { disponivel: true, identificacao: 'PLN 24/2026', apelido: 'PLOA 2027', urlDocumento: 'https://legis/pln24' },
      notas: { disponivel: true, notas: [{ data: '16/09/2026', titulo: 'Informativo Conjunto LOA 2027', url: 'https://cn/inf27' }] },
    };
    const kInf = M.chaveDocumento('https://cn/inf27'), kMsg = M.chaveDocumento('https://legis/pln24');
    const ia = { numeros: {
      [kMsg]: { url: 'https://legis/pln24', rotulo: 'Mensagem Presidencial (PLN 24/2026)', modoLeitura: 'texto', conferido: true,
        apurados: [
          { chave: 'salario_minimo', rotulo: 'Salário mínimo', grupo: 'Parâmetros macroeconômicos', ficha: 'salario_minimo', valor: 'R$ 1.741,00', exercicio: '2027', pagina: '128', trecho: T_SALARIO },
          { chave: 'pib', rotulo: 'Crescimento real do PIB', grupo: 'Parâmetros macroeconômicos', ficha: 'pib', valor: '2,5%', exercicio: '2027', pagina: '135', trecho: 'x' },
          { chave: null, rotulo: 'Bolsa Família', grupo: 'Outros números', ficha: null, valor: '157.062,2', pagina: '129', trecho: T_BOLSA },
        ],
        achados: [{ tema: 'Salário mínimo', afirmacao: 'Alta de 7,40% sobre 2026.', pagina: '128', trecho: T_SALARIO }] },
      [kInf]: { url: 'https://cn/inf27', rotulo: 'Informativo Conjunto LOA 2027', modoLeitura: 'pdf', conferido: true,
        apurados: [
          { chave: 'pib', rotulo: 'Crescimento real do PIB', grupo: 'Parâmetros macroeconômicos', ficha: 'pib', valor: '2,44', exercicio: '2026', pagina: '1', trecho: T_PIB },
          { chave: 'ipca', rotulo: 'IPCA', grupo: 'Parâmetros macroeconômicos', ficha: 'ipca', valor: '3,60', exercicio: '2026', pagina: '1', trecho: 'y' },
          { chave: null, rotulo: 'Bolsa Família', grupo: 'Outros números', ficha: null, valor: '157.062,2', pagina: '3', trecho: T_BOLSA },
        ],
        achados: [{ tema: 'Salário mínimo', afirmacao: 'Alta de 7,40% sobre 2026.', pagina: '2', trecho: T_SALARIO }] },
    } };
    const ap = M.numerosApurados(ia, q);
    ok(ap.length === 4, `4 números depois da fusão (${ap.length})`);
    ok(ap.find(a => a.chave === 'pib').valor === '2,44' && ap.find(a => a.chave === 'pib').fonte === 'Informativo Conjunto LOA 2027',
       'para o mesmo indicador vale a primeira fonte na ordem de leitura (o Informativo, antes da Mensagem)');
    ok(ap.filter(a => a.rotulo === 'Bolsa Família').length === 1, '"outros" repetido nas duas fontes entra uma vez');
    ok(ap.find(a => a.chave === 'salario_minimo').fonte.startsWith('Mensagem'), 'e o que só a Mensagem traz vem com a fonte dela');
    const ach = M.achadosApurados(ia);
    ok(ach.length === 1, 'achado igual em duas fontes entra uma vez');

    // A lista branca da síntese passa a conter o que foi apurado.
    const base = IA.numerosDaBase({ numeros: ap, achados: ach });
    ok(base.has(1741) && base.has(2.44) && base.has(157062.2) && base.has(7.4), 'os valores apurados (e as cifras dos achados) entram na base da síntese');
    const c = IA.conferirSintese('O salário mínimo sobe para R$ 1.741,00 (alta de 7,4%); o PIB deve crescer 2,44%.', base);
    ok(c.limpo && c.conferidos === 3, 'e a síntese que os cita é conferida limpa');
    ok(!IA.conferirSintese('O salário mínimo sobe para R$ 1.812,00.', base).limpo, 'enquanto a cifra que não foi apurada continua marcada');
    const p = IA.promptSintese({ numeros: ap, achados: ach, materia: 'PLN 24/2026' });
    ok(/Números do exercício/.test(p) && /Salário mínimo: R\$ 1\.741,00 \(2027\) — fonte: Mensagem/.test(p), 'o prompt da síntese lista os números com fonte e exercício');
    ok(/DESTAQUES REGISTRADOS NAS FONTES/.test(p) && /Alta de 7,40%/.test(p), 'e os achados');
    ok(/molde dos informativos da\s+Liderança/.test(p) && /o que cada termo técnico significa/.test(p), 'no molde dos informativos, explicando os termos');

    // Propostas de ficha: só os indicadores com campo, do exercício certo, ainda vazios.
    M.estado.ia = ia; M.estado.quadro = q; M.estado.ano = '2027';
    M.estado.ficha = { valores: { ipca: { valor: '4,0%', documento: 'x' } } };
    M.estado.propostas = null;
    M.proporFichaDosNumeros();
    const props = M.estado.propostas?.aceitas || [];
    ok(props.map(x => x.campo).sort().join(',') === 'salario_minimo', `só o salário mínimo vira proposta (${props.map(x => x.campo).join(', ')}): o PIB é de 2026 (outro exercício) e o IPCA já está preenchido`);
    ok(props[0].documento.startsWith('Mensagem') && props[0].pagina === '128' && props[0].trecho === T_SALARIO, 'com documento, página e trecho — a mesma procedência do preenchimento manual');

    const html = M.blocoNumerosNota(ap, ach);
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    ok(/Números do exercício/.test(txt) && /Salário mínimo/.test(txt) && /R\$ 1\.741,00/.test(txt) && /p\. 128/.test(txt), 'a nota traz o número, a fonte e a página');
    ok(/Parâmetros macroeconômicos/.test(txt) && /Outros números/.test(txt), 'agrupado como no catálogo');
    ok(/Destaques registrados nas fontes/.test(txt) && /Alta de 7,40%/.test(txt), 'e os achados');
    ok(/Fontes: Informativo Conjunto LOA 2027; Mensagem Presidencial/.test(txt), 'com as fontes nomeadas');
    ok(M.blocoNumerosNota([], []) === '', 'sem nada apurado, o bloco não existe (a nota não finge)');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
