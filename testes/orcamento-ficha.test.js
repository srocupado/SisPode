// Ficha de parâmetros do exercício (ficha.js).
//
// A nota orçamentária vive de uma dúzia de números — cota individual, cota de
// bancada, quantidade de emendas, sequenciais de cancelamento, pisos de
// repasse. Errar um deles não produz uma nota imprecisa: produz uma emenda
// inválida.
//
// O RISCO QUE ESTE ARQUIVO EXISTE PARA CONTER é o número herdado. Medido em
// 03/09/2026: a cota individual por deputado era R$ 19.704.897,00 na LOA 2023
// e é R$ 40.252.007,00 na LOA 2026 — dobrou. Copiada em silêncio de um
// exercício para o outro, a diferença passa despercebida numa leitura rápida.
//
// Daí as três barreiras que os testes travam:
//   1. a ficha nasce VAZIA, com todos os campos visíveis desde o primeiro dia
//      (uma ficha que só mostrasse o que tem esconderia o que falta);
//   2. nenhum valor entra sem DOCUMENTO de origem;
//   3. valor carimbado com outro exercício é denunciado.
//
// E a distinção que dá sentido à tela: "aguardando" (a fonte do exercício
// ainda não saiu — não é lacuna de ninguém) é diferente de "pendente" (a fonte
// existe e o campo continua vazio — é trabalho a fazer).
//
// Uso: node testes/orcamento-ficha.test.js
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const F = require(path.join(RAIZ, 'ficha.js'));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const SEM_FONTE  = { ancora: false, ploa: false, auto: {} };
const COM_ANCORA = { ancora: true,  ploa: true,  auto: {} };

