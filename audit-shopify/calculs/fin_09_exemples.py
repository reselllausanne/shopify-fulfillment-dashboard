"""Exemples réels de commandes (normale, annulée, remboursée après achat, partielle, avoir, litige) avec chaîne complète.
Sorties : tableaux/fin_09_exemples.json. Sans PII (numéros de commande uniquement)."""
import pandas as pd, json, pathlib
R = pathlib.Path(__file__).resolve().parents[1]; D, T = R / "donnees_brutes", R / "tableaux"
o = pd.read_csv(D / "orders_flat.csv"); x = pd.read_csv(D / "lines_with_match.csv"); t = pd.read_csv(D / "transactions_flat.csv"); r = pd.read_csv(D / "refunds_flat.csv")
f = pd.read_csv(D / "06_fulfillment_records.csv"); m = pd.read_csv(D / "04_ordermatch_lines.csv"); p = pd.read_csv(T / "fin_05_orders_pnl.csv")
dp = pd.DataFrame([json.loads(l) for l in open(D / "disputes.ndjson")])
o["created"] = pd.to_datetime(o.created_utc, utc=True)
pcols = list(p.columns)
def describe(name):
    oo = o[o.name == name].iloc[0]
    d = dict(commande=name, creee_utc=oo.created_utc, annulee_utc=oo.cancelled_utc, motif_annulation=oo.cancel_reason, statut_paiement=oo.fin, statut_expedition=oo.ful, pays=oo.ship_cc,
             passerelles=oo.gateways, total_initial_ttc=oo.total_orig, rembourse=oo.refunded, total_courant=oo.total_cur, tva_courante=oo.tax_cur, livraison_facturee=oo.ship,
             remises=oo.discounts, codes=oo.discount_codes, derniere_visite=oo.l_source, rang_client=oo.cust_order_idx, frais_paiement_shopify=oo.pay_fees)
    d["lignes"] = [dict(titre=str(l.title)[:60], taille=l.variant, prix_ligne_ttc=l.disc_total, stockx_statut=l.stockxStatus, source=l.supplierSource, cout=(l.manualCostOverride if pd.notna(l.manualCostOverride) else l.supplierCost)) for l in x[x.order == name].itertuples()]
    d["transactions"] = t[t.order == name][["kind", "status", "gateway", "processed", "amount", "fee"]].to_dict("records")
    d["remboursements"] = r[r.order == name][["created_utc", "note", "total", "items"]].to_dict("records")
    d["fulfillment"] = f[f.ord == name][["status", "stx_delivered", "scan_done", "label_at", "fulfilled_at"]].to_dict("records")
    d["ordermatch"] = m[m.shopifyOrderName == name][["stockxStatus", "stockx_purchase_utc", "stx_eta", "supplierCost", "marginAmount", "return_applied", "returnFeeAmountChf", "return_reason"]].to_dict("records")
    pn = "name" if "name" in pcols else pcols[0]
    d["pnl_commande"] = p[p[pn] == name].round(2).to_dict("records")
    return d
ex = {}
b = o[(o.created >= "2026-09-01") & (o.created < "2026-10-01") & (o.fin == "PAID") & (o.ful == "FULFILLED") & (o.n_lines == 1) & (o.gateways == "shopify_payments") & (o.refunded == 0)]
xi = x.set_index("order")
cand = [n for n in b.name if n in xi.index and str(xi.loc[n, "stockxStatus"]).upper() == "BUYER_RECEIVED" and pd.notna(xi.loc[n, "supplierCost"])]
ex["normale"] = describe(cand[len(cand) // 2])
ex["annulee_avant_achat"] = describe(o[(o.created >= "2026-09-01") & (o.fin == "REFUNDED") & o.cancelled_utc.notna()].name.iloc[3])
xr = x.merge(o[["name", "fin", "created"]].rename(columns={"created": "cr"}), left_on="order", right_on="name")
ex["remboursee_apres_achat"] = describe(xr[(xr.fin == "REFUNDED") & xr.stockxStatus.astype(str).str.upper().isin(["BUYER_RECEIVED", "AC_SHIPPED"]) & (xr.cr >= "2026-06-01")].order.iloc[0])
ex["remboursement_partiel"] = describe(o[(o.created >= "2026-09-01") & (o.fin == "PARTIALLY_REFUNDED") & (o.n_lines == 1)].name.iloc[0])
sc = o[(o.created >= "2026-07-01") & o.gateways.astype(str).str.contains("store_credit|gift", na=False) & (o.fin == "PAID")]
ex["avoir_ou_carte_cadeau"] = describe(sc.name.iloc[0]) if len(sc) else "aucune commande trouvée"
dp["order_name"] = dp.order.apply(lambda v: v["name"] if isinstance(v, dict) else None)
dl = dp[dp.status == "LOST"]
ex["litige_perdu"] = dict(litige=dl[["order_name", "initiatedAt", "type", "status", "reasonDetails", "amount"]].iloc[0].to_dict(), commande=describe(dl.order_name.iloc[0]))
json.dump(ex, open(T / "fin_09_exemples.json", "w"), indent=1, default=str, ensure_ascii=False)
for k, v in ex.items():
    print("\n##", k); print(json.dumps(v, indent=1, default=str, ensure_ascii=False)[:2200])
