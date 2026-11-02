"""Demande de marque / termes de recherche (PMax campaign_search_term_view + Shopping search_term_view), 2026-08-02..2026-11-01.
Sorties : tableaux/ads_06_terms_brand_summary.csv, ads_06_terms_top.csv, ads_06_device.csv, ads_06_network.csv, ads_06_is.csv"""
import sys; sys.path.insert(0,'audit-shopify/calculs')
import pandas as pd, numpy as np, re, json
from ads_lib import load
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',100,'display.max_colwidth',60)
T='audit-shopify/tableaux/'
t=load('ads_06_pmax_search_cat'); print(t.columns.tolist(), len(t))
for c in ['cost_micros','clicks','impressions','conversions','conversions_value']: t[c]=pd.to_numeric(t[c],errors='coerce').fillna(0)
t['cost']=t.cost_micros/1e6
tc=t.campaign_search_term_view_search_term.fillna('')
brand=tc.str.contains(r'resell|re-sell|resel\b|resell lausanne|resell-lausanne',case=False,regex=True)
print('lignes',len(t),'termes distincts',tc.nunique())
def summ(mask,label,df=t):
    s=df[mask]; return dict(label=label,terms=s.campaign_search_term_view_search_term.nunique(),impr=s.impressions.sum(),clicks=s.clicks.sum(),cost=s.cost.sum(),conv=s.conversions.sum(),val=s.conversions_value.sum())
rows=[summ(brand,'marque (contient resell)'),summ(~brand,'hors marque'),summ(tc=='', 'terme vide')]
# catégorie : marque produit
patterns={'nike':'nike|air max|dunk|air force|jordan|air jordan','adidas':'adidas|samba|gazelle|campus|superstar|yeezy|spezial','new balance':'new balance|nb 550|550|530|9060|2002r|\\b574\\b','asics':'asics|gel-|kayano|nimbus','ugg':'\\bugg\\b','on':'\\bon cloud|on running|cloudmonster|cloudsurfer','supreme/essentials':'supreme|essentials|fear of god|fog','lego':'lego','sneakers générique':'sneaker|basket|chaussure|schuh|turnschuh|shoes|trainer','prix/achat':'acheter|kaufen|buy|prix|preis|pas cher|günstig|sale|soldes|outlet'}
for k,p in patterns.items(): rows.append(summ(tc.str.contains(p,case=False,regex=True)&~brand,'hors marque ∩ '+k))
s=pd.DataFrame(rows); s['roas']=s.val/s.cost; s['cpc']=s.cost/s.clicks; s['cvr_%']=s.conv/s.clicks*100; s['share_cost']=s.cost/t.cost.sum()
s.round(3).to_csv(T+'ads_06_terms_brand_summary.csv',index=False); print(s.round(2).to_string())
print('total PMax terms cost',round(t.cost.sum()),' conv',round(t.conversions.sum(),1),' (campagnes PMax coût 90j ≈',')')
g=t.groupby('campaign_search_term_view_search_term').agg(impr=('impressions','sum'),clicks=('clicks','sum'),cost=('cost','sum'),conv=('conversions','sum'),val=('conversions_value','sum')).sort_values('cost',ascending=False)
g['roas']=g.val/g.cost; g.head(300).round(2).to_csv(T+'ads_06_terms_top.csv'); print(g.head(25).round(2).to_string())
# part du coût sur termes avec 0 conv
print('coût termes 0 conv',round(g[g.conv<0.01].cost.sum()),'/',round(g.cost.sum()),'(',round(g[g.conv<0.01].cost.sum()/g.cost.sum()*100),'%)')
# concentration : termes
print('top 100 termes = ', round(g.head(100).cost.sum()/g.cost.sum()*100),'% coût')
# marque par campagne
bc=t.assign(brand=brand).groupby(['campaign_name','brand']).agg(cost=('cost','sum'),conv=('conversions','sum'),val=('conversions_value','sum')).round(1); print(bc.to_string())
# Shopping search terms
st=load('ads_06_search_terms_shopping')
for c in ['cost_micros','clicks','conversions','conversions_value']: st[c]=pd.to_numeric(st[c],errors='coerce').fillna(0)
st['cost']=st.cost_micros/1e6; sb=st.search_term_view_search_term.str.contains('resell',case=False)
print('Shopping search terms: lignes',len(st),'coût',round(st.cost.sum()),' dont marque',round(st[sb].cost.sum()),'conv marque',round(st[sb].conversions.sum(),1),'conv total',round(st.conversions.sum(),1))
# device
dv=load('ads_06_device'); 
for c in ['cost_micros','clicks','impressions','conversions','conversions_value']: dv[c]=pd.to_numeric(dv[c],errors='coerce').fillna(0)
dd=dv.groupby('device').agg(impr=('impressions','sum'),clicks=('clicks','sum'),cost=('cost_micros',lambda x:x.sum()/1e6),conv=('conversions','sum'),val=('conversions_value','sum')); dd['roas']=dd.val/dd.cost; dd['cvr_%']=dd.conv/dd.clicks*100; dd['cpc']=dd.cost/dd.clicks; dd.round(2).to_csv(T+'ads_06_device.csv'); print(dd.round(2))
nw=load('ads_06_pmax_channel')
for c in ['cost_micros','clicks','impressions','conversions','conversions_value']: nw[c]=pd.to_numeric(nw[c],errors='coerce').fillna(0)
nn=nw.groupby(['ad_network_type','ad_using_product_data']).agg(impr=('impressions','sum'),clicks=('clicks','sum'),cost=('cost_micros',lambda x:x.sum()/1e6),conv=('conversions','sum'),val=('conversions_value','sum')); nn['roas']=nn.val/nn.cost; nn['share_cost']=nn.cost/nn.cost.sum(); nn.round(3).to_csv(T+'ads_06_network.csv'); print(nn.round(2))
ig=load('ads_01_is'); print(ig.round(3).to_string()); ig.to_csv(T+'ads_06_is.csv',index=False)
geo=load('ads_06_geo'); print(geo.to_string())
