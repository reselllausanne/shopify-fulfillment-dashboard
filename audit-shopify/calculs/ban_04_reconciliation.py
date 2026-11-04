"""Rapprochement banque/cartes vs modèle (P&L Shopify, Galaxus, pub, coûts). Agrégats seulement (publiables)."""
import pandas as pd, pathlib, warnings
warnings.filterwarnings("ignore")
R = pathlib.Path(__file__).resolve().parents[1]; T = R / "tableaux"; LOC = R / "donnees_banque_local"; D = "/Users/resell-lausanne/Downloads/"
ms = [f"2026-{m:02d}" for m in range(1, 10)]
o = pd.read_csv(T / "fin_05_orders_pnl.csv"); o["g"] = o.gateways.fillna("").str.lower()
o["canal"] = o.g.map(lambda s: "twint" if "twint" in s else "paypal" if "paypal" in s else "mfgroup" if any(k in s for k in ["powerpay", "cembra", "invoice"]) else "stripe")
mod = o[o.mois.isin(ms)].pivot_table(index="mois", columns="canal", values="revenu_conserve_ttc", aggfunc="sum").fillna(0)
b = pd.read_csv(LOC / "ban_02_classes.csv"); bk = b[b.mois.isin(ms)].pivot_table(index="mois", columns="cat", values="amount", aggfunc="sum").fillna(0)
rows = []
for c, cat in [("stripe", "in_shopify_stripe"), ("twint", "in_shopify_twint"), ("paypal", "in_shopify_paypal"), ("mfgroup", "in_shopify_mfgroup")]:
    rows.append(dict(poste=f"Shopify {c}", modele_ttc_conserve=mod[c].sum(), banque=bk[cat].sum()))
# coûts : carte Swisscard principale (achats nets des remboursements) vs coûts modèle
A = pd.read_excel(D + "SC-Transactions_2026-10-08_18-55-57.xlsx"); A = A[A["Catégorie de commerçant"] != "Versement"]; A["mois"] = A["Date transaction"].astype(str).str[:7]
card = A.groupby("mois").Montant.sum().reindex(ms)
g = pd.read_csv(R / "donnees_brutes/05_galaxus_monthly.csv").set_index("mois").cout_stx.reindex(ms).fillna(0)
cs = o[o.mois.isin(ms)].groupby("mois")[["cogs", "cogs_est"]].sum().sum(axis=1).reindex(ms) + g
cmp_ = pd.DataFrame({"carte_swisscard_achats_nets": card, "modele_cogs_shopify_plus_stx_galaxus": cs}).round(0)
# pub : Cornèrcard Google Ads vs DailyAdSpend
fr = pd.concat([pd.read_excel(D + f).assign(src=f) for f in ["transactions.xls", "transactions (1).xls", "transactions (2).xls"]])
fr["d"] = pd.to_datetime(fr.Date, format="%d/%m/%Y"); fr["k"] = fr.d.astype(str) + fr.Description.str.slice(0, 12) + fr.Montant.astype(str)
fr["r"] = fr.groupby(["src", "k"]).cumcount(); fr = fr.drop_duplicates(subset=["k", "r"])  # exports qui se recouvrent
fr["mois"] = fr.d.dt.strftime("%Y-%m"); ga = fr[fr.Description.str.contains("GOOGLE", case=False)]
ads = pd.read_csv(R / "donnees_brutes/03_adspend_monthly.csv").set_index("mois").pub_chf
cmp2 = pd.DataFrame({"cornercard_google_ads": ga.groupby("mois").Montant.sum(), "dailyadspend_db": ads}).loc["2026-01":"2026-10"].round(0)
pd.DataFrame(rows).round(0).to_csv(T / "ban_04_recon_encaissements_shopify.csv", index=False)
cmp_.to_csv(T / "ban_04_recon_couts_carte.csv"); cmp2.to_csv(T / "ban_04_recon_pub.csv")
print(pd.DataFrame(rows).round(0).to_string()); print(cmp_.to_string(), cmp_.sum().to_dict()); print(cmp2.to_string(), cmp2.sum().to_dict())
