# SEO × Ads : carte requêtes/pages, croisement payé/organique, détection de changements

Lecture seule. Source GSC : propriété `sc-domain:resell-lausanne.ch`, historique 2025-07-20 → 2026-11-10 (compte de service, scope `webmasters.readonly`).
Fenêtre requêtes/pages/Ads : 2026-08-02 → 2026-11-01 (90 j). Étiquettes : F fait, D déclaré, I interprétation, H hypothèse, R recommandation.

Scripts : `calculs/seo_01_gsc_series.mjs`, `seo_01_changements.py`, `seo_02_fenetres.mjs`, `seo_03_opportunites_ads.py`.
Tableaux : `tableaux/seo_01_*.csv`, `tableaux/seo_03_*.csv`. Exports bruts GSC non versionnés (`donnees_brutes/gsc/`).

## 0. Verdict

- F : organique = petit canal. ≈ 15,5k clics GSC sur 90 j (≈ 5,2k/mois), dont 880 clics requêtes « resell* ».
- F : gain maximal théorique à remonter les 113 requêtes hors marque en positions 4–20 jusqu'à la position 3 ≈ **+620 clics/mois** (+83 % des 2 253 clics hors marque visibles par requête, mais ≈ +12 % des 15,5k clics organiques totaux). Au CPC Ads moyen visible (0,43 CHF) = ≈ 270 CHF/mois de clics payés équivalents. I : plafond, pas objectif.
- F : cannibalisation payé/organique **faible** : 984 CHF sur 90 j (3,6 % du coût visible) sur des termes classés ≤ 3 en organique. Pas de levier à ce niveau.
- F : 94 % des fiches produits avec impressions (113,8k sur 120,9k) n'ont **aucun clic**. 7,1k fiches cliquées, médiane 1 clic.
- F : clics organiques en baisse depuis le 14 sept (−31 %), requêtes marque −60 % sur 10 semaines.
- I : le « système Semetis » (requêtes en position 6–10) existe ici mais pèse peu. Le gain tient surtout à ~15 pages collection.

## 1. Carte des pages (A)

F, 90 j : 128 202 pages avec impressions, 15 680 clics, 955 555 impressions.

| Type | Pages | Impr. | Clics | CTR |
|---|---|---|---|---|
| Fiches produit | 120 938 | 597 265 | 9 593 | 1,61 % |
| Collections | 6 982 | 313 197 | 4 217 | 1,35 % |
| Accueil / autres | 10 | 26 254 | 1 571 | 5,98 % |
| Pages (contact, FAQ…) | 207 | 16 373 | 268 | 1,64 % |
| Blogs | 65 | 2 466 | 31 | 1,26 % |

- F : concentration. Top 10 pages = 19 % des clics, top 100 = 38 %, top 1 000 = 56 %, top 5 000 = 84 %.
- F : 7 578 pages avec ≥ 1 clic ; 112 199 pages < 10 impressions et 0 clic.
- I : le long tail de 98,5k produits crée des impressions mais quasi pas de clics. Aucune preuve que la création de masse ait généré du chiffre (voir §4).

Pages collection à forte impression, CTR faible (position ≤ 12). Cibles prioritaires (title/meta/contenu/maillage, R) :

| Page | Impr. | Clics | CTR | Pos. |
|---|---|---|---|---|
| /collections/nike-air-max-plus-tn | 30 255 | 273 | 0,90 % | 8,6 |
| /collections/alo-yoga | 17 014 | 286 | 1,68 % | 6,9 |
| /collections/fear-of-god-essentials | 16 859 | 340 | 2,02 % | 6,8 |
| /collections/onitsuka-tiger | 11 833 | 174 | 1,47 % | 7,1 |
| /collections/air-jordan-x-travis-scott | 11 652 | 223 | 1,91 % | 7,1 |
| /collections/asics-gel-kayano-14 | 9 213 | 59 | 0,64 % | 8,4 |
| /collections/air-jordan-4 | 9 144 | 94 | 1,03 % | 7,5 |
| /collections/nike-air-max-95 | 6 309 | 80 | 1,27 % | 7,1 |
| /collections/nike-x-nocta | 6 261 | 53 | 0,85 % | 7,5 |
| /collections/supreme | 6 224 | 91 | 1,46 % | 7,9 |
| /collections/dunk-sb | 5 703 | 85 | 1,49 % | 8,6 |
| /de/collections/bape | 5 680 | 51 | 0,90 % | 7,7 |

## 2. Carte des requêtes (A)

F : 109 955 requêtes distinctes visibles, mais seulement 6 617 clics sur 15 525 (43 %) : GSC masque les requêtes anonymisées. Tout chiffre « requête » ne couvre que cette part.

