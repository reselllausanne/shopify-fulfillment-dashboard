"""Conversions Google Ads par action et par mois (par date de clic/interaction ; et par date de conversion). Sorties tableaux/ads_02_conv_action_mois.csv"""
import sys; sys.path.insert(0,'audit-shopify/calculs')
import pandas as pd
from ads_lib import load
pd.set_option('display.width',250,'display.max_columns',40,'display.max_rows',200)
a=load('ads_02_conv_action_daily'); b=load('ads_02_conv_action_bydate_daily')
print(a.columns.tolist())
a['month']=a.date.str[:7]; b['month']=b.date.str[:7]
for c in ['conversions_value','all_conversions_value']: a[c]=pd.to_numeric(a[c],errors='coerce').fillna(0)
for c in ['conversions_value_by_conversion_date']: b[c]=pd.to_numeric(b[c],errors='coerce').fillna(0)
pt=a.groupby(['conversion_action_name','month']).agg(conv=('conversions','sum'),val=('conversions_value','sum'),allc=('all_conversions','sum'),allv=('all_conversions_value','sum')).round(1)
pt.to_csv('audit-shopify/tableaux/ads_02_conv_action_mois.csv')
x=pt.reset_index()
print(x[x.month>='2025-09'].pivot(index='conversion_action_name',columns='month',values='conv').fillna(0).round(0).to_string())
print(x[x.month>='2025-09'].pivot(index='conversion_action_name',columns='month',values='allc').fillna(0).round(0).to_string())
