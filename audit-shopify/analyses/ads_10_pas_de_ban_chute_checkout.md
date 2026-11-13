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

---

## Addendum 13.11 soir : corrections et nouveaux faits

### Corrections de ce qui précède
- Retiré : « le prix express monte au checkout ». Dans les événements échantillonnés, prix express = prix standard. `auto_express_only` apparaît quand `expressPriceCents <= price` (`product-size-selection-modal.js`, `shippingLayout`). Le client ne voit pas de hausse. Lien avec la chute de conversion : non prouvé. (F : code. H : suite au verrouillage de formule v2026-11-09 et à des coûts express = standard.)
- Corrigé : « diffusion normale » faux. Impressions Ads/jour : ~94k (sem. 28 sept) → ~25k (sem. 9 nov). Cause probable : tROAS 4.0 étrangle la dépense quand la conversion chute (budgets 685/j non atteints, dépense ≈ 260/j). Conséquence, pas cause. (F pour les chiffres, I pour le mécanisme.)

### Merchant Center (API, lecture seule, `calculs/ads_12_merchant_statuts.ts`)
- F : compte 669442699 sans problème de compte. 23 045 produits refusés sur 2,58 M (0,9 %), surtout images. 174 `price_mismatch`, 44 `landing_page_error`. Pas la cause.

### Prix : le prix n'a pas bougé de façon notable (F)
- 828 variantes vues avant (1–8 nov) et après (10–13 nov) : ratio médian 1,000 ; 232 baissent de plus de 3 %, 237 montent de plus de 3 %, 359 stables.
- Médiane des prix vus : 293 (1.11) → 255 (13.11) ; effet de mix probable (I).
- Exemple Jordan 4 Retro Fear (2024) EU 40.5 : coût DB `standardBuyPrice` 312,12 (synchro 13.11 02:36) ; `expressBuyPrice` 316,54. Formule : `ceil((312,12 + 14,5) / 0,68) = 481`. Correspond exactement au panier. (F)
- Décomposition des 481 CHF : coût 312,1 + fixe 14,5 + pub 15 % (72,2) + CM2 12 % (57,7) + TVA/frais 2,1 % (10,1) + paiement 2,9 % (13,9).
- Les 304 vus par l'utilisateur ne sont pas dans la DB. Coût DB = 312,12. Écart 8 CHF non expliqué (H : prix StockX affiché vs coût tout compris, ou moment différent).
- La formule est proportionnelle : pub 15 % et CM2 12 % de la vente à tout niveau de prix. Réserve pub à 481 = 72 CHF ; à 169 CHF de vente = 25 CHF. Coût pub réel par commande : non recalculé ici.

| Coût | Prix formule | Réserve pub 15 % | CM2 12 % |
|---|---|---|---|
| 100 | 169 | 25 | 20 |
| 200 | 316 | 47 | 38 |
| 312 | 481 | 72 | 58 |
| 600 | 903 | 135 | 108 |

### Nouvelle piste : le trou est au paiement (F)
Sessions du pixel, 8–13 nov vs avant :

| Période | Début checkout/j | Paiement soumis → achat |
|---|---|---|
| 25 oct–2 nov | 31,7 | 50/58 (86 %) |
| 3–7 nov | 15,8 | 33/30 |
| 8–13 nov | 32,7 | 21/46 (46 %) |

Achats par type de paiement :

| Période | Wallet/jour | Carte/jour | Offsite/jour |
|---|---|---|---|
| 25 oct–7 nov | 3,1 | ~0,6 | 2,1 |
| 8–13 nov | 1,0 | 0,5 | 1,8 |

- Offsite (Twint, PowerPay) stable. Wallets (Shopify Payments wallet, PayPal) −68 % : 6 observés contre ≈ 18,6 attendus (Poisson p ≈ 0,001).
- Thème : `templates/cart.json` identique en taille (3087) sur MAIN 189546496386 et sur 188549300610, bloc `additional_checkout_buttons` présent dans les deux. Le thème ne ressemble pas à la cause (F pour la présence, pas testé en rendu).
- À vérifier côté admin par l'utilisateur : Réglages → Paiements (Shopify Payments : Apple Pay, Google Pay, Shop Pay actifs ? alertes ?), Réglages → Domaines, test achat Apple Pay mobile. (R)
