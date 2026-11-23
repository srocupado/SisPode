// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Parecer de Especialista novo — o CASO DE REFERÊNCIA, sem API.
//
// O pipeline inteiro (pe5-pipeline.js) roda com o modelo trocado pelas respostas gravadas em
// testes/fixtures/pe5-pl4675 — escritas à mão a partir dos documentos reais do PL 4675/2025 e de pesquisa
// própria, em 17/11/2026 — e com a rede trocada pelos dados gravados da Câmara, do Senado e do Banco
// Central. Serve aos testes (pe5.test.js) e para gerar o PDF de referência:
//   node testes/pe5-referencia.js saida.json        (grava o parecer montado)
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..'), FX = path.join(__dirname, 'fixtures', 'pe5-pl4675');
const ler = f => fs.readFileSync(path.join(FX, f), 'utf8');

const RESPOSTAS = {
  'leitura': 'resposta-leitura.json', 'pesquisa-debate': 'resposta-pesquisa-debate.json', 'pesquisa-internacional': 'resposta-pesquisa-internacional.json',
  'pesquisa-contexto': 'resposta-pesquisa-contexto.json', 'pesquisa-congresso': 'resposta-pesquisa-congresso.json', 'redacao-1': 'resposta-redacao-1.json', 'redacao-2': 'resposta-redacao-2.json',
};

function ioDeReferencia({ respostas = {}, onChamada = null } = {}) {
  const prompts = {};
  return {
    prompts,
    io: {
      chamarModelo: async ({ prompt, etapa, web, pensar }) => {
        prompts[etapa] = prompt;
        if (onChamada) onChamada({ etapa, web, pensar, tamanho: prompt.length });
        // Etapas criadas em 21 e 22/11/2026: a leitura dos documentos de apoio devolve os grupos dela, tirados da mesma
        // leitura gravada; as buscas do debate dos outros grupos voltam vazias (a junção fica igual à busca única);
        // a complementar não acrescenta nada; "Quem se posicionou e como" (redacao-1c) sai da mesma resposta gravada.
        const apoio = () => { const L = JSON.parse(ler(RESPOSTAS.leitura)); return JSON.stringify({ emendas: L.emendas || [], justificativa: L.justificativa || [], estimativas: L.estimativas || [], referencias: L.referencias || [], controversias: [], achados: [], ausencias: [] }); };
        // a redação vai em quatro chamadas; as respostas gravadas (duas metades) servem às duas partes de cada metade
        const texto = etapa in respostas ? respostas[etapa] : /^redacao-(1[bc]|2b)$/.test(etapa) && etapa.slice(0, -1) in respostas ? respostas[etapa.slice(0, -1)] : etapa === 'revisao' ? '{"correcoes":[],"observacoes":[]}' : etapa === 'leitura-apoio' ? apoio() : /^pesquisa-debate-/.test(etapa) ? '{"atores":[],"controversias":[],"avisos":[]}' : etapa === 'pesquisa-complementar' ? '{"jurisdicoes":[],"jurisprudencia":[],"avisos":["nada a acrescentar"]}' : ler(RESPOSTAS[etapa.replace(/^(redacao-1)[bc]$/, '$1').replace(/^(redacao-2)b$/, '$1')]);
        // o modelo de verdade às vezes embrulha o JSON em cerca de código: o pipeline tem de aguentar
        return { text: etapa === 'redacao-1' ? '```json\n' + texto + '\n```' : texto, truncated: false, usage: { entrada: Math.round(prompt.length / 4), saida: Math.round(texto.length / 4), raciocinio: 0, total: Math.round((prompt.length + texto.length) / 4) } };
      },
      lerPdf: async buffer => ler(String(buffer)),
      fetchFn: async url => {
        const u = String(url);
        const json = o => ({ ok: true, status: 200, url: u, json: async () => o, arrayBuffer: async () => Buffer.from(JSON.stringify(o)) });
        if (/api\.bcb\.gov\.br/.test(u)) { const v = { '.1/': '5.7324', '.21619/': '6.3102', '.21623/': '7.5599', '.21621/': '0.03593' }; const k = Object.keys(v).find(x => u.includes('sgs' + x)); return json([{ data: '16/11/2026', valor: v[k] }]); }
        // a lei: só o Planalto "responde" (em ISO-8859-1, como o site de verdade)
        if (/planalto\.gov\.br/.test(u) && /12529/i.test(u)) { const html = '<html><body>' + ler('lei-12529.txt').split('\n').map(l => `<p>${l}</p>`).join('\n') + '</body></html>'; const buf = Buffer.from(html, 'latin1'); return { ok: true, status: 200, url: u, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; }
        return { ok: false, status: 404, url: u, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      },
    },
  };
}

function ctxDeReferencia() {
  const G = JSON.parse(ler('coleta.json'));
  return { identificacao: 'PL 4675/2025', sigla: 'PL', numero: '4675', ano: '2025', ementa: G.proposicao.ementa, idProposicao: 2562481, coletaPronta: G,
    docs: [{ rotulo: 'PRLP nº 1 de 08/07/2026', url: 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3159491', buffer: 'doc-prlp.txt' },
      { rotulo: 'Redação original (inteiro teor)', url: 'https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=3003060', buffer: 'doc-original.txt' }],
    temas: [{ codTema: 40 }, { codTema: 66 }], hoje: new Date('2026-11-17T15:00:00Z'), geradoPor: 'caso de referência', textoEmVotacao: 'PRLP nº 1 de 08/07/2026' };
}

async function gerarReferencia(opcoes = {}) {
  const { gerarParecerPE5 } = require(path.join(RAIZ, 'pe5-pipeline.js'));
  const r = ioDeReferencia(opcoes);
  const p = await gerarParecerPE5({ ...ctxDeReferencia(), ...(opcoes.ctx || {}) }, { ...r.io, ...(opcoes.io || {}) });
  return { p, prompts: r.prompts };
}

module.exports = { gerarReferencia, ioDeReferencia, ctxDeReferencia, FX };

if (require.main === module) {
  gerarReferencia().then(({ p }) => {
    if (p.erro) { console.log('ERRO:', p.erro); process.exit(1); }
    p.modelo = 'caso de referência (respostas redigidas sem IA)';
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(p));
    console.log(`trechos: ${p.trechos.conferidos} conferidos, ${p.trechos.recusados.length} recusados | chamadas: ${p.chamadas.map(c => c.nome).join(', ')}`);
    console.log(p.conferencia.resumo);
    for (const i of p.conferencia.itens) console.log(` ${i.ok ? '✓' : (i.critico ? '✗!' : '✗')} ${i.teste}${i.detalhe ? ' — ' + i.detalhe : ''}`);
  }).catch(e => { console.log('ERRO', e.stack); process.exit(1); });
}
