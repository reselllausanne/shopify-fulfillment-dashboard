> **ERRATUM 2026-11-02 23:30 (pilote).** Les chiffres de ce fichier reposent sur une TVA de 8,1 % extraite des prix. Le dirigeant déclare le forfait TDFN 2,1 % du CA TTC (non prouvé, relevés inaccessibles). Lire : contribution avant pub **40,3 CHF/commande** (et non 28,8), ROAS global d équilibre **≈ 5,4** (et non 7,6), résultat 2026 avant rémunération **+11,9 k CHF** (et non −21,2 k). Les conclusions « la pub dépasse la contribution » deviennent « la pub marginale (≈ 42-75 CHF/commande) dépasse la contribution unitaire (40,3) ; la moyenne reste légèrement positive ». Voir `fin_00_base_financiere.md`.

# ADS-04 — Propositions : plafonds CAC/CPA/ROAS, budgets, tests et corrections

Sous-agent n°1 (BRIEF_MAITRE §7). Collecte 2026-11-02. CHF. **Aucune de ces propositions n'a été exécutée** (lecture seule). Les effets chiffrés sont des fourchettes **non additives** (les gains décrivent en grande partie les mêmes ventes) ; aucun gain n'est présenté comme acquis.
Base économique : compte de contribution du pilote (`fin_00_base_financiere.md`, `fin_05_*`) : TVA 8,1 % non récupérable, expédition + préparation 14,5 CHF/commande, frais de paiement observés/estimés, coûts d'achat estimés pour 13 % du COGS. « Contribution » = revenu net HT − COGS − frais de paiement − expédition/préparation, **avant publicité, avant frais fixes**.

## 1. Économie unitaire servant à fixer les plafonds

**Fait observé** (`ads_04_unit_economics.py`, `ads_04_marginal.py` ; tables `ads_04_caps.csv`, `ads_04_contrib_mensuel.csv`, `ads_04_contrib_par_canal.csv`, `ads_04_contrib_par_prix.csv`)

| Mesure | Janv→oct 2026 | Août→oct 2026 | Octobre |
|---|---:|---:|---:|
| Contribution avant pub par commande (pilote, après litiges) | **28,8** | 34,1 | 49,6 (dont 12,8 k de coût estimé : fragile) |
| Contribution avant pub / revenu conservé TTC | 13,2 % | 16,0 % | 19,8 % |
| Coût Google Ads | 100 855 | 42 010 | 15 306 |
| **CAC global** = coût / toutes les commandes | 35,0 | 37,4 | 44,0 |
| **CAC payé** = coût / commandes dernier clic UTM Google Ads | 75,4 | 81,3 | 105,6 |
| **Coût par conversion Google revendiquée** | 51,3 | 54,0 | 74,9 |
| Contribution par commande dernier-clic Google Ads | 25,8 | 26,0 | 36,2 |
| Contribution après pub (total période, base avant litiges 5,3 k) | −12 636 | −3 255 | +2 196 |
| **Coût par commande supplémentaire (marginal, observationnel)** | 42–75 | | |
| ROAS Google revendiqué moyen / marginal | 3,1–5,6 / 2,3–3,4 | 4,0 | 3,1 |

