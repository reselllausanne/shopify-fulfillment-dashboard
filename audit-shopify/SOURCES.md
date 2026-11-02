# SOURCES — accès, fichiers, dates, définitions, limites

Mise à jour : 2026-11-02 (v1). Heure de référence dirigeant : Europe/Zurich. Devise : CHF sauf mention.
Aucune source ci-dessous n'a été modifiée. Statut = `OK` (lu), `PARTIEL`, `NON TESTÉ`, `INACCESSIBLE`.

## 1. Accès réellement disponibles

| Source | Accès / méthode | Statut | Périmètre / dates | Limites constatées |
|---|---|---|---|---|
| Base Postgres (Supabase, projet `nhxg…`) | MCP `user-supabase.execute_sql` + script local `calculs/db_readonly.mjs` (transaction `READ ONLY`, SELECT/WITH uniquement) | OK | Voir §2 | Pas de compta : pas de banque, pas de payouts, pas de TVA, pas de salaires |
| Shopify Admin API (GraphQL 2026-07) | `calculs/shopify_readonly.mjs` (refuse `mutation`) ; jeton app avec scopes lecture incl. `read_all_orders`, `read_analytics`, `read_reports`, `read_shopify_payments_payouts`, `read_shopify_payments_disputes`, `read_themes`, `read_translations`, `read_markets`, `read_customers`, `read_marketing_events`, `read_returns` | OK (testé 2026-11-02) | Commandes depuis #1001 (2022-12-19) | La base locale ne contient que 2026 ; l'API remonte plus loin |
| Shopify boutique | `taxesIncluded=true`, `taxShipping=false`, plan « Shopify » (pas Plus), devises CHF/EUR, livre CH, DE, AT, FR, IT, ES, NL, fuseau Europe/Zurich, adresse de facturation Bussigny | OK | état au 2026-11-02 | Régime TVA réel non déductible de l'API (voir manques) |
| Google Ads API | Identifiants dans `.env` (`GOOGLE_ADS_*`), code `adsanalytics/` | NON TESTÉ (à tester en lecture GAQL par sous-agent 1) | | |
| Merchant Center | `GOOGLE_MERCHANT_REFRESH_TOKEN` | NON TESTÉ | | |
| Klaviyo | `KLAVIYO_PRIVATE_API_KEY` ; `RecurringExpense` « KLAVIO » **inactive** | NON TESTÉ | | |
| Postmark | `POSTMARK_SERVER_TOKEN` (emails transactionnels) | NON TESTÉ | | |
| StockX / GOAT | sessions locales `.data/` (non utilisées : risque d'effet de bord) | NON UTILISÉ | | Rapprochement via tables `OrderMatch`/`StxPurchaseUnit` |
| VPS Hetzner (`resell-vps`) | SSH non sollicité (non nécessaire, DB accessible directement) | NON UTILISÉ | | |
| Banque / comptabilité / TVA / contrats paiement / salaires | — | **INACCESSIBLE** | | Tables `BankTransaction`, `BankBalanceSnapshot`, `CashLedgerDaily`, `ExpectedCashEvent`, `MarketplaceRemittance`, `ShopifyPayout` existent mais sont **vides** (0 ligne) |
| Search Console, GA4, Trustpilot, Google Business | — | NON TESTÉ / probablement INACCESSIBLE | | Avis publics : recherche web par sous-agent 2 |
| Web (recherche externe) | outils WebSearch / WebFetch | OK | | |

## 2. Couverture des tables internes (extraction 2026-11-02 19:45 UTC, `donnees_brutes/00_profil_tables.csv`)

| Table | Lignes | Début | Fin | Remarque |
|---|---|---|---|---|
| ShopifyOrder | 2 896 | 2026-01-01 | 2026-11-01 | Synchro 14 jours glissants ; **historique 2022-2025 absent** |
| OrderMatch (ligne de commande ↔ achat fournisseur) | 4 053 | 2025-09-11 | 2026-10-31 | Coût d'achat (`supplierCost`) = montant StockX réglé ; marge = prix ligne − coût |
| DailyAdSpend | 335 | 2025-07-06 | 2026-10-31 | Canal `google` seul ; aucune ligne Meta |
| ads_campaign_daily / ads_product_daily | 2 082 / 4,47 M | 2025-07-06 | 2026-10-31 | Export Google Ads |
| funnel_events | 93 593 | 2026-10-15 | 2026-11-02 | Pixel maison démarré mi-oct 2026 : **pas d'historique de funnel avant** |
| ManualFinanceEvent | 4 230 | 2026-02-26 | 2026-11-02 | Uniquement 4 types de lignes importées automatiquement : forfaits Galaxus DELR et forfaits Shopify (6,50 + 8,00 CHF/commande) → **estimations, pas des factures** |
| PersonalExpense / RecurringExpense | 4 263 / 12 | 2026-01 | 2026-11 | Mélange perso/pro ; peu de charges réelles (Klaviyo, Cursor, KicksDB, ChatGPT…) ; aucun salaire, loyer, assurance entreprise |
| OperatingEvent | 1 922 | 2025-12-31 | 2026-04-06 | S'arrête en avril 2026 |
| MonthlyVariableCosts | 2 | 2026-01 | 2026-02 | Quasi inutilisée |
| GalaxusOrder | 2 389 | 2026-03-13 | 2026-11-02 | |
| DecathlonOrder | 421 | 2026-04-03 | 2026-09-07 | Arrêt apparent en sept. 2026 |
| StxPurchaseUnit (achats StockX pour Galaxus) | 2 197 | 2026-03-12 | 2026-11-02 | |
| marketplace_returns | 127 | 2026-07-12 | 2026-11-02 | Retours Galaxus/Decathlon uniquement |
| LocalStockLot | 36 | 2026-07-31 | 2026-10-26 | Stock propre tracé récemment |
| ShopifyFulfillmentRecord | 2 098 | 2026-01-21 | 2026-11-02 | Horodatage scan/étiquette/fulfillment |

Note fuseau : les colonnes `timestamp` sans fuseau sont stockées en **UTC** (vérifié : #7000 = 2026-09-03 09:10:21Z = API) ; convertir en Europe/Zurich pour les agrégats par jour/mois (`at time zone 'UTC' at time zone 'Europe/Zurich'`). Le client `pg` de Node lit ces valeurs comme heure locale : caster en `::text` dans les extractions.

## 3. Définitions et pièges de mesure (vérifiés dans le code, `shopify/orders/sync.ts`, `app/api/metrics/monthly/route.ts`, `app/utils/matching.ts`)

1. **`ShopifyOrder.totalSalesChf` = `currentTotalPriceSet`** = total *après* remboursements, TVA incluse (shop `taxesIncluded=true`), livraison incluse.
2. **`ShopifyOrder.netSalesChf` = `totalSalesChf − refundedAmountChf`** → **double déduction** des remboursements : champ faux pour les commandes remboursées (ex. statut REFUNDED : 91 commandes, total 693 CHF, remboursé 27 389 CHF, « net » −26 695 CHF). Ne pas utiliser `netSalesChf`. Ventes brutes avant remboursements = `totalSalesChf + refundedAmountChf`.
3. **`OrderMatch.marginAmount` = prix de ligne − coût fournisseur** : sans TVA sortante, sans frais de paiement, sans transport/préparation, sans retours, sans publicité. C'est la « marge affichée », pas une contribution.
4. Coût 0 par règle (`resolveOrderMatchCost`) pour : protection colis, stock physique « PHYSICAL_STOCK », stock local sans coût, achats « déjà expensés » → marge de 100 % artificielle.
5. Tableau de bord mensuel (`/api/metrics/monthly`) : marge brute − pub − expédition mensuelle − préparation mensuelle (tables quasi vides) ; **exclut** TVA, frais de paiement, charges fixes, rémunération.
6. Forfaits coût Shopify codés en dur : 6,50 CHF (transport) + 8,00 CHF (préparation) par commande avec ≥ 1 chaussure (`shopify/fulfillmentExpenses.ts`) → estimation à confronter aux factures Poste / coûts réels.
7. Galaxus DELR : forfaits d'emballage/transport importés par colis (`sync-galaxus-delr-fulfillment-expenses.ts`).

## 4. Hygiène / sécurité constatée (sans reproduire les valeurs)
- `.env` contient une ligne `shpat_…` **sans nom de variable** (jeton Shopify en clair) : à supprimer/rotationner après audit. Aucun secret recopié dans les livrables.
- `.data/` contient sessions StockX/GOAT/profils navigateur (non versionné ; à confirmer côté `.gitignore`).
- L'app Shopify possède des scopes `write_*` étendus (y compris `write_orders`, `write_products`, `write_customers`) : surface d'attaque large pour un outil de lecture ; l'audit n'a utilisé aucune écriture.

## 5. Scripts réutilisés / créés
- Réutilisés (lecture de code seulement, aucun lancement en prod) : `adsanalytics/`, `shopify/fulfillmentExpenses.ts`, `app/api/metrics/*`, `docs/tracking/*`.
- Créés : `calculs/db_readonly.mjs`, `calculs/shopify_readonly.mjs`, `calculs/sql/*.sql`, `calculs/gql/*.graphql` (à compléter ci-dessous).

## 6. Données manquantes (regroupées — voir aussi `analyses/donnees_manquantes.md` en fin d'audit)
Provisoire : (a) relevés bancaires + soldes 2026 ; (b) comptabilité/TVA (statut assujetti, taux, décomptes) ; (c) contrat et frais effectifs de paiement (Shopify Payments, TWINT, PayPal, PowerPay/Cembra) – partiellement récupérables via API payouts ; (d) factures Poste Suisse / emballages / loyers / salaires / assurances ; (e) historique Merchant Center / Search Console / GA4 ; (f) boîte mail SAV ; (g) structure juridique actuelle (Sàrl ?).

## 7. Sources externes consultées (2026-11-02)
- CGV Resell Lausanne : https://www.resell-lausanne.ch/pages/conditions-generales-vente — « exploité sous l'enseigne Resell Lausanne par **Solutions Manzinali, raison individuelle**, Chemin de Bas-de-Plan 6, 1030 Bussigny, IDE CHE-309.864.712, inscrite à la TVA sous le numéro CHE-309.864.712 » → **pas de Sàrl** ; assujetti TVA.
- `.env` (comparaison locale, valeurs non reproduites) : l'entité fournisseur Galaxus = « Solutions Manzinali », même numéro de TVA → **Galaxus et Shopify sont la même entité juridique**.
- Cautionnement romand : https://www.cautionnementromand.ch/fr/le-cautionnement.html (consulté 2026-11-02) — caution max CHF 1 000 000, amortissement ≤ 10 ans ; frais : inscription 300 CHF, expertise 1 % (min 500 / max 2 700), prime risque 1,25 %/an, gestion 250 CHF/an ; bénéficiaires FR/GE/NE/VS/VD ; stocks et trésorerie éligibles ; comptabilité régulière exigée ; formulaire version juillet 2026.
- Registre du commerce (inscription obligatoire des raisons individuelles ≥ CHF 100 000 de CA) : https://www.kmu.admin.ch/fr/registre-du-commerce-son-fonctionnement
