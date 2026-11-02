"""Tableau des réglages campagnes (état au moment de l'extraction GAQL). Sortie : tableaux/ads_campagnes_reglages.csv"""
import json, pandas as pd
D='audit-shopify/donnees_brutes/ads/'
rows=json.load(open(D+'ads_01_campaigns.json'))
out=[]
for r in rows:
    c=r['campaign']; b=r.get('campaignBudget',{})
    out.append(dict(id=c['id'],name=c['name'],status=c['status'],primary=c.get('primaryStatus'),reasons=','.join(c.get('primaryStatusReasons',[])),
      channel=c['advertisingChannelType'],sub=c.get('advertisingChannelSubType'),start=c.get('startDateTime','')[:10],end=c.get('endDateTime','')[:10],
      bid=c.get('biddingStrategyType'),tROAS_mcv=c.get('maximizeConversionValue',{}).get('targetRoas'),tROAS=c.get('targetRoas',{}).get('targetRoas'),
      priority=c.get('shoppingSetting',{}).get('campaignPriority'),feed_label=c.get('shoppingSetting',{}).get('feedLabel'),
      budget_chf=float(b.get('amountMicros',0))/1e6,shared=b.get('explicitlySharedBudget') or b.get('explicitlyShared'),period=b.get('period'),
      net=json.dumps(c.get('networkSettings',{})),url=c.get('finalUrlSuffix','')[:40],tmpl=c.get('trackingUrlTemplate','')[:40],
      bidding_strategy_res=c.get('biddingStrategy','')))
df=pd.DataFrame(out); df.to_csv('audit-shopify/tableaux/ads_campagnes_reglages.csv',index=False)
pd.set_option('display.width',250,'display.max_columns',30,'display.max_colwidth',45)
print(df.drop(columns=['net','url','tmpl','bidding_strategy_res']).to_string())
print(df[['id','net','url','tmpl']].head(40).to_string())