Détail : la contribution avant pub des commandes dernier-clic Google Ads (1 337 commandes) s'élève à 34 510 CHF, soit **34 % du coût** (100 855 CHF) ; celle de **toutes** les commandes (2 882) à 88 219 CHF (avant litiges ; 82 913 après), soit **87 %** du coût. Même si 100 % des commandes étaient attribuées à la publicité, le coût dépasse la contribution (−12,6 k) ; seul octobre est positif (+2,2 k) et il repose sur 12,8 k de coûts estimés.
Par canal de dernier clic : Google Ads 25,8 CHF/commande (12,4 % du revenu conservé), Google non cpc 35,8, direct/autre 34,5. Nouveaux clients Google Ads 24,7 vs récurrents 45,0. Rachat observé : cohorte janvier 2026 = 1,13 commande/client sur 10 mois ⇒ au plus **+6 CHF de contribution par client** (0,13 × 47) ; aucune LTV supérieure n'est démontrée.
Par panier brut (contribution/commande ; ROAS d'équilibre sur valeur brute avant remboursements) : < 100 : 14,1 (20,4 % ; 4,9) ; 100–150 : 26,1 (19,9 % ; 5,0) ; 150–200 : 19,8 (11,1 % ; 9,0) ; 200–250 : 27,3 (12,2 % ; 8,2) ; 250–300 : 40,0 (14,6 % ; 6,8) ; 300–400 : 37,8 (11,0 % ; 9,1) ; > 400 : 75,4 (10,6 % ; 9,5).

**Sensibilités du pilote** (`fin_06_sensibilites.csv`, base −21,2 k avant rémunération) : TVA d'importation récupérable **+32,6 k** (+11,3 CHF/commande ⇒ contribution ≈ 40,1) *hypothèse à prouver (documents douane)* ; expédition+préparation 10 CHF : +12,6 k ; 20 CHF : −15,4 k ; coût estimé ±20 % : ±11,6 k.

### 1.1 Plafonds dérivés

Les deux scénarios (a) *prudent* : contribution 28,8 CHF/commande ; (b) *TVA d'importation récupérable* : 40,1.

**Plafond de coût publicitaire par commande (CAC global) selon l'objectif** (frais fixes réalisés janv-oct : logiciels 325/mois, rémunération hypothèse pilote 0/3 000/6 000) :

| Objectif (après publicité) | Plafond/commande (a) | Plafond/commande (b) | Dépense mensuelle max à 374 commandes/mois (a) | (b) |
|---|---:|---:|---:|---:|
| Contribution ≥ 0, sans frais fixes | 28,8 | 40,1 | 10,8 k | 15,0 k |
| Couvrir logiciels (1,1/cmd) | 27,7 | 39,0 | 10,4 k | 14,6 k |
| Couvrir logiciels + rémunération 3 000/mois (≈ 11,5/cmd) | 17,3 | 28,6 | 6,5 k | 10,7 k |
| Couvrir logiciels + rémunération 6 000/mois (≈ 22,0/cmd) | 6,9 | 18,2 | 2,6 k | 6,8 k |

Dépense actuelle : 14,0 k/mois (août-oct), 15,3 k en octobre. Hypothèse implicite : le nombre de commandes reste à 374/mois quand la dépense change (**borne haute**, car les commandes dépendent de la dépense). Cohérence avec le pilote : son scénario « Redressement » prévoit 60,6 k de pub sur 12 mois (≈ 5 k/mois).

**Plafond de CPA par conversion revendiquée selon la part réellement incrémentale `i`** (contribution × i) :

| `i` | (a) 28,8–34,1 | (b) 40,1–45 |
|---|---:|---:|
| 100 % | 29–34 | 40–45 |
| 70 % | 20–24 | 28–32 |
| 50 % | 14–17 | 20–22 |

CPA revendiqué actuel : 51–54 (octobre 75) : **supérieur au plafond dans tous les cas**, même le plus favorable.

**tROAS d'équilibre sur valeur Google** (valeur moyenne par conversion 228,6 CHF ; = valeur / (contribution × i)) :

| `i` | (a) 28,8–34,1 | (b) 40,1–45 |
|---|---:|---:|
| 100 % | 6,7–7,9 | 5,1–5,7 |
| 70 % | 9,6–11,3 | 7,3–8,2 |
| 50 % | 13,4–15,9 | 10,2–11,4 |

tROAS réglés : 3,9–5,0 ; ROAS réalisés 3,1–4,0. Un tROAS à 3,9 vise un coût publicitaire de 25,6 % de la valeur brute pour une contribution de ~13 % : **contradictoire avec la rentabilité** dans tous les scénarios, y compris `i` = 100 % et TVA récupérable.

**CVR d'équilibre d'un clic Shopping** = CPC / plafond de CPA. À CPC 0,45 : plafond 31,5 (a, i = 100 %) ⇒ **1,43 %** ; plafond 42,5 (b) ⇒ 1,06 % ; observé en moyenne 0,8 %. Par panier brut (plafond = contribution/commande ci-dessus) : < 100 CHF : 3,2 % ; 100–150 : 1,7 % ; 150–200 : 2,3 % ; 200–250 : 1,6 % ; 250–300 : 1,1 % ; 300–400 : 1,2 % ; > 400 : 0,6 % (a, i = 100 %).

**Interprétation** : (1) la plupart des paliers de dépense actuels sont au-dessus de leur plafond marginal (42–75 CHF par commande supplémentaire contre 29–34 CHF de contribution, ou 40–45 si la TVA est récupérable) ; (2) la valeur Google (TTC brut) ne mesure ni la marge, ni les retours (7 %), ni l'incrémentalité ; (3) le tROAS n'est pas le bon levier de pilotage : atteindre un ROAS de 7 impose une dépense d'environ 3–5 k/mois (courbe observée 2025→2026 : ROAS ≈ dépense^−0,65 ; 4,5 k/mois ⇒ ROAS ≈ 6,5), soit un niveau de volume entre celui de 2025 (≈ 150 commandes/mois) et celui de 2026 (≈ 240). Confiance : moyenne (dépend de la contribution du pilote, de la TVA et du caractère observationnel du coût marginal).

**Point décisif** : la preuve de la récupération de la TVA d'importation déplace le plafond de dépense de ~10 k à ~15 k/mois. À obtenir en priorité (voir « Demandes d'information »).

