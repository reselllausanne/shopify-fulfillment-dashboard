# Base financière commune Shopify (S4) — 2026-01 → 2026-10

Devise CHF. Période : commandes créées (Europe/Zurich) du 2026-01-01 au 2026-10-31 (2 882 commandes hors test). TVA : 8,1 % comprise dans les prix (taxesIncluded). Nature : contribution d'exploitation, **pas** un résultat comptable.
Scripts : `calculs/fin_02..09`. Tables : `tableaux/fin_05_*`, `fin_06_*`, `hypotheses.csv`. Niveaux de preuve : **F** fait observé, **I** interprétation, **H** hypothèse, **R** recommandation.

## 1. Cascade « marge affichée » → résultat (F sauf mention)

| Étape | CHF 2026-01→10 |
|---|---|
| Marge affichée par le tableau de bord (lignes appariées, prix TTC − coût OrderMatch) | 219 150 |
| Revenu TTC brut des commandes | 685 086 |
| − remboursements / annulations | −57 789 (8,4 % du brut) |
| − TVA 8,1 % incluse dans les prix conservés | −46 291 |
| = revenu net HT conservé | 581 006 |
| − coût d'achat (dont 57 867 estimé pour lignes sans coût) | −434 738 |
| = marge brute réalisée | 146 272 (25,2 % du net HT) |
| − frais de paiement (observés SP 10 110 ; autres **H**) | −17 567 |
| − expédition + préparation (forfaits 6,5 + 8,0 **H**) | −40 481 |
| − litiges perdus (chargebacks, nets) | −5 305 |
| = **contribution avant publicité** | **82 913** (28,8 CHF/commande) |
| − Google Ads (`DailyAdSpend`) | −100 856 (35,0 CHF/commande) |
| = **contribution après acquisition** | **−17 943** (−6,2 CHF/commande) |
| − logiciels | −3 250 |
| = résultat avant rémunération | **−21 193** |
| − rémunération du dirigeant (**H** 6 000/mois) | −60 000 |
| = résultat économique | −81 193 |

**I** : l'écart entre 219 k (affichée) et 146 k (réalisée) vient surtout de TVA, remboursements et coûts estimés ; la « marge » du tableau de bord surestime d'environ un tiers la marge disponible, avant même frais, logistique et pub.
**I** : la publicité absorbe plus que la contribution. Le seul mois positif après pub est octobre (+1 960), mais 12 775 CHF de ses coûts sont estimés (cohorte récente non appariée) : à ne pas croire sans rapprochement.

Sensibilités (`fin_06_sensibilites.csv`, base −21 193) : TVA d'importation récupérable +32,6 k (**H à prouver**, voir données manquantes) ; frais autres passerelles +1 pt −3,1 k ; exp/prépa 10 CHF au lieu de 14,5 : +12,6 k ; 20 CHF : −15,4 k ; coût estimé ±20 % : ±11,6 k ; pub −20 % à ventes constantes : +20,2 k (illustratif).

