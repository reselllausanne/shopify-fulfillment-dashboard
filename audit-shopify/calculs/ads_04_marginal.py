"""Coût moyen par commande supplémentaire entre régimes de dépense (observationnel, confondu par saisonnalité/catalogue/prix). Sources: ads_02_gads_vs_shopify_mensuel.csv."""
import pandas as pd
g=pd.read_csv('audit-shopify/tableaux/ads_02_gads_vs_shopify_mensuel.csv').set_index('month')
g=g.loc['2025-01':'2026-10']
reg={'A 2025-01..09 (faible dépense)':('2025-01','2025-09'),'B 2026-02..07 (~8k/mois)':('2026-02','2026-07'),'C 2026-08..10 (~14k/mois)':('2026-08','2026-10'),'Q4-25 2025-11..12 (saison)':('2025-11','2025-12'),'J 2026-01':('2026-01','2026-01')}
rows=[]
for k,(a,b) in reg.items():
    s=g.loc[a:b]; rows.append(dict(regime=k,mois=len(s),cost_mois=s.cost.mean(),cmd_mois=s.orders_nc.mean() if False else s.orders.mean(),cmd_hors_dernier_clic_gads=(s.orders-s.gads_click).mean() if (s.gads_click.sum()>0) else float('nan'),g_conv_mois=s.g_conv_click.mean(),g_val_mois=s.g_val_click.mean(),gross_mois=s.gross.mean()))
r=pd.DataFrame(rows).set_index('regime')
print(r.round(1))
def inc(a,b):
    dc=r.loc[b,'cost_mois']-r.loc[a,'cost_mois']; do=r.loc[b,'cmd_mois']-r.loc[a,'cmd_mois']; dg=r.loc[b,'gross_mois']-r.loc[a,'gross_mois']
    return dict(de=a,vers=b,delta_cost=round(dc),delta_cmd=round(do,1),cout_par_cmd_suppl=round(dc/do,1) if do>0 else None,delta_ventes_brutes=round(dg),pub_par_chf_vente_suppl=round(dc/dg,3),roas_marginal_google=round((r.loc[b,'g_val_mois']-r.loc[a,'g_val_mois'])/dc,2),cout_par_conv_google_suppl=round(dc/(r.loc[b,'g_conv_mois']-r.loc[a,'g_conv_mois']),1))
out=pd.DataFrame([inc('A 2025-01..09 (faible dépense)','B 2026-02..07 (~8k/mois)'),inc('B 2026-02..07 (~8k/mois)','C 2026-08..10 (~14k/mois)'),inc('A 2025-01..09 (faible dépense)','C 2026-08..10 (~14k/mois)')])
print(out.to_string()); out.to_csv('audit-shopify/tableaux/ads_04_marginal_regimes.csv',index=False); r.round(1).to_csv('audit-shopify/tableaux/ads_04_regimes.csv')
# corrélation mensuelle coût vs commandes (2026)
x=g.loc['2026-01':'2026-10']; import numpy as np
b=np.polyfit(x.cost,x.orders,1); print('pente commandes/CHF pub (OLS 10 mois 2026):',round(b[0],4),'=> CHF pub par cmd suppl.',round(1/b[0],1),' r=',round(np.corrcoef(x.cost,x.orders)[0,1],2))
y=g.loc['2025-01':'2026-10']; b2=np.polyfit(y.cost,y.orders,1); print('OLS 22 mois: pente',round(b2[0],4),'=> CHF par cmd suppl.',round(1/b2[0],1),' r=',round(np.corrcoef(y.cost,y.orders)[0,1],2))
