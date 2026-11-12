"""seo_03 : (A) opportunités de requêtes Search Console (positions 4-20) ; (B) croisement avec les termes de recherche Google Ads, 2026-08-02..2026-11-01.
Entrées : donnees_brutes/gsc/seo_02_q90_query.csv, donnees_brutes/ads/ads_06_search_terms_shopping.json, ads_06_pmax_search_cat.json.
Sorties : tableaux/seo_03_opportunites_top.csv, tableaux/seo_03_croisement_ads_segments.csv, tableaux/seo_03_ads_payes_top3_organique.csv, tableaux/seo_03_ads_convertit_sans_organique.csv"""
import json, re, numpy as np, pandas as pd
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',200,'display.max_colwidth',50)
T='tableaux/'
g=pd.read_csv('donnees_brutes/gsc/seo_02_q90_query.csv').rename(columns={'key':'term','a_imp':'g_imp','a_clk':'g_clk','a_pos':'g_pos'})[['term','g_imp','g_clk','g_pos']]
g['term']=g.term.str.lower().str.strip(); g=g.groupby('term').agg(g_imp=('g_imp','sum'),g_clk=('g_clk','sum'),g_pos=('g_pos','mean')).reset_index()
brand=g.term.str.contains(r'resell|re-sell|resel\b',regex=True)
print('GSC 90 j : requêtes',len(g),'clics',int(g.g_clk.sum()),'impr',int(g.g_imp.sum()),'| marque clics',int(g[brand].g_clk.sum()))
# courbe CTR observée hors marque par position arrondie
nb=g[~brand&(g.g_imp>=50)].copy(); nb['pb']=nb.g_pos.round().clip(1,20)
c=nb.groupby('pb').apply(lambda x: x.g_clk.sum()/x.g_imp.sum()).rename('ctr'); print('CTR observé hors marque par position:\n',(c*100).round(2).head(12).to_string())
c=c.cummin(); ctr3=c.loc[3]  # monotone (conservateur) : bruit de position moyenne
nb['gain_clics']=np.where(nb.g_pos>3.5,nb.g_imp*(ctr3-nb.g_clk/nb.g_imp),0)
opp=nb[(nb.g_pos>=4)&(nb.g_pos<=20)&(nb.g_imp>=300)].sort_values('gain_clics',ascending=False)
opp.head(300).round(3).to_csv(T+'seo_03_opportunites_top.csv',index=False)
print('\n=== TOP 25 opportunités (hors marque, pos 4-20, ≥300 impr, gain si position 3) ===')
print(opp.head(25)[['term','g_imp','g_clk','g_pos','gain_clics']].round(1).to_string(index=False))
print('total gain théorique (toutes requêtes opp.) ',round(opp.gain_clics.sum()),' clics sur 90 j (≈',round(opp.gain_clics.sum()/3),'/mois), requêtes',len(opp),' ; clics organiques actuels hors marque',int(nb.g_clk.sum()))
# thèmes : 2 premiers mots
opp['theme']=opp.term.str.split().str[:2].str.join(' ')
th=opp.groupby('theme').agg(req=('term','size'),imp=('g_imp','sum'),clk=('g_clk','sum'),gain=('gain_clics','sum')).sort_values('gain',ascending=False).head(15); print('\n=== thèmes ==='); print(th.round(0).to_string())
# ---- Ads termes
sh=pd.DataFrame(json.load(open('donnees_brutes/ads/ads_06_search_terms_shopping.json')))
sh=sh.rename(columns={'searchTermView.searchTerm':'term','metrics.costMicros':'cost','metrics.clicks':'clicks','metrics.conversions':'conv','metrics.conversionsValue':'val','metrics.impressions':'imp','campaign.name':'camp'})[['term','cost','clicks','conv','val','imp','camp']]
pm=pd.DataFrame(json.load(open('donnees_brutes/ads/ads_06_pmax_search_cat.json')))
pm=pm.rename(columns={'campaignSearchTermView.searchTerm':'term','metrics.costMicros':'cost','metrics.clicks':'clicks','metrics.conversions':'conv','metrics.conversionsValue':'val','metrics.impressions':'imp','campaign.name':'camp'})[['term','cost','clicks','conv','val','imp','camp']]
a=pd.concat([sh.assign(src='shopping'),pm.assign(src='pmax')])
for col in ['cost','clicks','conv','val','imp']: a[col]=pd.to_numeric(a[col],errors='coerce').fillna(0)
a['cost']=a.cost/1e6; a['term']=a.term.fillna('').str.lower().str.strip()
at=a.groupby('term').agg(cost=('cost','sum'),clicks=('clicks','sum'),conv=('conv','sum'),val=('val','sum'),imp=('imp','sum')).reset_index()
print('\nAds : termes',len(at),' coût visible',round(at.cost.sum()),' (shopping',round(a[a.src=="shopping"].cost.sum()),'pmax',round(a[a.src=="pmax"].cost.sum()),') conv',round(at.conv.sum(),1))
m=at.merge(g,on='term',how='left'); m['in_gsc']=m.g_imp.notna()
def seg(r):
    if re.search(r'resell|re-sell|resel\b',r.term): return '0 marque (resell*)'
    if not r.in_gsc: return '5 absent de Search Console (aucune impression organique)'
    if r.g_pos<=3: return '1 organique position ≤ 3'
    if r.g_pos<=10: return '2 organique position 4-10'
    return '3 organique position > 10'
m['seg']=m.apply(seg,axis=1)
s=m.groupby('seg').agg(termes=('term','size'),cost=('cost','sum'),clicks=('clicks','sum'),conv=('conv','sum'),val=('val','sum'),g_clk=('g_clk','sum')).reset_index()
s['roas']=s.val/s.cost; s['cpa']=s.cost/s.conv; s['part_cout_%']=s.cost/s.cost.sum()*100
s.round(2).to_csv(T+'seo_03_croisement_ads_segments.csv',index=False); print('\n=== Ads par segment organique ==='); print(s.round(2).to_string(index=False))
x=m[(m.seg.str.startswith('1'))&(m.cost>=20)].sort_values('cost',ascending=False)
x[['term','cost','clicks','conv','val','g_imp','g_clk','g_pos']].round(1).head(60).to_csv(T+'seo_03_ads_payes_top3_organique.csv',index=False)
print('\n=== Termes payés (≥20 CHF) alors qu\'organique position ≤3 : top 15 ==='); print(x[['term','cost','conv','val','g_clk','g_pos']].head(15).round(1).to_string(index=False)); print('total',round(x.cost.sum()),'CHF sur',len(x),'termes ; conv',round(x.conv.sum(),1),' val',round(x.val.sum()),' clics organiques de ces termes',int(x.g_clk.sum()))
y=m[(m.seg.str.startswith('5'))&(m.conv>0)].sort_values('val',ascending=False)
y[['term','cost','clicks','conv','val']].round(1).head(60).to_csv(T+'seo_03_ads_convertit_sans_organique.csv',index=False)
print('\n=== Termes qui convertissent en Ads et sans impression organique : top 12 ==='); print(y[['term','cost','conv','val']].head(12).round(1).to_string(index=False)); print('total',len(y),'termes, valeur',round(y.val.sum()),'coût',round(y.cost.sum()))
