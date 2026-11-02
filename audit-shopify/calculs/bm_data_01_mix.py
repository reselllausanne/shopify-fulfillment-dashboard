#!/usr/bin/env python3
"""bm_data_01 : mix des ventes Shopify (pays, marque, tranche de prix, source/SEO, langue de landing, récurrence)
à partir de donnees_brutes/orders_api.ndjson (export API Admin, lecture seule). Aucune PII écrite.
Sorties : tableaux/bm_mix_*.csv ; résumé en stdout.
Définitions : CA brut TTC = totalPriceSet (avant remboursements) ; CA conservé TTC = currentTotalPriceSet ;
remboursé = totalRefundedSet ; commandes = non-test, non annulées (cancelledAt null) sauf mention.
Montants CHF (devise boutique), TVA incluse (taxesIncluded=true), livraison incluse.
"""
import json, os, re, collections
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "donnees_brutes", "orders_api.ndjson")
OUT = os.path.join(ROOT, "tableaux")

f = lambda d, *k: (d or {}).get(k[0]) if len(k) == 1 else f((d or {}).get(k[0]), *k[1:])
amt = lambda s: float(f(s, "shopMoney", "amount") or 0)

orders, lines = [], []
with open(SRC) as fh:
    for ln in fh:
        o = json.loads(ln)
        if o.get("test"):
            continue
        cj = o.get("customerJourneySummary") or {}
        fv, lv = cj.get("firstVisit") or {}, cj.get("lastVisit") or {}
        land = fv.get("landingPage") or ""
        m = re.match(r"https?://[^/]+/(de|en|it|fr)(/|$)", land)
        taxrates = sorted({t["rate"] for li in (o.get("lineItems") or {}).get("nodes", []) for t in li.get("taxLines", [])})
        rec = {
            "name": o["name"], "created": o["createdAt"], "month": o["createdAt"][:7], "year": o["createdAt"][:4],
            "cancelled": bool(o.get("cancelledAt")), "fin": o.get("displayFinancialStatus"), "ful": o.get("displayFulfillmentStatus"),
            "gross": amt(o.get("totalPriceSet")), "kept": amt(o.get("currentTotalPriceSet")), "refunded": amt(o.get("totalRefundedSet")),
            "shipping": amt(o.get("totalShippingPriceSet")), "tax": amt(o.get("totalTaxSet")), "discounts": amt(o.get("totalDiscountsSet")),
            "currency": o.get("currencyCode"), "presentment": o.get("presentmentCurrencyCode"),
            "ship_cc": f(o, "shippingAddress", "countryCodeV2") or f(o, "billingAddress", "countryCodeV2") or "NA",
            "gateway": ",".join(o.get("paymentGatewayNames") or []), "source": o.get("sourceName"),
            "fv_source": fv.get("source"), "fv_type": fv.get("sourceType"), "lv_source": lv.get("source"), "lv_type": lv.get("sourceType"),
            "land_lang": m.group(1) if m else ("fr" if land else "NA"), "land_is_product": "/products/" in land,
            "order_index": cj.get("customerOrderIndex"), "days_to_conv": cj.get("daysToConversion"),
            "n_discount_codes": len(o.get("discountCodes") or []), "tax_rates": ",".join(map(str, taxrates)),
            "n_lines": len((o.get("lineItems") or {}).get("nodes", [])),
        }
        orders.append(rec)
        for li in (o.get("lineItems") or {}).get("nodes", []):
            q = li.get("quantity") or 1
            lines.append({"name": o["name"], "month": rec["month"], "year": rec["year"], "ship_cc": rec["ship_cc"], "vendor": li.get("vendor") or "NA",
                          "ptype": f(li, "product", "productType") or "NA", "qty": q, "line_total": amt(li.get("discountedTotalSet")),
                          "unit": amt(li.get("discountedTotalSet")) / q if q else 0, "cancelled": rec["cancelled"]})

O = pd.DataFrame(orders)
L = pd.DataFrame(lines)
O["is_valid"] = ~O["cancelled"]
print("orders", len(O), "from", O.created.min(), "to", O.created.max())

