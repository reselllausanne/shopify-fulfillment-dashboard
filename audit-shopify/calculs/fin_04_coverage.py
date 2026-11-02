"""Couverture du rapprochement lignes Shopify (API) <-> OrderMatch (coût fournisseur). Période 2026-01 -> 2026-10."""
import pandas as pd, re, pathlib
R = pathlib.Path(__file__).resolve().parents[1]
D, T = R / "donnees_brutes", R / "tableaux"
num = lambda s: re.sub(r"\D", "", str(s)) if pd.notna(s) else None
o = pd.read_csv(D / "orders_flat.csv"); l = pd.read_csv(D / "lines_flat.csv"); m = pd.read_csv(D / "04_ordermatch_lines.csv")
l["lid"] = l.line_id.map(num); m["lid"] = m.shopifyLineItemId.map(num)
l["created"] = pd.to_datetime(l.created_utc, utc=True).dt.tz_convert("Europe/Zurich"); l["mois"] = l.created.dt.strftime("%Y-%m")
print("OrderMatch: lignes uniques lid:", m.lid.nunique(), "doublons:", m.lid.duplicated().sum(), "| lid manquants:", m.lid.isna().sum())
dup = m[m.lid.duplicated(keep=False)].sort_values("lid")
print("exemples doublons:\n", dup[["shopifyOrderName", "lid", "stockxOrderNumber", "supplierCost", "shopifyTotalPrice", "stockxStatus"]].head(8).to_string())
mm = m.drop_duplicates("lid", keep="last")
x = l.merge(mm[["lid", "supplierCost", "manualCostOverride", "stockxStatus", "supplierSource", "matchType", "shopifyTotalPrice", "return_applied", "returnedStockValueChf", "manualCaseStatus"]], on="lid", how="left")
x["has_match"] = x.supplierCost.notna()
y = x[(x.created >= "2026-01-01") & (x.created < "2026-11-01")]
c = y.groupby("mois").agg(lignes=("lid", "count"), appar=("has_match", "sum"), ca_lignes=("disc_total", "sum"))
c["ca_apparie"] = y[y.has_match].groupby("mois").disc_total.sum()
c["couv_lignes_pct"] = (c.appar / c.lignes * 100).round(1); c["couv_ca_pct"] = (c.ca_apparie / c.ca_lignes * 100).round(1)
print(c.round(0).to_string())
nm = y[~y.has_match]
print("\nLignes 2026 sans OrderMatch :", len(nm), "CA TTC lignes:", round(nm.disc_total.sum(), 0))
print(nm.groupby("ptype").agg(n=("lid", "count"), ca=("disc_total", "sum")).sort_values("ca", ascending=False).head(12).round(0).to_string())
print(nm.groupby("vendor").agg(n=("lid", "count"), ca=("disc_total", "sum")).sort_values("ca", ascending=False).head(12).round(0).to_string())
# prix ligne API vs OrderMatch.shopifyTotalPrice
z = x[x.has_match]
d = (z.disc_total - z.shopifyTotalPrice).abs()
print("\nÉcart prix ligne API vs OrderMatch (appariés): médian", d.median(), " >1 CHF:", int((d > 1).sum()), "/", len(z))
x.to_csv(D / "lines_with_match.csv", index=False)
