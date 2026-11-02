"""Exploration de l'export API commandes : volumétrie mensuelle, TVA, pays, passerelles, remboursements, annulations."""
import pandas as pd, pathlib
R = pathlib.Path(__file__).resolve().parents[1]
D, T = R / "donnees_brutes", R / "tableaux"
o = pd.read_csv(D / "orders_flat.csv")
o["created"] = pd.to_datetime(o.created_utc, utc=True).dt.tz_convert("Europe/Zurich")
o["mois"] = o.created.dt.strftime("%Y-%m")
o["gross_before_refund"] = o.total_cur + o.refunded  # total courant (après remb.) + remboursé = total initial hors modifications
print("check total_orig vs total_cur+refunded (écart abs médian):", (o.total_orig - o.gross_before_refund).abs().median(), " max:", (o.total_orig - o.gross_before_refund).abs().max())
print("tests:", o.test.sum(), "| devises:", o.cur.value_counts().to_dict(), "| pres:", o.pres_cur.value_counts().to_dict())
m = o[~o.test].groupby("mois").agg(cmd=("id", "count"), brut_orig=("total_orig", "sum"), courant=("total_cur", "sum"), rembourse=("refunded", "sum"),
                                   tva=("tax", "sum"), ship=("ship", "sum"), remises=("discounts", "sum"), annul=("cancelled_utc", lambda s: s.notna().sum())).round(0)
print(m.to_string())
m.to_csv(T / "fin_03_commandes_par_mois_api.csv")
print("\nTaux de TVA vus:", o.tax_rates.value_counts().head(8).to_dict())
print("\nPays livraison 2026:", o[(o.created.dt.year == 2026)].ship_cc.value_counts().head(12).to_dict())
print("\nStatuts 2026:", o[o.created.dt.year == 2026].fin.value_counts().to_dict())
print("Statuts fulfilment 2026:", o[o.created.dt.year == 2026].ful.value_counts().to_dict())
print("\nSource (sourceName) 2026:", o[o.created.dt.year == 2026].source.value_counts().head(8).to_dict())
print("\nPasserelles 2026 (top):", o[o.created.dt.year == 2026].gateways.value_counts().head(12).to_dict())
