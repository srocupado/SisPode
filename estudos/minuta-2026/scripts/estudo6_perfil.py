# Estudo 6 — O perfil dos municípios explica a votação do PODEMOS (deputado federal, 2026)?
# Regressão logística fracionária (GLM binomial, pesos = votos válidos) da fatia do PODEMOS sobre os
# indicadores do perfil (TSE + Censo 2022, padronizados) e efeitos fixos de UF, nos estados em que o
# partido teve lista com ≥ 2% dos votos. Erros robustos (HC1). Validação cruzada (5 partes, por
# município): quanto o perfil melhora a previsão fora da amostra em relação aos efeitos de UF sozinhos.
# Potencial não realizado = (previsto − observado) × votos válidos, com intervalo por bootstrap.
import sys, json, numpy as np, pandas as pd, statsmodels.api as sm
R = sys.argv[1]
d = pd.read_csv(f'{R}/perfil-municipios.csv', dtype={'mun': str})
IND = ['superior','ateFund','jovens','idosos','deficiencia','negros','indigenas','naoAlfab','esgoto','agua','lixo','semBanheiro','rural','densidade']
NOMES = {'superior':'Superior completo','ateFund':'Até fundamental incompleto','jovens':'Eleitores de 16 a 24 anos','idosos':'Eleitores de 60+','deficiencia':'Eleitores com deficiência','negros':'Pretos e pardos','indigenas':'Indígenas','naoAlfab':'Não alfabetizados','esgoto':'Esgoto na rede','agua':'Água da rede','lixo':'Lixo coletado','semBanheiro':'Sem banheiro exclusivo','rural':'População rural','densidade':'Densidade (log)'}
d['densidade'] = np.log1p(d['densidade'])
fat = d.groupby('uf').apply(lambda g: (g.pode26 * g.validos26).sum() / g.validos26.sum(), include_groups=False)
ufs = fat[fat >= 0.02].index.tolist()
s = d[d.uf.isin(ufs)].dropna(subset=IND + ['pode26']).copy()
# 'ateFund' e 'naoAlfab' são quase colineares com 'superior'; mantidos, a interpretação é de conjunto
Z = (s[IND] - s[IND].mean()) / s[IND].std()
FE = pd.get_dummies(s.uf, prefix='uf', drop_first=True, dtype=float)
X = sm.add_constant(pd.concat([Z, FE], axis=1))
X0 = sm.add_constant(FE)
y, w = s.pode26.clip(0, 1), s.validos26
def ajusta(X, y, w):
    return sm.GLM(y, X, family=sm.families.Binomial(), var_weights=w / w.mean()).fit(cov_type='HC1')
f = ajusta(X, y, w)
coef = [{'id': k, 'nome': NOMES[k], 'b': float(f.params[k]), 'ep': float(f.bse[k]), 'p': float(f.pvalues[k])} for k in IND]
# efeito marginal médio (p.p. por 1 desvio-padrão)
mu = f.predict(X); ame = {k: float((f.params[k] * mu * (1 - mu) * w).sum() / w.sum()) for k in IND}
for c in coef: c['efeito_pp'] = 100 * ame[c['id']]
# validação cruzada
rng = np.random.default_rng(20261106); part = rng.integers(0, 5, len(s))
def r2w(obs, prev, w): return 1 - (w * (obs - prev) ** 2).sum() / (w * (obs - np.average(obs, weights=w)) ** 2).sum()
prev, prev0 = np.zeros(len(s)), np.zeros(len(s))
for k in range(5):
    tr, te = part != k, part == k
    prev[te] = ajusta(X[tr], y[tr], w[tr]).predict(X[te]); prev0[te] = ajusta(X0[tr], y[tr], w[tr]).predict(X0[te])
cv = {'r2_ufs': float(r2w(y.values, prev0, w.values)), 'r2_perfil': float(r2w(y.values, prev, w.values))}
# potencial não realizado por município (in-sample, com bootstrap por município)
s['prev'] = mu; s['gap_votos'] = (s.prev - s.pode26) * s.validos26
B = 200; boots = np.zeros((B, len(s)))
for b in range(B):
    i = rng.integers(0, len(s), len(s)); fb = ajusta(X.iloc[i], y.iloc[i], w.iloc[i]); boots[b] = fb.predict(X)
s['prev_lo'] = np.percentile(boots, 5, axis=0); s['prev_hi'] = np.percentile(boots, 95, axis=0)
s[['mun','uf','validos26','pode26','prev','prev_lo','prev_hi','gap_votos']].to_csv(f'{R}/estudo6-municipios.csv', index=False)
# o voto do PODEMOS é de candidato? correlação 2022 × 2026 por município (dentro das UFs)
cc = s.dropna(subset=['pode22'])
corr = float(np.corrcoef(cc.pode22 - cc.groupby('uf').pode22.transform('mean'), cc.pode26 - cc.groupby('uf').pode26.transform('mean'))[0, 1])
out = {'ufs': ufs, 'municipios': int(len(s)), 'pseudo_r2': float(1 - f.deviance / f.null_deviance), 'cv': cv, 'coef': coef, 'corr_2022_2026_intra_uf': corr}
json.dump(out, open(f'{R}/estudo6.json', 'w'), indent=1)
print('UFs', ufs, 'municípios', len(s)); print('CV R² só UF', round(cv['r2_ufs'], 3), '| com perfil', round(cv['r2_perfil'], 3)); print('corr 2022×2026 intra-UF', round(corr, 3))
for c in sorted(coef, key=lambda c: -abs(c['efeito_pp'])): print(f"  {c['nome']:32s} {c['efeito_pp']:+.2f} p.p./DP  p={c['p']:.3f}")
