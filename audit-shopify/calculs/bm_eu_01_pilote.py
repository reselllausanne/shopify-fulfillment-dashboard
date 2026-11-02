#!/usr/bin/env python3
"""bm_eu_01_pilote.py — coût d'expédier depuis la Suisse vers DE/FR/AT/IT/NL (bm_05_europe.md).

LECTURE SEULE. Aucune donnée client. Sorties : tableaux/bm_eu_landed_cost.csv, tableaux/bm_eu_pilote_pnl.csv.

Chaque paramètre est étiqueté F (fait sourcé), I (interprétation) ou H (hypothèse à vérifier).
Aucun taux n'est « inventé » : les H sont des valeurs de sensibilité, à remplacer par des devis réels.
"""
import csv, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tableaux")

# --- Paramètres -------------------------------------------------------------
P = {
    # F : analyses/fin_00_base_financiere.md §3 (commande moyenne 2026, CHF)
    "net_ht_par_commande": 201.6,   # F revenu net HT conservé
    "cout_achat": 150.8,            # F coût d'achat (dont une part estimée)
    "frais_paiement": 6.1,          # F/H
    "exp_prepa_ch": 14.0,           # H forfait interne CH (6,5 + 8,0 ; fin_00)
    "litiges": 1.8,                 # F
    # F : site public (2026-11-02) « 10 CHF en Europe » ; commandes observées : ~30,7-31,2 CHF facturés quand non gratuit
    "port_facture_client_obs": 31.0,
    # H : coût réel transporteur CH->UE (aucun devis consulté) ; valeurs de sensibilité
    "port_cout_h": [20.0, 30.0, 40.0],
    # F : TARIC 6404 11 00 — droit pays tiers 16,9 % (consulté 2026-11-02, tarific.eu / thetradehub.eu)
    "droit_tiers": 0.169,
    # H : change CHF par EUR (à actualiser) — sert seulement au seuil de 150 EUR
    "chf_par_eur": 0.93,
    # F : seuil 150 EUR par envoi (Règlement (UE) 2026/382 art. 2 ; IOSS)
    "seuil_eur": 150.0,
    "droit_forfait_eur": 3.0,       # F : 3 EUR par article, jusqu'au 1.7.2028
}
# TVA standard à l'importation = taux du pays de destination. H : à re-vérifier dans TEDB (Commission) avant usage.
TVA = {"DE": 0.19, "FR": 0.20, "AT": 0.20, "IT": 0.22, "NL": 0.21}


def landed(price_ht, port, vat, regime):
    """Coût total vu par le client final (CHF), selon régime.
    regime 'normal' : valeur en douane = prix + port (hypothèse CIF), droit 16,9 %, TVA import sur (valeur + droit).
    regime 'ioss'   : <=150 EUR, droit forfaitaire 3 EUR/article, TVA destination perçue au checkout (IOSS).
    """
    if regime == "normal":
        cv = price_ht + port
        duty = cv * P["droit_tiers"]
        tva = (cv + duty) * vat
    else:
        duty = P["droit_forfait_eur"] * P["chf_par_eur"]
        tva = price_ht * vat  # base IOSS = prix hors port (simplification ; port peut être inclus selon Etat)
    return {"valeur_douane": price_ht + port, "droit": duty, "tva_import": tva,
            "total_client": price_ht + port + duty + tva}


rows = []
ref_ch_ttc = P["net_ht_par_commande"] * 1.081  # prix moyen TTC CH conservé (~217,9)
for cc, vat in TVA.items():
    for port in P["port_cout_h"]:
        for price_ht, label in [(P["net_ht_par_commande"], "commande moyenne CH (201,6 HT)"),
                                (100.0, "petit ticket 100 HT")]:
            envoi_eur = (price_ht + port) * 0 + price_ht / P["chf_par_eur"]
            regime = "ioss" if envoi_eur <= P["seuil_eur"] else "normal"
            L = landed(price_ht, port, vat, regime)
            rows.append({
                "pays": cc, "ticket": label, "port_H": port, "regime": regime,
                "valeur_envoi_eur_approx": round(envoi_eur, 1),
                "prix_HT": price_ht, "droit": round(L["droit"], 1), "tva_import": round(L["tva_import"], 1),
                "total_client_chf": round(L["total_client"], 1),
                "vs_prix_CH_ttc_pct": round(100 * (L["total_client"] / (price_ht * 1.081) - 1), 1),
            })

with open(os.path.join(OUT, "bm_eu_landed_cost.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader(); w.writerows(rows)

# --- P&L pilote simplifié par commande, scénarios DDP (vendeur paie droit+TVA import) ---------------
base_contrib = (P["net_ht_par_commande"] - P["cout_achat"] - P["frais_paiement"] - P["exp_prepa_ch"] - P["litiges"])
pnl = []
for cc, vat in [("DE", TVA["DE"])]:
    for port in P["port_cout_h"]:
        for label, absorb in [("DAP (client paie droit+TVA à la livraison)", 0.0),
                              ("DDP droit absorbé par nous, TVA payée par le client", 1.0)]:
            L = landed(P["net_ht_par_commande"], port, vat, "normal")
            # port facturé au client: observé ~31 ; on suppose facturé tel quel (F), coût réel = port (H)
            marge = base_contrib + P["port_facture_client_obs"] - port - absorb * L["droit"]
            pnl.append({"pays": cc, "port_cout_H": port, "schema": label,
                        "contrib_avant_pub_CH_F": round(base_contrib, 1),
                        "port_facture_F": P["port_facture_client_obs"],
                        "droit_absorbe": round(absorb * L["droit"], 1),
                        "contrib_avant_pub_EU": round(marge, 1)})

with open(os.path.join(OUT, "bm_eu_pilote_pnl.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(pnl[0].keys()))
    w.writeheader(); w.writerows(pnl)

print("contribution avant pub CH (fin_00) =", round(base_contrib, 1))
for r in pnl:
    print(r)
print("exemples landed (DE, port 30, commande moyenne):",
      [x for x in rows if x["pays"] == "DE" and x["port_H"] == 30.0])
