> **ERRATUM 2026-11-02 23:30 (pilote).** Les chiffres de ce fichier reposent sur une TVA de 8,1 % extraite des prix. Le dirigeant déclare le forfait TDFN 2,1 % du CA TTC (non prouvé, relevés inaccessibles). Lire : contribution avant pub **40,3 CHF/commande** (et non 28,8), ROAS global d équilibre **≈ 5,4** (et non 7,6), résultat 2026 avant rémunération **+11,9 k CHF** (et non −21,2 k). Les conclusions « la pub dépasse la contribution » deviennent « la pub marginale (≈ 42-75 CHF/commande) dépasse la contribution unitaire (40,3) ; la moyenne reste légèrement positive ». Voir `fin_00_base_financiere.md`.

# ADS-02 — Tracking et conversions : Google vs commandes Shopify réelles

Sous-agent n°1 (BRIEF_MAITRE §7). Collecte 2026-11-02. CHF. Lecture seule. « Conv. Google » = conversions revendiquées par Google Ads (valeur TTC envoyée par le tag), **pas** des commandes vérifiées.
Périmètre commandes : 2 882 commandes Shopify (hors test) créées du 2026-01-01 au 2026-10-31, fuseau Europe/Zurich (UTC → Zurich ; vérifié), base pilote `fin_05_orders_pnl.csv` + `orders_api.ndjson`.

## 0. Accès testés

