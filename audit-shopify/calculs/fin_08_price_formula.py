"""Audit de la formule de prix du plan antérieur : prix = (buy + 14,5 + 30 + 15..20) / 0,92 ; exemple ask 160 -> ticket 270-285 vs 299.
Recalcule la contribution avec les paramètres observés (TVA 8,1 % incluse dans le prix, frais de paiement effectifs, remboursements, pub), puis
le volume supplémentaire requis pour compenser une baisse de prix. Toutes valeurs en CHF TTC sauf mention. Paramètres : tableaux/hypotheses.csv + P&L 2026.
"""
import pandas as pd, numpy as np, pathlib
R = pathlib.Path(__file__).resolve().parents[1]; T = R / "tableaux"
p = pd.read_csv(T / "fin_05_orders_pnl.csv")
n = len(p); ttc_cons = p.revenu_net_ht.sum() + p.tva.sum()
fee_rate = p.frais_paiement.sum() / ttc_cons          # frais effectifs (observés + estimés) / TTC conservé
leak = p.refunded.sum() / p.ventes_brutes_ttc.sum()    # part du brut remboursée
ads = 100856.0                                         # Google Ads 2026-01→10 (DailyAdSpend)
cac_cmd = ads / n; EXP = 14.5
print(f"Paramètres observés : frais paiement {fee_rate*100:.2f} % du TTC ; remboursements {leak*100:.1f} % du brut ; pub {cac_cmd:.1f} CHF/commande (toutes commandes) ; exp+prépa {EXP}")

# 1) arithmétique de la formule
def formula(buy, extra=(15, 20)): return [(buy + 14.5 + 30 + e) / 0.92 for e in extra]
print("\n1) Formule (buy+14,5+30+e)/0,92")
for buy in (160, 188, 200):
    lo, hi = formula(buy); print(f"  buy={buy}: prix = {lo:.1f} (e=15) à {hi:.1f} (e=20)")
print("  → pour obtenir 270–285, il faut buy ≈ %.0f–%.0f (≠ ask 160) ; l'écart ≈ frais StockX/transport observés (+26 à +31 CHF) : le 'buy' de la formule est donc le coût total rendu, pas l'ask." % (270 * .92 - 59.5, 285 * .92 - 64.5))
print("  → le diviseur 0,92 approxime la TVA (1/1,081=0,925) mais ignore frais de paiement (~%.1f %%) et fuite remboursements (%.1f %%)." % (fee_rate * 100, leak * 100))

# 2) contribution réelle à un prix donné (ligne unique, achat réussi)
def contrib(price, buy, ads_cmd=30.0, cancel_rate=0.0):
    net = price * (1 - 0.021); fee = price * fee_rate
    c_before = net - buy - fee - EXP
    return c_before, c_before - ads_cmd
print(f"\n2) Contribution par commande livrée (TTC→net TDFN 2,1 %, frais {fee_rate*100:.2f} %, exp+prépa 14,5), achat = coût rendu 'buy'")
rows = []
for price, buy in [(299, 188), (285, 188), (275, 188), (270, 188), (249, 188), (299, 160), (275, 160), (299, 220), (275, 220)]:
    cb, ca = contrib(price, buy, ads_cmd=30)
    rows.append(dict(prix_ttc=price, buy_rendu=buy, net_ht=round(price * (1 - 0.021), 1), frais_paiement=round(price * fee_rate, 1), contrib_avant_pub=round(cb, 1), contrib_apres_pub_30=round(ca, 1)))
df = pd.DataFrame(rows); print(df.to_string(index=False)); df.to_csv(T / "fin_08_contribution_par_prix.csv", index=False)
print("  Lecture : au prix de 299 avec buy 188 : contribution avant pub %.1f CHF ; la pub plafonnée à 30–35 CHF consomme l'essentiel ; à 275 elle devient ≈ %.1f." % (contrib(299, 188)[0], contrib(275, 188)[0]))

# 3) volume additionnel requis pour qu'une baisse de prix conserve la contribution TOTALE (avant pub / après pub)
print("\n3) Volume requis pour conserver la contribution après acquisition lorsque le prix baisse (budget pub fixe puis proportionnel)")
out = []
for p0, p1, buy in [(299, 285, 188), (299, 275, 188), (299, 270, 188), (249, 229, 160), (199, 179, 130)]:
    c0b = contrib(p0, buy)[0]; c1b = contrib(p1, buy)[0]
    # (a) budget pub total constant B = N0*30 : profit0 = N0*(c0b-30); profit1 = N1*c1b - N0*30 ; N1/N0 requis pour profit1>=profit0
    a = (c0b - 30 + 30) / c1b if c1b > 0 else np.inf
    # (b) pub proportionnelle (30 CHF/commande) : profit1 = N1*(c1b-30) >= N0*(c0b-30)
    b = (c0b - 30) / (c1b - 30) if (c1b - 30) > 0 else np.inf
    out.append(dict(prix_actuel=p0, prix_cible=p1, buy=buy, contrib_avant_pub_0=round(c0b, 1), contrib_avant_pub_1=round(c1b, 1), mult_volume_pub_fixe=round(a, 2), mult_volume_pub_proportionnelle=(round(b, 2) if np.isfinite(b) else "impossible (contribution ≤ 0)")))
o2 = pd.DataFrame(out); print(o2.to_string(index=False)); o2.to_csv(T / "fin_08_volume_requis_baisse_prix.csv", index=False)
print("  Lecture (a) : multiplicateur de commandes nécessaire à budget pub CONSTANT pour que le résultat après pub ne baisse pas.")
print("  Lecture (b) : si la pub reste à 30 CHF/commande, le multiplicateur requis ; 'impossible' = la baisse rend la commande non rentable.")
