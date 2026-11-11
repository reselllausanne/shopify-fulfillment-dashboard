"""ads_09 : élasticité de la valeur Google à la dépense (courbe de réponse observationnelle) et ROAS marginal = élasticité x ROAS moyen.
Entrée : tableaux/ads_09_jour_campagnes_total.csv (SQL ads_campaign_daily agrégé par jour, 2025-07-06..2026-11-10).
Limite : observationnel, pas causal (la demande pousse dépense ET valeur). Les élasticités sont donc des bornes hautes plausibles."""
import numpy as np, pandas as pd
T='audit-shopify/tableaux/'
d=pd.read_csv(T+'ads_09_jour_campagnes_total.csv',parse_dates=['d']); d=d[(d.cost>5)&(d.val>0)].copy()
d['dow']=d.d.dt.dayofweek; d['mois']=d.d.dt.to_period('M').astype(str); d['sem']=d.d.dt.to_period('W').astype(str)
def fit(df,y,x,ctrl=None,label=''):
    X=pd.DataFrame({'c':1.0,'lx':np.log(df[x])},index=df.index)
    if ctrl is not None: X=X.join(pd.get_dummies(df[ctrl],drop_first=True).astype(float))
    Y=np.log(df[y]); b=np.linalg.lstsq(X.values,Y.values,rcond=None)[0]
    res=Y.values-X.values@b; n,k=X.shape; s2=res@res/(n-k); cov=s2*np.linalg.pinv(X.values.T@X.values); se=np.sqrt(cov[1,1])
    roas=df[y].sum()/df[x].sum(); print(f'{label:45s} n={n:4d} élasticité={b[1]:.2f} ±{1.96*se:.2f}  ROAS moyen={roas:.2f}  ROAS marginal≈{b[1]*roas:.2f}')
    return b[1],se,roas
print('--- valeur Google (val) vs coût ---')
r=d[d.d>='2026-01-01']
fit(d,'val','cost',None,'jours 2025-07..2026-11, sans contrôle')
fit(d,'val','cost','mois','jours, effet mois')
fit(r,'val','cost','mois','jours 2026, effet mois')
fit(r,'val','cost',['mois'],'jours 2026, effet mois (réf)')
r2=r.copy(); r2['dowm']=r2.dow.astype(str)
X=pd.get_dummies(r2[['mois','dowm']],drop_first=True).astype(float)
Xd=pd.DataFrame({'c':1.0,'lx':np.log(r2.cost)},index=r2.index).join(X); Yd=np.log(r2.val); b=np.linalg.lstsq(Xd.values,Yd.values,rcond=None)[0]
res=Yd.values-Xd.values@b; s2=res@res/(len(Yd)-Xd.shape[1]); se=np.sqrt((s2*np.linalg.pinv(Xd.values.T@Xd.values))[1,1]); roas=r2.val.sum()/r2.cost.sum()
print(f"{'jours 2026, effet mois + jour de semaine':45s} n={len(Yd)} élasticité={b[1]:.2f} ±{1.96*se:.2f}  ROAS moyen={roas:.2f}  ROAS marginal≈{b[1]*roas:.2f}")
w=d.groupby('sem').agg(cost=('cost','sum'),val=('val','sum'),n=('d','size')); w=w[w.n==7]
fit(w,'val','cost',None,'semaines complètes, sans contrôle')
w26=w[w.index>='2026-01']; fit(w26,'val','cost',None,'semaines complètes 2026')
print('--- tranches de dépense journalière 2026 : ROAS moyen par quintile ---')
r=r.assign(q=pd.qcut(r.cost,5,labels=False)); t=r.groupby('q').agg(jours=('d','size'),cost_moy=('cost','mean'),val_moy=('val','mean'),conv_moy=('conv','mean')); t['roas']=t.val_moy/t.cost_moy; print(t.round(2))
t['d_cost']=t.cost_moy.diff(); t['d_val']=t.val_moy.diff(); t['roas_marginal_entre_quintiles']=t.d_val/t.d_cost; print(t.round(2)[['d_cost','d_val','roas_marginal_entre_quintiles']])
t.round(3).to_csv(T+'ads_09_quintiles_depense.csv')

# Dépense journalière d'équilibre : ROAS marginal = e * a * c^(e-1) = seuil (ROAS Google d'équilibre = valeur brute / contribution = 1/0,18 ~ 5,5 ; hypothèse : toute valeur Google est incrémentale)
r=d[d.d>='2026-01-01']; c0=r.cost.mean(); v0=r.val.mean()
print(f"--- dépense d'équilibre (2026 : coût moyen {c0:.0f} CHF/j, valeur moyenne {v0:.0f}) ---")
for e in (0.52,0.62,0.68):
    a=v0/c0**e
    for be in (4.7,5.1,5.5):
        cstar=(be/(e*a))**(1/(e-1))
        print(f"e={e} seuil ROAS marginal={be} -> dépense optimale {cstar:6.0f} CHF/j  (actuel {c0:.0f}) ; ROAS moyen à ce niveau {a*cstar**e/cstar:.2f}")
