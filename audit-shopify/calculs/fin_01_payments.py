"""Shopify Payments : frais réels, délais de payout, litiges (lecture des extractions API).
Entrées : donnees_brutes/{balance_transactions,payouts,disputes}.ndjson
Sorties : tableaux/fin_01_payments_*.csv + affichage console.
"""
import json, pandas as pd, pathlib
R = pathlib.Path(__file__).resolve().parents[1]
D, T = R / "donnees_brutes", R / "tableaux"
T.mkdir(exist_ok=True)
rd = lambda f: [json.loads(l) for l in open(D / f)]

bt = pd.DataFrame(rd("balance_transactions.ndjson"))
bt["date"] = pd.to_datetime(bt.transactionDate, utc=True).dt.tz_convert("Europe/Zurich")
for c in ["amount", "fee", "net"]:
    bt[c + "_v"] = bt[c].apply(lambda x: float(x["amount"]) if x else 0.0)
bt["cur"] = bt.amount.apply(lambda x: x["currencyCode"] if x else None)
bt["mois"] = bt.date.dt.strftime("%Y-%m")
print("devises:", bt.cur.value_counts().to_dict())
print("période:", bt.date.min(), "->", bt.date.max(), len(bt), "lignes")
g = bt.groupby("type").agg(n=("id", "count"), brut=("amount_v", "sum"), frais=("fee_v", "sum"), net=("net_v", "sum")).round(2)
print(g)
g.to_csv(T / "fin_01_payments_par_type.csv")

ch = bt[bt.type == "CHARGE"]
m = ch.groupby("mois").agg(n=("id", "count"), brut=("amount_v", "sum"), frais=("fee_v", "sum")).round(2)
m["taux_frais_pct"] = (m.frais / m.brut * 100).round(2)
print(m)
m.to_csv(T / "fin_01_payments_frais_par_mois_charges.csv")
tot = ch.amount_v.sum(); tf = ch.fee_v.sum()
print(f"Charges Shopify Payments : brut {tot:,.0f} CHF, frais {tf:,.0f} CHF = {tf/tot*100:.2f} %  (frais fixe+% effectifs)")

ref = bt[bt.type == "REFUND"]
print("Refunds:", len(ref), round(ref.amount_v.sum(), 0), "frais", round(ref.fee_v.sum(), 2))
adj = bt[bt.type.isin(["DISPUTE_WITHDRAWAL","DISPUTE_REVERSAL","REFUND_FAILURE","SHOP_CASH_CREDIT"])]
print(adj.groupby("type").agg(n=("id", "count"), amount=("amount_v", "sum"), fee=("fee_v", "sum")).round(2))

po = pd.DataFrame(rd("payouts.ndjson"))
po["date"] = pd.to_datetime(po.issuedAt, utc=True).dt.tz_convert("Europe/Zurich")
po["net_v"] = po.net.apply(lambda x: float(x["amount"]))
po["mois"] = po.date.dt.strftime("%Y-%m")
print("payouts statuts:", po.status.value_counts().to_dict())
pm = po.groupby("mois").agg(n=("id", "count"), net=("net_v", "sum")).round(0)
print(pm)
pm.to_csv(T / "fin_01_payments_payouts_par_mois.csv")

# délai charge -> payout
bt["payout_id"] = bt.associatedPayout.apply(lambda x: x["id"] if x else None)
pmap = po.set_index("id").date
ch2 = bt[(bt.type == "CHARGE") & bt.payout_id.notna()].copy()
ch2["payout_date"] = ch2.payout_id.map(pmap)
ch2["lag_j"] = (ch2.payout_date - ch2.date).dt.total_seconds() / 86400
print("Délai charge->payout (jours) :", ch2.lag_j.describe().round(2).to_dict())
print("Charges sans payout associé :", int(((bt.type == "CHARGE") & bt.payout_id.isna()).sum()))

dp = pd.DataFrame(rd("disputes.ndjson"))
if len(dp):
    dp["amt"] = dp.amount.apply(lambda x: float(x["amount"]))
    dp["date"] = pd.to_datetime(dp.initiatedAt, utc=True).dt.tz_convert("Europe/Zurich").dt.strftime("%Y-%m")
    print("Litiges:", len(dp), "montant", dp.amt.sum(), dp.status.value_counts().to_dict(), dp.reasonDetails.apply(lambda x: x["reason"] if x else None).value_counts().to_dict())
    dp[["id", "date", "status", "type", "amt"]].to_csv(T / "fin_01_payments_litiges.csv", index=False)
