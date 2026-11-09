'use strict';
// Gera o HTML do estudo (identidade visual da Liderança) e o PDF (Playwright, A4 deitado).
const fs = require('fs'), path = require('path');
const B = require('./pdf-base.js'), { C, esc, fmt, pct, pp, barras, graficoRD } = B;
const R = path.join(__dirname, '..', 'resultados');
const J = n => JSON.parse(fs.readFileSync(path.join(R, n), 'utf8'));
const e1 = J('estudo1.json'), ag = J('agregado.json'), e4 = J('estudo4.json'), op = J('estudo4-oportunidades.json'), e6 = J('estudo6.json');
const UFN = { AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins' };
const hoje = '06/11/2026';
const nac = ag.nacional, aU = Object.fromEntries(ag.ufs.map(u => [u.uf, u]));
const comLista = e1.ufs.filter(o => o.temLista);
const baratas = comLista.slice().sort((a, b) => a.paraGanharPct - b.paraGanharPct);
const frageis = comLista.filter(o => o.paraPerder != null).sort((a, b) => a.paraPerderPct - b.paraPerderPct);
const P4 = e4.principal, ic = r => `IC 95%: ${pp(r.ic[0])} a ${pp(r.ic[1])}`;
const feds = Object.entries(ag.federacao).map(([p, g]) => Object.assign({ p }, g)).sort((a, b) => b.dSoma - a.dSoma || b.dPode - a.dPode);
const somaV = k => ag.ufs.reduce((s, u) => s + (u[k] ? u[k].media : 0), 0);
const meta = { titulo: 'O PODEMOS NO DISTRITAL MISTO DA VERSÃO MINUTA: ONDE CRESCER', sub: `Deputados federais e estaduais • votos oficiais de 2026 • ${ag.ufs.length} UFs • ${fmt(ag.ufs.reduce((s, u) => s + u.mapas, 0))} desenhos de distritos • Dados oficiais do TSE e do IBGE`,
  selo: `PODEMOS: ${fmt(nac.cadeiras.simulador)} CADEIRAS`, seloSub: `na Minuta • faixa ${nac.cadeiras.min}–${nac.cadeiras.max} entre mapas • cota ${e1.nacional.cota}`, emissao: hoje };
const pags = [];
const pg = html => pags.push(html.replace(/<(\/?)h2>/g, '<$1h3>').replace(/<(\/?)h1>/g, '<$1h2>'));

// ---------------------------------------------------------------- 1. Resumo
pg(`<h1>Resumo</h1>
<div class="cards" style="--n:4">
 <div><div class="t">Bancada federal na Minuta</div><div class="v">${fmt(nac.cadeiras.simulador)}</div><div class="l">faixa de ${nac.cadeiras.min} a ${nac.cadeiras.max} entre os mapas • oficial: ${e1.nacional.real}</div></div>
 <div><div class="t">Próximas cadeiras mais baratas</div><div class="v">${baratas.slice(0, 3).map(o => o.uf).join(' • ')}</div><div class="l">${baratas.slice(0, 3).map(o => `${o.uf}: +${fmt(o.paraGanhar)} votos`).join(' • ')}</div></div>
 <div><div class="t">Efeito de governar a prefeitura</div><div class="v">${pp(P4.tau)}</div><div class="l">na fatia do partido para deputado federal no município • ${ic(P4)}</div></div>
 <div><div class="t">Distritos vencidos / ao alcance</div><div class="v">${fmt(nac.vence.media, 1)} / ${fmt(nac.alcance.media, 1)}</div><div class="l">média entre os mapas (federal) • ao alcance = 2º lugar a até 5 p.p.</div></div>
</div>
<p><b>Pergunta.</b> Se a Câmara aprovar o distrital misto da Versão Minuta, onde o PODEMOS pode crescer? O estudo aplica a regra da Minuta aos votos oficiais de 2026, em todos os estados, para deputado federal e estadual, e mede a robustez de cada conclusão a ${fmt(Math.round(ag.ufs.reduce((s, u) => s + u.mapas, 0) / ag.ufs.length))} desenhos de distritos diferentes por estado, todos dentro das regras de tamanho e contiguidade da Minuta.</p>
<h2>Principais achados</h2>
<ol>
<li><b>A bancada depende do voto total no estado, não dos distritos.</b> A Minuta é compensatória: a cota de cada partido sai das maiores médias sobre o total de votos. A bancada federal simulada fica em ${fmt(nac.cadeiras.simulador)} (de ${nac.cadeiras.min} a ${nac.cadeiras.max} conforme o mapa), perto da cota de ${e1.nacional.cota}. O crescimento vem de votos onde a próxima cadeira está perto: ${baratas.slice(0, 5).map(o => `${o.uf} (+${fmt(o.paraGanhar)}, ${pct(o.paraGanharPct, 0)} da votação atual)`).join('; ')}.</li>
<li><b>Cadeiras frágeis.</b> ${frageis.slice(0, 4).map(o => `${o.uf} perde a última cadeira com ${fmt(o.paraPerder)} votos a menos (${pct(o.paraPerderPct, 0)})`).join('; ')}. Defender essas votações rende tanto quanto conquistar as próximas.</li>
<li><b>Voto único concentra o partido num nome por distrito.</b> Em média, ${pct(ag.ufs.reduce((s, u) => s + u.votosRisco.media, 0) / ag.ufs.reduce((s, u) => s + u.podeNominal.media, 0), 0)} dos votos nominais do PODEMOS em 2026 foram para candidatos que não seriam o nome do partido no seu distrito: esses votos precisam migrar para o candidato do distrito ou para a legenda.</li>
<li><b>Assembleias são o terreno mais favorável.</b> Nos distritos com várias cadeiras (leitura da Minuta para estaduais), o PODEMOS elege em média ${fmt(ag.ufs.reduce((s, u) => s + (u.estadual ? u.estadual.distritoElege.media : 0), 0), 1)} deputados estaduais pelo distrito, contra ${fmt(nac.vence.media, 1)} distritos federais vencidos.</li>
<li><b>Prefeituras transferem votos — nas cidades pequenas e médias.</b> Por regressão descontínua sobre ${fmt(e4.municipios_total)} disputas de 2024, governar a prefeitura aumenta em ${pp(P4.tau)} a fatia do partido para deputado federal no município (${ic(P4)}; placebo 2018→2022 nulo). O efeito vem dos municípios de até 50 mil votos; acima disso, não se distingue de zero.</li>
<li><b>O perfil socioeconômico explica pouco do voto do PODEMOS.</b> Com os indicadores do TSE e do Censo, o R² fora da amostra passa de ${fmt(e6.cv.r2_ufs, 2)} (só o estado) para ${fmt(e6.cv.r2_perfil, 2)}. O voto do partido é de candidato e de base local, não de perfil: as oportunidades estão em recrutar nomes e prefeituras, não num público-alvo demográfico.</li>
</ol>
<div class="caixa">Estudo técnico com dados públicos (TSE e IBGE). Simula a regra com os votos dados no sistema atual: eleitores e partidos se comportariam de outro jeito no distrital misto. Os números são o ponto de partida, não previsão.</div>`);

// ---------------------------------------------------------------- 2. Regra, dados e métodos
pg(`<h1>1. A regra simulada e os dados</h1>
<div class="duas"><div>
<h2>A Versão Minuta, como simulada</h2>
<ul>
<li><b>Voto único</b>, no candidato do distrito ou na legenda. Cada partido lança um candidato por distrito; os nomes da lista preordenada não recebem voto nominal.</li>
<li><b>Metade das vagas em distritos</b> (arredondada para cima), desenhados pela população do Censo 2022, com desvio de até ±5% (±10% em 1 distrito ou em 10% deles), contíguos e compactos.</li>
<li><b>Vence o distrito</b> o candidato com mais votos nominais.</li>
<li><b>Cota compensatória:</b> cada partido (ou federação) recebe as cadeiras pelas maiores médias (D'Hondt) sobre nominais + legenda no estado; os vencedores de distrito entram primeiro e o restante vem da lista.</li>
<li><b>Excedente:</b> quem vence mais distritos do que a cota fica com eles, e as cadeiras saem de outros partidos, na ordem inversa das suas listas, sem aumentar a Casa.</li>
<li><b>Estaduais:</b> elegem-se nos distritos federais, cada um com várias cadeiras (as da Assembleia em distritos, repartidas pelo tamanho), até 3 do mesmo partido nas UFs com até 20 deputados federais e até 2 nas demais. A Minuta não diz quantos vencem por distrito; esta é uma leitura.</li>
</ul>
<p class="peq">Na falta das listas preordenadas reais, a lista de cada partido segue a ordem de votos. Isso muda <i>quem</i> ocupa as cadeiras de lista, não <i>quantas</i> o partido tem.</p>
</div><div>
<h2>Dados</h2>
<table><tr><th>Fonte</th><th>Uso</th></tr>
<tr><td>TSE — votação oficial de 2026 (servidor de resultados e votação por seção)</td><td>Votos de cada candidato e legenda por município, zona e local de votação</td></tr>
<tr><td>TSE — eleitorado e locais de votação 2026</td><td>Unidades do desenho dos distritos (municípios, zonas, ${fmt(94996)} locais)</td></tr>
<tr><td>IBGE — Censo 2022 e malha municipal</td><td>População de cada município (tamanho dos distritos), contiguidade; perfil por setor censitário</td></tr>
<tr><td>TSE — perfil do eleitorado por seção 2026</td><td>Escolaridade, idade e deficiência por local de votação (Estudo 6)</td></tr>
<tr><td>TSE — votação por município 2018, 2022, 2026 (deputado federal)</td><td>Variação da fatia dos partidos; volatilidade histórica (Estudos 1 e 4)</td></tr>
<tr><td>TSE — eleições municipais 2020 e 2024</td><td>Prefeitos e vereadores; margem da disputa decisiva (Estudo 4)</td></tr>
</table>
<p class="peq">Partidos comparados entre eleições pela linhagem registrada no TSE (fusões e incorporações): PSC→PODEMOS (2023), PHS→PODEMOS (2019), DEM+PSL→UNIÃO, PTB+PATRIOTA→PRD, PROS→SOLIDARIEDADE, PR→PL, PRB→REPUBLICANOS, PPS→CIDADANIA.</p>
</div></div>`);

pg(`<h1>2. Métodos</h1>
<div class="duas"><div>
<h2>Simulação</h2>
<p>A regra é aplicada pelo motor do simulador de sistemas eleitorais da Liderança, o mesmo que reproduz exatamente o resultado oficial do TSE na regra vigente. Para este estudo, o motor foi rodado fora do navegador sobre os dados exportados, e o resultado foi conferido com o da tela em cada estado (mesmos eleitos).</p>
<h2>Muitos mapas, não um</h2>
<p>O mapa dos distritos ainda não existe, e um resultado que só aparece num desenho não serve. Para cada estado geramos <b>${fmt(Math.round(ag.ufs.reduce((s, u) => s + u.mapas, 0) / ag.ufs.length))} desenhos</b>: o do simulador e ${fmt(Math.round(ag.ufs.reduce((s, u) => s + u.mapas, 0) / ag.ufs.length) - 1)} alternativos, obtidos pelo mesmo algoritmo de bisseção e refinamento sobre coordenadas dos municípios perturbadas ao acaso (multi-início aleatório). Todos têm as unidades no nível do local de votação, respeitam a tolerância de tamanho da Minuta e são contíguos. Cada conclusão vem com a sua faixa entre os mapas.</p>
<p class="peq">O conjunto não é uma amostra uniforme de todos os mapas possíveis (para isso, cadeias de Markov como a ReCom); mede a sensibilidade das conclusões a desenhos razoáveis e diferentes entre si.</p>
</div><div>
<h2>Inferência</h2>
<ul>
<li><b>Estudo 1:</b> margens exatas pelas maiores médias (votos a mais para a próxima cadeira, com os demais fixos) e frequência histórica: entre ${fmt(e1.historico.pares)} pares partido–UF de 2018→2022 e 2022→2026, de tamanho parecido, a proporção que cresceu (ou caiu) ao menos o necessário, com intervalo de Wilson.</li>
<li><b>Estudo 4:</b> regressão descontínua na margem da disputa decisiva pela prefeitura em 2024. Cada município entra duas vezes (o partido que venceu, com margem +m, e o que perdeu, com −m). Desfecho: variação da fatia do partido para deputado federal no município, 2022→2026. Regressão local linear, kernel triangular, janela principal de 10 p.p., erros agrupados por município; placebo com 2018→2022.</li>
<li><b>Estudo 6:</b> regressão logística fracionária (pesos: votos válidos) da fatia do PODEMOS sobre 14 indicadores padronizados e efeitos fixos de UF; validação cruzada em 5 partes.</li>
</ul>
<h2>Limiares declarados antes</h2>
<p class="peq">Distrito <b>vencido</b>: o melhor nome do PODEMOS é o 1º. <b>Ao alcance</b>: 2º a até 5 p.p. do 1º. <b>Votos em risco</b>: o partido tem ≥ 5% do distrito e o seu melhor nome reúne menos da metade dos votos nominais do partido ali. <b>Vazio</b>: o partido tem menos de 2% do distrito.</p>
<h2>Reprodutibilidade</h2>
<p class="peq">Scripts, sementes aleatórias e dados intermediários ficam com a equipe técnica; todas as fontes são públicas.</p>
</div></div>`);

// ---------------------------------------------------------------- Estudo 1
// ---------------------------------------------------------------- Estudo 1
const linhas1 = comLista.filter(o => o.cota > 0 || o.paraGanharPct <= 1).sort((a, b) => a.paraGanharPct - b.paraGanharPct);
const fora1 = e1.ufs.filter(o => !linhas1.includes(o));
const icTxt = v => `<span style="color:${C.cinza}">(${pct(v[0], 0)}–${pct(v[1], 0)})</span>`;
pg(`<h1>3. Estudo 1 — A cota na Minuta e a próxima cadeira</h1>
<table><tr><th>UF</th><th class="n">Vagas</th><th class="n">Votos do partido</th><th class="n">Fatia</th><th class="n">Eleitos oficiais</th><th class="n">Cota na Minuta</th><th class="n">Cadeiras nos mapas</th><th class="n">+1 cadeira com</th><th class="n">Folga da última</th><th class="n">Histórico: cresceu isso</th><th class="n">Histórico: caiu isso</th></tr>
${linhas1.map(o => { const a = aU[o.uf]; return `<tr${o.paraGanharPct <= 0.25 ? ' class="pode"' : ''}><td>${UFN[o.uf]}</td><td class="n">${o.vagas}</td><td class="n">${fmt(o.votos)}</td><td class="n">${pct(o.fatia)}</td><td class="n">${o.real}</td><td class="n">${o.cota}</td><td class="n">${a ? (a.cadeiras.min === a.cadeiras.max ? a.cadeiras.min : a.cadeiras.min + '–' + a.cadeiras.max) : '—'}</td><td class="n">${fmt(o.paraGanhar)} (${pct(o.paraGanharPct, 0)})</td><td class="n">${o.paraPerder != null ? fmt(o.paraPerder) + ' (' + pct(o.paraPerderPct, 0) + ')' : '—'}</td><td class="n">${pct(o.hist.fGanha, 0)} ${icTxt(o.hist.icGanha)}</td><td class="n">${o.paraPerder != null ? pct(o.hist.fPerde, 0) + ' ' + icTxt(o.hist.icPerde) : '—'}</td></tr>`; }).join('')}
<tr class="pode"><td>Brasil</td><td></td><td class="n">${fmt(e1.nacional.votos)}</td><td></td><td class="n">${e1.nacional.real}</td><td class="n">${e1.nacional.cota}</td><td class="n">${nac.cadeiras.min}–${nac.cadeiras.max}</td><td colspan="4"></td></tr></table>
<p class="nota">Votos do partido = nominais + legenda. "+1 cadeira com" e "Folga": votos a mais (ou a menos) que mudam a cota, com os outros partidos fixos, e a proporção da votação atual. "Histórico": proporção dos pares partido–UF de tamanho parecido que, de uma eleição para a seguinte (2018→2022, 2022→2026), cresceram ou caíram ao menos isso (IC 95% de Wilson). Destacados: próxima cadeira com até 25% a mais de votos. Fora da tabela, sem cadeira nem chance próxima: ${fora1.map(o => `${o.uf} (${o.votos ? pct(o.fatia) : 'sem lista'})`).join(', ')}.</p>`);
pg(`<!--cont--><h1>3.1 Estudo 1 — Onde a cadeira está perto, onde está em risco</h1>
<div class="fig"><div class="ft">Votos a mais para a próxima cadeira (% da votação atual de 2026)</div>${barras(linhas1.map(o => ({ rot: UFN[o.uf], v: o.paraGanharPct, destaque: o.paraGanharPct <= 0.25 })), { larg: 680, fmtv: v => pct(v, 0), rotLarg: 115 })}</div>
<div class="fig"><div class="ft">Folga da última cadeira (% da votação atual)</div>${barras(frageis.map(o => ({ rot: UFN[o.uf], v: o.paraPerderPct, destaque: o.paraPerderPct <= 0.10 })), { larg: 680, fmtv: v => pct(v, 0), rotLarg: 115, corD: C.cai })}</div>
<div class="caixa"><b class="r">Leitura.</b> Na Minuta, cada voto conta para a cota do estado, venha de onde vier. Em ${baratas.filter(o => o.paraGanharPct <= 0.25).map(o => UFN[o.uf]).join(', ')}, até 25% a mais de votos já valem uma cadeira — variação que partidos desse tamanho alcançaram com frequência nas duas últimas eleições (coluna "Histórico"). Em ${frageis.filter(o => o.paraPerderPct <= 0.10).map(o => UFN[o.uf]).join(', ')}, a última cadeira cai com menos de 10% de perda. A coluna "Cadeiras nos mapas" mostra que a bancada quase não depende do desenho dos distritos: a cota é estadual.${ag.ufs.some(u => u.perdeExcedente > 0) ? ` A exceção é o excedente: em ${ag.ufs.filter(u => u.perdeExcedente > 0).map(u => `${UFN[u.uf]} (${pct(u.perdeExcedente, 0)} dos mapas)`).join(', ')}, o PODEMOS fica abaixo da cota em parte dos mapas, porque a cadeira vai para outro partido que venceu mais distritos do que a sua cota.` : ''}</div>
`);

// ---------------------------------------------------------------- Estudo 2
const u2 = ag.ufs.filter(u => (e1.ufs.find(o => o.uf === u.uf) || {}).temLista).sort((a, b) => (b.vence.media + b.alcance.media) - (a.vence.media + a.alcance.media) || b.fatia - a.fatia);
const r2 = v => v.min === v.max ? fmt(v.media, 0) : `${fmt(v.media, 1)} <span style="color:${C.cinza}">(${v.min}–${v.max})</span>`;
pg(`<h1>4. Estudo 2 — O candidato de distrito, distrito a distrito (deputado federal)</h1>
<table><tr><th>UF</th><th class="n">Distritos</th><th class="n">Vencidos</th><th class="n">Ao alcance</th><th class="n">Votos em risco</th><th class="n">Vazios</th><th class="n">% dos votos nominais fora do candidato do distrito</th><th>Nomes do PODEMOS que vencem ou ficam ao alcance (fração dos mapas)</th></tr>
${u2.map(u => `<tr${u.vence.media + u.alcance.media >= 1 ? ' class="pode"' : ''}><td>${u.uf}</td><td class="n">${u.k}</td><td class="n">${r2(u.vence)}</td><td class="n">${r2(u.alcance)}</td><td class="n">${r2(u.risco)}</td><td class="n">${r2(u.vazio)}</td><td class="n">${pct(u.fracRisco, 0)}</td><td>${u.nomes.slice(0, 4).map(n => `${esc(n.nome)} (${fmt(Math.min(1, n.freq), 2)})`).join('; ') || '—'}</td></tr>`).join('')}
</table>
<p class="nota">Média entre os mapas e, entre parênteses, mínimo–máximo. Fração dos mapas acima de 1 = o nome vence ou fica ao alcance em mais de um distrito do mesmo mapa (base dividida entre distritos). Votos em risco: votos nominais do PODEMOS em candidatos que não seriam o nome do partido no distrito.</p>
<div class="caixa"><b class="r">Leitura.</b> O mapa de oportunidades do partido é, sobretudo, um mapa de <b>nomes</b>: os distritos vencidos ou ao alcance concentram-se onde há um puxador com base territorial. Nos distritos "em risco", o partido tem votos, mas espalhados entre vários nomes — sob o voto único, a definição do candidato do distrito decide se esses votos ficam. Nos "vazios", a cota estadual não recebe quase nada daquele território: é onde recrutar.</div>`);

// ---------------------------------------------------------------- Estudo 3
const u3 = ag.ufs.filter(u => u.estadual).sort((a, b) => b.estadual.cadeiras.media - a.estadual.cadeiras.media);
pg(`<h1>5. Estudo 3 — Assembleias Legislativas (deputados estaduais e distritais)</h1>
<div class="tres"><div>
<table><tr><th>UF</th><th class="n">Distritos federais</th><th class="n">Cadeiras do PODEMOS (Minuta)</th><th class="n">Eleitos pelo distrito</th><th class="n">Ao alcance (≤ 2 p.p. da última vaga)</th></tr>
${u3.map(u => `<tr${u.estadual.cadeiras.media >= 1 ? ' class="pode"' : ''}><td>${u.uf}</td><td class="n">${u.k}</td><td class="n">${r2(u.estadual.cadeiras)}</td><td class="n">${r2(u.estadual.distritoElege)}</td><td class="n">${r2(u.estadual.alcance)}</td></tr>`).join('')}
<tr class="pode"><td>Total</td><td></td><td class="n">${fmt(nac.estaduais.media, 1)} (${nac.estaduais.min}–${nac.estaduais.max})</td><td class="n">${fmt(ag.ufs.reduce((s, u) => s + (u.estadual ? u.estadual.distritoElege.media : 0), 0), 1)}</td><td class="n">${fmt(ag.ufs.reduce((s, u) => s + (u.estadual ? u.estadual.alcance.media : 0), 0), 1)}</td></tr></table>
</div><div>
<div class="caixa"><b class="r">Por que é diferente.</b> Nos estaduais, cada distrito federal elege vários deputados (em geral 2 a 5). Ficar entre os primeiros de um distrito com várias vagas exige bem menos votos que vencer um distrito uninominal, e a regra limita a 2 ou 3 os eleitos do mesmo partido por distrito — o que abre espaço para partidos médios. Na mesma cota compensatória, isso significa que o PODEMOS tende a ocupar as suas cadeiras estaduais com nomes eleitos <i>pelo distrito</i>, com base territorial, e não só pela lista.</div>
<p class="peq">"Eleitos pelo distrito": o melhor nome do PODEMOS fica entre os eleitos do distrito (posição ≤ número de cadeiras). "Ao alcance": fica de fora por até 2 p.p. dos votos do distrito. Média entre os mapas; entre parênteses, mínimo–máximo.</p>
</div></div>`);

// ---------------------------------------------------------------- Estudo 4
const jan = e4.janelas.map(r => `<tr><td class="n">${fmt(100 * r.h, 1)} p.p.</td><td class="n">${fmt(r.n)}</td><td class="n">${pp(r.tau, 2)}</td><td class="n">${pp(r.ic[0], 2)} a ${pp(r.ic[1], 2)}</td><td class="n">${fmt(r.p, 3)}</td><td class="n">${(() => { const q = e4.placebo.find(x => x.h === r.h); return q ? pp(q.tau, 2) + ' (p = ' + fmt(q.p, 2) + ')' : '—'; })()}</td></tr>`).join('');
pg(`<h1>6. Estudo 4 — A prefeitura transfere votos para deputado federal?</h1>
<div class="tres"><div>
<div class="fig"><div class="ft">Variação da fatia do partido (2022→2026) pela margem na disputa da prefeitura em 2024</div>${graficoRD(e4.grafico, { larg: 680, alt: 215 })}</div>
<p class="nota">Pontos: médias por faixa de 2 p.p. de margem (área ∝ nº de casos). Linhas: tendência de cada lado. ${fmt(e4.n_total)} observações em ${fmt(e4.municipios_total)} municípios.</p>
</div><div>
<table><tr><th class="n">Janela</th><th class="n">n</th><th class="n">Efeito</th><th class="n">IC 95%</th><th class="n">p</th><th class="n">Placebo 2018→2022</th></tr>${jan}</table>
<table><tr><th>Subgrupo (janela 15 p.p.)</th><th class="n">n</th><th class="n">Efeito</th><th class="n">IC 95%</th></tr>
${[...e4.porte, ...e4.regiao].map(r => `<tr><td>${esc({ N: 'Norte', NE: 'Nordeste', CO: 'Centro-Oeste', SE: 'Sudeste', S: 'Sul' }[r.grupo] || r.grupo)}</td><td class="n">${fmt(r.n)}</td><td class="n ${r.p < 0.05 ? (r.tau > 0 ? 'pos' : 'neg') : ''}">${pp(r.tau, 1)}</td><td class="n">${pp(r.ic[0], 1)} a ${pp(r.ic[1], 1)}</td></tr>`).join('')}
<tr class="pode"><td>Só o PODEMOS (janela 20 p.p.)</td><td class="n">${fmt(e4.pode.n)}</td><td class="n">${pp(e4.pode.tau, 1)}</td><td class="n">${pp(e4.pode.ic[0], 1)} a ${pp(e4.pode.ic[1], 1)}</td></tr></table>
</div></div>
<div class="caixa"><b class="r">Resultado.</b> Nas disputas apertadas — em que quem governa é quase sorteio —, o partido que venceu a prefeitura em 2024 teve, em 2026, <b>${pp(P4.tau)}</b> a mais na sua fatia de votos para deputado federal no município do que o que perdeu (${ic(P4)}; p = ${fmt(P4.p, 3)}). O efeito é estável entre janelas e kernels (uniforme: ${pp(e4.kernel_uniforme.tau)}), e o placebo — a mesma comparação na eleição anterior, antes de governar — é nulo: não é força prévia do partido. O efeito vem dos municípios de até 50 mil votos; acima disso, não se distingue de zero. No PODEMOS sozinho a amostra é pequena (${e4.pode.n} casos) e o intervalo é largo, mas a estimativa é do mesmo sinal e tamanho.</div>`);

const top = op.distritos.slice(0, 14);
pg(`<h1>6.1 Estudo 4 aplicado — prefeituras de 2028 que constroem distritos para 2030</h1>
<div class="tres"><div>
<table><tr><th>UF</th><th class="n">Distrito</th><th class="n">Prefeituras em jogo</th><th class="n">Valor esperado (votos)</th><th>Situação do PODEMOS no distrito (2026)</th><th>Municípios</th></tr>
${top.map(o => `<tr><td>${o.uf}</td><td class="n">${o.distrito}</td><td class="n">${o.n}</td><td class="n">${fmt(o.valor)}</td><td>${o.rank ? `${o.rank}º${o.rank > 1 ? `, a ${pp(o.gap)} do 1º` : ''} • ${esc(o.nome || '')}` : 'sem nome no distrito'}</td><td class="peq">${esc(o.municipios.slice(0, 5).join(', '))}${o.municipios.length > 5 ? '…' : ''}</td></tr>`).join('')}
</table>
<p class="nota">Prefeituras em jogo: municípios em que o PODEMOS ficou em 2º a até 10 p.p. (conquistar) ou venceu por até 10 p.p. (defender) em 2024. Valor esperado = efeito estimado para o porte do município (${Object.entries(op.tau).map(([k, v]) => `${k}: ${pp(v, 1)}`).join('; ')}) × votos válidos para deputado federal no município em 2026. Distritos do desenho do simulador; cada município no distrito que tem a maior parte dos seus eleitores.</p>
</div><div>
<div class="caixa"><b class="r">Como usar.</b> No distrital misto, a prefeitura conta duas vezes: soma votos para a cota estadual e fortalece o candidato do distrito. Os distritos no alto da tabela juntam várias prefeituras disputáveis num mesmo território; onde o PODEMOS já é 2º no distrito, essas prefeituras podem cobrir a distância até o 1º lugar.</div>
<p class="peq">${op.municipios.filter(m => m.tipo === 'conquistar').length} prefeituras a conquistar e ${op.municipios.filter(m => m.tipo === 'defender').length} a defender (margem de até 10 p.p.). Lista completa no anexo de dados.</p>
</div></div>`);

// ---------------------------------------------------------------- Estudo 5
const fedTop = feds.filter(g => g.dPode || g.dSoma).slice(0, 12);
pg(`<h1>7. Estudo 5 — Federação na Minuta</h1>
<div class="tres"><div>
<table><tr><th>Parceiro</th><th class="n">Δ cadeiras da federação</th><th class="n">Δ cadeiras do PODEMOS (lista por votos)</th><th>Estados em que a federação ganha</th></tr>
${fedTop.map(g => `<tr><td>${esc(g.p)}</td><td class="n ${g.dSoma > 0 ? 'pos' : g.dSoma < 0 ? 'neg' : ''}">${g.dSoma > 0 ? '+' : ''}${fmt(g.dSoma, 1)}</td><td class="n mut">${g.dPode > 0 ? '+' : ''}${fmt(g.dPode, 1)}</td><td class="peq">${g.ufs.filter(u => u.dSoma > 0).map(u => `${u.uf} +${fmt(u.dSoma, 1)}`).join(', ') || '—'}</td></tr>`).join('')}
</table>
<p class="nota">Deputados federais. Diferença entre a federação hipotética (PODEMOS + parceiro, votos e candidatos somados, um candidato por distrito) e os dois separados, nos mesmos mapas (média de 5 mapas por estado). Cadeiras do PODEMOS dentro da federação pela ordem de votos dos candidatos.</p>
</div><div>
<div class="caixa"><b class="r">Leitura.</b> Na Minuta, a federação soma votos para uma única cota pelas maiores médias, o que tende a render cadeiras pelo arredondamento, e lança um só candidato por distrito, mais forte. A coluna principal é o ganho da <b>federação</b> (cadeiras das duas siglas juntas contra separadas), que não depende de como a lista é montada. Quantas dessas cadeiras ficam com o PODEMOS depende da lista preordenada acordada entre os partidos; a coluna "lista por votos" mostra só o caso em que a lista segue a votação de cada nome — com parceiros maiores, ela favorece os puxadores do PODEMOS e não deve ser lida como previsão.</div>
</div></div>`);

// ---------------------------------------------------------------- Estudo 6
pg(`<h1>8. Estudo 6 — O perfil dos municípios explica o voto do PODEMOS?</h1>
<div class="tres"><div>
<table><tr><th>Indicador (padronizado)</th><th class="n">Efeito médio (p.p. por desvio-padrão)</th><th class="n">p</th></tr>
${e6.coef.slice().sort((a, b) => Math.abs(b.efeito_pp) - Math.abs(a.efeito_pp)).map(c => `<tr><td>${esc(c.nome)}</td><td class="n ${c.p < 0.05 ? (c.efeito_pp > 0 ? 'pos' : 'neg') : ''}">${c.efeito_pp > 0 ? '+' : ''}${fmt(c.efeito_pp, 2)}</td><td class="n">${fmt(c.p, 3)}</td></tr>`).join('')}
</table>
<p class="nota">${fmt(e6.municipios)} municípios de ${e6.ufs.length} UFs em que o PODEMOS teve lista com ≥ 2% dos votos (${e6.ufs.join(', ')}). Regressão logística fracionária com efeitos fixos de UF, pesos = votos válidos, erros robustos. Escolaridade e alfabetização são fortemente correlacionadas entre si: os sinais individuais não devem ser lidos isoladamente.</p>
</div><div>
<div class="cards" style="--n:3"><div><div class="t">R² fora da amostra, só UF</div><div class="v">${fmt(e6.cv.r2_ufs, 2)}</div><div class="l">validação cruzada</div></div><div><div class="t">R² com o perfil</div><div class="v">${fmt(e6.cv.r2_perfil, 2)}</div><div class="l">+${fmt(e6.cv.r2_perfil - e6.cv.r2_ufs, 2)}</div></div><div><div class="t">Persistência 2022→2026</div><div class="v">${fmt(e6.corr_2022_2026_intra_uf, 2)}</div><div class="l">correlação dentro das UFs</div></div></div>
<div class="caixa"><b class="r">Resultado.</b> O perfil do eleitorado e da população — escolaridade, idade, cor ou raça, saneamento, urbanização — acrescenta só ${fmt(100 * (e6.cv.r2_perfil - e6.cv.r2_ufs), 0)} pontos ao poder de previsão. A votação do PODEMOS também se repete pouco de uma eleição para a outra no mesmo município (correlação de ${fmt(e6.corr_2022_2026_intra_uf, 2)}). As duas evidências apontam na mesma direção: o voto do partido acompanha os seus <b>candidatos</b> e a sua <b>base local</b>, não um perfil de eleitor. Para o distrital misto, isso torna o recrutamento de candidatos de distrito e a base municipal (Estudo 4) as alavancas principais.</div>
<p class="peq">Ressalva ecológica: os dados descrevem municípios, não eleitores; não se pode concluir como vota cada grupo.</p>
</div></div>`);

// ---------------------------------------------------------------- Robustez, limitações, implicações, referências
pg(`<h1>9. Robustez, limitações e implicações</h1>
<div class="duas"><div>
<h2>Robustez</h2>
<ul class="peq">
<li>Bancada federal entre ${nac.cadeiras.min} e ${nac.cadeiras.max} em todos os mapas; distritos vencidos entre ${nac.vence.min} e ${nac.vence.max}.</li>
<li>Efeito da prefeitura positivo e significativo em janelas de 7,5 a 30 p.p. e com kernel uniforme; placebo nulo em todas as janelas.</li>
<li>Validação cruzada no Estudo 6; volatilidade histórica de dois ciclos no Estudo 1.</li>
</ul>
<h2>Limitações</h2>
<ul class="peq">
<li><b>Comportamento:</b> os votos são os de 2026, dados no sistema atual. No distrital misto haveria voto estratégico (o eleitor tende a abandonar candidatos sem chance no distrito), outras candidaturas e outras alianças.</li>
<li><b>Listas:</b> sem as listas preordenadas reais, a lista segue a ordem de votos.</li>
<li><b>Estaduais:</b> a Minuta não define quantos vencem por distrito; usamos a leitura com vários eleitos por distrito federal.</li>
<li><b>Mapas:</b> o conjunto mede sensibilidade a desenhos razoáveis, não é amostra uniforme de todos os mapas legais.</li>
<li><b>Estudo 4:</b> o efeito é local (disputas apertadas); trocas de partido de prefeitos depois de 2024 não aparecem nos dados e tendem a reduzir a estimativa.</li>
<li><b>Estudo 6:</b> inferência ecológica.</li>
</ul></div><div>
<h2>O que os resultados sugerem</h2>
<ol class="peq">
<li><b>Meta por estado em votos, não em distritos.</b> Priorizar ${baratas.slice(0, 4).map(o => o.uf).join(', ')} (próxima cadeira mais barata) e proteger ${frageis.slice(0, 4).map(o => o.uf).join(', ')} (folga pequena).</li>
<li><b>Um candidato forte por distrito, definido cedo.</b> Os votos hoje espalhados entre vários nomes precisam convergir para o candidato do distrito; onde o partido não tem nome, a cota estadual perde aquele território.</li>
<li><b>Assembleias como porta de entrada.</b> Os distritos com várias cadeiras favorecem partidos médios; candidatos estaduais com base territorial são o caminho mais curto para cadeiras pelo distrito.</li>
<li><b>Prefeituras de cidades pequenas e médias em 2028</b>, concentradas nos distritos em que o partido já é competitivo.</li>
<li><b>Federação</b> avaliada estado a estado, com a lista acordada protegendo os nomes do PODEMOS.</li>
</ol>
<h2>Referências</h2>
<ol class="ref">
<li>Lee, D. S. (2008). Randomized experiments from non-random selection in U.S. House elections. <i>Journal of Econometrics</i>, 142(2).</li>
<li>Imbens, G.; Lemieux, T. (2008). Regression discontinuity designs: a guide to practice. <i>Journal of Econometrics</i>, 142(2).</li>
<li>Cattaneo, M. D.; Idrobo, N.; Titiunik, R. (2020). <i>A Practical Introduction to Regression Discontinuity Designs</i>. Cambridge University Press.</li>
<li>DeFord, D.; Duchin, M.; Solomon, J. (2021). Recombination: a family of Markov chains for redistricting. <i>Harvard Data Science Review</i>, 3(1).</li>
<li>Papke, L. E.; Wooldridge, J. M. (1996). Econometric methods for fractional response variables. <i>Journal of Applied Econometrics</i>, 11(6).</li>
<li>Robinson, W. S. (1950). Ecological correlations and the behavior of individuals. <i>American Sociological Review</i>, 15(3).</li>
<li>Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. <i>JASA</i>, 22(158).</li>
</ol></div></div>`);

const html = B.documento(pags, { titulo: 'O Podemos no distrital misto da Versão Minuta: onde crescer', sub: meta.sub, meta: `Emitido em ${hoje}<br>Bancada simulada: <b>${fmt(nac.cadeiras.simulador)}</b> (${nac.cadeiras.min}–${nac.cadeiras.max} entre mapas)<br>Cota pelas maiores médias: ${e1.nacional.cota}` });
const saida = path.join(__dirname, '..', 'pdf', 'estudo-minuta.html');
fs.writeFileSync(saida, html);
(async () => {
  const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + saida); await p.pdf({ path: saida.replace('.html', '.pdf'), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: B.RODAPE(hoje) });
  await b.close();
  console.log('PDF gerado');
})();
