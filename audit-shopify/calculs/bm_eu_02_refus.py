#!/usr/bin/env python3
"""bm_eu_02_refus.py — sensibilité de la contribution EU (régime DAP) au taux de refus/retour de colis.

LECTURE SEULE. Entrées : valeurs de bm_eu_01_pilote.py / fin_00 (CHF/commande). Sortie : tableaux/bm_eu_refus_sensibilite.csv.
Modèle volontairement simple :
  contribution_DAP_livrée  = 29.9  (DE, port réel 30, port facturé 31 ; bm_eu_pilote_pnl.csv)
  commande refusée         = port aller (H) + port retour (H) + part non récupérée du coût d'achat
  récupération du stock    = H (part du coût d'achat revendable sur le marché CH après retour)
Toutes les valeurs H sont des hypothèses de sensibilité, pas des devis.
"""
import csv, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRIB_LIVREE = 29.9      # tableaux/bm_eu_pilote_pnl.csv, DE, DAP, port réel 30
COUT_ACHAT = 150.8         # fin_00 (coût d'achat moyen)
PORT = 30.0                # H
rows = []
for refus in (0.0, 0.02, 0.05, 0.10, 0.20):
    for recup in (0.9, 0.7, 0.5):
        perte = PORT + PORT + COUT_ACHAT * (1 - recup)
        c = (1 - refus) * CONTRIB_LIVREE - refus * perte
        rows.append((int(refus * 100), int(recup * 100), round(perte, 1), round(c, 1)))
with open(os.path.join(ROOT, "tableaux", "bm_eu_refus_sensibilite.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["taux_refus_%", "recuperation_stock_%", "perte_par_colis_refuse_CHF", "contribution_par_commande_avant_pub_CHF"])
    w.writerows(rows)
for r in rows:
    print(r)
