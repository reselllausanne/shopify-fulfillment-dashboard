#!/usr/bin/env python3
"""bm_ugc_01_cout.py — coût total d'un lancement par étapes (UGC + test média) et seuil de rentabilité publicitaire.

LECTURE SEULE. Sorties : tableaux/bm_ugc_cout_lancement.csv, tableaux/bm_ugc_seuil_roas.csv.

Étiquettes : F = fait interne (fin_00) ; P = affirmation de prestataires (blogs/agences, non audité) ; H = hypothèse.
Aucun taux de créateur n'est un devis : à remplacer par des devis réels.
"""
import csv, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, "tableaux")

# --- F : fin_00_base_financiere.md (2026-01→10, CHF) -------------------------
BRUT_TTC = 685_086
REMBOURSE = 57_789
CONTRIB_AVANT_PUB = 82_913
PUB_GOOGLE = 100_856
COMMANDES = 2_882
CONTRIB_CMD = CONTRIB_AVANT_PUB / COMMANDES      # ≈ 28,8
KEPT_TTC = BRUT_TTC - REMBOURSE                  # 627 297
roas_obs = KEPT_TTC / PUB_GOOGLE                 # ROAS observé sur CA conservé TTC
marge_pct = CONTRIB_AVANT_PUB / KEPT_TTC
roas_seuil = 1 / marge_pct
with open(os.path.join(T, "bm_ugc_seuil_roas.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["indicateur", "valeur", "etiquette", "source"])
    w.writerow(["CA conservé TTC 2026-01..10 (CHF)", KEPT_TTC, "F", "fin_00 §1 (brut − remboursements)"])
    w.writerow(["Contribution avant pub (CHF)", CONTRIB_AVANT_PUB, "F", "fin_00 §1"])
    w.writerow(["Pub Google (CHF)", PUB_GOOGLE, "F", "fin_00 §1"])
    w.writerow(["Contribution avant pub par commande (CHF)", round(CONTRIB_CMD, 1), "F", "fin_00 §3"])
    w.writerow(["Contribution avant pub / CA conservé TTC (%)", round(100 * marge_pct, 1), "calcul", ""])
    w.writerow(["ROAS observé (CA conservé TTC / pub)", round(roas_obs, 2), "calcul", ""])
    w.writerow(["ROAS d'équilibre avant frais fixes (= 1 / marge)", round(roas_seuil, 2), "calcul", "valable pour une commande moyenne ; hors valeur de réachat"])
    w.writerow(["CPA d'équilibre par nouvelle commande (CHF)", round(CONTRIB_CMD, 1), "calcul", "nouveau client 28 CHF (fin_00 §5)"])
print("ROAS observé", round(roas_obs, 2), "| ROAS équilibre", round(roas_seuil, 2), "| CPA équilibre", round(CONTRIB_CMD, 1))

# --- Scénarios de coût (H/P) -------------------------------------------------
HEURE = 40.0          # H : valorisation du temps (≈ 6 000 CHF/mois de fin_00 sur ≈ 150 h)
COUT_ACHAT_PAIRE = 150.8  # F : coût d'achat moyen par commande (fin_00 §3) — pour produits offerts
SC = {
    #            videos, tarif/vidéo (P), droits pub DACH (P), produits offerts, h travail contenu, média test (H), h travail pub
    "bas":     dict(videos=4,  tarif=300, droits=0.20, offerts=0, h_contenu=25, media=1500, h_pub=10),
    "médian":  dict(videos=8,  tarif=400, droits=0.25, offerts=3, h_contenu=40, media=3000, h_pub=20),
    "haut":    dict(videos=12, tarif=500, droits=0.30, offerts=5, h_contenu=60, media=5000, h_pub=30),
}
rows = []
for name, p in SC.items():
    creators = p["videos"] * p["tarif"] * (1 + p["droits"])
    offerts = p["offerts"] * COUT_ACHAT_PAIRE
    travail = (p["h_contenu"] + p["h_pub"]) * HEURE
    hors_media = creators + offerts + travail
    total = hors_media + p["media"]
    rows.append([name, p["videos"], p["tarif"], int(100 * p["droits"]), round(creators), round(offerts), p["h_contenu"] + p["h_pub"],
                 round(travail), p["media"], round(hors_media), round(total), round(hors_media / CONTRIB_CMD)])
with open(os.path.join(T, "bm_ugc_cout_lancement.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["scenario", "videos", "tarif_video_CHF(P)", "droits_pub_%(P)", "createurs_CHF", "produits_offerts_CHF(F)",
                "heures_travail(H)", "travail_CHF(H)", "media_test_CHF(H)", "total_hors_media_CHF", "total_CHF",
                "commandes_pour_amortir_hors_media(a 28.8 CHF)"])
    w.writerows(rows)
for r in rows:
    print(r)
