# MEMO ADS : à relire avant toute réponse ou action sur Google Ads

Créé le 11.11.2026 à la demande du fondateur. Mettre à jour à chaque nouvelle consigne. Statut des affirmations : F = fait mesuré, D = déclaration du fondateur, I = interprétation, H = hypothèse. Pas de H présentée comme un fait.

## 1. Règles de travail imposées par le fondateur

- Faits chiffrés, pas d'hypothèses. « Les pros ne font pas ça. » Si une affirmation n'a pas de donnée, le dire.
- Ne jamais affirmer qu'une source inaccessible a été consultée.
- Production en lecture seule : aucune modification de prix, budgets, campagnes, feed, site, comptes. Le fondateur applique lui-même (D).
- Pas de navigateur ouvert sauf demande explicite.
- Ne jamais toucher aux automations StockX/GOAT (chemins d'achat de production).
- Réponses en français très court (style « caveman »). Code et commits en langage normal.
- Rien n'est vrai tant que ce n'est pas vérifié : plusieurs erreurs déjà corrigées (voir §6).
- Pas de changement de structure Ads avant le Black Friday (27.11) sans accord : on veut une mesure propre. Décision du fondateur.

## 2. Objectifs du fondateur

- Scaler Resell Lausanne autant que Galaxus (D).
- Comprendre pourquoi le ROAS Google Ads a chuté et ce qui aide ou nuit (D).
- Objectif d'Explorer à l'origine : nettoyer des campagnes où 90 % des produits ne convertissent jamais et n'ont même pas de vue, et donner une chance aux produits sans impression (D).
- Il veut pouvoir régler un groupe de produits avec « un % de dépense en plus » (D). Pas de levier natif en PMax : seulement budget et tROAS par campagne.
- Il veut le cas le plus proche possible : gros catalogue, revendeur, données chiffrées, sources moins orientées vente de service (D).
- Il veut essayer de contacter le responsable Ads de Decathlon (D). Questions préparées : voir §7.

## 3. Faits mesurés qui comptent (voir `analyses/ads_05_explorer_diagnostic.md`)

- Seuil de rentabilité en ROAS Google ≈ 3,5 à 3,9 (contribution avant pub 40,3 CHF par commande) (F).
- Dépense 2025 : 1,2 à 2,8 k par mois, ROAS 10 à 17. 2026 : 7 à 15 k par mois, ROAS 3,1 à 6,8. Conversions presque stables (mai 171, octobre 184) (F).
- De mai à octobre : +6,7 k de pub pour +1,5 k de valeur (F).
- Part d'impressions Nike 79 %, Adidas 83 %, Jordan 79 %, `all` 85 %. 0 % de budget perdu, 15 à 21 % perdus en classement (F).
- 96 % de la dépense sur des requêtes hors marque. 98 % sur le réseau Search (F).
- 77 % des conversions août à octobre viennent de produits qui n'avaient jamais converti. Un filtre sur l'historique retire donc la source des ventes (F).
- La hausse du nombre de produits avec impressions (9 k vers 16 k, semaine du 27.07) date d'avant Explorer (07.08) (F).
- [RETIRÉ, biaisé : voir ads_05 §11] Quasi-expérience Explorer (07.08 au 10.11), produits équivalents, par marque. Conversions pour 1 000 produits, restés en main contre touchés : Nike 4,9 / 0,9. Adidas 3,7 / 0,8. Jordan 3,1 / 0,3. New Balance 1,8 / 0,0. Asics 1,4 / 1,8. Explorer + Long Tail : 1 484 CHF de coût, 2 223 de valeur, ROAS 1,5 (F). Limites dans le fichier (I pour la conclusion « Explorer net négatif »).
- Étude par lot corrigée du biais de sélection (ads_08) : Explorer fait passer les produits avec impressions de 20 % à 56 %, coûte ≈ 4 fois plus par produit, conversions identiques (0,3 pour 1 000 produits sur 4 semaines, effectifs faibles). Pas de preuve qu'Explorer détruise des conversions ; pas de preuve qu'il en crée.
- Mécanisme : les produits « sous-exposés » vont dans `long_tail_all` (≈ 7 300 modèles), exclus de l'arbre main, ≈ 4 impressions chacun (F, code et tables).
- Cibles tROAS : octobre 3,79 à 4,5. Le 10.11 : budgets doublés et cible 3,6, par le compte du fondateur (F).
- Du 20.10 au 10.11 : ROAS 2,6. Du 8 au 10.11 : 0,5 à 1,1 avec 1 à 2 conversions par jour. Cause non expliquée.
- UGG : saisonnier, part d'impressions 10 %, perte de classement 85 %. Le fondateur veut couper UGG tant que les revendeurs en ont, et faire un blog et du SEO UGG (D, à décider).
- Aucune campagne New Balance n'existe. NB est dans `all` (F).
- Saisonnalité par modèles (F, regex titre/marque : UGG, boots, Timberland, puffer, fleece... ; slides, sandales, shorts...). Hiver : janvier 1 765 CHF ROAS 7,4 ; février 933 ROAS 3,6 ; mars 419 ROAS 2,2 ; avril à août 23-70 CHF par mois ; septembre 371 ROAS 1,2 ; octobre 717 ROAS 2,1. Été : juillet 707 ROAS 5,3 ; août 809 ROAS 3,6 ; septembre 485 ROAS 3,2 ; octobre 302 ROAS 2,2. Perte nette estimée sous le seuil 3,7 : ≈ 560 CHF (hiver sept.-oct.) + ≈ 200 CHF (été sept.-nov.). Levier petit en CHF. Les titres avec Noël : ≈ 25 CHF de mai à novembre.
- Retrait : « 50 000 produits Ads absents de Shopify » était un bug de script (2 sur 95 919 en réalité).

## 4. Pistes retenues (à valider par le fondateur, rien n'est appliqué)

1. Retirer Explorer et Long Tail : arrêter les campagnes `Explorer | *`, retirer les labels `long_tail_all`, `explorer_active`, `_nike/_adidas/_jordan` du feed supplémentaire. Coût estimé : ≈ 30 CHF par jour au maximum pour ≈ 9 000 produits (I). À faire après décision, pas pendant le Black Friday sans accord.
2. Exclure les termes de marque de PMax et les rediriger vers Search et Shopping (Decathlon). Chez nous, 96 % de la dépense est hors marque : à mesurer avant tout (non fait).
3. Gestion de la saisonnalité par label et exclusion hors saison. Pour Noël toute l'année : vérifier d'abord quels produits (le titre ne montre rien). Les étiquettes de saison se posent dans `custom_label_*`. La fonction « ajustement de saisonnalité » de Google ne sert pas à exclure : 1 à 7 jours, ajuste le taux de conversion.
4. Score de voisinage (marque | type | sous-type | modèle) testé : sur 7 293 produits existant au 07.08, le score ne prédit PAS les conversions (quintile bas 37 conv./1 000, haut 4,0 ; autres scores aussi non monotones). Pas utilisable en l'état. Manque probable : prix, nouveautés, effet d'exposition. Voir ads_07.
5. Mesurer l'incrémentalité (Conversion Lift par zone géographique de Google, ou un test à zones appariées) avant d'ajouter du budget. Besoin d'un budget plus élevé.
6. Vérifier le tracking (Simprosys) et les commandes Shopify du 8 au 10.11.

## 5. Sources déjà vues

- Test aléatoire de zombies (28 jours, un seul compte) : ROAS 5,55 contre 6,40 pour le groupe laissé en place ([Psyberware](https://www.psyberware.com/blog/zombie-sku-campaign-fails-the-test)).
- eBay, vraie expérience de terrain à grande échelle : les annonces sur le mot de marque n'ont aucun effet mesurable (99,5 % du trafic remplacé par l'organique). Sur le hors marque, effet seulement sur les nouveaux utilisateurs et les rares acheteurs. Les acheteurs fréquents font l'essentiel des ventes attribuées mais ne sont pas influencés. Retour sur investissement à court terme négatif ([NBER](https://www.nber.org/system/files/working_papers/w20171/w20171.pdf)).
- Optmyzr, 24 702 campagnes PMax : trop de campagnes nuit (30 conversions par mois pour fonctionner, ≈ 300 pour bien optimiser) ([étude](https://www.optmyzr.com/blog/performance-max-study/)).
- Measured, plus de 50 tests d'incrémentalité : le hors marque est plus incrémental que le brand shopping, PMax entre les deux. Un détaillant a vu Google s'attribuer 4 fois plus de conversions que causées ([Measured](https://www.measured.com/blog/how-does-googles-pmax-stack-up-against-standard-shopping/)).
- smec (vendeur de logiciel, résultats non contrôlés) : Decathlon +22 % de revenu et +52 % de ROAS (4 campagnes : marques propres haut, moyen, bas potentiel, marques tierces ; terme de marque exclu de PMax). Plus de 50 % de la valeur de Decathlon vient de produits à 1 ou 2 conversions. Karaca, River Island, Tennis Point : mêmes limites.
- Vérifié le 11.11 (texte collé par le fondateur, d'origine externe, affirmations contrôlées) : Lewis et Wong, « Incrementality Bidding and Attribution » ([arXiv 2208.12809](https://arxiv.org/abs/2208.12809)), proposition de méthode (Netflix), aucun résultat de terrain. Saremi et Subramanian, « Automated Targeted Bidding for Sponsored Ads on E-Commerce Platforms » (Marketing Science 45(3), 2026), modèle théorique sur plateformes type Amazon : l'enchère dynamique peut pousser les vendeurs à monter les prix et ne fait pas forcément monter la conversion. Lambrecht et Tucker (JMR 2013), expérience d'une agence de voyage, display : le retargeting dynamique fait en moyenne moins bien que les annonces génériques, sauf quand les préférences sont déjà précises. Sahni, Narayanan, Kalyanam (JMR 2019), BuildDirect, 230 000 visiteurs : le retargeting augmente de 14,6 % les retours sur le site en 4 semaines (mesure : retour, pas achat), 33 % de l'effet de la première semaine le premier jour. « Activity bias » vient de Lewis, Rao, Reiley (« Here, There, and Everywhere », 2011), pas de Lewis et Wong. Non vérifié : liens Google Scholar du texte collé.
- Références vérifiées le 11.11 (texte reçu du fondateur, rédigé par un autre outil, contrôlé point par point) :
  - Lewis et Wong, « Incrementality Bidding and Attribution », [arXiv 2208.12809](https://arxiv.org/abs/2208.12809) : existe. Version de 2018 écrite chez Netflix. Propose une méthode (variables instrumentales) ; le résumé ne démontre pas que « les algorithmes optimisent la probabilité plutôt que l'effet causal ».
  - « Activity bias » : vient de Lewis, Rao, Reiley, « Here, There, and Everywhere » (2011), pas de l'article Lewis et Wong.
  - Saremi et Subramanian, « Automated Targeted Bidding for Sponsored Ads on E-Commerce Platforms », Marketing Science 45(3), 2026 ([DOI](https://doi.org/10.1287/mksc.2024.0813)) : existe. Modèle théorique sur des vendeurs Amazon, pas une expérience, pas Google Ads. Résultat : l'enchère dynamique n'augmente pas forcément les conversions.
  - Lambrecht et Tucker, « When Does Retargeting Work? », JMR 2013 : existe. Expérience d'un voyagiste (77 937 personnes, 21 jours) : le retargeting dynamique fait moins bien que le générique en moyenne ; il fait aussi bien quand les préférences sont précises. Rien sur PMax.
  - Sahni, Narayanan, Kalyanam, JMR 2019 : existe. BuildDirect (230 000 visiteurs), retargeting = +14,6 % de retours sur le site (pas d'achats). 33 % de l'effet de la première semaine le premier jour. Randomisation par utilisateur via plafonds de fréquence, pas par catalogue.
- Google Ads Help : custom labels (jusqu'à 5, 24 à 48 h de délai), filtre d'inventaire par label.

## 6. Erreurs déjà faites, ne pas répéter

- 11.11 : j'ai annoncé « Explorer net négatif, ≈ 55 conversions attendues contre 7 » : biais de sélection (Explorer ne prend que des produits sans impression ni conversion avant le lot ; les non touchés incluent ceux qui ont converti avant). Corrigé dans ads_05 §11 et ads_08.
- 11.11 : j'ai appelé « produits sans historique » des produits en fait créés après le 07.08 pour 17 854 sur 30 552. Toujours vérifier l'âge du produit (Shopify createdAt).
- 11.11 : bug de script (ids numériques écrasés) avant correction : ne publier un résultat qu'après contrôle croisé SQL.

- La cible tROAS de Nike n'était pas 5 pendant 10 semaines. Elle était de 3,79 à 4,5 en octobre.
- Les changements de budget ne réinitialisent pas l'apprentissage. La règle des 20 % par étape n'est pas une règle de pro.
- Le plafond de CPC n'explique pas le faible nombre d'impressions des lots de marque.
- Pas de campagne New Balance.
- Ne pas présenter comme un fait ce qui est une lecture de données observées sans témoin.

## 7. Questions pour le responsable Ads de Decathlon

1. Combien de conversions par mois par campagne ? Quel tROAS par niveau ?
2. Produits sans historique : dans quel niveau au départ, avec quel budget et quel tROAS ?
3. Critère et fréquence de passage d'un niveau à l'autre ?
4. Répartition de la dépense entre PMax, Shopping et Search marque ?
5. Part de produits visibles, part exclue, et selon quel critère ?
6. Délai de patience avant de juger un changement de structure ?
7. Tests avec groupe témoin, ou seulement comparaisons année sur année ?
8. Mesure de la marge : ROAS Google ou marge après pub ?
9. Exclusion du terme de marque de PMax : quel effet mesuré sur les ventes totales ?
10. Pilotage de la saisonnalité : quelles règles (label, dates, automatique) ?
