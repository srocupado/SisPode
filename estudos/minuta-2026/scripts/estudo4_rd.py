# Estudo 4 — Efeito de governar a prefeitura (2024) sobre a votação do partido para deputado federal
# (variação 2022→2026 da fatia do partido no município). Regressão descontínua (RD) pela margem da
# disputa decisiva de 2024: cada município entra duas vezes (o partido que venceu, margem +m; o que
# perdeu, margem −m). Local linear, kernel triangular, erros-padrão agrupados por município.
import sys, json, numpy as np, pandas as pd, statsmodels.api as sm
R = sys.argv[1]
d = pd.read_csv(f'{R}/rd-prefeitos.csv', dtype={'mun': str})
d['D'] = (d.margem > 0).astype(float)
def rd(df, h, y='y', kernel='tri'):
    s = df[(df.margem.abs() <= h) & df[y].notna()].copy()
    if len(s) < 50: return None
    w = (1 - s.margem.abs() / h) if kernel == 'tri' else np.ones(len(s))
    X = pd.DataFrame({'const': 1.0, 'D': s.D, 'm': s.margem, 'Dm': s.D * s.margem})
    f = sm.WLS(s[y], X, weights=w).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(s.mun)[0]})
    b, se = f.params['D'], f.bse['D']
    return {'h': h, 'n': int(len(s)), 'municipios': int(s.mun.nunique()), 'tau': b, 'ep': se, 'ic': [b - 1.96 * se, b + 1.96 * se], 'p': float(f.pvalues['D'])}
# janela ótima (regra de bolso de Imbens–Kalyanaraman, simplificada): escolhida por validação cruzada
# de "deixar um fora" nas pontas (Ludwig–Miller); aqui, a grade e a estabilidade do efeito são relatadas.
out = {'principal': {}, 'janelas': [], 'placebo': [], 'porte': [], 'regiao': [], 'kernel_uniforme': None}
for h in [0.05, 0.075, 0.10, 0.15, 0.20, 0.30]:
    r = rd(d, h); r and out['janelas'].append(r)
    p = rd(d, h, 'yPlacebo'); p and out['placebo'].append(p)
out['principal'] = rd(d, 0.10)
out['kernel_uniforme'] = rd(d, 0.10, kernel='uni')
# heterogeneidade: porte (eleitorado que votou para prefeito no 1º turno)
d['porte'] = pd.cut(d.eleitorado, [0, 10000, 50000, 1e9], labels=['até 10 mil', '10 a 50 mil', 'acima de 50 mil'])
for g, s in d.groupby('porte', observed=True):
    r = rd(s, 0.15); r and out['porte'].append(dict(r, grupo=str(g)))
reg = {'N': ['AC','AM','AP','PA','RO','RR','TO'], 'NE': ['AL','BA','CE','MA','PB','PE','PI','RN','SE'], 'CO': ['DF','GO','MS','MT'], 'SE': ['ES','MG','RJ','SP'], 'S': ['PR','RS','SC']}
d['regiao'] = d.uf.map({u: k for k, v in reg.items() for u in v})
for g, s in d.groupby('regiao'):
    r = rd(s, 0.15); r and out['regiao'].append(dict(r, grupo=g))
# só o PODEMOS (amostra pequena: só descritivo)
out['pode'] = rd(d[d.partido == 'PODE'], 0.20)
# gráfico de RD: médias por faixa de margem
bins = np.arange(-0.30, 0.3001, 0.02)
s = d[d.margem.abs() <= 0.30].copy(); s['b'] = pd.cut(s.margem, bins)
g = s.groupby('b', observed=True).agg(x=('margem', 'mean'), y=('y', 'mean'), n=('y', 'size')).reset_index(drop=True)
out['grafico'] = g.to_dict('records')
out['n_total'] = int(len(d)); out['municipios_total'] = int(d.mun.nunique())
json.dump(out, open(f'{R}/estudo4.json', 'w'), indent=1, default=float)
P = lambda r: f"h={r['h']:.3f} n={r['n']} tau={100*r['tau']:+.2f} p.p. IC95 [{100*r['ic'][0]:+.2f}; {100*r['ic'][1]:+.2f}] p={r['p']:.4f}"
print('principal', P(out['principal'])); print('uniforme', P(out['kernel_uniforme']))
for r in out['janelas']: print(' janela', P(r))
for r in out['placebo']: print(' placebo 2018→2022', P(r))
for r in out['porte']: print(' porte', r['grupo'], P(r))
for r in out['regiao']: print(' região', r['grupo'], P(r))
print('PODE', out['pode'] and P(out['pode']))
