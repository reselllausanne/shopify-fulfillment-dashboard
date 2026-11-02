"""Couverture du pixel maison (funnel_events) vs commandes Shopify, 2026-10-15..2026-11-02 (Europe/Zurich). Sortie tableaux/ads_02_pixel_coverage.csv"""
import pandas as pd
T='audit-shopify/tableaux/'
f=pd.read_csv(T+'ads_20_funnel_orders_daily.csv'); o=pd.read_csv(T+'ads_02_shopify_orders_attrib.csv')
o=o[~o.cancelled]
sd=o.groupby('date').agg(orders=('name','size'),gads_utm=('gads_click','sum'))
x=f.set_index('d').join(sd,how='left').loc['2026-10-15':'2026-11-02']
x=x.fillna(0)
print(x[['cc_orders','cc_consent_mkt','cc_clickid','orders','gads_utm']].sum())
print('couverture pixel (cc/orders)',round(x.cc_orders.sum()/x.orders.sum(),3),' | exclu 10-15 (jour partiel):',round(x.loc['2026-10-16':].cc_orders.sum()/x.loc['2026-10-16':].orders.sum(),3))
print('consent marketing sur cc:',round(x.cc_consent_mkt.sum()/x.cc_orders.sum(),3),' clickid sur cc:',round(x.cc_clickid.sum()/x.cc_orders.sum(),3),' (clic Google Ads utm sur commandes Shopify:',round(x.gads_utm.sum()/x.orders.sum(),3),')')
x['cov']=x.cc_orders/x.orders; x.to_csv(T+'ads_02_pixel_coverage.csv')
print(x[['cc_orders','orders','cov','bots']].round(2).to_string())
