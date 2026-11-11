# ads_07 : âge réel du produit, quasi-expérience stratifiée, méthode de voisinage (F, lecture seule)

## A. Pool zéro historique (en stock, ELIGIBLE, 0 impression du 01.07 au 06.08, 0 conversion en 2026 avant le 07.08)

Produits : 30552. Créés avant le 08.07 : 2272. Créés du 08.07 au 06.08 : 10426. Créés depuis le 07.08 : 17854. Date inconnue : 0.

## B. Comparaison touchés / non touchés : voir ads_08 (étude par lot corrigée du biais de sélection)

## C. Méthode de voisinage : backtest

Entraînement : 01.01-06.08 (tous les produits du catalogue courant). Test : 2026-08-07 → 2026-11-10, campagnes main, produits non touchés par Explorer qui existaient déjà le 07.08 (n=7293). Prior global valeur/clic 2.33 CHF.

| score | Q1 (bas) | Q2 | Q3 | Q4 | Q5 (haut) | Q5 / Q1 |
|---|---|---|---|---|---|---|
| valeur par clic des voisins (K=200 clics) | 22.1 | 3.2 | 2.7 | 4.3 | 18.9 | 0.85 |
| conversions par produit des voisins (K=50) | 37.2 | 1.4 | 5.5 | 3.1 | 4.0 | 0.11 |
| clics par produit des voisins (K=50) | 21.4 | 1.0 | 7.3 | 2.2 | 19.2 | 0.90 |
| valeur par produit des voisins (K=50) | 37.2 | 1.7 | 5.2 | 3.8 | 3.3 | 0.09 |

(valeurs : conversions en main pour 1 000 produits sur la période de test)

### Détail, score = conversions par produit des voisins

| quintile | produits | score moyen | % avec impressions | clics | coût | conv. | valeur | conv./1 000 produits |
|---|---|---|---|---|---|---|---|---|
| Q1 | 1458 | 5.6 ‰ | 81 % | 3323 | 1332 | 54.2 | 4795 | 37.2 |
| Q2 | 1459 | 10.5 ‰ | 79 % | 795 | 315 | 2.0 | 394 | 1.4 |
| Q3 | 1458 | 12.8 ‰ | 76 % | 670 | 294 | 8.1 | 1582 | 5.5 |
| Q4 | 1459 | 17.9 ‰ | 77 % | 569 | 267 | 4.5 | 1373 | 3.1 |
| Q5 | 1459 | 40.6 ‰ | 82 % | 1610 | 656 | 5.8 | 1612 | 4.0 |

Score médian (conv. par produit des voisins, en ‰) : non touchés 12.97, touchés 11.79 (n=5405).

## D. Classement actuel (entraînement 01.01-10.11, score = conversions par produit des voisins)

Produits en stock, ELIGIBLE, sans conversion Ads en 2026 : 49861. Avec label routé (long_tail / explorer / ads_excluded) : 6643.
Parmi les 5 000 mieux notés : 492 avec label routé (hors main), 870 sans aucune impression sur 30 jours.
