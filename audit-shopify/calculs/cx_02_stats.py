"""Statistiques SAV/livraison 2026 : annulations, remboursements, retours, délais réels (données Shopify API + timeline + DB). Sorties tableaux/cx_02_*.csv"""
import json, re, pandas as pd, numpy as np
d = pd.read_csv("audit-shopify/tableaux/cx_02_orders_events.csv")
for c in ["created", "cancelled", "ship_at", "ev_placed", "ev_conf_mail", "ev_ship_mail", "ev_ofd", "ev_delivered"]: d[c] = pd.to_datetime(d[c], utc=True)
t = pd.read_csv("audit-shopify/tableaux/cx_02_order_timeline.csv")[["orderName", "has_express", "n_stx_lines", "has_stock_line", "min_buy", "max_buy", "eta_max", "stx_del"]]
d = d.merge(t, left_on="name", right_on="orderName", how="left")
NOW = pd.Timestamp("2026-11-02 20:00", tz="UTC")
d["age_d"] = (NOW - d.created).dt.total_seconds() / 86400
d["is_cancel"] = d.cancelled.notna()
d["fully_ref"] = d.fin == "REFUNDED"; d["part_ref"] = d.fin == "PARTIALLY_REFUNDED"
d["ret"] = d.n_returns > 0
# --- 1. mensuel (toutes commandes 2026)
g = d.groupby("month").agg(commandes=("name", "count"), annulees=("is_cancel", "sum"), remb_total=("fully_ref", "sum"), remb_partiel=("part_ref", "sum"), retours_shopify=("ret", "sum"),
     ventes_brutes_chf=("gross", "sum"), rembourse_chf=("refunded", "sum"), non_expediees=("ful", lambda s: (s == "UNFULFILLED").sum()))
g["taux_remb_total_%"] = (100 * g.remb_total / g.commandes).round(1); g["taux_retours_%"] = (100 * g.retours_shopify / g.commandes).round(1); g["taux_annul_%"] = (100 * g.annulees / g.commandes).round(1)
g["rembourse_%_ventes"] = (100 * g.rembourse_chf / g.ventes_brutes_chf).round(1)
print(g.to_string()); g.to_csv("audit-shopify/tableaux/cx_02_sav_mensuel.csv")
tot = d[d.month <= "2026-10"]
print("\nTOTAL jan-oct:", len(tot), "annulées", tot.is_cancel.sum(), "remb total", tot.fully_ref.sum(), "remb partiel", tot.part_ref.sum(), "retours obj", tot.ret.sum(),
      "| ventes brutes", round(tot.gross.sum()), "remboursé", round(tot.refunded.sum()), round(100 * tot.refunded.sum() / tot.gross.sum(), 1), "%")
print("Part commandes avec >=1 remboursement:", round(100 * ((tot.fully_ref | tot.part_ref).mean()), 1), "% ; 'refund events' >0:", (tot.n_refunds > 0).sum())
# --- 1b. type de remboursement (par commande remboursée) : annulation / retour (return obj) / autre
r = tot[(tot.n_refunds > 0)].copy()
r["type"] = np.where(r.is_cancel, "annulation", np.where(r.ret, "retour (objet Shopify Returns)", "remboursement hors retour/annulation (partiel, geste, erreur…)"))
print("\nCommandes avec remboursement par type:"); print(r.type.value_counts().to_string())
print(r.groupby("type").refunded.agg(["count", "sum", "median"]).round(1).to_string())
# --- 1c. motifs de remboursement via notes (timeline)
kw = {"retard / non expédié / non livré": r"retard|non exp|non livr|depuis \d+ mois|non trait", "indisponible / achat impossible": r"introuvable|prix impossible|non achet|vendue à double|stock", "annulation client": r"annulation|annul|cancel", "express/standard (écart de frais)": r"express"}
cnt = {k: 0 for k in kw}; cnt["(sans note)"] = 0; cnt["autre note"] = 0; total_ref = 0
for l in open("audit-shopify/donnees_brutes/cx_orders_timeline_2026.ndjson"):
    o = json.loads(l)
    for rf in o["refunds"]:
        total_ref += 1; n = (rf["note"] or "").lower().strip()
        if not n: cnt["(sans note)"] += 1; continue
        if n == "order canceled": cnt["annulation client"] += 1; continue
        hit = [k for k, p in kw.items() if re.search(p, n)]
        if hit: cnt[hit[0]] += 1
        else: cnt["autre note"] += 1
