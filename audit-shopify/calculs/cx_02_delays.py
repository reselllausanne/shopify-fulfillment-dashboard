"""Délais de traitement commande -> achat -> expédition (2026, DB). Entrée: tableaux/cx_02_order_timeline.csv. Sorties: tableaux/cx_02_delays_*.csv"""
import pandas as pd, numpy as np
d = pd.read_csv("audit-shopify/tableaux/cx_02_order_timeline.csv")
for c in ["created_at","min_buy","max_buy","ship_at","stx_del","cancelled_at","eta_max"]:
    d[c] = pd.to_datetime(d[c], format='mixed')  # naïf UTC
d["month"] = d.created_at.dt.strftime("%Y-%m")
d["cancelled"] = d.cancelled_at.notna() | d.financialStatus.isin(["VOIDED"])
d["refund_any"] = d.refundedAmountChf.fillna(0) > 0
d["has_ship"] = d.ship_at.notna()
# marge de classification
q = lambda s: pd.Series({"n": s.notna().sum(), "p25": s.quantile(.25), "med": s.median(), "p75": s.quantile(.75), "p90": s.quantile(.9), "mean": s.mean()})
print("Commandes 2026:", len(d)); print(d.financialStatus.value_counts().to_string())
print("\n== Part par mois : annulée, remboursée (>0), expédiée (enregistrement) ==")
g = d.groupby("month").agg(orders=("orderName","count"), cancelled=("cancelled","sum"), refunded=("refund_any","sum"), shipped_rec=("has_ship","sum"),
    gross=("totalSalesChf","sum"), refunded_chf=("refundedAmountChf","sum"))
print(g.to_string()); g.to_csv("audit-shopify/tableaux/cx_02_delays_mensuel_statuts.csv")
# délais : uniquement commandes avec enregistrement expédition ET sans annulation
s = d[d.has_ship & ~d.cancelled & (d.n_stx_lines.fillna(0) > 0)].copy()
s = s[(s.d_order_to_ship >= 0) & (s.d_order_to_ship < 120)]
print("\n== Commandes avec lignes StockX expédiées (enreg. fulfillment dès 2026-01-21):", len(s))
rows = []
for m, x in s.groupby("month"):
    r = {"month": m, "n": len(x)}
    for c in ["h_order_to_buy", "d_buy_to_warehouse", "d_order_to_ship", "d_buy_to_ship"]:
        v = x[c]; v = v[(v.notna())]
        r[c + "_med"] = round(v.median(), 2) if len(v) else None; r[c + "_p90"] = round(v.quantile(.9), 2) if len(v) else None; r[c + "_n"] = len(v)
    rows.append(r)
t = pd.DataFrame(rows); print(t.to_string()); t.to_csv("audit-shopify/tableaux/cx_02_delays_par_mois.csv", index=False)
# distribution globale commande -> expédition (jours calendaires) et en jours ouvrés
s["bd"] = [np.busday_count(a.date(), b.date()) for a, b in zip(s.created_at, s.ship_at)]
print("\nDistribution commande->expédition (jours cal.) lignes StockX, tous mois:"); print(s.d_order_to_ship.describe(percentiles=[.1,.25,.5,.75,.9,.95]).round(2).to_string())
print("Part expédiée <=5 j ouvrés:", round((s.bd <= 5).mean(), 3), "| <=10 j ouvrés:", round((s.bd <= 10).mean(), 3), "| >10 j ouvrés:", round((s.bd > 10).mean(), 3), "| >=15 j ouvrés:", round((s.bd >= 15).mean(), 3))
rec = s[s.created_at >= "2026-08-01"]
print("Depuis 2026-08-01 n=", len(rec), "médiane jours cal.", rec.d_order_to_ship.median(), "p90", rec.d_order_to_ship.quantile(.9), " bd<=10:", round((rec.bd <= 10).mean(), 3))
# express vs standard
for k, x in s.groupby("has_express"):
    print("express" if k else "standard", len(x), "méd. jours:", round(x.d_order_to_ship.median(), 2), "p90:", round(x.d_order_to_ship.quantile(.9), 2), "bd<=5:", round((x.bd <= 5).mean(), 3), "bd<=10:", round((x.bd <= 10).mean(), 3))
# commandes non expédiées anciennes (>14 j) payées non annulées
now = pd.Timestamp("2026-11-02 19:00"); ns = d[(~d.has_ship) & (~d.cancelled) & (d.financialStatus.isin(["PAID","PARTIALLY_REFUNDED"]))]
ns = ns.assign(age=(now - ns.created_at).dt.total_seconds() / 86400)
print("\nPayées non annulées SANS enregistrement d'expédition, par âge (j):"); print(pd.cut(ns.age, [0, 5, 10, 15, 30, 60, 400]).value_counts().sort_index().to_string())
print("dont avant 2026-01-21 (hors couverture du suivi):", (ns.created_at < "2026-01-21").sum())
# achat: part des lignes avec achat lié, heure d'achat
b = d[(d.n_stx_lines.fillna(0) > 0)]
print("\nCommandes avec lignes StockX:", len(b), "liées à un achat:", (b.n_stx_linked > 0).sum(), "| h commande->achat méd:", b.h_order_to_buy.median(), "p90:", b.h_order_to_buy.quantile(.9))
