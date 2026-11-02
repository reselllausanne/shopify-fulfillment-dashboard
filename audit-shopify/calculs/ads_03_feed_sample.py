"""Échantillon feed pondéré par la dépense : top 3000 offres (fr) par coût Ads 90 j -> état Merchant Center (product_view) + benchmark prix Google.
Sorties : tableaux/ads_03_feed_sample.csv, ads_03_feed_summary.csv"""
import json, re, pandas as pd, numpy as np
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',100,'display.max_colwidth',80)
T='audit-shopify/tableaux/'
off=pd.read_csv(T+'ads_13_top_offers.csv'); off['oid']=off.offer_id.str.replace('shopify_ch_','shopify_CH_')
j=json.load(open('audit-shopify/donnees_brutes/ads/mc_top_offers_fr.json'))
pv=pd.DataFrame([r['productView'] for r in j['product_view']]); pc=pd.DataFrame([r['priceCompetitivenessProductView'] for r in j['price_competitiveness']])
pv['price']=pv.price.apply(lambda x:int(x['amountMicros'])/1e6 if isinstance(x,dict) else np.nan)
pc['price_pc']=pc.price.apply(lambda x:int(x['amountMicros'])/1e6); pc['bench']=pc.benchmarkPrice.apply(lambda x:int(x['amountMicros'])/1e6)
d=off.merge(pv[['offerId','title','gtin','availability','price','aggregatedReportingContextStatus','clickPotential','creationTime','expirationDate','productTypeL1','itemGroupId']].rename(columns={'title':'mc_title'}),left_on='oid',right_on='offerId',how='left').merge(pc[['offerId','price_pc','bench']],on='offerId',how='left')
n=len(off); print('offres échantillon',n,'trouvées MC',d.offerId.notna().sum(),' coût échantillon',round(off.cost.sum()),'/ coût 90j total ≈36.4k')
print('statut agrégé:',d.aggregatedReportingContextStatus.value_counts(dropna=False).to_dict())
print('dispo:',d.availability.value_counts(dropna=False).to_dict())
d['has_gtin']=d.gtin.apply(lambda x:isinstance(x,list) and len(x)>0)
print('GTIN présent:',round(d.has_gtin.mean()*100,1),'% (pondéré coût',round((d.has_gtin*d.cost).sum()/d.cost.sum()*100,1),'%)')
# issues
iss=[]
import collections
cnt=collections.Counter()
for l in iss:
    for it in l:
        t=it.get('type',{}); cnt[(t.get('code') if isinstance(t,dict) else str(t), (it.get('severity') or {}).get('aggregatedSeverity') if isinstance(it.get('severity'),dict) else str(it.get('severity')))]+=1
print('issues',cnt.most_common(12))
# expiration
def ex(x):
    try: return pd.Timestamp(year=x['year'],month=x['month'],day=x['day'])
    except: return pd.NaT
d['exp']=d.expirationDate.apply(ex); d['created']=pd.to_datetime(d.creationTime,utc=True,errors='coerce')
print('expiration restante (jours) méd:', (d.exp-pd.Timestamp('2026-11-02')).dt.days.describe()[['min','25%','50%','75%','max']].to_dict())
print('âge offre (jours) méd:',((pd.Timestamp('2026-11-02',tz='UTC')-d.created).dt.days).describe()[['25%','50%','75%']].to_dict())
# benchmark
c=d[d.bench.notna()].copy(); c['ratio']=c.price_pc/c.bench
print('offres avec benchmark',len(c),'soit',round(len(c)/n*100,1),'% ; part du coût',round(c.cost.sum()/off.cost.sum()*100,1),'%')
print('ratio prix/benchmark: méd',round(c.ratio.median(),3),'p10',round(c.ratio.quantile(.1),3),'p90',round(c.ratio.quantile(.9),3))
for lo,hi,lab in [(0,0.95,'<-5% (moins cher)'),(0.95,1.0,'-5..0%'),(1.0,1.05,'0..+5%'),(1.05,1.10,'+5..+10%'),(1.10,1.2,'+10..+20%'),(1.2,9,'>+20%')]:
    s=c[(c.ratio>=lo)&(c.ratio<hi)]
    print(f'{lab:>20}: {len(s):4d} offres, coût {s.cost.sum():8.0f}, clics {s.clicks.sum():6.0f}, conv {s.conv.sum():6.1f}, val {s.val.sum():8.0f}, ROAS {s.val.sum()/max(s.cost.sum(),1):.2f}, CVR {s.conv.sum()/max(s.clicks.sum(),1)*100:.2f}%')
c['band']=pd.cut(c.ratio,[0,0.95,1.0,1.05,1.10,1.2,9],labels=['<0.95','0.95-1','1-1.05','1.05-1.10','1.10-1.20','>1.20'],right=False)
g=c.groupby('band',observed=True).agg(offres=('cost','size'),cost=('cost','sum'),clicks=('clicks','sum'),conv=('conv','sum'),val=('val','sum')); g['roas']=g.val/g.cost; g['cvr_%']=g.conv/g.clicks*100; g['cpa']=g.cost/g.conv
print(g.round(2)); g.round(3).to_csv(T+'ads_03_prix_vs_benchmark.csv')
# écart prix feed vs prix perf
m=d[d.price.notna()&d.price_pc.notna()]; print('écart price product_view vs price_comp (≠):',(abs(m.price-m.price_pc)>0.5).sum(),'/',len(m))
# titres
d['tl']=d.mc_title.fillna('').str.len(); print('titre longueur méd',d.tl.median(),'max',d.tl.max())
d['title_has_size']=d.mc_title.fillna('').str.contains(r',\s*[\dXSML\.\s/½]+$'); print('titre se termine par taille:',round(d.title_has_size.mean()*100,1),'%')
d.drop(columns=['gtin','expirationDate']).to_csv(T+'ads_03_feed_sample.csv',index=False)
