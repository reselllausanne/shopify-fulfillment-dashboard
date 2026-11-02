# ADS-03 — Flux Merchant Center : qualité, synchronisation prix/stock, risque d'offre non achetable

Sous-agent n°1 (BRIEF_MAITRE §7). Collecte 2026-11-02 (≈ 20:00 UTC). CHF. Lecture seule (aucune écriture Merchant/Shopify/DB). Merchant ID 669442699 (Resell-lausanne.ch, fuseau Europe/Zurich, site réclamé, Bussigny).

## 0. Accès testés

| Source | Résultat |
|---|---|
| Merchant API v1 : comptes, programmes, sources de données, expédition, retours, statuts agrégés, `products/v1` (un produit), `reports:search` (product_view, price_competitiveness_product_view, product_performance_view) | **OK** (v1beta supprimée : HTTP 409) |
| Merchant : diagnostic complet par offre (`itemLevelIssues` produit par produit), interface Diagnostics, historique d'approbation | **INACCESSIBLE** (statuts agrégés seulement) |
| Shopify Admin (variantes, prix, compare-at, coût unitaire, métachamps) | **OK** : 250 premières offres du top-clics ; parcours des variantes en stock tronqué à **80 000** (400 pages) |
| DB : `ChannelListingState`, `InventorySyncRun`, `ads_sync_runs`, `ads_shopping_product_current` | **OK** (snapshot ads_shopping_product_current au 2026-10-20) |
| Simprosys (réglages du flux, fréquence de synchronisation, règles) | **INACCESSIBLE** |

## 1. Architecture du flux

**Fait observé** (`mc_datasources.json`, `products/v1`)
- **3 sources principales « Simprosys Feed (Merchant API) »**, une par langue (fr, de, en), toutes en feed label **CH**, pays CH, saisie par API ; chaque offre existe donc en 3 langues. Destinations : Shopping ads et fiches gratuites actives ; Display ads désactivé en fr, **activé en de et en**.
- 2 sources supplémentaires : *Resell Lausanne Explorer Labels* (API ; labels de routage) et *SUPPLEMENTAL SOURCE 1* (fichier, fr).
- Granularité : **une offre par taille** (`offerId = shopify_CH_<produit>_<variante>`), `itemGroupId` = produit Shopify. Identifiants : GTIN, MPN (métachamps `mm-google-shopping`), `size` EU, genre/âge/condition `new`, catégorie Google « Apparel & Accessories > Shoes ». `custom_label0` = catégorie, `custom_label1` = marque. Prix de revient (`costOfGoodsSold`) exposé dans le flux. Lien : `…/products/<handle>?currency=CHF&country=CH&variant=<id>&utm_source=google&utm_medium=cpc&utm_campaign=Google Shopping&stkn=…` (même lien pour annonces et fiches gratuites).
- Programmes : shopping-ads, free-listings, product-ratings activés ; checkout activé sur 15 pays ; loyalty/YouTube checkout non éligibles.
- Volumétrie (`aggregateProductStatuses`, SHOPPING_ADS~CH) : **2 553 280** actifs (3 langues cumulées), 135 en attente, **19 900 refusés (0,78 %)**, 16 expirant. Expiration glissante à 30 jours.
- Éligibilité (`ads_11_current_overview`, snapshot 2026-10-20) : en fr, 432 k offres éligibles et ciblées (48,7 k modèles) ; **238 k offres en stock éligibles mais volontairement exclues du ciblage Ads** (routage Explorer/PMax) ; 58 k hors stock. La majorité du catalogue en stock n'est donc pas servie en annonces.

## 2. Qualité des données (top 3 000 offres par clics, 90 j, ≈ 16 % du coût : 5 948 CHF)