# 1) mensuel
mth = O[O.is_valid].groupby("month").agg(orders=("name", "count"), gross_ttc=("gross", "sum"), kept_ttc=("kept", "sum"), refunded=("refunded", "sum"),
                                         aov_kept=("kept", "mean")).round(1)
mth.to_csv(os.path.join(OUT, "bm_mix_mensuel.csv"))

# 2) pays (2026 YTD et 12 derniers mois)
def by_country(df, label):
    g = df[df.is_valid].groupby("ship_cc").agg(orders=("name", "count"), kept_ttc=("kept", "sum"), aov=("kept", "mean"), shipping=("shipping", "sum"),
                                              tax=("tax", "sum"), refunded=("refunded", "sum")).round(1)
    g["share_orders_%"] = (100 * g.orders / g.orders.sum()).round(2)
    g["period"] = label
    return g.sort_values("orders", ascending=False)

periods = {"2026-01..10": O[(O.month >= "2026-01") & (O.month <= "2026-10")], "2025-11..2026-10": O[(O.month >= "2025-11") & (O.month <= "2026-10")], "2025": O[O.year == "2025"], "all": O}
pc = pd.concat([by_country(d, k).reset_index() for k, d in periods.items()])
pc.to_csv(os.path.join(OUT, "bm_mix_pays.csv"), index=False)
print(pc[pc.period == "2025-11..2026-10"].to_string(index=False))

# 3) pays x taux TVA
tv = O[O.is_valid & (O.month >= "2025-11")].groupby(["ship_cc", "tax_rates"]).agg(orders=("name", "count"), tax=("tax", "sum"), kept=("kept", "sum")).reset_index()
tv.to_csv(os.path.join(OUT, "bm_mix_pays_tva.csv"), index=False)
print(tv.to_string(index=False))

# 3b) devises
cur = O[O.is_valid & (O.month >= "2025-11")].groupby(["ship_cc", "currency", "presentment"]).size().reset_index(name="orders")
print(cur.to_string(index=False))

# 4) marque (vendor) sur lignes, 12 derniers mois, lignes de commandes non annulées
Lr = L[(~L.cancelled) & (L.month >= "2025-11") & (L.month <= "2026-10")]
br = Lr.groupby("vendor").agg(lines=("name", "count"), units=("qty", "sum"), revenue_ttc=("line_total", "sum"), avg_unit=("unit", "mean")).round(1).sort_values("revenue_ttc", ascending=False)
br["share_rev_%"] = (100 * br.revenue_ttc / br.revenue_ttc.sum()).round(2)
br["cum_share_%"] = br["share_rev_%"].cumsum().round(1)
br.to_csv(os.path.join(OUT, "bm_mix_marque.csv"))
print(br.head(20).to_string())
pt = Lr.groupby("ptype").agg(units=("qty", "sum"), revenue_ttc=("line_total", "sum")).sort_values("revenue_ttc", ascending=False)
pt["share_%"] = (100 * pt.revenue_ttc / pt.revenue_ttc.sum()).round(1)
pt.to_csv(os.path.join(OUT, "bm_mix_type_produit.csv"))
print(pt.head(10).to_string())

# 5) tranches de prix unitaire
bins = [0, 50, 100, 150, 200, 300, 500, 1e9]
labs = ["<50", "50-100", "100-150", "150-200", "200-300", "300-500", ">500"]
Lr = Lr.assign(band=pd.cut(Lr.unit, bins=bins, labels=labs, right=False))
bd = Lr.groupby("band", observed=True).agg(units=("qty", "sum"), revenue_ttc=("line_total", "sum")).round(0)
bd["share_units_%"] = (100 * bd.units / bd.units.sum()).round(1)
bd["share_rev_%"] = (100 * bd.revenue_ttc / bd.revenue_ttc.sum()).round(1)
bd.to_csv(os.path.join(OUT, "bm_mix_tranche_prix.csv"))
print(bd.to_string())

