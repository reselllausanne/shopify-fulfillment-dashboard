"""Tableau de bord hebdomadaire (12 dernières semaines, lundi→dimanche, Europe/Zurich) : commandes, revenu net, contribution avant/après pub, CAC, remboursements, délai d'expédition.
Sorties : tableaux/tableau_bord_hebdo.csv. Définitions identiques à fin_00 (TDFN 2,1 %)."""
import pandas as pd, numpy as np, pathlib
R = pathlib.Path(__file__).resolve().parents[1]; D, T = R / "donnees_brutes", R / "tableaux"
p = pd.read_csv(T / "fin_05_orders_pnl.csv"); o = pd.read_csv(D / "orders_flat.csv")
o["c"] = pd.to_datetime(o.created_utc, utc=True).dt.tz_convert("Europe/Zurich")
p = p.merge(o[["name", "c"]], on="name"); p["sem"] = p.c.dt.tz_localize(None).dt.to_period("W-SUN").dt.start_time
p["contrib"] = p.revenu_net_ht - p.cogs - p.frais_paiement - p.exp_prep
a = pd.read_csv(D / "09_adspend_daily.csv"); a["sem"] = pd.to_datetime(a.d).dt.to_period("W-SUN").dt.start_time
ads = a.groupby("sem").pub_chf.sum()
g = p.groupby("sem").agg(commandes=("name", "count"), brut_ttc=("ventes_brutes_ttc", "sum"), rembourse=("refunded", "sum"), net=("revenu_net_ht", "sum"), contrib_avant_pub=("contrib", "sum"), cout_estime=("cogs_est", "sum"))
g = g.join(ads.rename("pub")).fillna({"pub": 0})
g["contrib_apres_pub"] = g.contrib_avant_pub - g.pub; g["cac"] = g.pub / g.commandes; g["taux_remb_pct"] = g.rembourse / g.brut_ttc * 100; g["part_cout_estime_pct"] = g.cout_estime / (g.net.replace(0, np.nan)) * 100
d = pd.read_csv(T / "ops_01_delai_commande_expedition_par_mois.csv")
g = g.tail(12).round(1); g.to_csv(T / "tableau_bord_hebdo.csv"); print(g.to_string())
