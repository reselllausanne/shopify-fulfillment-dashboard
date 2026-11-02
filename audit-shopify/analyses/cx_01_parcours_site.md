# CX-01 — Site, conversion et parcours client (BRIEF §8, §3, §19)

Sous-agent n°2. Lecture seule : aucune écriture Shopify / Klaviyo / Postmark / base. Dates d'extraction : 2026-11-02. Montants en CHF TTC (TVA incluse, `taxesIncluded=true`) sauf mention. Aucune donnée client nominative.

Convention : **Fait** (source, périmètre) · **Interprétation** · **Hypothèse** · **Reco** (mécanisme) · **Confiance** (haute / moyenne / faible + raison).

---

## 0. Verdict en 8 lignes

1. Le site **affiche déjà un délai avant paiement**, mais il est **statique, incohérent d'une page à l'autre et très inférieur à la réalité**. La question n'est donc pas « afficher ou non un délai » mais « afficher un délai faux ou un délai vrai ».
2. Réalité mesurée (commandes CH, sourcing StockX, créées depuis le 15 août) : livraison estimée **médiane 13 jours ouvrés en Standard (promesse 5-10) et 10 j. ouvrés en Express (promesse 2-5)**. Seules **25 % (Standard) et 4 % (Express)** des commandes dont l'échéance est passée arrivent dans la fourchette affichée.
3. Le volume (≈ 8-11 commandes/jour, conversion ≈ 0,29 % des sessions humaines) rend un **test A/B de conversion non concluant** : il faudrait des centaines de milliers de sessions par bras. On ne peut donc **ni prouver ni réfuter** la conviction « afficher le délai réel fait baisser la conversion » par un A/B simple. On peut en revanche mesurer le **coût de l'écart promesse/réalité** (annulations, litiges, remboursements, contacts) en avant/après.
4. Coût direct observable de l'écart : 24 des 311 remboursements 2026 citent un retard / non-expédition ; **8 litiges « produit non reçu »** sur 12 mois ; **170 commandes payées de plus de 14 jours encore non (entièrement) expédiées** dont **97 totalement non expédiées (≈ CHF 22,6k TTC)**. Risque juridique : une promesse de délai « trop courte et impossible à tenir » est un acte déloyal selon l'info officielle KMU/admin.ch (LCD art. 3 al. 1 let. b).
5. Trafic 82 % mobile ; conversion mobile 0,19 % des sessions (pixel) ; le goulot visible est **la sélection de taille** (10 % des visiteurs de fiche choisissent une taille) puis **le checkout** (18 % de finalisation des sessions mobiles qui y entrent).
6. Checkout : erreurs réelles mais **petit enjeu financier** (ordre de grandeur CHF 1-6k/an) ; à corriger car peu coûteux (validation des localités suisses).
7. Le site ne sert que la Suisse (99 % des commandes ; 29 commandes UE en 2026) : l'UE est un non-sujet pour le parcours aujourd'hui.
8. Priorités (§6) : (a) vérité du délai unique + date calculée sur mesures glissantes ; (b) traiter les 97 commandes [réconciliées depuis : 93 payées non expédiées ≥ 14 j, dont 76 prioritaires ; voir fin_00 §8] bloquées avant tout levier d'acquisition ; (c) corriger la validation d'adresse ; (d) simplifier le choix de taille/mode ; (e) mesurer la contribution totale, pas la conversion seule.

---

## 1. Périmètre, accès testés, limites de preuve

| Source | Statut | Détail |
|---|---|---|
| Thème Shopify live (`fullstack-2-3-1`, id 188549300610, MAIN, maj 2026-11-02) via API `read_themes` | OK | 131 fichiers pertinents lus (`donnees_brutes/site/theme/`) sur 828 |
| Pixel maison `funnel_events` (DB) | OK | **uniquement du 2026-10-15 au 2026-11-02** ; pas d'historique avant |
| Pages publiques (livraison, FAQ, accueil) via HTTP | OK | TTFB et poids HTML seulement |
| PageSpeed Insights API | **KO** (429 quota quotidien) | pas de Core Web Vitals labo/terrain ; fichiers `donnees_brutes/site/psi/` contiennent l'erreur |
| GA4 / Search Console | hors périmètre / non lus | autre sous-agent |
| Test navigateur réel (retour à la position dans une liste, scroll) | **Non réalisé** | aucun code de restauration de scroll repéré dans les assets téléchargés (couverture partielle du thème) ; **non prouvé** |
| `collections/all` en HTTP | 429 (limitation du site) | non retesté |