# 6) sources d'acquisition : première visite / dernière visite (2026-01..10)
D = O[O.is_valid & (O.month >= "2026-01") & (O.month <= "2026-10")]
src = D.groupby(["fv_type", "fv_source"], dropna=False).agg(orders=("name", "count"), kept=("kept", "sum")).reset_index().sort_values("orders", ascending=False)
src["share_%"] = (100 * src.orders / src.orders.sum()).round(1)
src.to_csv(os.path.join(OUT, "bm_mix_source_first_visit.csv"), index=False)
print(src.head(15).to_string(index=False))
src2 = D.groupby(["lv_type", "lv_source"], dropna=False).agg(orders=("name", "count"), kept=("kept", "sum")).reset_index().sort_values("orders", ascending=False)
src2["share_%"] = (100 * src2.orders / src2.orders.sum()).round(1)
src2.to_csv(os.path.join(OUT, "bm_mix_source_last_visit.csv"), index=False)
print(src2.head(10).to_string(index=False))

# 6b) SEO par mois (first visit type = SEO)
seo = O[O.is_valid].assign(is_seo=lambda d: (d.fv_type == "SEO") | (d.lv_type == "SEO"))
sm = seo.groupby("month").agg(orders=("name", "count"), seo_orders=("is_seo", "sum"), seo_kept=("kept", lambda s: s[seo.loc[s.index, "is_seo"]].sum())).round(0)
sm["seo_share_%"] = (100 * sm.seo_orders / sm.orders).round(1)
sm.to_csv(os.path.join(OUT, "bm_mix_seo_mensuel.csv"))
print(sm.tail(24).to_string())

# 7) langue de landing
ll = D.groupby("land_lang").agg(orders=("name", "count"), kept=("kept", "sum"), aov=("kept", "mean")).round(1)
ll["share_%"] = (100 * ll.orders / ll.orders.sum()).round(1)
ll.to_csv(os.path.join(OUT, "bm_mix_langue_landing.csv"))
print(ll.to_string())
print("landing is product page %:", round(100 * D.land_is_product.mean(), 1))

# 8) récurrence
rc = D.groupby(D.order_index.fillna(0).clip(upper=3)).agg(orders=("name", "count"), kept=("kept", "sum")).round(0)
rc["share_%"] = (100 * rc.orders / rc.orders.sum()).round(1)
rc.to_csv(os.path.join(OUT, "bm_mix_recurrence.csv"))
print(rc.to_string())

# 9) remboursements/annulations (2026-01..10)
st = D.groupby("fin").agg(orders=("name", "count"), gross=("gross", "sum"), refunded=("refunded", "sum")).round(0)
print(st.to_string())
print("cancelled orders (all periods, 2026-01..10):", int(O[(O.month >= '2026-01') & (O.month <= '2026-10')].cancelled.sum()))

# 10) sources IA (ChatGPT & co) toutes périodes, par mois
ai = O[O.is_valid & (O.fv_source.fillna("").str.contains("chatgpt|openai|perplexity|gemini|copilot|claude", case=False) | O.lv_source.fillna("").str.contains("chatgpt|openai|perplexity|gemini|copilot|claude", case=False))]
am = ai.groupby("month").agg(orders=("name", "count"), kept=("kept", "sum")).round(0)
am.to_csv(os.path.join(OUT, "bm_mix_sources_ia_mensuel.csv"))
print("AI-referred orders (first or last visit):", len(ai), "kept CHF", round(ai.kept.sum()))
print(am.to_string())
print(ai.groupby(["fv_source", "lv_source"]).size().sort_values(ascending=False).head(8))

# 11) commandes hors CH par mois
fo = O[O.is_valid & (~O.ship_cc.isin(["CH", "NA"]))].groupby(["month", "ship_cc"]).agg(orders=("name", "count"), kept=("kept", "sum"), shipping=("shipping", "sum")).reset_index()
fo.to_csv(os.path.join(OUT, "bm_mix_hors_ch_mensuel.csv"), index=False)
print(fo.to_string(index=False))
allf = O[O.is_valid & (~O.ship_cc.isin(["CH", "NA"]))]
print("foreign orders all-time:", len(allf), "kept CHF", round(allf.kept.sum()), "refunded", round(allf.refunded.sum()))