**Trou de données découvert (F)** : 211 lignes 2026 de stock propre (`ESSENTIAL_STOCK`, `PHYSICAL_STOCK`), 24,5 k CHF TTC, dont 134 hoodies Fear of God Essentials, ont un coût OrderMatch **= 0**. Valorisées aux coûts du code (hoodie 42, autres 26 : déclarés par l'utilisateur, non prouvés), le résultat avant rémunération passe de −21,2 k à **−28,8 k** (−7,6 k). La marge « 77 % » du stock propre est donc en partie un artefact. Le modèle de trésorerie couvre ce risque dans le scénario Prudent (coût 76 %).

## 2. Définitions du tableau de bord à ne pas réutiliser (F, voir SOURCES.md §3)
1. `ShopifyOrder.netSalesChf` déduit deux fois les remboursements.
2. `OrderMatch.marginAmount` = prix TTC − coût : ni TVA, ni frais, ni logistique, ni pub ; non corrigée quand une commande est remboursée (ex. #6200 : remboursée 287,10 CHF le 25 août, marge restée +53,15).
3. Prix OrderMatch ≠ prix API pour 718/3 920 lignes : utiliser le prix API.
4. 320 lignes 2026 (86 k CHF TTC) sans coût apparié.
5. Aucune charge bancaire, TVA, salaire : le « bénéfice » du tableau de bord ne peut pas être un résultat.

## 3. Unité économique (commande moyenne 2026)
Brut 237,7 TTC → conservé 217,7 → net HT 201,6 → coût 150,8 → frais 6,1 → exp/prépa 14,0 → litiges 1,8 → **28,8** avant pub → pub 35,0 → **−6,2**.
Seuil de rentabilité (`fin_10_seuils.csv`) : avec 35 CHF de pub/commande aucun volume ne couvre les fixes ; à 18 CHF/commande il faut 587 cmd/mois pour 6 000 de rémunération + logiciels (309 pour 3 000) ; à 10 CHF : 337. Niveau actuel : 283 cmd/mois (moyenne fév-oct), 348 en octobre.

## 4. Rendement marginal de la pub (F + I)
Octobre 2025 : 2 770 CHF de pub, 180 commandes (15,4 CHF/cmd). Octobre 2026 : 14 440 CHF, 348 commandes (41,5/cmd). Pub ×5,2 pour commandes ×1,9 : les 168 commandes supplémentaires ont coûté ≈ 70 CHF chacune en pub, contre 28,8 de contribution. **I** (confondue par saisonnalité et marché) ; à confirmer avec la ventilation par campagne de `analyses/ads_*`.

## 5. Segments (F, contribution avant pub par commande)
- Nouveau client 28 CHF (88 % des commandes) ; récurrent 47 CHF (12 %, remboursements 6 %).
- Canal : Google organique/autre 28 ; direct/inconnu 26 ; autre 39.
- Tranche de prix (marge affichée TTC, avant tout) : <100 CHF 62,6 % ; 100-150 51,9 % ; 150-300 ≈ 32-34 % ; >400 26,7 % mais 181 CHF/ligne. Après 14 CHF d'expédition fixes, les petits tickets sont pénalisés.
- Sourcing : StockX à la commande 31,1 % (2 340 lignes) ; stock propre/prix fixe 77,4 % (692 lignes, 50 k CHF TTC) — les coûts unitaires de ce stock (tee 26, hoodie 42, Bape 35, AP 40, boxer 20) sont **déclarés par l'utilisateur au 2026-08-23** dans le code (`inStockFixedPrice.ts`), non prouvés par facture.
- Marque : Nike 32,8 %, adidas 32,8 %, Jordan 29,2 %, LEGO 20,4 %, Fear of God (stock propre) 77,3 %.
- Paiement (moyens des transactions de vente uniquement, corrigé après revue cx : `paymentGatewayNames` inclut les crédits de remboursement) : Shopify Payments 32,6 CHF/cmd (remb. 9,2 %), TWINT 28,8 (7,1 %), PowerPay 28,5 (10,1 %), PayPal 23,7 (5,6 %), Cembra 52,0 (2,7 %). Une première version de ce tableau montrait à tort des commandes « payées en crédit magasin » déficitaires : artefact, corrigé dans `fin_07_seg_paiement.csv`.

## 6. Exemples réels (S4.15, `tableaux/fin_09_exemples.json`)
1. **Normale #7112** (2026-09-10, CH, Shopify Payments). Prix 289,00 TTC → TVA 21,65 → net 267,35. Coût StockX 185,51. Frais SP 8,25. Exp/prépa 14,50 (forfait). Contribution avant pub **59,09** contre « marge affichée » 103,49. Chronologie : commande 10/09 → achat StockX 15/09 (+5 j) → livré au dépôt 16/09 → scan/étiquette/expédition 21/09 (+5 j) → **11 jours** commande→expédition.
2. **Annulée #7179** : client annule en 66 s, remboursement 189,00 ; frais SP 5,50 **non restitués** → perte nette 5,50, coût estimé 132,30 écarté.
3. **Remboursée après achat #6200** (PowerPay) : commande 20/06, achat StockX 22/06 (233,95), retour client, remboursement 287,10 le 25/08 (65 jours). OrderMatch n'enregistre pas le retour : marge affichée +53,15 alors que revenu net ≈ 26,56 et coût de retour partiellement non récupéré ; modèle : récupération stock 70 % (**H**).
4. **Remboursement partiel #6960** avec avoir (`shopify_payments+shopify_store_credit`) : remboursé 153,36 sur 184,64.
5. **Litige perdu** (chargeback « produit non reçu » 13.1, 219 CHF) : 26 des 35 litiges ont été perdus (9,6 k CHF) ; 8 « product not received » coïncident avec des délais d'expédition médians de 10-13 jours (**I**).
Exceptions non reconstituables : commandes échangées sans trace de retour physique, retours Galaxus, TVA d'importation.

## 7. Délais (F, `ops_01`) 
Commande→expédition : médiane 9-14 jours ; p90 14-22 jours ; part > 7 jours 71-96 % (sept. 95,5 %, oct. 92,8 %). Cause principale structurelle : le cron « cashflow lag buy » retarde l'achat de 5 jours par défaut (`scripts/shopify-cashflow-lag-buy-cron.sh`, `lib/stockxAutoCheckout/queue.ts`), puis 5 jours supplémentaires entre livraison dépôt et scan dans l'exemple. 180 commandes payées/partiellement remboursées, non annulées, non entièrement expédiées depuis ≥ 14 jours (valeur courante 47,6 k CHF TTC ; certaines de 2024-2025) dont 93 payées entièrement non expédiées (23,4 k CHF) ; [Audit SAV](7b78d56d-5d2f-4d9b-9cc3-330d2683dbd1) en compte 97 (22,6 k CHF brut), différence de seuil de date seulement, et constate que seulement 42 de ces 97 ont un achat StockX lié (mon rattachement « achat lié » compte aussi les lignes de stock propre). Soit expédiées hors Shopify/non marquées (hygiène), soit réellement non livrées (risque litige). Contrôle manuel : `tableaux/commandes_a_verifier.csv` (aucune action menée).
