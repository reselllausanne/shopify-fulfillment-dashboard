"""Remboursements 2026 par moyen (crédit magasin vs moyen d'origine), par type (annulation / retour / autre), délai commande->remboursement. Source orders_api.ndjson."""
import json, pandas as pd, numpy as np
tx = []; ords = []
for l in open("audit-shopify/donnees_brutes/orders_api.ndjson"):
    o = json.loads(l)
    if o["test"] or o["createdAt"] < "2026-01-01": continue
    has_ret = len(o["returns"]["nodes"] if isinstance(o["returns"], dict) else o["returns"]) > 0
    trs = o["transactions"]; trs = trs["nodes"] if isinstance(trs, dict) else trs
    gws = set(t["gateway"] for t in trs if t["kind"] in ("SALE", "CAPTURE") and t["status"] == "SUCCESS")
    ords.append(dict(name=o["name"], created=o["createdAt"], canc=o["cancelledAt"] is not None, has_ret=has_ret, gross=float(o["totalPriceSet"]["shopMoney"]["amount"]), paid_sc="shopify_store_credit" in gws, fin=o["displayFinancialStatus"]))
    for t in trs:
        if t["kind"] == "REFUND" and t["status"] == "SUCCESS":
            tx.append(dict(name=o["name"], gw=t["gateway"], amt=float(t["amountSet"]["shopMoney"]["amount"]), proc=t["processedAt"], created=o["createdAt"], canc=o["cancelledAt"] is not None, has_ret=has_ret))
T = pd.DataFrame(tx); O = pd.DataFrame(ords)
T["type"] = np.where(T.canc, "annulation", np.where(T.has_ret, "retour", "autre"))
T["gw2"] = np.where(T.gw == "shopify_store_credit", "crédit magasin", "moyen de paiement d'origine")
g = T.pivot_table(index="type", columns="gw2", values="amt", aggfunc=["count", "sum"], fill_value=0).round(0); print(g.to_string())
print("\nTotal remboursé 2026 (CHF):", round(T.amt.sum()), "| dont crédit magasin:", round(T[T.gw2 == 'crédit magasin'].amt.sum()), f"({100*T[T.gw2=='crédit magasin'].amt.sum()/T.amt.sum():.1f}%)")
r = T[T.type == "retour"]; print("Retours: part crédit magasin (montant):", round(100 * r[r.gw2 == 'crédit magasin'].amt.sum() / r.amt.sum(), 1), "% ; nb transactions", len(r), "crédit:", int((r.gw2 == 'crédit magasin').sum()))
T["delai_j"] = (pd.to_datetime(T.proc, utc=True) - pd.to_datetime(T.created, utc=True)).dt.total_seconds() / 86400
print("\nDélai commande -> remboursement (j): ", T.groupby("type").delai_j.describe(percentiles=[.5, .9]).round(1)[["count", "50%", "90%"]].to_string())
# commandes payées avec crédit magasin
a = O[O.paid_sc]; print("\nCommandes 2026 payées (en partie) en crédit magasin:", len(a), "| brut CHF", round(a.gross.sum()), "| statuts:", a.fin.value_counts().to_dict())
T.groupby(["type", "gw2"]).amt.agg(["count", "sum", "median"]).round(1).to_csv("audit-shopify/tableaux/cx_02_remboursements_par_moyen.csv")
# mensuel par moyen
T["m"] = T.proc.str[:7]; print(T.pivot_table(index="m", columns="gw2", values="amt", aggfunc="sum", fill_value=0).round(0).to_string())
