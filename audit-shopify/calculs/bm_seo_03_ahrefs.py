#!/usr/bin/env python3
"""bm_seo_03_ahrefs.py — concentration du trafic organique estimé (Ahrefs Lite, CH, 2026-10-15) + chronologie.

LECTURE SEULE sur tableaux/bm_seo_ahrefs_*.csv (extraits via le MCP Ahrefs). Estimations d'outil, pas des mesures Search Console.
Sortie : tableaux/bm_seo_ahrefs_concentration.csv
"""
import csv, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, "tableaux")
rows = list(csv.DictReader(open(os.path.join(T, "bm_seo_ahrefs_keywords_CH_2026-10-15.csv"))))
tot = sum(float(r["est_traffic"]) for r in rows)


def part(pred):
    return sum(float(r["est_traffic"]) for r in rows if pred(r))


lang = lambda u: "de" if u.startswith("/de") else "en" if u.startswith("/en") else "fr/défaut"
out = [
    ("top40_mots_cles_trafic_estime_total", tot),
    ("requête de marque « resell lausanne »", part(lambda r: "resell lausanne" in r["keyword"])),
    ("cluster Essentials (stock propre)", part(lambda r: "essentials" in r["keyword"])),
    ("URL de départ = accueil /", part(lambda r: r["best_url"] == "/")),
    ("URL de départ = /Sneakers/Nike (404 constaté 2026-11-02)", part(lambda r: r["best_url"].startswith("/Sneakers"))),
]
for l in ("fr/défaut", "de", "en"):
    out.append((f"URL en langue {l}", part(lambda r, l=l: lang(r["best_url"]) == l)))
with open(os.path.join(T, "bm_seo_ahrefs_concentration.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["indicateur", "trafic_estime_mensuel", "part_%"])
    for k, v in out:
        w.writerow([k, round(v), round(100 * v / tot, 1)])
        print(k, round(v), round(100 * v / tot, 1))

# chronologie du trafic organique estimé (tous pays)
h = list(csv.DictReader(open(os.path.join(T, "bm_seo_ahrefs_metrics_history.csv"))))
print([(r["date"][:7], r["org_traffic_est_all_countries"]) for r in h if r["date"] >= "2025-01"])

# --- Ordre de grandeur du risque SEO d'une migration (HYPOTHÈSES de baisse, non des prévisions) ---
# Faits internes (bm_mix_*, fin_00) : commandes taguées SEO 2026-10 = 49 ; panier moyen TTC 252.8 CHF ;
# contribution avant pub = 28.8 CHF/commande (fin_00_base_financiere.md).
SEO_ORDERS_M, AOV, CONTRIB = 49, 252.8, 28.8
with open(os.path.join(T, "bm_seo_migration_risque_ordre_grandeur.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["scenario_hypothese", "baisse_trafic_SEO_%", "duree_mois", "commandes_perdues", "CA_TTC_perdu_CHF", "contribution_perdue_CHF"])
    for name, drop, months in [("léger", 0.2, 3), ("médian", 0.4, 6), ("sévère", 0.6, 12)]:
        lost = SEO_ORDERS_M * drop * months
        w.writerow([name, int(drop * 100), months, round(lost), round(lost * AOV), round(lost * CONTRIB)])
        print(name, round(lost), round(lost * AOV), round(lost * CONTRIB))
