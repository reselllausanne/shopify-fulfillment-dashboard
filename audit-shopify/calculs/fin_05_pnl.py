"""Compte de contribution réalisé Shopify 2026 (janv.→oct.), par commande puis par mois, avec hypothèses explicites.

Entrées : donnees_brutes/{orders_flat,lines_with_match,transactions_flat}.csv, balance_transactions.ndjson,
          sql 03_adspend_monthly.csv (Google Ads), 04_ordermatch_lines.csv
Sorties : tableaux/fin_05_orders_pnl.csv (sans PII), tableaux/fin_05_pnl_mensuel.csv, tableaux/fin_05_pnl_cohortes.csv,
          tableaux/hypotheses.csv (paramètres modifiables)
Définitions (toutes en CHF) :
  ventes_brutes_ttc = total initial TTC (articles + livraison, TVA 8,1 % incluse)  [= total courant + remboursé]
  revenu_conserve_ttc = total courant (après remboursements/annulations)
  tva = TVA contenue dans le revenu conservé (taxes courantes API)
  revenu_net_ht = revenu_conserve_ttc - tva
  cogs = coût d'achat fournisseur (OrderMatch.supplierCost/manualCostOverride) des lignes conservées ; coût estimé pour lignes non appariées (drapeau)
  contribution_avant_pub = revenu_net_ht - cogs - frais_paiement - exp_prep - litiges
  contribution_apres_acquisition = contribution_avant_pub - pub_google (mensuelle, non allouée par commande)
NB : si l'entreprise n'est pas assujettie/si la TVA d'importation sur achats est récupérable, les résultats changent (voir sensibilités).
"""
import json, re, pandas as pd, numpy as np, pathlib
R = pathlib.Path(__file__).resolve().parents[1]
D, T = R / "donnees_brutes", R / "tableaux"
HYP = dict(
    tva_taux=0.081,                     # observé sur 100 % des commandes depuis 2024-01 (taxes incluses)
    cout_vat_recuperable_part=0.0,      # part de TVA d'importation sur achats récupérable (0 = prudent ; max ≈ 0.081/1.081)
    frais_twint_pct=0.013, frais_paypal_pct=0.034, frais_paypal_fixe=0.55, frais_powerpay_pct=0.030, frais_cembra_pct=0.030,
    exp_transport_chf=6.50, exp_preparation_chf=8.00,   # forfaits codés dans l'outil (shopify/fulfillmentExpenses.ts) : estimation
    recup_stock_retour_pct=0.70,        # part du coût récupérée (revente) pour une ligne achetée puis remboursée
    cout_estime_ratio_defaut=0.70,      # coût/prix TTC par défaut pour lignes non appariées non remboursées
    remuneration_dirigeant_mois=6000.0, # HYPOTHÈSE (à remplacer) : rémunération réaliste brute chargée
    logiciels_mois=325.0,               # Cursor 200 + KicksDB 90 + ChatGPT 18,55 + Google One 10 + WTB 6,69 (RecurringExpense actives pro)
    mature_jusqua="2026-09-15",
)
pd.DataFrame([dict(parametre=k, valeur=v) for k, v in HYP.items()]).to_csv(T / "hypotheses.csv", index=False)
num = lambda s: re.sub(r"\D", "", str(s)) if pd.notna(s) else None

o = pd.read_csv(D / "orders_flat.csv"); x = pd.read_csv(D / "lines_with_match.csv"); t = pd.read_csv(D / "transactions_flat.csv")
o["created"] = pd.to_datetime(o.created_utc, utc=True).dt.tz_convert("Europe/Zurich"); o["mois"] = o.created.dt.strftime("%Y-%m")
o = o[(~o.test) & (o.created >= "2026-01-01") & (o.created < "2026-11-01")].copy()

