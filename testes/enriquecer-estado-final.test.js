// Regressão do "Verificando autoria…" ETERNO (visto em produção 12/08/2026):
// enriquecerItem falhava, alguns chamadores engolem o erro com .catch(() => {})
// (Apelidos, Proposições do partido, adição manual) e o item ficava com
// status 'carregando' para sempre — TODOS os cards presos no badge.
// Contrato testado: enriquecerItem NUNCA termina em 'carregando' —
//   - sem cache: falha vira { status: 'erro', erro } e o card é repintado;
//   - com cache (verificação em fundo): falha RESTAURA o enriquecimento salvo.
// Uso: node testes/enriquecer-estado-final.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'analise.js'), 'utf8');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// Isola enriquecerItem com as dependências stubadas.
function montar({ resolve }) {
  const pintados = [];
  const fn = new Function(
    'itemAindaAtivo', 'atualizarBadgesCard', 'atualizarLinkPortal',
    'resolveProposicao', 'fetchAutoresProposicao', 'resolverApensados',
    'buscarPareceresPlenario', 'buscarRedacaoFinal', 'console',
    'return (async()=>{' + src.match(/async function enriquecerItem[\s\S]*?\n}/)[0] + '; return enriquecerItem;})()');
  const enriquecer = fn(
    () => true, it => pintados.push(it.enriquecimento?.status), () => {},
    resolve, async () => [], async () => [],
    async () => ({ comissoes: [] }), async () => null, { ...console, warn() {} });
  return { enriquecer, pintados };
}

(async () => {
  console.log('== falha com chamador que ENGOLE o erro ==');
  {
    const { enriquecer, pintados } = await (async () => {
      const m = montar({ resolve: async () => { throw new Error('a API da Câmara respondeu HTTP 504 (fora do ar) em 4 tentativas'); } });
      return { enriquecer: await m.enriquecer, pintados: m.pintados };
    })();
    const it = { chave: 'PL-1-2025', sigla: 'PL', numero: 1, ano: 2025, tipoCategoria: 'projeto' };
    await enriquecer(it).catch(() => {});      // exatamente como os botões chamam
    ok(it.enriquecimento?.status === 'erro', `estado final é 'erro', não 'carregando' (${it.enriquecimento?.status})`);
    ok(/HTTP 504/.test(it.enriquecimento?.erro || ''), `motivo expresso: ${it.enriquecimento?.erro}`);
    ok(pintados[pintados.length - 1] === 'erro', 'card repintado com o estado final');
  }

  console.log('\n== falha na verificação em fundo → mantém o cache salvo ==');
  {
    const m = montar({ resolve: async () => { throw new Error('HTTP 504'); } });
    const enriquecer = await m.enriquecer;
    const salvo = { status: 'ok', deCache: true, autoriaPodemos: true };
    const it = { chave: 'PL-2-2025', sigla: 'PL', numero: 2, ano: 2025, tipoCategoria: 'projeto', enriquecimento: salvo };
    await enriquecer(it).catch(() => {});
    ok(it.enriquecimento === salvo, 'enriquecimento salvo restaurado (badge de ontem > erro de hoje)');
  }

  console.log('\n== sucesso continua terminando em ok ==');
  {
    const m = montar({ resolve: async () => ({ id: 1, ementa: 'E', urlInteiroTeor: null }) });
    const enriquecer = await m.enriquecer;
    const it = { chave: 'PL-3-2025', sigla: 'PL', numero: 3, ano: 2025, tipoCategoria: 'projeto' };
    await enriquecer(it);
    ok(it.enriquecimento?.status === 'ok', `sucesso termina 'ok' (${it.enriquecimento?.status})`);
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo passou.');
  process.exit(falhas ? 1 : 0);
})();
