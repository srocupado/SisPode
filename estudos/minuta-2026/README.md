# Estudo: o PODEMOS no distrital misto da Versão Minuta

Scripts do estudo "O Podemos no distrital misto da Versão Minuta: onde crescer" (novembro de 2026).
Os dados não ficam no repositório: são públicos (TSE e IBGE) e se refazem com os scripts abaixo.

## Ordem de execução

Os scripts usam uma pasta de trabalho com `dados/`, `tse/`, `resultados/` e `pdf/` ao lado de `scripts/`.

1. `exportar.js <perfil-do-chromium> <dados> UF,...`: abre o simulador (extensão carregada no Chromium), aplica a regra da Minuta e exporta, por UF, os dados, o desenho e os votos, para deputado federal e estadual.
2. `exportar-finos.js`: o mesmo, com todas as unidades divididas nos locais de votação (a base dos mapas alternativos).
3. `reduzir-tse.js <tse>`: reduz os arquivos do TSE baixados (votação por partido 2018/2022/2026; candidatos 2020/2024) a JSON por município.
4. `estudo1.js`: cota pelas maiores médias, votos para a próxima cadeira, folga e frequência histórica (`volatilidade.js`, `partidos.js`, `dhondt.js`).
5. `rodar-ensemble.js UF,... [M]`: o desenho do simulador + M desenhos alternativos por UF (multi-início aleatório, semente fixa por UF). Em cada um, roda a Minuta (federal, estadual e federações) com o motor do simulador (`sistemas-distrital.js`, `sistemas-nucleo.js`).
6. `agregar.js`: estudos 1 (robustez), 2, 3 e 5.
7. `preparar-46.js`, depois `python3 estudo4_rd.py <resultados>` (regressão descontínua) e `python3 estudo6_perfil.py <resultados>` (regressão do perfil); depois `estudo4_oportunidades.js`.
8. `metricas-extra.js` (qualidade dos desenhos, volatilidade, posições) e `gerar-artigo.js`: o artigo em PDF, na identidade visual dos relatórios do sistema (`pdf-base.js`). `gerar-pdf.js` gera a versão resumida, só com tabelas.

Dependências: Node 22, Playwright com Chromium (passos 1, 2 e 8), Python 3 com numpy, pandas e statsmodels (passo 7).