Limites majeures : (1) l'historique de funnel est de 18 jours ; (2) le pixel capte ≈ 71 % des commandes (≈ 103 sessions « completed » vs 144 commandes DB sur 16 oct-2 nov) → les taux de finalisation par session sont **sous-estimés d'environ 29 %** ; (3) une part du trafic « bot » est sans doute encore dans l'humain (voir §3) ; (4) les durées d'expédition utilisent les événements de la timeline Shopify, disponibles seulement depuis mi-août (rétention des événements), pas l'historique complet.

---

## 2. Le délai affiché : preuves (conviction du dirigeant à challenger)

### 2.1 Fait observé — ce que le site promet aujourd'hui

| Où | Promesse | Source |
|---|---|---|
| Fiche produit / modale de taille | « 5 à 10 jours ouvrés (délais estimés) » + date estimée (`delivery-estimation.js`) | `assets/product-size-selection-modal.js` : `STANDARD_MIN_DAYS=5`, `MAX=10` (constantes en dur) |
| Express (même modale) | « 2 à 5 jours ouvrés » | `EXPRESS_PROMISE_TEXT` en dur |
| Badge panier | « 2 a 5 jours ouvres » | thème |
| Checkout (option « Livraison Offerte / Kostenlose Lieferung / Free Delivery ») | « Delivery 3 to 8 business days on average » | alertes/pixel `delivery_description` |
| Politique d'expédition | délais « estimés » 5-10 j. (standard), 2-5 j. (express), « ne constituent pas une garantie » | Shopify policies (2026-06-14) |
| Page FAQ livraison | 2 à 12 jours | page publiée |

Donc **quatre promesses différentes (5-10 / 2-5 / 3-8 / 2-12)**. Un délai est affiché avant paiement ; l'argument « on n'affiche pas de délai » est **factuellement faux** pour la fiche produit. Le sujet réel est la **justesse** du délai.

### 2.2 Fait observé — ce que la logistique fait réellement

Périmètre : commandes **CH, non annulées, avec ligne(s) StockX, créées depuis le 2026-08-15** (n = 348 Standard, 219 Express). « Express/Standard » = type de checkout StockX de l'achat de sourcing (`stockxCheckoutType`), supposé refléter le mode choisi par le client (**non vérifié** ; l'événement `fulfillment_mode_selected` n'existe que depuis le 15 oct). Livraison estimée = date du mail « delivered » (Swiss Post Labels) si présent, sinon expédition + 3,5 j. calendaires (transit médian observé). Script : `calculs/cx_02_promesse.py` ; table : `tableaux/cx_02_promesse_vs_reel.csv`.

| Mode | Commandes | Non expédiées à ce jour | Échéance passée | **Dans la promesse** | Médiane livraison (j. ouvrés) | P90 |
|---|---|---|---|---|---|---|
| Standard (promesse 5-10 j.o.) | 348 | 50 | 315 | **78 / 315 = 24,8 %** | **13** | 19 |
| Express (promesse 2-5 j.o.) | 219 | 17 | 212 | **9 / 212 = 4,2 %** | **10** | 13 |

Décomposition (même périmètre, `cx_02_delais_reels.csv`) : commande → expédition médiane **14,2 j. cal. (10 j.o.) Standard**, **9,8 j. cal. (7 j.o.) Express** ; expédition → livré (mail « delivered », n = 64-65 seulement) médiane **3,5-3,7 j. cal.** Hors StockX (stock/essentials) : médiane 11,9 j. cal. mais p90 30,7 j. (hétérogène).

