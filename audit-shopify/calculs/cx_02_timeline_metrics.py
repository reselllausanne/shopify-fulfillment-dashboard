"""Délais réels commande -> expédition -> livraison (e-mail 'delivered' Swiss Post Labels) + SAV/refunds/returns depuis la timeline Shopify 2026.
Entrée: donnees_brutes/cx_orders_timeline_2026.ndjson (+ orders_api.ndjson pour pays/option livraison). Sortie: tableaux/cx_02_orders_events.csv, cx_02_*."""
import json, re, pandas as pd, numpy as np
rows = []
api = {}
for l in open("audit-shopify/donnees_brutes/orders_api.ndjson"):
    o = json.loads(l)
    if o["createdAt"] < "2026-01-01": continue
    sl = o["shippingLines"]["nodes"]
    api[o["name"]] = dict(country=(o.get("shippingAddress") or o.get("billingAddress") or {}).get("countryCodeV2"), ship_title=(sl[0]["title"] if sl else None),
        ship_price=float(sl[0]["discountedPriceSet"]["shopMoney"]["amount"]) if sl else None, gross=float(o["totalPriceSet"]["shopMoney"]["amount"]), refunded=float(o["totalRefundedSet"]["shopMoney"]["amount"]),
        n_refunds=len(o["refunds"]), n_returns=len(o["returns"]["nodes"]), gateway=(o["paymentGatewayNames"] or [None])[0], cust=(o.get("customer") or {}).get("id"),
        idx=(o.get("customerJourneySummary") or {}).get("customerOrderIndex"), cur=o["currencyCode"], disc=o["discountCodes"], pres=o["presentmentCurrencyCode"])
for l in open("audit-shopify/donnees_brutes/cx_orders_timeline_2026.ndjson"):
    o = json.loads(l); ev = o["events"]
    def first(pat, t=None):
        xs = [e["at"] for e in ev if re.search(pat, e["m"] or "") and (t is None or e["t"] == t)]
        return min(xs) if xs else None
    f = [x for x in o["fulfillments"] if x["status"] == "SUCCESS"]
    r = dict(name=o["name"], created=o["createdAt"], cancelled=o["cancelledAt"], cancel_reason=o["cancelReason"], fin=o["displayFinancialStatus"], ful=o["displayFulfillmentStatus"],
        ship_at=min([x["createdAt"] for x in f]) if f else None, has_events_window=any("placed this order" in (e["m"] or "") for e in ev),
        ev_placed=first("placed this order"), ev_conf_mail=first("Order confirmation email was sent"), ev_ship_mail=first("shipping confirmation email"),
        ev_ofd=first("out for delivery email"), ev_delivered=first("shipment delivered email"), ev_ship_update=first("shipping update email"),
        n_refund_events=sum(1 for e in ev if re.search("refunded|refund was|refund is pending", e["m"] or "")),
        store_credit=any("Store Credit for return" in (e["m"] or "") for e in ev), ret_approved=any("approved return" in (e["m"] or "") for e in ev),
        ret_request_mail=any("Return request confirmation email" in (e["m"] or "") for e in ev), restock=any("restocked" in (e["m"] or "") for e in ev),
        canceled_fulfillment=any("canceled fulfillment" in (e["m"] or "") for e in ev), addr_edit=any("edited the shipping address" in (e["m"] or "") for e in ev),
        edited=any("edited this order" in (e["m"] or "") for e in ev), pay_fail=sum(1 for e in ev if "Unable to process a payment" in (e["m"] or "")),
        note=bool(o["note"]), n_ret_obj=len(o["returns"]["nodes"]), tags=",".join(o["tags"]), n_comments=sum(1 for e in ev if e["t"] == "CommentEvent"))
    r.update(api.get(o["name"], {})); rows.append(r)
d = pd.DataFrame(rows)
for c in ["created", "cancelled", "ship_at", "ev_placed", "ev_conf_mail", "ev_ship_mail", "ev_ofd", "ev_delivered", "ev_ship_update"]: d[c] = pd.to_datetime(d[c], utc=True)
d["month"] = d.created.dt.strftime("%Y-%m")
d.to_csv("audit-shopify/tableaux/cx_02_orders_events.csv", index=False)
print("orders", len(d), "| events window coverage by month (share of orders with 'placed' event):")
print(d.groupby("month").agg(n=("name", "count"), with_events=("has_events_window", "sum")).to_string())
