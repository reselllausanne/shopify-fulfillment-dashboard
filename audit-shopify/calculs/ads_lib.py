"""Utilitaires communs ads_* : chargement JSON GAQL aplati (camelCase -> snake_case)."""
import json, re, pandas as pd
D='audit-shopify/donnees_brutes/ads/'
def snake(s): return re.sub(r'(?<!^)(?=[A-Z])','_',s).lower()
def load(name, numeric=None):
    df=pd.DataFrame(json.load(open(D+name+'.json')))
    df.columns=[snake(c.split('.')[-1]) if c.split('.')[0] in('metrics','segments') else snake(c.replace('.','_')) for c in df.columns]
    for c in df.columns:
        if c.startswith(('conversions','all_conversions','view_through','cross_device','impressions','clicks','cost_micros')):
            df[c]=pd.to_numeric(df[c],errors='coerce').fillna(0)
    return df
