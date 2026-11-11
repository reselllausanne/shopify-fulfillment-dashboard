# ETAT — avancement de l'audit Shopify / Resell Lausanne

**Reprise après coupure de contexte : lire ETAT.md → SOURCES.md → COUVERTURE.md avant toute extraction.**

- Démarrage audit : 2026-11-02 ~20:45 Europe/Zurich
- Branche de travail : `feat/audit-shopify-reset` (depuis `origin/main`). Branche précédente `feat/bfcm-2026-audience` intacte ; `bfcm/` (non suivi) non touché.
- Mandat : `BRIEF_MAITRE.md` (copie). Suivi des exigences : `COUVERTURE.md`.
- Langue : français. Style de réponse chat : concis (règle utilisateur).

## Règles de sécurité appliquées
- Prod en lecture seule : SQL = `SELECT` uniquement via MCP Supabase (`user-supabase.execute_sql`). Aucun `INSERT/UPDATE/DELETE/DDL`, aucun appel d'API en écriture, aucun message client, aucun achat.
- PII (emails/adresses clients) : ne pas copier en clair dans les livrables ; `donnees_brutes/` exclu de git.
- Secrets : jamais recopiés. Constat d'hygiène consigné dans SOURCES.md.

## Journal
| Date (CET) | Action | Résultat |
|---|---|---|
| 2026-11-02 20:45 | Lecture du brief, création branche, arborescence `audit-shopify/` | OK |
| 2026-11-02 20:50 | Inventaire dépôt + accès DB (Supabase MCP) | DB accessible en lecture ; voir SOURCES.md |

| 2026-11-02 21:00 | Accès Shopify API testé (scopes lecture étendus, `read_all_orders`, payouts, analytics, themes…) | OK |
| 2026-11-02 21:05 | Sous-agents lancés en arrière-plan (3) | Ads/feed/tracking `e2db25c1-324c-4ae6-b369-5942f8a9944e` → analyses/ads_*.md ; Parcours/SAV/avis/fidélisation `7b78d56d-5d2f-4d9b-9cc3-330d2683dbd1` → analyses/cx_*.md ; Benchmark/reposition./SEO/UGC/Europe `530b59b3-9205-4545-af9f-e3c1452455ae` → analyses/bm_*.md. Le pilote doit contrôler leurs preuves avant intégration. |
| 2026-11-02 21:10 | Extraction complète commandes Shopify API → `donnees_brutes/orders_api.ndjson` (en cours) | |

| 2026-11-02 21:30 | Extractions terminées : `donnees_brutes/orders_api.ndjson` (6 650 cmd depuis 2022-12-19, 7 723 lignes), payments (4 485 balance tx, 543 payouts, 35 litiges), OrderMatch (4 053), Galaxus mensuel | OK ; scripts `calculs/extract_*.mjs`, `fin_01..04_*.py` |

