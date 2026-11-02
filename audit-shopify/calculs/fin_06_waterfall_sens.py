"""Cascade 'marge affichée' -> résultat, sensibilités fiscales/frais, seuil de rentabilité. Période 2026-01→2026-10 (commandes créées, Zurich)."""
import pandas as pd, numpy as np, pathlib, re
R = pathlib.Path(__file__).resolve().parents[1]
D, T = R / "donnees_brutes", R / "tableaux"
p = pd.read_csv(T / "fin_05_orders_pnl.csv")
H = dict(zip(*pd.read_csv(T / "hypotheses.csv").T.values))
H = {k: float(v) if re.match(r"^-?[\d.]+$", str(v)) else v for k, v in H.items()}
ads = pd.read_csv(D / "03_adspend_monthly.csv"); ads = ads[ads.mois.between("2026-01", "2026-10")].pub_chf.sum()
disp = 5305.0  # issu de fin_05 (litiges nets des reversals, frais inclus), mois 2026-01→10
x = pd.read_csv(D / "lines_with_match.csv"); o = pd.read_csv(D / "orders_flat.csv")
o["created"] = pd.to_datetime(o.created_utc, utc=True).dt.tz_convert("Europe/Zurich")
ids = set(o[(o.created >= "2026-01-01") & (o.created < "2026-11-01") & (~o.test)].id)
x = x[x.order_id.isin(ids)]
# marge « affichée » = prix de ligne API (TTC, avant remboursement) - coût OrderMatch, lignes appariées seulement (logique du tableau de bord)
xm = x[x.has_match]
cost_m = pd.to_numeric(np.where(xm.manualCostOverride.notna(), xm.manualCostOverride, xm.supplierCost), errors="coerce")
affichee = (xm.disc_total - cost_m).sum()
print(f"Marge affichée (lignes appariées, TTC - coût) : {affichee:,.0f} CHF sur CA lignes {xm.disc_total.sum():,.0f}")
tot = lambda c: p[c].sum()
steps = [("Marge affichée (lignes appariées, prix TTC − coût)", affichee)]
nm = x[~x.has_match]
steps.append(("+ lignes sans coût (marge non connue, non incluse) → ignorées ici", 0))
steps.append(("− TVA 8,1 % sur ventes TTC conservées (prélevée dans le prix)", -tot("tva")))
steps.append(("− remboursements/annulations (revenu perdu, ligne appariée ou non)", -tot("refunded")))
steps.append(("± coûts non couverts : coût estimé lignes non appariées conservées", -p.cogs_est.sum()))
steps.append(("+ retour de coûts sur commandes remboursées (non achetées / stock récupéré)", None))
cogs_total = tot("cogs")
rev_net = tot("revenu_net_ht")
gm = rev_net - cogs_total
print(f"Revenu net HT conservé {rev_net:,.0f} − COGS {cogs_total:,.0f} = marge brute réalisée {gm:,.0f}")
fp, ep = tot("frais_paiement"), tot("exp_prep")
cab = gm - fp - ep - disp
caa = cab - ads
print(f"− frais paiement {fp:,.0f} (dont observés Shopify Payments {tot('fee_obs'):,.0f}) − exp/prépa {ep:,.0f} − litiges {disp:,.0f} = contribution avant pub {cab:,.0f}")
print(f"− pub Google {ads:,.0f} = contribution après acquisition {caa:,.0f}")
fixed = (H["logiciels_mois"]) * 10; own = H["remuneration_dirigeant_mois"] * 10
print(f"− logiciels {fixed:,.0f} = {caa-fixed:,.0f} ; − rémunération hyp. {own:,.0f} = {caa-fixed-own:,.0f}")

# ---- sensibilités (résultat après acquisition avant rémunération)
base = caa - fixed
rows = [("Base (assujetti 8,1 %, TVA import non récupérable)", base)]
# B : TVA import récupérable sur COGS (coût TTC incluant 8,1 %)
rows.append(("B. TVA d'importation sur achats récupérable (COGS/1,081) — À PROUVER (documents douane)", base + cogs_total * (0.081 / 1.081)))
# C : non assujetti / TVA non due
# (ancien scénario C « TVA non due » supprimé : l'entité est assujettie, CGV + IDE/TVA CHE-309.864.712)
rows.append(("D. Frais paiement autres passerelles +1 pt", base - (p.revenu_conserve_ttc.sum() * 0.5 * 0.01)))
rows.append(("E. Expédition+préparation 10 CHF/cmd au lieu de 14,5", base + 4.5 * (p.exp_prep > 0).sum()))
rows.append(("F. Expédition+préparation 20 CHF/cmd", base - 5.5 * (p.exp_prep > 0).sum()))
rows.append(("G. Coût estimé (lignes non appariées) −20 %", base + 0.2 * p.cogs_est.sum()))
rows.append(("H. Coût estimé (lignes non appariées) +20 %", base - 0.2 * p.cogs_est.sum()))
zc = x[x.has_match & x.stockxStatus.isin(["ESSENTIAL_STOCK", "PHYSICAL_STOCK"]) & (pd.to_numeric(np.where(x.manualCostOverride.notna(), x.manualCostOverride, x.supplierCost), errors="coerce") == 0)]
rows.append(("J. Lignes de stock propre à coût 0 (211 lignes) valorisées 42 CHF hoodie / 26 CHF autres (règle du code)", base - (np.where(zc.title.str.contains("Hoodie", case=False), 42, 26) * zc.qty).sum()))
rows.append(("I. Pub −20 % à ventes constantes (illustratif, non prouvé)", base + 0.2 * ads))
sens = pd.DataFrame(rows, columns=["scenario", "resultat_apres_acquisition_avant_remuneration_chf"]).round(0)
sens.to_csv(T / "fin_06_sensibilites.csv", index=False); print("\n", sens.to_string(index=False))

