# Relecture indépendante de l'audit Shopify / Resell Lausanne

Relecteur sans participation aux analyses. Lecture seule (aucun script ne réécrit `tableaux/`, rien en DB/API/VPS, `.env` non lu, aucun jeton imprimé). Recalculs faits en mémoire (Python, `donnees_brutes/` + `tableaux/` + `modele_tresorerie.xlsx`). Instantané lu : `RAPPORT_FINAL.md` (23:37:48), `COUVERTURE.md` (23:39:50), `fin_01` (23:38:36) ; les fichiers ont bougé pendant la relecture. Non revérifié par moi : sources web externes (SneakerHype, droits de douane, tarifs créateurs), chiffres Google Ads/Klaviyo/Ahrefs hors ceux cités, contenu des ~10 analyses sous-agents hors points ciblés. Numéros de ligne approximatifs (±3).

## (a) Verdict global

1. **Arithmétique du compte de contribution fiable** : 25+ chiffres recalculés à l'arrondi près ; les 4 scénarios du classeur sont reproduits exactement.
2. **Conclusions plus fortes que les preuves** : « +11,9 k, couvre ses coûts et sa pub » est étiqueté **F** alors qu'il dépend de 5 hypothèses (**H**/**D**), varie de −3 k à +32 k dans les propres sensibilités, tombe à +4,3 k si les 211 lignes de stock à coût 0 sont valorisées, et la cohorte mûre ressort ≈ −0,4 k (fichier produit, non cité). Honnêtement : **résultat indiscernable de zéro**.
3. **Erreurs de cohérence réelles** : « 57,9 k estimé » (réel ≈ 37,6 k), pub d'octobre 14 440 (réel 15 306), couverture 83-96 % (réel 78,9-95,5 %), 97/93/180 commandes bloquées non réconciliées, « 84 % en crédit magasin » mal cadré, délais mesurés sur 55 % des commandes seulement.
4. **Anciens chiffres (28,8 / −21,2 k / 7,6 / −6,2)** encore dans le **corps** de `bm_*`, `ads_04`, `ETAT.md`, et ils contredisent des décisions du rapport (condition G1 Meta « aucune remplie »). Le bandeau d'erratum ne suffit pas.
5. **Brief couvert largement mais statuts RÉALISÉ trop généreux** (S4.13, S19, S20) ; omissions de risque importantes (NER/fiscal, StockX unique + automatisation par proxy, AVS/impôt sur le revenu, TVA sur acquisitions, BFCM non audité, charges fixes réelles). **Utilisable après corrections C1-C12 (§g) ; pas remettable tel quel.**

## (b) Recalculs (≥ 15 chiffres clés)

Périmètre : commandes créées 2026-01-01 → 2026-10-31 (Europe/Zurich), hors test.

