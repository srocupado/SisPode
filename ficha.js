/* ============================================================
   FICHA DE PARÂMETROS — os números operacionais de um exercício

   A nota técnica orçamentária vive de uma dúzia de números: quanto cada
   parlamentar pode emendar, quantas emendas, em que prazo, com quais
   sequenciais de cancelamento, a partir de que piso de repasse. Errar um
   deles não produz uma nota imprecisa — produz uma emenda inválida.

   POR QUE A FICHA NASCE VAZIA, E COM PROCEDÊNCIA OBRIGATÓRIA

   Todo campo existe desde o primeiro dia do exercício, marcado como
   "aguardando". Isso é deliberado: uma ficha que só mostrasse o que já tem
   deixaria o analista sem saber o que falta. E nenhum campo aceita valor sem
   documento e página — porque a tentação real é herdar o número do ano
   passado, e a medição de 03/09/2026 mostra o tamanho do estrago que isso
   faria: a cota individual por deputado era R$ 19.704.897,00 na LOA 2023 e é
   R$ 40.252.007,00 na LOA 2026. Dobrou. Um número desses, herdado em
   silêncio, passaria despercebido numa leitura rápida.

   O QUE É ESTÁVEL ENTRE EXERCÍCIOS (medido em 2025, 2026 e 2027): a LISTA de
   campos e as 10 etapas da tramitação. Nada mais. O cronograma muda de
   composição (13 itens em 2025, 16 em 2026) e nem o Manual de Emendas é
   garantido — a LOA 2025 orientou por "Instruções para elaboração de emendas
   no LEXOR". Por isso a ficha reaproveita o ESQUEMA e nunca o VALOR.

   ESTADOS DE UM CAMPO
     aguardando  — a fonte do exercício ainda não foi publicada; não há o que
                   preencher, e isso é informação, não lacuna.
     pendente    — a fonte existe e o campo continua vazio: é trabalho a fazer.
     preenchido  — tem valor, documento e página.
     conferido   — além disso, o valor foi LOCALIZADO no texto da fonte.
     divergente  — o valor NÃO foi localizado no texto da fonte. Não se apaga
                   nada: sinaliza-se, e a decisão é do analista.

   A conferência (normas.js) só diz se o valor CONSTA do documento. Constar não
   prova que se aplique ao caso — a ressalva vai junto na tela e na nota.
   ============================================================ */

'use strict';

/**
 * O esqueleto da ficha. `origem` diz de onde o valor deve sair, e é o que a
 * tela mostra enquanto o campo está aguardando.
 *   auto      — o próprio módulo preenche do que já leu (cronograma, PLOA)
 *   ancora    — Manual de Emendas do exercício (ou a orientação equivalente)
 *   ploa      — texto do projeto / Mensagem Presidencial
 */
