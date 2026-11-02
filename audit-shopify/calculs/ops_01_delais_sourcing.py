"""Délais commande -> achat StockX -> expédition client, et fiabilité du sourcing (2026). Sources : OrderMatch, ShopifyFulfillmentRecord, orders_flat. Heures UTC converties en Zurich."""
import pandas as pd, numpy as np, pathlib, re
R = pathlib.Path(__file__).resolve().parents[1]; D, T = R / "donnees_brutes", R / "tableaux"
m = pd.read_csv(D / "04_ordermatch_lines.csv"); f = pd.read_csv(D / "06_fulfillment_records.csv"); o = pd.read_csv(D / "orders_flat.csv")
o["created"] = pd.to_datetime(o.created_utc, utc=True)
o["mois"] = o.created.dt.tz_convert("Europe/Zurich").dt.strftime("%Y-%m")
for c in ["shopify_created_utc", "stockx_purchase_utc", "stx_eta", "stx_latest_eta"]: m[c] = pd.to_datetime(m[c], utc=True, errors="coerce")
f["fulfilled"] = pd.to_datetime(f.fulfilled_at, utc=True, errors="coerce"); f["label"] = pd.to_datetime(f.label_at, utc=True, errors="coerce"); f["stx_deliv"] = pd.to_datetime(f.stx_delivered, utc=True, errors="coerce")
fo = f.groupby("ord").agg(fulfilled=("fulfilled", "min"), label=("label", "min"), stx_deliv=("stx_deliv", "min"))
s = m[(m.supplierSource == "STOCKX") & (m.shopify_created_utc >= "2026-01-01")].copy()
s["h_commande_achat"] = (s.stockx_purchase_utc - s.shopify_created_utc).dt.total_seconds() / 3600
print("StockX lignes 2026:", len(s), "| achat horodaté:", int(s.stockx_purchase_utc.notna().sum()))
print("Délai commande→achat (h):", s.h_commande_achat.describe(percentiles=[.5, .75, .9]).round(1).to_dict())
print("  achats avant commande (stock?)", int((s.h_commande_achat < 0).sum()), "| > 48 h:", int((s.h_commande_achat > 48).sum()), "| > 7 j:", int((s.h_commande_achat > 168).sum()))
st = s.stockxStatus.astype(str).str.upper()
print("Statuts achat StockX (lignes):", st.value_counts().head(8).to_dict())
canc = st.str.contains("CANCEL")
print(f"Achats annulés (StockX) : {canc.sum()}/{len(s)} = {canc.mean()*100:.1f} %")
s["mois"] = s.shopify_created_utc.dt.tz_convert("Europe/Zurich").dt.strftime("%Y-%m")
print(s.groupby("mois").apply(lambda d: pd.Series({"lignes": len(d), "annules_%": round(d.stockxStatus.astype(str).str.upper().str.contains("CANCEL").mean() * 100, 1), "med_h_achat": round(d.h_commande_achat.median(), 1)})).to_string())
# commande -> expédition (fulfillment record)
oo = o[(o.created >= "2026-01-01") & (~o.test) & (~o.fin.isin(["REFUNDED"]))].merge(fo, left_on="name", right_index=True, how="left")
oo["j_exp"] = (oo.fulfilled - oo.created).dt.total_seconds() / 86400
oo["j_label"] = (oo.label - oo.created).dt.total_seconds() / 86400
e = oo[oo.j_exp.notna() & (oo.j_exp > 0)]
print(f"\nCommande→expédition (fulfillment) : n={len(e)} ; médiane {e.j_exp.median():.1f} j ; p75 {e.j_exp.quantile(.75):.1f} ; p90 {e.j_exp.quantile(.9):.1f} ; > 7 j : {(e.j_exp>7).mean()*100:.1f} % ; > 14 j : {(e.j_exp>14).mean()*100:.1f} %")
tab = e.groupby("mois").j_exp.agg(n="count", med="median", p90=lambda s: s.quantile(.9)).round(1); tab["pct_sup_7j"] = e.groupby("mois").j_exp.apply(lambda s: round((s > 7).mean() * 100, 1)); print(tab.to_string()); tab.to_csv(T / "ops_01_delai_commande_expedition_par_mois.csv")
# remboursements motivés par le retard / annulation (notes)
r = pd.read_csv(D / "refunds_flat.csv"); r["note_l"] = r.note.fillna("").str.lower()
r = r.merge(o[["name", "created", "mois"]], left_on="order", right_on="name")
r26 = r[r.created >= "2026-01-01"]
cat = np.select([r26.note_l.str.contains("annul|cancel"), r26.note_l.str.contains("retard|long|expédi|exped|délai|delai|introuv"), r26.note_l.str.contains("retour|return|taille|size|défaut|defaut|erreur")], ["annulation", "retard/non expédié", "retour/taille/défaut"], "sans motif / autre")
print("\nRemboursements 2026 par motif (note de remboursement) :"); print(pd.Series(cat).value_counts().to_dict(), " montants:", r26.groupby(cat).total.sum().round(0).to_dict())