| # | Chiffre | Rapport | Recalculé | Verdict |
|---|---|---|---|---|
| 1 | Commandes | 2 882 | 2 882 (2 883 avec 1 test) | OK |
| 2 | Brut TTC (total courant + remboursé) | 685 086 | 685 085,6 | OK. Autre définition `total_orig` = 697 699 (+12,6 k : 154 commandes éditées, sans remboursement) ; `cx_01` l.125 cite 698 k / 2 884 cmd → non réconcilié |
| 3 | Remboursé | 57 789 | 57 789,2 | OK |
| 4 | Conservé | 627 k | 627 296 | OK |
| 5 | Taux remboursement | 8,4 % | 8,44 % (8,28 % sur `total_orig`) | OK |
| 6 | TDFN 2,1 % | 13 174 | 13 173,2 | OK (arithmétique ; **taux D**) |
| 7 | Marge affichée dashboard | 219 150 | 621 049 (lignes appariées TTC) − 401 899 (coût) = 219 150 | OK (mais comparaison non homogène, cf. d-6) |
| 8 | Coût d'achat total | 434 738 | ≈ 434 735 | OK |
| 9 | « dont estimé » | 57 867 | **37 580** réellement dans le coût ; 20 287 sont sur 159 commandes intégralement remboursées où le coût final est ≈ 0-2 k | **ÉCART** |
| 10 | Marge brute réalisée | 179 388 (29,2 %) | 614 124 − 434 738 = 179 386 | OK |
| 11 | Frais paiement | 17 567 (SP observé 10 110) | SP observé 10 110 (1 441 transactions) ; reste 7 457 = taux **H** sur ≈ 326 k TWINT/PowerPay/PayPal/Cembra | OK / H |
| 12 | Exp + prépa | 40 481 | 2 792 × 14,5 = 40 484 (90 cmd à 0) | OK |
| 13 | Litiges | 5 305 | 5 306 (balance transactions 2026 ; **0 en avr-août**) | OK ; retard de survenue → sous-estime août-oct |
| 14 | Contribution avant pub | 116 031 ; 40,3/cmd | 116 030 ; 40,26 | OK |
| 15 | Pub Google | 100 856 ; 35,0/cmd | 100 856 ; 34,99 | OK |
| 16 | Après acquisition | +15 175 ; +5,3 | +15 175 ; +5,27 | OK |
| 17 | Avant rémunération | +11 925 | 15 175 − 3 250 = 11 925 | OK (« logiciels » = 325/mois d'outils perso/dev, pas les charges fixes de Shopify, cf. f-9) |
| 18 | Après rémunération 6 000 (H) | −48 075 | −48 075 | OK |
| 19 | ROAS global | 6,2 | 6,22 | OK |
| 20 | ROAS d'équilibre | 5,4 | 217,66 / 40,26 = 5,41 | OK |
| 21 | Pub octobre 2026 | 14 440 ; 41,5/cmd (`fin_00` l.49) | **15 306** ; **44,0**/cmd (DailyAdSpend = API Ads) | **ÉCART** : pub ×5,5 (pas 5,2) ; marginal (15 306−2 775)/(348−180) ≈ **75** (pas ≈ 70) |
| 22 | Délais : médiane 9-14 j, > 7 j : 71-96 % | idem | par mois 8,8-13,6 j et 70,6-95,5 % ✓ ; global 10,7 j, 84 % ; **mais n = 1 500 sur 2 750** commandes non intégralement remboursées (55 %), 42 % en oct. | OK sur sous-échantillon biaisé (cf. c-5) |
| 23 | Couverture rapprochement | « 83-96 %/mois » | 78,9-95,5 % (oct 78,9 ; mai 81,0 ; sept 84,2) ; 83,8 % global avec coût > 0 | **ÉCART** |
| 24 | Lignes sans coût | 324 / 87 k TTC | 318 / 85,9 k (`ETAT` : 320 / 86 k) | Écart mineur, 3 versions |
| 25 | Lignes stock à coût 0 | 211 (24,5 k) → 4,3 k | 211 (150 ESSENTIAL + 61 PHYSICAL) ✓ ; scénario J = 4 296 ✓ | OK |
| 26 | Commandes payées non expédiées | 97 / 22,6 k ; 93 / 23,4 k ; 180 / 47,6 k | 93 PAID+UNFULFILLED = 23 414 ✓ ; 180 = 47 638 ✓ ; 97 non recalculable (cx) | OK pour 93/180 ; non réconcilié (c-4) |
| 27 | Annulations avant expédition | 40 % (22,8 k) | 22 829 / 57 661 = 39,6 % | OK (fait) ; **cause non prouvée** |
| 28 | Galaxus net HT | 617 k | 617 343 (mars-oct) ; table fournisseurs = 628 123 (mars → 2 nov) | OK ; périodes mélangées (cf. c-8) |
| 29 | NER | 196 327 (1 395 lignes) | 196 327 | OK (période incl. 1-2 nov.) |
| 30 | STX | 371 k, marge 30,3 % | 371 034 ; 97,8/323,0 = 30,28 % (sur 1 718/1 991 lignes) | OK |
| 31 | Galaxus plancher / central / haut | 107 / 122-137 | plancher 107,5 ✓ ; central 122,1 ✓ ; **137 non dérivable** | **ÉCART** (haut) |
| 32 | Scénarios Excel (12 m) | cmd 3 368/3 962/4 556/3 368 ; avant rém. −56,1/+16,9/+29,3/+87,6 k | réimplémentés : identiques à l'unité près | OK |
| 33 | Seuils | 1 202 cmd/mois (35 CHF pub, 6 000) ; base 283 | 6 325/5,27 = 1 200 ✓ ; moy. fév-oct 283,1 ✓ | OK |
| 34 | « 84 % en crédit magasin » | `RAPPORT` l.29 | 84 % = part des **retours** (13,1/15,6 k) ; sur **tous** remboursements : 23 % | **ÉCART de cadrage** |
| 35 | Sensibilité « coût estimé ±20 % » | +23,5 k / +0,4 k | base réelle 37,6 k ⇒ **+19,4 k / +4,4 k** | **ÉCART** (conséquence de #9) |

**Classeur `modele_tresorerie.xlsx`** (447 formules ; Mensuel_12m, Sem_13 relues) : structure cohérente (net HT = TTC conservé × (1−2,1 %) ; coût en % du net ; TVA rajoutée au flux puis payée par semestre ; Sem_13 pondère les 3 premiers mois). Réserves : (i) **aucune valeur en cache** (cellules formules vides hors Excel/LibreOffice) ; (ii) `Comparatif` et `Stress` = valeurs figées issues de Python ; (iii) scénario **Favorable** : coût 73,5 % > Central 70,8 % ⇒ contribution 37,3 CHF/cmd **< Central 40,3** (illogique ; avec le coût Central, le résultat avant rém. serait ≈ +56 k au lieu de +29 k) ; (iv) **Redressement** cumule 4 leviers non pub sans support (panier +3 %, remboursements −2 pts, litiges ÷2, expédition −1 CHF) : voir d-1 ; (v) saisonnalité nov ×1,6 / déc ×2,5 appliquée à une base fév-oct (283), calée sur 2025 où la pub a été ×2,3 en nov et ×4,9 en déc : saisonnalité et poussée publicitaire confondues ; (vi) TDFN du S1-2026 (≈ 7,1 k, échéance fin août 2026) hors modèle : payée ? inconnu.

## (c) Contradictions et erreurs, par gravité

### Bloquant (change un verdict ou une décision)

| # | Problème | Où |
|---|---|---|
| B1 | **Résultat « +11,9 k » étiqueté F et lu comme « couvre ses coûts directs et sa pub ».** Preuves contraires dans le propre dossier : sensibilités −3,4 k (exp 20 CHF) à +32 k ; scénario J +4,3 k (le texte dit lui-même que la revente devrait porter le coût récupéré ⇒ J est la lecture cohérente avec l'hypothèse 70 %) ; `tableaux/fin_05_pnl_cohortes.csv` : cohorte mûre −0,4 k, récente −1,5 k (**non citée** ; pub de septembre comptée deux fois : 85,6 + 28,6 = 114,2 k > 100,9 k, donc lecture à corriger, mais la conclusion « ≈ 0 » reste) ; remboursements récents 5,8 % contre 9,0 % pour la cohorte mûre (ordre de grandeur : −1,5 à −3 k de contribution quand ils mûrissent, mon calcul) ; octobre (mois le plus favorable, +6,2 k) = couverture 78,9 % + 11,3 k de coût estimé + 4,3 % de remboursements. Charges fixes réelles non incluses (f-9). Donc : fait = « contribution avant pub 116 k » ; résultat = **I/H, fourchette ≈ 0 à +12 k, confiance faible-moyenne**. | `RAPPORT` l.8-9 ; `fin_00` l.30-34 ; `strat_01` l.5 |
| B2 | **« Aucune condition remplie » pour Meta/TikTok repose sur des chiffres périmés.** `bm_04` §6 G1 = « contribution après acquisition ≥ 0 sur 8 semaines, ou ROAS ≥ 7,6 », état « −6,2 CHF/cmd ». Avec les chiffres corrigés (+5,3/cmd ; 8 dernières semaines ≈ +6,5 k selon `tableau_bord_hebdo.csv`, quoique flattées), **G1 est atteinte en moyenne** : « aucune » est faux ou, au minimum, non revérifié. Le corps de `bm_04` (l.178, 195, 210) et `bm_02` l.12, 62-63, 231 (« budget 0 car −21,2 k »), `bm_05` l.167 raisonnent encore sur −21,2 k / −6,2. Le bandeau dit de « lire » 40,3 mais ne corrige pas les conclusions dérivées. | `RAPPORT` l.43 ; `strat_01` §4 ligne 5 ; `bm_04` l.172-195 |
| B3 | **« 57 867 estimé » (fin_00 cascade) est faux** : la colonne `cogs_est` additionne aussi les lignes non appariées de commandes intégralement remboursées (20,3 k) dont le coût final est ≈ 0. Réel ≈ 37,6 k (= 53,7 k × 0,7, cohérent avec « 206 lignes »). Conséquences : sensibilités ±20 % surévaluées (+19,4 k/+4,4 k au lieu de +23,5/+0,4), « plus grosse incertitude » surdimensionnée, seuil « part estimée ≤ 5 % » : part réelle 6,1 % du net (14,6 % cohorte récente). | `fin_00` l.17, 33, 70 ; `donnees_manquantes` #5 ; `bm_04` l.210 ; `fin_05_pnl_mensuel.csv` col. `cogs_dont_estime` |

### Important

| # | Problème | Où |
|---|---|---|
| I1 | **97 / 93 / 180 (/170) commandes bloquées non réconciliées**, et la décision n°1 s'appuie sur `commandes_a_verifier.csv` qui en compte **180** (dont 65 partiellement expédiées, 16 à 0 CHF, 27 de plus de 180 jours = vraisemblablement traitées hors Shopify). `cx_02` : « 42 avec achat StockX lié » ; le CSV : 73/93 « achat lié » (mais dont 16 `ESSENTIAL_STOCK`, 3 `PACKAGE_PROTECTION` : pas des achats). `ETAT` dit « réconciliées » ; elles ne le sont pas dans le rapport. | `RAPPORT` l.28 ; `strat_01` l.10, 45, 90 ; `fin_00` l.73 ; `cx_02` l.15, 85 |
| I2 | **Délais biaisés** : `ops_01` n'utilise que `ShopifyFulfillmentRecord`, que `cx_02` (l.28) juge « incomplet » et refuse d'utiliser. 1 500 commandes sur 2 750 (jan 47 %, sept 49 %, oct 42 %) ; commandes non expédiées exclues (40 % des commandes d'octobre, 16 % de septembre pas encore `FULFILLED`) ⇒ médianes/p90 **censurés à droite** (sous-estimés). Pas de n ni de limite dans `RAPPORT`. « Confiance haute » non justifiée sur le niveau (la **direction** du constat reste solide). | `RAPPORT` l.28, 63 ; `fin_00` l.73 ; `ops_01` |
| I3 | **Pub octobre / marginal** : 14 440 et 41,5 /cmd contre 15 306 et 44,0 ; ratio ×5,5 ; coût marginal ≈ 75. Le texte « 42-75 » (l.25) reste vrai mais l'ancre « ≈ 70 » et « ×5,2 » sont faux. De plus, la comparaison oct 2025 → oct 2026 prend un point bas saisonnier (pub 2,8 k ; nov 2025 6,3 k ; déc 13,6 k) : « marginal » = **observationnel confondu** (déjà noté **I**, mais cité comme **F** dans `strat_01` l.8). | `fin_00` l.49 ; `RAPPORT` l.25 ; `strat_01` l.8 |
| I4 | **« Remboursements : 84 % en crédit magasin »** (tableau §4) et « Crédit magasin comme remboursement par défaut (84 %) » (registre) : faux pris tel quel (23 % de la valeur remboursée ; 84 % des seuls retours). `cx_02` l.17 est correct, le rapport a perdu le qualificatif. Par ailleurs le passif « avoirs » n'est pas chiffré (S17.2) : 13,4 k émis en 2026 contre 6,2 k payés en `shopify_store_credit`. | `RAPPORT` l.29 ; `strat_01` l.78 |
| I5 | **Anciens chiffres hors bandeau** : `ETAT` l.57 (« résultat −28,8 k »), l.64-65 (7,6 ; 28,8 ; 6,7-7,9) ; `ads_04` l.14, 29-60, 95, 160 (tROAS 6,7-7,9) ; `bm_01` l.41 ; `bm_02` l.12, 62-63, 231 ; `bm_04` l.168-210 ; `bm_05` l.167 ; `cx_01` l.125 (30,6 CHF/cmd, 698 k, 8,3 %) ; `cx_04` l.219-227 (28 / 47 CHF, +2,8 k à 11 k). Les chiffres corrigés sont dans les bandeaux, pas dans les phrases. | cf. B2 |
| I6 | **Chiffres Galaxus étiquetés F alors qu'ils contiennent D/H** : NER (**D**, 19,6 k), TDFN (**D**), 14,6 k de lignes non appariées à 30,3 % (**H**). Borne haute 137 k non dérivable de `fin_01`. Période mélangée (617 k mars-oct ; NER/STX tirés d'une table mars → 2 nov, +10,8 k de CA ⇒ « 420,8 k » devrait être 421,0 ou 431,8). Coût Galaxus `stockxAmount` : **non vérifié s'il est « rendu »** (côté Shopify, coût = enchère + ≈ 28 CHF ; si Galaxus = enchère seule, marge 30,3 % surestimée d'≈ 20-30 pts de CA sur ≈ 1 700 lignes ⇒ jusqu'à ≈ −40 à −50 k). Aucune table « retours Galaxus » : exact, mais `SOURCES` l.39 dit « Galaxus/Decathlon uniquement » alors que `05_galaxus_costs_returns.csv` montre platform = `shopify` (86 retours, 18,5 k) et `decathlon`. | `RAPPORT` l.11 ; `fin_01` l.12-27 ; `SOURCES` l.39 |
| I7 | **NER : risque fiscal sous-évalué.** Le calcul retient « TVA ≈ 8,1 % de 19,6 k = 1,6 k » (marge). Si le CA est facturé/encaissé au nom de l'entreprise (ou si la TVA est due sur la contre-valeur totale), l'exposition porte sur **196 k** : TDFN 2,1 % ≈ 4,5 k, 8,1 % ≈ 15,9 k, + impôt sur le revenu, AVS, intérêts. Le registre dit « Garder + documenter » : formule trop douce pour un dispositif de CA redirigé à un tiers non prouvé. Non juridique : à soumettre à la fiduciaire avant toute décision. | `fin_01` l.9, 23 ; `strat_01` l.75 |
| I8 | **COUVERTURE.md surévalue** : 4.13 « RÉALISÉ — fin_00 (cohortes mature/récente) » : `fin_00` n'en parle pas (grep nul) ; 19.6 RÉALISÉ alors que « date de revue » et « capital supplémentaire autorisable » manquent ; 20.1-20.4 RÉALISÉ alors que 20.5 est PARTIEL (pas de responsable/coût/charge/dépendances/reports par horizon) ; 3.1 RÉALISÉ malgré l'écart de lecture seule (token copié) ; 5.2 RÉALISÉ : la vérification de la formule `(buy+14,5+30+e)/0,92` n'est que dans la sortie du script, **dans aucun .md** ; 17.1 « rapprochée du cash » RÉALISÉ avec ouverture = 0. | `COUVERTURE` l.4.13, 19.6, 20.x, 5.2 |
| I9 | **`SOURCES.md` périmé et contradictoire** (21:02) : StockX « NON UTILISÉ », VPS « NON UTILISÉ », Google Ads/Merchant/Klaviyo/Postmark « NON TESTÉ », alors que `RAPPORT` §2/§9 déclare ces accès utilisés, y compris copie du jeton StockX depuis le VPS. L'inventaire d'accès (S3.2, RÉALISÉ) n'est donc pas fiable. `SOURCES` ne liste pas le PDF Galaxus hors dépôt. | `SOURCES` l.12-20 ; `RAPPORT` l.14, 48-52 |
| I10 | **Seuils de preuve incohérents** : « contribution après pub ≥ 20 CHF/cmd » ⇔ pub ≤ 20,3 ⇔ ROAS ≥ 10,7, mais la règle d'accélération budgétaire est « ROAS global ≥ 5,4 » (point mort). L'alerte CAC > 40 du tableau hebdo = point mort aussi. Observé : CAC hebdo 28-56. | `RAPPORT` l.62 ; `strat_01` l.56, 105 |
| I11 | **« BFR quasi nul »** (encaissement ≈ 4 j) : vrai pour Shopify Payments seulement ; TWINT/PayPal/PowerPay/Cembra (≈ 50 % des commandes, ≈ 326 k) non observés ; le stress « réserve SP 14 j » donne un point bas à **−42,9 k** (contre −4,3 k). Les deux affirmations coexistent sans arbitrage. | `RAPPORT` l.61 ; `fin_01` l.60-62 |
| I12 | **Classement des causes** (§4) non homogène : rang 1 = pub (coût réel), rang 2 = rémunération **(H, pas une perte observée)**, rang 3 = logistique (forfait, confiance faible), rang 4 = mélange de CA remboursé (22,8 k) + litiges (9,6 k) + CA bloqué (22,6 k) : unités différentes, **doubles comptes** (annulations ⊂ remboursements §5), marge réellement perdue sur annulations ≈ 1,6 k selon `cx_02` l.138. Confiance « haute » du rang 4 : `cx_02` indique motifs d'annulation API = client 46/51 et, sur 311 notes de remboursement, 24 « retard/non expédié » seulement ; l'exemple #7179 est une annulation client en 66 s. Lien causal délai → annulation = **I**, pas F. | `RAPPORT` l.25-32 ; `cx_02` l.111, 118, 138 |
| I13 | **Mise en garde « cohortes » du modèle de trésorerie absente** : le rapport n'indique pas que 492 commandes (17 %) sont « récentes » avec remboursements 5,8 %, coût estimé 14,6 % et litiges non encore tombés. Le tableau hebdo flatte les 3 dernières semaines (remboursés 0-2,6 %, coût estimé 22-29 % ; contribution après pub +1,4 k à +3,3 k). | `tableau_bord_hebdo.csv` ; `strat_01` §1 l.3 |
| I14 | **Étiquettes F abusives (autres)** : « le tableau de bord surestime la marge d'environ 18 % » : 219 k (TTC, lignes appariées, avant remboursements/TVA) vs 179 k (net, toutes lignes, TDFN **D**, coût estimé **H**) ; rapport 179/219 = −18 % mais surestimation vs réalisé = +22 % : formulation ambiguë et comparaison non homogène (**I**, pas F). | `RAPPORT` l.10 ; `fin_00` l.30 |
| I15 | **Attribution d'avis / GEO** : « ≈ 410 avis Judge.me + Trustpilot » (`bm_02` l.225, `bm_03` l.141) laisse croire que Trustpilot a été lu ; `cx_03` l.31/92 : Trustpilot **403, note non obtenue**, 1 avis indexé. Les « réponses d'IA » de `bm_03` §4 sont des sorties de l'outil **WebSearch**, pas d'assistants IA (étiquette « Reproductible mais fragile » trompeuse, 1 exécution). | `bm_02` l.225 ; `bm_03` l.122, 141 |
| I16 | **S5 prix** : le brief exige l'audit de la formule et de l'exemple (ask 160 → 270-285 vs 299). Le résultat n'apparaît dans aucun rapport ; `fin_08_*.csv` calcule une contribution « achat réussi » (81,8 à 299) sans fuite remboursements/litiges (réel moyen 40,3) ⇒ multiplicateurs de volume (×1,39 pour 275) sous-estimés. Aucun verdict sur « baisser les prix » dans `RAPPORT_FINAL`. | `fin_00` l.58 ; `fin_08_*.csv` |

### Mineur

- `RAPPORT` l.27 / `fin_01` : « forfaits 14,05 » = moyenne effective ; le forfait codé est 14,5 (6,5 + 8,0 ; en réalité « pour commande avec ≥ 1 chaussure », `SOURCES` l.52, appliqué à 100 % des commandes).
- 7 063 vs 7 163 profils « jamais abonnés » (`RAPPORT` l.38, `strat_01` l.77 vs `cx_04` l.15) ; 8 312 profils dont 8 192 avec e-mail.
- Sensibilités `fin_00` l.33 : valeurs données en **niveaux** (+24,5 k = résultat), lisibles comme deltas.
- `ETAT` : « formules vérifiées » = réimplémentation Python, pas recalcul tableur.
- Erratum de `fin_00` : « +33 k grâce au TDFN ». En réalité −21,2 k = méthode effective **sans** déduction de TVA à l'import, hypothèse jugée irréaliste pour une entité assujettie ; avec déduction (scénario B) on retrouve +11,4 k. Le résultat dépend **moins** de la déclaration TDFN que le rapport ne le dit (mais dépend de la récupérabilité de la TVA d'import si TDFN faux).
- `donnees_manquantes` #2 « ± 33 k vs 8,1 % » : mêmes réserves.
- `SOURCES` : 2 896 commandes / « historique 2022-2025 absent » vs 6 650 via API.
- `ETAT` : « COUVERTURE 177 IDs » exact (88/77/3/1 + 8 permanents/en cours).
- Dossier de travail : `.data/stockx-token.json` local a été **remplacé** par la copie VPS (backup `.bak-audit`) : état local de l'utilisateur modifié (ignoré par git, vérifié).

Vérifiés propres : aucun e-mail/jeton dans les fichiers suivis (`tableaux/`, `analyses/`, `calculs/`) ; `donnees_brutes/` et `.venv` ignorés par git ; aucune affirmation de consultation de banque, GA4, Search Console, Gmail, Swissreg/TMview/WIPO/Zefix (les non-consultés sont listés, `registre_preuves.md`). TDFN/NER/rarement acheté/soldes sont tous marqués **D** dans `RAPPORT`, `fin_00`, `fin_01`, `strat_01`.

## (d) Conclusions trop fortes ou non étayées

| # | Conclusion | Statut dans le rapport | Problème / formulation proposée |
|---|---|---|---|
| 1 | **Redressement** : « +87,6 k avant rémunération, +15,6 k après 6 000/mois » (`RAPPORT` l.9, `fin_01` l.58) | « Potentiel », conf. faible-moyenne ; « test de leviers » | Recalcul : avec **seulement** pub 18/cmd et volume ×0,85 (unit économie Central), résultat après rémunération = **−1,0 k**. Les **+16,6 k** viennent de panier +3 %, remboursements 6,5 %, litiges ÷2, expédition 13 CHF : aucun levier chiffré derrière. Avec les 4 leviers, le point mort après rémunération est à **volume ×0,70** (−30 %) ; à ×0,65 : −5,9 k. Élasticité implicite (pub −56 % pour −15 % de commandes) ≈ 0,27 contre ≈ 0,6 observé en nov-déc 2025, **sans test d'incrémentalité** (reconnu par le rapport). À présenter comme « enveloppe non prouvée », sans chiffre de gain dans le verdict. |
| 2 | « Baisse de pub » : effet net +0,2 à +2,3 k/mois (`RAPPORT` l.36) | Hypothèse implicite | Dépend de 40-115 commandes perdues (borne basse 40 « pour tenir compte de la confusion saisonnière » = choix d'analyste) ; ordre de grandeur ≈ 0-2 k/mois contre résultat ≈ +1,2 k/mois : **effet indiscernable du bruit** ; la valeur réelle est le test, pas le gain. Le rapport le dit à moitié (« surtout réduction du risque »). |
| 3 | Stock : « le gain principal est le délai, pas le prix d'achat » ; « gain annuel 5-15 k » (`RAPPORT` l.60, `fin_01` l.40) | Gain **H** dans `fin_01`, énoncé en assertion dans `RAPPORT` | Aucune mesure que le délai fait baisser annulations/litiges/conversion (annulations surtout clients, 66 s) ; 20 modèles = 13 % des unités ⇒ couverture ≤ 13 %. Rendement « 30-45 % par rotation » = hypothèse sans historique de rotation (36 lots depuis juillet). Reformuler : « test, gain non démontré, plafond de perte 4 k ». |
| 4 | « Shopify couvre ses coûts directs et sa pub » ; « viable à petite échelle » | **I**, conf. moyenne | Cf. B1 : au mieux « non démontré, ≈ 0 ». « Viable » exige charges fixes réelles, banque, cohortes mûres. |
| 5 | « Galaxus rapporte ≈ 107-137 k » (§1 **F**) | F | **I/H** (cf. I6). « Contribution ≠ cash » : aucun impôt sur le revenu/AVS/LPP d'une raison individuelle sur ≈ 120-130 k de profit, ni provision TVA, ni réserve ; « cash libre » non calculable. |
| 6 | « Le besoin de fonds de roulement est quasi nul » (`RAPPORT` l.61) | Assertion | Cf. I11. |
| 7 | « Aucun revendeur achat-après-commande rentable et audité n'existe » (`strat_01` l.12, F) | F, conf. haute faits / faible généralisation | Absence de preuve ≠ preuve d'absence ; reformuler « non trouvé dans les sources consultées ». SneakerHype (curateur) : source non revérifiée par moi, confiance dépend d'un rapport possiblement payant. |
| 8 | Europe : « −9,2 / +29,9 CHF » (`RAPPORT` l.42) | Rapport reconnaît que `bm_05` n'est pas recalculé | À ne pas citer tant que non recalculé (écart de +11 CHF/cmd sur la contribution ; DAP vs DDP, taux de douane **tiers**). Le « pilote DE+AT » est cité comme plafonné à 60 commandes mais hors gates économiques recalculées. |
| 9 | « Le problème n'est pas le nom » (`strat_01` l.14) | I | Cohérent mais s'appuie sur « 65,5 % du trafic top-40 = marque + Essentials » (Ahrefs Lite, estimation d'outil tiers [T], pas Search Console) et `bm_02` « budget 0 car −21,2 k » (périmé). Confiance moyenne maximum. |
| 10 | Confiance globale « moyenne… faits d'exploitation solides » (`RAPPORT` l.63) | Global | Délais (I2), couverture (I-couverture), pub oct. (I3), remboursements mûrs : « solides » est trop fort ; **moyenne-faible** pour la rentabilité, **moyenne** pour les faits opérationnels. |

Points bien traités : TDFN/NER/soldes marqués D ; limites banque explicites ; scénario Redressement dit « test de leviers » ; rapports F/I/H/R présents dans §1, §4 (colonne « Confiance »), §10 (confiance globale) ; seuils d'arrêt et plafonds présents dans `strat_01` §4.

## (e) Couverture du brief S1-S22

RÉALISÉ = produit et utilisable ; PARTIEL = limite ; MANQUANT = absent du matériel. Mon jugement, qui diffère parfois de `COUVERTURE.md`.

| S | Statut | Matériel | Limite / écart |
|---|---|---|---|
| S1 Mission | RÉALISÉ | `RAPPORT` §1, §10 ; `strat_01` | Quatre regards présents mais l'angle **investisseur** est faible : pas d'énoncé « investirais-je X CHF, rendement ? » ; coût d'opportunité temps Shopify vs Galaxus non quantifié |
| S2 Contexte | PARTIEL | `fin_00`, `fin_01`, `bm_*`, `ads_*` | BFCM (>300 paires, −50 %) **non audité** (`bfcm/` non lu, bien que pivot des mois nov-déc du modèle) ; Decathlon (421 cmd, 92 k, arrêt sept.) non analysé ; registres de marques, Sàrl non présumée ✓ |
| S3 Preuve | PARTIEL | `SOURCES`, `donnees_manquantes`, `registre_preuves` | `SOURCES` périmé (I9) ; aucune source officielle AFC pour le TDFN (liste des taux par branche, éligibilité) ; fait/interprétation/hypothèse/confiance appliqués dans le rapport, pas dans les sous-analyses |
| S4 Base financière | PARTIEL (solide sur la mécanique) | `fin_00`, `fin_05..11`, `tableaux/fin_05_*` | Cohortes mûres/récentes calculées mais non exploitées (B1) ; 4.12 allocation des communs NON TRAITÉ (reconnu) ; charges fixes réelles absentes ; banque absente ; multi-colis/remplacements/remboursements fournisseurs non mesurés ; exemples (4.15) ✓ |
| S5 Prix/sourcing | PARTIEL | `fin_08`, `fin_01` §6 | 5.3 benchmark concurrent NON TRAITÉ (reconnu) ; formule non restituée dans un .md (I16) ; pas de verdict prix dans le rapport ; 5.6 sans réseau revendeurs/dépôt-vente |
| S6 Stock/Galaxus | PARTIEL | `fin_01` §2-3, §6 | 6.6 dépôt-vente NON TRAITÉ ; 6.8 Galaxus cash BLOQUÉ (reconnu) ; pilote stock ✓ (≤ 4 k, critères, sortie) ; enveloppe finançable par Galaxus **non chiffrée** ; comparaison financer Shopify / réinvestir Galaxus / réserve seulement qualitative |
| S7 Ads/feed/tracking | RÉALISÉ (sous réserve) | `ads_01..04`, `tableaux/ads_*` | Corps encore en ancienne base (I5) ; tracking sans GA4/GTM/Simprosys ; effets attendus à recalculer |
| S8 Site/parcours | PARTIEL | `cx_01` | PageSpeed 429 ; mobile non testé par achat ; A/B infaisable (reconnu) |
| S9 E-mails/SAV/réputation | PARTIEL | `cx_02`, `cx_03` | **Aucun échange réel lu** (boîte SAV, Trustpilot/Google inaccessibles) : le brief demande « lis un échantillon de vrais échanges » ; compensé par API/événements ; droits DE/AT/FR/IT/ES/NL et directive UE non lus |
| S10 E-mail marketing | RÉALISÉ | `cx_04`, `fin_07_cohortes_reachat_2026.csv` | Contribution de réachat sur ancienne base (cx_04 l.219-227) |
| S11 SEO/GEO | PARTIEL | `bm_03` | Search Console/redirections inaccessibles ; GEO = 3 essais WebSearch (I15) ; scénarios de marque comparés, mapping URL de principe |
| S12 Comparables | PARTIEL | `bm_01` | Cas, contre-exemples ✓ ; chiffres audités rares ; SneakerHype/Restocks via presse/registre non revérifiés ; panel solide < 5 cas à confirmer |
| S13 Repositionnement | PARTIEL | `bm_02`, `strat_01` §2 | Options 1-5 ✓ ; budget/capital par option sur base −21,2 k (périmé) ; marques non vérifiées (Swissreg/TMview) ; brief de marque non produit (justifié) |
| S14 UGC | PARTIEL | `bm_04` | Coûts prestataires = devis non obtenus ; conditions G1-G8 à réévaluer (B2) |
| S15 Europe | PARTIEL | `bm_05` | Chiffres non recalculés ; taux de douane/TVA via sources tierces ; origine des colis StockX inconnue ; 31 colis hors CH sans preuve d'export |
| S16 Organisation | PARTIEL | `strat_01` §3 | Aucune donnée de temps ; revue des décisions du dirigeant : liste courte (rémunération, pub, SAV…) sans le format décision → conséquence → correction → règle → qualification erreur/arbitrage/inadapté pour chacune |
| S17 Trésorerie | PARTIEL | `modele_tresorerie.xlsx`, `fin_10_*`, `fin_01` §4 | 12 mois ✓, 13 semaines ✓, 3+1 scénarios ✓, stress ✓ (stock lent et ralentissement Galaxus non simulés) ; ouverture 0 ; avoirs, dettes, taxes S1-2026, AVS/impôt, charges fixes absents ; calendriers réels (cartes, Google Ads, payouts hors SP) manquants |
| S18 Financement | PARTIEL | `fin_01` §5 | Options listées, aucune offre/conditions réelles ; dilution illustrative sans valorisation ✓ ; « levée : pas aujourd'hui » étayé ; responsabilité illimitée mentionnée dans `fin_01` seulement |
| S19 Preuves/tests/investissement | PARTIEL | `strat_01` §4, §6 ; `ads_04` | Pas de fiche 8 attributs **par levier** (problème, preuve, mécanisme, changement, gain en fourchette, coût, test, arrêt) hors Ads ; étages avec montant/condition/preuve/arrêt ✓ mais **sans date de revue ni capital supplémentaire autorisable** ni enveloppe totale ni perte maximale acceptée (#17 manquant) |
| S20 Quatre horizons | PARTIEL | `strat_01` §5 | Actions + critère de succès ✓ ; **pas** de responsable, coût, charge de travail, dépendances ni éléments reportés par horizon (COUVERTURE 20.1-20.4 RÉALISÉ à corriger) ; dates correctes (16/11, 02/01, 02/07, 02/11) |
| S21 Livrables | PARTIEL | voir ci-dessous | |
| S22 Organisation | PARTIEL | `COUVERTURE`, `ETAT` | 22.5 vérification finale « EN COURS » ; `SOURCES`/`ETAT` périmés ; 22.3 : contrôle des preuves sous-agents partiel (ancien chiffres) |

### S21 en détail

| # | Livrable | Statut | Fichier / limite |
|---|---|---|---|
| L1 | Verdict | PARTIEL | `RAPPORT` §1 : confiance donnée mais trop forte (B1) |
| L2 | Sources/manques | RÉALISÉ | `SOURCES` (périmé), `donnees_manquantes` (18 manques classés par décision) |
| L3 | Reconstitution + rapprochement commandes/achats/**encaissements** | PARTIEL | encaissements : SP seulement |
| L4 | Causes classées par impact | PARTIEL | I12 |
| L5 | Proposition Ads | RÉALISÉ | `ads_04`, `RAPPORT` §5 (à recaler) |
| L6 | Corrections site/SAV/etc. | RÉALISÉ | `cx_01..04`, §6 |
| L7 | Plan croissance | PARTIEL | fidélisation chiffrée sur ancienne base ; SEO/UGC conditionnels |
| L8 | Benchmark | PARTIEL | `bm_01` |
| L9 | Repositionnements | RÉALISÉ (à recaler) | `bm_02` |
| L10 | Marque/nom/SEO/Europe | PARTIEL | `bm_02/03/05` |
| L11 | Stock + synergies Galaxus + cash | PARTIEL | `fin_01` ; enveloppe Galaxus non chiffrée |
| L12 | Capital/financement/levée | RÉALISÉ | `fin_01` §5 |
| L13 | Prévisionnels 13 sem + 12 mois modifiables | RÉALISÉ | `modele_tresorerie.xlsx` (réserves b) |
| L14 | Organisation + revue décisions + 4 horizons | PARTIEL | S16, S20 |
| L15 | Registre + tableau hebdo + 5 décisions | RÉALISÉ | `strat_01` §7-9 |
| LF | Réponse finale | RÉALISÉ | `RAPPORT` §10 |

- **Tableau hebdomadaire** : 11 indicateurs avec définition, source et seuil (`strat_01` §9) ✓. Mais le CSV n'en matérialise que 6 (commandes, contribution, coût estimé, pub, CAC, remboursements) ; « délais », « incidents », « réachat », « stock » définis sans valeur ; « cash libre », « engagements », « Galaxus » = « à renseigner/à définir ». Seuil CAC > 40 = point mort (I10).
- **5 décisions immédiates** : les 4 attributs (possible maintenant ? preuve manquante ? risque de différer ? invalidation) sont présents pour les 5 ✓. Réserves : décision 1 pointe vers 97 commandes mais la liste en contient 180 (I1) ; décision 2 (pub −30-35 %) a un effet net ≈ bruit (d-2) ; la décision « arrêter UGG » repose sur 7,8 conversions (échantillon minuscule).
- **Réponse à la question** : les 5 volets sont traités (offre/marque ; argent et temps ; Galaxus et stock ; financement ; preuves). Elle ne chiffre pas l'engagement total (somme des étages ≈ 12-19 k hors Europe) ni le point de renoncement chiffré de Shopify (option 5) sinon « bilan à 12 mois ».
- **S19/S20** : cf. tableau (e) ; les gains ne sont donnés en fourchette calculée que pour pub et modèle de trésorerie ; pas d'addition naïve de gains ✓.

## (f) Risques et omissions

Pour un dirigeant, par ordre d'importance :

1. **Dépendance Galaxus** : août-octobre = 75 % du CA Galaxus ≈ 460 k sur 617 k ; octobre −22 % par rapport à septembre ; contrepartie unique ; délais de paiement, pénalités, retours **inconnus** ; Decathlon (92 k, avr-sept) arrêté sans analyse. Le « 13-17 k/mois » est une moyenne de mars à octobre : lire la tendance, pas la moyenne. Aucune stress test « ralentissement Galaxus » sur la capacité à financer Shopify ou la rémunération.
2. **NER / CA redirigé à un ami** : traité (I7) comme un détail de marge. À qualifier (qui facture, qui encaisse, qui déclare la TVA, qui assume litiges/retours/garanties). Rapprochement avec TDFN (le forfait suppose que le CA imposable est celui de l'entreprise).
3. **Risque fiscal global** : TDFN 2,1 % non confronté à la liste officielle AFC (taux par branche, éligibilité, durée minimale) ; TVA du S1-2026 (≈ 7,1 k) payée ? ; **impôt sur les acquisitions** (services étrangers : Google Ads 100,9 k, outils) en général non couvert par le taux forfaitaire (à confirmer fiduciaire ; ordre de grandeur jusqu'à ≈ 8 k si facturé sans TVA suisse) ; TVA/douane à l'import non séparée du coût (+ « 31 colis hors CH sans preuve d'export »).
4. **Responsabilité illimitée** (raison individuelle) : mentionnée dans `fin_01` §1 mais absente du verdict et de la réponse finale ; devrait conditionner stock pilote, UGC, Europe et tout crédit (garanties personnelles) ; passage Sàrl « avant capital externe » sans coût/délai ni effet sur Galaxus/NER.
5. **Revenu du dirigeant = bénéfice de la raison individuelle** : AVS/impôt/prévoyance non modélisés ; « rémunération 6 000 » = H sans base (DB : aucun salaire) ; « cash libre » Galaxus brut d'impôt.
6. **Dépendance StockX (88 % du CA Shopify)** : achat automatisé par session/jeton et **proxys** (exposés dans les sorties) : risque de blocage de compte, de CGU, de changement de frais/Express ; pas d'analyse de continuité (plan B fournisseur, délai de remplacement). Authenticité/garanties : non auditées.
7. **BFCM 2026** : le projet (>300 paires, −50 % vs prix de référence, « livraison 48 h ») n'est pas audité : marge à −50 %, stock immobilisé, promesse 48 h vs réel 10-13 j, pub nov-déc ×4-5. Pourtant nov-déc pèsent ≈ 29 % des commandes du scénario Central (index 1,6 + 2,5 sur 14,0).
8. **Hypothèses non testées** : élasticité volume/pub ; effet du délai sur conversion ; récupération de stock 70 % ; coût de préparation 14,5 ; frais passerelles ; saisonnalité ; réserve Shopify Payments ; durée de vie des avoirs (13 k émis).
9. **Charges fixes réelles** : « logiciels 325/mois » = outils perso/dev (Cursor, KicksDB, ChatGPT, Google One, WTB) ; absents : abonnement Shopify et apps (Judge.me, Postmark, Simprosys…), VPS/DB, domaine, comptable, assurance, loyer, comptes. Mon ordre de grandeur (**H**) : 0,5 à 1,5 k/mois, soit **5-15 k sur 10 mois**, de l'ordre du résultat « +11,9 k » entier.
10. **Avoirs/crédit magasin** : passif non chiffré ; effet sur litiges « crédit non traité » (10) ; politique 404.
11. **Risque réglementaire côté site** : « 4,9 ★ 589+ vérifiés » vs 410/4,66, « 48 h », « 20 000 références » : signalé ✓ ; non priorisé comme risque LCD/sanction (juriste).
12. **Compétitivité prix** (S5.3) non évaluée : or toute la logique « achat après commande + marge 29 % » suppose que le prix reste compétitif ; seuls des benchmarks Google Shopping (1 392 offres, `ads_03`) existent, avec relation prix/CVR non monotone.
13. **Données de maturité** : litiges « produit non reçu » arrivent à 30-120 j : août-octobre (1 123 commandes, délais les pires) n'ont pas encore leur part de litiges ; l'effet pourrait être de plusieurs k.
14. **Stock/soldes** : seulement 36 lots suivis ; « soldes = retours revendus à −30 % » **D** ; coût réel inconnu ; double comptage possible (coût récupéré 70 % à la remise + coût 0 à la revente).
15. **Gouvernance de l'audit** : jeton StockX copié et imprimé (valide jusqu'au 03-11 ~07:49 UTC), identifiants proxy et jeton Postmark dans des sorties d'outil : le rapport le dit et demande renouvellement ✓ ; le fichier local `.data/stockx-token.json` a été remplacé (backup `.bak-audit`).

## (g) Corrections concrètes recommandées

| # | Action | Fichier(s) |
|---|---|---|
| C1 | Requalifier le résultat : « contribution avant pub 116 k (F/D) ; résultat avant rémunération **≈ 0 à +12 k, non démontré** (I/H), conf. faible-moyenne » ; ajouter 4-5 lignes : cohorte mûre, scénario J (+4,3 k), charges fixes non incluses, litiges retardés. Retirer « couvre ses coûts directs et sa pub » ou le conditionner. | `RAPPORT` l.8-9 ; `fin_00` l.30 ; `strat_01` l.5 |
| C2 | Corriger « dont 57 867 estimé » → ≈ 37,6 k (+ colonne propre `cogs_est_effectif`) ; recalculer sensibilités ±20 % (+19,4 / +4,4 k) ; corriger la phrase « 57,9 k pèse » ; part estimée 6,1 % (14,6 % récente). Corriger aussi le CSV mensuel (`cogs_dont_estime`). | `fin_00` l.17, 33, 70 ; `donnees_manquantes` #5 ; `bm_04` l.210 ; `calculs/fin_05_pnl.py` |
| C3 | Remplacer pub oct. 2026 par 15 306 / 44,0 / ×5,5 / marginal ≈ 75, partout ; qualifier « marginal ≈ 42-75 » en **I**. | `fin_00` l.49 ; `RAPPORT` l.25 ; `strat_01` l.8 |
| C4 | **Purger les anciens chiffres du corps** (pas seulement bandeau) : `bm_02` l.12, 62-63, 231 ; `bm_04` §6-7, 168-210 ; `bm_05` l.167 ; `ads_04` (28,8 ; 6,7-7,9) ; `cx_01` l.125 ; `cx_04` l.219-227 ; `ETAT` l.57, 64-65. Réévaluer G1-G8 de `bm_04` avec +5,3/cmd et corriger `RAPPORT` l.43 (« aucune » → « G1 atteinte en moyenne mais fragile ; G2-G8 non remplies »). | fichiers cités |
| C5 | Réconcilier une fois 97/93/180/170 dans `fin_00` §8 (définitions, dates de coupure, statut « achat lié » excluant stock/protection), choisir **une** liste d'action (ex. 93 PAID+UNFULFILLED ≥ 14 j, hors 0 CHF) et mettre à jour `strat_01` décision 1 et horizon 1. | `fin_00` l.73 ; `strat_01` l.45, 90 ; `commandes_a_verifier.csv` |
| C6 | Délais : indiquer n et couverture par mois ; mesurer sur toutes les commandes (non expédiées = censurées, âge actuel) ; supprimer « confiance haute » du niveau ; préciser limites de `ShopifyFulfillmentRecord`. | `RAPPORT` l.28, 63 ; `fin_00` l.73 |
| C7 | Rétablir « 84 % des **retours** (23 % de la valeur remboursée) » ; chiffrer le passif avoirs (émis − utilisés). | `RAPPORT` l.29 ; `strat_01` l.78 |
| C8 | Galaxus : passer en **I/D/H**, détailler la borne 137 k ou l'enlever, unifier la période (mars-oct) pour NER/STX, vérifier si `stockxAmount` est rendu (comparer à la tarification Shopify = enchère + ≈ 28), ajouter impôt/AVS/provisions comme « cash non disponible », exposition fiscale NER sur 196 k, tendance sept-oct. | `RAPPORT` l.11 ; `fin_01` §1-2 |
| C9 | Redressement : sortir du verdict §1 ; publier une décomposition (pub/volume seul : −1,0 k ; + leviers non pub : +16,6 k ; point mort à volume ×0,70) ; corriger le Favorable (coût ≤ Central) ; recalculer et sauvegarder des valeurs en cache (LibreOffice). | `RAPPORT` l.9 ; `fin_01` l.58 ; `fin_10_modele_tresorerie.py` |
| C10 | Harmoniser les seuils d'accélération : si « ≥ 20 CHF après pub », alors CAC ≤ 20 ⇒ ROAS ≥ 10,7 ; ou baisser l'exigence ; aligner l'alerte CAC (> 40 = point mort) ; cohortes **mûres seulement** pour juger. | `RAPPORT` l.62 ; `strat_01` l.50-56, 105 |
| C11 | Mettre `SOURCES.md`, `COUVERTURE.md` (4.13, 5.2, 19.6, 20.1-20.4, 3.1, 17.1) et `ETAT.md` d'accord avec la réalité ; consigner dans `SOURCES` l'usage VPS/StockX/Ads/Klaviyo/Postmark et le PDF Galaxus. | trois fichiers |
| C12 | Ajouter au rapport (court) : charges fixes réelles manquantes (estimation H), TDFN contre liste AFC officielle (source à citer), impôt sur les acquisitions, TVA S1-2026, BFCM non audité, dépendance StockX/proxys, responsabilité illimitée dans le verdict et §10, tendance Galaxus, passif avoirs. Retirer « Trustpilot » des 410 avis ; renommer le test GEO « résultats WebSearch ». | `RAPPORT` §9-10 ; `bm_02` l.225 ; `bm_03` l.122, 141 |
| C13 | (optionnel) Déposer la vérification de la formule de prix (`fin_08_price_formula.py`) en .md avec verdict sur la baisse de prix et recalculer `fin_08` avec fuite remboursements/litiges. | `fin_00` §5 ou nouveau §, `fin_08_*.csv` |
