"""seo_06 : conversions par canal (SEO sourceType, Google gratuit product_sync, cpc, direct...) depuis orders_api.ndjson (lecture seule). Aucune PII.
Sorties : tableaux/seo_06_canal_hebdo.csv, seo_06_canal_mensuel.csv, seo_06_landing_seo.csv"""
import json,re,collections,pandas as pd
pd.set_option('display.width',250,'display.max_rows',200,'display.max_colwidth',80)
rows=[]
for ln in open('donnees_brutes/orders_api.ndjson'):
    o=json.loads(ln)
    if o.get('test') or o.get('cancelledAt'): continue
    cj=o.get('customerJourneySummary') or {}; fv=cj.get('firstVisit') or {}; lv=cj.get('lastVisit') or {}
    um=lambda v:(v.get('utmParameters') or {})
    kept=float(((o.get('currentTotalPriceSet') or {}).get('shopMoney') or {}).get('amount') or 0)
    med=um(lv).get('medium') or um(fv).get('medium'); camp=um(lv).get('campaign') or um(fv).get('campaign')
    if med=='cpc': ch='google_cpc'
    elif med=='product_sync': ch='google_gratuit_product_sync'
    elif lv.get('sourceType')=='SEO' or fv.get('sourceType')=='SEO': ch='seo_organique'
    elif med in ('email',) or lv.get('sourceType')=='NEWSLETTER': ch='email'
    elif not cj.get('ready') and not fv: ch='inconnu'
    else:
        s=(lv.get('source') or fv.get('source') or 'direct'); ch='direct' if s in('direct',None) else 'autre'
    rows.append(dict(date=o['createdAt'][:10],kept=kept,ch=ch,camp=camp,land=fv.get('landingPage') or lv.get('landingPage') or ''))
d=pd.DataFrame(rows); d['date']=pd.to_datetime(d.date); d['m']=d.date.dt.strftime('%Y-%m'); d['w']=(d.date-pd.to_timedelta(d.date.dt.weekday,unit='D')).dt.strftime('%Y-%m-%d')
T='tableaux/'
mm=d.groupby(['m','ch']).agg(cmd=('kept','size'),ca=('kept','sum')).reset_index(); mm.round(0).to_csv(T+'seo_06_canal_mensuel.csv',index=False)
print(mm[mm.m>='2026-01'].pivot(index='m',columns='ch',values='cmd').fillna(0).astype(int))
print(mm[mm.m>='2026-01'].pivot(index='m',columns='ch',values='ca').fillna(0).round(0).astype(int))
ww=d[d.w>='2026-07-06'].groupby(['w','ch']).agg(cmd=('kept','size'),ca=('kept','sum')).reset_index(); ww.round(0).to_csv(T+'seo_06_canal_hebdo.csv',index=False)
print(ww.pivot(index='w',columns='ch',values='cmd').fillna(0).astype(int))
print(d[d.ch=='google_gratuit_product_sync'].camp.value_counts().head(5))
# landing des commandes SEO organique (hors accueil)
s=d[d.ch=='seo_organique'].copy(); s['p']=s.land.str.replace(r'https?://[^/]+','',regex=True).str.split('?').str[0]
s['type']=s.p.str.replace(r'^/(en|de|fr-fr|it)/','/',regex=True).str.extract(r'^/(products|collections|pages|blogs)')[0].fillna('home')
print(s[s.date>='2026-05-01'].groupby('type').agg(cmd=('kept','size'),ca=('kept','sum')).round(0))
s2=s[s.date>='2026-05-01'].groupby('p').agg(cmd=('kept','size'),ca=('kept','sum')).sort_values('cmd',ascending=False).head(25); s2.round(0).to_csv(T+'seo_06_landing_seo.csv'); print(s2.round(0))