# ---- seuil de rentabilité (modèle linéaire sur la période)
n = len(p); cpo_before = cab / n; net_per_order = rev_net / n
ads_per_order = ads / n
print(f"\nPar commande (2026, n={n}) : revenu net HT {net_per_order:.1f}, contribution avant pub {cpo_before:.1f}, pub {ads_per_order:.1f}, après acquisition {cpo_before-ads_per_order:.1f}")
monthly_fixed = H["logiciels_mois"] + H["remuneration_dirigeant_mois"]
print(f"Charges fixes mensuelles (logiciels + rémunération hyp.) : {monthly_fixed:,.0f} CHF")
for ads_pct_label, ads_per in [("pub actuelle (≈ %.0f CHF/cmd)" % ads_per_order, ads_per_order), ("pub plafonnée 30 CHF/cmd", 30.0), ("pub plafonnée 12 % du revenu net HT", 0.12 * net_per_order)]:
    cm = cpo_before - ads_per
    be = monthly_fixed / cm if cm > 0 else float("inf")
    print(f"  {ads_pct_label}: contribution/cmd {cm:.1f} → seuil {be:,.0f} cmd/mois" if cm > 0 else f"  {ads_pct_label}: contribution/cmd {cm:.1f} ≤ 0 → aucun volume ne couvre les fixes")

# ---- segments
p["brand"] = None
xx = x.copy(); xx["cost"] = pd.to_numeric(np.where(xx.manualCostOverride.notna(), xx.manualCostOverride, xx.supplierCost), errors="coerce")
xx["marge_aff"] = xx.disc_total - xx.cost
xx["tranche"] = pd.cut(xx.disc_total, [0, 100, 150, 200, 250, 300, 400, 10000], labels=["<100", "100-150", "150-200", "200-250", "250-300", "300-400", ">400"])
xm = xx[xx.has_match & (xx.disc_total > 0)]
g = xm.groupby("tranche", observed=True).agg(lignes=("lid", "count"), ca_ttc=("disc_total", "sum"), cout=("cost", "sum")); g["marge_aff_pct"] = ((g.ca_ttc - g.cout) / g.ca_ttc * 100).round(1)
g["marge_aff_chf_par_ligne"] = ((g.ca_ttc - g.cout) / g.lignes).round(1); g.round(0).to_csv(T / "fin_06_seg_tranche_prix.csv"); print("\nPar tranche de prix (marge affichée TTC-coût, avant TVA/frais/exp/pub):\n", g.round(1).to_string())
b = xm.groupby("vendor").agg(lignes=("lid", "count"), ca_ttc=("disc_total", "sum"), cout=("cost", "sum")); b["marge_aff_pct"] = ((b.ca_ttc - b.cout) / b.ca_ttc * 100).round(1); b = b.sort_values("ca_ttc", ascending=False)
b.round(0).to_csv(T / "fin_06_seg_marque.csv"); print("\nPar marque (top 12):\n", b.head(12).round(1).to_string())
src = xm.copy(); src["mode"] = np.where(src.stockxStatus.astype(str).str.upper().isin(["ESSENTIAL_STOCK", "PHYSICAL_STOCK", "FIXED_PRICE_COST", "PACKAGE_PROTECTION", "MONEY_KICKZ_COST"]), "stock propre/fixe/protection", np.where(src.supplierSource == "STOCKX", "StockX à la commande", "autre/manuel"))
s = src.groupby("mode").agg(lignes=("lid", "count"), ca_ttc=("disc_total", "sum"), cout=("cost", "sum")); s["marge_aff_pct"] = ((s.ca_ttc - s.cout) / s.ca_ttc * 100).round(1); s.round(0).to_csv(T / "fin_06_seg_mode_sourcing.csv"); print("\nPar mode de sourcing:\n", s.round(1).to_string())
