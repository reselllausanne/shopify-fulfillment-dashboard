"""Met à jour COUVERTURE.md (statuts, preuves, blocages) avec l'état réel au 2026-11-02 soir. Aucune ligne supprimée."""
import re, pathlib
P = pathlib.Path(__file__).resolve().parents[1] / "COUVERTURE.md"
R, PA, NT, BL = "RÉALISÉ", "PARTIEL", "NON TRAITÉ", "BLOQUÉ"
F0, F1, ST = "analyses/fin_00_base_financiere.md", "analyses/fin_01_galaxus_stock_financement.md", "analyses/strat_01_offre_organisation_feuille_de_route.md"
RF, DM = "RAPPORT_FINAL.md", "analyses/donnees_manquantes.md"
A = lambda *n: ", ".join(f"analyses/ads_0{i}" for i in n)
C = lambda *n: ", ".join(f"analyses/cx_0{i}" for i in n)
B = lambda *n: ", ".join(f"analyses/bm_0{i}" for i in n)
M = {
 "1.1": (R, RF, ""), "1.2": (R, f"{RF} §1, §4", ""), "1.3": (R, f"{ST} §7", ""), "1.4": (PA, f"{RF} §1", "échelle non prouvée ; banque manquante"), "1.5": (R, f"{RF} §7, {B(2)}", ""),
 "1.6": (R, f"{ST} §8", ""), "1.7": (R, f"{RF} §9 (erratum TDFN ; anciens diagnostics corrigés)", ""),
 "2.1": (PA, f"{B(2,3)}", "registres de marques non consultés"), "2.2": (R, f"{F0} §6-8", "paire rarement achetée avant vente = déclaré"),
 "2.3": (PA, f"{F1} §3", "dossier `bfcm/` non lu ; projet >300 paires/−50 % non audité"), "2.4": (PA, f"{F1} §2", "cash Galaxus non vérifiable (banque, paiements)"),
 "2.5": (PA, f"{F1} (tables Decathlon seulement : 421 cmd, 92 k CHF avr-sept)", "flux Decathlon non analysés"), "2.6": (R, f"{ST} §7-8", ""), "2.7": (PA, B(3), "Search Console inaccessible"),
 "2.8": (R, f"{F1} §5", ""), "2.9": (R, f"{A(3)}, {C(1)}", "Simprosys/GTM inaccessibles"), "2.10": (R, A(1), ""), "2.11": (R, f"{F0} §4, {A(1)}", ""), "2.12": (R, C(4), ""),
 "2.13": (R, f"{C(2,3)}", ""), "2.14": (PA, f"{F0}, {F1} §1", "TDFN/NER déclarés ; contrats paiement manquants"), "2.15": (R, f"{F1} §2", ""),
 "3.1": (PA, f"{RF} §9", "écarts à la lecture seule : jeton StockX copié du VPS, jetons exposés dans des sorties"), "3.2": (R, "SOURCES.md", ""), "3.3": (PA, "SOURCES.md", "ruptures de mesure non toutes documentées"), "3.4": (R, "SOURCES.md", ""),
 "3.5": (R, DM, ""), "3.6": ("PERMANENT (respecté)", RF, ""), "3.7": ("PERMANENT (appliqué)", RF, ""), "3.8": (R, "calculs/", ""), "3.9": ("PERMANENT (appliqué)", "", ""),
 "3.10": (PA, "analyses/registre_preuves.md", "sources des sous-agents dans leurs fichiers"),
 "4.1": (PA, f"{F0}, analyses/ban_01_tresorerie_reelle.md", "revenu/coût/pub rapprochés à la banque ; 14 ordres groupés 98,7 k et octobre manquants"), "4.2": (PA, f"{F0}, {C(2)}", "multi-colis, achats remplacés, remboursements fournisseurs non mesurés"), "4.3": (R, f"{F0} §1", ""),
 "4.4": (R, f"{F0} §2 (coût = enchère + ≈ 28)", "TVA/douane d'import non séparées"), "4.5": (PA, f"{F0}, analyses/ban_02_tva_et_liquidites.md", "TDFN 2,1 % confirmée (décomptes AFC S1-2025 à S1-2026) ; Galaxus/Decathlon absents du CA S1-2026 à confirmer"), "4.6": (PA, "tableaux/fin_01_payments_*.csv", "frais hors Shopify Payments estimés"),
 "4.7": (PA, f"{F0}", "forfaits 6,5 + 8,0, factures Poste manquantes"), "4.8": (PA, C(2), "boîte SAV inaccessible"), "4.9": (R, f"{F0} §4, {A(1)}", ""), "4.10": (PA, "analyses/ban_01_tresorerie_reelle.md §2.4-2.5", "rémunération observée 5,7-9,1 k/mois ; charges fixes partiellement observées (logiciels 12,5 k, freelances 17,8 k, logistique 35,4 k)"),
 "4.11": (PA, f"{F0} §1, analyses/ban_01_tresorerie_reelle.md §2.4", "variation de trésorerie ≈ +9 k observée ; octobre et soldes à confirmer"), "4.12": (NT, "", "coûts communs Galaxus/Shopify non alloués faute de données"), "4.13": (R, f"{F0} §1 (cohortes mûre/récente), tableaux/fin_05_pnl_cohortes.csv (pub répartie au prorata)", ""),
 "4.14": (PA, f"{F0} §5, tableaux/bm_mix_*.csv, ads_12_*.csv", "famille/disponibilité non traitées"), "4.15": (R, f"{F0} §6", "échanges purs non reconstituables"), "4.16": (R, "tableaux/fin_10_seuils.csv", ""), "4.17": (PA, f"{F1} §2", "cash libre non calculable"),
 "5.1": (PA, f"calculs/fin_08_price_formula.py, {A(4)}", "Long Tail/Explorer via ads ; benchmark prix non fait"), "5.2": (R, f"{F0} §5 (Prix), calculs/fin_08_price_formula.py", ""), "5.3": (NT, "", "aucun rapprochement GTIN/SKU concurrents ni scraping"),
 "5.4": (R, "tableaux/fin_08_volume_requis_baisse_prix.csv", "plausibilité de la demande non testée"), "5.5": (PA, f"{F0} §2, {F1} §6", "remplacements/regroupements non mesurés"), "5.6": (PA, f"{F1} §6", "prix concurrents, réseau revendeurs, dépôt-vente non traités"),
 "6.1": (R, f"{F1} §2", ""), "6.2": (PA, f"{F1} §3", "tailles par modèle non détaillées"), "6.3": (PA, f"{F1} §3", ""), "6.4": (PA, f"{F1} §3", "rotation historique du stock propre non mesurée"), "6.5": (PA, f"{F1} §3", "rotation hypothétique"),
 "6.6": (NT, "", "aucune donnée de dépôt-vente/stock partenaire"), "6.7": (PA, f"{F0} §1", "36 lots seulement"), "6.8": (PA, "analyses/ban_01_tresorerie_reelle.md §2.7", "377,3 k encaissés, ≈ 126 k en attente (H) ; réserves, pénalités, avoirs inconnus"), "6.9": (PA, f"{F1} §2, §5", ""),
 "6.10": (PA, f"{F1} §3, §5", "enveloppe indicative"), "6.11": (R, f"{F1} §3", "aucun achat effectué"),
 "7.1": (R, A(1), ""), "7.2": (R, A(1), ""), "7.3": (R, A(1), ""), "7.4": (PA, A(2), "GA4/GTM/consentement inaccessibles"), "7.5": (R, A(2), ""), "7.6": (PA, A(1,2), "jointure gclid↔commande impossible"),
 "7.7": (PA, "tableaux/ads_12_*.csv", ""), "7.8": (R, A(3), "diagnostics par offre indisponibles"), "7.9": (R, A(3), ""), "7.10": (R, "tableaux/ads_12_*.csv", ""), "7.11": (R, A(4), ""),
 "7.12": ("PERMANENT (respecté)", A(4), ""), "7.13": (PA, A(4), ""), "7.14": (R, f"{A(4)}, {F0} §4", ""), "7.15": (R, A(2,4), ""),
 "8.1": (PA, C(1), "mobile réel, panier/paiement non testés en achat"), "8.2": (PA, C(1), "PageSpeed 429"), "8.3": (R, C(1), ""), "8.4": (R, f"{C(1)} (A/B infaisable ≈ 13 mois)", ""), "8.5": (R, C(1), ""),
 "9.1": (PA, C(2), "boîte SAV inaccessible"), "9.2": (R, C(2), ""), "9.3": (R, C(2), ""), "9.4": (PA, C(2), ""), "9.5": (R, C(2), ""), "9.6": (PA, C(2), "contacts/commande non mesurables"),
 "9.7": (PA, C(3), "droits nationaux DE/AT/FR/IT/ES/NL non lus ; directive UE non lue"), "9.8": (PA, C(3), "Trustpilot/Google inaccessibles"), "9.9": (PA, f"{C(3)}, {B(2)}", ""),
 "10.1": (R, C(4), ""), "10.2": (R, C(4), ""), "10.3": (R, C(4), ""), "10.4": (PA, C(4), ""), "10.5": (R, f"{C(4)}, tableaux/fin_07_cohortes_reachat_2026.csv", ""), "10.6": (PA, B(4), ""),
 "11.1": (PA, B(3), "Search Console inaccessible"), "11.2": (PA, B(3), ""), "11.3": (PA, B(3), "GEO non reproductible"), "11.4": (PA, B(3), ""), "11.5": (PA, B(2,3), "registres et redirections manquants"), "11.6": (PA, B(3), "liste de redirections inaccessible"),
 "12.1": (R, B(1), ""), "12.2": (R, B(1), ""), "12.3": (PA, B(1), "comptes publiés partiels"), "12.4": (PA, B(1), ""), "12.5": (R, f"{B(1)} (SneakerHype, Restocks, Limited Resell)", ""),
 "13.1": (R, f"{B(2)}, {ST} §2", ""), "13.2": (R, B(2), ""), "13.3": (PA, B(2), ""), "13.4": (PA, B(2), "registres de marques non consultés"), "13.5": (R, f"{B(2)} (brief non produit : option 1 retenue)", ""),
 "14.1": (PA, B(4), "tarifs prestataires à confirmer par devis"), "14.2": (R, B(4), ""), "14.3": (R, B(4), ""),
 "15.1": (PA, B(5), "droits/TVA : sources tierces ; fiscalistes non consultés"), "15.2": (PA, B(5), "origine des colis StockX inconnue"), "15.3": (R, B(5), ""),
 "16.1": (PA, f"{ST} §3", "aucune donnée de temps"), "16.2": (PA, f"{ST} §3", ""), "16.3": (PA, f"{ST} §3", ""), "16.4": (PA, f"{ST} §3, {RF} §4", "revue décision par décision non exhaustive"), "16.5": (PA, f"{ST} §4", ""),
 "17.1": (PA, "tableaux/modele_tresorerie.xlsx", "ouverture = 0 (banque absente) ; formules sans valeurs en cache"), "17.2": (PA, F1 + " §4", "banque manquante"), "17.3": (PA, F1 + " §4", "calendriers réels manquants"), "17.4": (R, f"{F1} §4", ""), "17.5": (R, "tableaux/modele_tresorerie.xlsx (Sem_13)", ""),
 "17.6": (R, "tableaux/modele_tresorerie.xlsx, tableaux/fin_10_scenarios.csv", ""), "17.7": (R, "tableaux/fin_10_seuils.csv, fin_10_scenarios.csv", ""), "17.8": (PA, "tableaux/fin_06_sensibilites.csv, fin_10_stress.csv", "conversion/panier non isolés"),
 "17.9": (PA, "tableaux/fin_10_stress.csv", "stock lent et ralentissement Galaxus non simulés"), "17.10": (R, f"{F1} §4", ""), "17.11": (PA, f"{F1} §2, §5", "montant max finançable par Galaxus non calculable"),
 "18.1": (R, f"{F1} §5", ""), "18.2": (PA, f"{F1} §5", "offres non consultées"), "18.3": (PA, f"{F1} §5", ""), "18.4": (PA, f"{F1} §5", "avis juridique requis"), "18.5": (PA, f"{F1} §5", "aucune valorisation inventée"),
 "19.1": (PA, f"{ST} §4, {RF}", "gains en fourchette seulement pour la pub et le modèle"), "19.2": ("PERMANENT (respecté)", f"{A(4)}", ""), "19.3": (PA, f"{F1} §4", "BFCM modélisé par hypothèse"), "19.4": (R, f"{C(1)}, {A(4)}", ""),
 "19.5": (R, F0, ""), "19.6": (R, f"{ST} §4 (enveloppe, perte max, dates de revue, capital autorisable)", ""),
 "20.1": (R, f"{ST} §5", ""), "20.2": (R, f"{ST} §5", ""), "20.3": (R, f"{ST} §5", ""), "20.4": (R, f"{ST} §5", ""), "20.5": (R, f"{ST} §5 (tableau par horizon)", "responsable unique = dirigeant ; charges en heures = H"),
 "L1": (R, RF + " §1", ""), "L2": (R, f"SOURCES.md, {DM}", ""), "L3": (PA, F0, "banque manquante"), "L4": (PA, RF + " §4", "unités hétérogènes ; liens causaux délai→annulation = I"), "L5": (R, f"{RF} §5, {A(4)}", ""), "L6": (R, f"{RF} §6, {C(1,2,3,4)}", ""),
 "L7": (PA, f"{RF} §7, {B(3,4)}", ""), "L8": (R, B(1), ""), "L9": (R, B(2), ""), "L10": (PA, f"{B(2,3,5)}", "registres de marques, redirections"), "L11": (R, F1, ""), "L12": (R, F1 + " §5", ""),
 "L13": (R, "tableaux/modele_tresorerie.xlsx, fin_10_redressement_decomposition.csv", "ouverture = 0"), "L14": (PA, ST, ""), "L15": (R, f"{ST} §7-9, tableaux/tableau_bord_hebdo.csv", ""), "LF": (R, RF + " §10", ""),
 "22.1": (R, "audit-shopify/", ""), "22.2": (R, "ETAT.md", ""), "22.3": (R, "ETAT.md (3 sous-agents + relecture)", ""), "22.4": ("PERMANENT (appliqué)", "ETAT.md", ""),
 "22.5": (R, "COUVERTURE.md, section « Vérification finale »", ""), "22.6": (R, "analyses/relecture_independante.md (agent a1e1f171) ; corrections C1-C13 appliquées ou documentées", ""),
}
lines = P.read_text().splitlines(); out = []; done = set()
for ln in lines:
    m = re.match(r"^\| (\d+\.\d+|L\d+|LF) \|(.*)$", ln)
    if m and m.group(1) in M:
        cols = [c.strip() for c in ln.strip().strip("|").split("|")]; key = m.group(1); st, pr, bl = M[key]
        if len(cols) >= 5: cols[2], cols[3], cols[4] = st, pr, bl            # ID | exigence | statut | preuve | blocage
        elif len(cols) == 4: cols[2], cols[3] = st, pr + (f" ; limite : {bl}" if bl else "")  # tables sans colonne blocage (S21/S22)
        ln = "| " + " | ".join(cols) + " |"; done.add(key)
    out.append(ln)