# --- coût par ligne
x["cost_raw"] = np.where(x.manualCostOverride.notna(), x.manualCostOverride, x.supplierCost)
x["cost_raw"] = pd.to_numeric(x.cost_raw, errors="coerce")
x = x[x.order_id.isin(o.id)].copy()
ratio_vendor = (x[x.has_match & (x.cost_raw > 0)].assign(r=lambda d: d.cost_raw / d.disc_total.replace(0, np.nan)).groupby("vendor").r.median())
x["cost_est_flag"] = ~x.has_match
x["cost"] = x.cost_raw
x.loc[~x.has_match, "cost"] = x.disc_total * x.vendor.map(ratio_vendor).fillna(HYP["cout_estime_ratio_defaut"])
x["cost"] = x.cost.fillna(0)
agg = x.groupby("order_id").agg(cogs_all=("cost", "sum"), cogs_est=("cost", lambda s: s[x.loc[s.index, "cost_est_flag"]].sum()), n_unmatched=("cost_est_flag", "sum"),
                                 n_cancelled_purchase=("stockxStatus", lambda s: s.astype(str).str.upper().str.contains("CANCEL").sum()),
                                 ttc_lignes=("disc_total", "sum"))
o = o.merge(agg, left_on="id", right_index=True, how="left").fillna({"cogs_all": 0, "cogs_est": 0, "n_unmatched": 0, "n_cancelled_purchase": 0, "ttc_lignes": 0})

# --- revenu / refunds / TVA
o["ventes_brutes_ttc"] = o.total_cur + o.refunded
o["revenu_conserve_ttc"] = o.total_cur
o["tva"] = o.tax_cur
o["revenu_net_ht"] = o.revenu_conserve_ttc - o.tva
full_ref = (o.fin == "REFUNDED") | (o.total_cur <= 0.5)
frac_kept = np.where(o.ventes_brutes_ttc > 0, o.total_cur / o.ventes_brutes_ttc, 1.0)

# --- COGS réalisé
# commande intégralement remboursée : coût supporté seulement si achat réel (hors statuts annulés / non appariée) ; récupération partielle du stock
bought_ratio = np.where(o.n_unmatched + o.n_cancelled_purchase >= x.groupby("order_id").size().reindex(o.id).fillna(1).values, 0.0, 1.0)
o["cogs"] = np.where(full_ref, o.cogs_all * bought_ratio * (1 - HYP["recup_stock_retour_pct"]), o.cogs_all)
o["cogs_vat_credit"] = o.cogs * HYP["cout_vat_recuperable_part"]
o["cogs_net"] = o.cogs - o.cogs_vat_credit

# --- frais de paiement
ts = t[(t.status == "SUCCESS") & (t.kind.isin(["SALE", "CAPTURE"]))].copy()
def est_fee(r):
    g = r.gateway.lower()
    if g == "shopify_payments": return r.fee
    if g == "twint": return r.amount * HYP["frais_twint_pct"]
    if g == "paypal": return r.amount * HYP["frais_paypal_pct"] + HYP["frais_paypal_fixe"]
    if "powerpay" in g: return r.amount * HYP["frais_powerpay_pct"]
    if "cembra" in g: return r.amount * HYP["frais_cembra_pct"]
    return 0.0
ts["fee_est"] = ts.apply(est_fee, axis=1)
ts["fee_obs"] = np.where(ts.gateway.str.lower() == "shopify_payments", ts.fee, 0.0)
fe = ts.groupby("order").agg(fee_est=("fee_est", "sum"), fee_obs=("fee_obs", "sum"))
o = o.merge(fe, left_on="name", right_index=True, how="left").fillna({"fee_est": 0, "fee_obs": 0})
o["frais_paiement"] = o.fee_est

# --- exp / préparation (non appliqué aux commandes entièrement remboursées sans achat)
o["exp_prep"] = np.where(full_ref & (bought_ratio == 0), 0.0, HYP["exp_transport_chf"] + HYP["exp_preparation_chf"])

# --- litiges (balance transactions par mois)
bt = pd.DataFrame([json.loads(l) for l in open(D / "balance_transactions.ndjson")])
bt["date"] = pd.to_datetime(bt.transactionDate, utc=True).dt.tz_convert("Europe/Zurich"); bt["mois"] = bt.date.dt.strftime("%Y-%m")
bt["net_v"] = bt.net.apply(lambda v: float(v["amount"]))
disp = bt[bt.type.isin(["DISPUTE_WITHDRAWAL", "DISPUTE_REVERSAL"])].groupby("mois").net_v.sum()  # négatif = perte (montant + frais de litige)
disp = -disp.reindex(sorted(o.mois.unique())).fillna(0)

