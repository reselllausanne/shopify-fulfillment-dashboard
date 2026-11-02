# ADS-01 — Structure réelle des campagnes, budgets, enchères, dépenses et concentration

Sous-agent n°1 (BRIEF_MAITRE §7). Date de collecte : 2026-11-02. Devise : CHF. Fuseau compte Google Ads : Europe/Zurich. Lecture seule sur toute la production (aucune mutation).
Toutes les valeurs « conversion » Google sont des **valeurs revendiquées par Google** (TTC, avant remboursements) — jamais une preuve de rentabilité.

## 0. Accès testés

| Source | Résultat | Détail |
|---|---|---|
| Google Ads API v25 (GAQL), compte 6261619509 (CHF, non-manager) | **OK** | campagnes, réglages, quotidien depuis 2025-01, actions de conversion, termes, IS, change_event (30 j max côté Google) |
| Merchant API v1 (compte 669442699) | **OK** | comptes, sources, expédition, retours, statuts agrégés, product_view, reports |
| DB (lecture seule) tables `ads_*`, `DailyAdSpend`, `funnel_events`, `ChannelListingState`, `InventorySyncRun` | **OK** | `ads_product_daily` 2025-07-06→2026-11-01 ; `ads_campaign_settings_daily` seulement 2026-08-05→08-29 |
| Shopify Admin (lecture seule) | **OK** | commandes via base du pilote (`orders_api.ndjson`, 6 650 commandes), variantes live |
| Simprosys (admin, ajustements de conversion), GA4, Search Console, factures Google, banque | **INACCESSIBLE** | non testables avec les identifiants du repo |
| Interface Google Ads (recommandations, enchères en « learning », historique modifs > 30 j) | **INACCESSIBLE** | l'API `change_event` ne remonte que 30 jours |

## 1. Structure réelle (état au 2026-11-02)

**Fait observé** (source : `ads_campagnes_reglages.csv`, API live ; géographie `ads_06_geo` = Suisse seule, 100 % du coût).

