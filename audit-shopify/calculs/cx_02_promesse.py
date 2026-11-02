"""Promesse affichée vs réalité (commandes CH StockX, créées >= 2026-08-15, non annulées). Livraison estimée = expédition + transit médian observé (3.5 j cal.) si pas de mail 'delivered'. Non expédiées = échec de la promesse si âge > promesse."""
import pandas as pd, numpy as np
d = pd.read_csv("audit-shopify/tableaux/cx_02_orders_enriched.csv")
for c in ["created", "ship_at", "ev_delivered"]: d[c] = pd.to_datetime(d[c], utc=True)
w = d[d.has_events_window & (d.country == "CH") & d.cancelled.isna() & (d.n_stx_lines.fillna(0) > 0) & (d.created >= "2026-08-15")].copy()
NOW = pd.Timestamp("2026-11-02 20:00", tz="UTC"); TR = 3.5
w["mode"] = np.where(w.has_express == True, "express (promesse 2-5 j ouvrés)", "standard (promesse 5-10 j ouvrés)")
w["deliv_est"] = w.ev_delivered.fillna(w.ship_at + pd.Timedelta(days=TR))
bd = lambda a, b: np.busday_count(a.tz_convert("Europe/Zurich").date(), b.tz_convert("Europe/Zurich").date())
rows = []
for m, x in w.groupby("mode"):
    lim = 5 if m.startswith("express") else 10
    # âge en jours ouvrés pour les non expédiées
    x = x.copy(); x["bd_deliv_est"] = [bd(a, b) if pd.notna(b) else np.nan for a, b in zip(x.created, x.deliv_est)]
    x["age_bd"] = [bd(a, NOW) for a in x.created]
    ok = (x.bd_deliv_est <= lim)
    unsh = x.ship_at.isna(); late_unsh = unsh & (x.age_bd > lim)
    pend = unsh & (x.age_bd <= lim)  # encore dans la promesse
    n = len(x) - pend.sum()  # commandes dont la promesse est échue ou livrées
    rows.append(dict(mode=m, commandes=len(x), non_expediees=int(unsh.sum()), encore_dans_promesse=int(pend.sum()), echues=int(n), livraison_estimee_dans_promesse=int(ok.sum()), part_echues_dans_promesse_pct=round(100 * ok.sum() / n, 1),
                     mediane_livraison_estimee_jo=float(x.bd_deliv_est.median()), p90_jo=float(x.bd_deliv_est.quantile(.9))))
R = pd.DataFrame(rows); print(R.T.to_string()); R.to_csv("audit-shopify/tableaux/cx_02_promesse_vs_reel.csv", index=False)
