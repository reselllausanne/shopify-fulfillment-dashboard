"""Compare prix/dispo du flux Merchant (fr/de/en, top offres) au prix/dispo Shopify (Admin API, 250 premières offres du top par clics). Lecture seule."""
import json, pandas as pd
m=pd.read_csv('audit-shopify/tableaux/ads_03_lang_consistency.csv')
j=json.load(open('audit-shopify/donnees_brutes/ads/shopify_variants_top250.json'))['data']['nodes']
s=pd.DataFrame([dict(vid=n['id'].split('/')[-1],shop_price=float(n['price']),qty=n['inventoryQuantity'],afs=n['availableForSale'],upd=n['updatedAt'],pstat=n['product']['status']) for n in j if n])
m['vid']=m.offer.str.split('_').str[-1]; x=m.merge(s,on='vid')
print('n',len(x))
for l in ['fr','de','en']:
    x[f'd_{l}']=x[f'price_{l}']-x.shop_price
    print(l,'prix = Shopify:',int((x[f'd_{l}']==0).sum()),'/',len(x),' | écart abs moyen',round(x[f'd_{l}'].abs().mean(),2),' max',x[f'd_{l}'].abs().max())
print('dispo Merchant fr IN_STOCK mais Shopify afs False:',int(((x.avail_fr=='IN_STOCK')&(~x.afs)).sum()),' | OUT_OF_STOCK mais afs True:',int(((x.avail_fr=='OUT_OF_STOCK')&(x.afs)).sum()))
print('Shopify non ACTIVE:',int((x.pstat!='ACTIVE').sum()))
x['upd']=pd.to_datetime(x.upd,utc=True)
print(x[x.d_fr!=0][['offer','price_fr','price_de','price_en','shop_price','upd']].head(10).to_string())
print('fr!=Shopify, de==Shopify:',int(((x.d_fr!=0)&(x.d_de==0)).sum()),' | fr==Shopify, de!=:',int(((x.d_fr==0)&(x.d_de!=0)).sum()))
x[['offer','price_fr','price_de','price_en','shop_price','qty','afs','avail_fr','avail_de','avail_en','upd']].to_csv('audit-shopify/tableaux/ads_03_feed_vs_shopify.csv',index=False)
