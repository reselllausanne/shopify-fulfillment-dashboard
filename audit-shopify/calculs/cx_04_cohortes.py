"""Cohortes de réachat, panier, délai, tailles (API Shopify complète 2022-2026 + P&L pilote 2026). Aucune PII : identifiants clients hachés non exportés.
Sorties : tableaux/cx_04_*.csv"""
import json, re, pandas as pd, numpy as np
rows = []; lines = []
for l in open("audit-shopify/donnees_brutes/orders_api.ndjson"):
    o = json.loads(l)
    if o.get("test"): continue
    cust = (o.get("customer") or {}).get("id")
    cancelled = o["cancelledAt"] is not None
    gross = float(o["totalPriceSet"]["shopMoney"]["amount"]); ref = float(o["totalRefundedSet"]["shopMoney"]["amount"])
    rows.append(dict(name=o["name"], created=o["createdAt"], cust=cust, gross=gross, refunded=ref, cancelled=cancelled, fin=o["displayFinancialStatus"], country=(o.get("shippingAddress") or o.get("billingAddress") or {}).get("countryCodeV2"),
        n_items=sum(x["quantity"] for x in o["lineItems"]["nodes"]), disc=bool(o["discountCodes"]), gw=(o["paymentGatewayNames"] or [None])[0], idx=(o.get("customerJourneySummary") or {}).get("customerOrderIndex"),
        days_to_conv=(o.get("customerJourneySummary") or {}).get("daysToConversion"), src=((o.get("customerJourneySummary") or {}).get("lastVisit") or {}).get("source"),
        lsrc=((o.get("customerJourneySummary") or {}).get("lastVisit") or {}).get("sourceType")))
    for x in o["lineItems"]["nodes"]:
        lines.append(dict(name=o["name"], cust=cust, created=o["createdAt"], size=x.get("variantTitle"), title=x["title"], vendor=x.get("vendor"), qty=x["quantity"], price=float(x["discountedTotalSet"]["shopMoney"]["amount"])))
d = pd.DataFrame(rows); d["created"] = pd.to_datetime(d.created, utc=True); L = pd.DataFrame(lines); L["created"] = pd.to_datetime(L.created, utc=True)
print("Commandes (hors test):", len(d), "| client identifié:", d.cust.notna().mean().round(3), "| clients uniques:", d.cust.nunique())
c = d[d.cust.notna() & ~d.cancelled].sort_values("created")
c["rank"] = c.groupby("cust").cumcount() + 1
first = c.groupby("cust").created.min().rename("first"); c = c.merge(first, left_on="cust", right_index=True)
c["delai_j"] = (c.created - c["first"]).dt.total_seconds() / 86400
c["year_first"] = c["first"].dt.year
NOW = pd.Timestamp("2026-11-02", tz="UTC")
res = []
for lab, y0, y1 in [("clients dont 1ère cmd en 2025", "2025-01-01", "2026-01-01"), ("clients dont 1ère cmd en 2026", "2026-01-01", "2026-11-03"), ("clients dont 1ère cmd en 2024", "2024-01-01", "2025-01-01")]:
    for h in (30, 90, 180, 365):
        el = first[(first >= y0) & (first < y1) & (first <= NOW - pd.Timedelta(days=h))]
        if len(el) == 0: continue
        rep = c[(c.cust.isin(el.index)) & (c.delai_j > 0.04) & (c.delai_j <= h)].cust.nunique()
        res.append(dict(cohorte=lab, horizon_j=h, eligibles=len(el), reachat=rep, taux_pct=round(100 * rep / len(el), 1)))
