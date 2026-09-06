// Dossiê de dados do Parecer de Especialista — fases 3 a 6 por JS.
//
// O que estes testes travam, com os documentos REAIS do caso das blusinhas
// (PL 914/2024 → Lei 14.902/2024; MP 1.357/2026) como fixture:
//   1. a estimativa oficial é localizada quando existe e a ausência é
//      declarada quando não existe — sem estimativa própria no lugar;
//   2. a frase "não ocasiona renúncia" da EMI é capturada como negação;
//   3. o marco de vigência sai do texto ("a partir de 1º de agosto de 2024");
//   4. o leitor dos relatórios da RFB desfaz os números quebrados por espaço
//      e confere PRC + não PRC = total;
//   5. as janelas de 12 meses dão o nível certo (A/B/C) e deflacionam;
//   6. sem rede, o dossiê sai com avisos e sem número inventado.
//
// Uso: node testes/dossie.test.js
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const D = require(path.join(RAIZ, 'dossie.js'));
const fx = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== fase 3: estimativas oficiais no processo ==');
  {
    const r = D.localizarEstimativas(fx('prlp5-adequacao.txt'), 'PRLP 5');
    ok(r.estimativas.some(e => e.valor === 3.5e9), 'R$ 3,50 bilhões (Mover, 2024) localizado');
    ok(r.estimativas.some(e => e.valor === 2.924e9), 'R$ 2,924 bilhões (renúncia no PLOA 2024) localizado');
    ok(r.estimativas.some(e => e.valor === 576e6), 'R$ 576 milhões localizado');
    ok(r.estimativas.every(e => e.trecho.length > 100 && e.rotulo === 'PRLP 5'), 'cada estimativa vem com trecho e rótulo do documento');
    const nada = D.localizarEstimativas('O projeto altera a alíquota e entra em vigor na data de sua publicação.');
    ok(!nada.estimativas.length, 'texto sem cifra → nenhuma estimativa (e nenhuma inventada)');
  }

  console.log('== negação de impacto na EMI ==');
  {
    const r = D.localizarEstimativas(fx('emi1146-trecho.txt'), 'EMI 1146/2026');
    ok(r.negacoes.length === 1 && /n[ãa]o ocasiona ren[úu]ncia/i.test(r.negacoes[0].trecho),
       '"a medida em tela não ocasiona renúncia de receitas tributárias" é capturada como negação');
    ok(!r.estimativas.length, 'a EMI não traz cifra — nenhuma estimativa');
  }

  console.log('== fase 4: marco e normas ==');
  {
    const m = D.identificarMarco('A alíquota de 20% aplica-se às remessas com declaração registrada a partir de 1º de agosto de 2024, conforme a MP.');
    ok(m && m.data === '2024-08-01', 'marco "a partir de 1º de agosto de 2024" → 2024-08-01');
    ok(!D.identificarMarco('Esta Lei entra em vigor na data de sua publicação.'), 'vigência "na data da publicação" não vira marco (não há data)');
    const normas = D.normasCitadas('Altera o Decreto-Lei nº 1.804, de 3 de setembro de 1980, e a Lei nº 14.902, de 27 de junho de 2024. A Lei nº 14.902, de 2024, dispõe…');
    ok(normas[0].tipo === 'lei' && normas[0].numero === '14902' && normas[0].vezes === 2, 'a norma mais citada vem primeiro, sem ponto de milhar');
    ok(normas.some(n => n.tipo === 'del' && n.numero === '1804' && n.ano === 1980), 'Decreto-Lei 1.804/1980 reconhecido');
    ok(D.urlPlanalto({ tipo: 'lei', numero: '14902', ano: 2024 }) === 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/L14902.htm', 'URL do Planalto para lei de 2024');
    ok(D.urlPlanalto({ tipo: 'del', numero: '1804', ano: 1980 }) === 'https://www.planalto.gov.br/ccivil_03/decreto-lei/Del1804.htm', 'URL do Planalto para decreto-lei');
    ok(D.urlPlanalto({ tipo: 'lcp', numero: '101', ano: 2000 }) === 'https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp101.htm', 'URL do Planalto para lei complementar');
    const lei = 'Art. 31. Os incentivos terão prazo de cinco anos. Art. 32. O art. 1º do Decreto-Lei nº 1.804 passa a vigorar: § 2º-A tabela 0 50,00 20,0% 50,01 3.000,00 60,0% US$ 20,00. Art. 33. Ficam convalidados os atos.';
    const a32 = D.extrairArtigo(lei, 'Art. 32');
    ok(a32 && a32.startsWith('Art. 32.') && /20,0%/.test(a32) && !/Art\. 33/.test(a32), 'extrairArtigo recorta o art. 32 até o art. 33');
    ok(D.identificarRubricas('altera o Imposto de Importação sobre remessas').some(r => r.chave === 'II'), 'rubrica II identificada pelo texto');
    ok(!D.identificarRubricas('altera o Código Penal').length, 'texto penal não aciona rubrica de arrecadação');
  }

  console.log('== fase 6: leitor dos relatórios do Remessa Conforme (RFB) ==');
  {
    const mensal = D.lerRelatorioPRC(fx('prc/2025-03-relatorio-prc-marco.txt'), '2025-03-relatorio-prc-marco.pdf');
    ok(mensal.periodo.de === '2025-03' && mensal.periodo.meses === 1, 'período mensal a partir do nome do arquivo');
    ok(mensal.remessasRecebidas === 11233707, 'remessas recebidas: 11.233.707');
    ok(mensal.dir.qtd === 12803673 && mensal.dir.usd === 250411008 && mensal.dir.brl === 1441477121 && mensal.dir.ii === 392152761,
       'linha DIR: quantidade, US$, R$ e II devido');
    ok(mensal.prc.ii === 260551516 && mensal.naoPrc.qtd === 998599 && mensal.naoPrc.ii === 131601244, 'linhas PRC e não PRC');
    ok(mensal.confere === true, 'PRC + não PRC = total (conferência interna)');
    ok(/acima e abaixo/.test(mensal.notaII), 'nota: II do PRC sobre remessas acima e abaixo de US$ 50');

    const bim = D.lerRelatorioPRC(fx('prc/2023-12-2024-01-relatorio-prc-dezembro-e-janeiro.txt'), '2023-12-2024-01-relatorio-prc-dezembro-e-janeiro.pdf');
    ok(bim.periodo.de === '2023-12' && bim.periodo.ate === '2024-01' && bim.periodo.meses === 2, 'bimestre dez/2023–jan/2024');
    ok(bim.remessasRecebidas === 33692400, 'remessas em linha separada do rótulo: 33.692.400');
    ok(bim.prc.usd === 405482516, '"405.482.516,00" lê como 405.482.516 (centavos descartados)');
    ok(bim.confere === true && bim.dir.ii === 377991470, 'bimestre confere: 67.481.890 + 310.509.579 = 377.991.470');
    ok(/somente sobre remessas acima/.test(bim.notaII), 'nota: antes de ago/2024 o II do PRC só alcança remessas acima de US$ 50');

    const serie = [bim, { periodo: { de: '2024-02', ate: '2024-03', meses: 2 }, remessasRecebidas: 30605649, dir: { qtd: 32291096, usd: 532476679, brl: 2649614373, ii: 328027163 }, prc: { qtd: 29398870, ii: 73093342 }, naoPrc: { qtd: 2892226, ii: 254933821 } }];
    const ag = D.agregarPRC(serie, '2023-12', '2024-03');
    ok(ag.meses === 4 && ag.relatorios === 2, 'agregação de dois bimestres = 4 meses');
    ok(Math.round(ag.porMes.ii) === Math.round((377991470 + 328027163) / 4), 'média mensal do II devido');
    ok(ag.aliquotaEfetiva > 0.12 && ag.aliquotaEfetiva < 0.14, 'alíquota efetiva ≈ 13,5%');
    ok(D.GATILHO_PRC.test('altera o Decreto-Lei nº 1.804, de 3 de setembro de 1980') && !D.GATILHO_PRC.test('altera o Código Penal'), 'gatilho do adaptador PRC');

    const links = D.linksRelatoriosPRC('<a href="https://x/remessas-internacionais/2025-03-relatorio-prc-marco.pdf/view">a</a><a href="https://x/remessas-internacionais/2024-10-relatorio-prc-outubro.pdf">b</a>');
    ok(links.length === 2 && links[0].endsWith('2024-10-relatorio-prc-outubro.pdf'), 'links dos relatórios sem o sufixo /view, ordenados');
  }

  console.log('== fase 5: janelas previsto × realizado ==');
  {
    const serie = [];
    for (let a = 2023; a <= 2025; a++) for (let m = 1; m <= 12; m++) serie.push({ mes: `${a}-${String(m).padStart(2, '0')}`, valor: a < 2024 || (a === 2024 && m < 8) ? 100 : 200 });
    const j = D.janelas(serie, '2024-08-01');
    ok(j.nivel === 'A' && j.antes.meses === 12 && j.depois.meses === 12, '12 meses antes e 12 depois → nível A');
    ok(j.antes.de === '2023-08' && j.antes.ate === '2024-07' && j.depois.de === '2024-08' && j.depois.ate === '2025-07', 'limites das janelas');
    ok(j.antes.media === 100 && j.depois.media === 200 && j.variacao === 1, 'médias e variação (+100%)');
    const curta = D.janelas(serie.filter(p => p.mes <= '2024-12'), '2024-08-01');
    ok(curta.nivel === 'B' && curta.depois.meses === 5, 'janela posterior curta → nível B');
    ok(D.janelas([], '2024-08-01').nivel === 'C' && D.janelas(serie, null).nivel === 'C', 'sem série ou sem marco → nível C');
    const deflator = Object.fromEntries(serie.map(p => [p.mes, p.mes < '2024-08' ? 1.1 : 1.0]));
    const jr = D.janelas(serie, '2024-08-01', { deflator });
    ok(Math.abs(jr.antes.mediaReal - 110) < 1e-9 && jr.depois.mediaReal === 200 && Math.abs(jr.variacaoReal - (90 / 110)) < 1e-9, 'deflator aplicado às médias reais');
    const idx = D.indiceAcumulado([{ mes: '2024-01', valor: 1 }, { mes: '2024-02', valor: 1 }]);
    ok(Math.abs(D.fatorDeflator(idx, '2024-01', '2024-02') - 1.01) < 1e-9, 'fator de deflação = índice(ref) / índice(mês)');
  }

  console.log('== dossiê sem rede ==');
  {
    // LEGIN da Câmara primeiro: a busca aponta o link, "normaatualizada" traz o compilado
    {
      const paginas = {
        'https://www.camara.leg.br/legislacao/busca?geral=&tipoNorma=lei&numero=8112&ano=1990': '<a href="https://www2.camara.leg.br/legin/fed/decret_sn/1990/decreto-8112-1-janeiro-1990-1-norma-pe.html">x</a> <a href="https://www2.camara.leg.br/legin/fed/lei/1990/lei-8112-11-dezembro-1990-322161-norma-pl.html">Lei 8.112</a>',
        'https://www2.camara.leg.br/legin/fed/lei/1990/lei-8112-11-dezembro-1990-322161-normaatualizada-pl.html': '<html><body><p>Art. 240. Ao servidor público civil é assegurado, nos termos da Constituição Federal, o direito à livre associação sindical e os seguintes direitos: a) de ser representado pelo sindicato; d) (Revogada pela Lei nº 9.527, de 10/12/1997 ) e) (Revogada pela Lei nº 9.527, de 10/12/1997 )</p><p>Art. 241. Consideram-se da família do servidor.</p>' + '<p>x</p>'.repeat(200) + '</body></html>',
      };
      const pedidos = [];
      const fakeFetch = async u => { pedidos.push(u); const h = paginas[u]; return h ? { ok: true, status: 200, text: async () => h, arrayBuffer: async () => new TextEncoder().encode(h).buffer } : { ok: false, status: 503, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }; };
      const r = await D.buscarTextoNorma({ tipo: 'lei', numero: '8.112', ano: 1990 }, fakeFetch);
      ok(r.origem === 'camara' && r.compilado && /normaatualizada-pl\.html$/.test(r.url) && /Revogada pela Lei nº 9\.527/.test(r.texto) && !pedidos.some(u => /planalto/.test(u)), 'Lei 8.112/1990: texto atualizado do LEGIN, pelo caminho /legin/fed/lei/, sem passar pelo Planalto');
      ok(/Revogada/.test(D.extrairArtigo(r.texto, '240')), 'extrairArtigo lê o art. 240 com as alíneas revogadas anotadas');
      const rm = await D.buscarTextoNorma({ tipo: 'mpv', numero: '1357', ano: 2026 }, fakeFetch);
      ok(rm.origem === null && !pedidos.some(u => /legislacao\/busca.*medida/.test(u)) && rm.tentativas.some(t => /Planalto/.test(t)), 'MP não passa pelo LEGIN (não tem versão atualizada): vai direto ao Planalto');
      const rf = await D.buscarTextoNorma({ tipo: 'lei', numero: '14.902', ano: 2024 }, fakeFetch);
      ok(rf.tentativas[0] && /Câmara\/LEGIN/.test(rf.tentativas[0]), 'falha do LEGIN fica registrada e a cascata segue');
    }
    const d = await D.montarDossie({ fonte: fx('prlp5-adequacao.txt') + ' A alíquota aplica-se a partir de 1º de agosto de 2024. Altera o Decreto-Lei nº 1.804, de 3 de setembro de 1980.', rotulos: ['PRLP 5'], ementa: 'Imposto de Importação sobre remessas', fetchFn: null });
    ok(d.estimativas.length >= 3 && d.marco?.data === '2024-08-01', 'estimativas e marco preenchidos sem rede');
    ok(d.nivel === 'C' && d.avisos.some(a => /Sem acesso à rede/.test(a)), 'sem rede: nível C e aviso declarado');
    ok(/ESTIMATIVAS OFICIAIS/.test(d.texto) && /R\$ 2,924 bilh/.test(d.texto) && /NÃO OBTIDO/.test(d.texto), 'texto do dossiê traz as estimativas e o que não foi obtido');
    ok(d.numeros.includes(2.924) && d.numeros.includes(576), 'lista branca de números sai do texto do dossiê');
    ok(!/SÉRIE SETORIAL/.test(d.texto), 'sem rede, nenhuma série é apresentada');
    ok(D.SECOES_PARECER[0] === 'Síntese' && D.SECOES_PARECER.includes('Opções e consequências'), 'estrutura fixa do parecer exportada');
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
