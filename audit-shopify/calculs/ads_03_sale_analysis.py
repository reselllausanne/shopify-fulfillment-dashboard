"""Analyse des variantes en stock Shopify (80 000 premières, parcours tronqué) : soldes (compareAt), coût d'inventaire, flags 48h / price_locked."""
import json, pandas as pd, numpy as np
j=json.load(open('audit-shopify/donnees_brutes/ads/shopify_variants_instock.json'))
d=pd.DataFrame([dict(vid=n['id'].split('/')[-1],price=float(n['price']),cmp=float(n['compareAtPrice']) if n['compareAtPrice'] else np.nan,qty=n['inventoryQuantity'],cost=float(n['inventoryItem']['unitCost']['amount']) if n['inventoryItem'] and n['inventoryItem'].get('unitCost') else np.nan,d48=(n['d48'] or {}).get('value'),lock=(n['lock'] or {}).get('value'),pid=n['product']['id'],tags='|'.join(n['product']['tags']),vendor=n['product']['vendor']) for n in j])
print('variantes',len(d),'produits',d.pid.nunique(),'qty>=1:',(d.qty>0).mean().round(3), 'qty distrib',d.qty.describe().round(1).to_dict())
print('unitCost renseigné',round(d.cost.notna().mean()*100,1),'%')
d['sale']=d.cmp.notna()
print('en solde (compareAt):',int(d.sale.sum()),round(d.sale.mean()*100,1),'% | d48=true:',int((d.d48=='true').sum()),' price_locked=true:',int((d.lock=='true').sum()))
print('sale & d48:',int((d.sale&(d.d48=='true')).sum()),' sale & lock',int((d.sale&(d.lock=='true')).sum()))
s=d[d.sale].copy(); s['disc']=1-s.price/s.cmp
print('remise médiane',round(s.disc.median()*100,1),'% p10/p90',s.disc.quantile([.1,.9]).round(2).tolist())
print('tags solde top',pd.Series('|'.join(s.tags).split('|')).value_counts().head(8).to_dict())
c=s[s.cost.notna()&(s.cost>0)].copy(); c['ht']=c.price/1.081; c['marge_ht']=c.ht-c.cost
print('soldes avec coût:',len(c),' prix HT < coût:',int((c.marge_ht<0).sum()),round((c.marge_ht<0).mean()*100,1),'% ; marge HT moy',round(c.marge_ht.mean(),1),' somme',round(c.marge_ht.sum()))
n=d[(~d.sale)&d.cost.notna()&(d.cost>0)].copy(); n['marge_ht']=n.price/1.081-n.cost
print('hors soldes avec coût:',len(n),' prix HT<coût:',int((n.marge_ht<0).sum()),round((n.marge_ht<0).mean()*100,1),'% ; marge HT méd',round(n.marge_ht.median(),1))
print('sale by vendor',s.vendor.value_counts().head(6).to_dict())
d.drop(columns=['tags']).to_csv('audit-shopify/tableaux/ads_03_variants_instock.csv',index=False)
s.drop(columns=['tags']).to_csv('audit-shopify/tableaux/ads_03_variants_sale.csv',index=False)
print(d.d48.value_counts(dropna=False).to_dict(), d.lock.value_counts(dropna=False).to_dict())
