"""seo_01 : séries Search Console par segment + détection de ruptures + croisement avec événements datés (thème, catalogue, Explorer) et dépense Ads.
Entrées : tableaux/seo_01_gsc_segments_jour.csv, tableaux/gsc_01_jour.csv, tableaux/ads_09_jour_campagnes_total.csv, donnees_brutes/ads/shopify_product_created*.json.
Sorties : tableaux/seo_01_hebdo.csv, tableaux/seo_01_ruptures.csv"""
import json, numpy as np, pandas as pd
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',200)
T='tableaux/'
s=pd.read_csv(T+'seo_01_gsc_segments_jour.csv',parse_dates=['date'])
t=pd.read_csv(T+'gsc_01_jour.csv',parse_dates=['date']).assign(segment='total')[['segment','date','clicks','impressions','position']]
a=pd.concat([s,t])
a['pos_w']=a.position*a.impressions
a['sem']=a.date.dt.to_period('W-SUN').dt.start_time
w=a.groupby(['segment','sem']).agg(clicks=('clicks','sum'),imp=('impressions','sum'),pos_w=('pos_w','sum'),days=('date','nunique')).reset_index()
w['pos']=w.pos_w/w.imp; w['ctr']=w.clicks/w.imp*100; w=w[w.days==7]
w.drop(columns='pos_w').round(2).to_csv(T+'seo_01_hebdo.csv',index=False)
pv=lambda col: w.pivot(index='sem',columns='segment',values=col)
print('=== CLICS par semaine (segments) ==='); print(pv('clicks')[['total','q_marque','q_horsmarque','page_products','page_collections','page_de','page_en','page_frfr','c_che','c_deu','c_fra','dev_mobile']].astype(int).to_string())
print('=== IMPRESSIONS par semaine ==='); print((pv('imp')[['total','q_horsmarque','page_de','page_en','page_frfr','c_deu']]/1000).round(1).to_string())
print('=== POSITION moyenne pondérée ==='); print(pv('pos')[['total','q_horsmarque','page_products','page_collections','page_de']].round(1).to_string())
# ruptures : moyenne 14 j après vs 14 j avant, sur total clics / impressions / position hors marque
d=s[s.segment=='q_horsmarque'].set_index('date'); tt=t.set_index('date')
def jumps(ser,label,minratio=0.25):
    ser=ser.asfreq('D'); b=ser.rolling(14).mean().shift(1); f=ser[::-1].rolling(14).mean()[::-1].shift(-1)
    # compare mean(14 j précédents) et mean(14 j suivants)
    r=(f/b-1).dropna(); r=r[r.abs()>=minratio]
    # regrouper : garder le plus fort par fenêtre de 14 j
    out=[]; last=None
    for dte,v in r.abs().sort_values(ascending=False).items():
        if all(abs((dte-x).days)>14 for x in out): out.append(dte)
    return pd.DataFrame([dict(serie=label,date=x.date(),avant=round(b[x],1),apres=round(f[x],1),variation_pct=round(r[x]*100)) for x in sorted(out)])
J=pd.concat([jumps(tt.impressions,'impressions total'),jumps(tt.clicks,'clics total'),jumps(d.impressions,'impressions hors marque'),jumps(d.clicks,'clics hors marque')])
J.to_csv(T+'seo_01_ruptures.csv',index=False); print('=== RUPTURES (±25 % entre 14 j avant et 14 j après) ==='); print(J.to_string(index=False))
# catalogue Shopify créé par semaine
rows=[]
for f in ['../audit-shopify/donnees_brutes/ads/shopify_product_created.json','donnees_brutes/ads/shopify_product_created_recent.json']:
    try: rows+=json.load(open(f))
    except Exception as e: pass
cp=pd.DataFrame(rows,columns=['id','created']).drop_duplicates('id'); cp['created']=pd.to_datetime(cp.created,utc=True).dt.tz_localize(None)
cw=cp.set_index('created').resample('W-SUN').size()
cw=cw[cw.index>='2026-06-01']; print('=== Produits Shopify créés par semaine (depuis juin 2026) ==='); print(cw.to_string())
ad=pd.read_csv(T+'ads_09_jour_campagnes_total.csv',parse_dates=['d']); ad['sem']=ad.d.dt.to_period('W-SUN').dt.start_time
aw=ad.groupby('sem').agg(cost=('cost','sum'),clicks=('clicks','sum'),imp=('imp','sum'),days=('d','size')); aw=aw[aw.days==7]
print('=== Ads par semaine (depuis juil. 2026) ==='); print(aw[aw.index>='2026-07-01'][['cost','clicks','imp']].round(0).to_string())
