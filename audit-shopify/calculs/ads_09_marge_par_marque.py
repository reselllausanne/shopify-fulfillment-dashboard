"""ads_09 : contribution par commande selon la marque (lignes de commande), puis POAS approximatif par marque pour la période août-octobre 2026.
Entrées (lecture seule) : tableaux/fin_05_orders_pnl.csv (contribution par commande, base pilote), donnees_brutes/lines_with_match.csv (titres des lignes),
tableaux/ads_09_ads_par_marque_aout_oct.csv (extrait SQL ads_product_daily par custom_attr1, copié de la requête documentée dans analyses/ads_09_marge_bid.md).
Marque d'une commande = marque de la ligne de plus gros montant (mots-clés du titre). Contribution = revenu net HT - COGS - frais de paiement - expédition/préparation.
Sorties : tableaux/ads_09_marge_par_marque.csv, tableaux/ads_09_poas_par_marque.csv"""
import re, pandas as pd, numpy as np
pd.set_option('display.width', 250, 'display.max_columns', 40)
T = 'audit-shopify/tableaux/'
p = pd.read_csv(T + 'fin_05_orders_pnl.csv')
p['contrib'] = p.revenu_net_ht - p.cogs - p.frais_paiement - p.exp_prep
l = pd.read_csv('audit-shopify/donnees_brutes/lines_with_match.csv', usecols=['order', 'title', 'vendor', 'qty', 'orig_total'])
def brand(t, v):
    s = f"{t} {v}".lower()
    rules = [('ugg', r'\bugg\b'), ('jordan', r'jordan'), ('yeezy', r'yeezy'), ('new balance', r'new balance|\bnb\b'), ('asics', r'asics'), ('on', r'\bon cloud|\bon running|^on '),
             ('saucony', r'saucony'), ('fear of god', r'fear of god|essentials'), ('supreme', r'supreme'), ('adidas', r'adidas|samba|gazelle|campus|superstar|spezial|handball'),
             ('nike', r'nike|air max|air force|dunk|vomero|pegasus|cortez|p-6000|\bsb\b')]
    for b, r in rules:
        if re.search(r, s): return b
    return 'autres'
l['brand'] = [brand(t, v) for t, v in zip(l.title.fillna(''), l.vendor.fillna(''))]
l = l.sort_values('orig_total', ascending=False).drop_duplicates('order')
m = p.merge(l[['order', 'brand']], left_on='name', right_on='order', how='left')
m['brand'] = m.brand.fillna('autres')
r = m.loc[m.mois >= '2026-08'].copy()
g = r.groupby('brand').agg(cmd=('name', 'size'), brut=('ventes_brutes_ttc', 'sum'), conserve=('revenu_conserve_ttc', 'sum'), contrib=('contrib', 'sum'), neg=('contrib', lambda s: (s < 0).mean() * 100))
g['aov_brut'] = g.brut / g.cmd; g['contrib_par_cmd'] = g.contrib / g.cmd; g['contrib_%_brut'] = g.contrib / g.brut * 100
g['roas_be_brut'] = g.brut / g.contrib
g = g.sort_values('cmd', ascending=False).round(1); g.to_csv(T + 'ads_09_marge_par_marque.csv'); print(g)
ads = pd.read_csv(T + 'ads_09_ads_par_marque_aout_oct.csv')
ads['brand'] = ads.brand_label.replace({'supreme only / collectible': 'supreme', 'otherbrands': 'autres'})
a = ads.groupby('brand').agg(cost=('cost', 'sum'), val=('val', 'sum'), conv=('conv', 'sum')).reset_index()
x = a.merge(g.reset_index()[['brand', 'contrib_%_brut', 'contrib_par_cmd', 'cmd']], on='brand', how='left')
x['roas_google'] = x.val / x.cost
x['poas_approx'] = x.roas_google * x['contrib_%_brut'] / 100   # contribution / coût si la valeur Google = valeur brute de la commande
x['cout_par_conv'] = x.cost / x.conv
x = x.sort_values('cost', ascending=False).round(2); x.to_csv(T + 'ads_09_poas_par_marque.csv', index=False); print(x)
print('Contribution par commande, distribution août-oct:', r.contrib.describe(percentiles=[.1, .25, .5, .75, .9]).round(1).to_dict(), ' % <0:', round((r.contrib < 0).mean() * 100, 1))