## Constats déjà établis (provisoires, à vérifier dans les analyses)
- Fuseau : colonnes `timestamp` Prisma = **UTC** (vérifié sur #7000, #7484) — corriger SOURCES §2 note.
- TVA 8,1 % appliquée sur toutes les commandes depuis 2024-01 (taxes incluses) ; statut d'assujettissement réel non prouvé.
- Pays de livraison 2026 : CH 2 860 / 2 886 commandes (99 %) ; Europe ≈ 26 cmd → aucun historique UE significatif.
- Shopify Payments : frais effectifs 3,17 % des charges (20,5 k CHF sur 645 k CHF, 2022-2026) ; 35 litiges (26 perdus, 16 « fraudulent », 10 « credit not processed », 8 « product not received ») pour 9,6 k CHF. TWINT/PayPal/PowerPay/Cembra (≈ 50 % des commandes 2026) : frais non observés.
- Remboursements 2026 : 255/2 891 commandes (8,8 %) ; ≈ 8 % du brut ; pics juin 14 %, sept. 12 %.
- Couverture rapprochement ligne ↔ coût fournisseur : 83–96 %/mois (CA) ; 320 lignes 2026 (86 k CHF TTC) sans OrderMatch ; 718/3 920 lignes appariées ont un prix OrderMatch ≠ prix API (> 1 CHF) → utiliser le prix API.
- `OrderMatch.supplierCost` = prix d'achat StockX avec ~+26-31 CHF vs bid pour ~2/3 des commandes (frais/transport probablement inclus) — à confirmer.
- Galaxus (HT) mars→oct 2026 ≈ 617 k CHF net ; coûts appariés couvrent seulement ~60 % des lignes.

## Constats déjà établis (provisoires, à vérifier dans les analyses)
- `ShopifyOrder.netSalesChf` double-déduit les remboursements (voir SOURCES §3).
- DB financière quasi vide côté banque/payouts/TVA/salaires → trésorerie réelle non reconstituable sans pièces.
- DailyAdSpend Google 2026 : jan–oct ≈ 100 k CHF ; oct 15,3 k.
- Ventes Shopify brutes (TTC) 2026-01→2026-10 ≈ 640 k CHF (2 729 cmd PAID + remboursées).

## Décisions
- Emplacement : `audit-shopify/` (aucune convention antérieure équivalente trouvée).

## Questions ouvertes (à regrouper en fin d'audit)
(vide pour l'instant)

## Prochaine étape
1. Inventaire détaillé des sources (DB, Shopify API, Google Ads, Klaviyo, Postmark, exports, docs) → SOURCES.md.
2. Base financière commune : ShopifyOrder / OrderMatch / StxPurchaseUnit / ShopifyPayout / DailyAdSpend / Bank* / ManualFinanceEvent.

## Journal (suite, 2026-11-02 soir)
| Heure | Action | Résultat |
|---|---|---|
| 21:00-21:10 | Modèle trésorerie `tableaux/modele_tresorerie.xlsx` (formules vérifiées = moteur Python), `fin_10_*`, base financière `analyses/fin_00_base_financiere.md`, exemples `fin_09` | OK |
| 21:10 | Trou de données : 211 lignes stock propre à coût 0 → résultat 4,3 k (scénario J de `fin_06`, base TDFN corrigée ; l'ancienne valeur « −28,8 k » est périmée) | Documenté |
| 21:15 | Sous-agent [Audit SAV emails avis fidélisation](7b78d56d-5d2f-4d9b-9cc3-330d2683dbd1) terminé : `analyses/cx_01..04` | Contrôlé : 97 vs 93/180 commandes bloquées réconciliées ; `fin_07_seg_paiement` corrigé (store credit = artefact). Alerte : jeton Postmark apparu dans une sortie d'outil → renouvellement recommandé |
| — | Sous-agents Ads (`e2db25c1…`) et Benchmark (`530b59b3…`) | En cours |

## Décisions de modélisation
- Scénarios fin_06 C (TVA non due), G, H retirés (entité assujettie ; hypothèses irréalistes).
- Trésorerie d'ouverture = 0 (aucune donnée bancaire) : les sorties sont des variations, pas des niveaux.
| 21:30 | Sous-agent [Benchmark repositionnement SEO UGC Europe](530b59b3-9205-4545-af9f-e3c1452455ae) terminé : `analyses/bm_01..05` | [CHIFFRES PÉRIMÉS : équilibre 7,6 = ancienne TVA, lire 5,4 = 217,7/40,3] ROAS global 6,2 (627 k / 100,9 k) recalculé = OK. Faillite SneakerHype B.V. (20-05-2025, F.09/25/180) vérifiée via faillissementsdossier.nl : rapport du curateur = modèle « achat sur demande », causes : retours non négociés à l'achat → stock, sorties plus grandes → prix en baisse, besoin de volume ; Restocks failli fin 2023 (RTL). Non vérifiés : taux de douane DE, valeurs fiscales, tarifs créateurs (marqués partiels par le sous-agent). |
| 21:38 | Sous-agent [Audit Ads Merchant feed tracking](e2db25c1-324c-4ae6-b369-5942f8a9944e) terminé : `analyses/ads_01..04` | [CHIFFRES PÉRIMÉS : 28,8 → 40,3 CHF/cmd ; tROAS d'équilibre 6,7-7,9 → 5,4] Contrôlé à l'époque : cohérent avec fin_00 ( CAC global 35,0). Ventes sous coût : 102/125 variantes soldées (−2,9 k si tout vendu : enjeu faible, mais promesse commerciale à corriger). Mes extractions DB castent déjà les dates en `::text` (pas de décalage −1 j). À trancher : récupérabilité TVA import (plafond pub ~10 k vs ~15 k/mois). |

## Journal (2026-11-02 nuit)
| Heure | Action | Résultat |
|---|---|---|
| 22:30 | Message dirigeant : TDFN 2,1 %, NER 10 %, achats après vente, soldes = retours, « accès banques » | TDFN appliquée partout (`fin_05..08`, modèle) : résultat avant rémunération +11,9 k (au lieu de −21,2 k) ; erratum sur 10 analyses sous-agents |
| 23:00 | Backfill coûts via historique StockX (lecture seule, 6 004 achats) | 25 lignes sur 231 récupérées (`fin_11_backfill_proposition.csv`), **aucune écriture en base** |
| 23:30 | Banque/UBS/cartes | **Aucun accès** (tables Bank* vides, pas d'intégration, pas d'export) : voir `donnees_manquantes.md` |
| 23:45 | Rapport final, strat_01, données manquantes, registre des preuves, COUVERTURE mise à jour (177 IDs : 88 réalisés, 77 partiels, 3 non traités, 1 bloqué) | Poussé sur `feat/audit-shopify-reset` |
| — | Relecture indépendante (`a1e1f171…`) | En cours → `analyses/relecture_independante.md` |
| 00:30 | Relecture indépendante [Relecture indépendante audit Shopify](a1e1f171-92f5-4ca0-a42e-6bd3eafbead4) terminée : 35 chiffres recalculés, mécanique OK, 3 bloquants (B1 résultat sur-affirmé, B2 anciens chiffres/G1 Meta, B3 coût estimé 57,9 k faux) + 16 importants | Corrections appliquées : `fin_05` (coût estimé effectif ≈ 38,3 k ; cohortes avec pub au prorata : mûre +5,3 k / récente +6,3 k), `fin_06` (±20 % : +19,6 k / +4,3 k), Favorable ≤ Central (modèle régénéré), décomposition du Redressement (`fin_13`), pub oct. 15 306 / ×5,5 / marginal ≈ 75, 97/93/180/76 réconciliés (`commandes_prioritaires_14j_180j.csv`), 84 % = retours seulement, seuils de preuve harmonisés (≥ 7 CHF après pub ≡ ROAS ≥ 6,5 ; CAC alerte > 35), Galaxus requalifié I/D/H (107-122 k, risque `stockxAmount`, NER 196 k), corps de `bm_02/04/05`, `ads_04`, `cx_01/04` purgés des anciens chiffres, `SOURCES.md` recalé, `donnees_manquantes` 21 lignes, `strat_01` enveloppe + dates de revue + tableau par horizon |
| 00:30 | Non fait / limites : valeurs en cache du classeur (LibreOffice absent), `bm_05` Europe non recalculé, benchmark de prix concurrents, BFCM non audité, test `stockxAmount` sur 18 unités seulement | Documenté dans `COUVERTURE.md` (Vérification finale) |

## Journal (2026-11-04)
| Heure | Action | Résultat |
|---|---|---|
| 21:35 | Dirigeant fournit relevés UBS (pro, perso), ordres 2025, Swisscard, Cornèrcard | 3 204 mouvements 2026 dédupliqués (`ban_01_parse_ubs.py`), 700 ordres 2025 ; données brutes en local hors git (`donnees_banque_local/`) |
| 22:30 | Rapprochement banque/modèle (`ban_02..04`) | Revenu Shopify −3,6 %, coûts −2,6 %, pub au franc ; cash net 2026 ≈ +9 k ; TVA : 40×300 CHF, pas de forfaitaire ; Galaxus ≈ 126 k en attente |
| 22:45 | `analyses/ban_01_tresorerie_reelle.md`, `PLAN_ACTION_14J.md`, RAPPORT_FINAL, donnees_manquantes, COUVERTURE mis à jour | Fait |
| 22:10 | Dirigeant fournit décomptes TVA AFC (S1-2025, S2-2025, S1-2026), courriel fiduciaire, Cornèrcard (janv.-juil.), soldes (perso 8 734,47 + 3 051 ; pro 340 + 14 000 ; Amex 17 200) | TDFN 2,1 % confirmée ; solde AFC ≈ 4 k ; CA déclaré S1-2026 = CA Shopify seul (Galaxus/Decathlon absents, H ≈ 3 k) ; apport familial 20 k ; ordres groupés partiellement expliqués |
| 22:40 | `ban_02_tva_et_liquidites.md` ; opening cash du modèle = 2 969 ; `fin_10` relancé | Central 13 sem. min −1,3 k (Shopify seul) |
| 22:50 | Compta provisoire fiduciaire S1-2026 (P&L bénéfice 44 787 ; bilan 30.06) reçue ; `PLAN_ACTION_14J.md` réécrit en 8 décisions chiffrées | Prélèvements fixes, pots TVA/impôt, coupe pub −30 %, BF sans stock, règle d'achat Galaxus, Decathlon à rapprocher |
| 23:00 | Correction dirigeant : Amex à +17,2 k (créditeur), pas une dette | Liquidités totales 43,3 k ; net après TVA et impôt estimé ≈ +12 k ; ouverture modèle = 37 369 ; plan ajusté (prélèvement 5 k) |
| 23:20 | Retour dirigeant : Decathlon = retours (D), Oct −22 % = retrait non-sneakers (D, mais données : −3 k sur −43 k), TVA Galaxus S1 non corrigée (décision dirigeant) ; part NER/STX calculée en DB + banque | NER 197,3 k / StockX 378,9 k / autres 59,4 k ; NER payé 95,3 k au 30.09 vs dû 139,3 k ; plan : compte NER séparé |
| 23:30 | Correction dirigeant : les 20 k sont son épargne personnelle, pas un prêt | Apport de l'exploitant (2851), pas de remboursement ; règle de plan retirée |
| 17:50 | `analyses/ads_05_explorer_diagnostic.md` : fonctionnement Explorer lu dans le code, résultats DB, dépense marginale | Explorer ≈ 0,7 k CHF, 3 conversions, pas la cause ; dilution : produits avec impressions 11 k → 40 k, +6,7 k pub mai→oct pour +1,5 k valeur déclarée |
- 16:50 MEMO_ADS_A_NE_JAMAIS_OUBLIER.md créé (règles, faits, pistes, sources, erreurs). À relire avant toute action Ads.
- 23:50 ads_07/ads_08 : étude par lot Explorer corrigée du biais de sélection (ads_05 §11) ; score de voisinage non prédictif (ads_07). Memo mis à jour.
- 00:20 ads_09 : enchère marginale + marge (élasticité 0,5-0,7, ROAS marginal 2,3-3,0, POAS par marque, seuil corrigé 4,7-5,1, anomalie 8-10.11). Memo mis à jour.
- 00:50 cash_01 : leviers mensuels chiffrés, bilan fixes (bank), probe gclid Shopify (journey sans query string), tables banque DB vides. Memo non modifié.
