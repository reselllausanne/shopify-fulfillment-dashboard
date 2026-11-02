"""Aplatit l'export API des commandes Shopify (orders_api.ndjson) en tables CSV sans PII.
Sorties (tableaux/ ; donnees_brutes/ pour les fichiers volumineux) :
  donnees_brutes/orders_flat.csv  : 1 ligne / commande
  donnees_brutes/lines_flat.csv   : 1 ligne / ligne de commande
Montants en CHF (devise boutique) sauf mention. Dates en Europe/Zurich + UTC.
"""
import json, pandas as pd, pathlib
R = pathlib.Path(__file__).resolve().parents[1]
D = R / "donnees_brutes"
f = lambda m: float(m["shopMoney"]["amount"]) if m else 0.0
orders, lines, txs, refs = [], [], [], []
for l in open(D / "orders_api.ndjson"):
    o = json.loads(l)
    jr = o.get("customerJourneySummary") or {}
    fv, lv = (jr.get("firstVisit") or {}), (jr.get("lastVisit") or {})
    fu, lu = (fv.get("utmParameters") or {}), (lv.get("utmParameters") or {})
    cust = o.get("customer") or {}
    fees = sum(float(fe["amount"]["amount"]) for t in o["transactions"] for fe in (t.get("fees") or []))
    tax_rates = sorted({round(float(tl["rate"]) * 100, 2) for li in o["lineItems"]["nodes"] for tl in li["taxLines"]})
    orders.append(dict(
        id=o["id"], name=o["name"], created_utc=o["createdAt"], cancelled_utc=o["cancelledAt"], cancel_reason=o["cancelReason"], test=o["test"],
        fin=o["displayFinancialStatus"], ful=o["displayFulfillmentStatus"], source=o["sourceName"], tags="|".join(o["tags"]),
        gateways="+".join(sorted(o["paymentGatewayNames"])), cur=o["currencyCode"], pres_cur=o["presentmentCurrencyCode"], taxes_incl=o["taxesIncluded"],
        total_orig=f(o["totalPriceSet"]), total_cur=f(o["currentTotalPriceSet"]), subtotal=f(o["subtotalPriceSet"]), discounts=f(o["totalDiscountsSet"]),
        ship=f(o["totalShippingPriceSet"]), tax=f(o["totalTaxSet"]), tax_cur=f(o["currentTotalTaxSet"]), refunded=f(o["totalRefundedSet"]), refunded_ship=f(o["totalRefundedShippingSet"]),
        ship_cc=(o.get("shippingAddress") or {}).get("countryCodeV2"), bill_cc=(o.get("billingAddress") or {}).get("countryCodeV2"),
        cust_id=cust.get("id"), cust_n_orders=cust.get("numberOfOrders"), cust_created=cust.get("createdAt"), cust_order_idx=jr.get("customerOrderIndex"), days_to_conv=jr.get("daysToConversion"),
        f_source=fv.get("source"), f_type=fv.get("sourceType"), f_ref=fv.get("referrerUrl"), f_land=fv.get("landingPage"), f_utm_src=fu.get("source"), f_utm_med=fu.get("medium"), f_utm_cmp=fu.get("campaign"),
        l_source=lv.get("source"), l_type=lv.get("sourceType"), l_ref=lv.get("referrerUrl"), l_land=lv.get("landingPage"), l_utm_src=lu.get("source"), l_utm_med=lu.get("medium"), l_utm_cmp=lu.get("campaign"),
        discount_codes="|".join(o["discountCodes"]), ship_title="|".join(s["title"] for s in o["shippingLines"]["nodes"]),
        n_lines=len(o["lineItems"]["nodes"]), n_units=sum(x["quantity"] for x in o["lineItems"]["nodes"]), n_refunds=len(o["refunds"]), n_returns=len(o["returns"]["nodes"]),
        pay_fees=fees, tax_rates="|".join(map(str, tax_rates)),
    ))
    for li in o["lineItems"]["nodes"]:
        lines.append(dict(order_id=o["id"], order=o["name"], created_utc=o["createdAt"], line_id=li["id"], title=li["title"], variant=li["variantTitle"], sku=li["sku"], qty=li["quantity"], vendor=li["vendor"],
                          ptype=(li["product"] or {}).get("productType"), product_id=(li["product"] or {}).get("id"), orig_total=f(li["originalTotalSet"]), disc_total=f(li["discountedTotalSet"]),
                          tax_line=sum(f(tl["priceSet"]) for tl in li["taxLines"])))
    for t in o["transactions"]:
        txs.append(dict(order=o["name"], kind=t["kind"], status=t["status"], gateway=t["gateway"], processed=t["processedAt"], amount=f(t["amountSet"]),
                        fee=sum(float(fe["amount"]["amount"]) for fe in (t.get("fees") or []))))
    for r in o["refunds"]:
        refs.append(dict(order=o["name"], refund_id=r["id"], created_utc=r["createdAt"], note=(r["note"] or "")[:80], total=f(r["totalRefundedSet"]),
                         items="|".join(f'{x["quantity"]}:{x["restockType"]}' for x in r["refundLineItems"]["nodes"])))
pd.DataFrame(orders).to_csv(D / "orders_flat.csv", index=False)
pd.DataFrame(lines).to_csv(D / "lines_flat.csv", index=False)
pd.DataFrame(txs).to_csv(D / "transactions_flat.csv", index=False)
pd.DataFrame(refs).to_csv(D / "refunds_flat.csv", index=False)
print(len(orders), "commandes;", len(lines), "lignes;", len(txs), "transactions;", len(refs), "remboursements")