# --- pub
ads = pd.read_csv(D / "03_adspend_monthly.csv"); ads = ads[ads.mois.between("2026-01", "2026-10")].set_index("mois").pub_chf

# --- sorties par commande (sans PII)
o["cohorte"] = np.where(o.created < pd.Timestamp(HYP["mature_jusqua"], tz="Europe/Zurich"), "mature", "recente")
cols = ["name", "mois", "cohorte", "fin", "ful", "ship_cc", "gateways", "source", "ventes_brutes_ttc", "refunded", "revenu_conserve_ttc", "tva", "revenu_net_ht", "cogs", "cogs_est", "n_unmatched",
        "frais_paiement", "fee_obs", "exp_prep", "discount_codes", "cust_order_idx", "f_source", "f_type", "l_source", "l_type", "n_lines", "n_units"]
o[cols].to_csv(T / "fin_05_orders_pnl.csv", index=False)

def pnl(df, ads_s, disp_s, label):
    g = df.groupby("mois").agg(commandes=("id", "count"), ventes_brutes_ttc=("ventes_brutes_ttc", "sum"), remboursements=("refunded", "sum"), revenu_conserve_ttc=("revenu_conserve_ttc", "sum"),
                               tva=("tva", "sum"), revenu_net_ht=("revenu_net_ht", "sum"), cogs=("cogs_net", "sum"), cogs_dont_estime=("cogs_est", "sum"),
                               frais_paiement=("frais_paiement", "sum"), exp_prep=("exp_prep", "sum"))
    g["marge_brute_realisee"] = g.revenu_net_ht - g.cogs
    g["litiges"] = disp_s.reindex(g.index).fillna(0)
    g["contribution_avant_pub"] = g.marge_brute_realisee - g.frais_paiement - g.exp_prep - g.litiges
    g["pub_google"] = ads_s.reindex(g.index).fillna(0)
    g["contribution_apres_acquisition"] = g.contribution_avant_pub - g.pub_google
    g["logiciels"] = HYP["logiciels_mois"]
    g["resultat_avant_remuneration"] = g.contribution_apres_acquisition - g.logiciels
    g["remuneration_dirigeant_hyp"] = HYP["remuneration_dirigeant_mois"]
    g["resultat_economique"] = g.resultat_avant_remuneration - g.remuneration_dirigeant_hyp
    return g.round(0)

m = pnl(o, ads, disp, "tout")
m.loc["TOTAL"] = m.sum(numeric_only=True)
m.to_csv(T / "fin_05_pnl_mensuel.csv")
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
print(m.T.to_string())
tot = m.loc["TOTAL"]
print("\nRatios (TOTAL 2026-01→10) :")
for k, v in [("remboursements/ventes brutes", tot.remboursements / tot.ventes_brutes_ttc), ("marge brute réalisée / revenu net HT", tot.marge_brute_realisee / tot.revenu_net_ht),
             ("contrib. avant pub / revenu net HT", tot.contribution_avant_pub / tot.revenu_net_ht), ("pub / revenu net HT", tot.pub_google / tot.revenu_net_ht),
             ("contrib. après acquisition / revenu net HT", tot.contribution_apres_acquisition / tot.revenu_net_ht)]:
    print(f"  {k}: {v*100:.1f} %")
print("  contribution avant pub par commande conservée:", round(tot.contribution_avant_pub / tot.commandes, 1), "| après acquisition:", round(tot.contribution_apres_acquisition / tot.commandes, 1))
# cohortes
coh = {}
for c in ["mature", "recente"]:
    d = o[o.cohorte == c]; ms = sorted(d.mois.unique())
    coh[c] = pnl(d, ads.reindex(ms), disp.reindex(ms), c).sum(numeric_only=True)
ch = pd.DataFrame(coh).T; ch.to_csv(T / "fin_05_pnl_cohortes.csv"); print("\nCohortes (la pub/litiges sont mensuels : cohorte récente = mois partiels, lire avec prudence)\n", ch.T.to_string())
print("\nCOGS estimé (lignes non appariées, non remboursées):", round(o.cogs_est.sum()), "CHF sur", int(o.n_unmatched.sum()), "lignes")
