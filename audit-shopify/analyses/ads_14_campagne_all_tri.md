# Campagne PMax « all » : tri (14.11)

Source : GAQL `shopping_performance_view`, campagne `all`, 15 août–13 nov (90 j), `calculs/gaql/ads_14_all_90j.gaql`. Table : `tableaux/ads_14_all_produits_90j.csv` (produits avec conversion ou ≥ 20 CHF de coût).

## Total (F)
Coût 4 986 CHF, 74,9 conversions, valeur 17 789, ROAS 3,57, 8 911 produits. 83 produits seulement ont converti. 80 % du coût (3 973) est sur 8 828 produits sans conversion. 18 produits = 50 % de la valeur ; 40 = 80 %.

## Par marque (90 j)
| Marque | Coût | Conv | ROAS | CPA 15 août–28 sept | CPA 29 sept–13 nov |
|---|---|---|---|---|---|
| New Balance | 1 615 | 33,2 | 4,71 | 43 | 55 |
| ASICS | 1 087 | 7,8 | 1,77 | 121 | 171 |
| On | 649 | 9,0 | 2,95 | 47 | 115 |
| Saucony | 409 | 5,5 | 2,61 | 58 | ∞ (0 conv, 93 CHF) |
| Hoka | 334 | 2,0 | 1,86 | 82 | ∞ (0 conv, 171 CHF) |
| Salomon | 329 | 3,0 | 2,47 | 60 | ∞ (0 conv, 149 CHF) |
| Onitsuka | 296 | 9,0 | 7,15 | 40 | 24 |
Petites marques avec ROAS élevé : Maison Margiela 8,2 ; Under Armour 10,3 ; Yeezy 5,9 (volumes très faibles).

## Test hors échantillon
Produits convertis du 15 août au 28 sept : 55. Du 29 sept au 13 nov : 33. Dans les deux : 5. Les 55 « gagnants » de la 1re moitié ont un CPA de 48 sur la 2e (261 CHF, 5,5 conv) contre 92 pour le reste. Le tri par produit persiste modérément ; le tri par marque est plus stable.
Limite : conversions attribuées par Google, petits nombres, sélection a posteriori.

## Scénario de tri (14.11)
Garde : New Balance (tous), Onitsuka (tous), tout produit avec ≥ 1 conversion en 90 j : 3 756 produits, coût 2 438, 74,9 conv (in-sample). À déplacer : 5 155 produits (ASICS 2 173 / 1 008 CHF ; On 886 / 541 ; Hoka 719 / 315 ; Salomon 608 / 314 ; Saucony 440 / 255), coût 2 548 (51 %), 0 conversion en 90 j. Listes : `tableaux/ads_14_all_a_garder.csv`, `ads_14_all_a_deplacer.csv`.
Dans New Balance : 3 332 produits sur 3 363 sans conversion (1 250 CHF sur 1 615). Onitsuka : 341 sur 349 (175 CHF sur 296).
ASICS : CVR 0,33 % contre 0,97 % pour New Balance, même CPC (0,46). 547 paires vendues depuis jan. 2025 : 18–54 par mois (mars–août 2025), 13–27 par mois en 2026, prix moyen stable ≈ 215.
Onitsuka : 34 paires Shopify en 22 mois ; mars–mai 2026 à 174–189 : 2 paires/mois ; août 2026 à 230 : 8 paires.

## 2025 (Ads, semaine)
CVR 1,4–3,3 % de janv. à oct. 2025 (moyenne ≈ 2,1 %), ROAS 7–23. Début nov. 2025 : 1,03 % (3 nov.), 0,65 % (10 nov.), 0,84 % (17 nov.), puis 1,67 % (24 nov., Black Friday). Commandes/semaine 2025 : octobre 33–34, 3 nov. 25, 10 nov. 19, 17 nov. 42, puis 141/133/135/124 (24 nov.–15 déc.).
