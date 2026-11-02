"""Compare conversions/valeur Google Ads (action primaire 'Google Shopping App Purchase', Simprosys) aux commandes Shopify réelles.
Jour = fuseau Europe/Zurich des deux côtés (Google Ads = fuseau compte Europe/Zurich ; Shopify createdAt UTC converti).
Sorties : tableaux/ads_02_gads_vs_shopify_mensuel.csv, ads_02_gads_vs_shopify_jour.csv, ads_02_shopify_orders_attrib.csv"""
import sys, json; sys.path.insert(0,'audit-shopify/calculs')
import pandas as pd, numpy as np
from ads_lib import load
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',200)
T='audit-shopify/tableaux/'
rows=[json.loads(l) for l in open('audit-shopify/donnees_brutes/orders_api.ndjson')]
recs=[]
for o in rows:
    j=o.get('customerJourneySummary') or {}
    lv=j.get('lastVisit') or {}; fv=j.get('firstVisit') or {}
    ul=(lv.get('utmParameters') or {}); uf=(fv.get('utmParameters') or {})
    land=(lv.get('landingPage') or '')+'|'+(fv.get('landingPage') or '')
    recs.append(dict(name=o['name'],created=o['createdAt'],cancelled=o['cancelledAt'] is not None,test=o['test'],
      gross=float(o['totalPriceSet']['shopMoney']['amount']),cur=float(o['currentTotalPriceSet']['shopMoney']['amount']),refunded=float(o['totalRefundedSet']['shopMoney']['amount']),
      fin=o['displayFinancialStatus'],idx=j.get('customerOrderIndex'),days_to_conv=j.get('daysToConversion'),
      l_src=lv.get('source'),l_med=ul.get('medium'),l_usrc=ul.get('source'),l_camp=ul.get('campaign'),f_src=fv.get('source'),f_med=uf.get('medium'),f_usrc=uf.get('source'),f_camp=uf.get('campaign'),
      l_land=lv.get('landingPage'),f_land=fv.get('landingPage'),cc=(o.get('billingAddress') or {}).get('countryCodeV2'),sc=(o.get('shippingAddress') or {}).get('countryCodeV2'),cur_code=o['currencyCode'],gw=','.join(o.get('paymentGatewayNames') or [])))
d=pd.DataFrame(recs)
d['ts']=pd.to_datetime(d.created,utc=True).dt.tz_convert('Europe/Zurich'); d['date']=d.ts.dt.strftime('%Y-%m-%d'); d['month']=d.date.str[:7]
d=d[~d.test]
d['gads_click']=((d.l_usrc.fillna('').str.lower()=='google')&(d.l_med.fillna('').str.lower()=='cpc'))
d['gads_first']=((d.f_usrc.fillna('').str.lower()=='google')&(d.f_med.fillna('').str.lower()=='cpc'))
d['gads_any']=d.gads_click|d.gads_first
d['org_google']=(d.l_src.fillna('').str.lower()=='google')&~d.gads_click
d['new']=d.idx==1
d.to_csv(T+'ads_02_shopify_orders_attrib.csv',index=False)
print('commandes non test',len(d),'| période',d.date.min(),d.date.max(),'| devises',d.cur_code.value_counts().to_dict())
print(d.groupby('month').size().tail(14).to_dict())
# Google
g=load('ads_02_conv_action_daily'); gp=g[g.conversion_action_name=='Google Shopping App Purchase'].copy()
gp['conversions_value']=pd.to_numeric(gp.conversions_value); 
gb=load('ads_02_conv_action_bydate_daily'); gb=gb[gb.conversion_action_name=='Google Shopping App Purchase'].copy()
gb['v']=pd.to_numeric(gb.conversions_value_by_conversion_date)
day=pd.DataFrame({'g_conv_click':gp.groupby('date').conversions.sum(),'g_val_click':gp.groupby('date').conversions_value.sum(),'g_conv_cdate':gb.groupby('date').conversions_by_conversion_date.sum(),'g_val_cdate':gb.groupby('date').v.sum()})
camp=load('ads_01_campaign_daily_full'); camp['cost']=camp.cost_micros/1e6
day=day.reindex(sorted(set(day.index)|set(camp.date)))
day['cost']=camp.groupby('date').cost.sum(); day['clicks']=camp.groupby('date').clicks.sum()
sd=d.groupby('date').agg(orders=('name','size'),orders_nc=('cancelled',lambda x:(~x).sum()),gross=('gross','sum'),gross_nc=('gross',lambda x:0),gads_click=('gads_click','sum'),gads_any=('gads_any','sum'),org_google=('org_google','sum'),new=('new','sum'),refunded=('refunded','sum'))
nc=d[~d.cancelled].groupby('date').agg(gross_nc=('gross','sum'))
sd['gross_nc']=nc.gross_nc
day=day.join(sd,how='outer').fillna(0); day.index.name='date'; day.to_csv(T+'ads_02_gads_vs_shopify_jour.csv')
day['month']=day.index.str[:7]
m=day.groupby('month').sum(numeric_only=True)
m['g_conv_click_over_orders']=(m.g_conv_click/m.orders).round(3); m['g_val_over_gross']=(m.g_val_click/m.gross).round(3)
m['gads_utm_share']=(m.gads_click/m.orders).round(3); m['g_conv_over_utm_gads']=(m.g_conv_click/m.gads_click.replace(0,np.nan)).round(2)
m['cost_per_order']=(m.cost/m.orders).round(1)
m=m[m.index>='2025-01']
m.round(1).to_csv(T+'ads_02_gads_vs_shopify_mensuel.csv')
print(m[['cost','orders','g_conv_click','g_conv_cdate','gads_click','gads_any','org_google','new','g_val_click','gross','gross_nc','g_conv_click_over_orders','g_val_over_gross','gads_utm_share','g_conv_over_utm_gads','cost_per_order']].round(2).to_string())
# corrélation journalière 2026
x=day[(day.index>='2026-01-01')&(day.index<='2026-10-31')]
print('corr jour (2026-01..10) conv Google vs commandes:',round(x.g_conv_click.corr(x.orders),3),' conv Google vs commandes utm gads:',round(x.g_conv_click.corr(x.gads_click),3),' coût vs commandes',round(x.cost.corr(x.orders),3))
