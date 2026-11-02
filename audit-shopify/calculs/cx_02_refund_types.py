"""Nature des remboursements 2026 (restockType des lignes remboursées, remboursement de livraison). Source orders_api.ndjson."""
import json, collections, pandas as pd
rows = []
for l in open("audit-shopify/donnees_brutes/orders_api.ndjson"):
    o = json.loads(l)
    if o["test"] or o["createdAt"] < "2026-01-01": continue
    rets = o["returns"]["nodes"] if isinstance(o["returns"], dict) else o["returns"]
    for r in o["refunds"]:
        nodes = r["refundLineItems"]["nodes"]; rt = sorted(set(n["restockType"] for n in nodes)) or ["(aucune ligne: montant seul/livraison)"]
        amt = float(r["totalRefundedSet"]["shopMoney"]["amount"]); lines_amt = sum(float(n["subtotalSet"]["shopMoney"]["amount"]) for n in nodes)
        rows.append(dict(name=o["name"], canc=o["cancelledAt"] is not None, has_ret=bool(rets), types="+".join(rt), amt=amt, lines_amt=lines_amt, month=r["createdAt"][:7]))
D = pd.DataFrame(rows)
D["cat"] = D.types.map(lambda t: "ligne retournée/RETURN" if "RETURN" in t else "ligne annulée/CANCEL (stock non expédié)" if "CANCEL" in t else "sans restock (NO_RESTOCK/LEGACY)" if "NO_RESTOCK" in t or "LEGACY" in t else "montant seul/livraison" if t.startswith("(aucune") else t)
g = D.groupby("cat").agg(n=("amt", "count"), chf=("amt", "sum"), med=("amt", "median")).round(0); print(g.to_string()); g.to_csv("audit-shopify/tableaux/cx_02_remboursements_nature.csv")
print("\nRemboursement de montant seul: part ~ écart de livraison/geste (montant < 40 CHF):", int(((D.cat == 'montant seul/livraison') & (D.amt < 40)).sum()), "/", int((D.cat == 'montant seul/livraison').sum()))
x = D[~D.canc & ~D.has_ret]; print("Hors annulation/retour:", len(x), "remboursements; par catégorie:", x.cat.value_counts().to_dict(), "| CHF", round(x.amt.sum()))
print("\nNO_RESTOCK avec/sans objet Return Shopify, annulée ou non:")
n = D[D.cat.str.startswith("sans restock")]
print(n.groupby(["has_ret", "canc"]).amt.agg(["count", "sum"]).round(0).to_string())
D["bucket"] = D.apply(lambda r: "retour physique (objet Return ou restock RETURN)" if (r.has_ret or "RETURN" in r.types) else "annulation avant expédition (commande annulée ou CANCEL)" if (r.canc or "CANCEL" in r.types) else "autre: ligne remboursée sans retour ni annulation (NO_RESTOCK/montant seul)", axis=1)
b = D.groupby("bucket").agg(n=("amt", "count"), chf=("amt", "sum")).round(0); b["part_chf_%"] = (100 * b.chf / b.chf.sum()).round(1); print(b.to_string()); b.to_csv("audit-shopify/tableaux/cx_02_remboursements_buckets.csv")
