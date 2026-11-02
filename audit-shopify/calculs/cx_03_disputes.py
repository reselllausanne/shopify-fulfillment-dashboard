"""Motifs des litiges de paiement (Shopify Payments) – disputes.ndjson. Sans PII (pas de noms)."""
import json, pandas as pd
r = []
for l in open("donnees_brutes/disputes.ndjson"):
    d = json.loads(l); rd = d.get("reasonDetails") or {}
    r.append(dict(date=d["initiatedAt"][:7], status=d["status"], type=d["type"], reason=rd.get("reason"), code=rd.get("networkReasonCode"), amt=float(d["amount"]["amount"]), order=(d.get("order") or {}).get("name")))
D = pd.DataFrame(r); D = D[D.date >= "2025-11"]
print(len(D)); print(D.groupby("reason").amt.agg(["count", "sum"]).round(0).sort_values("count", ascending=False))
print(D.groupby(["reason", "status"]).size().unstack(fill_value=0))
D.drop(columns=["order"]).to_csv("tableaux/cx_03_litiges_motifs.csv", index=False)