(async () => {
  console.log('== a ficha nasce vazia, mas inteira ==');
  {
    const f = F.fichaVazia('loa', 2027);
    const linhas = F.estadoDaFicha(f, SEM_FONTE);
    ok(linhas.length === F.CAMPOS_FICHA.length && linhas.length >= 18,
       `${linhas.length} campos existem desde o primeiro dia`);
    ok(linhas.every(l => l.estado === 'aguardando'),
       'sem fonte publicada, TODOS ficam "aguardando" — nenhum é lacuna do analista');
    ok(linhas.every(l => l.rotulo && l.grupo), 'todo campo tem rótulo e grupo para a tela');
    ok(F.GRUPOS_FICHA.length >= 5, `agrupados em ${F.GRUPOS_FICHA.length} blocos`);
    // Os campos que o caso real exige.
    for (const c of ['cota_individual_deputado', 'cota_bancada', 'qtd_emendas_individuais',
                     'sequenciais_individual', 'piso_obras', 'prazo_emendas', 'salario_minimo']) {
      ok(F.CAMPOS_FICHA.some(x => x.chave === c), `campo previsto: ${c}`);
    }
    ok(F.CAMPOS_FICHA.some(c => c.chave === 'cota_individual_senador'),
       'cota do senador é campo próprio — não se deduz da do deputado');
  }

  console.log('\n== aguardando × pendente ==');
  {
    const f = F.fichaVazia('loa', 2027);
    const semFonte = F.estadoDaFicha(f, SEM_FONTE).find(l => l.chave === 'cota_individual_deputado');
    ok(semFonte.estado === 'aguardando', 'sem Manual publicado: aguardando a fonte');
    const comFonte = F.estadoDaFicha(f, COM_ANCORA).find(l => l.chave === 'cota_individual_deputado');
    ok(comFonte.estado === 'pendente', 'com o Manual publicado e o campo vazio: a preencher');
    const r = F.resumoDaFicha(f, COM_ANCORA);
    ok(r.pendente > 0 && r.aguardando + r.pendente === r.total && !r.completa,
       `resumo: ${r.pendente} a preencher, ${r.aguardando} aguardando, completa=${r.completa}`);
  }

  console.log('\n== o prazo vem pronto do cronograma ==');
  {
    const f = F.fichaVazia('loa', 2026);
    const comPrazo = { ...COM_ANCORA, auto: { prazo_emendas: '24/10/2025 a 14/11/2025' } };
    const l = F.estadoDaFicha(f, comPrazo).find(x => x.chave === 'prazo_emendas');
    ok(l.estado === 'conferido' && l.valor === '24/10/2025 a 14/11/2025',
       `o prazo é preenchido pelo módulo: ${l.valor}`);
    ok(l.automatico && /cronograma/i.test(l.documento), `com a procedência automática: ${l.documento}`);
    const semPrazo = F.estadoDaFicha(f, COM_ANCORA).find(x => x.chave === 'prazo_emendas');
    ok(semPrazo.estado !== 'conferido' && !semPrazo.valor, 'sem cronograma, o prazo não é inventado');
  }

  console.log('\n== A BARREIRA: valor sem procedência é recusado ==');
  {
    const f = F.fichaVazia('loa', 2026);
    const semDoc = F.preencherCampo(f, 'cota_individual_deputado', { valor: 'R$ 40.252.007,00' });
    ok(!semDoc.ok && /procedência/i.test(semDoc.erro), `recusado: "${semDoc.erro}"`);
    ok(!f.valores.cota_individual_deputado, 'e nada foi gravado');

    const semValor = F.preencherCampo(f, 'cota_individual_deputado', { documento: 'Manual de Emendas 2026' });
    ok(!semValor.ok && /valor/i.test(semValor.erro), 'valor vazio também é recusado');

    ok(!F.preencherCampo(f, 'campo_inexistente', { valor: 'x', documento: 'y' }).ok,
       'campo fora do esquema não entra');

    const bom = F.preencherCampo(f, 'cota_individual_deputado', {
      valor: 'R$ 40.252.007,00', documento: 'Manual de Emendas da LOA 2026', pagina: '18',
      trecho: 'Deputados: R$ 40.252.007,00', preenchidoPor: 'Vinícius',
    });
    ok(bom.ok, 'com valor e documento, entra');
    const v = f.valores.cota_individual_deputado;
    ok(v.pagina === '18' && /Manual/.test(v.documento) && v.preenchidoPor === 'Vinícius',
       'guardando página, documento e quem preencheu');
    ok(v.exercicio === '2026', `e carimbando o exercício a que o valor pertence (${v.exercicio})`);
    ok(F.estadoDaFicha(f, COM_ANCORA).find(l => l.chave === 'cota_individual_deputado').estado === 'preenchido',
       'o campo passa a "preenchido" — ainda não "conferido"');
  }

  console.log('\n== conferência contra o texto da fonte ==');
  {
    const f = F.fichaVazia('loa', 2026);
    F.preencherCampo(f, 'cota_individual_deputado', { valor: 'R$ 40.252.007,00', documento: 'Manual 2026', pagina: '18' });
    F.preencherCampo(f, 'piso_obras', { valor: 'R$ 250.000,00', documento: 'Manual 2026', pagina: '18' });

    const manual = ('Deputados: R$ 40.252.007,00 ; Senadores: R$ 74.011.755,00. Até 25 emendas por parlamentar. ' +
      'O Substitutivo do PLDO/2026 prevê R$ 200.000,00 para obras e R$ 100.000,00 para demais objetos. ').repeat(4);

    const r = F.conferirFicha(f, manual, 'Manual de Emendas da LOA 2026');
    ok(r.conferida && r.conferidos === 1 && r.divergentes === 1, `1 localizado, 1 não (${JSON.stringify(r)})`);
    const linhas = F.estadoDaFicha(f, COM_ANCORA);
    ok(linhas.find(l => l.chave === 'cota_individual_deputado').estado === 'conferido',
       'a cota real é localizada no Manual');
    // O piso de 2023 permanece na ficha, sinalizado — não se apaga o trabalho
    // de ninguém; sinaliza-se e a decisão é de quem assina.
    ok(linhas.find(l => l.chave === 'piso_obras').estado === 'divergente',
       'o piso de R$ 250.000,00 (valor da LOA 2023) é marcado como não localizado');
    ok(f.valores.piso_obras.valor === 'R$ 250.000,00', 'e o valor NÃO é apagado pela conferência');

    // Editar o campo derruba a conferência: o valor mudou, o carimbo caduca.
    F.preencherCampo(f, 'piso_obras', { valor: 'R$ 200.000,00', documento: 'Manual 2026', pagina: '18' });
    ok(f.valores.piso_obras.conferencia === null, 'reeditar limpa a conferência anterior');
    F.conferirFicha(f, manual, 'Manual de Emendas da LOA 2026');
    ok(F.estadoDaFicha(f, COM_ANCORA).find(l => l.chave === 'piso_obras').estado === 'conferido',
       'e o valor correto passa a conferir');

    // Grafia diferente entre ficha e documento não pode gerar alarme falso.
    const f2 = F.fichaVazia('loa', 2026);
    F.preencherCampo(f2, 'cota_individual_deputado', { valor: '40.252.007,00', documento: 'Manual 2026' });
    F.conferirFicha(f2, manual, 'Manual');
    ok(f2.valores.cota_individual_deputado.conferencia.localizado,
       'a comparação é por dígitos: "40.252.007,00" casa com "R$ 40.252.007,00"');

    const semFonte = F.conferirFicha(F.fichaVazia('loa', 2027), '', 'Manual inexistente');
    ok(!semFonte.conferida && /indispon[íi]vel|ileg[íi]vel/i.test(semFonte.motivo),
       'fonte ilegível não confere nem acusa nada');
  }

  console.log('\n== A ÚLTIMA BARREIRA: valor de outro exercício ==');
  {
    const f = F.fichaVazia('loa', 2027);
    F.preencherCampo(f, 'cota_individual_deputado', { valor: 'R$ 40.252.007,00', documento: 'Manual de Emendas da LOA 2026', pagina: '18' });
    ok(F.valoresDeOutroExercicio(f).length === 0, 'valor preenchido hoje pertence ao exercício da ficha');

    // Simula a ficha de 2026 copiada para 2027 — o caso que a barreira pega.
    f.valores.cota_individual_deputado.exercicio = '2026';
    const herdados = F.valoresDeOutroExercicio(f);
    ok(herdados.length === 1 && herdados[0].exercicio === '2026',
       `denuncia o valor herdado: ${herdados[0]?.rotulo} (${herdados[0]?.exercicio})`);
    ok(/cota/i.test(herdados[0].rotulo), 'nomeando o campo, para o analista saber onde olhar');
  }

  console.log('\n== limpar campo ==');
  {
    const f = F.fichaVazia('loa', 2026);
    F.preencherCampo(f, 'piso_obras', { valor: 'R$ 200.000,00', documento: 'Manual 2026' });
    F.limparCampo(f, 'piso_obras');
    ok(!f.valores.piso_obras, 'o campo volta a vazio');
    ok(F.estadoDaFicha(f, COM_ANCORA).find(l => l.chave === 'piso_obras').estado === 'pendente',
       'e retorna a "a preencher", já que a fonte existe');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
