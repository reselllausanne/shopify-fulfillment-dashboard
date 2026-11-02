# Base financière commune Shopify (S4) — 2026-01 → 2026-10

Devise CHF. Période : commandes créées (Europe/Zurich) du 2026-01-01 au 2026-10-31 (2 882 commandes hors test). Nature : contribution d'exploitation, **pas** un résultat comptable.
Scripts : `calculs/fin_02..11`. Tables : `tableaux/fin_05_*`, `fin_06_*`, `hypotheses.csv`. Niveaux de preuve : **F** fait observé, **D** déclaration du dirigeant non encore prouvée, **I** interprétation, **H** hypothèse, **R** recommandation.

> **Erratum du 2026-11-02 23:30 (versions antérieures de ce fichier et analyses des 3 sous-agents).** La première version supposait une TVA de 8,1 % extraite des prix (méthode effective sans déduction). Le dirigeant déclare payer la TVA au **taux forfaitaire (TDFN) de 2,1 % du chiffre d'affaires TTC** (**D**, à confirmer par décomptes AFC/relevés bancaires, inaccessibles). Effet : +33 k CHF de contribution sur 10 mois ; le résultat avant rémunération passe de −21,2 k à **+11,9 k**. Les analyses `ads_*`, `bm_*`, `cx_*` ont été rédigées avec l'ancienne base (28,8 CHF de contribution/commande, tROAS d'équilibre 7,6) : lire désormais **40,3 CHF/commande et ROAS d'équilibre global ≈ 5,4**.

## 1. Cascade « marge affichée » → résultat (F sauf mention)

| Étape | CHF 2026-01→10 |
|---|---|
| Marge affichée par le tableau de bord (lignes appariées, prix TTC − coût OrderMatch) | 219 150 |
| Revenu TTC brut des commandes | 685 086 |
| − remboursements / annulations | −57 789 (8,4 % du brut) |
| − TVA TDFN 2,1 % du TTC conservé (**D**) | −13 174 |
| = revenu net conservé | 614 124 |
| − coût d'achat (dont 57 867 estimé pour lignes sans coût) | −434 738 |
| = marge brute réalisée | 179 388 (29,2 % du net) |
| − frais de paiement (observés SP 10 110 ; autres **H**) | −17 567 |
| − expédition + préparation (forfaits 6,5 + 8,0 **H**) | −40 481 |
| − litiges perdus (chargebacks, nets) | −5 305 |
| = **contribution avant publicité** | **116 031** (40,3 CHF/commande) |
| − Google Ads (`DailyAdSpend`) | −100 856 (35,0 CHF/commande) |
| = **contribution après acquisition** | **+15 175** (+5,3 CHF/commande) |
| − logiciels | −3 250 |
| = résultat avant rémunération | **+11 925** |
| − rémunération du dirigeant (**H** 6 000/mois, non fournie) | −60 000 |
| = résultat économique | **−48 075** |

**I** : l'activité couvre ses coûts directs et la pub, mais pas une rémunération de 6 000 CHF/mois ; la marge « 219 k » du tableau de bord surestime d'environ 18 % la marge brute réalisée (179 k), avant frais, logistique, litiges et pub.
Résultat mensuel avant rémunération (`fin_05_pnl_mensuel.csv`) : jan +3,5 k ; fév −1,6 ; mar +1,8 ; avr +1,2 ; mai +0,5 ; juin −1,8 ; juil +0,6 ; août +1,7 ; sept −0,1 ; oct +6,2 (octobre contient 12 775 CHF de coûts estimés : à rapprocher).

Sensibilités (`fin_06_sensibilites.csv`, base +11 925) : exp/prépa 10 CHF au lieu de 14,5 : +24,5 k ; 20 CHF : −3,4 k ; frais autres passerelles +1 pt : +8,8 k ; coût estimé ±20 % : +23,5 k / +0,4 k ; pub −20 % à ventes constantes : +32,1 k (illustratif, non prouvé) ; méthode effective (TVA 8,1 % moins TVA import déductible) : +11,4 k ≈ TDFN (choix de méthode quasi neutre) ; ancienne hypothèse sans TDFN : −21,2 k.
**Trou de données (F)** : 211 lignes de stock propre (`ESSENTIAL_STOCK`, `PHYSICAL_STOCK`, 24,5 k CHF TTC, dont 134 hoodies Fear of God Essentials) ont un coût OrderMatch **= 0**. Valorisées aux coûts du code (42 / 26, déclarés par l'utilisateur 2026-08-23), le résultat tomberait de 11,9 k à **4,3 k** (−7,6 k). Une partie correspond aux **soldes = retours revendus à −30 % du buy now StockX** (**D**) : leur coût est l'achat initial, déjà passé dans la commande remboursée ; le modèle suppose 70 % de récupération de stock (**H**), donc la revente devrait porter ce coût récupéré. Un suivi unitaire fiable n'existe que via 36 `LocalStockLot` depuis le 2026-07-31.

## 2. Définitions du tableau de bord à ne pas réutiliser (F, voir SOURCES.md §3)
1. `ShopifyOrder.netSalesChf` déduit deux fois les remboursements.
2. `OrderMatch.marginAmount` = prix TTC − coût : ni TVA, ni frais, ni logistique, ni pub ; non corrigée quand la commande est remboursée (ex. #6200 : remboursée le 25 août, marge restée +53,15).
3. Prix OrderMatch ≠ prix API pour 718/3 920 lignes : utiliser le prix API.
4. 324 lignes 2026 (87 k CHF TTC) sans coût apparié (voir §7).
5. Aucune charge bancaire, TVA, salaire : le « bénéfice » du tableau de bord ne peut pas être un résultat.
6. `OrderMatch.supplierCost` = enchère StockX + ≈ 28 CHF (médiane 28,4 ; écart-type 15) : frais/expédition/douane inclus (F, 2 993 paires comparées avec l'API StockX) ; cohérent avec « achat après vente ».

## 3. Unité économique (commande moyenne 2026)
Brut 237,7 TTC → conservé 217,7 → net 213,1 → coût 150,8 → frais 6,1 → exp/prépa 14,0 → litiges 1,8 → **40,3** avant pub → pub 35,0 → **+5,3**.
Seuil de rentabilité (`fin_10_seuils.csv`) pour couvrir logiciels + rémunération : avec 35 CHF de pub/commande 1 202 cmd/mois (6 000) ou 632 (3 000) ; à 18 CHF/commande 284 (6 000) ou 149 (3 000) ; à 10 CHF 209 / 110. Niveau actuel : 283 cmd/mois (moyenne fév-oct), 348 en octobre. La rémunération n'est donc finançable que si la pub par commande baisse nettement ou si la contribution unitaire monte.

## 4. Rendement marginal de la pub (F + I)
Octobre 2025 : 2 770 CHF de pub, 180 commandes (15,4 CHF/cmd). Octobre 2026 : 14 440 CHF, 348 commandes (41,5/cmd). Pub ×5,2 pour commandes ×1,9 : les 168 commandes supplémentaires ont coûté ≈ 70 CHF de pub chacune contre 40,3 de contribution (**I**, confondue par saisonnalité/marché). ROAS global (revenu conservé / pub) 6,2 ; d'équilibre 217,7/40,3 ≈ **5,4**. Marginalement, la pub est en dessous de l'équilibre même si la moyenne est positive. Détail par campagne : `ads_01..04`.

## 5. Segments (F, contribution avant pub par commande, après correction TDFN)
- Nouveau client 40 CHF (88 % des commandes) ; récurrent 62 CHF (12 %, remboursements 6 %).
- Canal : google organique/autre 40 ; direct/inconnu 37 ; autre 52.
- Tranche de prix (marge affichée TTC, avant tout) : <100 CHF 62,6 % ; 100-150 51,9 % ; 150-300 ≈ 32-34 % ; >400 26,7 % mais 181 CHF/ligne.
- Sourcing : StockX à la commande 31,1 % (2 340 lignes) ; stock propre/prix fixe 77,4 % (692 lignes) — coûts unitaires (tee 26, hoodie 42, Bape 35, AP 40, boxer 20) **déclarés** dans le code, non prouvés.
- Marque : Nike 32,8 %, adidas 32,8 %, Jordan 29,2 %, LEGO 20,4 %.
- Paiement (moyens des transactions de vente) : Shopify Payments 32,6 CHF/cmd avant correction TDFN (remb. 9,2 %), TWINT 28,8 (7,1 %), PowerPay 28,5 (10,1 %), PayPal 23,7 (5,6 %), Cembra 52,0 (2,7 %) ; ajouter ≈ +11 CHF à chacun avec le TDFN. Un premier tableau montrait à tort des commandes « payées en crédit magasin » déficitaires : artefact corrigé.
- Prix : à 299 TTC avec achat rendu 188, contribution avant pub 81,8 ; baisse à 275 : 59,0 (`fin_08_*`).

## 6. Exemples réels (S4.15, `tableaux/fin_09_exemples.json`)
1. **Normale #7112** (2026-09-10, CH, Shopify Payments). 289,00 TTC → TVA TDFN 6,07 → net 282,93. Coût StockX 185,51. Frais SP 8,25. Exp/prépa 14,50 (forfait). Contribution avant pub **74,67** contre « marge affichée » 103,49. Chronologie : commande 10/09 → achat StockX 15/09 (+5 j, délai volontaire du cron) → livré au dépôt 16/09 → scan/étiquette/expédition 21/09 (+5 j) → **11 jours** commande→expédition.
2. **Annulée #7179** : client annule en 66 s, remboursement 189,00 ; frais SP 5,50 **non restitués** → perte nette 5,50.
3. **Remboursée après achat #6200** (PowerPay) : commande 20/06, achat StockX 22/06 (233,95), remboursement 287,10 le 25/08 (65 jours). OrderMatch n'enregistre pas le retour (marge affichée +53,15 alors que revenu net ≈ 26) ; stock récupéré 70 % (**H**).
4. **Remboursement partiel #6960** avec avoir (`shopify_payments+shopify_store_credit`) : remboursé 153,36 sur 184,64.
5. **Litige perdu** (chargeback « produit non reçu » 13.1, 219 CHF) : 26 des 35 litiges perdus (9,6 k CHF) ; 8 « product not received » coïncident avec des délais d'expédition médians de 10-13 jours (**I**).
Exceptions non reconstituables : échanges sans trace de retour physique, retours Galaxus, décomptes TVA.

## 7. Backfill des coûts manquants (S4.10, `fin_11_backfill_match.py`)
Historique d'achats StockX extrait en lecture seule via l'API (6 004 commandes d'achat, 2020-04 → 2026-11-02, `calculs/stockx_buying_history_readonly.ts`) : 2 464 achats en 2026, dont 254 non liés à un `OrderMatch` ; après retrait des achats déjà liés à Galaxus (`StxPurchaseUnit`, `GalaxusStockxMatch`) : 289 achats « libres » depuis 2025-12 (45,4 k CHF d'enchères). Appariement avec les 231 lignes 2026 sans coût non remboursées (59,9 k CHF TTC) par style+taille puis titre : **25 lignes** (6,2 k CHF TTC) retrouvées, toutes `BUYER_RECEIVED`, délai achat médian 9 jours après la vente (propositions dans `tableaux/fin_11_backfill_proposition.csv`). Restent 206 lignes (53,7 k CHF TTC) : 111 expédiées, 72 non expédiées, 17 partielles, 6 en attente. Pour les 111 expédiées, aucun achat StockX libre : origine probable = soldes/retours revendus, stock propre, autres fournisseurs ; **à confirmer par le dirigeant**. Le coût estimé pour ces lignes (70 % du prix) pèse 57,9 k CHF dans le résultat : c'est la plus grosse incertitude restante après la TVA.
Aucune écriture en base n'a été faite : le gain de qualité (25 lignes, 6 k CHF) ne justifie pas de modifier `OrderMatch`, qui alimente crons et tableaux de bord ; à faire sur validation (propositions prêtes).

## 8. Délais (F, `ops_01`)
Commande→expédition : médiane 9-14 jours ; p90 14-22 jours ; part > 7 jours 71-96 % (sept. 95,5 %, oct. 92,8 %). Cause structurelle : le cron « cashflow lag buy » retarde l'achat de 5 jours par défaut (`scripts/shopify-cashflow-lag-buy-cron.sh`, `lib/stockxAutoCheckout/queue.ts`), puis ≈ 5 jours entre livraison dépôt et scan (exemple #7112). Le dirigeant confirme que la paire est rarement achetée avant la vente (**D**). 180 commandes payées/partiellement remboursées, non annulées, non entièrement expédiées depuis ≥ 14 jours (47,6 k CHF TTC, certaines de 2024-2025) dont 93 payées entièrement non expédiées (23,4 k CHF) ; [Audit SAV](7b78d56d-5d2f-4d9b-9cc3-330d2683dbd1) en compte 97 (22,6 k CHF brut) et constate que 42 seulement ont un achat StockX lié. Contrôle manuel : `tableaux/commandes_a_verifier.csv` (aucune action menée).