Tendance 2026 (DB, commandes StockX avec enregistrement d'expédition, `ops_01` du pilote et `cx_02_delays_par_mois.csv`) : médiane commande → expédition **9,5 j. (janv.) → 13,9 j. (sept.) → 12,8 j. (oct.)** ; médiane commande → achat StockX **2,4 h (janv.) → ~107 h (sept.)**. Le sourcing se dégrade avant l'expédition, pas après (achat → entrepôt ≈ 2,4-2,9 j.).

### 2.3 Interprétation

- Le délai affiché n'a **aucun lien** avec le délai réel ; il date d'une période où le sourcing était plus rapide. Il est vrai que l'Express (2-5 j.o.) est le plus éloigné (médiane 10 j.o.).
- Le coût de cette promesse n'est pas la conversion mais **la confiance** : les avis Judge.me citent « un mois de délai », « délai un peu long », des avis allemands demandent un suivi de statut (voir `cx_03`).
- Des commandes durablement non expédiées (§5) sont la forme extrême de l'écart.

### 2.4 Ce que l'on ne peut pas affirmer

- Effet d'un délai plus long sur la conversion : **aucune donnée**. Le pixel n'a pas de période avec deux versions du délai. Un A/B de conversion est statistiquement infaisable au volume actuel (voir §4).
- Part de commandes perdues à cause d'un délai affiché plus honnête : inconnue.

### 2.5 Hypothèse / Reco

Hypothèse : afficher un délai **vrai** (fourchette glissante P25-P90) réduit les annulations post-achat et litiges « produit non reçu », au prix d'une baisse de conversion de taille inconnue.

Reco : un seul calcul de vérité (voir §6, changement 1). Test en avant/après sur **contribution et cash**, pas sur la conversion seule.

**Confiance : haute** sur l'écart promesse/réalité (n > 200 par mode, deux sources concordantes sur la médiane Standard 12,5-14,2 j. cal.) ; **faible** sur l'effet conversion.

---

## 3. Trafic, appareils et conversion par étape

Source : `funnel_events` (pixel maison), du 2026-10-16 au 2026-11-02, **hors `device_type=bot` et hors `webdriver=true`** ; tables `cx_03_funnel_sessions.csv`, `cx_03_funnel_events_profile.csv` ; SQL `calculs/sql/cx_03_funnel_*.sql`.

### 3.1 Fait observé

Sessions humaines : **50 385** — mobile 41 113 (81,6 %), desktop 8 968 (17,8 %), tablette 304 (0,6 %) ; 7 092 sessions bot écartées. Commandes DB sur la même période : 144 (≈ 8,5/jour, contre ≈ 11,4/jour en octobre) → **≈ 0,29 % de commandes par session humaine**.

| Étape (sessions) | Mobile | % du palier précédent | Desktop |
|---|---|---|---|
| Fiche produit vue | 19 363 | 47,1 % des sessions | 3 001 |
| Taille choisie (`variant_selected`) | 1 989 | **10,3 %** | 443 |
| Ajout panier | 1 027 | 51,6 % | 861 |
| Panier vu | 513 | 50,0 % | 83 |
| Checkout commencé | 437 | 42,6 % des ajouts | 737 (gonflé, voir ci-dessous) |
| Coordonnées / livraison / paiement soumis | 133 / 151 / 110 | — | 35 / 35 / 27 |
| **Commande finalisée** | **79 (0,19 %)** | **18,1 % des checkouts** | 23 (0,26 %) |

Sources principales (finalisations pixel / sessions) : google 18 043 sessions → 51 (0,28 %) ; direct 17 012 → 9 (0,05 %) ; chatgpt.com 2 072 → 7 (0,34 %) ; lm.facebook.com 1 228 → 0.

Langue du navigateur des sessions : EN 19 281 sessions → 14 finalisations (0,07 %) ; **DE 12 673 → 42** ; **FR 11 683 → 41** ; IT 1 509 → 3. Région des 103 commandes finalisées (premier chiffre du NPA) : Romandie (1xxx + 2xxx) 43 (42 %) ; Zurich 8xxx 19 ; reste (3-7, 9xxx) 41. (`cx_03_langue_region.csv`, sessions finalisées avec NPA.)

### 3.2 Interprétation

- **Mobile = produit principal** : tout changement doit être spécifié et validé en mobile d'abord.
- La **taille** est l'étape où le visiteur disparaît (10 % choisissent une taille). La page est consultée, mais l'engagement est faible ; c'est cohérent avec un catalogue vu via Google Shopping/PMax (visiteurs de comparaison) mais l'événement `variant_selected` ne couvre peut-être pas toutes les voies (ajout direct d'une taille unique). **À vérifier avant de conclure.**
- Une **majorité des commandes finalisées vient de visiteurs dont le navigateur est DE (41 %) ou dont le NPA est hors Romandie (58 %, 60/103)**, alors que (i) les e-mails automatiques partent à 75 % en anglais (voir `cx_02`), (ii) l'e-mail marketing est surtout rédigé en FR. Le site est publié en fr/de/en (it non publié), la page /returns est en FR/EN/DE, mais pas la chaîne d'e-mails.
- Le trafic « direct » (17 012 sessions, 9 finalisations) est suspect : trafic in-app/robot non détecté ou lien non tagué. **Hypothèse**, non vérifiée.
- Pic desktop : environ 694 sessions Chrome/Windows concentrées du 17 au 19 octobre, 11 soumissions de coordonnées seulement → très probablement automatisées (non marquées bot). Le taux desktop de 0,26 % est donc **sur-estimé en dénominateur côté checkout**, le vrai taux desktop est supérieur.

**Confiance : moyenne** — 18 jours, pixel à 71 % de couverture, trafic bot résiduel.

---

## 4. Sensibilité économique et faisabilité des tests

### 4.1 Volumes

2026 (janv.-oct.) : 2 882 commandes hors test (CHF 685k brut TTC ; la base 2 884 / 698k de ce fichier utilisait `total_orig`, non réconciliée), CHF 57,8k remboursés (8,4 %). Contribution avant pub par commande (base corrigée TDFN, `fin_05_orders_pnl.csv`) : **≈ CHF 40,3** en moyenne (40 pour la 1ʳᵉ commande, 62 pour les récurrentes) ; **après pub Google : +CHF 15,2k** sur 10 mois (`fin_05_pnl_mensuel.csv`), résultat fragile. Annualisé : ≈ 3 450 commandes.

### 4.2 Puissance d'un A/B de conversion

Taux de base 0,29 %. Pour détecter −10 % relatif (0,29 % → 0,26 %) avec 80 % de puissance et α = 5 %, il faut ≈ 550 000 sessions par bras (calcul approché : \(n \approx 16\,p(1-p)/\delta^2\), \(\delta = 0{,}00029\)), soit ≈ 1,1 M de sessions au total, **≈ 13 mois de trafic** (≈ 2 800 sessions humaines/jour). Pour −25 % relatif, ≈ 88 000 par bras (≈ 2 mois au total). **Conclusion : un A/B sur le taux de conversion ne peut pas trancher la question du délai à l'échelle de la boutique.**

### 4.3 Table de sensibilité (contribution avant pub, hors effets d'échelle sur l'acquisition)

| Variation relative des commandes | Commandes/an | Δ contribution annuelle (CHF 40,3/commande, base corrigée TDFN ; ancienne : 30,6) |
|---|---|---|
| −5 % | −172 | **−6,9k** |
| −10 % | −345 | **−13,9k** |
| +5 % | +172 | +6,9k |

À mettre en regard des **gains de coût** liés à un délai vrai (mêmes ordres de grandeur, périmètre 2026) :
- litiges « produit non reçu » : 8 sur 12 mois, CHF 1 538 (6 perdus) ;
- remboursements avec note retard/non-expédié : 24 (≈ CHF 4-6k de ventes annulées si valeur moyenne CHF 190) ;
- coût du SAV non mesurable (pas de boîte mail SAV ; voir `cx_02`).

**Interprétation** : le gain direct d'un délai vrai est **modeste (quelques CHF k/an)** ; il ne justifie pas à lui seul un risque de −10 % de commandes. Les vrais arguments sont (1) le risque juridique/réputationnel (§2.4, `cx_03`), (2) la **capacité à réduire effectivement le délai réel** (levier plus rentable que l'affichage), (3) l'absence de preuve que l'honnêteté fasse baisser la conversion. **Aucune de ces trois raisons ne démontre un gain en contribution.** À présenter comme tel.

**Confiance : moyenne** — sensibilité calculée sur la moyenne pilote ; effets d'ampleur réelle inconnus.

---

## 5. Qualité économique des commandes obtenues (de la conversion au cash conservé)

Périmètre : 2026, commandes hors test ; sources `orders_api.ndjson` (complet), `cx_02_*`, `fin_05/07` du pilote.

### 5.1 Fait observé

- Commandes 2026 (non annulées, janv.-oct.) = 2 884 ; **51 annulées** ; **142 entièrement remboursées**, **113 partiellement** → 8,8 % des commandes avec au moins un remboursement ; **objets « Return » Shopify : 139 commandes (4,8 %)**.
- Remboursements par nature (311 remboursements, CHF 57,8k) : retours physiques 122 / CHF 19,7k (34 %) ; annulations avant expédition 93 / CHF 22,8k (40 %) ; lignes remboursées sans retour ni annulation 95 / CHF 15,1k (26 %, nature **non expliquée** par les données — voir `cx_02`).
- **Commandes payées non expédiées âgées de plus de 14 jours** (`cx_02_stats.py`, statuts API) : 170 (≈ CHF 49,4k brut) dont **97 « UNFULFILLED » entièrement non expédiées (CHF 22,6k brut, 1,9k déjà remboursés)** : sept. 33, oct. 43, août 9, avant août 12. 39 supplémentaires sont « PARTIALLY_FULFILLED » avec une ligne « protection colis » probablement non expédiable (artefact à confirmer). Parmi les 97 : 42 ont un achat StockX lié, 8 une annulation côté StockX, 0 enregistrement d'expédition en base.
- Moyens de paiement : Shopify Payments 1 408 commandes, **TWINT 697**, facture PowerPay 511 + CembraPay 60 (≈ 20 %), PayPal 160. Remboursement/brut : cartes 7 %, TWINT 5 %, facture 7 %. **Alerte pilote** : le tableau `fin_07_seg_paiement.csv` classe en « payé avec crédit magasin » 97 commandes ; seules **31** ont réellement payé en crédit (CHF 6,2k) ; les 66 autres ont un *remboursement* en crédit (gateway listé dans `paymentGatewayNames`). Les « contributions négatives » de ces lignes sont donc des commandes remboursées, pas des commandes payées en crédit.
- 1ʳᵉ commande 88 % des commandes ; récurrentes 12 % (11,4 % hors annulées) mais **14,2 % du CA brut**, contribution 47 vs 28 CHF par commande (pilote).
- Litiges de paiement nov. 2025-oct. 2026 : 32 (CHF 8,4k) dont 13 « fraudulent » (CHF 4,6k, tous perdus), 10 « crédit non traité » (CHF 2,1k, 6 gagnés), 8 « produit non reçu » (CHF 1,5k), 1 « produit inacceptable ».

### 5.2 Interprétation

- Le « sourcing réussi » est le point faible économique : **40 % de la valeur remboursée vient d'annulations avant expédition**. Ce n'est pas un défaut de page produit mais d'approvisionnement ; la conversion est achetée (pub) puis annulée.
- Les commandes payées bloquées sont le risque principal de SAV, de litige et de réputation avant BFCM. Les 97 sont à **vérifier une à une** (voir chantier prioritaire dans `cx_02`).
- La part de fraude (13 litiges) relève des contrôles de paiement, hors parcours client.

**Confiance : haute** sur les compteurs API ; **moyenne** sur l'interprétation des « lignes remboursées sans retour ni annulation » ; **moyenne** sur les 97 (état d'expédition non rapproché avec la réalité physique).

