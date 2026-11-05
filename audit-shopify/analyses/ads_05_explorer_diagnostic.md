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

1. Geler les nouveaux batchs Explorer (`ADS_EXPLORER_PAUSE_NEW_BATCHES=1`) : coût 0, gain 0.
2. Remettre les budgets au niveau de mai/juin (Nike ≈ 100, Adidas ≈ 100, vêtements ≈ 70, `all` ≈ 50 CHF/j) avant toute autre action. Gain estimé 2,5 à 5 k/mois (H).
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
