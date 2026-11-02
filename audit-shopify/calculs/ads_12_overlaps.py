"""Chevauchements de campagnes par modèle (90 j) + modèles jamais/peu testés. Sorties : tableaux/ads_12_overlap_matrix.csv, ads_12_overlap_summary.csv"""
import pandas as pd, numpy as np
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',100)
T='audit-shopify/tableaux/'
c=pd.read_csv(T+'ads_12_campaign_model.csv')
c['cost']=c.cost.astype(float)
n=c.groupby('shopify_product_id').campaign_id.nunique()
c['ncamps']=c.shopify_product_id.map(n)
tot=c.cost.sum()
print('lignes campagne×modèle',len(c),' modèles',c.shopify_product_id.nunique(),' coût',round(tot))
g=c.groupby('ncamps').agg(models=('shopify_product_id','nunique'),cost=('cost','sum'),clicks=('clicks','sum'),conv=('conv','sum'),val=('val','sum')); g['share_cost']=g.cost/tot; g['roas']=g.val/g.cost; print(g.round(3)); g.round(3).to_csv(T+'ads_12_overlap_summary.csv')
# paires de campagnes
pv=c.pivot_table(index='shopify_product_id',columns='cname',values='cost',aggfunc='sum').fillna(0)
names=list(pv.columns); M=pd.DataFrame(0.0,index=names,columns=names); Mm=pd.DataFrame(0,index=names,columns=names)
for a in names:
    for b in names:
        both=(pv[a]>0)&(pv[b]>0)
        M.loc[a,b]=pv.loc[both,a].sum(); Mm.loc[a,b]=both.sum()
print('coût de la ligne (campagne) sur modèles aussi servis par la colonne'); print(M.round(0).to_string()); M.round(1).to_csv(T+'ads_12_overlap_matrix.csv')
print('nb modèles communs'); print(Mm.to_string())
# par campagne : coût total & part chevauchante
cc=c.groupby('cname').agg(models=('shopify_product_id','nunique'),cost=('cost','sum'),conv=('conv','sum'),val=('val','sum'))
cc['cost_overlap']=c[c.ncamps>1].groupby('cname').cost.sum(); cc['share_overlap']=cc.cost_overlap/cc.cost; cc['roas']=cc.val/cc.cost
print(cc.round(2).sort_values('cost',ascending=False)); cc.round(3).to_csv(T+'ads_12_campaign_overview_90d.csv')
# exposition modèles : seuils de clics
m=pd.read_csv(T+'ads_12_model_perf_enriched.csv')
tot_models=95845
print('\nCatalogue modèles (snapshot DB):',tot_models,'| avec impressions 90j:',len(m),f'({len(m)/tot_models:.1%}) | avec clics:',(m.clicks>0).sum(),'| coût>0:',(m.cost>0).sum(),'| ≥1 clic:',(m.clicks>=1).sum())
for k in [10,30,50,100,200]:
    s=m[(m.clicks>=k)]; z=s[s.conv<0.01]
    print(f'clics>={k:>3}: {len(s):5d} modèles ; sans aucune conv: {len(z):5d} ({len(z)/max(len(s),1):.0%}) ; coût de ceux-ci {z.cost.sum():.0f} ({z.cost.sum()/m.cost.sum():.1%} du coût total)')
# distribution clics par modèle
q=m.clicks.describe(percentiles=[.5,.75,.9,.99]); print(q.round(1).to_dict())
print('modèles avec <5 clics sur 90j:',(m.clicks<5).sum(),'soit',round((m.clicks<5).mean()*100),'% des modèles exposés')