print("\nNotes de remboursement (", total_ref, "remboursements):", cnt)
pd.Series(cnt).to_csv("audit-shopify/tableaux/cx_02_refund_notes.csv", header=["n"])
# --- 2. non expédiées
ue = d[(d.ful.isin(["UNFULFILLED", "PARTIALLY_FULFILLED", "ON_HOLD"])) & (~d.is_cancel) & (d.fin.isin(["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"]))]
print("\nNon (entièrement) expédiées, payées, non annulées, par âge (j):"); print(pd.cut(ue.age_d, [0, 3, 7, 10, 14, 21, 30, 60, 400]).value_counts().sort_index().to_string())
ue_old = ue[ue.age_d > 14]; print("âge>14j:", len(ue_old), "dont n° commandes:", ue_old.name.tolist()[:25])
# --- 3. délais réels sur la fenêtre avec événements
w = d[d.has_events_window & (d.country == "CH") & (~d.is_cancel)].copy()
bd = lambda a, b: np.busday_count(a.tz_convert("Europe/Zurich").date(), b.tz_convert("Europe/Zurich").date()) if pd.notna(a) and pd.notna(b) else np.nan
w["bd_ship"] = [bd(a, b) for a, b in zip(w.created, w.ship_at)]; w["bd_deliv"] = [bd(a, b) for a, b in zip(w.created, w.ev_delivered)]
w["d_ship"] = (w.ship_at - w.created).dt.total_seconds() / 86400; w["d_deliv"] = (w.ev_delivered - w.created).dt.total_seconds() / 86400; w["d_transit"] = (w.ev_delivered - w.ship_at).dt.total_seconds() / 86400
w["mode"] = np.where(w.has_express == True, "express", "standard")
only_stock = w[(w.n_stx_lines.fillna(0) == 0)]
w_stx = w[w.n_stx_lines.fillna(0) > 0]
def q(s): s = s.dropna(); return pd.Series({"n": len(s), "p25": s.quantile(.25), "med": s.median(), "p75": s.quantile(.75), "p90": s.quantile(.9)}).round(1)
print("\nFenêtre événements (>= mi-août): commandes CH non annulées:", len(w), "| avec lignes StockX:", len(w_stx), "| sans StockX (stock/essentials):", len(only_stock))
out = []
for name, x in [("StockX standard", w_stx[w_stx["mode"] == "standard"]), ("StockX express", w_stx[w_stx["mode"] == "express"]), ("Hors StockX (stock/essentials/autre)", only_stock)]:
    for col, lab in [("d_ship", "commande->expédition (j cal.)"), ("d_transit", "expédition->livré (j cal.)"), ("d_deliv", "commande->livré (j cal.)"), ("bd_ship", "commande->expédition (j ouvrés)"), ("bd_deliv", "commande->livré (j ouvrés)")]:
        s = q(x[col]); out.append({"segment": name, "mesure": lab, **s.to_dict()})
res = pd.DataFrame(out); print(res.to_string()); res.to_csv("audit-shopify/tableaux/cx_02_delais_reels.csv", index=False)
# promesse vs réalité (sur commandes livrées = survivants ; + expédiées)
for name, x, lim in [("standard (promesse 5-10 j ouvrés)", w_stx[w_stx["mode"] == "standard"], 10), ("express (promesse 2-5 j ouvrés)", w_stx[w_stx["mode"] == "express"], 5)]:
    dl = x[x.ev_delivered.notna()]; sh = x[x.ship_at.notna()]
    print(f"{name}: commandes {len(x)}, expédiées {len(sh)}, livrées (mail delivered) {len(dl)}; part livrée <= {lim} j ouvrés: {round(100*(dl.bd_deliv<=lim).mean(),1)}% des livrées ; part expédiée <= {lim-1} j ouvrés: {round(100*(sh.bd_ship<=lim-1).mean(),1)}% des expédiées; non encore expédiées à ce jour: {x.ship_at.isna().sum()}")
# couverture du mail 'delivered'
print("\nShipped sans mail 'delivered':", (w.ship_at.notna() & w.ev_delivered.isna()).sum(), "de", w.ship_at.notna().sum(), "(âge médian de ceux-ci j:", round(w[w.ship_at.notna() & w.ev_delivered.isna()].age_d.median(), 1), ")")
# --- 4. écart ETA affichée vs réel (DB eta_max StockX) non pertinent ici
# --- 5. e-mails: confirmation / expédition / livraison
print("\nEmail confirmation commande envoyé (fenêtre):", w.ev_conf_mail.notna().mean().round(3), "| expédition (Swiss Post Labels):", w.ev_ship_mail.notna().mean().round(3))
conf = (w.ev_conf_mail - w.ev_placed).dt.total_seconds()
print("Confirmation: délai médian après commande (s):", conf.median())
# --- 6. paiements échoués (tentatives) / modes de paiement
print("\nPaiement: commandes avec >=1 échec de tentative (fenêtre):", (d[d.has_events_window].pay_fail > 0).mean().round(3))
print(d.gateway.value_counts().head(8).to_string())
d.to_csv("audit-shopify/tableaux/cx_02_orders_enriched.csv", index=False)