const CAMPOS_FICHA = [
  // ---- Emendas individuais (RP6) ----
  { chave: 'qtd_emendas_individuais', grupo: 'Emendas individuais (RP6)', rotulo: 'Quantidade máxima por parlamentar',
    tipo: 'inteiro', origem: 'ancora', ajuda: 'Número de emendas individuais que cada parlamentar pode apresentar.' },
  { chave: 'cota_individual_deputado', grupo: 'Emendas individuais (RP6)', rotulo: 'Cota por deputado',
    tipo: 'moeda', origem: 'ancora', ajuda: 'Valor total das emendas impositivas individuais de cada deputado.' },
  { chave: 'cota_individual_senador', grupo: 'Emendas individuais (RP6)', rotulo: 'Cota por senador',
    tipo: 'moeda', origem: 'ancora', ajuda: 'A cota do Senado difere da da Câmara — não se deduz uma da outra.' },
  { chave: 'cota_individual_saude', grupo: 'Emendas individuais (RP6)', rotulo: 'Parcela obrigatória em saúde',
    tipo: 'texto', origem: 'ancora', ajuda: 'Fração da cota individual de aplicação obrigatória em ações e serviços públicos de saúde (art. 166, § 9º, da CF).' },
  { chave: 'sequenciais_individual', grupo: 'Emendas individuais (RP6)', rotulo: 'Sequenciais de cancelamento',
    tipo: 'texto', origem: 'ancora', ajuda: 'Sequenciais usados na elaboração da emenda (ex.: saúde e demais ministérios).' },

  // ---- Emendas de bancada estadual (RP7) ----
  { chave: 'cota_bancada', grupo: 'Emendas de bancada (RP7)', rotulo: 'Cota por bancada estadual',
    tipo: 'moeda', origem: 'ancora', ajuda: 'Valor por bancada, resultado da divisão do total reservado pelas 27 unidades da federação.' },
  { chave: 'qtd_emendas_bancada', grupo: 'Emendas de bancada (RP7)', rotulo: 'Quantidade de emendas por bancada',
    tipo: 'inteiro', origem: 'ancora' },
  { chave: 'sequenciais_bancada', grupo: 'Emendas de bancada (RP7)', rotulo: 'Sequenciais de cancelamento',
    tipo: 'texto', origem: 'ancora' },

  // ---- Relator-geral e reserva ----
  { chave: 'limite_relator_geral', grupo: 'Relator-Geral e reserva', rotulo: 'Limite das emendas de Relator-Geral (RP9)',
    tipo: 'moeda', origem: 'ancora', ajuda: 'Fixado no parecer preliminar; não pode superar a soma das individuais e de bancada.' },
  { chave: 'reserva_emendas_total', grupo: 'Relator-Geral e reserva', rotulo: 'Reserva para emendas no projeto',
    tipo: 'moeda', origem: 'ploa', ajuda: 'Montante global reservado no PLOA — NÃO é a cota de ninguém.' },

  // ---- Execução ----
  { chave: 'piso_custeio', grupo: 'Execução das emendas', rotulo: 'Valor mínimo de repasse — custeio e equipamentos',
    tipo: 'moeda', origem: 'ancora', ajuda: 'Piso para celebração de instrumentos. A base legal migrou da Portaria Interministerial para a LDO de cada exercício — confira o fundamento junto com o valor.' },
  { chave: 'piso_obras', grupo: 'Execução das emendas', rotulo: 'Valor mínimo de repasse — obras e engenharia',
    tipo: 'moeda', origem: 'ancora', ajuda: 'Era R$ 250.000,00 na LOA 2023 e R$ 200.000,00 na LOA 2026: muda de exercício para exercício.' },
  { chave: 'transferencias_especiais', grupo: 'Execução das emendas', rotulo: 'Transferências especiais — regra de capital',
    tipo: 'texto', origem: 'ancora', ajuda: 'Percentual mínimo em despesas de capital (art. 166-A, § 5º, da CF).' },
  { chave: 'sistema_lexor', grupo: 'Execução das emendas', rotulo: 'Sistema de apresentação (LEXOR)',
    tipo: 'texto', origem: 'ancora', ajuda: 'Endereço e janela de funcionamento do sistema.' },

  // ---- Prazo (o módulo já lê do cronograma) ----
  { chave: 'prazo_emendas', grupo: 'Prazo', rotulo: 'Prazo de apresentação de emendas',
    tipo: 'periodo', origem: 'auto', ajuda: 'Vem do cronograma aprovado pela Comissão Mista.' },

  // ---- Parâmetros macroeconômicos ----
  { chave: 'pib', grupo: 'Parâmetros macroeconômicos', rotulo: 'Crescimento do PIB', tipo: 'texto', origem: 'ploa' },
  { chave: 'ipca', grupo: 'Parâmetros macroeconômicos', rotulo: 'IPCA', tipo: 'texto', origem: 'ploa' },
  { chave: 'selic', grupo: 'Parâmetros macroeconômicos', rotulo: 'Taxa Selic média', tipo: 'texto', origem: 'ploa' },
  { chave: 'cambio', grupo: 'Parâmetros macroeconômicos', rotulo: 'Taxa de câmbio média', tipo: 'texto', origem: 'ploa' },
  { chave: 'salario_minimo', grupo: 'Parâmetros macroeconômicos', rotulo: 'Salário mínimo', tipo: 'moeda', origem: 'ploa' },
];

const GRUPOS_FICHA = [...new Set(CAMPOS_FICHA.map(c => c.grupo))];

/** Ficha vazia — todos os campos existem desde o primeiro dia do exercício. */
function fichaVazia(tipo, ano) {
  return { tipo, ano: String(ano), valores: {}, atualizadaEm: null, atualizadaPor: null };
}

/**
 * Um valor só entra com PROCEDÊNCIA. Sem documento, o preenchimento é
 * recusado — é esta recusa que impede o número do ano passado de entrar
 * "só para não deixar em branco".
 * Devolve { ok } ou { ok:false, erro }.
 */
function preencherCampo(ficha, chave, dados = {}) {
  const campo = CAMPOS_FICHA.find(c => c.chave === chave);
  if (!campo) return { ok: false, erro: `Campo desconhecido: ${chave}` };
  const valor = String(dados.valor ?? '').trim();
  const documento = String(dados.documento ?? '').trim();
  if (!valor) return { ok: false, erro: 'Informe o valor.' };
  if (!documento) return { ok: false, erro: 'Informe o documento de origem — a ficha não aceita valor sem procedência.' };

  ficha.valores[chave] = {
    valor,
    documento,
    pagina: String(dados.pagina ?? '').trim() || null,
    trecho: String(dados.trecho ?? '').trim() || null,
    exercicio: String(ficha.ano),          // carimba o exercício a que o valor pertence
    preenchidoPor: dados.preenchidoPor || 'equipe',
    preenchidoEm: new Date().toISOString(),
    conferencia: null,                      // some ao editar: o valor mudou, a conferência caduca
  };
  ficha.atualizadaEm = new Date().toISOString();
  ficha.atualizadaPor = dados.preenchidoPor || 'equipe';
  return { ok: true };
}

