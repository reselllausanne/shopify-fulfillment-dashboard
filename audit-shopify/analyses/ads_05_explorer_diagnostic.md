# ads_05 — Diagnostic Explorer et dilution de la pub Google (05.11.2026)

Périmètre : lecture seule (DB via requêtes SQL ; code `adsanalytics/explorer/*`). Aucune modification de campagne, de flux ou de code.
Sources : tables `ads_explorer_*`, `ads_product_daily`, `ads_campaign_settings_daily`, `tableaux/ads_spend_mensuel_api.csv`, `tableaux/ads_campagnes_mensuel.csv`.
Limite : l'historique des réglages de campagne (`ads_campaign_settings_daily`) ne couvre que 08.08 → 29.08.2026. L'interface Google Ads (historique des modifications) n'a pas été consultée.

## 1. Comment Explorer fonctionne (F, lu dans le code)

1. Sélection : modèles du catalogue avec **0 impression sur 30 j, 0 conversion Ads historique, 0 vente Shopify sur 365 j**, en stock, approuvés, > 30 j (`computeExplorerEligibilityDebug`).
2. Étiquette `custom_label_3` écrite via flux supplémentaire Merchant : `explorer_active*` (test), `long_tail_all`, `ads_excluded`, vide = campagne principale (`CORE_ALL`).
3. Les campagnes principales (Nike, Adidas, Jordan, all) excluent ces étiquettes dans leur arbre de listing : un modèle étiqueté sort de la campagne principale.
4. Test 10 jours, CPC max 0,20 (parfois 0,45 ou 0,70), budget 50 CHF/jour. Règles de sortie (`rules.ts`) : conversion ≥ 1 ou **≥ 3 clics** → retour en principal ; ≥ 50 impressions et 0 clic → `ads_excluded` ; < 50 impressions après 10 j → retour en principal (ou Long Tail pour l'historique).
5. Le code **ne modifie jamais** budget ni tROAS des campagnes principales (aucune mutation dans `adsanalytics/`, seulement lecture).

## 2. Résultats Explorer (F)

| Mesure | Valeur |
|---|---|
| Lignes modèle-batch traitées | ≈ 12 200 (11 184 modèles distincts) |
| Dépense Explorer cumulée (batchs) | ≈ 0,7 k CHF |
| Conversions Explorer | 3 |
| Modèles retournés en principal car « découverts » (≥ 3 clics) | 257 → 910 clics, 345 CHF, 1 conversion |
| Modèles parqués en Long Tail | 7 274 → 4 impressions au total |
| Modèles étiquetés « sélectionnés » jamais testés | 1 703 |
| Performance de ces modèles dans les 90 j **avant** d'être sortis de la campagne principale | 63 139 impressions, 482 clics, 180 CHF, 0 conversion |

Lecture (I) : Explorer n'a pas retiré de produits qui vendaient (180 CHF de dépense sans vente sur 90 j). Il n'a rien trouvé non plus : le réservoir testé n'a aucune demande (0 vente 365 j, 0 impression 30 j), donc 3 conversions sur ≈ 2 000 clics. Le test est faible aussi par construction : CPC max 0,20 contre CPC moyen du compte 0,45-0,50, soit ≈ 4-8 impressions par modèle sur 10 j. Il n'explique pas la chute du ROAS (0,7 k de dépense sur 15 k/mois).

## 3. Anomalies expliquées

| # | Constat | Preuve | Lecture |
|---|---|---|---|
| A1 | Seuil « découvert » = 3 clics | `rules.ts` ; 257 modèles / 345 CHF / 1 conversion | Un clic n'est pas une demande. Seuil à remplacer par conversion ou ajout panier. |
| A2 | Étiquettes de routage écrites en masse | 299 885 insertions flux supplémentaire dès 07.08 ; 247 103 `set:LONG_TAIL_ALL` | Charge inutile sur le flux ; aucun effet mesurable sur la vente. |
| A3 | Arbre de listing des campagnes principales modifié 12 fois entre 08.08 et 27.08 (Nike 8 fois) | `ads_campaign_settings_daily` (hash des filtres) | Modifier le listing d'une PMax peut relancer son apprentissage. Pas de dégât visible : ROAS Nike août 5,2 (meilleur mois 2026). |
| A4 | Budgets et tROAS des campagnes principales modifiés hors code | Nike 100 → 190 CHF/j (17-27.08), vêtements 59 → 100, Adidas 100 → 120, Jordan 80 → 50 (tROAS 5 → 6,5) | Faits en interface Google Ads, ou par recommandations automatiques. À vérifier dans « Historique des modifications ». |
| A5 | Produits avec impressions : 11 469 (mai) → 16 330 (juil.) → 28 896 (août) → 39 859 (oct.) | `ads_product_daily` | La pub se disperse sur 3,5 fois plus de produits, avant et après Explorer (hausse déjà en juillet). Explorer ne dépense que 865 CHF en octobre sur étiquettes de test. |
| A6 | Part de la dépense mensuelle sur des produits sans vente du mois : 70 % (mai) → 87 % (oct.) | `ads_product_daily` | Même valeur de conversion pour plus de dépense (voir §4). |
| A7 | ROAS Google quasi uniforme selon la taille de dépense du produit (2,9 à 4,1) sur sept.-oct. | `ads_product_daily` | Pas de segment catastrophique : tout le compte tourne à ≈ 3,3. |
| A8 | UGG : ROAS 0,5 (sept.) et 1,3 (oct.), 0,9 k dépensés | `ads_campagnes_mensuel.csv` | Campagne en perte, arrêtée fin octobre. |

## 4. Dépense marginale (F puis I)

| Mois 2026 | Dépense CHF | Valeur de conversion CHF | Commandes Shopify |
|---|---|---|---|
| Mai | 8 582 | 46 572 | 243 |
| Août | 13 408 | 66 836 | 437 |
| Octobre | 15 306 | 48 098 | 348 |

De mai à octobre : +6,7 k de pub, +1,5 k de valeur de conversion déclarée (ROAS marginal ≈ 0,2), +105 commandes Shopify, soit ≈ 64 CHF de pub par commande en plus contre une contribution avant pub de ≈ 40 CHF par commande. (I) Les commandes supplémentaires perdent ≈ 24 CHF chacune, soit ≈ 2,5 k/mois. Réserve : août est un pic (saison), octobre inclut des effets non isolés (livraison 13 j, retours).

## 5. Recommandations (R, décision dirigeant)

1. (Révisé, voir §7) Explorer ne nettoie pas ce qui coûte : il ne traite que des produits à 0 impression. Ne pas le geler par principe, mais ne pas attendre de gain de lui.
2. Remettre les budgets au niveau des semaines où le ROAS était bon (voir §7 : Nike ≈ 150, Adidas ≈ 100, vêtements ≈ 75 CHF/j).
3. Vérifier l'historique des modifications Google Ads (qui a monté budgets et tROAS le 08-27.08 ; recommandations appliquées automatiquement).
4. Fixer le tROAS en fonction du seuil réel (≈ 5,4 de rentabilité sur Shopify, plus haut car les valeurs envoyées sont gonflées) ; ne pas descendre sous 5 en valeur déclarée.
5. Si Explorer est conservé : seuil « découvert » = 1 conversion, pas 3 clics.

## 6. Requêtes (reproductibles, lecture seule)

```sql
-- Batchs Explorer
select b.id, b.status, b.model_count, b.max_cpc_micros/1e6 cpc, b.activated_at::date,
       sum(m.impressions) imps, sum(m.clicks) clk, sum(m.cost_micros)/1e6 cost, sum(m.conversions) conv
from ads_explorer_batches b left join ads_explorer_batch_models m on m.batch_id=b.id group by 1,2,3,4,5;

-- Performance des modèles avant sortie de la campagne principale
with m as (select distinct on (shopify_product_id) shopify_product_id, coalesce(started_at,created_at) st
           from ads_explorer_batch_models order by 1, 2)
select count(*), sum(p.imps), sum(p.clk), sum(p.cost), sum(p.conv)
from m left join lateral (select sum(impressions) imps, sum(clicks) clk, sum(cost_micros)/1e6 cost, sum(conversions) conv
  from ads_product_daily d where d.shopify_product_id=m.shopify_product_id
  and d.date < m.st::date and d.date >= m.st::date - 90) p on true;

-- Dispersion
select to_char(date,'YYYY-MM') m, count(distinct shopify_product_id) models, sum(cost_micros)/1e6 cost, sum(conversion_value) val
from ads_product_daily where date>='2026-05-01' group by 1 order by 1;
```

## 7. Compléments et corrections (05.11, suite)

CPC max des batchs (F, `ads_explorer_batches` + code) : 0,20 = défaut `explorerPlan` (marques hors Nike/Adidas/Jordan : Asics, New Balance, Hoka, On, Salomon…) ; 0,45 = lancement manuel du 05-06.09 (Nike, Adidas, Jordan) ; 0,70 = défaut `explorerBrandCycle` (Nike, Adidas, Jordan) depuis le 09.10. Correction : le plafond CPC n'explique pas à lui seul le manque d'impressions. Impressions par modèle sur 10 j : Asics 23, New Balance 17, Hoka 37, On 44 (CPC 0,20) ; Nike 7, Adidas 6, Jordan 5 (CPC 0,70). Les marques fortes sont dans des enchères plus disputées.

Règles de sortie pour les impressions seules (`rules.ts`) : ≥ 50 impressions et 0 clic = exclu 60 j ; < 50 impressions après 10 j = retour en principal.

Dépense par produit, août-octobre 2026 (F, `ads_product_daily`) :

| Segment | Produits | Dépense CHF | Valeur CHF |
|---|---|---|---|
| ≥ 1 conversion | 697 | 9 798 | 137 536 |
| ≥ 20 clics, 0 conversion | 412 | 6 091 | 4 |
| 5-19 clics, 0 conversion | 3 034 | 10 547 | 6 |
| 1-4 clics, 0 conversion | 13 367 | 9 861 | 4 |
| Impressions seules | 29 098 | 3 | 0 |

77 % des conversions (504 sur 655) et 79 % de la valeur viennent de produits qui n'avaient jamais converti avant août (595 produits). Un tri « produits déjà vendeurs » aurait gardé 21 % des ventes. À 1 % de conversion, 20 clics sans vente (0,2 vente attendue) ne prouvent rien sur un produit.

Explorer, résultat de valeur (F) : 2 modèles « convertis » 3,2 CHF pour 526 CHF ; 257 modèles « découverts » 345 CHF pour 299 CHF (ROAS 0,87).

Nike PM Feed Only par semaine (F, `ads_campaign_daily`) : semaine du 17.08 : 1 009 CHF, 30 conversions, ROAS 6,5, conversion 1,16 % ; semaine du 31.08 (budget 100 → 170-190 CHF/j entre le 19 et le 25.08) : 1 822 CHF, 28 conversions, ROAS 3,9, conversion 0,66 %. Adidas : semaine du 10.08 960 CHF, 19 conversions, ROAS 5,4 ; semaine du 31.08 861 CHF, 14 conversions, ROAS 3,5. Les 12 modifications de l'arbre de listing sont mêlées aux hausses de budget : aucune preuve que l'arbre seul cause la baisse. Retirée comme cause.

Produits avec impressions en octobre (39 859) : 8 676 en avaient déjà en mai. Premières impressions : juillet 4 954, août 10 649, septembre 9 437, octobre 5 105 produits (≈ 8,5 k CHF de la dépense d'octobre, ROAS ≈ 3,1).

UGG (Ahrefs, recherches « ugg » en Suisse par mois) : 2025 mai 1 365, oct. 12 821, nov. 20 119, déc. 17 104 ; 2026 mai 6 560, août 7 666, sept. 10 170, oct. 12 728. Saisonnier, pic nov.-déc.

## 8. Structure de campagnes, part de marché publicitaire, produits « méchants » (05.11, suite)

Types de campagne (F, `ads_campaign_daily`) : Nike, Adidas, Jordan, `all`, vêtements, UGG = Performance Max (tROAS). `Explorer | *` et `Long Tail | All | CH` = Shopping standard (CPC manuel, pas de tROAS). Août-novembre : Long Tail 572 CHF (ROAS 0,8), Explorer 704 CHF.

Part d'impressions, 02.08 → 01.11 (F, `ads_06_is.csv`, API Google Ads) : part d'impressions de recherche Nike 79 %, Adidas 83 %, Jordan 79 %, `all` 85 %. Part perdue pour budget : 0 %. Part perdue pour classement : 17-21 %. UGG : part 10 %, perdue pour classement 85 %. Vêtements : part 16 %, perdue pour classement 81 %. Conclusion (F) : le budget ne limite pas Nike/Adidas/Jordan ; monter le budget n'ajoute pas d'impressions disponibles.

Réseaux (F, `ads_06_network.csv`) : 98 % de la dépense PMax est en Search (SEARCH 97,9 %) ; Display, YouTube, Discover, Gmail, partenaires ≈ 2,1 %. Requêtes (F, `ads_06_terms_brand_summary.csv`) : 372 110 requêtes distinctes ; recherche de marque « resell » 4 % de la dépense (ROAS 17,3) ; hors marque 96 % (ROAS 3,6). Par thème hors marque : Nike 3,9 ; Adidas 3,3 ; Asics 1,7 ; UGG 1,2 ; Supreme/Essentials 2,9 ; sneakers génériques 4,8 ; « prix/achat » 5,6.

Produits sans vente par seuil de dépense, août-octobre (F, `ads_product_daily`) :

| Dépense du produit | Produits | Dont 0 vente | Dépense des 0 vente (CHF) |
|---|---|---|---|
| ≥ 60 | 35 | 8 | 642 |
| 40-60 | 36 | 16 | 767 |
| 25-40 | 75 | 38 | 1 157 |
| 10-25 | 429 | 295 | 4 128 |
| < 10 | 46 033 | 45 554 | 19 810 |

Lecture (I) : règle « dépense ≥ 25 CHF et 0 vente en 90 j » = 62 produits, 2,6 k CHF sur 3 mois (≈ 0,9 k/mois). L'essentiel de la dépense (22 k sur 36 k) est sur des produits sous 10 CHF chacun : diffus, non filtrable produit par produit.

Documentation Google (consultée 05.11) : pour une campagne établie, changer budget ou cible n'ouvre pas de phase d'apprentissage ; la performance converge en 1 à 2 cycles de conversion (support.google.com/google-ads/answer/13020501). Retire l'argument « le budget a relancé l'apprentissage ». 84 % de nos conversions arrivent sous 1 jour (`ads_02`) : deux semaines suffisent pour lire un changement.

UGG, ventes Shopify (lignes `lines_with_match.csv`) : oct. 2024 12, nov. 2024 54, déc. 2024 110, janv. 2025 41 ; oct. 2025 4, nov. 2025 44, déc. 2025 90, janv. 2026 52 ; sept. 2026 6, oct. 2026 9. Recherches « ugg » Suisse (Ahrefs) nov. 2025 vs nov. 2024 : −17 % ; déc. : −16 %. Nos ventes : −19 % et −18 %. Publicité UGG : janv. 2026 925 CHF, ROAS 6,8, conversion 3,2 % ; sept.-oct. 2026 conversion 0,1-0,25 %.

## 9. Historique des modifications Google Ads (13.10 → 11.11.2026) et correction du tROAS (11.11)

Source : API Google Ads, `change_event` (lecture seule, 30 jours maximum, `calculs/ads_gaql_readonly.ts`). Tous les événements portent le compte `reselllausanne@gmail.com` ; clients : web, application mobile, et API (10.11).

| Date | Campagne | Modification |
|---|---|---|
| 13.10 | Nike, Adidas | tROAS 3,79 → 4,1 |
| 15.10 | all | tROAS 3,79 → 4,09 ; budget 60 → 63 |
| 23.10 | vêtements | budget 102 → 50 |
| 23.10 | UGG, Adidas | UGG tROAS 3,9 → 5 ; Adidas 4,1 → 4,2 |
| 27.10 | Long Tail, all | budget Long Tail 17 → 27 ; all 63 → 70 |
| 27.10 | Nike, Adidas, Jordan | Nike 4,1 → 4,4 → 3,9 ; Adidas 4,2 → 4,5 → 3,9 ; Jordan 6 → 5 |
| 03.11 | vêtements, Explorer Long Tail | vêtements tROAS 3,9 → 5 ; Explorer Long Tail budget 42 → 20 |
| 08.11 | UGG | tROAS 5 → 4 |
| 10.11 11:42 (API) | Nike, Adidas, all, vêtements, Jordan, UGG | tROAS → 3,6 (Nike, Adidas, all, UGG) et 3,8 (vêtements, Jordan) |
| 10.11 20:54 (API) | all, Adidas, Jordan, UGG | budget all 70 → 140, Adidas 102 → 150, Jordan 42 → 90 ; UGG mise en pause |

État au 11.11 : tROAS 3,6 (Nike, Adidas, all) et 3,8 (vêtements, Jordan) ; budgets Nike 255, Adidas 150, all 140, Jordan 90, vêtements 50 CHF/jour.

Correction : la cible tROAS de 5 était celle des relevés du 08-29.08 seulement. En octobre, les cibles étaient de 3,8 à 4,5. Le ROAS livré (3,1-3,9) est cohérent avec la cible fixée. La date de baisse de la cible entre le 29.08 et le 13.10 n'est pas lisible (historique API limité à 30 jours ; visible dans l'historique des modifications de l'interface).

Relation empirique coût de pub par commande Shopify / ROAS Google mensuel : ROAS 5,0 ↔ 31 CHF ; 3,9 ↔ 39 ; 3,5 ↔ 34 ; 3,1-3,3 ↔ 44. La contribution avant pub est de 40,3 CHF par commande : le seuil de rentabilité en ROAS Google est ≈ 3,5-3,9.

Quotidien (F, `ads_campaign_daily`) du 20.10 au 10.11 : 7 494 CHF, 19 559 CHF de valeur, ROAS 2,6. 08-10.11 : 0,5 à 1,1, 1 à 2 conversions par jour.

## 10. Explorer contre main : quasi-expérience (F = SQL Supabase en lecture seule, I = interprétation)

Correction : aucune campagne New Balance n'existe. New Balance est dans la campagne `all` (1 787 CHF, 8 387 de valeur, 38 conversions depuis août). La suggestion de fusion NB était fausse.

Produits avec impressions par semaine (F, `ads_product_daily`) : 9 k puis 16 k la semaine du 27.07, avant le premier lot Explorer (07.08), à dépense comparable. 7 468 produits y reçoivent une impression pour la première fois. Explorer n'a donc pas causé la dispersion. Nouveaux paliers semaines du 21 et 28.09.

Population : produits en stock, ELIGIBLE, sans impression du 01.07 au 06.08 et sans conversion Ads en 2026 avant le 07.08. Période mesurée 07.08-10.11. Touché = présent dans `ads_explorer_batch_models`. Non touché = jamais sorti de main. Main = campagnes hors `explorer*` / `long tail*`.

Total (toutes marques) :

| groupe | produits | % avec impressions en main | coût CHF | conv. | valeur CHF | conv. / 1 000 produits |
|---|---|---|---|---|---|---|
| non touchés | 22 211 | 82 % | 7 173 | 146,0 | 24 933 | 6,6 |
| touchés (main + Explorer) | 8 341 | 42 % | 1 255 | 6,8 | ≈ 1 400 | 0,8 |

Par marque, mêmes critères (F) :

| marque | non touchés n | conv./1 000 | touchés n | conv./1 000 | impressions en main (non touchés / touchés) |
|---|---|---|---|---|---|
| Nike | 9 392 | 4,9 | 2 290 | 0,9 | 82 % / 48 % |
| Adidas | 5 983 | 3,7 | 1 645 | 0,8 | 82 % / 39 % |
| Jordan | 1 981 | 3,1 | 1 733 | 0,3 | 83 % / 34 % |
| New Balance | 1 632 | 1,8 | 913 | 0,0 | 74 % / 47 % |
| Asics | 1 078 | 1,4 | 550 | 1,8 | 78 % / 40 % |

Lecture (I) : à taux égal aux non touchés de la même marque, les 5 marques auraient donné ≈ 25 conversions ; observé ≈ 4,8. Écart ≈ 20 conversions en 3 mois, ≈ 3-4 k de valeur. Coût direct d'Explorer + Long Tail : 1 484 CHF pour 2 223 de valeur, ROAS 1,5, sous le seuil 3,5-3,9.

Mécanisme (F, code + tables) : les produits « sous-exposés » après 10 jours sont garés dans `long_tail_all` (≈ 7 300 modèles). Ce label les exclut de l'arbre main. Long Tail Shopping leur donne ≈ 4 impressions par produit. Ils quittent donc main, où 82 % des produits équivalents obtiennent des impressions.

Limites : (1) la sélection Explorer n'est pas aléatoire mais pseudo-aléatoire par marque ; (2) les non touchés incluent des produits avec ventes Shopify 365 j, qu'Explorer exclut, ce qui biaise contre Explorer ; (3) les produits Explorer restent en main moins longtemps ; (4) échantillons Asics et NB petits ; (5) conversions rares (146 sur 22 k), l'ordre de grandeur est solide, pas la décimale.