## 2. Propositions

Format : état actuel → cible → problème → mécanisme → effet économique (fourchette mensuelle, contribution après pub, avant frais fixes) → prérequis → coût → budget → durée → mesure → arrêt → retour arrière. Chaque proposition est suivie de sa classification (Fait / Interprétation / Hypothèse) et de la confiance.

### P0 — Geler le pilotage des enchères et tenir un journal (gratuit, immédiat)
- **État actuel** : 15 changements de tROAS en 23 jours sur 5 PMax (Nike 3,3→3,79→4,1→4,4→3,9 ; Adidas 3,3→3,79→4,1→4,2→4,5→3,9), changements de budget fréquents (4 en octobre), via l'interface (manuel).
- **Cible** : aucun changement de tROAS pendant 28 jours ; budgets modifiés au plus une fois par semaine, un seul levier à la fois ; journal daté (campagne, ancienne/nouvelle valeur, raison).
- **Problème / mécanisme** : chaque modification de tROAS perturbe l'optimisation (documentation Google) et rend la mesure ininterprétable. *Fait* : l'historique ; *Hypothèse* : le coût d'apprentissage (non mesurable ici).
- **Effet attendu** : non chiffré (condition de lisibilité de P1–P5) ; ne pas l'inclure dans les gains.
- **Prérequis** : décision du propriétaire. **Coût** : 0. **Durée** : 28 jours. **Mesure** : nombre de modifications dans `change_event` (cible ≤ 4 sur 28 jours, toutes budgétaires, tracées). **Arrêt** : urgence (refus massif, chute de livraison). **Retour arrière** : rien à défaire.
- **Confiance** : élevée (faits), faible (effet).