---

## 6. Changements prioritaires

Chaque ligne : problème · actuel · proposition · coût · délai · mesure · résultat attendu. Coûts = temps de développement estimé (non chiffré en CHF sans taux horaire fourni).

### P1 — Une seule vérité de délai, dérivée des mesures

| Champ | Contenu |
|---|---|
| Problème | 4 promesses incohérentes (5-10 / 2-5 / 3-8 / 2-12) toutes < réel (médiane 13 j.o. Standard, 10 j.o. Express). |
| Actuel | Constantes en dur dans `product-size-selection-modal.js`, badge panier, description d'expédition du checkout, FAQ, politique. |
| Proposition examinable | Calculer chaque semaine P25-P90 (60 derniers jours, par mode) et publier **une** fourchette partout via une metafield de boutique (ordre de grandeur actuel : Standard « 11 à 19 jours ouvrés » ; Express « 8 à 13 », estimé = expédition P25/P90 + ≈ 3 j.o. de transit), avec date indicative. Même texte dans mail de confirmation. |
| Coût | ≈ 1-2 jours dev (thème + metafield + job) ; texte légal à relire. |
| Délai | 1-2 semaines. |
| Mesure | Avant/après (4 semaines chacun) : contribution par session, taux de commandes annulées, litiges « non reçu », contacts par commande, remboursements « retard » ; pas de seuil de conversion seul. |
| Résultat attendu | Commandes −5 à −15 % **possible** (hypothèse, non mesurée) ; réduction annulations/litiges ; baisse du risque LCD. Gain net non garanti : voir §4.3. |
| Condition d'arrêt | Si contribution/session baisse > 10 % sur 4 semaines sans baisse des annulations ≥ 30 % → revoir. |

