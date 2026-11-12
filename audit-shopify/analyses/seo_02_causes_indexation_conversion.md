# SEO : causes de la baisse, état technique du site, conversions organiques

Lecture seule. Complète `seo_01_requetes_pages_ads_changements.md`. Étiquettes : F fait, D déclaré, I interprétation, H hypothèse, R recommandation.
Scripts : `calculs/gsc_lib.mjs`, `seo_04_sitemaps.mjs`, `seo_05_liste_inspection.py`, `seo_05_inspection.mjs`, `seo_05_analyse.py`, `seo_06_conv_organique.py`, `seo_07_pages_hebdo.mjs`, `seo_08_collections.mjs`, `seo_09_decomp_requetes.py`.
Bruts non versionnés : `donnees_brutes/site/`, `donnees_brutes/gsc/`.

## 1. Accès : ce que l'API permet

- F : le rapport « Pages » (indexation) de la Search Console n'existe pas dans l'API. Rapports « Statistiques sur l'exploration », « Core Web Vitals », « Améliorations » : idem.
- F : l'API **Inspection d'URL** marche avec le compte de service. 229 URL inspectées (état d'indexation, canonique, dernier crawl, données structurées vues par Google). C'est la preuve la plus directe disponible.
- F : l'API sitemaps marche : `sitemap.xml` index, 133 752 URL web soumises, 0 erreur, 0 avertissement, dernière lecture 2026-11-11. Le champ « indexées » est toujours 0 (déprécié).
- F : PageSpeed Insights sans clé : quota du jour dépassé (429). Pas de mesure Core Web Vitals faite.
- F : mon accès direct au site (curl) reçoit HTTP 429 de Shopify après quelques requêtes sur les sitemaps. Je n'ai pas insisté. Aucun crawl du site par moi.

## 2. Cause de la chute du 14 sept (−27 % d'impressions)

Décomposition par requête (fenêtres avant/après le 14 sept, requêtes ≥ 30 impressions, `seo_09_decomp_requetes.py`) :

| Groupe | Requêtes | Impr. avant | Impr. après | Variation |
|---|---|---|---|---|
| Position stable (±1,5) | 184 | 27 929 | 15 647 | −44 % |
| Position dégradée (> +1,5) | 149 | 16 630 | 7 063 | −57 % |
| Position meilleure | 42 | 2 391 | 1 349 | −44 % |

- F : même les requêtes dont la position n'a pas bougé perdent 44 % d'impressions. Elles représentent 56 % de la perte (−12,3k sur −22,8k). Les requêtes dont la position glisse en représentent 42 % (golden goose 7,7 → 14,6 ; nike mind 9,1 → 13,6 ; chrome hearts 9,4 → 11,6 ; yeezy 8,9 → 11,6).
- F : requêtes de marque (`resell*`) : −31 impressions sur la période, donc rien. La perte est 100 % hors marque.
- F : pages collection de base (sans filtre) : 76 458 → 41 226 impressions (−46 %), clics 1 061 → 593 (−44 %), CTR 1,39 % → 1,44 %, position pondérée 8,1 → 8,5. Le CTR ne baisse pas : moins de gens voient la page, pas moins de gens ne cliquent.
- F : pages avec impressions par semaine, collections + filtres/pagination : ≈ 1 350 début sept → ≈ 540 fin oct (−60 %). Fiches produit : 19,5k → 22,5k (stable à la hausse). Total pages visibles : 21–23k, stable.
- F : sur 65 fiches produit qui avaient des impressions avant et plus après : 51 sont encore « indexées » (78 %), 7 « explorées, non indexées », 4 en 404, 3 divers. Ce n'est donc pas une désindexation de masse.
- F : date. Google a confirmé le « spam update » de septembre du 24 sept au 8 oct (source : Search Status Dashboard, citée par la recherche web). Il commence 10 jours **après** la chute du 14 sept. Un 14–15 sept « non confirmé » est signalé par des sites tiers (D, non vérifié). Même schéma en mai : core update confirmé le 21 mai, notre rupture le 23 mai (−27 %).
- F : un **nouveau core update Google a commencé le 10 nov**. Nos données GSC s'arrêtent au 10 nov. Il peut encore bouger les classements 2 semaines.
- I : la chute est surtout un effet de visibilité globale sur les requêtes génériques de marques/tendances (alo, onitsuka tiger, bape, supreme), pas une panne du site. Mélange probable : baisse de demande ou de saison, changement d'affichage Google (AI Overviews, plus de liens dans les réponses IA, annoncé le 15 oct, D), et pertes de rang sur ~150 requêtes.
- H : le volume massif de fiches créées (~80k en août–sept) a pu faire baisser la confiance de Google sur le site (contenu à grande échelle, pages quasi dupliquées). Non démontré : c'est la seule piste testable ci-dessous, et le calendrier ne la confirme pas (le gain +93 % en juillet précède la chute de 7 semaines).
- Non tranché : pas de preuve causale unique. Réponse à « on doit trouver la cause ? » : le site-side est vérifié (§3), rien de cassé trouvé. Le reste dépend de données que seule l'interface Search Console donne (§6).

### 2bis. Position moyenne du 26 oct (10,5 → 13,5)
- F : même semaine : impressions fiches +9 % (44,2k → 48,2k), position fiches 9,5 → 14,2, hors marque 11,2 → 15,0, collections 8,5 → 9,8. Le lundi suivant tout redevient ≈ normal (10,9).
- F : les volatilités signalées par des tiers : 24–25 oct, 27 oct (D, non confirmées).
- I : la position moyenne GSC est pondérée par les impressions : un afflux de pages en position profonde la tire vers le bas sans que les pages de tête reculent. Les collections (pages de tête) reculent de 1,3 point seulement. La dérive de position totale sur la période (8,3 fin août → 10,5 mi-oct) vient surtout de ce mélange : collections stables, fiches 6,8 → 9,5.
- H : un épisode de volatilité Google d'une semaine (non confirmé).

## 3. État technique du site (Inspection d'URL, 229 URL, 12 nov)

| Groupe | URL | Indexées | Explorée non indexée | 404 | Canonique ≠ | Données produit valides | Fil d'Ariane vu |
|---|---|---|---|---|---|---|---|
| Collections / accueil en tête (perdants) | 40 | 39 | 0 | 0 | 0 | 38 | 38 |
| Collections (échantillon) | 4 | 4 | 0 | 0 | 0 | 4 | 4 |
| Fiches « disparues » | 65 | 51 | 7 | 4 | 1 | 48 PASS, 3 FAIL | 51 |
| Fiches « nouvelles » | 40 | 36 | 1 | 1 | 0 | 33 PASS, 3 FAIL | 36 |
| Fiches du sitemap au hasard | 80 | 67 | 12 | 1 | 0 | 65 PASS, 2 FAIL | 67 |

- F : robots.txt : « autorisé » partout. Aucune URL bloquée, aucune balise noindex vue. Le robots.txt est le modèle standard Shopify.
- F : dernier crawl des fiches du sitemap au hasard : 44 sur 80 en octobre, 17 en novembre, 19 avant octobre (dont 2 en juin). Pages de tête : explorées entre le 19 oct et le 12 nov.
- F : **15 % des fiches du sitemap au hasard (12/80) sont « Explorée, actuellement non indexée »**. I : cohérent avec un catalogue très grand (98,5k produits) dont Google n'indexe qu'une partie. 7,1k fiches seulement reçoivent un clic.
- F : fils d'Ariane (BreadcrumbList) présents sur toutes les pages produit/collection inspectées qui ont des données structurées. 4 pages sur 229 ont l'erreur « Champ "item" manquant » (exemple : `nike-hoops-elite-backpack-32l-elemental-pink-black-black`, `sony-playstation-ps5-dualsense-…`, `nike-air-force-1-low-07-suede-cacao-wow-womens`).
- F : 7 pages sur 229 ont l'erreur Produit « Il faut indiquer offers, review ou aggregateRating » (exemple : `jordan-monogram-dopp-kit-59l-dark-smoke-grey`, `air-jordan-super-fly-4-midnight-navy`). I : pages sans offre valide, par exemple produit non disponible. Le thème ne gère pas ce cas.
- F : avertissements sur quasi toutes les fiches : `aggregateRating`, `review`, `validFrom` manquants. Non bloquants.
- F : `/en/products/nike-air-max-95-sp-corteiz-gutta-green` et 3 autres fiches de la liste renvoient 404 mais restent connues de Google. 1 sur 80 du sitemap au hasard est en 404. I : produits supprimés encore dans l'index ou le sitemap.

### Capture d'écran « Extraits de produits : éléments valides 30k → 4k »
- F : la courbe monte de 21k (14 août) à 30k (19 sept), puis chute à ≈ 5k vers le 20 oct. 26 éléments invalides, 1 problème critique.
- F : la même forme apparaît sur « URL à améliorer » des Core Web Vitals (5,5k le 16 sept, ≈ 1k le 25 oct, retour 2,6k).
- F : en parallèle, le nombre de pages avec impressions par semaine ne bouge pas (21–23k) et 96 % des URL inspectées ont des données valides.
- I : ces rapports comptent les URL récemment explorées par Google, pas les pages visibles. La chute indique que **Google a exploré beaucoup moins d'URL** entre le 20 sept et le 20 oct, pas que le balisage a cassé. Au 12 nov, le dernier crawl des pages de tête est récent, donc ça a repris pour elles.
- H : causes possibles de la baisse d'exploration : Googlebot freiné par le serveur (429/5xx : Shopify me renvoie 429 après quelques requêtes), moindre intérêt de Google pour un catalogue énorme, mise à jour spam du 24 sept. Non vérifiable sans « Statistiques sur l'exploration » (§6).
- F : 3 204 URL de pagination/filtre dans GSC (par ex. `/collections/toutes-nos-paires?page=814`, 463 impressions puis 0). Collections `toutes-nos-paires` 65 330 produits, `homme` 69 711, `express-delivery` 43 470, `all-products-chatgpt-ai-product-description` 98 521 produits. I : pagination très profonde, bien trop longue à explorer.
- F : les 215 collections et les produits du sitemap ont une date de mise à jour = aujourd'hui (sync automatique). I : la date `lastmod` n'apporte aucune information à Google.

## 4. Conversions organiques (source : `orders_api.ndjson`, 6 526 commandes non annulées, jusqu'au 2 nov)

Canal = dernière visite ou première visite : « SEO » (Shopify `sourceType`), `utm_medium=cpc`, `utm_medium=product_sync` (Google gratuit, 1 787 commandes mais aucune en 2026), email, direct. « inconnu » = pas de parcours client enregistré.

| Mois 2026 | SEO cmd | SEO CA (CHF, conservé) | Google cpc cmd | Direct cmd |
|---|---|---|---|---|
| Juil | 35 | 5 471 | 126 | 22 |
| Août | 49 | 10 393 | 247 | 32 |
| Sept | 54 | 16 766 | 185 | 19 |
| Oct | 33 | 9 113 | 175 | 24 |

- F : organique SEO ≈ 33–54 commandes/mois, 9–17k CHF de CA/mois. Google cpc : 125–250 commandes/mois. Sur août–oct : 136 commandes SEO pour ≈ 15,5k clics GSC, soit 0,9 % de conversion par clic.
- F : atterrissage des commandes SEO depuis mai (208 commandes) : accueil 127 (61 %, 69 sur `/`, 31 sur `/de`, 15 sur `/en`), fiches 51 (25 %), collections 28 (13 %). Meilleure collection : `fear-of-god-essentials` (9 commandes, 956 CHF).
- I : l'organique qui vend est surtout **la marque** (accueil). Les collections de tête convertissent peu en dernier clic : 28 commandes en 6 mois sur toutes les collections.
- F : au 14 sept, hors marque −35 % de clics. En commandes fiches+collections ≈ 13/mois.
- H : monter les 113 requêtes (≈ +620 clics/mois) à 0,4–0,9 % de conversion donnerait 2–6 commandes/mois, soit ≈ 90–270 CHF de contribution/mois (contribution moyenne 45,6 CHF/commande). Les chiffres supposent une conversion proche de la moyenne : à vérifier.
- H : perte organique depuis le 14 sept (hors marque −35 % de clics) ≈ 4–8 commandes/mois ≈ 180–365 CHF de contribution/mois.
- I : sous-attribution probable : Shopify attribue à la dernière visite. Un visiteur arrivé par SEO puis revenu en direct ou par pub est compté ailleurs. Non mesurable ici.

## 5. Réponses courtes aux questions du 12 nov

- Gagner en SEO : faible gain tant que la conversion des collections de tête reste de ce niveau (§4). Plus utile : défendre la marque (61 % des commandes SEO), garder les ≈ 15 collections de tête indexées, améliorer le rang de quelques fiches déjà en position 4–5 (par exemple `converse-chuck-taylor-all-star-throwback-low-waxed-denim-black`, 97 clics).
- Économie « payé alors que classé ≤ 3 » : 984 CHF sur 90 j ≈ 330 CHF/mois au maximum. Ces termes ont un ROAS Ads de 4,4 (≈ seuil d'équilibre 4,7–5,1, déjà quasi nul). Gain réel estimé 100–300 CHF/mois (I), et seulement si l'organique récupère ces clics. À tester, pas à décider.
- Marque : ≈ 390 CHF/mois d'annonces sur la marque, 20 182 CHF de valeur revendiquée par Google sur 90 j (≈ 6,7k/mois) + ≈ 21 commandes SEO/mois (accueil). Changer de marque ferait perdre cette demande captive. Chiffre exact de perte non mesurable (direct, remarketing et bouche à oreille se mélangent). H. Si « rebrand » veut dire autre chose, dis-le.
- Chute cause : voir §2. Non tranchée, pas de panne site trouvée.

## 6. Données supplémentaires qui trancheraient (à fournir toi-même, captures)

1. Search Console → Paramètres → **Statistiques sur l'exploration** (90 j) : requêtes totales, temps de réponse, codes 429/5xx. Dirait si Googlebot a été freiné entre le 20 sept et le 20 oct.
2. Search Console → **Indexation → Pages** (graphique complet, tous les motifs de non-indexation). Dirait si l'index a baissé.
3. Search Console → **Core Web Vitals** : onglet « URL à améliorer », motif (LCP/INP/CLS).
4. Merchant Center : diagnostics + courbe du nombre de produits approuvés / refusés, mi-août → nov.
5. Google Trends (gratuit) pour « alo yoga », « onitsuka tiger », « bape », « essentials » sur 12 mois : dirait si la demande a baissé.
6. Shopify admin → Boutique en ligne → Thèmes : date de dernière publication (les commits ne sont pas des dates de mise en ligne).
7. Ads : export de l'historique des modifications > 30 j (impossible depuis l'API).

## 7. Limites

- 229 URL inspectées sur ≈ 130k : indicatif, pas exhaustif. Échantillon au hasard seulement pour 80.
- Inspection d'URL = état au 12 nov, pas à la date de la chute.
- Aucune mesure de vitesse (PSI épuisé). Aucun journal d'exploration.
- Les mises à jour Google viennent de la recherche web (Search Status Dashboard et sites tiers), non recoupées avec un compte Google.
- Attribution SEO = dernière visite Shopify : sous-estime.