| Campagne | Type / enchère | Budget/j (CHF) | tROAS | Remarque |
|---|---|---|---|---|
| Nike PM Feed Only | PMax, max valeur de conv. | 255 | 3,9 | plus grosse (24,5 % du coût Jul-25→Oct-26) |
| Adidas PM Feed only | PMax | 102 | 3,9 | 18,1 % |
| Perf-max-vetements | PMax | 50 (était 102 jusqu'au 23-oct) | 3,9 | Essentials/Fear of God ; statut « LIMITED / BUDGET_CONSTRAINED » |
| all | PMax (tout le catalogue) | 70 | 4,09 | 10,9 % |
| Jordan PM Feed Only | PMax | 42,5 | 5,0 | 6,6 % |
| UGG PM Feed Only | PMax | 85 | 5,0 | ROAS Google ≈ 1,0 |
| Long Tail \| All \| CH | Shopping, CPC manuel | 27 (budget partagé) | — | depuis 2026-10-07 |
| Explorer \| Long Tail / Nike / Jordan / Adidas \| CH | Shopping, CPC manuel | 42,5 partagé | — | système routage Explorer (mesure) |

- Budgets journaliers cumulés des 6 PMax actives : **604,5 CHF/j** ; dépense observée octobre 2026 : **494 CHF/j** (15 306 CHF / 31). Les budgets ne sont pas le facteur limitant (voir IS).
- Campagnes mises en pause/supprimées : « Sales-Performance good » (PMax catalogue complet, 12 081 CHF, **ROAS Google 6,67**, pausée 2026-07-21), Lego, Asics/Saucony/Run/Basket « PM Feed Only » (33 jours chacune février-mars, 370–860 CHF chacune), « Sales-Performance Max-21/22 », « TEST PM ALL », « Watches Shopping », « Collectible Excl Lego Shopping », Smart « Vente de sneakers ».
- Total dépensé dans les campagnes (Jul-25→Oct-26, `ads_campagnes_resume.csv`) : 102 579 CHF ; valeur Google 454 941 CHF ; 2 002 conversions.

**Fait observé — historique de pilotage (change_event, 2026-10-05→10-29, 47 événements)** : 15 modifications de tROAS sur 5 PMax en 23 jours (jours : 5, 13, 15, 23, 27 octobre). Exemples : Nike 3,3 → 3,79 (5-oct) → 4,1 (13-oct) → 4,4 puis 3,9 (27-oct, à 3 minutes d'écart) ; Adidas 3,3 → 3,79 → 4,1 → 4,2 → 4,5 → 3,9 ; Jordan 3,3 → 6 → 5 ; UGG créé 3,9 → 5. Budget Vetements 102 → 50 le 23-oct. 4 budgets modifiés. Origine des 47 événements : 28 via API/outil interne, 19 via interface web ou application mobile (tous du même utilisateur) ; les 15 changements de tROAS viennent de l'interface web/mobile (manuel), les lots Explorer de l'API.

**Interprétation** : le pilotage tROAS est quasi hebdomadaire et réversible en minutes ; pour la stratégie « maximiser la valeur avec tROAS », chaque changement relance une période d'ajustement (comportement documenté de Google ; durée exacte non observable ici). Le coût d'octobre (+15 % vs septembre) a augmenté pendant que le CAC global montait de 39,3 → 44,0 CHF (cf. §3). Confiance : moyenne (modifications observées, effet causal non démontrable).

## 2. Dépenses mensuelles et rendement revendiqué

**Fait observé** (API Google Ads par jour ; `DailyAdSpend` = identique sur les 13 mois comparés, écart 0 ; DB ne démarre qu'au 2025-07-06, l'API fournit 2025-01→06 absent de la DB). CHF, mois calendaires, coût hors TVA Google (traitement TVA/facture **inconnu**).

| Mois | Coût | Conv. Google (clic) | Valeur Google | ROAS Google | Commandes Shopify | Coût/commande Shopify |
|---|---:|---:|---:|---:|---:|---:|
| 2025-01…09 (moy. mensuelle) | 1 683 | 105 | 20 900 | 12,4 | 149 | 11,3 |
| 2025-11 | 6 289 | 165 | 40 471 | 6,4 | 246 | 25,6 |
| 2025-12 | 13 583 | 369 | 87 676 | 6,5 | 492 | 27,6 |
| 2026-01 | 9 708 | 254 | 66 341 | 6,8 | 334 | 29,1 |
| 2026-02 | 8 964 | 120 | 29 761 | 3,3 | 205 | 43,7 |
| 2026-03 | 8 267 | 155 | 32 759 | 4,0 | 265 | 31,2 |
| 2026-04 | 7 196 | 173 | 40 541 | 5,6 | 265 | 27,2 |
| 2026-05 | 8 582 | 186 | 46 572 | 5,4 | 243 | 35,3 |
| 2026-06 | 7 524 | 150 | 36 700 | 4,9 | 197 | 38,2 |
| 2026-07 | 8 605 | 151 | 30 173 | 3,5 | 250 | 34,4 |
| 2026-08 | 13 408 | 322 | 66 836 | 5,0 | 437 | 30,7 |
| 2026-09 | 13 297 | 252 | 51 907 | 3,9 | 338 | 39,3 |
| 2026-10 | 15 306 | 204 | 48 098 | 3,1 | 348 | 44,0 |

Source : `ads_02_gads_vs_shopify_mensuel.csv`, `ads_spend_mensuel_api.csv`. Janvier→octobre 2026 : coût **100 855 CHF** pour 2 882 commandes (CAC global 35,0).

**Fait observé** — rendement moyen et marginal (`ads_04_marginal.py` → `ads_04_marginal_regimes.csv`) :

| Passage | Δ coût/mois | Δ commandes/mois (toutes) | Coût par commande supplémentaire | ROAS marginal revendiqué Google |
|---|---:|---:|---:|---:|
| 2025 (1,7 k/mois) → fév-juil 2026 (8,2 k) | +6 506 | +86 | **75 CHF** | 2,3 |
| fév-juil 2026 → août-oct 2026 (14,0 k) | +5 814 | +137 | **42 CHF** | 3,4 |
| 2025 → août-oct 2026 | +12 320 | +223 | **55 CHF** | 2,8 |

Régression mensuelle commandes ~ coût : pente 0,0208 cmd/CHF (10 mois 2026, r = 0,79) ⇒ 48 CHF par commande supplémentaire ; 22 mois : 52 CHF (r = 0,89).

**Interprétation** : le ROAS moyen revendiqué a été divisé par ~3 (12,4 → 3,1–4,0) quand le budget est passé de 1,7 k à 14 k/mois ; le ROAS marginal est plus bas que la moyenne (2,3–3,4). La conversion par clic Google est passée de ~2,0 % (jan-2025 : 146 conv / 7 439 clics) à 0,6–0,8 % en 2026. **Hypothèse** : en 2025 la dépense captait surtout de la demande déjà existante (marque/remarketing, PMax unique) ; le déploiement par marque + longue traîne achète de la demande plus froide.
**Limites de cette inférence** : comparaison de périodes non randomisée, confondue par la saisonnalité (Q4, rentrée), les prix, le catalogue (≈ 80 000+ variantes en stock), le référencement naturel, les soldes. Les « commandes supplémentaires » incluent tout canal. Confiance : **faible à moyenne** sur l'ordre de grandeur (42–75 CHF par commande supplémentaire), **élevée** sur la direction (rendement marginal < moyen).

## 3. Concentration de l'exposition et de la dépense (fenêtre ≈ 2026-08-02→2026-10-31, 90 j)

**Fait observé** (`ads_12_*`, `ads_13_top_offers.csv`) : 36 418 CHF, 650,6 conversions Google, 136 523 CHF de valeur.

- 46 736 modèles (page produit) ont eu ≥ 1 impression ; **17 757** ont reçu de la dépense ; **~494 (2,8 % des modèles dépensés)** ont ≥ 1 conversion (somme des modèles avec conversion par tranche).
- Pareto par modèle (CHF dépensés) :

| Tranche coût modèle | Modèles | Coût | % coût | Conv. | ROAS Google |
|---|---:|---:|---:|---:|---:|
| < 1 | 11 082 | 4 157 | 11,4 % | 53,9 | 2,7 |
| 1–5 | 5 226 | 11 385 | 31,3 % | 194,0 | 4,0 |
| 5–10 | 875 | 6 025 | 16,5 % | 89,5 | 3,4 |
| 10–20 | 379 | 5 038 | 13,8 % | 92,8 | 4,3 |
| 20–50 | 148 | 4 523 | 12,4 % | 77,2 | 3,8 |
| 50–100 | 33 | 2 269 | 6,2 % | 39,4 | 3,7 |
| ≥ 100 | 14 | 3 021 | 8,3 % | 102,9 | 3,9 |

**Interprétation** : la dépense est très étalée (47 modèles ≥ 50 CHF = 14,5 % ; 195 modèles ≥ 20 CHF = 26,9 %) et le ROAS est quasi plat entre tranches (3,4–4,3). Aucune zone de « sur-performance » exploitable au niveau du modèle ; à ces volumes (0,3–0,8 conversion par modèle) le ROAS par modèle est du bruit statistique. Confiance : élevée sur la dispersion, moyenne sur l'absence de gagnants stables.

**Fait observé — par marque** (`ads_12_by_a1.csv`) : Nike 38,7 % du coût, ROAS 4,13 ; Adidas 25,6 %, 3,67 ; Jordan 7,9 %, 4,05 ; New Balance 5,0 %, 3,97 ; On 4,5 %, 3,10 ; Fear of God 4,3 %, 3,36 ; Asics 4,3 %, 2,44 ; **UGG 2,5 %, 1,01** ; Saucony 1,6 %, 3,36 ; Lego 0,4 %, 2,04. Par catégorie : sneakers 92 %, vêtements 7,1 %, collectibles 0,4 %.
**Fait observé — marge par marque (base pilote, `fin_06_seg_marque.csv`, marge affichée avant TVA/frais)** : Nike 33 %, adidas 33 %, Jordan 29 %, ASICS 36 %, New Balance 32 %, Fear of God 77 %, LEGO 20 %. **Interprétation** : 70 % du budget est sur des marques à ~30–33 % de marge affichée (≈ 12–15 % de contribution réelle après TVA/frais/logistique, cf. ADS-04), alors que Fear of God (77 %) reçoit 4,3 % du coût avec ROAS 3,4 : le ROAS ne mesure pas la rentabilité entre marques. Confiance : moyenne (les coûts estimés pèsent 13 % du COGS total).

**Fait observé — « jamais testés / testés sans succès »**
- *Jamais ou à peine testés* : environ 29 000 modèles exposés avec 0 CHF de dépense (impressions gratuites ou sans clic) ; les modèles en label « Explorer » ne sont activés que par lots de 100–900 modèles pour 5–10 jours (36 lots, `ads_15_explorer.csv`). Catégories collectibles, handbags (4 299 lignes), watches : test de 22 jours (Watches/Collectible Shopping, 446 + 443 CHF, 0 conversion, févr.-mars), puis arrêt.
- *Testés sans succès apparent* : UGG (1 714 CHF depuis 2026-09-13, 7,8 conv, ROAS 0,99 ; tROAS relevé à 5,0 le 23-oct mais campagne maintenue à 85 CHF/j) ; Asics/Saucony/Run (≈ 9,6/7,9/5,0 conv en 33 jours, 620–860 CHF) arrêtées avant d'avoir un échantillon lisible ; Explorer Nike/Jordan/Adidas : 233 CHF de coût, **0 conversion** en 47 jours ; Long Tail \| All : 478 CHF, 2 conversions, ROAS 0,79 (24 jours).
**Interprétation** : aucun de ces tests n'a atteint la puissance statistique nécessaire (≈ 125–135 clics par conversion attendue à CVR 0,75 %, soit ~57 CHF de clics ; 375 clics ≈ 165 CHF pour avoir 95 % de chances de voir au moins une conversion sur un modèle moyen). **La règle « ≥ 30 clics sans conversion » laisse 79 % de chances de ne voir aucune vente même pour un modèle moyen** (0,992^30 = 0,79) : c'est du bruit, pas un verdict. Ne pas protéger ni supprimer « Explorer » par principe ; mais la mesure actuelle ne permet de conclure ni dans un sens ni dans l'autre. Confiance : élevée sur le calcul, moyenne sur le CVR de référence (0,8 % observé sur 90 j).

## 4. Chevauchements et cannibalisation

**Fait observé** (`ads_12_overlap_summary.csv`) : 97 % du coût (35 321 CHF, 42 232 modèles) tombe sur des modèles présents dans **une seule** campagne ; 2 830 modèles dans 2 campagnes (645 CHF, 1,8 %) ; 1 674 dans 3 campagnes (452 CHF, 1,2 %, 0 conversion). Les campagnes Explorer/Long Tail partagent 64–97 % de leurs modèles avec une autre campagne (petites sommes : 366 CHF Explorer Long Tail, 475 CHF Long Tail All).
**Interprétation** : le routage par marque (labels `custom_label1`) évite l'essentiel des chevauchements ; le gaspillage par doublons est faible (≈ 1 100 CHF/90 j, ~3 % du coût). Confiance : élevée. Limite : le routage dépend d'exclusions d'offres (`pmax:exclude-routed-labels` exécuté 35 fois) ; un échec de synchronisation fait réapparaître des doublons.

**Fait observé — marque et recherche** (`ads_06_terms_brand_summary.csv`, 2026-08-02→11-01) : requêtes contenant « resell » : 2 958 clics, 1 168 CHF (4,3 % du coût), 71,6 conversions (≈ 11 % des conversions), ROAS Google 17,3 ; « resell lausanne » seul : 554 CHF, 65,7 conversions. Hors marque : 25 737 CHF, ROAS 3,60. Requêtes « essentials / fear of god » : 7,9 % du coût, CVR 2,06 %, ROAS 2,9 ; asics hors marque : ROAS 1,71, CVR 0,25 %.
**Interprétation** : les conversions « marque » sont probablement en grande partie non incrémentales (visiteurs qui connaissent le site) ; leur valeur apparente gonfle le ROAS global (sans elles : ≈ 3,6). Elles coûtent 1 168 CHF pour ~72 commandes revendiquées (16 CHF/conv) : **bon marché mais non prouvé incrémental**. Confiance : moyenne.

**Appareils / réseaux (même période)** : mobile 81 % du coût (34 117 CHF, ROAS 4,06, CVR 0,80 %) ; desktop 19 % (7 965 CHF, ROAS 3,37, CVR 0,97 %) ; tablette négligeable. Réseaux : recherche avec données produit 84 % du coût ; recherche sans données produit 13,5 % (5 556 CHF, ROAS 3,73) ; Display/YouTube/Discover/Gmail ≈ 1,6 % du coût, quasi sans conversion (Content+produit : 360 CHF, 3 conv). 6,7 % du coût (2 836 CHF) vient d'utilisateurs « zone d'intérêt » (hors présence en Suisse) avec ROAS Google 9,8.

**Impression share (PMax actives, dernière période disponible)** : Nike 79 % IS, perte budgétaire 0 %, perte de rang 21 % ; Adidas 83 %/0 %/17 % ; Jordan 79 %/0 %/21 % ; all 85 %/0 %/15 % ; Vetements **16 % IS, 81 % perdu au rang, 2 % budget** ; UGG **10 % IS, 85 % perdu au rang**. **Interprétation** : relever les budgets n'achète pas d'exposition (perte budgétaire nulle) ; le goulot est le rang (enchère/qualité/prix du flux). Confiance : élevée.

## 5. Synthèse des constats clés

1. Dépense janv-oct 2026 : 100 855 CHF pour 2 882 commandes ; ROAS Google moyen 3,1–5,6 selon les mois, tombé de 12,4 (2025). Confiance élevée (données API).
2. Rendement marginal revendiqué : 2,3–3,4 (vs 3,9–4,0 en moyenne) ; coût d'une commande supplémentaire estimé 42–75 CHF. Confiance faible-moyenne.
3. Pilotage tROAS instable (15 modifications / 23 jours) ; budgets non limitants. Confiance élevée (faits), moyenne (effet).
4. Exposition très étalée, résultats par modèle non lisibles ; tests Explorer sous-dimensionnés. Confiance élevée.
5. 70 % du budget sur marques à ~30–33 % de marge affichée ; marges plus élevées (Fear of God) sous-investies sans preuve que ce soit un tort (ROAS ≠ marge). Confiance moyenne.

## Limites et données manquantes

- **Attribution** : aucune clé commande ↔ clic (gclid) côté Shopify ; l'attribution UTM « dernier clic » ne reflète pas ce que Google attribue (écart 1,3–1,7× par mois, cf. ADS-02).
- **Marge par produit rattachée aux clics** : non disponible ; la marge utilisée est celle du pilote (COGS estimé sur 13 % du total).
- **Historique des enchères avant 2026-10-05** : change_event limité à 30 jours ; `ads_campaign_settings_daily` ne couvre que 2026-08-05→08-29. Les tROAS de février à septembre sont inconnus.
- **Période d'apprentissage** des PMax : non lisible par API ; la conclusion « changements trop fréquents » repose sur la documentation Google, pas sur une mesure ici.
- **Incrémentalité** : jamais mesurée (pas de test géo/holdout) ; toutes les conclusions de §2 et §3 sont observationnelles.
- **Facturation Google / TVA sur les frais publicitaires** : non consultable (hypothèse pilote : TVA non récupérable). Coût en HT ou TTC inconnu.
- **Snapshot catalogue** : `ads_shopping_product_current` s'arrête au 2026-10-20 ; les comptes de modèles éligibles/exclus sont à cette date.
- Artefact technique : `db_readonly.mjs` décale de −1 jour les colonnes `date` PostgreSQL à l'écriture CSV (JS Date) ; contourné par `::text` ; à signaler au pilote pour ses propres exports de dates.

Scripts : `calculs/ads_gaql_readonly.ts`, `ads_01_campaign_settings.py`, `ads_01_spend_history.py`, `ads_02_google_vs_shopify.py`, `ads_04_marginal.py`, `ads_06_brand_terms.py`, `ads_12_concentration.py`, `ads_12_overlaps.py` ; requêtes `calculs/gaql/ads_*.gaql`, `calculs/sql/ads_*.sql`. Tables : `tableaux/ads_*.csv`.