R = pd.DataFrame(res); print(R.to_string()); R.to_csv("audit-shopify/tableaux/cx_04_reachat_taux.csv", index=False)
nb = c.groupby("cust").size(); print("\nClients (hors annulées) avec >=2 commandes:", int((nb >= 2).sum()), f"({100*(nb>=2).mean():.1f}%) ; >=3:", int((nb >= 3).sum()), "; >5 (segment VIP Klaviyo):", int((nb > 5).sum()), "; max", nb.max())
d2 = c[c["rank"] == 2].delai_j; print("Délai entre 1re et 2e commande (jours) parmi réacheteurs: médiane", round(d2.median(), 1), "p25", round(d2.quantile(.25), 1), "p75", round(d2.quantile(.75), 1), "n", len(d2), "| <=1 j (doublons de panier?):", int((d2 <= 1).sum()))
d2b = d2[d2 > 1]; print("  hors cmd <=1j: médiane", round(d2b.median(), 1), "n", len(d2b))
# part du CA 2026 par rang
y26 = c[c.created >= "2026-01-01"]
print("\n2026 hors annulées: commandes", len(y26), "| rang1:", (y26["rank"] == 1).sum(), "| rang>=2:", (y26["rank"] >= 2).sum(), f"({100*(y26['rank']>=2).mean():.1f}%) ; CA brut part rang>=2: {100*y26[y26['rank']>=2].gross.sum()/y26.gross.sum():.1f}%")
y26["clients_deja_avant_2026"] = y26["first"] < "2026-01-01"
print("Commandes 2026 de clients acquis avant 2026:", y26.clients_deja_avant_2026.sum(), f"({100*y26.clients_deja_avant_2026.mean():.1f}%)")
# panier
print("\nPanier brut TTC (CHF) moyen/méd. 2026 par rang: ", y26.groupby(y26["rank"].clip(upper=3)).gross.agg(["count", "mean", "median"]).round(1).to_string())
# remboursements par rang
y26b = d[(d.created >= "2026-01-01") & d.cust.notna()].merge(c[["name", "rank"]], on="name", how="left")
print("Taux remboursé (remboursé/brut) 2026 par rang:", (y26b.groupby(y26b["rank"].clip(upper=2)).apply(lambda x: round(100 * x.refunded.sum() / x.gross.sum(), 1))).to_dict())
# P&L pilote
p = pd.read_csv("audit-shopify/tableaux/fin_05_orders_pnl.csv"); p["contrib"] = p.revenu_net_ht - p.cogs - p.frais_paiement - p.exp_prep
p["rang"] = np.where(p.cust_order_idx.fillna(1) <= 1, "rang1", "rang>=2")
g = p.groupby("rang").agg(cmd=("name", "count"), revenu_net_ht=("revenu_net_ht", "sum"), contrib=("contrib", "sum"), refund=("refunded", "sum"), brut=("ventes_brutes_ttc", "sum")); g["contrib_par_cmd"] = (g.contrib / g.cmd).round(1); g["panier_ttc"] = (g.brut / g.cmd).round(1)
print("\nContribution avant pub (pilote fin_05, HT, hors pub) par rang:\n", g.round(0).to_string()); g.to_csv("audit-shopify/tableaux/cx_04_contribution_par_rang.csv")
print("Contribution avant pub moyenne/cmd:", round(p.contrib.sum() / len(p), 1), "| marge médiane cmd rang1:", round(p[p.rang == 'rang1'].contrib.median(), 1), "rang>=2:", round(p[p.rang != 'rang1'].contrib.median(), 1))
# Tailles
def norm_size(s):
    if not isinstance(s, str): return None
    s = s.strip().replace(",", ".")
    m = re.search(r"\b(3[4-9]|4[0-9]|5[0-2])(\.5)?\b", s)
    if m: return m.group(0)
    m = re.search(r"\b(XXS|XS|S|M|L|XL|XXL|XXXL)\b", s.upper())
    return m.group(0) if m else None
L["sz"] = L["size"].map(norm_size)
L26 = L[L.created >= "2026-01-01"]
print("\nTailles 2026: lignes", len(L26), "taille identifiable:", L26.sz.notna().mean().round(3), "| top:", L26.sz.value_counts().head(10).to_dict())
Lc = L[L.cust.notna() & L.sz.notna()]
mode = Lc.groupby("cust").sz.agg(lambda s: s.mode().iloc[0]); nsz = Lc.groupby("cust").sz.nunique(); nl = Lc.groupby("cust").size()
multi = nl[nl >= 2].index
print("Clients avec >=2 lignes de taille connue:", len(multi), "| une seule taille (cohérent):", int((nsz[multi] == 1).sum()), f"({100*(nsz[multi]==1).mean():.1f}%) | <=2 tailles:", f"{100*(nsz[multi]<=2).mean():.1f}%")
# commandes multi-articles / multi-tailles (cadeaux, famille)
print("Taille connue pour clients (au moins 1 ligne):", Lc.cust.nunique(), "/", d.cust.nunique(), f"({100*Lc.cust.nunique()/d.cust.nunique():.1f}%)")
# pays
print("\nPays 2026 (hors annulées):", d[(d.created >= "2026-01-01") & ~d.cancelled].country.value_counts(dropna=False).to_dict())
print("Pays 2025:", d[(d.created >= "2025-01-01") & (d.created < "2026-01-01") & ~d.cancelled].country.value_counts(dropna=False).head(6).to_dict())
# mensuel historique
m = d[~d.cancelled].groupby(d.created.dt.strftime("%Y-%m")).agg(cmd=("name", "count"), brut=("gross", "sum"), clients=("cust", "nunique"))
m["rang1_part"] = c.groupby(c.created.dt.strftime("%Y-%m")).apply(lambda x: round(100 * (x["rank"] == 1).mean(), 1)); m.to_csv("audit-shopify/tableaux/cx_04_mensuel_2022_2026.csv"); print(m.tail(26).to_string())
