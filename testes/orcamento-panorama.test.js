// Panorama por pasta — Portal da Transparência (módulo Orçamento).
//
// Roda contra o retorno REAL da API, gravado em
// testes/fixtures/transparencia-pode-2026.json (5 parlamentares do Podemos,
// consultados em 19/08/2026 com a chave da Liderança). A chave NÃO está aqui
// nem no repositório: cada analista guarda a sua no próprio navegador.
//
// O que precisa estar certo:
//   a) valores vêm em texto pt-BR ("166.530,00") — e viram número;
//   b) codigoEmenda casa com o coEmendaPolitica do FNS (autor + número);
//   c) transferência ESPECIAL não tem proposta no FNS — a tela não pode
//      oferecer um detalhe que não existe;
//   d) a matriz parlamentar × pasta soma o que deve e não perde emenda
//      nenhuma na coluna "Outras".
//
// Uso: node testes/orcamento-panorama.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'emendas.js'), 'utf8');
const CRU = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'transparencia-pode-2026.json'), 'utf8'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const fmtN = n => (n || 0).toLocaleString('pt-BR');

const trecho = re => src.match(re)[0];
const M = new Function(`
  ${trecho(/function dinheiro\([\s\S]*?\n}/)}
  ${trecho(/function partesDoCodigo\([\s\S]*?\n}/)}
  ${trecho(/function normalizarEmenda\([\s\S]*?\n}/)}
  ${trecho(/function pagoIncoerente\([\s\S]*?\n}/)}
  ${trecho(/function temPropostaNoFns\([\s\S]*?\n}/)}
  ${trecho(/function somarEmendas\([\s\S]*?\n}/)}
  ${trecho(/function matrizPorPasta\([\s\S]*?\n}/)}
  ${trecho(/function chaveNome\([\s\S]*?\n}/)}
  return { dinheiro, partesDoCodigo, normalizarEmenda, temPropostaNoFns, somarEmendas, matrizPorPasta, pagoIncoerente, chaveNome };
`)();

const emendas = CRU.map(M.normalizarEmenda);

