"""Dépenses/conversions Google Ads par mois et par canal depuis l'API (GAQL campaign×date), vs DailyAdSpend.
Sorties : tableaux/ads_spend_mensuel_api.csv, tableaux/ads_spend_mensuel_canal.csv"""
import sys; sys.path.insert(0,'audit-shopify/calculs')
import pandas as pd, json
from ads_lib import load
pd.set_option('display.width',250,'display.max_columns',40)
D='audit-shopify/donnees_brutes/ads/'
df=load('ads_01_campaign_daily_full')
df=df.rename(columns={'campaign_advertising_channel_type':'c_advertising_channel_type'})
print(list(df.columns))
df['cost']=df.cost_micros/1e6; df['month']=df.date.str[:7]
m=df.groupby('month').agg(cost=('cost','sum'),clicks=('clicks','sum'),impr=('impressions','sum'),conv=('conversions','sum'),val=('conversions_value','sum'),allconv=('all_conversions','sum'),allval=('all_conversions_value','sum'),conv_cd=('conversions_by_conversion_date','sum'),val_cd=('conversions_value_by_conversion_date','sum'),vt=('view_through_conversions','sum'),days=('date','nunique')).round(1)
m['roas']=(m.val/m.cost).round(2); m['cpc']=(m.cost/m.clicks).round(2); m['cvr']=(m.conv/m.clicks*100).round(2); m['cpa']=(m.cost/m.conv).round(1); m['aov_g']=(m.val/m.conv).round(0)
m.to_csv('audit-shopify/tableaux/ads_spend_mensuel_api.csv'); print(m.to_string())
ch=df.groupby(['month','c_advertising_channel_type']).agg(cost=('cost','sum'),conv=('conversions','sum'),val=('conversions_value','sum')).round(0).unstack(fill_value=0)
ch.to_csv('audit-shopify/tableaux/ads_spend_mensuel_canal.csv'); print(ch.to_string())
