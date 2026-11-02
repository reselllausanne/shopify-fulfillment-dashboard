# bm_03 — SEO, GEO et scénarios marque / domaine

Sous-agent n°3 — mandat BRIEF_MAITRE §11. Date de consultation de toutes les sources : **2026-11-02**. Lecture seule, aucun tiers contacté, aucun achat, rien modifié.

Légende des preuves : **[I]** donnée interne (API Shopify / base) · **[W]** constat sur le site public (navigateur réel, lecture) · **[T]** estimation d'outil tiers (Ahrefs Lite, **pas** Search Console) · **[O]** source officielle · **[H]** hypothèse.

## 0. Verdict en 8 lignes

1. Le SEO pèse peu aujourd'hui dans les commandes : 8 à 31 % des commandes mensuelles taguées « SEO » (2026-09 : 20,1 % ; 2026-10 : 14,2 %, 49 commandes) **[I]**. Le canal dominant n'est pas le SEO.
2. L'autorité du domaine est faible : Domain Rating **6**, 525 domaines référents actifs, 924 backlinks actifs (Ahrefs, 2026-11-01) **[T]**. Le capital SEO « à perdre » en cas de changement de domaine est limité ; le capital **confiance / avis / bouche-à-oreille** est plus difficile à mesurer et probablement plus important.
3. Le trafic organique estimé est très concentré : sur le top-40 mots-clés CH, requête de marque « resell lausanne » 17,9 % + cluster « Essentials » (stock propre) 47,6 % = **65,5 %** du trafic estimé **[T]**. Changer de nom attaque directement le premier bloc.
4. Le catalogue public a explosé : 98 521 produits Shopify, dont ~80 000 créés entre juillet et septembre 2026 **[I]**. Ahrefs estime le trafic organique (tous pays) à 774 en 2026-09 → 3 281 en 2026-10 → 7 238 en 2026-11 (mois en cours) **[T]**. Corrélation observée, causalité **non démontrée** et conversion de ce trafic **non démontrée**.
5. Plusieurs incohérences techniques/éditoriales vérifiées sur le site public (§2) : URL de politique de retour déclarée en schéma = **404** ; `/it` = **404** alors que l'italien est déclaré ; revendication « 20 000 références » vs 98 521 produits ; schéma Product sans GTIN ni `aggregateRating` malgré « 423 avis » affichés ; promesses de livraison contradictoires.
6. Aucun scénario de changement de marque/domaine ne garantit de conserver le SEO. Google : fluctuation de classement temporaire attendue, plusieurs semaines ou plus pour un site moyen, « plus longtemps » pour un grand site **[O]**. Ici ≈ 294 000 URL produit dans les sitemaps (3 langues) → site « grand ».
7. Ordre de grandeur (hypothèses de baisse, pas des prévisions) : la contribution SEO perdue en cas de migration serait de **0,8 k à 10 k CHF** selon scénario léger/sévère (§5.3). C'est petit face au risque de confiance/avis et au coût de travail. Le SEO n'est donc **pas** un argument de poids pour ni contre un renommage ; les autres critères (bm_02) décident.
8. GEO (visibilité dans les réponses d'IA) : 8 à 10 commandes/mois attribuées à des IA en 2026-08..10 (≈ 2–3 % des commandes) **[I]** ; 3 tests ponctuels non reproductibles montrent que le site est cité mais pas en tête (§4). Le reste est hypothèse.

---

## 1. Périmètre, accès et méthode

| Source | Statut | Remarque |
|---|---|---|
| Shopify Admin API (thèmes, marchés, comptes) | OK lecture | `urlRedirectsCount` = ACCESS_DENIED (scope `read_online_store_navigation` absent) → **inventaire des redirections impossible** |
| Ahrefs MCP (plan Lite) | OK partiel | historique métriques, mots-clés, concurrents, DR/backlinks OK ; `site-explorer-top-pages` = « Insufficient permissions » |
| Google Search Console | **INACCESSIBLE** | impressions/clics/positions réels/indexation réelle inconnus |
| GA4 | **INACCESSIBLE** | |
| Site public, requêtes scriptées (curl/Python) | **KO** | page « Verifying your connection » + HTTP 429 depuis cette IP ; crawl abandonné ; les fichiers `donnees_brutes/seo/pages*/` sont des pages-défi/429, **pas** une preuve |
| Site public, `fetch()` même origine depuis un navigateur réel | OK | utilisé pour tous les constats [W] ci-dessous, rythme ≥ 2,5 s entre requêtes, GET uniquement |
| Sitemaps (`sitemap.xml` et enfants) | OK | 310 sous-sitemaps : 99 produits × 3 langues (fr/de/en) + collections/pages/blogs/articles |
| RDAP (registres de noms de domaine) | OK partiel | voir bm_02 §5 |

Scripts / tableaux : `calculs/bm_seo_01_sitemap.py`, `bm_seo_03_ahrefs.py` ; `tableaux/bm_seo_sitemap_*.csv`, `bm_seo_pages_sample.csv`, `bm_seo_ahrefs_*.csv`, `bm_seo_migration_risque_ordre_grandeur.csv`.

Observation en soi : la protection anti-bot de la boutique bloque aussi des clients scriptés. Cela peut gêner des outils d'audit SEO tiers et, selon sa configuration, des robots légitimes. **[H]** — à vérifier avec les journaux (non accessibles).

---

## 2. État du site public (constats vérifiés le 2026-11-02)

Détail par URL : `tableaux/bm_seo_pages_sample.csv`.

### 2.1 Ce qui est correct

- Accueil FR/DE/EN : 200, auto-canonicals, **4 entrées hreflang** (x-default, fr, de, en), chacune cohérente **[W]**.
- Pages inexistantes (collection/produit factices) : vrai **404** (pas de soft-404) **[W]**.
- `/collections/all` et `/search` : `noindex,follow` **[W]**. Pagination : canonical conserve `?page=2` et supprime `sort_by` ; filtre `filter.v.availability` canonicalisé vers la collection de base **[W]**.
- `robots.txt` : exclut `sort_by`, filtres multiples, panier, compte, checkout ; déclare `Sitemap: …/sitemap.xml` **[W]**. (`Disallow: /policies/` — valeur par défaut Shopify ; les politiques doivent donc vivre sous `/pages/`.)
- Structure : 1 H1 par page testée ; TTFB ≈ 190 ms ; chargement ≈ 1,4 s sur une mesure unique en navigateur (cache chaud probable → **pas** un test de performance fiable) **[W]**.
- Données structurées présentes : Organization, LocalBusiness (adresse Bussigny, horaires), WebSite, BreadcrumbList, ItemList, FAQPage (collection DE), AboutPage, MerchantReturnPolicy, Product (avec `shippingDetails` et `hasMerchantReturnPolicy`) **[W]**.
- Fichiers « agentiques » exposés : `/llms.txt` et `/agents.md` (même contenu, générés Shopify), `/.well-known/ucp` (UCP version 2026-08-25, endpoint MCP) **[W]**.

### 2.2 Anomalies

| # | Fait observé [W] | Interprétation | Confiance |
|---|---|---|---|
| A1 | `returnPolicyUrl` du schéma MerchantReturnPolicy = `/pages/politique-de-retour` → **404**. Le pied de page pointe vers `/pages/faq?category=echanges-et-retours` et `/pages/demande-retour`. | Schéma qui référence une page absente : mauvais signal pour Merchant Center / résultats enrichis (politique de retour non vérifiable). Correction triviale, sans lien avec un renommage. | Haute (constat) / Moyenne (impact réel) |
| A2 | `/it` → 404 ; canonical de la page 404 = `/404` ; Markets liste `it` comme locale de la Suisse ; Organization JSON-LD déclare l'italien + `areaServed` CH, FR, DE, IT, BE, NL, AT. | Promesse d'italien non tenue côté URL ; le Tessin / marché italien n'est de fait pas servi par une URL indexable. Les sitemaps n'ont que fr/de/en. | Haute |
| A3 | `/Sneakers/Nike` → 404 ; Ahrefs (2026-10-15) le liste comme meilleure URL pour « nike mind » (position 17, volume 2 000). | Probable ancien chemin perdu sans redirection (héritage d'un ancien thème/structure). Données Ahrefs possiblement antérieures à la suppression : **à vérifier** avec la liste de redirections (inaccessible). Part du top-40 : 0,7 % seulement. | Moyenne |
| A4 | Texte public « Plus de **20 000 références** » (og:description, Organization, LocalBusiness) vs **98 521** produits Shopify, ~294 000 URL produit dans les sitemaps. | Incohérence. Soit chiffre périmé, soit le catalogue étendu (~80 000 créés Jul–Sep 2026) n'est pas assumé publiquement. Affecte la confiance et l'exactitude d'une allégation commerciale. | Haute |
| A5 | Produit : Product JSON-LD avec SKU/MPN, prix 208 CHF, `InStock`, mais **ni GTIN ni `aggregateRating`**, alors que la page affiche « 423 avis ». | Perte des étoiles potentielles en résultats enrichis ; Google exige des avis visibles et conformes pour `aggregateRating`. Mais voir bm_04 : le chiffre affiché ne correspond pas aux avis vérifiables (Judge.me 410 avis ≈ 4,66). Ne **pas** ajouter un schéma d'avis tant que le chiffre n'est pas cohérent. | Moyenne |
| A6 | Contradictions de livraison : accueil « Livraison 48H » ; fiche produit « standard 5–10 jours ouvrés » ; délai réel médian ≈ 13 jours ouvrés (cx_01..03, fin_00) ; « gratuite en Suisse dès 50 CHF, forfait 10 CHF Europe » vs ≈ 31 CHF effectivement facturés aux commandes hors CH [I] ; page DE : « Kostenloser Versand für alle Bestellungen ». | Promesses incohérentes entre langues et avec la réalité : risque de plainte, de désaccord avec les données Merchant Center, et mention trompeuse. À aligner **avant** tout lancement Meta ou Europe (bm_04, bm_05). | Haute |
| A7 | Pages de collection FR/DE/EN : résidus de langue (« Filtres » en FR sur page DE ; valeurs de filtre mélangées female/male/männlich/weiblich/unisex ; « Galaxus — ouvrir la recherche partenaire » en français sur page DE) ; 13/52 puis 18/48 images sans attribut alt sur les pages testées. | Qualité de localisation perfectible ; doublons de facettes. Impact SEO modeste, impact confiance non mesuré. | Moyenne |
| A8 | Titres d'accueil de ton et de langue différents : FR « Sneakers & Streetwear authentiques Suisse » ; DE « Verkauf von Turnschuhen - Lausanne CH » ; EN « Sneakers sale - Lausanne CH ». | Titres DE/EN semblent des traductions littérales d'un mot-clé local (« sneakers sale Lausanne ») qui évoquent des soldes ; cohérence de positionnement faible. | Moyenne |
| A9 | Site vendant en CH via Markets : marchés « Europe » (DE, ES, NL, IT, AT, EUR) et « France » (EUR) existent sans présence web propre ; pas d'URL par pays. | L'Europe est vendue sur la même URL qu'en CH ; hreflang reste par langue, pas par pays. Pas de problème SEO en soi mais aucune base pour un SEO par pays (bm_05). | Haute |

### 2.3 Historique du thème (API)

- 18 thèmes ; thème principal « fullstack-2-3-1 », créé 2026-04-30, modifié 2026-11-02 **[I]**.
- Lignée précédente « theme ok 11.09.23 » (2023–24), « BCFM_2025 », « theme a jours 30.12.25 / 07.03.26 » ; branches/tests : « resell-lausanne.ch/feat/wethenew-layout-v1 » (2026-06-01), « live + AB PDP 14.10 », « Baymard UX v1 A/B » (2026-10-30) ; un thème de développement créé le 2026-10-31 **[I]**.
- **Fait** : le thème principal a été remplacé le 2026-04-30 ; Ahrefs montre le trafic organique estimé passer de 797 (2026-04) à 1 162 (2026-05) puis 622 (2026-06) **[T]**. **Interprétation** : le remplacement de thème n'a pas laissé de trace négative nette dans l'estimation, mais le bruit mensuel (±50 %) empêche toute conclusion. **Confiance** : faible.
- **Recommandation** (mécanisme : isoler les causes) : ne pas empiler renommage/migration de domaine et refonte de thème/tests A/B dans la même fenêtre — Google conseille de changer « une chose à la fois » **[O]**. Les tests UX en cours (30–31 oct.) vont dans la période Black Friday ; les arbitrer est l'objet de l'analyse d'expérience (agent cx), pas de celle-ci.

---

## 3. Demande, concurrence, suivi : décomposer la cause

Question : le SEO est-il limité par la technique, la demande, la concurrence ou le suivi ?

| Facteur | Fait | Lecture | Confiance |
|---|---|---|---|
| **Technique** | Site propre sur l'indexation de base (§2.1) ; défauts A1–A9 réels mais correctibles | Pas le facteur limitant principal. Mais A1/A4/A5/A6 touchent la fiabilité perçue | Moyenne |
| **Demande** | Top-40 CH : 1 337 visites/mois estimées. « resell lausanne » : volume 700. « essentials hoodie » : volume 1 400, position 1. Modèle « à la demande » : le catalogue 98 521 produits est surtout composé d'articles non détenus (StockX Express) | La demande de marque et de niche (Essentials, stock propre à marge élevée) tire le SEO. La demande générique « nike mind » etc. est servie par un catalogue étendu en position ~17+ | Moyenne |
| **Concurrence** | Concurrents déjà établis : SN Zürich, YLB Concept, Footshop, Newsole, Newcop, Hypedstuff (voir bm_01) | Fiche produit identique à n'importe quel revendeur ; catalogue de 99 pages produit × 3 langues sans contenu différenciant. Probablement duplicata sémantique entre articles « à la demande » et ceux de la concurrence **[H]** | Faible |
| **Suivi** | GSC et GA4 inaccessibles ; tags d'attribution « SEO » dans les commandes basés sur le référent, non audités ; « Google non tagué SEO » = 45,4 % des commandes de première visite — probablement publicitaire ou autre, **à confirmer avec l'agent publicité** | On ne peut pas mesurer les requêtes/impressions réelles ; Ahrefs Lite est une estimation | Faible |

**Concentration (Ahrefs, 2026-10-15, top-40 CH, 1 337 visites estimées)** — `tableaux/bm_seo_ahrefs_concentration.csv` :

| Bloc | Trafic estimé | Part |
|---|---|---|
| Requête de marque « resell lausanne » | 239 | 17,9 % |
| Cluster Essentials (Fear of God, stock propre) | 636 | 47,6 % |
| URL de départ = accueil | 121 | 9,1 % |
| URL FR / DE / EN | 829 / 456 / 52 | 62,0 / 34,1 / 3,9 % |

**Fait observé** : deux blocs = 65,5 % du trafic estimé ; la langue allemande apporte 34 % du trafic estimé et 32,9 % des commandes (langue de première page d'atterrissage, 12 mois) alors que la couche DE est la moins soignée (A7, A8). **Interprétation** : investir la qualité DE (titres, facettes, contenu) a une logique plus forte qu'ouvrir l'italien, dont l'URL n'existe pas. **Hypothèse** : une partie du trafic DE vient de Suisse alémanique et correspond à la cible naturelle d'une offre DACH. **Confiance** : moyenne-faible (estimations d'outil).

**Autorité (Ahrefs 2026-11-01)** `tableaux/bm_seo_ahrefs_authority.csv` : DR 6 ; 924 backlinks actifs (1 543 cumulés) ; 525 domaines référents actifs (825 cumulés) **[T]**. **Interprétation** : le profil de liens est modeste ; les 300 domaines référents perdus depuis l'origine montrent un historique de liens instable. Ni la valeur ni la qualité de ces liens n'ont été analysées (outil non accessible : `site-explorer-referring-domains` n'a pas été exploité) — **à faire** avant toute décision de domaine.

**Tendance (Ahrefs, trafic organique estimé, tous pays)** :

| Mois | 2025-05 | 2025-10 | 2026-01 | 2026-05 | 2026-08 | 2026-09 | 2026-10 | 2026-11 (en cours) |
|---|---|---|---|---|---|---|---|---|
| Visites estimées | 353 | 160 | 386 | 1 162 | 697 | 774 | 3 281 | 7 238 |

Création de produits (API) : 2026-07 : 21 264 ; 2026-08 : 32 442 ; 2026-09 : 26 336 ; en 2025, de quelques centaines à ~4 500 par mois **[I]**.

- **Fait** : l'estimation de trafic est multipliée par ~4 d'un mois à l'autre (sept→oct) puis ×2 (oct→nov partiel), après l'ajout de ~80 000 produits.
- **Interprétation** : le catalogue étendu génère des positions indexées (surtout longue traîne). **Hypothèse** : ce trafic convertit mal (articles sans stock, non différenciés). Les commandes taguées SEO ne progressent pas dans les mêmes proportions : 67 (2026-09) → 49 (2026-10) **[I]**. **Confiance** : moyenne — tant que GSC est inaccessible, le trafic et la conversion SEO réels restent inconnus.
- **Recommandation** : ne pas décider d'un renommage sur la base de ces courbes ; obtenir l'export GSC (requêtes, pages, indexation) avant (voir §6).

---

## 4. GEO — visibilité dans les réponses d'IA

Classement par niveau de preuve.

| Niveau | Élément | Source |
|---|---|---|
| **Documenté (interne)** | Commandes de première visite par ChatGPT : 1,3 % ; commandes tagées « IA » par mois : 8 (2026-08), 10 (2026-09), 9 (2026-10) ≈ 1,9 % à 3,0 % des commandes (8/431, 10/333, 9/346) — cumul historique ≈ 31 + 6 commandes de première visite ChatGPT | [I] `bm_data_01_mix.py`, `tableaux/bm_mix_*.csv` ; attribution par référent, non auditée |
| **Documenté (public)** | Le site publie `/llms.txt`, `/agents.md`, `/.well-known/ucp` (UCP 2026-08-25, MCP) : fichiers générés par Shopify pour agents d'achat | [W] 2026-11-02 |
| **Reproductible mais fragile** | Test « où acheter sneakers authentiques Suisse Jordan 4 » → SN Zürich recommandé en premier, deux pages Resell Lausanne citées ; « StockX alternative Switzerland » → YLB Concept en premier, Resell Lausanne décrit avec « 48-hour delivery » ; « Resell Lausanne avis » → la page « 589+ avis / 4,9 » du site, Trustpilot et Gridinsoft (79/100) | [W] WebSearch 2026-11-02, une exécution chacun, **non reproductible** (réponses variables) |
| **Hypothèse** | Les réponses d'IA reprennent la promesse « 48 h » / « 4,9 » du site ; une promesse inexacte sera donc amplifiée (réclamations) ; être cité n'implique pas être acheté | [H] |

**Interprétation** : la visibilité IA existe mais elle est secondaire en volume (~2–3 % des commandes). Elle dépend en partie des affirmations du site (A4, A6, avis 4,9 vs 4,66) : corriger l'exactitude améliore le GEO sans coût. Changer de nom ferait repartir de zéro les citations de marque (réponse « Resell Lausanne avis »).
**Recommandation** (mécanisme : réduire le risque de réclamation et la divergence entre promesse IA et réalité) : fixer des affirmations publiques vérifiables (délai réel, avis exacts, catalogue exact) ; protocole GEO reproductible = 15–20 requêtes fixes × 3 moteurs × 3 passages sur 4 semaines, noter la présence/citation/exactitude (coût : ~3 h/semaine, **hypothèse**). **Confiance** : faible (3 essais isolés).

---

## 5. Scénarios marque / domaine

Rappel du mandat : ceci n'est ni un avis juridique ni une recommandation de renommer ; le nom n'est jamais la première réponse à un problème de sourcing, de prix, de marge ou de service (voir bm_02 §6).

### 5.1 Les quatre scénarios

| | **S1 — Statu quo** | **S2 — Nouvelle marque visible, même domaine** | **S3 — Nouveau nom + nouveau domaine, 301 complètes** | **S4 — Double marque / double domaine** |
|---|---|---|---|---|
| Description | Garder « Resell Lausanne » et resell-lausanne.ch ; corriger les anomalies A1–A9 | Changer nom/logo/textes ; garder l'URL resell-lausanne.ch (le nom ne figure plus que dans l'URL et la raison sociale) | Nouveau domaine ; redirections 301 serveur de toutes les URL (3 langues) ; Change of Address ; migration progressive possible | Garder .ch pour la Suisse ; créer une marque/domaine séparé (p. ex. Europe ou segment premium/collectibles) |
| Signal SEO perdu | Aucun | Requête de marque (17,9 % du top-40) à reconstruire ; incohérence marque/URL | Marque + toutes les positions durant la transition ; liens externes à transférer | Limité au nouveau site (part d'audience neuve) ; risque de cannibalisation/duplication |
| Risque technique | Faible | Moyen : titres, schéma, contenus, avis | **Élevé** : ≈ 294 000 URL produit + collections + pages dans 3 langues ; capacité de crawl ; mapping et redirections ; protection anti-bot qui bloque les outils de contrôle | Moyen : doublon de contenu entre sites, hreflang inter-domaines |
| Avis / confiance | Intacts (≈ 410 avis Judge.me + Trustpilot attachés au nom) | Risque de rupture de reconnaissance ; avis rattachés à l'ancienne marque | Rupture maximale côté marque et avis | Nouveau site = avis à zéro ; l'ancien reste |
| Merchant Center / Google Ads | Inchangé | Mise à jour des données de marque, noms, politiques | Nouveau compte ou nouvelle URL ; reconstruction des historiques/convertis ; risque de suspension | Nouveau site à valider séparément |
| Coût | Quelques heures de correction | Travail de contenu + graphisme + juridique (nom/marque) ; budget **non estimé sans devis** | Idem + migration technique + période de double exploitation ; budget **non estimé sans devis** | Le plus cher : deux marques à animer |
| Réversibilité | n/a | Moyenne | **Faible** (redirections ≥ 1 an) | Bonne (arrêt du second site) |
| Cas de référence | — | — | Kikikickz → Wethenew : domaine, base clients et réseaux rachetés après faillite, **valeur de la marque/base survit** à l'entreprise (bm_01) | Marques distinctes par marché |
| Verdict provisoire | Défaut tant que le problème n'est pas démontré de nature « marque » | Pertinent seulement si bm_02 prouve que le nom limite une cible précise | À éviter avant d'avoir stabilisé l'offre ; si choisi, migrer en tranches | À considérer pour un **test** Europe (bm_05) sans toucher à .ch |
| Confiance | — | Moyenne-faible | Moyenne | Faible |

**Aucun scénario ne garantit de conserver le SEO.** Google : « Expect temporary fluctuation in site ranking during the move… for medium-sized websites, it can take a few weeks or more… (and for larger sites, even longer) » **[O]** — https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes (consulté 2026-11-02). Les redirections permanentes « ne causent pas de perte de PageRank » selon la même page, mais cela ne couvre pas la perte de marque/confiance ni les erreurs d'exécution.

### 5.2 Checklist de migration (s'applique à S3, en partie à S2 et S4)

Sources : Google Search Central, « Site moves with URL changes » (lien ci-dessus) ; Search Console, Change of Address (https://support.google.com/webmasters/answer/9370220) ; Shopify Help, types de domaine (https://help.shopify.com/en/manual/domains/domain-type — extrait lu : « Each target must have one primary domain… Redirect domains point to… »). Les affirmations Shopify supplémentaires (changer le domaine principal modifie les URL des marchés en sous-dossiers ; hreflang automatique ; sous-dossiers recommandés) viennent de notes de la session précédente et n'ont **pas** été revérifiées ici — à relire avant exécution.

1. **Inventaire des pages** : tous les produits (98 521), collections, pages, articles, images, vidéos ; croiser sitemaps + journaux serveur + GSC + Ahrefs. *Aujourd'hui* : sitemaps OK ; journaux et GSC inaccessibles.
2. **Mapping URL → URL** : une cible par ancienne URL ; pas de redirection en masse vers l'accueil. Inclure `/de`, `/en` et les chemins historiques (ex. `/Sneakers/Nike`).
3. **Redirections** : 301/308 serveur ; tester par URL Inspection + script ; conserver **« as long as possible, generally at least 1 year »** (Google, extrait ci-dessus). Shopify : l'inventaire des redirections existantes est inaccessible (scope manquant) → à exporter avant migration.
4. **Canonicals** : auto-canonicals sur le nouveau site ; supprimer toute canonique pointant vers l'ancien domaine.
5. **Langues / hreflang** : mettre à jour toutes les annotations vers les nouvelles URL ; décider du sort de l'italien (404 actuel).
6. **Données structurées** : Organization/LocalBusiness/Product/MerchantReturnPolicy cohérents avec le nouveau nom, URL de politique de retour valide (A1), GTIN si disponibles, avis seulement s'ils sont vérifiables.
7. **Merchant Center / Google Ads / Meta** : nouveau nom de marque, URL, politiques d'expédition et de retour, catalogue ; plan de continuité des campagnes ; risque de suspension/relearning.
8. **Search Console** : vérifier **toutes** les variantes de l'ancien domaine (www, non-www, sous-domaines) ; déposer Change of Address (« for all verified variants »), sitemaps ancien + nouveau.
9. **Backlinks** : lister les 525 domaines référents actifs ; demander la mise à jour des liens les plus utiles (contact de tiers = hors de ce mandat, à faire par l'entrepreneur).
10. **Suivi / tracking** : GA4, pixels, UTM, Judge.me, canaux d'attribution ; périodes de comparaison avant/après.
11. **Communication clients** : bannière + e-mails + mentions légales (identité de l'exploitant : « Solutions Manzinali », raison individuelle IDE CHE-309.864.712, Bussigny — à confirmer par le conseil juridique) ; ne pas laisser croire à un autre exploitant.
12. **Surveillance des erreurs** : GSC (indexation, exploration), 404/soft-404, chaîne de redirections, rapport de couverture, ventes ; quotidien J0–J14 puis hebdomadaire.
13. **Capacité serveur et protection anti-bot** : Google crawle plus fortement après migration ; vérifier que la protection de boutique n'entrave pas Googlebot (journaux inaccessibles).
14. **Budget de transition** : temps de travail (au tarif interne), outils, graphisme, juridique, double domaine ≥ 12 mois, perte de contribution (§5.3).
15. **Calendrier** : éviter Black Friday/Noël ; ne pas cumuler avec une refonte de thème ; migrer par sections si possible (« it's fine to move your site in sections » **[O]**).

### 5.3 Ordre de grandeur de la perte potentielle (hypothèses de baisse — **pas** des prévisions)

Base : 49 commandes taguées SEO en 2026-10 ; panier moyen TTC 252,8 CHF ; contribution avant publicité 28,8 CHF/commande (fin_00) **[I]**. Les pourcentages et durées sont **[H]** choisis pour borner, non sourcés. Script : `bm_seo_03_ahrefs.py` ; `tableaux/bm_seo_migration_risque_ordre_grandeur.csv`.

| Hypothèse | Baisse SEO | Durée | Commandes perdues | CA TTC perdu (CHF) | Contribution perdue (CHF) |
|---|---|---|---|---|---|
| Légère | −20 % | 3 mois | ≈ 29 | ≈ 7 400 | ≈ 850 |
| Médiane | −40 % | 6 mois | ≈ 118 | ≈ 29 700 | ≈ 3 400 |
| Sévère | −60 % | 12 mois | ≈ 353 | ≈ 89 200 | ≈ 10 200 |

**Fait** : le SEO aujourd'hui ≈ 14–20 % des commandes. **Interprétation** : en valeur de contribution, la perte SEO est faible face à la contribution avant publicité de 28,8 CHF/commande ; l'enjeu majeur d'un renommage serait la confiance/les avis/la publicité, hors de ce tableau. **Limite** : si le trafic SEO estimé croît réellement (Ahrefs : ×4 puis ×2), la base de commandes SEO pourrait augmenter ; refaire le calcul à ce moment. **Confiance** : faible (base = un mois, baisse hypothétique).

### 5.4 Recommandation SEO (hors décision de marque)

Mécanisme économique : réduire le risque d'allégations inexactes et récupérer les ventes déjà proches de la conversion, avant de dépenser sur l'acquisition.

1. Corriger A1 (URL de la politique de retour), A4 (« 20 000 références »), A6 (délais/frais), A2 (soit servir `/it`, soit retirer la déclaration italienne).
2. Obtenir les exports GSC (requêtes, pages, indexation, couverture) et la liste des redirections.
3. Auditer la valeur des liens (525 domaines référents) avant toute décision de domaine.
4. Mesurer, sur 4 semaines, la conversion des pages issues des ~80 000 produits ajoutés avant d'investir davantage dans ce catalogue.
5. Ne décider S2/S3/S4 qu'après bm_02 (problème de positionnement) et bm_05 (test Europe).

---

## 6. Limites et données manquantes

- **Search Console et GA4 INACCESSIBLES** : aucune donnée réelle de requêtes, clics, impressions, positions, indexation, couverture, rapports de pages ; tout le « trafic » ci-dessus est une **estimation Ahrefs Lite** ou une attribution de commande par référent.
- **Redirections** : `urlRedirectsCount` ACCESS_DENIED → inventaire des redirections et mapping historique impossibles (le cas `/Sneakers/Nike` n'est donc pas confirmé comme redirection perdue ; il peut s'agir d'une donnée Ahrefs périmée).
- **Crawl complet impossible** (429 + page de défi) : les contrôles sont un échantillon de 17 URL via un navigateur réel (`bm_seo_pages_sample.csv`), pas un crawl ; les sitemaps DE/EN ne sont analysés qu'en partie (comptage de fichiers et d'URL, pas de contrôle de chaque URL) ; pas de test de duplication de contenu à grande échelle ; images sans alt comptées sur 2 pages seulement.
- **Performance** : une seule mesure navigateur, cache probable ; ni CrUX ni Lighthouse.
- **Ahrefs Lite** : estimations de trafic à ±50 % (bruit mensuel observé) ; pas d'accès à `top-pages` ; qualité des backlinks non analysée ; données Oct–Nov 2026 incomplètes.
- **Propriétaires de domaines** : resell-lausanne.com et .ch enregistrés (RDAP) ; propriétaire de .com non déterminé ; .fr « not found » en RDAP (non confirmé auprès du registraire) ; .de/.eu sans résultat RDAP. Pas de recherche de marques (Swissreg/IPI, EUIPO, WIPO) ni Zefix faite ici — voir bm_02.
- **GEO** : 3 tests uniques, non reproductibles ; pas de panel de requêtes, pas de répétitions ; Merchant Center non accessible.
- **Attribution** : « Google non tagué SEO » (45,4 % des commandes de première visite) interprété comme probablement payant, non confirmé.
- **Information à fournir** par l'entrepreneur : export GSC 16 mois ; liste des redirections Shopify ; accès lecture Merchant Center ; liste des liens/relations presse connus ; propriétaire du .com ; historique du changement de nom/domaine (foundingDate schéma 2020 vs domaine enregistré 16 nov. 2022 selon Gridinsoft, outil tiers non vérifié).