### P1 — Plafonner la dépense par les budgets (palier −30 à −35 %) en gardant le tROAS gelé
- **État actuel** : budgets PMax 604,5 CHF/j (Nike 255, Adidas 102, Vetements 50, all 70, Jordan 42,5, UGG 85), dépense réelle des PMax ≈ 459 CHF/j (moyenne sur 90 j : Nike ≈ 151, Adidas ≈ 100, Vetements ≈ 85, all ≈ 59, Jordan ≈ 30 ; UGG ≈ 34 depuis le 13-sept) ; 494 CHF/j en octobre (Shopping inclus).
- **Cible (palier 1, 4 semaines)** : budget par campagne = 70 % de sa dépense moyenne sur 28 jours : Nike ≈ 105, Adidas ≈ 70, Vetements ≈ 60, all ≈ 41, Jordan ≈ 21, UGG 0 (voir P2) ; total ≈ 297 CHF/j (≈ 8,9 k/mois). À recalculer le jour J sur les 28 derniers jours.
- **Problème** : coût marginal observé 42–75 CHF par commande supplémentaire > contribution 29–34 (a) ; ROAS marginal 2,3–3,4 ; budgets non limitants (perte budgétaire d'impression 0 %), donc les budgets actuels ne contraignent rien.
- **Mécanisme** : un budget inférieur à la dépense naturelle supprime les enchères les moins rentables (marge marginale la plus faible) sans toucher au tROAS ; l'économie est certaine, la perte de commandes est incertaine et plafonnée par la courbe observée.
- **Effet économique (par mois)** : économie ≈ 4,9 k (162 CHF/j × 30 : 459 → 297). Commandes perdues : 40–115 (4,9 k / 75 à 4,9 k / 42 = 65–117 ; borne basse 40 pour tenir compte de la confusion saisonnière) × contribution 28,8–34,1 ⇒ 1,2–3,9 k. **Contribution après pub : +1,0 à +3,7 k/mois** (central ≈ +2,2 k pour 85 commandes perdues) en scénario (a) ; **−0,3 à +3,3 k** (central +1,3 k) en scénario (b) (contribution 40–45). Les commandes perdues ne sont pas additionnelles aux gains de P2 (UGG est incluse dans P1).
- **Prérequis** : P0 ; décision sur la TVA (si la récupération est prouvée, viser le palier 2 : −15 % seulement). Garde-fou saisonnier : novembre-décembre 2025 ont eu un ROAS revendiqué de 6,4–6,5 (cf. ADS-01) ; Black Friday ≈ 27-nov-2026 ⇒ revoir hebdomadairement.
- **Coût** : 0 (économie nette), travail interne ≈ 1 h. **Budget** : PMax ≈ 8,9 k/mois au lieu de ≈ 13,8 k (Shopping ≈ 0,8 k/mois en plus). **Durée** : 4 semaines + 2 semaines d'observation.
- **Mesure** : commandes Shopify non annulées par jour (toutes et dernier-clic Google Ads), coût réel, contribution par commande, vs 8 semaines précédentes ajustées du même jour de semaine. Bruit : écart-type journalier 5,4 commandes (moyenne 12,2) ⇒ sur 14 jours, détection fiable seulement d'une baisse ≥ 2,9 commandes/jour (−24 %) : **le test ne peut pas démontrer une perte modérée**, il sert à plafonner la perte maximale.
- **Critère d'arrêt** : moyenne sur 14 jours ≤ référence − 3,8 commandes/jour (≈ −31 %, perte > 115 commandes/mois-équivalent) ou contribution perdue estimée > économie ; ou ROAS marginal revendiqué des 14 derniers jours > 5 (signal que les dépenses coupées étaient rentables).
- **Retour arrière** : rétablir les budgets antérieurs (documentés dans le journal) ; pas de changement de tROAS ; retard de reprise attendu 1–2 semaines.
- **Classification** : Fait (coûts, dépense par campagne, courbe), Interprétation (le rendement marginal est inférieur au coût), Hypothèse (contribution 28,8–34,1 stable ; confusion de la courbe observationnelle). **Confiance** : moyenne.

### P2 — Mettre en pause UGG PM Feed Only
- **État actuel** : 1 714 CHF depuis le 13-sept, 7,8 conversions Google, ROAS Google 0,99 ; part d'impression 10 % (85 % de perte au rang) ; tROAS 5,0 depuis le 23-oct ; budget 85 CHF/j.
- **Cible** : pause ; produits UGG laissés dans « all » et le Shopping Long Tail.
- **Problème** : ≈ 220 CHF par conversion revendiquée, supérieur au plafond même à 100 % d'incrémentalité (29–45).
- **Mécanisme** : arrêt d'une dépense à coût par conversion 5–8× le plafond.
- **Effet** : économie ≈ 1,0 k/mois (34 CHF/j), conversions perdues ≈ 4,7/mois × 29–45 = 0,14–0,21 k ⇒ **+0,8 à +0,9 k/mois** (déjà inclus dans P1 si exécutée ensemble).
- **Prérequis** : P0. **Coût** : 0. **Durée** : immédiate ; réévaluation à 8 semaines. **Mesure** : conversions UGG (Merchant/ads_product_daily). **Arrêt** : sans objet. **Retour arrière** : réactivation (la campagne reste dans le compte).
- **Confiance** : moyenne (échantillon de 7,8 conversions ; le coût par conversion est néanmoins très au-dessus du plafond même à la borne haute).

### P3 — Marque : mesurer avant de couper
- **État actuel** : requêtes de marque 1 168 CHF/90 j (≈ 390 CHF/mois), 71,6 conv. revendiquées, ROAS 17,3 ; incluses dans PMax (pas de campagne de recherche de marque dédiée ; exclusions de marque non vérifiées).
- **Cible** : (1) récupérer les données Search Console (INACCESSIBLE ici) pour mesurer les clics organiques sur « resell lausanne » ; (2) si l'organique est en position 1 : activer l'exclusion de marque PMax et tester 4 semaines.
- **Mécanisme** : la demande de marque existe sans publicité ; payer un clic payant à la place d'un clic gratuit est un coût non incrémental.
- **Effet** : si 70 % des conversions de marque sont non incrémentales : économie 390, perte 24 × 29–45 × 30 % = 0,2–0,3 k ⇒ +0,1 à +0,2 k/mois ; si 100 % sont incrémentales : −0,3 à −0,7 k/mois (perte de 24 conv. × 29–45 = 0,7–1,1 k contre 0,39 k économisés). **Fourchette −0,7 à +0,2 k/mois** : gain faible, **priorité basse**.
- **Prérequis** : accès Search Console ; la mesure par commandes n'est pas possible (≈ 8 commandes de marque/semaine, bruit trop élevé). **Coût** : 0. **Durée** : 4 semaines. **Arrêt** : baisse de plus de 30 % des conversions de marque revendiquées par Google et du trafic direct. **Retour arrière** : retirer l'exclusion.
- **Confiance** : faible.

### P4 — Valeurs de conversion : net des retours et marge (secondaire d'abord)
- **État actuel** : valeur = total TTC de la commande à la création (brute) ; aucun ajustement des remboursements (7,1 % du brut Google Ads, 4,8 % de commandes entièrement remboursées, jusqu'à 14 % par mois) ; une seule conversion principale (Simprosys).
- **Cible** : (1) ajuster/retirer les commandes annulées ou remboursées (ajustement de conversion via Google Ads API ou import) ; (2) créer en parallèle une conversion **secondaire** « contribution estimée » (prix HT − coût − frais − expédition) alimentée côté serveur (`sgtm` prévu par le plan de tracking, jalons G3+), à comparer 8 semaines à la valeur brute avant tout passage en principale ; règle : jamais principale tant que la couverture et la fiabilité du coût (13 % estimé) ne sont pas démontrées.
- **Problème / mécanisme** : l'algorithme optimise la valeur brute, indépendante de la marge : le seuil d'équilibre varie de 4,9 (paniers < 100) à 9,5 (> 400) sur la valeur brute. Un tROAS unique sur-enchérit les paniers hauts relativement aux bas.
- **Effet économique** : **non chiffrable aujourd'hui** (effet de réallocation entre produits ; borne illustrative hypothétique : −2 % à +8 % de contribution avant pub, soit −0,25 à +1,0 k/mois). Ne pas l'inclure dans les gains.
- **Prérequis** : accès admin Simprosys/GA4, serveur de balisage, table de coûts fiable ; consentement. **Coût** : développement interne estimé 2–4 jours (non audité). **Budget** : 0 de média. **Durée** : 8–10 semaines (collecte, comparaison). **Mesure** : corrélation conversion secondaire vs contribution observée par commande ; stabilité des volumes. **Arrêt** : si la conversion secondaire dégrade la couverture de la principale. **Retour arrière** : désactiver l'action secondaire.
- **Confiance** : faible sur l'effet ; élevée sur le problème (valeur brute ≠ marge).

### P5 — Tests de structure : Shopping / PMax / Search / Explorer (puissance explicite)
**Contraintes statistiques mesurées** : CVR moyen 0,8 % ; CPC 0,45 ; ≈ 125–135 clics (≈ 57 CHF) par conversion attendue ; détecter CVR 0,8 % → 1,6 % (×2) avec puissance 80 %, risque 5 % : ≈ 3 000 clics par bras (≈ 1,3 k CHF) ; 0,8 → 1,2 % (×1,5) : ≈ 9 900 clics (≈ 4,5 k CHF) ; 0,8 % vs 1,43 % (CVR d'équilibre) : ≈ 4 400 clics par bras (≈ 2,0 k CHF). Une comparaison séquentielle sur 28 jours du nombre total de commandes détecte seulement ±33 % (écart-type 5,4/jour) ; sur les commandes dernier-clic Google Ads ±43 %.
- **T1 — Shopping manuel vs PMax sur des modèles appariés** (remplace les tests « Explorer » à 30 clics) : partager les modèles d'une marque par hachage en deux bras (PMax actuel / Shopping CPC manuel) ; ≥ 3 000 clics par bras ; budget ≈ 2,7 k pris dans la dépense existante ; durée 5–6 semaines ; mesure : coût par conversion et conversions par 100 clics par bras ; **arrêt** : un bras dépasse 1,5× le coût par conversion de l'autre après ≥ 1 500 clics chacun ou 600 CHF de perte ; retour : remettre les modèles sous PMax. Effet : non chiffré (pas d'effet sur le plafond tant que le CPA reste > plafond).
- **T2 — Explorer : jugement par groupes, pas par modèle** : la règle actuelle « ≥ 30 clics sans conversion » laisse 79 % de chances de ne voir aucune vente pour un modèle moyen ; remplacer par des groupes marque × tranche de prix de ≥ 400 clics (≈ 180 CHF) avant tout verdict ; sortir un groupe si CVR < 0,5 % après ≥ 1 500 clics, le promouvoir s'il dépasse le CVR d'équilibre de sa tranche (§1.1). **Ne pas supprimer ni protéger Explorer par principe.** Coût : interne ; budget : constant. Durée : 6–8 semaines. Effet : non chiffré.
- **T3 — Recherche (requêtes de modèle) en test** : si le propriétaire souhaite tester une campagne Search sur « marque + modèle » (CVR observé 2,06 % sur « essentials/fear of god » et 0,9 % sur « sneakers générique ») : 15–20 CHF/j, 6 semaines (≈ 0,7–0,8 k) en réduction du budget PMax, pas en plus ; **arrêt** : ≥ 400 clics avec CPA > 60 CHF ; mesure CPA, % d'impression, nouvelles requêtes ; retour : pause. Effet : incertain (−0,8 à +0,3 k) ; priorité basse.
- **T4 — Incrémentalité** (condition de toute décision de dépense supérieure à 10 k/mois) : à défaut de géo-holdout (une seule zone, Suisse) et de puissance suffisante (±33 %), vérifier l'éligibilité aux outils de test d'incrémentalité de Google (**non vérifié**) ; sinon, utiliser P1 comme test à contraste de dépense (−30 % puis +0 %) en comptant que l'effet maximum détectable (−24 %) est proche de l'effet attendu (−11 à −30 %) : résultat indicatif seulement.
- **Confiance** : élevée sur les calculs de puissance ; faible sur les effets.

### P6 — Flux et promesse (corrections à faible coût)
- **État actuel** : 22,8 % de prix différents entre langues (fr à jour, de/en retardent de ~40 h), 28 157 + 8 248 corrections automatiques de dispo/prix, 192 `price_mismatch`, 19 340 images < 500 px, 102 variantes soldées sous le coût d'inventaire dont 34 dans le top-250 clics, promesse Merchant 3–6 j ouvrés vs 10–13 réels, retour 0 CHF (Merchant) vs client (politique).
- **Cible** :
  1. Aligner la cadence de rafraîchissement des sources de et en sur fr (dépend de Simprosys, à vérifier) ; surveillance quotidienne du nombre de `price_mismatch` (cible < 50).
  2. Exclure des annonces (et fiches gratuites) toute variante dont prix HT < coût unitaire (règle exécutable côté étiquettes personnalisées/exclusions Explorer existantes) tant que la décision de liquidation n'est pas assumée explicitement.
  3. Aligner la promesse Merchant sur la réalité (standard : traitement 8–10 j ouvrés, transit 1–4 ; express : 5–7 j) et la politique de retour Merchant sur la politique publiée (frais à la charge du client ; durée 14 jours), ou l'inverse selon décision commerciale.
  4. Corriger les images < 500 px (19 340 offres refusées) et celles < haute résolution (22 601), en priorité sur les offres qui reçoivent des clics.
- **Mécanisme** : moins de refus et de désynchronisation ; plus de clics sur des offres vendables ; réduction du risque réputationnel (délai promis) ; fin de la liquidation involontaire par publicité.
- **Effet économique** : point 2 : économie ≈ 0,1–0,4 k/mois (337 CHF/90 j sur le top 250 + pertes unitaires évitées 22,8 CHF) ; points 1, 3, 4 : **non chiffrables** (impact CTR/CVR inconnu ; l'allongement de la promesse peut baisser le CTR : à tester par période, risque −X % non estimable) ; point 3 : réduit aussi les risques de litige mais **ne prouve pas** une baisse du taux de remboursement (seules 24 notes sur 311 remboursements invoquent un retard).
- **Prérequis** : accès Simprosys/Merchant en écriture (non utilisé ici) ; décision commerciale sur les soldes et sur la promesse. **Coût** : interne (heures) ; images : dépend de la source. **Durée** : 2–4 semaines. **Mesure** : `aggregateProductStatuses`, divergence fr/de/en recalculée par `ads_03_lang_consistency.py`, CTR/CVR avant-après (bruit élevé). **Arrêt** : baisse de CTR > 15 % après changement de promesse sur ≥ 5 000 clics. **Retour arrière** : restaurer l'ancien délai.
- **Confiance** : élevée sur les écarts, faible sur le gain économique hors point 2.

## 3. Récapitulatif non additif

| Proposition | Effet mensuel (contribution après pub, avant frais fixes) | Additivité |
|---|---|---|
| P0 gel | non chiffré | condition |
| P1 −30–35 % de budget | (a) +1,0 à +3,7 k (central +2,2 k) ; (b) −0,3 à +3,3 k (central +1,3 k) | contient P2 |
| P2 UGG | +0,8 à +0,9 k | inclus dans P1 |
| P3 marque | −0,7 à +0,2 k | recouvre une partie de P1 (la marque est dans PMax) |
| P4 valeurs | non chiffré | recouvre P1 |
| P5 tests | non chiffré | coût de mesure 0–2,7 k réalloués |
| P6 flux | +0,1 à +0,4 k (point 2) | indépendant |
| **Total prudent (a)** | **≈ +1,1 à +4,1 k/mois** (P1 + P6.2) ; (b) : −0,2 à +3,7 k | |

Ordre de grandeur de contexte : contribution avant pub ≈ 12,9 k/mois (août-oct), pub 14,0 k/mois ⇒ contribution après pub ≈ −1,1 k/mois ; logiciels 0,3 k/mois ; rémunération 6 k/mois (hypothèse pilote). Les propositions ramèneraient la contribution après pub vers 0 à +3 k/mois ; **elles ne rendent pas à elles seules l'activité rentable** (pilote : −21,2 k sur 10 mois avant rémunération, −81,2 k après). Le levier principal est la contribution par commande (TVA d'importation, coûts d'expédition/préparation, remboursements) et non le seul pilotage de campagne.

## 4. Ce qui n'est pas proposé (et pourquoi)

- Augmenter les budgets : IS perdu au budget 0 %, coût marginal > contribution ; pas d'argument d'exposition.
- Baisser ou monter le tROAS « au feeling » : rien ne prouve un meilleur résultat qu'un tROAS stable ; le tROAS d'équilibre (≥ 6,7 à 7,9, ou 5,1–5,7 si TVA récupérable) est hors de la portée de la dépense actuelle.
- Supprimer Explorer ou la longue traîne : les tests sont sous-dimensionnés (aucun verdict possible), pas échoués.
- Utiliser une LTV : non démontrée (+6 CHF au plus sur la cohorte de janvier).
- Dépendre du ROAS Google comme preuve de profit : il ignore marge, TVA, remboursements et incrémentalité.

## Demandes d'information réellement nécessaires

1. **TVA d'importation sur achats** (documents douane, statut TVA) — décide du plafond de dépense (10 k vs 15 k/mois).
2. Accès **Simprosys admin** (consentement, valeur, fréquence de rafraîchissement des 3 langues) et **GA4/Search Console**.
3. Coût d'achat réel des lignes à coût estimé (13 % du COGS) et statut comptable du stock propre soldé.
4. Décision commerciale sur les soldes à perte et sur la promesse de livraison.
5. Existence éventuelle d'une facture Google Ads (TVA, HT/TTC).

## Limites et données manquantes

- **Contribution** : celle du pilote (13 % de coûts estimés ; TVA non récupérable ; forfaits expédition/préparation 14,5) ; les chiffres d'octobre (49,6/commande) reposent à 23 % sur des coûts estimés.
- **Coût marginal** : comparaison de régimes de dépense, non randomisée, confondue par saisonnalité, prix, catalogue, SEO, soldes ; les intervalles 42–75 CHF sont indicatifs.
- **Incrémentalité** (`i`) : inconnue ; présentée en scénarios 50/70/100 %.
- **Réponse aux budgets de PMax** : l'effet d'un budget inférieur sur le tROAS et la répartition par campagne n'est pas observé ; la perte de commandes est bornée par la courbe historique, pas par un test.
- **Simulation temporelle** : novembre-décembre (pic Black Friday/Noël) peut inverser la rentabilité marginale (ROAS revendiqué de 6,4–6,5 en novembre-décembre 2025).
- **Puissance des tests** calculée sur un CVR de 0,8 % et un CPC de 0,45 (90 jours) ; elle change si ces valeurs changent.
- **Éligibilité aux outils d'incrémentalité de Google**, seuils de budget et recommandations de l'interface : non vérifiés (INACCESSIBLE).
- **Soldes** : le coût d'inventaire Shopify n'est pas le coût d'achat prouvé.
- Aucun chiffre de ce document ne résulte d'une écriture en production ; aucune capture d'interface Google Ads/Merchant n'a été consultée.

Scripts : `calculs/ads_04_unit_economics.py`, `ads_04_marginal.py`, `ads_03_lang_consistency.py`, `ads_03_feed_vs_shopify.py`, `ads_03_sale_scan.mjs`. Tables : `tableaux/ads_04_*.csv`.
