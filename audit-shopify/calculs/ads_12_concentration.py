"""Concentration des dépenses et exposition par modèle (shopify_product_id), 90 j (2026-08-02..2026-11-01).
Sorties : tableaux/ads_12_concentration_summary.csv, ads_12_pareto_buckets.csv"""
import pandas as pd, numpy as np
pd.set_option('display.width',250,'display.max_columns',40)
T='audit-shopify/tableaux/'
m=pd.read_csv(T+'ads_12_model_perf.csv')
p=pd.read_csv(T+'ads_12_model_perf_prior.csv').rename(columns=lambda c:'prior_'+c if c!='shopify_product_id' else c)
m=m.merge(p,how='left',on='shopify_product_id')
tot_models_catalog=95845  # DB ads_shopping_product_current distinct models (snapshot) -> voir ads_11_labels
cost=m.cost.sum(); val=m.val.sum(); conv=m.conv.sum()
print('modèles avec impressions 90j',len(m),'| cost',round(cost),'| val',round(val),'| conv',round(conv,1),'| ROAS',round(val/cost,2))
m=m.sort_values('cost',ascending=False).reset_index(drop=True)
m['cum_cost']=m.cost.cumsum()/cost
for n in [10,50,100,250,500,1000,2500,5000]:
    s=m.head(n); print(f'top {n:>5} modèles par coût: {s.cost.sum()/cost:5.1%} coût, {s.val.sum()/val:5.1%} valeur conv, {s.conv.sum()/conv:5.1%} conv')
spent=m[m.cost>0]
print('modèles avec coût>0',len(spent),' avec ≥1 conv',(spent.conv>=0.5).sum(),' coût sur modèles 0 conv',round(spent[spent.conv<0.5].cost.sum()),f'({spent[spent.conv<0.5].cost.sum()/cost:.1%})')
# modèles gagnants = conv>=1
win=spent[spent.conv>=0.5]
print('modèles avec conv>=0.5:',len(win),' coût',round(win.cost.sum()),' val',round(win.val.sum()),' ROAS',round(win.val.sum()/win.cost.sum(),2))
# buckets de coût
bins=[0,1,5,10,20,50,100,1e9]
spent=spent.assign(b=pd.cut(spent.cost,bins,right=False))
g=spent.groupby('b',observed=True).agg(models=('cost','size'),cost=('cost','sum'),clicks=('clicks','sum'),conv=('conv','sum'),val=('val','sum'),models_conv=('conv',lambda x:(x>=0.5).sum()))
g['roas']=g.val/g.cost; g['cpc']=g.cost/g.clicks; g['share_cost']=g.cost/cost
print(g.round(2)); g.round(3).to_csv(T+'ads_12_pareto_buckets.csv')
# exposition
imp0=m[m.impr==0]; print('modèles vus mais 0 impr:',len(imp0))
clk=m[m.clicks>0]; print('modèles avec clics:',len(clk),' avec 0 conv & >=20 clics:',((m.clicks>=20)&(m.conv<0.5)).sum(),' coût de ceux-ci',round(m[(m.clicks>=20)&(m.conv<0.5)].cost.sum()))
# seuil statistique : combien de clics pour attendre une conv au CVR moyen
cvr=conv/m.clicks.sum(); print('CVR moyen modèle',round(cvr*100,2),'% -> clics pour 1 conv attendue',round(1/cvr))
m['expected_conv']=m.clicks*cvr
# "testé sans succès" : clics >= 3/cvr (≈ proba 95% d'avoir vu ≥1 conv si CVR moyen) et 0 conv
thr=3/cvr
ts=m[(m.clicks>=thr)&(m.conv<0.5)]
print('seuil clics (3/CVR)=',round(thr),' modèles testés sans succès:',len(ts),' coût',round(ts.cost.sum()))
# nouveaux/anciens : aperçu vs historique
m['was_prior']=m.prior_cost.notna()&(m.prior_cost>0)
print('dont modèles aussi dépensés avant 2026-08-02:',m.was_prior.sum(),'/',len(m[m.cost>0]))
# gagnants récurrents
m.to_csv(T+'ads_12_model_perf_enriched.csv',index=False)
# brand / catégorie
for col in ['a0','a1']:
    gg=m.groupby(col).agg(models=('cost','size'),cost=('cost','sum'),clicks=('clicks','sum'),conv=('conv','sum'),val=('val','sum')); gg['roas']=gg.val/gg.cost; gg['share']=gg.cost/cost
    print(gg.sort_values('cost',ascending=False).head(14).round(2)); gg.sort_values('cost',ascending=False).round(3).to_csv(T+f'ads_12_by_{col}.csv')
pd.Series({'models_exposed_90d':len(m),'models_spent':len(spent),'cost_90d':cost,'val_90d':val,'conv_90d':conv}).to_csv(T+'ads_12_concentration_summary.csv')