### P2 — Traiter le stock de commandes bloquées avant BFCM

Problème : 97 commandes payées non expédiées > 14 jours (CHF 22,6k). Actuel : pas de relance proactive détectée (flag `STOCKX_CUSTOMER_DELAY_MAIL` OFF par défaut ; état VPS non vérifié). Proposition : liste nominative interne (hors rapport), décision par commande (expédier / proposer alternative / rembourser), message individuel ; voir `cx_02`. Coût : quelques heures, **décision du dirigeant**. Mesure : nombre restant > 14 j. à J+7. Résultat : réduction directe du risque litige/avis négatif.

### P3 — Validation d'adresse du checkout

Problème : localités suisses valides refusées (ex. « Lutry/La Conversion », « Val-de-Ruz », « Gibloux », faute de frappe « Lausane ») ; 26 `DELIVERY_ERROR`, 33 `INPUT_REQUIRED` (e-mail), 38 `PAYMENT_ERROR`, 8 `INVENTORY_ERROR` en 18 jours. Les sessions mobiles avec alerte finalisent **35 % (25/71)** vs 10,9 % sans alerte (population différente : elles ont interagi avec le formulaire) → l'enjeu financier est modéré. Hypothèse : ≈ 0,3-0,5 commande/jour perdue → CHF 3-6k/an. Proposition : assouplir la validation de ville côté thème/app d'adresse, message d'erreur explicite. Coût : ≈ 0,5 jour. Mesure : alertes `DELIVERY_ERROR` / session. **Confiance : faible** sur la perte réelle.

