"""Cohérence fr/de/en du flux Merchant (top ~800 offres par clics) : prix, disponibilité, titre, statut. Source : mc_top800_{fr,de,en}.json (Merchant API v1 product_view)."""
import json, pandas as pd, collections
P='audit-shopify/donnees_brutes/ads/'
def ld(l):
    j=json.load(open(P+f'mc_top800_{l}.json')); rows=[]
    for r in j['product_view']:
        v=r.get('productView',r); rows.append(dict(id=v.get('id'),offer=v.get('offerId'),lang=v.get('languageCode'),title=v.get('title'),brand=v.get('brand'),price=(v.get('price') or {}).get('amountMicros'),avail=v.get('availability'),status=v.get('aggregatedDestinationStatus'),gpc=v.get('googleProductCategory'),gtin=v.get('gtin'),cond=v.get('condition')))
    return pd.DataFrame(rows)
d={l:ld(l) for l in ['fr','de','en']}
for l in d: print(l,len(d[l]),d[l].lang.value_counts().to_dict(), d[l].status.value_counts().to_dict() if 'status' in d[l] else '')
print(d['fr'].head(3).to_dict('records'))
m=d['fr'].merge(d['de'],on='offer',suffixes=('_fr','_de')).merge(d['en'].add_suffix('_en').rename(columns={'offer_en':'offer'}),on='offer')
print('offres communes fr/de/en',len(m))
m['price_fr']=pd.to_numeric(m.price_fr,errors='coerce')/1e6; m['price_de']=pd.to_numeric(m.price_de,errors='coerce')/1e6; m['price_en']=pd.to_numeric(m.price_en,errors='coerce')/1e6
m['diff_prix']=(m.price_fr!=m.price_de)|(m.price_fr!=m.price_en)
m['diff_dispo']=(m.avail_fr!=m.avail_de)|(m.avail_fr!=m.avail_en)
m['diff_titre']=(m.title_fr!=m.title_de)|(m.title_fr!=m.title_en)
print('prix différents entre langues:',int(m.diff_prix.sum()),'dispo diff:',int(m.diff_dispo.sum()),'titre diff:',int(m.diff_titre.sum()))
print('dispo',m.avail_fr.value_counts().to_dict(),'| statut fr',m.status_fr.value_counts().to_dict(),'| gtin vide fr',int(m.gtin_fr.isna().sum()) if 'gtin_fr' in m else 'n/a')
print(m[m.diff_titre][['title_fr','title_de','title_en']].head(5).to_string())
m.drop(columns=[c for c in m.columns if c.startswith('gpc')],errors='ignore').to_csv('audit-shopify/tableaux/ads_03_lang_consistency.csv',index=False)
