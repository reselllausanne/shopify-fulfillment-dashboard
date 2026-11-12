"""Décompose la baisse d'impressions 14 sept (fenêtres A avant / B après, seo_02_sep) par requête : position dégradée (>+1,5), stable, ou meilleure."""
import pandas as pd, numpy as np
q=pd.read_csv('donnees_brutes/gsc/seo_02_sep_query.csv'); q['d']=q.b_imp-q.a_imp; q['dp']=q.b_pos-q.a_pos
q=q[(q.a_imp>=30)|(q.b_imp>=30)]
both=q[(q.a_imp>0)&(q.b_imp>0)].copy()
both['cl']=pd.cut(both.dp,[-99,-1.5,1.5,99],labels=['position meilleure (<-1,5)','position stable (±1,5)','position dégradée (>+1,5)'])
g=both.groupby('cl').agg(req=('key','size'),a=('a_imp','sum'),b=('b_imp','sum')); g['delta']=g.b-g.a; g['d%']=(g.b/g.a-1)*100
print(g.round(1))
print('disparues (b=0)',q[q.b_imp==0].a_imp.sum(),'nouvelles (a=0)',q[q.a_imp==0].b_imp.sum(),'total delta',q.d.sum())
brand=q.key.str.contains('resell')
print('marque delta',q[brand].d.sum(),'hors marque',q[~brand].d.sum())
