#!/usr/bin/env python3
"""bm_data_02_options.py — base chiffrée de la matrice d'options de repositionnement (bm_02) et du benchmark (bm_01).

LECTURE SEULE sur tableaux/ déjà produits (bm_mix_*, fin_06_*). Aucune PII.
Sortie : tableaux/bm_options_base.csv
Définitions : CA = revenu TTC conservé CHF (bm_mix_*) ; « marge affichée » = définition du tableau de bord (fin_00 §2) : SURESTIMÉE, utilisée seulement pour comparer des segments.
"""
import csv, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, "tableaux")


def rd(name):
    with open(os.path.join(T, name), newline="") as f:
        return list(csv.DictReader(f))


out = []

# 1. Concentration par marque (12 derniers mois, bm_mix_marque)
brands = rd("bm_mix_marque.csv")
tot = sum(float(b["revenue_ttc"]) for b in brands)
grp = {"Nike+Jordan+adidas": ["Nike", "Jordan", "adidas"],
       "ASICS+New Balance+UGG+Saucony+Onitsuka": ["ASICS", "New Balance", "UGG", "Saucony", "Onitsuka Tiger"],
       "Fear of God (Essentials)": ["Fear of God"], "LEGO+Swatch (collectibles/montres)": ["LEGO", "Swatch"]}
for g, names in grp.items():
    s = sum(float(b["revenue_ttc"]) for b in brands if b["vendor"] in names)
    out.append({"bloc": "marque", "segment": g, "ca_ttc_chf": round(s), "part_ca_%": round(100 * s / tot, 1),
                "note": "bm_mix_marque.csv (échantillon = lignes de commande avec vendor)"})

# 2. Sourcing (fin_06_seg_mode_sourcing, 2026-01..10)
src = rd("fin_06_seg_mode_sourcing.csv")
t2 = sum(float(r["ca_ttc"]) for r in src)
for r in src:
    out.append({"bloc": "sourcing", "segment": r["mode"], "ca_ttc_chf": round(float(r["ca_ttc"])),
                "part_ca_%": round(100 * float(r["ca_ttc"]) / t2, 1),
                "note": f"marge affichée {r['marge_aff_pct']} % (surestimée) ; lignes {r['lignes']}"})

# 3. Tranches de prix (bm_mix_tranche_prix, 12 mois)
tp = rd("bm_mix_tranche_prix.csv")
for r in tp:
    out.append({"bloc": "tranche_prix", "segment": r["band"], "ca_ttc_chf": round(float(r["revenue_ttc"])),
                "part_ca_%": r["share_rev_%"], "note": f"part unités {r['share_units_%']} %"})

# 4. Pays (12 mois glissants 2025-11..2026-10)
pays = [r for r in rd("bm_mix_pays.csv") if r["period"] == "2025-11..2026-10"]
tp_ = sum(float(r["kept_ttc"]) for r in pays)
for r in pays:
    out.append({"bloc": "pays", "segment": r["ship_cc"], "ca_ttc_chf": round(float(r["kept_ttc"])),
                "part_ca_%": round(100 * float(r["kept_ttc"]) / tp_, 2), "note": f"commandes {r['orders']}, AOV {r['aov']}"})

# 5. Récurrence (bm_mix_recurrence)
for r in rd("bm_mix_recurrence.csv"):
    out.append({"bloc": "recurrence", "segment": f"commande n°{r['order_index']}", "ca_ttc_chf": round(float(r["kept"])),
                "part_ca_%": r["share_%"], "note": f"commandes {r['orders']}"})

# 6. Sources de trafic first-visit (bm_mix_source_first_visit) : SEO Google vs reste
fv = rd("bm_mix_source_first_visit.csv")
seo = sum(float(r["share_%"]) for r in fv if r["fv_type"] == "SEO")
goo = sum(float(r["share_%"]) for r in fv if r["fv_source"] == "Google" and r["fv_type"] == "")
ai = sum(float(r["share_%"]) for r in fv if "chatgpt" in r["fv_source"].lower())
out.append({"bloc": "acquisition", "segment": "first visit : Google non étiqueté SEO (surtout Ads)", "ca_ttc_chf": "", "part_ca_%": round(goo, 1), "note": "bm_mix_source_first_visit.csv"})
out.append({"bloc": "acquisition", "segment": "first visit : SEO (Google+Bing+Yahoo+DDG)", "ca_ttc_chf": "", "part_ca_%": round(seo, 1), "note": "type SEO du journey Shopify"})
out.append({"bloc": "acquisition", "segment": "first visit : ChatGPT", "ca_ttc_chf": "", "part_ca_%": round(ai, 1), "note": "ChatGPT + chatgpt.com ; attribution déclarative"})

os.makedirs(T, exist_ok=True)
with open(os.path.join(T, "bm_options_base.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["bloc", "segment", "ca_ttc_chf", "part_ca_%", "note"])
    w.writeheader(); w.writerows(out)
for o in out:
    print(o)