function limparCampo(ficha, chave) {
  delete ficha.valores[chave];
  ficha.atualizadaEm = new Date().toISOString();
}

/**
 * Estado de cada campo, dado o que o exercício já publicou.
 * `fontes` = { ancora: bool, ploa: bool, auto: valor|null }.
 */
function estadoDaFicha(ficha, fontes = {}) {
  return CAMPOS_FICHA.map(campo => {
    const v = ficha.valores[campo.chave];
    const auto = campo.origem === 'auto' ? fontes.auto?.[campo.chave] : null;
    if (auto) {
      return { ...campo, estado: 'conferido', valor: auto, documento: 'cronograma publicado pela CMO',
               automatico: true, pagina: null, trecho: null };
    }
    if (!v) {
      // Fonte ainda não publicada não é lacuna do analista: é o exercício que
      // ainda não chegou lá. A distinção muda o que a tela cobra de quem lê.
      const fontePronta = campo.origem === 'ancora' ? !!fontes.ancora
        : campo.origem === 'ploa' ? !!fontes.ploa : false;
      return { ...campo, estado: fontePronta ? 'pendente' : 'aguardando', valor: null };
    }
    const estado = !v.conferencia ? 'preenchido' : (v.conferencia.localizado ? 'conferido' : 'divergente');
    return { ...campo, estado, valor: v.valor, documento: v.documento, pagina: v.pagina,
             trecho: v.trecho, exercicio: v.exercicio, conferencia: v.conferencia };
  });
}

/** Contagem por estado, para o resumo da tela e da nota. */
function resumoDaFicha(ficha, fontes = {}) {
  const linhas = estadoDaFicha(ficha, fontes);
  const conta = e => linhas.filter(l => l.estado === e).length;
  return {
    total: linhas.length,
    aguardando: conta('aguardando'),
    pendente:   conta('pendente'),
    preenchido: conta('preenchido'),
    conferido:  conta('conferido'),
    divergente: conta('divergente'),
    completa:   conta('aguardando') + conta('pendente') === 0,
  };
}

/**
 * Confere os valores preenchidos contra o TEXTO da fonte do exercício. Não
 * corrige nada: marca `localizado` e deixa a decisão com quem assina a nota.
 *
 * Compara pelos dígitos, porque a grafia varia entre o documento e a ficha
 * ("R$ 40.252.007,00", "40.252.007,00", "R$40.252.007").
 */
function conferirFicha(ficha, textoFonte, rotuloFonte = 'documento do exercício') {
  if (!textoFonte || textoFonte.length < 500) {
    return { conferida: false, motivo: `Fonte indisponível ou ilegível (${rotuloFonte}) — nada foi conferido.` };
  }
  const fonte = String(textoFonte).replace(/\s+/g, ' ');
  const digitos = s => String(s).replace(/[^\d]/g, '');
  const numerosFonte = new Set((fonte.match(/\d[\d.,]*\d|\d/g) || []).map(digitos).filter(Boolean));

  let conferidos = 0, divergentes = 0;
  for (const [chave, v] of Object.entries(ficha.valores)) {
    const alvo = digitos(v.valor);
    // Valor sem dígito nenhum (texto livre) é procurado literalmente.
    const localizado = alvo
      ? numerosFonte.has(alvo)
      : fonte.toLowerCase().includes(String(v.valor).toLowerCase().slice(0, 40));
    v.conferencia = { localizado, fonte: rotuloFonte, em: new Date().toISOString() };
    localizado ? conferidos++ : divergentes++;
    void chave;
  }
  return { conferida: true, rotuloFonte, conferidos, divergentes };
}

/**
 * Valores que NÃO pertencem a este exercício. Só aparece se alguém tiver
 * copiado a ficha de um ano para outro — a última barreira contra o número
 * herdado, depois da procedência obrigatória.
 */
function valoresDeOutroExercicio(ficha) {
  return Object.entries(ficha.valores)
    .filter(([, v]) => v.exercicio && String(v.exercicio) !== String(ficha.ano))
    .map(([chave, v]) => ({ chave, exercicio: v.exercicio,
      rotulo: CAMPOS_FICHA.find(c => c.chave === chave)?.rotulo || chave }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CAMPOS_FICHA, GRUPOS_FICHA, fichaVazia, preencherCampo, limparCampo,
    estadoDaFicha, resumoDaFicha, conferirFicha, valoresDeOutroExercicio,
  };
}
