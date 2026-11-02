"""Économie unitaire pour plafonds CAC/CPA/ROAS : contribution avant pub (base pilote fin_05_orders_pnl.csv) croisée avec l'attribution Shopify (ads_02_shopify_orders_attrib.csv).
Contribution_avant_pub(commande) = revenu_net_ht - cogs - frais_paiement - exp_prep (litiges exclus, non alloués par commande). TVA 8,1 % déduite (hypothèse pilote). CHF.
Sorties : tableaux/ads_04_contrib_par_canal.csv, ads_04_contrib_mensuel.csv, ads_04_caps.csv, ads_04_contrib_par_prix.csv"""
import pandas as pd, numpy as np
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',100)
T='audit-shopify/tableaux/'
p=pd.read_csv(T+'fin_05_orders_pnl.csv'); a=pd.read_csv(T+'ads_02_shopify_orders_attrib.csv')
p['contrib']=p.revenu_net_ht-p.cogs-p.frais_paiement-p.exp_prep
print('commandes P&L',len(p),'contrib totale',round(p.contrib.sum()),'(pilote avant litiges: 82913+5305=88218)')
m=p.merge(a[['name','date','gads_click','gads_any','new','idx','cancelled','l_src']],on='name',how='left')
print('jointure OK',m.date.notna().mean().round(3))
m['canal']=np.where(m.gads_click,'Google Ads (dernier clic utm cpc)',np.where(m.l_src.fillna('')=='Google','Google non-cpc (organique/free)','direct/autre'))
g=m.groupby('canal').agg(cmd=('name','size'),brut=('ventes_brutes_ttc','sum'),conserve=('revenu_conserve_ttc','sum'),net_ht=('revenu_net_ht','sum'),contrib=('contrib','sum'))
g['contrib_par_cmd']=g.contrib/g.cmd; g['contrib_%conserve_ttc']=g.contrib/g.conserve*100; g['aov_brut']=g.brut/g.cmd
g.round(1).to_csv(T+'ads_04_contrib_par_canal.csv'); print(g.round(1))
n=m.groupby(['canal','new']).agg(cmd=('name','size'),contrib=('contrib','sum'),brut=('ventes_brutes_ttc','sum')); n['c_par_cmd']=n.contrib/n.cmd; print(n.round(1))
# mensuel : coût Ads, commandes, contribution, CAC variants
spend=pd.read_csv(T+'ads_spend_mensuel_api.csv').set_index('month').cost
mm=m.groupby('mois').agg(cmd=('name','size'),contrib=('contrib','sum'),conserve=('revenu_conserve_ttc','sum'),brut=('ventes_brutes_ttc','sum'),paid_cmd=('gads_click','sum'),paid_contrib=('contrib',lambda s: s[m.loc[s.index,'gads_click']].sum()),newc=('new','sum'))
g2=pd.read_csv(T+'ads_02_gads_vs_shopify_mensuel.csv').set_index('month')
mm['cost']=spend.reindex(mm.index); mm['g_conv']=g2.g_conv_click.reindex(mm.index); mm['g_val']=g2.g_val_click.reindex(mm.index)
mm['contrib_par_cmd']=mm.contrib/mm.cmd; mm['cac_global']=mm.cost/mm.cmd; mm['cac_paid_utm']=mm.cost/mm.paid_cmd; mm['cpa_google']=mm.cost/mm.g_conv; mm['cac_new']=mm.cost/mm.newc
mm['contrib_apres_pub']=mm.contrib-mm.cost; mm['pub_%conserve']=mm.cost/mm.conserve*100; mm['roas_google']=mm.g_val/mm.cost; mm['roas_shopify_conserve']=mm.conserve/mm.cost
mm['roas_breakeven_conserve']=mm.conserve/mm.contrib   # ROAS (revenu conservé TTC / pub) pour contribution après pub = 0 si toutes les commandes étaient payantes
mm.round(2).to_csv(T+'ads_04_contrib_mensuel.csv'); print(mm.round(2).to_string())
tot=mm.sum(numeric_only=True)
print('TOTAL jan-oct: cmd',tot.cmd,'contrib',round(tot.contrib),'cost',round(tot.cost),'contrib après pub',round(tot.contrib-tot.cost),' contrib/cmd',round(tot.contrib/tot.cmd,1),' CAC global',round(tot.cost/tot.cmd,1),' CAC payé(utm)',round(tot.cost/tot.paid_cmd,1),' CPA Google',round(tot.cost/tot.g_conv,1),' paid_contrib',round(tot.paid_contrib),' contrib/cmd payé',round(tot.paid_contrib/tot.paid_cmd,1))
# dispersion contribution par commande
print(m.contrib.describe(percentiles=[.1,.25,.5,.75,.9]).round(1).to_dict())
print('part commandes contrib<0:',round((m.contrib<0).mean()*100,1),'% ; contrib<10:',round((m.contrib<10).mean()*100,1),'% ; <30',round((m.contrib<30).mean()*100,1),'%')
# par tranche de prix de commande (revenu conservé TTC)
m['band']=pd.cut(m.ventes_brutes_ttc,[-1,100,150,200,250,300,400,5000],labels=['<100','100-150','150-200','200-250','250-300','300-400','>400'])  # tranche sur le panier brut (avant remboursement)
b=m.groupby('band',observed=True).agg(cmd=('name','size'),brut=('ventes_brutes_ttc','sum'),conserve=('revenu_conserve_ttc','sum'),contrib=('contrib','sum'),paid=('gads_click','sum')); b['c_par_cmd']=b.contrib/b.cmd; b['c_%_brut']=b.contrib/b.brut*100; b['roas_be_brut']=b.brut/b.contrib; b['part_paid_%']=b.paid/b.cmd*100
print(b.round(1)); b.round(2).to_csv(T+'ads_04_contrib_par_prix.csv')
# Mois récents (août-octobre) caps
r=mm.loc['2026-08':'2026-10'].sum(numeric_only=True)
caps=pd.DataFrame([
 dict(metrique='Contribution avant pub / commande (aoû-oct)',valeur=r.contrib/r.cmd),
 dict(metrique='Coût Ads / commande totale (CAC global) (aoû-oct)',valeur=r.cost/r.cmd),
 dict(metrique='Coût Ads / commande dernier-clic Google Ads (CAC payé utm)',valeur=r.cost/r.paid_cmd),
 dict(metrique='Coût Ads / conversion revendiquée Google (CPA Google)',valeur=r.cost/r.g_conv),
 dict(metrique='Contribution avant pub / commande dernier-clic Google Ads',valeur=r.paid_contrib/r.paid_cmd),
 dict(metrique='Contribution après pub (aoû-oct, total)',valeur=r.contrib-r.cost),
 dict(metrique='Pub en % du revenu conservé TTC (aoû-oct)',valeur=r.cost/r.conserve*100),
 dict(metrique='ROAS Google (valeur conv Google / coût) aoû-oct',valeur=r.g_val/r.cost),
 dict(metrique='ROAS Shopify (revenu conservé TTC / coût) aoû-oct',valeur=r.conserve/r.cost),
 dict(metrique='ROAS Shopify d’équilibre (revenu conservé / contribution avant pub)',valeur=r.conserve/r.contrib)])
caps.round(2).to_csv(T+'ads_04_caps.csv',index=False); print(caps.round(2).to_string())
