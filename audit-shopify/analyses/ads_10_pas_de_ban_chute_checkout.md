# Ads 13 nov : pas de suspension, chute des achats entre début de paiement et achat

Lecture seule (GAQL, Shopify, base `funnel_events`). Étiquettes : F fait, I interprétation, H hypothèse, R recommandation.
Scripts : `calculs/gaql/ads_11_*.gaql` (via `ads_gaql_readonly.ts`), `calculs/ads_10_commandes_jour.mjs`. Table : `tableaux/ads_10_commandes_jour.csv`.

## 1. Pas de ban

- F : compte `6261619509` : statut `ENABLED`. Pas de suspension visible côté API.
- F : 5 campagnes PMax actives, statut `ELIGIBLE` (Nike, vêtements, Jordan, all) ou `LIMITED` pour « BIDDING_STRATEGY_CONSTRAINED » (Adidas, contrainte du tROAS cible, pas une sanction). Aucune raison de type désapprobation ou politique.
- F : diffusion normale : 34–52k impressions/jour, 570–840 clics/jour, 206–376 CHF/jour du 30 oct au 12 nov. Un compte banni ne dépenserait rien.
- H non vérifié : désapprobations de produits dans Merchant Center. Le snapshot local `ads_shopping_product_current` date du 20 oct. À regarder dans l'interface (Merchant Center → Diagnostics).

## 2. Ce qui a cassé : les achats, pas le trafic

| Période | Clics/j | Ajouts au panier/j (Ads) | Débuts de paiement/j (Ads) | Achats/j (Ads) | Achats ÷ débuts de paiement |
|---|---|---|---|---|---|
| 30 oct – 7 nov | ≈ 800 | ≈ 50 | ≈ 18 | ≈ 4,7 | 27 % (42,6 / 159) |
| 8 – 12 nov | ≈ 730 | ≈ 47 | ≈ 17 | ≈ 1,3 | 7,6 % (6,6 / 87) |

- F : la valeur Ads par jour tombe de ≈ 1 000 CHF à ≈ 70–270 CHF ; ROAS 0,23 (11 nov) et 0,26 (12 nov).
- F : deux sources de suivi indépendantes donnent les mêmes achats : « Google Shopping App Purchase » (WEBPAGE) et « GA4 purchase » (1,0 / 1,0 / 0,9 les 10–12 nov). Les événements en amont (vue, ajout panier, début paiement) sont stables.
- F : côté Shopify, commandes par jour : 3 – 7 nov. : moyenne 9,6 (12, 10, 10, 10, 6) ; 8 – 13 nov. : moyenne 4,5 (7, 4, 5, 4, 3, 4). Commandes balisées `cpc` : ≈ 4,4/j → ≈ 2,2/j. Valeur moyenne par commande en baisse (106–180 CHF les 11–13 nov contre 190–300 avant).
- I : ce n'est pas un bug de suivi. Les gens ajoutent au panier, commencent le paiement, puis n'achètent plus. La rupture se situe entre le début du paiement et l'achat, ou dans la décision au moment où le prix final apparaît.
- F : pas d'explosion d'erreurs de paiement dans le pixel (1–6 alertes `PAYMENT_ERROR` par jour). Pas de panne de checkout visible.

## 3. Pistes (aucune prouvée)

1. F : `fulfillment_mode_selected` avec source `auto_express_only` passe de 2–5 par jour (5–8 nov) à 24 (9 nov), 90 (10 nov), 163 (11 nov), 242 (12 nov). Le modal de taille force l'express quand la variante n'a pas d'option standard (`product-size-selection-modal.js`, ligne ≈ 1013). Un nombre croissant de fiches ne propose que l'express. H : le prix affiché au checkout monte (prix express via la fonction « Cart Transform » `express-price-transform-js`), les clients abandonnent. À vérifier : quelles variantes ont perdu l'option standard depuis le 9 nov et pourquoi (synchro, métachamps express).
2. F : thème publié (MAIN) = `#189546496386` « live + AB PDP 14.10 », modifié le 13 nov à 16:32. Le thème `fullstack-2-3-1` (celui que `cx_01` voyait en MAIN le 2 nov) est `UNPUBLISHED`. Date de publication non fournie par l'API. H : le changement de thème principal entre le 2 et le 13 nov a pu changer panier, paiement ou fiche produit.
3. H : changement de prix (baisse) : la valeur par commande baisse. Si les prix du site ne correspondent plus à ceux du flux Merchant Center, Google peut limiter les annonces ou le client voit un autre prix.
4. F : un nouveau core update Google a commencé le 10 nov. Il touche l'organique, pas le panier.
5. F : les sessions mesurées par le pixel passent de ≈ 3 000/jour (fin oct) à ≈ 1 300–2 100/jour (6–13 nov), alors que les clics Ads restent à ≈ 730. H : le pixel ne voit plus une partie des visites (changement de thème ou de consentement) ou le trafic hors Ads a baissé.

## 4. À faire de ton côté (aucune modification par moi)

1. Shopify admin → Boutique en ligne → Thèmes : regarder qui a publié `live + AB PDP 14.10` et quand. Si c'est après le 7 nov, republier le thème précédent (`fullstack-2-3-1`) est le retour arrière le plus simple. Décision à ton choix.
2. Faire un achat test en mobile (mode express et standard) et lire le prix final au checkout, puis comparer au prix de la fiche.
3. Merchant Center → Diagnostics : produits désapprouvés, « prix non concordant ».
4. Google Ads → Politiques : rien à signaler attendu.
5. Ne pas toucher aux budgets ni au tROAS avant d'avoir le point 1 : la baisse de ROAS vient des achats, pas de l'enchère.

## 5. Limites

- Je ne vois pas la date de publication du thème, ni le prix exact vu au checkout.
- Les débuts de paiement et achats Ads sont des conversions modélisées/attribuées : petits nombres (≈ 1 à 9 par jour), écarts bruités.
- Pas de statut Merchant Center à jour.