**Fait observé** (`ads_03_feed_sample.csv`) :
- Statut Merchant : 2 997/3 000 éligibles. Titre avec taille : 98,4 % ; format « Marque Modèle Couleurs (Genre), Taille » (ex. « adidas SL 72 OG Silver Metallic Collegiate Navy (Women's), 39 1/3 »).
- **GTIN présent : 95,6 %** ; 132 offres sans GTIN (4,4 %, 4,0 % du coût).
- Disponibilité Merchant : 132 offres « OUT_OF_STOCK » (4,4 %) ont encore reçu **242 CHF (4,1 %) de coût, 638 clics, 8,4 conv.** (fenêtre 90 j ; le statut est celui d'aujourd'hui, pas celui du moment du clic).
- `clickPotential` : LOW pour 99,7 % des offres (Google classe le potentiel de clic relatif) ; 1 HIGH, 9 MEDIUM.
- Âge médian des offres 145 jours (maximum 642 jours).
- Prix vs benchmark Google (1 392 offres sur 3 000 en ont un ; `ads_03_prix_vs_benchmark.csv`) :

| Prix / benchmark | Offres | Coût | CVR | CPA |
|---|---:|---:|---:|---:|
| < 0,95 | 77 | 289 | 1,28 % | 26 |
| 0,95–1,00 | 39 | 119 | 0,61 % | 73 |
| 1,00–1,05 | 108 | 265 | 1,00 % | 45 |
| 1,05–1,10 | 165 | 309 | 0,64 % | 68 |
| 1,10–1,20 | 349 | 798 | 0,48 % | 76 |
| > 1,20 | 654 | 1 424 | 1,32 % | 35 |

**Interprétation** : 47 % des offres comparées sont affichées à plus de 20 % au-dessus du benchmark Google, sans baisse visible de conversion (CVR 1,32 %). La relation prix/CVR n'est pas monotone ; le benchmark moyenne des prix cliqués de références de tailles différentes : il n'est pas un prix de marché fiable pour une taille donnée. Confiance : faible. Ne pas en tirer une règle de prix.

**Fait observé — statuts agrégés (Shopping ads CH)** : refusés par image trop petite 19 340 (97 % des refus) ; `price_mismatch` 192 ; `landing_page_error` 75 ; `non_product_data` 9 ; image cassée 1. Avertissements non bloquants : `availability_updated` 28 157 (Google corrige la disponibilité automatiquement), `image_too_small_for_high_resolution` 22 601, `price_updated` 8 248 (Google corrige le prix), `missing_potentially_required_attribute` 4 073, `condition_updated_from_detected` 1 293, `restricted_nfs_policy_violation` 314.
**Interprétation** : les refus sont marginaux en volume (0,78 %) ; les deux signaux utiles sont (1) **28 157 + 8 248 corrections automatiques de disponibilité et de prix** par Google, symptôme d'un flux qui diverge régulièrement de la page produit ; (2) 19 340 images < 500×500 px, qui deviendront un critère strict en 2027 (message Merchant). Confiance : élevée sur les comptes ; moyenne sur le lien causal flux ↔ page.

## 3. Cohérence prix/stock entre langues et avec Shopify

**Fait observé** (`ads_03_lang_consistency.py`, `ads_03_feed_vs_shopify.py` ; top 800 offres par clics × 3 langues, 794 communes ; Shopify live sur les 250 premières) :

| Comparaison | Résultat |
|---|---|
| Prix identique fr = de = en (794 offres) | 613 (77,2 %) ; **181 (22,8 %) divergent** : fr≠de 174, fr≠en 172, de≠en 16 |
| Disponibilité identique entre les 3 langues | 779/794 ; 15 (1,9 %) divergent |
| Prix flux fr = prix Shopify (offres non soldées, n = 216) | **215 (99,5 %)** |
| Prix flux de = prix Shopify (offres non soldées) ; en quasi identique à de (de≠en : 16/794) | **172/216 (79,6 %)** ; 44 divergent (22 au-dessus, 22 en dessous ; écart médian 4,5 CHF ; > 5 CHF : 20 ; > 20 CHF : 7 ; max +144 CHF sur 330) |
| Date de dernière modification Shopify des 44 variantes divergentes | entre 2026-11-01 06:00 et 11-02 19:06 UTC (médiane 11-01 22:42) |
| Offres Merchant « IN_STOCK » alors que Shopify `availableForSale = false` (250 offres) | 2 |
| Médiane de dernière modification des variantes du top 250 | 2026-11-01 05:38 UTC (soit < 40 h avant la mesure) |

**Interprétation** : le flux **fr suit Shopify quasiment en temps réel**, alors que **de et en retardent** (20 % des offres du top à un prix périmé de moins de ~40 h). Les prix sont modifiés en continu (la moitié des variantes du top ont bougé depuis moins de 40 h), donc le risque structurel de `price_mismatch` est élevé même si le volume refusé est faible (192). **Hypothèse** : les trois sources Simprosys n'ont pas la même cadence de rafraîchissement ou de file d'attente (non vérifiable sans l'admin Simprosys). Impact économique plausible mais non mesuré : annonce affichant un prix différent de la page (perte de confiance, refus, ajustement automatique de Google). Confiance : élevée sur la divergence mesurée ; faible sur la cause et l'impact.

## 4. Soldes et risque de vendre à perte

**Fait observé** (`ads_03_sale_scan.mjs`, `ads_03_sale_analysis.py`, Shopify live ; 80 000 premières variantes en stock sur un catalogue plus grand — parcours non exhaustif, non aléatoire)
- Exemple détaillé : variante 55491269198210 (adidas SL 72 OG, T. 39 1/3) : prix Shopify **79 CHF** (compare-at 193), flux `price` = 193 + `salePrice` = 79 (période 2026-11-01 00:00 → 11-30 Zurich), `costOfGoodsSold` flux **107,48 CHF**, `autoPricingMinPrice` 71,10 (= 90 % du prix soldé). Prix soldé HT (79/1,081 = 73,1) **inférieur au coût de 34 CHF HT** avant frais de paiement, expédition et publicité.
- Sur 80 000 variantes : **137 en solde (compare-at renseigné), 0,17 %** ; parmi toutes les variantes scannées, 128 portent `delivery_48h` (122 d'entre elles soldées) et 138 `price_locked` (122 soldées) ; tags des variantes soldées : `soldes-48h` (21), `BTS_2026_ADS` (55). Avec coût unitaire renseigné (100 % des variantes l'ont) : **102 sur 125 soldes (81,6 %) vendues sous le coût HT**, marge HT moyenne −22,8 CHF/unité, somme −2 854 CHF si tout se vendait ; hors soldes : 699 sur 79 651 (0,9 %) sous le coût.
- Dans les 250 offres les plus cliquées : 34 (14 %) sont soldées aujourd'hui ; sur la période de 90 jours elles ont reçu 1 103 clics, 337 CHF (13 % du coût du top 250), **4,7 conv.** contre 51,4 pour les 216 non soldées (CVR 0,43 % vs 1,37 %). Les soldes ont commencé le 2026-11-01 : **la période des clics précède les soldes** (ces offres recevaient déjà du trafic ; 55 des 137 variantes soldées portent le tag `BTS_2026_ADS`, ce qui suggère une sélection volontaire pour la publicité, non vérifiée) ; le faible CVR n'est donc pas un effet des soldes.

**Interprétation** : les soldes en cours concernent un stock propre (48 h, prix verrouillé) liquidé sous le coût d'inventaire. Si ce coût est un coût irrécupérable (stock vieillissant) la perte est comptable plus que marginale ; mais **le flux Google envoie ce prix, avec un plancher de remise automatique de −10 % supplémentaire**, et la publicité payante y mène (PM « Feed Only » Adidas/Nike/Jordan/UGG). Cet usage de la publicité pour la liquidation doit être décidé consciemment (coût du clic ≈ 0,4–0,6 CHF ; au CVR observé 0,43 %, ≈ 100–140 CHF de clics par vente soldée, sans marge pour l'absorber). Confiance : élevée sur l'écart prix/coût Shopify ; moyenne sur sa signification économique (coût unitaire = valeur d'inventaire, pas de preuve que ce soit le coût d'achat réel).

## 5. Fraîcheur et fiabilité de la synchronisation

**Fait observé**
- `ChannelListingState` (état des annonces par canal, dernier envoi) : canal SHOPIFY **ACTIVE 2 513** (dont **47 % non synchronisés depuis plus de 7 jours** ; 15 % dans les 24 h), PENDING 196 201, SOLD_OUT 714 579 ; GALAXUS ACTIVE 416 063 (49,5 % synchronisés < 24 h, 21,6 % > 7 jours) ; DECATHLON INACTIVE 172 461 (aucune synchro depuis 2026-09-02).
- Jobs (`InventorySyncRun`, depuis 2026-05-11/08-04) : `multichannel-stock-sync` : 501 SUCCESS, **119 FAILED**, **462 RUNNING jamais clos** (dernier démarrage 2026-11-02 19:15 ; l'état « RUNNING » ancien suggère des exécutions interrompues ou jamais finalisées) ; `inventory-reconcile` 1 291 SUCCESS, 1 RUNNING depuis 2026-09-02. Commandes Ads : `explorer:reconcile` 2 509 réussies / 14 en échec (dernier échec 2026-10-27), `explorer:weekly:plan` 10 échecs (08-19→09-14), `explorer:core-exclusions` 14 échecs (2026-08-07).
- Incohérence non résolue : la DB indique 2 513 listings SHOPIFY « ACTIVE avec stock » alors que l'API Shopify renvoie **au moins 80 000 variantes avec stock ≥ 1** (parcours tronqué) ; le stock affiché est donc une promesse (quantité 1, politique DENY) et non un stock physique, et `ChannelListingState` ne décrit qu'une partie de ce qui est vendu et publié.

**Interprétation** : en l'absence de lien entre flux Merchant et DB de stock, la disponibilité « IN_STOCK » repose sur un mécanisme qui échoue dans ~11 % des exécutions et n'a jamais fini dans 43 %. Confiance : moyenne (le statut RUNNING peut être un artefact de journalisation ; à confirmer par lecture du code/logs VPS).

## 6. Risque d'offre non achetable et promesse de livraison

**Fait observé**
- **Commandes non exécutables** : 5,3 % de commandes 2026 entièrement remboursées (153/2 882), 3,6 % partiellement, 51 annulées ; septembre : 10,4 % de commandes entièrement remboursées, 12,5 % du brut remboursé (`ads_02`, base pilote). 4,8 % des commandes dernier-clic Google Ads sont entièrement remboursées.
- **Promesse Merchant** (service livraison CH) : traitement 2 j + transit 1–4 j ⇒ **3 à 6 jours ouvrés** ; frais 0 CHF (livraison offerte) ou 2 CHF (« sous signature »). Entrepôt déclaré « MBE » (Ferney-Voltaire, FR), coupure 17 h, `handlingDays` 8 (au niveau entrepôt). Thème : estimation par défaut 3–5 j ; politique de livraison publiée : **standard 5–10 jours ouvrables, express 2–5**.
- **Délais réels** (base pilote `cx_02_delais_reels.csv`) : commande → livraison, StockX standard : médiane 19,3 j calendaires (13 j ouvrés ; p75 25,7 ; p90 32,4) ; StockX express 14,4 j (10 j ouvrés ; p90 19,4) ; hors StockX 15,9 j. Commande → expédition, médiane octobre 12,8 j (p90 19,7). Délai commande → achat fournisseur : médiane 98,6 h en octobre (107 h en septembre).
- Seules 128 variantes sur 80 000 (0,16 %) portent le drapeau `delivery_48h`.
- **Retours** : Merchant (CH) : politique de retour sans type ni durée explicites (`policy: {}`), échange accepté, retour par courrier, **frais de retour 0 CHF fixes**, étiquette « responsabilité du client ». Politique publiée : retours volontaires sous 14 jours calendaires, **frais de retour à la charge du client**. FR : NO_RETURNS.

**Interprétation** : même le 25ᵉ percentile des livraisons StockX express (11,7 j calendaires) dépasse le maximum promis par Merchant (6 j ouvrés ≈ 8 j calendaires) ; au moins 75 % des livraisons observées dépassent la fenêtre Merchant ; pour le standard StockX, le 25ᵉ percentile (12 j ouvrés) dépasse déjà la fenêtre « 5–10 jours ouvrables » du site, et la médiane express (10 j ouvrés) dépasse la fenêtre « 2–5 jours ». Le risque d'offre non achetable se matérialise par 5 % de remboursements totaux, et le risque de réputation/litige par la promesse de livraison (les avis vendeur Google dépendent de la livraison réelle). Contradiction frais de retour (0 dans Merchant vs client dans la politique). Confiance : élevée sur les écarts de délais (n = 65 livraisons StockX), moyenne sur l'effet commercial.

## 7. Synthèse

1. Le flux est structurellement sain (0,78 % refusés, GTIN 95,6 %, titres complets) mais **de/en retardent sur les prix** (22,8 % de divergences entre langues, 20 % vs Shopify) alors que fr est quasi temps réel. Confiance élevée.
2. 28 157 + 8 248 corrections automatiques de disponibilité/prix par Google : le flux diverge souvent de la page. Confiance moyenne.
3. Soldes 2026-11 : 82 % des variantes soldées vendues sous le coût d'inventaire HT ; la publicité mène déjà vers ces offres. Confiance élevée (écart), moyenne (signification).
4. Promesse Merchant 3–6 j ouvrés vs réalité 10–13 j ouvrés (médiane) : écart de 2 à 4× ; 5,3 % de commandes entièrement remboursées. Confiance élevée.
5. Fiabilité de la synchronisation stock incertaine (11 % d'échecs, 43 % d'exécutions non clôturées, 47 % des listings Shopify actifs > 7 j). Confiance moyenne.

## Limites et données manquantes

- Diagnostic Merchant détaillé par offre, historique d'approbation et rapport d'avis vendeur/« Customer reviews » : inaccessibles ; les comptes de refus sont agrégés (3 langues cumulées).
- Cadence de synchronisation Simprosys et règles de prix des 3 sources : inconnues (explication des écarts de/en = hypothèse).
- Échantillon : top 800/250 offres par clics (biais vers les offres populaires et les offres soldées) ; scan des variantes tronqué à 80 000 (catalogue > ; non exhaustif ni aléatoire) ; fenêtre « 90 j » des clics précède les soldes.
- Le « coût unitaire » Shopify est une valeur d'inventaire ; la vraie marge à la vente dépend du coût d'achat réel (StockX, frais, TVA d'importation) et du stock propre éventuellement amorti.
- Statuts d'offres (stock, prix) observés au 2026-11-02, pas au moment des clics historiques.
- Images : seuls les statuts agrégés (< 500 px) sont lus ; ni les ratios ni la qualité visuelle ne sont audités.
- Aucun test d'achat réel (interdit) : le parcours panier/paiement n'est pas vérifié ; le thème a été lu mais pas exécuté.
- `ChannelListingState` vs Shopify : incohérence non expliquée (voir §5) à faire arbitrer par le propriétaire du code.

Scripts : `calculs/ads_merchant_get.ts`, `ads_merchant_batch.ts`, `ads_03_feed_sample.py`, `ads_03_lang_consistency.py`, `ads_03_feed_vs_shopify.py`, `ads_03_sale_scan.mjs`, `ads_03_sale_analysis.py`. Tables : `tableaux/ads_03_*.csv`, `ads_14_*.csv`, `ads_11_*.csv`.
