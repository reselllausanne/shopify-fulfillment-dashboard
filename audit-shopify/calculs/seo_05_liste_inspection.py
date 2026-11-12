"""Liste d'URL à inspecter (URL Inspection API). Groupes : head_perdants, prod_disparus, prod_nouveaux, prod_sitemap_alea, collections_top."""
import pandas as pd, random
random.seed(7)
p=pd.read_csv('donnees_brutes/gsc/seo_02_sep_page.csv'); p['d']=p.b_imp-p.a_imp
rows=[]
for u in p.sort_values('d').head(40).key: rows.append(('head_perdants',u))
prod=p[p.key.str.contains('/products/')]
gone=prod[(prod.b_imp==0)&(prod.a_imp>=15)].sort_values('a_imp',ascending=False)
for u in gone.head(80).key: rows.append(('prod_disparus',u))
new=prod[(prod.a_imp==0)&(prod.b_imp>=15)]
for u in new.sample(min(40,len(new)),random_state=1).key: rows.append(('prod_nouveaux',u))
sm=pd.read_csv('donnees_brutes/site/main_urls.tsv',sep='\t',header=None,names=['u','lm'])
for u in sm.sample(80,random_state=2).u: rows.append(('prod_sitemap_alea',u))
col=p[p.key.str.contains('/collections/')&(p.a_imp>=500)&(~p.key.isin([r[1] for r in rows]))]
for u in col.sample(min(40,len(col)),random_state=3).key: rows.append(('collections_top',u))
df=pd.DataFrame(rows,columns=['groupe','url']).drop_duplicates('url'); df.to_csv('donnees_brutes/site/inspection_liste.csv',index=False); print(df.groupby('groupe').size())