### P4 — Choix de taille et de mode : réduire la friction

Problème : 10 % des visiteurs de fiche choisissent une taille ; modale taille + cartes express/standard ; l'Express est sélectionné automatiquement quand seul l'express est disponible (`auto_express_only`) et son prix est souvent identique au Standard (donc l'option n'apporte rien au client mais promet 2-5 j.). Proposition : ne montrer le choix de mode que si les prix/délais diffèrent ; sinon un seul délai. Test A/B `post_size_flow` mal équilibré (A = 8 sessions, B = 225) : le **corriger ou l'arrêter**, ses résultats actuels sont inutilisables. Mesure : ajout panier / fiche vue (niveau intermédiaire seulement, lecture indicative).

### P5 — Langue du parcours après achat

Problème : sessions DE ≈ aussi nombreuses à finaliser que FR, mais e-mails automatiques FR/EN uniquement (75 % EN). Proposition : détecter la langue de commande (locale du checkout) et ajouter DE ; voir `cx_02`. Coût : modeste (templates). Mesure : contacts « où est ma commande » par commande, par langue.

### P6 — Preuve sociale cohérente

La page avis annonce « 4,9★ et 589+ avis » ; Judge.me affiche 423 avis, répartition 85/8/2/1/5 % (note moyenne recalculée ≈ 4,7). Aligner l'affichage sur une source vérifiable ou citer l'agrégat réel (voir `cx_03`).

---

## 7. Maquettes / spécifications

Aucune maquette produite : la décision à prendre (P1) est un texte et une donnée, non un design. Spécification minimale P1 :
- Source unique `shop.metafields.custom.delivery_p25_p90_standard_bd` / `..._express_bd` (valeurs entières), recalculées chaque lundi par le job existant à partir de `ShopifyFulfillmentRecord`.
- Affichage identique sur fiche produit, panier, checkout (description de l'expédition), FAQ, e-mail de confirmation.
- Dates calculées en jours ouvrés suisses (pas de livraison les dimanches/jours fériés).
- Garde-fou : valeur arrondie au plus haut de 1 jour ; mise à jour manuelle possible en cas d'incident.

---

## Limites et données manquantes

- Aucun test navigateur réel (position dans liste, vitesse perçue) ; PSI indisponible (quota). Poids HTML relevé : accueil ≈ 630 kB, ≈ 66 balises `<script>`, 213 `<img>` dont 188 `loading="lazy"` ; TTFB ≈ 0,18 s (une requête, non représentatif).
- Funnel pixel : 18 jours, couverture ≈ 71 % des commandes, bots résiduels (desktop, direct).
- Aucun accès GA4/Search Console (autre périmètre) ; donc pas de comparaison avec la source officielle de trafic.
- Mapping `Express` DB ↔ mode choisi par le client **non vérifié**.
- Timeline Shopify (événements) limitée à ≈ mi-août ; état de livraison fondé sur le mail « delivered » (Swiss Post Labels) présent pour seulement 327/844 commandes expédiées de la fenêtre (les autres sont estimées).
- Barème de frais de port/seuil de gratuité non audité (pas de lecture des règles de livraison).
- Pas de panier moyen par mode ni d'élasticité prix ; contribution par commande = moyenne pilote (HT, hors pub).
- Besoin d'information du dirigeant : (1) le prix Express est-il vraiment souvent égal au Standard (règle de prix) ? (2) accès à la boîte SAV pour mesurer les contacts « où est ma commande » ; (3) état réel des 97 commandes (voir `cx_02`).
