"""Lit inspection*.jsonl (URL Inspection API) -> tableaux/seo_05_inspection.csv + résumé par groupe."""
import json,glob,collections,pandas as pd
pd.set_option('display.width',250,'display.max_rows',100,'display.max_colwidth',60)
rs={}
for f in glob.glob('donnees_brutes/site/inspection*.jsonl'):
    for l in open(f):
        r=json.loads(l); rs[r['u']]=r
rows=[]
for u,r in rs.items():
    x=r['r'] or {}; i=x.get('indexStatusResult',{}); rr=x.get('richResultsResult',{})
    types={t['richResultType']:len(t.get('items',[])) for t in rr.get('detectedItems',[])}
    iss=collections.Counter(); 
    for t in rr.get('detectedItems',[]):
        for it in t.get('items',[]):
            for q in it.get('issues',[]): iss[(q['severity'],q['issueMessage'])]+=1
    rows.append(dict(groupe=r['g'],url=u,http=r['status'],verdict=i.get('verdict'),etat=i.get('coverageState'),robots=i.get('robotsTxtState'),indexation=i.get('indexingState'),
      fetch=i.get('pageFetchState'),dernier_crawl=(i.get('lastCrawlTime') or '')[:10],canon_google=i.get('googleCanonical'),canon_site=i.get('userCanonical'),
      canon_diff=bool(i.get('googleCanonical') and i.get('userCanonical') and i.get('googleCanonical')!=i.get('userCanonical')),rich_verdict=rr.get('verdict'),
      rich_types='|'.join(f'{k}:{v}' for k,v in types.items()),has_breadcrumb=any('Fil' in k or 'Breadcrumb' in k for k in types),has_product=any('produit' in k.lower() or 'product' in k.lower() or 'marchand' in k.lower() for k in types),
      sitemap=bool(i.get('sitemap')),err=(x.get('message') if r['status']!=200 else '')))
d=pd.DataFrame(rows); d.to_csv('tableaux/seo_05_inspection.csv',index=False)
print(len(d)); print(d.groupby('groupe').size())
for c in ['etat','fetch','robots','indexation','rich_verdict']: print(d.groupby(['groupe',c],dropna=False).size().unstack(0).fillna(0).astype(int),'\n')
print(d.groupby('groupe').agg(n=('url','size'),canon_diff=('canon_diff','sum'),bc=('has_breadcrumb','sum'),prod=('has_product','sum')))
print(d.groupby('groupe').dernier_crawl.agg(['min','max']))
print(d.rich_types.value_counts().head(8))