(async () => {
  console.log('== retorno real da API vira número ==');
  {
    const renata = emendas.filter(e => e.parlamentar === 'RENATA ABREU');
    ok(renata.length === 13, `13 emendas de Renata Abreu em 2026 (${renata.length})`);
    ok(emendas.every(e => Number.isFinite(e.empenhado) && Number.isFinite(e.pago)),
       'todo valor virou número — nenhum NaN escapou do formato "166.530,00"');
    const saude = renata.filter(e => e.funcao === 'Saúde');
    const t = M.somarEmendas(saude);
    ok(Math.round(t.pago) === 25877285,
       `pago em saúde bate com a fonte: ${Math.round(t.pago).toLocaleString('pt-BR')}`);
    // Confere contra a OUTRA fonte: a base do FNS deu 25.890.015 pagos para a
    // mesma deputada. As duas se corroboram dentro do erro de momento (0,05%).
    const difFns = Math.abs(t.pago - 25890015) / 25890015;
    ok(difFns < 0.01, `confere com o FNS dentro de 1% (diferença de ${(difFns * 100).toFixed(2)}%)`);
  }

  console.log('\n== o código da emenda é a ponte com o FNS ==');
  {
    const p = M.partesDoCodigo('202637460001');
    ok(p && p.ano === '2026' && p.autor === '3746' && p.numero === '0001',
       `202637460001 → ano ${p?.ano}, autor ${p?.autor}, nº ${p?.numero}`);
    // O FNS traz coEmendaPolitica "37460001" para a proposta de Arapeí, da
    // Renata: autor + número, exatamente o que sai daqui.
    ok(p.autor + p.numero === '37460001', 'autor+número reproduz o coEmendaPolitica do FNS');
    ok(M.partesDoCodigo('123') === null && M.partesDoCodigo('') === null,
       'código fora do padrão não é inventado');
    const daRenata = emendas.filter(e => e.parlamentar === 'RENATA ABREU');
    ok(daRenata.every(e => e.codigoAutor === '3746'), 'todas as emendas dela carregam o mesmo código de autor');
  }

  console.log('\n== transferência especial não tem para onde descer ==');
  {
    const especiais = emendas.filter(e => /especia/i.test(e.tipo));
    const definidas = emendas.filter(e => /finalidade\s+definida/i.test(e.tipo) && e.funcao === 'Saúde');
    ok(especiais.length > 0, `${especiais.length} transferência(s) especial(is) na amostra real`);
    ok(especiais.every(e => !M.temPropostaNoFns(e)),
       'nenhuma especial promete detalhe no FNS');
    ok(definidas.length > 0 && definidas.every(e => M.temPropostaNoFns(e)),
       `saúde com finalidade definida aponta para o FNS (${definidas.length})`);
    ok(!M.temPropostaNoFns({ tipo: 'Emenda Individual - Transferências com Finalidade Definida', funcao: 'Educação' }),
       'fora da saúde não promete FNS, mesmo com finalidade definida');
  }

  console.log('\n== contradição da fonte é marcada, não aparada ==');
  {
    // Caso REAL: emenda 202644370009 (Nely Aquino, desporto) — empenhado
    // 392.000, liquidado 391.984,80 e pago 783.969,60. O Portal se contradiz;
    // aparar para 100% esconderia isso da Liderança.
    const bicho = emendas.find(e => e.codigo === '202644370009');
    ok(bicho && M.pagoIncoerente(bicho),
       `pago (${fmtN(bicho?.pago)}) acima do empenhado (${fmtN(bicho?.empenhado)}) é detectado`);
    ok(bicho.pago === 783969.6, 'o valor é preservado exatamente como veio da fonte');
    ok(!M.pagoIncoerente({ empenhado: 100, pago: 100 }) && !M.pagoIncoerente({ empenhado: 100, pago: 40 }),
       'caso normal não é marcado');
    ok(!M.pagoIncoerente({ empenhado: 0, pago: 0 }), 'emenda sem empenho não vira falso alarme');
  }

  console.log('\n== conferência na fonte soma os documentos de pagamento ==');
  {
    // A conferência foi feita à mão em 19/08/2026 para a emenda da Nely: o
    // endpoint de documentos devolve UM pagamento (2026OB000014) e o detalhe
    // desse documento vale 391.984,80 — metade do que a API de emendas diz.
    const conferir = new Function('fetchTransparencia', 'dinheiro', `
      ${trecho(/async function conferirEmendaNaFonte\([\s\S]*?\n}/)}
      return conferirEmendaNaFonte;`)(
      async (caminho) => caminho.startsWith('emendas/documentos')
        ? [{ fase: 'Empenho', codigoDocumento: 'X-NE' },
           { fase: 'Liquidação', codigoDocumento: 'X-NS' },
           { fase: 'Pagamento', codigoDocumento: '550029000012026OB000014', data: '29/05/2026' }]
        : { documentoResumido: '2026OB000014', data: '29/05/2026',
            nomeFavorecido: 'CONFEDERACAO BRASILEIRA DE DESPORTOS DE SURDOS', valor: '391.984,80' },
      M.dinheiro);

    const r = await conferir('202644370009', 'chave-de-teste');
    ok(r.pagamentos.length === 1, `só a fase de PAGAMENTO é somada (${r.pagamentos.length} de 3 documentos)`);
    ok(r.soma === 391984.8, `soma dos documentos: ${fmtN(r.soma)} — metade do que a API de emendas informa`);
    ok(r.pagamentos[0].documento === '2026OB000014' && /SURDOS/.test(r.pagamentos[0].favorecido),
       `documento identificado: ${r.pagamentos[0].documento} · ${r.pagamentos[0].favorecido}`);
  }

  console.log('\n== quem é a bancada (dados reais da API da Câmara) ==');
  {
    const CAM = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'camara-pode-legislatura.json'), 'utf8'));
    const montar = nomesFns => new Function('jsonCamara', 'state', 'SIGLA_PODEMOS', `
      ${trecho(/function chaveNome\([\s\S]*?\n}/)}
      ${trecho(/async function mapLimite\([\s\S]*?\n}/)}
      ${trecho(/async function bancadaDoPodemos\([\s\S]*?\n}/)}
      ${trecho(/function composicaoDaBancada\([\s\S]*?\n}/)}
      return { bancadaDoPodemos, composicaoDaBancada, chaveNome };`)(
      async caminho => {
        if (caminho.startsWith('legislaturas')) return { dados: [{ id: CAM.legislatura }] };
        if (caminho.startsWith('deputados/')) return { dados: { ultimoStatus: CAM.detalhes[caminho.split('/')[1]] } };
        return { dados: CAM.lista };
      },
      { itens: nomesFns.map(n => ({ deputado: n })) }, 'PODE');

    const M2 = montar(['RENATA ABREU', 'JORGE KAJURU', 'FABIO MACEDO', 'SAMUEL SANTOS']);
    const bancada = await M2.bancadaDoPodemos();
    const nomes = bancada.map(p => p.nome);
    const achar = n => bancada.find(p => M2.chaveNome(p.nome) === M2.chaveNome(n));

    // A presidente do partido está LICENCIADA: a consulta antiga, por
    // deputados em exercício, a deixava fora da própria bancada.
    const renata = achar('Renata Abreu');
    ok(renata && renata.casa === 'deputado' && /licen/i.test(renata.situacao),
       `Renata Abreu entra como deputada licenciada (situação: ${renata?.situacao})`);

    // Quem trocou de partido não é bancada (a lista da legislatura os traz).
    const trocaram = Object.values(CAM.detalhes).filter(u => u.siglaPartido !== 'PODE');
    ok(trocaram.length > 0 && trocaram.every(u => !achar(u.nome)),
       `${trocaram.length} que saíram do partido ficam de fora (${trocaram.map(u => u.siglaPartido).join(', ')})`);

    // "Vacância / Não Eleito" nunca assumiu — não é bancada.
    const vacancia = Object.values(CAM.detalhes).find(u => /vac/i.test(u.situacao) && u.siglaPartido === 'PODE');
    ok(!vacancia || !achar(vacancia.nome), `vacância fica de fora (${vacancia?.nome || '—'})`);

    // O mesmo id aparece com nomes diferentes na lista da legislatura.
    ok(nomes.filter(n => /samuel/i.test(n)).length === 1,
       `variações do mesmo id não duplicam (${nomes.filter(n => /samuel/i.test(n)).join(' / ') || 'nenhum'})`);
    // E acento não pode criar gêmeo: FNS escreve "FABIO", a Câmara "Fábio".
    ok(nomes.filter(n => /f[áa]bio macedo/i.test(n)).length === 1,
       `acento não duplica: ${nomes.filter(n => /f[áa]bio macedo/i.test(n)).join(' / ')}`);

    // Senador do partido com emenda no FNS entra, mas identificado.
    const kajuru = achar('JORGE KAJURU');
    ok(kajuru && kajuru.casa !== 'deputado',
       `senador entra marcado como fora da bancada de deputados (${kajuru?.casa})`);

    ok(bancada.every(p => p.nome && p.chave), 'todo integrante tem nome e chave de comparação');

    // A CHAVE é o que vai para o Portal: ele guarda em maiúsculas e SEM
    // acento, e o filtro é sensível aos dois. Consultar "Renata Abreu" ou
    // "FÁBIO MACEDO" devolve zero — foi assim que a bancada inteira sumiu do
    // painel em 19/08/2026, sem erro nenhum aparecer.
    ok(M2.chaveNome('Renata Abreu') === 'RENATA ABREU', 'caixa: Renata Abreu → RENATA ABREU');
    ok(M2.chaveNome('Fábio Macedo') === 'FABIO MACEDO', 'acento: Fábio Macedo → FABIO MACEDO');
    ok(M2.chaveNome('Oriovisto Guimarães') === 'ORIOVISTO GUIMARAES', 'til: Guimarães → GUIMARAES');
    ok(bancada.every(p => p.chave === p.chave.toUpperCase() && !/[À-ÿ]/.test(p.chave)),
       'nenhuma chave sai com minúscula ou acento — é a forma que a fonte aceita');
    console.log('     →', M2.composicaoDaBancada(bancada));
  }

  console.log('\n== as duas fontes se encontram só pela chave normalizada ==');
  {
    // O FNS consulta por UF e devolve os nomes na coluna APELIDO; a
    // Transparência consulta por nome. Hoje as duas escrevem em maiúsculas sem
    // acento e bateriam por igualdade simples — o teste garante que o encontro
    // continue valendo se UMA delas mudar de convenção.
    const casar = (daTransparencia, opcoesDoFns) => {
      const alvo = M.chaveNome(daTransparencia);
      return (opcoesDoFns.find(o => M.chaveNome(o) === alvo)) || null;
    };
    ok(casar('FABIO MACEDO', ['FABIO MACEDO', 'NELY AQUINO']) === 'FABIO MACEDO', 'grafias iguais casam');
    ok(casar('FABIO MACEDO', ['FÁBIO MACEDO']) === 'FÁBIO MACEDO',
       'se o FNS passar a acentuar, o link continua achando o deputado');
    ok(casar('ORIOVISTO GUIMARAES', ['Oriovisto Guimarães']) === 'Oriovisto Guimarães',
       'e continua achando se mudar a caixa também');
    ok(casar('RENATA ABREU', ['NELY AQUINO']) === null,
       'quem não está na base do FNS não é casado à força com outro nome');
  }

  console.log('\n== o vínculo separa a bancada do resto ==');
  {
    // A base guardava só nomes soltos: ninguém distinguia deputado da bancada
    // de senador do partido ou de quem já saiu (relatado em 19/08/2026).
    const filtrar = (lista, vinculo) => lista.filter(e => {
      if (vinculo === 'deputados' && e.casa && e.casa !== 'deputado') return false;
      if (vinculo === 'outros' && e.casa === 'deputado') return false;
      return true;
    });
    const amostra = [
      { parlamentar: 'RENATA ABREU', casa: 'deputado' },
      { parlamentar: 'JORGE KAJURU', casa: 'fora da bancada de deputados' },
      { parlamentar: 'ANTIGA', /* sem casa: gravada antes do campo existir */ },
    ];
    ok(filtrar(amostra, 'deputados').map(e => e.parlamentar).join() === 'RENATA ABREU,ANTIGA',
       'deputados: senador sai, e o registro ANTIGO sem vínculo não é escondido');
    ok(filtrar(amostra, 'outros').map(e => e.parlamentar).join() === 'JORGE KAJURU,ANTIGA',
       'só fora da bancada: o deputado sai');
    ok(filtrar(amostra, '').length === 3, 'todos: ninguém é filtrado');
  }

  console.log('\n== matriz parlamentar × pasta ==');
  {
    const { colunas, linhas } = M.matrizPorPasta(emendas);
    ok(colunas.length <= 7, `no máximo 6 pastas + "Outras" (${colunas.length}: ${colunas.join(', ')})`);
    ok(colunas[0] === 'Saúde', `a pasta com mais empenho vem primeiro: ${colunas[0]}`);
    ok(linhas.length === 5, `uma linha por parlamentar (${linhas.length})`);

    // Nada pode se perder: a soma das células tem de ser a soma das emendas.
    const somaCelulas = linhas.reduce((a, l) =>
      a + Object.values(l.celulas).reduce((b, c) => b + c.pago, 0), 0);
    const somaEmendas = M.somarEmendas(emendas).pago;
    ok(Math.abs(somaCelulas - somaEmendas) < 0.01,
       `a matriz não perde dinheiro: ${Math.round(somaCelulas).toLocaleString('pt-BR')}`);

    ok(linhas[0].total.pago >= linhas[linhas.length - 1].total.pago, 'ordenado pelo total pago');
    const semEmendas = M.matrizPorPasta([]);
    ok(semEmendas.linhas.length === 0 && semEmendas.colunas.length === 0, 'lista vazia não quebra a matriz');
  }

  console.log('\n== restos a pagar entram na conta ==');
  {
    const t = M.somarEmendas([
      { empenhado: 100, liquidado: 50, pago: 40, restoInscrito: 30, restoPago: 10 },
      { empenhado: 200, liquidado: 200, pago: 200, restoInscrito: 0, restoPago: 0 },
    ]);
    ok(t.restos === 20, `restos = inscrito - pago, sem contar negativo (${t.restos})`);
    ok(t.empenhado === 300 && t.pago === 240, 'somas simples conferem');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