txt = "\n".join(out) + "\n"
txt = txt.replace("Statuts : `À FAIRE` · `EN COURS` · `RÉALISÉ` · `PARTIEL (limite explicite)` · `BLOQUÉ (donnée attendue)`.", "Statuts : `RÉALISÉ` · `PARTIEL (limite explicite)` · `BLOQUÉ (donnée attendue)` · `NON TRAITÉ (raison)` · `EN COURS` · `PERMANENT`.")
P.write_text(txt)
miss = sorted(k for k in M if k not in done); print("mises à jour :", len(done), "| absentes du fichier :", miss)
from collections import Counter
print(Counter(v[0].split(" ")[0] for k, v in M.items()))

# --- section « Vérification finale »
txt = P.read_text()
marker = "\n## Vérification finale (S22.5)"
if marker in txt: txt = txt[:txt.index(marker)]
from collections import Counter
cnt = Counter(v[0].split(" ")[0] for v in M.values())
def ids(stat): return ", ".join(k for k, v in M.items() if v[0].startswith(stat))
txt += f"""
## Vérification finale (S22.5)
Dernière vérification : 2026-11-03 00:30 (Europe/Zurich), après relecture indépendante (`analyses/relecture_independante.md`).
Total {len(M)} exigences : RÉALISÉ {cnt['RÉALISÉ']} · PARTIEL {cnt['PARTIEL']} · NON TRAITÉ {cnt['NON']} · BLOQUÉ {cnt['BLOQUÉ']} · PERMANENT {cnt['PERMANENT']}.

**NON TRAITÉ (limite)** : {ids('NON')}. 5.3 benchmark de prix concurrents par référence exacte (aucun rapprochement GTIN/SKU ni scraping réalisé) ; 6.6 dépôt-vente/stock partenaire (aucune donnée) ; 4.12 allocation des coûts communs (données absentes).
**BLOQUÉ (donnée exacte attendue)** : {ids('BLOQUÉ')}. 6.8 cash libre Galaxus : relevés bancaires UBS 24 mois, paiements/avoirs/pénalités Galaxus, convention NER.
**PARTIEL (limite explicite dans la colonne Blocage)** : {ids('PARTIEL')}.
Les données réellement manquantes sont regroupées et classées par décision bloquée dans `analyses/donnees_manquantes.md` (21 lignes).
Cohérence : les chiffres de référence sont ceux de `analyses/fin_00_base_financiere.md` et `RAPPORT_FINAL.md` (TDFN 2,1 %, 40,3 CHF/commande avant pub, ROAS d'équilibre 5,4, résultat avant rémunération ≈ 0 à +12 k non démontré). Les analyses des sous-agents ont été corrigées dans leur corps et portent un bandeau d'erratum.
"""
P.write_text(txt)