CTR observé hors marque par position (courbe propre au site, rendue monotone, conservatrice) : pos 3 ≈ 2,5 %, pos 4 ≈ 3,0 %, pos 6 ≈ 1,9 %, pos 8 ≈ 0,9 %, pos 10 ≈ 0,55 %, pos 12 ≈ 0,4 %. Gain = impressions × (CTR pos 3 − CTR actuel).

Top requêtes hors marque, positions 4–20, ≥ 300 impressions (`tableaux/seo_03_opportunites_top.csv`, 113 lignes) :

| Requête | Impr. | Clics | Pos. | Gain clics / 90 j |
|---|---|---|---|---|
| onitsuka tiger | 7 636 | 38 | 8,0 | 152 |
| alo | 5 971 | 26 | 7,1 | 123 |
| bape | 5 599 | 20 | 6,6 | 120 |
| tn | 7 146 | 61 | 6,6 | 117 |
| air max 95 | 4 979 | 47 | 7,9 | 77 |
| supreme | 4 372 | 42 | 8,2 | 67 |
| nike tn | 3 380 | 24 | 10,3 | 60 |
| asics kayano 14 | 2 619 | 9 | 8,6 | 56 |
| yeezy | 2 606 | 12 | 9,3 | 53 |
| alo yoga | 2 926 | 21 | 6,9 | 52 |
| nocta | 2 642 | 16 | 7,6 | 50 |
| nike mind | 2 362 | 17 | 8,6 | 42 |
| golden goose | 1 951 | 10 | 9,1 | 39 |
| essentials | 4 748 | 83 | 6,6 | 35 |

- F : total 1 863 clics / 90 j (≈ 620/mois) sur 113 requêtes. Clics hors marque actuels visibles : 2 253.
- I : ce sont des requêtes génériques de marque/modèle (« bape », « tn », « supreme »). Elles se jouent sur la page collection correspondante, pas sur des fiches. Donc ≈ 12 pages à travailler (tableau §1), pas 113 chantiers.
- H : atteindre la position 3 sur des requêtes à un mot face à Nike, Zalando, StockX, Wethenew est difficile. Le gain réel sera une fraction.

## 3. Croisement GSC × Google Ads (B)

Sources : termes Shopping (2 446 lignes, 715 CHF) + PMax `campaign_search_term_view` (444 240 lignes, 26 905 CHF), jointure exacte sur le terme en minuscules. Coût visible 27 620 CHF sur 90 j, ≈ 66 % du coût total de la période (D/I : le reste est masqué par Google, termes sous seuil).

| Segment (position organique du terme) | Termes | Coût CHF | Part | Conv. | Valeur Ads | ROAS | CPA |
|---|---|---|---|---|---|---|---|
| Marque `resell*` | 182 | 1 168 | 4,2 % | 71,6 | 20 182 | 17,3 | 16 |
| Organique position ≤ 3 | 7 650 | 984 | 3,6 % | 17,3 | 4 344 | 4,4 | 57 |
| Organique 4–10 | 23 042 | 6 904 | 25,0 % | 129,0 | 21 751 | 3,15 | 54 |
| Organique > 10 | 12 568 | 4 584 | 16,6 % | 81,7 | 16 146 | 3,5 | 56 |
| Absent de GSC | 328 668 | 13 980 | 50,6 % | 233,8 | 51 466 | 3,7 | 60 |

- F : la marque est le seul segment à ROAS élevé (17,3). 1 168 CHF pour 20 182 CHF de valeur Ads. I : une part est probablement captée de toute façon en organique (position ≈ 1, 859 clics GSC). Test d'incrémentalité marque : non fait. H.
- F : segment ≤ 3 = seulement 984 CHF. La cannibalisation n'explique pas le ROAS faible. Un seul terme dépasse 20 CHF : « nike air max 90 » (30 CHF, 2 conv., organique pos 2,8 mais 0 clic GSC visible).
- F : les segments 4–10 et > 10 (11,5k CHF) ont ROAS 3,2–3,5, sous le seuil d'équilibre 4,7–5,1 (voir `ads_09`). Là, payé et organique coexistent sans que l'organique capte (2 899 clics GSC sur 15 504 clics Ads).
- F : « absent de GSC » = 50,6 % du coût. Ce n'est pas la preuve d'une absence organique : GSC masque les requêtes rares/anonymisées, et PMax expose des termes de longue traîne (328k termes, 0,04 CHF par terme en moyenne).
- F : 298 termes sans impression organique convertissent en Ads : valeur 51 457 CHF pour 867 CHF de coût (`tableaux/seo_03_ads_convertit_sans_organique.csv`). Exemples : nike scorpion max (1 007), boutique roma zurich (940), fussballschuhe (792). I : mesure de ce que les clients cherchent, utile comme liste de collections/pages à créer. Valeurs par terme : 1–2 conversions, bruit élevé.
- R : (1) Ne pas couper la marque sans test (géo ou pause 2 semaines hors BF). (2) Utiliser la liste « convertit sans organique » pour décider quelles collections créer. (3) Ne pas chercher d'économie de cannibalisation : < 1 k CHF / 90 j, plafond.

