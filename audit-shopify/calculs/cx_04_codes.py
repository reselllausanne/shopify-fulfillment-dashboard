"""Commandes 2026 avec/sans code de réduction : part, panier, contribution avant pub (pilote fin_05)."""
import pandas as pd, numpy as np, re
p = pd.read_csv("tableaux/fin_05_orders_pnl.csv"); p["contrib"] = p.revenu_net_ht - p.cogs - p.frais_paiement - p.exp_prep
p["code"] = p.discount_codes.notna() & (p.discount_codes.astype(str).str.len() > 0)
p["famille"] = np.where(~p.code, "sans code", np.where(p.discount_codes.astype(str).str.startswith("GSF"), "GSF-* (app promo automatique)", "autre code"))
g = p.groupby("famille").agg(cmd=("name", "count"), brut=("ventes_brutes_ttc", "sum"), contrib=("contrib", "sum"), refund=("refunded", "sum")); g["part_cmd_%"] = (100 * g.cmd / g.cmd.sum()).round(1)
g["panier_ttc"] = (g.brut / g.cmd).round(0); g["contrib_par_cmd"] = (g.contrib / g.cmd).round(1); g["contrib_%_brut"] = (100 * g.contrib / g.brut).round(1); g["refund_%_brut"] = (100 * g.refund / g.brut).round(1)
print(g.round(0).to_string()); g.round(1).to_csv("tableaux/cx_04_codes_reduction.csv")
print(p[p.code].discount_codes.astype(str).str.replace(r"[A-Z0-9]{6,}$", "…", regex=True).value_counts().head(10).to_string())
print("contrib % brut TTC global:", round(100 * p.contrib.sum() / p.ventes_brutes_ttc.sum(), 1))
