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
| 21:10 | Trou de données : 211 lignes stock propre à coût 0 → résultat −28,8 k (scénario J de `fin_06`) | Documenté |
| 21:15 | Sous-agent [Audit SAV emails avis fidélisation](7b78d56d-5d2f-4d9b-9cc3-330d2683dbd1) terminé : `analyses/cx_01..04` | Contrôlé : 97 vs 93/180 commandes bloquées réconciliées ; `fin_07_seg_paiement` corrigé (store credit = artefact). Alerte : jeton Postmark apparu dans une sortie d'outil → renouvellement recommandé |
| — | Sous-agents Ads (`e2db25c1…`) et Benchmark (`530b59b3…`) | En cours |

## Décisions de modélisation
- Scénarios fin_06 C (TVA non due), G, H retirés (entité assujettie ; hypothèses irréalistes).
- Trésorerie d'ouverture = 0 (aucune donnée bancaire) : les sorties sont des variations, pas des niveaux.