## 4. Détection de changements (C)

Méthode : ruptures par comparaison moyenne 28 j avant/après sur séries journalières GSC (`seo_01_ruptures.csv`). Seuil ±25 %. Co-occurrence ≠ causalité.

| Date | Série | Variation | Événements datés proches | Statut |
|---|---|---|---|---|
| 2025-10-28 | impressions | +79 % | non identifié | F rupture, cause inconnue |
| 2025-11-17 | impressions, clics hors marque | +81 %, +90 % | pages `/fr-fr/` apparaissent (+17–25 k impr./sem.), disparues à 0 en juil. 2026 | F co-occurrence, H cause |
| 2026-05-23 | impressions | −27 % | 5 mai : PDP style Wethenew, gating express strict (commit) | H, 18 j d'écart |
| 2026-06-17 | impressions | −30 % | rien dans le dépôt thème (trou de commits mai → 16 août) | F trou d'historique |
| 2026-07-28 | impressions, clics | +93 %, +85 % | création de masse de produits : 29k la semaine du 2 août, ~80k jusqu'au 20 sept, puis 0 | F co-occurrence, H cause |
| 2026-09-14 | impressions, clics | −31 % | 10–13 sept : vague SEO DE (title/meta, H1, histoires), refonte filtres PLP, bannière Ultimate Bundle (9 sept) | F co-occurrence, H cause |
| 2026-10-26 | position moyenne | 10,5 → 13,5 (1 semaine) | non identifié | F anomalie, retour à 10,9 la semaine suivante |

Détails de la chute du 14 sept (F, hebdo) :
- Impressions totales 80 027 → 58 658 (−27 % sur 1 semaine), puis plateau ≈ 58–60 k.
- Collections 28 373 → 20 402 (−28 %), fiches 47 798 → 40 500 (−15 %), hors marque 42 655 → 29 325 (−31 %).
- Suisse : clics 1 202 → 902. Position moyenne quasi stable (8,1–8,7 collections) : la baisse vient du volume d'impressions, pas du rang. I : plutôt demande/couverture que pénalité. H : fin de la saison de rentrée, ou désindexation partielle du long tail. Non tranché.
- Le DE a moins baissé (−18 %) que le reste. I : les modifs SEO DE ne sont pas la cause évidente (le DE baisse moins).

À noter :
- F : les dates des commits du thème ne sont pas des dates de mise en ligne. Un commit « Sync live theme … after May gap » (16 août) regroupe des changements non datés de mai à août. Pas de journal de déploiement du thème disponible.
- F : clics marque (`resell*`) 125/sem fin août → 26–79 début nov. I : intérêt de marque en baisse, à surveiller. Cause : campagne, saison ou concurrence, non établie.
- F : Ads, impressions quotidiennes 85 k → 22 k entre le 6 et le 22 sept, retour à 188 k au 30 sept. Cause inconnue, historique Merchant/Ads de plus de 30 jours indisponible. La coïncidence temporelle avec la chute GSC du 14 sept est notée sans conclusion.
- F : Ads, 8–10 nov : ROAS 3 jours 0,82, conversions Google −73 % vs commandes Shopify −32 %. À vérifier côté suivi (voir `ads_09` §2).

## 5. Limites

- GSC : requêtes anonymisées exclues, 43 % des clics visibles par requête. Export plafonné par pagination (600 k lignes, non atteint).
- Jointure Ads/GSC par terme exact : pas de lemmatisation, ni de regroupement singulier/pluriel/langues.
- Ads : PMax masque une part des termes. Valeur Ads = valeur revendiquée par Google, pas incrémentale.
- Aucun accès : historique Merchant Center, journal de déploiement du thème, log de modifications Ads > 30 j, Shopify Analytics par canal.
- Pas d'attribution des commandes à l'organique : valeur d'un clic organique non mesurée (H). Pour référence, 1,78 CHF de valeur Ads revendiquée par clic payé.

## 6. Suite proposée (R, à décider par toi)

1. Travailler titres/méta/contenu des 12 collections du §1. Mesure : CTR et position GSC à 4 et 8 semaines. Pas de modification avant le 27 nov hors accord.
2. Vérifier dans Merchant Center et Search Console (indexation des pages) la chute du 14 sept et l'anomalie du 26 oct. Dans Search Console UI : rapport « Pages » → raisons de non-indexation.
3. Collecter le journal de mise en ligne du thème (Shopify admin → Thème → historique) pour dater juin et septembre.
4. Décider du plan de réduction du catalogue indexé (94 % des fiches sans clic). Test sur un sous-ensemble avant tout noindex.
