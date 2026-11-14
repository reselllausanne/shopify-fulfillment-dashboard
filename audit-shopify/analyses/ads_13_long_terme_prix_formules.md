# Long terme : commandes, CVR Ads et historique des formules de prix (14.11)

## Commandes Shopify (hors annulées), semaine
Base 2026 hors pic : 5–9/jour (fév–juil). Pic 3 août–11 oct : 13–17,6/jour. Depuis le 12 oct : 7,6–9,3/jour. 9–13 nov : 22 commandes en 5 jours (4,4/jour).
Fenêtres glissantes de 5 jours ≤ 24 commandes en 2026 : 13 fév (22), 16 et 18 juin (24), 20–23 juil (23–24), puis 12–13 nov (24, 22). Déjà vu, retour à la normale à chaque fois.

## Rupture du 12–13 oct (F)
Ads par jour : 1–11 oct, CVR ≈ 0,9 %, ≈ 16,4 commandes/jour. 12–25 oct : CVR ≈ 0,5 %, ≈ 8,4 commandes/jour. Clics, CPC stables jusqu'au 14.
Changements datés : formule prix 12 oct (#99), thème AB PDP et fonction Cart Transform v17 le 14 oct, alerte Shopify le 15 oct. La rupture précède le 14 oct.

## Formules Shopify (commits, pas prix publiés vérifiés)
- 19 sept : (C+14,5)/0,6795, médiane ≈ +41 % au-dessus du marché (message du commit 22 sept).
- 22 sept « volume » : (C+14,5)/0,7895. Sem. 28 sept et 5 oct : 14,3 et 17,6 commandes/jour.
- 12 oct : (C+14,5+18+15)/0,82.
- 9 nov : (C+14,5)/0,68.

| Coût C | 22 sept | 12 oct | 9 nov |
|---|---|---|---|
| 100 | 145 | 180 (+24 %) | 168 (+16 %) |
| 150 | 208 | 241 (+16 %) | 242 (+16 %) |
| 200 | 271 | 302 (+11 %) | 316 (+17 %) |
| 312 | 414 | 439 (+6 %) | 481 (+16 %) |
Variations vs formule 22 sept.
Limite : date de commit ≠ date d'application sur Shopify ; prix publiés par date non disponibles.

## Prix réellement affichés (13 nov, funnel_events × ChannelListingState × SupplierVariant.standardBuyPrice)
3 615 variantes vues du 10 au 13 nov. Prix affiché médian / formule : 22 sept 1,162 ; 12 oct 1,002 ; 9 nov 1,001. Variantes à ±2 % de la formule : 9 nov 2 066 ; 12 oct 1 368 ; 22 sept 150. Mêmes variantes 16–22 oct vs 10–13 nov : ratio médian 1,000 (641 variantes).
F : les prix en ligne sont au niveau 12 oct / 9 nov, pas au niveau 22 sept. Le revert du 9 nov (#393) rétablit la structure 15 % pub + 12 % CM2, soit le 19 sept (0,68), pas la structure « volume » du 22 sept (0,7895).

## Rentabilité par période (estimation, formule supposée appliquée à toutes les lignes)
Marge avant pub par commande : formule 22 sept = 0,16 × vente ; formule 12 oct = 0,13 × vente + 33 ; formule 9 nov = 0,27 × vente. Pub = dépense Google de la période.
| Période | Commandes | Ventes | Pub | CPA | Marge après pub | Par jour |
|---|---|---|---|---|---|---|
| 28 sept–11 oct (22 sept) | 223 | 45 799 | 8 713 | 39 | −1 385 | −99 |
| 12 oct–8 nov (12 oct) | 234 | 65 996 | 11 081 | 47 | +5 220 | +186 |
| 9–13 nov (9 nov) | 22 | 3 956 | 1 454 | 66 | −386 | −77 |
Hors retours, remboursements (246 / 882 / 0), frais fixes. Seuil de rentabilité d'une commande à formule 22 sept : vente = CPA / 0,16 (≈ 244 à CPA 39, 279 à CPA 44,7). LTV : taux de recommande non mesuré (base commandes = 2026 seulement).
