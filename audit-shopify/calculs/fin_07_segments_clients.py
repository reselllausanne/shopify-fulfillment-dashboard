"""Segments clients/canaux : nouveaux vs récurrents, canal (journey Shopify), passerelle, remboursements ; réachat par cohorte mensuelle de 1ère commande.
Sources : tableaux/fin_05_orders_pnl.csv (2026), donnees_brutes/orders_flat.csv (historique 2022→). Aucune PII en sortie."""
import pandas as pd, numpy as np, pathlib
R = pathlib.Path(__file__).resolve().parents[1]
D, T = R / "donnees_brutes", R / "tableaux"
p = pd.read_csv(T / "fin_05_orders_pnl.csv")
o = pd.read_csv(D / "orders_flat.csv")
o["created"] = pd.to_datetime(o.created_utc, utc=True).dt.tz_convert("Europe/Zurich")
p["contrib_av_pub"] = p.revenu_net_ht - p.cogs - p.frais_paiement - p.exp_prep
print("Couverture journey (l_source non nul):", round(p.l_source.notna().mean() * 100, 1), "% ; f_source:", round(p.f_source.notna().mean() * 100, 1), "% ; client connu:", round(o[o.created >= '2026-01-01'].cust_id.notna().mean() * 100, 1), "%")
p["canal"] = np.select([p.l_type.fillna("").str.upper().str.contains("PAID") | p.l_source.fillna("").str.lower().str.contains("google") & p.l_type.fillna("").str.upper().str.contains("PAID"),
                        p.l_source.fillna("").str.lower().str.contains("google"), p.l_type.fillna("").str.upper().eq("DIRECT") | p.l_source.isna(), p.l_type.fillna("").str.upper().str.contains("EMAIL") | p.l_source.fillna("").str.lower().str.contains("klaviyo|email|postmark"),
                        p.l_type.fillna("").str.upper().str.contains("SOCIAL")], ["paid (google/autre)", "google organique/autre", "direct/inconnu", "email", "social"], "autre")
def seg(col, name):
    g = p.groupby(col, dropna=False).agg(cmd=("name", "count"), ca_net_ht=("revenu_net_ht", "sum"), contrib_av_pub=("contrib_av_pub", "sum"), refund=("refunded", "sum"), brut=("ventes_brutes_ttc", "sum"))
    g["contrib_par_cmd"] = (g.contrib_av_pub / g.cmd).round(1); g["refund_pct_brut"] = (g.refund / g.brut * 100).round(1); g["part_cmd_pct"] = (g.cmd / g.cmd.sum() * 100).round(1)
    g.round(0).to_csv(T / f"fin_07_seg_{name}.csv"); print(f"\n== {name}\n", g.round(1).sort_values("cmd", ascending=False).head(12).to_string())
# passerelle = moyens des transactions SALE réussies uniquement (paymentGatewayNames inclut aussi les crédits de remboursement : correctif suite à revue cx)
tx = pd.read_csv(D / "transactions_flat.csv"); tx = tx[(tx.kind == "SALE") & (tx.status == "SUCCESS")]
gs = tx.groupby("order").gateway.apply(lambda s: "+".join(sorted(set(s)))).rename("gateways_vente")
p = p.merge(gs, left_on="name", right_index=True, how="left")
seg("canal", "canal"); seg("l_source", "source_derniere_visite"); seg("gateways_vente", "paiement")
p["rang_client"] = np.where(p.cust_order_idx.fillna(1) <= 1, "1ère commande", "récurrente (rang ≥2)")
seg("rang_client", "nouveau_vs_recurrent")
seg("cohorte", "cohorte"); seg(p.fin, "statut_fin") if False else None
# réachat : par client (toutes commandes non test, période complète, hors commandes sans client)
c = o[o.cust_id.notna() & ~o.test].copy()
first = c.groupby("cust_id").created.min().rename("first")
c = c.merge(first, left_on="cust_id", right_index=True)
c["cohorte_mois"] = c["first"].dt.strftime("%Y-%m"); c["delai_j"] = (c.created - c["first"]).dt.days
nb = c.groupby("cust_id").size()
print("\nClients identifiés:", len(nb), "| avec ≥2 commandes:", int((nb >= 2).sum()), f"({(nb>=2).mean()*100:.1f} %)")
# taux de réachat à 90 / 180 j pour clients dont 1ère commande ≥ 180 j avant (2026-05-06)
now = pd.Timestamp("2026-11-02", tz="Europe/Zurich")
for h in (30, 90, 180):
    elig = first[first <= now - pd.Timedelta(days=h)]
    rep = c[(c.cust_id.isin(elig.index)) & (c.delai_j > 0) & (c.delai_j <= h)].cust_id.nunique()
    print(f"Réachat ≤ {h} j : {rep}/{len(elig)} = {rep/len(elig)*100:.1f} % (clients dont 1ère commande ≥ {h} j)")
y = c[c["first"].dt.year == 2026]; ny = y.groupby("cust_id").size()
coh = y.groupby("cohorte_mois").agg(clients=("cust_id", "nunique"), commandes=("id", "count")); coh["cmd_par_client"] = (coh.commandes / coh.clients).round(2)
print("\nCohortes 2026 (1ère commande 2026) :\n", coh.to_string()); coh.to_csv(T / "fin_07_cohortes_reachat_2026.csv")
d2 = c[(c.delai_j > 0)].groupby("cust_id").delai_j.min()
print("\nDélai médian avant 2e commande (jours, parmi réacheteurs):", d2.median(), "| quartiles:", d2.quantile([.25, .75]).tolist())
# part du CA 2026 issu de clients déjà connus avant 2026
o26 = o[(o.created >= "2026-01-01") & ~o.test & o.cust_id.notna()].merge(first, left_on="cust_id", right_index=True)
o26["deja_client"] = o26["first"] < pd.Timestamp("2026-01-01", tz="Europe/Zurich")
print("\n2026 : part des commandes venant de clients acquis avant 2026 :", round(o26.deja_client.mean() * 100, 1), "% ; CA TTC:", round(o26[o26.deja_client].total_orig.sum() / o26.total_orig.sum() * 100, 1), "%")