| Source | Résultat |
|---|---|
| Google Ads API : actions de conversion, conversions par action et par mois (2025-01→2026-11-02), délai de conversion (2026-07-01→10-15), objectifs de conversion client/campagne | **OK** |
| Shopify commandes (UTM, source/dernière visite, remboursements, annulations) | **OK** (via pilote ; 6 650 commandes complètes jusqu'au 2026-11-02 19:55) |
| `funnel_events` (pixel personnalisé « ombre », depuis 2026-10-15) | **OK** |
| Thème live (fichiers publiés `donnees_brutes/site/theme`) | **OK** (lecture) |
| Simprosys (admin : paramètres consent/value, ajustements), GA4 (propriété, flux, consent mode), Google Tag Manager, factures | **INACCESSIBLE** |

## 1. Architecture de mesure réellement en place

**Fait observé**
- **Une seule action « Achat » compte dans la colonne Conversions** : *Google Shopping App Purchase* (Simprosys, type WEBPAGE, catégorie PURCHASE, **principale**, comptage « MANY_PER_CLICK », attribution *data-driven*, fenêtre clic 90 j, vue 30 j). Valeur = valeur de la transaction (la valeur moyenne par conv. Google, 228,6 CHF, est cohérente avec le panier brut moyen des commandes dernier-clic Google Ads, 224,0 CHF).
- *GA4 (web) purchase* est **secondaire** (non comptée) ; add_to_cart, begin_checkout, view_item, search : secondaires (toutes `include_in_conversions = false`). Les actions « appels », « directions », smart campaign : marquées principales mais **exclues** du compte de conversions (include = false). Anciennes actions (Website sale, buy, Panier, test…) : supprimées.
- Aucun double comptage d'achat dans la métrique principale ; en 2026 les achats comptés = exactement la ligne Simprosys (ex. oct-2026 : 204,3 conv = 204,3 « toutes conv. » sur cette action).
- Simprosys est chargé comme **app embed du thème** (`core_settings_block`, config `config__settings_data.json`) ; aucune balise gtag/GTM dans `layout/theme.liquid` (seulement Ahrefs Web Analytics, Microsoft Clarity et Judge.me en blocs). Le pixel personnalisé maison (`funnel_events`) est en **mode ombre** (G0–G8 dans `docs/tracking/TRACKING-PLAN.md` ; aucune conversion envoyée à Google depuis ce pixel).
- Comparaison de balises : sur les mêmes mois, les achats **GA4 (secondaires) = 74 à 89 % des achats Simprosys** (jan 208,7 vs 253,7 ; juin 111,9 vs 150,4 ; oct 181,5 vs 204,3).

**Interprétation** : un seul tag alimente l'optimisation (pas de doublon) ; mais deux tags de mesure divergent de 11–26 %, signe que l'un perd des événements (consentement/analytics, bloqueurs, redirections de paiement) ou compte autrement. Lequel est le « bon » ne peut pas être tranché sans l'admin Simprosys/GA4. Confiance : élevée sur la structure, faible sur la cause de l'écart.

## 2. Google vs Shopify : écarts mensuels (2026-01→10)

**Fait observé** (`ads_02_gads_vs_shopify_mensuel.csv`, `_jour.csv`) :

| Mesure | Valeur janv→oct 2026 |
|---|---:|
| Conversions Google (par date de clic) | 1 967 (par date de conversion : 1 974) |
| Commandes Shopify avec UTM `google / cpc` en dernier clic (« gads_click ») | 1 337 |
| Commandes Shopify avec UTM ou gclid Google Ads en dernière ou première visite (« gads_any ») | 1 554 |
| Commandes Shopify totales (hors test) / non annulées | 2 882 / 2 831 |
| Rapport conv. Google / commandes dernier-clic UTM | **1,47** (mensuel 1,3 à 1,7) |
| Rapport conv. Google / commandes UTM ou gclid (any) | 1,27 |
| Rapport conv. Google / toutes les commandes | 0,69 (mensuel 0,57 à 0,81) |
| Valeur Google (clic) / ventes brutes TTC Shopify | 0,64–0,66 (449,7 k vs 685–698 k selon définition du brut) |
| Corrélation journalière (août-oct) conv. Google ↔ commandes totales / ↔ gads_click | 0,83 / 0,87 |

Par mois (conv. Google / commandes UTM) : jan 1,46 ; fév 1,32 ; mar 1,27 ; avr 1,47 ; mai 1,53 ; juin 1,67 ; juil 1,45 ; août 1,50 ; sept 1,60 ; oct 1,41.

**Interprétation**
- Google attribue à ses campagnes ~47 % **de plus** de commandes que le dernier clic UTM de Shopify n'en voit. Causes plausibles, non séparables ici : (a) attribution *data-driven* sur 90 jours + vue 30 j (conversions assistées/vues), (b) UTM absentes sur les clics non produit (le lien de flux porte `utm_source=google&utm_medium=cpc&utm_campaign=Google Shopping` ; les clics d'annonces textuelles/PMax non produit n'ont que le gclid auto-tagging), (c) écrasement de la dernière source par un retour direct, (d) conversions multi-appareils. Le facteur 1,27 avec UTM ou gclid indique qu'environ la moitié de l'écart est une question de balisage ; le reste est de l'attribution revendiquée.
- Inversement, les 36 % des commandes avec UTM Google Ads (dernier clic) sont **sur-comptées** par l'UTM codée en dur sur le lien produit : les clics des fiches gratuites Google (Free listings, activés dans Merchant) portent la même UTM `cpc`. Part estimée faible : sondage `product_performance_view` sur 3 jours (1-3 oct 2026) = 10 à 23 clics gratuits/jour vs 993 à 1 031 clics payants/jour (≈ 1–2 %) ; échantillon de 3 jours seulement.
- La conversion Google ne peut être utilisée comme « nombre de commandes » ; elle reste un signal d'optimisation. Confiance : moyenne (écart mesuré, causes non isolables).

## 3. Délai de conversion, attribution, fenêtre

**Fait observé** (`ads_02_conv_lag.json`, 2026-07-01→10-15) : 84,4 % des conversions ont lieu < 1 jour après le clic, 3,1 % à 1–2 j, 1,5 % à 2–3 j, ~11 % au-delà de 3 jours (dont 2,9 % à 14–21 j, ~1,3 % à plus de 30 j). Comparaison par date de clic vs date de conversion : 1 967 vs 1 974 (écart 0,4 %).
**Interprétation** : parcours d'achat très court (achat sur impulsion, panier ~224 CHF) ; l'attribution *data-driven*/90 j change peu le total (≈ 11 % de conversions tardives) ; les ROAS mensuels récents sont lisibles quasi immédiatement (pas de retard de conversion à attendre au-delà de ~3 jours pour ~89 % du total). Confiance : élevée.

## 4. Annulations, remboursements, commandes non exécutables

**Fait observé** (`fin_05_orders_pnl.csv` × attribution) :

| Population | Commandes | Remboursées en totalité | Partiellement | Remboursé/brut TTC |
|---|---:|---:|---:|---:|
| Dernier clic Google Ads (UTM cpc) | 1 337 | 4,8 % | 3,2 % | **7,1 %** |
| Autres | 1 545 | 5,8 % | 3,9 % | 9,5 % |
| Total | 2 882 | 5,3 % (153) | 3,6 % | 8,4 % (57,8 k) |

- 51 commandes annulées sur 2 882 (22 parmi les dernier-clic Google Ads) ; les commandes entièrement remboursées ont une contribution moyenne de −26 CHF (−4,0 k au total ; −1,8 k côté Google Ads).
- Taux de remboursement mensuel du brut : 7,0 % (jan), 12,7 % (fév), 5,7, 7,5, 5,3, **14,2 % (juin)**, 8,6, 9,5, **12,5 % (sept)**, 4,3 % (oct). Septembre : 10,4 % de commandes entièrement remboursées (délais d'achat/expédition allongés, cf. cx_02).
- La valeur envoyée à Google est la valeur à la commande ; **aucune valeur nette** (retours/annulations) n'est renvoyée (aucun ajustement de conversion détectable ; l'admin Simprosys est inaccessible).

**Interprétation** : la valeur Google surestime la valeur conservée de ~7 % pour les commandes Google Ads (jusqu'à 14 % certains mois) ; plus important, l'algorithme enchérit sur des commandes qui, 5 % du temps, ne seront jamais livrées (stock fournisseur/StockX introuvable, délais). Les valeurs n'intègrent ni la marge (varie de −10 à +97 CHF par commande selon la tranche), ni le risque d'annulation. Confiance : élevée sur les taux, moyenne sur l'impact sur l'optimisation.

## 5. Qualité de l'événement d'achat : couverture du pixel maison

**Fait observé** (`funnel_events`, 2026-10-15→11-02 ; `ads_20_cc_versions.csv`, `ads_02_pixel_coverage.csv`) :
- 147 commandes Shopify non annulées sur la période ; événements `checkout_completed` : **106 générés par le navigateur** (pixel `2026-10-15.p2/p3`, `2026-10-20.g3` : 1 + 36 + 69) et **50 « server.orders_paid »** injectés côté serveur au total (0 session, 0 identifiant client ; première le 2026-09-12 ; ≈ 42 dans la fenêtre) par le script `funnel-backfill-orders-paid` / `ensureServerCheckoutCompleted`. Après dédoublonnage : 148 commandes uniques (couverture **apparente** 100,7 %, 0 doublon) : cette couverture est artificielle, comblée par le serveur.
- **Couverture réelle du navigateur : 106/147 ≈ 72 %** (28 % des commandes n'ont aucun événement navigateur). Le pixel est chargé uniquement après consentement « Analytique » (TRACKING-PLAN §4) : les 106 événements navigateur ont tous `consent_marketing = true` (par construction, les sessions sans consentement ne sont pas du tout enregistrées).
- Click-id (gclid/gbraid/wbraid) présent sur 18,2 % des événements d'achat vs 36,1 % des commandes avec UTM google/cpc : écart dû au consentement marketing, au passage de redirections de paiement ou à la perte du paramètre.
- Sessions pixel : 51 679 (22 651 avec gclid ; 23 315 avec utm_medium=cpc) ; parmi les sessions cpc, 65 achats navigateur (0,28 %), contre 42 pour les sessions sans UTM. Trafic robot (webdriver) : ~700–830 sessions/jour depuis le 2026-10-24 (≈ 7 000 sessions du 24-oct au 02-nov).

**Interprétation** : le tag « officiel » (Simprosys) n'est pas celui-ci ; cette couverture sert de **sonde** : environ trois commandes sur quatre ont un parcours navigateur avec consentement analytique ; 28 % passent sous le radar de tout pixel soumis au consentement. Si Simprosys est aussi soumis au consentement (hypothèse, non vérifiable), 20–30 % des conversions réelles manquent à l'optimisation Google (ce qui est cohérent avec l'écart GA4 −11 à −26 % mais pas avec le sur-comptage 1,47× du §2 : les deux phénomènes coexistent). Confiance : moyenne sur le 72 % (fenêtre de 19 jours, 147 commandes), faible sur l'effet Google.

## 6. Consentement

**Fait observé** : politique de confidentialité mentionne « bannières cookies et services associés » (LPD suisse) ; le thème ne contient pas de code de consentement propre ; le consentement dépend de la bannière Shopify (Customer Privacy API) et de la config Simprosys (inaccessible). Dans `funnel_events`, 100 % des sessions enregistrées ont `consent_marketing = true` (filtre d'enregistrement) : le **taux de consentement ne peut pas être calculé** depuis la base.
**Interprétation** : aucune mesure de Consent Mode v2 (états `ad_storage`, `ad_user_data`) accessible ; impossible de dire si des conversions « modélisées » sont ajoutées par Google (une partie de l'écart 1,47× pourrait en venir). Confiance : faible. À obtenir : réglages Simprosys + diagnostic « Consent Mode » dans Google Ads (Outils > Mesure > Diagnostic).

## 7. Marque, nouveaux clients, ventes non incrémentales

**Fait observé**
- Requêtes de marque (« resell … ») : 4,3 % du coût (1 168 CHF), 71,6 conv. (≈ 11 %), ROAS 17,3 (2026-08-02→11-01).
- Part de nouveaux clients : 94,7 % des commandes dernier-clic Google Ads (1 266/1 337) vs 83 % pour les autres canaux ; 88 % de l'ensemble des commandes 2026 sont des premières commandes. Rachat observé très faible : 1,02 à 1,16 commande par client sur la cohorte du mois (cohortes jan→oct 2026), recurrentes = 12 % des commandes.
- Contribution avant pub par commande : première commande 28 CHF vs récurrente 47 CHF (base pilote) ; dernier-clic Google Ads 25,8 (nouveaux clients 24,7), Google non cpc 35,8, direct/autre 34,5.

**Interprétation** : Google Ads acquiert surtout de nouveaux clients (positif), mais ces clients rapportent moins que la moyenne (24,7 vs 32–48 CHF) et rachètent peu sur la période observée : **aucune LTV démontrable** (non inventée ici). Les conversions « marque » ne sont pas la cause de la croissance ; en les retirant le ROAS Google passe à ≈ 3,6. Confiance : moyenne.

## 8. Synthèse

1. Un seul achat principal (Simprosys) : pas de doublon, mais conversions revendiquées = 1,47× les commandes UTM, 0,69× toutes les commandes. Confiance élevée.
2. Délai de conversion court (84 % < 1 jour) ; ROAS mensuels fiables à ~3 j. Confiance élevée.
3. Valeur envoyée brute ; remboursements 7,1 % du brut Google Ads (jusqu'à 14 % par mois) et 4,8 % de commandes entièrement remboursées non répercutés. Confiance élevée.
4. Couverture du pixel navigateur avec consentement ≈ 72 % ; GA4 ≈ 74–89 % de Simprosys. Confiance moyenne.
5. UTM `cpc` codée en dur dans le lien produit du flux : contamination marginale par les fiches gratuites. Confiance moyenne.

## Limites et données manquantes

- Pas d'accès à l'admin Simprosys (paramètres de valeur, consent, ajustements de conversion), à GA4 ni à GTM : causes d'écart non tranchables.
- Aucune table commande ↔ gclid (le pixel n'enregistre le gclid que sur 18 % des achats et seulement depuis 2026-10-15) : l'attribution d'une commande à une campagne ou à un produit est impossible individuellement ; la jointure se fait au jour/mois.
- « Nouveau client » = rang de commande Shopify (`cust_order_idx`), pas un fichier d'audience Google ; un client qui change d'e-mail est compté comme nouveau.
- Fenêtre pixel : 19 jours seulement (147 commandes) ; marge d'erreur ±8 points sur 72 %.
- Annulations « non exécutables » : on ne dispose que du statut Shopify/remboursement et des indications cx_02 ; la cause exacte (StockX annulé, stock absent, retard) n'est pas rattachée à la campagne source.
- Conversions modélisées Google, consent mode, conversions « view-through » : non isolables via l'API standard utilisée.
- Données commandes avant 2026-01 (P&L) : non reconstruites ; les comparaisons 2025 portent sur les commandes et coûts, pas sur la contribution.

Scripts : `calculs/ads_02_conv_actions_month.py`, `ads_02_google_vs_shopify.py`, `ads_02_pixel_coverage.py`, `ads_04_unit_economics.py` (remboursements par canal), requêtes `calculs/gaql/ads_02_*.gaql`, `calculs/sql/ads_20_*.sql`. Tables : `tableaux/ads_02_*.csv`, `ads_20_*.csv`.
